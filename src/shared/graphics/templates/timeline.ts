/**
 * `timeline` (docs/CLIPS.md §9, "The 3D templates"): two to five dated rows
 * down a rail, one row arriving per item as it is said. No title: the data has
 * none, and the app writes no headline.
 *
 * Items, in order: the dim when the style dims; then per item i, `edge-i`
 * (i ≥ 1, a stroke down the rail from dot i − 1 to dot i), `dot-i` (a circle
 * shape on the rail, `palette.ink`), `when-i` (a wrapped when's further lines
 * `when-i-1` …) and `label-i` (further lines `label-i-1` …).
 *
 * Beats: one per item, `spec.beats[i]` (its when's bound word, §6.8; the
 * last beat stands in for a missing one, `beatOf`). Row i (its dot, its when
 * and its label) enters with `style.motion.entrance` over
 * `DURATIONS.entrance`, ending in place ON beat i; before `beat − entrance`
 * its items are there at opacity 0. `edge-i` is drawn on (`from` 0, `to` p)
 * over `DURATIONS.stroke` ending on beat i, round caps, as steps' line is.
 * From the last beat on nothing moves: the settled frame is the last beat's.
 *
 * Layout, beyond §6.2's words (LAYOUT_SIZES.timeline): one layout at every
 * shape, as bars and steps, the block centred in the content rect; the rail
 * column, then the when column (as wide as the widest when on one line, at
 * most `whenMax` of the content width, a longer when wraps in it), a gap, and
 * the label in what is left, wrapping. Text goes through `lineItems` as every
 * template's does, so any script the others draw this draws; too long for
 * its place at `FIT_MIN`, it draws nothing (the too-big rule). A row is as
 * tall as its taller field, the dot on its first line's middle.
 *
 * An empty `when` or `label` draws no text for it (the row keeps its dot and
 * its beat); no items at all draws nothing.
 *
 * Depth (3D templates piece 3, templates/depth.ts `depthOut`): with a
 * `depth`, the same items on their planes (`DEPTH_PLANES.timeline`) with a
 * camera over the first row's entrance; under `focus` the labels blur until
 * the last row lands. A plain spec's list is unchanged.
 *
 * Pure, as every drawer (§6.2): never paints, measures only through
 * `measure`, curves only from `motion.ts`.
 */

import type { DrawItem, DrawOut, Drawer, Rect, ShapeItem, StrokeItem, TextItem } from '../items'
import { DURATIONS, progress } from '../motion'
import {
  LAYOUT_SIZES,
  beatOf,
  boxOf,
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
  shortSide,
  strokePx,
  widestOf,
  withDim,
  wrapWidth
} from './layout'
import { depthOut } from './depth'

export const drawTimeline: Drawer = (spec, style, clock, size, measure, targets): DrawOut => {
  const data = spec.data
  if (data.template !== 'timeline') return { items: [] }
  const rows = Array.isArray(data.items) ? data.items : []
  if (rows.length === 0) return { items: [] }
  const sizes = LAYOUT_SIZES.timeline
  const s = shortSide(size)
  const rect = contentRect(spec.place, size)
  const wrap = wrapWidth(rect, size)
  const text = (v: unknown): string => (typeof v === 'string' ? v : '')

  const layout = (k: number, x0: number) => {
    const whenLook = lookOf(style, sizes.when * s * k, 'left')
    const labelLook = lookOf(style, sizes.label * s * k, 'left')
    const labelPx = sizes.label * s * k
    const rail = sizes.rail * s * k
    const widestWhen = rows.reduce((m, item) => Math.max(m, measure(text(item.when), whenLook).width), 0)
    const whenColumn = Math.min(sizes.whenMax * wrap, widestWhen)
    const gap = whenColumn > 0 ? sizes.gap * labelPx : 0
    const labelX = x0 + rail + whenColumn + gap
    const labelWidth = wrap - rail - whenColumn - gap
    const rowGap = sizes.rowGap * labelPx
    const whenLine = lineHeightOf(whenLook)
    const labelLine = lineHeightOf(labelLook)
    let y = 0
    let width = 0
    const laid = rows.map((item, i) => {
      const when = whenColumn > 0 ? lineItems(`when-${i}`, text(item.when), whenLook, { x: x0 + rail, y, width: whenColumn }, measure, `data.items.${i}.when`) : []
      const label = labelWidth > 0 ? lineItems(`label-${i}`, text(item.label), labelLook, { x: labelX, y, width: labelWidth }, measure, `data.items.${i}.label`) : []
      const height = Math.max(whenLine, labelLine, when.length * whenLine, label.length * labelLine)
      width = Math.max(width, rail + whenColumn + gap + widestOf(label))
      const fits =
        labelWidth > 0 &&
        label.every((l) => l.box.width <= labelWidth + 1e-6) &&
        when.every((w) => w.box.width <= whenColumn + 1e-6)
      const row = { y, height, when, label, fits, mid: y + Math.max(whenLine, labelLine) / 2 }
      y += height + rowGap
      return row
    })
    const height = y - rowGap
    return { whenLook, labelLook, labelPx, rail, laid, width, height }
  }
  const k = fitScale((scale) => {
    const l = layout(scale, 0)
    return l.width <= wrap + 1e-6 && l.laid.every((r) => r.fits) && fitsIn(l, rect)
  })
  if (k === null) return { items: [] }
  // The block centred in the content rect (§6.2), laid out again at its own left and moved down into it.
  const sized = layout(k, 0)
  const x0 = rect.x + (rect.width - sized.width) / 2
  const l = layout(k, x0)
  const y0 = rect.y + (rect.height - l.height) / 2
  const down = <T extends { box: Rect }>(item: T): T => ({ ...item, box: { ...item.box, y: item.box.y + y0 } })

  const t = clock.t
  const E = DURATIONS.entrance
  const S = DURATIONS.stroke
  const railX = x0 + l.rail / 2
  const dotD = LAYOUT_SIZES.timeline.dot * l.labelPx
  const mids = l.laid.map((r) => y0 + r.mid)
  const items: DrawItem[] = []

  l.laid.forEach((r, i) => {
    const beat = beatOf(spec, i)
    if (i >= 1) {
      const edge: StrokeItem = {
        kind: 'stroke',
        id: `edge-${i}`,
        opacity: 1,
        d: `M ${railX} ${mids[i - 1]} L ${railX} ${mids[i]}`,
        from: 0,
        to: progress(t, beat - S, S, drawOnEase(style)),
        width: strokePx(style, size),
        color: style.palette.ink,
        cap: 'round',
        join: 'round',
        look: style.strokeLook
      }
      items.push(edge)
    }
    const dot: ShapeItem = {
      kind: 'shape',
      id: `dot-${i}`,
      opacity: 1,
      shape: 'circle',
      box: { x: railX - dotD / 2, y: mids[i] - dotD / 2, width: dotD, height: dotD },
      fill: style.palette.ink
    }
    const words: TextItem[] = [...r.when.map(down), ...r.label.map(down)]
    const box = boxOf([dot, ...words]) ?? dot.box
    const move = enterMove(style, progress(t, beat - E, E, style.motion.ease), l.labelLook.px)
    for (const item of [dot, ...words]) items.push(moved(item, move, centreOf(box), size))
  })

  // 3D templates piece 3 (§9, §6.16, templates/depth.ts): with a depth, the same items on their planes with a camera, settling flat by the last beat.
  return depthOut('timeline', spec, style, t, beatOf(spec, 0), size, withDim(dimFor(style, t, targets, size), items), beatOf(spec, l.laid.length - 1))
}
