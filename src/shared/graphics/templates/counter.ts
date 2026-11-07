/**
 * `counter` (docs/CLIPS.md §6.2): a number counting up from 0 and arriving at
 * the value on the word that says it, with the label beneath.
 *
 * Items, in order: the dim when the style dims; `panel` (rounded, only when
 * `palette.panelOpacity` > 0); `value`; `label` (a wrapped label's further
 * lines `label-1` …). The group enters from t = 0 with
 * `style.motion.entrance` over `DURATIONS.entrance`; `value`'s string is
 * `inBetween(data.value, p)` with p = `progress(t, 0, beat, ease)`, so the
 * count runs over the lead and lands on the beat, and from the beat on it is
 * `data.value` itself. A value with no in-between (`numberOf` null) draws
 * nothing until its beat, then appears whole.
 *
 * Pure, as every drawer (§6.2): never paints, measures only through
 * `measure`, formats only through `numbers.ts`, curves only from `motion.ts`.
 */

import type { DrawItem, DrawOut, Drawer, Rect, TextItem } from '../items'
import { DURATIONS, entrance, progress } from '../motion'
import { inBetween, numberOf } from '../numbers'
import {
  LAYOUT_SIZES,
  beatOf,
  centreOf,
  contentRect,
  dimFor,
  drawOnEase,
  fitScale,
  fitsIn,
  lineHeightOf,
  lineItems,
  lookOf,
  moved,
  panelFor,
  shortSide,
  widestOf,
  withDim,
  wrapWidth,
  type Move
} from './layout'

export const drawCounter: Drawer = (spec, style, clock, size, measure, targets): DrawOut => {
  const data = spec.data
  if (data.template !== 'counter') return { items: [] }
  const sizes = LAYOUT_SIZES.counter
  const s = shortSide(size)
  const rect = contentRect(spec.place, size)
  const wrap = wrapWidth(rect, size)

  const layout = (k: number) => {
    const valueLook = lookOf(style, sizes.value * s * k, 'center')
    const labelLook = lookOf(style, sizes.label * s * k, 'center')
    const labelPx = sizes.label * s * k
    const pad = sizes.pad * labelPx
    const gap = sizes.gap * labelPx
    const valueWidth = measure(data.value, valueLook).width
    const valueHeight = lineHeightOf(valueLook)
    const labelLines = lineItems('label', data.label, labelLook, { x: 0, y: 0, width: wrap }, measure, 'data.label')
    const labelHeight = labelLines.length * lineHeightOf(labelLook)
    const width = Math.max(valueWidth, widestOf(labelLines)) + 2 * pad
    const height = pad + valueHeight + (labelLines.length > 0 ? gap + labelHeight : 0) + pad
    return { k, valueLook, labelLook, pad, gap, valueWidth, valueHeight, width, height }
  }
  const k = fitScale((scale) => {
    const l = layout(scale)
    return l.valueWidth <= wrap + 1e-6 && fitsIn(l, rect)
  })
  if (k === null) return { items: [] }
  const l = layout(k)

  // The block, centred in the content rect (§6.2).
  const block: Rect = { x: rect.x + (rect.width - l.width) / 2, y: rect.y + (rect.height - l.height) / 2, width: l.width, height: l.height }
  const centre = centreOf(block)
  const column = { x: centre.x - wrap / 2, width: wrap }
  const valueY = block.y + l.pad
  const labelY = valueY + l.valueHeight + l.gap

  const t = clock.t
  const beat = beatOf(spec, 0)
  const enter = entrance(style.motion.entrance, progress(t, 0, DURATIONS.entrance, style.motion.ease))
  const move: Move = { dy: enter.dy * l.valueLook.px, scale: enter.scale, opacity: enter.opacity }

  const p = progress(t, 0, beat, drawOnEase(style))
  const counts = numberOf(data.value) !== null
  const text = p >= 1 || !counts ? data.value : inBetween(data.value, p)
  const value: TextItem[] = lineItems('value', text, l.valueLook, { ...column, y: valueY }, measure, 'data.value').map((item) =>
    // A value with no in-between draws nothing until its beat (numbers.ts's seam).
    !counts && p < 1 ? { ...item, opacity: 0 } : item
  )
  const label = lineItems('label', data.label, l.labelLook, { ...column, y: labelY }, measure, 'data.label')

  const items: DrawItem[] = []
  const panel = panelFor('panel', block, style, size)
  if (panel) items.push(panel)
  items.push(...value, ...label)
  return { items: withDim(dimFor(style, t, targets, size), items.map((item) => moved(item, move, centre, size))) }
}
