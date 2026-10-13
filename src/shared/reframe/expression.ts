/**
 * The flat sum — the expression a followed crop's x (and y) is compiled into
 * (docs/CLIPS.md §4.7, step 1f).
 *
 * `keyframeExpression` nests one `if(lt(t,…),…)` per key, and ffmpeg's
 * expression parser refuses that past a hundred levels: as the crop's x inside
 * `max(0,min(…,in_w-out_w))` it rendered 96 held keys and refused 97, and 91
 * smooth keys and refused 92 ("Missing ')' or too many args", EFFECTS.md §48,
 * re-measured for this slice). A podcast of 120 shots is past that. A sum is
 * not nested at all:
 *
 *     base
 *     + Δ*gte(t,(f − 0.5)/fps)                       one per held step
 *     + Δ*(p)*(p)*(3-2*(p)),
 *         p = min(1,max(0,(t − t0)/span))            one per eased pan
 *
 * Measured on the Mac's 4.4 build inside buildRenderPlan's own chain, through
 * the graph file (EFFECTS.md §52 and this slice's measure phase): 2,998 terms,
 * an x of 220,580 characters, rendered frame-exact on 3,000 of 3,000 frames,
 * in 17.9 s against a static crop's 14.0–15.4 s. The held step's boundary is
 * §45's half frame, `(f − 0.5)/fps` to 6 dp, so frame f − 1 is below it and
 * frame f is not at any rate. The ease is smoothstep, p²(3 − 2p) —
 * `keyframes.ts`' 'smooth', the curve the path's pans promise (path.ts `Pan`).
 *
 * Flat in parentheses is not flat on the stack: the parser's tree for
 * `a+b+c…` is a chain as long as the sum, and a flat sum past about 7,000
 * terms crashed ffmpeg at a 1 MB stack (measured). So a sum longer than
 * `FLAT_GROUP` terms is written in parenthesised groups (below).
 *
 * `flatSumAt` is the same arithmetic in JavaScript, on the constants exactly
 * as written into the expression, so the preview cannot disagree with the
 * export by a rounding. The export's crop then puts x at `lrint(x) & ~1` on a
 * 4:2:0 picture (measured: 425.92 → 426, 219.00 → 218), which is
 * `exportPixel`.
 */

/** A step held from frame `atFrame` on: frame atFrame − 1 does not have it, frame atFrame does. */
export interface HeldTerm {
  atFrame: number
  delta: number
}

/** An eased move of `delta`, smoothstep from frame `fromFrame` to frame `toFrame`. */
export interface PanTerm {
  fromFrame: number
  toFrame: number
  delta: number
}

export type Term = HeldTerm | PanTerm

/** A value over a clip: where it starts, and every change after, as differences. */
export interface FlatSum {
  base: number
  terms: Term[]
}

export interface FlatSumOptions {
  fps: number
  /** Seconds added to every time. A crop's `t` is clip-relative after the input seek (§4.7), so 0 there. */
  startSeconds: number
  /** What "now" is called in the target filter; `t` by default. */
  timeVar?: string
  /** Decimal places of the base and the differences; 0 by default, a crop's pixels. */
  precision?: number
}

export function isHeld(term: Term): term is HeldTerm {
  return 'atFrame' in term
}

/** The frame a term starts on — the order the sum is written in. */
export function termFrame(term: Term): number {
  return isHeld(term) ? term.atFrame : term.fromFrame
}

/** Smoothstep, p²(3 − 2p), with p clamped: the one ease the path, the preview and the export share. */
export function smoothstep(progress: number): number {
  const p = Math.min(1, Math.max(0, progress))
  return p * p * (3 - 2 * p)
}

/**
 * Where the export's crop actually cuts for a position: `lrint(x) & ~1`, the
 * crop filter on a chroma-subsampled picture (EFFECTS.md §52, and 3,000 of
 * 3,000 frames read back from a tap in this slice's measure). `Math.round`
 * rounds a half up where `lrint` rounds it to even, and the two agree once
 * the low bit is cleared. A 4:4:4 or RGB picture is not snapped (vf_crop.c's
 * hsub; not run on one), and neither was a crop whose format a later
 * `format=gray` had negotiated through `split` (measured: x landed on
 * `lrint(x)`, odd on 671 of 3,000 frames).
 */
export function exportPixel(value: number): number {
  return Math.round(value) & ~1
}

/** The constants as written: what the expression says, and what `flatSumAt` reads back. */
interface Written {
  base: string
  terms: { term: Term; delta: string; at?: string; t0?: string; span?: string }[]
}

/** A sum is written once per set of options: the preview reads it every frame. */
const writtenCache = new WeakMap<FlatSum, Map<string, Written>>()

function written(sum: FlatSum, options: FlatSumOptions): Written {
  const key = `${options.fps}|${options.startSeconds}|${options.precision ?? 0}`
  const byOptions = writtenCache.get(sum) ?? new Map<string, Written>()
  const hit = byOptions.get(key)
  if (hit) return hit
  const w = write(sum, options)
  byOptions.set(key, w)
  writtenCache.set(sum, byOptions)
  return w
}

function write(sum: FlatSum, options: FlatSumOptions): Written {
  const { fps, startSeconds } = options
  const precision = options.precision ?? 0
  if (!(fps > 0) || !Number.isFinite(fps)) throw new Error(`A flat sum needs a frame rate, not ${fps}`)
  if (!Number.isFinite(startSeconds)) throw new Error(`A flat sum cannot start at ${startSeconds} s`)
  if (!Number.isFinite(sum.base)) throw new Error(`A flat sum cannot start from ${sum.base}`)
  // `toFixed(0)` writes −0.4 as "-0": a value is written from its rounded number, so zero is "0".
  const fixed = (v: number): string => {
    const r = Number(v.toFixed(precision))
    return (Object.is(r, -0) ? 0 : r).toFixed(precision)
  }

  // In frame order, a step before a pan on the same frame; otherwise as given.
  const ordered = sum.terms
    .map((term, i) => ({ term, i }))
    .sort((a, b) => termFrame(a.term) - termFrame(b.term) || Number(isHeld(b.term)) - Number(isHeld(a.term)) || a.i - b.i)

  const terms: Written['terms'] = []
  for (const { term } of ordered) {
    if (!Number.isFinite(term.delta)) throw new Error(`A flat sum's term cannot move by ${term.delta}`)
    const delta = fixed(term.delta)
    // A difference that rounds to nothing changes nothing; it is not written.
    if (Number(delta) === 0) continue
    if (isHeld(term)) {
      if (!Number.isFinite(term.atFrame)) throw new Error(`A held step cannot be on frame ${term.atFrame}`)
      terms.push({ term, delta, at: (startSeconds + (term.atFrame - 0.5) / fps).toFixed(6) })
    } else {
      if (!Number.isFinite(term.fromFrame) || !Number.isFinite(term.toFrame) || !(term.toFrame > term.fromFrame)) {
        throw new Error(`A pan must end after it starts, not frames ${term.fromFrame} to ${term.toFrame}`)
      }
      const span = ((term.toFrame - term.fromFrame) / fps).toFixed(6)
      if (!(Number(span) > 0)) throw new Error(`A pan of frames ${term.fromFrame} to ${term.toFrame} is too short to write at ${fps} fps`)
      terms.push({ term, delta, t0: (startSeconds + term.fromFrame / fps).toFixed(6), span })
    }
  }
  return { base: fixed(sum.base), terms }
}

/**
 * How many terms one level of the sum holds before the rest go in groups.
 *
 * The parser builds `a+b+c…` as a LEFT-NESTED chain of additions
 * (libavutil/eval.c's parse_subexpr loop, the same at f22fcd4), and
 * evaluating, checking and freeing it all recurse down that chain — so a
 * flat sum is one level deep in parentheses but N calls deep on the stack.
 * Measured on the Mac's build under `ulimit -s`: at a 1 MB stack a flat sum
 * of 7,000 terms rendered and 7,300 died of SIGSEGV; at 8 MB, 60,000 died.
 * (A Windows main thread's stack is 1 MB under MSVC's default and 2 MB under
 * MinGW's; the 2018 build's own reserve is not read.) Past this many terms
 * the sum is written `base+(t1…t1000)+(t1001…t2000)+…`: each group is a
 * chain of at most this many, the groups one more, so the depth is about
 * GROUP + N/GROUP — 60,000 terms rendered at a 1 MB stack in groups of 1,000.
 * A sum of this many terms or fewer is written flat, exactly as measured.
 */
export const FLAT_GROUP = 1000

/** One written term's text. */
function termText(t: Written['terms'][number], tv: string): string {
  const d = t.delta.startsWith('-') ? t.delta : `+${t.delta}`
  if (t.at !== undefined) return `${d}*gte(${tv},${t.at})`
  // A pan that began before the clip's first frame has a negative start;
  // `t--0.5` parses (measured), `t+0.5` is plainer.
  const since = t.t0!.startsWith('-') ? `${tv}+${t.t0!.slice(1)}` : `${tv}-${t.t0}`
  const p = `min(1,max(0,(${since})/${t.span}))`
  return `${d}*(${p})*(${p})*(3-2*(${p}))`
}

/**
 * The expression: the base, then each term in frame order, each `+Δ` or `-Δ`
 * on the same level — never nested, and built by a loop, not recursion. Past
 * `FLAT_GROUP` terms they are written in parenthesised groups of that many,
 * which bounds how deep ffmpeg's evaluator recurses (above).
 */
export function flatSumExpression(sum: FlatSum, options: FlatSumOptions): string {
  const tv = options.timeVar ?? 't'
  const w = written(sum, options)
  const texts = w.terms.map((t) => termText(t, tv))
  if (texts.length <= FLAT_GROUP) return w.base + texts.join('')
  const parts = [w.base]
  for (let i = 0; i < texts.length; i += FLAT_GROUP) parts.push(`+(${texts.slice(i, i + FLAT_GROUP).join('')})`)
  return parts.join('')
}

/**
 * The sum's value at a frame, raw (before the crop's clamp and `exportPixel`):
 * the expression's own arithmetic on its written constants, in its order —
 * a grouped sum adds each group up from its first term, then the group to
 * the running value, as the parser's tree does. `t` is formed as the crop
 * forms it after `fps=`, the frame's pts times the time base:
 * `frame × (1/fps)`.
 */
export function flatSumAt(sum: FlatSum, frame: number, options: FlatSumOptions): number {
  const w = written(sum, options)
  const t = options.startSeconds + frame * (1 / options.fps)
  const of = (term: Written['terms'][number]): number => contribution(term, t)
  let value = Number(w.base)
  if (w.terms.length <= FLAT_GROUP) {
    for (const term of w.terms) value += of(term)
    return value
  }
  for (let i = 0; i < w.terms.length; i += FLAT_GROUP) {
    let group = 0
    for (const term of w.terms.slice(i, i + FLAT_GROUP)) group += of(term)
    value += group
  }
  return value
}

/** One written term's part of the sum at time `t`, in the expression's own order of operations. */
function contribution(term: Written['terms'][number], t: number): number {
  const d = Number(term.delta)
  if (term.at !== undefined) return d * (t >= Number(term.at) ? 1 : 0)
  const p = Math.min(1, Math.max(0, (t - Number(term.t0)) / Number(term.span)))
  return d * p * p * (3 - 2 * p)
}

/**
 * The same sum on frames [from, to) only, for a command that runs those
 * frames and no others — the moments' pull (render/momentFrames.ts), whose
 * `-vf` goes on a command line: the whole clip's sums there were 45,989
 * characters for a 20-minute clip with a cut every 4 s, past Windows'
 * 32,767 (`spawn ENAMETOOLONG`, EFFECTS.md §47). Every term that changes
 * nothing on those frames is left out: one over by `from` (a step on or
 * before it, a pan ended by it) is added into the base while it is still a
 * prefix of the terms in written order, and one not begun by `to` is
 * dropped. What is left is a few terms whatever the clip's length.
 *
 * On those frames the value is the whole sum's: bit for bit for a sum written
 * flat (its prefix's partial sums are whole numbers, exactly the base here,
 * and a term that adds ±0 changes nothing); a GROUPED sum (past `FLAT_GROUP`)
 * adds the same numbers in another order, which can differ in the last bit
 * and so in the pixel only on an exact k + ½. Pixels only: precision 0.
 */
export function windowSum(sum: FlatSum, from: number, to: number, options: FlatSumOptions): FlatSum {
  if ((options.precision ?? 0) !== 0) throw new Error('A flat sum is windowed in whole pixels only')
  const w = written(sum, options)
  const times: number[] = []
  for (let n = Math.floor(from); n < to; n++) times.push(options.startSeconds + n * (1 / options.fps))
  let base = Number(w.base)
  let prefix = true
  const terms: Term[] = []
  for (const written of w.terms) {
    const d = Number(written.delta)
    const parts = times.map((t) => contribution(written, t))
    if (parts.every((v) => v === 0)) continue
    if (prefix && parts.every((v) => v === d)) {
      base += d
      continue
    }
    prefix = false
    terms.push(written.term)
  }
  return { base, terms }
}
