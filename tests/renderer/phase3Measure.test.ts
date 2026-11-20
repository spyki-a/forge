import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChannelDiff } from '../../src/renderer/src/harness/compositorMeasure'
import { TEMPLATES_BAR, type PixelDiff } from '../../src/renderer/src/harness/graphicMeasure'
import {
  EXPORT_PARITY_BAR,
  HANDOFF_BAR,
  HERO_LANDING_BAR,
  READBACK_BAR,
  READBACK_FRAMES,
  READBACK_ROUTES,
  WHOLE_HOLD_BUDGET,
  bakeBudget,
  exportParityFrames,
  exportParityVerdict,
  glowChange,
  handoffWithin,
  heroLandingWithin,
  keepsStraightAlpha,
  m13Phase3Line,
  memoryBack,
  readbackFrames,
  readbackRoutes,
  readbackVerdict,
  screenCardParityFrames,
  straightAgainst,
  straightTopDown,
  type ExportParityReading,
  type ReadbackRow
} from '../../src/renderer/src/harness/phase3Measure'
import { GRAPHIC_CHECK_OPTIONS, askedOptions } from '../../src/renderer/src/harness/graphicCheck'

/*
 * Phase 3's piece 6 (docs/CLIPS.md §6.11's `readback` and `screenCard:
 * '<path>'` rows, §6.12's "Phase 3" exit, §6.15's M12, M13 and M20): the pure
 * numbers and bars behind the harness's `readback`, `bake3d` and
 * `screenCard: '<path>'` options and the depth option's landing reading. The
 * pictures are WebGL's, read on the harness page or in the development app.
 */

describe('M12: the readback routes and their reading', () => {
  it('readbackRoutes: true is all three in the row’s order; a list is kept, each once; anything else is refused naming the routes', () => {
    expect(readbackRoutes(true)).toEqual(['drawImage', 'readPixels', 'readRenderTargetPixelsAsync'])
    expect(READBACK_ROUTES).toEqual(['drawImage', 'readPixels', 'readRenderTargetPixelsAsync'])
    expect(readbackRoutes(['readPixels', 'drawImage', 'readPixels'])).toEqual(['readPixels', 'drawImage'])
    expect(() => readbackRoutes(['toDataURL'])).toThrow(/"toDataURL", not one of drawImage, readPixels, readRenderTargetPixelsAsync/)
    expect(() => readbackRoutes([])).toThrow(/takes a list of drawImage, readPixels, readRenderTargetPixelsAsync/)
    expect(() => readbackRoutes('drawImage')).toThrow(/takes a list/)
  })

  it('readbackFrames: the call’s whole number of frames, 120 when it names none or a nonsense one', () => {
    expect(READBACK_FRAMES).toBe(120)
    expect(readbackFrames(30)).toBe(30)
    expect(readbackFrames(30.7)).toBe(30)
    for (const bad of [undefined, 0, -3, NaN, Infinity, '60']) expect(readbackFrames(bad), String(bad)).toBe(120)
  })

  it('straightTopDown flips the rows a GL read gives bottom up and divides colour by alpha, rounded and clamped; alpha 0 is all 0', () => {
    // 1×2: the GL read's first row is the picture's bottom.
    const gl = [
      // bottom: premultiplied (64, 32, 0) at alpha 128 → straight (128, 64, 0)
      64, 32, 0, 128,
      // top: opaque (10, 20, 30); then a pixel of alpha 0 is impossible to give colour to
      10, 20, 30, 255
    ]
    expect([...straightTopDown(gl, 1, 2)]).toEqual([10, 20, 30, 255, 128, 64, 0, 128])
    expect([...straightTopDown([9, 9, 9, 0], 1, 1)]).toEqual([0, 0, 0, 0])
    // Colour above alpha (not premultiplied) is clamped, never wrapped.
    expect([...straightTopDown([200, 0, 0, 100], 1, 1)]).toEqual([255, 0, 0, 100])
    expect(() => straightTopDown([0, 0, 0], 1, 1)).toThrow(/is not 1×1 RGBA/)
  })

  it('straightAgainst and keepsStraightAlpha: a PNG that kept the frame’s straight colour passes; one stored premultiplied, or with alpha moved, does not', () => {
    const frame = [200, 100, 50, 128, 255, 255, 255, 255, 0, 0, 0, 0]
    expect(keepsStraightAlpha(straightAgainst(frame, frame))).toBe(true)
    // Within the bar: a level of colour and of alpha.
    expect(keepsStraightAlpha(straightAgainst(frame, [201, 101, 51, 129, 254, 255, 255, 255, 0, 0, 0, 0]))).toBe(true)
    // Stored premultiplied: half the colour at alpha 128.
    const stored = straightAgainst(frame, [100, 50, 25, 128, 255, 255, 255, 255, 0, 0, 0, 0])
    expect(stored.colourMax).toBe(100)
    expect(keepsStraightAlpha(stored)).toBe(false)
    expect(keepsStraightAlpha(straightAgainst(frame, [200, 100, 50, 140, 255, 255, 255, 255, 0, 0, 0, 0]))).toBe(false)
    // Colour below minAlpha is not read (8-bit premultiplied cannot hold it), so a pixel there counts for alpha only.
    const faint = straightAgainst([200, 0, 0, READBACK_BAR.minAlpha - 1], [10, 0, 0, READBACK_BAR.minAlpha - 1])
    expect(faint.colourPixels).toBe(0)
    expect(keepsStraightAlpha(faint)).toBe(false)
    // Nothing read keeps nothing.
    expect(keepsStraightAlpha(straightAgainst([0, 0, 0, 0], [0, 0, 0, 0]))).toBe(false)
  })

  it('straightAgainst counts the partial-alpha pixels read, and a frame with none of them keeps nothing: an opaque pixel reads the same stored straight or premultiplied', () => {
    expect(straightAgainst([200, 100, 50, 128, 255, 255, 255, 255], [200, 100, 50, 128, 255, 255, 255, 255]).partialPixels).toBe(1)
    // The critic's case: the only partial pixel (alpha 100) is below minAlpha, so its colour is not read; the opaque one matches either way.
    const premultipliedPng = straightAgainst([200, 100, 50, 100, 255, 255, 255, 255], [78, 39, 20, 100, 255, 255, 255, 255])
    expect(premultipliedPng).toMatchObject({ alphaMax: 0, colourMax: 0, colourPixels: 1, partialPixels: 0 })
    expect(keepsStraightAlpha(premultipliedPng)).toBe(false)
  })

  const keeps = { alphaMax: 0, colourMax: 1, colourPixels: 1000, inkPixels: 2000, partialPixels: 200 }
  const row = (route: ReadbackRow['route'], p50: number, over: Partial<ReadbackRow> = {}): ReadbackRow => ({ route, error: null, readMs: [p50, p50, p50 * 3], pngMs: [p50 + 30, p50 + 30, p50 + 40], straight: keeps, ...over })

  it('readbackVerdict: drawImage stays unless another that keeps straight alpha is at least twice as fast at p50', () => {
    expect(READBACK_BAR.faster).toBe(2)
    const nearly = readbackVerdict([row('drawImage', 10), row('readPixels', 6), row('readRenderTargetPixelsAsync', 7)])
    expect(nearly.fastest).toBe('readPixels')
    expect(nearly.chosen).toBe('drawImage')
    expect(nearly.failures).toEqual([])
    const twice = readbackVerdict([row('drawImage', 10), row('readPixels', 5)])
    expect(twice.chosen).toBe('readPixels')
    expect(twice.rows.map((r) => [r.route, r.p50, r.p95])).toEqual([['drawImage', 10, 30], ['readPixels', 5, 15]])
  })

  it('readbackVerdict: a route that does not keep straight alpha is never the fastest, and is named; a route that did not run is named', () => {
    const v = readbackVerdict([row('drawImage', 10), row('readPixels', 1, { straight: { ...keeps, colourMax: 90 } }), row('readRenderTargetPixelsAsync', 0, { error: 'WebGL 2 is missing', readMs: [] })])
    expect(v.fastest).toBe('drawImage')
    expect(v.chosen).toBe('drawImage')
    expect(v.failures).toContain('readRenderTargetPixelsAsync did not run: WebGL 2 is missing')
    expect(v.failures.some((f) => /^readPixels does not keep straight alpha through to its PNG: alpha off by 0, colour by 90/.test(f))).toBe(true)
    // drawImage is held to the same bar: its own PNG must keep straight alpha too.
    const bad = readbackVerdict([row('drawImage', 10, { straight: null })])
    expect(bad.fastest).toBeNull()
    expect(bad.failures).toEqual(['drawImage: its PNG was not read against its frame'])
  })

  it('readbackVerdict: a drawImage that does not keep straight alpha is not preferred; the fastest that keeps is chosen, however little faster', () => {
    const v = readbackVerdict([row('drawImage', 10, { straight: { ...keeps, colourMax: 90 } }), row('readPixels', 8)])
    expect(v.fastest).toBe('readPixels')
    expect(v.chosen).toBe('readPixels')
    expect(v.failures.some((f) => /^drawImage does not keep straight alpha/.test(f))).toBe(true)
  })

  it('readbackVerdict: a route that ran and timed no frame is named, and nothing read at all is named', () => {
    const v = readbackVerdict([row('drawImage', 10), row('readPixels', 5, { readMs: [], pngMs: [] })])
    expect(v.failures).toEqual(['readPixels ran but timed no frame'])
    expect(v.chosen).toBe('drawImage')
    expect(readbackVerdict([]).failures).toEqual(['no route was read'])
  })
})

describe('preview = export (the bake3d option)', () => {
  const d = (mean: number): PixelDiff => ({ mean, max: Math.ceil(mean * 10), differing: 10, pixels: 1000 })
  const reading = (over: Partial<ExportParityReading> = {}): ExportParityReading => ({
    name: 'counter-en tilt under clean',
    frames: [11, 22, 33, 45],
    live: [d(0.2), d(0.5), d(1), d(0)],
    harness: [d(0), d(0), d(0), d(0)],
    baked: 46,
    moving: 46,
    twice: null,
    flat: [],
    ...over
  })

  it('passes within 1/255 mean over the ink on every frame read, both sides', () => {
    expect(EXPORT_PARITY_BAR.meanLevels).toBe(1)
    expect(exportParityVerdict([reading(), reading({ name: 'screen card', twice: { equal: 46, of: 46 } })])).toEqual({ pass: true, failures: [] })
  })

  it('fails a frame over the bar on either side, a Preview that drew nothing, a count off the moving frames, two bakes not byte-equal, and no case', () => {
    const v = (r: Partial<ExportParityReading>): string[] => exportParityVerdict([reading(r)]).failures
    expect(v({ live: [d(0.2), d(1.01), d(1), d(0)] })).toEqual(['counter-en tilt under clean @22: the Preview against the export mean 1.010 (bar 1)'])
    expect(v({ harness: [d(0), d(0), d(2), d(0)] })).toEqual(["counter-en tilt under clean @33: the harness's frame against the export mean 2.000 (bar 1)"])
    expect(v({ live: [d(0.2), null, d(1), d(0)] })).toEqual(['counter-en tilt under clean @22: the Preview against the export not drawn (bar 1)'])
    expect(v({ baked: 1800 })).toEqual(['counter-en tilt under clean: baked 1800 frames of 46 moving'])
    expect(v({ twice: { equal: 45, of: 46 } })).toEqual(['counter-en tilt under clean: baked twice, 45 of 46 PNGs byte-equal'])
    expect(v({ twice: { equal: 0, of: 0 } })).toEqual(['counter-en tilt under clean: baked twice, 0 of 0 PNGs byte-equal'])
    // A reading over no pixels (both pictures blank) reads nothing.
    expect(v({ harness: [{ mean: 0, max: 0, differing: 0, pixels: 0 }, d(0), d(0), d(0)] })).toHaveLength(1)
    expect(exportParityVerdict([]).failures).toEqual(['no case was read'])
  })

  it('fails a case drawn flat, however well its flat Preview agrees with its flat bake', () => {
    expect(exportParityVerdict([reading({ flat: ['the Preview @22 had no compositor (WebGL did not start)'] })]).failures).toEqual([
      'counter-en tilt under clean: drawn flat, the Preview @22 had no compositor (WebGL did not start)'
    ])
  })

  it('reads a 2.5D case at three moving frames and at rest; a screen card on its move, the landing, the hand-off, the sweep and the held frame', () => {
    expect(exportParityFrames(46)).toEqual([11, 23, 34, 45])
    expect(exportParityFrames(3)).toEqual([1, 2])
    expect(exportParityFrames(1)).toEqual([0])
    expect(screenCardParityFrames(30, 46, null)).toEqual([2, 8, 15, 30, 31, 45])
    expect(screenCardParityFrames(30, 211, { crossing: 34, loop: 180 })).toEqual([2, 8, 15, 30, 31, 34, 120, 209, 210])
  })

  it('memoryBack: geometries and textures both back to their counts', () => {
    expect(memoryBack({ geometries: 3, textures: 7 }, { geometries: 3, textures: 7 })).toBe(true)
    expect(memoryBack({ geometries: 3, textures: 7 }, { geometries: 3, textures: 8 })).toBe(false)
    expect(memoryBack({ geometries: 3, textures: 7 }, { geometries: 4, textures: 7 })).toBe(false)
  })

  it('m13Phase3Line names each case’s two sequences where they are files, nothing on the harness page', () => {
    expect(m13Phase3Line([{ name: 'counter-en hero under neon', patterns: ['harness://a.seq/%05d.png', 'harness://b.seq/%05d.png'] }])).toBeNull()
    const line = m13Phase3Line([
      { name: 'counter-en hero under neon', patterns: ['/t/a.seq/%05d.png', '/t/b.seq/%05d.png'] },
      { name: 'screen card tilt-in under clean', patterns: ['C:\\t\\c.seq\\%05d.png', 'C:\\t\\d.seq\\%05d.png'] }
    ])!
    expect(line).toMatch(/^phase 3 M13: /)
    for (const p of ['/t/a.seq/%05d.png and /t/b.seq/%05d.png', 'C:\\t\\c.seq\\%05d.png and C:\\t\\d.seq\\%05d.png']) expect(line).toContain(p)
    expect(line).toContain('-f framemd5 -')
  })
})

describe('M20: the card’s bake against the whole-hold budget, and its hand-off', () => {
  it('is 300 frames in under 10 s (M1, 2026-10-27): the frames at most 300, and 300 frames at the rate under 10 s', () => {
    expect(WHOLE_HOLD_BUDGET).toEqual({ frames: 300, ms: 10_000 })
    // The glowing card at 30 fps: 211 frames at 20 ms is 6 s for 300.
    expect(bakeBudget(211, 20, 4300)).toEqual({ frames: 211, msPerFrame: 20, totalMs: 4300, projectedMs: 6000, withinFrames: true, withinRate: true })
    // At 60 fps a glowing card has 421 moving frames: over the budget's count whatever its rate.
    expect(bakeBudget(421, 20, 8600).withinFrames).toBe(false)
    expect(bakeBudget(300, 20, 0).withinFrames).toBe(true)
    // 34 ms a frame is 10.2 s for 300: over; 33.3 is under.
    expect(bakeBudget(211, 34, 0).withinRate).toBe(false)
    expect(bakeBudget(211, 33.3, 0).withinRate).toBe(true)
    expect(bakeBudget(211, NaN, 0).withinRate).toBe(false)
    expect(bakeBudget(0, 10, 0).withinFrames).toBe(false)
  })

  it('handoffWithin: 2/255 mean on the card’s side, and a reading over no pixels is not within', () => {
    const c = (meanAll: number, pixels = 10): ChannelDiff => ({ mean: [meanAll, meanAll, meanAll, meanAll], max: [9, 9, 9, 0], meanAll, maxAll: 9, pixels })
    expect(HANDOFF_BAR.meanLevels).toBe(2)
    expect(handoffWithin(c(2))).toBe(true)
    expect(handoffWithin(c(2.01))).toBe(false)
    expect(handoffWithin(c(0, 0))).toBe(false)
    expect(handoffWithin(null)).toBe(false)
  })
})

describe('the hero’s landing (the depth option)', () => {
  it('glowChange is the glow alone on one side against the other’s: the same glow moved with its item reads 0', () => {
    // Two pixels: the item steps (without changes) but the glow over it adds the same on both sides.
    const lastWithout = [100, 0, 0, 255, 0, 0, 0, 0]
    const firstWithout = [90, 0, 0, 255, 0, 0, 0, 10]
    const lastWith = lastWithout.map((v, i) => v + [5, 5, 5, 0, 3, 3, 3, 3][i])
    const firstWith = firstWithout.map((v, i) => v + [5, 5, 5, 0, 3, 3, 3, 3][i])
    expect(glowChange(lastWith, lastWithout, firstWith, firstWithout)).toEqual({ mean: 0, max: 0, pixels: 2, lastPixels: 2, firstPixels: 2 })
    // A glow twice as strong on the route-two side: the change is the glow's own.
    const brighter = firstWithout.map((v, i) => v + 2 * [5, 5, 5, 0, 3, 3, 3, 3][i])
    const change = glowChange(lastWith, lastWithout, brighter, firstWithout)
    expect(change.max).toBe(5)
    expect(change.mean).toBeCloseTo((5 * 3 + 3 * 4) / 8, 9)
    expect(() => glowChange([0], [0, 0], [0], [0])).toThrow(/different sizes/)
  })

  it('glowChange: the mean is over the glow’s pixels, not the frame (an empty frame does not dilute a mismatch), and a glow missing on a side is counted', () => {
    // One glowing pixel and 99 empty ones: a mismatch of 4 levels on each colour channel of the one.
    const empty = new Array(100 * 4).fill(0)
    const lastWith = [...empty]
    lastWith[0] = lastWith[1] = lastWith[2] = 10
    const firstWith = [...empty]
    firstWith[0] = firstWith[1] = firstWith[2] = 14
    const change = glowChange(lastWith, empty, firstWith, empty)
    expect(change.pixels).toBe(1)
    expect(change.mean).toBe(3)
    expect(heroLandingWithin({ glowMean: change.mean, glowMax: change.max, glowPixels: change.pixels, lastGlowPixels: change.lastPixels, firstGlowPixels: change.firstPixels })).toBe(false)
    // No glow on either side: nothing changed, and nothing was read.
    const none = glowChange(empty, empty, empty, empty)
    expect(none).toEqual({ mean: 0, max: 0, pixels: 0, lastPixels: 0, firstPixels: 0 })
    // A glow on one side only.
    expect(glowChange(lastWith, empty, empty, empty)).toMatchObject({ lastPixels: 1, firstPixels: 0 })
  })

  it('heroLandingWithin holds the proposed bar, mean and max both', () => {
    expect(HERO_LANDING_BAR).toEqual({ glowMean: 0.5, glowMax: 16 })
    const both = { glowPixels: 10, lastGlowPixels: 10, firstGlowPixels: 10 }
    expect(heroLandingWithin({ glowMean: 0.5, glowMax: 16, ...both })).toBe(true)
    expect(heroLandingWithin({ glowMean: 0.51, glowMax: 1, ...both })).toBe(false)
    expect(heroLandingWithin({ glowMean: 0, glowMax: 17, ...both })).toBe(false)
    expect(heroLandingWithin({ glowMean: 0, glowMax: 0, glowPixels: 0, lastGlowPixels: 0, firstGlowPixels: 0 })).toBe(false)
    // The glow gone on one side of the landing is not a landing within the bar.
    expect(heroLandingWithin({ glowMean: 0, glowMax: 0, glowPixels: 10, lastGlowPixels: 10, firstGlowPixels: 0 })).toBe(false)
    expect(heroLandingWithin({ glowMean: 0, glowMax: 0, glowPixels: 10, lastGlowPixels: 0, firstGlowPixels: 10 })).toBe(false)
  })
})

describe('the options', () => {
  it('readback and bake3d are options of their own, each asked alone; frames is readback’s and asks for nothing', () => {
    for (const name of ['readback', 'bake3d', 'screenCard']) expect(GRAPHIC_CHECK_OPTIONS as readonly string[], name).toContain(name)
    expect(askedOptions({ readback: true })).toEqual(['readback'])
    expect(askedOptions({ readback: ['drawImage'], frames: 30 })).toEqual(['readback'])
    expect(askedOptions({ frames: 30 })).toEqual([])
    expect(askedOptions({ screenCard: '/recordings/screen.mp4' })).toEqual(['screenCard'])
    expect(askedOptions({ bake3d: true, screenCard: true })).toEqual(['screenCard', 'bake3d'])
    // Before the Indic sites, as every option that loads Latin faces only.
    expect(GRAPHIC_CHECK_OPTIONS.indexOf('bake3d')).toBeLessThan(GRAPHIC_CHECK_OPTIONS.indexOf('indic'))
  })

  it('screenCard: a path runs M20’s check, true the stand-in’s, under the one guard; readback hands on its own routes and frames', () => {
    const source = readFileSync(resolve(__dirname, '../../src/renderer/src/harness/graphicCheck.ts'), 'utf8')
    const start = source.indexOf('export async function runGraphicCheck(')
    const body = source.slice(start, source.indexOf('\n}\n', start))
    const guard = [...body.matchAll(/^ {2}if \(options\.screenCard\) (.*)$/gm)]
    expect(guard).toHaveLength(1)
    // Both checks under the one guard, the path handed to M20's, the choice made on the option's type: membership, not the line's whole text.
    const line = guard[0][1]
    for (const part of ['typeof options.screenCard', 'checkScreenCardRecording(options.screenCard,', 'checkScreenCard(frames,']) expect(line, part).toContain(part)
    const readback = [...body.matchAll(/^ {2}if \(options\.readback\) (.*)$/gm)]
    expect(readback).toHaveLength(1)
    expect(readback[0][1]).toContain('checkReadback(TEMPLATE_FIXTURES, options.readback, options.frames,')
    // An empty path is falsy, so its guard would run nothing: refused before any check, by name.
    const head = body.slice(0, body.indexOf('const asked = askedOptions(options)'))
    expect(head).toContain("if (options.screenCard === '') throw new Error(")
  })

  it('EXPORT_PARITY_BAR is phase 2’s TEMPLATES_BAR, taken from it, not repeated', () => {
    expect(EXPORT_PARITY_BAR.meanLevels).toBe(TEMPLATES_BAR.bakeMeanLevels)
    const source = readFileSync(resolve(__dirname, '../../src/renderer/src/harness/phase3Measure.ts'), 'utf8')
    expect([...source.matchAll(/export const EXPORT_PARITY_BAR = (.*)$/gm)].map((m) => m[1])).toEqual(['Object.freeze({ meanLevels: TEMPLATES_BAR.bakeMeanLevels })'])
  })
})
