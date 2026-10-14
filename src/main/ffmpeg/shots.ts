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
  /**
   * The window's shots, tiling it: [startMs, endMs) in the file's ms. Not the
   * file's shots cut to the window: see `findShots`. On the whole-file pass
   * each carries `startPts`, the cut frame's pts as printed (the first shot's
   * 0), which IS the file's: counted from the file's first timestamp
   * (`start_time` subtracted, as the export's input `-ss` counts), in the
   * stream's time base. A window's carry none — see `findShots`.
   */
  shots: Shot[]
  /** Every cut ffmpeg picked, in the file's ms, before the head-skip and the merge; `pts` as `shots`'. */
  cuts: SceneCut[]
  scene: SubjectTrack['scene']
}

/**
 * Find the shots of `path` (or of a window of it). Rejects with
 * `CancelledError` when `signal` aborts, once ffmpeg is gone.
 *
 * **A clip's shots come from the WHOLE-file pass, sliced to the clip.** A
 * window is not the file's shots restricted to it, so it is not for chunking
 * a long file, nor for a clip's own range: `shotsFrom` runs over the window
 * as if it were a file, so the head-skip drops a real cut in the window's
 * first frames, and a shot the window's edge made shorter than `minShotMs`
 * merges, taking a real cut with it. Measured on the fixture: [1867, 3867]
 * and [1900, 3900] each list the red→blue cut at 2000 ms in `cuts` and return
 * ONE shot across it, as does [0, 2034]; the whole file keeps it. And the
 * window rests on input seeking: on an MPEG-TS copy of the fixture (start
 * 1.4 s), 3–7 s decoded 60 frames from 5 s and found no cut at all.
 *
 * **The exact pts is the whole-file pass's only.** Its `pts:` counts from the
 * file's first timestamp — ffmpeg subtracts the input's `start_time`, so an
 * MPEG-TS starting at 1.4 s prints its 2 s cut as `pts:180000`, not 306000
 * (EFFECTS.md §55) — in the stream's time base, the frame's own (keys.ts
 * `exportFrameAt` takes it with the track's time base). A window's counts from
 * the seek, which ffmpeg rounded from µs into a time base this function does
 * not know, so turning it into the file's would be a guess: the shots and
 * cuts of a window that starts past 0 carry no pts, and keys.ts falls back to
 * their printed ms. (A window from 0 seeks nothing, so its pts are the file's.)
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
  // Read from the file's start (no seek), the pts are the file's as printed; past a seek they are not (above).
  const whole = fromMs === 0
  const found = reader.cuts()
  const shots = shotsFrom(found, toMs - fromMs, o.fps, { minShotMs, skipHeadFrames: SCENE_DEFAULTS.skipHeadFrames })
  const last = shots.length - 1
  return {
    shots: shots.map((s, i) => {
      const shot: Shot = {
        startMs: i === 0 ? fromMs : inFile(s.startMs),
        endMs: i === last ? toMs : inFile(s.endMs),
        score: s.score
      }
      if (whole && s.startPts !== undefined) shot.startPts = s.startPts
      return shot
    }),
    cuts: found.map((c) => (whole ? { ms: inFile(c.ms), score: c.score, pts: c.pts ?? null } : { ms: inFile(c.ms), score: c.score })),
    scene: { threshold, minShotMs, backend: SCENE_BACKEND }
  }
}
