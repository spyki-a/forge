import { describe, expect, it } from 'vitest'
import { checkSubjectTrack, cleanFace, reduceTrack } from '@shared/reframe/reduce'
import { REDUCE } from '@shared/reframe/job'
import { SUBJECT_TRACK_VERSION, type FaceBox, type Shot, type SubjectTrack } from '@shared/reframe/types'
import { FACES_TRACK_VERSION, type FacesTrack } from '@shared/sidecar/protocol'

/*
 * The face finder's 5-a-second track down to the project's 2 a second, the
 * two largest faces (docs/CLIPS.md §4.3; shared/reframe/reduce.ts). Made-up
 * samples, each face's x carrying the ms of the frame it came from, so a
 * sample picked from the wrong tick, or a box averaged from two, shows as a
 * number no frame had.
 */

/** A face whose x names its frame: x = ms / 100,000 (a 6 s track stays under 0.06). */
const tagged = (ms: number, width = 0.1, score = 0.9): FaceBox => ({ x: ms / 100_000, y: 0.2, width, height: 0.2, score })
const msOfFace = (f: FaceBox): number => Math.round(f.x * 100_000)

/** 5 a second over [0, durationMs), one tagged face each. */
function fiveASecond(durationMs: number): FacesTrack {
  return { version: FACES_TRACK_VERSION, samples: Array.from({ length: durationMs / 200 }, (_, i) => ({ ms: i * 200, faces: [tagged(i * 200)] })) }
}

const shotsAt = (cuts: number[], durationMs: number): Shot[] => {
  const edges = [0, ...cuts, durationMs]
  return edges.slice(0, -1).map((startMs, i) => ({ startMs, endMs: edges[i + 1], score: i ? 1 : 0 }))
}

describe('reduceTrack — 2 a second, picked', () => {
  it('keeps the sample nearest each 500 ms tick, the earlier on a tie, with its own ms and its own box', () => {
    const reduced = reduceTrack(fiveASecond(6000), shotsAt([], 6000), REDUCE)
    // Ticks 0, 500, …, 5500: 500 sits between 400 and 600 (a tie), 1000 on a sample.
    expect(reduced.map((s) => s.ms)).toEqual([0, 400, 1000, 1400, 2000, 2400, 3000, 3400, 4000, 4400, 5000, 5400])
    for (const s of reduced) expect(s.faces.map(msOfFace), `the box at ${s.ms} is that frame’s`).toEqual([s.ms])
  })

  it('never averages: between two frames whose boxes differ, the box kept is one of them exactly', () => {
    // Tick 500 between a face at the left (400 ms) and one at the right (600 ms).
    const left: FaceBox = { x: 0.1, y: 0.3, width: 0.1, height: 0.15, score: 0.9 }
    const right: FaceBox = { x: 0.7, y: 0.4, width: 0.12, height: 0.18, score: 0.8 }
    const faces: FacesTrack = { version: FACES_TRACK_VERSION, samples: [{ ms: 400, faces: [left] }, { ms: 600, faces: [right] }] }
    const reduced = reduceTrack(faces, shotsAt([], 1000), REDUCE)
    expect(reduced).toEqual([{ ms: 400, faces: [left] }])
    // And with only the later frame near, it is that one's, untouched.
    expect(reduceTrack({ version: FACES_TRACK_VERSION, samples: [{ ms: 560, faces: [right] }] }, shotsAt([], 1000), REDUCE)).toEqual([{ ms: 560, faces: [right] }])
  })

  it('keeps the two largest faces, largest first, a tie by area going to the higher score', () => {
    const small = { x: 0.1, y: 0.1, width: 0.05, height: 0.05, score: 0.99 }
    const big = { x: 0.5, y: 0.1, width: 0.2, height: 0.3, score: 0.6 }
    const mid = { x: 0.3, y: 0.5, width: 0.1, height: 0.1, score: 0.7 }
    const midTwin = { x: 0.7, y: 0.5, width: 0.1, height: 0.1, score: 0.8 }
    const one = reduceTrack({ version: FACES_TRACK_VERSION, samples: [{ ms: 0, faces: [small, mid, big] }] }, shotsAt([], 500), REDUCE)
    expect(one[0].faces).toEqual([big, mid])
    const tie = reduceTrack({ version: FACES_TRACK_VERSION, samples: [{ ms: 0, faces: [mid, small, midTwin] }] }, shotsAt([], 500), REDUCE)
    expect(tie[0].faces).toEqual([midTwin, mid])
    // maxFaces is what is kept: 1 keeps the largest only.
    expect(reduceTrack({ version: FACES_TRACK_VERSION, samples: [{ ms: 0, faces: [small, big] }] }, shotsAt([], 500), { samplesPerSecond: 2, maxFaces: 1 })[0].faces).toEqual([big])
  })

  it('takes a tick’s sample from the tick’s own shot, never across the cut beside it', () => {
    // Cut at 1550: tick 1500 is shot 0's. The frame nearest it, 1560 (60 ms), is the NEXT shot's
    // picture; shot 0's nearest is 1300 (200 ms), and that is the one kept.
    const faces: FacesTrack = {
      version: FACES_TRACK_VERSION,
      samples: [0, 300, 700, 1300, 1560, 1800, 2000].map((ms) => ({ ms, faces: [tagged(ms)] }))
    }
    const reduced = reduceTrack(faces, shotsAt([1550], 2500), REDUCE)
    // Ticks 0, 500, 1000 (700 and 1300 tie: the earlier), 1500 → 1300; shot 1's tick 2000 → 2000.
    expect(reduced.map((s) => s.ms)).toEqual([0, 300, 700, 1300, 2000])
    expect(reduced.map((s) => s.faces.map(msOfFace)[0])).toEqual([0, 300, 700, 1300, 2000])
  })

  it('a shot no tick falls in keeps the sample nearest its middle', () => {
    // 2000 | 300 | 2000 with minShot lowered: the middle shot [2100, 2400) holds no multiple of 500.
    const faces = fiveASecond(4400)
    const reduced = reduceTrack(faces, shotsAt([2100, 2400], 4400), REDUCE)
    const inMiddle = reduced.filter((s) => s.ms >= 2100 && s.ms < 2400)
    expect(inMiddle.map((s) => s.ms)).toEqual([2200])
  })

  it('cleans every face: clamped into the frame, 4 dp, non-finite and empty boxes dropped', () => {
    const faces: FacesTrack = {
      version: FACES_TRACK_VERSION,
      samples: [
        {
          ms: 0,
          faces: [
            { x: -0.1, y: 0.95, width: 0.3, height: 0.2, score: 1.2 },
            { x: Number.NaN, y: 0.2, width: 0.1, height: 0.1, score: 0.9 },
            { x: 1.2, y: 0.2, width: 0.1, height: 0.1, score: 0.9 },
            { x: 0.3, y: 0.3, width: -0.1, height: 0.1, score: 0.9 },
            { x: 0.4, y: 0.4, width: 0.1, height: 0.1, score: Number.POSITIVE_INFINITY }
          ] as FaceBox[]
        }
      ]
    }
    const [sample] = reduceTrack(faces, shotsAt([], 500), REDUCE)
    expect(sample.faces).toEqual([{ x: 0, y: 0.95, width: 0.2, height: 0.05, score: 1 }])
    expect(cleanFace({ x: 0.12345678, y: 0.2, width: 0.33333333, height: 0.1, score: 0.87654321 })).toEqual({
      x: 0.1235,
      y: 0.2,
      width: 0.3333,
      height: 0.1,
      score: 0.8765
    })
    for (const bad of [null, 'face', { x: 0.1 }, { x: 0.1, y: 0.1, width: '0.1', height: 0.1, score: 1 }]) expect(cleanFace(bad)).toBeNull()
  })

  it('reads samples out of order, keeps one per ms, and skips one with no time', () => {
    const faces = {
      version: FACES_TRACK_VERSION,
      samples: [
        { ms: 600, faces: [tagged(600)] },
        { ms: 0, faces: [tagged(0)] },
        { ms: Number.NaN, faces: [tagged(1)] },
        { ms: 0, faces: [tagged(2)] },
        { ms: 1000, faces: [tagged(1000)] }
      ]
    } as FacesTrack
    const reduced = reduceTrack(faces, shotsAt([], 1500), REDUCE)
    expect(reduced.map((s) => [s.ms, s.faces.map(msOfFace)])).toEqual([
      [0, [0]],
      [600, [600]],
      [1000, [1000]]
    ])
    expect(reduceTrack({ version: FACES_TRACK_VERSION, samples: [] }, shotsAt([], 1500), REDUCE)).toEqual([])
  })

  it('ten minutes at 5 a second is 1,200 samples: 2 a second', () => {
    const reduced = reduceTrack(fiveASecond(600_000), shotsAt([12_345, 300_000], 600_000), REDUCE)
    expect(reduced).toHaveLength(1200)
    for (let i = 1; i < reduced.length; i++) expect(reduced[i].ms).toBeGreaterThan(reduced[i - 1].ms)
  })
})

describe('checkSubjectTrack', () => {
  const good = (): SubjectTrack => {
    const shots = shotsAt([2000], 4000).map((s, i) => ({ ...s, startPts: i * 30720 }))
    return {
      key: '1083786:1728000000123',
      version: SUBJECT_TRACK_VERSION,
      width: 640,
      height: 360,
      durationMs: 4000,
      shots,
      samples: reduceTrack(fiveASecond(4000), shots, REDUCE),
      perShot: shots.map(() => ({})),
      detector: 'test-stand-in/colour',
      scene: { threshold: 0.3, minShotMs: 500, backend: 'ffmpeg-select-rgb24' },
      at: '2026-10-13T00:00:00.000Z',
      timeBase: { num: 1, den: 15360 },
      facesVersion: FACES_TRACK_VERSION
    }
  }

  it('accepts a track as the job writes it', () => {
    expect(checkSubjectTrack(good())).not.toBeNull()
    const { timeBase: _drop, ...older } = good()
    expect(checkSubjectTrack(older), 'a track from before 1b kept the time base').not.toBeNull()
    const { facesVersion: _was, ...unversioned } = good()
    expect(checkSubjectTrack(unversioned), 'one from before the face track’s version was kept (main’s cache analyses it again)').not.toBeNull()
  })

  it('refuses one path.ts or keys.ts would misread', () => {
    const cases: [string, (t: SubjectTrack) => unknown][] = [
      ['another version', (t) => ({ ...t, version: SUBJECT_TRACK_VERSION + 1 })],
      ['no key', (t) => ({ ...t, key: '' })],
      ['a size that is not whole', (t) => ({ ...t, width: 640.5 })],
      ['a gap between shots', (t) => ({ ...t, shots: [t.shots[0], { ...t.shots[1], startMs: 2100 }] })],
      ['shots short of the duration', (t) => ({ ...t, durationMs: 5000 })],
      ['a pts that is not whole', (t) => ({ ...t, shots: [t.shots[0], { ...t.shots[1], startPts: 1.5 }] })],
      ['perShot not parallel', (t) => ({ ...t, perShot: [{}] })],
      ['a NaN box', (t) => ({ ...t, samples: [{ ms: 0, faces: [{ ...t.samples[0].faces[0], x: Number.NaN }] }] })],
      ['a box past the frame', (t) => ({ ...t, samples: [{ ms: 0, faces: [{ x: 0.95, y: 0.1, width: 0.1, height: 0.1, score: 0.9 }] }] })],
      ['samples out of order', (t) => ({ ...t, samples: [...t.samples].reverse() })],
      ['another scene backend', (t) => ({ ...t, scene: { ...t.scene, backend: 'scdet' } })],
      ['a time base of 0', (t) => ({ ...t, timeBase: { num: 1, den: 0 } })],
      ['a face-track version that is not whole', (t) => ({ ...t, facesVersion: 1.5 })],
      ['a face-track version of 0', (t) => ({ ...t, facesVersion: 0 })],
      ['not an object', () => 'track']
    ]
    for (const [what, make] of cases) expect(checkSubjectTrack(make(good())), what).toBeNull()
  })
})
