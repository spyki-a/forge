/**
 * `before-after` (docs/CLIPS.md §9, "The 3D templates"): one card, the
 * "before" said first on its left half, then the "after" revealed on its
 * right: the after's panel box growing over the before's card from the
 * middle out (a `shape` item's box on §6.13's curve; no mask kind).
 *
 * Items, in order: the dim when the style dims; `panel` (rounded, the whole
 * card, `palette.panel` at `palette.panelOpacity`, only when that is above 0,
 * `panelFor`); `before-label` (a wrapped label's further lines
 * `before-label-1` …) and `before-value` (likewise); `reveal` (a rounded
 * shape in `palette.accent` at `REVEAL_OPACITY`, the after's half); then
 * `after-label` and `after-value`.
 *
 * Beats: two, `spec.beats[0]` the before's (its value's bound word, §6.8)
 * and `spec.beats[1]` the after's (the last beat stands in for a missing one,
 * `beatOf`). The card (panel, reveal's place and the before's words) enters
 * with `style.motion.entrance` over `DURATIONS.entrance`, ending in place ON
 * beat 0. The reveal's width grows from 0 at the card's middle to the whole
 * right half over `DURATIONS.entrance`, on the draw-on curve (`drawOnEase`:
 * never past its half), ending ON beat 1; the after's words enter with the
 * entrance over the same span, ending ON beat 1. Before each start an
 * element's items are there at opacity 0 (the reveal at width 0). From the
 * last beat on nothing moves: the settled frame is beat 1's.
 *
 * Layout: templates/sides.ts (two halves side by side, label above value,
 * every text through `lineItems`). Values are drawn as said, whole on their
 * beat: no count (a before and an after are not one number climbing).
 *
 * A missing side, or an empty field, draws no text for it; nothing at all to
 * draw (every string empty) draws nothing; too long for its place at
 * `FIT_MIN`, nothing (the too-big rule).
 *
 * Depth (3D templates piece 3, templates/depth.ts `depthOut`): with a
 * `depth`, the same items on their planes (`DEPTH_PLANES['before-after']`)
 * with a camera over the card's entrance; under `focus` the labels, the
 * panel and the reveal blur until the after lands. A plain spec's list is
 * unchanged.
 *
 * Pure, as every drawer (§6.2).
 */

import type { DrawItem, DrawOut, Drawer, ShapeItem } from '../items'
import { DURATIONS, progress } from '../motion'
import { LAYOUT_SIZES, beatOf, centreOf, dimFor, drawOnEase, enterMove, moved, panelFor, shortSide, withDim } from './layout'
import { layoutSides, sideOf } from './sides'
import { depthOut } from './depth'

/** The reveal's opacity over the card: the accent tints the after's half and the text over it stays read (this piece's proposal). */
export const REVEAL_OPACITY = 0.35

export const drawBeforeAfter: Drawer = (spec, style, clock, size, measure, targets): DrawOut => {
  const data = spec.data
  if (data.template !== 'before-after') return { items: [] }
  const before = sideOf(data, 'before')
  const after = sideOf(data, 'after')
  if ([before.label, before.value, after.label, after.value].every((v) => v.trim() === '')) return { items: [] }
  const l = layoutSides([before, after], ['before', 'after'], LAYOUT_SIZES['before-after'], spec.place, style, size, measure)
  if (!l) return { items: [] }

  const t = clock.t
  const E = DURATIONS.entrance
  const b0 = beatOf(spec, 0)
  const b1 = beatOf(spec, 1)
  const centre = centreOf(l.block)
  const cardMove = enterMove(style, progress(t, b0 - E, E, style.motion.ease), l.labelPx)
  const afterMove = enterMove(style, progress(t, b1 - E, E, style.motion.ease), l.labelPx)
  const grow = progress(t, b1 - E, E, drawOnEase(style))
  const right = l.halves[1].box

  const items: DrawItem[] = []
  const panel = panelFor('panel', l.block, style, size)
  if (panel) items.push(moved(panel, cardMove, centre, size))
  for (const item of [...l.halves[0].label, ...l.halves[0].value]) items.push(moved(item, cardMove, centre, size))
  const reveal: ShapeItem = {
    kind: 'shape',
    id: 'reveal',
    // At opacity 0 until it starts to grow, so nothing of it is drawn before its span.
    opacity: grow > 0 ? REVEAL_OPACITY : 0,
    shape: 'rounded',
    box: { x: right.x, y: right.y, width: right.width * grow, height: right.height },
    radius: style.radius * shortSide(size),
    fill: style.palette.accent
  }
  items.push(moved(reveal, cardMove, centre, size))
  for (const item of [...l.halves[1].label, ...l.halves[1].value]) items.push(moved(item, afterMove, centreOf(right), size))

  // 3D templates piece 3 (§9, §6.16, templates/depth.ts): with a depth, the same items on their planes with a camera, settling flat by the after's beat.
  return depthOut('before-after', spec, style, t, b0, size, withDim(dimFor(style, t, targets, size), items), b1)
}
