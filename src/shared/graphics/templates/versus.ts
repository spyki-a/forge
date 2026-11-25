/**
 * `versus` (docs/CLIPS.md §9, "The 3D templates"): two sides face to face,
 * each a label above its value on its own panel, the left said first, a
 * divider drawn down between them as the right arrives. No "vs" glyph: the
 * template adds no word (§6.2's painter's contract), the divider is a stroke.
 *
 * Items, in order: the dim when the style dims; `left-panel` (rounded,
 * `palette.panel` at `palette.panelOpacity`, only when that is above 0,
 * `panelFor`); `left-label` (a wrapped label's further lines `left-label-1`
 * …) and `left-value` (likewise); `divider` (a stroke in `palette.ink`, down
 * the middle gap, round caps); `right-panel`, `right-label`, `right-value`.
 *
 * Beats: two, `spec.beats[0]` the left's (its value's bound word, §6.8) and
 * `spec.beats[1]` the right's (the last beat stands in for a missing one,
 * `beatOf`). The left's panel and words enter with `style.motion.entrance`
 * over `DURATIONS.entrance`, ending in place ON beat 0; the right's likewise
 * ON beat 1; the divider is drawn on (`from` 0, `to` p) over
 * `DURATIONS.stroke`, ending ON beat 1. Before each start an element's items
 * are there at opacity 0 (the divider at `to` 0). From the last beat on
 * nothing moves: the settled frame is beat 1's.
 *
 * Layout: templates/sides.ts (two halves side by side, label above value,
 * `LAYOUT_SIZES.versus.middle` × the label's px between them, every text
 * through `lineItems`). Values are drawn as said, whole on their beat.
 *
 * A missing side, or an empty field, draws no text for it (its panel stays);
 * nothing at all to draw (every string empty) draws nothing; too long for its
 * place at `FIT_MIN`, nothing (the too-big rule).
 *
 * Pure, as every drawer (§6.2).
 */

import type { DrawItem, DrawOut, Drawer, StrokeItem } from '../items'
import { DURATIONS, progress } from '../motion'
import { LAYOUT_SIZES, beatOf, centreOf, dimFor, drawOnEase, enterMove, moved, panelFor, strokePx, withDim } from './layout'
import { layoutSides, sideOf } from './sides'

export const drawVersus: Drawer = (spec, style, clock, size, measure, targets): DrawOut => {
  const data = spec.data
  if (data.template !== 'versus') return { items: [] }
  const left = sideOf(data, 'left')
  const right = sideOf(data, 'right')
  if ([left.label, left.value, right.label, right.value].every((v) => v.trim() === '')) return { items: [] }
  const l = layoutSides([left, right], ['left', 'right'], LAYOUT_SIZES.versus, spec.place, style, size, measure)
  if (!l) return { items: [] }

  const t = clock.t
  const E = DURATIONS.entrance
  const S = DURATIONS.stroke
  const beats = [beatOf(spec, 0), beatOf(spec, 1)]
  const items: DrawItem[] = []
  const pad = LAYOUT_SIZES.versus.pad * l.labelPx

  l.halves.forEach((half, j) => {
    const name = j === 0 ? 'left' : 'right'
    const move = enterMove(style, progress(t, beats[j] - E, E, style.motion.ease), l.labelPx)
    const about = centreOf(half.box)
    if (j === 1) {
      const x = half.box.x - l.middle / 2
      const divider: StrokeItem = {
        kind: 'stroke',
        id: 'divider',
        opacity: 1,
        d: `M ${x} ${half.box.y + pad} L ${x} ${half.box.y + half.box.height - pad}`,
        from: 0,
        to: progress(t, beats[1] - S, S, drawOnEase(style)),
        width: strokePx(style, size),
        color: style.palette.ink,
        cap: 'round',
        join: 'round',
        look: style.strokeLook
      }
      items.push(divider)
    }
    const panel = panelFor(`${name}-panel`, half.box, style, size)
    if (panel) items.push(moved(panel, move, about, size))
    for (const item of [...half.label, ...half.value]) items.push(moved(item, move, about, size))
  })

  return { items: withDim(dimFor(style, t, targets, size), items) }
}
