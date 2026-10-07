import type { CaptionLayer, GraphicsSpec } from '../graphics/spec'
import { animationFrames, piecesOf, textAnimationById } from '../render/textAnimation'

/**
 * Planning a caption bake.
 *
 * Styled captions cannot be burned in by libass, so they have to be drawn. The
 * question this answers is how to draw as LITTLE as possible.
 *
 * Two observations do nearly all the work:
 *
 *  - A caption is mostly STILL. Between one word lighting up and the next, every
 *    frame is the same picture. Drawing them all is drawing one picture eighty
 *    times, so the run is baked once and held.
 *
 *  - A caption occupies a BAND, not a frame. Everything above it never changes,
 *    and compositing it is the single biggest cost in the render — measured at
 *    1080x1920, a full-frame overlay costs 3.4s per ten seconds of video against
 *    0.86s for a band, and a full-frame PNG costs 13.8ms to encode against 3.8ms.
 *
 * The result is a list of distinct pictures and a run-length timeline over them,
 * which the renderer draws and ffmpeg replays through the concat demuxer as one
 * more overlay in the ordinary single-pass graph. No second encode, and no
 * offscreen browser being screenshotted once per frame.
 */

/** One distinct picture. `layer` of -1 is the blank — no caption on screen. */
export interface CaptionPicture {
  layer: number
  /** Which word is lit, or -1. */
  word: number
  /**
   * Frames since the line appeared, for the animation.
   *
   * Clamped to the point the movement finishes: every frame after that is the
   * same picture, and collapsing them is most of the saving on a static style.
   */
  since: number
}

export interface CaptionBakePlan {
  /** Distinct pictures to draw, in first-appearance order. */
  pictures: CaptionPicture[]
  /** Run-length over the whole timeline: which picture, for how many frames. */
  runs: { picture: number; frames: number }[]
  /** Frames the bake covers. */
  totalFrames: number
}

/** Which word of a line is lit at a timeline frame. */
export function activeWordOf(layer: CaptionLayer, frame: number): number {
  let active = -1
  for (let i = 0; i < layer.wordFrames.length; i++) {
    if (frame >= layer.wordFrames[i]) active = i
  }
  return active
}

/**
 * How many frames of a line actually move.
 *
 * After this the animation has settled and only the highlight changes, so
 * `since` can be pinned and the pictures collapse.
 */
function movingFrames(layer: CaptionLayer, fps: number): number {
  const animation = textAnimationById(layer.spec.animationId)
  if (!animation) return 0
  const pieces = layer.spec.content
    .split('\n')
    .reduce((most, line) => Math.max(most, piecesOf(line, animation.scope).length), 1)
  return animationFrames(animation, fps, pieces)
}

/**
 * Work out what has to be drawn for a timeline of caption lines.
 *
 * Pure, so the saving it claims can be asserted rather than hoped for.
 */
export function planCaptionBake(
  layers: CaptionLayer[],
  fps: number,
  totalFrames: number
): CaptionBakePlan | null {
  if (layers.length === 0 || totalFrames <= 0) return null

  const moving = layers.map((layer) => movingFrames(layer, fps))

  const pictures: CaptionPicture[] = []
  const index = new Map<string, number>()
  const runs: { picture: number; frames: number }[] = []

  const pictureFor = (layer: number, word: number, since: number): number => {
    const key = `${layer}:${word}:${since}`
    const existing = index.get(key)
    if (existing !== undefined) return existing
    const id = pictures.length
    pictures.push({ layer, word, since })
    index.set(key, id)
    return id
  }

  /** The blank, reused for every gap between lines. */
  const blank = pictureFor(-1, -1, 0)

  for (let frame = 0; frame < totalFrames; frame++) {
    // The last line to have started wins, so lines that abut do not flicker.
    let chosen = -1
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      if (frame >= layer.startFrame && frame < layer.endFrame) chosen = i
    }

    let picture = blank
    if (chosen >= 0) {
      const layer = layers[chosen]
      const since = Math.min(frame - layer.startFrame, moving[chosen])
      picture = pictureFor(chosen, activeWordOf(layer, frame), since)
    }

    const last = runs[runs.length - 1]
    if (last && last.picture === picture) last.frames += 1
    else runs.push({ picture, frames: 1 })
  }

  return { pictures, runs, totalFrames }
}

/** What an export bakes: a spec's caption lines, and the plan over them. */
export interface CaptionBake {
  /** The caption lines, in the order the plan's `picture.layer` indexes. */
  layers: CaptionLayer[]
  plan: CaptionBakePlan
}

/**
 * The bake for an export: a spec's caption lines, planned over the WHOLE spec.
 *
 * Over `spec.durationFrames`, which is the edit's end, and never over the last
 * line's. The bake is overlaid with `shortest=1`, so a bake that stopped with
 * the speech stopped the export there (EFFECTS.md §43).
 *
 * One function, because the renderer's `bakeCaptions` cannot run outside a DOM
 * canvas: the render checks stand in for its painting and call THIS, so the
 * length they guard is the length the app bakes, not a copy of the expression.
 */
export function planBakeOf(spec: GraphicsSpec): CaptionBake | null {
  const layers = spec.layers.filter((l): l is CaptionLayer => l.kind === 'caption')
  const plan = planCaptionBake(layers, spec.fps, spec.durationFrames)
  return plan ? { layers, plan } : null
}

/**
 * The clock the concat list is written on: one frame of the bake per tick of
 * 1/25 s, whatever the project's rate.
 *
 * Because 1/25 s is the only clock the demuxer can time a picture on. The
 * concat input's stream is the first PNG's, read by image2 at its default
 * `framerate` of 25, so its time base is 1/25 s, and the demuxer rescales every
 * entry's start into it, to the NEAREST tick (concatdec.c, `delta =
 * av_rescale_q(start_time, AV_TIME_BASE_Q, <the file's time base>)`). On the
 * project's own clock a 30 fps frame is 5/6 of a tick: six frames shared five
 * ticks, and one picture in six never reached the export (EFFECTS.md §42). The
 * demuxer cannot be told another rate on the 2018 Windows build: it opens each
 * file with no options, `-framerate` before `-f concat` is a fatal "Option
 * framerate not found", and the list's `duration` takes no fractions (§44).
 *
 * So the list gives each frame one whole tick, which every start lands on
 * exactly, and the overlay scales that clock back to the project's
 * (`setpts=PTS*CONCAT_RATE/fps` in buildRenderPlan, after `settb=AVTB` so the
 * scaled times are not rounded to ticks again). Both sides read this constant.
 */
export const CONCAT_RATE = 25

/**
 * A path the concat demuxer will read back as the path it was given.
 *
 * Two things bite here, and both of them bite only on Windows — which is
 * exactly why they are worth writing down rather than discovering on someone
 * else's laptop.
 *
 * Backslash is an ESCAPE character to the demuxer, inside quotes as much as
 * out. `file 'C:\Users\spyker\00001.png'` therefore does not name that file: it
 * names one with a tab in it, because `\U` and the rest are consumed on the way
 * through. ffmpeg accepts forward slashes on Windows everywhere, so the path is
 * simply written with them.
 *
 * A single quote inside the path would close the quoting early. The demuxer's
 * own convention for one is to end the quote, emit an escaped quote, and start
 * again — the same `'\''` shell users know.
 */
export function concatPath(path: string): string {
  const forward = path.replace(/\\/g, '/')
  return `'${forward.split("'").join("'\\''")}'`
}

/**
 * The concat demuxer list for a bake, on the bake's own clock (`CONCAT_RATE`).
 *
 * `duration` after each entry is how long that picture holds, which is what
 * turns eighty identical frames into one file: `run.frames` ticks of 1/25 s, a
 * multiple of 0.04 that six decimals write exactly, so every run starts on its
 * own tick — frame N of the bake at tick N. No frame rate goes in: the list is
 * the same at every rate, and the overlay scales it to the project's.
 *
 * The final entry is repeated with no duration because the demuxer ignores the
 * last one it is given — a known quirk, and without the repeat the closing run
 * is dropped. The repeat starts at the bake's end and holds its own one tick.
 * On the Mac's build the overlay turns that into exactly one frame past the
 * edit's end (measured at every rate). On the 2018 Windows build, by its source
 * and not run, `setpts` passes the end of stream on unscaled, so the repeat
 * comes out as none or several frames (none at 24 fps for most edits, more than
 * one at 30 and 60; §44's floor paragraph). Either way it is past the edit,
 * where `shortest=1` ends the export at the video's last frame (§43, §44).
 */
export function concatList(plan: CaptionBakePlan, fileFor: (picture: number) => string): string {
  const lines: string[] = []
  for (const run of plan.runs) {
    lines.push(`file ${concatPath(fileFor(run.picture))}`)
    lines.push(`duration ${(run.frames / CONCAT_RATE).toFixed(6)}`)
  }
  const last = plan.runs[plan.runs.length - 1]
  if (last) lines.push(`file ${concatPath(fileFor(last.picture))}`)
  return `${lines.join('\n')}\n`
}
