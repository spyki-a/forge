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
