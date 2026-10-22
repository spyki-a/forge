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

/**
 * Time per frame through a pipeline `depth` deep, from the times its frames
 * were written, in frame order: the span of `depth` consecutive writes, over
 * `depth`, at every frame. §6.15's "ms per frame at p50 and p95" for M1 and M2.
 *
 * Not the gap between one write and the next. A pool `depth` deep finishes
 * its encodes together and writes them back to back, so its gaps are bursts:
 * at depth 4, three gaps of the main thread's own cost and one of about a
 * whole encode, whose p50 reads the first and p95 the second, neither the
 * cost of a frame (the live run's 3.1 ms p50 against 7.6 ms a frame). Over a
 * window as deep as the pipeline, each burst is counted once.
 */
export function perFrameMs(writtenAt: readonly number[], depth: number): number[] {
  const d = Math.max(1, Math.floor(depth) || 1)
  const out: number[] = []
  for (let i = 0; i + d < writtenAt.length; i++) out.push((writtenAt[i + d] - writtenAt[i]) / d)
  return out
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

/**
 * Where a picture's ink sits inside another picture, across: the horizontal
 * shift of `part` that best matches `whole`, by the least summed difference
 * in alpha over `part`'s ink box, trying every shift up to `maxShift` either
 * way (a pixel shifted off the picture reads alpha 0). On a tie the smaller
 * shift wins, so a part found where it was drawn reads 0. Null when `part`
 * has no ink.
 */
export function bestShift(
  whole: ArrayLike<number>,
  part: ArrayLike<number>,
  width: number,
  height: number,
  maxShift: number
): { shift: number; error: number } | null {
  const box = inkBox(part, width, height)
  if (!box) return null
  const reach = Math.max(0, Math.floor(maxShift))
  let best = { shift: 0, error: Infinity }
  for (let s = -reach; s <= reach; s++) {
    let error = 0
    for (let y = box.y; y < box.y + box.height; y++) {
      for (let x = box.x; x < box.x + box.width; x++) {
        const xs = x + s
        const theirs = xs >= 0 && xs < width ? whole[(y * width + xs) * 4 + 3] : 0
        error += Math.abs(part[(y * width + x) * 4 + 3] - theirs)
      }
    }
    if (error < best.error || (error === best.error && Math.abs(s) < Math.abs(best.shift))) best = { shift: s, error }
  }
  return best
}

/** More than this many pixels right of where it was drawn alone, a consonant has something before it (proposal). */
export const PRE_BASE_LEAD_PX = 2

/**
 * M22's reading of कि (§6.11): is the i-matra drawn before its consonant?
 * `whole` is the cluster drawn whole, `consonant` the consonant drawn alone
 * from the same pen; both left-aligned there.
 *
 * Not by comparing the two drawings' left edges: a shaped pre-base matra
 * starts at the pen too, so the whole drawing's ink and the lone consonant's
 * begin at the same pixel whether the cluster was shaped or not (the live
 * run: 96 against 96, both ways). The consonant is found inside the whole
 * drawing instead: shaped, the matra has pushed it right by about the matra's
 * width (35 px at 120 px in Kohinoor Devanagari); unshaped, it is where it
 * was drawn alone.
 */
export function preBaseLead(
  whole: ArrayLike<number>,
  consonant: ArrayLike<number>,
  width: number,
  height: number
): { shift: number; error: number; first: boolean } | null {
  const own = inkBox(consonant, width, height)
  const theirs = inkBox(whole, width, height)
  if (!own || !theirs) return null
  const found = bestShift(whole, consonant, width, height, Math.max(own.width, theirs.width))
  if (!found) return null
  return { ...found, first: found.shift > PRE_BASE_LEAD_PX }
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
