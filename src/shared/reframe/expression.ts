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
 * The expression: the base, then each term in frame order, each `+Δ` or `-Δ`
 * on the same level — never nested, so its depth is the same for one term as
 * for three thousand, and it is built by a loop, not recursion.
 */
export function flatSumExpression(sum: FlatSum, options: FlatSumOptions): string {
  const tv = options.timeVar ?? 't'
  const w = written(sum, options)
  const parts = [w.base]
  for (const t of w.terms) {
    const d = t.delta.startsWith('-') ? t.delta : `+${t.delta}`
    if (t.at !== undefined) {
      parts.push(`${d}*gte(${tv},${t.at})`)
    } else {
      // A pan that began before the clip's first frame has a negative start;
      // `t--0.5` parses (measured), `t+0.5` is plainer.
      const since = t.t0!.startsWith('-') ? `${tv}+${t.t0!.slice(1)}` : `${tv}-${t.t0}`
      const p = `min(1,max(0,(${since})/${t.span}))`
      parts.push(`${d}*(${p})*(${p})*(3-2*(${p}))`)
    }
  }
  return parts.join('')
}

/**
 * The sum's value at a frame, raw (before the crop's clamp and `exportPixel`):
 * the expression's own arithmetic on its written constants, in its order.
 * `t` is formed as the crop forms it after `fps=`, the frame's pts times the
 * time base: `frame × (1/fps)`.
 */
export function flatSumAt(sum: FlatSum, frame: number, options: FlatSumOptions): number {
  const w = written(sum, options)
  const t = options.startSeconds + frame * (1 / options.fps)
  let value = Number(w.base)
  for (const term of w.terms) {
    const d = Number(term.delta)
    if (term.at !== undefined) {
      value += d * (t >= Number(term.at) ? 1 : 0)
    } else {
      const p = Math.min(1, Math.max(0, (t - Number(term.t0)) / Number(term.span)))
      value += d * p * p * (3 - 2 * p)
    }
  }
  return value
}
