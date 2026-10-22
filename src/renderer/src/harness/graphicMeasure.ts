/**
 * The arithmetic of the graphics check (`graphicCheck.ts`, docs/CLIPS.md §6.15),
 * apart from the canvas so it can be tested in node: percentiles, pixel
 * differences, ink boxes, and the synthetic graphic's geometry.
 *
 * Differences are in levels (0..255) over all FOUR channels. A graphic is
 * drawn on a transparent canvas, where white type reads 255,255,255 in every
 * pixel it touches at any coverage; only alpha says how much it covers, so a
 * difference taken over colour alone would call two different edges equal.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Spread {
  n: number
  p50: number
  p95: number
  mean: number
  max: number
}

/** Nearest-rank percentile, of a sorted copy: `p` in 0..100. NaN for no values. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]
}

export function spread(values: readonly number[]): Spread {
  const n = values.length
  const sum = values.reduce((a, b) => a + b, 0)
  return {
    n,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    mean: n > 0 ? sum / n : NaN,
    max: n > 0 ? Math.max(...values) : NaN
  }
}

export interface PixelDiff {
  /** Mean absolute difference per channel, in levels, over the box's pixels. */
  mean: number
  /** The largest difference in any channel of any pixel. */
  max: number
  /** Pixels with any channel different. */
  differing: number
  /** Pixels compared. */
  pixels: number
}

/**
 * Two RGBA pictures of one size (`getImageData`'s straight colour), compared
 * over `box` (the whole picture when absent).
 */
export function diffRgba(a: ArrayLike<number>, b: ArrayLike<number>, width: number, box?: Rect): PixelDiff {
  const height = Math.floor(a.length / 4 / width)
  const area = box ?? { x: 0, y: 0, width, height }
  let sum = 0
  let max = 0
  let differing = 0
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      const at = (y * width + x) * 4
      let any = false
      for (let c = 0; c < 4; c++) {
        const d = Math.abs(a[at + c] - b[at + c])
        sum += d
        if (d > max) max = d
        if (d > 0) any = true
      }
      if (any) differing++
    }
  }
  const pixels = area.width * area.height
  return { mean: pixels > 0 ? sum / (pixels * 4) : 0, max, differing, pixels }
}

/** The smallest rectangle holding every pixel whose alpha is above `threshold`; null when there is none. */
export function inkBox(data: ArrayLike<number>, width: number, height: number, threshold = 0): Rect | null {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y
  }
}

/** Grown by `pad` on every side, then kept inside a `width`×`height` picture. */
export function padRect(rect: Rect, pad: number, width: number, height: number): Rect {
  const x = Math.max(0, rect.x - pad)
  const y = Math.max(0, rect.y - pad)
  return {
    x,
    y,
    width: Math.min(width, rect.x + rect.width + pad) - x,
    height: Math.min(height, rect.y + rect.height + pad) - y
  }
}

/** Does `outer` hold every pixel of `inner`? */
export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

/**
 * §6.15's synthetic graphic, the picture M1, M2 and M5 time, since no template
 * exists in phase 0: on a transparent 1080×1920 canvas, a 900×420 rounded
 * panel at 0.85 opacity with two lines of type and a 6 px stroke drawing on,
 * the whole rising 2 px a frame. The panel's place at frame 0 is this check's
 * own (the plan gives only its size): centred across, low in the frame, so
 * 120 frames of rise keep it whole.
 */
export const SYNTHETIC = {
  width: 1080,
  height: 1920,
  panel: { x: 90, y: 1100, width: 900, height: 420, radius: 36 },
  opacity: 0.85,
  /** Pixels the whole graphic rises each frame. */
  rise: 2,
  stroke: 6,
  /** Beyond the panel's edge, for its anti-aliasing; the type and the stroke sit inside it. */
  pad: 4
} as const

/** The panel at a frame. */
export function syntheticPanelAt(frame: number): Rect {
  const { panel, rise } = SYNTHETIC
  return { x: panel.x, y: panel.y - rise * frame, width: panel.width, height: panel.height }
}

/**
 * The box route's region (M1's `'box'`): every frame of the sequence is one
 * size, so the box is the union of the panel over all of them, padded, snapped
 * out to even pixels as a yuv420 overlay wants, and kept inside the canvas.
 */
export function syntheticBox(frames: number): Rect {
  const last = Math.max(0, frames - 1)
  const union = unionRect(syntheticPanelAt(0), syntheticPanelAt(last))!
  const padded = padRect(union, SYNTHETIC.pad, SYNTHETIC.width, SYNTHETIC.height)
  const x = Math.floor(padded.x / 2) * 2
  const y = Math.floor(padded.y / 2) * 2
  const right = Math.min(SYNTHETIC.width, Math.ceil((padded.x + padded.width) / 2) * 2)
  const bottom = Math.min(SYNTHETIC.height, Math.ceil((padded.y + padded.height) / 2) * 2)
  return { x, y, width: right - x, height: bottom - y }
}
