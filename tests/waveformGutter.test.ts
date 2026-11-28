import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * The Trimmer's waveform box keeps a gutter as wide as half a handle.
 *
 * A handle is `w-3` (12 px) centred on its point with `-translate-x-1/2`, so
 * at the very start and the very end 6 px of it lie outside the box it is
 * placed in. With no gutter the start handle was cut on the left, and the end
 * handle made the Trimmer dock scroll sideways by 6 px — read off the page by
 * the overlap check on 2026-11-27 (scroll width 242 in a 236 px dock, in every
 * state with a clip selected). `mx-1.5` is those 6 px.
 *
 * Waveform.tsx draws the box in two places (a library sound being auditioned,
 * and a clip on the timeline), so every site is counted and held, not the
 * first one found.
 */

const WAVEFORM = readFileSync(join(__dirname, '..', 'src/renderer/src/components/Waveform.tsx'), 'utf8')

/** Tailwind's spacing scale: one unit is 0.25rem, 4 px. */
const px = (units: number): number => units * 4

describe('the waveform box and its handles', () => {
  const boxes = [...WAVEFORM.matchAll(/<div ref=\{attachBox\}[^>]*className="([^"]*)"/g)].map((m) => m[1])
  const handles = [...WAVEFORM.matchAll(/className="([^"]*\bcursor-ew-resize\b[^"]*)"/g)].map((m) => m[1])

  it('is drawn in two places, each with two handles from one written handle', () => {
    expect(boxes).toHaveLength(2)
    expect(handles).toHaveLength(2)
  })

  it('every handle is centred on its point, so half of it lies outside a point at either end', () => {
    for (const handle of handles) {
      expect(handle).toMatch(/\bw-3\b/)
      expect(handle).toMatch(/(^|\s)-translate-x-1\/2(\s|$)/)
    }
  })

  it('every box has a side gutter of half a handle', () => {
    const half = px(3) / 2
    for (const box of boxes) {
      const gutter = /(?:^|\s)mx-(\d+(?:\.\d+)?)(?:\s|$)/.exec(box)
      expect(gutter, box).not.toBeNull()
      expect(px(Number(gutter![1]))).toBe(half)
    }
  })
})
