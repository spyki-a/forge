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

import type { Clip, Project } from '@shared/timeline'
import type { GraphicSpec } from '@shared/graphics/template'
import type { MotionEase } from '@shared/graphics/motion'

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

/* ------------------------------------------------- phase 1: the primitives */

/** `data`'s pixels inside `box`, as a `box`-sized RGBA picture: the canvas route's frame cut to the box route's region. */
export function cropRgba(data: ArrayLike<number>, width: number, box: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(box.width * box.height * 4)
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      const from = ((box.y + y) * width + box.x + x) * 4
      const to = (y * box.width + x) * 4
      for (let c = 0; c < 4; c++) out[to + c] = data[from + c]
    }
  }
  return out
}

/**
 * The alpha a frame carries outside `box` (§6.12's phase 1 bar: "alpha 0
 * outside the box, maximum 0"): its largest value and how many pixels carry
 * any. A null box (no ink anywhere) reads every pixel as outside it.
 */
export function alphaOutside(data: ArrayLike<number>, width: number, height: number, box: Rect | null): { max: number; pixels: number } {
  let max = 0
  let pixels = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (box && x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) continue
      const a = data[(y * width + x) * 4 + 3]
      if (a > 0) {
        pixels++
        if (a > max) max = a
      }
    }
  }
  return { max, pixels }
}

/**
 * Two pictures of one size compared over their ink: the union of both ink
 * boxes, grown by `pad` (kept inside the picture), the way the Indic reading
 * compares a cluster's frames; the whole picture when neither has any ink.
 * Over the whole box route's region a thin stroke moved a pixel averaged 0.68
 * levels, under §6.12's 1/255, where over its ink it does not (Chrome 152,
 * 2026-11-02): a mean is only as strict as the area it is taken over.
 */
export function diffOverInk(a: ArrayLike<number>, b: ArrayLike<number>, width: number, height: number, pad = 2): PixelDiff {
  const ink = unionRect(inkBox(a, width, height), inkBox(b, width, height))
  return diffRgba(a, b, width, ink ? padRect(ink, pad, width, height) : undefined)
}

/** One frame's file in a numbered sequence's ffmpeg pattern (`writeTitleFrame`'s `%05d.png`, titles.ts); the pattern unchanged when it numbers nothing. */
export function framePath(pattern: string, index: number): string {
  return pattern.replace(/%0(\d+)d/, (_, digits: string) => String(Math.max(0, Math.floor(index))).padStart(Number(digits), '0'))
}

/** A file beside another, whichever separator the main process joined it with (`writeCaptionList`'s list beside `writeCaptionFrame`'s pictures, captions.ts). */
export function siblingPath(path: string, name: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return `${path.slice(0, cut + 1)}${name}`
}

/**
 * §6.12's phase 1 bar for the `primitives` check, as the check reads it: the
 * baked PNG against the preview within 1/255 mean (a mean difference of at
 * most 1 level over the two pictures' ink, `diffOverInk`), the last moving frame equal to the held end
 * (mean 0), no alpha outside the box (maximum 0), and the same spec twice
 * identical (the preview drawn twice equal, every PNG of two bakes
 * byte-equal).
 */
export const PRIMITIVES_BAR = { bakeMeanLevels: 1, heldMean: 0, outsideAlpha: 0 } as const

export interface PrimitivesReading {
  /** Per frame read, the box route's decoded PNG (the export's, `boxAllowed`) against the preview cut to the box, over their ink (`diffOverInk`). */
  bakeAgainstPreview: PixelDiff[]
  /** Per frame read, the canvas route's decoded PNG (the store's bake, and the export's for a clip not identity-placed) against the preview, over their ink. */
  canvasAgainstPreview: PixelDiff[]
  /** The last moving frame against the held end, on the preview. */
  heldAgainstLast: PixelDiff
  /** Per frame read, the alpha outside `graphicBox` on the preview, then on the canvas route's PNG. */
  outside: { max: number; pixels: number }[]
  /** Per frame read, the preview drawn a second time against the first. */
  drawnTwice: PixelDiff[]
  /** PNGs of the second bake byte-equal to the first's, of how many. */
  bakedTwice: { equal: number; of: number }
  /**
   * Per frame read, the Preview's own canvas (`graphicPreviewCanvas`, with its
   * settled frame, signature cache and per-clip dim layer) against the
   * harness's frames (`graphicFrameCanvases`) at the same frame, or at the
   * last moving frame for one past it, which is what the Preview shows there.
   */
  live: PixelDiff[]
  /** `graphicBox` as the check computed it, and the box the box route's bake returned. */
  boxes: { check: Rect | null; bake: Rect | null }
  /** The frames each bake wrote against `graphicMovingFrames`: the hold is `tpad`'s in the export, never baked. */
  frames: { baked: number; canvas: number; moving: number }
}

export interface PrimitivesVerdict {
  bake: boolean
  held: boolean
  outside: boolean
  twice: boolean
  live: boolean
  box: boolean
  count: boolean
  pass: boolean
}

/**
 * The box route's region is sound: the bake's box is the one the check
 * computed (the alpha-outside reading is taken against the check's), and
 * its edges and size are even, as `graphicBox` rounds them for the 4:2:0
 * overlay's chroma (§6.11's (box) case). No box on either side agrees.
 */
export function boxSound(check: Rect | null, bake: Rect | null): boolean {
  const agree = check === null || bake === null ? check === bake : check.x === bake.x && check.y === bake.y && check.width === bake.width && check.height === bake.height
  const even = bake === null || [bake.x, bake.y, bake.width, bake.height].every((v) => v % 2 === 0)
  return agree && even
}

/** The bar applied to a case's readings: each part, and all of them. A case with no frame read, or no PNG on either route, passes nothing. */
export function primitivesVerdict(r: PrimitivesReading): PrimitivesVerdict {
  const within = (diffs: readonly PixelDiff[]): boolean => diffs.length > 0 && diffs.every((d) => d.mean <= PRIMITIVES_BAR.bakeMeanLevels)
  const bake = within(r.bakeAgainstPreview) && within(r.canvasAgainstPreview)
  const held = r.heldAgainstLast.pixels > 0 && r.heldAgainstLast.mean <= PRIMITIVES_BAR.heldMean
  const outside = r.outside.length > 0 && r.outside.every((o) => o.max <= PRIMITIVES_BAR.outsideAlpha)
  const twice = r.drawnTwice.length > 0 && r.drawnTwice.every((d) => d.max === 0) && r.bakedTwice.of > 0 && r.bakedTwice.equal === r.bakedTwice.of
  const live = r.live.length > 0 && r.live.every((d) => d.pixels > 0 && d.max === 0)
  const box = boxSound(r.boxes.check, r.boxes.bake)
  const count = r.frames.moving > 0 && r.frames.baked === r.frames.moving && r.frames.canvas === r.frames.moving
  return { bake, held, outside, twice, live, box, count, pass: bake && held && outside && twice && live && box && count }
}

/**
 * M13's line (§6.15): each case's two box-route sequences, for the user's
 * framemd5 of the files on disk, printed whenever they are files (the
 * development app), however the check read their bytes; nothing where they
 * are the harness bridge's `harness://` answers, which no ffmpeg can read.
 */
export function m13Line(cases: readonly { name: string; patterns: readonly [string, string]; canvasPattern: string }[]): string | null {
  const onDisk = cases.filter((c) => !/^harness:/.test(c.patterns[0]))
  if (onDisk.length === 0) return null
  return (
    'primitives M13: each case baked twice on the box route, its two sequences kept on disk for the framemd5 of each ' +
    '("$FFMPEG" -start_number 0 -i <pattern> -f framemd5 -), the Mac\'s against the Surface\'s: ' +
    onDisk.map((c) => `${c.name} ${c.patterns.join(' and ')}`).join('; ') +
    `; the canvas route's beside them (${onDisk.map((c) => c.canvasPattern).join(', ')}). Each run adds its own; the app's title-frame folder keeps them until cleared.`
  )
}

/* ------------------------------------------------------ M8: the path's length */

/**
 * M8's bar (§6.15, proposal): `STROKE_TOLERANCE` is the coarsest tolerance at
 * which every path's flattened length agrees with the browser's
 * `getTotalLength()` within 0.1 %, and every sampled point within 0.5 px, at
 * 1080 wide (the paths are in a 1080-wide frame's pixels).
 */
export const M8_BAR = { lengthPct: 0.1, pointPx: 0.5 } as const

/** Our length against the browser's, in percent, signed: (ours / theirs − 1) × 100. 0 for two empty paths, Infinity for one empty against one not. */
export function lengthPct(ours: number, theirs: number): number {
  if (theirs > 0) return (ours / theirs - 1) * 100
  return ours === 0 && theirs === 0 ? 0 : Infinity
}

/** The largest distance between two point lists taken pair by pair; Infinity when they are not the same length or a point is missing. */
export function largestGap(a: readonly ({ x: number; y: number } | null)[], b: readonly ({ x: number; y: number } | null)[]): number {
  if (a.length !== b.length) return Infinity
  let max = 0
  for (let i = 0; i < a.length; i++) {
    const p = a[i]
    const q = b[i]
    if (!p || !q) return Infinity
    const d = Math.hypot(p.x - q.x, p.y - q.y)
    if (!(d <= max)) max = d
  }
  return max
}

/** One path at one tolerance: `flattenPath`'s length and the browser's, and the largest distance between the two at the same fractions of each length. */
export interface PathLengthRow {
  path: string
  tolerance: number
  ours: number
  theirs: number
  /** `lengthPct(ours, theirs)`. */
  lengthPct: number
  pointPx: number
}

/** Every path at one tolerance: the worst length and the worst point, with the paths they came from, and whether both are within `M8_BAR`. */
export interface ToleranceReading {
  tolerance: number
  paths: number
  /** The signed `lengthPct` of largest size. */
  worstLengthPct: number
  worstLengthPath: string
  worstPointPx: number
  worstPointPath: string
  pass: boolean
}

export interface PathLengthVerdict {
  /** Coarsest first. */
  tolerances: ToleranceReading[]
  /** The coarsest tolerance that passes (M8's reading of `STROKE_TOLERANCE`); null when none does. */
  coarsest: number | null
  /** Whether every tolerance finer than `coarsest` passes too, so the coarsest is a threshold and not a lucky step. */
  finerAllPass: boolean
}

/**
 * M8's verdict over its rows. A tolerance with no row, or a row that is not
 * a number (a path the browser could not measure), passes nothing.
 */
export function pathLengthVerdict(rows: readonly PathLengthRow[]): PathLengthVerdict {
  const tolerances = [...new Set(rows.map((r) => r.tolerance))].sort((a, b) => b - a)
  const readings = tolerances.map((tolerance): ToleranceReading => {
    const at = rows.filter((r) => r.tolerance === tolerance)
    let worstLength = at[0]
    let worstPoint = at[0]
    for (const r of at) {
      if (!(Math.abs(r.lengthPct) <= Math.abs(worstLength.lengthPct))) worstLength = r
      if (!(r.pointPx <= worstPoint.pointPx)) worstPoint = r
    }
    const pass = at.length > 0 && at.every((r) => Math.abs(r.lengthPct) <= M8_BAR.lengthPct && r.pointPx <= M8_BAR.pointPx)
    return {
      tolerance,
      paths: at.length,
      worstLengthPct: worstLength.lengthPct,
      worstLengthPath: worstLength.path,
      worstPointPx: worstPoint.pointPx,
      worstPointPath: worstPoint.path,
      pass
    }
  })
  const coarsest = readings.find((r) => r.pass)?.tolerance ?? null
  const finerAllPass = coarsest !== null && readings.filter((r) => r.tolerance < coarsest).every((r) => r.pass)
  return { tolerances: readings, coarsest, finerAllPass }
}

/**
 * M8's two readings: over every path, and over every path but `open`, the
 * paths whose place in M8 the plan left to its owner (§6.3's stroke note,
 * "Open, yours": whether M8 includes a four-cubic circle under r = 40). The
 * readout gives both, so neither answers that question for the owner.
 */
export function pathLengthReadings(rows: readonly PathLengthRow[], open: ReadonlySet<string>): { all: PathLengthVerdict; withoutOpen: PathLengthVerdict } {
  return { all: pathLengthVerdict(rows), withoutOpen: pathLengthVerdict(rows.filter((r) => !open.has(r.path))) }
}

/* ------------------------------------------------ M19: the strokes' chroma */

/**
 * M19's bar (§6.15, proposal): `STROKE_MIN_PX` is the smallest width whose
 * centre line keeps U and V within 8 levels of the PNG's own after the plan's
 * `format=yuva420p` overlay.
 */
export const M19_BAR = { chromaLevels: 8 } as const

/**
 * The `strokes` option's layout on a 1080×1920 frame: one band per width, 300
 * tall from y = 60 (six bands at most), each holding a horizontal stroke and
 * a diagonal one. The horizontal's top edge sits on an even row, 40 into the
 * band, so a whole-pixel width covers whole rows from the top of a 4:2:0
 * chroma pair: a 1 px line half a pair, 2 px one pair. The diagonal's slope,
 * 191/320, is no small ratio, so along it the line crosses the pairs at every
 * phase.
 */
export const STROKE_BANDS = {
  top: 60,
  height: 300,
  max: 6,
  /** The widest stroke a band holds apart: wider, and the diagonal's top corner nears the horizontal (they touch about 39 px), so `strokeLines` would read the two as one region. */
  maxWidth: 20,
  horizontal: { from: 120, to: 960, dy: 40 },
  diagonal: { from: { x: 380, dy: 96 }, to: { x: 700, dy: 287 } }
} as const

/** Why `widths` cannot be the `strokes` option's (1 to `STROKE_BANDS.max` of them, each a number of px over 0 and at most `STROKE_BANDS.maxWidth`); null when they can. */
export function strokeWidthsError(widths: readonly number[]): string | null {
  const B = STROKE_BANDS
  if (widths.length >= 1 && widths.length <= B.max && widths.every((w) => Number.isFinite(w) && w > 0 && w <= B.maxWidth)) return null
  return `strokes takes 1 to ${B.max} widths, each a number of px over 0 and at most ${B.maxWidth} (got ${JSON.stringify(widths)})`
}

export interface StrokeBand {
  /** The band's rectangle on the frame. */
  box: Rect
  /** Each line's ends, its centre line in frame pixels. */
  horizontal: [{ x: number; y: number }, { x: number; y: number }]
  diagonal: [{ x: number; y: number }, { x: number; y: number }]
}

/** Band `index`'s rectangle and lines, for a stroke `width` px wide: the horizontal's centre is half the width below its even top edge. */
export function strokeBand(index: number, width: number, frameWidth = 1080): StrokeBand {
  const B = STROKE_BANDS
  const top = B.top + index * B.height
  const y = top + B.horizontal.dy + width / 2
  return {
    box: { x: 0, y: top, width: frameWidth, height: B.height },
    horizontal: [
      { x: B.horizontal.from, y },
      { x: B.horizontal.to, y }
    ],
    diagonal: [
      { x: B.diagonal.from.x, y: top + B.diagonal.from.dy },
      { x: B.diagonal.to.x, y: top + B.diagonal.to.dy }
    ]
  }
}

/** The band a box read from the picture lies in (`STROKE_BANDS`, by its top edge), or null above the first band or past the last: so lines are grouped by the band they were drawn in, not by a read width that another machine's antialiasing can round apart. */
export function strokeBandIndex(box: Rect): number | null {
  const B = STROKE_BANDS
  const index = Math.floor((box.y - B.top) / B.height)
  return index >= 0 && index < B.max ? index : null
}

/** A drawn line read back from its picture. */
export interface StrokeLine {
  /** The line's pixels (alpha above 0), as one 8-connected region. */
  box: Rect
  /** dy/dx of its centre line, fitted by least squares over the scan lines (Infinity for a vertical one). */
  slope: number
  /** Its width across the line in pixels: the median scan line's coverage (alpha sum / 255) times the cosine of its angle to the scan. */
  width: number
  /** The centre line: on each scan line across the line (a column, or a row for a line steeper than 45°), `end` px clear of each end, the pixels nearest its alpha-weighted middle (both, at an even crisp width's tie). */
  centre: { x: number; y: number }[]
}

/** Regions under this many pixels are specks, not lines. */
const SPECK = 16

/**
 * The lines of an RGBA picture (straight alpha, as `getImageData` and a
 * PNG decoded with `premultiplyAlpha: 'none'` give it): each 8-connected
 * region of alpha above 0, read for its width and its centre line. In the
 * order of each region's first pixel, row by row.
 */
export function strokeLines(data: ArrayLike<number>, width: number, height: number, end = 4): StrokeLine[] {
  const label = new Int32Array(width * height).fill(-1)
  const stack = new Int32Array(width * height)
  const lines: StrokeLine[] = []
  let next = 0
  for (let start = 0; start < width * height; start++) {
    if (label[start] !== -1 || data[start * 4 + 3] === 0) continue
    const id = next++
    const members: number[] = []
    let top = 0
    stack[top++] = start
    label[start] = id
    while (top > 0) {
      const at = stack[--top]
      members.push(at)
      const x = at % width
      const y = (at - x) / width
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const n = ny * width + nx
          if (label[n] === -1 && data[n * 4 + 3] > 0) {
            label[n] = id
            stack[top++] = n
          }
        }
      }
    }
    if (members.length < SPECK) continue
    lines.push(lineOf(members, data, width, end))
  }
  return lines
}

function lineOf(members: readonly number[], data: ArrayLike<number>, width: number, end: number): StrokeLine {
  let left = Infinity
  let right = -Infinity
  let top = Infinity
  let bottom = -Infinity
  for (const at of members) {
    const x = at % width
    const y = (at - x) / width
    if (x < left) left = x
    if (x > right) right = x
    if (y < top) top = y
    if (y > bottom) bottom = y
  }
  const box = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
  // Scan across the line: columns for a line no steeper than 45°, rows otherwise.
  const byColumn = box.width >= box.height
  const scans = new Map<number, { along: number; across: number; alpha: number }[]>()
  for (const at of members) {
    const x = at % width
    const y = (at - x) / width
    const along = byColumn ? x : y
    const list = scans.get(along) ?? []
    list.push({ along, across: byColumn ? y : x, alpha: data[at * 4 + 3] })
    scans.set(along, list)
  }
  const first = byColumn ? left : top
  const last = byColumn ? right : bottom
  const sums: number[] = []
  const fit: { u: number; v: number }[] = []
  const centre: { x: number; y: number }[] = []
  for (let along = first + end; along <= last - end; along++) {
    const scan = scans.get(along)
    if (!scan) continue
    let sum = 0
    let weighted = 0
    for (const p of scan) {
      sum += p.alpha
      weighted += p.alpha * p.across
    }
    const mid = weighted / sum
    sums.push(sum / 255)
    fit.push({ u: along, v: mid })
    // The pixels nearest the scan line's alpha-weighted middle: one for an odd crisp width, both middle rows for an even one.
    let nearest = Infinity
    for (const p of scan) nearest = Math.min(nearest, Math.abs(p.across - mid))
    for (const p of scan) if (Math.abs(p.across - mid) - nearest < 1e-9) centre.push(byColumn ? { x: along, y: p.across } : { x: p.across, y: along })
  }
  // Least squares of the across position on the along one: the slope against the scan.
  const n = fit.length
  const mu = fit.reduce((s, p) => s + p.u, 0) / n
  const mv = fit.reduce((s, p) => s + p.v, 0) / n
  let sxy = 0
  let sxx = 0
  for (const p of fit) {
    sxy += (p.u - mu) * (p.v - mv)
    sxx += (p.u - mu) * (p.u - mu)
  }
  const m = sxx > 0 ? sxy / sxx : 0
  const median = percentile(sums, 50)
  return {
    box,
    slope: byColumn ? m : m === 0 ? Infinity : 1 / m,
    width: n > 0 ? median / Math.sqrt(1 + m * m) : 0,
    centre
  }
}

/** A line's centre-line chroma after the overlay against the PNG's own, in levels. */
export interface ChromaReading {
  pixels: number
  maxU: number
  maxV: number
  meanU: number
  meanV: number
  /** Both maxima within `M19_BAR`. */
  within: boolean
}

/**
 * U and V along `centre`: the reference's at each pixel (planes at full
 * resolution, `width` wide: the PNG over the colour with no subsampling)
 * against the overlay's 4:2:0 sample that pixel is stored with (planes
 * `ceil(width / 2)` wide, at x >> 1, y >> 1), which is what a player
 * upsamples from.
 */
export function chromaAlong(
  centre: readonly { x: number; y: number }[],
  reference: { u: ArrayLike<number>; v: ArrayLike<number> },
  measured: { u: ArrayLike<number>; v: ArrayLike<number> },
  width: number
): ChromaReading {
  const half = Math.ceil(width / 2)
  let maxU = 0
  let maxV = 0
  let sumU = 0
  let sumV = 0
  for (const { x, y } of centre) {
    const full = y * width + x
    const sub = (y >> 1) * half + (x >> 1)
    const du = Math.abs(reference.u[full] - measured.u[sub])
    const dv = Math.abs(reference.v[full] - measured.v[sub])
    if (!(du <= maxU)) maxU = du
    if (!(dv <= maxV)) maxV = dv
    sumU += du
    sumV += dv
  }
  const pixels = centre.length
  return {
    pixels,
    maxU,
    maxV,
    meanU: pixels > 0 ? sumU / pixels : NaN,
    meanV: pixels > 0 ? sumV / pixels : NaN,
    within: pixels > 0 && maxU <= M19_BAR.chromaLevels && maxV <= M19_BAR.chromaLevels
  }
}

/** Alpha alone, two RGBA pictures over `box`: the largest difference, and each picture's coverage (alpha sum / 255). */
export function alphaAgainst(a: ArrayLike<number>, b: ArrayLike<number>, width: number, box: Rect): { max: number; coverage: [number, number] } {
  let max = 0
  let ca = 0
  let cb = 0
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const at = (y * width + x) * 4 + 3
      const d = Math.abs(a[at] - b[at])
      if (d > max) max = d
      ca += a[at]
      cb += b[at]
    }
  }
  return { max, coverage: [ca / 255, cb / 255] }
}

/** The folder of a numbered sequence's ffmpeg pattern, whichever separator the main process joined it with, never ending in one; null for the harness bridge's `harness://` answers, which are no folder. */
export function folderOf(pattern: string): string | null {
  if (/^harness:/.test(pattern)) return null
  const cut = Math.max(pattern.lastIndexOf('/'), pattern.lastIndexOf('\\'))
  return cut > 0 ? pattern.slice(0, cut) : null
}

/* ------------------------------------------------- phase 2: the templates */

/**
 * §6.11's `templates` row, as the check reads it (phase 2's exit, §6.12): per
 * shape, from specs.json, frames 0, a beat, the last moving frame and the end
 * differ as they should; the last moving frame equals the held end (mean 0);
 * alpha 0 outside the box; the same spec drawn twice identical; the baked PNG
 * against the preview within 1/255 (a mean of at most 1 level over the two
 * pictures' ink, `diffOverInk`, on both routes, as `primitives` reads it).
 * Beside `PRIMITIVES_BAR`, its own, so the two can part.
 */
export const TEMPLATES_BAR = { bakeMeanLevels: 1, heldMean: 0, outsideAlpha: 0 } as const

/** A template case's readings: the primitives' parts, and the two "differ as they should" ones. */
export interface TemplateReading extends PrimitivesReading {
  /** Frame 0 against the first beat's frame, on the preview: an element arrives, so they differ; null where no beat frame lies after 0 within the moving frames. */
  startAgainstBeat: PixelDiff | null
  /** Frame 0 against the last moving frame: the graphic moved at all. */
  startAgainstEnd: PixelDiff | null
  /** The clip's frames: a held end exists only when it is more than the moving ones. */
  total: number
}

export interface TemplateVerdict extends PrimitivesVerdict {
  /** Frame 0 differs from the beat's frame and from the last moving frame. */
  moves: boolean
}

/**
 * `TEMPLATES_BAR` applied to a case's readings, part by part. A part with
 * nothing read passes nothing: no frame, no PNG on either route, no beat
 * frame, no held end (a clip whose moving frames are all of it holds nothing
 * to compare).
 */
export function templateVerdict(r: TemplateReading): TemplateVerdict {
  const within = (diffs: readonly PixelDiff[]): boolean => diffs.length > 0 && diffs.every((d) => d.pixels > 0 && d.mean <= TEMPLATES_BAR.bakeMeanLevels)
  const bake = within(r.bakeAgainstPreview) && within(r.canvasAgainstPreview)
  const held = r.total > r.frames.moving && r.heldAgainstLast.pixels > 0 && r.heldAgainstLast.mean <= TEMPLATES_BAR.heldMean
  const outside = r.outside.length > 0 && r.outside.every((o) => o.max <= TEMPLATES_BAR.outsideAlpha)
  const twice = r.drawnTwice.length > 0 && r.drawnTwice.every((d) => d.pixels > 0 && d.max === 0) && r.bakedTwice.of > 0 && r.bakedTwice.equal === r.bakedTwice.of
  const live = r.live.length > 0 && r.live.every((d) => d.pixels > 0 && d.max === 0)
  const box = r.boxes.check !== null && boxSound(r.boxes.check, r.boxes.bake)
  const count = r.frames.moving > 0 && r.frames.baked === r.frames.moving && r.frames.canvas === r.frames.moving
  const moves = r.startAgainstBeat !== null && r.startAgainstEnd !== null && r.startAgainstBeat.differing > 0 && r.startAgainstEnd.differing > 0
  return { bake, held, outside, twice, live, box, count, moves, pass: bake && held && outside && twice && live && box && count && moves }
}

/** One drawing fixture of specs.json (§6.2, §6.10): its id, shape, language and spec. */
export interface TemplateFixture {
  id: string
  shape: string
  language: string
  spec: GraphicSpec
}

/** specs.json's text, read: every entry with an id, a shape, a language and a spec naming a template, or a throw naming the first that is not. */
export function parseTemplateFixtures(text: string): TemplateFixture[] {
  const file = JSON.parse(text) as { specs?: unknown }
  if (!Array.isArray(file.specs)) throw new Error('specs.json has no specs list')
  return file.specs.map((entry: unknown, i: number) => {
    const e = entry as Partial<TemplateFixture>
    if (typeof e?.id !== 'string' || typeof e.shape !== 'string' || typeof e.language !== 'string' || typeof e.spec?.data?.template !== 'string') {
      throw new Error(`specs.json's entry ${i} is not an id, a shape, a language and a spec`)
    }
    return { id: e.id, shape: e.shape, language: e.language, spec: e.spec }
  })
}

/** The fixtures of the templates asked for, and every id asked for that cannot be read, by name: never skipped silently. */
export interface TemplateCases {
  cases: TemplateFixture[]
  /** Asked for, and not a template any drawer draws. */
  unknown: string[]
  /** A drawn template with no fixture in specs.json. */
  noSpec: string[]
}

/** The cases for `asked` (in its order, each id once), from `fixtures`, given the ids that have a drawer (`DRAWERS`' keys). */
export function templateCasesFor(asked: readonly string[], fixtures: readonly TemplateFixture[], drawn: readonly string[]): TemplateCases {
  const cases: TemplateFixture[] = []
  const unknown: string[] = []
  const noSpec: string[] = []
  for (const id of [...new Set(asked)]) {
    if (!drawn.includes(id)) {
      unknown.push(String(id))
      continue
    }
    const own = fixtures.filter((f) => f.spec.data.template === id)
    if (own.length === 0) noSpec.push(id)
    cases.push(...own)
  }
  return { cases, unknown, noSpec }
}

/**
 * A fixture's targets in frame pixels: its `subject` box (source units) as if
 * the footage filled the frame, since a fixture has no project to map it
 * through (`graphicTargetsAt`); none without one. Only the callout fixtures
 * carry one, and a callout with no subject draws nothing (§6.9).
 */
export function fixtureTargets(spec: Pick<GraphicSpec, 'subject'>, size: { width: number; height: number }): { subject?: Rect } {
  const s = spec.subject
  if (!s) return {}
  return { subject: { x: s.box.x * size.width, y: s.box.y * size.height, width: s.box.width * size.width, height: s.box.height * size.height } }
}

/** A tally per key: passed only when it had at least one case and every case of it passed. */
export function tallyBy<T>(cases: readonly T[], keyOf: (c: T) => string, passed: (c: T) => boolean): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const c of cases) {
    const key = keyOf(c)
    out[key] = (out[key] ?? true) && passed(c)
  }
  return out
}

/** The Indic reading of one text item (§6.11's phase 2 sentence of "The Indic render check"), its parts as `IndicPaintRow` carries them. */
export interface IndicItemParts {
  text: string
  /** The painter against one `drawTextOnto` call of the same item. */
  equal: boolean
  /** Whole against per code point, over the ink. */
  differs: boolean
  /** A conjunct's advance against its letters', null for no conjunct. */
  narrower: boolean | null
  /** कि's i-matra before its consonant, null where there is no i-matra. */
  matraFirst: boolean | null
}

/** Whether shaping can change the item's picture: a mark (a virama, a matra, a nukta) in it. Without one, whole and per code point may rightly be equal. */
export const shapedText = (text: string): boolean => /\p{M}/u.test(text)

/**
 * An item passes when the painter equals `drawTextOnto`, a shaped item
 * (`shapedText`) differs from its per-code-point drawing, a conjunct is
 * narrower and an i-matra comes first; a reading not taken (null) neither
 * passes nor fails.
 */
export function indicItemPass(r: IndicItemParts): boolean {
  return r.equal && (!shapedText(r.text) || r.differs) && r.narrower !== false && r.matraFirst !== false
}

/* ------------------------------------------- phase 2: the blind ratings */

/** The letters a blind rating's renders are named by, in the order the page shows them. */
export const BLIND_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** A rating's renders lettered: the names in letter order (A first), and the key, letter to name. */
export interface Lettered<T extends string> {
  order: T[]
  key: Record<string, T>
}

/**
 * Letters `names` blind (§6.10, M14 and the look rating): a Fisher-Yates
 * shuffle drawn from `random` (from the last place down, each place swapped
 * with one at or before it, `floor(random() × (i + 1))`), then A, B, C... in
 * the shuffled order. `random` is the seam a test pins; the check passes
 * `Math.random`, so two runs can differ. 1 to 26 names, each once, or a throw.
 */
export function letterBlind<T extends string>(names: readonly T[], random: () => number): Lettered<T> {
  if (names.length < 1 || names.length > BLIND_LETTERS.length) throw new Error(`a blind rating letters 1 to ${BLIND_LETTERS.length} renders (got ${names.length})`)
  if (new Set(names).size !== names.length) throw new Error(`a blind rating names each render once (got ${JSON.stringify(names)})`)
  const order = [...names]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))))
    const swap = order[i]
    order[i] = order[j]
    order[j] = swap
  }
  const key: Record<string, T> = {}
  order.forEach((name, i) => (key[BLIND_LETTERS[i]] = name))
  return { order, key }
}

/**
 * What the page shows of a blind rating: per row (a clip), its label and its
 * letters, the questions, and how to save the key. Built from the lettered
 * rows, of which it takes the letters alone: the key is the result's, never
 * the page's, the summary's or the console's (§6.10).
 */
export interface BlindPage {
  heading: string
  rows: { label: string; letters: string[] }[]
  questions: readonly string[]
  howToSave: string
}

export function blindPage(heading: string, rows: readonly { label: string; lettered: Lettered<string> }[], questions: readonly string[], howToSave: string): BlindPage {
  return {
    heading,
    rows: rows.map((r) => ({ label: r.label, letters: Object.keys(r.lettered.key).sort() })),
    questions: [...questions],
    howToSave
  }
}

/** The page's lines for the summary: the heading, each row's letters, the questions and how to save; read from the page alone, so nothing the page does not show is printed. */
export function blindLines(page: BlindPage): string[] {
  return [
    page.heading,
    ...page.rows.map((r) => `${r.label}: renders ${r.letters.join(', ')}`),
    ...page.questions.map((q, i) => `Q${i + 1}. ${q}`),
    page.howToSave
  ]
}

/** M14's six curves (§6.15's row), the ones to name when no other list is wanted. */
export const M14_CURVES: readonly MotionEase[] = Object.freeze(['expo-out', 'out-cubic', 'spring1', 'linear', 'decelerate', 'carbon-expressive'])

/** Every ease a curve rating may name: `CurveName`'s and `spring1` (§6.13). A `Record` so the compiler holds it to the type. */
const EASE_NAMES: Record<MotionEase, true> = {
  'expo-out': true,
  decelerate: true,
  accelerate: true,
  standard: true,
  'out-cubic': true,
  'out-back': true,
  linear: true,
  'carbon-expressive': true,
  spring1: true
}

/** Why `curves` cannot run (§6.11's row: names and a clip id); null when it can. */
export function curvesError(options: { names?: unknown; clipId?: unknown } | null | undefined): string | null {
  const names = options?.names
  if (!Array.isArray(names) || names.length < 1 || names.length > BLIND_LETTERS.length) return `curves takes { names, clipId }: 1 to ${BLIND_LETTERS.length} curve names (M14's are ${M14_CURVES.join(', ')})`
  const unknown = names.filter((n) => typeof n !== 'string' || !Object.hasOwn(EASE_NAMES, n))
  if (unknown.length > 0) return `curves: not a curve: ${unknown.map((n) => JSON.stringify(n)).join(', ')} (the curves are ${Object.keys(EASE_NAMES).join(', ')})`
  if (new Set(names).size !== names.length) return 'curves: name each curve once'
  if (typeof options?.clipId !== 'string' || options.clipId === '') return 'curves: name the graphic clip with clipId'
  return null
}

/** Why `look` cannot run: clip ids, each once; null when it can. */
export function lookError(options: { clipIds?: unknown } | null | undefined): string | null {
  const ids = options?.clipIds
  if (!Array.isArray(ids) || ids.length < 1 || ids.some((id) => typeof id !== 'string' || id === '')) return 'look takes { clipIds }: the ids of graphic clips of the open project'
  if (new Set(ids).size !== ids.length) return 'look: name each clip once'
  return null
}

/** The look rating's renders per clip (§6.10 step 1): four presets, and `clean` again with the dim on. */
export const LOOK_VARIANTS: readonly { name: string; styleId: string; overrides?: { dim: true } }[] = Object.freeze([
  { name: 'clean', styleId: 'clean' },
  { name: 'bold', styleId: 'bold' },
  { name: 'editorial', styleId: 'editorial' },
  { name: 'energetic', styleId: 'energetic' },
  { name: 'clean with dim', styleId: 'clean', overrides: { dim: true } }
])

/** M14's question (§6.10 step 2), shown beside its renders. */
export const CURVE_QUESTIONS: readonly string[] = Object.freeze(['Watch each letter without the key. Which is best? Which is second?'])

/** The look rating's questions (§6.10 step 2), per graphic, answered without the key, shown beside its renders. */
export const LOOK_QUESTIONS: readonly string[] = Object.freeze([
  'Does it look like a pro reveal or tutorial? Rate each letter 1 to 5.',
  'Restrained against energetic: which would you ship?',
  'Is the dim wanted?',
  'Would motion blur on the fast moves help? Yes or no.',
  'Would a check tick beside a step help? Yes or no.',
  'Does the energetic style want more (ripples, a burst)? Yes or no.',
  'Is any duration too quick or too slow? Name the template.'
])

/** The look rating wants at least this many graphics, covering the eight templates (§6.10 step 1). */
export const LOOK_MIN_CLIPS = 6

/** The line a clip id that names no clip of the open project is refused with. */
export const noClipLine = (clipId: string): string => `No clip "${clipId}" in the open project.`
/** The line a clip that is not a graphic clip is refused with. */
export const notGraphicLine = (clipId: string): string => `Clip "${clipId}" is not a graphic clip: name a clip a graphic was made into.`

/** The graphic clip of `project` named `clipId`, or the plain line it is refused with. */
export function graphicClipOf(project: Pick<Project, 'clips'>, clipId: string): { clip: Clip & { graphic: GraphicSpec } } | { refused: string } {
  const clip = project.clips.find((c) => c.id === clipId)
  if (!clip) return { refused: noClipLine(clipId) }
  if (!clip.graphic) return { refused: notGraphicLine(clipId) }
  return { clip: clip as Clip & { graphic: GraphicSpec } }
}

/** The ratings' rate (§6.10: "at 30 fps"). */
export const BLIND_FPS = 30

/** A clip's frames at `BLIND_FPS`: its length in the project's frames, at the project's rate, at least 1. */
export function framesAt(durationFrames: number, projectFps: number, fps = BLIND_FPS): number {
  if (!(projectFps > 0) || !(durationFrames > 0)) return 1
  return Math.max(1, Math.round((durationFrames / projectFps) * fps))
}

/** Where §6.10 keeps a rating's key, by the date of the run (`YYYY-MM-DD`). */
export function keyPath(option: 'curves' | 'look', date: string): string {
  return `tests/output/graphic/${option}/key-${date.slice(0, 10)}.json`
}

/**
 * How to save a rating's key without seeing it (§6.10, "the key is returned
 * in the result object, not shown"): a `const` statement echoes nothing, and
 * the copy routes never print it.
 */
export function saveKeyLine(option: 'curves' | 'look', date: string): string {
  return (
    `Run it as const r = await window.__forgeGraphicCheck(...) so the console echoes nothing; before you watch, save the key: copy(r.${option}.key) where the console has copy() (Chrome), ` +
    `or, in the development app (whose console has no copy()), setTimeout(() => navigator.clipboard.writeText(JSON.stringify(r.${option}.key)), 3000) and click the page within 3 s; ` +
    `paste it into ${keyPath(option, date)} (gitignored). The page and the summary show letters only.`
  )
}
