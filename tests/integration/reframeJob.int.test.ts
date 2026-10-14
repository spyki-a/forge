import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { SidecarClient } from '../../src/main/sidecar/client'
import { createReframeJobs, reframeRequest, subjectTrackPath, type ReframeDeps, type ReframeHelperClient, type ReframeJobs } from '../../src/main/reframe/analyse'
import { findShots } from '../../src/main/ffmpeg/shots'
import { probeFile, probeWithClock } from '../../src/main/ffmpeg/probe'
import { fileKey } from '../../src/main/assets'
import {
  REFRAME_FAILURES,
  REFRAME_STAGES,
  subjectTrackFileName,
  type ReframeCollectResult,
  type ReframeCollected,
  type ReframeStage
} from '@shared/reframe/job'
import { FACES_TRACK_VERSION, SIDECAR_METHODS, type FacesParams, type FacesResult, type HelloResult } from '@shared/sidecar/protocol'
import { SUBJECT_TRACK_VERSION, type SubjectTrack, type UnitRect } from '@shared/reframe/types'
import type { Job } from '@shared/types'
import { SCENE_DEFAULTS } from '@shared/reframe/shots'
import { FFMPEG, outputDir, run, writeNote } from './output'
import { HAS_VENV, HELPER_PYTHON, SIDECAR_DIR, VENV_PYTHON, describeWithVenv } from './venv'

/*
 * The reframe's analysis job end to end (docs/CLIPS.md §4.7, §4.9):
 * src/main/reframe/analyse.ts — the same `analyse`, `collect` and `faceModel`
 * ipc.ts registers on `reframe:*`, on its own `analysis` JobQueue — through
 * the real shot finder (main's ffmpeg) and the real AI helper and its worker.
 *
 * The sandbox has no Metal device, so MediaPipe cannot detect here (EFFECTS.md
 * §37, §54): the helper's worker runs its STAND-IN detector
 * (FORGE_FACES_WORKER_FAKE=colour), which boxes each saturated colour. The
 * clip is made here: 6 s of 640×360, three shots cut at 2 and 4 s (the
 * backgrounds change), a red square moving through each and, in the third, a
 * larger blue one beside it. So the job's shots, samples, file, collect-once,
 * cancel and gates are all real, and only the detector is not.
 *
 * The real detector is the user's run, on their own clip, outside the sandbox:
 *
 *     FORGE_REFRAME_REAL=/path/to/clip.mp4 npx vitest run tests/integration/reframeJob.int.test.ts
 *
 * which writes the job's time split into tests/output/reframe-job/README.txt.
 *
 * The first suite needs no venv and runs on CI's bare interpreter too: the
 * request's re-validation, the refusals that come before any work (a phrase,
 * a size the file is not), and no AI helper. The second needs the helper's
 * venv with mediapipe installed (the stand-in never imports it, but the
 * helper registers vision.faces only when it is there).
 */

// Every child main spawns, so a test can count ffmpegs and see them gone.
const spawned = vi.hoisted(() => ({ children: [] as ChildProcess[] }))
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>()
  const spawn = ((...args: Parameters<typeof real.spawn>) => {
    const child = real.spawn(...args)
    spawned.children.push(child)
    return child
  }) as typeof real.spawn
  return { ...real, spawn }
})

const FFPROBE: string = ffprobeInstaller.path
const REAL = process.env.FORGE_REFRAME_REAL ?? ''
const REAL_COMMAND = 'FORGE_REFRAME_REAL=/path/to/clip.mp4 npx vitest run tests/integration/reframeJob.int.test.ts'
/** The model the user's Mac detected with (EFFECTS.md §37): seeds the real run's models folder, as faces.int does. */
const SEED = join(SIDECAR_DIR, '.venv-faces', 'models', 'blaze_face_full_range.tflite')

let dir = ''
const notes: string[] = []
const realNotes: string[] = []

/* ------------------------------------------------------------------ media */

const SIZE = { width: 640, height: 360 }
/** Three 2 s shots: each a background the stand-in does not box, and a red square (64 px) moving at its own pace. */
const SHOTS = [
  { bg: 'black', red: (t: number): [number, number] => [40 + 100 * t, 100], redX: '40+100*t', redY: 100 },
  { bg: '0x909090', red: (t: number): [number, number] => [500 - 100 * t, 200], redX: '500-100*t', redY: 200 },
  { bg: '0x303030', red: (t: number): [number, number] => [100 + 50 * t, 60], redX: '100+50*t', redY: 60, blue: [400, 200, 96] as const }
]

/** The boxes the stand-in should report on SOURCE frame `f` (30 fps), largest first, as shares of the frame: overlay truncates x. */
function facesOnFrame(f: number): UnitRect[] {
  const k = Math.min(2, Math.floor(f / 60))
  const t = (f - k * 60) / 30
  const [x, y] = SHOTS[k].red(t)
  const red = { x: Math.trunc(x) / SIZE.width, y: y / SIZE.height, width: 64 / SIZE.width, height: 64 / SIZE.height }
  const blue = SHOTS[k].blue
  return blue ? [{ x: blue[0] / SIZE.width, y: blue[1] / SIZE.height, width: blue[2] / SIZE.width, height: blue[2] / SIZE.height }, red] : [red]
}

/**
 * The source frames a sample labelled `ms` could show, from its label to half
 * a slot past it. The helper decodes at `fps=5:round=up` (media.frame_args),
 * whose slot k holds the frame on screen at k/5 — frame 6k on this 30 fps
 * clip, the label's own. Before 2026-10-14 it was `fps=5`, rounding to
 * nearest: frame 6k + 2, 66.7 ms late (faces track version 1). The window
 * lets the check name the frame it found; the offset is then pinned at 0.
 */
const framesFor = (ms: number): number[] => {
  const out: number[] = []
  for (let f = Math.ceil((ms * 30) / 1000 - 1e-9); (f * 1000) / 30 < ms + 100; f++) out.push(f)
  return out
}

/** How far a box is from a want, in px of the 640-wide frame, on its worst side. */
const pxOff = (a: UnitRect, b: UnitRect): number =>
  Math.max(Math.abs(a.x - b.x) * SIZE.width, Math.abs(a.width - b.width) * SIZE.width, Math.abs(a.y - b.y) * SIZE.height, Math.abs(a.height - b.height) * SIZE.height)

/** The clip: the three shots, lossless 4:4:4 so the colours stay saturated, 30 fps (1/15360 in mp4). */
async function makeClip(file: string, repeat = 1): Promise<string> {
  const chains: string[] = []
  const labels: string[] = []
  for (let r = 0; r < repeat; r++) {
    SHOTS.forEach((s, i) => {
      const n = `${r}_${i}`
      chains.push(`color=c=${s.bg}:s=${SIZE.width}x${SIZE.height}:r=30:d=2[b${n}]`)
      chains.push(`color=c=red:s=64x64:r=30:d=2[r${n}]`)
      if (s.blue) {
        chains.push(`color=c=blue:s=${s.blue[2]}x${s.blue[2]}:r=30:d=2[u${n}]`)
        chains.push(`[b${n}][r${n}]overlay=x='${s.redX}':y=${s.redY}:format=yuv444[m${n}]`)
        chains.push(`[m${n}][u${n}]overlay=x=${s.blue[0]}:y=${s.blue[1]}:format=yuv444[s${n}]`)
      } else {
        chains.push(`[b${n}][r${n}]overlay=x='${s.redX}':y=${s.redY}:format=yuv444[s${n}]`)
      }
      labels.push(`[s${n}]`)
    })
  }
  chains.push(`${labels.join('')}concat=n=${labels.length}:v=1[v]`)
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y', '-filter_complex', chains.join(';'),
    '-map', '[v]', '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv444p', file
  ])
  return file
}

let CLIP = ''

/* ---------------------------------------------------------------- helpers */

const clients: SidecarClient[] = []
const logs = new Map<SidecarClient, string[]>()

/**
 * A helper with its own folders, an interpreter, and extra environment for
 * this one process (the worker inherits it). SidecarClient spawns inside
 * start() before its first await, so the variables are back before any
 * other helper starts (faces.int's helper()).
 */
async function helper(o: { models: string; cache: string; env?: Record<string, string>; python?: string }): Promise<SidecarClient> {
  const saved: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(o.env ?? {})) {
    saved[name] = process.env[name]
    process.env[name] = value
  }
  const client = new SidecarClient({ cwd: SIDECAR_DIR, python: o.python ?? VENV_PYTHON, modelsDir: o.models, cacheDir: o.cache, maxRestarts: 0 })
  clients.push(client)
  const lines: string[] = []
  logs.set(client, lines)
  client.on('log', (text: string) => lines.push(...text.split('\n')))
  let started: Promise<HelloResult>
  try {
    started = client.start()
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
  await started
  return client
}

/** The pids faces.py logged for its workers. */
function workerPids(client: SidecarClient): number[] {
  return (logs.get(client) ?? []).flatMap((line) => {
    const found = /faces: worker (\d+) started/.exec(line)
    return found ? [Number(found[1])] : []
  })
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function until(test: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await test()) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return test()
}

/** Main's own ffmpegs (the shot finder's), as spawned since `from`. */
const mainFfmpegs = (from: number): ChildProcess[] => spawned.children.slice(from).filter((c) => c.spawnfile === FFMPEG)

/** Python on the helper's interpreter with the package importable, its stdout parsed. */
async function python<T>(code: string, env: Record<string, string> = {}): Promise<T> {
  const { stdout } = await run(VENV_PYTHON, ['-c', code], { cwd: SIDECAR_DIR, env: { ...process.env, ...env }, windowsHide: true })
  return JSON.parse(stdout) as T
}

/** Where fetch_url keeps the face finder under `models` — the helper's own answer, so nothing is re-derived. */
async function modelPathIn(models: string): Promise<string> {
  return python<string>('import json; from forge_sidecar.capabilities import faces; print(json.dumps(faces.model_path()))', { FORGE_MODELS_DIR: models })
}

/** Every snapshot of one job, as the list main broadcasts would carry it. */
function watch(jobs: ReframeJobs): Map<string, Job[]> {
  const seen = new Map<string, Job[]>()
  jobs.queue.on('changed', (list: Job[]) => {
    for (const job of list) seen.set(job.id, [...(seen.get(job.id) ?? []), { ...job }])
  })
  return seen
}

const statusOf = (jobs: ReframeJobs, id: string): Job['status'] | undefined => jobs.queue.list().find((j) => j.id === id)?.status

async function settled(jobs: ReframeJobs, id: string, ms = 60_000): Promise<Job> {
  const done = await until(() => ['done', 'failed', 'cancelled'].includes(statusOf(jobs, id) ?? ''), ms)
  expect(done, `job ${id} settled`).toBe(true)
  return jobs.queue.list().find((j) => j.id === id)!
}

function request(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { assetId: 'asset-1', path: CLIP, width: SIZE.width, height: SIZE.height, name: 'clip.mp4', clipIds: ['c1', 'c2'], ...extra }
}

const WINDOWS_REFUSED = /[<>:"|?*\u0000-\u001f]/
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** The progress a job showed, held to its stages: inside each label's range, never back, never 1 while running. */
function expectStagedProgress(snapshots: Job[]): ReframeStage[] {
  const running = snapshots.filter((j) => j.status === 'running')
  const labels = Object.fromEntries(Object.entries(REFRAME_STAGES).map(([k, v]) => [v.label, k as ReframeStage]))
  const order: ReframeStage[] = []
  let last = 0
  for (const j of running) {
    expect(j.progress, `running at ${j.progress} (${j.speed})`).toBeLessThan(1)
    expect(j.progress, 'never back').toBeGreaterThanOrEqual(last)
    last = j.progress
    if (j.speed === null) continue
    const stage = labels[j.speed]
    expect(stage, `a stage's label: ${j.speed}`).toBeDefined()
    const { from, to } = REFRAME_STAGES[stage]
    expect(j.progress, `${j.speed} at ${j.progress}`).toBeGreaterThanOrEqual(from)
    expect(j.progress, `${j.speed} at ${j.progress}`).toBeLessThanOrEqual(to)
    if (order[order.length - 1] !== stage) order.push(stage)
  }
  return order
}

beforeAll(async () => {
  dir = await outputDir('reframe-job')
  CLIP = await makeClip(join(dir, 'clip.mp4'))
}, 60_000)

afterAll(async () => {
  for (const client of clients) client.stop()
  if (!dir) return
  await writeNote(dir, [
    '# The reframe’s analysis job — src/main/reframe/analyse.ts (docs/CLIPS.md §4.7)',
    '',
    'clip.mp4: 6 s of 640×360 at 30 fps, lossless 4:4:4, cut at 2 and 4 s; a red square moving through',
    'each shot, a larger blue one beside it in the third. The helper’s worker ran its stand-in detector',
    '(FORGE_FACES_WORKER_FAKE=colour): the sandbox has no Metal, so MediaPipe cannot run here.',
    '',
    ...notes,
    '',
    '## The real detector, on your own clip',
    '',
    `    ${REAL_COMMAND}`,
    '',
    ...(realNotes.length ? realNotes : ['(not run in this invocation)'])
  ])
})

/* ------------------------------------------- the suite that needs no venv */

describe('the analysis job — what it refuses before any work', () => {
  /** A helper that must never be asked: these refusals come first. */
  const never: ReframeDeps['sidecar'] = () => {
    throw new Error('the AI helper was asked')
  }
  const make = (sidecar: ReframeDeps['sidecar'] = never, userData = join(dir, 'userdata-refusals')): ReframeJobs =>
    createReframeJobs({ sidecar, userData, ffmpeg: FFMPEG, ffprobe: FFPROBE, log: (l) => notes.push(`- ${l}`) })

  it('re-validates the request: the ids exactly, an absolute path, a whole size, the clips once, a name with no folders', () => {
    const ok = reframeRequest({ ...request(), name: '/Users/someone/Wedding 5:30pm.mp4', clipIds: ['c1', 'c1', 7, '', 'c2'], phrase: '   ' })
    expect(ok).toEqual({ assetId: 'asset-1', path: CLIP, width: 640, height: 360, name: 'Wedding 5:30pm.mp4', clipIds: ['c1', 'c2'] })
    expect(reframeRequest({ ...request(), name: 'C:\\Users\\x\\talk.mov', phrase: ' the cake ' })).toMatchObject({ name: 'talk.mov', phrase: 'the cake' })
    // A name of nothing is the file's own.
    expect(reframeRequest({ ...request(), name: undefined }).name).toBe('clip.mp4')
    for (const [what, bad] of [
      ['no asset id', { ...request(), assetId: '' }],
      ['a relative path', { ...request(), path: 'media/clip.mp4' }],
      ['a size with a fraction', { ...request(), width: 640.5 }],
      ['a size of 0', { ...request(), height: 0 }],
      ['no clip list', { ...request(), clipIds: 'c1' }],
      ['nothing at all', null]
    ] as const) {
      expect(() => reframeRequest(bad), what).toThrow()
    }
  })

  it('a phrase fails the job at once with phrase-needs-ground: 1g is not built, and nothing is read or spawned', async () => {
    const jobs = make()
    const before = spawned.children.length
    const job = jobs.analyse(request({ phrase: 'the cake' }))
    expect(job).toMatchObject({ presetId: 'reframe', inputName: 'clip.mp4', params: { assetId: 'asset-1' }, status: 'queued' })
    const end = await settled(jobs, job.id)
    expect(end.status).toBe('failed')
    expect(end.error).toBe(REFRAME_FAILURES['phrase-needs-ground'])
    const answer = await jobs.collect({ jobId: job.id })
    expect(answer).toEqual({ kind: 'failed', reason: 'phrase-needs-ground', message: REFRAME_FAILURES['phrase-needs-ground'] })
    // As often as asked.
    expect(await jobs.collect({ jobId: job.id })).toEqual(answer)
    expect(spawned.children.length).toBe(before)
  })

  it('a size the file is not fails with size-mismatch from main’s own probe, before the helper is asked', async () => {
    const jobs = make()
    const before = spawned.children.length
    const job = jobs.analyse(request({ width: 360, height: 640 }))
    expect((await settled(jobs, job.id)).status).toBe('failed')
    expect(await jobs.collect({ jobId: job.id })).toEqual({ kind: 'failed', reason: 'size-mismatch', message: REFRAME_FAILURES['size-mismatch'] })
    expect(mainFfmpegs(before)).toEqual([])
  })

  it('a file gone since import fails with its name, not its path', async () => {
    const jobs = make()
    const job = jobs.analyse(request({ path: join(dir, 'gone.mp4'), name: 'gone.mp4' }))
    expect((await settled(jobs, job.id)).status).toBe('failed')
    const answer = (await jobs.collect({ jobId: job.id })) as Extract<ReframeCollectResult, { kind: 'failed' }>
    expect(answer.reason).toBe('failed')
    expect(answer.message).toMatch(/^gone\.mp4 cannot be read/)
  })

  it('no AI helper — an interpreter that is not there, or one where the face finder is degraded — fails with no-helper before any shot is found', async () => {
    // An interpreter that is not there: the helper cannot start at all.
    const nowhere = new SidecarClient({ cwd: SIDECAR_DIR, python: join(dir, 'no-such-python'), maxRestarts: 0 })
    clients.push(nowhere)
    // A bare interpreter: the helper starts, and vision.faces is degraded (no mediapipe).
    let bare = HELPER_PYTHON
    if (HAS_VENV) {
      const bareDir = join(dir, 'bare-venv')
      await run(VENV_PYTHON, ['-m', 'venv', '--without-pip', bareDir], { windowsHide: true })
      bare = join(bareDir, ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']))
    }
    const degraded = await helper({ models: join(dir, 'models-bare'), cache: join(dir, 'cache-bare'), python: bare })
    const hello = degraded.info!
    expect(hello.capabilities, `${bare} has the face finder: not a bare interpreter`).not.toContain(SIDECAR_METHODS.faces)
    expect(Object.keys(hello.degraded)).toContain(SIDECAR_METHODS.faces)

    for (const [what, client] of [
      ['no interpreter', nowhere],
      ['the face finder degraded', degraded]
    ] as const) {
      const jobs = make(() => client)
      const before = spawned.children.length
      const job = jobs.analyse(request())
      expect((await settled(jobs, job.id)).status, what).toBe('failed')
      expect(await jobs.collect({ jobId: job.id }), what).toEqual({ kind: 'failed', reason: 'no-helper', message: REFRAME_FAILURES['no-helper'] })
      expect(mainFfmpegs(before), `${what}: no scene pass`).toEqual([])
      // The dock's question gets the same answer, in words.
      await expect(jobs.faceModel({}), what).rejects.toThrow(REFRAME_FAILURES['no-helper'])
    }
    notes.push(`- no helper: "${REFRAME_FAILURES['no-helper']}" from a missing interpreter, and from ${bare} (vision.faces degraded: ${hello.degraded[SIDECAR_METHODS.faces]})`)
  }, 60_000)

  it('collect: a job it never had, or one cleared, is gone; a running one has not finished', async () => {
    const jobs = make()
    await expect(jobs.collect({ jobId: 'no-such-job' })).rejects.toThrow('That analysis was cleared from the list')
    await expect(jobs.collect({})).rejects.toThrow('needs its job id')
    const job = jobs.analyse(request({ phrase: 'the cake' }))
    await settled(jobs, job.id)
    jobs.clearFinished()
    expect(jobs.queue.list()).toEqual([])
    await expect(jobs.collect({ jobId: job.id })).rejects.toThrow('That analysis was cleared from the list')
  })
})

/* ------------------------------- a stand-in helper client, also no venv */

describe('the analysis job with a stand-in helper client — the shot finder real, on any interpreter', () => {
  /** What the job may ask the helper, ever (§16.35: no vision.salient, and 1g's vision.ground is not built). */
  const ALLOWED = [SIDECAR_METHODS.hello, SIDECAR_METHODS.facesModel, SIDECAR_METHODS.faces]

  /**
   * A client with the face finder up and on disk, recording every method it
   * is asked. `faces` answers by writing the colour stand-in's track for
   * CLIP (facesOnFrame, 5 a second) and naming it, as the helper would.
   */
  function standIn(asked: string[], tracks: string): ReframeDeps['sidecar'] {
    const hello: HelloResult = {
      protocolVersion: 1,
      python: 'stand-in',
      platform: process.platform,
      capabilities: [SIDECAR_METHODS.faces, SIDECAR_METHODS.facesModel],
      degraded: {}
    }
    const request = async (method: string, params: unknown): Promise<unknown> => {
      asked.push(method)
      if (method === SIDECAR_METHODS.facesModel) return { present: true, bytes: 1_083_786, label: 'the face finder', host: 'storage.googleapis.com' }
      if (method === SIDECAR_METHODS.faces) {
        const p = params as FacesParams
        const samples = []
        for (let ms = 0; ms < 6000; ms += 200) samples.push({ ms, faces: facesOnFrame((ms * 30) / 1000).map((f) => ({ ...f, score: 0.9 })) })
        await mkdir(tracks, { recursive: true })
        const track = join(tracks, `faces-${asked.length}.json`)
        await writeFile(track, JSON.stringify({ version: FACES_TRACK_VERSION, samples }))
        const result: FacesResult = {
          width: p.width, height: p.height, durationMs: 6000, sampleFps: 5, frames: samples.length,
          withFace: samples.length, detector: 'test-stand-in/client', track, cached: false
        }
        return result
      }
      throw new Error(`the stand-in helper was asked ${method}`)
    }
    const client = { info: hello, request } as unknown as ReframeHelperClient
    return () => client
  }

  it('runs a whole job asking the helper nothing but the face finder’s status and its faces — no salient, no ground', async () => {
    const asked: string[] = []
    const jobs = createReframeJobs({
      sidecar: standIn(asked, join(dir, 'stand-in-tracks')),
      userData: join(dir, 'userdata-stand-in'),
      ffmpeg: FFMPEG,
      ffprobe: FFPROBE,
      log: (l) => notes.push(`- ${l}`)
    })
    const job = jobs.analyse(request())
    const end = await settled(jobs, job.id)
    expect(end.status, end.error ?? '').toBe('done')
    const answer = (await jobs.collect({ jobId: job.id })) as ReframeCollected
    expect(answer.kind).toBe('track')
    expect(answer.track.shots.map((s) => s.startMs)).toEqual([0, 2000, 4000])
    expect(answer.track.detector).toBe('test-stand-in/client')
    // Membership, every method asked: the plan's no-salient decision held by more than a grep.
    for (const method of asked) expect(ALLOWED, `the job asked ${method}`).toContain(method)
    expect(asked).toContain(SIDECAR_METHODS.faces)
    expect(asked).not.toContain(SIDECAR_METHODS.salient)
    notes.push(`- a stand-in client: the job asked ${asked.join(', ')}`)
  }, 60_000)

  it('a track on disk cut at other scene settings, or from another face-track version, is analysed again — never handed back', async () => {
    const userData = join(dir, 'userdata-scene-settings')
    const asked: string[] = []
    const jobs = createReframeJobs({ sidecar: standIn(asked, join(dir, 'stand-in-tracks')), userData, ffmpeg: FFMPEG, ffprobe: FFPROBE })
    const pass = async (): Promise<{ cached: boolean; scenePasses: number }> => {
      const before = spawned.children.length
      const job = jobs.analyse(request())
      const end = await settled(jobs, job.id)
      expect(end.status, end.error ?? '').toBe('done')
      const answer = (await jobs.collect({ jobId: job.id })) as ReframeCollected
      return { cached: answer.cached, scenePasses: mainFfmpegs(before).length }
    }
    expect(await pass(), 'the first analysis').toEqual({ cached: false, scenePasses: 1 })
    expect(await pass(), 'the same file at the same settings: from disk').toEqual({ cached: true, scenePasses: 0 })

    const file = subjectTrackPath(userData, (await fileKey(CLIP))!)
    for (const [what, change] of [
      ['the threshold', (t: SubjectTrack) => ({ ...t, scene: { ...t.scene, threshold: SCENE_DEFAULTS.threshold + 0.05 } })],
      ['the shortest shot', (t: SubjectTrack) => ({ ...t, scene: { ...t.scene, minShotMs: SCENE_DEFAULTS.minShotMs + 250 } })],
      // The helper's sampling: version 1's samples were each up to half a slot late (media.frame_args' round=up).
      ['the face track’s version', (t: SubjectTrack) => ({ ...t, facesVersion: FACES_TRACK_VERSION - 1 })],
      ['a track from before the face track’s version was kept', ({ facesVersion: _, ...t }: SubjectTrack) => t]
    ] as const) {
      const onDisk = JSON.parse(await readFile(file, 'utf8')) as SubjectTrack
      await writeFile(file, JSON.stringify(change(onDisk)))
      expect(await pass(), `${what} on disk is not today's: analysed again, one scene pass`).toEqual({ cached: false, scenePasses: 1 })
      // And written back at today's settings: the next is from disk.
      const written = JSON.parse(await readFile(file, 'utf8')) as SubjectTrack
      expect(written.scene).toMatchObject({ threshold: SCENE_DEFAULTS.threshold, minShotMs: SCENE_DEFAULTS.minShotMs })
      expect(written.facesVersion).toBe(FACES_TRACK_VERSION)
    }
    notes.push('- a track on disk at another threshold, another shortest shot, another face-track version or none: analysed again (one scene pass each), then from disk')
  }, 60_000)

  it('a cancel in the shots stage stops the scene pass at once: cancelled within 1 s, its ffmpeg killed, nothing else asked', async () => {
    // A flat 4K clip, as shots.int's cancel: a tiny file whose scene pass takes seconds (2.3 and 8 s measured).
    const long = join(dir, 'long-4k.mp4')
    await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x404040:size=3840x2160:rate=30:duration=20',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', long
    ])
    const asked: string[] = []
    const jobs = createReframeJobs({ sidecar: standIn(asked, join(dir, 'stand-in-tracks')), userData: join(dir, 'userdata-shots-cancel'), ffmpeg: FFMPEG, ffprobe: FFPROBE })
    const seen = watch(jobs)
    const before = spawned.children.length
    const job = jobs.analyse(request({ path: long, name: 'long-4k.mp4', width: 3840, height: 2160 }))

    // Mid-shots: the scene pass's own report, past the stage's start.
    let cancelledAt = -1
    const midway = await until(() => {
      const last = seen.get(job.id)?.at(-1)
      if (last?.status === 'running' && last.speed === REFRAME_STAGES.shots.label && last.progress > 0) {
        cancelledAt = last.progress
        return true
      }
      return false
    }, 30_000)
    expect(midway, 'the shots stage reported mid-pass').toBe(true)
    const began = performance.now()
    jobs.cancel(job.id)
    expect((await settled(jobs, job.id, 30_000)).status).toBe('cancelled')
    const tookMs = performance.now() - began
    expect(tookMs, 'the cancel reached the scene pass (findShots’ signal)').toBeLessThan(1000)
    expect(await jobs.collect({ jobId: job.id })).toEqual({ kind: 'failed', reason: 'cancelled', message: REFRAME_FAILURES.cancelled })

    // The scene pass: one ffmpeg, exited — killed, not run to its end (exit 0).
    const scene = mainFfmpegs(before)
    expect(scene).toHaveLength(1)
    expect(await until(() => scene[0].exitCode !== null || scene[0].signalCode !== null, 2000), 'the scene pass has exited').toBe(true)
    expect(scene[0].exitCode, 'stopped, not left to run to the end').not.toBe(0)
    // The gate only: the faces were never asked for.
    expect(asked).toEqual([SIDECAR_METHODS.facesModel])
    notes.push(`- a cancel at ${cancelledAt.toFixed(3)} of the bar (mid-shots, a 20 s 4K clip): cancelled ${Math.round(tookMs)} ms later, the scene pass killed`)
  }, 120_000)
})

/* ------------------------------------------ the suite on the real helper */

const HAS_MEDIAPIPE =
  HAS_VENV &&
  spawnSync(VENV_PYTHON, ['-c', 'import importlib.util, sys; sys.exit(0 if importlib.util.find_spec("mediapipe") else 1)'], {
    windowsHide: true
  }).status === 0
const NEEDS = { 'mediapipe in the helper venv (sidecar/requirements-faces*.txt)': HAS_MEDIAPIPE }

describeWithVenv(
  'the analysis job on the real helper and its stand-in detector',
  () => {
    let models = ''

    beforeAll(async () => {
      // A placeholder at the model's path: vision.facesModel answers present, and the stand-in never reads it.
      models = join(dir, 'models')
      const path = await modelPathIn(models)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, 'placeholder: the stand-in detector never reads the model')
    }, 60_000)

    it('finds the shots and the faces, writes the track under a Windows-legal name, and hands it back once', async () => {
      const userData = join(dir, 'userdata')
      const client = await helper({ models, cache: join(dir, 'cache', 'pass'), env: { FORGE_FACES_WORKER_FAKE: 'colour' } })
      const jobs = createReframeJobs({ sidecar: () => client, userData, ffmpeg: FFMPEG, ffprobe: FFPROBE, log: (l) => notes.push(`- ${l}`) })
      const seen = watch(jobs)
      const before = spawned.children.length

      const job = jobs.analyse(request())
      expect(job).toMatchObject({ presetId: 'reframe', input: CLIP, inputName: 'clip.mp4', output: '', params: { assetId: 'asset-1' } })
      const end = await settled(jobs, job.id)
      expect(end.status, end.error ?? '').toBe('done')
      expect(end.progress).toBe(1)

      const answer = (await jobs.collect({ jobId: job.id })) as ReframeCollected
      expect(answer.kind).toBe('track')
      expect(answer).toMatchObject({ assetId: 'asset-1', clipIds: ['c1', 'c2'], cached: false })
      const track: SubjectTrack = answer.track

      // The file's own facts.
      const key = (await fileKey(CLIP))!
      expect(track).toMatchObject({ key, version: SUBJECT_TRACK_VERSION, width: 640, height: 360, durationMs: 6000, detector: 'test-stand-in/colour' })
      expect(track.timeBase).toEqual((await probeWithClock(CLIP)).timeBase)
      expect(track.timeBase).toEqual({ num: 1, den: 15360 })

      // The shots are the shot finder's on the whole file, exact pts and all.
      const found = await findShots({ path: CLIP, durationMs: 6000, fps: 30 })
      expect(track.shots).toEqual(found.shots)
      expect(track.shots.map((s) => [s.startMs, s.endMs, s.startPts])).toEqual([
        [0, 2000, 0],
        [2000, 4000, 30720],
        [4000, 6000, 61440]
      ])
      expect(track.scene).toEqual(found.scene)
      expect(track.perShot).toEqual([{}, {}, {}])

      // 2 a second: each 500 ms tick's nearest sample of its own shot (the earlier on a tie), each sample's boxes
      // one source frame's — a frame the sample may show (framesFor), within a pixel, its shot's own.
      expect(track.samples.map((s) => s.ms)).toEqual([0, 400, 1000, 1400, 2000, 2400, 3000, 3400, 4000, 4400, 5000, 5400])
      const offsets = new Set<number>()
      for (const sample of track.samples) {
        const match = framesFor(sample.ms).find((f) => {
          const want = facesOnFrame(f)
          return want.length === sample.faces.length && sample.faces.every((face, i) => pxOff(face, want[i]) <= 1)
        })
        expect(match, `${sample.ms} ms: ${JSON.stringify(sample.faces)} is no frame's in ${framesFor(sample.ms).join(', ')}`).toBeDefined()
        offsets.add(match! - (sample.ms * 30) / 1000)
      }
      // Every sample is the frame on screen at its label: round=up, not the old rounding to nearest (+2 frames).
      expect([...offsets], 'source frames between each sample’s label and the frame it shows').toEqual([0])
      // The third shot: the larger (blue, 0.7) first, then the red (0.9).
      expect(track.samples.filter((s) => s.ms >= 4000).every((s) => s.faces.map((f) => f.score).join() === '0.7,0.9')).toBe(true)

      // On disk, whole, under a name Windows takes.
      const file = subjectTrackPath(userData, key)
      const name = basename(file)
      expect(name).toBe(subjectTrackFileName(key, SUBJECT_TRACK_VERSION))
      expect(name).not.toMatch(WINDOWS_REFUSED)
      expect(name).not.toMatch(/[. ]$/)
      expect(name.split('.')[0]).not.toMatch(RESERVED)
      expect(dirname(file)).toBe(join(userData, 'subjects'))
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(track)
      expect(await readdir(dirname(file)), 'no temporary left beside it').toEqual([name])

      // Handed back once; every later collect answers already.
      expect(await jobs.collect({ jobId: job.id })).toEqual({ kind: 'already' })
      expect(await jobs.collect({ jobId: job.id })).toEqual({ kind: 'already' })

      // The bar: inside each stage's range, the stages in order, never 1 before done. (The queue drops a
      // report within 150 ms of the last, so which stages show is the clock's; their order and ranges are not.)
      const order = expectStagedProgress(seen.get(job.id)!)
      expect(order).toEqual([...order].sort((a, b) => REFRAME_STAGES[a].from - REFRAME_STAGES[b].from))

      // One scene pass by main (findShots above is the test's own: two in all), one worker in the helper.
      expect(mainFfmpegs(before).length).toBe(2)
      expect(workerPids(client).length).toBe(1)

      const t = jobs.timing(job.id)!
      const size = (await stat(file)).size
      const s = (ms: number | null): string => (ms === null ? '—' : `${Math.round(ms)} ms`)
      notes.push(
        `- the pass: probe ${s(t.probeMs)}, gate ${s(t.gateMs)}, shots ${s(t.shotsMs)}, faces ${s(t.facesMs)}, reduce and write ${s(t.reduceMs)}; total ${s(t.totalMs)}`,
        `- the track: ${track.shots.length} shots (pts ${track.shots.map((x) => x.startPts).join(', ')} on ${track.timeBase!.num}/${track.timeBase!.den}), ${track.samples.length} samples, each box a source frame's within 1 px; ${size} B at ${name}`,
        `- the frame each sample shows, against its label: +${[...offsets].join(', +')} source frame(s) — the helper's fps=5:round=up shows the frame on screen at the label (face track version ${FACES_TRACK_VERSION}); fps=5 rounding to nearest showed frame 6k + 2, 66.7 ms late`,
        `- the bar's stages, in order: ${order.join(' → ')}`
      )
    }, 120_000)

    it('a second analysis of the same file answers from its track on disk: no scene pass, no worker', async () => {
      const userData = join(dir, 'userdata')
      const client = await helper({ models, cache: join(dir, 'cache', 'pass'), env: { FORGE_FACES_WORKER_FAKE: 'colour' } })
      const jobs = createReframeJobs({ sidecar: () => client, userData, ffmpeg: FFMPEG, ffprobe: FFPROBE, log: (l) => notes.push(`- ${l}`) })
      const before = spawned.children.length
      const job = jobs.analyse(request({ assetId: 'asset-2', clipIds: ['c9'] }))
      expect((await settled(jobs, job.id)).status).toBe('done')
      const answer = (await jobs.collect({ jobId: job.id })) as ReframeCollected
      expect(answer).toMatchObject({ kind: 'track', assetId: 'asset-2', clipIds: ['c9'], cached: true })
      const key = (await fileKey(CLIP))!
      expect(answer.track).toEqual(JSON.parse(await readFile(subjectTrackPath(userData, key), 'utf8')))
      expect(mainFfmpegs(before)).toEqual([])
      expect(workerPids(client)).toEqual([])
      notes.push(`- the same file again: from disk in ${Math.round(jobs.timing(job.id)!.totalMs!)} ms, no scene pass, no worker`)
    }, 60_000)

    it('without the face finder on disk the job fails with model-missing before any shot is found or any worker starts — and downloads nothing', async () => {
      const empty = join(dir, 'models-empty')
      await mkdir(empty, { recursive: true })
      const dead = 'http://127.0.0.1:9'
      const client = await helper({
        models: empty,
        cache: join(dir, 'cache', 'no-model'),
        env: { FORGE_FACES_WORKER_FAKE: 'colour', HTTPS_PROXY: dead, https_proxy: dead, HTTP_PROXY: dead, http_proxy: dead, ALL_PROXY: dead, all_proxy: dead }
      })
      const jobs = createReframeJobs({ sidecar: () => client, userData: join(dir, 'userdata-no-model'), ffmpeg: FFMPEG, ffprobe: FFPROBE })
      const seen = watch(jobs)
      const before = spawned.children.length
      const job = jobs.analyse(request())
      expect((await settled(jobs, job.id)).status).toBe('failed')
      expect(await jobs.collect({ jobId: job.id })).toEqual({ kind: 'failed', reason: 'model-missing', message: REFRAME_FAILURES['model-missing'] })
      expect(mainFfmpegs(before), 'no scene pass').toEqual([])
      expect(workerPids(client), 'no worker').toEqual([])
      expect(seen.get(job.id)!.some((j) => j.speed === REFRAME_STAGES.faces.label), 'never reached the faces').toBe(false)
      expect(await readdir(empty), 'nothing fetched').toEqual([])
      // The dock's question, then: not present, the size the button names. And no download without `true`.
      expect(await jobs.faceModel({})).toEqual({ present: false, bytes: 1_083_786, label: 'the face finder', host: 'storage.googleapis.com' })
      expect((await jobs.faceModel({ download: 'yes' })).present).toBe(false)
      expect(await readdir(empty)).toEqual([])
      notes.push('- no face finder on disk: model-missing, with no scene pass, no worker and nothing fetched')
    }, 60_000)

    it('a cancel mid-faces leaves no worker and no ffmpeg, a cancelled job, and nothing written; a queued one cancels without running', async () => {
      // An ffmpeg that writes down its own pid before becoming the real one (exec keeps the pid), for the helper's decode.
      let decoder = FFMPEG
      const pids = join(dir, 'ffmpeg-pids.txt')
      if (process.platform !== 'win32') {
        decoder = join(dir, 'ffmpeg-recording-its-pid.sh')
        await writeFile(decoder, `#!/bin/sh\necho $$ >> '${pids}'\nexec '${FFMPEG}' "$@"\n`)
        await chmod(decoder, 0o755)
      }
      const long = await makeClip(join(dir, 'long.mp4'), 3)
      const cache = join(dir, 'cache', 'cancel')
      const userData = join(dir, 'userdata-cancel')
      // 18 s at 5 a second is 90 samples; at 40 ms each, about 3.6 s of faces.
      const client = await helper({ models, cache, env: { FORGE_FACES_WORKER_FAKE: 'colour:40' } })
      const jobs = createReframeJobs({ sidecar: () => client, userData, ffmpeg: decoder, ffprobe: FFPROBE })
      const seen = watch(jobs)
      const before = spawned.children.length
      const job = jobs.analyse(request({ path: long, name: 'long.mp4' }))
      const queued = jobs.analyse(request({ path: long, name: 'long.mp4', assetId: 'asset-3' }))

      // Mid-faces: a report of the helper's own, past the stage's start.
      let cancelledAt = -1
      const midway = await until(() => {
        const last = seen.get(job.id)?.at(-1)
        if (last?.speed === REFRAME_STAGES.faces.label && last.progress > REFRAME_STAGES.faces.from) {
          cancelledAt = last.progress
          return true
        }
        return false
      }, 30_000)
      expect(midway, 'the faces stage reported mid-pass').toBe(true)
      expect(statusOf(jobs, queued.id)).toBe('queued')
      jobs.cancel(queued.id)
      expect(statusOf(jobs, queued.id)).toBe('cancelled')
      const began = performance.now()
      jobs.cancel(job.id)

      expect((await settled(jobs, job.id, 10_000)).status).toBe('cancelled')
      const tookMs = performance.now() - began
      // At once: the request is rejected on the abort, not when the pass would have ended (about 3 s on).
      expect(tookMs, 'the cancel reached the helper’s request').toBeLessThan(1000)
      for (const id of [job.id, queued.id]) {
        expect(await jobs.collect({ jobId: id })).toEqual({ kind: 'failed', reason: 'cancelled', message: REFRAME_FAILURES.cancelled })
      }

      // The helper's worker and its decoder: gone. Main's scene pass: long since exited.
      const workers = workerPids(client)
      expect(workers.length).toBe(1)
      expect(await until(() => !alive(workers[0]), 4000), `worker ${workers[0]}`).toBe(true)
      if (process.platform !== 'win32') {
        const decoders = (await readFile(pids, 'utf8')).trim().split('\n').map(Number)
        expect(decoders.length).toBe(1)
        expect(await until(() => !alive(decoders[0]), 2000), `ffmpeg ${decoders[0]}`).toBe(true)
      }
      for (const child of mainFfmpegs(before)) expect(child.exitCode !== null || child.signalCode !== null, 'the scene pass has exited').toBe(true)
      // Nothing half-written: no track file, no temporary, and no half-track in the helper's cache.
      expect(existsSync(join(userData, 'subjects')) ? await readdir(join(userData, 'subjects')) : []).toEqual([])
      await until(async () => (await readdir(join(cache, 'faces'))).length === 0, 2000)
      expect(await readdir(join(cache, 'faces'))).toEqual([])
      expect((await client.request<{ pong: string }>(SIDECAR_METHODS.ping, { echo: 'after' })).pong).toBe('after')
      notes.push(`- a cancel at ${cancelledAt.toFixed(3)} of the bar (mid-faces): the job cancelled ${Math.round(tookMs)} ms later, worker ${workers[0]} and its ffmpeg gone, nothing written; the job queued behind it cancelled without running`)
    }, 120_000)
  },
  NEEDS
)

/* ------------------------------------------------- the user's real run */

describeWithVenv(
  `the analysis job on a real clip with the real detector (${REAL_COMMAND})`,
  () => {
    it('runs the job on FORGE_REFRAME_REAL and writes its time split', async () => {
      const real = join(dir, 'real')
      const models = join(real, 'models')
      await mkdir(models, { recursive: true })
      const path = await modelPathIn(models)
      if (existsSync(SEED) && !existsSync(path)) {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, await readFile(SEED))
      }
      const client = await helper({ models, cache: join(real, 'cache') })
      const jobs = createReframeJobs({ sidecar: () => client, userData: join(real, 'userdata'), ffmpeg: FFMPEG, ffprobe: FFPROBE, log: (l) => realNotes.push(`- ${l}`) })
      // The model: the measured copy when this Mac has it, else the product's own press.
      const model = await jobs.faceModel({ download: true })
      expect(model.present).toBe(true)

      const info = await probeFile(REAL)
      const job = jobs.analyse({ assetId: 'real', path: REAL, width: info.width, height: info.height, name: info.name, clipIds: [] })
      const end = await settled(jobs, job.id, 60 * 60_000)
      expect(end.status, end.error ?? '').toBe('done')
      const answer = (await jobs.collect({ jobId: job.id })) as ReframeCollected
      const track = answer.track
      const t = jobs.timing(job.id)!
      const file = subjectTrackPath(join(real, 'userdata'), track.key)
      const s = (ms: number | null): string => (ms === null ? '—' : `${(ms / 1000).toFixed(2)} s`)
      realNotes.push(
        `- ${info.name}: ${info.width}×${info.height}, ${(info.durationMs! / 1000).toFixed(1)} s, ${info.fps} fps, ${info.videoCodec}; time base ${track.timeBase ? `${track.timeBase.num}/${track.timeBase.den}` : 'none'}`,
        `- detector ${track.detector}`,
        `- probe ${s(t.probeMs)}, gate ${s(t.gateMs)}, shots ${s(t.shotsMs)}, faces ${s(t.facesMs)}, reduce and write ${s(t.reduceMs)}; total ${s(t.totalMs)}`,
        `- ${track.shots.length} shots; ${track.samples.length} samples kept (2 a second), ${track.samples.filter((x) => x.faces.length > 0).length} with a face, ${track.samples.filter((x) => x.faces.length > 1).length} with two`,
        `- the track file: ${(await stat(file)).size} B (${basename(file)})`
      )
    }, 60 * 60_000)
  },
  { 'FORGE_REFRAME_REAL=<a clip>': REAL !== '' && existsSync(REAL), ...NEEDS }
)
