import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { parseModelJson, type CompletionRequest, type CompletionResult } from '@shared/director/provider'
import { notJsonRetryNote } from '@shared/director/ask'
import type { Segment, Transcript, Word } from '@shared/transcript'
import type { GraphicSpec } from '@shared/graphics/template'
import type { AnswerGraphic } from '@shared/director/schemaGraphics'
import { GRAPHIC_RULE } from '@shared/director/apply'
import { GRAPHICS_PASS } from '@shared/director/schemaGraphics'
import { CLEAR_GRAPHICS_NOTE, CLIPS_GRAPHIC_RULE } from '@shared/graphics/apply'
import { ON_SCREEN_REASON, TOO_CLOSE_REASON } from '@shared/graphics/budget'
import { GRAPHICS_BUSY_NOTE, GRAPHICS_CLIP_GONE_NOTE, GRAPHICS_NO_SPEECH_NOTE, useEditor } from '../../src/renderer/src/store'
import { baselineFailedNote } from '@shared/director/run'
import { useCatalog } from '../../src/renderer/src/catalog'

/*
 * Lane T2b, piece 3 (docs/CLIPS.md §6.6 "Store actions", "Where it runs",
 * "Proposals live in"; §6.9; §6.14): the store's findGraphics, keepGraphic,
 * dropGraphic, clearGraphics and setSpeaker, and the place.auto recompute on
 * an aspect change. In a file of its own (graphicStore.test.ts is phase 1's
 * and T3's, 600 lines). The bridge is a fake that answers the graphics schema
 * with what each case sets: no model, no network. Every transcript and the
 * sound library are data built here; the bake is a recorder, as in
 * graphicStore.test.ts.
 */

const bake = vi.hoisted(() => ({ asks: [] as string[] }))
/** Lane T4: the baseline made to throw, for the case that it never fails Find. */
const broken = vi.hoisted(() => ({ baseline: false }))

vi.mock('@shared/director/baselineGraphics', async (original) => {
  const real = await original<typeof import('@shared/director/baselineGraphics')>()
  return {
    ...real,
    baselineGraphics: (...args: Parameters<typeof real.baselineGraphics>) => {
      if (broken.baseline) throw new Error('the baseline broke')
      return real.baselineGraphics(...args)
    }
  }
})

vi.mock('../../src/renderer/src/graphicCanvas', () => ({
  bakeGraphicSequence: async (_spec: unknown, _style: unknown, clipId: string) => {
    bake.asks.push(clipId)
    return null
  },
  forgetGraphicPreview: () => undefined,
  graphicPreviewCanvas: () => null
}))

const FPS = 30
const FILLER = 'The light was soft that day.'

/** `sentences`, one word every 400 ms, segment ids s00, s01, … (the director tests' `talk`). */
function talk(assetId: string, sentences: string[], model = 'whisper-small'): Transcript {
  const words: Word[] = []
  const segments: Segment[] = []
  let index = 0
  sentences.forEach((text, k) => {
    const start = index
    for (const w of text.split(/\s+/u).filter(Boolean)) {
      words.push({ index, text: w, startMs: index * 400, endMs: index * 400 + 350, confidence: null })
      index += 1
    }
    segments.push({ id: `s${String(k).padStart(2, '0')}`, startMs: start * 400, endMs: (index - 1) * 400 + 350, text, wordStart: start, wordEnd: index - 1 })
  })
  return { assetId, language: 'en', model, durationMs: index * 400, words, segments }
}

/*
 * s00 "We signed 40 clients this year." (words 0-5; "40" is word 2, 0.8 s), two fillers, s03 "Keep it simple
 * always today." (words 18-22; "simple" is word 20, 8.0 s), then fillers: 125 words, 50 s.
 */
const SAID = ['We signed 40 clients this year.', FILLER, FILLER, 'Keep it simple always today.', ...Array.from({ length: 17 }, () => FILLER)]

const g = (fields: Partial<AnswerGraphic> & Pick<AnswerGraphic, 'sentence' | 'template'>): AnswerGraphic => ({
  title: '', value: '', label: '', items: [], quote: '', words: '', lit: 0, why: 'it helps', ...fields
})
const COUNTER = g({ sentence: 's00', template: 'counter', value: '40', label: 'clients' })
const KEYWORD = g({ sentence: 's03', template: 'keyword', words: 'simple', lit: 0 })
const QUOTE = g({ sentence: 's03', template: 'quote', quote: 'Keep it simple always today.' })

const footage = (id: string, speaker?: string): MediaAsset => ({
  id, path: `/media/${id}.mp4`, name: id, kind: 'video', durationFrames: FPS * 140, width: 1080, height: 1920, fps: FPS, hasVideo: true, hasAudio: true, size: 1,
  ...(speaker !== undefined ? { speaker } : {})
})
/** 70 s of footage on V1: rule 1 allows three graphics over it (⌊70 ÷ 20⌋). */
const shotOf = (id: string, assetId: string, start: number): Clip => ({
  id, assetId, trackId: 'v1', start, duration: FPS * 70, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 }
})

/** A Direct graphic (GRAPHIC_RULE) over the talk shot at 50 s, far from the run's onsets. */
const directGraphic: Clip = {
  ...shotOf('direct-g', 'drawn-direct-g', FPS * 50),
  trackId: 'v2',
  duration: 60,
  graphic: { data: { template: 'keyword', words: 'later', lit: 0 }, seconds: 2, beats: [0.5], place: { auto: true, third: 'middle' }, seed: 1, version: 1 },
  generatedBy: { rule: GRAPHIC_RULE, reason: 'r' }
}
const drawnAsset = (id: string): MediaAsset => ({ id, path: '', name: 'keyword — graphic', kind: 'image', durationFrames: 300, size: 0, width: 1080, height: 1920, fps: null, hasVideo: true, hasAudio: false })

/*
 * By hand, for the sound cap (GRAPHIC_SOUND_CAP, three a footage clip): counters over the talk shot at frames
 * 60, 300, 540 (onsets 2.5, 10.5, 18.5 s) with their ticks hold the three slots; one more at 780 (26.5 s) is
 * silent under the cap, and its tick, once a slot is free, starts on its beat: 780 + ceil(0.5 × 30) = 795.
 */
const counterAt = (id: string, at: number, rule: string): Clip => ({
  ...directGraphic, id, assetId: `drawn-${id}`, start: at, duration: 90,
  graphic: { data: { template: 'counter', value: '40', label: 'clients' }, seconds: 3, beats: [0.5], place: { auto: true, third: 'middle' }, seed: 1, version: 1 },
  generatedBy: { rule, reason: 'r' }
})
const tickFor = (graphic: Clip): Clip => ({ ...shotOf(`t-${graphic.id}`, 'tick', graphic.start + 15), trackId: 'a1', duration: 2, forGraphic: graphic.id, generatedBy: { rule: graphic.generatedBy!.rule, reason: 'r' } })
const tickFile = (rule: string): MediaAsset => ({ id: 'tick', path: '/lib/sfx/clock_tick.wav', name: 'clock_tick.wav', kind: 'audio', durationFrames: 2, width: null, height: null, fps: null, hasVideo: false, hasAudio: true, size: 1, broughtBy: rule })
/** Three sounded counters under `held`'s rule, then the silent fourth under `fourth`'s, over the talk shot. */
function capHeld(held: string, fourth: string, transcripts: Project['transcripts'] = {}): void {
  const three = [counterAt('h1', 60, held), counterAt('h2', 300, held), counterAt('h3', 540, held)]
  start({
    project: {
      assets: [footage('talk'), tickFile(held), ...['h1', 'h2', 'h3', 'c4'].map((id) => drawnAsset(`drawn-${id}`))],
      clips: [shotOf('shot', 'talk', 0), ...three, ...three.map(tickFor), counterAt('c4', 780, fourth)],
      transcripts
    }
  })
}

let asks: CompletionRequest[]
let answer: (r: CompletionRequest) => Promise<CompletionResult>
const answering = (...graphics: AnswerGraphic[]) => async (): Promise<CompletionResult> => ({
  text: JSON.stringify({ reasoning: 'r', graphics }), provider: 'openai', model: 'fake-model', promptTokens: 1, outputTokens: 1, durationMs: 1, truncated: false
})

function start(over: { speaker?: string; model?: string; project?: Partial<Project> } = {}): Project {
  const base = emptyProject('graphic actions')
  useEditor.setState({
    ...useEditor.getInitialState(),
    project: {
      ...base,
      settings: { ...base.settings, width: 1080, height: 1920, fps: FPS },
      assets: [footage('talk', over.speaker), footage('talk2'), drawnAsset('drawn-direct-g')],
      clips: [shotOf('shot', 'talk', 0), shotOf('shot2', 'talk2', FPS * 70), directGraphic],
      transcripts: { talk: talk('talk', SAID, over.model), talk2: talk('talk2', SAID, over.model) },
      ...over.project
    },
    decisions: [],
    past: [],
    future: [],
    notices: []
  })
  return useEditor.getState().project
}

const state = () => useEditor.getState()
const project = (): Project => state().project
const notices = (): string[] => state().notices.map((n) => n.text)
const graphicsOver = (footageId: string, rule = CLIPS_GRAPHIC_RULE): Clip[] =>
  project().clips.filter((c) => c.graphic && c.generatedBy?.rule === rule && c.start >= clipById(footageId).start && c.start < clipById(footageId).start + clipById(footageId).duration)
const clipById = (id: string): Clip => project().clips.find((c) => c.id === id)!
const soundsOf = (graphicId: string): Clip[] => project().clips.filter((c) => c.forGraphic === graphicId)
const templates = (clips: Clip[]): string[] => clips.map((c) => c.graphic!.data.template)
/** One undo: the project exactly as given, and the history one shorter. */
function undoesTo(before: Project): void {
  const past = state().past.length
  state().undo()
  expect(project()).toEqual(before)
  expect(state().past.length).toBe(past - 1)
}

beforeEach(() => {
  asks = []
  bake.asks = []
  broken.baseline = false
  answer = answering(COUNTER, KEYWORD)
  vi.stubGlobal('window', {
    forge: {
      directorComplete: async (r: CompletionRequest): Promise<CompletionResult> => {
        asks.push(r)
        return answer(r)
      }
    }
  })
  // The library's tick, as the Director reads it (soundPackFor): each counter and keyword gets one.
  useCatalog.setState({
    catalog: { version: 3, generatedAt: '', scannedFrom: '/lib', entries: [{ id: 'clock', kind: 'sfx', name: 'clock tick', file: 'sfx/clock_tick.wav', tags: [], meta: {} }] },
    root: '/lib'
  })
  start()
})

afterEach(() => {
  vi.unstubAllGlobals()
  useCatalog.setState(useCatalog.getInitialState())
})

describe('findGraphics (§6.6, "Where it runs": by hand, from the Transcript tile)', () => {
  it('lands the run under CLIPS_GRAPHIC_RULE, each graphic with its sound, ONE record and ONE undo step; Find again lists nothing twice', async () => {
    const before = project()
    await state().findGraphics('shot')
    // One window, one ask, through the bridge.
    expect(asks).toHaveLength(1)
    const placed = graphicsOver('shot')
    expect(templates(placed)).toEqual(['counter', 'keyword'])
    for (const c of placed) expect(soundsOf(c.id)).toHaveLength(1)
    // Direct's graphic on the same footage clip is sounded with them (graphicSounds re-places the clip's every graphic).
    const sounded = project().clips.filter((c) => c.forGraphic !== undefined).length
    expect(state().decisions.map((d) => [d.pass, d.model])).toEqual([[GRAPHICS_PASS, { id: 'fake-model', runtime: 'openai' }]])
    expect(state().lastGraphics).toMatchObject({ clipId: 'shot', model: 'fake-model' })
    expect(bake.asks.sort()).toEqual(placed.map((c) => c.id).sort())
    expect(notices()).toEqual(['Graphics: 2 placed'])
    expect(state().past).toHaveLength(1)

    await state().findGraphics('shot')
    // Find again: the same two, not four; one sound each; two records, two steps.
    expect(templates(graphicsOver('shot'))).toEqual(['counter', 'keyword'])
    for (const c of graphicsOver('shot')) expect(soundsOf(c.id)).toHaveLength(1)
    expect(project().clips.filter((c) => c.forGraphic !== undefined)).toHaveLength(sounded)
    expect(state().decisions).toHaveLength(2)
    expect(state().past).toHaveLength(2)
    state().undo()
    undoesTo(before)
  })

  it('Find again replaces only that clip’s Clip-it graphics, sounds and proposals; another clip’s and Direct’s stay', async () => {
    // Both YouTube transcripts, so each clip's counter waits as a proposal: shot2's must outlive Find again on shot.
    start({ model: 'youtube-asr' })
    await state().findGraphics('shot2')
    await state().findGraphics('shot')
    const otherProposals = (project().graphicProposals ?? []).filter((p) => p.clipId === 'shot2')
    expect(otherProposals).toHaveLength(1)
    const other = graphicsOver('shot2').map((c) => c.id)
    const otherSounds = other.flatMap((id) => soundsOf(id).map((c) => c.id))
    const old = graphicsOver('shot').map((c) => c.id)
    const oldSounds = old.flatMap((id) => soundsOf(id).map((c) => c.id))
    expect(old).toHaveLength(1)
    expect(oldSounds).toHaveLength(1)
    expect((project().graphicProposals ?? []).map((p) => p.clipId)).toEqual(['shot2', 'shot'])
    const before = project()

    answer = answering(QUOTE)
    await state().findGraphics('shot')
    const now = graphicsOver('shot')
    expect(templates(now)).toEqual(['quote'])
    for (const id of [...old, ...oldSounds]) expect(project().clips.some((c) => c.id === id)).toBe(false)
    // The old run's proposal went with it; the new run has none; shot2's waits as it was.
    expect(project().graphicProposals ?? []).toEqual(otherProposals)
    // shot2's graphics and sounds, and Direct's graphic, are the same clips.
    expect(graphicsOver('shot2').map((c) => c.id)).toEqual(other)
    expect(other.flatMap((id) => soundsOf(id).map((c) => c.id))).toEqual(otherSounds)
    expect(clipById('direct-g')).toEqual(directGraphic)
    undoesTo(before)
  })

  it('a proposal is not placed until Keep; Keep places it through the budget in ONE step and it leaves the list', async () => {
    start({ model: 'youtube-asr' })
    await state().findGraphics('shot')
    expect(templates(graphicsOver('shot'))).toEqual(['keyword'])
    const [proposal] = project().graphicProposals!
    expect(proposal).toMatchObject({ clipId: 'shot', rule: CLIPS_GRAPHIC_RULE, note: 'check the number: heard "40 clients"' })
    expect(notices()).toEqual(['Graphics: 1 placed, 1 to check'])
    const before = project()
    bake.asks = []

    expect(state().keepGraphic(proposal.id)).toBeNull()
    const placed = graphicsOver('shot')
    expect(templates(placed)).toEqual(['keyword', 'counter'])
    const counter = placed[1]
    expect(counter.graphic!.proposal).toBeUndefined()
    expect(counter.graphic!.data).toEqual({ template: 'counter', value: '40', label: 'clients' })
    expect(soundsOf(counter.id)).toHaveLength(1)
    expect(project().graphicProposals).toEqual([])
    expect(bake.asks).toEqual([counter.id])
    undoesTo(before)
  })

  it('Keep refused by the budget says why, changes nothing and leaves the proposal listed', async () => {
    start({ model: 'youtube-asr' })
    await state().findGraphics('shot')
    const [proposal] = project().graphicProposals!
    // A graphic of yours on screen over the counter's span, 8 s from frame 0, its onset 6.9 s (6.1 s from the
    // counter's 0.8 s, so the gap holds and rule 2 is the one broken): the placed one holds.
    const spec: GraphicSpec = { data: { template: 'counter', value: '7', label: 'mine' }, seconds: 8, beats: [6.9], place: { auto: false, box: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 } }, seed: 1, version: 1 }
    await state().addGraphicClip('v1', 0, spec)
    const before = project()
    const past = state().past.length
    useEditor.setState({ notices: [] })

    const refused = state().keepGraphic(proposal.id)
    expect(refused).toBe(ON_SCREEN_REASON)
    expect(notices()).toEqual([ON_SCREEN_REASON])
    expect(project()).toBe(before)
    expect(state().past.length).toBe(past)
    expect(project().graphicProposals!.map((p) => p.id)).toEqual([proposal.id])
  })
})

describe('dropGraphic and clearGraphics (§6.6, §6.14)', () => {
  it('Drop takes the graphic, its drawn asset and its sounds, and nothing else; ONE undo', async () => {
    await state().findGraphics('shot2')
    await state().findGraphics('shot')
    const [counter, keyword] = graphicsOver('shot')
    const keywordSound = soundsOf(keyword.id)[0]
    const counterSound = soundsOf(counter.id)[0]
    const elsewhere = graphicsOver('shot2').flatMap((c) => soundsOf(c.id))
    expect(elsewhere).toHaveLength(2)
    const before = project()
    /** A sound as placed: which graphic, where, on which file; not its id (the clip's sounds are placed again, resoundAfterClear). */
    const placedAs = (c: Clip): unknown[] => [c.forGraphic, c.start, c.duration, c.inPoint, c.trackId, project().assets.find((a) => a.id === c.assetId)?.path]
    const keywordAs = [keyword.id, keywordSound.start, keywordSound.duration, keywordSound.inPoint, keywordSound.trackId, '/lib/sfx/clock_tick.wav']

    state().dropGraphic(counter.id)
    expect(project().clips.some((c) => c.id === counter.id)).toBe(false)
    expect(project().assets.some((a) => a.id === counter.assetId)).toBe(false)
    expect(project().clips.some((c) => c.id === counterSound.id)).toBe(false)
    // The keyword, its drawn asset and its sound where it was, on the tick file.
    expect(clipById(keyword.id)).toEqual(keyword)
    expect(project().assets.some((a) => a.id === keyword.assetId)).toBe(true)
    expect(soundsOf(keyword.id).map(placedAs)).toEqual([keywordAs])
    expect(clipById('direct-g')).toEqual(directGraphic)
    // Another clip's graphics' sounds are the same clips, untouched.
    for (const c of elsewhere) expect(clipById(c.id)).toEqual(c)
    undoesTo(before)
  })

  it('Drop gives the sound slot its graphic held back to a graphic silent under the cap, on its beat, under its rule; ONE undo', () => {
    capHeld(CLIPS_GRAPHIC_RULE, CLIPS_GRAPHIC_RULE)
    const before = project()
    expect(soundsOf('c4')).toEqual([])
    state().dropGraphic('h1')
    expect(project().clips.some((c) => c.id === 'h1' || c.forGraphic === 'h1')).toBe(false)
    expect(soundsOf('c4').map((c) => [c.start, c.generatedBy?.rule])).toEqual([[795, CLIPS_GRAPHIC_RULE]])
    undoesTo(before)
  })

  it('Drop on a proposal removes it, and only it', async () => {
    start({ model: 'youtube-asr' })
    await state().findGraphics('shot')
    const before = project()
    const [proposal] = project().graphicProposals!
    state().dropGraphic(proposal.id)
    expect(project().graphicProposals).toEqual([])
    expect(project().clips).toEqual(before.clips)
    undoesTo(before)
  })

  it('Clear graphics takes every Clip-it graphic, drawn asset, sound, file and proposal, leaves Direct’s, and says so; ONE undo', async () => {
    await state().findGraphics('shot2')
    start({ model: 'youtube-asr', project: { ...project(), transcripts: { ...project().transcripts, talk: talk('talk', SAID, 'youtube-asr') } } })
    await state().findGraphics('shot')
    expect(project().graphicProposals).toHaveLength(1)
    const before = project()
    useEditor.setState({ notices: [] })

    state().clearGraphics()
    expect(project().clips.filter((c) => c.generatedBy?.rule === CLIPS_GRAPHIC_RULE)).toEqual([])
    // The sounds left are Direct's graphic's, placed again under its rule now the Clip-it ones are gone (resoundAfterClear).
    expect(project().clips.filter((c) => c.forGraphic !== undefined).map((c) => [c.forGraphic, c.generatedBy?.rule])).toEqual([['direct-g', GRAPHIC_RULE]])
    expect(project().assets.filter((a) => a.name.endsWith('— graphic')).map((a) => a.id)).toEqual(['drawn-direct-g'])
    // The one brought file left is the tick Direct's sound stands on (§6.14 case 4: Clear graphics keeps a file a survivor uses).
    const directSound = project().clips.find((c) => c.forGraphic === 'direct-g')!
    expect(project().assets.filter((a) => a.broughtBy !== undefined).map((a) => a.id)).toEqual([directSound.assetId])
    expect(project().graphicProposals).toEqual([])
    expect(clipById('direct-g')).toEqual(directGraphic)
    expect(notices()).toEqual([CLEAR_GRAPHICS_NOTE])
    undoesTo(before)
  })
})

describe('findGraphics: the run’s edges', () => {
  /*
   * With no model the baseline runs (§6.10, lane T4). By hand, over SAID: no sentence holds a percent or a
   * currency amount ("40 clients" has no unit, rule 4), none opens with an ordinal, and every one is at most
   * eight words, not a question, ending on a content word, so each gives a keyword of its last word: "year"
   * (s00, word 5, 2.0 s), "day" (s01, word 11, 4.4 s; s02, word 17, 6.8 s, …), "today" (s03, word 22, 8.8 s).
   * Rule 10 over the window (its words span 0 to 49.75 s, so at most ⌊49.75 ÷ 20⌋ = 2, onsets 6 s apart):
   * "year" stays, the next two "day"s are within 6 s of it, "today" (6.8 s after) stays, and the cap drops the rest.
   */
  it('with no model it still completes, the lower third placed from the Speaker and the baseline’s graphics, the record naming no model', async () => {
    start({ speaker: 'Ana' })
    answer = async () => {
      throw new Error('No model is set up')
    }
    const before = project()
    await state().findGraphics('shot')
    // The lower third from 0 s holds the screen when "year" lands at 2.0 s (the budget, §6.9): "today" is placed.
    expect(graphicsOver('shot').map((c) => c.graphic!.data)).toEqual([
      { template: 'lower-third', name: 'Ana', role: '' },
      { template: 'keyword', words: 'today', lit: 0 }
    ])
    expect(state().decisions.map((d) => d.model)).toEqual([{ id: 'baseline', runtime: 'none' }])
    expect(state().lastGraphics!.notes).toContain("the baseline's graphics are used for sentences s00 to s20: No model is set up")
    expect(state().lastGraphics!.model).toBe('baseline')
    expect(state().findingGraphics).toBeNull()
    undoesTo(before)
  })

  it('with no model and no Speaker it still completes: the baseline’s graphics placed, ONE record naming no model, the note', async () => {
    answer = async () => {
      throw new Error('No model is set up')
    }
    const before = project()
    await state().findGraphics('shot')
    expect(graphicsOver('shot').map((c) => [c.graphic!.data, c.graphic!.grounding!.sentence])).toEqual([
      [{ template: 'keyword', words: 'year', lit: 0 }, 's00'],
      [{ template: 'keyword', words: 'today', lit: 0 }, 's03']
    ])
    expect(project().graphicProposals ?? []).toEqual([])
    expect(state().decisions.map((d) => [d.pass, d.model])).toEqual([[GRAPHICS_PASS, { id: 'baseline', runtime: 'none' }]])
    const op = state().decisions[0].ops[0] as { baseline: boolean; graphics: { source: string }[] }
    expect(op.baseline).toBe(true)
    expect(op.graphics.map((c) => c.source)).toEqual(['baseline', 'baseline'])
    expect(state().lastGraphics!.notes).toContain("the baseline's graphics are used for sentences s00 to s20: No model is set up")
    expect(state().findingGraphics).toBeNull()
    expect(state().past).toHaveLength(1)
    undoesTo(before)
  })

  /*
   * Two windows (§6.6: 24 sentences a menu). s00 "We signed 40 clients this year.", then 29 fillers of six words:
   * s_k starts at word 6k. The 70 s shot shows s00 to s23 (window 1) and s24 to s29, of s29 only its first word
   * "The" (word 174 at 69.6 s), so window 2 is s24 to s29. The model answers window 1 with the counter and is cut
   * off on window 2. By hand, window 2's baseline: each filler's keyword "day" (s24's word 149 at 59.6 s, then
   * every 2.4 s), s29's "The" none; rule 10 over the window (57.6 to 69.95 s, so ⌊12.35 ÷ 20⌋ → 1): s24's alone.
   */
  const THIRTY = ['We signed 40 clients this year.', ...Array.from({ length: 29 }, () => FILLER)]
  const cutOffOnWindow2 = (cutAll = false) => async (r: CompletionRequest): Promise<CompletionResult> => ({
    ...(await answering(COUNTER)()),
    truncated: cutAll || r.user.includes('s24')
  })

  it('a model whose answer for one of two windows is rejected: that window alone comes from the baseline, and the note says so; ONE undo', async () => {
    start({ project: { transcripts: { talk: talk('talk', THIRTY), talk2: talk('talk2', SAID) } } })
    answer = cutOffOnWindow2()
    const before = project()
    await state().findGraphics('shot')
    expect(asks).toHaveLength(2)
    expect(graphicsOver('shot').map((c) => [c.graphic!.data, c.graphic!.grounding!.sentence])).toEqual([
      [{ template: 'counter', value: '40', label: 'clients' }, 's00'],
      [{ template: 'keyword', words: 'day', lit: 0 }, 's24']
    ])
    expect(state().lastGraphics!.notes).toContain("the baseline's graphics are used for sentences s24 to s29: The model's graphics ran out of room before it finished")
    // A model answered window 1, so the record names it; its one op says which graphic is whose.
    expect(state().decisions.map((d) => d.model)).toEqual([{ id: 'fake-model', runtime: 'openai' }])
    const op = state().decisions[0].ops[0] as { baseline: boolean; graphics: { source: string; sentence: string }[] }
    expect(op.baseline).toBe(false)
    expect(op.graphics.map((c) => [c.source, c.sentence])).toEqual([['model', 's00'], ['baseline', 's24']])
    expect(state().past).toHaveLength(1)
    undoesTo(before)
  })

  it('a model whose every answer is rejected: the baseline’s graphics, and the record names no model', async () => {
    start({ project: { transcripts: { talk: talk('talk', THIRTY), talk2: talk('talk2', SAID) } } })
    answer = cutOffOnWindow2(true)
    await state().findGraphics('shot')
    expect(asks).toHaveLength(2)
    expect(state().decisions.map((d) => d.model)).toEqual([{ id: 'baseline', runtime: 'none' }])
    expect(state().lastGraphics!.model).toBe('baseline')
    // By hand: window 1's keywords are "year" (s00, 2.0 s) and every filler's "day". A keyword's run binds to its
    // first occurrence in the stretch (the sentence either side, §6.7), so s03's "day" lands on s02's (word 17,
    // 6.8 s) and s04's on s03's (word 23, 9.2 s): rule 10 keeps "year" and s04's (7.2 s after), the cap of
    // ⌊57.55 ÷ 20⌋ = 2 drops the rest. Window 2's s24 keyword (on s23's "day", 57.2 s) is dropped by the budget.
    // Membership only: where a keyword binds a sentence early (s04's "day" on s03's word) is an open question of
    // the validator's binding, not this case's; s00's "year" is placed whatever is decided there.
    expect(graphicsOver('shot').map((c) => c.graphic!.grounding!.sentence)).toContain('s00')
  })

  it('the ask\'s retry note (the first answer not JSON) reaches the run\'s notes', async () => {
    let calls = 0
    answer = async () => {
      calls += 1
      return calls === 1 ? { ...(await answering()()), text: 'I cannot answer in JSON.' } : answering(COUNTER)()
    }
    await state().findGraphics('shot')
    expect(asks).toHaveLength(2)
    const parsed = parseModelJson('I cannot answer in JSON.')
    expect('error' in parsed).toBe(true)
    expect(state().lastGraphics!.notes).toContain(notJsonRetryNote((parsed as { error: string }).error, true))
  })

  it('a number heard on a YouTube track still waits for Keep on the baseline route', async () => {
    const said = ['We charged $1,200 for the album.', ...SAID.slice(1)]
    start({ project: { transcripts: { talk: talk('talk', said, 'youtube-asr'), talk2: talk('talk2', SAID) } } })
    answer = async () => {
      throw new Error('No model is set up')
    }
    await state().findGraphics('shot')
    // The counter is the baseline's, and it waits (a proposal is not spaced, §6.7 rule 10); the keywords hold no
    // number and are placed. By hand: s01's "day" (word 11, 4.4 s); s02's (on s01's "day") and s03's "today"
    // (8.8 s) within 6 s of it; s04's "day" (s03 holds none, so its own word 28, 11.2 s); s05 on past the cap of 2.
    expect(graphicsOver('shot').map((c) => [c.graphic!.data.template, c.graphic!.grounding!.sentence])).toEqual([
      ['keyword', 's01'],
      ['keyword', 's04']
    ])
    const proposals = project().graphicProposals ?? []
    expect(proposals.map((p) => [p.clipId, p.rule, p.spec.data, p.spec.proposal])).toEqual([
      ['shot', CLIPS_GRAPHIC_RULE, { template: 'counter', value: '$1,200', label: 'album' }, { reason: 'check-the-number', wordSource: 'youtube-asr' }]
    ])
    // The window's note, and one spacing note for each of the other 18 keywords (21 sentences, less the counter and the two placed).
    expect(notices()).toEqual(['Graphics: 2 placed, 1 to check — 19 notes'])
    // Keep is refused while s01's keyword is 3.2 s from the counter's "$1,200" (1.2 s); dropped, Keep places it in ONE step.
    expect(state().keepGraphic(proposals[0].id)).toBe(TOO_CLOSE_REASON)
    state().dropGraphic(graphicsOver('shot')[0].id)
    const before = project()
    expect(state().keepGraphic(proposals[0].id)).toBeNull()
    expect(graphicsOver('shot').map((c) => c.graphic!.data)).toContainEqual({ template: 'counter', value: '$1,200', label: 'album' })
    expect(project().graphicProposals).toEqual([])
    undoesTo(before)
  })

  it('a baseline that throws never fails Find: the run completes, the window has no graphics, and the notes say why', async () => {
    broken.baseline = true
    answer = async () => {
      throw new Error('No model is set up')
    }
    await state().findGraphics('shot')
    expect(graphicsOver('shot')).toEqual([])
    expect(state().lastGraphics!.notes).toEqual(
      expect.arrayContaining(['no graphics for sentences s00 to s20: No model is set up', baselineFailedNote('the baseline broke')])
    )
    expect(state().decisions.map((d) => d.model)).toEqual([{ id: 'baseline', runtime: 'none' }])
    expect(state().findingGraphics).toBeNull()
    expect(notices()).toEqual(['Graphics: 0 placed — 2 notes'])
  })

  it('a clip with no transcript, or whose span shows no word of it, asks nothing, clears nothing and records nothing', async () => {
    await state().findGraphics('shot')
    const placed = graphicsOver('shot')
    expect(placed).toHaveLength(2)
    const past = state().past.length
    // Its transcript taken away: Find again keeps the run it has.
    const { talk: _gone, ...rest } = project().transcripts
    useEditor.setState({ project: { ...project(), transcripts: rest }, notices: [] })
    await state().findGraphics('shot')
    expect(asks).toHaveLength(1)
    expect(graphicsOver('shot')).toEqual(placed)
    expect(state().decisions).toHaveLength(1)
    expect(state().past.length).toBe(past)
    expect(notices()).toEqual([GRAPHICS_NO_SPEECH_NOTE])
    // Every word 100 s later, past the 70 s shot: a transcript, but no speech shown.
    const late = talk('talk', SAID)
    const shifted: Transcript = { ...late, words: late.words.map((w) => ({ ...w, startMs: w.startMs + 100_000, endMs: w.endMs + 100_000 })), segments: late.segments.map((s) => ({ ...s, startMs: s.startMs + 100_000, endMs: s.endMs + 100_000 })) }
    useEditor.setState({ project: { ...project(), transcripts: { ...rest, talk: shifted } }, notices: [] })
    await state().findGraphics('shot')
    expect(asks).toHaveLength(1)
    expect(graphicsOver('shot')).toEqual(placed)
    expect(state().decisions).toHaveLength(1)
    expect(notices()).toEqual([GRAPHICS_NO_SPEECH_NOTE])
  })

  it('Find again that lands nothing gives Direct’s graphic back the sound slot the old run held, in the same step', async () => {
    capHeld(CLIPS_GRAPHIC_RULE, GRAPHIC_RULE, { talk: talk('talk', SAID) })
    answer = answering()
    const before = project()
    expect(soundsOf('c4')).toEqual([])
    await state().findGraphics('shot')
    expect(project().clips.filter((c) => c.generatedBy?.rule === CLIPS_GRAPHIC_RULE)).toEqual([])
    expect(soundsOf('c4').map((c) => [c.start, c.generatedBy?.rule])).toEqual([[795, GRAPHIC_RULE]])
    undoesTo(before)
  })

  it('a second press while one runs is refused; a clip removed while the ask was out gets nothing and no record', async () => {
    let release: () => void = () => undefined
    answer = (r) => new Promise((resolve) => {
      release = () => void answering(COUNTER, KEYWORD)().then(resolve)
      void r
    })
    const first = state().findGraphics('shot')
    // Not awaited: a second press that asked would wait on an answer never given; a short race reads it at once.
    await Promise.race([state().findGraphics('shot2'), new Promise((resolve) => setTimeout(resolve, 50))])
    expect(notices()).toEqual([GRAPHICS_BUSY_NOTE])
    expect(asks).toHaveLength(1)
    state().removeClip('shot')
    release()
    await first
    expect(project().clips.filter((c) => c.generatedBy?.rule === CLIPS_GRAPHIC_RULE)).toEqual([])
    expect(state().decisions).toEqual([])
    expect(notices()).toEqual([GRAPHICS_BUSY_NOTE, GRAPHICS_CLIP_GONE_NOTE])
    expect(state().findingGraphics).toBeNull()
  })
})

describe('setSpeaker (§6.6 "Speaker", §16.31)', () => {
  it('writes MediaAsset.speaker and redraws exactly the graphics that drew the old name, in ONE step', async () => {
    // talk2's Speaker is 'Ana' too: its lower third drew the same name and is not this asset's.
    start({ project: { assets: [footage('talk', 'Ana'), footage('talk2', 'Ana'), drawnAsset('drawn-direct-g')] } })
    answer = answering(QUOTE)
    await state().findGraphics('shot')
    answer = answering(KEYWORD)
    await state().findGraphics('shot2')
    const [lower, quote] = graphicsOver('shot')
    expect(lower.graphic!.data).toEqual({ template: 'lower-third', name: 'Ana', role: '' })
    expect(quote.graphic!.data).toMatchObject({ template: 'quote', speaker: 'Ana' })
    const untouched = graphicsOver('shot2')
    expect(untouched.map((c) => c.graphic!.data)).toContainEqual({ template: 'lower-third', name: 'Ana', role: '' })
    const before = project()
    bake.asks = []

    state().setSpeaker('talk', 'Ana Rao')
    expect(project().assets.find((a) => a.id === 'talk')!.speaker).toBe('Ana Rao')
    expect(clipById(lower.id).graphic).toMatchObject({ data: { name: 'Ana Rao' }, version: lower.graphic!.version + 1 })
    expect(clipById(quote.id).graphic).toMatchObject({ data: { speaker: 'Ana Rao' }, version: quote.graphic!.version + 1 })
    for (const c of untouched) expect(clipById(c.id)).toEqual(c)
    expect(bake.asks.sort()).toEqual([lower.id, quote.id].sort())
    undoesTo(before)

    // Only spaces is no Speaker: the field goes; the placed lower third keeps the name it drew, the quote has none.
    state().setSpeaker('talk', '   ')
    expect('speaker' in project().assets.find((a) => a.id === 'talk')!).toBe(false)
    expect(clipById(lower.id).graphic!.data).toMatchObject({ name: 'Ana' })
    expect(clipById(quote.id).graphic!.data).toMatchObject({ speaker: '' })
  })

  it('a Speaker with spaces around it is stored and drawn trimmed, so the lower third and the quote draw one name and both follow it', async () => {
    start({ speaker: ' Ana ' })
    answer = answering(QUOTE)
    await state().findGraphics('shot')
    const [lower, quote] = graphicsOver('shot')
    expect(lower.graphic!.data).toEqual({ template: 'lower-third', name: 'Ana', role: '' })
    expect(quote.graphic!.data).toMatchObject({ template: 'quote', speaker: 'Ana' })
    const drawn = (): unknown[] => [clipById(lower.id).graphic!.data, (clipById(quote.id).graphic!.data as { speaker: string }).speaker]
    const speakerOf = (): string | undefined => project().assets.find((a) => a.id === 'talk')!.speaker
    bake.asks = []

    state().setSpeaker('talk', 'Bea')
    expect(drawn()).toEqual([{ template: 'lower-third', name: 'Bea', role: '' }, 'Bea'])
    expect(bake.asks.sort()).toEqual([lower.id, quote.id].sort())

    // The same name with spaces: stored 'Bea', nothing drawn differently, nothing rebaked.
    bake.asks = []
    state().setSpeaker('talk', '  Bea  ')
    expect(speakerOf()).toBe('Bea')
    expect(drawn()).toEqual([{ template: 'lower-third', name: 'Bea', role: '' }, 'Bea'])
    expect(bake.asks).toEqual([])

    state().setSpeaker('talk', '  Cy ')
    expect(speakerOf()).toBe('Cy')
    expect(drawn()).toEqual([{ template: 'lower-third', name: 'Cy', role: '' }, 'Cy'])
    expect(bake.asks.sort()).toEqual([lower.id, quote.id].sort())
  })
})

describe('place.auto on an aspect change (§6.9)', () => {
  it('an auto place is placed again and a dragged box is kept, the aspect change still ONE undo', async () => {
    const auto: Clip = { ...directGraphic, id: 'auto-g', start: 0, graphic: { ...directGraphic.graphic!, place: { auto: true, third: 'top' } } }
    const box = { x: 0.2, y: 0.1, width: 0.5, height: 0.2 }
    const dragged: Clip = { ...directGraphic, id: 'dragged-g', start: FPS * 20, graphic: { ...directGraphic.graphic!, place: { auto: false, box } } }
    start({ project: { clips: [shotOf('shot', 'talk', 0), auto, dragged], transcripts: {} } })
    const before = project()

    state().setAspect('16:9')
    await new Promise((resolve) => setTimeout(resolve, 0))
    // A keyword over the talk shot, captions at the bottom, no subject track: the middle (§6.9 step 3).
    expect(clipById('auto-g').graphic).toMatchObject({ place: { auto: true, third: 'middle' }, version: 2 })
    expect(clipById('dragged-g').graphic).toEqual(dragged.graphic)
    expect(bake.asks.sort()).toEqual(['auto-g', 'dragged-g'])
    undoesTo(before)
  })

  it('a rate change moves no third: an auto place stays where it was', async () => {
    const auto: Clip = { ...directGraphic, id: 'auto-g', start: 0, graphic: { ...directGraphic.graphic!, place: { auto: true, third: 'top' } } }
    start({ project: { clips: [shotOf('shot', 'talk', 0), auto], transcripts: {} } })
    state().setFrameRate(25)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(clipById('auto-g').graphic).toMatchObject({ place: { auto: true, third: 'top' }, version: 1 })
  })

  it('a reframe of the footage beneath re-places an auto place and rebakes it, keeps a dragged box and does not rebake it, history-neutral', async () => {
    // `subject: null` (not taken): no onset target beneath, so only the recompute can ask for the rebake.
    const auto: Clip = { ...directGraphic, id: 'auto-g', start: 0, graphic: { ...directGraphic.graphic!, subject: null, place: { auto: true, third: 'top' } } }
    const box = { x: 0.2, y: 0.1, width: 0.5, height: 0.2 }
    const dragged: Clip = { ...directGraphic, id: 'dragged-g', start: FPS * 20, graphic: { ...directGraphic.graphic!, subject: null, place: { auto: false, box } } }
    start({ project: { clips: [shotOf('shot', 'talk', 0), auto, dragged], transcripts: {} } })
    const past = state().past.length

    await state().rebakeFollowed(['talk'])
    expect(clipById('auto-g').graphic).toMatchObject({ place: { auto: true, third: 'middle' }, version: 2 })
    expect(clipById('dragged-g').graphic).toEqual(dragged.graphic)
    expect(bake.asks).toEqual(['auto-g'])
    expect(state().past.length).toBe(past)
  })
})

describe('Direct’s Clear in the store (§6.14, resoundAfterClear)', () => {
  it('puts back the sound a Direct graphic held a Clip-it graphic out of, in ONE step', () => {
    // By hand: three Direct counters over the talk shot (onsets 2.5, 10.5, 18.5 s) hold the three sound slots
    // (GRAPHIC_SOUND_CAP) with their ticks; a Clip-it counter at 26.5 s, later, is silent under the cap.
    const counter = (id: string, at: number, rule: string): Clip => ({
      ...directGraphic, id, assetId: `drawn-${id}`, start: at, duration: 90,
      graphic: { data: { template: 'counter', value: '40', label: 'clients' }, seconds: 3, beats: [0.5], place: { auto: true, third: 'middle' }, seed: 1, version: 1 },
      generatedBy: { rule, reason: 'r' }
    })
    const tick = (graphicId: string, at: number): Clip => ({ ...shotOf(`t-${graphicId}`, 'tick', at), trackId: 'a1', duration: 2, forGraphic: graphicId, generatedBy: { rule: GRAPHIC_RULE, reason: 'r' } })
    const tickFile: MediaAsset = { id: 'tick', path: '/lib/sfx/clock_tick.wav', name: 'clock_tick.wav', kind: 'audio', durationFrames: 2, width: null, height: null, fps: null, hasVideo: false, hasAudio: true, size: 1, broughtBy: GRAPHIC_RULE }
    const ds = [counter('d1', 60, GRAPHIC_RULE), counter('d2', 300, GRAPHIC_RULE), counter('d3', 540, GRAPHIC_RULE)]
    start({
      project: {
        assets: [footage('talk'), tickFile, ...['d1', 'd2', 'd3', 'c4'].map((id) => drawnAsset(`drawn-${id}`))],
        clips: [shotOf('shot', 'talk', 0), ...ds, ...ds.map((d) => tick(d.id, d.start + 15)), counter('c4', 780, CLIPS_GRAPHIC_RULE)],
        transcripts: {}
      }
    })
    const before = project()
    expect(soundsOf('c4')).toEqual([])
    state().clearDirectorOutput()
    expect(project().clips.filter((c) => c.generatedBy?.rule === GRAPHIC_RULE)).toEqual([])
    // The Clip-it counter's tick, on its beat: 780 + ceil(0.5 × 30) = 795, under its own rule.
    expect(soundsOf('c4').map((c) => [c.start, c.generatedBy?.rule])).toEqual([[795, CLIPS_GRAPHIC_RULE]])
    undoesTo(before)
  })
})
