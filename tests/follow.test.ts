import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  followScroll,
  laneIndexAt,
  zoomToFit,
  PAGE_MARGIN,
  MIN_ZOOM,
  MAX_ZOOM
} from '@shared/edit/follow'

const view = (over: Partial<Parameters<typeof followScroll>[0]> = {}): Parameters<typeof followScroll>[0] => ({
  playheadPx: 100,
  scrollLeft: 0,
  viewWidth: 800,
  contentWidth: 4000,
  playing: false,
  ...over
})

describe('following the playhead', () => {
  it('does nothing while the playhead is in view', () => {
    /*
     * The common case, and it has to cost nothing: assigning `scrollLeft`
     * every frame — even to the value it already holds — fights anyone
     * dragging the scrollbar, which is why this returns null rather than a
     * position.
     */
    expect(followScroll(view({ playheadPx: 400 }))).toBeNull()
    expect(followScroll(view({ playheadPx: 400, playing: true }))).toBeNull()
  })

  it('pages while playing, so the lane is not scrolling under a still playhead', () => {
    // Walked off the right-hand edge: jump so it sits a tenth in, with the
    // whole width to cross before the next jump.
    const next = followScroll(view({ playheadPx: 1200, playing: true }))
    expect(next).toBe(1200 - 800 * PAGE_MARGIN)

    // And from there it has the rest of the view to run through.
    expect(followScroll(view({ playheadPx: 1300, scrollLeft: next!, playing: true }))).toBeNull()
    expect(followScroll(view({ playheadPx: 1900, scrollLeft: next!, playing: true }))).toBeNull()
  })

  it('centres when paused, because a seek means "show me this"', () => {
    expect(followScroll(view({ playheadPx: 1200 }))).toBe(1200 - 400)
  })

  it('never scrolls past either end', () => {
    // At the very start there is nothing to the left to show.
    expect(followScroll(view({ playheadPx: 5, scrollLeft: 900 }))).toBe(0)
    // At the very end, the clamp lands where the lane already is, which is
    // "nothing to do" rather than a scroll to the same place.
    expect(followScroll(view({ playheadPx: 3999, scrollLeft: 3200 }))).toBeNull()
    expect(followScroll(view({ playheadPx: 3999, scrollLeft: 0 }))).toBe(3200)
  })

  it('treats a playhead on the boundary as off screen', () => {
    // Otherwise it hovers half-visible at the edge and never triggers.
    expect(followScroll(view({ playheadPx: 800, scrollLeft: 0 }))).not.toBeNull()
    expect(followScroll(view({ playheadPx: 0, scrollLeft: 0 }))).toBeNull()
  })

  it('refuses to guess with no width to work with', () => {
    expect(followScroll(view({ viewWidth: 0 }))).toBeNull()
  })
})

describe('zoom to fit', () => {
  it('fits the whole project in the width, with a little room to spare', () => {
    /*
     * Strictly inside, not flush: a project fitted to exactly the width ends
     * with its last clip against the edge, where the trim handle is half
     * off-screen and there is nowhere to drop anything after it. Pinned as a
     * range because "less than or equal" passed with the margin deleted.
     */
    const width = 900
    const zoom = zoomToFit(3000, width)
    const fitted = 3000 * zoom

    expect(fitted).toBeLessThan(width)
    expect(width - fitted).toBeGreaterThan(width * 0.01)
    expect(width - fitted).toBeLessThan(width * 0.1)
  })

  it('stays inside bounds a timeline can still be used at', () => {
    /*
     * A four-hour project at the honest ratio would put every clip on a
     * fraction of a pixel and make the timeline unclickable; a one-frame
     * project would ask for a zoom of nine hundred.
     */
    expect(zoomToFit(60 * 60 * 30 * 4, 900)).toBe(MIN_ZOOM)
    expect(zoomToFit(2, 100_000)).toBe(MAX_ZOOM)
  })

  it('leaves an empty timeline at its own zoom rather than snapping to a bound', () => {
    expect(zoomToFit(0, 900)).toBe(1)
    expect(zoomToFit(1, 900)).toBe(1)
  })

  it('refuses to guess with no width', () => {
    expect(zoomToFit(3000, 0)).toBe(MIN_ZOOM)
  })
})

describe('laneIndexAt: the lane under the pointer, with the stack scrolled', () => {
  const at = (y: number, scrollTop = 0): number => laneIndexAt({ y, scrollTop, rulerHeight: 28, trackHeight: 62 })

  it('counts lanes from under the ruler when nothing is scrolled', () => {
    expect(at(28)).toBe(0)
    expect(at(28 + 61)).toBe(0)
    expect(at(28 + 62)).toBe(1)
    expect(at(28 + 62 * 3 + 5)).toBe(3)
  })

  it('adds the scroll: the same screen position is a lower lane once the stack has moved up', () => {
    expect(at(28 + 10, 62 * 2)).toBe(2)
    expect(at(28 + 10, 62 * 2 - 11)).toBe(1)
    expect(at(28 + 62 + 30, 100)).toBe(3)
  })

  it('a pointer on the pinned ruler is over no lane, whatever is scrolled under it', () => {
    expect(at(27.9)).toBe(-1)
    expect(at(0, 500)).toBe(-1)
    expect(at(-40, 500)).toBe(-1)
  })

  it('never divides by nothing and never counts a negative scroll', () => {
    expect(laneIndexAt({ y: 100, scrollTop: 0, rulerHeight: 28, trackHeight: 0 })).toBe(-1)
    expect(at(28 + 10, -30)).toBe(0)
  })
})

describe('the timeline scrolls as one stack (Timeline.tsx, by its source)', () => {
  const source = readFileSync(resolve(__dirname, '..', 'src/renderer/src/components/Timeline.tsx'), 'utf8')
  const tagOf = (marker: string): string => {
    const hits = [...source.matchAll(new RegExp(marker, 'g'))]
    expect(hits, marker).toHaveLength(1)
    const from = source.lastIndexOf('<div', hits[0].index)
    return source.slice(from, source.indexOf('>', hits[0].index) + 1)
  }

  it('the lanes are the one scroller, both ways, and tell the headers when they move', () => {
    const lanes = tagOf('data-timeline-lanes')
    expect(lanes).toContain('ref={laneRef}')
    expect(lanes).toContain('overflow-auto')
    expect(lanes).not.toMatch(/overflow-y-hidden|overflow-x-auto/)
    expect(lanes).toContain('onScroll={syncHeaders}')
    expect(lanes).toContain('timeline-scroll')
  })

  it('the header column never scrolls on its own', () => {
    const headers = tagOf('data-timeline-headers')
    expect(headers).toContain('overflow-hidden')
    expect(headers).not.toMatch(/overflow-(y-)?(auto|scroll)/)
    expect(headers).toContain('onWheel')
    // Nothing else in the file may bring a second vertical scroller back.
    expect(source).not.toMatch(/overflow-y-(auto|scroll)/)
  })

  it('the headers follow the lanes\u2019 scrollTop, and the lane under a pointer counts it', () => {
    expect(source).toMatch(/rows\.style\.transform = `translateY\(\$\{-lane\.scrollTop\}px\)`/)
    const laneAt = source.slice(source.indexOf('const laneAt = useCallback('), source.indexOf('/** A drop on a track'))
    expect(laneAt).toContain('scrollTop: lane.scrollTop')
    expect(laneAt).toContain('laneIndexAt(')
  })

  it('the header column takes its width from HEADER_WIDTH, and Remove is drawn without a hover', () => {
    const headers = tagOf('data-timeline-headers')
    expect(headers).toContain('style={{ width: HEADER_WIDTH }}')
    expect(headers).not.toMatch(/\bw-\[\d+px\]/)
    const width = Number(/const HEADER_WIDTH = (\d+)/.exec(source)?.[1])
    // An audio row: 16 of padding, the name's 28, seven gaps of 4, and mute 15, S 10, the voice-over button 14, VO 17, the meter 18, Remove 14.
    expect(width).toBeGreaterThanOrEqual(16 + 28 + 7 * 4 + 15 + 10 + 14 + 17 + 18 + 14)
    const from = source.indexOf('data-track-remove')
    expect(source.indexOf('data-track-remove', from + 1)).toBe(-1)
    const remove = source.slice(source.lastIndexOf('<button', from), source.indexOf('<Trash2', from))
    expect(remove).toContain('shrink-0')
    // Hidden only when it cannot be pressed; never hidden until hovered.
    expect(remove.match(/(?<![:\w-])opacity-0\b/g)).toBeNull()
    expect(remove).toContain('disabled:opacity-0')
  })

  it('a band is tested against where each row is now, not where it was drawn', () => {
    const band = source.slice(source.indexOf('const clipsInBand = useCallback('), source.indexOf('/** Each lane’s row') > 0 ? source.indexOf('/** Each lane’s row') : source.indexOf('const laneNodes = useRef'))
    expect(band).toContain('laneNodes.current.get(track.id)?.getBoundingClientRect()')
    expect(source).not.toContain('laneBoxes')
  })
})
