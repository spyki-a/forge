import { SCENE_BACKEND, SCENE_DEFAULTS, sceneArgs, sceneLogReader, shotsFrom, type SceneCut } from '@shared/reframe/shots'
import type { Shot, SubjectTrack } from '@shared/reframe/types'
import { CancelledError, runFfmpeg } from './run'

/**
 * The shot finder, in main (docs/CLIPS.md §4.2): ffmpeg's scene score over a
 * file, as shots in the file's own milliseconds. It needs only ffmpeg, so it
 * works without the AI helper.
 *
 * Its own globals, on `runFfmpeg` with `complete: true`: `-loglevel info`,
 * never runFfmpeg's `error`. `metadata=print` logs at INFO, and at `error`
 * the same graph printed nothing (measured), so every clip came back as one
 * shot with no error. `-hide_banner` and `-nostats` are `sceneArgs`'.
 */
export const SHOTS_GLOBALS = ['-nostdin', '-loglevel', 'info'] as const

export interface FindShotsOptions {
  path: string
  /** The file's duration: the last shot ends here, or at `endMs`. */
  durationMs: number
  /** The file's frame rate: a cut's frame is `round(ms × fps / 1000)`. */
  fps: number
  /** A window of the file, [startMs, endMs); the whole file when left out. */
  startMs?: number
  endMs?: number
  threshold?: number
  minShotMs?: number
  signal?: AbortSignal
  /** 0..1 through the window, from ffmpeg's own `-progress`. */
  onProgress?: (fraction: number) => void
}

export interface ShotsFound {
  /** The window's shots, tiling it: [startMs, endMs) in the file's ms. */
  shots: Shot[]
  /** Every cut ffmpeg picked, in the file's ms, before the head-skip and the merge. */
  cuts: SceneCut[]
  scene: SubjectTrack['scene']
}

/**
 * Find the shots of `path` (or of a window of it). Rejects with
 * `CancelledError` when `signal` aborts, once ffmpeg is gone.
 */
export async function findShots(o: FindShotsOptions): Promise<ShotsFound> {
  const threshold = o.threshold ?? SCENE_DEFAULTS.threshold
  const minShotMs = o.minShotMs ?? SCENE_DEFAULTS.minShotMs
  const fromMs = o.startMs ?? 0
  const toMs = o.endMs ?? o.durationMs
  if (!(o.durationMs > 0)) throw new Error(`Cannot find the shots of ${o.path}: its duration is ${o.durationMs} ms`)
  if (!(o.fps > 0) || !Number.isFinite(o.fps)) throw new Error(`Cannot find the shots of ${o.path} at ${o.fps} fps`)
  if (!(fromMs >= 0 && toMs > fromMs && toMs <= o.durationMs)) {
    throw new Error(`Cannot find shots from ${fromMs} to ${toMs} ms in ${o.durationMs} ms`)
  }
  if (o.signal?.aborted) throw new CancelledError()

  const reader = sceneLogReader()
  const handle = runFfmpeg({
    args: [...SHOTS_GLOBALS, ...sceneArgs(o.path, { threshold, edge: SCENE_DEFAULTS.edge, startMs: o.startMs, endMs: o.endMs })],
    complete: true,
    durationMs: toMs - fromMs,
    outputPath: null,
    onProgress: (fraction) => o.onProgress?.(fraction),
    onStderrLine: reader.line
  })
  const abort = (): void => handle.cancel()
  o.signal?.addEventListener('abort', abort, { once: true })
  try {
    await handle.promise
  } finally {
    o.signal?.removeEventListener('abort', abort)
  }

  // `pts_time` counts from where the pass began reading: the window's start.
  // The window's own ends are kept exactly; the cuts inside, to the microsecond.
  const inFile = (ms: number): number => Math.round((fromMs + ms) * 1e3) / 1e3
  const found = reader.cuts()
  const shots = shotsFrom(found, toMs - fromMs, o.fps, { minShotMs, skipHeadFrames: SCENE_DEFAULTS.skipHeadFrames })
  const last = shots.length - 1
  return {
    shots: shots.map((s, i) => ({
      startMs: i === 0 ? fromMs : inFile(s.startMs),
      endMs: i === last ? toMs : inFile(s.endMs),
      score: s.score
    })),
    cuts: found.map((c) => ({ ms: inFile(c.ms), score: c.score })),
    scene: { threshold, minShotMs, backend: SCENE_BACKEND }
  }
}
