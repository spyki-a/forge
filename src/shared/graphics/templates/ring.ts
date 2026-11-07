/**
 * `ring` (docs/CLIPS.md §6.2): a ring filling to the percentage and arriving
 * on the word, the value inside, the label beneath.
 *
 * Items, in order: the dim when the style dims; `track` (a ring shape, sweep
 * 1, `palette.muted`); `arc` (a ring shape from −π/2, `palette.ink`); `value`;
 * `label` (a wrapped label's further lines `label-1` …). `arc.sweep` = (n ÷
 * 100) × p, with n from `numberOf(data.value)` and p the counter's,
 * `progress(t, 0, beat, ease)`; `value` counts as the counter's. The one
 * glyph the painter adds is `%` (§6.2's fixed glyphs), appended to the
 * value's text only when `data.value` carries neither `%` nor a percent word.
 * The group enters as the counter's, from t = 0 over `DURATIONS.entrance`
 * (§6.2 gives the ring no entrance of its own; "as the counter's" is its
 * row's word for the value).
 *
 * The ring is 0.28 of `s` across its ink: the track and the arc are stroked
 * on the circle inscribed in their box (paint.ts), so the box is that less
 * one thickness. The value is centred inside; a value wider than the ring's
 * hole is not refused by the too-big rule, which reads the block alone.
 */

import type { DrawItem, DrawOut, Drawer, Rect, ShapeItem, TextItem } from '../items'
import { DURATIONS, entrance, progress } from '../motion'
import { inBetween, numberOf } from '../numbers'
import {
  LAYOUT_SIZES,
  beatOf,
  contentRect,
  dimFor,
  drawOnEase,
  fitScale,
  fitsIn,
  lineHeightOf,
  lineItems,
  lookOf,
  moved,
  shortSide,
  widestOf,
  withDim,
  wrapWidth,
  type Move
} from './layout'

/** `%` itself, or a percent word (§6.7's units: `%` = `percent` = `per cent`). */
const PERCENT = /%|\bper\s?cent\b/i

/** The fixed glyph the ring appends when its value lacks one (§6.2). */
export const RING_GLYPH = '%'

/** Whether a ring's value text takes the `%` glyph: only when `data.value` carries neither `%` nor a percent word. */
export function ringNeedsGlyph(value: string): boolean {
  return !PERCENT.test(value)
}

export const drawRing: Drawer = (spec, style, clock, size, measure, targets): DrawOut => {
  const data = spec.data
  if (data.template !== 'ring') return { items: [] }
  const sizes = LAYOUT_SIZES.ring
  const s = shortSide(size)
  const rect = contentRect(spec.place, size)
  const wrap = wrapWidth(rect, size)
  const glyph = ringNeedsGlyph(data.value) ? RING_GLYPH : ''

  const layout = (k: number) => {
    const valueLook = lookOf(style, sizes.value * s * k, 'center')
    const labelLook = lookOf(style, sizes.label * s * k, 'center')
    const across = sizes.across * s * k
    const thick = sizes.thick * s * k
    const gap = sizes.gap * sizes.label * s * k
    const valueWidth = measure(data.value + glyph, valueLook).width
    const labelLines = lineItems('label', data.label, labelLook, { x: 0, y: 0, width: wrap }, measure, 'data.label')
    const labelHeight = labelLines.length * lineHeightOf(labelLook)
    const width = Math.max(across, valueWidth, widestOf(labelLines))
    const height = across + (labelLines.length > 0 ? gap + labelHeight : 0)
    return { valueLook, labelLook, across, thick, gap, valueWidth, width, height }
  }
  const k = fitScale((scale) => {
    const l = layout(scale)
    return l.valueWidth <= wrap + 1e-6 && fitsIn(l, rect)
  })
  if (k === null) return { items: [] }
  const l = layout(k)

  const block: Rect = { x: rect.x + (rect.width - l.width) / 2, y: rect.y + (rect.height - l.height) / 2, width: l.width, height: l.height }
  const cx = block.x + block.width / 2
  const ringCentre = { x: cx, y: block.y + l.across / 2 }
  const inner = l.across - l.thick
  const ringBox: Rect = { x: cx - inner / 2, y: ringCentre.y - inner / 2, width: inner, height: inner }
  const column = { x: cx - wrap / 2, width: wrap }
  const valueY = ringCentre.y - lineHeightOf(l.valueLook) / 2
  const labelY = block.y + l.across + l.gap

  const t = clock.t
  const beat = beatOf(spec, 0)
  const enter = entrance(style.motion.entrance, progress(t, 0, DURATIONS.entrance, style.motion.ease))
  const move: Move = { dy: enter.dy * l.valueLook.px, scale: enter.scale, opacity: enter.opacity }

  const p = progress(t, 0, beat, drawOnEase(style))
  const n = numberOf(data.value)
  const share = n === null ? 0 : Math.min(1, Math.max(0, n / 100))
  const counts = n !== null
  const text = (p >= 1 || !counts ? data.value : inBetween(data.value, p)) + glyph

  const track: ShapeItem = {
    kind: 'shape',
    id: 'track',
    opacity: 1,
    shape: 'ring',
    box: { ...ringBox },
    sweep: 1,
    start: -Math.PI / 2,
    stroke: { color: style.palette.muted, width: l.thick }
  }
  const arc: ShapeItem = {
    kind: 'shape',
    id: 'arc',
    opacity: 1,
    shape: 'ring',
    box: { ...ringBox },
    sweep: share * p,
    start: -Math.PI / 2,
    stroke: { color: style.palette.ink, width: l.thick }
  }
  const value: TextItem[] = lineItems('value', text, l.valueLook, { ...column, y: valueY }, measure, 'data.value').map((item) =>
    !counts && p < 1 ? { ...item, opacity: 0 } : item
  )
  const label = lineItems('label', data.label, l.labelLook, { ...column, y: labelY }, measure, 'data.label')

  const items: DrawItem[] = [track, arc, ...value, ...label]
  const about = { x: cx, y: block.y + block.height / 2 }
  return { items: withDim(dimFor(style, t, targets, size), items.map((item) => moved(item, move, about, size))) }
}
