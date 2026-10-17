import { describe, expect, it } from 'vitest'
import {
  BETTER_BY,
  CHIN_EXTENSION,
  MIN_SAMPLES_TO_DISCOUNT,
  OVERLAP_LIMIT,
  PERCENTILE,
  captionThirds,
  chooseThird,
  overlapByThird,
  shotOverlap,
  styleThird,
  thirdAt,
  type Third
} from '@shared/reframe/freeSpace'
import { followKeys } from '@shared/reframe/keys'
import { SUBJECT_TRACK_VERSION, type SubjectSample, type SubjectTrack, type UnitRect } from '@shared/reframe/types'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'

/*
 * docs/CLIPS.md §5.2 and §5.5: which third the captions take, one choice
 * per shot. Most cases use a file of the canvas's own shape with nothing
 * cropped, so a face's SOURCE units are its FRAME units and every overlap
 * below is plain arithmetic: a face w wide whose extended height (×1.5) is
 * e, wholly inside a third, covers w·e·3 of it.
 */

const FPS = 30
const PORTRAIT = { width: 1080, height: 1920 }
const BOTTOM = { position: 'bottom' as const }

interface Build {
  /** Each cut's ms. */
  cutsMs?: number[]
  endMs: number
  /** A sample's faces, in unit coordinates of the file, by shot and ms (and the sample's index in its shot). */
  faces: (shot: number, ms: number, i: number) => UnitRect[]
  keep?: (ms: number) => boolean
  width?: number
  height?: number
}

function track(b: Build): SubjectTrack {
  const cuts = b.cutsMs ?? []
  const edges = [0, ...cuts, b.endMs]
  const shotOf = (ms: number): number => cuts.filter((c) => c <= ms).length
  const samples: SubjectSample[] = []
  const seen = new Map<number, number>()
  for (let ms = 0; ms < b.endMs; ms += 500) {
    if (b.keep && !b.keep(ms)) continue
    const shot = shotOf(ms)
    const i = seen.get(shot) ?? 0
    seen.set(shot, i + 1)
    samples.push({ ms, faces: b.faces(shot, ms, i).map((f) => ({ ...f, score: 0.9 })) })
  }
  return {
    key: '123456:1700000000000',
    version: SUBJECT_TRACK_VERSION,
    width: b.width ?? 1080,
    height: b.height ?? 1920,
    durationMs: b.endMs,
    shots: edges.slice(0, -1).map((startMs, i) => ({ startMs, endMs: edges[i + 1], score: i ? 0.9 : 0 })),
    samples,
    perShot: edges.slice(0, -1).map(() => ({})),
    detector: 'synthetic',
    scene: { threshold: 0.3, minShotMs: 500, backend: 'ffmpeg-select-rgb24' },
    at: '2026-10-16T00:00:00.000Z'
  }
}

function asset(id: string, width = 1080, height = 1920, frames = 600): MediaAsset {
  return { id, path: `/media/${id}.mp4`, name: `${id}.mp4`, kind: 'video', durationFrames: frames, width, height, fps: FPS, hasVideo: true, hasAudio: true, size: 1 }
}

function clipOf(id: string, assetId: string, start: number, duration: number, patch: Partial<Clip> = {}): Clip {
  return { id, assetId, trackId: 'v1', start, duration, inPoint: 0, volume: 1, transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR }, ...patch }
}

/** One clip of the whole file, from frame 30, on the canvas's own shape. */
function oneClip(t: SubjectTrack | null, patch: Partial<Clip> = {}, canvas = PORTRAIT): { project: Project; clip: Clip } {
  const frames = Math.round(((t?.durationMs ?? 3000) * FPS) / 1000)
  const a = asset('a', t?.width ?? 1080, t?.height ?? 1920, frames)
  const clip = clipOf('c', 'a', 30, frames, patch)
  const base = emptyProject('free space')
  return { project: { ...base, settings: { ...base.settings, ...canvas, fps: FPS }, assets: [a], clips: [clip], subjects: t ? { a: t } : {} }, clip }
}

/** A face, in unit coordinates, whose EXTENDED box covers `share` of the third it sits in: width w, extended height share/(3w). */
function faceCovering(share: number, x: number, y: number, w = 0.1): UnitRect {
  return { x, y, width: w, height: share / (3 * w) / (1 + CHIN_EXTENSION) }
}

/** The thirds of a one-shot clip whose every sample holds `faces`. */
function thirdsOf(faces: UnitRect[], style: { position: 'top' | 'center' | 'bottom' } = BOTTOM): Third[] {
  const { project } = oneClip(track({ endMs: 3000, faces: () => faces }))
  return captionThirds(project, style, PORTRAIT).map((t) => t.third)
}

describe('overlapByThird', () => {
  it('one box across two thirds counts in each by its share of that third', () => {
    // y 0.5..0.8, 0.5 wide: 1/6 of it in the middle third, 2/15 in the bottom.
    const o = overlapByThird([{ x: 0, y: 0.5, width: 0.5, height: 0.3 }])
    expect(o.top).toBe(0)
    expect(o.middle).toBeCloseTo(0.25, 12)
    expect(o.bottom).toBeCloseTo(0.2, 12)
  })

  it('two boxes that overlap count their union, once', () => {
    // 0.08 + 0.06 with 0.02 in common: 0.12 of the frame, 0.36 of the third (a sum would say 0.42).
    const a = { x: 0.1, y: 0.7, width: 0.4, height: 0.2 }
    const b = { x: 0.3, y: 0.8, width: 0.4, height: 0.15 }
    expect(overlapByThird([a, b]).bottom).toBeCloseTo(0.36, 12)
    expect(overlapByThird([a, a]).bottom).toBeCloseTo(overlapByThird([a]).bottom, 12)
    // Side by side, apart: their sum.
    const c = { x: 0.6, y: 0.7, width: 0.2, height: 0.2 }
    expect(overlapByThird([a, c]).bottom).toBeCloseTo(0.36, 12)
  })

  it('a box hanging off the frame counts only the part on it; nothing covers nothing', () => {
    expect(overlapByThird([{ x: -0.2, y: 0.9, width: 0.4, height: 0.3 }]).bottom).toBeCloseTo(0.06, 12)
    expect(overlapByThird([])).toEqual({ top: 0, middle: 0, bottom: 0 })
  })
})

describe('the choice (§5.2 rules 1 and 2)', () => {
  it('names its constants', () => {
    expect([OVERLAP_LIMIT, BETTER_BY, PERCENTILE, CHIN_EXTENSION]).toEqual([0.05, 0.5, 0.9, 0.5])
    expect(styleThird({ position: 'bottom' })).toBe('bottom')
    expect(styleThird({ position: 'center' })).toBe('middle')
    expect(styleThird({ position: 'top' })).toBe('top')
  })

  it('rule 1: the style’s third stands at 0.04 and is left at 0.06', () => {
    expect(chooseThird({ top: 0, middle: 0, bottom: 0.04 }, 'bottom')).toBe('bottom')
    expect(chooseThird({ top: 0, middle: 0, bottom: 0.06 }, 'bottom')).toBe('middle')
    // Through the whole chooser: a face low in the frame, extended, covering 0.04 and 0.06 of the lower third.
    expect(thirdsOf([faceCovering(0.04, 0.45, 0.7)])).toEqual(['bottom'])
    expect(thirdsOf([faceCovering(0.06, 0.45, 0.7)])).toEqual(['middle'])
  })

  it('rule 2’s hysteresis: the best third at 0.04 against the style’s 0.06 is not 50 % better and does not win; at 0.02 it does', () => {
    expect(chooseThird({ top: 0.04, middle: 0.07, bottom: 0.06 }, 'bottom')).toBe('bottom')
    expect(chooseThird({ top: 0.02, middle: 0.07, bottom: 0.06 }, 'bottom')).toBe('top')
    // Through the whole chooser: one face low (0.06 of the lower third) and one across the top and middle thirds,
    // its extended box 0.16 wide and 0.2 tall — from y 0.25 it covers 0.04 of the top and 0.056 of the middle; from y 0.2917, 0.02 and 0.076.
    const low = faceCovering(0.06, 0.45, 0.7)
    const high = (y: number): UnitRect => ({ x: 0.7, y, width: 0.16, height: 0.2 / (1 + CHIN_EXTENSION) })
    expect(thirdsOf([low, high(0.25)])).toEqual(['bottom'])
    expect(thirdsOf([low, high(1 / 3 - 0.125 / 3)])).toEqual(['top'])
  })

  it('a tie goes to the third nearer the style’s', () => {
    expect(chooseThird({ top: 0, middle: 0, bottom: 0.3 }, 'bottom')).toBe('middle')
    expect(chooseThird({ top: 0.3, middle: 0, bottom: 0 }, 'top')).toBe('middle')
    expect(chooseThird({ top: 0, middle: 0.3, bottom: 0 }, 'middle')).toBe('bottom')
  })
})

describe('captionThirds', () => {
  it('one choice per shot: a box jittering in the lower third with one gesture into the middle keeps the choice it has without the gesture', () => {
    // Ten samples over a 5 s shot; the face jitters a hundredth either way, and the fifth sample raises it into the middle third.
    const low = (i: number): UnitRect => ({ x: 0.35, y: 0.7 + 0.01 * ((i % 3) - 1), width: 0.3, height: 0.15 })
    const raised: UnitRect = { x: 0.35, y: 0.4, width: 0.3, height: 0.15 }
    const steady = oneClip(track({ endMs: 5000, faces: (_s, _ms, i) => [low(i)] }))
    const gesture = oneClip(track({ endMs: 5000, faces: (_s, _ms, i) => [i === 4 ? raised : low(i)] }))
    const a = captionThirds(steady.project, BOTTOM, PORTRAIT)
    const b = captionThirds(gesture.project, BOTTOM, PORTRAIT)
    // The premise: the steady shot leaves the lower third for the middle.
    expect(a).toEqual([{ startFrame: 30, endFrame: 180, third: 'middle' }])
    // One entry for the shot, and the gesture does not move it (its one sample in ten is under the 90th percentile).
    expect(b).toEqual(a)
    expect(gesture.project.subjects!.a.samples).toHaveLength(10)
  })

  it('the percentile is over the shot’s samples: nearest rank, one in ten is under it and two in ten are not', () => {
    const ten = (n: number): { top: number; middle: number; bottom: number }[] =>
      Array.from({ length: 10 }, (_, i) => ({ top: 0, middle: i < n ? 0.3 : 0, bottom: 0.2 }))
    expect(shotOverlap(ten(1)).middle).toBe(0)
    expect(shotOverlap(ten(2)).middle).toBe(0.3)
    expect(shotOverlap(ten(1)).bottom).toBe(0.2)
  })

  it('a shot under 5 s: one gesture never decides a shot of three samples or more, and two do', () => {
    // Below ten samples the 90th percentile by nearest rank IS the highest sample, so one lean decided every
    // shot under 5 s — short shots being the norm in a short-form edit. From three samples the highest is never taken alone.
    const of = (length: number, raised: number): { top: number; middle: number; bottom: number }[] =>
      Array.from({ length }, (_, i) => ({ top: 0, middle: 0, bottom: i < raised ? 0.2 : 0 }))
    expect(MIN_SAMPLES_TO_DISCOUNT).toBe(3)
    for (let n = 3; n <= 9; n++) {
      expect(shotOverlap(of(n, 1)).bottom, `${n} samples, one raised`).toBe(0)
      expect(shotOverlap(of(n, 2)).bottom, `${n} samples, two raised`).toBe(0.2)
    }
    // One or two samples say too little to call one a gesture: the higher stands, and the caption keeps off it.
    expect(shotOverlap(of(1, 1)).bottom).toBe(0.2)
    expect(shotOverlap(of(2, 1)).bottom).toBe(0.2)

    // Through the whole chooser: Pop at the bottom, the face calm in the upper third, and in one sample of a
    // shot it leans into the lower third (extended, 0.2025 of it). 1.5 s to 4.5 s: three to nine samples.
    const calm: UnitRect = { x: 0.35, y: 0.05, width: 0.3, height: 0.15 }
    const lean: UnitRect = { x: 0.35, y: 0.7, width: 0.3, height: 0.15 }
    for (const endMs of [1500, 2000, 3000, 4000, 4500]) {
      const once = oneClip(track({ endMs, faces: (_s, ms) => [ms === 1000 ? lean : calm] }))
      expect(once.project.subjects!.a.samples.length, `${endMs} ms`).toBe(endMs / 500)
      expect(captionThirds(once.project, BOTTOM, PORTRAIT).map((t) => t.third), `a ${endMs} ms shot, one lean`).toEqual(['bottom'])
      // Two leaning samples are not a gesture: the caption moves off them.
      const twice = oneClip(track({ endMs, faces: (_s, ms) => [ms === 500 || ms === 1000 ? lean : calm] }))
      expect(captionThirds(twice.project, BOTTOM, PORTRAIT).map((t) => t.third), `a ${endMs} ms shot, two leans`).toEqual(['middle'])
    }
  })

  it('the downward extension: a face just above the lower third “fits” without it, and with it the caption moves', () => {
    // y 0.45..0.65: clear of the lower third (2/3) as detected; with its chin and mouth, 0.45..0.75.
    const face = { x: 0.35, y: 0.45, width: 0.3, height: 0.2 }
    expect(overlapByThird([face]).bottom).toBe(0)
    expect(overlapByThird([face]).top).toBe(0)
    expect(thirdsOf([face])).toEqual(['top'])
  })

  it('a line that spans a cut takes the shot where it starts', () => {
    // Shot 0 (0–3 s) has the face in the lower third; shot 1 (3–6 s) has it in the top third. The cut is clip frame 90, project frame 120.
    const t = track({
      cutsMs: [3000],
      endMs: 6000,
      faces: (shot) => [shot === 0 ? { x: 0.35, y: 0.7, width: 0.3, height: 0.15 } : { x: 0.35, y: 0.05, width: 0.3, height: 0.15 }]
    })
    const { project } = oneClip(t)
    const thirds = captionThirds(project, BOTTOM, PORTRAIT)
    expect(thirds).toEqual([
      { startFrame: 30, endFrame: 120, third: 'middle' },
      { startFrame: 120, endFrame: 210, third: 'bottom' }
    ])
    // A line on frames 100–140: it starts in shot 0 and takes shot 0's third, though it ends in shot 1.
    const line = { startFrame: 100, endFrame: 140 }
    expect(thirdAt(thirds, line.startFrame)).toBe('middle')
    expect(thirdAt(thirds, line.endFrame)).toBe('bottom')
    // Off the caption track's clips: no answer, and the caller keeps the style's.
    expect(thirdAt(thirds, 10)).toBeNull()
    expect(thirdAt(thirds, 210)).toBeNull()
  })

  it('a shot with no track keeps the style’s position: a clip without one, and a shot no sample reaches', () => {
    // Clip c1 has a track with the face low; c2 is another file, with none.
    const t = track({ endMs: 3000, faces: () => [{ x: 0.35, y: 0.7, width: 0.3, height: 0.15 }] })
    const base = emptyProject('free space')
    const project: Project = {
      ...base,
      settings: { ...base.settings, ...PORTRAIT, fps: FPS },
      assets: [asset('a', 1080, 1920, 90), asset('b', 1080, 1920, 90)],
      clips: [clipOf('c1', 'a', 0, 90), clipOf('c2', 'b', 90, 90)],
      subjects: { a: t }
    }
    for (const position of ['top', 'center', 'bottom'] as const) {
      const thirds = captionThirds(project, { position }, PORTRAIT)
      expect(thirds[1]).toEqual({ startFrame: 90, endFrame: 180, third: styleThird({ position }) })
    }
    expect(captionThirds(project, BOTTOM, PORTRAIT)[0].third).toBe('middle')

    // Shot 1 (3–6 s) has no sample at all: the style's, where shot 0, the same face, moves.
    const sparse = track({ cutsMs: [3000], endMs: 6000, keep: (ms) => ms < 3000, faces: () => [{ x: 0.35, y: 0.7, width: 0.3, height: 0.15 }] })
    expect(captionThirds(oneClip(sparse).project, BOTTOM, PORTRAIT).map((t) => t.third)).toEqual(['middle', 'bottom'])
    // A track measured on another size of file is no track.
    const wrong = { ...t, width: 720, height: 1280 }
    const other = oneClip(t)
    expect(captionThirds({ ...other.project, subjects: { a: wrong } }, BOTTOM, PORTRAIT).map((x) => x.third)).toEqual(['bottom'])
  })

  it('a followed clip: one entry per shot the clip shows, on the frames its crop steps on', () => {
    // 1920×1080 on 9:16: the crop is the file's full height, so a face's y is its frame y. Shot 0's face low (y 700–900), shot 1's high (200–400).
    const W = 1920
    const H = 1080
    const t = track({
      width: W,
      height: H,
      cutsMs: [3166.67],
      endMs: 6000,
      faces: (shot) => [shot === 0 ? { x: 400 / W, y: 700 / H, width: 200 / W, height: 200 / H } : { x: 1400 / W, y: 200 / H, width: 200 / W, height: 200 / H }]
    })
    const { project, clip } = oneClip(t, { follow: { version: 1 }, inPoint: 15, duration: 150 })
    const keys = followKeys(project, clip, FPS)!
    expect(keys.shots.map((s) => [s.from, s.to])).toEqual([[0, 80], [80, 150]])
    const thirds = captionThirds(project, BOTTOM, PORTRAIT)
    expect(thirds).toEqual([
      { startFrame: 30, endFrame: 110, third: 'top' },
      { startFrame: 110, endFrame: 180, third: 'bottom' }
    ])
  })
})
