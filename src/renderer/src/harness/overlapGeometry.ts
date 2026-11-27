/**
 * The box arithmetic of the overlap check (overlapCheck.ts), with no DOM: the
 * page part reads boxes and hands them here, so every rule below is tested on
 * plain numbers (tests/renderer/overlapGeometry.test.ts).
 *
 * THE ONE-PIXEL RULE. Two boxes overlap only when they share MORE than one
 * pixel each way: borders that touch (0 px) or meet on a rounded half pixel
 * (1 px) are how a row of buttons is laid out, not a collision. The same
 * slack applies to a box running past an edge: more than one pixel.
 *
 * A box wholly inside another is CONTAINMENT, not overlap: the page part
 * names it apart ("inside"), because one control drawn wholly over another is
 * a different finding from two that clip each other's corners.
 *
 * A box of no width or no height, or one wholly off the window, is SKIPPED:
 * nothing a person can see or press is there.
 */

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** More than this many pixels, each way, is an overlap or an edge passed. */
export const OVERLAP_SLACK_PX = 1

export const boxFrom = (r: { left: number; top: number; right: number; bottom: number }): Box => ({
  left: r.left,
  top: r.top,
  right: r.right,
  bottom: r.bottom
})

export const widthOf = (b: Box): number => b.right - b.left
export const heightOf = (b: Box): number => b.bottom - b.top

/** Whether a box is worth looking at: some width, some height, and some of it on the window `view`. */
export function measurable(b: Box, view: Box): boolean {
  if (!(widthOf(b) > 0 && heightOf(b) > 0)) return false
  return b.right > view.left && b.left < view.right && b.bottom > view.top && b.top < view.bottom
}

/** The part two boxes share, or null when they share no area. */
export function intersect(a: Box, b: Box): Box | null {
  const out = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) }
  return out.right > out.left && out.bottom > out.top ? out : null
}

/** `inner` lies within `outer`, to the same slack. */
export function containsBox(outer: Box, inner: Box): boolean {
  return (
    inner.left >= outer.left - OVERLAP_SLACK_PX &&
    inner.top >= outer.top - OVERLAP_SLACK_PX &&
    inner.right <= outer.right + OVERLAP_SLACK_PX &&
    inner.bottom <= outer.bottom + OVERLAP_SLACK_PX
  )
}

export type Relation = 'apart' | 'touch' | 'overlap' | 'inside'

/**
 * How two boxes sit: `apart` (nothing shared), `touch` (shared by one pixel or
 * less one way or the other), `inside` (one wholly within the other, by more
 * than the slack each way), or `overlap`.
 */
export function relation(a: Box, b: Box): Relation {
  const shared = intersect(a, b)
  if (!shared) return 'apart'
  if (widthOf(shared) <= OVERLAP_SLACK_PX || heightOf(shared) <= OVERLAP_SLACK_PX) return 'touch'
  if (containsBox(a, b) || containsBox(b, a)) return 'inside'
  return 'overlap'
}

/** How far `child` runs past each side of `edge`, kept only where it is more than the slack. */
export function pastEdges(child: Box, edge: Box): Partial<Record<'left' | 'right' | 'top' | 'bottom', number>> {
  const out: Partial<Record<'left' | 'right' | 'top' | 'bottom', number>> = {}
  const by = { left: edge.left - child.left, right: child.right - edge.right, top: edge.top - child.top, bottom: child.bottom - edge.bottom }
  for (const side of ['left', 'right', 'top', 'bottom'] as const) if (by[side] > OVERLAP_SLACK_PX) out[side] = Math.round(by[side] * 10) / 10
  return out
}

/** Whether an element's scroll width runs past its own width by more than the slack: something in it scrolls, or spills, sideways. */
export const sideways = (scrollWidth: number, clientWidth: number): boolean => clientWidth > 0 && scrollWidth - clientWidth > OVERLAP_SLACK_PX

/**
 * Every pair of items whose boxes overlap or sit one inside the other, the
 * items in DOM relation (`related`: one holds the other) left out — a button
 * in a row is not a collision with the row.
 */
export function collisions<T extends { box: Box }>(items: readonly T[], related: (a: T, b: T) => boolean): { a: T; b: T; how: 'overlap' | 'inside'; shared: Box }[] {
  const out: { a: T; b: T; how: 'overlap' | 'inside'; shared: Box }[] = []
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const how = relation(items[i].box, items[j].box)
      if (how !== 'overlap' && how !== 'inside') continue
      if (related(items[i], items[j])) continue
      out.push({ a: items[i], b: items[j], how, shared: intersect(items[i].box, items[j].box)! })
    }
  }
  return out
}
