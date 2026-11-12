import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import type { CompletionRequest, CompletionResult } from '@shared/director/provider'
import type { Segment, Transcript, Word } from '@shared/transcript'
import type { GraphicSpec } from '@shared/graphics/template'
import type { AnswerGraphic } from '@shared/director/schemaGraphics'
import { GRAPHIC_RULE } from '@shared/director/apply'
import { GRAPHICS_PASS } from '@shared/director/schemaGraphics'
import { CLEAR_GRAPHICS_NOTE, CLIPS_GRAPHIC_RULE } from '@shared/graphics/apply'
import { ON_SCREEN_REASON } from '@shared/graphics/budget'
import { GRAPHICS_BUSY_NOTE, GRAPHICS_CLIP_GONE_NOTE, useEditor } from '../../src/renderer/src/store'
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
    undoesTo(state().past.at(-1)!)
    undoesTo(before)
  })

  it('Find again replaces only that clip’s Clip-it graphics, sounds and proposals; another clip’s and Direct’s stay', async () => {
    await state().findGraphics('shot2')
    // shot: a YouTube transcript, so its counter waits as a proposal.
    useEditor.setState({ project: { ...project(), transcripts: { ...project().transcripts, talk: talk('talk', SAID, 'youtube-asr') } } })
    await state().findGraphics('shot')
    const other = graphicsOver('shot2').map((c) => c.id)
    const otherSounds = other.flatMap((id) => soundsOf(id).map((c) => c.id))
    const old = graphicsOver('shot').map((c) => c.id)
    const oldSounds = old.flatMap((id) => soundsOf(id).map((c) => c.id))
    expect(old).toHaveLength(1)
    expect(oldSounds).toHaveLength(1)
    expect((project().graphicProposals ?? []).map((p) => p.clipId)).toEqual(['shot'])
    const before = project()

    answer = answering(QUOTE)
    await state().findGraphics('shot')
    const now = graphicsOver('shot')
    expect(templates(now)).toEqual(['quote'])
    for (const id of [...old, ...oldSounds]) expect(project().clips.some((c) => c.id === id)).toBe(false)
    // The old run's proposal went with it; the new run has none.
    expect(project().graphicProposals ?? []).toEqual([])
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
  it('with no model it still completes, the lower third placed from the Speaker, the record naming no model', async () => {
    start({ speaker: 'Ana' })
    answer = async () => {
      throw new Error('No model is set up')
    }
    await state().findGraphics('shot')
    expect(templates(graphicsOver('shot'))).toEqual(['lower-third'])
    expect(graphicsOver('shot')[0].graphic!.data).toEqual({ template: 'lower-third', name: 'Ana', role: '' })
    expect(state().decisions.map((d) => d.model)).toEqual([{ id: 'baseline', runtime: 'none' }])
    expect(state().lastGraphics!.notes).toContain('no graphics for sentences s00 to s20: No model is set up')
    expect(state().findingGraphics).toBeNull()
  })

  it('a second press while one runs is refused; a clip removed while the ask was out gets nothing and no record', async () => {
    let release: () => void = () => undefined
    answer = (r) => new Promise((resolve) => {
      release = () => void answering(COUNTER, KEYWORD)().then(resolve)
      void r
    })
    const first = state().findGraphics('shot')
    await state().findGraphics('shot2')
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
    start({ speaker: 'Ana' })
    answer = answering(QUOTE)
    await state().findGraphics('shot')
    answer = answering(KEYWORD)
    await state().findGraphics('shot2')
    const [lower, quote] = graphicsOver('shot')
    expect(lower.graphic!.data).toEqual({ template: 'lower-third', name: 'Ana', role: '' })
    expect(quote.graphic!.data).toMatchObject({ template: 'quote', speaker: 'Ana' })
    const untouched = graphicsOver('shot2')
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
    expect(soundsOf('c4').map((c) => [c.start + Math.round(0.005 * FPS), c.generatedBy?.rule])).toEqual([[795, CLIPS_GRAPHIC_RULE]])
    undoesTo(before)
  })
})
