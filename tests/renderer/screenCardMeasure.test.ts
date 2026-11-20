import { describe, expect, it } from 'vitest'
import type { ChannelDiff } from '../../src/renderer/src/harness/compositorMeasure'
import {
  EDGE_SWEEP_BAR,
  SCREEN_CARD_BAR,
  alphaMaxIn,
  edgeSweepCrossingFrame,
  edgeSweepSheetFrames,
  edgeSweepVerdict,
  alphaOutside,
  inkRows,
  screenCardSheetFrames,
  screenCardVerdict,
  wholeRegion,
  type EdgeSweepReading,
  type ScreenCardReading
} from '../../src/renderer/src/harness/screenCardMeasure'

/*
 * The harness's `screenCard` option's verdict and readers (docs/CLIPS.md
 * §6.16, "The screen card" and "The hand-off"; phase 3's piece 4): every bar a
 * reading is held to. The pictures are WebGL's, read on the harness page.
 */

const diff = (maxAll = 0, meanAll = 0, pixels = 100): ChannelDiff => ({ mean: [meanAll, meanAll, meanAll, meanAll], max: [maxAll, 0, 0, 0], meanAll, maxAll, pixels })

function reading(move: ScreenCardReading['move'], style = 'clean'): ScreenCardReading {
  return {
    move,
    style,
    landing: 30,
    moving: 46,
    movingCamera: 30,
    cameraAtL: { tilt: 0, yaw: 0, dolly: 0 },
    cameraAfter: false,
    firstOpacity: move === 'tilt-in' ? 0.00002 : 1,
    handoff: diff(0, 0, 150000),
    holeFrame: style === 'energetic' ? 210 : 31,
    holeInside: 0,
    holeOutside: { min: 89, max: 89 },
    dimAlpha: 89,
    early: diff(140, 6),
    flatScale: move === 'pull-back' ? 1.359 : null,
    flatCentreOff: move === 'pull-back' ? 0 : null
  }
}

const passing = (): ScreenCardReading[] => [reading('tilt-in'), reading('pull-back'), reading('tilt-in', 'energetic'), reading('pull-back', 'energetic')]

const failing = (edit: (r: ScreenCardReading[]) => void): string[] => {
  const r = passing()
  edit(r)
  const v = screenCardVerdict(r)
  expect(v.pass).toBe(false)
  return v.failures
}

describe('screenCardVerdict', () => {
  it('passes the readings the plan expects', () => {
    expect(screenCardVerdict(passing())).toEqual({ pass: true, failures: [] })
  })

  it('holds the hand-off to 2/255 mean on the card’s own side (§6.16’s proposal), and needs pixels read', () => {
    expect(SCREEN_CARD_BAR.handoffMean).toBe(2)
    expect(screenCardVerdict(passing().map((r) => ({ ...r, handoff: diff(9, 2) }))).pass).toBe(true)
    expect(failing((r) => (r[0].handoff = diff(9, 2.01))).join()).toMatch(/plain drawImage, mean 2.010 > 2/)
    expect(failing((r) => (r[1].handoff = diff(0, 0, 0))).join()).toMatch(/read no pixel/)
  })

  it('wants the camera exactly 0 at the landing (−0 is not 0) and none after it, and a move off flat before it', () => {
    expect(failing((r) => (r[0].cameraAtL = { tilt: 0.5, yaw: 0, dolly: 0 })).join()).toMatch(/tilt is 0.5/)
    expect(failing((r) => (r[0].cameraAtL = { tilt: -0, yaw: 0, dolly: 0 })).join()).toMatch(/tilt is 0, not exactly 0/)
    expect(failing((r) => (r[1].cameraAtL = null)).join()).toMatch(/carries no camera/)
    expect(failing((r) => (r[1].cameraAfter = true)).join()).toMatch(/after the landing carries a camera/)
    expect(failing((r) => (r[0].movingCamera = 0)).join()).toMatch(/dead move/)
    expect(failing((r) => (r[0].movingCamera = 46)).join()).toMatch(/every moving frame/)
  })

  it('wants the hole after the landing clear and the dim outside it at the style’s alpha, within a level', () => {
    expect(failing((r) => (r[0].holeInside = 1)).join()).toMatch(/alpha 1 inside the hole/)
    expect(screenCardVerdict(passing().map((r) => ({ ...r, holeOutside: { min: 88, max: 90 } }))).pass).toBe(true)
    expect(failing((r) => (r[0].holeOutside = { min: 0, max: 89 })).join()).toMatch(/reads 0..89, not 89/)
  })

  it('wants Tilt in from opacity 0 and Pull back opaque, a visible move, and Pull back drawn flat at 1.35 × the box', () => {
    expect(failing((r) => (r[0].firstOpacity = 0.2)).join()).toMatch(/frame 0's card opacity 0.2, not 0/)
    expect(failing((r) => (r[1].firstOpacity = 0.9)).join()).toMatch(/opacity 0.9, not 1/)
    expect(failing((r) => (r[0].early = diff(7))).join()).toMatch(/at most 7 < 8/)
    expect(failing((r) => (r[1].flatScale = 1)).join()).toMatch(/1.000 × the box's height/)
    expect(failing((r) => (r[1].flatScale = null)).join()).toMatch(/none × the box's height/)
    // Tilt in has no flat scale to read.
    expect(screenCardVerdict(passing().map((r) => (r.move === 'tilt-in' ? { ...r, flatScale: null } : r))).pass).toBe(true)
  })

  it('wants Pull back scaled about the card’s own centre: drawn flat on a box below the frame’s centre, its ink centred within a pixel of that box’s middle (the critics’ fix)', () => {
    expect(SCREEN_CARD_BAR.flatCentreOff).toBe(1)
    expect(screenCardVerdict(passing().map((r) => (r.move === 'pull-back' ? { ...r, flatCentreOff: 1 } : r))).pass).toBe(true)
    // About the frame's centre instead, the box 240 px low: its middle (720) lands at 480 + 240 × 1.35, 84 px off.
    expect(failing((r) => (r[1].flatCentreOff = 84)).join()).toMatch(/centred 84.0 px from the box's/)
    expect(failing((r) => (r[3].flatCentreOff = null)).join()).toMatch(/centred nowhere/)
  })

  it('needs both moves read', () => {
    expect(screenCardVerdict(passing().filter((r) => r.move === 'tilt-in')).failures).toContain('pull-back was not read')
    expect(screenCardVerdict([]).failures).toEqual(['tilt-in was not read', 'pull-back was not read'])
  })
})

describe('the readers', () => {
  const size = { width: 10, height: 8 }
  /** A 10×8 RGBA picture: alpha 89 everywhere, 0 inside x 2..6, y 2..5. */
  function picture(): Uint8ClampedArray {
    const p = new Uint8ClampedArray(10 * 8 * 4)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 10; x++) p[(y * 10 + x) * 4 + 3] = x >= 2 && x < 7 && y >= 2 && y < 6 ? 0 : 89
    return p
  }

  it('wholeRegion: the whole pixels strictly inside an inset box, or touched by an outset one, clamped to the frame', () => {
    expect(wholeRegion({ x: 1.5, y: 1.25, width: 6, height: 5 }, 0.5, 'inset', size)).toEqual({ x: 2, y: 2, width: 5, height: 3 })
    expect(wholeRegion({ x: 1.5, y: 1.25, width: 6, height: 5 }, 1, 'outset', size)).toEqual({ x: 0, y: 0, width: 9, height: 8 })
    expect(wholeRegion({ x: 0, y: 0, width: 10, height: 8 }, 3, 'outset', size)).toEqual({ x: 0, y: 0, width: 10, height: 8 })
    expect(wholeRegion({ x: 0, y: 0, width: 2, height: 2 }, 3, 'inset', size)).toMatchObject({ width: 0, height: 0 })
  })

  it('alphaMaxIn and alphaOutside read the hole and the dim round it', () => {
    const p = picture()
    expect(alphaMaxIn(p, 10, { x: 2, y: 2, width: 5, height: 4 })).toBe(0)
    expect(alphaMaxIn(p, 10, { x: 1, y: 2, width: 5, height: 4 })).toBe(89)
    expect(alphaOutside(p, 10, 8, { x: 2, y: 2, width: 5, height: 4 })).toEqual({ min: 89, max: 89 })
    expect(alphaOutside(p, 10, 8, { x: 3, y: 2, width: 5, height: 4 })).toEqual({ min: 0, max: 89 })
    expect(alphaOutside(p, 10, 8, { x: 0, y: 0, width: 10, height: 8 })).toBeNull()
  })

  it('inkRows: the rows with any alpha', () => {
    const p = new Uint8ClampedArray(10 * 8 * 4)
    expect(inkRows(p, 10, 8)).toBeNull()
    p[(3 * 10 + 4) * 4 + 3] = 1
    p[(6 * 10 + 9) * 4 + 3] = 255
    expect(inkRows(p, 10, 8)).toEqual({ top: 3, height: 4 })
  })

  it('the sheet’s frames: the start, the move, the landing and the frame after it, within the moving frames', () => {
    expect(screenCardSheetFrames(30, 46)).toEqual([0, 1, 2, 4, 6, 10, 15, 29, 30, 31])
    expect(screenCardSheetFrames(30, 31)).toEqual([0, 1, 2, 4, 6, 10, 15, 29, 30])
  })
})

/*
 * The edge sweep's half of the option (docs/CLIPS.md §6.16, "The edge
 * sweep"; phase 3's piece 5): every bar its reading is held to.
 */
function sweepReading(style = 'energetic'): EdgeSweepReading {
  const glowAt = (frame: number): EdgeSweepReading['glow'][number] => ({ frame, radius: 10.8, reach: 11, outsideReach: 0, outsideColour: 1, outsidePixels: 400000, present: diff(120, 0.4), base: diff(1, 0.0001, 518400), holeAlpha: 35 })
  return {
    style,
    landing: 30,
    loop: 180,
    moving: 211,
    firstFrame: 31,
    lastFrame: 209,
    crossing: { frame: 40, pieces: 2 },
    afterLoop: diff(0, 0, 518400),
    afterLoopItems: ['dim', 'bezel'],
    lastSweep: diff(200, 0.2),
    glow: [glowAt(40), glowAt(120)],
    msPerFrame: 3.1
  }
}

const sweepFailing = (edit: (r: EdgeSweepReading) => void): string => {
  const r = sweepReading()
  edit(r)
  const v = edgeSweepVerdict([r], ['energetic'])
  expect(v.pass).toBe(false)
  return v.failures.join('; ')
}

describe('edgeSweepVerdict', () => {
  it('passes the readings the plan expects, and needs every glowing style read', () => {
    expect(edgeSweepVerdict([sweepReading()], ['energetic'])).toEqual({ pass: true, failures: [] })
    expect(edgeSweepVerdict([], ['energetic']).failures.join()).toMatch(/the edge sweep under energetic was not read/)
    expect(EDGE_SWEEP_BAR).toMatchObject({ afterLoopMax: 0, outsideReachMax: 0, outsideColourMax: 2, crossingPieces: 2 })
  })

  it('one loop from L + 1 to L + N − 1, L + 1 + N moving frames: a sweep over the whole hold, one before the landing or one still drawn on L + N fails', () => {
    expect(sweepFailing((r) => (r.moving = 300))).toMatch(/300 moving frames, not L \+ 1 \+ N = 211/)
    expect(sweepFailing((r) => (r.firstFrame = 30))).toMatch(/first drawn on frame 30, not L \+ 1 = 31/)
    expect(sweepFailing((r) => (r.lastFrame = 210))).toMatch(/last drawn on frame 210, not L \+ N − 1 = 209/)
  })

  it('the frame after the loop is the held card exactly, the dim and the bezel alone; the loop’s last frame is not', () => {
    expect(sweepFailing((r) => (r.afterLoop = diff(1, 0.001, 518400)))).toMatch(/the frame after the loop differs from the held card, max 1/)
    expect(sweepFailing((r) => (r.afterLoopItems = ['dim', 'bezel', 'sweep']))).toMatch(/draws dim, bezel, sweep, not the dim and the bezel/)
    expect(sweepFailing((r) => (r.lastSweep = diff(0, 0)))).toMatch(/the loop's last frame equals the held card/)
  })

  it('a span crossing the path’s start is two strokes', () => {
    expect(sweepFailing((r) => (r.crossing = { frame: 40, pieces: 1 }))).toMatch(/1 strokes, not 2/)
  })

  it('its glow adds no alpha beyond its reach from the sweep’s ink, keeps colour within 2 there, reads pixels there, and is present', () => {
    expect(sweepFailing((r) => (r.glow[0].outsideReach = 1))).toMatch(/@40: the glow adds alpha 1 beyond its 11 px reach/)
    expect(sweepFailing((r) => (r.glow[1].outsideColour = 3))).toMatch(/@120: colour off by 3 > 2/)
    expect(sweepFailing((r) => (r.glow[0].outsidePixels = 0))).toMatch(/no pixel beyond the glow's reach was read/)
    expect(sweepFailing((r) => (r.glow[0].present = diff(0, 0)))).toMatch(/@40: no glow/)
    expect(sweepFailing((r) => (r.glow = []))).toMatch(/its glow was not read/)
  })

  it('route two’s base under the dim and its hole, the glow left out, against painter A: within 2 levels and a mean of 0.000, over pixels read; the hole’s alpha has no bar', () => {
    expect(EDGE_SWEEP_BAR).toMatchObject({ baseMax: 2, baseMean: 0.0005 })
    expect(sweepFailing((r) => (r.glow[1].base = diff(3, 0.0001, 518400)))).toMatch(/@120: route two's base \(the glow left out\) against painter A, max 3 > 2/)
    expect(sweepFailing((r) => (r.glow[0].base = diff(2, 0.01, 518400)))).toMatch(/@40: route two's base \(the glow left out\) against painter A, mean 0.0100/)
    expect(sweepFailing((r) => (r.glow[0].base = diff(0, 0, 0)))).toMatch(/@40: route two's base against painter A read no pixel/)
    const r = sweepReading()
    r.glow[0].holeAlpha = 255
    expect(edgeSweepVerdict([r], ['energetic']).pass).toBe(true)
  })

  it('the sheet shows the first frame, one crossing the start, the loop in eighths, the last and the held card, all after the landing', () => {
    const frames = edgeSweepSheetFrames(30, 180, 0.12)
    expect(frames[0]).toBe(31)
    expect(frames).toContain(edgeSweepCrossingFrame(30, 180, 0.12))
    expect(frames).toContain(209)
    expect(frames[frames.length - 1]).toBe(210)
    expect(frames.every((f) => f > 30 && f <= 210)).toBe(true)
    // The crossing frame is within the span's first frames at every rate: (f − L) / N < 0.12.
    for (const [L, N] of [[24, 144], [25, 150], [30, 180], [60, 360]]) {
      const f = edgeSweepCrossingFrame(L, N, 0.12)
      expect(f).toBeGreaterThan(L)
      expect((f - L) / N).toBeLessThan(0.12)
    }
  })
})
