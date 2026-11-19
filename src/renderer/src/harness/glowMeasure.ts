/**
 * The `glow` (M7) and `focus` options' numbers and verdicts (docs/CLIPS.md
 * §6.11's options table, §6.15's M7, §6.16 "Glow" and "Shaders"; phase 3's
 * piece 2): pure, so node's tests read the bars without a browser. The
 * drawing that produces the readings is `glowCheck.ts`.
 */

import { COMPOSITOR_BAR, type ChannelDiff } from './compositorMeasure'

/**
 * M7's bars, as §6.15 and §6.16 word them: on each route, alpha exactly 0
 * beyond the glow's reach (the request's radius from the shape's ink), the
 * glow's alpha below 1 (255) wherever the shape is not, and some glow drawn;
 * the base under the glow (the frame with the glow left out) against painter
 * A at the 1:1 texture's bar, 0.000 (`COMPOSITOR_BAR.textureMean`), within
 * `COMPOSITOR_BAR.colourMax`; and the shared renderer's `info.memory` back to
 * its counts after `dispose`.
 */
export const GLOW_BAR = Object.freeze({
  outsideReachMax: 0,
  glowAlphaBelow: 255,
  baseMax: COMPOSITOR_BAR.colourMax,
  baseMean: COMPOSITOR_BAR.textureMean
})

/**
 * The focus check's bars: a plane at radius 0 against painter A at route
 * three's own bars (`COMPOSITOR_BAR`: within 2, mean 0.000), since radius 0
 * returns the texel itself; a plane at a radius above 0 visibly blurred, the
 * largest difference from painter A over the detail at least
 * `blurredMinMax` levels (proposal: a sharp stripe edge softened by a 10 px
 * disc moves by far more); and alpha at the frame's edge kept, every border
 * pixel of a plane that fills the frame at 255 (`edgeAlpha`).
 */
export const FOCUS_BAR = Object.freeze({
  sharpMax: COMPOSITOR_BAR.colourMax,
  sharpMean: COMPOSITOR_BAR.textureMean,
  blurredMinMax: 24,
  edgeAlpha: 255
})

/**
 * Each pixel's chessboard (Chebyshev) distance to the nearest pixel of ink
 * (alpha above 0 in `rgba`): 0 on ink, `Infinity` with no ink at all. Two
 * passes of the 3×3 chamfer with every weight 1, which is exact for this
 * metric. It is the reach of a separable blur: a kernel cut at `r` each way
 * reads only pixels within chessboard distance `r`.
 */
export function chebyshevDistance(rgba: ArrayLike<number>, width: number, height: number): Float64Array {
  const d = new Float64Array(width * height)
  for (let p = 0; p < width * height; p++) d[p] = rgba[p * 4 + 3] > 0 ? 0 : Infinity
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= width || y >= height ? Infinity : d[y * width + x])
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (d[p] === 0) continue
      d[p] = Math.min(d[p], at(x - 1, y) + 1, at(x - 1, y - 1) + 1, at(x, y - 1) + 1, at(x + 1, y - 1) + 1)
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const p = y * width + x
      if (d[p] === 0) continue
      d[p] = Math.min(d[p], at(x + 1, y) + 1, at(x + 1, y + 1) + 1, at(x, y + 1) + 1, at(x - 1, y + 1) + 1)
    }
  }
  return d
}

/** A glow frame's alpha read against the shape painter A drew. */
export interface GlowAlphaReading {
  /** The reach read: the request's radius, rounded. */
  reach: number
  /** The largest alpha beyond the reach (chessboard distance from the ink above `reach`), and how many pixels that is. */
  outsideReach: number
  outsidePixels: number
  /** The largest alpha where the shape is not (painter A's alpha 0) within the reach, and how many of those pixels the glow drew (alpha above 0). */
  glowMax: number
  glowPixels: number
  /** The largest alpha by distance from the ink: (0, r], (r, 2r], (2r, 4r], beyond 4r. */
  bands: { from: number; to: number; maxAlpha: number }[]
}

/** `GlowAlphaReading` for one glow frame (`picture`) over the shape painter A drew (`reference`), both straight RGBA of `width` × `height`. */
export function glowAlpha(reference: ArrayLike<number>, picture: ArrayLike<number>, width: number, height: number, radius: number): GlowAlphaReading {
  if (reference.length !== picture.length || reference.length !== width * height * 4) throw new Error('glowAlpha: pictures of different sizes')
  const reach = Math.round(radius)
  const distance = chebyshevDistance(reference, width, height)
  const bands = [
    { from: 0, to: reach, maxAlpha: 0 },
    { from: reach, to: 2 * reach, maxAlpha: 0 },
    { from: 2 * reach, to: 4 * reach, maxAlpha: 0 },
    { from: 4 * reach, to: Infinity, maxAlpha: 0 }
  ]
  let outsideReach = 0
  let outsidePixels = 0
  let glowMax = 0
  let glowPixels = 0
  for (let p = 0; p < width * height; p++) {
    const d = distance[p]
    if (d === 0) continue
    const alpha = picture[p * 4 + 3]
    for (const band of bands) if (d > band.from && d <= band.to && alpha > band.maxAlpha) band.maxAlpha = alpha
    if (d > reach) {
      outsidePixels++
      if (alpha > outsideReach) outsideReach = alpha
    } else {
      if (alpha > 0) glowPixels++
      if (alpha > glowMax) glowMax = alpha
    }
  }
  return { reach, outsideReach, outsidePixels, glowMax, glowPixels, bands }
}

export type GlowRouteName = 'quad' | 'unreal'

/** One route's M7 reading. */
export interface GlowRouteReading {
  route: GlowRouteName
  alpha: GlowAlphaReading
  /** The frame with the glow left out (`CompositorProbe`'s `glow: false`) against painter A: the 1:1 texture. */
  base: ChannelDiff
  /** Milliseconds per glowing frame, the median of the timed frames (drawn, copied out and read back). */
  msPerFrame: number
  memory: { before: { geometries: number; textures: number }; built: { geometries: number; textures: number }; after: { geometries: number; textures: number } }
}

/** One route's bars, read: every failure named. */
export function glowRouteVerdict(r: GlowRouteReading): { pass: boolean; failures: string[] } {
  const B = GLOW_BAR
  const failures: string[] = []
  const name = `route ${r.route}`
  if (r.alpha.outsidePixels === 0) failures.push(`${name}: no pixel beyond the reach of ${r.alpha.reach} px was read`)
  if (r.alpha.outsideReach > B.outsideReachMax) failures.push(`${name}: alpha ${r.alpha.outsideReach} beyond the glow's reach of ${r.alpha.reach} px, not 0`)
  if (r.alpha.glowPixels === 0) failures.push(`${name}: no glow was drawn outside the shape`)
  if (!(r.alpha.glowMax < B.glowAlphaBelow)) failures.push(`${name}: the glow's alpha reaches ${r.alpha.glowMax} outside the shape, not below 255`)
  if (r.base.maxAll > B.baseMax) failures.push(`${name}: the base under the glow differs from painter A by ${r.base.maxAll} > ${B.baseMax}`)
  if (!(r.base.meanAll < B.baseMean)) failures.push(`${name}: the base under the glow's mean ${r.base.meanAll.toFixed(4)}, not 0.000`)
  const { before, built, after } = r.memory
  if (after.geometries !== before.geometries || after.textures !== before.textures) {
    failures.push(`${name}: dispose gave back ${built.geometries - after.geometries} of ${built.geometries - before.geometries} geometries and ${built.textures - after.textures} of ${built.textures - before.textures} textures`)
  }
  return { pass: failures.length === 0, failures }
}

/** The focus check's readings. */
export interface FocusReadings {
  /** The plane's radius in the blurred case, in frame pixels. */
  radius: number
  /** Every plane on the depth in focus (radius 0) against painter A, the whole frame. */
  sharp: ChannelDiff
  /** A plane at `radius` against painter A over the detail's box. */
  blurred: ChannelDiff
  /** The smallest alpha over the blurred frame's border pixels (a plane that fills the frame). */
  edgeAlphaMin: number
}

/** The smallest alpha over a picture's border: its first and last rows and columns. */
export function borderAlphaMin(rgba: ArrayLike<number>, width: number, height: number): number {
  let min = 255
  const read = (x: number, y: number): void => {
    const a = rgba[(y * width + x) * 4 + 3]
    if (a < min) min = a
  }
  for (let x = 0; x < width; x++) {
    read(x, 0)
    read(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    read(0, y)
    read(width - 1, y)
  }
  return min
}

export function focusVerdict(r: FocusReadings): { pass: boolean; failures: string[] } {
  const B = FOCUS_BAR
  const failures: string[] = []
  if (r.sharp.maxAll > B.sharpMax) failures.push(`a plane at radius 0 differs from painter A by ${r.sharp.maxAll} > ${B.sharpMax}`)
  if (!(r.sharp.meanAll < B.sharpMean)) failures.push(`a plane at radius 0: mean ${r.sharp.meanAll.toFixed(4)} against painter A, not 0.000`)
  if (!(r.radius > 0)) failures.push(`the blurred case's radius is ${r.radius}, not above 0`)
  if (r.blurred.maxAll < B.blurredMinMax) failures.push(`a plane at radius ${r.radius} px is not visibly blurred: max ${r.blurred.maxAll} < ${B.blurredMinMax} over the detail`)
  if (r.edgeAlphaMin < B.edgeAlpha) failures.push(`the blurred plane's alpha at the frame's edge falls to ${r.edgeAlphaMin}, not ${B.edgeAlpha}`)
  return { pass: failures.length === 0, failures }
}
