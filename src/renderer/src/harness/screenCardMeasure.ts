/**
 * The screen card option's numbers and its verdict (docs/CLIPS.md §6.16, "The
 * screen card" and "The hand-off"; §6.12's phase-3 exit "its hand-off within
 * 2/255"; phase 3's piece 4): pure, so node's tests read the bars without a
 * browser. The drawing that produces the readings is `screenCardCheck.ts`.
 *
 * What is read here is the hand-off's OWN side: the card's landing frame `L`
 * through `paintDrawList3d` against a plain `drawImage` of the same frame into
 * the card's box, and the frame after it, whose dim has its hole on the box.
 * The true hand-off, the card's frame `L` against the render's frame of the
 * recording beneath, is M20 in graphic.int (§6.11, piece 6).
 */

import type { ChannelDiff, Region } from './compositorMeasure'

/**
 * The bars.
 * - `handoffMean`: §6.16's "within 2/255 mean (proposal)", here on the
 *   card's side alone, inside the box less the bezel. Expected 0.000: at `L`
 *   the list is route one's, painter A, whose `drawImage` of a `cover` image
 *   whose shape is the box's is the plain `drawImage`, call for call.
 * - `holeInsideMax`: the frame after `L`, alpha inside the box less the
 *   bezel: 0, the hole.
 * - `dimOff`: the same frame's alpha outside the box and its bezel, within
 *   this many levels of the dim's (`palette.dimOpacity` × 255, rounded).
 * - `tiltFirstOpacityMax`: Tilt in starts at opacity 0 (`progress`' 1e-6 s
 *   allowance and the style's curve leave a hair of it).
 * - `moveMinMax`: an early frame against `L` differs by at least this many
 *   levels somewhere, so a dead move cannot pass (the depth option's guard).
 * - `flatScaleOff`: Pull back drawn flat (WebGL missing, painter A) at frame
 *   0: its ink's height over the box's within this of 1.35, the bezel's
 *   width scaled with it included.
 * - `flatCentreOff`: the same, on a box moved off the frame's centre
 *   (`SCREEN_CARD_LOW_BOX_PX` down): its ink's middle row within this many
 *   pixels of the box's own middle, so a scale about the frame's centre rather
 *   than the card's cannot pass (the critics' fix to piece 4; the stand-in's
 *   box is centred, where the two agree).
 */
export const SCREEN_CARD_BAR = Object.freeze({
  handoffMean: 2,
  holeInsideMax: 0,
  dimOff: 1,
  tiltFirstOpacityMax: 0.001,
  moveMinMax: 8,
  flatScaleOff: 0.03,
  flatCentreOff: 1
})

/** How far below the frame's centre the off-centre box of the `flatCentreOff` reading sits, in frame pixels (540 × 960). */
export const SCREEN_CARD_LOW_BOX_PX = 240

export interface ScreenCardReading {
  move: 'tilt-in' | 'pull-back'
  style: string
  /** The landing frame (`landingFrame`), the bake's moving frames (`graphicMovingFrames`), and how many of those carry a camera off flat. */
  landing: number
  moving: number
  movingCamera: number
  /** The landing frame's camera, each field exactly 0, or null when it has none. */
  cameraAtL: { tilt: number; yaw: number; dolly: number } | null
  /** Whether any frame after `L` carries a camera at all (none must). */
  cameraAfter: boolean
  /** The card's items' opacity on frame 0 (the least of them). */
  firstOpacity: number
  /** Frame `L` against a plain `drawImage` of the stand-in's frame `L` into the box, inside the box less the bezel. */
  handoff: ChannelDiff
  /** Frame `L + 1`: the largest alpha inside the box less the bezel; the least and largest outside the box and its bezel; the dim's alpha expected. */
  holeInside: number
  holeOutside: { min: number; max: number }
  dimAlpha: number
  /** An early frame (`SCREEN_CARD_MOVE_FRAME`) against `L`, the whole frame. */
  early: ChannelDiff
  /** Pull back only: frame 0 by painter A (WebGL missing), its ink's height over the box's. Null for Tilt in. */
  flatScale: number | null
  /** Pull back only: frame 0 by painter A on the off-centre box, how far its ink's middle row is from the box's middle, in pixels. Null for Tilt in. */
  flatCentreOff: number | null
}

/** The early frame read against the landing: one where the move is plainly under way under every style's curve. */
export const SCREEN_CARD_MOVE_FRAME = 3

/** The bars, read: every failure named; both moves must have been read. */
export function screenCardVerdict(readings: readonly ScreenCardReading[]): { pass: boolean; failures: string[] } {
  const B = SCREEN_CARD_BAR
  const failures: string[] = []
  for (const r of readings) {
    const name = `${r.move} under ${r.style}`
    if (r.cameraAtL === null) failures.push(`${name}: the landing frame carries no camera`)
    else for (const [field, value] of Object.entries(r.cameraAtL)) if (!Object.is(value, 0)) failures.push(`${name}: the landing frame's ${field} is ${value}, not exactly 0`)
    if (r.cameraAfter) failures.push(`${name}: a frame after the landing carries a camera (the held frame must be route one's)`)
    if (r.movingCamera === 0) failures.push(`${name}: no frame has a camera off flat (a dead move)`)
    if (r.movingCamera >= r.moving) failures.push(`${name}: every moving frame is off flat`)
    if (!(r.handoff.meanAll <= B.handoffMean)) failures.push(`${name}: the landing frame against a plain drawImage, mean ${r.handoff.meanAll.toFixed(3)} > ${B.handoffMean}`)
    if (r.handoff.pixels === 0) failures.push(`${name}: the hand-off read no pixel`)
    if (r.holeInside > B.holeInsideMax) failures.push(`${name}: alpha ${r.holeInside} inside the hole after the landing`)
    if (Math.abs(r.holeOutside.min - r.dimAlpha) > B.dimOff || Math.abs(r.holeOutside.max - r.dimAlpha) > B.dimOff) {
      failures.push(`${name}: the dim outside the box reads ${r.holeOutside.min}..${r.holeOutside.max}, not ${r.dimAlpha}`)
    }
    if (r.move === 'tilt-in' && !(r.firstOpacity <= B.tiltFirstOpacityMax)) failures.push(`${name}: frame 0's card opacity ${r.firstOpacity}, not 0`)
    if (r.move === 'pull-back' && r.firstOpacity !== 1) failures.push(`${name}: frame 0's card opacity ${r.firstOpacity}, not 1`)
    if (!(r.early.maxAll >= B.moveMinMax)) failures.push(`${name}: frame ${SCREEN_CARD_MOVE_FRAME} differs from the landing by at most ${r.early.maxAll} < ${B.moveMinMax} (a dead move)`)
    if (r.move === 'pull-back') {
      if (r.flatScale === null || !(Math.abs(r.flatScale - 1.35) <= B.flatScaleOff)) failures.push(`${name}: drawn flat, frame 0's ink is ${r.flatScale?.toFixed(3) ?? 'none'} × the box's height, not 1.35`)
      if (r.flatCentreOff === null || !(r.flatCentreOff <= B.flatCentreOff)) failures.push(`${name}: drawn flat on a box off the frame's centre, frame 0's ink is centred ${r.flatCentreOff?.toFixed(1) ?? 'nowhere'} px from the box's, not about the card's own centre`)
    }
  }
  for (const move of ['tilt-in', 'pull-back'] as const) if (!readings.some((r) => r.move === move)) failures.push(`${move} was not read`)
  return { pass: failures.length === 0, failures }
}

/**
 * A box shrunk by `by` pixels on each side, then to the whole pixels wholly
 * inside it (`inset`), or grown by `by` and to the whole pixels it touches
 * (`outset`, clamped to the frame). The regions the hole is read on.
 */
export function wholeRegion(box: { x: number; y: number; width: number; height: number }, by: number, how: 'inset' | 'outset', size: { width: number; height: number }): Region {
  if (how === 'inset') {
    const x0 = Math.ceil(box.x + by)
    const y0 = Math.ceil(box.y + by)
    const x1 = Math.floor(box.x + box.width - by)
    const y1 = Math.floor(box.y + box.height - by)
    return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }
  }
  const x0 = Math.max(0, Math.floor(box.x - by))
  const y0 = Math.max(0, Math.floor(box.y - by))
  const x1 = Math.min(size.width, Math.ceil(box.x + box.width + by))
  const y1 = Math.min(size.height, Math.ceil(box.y + box.height + by))
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }
}

/** The largest alpha inside `rect` of an RGBA picture `width` wide. */
export function alphaMaxIn(pixels: ArrayLike<number>, width: number, rect: Region): number {
  let max = 0
  for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) max = Math.max(max, pixels[(y * width + x) * 4 + 3])
  return max
}

/** The least and largest alpha of every pixel OUTSIDE `rect`; null when there is none. */
export function alphaOutside(pixels: ArrayLike<number>, width: number, height: number, rect: Region): { min: number; max: number } | null {
  let min = 255
  let max = 0
  let seen = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) continue
      const a = pixels[(y * width + x) * 4 + 3]
      min = Math.min(min, a)
      max = Math.max(max, a)
      seen += 1
    }
  }
  return seen > 0 ? { min, max } : null
}

/** The rows a picture has any alpha in: its ink's top and height, null when it has none. */
export function inkRows(pixels: ArrayLike<number>, width: number, height: number): { top: number; height: number } | null {
  let top = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue
      if (top < 0) top = y
      bottom = y
      break
    }
  }
  return top < 0 ? null : { top, height: bottom - top + 1 }
}

/** The frames a move's contact sheet shows: the start, the move under way, the landing and the frame after it, within the moving frames. */
export function screenCardSheetFrames(landing: number, moving: number): number[] {
  const wanted = [0, 1, 2, 4, 6, Math.round(landing / 3), Math.round(landing / 2), landing - 1, landing, landing + 1]
  return [...new Set(wanted.filter((f) => f >= 0 && f < moving))].sort((a, b) => a - b)
}
