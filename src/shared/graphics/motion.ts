/**
 * The motion module: every graphic's curves, its spring, its entrances and
 * its durations (docs/CLIPS.md §6.13; D9, §16.62: "One module,
 * `graphics/motion.ts`, above the graphic style, read by graphics first").
 * Every template reads its curves and durations from here; the model never
 * picks a curve, a duration or a sound (the research, §4.5).
 *
 * Pure: no clock, no state, no imports. Every value is a function of its
 * arguments alone, so a frame drawn twice, or at another frame rate, or in
 * the preview and then in the export, moves the same.
 *
 * Not the camera's moves: those are `render/motion.ts`, another module. The
 * captions' `easeOut` and `backOut` (`render/textAnimation.ts`) and the zoom
 * punches move onto this module only after phase 2's ratings, as their own
 * change (D9).
 */

/** The named curves (§6.13's table). Each is exact at 0 and at 1. */
export type CurveName =
  | 'expo-out'
  | 'decelerate'
  | 'accelerate'
  | 'standard'
  | 'out-cubic'
  | 'out-back'
  | 'linear'
  | 'carbon-expressive'

/**
 * A curve, or `spring1`. Named so, not `Ease`, because `render/keyframes.ts`
 * already exports an `Ease` (the keys' `'linear' | 'hold' | 'smooth'`), and
 * two exported types of one name are an anchor trap (§6.5).
 */
export type MotionEase = CurveName | 'spring1'

/**
 * The entrances of §6.5, by the name a graphic style carries. `wipe` and
 * `blur-rise` stay in the type and resolve to `rise` (see `entrance`).
 */
export type EntranceName = 'rise' | 'pop' | 'wipe' | 'blur-rise'

/** A damped spring: ζ, the damping ratio, and ω, the natural frequency in radians a second. */
export interface SpringParams {
  zeta: number
  omega: number
}

/* ------------------------------------------------------------------ Bézier */

/** Newton-Raphson steps before the bisection fallback (§6.13). */
const NEWTON_STEPS = 8
/** How close the solved x must be; well under what any y tolerance needs. */
const SOLVE_EPSILON = 1e-12
/** Bisection halvings: 64 reach below a double's resolution on [0, 1]. */
const BISECT_STEPS = 64

/**
 * A CSS `cubic-bezier(x1, y1, x2, y2)` as a function of x: solves x for the
 * curve's parameter by Newton-Raphson (8 steps) with a bisection fallback, and
 * returns y. Exact at the ends: 0 at or below x = 0, 1 at or above x = 1.
 * x1 and x2 must lie in [0, 1], as CSS requires, so x grows with the
 * parameter and has one root in [0, 1]. When y1 and y2 lie in [0, 1] too, y
 * is held in [0, 1]: the polynomial is, but in doubles it read
 * 1.0000000000000002 at 2,163 of 100,001 points within 1e-4 of expo-out's
 * end (measured 2026-10-27). Written here rather than taken as a dependency
 * (`bezier-easing` "not needed", the research, §4.9).
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  // The polynomial coefficients, a t³ + b t² + c t, of each axis.
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const bounded = y1 >= 0 && y1 <= 1 && y2 >= 0 && y2 <= 1
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx
  const solve = (x: number): number => {
    let t = x
    for (let i = 0; i < NEWTON_STEPS; i++) {
      const error = sampleX(t) - x
      if (Math.abs(error) < SOLVE_EPSILON && t >= 0 && t <= 1) return t
      const slope = slopeX(t)
      if (Math.abs(slope) < 1e-6) break
      t -= error / slope
    }
    // Newton did not settle inside [0, 1] (a flat start, as carbon-expressive's
    // at x = 0, takes more than 8 steps): bisect, x being monotone in t.
    let lo = 0, hi = 1
    t = x
    for (let i = 0; i < BISECT_STEPS; i++) {
      const error = sampleX(t) - x
      if (Math.abs(error) < SOLVE_EPSILON) return t
      if (error < 0) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return t
  }
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    const y = sampleY(solve(x))
    return bounded ? Math.min(1, Math.max(0, y)) : y
  }
}

/* ------------------------------------------------------------------ curves */

/** easings.net's easeOutBack constant; the captions' `backOut` uses 1.7, 10.0 % overshoot at 58 % either way. */
const BACK_C1 = 1.70158
const BACK_C3 = BACK_C1 + 1

/** `out-back`: overshoot and settle. Its formula reads 2.2e-16 at 0 in doubles, so its ends are set. */
function outBack(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const u = x - 1
  return 1 + BACK_C3 * u * u * u + BACK_C1 * u * u
}

/**
 * x held to [0, 1] for a curve given by a formula: below 0 reads 0, above 1
 * reads 1 (NaN stays NaN, as through a Bézier). The formula then makes the
 * end itself, so a formula not exact there is not hidden behind a set end.
 */
const unit = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/**
 * Each curve carries its own exact ends (`cubicBezier`'s, `outBack`'s, or a
 * formula exact there, read at x clamped by `unit`), never a wrapper here:
 * `expo-out` is the Bézier form because 1 − 2^(−10x) ends at 0.99902, not 1.
 * Every curve is held to [0, 1] the same way, exactly 0 below 0 and exactly 1
 * above 1: the Béziers and `outBack` return their ends there, `out-cubic` and
 * `linear` clamp x (before, out-cubic read −2.375 at −0.5 and linear 1.5 at
 * 1.5, measured 2026-10-28). `progress` clamps before it calls a curve, so
 * nothing it drew changed.
 */
const CURVES: Record<CurveName, (x: number) => number> = {
  /** The default entrance, and a counter's arrival until M14 (the research's §1.4, [17]). */
  'expo-out': cubicBezier(0.16, 1, 0.3, 1),
  /** An alternative entrance: Material's emphasized decelerate, [23]. */
  decelerate: cubicBezier(0.05, 0.7, 0.1, 1.0),
  /** Exits: Material's emphasized accelerate, [23]. */
  accelerate: cubicBezier(0.3, 0, 0.8, 0.15),
  /** Moves within the frame, [23]. */
  standard: cubicBezier(0.2, 0, 0, 1),
  /** Kept: it is the captions' `easeOut` (`render/textAnimation.ts`). */
  'out-cubic': (x) => 1 - Math.pow(1 - unit(x), 3),
  /** The `pop` entrance only, in the energetic style, [25]. */
  'out-back': outBack,
  /** Loops only: beams, marching dashes, sweeps, [27]. */
  linear: (x) => unit(x),
  /** IBM Carbon's expressive entrance, [26]; compared in M14 (chosen 2026-10-21). */
  'carbon-expressive': cubicBezier(0, 0, 0.3, 1)
}

/**
 * The curve of a name: a function of x in [0, 1], 0 at 0 and exactly 1 at 1.
 * Every name clamps the same way outside it, exactly 0 below 0 and exactly 1
 * above 1 (see `CURVES`), so a template that calls a curve with an unclamped
 * x gets the same behaviour whichever curve it named.
 */
export function curve(name: CurveName): (x: number) => number {
  return CURVES[name]
}

/** `spring1`'s rate: the residual 1 − (1 + k) e^(−k) at x = 1 is 0.1 % (computed). */
const SPRING1_K = 9.23
const spring1Raw = (x: number): number => 1 - (1 + SPRING1_K * x) * Math.exp(-SPRING1_K * x)
const SPRING1_END = spring1Raw(1)

/**
 * `spring1`: the critically damped response as a curve of fixed length,
 * 1 − (1 + kx) e^(−kx) with k = 9.23, divided by its value at 1 so it ends
 * exactly there, the 0.1 % residual spread over the move rather than left as
 * a jump on the last frame. A curve that ends on the beat, not a spring used
 * as the clock of an arrival, which the research rejects (its §7.5). x is
 * clamped by `unit` as the other formulas' are (before, it read 366.4 at −0.5
 * and 1.00099 at 1.5), so its end at 1 is still the division's, not set.
 */
function spring1(x: number): number {
  return spring1Raw(unit(x)) / SPRING1_END
}

/** The ease of a `MotionEase`: the named curve, or `spring1`, held to [0, 1] as every curve is. */
export function easeCurve(name: MotionEase): (x: number) => number {
  return name === 'spring1' ? spring1 : curve(name)
}

/* ------------------------------------------------------------------ spring */

/**
 * A damped spring's position and velocity at `t` seconds, in closed form for
 * the under-, critically and over-damped cases (written here from the damped
 * oscillator's solution, as Motion's generator evaluates position and
 * velocity at any t; the research, §4.6, [32]). It starts at `from` with
 * velocity `v0` (units a second) and settles on `to`.
 *
 * **A pure function of t**: never stateful integration, never the clock of an
 * arrival on a word. It serves settles that need velocity continuity, a
 * content swap's entering element for one (the research, §4.4). Before its
 * start (t ≤ 0, or not a number) it is at `from` with `v0`; parameters that
 * are not a spring (ω not above 0, ζ below 0, either not finite) read as
 * already settled, at `to` and still.
 */
export function spring(t: number, p: SpringParams, from = 0, to = 1, v0 = 0): { x: number; v: number } {
  const { zeta, omega } = p
  if (!(omega > 0) || !(zeta >= 0) || !Number.isFinite(omega) || !Number.isFinite(zeta)) return { x: to, v: 0 }
  if (!(t > 0)) return { x: from, v: v0 }
  const d0 = from - to // the displacement from rest, at t = 0
  if (zeta === 1) {
    // Critically damped: (d0 + (v0 + ω d0) t) e^(−ωt).
    const b = v0 + omega * d0
    const decay = Math.exp(-omega * t)
    return { x: to + decay * (d0 + b * t), v: decay * (v0 - omega * b * t) }
  }
  if (zeta < 1) {
    // Under-damped: e^(−ζωt) (d0 cos ωd t + ((v0 + ζω d0) / ωd) sin ωd t).
    const a = zeta * omega
    const wd = omega * Math.sqrt(1 - zeta * zeta)
    const decay = Math.exp(-a * t)
    const cos = Math.cos(wd * t)
    const sin = Math.sin(wd * t)
    const b = (v0 + a * d0) / wd
    return {
      x: to + decay * (d0 * cos + b * sin),
      v: decay * (v0 * cos - ((omega * omega * d0 + a * v0) / wd) * sin)
    }
  }
  // Over-damped: c1 e^(r1 t) + c2 e^(r2 t), r1 the slower root.
  const root = omega * Math.sqrt(zeta * zeta - 1)
  const r1 = -zeta * omega + root
  const r2 = -zeta * omega - root
  const c1 = (v0 - r2 * d0) / (r1 - r2)
  const c2 = d0 - c1
  const e1 = Math.exp(r1 * t)
  const e2 = Math.exp(r2 * t)
  return { x: to + c1 * e1 + c2 * e2, v: r1 * c1 * e1 + r2 * c2 * e2 }
}

/* ---------------------------------------------------------------- progress */

/**
 * The allowance `progress` adds, in seconds: larger than the 1e-6 of a frame
 * `beatFrame` subtracts (§6.3), so a frame whose time is a hair before the
 * beat, which `beatFrame` may name, still reads exactly 1.
 */
const PROGRESS_ALLOWANCE_S = 1e-6

/**
 * Where a move is at `t`: the ease of clamp((t − start + 1e-6) / seconds, 0,
 * 1). A template that must arrive on a beat starts its curve at
 * `beat − seconds`, so progress is 1 on the frame `beatFrame` names and below
 * 1 the frame before (above it, under `out-back`, which overshoots). A
 * duration not above 0 is a cut at `start`; a time that is not a number
 * reads 0.
 */
export function progress(t: number, start: number, seconds: number, ease: MotionEase): number {
  const f = easeCurve(ease)
  if (!(seconds > 0)) return f(t - start + PROGRESS_ALLOWANCE_S >= 0 ? 1 : 0)
  const x = (t - start + PROGRESS_ALLOWANCE_S) / seconds
  return f(x > 0 ? (x < 1 ? x : 1) : 0)
}

/* --------------------------------------------------------------- entrances */

/** `rise` starts half the text's height below its place (§6.5). */
const RISE_FROM = 0.5
/** `pop` starts at this scale (§6.5: 0.92, a proposal). */
const POP_FROM = 0.92

/**
 * An entrance's four values at progress `p` (the eased value, which may pass
 * 1 under `out-back`): the one place the entrances of §6.5 are defined. `dy`
 * and `blur` are fractions of the text's pixel size, `dy` down positive.
 *
 * - `rise`: up from half the text's height, opacity 0 to 1 (§6.5: "up from
 *   half the text's height, opacity to 1").
 * - `pop`: scale from 0.92 (§6.5, a proposal); with `out-back`, only in the
 *   energetic style, the scale passes 1 and settles. Its fade, opacity 0 to
 *   1, is not §6.5's words, which give `pop` the scale alone. It is taken
 *   from the captions' pop (`render/textAnimation.ts`,
 *   `alpha: Math.min(1, t * 3)`) and from §6.2's keyword row, where the
 *   card "scales from 0.92 (proposal) with a rise and fade". The fade's
 *   shape, opacity equal to the eased progress clamped to [0, 1] rather
 *   than the captions' linear ramp over the first third of the time, is
 *   this module's choice; so is `pop`'s `dy` of 0, though that row names a
 *   rise as well.
 * - `blur-rise` is `rise`: phase 0 did not allow its blur (M5, 2026-10-27,
 *   §6.15's final note: blur adds 38.60 ms a frame at p95 on the Surface,
 *   against M1's p50 encode of 32.70 at the box and pool 4), so `blur` is 0
 *   for every entrance and `DrawItem` has no blur.
 * - `wipe` is `rise`: a masked reveal waits for a source that times it and
 *   phase 2's ratings (the research, §7.4).
 */
export function entrance(name: EntranceName, p: number): { dy: number; scale: number; opacity: number; blur: number } {
  const q = Number.isFinite(p) ? p : 0
  const opacity = q > 0 ? (q < 1 ? q : 1) : 0
  if (name === 'pop') return { dy: 0, scale: POP_FROM + (1 - POP_FROM) * q, opacity, blur: 0 }
  return { dy: RISE_FROM * (1 - q), scale: 1, opacity, blur: 0 }
}

/* --------------------------------------------------------------- durations */

/**
 * Seconds per job. Every value is a proposal from the research's §1.4 (the
 * range read beside each); the look rating revises them (§6.10). The clip's
 * own 0.3 s fade is not here: it is `EXIT_S`, drawn by the keys (§6.3).
 * Frozen, so no template can change a duration for every other.
 */
export const DURATIONS = Object.freeze({
  /** 0.3-0.4 read. */
  entrance: 0.35,
  /** About 0.12-0.3 read. */
  exit: 0.2,
  /** The old element's exit in a content swap. */
  swap: 0.12,
  /** 0.3-0.7 read (Carbon's background dim, 700 ms). */
  dim: 0.5,
  /** 0.35-0.6 read, for a draw-on. */
  stroke: 0.45,
  /** The riding head's scale-in. */
  headGrow: 0.1,
  /** 5-6 read, linear. */
  loop: 5.5
})
