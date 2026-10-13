import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { exportFrameAt, followAt, followKeys, isKeyed, positionAt, TIE_SLACK, type FollowKeys } from '@shared/reframe/keys'
import { exportPixel, flatSumExpression, type FlatSum } from '@shared/reframe/expression'
import { cropPath, type CropPath, type ShotCrop } from '@shared/reframe/path'
import { SUBJECT_TRACK_VERSION, type FaceBox, type SubjectTrack } from '@shared/reframe/types'
import {
  DEFAULT_COLOR,
  DEFAULT_TRANSFORM,
  emptyProject,
  freezeFrame,
  sourceFrameFor,
  splitClip,
  timelineFrameAt,
  trimStart,
  type Clip,
  type MediaAsset,
  type Project
} from '@shared/timeline'
import { withClipRamp, withClipSpeed } from '@shared/render/speed'
import { convertFrameRate } from '@shared/project/frameRate'
import { followedRetime, retimeFilter } from '@shared/render/plan'
import { KEYED_PROPERTIES, MASK_PROPERTIES } from '@shared/render/keyframes'
import { evaluateFlatSum } from './fixtures/flatSum'

/*
 * docs/CLIPS.md §4.7 and §4.9: the followed crop's keys, compiled from a
 * synthetic subject track every time they are read.
 *
 * The bar is the step's hardest: no crop held across a cut. So every check
 * here reads the keys the way the EXPORT runs them — the compiled text,
 * parsed and evaluated (tests/fixtures/flatSum.ts), clamped and cut at
 * lrint & ~1 — on the frame before each cut and on the cut's own frame,
 * against an oracle written here in integers from the measured rules, not
 * from keys.ts: a 30 fps mp4's pts are 512·k on a 1/15360 time base, the
 * `-ss` seek is subtracted in that time base, `setpts=PTS/s` truncates, and
 * `fps=` rounds half up (vf_fps.c NEAR_INF). Cut times are what the shot
 * finder prints: `%.6g` of pts_time, then msOf.
 */

const FPS = 30
const W = 1920
const H = 1080
const CANVAS = { width: 1080, height: 1920 }

/** Source frames the shots cut on. 95 and 200 are ≡ 2 (mod 3), §3.2's case; 459 ≡ 3 (mod 6) is a tie at 25 fps; 95, 289 and 459 are odd, ties at 2×. */
const CUTS = [95, 200, 289, 459]
const END = 600

/** The shot finder's time for source frame k: ffmpeg's `%.6g` pts_time, then shots.ts' msOf. */
const finderMs = (k: number, fps = FPS): number => Math.round(Number((k / fps).toPrecision(6)) * 1e6) / 1e3

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4
function face(cx: number, cy: number, side = 200): FaceBox {
  return { x: r4((cx - side / 2) / W), y: r4((cy - side / 2) / H), width: r4(side / W), height: r4(side / H), score: 0.9 }
}

/** Which shot `ms` is in. */
const shotOf = (ms: number): number => CUTS.filter((k) => finderMs(k) <= ms).length

/**
 * One person per shot, at x 500, 1500, 700 → 1000 (a move at 8.5 s inside
 * shot 3, which pans 9000 → 9600 ms: frames 270–288, one before the cut at
 * 289), 1100 and 800. With `twoUp`, shot 4 holds two people at x 384 and
 * 1536, too far apart for one 608 px crop: a stacked two-up.
 */
function track(twoUp = false): SubjectTrack {
  const durationMs = (END * 1000) / FPS
  const samples = []
  for (let ms = 0; ms < durationMs; ms += 500) {
    const s = shotOf(ms)
    const faces =
      s === 0 ? [face(500, 400)]
        : s === 1 ? [face(1500, 400)]
          : s === 2 ? [face(ms < 8500 ? 700 : 1000, 400)]
            : s === 3 ? (twoUp ? [face(384, 400), face(1536, 400)] : [face(1100, 400)])
              : [face(800, 400)]
    samples.push({ ms, faces })
  }
  const edges = [0, ...CUTS.map((k) => finderMs(k)), durationMs]
  return {
    key: '123456:1700000000000',
    version: SUBJECT_TRACK_VERSION,
    width: W,
    height: H,
    durationMs,
    shots: edges.slice(0, -1).map((startMs, i) => ({ startMs, endMs: edges[i + 1], score: i ? 0.9 : 0 })),
    samples,
    perShot: edges.slice(0, -1).map(() => ({})),
    detector: 'synthetic',
    scene: { threshold: 0.3, minShotMs: 500, backend: 'ffmpeg-select-rgb24' },
    at: '2026-10-13T00:00:00.000Z'
  }
}

const TRACK = track()
const TRACK_2UP = track(true)

function setup(t: SubjectTrack = TRACK, patch: Partial<Clip> = {}, canvas = CANVAS): { project: Project; clip: Clip } {
  const asset: MediaAsset = {
    id: 'a',
    path: '/media/talk.mp4',
    name: 'talk.mp4',
    kind: 'video',
    durationFrames: END,
    width: W,
    height: H,
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
    duration: END,
    inPoint: 0,
    volume: 1,
    transform: { ...DEFAULT_TRANSFORM },
    color: { ...DEFAULT_COLOR },
    follow: { version: 1 },
    ...patch
  }
  const base = emptyProject('reframe')
  const project: Project = {
    ...base,
    settings: { ...base.settings, ...canvas, fps: FPS },
    assets: [asset],
    clips: [clip],
    subjects: { a: t }
  }
  return { project, clip }
}

const clipOf = (project: Project, id = 'c'): Clip => project.clips.find((c) => c.id === id)!

/** The export's frame for source frame k, from the measured rules in integers (see the top). */
function exportSlot(k: number, clip: Clip, fps: number): number {
  const seek = Math.round((Math.round(Number((clip.inPoint / fps).toFixed(6)) * 1e6) * 15360) / 1e6)
  const rel = 512 * k - seek
  const s = clip.speed ?? 1
  const q = Math.abs(s - 1) < 0.001 ? rel : Math.trunc(rel / s)
  return Math.floor((2 * q * fps + 15360) / (2 * 15360))
}

/** What the export draws for a lane on a clip frame: the compiled text, evaluated, clamped to the room, lrint & ~1. */
function drawn(sum: FlatSum | undefined, fallback: number, frame: number, fps: number, room: number): number {
  if (!sum) return fallback
  const raw = evaluateFlatSum(flatSumExpression(sum, { fps, startSeconds: 0 }), frame, fps)
  return exportPixel(Math.max(0, Math.min(raw, room)))
}

const drawnX = (keys: FollowKeys, frame: number): number =>
  drawn(keys.cropX, keys.crop.x, frame, keys.fps, keys.source.width - keys.size.width)

/** Where a shot ends up: its last pan's target, or where it was held. */
const endOf = (shot: ShotCrop): number => (shot.pans.length ? shot.pans[shot.pans.length - 1].to : shot.at)

/**
 * Every cut inside the clip: the frame before it shows the old shot's crop,
 * the cut's own frame the new one's. Returns how many cuts it checked, so a
 * window with none cannot pass by checking nothing.
 */
function expectCutsOn(keys: FollowKeys, path: CropPath, clip: Clip, fps: number, slotOf: (k: number) => number): number {
  let checked = 0
  CUTS.forEach((k, i) => {
    const f = slotOf(k)
    if (f <= 0 || f >= clip.duration) return
    expect(drawnX(keys, f), `cut at source ${k}: frame ${f} shows the new shot`).toBe(path.shots[i + 1].at)
    expect(drawnX(keys, f - 1), `cut at source ${k}: frame ${f - 1} still shows the old`).toBe(endOf(path.shots[i]))
    expect(keys.cropX!.terms.some((t) => 'atFrame' in t && t.atFrame === f), `a held key on frame ${f}`).toBe(true)
    checked++
  })
  return checked
}

const PATH = cropPath(TRACK, CANVAS, { twoUp: undefined })
const PATH_2UP = cropPath(TRACK_2UP, CANVAS, {})

describe('the synthetic track is what the tests below assume', () => {
  it('five shots with distinct held positions, one pan on the frame grid in shot 3, and a two-up shot 4 on the second track', () => {
    expect(PATH.shots.map((s) => s.why)).toEqual(['face', 'face', 'face', 'face', 'face'])
    expect(new Set(PATH.shots.map((s) => s.at)).size).toBe(5)
    expect(PATH.shots[2].pans).toEqual([{ fromMs: 9000, toMs: 9600, to: 696 }])
    expect(PATH_2UP.shots[3].why).toBe('two-up')
    expect(PATH_2UP.size).toEqual({ width: 608, height: 1080 })
    expect(PATH_2UP.half).toEqual({ width: 608, height: 540 })
  })
})

describe('followKeys — a held key ON each cut’s frame', () => {
  it('at speed 1: the frame before each cut shows the old crop, the cut’s frame the new one', () => {
    const { project, clip } = setup()
    const keys = followKeys(project, clip, FPS)!
    expect(isKeyed(keys)).toBe(true)
    expect(expectCutsOn(keys, PATH, clip, FPS, (k) => exportSlot(k, clip, FPS))).toBe(4)
    // The slots themselves, so the oracle is seen to be the plain thing at speed 1.
    expect(CUTS.map((k) => exportSlot(k, clip, FPS))).toEqual(CUTS)
    expect(keys.crop).toEqual({ x: PATH.shots[0].at, y: 0, width: 608, height: 1080 })
  })

  it('positionAt agrees with the compiled expression on every frame, and followAt is the expression', () => {
    const { project, clip } = setup()
    const keys = followKeys(project, clip, FPS)!
    expect(keys.cropX!.terms.filter((t) => 'fromFrame' in t)).toEqual([{ fromFrame: 270, toFrame: 288, delta: 300 }])
    for (let n = 0; n < clip.duration; n++) {
      const x = drawnX(keys, n)
      expect(positionAt(PATH, (n * 1000) / FPS).x, `frame ${n}`).toBe(x)
      expect(followAt(keys, n).crop, `frame ${n}`).toEqual({ x, y: 0, width: 608, height: 1080 })
    }
    // Mid-pan frames are not all on even held values: the ease is really read, not stepped.
    const mid = Array.from({ length: 17 }, (_, i) => drawnX(keys, 271 + i))
    expect(new Set(mid).size).toBeGreaterThan(10)
  })
})

describe('followKeys — still on each cut’s frame after every ordinary edit', () => {
  it('withClipSpeed to 2: the cut is on floor(trunc(pts/2)·fps/den + ½), the odd ones rounding up', () => {
    const { project } = setup()
    const sped = withClipSpeed(project, 'c', 2)
    const clip = clipOf(sped)
    const keys = followKeys(sped, clip, FPS)!
    expect(CUTS.map((k) => exportSlot(k, clip, FPS))).toEqual([48, 100, 145, 230])
    expect(expectCutsOn(keys, PATH, clip, FPS, (k) => exportSlot(k, clip, FPS))).toBe(4)
  })

  it('withClipSpeed to 4: a pan that ends on the next cut’s own frame is over by it — the cut’s step wins', () => {
    const { project } = setup()
    const fast = withClipSpeed(project, 'c', 4)
    const clip = clipOf(fast)
    const keys = followKeys(fast, clip, FPS)!
    // Shot 3's pan ends at source 288 and the cut is 289: at 4× both are on frame 72.
    const cut = exportSlot(289, clip, FPS)
    expect(cut).toBe(72)
    const pan = keys.cropX!.terms.find((t) => 'fromFrame' in t)
    expect(pan).toEqual({ fromFrame: 68, toFrame: 72, delta: 300 })
    expect(drawnX(keys, cut)).toBe(PATH.shots[3].at)
    expect(drawnX(keys, cut - 1)).not.toBe(PATH.shots[3].at)
    // The other cuts, frame before and frame on.
    const others = CUTS.filter((k) => k !== 289)
    for (const k of others) {
      const i = CUTS.indexOf(k)
      const f = exportSlot(k, clip, FPS)
      expect(drawnX(keys, f), `cut ${k}`).toBe(PATH.shots[i + 1].at)
      expect(drawnX(keys, f - 1), `cut ${k}`).toBe(endOf(PATH.shots[i]))
    }
  })

  it('withClipSpeed to 0.5: the export shows source floor(n/2), so the cut is on 2k — not on timelineFrameAt’s 2k − 1', () => {
    const { project } = setup()
    const slowed = withClipSpeed(project, 'c', 0.5)
    const clip = clipOf(slowed)
    const keys = followKeys(slowed, clip, FPS)!
    expect(CUTS.map((k) => exportSlot(k, clip, FPS))).toEqual(CUTS.map((k) => 2 * k))
    expect(expectCutsOn(keys, PATH, clip, FPS, (k) => exportSlot(k, clip, FPS))).toBe(4)
  })

  it('a ramp edit: each cut on the frame its own setpts (on the seek’s clock, as plan.ts writes it for a followed clip) and fps= put it', () => {
    // Slowing at shot 3's end, so its pan is over before the cut's frame (at 4× it is not: the cut's step wins, above).
    for (const [ramp, inPoint] of [[{ from: 1, to: 0.5 }, 0], [{ from: 2, to: 0.5 }, 37], [{ from: 0.5, to: 1 }, 37]] as const) {
      const { project } = setup(TRACK, { inPoint, duration: END - inPoint })
      const ramped = withClipRamp(project, 'c', ramp)
      const clip = clipOf(ramped)
      const keys = followKeys(ramped, clip, FPS)!
      const filter = followedRetime(clip, FPS, keys)!
      // `T`, seek-relative — never T-STARTT, the first kept frame's clock (reframe.int's ramp row).
      const m = /^setpts='\((-?[\d.]+)\)\*log\(\((-?[\d.]+)\+\((-?[\d.]+)\)\*T\/(-?[\d.]+)\)\/(-?[\d.]+)\)\/TB',fps=30$/.exec(filter)
      expect(m, filter).not.toBeNull()
      expect(retimeFilter(clip, FPS), 'an unfollowed ramp keeps its own clock').toContain('*(T-STARTT)/')
      const [scale, from, k, D] = [1, 2, 3, 4].map((i) => Number(m![i]))
      // In integers where ffmpeg has them: the source pts after the seek, on a 30 fps mp4's 1/15360; setpts truncates; fps= rounds half up.
      const seek = Math.round((Math.round(Number((inPoint / FPS).toFixed(6)) * 1e6) * 15360) / 1e6)
      const slotOf = (cut: number): number => {
        const T = (512 * cut - seek) / 15360
        const q = Math.trunc(scale * Math.log((from + (k * T) / D) / from) * 15360)
        return Math.floor((2 * q * FPS + 15360) / (2 * 15360))
      }
      expect(expectCutsOn(keys, PATH, clip, FPS, slotOf), JSON.stringify(ramp)).toBeGreaterThanOrEqual(3)
      expect(keys.notes.some((n) => /ramp/.test(n)), 'measured now: no ramp note').toBe(false)
    }
  })

  it('convertFrameRate 30 → 25 → 30, with an in-point off the 25 fps grid', () => {
    const { project } = setup(TRACK, { inPoint: 37, duration: 540 })
    const at25 = convertFrameRate(project, 25)
    const clip25 = clipOf(at25)
    expect(clip25.inPoint).toBe(31)
    const keys25 = followKeys(at25, clip25, 25)!
    // Source 459 is t·25 = 351.5 after the seek: a tie, which fps= rounds up.
    expect(exportSlot(459, clip25, 25)).toBe(352)
    expect(expectCutsOn(keys25, PATH, clip25, 25, (k) => exportSlot(k, clip25, 25))).toBe(4)

    const back = convertFrameRate(at25, 30)
    const clip30 = clipOf(back)
    expect(clip30.inPoint).toBe(37)
    const keys30 = followKeys(back, clip30, 30)!
    expect(expectCutsOn(keys30, PATH, clip30, 30, (k) => exportSlot(k, clip30, 30))).toBe(4)
  })

  it('a head trim: the keys move with the in-point, and the clip’s first frame is the shot under it', () => {
    const { clip } = setup()
    const trimmed = trimStart(clip, clip.start + 50)
    const { project } = setup(TRACK, trimmed)
    const keys = followKeys(project, trimmed, FPS)!
    expect(trimmed.inPoint).toBe(50)
    expect(expectCutsOn(keys, PATH, trimmed, FPS, (k) => exportSlot(k, trimmed, FPS))).toBe(4)

    // And at 2×, where the trim moves the in-point two source frames a timeline frame.
    const sped = clipOf(withClipSpeed(setup().project, 'c', 2))
    const trimmed2 = trimStart(sped, sped.start + 21)
    expect(trimmed2.inPoint).toBe(42)
    const keys2 = followKeys(setup(TRACK, trimmed2).project, trimmed2, FPS)!
    expect(expectCutsOn(keys2, PATH, trimmed2, FPS, (k) => exportSlot(k, trimmed2, FPS))).toBe(4)
  })

  it('a split: each half keeps follow and keys its own cuts; a split mid-pan opens mid-pan', () => {
    const { clip } = setup()
    const [left, right] = splitClip(clip, clip.start + 250)!
    expect(left.follow).toEqual(clip.follow)
    expect(right.follow).toEqual(clip.follow)
    const lk = followKeys(setup(TRACK, left).project, left, FPS)!
    const rk = followKeys(setup(TRACK, right).project, right, FPS)!
    expect(expectCutsOn(lk, PATH, left, FPS, (k) => exportSlot(k, left, FPS))).toBe(2)
    expect(expectCutsOn(rk, PATH, right, FPS, (k) => exportSlot(k, right, FPS))).toBe(2)
    expect(rk.crop.x).toBe(PATH.shots[2].at)

    // Ten frames into shot 3's pan (frames 270–288): the right half starts where the pan is.
    const [, mid] = splitClip(clip, clip.start + 280)!
    const mk = followKeys(setup(TRACK, mid).project, mid, FPS)!
    const at = positionAt(PATH, (280 * 1000) / FPS).x
    expect(at).toBeGreaterThan(PATH.shots[2].at)
    expect(at).toBeLessThan(696)
    expect(mk.crop.x).toBe(at)
    expect(drawnX(mk, 0)).toBe(at)
    for (let n = 0; n < 12; n++) expect(drawnX(mk, n), `frame ${n}`).toBe(positionAt(PATH, ((280 + n) * 1000) / FPS).x)
  })
})

describe('followKeys — what is refused', () => {
  it('a hold does not follow: no keys, a note, and its crop where the subject is on the frame it froze', () => {
    const { project, clip } = setup()
    const frozen = freezeFrame(project, 'c', clip.start + 280, 30)!
    const hold = clipOf(frozen, 'c-hold')
    expect(hold.hold).toBe(true)
    expect(hold.follow).toEqual(clip.follow)
    const keys = followKeys(frozen, hold, FPS)!
    expect(isKeyed(keys)).toBe(false)
    expect(keys.cropX).toBeUndefined()
    expect(keys.notes.some((n) => /held frame/.test(n))).toBe(true)
    expect(keys.crop.x).toBe(positionAt(PATH, (sourceFrameFor(clip, clip.start + 280) * 1000) / FPS).x)
    expect(exportFrameAt(hold, FPS, 1000)).toBeNull()
  })

  it('null with no follow, no track, a track of another size or version, or a picture', () => {
    const { project, clip } = setup()
    const { follow: _f, ...plain } = clip
    expect(followKeys(project, plain, FPS)).toBeNull()
    expect(followKeys({ ...project, subjects: undefined }, clip, FPS)).toBeNull()
    expect(followKeys({ ...project, subjects: { a: { ...TRACK, width: 1280, height: 720 } } }, clip, FPS)).toBeNull()
    expect(followKeys({ ...project, subjects: { a: { ...TRACK, version: SUBJECT_TRACK_VERSION + 1 } } }, clip, FPS)).toBeNull()
    expect(followKeys({ ...project, assets: [{ ...project.assets[0], kind: 'image' }] }, clip, FPS)).toBeNull()
  })

  it('the canvas of the source’s own shape: no keys, the whole frame, and the note', () => {
    const { project, clip } = setup(TRACK, {}, { width: 1920, height: 1080 })
    const keys = followKeys(project, clip, FPS)!
    expect(isKeyed(keys)).toBe(false)
    expect(keys.cropX).toBeUndefined()
    expect(keys.cropY).toBeUndefined()
    expect(keys.halves).toBeUndefined()
    expect(keys.crop).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
    expect(keys.notes.some((n) => /nothing to follow/.test(n))).toBe(true)
  })
})

describe('followKeys — the stacked two-up', () => {
  it('every single shot keys the top half at (x, 0) and the bottom at (x, half.height); the two-up shot each half at its own', () => {
    const { project, clip } = setup(TRACK_2UP)
    const keys = followKeys(project, clip, FPS)!
    expect(keys.halves).toBeDefined()
    const { top, bottom } = PATH_2UP.shots[3].halves!
    const [into, outOf] = [exportSlot(289, clip, FPS), exportSlot(459, clip, FPS)]
    const lanes = (n: number): number[] => {
      const h = keys.halves!
      const roomX = W - 608
      const roomY = H - 540
      return [drawn(h.top.x, 0, n, FPS, roomX), drawn(h.top.y, 0, n, FPS, roomY), drawn(h.bottom.x, 0, n, FPS, roomX), drawn(h.bottom.y, 0, n, FPS, roomY)]
    }
    let singles = 0
    for (let n = 0; n < clip.duration; n++) {
      const [tx, ty, bx, by] = lanes(n)
      const at = followAt(keys, n)
      // The preview's reader is the export's text, rectangle for rectangle.
      expect(at.halves, `frame ${n}`).toEqual({
        top: { x: tx, y: ty, width: 608, height: 540 },
        bottom: { x: bx, y: by, width: 608, height: 540 }
      })
      if (n >= into && n < outOf) {
        expect([tx, ty, bx, by], `two-up frame ${n}`).toEqual([top.x, top.y, bottom.x, bottom.y])
      } else {
        expect([tx, ty, bx, by], `single frame ${n}`).toEqual([at.crop.x, 0, at.crop.x, 540])
        singles++
      }
    }
    expect(singles).toBeGreaterThan(400)
    // Held on each cut's frame, both ways, like the one crop.
    expect(lanes(into - 1)).toEqual([endOf(PATH_2UP.shots[2]), 0, endOf(PATH_2UP.shots[2]), 540])
    expect(lanes(into)).toEqual([top.x, top.y, bottom.x, bottom.y])
    expect(lanes(outOf - 1)).toEqual([top.x, top.y, bottom.x, bottom.y])
    expect(lanes(outOf)).toEqual([PATH_2UP.shots[4].at, 0, PATH_2UP.shots[4].at, 540])
  })

  it('a clip of that file that shows no two-up shot keeps the one crop', () => {
    const { project, clip } = setup(TRACK_2UP, { duration: 280 })
    const keys = followKeys(project, clip, FPS)!
    expect(keys.halves).toBeUndefined()
    expect(keys.cropX).toBeDefined()
  })
})

describe('followKeys — the memo', () => {
  it('includes speed: the same clip at 2× with the same length reads its own keys, not 1×’s', () => {
    const { project, clip } = setup(TRACK, { duration: 280 })
    const one = followKeys(project, clip, FPS)!
    expect(expectCutsOn(one, PATH, clip, FPS, (k) => exportSlot(k, clip, FPS))).toBe(2)
    const fast: Clip = { ...clip, speed: 2 }
    const two = followKeys({ ...project, clips: [fast] }, fast, FPS)!
    expect(expectCutsOn(two, PATH, fast, FPS, (k) => exportSlot(k, fast, FPS))).toBe(4)
  })

  it('a drag recorded at a shot’s own startMs moves that shot only, and every shot names its startMs as the track wrote it', () => {
    const { project, clip } = setup()
    const before = followKeys(project, clip, FPS)!
    expect(before.shots.map((s) => s.startMs)).toEqual(TRACK.shots.map((s) => s.startMs))
    const dragged: Clip = { ...clip, follow: { version: 2, offsets: { [before.shots[1].startMs]: 0.1 } } }
    const after = followKeys({ ...project, clips: [dragged] }, dragged, FPS)!
    for (const s of before.shots) {
      const n = Math.floor((s.from + s.to) / 2)
      if (s.index === 1) expect(drawnX(after, n)).toBe(drawnX(before, n) + 60)
      else expect(drawnX(after, n), `shot ${s.index + 1}`).toBe(drawnX(before, n))
    }
  })
})

describe('exportFrameAt — the measured rows', () => {
  const plain = { inPoint: 0, duration: 3000 }
  const tb30000 = { num: 1, den: 30000 }

  it('29.97 fps on a 30 fps project: frame 500 is a tie (t·30 = 500.5) and goes up, from its printed time or its pts', () => {
    expect(exportFrameAt(plain, 30, 16683.3)).toBe(501)
    expect(exportFrameAt(plain, 30, 0, { pts: 500500, timeBase: tb30000 })).toBe(501)
    // Frame 499 prints 16.65, which the printed time cannot tell from a tie; its pts can.
    expect(exportFrameAt(plain, 30, 0, { pts: 499499, timeBase: tb30000 })).toBe(499)
    // With an in-point of 7: the seek is subtracted in the stream's time base.
    expect(exportFrameAt({ ...plain, inPoint: 7 }, 30, 16683.3)).toBe(494)
    expect(exportFrameAt({ ...plain, inPoint: 7 }, 30, 0, { pts: 500500, timeBase: tb30000 })).toBe(494)
  })

  it('60 fps on 30: odd frames are ties — frame 11 prints 0.183333 and is on 6', () => {
    expect(exportFrameAt(plain, 30, 183.333)).toBe(6)
    expect(exportFrameAt(plain, 30, 0, { pts: 2816, timeBase: { num: 1, den: 15360 } })).toBe(6)
  })

  it('2×: frame 1 of a 30 fps file (printed 33.3333) is on 1 — trunc(512/2) = 256, t·30 = 0.5', () => {
    expect(exportFrameAt({ ...plain, speed: 2 }, 30, finderMs(1))).toBe(1)
    expect(exportFrameAt({ ...plain, speed: 2 }, 30, 0, { pts: 512, timeBase: { num: 1, den: 15360 } })).toBe(1)
    expect(exportFrameAt({ ...plain, speed: 2 }, 30, 0, { pts: 1001 * 3, timeBase: tb30000 })).toBe(2)
  })

  it('setpts truncates: at 2× on a 1/1000 time base (webm’s), pts 167 → 83, on frame 2 — not 83.5’s frame 3', () => {
    expect(exportFrameAt({ ...plain, speed: 2 }, 30, 0, { pts: 167, timeBase: { num: 1, den: 1000 } })).toBe(2)
    expect(exportFrameAt({ ...plain, speed: 2 }, 30, 0, { pts: 168, timeBase: { num: 1, den: 1000 } })).toBe(3)
  })

  it('past the print’s precision a near-tie is rounded as printed, not pushed up', () => {
    // 1234.583 s prints to the ms; ×30 = 37037.49 — under half, and the print cannot vouch for a tie.
    const ms = (37037.49 * 1000) / 30
    expect(printedPrecisionFrames(ms)).toBeGreaterThan(TIE_SLACK)
    expect(exportFrameAt(plain, 30, ms)).toBe(37037)
  })

  it('timelineFrameAt inverts sourceFrameFor at 1×, 2×, 0.5× and through a ramp — the preview’s mapping, landing on the frame whose source is the cut', () => {
    // On EXACT ms. On the finder's printed ms it floors 9633.33 to source 288 (the measured
    // "early" rows), and at 0.5× its frame is one before the export's — why keys use exportFrameAt.
    for (const patch of [{}, { speed: 2 }, { speed: 0.5 }, { ramp: { from: 1, to: 0.5 } }] as Partial<Clip>[]) {
      const c = { ...setup().clip, ...patch, duration: 500 }
      for (const k of CUTS) {
        const g = timelineFrameAt(c, (k * 1000) / FPS, FPS)!
        if (g >= c.start + c.duration) continue
        expect(sourceFrameFor(c, g), JSON.stringify(patch)).toBeGreaterThanOrEqual(k)
        expect(sourceFrameFor(c, g - 1), JSON.stringify(patch)).toBeLessThan(k)
      }
    }
  })
})

/** The `%.6g` print's half-unit at this time, in 30 fps frames. */
function printedPrecisionFrames(ms: number): number {
  const s = ms / 1000
  return 0.5 * Math.pow(10, Math.floor(Math.log10(s)) - 5) * 30
}

describe('cropX and cropY are the compiler’s, never a keyframe row’s', () => {
  it('are in neither KEYED_PROPERTIES nor MASK_PROPERTIES, and no keyframe surface names them', () => {
    for (const p of ['cropX', 'cropY'] as const) {
      expect(KEYED_PROPERTIES).not.toContain(p)
      expect(MASK_PROPERTIES).not.toContain(p)
    }
    for (const file of ['src/renderer/src/components/Keyframes.tsx', 'src/renderer/src/components/CurvePanel.tsx']) {
      const source = readFileSync(resolve(__dirname, '..', file), 'utf8')
      expect(source.length).toBeGreaterThan(500)
      expect(source.split('cropX').length - 1, file).toBe(0)
      expect(source.split('cropY').length - 1, file).toBe(0)
    }
  })
})
