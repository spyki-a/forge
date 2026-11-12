import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { emptyProject, type AssetCredit, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import type { CompletionRequest, CompletionResult } from '@shared/director/provider'
import type { Segment, Transcript, Word } from '@shared/transcript'
import type { AnswerGraphic } from '@shared/director/schemaGraphics'
import { GRAPHIC_RULE } from '@shared/director/apply'
import { CHECK_THE_NUMBER, CLEAR_GRAPHICS_NOTE, CLIPS_GRAPHIC_RULE } from '@shared/graphics/apply'

/*
 * Lane T2b, piece 4 (docs/CLIPS.md §6.6, "By hand"; the test §6.6 names
 * `tests/renderer/transcriptGraphics.test.tsx`): the Transcript tile's
 * Graphics section, pressed as a user presses it. As
 * tests/renderer/transcriptPanel.test.tsx does: the store mocked to a plain
 * selector over the REAL store's state, so the section — which has no hook
 * but the store's — is called as a function and every press runs the real
 * action; static markup for what is on screen. The bridge is a fake that
 * answers the graphics schema with what each case sets (no model, no
 * network); every transcript and the sound library are data built here; the
 * bake is a recorder.
 */

vi.mock('../../src/renderer/src/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/src/store')>()
  const store = real.useEditor
  const useEditor = Object.assign((select: (s: unknown) => unknown) => select(store.getState()), {
    getState: store.getState,
    setState: store.setState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe
  })
  return { ...real, useEditor }
})

const bake = vi.hoisted(() => ({ asks: [] as string[] }))
vi.mock('../../src/renderer/src/graphicCanvas', () => ({
  bakeGraphicSequence: async (_spec: unknown, _style: unknown, clipId: string) => {
    bake.asks.push(clipId)
    return null
  },
  forgetGraphicPreview: () => undefined,
  graphicPreviewCanvas: () => null
}))

const { useEditor, GRAPHICS_BUSY_NOTE } = await import('../../src/renderer/src/store')
const { useCatalog } = await import('../../src/renderer/src/catalog')
const TG = await import('../../src/renderer/src/components/TranscriptGraphics')
const { TranscriptGraphics } = TG
const { TranscriptPanel } = await import('../../src/renderer/src/components/TranscriptPanel')
const { shelfToolById } = await import('../../src/renderer/src/components/shelf/tools')
const { harnessGraphicsRun } = await import('../../src/renderer/src/harness/graphicsStub')

const FPS = 30
const FILLER = 'The light was soft that day.'

/** `sentences`, one word every 400 ms, segment ids s00, s01, … (graphicActions.test.ts's `talk`). */
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

/* s00 "We signed 40 clients this year." ("40" word 2, 0.8 s), two fillers, s03 "Keep it simple always today." ("simple" word 20, 8.0 s), fillers. */
const SAID = ['We signed 40 clients this year.', FILLER, FILLER, 'Keep it simple always today.', ...Array.from({ length: 17 }, () => FILLER)]

const g = (fields: Partial<AnswerGraphic> & Pick<AnswerGraphic, 'sentence' | 'template'>): AnswerGraphic => ({
  title: '', value: '', label: '', items: [], quote: '', words: '', lit: 0, why: 'it helps', ...fields
})
const COUNTER = g({ sentence: 's00', template: 'counter', value: '40', label: 'clients' })
const KEYWORD = g({ sentence: 's03', template: 'keyword', words: 'simple', lit: 0 })
const QUOTE = g({ sentence: 's03', template: 'quote', quote: 'Keep it simple always today.' })

const CHANNEL = 'Bright Weddings Channel'
const linkCredit: AssetCredit = {
  source: 'link', title: 'A talk', author: CHANNEL, pageUrl: 'https://example.invalid/watch', line: `A talk — ${CHANNEL}, https://example.invalid/watch`, attributionRequired: true, fetchedAt: '2026-11-11T00:00:00Z'
}

const footage = (id: string, extra: Partial<MediaAsset> = {}): MediaAsset => ({
  id, path: `/media/${id}.mp4`, name: id, kind: 'video', durationFrames: FPS * 140, width: 1080, height: 1920, fps: FPS, hasVideo: true, hasAudio: true, size: 1, ...extra
})
/** 70 s of footage on V1. */
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

function start(over: { model?: string; talkAsset?: Partial<MediaAsset>; transcript?: boolean } = {}): void {
  const base = emptyProject('transcript graphics')
  useEditor.setState({
    ...useEditor.getInitialState(),
    project: {
      ...base,
      settings: { ...base.settings, width: 1080, height: 1920, fps: FPS },
      assets: [footage('talk', over.talkAsset), footage('talk2'), drawnAsset('drawn-direct-g')],
      clips: [shotOf('shot', 'talk', 0), shotOf('shot2', 'talk2', FPS * 70), directGraphic],
      transcripts: over.transcript === false ? { talk2: talk('talk2', SAID, over.model) } : { talk: talk('talk', SAID, over.model), talk2: talk('talk2', SAID, over.model) }
    },
    selectedClipId: 'shot',
    selectedClipIds: ['shot'],
    decisions: [],
    past: [],
    future: [],
    notices: []
  })
}

const state = () => useEditor.getState()
const project = (): Project => state().project
const clipById = (id: string): Clip | undefined => project().clips.find((c) => c.id === id)
const soundsOf = (graphicId: string): Clip[] => project().clips.filter((c) => c.forGraphic === graphicId)

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

/* ------------------------------------------------------------ the walk */

interface Host {
  type: string
  props: Record<string, unknown>
}

/** Every host element a tree comes to, in order, components called as React would. */
function hosts(node: ReactNode, out: Host[] = []): Host[] {
  if (Array.isArray(node)) {
    for (const child of node) hosts(child as ReactNode, out)
    return out
  }
  if (!isValidElement(node)) return out
  const props = node.props as Record<string, unknown> & { children?: ReactNode }
  const type = node.type as unknown
  if (typeof type === 'string') {
    out.push({ type, props })
    return hosts(props.children, out)
  }
  if (typeof type === 'function') return hosts((type as (p: unknown) => ReactNode)(props), out)
  return hosts(props.children, out)
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((n) => textOf(n as ReactNode)).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}
const text = (h: Host): string => textOf(h.props.children as ReactNode).trim()

/** The section for the selected clip, as the tile draws it. */
function section(clipId = 'shot'): Host[] {
  const clip = clipById(clipId)!
  return hosts(TranscriptGraphics({ clip, hasTranscript: project().transcripts[clip.assetId] !== undefined }))
}
const buttons = (label: string, within: Host[] = section()): Host[] => within.filter((h) => h.type === 'button' && text(h) === label)
const press = (h: Host): unknown => (h.props.onClick as () => unknown)()
/** The listed graphics' ids, in order. */
const listed = (): string[] => section().filter((h) => h.type === 'li' && typeof h.props['data-graphic'] === 'string').map((h) => h.props['data-graphic'] as string)
const listedProposals = (): string[] =>
  section().filter((h) => h.type === 'li' && typeof h.props['data-graphic-proposal'] === 'string').map((h) => h.props['data-graphic-proposal'] as string)
/** One listed row's own hosts: a graphic's or a proposal's. */
function row(id: string): Host[] {
  const li = section().find((h) => h.type === 'li' && (h.props['data-graphic'] === id || h.props['data-graphic-proposal'] === id))
  if (!li) throw new Error(`${id} is not listed`)
  return [li, ...hosts(li.props.children as ReactNode)]
}
/** The Speaker field, found through its on-screen label's htmlFor. */
function speakerField(): Host {
  const all = section()
  const labels = all.filter((h) => h.type === 'label' && text(h) === TG.SPEAKER)
  expect(labels).toHaveLength(1)
  return all.find((h) => h.type === 'input' && h.props.id === labels[0].props.htmlFor)!
}
/** Type into the Speaker field and leave it, as a user does: the field's own value, then its blur. */
function typeSpeaker(value: string): void {
  ;(speakerField().props.onBlur as (e: { target: { value: string } }) => void)({ target: { value } })
}
/** Leave the Speaker field without typing: what it shows is its value. */
function leaveSpeaker(): void {
  typeSpeaker((speakerField().props.defaultValue as string) ?? '')
}
async function pressFind(): Promise<void> {
  press(buttons(TG.FIND_GRAPHICS)[0])
  await vi.waitFor(() => expect(state().findingGraphics).toBeNull())
}
const clipItGraphics = (): Clip[] => project().clips.filter((c) => c.graphic && c.generatedBy?.rule === CLIPS_GRAPHIC_RULE)
/** One undo: the project exactly as given, and the history one shorter. */
function undoesTo(before: Project): void {
  const past = state().past.length
  state().undo()
  expect(project()).toEqual(before)
  expect(state().past.length).toBe(past - 1)
}

/* ---------------------------------------------------------------- tests */

describe('the Transcript tile’s Graphics section (§6.6, "By hand")', () => {
  it('sits in the tile between the rows and Listen for, with the plan’s words', () => {
    expect([TG.GRAPHICS_HEADING, TG.FIND_GRAPHICS, TG.KEEP, TG.DROP, TG.CLEAR_GRAPHICS, TG.SPEAKER]).toEqual([
      'Graphics', 'Find graphics in this clip', 'Keep', 'Drop', 'Clear graphics', 'Speaker'
    ])
    expect(CHECK_THE_NUMBER).toBe('check the number')
    const html = renderToStaticMarkup(createElement(TranscriptPanel))
    const at = (s: string): number => {
      expect([...html.matchAll(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))], s).toHaveLength(1)
      return html.indexOf(s)
    }
    const rows = at('Cut to these words')
    const graphics = at('data-transcript-graphics')
    const listen = at('Listen for — names and words')
    expect(rows).toBeLessThan(graphics)
    expect(graphics).toBeLessThan(listen)
    expect(html).toContain(`>${TG.GRAPHICS_HEADING}<`)
    expect(html).toContain(`>${TG.FIND_GRAPHICS}<`)
    expect(html).toContain(`>${TG.SPEAKER}<`)
  })

  it('Find graphics lists the run’s graphics, each with Drop, and Direct’s graphic too; it reads Finding graphics… while the ask is out and the tile is busy', async () => {
    // Before: Direct's graphic is listed already, whichever rule made it.
    expect(listed()).toEqual(['direct-g'])
    let release: () => void = () => undefined
    answer = () => new Promise((resolve) => {
      release = () => void answering(COUNTER, KEYWORD)().then(resolve)
    })
    press(buttons(TG.FIND_GRAPHICS)[0])
    // The running state: the button says so and is greyed; the Shelf's tile is busy.
    expect(buttons(TG.FIND_GRAPHICS)).toEqual([])
    const running = buttons(TG.FINDING_GRAPHICS)
    expect(running).toHaveLength(1)
    expect(running[0].props.disabled).toBe(true)
    expect(shelfToolById('transcript')!.busy!(state())).toBe(true)
    // Another clip's Find is greyed too, its title saying why.
    const other = buttons(TG.FIND_GRAPHICS, section('shot2'))[0]
    expect(other.props.disabled).toBe(true)
    expect(other.props.title).toBe(GRAPHICS_BUSY_NOTE)
    release()
    await vi.waitFor(() => expect(state().findingGraphics).toBeNull())
    expect(shelfToolById('transcript')!.busy!(state())).toBe(false)

    const placed = clipItGraphics().sort((a, b) => a.start - b.start)
    expect(placed.map((c) => c.graphic!.data.template)).toEqual(['counter', 'keyword'])
    // Every graphic over the clip, in time order: the run's two and Direct's.
    expect(listed()).toEqual([placed[0].id, placed[1].id, 'direct-g'])
    for (const id of listed()) {
      expect(buttons(TG.DROP, row(id)), id).toHaveLength(1)
      expect(buttons(TG.KEEP, row(id)), id).toEqual([])
    }
    // Each row: its template, the words it draws, its time.
    const counterRow = row(placed[0].id).map((h) => text(h))
    expect(counterRow).toContain('counter')
    expect(counterRow).toContain('40 · clients')
    expect(counterRow).toContain('0:00')
    expect(row('direct-g').map((h) => text(h))).toContain('0:50')
    expect(row('direct-g').map((h) => text(h))).toContain('later')
    // shot2 lists only its own.
    expect(section('shot2').filter((h) => h.type === 'li' && h.props['data-graphic'] !== undefined)).toEqual([])
  })

  it('a "check the number" proposal is listed with Keep, Drop and the words heard, and is not placed until Keep', async () => {
    start({ model: 'youtube-asr' })
    await pressFind()
    // Only the keyword is placed; the counter's number came from a YouTube track and waits.
    expect(clipItGraphics().map((c) => c.graphic!.data.template)).toEqual(['keyword'])
    const [proposal] = project().graphicProposals!
    expect(listedProposals()).toEqual([proposal.id])
    const hostsOf = row(proposal.id)
    expect(buttons(TG.KEEP, hostsOf)).toHaveLength(1)
    expect(buttons(TG.DROP, hostsOf)).toHaveLength(1)
    const texts = hostsOf.map((h) => text(h))
    expect(texts).toContain(CHECK_THE_NUMBER)
    expect(hostsOf.find((h) => h.props['data-heard'] !== undefined)!.props.children).toBe('heard "40 clients"')
    expect(texts).toContain('40 · clients')

    const before = project()
    press(buttons(TG.KEEP, row(proposal.id))[0])
    expect(clipItGraphics().map((c) => c.graphic!.data.template).sort()).toEqual(['counter', 'keyword'])
    expect(listedProposals()).toEqual([])
    const counter = clipItGraphics().find((c) => c.graphic!.data.template === 'counter')!
    expect(listed()).toContain(counter.id)
    expect(section().map((h) => text(h))).not.toContain(CHECK_THE_NUMBER)
    undoesTo(before)
  })

  it('Drop removes the graphic’s clip, its drawn asset and its sound, in ONE undo step', async () => {
    await pressFind()
    const keyword = clipItGraphics().find((c) => c.graphic!.data.template === 'keyword')!
    const sounds = soundsOf(keyword.id)
    expect(sounds).toHaveLength(1)
    expect(project().assets.some((a) => a.id === keyword.assetId)).toBe(true)
    const before = project()
    press(buttons(TG.DROP, row(keyword.id))[0])
    expect(clipById(keyword.id)).toBeUndefined()
    expect(project().assets.some((a) => a.id === keyword.assetId)).toBe(false)
    for (const s of sounds) expect(clipById(s.id)).toBeUndefined()
    expect(listed()).not.toContain(keyword.id)
    undoesTo(before)
  })

  it('Clear graphics removes every Clip-it clip, drawn asset, sound, file and proposal, leaves Direct’s, and shows that it does', async () => {
    // Find on both clips: shot2's run on a YouTube track, so a proposal waits there.
    start({ model: 'youtube-asr' })
    await pressFind()
    useEditor.setState({ selectedClipId: 'shot2', selectedClipIds: ['shot2'] })
    press(buttons(TG.FIND_GRAPHICS, section('shot2'))[0])
    await vi.waitFor(() => expect(state().findingGraphics).toBeNull())
    expect(project().graphicProposals).toHaveLength(2)
    // Each clip lists its own proposal, not the other's.
    for (const id of ['shot', 'shot2']) {
      const own = project().graphicProposals!.filter((p) => p.clipId === id).map((p) => p.id)
      expect(own).toHaveLength(1)
      expect(section(id).filter((h) => h.type === 'li' && h.props['data-graphic-proposal'] !== undefined).map((h) => h.props['data-graphic-proposal'])).toEqual(own)
    }
    const drawn = clipItGraphics().map((c) => c.assetId)
    expect(drawn.length).toBeGreaterThan(0)
    // The note shows beside the button before it is pressed.
    expect(section().map((h) => text(h))).toContain(CLEAR_GRAPHICS_NOTE)
    const before = project()

    press(buttons(TG.CLEAR_GRAPHICS)[0])
    expect(clipItGraphics()).toEqual([])
    for (const id of drawn) expect(project().assets.some((a) => a.id === id)).toBe(false)
    expect(project().clips.filter((c) => c.forGraphic !== undefined).map((c) => c.forGraphic)).toEqual(['direct-g'])
    const directSound = project().clips.find((c) => c.forGraphic === 'direct-g')!
    expect(project().assets.filter((a) => a.broughtBy !== undefined).map((a) => a.id)).toEqual([directSound.assetId])
    expect(project().graphicProposals).toEqual([])
    expect(clipById('direct-g')).toEqual(directGraphic)
    expect(listed()).toEqual(['direct-g'])
    expect(state().notices.map((n) => n.text)).toContain(CLEAR_GRAPHICS_NOTE)
    // Nothing of Find's left: the button goes.
    expect(buttons(TG.CLEAR_GRAPHICS)).toEqual([])
    undoesTo(before)
  })

  it('the Speaker field writes MediaAsset.speaker in ONE step, and a lower third reads it', async () => {
    expect(speakerField().props.defaultValue).toBe('')
    const before = project()
    typeSpeaker('Ana')
    expect(project().assets.find((a) => a.id === 'talk')!.speaker).toBe('Ana')
    expect(speakerField().props.defaultValue).toBe('Ana')
    undoesTo(before)
    typeSpeaker('Ana')
    // Leaving it unchanged is no step.
    const past = state().past.length
    leaveSpeaker()
    expect(state().past.length).toBe(past)
    await pressFind()
    const lower = clipItGraphics().find((c) => c.graphic!.data.template === 'lower-third')!
    expect(lower.graphic!.data).toEqual({ template: 'lower-third', name: 'Ana', role: '' })
    expect(listed()).toContain(lower.id)
    // Typed again: the lower third follows.
    typeSpeaker('Bea')
    expect(clipById(lower.id)!.graphic!.data).toEqual({ template: 'lower-third', name: 'Bea', role: '' })
  })

  it('a link’s channel is the Speaker’s placeholder, never its value: a quote takes it, a lower third waits for the press', async () => {
    start({ talkAsset: { credit: linkCredit } })
    answer = answering(QUOTE)
    const field = speakerField()
    expect(field.props.defaultValue).toBe('')
    expect(field.props.placeholder).toBe(CHANNEL)
    // Leaving the field as it shows writes nothing.
    leaveSpeaker()
    expect(project().assets.find((a) => a.id === 'talk')!.speaker).toBeUndefined()
    await pressFind()
    // The quote takes the channel (§16.31); no lower third.
    expect(clipItGraphics().map((c) => c.graphic!.data)).toEqual([{ template: 'quote', kind: 'said', text: 'Keep it simple always today.', speaker: CHANNEL }])
    // The press: the channel becomes the Speaker, ONE step, and the press goes.
    const use = buttons(TG.USE_CHANNEL_NAME)
    expect(use).toHaveLength(1)
    const before = project()
    press(use[0])
    expect(project().assets.find((a) => a.id === 'talk')!.speaker).toBe(CHANNEL)
    expect(buttons(TG.USE_CHANNEL_NAME)).toEqual([])
    expect(speakerField().props.defaultValue).toBe(CHANNEL)
    undoesTo(before)
    press(buttons(TG.USE_CHANNEL_NAME)[0])
    await pressFind()
    expect(clipItGraphics().map((c) => c.graphic!.data.template).sort()).toEqual(['lower-third', 'quote'])
  })

  it('the notes of the clip’s last run show, each drop with its reason; with no model, the line that no model’s answer was used', async () => {
    answer = async () => {
      throw new Error('No model is set up')
    }
    await pressFind()
    const notes = section().find((h) => h.props['data-graphic-notes'] !== undefined)!
    const lines = hosts(notes.props.children as ReactNode).filter((h) => h.type === 'li').map((h) => text(h))
    expect(lines[0]).toBe(TG.NO_MODEL_LINE)
    // The baseline ran for the window (§6.10, lane T4), and the note says so.
    expect(lines).toContain("the baseline's graphics are used for sentences s00 to s20: No model is set up")
    // Another clip shows none of this clip's notes.
    expect(section('shot2').some((h) => h.props['data-graphic-notes'] !== undefined)).toBe(false)

    // A model answering, one graphic dropped by the validator: the note with its reason, no "no model" line.
    answer = answering(COUNTER, g({ sentence: 's00', template: 'counter', value: '99', label: 'clients' }))
    await pressFind()
    const after = hosts(section().find((h) => h.props['data-graphic-notes'] !== undefined)!.props.children as ReactNode)
      .filter((h) => h.type === 'li')
      .map((h) => text(h))
    expect(after).not.toContain(TG.NO_MODEL_LINE)
    expect(after).toContain("graphic dropped: '99' is not said in s00")
  })

  it('Drop on a "check the number" proposal takes the proposal and places nothing, in ONE undo step', async () => {
    start({ model: 'youtube-asr' })
    await pressFind()
    const [proposal] = project().graphicProposals!
    expect(listedProposals()).toEqual([proposal.id])
    const before = project()
    press(buttons(TG.DROP, row(proposal.id))[0])
    expect(project().graphicProposals ?? []).toEqual([])
    // No counter placed: the number nobody checked never reaches the timeline.
    expect(clipItGraphics().map((c) => c.graphic!.data.template)).toEqual(['keyword'])
    expect(listedProposals()).toEqual([])
    undoesTo(before)
  })

  it('a proposal’s row shows where it would start on the timeline, through its own clip', async () => {
    // shot2 starts at 70 s; its counter's first word ("40") is 0.8 s in: 1:10, not 0:00.
    start({ model: 'youtube-asr' })
    useEditor.setState({ selectedClipId: 'shot2', selectedClipIds: ['shot2'] })
    press(buttons(TG.FIND_GRAPHICS, section('shot2'))[0])
    await vi.waitFor(() => expect(state().findingGraphics).toBeNull())
    const [proposal] = project().graphicProposals!
    expect(proposal.clipId).toBe('shot2')
    const li = section('shot2').find((h) => h.type === 'li' && h.props['data-graphic-proposal'] === proposal.id)!
    expect(hosts(li.props.children as ReactNode).map((h) => text(h))).toContain('1:10')
  })

  it('Enter in the Speaker field leaves it (saving it), and its keys stay out of the shortcut layer', () => {
    const blur = vi.fn()
    const stop = vi.fn()
    ;(speakerField().props.onKeyDown as (e: unknown) => void)({ key: 'Enter', target: { blur }, stopPropagation: stop })
    expect(blur).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
    ;(speakerField().props.onKeyDown as (e: unknown) => void)({ key: 'a', target: { blur }, stopPropagation: stop })
    expect(blur).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(2)
  })

  it('a selected graphic clip shows no Graphics section: no Speaker to land on its drawn image', () => {
    expect(TranscriptGraphics({ clip: clipById('direct-g')!, hasTranscript: false })).toBeNull()
    expect(section().length).toBeGreaterThan(0)
  })

  it('Find is greyed with its reason on a clip with no transcript', () => {
    start({ transcript: false })
    const [find] = buttons(TG.FIND_GRAPHICS)
    expect(find.props.disabled).toBe(true)
    expect(find.props.title).toBe(TG.FIND_NEEDS_TRANSCRIPT)
    expect(buttons(TG.FIND_GRAPHICS, section('shot2'))[0].props.disabled).toBe(false)
  })
})

describe('the census’s graphics run (harness/graphicsStub.ts)', () => {
  it.each([
    ['youtube-asr', 'transcript-graphics-asr', true],
    ['youtube-lines', 'transcript-graphics-lines', false],
    ['whisper-unsure', 'transcript-graphics-whisper', false]
  ] as const)('%s: every text row of %s counts on the whole tile what the fixture says (a transcript word is a text node too)', async (source, needs, link) => {
    const census = (await import('../fixtures/ui-census.json')).default as Array<{ label: string; match: string; needs?: string; count?: number }>
    const rows = census.filter((r) => r.needs === needs && r.match === 'text')
    expect(rows.length).toBeGreaterThan(0)
    const base = emptyProject('census')
    const clip: Clip = { ...shotOf('V', 'vid', 0), duration: FPS * 5 }
    const vid = footage('vid', { width: 640, height: 360, durationFrames: FPS * 5, ...(link ? { credit: linkCredit } : {}) })
    const p: Project = { ...base, settings: { ...base.settings, fps: FPS }, assets: [vid], clips: [clip] }
    useEditor.setState({ project: harnessGraphicsRun(p, 'V', source).project, selectedClipId: 'V', selectedClipIds: ['V'] })
    const html = renderToStaticMarkup(createElement(TranscriptPanel))
    const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
    const quote = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const r of rows) {
      // A whole text node: between tags, or a tag and React's <!-- --> between adjacent texts.
      const whole = new RegExp(`(?:>|-->)${quote(escape(r.label))}(?:<)`, 'g')
      expect([...html.matchAll(whole)], r.label).toHaveLength(r.count ?? 1)
    }
  })

  it.each(['youtube-asr', 'youtube-lines', 'whisper-unsure'] as const)('%s: one keyword placed and one counter waiting with "check the number", on a 5 s clip of a 640×360 file', (source) => {
    const base = emptyProject('census')
    const clip: Clip = { ...shotOf('V', 'vid', 0), duration: FPS * 5 }
    const p: Project = { ...base, settings: { ...base.settings, fps: FPS }, assets: [footage('vid', { width: 640, height: 360, durationFrames: FPS * 5 })], clips: [clip] }
    const out = harnessGraphicsRun(p, 'V', source)
    expect(out.placed).toHaveLength(1)
    expect(out.project.clips.find((c) => c.id === out.placed[0])!.graphic!.data.template).toBe('keyword')
    const [proposal] = out.project.graphicProposals!
    expect(proposal.spec.data.template).toBe('counter')
    expect(proposal.spec.proposal).toEqual({ reason: 'check-the-number', wordSource: source })
    expect(proposal.note).toBe(`${CHECK_THE_NUMBER}: heard "40 clients"`)
  })
})
