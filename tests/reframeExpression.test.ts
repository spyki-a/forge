import { describe, expect, it } from 'vitest'
import { exportPixel, flatSumAt, flatSumExpression, smoothstep, type FlatSum, type Term } from '@shared/reframe/expression'
import { keyframeExpression, valueAt } from '@shared/render/keyframes'
import { evaluateFlatSum, parenDepth, parseFlatSum } from './fixtures/flatSum'

/*
 * The flat sum (docs/CLIPS.md §4.7; EFFECTS.md §48, §52): the expression a
 * followed crop's x and y compile into, because a nested `if` per key is
 * refused past 96 held keys (91 smooth) as the crop's x. The shape below is
 * the one measured frame-exact over 3,000 frames inside buildRenderPlan's own
 * chain, up to 2,998 terms; these tests hold the compiler to it.
 */

const FPS = 30
const opts = { fps: FPS, startSeconds: 0 }

/** Every occurrence of `needle`, so an anchor is counted before it is trusted. */
const count = (hay: string, needle: string): number => hay.split(needle).length - 1

describe('flatSumExpression — the shape', () => {
  it('writes the base first, then every term in frame order, whatever order they came in', () => {
    const sum: FlatSum = {
      base: 656,
      terms: [
        { fromFrame: 40, toFrame: 58, delta: -200 },
        { atFrame: 90, delta: 500 },
        { atFrame: 30, delta: 344 }
      ]
    }
    const e = flatSumExpression(sum, opts)
    const first = '+344*gte(t,0.983333)'
    const pan = '-200*(min(1,max(0,(t-1.333333)/0.600000)))'
    const last = '+500*gte(t,2.983333)'
    for (const anchor of [first, pan, last]) expect(count(e, anchor), anchor).toBe(1)
    expect(e.startsWith('656+344*gte(')).toBe(true)
    expect(e.indexOf(first)).toBeLessThan(e.indexOf(pan))
    expect(e.indexOf(pan)).toBeLessThan(e.indexOf(last))
    expect(parseFlatSum(e).terms.map((t) => t.kind)).toEqual(['held', 'pan', 'held'])
  })

  it("puts a held step's boundary half a frame before its frame, to 6 dp — frame f − 1 below it, frame f not (§45)", () => {
    // The measured anchors: frame 30 at 30 fps is 0.983333 (§4.7's two-up check), frame 5 the ≡ 2 (mod 3) case §3.2 fixed.
    expect(flatSumExpression({ base: 0, terms: [{ atFrame: 30, delta: 2 }] }, opts)).toBe('0+2*gte(t,0.983333)')
    expect(flatSumExpression({ base: 0, terms: [{ atFrame: 5, delta: 2 }] }, opts)).toBe('0+2*gte(t,0.150000)')
    for (const fps of [24, 25, 30, 60]) {
      for (let f = 1; f <= 400; f++) {
        const [term] = parseFlatSum(flatSumExpression({ base: 0, terms: [{ atFrame: f, delta: 2 }] }, { fps, startSeconds: 0 })).terms
        // The crop's t on frame n after fps= is n × (1/fps).
        expect((f - 1) * (1 / fps) < term.at, `${fps} fps frame ${f - 1}`).toBe(true)
        expect(f * (1 / fps) >= term.at, `${fps} fps frame ${f}`).toBe(true)
      }
    }
  })

  it("writes a pan as smoothstep's exact text — the same P three times, (P)*(P)*(3-2*(P))", () => {
    const e = flatSumExpression({ base: 100, terms: [{ fromFrame: 270, toFrame: 288, delta: 300 }] }, opts)
    const p = 'min(1,max(0,(t-9.000000)/0.600000))'
    expect(e).toBe(`100+300*(${p})*(${p})*(3-2*(${p}))`)
  })

  it('writes a pan that began before the clip as t+…, which every build parses', () => {
    // Started 10 frames before the clip's first: t0 = −0.333333. `t--0.333333` parses too
    // (measured with aevalsrc on the Mac's 4.4), but `t+` needs no measuring.
    const e = flatSumExpression({ base: 396, terms: [{ fromFrame: -10, toFrame: 8, delta: 300 }] }, opts)
    expect(count(e, '(t+0.333333)')).toBe(3)
    expect(e).not.toContain('--')
    expect(evaluateFlatSum(e, 0, FPS)).toBeCloseTo(396 + 300 * smoothstep(10 / 18), 2)
  })

  it('writes integers at precision 0, leaves out a difference that rounds to nothing, and never writes "-0"', () => {
    const e = flatSumExpression({ base: -0.2, terms: [{ atFrame: 3, delta: 0.4 }, { atFrame: 6, delta: -1.6 }] }, opts)
    expect(e).toBe('0-2*gte(t,0.183333)')
    expect(flatSumExpression({ base: 10, terms: [{ atFrame: 3, delta: 1.25 }] }, { ...opts, precision: 2 })).toBe('10.00+1.25*gte(t,0.083333)')
  })

  it('refuses a pan that does not end after it starts', () => {
    expect(() => flatSumExpression({ base: 0, terms: [{ fromFrame: 10, toFrame: 10, delta: 4 }] }, opts)).toThrow(/end after it starts/)
    expect(() => flatSumExpression({ base: 0, terms: [{ atFrame: Number.NaN, delta: 4 }] }, opts)).toThrow()
  })
})

describe('flatSumExpression — never nested', () => {
  /** n terms: alternating held steps and pans, a frame grid like a long podcast's. */
  function many(n: number): FlatSum {
    const terms: Term[] = []
    for (let i = 0; i < n; i++) {
      const f = 10 + i * 12
      terms.push(i % 2 === 0 ? { atFrame: f, delta: i % 4 === 0 ? 200 : -200 } : { fromFrame: f, toFrame: f + 9, delta: i % 3 === 0 ? 40 : -40 })
    }
    return { base: 656, terms }
  }

  it('compiles 1,000 terms, every one on the same level: as deep as 2 terms are, with no if(', () => {
    const big = flatSumExpression(many(1000), opts)
    const small = flatSumExpression(many(2), opts)
    expect([...big.matchAll(/\*gte\(t,/g)].length).toBe(500)
    expect([...big.matchAll(/\*\(3-2\*\(/g)].length).toBe(500)
    expect(big).not.toContain('if(')
    expect(parenDepth(big)).toBe(parenDepth(small))
    expect(parenDepth(big)).toBeLessThanOrEqual(5)
    expect(parseFlatSum(big).terms).toHaveLength(1000)
  })

  it('is what keyframeExpression is not: its nested shape grows a level per key', () => {
    // The contrast that makes the flat sum necessary (§48: refused past 96 held keys as the crop's x).
    const keys = Array.from({ length: 40 }, (_, i) => ({ frame: i * 3, value: i % 2 ? 900 : 300, ease: 'hold' as const }))
    const nested = keyframeExpression(keys, { durationFrames: 120, fps: FPS, startSeconds: 0, fallback: 656, precision: 0 })
    expect(parenDepth(nested)).toBeGreaterThanOrEqual(40)
  })
})

describe('flatSumAt — the preview reads what the export runs', () => {
  it("equals the expression's own text, evaluated, on every frame of a 300-term sum (raw, to the last bit)", () => {
    const terms: Term[] = []
    let seed = 7
    const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let i = 0; i < 300; i++) {
      const f = 5 + i * 10 + Math.floor(next() * 4)
      const delta = 2 * Math.round((next() - 0.5) * 300)
      terms.push(i % 2 ? { fromFrame: f, toFrame: f + 3 + Math.floor(next() * 7), delta } : { atFrame: f, delta })
    }
    const sum: FlatSum = { base: 640, terms }
    const e = flatSumExpression(sum, opts)
    for (let n = 0; n < 3010; n++) expect(flatSumAt(sum, n, opts), `frame ${n}`).toBe(evaluateFlatSum(e, n, FPS))
  })

  it("eases by smoothstep, keyframes.ts' 'smooth' — the curve the path's pans promise", () => {
    const keys = [
      { frame: 0, value: 0, ease: 'smooth' as const },
      { frame: 18, value: 1 }
    ]
    for (let n = 0; n <= 18; n++) expect(smoothstep(n / 18)).toBeCloseTo(valueAt(keys, n, 18, 0), 12)
    expect(smoothstep(-1)).toBe(0)
    expect(smoothstep(2)).toBe(1)
  })

  it("rounds as the export's crop cuts, lrint & ~1 — the values read back from the render", () => {
    // From the measure phase's tap and EFFECTS.md §52: 425.92 → 426, 435.84 → 436, 405 → 404, and the pans' rows.
    const rows: [number, number][] = [
      [425.92, 426], [435.84, 436], [405, 404], [282.25, 282], [257.06, 256], [219.0, 218],
      [858.35, 858], [885.57, 886], [931.26, 930], [600.01, 600], [530.67, 530], [499.0, 498], [0, 0]
    ]
    for (const [raw, cut] of rows) expect(exportPixel(raw), String(raw)).toBe(cut)
  })
})
