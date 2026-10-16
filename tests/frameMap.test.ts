import { describe, expect, it } from 'vitest'
import { CHIN_EXTENSION, SAMPLE_REACH_MS, sourceMsAt, sourceToFrame, subjectBoxesAt } from '@shared/reframe/frameMap'
import { overlapByThird } from '@shared/reframe/freeSpace'
import { exportFrameAt, followAt, followKeys } from '@shared/reframe/keys'
import { SUBJECT_TRACK_VERSION, type FaceBox, type SubjectSample, type SubjectTrack, type UnitRect } from '@shared/reframe/types'
import { cropAt } from '@shared/render/crop'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { printedMs } from './fixtures/reframe/track'

/*
 * docs/CLIPS.md §5.1: a SOURCE box (0..1 of the upright file) through the
 * crop the export shows on a project frame and the clip's fit into the
 * canvas, to OUTPUT-frame unit coordinates. The expected rectangles are
 * worked out here by hand from the geometry — the crop as the export's own
 * reader gives it (`cropAt`, `followAt`), then the fit's arithmetic written
 * out — not by calling the mapping under test a second way.
 */

const FPS = 30
const PORTRAIT = { width: 1080, height: 1920 }

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4

interface Build {
  width: number
  height: number
  /** Each cut's ms (as the shot finder prints it). */
  cutsMs: number[]
  endMs: number
  /** A sample's faces, in SOURCE px. */
  faces: (shot: number, ms: number) => { x: number; y: number; width: number; height: number }[]
  /** Which of the twice-a-second samples exist; all of them by default. */
  keep?: (ms: number) => boolean
}

function track(b: Build): SubjectTrack {
  const edges = [0, ...b.cutsMs, b.endMs]
  const shotOf = (ms: number): number => b.cutsMs.filter((c) => c <= ms).length
  const samples: SubjectSample[] = []
  for (let ms = 0; ms < b.endMs; ms += 500) {
    if (b.keep && !b.keep(ms)) continue
    const faces: FaceBox[] = b.faces(shotOf(ms), ms).map((f) => ({
      x: r4(f.x / b.width),
      y: r4(f.y / b.height),
      width: r4(f.width / b.width),
      height: r4(f.height / b.height),
      score: 0.9
    }))
    samples.push({ ms, faces })
  }
  return {
    key: '123456:1700000000000',
    version: SUBJECT_TRACK_VERSION,
    width: b.width,
    height: b.height,
    durationMs: b.endMs,
    shots: edges.slice(0, -1).map((startMs, i) => ({ startMs, endMs: edges[i + 1], score: i ? 0.9 : 0 })),
    samples,
    perShot: edges.slice(0, -1).map(() => ({})),
    detector: 'synthetic',
    scene: { threshold: 0.3, minShotMs: 500, backend: 'ffmpeg-select-rgb24' },
    at: '2026-10-16T00:00:00.000Z'
  }
}

function setup(o: {
  width: number
  height: number
  frames: number
  track?: SubjectTrack
  clip?: Partial<Clip>
  canvas?: { width: number; height: number }
}): { project: Project; clip: Clip; asset: MediaAsset } {
  const asset: MediaAsset = {
    id: 'a',
    path: '/media/talk.mp4',
    name: 'talk.mp4',
    kind: 'video',
    durationFrames: o.frames,
    width: o.width,
    height: o.height,
    fps: FPS,
    hasVideo: true,
    hasAudio: true,
    size: 123456
  }
  const clip: Clip = {
    id: 'c',
    assetId: 'a',
    trackId: 'v1',
    start: 30,
    duration: o.frames,
    inPoint: 0,
    volume: 1,
    transform: { ...DEFAULT_TRANSFORM },
    color: { ...DEFAULT_COLOR },
    ...o.clip
  }
  const base = emptyProject('frame map')
  const project: Project = {
    ...base,
    settings: { ...base.settings, ...(o.canvas ?? PORTRAIT), fps: FPS },
    assets: [asset],
    clips: [clip],
    subjects: o.track ? { a: o.track } : {}
  }
  return { project, clip, asset }
}

/** A source box in px of a W×H file, as the unit box the track would hold. */
const unit = (W: number, H: number, x: number, y: number, width: number, height: number): UnitRect => ({ x: x / W, y: y / H, width: width / W, height: height / H })

function expectRect(got: UnitRect | null, want: UnitRect, digits = 6): void {
  expect(got).not.toBeNull()
  expect(got!.x).toBeCloseTo(want.x, digits)
  expect(got!.y).toBeCloseTo(want.y, digits)
  expect(got!.width).toBeCloseTo(want.width, digits)
  expect(got!.height).toBeCloseTo(want.height, digits)
}

describe('sourceToFrame through a plain crop', () => {
  // A 960×1080 window of a 1920×1080 file on a 9:16 canvas: 0.889 against 0.5625, a real mismatch.
  const crop = { x: 480, y: 0, width: 960, height: 1080 }

  it('contain: scaled by the smaller ratio, letterboxed top and bottom', () => {
    const { project, clip, asset } = setup({ width: 1920, height: 1080, frames: 90, clip: { crop } })
    const s = Math.min(1080 / 960, 1920 / 1080) // 1.125
    const top = (1920 - 1080 * s) / 2 // 352.5
    const got = sourceToFrame(project, clip, asset, PORTRAIT, 45, unit(1920, 1080, 600, 100, 120, 120))
    expectRect(got, { x: ((600 - 480) * s) / 1080, y: (top + 100 * s) / 1920, width: (120 * s) / 1080, height: (120 * s) / 1920 })
    // The same picture at 1:1 numbers, so the arithmetic above is the one meant.
    expectRect(got, { x: 0.125, y: 465 / 1920, width: 0.125, height: 135 / 1920 })
  })

  it('cover: scaled by the larger ratio and cut at the box — a box in the cut-off margin is off screen', () => {
    const { project, clip, asset } = setup({ width: 1920, height: 1080, frames: 90, clip: { crop, transform: { ...DEFAULT_TRANSFORM, fit: 'cover' } } })
    const s = Math.max(1080 / 960, 1920 / 1080) // 16/9
    const left = (1080 - 960 * s) / 2 // −313.3
    const got = sourceToFrame(project, clip, asset, PORTRAIT, 45, unit(1920, 1080, 900, 100, 120, 120))
    expectRect(got, { x: (left + (900 - 480) * s) / 1080, y: (100 * s) / 1920, width: (120 * s) / 1080, height: (120 * s) / 1920 })
    // Inside the crop, but in the 313 px cover cuts off its left: not on the frame. Contain shows it.
    const margin = unit(1920, 1080, 500, 100, 100, 100)
    expect(sourceToFrame(project, clip, asset, PORTRAIT, 45, margin)).toBeNull()
    const contained = setup({ width: 1920, height: 1080, frames: 90, clip: { crop } })
    expect(sourceToFrame(contained.project, contained.clip, contained.asset, PORTRAIT, 45, margin)).not.toBeNull()
  })

  it('a box wholly outside the crop is null; one across its edge is cut to it', () => {
    const { project, clip, asset } = setup({ width: 1920, height: 1080, frames: 90, clip: { crop } })
    expect(sourceToFrame(project, clip, asset, PORTRAIT, 45, unit(1920, 1080, 100, 100, 200, 200))).toBeNull()
    expect(sourceToFrame(project, clip, asset, PORTRAIT, 45, unit(1920, 1080, 1500, 100, 200, 200))).toBeNull()
    // 380..580 across the crop's left edge at 480: only 480..580 is on screen.
    const s = 1.125
    expectRect(sourceToFrame(project, clip, asset, PORTRAIT, 45, unit(1920, 1080, 380, 100, 200, 200)), {
      x: 0,
      y: (352.5 + 100 * s) / 1920,
      width: (100 * s) / 1080,
      height: (200 * s) / 1920
    })
  })

  it('the clip’s box: a clip at half scale, pushed right, lands in its box', () => {
    const transform = { ...DEFAULT_TRANSFORM, scale: 0.5, x: 0.5 }
    const { project, clip, asset } = setup({ width: 1080, height: 1920, frames: 90, clip: { transform } })
    // clipBox: 540×960 at x = 270 + 0.5·540 = 540, y = 480; the file is the box's shape, scale 0.5.
    expectRect(sourceToFrame(project, clip, asset, PORTRAIT, 45, { x: 0.25, y: 0.5, width: 0.5, height: 0.25 }), {
      x: (540 + 0.25 * 540) / 1080,
      y: (480 + 0.5 * 960) / 1920,
      width: (0.5 * 540) / 1080,
      height: (0.25 * 960) / 1920
    })
  })
})

/* ------------------------------------------------------------ followed */

const W = 1920
const H = 1080
const CUT = 95
const END = 200
/** A face in source px, centred at (cx, cy). */
const facePx = (cx: number, cy = 400, side = 200): { x: number; y: number; width: number; height: number } => ({ x: cx - side / 2, y: cy - side / 2, width: side, height: side })

/** Shot 0 one face at x 500; shot 1 one face at x 1500 — or, `twoUp`, two at 384 and 1536, too far apart for one 608 px crop. */
function followedTrack(twoUp = false): SubjectTrack {
  return track({
    width: W,
    height: H,
    cutsMs: [printedMs(CUT / FPS)],
    endMs: (END * 1000) / FPS,
    faces: (shot) => (shot === 0 ? [facePx(500)] : twoUp ? [facePx(384), facePx(1536)] : [facePx(1500)])
  })
}

/** What the fit does to a 9:16-ish crop on the 9:16 canvas, written out: within 1 % of the shape, so it fills (cover). */
function coverOf(crop: { width: number; height: number }): { s: number; left: number; top: number } {
  const s = Math.max(1080 / crop.width, 1920 / crop.height)
  return { s, left: (1080 - crop.width * s) / 2, top: (1920 - crop.height * s) / 2 }
}

describe('sourceToFrame through a followed crop', () => {
  const { project, clip, asset } = setup({ width: W, height: H, frames: END, track: followedTrack(), clip: { follow: { version: 1 } } })
  const keys = followKeys(project, clip, FPS)!

  it('reads the crop the export shows on each frame: the same face lands centred in its own shot, and off screen in the other', () => {
    expect(keys.shots.map((s) => [s.from, s.to])).toEqual([[0, CUT], [CUT, END]])
    for (const [k, cx, other] of [[40, 500, 1500], [150, 1500, 500]] as const) {
      const crop = followAt(keys, k).crop
      // The fixture's premise: the path centres the crop on the shot's face.
      expect(crop.x + crop.width / 2).toBeCloseTo(cx, -1)
      const { s, left, top } = coverOf(crop)
      const f = facePx(cx)
      const got = sourceToFrame(project, clip, asset, PORTRAIT, clip.start + k, unit(W, H, f.x, f.y, f.width, f.height))
      expectRect(got, {
        x: (left + (f.x - crop.x) * s) / 1080,
        y: (top + (f.y - crop.y) * s) / 1920,
        width: (f.width * s) / 1080,
        height: (f.height * s) / 1920
      }, 3)
      expect(got!.x + got!.width / 2).toBeCloseTo(0.5, 2)
      const o = facePx(other)
      expect(sourceToFrame(project, clip, asset, PORTRAIT, clip.start + k, unit(W, H, o.x, o.y, o.width, o.height))).toBeNull()
    }
  })

  it('the frame is a PROJECT frame: the cut is at clip.start + its clip frame', () => {
    const late = facePx(1500)
    const box = unit(W, H, late.x, late.y, late.width, late.height)
    expect(sourceToFrame(project, clip, asset, PORTRAIT, clip.start + CUT - 1, box)).toBeNull()
    expect(sourceToFrame(project, clip, asset, PORTRAIT, clip.start + CUT, box)).not.toBeNull()
  })

  it('takes the canvas it is asked about: at 16:9 the 16:9 file is the frame, uncropped', () => {
    const f = facePx(1500)
    expectRect(sourceToFrame(project, clip, asset, { width: 1920, height: 1080 }, clip.start + 40, unit(W, H, f.x, f.y, f.width, f.height)), unit(W, H, f.x, f.y, f.width, f.height))
  })
})

describe('sourceToFrame through a stacked two-up (§4.6 rule 3)', () => {
  const { project, clip, asset } = setup({ width: W, height: H, frames: END, track: followedTrack(true), clip: { follow: { version: 1 } } })
  const k = 150

  it('each half’s face lands in its own half of the output, where the export stacks it', () => {
    const on = cropAt(project, clip, null, k)
    // The fixture's premise: this frame is a stacked two-up, the face further left on top.
    expect(on.halves).toBeDefined()
    const { top, bottom } = on.halves!
    expect(top.x + top.width / 2).toBeCloseTo(384, -1)
    expect(bottom.x + bottom.width / 2).toBeCloseTo(1536, -1)
    const stack = { width: top.width, height: top.height + bottom.height }
    const { s, left, top: y0 } = coverOf(stack)

    const l = facePx(384)
    const r = facePx(1536)
    const gotL = sourceToFrame(project, clip, asset, PORTRAIT, clip.start + k, unit(W, H, l.x, l.y, l.width, l.height))
    const gotR = sourceToFrame(project, clip, asset, PORTRAIT, clip.start + k, unit(W, H, r.x, r.y, r.width, r.height))
    expectRect(gotL, { x: (left + (l.x - top.x) * s) / 1080, y: (y0 + (l.y - top.y) * s) / 1920, width: (l.width * s) / 1080, height: (l.height * s) / 1920 }, 3)
    expectRect(gotR, { x: (left + (r.x - bottom.x) * s) / 1080, y: (y0 + (r.y - bottom.y + top.height) * s) / 1920, width: (r.width * s) / 1080, height: (r.height * s) / 1920 }, 3)
    // Each in its own half, centred across: the face 0.4 down its half (path.ts twoUpFaceY) is 0.2 and 0.7 of the frame.
    expect(gotL!.y + gotL!.height).toBeLessThanOrEqual(0.5 + 1e-9)
    expect(gotR!.y).toBeGreaterThanOrEqual(0.5 - 1e-9)
    expect(gotL!.y + gotL!.height / 2).toBeCloseTo(0.2, 2)
    expect(gotR!.y + gotR!.height / 2).toBeCloseTo(0.7, 2)
    expect(gotL!.x + gotL!.width / 2).toBeCloseTo(0.5, 2)
    expect(gotR!.x + gotR!.width / 2).toBeCloseTo(0.5, 2)
  })

  it('a box the two halves do not show is null', () => {
    const mid = facePx(960)
    expect(sourceToFrame(project, clip, asset, PORTRAIT, clip.start + k, unit(W, H, mid.x, mid.y, mid.width, mid.height))).toBeNull()
  })
})

/* ------------------------------------------------- subjectBoxesAt */

describe('subjectBoxesAt', () => {
  it('the mouth case: a face whose bottom is on the lower third’s top edge does not touch it, and extended downward it does', () => {
    // The file is the canvas's shape and nothing is cropped: source units ARE frame units.
    const face = { x: 0.4, y: 0.5, width: 0.2, height: 1 / 6 }
    const t: SubjectTrack = {
      ...track({ width: 1080, height: 1920, cutsMs: [], endMs: 3000, faces: () => [] }),
      samples: [0, 500, 1000, 1500, 2000, 2500].map((ms) => ({ ms, faces: [{ ...face, score: 0.9 }] }))
    }
    const { project, clip, asset } = setup({ width: 1080, height: 1920, frames: 90, track: t })
    const plain = sourceToFrame(project, clip, asset, PORTRAIT, clip.start + 45, face)!
    expectRect(plain, face)
    expect(overlapByThird([plain]).bottom).toBeLessThan(1e-9)

    const boxes = subjectBoxesAt(project, clip, asset, PORTRAIT, clip.start + 45)
    expect(boxes).toHaveLength(1)
    expect(CHIN_EXTENSION).toBe(0.5)
    expectRect(boxes[0], { ...face, height: face.height * 1.5 })
    expect(boxes[0].y + boxes[0].height).toBeCloseTo(0.75, 9)
    // 0.2 wide over the 1/12 below the edge, of a third: 0.05.
    expect(overlapByThird(boxes).bottom).toBeCloseTo(0.05, 9)
  })

  it('reads the sample nearest the frame’s source time within reach, from the shot the frame shows — never across the cut', () => {
    // Samples at 0, 1000, 2000 … (one a second); the cut at 2900 ms, frame 87; shot 0's face left, shot 1's right.
    const t = track({
      width: 1080,
      height: 1920,
      cutsMs: [2900],
      endMs: 6000,
      keep: (ms) => ms % 1000 === 0,
      faces: (shot) => [shot === 0 ? { x: 100, y: 400, width: 200, height: 200 } : { x: 700, y: 400, width: 200, height: 200 }]
    })
    const { project, clip, asset } = setup({ width: 1080, height: 1920, frames: 180, track: t })
    const leftX = r4(100 / 1080)
    const rightX = r4(700 / 1080)
    // Frame 88 is 2933 ms, in shot 1: its sample at 3000 ms, 67 ms away.
    expect(subjectBoxesAt(project, clip, asset, PORTRAIT, clip.start + 88)[0].x).toBeCloseTo(rightX, 9)
    // Frame 86 is 2867 ms, in shot 0: the sample at 3000 ms is nearer (133 ms) but across the cut; shot 0's at 2000 ms is 867 ms away, out of reach.
    expect(subjectBoxesAt(project, clip, asset, PORTRAIT, clip.start + 86)).toEqual([])
    // Frame 70 is 2333 ms: shot 0's sample at 2000 ms, 333 ms away.
    expect(subjectBoxesAt(project, clip, asset, PORTRAIT, clip.start + 70)[0].x).toBeCloseTo(leftX, 9)
    expect(SAMPLE_REACH_MS).toBe(500)
    // Off the clip: nothing.
    expect(subjectBoxesAt(project, clip, asset, PORTRAIT, clip.start - 1)).toEqual([])
    expect(subjectBoxesAt(project, clip, asset, PORTRAIT, clip.start + clip.duration)).toEqual([])
  })

  it('a clip with no track, or a track of another size, gives none', () => {
    const t = track({ width: 1080, height: 1920, cutsMs: [], endMs: 3000, faces: () => [{ x: 400, y: 400, width: 200, height: 200 }] })
    const none = setup({ width: 1080, height: 1920, frames: 90 })
    expect(subjectBoxesAt(none.project, none.clip, none.asset, PORTRAIT, none.clip.start + 10)).toEqual([])
    const other = setup({ width: 1080, height: 1920, frames: 90, track: { ...t, width: 720, height: 1280 } })
    expect(subjectBoxesAt(other.project, other.clip, other.asset, PORTRAIT, other.clip.start + 10)).toEqual([])
    const own = setup({ width: 1080, height: 1920, frames: 90, track: t })
    expect(subjectBoxesAt(own.project, own.clip, own.asset, PORTRAIT, own.clip.start + 10)).toHaveLength(1)
  })
})

describe('sourceMsAt: the export’s map inverted', () => {
  const base: Clip = {
    id: 'c',
    assetId: 'a',
    trackId: 'v1',
    start: 30,
    duration: 120,
    inPoint: 7,
    volume: 1,
    transform: { ...DEFAULT_TRANSFORM },
    color: { ...DEFAULT_COLOR }
  }

  it('lands on the frame it was asked for at every speed, a ramp included', () => {
    const cases: Partial<Clip>[] = [{}, { speed: 2 }, { speed: 0.5 }, { ramp: { from: 1, to: 0.5 } }, { ramp: { from: 0.25, to: 4 } }, { ramp: { from: 4, to: 0.25 } }]
    for (const patch of cases) {
      const clip = { ...base, ...patch }
      for (let k = 0; k < clip.duration; k++) {
        const ms = sourceMsAt(clip, FPS, k)!
        expect(exportFrameAt(clip, FPS, ms), JSON.stringify({ patch, k })).toBe(k)
      }
    }
  })

  it('at speed 1 it is the in-point plus the frame; at 2× twice as far in; a hold is its in-point', () => {
    expect(sourceMsAt(base, FPS, 30)!).toBeCloseTo(((7 + 30) * 1000) / FPS, 1)
    expect(sourceMsAt({ ...base, speed: 2 }, FPS, 30)!).toBeCloseTo(((7 + 60) * 1000) / FPS, 0)
    expect(sourceMsAt({ ...base, hold: true }, FPS, 30)).toBeCloseTo((7 * 1000) / FPS, 9)
  })
})
