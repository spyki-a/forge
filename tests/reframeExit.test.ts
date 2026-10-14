import { describe, expect, it } from 'vitest'
import { basename } from 'node:path'
import {
  EXIT_COLOURS,
  PULL_BATCH,
  exitBars,
  exitCuts,
  exitFolderName,
  exitPullArgs,
  exitSamples,
  exitSheetArgs,
  exitTable,
  scoreFollowedClip,
  scoreProject,
  type ExitRow
} from '@shared/reframe/exit'
import { exportFrameAt, followAt, followKeys, type FollowKeys } from '@shared/reframe/keys'
import { cropPath } from '@shared/reframe/path'
import { SUBJECT_TRACK_VERSION, type FaceBox, type SubjectSample, type SubjectTrack } from '@shared/reframe/types'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { printedMs } from './fixtures/reframe/track'

/*
 * docs/CLIPS.md §4.10: step 1's exit reader, on synthetic tracks — a
 * 1920×1080 file on a 9:16 canvas, faces placed in source px, cut times as
 * the shot finder prints them (tests/fixtures/reframe/track.ts `printedMs`),
 * two samples a second as the reduction keeps them. Where a case says what
 * the crop should be, it reads it from `followAt`, the export's own reader,
 * and holds the fixture to the geometry it relies on first.
 */

const FPS = 30
const W = 1920
const H = 1080
const CANVAS = { width: 1080, height: 1920 }
/** Source frames the shots cut on, and the file's length in frames. */
const CUTS = [95, 200]
const END = 300

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4
/** A face in source px: centre and side. */
function face(cx: number, cy = 400, side = 200): FaceBox {
  return { x: r4((cx - side / 2) / W), y: r4((cy - side / 2) / H), width: r4(side / W), height: r4(side / H), score: 0.9 }
}

interface Build {
  /** Each shot's faces at a sample, by shot index (0-based) and ms. */
  faces: (shot: number, ms: number) => FaceBox[]
  cuts?: number[]
  end?: number
  /** Samples added to the 2-a-second ones. */
  extra?: SubjectSample[]
}

function track(b: Build): SubjectTrack {
  const cuts = b.cuts ?? CUTS
  const end = b.end ?? END
  const durationMs = (end * 1000) / FPS
  const edges = [0, ...cuts.map((k) => printedMs(k / FPS)), durationMs]
  const shotOf = (ms: number): number => edges.slice(1, -1).filter((e) => e <= ms).length
  const samples: SubjectSample[] = []
  for (let ms = 0; ms < durationMs; ms += 500) samples.push({ ms, faces: b.faces(shotOf(ms), ms) })
  samples.push(...(b.extra ?? []))
  samples.sort((p, q) => p.ms - q.ms)
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
    at: '2026-10-14T00:00:00.000Z'
  }
}

/** One person a shot: x 500, 1500, 900 — every cut moves the crop. */
const FOLLOWED = track({ faces: (s) => [face([500, 1500, 900][s])] })

function setup(t: SubjectTrack, patch: Partial<Clip> = {}): { project: Project; clip: Clip } {
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
    start: 0,
    duration: END,
    inPoint: 0,
    volume: 1,
    transform: { ...DEFAULT_TRANSFORM },
    color: { ...DEFAULT_COLOR },
    follow: { version: 1 },
    ...patch
  }
  const base = emptyProject('exit')
  const project: Project = { ...base, settings: { ...base.settings, ...CANVAS, fps: FPS }, assets: [asset], clips: [clip], subjects: { a: t } }
  return { project, clip }
}

const keysOf = (project: Project, clip: Clip): FollowKeys => {
  const keys = followKeys(project, clip, FPS)
  if (!keys) throw new Error('the fixture does not follow')
  return keys
}

/** The samples of FOLLOWED: two a second over 10 s, all with a face. */
const SAMPLES = 20
/** Shot 1's samples: 0 … 3000 ms, before the cut at source frame 95 (3166.67 ms). */
const SHOT1_SAMPLES = 7

describe('a crop that follows its subject', () => {
  it('has every face inside and no crop held across a cut', () => {
    const { project, clip } = setup(FOLLOWED)
    const row = scoreFollowedClip(project, clip, FPS)!
    expect(row).toEqual({
      clipId: 'c',
      assetId: 'a',
      shots: 3,
      twoUp: 0,
      samplesWithFace: SAMPLES,
      inside: SAMPLES,
      insideShare: 1,
      heldAcrossCut: 0,
      cuts: 2,
      notes: []
    })
    // Both cuts move the crop, on the export's own frames for them.
    expect(exitCuts(project, clip, FPS)).toEqual([
      { shot: 1, frame: 95, moves: true, held: false, heldLanes: [] },
      { shot: 2, frame: 200, moves: true, held: false, heldLanes: [] }
    ])
    expect(exitBars(row)).toEqual({ inside: 'met', held: 'met' })
  })

  it('reads each face against followAt on the frame the export shows its moment on', () => {
    const { project, clip } = setup(FOLLOWED)
    const keys = keysOf(project, clip)
    for (const s of exitSamples(project, clip, FPS)) {
      expect(s.frame).toBe(exportFrameAt(clip, FPS, s.ms))
      expect(s.tests).toHaveLength(1)
      expect(s.tests[0].crop).toEqual(followAt(keys, s.frame).crop)
    }
  })
})

describe('a face outside the crop', () => {
  // Shot 1's held crop, solved on the face at 500, before any drag.
  const solved = (): number => {
    const { project, clip } = setup(FOLLOWED)
    return followAt(keysOf(project, clip), 0).crop.x
  }

  it('a drag that puts the subject outside the crop counts its samples outside', () => {
    const { project, clip } = setup(FOLLOWED, { follow: { version: 1, offsets: { 0: 1 } } })
    const crop = followAt(keysOf(project, clip), 0).crop
    // The premise: the whole face (400–600) is left of the dragged crop.
    expect(crop.x).toBe(solved() + crop.width)
    expect(crop.x).toBeGreaterThan(600)
    const row = scoreFollowedClip(project, clip, FPS)!
    expect(row.samplesWithFace).toBe(SAMPLES)
    expect(row.inside).toBe(SAMPLES - SHOT1_SAMPLES)
    expect(row.insideShare).toBeCloseTo((SAMPLES - SHOT1_SAMPLES) / SAMPLES, 12)
    expect(exitBars(row).inside).toBe('not met')
  })

  it('a face partly outside counts as outside', () => {
    // A drag of 0.4 of the crop: the crop's left edge lands inside the face.
    const { project, clip } = setup(FOLLOWED, { follow: { version: 1, offsets: { 0: 0.4 } } })
    const crop = followAt(keysOf(project, clip), 0).crop
    expect(crop.x, 'the premise: the edge cuts the face (400–600)').toBeGreaterThan(400)
    expect(crop.x).toBeLessThan(600)
    const row = scoreFollowedClip(project, clip, FPS)!
    expect(row.inside).toBe(SAMPLES - SHOT1_SAMPLES)
  })

  it('tests the largest face, not a smaller one beside it', () => {
    // One sample of shot 1 (1 of 7: under FACE_SHARE, a stray) also holds a smaller face far right.
    const t = track({ faces: (s, ms) => (s === 0 && ms === 1000 ? [face(500), face(1500, 400, 100)] : [face([500, 1500, 900][s])]) })
    const { project, clip } = setup(t)
    const stray = exitSamples(project, clip, FPS).find((s) => s.ms === 1000)!
    // The premise: the smaller face is outside the crop it would be held to.
    const crop = followAt(keysOf(project, clip), stray.frame).crop
    expect(1500 - 50).toBeGreaterThan(crop.x + crop.width)
    expect(stray.tests.map((x) => x.face.width)).toEqual([expect.closeTo(200, 0)])
    expect(scoreFollowedClip(project, clip, FPS)!.insideShare).toBe(1)
  })
})

describe('a stacked two-up', () => {
  // Shot 2 holds two people at x 384 and 1536, too far apart for one 608 px crop; one of its samples holds only the right one.
  // Shot 3's one face sits low (600–800): inside the one crop a single shot of a two-up clip keys, not inside its top half.
  const LEFT = { cx: 384, cy: 400 }
  const RIGHT = { cx: 1536, cy: 520 }
  const ONE_FACE_MS = 5000
  const LOW = 700
  const TWO_UP = track({
    faces: (s, ms) =>
      s === 1
        ? ms === ONE_FACE_MS
          ? [face(RIGHT.cx, RIGHT.cy, 150)]
          : [face(RIGHT.cx, RIGHT.cy, 150), face(LEFT.cx, LEFT.cy, 150)]
        : [face([500, 0, 900][s], s === 2 ? LOW : 400)]
  })
  /** Shot 2's samples: 3500 … 6500 ms. */
  const SHOT2 = [3500, 4000, 4500, 5000, 5500, 6000, 6500]

  it('holds each face inside its own half', () => {
    const { project, clip } = setup(TWO_UP)
    const row = scoreFollowedClip(project, clip, FPS)!
    expect(row.twoUp).toBe(1)
    expect(row.samplesWithFace).toBe(SAMPLES)
    expect(row.insideShare).toBe(1)
    expect(row.heldAcrossCut).toBe(0)
    const stacked = exitSamples(project, clip, FPS).filter((s) => s.twoUp)
    expect(stacked.map((s) => s.ms)).toEqual(SHOT2)
    const keys = keysOf(project, clip)
    for (const s of stacked) {
      const halves = followAt(keys, s.frame).halves!
      if (s.ms === ONE_FACE_MS) {
        // One face: the half it belongs to, the bottom (the right person's).
        expect(s.tests.map((x) => x.crop)).toEqual([halves.bottom])
      } else {
        // The left face against the top half, the right against the bottom.
        expect(s.tests.map((x) => x.crop)).toEqual([halves.top, halves.bottom])
        expect(s.tests[0].face.x + s.tests[0].face.width / 2).toBeCloseTo(LEFT.cx, 0)
      }
    }
    // The premise of the whole-crop mutation: the right face is outside the one crop on those frames.
    const at = followAt(keys, stacked[0].frame)
    expect(RIGHT.cx - 75).toBeGreaterThan(at.crop.x + at.crop.width)
    // Shot 3 is one crop drawn as two halves: its low face is held to that crop, which its top half alone would cut.
    const low = exitSamples(project, clip, FPS).filter((s) => s.shot === 2)
    expect(low.length).toBeGreaterThan(0)
    for (const s of low) {
      expect(s).toMatchObject({ twoUp: false, inside: true })
      expect(s.tests[0].crop).toEqual(followAt(keys, s.frame).crop)
      expect(LOW + 100, 'the premise: below the top half').toBeGreaterThan(followAt(keys, s.frame).halves!.top.height)
    }
  })

  it('a cut where one half steps and the other keeps the old shot’s place is held', () => {
    const { project, clip } = setup(TWO_UP)
    const keys = keysOf(project, clip)
    const halves = keys.halves!
    expect(exitCuts(project, clip, FPS)[0], 'the premise: both halves move on the cut, and land').toEqual({
      shot: 1, frame: 95, moves: true, held: false, heldLanes: []
    })
    // The bottom half's x step put a frame late, on 96: on the cut's frame only the top half has moved.
    const steps = halves.bottom.x.terms.filter((term) => 'atFrame' in term && term.atFrame === 95)
    expect(steps, 'the premise: one bottom-x step on the cut').toHaveLength(1)
    const late: FollowKeys = {
      ...keys,
      halves: {
        ...halves,
        bottom: { ...halves.bottom, x: { base: halves.bottom.x.base, terms: halves.bottom.x.terms.map((term) => (steps.includes(term) ? { ...term, atFrame: 96 } : term)) } }
      }
    }
    const before = followAt(late, 94).halves!
    const on = followAt(late, 95).halves!
    expect(on.top.x, 'the premise: the top half moves on the cut').not.toBe(before.top.x)
    expect(on.bottom.x, 'the premise: the bottom half does not').toBe(before.bottom.x)
    expect(followAt(late, 96).halves!.bottom.x, 'the premise: it moves a frame late').not.toBe(before.bottom.x)
    expect(exitCuts(project, clip, FPS, late)[0]).toEqual({ shot: 1, frame: 95, moves: true, held: true, heldLanes: ['bottom x'] })
    const row = scoreFollowedClip(project, clip, FPS, late)!
    expect(row.heldAcrossCut).toBe(1)
    expect(exitBars(row).held).toBe('not met')
  })

  it('with the halves swapped, both faces of a two-face sample are outside', () => {
    const { project, clip } = setup(TWO_UP)
    const keys = keysOf(project, clip)
    // The path mutated: each half's x lane the other's (the y lanes kept, so a one-crop frame stays one crop).
    const halves = keys.halves!
    const swapped: FollowKeys = {
      ...keys,
      halves: { top: { x: halves.bottom.x, y: halves.top.y }, bottom: { x: halves.top.x, y: halves.bottom.y } }
    }
    const samples = exitSamples(project, clip, FPS, swapped).filter((s) => s.twoUp && s.ms !== ONE_FACE_MS)
    expect(samples).toHaveLength(SHOT2.length - 1)
    for (const s of samples) expect(s.tests.map((x) => x.inside)).toEqual([false, false])
    const row = scoreFollowedClip(project, clip, FPS, swapped)!
    expect(row.inside).toBe(SAMPLES - (SHOT2.length - 1))
  })
})

describe('which samples count', () => {
  it('a sample with no face, or with a box that is not a box, is not counted', () => {
    // Shot 2 keeps 5 of its 7 samples with a face (above FACE_SHARE: still a face shot); one more holds a null box (a JSON NaN).
    const blank = new Set([4000, 4500])
    const t = track({
      faces: (s, ms) =>
        blank.has(ms) ? [] : ms === 6000 ? [{ ...face(1500), x: null as unknown as number }] : [face([500, 1500, 900][s])]
    })
    const { project, clip } = setup(t)
    const row = scoreFollowedClip(project, clip, FPS)!
    expect(row.samplesWithFace).toBe(SAMPLES - 3)
    expect(row.inside).toBe(SAMPLES - 3)
    expect(row.insideShare).toBe(1)
    expect(exitSamples(project, clip, FPS).map((s) => s.ms)).not.toEqual(expect.arrayContaining([4000]))
  })

  it('no face anywhere: the share is null, and the bar says so', () => {
    const { project, clip } = setup(track({ faces: () => [] }))
    const row = scoreFollowedClip(project, clip, FPS)!
    expect(row.samplesWithFace).toBe(0)
    expect(row.insideShare).toBeNull()
    expect(exitBars(row).inside).toBe('no face found')
  })

  it('a clip whose in-point is past the first cut ignores the first shot’s samples', () => {
    // In-point 120: shot 1 (to frame 95) is not in the clip, and neither are the samples before 4000 ms.
    const { project, clip } = setup(FOLLOWED, { inPoint: 120, duration: END - 120 })
    const row = scoreFollowedClip(project, clip, FPS)!
    expect(row.shots).toBe(2)
    expect(row.cuts).toBe(1)
    const kept = exitSamples(project, clip, FPS).map((s) => s.ms)
    expect(kept[0]).toBe(4000)
    expect(row.samplesWithFace).toBe(SAMPLES - 8)
    expect(row.insideShare).toBe(1)
  })

  it('a clip whose in-point is inside the first shot skips the samples before it', () => {
    // In-point 45 (1500 ms): shot 1 is on screen, its samples at 0, 500 and 1000 ms are not.
    const { project, clip } = setup(FOLLOWED, { inPoint: 45, duration: END - 45 })
    expect(keysOf(project, clip).shots[0]).toMatchObject({ index: 0, from: 0 })
    const row = scoreFollowedClip(project, clip, FPS)!
    expect(exitSamples(project, clip, FPS)[0]).toMatchObject({ ms: 1500, frame: 0 })
    expect(row.samplesWithFace).toBe(SAMPLES - 3)
  })

  it('a clip that ends inside a shot skips the samples after its last frame', () => {
    // Out-point 150 (5000 ms), inside shot 2 (frames 95–200): its samples at 5000 … 6500 ms are past the clip's last frame.
    const { project, clip } = setup(FOLLOWED, { duration: 150 })
    const keys = keysOf(project, clip)
    expect(keys.shots.map((s) => [s.index, s.from, s.to]), 'the premise: shot 2 is on screen to the clip’s end').toEqual([[0, 0, 95], [1, 95, 150]])
    expect(exportFrameAt(clip, FPS, 5000), 'the premise: 5000 ms is the frame after the last').toBe(150)
    const kept = exitSamples(project, clip, FPS).map((s) => s.ms)
    expect(kept).toEqual(Array.from({ length: 10 }, (_, i) => i * 500))
    expect(scoreFollowedClip(project, clip, FPS)!.samplesWithFace).toBe(10)
  })

  it('a shot with no frame in the clip: its samples are never on screen', () => {
    // At 2×, cuts at source frames 95 and 96 both land on clip frame 48: shot 2 is one source frame, shown on none.
    const t = track({
      cuts: [95, 96],
      faces: (s) => [face([1500, 500, 1500][s])],
      extra: [{ ms: 3180, faces: [face(500)] }]
    })
    const { project, clip } = setup(t, { speed: 2, duration: END / 2 })
    const keys = keysOf(project, clip)
    expect(keys.shots.map((s) => s.index), 'the premise: shot 2 is not shown').toEqual([0, 2])
    expect(exportFrameAt(clip, FPS, 3180), 'the premise: its sample lands inside the clip').toBe(48)
    const row = scoreFollowedClip(project, clip, FPS)!
    expect(exitSamples(project, clip, FPS).map((s) => s.ms)).not.toContain(3180)
    expect(row.insideShare).toBe(1)
  })

  it('a sample labelled within a frame before a cut is read on its own shot’s last frame', () => {
    // 3160 ms is in shot 1 (the cut is 3166.67), but rounds to the cut's frame, 95.
    const t = track({ faces: (s) => [face([500, 1500, 900][s])], extra: [{ ms: 3160, faces: [face(500)] }] })
    const { project, clip } = setup(t)
    expect(exportFrameAt(clip, FPS, 3160), 'the premise: it rounds onto the cut').toBe(95)
    const s = exitSamples(project, clip, FPS).find((x) => x.ms === 3160)!
    expect(s).toMatchObject({ frame: 94, shot: 0, inside: true })
    expect(scoreFollowedClip(project, clip, FPS)!.insideShare).toBe(1)
  })
})

describe('a crop held across a cut', () => {
  it('a cut whose held key is missing is counted', () => {
    const { project, clip } = setup(FOLLOWED)
    const keys = keysOf(project, clip)
    // The first cut's step dropped by hand: the crop on frame 95 is still frame 94's.
    const steps = keys.cropX!.terms.filter((term) => 'atFrame' in term && term.atFrame === 95)
    expect(steps, 'the premise: one step on the cut').toHaveLength(1)
    const broken: FollowKeys = { ...keys, cropX: { base: keys.cropX!.base, terms: keys.cropX!.terms.filter((term) => !steps.includes(term)) } }
    expect(exitCuts(project, clip, FPS, broken)).toEqual([
      { shot: 1, frame: 95, moves: true, held: true, heldLanes: ['crop'] },
      { shot: 2, frame: 200, moves: true, held: false, heldLanes: [] }
    ])
    const row = scoreFollowedClip(project, clip, FPS, broken)!
    expect(row.heldAcrossCut).toBe(1)
    expect(exitBars(row).held).toBe('not met')
  })

  it('a cut where the path does not move is not held', () => {
    // Shots 1 and 2 frame the same face at the same place: no step is needed.
    const { project, clip } = setup(track({ faces: (s) => [face([500, 500, 900][s])] }))
    expect(exitCuts(project, clip, FPS)[0]).toEqual({ shot: 1, frame: 95, moves: false, held: false, heldLanes: [] })
    expect(scoreFollowedClip(project, clip, FPS)!.heldAcrossCut).toBe(0)
  })

  it('a shot that pans onto the next shot’s place needs no step there', () => {
    // Shot 1 (to frame 200) starts on a face at 500 that moves to 1000; shot 2 frames a face at 1000.
    const t = track({ cuts: [200], faces: (s, ms) => [face(s === 0 && ms < 1500 ? 500 : 1000)] })
    const { project, clip } = setup(t)
    const path = cropPath(t, CANVAS, {})
    const pans = path.shots[0].pans
    expect(pans.length, 'the premise: shot 1 pans').toBeGreaterThan(0)
    expect(pans[pans.length - 1].to, 'the premise: onto shot 2’s place').toBe(path.shots[1].at)
    expect(path.shots[0].at).not.toBe(path.shots[1].at)
    expect(exitCuts(project, clip, FPS)).toEqual([{ shot: 1, frame: 200, moves: false, held: false, heldLanes: [] }])
  })
})

describe('the rows', () => {
  it('one a followed clip, in timeline order; a followed clip with no track is a row of zeros with a note', () => {
    const { project } = setup(FOLLOWED)
    const base = project.clips[0]
    const p: Project = {
      ...project,
      assets: [...project.assets, { ...project.assets[0], id: 'b', path: '/media/other.mp4', name: 'other.mp4' }],
      clips: [
        { ...base, id: 'late', start: 400 },
        { ...base, id: 'plain', start: 100, follow: undefined },
        { ...base, id: 'early', start: 0 },
        { ...base, id: 'orphan', assetId: 'b', start: 200 }
      ]
    }
    const rows = scoreProject(p, FPS)
    expect(rows.map((r) => r.clipId)).toEqual(['early', 'orphan', 'late'])
    expect(rows[1]).toMatchObject({ shots: 0, samplesWithFace: 0, insideShare: null, cuts: 0 })
    expect(rows[1].notes[0]).toMatch(/no subject track/)
    expect(exitBars(rows[1])).toEqual({ inside: 'not scored', held: 'not scored' })
    expect(scoreFollowedClip(p, p.clips[1], FPS)).toBeNull()
  })

  it('marks the bars at exactly 95 % and exactly 0, and leaves the rating column empty', () => {
    const row = (insideShare: number | null, heldAcrossCut: number): ExitRow => ({
      clipId: 'c', assetId: 'a', shots: 3, twoUp: 0, samplesWithFace: 100, inside: 95, insideShare, heldAcrossCut, cuts: 2, notes: []
    })
    expect(exitBars(row(0.95, 0))).toEqual({ inside: 'met', held: 'met' })
    expect(exitBars(row(0.949, 1))).toEqual({ inside: 'not met', held: 'not met' })
    const lines = exitTable([{ name: 'talk.mp4', row: row(0.95, 0) }])
    const cellsOf = (line: string): string[] => line.split('|').slice(1, -1).map((c) => c.trim())
    expect(cellsOf(lines[0])).toEqual([
      '#', 'clip', 'shots', 'two-up shots', 'samples with a face', 'inside share', 'held across a cut', 'inside ≥ 95 %', '0 held', 'rating (1–5)'
    ])
    // The rating is the user's: a column, empty.
    expect(cellsOf(lines[2])).toEqual(['1', 'talk.mp4', '3', '0', '100', '95.0 % (95)', '0 of 2', 'met', 'met', ''])
  })
})

describe('the runner’s ffmpeg, as argv', () => {
  it('pulls on the export’s own input, retime and clock, then selects the clip frames', () => {
    const { project, clip } = setup(FOLLOWED, { inPoint: 6, duration: 200 })
    const args = exitPullArgs(clip, project.assets[0], FPS, keysOf(project, clip), [96, 94, 95, 94], '/out/%05d.png')
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-i') + 2)).toEqual(['-ss', '0.200000', '-t', '6.666667', '-i', '/media/talk.mp4'])
    expect(args[args.indexOf('-vf') + 1]).toBe("fps=30:start_time=0,select='eq(n,94)+eq(n,95)+eq(n,96)'")
    expect(args.slice(-5)).toEqual(['-vsync', '0', '-frames:v', '3', '/out/%05d.png'])
    // At 2× the retime comes first, as the render's chain has it.
    const fast = { ...clip, speed: 2, duration: 100 }
    const vf = exitPullArgs(fast, project.assets[0], FPS, followKeys(project, fast, FPS), [10], '/o/%05d.png')
    expect(vf[vf.indexOf('-vf') + 1]).toBe("setpts=PTS/2,fps=30,fps=30:start_time=0,select='eq(n,10)'")
    expect(() => exitPullArgs(clip, project.assets[0], FPS, null, [200], '/o/%05d.png')).toThrow(/frame of the clip/)
    expect(() => exitPullArgs(clip, project.assets[0], FPS, null, Array.from({ length: PULL_BATCH + 1 }, (_, i) => i), '/o/%05d.png')).toThrow()
  })

  it('draws each panel’s boxes, scales, and stacks the panels side by side', () => {
    const panel = (file: string) => ({
      file,
      size: { width: 1920, height: 1080 },
      boxes: [{ rect: { x: 198, y: 0, width: 606, height: 1080 }, colour: EXIT_COLOURS.crop }, { rect: { x: 400.4, y: 299.6, width: 200, height: 200 }, colour: EXIT_COLOURS.face }]
    })
    const args = exitSheetArgs([panel('a.png'), panel('b.png'), panel('c.png')], 'sheet.png')
    const graph = args[args.indexOf('-filter_complex') + 1]
    expect(graph.split(';')).toEqual([
      '[0:v]drawbox=x=198:y=0:w=606:h=1080:color=0xFF0000:t=6,drawbox=x=400:y=300:w=200:h=200:color=0x00FF00:t=6,scale=-2:540[s0]',
      expect.stringMatching(/^\[1:v\]drawbox=.*\[s1\]$/),
      expect.stringMatching(/^\[2:v\]drawbox=.*\[s2\]$/),
      '[s0][s1][s2]hstack=inputs=3'
    ])
    expect(args.filter((a) => a === '-i')).toHaveLength(3)
    const one = exitSheetArgs([panel('a.png')], 'one.png')
    expect(one[one.indexOf('-filter_complex') + 1]).not.toMatch(/hstack|\[s0\]/)
  })

  it('names a clip’s folder so both platforms take it', () => {
    for (const name of ['Bride 5:30pm.mp4', '100% the day.mov', 'a<b>"c"|d?*.mp4', 'CON.mp4', 'talk.']) {
      const folder = basename(exitFolderName(3, name))
      expect(folder, name).toMatch(/^3-/)
      expect(folder, name).not.toMatch(/[<>:"/\\|?*%]/)
      expect(folder, name).not.toMatch(/[. ]$/)
    }
    expect(exitFolderName(1, 'talk.mp4')).toBe('1-talk')
  })
})
