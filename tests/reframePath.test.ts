import { describe, it, expect } from 'vitest'
import { cropPath, PATH_RULES, FACE_SHARE, HEAD_MS, OPENING_MS, type CropPath, type ShotCrop } from '@shared/reframe/path'
import { SUBJECT_TRACK_VERSION, type FaceBox, type SubjectTrack } from '@shared/reframe/types'
import { solveCrop } from '@shared/render/crop'

/*
 * docs/CLIPS.md §4.6's rules, over synthetic tracks (§4.9). Every track is
 * made here: faces placed by a function of ms, sampled at the plan's 2 a
 * second. Assertions are about membership and shape — a shot's why, its held
 * position against the face it should frame, a pan's timing against the rule
 * that allows it — never a snapshot of a whole path.
 */

const W = 1920
const H = 1080
const LANDSCAPE = { width: W, height: H }
const PORTRAIT_CANVAS = { width: 1080, height: 1920 }
const SQUARE = { width: 1080, height: 1080 }
const r4 = (n: number): number => Math.round(n * 1e4) / 1e4

/** A square face `side` px across, centred at (cx, cy) px, normalised to 4 dp as the track stores it. */
function face(cx: number, cy: number, side: number, frame = LANDSCAPE): FaceBox {
  return {
    x: r4((cx - side / 2) / frame.width),
    y: r4((cy - side / 2) / frame.height),
    width: r4(side / frame.width),
    height: r4(side / frame.height),
    score: 0.9
  }
}

interface Build {
  frame?: { width: number; height: number }
  /** [startMs, endMs) */
  shots: [number, number][]
  /** The faces at `ms`, any order: the builder keeps the two largest, largest first, as main's reduction does. */
  faces?: (ms: number) => FaceBox[]
  perShot?: SubjectTrack['perShot']
  /** Sample spacing; the plan's track is 2 a second. */
  stepMs?: number
}

function track(b: Build): SubjectTrack {
  const frame = b.frame ?? LANDSCAPE
  const durationMs = b.shots[b.shots.length - 1][1]
  const samples = []
  for (let ms = 0; ms < durationMs; ms += b.stepMs ?? 500) {
    const faces = [...(b.faces?.(ms) ?? [])].sort((p, q) => q.width * q.height - p.width * p.height).slice(0, 2)
    samples.push({ ms, faces })
  }
  return {
    key: '1000:1',
    version: SUBJECT_TRACK_VERSION,
    width: frame.width,
    height: frame.height,
    durationMs,
    shots: b.shots.map(([startMs, endMs], i) => ({ startMs, endMs, score: i ? 1 : 0 })),
    samples,
    perShot: b.perShot ?? b.shots.map(() => ({})),
    detector: 'synthetic',
    scene: { threshold: 0.3, minShotMs: 500, backend: 'ffmpeg-select-rgb24' },
    at: '2026-10-13T00:00:00.000Z'
  }
}

/** Where the crop's anchor point lands for a held position: its centre on x. */
const centreOf = (path: CropPath, at: number): number => at + path.size.width / 2

/** Every position the path holds or pans to is even and inside the frame, halves included. */
function expectInside(path: CropPath, frame = LANDSCAPE): void {
  const room = path.axis === 'x' ? frame.width - path.size.width : frame.height - path.size.height
  const check = (p: number, max: number): void => {
    expect(Number.isInteger(p) && p % 2 === 0, `${p} is an even integer`).toBe(true)
    expect(p).toBeGreaterThanOrEqual(0)
    expect(p).toBeLessThanOrEqual(max)
  }
  for (const s of path.shots) {
    for (const p of [s.at, ...s.pans.map((q) => q.to)]) check(p, room)
    for (const q of s.pans) {
      expect(q.fromMs).toBeGreaterThanOrEqual(s.startMs)
      expect(q.toMs).toBeLessThan(s.endMs)
    }
    if (!s.halves) continue
    for (const h of [s.halves.top, s.halves.bottom]) {
      for (const x of [h.x, ...h.pans.map((q) => q.to)]) check(x, frame.width - path.half.width)
      check(h.y, frame.height - path.half.height)
    }
  }
}

/**
 * The 4 s one-shot fixture of a still face at x 960 that steps 300 px right,
 * to x 1260, for [from, to): outside the dead zone (±152 px of a 608 px
 * crop's centre), and 1 sample of the shot's 8 is already over the static
 * test's 10 %, so rule 5 decides.
 */
const AWAY = 1260
function excursion(from: number, to: number): SubjectTrack {
  return track({ shots: [[0, 4000]], faces: (ms) => [face(ms >= from && ms < to ? AWAY : 960, 400, 120)] })
}

/** Two people too far apart for one 608 px crop: the LEFT one is the SMALLER, so ordering by size puts the wrong one on top. */
const LEFT = { cx: 384, cy: 486, side: 90 }
const RIGHT = { cx: 1536, cy: 540, side: 150 }
const farApart = (frame = LANDSCAPE): FaceBox[] => [
  face(LEFT.cx, LEFT.cy, LEFT.side, frame),
  face(RIGHT.cx, RIGHT.cy, RIGHT.side, frame)
]

describe('cropPath — rule 1: one size for the clip', () => {
  const t = track({
    shots: [
      [0, 2000],
      [2000, 4000],
      [4000, 6000]
    ],
    faces: (ms) =>
      ms < 2000
        ? [face(1880, 400, 100)] // a small face hard against the right edge
        : ms < 4000
          ? [face(200, 500, 400)] // a close-up hard against the left
          : [face(860, 400, 100), face(1060, 400, 100)] // a two-shot that fits
  })

  it('is fitRect’s full height at the target aspect, even, and the same size solveCrop cuts', () => {
    const path = cropPath(t, PORTRAIT_CANVAS)
    expect(path.axis).toBe('x')
    expect(path.size).toEqual({ width: 608, height: 1080 })
    const today = solveCrop(LANDSCAPE, PORTRAIT_CANVAS)!
    expect(path.size).toEqual({ width: today.width, height: today.height })
    expect(path.size.width % 2).toBe(0)
    expect(path.size.height % 2).toBe(0)
    expect(cropPath(t, SQUARE).size).toEqual({ width: 1080, height: 1080 })
  })

  it('places every shot against that one size: edges clamp to the frame, positions even', () => {
    for (const target of [PORTRAIT_CANVAS, SQUARE]) {
      const path = cropPath(t, target)
      expectInside(path)
      expect(path.shots.map((s) => s.why)).toEqual(['face', 'face', 'both'])
      // The small face at the right edge puts the crop as far right as it goes, ...
      expect(path.shots[0].at).toBe(W - path.size.width)
      // ... the close-up at the left as far left.
      expect(path.shots[1].at).toBe(0)
    }
  })
})

describe('cropPath — rules 4 and 5: static first, a pan only when the subject leaves', () => {
  it('a still face gives no pans, the crop centred on it', () => {
    const path = cropPath(track({ shots: [[0, 6000]], faces: () => [face(960, 400, 120)] }), PORTRAIT_CANVAS)
    expect(path.shots[0].why).toBe('face')
    expect(path.shots[0].pans).toEqual([])
    expect(Math.abs(centreOf(path, path.shots[0].at) - 960)).toBeLessThanOrEqual(2)
  })

  it('follows the shot’s one person, not whichever face is larger: a passer-by does not steer it', () => {
    // 8 s, a 100 px face at 960 throughout; a 160 px passer-by at 1700 on
    // three consecutive samples (3 of 16, under FACE_SHARE), larger, so
    // first in the track's order.
    const passing = (ms: number): boolean => ms >= 5000 && ms <= 6000
    const t = track({ shots: [[0, 8000]], faces: (ms) => [face(960, 400, 100), ...(passing(ms) ? [face(1700, 420, 160)] : [])] })
    expect(t.samples.filter((s) => passing(s.ms)).every((s) => s.faces[0].width > s.faces[1].width)).toBe(true)
    const path = cropPath(t, PORTRAIT_CANVAS)
    const s = path.shots[0]
    expect(s.why).toBe('face')
    expect(Math.abs(centreOf(path, s.at) - 960)).toBeLessThanOrEqual(2)
    expect(s.pans).toEqual([])
    // ... nor when the passer-by is there from the cut: the person is the one
    // a sample holds alone.
    const early = track({ shots: [[0, 8000]], faces: (ms) => [face(960, 400, 100), ...(ms <= 1000 ? [face(1700, 420, 160)] : [])] })
    const first = cropPath(early, PORTRAIT_CANVAS)
    expect(first.shots[0].why).toBe('face')
    expect(Math.abs(centreOf(first, first.shots[0].at) - 960)).toBeLessThanOrEqual(2)
    expect(first.shots[0].pans).toEqual([])
  })

  it('a still close-up too big for the static test is held by the dead zone, jitter and all', () => {
    // 600 px of face plus the margin each side is wider than the 608 px crop,
    // so rule 4 can never hold it; the ±20 px jitter stays inside the middle
    // half, so rule 5 must not move it either.
    const side = 600
    expect(side + 2 * PATH_RULES.marginShare * 608).toBeGreaterThan(608)
    const t = track({ shots: [[0, 6000]], faces: (ms) => [face(960 + ((ms / 500) % 2 ? -20 : 20), 540, side)] })
    const path = cropPath(t, PORTRAIT_CANVAS)
    expect(path.shots[0].why).toBe('face')
    expect(path.shots[0].pans).toEqual([])
  })

  it('a drift outside the dead zone that stays inside the held crop, margin and all, gives no pan', () => {
    // Rule 4 before rule 5. A 60 px face at 960, then at 1170 from 2000: 210
    // px from the crop's centre, past the dead zone's 152, so rule 5 alone
    // would pan; its box plus the margin (1140 − 36.5 to 1200 + 36.5) is
    // still inside the held 656–1264, so the shot is static.
    const t = track({ shots: [[0, 6000]], faces: (ms) => [face(ms < 2000 ? 960 : 1170, 400, 60)] })
    const path = cropPath(t, PORTRAIT_CANVAS)
    const s = path.shots[0]
    const margin = PATH_RULES.marginShare * path.size.width
    expect(Math.abs(1170 - centreOf(path, s.at))).toBeGreaterThan((PATH_RULES.deadZone * path.size.width) / 2)
    expect(1170 + 30 + margin).toBeLessThanOrEqual(s.at + path.size.width)
    expect(s.pans).toEqual([])
  })

  it('the same drift to within the margin of the crop’s edge pans', () => {
    // At 1200 the box (1170–1230) is inside the 656–1264 crop, but not with
    // its 36.5 px margin: the static test fails, and rule 5 moves the crop.
    const t = track({ shots: [[0, 6000]], faces: (ms) => [face(ms < 2000 ? 960 : 1200, 400, 60)] })
    const path = cropPath(t, PORTRAIT_CANVAS)
    const s = path.shots[0]
    const margin = PATH_RULES.marginShare * path.size.width
    expect(1200 + 30).toBeLessThanOrEqual(s.at + path.size.width)
    expect(1200 + 30 + margin).toBeGreaterThan(s.at + path.size.width)
    expect(s.pans).toHaveLength(1)
    expect(Math.abs(centreOf(path, s.pans[0].to) - 1200)).toBeLessThanOrEqual(2)
  })

  it('a 0.3 s excursion gives no pan', () => {
    // One sample (2500) outside the dead zone: the running median of three
    // drops it, and it was not outside for triggerMs either.
    const path = cropPath(excursion(2400, 2700), PORTRAIT_CANVAS)
    expect(path.shots[0].pans).toEqual([])
  })

  it('a 0.8 s excursion gives one pan, no sooner than triggerMs after the subject left, re-centring it', () => {
    const path = cropPath(excursion(2400, 3200), PORTRAIT_CANVAS)
    const s = path.shots[0]
    expect(s.pans).toHaveLength(1)
    const [p] = s.pans
    expect(p.fromMs).toBeGreaterThanOrEqual(2400 + PATH_RULES.triggerMs)
    expect(p.fromMs).toBeLessThan(3200)
    expect(Math.abs(centreOf(path, p.to) - AWAY)).toBeLessThanOrEqual(2)
    // A move under panMs × maxSpeed crop lengths takes panMs exactly.
    expect(Math.abs(p.to - s.at) / path.size.width).toBeLessThan((PATH_RULES.panMs / 1000) * PATH_RULES.maxSpeed)
    expect(p.toMs - p.fromMs).toBe(PATH_RULES.panMs)
    expect(p.toMs).toBeLessThan(s.endMs)
  })

  it('nothing triggers in a shot’s first three frames: a sample that close after the cut starts no clock', () => {
    // 10 a second. A face at 120 to 400 ms, then at 1000: the opening
    // second's median sits between, so every sample is outside the dead zone
    // from the cut on. The clock starts at the first sample past the head,
    // and the pan fires triggerMs after it.
    const t = track({ shots: [[0, 4000]], stepMs: 100, faces: (ms) => [face(ms < 500 ? 120 : 1000, 400, 120)] })
    const path = cropPath(t, PORTRAIT_CANVAS)
    const s = path.shots[0]
    const zone = (PATH_RULES.deadZone * path.size.width) / 2
    expect(t.samples.every((x) => Math.abs((x.faces[0].x + x.faces[0].width / 2) * W - centreOf(path, s.at)) > zone)).toBe(true)
    const clock = t.samples.find((x) => x.ms >= HEAD_MS)!.ms
    expect(clock, 'the head holds a sample').toBeGreaterThan(0)
    expect(s.pans).toHaveLength(1)
    expect(s.pans[0].fromMs).toBe(clock + PATH_RULES.triggerMs)
  })

  it('a short shot whose subject leaves early still pans: the head is frames, not samples', () => {
    // 2.5 s at 2 a second; the face is at 600 for the first sample, at 1300
    // from 500. A head of three SAMPLES (1.5 s) put the earliest pan's end
    // past the cut, so no shot under about 2.6 s could pan at all.
    const t = track({ shots: [[0, 2500]], faces: (ms) => [face(ms < 500 ? 600 : 1300, 400, 120)] })
    const path = cropPath(t, PORTRAIT_CANVAS)
    const s = path.shots[0]
    expect(s.pans).toHaveLength(1)
    expect(Math.abs(centreOf(path, s.pans[0].to) - 1300)).toBeLessThanOrEqual(2)
    expect(s.pans[0].toMs).toBeLessThan(2500)
  })

  it('a pan that cannot finish inside its shot is not started', () => {
    // A 640 px move takes 1053 ms; triggered at 3500 it would end past 4000.
    const t = track({ shots: [[0, 4000]], faces: (ms) => [face(ms < 3000 ? 960 : 1600, 400, 120)] })
    expect(cropPath(t, PORTRAIT_CANVAS).shots[0].pans).toEqual([])
    // With the cut a second later, the same move is made, and ends before it.
    const longer = track({ shots: [[0, 5000]], faces: (ms) => [face(ms < 3000 ? 960 : 1600, 400, 120)] })
    const [p] = cropPath(longer, PORTRAIT_CANVAS).shots[0].pans
    expect(p.toMs).toBeLessThan(5000)
  })

  it('a pan that would end exactly on its cut is not started: every pan settles before the cut', () => {
    // 1f puts the next shot's held key on the cut's frame; a pan still moving
    // there would fight it. The face steps to AWAY at 2400; the pan fires at
    // 3000 and takes panMs, so it ends at 3600.
    const step = (endMs: number): SubjectTrack =>
      track({ shots: [[0, endMs]], faces: (ms) => [face(ms >= 2400 ? AWAY : 960, 400, 120)] })
    const [p] = cropPath(step(3602), PORTRAIT_CANVAS).shots[0].pans
    expect(p.toMs).toBe(3600)
    expect(cropPath(step(3600), PORTRAIT_CANVAS).shots[0].pans).toEqual([])
  })

  it('a long move takes longer: never faster than maxSpeed crop lengths a second', () => {
    const t = track({ shots: [[0, 8000]], faces: (ms) => [face(ms < 3000 ? 400 : 1600, 400, 120)] })
    const path = cropPath(t, PORTRAIT_CANVAS)
    const s = path.shots[0]
    expect(s.pans).toHaveLength(1)
    const [p] = s.pans
    const lengths = Math.abs(p.to - s.at) / path.size.width
    expect(lengths).toBeGreaterThan(1)
    expect(p.toMs - p.fromMs).toBeGreaterThanOrEqual((1000 * lengths) / PATH_RULES.maxSpeed)
    expect(p.toMs - p.fromMs).toBeGreaterThan(PATH_RULES.panMs)
    expect(Math.abs(centreOf(path, p.to) - 1600)).toBeLessThanOrEqual(2)
  })

  it('on a denser track the running median keeps a stray box from aiming the pan', () => {
    // 10 a second: the face moves 960 → 1400 at 2000 and stays; one stray box
    // at 1800 lands on 2500, the sample the trigger fires on.
    const t = track({
      shots: [[0, 6000]],
      stepMs: 100,
      faces: (ms) => [face(ms === 2500 ? 1800 : ms < 2000 ? 960 : 1400, 400, 120)]
    })
    const path = cropPath(t, PORTRAIT_CANVAS)
    const [p] = path.shots[0].pans
    expect(path.shots[0].pans).toHaveLength(1)
    expect(Math.abs(centreOf(path, p.to) - 1400)).toBeLessThanOrEqual(2)
  })

  it('on the plan’s 2 a second the running median still keeps a stray box from aiming the pan', () => {
    // The same move, 960 → 1400 at 2000, with the stray at 1800 on 2500 — the
    // sample the trigger fires on. Aimed at it, the crop went to x 1312
    // (centre 1616) and needed a second pan back.
    const t = track({ shots: [[0, 6000]], faces: (ms) => [face(ms === 2500 ? 1800 : ms < 2000 ? 960 : 1400, 400, 120)] })
    const path = cropPath(t, PORTRAIT_CANVAS)
    expect(path.shots[0].pans).toHaveLength(1)
    const [p] = path.shots[0].pans
    expect(p.fromMs).toBe(2500)
    expect(Math.abs(centreOf(path, p.to) - 1400)).toBeLessThanOrEqual(2)
  })

  it('never two moves within minHoldMs: the move back waits for the hold, not the trigger', () => {
    // At 400 until 3000, at 1600 until 5000, back at 400 after: two moves.
    const t = track({ shots: [[0, 10000]], faces: (ms) => [face(ms >= 3000 && ms < 5000 ? 1600 : 400, 400, 120)] })
    const s = cropPath(t, PORTRAIT_CANVAS).shots[0]
    expect(s.pans).toHaveLength(2)
    const [a, b] = s.pans
    expect(b.fromMs - a.toMs).toBeGreaterThanOrEqual(PATH_RULES.minHoldMs)
    // The subject had been back, outside the zone, for triggerMs by 5500 —
    // before the first move even ended — so it is the hold that timed it.
    expect(5000 + PATH_RULES.triggerMs).toBeLessThan(a.toMs + PATH_RULES.minHoldMs)
    expect(b.fromMs).toBeGreaterThan(5000 + PATH_RULES.triggerMs)
    expect(b.to).toBe(s.at)
  })
})

describe('cropPath — rule 3: two people', () => {
  it('both faces fitting the crop give `both`, centred on their union', () => {
    const t = track({ shots: [[0, 4000]], faces: () => [face(860, 400, 100), face(1060, 400, 100)] })
    const path = cropPath(t, PORTRAIT_CANVAS)
    const s = path.shots[0]
    expect(s.why).toBe('both')
    expect(s.halves).toBeUndefined()
    expect(Math.abs(centreOf(path, s.at) - 960)).toBeLessThanOrEqual(2)
    expect(s.at).toBeLessThanOrEqual(860 - 50)
    expect(s.at + path.size.width).toBeGreaterThanOrEqual(1060 + 50)
  })

  it('a union that fits the crop but not with its margin is a `two-up`', () => {
    // 100 px faces at 655 and 1125: the union is 605–1175, 570 px — inside
    // the 608 px crop, but 570 + 2 × 36.5 is not.
    const t = track({ shots: [[0, 4000]], faces: () => [face(655, 400, 100), face(1125, 400, 100)] })
    const path = cropPath(t, PORTRAIT_CANVAS)
    const margin = PATH_RULES.marginShare * 608
    expect(570).toBeLessThanOrEqual(path.size.width)
    expect(570 + 2 * margin).toBeGreaterThan(path.size.width)
    expect(path.shots[0].why).toBe('two-up')
  })

  it('two faces together on exactly bothShare of the samples are a two-shot', () => {
    // 6 of 10 together (fitting), the left one alone on the other 4.
    const t = track({ shots: [[0, 5000]], faces: (ms) => (ms < 3000 ? [face(860, 400, 100), face(1060, 400, 100)] : [face(860, 400, 100)]) })
    expect(t.samples.filter((s) => s.faces.length === 2).length / t.samples.length).toBe(PATH_RULES.bothShare)
    expect(cropPath(t, PORTRAIT_CANVAS).shots[0].why).toBe('both')
  })

  it('far apart on 7 of 10 samples is still a `two-up`, not a lost face', () => {
    const t = track({ shots: [[0, 5000]], faces: (ms) => (ms < 3500 ? farApart() : [face(LEFT.cx, LEFT.cy, LEFT.side)]) })
    expect(t.samples.filter((s) => s.faces.length === 2).length).toBe(7)
    expect(cropPath(t, PORTRAIT_CANVAS).shots[0].why).toBe('two-up')
  })

  it('too far apart gives a stacked `two-up`: the face further LEFT on top, each half framing its own face', () => {
    const t = track({ shots: [[0, 4000]], faces: () => farApart() })
    // The fixture's point: the left face is the smaller, so it is NOT faces[0].
    expect(t.samples[0].faces[0].x).toBeGreaterThan(0.5)

    const path = cropPath(t, PORTRAIT_CANVAS)
    const s = path.shots[0]
    expect(s.why).toBe('two-up')
    expect(path.notes.some((n) => n.startsWith('shot 1:') && n.includes('stacked'))).toBe(true)
    expect(path.half).toEqual({ width: 608, height: 540 })
    const { top, bottom } = s.halves!
    // Each face centred on x, its centre twoUpFaceY down its half.
    expect(Math.abs(top.x + path.half.width / 2 - LEFT.cx)).toBeLessThanOrEqual(2)
    expect(Math.abs(top.y + PATH_RULES.twoUpFaceY * path.half.height - LEFT.cy)).toBeLessThanOrEqual(2)
    expect(Math.abs(bottom.x + path.half.width / 2 - RIGHT.cx)).toBeLessThanOrEqual(2)
    expect(Math.abs(bottom.y + PATH_RULES.twoUpFaceY * path.half.height - RIGHT.cy)).toBeLessThanOrEqual(2)
    expect(top.pans).toEqual([])
    expect(bottom.pans).toEqual([])
    // A consumer that draws one crop gets the top half's position.
    expect(s.at).toBe(top.x)
    expectInside(path)
  })

  it('a canvas of the source’s own shape has nothing to follow, and never stacks', () => {
    // setAspect's 9:16 → 16:9 → 9:16 round trip passes through this (§4.7).
    // Faces at the very edges: too far apart even for the whole frame's width
    // less its margins, so only the shape rule keeps this from a two-up.
    const edges = track({ shots: [[0, 4000]], faces: () => [face(100, 500, 150), face(1820, 500, 160)] })
    expect(cropPath(edges, PORTRAIT_CANVAS).shots[0].why).toBe('two-up')
    const path = cropPath(edges, LANDSCAPE)
    expect(path.size).toEqual({ width: W, height: H })
    expect(path.shots.every((s) => s.why !== 'two-up' && !s.halves && s.at === 0 && s.pans.length === 0)).toBe(true)
  })

  it('a two-up clip’s height is a multiple of 4 and each half exactly half of it', () => {
    for (const frame of [LANDSCAPE, { width: 1920, height: 1078 }]) {
      const path = cropPath(track({ frame, shots: [[0, 4000]], faces: () => farApart(frame) }), PORTRAIT_CANVAS)
      expect(path.shots[0].why).toBe('two-up')
      expect(path.size.height % 4).toBe(0)
      expect(path.half.height * 2).toBe(path.size.height)
      expect(path.half.width).toBe(path.size.width)
      expect(path.size.height).toBeLessThanOrEqual(frame.height)
      expectInside(path, frame)
    }
  })

  it('a face lost for much of the shot gives `larger` with a note, never a two-up', () => {
    // Together on 4 of 10 samples (under bothShare); the RIGHT face is the one
    // that comes and goes, and it is the larger: the crop holds on it while
    // it is lost rather than jumping to the left face.
    const t = track({
      shots: [[0, 5000]],
      faces: (ms) => (Math.round(ms / 500) % 5 < 2 ? farApart() : [face(LEFT.cx, LEFT.cy, LEFT.side)])
    })
    const together = t.samples.filter((s) => s.faces.length === 2).length / t.samples.length
    expect(together).toBeLessThan(PATH_RULES.bothShare)
    expect(together).toBeGreaterThanOrEqual(FACE_SHARE)

    const path = cropPath(t, PORTRAIT_CANVAS)
    const s = path.shots[0]
    expect(s.why).toBe('larger')
    expect(s.halves).toBeUndefined()
    expect(path.notes.some((n) => n.startsWith('shot 1:') && n.includes('lost'))).toBe(true)
    expect(Math.abs(centreOf(path, s.at) - RIGHT.cx)).toBeLessThanOrEqual(2)
    expect(s.pans).toEqual([])
  })

  it('with Stack two people off, too far apart gives `larger`', () => {
    const t = track({ shots: [[0, 4000]], faces: () => farApart() })
    const path = cropPath(t, PORTRAIT_CANVAS, { twoUp: false })
    const s = path.shots[0]
    expect(s.why).toBe('larger')
    expect(s.halves).toBeUndefined()
    expect(path.notes.some((n) => n.startsWith('shot 1:'))).toBe(true)
    expect(Math.abs(centreOf(path, s.at) - RIGHT.cx)).toBeLessThanOrEqual(2)
    // No two-up anywhere, so no height evened for one.
    expect(path.size).toEqual({ width: 608, height: 1080 })
  })
})

describe('cropPath — rule 2: the ladder when no face leads', () => {
  const box = (cx: number) => ({ box: { x: cx - 0.05, y: 0.3, width: 0.1, height: 0.2 }, ms: 0 })
  const t = track({
    shots: [
      [0, 2000],
      [2000, 4000],
      [4000, 7000]
    ],
    // Shot 3 has a face on one sample of six: under FACE_SHARE.
    faces: (ms) => (ms === 4500 ? [face(1700, 400, 120)] : []),
    perShot: [{ ground: { ...box(0.7), phrase: 'the cake' }, salient: box(0.3) }, { salient: box(0.3) }, {}]
  })

  it('ground beats salient, salient beats the centre, and the centre is solveCrop’s', () => {
    const path = cropPath(t, PORTRAIT_CANVAS)
    expect(path.shots.map((s) => s.why)).toEqual(['ground', 'salient', 'centre'])
    expect(Math.abs(centreOf(path, path.shots[0].at) - 0.7 * W)).toBeLessThanOrEqual(2)
    expect(Math.abs(centreOf(path, path.shots[1].at) - 0.3 * W)).toBeLessThanOrEqual(2)
    expect(path.shots[2].at).toBe(solveCrop(LANDSCAPE, PORTRAIT_CANVAS)!.x)
    expect(path.notes.some((n) => n.startsWith('shot 3:') && n.includes('centred'))).toBe(true)
    for (const s of path.shots) expect(s.pans).toEqual([])
  })
})

describe('cropPath — rule 6: a lost face holds', () => {
  it('no detection holds the last position', () => {
    const t = track({ shots: [[0, 6000]], faces: (ms) => (ms < 2000 ? [face(400, 400, 120)] : []) })
    const s = cropPath(t, PORTRAIT_CANVAS).shots[0]
    expect(s.why).toBe('face')
    expect(Math.abs(s.at + 304 - 400)).toBeLessThanOrEqual(2)
    expect(s.pans).toEqual([])
  })

  it('a face lost for the first second starts on the ladder, then pans to the face once it shows', () => {
    const t = track({
      shots: [[0, 6000]],
      faces: (ms) => (ms >= 1500 ? [face(1500, 400, 120)] : []),
      perShot: [{ salient: { box: { x: 0.25, y: 0.3, width: 0.1, height: 0.2 }, ms: 0 } }]
    })
    const path = cropPath(t, PORTRAIT_CANVAS)
    const s = path.shots[0]
    expect(t.samples.filter((x) => x.ms < OPENING_MS).every((x) => x.faces.length === 0)).toBe(true)
    expect(s.why).toBe('salient')
    expect(Math.abs(centreOf(path, s.at) - 0.3 * W)).toBeLessThanOrEqual(2)
    expect(path.notes.some((n) => n.startsWith('shot 1:') && n.includes('first second'))).toBe(true)
    expect(s.pans).toHaveLength(1)
    expect(Math.abs(centreOf(path, s.pans[0].to) - 1500)).toBeLessThanOrEqual(2)
  })
})

describe('cropPath — rule 6 is for a LOST face, not a subject still to arrive', () => {
  const firstSecondNote = (path: CropPath): boolean => path.notes.some((n) => n.includes('first second'))

  it('a two-shot whose second person arrives after the opening second starts on the two-shot', () => {
    // Faces at 300 and 700 (a 500 px union that fits); only the one at 300
    // in the first second. On the ladder it started centred, 656–1264, with
    // neither face in the crop.
    const t = track({ shots: [[0, 10000]], faces: (ms) => (ms < 1000 ? [face(300, 400, 100)] : [face(300, 400, 100), face(700, 400, 100)]) })
    expect(t.samples.filter((x) => x.ms < OPENING_MS).every((x) => x.faces.length === 1)).toBe(true)
    const path = cropPath(t, PORTRAIT_CANVAS)
    const s = path.shots[0]
    expect(s.why).toBe('both')
    expect(Math.abs(centreOf(path, s.at) - 500)).toBeLessThanOrEqual(2)
    expect(s.at).toBeLessThanOrEqual(300 - 50)
    expect(firstSecondNote(path)).toBe(false)
    expect(s.pans).toEqual([])
  })

  it('the larger person absent from the opening second: the crop starts on them, not on the ladder', () => {
    // Stack two people off; the smaller (left) face alone for the first second.
    const t = track({ shots: [[0, 10000]], faces: (ms) => (ms < 1000 ? [face(LEFT.cx, LEFT.cy, LEFT.side)] : farApart()) })
    const path = cropPath(t, PORTRAIT_CANVAS, { twoUp: false })
    const s = path.shots[0]
    expect(s.why).toBe('larger')
    expect(Math.abs(centreOf(path, s.at) - RIGHT.cx)).toBeLessThanOrEqual(2)
    expect(firstSecondNote(path)).toBe(false)
    expect(s.pans).toEqual([])
  })

  it('a two-shot with no face at all in the opening second still starts on the ladder, and says so', () => {
    const t = track({ shots: [[0, 10000]], faces: (ms) => (ms < 1000 ? [] : [face(300, 400, 100), face(700, 400, 100)]) })
    const path = cropPath(t, PORTRAIT_CANVAS)
    expect(path.shots[0].why).toBe('centre')
    expect(path.notes.some((n) => n.startsWith('shot 1:') && n.includes('first second'))).toBe(true)
  })
})

describe('cropPath — a portrait source going to 16:9 runs on y', () => {
  const PORTRAIT = { width: 1080, height: 1920 }
  const WIDE = { width: 1920, height: 1080 }

  it('puts the face at the upper third, one size, inside the frame', () => {
    const t = track({ frame: PORTRAIT, shots: [[0, 4000]], faces: () => [face(540, 700, 150, PORTRAIT)] })
    const path = cropPath(t, WIDE)
    expect(path.axis).toBe('y')
    const today = solveCrop(PORTRAIT, WIDE)!
    expect(path.size).toEqual({ width: today.width, height: today.height })
    expect(Math.abs(path.shots[0].at + path.size.height / 3 - 700)).toBeLessThanOrEqual(2)
    expectInside(path, PORTRAIT)
  })

  it('keeps a two-shot whole, margins and all: the upper third gives way to rule 3’s fit', () => {
    // Faces at y 500 and 900, 100 px: the union is 450–950, 500 px, which
    // fits the 608 px crop with its margins. At the upper third its centre
    // (700) put the crop at 498, and the top face lost 48 px.
    const t = track({
      frame: PORTRAIT,
      shots: [[0, 4000]],
      faces: () => [face(540, 500, 100, PORTRAIT), face(540, 900, 100, PORTRAIT)]
    })
    const path = cropPath(t, WIDE)
    const s = path.shots[0]
    const margin = PATH_RULES.marginShare * path.size.height
    expect(s.why).toBe('both')
    // place() rounds to even, so a margin may be short by a pixel.
    expect(s.at).toBeLessThanOrEqual(450 - margin + 1)
    expect(s.at + path.size.height).toBeGreaterThanOrEqual(950 + margin - 1)
    expectInside(path, PORTRAIT)
  })

  it('keeps a close-up that fits whole rather than at the upper third', () => {
    // A 460 px face, 470–930: the upper third put the crop at 498 and cut 28 px off its top.
    const t = track({ frame: PORTRAIT, shots: [[0, 4000]], faces: () => [face(540, 700, 460, PORTRAIT)] })
    const path = cropPath(t, WIDE)
    const s = path.shots[0]
    const margin = PATH_RULES.marginShare * path.size.height
    expect(s.why).toBe('face')
    expect(s.at).toBeLessThanOrEqual(470 - margin + 1)
    expect(s.at + path.size.height).toBeGreaterThanOrEqual(930 + margin - 1)
    // ... and so does a pan: the face moves down to 1300 (1070–1530) at 2000.
    const moving = track({ frame: PORTRAIT, shots: [[0, 6000]], faces: (ms) => [face(540, ms < 2000 ? 700 : 1300, 460, PORTRAIT)] })
    const m = cropPath(moving, WIDE).shots[0]
    expect(m.pans).toHaveLength(1)
    expect(m.pans[0].to).toBeLessThanOrEqual(1070 - margin + 1)
    expect(m.pans[0].to + path.size.height).toBeGreaterThanOrEqual(1530 + margin - 1)
  })

  it('keeps `larger` for two people too far apart — no two-up on y', () => {
    const t = track({
      frame: PORTRAIT,
      shots: [[0, 4000]],
      faces: () => [face(540, 300, 150, PORTRAIT), face(540, 1600, 200, PORTRAIT)]
    })
    const path = cropPath(t, WIDE)
    expect(path.shots[0].why).toBe('larger')
    expect(path.shots[0].halves).toBeUndefined()
    expectInside(path, PORTRAIT)
  })
})

describe('cropPath — rule 8: a hand correction survives', () => {
  const t = track({
    shots: [
      [0, 4000],
      [4000, 8000]
    ],
    faces: () => [face(960, 400, 120)]
  })

  it('an offset is a share of the crop, so an aspect change keeps where the face sits in the frame', () => {
    const share = 0.1
    const placed: number[] = []
    for (const target of [PORTRAIT_CANVAS, SQUARE]) {
      const base = cropPath(t, target)
      const moved = cropPath(t, target, { offsets: { 4000: share } })
      // Only the shot that was dragged moves.
      expect(moved.shots[0]).toEqual(base.shots[0])
      const len = moved.size.width
      expect(Math.abs(moved.shots[1].at - base.shots[1].at - share * len)).toBeLessThanOrEqual(2)
      // The intent: the face sits a share to the left of centre, at either aspect.
      const across = (960 - moved.shots[1].at) / len
      expect(Math.abs(across - (0.5 - share))).toBeLessThanOrEqual(2 / len)
      placed.push(moved.shots[1].at - base.shots[1].at)
    }
    // ... which is not the same pixels.
    expect(placed[0]).not.toBe(placed[1])
  })

  it('moves the pans with the held position, every one clamped', () => {
    const t2 = excursion(2400, 3200)
    const base = cropPath(t2, PORTRAIT_CANVAS).shots[0]
    const moved = cropPath(t2, PORTRAIT_CANVAS, { offsets: { 0: 0.05 } }).shots[0]
    expect(base.pans).toHaveLength(1)
    expect(Math.abs(moved.at - base.at - 0.05 * 608)).toBeLessThanOrEqual(2)
    expect(Math.abs(moved.pans[0].to - base.pans[0].to - 0.05 * 608)).toBeLessThanOrEqual(2)
    expect(cropPath(t2, PORTRAIT_CANVAS, { offsets: { 0: 5 } }).shots[0].at).toBe(W - 608)
  })

  it('a half’s offset moves only that half', () => {
    const t3 = track({ shots: [[0, 4000]], faces: () => farApart() })
    const base = cropPath(t3, PORTRAIT_CANVAS)
    const moved = cropPath(t3, PORTRAIT_CANVAS, { halfOffsets: { 0: { bottom: { x: 0.1, y: -0.1 } } } })
    const b = base.shots[0].halves!
    const m = moved.shots[0].halves!
    expect(m.top).toEqual(b.top)
    expect(moved.shots[0].at).toBe(base.shots[0].at)
    expect(Math.abs(m.bottom.x - b.bottom.x - 0.1 * moved.half.width)).toBeLessThanOrEqual(2)
    expect(Math.abs(m.bottom.y - b.bottom.y + 0.1 * moved.half.height)).toBeLessThanOrEqual(2)
    expectInside(moved)
  })
})

describe('cropPath — the same input gives the same output', () => {
  it('twice, deep-equal, and the track untouched', () => {
    const t = track({
      shots: [
        [0, 4000],
        [4000, 8000],
        [8000, 13000],
        [13000, 15000]
      ],
      faces: (ms) =>
        ms < 4000
          ? [face(ms >= 2400 && ms < 3200 ? 1500 : 960, 400, 120)]
          : ms < 8000
            ? farApart()
            : ms < 13000
              ? Math.round(ms / 500) % 5 < 2
                ? farApart()
                : [face(LEFT.cx, LEFT.cy, LEFT.side)]
              : [],
      perShot: [{}, {}, {}, { salient: { box: { x: 0.6, y: 0.3, width: 0.1, height: 0.2 }, ms: 14000 } }]
    })
    const before = structuredClone(t)
    const follow = { offsets: { 0: 0.05 }, halfOffsets: { 4000: { top: { x: -0.05, y: 0.05 } } } }
    const a = cropPath(t, PORTRAIT_CANVAS, follow)
    const b = cropPath(t, PORTRAIT_CANVAS, follow)
    expect(a).toEqual(b)
    expect(t).toEqual(before)
    // The fixture covers what it claims to.
    const whys: ShotCrop['why'][] = a.shots.map((s) => s.why)
    expect(whys).toEqual(['face', 'two-up', 'larger', 'salient'])
    expect(a.shots[0].pans.length).toBeGreaterThan(0)
  })
})
