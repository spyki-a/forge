import { describe, expect, it } from 'vitest'
import { emptyProject, DEFAULT_COLOR, DEFAULT_TRANSFORM, MAX_TRACKS, type Clip, type MediaAsset, type Project, type Track } from '@shared/timeline'
import { CHECK_THE_NUMBER, CLEAR_GRAPHICS_NOTE, CLIPS_GRAPHIC_RULE, applyGraphics, clearGraphics, lowerThirdFor } from '@shared/graphics/apply'
import { GRAPHIC_RULE, SOUND_RULE, clearDirector } from '@shared/director/apply'
import { RETIMED_NOTE } from '@shared/graphics/beats'
import { TOO_CLOSE_REASON } from '@shared/graphics/budget'
import { NO_LANE_NOTE, NO_SUBJECT_NOTE } from '@shared/graphics/place'
import { GRAPHIC_SOUND_LANE_NAME } from '@shared/graphics/sound'
import { SOUND_LANE_NAME } from '@shared/director/sound'
import { SOUND_ROLES, type SoundPack } from '@shared/director/soundRoles'
import type { GraphicCandidate, GraphicData, KeptGraphic } from '@shared/graphics/template'
import type { Transcript } from '@shared/transcript'

/*
 * docs/CLIPS.md §6.6 "The rules": applyGraphics lands a run in the plan's
 * order — the lower third on each covered clip, the beats, the seconds,
 * proposals set aside, the budget, placement and the subject at onset, the
 * lane, the sounds.
 *
 * Every frame below is worked by hand. 30 fps, a 1080×1920 canvas, captions
 * off. The footage clip 'c' sits on V1 at frame 30 with in-point 60 (2000 ms
 * of source), 1200 frames (40 s) long, so a word at source ms m is at
 * timeline second (m − 2000)/1000 + 1 (the captions' offset, §6.8). A
 * graphic starts on beatFrame(first beat − 0.5 s) = ceil((beat − 0.5) × 30).
 */

const FPS = 30
const CANVAS = { width: 1080, height: 1920 }

const WORDS: [string, number, number][] = [
  ['Before', 1000, 1500], // 0: before the in-point, not shown
  ['Hello', 2500, 2900], // 1: the first word the clip shows → 1.5 s
  ['we', 3000, 3200],
  ['grew', 3300, 3600],
  ['40%', 12000, 12400], // 4: → 11.0 s
  ['this', 12500, 12800], // 5: → 11.5 s
  ['year', 12900, 13300],
  ['never', 22000, 22300], // 7: → 21.0 s
  ['again', 22400, 22800],
  ['look', 30000, 30300], // 9: → 29.0 s
  ['fast', 12100, 12150] // 10: → 11.1 s, spread to 11.16 s after word 4
]

function transcript(assetId: string): Transcript {
  return {
    assetId,
    language: 'en',
    model: 'whisper',
    durationMs: 60000,
    words: WORDS.map(([text, startMs, endMs], index) => ({ index, text, startMs, endMs, confidence: 0.9 })),
    segments: [
      { id: 's0', startMs: 1000, endMs: 1500, text: 'Before', wordStart: 0, wordEnd: 0 },
      { id: 's1', startMs: 2500, endMs: 3600, text: 'Hello we grew', wordStart: 1, wordEnd: 3 },
      { id: 's2', startMs: 12000, endMs: 13300, text: '40% this year', wordStart: 4, wordEnd: 6 },
      { id: 's3', startMs: 22000, endMs: 22800, text: 'never again', wordStart: 7, wordEnd: 8 },
      { id: 's4', startMs: 30000, endMs: 30300, text: 'look', wordStart: 9, wordEnd: 9 }
    ]
  }
}

function clipOf(id: string, assetId: string, trackId: string, start: number, duration: number, patch: Partial<Clip> = {}): Clip {
  return { id, assetId, trackId, start, duration, inPoint: 0, volume: 1, transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR }, ...patch }
}

function assetOf(id: string, speaker?: string): MediaAsset {
  return { id, path: `/media/${id}.mp4`, name: `${id}.mp4`, kind: 'video', durationFrames: 1800, width: 1080, height: 1920, fps: FPS, hasVideo: true, hasAudio: true, size: 1, ...(speaker !== undefined ? { speaker } : {}) }
}

/** The footage clip 'c' (asset 'a', Speaker "Priya Rao" unless `speaker` says otherwise) and `extra` clips. */
function setup(o: { speaker?: string | null; extra?: Clip[]; assets?: MediaAsset[]; tracks?: Track[] } = {}): Project {
  const base = emptyProject('apply')
  const speaker = o.speaker === null ? undefined : (o.speaker ?? 'Priya Rao')
  return {
    ...base,
    settings: { ...base.settings, ...CANVAS, fps: FPS },
    captions: { ...base.captions, enabled: false },
    tracks: o.tracks ?? base.tracks,
    assets: [assetOf('a', speaker), ...(o.assets ?? [])],
    clips: [clipOf('c', 'a', 'v1', 30, 1200, { inPoint: 60 }), ...(o.extra ?? [])],
    transcripts: { a: transcript('a'), b: transcript('b') }
  }
}

function cand(data: GraphicData, beatWords: number[], patch: Partial<GraphicCandidate> = {}): GraphicCandidate {
  return { sentence: 's2', data, bound: beatWords, beatWords, why: 'a number said', source: 'model', ...patch }
}
const keptOn = (clipId: string, assetId: string, candidate: GraphicCandidate): KeptGraphic => ({ clipId, assetId, candidate })

const COUNTER = cand({ template: 'counter', value: '40%', label: 'grew' }, [4])
const RING_TOO_CLOSE = cand({ template: 'ring', value: '40%', label: 'this year' }, [5])
const PROPOSED = cand({ template: 'counter', value: '15', label: 'never' }, [7], { sentence: 's3', proposal: { reason: 'check-the-number', wordSource: 'youtube-asr' } })
const CALLOUT = cand({ template: 'callout', label: 'look', shape: 'circle' }, [9], { sentence: 's4' })

/** Ids by prefix, so each kind counts from 1 whatever the others did. */
function ids(): (prefix: string) => string {
  const n: Record<string, number> = {}
  return (prefix) => `${prefix}-${(n[prefix] = (n[prefix] ?? 0) + 1)}`
}

const TICK: SoundPack = [{ ...SOUND_ROLES['clock_tick.wav'], id: 'clock_tick.wav', name: 'clock_tick.wav', file: '/lib/sfx/clock_tick.wav' }]

describe('applyGraphics: the input and the rule', () => {
  it('never edits its input, a full run included', () => {
    const project = setup()
    const before = structuredClone(project)
    const kept = [keptOn('c', 'a', COUNTER), keptOn('c', 'a', RING_TOO_CLOSE), keptOn('c', 'a', PROPOSED), keptOn('c', 'a', CALLOUT)]
    const keptBefore = structuredClone(kept)
    const out = applyGraphics(project, kept, ['c'], CLIPS_GRAPHIC_RULE, { fps: FPS, newId: ids(), sounds: TICK })
    expect(out.clipIds.length).toBeGreaterThan(0)
    expect(out.project).not.toBe(project)
    expect(project).toEqual(before)
    expect(kept).toEqual(keptBefore)
  })

  it('with nothing to land, the same project comes back, no clip ids, no problems', () => {
    const project = setup({ speaker: null })
    const before = structuredClone(project)
    const out = applyGraphics(project, [], ['c'], CLIPS_GRAPHIC_RULE, { fps: FPS, newId: ids() })
    expect(out.project).toBe(project)
    expect(project).toEqual(before)
    expect(out).toMatchObject({ clipIds: [], problems: [] })
  })

  it("the clips flow's rule is 'clips.graphic'", () => {
    expect(CLIPS_GRAPHIC_RULE).toBe('clips.graphic')
  })
})

describe('lowerThirdFor (§6.6, §6.8)', () => {
  it("the asset's Speaker, an empty role, its beat the first word the clip shows; null without a Speaker or with one already there", () => {
    const p = setup()
    const lower = lowerThirdFor(p, p.clips[0])!
    expect(lower).toMatchObject({ clipId: 'c', assetId: 'a' })
    expect(lower.candidate.data).toEqual({ template: 'lower-third', name: 'Priya Rao', role: '' })
    // Word 0 ends before the in-point's 2000 ms; word 1 is the first the clip shows.
    expect(lower.candidate.beatWords).toEqual([1])
    expect(lower.candidate.sentence).toBe('s1')
    expect(lower.candidate.proposal).toBeUndefined()
    expect(lowerThirdFor(setup({ speaker: null }), p.clips[0])).toBeNull()
    expect(lowerThirdFor(setup({ speaker: '   ' }), p.clips[0])).toBeNull()
    // With one already over the clip (any rule's), none.
    const landed = applyGraphics(p, [], ['c'], GRAPHIC_RULE, { fps: FPS, newId: ids() }).project
    expect(lowerThirdFor(landed, landed.clips[0])).toBeNull()
  })
})

describe.each([
  ['Clip it', CLIPS_GRAPHIC_RULE],
  ['Direct', GRAPHIC_RULE]
])('applyGraphics: the landing order (%s)', (_name, rule) => {
  const run = (kept: KeptGraphic[], covered = ['c'], project = setup()) =>
    applyGraphics(project, kept, covered, rule, { fps: FPS, newId: ids(), sounds: TICK })

  it('a lower third first, then a kept counter placed with its beats from the clip start; each graphic its asset as addGraphicClip makes it', () => {
    const out = run([keptOn('c', 'a', COUNTER)])
    expect(out.problems).toEqual([])
    // Landing order: the lower third (onset 1.5 s), then the counter (11.0 s).
    expect(out.clipIds).toEqual(['graphic-1', 'graphic-2'])
    const [lower, counter] = out.clipIds.map((id) => out.project.clips.find((c) => c.id === id)!)

    // The lower third: beat 1.5 s; start ceil((1.5 − 0.5) × 30) = 30, the clip's own first frame; beats [0.5];
    // seconds max(2.5, 0.5 + 0.8, 0.5 + 10/20 + 0.3) = 2.5 → 75 frames. The run's rule.
    expect(lower).toMatchObject({ start: 30, duration: 75, trackId: 'v2', inPoint: 0, generatedBy: { rule } })
    expect(lower.graphic).toMatchObject({ data: { template: 'lower-third', name: 'Priya Rao', role: '' }, seconds: 2.5, place: { auto: true, third: 'bottom' }, subject: null, version: 1 })
    expect(lower.graphic!.beats[0]).toBeCloseTo(0.5, 9)
    expect(lower.graphic!.grounding).toEqual({ assetId: 'a', sentence: 's1', words: [1] })

    // The counter: beat (12000 − 2000)/1000 + 1 = 11.0 s; start ceil(10.5 × 30) = 315; beats [0.5];
    // seconds max(2, 1.3, 0.5 + 8/20 + 0.3) = 2 → 60 frames; the middle, captions off and no subject track.
    expect(counter).toMatchObject({ start: 315, duration: 60, trackId: 'v2', generatedBy: { rule } })
    expect(counter.generatedBy!.reason).toContain('counter "40%"')
    expect(counter.graphic).toMatchObject({ seconds: 2, place: { auto: true, third: 'middle' }, subject: null })
    expect(counter.graphic!.beats).toHaveLength(1)
    expect(counter.graphic!.beats[0]).toBeCloseTo(0.5, 9)
    expect(counter.graphic!.grounding).toEqual({ assetId: 'a', sentence: 's2', words: [4] })
    expect(counter.graphic!.proposal).toBeUndefined()
    // The exit: opacity 1 at 60 − 9 = 51, 0 at 59.
    expect(counter.keyframes).toEqual({ opacity: [{ frame: 51, value: 1, ease: 'smooth' }, { frame: 59, value: 0 }] })

    // The asset, field by field as store.ts addGraphicClip makes it: the project's size, max(60, 300) frames.
    expect(out.project.assets.find((a) => a.id === counter.assetId)).toEqual({
      id: 'graphic-asset-graphic-2', path: '', name: 'counter — graphic', kind: 'image', durationFrames: 300, size: 0,
      width: 1080, height: 1920, fps: null, hasVideo: true, hasAudio: false
    })
    expect(out.project.assets.find((a) => a.id === lower.assetId)).toMatchObject({ name: 'lower-third — graphic', durationFrames: 300 })
  })

  it("the counter's tick: under the run's rule, forGraphic its graphic, its peak on the beat frame, on the rule's lane", () => {
    const out = run([keptOn('c', 'a', COUNTER)])
    const sounds = out.project.clips.filter((c) => c.forGraphic !== undefined)
    // The lower third is silent; the counter's tick: beat frame 315 + ceil(0.5 × 30) = 330, peak round(0.005 × 30) = 0.
    expect(sounds.map((c) => [c.forGraphic, c.start, c.generatedBy!.rule])).toEqual([['graphic-2', 330, rule]])
    const lane = out.project.tracks.find((t) => t.id === sounds[0].trackId)!
    expect(lane.name).toBe(rule === GRAPHIC_RULE ? SOUND_LANE_NAME : GRAPHIC_SOUND_LANE_NAME)
    const file = out.project.assets.find((a) => a.id === sounds[0].assetId)!
    expect(file.broughtBy).toBe(rule)
    expect(file.broughtBy).not.toBe(SOUND_RULE)
  })

  it('a lower third on each covered clip, each under the run’s rule, and clip ids in landing order, not the order kept', () => {
    const project = setup({ extra: [clipOf('c2', 'b', 'v1', 1300, 600, { inPoint: 60 })], assets: [assetOf('b', 'Ravi')] })
    // Kept: the keyword (21 s) before the counter (11 s); they land in onset order after the lower third (1.5 s).
    const keyword = cand({ template: 'keyword', words: 'never again', lit: 0 }, [7, 8], { sentence: 's3' })
    const out = run([keptOn('c', 'a', keyword), keptOn('c', 'a', COUNTER)], ['c', 'c2'], project)
    expect(out.problems).toEqual([])
    const landed = out.clipIds.map((id) => out.project.clips.find((c) => c.id === id)!)
    expect(landed.map((c) => [c.id, c.graphic!.data.template, c.start])).toEqual([
      ['graphic-1', 'lower-third', 30],
      ['graphic-2', 'counter', 315],
      // Keyword beat (22000 − 2000)/1000 + 1 = 21 s: ceil(20.5 × 30) = 615.
      ['graphic-3', 'keyword', 615],
      // c2's lower third: word 1 again, 0.5 s into c2 (in-point 2000 ms), so 1300/30 + 0.5 s; less the 0.5 s lead
      // that is c2's own first frame, 1300.
      ['graphic-4', 'lower-third', 1300]
    ])
    expect(landed.map((c) => c.generatedBy!.rule)).toEqual([rule, rule, rule, rule])
    expect(landed.filter((c) => c.graphic!.data.template === 'lower-third').map((c) => (c.graphic!.data as { name: string }).name)).toEqual(['Priya Rao', 'Ravi'])
  })

  it('a quote’s beats are not spread; a steps graphic’s are, to 160 ms', () => {
    // Words 4 and 10 are 100 ms apart: 11.0 s and 11.1 s, from a start of ceil(10.5 × 30) = 315.
    const quote = cand({ template: 'quote', text: '40% fast', speaker: '' }, [4, 10])
    const steps = cand({ template: 'steps', title: 'Step by step', items: [{ label: '40%' }, { label: 'fast' }], connector: 'none' }, [4, 10])
    for (const [c, second] of [[quote, 0.6], [steps, 0.66]] as const) {
      const out = run([keptOn('c', 'a', c)], [])
      expect(out.problems).toEqual([])
      const g = out.project.clips.find((x) => x.id === out.clipIds[0])!
      expect(g.start).toBe(315)
      expect(g.graphic!.beats[0]).toBeCloseTo(0.5, 9)
      expect(g.graphic!.beats[1]).toBeCloseTo(second, 9)
    }
  })

  it('a lower third at most once per clip: covered twice, and again on a second run', () => {
    const once = run([], ['c', 'c'])
    expect(once.clipIds).toEqual(['graphic-1'])
    const again = run([], ['c'], once.project)
    expect(again.clipIds).toEqual([])
    expect(again.project.clips.filter((c) => c.graphic?.data.template === 'lower-third')).toHaveLength(1)
  })

  it('a proposal is set aside and not placed: its timing and its note "check the number"', () => {
    const out = run([keptOn('c', 'a', PROPOSED)], [])
    expect(out.clipIds).toEqual([])
    expect(out.project.clips.some((c) => c.graphic)).toBe(false)
    expect(out.project.graphicProposals).toHaveLength(1)
    const p = out.project.graphicProposals![0]
    expect(p).toMatchObject({ id: 'graphic-proposal-1', clipId: 'c', rule, note: `${CHECK_THE_NUMBER}: heard "never"` })
    expect(p.spec.proposal).toEqual({ reason: 'check-the-number', wordSource: 'youtube-asr' })
    // Beat 21.0 s from a start of ceil(20.5 × 30) = 615: 0.5.
    expect(p.spec.beats[0]).toBeCloseTo(0.5, 9)
  })

  it('a budget drop is a problem with the budget’s reason; a callout with no subject is dropped with rule 9’s note', () => {
    const out = run([keptOn('c', 'a', COUNTER), keptOn('c', 'a', RING_TOO_CLOSE), keptOn('c', 'a', CALLOUT)], [])
    // The ring's onset, 11.5 s, is 0.5 s after the counter's: the earlier stays.
    expect(out.problems.map((p) => [p.path, p.message])).toContainEqual(['$.kept[1]', `graphic dropped: the ring "40%" — ${TOO_CLOSE_REASON}`])
    // The callout passes the budget (29 s) and has no subject track to point at.
    expect(out.problems.map((p) => [p.path, p.message])).toContainEqual(['$.kept[2]', `graphic dropped: the callout "look" — ${NO_SUBJECT_NOTE}`])
    expect(out.clipIds).toHaveLength(1)
    expect(out.project.clips.find((c) => c.id === out.clipIds[0])!.graphic!.data.template).toBe('counter')
  })

  it('a retimed clip is refused once, its lower third and its graphics with it', () => {
    const extra = [clipOf('r', 'b', 'v1', 1300, 600, { speed: 2 })]
    const project = setup({ extra, assets: [assetOf('b', 'Ravi')] })
    const out = run([keptOn('r', 'b', COUNTER), keptOn('r', 'b', cand({ template: 'keyword', words: 'never again', lit: 0 }, [7, 8]))], ['r'], project)
    expect(out.clipIds).toEqual([])
    expect(out.problems.filter((p) => p.message.includes(RETIMED_NOTE))).toHaveLength(1)
    expect(out.problems).toHaveLength(1)
  })

  it('at the track limit with no free lane, a graphic is dropped with its note', () => {
    const tracks: Track[] = [
      ...Array.from({ length: MAX_TRACKS - 2 }, (_, i): Track => ({ id: `v${i + 1}`, kind: 'video', name: `V${i + 1}`, muted: false, hidden: false, locked: false })),
      { id: 'a1', kind: 'audio', name: 'A1', muted: false, hidden: false, locked: false },
      { id: 'a2', kind: 'audio', name: 'A2', muted: false, hidden: false, locked: false }
    ]
    const busy = tracks.filter((t) => t.kind === 'video' && t.id !== 'v1').map((t) => clipOf(`u-${t.id}`, 'a', t.id, 0, 2000))
    const project = setup({ tracks, extra: busy })
    const out = run([keptOn('c', 'a', COUNTER)], [], project)
    expect(out.clipIds).toEqual([])
    expect(out.problems.map((p) => p.message)).toEqual([`graphic dropped: the counter "40%" — ${NO_LANE_NOTE}`])
    expect(out.project.tracks).toHaveLength(MAX_TRACKS)
  })
})

describe('applyGraphics: the sounds re-placed on a footage clip (§6.14 cap)', () => {
  it('a file the cap moves off every clip leaves the pool: no brought file without a clip', () => {
    const ALL: SoundPack = ['clock_tick.wav', 'fast_whoosh.wav', 'whoosh_fast.wav', 'sword_swish.wav', 'swoosh_heavy.wav'].map((name) => ({ ...SOUND_ROLES[name], id: name, name, file: `/lib/sfx/${name}` }))
    const project = { ...setup({ speaker: null }), graphics: { styleId: 'energetic', sound: true } }
    const newId = ids()
    // An energetic keyword at 29 s sounds its tick (clock_tick) and its whooshes. Then energetic steps at 11 s land:
    // its title's, first row's and second row's entrances (the rows 0.16 s apart) are three whooshes before its
    // first tick, so the cap's three, in onset order, are all its own, and the keyword's tick file has no clip left.
    const steps = cand({ template: 'steps', title: 'Step by step', items: [{ label: '40%' }, { label: 'fast' }], connector: 'none' }, [4, 10])
    const first = applyGraphics(project, [keptOn('c', 'a', cand({ template: 'keyword', words: 'look', lit: 0 }, [9], { sentence: 's4' }))], [], CLIPS_GRAPHIC_RULE, { fps: FPS, newId, sounds: ALL })
    const second = applyGraphics(first.project, [keptOn('c', 'a', steps)], [], CLIPS_GRAPHIC_RULE, { fps: FPS, newId, sounds: ALL })
    expect([first.problems, second.problems]).toEqual([[], []])
    const files = (p: Project) => new Set(p.clips.filter((c) => c.forGraphic).map((c) => p.assets.find((a) => a.id === c.assetId)!.name))
    // The fixture moves a file off: one the first run used, the second does not.
    expect([...files(first.project)].some((f) => !files(second.project).has(f))).toBe(true)
    expect(second.project.clips.filter((c) => c.forGraphic)).toHaveLength(3)
    const orphans = second.project.assets.filter((a) => a.broughtBy !== undefined && !second.project.clips.some((c) => c.assetId === a.id))
    expect(orphans.map((a) => a.name)).toEqual([])
  })
})

describe('the two Clears over both rules’ graphics (§6.6, §6.14)', () => {
  /** A Clip-it run (its lower third, a counter, a proposal), then a Direct run (a keyword, a proposal of its own). */
  function both(): Project {
    const newId = ids()
    const clips = applyGraphics(setup(), [keptOn('c', 'a', COUNTER), keptOn('c', 'a', PROPOSED)], ['c'], CLIPS_GRAPHIC_RULE, { fps: FPS, newId, sounds: TICK })
    const keyword = cand({ template: 'keyword', words: 'look', lit: 0 }, [9], { sentence: 's4' })
    const direct = applyGraphics(clips.project, [keptOn('c', 'a', keyword), keptOn('c', 'a', PROPOSED)], [], GRAPHIC_RULE, { fps: FPS, newId, sounds: TICK })
    expect([clips.problems, direct.problems]).toEqual([[], []])
    return direct.project
  }
  const graphicsOf = (p: Project, rule: string) => p.clips.filter((c) => c.graphic && c.generatedBy?.rule === rule)

  it('the fixture: three graphics, one proposal per rule, each graphic a sound on its rule’s lane', () => {
    const p = both()
    expect(graphicsOf(p, CLIPS_GRAPHIC_RULE).map((c) => c.graphic!.data.template)).toEqual(['lower-third', 'counter'])
    expect(graphicsOf(p, GRAPHIC_RULE).map((c) => c.graphic!.data.template)).toEqual(['keyword'])
    expect(p.graphicProposals!.map((g) => g.rule)).toEqual([CLIPS_GRAPHIC_RULE, GRAPHIC_RULE])
    expect(p.tracks.filter((t) => t.name === GRAPHIC_SOUND_LANE_NAME)).toHaveLength(1)
    expect(p.tracks.filter((t) => t.name === SOUND_LANE_NAME && t.director)).toHaveLength(1)
  })

  it('Clear graphics takes the Clip-it graphics, their drawn assets, their sounds, their proposals and the emptied "Graphic sounds" track; Direct’s stay', () => {
    const p = both()
    const before = structuredClone(p)
    const cleared = clearGraphics(p)
    expect(p).toEqual(before)
    expect(graphicsOf(cleared, CLIPS_GRAPHIC_RULE)).toEqual([])
    expect(cleared.clips.filter((c) => c.generatedBy?.rule === CLIPS_GRAPHIC_RULE)).toEqual([])
    for (const g of graphicsOf(p, CLIPS_GRAPHIC_RULE)) expect(cleared.assets.map((a) => a.id)).not.toContain(g.assetId)
    expect(cleared.graphicProposals!.map((g) => g.rule)).toEqual([GRAPHIC_RULE])
    expect(cleared.tracks.some((t) => t.name === GRAPHIC_SOUND_LANE_NAME)).toBe(false)
    // Direct's keyword, its sound, its lane and its proposal stay.
    expect(graphicsOf(cleared, GRAPHIC_RULE)).toEqual(graphicsOf(p, GRAPHIC_RULE))
    expect(cleared.clips.filter((c) => c.forGraphic !== undefined).map((c) => c.generatedBy!.rule)).toEqual([GRAPHIC_RULE])
    expect(cleared.tracks.some((t) => t.name === SOUND_LANE_NAME)).toBe(true)
    // A "Graphic sounds" track a clip of yours is on stays.
    const yours = { ...p, clips: [...p.clips, clipOf('mine', 'a', p.tracks.find((t) => t.name === GRAPHIC_SOUND_LANE_NAME)!.id, 2000, 30)] }
    expect(clearGraphics(yours).tracks.some((t) => t.name === GRAPHIC_SOUND_LANE_NAME)).toBe(true)
    // Nothing to take: the same project.
    expect(clearGraphics(cleared)).toBe(cleared)
    expect(CLEAR_GRAPHICS_NOTE).toBe("Direct's graphics stay; Direct's Clear takes them")
  })

  it('Direct’s Clear takes Direct’s graphics, their sounds, their lanes and their proposals; the Clip-it ones stay', () => {
    const p = both()
    const cleared = clearDirector(p)
    expect(graphicsOf(cleared, GRAPHIC_RULE)).toEqual([])
    expect(cleared.clips.filter((c) => c.generatedBy?.rule === GRAPHIC_RULE)).toEqual([])
    for (const g of graphicsOf(p, GRAPHIC_RULE)) expect(cleared.assets.map((a) => a.id)).not.toContain(g.assetId)
    expect(cleared.graphicProposals!.map((g) => g.rule)).toEqual([CLIPS_GRAPHIC_RULE])
    expect(cleared.tracks.some((t) => t.name === SOUND_LANE_NAME)).toBe(false)
    expect(graphicsOf(cleared, CLIPS_GRAPHIC_RULE)).toEqual(graphicsOf(p, CLIPS_GRAPHIC_RULE))
    // Only proposals of Direct's: the Clear still runs (and takes them) with no Director clip on the timeline.
    const onlyProposal = { ...setup(), graphicProposals: p.graphicProposals }
    expect(clearDirector(onlyProposal).graphicProposals!.map((g) => g.rule)).toEqual([CLIPS_GRAPHIC_RULE])
  })
})
