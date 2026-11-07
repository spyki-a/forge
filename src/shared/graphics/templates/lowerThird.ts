/**
 * `lower-third` (docs/CLIPS.md §6.2): the speaker's name and, when typed,
 * their role, low in the frame or in the free third, at the content rect's
 * left.
 *
 * Items, in order: the dim when the style dims; `bar` (a rect in
 * `palette.accent`, 0.008 of `s` tall, under the name, as wide as the name
 * plus 0.04 of `s`); `name` (a wrapped name's further lines `name-1` …);
 * `role` (absent when ''). `name` is drawn exactly as `MediaAsset.speaker`
 * holds it and `role` as the user typed it; no glyph is added.
 *
 * Motion: the bar grows to full width over `DURATIONS.entrance`, ending on
 * the beat; `name` rises with it (`style.motion.entrance` over the same
 * span); `role` follows 0.1 s later (§6.2's proposal), so it arrives 0.1 s
 * after the beat. "Rises from behind" the bar is drawn as the entrance
 * alone: an item has no clip (beyond §6.2's words). The role sits 0.25 × its
 * px below the bar (beyond §6.2's words, which give no gap).
 */

import type { DrawItem, DrawOut, Drawer, Rect, ShapeItem } from '../items'
import { DURATIONS, entrance, progress } from '../motion'
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
  widestOf,
  withDim,
  wrapWidth
} from './layout'

/** How much later than the name the role arrives, seconds (§6.2, a proposal). */
export const ROLE_DELAY_S = 0.1
/** The role's gap below the bar, × its px (beyond §6.2's words). */
const ROLE_GAP = 0.25

export const drawLowerThird: Drawer = (spec, style, clock, size, measure, targets): DrawOut => {
  const data = spec.data
  if (data.template !== 'lower-third') return { items: [] }
  const sizes = LAYOUT_SIZES['lower-third']
  const s = shortSide(size)
  const rect = contentRect(spec.place, size)
  const wrap = wrapWidth(rect, size)

  const layout = (k: number) => {
    const nameLook = lookOf(style, sizes.name * s * k, 'left')
    const roleLook = lookOf(style, sizes.role * s * k, 'left')
    const names = lineItems('name', data.name, nameLook, { x: 0, y: 0, width: wrap }, measure, 'data.name')
    const roles = data.role === '' ? [] : lineItems('role', data.role, roleLook, { x: 0, y: 0, width: wrap }, measure, 'data.role')
    const nameHeight = names.length * lineHeightOf(nameLook)
    const barHeight = sizes.barHeight * s * k
    const barWidth = widestOf(names) + sizes.barExtra * s * k
    const roleGap = ROLE_GAP * roleLook.px
    const roleHeight = roles.length * lineHeightOf(roleLook)
    const width = Math.max(barWidth, widestOf(names), widestOf(roles))
    const height = nameHeight + barHeight + (roles.length > 0 ? roleGap + roleHeight : 0)
    return { nameLook, roleLook, nameHeight, barHeight, barWidth, roleGap, width, height }
  }
  const k = fitScale((scale) => fitsIn(layout(scale), rect))
  if (k === null) return { items: [] }
  const l = layout(k)

  // At the content rect's left, centred in its height.
  const x = rect.x
  const top = rect.y + (rect.height - l.height) / 2
  const names = lineItems('name', data.name, l.nameLook, { x, y: top, width: wrap }, measure, 'data.name')
  const barY = top + l.nameHeight
  const roleY = barY + l.barHeight + l.roleGap
  const roles = data.role === '' ? [] : lineItems('role', data.role, l.roleLook, { x, y: roleY, width: wrap }, measure, 'data.role')

  const t = clock.t
  const beat = beatOf(spec, 0)
  const E = DURATIONS.entrance
  const grow = progress(t, beat - E, E, drawOnEase(style))
  const bar: ShapeItem = {
    kind: 'shape',
    id: 'bar',
    opacity: 1,
    shape: 'rect',
    box: { x, y: barY, width: l.barWidth * grow, height: l.barHeight },
    fill: style.palette.accent
  }
  const nameEnter = entrance(style.motion.entrance, progress(t, beat - E, E, style.motion.ease))
  const roleEnter = entrance(style.motion.entrance, progress(t, beat + ROLE_DELAY_S - E, E, style.motion.ease))
  const nameBox: Rect = { x, y: top, width: l.width, height: l.nameHeight }
  const roleBox: Rect = { x, y: roleY, width: l.width, height: Math.max(0, top + l.height - roleY) }

  const items: DrawItem[] = [bar]
  for (const item of names) items.push(moved(item, { dy: nameEnter.dy * l.nameLook.px, scale: nameEnter.scale, opacity: nameEnter.opacity }, centreOf(nameBox), size))
  for (const item of roles) items.push(moved(item, { dy: roleEnter.dy * l.roleLook.px, scale: roleEnter.scale, opacity: roleEnter.opacity }, centreOf(roleBox), size))
  return { items: withDim(dimFor(style, t, targets, size), items) }
}
