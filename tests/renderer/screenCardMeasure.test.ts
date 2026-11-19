import { describe, expect, it } from 'vitest'
import type { ChannelDiff } from '../../src/renderer/src/harness/compositorMeasure'
import {
  SCREEN_CARD_BAR,
  alphaMaxIn,
  alphaOutside,
  inkRows,
  screenCardSheetFrames,
  screenCardVerdict,
  wholeRegion,
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
    holeInside: 0,
    holeOutside: { min: 89, max: 89 },
    dimAlpha: 89,
    early: diff(140, 6),
    flatScale: move === 'pull-back' ? 1.359 : null
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
