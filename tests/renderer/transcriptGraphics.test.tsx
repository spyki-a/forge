import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { emptyProject, type AssetCredit, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import type { CompletionRequest, CompletionResult } from '@shared/director/provider'
import type { Segment, Transcript, Word } from '@shared/transcript'
import type { AnswerGraphic } from '@shared/director/schemaGraphics'
import { GRAPHIC_RULE } from '@shared/director/apply'
import { CHECK_THE_NUMBER, CLEAR_GRAPHICS_NOTE, CLIPS_GRAPHIC_RULE } from '@shared/graphics/apply'
import { ON_SCREEN_REASON } from '@shared/graphics/budget'

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
const { harnessDropsTranscript, harnessGraphicsRun } = await import('../../src/renderer/src/harness/graphicsStub')
const { FROM_WORDS_LISTED_NOTE, NOTHING_TO_DRAW_NOTE } = await import('@shared/director/fromWords')
const { clipWords: clipWordsOf, clipSourceWindow: clipSourceWindowOf } = await import('@shared/edit/clipIt')
const { runFromRows: runFromRowsOf } = await import('@shared/ingest/wordRun')

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
/** The dropped graphics' rows, in order: each row's index (Add's), its words, its reason, its refusal, its Add button. */
function dropRows(clipId = 'shot'): { index: number; words: string[]; reason: string; refused: string | null; add: Host | null }[] {
  const all = section(clipId)
  const lists = all.filter((h) => h.props['data-graphic-drops'] !== undefined)
  expect(lists.length).toBeLessThanOrEqual(1)
  if (lists.length === 0) return []
  return all
    .filter((h) => h.type === 'li' && typeof h.props['data-graphic-drop'] === 'number')
    .map((li) => {
      const inner = hosts(li.props.children as ReactNode)
      const reason = inner.find((h) => h.props['data-drop-reason'] !== undefined)
      const refused = inner.find((h) => h.props['data-add-refused'] !== undefined)
      const adds = inner.filter((h) => h.type === 'button' && text(h) === TG.ADD)
      expect(adds.length).toBeLessThanOrEqual(1)
      return {
        index: li.props['data-graphic-drop'] as number,
        words: inner.map((h) => text(h)),
        reason: reason ? text(reason) : '',
        refused: refused ? text(refused) : null,
        add: adds[0] ?? null
      }
    })
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

    // A model answering, one graphic dropped by the validator: its row with its reason, no "no model" line.
    answer = answering(COUNTER, g({ sentence: 's00', template: 'counter', value: '99', label: 'clients' }))
    await pressFind()
    // The notes list shows only when it holds a line: here it holds none.
    const list = section().find((h) => h.props['data-graphic-notes'] !== undefined)
    const after = list ? hosts(list.props.children as ReactNode).filter((h) => h.type === 'li').map((h) => text(h)) : []
    expect(after).not.toContain(TG.NO_MODEL_LINE)
    // A dropped graphic is its own row, its reason beside Add (try-out 1, piece 4), and no longer a note as well.
    expect(after.some((line) => line.startsWith('graphic dropped: '))).toBe(false)
    expect(dropRows().map((r) => r.reason)).toContain("'99' is not said in s00")
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

describe('Add on a dropped graphic (try-out 1, 2026-11-15, piece 4)', () => {
  /* The counter "40 clients" lands at 0.8 s; "99 clients" is not said (a truth drop); "soft" at 3.6 s is within 6 s of the counter (a room drop); a ring on s99 cannot be drawn. */
  const NOT_SAID = g({ sentence: 's00', template: 'counter', value: '99', label: 'clients' })
  const SOFT = g({ sentence: 's01', template: 'keyword', words: 'soft', lit: 0 })
  const OFF_MENU = g({ sentence: 's99', template: 'ring', value: '70%', label: 'clients' })
  beforeEach(() => {
    answer = answering(COUNTER, NOT_SAID, SOFT, OFF_MENU)
  })
  const rowOf = (word: string) => {
    const r = dropRows().find((x) => x.words.includes(word))
    if (!r) throw new Error(`no dropped row for ${word}: ${JSON.stringify(dropRows().map((x) => x.words))}`)
    return r
  }

  it('lists every dropped graphic with its reason, and Add on each one that can be drawn, in a list that scrolls on its own', async () => {
    await pressFind()
    const rows = dropRows()
    expect(rows).toHaveLength(3)
    expect(rowOf('99').reason).toBe("'99' is not said in s00")
    expect(rowOf('99').add).not.toBeNull()
    expect(rowOf('soft').reason).toBe('within 6 s of the counter at 0.8 s; a keyword yields to any other graphic')
    expect(rowOf('soft').add).not.toBeNull()
    expect(rowOf('70%').reason).toBe("'s99' is not a sentence on the menu")
    expect(rowOf('70%').add).toBeNull()
    for (const r of rows) expect(r.refused).toBeNull()
    const list = section().find((h) => h.props['data-graphic-drops'] !== undefined)!
    expect(String(list.props.className).split(' ')).toEqual(expect.arrayContaining(['overflow-y-auto', 'max-h-40']))
  })

  it('Add places a room drop on its own word in ONE undo step: listed with Drop, sounded, its row gone; undone, the row is back', async () => {
    await pressFind()
    const before = project()
    const placedBefore = clipItGraphics().map((c) => c.id)
    expect(press(rowOf('soft').add!)).toBeNull()
    const added = clipItGraphics().find((c) => !placedBefore.includes(c.id))!
    expect(added.graphic!.data).toEqual({ template: 'keyword', words: 'soft', lit: 0 })
    expect(added.graphic!.grounding!.words).toEqual([9])
    expect(listed()).toContain(added.id)
    expect(buttons(TG.DROP, row(added.id))).toHaveLength(1)
    expect(soundsOf(added.id).length).toBeGreaterThan(0)
    expect(bake.asks).toContain(added.id)
    expect(dropRows().map((r) => r.words)).not.toContainEqual(expect.arrayContaining(['soft']))
    expect(dropRows()).toHaveLength(2)
    undoesTo(before)
    expect(rowOf('soft').add).not.toBeNull()
  })

  it('a refused Add changes nothing, shows its reason on the row and as a notice, and the row stays', async () => {
    await pressFind()
    const before = project()
    const past = state().past.length
    const refused = press(rowOf('99').add!)
    // Timed on s00's first word, under the counter's frames.
    expect(refused).toBe('another graphic is on screen then')
    expect(project()).toBe(before)
    expect(state().past.length).toBe(past)
    expect(rowOf('99').refused).toBe('another graphic is on screen then')
    expect(rowOf('99').reason).toBe("'99' is not said in s00")
    expect(state().notices.map((n) => n.text)).toContain('another graphic is on screen then')
    expect(rowOf('soft').refused).toBeNull()
  })

  it('a truth drop refused, its blocker dropped, then added: it lands on its sentence and the old refusal is gone from the row, undone too', async () => {
    await pressFind()
    expect(press(rowOf('99').add!)).toBe('another graphic is on screen then')
    const counter = clipItGraphics().find((c) => c.graphic!.data.template === 'counter')!
    press(buttons(TG.DROP, row(counter.id))[0])
    const beforeAdd = project()
    const placedBefore = clipItGraphics().map((c) => c.id)
    expect(press(rowOf('99').add!)).toBeNull()
    const added = clipItGraphics().find((c) => !placedBefore.includes(c.id))!
    expect(added.graphic!.data).toEqual({ template: 'counter', value: '99', label: 'clients' })
    expect(added.graphic!.grounding!.sentence).toBe('s00')
    expect(added.graphic!.proposal).toBeUndefined()
    expect(dropRows().map((r) => r.words)).not.toContainEqual(expect.arrayContaining(['99']))
    undoesTo(beforeAdd)
    expect(rowOf('99').add).not.toBeNull()
    expect(rowOf('99').refused).toBeNull()
  })

  it('Drop on an added graphic lists its row again; Find again lists the new run’s drops afresh', async () => {
    await pressFind()
    press(rowOf('99').add!)
    press(rowOf('soft').add!)
    const added = clipItGraphics().find((c) => c.graphic!.data.template === 'keyword')!
    press(buttons(TG.DROP, row(added.id))[0])
    expect(rowOf('soft').add).not.toBeNull()
    await pressFind()
    expect(dropRows()).toHaveLength(3)
    for (const r of dropRows()) expect(r.refused).toBeNull()
  })

  it('the rows are the clip’s own: another clip shows none of them', async () => {
    await pressFind()
    expect(dropRows('shot2')).toEqual([])
  })
})

describe('Add graphic from these words (try-out 1, 2026-11-15, piece 5)', () => {
  /* The session's own script lines, one word every 400 ms: s00 a ring (0 s), s01 negated, s02 a keyword's line, then fillers. */
  const LINES = ['Forty percent of my couples book me a year ahead.', 'I do not charge five hundred dollars for an album.', 'Light matters — more than gear.', ...Array.from({ length: 6 }, () => FILLER)]
  beforeEach(() => {
    start()
    useEditor.setState({ project: { ...project(), transcripts: { ...project().transcripts, talk: talk('talk', LINES) } } })
  })
  /** The rows' own words for the clip, as ClipWords shows them. */
  const rowWords = () => clipWordsOf(project().transcripts.talk, clipSourceWindowOf(clipById('shot')!, FPS))!
  /** Pick as the tile does: a row clicked, or a run of positions in the rows' words. */
  const pickRow = (r: number): void => state().setClipRun('shot', rowWords().transcript, runFromRowsOf(rowWords().transcript, r, r), r)
  const pickWords = (from: number, to: number): void => state().setClipRun('shot', rowWords().transcript, { from, to }, null)
  const fromWords = (): Host => {
    const b = buttons(TG.FROM_WORDS)
    expect(b).toHaveLength(1)
    return b[0]
  }

  it('sits under Find, greyed with its reason until something is picked; picked, it says what it does', () => {
    const all = section()
    const find = all.findIndex((h) => h.type === 'button' && text(h) === TG.FIND_GRAPHICS)
    const mine = all.findIndex((h) => h.type === 'button' && text(h) === TG.FROM_WORDS)
    expect(mine).toBe(find + 1)
    expect(fromWords().props.disabled).toBe(true)
    expect(fromWords().props.title).toBe(TG.FROM_WORDS_NEEDS_PICK)
    pickRow(0)
    expect(fromWords().props.disabled).toBe(false)
    expect(fromWords().props.title).toBe(TG.FROM_WORDS_TITLE)
    // A pick on another clip is not this clip's.
    state().setClipRun('shot2', rowWords().transcript, { from: 0, to: 1 }, null)
    expect(fromWords().props.disabled).toBe(true)
  })

  it('a row picked: its sentence’s ring lands in ONE undo step, listed with Drop, under Find’s rule', () => {
    pickRow(0)
    const before = project()
    expect(press(fromWords())).toBeNull()
    const [ring] = clipItGraphics()
    expect(ring.graphic!.data).toEqual({ template: 'ring', value: '40%', label: 'couples' })
    expect(listed()).toContain(ring.id)
    expect(bake.asks).toContain(ring.id)
    undoesTo(before)
  })

  it('words picked inside a row: a keyword of exactly those words, landing within 6 s of the ring', () => {
    pickRow(0)
    press(fromWords())
    // s02 starts at word 20: "more than gear." are positions 23..25.
    pickWords(23, 25)
    expect(press(fromWords())).toBeNull()
    expect(clipItGraphics().map((c) => c.graphic!.data)).toContainEqual({ template: 'keyword', words: 'more than gear', lit: 2 })
  })

  it('a truth refusal is not lost: nothing placed, the row listed with its reason, Add and the note, and a notice; its Add then lands', () => {
    pickRow(1)
    const before = project()
    const past = state().past.length
    expect(press(fromWords())).toBe(FROM_WORDS_LISTED_NOTE)
    expect(project()).toBe(before)
    expect(state().past.length).toBe(past)
    const rows = dropRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toContain('said negated')
    expect(rows[0].refused).toBe(FROM_WORDS_LISTED_NOTE)
    expect(rows[0].add).not.toBeNull()
    expect(state().notices.map((n) => n.text)).toContainEqual(expect.stringContaining('it is listed under Graphics'))
    // No Find ran: the notes do not say a run used no model.
    expect(section().some((h) => text(h) === TG.NO_MODEL_LINE)).toBe(false)
    expect(press(rows[0].add!)).toBeNull()
    expect(clipItGraphics().map((c) => c.graphic!.data)).toContainEqual({ template: 'counter', value: '$500', label: 'album' })
    expect(dropRows()).toEqual([])
  })

  it('greyed while any Find runs, on this clip or another, with the busy title', () => {
    pickRow(0)
    for (const running of ['shot', 'shot2']) {
      useEditor.setState({ findingGraphics: running })
      expect(fromWords().props.disabled, running).toBe(true)
      expect(fromWords().props.title, running).toBe(GRAPHICS_BUSY_NOTE)
    }
    useEditor.setState({ findingGraphics: null })
    expect(fromWords().props.disabled).toBe(false)
  })

  it('a by-hand refusal joins the clip’s Find list: Find’s rows, notes and model stay at their indices, and Add on an old row places its own graphic', async () => {
    answer = answering(
      g({ sentence: 's00', template: 'counter', value: '99', label: 'couples' }),
      g({ sentence: 's99', template: 'ring', value: '70%', label: 'couples' })
    )
    await pressFind()
    const found = state().lastGraphics!
    expect(found.clipId).toBe('shot')
    expect(found.drops.length).toBeGreaterThanOrEqual(2)
    const nine = found.drops.findIndex((d) => d.text === '99' && d.add !== undefined)
    expect(nine).toBeGreaterThanOrEqual(0)
    pickRow(1)
    expect(press(fromWords())).toBe(FROM_WORDS_LISTED_NOTE)
    const after = state().lastGraphics!
    expect(after.model).toBe(found.model)
    expect(after.notes).toEqual(found.notes)
    expect(after.drops.slice(0, found.drops.length)).toEqual(found.drops)
    expect(after.drops).toHaveLength(found.drops.length + 1)
    expect(after.drops[found.drops.length]).toMatchObject({ template: 'counter', text: '$500', refused: FROM_WORDS_LISTED_NOTE })
    expect(dropRows().map((r) => r.index)).toEqual(expect.arrayContaining([nine, found.drops.length]))
    // Add on Find's own row still places Find's graphic, not the by-hand one.
    expect(press(dropRows().find((r) => r.index === nine)!.add!)).toBeNull()
    expect(clipItGraphics().map((c) => c.graphic!.data)).toEqual([{ template: 'counter', value: '99', label: 'couples' }])
    expect(dropRows().map((r) => r.index)).toContain(found.drops.length)
  })

  it('pressed again on the same refused sentence: one row, marked again, not two', () => {
    pickRow(1)
    press(fromWords())
    press(fromWords())
    const rows = dropRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].refused).toBe(FROM_WORDS_LISTED_NOTE)
  })

  it('a placement refusal (another graphic on screen) is a notice only: nothing placed, nothing listed, no undo step', () => {
    pickRow(0)
    expect(press(fromWords())).toBeNull()
    // "couples" alone (row 0's fifth word, position 4), under the ring.
    pickWords(4, 4)
    const before = project()
    const past = state().past.length
    expect(press(fromWords())).toBe(ON_SCREEN_REASON)
    expect(project()).toBe(before)
    expect(state().past.length).toBe(past)
    expect(state().notices.map((n) => n.text)).toContain(ON_SCREEN_REASON)
    expect(dropRows()).toEqual([])
  })

  it('a pick made over other words than the clip plays now (the clip trimmed) greys the button and adds nothing', () => {
    pickRow(0)
    expect(fromWords().props.disabled).toBe(false)
    useEditor.setState({ project: { ...project(), clips: project().clips.map((c) => (c.id === 'shot' ? { ...c, inPoint: FPS * 2, duration: c.duration - FPS * 2 } : c)) } })
    expect(fromWords().props.disabled).toBe(true)
    const before = project()
    expect(state().addGraphicFromWords('shot')).toBeNull()
    expect(project()).toBe(before)
  })

  it('nothing to draw says so in a note and changes nothing', () => {
    // "—" alone (s02's third word, position 22).
    pickWords(22, 22)
    const before = project()
    expect(press(fromWords())).toBe(NOTHING_TO_DRAW_NOTE)
    expect(project()).toBe(before)
    expect(state().notices.map((n) => n.text)).toContain(NOTHING_TO_DRAW_NOTE)
    expect(dropRows()).toEqual([])
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

  it('transcript-graphics-drops: a real Find with no model over the stub transcript drops a negated counter and a keyword for room, each with Add; every text row counts what the fixture says; one Add is refused, one lands', async () => {
    const census = (await import('../fixtures/ui-census.json')).default as Array<{ label: string; match: string; needs?: string; count?: number }>
    const rows = census.filter((r) => r.needs === 'transcript-graphics-drops' && r.match === 'text')
    expect(rows.map((r) => r.label)).toContain(TG.ADD)
    // The bridge's video: 6 s (harness/bridge.ts sampleVideo(6, …)); the bridge has no model, as here.
    const base = emptyProject('census')
    const clip: Clip = { ...shotOf('V', 'vid', 0), duration: FPS * 6 }
    const p: Project = {
      ...base,
      settings: { ...base.settings, fps: FPS },
      assets: [footage('vid', { width: 640, height: 360, durationFrames: FPS * 6 })],
      clips: [clip],
      transcripts: { vid: harnessDropsTranscript('vid') }
    }
    useEditor.setState({ project: p, selectedClipId: 'V', selectedClipIds: ['V'], lastGraphics: null })
    answer = async () => {
      throw new Error('Directing with a model is not supported in the harness')
    }
    await useEditor.getState().findGraphics('V')
    expect(clipItGraphics().map((c) => c.graphic!.data)).toContainEqual({ template: 'ring', value: '40%', label: 'couples' })
    // The recipe's own condition: a negated counter with Add and a keyword dropped for room with Add.
    const drops = state().lastGraphics!.drops
    const negated = drops.findIndex((d) => d.template === 'counter' && d.text === '$500' && d.add !== undefined && d.reason.includes("'$500' is said negated in s01"))
    const roomy = drops.findIndex((d) => d.template === 'keyword' && d.text === 'gear' && d.add !== undefined && d.reason.startsWith('within 6 s of '))
    expect(negated, JSON.stringify(drops.map((d) => [d.template, d.text, d.reason]))).toBeGreaterThanOrEqual(0)
    expect(roomy, JSON.stringify(drops.map((d) => [d.template, d.text, d.reason]))).toBeGreaterThanOrEqual(0)
    const html = renderToStaticMarkup(createElement(TranscriptPanel))
    const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
    const quote = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const r of rows) {
      const whole = new RegExp(`(?:>|-->)${quote(escape(r.label))}(?:<)`, 'g')
      expect([...html.matchAll(whole)], r.label).toHaveLength(r.count ?? 1)
    }
    // What the session will see when it presses them: the counter refused (the ring is on screen then), the keyword placed.
    expect(state().addDroppedGraphic(negated)).toBe('another graphic is on screen then')
    expect(state().addDroppedGraphic(roomy)).toBeNull()
    expect(clipItGraphics().map((c) => c.graphic!.data)).toContainEqual({ template: 'keyword', words: 'gear', lit: 0 })
  })

  it('transcript-graphics-words: Add graphic from these words on the stub transcript’s negated row lists it with its note; every text and title row counts what the fixture says', async () => {
    const census = (await import('../fixtures/ui-census.json')).default as Array<{ label: string; match: string; needs?: string; count?: number }>
    const rows = census.filter((r) => r.needs === 'transcript-graphics-words')
    expect(rows.map((r) => r.label)).toEqual(expect.arrayContaining([FROM_WORDS_LISTED_NOTE, TG.FROM_WORDS_TITLE]))
    const base = emptyProject('census')
    const clip: Clip = { ...shotOf('V', 'vid', 0), duration: FPS * 6 }
    const p: Project = {
      ...base,
      settings: { ...base.settings, fps: FPS },
      assets: [footage('vid', { width: 640, height: 360, durationFrames: FPS * 6 })],
      clips: [clip],
      transcripts: { vid: harnessDropsTranscript('vid') }
    }
    useEditor.setState({ project: p, selectedClipId: 'V', selectedClipIds: ['V'], lastGraphics: null, clipRun: null })
    // The recipe's own steps (harness/census.ts 'transcript-graphics-words').
    const words = clipWordsOf(p.transcripts.vid, clipSourceWindowOf(clip, FPS))!
    state().setClipRun('V', words.transcript, runFromRowsOf(words.transcript, 1, 1), 1)
    expect(state().addGraphicFromWords('V')).toBe(FROM_WORDS_LISTED_NOTE)
    const drops = state().lastGraphics!.drops
    expect(drops.some((d) => d.template === 'counter' && d.add !== undefined && d.reason.includes('said negated') && d.refused === FROM_WORDS_LISTED_NOTE)).toBe(true)
    const html = renderToStaticMarkup(createElement(TranscriptPanel))
    const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
    const quote = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const r of rows) {
      const whole = r.match === 'title' ? new RegExp(`title="${quote(escape(r.label))}"`, 'g') : new RegExp(`(?:>|-->)${quote(escape(r.label))}(?:<)`, 'g')
      expect([...html.matchAll(whole)], r.label).toHaveLength(r.count ?? 1)
    }
    // What the session will see when it presses: s00's ring lands; the "$500" row's Add is then refused (the ring is on screen); "gear" alone lands.
    state().setClipRun('V', words.transcript, runFromRowsOf(words.transcript, 0, 0), 0)
    expect(state().addGraphicFromWords('V')).toBeNull()
    expect(state().addDroppedGraphic(drops.length - 1)).toBe('another graphic is on screen then')
    const gear = words.transcript.words.length - 1
    state().setClipRun('V', words.transcript, { from: gear, to: gear }, null)
    expect(state().addGraphicFromWords('V')).toBeNull()
    expect(clipItGraphics().map((c) => c.graphic!.data)).toEqual(
      expect.arrayContaining([{ template: 'ring', value: '40%', label: 'couples' }, { template: 'keyword', words: 'gear', lit: 0 }])
    )
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
