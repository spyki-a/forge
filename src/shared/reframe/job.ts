/**
 * The reframe's analysis job — the contract between main, the preload, the
 * harness bridge and the store (docs/CLIPS.md §4.7 "The action, the job, the
 * IPC", §4.8, §16.35).
 *
 * One job per FILE: shots (main), then faces (the AI helper), then main
 * reduces the helper's track to `SubjectTrack` and writes it to
 * `$userData/subjects/`. It runs on its own `analysis` queue (concurrency 1:
 * it competes with an export for CPU) and appears in the same `jobs:changed`
 * list as exports and downloads, with presetId `REFRAME_PRESET`.
 *
 * NOT in it, decided 2026-10-13 (§16.35): `vision.salient` — on no machine,
 * with no RAM gate; a shot with no face centres with a note. And no
 * `vision.ground` (1g is not built): a request with a phrase is refused with
 * `phrase-needs-ground`.
 *
 * Pulled, like ingest's collect (shared/ingest/collect.ts): the renderer asks
 * for the finished track once the job reads `done`, so a reload (Cmd+R)
 * between the two loses nothing, and main hands a track back ONCE — every
 * later collect of that job answers `{ kind: 'already' }`, so a reload after
 * it does not re-follow a clip the user has since unfollowed.
 *
 * Pure and Electron-free: imported by main, the renderer and the tests.
 */

import type { ModelStatus } from '../sidecar/protocol'
import { helperCan, type HelperStatusLike } from '../sidecar/helperCan'
import { SIDECAR_METHODS } from '../sidecar/protocol'
import type { SubjectTrack } from './types'

/*
 * Re-exported so renderer code imports it from here: tests/settingsPanel.test.ts
 * reads every string literal under src/renderer/src, import specifiers
 * included, and a path holding "sidecar" fails it.
 */
export type { ModelStatus }

/* ------------------------------------------------------------- channels */

/**
 * The IPC channels. The preload writes these as literals, as every other
 * channel there is; `tests/bridgeMethods.test.ts` holds each preload method to
 * the channel named here.
 */
export const REFRAME_CHANNELS = {
  /** ReframeAnalyseRequest → Job (queued). */
  analyse: 'reframe:analyse',
  /** ReframeCollect → ReframeCollectResult. PULLED, so it survives Cmd+R. */
  collect: 'reframe:collect',
  /** FaceModelRequest → ModelStatus: the dock's label before any press, and the fetch the press starts. */
  faceModel: 'reframe:faceModel',
  /** main → renderer while the face finder downloads: FaceModelProgress. */
  faceModelProgress: 'reframe:faceModelProgress'
} as const

/** The job's `presetId`, stamped by main: what `setJobs` collects, as it collects 'ingest'. */
export const REFRAME_PRESET = 'reframe'

/** The job row's words: "Finding the subject · <name>" (§4.8). */
export const REFRAME_JOB_TITLE = 'Finding the subject'

/* -------------------------------------------------------------- request */

/** `reframe:analyse`'s payload. Main re-validates every field: the renderer proposes. */
export interface ReframeAnalyseRequest {
  assetId: string
  /** The asset's file. Main stats it for the key and probes it; never trusted beyond that. */
  path: string
  /** The UPRIGHT size the project believes (asset.width/height, R5); the helper refuses when the probe disagrees. */
  width: number
  height: number
  /** The asset's display name, for the job row (`Job.inputName`). Never a path. */
  name: string
  /**
   * The clips to follow when the track lands. Main keeps and echoes them in
   * the collect, so a reload mid-job — which takes the renderer's own record
   * with it — still knows which clips asked (ingest's `clip` is the same rule).
   */
  clipIds: string[]
  /** "the cake": 1g's grounding. Not built — a phrase fails the job with `phrase-needs-ground`. */
  phrase?: string
}

/** `reframe:collect`'s payload. */
export interface ReframeCollect {
  jobId: string
}

/** `reframe:faceModel`'s payload: `download` ONLY from the press of the button that named the size. */
export interface FaceModelRequest {
  download?: boolean
}

/** The face finder's download, pushed on `faceModelProgress`. `progress` null is a stage with no total. */
export interface FaceModelProgress {
  progress: number | null
  message?: string
}

/**
 * What main stamps on the job besides `presetId`: `params.assetId`, so a
 * window reloaded mid-job can tell which asset is busy without comparing paths.
 */
export interface ReframeJobParams {
  assetId: string
}

/* --------------------------------------------------------------- result */

/** A finished analysis, handed back for the first time. */
export interface ReframeCollected {
  kind: 'track'
  assetId: string
  /** As the request named them; the store follows those still on the timeline. */
  clipIds: string[]
  phrase?: string
  track: SubjectTrack
  /** The track for this key and version was already on disk: nothing was analysed. */
  cached: boolean
}

/** The job failed or was cancelled: why, typed, for the UI to map (never parsed from prose). */
export interface ReframeFailed {
  kind: 'failed'
  reason: ReframeFailureReason
  /** REFRAME_FAILURES[reason], or a more specific sentence for 'failed'. Also the job's `error`. */
  message: string
}

/** This job's track was handed back before — to this window before a reload, or to another. */
export interface ReframeAlready {
  kind: 'already'
}

export type ReframeCollectResult = ReframeCollected | ReframeFailed | ReframeAlready

/* ------------------------------------------------------------- failures */

/**
 * Why a job ended without a track. The store maps them:
 * - `no-helper` → "needs the AI helper" (Follow the subject greyed);
 * - `model-missing` → the dock's Get label ("gets the face finder, 1.1 MB, first time");
 * - `phrase-needs-ground` → the Follow: field greyed with 1g's reason;
 * - `size-mismatch` → the file changed shape since import (§3.1's size check);
 * - `cancelled` → nothing said: the user's own doing;
 * - `failed` → the job's own message.
 */
export type ReframeFailureReason =
  | 'no-helper'
  | 'model-missing'
  | 'phrase-needs-ground'
  | 'size-mismatch'
  | 'cancelled'
  | 'failed'

/** The words for each. On screen the Python process is "the AI helper", never anything else. */
export const REFRAME_FAILURES: Record<ReframeFailureReason, string> = {
  'no-helper': 'Following the subject needs the AI helper',
  'model-missing': 'The face finder is not downloaded yet',
  'phrase-needs-ground': 'Following something named is not built yet: the face is followed',
  'size-mismatch': 'This file is not the size it was when it was imported: import it again',
  cancelled: 'Cancelled',
  failed: 'Finding the subject failed'
}

export function isReframeFailure(value: unknown): value is ReframeFailureReason {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REFRAME_FAILURES, value)
}

/* --------------------------------------------------------------- stages */

/**
 * The job's bar, by stage: shots 0–15 %, faces 15–85 %, the reduction 85–100 %
 * (§4.7; salient's and ground's slices are gone with §16.35). The stage's
 * `label` rides in the job's `speed` column, as a download's messages do.
 */
export const REFRAME_STAGES = {
  shots: { from: 0, to: 0.15, label: 'finding the shots' },
  faces: { from: 0.15, to: 0.85, label: 'finding faces' },
  reduce: { from: 0.85, to: 1, label: 'keeping the track' }
} as const

export type ReframeStage = keyof typeof REFRAME_STAGES

/** A stage's own 0..1 on the job's bar. Out-of-range and non-finite input is clamped, never passed on. */
export function stageProgress(stage: ReframeStage, progress: number): number {
  const { from, to } = REFRAME_STAGES[stage]
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0
  return from + (to - from) * p
}

/* ------------------------------------------------------------ reduction */

/**
 * The helper's 5-a-second track down to `SubjectTrack.samples` (§4.3): 2 a
 * second, the two largest faces. Per 500 ms tick the sample whose `ms` is
 * NEAREST is KEPT, never averaged — a box is one frame's fact, and the mean of
 * two frames' boxes is a box no frame had.
 */
export const REDUCE = { samplesPerSecond: 2, maxFaces: 2, pick: 'nearest' } as const

/* ---------------------------------------------------------------- files */

/** `$userData/<SUBJECTS_DIR>/` holds one track file per file key and version. */
export const SUBJECTS_DIR = 'subjects'

/**
 * The track's file name: `<key made file-safe>-v<version>.json`.
 *
 * The key is `${size}:${mtimeMs}` (main/assets.ts `fileKey`) and holds a
 * COLON, which Windows refuses in a file name (CLAUDE.md). Every character
 * outside [0-9A-Za-z_-] becomes '-' — dots too, so no name can end in one —
 * and the `-v<n>` suffix means the stem is never a reserved device name
 * (CON, NUL, COM1…). Two keys differing only in such characters would share a
 * name; a real file key is digits and one colon, so none do.
 */
export function subjectTrackFileName(key: string, version: number): string {
  if (typeof key !== 'string' || key.length === 0) throw new Error('A subject track needs its file key')
  if (!Number.isInteger(version) || version < 1) throw new Error('A subject track needs its version')
  const safe = key.replace(/[^0-9A-Za-z_-]/g, '-').slice(0, 120)
  return `${safe}-v${version}.json`
}

/* --------------------------------------------------------------- helper */

/** Whether the AI helper can find faces: what greys Follow the subject and Reframe to 9:16. */
export type ReframeHelper = 'unknown' | 'ready' | 'missing'

/** The store's `reframe` slice (store.ts), here so a component's test can build one. */
export interface ReframeStatus {
  helper: ReframeHelper
  /** `faceModel({})`'s last answer; null until asked. */
  model: ModelStatus | null
  /** The face finder's download while a press is fetching it; null otherwise. */
  fetching: FaceModelProgress | null
  /** Analyses in flight, asset id → job id: what the dock shows as busy. */
  pending: Record<string, string>
}

/** A status with or without its `source`: the reframe reads only the state and a ready one's hello (main's job passes a bare ready). */
export type { HelperStatusLike }

/**
 * The helper's status as main broadcasts it (src/shared/sidecar/status.ts),
 * reduced to what the reframe needs: `helperCan` (src/shared/sidecar/
 * helperCan.ts) for BOTH `vision.faces` and `vision.facesModel`, so it is
 * decided from the capabilities, never from a message's prose. Registered,
 * not degraded, and not failed by the install's self-test (the faces group):
 * a face finder whose module did not import, or whose mediapipe cannot load,
 * is `missing` as much as no Python is: either way nothing can find a face
 * on this machine. No pack, a damaged one, one being installed, or a helper
 * that failed is `missing` (§3a.2: anything not ready is missing); only a
 * helper starting is not known yet, for the seconds its hello takes. An
 * install runs for minutes, and `unknown` would have told Follow the subject
 * "the AI helper is starting" for all of them.
 */
export function reframeHelperFrom(status: HelperStatusLike): ReframeHelper {
  if (status.state === 'starting') return 'unknown'
  return helperCan(status, SIDECAR_METHODS.faces) && helperCan(status, SIDECAR_METHODS.facesModel) ? 'ready' : 'missing'
}

/** The job row's words for a reframe job. */
export function reframeJobLabel(job: { inputName: string }): string {
  return `${REFRAME_JOB_TITLE} · ${job.inputName}`
}
