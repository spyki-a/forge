import { describe, expect, it } from 'vitest'
import type { ChannelDiff } from '../../src/renderer/src/harness/compositorMeasure'
import { DEPTH_BAR, DEPTH_SHEET_FRAMES, depthSheetFrames, depthVerdict, type DepthCaseReading } from '../../src/renderer/src/harness/depthMeasure'

/*
 * The harness's `depth` option's verdict (docs/CLIPS.md §6.11's `parity` row,
 * phase 3's half; §6.12's phase-3 bars; §6.16; phase 3's piece 3): every bar
 * a reading is held to. The pictures are WebGL's, read on the harness page.
 */

const diff = (maxAll = 0, meanAll = 0): ChannelDiff => ({ mean: [meanAll, meanAll, meanAll, meanAll], max: [maxAll, 0, 0, 0], meanAll, maxAll, pixels: 100 })

function reading(template: 'counter' | 'ring', variant: DepthCaseReading['variant']): DepthCaseReading {
  return {
    fixture: `${template}-en`,
    template,
    variant,
    style: variant === 'hero' ? 'neon' : 'clean',
    moving: 31,
    movingCamera: 11,
    lastCamera: { tilt: 0, yaw: 0, dolly: 0, focusPx: 0 },
    settled: variant === 'hero' ? diff(1, 0.0001) : diff(),
    firstFrame: 1,
    first: diff(120, 3),
    ...(variant === 'hero' ? { glow: { radius: 10.8, reach: 11, outsideReach: 0, outsidePixels: 400000, present: diff(90, 0.5) } } : {})
  }
}

function passing(): DepthCaseReading[] {
  return (['counter', 'ring'] as const).flatMap((t) => (['tilt', 'parallax', 'dolly', 'focus', 'hero'] as const).map((v) => reading(t, v)))
}

const failing = (edit: (r: DepthCaseReading[]) => void): string[] => {
  const r = passing()
  edit(r)
  const v = depthVerdict(r)
  expect(v.pass).toBe(false)
  return v.failures
}

describe('depthVerdict', () => {
  it('passes the readings the bars allow, and the bars are the plan’s (settled 0, route two’s for the hero, 0 beyond the reach)', () => {
    expect(depthVerdict(passing())).toEqual({ pass: true, failures: [] })
    expect(DEPTH_BAR.settledMax).toBe(0)
    expect(DEPTH_BAR.outsideReachMax).toBe(0)
  })

  it('fails a settled frame off its flat twin by one level, and a hero’s base off route two’s bars', () => {
    expect(failing((r) => (r[1].settled = diff(1, 0.00001)))).toEqual([expect.stringContaining('counter-en parallax under clean: the settled frame differs from its flat twin, max 1')])
    expect(failing((r) => (r[4].settled = diff(3, 0.0001)))).toEqual([expect.stringContaining('the base under the glow at rest, max 3')])
    expect(failing((r) => (r[4].settled = diff(1, 0.001)))).toEqual([expect.stringContaining('mean 0.0010, not 0.000')])
  })

  it('fails a camera field not exactly 0 at rest (−0 included), and a list with no camera', () => {
    expect(failing((r) => (r[0].lastCamera = { tilt: 0.5, yaw: 0, dolly: 0, focusPx: 0 }))).toEqual([expect.stringContaining("the last moving frame's tilt is 0.5, not exactly 0")])
    expect(failing((r) => (r[3].lastCamera = { tilt: 0, yaw: 0, dolly: 0, focusPx: 1e-9 }))).toEqual([expect.stringContaining("focus px is 1e-9")])
    expect(failing((r) => (r[2].lastCamera = { tilt: 0, yaw: 0, dolly: -0, focusPx: 0 }))).toEqual([expect.stringContaining("dolly is 0, not exactly 0")])
    expect(failing((r) => (r[0].lastCamera = null))).toEqual([expect.stringContaining('carries no camera')])
  })

  it('fails a dead branch: no frame off flat, or a first frame within the bar of its twin; and a move that never settles', () => {
    expect(failing((r) => (r[5].movingCamera = 0))).toEqual([expect.stringContaining('ring-en tilt under clean: no frame has a camera off flat')])
    expect(failing((r) => (r[5].first = diff(DEPTH_BAR.firstMinMax - 1, 0.01)))).toEqual([expect.stringContaining(`differs from its flat twin by at most ${DEPTH_BAR.firstMinMax - 1}`)])
    expect(failing((r) => (r[5].movingCamera = 31))).toEqual([expect.stringContaining('every frame moves')])
  })

  it('fails the hero’s glow beyond its reach, absent, or not read; and a case not read', () => {
    expect(failing((r) => (r[9].glow!.outsideReach = 1))).toEqual([expect.stringContaining('ring-en hero under neon: alpha 1 beyond the glow')])
    expect(failing((r) => (r[9].glow!.present = diff(0, 0)))).toEqual([expect.stringContaining('no glow')])
    expect(failing((r) => delete r[9].glow)).toEqual([expect.stringContaining('the glow was not read')])
    expect(failing((r) => r.splice(7, 1))).toEqual(['ring dolly was not read'])
  })
})

describe('depthSheetFrames: the contact sheet shows the move', () => {
  it('every frame from the first with ink while the move shows (frames 1 to 3 under expo-out), the last off flat and the first at rest; never more than the sheet holds', () => {
    // counter-en at 30 fps: 31 moving frames, the tilt off flat on 0..10, ink from frame 1.
    const tilt = Array.from({ length: 31 }, (_, f) => f <= 10)
    const shown = depthSheetFrames(1, tilt)
    for (const f of [1, 2, 3]) expect(shown).toContain(f)
    expect(shown).toContain(10)
    expect(shown).toContain(11)
    expect(shown).not.toContain(0)
    expect(shown.length).toBeLessThanOrEqual(DEPTH_SHEET_FRAMES)
    expect(shown).toEqual([...shown].sort((a, b) => a - b))
    // The focus blur runs to the beat: its last frame off flat is 14.
    const focus = depthSheetFrames(1, Array.from({ length: 31 }, (_, f) => f <= 14))
    for (const f of [1, 2, 3, 14, 15]) expect(focus).toContain(f)
    // Short and degenerate cases stay inside the frames there are.
    expect(depthSheetFrames(-1, [true, false])).toEqual([0, 1])
    expect(depthSheetFrames(0, [false, false, false])).toEqual([0])
    expect(depthSheetFrames(0, [])).toEqual([])
  })
})
