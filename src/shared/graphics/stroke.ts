/**
 * The stroke primitive (docs/CLIPS.md §6.3, "The stroke primitive"): one
 * primitive serves the callout's arrow and ring, the steps connector and the
 * tree's edges, underlines and the edge sweep (the research, §4.4).
 *
 * SVG path data is flattened here, by our own code, to a polyline with its
 * cumulative lengths, and a draw-on's visible span is cut from that polyline.
 * Painter A strokes the span computed here, not a dashed `Path2D`: canvas has
 * no length query, so a `setLineDash` draw-on would end where Chromium's own
 * flattening says while the head sat where ours says. Drawing our span makes
 * the line's end and the head's tip one number. M8 (§6.15) compares our
 * `total` with an `SVGPathElement`'s `getTotalLength()` and sets
 * `STROKE_TOLERANCE`; the flattening stays here, node-pure, either way.
 *
 * Every length and point is in frame pixels: output-frame pixels of the size
 * the draw list was made at, never preview pixels, so a 270×480 preview and a
 * 1080×1920 export draw the same stroke at the same relative size.
 *
 * Pure: no clock, no random, no state kept between calls, no DOM, no
 * `node:path`. It imports only the motion module, for the head's scale-in.
 * `items.ts` (lane B, not yet built) is to take `Point` and `Arrowhead` from
 * here, so that no import runs back into this file.
 */

import { DURATIONS, progress } from './motion'

/** A point in frame pixels, y down. */
export interface Point {
  x: number
  y: number
}

/**
 * A flattened path: its polyline, the cumulative length at each point
 * (`lengths[0]` is 0, `lengths[i]` the length from the first point to point
 * i), and the whole length, equal to the last of `lengths`. No two consecutive
 * points are equal, so `lengths` strictly increases.
 */
export interface PathGeometry {
  points: Point[]
  lengths: number[]
  total: number
}

/**
 * The visible span of a stroke: its polyline with both ends interpolated;
 * `tip`, the point at `to` (null when the span is empty); `tangent`, the
 * direction in degrees (0 to the right, 90 down the frame) of the path's
 * segment arriving at the tip, the incoming one when the tip sits on a
 * vertex; and `length`, the span's length, `(to − from) × total`.
 */
export interface StrokeSpan {
  points: Point[]
  tip: Point | null
  tangent: number
  length: number
}

/** A riding arrowhead: `size`, its full length in frame pixels; `grow`, its scale-in, 0 to 1 (`headGrowAt`). */
export interface Arrowhead {
  size: number
  grow: number
}

/** A head as drawn: the filled triangle, its point first, then the two ends of its base; and how far short of the point the line stops. */
export interface HeadShape {
  points: [Point, Point, Point]
  inset: number
}

/** The stroke fields the geometry reads; a `stroke` draw item has them. */
export interface StrokeInput {
  from: number
  to: number
  width: number
  heads?: { start?: Arrowhead; end?: Arrowhead }
}

/**
 * What painter A draws for a stroke: `line`, the polyline it strokes (the
 * visible span, stopped short of each head; empty when nothing of the line
 * shows); `width`, the line width in frame pixels (`strokeWidth`); and each
 * head's triangle, or null.
 */
export interface StrokeShape {
  line: Point[]
  width: number
  start: HeadShape | null
  end: HeadShape | null
}

/* -------------------------------------------------------------- constants */

/**
 * How far, in frame pixels, a flattened piece of a curve may lie from its
 * chord. 0.25 is the plan's proposal; M8 (§6.15, phase 1, the Mac) sets it as
 * the coarsest at which `total` agrees with `getTotalLength()` within 0.1 %
 * and every sampled point within 0.5 px at 1080 wide.
 */
export const STROKE_TOLERANCE = 0.25

/**
 * The thinnest line drawn, in pixels of a 1080-pixel frame side, so a stroke
 * survives the 4:2:0 chroma of the plan's `format=yuva420p` overlay. 2 is the
 * research's starting value, a proposal until M19 (§6.15) measures the
 * fringe. Here, not in `paint.ts` as §6.3's file table has it, because this
 * module's test (`graphicStroke`, §6.3) owns the width case and its mutation
 * and `paint.ts` is lane B's; `paint.ts` is to import it, not declare its own.
 */
export const STROKE_MIN_PX = 2

/** The head's half-width as a fraction of its length (proposal, §6.3). */
const HEAD_HALF_WIDTH = 0.45
/** How far short of the head's point the line stops, as a fraction of the head's length, so a round cap never shows past its base (proposal, §6.3). */
const HEAD_INSET = 0.6
/** De Casteljau halvings at most per curve: 2^16 pieces, far past any tolerance a frame needs; a guard against a degenerate input, not a budget. */
const MAX_DEPTH = 16

/* ------------------------------------------------------------------ parse */

/** Path data's tokens: a command letter, a number, separators, or anything else (refused). */
const TOKEN = /([MmLlHhVvCcSsQqTtZzAa])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)|([\s,]+)|(.)/g

/** How many numbers each command takes, once; it repeats while numbers follow. */
const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0 }

function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = []
  for (const m of d.matchAll(TOKEN)) {
    if (m[1] !== undefined) out.push(m[1])
    else if (m[2] !== undefined) out.push(Number(m[2]))
    else if (m[4] !== undefined) throw new Error(`flattenPath: "${m[4]}" is not path data`)
  }
  return out
}

/** The distance from p to the segment a–b. */
function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay)
  const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy))
}

/**
 * Flattens one cubic from its start (already pushed) to its end by de
 * Casteljau halving, until both control points lie within `tolerance` of the
 * chord: the curve lies in its control points' convex hull, so the piece is
 * then within `tolerance` of its chord too.
 */
function flattenCubic(
  push: (x: number, y: number) => void,
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number,
  tolerance: number,
  depth: number
): void {
  const flat = Math.max(distanceToSegment(x1, y1, x0, y0, x3, y3), distanceToSegment(x2, y2, x0, y0, x3, y3))
  if (flat <= tolerance || depth >= MAX_DEPTH) {
    push(x3, y3)
    return
  }
  const x01 = (x0 + x1) / 2, y01 = (y0 + y1) / 2
  const x12 = (x1 + x2) / 2, y12 = (y1 + y2) / 2
  const x23 = (x2 + x3) / 2, y23 = (y2 + y3) / 2
  const xa = (x01 + x12) / 2, ya = (y01 + y12) / 2
  const xb = (x12 + x23) / 2, yb = (y12 + y23) / 2
  const xm = (xa + xb) / 2, ym = (ya + yb) / 2
  flattenCubic(push, x0, y0, x01, y01, xa, ya, xm, ym, tolerance, depth + 1)
  flattenCubic(push, xm, ym, xb, yb, x23, y23, x3, y3, tolerance, depth + 1)
}

/**
 * Flattens SVG path data (frame pixels) to a polyline with cumulative
 * lengths. It parses `M L H V C S Q T Z`, absolute and relative, with
 * repeated arguments (after a moveto, as linetos) and SVG's packed numbers
 * (`10-20`, `.5.5`); a quadratic is raised to its exact cubic. Each curve is
 * halved until every piece is within `tolerance` of its chord.
 *
 * Refused, by throwing: `A` (a template draws a circle as four cubics,
 * κ = 0.5523), a second moveto (a stroke is one subpath, one length to draw
 * on along), path data that does not begin with a moveto, a command with too
 * few numbers, anything that is not path data, and a tolerance that is not a
 * positive number. Empty data gives an empty geometry.
 */
export function flattenPath(d: string, tolerance: number): PathGeometry {
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) {
    throw new RangeError(`flattenPath: the tolerance must be a positive number of pixels, not ${tolerance}`)
  }
  const tokens = tokenize(d)
  const points: Point[] = []
  const push = (x: number, y: number): void => {
    const last = points[points.length - 1]
    if (last === undefined || last.x !== x || last.y !== y) points.push({ x, y })
  }
  // The current point, the subpath's start, and the last control point with the command that set it, for S and T.
  let x = 0, y = 0
  let startX = 0, startY = 0
  let controlX = 0, controlY = 0
  let previous = ''
  let moved = false
  let i = 0
  const take = (): number => {
    const value = tokens[i]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`flattenPath: a command is missing a number at token ${i}`)
    }
    i += 1
    return value
  }
  while (i < tokens.length) {
    const letter = tokens[i]
    if (typeof letter !== 'string') throw new Error(`flattenPath: the number ${letter} has no command before it`)
    i += 1
    let command = letter.toUpperCase()
    const relative = letter !== command
    if (command === 'A') {
      throw new Error('flattenPath: arcs ("A") are refused; a template draws a circle as four cubics (κ = 0.5523)')
    }
    if (command === 'M') {
      if (moved) throw new Error('flattenPath: a second moveto is refused; a stroke is one subpath')
    } else if (!moved) {
      throw new Error('flattenPath: path data must begin with a moveto')
    }
    do {
      const ox = relative ? x : 0
      const oy = relative ? y : 0
      switch (command) {
        case 'M': {
          x = ox + take()
          y = oy + take()
          startX = x
          startY = y
          moved = true
          push(x, y)
          command = 'L' // further pairs are linetos, relative after an m
          break
        }
        case 'L': {
          x = ox + take()
          y = oy + take()
          push(x, y)
          break
        }
        case 'H': {
          x = ox + take()
          push(x, y)
          break
        }
        case 'V': {
          y = oy + take()
          push(x, y)
          break
        }
        case 'C': {
          const x1 = ox + take(), y1 = oy + take()
          const x2 = ox + take(), y2 = oy + take()
          const x3 = ox + take(), y3 = oy + take()
          flattenCubic(push, x, y, x1, y1, x2, y2, x3, y3, tolerance, 0)
          controlX = x2
          controlY = y2
          x = x3
          y = y3
          break
        }
        case 'S': {
          const smooth = previous === 'C' || previous === 'S'
          const x1 = smooth ? 2 * x - controlX : x
          const y1 = smooth ? 2 * y - controlY : y
          const x2 = ox + take(), y2 = oy + take()
          const x3 = ox + take(), y3 = oy + take()
          flattenCubic(push, x, y, x1, y1, x2, y2, x3, y3, tolerance, 0)
          controlX = x2
          controlY = y2
          x = x3
          y = y3
          break
        }
        case 'Q':
        case 'T': {
          let qx: number, qy: number
          if (command === 'Q') {
            qx = ox + take()
            qy = oy + take()
          } else {
            const smooth = previous === 'Q' || previous === 'T'
            qx = smooth ? 2 * x - controlX : x
            qy = smooth ? 2 * y - controlY : y
          }
          const x3 = ox + take(), y3 = oy + take()
          // A quadratic is the cubic with controls two thirds of the way to its own control.
          flattenCubic(
            push,
            x, y,
            x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y),
            x3 + (2 / 3) * (qx - x3), y3 + (2 / 3) * (qy - y3),
            x3, y3,
            tolerance,
            0
          )
          controlX = qx
          controlY = qy
          x = x3
          y = y3
          break
        }
        case 'Z': {
          x = startX
          y = startY
          push(x, y)
          break
        }
        default:
          throw new Error(`flattenPath: "${letter}" is not a path command`)
      }
      previous = command
    } while (ARITY[command] > 0 && typeof tokens[i] === 'number')
  }
  const lengths: number[] = []
  let total = 0
  for (let k = 0; k < points.length; k++) {
    if (k > 0) total += Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y)
    lengths.push(total)
  }
  return { points, lengths, total }
}

/* ------------------------------------------------------------------- span */

/** 0 to 1, and 0 for what is not a number. */
function clamp01(value: number): number {
  return value > 0 ? (value < 1 ? value : 1) : 0
}

/** The point at length `s` on the segment from point `k` to point `k + 1`; a vertex itself at either end. */
function pointOnSegment(path: PathGeometry, k: number, s: number): Point {
  const a = path.points[k]
  const b = path.points[k + 1]
  const u = (s - path.lengths[k]) / (path.lengths[k + 1] - path.lengths[k])
  if (u <= 0) return { x: a.x, y: a.y }
  if (u >= 1) return { x: b.x, y: b.y }
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
}

/** The direction, in degrees, of the segment from point `k` to point `k + 1`. */
function segmentAngle(path: PathGeometry, k: number): number {
  const a = path.points[k]
  const b = path.points[k + 1]
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

/**
 * A non-empty span, with its clamped ends `f` and `t`, the segment it leaves
 * its start along (`first`) and the one it reaches its tip along (`last`).
 */
interface Span {
  points: Point[]
  tip: Point
  tangent: number
  length: number
  f: number
  t: number
  first: number
  last: number
}

/** The span from `from` to `to`, or null when it is empty. */
function spanOf(path: PathGeometry, from: number, to: number): Span | null {
  const f = clamp01(from)
  const t = Math.max(f, clamp01(to))
  const n = path.points.length
  if (!(t > f) || !(path.total > 0) || n < 2) return null
  const s0 = f * path.total
  const s1 = t * path.total
  const { lengths } = path
  // first: the last point at or before s0, short of the path's end (the segment leaving the start).
  let lo = 0, hi = n - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lengths[mid] <= s0) lo = mid
    else hi = mid - 1
  }
  const first = lo
  // last + 1: the first point at or after s1, past the path's start (the segment arriving at the tip).
  lo = 1
  hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (lengths[mid] >= s1) hi = mid
    else lo = mid + 1
  }
  const last = lo - 1
  const tip = pointOnSegment(path, last, s1)
  const points = [pointOnSegment(path, first, s0)]
  for (let k = first + 1; k <= last; k++) points.push({ x: path.points[k].x, y: path.points[k].y })
  points.push(tip)
  return { points, tip: { x: tip.x, y: tip.y }, tangent: segmentAngle(path, last), length: (t - f) * path.total, f, t, first, last }
}

/**
 * The visible span of `path` from `from` to `to`, both fractions of its
 * length, clamped so 0 ≤ from ≤ to ≤ 1. Its points are new objects, so a
 * caller may keep them while the geometry is memoised elsewhere. An empty
 * span (from = to, or a path of no length) has no points, no tip, tangent 0
 * and length 0.
 */
export function strokeAt(path: PathGeometry, from: number, to: number): StrokeSpan {
  const span = spanOf(path, from, to)
  if (span === null) return { points: [], tip: null, tangent: 0, length: 0 }
  return { points: span.points, tip: span.tip, tangent: span.tangent, length: span.length }
}

/* ------------------------------------------------------------------- head */

/**
 * A riding head's `grow` at `t` seconds for a stroke whose draw-on starts at
 * `start`: 0 before it, 0 to 1 over `DURATIONS.headGrow` (0.1 s, §6.13),
 * linear, then 1. Through `progress`, so the frame 0.1 s after the start
 * reads exactly 1. The head travels with the line from its start rather than
 * waiting at the path's end (the research, §4.4).
 */
export function headGrowAt(t: number, start: number): number {
  return progress(t, start, DURATIONS.headGrow, 'linear')
}

/**
 * A head whose point is `at`, pointing along `angle` (degrees): a triangle
 * of length `size × k` and half-width `0.45 × size × k`, and the line stopped
 * `0.6 × size × k` short of the point, where k is `grow` times
 * min(1, visible / size), so a head on a span shorter than its size is
 * scaled down with it. Null when k is 0 (no grow, no visible length, no
 * size).
 */
export function headShape(at: Point, angle: number, head: Arrowhead, visible: number): HeadShape | null {
  const size = head.size
  if (!(size > 0) || !(visible > 0)) return null
  const k = clamp01(head.grow) * Math.min(1, visible / size)
  if (!(k > 0)) return null
  const length = size * k
  const half = HEAD_HALF_WIDTH * size * k
  const radians = (angle * Math.PI) / 180
  const ux = Math.cos(radians)
  const uy = Math.sin(radians)
  const baseX = at.x - ux * length
  const baseY = at.y - uy * length
  return {
    points: [
      { x: at.x, y: at.y },
      { x: baseX - uy * half, y: baseY + ux * half },
      { x: baseX + uy * half, y: baseY - ux * half }
    ],
    inset: HEAD_INSET * size * k
  }
}

/**
 * The line width painter A draws, in frame pixels: the stroke's own width,
 * or `STROKE_MIN_PX` of a 1080-pixel side scaled to this frame's shorter
 * side, whichever is wider. Both are frame units, so a 270-wide preview's
 * width is a quarter of a 1080-wide export's.
 */
export function strokeWidth(width: number, frame: { width: number; height: number }): number {
  const floor = (STROKE_MIN_PX * Math.min(frame.width, frame.height)) / 1080
  return width > floor ? width : floor
}

/**
 * A stroke's whole geometry on a frame: the visible span (`strokeAt`), an
 * `end` head riding its tip along the tangent, a `start` head at its start
 * turned back, the line stopped short of each head, and the width. Nothing
 * draws when `from` = `to`: no line and no head.
 */
export function strokeShape(path: PathGeometry, stroke: StrokeInput, frame: { width: number; height: number }): StrokeShape {
  const width = strokeWidth(stroke.width, frame)
  const span = spanOf(path, stroke.from, stroke.to)
  if (span === null) return { line: [], width, start: null, end: null }
  const end = stroke.heads?.end ? headShape(span.tip, span.tangent, stroke.heads.end, span.length) : null
  const start = stroke.heads?.start
    ? headShape(span.points[0], segmentAngle(path, span.first) + 180, stroke.heads.start, span.length)
    : null
  const lineFrom = span.f + (start?.inset ?? 0) / path.total
  const lineTo = span.t - (end?.inset ?? 0) / path.total
  const line = lineTo > lineFrom ? strokeAt(path, lineFrom, lineTo).points : []
  return { line, width, start, end }
}
