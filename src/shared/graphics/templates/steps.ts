/**
 * `steps` (docs/CLIPS.md §6.2): a numbered list, one row arriving per item as
 * it is said, with connector `none`, `line` or `tree` (the app's, from
 * `graphics/tree.ts`; parents from `spec.data.items[i].parent`).
 *
 * Items, in order: the dim when the style dims; `title` (a wrapped title's
 * further lines `title-1` …); under a tree, `marker`, the title's dot (a
 * circle shape in `palette.ink`), the root its edges leave; then per item i,
 * `edge-i` when the connector draws one, and `row-i`, a group of `num-i` (a
 * fixed glyph, "1" to "6", restarting under each parent in a tree) and
 * `label-i` (further lines `label-i-1` …); last, under `line` in the
 * `energetic` style only, `beam`, the travelling beam.
 *
 * Motion: the title (and its marker) enters from t = 0 over
 * `DURATIONS.entrance`, as the bars' title does; each row enters with
 * `style.motion.entrance` over `DURATIONS.entrance`, ending in place on its
 * beat. `line`: `edge-i` (i ≥ 1) runs from the numeral above to row i's,
 * round caps, no heads, drawn on (`from` 0, `to` p) over `DURATIONS.stroke`
 * ending on row i's beat. `tree`: every row is indented by its depth (1
 * under the title, 2 under an item; 0.06 of `s` a level), and `edge-i` is an
 * elbow from its parent's numeral (or the title's marker) down and across to
 * row i, a rounded corner, `heads.end` an `Arrowhead` riding the tip and
 * growing in over its first 0.1 s (`headGrowAt`), drawn on over
 * `DURATIONS.stroke` ending on row i's beat.
 *
 * Every edge leaves the numeral column's left middle (§6.2's layout row);
 * a line's segments run straight down that left edge, beside the numerals.
 *
 * Beyond §6.2's words: the title is left-aligned above the rows, a row gap
 * below it; under a tree it starts after a numeral column that holds its
 * marker (a dot 0.3 × the label's px across, its left edge the column's
 * left); a tree whose parents fail `parentsValid` is drawn flat under the
 * title; an elbow's corner radius is 0.3 × the label's px (less on a short
 * leg) and its horizontal leg stops 0.15 × the label's px short of the
 * child's column; the numerals are centred in their column.
 *
 * The travelling beam (§6.2, allowed by M1 2026-10-27; `graphicMovingFrames`
 * already bakes the whole hold for it): from the last beat on, a span of
 * `BEAM_SPAN` of the rule's length whose `from` and `to` both advance,
 * `linear`, one pass every `DURATIONS.loop` (5.5 s, the motion module's loop;
 * §6.2 says "a 5 s loop"), in `palette.accent`; before the last beat it is an
 * empty span. Its span and colour are beyond §6.2's words.
 */

import type { DrawItem, DrawOut, Drawer, GroupItem, Rect, ShapeItem, StrokeItem, TextItem } from '../items'
import { headGrowAt } from '../stroke'
import { DURATIONS, progress } from '../motion'
import { parentsValid } from '../tree'
import {
  HEAD_SIZE,
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

/** The step numerals, fixed glyphs (§6.2's fixed-glyph table): "1" to "6". */
export const STEP_NUMERALS: readonly string[] = Object.freeze(['1', '2', '3', '4', '5', '6'])

/** The beam's span, a share of the rule's length (beyond §6.2's words, which say "a short span"). */
export const BEAM_SPAN = 0.2

/** The marker's diameter, the elbow's corner and the leg's stop short of the child, × the label's px (beyond §6.2's words). */
const MARKER = 0.3
const CORNER = 0.3
const LEG_STOP = 0.15

/** Each row's depth: 0 for every row without a tree; under a tree 1 for the title's children, 2 for an item's. */
export function stepDepths(parents: readonly number[], tree: boolean): number[] {
  if (!tree) return parents.map(() => 0)
  const valid = parentsValid([...parents])
  return parents.map((p) => (valid && p >= 0 ? 2 : 1))
}

/** Each row's numeral: its place among its siblings (the same parent), from "1"; every row a sibling of the others without a tree. */
export function stepNumerals(parents: readonly number[], tree: boolean): string[] {
  const valid = tree && parentsValid([...parents])
  const seen = new Map<number, number>()
  return parents.map((p) => {
    const key = valid ? p : -1
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    return STEP_NUMERALS[Math.min(n, STEP_NUMERALS.length) - 1]
  })
}

export const drawSteps: Drawer = (spec, style, clock, size, measure, targets): DrawOut => {
  const data = spec.data
  if (data.template !== 'steps') return { items: [] }
  const sizes = LAYOUT_SIZES.steps
  const s = shortSide(size)
  const rect = contentRect(spec.place, size)
  const wrap = wrapWidth(rect, size)
  const tree = data.connector === 'tree'
  const parents = data.items.map((item) => (Number.isInteger(item.parent) ? (item.parent as number) : -1))
  const valid = parentsValid([...parents])
  const depths = stepDepths(parents, tree)
  const numerals = stepNumerals(parents, tree)

  const layout = (k: number, x0: number) => {
    const titleLook = lookOf(style, sizes.title * s * k, 'left')
    const numLook = lookOf(style, sizes.num * s * k, 'center')
    const labelLook = lookOf(style, sizes.label * s * k, 'left')
    const labelPx = sizes.label * s * k
    const numColumn = sizes.numColumn * s * k
    const indent = sizes.indent * s * k
    const rowGap = sizes.rowGap * labelPx
    const titleX = x0 + (tree ? numColumn : 0)
    const titleWrap = wrap - (tree ? numColumn : 0)
    const title = lineItems('title', data.title, titleLook, { x: titleX, y: 0, width: titleWrap }, measure, 'data.title')
    const titleHeight = title.length * lineHeightOf(titleLook)
    const labelLine = lineHeightOf(labelLook)
    const numLine = lineHeightOf(numLook)
    let y = titleHeight + (titleHeight > 0 && data.items.length > 0 ? rowGap : 0)
    let width = title.length > 0 ? (tree ? numColumn : 0) + widestOf(title) : tree ? numColumn : 0
    const rows = data.items.map((item, i) => {
      const left = x0 + depths[i] * indent
      const labelWidth = wrap - depths[i] * indent - numColumn
      const label = lineItems(`label-${i}`, item.label, labelLook, { x: left + numColumn, y, width: labelWidth }, measure, `data.items.${i}.label`)
      const num = lineItems(`num-${i}`, numerals[i], numLook, { x: left, y, width: numColumn }, measure)
      const height = Math.max(numLine, label.length * labelLine)
      width = Math.max(width, depths[i] * indent + numColumn + widestOf(label))
      const row = { left, y, height, label, num, fits: labelWidth > 0 && label.every((l) => l.box.width <= labelWidth + 1e-6) }
      y += height + rowGap
      return row
    })
    const height = rows.length > 0 ? y - rowGap : titleHeight
    return { titleLook, numLook, labelLook, labelPx, numColumn, indent, title, titleHeight, labelLine, rows, width, height }
  }
  const k = fitScale((scale) => {
    const l = layout(scale, 0)
    return l.width <= wrap + 1e-6 && l.rows.every((r) => r.fits) && fitsIn(l, rect)
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
  const width = strokePx(style, size)
  const items: DrawItem[] = []

  // The title, and under a tree its marker, entering from t = 0.
  const title = l.title.map(down)
  const titleMid = y0 + (title.length > 0 ? lineHeightOf(l.titleLook) / 2 : 0)
  const titleBox: Rect = boxOf(title) ?? { x: x0, y: y0, width: 0, height: 0 }
  const titleMove = enterMove(style, progress(t, 0, E, style.motion.ease), l.titleLook.px)
  for (const item of title) items.push(moved(item, titleMove, centreOf(titleBox), size))
  const markerD = MARKER * l.labelPx
  if (tree) {
    const marker: ShapeItem = {
      kind: 'shape',
      id: 'marker',
      opacity: 1,
      shape: 'circle',
      box: { x: x0, y: titleMid - markerD / 2, width: markerD, height: markerD },
      fill: style.palette.ink
    }
    items.push(moved(marker, titleMove, centreOf(titleBox), size))
  }

  // Each row's anchor: its numeral column's left middle (the first label line's middle).
  const mids = l.rows.map((r) => y0 + r.y + l.labelLine / 2)
  const lefts = l.rows.map((r) => r.left)
  const stroke = (id: string, d: string, beat: number, head: boolean): StrokeItem => {
    const item: StrokeItem = {
      kind: 'stroke',
      id,
      opacity: 1,
      d,
      from: 0,
      to: progress(t, beat - S, S, drawOnEase(style)),
      width,
      color: style.palette.ink,
      cap: 'round',
      join: 'round',
      look: style.strokeLook
    }
    if (head) item.heads = { end: { size: HEAD_SIZE * s, grow: headGrowAt(t, beat - S) } }
    return item
  }

  l.rows.forEach((r, i) => {
    const beat = beatOf(spec, i)
    if (data.connector === 'line' && i >= 1) {
      items.push(stroke(`edge-${i}`, `M ${lefts[i - 1]} ${mids[i - 1]} L ${lefts[i]} ${mids[i]}`, beat, false))
    }
    if (tree) {
      const p = valid ? parents[i] : -1
      const ax = p >= 0 ? lefts[p] : x0
      const ay = p >= 0 ? mids[p] : titleMid
      const cy = mids[i]
      const ex = r.left - LEG_STOP * l.labelPx
      const corner = Math.max(0, Math.min(CORNER * l.labelPx, cy - ay, ex - ax))
      const d = `M ${ax} ${ay} L ${ax} ${cy - corner} Q ${ax} ${cy} ${ax + corner} ${cy} L ${ex} ${cy}`
      items.push(stroke(`edge-${i}`, d, beat, true))
    }
    const children: DrawItem[] = [...r.num.map(down), ...r.label.map(down)]
    const box = boxOf(children as TextItem[]) ?? { x: r.left, y: y0 + r.y, width: 0, height: r.height }
    const row: GroupItem = { kind: 'group', id: `row-${i}`, opacity: 1, children }
    const move = enterMove(style, progress(t, beat - E, E, style.motion.ease), l.labelLook.px)
    items.push(moved(row, move, centreOf(box), size))
  })

  // The travelling beam: energetic and a line only, once per clip, from the last beat on.
  if (data.connector === 'line' && style.energy === 'energetic' && l.rows.length >= 2) {
    const last = l.rows.length - 1
    const start = beatOf(spec, last)
    const loop = DURATIONS.loop
    const inLoop = t < start ? 0 : (t - start) % loop
    const q = t < start ? 0 : progress(inLoop, 0, loop, 'linear') * (1 + BEAM_SPAN)
    const beam: StrokeItem = {
      kind: 'stroke',
      id: 'beam',
      opacity: 1,
      d: `M ${lefts[0]} ${mids[0]} L ${lefts[last]} ${mids[last]}`,
      from: Math.max(0, Math.min(1, q - BEAM_SPAN)),
      to: Math.max(0, Math.min(1, q)),
      width,
      color: style.palette.accent,
      cap: 'round',
      join: 'round',
      look: style.strokeLook
    }
    items.push(beam)
  }

  return { items: withDim(dimFor(style, t, targets, size), items) }
}
