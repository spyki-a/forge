/**
 * The depth option's numbers and its verdict (docs/CLIPS.md §6.11's options
 * table, the `parity` row's phase-3 half "each 2.5D variant's settled frame
 * against its flat twin"; §6.12's phase-3 bars; §6.16 "The 2.5D variants of
 * `counter` and `ring`" and "What glows"; phase 3's piece 3): pure, so node's
 * tests read the bars without a browser. The drawing that produces the
 * readings is `depthCheck.ts`.
 */

import { COMPOSITOR_BAR, type ChannelDiff } from './compositorMeasure'
import { chebyshevDistance } from './glowMeasure'

/**
 * The bars. `settledMax` is §6.12's M6 for a 2.5D variant: its settled frame
 * against its flat twin, 0, by route one (the frame is painter A's own). The
 * hero under a glowing style is route two at rest (the glow persists), so its
 * base under the glow (the glow left out, `CompositorProbe`) is held to route
 * two's bars, `COMPOSITOR_BAR`'s colour within 2 and the 1:1 texture's mean
 * printing 0.000; beyond the glow's reach from the glowing item's own ink the
 * glow adds no alpha, 0 (M7's bar, read as the frame with the glow against
 * the frame without it, `glowBeyondReach`: a style that dims fills the whole
 * frame, so alpha beyond the reach of ALL the ink reads no pixel there), and
 * the colour there stays within route two's own bar (`outsideColourMax`: the
 * two frames leave the compositor by different passes, and on the Mac the
 * rest of the graphic's translucent ink read 1 level apart on colour with
 * alpha equal, up to 167 px from the item, where no glow of 11 px reaches);
 * and the glow is present, the frame with it differing from the frame
 * without it by at least `glowMinMax` levels somewhere.
 *
 * `firstMinMax` is NOT §6.12's: the fixer's guard that a dead depth branch
 * cannot pass. The first frame with ink must differ from its flat twin's by
 * at least this many levels somewhere (a 24° tilt, a −8° yaw, a dolly back
 * of 0.12 or a 10 px blur on the label each moves edges by whole pixels, so
 * by far more; proposal).
 */
export const DEPTH_BAR = Object.freeze({
  settledMax: 0,
  heroBaseMax: COMPOSITOR_BAR.colourMax,
  heroBaseMean: COMPOSITOR_BAR.textureMean,
  outsideReachMax: 0,
  outsideColourMax: COMPOSITOR_BAR.colourMax,
  glowMinMax: 1,
  firstMinMax: 8
})

/** One case: a template's fixture with one depth under one style, or its hero under a glowing style. */
export interface DepthCaseReading {
  /** The fixture's id (specs.json). */
  fixture: string
  template: 'counter' | 'ring'
  /** The move, or `hero` (depth `tilt` and `hero`, under a style with glow). */
  variant: 'tilt' | 'parallax' | 'dolly' | 'focus' | 'hero'
  style: string
  /** The frames the bake draws (`graphicMovingFrames`), and how many of them have a camera off flat. */
  moving: number
  movingCamera: number
  /** The last moving frame's camera (the list's), every field exactly 0 at rest; `focusPx` 0 when it has no focus. */
  lastCamera: { tilt: number; yaw: number; dolly: number; focusPx: number } | null
  /** The last moving frame through `paintDrawList3d` against the flat twin's by painter A (for the hero, with its glow left out). */
  settled: ChannelDiff
  /** The first frame where the flat twin has ink, and that frame against the twin's. */
  firstFrame: number
  first: ChannelDiff
  /** The hero only: its glow at rest. */
  glow?: {
    /** The request's radius in frame px, and the reach read (rounded). */
    radius: number
    reach: number
    /** Beyond the reach from the glowing item's own ink, with against without (`glowBeyondReach`): the most alpha the glow adds, the largest colour difference, and over how many pixels. */
    outsideReach: number
    outsideColour: number
    outsidePixels: number
    /** The settled frame with its glow against the same frame with the glow left out. */
    present: ChannelDiff
  }
}

/** The bars, read: every failure named. Every variant of both templates must have been read, and the hero of each. */
export function depthVerdict(readings: readonly DepthCaseReading[]): { pass: boolean; failures: string[] } {
  const failures: string[] = []
  const B = DEPTH_BAR
  for (const r of readings) {
    const name = `${r.fixture} ${r.variant} under ${r.style}`
    if (r.lastCamera === null) failures.push(`${name}: the last moving frame carries no camera (the depth was not honoured)`)
    else {
      const c = r.lastCamera
      for (const [field, value] of [['tilt', c.tilt], ['yaw', c.yaw], ['dolly', c.dolly], ['focus px', c.focusPx]] as const) {
        if (!Object.is(value, 0)) failures.push(`${name}: the last moving frame's ${field} is ${value}, not exactly 0`)
      }
    }
    if (r.movingCamera === 0) failures.push(`${name}: no frame has a camera off flat (a dead branch)`)
    if (r.movingCamera >= r.moving) failures.push(`${name}: every frame moves, so the held frame is not the flat graphic's`)
    if (!(r.first.maxAll >= B.firstMinMax)) failures.push(`${name}: frame ${r.firstFrame} differs from its flat twin by at most ${r.first.maxAll} < ${B.firstMinMax} (a dead branch draws the twin)`)
    if (r.variant === 'hero') {
      if (r.settled.maxAll > B.heroBaseMax) failures.push(`${name}: the base under the glow at rest, max ${r.settled.maxAll} > ${B.heroBaseMax}`)
      if (!(r.settled.meanAll < B.heroBaseMean)) failures.push(`${name}: the base under the glow at rest, mean ${r.settled.meanAll.toFixed(4)}, not 0.000`)
      if (!r.glow) failures.push(`${name}: the glow was not read`)
      else {
        if (r.glow.outsidePixels === 0) failures.push(`${name}: no pixel beyond the glow's reach was read`)
        if (r.glow.outsideReach > B.outsideReachMax) failures.push(`${name}: the glow adds alpha ${r.glow.outsideReach} beyond its ${r.glow.reach} px reach`)
        if (r.glow.outsideColour > B.outsideColourMax) failures.push(`${name}: colour off by ${r.glow.outsideColour} > ${B.outsideColourMax} beyond the glow's ${r.glow.reach} px reach`)
        if (!(r.glow.present.maxAll >= B.glowMinMax)) failures.push(`${name}: no glow: the frame with it equals the frame without it`)
      }
    } else if (r.settled.maxAll > B.settledMax) failures.push(`${name}: the settled frame differs from its flat twin, max ${r.settled.maxAll} (route one must equal it)`)
  }
  for (const template of ['counter', 'ring'] as const) {
    for (const variant of ['tilt', 'parallax', 'dolly', 'focus', 'hero'] as const) {
      if (!readings.some((r) => r.template === template && r.variant === variant)) failures.push(`${template} ${variant} was not read`)
    }
  }
  return { pass: failures.length === 0, failures }
}

/**
 * The hero's glow against its reach: `ink` is the glowing item painted alone
 * by painter A (what the glow canvas holds), `withGlow` and `withoutGlow` the
 * settled frame through the compositor with its glow and with the glow left
 * out, all straight RGBA of `width` × `height`. Beyond the reach (chessboard
 * distance from the item's ink above the radius, rounded: the kernel is cut
 * there) the glow adds nothing: `outsideReach` is the largest difference of
 * alpha there (M7's bar, 0), `outsideColour` the largest of a colour channel
 * (the two frames leave by different passes, so the rest of the graphic's
 * ink may round a level apart), `outsidePixels` how many pixels that is.
 * Read on the difference, not on alpha itself, because the rest of the
 * graphic is drawn there too, and under a style that dims, over the whole
 * frame.
 */
export function glowBeyondReach(
  ink: ArrayLike<number>,
  withGlow: ArrayLike<number>,
  withoutGlow: ArrayLike<number>,
  width: number,
  height: number,
  radius: number
): { reach: number; outsideReach: number; outsideColour: number; outsidePixels: number } {
  if (ink.length !== width * height * 4 || withGlow.length !== ink.length || withoutGlow.length !== ink.length) throw new Error('glowBeyondReach: pictures of different sizes')
  const reach = Math.round(radius)
  const distance = chebyshevDistance(ink, width, height)
  let outsideReach = 0
  let outsideColour = 0
  let outsidePixels = 0
  for (let p = 0; p < width * height; p++) {
    if (!(distance[p] > reach)) continue
    outsidePixels++
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(withGlow[p * 4 + c] - withoutGlow[p * 4 + c])
      if (c === 3) outsideReach = Math.max(outsideReach, d)
      else outsideColour = Math.max(outsideColour, d)
    }
  }
  return { reach, outsideReach, outsideColour, outsidePixels }
}

/** Frames per contact sheet (the depth option's). */
export const DEPTH_SHEET_FRAMES = 8

/**
 * The frames a case's contact sheet shows: where the move can be seen. The
 * camera shares the entrance's curve, so under the expo-out styles nearly
 * all of the move is over in the first three or four frames with ink (frame
 * 0 has none: the entrance's opacity is 0), and frames spread evenly over the
 * moving ones would show it only on a frame with no ink and then at rest.
 * So: every frame from the first with ink, consecutively, as many as the
 * sheet holds less two; then the last frame off flat; then the first flat
 * one after it (the settle). `offFlat[f]` is frame f's camera off flat (a
 * blur above 0 counts); `firstInk` is −1 when the twin never has ink.
 */
export function depthSheetFrames(firstInk: number, offFlat: readonly boolean[], count = DEPTH_SHEET_FRAMES): number[] {
  if (offFlat.length === 0) return []
  const start = Math.min(Math.max(0, firstInk), offFlat.length - 1)
  const lastOff = offFlat.lastIndexOf(true)
  const frames = new Set<number>()
  const end = Math.max(start, Math.min(lastOff, start + Math.max(1, count - 2) - 1))
  for (let f = start; f <= end && frames.size < Math.max(1, count - 2); f++) frames.add(f)
  if (lastOff >= start) frames.add(lastOff)
  if (lastOff + 1 < offFlat.length && lastOff + 1 >= start) frames.add(lastOff + 1)
  return [...frames].sort((a, b) => a - b).slice(0, count)
}
