import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChannelDiff } from '../../src/renderer/src/harness/compositorMeasure'
import {
  FOCUS_BAR,
  GLOW_BAR,
  borderAlphaMin,
  chebyshevDistance,
  focusVerdict,
  glowAlpha,
  glowRouteVerdict,
  type FocusReadings,
  type GlowRouteReading
} from '../../src/renderer/src/harness/glowMeasure'

/*
 * The harness's `glow` (M7) and `focus` options' numbers and verdicts
 * (docs/CLIPS.md §6.11, §6.15's M7, §6.16; phase 3's piece 2): the reach of a
 * glow read by chessboard distance from the shape, and every bar each verdict
 * holds a reading to. The pictures are WebGL's, read on the harness page.
 */

/** A `width` × `height` RGBA picture, transparent, with `alpha` at each listed pixel. */
function picture(width: number, height: number, pixels: [number, number, number][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (const [x, y, a] of pixels) data[(y * width + x) * 4 + 3] = a
  return data
}

describe('chebyshevDistance', () => {
  it('is the chessboard distance to the nearest ink pixel, as a brute force reads it', () => {
    const width = 23
    const height = 17
    let seed = 7
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
    const ink: [number, number, number][] = []
    for (let i = 0; i < 6; i++) ink.push([Math.floor(random() * width), Math.floor(random() * height), 1 + Math.floor(random() * 254)])
    const d = chebyshevDistance(picture(width, height, ink), width, height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const brute = Math.min(...ink.map(([ix, iy]) => Math.max(Math.abs(ix - x), Math.abs(iy - y))))
        expect(d[y * width + x], `${x},${y}`).toBe(brute)
      }
    }
  })

  it('is Infinity everywhere with no ink', () => {
    expect([...chebyshevDistance(picture(4, 3, []), 4, 3)].every((v) => v === Infinity)).toBe(true)
  })
})

describe('glowAlpha', () => {
  // A 3×3 shape in a 21×21 frame, its centre at (10, 10): the ink spans 9..11.
  const W = 21
  const shape: [number, number, number][] = []
  for (let y = 9; y <= 11; y++) for (let x = 9; x <= 11; x++) shape.push([x, y, 255])
  const reference = picture(W, W, shape)

  it('reads alpha beyond the reach, the glow within it outside the shape, and the bands by distance', () => {
    // The glow: 200 at distance 1, 40 at distance 4 (the reach), 3 at distance 5 (beyond), 9 at distance 9 (beyond 2r).
    const glow = picture(W, W, [...shape, [12, 10, 200], [10, 15, 40], [16, 10, 3], [10, 1, 9]])
    const r = glowAlpha(reference, glow, W, W, 4)
    expect(r.reach).toBe(4)
    expect(r.glowMax).toBe(200)
    expect(r.glowPixels).toBe(2)
    expect(r.outsideReach).toBe(9)
    expect(r.outsidePixels).toBe(W * W - 9 - (11 * 11 - 9))
    expect(r.bands.map((b) => b.maxAlpha)).toEqual([200, 9, 0, 0])
  })

  it('a glow cut exactly at its reach reads 0 beyond it; the shape itself is never read', () => {
    const glow = picture(W, W, [...shape, [14, 10, 12], [5, 5, 30]])
    const r = glowAlpha(reference, glow, W, W, 4)
    expect(r.outsideReach).toBe(0)
    expect(r.glowMax).toBe(30)
  })

  it('refuses pictures of different sizes', () => {
    expect(() => glowAlpha(reference, picture(W, W - 1, []), W, W, 4)).toThrow(/sizes/)
  })
})

const diff = (maxAll = 0, meanAll = 0): ChannelDiff => ({ mean: [meanAll, meanAll, meanAll, meanAll], max: [maxAll, 0, 0, 0], meanAll, maxAll, pixels: 100 })

function passingGlow(): GlowRouteReading {
  return {
    route: 'quad',
    alpha: { reach: 24, outsideReach: 0, outsidePixels: 4000, glowMax: 216, glowPixels: 900, bands: [] },
    base: diff(1, 0.0001),
    msPerFrame: 2,
    memory: { before: { geometries: 3, textures: 2 }, built: { geometries: 4, textures: 9 }, after: { geometries: 3, textures: 2 } }
  }
}

describe('glowRouteVerdict: M7’s bars', () => {
  it('passes a reading at every bar', () => {
    expect(glowRouteVerdict(passingGlow())).toEqual({ pass: true, failures: [] })
    expect(GLOW_BAR).toEqual({ outsideReachMax: 0, glowAlphaBelow: 255, baseMax: 2, baseMean: 0.0005 })
  })

  const cases: [string, (r: GlowRouteReading) => void, RegExp][] = [
    ['alpha 1 beyond the reach', (r) => (r.alpha.outsideReach = 1), /alpha 1 beyond the glow's reach of 24 px, not 0/],
    ['nothing read beyond the reach', (r) => (r.alpha.outsidePixels = 0), /no pixel beyond the reach/],
    ['a glow at 255 outside the shape', (r) => (r.alpha.glowMax = 255), /reaches 255 outside the shape, not below 255/],
    ['no glow drawn', (r) => (r.alpha.glowPixels = 0), /no glow was drawn/],
    ['the base off by 3', (r) => (r.base = diff(3, 0.0001)), /the base under the glow differs from painter A by 3 > 2/],
    ['the base’s mean 0.0005', (r) => (r.base = diff(1, 0.0005)), /mean 0\.0005, not 0\.000/],
    ['a target not given back', (r) => (r.memory.after = { geometries: 3, textures: 3 }), /dispose gave back 1 of 1 geometries and 6 of 7 textures/]
  ]
  for (const [name, spoil, failure] of cases) {
    it(`fails ${name}, and says so`, () => {
      const r = passingGlow()
      spoil(r)
      const v = glowRouteVerdict(r)
      expect(v.pass).toBe(false)
      expect(v.failures.some((f) => failure.test(f)), v.failures.join(' | ')).toBe(true)
    })
  }
})

function passingFocus(): FocusReadings {
  return { radius: 10, sharp: diff(1, 0.0001), blurred: diff(140, 9), edgeAlphaMin: 255 }
}

describe('focusVerdict', () => {
  it('passes a reading at every bar', () => {
    expect(focusVerdict(passingFocus())).toEqual({ pass: true, failures: [] })
    expect(FOCUS_BAR.edgeAlpha).toBe(255)
  })

  const cases: [string, (r: FocusReadings) => void, RegExp][] = [
    ['radius 0 off painter A by 3', (r) => (r.sharp = diff(3, 0.0001)), /radius 0 differs from painter A by 3 > 2/],
    ['radius 0’s mean 0.001', (r) => (r.sharp = diff(1, 0.001)), /radius 0: mean 0\.0010/],
    ['a blur that does not show', (r) => (r.blurred = diff(FOCUS_BAR.blurredMinMax - 1, 1)), /not visibly blurred/],
    ['the edge losing alpha', (r) => (r.edgeAlphaMin = 254), /alpha at the frame's edge falls to 254/],
    ['a radius of 0 read as the blurred case', (r) => (r.radius = 0), /radius is 0, not above 0/]
  ]
  for (const [name, spoil, failure] of cases) {
    it(`fails ${name}, and says so`, () => {
      const r = passingFocus()
      spoil(r)
      const v = focusVerdict(r)
      expect(v.pass).toBe(false)
      expect(v.failures.some((f) => failure.test(f)), v.failures.join(' | ')).toBe(true)
    })
  }
})

describe('borderAlphaMin', () => {
  it('reads the first and last rows and columns only', () => {
    const full: [number, number, number][] = []
    for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) full.push([x, y, 255])
    const data = picture(6, 5, full)
    data[(2 * 6 + 2) * 4 + 3] = 0
    expect(borderAlphaMin(data, 6, 5)).toBe(255)
    data[(4 * 6 + 3) * 4 + 3] = 200
    expect(borderAlphaMin(data, 6, 5)).toBe(200)
    data[(2 * 6 + 5) * 4 + 3] = 100
    expect(borderAlphaMin(data, 6, 5)).toBe(100)
  })
})

/*
 * Piece 1's `compositor` option reads routes two and three against painter A
 * at the 1:1 texture's bar. Once the glow and the blur draw, that reading
 * holds only with both left out: its painter B must pass the probe on every
 * call (the default argument), and M7's base reading must leave the glow out.
 * Read as source, every call site counted (CLAUDE.md, "check what your anchor
 * matched").
 */
describe('the harness reads the base under the glow and route three at rest through the probe', () => {
  const read = (file: string): string => readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'src', 'harness', file), 'utf8')

  it('compositorCheck: every painter B call takes BASE, the glow left out and every radius 0', () => {
    const source = read('compositorCheck.ts')
    expect(source).toContain('const BASE: CompositorProbe = { glow: false, focus: false }')
    expect(source).toContain('function painterB(l: DrawList, compositor: Compositor, probe: CompositorProbe = BASE): HTMLCanvasElement {')
    const draws = [...source.matchAll(/paintDrawList3d\(/g)]
    expect(draws).toHaveLength(1)
    expect(source.slice(draws[0].index!, source.indexOf('\n', draws[0].index!))).toContain('paintDrawList3d(l, compositor, { layer: freshLayer }, probe)')
    // No call passes another probe.
    expect([...source.matchAll(/painterB\(([^\n]*)\)/g)].filter((m) => /,\s*\{\s*(glow|focus)/.test(m[1]))).toEqual([])
  })

  it('glowCheck: the base is the same list with the glow left out', () => {
    const source = read('glowCheck.ts')
    const bases = [...source.matchAll(/const base = ([^\n]+)/g)].map((m) => m[1])
    expect(bases).toEqual(['diffChannels(reference, pixelsOf(painterB(glowing, compositor, { glow: false })))'])
  })
})
