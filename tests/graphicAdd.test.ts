import { describe, expect, it } from 'vitest'
import { CLIPS_GRAPHIC_RULE, addDropped, applyGraphics, graphicDropsOf } from '@shared/graphics/apply'
import { ON_SCREEN_REASON, applyBudget, zoomPunchReason } from '@shared/graphics/budget'
import { NO_CLIP_NOTE } from '@shared/graphics/place'
import { RETIMED_NOTE } from '@shared/graphics/beats'
import { decisionForGraphics, graphicsMenuFor, runGraphicsPass, settleGraphics, type GraphicsBaseline } from '@shared/director/run'
import type { AnswerGraphic } from '@shared/director/schemaGraphics'
import { droppedCandidate } from '@shared/director/validateGraphics'
import { SOUND_ROLES, type SoundPack } from '@shared/director/soundRoles'
import type { GraphicCandidate, GraphicDrop } from '@shared/graphics/template'
import type { Segment, Transcript, Word } from '@shared/transcript'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'

/*
 * Try-out 1 (2026-11-15), piece 4: Add on a dropped graphic, the pure half.
 * What each drop carries (the validator's, graphics as they would have been
 * drawn; applyGraphics', the validated graphic itself), and `addDropped`:
 * Keep's placement with the room rules (gap, count, per minute) not read and
 * every rule of drawing still read. Every transcript here is synthetic and
 * English, built from the session's own script lines.
 */

const FPS = 30

/** A sentence and the start of each of its words, in ms. */
type Line = [string, number[]]
const step = (from: number, n: number, ms: number): number[] => Array.from({ length: n }, (_, i) => from + i * ms)

function transcript(lines: Line[], assetId = 'talk'): Transcript {
  const words: Word[] = []
  const segments: Segment[] = []
  lines.forEach(([text, starts], k) => {
    const first = words.length
    text.split(' ').forEach((w, i) => words.push({ index: words.length, text: w, startMs: starts[i], endMs: starts[i] + 150, confidence: 0.95 }))
    segments.push({ id: `s${String(k).padStart(2, '0')}`, startMs: starts[0], endMs: starts[starts.length - 1] + 150, text, wordStart: first, wordEnd: words.length - 1 })
  })
  return { assetId, language: 'en', model: 'whisper-small', durationMs: 120_000, words, segments }
}

function setup(lines: Line[], seconds: number, extra: Partial<Clip> = {}): { project: Project; clip: Clip } {
  const base = emptyProject('add')
  const trackId = base.tracks.find((t) => t.kind === 'video')!.id
  const asset: MediaAsset = { id: 'talk', path: '/media/talk.mp4', name: 'talk.mp4', kind: 'video', durationFrames: FPS * 120, width: 1080, height: 1920, fps: FPS, hasVideo: true, hasAudio: true, size: 1 }
  const clip: Clip = { id: 'shot', assetId: 'talk', trackId, start: 0, duration: Math.round(FPS * seconds), inPoint: 0, volume: 1, transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR }, ...extra }
  return { clip, project: { ...base, settings: { ...base.settings, width: 1080, height: 1920, fps: FPS }, assets: [asset], clips: [clip], transcripts: { talk: transcript(lines) } } }
}

const answer = (fields: Partial<AnswerGraphic> & Pick<AnswerGraphic, 'sentence' | 'template'>): AnswerGraphic => ({
  title: '', value: '', label: '', items: [], quote: '', words: '', lit: 0, why: 'piece 4', ...fields
})
const cand = (sentence: string, data: GraphicCandidate['data']): GraphicCandidate => ({ sentence, data, bound: [], beatWords: [], why: 'piece 4', source: 'baseline' })

/* s00 negated, s01 a what-if, s02 a fact, s03 a keyword's sentence: the session's script lines. */
const TRUTH: Line[] = [
  ['I do not charge five hundred dollars for an album.', step(1000, 10, 250)], // "five" word 4 at 2.0 s
  ['If I charged ten thousand dollars, nobody would book.', step(5000, 9, 250)], // "ten" word 13 at 5.75 s
  ['Forty percent of my couples book me a year ahead.', step(9000, 10, 250)], // "Forty" word 19 at 9.0 s
  ['Light matters more than gear.', step(13000, 5, 250)]
]

describe('what a dropped graphic carries for Add', () => {
  const { project, clip } = setup(TRUTH, 60)
  const t = project.transcripts.talk
  const [menu] = graphicsMenuFor(project, clip, t)
  const graphics = [
    answer({ sentence: 's00', template: 'counter', value: '$500', label: 'album' }), // negated
    answer({ sentence: 's01', template: 'counter', value: '$10,000', label: 'charged' }), // a what-if
    answer({ sentence: 's00', template: 'counter', value: '$99', label: 'album' }), // not said
    answer({ sentence: 's99', template: 'ring', value: '70%', label: 'couples' }), // not a sentence on the menu
    answer({ sentence: 's03', template: 'keyword', words: 'Light matters more than gear and then some more', lit: 0 }), // over its kept length
    answer({ sentence: 's02', template: 'lower-third' }) // never a model's
  ]
  // An answer holds at most four graphics (MAX_GRAPHICS): two answers, their drops joined.
  const halves = [graphics.slice(0, 3), graphics.slice(3)].map((part) => settleGraphics({ value: { reasoning: 'r', graphics: part }, truncated: false }, menu, t))
  for (const h of halves) expect(h.rejected).toBeNull()
  const settled = { ...halves[0], dropped: halves.flatMap((h) => h.dropped), drops: halves.flatMap((h) => h.drops) }
  const byValue = (text: string): GraphicDrop => {
    const d = settled.drops.find((x) => x.text === text)
    if (!d) throw new Error(`no drop for ${text}: ${settled.rejected} ${JSON.stringify(settled.dropped)}`)
    return d
  }

  it('a negated number carries the graphic as drawn, timed on the words it was refused for', () => {
    const d = byValue('$500')
    expect(d.reason).toContain('said negated')
    expect(d.add).toBeDefined()
    expect(d.add!.clipId).toBe('shot')
    expect(d.add!.assetId).toBe('talk')
    expect(d.add!.candidate.data).toEqual({ template: 'counter', value: '$500', label: 'album' })
    // "five" is word 4: the counter's beat is its value's first word, as a kept counter's would be.
    expect(d.add!.candidate.beatWords).toEqual([4])
    expect(d.add!.candidate.bound).toContain(4)
    expect(d.add!.candidate.proposal).toBeUndefined()
  })

  it('a what-if number carries its own words too', () => {
    const d = byValue('$10,000')
    expect(d.reason).toContain('what-if')
    expect(d.add!.candidate.beatWords).toEqual([13])
  })

  it('a number not said at all is timed on its sentence’s first word, so it lands on its sentence', () => {
    const d = byValue('$99')
    expect(d.reason).toContain("'$99' is not said in s00")
    expect(d.add!.candidate.beatWords).toEqual([0])
    expect(d.add!.candidate.bound).toEqual([])
  })

  it('a graphic that cannot be drawn carries nothing: a sentence not on the menu, a field over its kept length, a model’s lower third', () => {
    const texts = settled.drops.map((d) => d.text)
    for (const [text, why] of [['70%', 'is not a sentence on the menu'], ['Light matters more than gear and then some more', 'characters'], ['', 'is not offered']] as const) {
      const d = settled.drops.find((x) => x.text === text && x.reason.includes(why))
      expect(d, `${text} among ${JSON.stringify(texts)}`).toBeDefined()
      expect(d!.add, text).toBeUndefined()
    }
  })

  it('a lower third or screen card is never a dropped graphic’s Add, even one with words to draw', () => {
    expect(droppedCandidate({ template: 'lower-third', name: 'Asha', role: 'Photographer' }, 's02', 'w', 'baseline', menu, t)).toBeNull()
    // The same call on a template that is drawn gives a graphic: the null above is the template's.
    expect(droppedCandidate({ template: 'keyword', words: 'gear', lit: 0 }, 's03', 'w', 'baseline', menu, t)).not.toBeNull()
  })

  it('the decision record keeps each drop as before, without what Add places', () => {
    const record = decisionForGraphics(settled, null)
    const drops = (record.ops[0] as { drops: GraphicDrop[] }).drops
    expect(drops.length).toBe(settled.drops.length)
    for (const d of drops) expect(Object.keys(d).sort()).toEqual(['clipId', 'reason', 'template', 'text'])
  })
})

/* A ring on 0.25 s, the keyword "gear" at 3.5 s, and a counter at 15 s: a 30 s clip holds one graphic by the count. */
const ROOM: Line[] = [
  ['Forty percent of my couples book me a year ahead.', step(250, 10, 250)], // "Forty" word 0 at 0.25 s
  ['Light matters more than gear.', step(2500, 5, 250)], // "gear" word 14 at 3.5 s
  ['A full wedding costs two thousand five hundred dollars.', step(15000, 9, 250)] // "two" word 19 at 16.0 s
]
const roomBaseline: GraphicsBaseline = () => [
  cand('s00', { template: 'ring', value: '40%', label: 'couples' }),
  cand('s01', { template: 'keyword', words: 'gear', lit: 0 }),
  cand('s02', { template: 'counter', value: '$2,500', label: 'wedding' })
]

async function roomRun(seconds = 30): Promise<{ project: Project; landed: ReturnType<typeof applyGraphics>; drops: GraphicDrop[]; kept: Awaited<ReturnType<typeof runGraphicsPass>>['pair']['kept'] }> {
  const { project, clip } = setup(ROOM, seconds)
  const run = await runGraphicsPass(project, [clip], async () => ({ answer: { error: 'No model is set up' }, model: null }), { baseline: roomBaseline })
  const landed = applyGraphics(project, run.pair.kept, ['shot'], CLIPS_GRAPHIC_RULE, { fps: FPS })
  return { project, landed, drops: graphicDropsOf(project, run.pair.kept, ['shot'], landed.problems), kept: run.pair.kept }
}

describe('Add places a room drop on its own time, the room rules not read', () => {
  it('a room drop carries the validated graphic itself', async () => {
    const { drops, kept } = await roomRun()
    const keyword = drops.find((d) => d.template === 'keyword')!
    expect(keyword.reason).toContain('within 6 s of the ring')
    expect(keyword.add).toBe(kept.find((k) => k.candidate.data.template === 'keyword'))
    const counter = drops.find((d) => d.template === 'counter')!
    expect(counter.reason).toContain('at most one graphic per 20 s of clip')
    expect(counter.add).toBe(kept.find((k) => k.candidate.data.template === 'counter'))
  })

  it('the keyword inside the gap lands, under Find’s rule, on its own word, with no proposal', async () => {
    const { landed, drops } = await roomRun()
    const keyword = drops.find((d) => d.template === 'keyword')!
    const out = addDropped(landed.project, keyword, { fps: FPS })
    expect(out.refused).toBeNull()
    expect(out.clipIds).toHaveLength(1)
    const g = out.project.clips.find((c) => c.id === out.clipIds[0])!
    expect(g.graphic!.data).toEqual({ template: 'keyword', words: 'gear', lit: 0 })
    expect(g.generatedBy!.rule).toBe(CLIPS_GRAPHIC_RULE)
    expect(g.graphic!.proposal).toBeUndefined()
    expect(g.graphic!.grounding!.words).toEqual([14])
    // Its first beat is "gear" at 3.5 s on the timeline.
    expect((g.start / FPS) + Math.min(...g.graphic!.beats)).toBeCloseTo(3.5, 1)
  })

  it('a graphic that carried "check the number" lands checked: the click is the check', async () => {
    const { landed, drops } = await roomRun()
    const counter = drops.find((d) => d.template === 'counter')!
    const marked: GraphicDrop = { ...counter, add: { ...counter.add!, candidate: { ...counter.add!.candidate, proposal: { reason: 'check-the-number', wordSource: 'youtube-asr' } } } }
    const out = addDropped(landed.project, marked, { fps: FPS })
    expect(out.refused).toBeNull()
    expect(out.project.clips.find((c) => c.id === out.clipIds[0])!.graphic!.proposal).toBeUndefined()
    expect(out.project.graphicProposals ?? []).toEqual(landed.project.graphicProposals ?? [])
  })

  it('the counter the count refused lands', async () => {
    const { landed, drops } = await roomRun()
    const out = addDropped(landed.project, drops.find((d) => d.template === 'counter')!, { fps: FPS })
    expect(out.refused).toBeNull()
    expect(out.project.clips.find((c) => c.id === out.clipIds[0])!.graphic!.data.template).toBe('counter')
  })

  it('the per-minute cap is not read either (the budget’s room: false)', () => {
    // 120 s of clip: room for six by the count, so only the per-minute cap reads the two onsets 40 s apart.
    const { project } = setup(ROOM, 120)
    const held: Clip = {
      ...project.clips[0], id: 'held', assetId: 'drawn', trackId: 'v2', start: 0, duration: 30,
      graphic: { data: { template: 'keyword', words: 'held', lit: 0 }, seconds: 1, beats: [0], place: { auto: true, third: 'middle' }, seed: 0, version: 1 }
    }
    const p: Project = { ...project, clips: [...project.clips, held] }
    const one = { clipId: 'shot', rule: CLIPS_GRAPHIC_RULE, start: FPS * 40, duration: 60, spec: { data: { template: 'ring' as const, value: '40%', label: 'couples' }, beats: [0] } }
    expect(applyBudget(p, [one], { perMinute: 1 }).dropped.map((d) => d.reason)).toEqual(['more than 1 graphic in a minute'])
    expect(applyBudget(p, [one], { perMinute: 1, room: false }).kept).toEqual([one])
  })
})

describe('Add still refuses what cannot be drawn rightly, and changes nothing then', () => {
  it('another graphic’s frames: "another graphic is on screen then"', async () => {
    const { landed, drops } = await roomRun()
    // The keyword at 3.5 s starts at 3.0 s; a ring of 2 s from 0 s ends before it. A keyword placed first holds those frames.
    const first = addDropped(landed.project, drops.find((d) => d.template === 'keyword')!, { fps: FPS })
    const again = addDropped(first.project, drops.find((d) => d.template === 'keyword')!, { fps: FPS })
    expect(again.refused).toBe(ON_SCREEN_REASON)
    expect(again.project).toBe(first.project)
    expect(again.clipIds).toEqual([])
  })

  it('a zoom punch under its frames', async () => {
    const { landed, drops } = await roomRun()
    const zoomed: Project = {
      ...landed.project,
      clips: landed.project.clips.map((c) => (c.id === 'shot' ? { ...c, keyframes: { zoom: [{ frame: 0, value: 1 }, { frame: FPS * 10, value: 1.4 }] } } : c))
    }
    const out = addDropped(zoomed, drops.find((d) => d.template === 'keyword')!, { fps: FPS })
    expect(out.refused).toBe(zoomPunchReason(0))
    expect(out.project).toBe(zoomed)
  })

  it('a footage clip that is gone, and one that is retimed', async () => {
    const { landed, drops } = await roomRun()
    const keyword = drops.find((d) => d.template === 'keyword')!
    const gone: Project = { ...landed.project, clips: landed.project.clips.filter((c) => c.id !== 'shot') }
    expect(addDropped(gone, keyword, { fps: FPS }).refused).toBe(NO_CLIP_NOTE)
    const fast: Project = { ...landed.project, clips: landed.project.clips.map((c) => (c.id === 'shot' ? { ...c, speed: 2 } : c)) }
    expect(addDropped(fast, keyword, { fps: FPS }).refused).toBe(RETIMED_NOTE)
  })
})

describe('Add sounds the graphic as Keep does', () => {
  const ALL: SoundPack = ['clock_tick.wav', 'fast_whoosh.wav', 'whoosh_fast.wav', 'sword_swish.wav', 'swoosh_heavy.wav'].map((name) => ({ ...SOUND_ROLES[name], id: name, name, file: `/lib/sfx/${name}` }))

  it('with "Graphic sounds" on, its sounds follow it; off, it lands silent', async () => {
    const { landed, drops } = await roomRun()
    const keyword = drops.find((d) => d.template === 'keyword')!
    const on = addDropped(landed.project, keyword, { fps: FPS, sounds: ALL })
    expect(on.project.clips.filter((c) => c.forGraphic === on.clipIds[0]).length).toBeGreaterThan(0)
    const quiet: Project = { ...landed.project, graphics: { styleId: 'clean', sound: false } }
    const off = addDropped(quiet, keyword, { fps: FPS, sounds: ALL })
    expect(off.refused).toBeNull()
    expect(off.project.clips.filter((c) => c.forGraphic === off.clipIds[0])).toEqual([])
  })
})
