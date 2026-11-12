import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { parseModelJson, type CompletionRequest, type CompletionResult } from '@shared/director/provider'
import { notJsonRetryNote } from '@shared/director/ask'
import type { Segment, Transcript, Word } from '@shared/transcript'
import { GRAPHIC_RULE } from '@shared/director/apply'
import { GRAPHICS_PASS } from '@shared/director/schemaGraphics'
import { CLIPS_GRAPHIC_RULE } from '@shared/graphics/apply'
import { useEditor, graphicsSkippedNote } from '../../src/renderer/src/store'
import { baselineFailedNote } from '@shared/director/run'
import { useCatalog } from '../../src/renderer/src/catalog'

/*
 * Direct's graphics pass through the store (docs/CLIPS.md §6.6, "Where it
 * runs", lane T2b piece 3): after the spine, every shot on the video track
 * whose asset has a transcript gets the pass under GRAPHIC_RULE, through the
 * same pure functions Find uses; its record is appended as the spine's is;
 * Direct again and Direct's Clear take its graphics; and a failure of the
 * pass never fails Direct. The bridge is a fake (no model, no network): the
 * spine gets prose (the standard cut), and the graphics ask's answer is
 * chosen per case. The transcript is data built here.
 */

const fail = vi.hoisted(() => ({ apply: false }))
const bake = vi.hoisted(() => ({ asks: [] as string[] }))
/** Lane T4: the baseline made to throw, for the case that it never fails Direct. */
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

vi.mock('@shared/graphics/apply', async (original) => {
  const real = await original<typeof import('@shared/graphics/apply')>()
  return {
    ...real,
    applyGraphics: (...args: Parameters<typeof real.applyGraphics>) => {
      if (fail.apply) throw new Error('the graphics could not be laid out')
      return real.applyGraphics(...args)
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

/** A talk of `n` sentences of six words, each with a word of its own, one word every 400 ms (2.4 s a sentence), as the director tests build them. */
function talk(assetId: string, n: number): Transcript {
  const words: Word[] = []
  const segments: Segment[] = []
  let index = 0
  for (let k = 0; k < n; k++) {
    const start = index
    const text = `In week ${k} sales${k} grew today.`
    for (const w of text.split(' ')) {
      words.push({ index, text: w, startMs: index * 400, endMs: index * 400 + 350, confidence: null })
      index += 1
    }
    segments.push({ id: `s${String(k).padStart(2, '0')}`, startMs: start * 400, endMs: (index - 1) * 400 + 350, text, wordStart: start, wordEnd: index - 1 })
  }
  return { assetId, language: 'en', model: 'whisper-small', durationMs: index * 400, words, segments }
}

const video: MediaAsset = {
  id: 'talk', path: '/media/talk.mp4', name: 'talk.mp4', kind: 'video', durationFrames: FPS * 120,
  width: 1080, height: 1920, fps: FPS, hasVideo: true, hasAudio: true, size: 10, speaker: 'Ana Rao'
}

let graphicsAsks: CompletionRequest[]
let graphicsAnswer: () => Promise<CompletionResult>

/**
 * A keyword on s01's "sales1" (word 9, 3.6 s; a word no other sentence holds): what the fake model answers the graphics pass. The standard cut's
 * one shot is frames 0-174 under a headline card at 0-58 and the ending from 174, so a graphic lands only between.
 */
const KEYWORD = JSON.stringify({
  reasoning: 'one stressed word',
  graphics: [{ sentence: 's01', template: 'keyword', title: '', value: '', label: '', items: [], quote: '', words: 'sales1', lit: 0, why: 'the stressed word' }]
})

const isGraphics = (r: CompletionRequest): boolean => 'graphics' in ((r.schema as { properties?: Record<string, unknown> }).properties ?? {})
const prose = (): CompletionResult => ({ text: 'I cannot answer in JSON.', provider: 'openai', model: 'fake', promptTokens: 1, outputTokens: 1, durationMs: 1, truncated: false })

beforeEach(() => {
  graphicsAsks = []
  bake.asks = []
  graphicsAnswer = async () => ({ ...prose(), text: KEYWORD })
  fail.apply = false
  broken.baseline = false
  vi.stubGlobal('window', {
    forge: {
      fileKeys: async (paths: string[]) => Object.fromEntries(paths.map((p) => [p, `k:${p}`])),
      measurePhotos: async () => ({ measures: [], keys: {} }),
      builtInLooks: async () => [],
      renderSolid: async (o: { clipId: string }) => `/drawn/${o.clipId}.png`,
      directorComplete: async (r: CompletionRequest): Promise<CompletionResult> => {
        if (isGraphics(r)) {
          graphicsAsks.push(r)
          return graphicsAnswer()
        }
        return prose()
      }
    }
  })
  const base = emptyProject('direct graphics')
  useEditor.setState({
    ...useEditor.getInitialState(),
    project: { ...base, settings: { ...base.settings, fps: FPS, width: 1080, height: 1920 }, assets: [video], transcripts: { talk: talk('talk', 50) } },
    directBrief: { ...useEditor.getInitialState().directBrief, product: 'Aura serum', seconds: 30 },
    directRecipe: 'auto',
    decisions: [],
    lastDirection: null,
    past: [],
    future: [],
    notices: []
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useCatalog.setState(useCatalog.getInitialState())
})

const state = () => useEditor.getState()
const project = (): Project => state().project
const directGraphics = (): string[] => project().clips.filter((c) => c.graphic && c.generatedBy?.rule === GRAPHIC_RULE).map((c) => c.id)

describe('Direct runs the graphics pass (§6.6, "Where it runs")', () => {
  it('after the spine, over the shots with a transcript, under GRAPHIC_RULE; its record after the spine\'s; one undo takes the whole run', async () => {
    const before = project()
    await state().direct()
    const s = state()
    expect(s.lastDirection).not.toBeNull()
    const shots = s.project.clips.filter((c) => c.generatedBy?.rule === 'director.spine' && c.assetId === 'talk')
    expect(shots.length).toBeGreaterThan(0)
    // Asked through the spine's route: one ask per window of the one shot (it shows s00 to s02, one window).
    expect(graphicsAsks).toHaveLength(1)
    expect(graphicsAsks[0].user).toContain('s01')
    // The keyword lands over the shot, under Direct's rule.
    const placed = s.project.clips.filter((c) => c.graphic)
    expect(placed.map((c) => [c.graphic!.data, c.generatedBy?.rule])).toEqual([[{ template: 'keyword', words: 'sales1', lit: 0 }, GRAPHIC_RULE]])
    // Drawn: the landed keyword, and only it, goes to the bake.
    expect(bake.asks).toEqual([placed[0].id])
    // The asset's Speaker gave a lower third too, refused by the budget under the headline card at 0, with the note.
    expect(s.lastDirection!.problems).toContain('covered[0]: graphic dropped: the lower third "Ana Rao" — another graphic is on screen then')
    // The pass's record, appended as the spine's is, after it, naming the model that answered.
    expect(s.decisions.map((d) => d.pass)).toEqual(['spine@2', GRAPHICS_PASS])
    expect(s.decisions[1].model).toEqual({ id: 'fake', runtime: 'openai' })
    // ONE undo step: the spine and its graphics together.
    expect(s.past).toHaveLength(1)
    state().undo()
    expect(project()).toEqual(before)
  })

  it('with no model, the baseline’s graphics land after the spine’s fallback, under GRAPHIC_RULE, its record naming no model; ONE undo', async () => {
    graphicsAnswer = async () => {
      throw new Error('No model is set up')
    }
    /*
     * A graphic lands only between the headline card (to 58, 1.93 s) and the ending (from 174, 5.8 s). By hand:
     * "And so it is." ends on three function words (no keyword); "Our sales grew today." gives "today" (word 7,
     * 2.8 s), the window's one (its cap is 1); the third sentence, ten words, none.
     */
    const words: Word[] = []
    const segments: Segment[] = []
    for (const [k, text] of ['And so it is.', 'Our sales grew today.', 'The light was soft and warm all that long day.'].entries()) {
      const start = words.length
      for (const w of text.split(' ')) words.push({ index: words.length, text: w, startMs: words.length * 400, endMs: words.length * 400 + 350, confidence: null })
      segments.push({ id: `s${String(k).padStart(2, '0')}`, startMs: start * 400, endMs: (words.length - 1) * 400 + 350, text, wordStart: start, wordEnd: words.length - 1 })
    }
    useEditor.setState({ project: { ...project(), transcripts: { talk: { assetId: 'talk', language: 'en', model: 'whisper-small', durationMs: words.length * 400, words, segments } } } })
    const before = project()
    await state().direct()
    const s = state()
    expect(s.lastDirection!.baseline).toBe(true)
    expect(graphicsAsks).toHaveLength(1)
    const placed = s.project.clips.filter((c) => c.graphic)
    expect(placed.map((c) => [c.graphic!.data, c.graphic!.grounding!.sentence, c.generatedBy?.rule])).toEqual([
      [{ template: 'keyword', words: 'today', lit: 0 }, 's01', GRAPHIC_RULE]
    ])
    expect(bake.asks).toEqual([placed[0].id])
    // Direct's notes are `describeProblem`'s: the window's note has the path '$', so it reads ': …'.
    expect(s.lastDirection!.problems).toContain(": the baseline's graphics are used for sentences s00 to s02: No model is set up")
    expect(s.decisions.map((d) => [d.pass, d.model])).toEqual([
      ['spine@2', expect.anything()],
      [GRAPHICS_PASS, { id: 'baseline', runtime: 'none' }]
    ])
    expect(s.past).toHaveLength(1)
    state().undo()
    expect(project()).toEqual(before)
  })

  it('the graphics ask\'s retry note (the first answer not JSON) reaches Direct\'s problems', async () => {
    const CUT_JSON = '{"graphics": ['
    let calls = 0
    graphicsAnswer = async () => {
      calls += 1
      return calls === 1 ? { ...prose(), text: CUT_JSON } : { ...prose(), text: KEYWORD }
    }
    await state().direct()
    expect(graphicsAsks).toHaveLength(2)
    // The spine's own prose leaves a retry note too; the graphics' first answer is broken JSON, so its note differs.
    const note = (text: string): string => notJsonRetryNote((parseModelJson(text) as { error: string }).error, true)
    expect(note(CUT_JSON)).not.toBe(note(prose().text))
    expect(state().lastDirection!.problems).toContain(note(CUT_JSON))
  })

  it('a baseline that throws never fails Direct: the spine stands, no graphic, and the note says why', async () => {
    broken.baseline = true
    graphicsAnswer = async () => {
      throw new Error('No model is set up')
    }
    await state().direct()
    const s = state()
    expect(s.lastDirection).not.toBeNull()
    expect(s.project.clips.some((c) => c.generatedBy?.rule === 'director.spine')).toBe(true)
    expect(directGraphics()).toEqual([])
    expect(s.lastDirection!.problems).toEqual(expect.arrayContaining([': no graphics for sentences s00 to s02: No model is set up', `: ${baselineFailedNote('the baseline broke')}`]))
    expect(s.decisions.map((d) => d.pass)).toEqual(['spine@2', GRAPHICS_PASS])
    expect(s.notices.map((n) => n.tone)).toEqual(['info'])
  })

  it('Direct again replaces its graphics and Direct\'s Clear takes them', async () => {
    await state().direct()
    const first = directGraphics()
    expect(first.length).toBeGreaterThan(0)
    await state().direct()
    const second = directGraphics()
    expect(second.length).toBe(first.length)
    for (const id of first) expect(second).not.toContain(id)
    state().clearDirectorOutput()
    expect(directGraphics()).toEqual([])
    expect(project().clips.some((c) => c.generatedBy?.rule === GRAPHIC_RULE)).toBe(false)
    expect((project().graphicProposals ?? []).filter((g) => g.rule === GRAPHIC_RULE)).toEqual([])
  })

  it('a failure of the pass never fails Direct: the spine stands, and the note says graphics were skipped and why', async () => {
    fail.apply = true
    const before = project()
    await state().direct()
    const s = state()
    expect(s.lastDirection).not.toBeNull()
    expect(s.project.clips.some((c) => c.generatedBy?.rule === 'director.spine')).toBe(true)
    expect(directGraphics()).toEqual([])
    expect(s.lastDirection!.problems).toContain(graphicsSkippedNote('the graphics could not be laid out'))
    // The spine's record stands; the pass that failed records nothing.
    expect(s.decisions.map((d) => d.pass)).toEqual(['spine@2'])
    // Direct's own summary, not an error notice.
    expect(s.notices.map((n) => n.tone)).toEqual(['info'])
    state().undo()
    expect(project()).toEqual(before)
  })

  it('Direct again gives a Clip-it graphic back the sound slot its last run\'s graphics held, in the same undo step', async () => {
    // By hand, on a footage clip of yours past the cut (3000): three Direct counters with their ticks hold the
    // three sound slots (GRAPHIC_SOUND_CAP); a Clip-it counter after them is silent. Direct again clears them.
    useCatalog.setState({
      catalog: { version: 3, generatedAt: '', scannedFrom: '/lib', entries: [{ id: 'clock', kind: 'sfx', name: 'clock tick', file: 'sfx/clock_tick.wav', tags: [], meta: {} }] },
      root: '/lib'
    })
    const M = 3000
    const at = (id: string, assetId: string, start: number, trackId: string, duration: number): Clip => ({
      id, assetId, trackId, start, duration, inPoint: 0, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 }
    })
    const counter = (id: string, start: number, rule: string): Clip => ({
      ...at(id, `drawn-${id}`, start, 'v2', 90),
      graphic: { data: { template: 'counter', value: '40', label: 'clients' }, seconds: 3, beats: [0.5], place: { auto: true, third: 'middle' }, seed: 1, version: 1 },
      generatedBy: { rule, reason: 'r' }
    })
    const drawn = (id: string): MediaAsset => ({ id, path: '', name: 'counter — graphic', kind: 'image', durationFrames: 300, size: 0, width: 1080, height: 1920, fps: null, hasVideo: true, hasAudio: false })
    const other: MediaAsset = { ...video, id: 'other', path: '/media/other.mp4', name: 'other.mp4', speaker: undefined }
    const tick: MediaAsset = { id: 'tick', path: '/lib/sfx/clock_tick.wav', name: 'clock_tick.wav', kind: 'audio', durationFrames: 2, width: null, height: null, fps: null, hasVideo: false, hasAudio: true, size: 1, broughtBy: GRAPHIC_RULE }
    const held = [counter('h1', M + 60, GRAPHIC_RULE), counter('h2', M + 300, GRAPHIC_RULE), counter('h3', M + 540, GRAPHIC_RULE)]
    const ticks = held.map((h) => ({ ...at(`t-${h.id}`, 'tick', h.start + 15, 'a2', 2), forGraphic: h.id, generatedBy: { rule: GRAPHIC_RULE, reason: 'r' } }))
    const p = project()
    useEditor.setState({
      project: {
        ...p,
        assets: [...p.assets, other, tick, ...['h1', 'h2', 'h3', 'c4'].map((id) => drawn(`drawn-${id}`))],
        clips: [at('mine', 'other', M, 'v1', 900), ...held, ...ticks, counter('c4', M + 780, CLIPS_GRAPHIC_RULE)]
      }
    })
    const before = project()
    expect(project().clips.filter((c) => c.forGraphic === 'c4')).toEqual([])
    await state().direct()
    expect(project().clips.some((c) => c.id === 'mine')).toBe(true)
    expect(project().clips.some((c) => ['h1', 'h2', 'h3'].includes(c.id))).toBe(false)
    // Its tick, on its beat (3780 + ceil(0.5 × 30)), under its own rule.
    expect(project().clips.filter((c) => c.forGraphic === 'c4').map((c) => [c.start, c.generatedBy?.rule])).toEqual([[M + 795, CLIPS_GRAPHIC_RULE]])
    expect(state().past).toHaveLength(1)
    state().undo()
    expect(project()).toEqual(before)
  })

  it('an edit made while the graphics were asked for stays its own step: the graphics land as a step after it, and one undo takes only them', async () => {
    let release: () => void = () => undefined
    graphicsAnswer = () => new Promise((resolve) => {
      release = () => resolve({ ...prose(), text: KEYWORD })
    })
    const running = state().direct()
    for (let i = 0; i < 200 && graphicsAsks.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(graphicsAsks).toHaveLength(1)
    state().update((p) => ({ ...p, name: 'edited while asked' }))
    const edited = project()
    release()
    await running
    expect(directGraphics()).toHaveLength(1)
    expect(state().past).toHaveLength(3)
    state().undo()
    expect(project()).toEqual(edited)
    expect(directGraphics()).toEqual([])
  })

  it('a shot whose span shows no word of its transcript is not asked, and nothing is recorded for it', async () => {
    // Every word 100 s later: the cut's one shot, near the file's start, shows none of them.
    const t = talk('talk', 50)
    const late = {
      ...t,
      words: t.words.map((w) => ({ ...w, startMs: w.startMs + 100_000, endMs: w.endMs + 100_000 })),
      segments: t.segments.map((g) => ({ ...g, startMs: g.startMs + 100_000, endMs: g.endMs + 100_000 }))
    }
    useEditor.setState({ project: { ...project(), transcripts: { talk: late } } })
    await state().direct()
    expect(graphicsAsks).toEqual([])
    expect(state().decisions.map((d) => d.pass)).toEqual(['spine@2'])
  })

  it('photographs with no transcript: no graphics ask and no graphics record', async () => {
    const photo: MediaAsset = { id: 'p', path: '/p/p.jpg', name: 'p.jpg', kind: 'image', durationFrames: 150, width: 1080, height: 1350, fps: null, hasVideo: true, hasAudio: false, size: 10 }
    useEditor.setState({ project: { ...project(), assets: [photo], transcripts: {} } })
    await state().direct()
    expect(graphicsAsks).toEqual([])
    expect(state().decisions.map((d) => d.pass)).toEqual(['spine@2'])
  })
})
