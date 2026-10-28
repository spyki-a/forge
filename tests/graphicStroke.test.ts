import { describe, it, expect } from 'vitest'
import { DURATIONS } from '@shared/graphics/motion'
import {
  STROKE_MIN_PX,
  STROKE_TOLERANCE,
  flattenPath,
  headGrowAt,
  headShape,
  strokeAt,
  strokeShape,
  strokeWidth,
  type PathGeometry,
  type Point,
  type StrokeInput
} from '@shared/graphics/stroke'

/*
 * The stroke primitive (docs/CLIPS.md §6.3, "The stroke primitive"): our own
 * flattening of SVG path data, the visible span of a draw-on, the riding
 * arrowhead and the width rule. Every figure is in frame pixels.
 *
 * The lengths measured here (a quadratic against its closed form, a
 * four-cubic circle against 2πr, at STROKE_TOLERANCE) are printed to stderr
 * as one "graphicStroke:" line, beside M8's later comparison with
 * getTotalLength() in the app (§6.15).
 */

const T = STROKE_TOLERANCE

/** The circle's control-point ratio: 4/3 (√2 − 1), the plan's κ = 0.5523. */
const KAPPA = (4 / 3) * (Math.SQRT2 - 1)

/** A circle as four cubics, clockwise on the frame from its rightmost point, as a template draws a ring. */
function circlePath(cx: number, cy: number, r: number): string {
  const c = KAPPA * r
  return [
    `M${cx + r} ${cy}`,
    `C${cx + r} ${cy + c} ${cx + c} ${cy + r} ${cx} ${cy + r}`,
    `C${cx - c} ${cy + r} ${cx - r} ${cy + c} ${cx - r} ${cy}`,
    `C${cx - r} ${cy - c} ${cx - c} ${cy - r} ${cx} ${cy - r}`,
    `C${cx + c} ${cy - r} ${cx + r} ${cy - c} ${cx + r} ${cy}`,
    'Z'
  ].join(' ')
}

/** A quadratic Bézier's arc length in closed form, the integral of |B′(t)| over [0, 1]. */
function quadraticLength(p0: Point, p1: Point, p2: Point): number {
  const ax = p0.x - 2 * p1.x + p2.x, ay = p0.y - 2 * p1.y + p2.y
  const bx = 2 * (p1.x - p0.x), by = 2 * (p1.y - p0.y)
  const A = 4 * (ax * ax + ay * ay)
  const B = 4 * (ax * bx + ay * by)
  const C = bx * bx + by * by
  const sabc = 2 * Math.sqrt(A + B + C)
  const a2 = Math.sqrt(A)
  const a32 = 2 * A * a2
  const c2 = 2 * Math.sqrt(C)
  const ba = B / a2
  return (a32 * sabc + a2 * B * (sabc - c2) + (4 * C * A - B * B) * Math.log((2 * a2 + ba + sabc) / (ba + c2))) / (4 * a32)
}

/** The same length by Simpson's rule over 20,000 intervals, a check on the closed form. */
function quadraticLengthBySimpson(p0: Point, p1: Point, p2: Point): number {
  const speed = (t: number): number =>
    Math.hypot(2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x), 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y))
  const n = 20_000
  const h = 1 / n
  let sum = speed(0) + speed(1)
  for (let i = 1; i < n; i++) sum += (i % 2 === 1 ? 4 : 2) * speed(i * h)
  return (sum * h) / 3
}

/** The point at length s along a geometry, walked segment by segment from the start: the reference the span is checked against. */
function pointAtLength(path: PathGeometry, s: number): Point {
  let walked = 0
  for (let k = 1; k < path.points.length; k++) {
    const a = path.points[k - 1]
    const b = path.points[k]
    const piece = Math.hypot(b.x - a.x, b.y - a.y)
    if (walked + piece >= s) {
      const u = piece > 0 ? (s - walked) / piece : 0
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
    }
    walked += piece
  }
  return path.points[path.points.length - 1]
}

/** A polyline's own length, summed from its points. */
function polylineLength(points: Point[]): number {
  let sum = 0
  for (let k = 1; k < points.length; k++) sum += Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y)
  return sum
}

function expectPoint(actual: Point | null, expected: Point, digits = 9): void {
  expect(actual).not.toBeNull()
  expect(actual!.x).toBeCloseTo(expected.x, digits)
  expect(actual!.y).toBeCloseTo(expected.y, digits)
}

/** A seeded generator, so the property case draws the same spans every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One long segment and nine short ones: 1,000 px across, then a staircase of nine 10 px steps (total 1,090). */
const LONG_THEN_SHORT = 'M0 0 H1000 v10 h10 v10 h10 v10 h10 v10 h10 v10'

describe('flattenPath', () => {
  it('measures a straight line exactly, and its lengths are cumulative', () => {
    const line = flattenPath('M0 0 L300 400', T)
    expect(line.total).toBe(500)
    expect(line.lengths).toEqual([0, 500])
    expect(line.points).toEqual([{ x: 0, y: 0 }, { x: 300, y: 400 }])
    const bent = flattenPath('M0 0 L300 400 V0 H0', T)
    expect(bent.lengths).toEqual([0, 500, 900, 1200])
    expect(bent.total).toBe(1200)
    const stairs = flattenPath(LONG_THEN_SHORT, T)
    expect(stairs.points).toHaveLength(11)
    expect(stairs.lengths).toEqual([0, 1000, 1010, 1020, 1030, 1040, 1050, 1060, 1070, 1080, 1090])
    expect(stairs.total).toBe(1090)
  })

  it("measures a quadratic within 0.05 % of its closed-form length at the default tolerance", () => {
    const cases: [Point, Point, Point][] = [
      [{ x: 100, y: 800 }, { x: 540, y: 100 }, { x: 980, y: 800 }],
      [{ x: 100, y: 800 }, { x: 900, y: 700 }, { x: 300, y: 200 }]
    ]
    for (const [p0, p1, p2] of cases) {
      const exact = quadraticLength(p0, p1, p2)
      expect(Math.abs(exact / quadraticLengthBySimpson(p0, p1, p2) - 1)).toBeLessThan(1e-9)
      const path = flattenPath(`M${p0.x} ${p0.y} Q${p1.x} ${p1.y} ${p2.x} ${p2.y}`, T)
      expect(Math.abs(path.total / exact - 1), `quadratic through ${p1.x},${p1.y}`).toBeLessThanOrEqual(0.0005)
      expect(path.points[0]).toEqual(p0)
      expect(path.points[path.points.length - 1]).toEqual(p2)
    }
  })

  it('measures a four-cubic circle within 0.05 % of 2πr at the default tolerance, from r = 100 to 540', () => {
    const errors: string[] = []
    for (const r of [20, 50, 100, 200, 400, 540]) {
      const path = flattenPath(circlePath(540, 960, r), T)
      const error = path.total / (2 * Math.PI * r) - 1
      errors.push(`r ${r} ${(error * 100).toFixed(4)} % over ${path.points.length - 1} pieces`)
      if (r >= 100) expect(Math.abs(error), `r = ${r}`).toBeLessThanOrEqual(0.0005)
      // Every point the flattening keeps lies on the curve, so within the four-cubic circle's own radial error (0.027 %) of r.
      for (const p of path.points) expect(Math.abs(Math.hypot(p.x - 540, p.y - 960) / r - 1)).toBeLessThan(0.0003)
    }
    const quadratic = flattenPath('M100 800 Q540 100 980 800', T)
    const exact = quadraticLength({ x: 100, y: 800 }, { x: 540, y: 100 }, { x: 980, y: 800 })
    process.stderr.write(
      `graphicStroke: at STROKE_TOLERANCE ${T} px, a four-cubic circle's flattened length against 2πr: ${errors.join('; ')}; ` +
        `the quadratic M100 800 Q540 100 980 800 ${((quadratic.total / exact - 1) * 100).toFixed(4)} % over ${quadratic.points.length - 1} pieces\n`
    )
  })

  it('gives relative commands the same points as absolute ones, every command and repeated arguments included', () => {
    const absolute =
      'M10 20 L110 20 120 30 H210 V120 C230 140 250 160 270 120 S310 80 330 120 Q350 160 370 120 T410 120 L410 200 Z'
    const relative = 'm10 20 l100 0 10 10 h90 v90 c20 20 40 40 60 0 s40 -40 60 0 q20 40 40 0 t40 0 l0 80 z'
    expect(flattenPath(relative, T)).toEqual(flattenPath(absolute, T))
    // A moveto's further pairs are linetos, relative after an m; numbers packed as SVG allows.
    expect(flattenPath('m10 20 100 0 0 50', T)).toEqual(flattenPath('M10 20 L110 20 L110 70', T))
    expect(flattenPath('M10-20L30.5.5', T).points).toEqual([{ x: 10, y: -20 }, { x: 30.5, y: 0.5 }])
    expect(flattenPath('M 1e2,2E1 l -5e1 , 0', T).points).toEqual([{ x: 100, y: 20 }, { x: 50, y: 20 }])
  })

  it('reflects the previous control point for S and T, and uses the current point when there is none', () => {
    expect(flattenPath('M0 0 C10 20 30 20 40 0 S70 -20 80 0', T)).toEqual(
      flattenPath('M0 0 C10 20 30 20 40 0 C50 -20 70 -20 80 0', T)
    )
    expect(flattenPath('M0 0 Q20 40 40 0 T80 0', T)).toEqual(flattenPath('M0 0 Q20 40 40 0 Q60 -40 80 0', T))
    expect(flattenPath('M0 0 L40 0 S70 -20 80 0', T)).toEqual(flattenPath('M0 0 L40 0 C40 0 70 -20 80 0', T))
    // A T after no quadratic is a straight line to its end.
    expect(flattenPath('M0 0 L40 0 T80 0', T).points).toEqual([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 80, y: 0 }])
  })

  it('refuses A, and the rest it cannot draw as one subpath', () => {
    expect(() => flattenPath('M0 0 A10 10 0 0 1 20 0', T)).toThrow(/arcs \("A"\) are refused/)
    expect(() => flattenPath('M0 0 a10 10 0 0 1 20 0', T)).toThrow(/arcs \("A"\) are refused/)
    expect(() => flattenPath('M0 0 L10 0 M20 0 L30 0', T)).toThrow(/second moveto/)
    expect(() => flattenPath('M0 0 L10 0 Z m20 0 l10 0', T)).toThrow(/second moveto/)
    expect(() => flattenPath('L10 0', T)).toThrow(/begin with a moveto/)
    expect(() => flattenPath('M0 0 L10', T)).toThrow(/missing a number/)
    expect(() => flattenPath('M0 0 Z 5', T)).toThrow(/no command before it/)
    expect(() => flattenPath('M0 0 X10 0', T)).toThrow(/is not path data/)
    for (const tolerance of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => flattenPath('M0 0 L10 0', tolerance)).toThrow(RangeError)
    }
    expect(flattenPath('', T)).toEqual({ points: [], lengths: [], total: 0 })
  })

  it('flattens the same path to the same points twice, and after another path', () => {
    const d = 'm100 100 c20 -40 60 -40 80 0 s60 40 80 0 q40 -40 80 0 t80 0 l20 20 z'
    const first = flattenPath(d, T)
    expect(flattenPath(d, T)).toEqual(first)
    flattenPath('M500 500 L900 900 Q950 950 1000 900', T)
    expect(flattenPath(d, T)).toEqual(first)
    expect(first.points[0]).toEqual({ x: 100, y: 100 })
  })
})

describe('strokeAt', () => {
  it('ends strokeAt(path, 0, 0.5) on the point at half the length, over one long and nine short segments', () => {
    const path = flattenPath(LONG_THEN_SHORT, T)
    const half = strokeAt(path, 0, 0.5)
    expect(half.points).toEqual([{ x: 0, y: 0 }, { x: 545, y: 0 }])
    expect(half.tip).toEqual({ x: 545, y: 0 })
    expect(half.length).toBe(545)
    const inner = strokeAt(path, 0.25, 0.95)
    expect(inner.points).toEqual([
      { x: 272.5, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 10 },
      { x: 1010, y: 10 },
      { x: 1010, y: 20 },
      { x: 1015.5, y: 20 }
    ])
    expect(inner.length).toBeCloseTo((0.95 - 0.25) * path.total, 9)
    expect(polylineLength(inner.points)).toBeCloseTo(inner.length, 9)
  })

  it('has a span whose length is (to − from) × total, starting at from and ending at to, over a curved path', () => {
    const path = flattenPath('M100 1500 C300 900 700 1300 900 600 S500 200 300 300 Q100 400 150 150 L800 100', T)
    const random = mulberry32(7)
    for (let n = 0; n < 200; n++) {
      const a = random()
      const b = random()
      const from = Math.min(a, b)
      const to = Math.max(a, b)
      const span = strokeAt(path, from, to)
      expect(span.length).toBeCloseTo((to - from) * path.total, 9)
      expect(Math.abs(polylineLength(span.points) - span.length)).toBeLessThan(1e-9 * path.total)
      expectPoint(span.points[0], pointAtLength(path, from * path.total), 7)
      expectPoint(span.tip, pointAtLength(path, to * path.total), 7)
      expect(span.points[span.points.length - 1]).toEqual(span.tip)
    }
  })

  it('puts the tip at the visible end, to, not at the path’s end', () => {
    const path = flattenPath('M0 0 L1000 0', T)
    expect(strokeAt(path, 0, 0.3).tip).toEqual({ x: 300, y: 0 })
    expect(strokeAt(path, 0.1, 0.3).points).toEqual([{ x: 100, y: 0 }, { x: 300, y: 0 }])
    expect(strokeAt(path, 0, 1).tip).toEqual({ x: 1000, y: 0 })
    const stairs = flattenPath(LONG_THEN_SHORT, T)
    expectPoint(strokeAt(stairs, 0, 0.9).tip, pointAtLength(stairs, 0.9 * 1090))
  })

  it('turns the tangent 0 on a horizontal line, ±90 on a vertical one, and to the incoming segment at a corner', () => {
    expect(strokeAt(flattenPath('M0 0 H300', T), 0, 0.5).tangent).toBe(0)
    expect(strokeAt(flattenPath('M300 0 H0', T), 0, 0.5).tangent).toBe(180)
    expect(strokeAt(flattenPath('M0 0 V300', T), 0, 0.5).tangent).toBe(90)
    expect(strokeAt(flattenPath('M0 300 V0', T), 0, 0.5).tangent).toBe(-90)
    const corner = flattenPath('M0 0 L100 0 L100 100', T)
    // The tip on the corner itself: the segment arriving there, not the one leaving.
    expect(strokeAt(corner, 0, 0.5).tip).toEqual({ x: 100, y: 0 })
    expect(strokeAt(corner, 0, 0.5).tangent).toBe(0)
    expect(strokeAt(corner, 0, 0.75).tangent).toBe(90)
    expect(strokeAt(corner, 0, 1).tangent).toBe(90)
    expect(strokeAt(corner, 0.6, 1).tangent).toBe(90)
  })

  it('draws nothing when from = to, or on a path of no length, and clamps its ends', () => {
    const path = flattenPath('M0 0 L1000 0', T)
    const empty = { points: [], tip: null, tangent: 0, length: 0 }
    expect(strokeAt(path, 0.4, 0.4)).toEqual(empty)
    expect(strokeAt(path, 0.6, 0.4)).toEqual(empty)
    expect(strokeAt(path, 1.5, 2)).toEqual(empty)
    expect(strokeAt(flattenPath('M5 5', T), 0, 1)).toEqual(empty)
    expect(strokeAt(flattenPath('', T), 0, 1)).toEqual(empty)
    expect(strokeAt(path, -1, 2).points).toEqual([{ x: 0, y: 0 }, { x: 1000, y: 0 }])
    expect(strokeAt(path, Number.NaN, 0.5).points).toEqual([{ x: 0, y: 0 }, { x: 500, y: 0 }])
    const heads = { start: { size: 40, grow: 1 }, end: { size: 40, grow: 1 } }
    expect(strokeShape(path, { from: 0.4, to: 0.4, width: 6, heads }, { width: 1080, height: 1920 })).toEqual({
      line: [],
      width: 6,
      start: null,
      end: null
    })
  })
})

describe('the riding arrowhead', () => {
  it('grows 0 → 1 over its first 0.1 s from the stroke’s start and holds at 1', () => {
    const seconds = DURATIONS.headGrow
    for (const fps of [24, 25, 30, 60]) {
      const startFrame = Math.round(0.5 * fps)
      const start = startFrame / fps
      expect(headGrowAt(start - 1 / fps, start)).toBe(0)
      expect(headGrowAt(start, start)).toBeLessThan(1e-4)
      expect(headGrowAt(start + seconds / 2, start)).toBeCloseTo(0.5, 4)
      // The first frame at or after DURATIONS.headGrow (0.1 s) reads exactly 1; the frame before reads less.
      const full = Math.ceil((start + seconds) * fps - 1e-6)
      expect(headGrowAt(full / fps, start), `${fps} fps`).toBe(1)
      expect(headGrowAt((full - 1) / fps, start)).toBeLessThan(1)
      let before = -1
      for (let frame = startFrame - 2; frame <= full + 3 * fps; frame++) {
        const grow = headGrowAt(frame / fps, start)
        expect(grow).toBeGreaterThanOrEqual(before)
        if (frame >= full) expect(grow).toBe(1)
        before = grow
      }
    }
  })

  it('rides the tip at full size, and scales down while the visible length is under its size', () => {
    const path = flattenPath('M0 0 L1000 0', T)
    const frame = { width: 1080, height: 1920 }
    const check = (to: number, head: { size: number; grow: number }, k: number): void => {
      const shape = strokeShape(path, { from: 0, to, width: 6, heads: { end: head } }, frame)
      const tip = { x: to * 1000, y: 0 }
      expect(shape.end).not.toBeNull()
      const [point, left, right] = shape.end!.points
      expectPoint(point, tip)
      // The base's middle lies size × k behind the tip, along the path; the base is 2 × 0.45 × size × k wide.
      expectPoint({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 }, { x: tip.x - head.size * k, y: 0 })
      expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeCloseTo(2 * 0.45 * head.size * k, 9)
      // The line stops 0.6 × size × k short of the tip.
      expect(shape.end!.inset).toBeCloseTo(0.6 * head.size * k, 9)
      expectPoint(shape.line[shape.line.length - 1], { x: tip.x - 0.6 * head.size * k, y: 0 })
    }
    check(0.5, { size: 40, grow: 1 }, 1)
    check(0.5, { size: 40, grow: 0.5 }, 0.5)
    // Visible 20 px under a 40 px head: half size. At to = 0.01, 10 px: a quarter, no full-size head.
    check(0.02, { size: 40, grow: 1 }, 0.5)
    check(0.01, { size: 40, grow: 1 }, 0.25)
    check(0.01, { size: 40, grow: 0.5 }, 0.125)
    // No grow, no head; the line then runs to the tip.
    const bare = strokeShape(path, { from: 0, to: 0.5, width: 6, heads: { end: { size: 40, grow: 0 } } }, frame)
    expect(bare.end).toBeNull()
    expect(bare.line).toEqual([{ x: 0, y: 0 }, { x: 500, y: 0 }])
    expect(headShape({ x: 0, y: 0 }, 0, { size: 40, grow: 1 }, 0)).toBeNull()
  })

  it('turns the head along the tangent on a vertical stroke and at a corner', () => {
    const frame = { width: 1080, height: 1920 }
    const down = strokeShape(flattenPath('M500 100 V900', T), { from: 0, to: 0.5, width: 6, heads: { end: { size: 40, grow: 1 } } }, frame)
    const [point, left, right] = down.end!.points
    expectPoint(point, { x: 500, y: 500 })
    expectPoint({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 }, { x: 500, y: 460 })
    const corner = flattenPath('M0 0 L100 0 L100 100', T)
    const atCorner = strokeShape(corner, { from: 0, to: 0.5, width: 6, heads: { end: { size: 10, grow: 1 } } }, frame)
    const [p, l, r] = atCorner.end!.points
    expectPoint(p, { x: 100, y: 0 })
    expectPoint({ x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 }, { x: 90, y: 0 })
  })

  it('sits a start head at the span’s start, turned back, with the line starting past it', () => {
    const frame = { width: 1080, height: 1920 }
    const path = flattenPath('M0 0 L0 500 L500 500', T)
    // from 0.1: the span starts at (0, 100) going down, so the start head points up and its base lies 40 px down the path.
    const shape = strokeShape(path, { from: 0.1, to: 0.9, width: 6, heads: { start: { size: 40, grow: 1 } } }, frame)
    const [point, left, right] = shape.start!.points
    expectPoint(point, { x: 0, y: 100 })
    expectPoint({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 }, { x: 0, y: 140 })
    expectPoint(shape.line[0], { x: 0, y: 124 })
    expectPoint(shape.line[shape.line.length - 1], { x: 400, y: 500 })
    expect(shape.end).toBeNull()
    // Both heads on a span shorter than the two insets: no line, both heads scaled to the span.
    const short = strokeShape(path, { from: 0.1, to: 0.12, width: 6, heads: { start: { size: 40, grow: 1 }, end: { size: 40, grow: 1 } } }, frame)
    expect(short.line).toEqual([])
    expect(short.start!.inset).toBeCloseTo(0.6 * 20, 9)
    expect(short.end!.inset).toBeCloseTo(0.6 * 20, 9)
  })
})

describe('widths', () => {
  it('are frame units: the same stroke at 1080 and at 270 wide differs in width, line and heads by the same ratio, 4', () => {
    const big = flattenPath('M100 900 L700 900 L700 300', T)
    const small = flattenPath('M25 225 L175 225 L175 75', T)
    const stroke = (width: number, size: number): StrokeInput => ({
      from: 0.1,
      to: 0.8,
      width,
      heads: { start: { size, grow: 0.5 }, end: { size, grow: 1 } }
    })
    // 12 px is above the floor at both sizes; 1 px at 1080 (0.25 at 270) is under it at both.
    for (const [wide, narrow] of [[12, 3], [1, 0.25]]) {
      const a = strokeShape(big, stroke(wide, 40), { width: 1080, height: 1920 })
      const b = strokeShape(small, stroke(narrow, 10), { width: 270, height: 480 })
      expect(a.width / b.width, `width ${wide}`).toBeCloseTo(4, 12)
      expect(a.line).toHaveLength(b.line.length)
      a.line.forEach((p, k) => expectPoint(p, { x: 4 * b.line[k].x, y: 4 * b.line[k].y }))
      a.end!.points.forEach((p, k) => expectPoint(p, { x: 4 * b.end!.points[k].x, y: 4 * b.end!.points[k].y }))
      a.start!.points.forEach((p, k) => expectPoint(p, { x: 4 * b.start!.points[k].x, y: 4 * b.start!.points[k].y }))
    }
    expect(strokeWidth(12, { width: 1080, height: 1920 })).toBe(12)
    expect(strokeWidth(1, { width: 1080, height: 1920 })).toBe(STROKE_MIN_PX)
    expect(strokeWidth(0.25, { width: 270, height: 480 })).toBe(STROKE_MIN_PX / 4)
    // The shorter side sets the floor, so a landscape frame draws what a portrait one does.
    expect(strokeWidth(1, { width: 1920, height: 1080 })).toBe(STROKE_MIN_PX)
    expect(strokeWidth(Number.NaN, { width: 1080, height: 1920 })).toBe(STROKE_MIN_PX)
  })
})
