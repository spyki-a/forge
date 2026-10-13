import { assetById, framesToSeconds, type Clip, type Project } from '../timeline'
import { cropFilter, followClock, followedRetime, type CropFollow } from './plan'
import { sourceFramesFor } from './speed'
import { followKeys } from '../reframe/keys'
import { windowSum, type FlatSum } from '../reframe/expression'
import type { FootageRequest } from './moment'

/**
 * The pre-pass for a moment over footage (docs/PLAN.md §7.2): the shot's
 * frames under the moment, pulled from the file by ffmpeg into numbered PNGs,
 * through the SAME chain the render plays the clip with — decoded from the
 * in-point as `videoInputArgs` does, the clip's retime (`followedRetime`: the
 * ramp's `setpts` curve, or the constant speed's `setpts` and `fps`; at
 * speed 1 the render's own `fps` step, which resamples 24p and 60p footage to
 * the project's rate), the render's `cropFilter` in the file's pixels — a
 * followed crop's keys and a stacked two-up included — then the window
 * trimmed out of the retimed, cropped stream, and a cap on the long edge
 * measured on the frame that arrives (a rotated phone clip decodes turned).
 * So the picture a moment composes for its first and last frames is the
 * render's own frame beneath, as it is for a photograph.
 *
 * Pure: this builds the arguments; main/render/momentFrames.ts runs them and
 * keeps the frames, and the eval runs them in node. Testable without a GPU
 * and, with a real ffmpeg, against the render (tests/integration/
 * momentFrames.int.test.ts).
 */

/** The longest edge a pulled frame is kept at: enough for a 9:16 crop to fill a 1080×1920 frame at 1:1, and a 4K frame's height. */
export const FOOTAGE_MAX_EDGE = 2160

const seconds = (frames: number, fps: number): string => framesToSeconds(frames, fps).toFixed(6)

/**
 * The cap, as an expression on the frame that arrives — never on the probed
 * size: the probe recorded a phone clip's coded size while ffmpeg decodes it
 * turned, so a cap sized from the probe squeezed a portrait clip into a
 * landscape box at half its resolution (measured). The probe reads the turn
 * since 2026-10-08 (docs/CLIPS.md §3.1), but an asset imported before then
 * still carries the coded size, and the frame that arrives is the truth
 * either way. Even, for the encoder.
 */
export function footageCapFilter(maxEdge: number): string {
  const shrink = `min(1,${maxEdge}/max(iw,ih))`
  return `scale=w='trunc(iw*${shrink}/2)*2':h='trunc(ih*${shrink}/2)*2':flags=bicubic`
}

/**
 * ffmpeg's arguments for one shot's frames, into `pattern` (`…/%05d.png`).
 *
 * Every case but a hold decodes from the in-point: the retime's phase — which
 * source frame a clip frame shows — is anchored at the clip's first decoded
 * frame, and a seek to the window's own place in the file (`first × speed`)
 * landed a frame off it whenever that was not whole (measured at half speed,
 * one frame ahead). Smooth slow-motion (`minterpolate`) looks ahead, so it is
 * given the render's whole input window and holds its tail as the render
 * does; the others need only the window's source frames and a little slack.
 */
export function momentFrameArgs(req: FootageRequest, pattern: string): string[] {
  const { fps } = req
  const clip: Pick<Clip, 'crop' | 'speed' | 'ramp' | 'smoothSlow' | 'hold' | 'duration'> = {
    duration: Math.max(1, req.duration),
    ...(req.crop ? { crop: req.crop } : {}),
    ...(req.speed !== undefined ? { speed: req.speed } : {}),
    ...(req.ramp ? { ramp: req.ramp } : {}),
    ...(req.smoothSlow ? { smoothSlow: true } : {}),
    ...(req.hold ? { hold: true } : {})
  }
  const follow = footageFollow(req)
  const count = Math.max(1, req.count)
  /*
   * One pull of the stacked frame for a two-up: the split, two crops and
   * vstack inside the -vf (measured to run there, §4.7). The keys are the
   * window's own (`windowFollow`): this -vf goes on a command line, and the
   * whole clip's sums put a long clip's past Windows' limit. The clock and
   * the retime are decided on the whole follow, which is the render's.
   */
  const cut = cropFilter(clip, req.size, windowFollow(follow, req.hold ? 0 : req.first, req.hold ? 1 : req.first + count, fps), fps, 0)
  const finish = [footageCapFilter(req.maxEdge), 'format=rgba'].join(',')

  if (req.hold) {
    return ['-ss', seconds(req.inPoint, fps), '-i', req.path, '-vf', `trim=end_frame=1,setpts=PTS-STARTPTS,${cut ? `${cut},` : ''}${finish}`, '-frames:v', '1', '-start_number', '0', pattern]
  }

  /*
   * The render's own retime, or at speed 1 the render's own fps step (plan.ts
   * applies `fps=` to every clip) — and for a crop that moves, the render's
   * own clock ahead of it (`followClock`, `fps=…:start_time=0`), so the
   * pull's frame k is the render's clip frame k, slot k, whichever slot the
   * first frame after the seek rounds to. At speed 1 the clock IS the fps step.
   */
  const clock = followClock(follow, fps)
  const retime = [followedRetime(clip, fps, follow) ?? (clock ? null : `fps=${fps}`), clock].filter((s) => s !== null).join(',')
  /*
   * The render's own input window, whole (`videoInputArgs`: `-t` of the
   * source frames the clip eats), not just the window's — and for smooth
   * slow-motion eight source frames more. `minterpolate` looks ahead, and
   * the 2018 Windows build's closes its stream without flushing: on CI a
   * window on a smooth clip's last six frames came back three, and a `tpad`
   * after it padded nothing. With the lookahead the interpolator emits the
   * whole window on either build; past the clip's end those frames continue
   * the motion where the macOS render holds its last, a difference of a few
   * frames at the tail of a smooth clip only. The `tpad` stays for the
   * builds that do flush, so a clip that simply runs out is held.
   */
  const smooth = Boolean(clip.smoothSlow) && (clip.speed ?? 1) < 1
  const sourceFrames = sourceFramesFor(clip) + (smooth ? 8 : 0)
  const hold = `tpad=stop_mode=clone:stop_duration=${seconds(count, fps)},`
  /*
   * The crop right after the retime, ahead of the hold, the trim and the
   * `setpts` — the render's own order (plan.ts: retime, then crop). Its `t`
   * is then the clip's own time on the project's grid, frame n at n/fps, as
   * the render's followed crop sees it; after the trim `t` started again at
   * the window, and a followed crop's keys, compiled from the clip's first
   * frame, put the clip's opening crop on a window near its end (§4.7). A
   * static crop cuts the same pixels either side of the trim.
   */
  return [
    '-ss', seconds(req.inPoint, fps), '-t', seconds(sourceFrames, fps), '-i', req.path,
    '-vf', `${retime},${cut ? `${cut},` : ''}${hold}trim=start_frame=${req.first}:end_frame=${req.first + count},setpts=PTS-STARTPTS,${finish}`,
    '-frames:v', String(count), '-start_number', '0', pattern
  ]
}

/**
 * A followed crop's keys on the pulled frames [from, to) only (reframe/
 * expression.ts `windowSum`): the same crop on each of them, in a -vf of a
 * few hundred characters whatever the clip's length. A 20-minute clip with a
 * cut every 4 s put 45,989 characters of keys on the command line, and
 * Windows refuses a command line past 32,767 (`spawn ENAMETOOLONG`,
 * EFFECTS.md §47); the render's graph goes in a file, this does not.
 */
function windowFollow(follow: CropFollow | null, from: number, to: number, fps: number): CropFollow | null {
  if (!follow) return null
  const win = (sum: FlatSum): FlatSum => windowSum(sum, from, to, { fps, startSeconds: 0 })
  const half = (h: { x: FlatSum; y: FlatSum }): { x: FlatSum; y: FlatSum } => ({ x: win(h.x), y: win(h.y) })
  return {
    crop: follow.crop,
    ...(follow.cropX ? { cropX: win(follow.cropX) } : {}),
    ...(follow.cropY ? { cropY: win(follow.cropY) } : {}),
    ...(follow.halves ? { halves: { top: half(follow.halves.top), bottom: half(follow.halves.bottom) } } : {})
  }
}

/** A request's followed crop, for `cropFilter`; null for a crop that does not follow. */
function footageFollow(req: FootageRequest): CropFollow | null {
  if (!req.crop || (!req.cropX && !req.cropY && !req.halves)) return null
  return {
    crop: req.crop,
    ...(req.cropX ? { cropX: req.cropX } : {}),
    ...(req.cropY ? { cropY: req.cropY } : {}),
    ...(req.halves ? { halves: req.halves } : {})
  }
}

/**
 * What a moment's request carries of a clip's crop: its stored `crop`, or for
 * a followed clip the crop `followKeys` compiles — its size, and the keys the
 * render cuts with (both halves' on a stacked two-up) — so the pull is the
 * render's own frame beneath. momentTextures.ts spreads this into the
 * `FootageRequest` it builds.
 */
export function followedFootage(
  project: Project,
  clip: Clip,
  fps: number
): Pick<FootageRequest, 'crop' | 'cropX' | 'cropY' | 'halves'> {
  const asset = assetById(project, clip.assetId)
  const follow = asset?.kind === 'video' ? followKeys(project, clip, fps) : null
  if (!follow) return clip.crop ? { crop: clip.crop } : {}
  return {
    crop: follow.crop,
    ...(follow.cropX ? { cropX: follow.cropX } : {}),
    ...(follow.cropY ? { cropY: follow.cropY } : {}),
    ...(follow.halves ? { halves: follow.halves } : {})
  }
}

/**
 * How the frames are pulled; bumped when the arguments change, so folders an
 * older pull left are never mistaken for these. 6: the crop moved ahead of
 * the trim, and a followed crop's keys.
 */
export const PULL_VERSION = 6

/** The name the pulled frames are kept under: the same file, the same frames, the same cut — the same folder. */
export function momentFramesKey(req: FootageRequest, file: { size: number; mtimeMs: number }): string {
  return JSON.stringify({
    pull: PULL_VERSION,
    path: req.path, size: file.size, mtime: Math.round(file.mtimeMs), inPoint: req.inPoint, duration: req.duration, speed: req.speed ?? 1, ramp: req.ramp ?? null,
    smooth: req.smoothSlow ?? false, hold: req.hold ?? false, first: req.first, count: req.count, fps: req.fps, crop: req.crop ?? null, max: req.maxEdge,
    // A re-solve moves the keys and not the size: a pull named without them would be reused stale.
    cropX: req.cropX ?? null, cropY: req.cropY ?? null, halves: req.halves ?? null
  })
}
