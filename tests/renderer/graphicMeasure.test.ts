import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeFrames, setPoolCanvases } from '../../src/renderer/src/encodePool'
import {
  SYNTHETIC,
  contains,
  diffRgba,
  inkBox,
  percentile,
  perFrameMs,
  preBaseLead,
  spread,
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

describe('perFrameMs', () => {
  afterEach(() => {
    vi.useRealTimers()
    setPoolCanvases(null)
  })

  it('counts each burst of a pipelined pool once, where the gap between writes reads its parts', () => {
    // Four deep, the encodes finishing together every 30 ms: four writes 0.5 ms apart, then a wait.
    const writtenAt = Array.from({ length: 20 }, (_, i) => 30 * Math.floor(i / 4) + 0.5 * (i % 4))
    const windowed = perFrameMs(writtenAt, 4)
    expect(windowed).toHaveLength(16)
    for (const [i, ms] of windowed.entries()) expect(ms, `window ${i}`).toBeCloseTo(7.5, 10)
    // What the check printed before: three gaps of 0.5 and one of 28.5 a burst, p50 0.5 ms "a frame".
    expect(percentile(writtenAt.slice(1).map((t, i) => t - writtenAt[i]), 50)).toBe(0.5)
    // One deep, the window is the gap itself; fewer writes than the window, nothing.
    expect(perFrameMs([0, 10, 25], 1)).toEqual([10, 15])
    expect(perFrameMs([0, 10], 4)).toEqual([])
  })

  it("agrees with the pool's own wall time per frame at depth 1, 2 and 4, driven through encodeFrames", async () => {
    // The verifier's simulation in fake time: every encode takes 30 ms, all of them in parallel.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const count = 48
    for (const depth of [1, 2, 4]) {
      setPoolCanvases(() => ({
        getContext: () => ({ save: () => undefined, restore: () => undefined, clearRect: () => undefined }) as unknown as CanvasRenderingContext2D,
        toBlob: (callback) => {
          setTimeout(() => callback({ arrayBuffer: async () => new ArrayBuffer(1) } as unknown as Blob), 30)
        }
      }))
      const writtenAt: number[] = []
      const started = Date.now()
      let finished = false
      const done = encodeFrames({
        count,
        width: 8,
        height: 8,
        depth,
        draw: () => undefined,
        write: async (index) => {
          writtenAt.push(Date.now())
          return `seq/${index}`
        },
        cancelled: () => false
      }).finally(() => {
        finished = true
      })
      for (let ms = 0; !finished && ms < 10_000; ms++) await vi.advanceTimersByTimeAsync(1)
      expect(await done).toBe(`seq/${count - 1}`)
      const wall = (Date.now() - started) / count
      const windowed = spread(perFrameMs(writtenAt, depth))
      expect(wall, `depth ${depth}`).toBeCloseTo(30 / depth, 0)
      expect(windowed.p50, `depth ${depth}: windowed p50 against ${wall} ms a frame`).toBeCloseTo(wall, 0)
      expect(windowed.p95, `depth ${depth}: windowed p95`).toBeCloseTo(wall, 0)
      if (depth > 1) {
        // The bug it replaces: the gaps' p50 is the burst's inside, not a frame's cost.
        const gaps = spread(writtenAt.slice(1).map((t, i) => t - writtenAt[i]))
        expect(gaps.p50, `depth ${depth}: gap p50`).toBeLessThan(wall / 2)
      }
    }
  })
})

describe('preBaseLead (M22: कि)', () => {
  /*
   * A consonant: a stem, a headline and an arm, rows 2 to 6. An i-matra: a
   * stem at the pen and a hook along row 0, outside the consonant's rows, as
   * the real one loops over the headline.
   */
  const W = 24
  const H = 8
  const consonant = (set: (x: number, y: number, rgba: number[]) => void, dx: number): void => {
    for (let y = 2; y <= 6; y++) set(1 + dx, y, [255, 255, 255, 255])
    for (let x = 1; x <= 6; x++) set(x + dx, 2, [255, 255, 255, 255])
    for (let x = 3; x <= 5; x++) set(x + dx, 4, [255, 255, 255, 200])
  }
  const matra = (set: (x: number, y: number, rgba: number[]) => void, at: number, hookTo: number): void => {
    for (let y = 1; y <= 6; y++) set(at, y, [255, 255, 255, 255])
    for (let x = Math.min(at, hookTo); x <= Math.max(at, hookTo); x++) set(x, 0, [255, 255, 255, 255])
  }
  const alone = picture(W, H, (set) => consonant(set, 0))

  it('finds the consonant pushed right by a matra drawn before it, though both drawings start at the pen', () => {
    // Shaped: the matra at the pen (x 1), the consonant after it.
    const shaped = picture(W, H, (set) => {
      matra(set, 1, 12)
      consonant(set, 6)
    })
    // The reading it replaces could not see this: the two left edges are the same pixel.
    expect(inkBox(shaped, W, H)!.x).toBe(inkBox(alone, W, H)!.x)
    expect(preBaseLead(shaped, alone, W, H)).toEqual({ shift: 6, error: 0, first: true })
  })

  it('reads an i-matra drawn after its consonant, in logical order, as not first', () => {
    const unshaped = picture(W, H, (set) => {
      consonant(set, 0)
      matra(set, 9, 5)
    })
    expect(preBaseLead(unshaped, alone, W, H)).toEqual({ shift: 0, error: 0, first: false })
    expect(preBaseLead(unshaped, picture(W, H, () => undefined), W, H)).toBeNull()
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
