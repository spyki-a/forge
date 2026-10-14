import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { Job } from '@shared/types'
import {
  FACES_TRACK_VERSION,
  RPC_ERRORS,
  SIDECAR_METHODS,
  type FacesParams,
  type FacesResult,
  type FacesTrack,
  type HelloResult,
  type ModelStatus
} from '@shared/sidecar/protocol'
import {
  REDUCE,
  REFRAME_FAILURES,
  REFRAME_PRESET,
  REFRAME_STAGES,
  SUBJECTS_DIR,
  reframeHelperFrom,
  stageProgress,
  subjectTrackFileName,
  type FaceModelProgress,
  type ReframeAnalyseRequest,
  type ReframeCollectResult,
  type ReframeCollected,
  type ReframeFailureReason,
  type ReframeStage
} from '@shared/reframe/job'
import { SUBJECT_TRACK_VERSION, type SubjectTrack } from '@shared/reframe/types'
import { checkSubjectTrack, reduceTrack } from '@shared/reframe/reduce'
import { SCENE_DEFAULTS } from '@shared/reframe/shots'
import { JobQueue } from '../queue'
import { findShots } from '../ffmpeg/shots'
import { probeWithClock } from '../ffmpeg/probe'
import { CancelledError } from '../ffmpeg/run'
import { fileKey as statKey } from '../assets'
import { SidecarError, type SidecarClient } from '../sidecar/client'

/**
 * The reframe's analysis job (docs/CLIPS.md §4.7 "The action, the job, the
 * IPC"; the contract is shared/reframe/job.ts). One job per FILE:
 *
 *   the file's key and probe → its track already on disk? → the AI helper
 *   and its face finder, both there? → shots (main, 0–15 %) → faces (the
 *   helper, 15–85 %) → the reduction (85–100 %) → written to
 *   `$userData/subjects/<key made file-safe>-v<version>.json`.
 *
 * - **On its own `analysis` queue, concurrency 1**: it competes with an
 *   export for CPU, and two analyses at once are two decodes of two files.
 *   Its jobs join the same `jobs:changed` list as exports and downloads
 *   (ipc.ts), with presetId 'reframe' and `params.assetId`.
 * - **The gate comes before any work** (a deviation from §4.7's order, which
 *   found the shots first): a missing helper or model would otherwise cost a
 *   whole scene pass (about 3 s a minute of 1080p, §4.2) for nothing.
 *   Decided from the helper's own `hello.capabilities` (`reframeHelperFrom`)
 *   and `vision.facesModel`'s `present` — never from a message's words.
 *   `vision.faces` never downloads; neither does this job (the Get press does,
 *   through `faceModel`).
 * - **The shots are the WHOLE file's.** A window is not a clip's shots: the
 *   head-skip and the merge act at its edges (EFFECTS.md §52), so a clip's
 *   shots are the whole-file pass's, sliced — which is what this records,
 *   with each cut's exact pts and the stream's time base (§55: required for
 *   25/50 fps projects).
 * - **No `vision.salient`, on any machine, and no RAM gate** (§16.35): a shot
 *   with no face centres with a note (path.ts). **No `vision.ground`**: 1g is
 *   not built, so a phrase fails the job at once with `phrase-needs-ground`.
 * - **Pulled, and handed back once** (`collect`): the renderer asks when the
 *   job reads done, so a reload between the two loses nothing; every later
 *   collect answers `already`. A failed or cancelled job answers its typed
 *   reason as often as asked.
 * - **A cancel** stops whichever stage is running — the scene pass's ffmpeg
 *   (findShots' signal), or the helper's request (the client sends its
 *   cancel; vision.faces stops its worker and removes its half-track in about
 *   0.2 s, EFFECTS.md §54) — and removes nothing a later run needs: the track
 *   file is written whole by a rename, at the very end.
 *
 * Electron-free: ipc.ts registers its handlers, and
 * tests/integration/reframeJob.int.test.ts runs the same ones on a real
 * helper with no window.
 */

/** The part of the helper's client the job uses: a test hands in a real one on its own interpreter. */
export type ReframeHelperClient = Pick<SidecarClient, 'info' | 'request'>

export interface ReframeDeps {
  /**
   * The AI helper, asked for each job (main's is replaced after a restart).
   * May throw when there is none to run (main's `getSidecar` for no pack or a
   * damaged one): the job reads that as no-helper.
   */
  sidecar: () => ReframeHelperClient
  /** Electron's userData: the track files go in its `subjects/`. */
  userData: string
  /** The ffmpeg and ffprobe the helper decodes and probes with (FacesParams). The shot finder runs main's own, `runFfmpeg`. */
  ffmpeg: string
  ffprobe: string
  /** The face finder's download as it goes — the window's `reframe:faceModelProgress`. */
  onFaceModelProgress?: (update: FaceModelProgress) => void
  /** One line per finished job: its stages' times. console.log by default. */
  log?: (line: string) => void
  /** The file's key (`${size}:${mtimeMs}`): main/assets.ts `fileKey` by default. */
  fileKey?: (path: string) => Promise<string | null>
}

/** Where a job's time went, ms; null for a stage it never reached. */
export interface ReframeTiming {
  probeMs: number | null
  gateMs: number | null
  shotsMs: number | null
  facesMs: number | null
  reduceMs: number | null
  totalMs: number | null
  cached: boolean
}

export interface ReframeJobs {
  /** The `analysis` queue: ipc.ts lists, cancels and clears it with the others. */
  queue: JobQueue
  /** `reframe:analyse`: the request re-validated, then queued. */
  analyse(payload: unknown): Job
  /** `reframe:collect`. */
  collect(payload: unknown): Promise<ReframeCollectResult>
  /** `reframe:faceModel`: the face finder's status, or its fetch on `download: true` exactly. */
  faceModel(payload: unknown): Promise<ModelStatus>
  /** One X for every job (`render:cancel`): a no-op for an id this queue does not hold. */
  cancel(id: string): void
  /** `jobs:clearFinished`: the finished jobs, and what was kept beside them. */
  clearFinished(): void
  /** What a job's stages took, for the README a test writes; null for an unknown job. */
  timing(jobId: string): ReframeTiming | null
}

/* -------------------------------------------------------------- the request */

const MAX_ID = 200
const MAX_NAME = 200
const MAX_PHRASE = 200
const MAX_CLIPS = 10_000
const MAX_SIDE = 65_536

/** A name for the job row, never a path: the last part of whatever came, without control characters. */
function displayName(name: unknown, path: string): string {
  const raw = typeof name === 'string' ? name : ''
  // eslint-disable-next-line no-control-regex
  const last = raw.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME)
  return last || basename(path)
}

/**
 * `reframe:analyse`'s payload, re-validated as `ingest/start.ts` does: the
 * renderer proposes, main decides. The ids are kept exactly; the path must be
 * absolute and is only ever stat'd and probed (the size is checked against
 * the probe before anything reads the picture); the size is whole and
 * positive; the name loses any folders; the clip ids keep only what could be
 * ids, once each; a blank phrase is none. Throws on a missing or malformed
 * required field.
 */
export function reframeRequest(payload: unknown): ReframeAnalyseRequest {
  const raw = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  const { assetId, path, width, height, clipIds, phrase } = raw
  if (typeof assetId !== 'string' || assetId.length === 0 || assetId.length > MAX_ID) {
    throw new Error('Finding the subject needs the media it is for')
  }
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0') || !isAbsolute(path)) {
    throw new Error('Finding the subject needs the file’s full path')
  }
  const side = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= MAX_SIDE
  if (!side(width) || !side(height)) throw new Error('Finding the subject needs the file’s upright size')
  if (!Array.isArray(clipIds)) throw new Error('Finding the subject needs the clips that asked for it')
  const ids = [...new Set(clipIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID))].slice(0, MAX_CLIPS)
  const words = typeof phrase === 'string' ? phrase.trim().slice(0, MAX_PHRASE) : ''
  return { assetId, path, width, height, name: displayName(raw.name, path), clipIds: ids, ...(words ? { phrase: words } : {}) }
}

/* ------------------------------------------------------------------ the job */

/** A job that ended without a track, typed — what collect hands the renderer. */
class ReframeFailure extends Error {
  constructor(
    readonly reason: ReframeFailureReason,
    message: string = REFRAME_FAILURES[reason]
  ) {
    super(message)
    this.name = 'ReframeFailure'
  }
}

interface Entry {
  request: ReframeAnalyseRequest
  outcome: { track: SubjectTrack; cached: boolean } | null
  failure: { reason: ReframeFailureReason; message: string } | null
  /** Handed back once: set only after the answer is built, never cleared. */
  collected: boolean
  timing: ReframeTiming
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** The helper's own answer to the face finder's status, checked: it crosses to the renderer. */
function modelStatus(value: unknown): ModelStatus {
  const v = (value ?? {}) as Partial<ModelStatus>
  if (typeof v.present !== 'boolean' || typeof v.bytes !== 'number' || typeof v.label !== 'string' || typeof v.host !== 'string') {
    throw new Error('The AI helper answered the face finder’s status with something else')
  }
  return { present: v.present, bytes: v.bytes, label: v.label, host: v.host }
}

/**
 * `deps.sidecar()`, or null when there is no helper to ask: main's
 * `getSidecar` throws for a machine with no pack or a damaged one (it spawns
 * nothing there, docs/CLIPS.md §3a.2), and that is the job's no-helper, not a
 * failure of its own.
 */
function helperOf(deps: ReframeDeps): ReframeHelperClient | null {
  try {
    return deps.sidecar()
  } catch {
    return null
  }
}

/** The helper's hello: the one it started with, or asked now (a request starts it when it is not running, joining a start in flight). Null when it cannot answer. */
async function helloOf(client: ReframeHelperClient, signal?: AbortSignal): Promise<HelloResult | null> {
  try {
    return client.info ?? (await client.request<HelloResult>(SIDECAR_METHODS.hello, {}, { timeoutMs: 30_000, signal }))
  } catch (err) {
    if (signal?.aborted) throw new CancelledError()
    void err
    return null
  }
}

/**
 * What the job opened in the helper, released when it ends — success,
 * failure or cancel (§12.1). **A no-op today, on purpose**: there is no
 * `system.release` method yet, and `vision.faces` holds no session in the
 * helper — its detector runs in a worker process that exits with the pass
 * (faces.py `run_worker`), and the job no longer calls `vision.salient`,
 * whose BiRefNet session is the one that stays resident (§16.35). When
 * `system.release({names})` lands, it is called here with the names this job
 * opened.
 */
async function releaseSessions(_client: ReframeHelperClient, _opened: readonly string[]): Promise<void> {
  // Nothing to release: see above.
}

/** The track file for a key: `$userData/subjects/<key made file-safe>-v<version>.json` (no colon: Windows refuses one). */
export function subjectTrackPath(userData: string, key: string): string {
  return join(userData, SUBJECTS_DIR, subjectTrackFileName(key, SUBJECT_TRACK_VERSION))
}

/** A track file read back whole and checked, or null. */
async function readTrack(file: string): Promise<SubjectTrack | null> {
  try {
    return checkSubjectTrack(JSON.parse(await readFile(file, 'utf8')))
  } catch {
    return null
  }
}

/** Written beside itself, then renamed into place: a cancel or a crash never leaves half a track under the real name. */
async function writeWhole(file: string, text: string, tag: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}-${tag}.tmp`
  try {
    await writeFile(temp, text, 'utf8')
    await rename(temp, file)
  } catch (err) {
    await unlink(temp).catch(() => undefined)
    throw err
  }
}

/** The helper's face track file, checked for the shape reduceTrack reads. */
async function readFaces(path: string): Promise<FacesTrack> {
  const data = JSON.parse(await readFile(path, 'utf8')) as Partial<FacesTrack>
  if (data?.version !== FACES_TRACK_VERSION || !Array.isArray(data.samples)) throw new Error(`the face track at ${path} is not one this build reads`)
  return data as FacesTrack
}

/** The face pass's ceiling: ten minutes, plus three times the clip (a 4K HEVC decode ran at 1.4× realtime, §54). */
const facesTimeout = (durationMs: number): number => 10 * 60_000 + 3 * durationMs

export function createReframeJobs(deps: ReframeDeps): ReframeJobs {
  const entries = new Map<string, Entry>()
  const log = deps.log ?? ((line: string) => console.log(line))
  const keyOf = deps.fileKey ?? statKey

  /** One job, start to end. Sets `entry.outcome` before it resolves, so a collect on `done` finds it. */
  async function run(
    jobId: string,
    entry: Entry,
    onProgress: (progress: number, speed: string | null) => void,
    signal: AbortSignal
  ): Promise<void> {
    const { request, timing } = entry
    const began = performance.now()
    const stage = (s: ReframeStage, p: number): void => onProgress(stageProgress(s, p), REFRAME_STAGES[s].label)
    const check = (): void => {
      if (signal.aborted) throw new CancelledError()
    }

    // 1g is not built: a phrase is refused before anything is read.
    if (request.phrase) throw new ReframeFailure('phrase-needs-ground')
    stage('shots', 0)

    // The file's own facts, main's: its key, its upright size, its length, its clock.
    const key = await keyOf(request.path)
    if (!key) throw new ReframeFailure('failed', `${request.name} cannot be read: it may have been moved or deleted`)
    let probed: Awaited<ReturnType<typeof probeWithClock>>
    try {
      probed = await probeWithClock(request.path)
    } catch (err) {
      throw new ReframeFailure('failed', `${request.name} could not be read: ${messageOf(err)}`)
    }
    const { info, timeBase } = probed
    if (info.kind !== 'video' || !info.width || !info.height) throw new ReframeFailure('failed', `${request.name} has no picture to follow`)
    // The helper refuses this too (media.require_upright), but only as prose: here it is main's own fact.
    if (info.width !== request.width || info.height !== request.height) throw new ReframeFailure('size-mismatch')
    if (!info.durationMs || !(info.durationMs > 0)) throw new ReframeFailure('failed', `${request.name} has no length ffprobe can read`)
    timing.probeMs = performance.now() - began
    check()

    // The track for this key and version, analysed before at today's scene settings from today's face
    // track: nothing to do. (1a's eval will move SCENE_DEFAULTS; a track cut at the old ones is then
    // analysed again — and so is one reduced from another face-track version: version 1's samples were
    // each up to half a slot late, protocol.ts FACES_TRACK_VERSION.)
    const file = subjectTrackPath(deps.userData, key)
    const onDisk = await readTrack(file)
    if (
      onDisk &&
      onDisk.key === key &&
      onDisk.width === info.width &&
      onDisk.height === info.height &&
      onDisk.scene.threshold === SCENE_DEFAULTS.threshold &&
      onDisk.scene.minShotMs === SCENE_DEFAULTS.minShotMs &&
      onDisk.facesVersion === FACES_TRACK_VERSION
    ) {
      entry.outcome = { track: onDisk, cached: true }
      timing.cached = true
      timing.totalMs = performance.now() - began
      return
    }

    // The helper and its face finder, before any work: either missing costs nothing.
    const gate = performance.now()
    const client = helperOf(deps)
    if (!client) throw new ReframeFailure('no-helper')
    const opened: string[] = []
    try {
      const hello = await helloOf(client, signal)
      if (!hello || reframeHelperFrom({ state: 'ready', hello }) !== 'ready') throw new ReframeFailure('no-helper')
      const model = modelStatus(await client.request<ModelStatus>(SIDECAR_METHODS.facesModel, {}, { signal, timeoutMs: 30_000 }))
      if (!model.present) throw new ReframeFailure('model-missing')
      timing.gateMs = performance.now() - gate
      check()

      // Shots: the whole file (a window is not a clip's shots, EFFECTS.md §52).
      const shotsBegan = performance.now()
      const found = await findShots({
        path: request.path,
        durationMs: info.durationMs,
        // ffprobe's avg_frame_rate at 2 dp; only the head-skip and one-cut-a-frame rules read it.
        fps: info.fps && info.fps > 0 ? info.fps : 30,
        signal,
        onProgress: (p) => stage('shots', p)
      })
      timing.shotsMs = performance.now() - shotsBegan
      check()

      // Faces: the helper's worker, at the UPRIGHT size main believes, cached by the file's key.
      stage('faces', 0)
      const facesBegan = performance.now()
      const params: FacesParams = {
        path: request.path,
        ffmpeg: deps.ffmpeg,
        ffprobe: deps.ffprobe,
        width: info.width,
        height: info.height,
        fps: 5,
        edge: 640,
        minScore: 0.5,
        key
      }
      let faces: FacesResult
      try {
        faces = await client.request<FacesResult>(SIDECAR_METHODS.faces, params, {
          signal,
          timeoutMs: facesTimeout(info.durationMs),
          onProgress: (p) => stage('faces', p ?? 0)
        })
      } catch (err) {
        if (signal.aborted) throw new CancelledError()
        // `unavailable` is a model gone since the gate, or the detector's death: the model's own answer tells which.
        if (err instanceof SidecarError && err.code === RPC_ERRORS.unavailable) {
          const now = await client.request<ModelStatus>(SIDECAR_METHODS.facesModel, {}, { timeoutMs: 30_000 }).catch(() => null)
          if (now && now.present === false) throw new ReframeFailure('model-missing')
        }
        throw new ReframeFailure('failed', `${REFRAME_FAILURES.failed}: ${messageOf(err)}`)
      }
      timing.facesMs = performance.now() - facesBegan
      check()

      // The reduction: 2 a second, the two largest faces, picked (reduce.ts); then the file, whole.
      stage('reduce', 0)
      const reduceBegan = performance.now()
      const samples = reduceTrack(await readFaces(faces.track), found.shots, REDUCE)
      const track: SubjectTrack = {
        key,
        version: SUBJECT_TRACK_VERSION,
        width: info.width,
        height: info.height,
        durationMs: info.durationMs,
        shots: found.shots,
        samples,
        // salient and ground are both absent (§16.35; 1g not built): one empty entry per shot.
        perShot: found.shots.map(() => ({})),
        detector: faces.detector,
        scene: found.scene,
        at: new Date().toISOString(),
        ...(timeBase ? { timeBase } : {}),
        facesVersion: FACES_TRACK_VERSION
      }
      if (!checkSubjectTrack(track)) throw new ReframeFailure('failed', `${REFRAME_FAILURES.failed}: the track came out malformed`)
      check()
      stage('reduce', 0.5)
      await writeWhole(file, JSON.stringify(track), jobId)
      timing.reduceMs = performance.now() - reduceBegan
      entry.outcome = { track, cached: false }
      timing.totalMs = performance.now() - began
    } finally {
      await releaseSessions(client, opened)
    }
  }

  const queue = new JobQueue((job, onProgress) => {
    const entry = entries.get(job.id)
    if (!entry) throw new Error('This analysis is missing its request')
    const controller = new AbortController()
    const promise = run(job.id, entry, onProgress, controller.signal).then(
      () => {
        const t = entry.timing
        const s = (ms: number | null): string => (ms === null ? '—' : `${(ms / 1000).toFixed(2)} s`)
        log(
          t.cached
            ? `[reframe] ${entry.request.name}: the track for this file was on disk (${s(t.totalMs)})`
            : `[reframe] ${entry.request.name}: probe ${s(t.probeMs)}, gate ${s(t.gateMs)}, shots ${s(t.shotsMs)}, faces ${s(t.facesMs)}, reduce ${s(t.reduceMs)}, total ${s(t.totalMs)}`
        )
      },
      (err: unknown) => {
        if (controller.signal.aborted || err instanceof CancelledError || (err instanceof SidecarError && err.code === RPC_ERRORS.cancelled)) {
          entry.failure = { reason: 'cancelled', message: REFRAME_FAILURES.cancelled }
          throw new CancelledError()
        }
        entry.failure =
          err instanceof ReframeFailure
            ? { reason: err.reason, message: err.message }
            : { reason: 'failed', message: `${REFRAME_FAILURES.failed}: ${messageOf(err)}` }
        // Job.error is the prose; the reason stays here for collect.
        throw new Error(entry.failure.message)
      }
    )
    return { promise, cancel: () => controller.abort() }
  }, 1)

  /** One fetch at a time: a second press while the first is fetching waits on the same one. */
  let fetching: Promise<ModelStatus> | null = null

  return {
    queue,

    analyse(payload: unknown): Job {
      const request = reframeRequest(payload)
      return queue.add(
        {
          presetId: REFRAME_PRESET,
          input: request.path,
          inputName: request.name,
          // Nothing to reveal: the track is the app's own, under userData.
          output: '',
          params: { assetId: request.assetId }
        },
        (id) =>
          entries.set(id, {
            request,
            outcome: null,
            failure: null,
            collected: false,
            timing: { probeMs: null, gateMs: null, shotsMs: null, facesMs: null, reduceMs: null, totalMs: null, cached: false }
          })
      )
    },

    async collect(payload: unknown): Promise<ReframeCollectResult> {
      const { jobId } = (typeof payload === 'object' && payload !== null ? payload : {}) as { jobId?: unknown }
      if (typeof jobId !== 'string' || jobId.length === 0) throw new Error('Collecting an analysis needs its job id')
      const entry = entries.get(jobId)
      const job = queue.list().find((j) => j.id === jobId)
      if (!entry || !job) throw new Error('That analysis was cleared from the list')
      if (job.status === 'queued' || job.status === 'running') throw new Error('That analysis has not finished')
      if (job.status === 'cancelled') return { kind: 'failed', reason: 'cancelled', message: REFRAME_FAILURES.cancelled }
      if (job.status === 'failed') {
        const failure = entry.failure ?? { reason: 'failed' as const, message: job.error ?? REFRAME_FAILURES.failed }
        return { kind: 'failed', reason: failure.reason, message: failure.message }
      }
      if (entry.collected) return { kind: 'already' }
      if (!entry.outcome) throw new Error('That analysis finished without a track')
      const { request, outcome } = entry
      const answer: ReframeCollected = {
        kind: 'track',
        assetId: request.assetId,
        clipIds: [...request.clipIds],
        ...(request.phrase ? { phrase: request.phrase } : {}),
        track: outcome.track,
        cached: outcome.cached
      }
      // Marked once the answer exists, never before.
      entry.collected = true
      return answer
    },

    async faceModel(payload: unknown): Promise<ModelStatus> {
      // Only the press that named the size fetches, and only on exactly true.
      const download = typeof payload === 'object' && payload !== null && (payload as { download?: unknown }).download === true
      const client = helperOf(deps)
      const hello = client && (await helloOf(client))
      if (!client || !hello || reframeHelperFrom({ state: 'ready', hello }) !== 'ready') throw new Error(REFRAME_FAILURES['no-helper'])
      if (!download) return modelStatus(await client.request<ModelStatus>(SIDECAR_METHODS.facesModel, {}, { timeoutMs: 30_000 }))
      fetching ??= client
        .request<ModelStatus>(SIDECAR_METHODS.facesModel, { download: true }, {
          timeoutMs: 10 * 60_000,
          onProgress: (progress, message) => deps.onFaceModelProgress?.({ progress, ...(message !== undefined ? { message } : {}) })
        })
        .finally(() => {
          fetching = null
        })
      return modelStatus(await fetching)
    },

    cancel(id: string): void {
      queue.cancel(id)
    },

    clearFinished(): void {
      queue.clearFinished()
      const kept = new Set(queue.list().map((j) => j.id))
      for (const id of entries.keys()) if (!kept.has(id)) entries.delete(id)
    },

    timing(jobId: string): ReframeTiming | null {
      const entry = entries.get(jobId)
      return entry ? { ...entry.timing } : null
    }
  }
}
