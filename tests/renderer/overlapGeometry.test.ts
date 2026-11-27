import { describe, expect, it } from 'vitest'
import {
  collisions,
  containsBox,
  intersect,
  measurable,
  pastEdges,
  relation,
  sideways,
  type Box
} from '../../src/renderer/src/harness/overlapGeometry'

/*
 * The overlap check's box arithmetic (harness/overlapGeometry.ts), on plain
 * numbers: what the page part decides is an overlap, a containment, an edge
 * passed or a sideways scroll. The page part only reads boxes and hands them
 * here, so these rules are the check.
 */

const box = (left: number, top: number, w: number, h: number): Box => ({ left, top, right: left + w, bottom: top + h })
const VIEW = box(0, 0, 1200, 800)

describe('two boxes', () => {
  it('that touch along an edge are not an overlap', () => {
    expect(relation(box(0, 0, 50, 20), box(50, 0, 50, 20))).toBe('apart')
    expect(relation(box(0, 0, 50, 20), box(0, 20, 50, 20))).toBe('apart')
  })

  it('that share one pixel one way are not an overlap; two pixels each way are', () => {
    expect(relation(box(0, 0, 50, 20), box(49, 0, 50, 20))).toBe('touch')
    expect(relation(box(0, 0, 50, 20), box(0, 19, 50, 20))).toBe('touch')
    expect(relation(box(0, 0, 50, 20), box(48, 5, 50, 20))).toBe('overlap')
    // Two pixels one way and one the other is still a touch: more than one pixel EACH way.
    expect(relation(box(0, 0, 50, 20), box(48, 19, 50, 20))).toBe('touch')
  })

  it('one wholly inside the other is containment, not overlap, whichever is given first', () => {
    expect(relation(box(0, 0, 100, 40), box(10, 10, 20, 10))).toBe('inside')
    expect(relation(box(10, 10, 20, 10), box(0, 0, 100, 40))).toBe('inside')
    expect(containsBox(box(0, 0, 100, 40), box(10, 10, 20, 10))).toBe(true)
    expect(containsBox(box(10, 10, 20, 10), box(0, 0, 100, 40))).toBe(false)
    // Half a pixel past is still inside (rounding), three is not.
    expect(containsBox(box(0, 0, 100, 40), box(-0.5, 10, 20, 10))).toBe(true)
    expect(relation(box(0, 0, 100, 40), box(-3, 10, 20, 10))).toBe('overlap')
  })

  it('that share nothing are apart, and share no box', () => {
    expect(relation(box(0, 0, 10, 10), box(100, 100, 10, 10))).toBe('apart')
    expect(intersect(box(0, 0, 10, 10), box(100, 100, 10, 10))).toBe(null)
    expect(intersect(box(0, 0, 10, 10), box(5, 5, 10, 10))).toEqual(box(5, 5, 5, 5))
  })
})

describe('boxes skipped', () => {
  it('a box of no width or no height', () => {
    expect(measurable(box(10, 10, 0, 20), VIEW)).toBe(false)
    expect(measurable(box(10, 10, 20, 0), VIEW)).toBe(false)
    expect(measurable(box(10, 10, 20, 20), VIEW)).toBe(true)
  })

  it('a box wholly off the window, on any side; one partly on it is kept', () => {
    expect(measurable(box(-50, 10, 40, 20), VIEW)).toBe(false)
    expect(measurable(box(1200, 10, 40, 20), VIEW)).toBe(false)
    expect(measurable(box(10, -30, 40, 20), VIEW)).toBe(false)
    expect(measurable(box(10, 800, 40, 20), VIEW)).toBe(false)
    expect(measurable(box(-20, 10, 40, 20), VIEW)).toBe(true)
  })
})

describe('an edge passed', () => {
  it('by more than a pixel is reported on its side; by a pixel or less, not', () => {
    const edge = box(0, 0, 200, 100)
    expect(pastEdges(box(10, 10, 50, 20), edge)).toEqual({})
    expect(pastEdges(box(160, 10, 41, 20), edge)).toEqual({})
    expect(pastEdges(box(160, 10, 45, 20), edge)).toEqual({ right: 5 })
    expect(pastEdges(box(-4, 90, 20, 20), edge)).toEqual({ left: 4, bottom: 10 })
  })
})

describe('sideways', () => {
  it('is a scroll width more than a pixel past the width; an element with no width is not looked at', () => {
    expect(sideways(241, 240)).toBe(false)
    expect(sideways(242, 240)).toBe(true)
    expect(sideways(30, 0)).toBe(false)
  })
})

describe('collisions', () => {
  type Item = { id: string; box: Box; parent?: string }
  const related = (a: Item, b: Item): boolean => a.parent === b.id || b.parent === a.id

  it('lists each overlapping or contained pair once, and leaves out a pair where one holds the other in the DOM', () => {
    const items: Item[] = [
      { id: 'row', box: box(0, 0, 200, 30) },
      { id: 'in-row', box: box(10, 5, 40, 20), parent: 'row' },
      { id: 'stray', box: box(30, 10, 40, 20) },
      { id: 'beside', box: box(250, 0, 40, 20) },
      { id: 'touching', box: box(290, 0, 40, 20) }
    ]
    const found = collisions(items, related).map(({ a, b, how }) => `${a.id}/${b.id}:${how}`)
    // row holds in-row: no finding. stray sits wholly in row's box but is not in it: "inside". stray and in-row clip: "overlap".
    expect(found).toEqual(['row/stray:inside', 'in-row/stray:overlap'])
  })
})
