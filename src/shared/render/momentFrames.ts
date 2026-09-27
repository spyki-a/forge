import { framesToSeconds, type Clip } from '../timeline'
import { cropFilter, retimeFilter } from './plan'
import { clipRamp, clipSpeed, sourceFramesFor } from './speed'
import type { FootageRequest } from './moment'

/**
 * The pre-pass for a moment over footage (docs/PLAN.md §7.2): the shot's
 * frames under the moment, pulled from the file by ffmpeg into numbered PNGs,
 * through the SAME chain the render plays the clip with — decoded from the
 * in-point as `videoInputArgs` does, the clip's retime (`retimeFilter`: the
 * ramp's `setpts` curve, or the constant speed's `setpts` and `fps`; at
 * speed 1 the render's own `fps` step, which resamples 24p and 60p footage to
 * the project's rate), the window trimmed out of the retimed stream, then the
 * render's `cropFilter` in the file's pixels and a cap on the long edge
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
 * size: the probe records a phone clip's coded size and ffmpeg decodes it
 * turned, so a cap sized from the probe squeezed a portrait clip into a
 * landscape box at half its resolution (measured). Even, for the encoder.
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
  const cut = cropFilter(clip, req.size)
  const finish = [cut, footageCapFilter(req.maxEdge), 'format=rgba'].filter((f): f is string => f !== null).join(',')
  const count = Math.max(1, req.count)

  if (req.hold) {
    return ['-ss', seconds(req.inPoint, fps), '-i', req.path, '-vf', `trim=end_frame=1,setpts=PTS-STARTPTS,${finish}`, '-frames:v', '1', '-start_number', '0', pattern]
  }

  const ramp = clipRamp(clip)
  const speed = clipSpeed(clip)
  const smooth = Boolean(clip.smoothSlow) && speed < 1
  // The render's own retime, or at speed 1 the render's own fps step (plan.ts applies `fps=` to every clip).
  const retime = retimeFilter(clip, fps) ?? `fps=${fps}`
  const sourceFrames = ramp || smooth ? sourceFramesFor(clip) : Math.ceil((req.first + count) * speed) + 2
  // The tail held, as the render holds an interpolated clip's last frame beyond its input.
  const hold = smooth ? `tpad=stop_mode=clone:stop_duration=${seconds(count, fps)},` : ''
  return [
    '-ss', seconds(req.inPoint, fps), '-t', seconds(sourceFrames, fps), '-i', req.path,
    '-vf', `${retime},${hold}trim=start_frame=${req.first}:end_frame=${req.first + count},setpts=PTS-STARTPTS,${finish}`,
    '-frames:v', String(count), '-start_number', '0', pattern
  ]
}

/** How the frames are pulled; bumped when the arguments change, so folders an older pull left are never mistaken for these. */
export const PULL_VERSION = 3

/** The name the pulled frames are kept under: the same file, the same frames, the same cut — the same folder. */
export function momentFramesKey(req: FootageRequest, file: { size: number; mtimeMs: number }): string {
  return JSON.stringify({
    pull: PULL_VERSION,
    path: req.path, size: file.size, mtime: Math.round(file.mtimeMs), inPoint: req.inPoint, duration: req.ramp || req.smoothSlow ? req.duration : 0, speed: req.speed ?? 1, ramp: req.ramp ?? null,
    smooth: req.smoothSlow ?? false, hold: req.hold ?? false, first: req.first, count: req.count, fps: req.fps, crop: req.crop ?? null, max: req.maxEdge
  })
}
