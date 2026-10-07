import { describe, expect, it } from 'vitest'
import { clipEnd, sourceFrameFor, timelineFrameAt, type Clip } from '@shared/timeline'

/*
 * `timelineFrameAt`, the inverse of `sourceFrameFor` (docs/CLIPS.md §3b.6,
 * §4.7): a word's source ms to the timeline frame that shows it, through the
 * clip's speed or ramp. A binary search over the forward mapping — so it is
 * tested AGAINST the forward mapping, frame by frame, at every kind of speed
 * the timeline has.
 */

const FPS = 30

function clip(patch: Partial<Clip> = {}): Clip {
  return {
    id: 'c',
    assetId: 'a',
    trackId: 'v1',
    start: 120,
    duration: 900,
    inPoint: 450,
    volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    color: { brightness: 0, contrast: 1, saturation: 1 },
    ...patch
  }
}

/** A deterministic generator, so a failing case names its seed. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A source frame's own start, in ms — as a word starting on that frame would carry it. */
const msOf = (frame: number, fps = FPS): number => (frame * 1000) / fps

const SPEEDS: [string, Partial<Clip>][] = [
  ['speed 1', {}],
  ['2×', { speed: 2 }],
  ['0.5×', { speed: 0.5 }],
  ['a ramp slowing 1× → 0.25×', { ramp: { from: 1, to: 0.25 } }],
  ['a ramp speeding 0.5× → 3×', { ramp: { from: 0.5, to: 3 } }]
]

describe('timelineFrameAt — the inverse of sourceFrameFor', () => {
  for (const [name, patch] of SPEEDS) {
    it(`round-trips 200 random frames at ${name}: the frame it gives shows that source, and is the FIRST that does`, () => {
      const c = clip(patch)
      const next = random(name.length * 7919)
      for (let n = 0; n < 200; n++) {
        const f = c.start + Math.floor(next() * c.duration)
        const s = sourceFrameFor(c, f)
        const g = timelineFrameAt(c, msOf(s), FPS)
        expect(g, `${name}, frame ${f}`).not.toBeNull()
        expect(sourceFrameFor(c, g!), `${name}: frame ${f} shows source ${s}; frame ${g} should too`).toBe(s)
        expect(g!, `${name}: frame ${g} is after ${f}, which shows the same source`).toBeLessThanOrEqual(f)
        // The first: the frame before it shows earlier footage, or there is none in the clip.
        if (g! > c.start) expect(sourceFrameFor(c, g! - 1), `${name}: ${g! - 1} already shows ${s}`).toBeLessThan(s)
      }
    })
  }

  it('at 1× and 2× every frame shows a source of its own, so the round trip lands on the very frame', () => {
    for (const patch of [{}, { speed: 2 }]) {
      const c = clip(patch)
      const next = random(42)
      for (let n = 0; n < 200; n++) {
        const f = c.start + Math.floor(next() * c.duration)
        expect(timelineFrameAt(c, msOf(sourceFrameFor(c, f)), FPS)).toBe(f)
      }
    }
  })

  it('reads a word’s ms as the frame it falls in: anywhere inside a source frame finds that frame', () => {
    const c = clip()
    // Source frame 600 runs from 20 000 ms to 20 033.3 ms; at 1× it is shown on 120 + 150.
    for (const ms of [20_000, 20_001, 20_016, 20_033]) expect(timelineFrameAt(c, ms, FPS)).toBe(270)
    expect(timelineFrameAt(c, 20_034, FPS)).toBe(271)
  })

  it('round-trips at 29.97 fps too, where a frame is no whole number of ms', () => {
    const fps = 30_000 / 1001
    const c = clip({ speed: 2 })
    const next = random(2997)
    for (let n = 0; n < 200; n++) {
      const f = c.start + Math.floor(next() * c.duration)
      const s = sourceFrameFor(c, f)
      expect(timelineFrameAt(c, msOf(s, fps), fps)).toBe(f)
    }
  })

  it('gives the frame after a source frame the timeline skips (2×, or a ramp above 1×)', () => {
    const c = clip({ speed: 2 })
    // In-point 450 at 2×: the clip shows 450, 452, 454… — 451 is never shown.
    expect(sourceFrameFor(c, c.start)).toBe(450)
    expect(timelineFrameAt(c, msOf(451), FPS)).toBe(c.start + 1)
    expect(sourceFrameFor(c, c.start + 1)).toBe(452)
  })

  it('is clamped to the clip: before its in-point is its first frame, past what it plays is clipEnd', () => {
    const c = clip({ speed: 2 })
    expect(timelineFrameAt(c, 0, FPS)).toBe(c.start)
    expect(timelineFrameAt(c, msOf(449), FPS)).toBe(c.start)
    // 900 frames at 2× play source 450 to 2250; 2250 itself is clipEnd's, one past the last.
    expect(timelineFrameAt(c, msOf(2250), FPS)).toBe(clipEnd(c))
    expect(timelineFrameAt(c, msOf(5000), FPS)).toBe(clipEnd(c))
  })

  it('has no inverse for a hold — one frame for its whole length — and says so with null', () => {
    const held = clip({ hold: true, duration: 60 })
    expect(sourceFrameFor(held, held.start)).toBe(held.inPoint)
    expect(sourceFrameFor(held, held.start + 59)).toBe(held.inPoint)
    expect(timelineFrameAt(held, msOf(held.inPoint), FPS)).toBeNull()
  })
})
