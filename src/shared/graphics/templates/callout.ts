/**
 * `callout` (docs/CLIPS.md §6.2): an arrow drawn on to the subject box, or a
 * ring drawn round it, with a label.
 *
 * Items, in order: the dim when the style dims; `stroke`; `panel` (rounded,
 * only when `palette.panelOpacity` > 0, padded 0.6 × the label's px, as the
 * counter's); `label` (further lines `label-1` …).
 *
 * - `shape: 'arrow'`: a quadratic curve from the label's nearest edge to the
 *   subject box's nearest edge, bowing away from the frame's centre,
 *   `heads.end` an `Arrowhead` riding the tip, growing in over its first
 *   0.1 s (`headGrowAt`).
 * - `shape: 'circle'`: a closed path round the subject box padded 12 % of
 *   its width and height at each side (§6.2's proposal), four cubics (κ
 *   0.5523; `flattenPath` refuses `A`), starting at the top and running
 *   clockwise; no head.
 *
 * Motion: the stroke draws on (`from` 0, `to` p) over `DURATIONS.stroke`,
 * ending on the beat; the label (and its panel) enters from the beat with
 * `style.motion.entrance` over `DURATIONS.entrance`.
 *
 * `targets.subject` null or absent: no items at all. The app drops a callout
 * with no subject at onset (§6.9), so a list with nothing to point at is
 * never shown; drawing a label alone would show a pointer to nothing.
 *
 * Beyond §6.2's words: "nearest edge" is read as the pair of edge midpoints,
 * one of the label's panel and one of the subject box, closest together; the
 * curve's control point sits 0.2 of the chord's length off its middle, on the
 * side away from the frame's centre; the label panel is centred in the
 * content rect's height, beside the subject on the side with more room
 * within the content rect, one panel padding away from it, and clamped into
 * the rect when that side is too narrow for it (an arrow's subject is
 * usually outside the label's third: the app chooses the circle when the
 * label fits beside the subject in the same third).
 */

import type { DrawItem, DrawOut, Drawer, Point, Rect, StrokeItem } from '../items'
import { headGrowAt } from '../stroke'
import { DURATIONS, progress } from '../motion'
import {
  HEAD_SIZE,
  LAYOUT_SIZES,
  beatOf,
  centreOf,
  contentRect,
  dimFor,
  drawOnEase,
  enterMove,
  fitScale,
  fitsIn,
  lineHeightOf,
  lineItems,
  lookOf,
  moved,
  panelFor,
  shortSide,
  strokePx,
  widestOf,
  withDim,
  wrapWidth
} from './layout'

/** The circle's padding round the subject box, a share of its width and height at each side (§6.2, a proposal). */
export const CIRCLE_PAD = 0.12
/** The arrow's bow, its control point's distance off the chord's middle as a share of the chord (beyond §6.2's words). */
export const ARROW_BOW = 0.2
/** A circle's cubic handle, κ: four cubics make a circle (§6.3's stroke primitive). */
const KAPPA = 0.5523

/** The four edge midpoints of a rectangle: top, right, bottom, left. */
function edgeMids(r: Rect): Point[] {
  return [
    { x: r.x + r.width / 2, y: r.y },
    { x: r.x + r.width, y: r.y + r.height / 2 },
    { x: r.x + r.width / 2, y: r.y + r.height },
    { x: r.x, y: r.y + r.height / 2 }
  ]
}

/** The arrow's path: a quadratic from the label's nearest edge midpoint to the subject's, bowed away from the frame's centre. */
export function arrowPath(label: Rect, subject: Rect, size: { width: number; height: number }): string {
  let best: [Point, Point] = [edgeMids(label)[0], edgeMids(subject)[0]]
  let bestD = Infinity
  for (const a of edgeMids(label)) {
    for (const b of edgeMids(subject)) {
      const d = Math.hypot(b.x - a.x, b.y - a.y)
      if (d < bestD) {
        bestD = d
        best = [a, b]
      }
    }
  }
  const [a, b] = best
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  let n = len > 0 ? { x: -(b.y - a.y) / len, y: (b.x - a.x) / len } : { x: 0, y: 0 }
  const away = { x: mid.x - size.width / 2, y: mid.y - size.height / 2 }
  if (n.x * away.x + n.y * away.y < 0) n = { x: -n.x, y: -n.y }
  const c = { x: mid.x + n.x * ARROW_BOW * len, y: mid.y + n.y * ARROW_BOW * len }
  return `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`
}

/** The circle's path: a closed ellipse round the subject box padded `CIRCLE_PAD`, four cubics from the top, clockwise. */
export function circlePath(subject: Rect): string {
  const rx = subject.width * (0.5 + CIRCLE_PAD)
  const ry = subject.height * (0.5 + CIRCLE_PAD)
  const cx = subject.x + subject.width / 2
  const cy = subject.y + subject.height / 2
  const kx = KAPPA * rx
  const ky = KAPPA * ry
  return [
    `M ${cx} ${cy - ry}`,
    `C ${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy}`,
    `C ${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry}`,
    `C ${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy}`,
    `C ${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry}`,
    'Z'
  ].join(' ')
}

export const drawCallout: Drawer = (spec, style, clock, size, measure, targets): DrawOut => {
  const data = spec.data
  if (data.template !== 'callout') return { items: [] }
  const subject = targets.subject
  if (!subject) return { items: [] }
  const sizes = LAYOUT_SIZES.callout
  const s = shortSide(size)
  const rect = contentRect(spec.place, size)
  const wrap = wrapWidth(rect, size)

  const layout = (k: number) => {
    const look = lookOf(style, sizes.label * s * k, 'center')
    const pad = sizes.pad * sizes.label * s * k
    const lines = lineItems('label', data.label, look, { x: 0, y: 0, width: Math.max(0, wrap - 2 * pad) }, measure, 'data.label')
    const height = lines.length * lineHeightOf(look)
    return { look, pad, width: widestOf(lines) + 2 * pad, height: height + 2 * pad, inner: wrap - 2 * pad }
  }
  const k = fitScale((scale) => {
    const l = layout(scale)
    return l.inner > 0 && l.width <= wrap + 1e-6 && fitsIn(l, rect)
  })
  if (k === null) return { items: [] }
  const l = layout(k)

  // Beside the subject, on the side with more room within the content rect, clamped into it.
  const roomLeft = subject.x - rect.x
  const roomRight = rect.x + rect.width - (subject.x + subject.width)
  const wanted = roomLeft >= roomRight ? subject.x - l.pad - l.width : subject.x + subject.width + l.pad
  const x = Math.min(Math.max(wanted, rect.x), rect.x + rect.width - l.width)
  const panelBox: Rect = { x, y: rect.y + (rect.height - l.height) / 2, width: l.width, height: l.height }
  const label = lineItems('label', data.label, l.look, { x: x + l.pad, y: panelBox.y + l.pad, width: l.width - 2 * l.pad }, measure, 'data.label')

  const t = clock.t
  const beat = beatOf(spec, 0)
  const S = DURATIONS.stroke
  const stroke: StrokeItem = {
    kind: 'stroke',
    id: 'stroke',
    opacity: 1,
    d: data.shape === 'circle' ? circlePath(subject) : arrowPath(panelBox, subject, size),
    from: 0,
    to: progress(t, beat - S, S, drawOnEase(style)),
    width: strokePx(style, size),
    color: style.palette.ink,
    cap: 'round',
    join: 'round',
    look: style.strokeLook
  }
  if (data.shape !== 'circle') stroke.heads = { end: { size: HEAD_SIZE * s, grow: headGrowAt(t, beat - S) } }

  const move = enterMove(style, progress(t, beat, DURATIONS.entrance, style.motion.ease), l.look.px)
  const about = centreOf(panelBox)
  const items: DrawItem[] = [stroke]
  const panel = panelFor('panel', panelBox, style, size)
  if (panel) items.push(moved(panel, move, about, size))
  for (const item of label) items.push(moved(item, move, about, size))
  return { items: withDim(dimFor(style, t, targets, size), items) }
}
