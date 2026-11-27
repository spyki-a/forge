import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { linkCacheKey, parseLink } from '@shared/ingest/url'
import { FOLDOUT_START } from '@shared/foldout'
import { bestClips, NO_MODEL_NOTE, type BestClipCard, type BestClipsResult } from '@shared/bestclips/run'
import {
  BEST_CLIPS_CANNOT_LISTEN,
  BEST_CLIPS_NEEDS_TRANSCRIPT,
  BEST_CLIPS_RUNNING,
  BEST_CLIPS_RUNNING_ELSEWHERE,
  cardRange,
  cardWords,
  SCORED_BY_LABEL
} from '@shared/bestclips/session'
import { SIDECAR_METHODS } from '@shared/sidecar/protocol'
import type { SidecarStatus } from '@shared/sidecar/status'
import { PAUSE_BOUNDARY_MS, segmentIntoSentences, type Transcript, type Word } from '@shared/transcript'
import { CAP_MS, CAP_WORDS } from '@shared/bestclips/windows'
import {
  ADD_KEEPS_SHAPE,
  ADD_PORTRAIT,
  ADD_TO_PROJECT,
  cardKey,
  CLIP_IT_CARD,
  MAKE_IT_VERTICAL,
  newCardRecord,
  notLanded,
  NOT_NOW,
  QUESTION_HEAD,
  START_NEW_PROJECT,
  START_NEW_SAVED,
  START_NEW_SAVES,
  START_NEW_WAITS,
  STEP_LABEL,
  STEP_TEXT
} from '@shared/bestclips/cardClip'

/*
 * Best clips, rendered (docs/CLIPS.md §7.5's first half), in its two parts
 * since the clip maker's layout (2026-11-27):
 * - in the URL tile (`BestClips`): the heading, the four lengths as one
 *   fold-down list, Make it vertical, Analyse (which opens the panel on
 *   Clips), the "Clips" toggle with the count, the no-captions line and the
 *   pointer to Get transcript — and never a card or a note;
 * - in the fold-out's Clips tab (`BestClipsCards`): the running line, the
 *   cards (title, why, range, words, who picked, the card's note, Clip it,
 *   the question, the steps), the result's notes, or the line for nothing yet
 *   — and never a result's `problems` or `askNotes`.
 * Rendered to static markup, the store mocked to a plain selector over the
 * REAL store's state (ingestPanel.test.tsx's way). Every transcript is made
 * up; the caseless title is \u escapes.
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

const { useEditor } = await import('../../src/renderer/src/store')
const {
  BestClips,
  BestClipsCards,
  BEST_CLIPS_DURATION,
  CLIPS_TOGGLE,
  FOLDOUT_CLIPS_EMPTY,
  FOLDOUT_CLIPS_NO_LINK,
  FOLDOUT_CLIPS_NO_WORDS
} = await import('../../src/renderer/src/components/tools/BestClips')
const { IngestPanel } = await import('../../src/renderer/src/components/IngestPanel')

const URL = 'https://www.youtube.com/watch?v=MadeUpTalk6'
const LINK_KEY = linkCacheKey(parseLink(URL)!)

/** A made-up punctuated talk: `n` sentences of 8..14 Latin nonsense words (seeded), 280 ms a word, as tests/eval/bestClipsFixtures.ts builds them. */
function madeUpTalk(n: number, seed: number): Transcript {
  const VOCAB = ['zor', 'plim', 'tavek', 'mubo', 'senra', 'kilo', 'drav', 'oppen', 'vestra', 'nim', 'rulo', 'fesh', 'gandu', 'brel']
  let a = seed >>> 0
  const r = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const words: Word[] = []
  let at = 0
  for (let k = 0; k < n; k++) {
    const length = 8 + Math.floor(r() * 7)
    for (let i = 0; i < length; i++) {
      const last = i === length - 1
      const text = VOCAB[Math.floor(r() * 400) % VOCAB.length] + (last ? '.' : '')
      words.push({ index: words.length, text, startMs: at, endMs: at + 280, confidence: null })
      at += 280 + (last ? 300 : 60)
    }
  }
  return { assetId: 'url:test', language: 'en', model: 'test', durationMs: at, words, segments: segmentIntoSentences(words, PAUSE_BOUNDARY_MS, { maxWords: CAP_WORDS, maxMs: CAP_MS }) }
}

const T = madeUpTalk(60, 51)

function onLink(transcript: Transcript | null, status: 'ready' | 'none' | 'failed' = transcript ? 'ready' : 'none'): void {
  useEditor.setState((s) => ({
    ingest: { ...s.ingest, url: URL },
    urlSource: {
      linkKey: LINK_KEY,
      url: parseLink(URL)!.url,
      meta: null,
      fetchedAt: null,
      transcript,
      tracks: transcript ? [{ key: 'en-orig', kind: 'asr' }] : [],
      language: 'en',
      status,
      error: status === 'failed' ? 'offline' : null,
      run: null,
      anchorRow: null,
      clipped: false
    }
  }))
}

function withResult(result: BestClipsResult, targetMs = 60_000, transcript: Transcript = T): void {
  useEditor.setState((s) => ({ bestClips: { ...s.bestClips, targetMs, last: { linkKey: LINK_KEY, targetMs, transcript, result } } }))
}

/** No AI helper on this machine, and one that can transcribe (ingestPanel.test.tsx's shapes). */
const NO_HELPER: SidecarStatus = {
  state: 'absent',
  offer: { supported: true, kind: 'install', bytes: 213_456_789, bytesOnDisk: 731_234_567, hosts: ['files.pythonhosted.org', 'github.com'] }
}
const HELPER: SidecarStatus = {
  state: 'ready',
  source: { kind: 'env', python: 'C:\\Python312\\python.exe' },
  hello: { protocolVersion: 1, python: '3.12.10', platform: 'Windows-AMD64', capabilities: [SIDECAR_METHODS.transcribe], degraded: {}, executable: 'python.exe', prefix: '.', path: [] }
}

interface Host {
  type: string
  props: Record<string, unknown>
}

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
  if (typeof type === 'function') {
    if ((type as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent) return out
    return hosts((type as (p: unknown) => ReactNode)(props), out)
  }
  const inner = (type as { type?: unknown } | null)?.type
  if (typeof inner === 'function') return hosts((inner as (p: unknown) => ReactNode)(props), out)
  if (typeof type === 'object' && type !== null) return out
  return hosts(props.children, out)
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((n) => textOf(n as ReactNode)).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

/** The URL tile's part. */
const shown = (): Host[] => hosts(createElement(BestClips))
const markup = (): string => renderToStaticMarkup(createElement(BestClips))
const buttonNamed = (label: string): Host | undefined => shown().find((h) => h.type === 'button' && textOf(h.props.children as ReactNode).trim() === label)
const withAttr = (name: string): Host[] => shown().filter((h) => h.props[name] !== undefined)
/** The fold-out's Clips tab. */
const tab = (): Host[] => hosts(createElement(BestClipsCards))
const tabMarkup = (): string => renderToStaticMarkup(createElement(BestClipsCards))
const inTab = (name: string): Host[] => tab().filter((h) => h.props[name] !== undefined)
/** A choice's or Escape's handler reads its event for the focus; none is in the page here. */
const NO_EVENT = { currentTarget: null }
/** The length list's own button, and its choices once open. */
const lengthButton = (): Host => {
  const found = shown().filter((h) => h.type === 'button' && h.props['aria-expanded'] !== undefined && h.props['aria-controls'] === 'fold-down-best-length')
  expect(found).toHaveLength(1)
  return found[0]
}
const openLengths = (): void => (lengthButton().props.onClick as () => void)()
/** Everything the URL tile's part must never draw: a card, the cards' list, a note, the running line. */
const LONG_THINGS = ['data-best-card', 'data-best-cards', 'data-best-note', 'data-best-model-note', 'data-best-running', 'data-card-title', 'data-best-clip-it']

beforeEach(() => {
  vi.stubGlobal('window', { forge: {} })
  useEditor.setState(useEditor.getInitialState())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Best clips section', () => {
  it('is not there without a link in the box', () => {
    expect(markup()).toBe('')
  })

  it('shows its heading, the four lengths as one fold-down list with 1 min picked, and Analyse ready over the link’s words', () => {
    onLink(T)
    const heading = shown().find((h) => h.type === 'h3')
    expect(heading && textOf(heading.props.children as ReactNode).trim()).toBe('Best clips')
    // Folded: one button saying what it chooses and what is chosen, and no choice drawn.
    expect(textOf(lengthButton().props.children as ReactNode)).toBe(`${BEST_CLIPS_DURATION}1 min`)
    expect(lengthButton().props['aria-expanded']).toBe(false)
    expect(withAttr('data-best-length')).toHaveLength(0)
    openLengths()
    expect(lengthButton().props['aria-expanded']).toBe(true)
    const lengths = withAttr('data-best-length')
    expect(lengths.map((h) => textOf(h.props.children as ReactNode))).toEqual(['1 min', '2 min', '3 min', '4 min'])
    expect(lengths.map((h) => h.props['data-best-length'])).toEqual(['60000', '120000', '180000', '240000'])
    expect(lengths.map((h) => h.props['aria-pressed'])).toEqual([true, false, false, false])
    const analyse = buttonNamed('Analyse')!
    expect(analyse.props.disabled).toBe(false)
    expect(markup()).not.toContain(BEST_CLIPS_NEEDS_TRANSCRIPT)
  })

  it('picks a length when one is pressed: the same store value the four buttons set, and the list folds saying it', () => {
    onLink(T)
    openLengths()
    ;(buttonNamed('3 min')!.props.onClick as (e: unknown) => void)(NO_EVENT)
    expect(useEditor.getState().bestClips.targetMs).toBe(180_000)
    expect(useEditor.getState().foldDownOpen).toBe(null)
    expect(withAttr('data-best-length')).toHaveLength(0)
    expect(textOf(lengthButton().props.children as ReactNode)).toBe(`${BEST_CLIPS_DURATION}3 min`)
    openLengths()
    expect(withAttr('data-best-length').map((h) => h.props['aria-pressed'])).toEqual([false, false, true, false])
  })

  it('sits in the URL tile’s panel, after the link’s transcript', () => {
    onLink(T)
    const panel = renderToStaticMarkup(createElement(IngestPanel))
    const at = panel.indexOf('data-best-clips')
    expect([...panel.matchAll(/data-best-clips=/g)]).toHaveLength(1)
    // The link's transcript in the tile is Get transcript and its toggle since the clip maker's
    // layout; its rows are the panel's beside the picture (ingestPanel.test.tsx holds that).
    expect([...panel.matchAll(/>Get transcript</g)]).toHaveLength(1)
    expect(at).toBeGreaterThan(panel.indexOf('>Get transcript<'))
    expect(at).toBeGreaterThan(panel.indexOf('data-link-transcript-toggle'))
    expect(panel.indexOf('data-link-transcript-toggle')).toBeGreaterThan(-1)
  })

  it('points at Get transcript, with Analyse greyed, before there are words', () => {
    onLink(null, 'failed')
    expect(markup()).toContain(BEST_CLIPS_NEEDS_TRANSCRIPT)
    expect(buttonNamed('Analyse')!.props.disabled).toBe(true)
  })

  it('on a video with no captions says Best clips cannot listen yet, with the AI helper or without it: it never sends the user to install the helper for it', () => {
    onLink(null, 'none')
    for (const helperStatus of [NO_HELPER, HELPER, null]) {
      useEditor.setState({ helperStatus })
      const pointer = withAttr('data-best-pointer').map((h) => textOf(h.props.children as ReactNode))
      expect(pointer, JSON.stringify(helperStatus?.state ?? null)).toEqual([BEST_CLIPS_CANNOT_LISTEN])
      // Nothing on the section names the helper as what Best clips needs (Listen to it is not built).
      expect(markup()).not.toMatch(/needs the AI helper/u)
      expect(buttonNamed('Analyse')!.props.disabled).toBe(true)
    }
  })

  it('never sends the user to Listen to it while LinkTranscript renders that button greyed for good', () => {
    // LinkTranscript's Listen to it, parsed: a bare `disabled` means it can never be pressed.
    const file = resolve(__dirname, '../../src/renderer/src/components/tools/LinkTranscript.tsx')
    const sf = ts.createSourceFile('LinkTranscript.tsx', readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const listen: ts.JsxElement[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sf) === 'button' && node.children.some((c) => ts.isJsxText(c) && c.text.trim() === 'Listen to it')) listen.push(node)
      ts.forEachChild(node, visit)
    }
    visit(sf)
    expect(listen).toHaveLength(1)
    const disabled = listen[0].openingElement.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === 'disabled')
    const greyedForGood = disabled !== undefined && ts.isJsxAttribute(disabled) && disabled.initializer === undefined
    onLink(null, 'none')
    for (const helperStatus of [HELPER, null]) {
      useEditor.setState({ helperStatus })
      const pointer = withAttr('data-best-pointer').map((h) => textOf(h.props.children as ReactNode))
      expect(pointer).toHaveLength(1)
      if (greyedForGood) expect(pointer[0]).not.toContain('Listen to it')
    }
    // Today it is greyed for good, so the check above is not vacuous.
    expect(greyedForGood).toBe(true)
  })

  it('shows a running state while Analyse runs (in the Clips tab), with Analyse and the length list greyed, and the list folded', () => {
    onLink(T)
    // The list left open when Analyse was pressed: it folds, so no length can be picked mid-run.
    useEditor.getState().setFoldDownOpen('best-length')
    useEditor.setState((s) => ({ bestClips: { ...s.bestClips, running: { linkKey: LINK_KEY, targetMs: 60_000, transcript: T } } }))
    expect(tabMarkup()).toContain(BEST_CLIPS_RUNNING)
    expect(tabMarkup()).not.toContain(BEST_CLIPS_RUNNING_ELSEWHERE)
    expect(inTab('data-best-running').map((h) => h.props['data-best-running'])).toEqual(['here'])
    expect(buttonNamed('Analyse')!.props.disabled).toBe(true)
    expect(lengthButton().props.disabled).toBe(true)
    expect(lengthButton().props['aria-expanded']).toBe(false)
    expect(withAttr('data-best-length')).toHaveLength(0)
    // Pressed anyway, the greyed button opens nothing either.
    useEditor.getState().setFoldDownOpen(null)
    openLengths()
    expect(withAttr('data-best-length')).toHaveLength(0)
  })

  it('says a run is another video’s when it is not this link’s or these captions’, and still points at Get transcript', () => {
    onLink(T)
    useEditor.setState((s) => ({ bestClips: { ...s.bestClips, running: { linkKey: 'yt-another', targetMs: 60_000, transcript: T } } }))
    expect(tabMarkup()).toContain(BEST_CLIPS_RUNNING_ELSEWHERE)
    expect(tabMarkup()).not.toContain(BEST_CLIPS_RUNNING)
    expect(buttonNamed('Analyse')!.props.disabled).toBe(true)
    // The tile says why Analyse is greyed, whether the panel is open or not: the pointer, never the running line.
    expect(withAttr('data-best-pointer').map((h) => textOf(h.props.children as ReactNode))).toEqual([BEST_CLIPS_RUNNING_ELSEWHERE])
    // The same link, captions fetched again since: also not this panel's run.
    useEditor.setState((s) => ({ bestClips: { ...s.bestClips, running: { linkKey: LINK_KEY, targetMs: 60_000, transcript: madeUpTalk(60, 51) } } }))
    expect(tabMarkup()).toContain(BEST_CLIPS_RUNNING_ELSEWHERE)
    expect(withAttr('data-best-pointer').map((h) => textOf(h.props.children as ReactNode))).toEqual([BEST_CLIPS_RUNNING_ELSEWHERE])
    // No words on this link: the pointer still shows while another link's run goes on.
    onLink(null, 'failed')
    expect(markup()).toContain(BEST_CLIPS_NEEDS_TRANSCRIPT)
    // This link's own run: the spinner on Analyse and the tab's line, no pointer.
    onLink(T)
    useEditor.setState((s) => ({ bestClips: { ...s.bestClips, running: { linkKey: LINK_KEY, targetMs: 60_000, transcript: T } } }))
    expect(withAttr('data-best-pointer')).toHaveLength(0)
  })

  it('draws no card, no note and no running line in the URL tile, in any state', async () => {
    const result = await bestClips(T, null, 60_000)
    const states: [string, () => void][] = [
      ['no link', () => undefined],
      ['a link with no words', () => onLink(null, 'failed')],
      ['no captions', () => onLink(null, 'none')],
      ['words', () => onLink(T)],
      ['running here', () => {
        onLink(T)
        useEditor.setState((s) => ({ bestClips: { ...s.bestClips, running: { linkKey: LINK_KEY, targetMs: 60_000, transcript: T } } }))
      }],
      ['running elsewhere', () => {
        onLink(T)
        useEditor.setState((s) => ({ bestClips: { ...s.bestClips, running: { linkKey: 'yt-another', targetMs: 60_000, transcript: T } } }))
      }],
      ['a result', () => {
        onLink(T)
        withResult({ ...result, note: 'A plain made-up shortfall.' })
      }]
    ]
    for (const [name, put] of states) {
      useEditor.setState(useEditor.getInitialState())
      put()
      for (const attr of LONG_THINGS) expect(withAttr(attr), `${name}: ${attr}`).toHaveLength(0)
      const html = markup()
      // Running elsewhere, the tile's pointer says so (a greyed Analyse says why); the running line itself stays the tab's (data-best-running, above).
      const elsewhere = name === 'running elsewhere'
      for (const words of [BEST_CLIPS_RUNNING, ...(elsewhere ? [] : [BEST_CLIPS_RUNNING_ELSEWHERE]), NO_MODEL_NOTE, 'A plain made-up shortfall.', `${CLIP_IT_CARD}</button>`, ...result.cards.map((c) => c.why)]) {
        expect(html, `${name}: ${words}`).not.toContain(words)
      }
      if (elsewhere) expect([...html.matchAll(new RegExp(BEST_CLIPS_RUNNING_ELSEWHERE.replace('.', '\\.'), 'g'))], name).toHaveLength(1)
    }
    // The last state is not vacuous: the tab draws them (Make it vertical's tooltip says "Clip it" too, so the button's own text is looked for).
    expect(inTab('data-best-card')).toHaveLength(result.cards.length)
    expect(tabMarkup()).toContain(`${CLIP_IT_CARD}</button>`)
    expect(inTab('data-best-note')).toHaveLength(1)
  })

  it('offers Make it vertical before any result, on the same store value Clip it reads', () => {
    for (const status of ['failed', 'ready'] as const) {
      useEditor.setState(useEditor.getInitialState())
      onLink(status === 'ready' ? T : null, status)
      const vertical = buttonNamed(MAKE_IT_VERTICAL)
      expect(vertical?.props['aria-pressed'], status).toBe(true)
      expect(withAttr('data-best-vertical'), status).toHaveLength(1)
      ;(vertical!.props.onClick as () => void)()
      expect(useEditor.getState().bestClipsVertical, status).toBe(false)
      expect(buttonNamed(MAKE_IT_VERTICAL)?.props['aria-pressed'], status).toBe(false)
    }
    // Before Analyse in the tile's order: the switch, then Analyse.
    const order = shown().filter((h) => h.props['data-best-vertical'] !== undefined || h.props['data-best-analyse'] !== undefined)
    expect(order.map((h) => (h.props['data-best-vertical'] !== undefined ? 'vertical' : 'analyse'))).toEqual(['vertical', 'analyse'])
    // Clip it plans from that same value: both of the store's plans read it.
    const store = readFileSync(resolve(__dirname, '../../src/renderer/src/store.ts'), 'utf8')
    expect([...store.matchAll(/cardClipPlan\(get\(\)\.project, get\(\)\.bestClipsVertical,/g)]).toHaveLength(2)
    expect([...store.matchAll(/cardClipPlan\(/g)]).toHaveLength(2)
  })

  it('opens the panel on Clips when Analyse is pressed, and still runs the store’s Analyse once', () => {
    onLink(T)
    const analyse = vi.fn(async () => undefined)
    useEditor.setState({ analyseBestClips: analyse })
    for (const from of [null, 'transcript'] as const) {
      useEditor.setState({ foldout: FOLDOUT_START })
      if (from) useEditor.getState().openFoldout(from)
      analyse.mockClear()
      ;(buttonNamed('Analyse')!.props.onClick as () => void)()
      expect(useEditor.getState().foldout, String(from)).toMatchObject({ open: true, tab: 'clips' })
      expect(analyse, String(from)).toHaveBeenCalledTimes(1)
    }
  })

  it('folds the length list for good when Analyse is pressed: it does not unfold again when the run ends', () => {
    onLink(T)
    useEditor.setState({ analyseBestClips: vi.fn(async () => undefined) })
    openLengths()
    expect(withAttr('data-best-length')).toHaveLength(4)
    ;(buttonNamed('Analyse')!.props.onClick as () => void)()
    // The run ends (the stub never set it running): the list stays folded.
    useEditor.setState((s) => ({ bestClips: { ...s.bestClips, running: null } }))
    expect(useEditor.getState().foldDownOpen).toBe(null)
    expect(withAttr('data-best-length')).toHaveLength(0)
    expect(lengthButton().props['aria-expanded']).toBe(false)
    // Another fold-down's open state is not Analyse's to fold.
    useEditor.getState().setFoldDownOpen('another-list')
    ;(buttonNamed('Analyse')!.props.onClick as () => void)()
    expect(useEditor.getState().foldDownOpen).toBe('another-list')
  })

  it('has a Clips toggle that opens and closes the panel on Clips, pressed while it shows, saying how many were found', async () => {
    onLink(T)
    const toggle = (): Host => {
      const found = withAttr('data-best-toggle')
      expect(found).toHaveLength(1)
      return found[0]
    }
    const press = (): void => (toggle().props.onClick as () => void)()
    expect(textOf(toggle().props.children as ReactNode)).toBe(CLIPS_TOGGLE)
    expect(toggle().props['aria-pressed']).toBe(false)
    press()
    expect(useEditor.getState().foldout).toMatchObject({ open: true, tab: 'clips' })
    expect(toggle().props['aria-pressed']).toBe(true)
    press()
    expect(useEditor.getState().foldout.open).toBe(false)
    expect(toggle().props['aria-pressed']).toBe(false)
    // Open on the other tab it is not pressed, and pressing it turns the panel to Clips.
    useEditor.getState().openFoldout('transcript')
    expect(toggle().props['aria-pressed']).toBe(false)
    press()
    expect(useEditor.getState().foldout).toMatchObject({ open: true, tab: 'clips' })
    // The count: the cards found for this link and length, and nothing when there are none.
    expect(withAttr('data-best-count')).toHaveLength(0)
    const result = await bestClips(T, null, 60_000)
    withResult(result)
    expect(withAttr('data-best-count').map((h) => textOf(h.props.children as ReactNode))).toEqual([String(result.cards.length)])
    expect(textOf(toggle().props.children as ReactNode)).toBe(`${CLIPS_TOGGLE}${result.cards.length}`)
    withResult(fakeResult([], 'A plain made-up shortfall.'))
    expect(withAttr('data-best-count')).toHaveLength(0)
    withResult(result)
    useEditor.setState((s) => ({ bestClips: { ...s.bestClips, targetMs: 120_000 } }))
    expect(withAttr('data-best-count')).toHaveLength(0)
  })
})

describe('the Clips tab with nothing to show', () => {
  const line = (): string[] => inTab('data-best-empty').map((h) => textOf(h.props.children as ReactNode))

  it('says what to press, in one line, for each state before a result', () => {
    expect(line()).toEqual([FOLDOUT_CLIPS_NO_LINK])
    onLink(null, 'failed')
    expect(line()).toEqual([FOLDOUT_CLIPS_NO_WORDS])
    onLink(null, 'none')
    expect(line()).toEqual([BEST_CLIPS_CANNOT_LISTEN])
    onLink(T)
    expect(line()).toEqual([FOLDOUT_CLIPS_EMPTY])
    for (const html of [tabMarkup()]) expect(html).not.toContain('data-best-card')
  })

  it('says nothing of the kind while a run goes on, or once there is a result', async () => {
    onLink(T)
    useEditor.setState((s) => ({ bestClips: { ...s.bestClips, running: { linkKey: LINK_KEY, targetMs: 60_000, transcript: T } } }))
    expect(line()).toEqual([])
    useEditor.setState((s) => ({ bestClips: { ...s.bestClips, running: { linkKey: 'yt-another', targetMs: 60_000, transcript: T } } }))
    expect(line()).toEqual([])
    useEditor.setState((s) => ({ bestClips: { ...s.bestClips, running: null } }))
    withResult(await bestClips(T, null, 60_000))
    expect(line()).toEqual([])
    // Analysed and nothing found: the result's own note, not these lines.
    withResult(fakeResult([], 'A plain made-up shortfall.'))
    expect(line()).toEqual([])
    expect(inTab('data-best-note').map((h) => textOf(h.props.children as ReactNode))).toEqual(['A plain made-up shortfall.'])
  })
})

describe('the cards', () => {
  it('show each card’s title, why, range, words and who picked it, and the no-model note under them', async () => {
    onLink(T)
    const result = await bestClips(T, null, 60_000)
    expect(result.cards).toHaveLength(3)
    withResult(result)
    const cards = inTab('data-best-card')
    expect(cards.map((h) => h.props['data-best-card'])).toEqual(result.cards.map((c) => c.windowId))
    const html = tabMarkup()
    for (const card of result.cards) {
      expect(html).toContain(card.title.replace(/&/g, '&amp;'))
      expect(html).toContain(card.why)
      expect(html).toContain(cardRange(card))
      expect(html).toContain(cardWords(card))
    }
    expect(inTab('data-card-by').map((h) => textOf(h.props.children as ReactNode))).toEqual([SCORED_BY_LABEL.signals, SCORED_BY_LABEL.signals, SCORED_BY_LABEL.signals])
    expect(inTab('data-best-model-note').map((h) => textOf(h.props.children as ReactNode))).toEqual([NO_MODEL_NOTE])
  })

  it('show "Picked by the model" for a model’s card, and the card’s own note', () => {
    onLink(T)
    const card: BestClipCard = { windowId: 'w3', startMs: 61_000, endMs: 121_500, words: 150, title: 'zor plim', why: 'It is clear.', scoredBy: 'model', note: 'A plain made-up note.' }
    withResult(fakeResult([card]))
    expect(inTab('data-card-by').map((h) => textOf(h.props.children as ReactNode))).toEqual([SCORED_BY_LABEL.model])
    expect(inTab('data-card-range').map((h) => textOf(h.props.children as ReactNode))).toEqual(['1:01.0 – 2:01.5'])
    expect(inTab('data-card-note').map((h) => textOf(h.props.children as ReactNode))).toEqual(['A plain made-up note.'])
  })

  it('show the result’s note alone when there are no cards', () => {
    onLink(T)
    withResult(fakeResult([], 'A plain made-up shortfall.'))
    expect(inTab('data-best-card')).toHaveLength(0)
    expect(inTab('data-best-cards')).toHaveLength(0)
    expect(inTab('data-best-note').map((h) => textOf(h.props.children as ReactNode))).toEqual(['A plain made-up shortfall.'])
  })

  it('are not shown for another length than the one picked', async () => {
    onLink(T)
    withResult(await bestClips(T, null, 60_000))
    expect(inTab('data-best-card')).toHaveLength(3)
    useEditor.setState((s) => ({ bestClips: { ...s.bestClips, targetMs: 120_000 } }))
    expect(inTab('data-best-card')).toHaveLength(0)
  })

  it('never show a result’s problems or askNotes, whatever they hold', () => {
    onLink(T)
    const card: BestClipCard = { windowId: 'w1', startMs: 0, endMs: 60_000, words: 140, title: 'zor', why: 'It is.', scoredBy: 'model' }
    withResult({
      ...fakeResult([card]),
      problems: [{ path: '$.picks[0]', message: 'PROBLEM-SENTINEL http://10.0.0.1:1234 sk-sentinel' }],
      askNotes: ['ASKNOTE-SENTINEL the first answer was not JSON']
    })
    const html = tabMarkup()
    expect(html).toContain('zor')
    expect(html).not.toContain('PROBLEM-SENTINEL')
    expect(html).not.toContain('ASKNOTE-SENTINEL')
    expect(html).not.toContain('sk-sentinel')
  })

  it('wrap a title in any script whole: never cut, clamped or truncated', () => {
    onLink(T)
    // 60 made-up graphemes (Georgian Mkhedruli code points, written lower-case here), and a run with combining marks.
    const caseless = Array.from({ length: 60 }, (_, i) => String.fromCharCode(0x10d0 + ((i * 7) % 33))).join('')
    const marked = Array.from({ length: 20 }, (_, i) => String.fromCharCode(0x61 + (i % 26)) + '\u0301').join('')
    const title = `${caseless} ${marked}`
    // A why of 120 caseless graphemes with no space: it wraps too, in the grid a why that did not would run past its card.
    const why = Array.from({ length: 120 }, (_, i) => String.fromCharCode(0x10d0 + ((i * 5) % 33))).join('')
    const card: BestClipCard = { windowId: 'w2', startMs: 0, endMs: 60_000, words: 140, title, why, scoredBy: 'model' }
    withResult(fakeResult([card]))
    const whyHost = inTab('data-card-why')[0]
    expect(textOf(whyHost.props.children as ReactNode)).toBe(why)
    const whyCls = String(whyHost.props.className)
    expect(whyCls).toContain('[overflow-wrap:anywhere]')
    expect(whyCls).toContain('whitespace-normal')
    expect(whyCls).not.toMatch(/truncate|line-clamp|text-ellipsis|whitespace-nowrap|overflow-hidden/)
    const titleHost = inTab('data-card-title')[0]
    expect(textOf(titleHost.props.children as ReactNode)).toBe(title)
    const cls = String(titleHost.props.className)
    expect(cls).toContain('[overflow-wrap:anywhere]')
    expect(cls).toContain('whitespace-normal')
    expect(cls).not.toMatch(/truncate|line-clamp|text-ellipsis|whitespace-nowrap|overflow-hidden/)
    expect(tabMarkup()).toContain(title)
  })

  it('sit one to a row in a narrow panel and more in a wide one: a grid that fills, each card at least 15rem or the panel’s width', async () => {
    onLink(T)
    withResult(await bestClips(T, null, 60_000))
    const list = inTab('data-best-cards')
    expect(list).toHaveLength(1)
    const cls = String(list[0].props.className).split(/\s+/)
    expect(cls).toContain('grid')
    expect(cls).toContain('[grid-template-columns:repeat(auto-fill,minmax(min(15rem,100%),1fr))]')
    // A card's text column may shrink and wrap, never run out of the card.
    // The text column is the card's second child, and it carries min-w-0: a flex item's floor is otherwise its longest word.
    const cards = tab().filter((h) => h.props['data-best-card'] !== undefined)
    expect(cards).toHaveLength(3)
    for (const card of cards) {
      expect(String(card.props.className).split(/\s+/)).toContain('flex')
      const kids = (Array.isArray(card.props.children) ? card.props.children : [card.props.children]).filter((k: unknown) => isValidElement(k)) as { props: { className?: string } }[]
      expect(kids).toHaveLength(2)
      expect(String(kids[1].props.className).split(/\s+/)).toContain('min-w-0')
    }
  })
})

/** A result with these cards, as `bestClips` shapes it. */
function fakeResult(cards: BestClipCard[], note: string | null = null): BestClipsResult {
  return {
    targetMs: 60_000,
    cards,
    note,
    modelNote: null,
    model: null,
    askNotes: [],
    problems: [],
    fallback: null,
    candidates: { targetMs: 60_000, windows: [], candidates: [], note }
  }
}

describe('Clip it on a card (§7.5 steps 0 to 5)', () => {
  const A: BestClipCard = { windowId: 'w1', startMs: 0, endMs: 60_000, words: 150, title: 'zor plim', why: 'It is clear.', scoredBy: 'signals' }
  const B: BestClipCard = { ...A, windowId: 'w5', startMs: 70_000, endMs: 131_000 }
  const C: BestClipCard = { ...A, windowId: 'w9', startMs: 140_000, endMs: 199_000 }
  const footOf = (windowId: string): Host[] => {
    const all = tab()
    const at = all.findIndex((h) => h.props['data-best-clip-it'] === windowId)
    expect(at, windowId).toBeGreaterThan(-1)
    return hosts(all[at].props.children as ReactNode)
  }
  const buttonsIn = (list: Host[]): string[] => list.filter((h) => h.type === 'button').map((h) => textOf(h.props.children as ReactNode).trim())
  const textsIn = (list: Host[]): string[] => list.filter((h) => typeof h.props.children === 'string').map((h) => h.props.children as string)

  beforeEach(() => {
    onLink(T)
    withResult(fakeResult([A, B, C]))
  })

  it('puts Clip it at the foot of every card, and Make it vertical in the URL tile, on by default', () => {
    for (const card of [A, B, C]) expect(buttonsIn(footOf(card.windowId)), card.windowId).toEqual([CLIP_IT_CARD])
    // The switch is the tile's, never the tab's.
    expect(inTab('data-best-vertical')).toHaveLength(0)
    const vertical = buttonNamed(MAKE_IT_VERTICAL)
    expect(vertical?.props['aria-pressed']).toBe(true)
    ;(vertical!.props.onClick as () => void)()
    expect(useEditor.getState().bestClipsVertical).toBe(false)
    expect(buttonNamed(MAKE_IT_VERTICAL)?.props['aria-pressed']).toBe(false)
  })

  it('asks on the card pressed, in these words, saying what each answer does; the other cards wait', () => {
    useEditor.setState((s) => ({
      dirty: true,
      bestClipsQuestion: { key: cardKey(LINK_KEY, B), card: B, linkKey: LINK_KEY, transcript: T },
      project: { ...s.project, settings: { ...s.project.settings, width: 1920, height: 1080 } }
    }))
    const foot = footOf(B.windowId)
    expect(buttonsIn(foot)).toEqual([`${START_NEW_PROJECT}${START_NEW_SAVES}`, `${ADD_TO_PROJECT}${ADD_KEEPS_SHAPE}`, NOT_NOW])
    expect(textsIn(foot)).toEqual(expect.arrayContaining([QUESTION_HEAD, START_NEW_PROJECT, START_NEW_SAVES, ADD_TO_PROJECT, ADD_KEEPS_SHAPE, NOT_NOW]))
    expect(foot.filter((h) => h.props['data-best-choice'] !== undefined).map((h) => h.props['data-best-choice'])).toEqual(['new', 'add', 'cancel'])
    for (const other of [A, C]) {
      const clipIt = footOf(other.windowId).find((h) => h.type === 'button')
      expect(clipIt?.props.disabled, other.windowId).toBe(true)
    }
  })

  it('greys every card’s Clip it while a download is being asked for', () => {
    for (const card of [A, B, C]) expect(footOf(card.windowId).find((h) => h.type === 'button')?.props.disabled, card.windowId).toBe(false)
    useEditor.setState((s) => ({ ingest: { ...s.ingest, busy: true } }))
    for (const card of [A, B, C]) {
      const clipIt = footOf(card.windowId).filter((h) => h.type === 'button')
      expect(buttonsIn(clipIt), card.windowId).toEqual([CLIP_IT_CARD])
      expect(clipIt[0].props.disabled, card.windowId).toBe(true)
    }
  })

  it('says a saved project stays as it is, and that Add follows faces on a portrait canvas', () => {
    useEditor.setState((s) => ({
      dirty: false,
      projectPath: '/projects/a.forge',
      bestClipsQuestion: { key: cardKey(LINK_KEY, A), card: A, linkKey: LINK_KEY, transcript: T },
      project: { ...s.project, settings: { ...s.project.settings, width: 1080, height: 1920 } }
    }))
    expect(textsIn(footOf(A.windowId))).toEqual(expect.arrayContaining([START_NEW_SAVED, ADD_PORTRAIT]))
    expect(textsIn(footOf(A.windowId))).not.toContain(START_NEW_SAVES)
  })

  it('says a project never saved to a file of its own (recovered from autosave, clean) is saved first', () => {
    useEditor.setState({ dirty: false, projectPath: null, bestClipsQuestion: { key: cardKey(LINK_KEY, A), card: A, linkKey: LINK_KEY, transcript: T } })
    expect(textsIn(footOf(A.windowId))).toContain(START_NEW_SAVES)
    expect(textsIn(footOf(A.windowId))).not.toContain(START_NEW_SAVED)
  })

  it('greys Start new, saying why, while another card’s clip is still downloading into this project', () => {
    const going = newCardRecord(cardKey(LINK_KEY, C), LINK_KEY, C, { reframe: true, shape: 'set', projectId: useEditor.getState().project.id ?? null })
    useEditor.setState({ bestClipsClipped: { [going.key]: going }, bestClipsQuestion: { key: cardKey(LINK_KEY, A), card: A, linkKey: LINK_KEY, transcript: T } })
    const foot = footOf(A.windowId)
    expect(textsIn(foot)).toContain(START_NEW_WAITS)
    expect(foot.find((h) => h.props['data-best-choice'] === 'new')?.props.disabled).toBe(true)
    expect(foot.find((h) => h.props['data-best-choice'] === 'add')?.props.disabled).toBe(false)
  })

  it('a clipped card whose clip is no longer on this timeline (undone) hides what no longer holds and offers Clip it again', () => {
    let record = newCardRecord(cardKey(LINK_KEY, A), LINK_KEY, A, { reframe: true, shape: 'set' })
    record = { ...record, clipId: 'c-gone', steps: record.steps.map((st) => (st.name === 'download' ? { ...st, state: 'done', text: STEP_TEXT.landed } : st)) }
    useEditor.setState({ bestClipsClipped: { [record.key]: record } })
    const foot = footOf(A.windowId)
    expect(buttonsIn(foot)).toEqual([CLIP_IT_CARD])
    expect(textsIn(foot)).not.toContain(STEP_TEXT.landed)
  })

  it('lists what ran and what was skipped on a clipped card, in order, with no Clip it; the others keep theirs', () => {
    let record = newCardRecord(cardKey(LINK_KEY, A), LINK_KEY, A, { reframe: true, shape: 'set' })
    record = { ...record, clipId: 'c1', steps: record.steps.map((st) => (st.name === 'download' ? { ...st, state: 'done', text: STEP_TEXT.landed } : st.name === 'reframe' ? { ...st, state: 'skipped', text: STEP_TEXT.reframeNoHelper } : st)) }
    // The clip it landed is on this timeline (only its id is read here).
    useEditor.setState((s) => ({ bestClipsClipped: { [record.key]: record }, project: { ...s.project, clips: [{ ...(s.project.clips[0] ?? {}), id: 'c1' } as (typeof s.project.clips)[number]] } }))
    const foot = footOf(A.windowId)
    expect(buttonsIn(foot)).toEqual([])
    const steps = foot.filter((h) => h.props['data-card-step'] !== undefined)
    expect(steps.map((h) => [h.props['data-card-step'], h.props['data-step-state']])).toEqual([
      ['download', 'done'],
      ['shape', 'done'],
      ['reframe', 'skipped'],
      ['captions', 'waiting'],
      ['graphics', 'waiting']
    ])
    expect(textsIn(foot)).toEqual(expect.arrayContaining([STEP_LABEL.download, STEP_TEXT.landed, STEP_LABEL.reframe, STEP_TEXT.reframeNoHelper, STEP_TEXT.shapeSet]))
    for (const other of [B, C]) expect(buttonsIn(footOf(other.windowId)), other.windowId).toEqual([CLIP_IT_CARD])
  })

  it('offers Clip it again under a download that did not land', () => {
    const record = notLanded(newCardRecord(cardKey(LINK_KEY, C), LINK_KEY, C, { reframe: true, shape: 'set' }), STEP_TEXT.downloadFailed)
    useEditor.setState({ bestClipsClipped: { [record.key]: record } })
    const foot = footOf(C.windowId)
    expect(buttonsIn(foot)).toEqual([CLIP_IT_CARD])
    expect(textsIn(foot)).toContain(STEP_TEXT.downloadFailed)
  })
})

describe('the source', () => {
  /*
   * The component reads a result's cards, note and modelNote, and nothing
   * else of it: a read of `problems`, `askNotes` or `fallback` anywhere in it
   * — a property, an element access with a string, or a destructured name —
   * fails here. Parsed, so the head comment's mention of them is not a read.
   */
  const file = resolve(__dirname, '../../src/renderer/src/components/tools/BestClips.tsx')
  const text = readFileSync(file, 'utf8')

  function reads(source: string): string[] {
    const sf = ts.createSourceFile('BestClips.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const out: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) out.push(node.name.text)
      else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) out.push(node.argumentExpression.text)
      else if (ts.isBindingElement(node)) out.push((node.propertyName ?? node.name).getText(sf))
      ts.forEachChild(node, visit)
    }
    visit(sf)
    return out
  }

  it('reads cards, note and modelNote of a result, and never problems, askNotes or fallback', () => {
    const names = reads(text)
    expect(names).toContain('cards')
    expect(names).toContain('modelNote')
    for (const banned of ['problems', 'askNotes', 'fallback']) expect(names, banned).not.toContain(banned)
  })

  it('catches such a read, written any of three ways', () => {
    expect(reads('const a = result.problems')).toContain('problems')
    expect(reads("const a = result['askNotes']")).toContain('askNotes')
    expect(reads('const { fallback } = result')).toContain('fallback')
  })
})
