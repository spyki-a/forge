import { describe, it, expect } from 'vitest'
import {
  DURATIONS,
  cubicBezier,
  curve,
  easeCurve,
  entrance,
  progress,
  spring,
  type CurveName,
  type EntranceName,
  type MotionEase,
  type SpringParams
} from '@shared/graphics/motion'

/*
 * The motion module (docs/CLIPS.md §6.13): the curves every graphic moves on,
 * the closed-form spring, progress against a beat, the entrances.
 *
 * M9 (§6.15) is the spring case below: the closed form against a
 * semi-implicit Euler integration with 1,000 substeps a frame, sampled on
 * each frame at 24, 25, 30 and 60 fps, within 1e-4 of the travel (that
 * tolerance is §6.13's proposal, taken as written), with the largest
 * difference and the cost per call printed for EFFECTS.md §61.
 */

/** Every CurveName, as a Record so a name added to the type without a case here fails typecheck. */
const CURVE_SET: Record<CurveName, true> = {
  'expo-out': true,
  decelerate: true,
  accelerate: true,
  standard: true,
  'out-cubic': true,
  'out-back': true,
  linear: true,
  'carbon-expressive': true
}
const CURVE_NAMES = Object.keys(CURVE_SET) as CurveName[]
const EASES: MotionEase[] = [...CURVE_NAMES, 'spring1']

/** §6.13's control points, for the curves defined as a Bézier. */
const BEZIER_POINTS: [CurveName, [number, number, number, number]][] = [
  ['expo-out', [0.16, 1, 0.3, 1]],
  ['decelerate', [0.05, 0.7, 0.1, 1.0]],
  ['accelerate', [0.3, 0, 0.8, 0.15]],
  ['standard', [0.2, 0, 0, 1]],
  ['carbon-expressive', [0, 0, 0.3, 1]]
]

/** An independent reference: the Bernstein form, x solved for its parameter by bisection alone. */
function bezierReference([x1, y1, x2, y2]: [number, number, number, number], x: number): number {
  const b = (t: number, p1: number, p2: number): number => 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t
  let lo = 0
  let hi = 1
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (b(mid, x1, x2) < x) lo = mid
    else hi = mid
  }
  return b((lo + hi) / 2, y1, y2)
}

/** §6.3's `beatFrame` (graphics/frame.ts, still to be built): the first frame at or after the beat. */
const beatFrame = (beat: number, fps: number): number => Math.ceil(beat * fps - 1e-6)

const RATES = [24, 25, 30, 60]

describe('the curves', () => {
  it('every CurveName is 0 at 0 and exactly 1 at 1, and spring1 as well', () => {
    for (const name of CURVE_NAMES) {
      expect(curve(name)(0), `${name} at 0`).toBe(0)
      expect(curve(name)(1), `${name} at 1`).toBe(1)
    }
    expect(easeCurve('spring1')(0)).toBe(0)
    expect(easeCurve('spring1')(1)).toBe(1)
  })

  it('every curve but out-back is monotone over 1,000 points and never passes 1; none goes below 0', () => {
    for (const name of CURVE_NAMES) {
      const f = curve(name)
      let previous = f(0)
      for (let i = 1; i <= 1000; i++) {
        const y = f(i / 1000)
        expect(y, `${name} at ${i / 1000}`).toBeGreaterThanOrEqual(0)
        if (name === 'out-back') continue
        expect(y, `${name} monotone at ${i / 1000}`).toBeGreaterThanOrEqual(previous)
        expect(y, `${name} passes 1 at ${i / 1000}`).toBeLessThanOrEqual(1)
        previous = y
      }
    }
  })

  it('no curve but out-back passes 1 even in the last 1e-4 of its run, to the bit', () => {
    for (const name of CURVE_NAMES) {
      if (name === 'out-back') continue
      const f = curve(name)
      const over: number[] = []
      for (let k = 10_000; k >= 1; k--) {
        const x = 1 - k * 1e-8
        if (f(x) > 1) over.push(x)
      }
      expect(over.slice(0, 3), `${name} above 1 at ${over.length} points`).toEqual([])
    }
  })

  it("expo-out and decelerate match the research's table at 10, 20, 30 and 50 % within 0.01", () => {
    // docs/research/graphics-motion-research-2026-10-17.md §1.4, computed there from each definition.
    const table: [CurveName, number[]][] = [
      ['expo-out', [0.49, 0.75, 0.88, 0.97]],
      ['decelerate', [0.62, 0.78, 0.87, 0.95]]
    ]
    for (const [name, values] of table) {
      ;[0.1, 0.2, 0.3, 0.5].forEach((x, i) => {
        expect(Math.abs(curve(name)(x) - values[i]), `${name} at ${x}: ${curve(name)(x)}`).toBeLessThanOrEqual(0.01)
      })
    }
  })

  it('cubicBezier matches a bisection reference within 1e-6 at 101 points, for every Bézier curve and its named curve', () => {
    for (const [name, points] of BEZIER_POINTS) {
      const direct = cubicBezier(...points)
      for (let i = 0; i <= 100; i++) {
        const x = i / 100
        const want = bezierReference(points, x)
        expect(Math.abs(direct(x) - want), `cubicBezier ${name} at ${x}`).toBeLessThanOrEqual(1e-6)
        expect(Math.abs(curve(name)(x) - want), `curve ${name} at ${x}`).toBeLessThanOrEqual(1e-6)
      }
    }
  })

  it('cubicBezier is right near its ends too, where Newton alone does not settle in 8 steps', () => {
    for (const [name, points] of BEZIER_POINTS) {
      const f = cubicBezier(...points)
      for (const x of [1e-6, 1e-4, 1e-3, 1 - 1e-3, 1 - 1e-6]) {
        expect(Math.abs(f(x) - bezierReference(points, x)), `${name} at ${x}`).toBeLessThanOrEqual(1e-6)
      }
    }
  })

  it('out-cubic equals 1 − (1 − x)³ at 64 points', () => {
    for (let i = 0; i < 64; i++) {
      const x = i / 63
      expect(curve('out-cubic')(x)).toBe(1 - Math.pow(1 - x, 3))
    }
  })

  it('out-back overshoots 10.0 % at 58 % of the duration', () => {
    const f = curve('out-back')
    let peak = 0
    let at = 0
    for (let i = 0; i <= 10_000; i++) {
      const y = f(i / 10_000)
      if (y > peak) {
        peak = y
        at = i / 10_000
      }
    }
    expect((peak - 1) * 100).toBeCloseTo(10.0, 1)
    expect(at).toBeCloseTo(0.58, 2)
  })

  it("out-back is easings.net's easeOutBack with §6.13's c1 = 1.70158, within 1e-12, not the captions' 1.7", () => {
    // The 10.0 % above holds for both constants (9.984 % at 1.7, 10.000 % at
    // 1.70158); the formula tells them apart, by 1.6e-4 at 0.58.
    const c1 = 1.70158
    const formula = (x: number): number => 1 + (c1 + 1) * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
    for (const x of [0.05, 0.2, 0.4, 0.58, 0.8, 0.95]) {
      expect(Math.abs(curve('out-back')(x) - formula(x)), `out-back at ${x}`).toBeLessThanOrEqual(1e-12)
    }
  })

  it('spring1 ends exactly at 1 with no overshoot', () => {
    const f = easeCurve('spring1')
    let previous = f(0)
    for (let i = 1; i <= 1000; i++) {
      const y = f(i / 1000)
      expect(y).toBeGreaterThanOrEqual(previous)
      expect(y).toBeLessThanOrEqual(1)
      previous = y
    }
    expect(f(1)).toBe(1)
  })

  it("spring1 is §6.13's 1 − (1 + kx) e^(−kx) with k = 9.23, divided by its value at 1, within 1e-12 inside its run", () => {
    // k is §6.13's definition, not a proposal, and M14 compares this shape
    // blind; the ends and the monotone case above hold for any k once the
    // curve is normalised. A change of 0.01 in k moves 0.25 by 5.7e-4.
    const k = 9.23
    const raw = (x: number): number => 1 - (1 + k * x) * Math.exp(-k * x)
    const f = easeCurve('spring1')
    for (const x of [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
      expect(Math.abs(f(x) - raw(x) / raw(1)), `spring1 at ${x}`).toBeLessThanOrEqual(1e-12)
    }
  })

  it("the k spring1 draws with leaves §6.13's 0.1 % residual at x = 1 before the division", () => {
    // Read back from the module, not written in: f(0.5) / f(0.25) is
    // raw(0.5) / raw(0.25) whatever the division, and falls as k grows
    // (strictly, from k = 1 to 40, measured), so bisection finds the module's
    // k. §6.13: "the residual at x = 1 is 0.1 % (computed)".
    const raw = (k: number, x: number): number => 1 - (1 + k * x) * Math.exp(-k * x)
    const f = easeCurve('spring1')
    const target = f(0.5) / f(0.25)
    let lo = 1
    let hi = 40
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2
      if (raw(mid, 0.5) / raw(mid, 0.25) > target) lo = mid
      else hi = mid
    }
    const k = (lo + hi) / 2
    const residual = 1 - raw(k, 1)
    expect(residual, `the residual at k = ${k}`).toBeGreaterThanOrEqual(0.0009)
    expect(residual, `the residual at k = ${k}`).toBeLessThanOrEqual(0.0011)
  })

  it('every curve, and spring1, reads exactly 0 below 0 and exactly 1 above 1, the same way', () => {
    // progress clamps before it calls a curve; a template calling one directly
    // with an unclamped x must not get out-cubic's −2.375 at −0.5 from one name
    // and a Bézier's 0 from another.
    const eases: [string, (x: number) => number][] = [
      ...CURVE_NAMES.map((name): [string, (x: number) => number] => [name, curve(name)]),
      ['spring1', easeCurve('spring1')]
    ]
    for (const [name, f] of eases) {
      for (const x of [-0.5, -1e-9, -10]) expect(f(x), `${name} at ${x}`).toBe(0)
      for (const x of [1.5, 1 + 1e-9, 10]) expect(f(x), `${name} at ${x}`).toBe(1)
    }
  })
})

describe('the spring', () => {
  it('at ζ = 1 never overshoots, from rest, either way', () => {
    const p: SpringParams = { zeta: 1, omega: 10 }
    for (let i = 0; i <= 5000; i++) {
      const t = i / 1000
      expect(spring(t, p).x, `up at ${t}`).toBeLessThanOrEqual(1)
      expect(spring(t, p, 1, 0).x, `down at ${t}`).toBeGreaterThanOrEqual(0)
    }
  })

  it('at ζ = 0.5 overshoots about 16 %, by the damped oscillator: e^(−πζ/√(1−ζ²)) at t = π/ωd', () => {
    const p: SpringParams = { zeta: 0.5, omega: 10 } // Remotion's spring() defaults: mass 1, stiffness 100, damping 10
    const expected = Math.exp((-Math.PI * p.zeta) / Math.sqrt(1 - p.zeta * p.zeta))
    const peakTime = Math.PI / (p.omega * Math.sqrt(1 - p.zeta * p.zeta))
    let peak = 0
    for (let i = 0; i <= 30_000; i++) peak = Math.max(peak, spring(i / 10_000, p).x)
    expect(peak - 1).toBeGreaterThan(0.155)
    expect(peak - 1).toBeLessThan(0.165)
    expect(Math.abs(spring(peakTime, p).x - 1 - expected)).toBeLessThanOrEqual(1e-12)
    expect(peak - 1).toBeLessThanOrEqual(expected + 1e-12)
  })

  it('M9: the closed form within 1e-4 of the travel of semi-implicit Euler (1,000 substeps a frame) on every frame at 24, 25, 30 and 60 fps', () => {
    // ω = 4 rad/s: the reference's own error is first order in its step, in
    // proportion to ω·dt, so at ω = 10 it reads 1.0-1.7e-4 at 24-30 fps by
    // itself (measured 2026-10-27; the next block shows it is the reference's).
    const cases: { name: string; p: SpringParams; from: number; to: number; v0: number }[] = [
      { name: 'critical', p: { zeta: 1, omega: 4 }, from: 0, to: 1, v0: 0 },
      // v0 + ζω·(from − to) weighs the sine term: −1 here, so the case reads that term (v0 = 2 would make it 0).
      { name: 'under', p: { zeta: 0.5, omega: 4 }, from: 0, to: 1, v0: 1 },
      { name: 'over', p: { zeta: 2, omega: 4 }, from: 20, to: 120, v0: -50 }
    ]
    const largest: Record<number, number> = {}
    for (const fps of RATES) {
      largest[fps] = 0
      for (const c of cases) {
        const difference = largestDifference(c.p, c.from, c.to, c.v0, fps, 1000, 3)
        expect(difference, `${c.name} at ${fps} fps`).toBeLessThan(1e-4)
        largest[fps] = Math.max(largest[fps], difference)
      }
    }

    // At Remotion's default spring, where 1,000 substeps a frame are too
    // coarse for 1e-4, doubling them halves the difference: the reference
    // converges on the closed form at first order, so the remainder is its own.
    const fast: SpringParams = { zeta: 0.5, omega: 10 }
    const coarse: Record<number, number> = {}
    const ratio: Record<number, number> = {}
    for (const fps of RATES) {
      coarse[fps] = largestDifference(fast, 0, 1, 0, fps, 1000, 3)
      ratio[fps] = coarse[fps] / largestDifference(fast, 0, 1, 0, fps, 2000, 3)
      expect(ratio[fps], `halving at ${fps} fps`).toBeGreaterThan(1.9)
      expect(ratio[fps], `halving at ${fps} fps`).toBeLessThan(2.1)
    }

    // The closed form's cost per call (one call a frame per spring).
    let sink = 0
    for (let i = 0; i < 20_000; i++) sink += spring(i / 3000, cases[i % 3].p, cases[i % 3].from, cases[i % 3].to, cases[i % 3].v0).x
    const calls = 300_000
    const begin = performance.now()
    for (let i = 0; i < calls; i++) sink += spring((i % 90) / 30, cases[i % 3].p, cases[i % 3].from, cases[i % 3].to, cases[i % 3].v0).x
    const nanoseconds = ((performance.now() - begin) * 1e6) / calls
    expect(Number.isFinite(sink)).toBe(true)

    const at = (r: Record<number, number>, digits: (n: number) => string): string => RATES.map((fps) => `${fps} fps ${digits(r[fps])}`).join(', ')
    process.stderr.write(
      `graphicMotion: M9 the closed-form spring against semi-implicit Euler, 1,000 substeps a frame, 3 s, ω = 4 rad/s at ζ 1, 0.5, 2: ` +
        `largest difference ${at(largest, (n) => n.toExponential(2))} of the travel (bar 1e-4); ` +
        `at ω = 10, ζ = 0.5 (not asserted against 1e-4) the difference reads ${at(coarse, (n) => n.toExponential(2))}, ` +
        `and halves with 2,000 substeps (ratio ${at(ratio, (n) => n.toFixed(4))}), the reference's own first-order error; ` +
        `cost ${nanoseconds.toFixed(1)} ns a call (${process.platform}, node ${process.version})\n`
    )
  })

  it('its velocity is the derivative of its position, in every case and from a moving start', () => {
    const cases: [SpringParams, number, number, number][] = [
      [{ zeta: 0.5, omega: 10 }, 0, 1, 0],
      [{ zeta: 0.3, omega: 7 }, 5, -3, 4],
      [{ zeta: 1, omega: 10 }, 0, 1, 0],
      [{ zeta: 1, omega: 6 }, 2, 8, -9],
      [{ zeta: 2, omega: 10 }, 0, 1, 0],
      [{ zeta: 1.4, omega: 5 }, 10, 0, 12]
    ]
    const h = 1e-6
    for (const [p, from, to, v0] of cases) {
      const scale = Math.max(Math.abs(to - from), Math.abs(v0) / p.omega) * p.omega
      expect(spring(0, p, from, to, v0)).toEqual({ x: from, v: v0 })
      for (let i = 1; i <= 30; i++) {
        const t = i / 20
        const slope = (spring(t + h, p, from, to, v0).x - spring(t - h, p, from, to, v0).x) / (2 * h)
        expect(Math.abs(spring(t, p, from, to, v0).v - slope), `ζ ${p.zeta} at ${t}`).toBeLessThanOrEqual(1e-6 * scale)
      }
    }
  })

  it('is continuous across ζ = 1: just under and just over read as the critical case', () => {
    for (const t of [0.05, 0.2, 0.5, 1.1]) {
      const critical = spring(t, { zeta: 1, omega: 8 }, 0, 1, 3)
      for (const zeta of [1 - 1e-9, 1 + 1e-9]) {
        const near = spring(t, { zeta, omega: 8 }, 0, 1, 3)
        expect(Math.abs(near.x - critical.x), `x at ζ ${zeta}, ${t}`).toBeLessThanOrEqual(1e-6)
        expect(Math.abs(near.v - critical.v), `v at ζ ${zeta}, ${t}`).toBeLessThanOrEqual(1e-6)
      }
    }
  })

  it('depends on the time only: 0.2 s at 30 and at 60 fps equal, bit for bit, however it was reached', () => {
    expect(6 / 30).toBe(12 / 60)
    const params: [SpringParams, number, number, number][] = [
      [{ zeta: 1, omega: 10 }, 0, 1, 0],
      [{ zeta: 0.5, omega: 10 }, 0, 1, 2],
      [{ zeta: 2, omega: 10 }, 20, 120, -50]
    ]
    for (const [p, from, to, v0] of params) {
      let at30 = spring(0, p, from, to, v0)
      for (let frame = 1; frame <= 6; frame++) at30 = spring(frame / 30, p, from, to, v0)
      let at60 = spring(0, p, from, to, v0)
      for (let frame = 1; frame <= 12; frame++) at60 = spring(frame / 60, p, from, to, v0)
      expect(at60).toEqual(at30)
      spring(0.7, { zeta: 0.4, omega: 3 }, 9, -9, 1)
      expect(spring(0.2, { ...p }, from, to, v0)).toEqual(at30)
    }
  })

  it('keeps no state: two calls at one time are equal, however the calls before them ran', () => {
    const p: SpringParams = { zeta: 0.6, omega: 9 }
    const first = spring(0.37, p, 0, 1, 1)
    expect(spring(0.37, p, 0, 1, 1)).toEqual(first)
    let walked = first
    for (const t of [0.1, 0.2, 0.3, 0.37]) walked = spring(t, p, 0, 1, 1)
    expect(walked).toEqual(first)
    spring(1.3, p, 0, 1, 1)
    spring(0.05, p, 0, 1, 1)
    spring(0.9, { zeta: 2, omega: 9 }, 5, -5, 3)
    expect(spring(0.37, p, 0, 1, 1)).toEqual(first)
  })

  it('is at its start before t = 0, and settled when its parameters are not a spring', () => {
    const p: SpringParams = { zeta: 0.5, omega: 10 }
    expect(spring(-1, p, 3, 7, 2)).toEqual({ x: 3, v: 2 })
    expect(spring(Number.NaN, p, 3, 7, 2)).toEqual({ x: 3, v: 2 })
    expect(spring(0.4, { zeta: 1, omega: 0 }, 3, 7, 2)).toEqual({ x: 7, v: 0 })
    expect(spring(0.4, { zeta: -0.1, omega: 10 }, 3, 7, 2)).toEqual({ x: 7, v: 0 })
    expect(spring(0.4, { zeta: Number.NaN, omega: 10 }, 3, 7, 2)).toEqual({ x: 7, v: 0 })
  })
})

describe('progress', () => {
  it('is 0 before its start and 1 from its end on, under every ease', () => {
    for (const ease of EASES) {
      for (const seconds of [DURATIONS.entrance, DURATIONS.swap, DURATIONS.loop]) {
        const start = 2
        // start − 1.1e-6 holds the allowance under 1.1e-6 s (§6.13's 1e-6 s).
        for (const t of [0, 1.5, start - 1e-3, start - 2e-6, start - 1.1e-6]) expect(progress(t, start, seconds, ease), `${ease} at ${t}`).toBe(0)
        for (const t of [start + seconds, start + seconds + 1e-3, start + seconds + 0.5, start + 10 * seconds]) {
          expect(progress(t, start, seconds, ease), `${ease} at ${t}`).toBe(1)
        }
      }
    }
  })

  it('with a duration not above 0 is a cut at its start: 0 before it, 1 at it and after, under every ease', () => {
    const start = 2
    for (const ease of EASES) {
      for (const seconds of [0, -0.35, -5, Number.NaN]) {
        for (const t of [0, start - 1e-3, start - 2e-6, start - 1.1e-6]) {
          expect(progress(t, start, seconds, ease), `${ease}, ${seconds} s, at ${t}`).toBe(0)
        }
        for (const t of [start, start + 1e-9, start + 0.35, start + 10]) {
          expect(progress(t, start, seconds, ease), `${ease}, ${seconds} s, at ${t}`).toBe(1)
        }
      }
    }
  })

  it('is exactly 1 on the frame its beat names, and not 1 the frame before, at 24, 25, 30 and 60 fps, beats on and between frames', () => {
    for (const fps of RATES) {
      for (const frame of [12, 31, 47]) {
        const beats: [string, number][] = [
          ['on the frame', frame / fps],
          ['a hair before the frame', (frame - 1e-9) / fps],
          ['a hair after the frame, within beatFrame’s 1e-6', (frame + 0.9e-6) / fps],
          ['a third of the way to the next', (frame + 0.37) / fps],
          ['halfway to the next', (frame + 0.5) / fps]
        ]
        for (const [where, beat] of beats) {
          const named = beatFrame(beat, fps)
          for (const ease of EASES) {
            for (const seconds of [DURATIONS.entrance, DURATIONS.swap]) {
              const start = beat - seconds
              const label = `${ease}, ${seconds} s, beat ${where} ${frame} at ${fps} fps`
              expect(progress(named / fps, start, seconds, ease), label).toBe(1)
              const before = progress((named - 1) / fps, start, seconds, ease)
              expect(before, `${label}, the frame before`).not.toBe(1)
              if (ease !== 'out-back') expect(before, `${label}, the frame before`).toBeLessThan(1)
            }
          }
        }
      }
    }
  })
})

describe('the entrances and the durations', () => {
  it('rise comes up from half the text’s height and fades in; pop scales up to 1 and fades in', () => {
    expect(entrance('rise', 0)).toEqual({ dy: 0.5, scale: 1, opacity: 0, blur: 0 })
    expect(entrance('rise', 1)).toEqual({ dy: 0, scale: 1, opacity: 1, blur: 0 })
    // pop's starting scale, 0.92, is a proposal (§6.5): held below 1, not pinned.
    const popStart = entrance('pop', 0)
    expect(popStart.scale).toBeGreaterThan(0)
    expect(popStart.scale).toBeLessThan(1)
    expect({ ...popStart, scale: 0 }).toEqual({ dy: 0, scale: 0, opacity: 0, blur: 0 })
    expect(entrance('pop', 1)).toEqual({ dy: 0, scale: 1, opacity: 1, blur: 0 })
    const overshoot = entrance('pop', curve('out-back')(0.58))
    expect(overshoot.scale).toBeGreaterThan(1)
    expect(overshoot.opacity).toBe(1)
  })

  it('blur-rise and wipe resolve to rise, with no blur (M5 did not allow it, §6.15)', () => {
    const resolved: EntranceName[] = ['blur-rise', 'wipe']
    for (const name of resolved) {
      for (const p of [0, 0.25, 0.6, 1]) expect(entrance(name, p), `${name} at ${p}`).toEqual(entrance('rise', p))
    }
    for (const name of ['rise', 'pop', 'blur-rise', 'wipe'] as EntranceName[]) {
      for (const p of [0, 0.5, 1]) expect(entrance(name, p).blur).toBe(0)
    }
  })

  it('every duration is a positive number of seconds, and the table is frozen', () => {
    for (const key of ['entrance', 'exit', 'swap', 'dim', 'stroke', 'headGrow', 'loop'] as const) {
      expect(DURATIONS[key], key).toBeGreaterThan(0)
      expect(Number.isFinite(DURATIONS[key]), key).toBe(true)
    }
    expect(Object.isFrozen(DURATIONS)).toBe(true)
  })

  it("every duration lies in §6.13's range read; swap and headGrow, given no range, against the jobs they are part of", () => {
    // The values are proposals the look rating revises (§6.10), so they are
    // held to the plan's ranges, not pinned: a revision inside a range stays
    // green, a typo (entrance 3.5) does not. exit's "about 0.12-0.3" is taken
    // at its figures.
    const ranges: [keyof typeof DURATIONS, number, number][] = [
      ['entrance', 0.3, 0.4],
      ['exit', 0.12, 0.3],
      ['dim', 0.3, 0.7],
      ['stroke', 0.35, 0.6],
      ['loop', 5, 6]
    ]
    for (const [key, low, high] of ranges) {
      expect(DURATIONS[key], key).toBeGreaterThanOrEqual(low)
      expect(DURATIONS[key], key).toBeLessThanOrEqual(high)
    }
    // swap is "the old element's exit in a content swap": no longer than an exit.
    expect(DURATIONS.swap, 'swap against exit').toBeLessThanOrEqual(DURATIONS.exit)
    // headGrow is "the riding head's scale-in": shorter than an entrance.
    expect(DURATIONS.headGrow, 'headGrow against entrance').toBeLessThan(DURATIONS.entrance)
  })
})

/** The largest difference, as a fraction of the travel, between the closed form and semi-implicit Euler stepped frame by frame. */
function largestDifference(p: SpringParams, from: number, to: number, v0: number, fps: number, substeps: number, seconds: number): number {
  const dt = 1 / fps / substeps
  const k = p.omega * p.omega
  const c = 2 * p.zeta * p.omega
  let x = from
  let v = v0
  let largest = 0
  for (let frame = 1; frame <= Math.ceil(seconds * fps); frame++) {
    for (let i = 0; i < substeps; i++) {
      v += (-c * v - k * (x - to)) * dt
      x += v * dt
    }
    largest = Math.max(largest, Math.abs(spring(frame / fps, p, from, to, v0).x - x) / Math.abs(to - from))
  }
  return largest
}
