import { afterEach, describe, expect, it } from 'vitest'
import { encodeFrames, setPoolCanvases, type PoolCanvas } from '../../src/renderer/src/encodePool'

/*
 * The graphic bake's encode pool (docs/CLIPS.md §6.3, §6.15's piece 0.2), driven
 * with canvases that need no DOM.
 *
 * Each fake canvas remembers which frame was last drawn on it; its `toBlob`
 * hands back that frame's number as the PNG's one byte, after a delay that
 * makes LATER frames finish encoding FIRST, so a pool that wrote in the order
 * its encodes finished would write out of order here. What is under test is
 * the pool's own sequencing: every frame drawn on a cleared canvas, never on
 * a canvas whose encode is still in flight, `depth` encodes overlapping, the
 * writes in frame order with each frame's own bytes, and nothing written once
 * the bake is cancelled or has failed.
 */

interface Fake extends PoolCanvas {
  stamp: number | null
  encoding: boolean
}

interface Rig {
  canvases: Fake[]
  draws: number[]
  /** Draws that found the previous frame still on the canvas. */
  unclean: number[]
  /** Draws onto a canvas whose encode had not finished. */
  overEncode: number[]
  inFlight: number
  maxInFlight: number
  writes: { index: number; byte: number }[]
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function rig(count: number, options: { failAt?: number } = {}): Rig {
  const r: Rig = { canvases: [], draws: [], unclean: [], overEncode: [], inFlight: 0, maxInFlight: 0, writes: [] }
  setPoolCanvases(() => {
    const canvas: Fake = {
      stamp: null,
      encoding: false,
      getContext: () =>
        ({
          owner: canvas,
          save: () => undefined,
          restore: () => undefined,
          clearRect: () => {
            canvas.stamp = null
          }
        }) as unknown as CanvasRenderingContext2D,
      toBlob: (callback) => {
        const frame = canvas.stamp
        canvas.encoding = true
        r.inFlight++
        r.maxInFlight = Math.max(r.maxInFlight, r.inFlight)
        // Later frames encode faster: frame 0 takes the longest.
        setTimeout(
          () => {
            canvas.encoding = false
            r.inFlight--
            callback(frame === options.failAt || frame === null ? null : new Blob([new Uint8Array([frame])]))
          },
          3 * (count - (frame ?? 0))
        )
      }
    }
    r.canvases.push(canvas)
    return canvas
  })
  return r
}

function drawInto(r: Rig) {
  return (ctx: CanvasRenderingContext2D, index: number): void => {
    const canvas = (ctx as unknown as { owner: Fake }).owner
    if (canvas.stamp !== null) r.unclean.push(index)
    if (canvas.encoding) r.overEncode.push(index)
    canvas.stamp = index
    r.draws.push(index)
  }
}

function writeInto(r: Rig) {
  return async (index: number, bytes: ArrayBuffer): Promise<string> => {
    r.writes.push({ index, byte: new Uint8Array(bytes)[0] })
    await sleep(1)
    return `seq/${index}`
  }
}

afterEach(() => setPoolCanvases(null))

describe('encodeFrames', () => {
  it('overlaps depth encodes, draws each frame on a clean, idle canvas, and writes every frame in order with its own bytes', async () => {
    const count = 10
    const r = rig(count)
    const path = await encodeFrames({
      count,
      width: 8,
      height: 8,
      depth: 4,
      draw: drawInto(r),
      write: writeInto(r),
      cancelled: () => false
    })

    expect(path).toBe('seq/9')
    expect(r.writes.map((w) => w.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    for (const w of r.writes) expect(w.byte, `frame ${w.index}'s bytes`).toBe(w.index)
    expect(r.draws).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(r.unclean, 'drawn over the previous frame').toEqual([])
    expect(r.overEncode, 'drawn on a canvas still encoding').toEqual([])
    expect(r.canvases).toHaveLength(4)
    // The pool's whole point: four encodes at once, and never more.
    expect(r.maxInFlight).toBe(4)
  })

  it('clamps the depth to the frames there are, and to at least one', async () => {
    const few = rig(2)
    await encodeFrames({ count: 2, width: 8, height: 8, depth: 8, draw: drawInto(few), write: writeInto(few), cancelled: () => false })
    expect(few.canvases).toHaveLength(2)

    const one = rig(3)
    await encodeFrames({ count: 3, width: 8, height: 8, depth: 0, draw: drawInto(one), write: writeInto(one), cancelled: () => false })
    expect(one.canvases).toHaveLength(1)
    expect(one.maxInFlight).toBe(1)
    expect(one.writes.map((w) => w.index)).toEqual([0, 1, 2])

    const none = rig(0)
    expect(await encodeFrames({ count: 0, width: 8, height: 8, depth: 4, draw: drawInto(none), write: writeInto(none), cancelled: () => false })).toBeNull()
    expect(none.canvases).toHaveLength(0)
  })

  it('writes nothing once cancelled, though encodes were in flight, and resolves null', async () => {
    const count = 12
    const r = rig(count)
    const path = await encodeFrames({
      count,
      width: 8,
      height: 8,
      depth: 4,
      draw: drawInto(r),
      write: writeInto(r),
      cancelled: () => r.writes.length >= 3
    })
    expect(path).toBeNull()
    // Frames 3 and beyond were drawn and encoding when the cancel landed.
    expect(r.draws.length).toBeGreaterThan(3)
    expect(r.writes.map((w) => w.index)).toEqual([0, 1, 2])
    await sleep(60)
    expect(r.writes.map((w) => w.index), 'a write after the answer').toEqual([0, 1, 2])
  })

  it('rejects on a frame that will not encode, and writes nothing from that frame on, nor after the answer', async () => {
    const count = 12
    const r = rig(count, { failAt: 5 })
    await expect(
      encodeFrames({ count, width: 8, height: 8, depth: 4, draw: drawInto(r), write: writeInto(r), cancelled: () => false })
    ).rejects.toThrow('Could not encode a frame')
    // Frames behind it were encoding; the bake is lost, so they may or may not
    // have been written, but only ever as an unbroken run from frame 0.
    const written = r.writes.map((w) => w.index)
    expect(written).toEqual(written.map((_, i) => i))
    expect(written.every((index) => index < 5), `written: ${written.join(', ')}`).toBe(true)
    expect(r.draws.length, 'drawing went on to the end').toBeLessThan(count)
    await sleep(60)
    expect(r.writes.map((w) => w.index), 'a write after the answer').toEqual(written)
  })
})
