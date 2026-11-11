import { describe, expect, it } from 'vitest'
import {
  NO_FREE_THIRD_NOTE,
  NO_LANE_NOTE,
  NO_SUBJECT_NOTE,
  ZOOMS_UNDER_NOTE,
  graphicLane,
  placeGraphic,
  subjectAtOnset,
  thirdPreference
} from '@shared/graphics/place'
import { graphicTargetsAt } from '@shared/graphics/targets'
import type { GraphicSpec, GraphicTemplateId } from '@shared/graphics/template'
import { CLIPS_GRAPHIC_RULE } from '@shared/graphics/apply'
import { COPY_RULE, ENDING_RULE, SPINE_RULE } from '@shared/director/apply'
import { CHIN_EXTENSION } from '@shared/reframe/freeSpace'
import { SUBJECT_TRACK_VERSION, type SubjectSample, type SubjectTrack, type UnitRect } from '@shared/reframe/types'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, MAX_TRACKS, emptyProject, type Clip, type MediaAsset, type Project, type Track } from '@shared/timeline'

/*
 * docs/CLIPS.md §6.9's first half: the third (steps 1-3), the subject at
 * onset (step 4) and the lane ("On the timeline"). Most cases put a file of
 * the canvas's own shape (1080×1920) on a 1080×1920 canvas with nothing
 * cropped, so a face's SOURCE units are its FRAME units and each third's
 * overlap is arithmetic: a face w wide whose chin-extended height (×1.5) is e,
 * inside one third, covers w·e·3 of it. The reframed case's box is worked by
 * hand from its crop.
 */

const FPS = 30
const PORTRAIT = { width: 1080, height: 1920 }

interface Build {
  cutsMs?: number[]
  endMs: number
  /** A sample's faces at `ms` in shot `shot`, in units of the file. */
  faces: (shot: number, ms: number) => UnitRect[]
  width?: number
  height?: number
}

function track(b: Build): SubjectTrack {
  const cuts = b.cutsMs ?? []
  const edges = [0, ...cuts, b.endMs]
  const shotOf = (ms: number): number => cuts.filter((c) => c <= ms).length
  const samples: SubjectSample[] = []
  for (let ms = 0; ms < b.endMs; ms += 500) samples.push({ ms, faces: b.faces(shotOf(ms), ms).map((f) => ({ ...f, score: 0.9 })) })
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
    at: '2026-11-11T00:00:00.000Z'
  }
}

function clipOf(id: string, assetId: string, trackId: string, start: number, duration: number, patch: Partial<Clip> = {}): Clip {
  return { id, assetId, trackId, start, duration, inPoint: 0, volume: 1, transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR }, ...patch }
}

interface Setup {
  /** The subject track's build; absent, no track. */
  t?: Build
  clip?: Partial<Clip>
  captions?: Partial<Project['captions']> & { position?: 'top' | 'center' | 'bottom' }
  frames?: number
}

/** The footage clip 'c' on V1 from project frame 30, its file 'a' (the track's size), on a 1080×1920 canvas. */
function setup(s: Setup = {}): Project {
  const width = s.t?.width ?? 1080
  const height = s.t?.height ?? 1920
  const frames = s.frames ?? Math.round(((s.t?.endMs ?? 6000) * FPS) / 1000)
  const asset: MediaAsset = { id: 'a', path: '/media/a.mp4', name: 'a.mp4', kind: 'video', durationFrames: frames, width, height, fps: FPS, hasVideo: true, hasAudio: true, size: 1 }
  const base = emptyProject('place')
  const { position, ...captions } = s.captions ?? {}
  return {
    ...base,
    settings: { ...base.settings, ...PORTRAIT, fps: FPS },
    captions: { ...base.captions, enabled: false, ...captions, ...(position ? { overrides: { position } } : {}) },
    assets: [asset],
    clips: [clipOf('c', 'a', 'v1', 30, frames, s.clip)],
    subjects: s.t ? { a: track(s.t) } : {}
  }
}

/** A face whose chin-extended box covers `share` of the third it sits in, `w` wide. */
function covering(share: number, x: number, y: number, w = 0.3): UnitRect {
  return { x, y, width: w, height: share / (3 * w) / (1 + CHIN_EXTENSION) }
}
/** Extended 0.4..0.625: the middle third, 0.2025 of it. */
const MIDDLE_FACE: UnitRect = { x: 0.35, y: 0.4, width: 0.3, height: 0.15 }
/** Extended 0.7..0.925: the lower third, 0.2025 of it. */
const LOW_FACE: UnitRect = { x: 0.35, y: 0.7, width: 0.3, height: 0.15 }

const third = (p: Project, template: GraphicTemplateId, start = 60, frames = 90): string | null => {
  const place = placeGraphic(p, 'c', start, frames, template, PORTRAIT)
  return place && place.auto ? place.third : null
}

describe('placeGraphic: the third (§6.9 steps 1-3)', () => {
  it('the caption’s third is excluded, from the style: a counter with nothing in the frame', () => {
    // Middle first; captions centred take the middle, so the top.
    expect(third(setup({ captions: { enabled: true, position: 'center' } }), 'counter')).toBe('top')
    expect(third(setup({ captions: { enabled: true, position: 'bottom' } }), 'counter')).toBe('middle')
    // A lower third with captions at the bottom: the top.
    expect(third(setup({ captions: { enabled: true, position: 'bottom' } }), 'lower-third')).toBe('top')
    // Captions off: nothing excluded.
    expect(third(setup({ captions: { enabled: false, position: 'center' } }), 'counter')).toBe('middle')
    expect(third(setup({ captions: { enabled: false, position: 'bottom' } }), 'lower-third')).toBe('bottom')
  })

  it('the caption’s third is excluded, from Smart placement: captions at the bottom and a face in the middle send a counter to the top', () => {
    const middle = setup({ t: { endMs: 6000, faces: () => [MIDDLE_FACE] }, captions: { enabled: true, placement: 'smart', position: 'bottom' } })
    expect(third(middle, 'counter')).toBe('top')
    // A face low: Smart placement moves the captions to the middle, so the counter, its middle taken, goes to the top —
    // where the style's own third (the bottom, excluded) would leave the middle free.
    const low = { t: { endMs: 6000, faces: () => [LOW_FACE] }, captions: { enabled: true, position: 'bottom' as const } }
    expect(third(setup({ ...low, captions: { ...low.captions, placement: 'smart' } }), 'counter')).toBe('top')
    expect(third(setup(low), 'counter')).toBe('middle')
  })

  it('the middle is preferred by steps and bars when free, the top when the subject covers it', () => {
    for (const template of ['steps', 'bars', 'counter', 'keyword'] as GraphicTemplateId[]) {
      expect(third(setup({ t: { endMs: 6000, faces: () => [LOW_FACE] } }), template), template).toBe('middle')
      expect(third(setup({ t: { endMs: 6000, faces: () => [MIDDLE_FACE] } }), template), template).toBe('top')
    }
    expect(thirdPreference('steps')).toEqual(['middle', 'top', 'bottom'])
    expect(thirdPreference('bars')).toEqual(['middle', 'top', 'bottom'])
  })

  it('the bottom by lower-third, then the top, never the middle', () => {
    expect(third(setup({ t: { endMs: 6000, faces: () => [MIDDLE_FACE] } }), 'lower-third')).toBe('bottom')
    expect(third(setup({ t: { endMs: 6000, faces: () => [LOW_FACE] } }), 'lower-third')).toBe('top')
    expect(thirdPreference('lower-third')).toEqual(['bottom', 'top'])
  })

  it('a third is free under OVERLAP_LIMIT (0.05) and not above it; with none free, the least covered', () => {
    // A face in the middle covering 0.04 of it: free. At 0.06: the top.
    expect(third(setup({ t: { endMs: 6000, faces: () => [covering(0.04, 0.35, 0.4)] } }), 'counter')).toBe('middle')
    expect(third(setup({ t: { endMs: 6000, faces: () => [covering(0.06, 0.35, 0.4)] } }), 'counter')).toBe('top')
    // Every third covered: the top 0.1, the middle 0.3, the bottom 0.2 — the top, the least.
    const all = (): UnitRect[] => [covering(0.1, 0.0, 0.1, 0.5), covering(0.3, 0.5, 0.4, 0.5), covering(0.2, 0.0, 0.7, 0.5)]
    expect(third(setup({ t: { endMs: 6000, faces: all } }), 'counter')).toBe('top')
    // The bottom least: the bottom, though last preferred.
    const low = (): UnitRect[] => [covering(0.3, 0.0, 0.1, 0.5), covering(0.3, 0.5, 0.4, 0.5), covering(0.1, 0.0, 0.7, 0.5)]
    expect(third(setup({ t: { endMs: 6000, faces: low } }), 'counter')).toBe('bottom')
  })

  it('the subject over the span only: a face in the middle before the span does not move a counter', () => {
    // Shot 0 (0-3 s, project frames 30-120) has the face in the middle, shot 1 (3-6 s) low. A counter over frames 130-190 is in shot 1.
    const t: Build = { cutsMs: [3000], endMs: 6000, faces: (shot) => [shot === 0 ? MIDDLE_FACE : LOW_FACE] }
    expect(third(setup({ t }), 'counter', 130, 60)).toBe('middle')
    expect(third(setup({ t }), 'counter', 40, 60)).toBe('top')
  })

  it('no free third: the captions take all three over a span crossing two cuts, and the graphic is dropped (null)', () => {
    // Smart, at the bottom: shot 0 nothing (bottom), shot 1 a face low (middle), shot 2 a face low and one in the middle (top).
    const t: Build = { cutsMs: [2000, 4000], endMs: 6000, faces: (shot) => (shot === 0 ? [] : shot === 1 ? [LOW_FACE] : [LOW_FACE, MIDDLE_FACE]) }
    const p = setup({ t, captions: { enabled: true, placement: 'smart', position: 'bottom' } })
    expect(placeGraphic(p, 'c', 40, 150, 'counter', PORTRAIT)).toBeNull()
    expect(NO_FREE_THIRD_NOTE).toBe('no free third')
    // Inside shot 0 alone the captions take the bottom only.
    expect(third(p, 'counter', 40, 20)).toBe('middle')
  })

  it('the no-track default: the middle, or the top when the captions use the middle', () => {
    expect(third(setup(), 'counter')).toBe('middle')
    expect(third(setup({ captions: { enabled: true, position: 'center' } }), 'counter')).toBe('top')
    expect(third(setup({ captions: { enabled: true, placement: 'smart', position: 'center' } }), 'steps')).toBe('top')
    // A lower third keeps its own preference (the reading recorded in place.ts).
    expect(third(setup(), 'lower-third')).toBe('bottom')
    // The clip gone: no place.
    expect(placeGraphic(setup(), 'gone', 60, 90, 'counter', PORTRAIT)).toBeNull()
  })
})

/* ------------------------------------------------------- the subject at onset */

/** A 1920×1080 file reframed to 9:16 by a stored crop, 608×1080 from x 656: the export covers it into the 1080×1920 box at 16/9. */
const CROP = { x: 656, y: 0, width: 608, height: 1080 }
/** Faces in units of the 1920×1080 file: a small one, and the largest, at x 768 px, y 324 px, 192×216 px. */
const SMALL: UnitRect = { x: 0.6, y: 0.5, width: 0.05, height: 0.1 }
const BIG: UnitRect = { x: 0.4, y: 0.3, width: 0.1, height: 0.2 }

function reframed(patch: Partial<Clip> = {}, faces: Build['faces'] = () => [SMALL, BIG]): Project {
  return setup({ t: { endMs: 6000, width: 1920, height: 1080, faces }, clip: { crop: CROP, ...patch } })
}

const spec = (subject: GraphicSpec['subject']): Pick<GraphicSpec, 'subject'> => ({ subject })

describe('subjectAtOnset (§6.9 step 4)', () => {
  it('a callout’s target on a reframed 9:16 clip: the largest face, source units, no chin, through sourceToFrame at onset, fixed (the held frames equal)', () => {
    const p = reframed()
    // Onset project frame 60: clip frame 30, source 1000 ms, the sample at 1000 ms.
    const got = subjectAtOnset(p, 'c', 60, 75, 'callout', PORTRAIT)
    expect(got).toEqual({ subject: { clipId: 'c', box: BIG, ms: 1000 } })
    const subject = (got as { subject: GraphicSpec['subject'] }).subject
    // By hand: scale 16/9 (cover: max(1080/608, 1920/1080)); the 1080.9 px picture centred, its left at −4/9 px.
    // x = −4/9 + (768 − 656)·16/9 = 1788/9; y = 324·16/9 = 576; 192·16/9 = 3072/9 wide; 216·16/9 = 384 tall —
    // the face's own 0.2 height, not the chin-extended 0.3 (which would be 576 tall).
    const at = graphicTargetsAt(p, { start: 60 }, spec(subject), 60, PORTRAIT).subject!
    expect(at.x).toBeCloseTo(1788 / 9, 6)
    expect(at.y).toBeCloseTo(576, 6)
    expect(at.width).toBeCloseTo(3072 / 9, 6)
    expect(at.height).toBeCloseTo(384, 6)
    // The held frames equal: the same target on the last frame of the graphic.
    expect(graphicTargetsAt(p, { start: 60 }, spec(subject), 134, PORTRAIT)).toEqual(graphicTargetsAt(p, { start: 60 }, spec(subject), 60, PORTRAIT))
  })

  it('read once, at onset: a moving face is taken where the onset sample has it, and a followed clip’s crop stepping at a cut does not move the target', () => {
    // The face moves right 0.01 a second: the onset sample (1000 ms) has it at x 0.41.
    const moving = reframed({}, (_s, ms) => [{ ...BIG, x: 0.4 + ms / 100000 }])
    const got = subjectAtOnset(moving, 'c', 60, 75, 'counter', PORTRAIT) as { subject: NonNullable<GraphicSpec['subject']> }
    expect(got.subject.box.x).toBeCloseTo(0.41, 12)
    expect(got.subject.ms).toBe(1000)
    // A dim's hole and a connector's target take the same box as a callout's.
    // A clip the project no longer holds: no subject, no hole.
    expect(subjectAtOnset(moving, 'gone', 60, 75, 'steps', PORTRAIT)).toEqual({ subject: null })
    expect(subjectAtOnset(moving, 'c', 60, 75, 'steps', PORTRAIT)).toEqual(got)

    // Followed: 1920×1080 on 9:16, shot 0's face low left, shot 1's high right; the crop steps at clip frame 80.
    const W = 1920
    const H = 1080
    const followed = setup({
      t: {
        width: W,
        height: H,
        cutsMs: [3166.67],
        endMs: 6000,
        faces: (shot) => [shot === 0 ? { x: 400 / W, y: 700 / H, width: 200 / W, height: 200 / H } : { x: 1400 / W, y: 200 / H, width: 200 / W, height: 200 / H }]
      },
      clip: { follow: { version: 1 }, inPoint: 15 },
      frames: 150
    })
    const onset = 40
    const f = subjectAtOnset(followed, 'c', onset, 90, 'callout', PORTRAIT) as { subject: NonNullable<GraphicSpec['subject']> }
    expect(f.subject.box.x).toBeCloseTo(400 / W, 12)
    const first = graphicTargetsAt(followed, { start: onset }, spec(f.subject), onset, PORTRAIT)
    expect(first.subject).not.toBeNull()
    // Project frame 120 is clip frame 90, past the crop's step: the target is still the onset's.
    expect(graphicTargetsAt(followed, { start: onset }, spec(f.subject), 120, PORTRAIT)).toEqual(first)
  })

  it('a callout whose subject is null at onset is dropped with rule 9’s note; any other template draws its dim without a hole', () => {
    expect(NO_SUBJECT_NOTE).toBe('no subject found to point at')
    // No subject track.
    expect(subjectAtOnset(setup(), 'c', 60, 75, 'callout', PORTRAIT)).toEqual({ dropped: NO_SUBJECT_NOTE })
    expect(subjectAtOnset(setup(), 'c', 60, 75, 'counter', PORTRAIT)).toEqual({ subject: null })
    // A face the crop cuts away (x 96..288 px, the crop from 656): off screen.
    const off = reframed({}, () => [{ x: 0.05, y: 0.3, width: 0.1, height: 0.2 }])
    expect(subjectAtOnset(off, 'c', 60, 75, 'callout', PORTRAIT)).toEqual({ dropped: NO_SUBJECT_NOTE })
    expect(subjectAtOnset(off, 'c', 60, 75, 'ring', PORTRAIT)).toEqual({ subject: null })
    // No face in the onset sample.
    expect(subjectAtOnset(reframed({}, () => []), 'c', 60, 75, 'callout', PORTRAIT)).toEqual({ dropped: NO_SUBJECT_NOTE })
    // An onset the clip does not show.
    expect(subjectAtOnset(reframed(), 'c', 10, 75, 'callout', PORTRAIT)).toEqual({ dropped: NO_SUBJECT_NOTE })
  })

  it('over a Ken Burns motion or a zoom key of 1.2 a callout is dropped and a counter’s dim has no hole; a held zoom of 1 changes nothing', () => {
    expect(ZOOMS_UNDER_NOTE).toBe('the shot zooms under it, so its target would miss')
    const taken = subjectAtOnset(reframed(), 'c', 60, 75, 'callout', PORTRAIT)
    expect(taken).toHaveProperty('subject.box', BIG)
    const kenBurns = reframed({ motion: { kind: 'kenburns', direction: 'in', amount: 0.1 } })
    expect(subjectAtOnset(kenBurns, 'c', 60, 75, 'callout', PORTRAIT)).toEqual({ dropped: ZOOMS_UNDER_NOTE })
    expect(subjectAtOnset(kenBurns, 'c', 60, 75, 'counter', PORTRAIT)).toEqual({ subject: null })
    const zoom = reframed({ keyframes: { zoom: [{ frame: 0, value: 1 }, { frame: 60, value: 1.2 }] } })
    expect(subjectAtOnset(zoom, 'c', 60, 75, 'callout', PORTRAIT)).toEqual({ dropped: ZOOMS_UNDER_NOTE })
    expect(subjectAtOnset(zoom, 'c', 60, 75, 'counter', PORTRAIT)).toEqual({ subject: null })
    // A held zoom of 1, and a zoom that starts only after the span (clip frames 30-105): the subject as without.
    const held = reframed({ keyframes: { zoom: [{ frame: 0, value: 1 }, { frame: 120, value: 1 }] } })
    expect(subjectAtOnset(held, 'c', 60, 75, 'callout', PORTRAIT)).toEqual(taken)
    const later = reframed({ keyframes: { zoom: [{ frame: 0, value: 1 }, { frame: 110, value: 1 }, { frame: 140, value: 1.2 }] } })
    expect(subjectAtOnset(later, 'c', 60, 75, 'callout', PORTRAIT)).toEqual(taken)
  })
})

/* ---------------------------------------------------------------- the lane */

const V = (id: string): Track => ({ id, kind: 'video', name: id.toUpperCase(), muted: false, hidden: false, locked: false })
const videoIds = (p: Project): string[] => p.tracks.filter((t) => t.kind === 'video').map((t) => t.id)

/** Footage on V1 (frames 30-210); V2 and V3 exist; `clips` added. */
function laned(clips: Clip[] = [], tracks: Track[] = [V('v1'), V('v2'), V('v3')]): Project {
  const p = setup()
  const audio = p.tracks.filter((t) => t.kind === 'audio')
  return { ...p, tracks: [...tracks, ...audio], clips: [...p.clips, ...clips] }
}

describe('graphicLane (§6.9 “On the timeline”)', () => {
  it('the first lane free over the span above the footage, reused: the same project back, untouched', () => {
    const p = laned()
    const before = structuredClone(p)
    const got = graphicLane(p, 'c', 60, 90, CLIPS_GRAPHIC_RULE)
    expect(got).toEqual({ project: p, trackId: 'v2' })
    expect((got as { project: Project }).project).toBe(p)
    // V2 busy over the span: V3.
    const busy = laned([clipOf('u', 'a', 'v2', 100, 30)])
    expect(graphicLane(busy, 'c', 60, 90, CLIPS_GRAPHIC_RULE)).toMatchObject({ trackId: 'v3' })
    // V2 busy only outside it: V2.
    expect(graphicLane(laned([clipOf('u', 'a', 'v2', 150, 30)]), 'c', 60, 90, CLIPS_GRAPHIC_RULE)).toMatchObject({ trackId: 'v2' })
    expect(p).toEqual(before)
  })

  it('above the look: an adjustment clip on V2, though not over the span, starts the search at V3', () => {
    const look = clipOf('look', 'a', 'v2', 300, 60, { adjustment: true })
    expect(graphicLane(laned([look]), 'c', 60, 90, CLIPS_GRAPHIC_RULE)).toMatchObject({ trackId: 'v3' })
    // A moment does the same.
    const moment = clipOf('m', 'a', 'v2', 300, 10, { moment: { kind: 'zoom-punch' } as Clip['moment'] })
    expect(graphicLane(laned([moment]), 'c', 60, 90, CLIPS_GRAPHIC_RULE)).toMatchObject({ trackId: 'v3' })
  })

  it('above a card: a Director card on V3 (COPY_RULE, or ENDING_RULE) puts the graphic on a new top track', () => {
    for (const rule of [COPY_RULE, ENDING_RULE]) {
      const card = clipOf('card', 'a', 'v3', 400, 30, { generatedBy: { rule, reason: 'hook headline' } })
      const p = laned([card])
      const before = structuredClone(p)
      const got = graphicLane(p, 'c', 60, 90, CLIPS_GRAPHIC_RULE) as { project: Project; trackId: string }
      expect(got.project).not.toBe(p)
      const ids = videoIds(got.project)
      expect(ids.slice(0, 3)).toEqual(['v1', 'v2', 'v3'])
      expect(ids).toHaveLength(4)
      expect(got.trackId).toBe(ids[3])
      // Clip it's new track is not the Director's.
      expect(got.project.tracks.find((t) => t.id === got.trackId)!.director).toBeUndefined()
      expect(p).toEqual(before)
    }
    // A clip of the user's on V3 that is no card: V2 is still the start.
    expect(graphicLane(laned([clipOf('u', 'a', 'v3', 400, 30, { generatedBy: { rule: CLIPS_GRAPHIC_RULE, reason: 'x' } })]), 'c', 60, 90, CLIPS_GRAPHIC_RULE)).toMatchObject({ trackId: 'v2' })
  })

  it('a new top track when every lane above is busy: marked the Director’s for a Direct rule, not for Clip it’s', () => {
    const full = [clipOf('u2', 'a', 'v2', 30, 180), clipOf('u3', 'a', 'v3', 30, 180)]
    const clips = graphicLane(laned(full), 'c', 60, 90, CLIPS_GRAPHIC_RULE) as { project: Project; trackId: string }
    expect(videoIds(clips.project)).toHaveLength(4)
    expect(clips.trackId).toBe(videoIds(clips.project)[3])
    expect(clips.project.tracks.find((t) => t.id === clips.trackId)!.director).toBeUndefined()
    // SPINE_RULE stands in for Direct's graphic rule, which lane T3's piece 5 adds to DIRECTOR_RULES.
    const direct = graphicLane(laned(full), 'c', 60, 90, SPINE_RULE) as { project: Project; trackId: string }
    expect(direct.project.tracks.find((t) => t.id === direct.trackId)!.director).toBe(true)
    // The tracks that were there are not marked.
    expect(direct.project.tracks.filter((t) => t.director).map((t) => t.id)).toEqual([direct.trackId])
  })

  it('at the track limit with no free lane the graphic is dropped with its note, the project untouched', () => {
    const tracks = Array.from({ length: MAX_TRACKS - 2 }, (_, i) => V(`v${i + 1}`))
    const busy = tracks.slice(1).map((t) => clipOf(`u-${t.id}`, 'a', t.id, 0, 300))
    const p = laned(busy, tracks)
    expect(p.tracks).toHaveLength(MAX_TRACKS)
    const before = structuredClone(p)
    expect(graphicLane(p, 'c', 60, 90, SPINE_RULE)).toEqual({ dropped: NO_LANE_NOTE })
    expect(p).toEqual(before)
    // A card on the top lane at the limit: no lane above it, dropped too.
    const top = tracks[tracks.length - 1].id
    const carded = laned([clipOf('card', 'a', top, 500, 30, { generatedBy: { rule: COPY_RULE, reason: 'x' } })], tracks)
    expect(graphicLane(carded, 'c', 60, 90, SPINE_RULE)).toEqual({ dropped: NO_LANE_NOTE })
    // One lane free over the span below the top: taken.
    const freed = laned(busy.filter((c) => c.trackId !== 'v5'), tracks)
    expect(graphicLane(freed, 'c', 60, 90, SPINE_RULE)).toMatchObject({ trackId: 'v5' })
  })
})
