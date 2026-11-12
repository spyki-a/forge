import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import type { Segment, Transcript, Word } from '@shared/transcript'
import * as validator from '@shared/director/validateGraphics'
import { CLIPS_GRAPHIC_RULE, lowerThirdFor, resoundGraphic } from '@shared/graphics/apply'
import { GRAPHIC_TEMPLATES, type FieldMode, type GraphicData, type GraphicSpec } from '@shared/graphics/template'
import { soundPackFor } from '@shared/director/soundRoles'

/*
 * Lane T2b, piece 5 (docs/CLIPS.md §6.6, "The dock's panel"; the test §6.6
 * names `tests/renderer/graphicPanel.test.tsx`): the Trimmer dock's panel for
 * a clip that draws a graphic. As tests/renderer/transcriptGraphics.test.tsx
 * does: the store mocked to a plain selector over the REAL store's state, so
 * the panel — which has no hook but the store's — is called as a function and
 * every edit runs the real action; the bake is a recorder; every transcript
 * and the sound library are data built here.
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

const { useEditor } = await import('../../src/renderer/src/store')
const { useCatalog } = await import('../../src/renderer/src/catalog')
const GP = await import('../../src/renderer/src/components/GraphicPanel')
const { TrimmerDock } = await import('../../src/renderer/src/components/TrimmerDock')
const census = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/ui-census.json'), 'utf8')) as { label: string; match: string; home: string; needs: string; count?: number }[]
const { GraphicPanel } = GP

const FPS = 30
const FILLER = 'The light was soft that day.'

/** `sentences`, one word every 400 ms, segment ids s00, s01, … */
function talk(assetId: string, sentences: string[]): Transcript {
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
  return { assetId, language: 'en', model: 'whisper-small', durationMs: index * 400, words, segments }
}

/* s00 "We signed 40 clients this year." (words 0-5), s01 a filler, s02 "Keep it simple, three steps: shoot, edit, share." */
const SAID = ['We signed 40 clients this year.', FILLER, 'Keep it simple always today.', ...Array.from({ length: 6 }, () => FILLER)]

const footage = (id: string, extra: Partial<MediaAsset> = {}): MediaAsset => ({
  id, path: `/media/${id}.mp4`, name: id, kind: 'video', durationFrames: FPS * 140, width: 1080, height: 1920, fps: FPS, hasVideo: true, hasAudio: true, size: 1, ...extra
})
const drawnAsset = (id: string): MediaAsset => ({ id, path: '', name: 'graphic', kind: 'image', durationFrames: 300, size: 0, width: 1080, height: 1920, fps: null, hasVideo: true, hasAudio: false })
const base = (id: string, assetId: string, trackId: string, start: number, duration: number): Clip => ({
  id, assetId, trackId, start, duration, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 }
})

/** A graphic clip over the talk shot, grounded on `sentence` of the talk's transcript, made by Find. */
function graphicClip(id: string, data: GraphicData, over: Partial<GraphicSpec> = {}): Clip {
  return {
    ...base(id, `drawn-${id}`, 'v2', 0, FPS * 3),
    graphic: {
      data,
      seconds: GRAPHIC_TEMPLATES[data.template]!.seconds.default,
      beats: [0.8],
      grounding: { assetId: 'talk', sentence: 's00', words: [2] },
      place: { auto: true, third: 'middle' },
      seed: 1,
      version: 1,
      ...over
    },
    generatedBy: { rule: CLIPS_GRAPHIC_RULE, reason: 'r' }
  }
}

/** One fixture per drawn template, each field filled with what s00 or s02 says. */
const FIXTURES: Record<string, GraphicData> = {
  counter: { template: 'counter', value: '40', label: 'clients' },
  ring: { template: 'ring', value: '40', label: 'clients' },
  bars: { template: 'bars', title: 'clients', items: [{ label: 'clients', value: '40' }, { label: 'year', value: '40' }] },
  steps: { template: 'steps', title: 'signed', items: [{ label: 'signed' }, { label: 'clients' }], connector: 'none' },
  quote: { template: 'quote', text: 'We signed 40 clients', speaker: '' },
  callout: { template: 'callout', label: 'clients', shape: 'arrow' },
  keyword: { template: 'keyword', words: 'signed', lit: 0 },
  'lower-third': { template: 'lower-third', name: 'Ana', role: '' }
}

function start(clips: Clip[], over: { transcript?: boolean; speaker?: string } = {}): void {
  const p = emptyProject('graphic panel')
  useEditor.setState({
    ...useEditor.getInitialState(),
    project: {
      ...p,
      settings: { ...p.settings, width: 1080, height: 1920, fps: FPS },
      assets: [footage('talk', over.speaker === undefined ? { speaker: 'Ana' } : over.speaker === '' ? {} : { speaker: over.speaker }), ...clips.map((c) => drawnAsset(c.assetId))],
      clips: [base('shot', 'talk', 'v1', 0, FPS * 70), ...clips],
      transcripts: over.transcript === false ? {} : { talk: talk('talk', SAID) }
    },
    selectedClipId: clips[0]?.id ?? null,
    selectedClipIds: clips[0] ? [clips[0].id] : [],
    past: [],
    future: [],
    notices: []
  })
}

const state = () => useEditor.getState()
const project = (): Project => state().project
const clipById = (id: string): Clip => project().clips.find((c) => c.id === id)!
const dataOf = (id: string): GraphicData => clipById(id).graphic!.data

beforeEach(() => {
  bake.asks = []
  useCatalog.setState({
    catalog: { version: 3, generatedAt: '', scannedFrom: '/lib', entries: [{ id: 'clock', kind: 'sfx', name: 'clock tick', file: 'sfx/clock_tick.wav', tags: [], meta: {} }] },
    root: '/lib'
  })
})

afterEach(() => {
  vi.restoreAllMocks()
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

/** The panel for clip `id` as the dock draws it now. */
const panel = (id: string): Host[] => hosts(GraphicPanel({ clip: clipById(id) }))

/** The shown fields' paths and modes, in order. */
const shownFields = (id: string): [string, string][] =>
  panel(id)
    .filter((h) => typeof h.props['data-graphic-field'] === 'string')
    .map((h) => [h.props['data-graphic-field'] as string, h.props['data-mode'] as string])

/** One field's own hosts, found by its path; its input found through its label's htmlFor. */
function field(id: string, path: string): { label: string; input: Host; warnings: string[] } {
  const box = panel(id).find((h) => h.props['data-graphic-field'] === path)
  if (!box) throw new Error(`${path} is not shown`)
  const inner = hosts(box.props.children as ReactNode)
  const labels = inner.filter((h) => h.type === 'label')
  expect(labels).toHaveLength(1)
  const input = inner.find((h) => h.type === 'input' && h.props.id === labels[0].props.htmlFor)!
  const warnings = inner.filter((h) => h.type === 'p' && h.props['data-warning-for'] === path).map(text)
  return { label: text(labels[0]), input, warnings }
}
/** Type into a field and leave it, as a user does. */
function edit(id: string, path: string, value: string): void {
  ;(field(id, path).input.props.onBlur as (e: { target: { value: string } }) => void)({ target: { value } })
}
const allWarnings = (id: string): string[] => panel(id).filter((h) => h.type === 'p' && typeof h.props['data-warning-for'] === 'string').map(text)
const choiceButtons = (id: string): string[] => {
  const all = panel(id)
  const box = all.find((h) => typeof h.props['data-graphic-choice'] === 'string')
  return box ? hosts(box.props.children as ReactNode).filter((h) => h.type === 'button').map(text) : []
}
const buttonsOf = (id: string, label: string): Host[] => panel(id).filter((h) => h.type === 'button' && text(h) === label)

/** One undo: the project exactly as given, and the history one shorter. */
function undoesTo(before: Project): void {
  const past = state().past.length
  state().undo()
  expect(project()).toEqual(before)
  expect(state().past.length).toBe(past - 1)
}

/** Every field the template checks, by mode, for its fixture: the paths §6.6 says are re-checked. */
function checkedPaths(data: GraphicData): string[] {
  const def = GRAPHIC_TEMPLATES[data.template]!
  const items = 'items' in data ? data.items : []
  const out: string[] = []
  for (const [key, mode] of Object.entries(def.fields) as [string, FieldMode][]) {
    if (!['grounded', 'verbatim', 'index'].includes(mode)) continue
    if (key.startsWith('items.')) items.forEach((_, j) => out.push(`items[${j}].${key.slice(6)}`))
    else out.push(key)
  }
  return out
}

/* ---------------------------------------------------------------- tests */

describe('the dock’s graphic panel (§6.6)', () => {
  it('is mounted in the Inspector beside PaperPanel and CarouselPanel, once, for a clip with .graphic', () => {
    expect([GP.SPEAKER_FIELD, GP.ROLE]).toEqual(['Speaker', 'Role'])
    const inspector = readFileSync(resolve(__dirname, '../../src/renderer/src/components/Inspector.tsx'), 'utf8')
    const mount = '{clip.graphic && <GraphicPanel clip={clip} />}'
    expect([...inspector.matchAll(/<GraphicPanel /g)]).toHaveLength(1)
    expect([...inspector.matchAll(/\{clip\.graphic && <GraphicPanel clip=\{clip\} \/>\}/g)]).toHaveLength(1)
    const paper = '{clip.paper && <PaperPanel clip={clip} />}'
    const ring = '{clip.carousel && <CarouselPanel clip={clip} />}'
    expect([...inspector.matchAll(/<PaperPanel /g)]).toHaveLength(1)
    expect([...inspector.matchAll(/<CarouselPanel /g)]).toHaveLength(1)
    expect(inspector.indexOf(paper)).toBeLessThan(inspector.indexOf(ring))
    expect(inspector.indexOf(ring)).toBeLessThan(inspector.indexOf(mount))
    // A footage clip gets no panel.
    start([graphicClip('g', FIXTURES.counter)])
    expect(GraphicPanel({ clip: clipById('shot') })).toBeNull()
    expect(panel('g').filter((h) => h.type === 'span' && text(h) === GP.GRAPHIC_PANEL_HEADING)).toHaveLength(1)
  })

  it('re-checks every grounded, verbatim or index field on each edit through checkGraphicData, the export validateGraphics calls', () => {
    for (const [template, data] of Object.entries(FIXTURES)) {
      const paths = checkedPaths(data)
      if (paths.length === 0) continue
      start([graphicClip('g', data)])
      const def = GRAPHIC_TEMPLATES[data.template]!
      // Each checked field is shown with its mode.
      for (const path of paths) expect(shownFields('g').map(([p]) => p), template).toContain(path)
      for (const path of paths) {
        const spy = vi.spyOn(validator, 'checkGraphicData')
        const was = field('g', path).input.props.defaultValue as string
        const typed = path === 'lit' ? '1' : `${was} x`
        edit('g', path, typed)
        // Saved, whatever the check will say.
        const saved = (dataOf('g') as unknown as Record<string, unknown>)
        const at = /^items\[(\d+)\]\.(\w+)$/.exec(path)
        const stored = at ? (saved.items as Record<string, unknown>[])[Number(at[1])][at[2]] : saved[path]
        expect(stored, `${template} ${path}`).toBe(path === 'lit' ? 1 : typed)
        spy.mockClear()
        // The panel as it draws after the edit: the check ran on the edited data, the template, the grounding and the transcript.
        panel('g')
        expect(spy, `${template} ${path}`).toHaveBeenCalledTimes(1)
        const [checkedData, checkedDef, grounding, transcript, speakers] = spy.mock.calls[0]
        expect(checkedData).toEqual(dataOf('g'))
        // The asset's Speaker as the said quote's speaker, as settleGraphics passes it (piece 2).
        expect(speakers, `${template} ${path}`).toEqual(['Ana'])
        expect(checkedDef).toBe(def)
        expect(grounding).toEqual(clipById('g').graphic!.grounding)
        expect(transcript).toBe(project().transcripts.talk)
        // What the check says is what is shown, under that field: the very binding the component calls.
        spy.mockReturnValueOnce([{ path: `$.${path}`, message: 'made up' }])
        expect(field('g', path).warnings, `${template} ${path}`).toEqual(['made up'])
        spy.mockRestore()
      }
    }
  })

  it('a typed number not in the stretch shows a warning under its field; the field stays editable and the value is saved, in one undo step', () => {
    start([graphicClip('g', FIXTURES.counter)])
    expect(allWarnings('g')).toEqual([])
    const before = project()
    edit('g', 'value', '45')
    expect(dataOf('g')).toEqual({ template: 'counter', value: '45', label: 'clients' })
    expect(clipById('g').graphic!.version).toBe(2)
    const value = field('g', 'value')
    expect(value.warnings).toEqual(["'45' is not said in s00"])
    // Never a block: not disabled, not read-only, and it still takes an edit.
    expect(value.input.props.disabled).toBeUndefined()
    expect(value.input.props.readOnly).toBeUndefined()
    expect(value.input.props.defaultValue).toBe('45')
    expect(typeof value.input.props.onBlur).toBe('function')
    undoesTo(before)
    edit('g', 'value', '45')
    edit('g', 'value', '40')
    expect(dataOf('g')).toEqual(FIXTURES.counter)
    expect(allWarnings('g')).toEqual([])
  })

  it('an index out of range is saved and warned about (lit)', () => {
    start([graphicClip('g', FIXTURES.keyword, { grounding: { assetId: 'talk', sentence: 's00', words: [1] } })])
    expect(allWarnings('g')).toEqual([])
    edit('g', 'lit', '3')
    expect(dataOf('g')).toEqual({ template: 'keyword', words: 'signed', lit: 3 })
    expect(field('g', 'lit').warnings).toEqual(["lit 3 is not one of the keyword's 1 words"])
  })

  it('user fields are never checked: a lower third’s Role, a social card’s fields', () => {
    const spy = vi.spyOn(validator, 'checkGraphicData')
    start([graphicClip('lt', FIXTURES['lower-third'])])
    expect(shownFields('lt')).toContainEqual(['name', 'speaker'])
    expect(shownFields('lt')).toContainEqual(['role', 'user'])
    expect(shownFields('lt').filter(([, mode]) => ['grounded', 'verbatim', 'index'].includes(mode))).toEqual([])
    expect(field('lt', 'role').label).toBe(GP.ROLE)
    const before = project()
    edit('lt', 'role', 'Photographer?!')
    expect(dataOf('lt')).toEqual({ template: 'lower-third', name: 'Ana', role: 'Photographer?!' })
    panel('lt')
    expect(spy).not.toHaveBeenCalled()
    expect(allWarnings('lt')).toEqual([])
    undoesTo(before)

    const social: GraphicData = { template: 'quote', kind: 'social', text: 'Never said 99', name: 'Someone', handle: '@x', date: '2026', link: 'https://example.invalid' }
    start([graphicClip('sq', social)])
    expect(shownFields('sq').map(([p]) => p)).toEqual(expect.arrayContaining(['text', 'name', 'handle', 'date', 'link']))
    expect(shownFields('sq').filter(([, mode]) => mode !== 'user')).toEqual([])
    edit('sq', 'text', 'Not in any transcript 1234')
    expect((dataOf('sq') as { text: string }).text).toBe('Not in any transcript 1234')
    panel('sq')
    expect(spy).not.toHaveBeenCalled()
    expect(allWarnings('sq')).toEqual([])
  })

  it('the choices appear only on their templates: the steps’ connector, the callout’s shape', () => {
    for (const [template, data] of Object.entries(FIXTURES)) {
      start([graphicClip('g', data)])
      const want = template === 'steps' ? ['None', 'Line', 'Tree'] : template === 'callout' ? ['Arrow', 'Circle'] : []
      expect(choiceButtons('g'), template).toEqual(want)
      for (const label of ['None', 'Line', 'Tree', 'Arrow', 'Circle']) {
        expect(buttonsOf('g', label).length, `${template} ${label}`).toBe(want.includes(label) ? 1 : 0)
      }
    }
    start([graphicClip('s', FIXTURES.steps)])
    const before = project()
    ;(buttonsOf('s', 'Tree')[0].props.onClick as () => void)()
    expect((dataOf('s') as { connector: string }).connector).toBe('tree')
    expect(buttonsOf('s', 'Tree')[0].props['aria-pressed']).toBe(true)
    undoesTo(before)
    start([graphicClip('c', FIXTURES.callout)])
    ;(buttonsOf('c', 'Circle')[0].props.onClick as () => void)()
    expect((dataOf('c') as { shape: string }).shape).toBe('circle')
  })

  it('a Speaker field shows the asset’s Speaker and editing it calls setSpeaker', () => {
    start([graphicClip('lt', FIXTURES['lower-third']), graphicClip('q', { template: 'quote', text: 'We signed 40 clients', speaker: 'Ana' }, { beats: [0.8] })])
    const calls: [string, string][] = []
    const real = state().setSpeaker
    useEditor.setState({ setSpeaker: (assetId: string, name: string) => { calls.push([assetId, name]); real(assetId, name) } })
    const name = field('lt', 'name')
    expect(name.label).toBe(GP.SPEAKER_FIELD)
    expect(name.input.props.defaultValue).toBe('Ana')
    expect(field('q', 'speaker').input.props.defaultValue).toBe('Ana')
    // The said quote is checked with the asset's Speaker as its speaker: no false "not who said it".
    const spy = vi.spyOn(validator, 'checkGraphicData')
    expect(field('q', 'speaker').warnings).toEqual([])
    expect(spy.mock.calls.map((c) => c[4])).toEqual([['Ana']])
    spy.mockRestore()
    const before = project()
    edit('lt', 'name', 'Bea')
    expect(calls).toEqual([['talk', 'Bea']])
    expect(project().assets.find((a) => a.id === 'talk')!.speaker).toBe('Bea')
    // setSpeaker redraws every graphic of the asset that drew the old name.
    expect(dataOf('lt')).toEqual({ template: 'lower-third', name: 'Bea', role: '' })
    expect((dataOf('q') as { speaker: string }).speaker).toBe('Bea')
    undoesTo(before)
    // Leaving it unchanged calls nothing, spaces around it included (the Speaker is held trimmed).
    edit('lt', 'name', 'Ana')
    edit('lt', 'name', '  Ana ')
    expect(calls).toEqual([['talk', 'Bea']])
  })

  it('with no Speaker on the asset the check is given no speaker', () => {
    start([graphicClip('q', { template: 'quote', text: 'We signed 40 clients', speaker: '' })], { speaker: '' })
    const spy = vi.spyOn(validator, 'checkGraphicData')
    expect(field('q', 'speaker').input.props.defaultValue).toBe('')
    expect(spy.mock.calls.map((c) => c[4])).toEqual([[]])
  })

  it('a link asset with no Speaker shows the channel a said quote draws as the Speaker field’s placeholder', () => {
    start([graphicClip('q', { template: 'quote', text: 'We signed 40 clients', speaker: 'Chan' })], { speaker: '' })
    useEditor.setState({
      project: { ...project(), assets: project().assets.map((a) => (a.id === 'talk' ? { ...a, credit: { source: 'link' as const, title: 'A talk', author: 'Chan', pageUrl: 'https://example.invalid/v', line: 'A talk — Chan, https://example.invalid/v', attributionRequired: false, fetchedAt: '2026-11-11T00:00:00Z' } } : a)) }
    })
    const input = field('q', 'speaker').input
    expect(input.props.defaultValue).toBe('')
    expect(input.props.placeholder).toBe('Chan')
    // With a Speaker set there is no placeholder.
    start([graphicClip('q', { template: 'quote', text: 'We signed 40 clients', speaker: 'Ana' })])
    expect(field('q', 'speaker').input.props.placeholder).toBeUndefined()
  })

  it('a lower third’s Role is pre-filled, at creation, from the asset’s most recent lower third', () => {
    start([
      graphicClip('lt1', { template: 'lower-third', name: 'Ana', role: 'Planner' }),
      { ...graphicClip('lt2', { template: 'lower-third', name: 'Ana', role: 'Photographer' }), start: FPS * 30 },
      { ...graphicClip('other', { template: 'lower-third', name: 'Cy', role: 'Florist' }, { grounding: { assetId: 'talk2', sentence: 's00', words: [0] } }), start: FPS * 40 }
    ])
    const p = project()
    const shot2 = { ...base('shot2', 'talk', 'v1', FPS * 70, FPS * 30) }
    const withShot2: Project = { ...p, clips: [...p.clips, shot2] }
    expect(lowerThirdFor(withShot2, shot2)?.candidate.data).toEqual({ template: 'lower-third', name: 'Ana', role: 'Photographer' })
    // None of the asset's: ''.
    const none: Project = { ...withShot2, clips: withShot2.clips.filter((c) => c.graphic?.data.template !== 'lower-third' || c.id === 'other') }
    expect(lowerThirdFor(none, shot2)?.candidate.data).toEqual({ template: 'lower-third', name: 'Ana', role: '' })
  })

  it('the seconds stay within the template’s bounds, and a seconds edit leaves the sounds on their beats, in one undo step', () => {
    // A counter whose tick is on its beat at 1 s: 30 frames into the clip, less the file's peak.
    const g = graphicClip('g', FIXTURES.counter, { beats: [1], seconds: 4 })
    start([{ ...g, duration: FPS * 4 }])
    const pack = soundPackFor(useCatalog.getState().catalog, '/lib')
    useEditor.setState({ project: resoundGraphic(project(), 'g', pack).project })
    const sounds = (p: Project) => p.clips.filter((c) => c.forGraphic === 'g').map((c) => ({ start: c.start, duration: c.duration, inPoint: c.inPoint, assetId: c.assetId }))
    const placed = sounds(project())
    expect(placed).toHaveLength(1)
    // The tick's start, written down: the beat's frame (1 s × 30) less the file's peak frames (the catalog's clock has no peak: 0).
    expect(placed[0].start).toBe(0 + 30)
    const seconds = (): Host => panel('g').find((h) => h.type === 'input' && h.props.id === 'forge-graphic-seconds')!
    const type = (value: string): void => (seconds().props.onBlur as (e: { target: { value: string } }) => void)({ target: { value } })
    expect([seconds().props.min, seconds().props.max]).toEqual([2, 4])
    const before = project()
    type('2.5')
    expect(clipById('g').graphic!.seconds).toBe(2.5)
    expect(clipById('g').duration).toBe(75)
    // The beat is inside the new length: its sound is still there, on the same frame.
    expect(sounds(project())).toEqual(placed)
    expect(allWarnings('g')).toEqual([])
    undoesTo(before)
    // Out of bounds: kept to them, never refused; a tenth of a second at most.
    type('99')
    expect(clipById('g').graphic!.seconds).toBe(4)
    type('0')
    expect(clipById('g').graphic!.seconds).toBe(2)
    type('2.53')
    expect(clipById('g').graphic!.seconds).toBe(2.5)
    // A cleared field is no length: nothing changes.
    const at = project()
    type('')
    expect(project()).toBe(at)
  })

  it('a seconds edit that cuts a beat off drops that beat’s sound, and warns (never blocks) under Seconds that it is too short', () => {
    // Its tick at 3 s, past a 2.5 s end; §6.2's hold for it is 3 + TAIL_S = 3.8 s.
    const g = graphicClip('g', FIXTURES.counter, { beats: [3], seconds: 4 })
    start([{ ...g, duration: FPS * 4 }])
    const pack = soundPackFor(useCatalog.getState().catalog, '/lib')
    useEditor.setState({ project: resoundGraphic(project(), 'g', pack).project })
    expect(project().clips.filter((c) => c.forGraphic === 'g').map((c) => c.start)).toEqual([90])
    expect(allWarnings('g')).toEqual([])
    const seconds = panel('g').find((h) => h.type === 'input' && h.props.id === 'forge-graphic-seconds')!
    ;(seconds.props.onBlur as (e: { target: { value: string } }) => void)({ target: { value: '2.5' } })
    expect(clipById('g').graphic!.seconds).toBe(2.5)
    expect(project().clips.filter((c) => c.forGraphic === 'g')).toEqual([])
    const warned = panel('g').filter((h) => h.type === 'p' && h.props['data-warning-for'] === 'seconds').map(text)
    expect(warned).toEqual([GP.tooShortNote(3.8, 4)])
    expect(warned).toEqual(['It needs 3.8 s for its beats and to be read'])
    expect(panel('g').find((h) => h.type === 'input' && h.props.id === 'forge-graphic-seconds')!.props.disabled).toBeUndefined()
  })

  it('the place: an auto third, or a box you dragged with a way back to auto (one undo step)', () => {
    start([graphicClip('g', FIXTURES.counter, { place: { auto: false, box: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 } } })])
    expect(panel('g').filter((h) => h.props['data-graphic-place'] === 'box').map(text)).toEqual([GP.DRAGGED_BOX])
    const back = buttonsOf('g', GP.BACK_TO_AUTO)
    expect(back).toHaveLength(1)
    expect(back[0].props.disabled).toBe(false)
    const before = project()
    ;(back[0].props.onClick as () => void)()
    expect(clipById('g').graphic!.place.auto).toBe(true)
    expect(panel('g').filter((h) => h.props['data-graphic-place'] === 'auto')).toHaveLength(1)
    expect(buttonsOf('g', GP.BACK_TO_AUTO)).toHaveLength(0)
    undoesTo(before)
  })

  it('the census rows of graphic-lower-third: each label a whole text node in the dock as often as the fixture counts (reasoned; the screen is still to be read)', async () => {
    // As the recipe builds it: footage on the timeline, a lower third added through the store over it, selected.
    start([])
    const id = await state().addGraphicClip('v2', 0, {
      data: { template: 'lower-third', name: 'Census Speaker', role: '' }, seconds: 3.5, beats: [0.5], place: { auto: true, third: 'bottom' }, seed: 1, version: 1
    })
    expect(id).not.toBeNull()
    state().select(id!)
    const html = renderToStaticMarkup(createElement(TrimmerDock))
    const rows = census.filter((r) => r.needs === 'graphic-lower-third')
    expect(rows.map((r) => [r.label, r.match, r.home])).toEqual([
      [GP.GRAPHIC_PANEL_HEADING, 'text', 'dock'],
      [GP.ROLE, 'text', 'dock']
    ])
    const esc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const r of rows) expect([...html.matchAll(new RegExp(`>${esc(r.label)}<`, 'g'))], r.label).toHaveLength(r.count ?? 1)
    // Over an empty project the dock is not drawn at all.
    start([])
    state().select(null)
    expect(renderToStaticMarkup(createElement(TrimmerDock))).toBe('')
  })

  it('a graphic whose transcript is not in the project shows its fields unchecked, with one note, and still saves', () => {
    const spy = vi.spyOn(validator, 'checkGraphicData')
    start([graphicClip('g', FIXTURES.counter)], { transcript: false })
    expect(panel('g').filter((h) => h.type === 'p' && text(h) === GP.UNCHECKED_NOTE)).toHaveLength(1)
    edit('g', 'value', '45')
    expect((dataOf('g') as { value: string }).value).toBe('45')
    panel('g')
    expect(spy).not.toHaveBeenCalled()
    expect(allWarnings('g')).toEqual([])
    // A lower third has nothing to check: no note.
    start([graphicClip('lt', FIXTURES['lower-third'])], { transcript: false })
    expect(panel('lt').filter((h) => h.type === 'p' && text(h) === GP.UNCHECKED_NOTE)).toHaveLength(0)
  })

  it('a problem that names no shown field is shown under the heading', () => {
    // What the check returns for '$', for the list as a whole ('$.items': "the steps are not a valid tree") or for a path no field shows.
    start([graphicClip('s', FIXTURES.steps)])
    vi.spyOn(validator, 'checkGraphicData').mockReturnValue([
      { path: '$', message: 'whole' },
      { path: '$.items', message: 'the steps are not a valid tree' },
      { path: '$.sentence', message: 'gone' },
      { path: '$.items[0].label', message: 'a field’s own' }
    ])
    expect(panel('s').filter((h) => h.type === 'p' && h.props['data-warning-for'] === '').map(text)).toEqual(['whole', 'the steps are not a valid tree', 'gone'])
    expect(field('s', 'items[0].label').warnings).toEqual(['a field’s own'])
  })

  it('Back to auto, greyed with no footage under the graphic, says so (not that captions fill the thirds)', () => {
    const box = { auto: false as const, box: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 } }
    // Past the end of the only footage clip ('shot', 0 to 2100).
    start([{ ...graphicClip('g', FIXTURES.counter, { place: box }), start: 3000 }])
    const back = buttonsOf('g', GP.BACK_TO_AUTO)
    expect(back).toHaveLength(1)
    expect(back[0].props.disabled).toBe(true)
    expect(back[0].props.title).toBe(GP.NO_FOOTAGE_TITLE)
    expect(back[0].props.title).not.toBe(GP.NO_FREE_THIRD_TITLE)
    // Over footage with a free third: enabled, no title.
    start([graphicClip('g', FIXTURES.counter, { place: box })])
    expect(buttonsOf('g', GP.BACK_TO_AUTO)[0].props.title).toBeUndefined()
  })

  it('a graphic with checked fields and no grounding at all shows its own note, not the missing-transcript one', () => {
    const spy = vi.spyOn(validator, 'checkGraphicData')
    start([graphicClip('g', FIXTURES.counter, { grounding: undefined })])
    const notes = panel('g').filter((h) => h.type === 'p').map(text)
    expect(notes).toContain(GP.NO_GROUNDING_NOTE)
    expect(notes).not.toContain(GP.UNCHECKED_NOTE)
    expect(spy).not.toHaveBeenCalled()
    edit('g', 'value', '45')
    expect((dataOf('g') as { value: string }).value).toBe('45')
  })

  it('the check runs on the grounding’s transcript, not the footage clip’s', () => {
    const spy = vi.spyOn(validator, 'checkGraphicData')
    start([graphicClip('g', FIXTURES.counter, { grounding: { assetId: 'talk2', sentence: 's00', words: [2] } })])
    const t2 = talk('talk2', ['We signed 40 clients this year.'])
    useEditor.setState({ project: { ...project(), assets: [...project().assets, footage('talk2')], transcripts: { ...project().transcripts, talk2: t2 } } })
    panel('g')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][3]).toBe(t2)
  })

  it('an index is saved as a whole number; pressing the choice already chosen saves nothing', () => {
    start([graphicClip('g', FIXTURES.keyword, { grounding: { assetId: 'talk', sentence: 's00', words: [1] } })])
    edit('g', 'lit', '1.9')
    expect((dataOf('g') as { lit: number }).lit).toBe(1)
    start([graphicClip('s', FIXTURES.steps)])
    const at = project()
    const past = state().past.length
    ;(buttonsOf('s', 'None')[0].props.onClick as () => void)()
    expect(project()).toBe(at)
    expect(state().past.length).toBe(past)
  })
})
