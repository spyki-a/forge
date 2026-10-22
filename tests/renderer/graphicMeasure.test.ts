import { describe, expect, it } from 'vitest'
import {
  SYNTHETIC,
  contains,
  diffRgba,
  inkBox,
  percentile,
  syntheticBox,
  syntheticPanelAt
} from '../../src/renderer/src/harness/graphicMeasure'

/*
 * The arithmetic behind the graphics check's verdicts (docs/CLIPS.md §6.15):
 * M22 calls a cluster shaped when two frames differ, M3 calls a script safe to
 * split when two frames are equal, M6 wants 0.000 through a texture. Each of
 * those is a `diffRgba` over an `inkBox`, and the timings are `percentile`s.
 * A wrong difference here would certify a wrong verdict in the user's console,
 * where no test runs.
 */

/** A `width`×`height` RGBA picture, transparent, with `paint` applied. */
function picture(width: number, height: number, paint: (set: (x: number, y: number, rgba: number[]) => void) => void): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  paint((x, y, rgba) => data.set(rgba, (y * width + x) * 4))
  return data
}

describe('diffRgba', () => {
  it('sees a difference in alpha alone: white type on a transparent canvas is 255 in colour at every coverage', () => {
    const a = picture(4, 2, (set) => set(1, 1, [255, 255, 255, 255]))
    const b = picture(4, 2, (set) => set(1, 1, [255, 255, 255, 128]))
    const d = diffRgba(a, b, 4)
    expect(d.differing).toBe(1)
    expect(d.max).toBe(127)
    // 127 levels in one channel of one of the 8 pixels' 32 channels.
    expect(d.mean).toBeCloseTo(127 / 32, 10)
  })

  it('counts only the box it is given, and averages over that box', () => {
    const a = picture(4, 4, () => undefined)
    const b = picture(4, 4, (set) => {
      set(0, 0, [8, 0, 0, 0])
      set(3, 3, [0, 0, 0, 40])
    })
    const d = diffRgba(a, b, 4, { x: 2, y: 2, width: 2, height: 2 })
    expect(d.pixels).toBe(4)
    expect(d.differing).toBe(1)
    expect(d.max).toBe(40)
    expect(d.mean).toBeCloseTo(40 / 16, 10)
    expect(diffRgba(a, a, 4).mean).toBe(0)
  })
})

describe('inkBox', () => {
  it('holds every pixel with alpha, its last row and column included, and is null on a blank picture', () => {
    const data = picture(6, 5, (set) => {
      set(1, 2, [0, 0, 0, 1])
      set(4, 3, [0, 0, 0, 255])
    })
    expect(inkBox(data, 6, 5)).toEqual({ x: 1, y: 2, width: 4, height: 2 })
    expect(inkBox(data, 6, 5, 1)).toEqual({ x: 4, y: 3, width: 1, height: 1 })
    expect(inkBox(picture(6, 5, () => undefined), 6, 5)).toBeNull()
  })
})

describe('percentile', () => {
  it('is nearest-rank over a sorted copy, leaving the timings as they were', () => {
    const values = Array.from({ length: 20 }, (_, i) => 20 - i)
    expect(percentile(values, 50)).toBe(10)
    expect(percentile(values, 95)).toBe(19)
    expect(percentile(values, 100)).toBe(20)
    expect(values[0]).toBe(20)
    expect(percentile([], 50)).toBeNaN()
  })
})

describe('the synthetic graphic', () => {
  it('has a box that holds the panel at its first and last frame, padded, on even pixels, inside the canvas', () => {
    for (const frames of [1, 2, 120, 300]) {
      const box = syntheticBox(frames)
      for (const frame of [0, frames - 1]) {
        const panel = syntheticPanelAt(frame)
        const padded = { x: panel.x - SYNTHETIC.pad, y: panel.y - SYNTHETIC.pad, width: panel.width + 2 * SYNTHETIC.pad, height: panel.height + 2 * SYNTHETIC.pad }
        expect(contains(box, padded), `${frames} frames, frame ${frame}`).toBe(true)
      }
      expect([box.x, box.y, box.width, box.height].every((v) => v % 2 === 0), `${frames}: ${JSON.stringify(box)}`).toBe(true)
      expect(contains({ x: 0, y: 0, width: SYNTHETIC.width, height: SYNTHETIC.height }, box)).toBe(true)
    }
    // About a fifth of the frame at rest, as §6.15 sizes it; the 120-frame rise adds 238 rows.
    expect(syntheticBox(120).height).toBe(SYNTHETIC.panel.height + 2 * 119 + 2 * SYNTHETIC.pad)
  })
})
