/**
 * `bars` (docs/CLIPS.md §6.2): two to five horizontal bars, each growing to
 * its value on its own word, labels and values beside them, under a title.
 *
 * Items, in order: the dim when the style dims; `title` (a wrapped title's
 * further lines `title-1` …); then per item i, `track-i` and `bar-i` (rect
 * shapes, `palette.muted` and `palette.ink`), `label-i` (further lines
 * `label-i-1` …) and `value-i`. Each bar's width is its `numberOf` share of
 * the largest, times p over `DURATIONS.entrance` ending on its beat; its
 * label enters with it (`style.motion.entrance`); its value counts as the
 * counter's, `inBetween(value, p)`, over the same span, at the bar's end.
 *
 * Layout (§6.2's table): a label column of 0.3 of the content width, tracks
 * over the next 0.55, each 0.6 × the label's px tall; rows 0.5 × the
 * label's px apart. Beyond its words: the content width is the wrap width;
 * the title is left-aligned above the rows, a row gap below it, and enters
 * from t = 0 over `DURATIONS.entrance`; a track enters with its row; a
 * value sits 0.25 × the label's px past the bar's end; a row is as tall as
 * its label's lines, the track centred on the first.
 */

import type { DrawItem, DrawOut, Drawer, Rect, ShapeItem, TextItem } from '../items'
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
  shortSide,
  withDim,
  wrapWidth
} from './layout'

/** A value's gap past its bar's end, × the label's px (beyond §6.2's words). */
const VALUE_GAP = 0.25

export const drawBars: Drawer = (spec, style, clock, size, measure, targets): DrawOut => {
  const data = spec.data
  if (data.template !== 'bars') return { items: [] }
  const sizes = LAYOUT_SIZES.bars
  const s = shortSide(size)
  const rect = contentRect(spec.place, size)
  const width = wrapWidth(rect, size)

  const numbers = data.items.map((item) => numberOf(item.value))
  const largest = numbers.reduce<number>((m, n) => (n !== null && n > m ? n : m), 0)
  const shares = numbers.map((n) => (n !== null && n > 0 && largest > 0 ? n / largest : 0))

  const layout = (k: number) => {
    const titleLook = lookOf(style, sizes.title * s * k, 'left')
    const labelLook = lookOf(style, sizes.label * s * k, 'left')
    const valueLook = lookOf(style, sizes.label * s * k, 'left')
    const labelPx = sizes.label * s * k
    const rowGap = sizes.rowGap * labelPx
    const trackHeight = sizes.trackHeight * labelPx
    const titleLines = lineItems('title', data.title, titleLook, { x: 0, y: 0, width }, measure, 'data.title')
    const titleHeight = titleLines.length * lineHeightOf(titleLook)
    const labelLine = lineHeightOf(labelLook)
    const rows = data.items.map((item, i) => {
      const lines = lineItems(`label-${i}`, item.label, labelLook, { x: 0, y: 0, width: sizes.labelColumn * width }, measure, `data.items.${i}.label`)
      return Math.max(labelLine, lines.length * labelLine)
    })
    const rowsHeight = rows.reduce((sum, h) => sum + h, 0) + Math.max(0, rows.length - 1) * rowGap
    const height = titleHeight + (titleHeight > 0 && rows.length > 0 ? rowGap : 0) + rowsHeight
    // The widest value, at its bar's full end, stays inside the content width.
    const trackLeft = sizes.labelColumn * width
    const reach = data.items.reduce(
      (m, item, i) => Math.max(m, trackLeft + sizes.track * width * shares[i] + VALUE_GAP * labelPx + measure(item.value, valueLook).width),
      0
    )
    return { titleLook, labelLook, valueLook, labelPx, rowGap, trackHeight, titleHeight, labelLine, rows, height, reach }
  }
  const k = fitScale((scale) => {
    const l = layout(scale)
    return l.reach <= width + 1e-6 && fitsIn({ width, height: l.height }, rect)
  })
  if (k === null) return { items: [] }
  const l = layout(k)

  const block: Rect = { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - l.height) / 2, width, height: l.height }
  const t = clock.t
  const E = DURATIONS.entrance
  const items: DrawItem[] = []

  const title = lineItems('title', data.title, l.titleLook, { x: block.x, y: block.y, width }, measure, 'data.title')
  const titleBox: Rect = { x: block.x, y: block.y, width, height: l.titleHeight }
  const titleEnter = entrance(style.motion.entrance, progress(t, 0, E, style.motion.ease))
  for (const item of title) {
    items.push(moved(item, { dy: titleEnter.dy * l.titleLook.px, scale: titleEnter.scale, opacity: titleEnter.opacity }, centreOf(titleBox), size))
  }

  let rowY = block.y + l.titleHeight + (l.titleHeight > 0 && data.items.length > 0 ? l.rowGap : 0)
  const trackX = block.x + LAYOUT_SIZES.bars.labelColumn * width
  const trackWidth = sizes.track * width
  data.items.forEach((item, i) => {
    const beat = beatOf(spec, i)
    const enter = entrance(style.motion.entrance, progress(t, beat - E, E, style.motion.ease))
    const p = progress(t, beat - E, E, drawOnEase(style))
    const rowBox: Rect = { x: block.x, y: rowY, width, height: l.rows[i] }
    const move = { dy: enter.dy * l.labelLook.px, scale: enter.scale, opacity: enter.opacity }
    const trackY = rowY + (l.labelLine - l.trackHeight) / 2
    const track: ShapeItem = {
      kind: 'shape',
      id: `track-${i}`,
      opacity: 1,
      shape: 'rect',
      box: { x: trackX, y: trackY, width: trackWidth, height: l.trackHeight },
      fill: style.palette.muted
    }
    const barWidth = trackWidth * shares[i] * p
    const bar: ShapeItem = {
      kind: 'shape',
      id: `bar-${i}`,
      opacity: 1,
      shape: 'rect',
      box: { x: trackX, y: trackY, width: barWidth, height: l.trackHeight },
      fill: style.palette.ink
    }
    const label = lineItems(`label-${i}`, item.label, l.labelLook, { x: block.x, y: rowY, width: sizes.labelColumn * width }, measure, `data.items.${i}.label`)
    const counts = numbers[i] !== null
    const text = p >= 1 || !counts ? item.value : inBetween(item.value, p)
    const valueX = trackX + barWidth + VALUE_GAP * l.labelPx
    const value: TextItem[] = lineItems(`value-${i}`, text, l.valueLook, { x: valueX, y: rowY, width }, measure, `data.items.${i}.value`).map((v) =>
      // A value with no in-between draws nothing until its beat (numbers.ts's seam).
      !counts && p < 1 ? { ...v, opacity: 0 } : v
    )
    const about = centreOf(rowBox)
    for (const it of [track, bar, ...label, ...value]) items.push(moved(it, move, about, size))
    rowY += l.rows[i] + l.rowGap
  })

  return { items: withDim(dimFor(style, t, targets, size), items) }
}
