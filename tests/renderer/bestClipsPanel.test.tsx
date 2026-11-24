import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { linkCacheKey, parseLink } from '@shared/ingest/url'
import { bestClips, NO_MODEL_NOTE, type BestClipCard, type BestClipsResult } from '@shared/bestclips/run'
import {
  BEST_CLIPS_LISTEN_FIRST,
  BEST_CLIPS_NEEDS_TRANSCRIPT,
  BEST_CLIPS_NO_CAPTIONS,
  BEST_CLIPS_RUNNING,
  cardRange,
  cardWords,
  SCORED_BY_LABEL
} from '@shared/bestclips/session'
import { SIDECAR_METHODS } from '@shared/sidecar/protocol'
import type { SidecarStatus } from '@shared/sidecar/status'
import { PAUSE_BOUNDARY_MS, segmentIntoSentences, type Transcript, type Word } from '@shared/transcript'
import { CAP_MS, CAP_WORDS } from '@shared/bestclips/windows'

/*
 * Best clips in the URL tile, rendered (docs/CLIPS.md §7.5's first half):
 * the heading, the four lengths as one choice, Analyse, the cards (title,
 * why, range, words, who picked, the card's note), the result's notes, the
 * no-captions line, the pointer to Get transcript — and never a result's
 * `problems` or `askNotes`. Rendered to static markup, the store mocked to a
 * plain selector over the REAL store's state (ingestPanel.test.tsx's way).
 * Every transcript is made up; the caseless title is \u escapes.
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
const { BestClips } = await import('../../src/renderer/src/components/tools/BestClips')
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

const shown = (): Host[] => hosts(createElement(BestClips))
const markup = (): string => renderToStaticMarkup(createElement(BestClips))
const buttonNamed = (label: string): Host | undefined => shown().find((h) => h.type === 'button' && textOf(h.props.children as ReactNode).trim() === label)
const withAttr = (name: string): Host[] => shown().filter((h) => h.props[name] !== undefined)

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

  it('shows its heading, the four lengths as one choice with 1 min picked, and Analyse ready over the link’s words', () => {
    onLink(T)
    const heading = shown().find((h) => h.type === 'h3')
    expect(heading && textOf(heading.props.children as ReactNode).trim()).toBe('Best clips')
    const lengths = withAttr('data-best-length')
    expect(lengths.map((h) => textOf(h.props.children as ReactNode))).toEqual(['1 min', '2 min', '3 min', '4 min'])
    expect(lengths.map((h) => h.props['aria-pressed'])).toEqual([true, false, false, false])
    const analyse = buttonNamed('Analyse')!
    expect(analyse.props.disabled).toBe(false)
    expect(markup()).not.toContain(BEST_CLIPS_NEEDS_TRANSCRIPT)
  })

  it('picks a length when one is pressed', () => {
    onLink(T)
    ;(buttonNamed('3 min')!.props.onClick as () => void)()
    expect(useEditor.getState().bestClips.targetMs).toBe(180_000)
    expect(withAttr('data-best-length').map((h) => h.props['aria-pressed'])).toEqual([false, false, true, false])
  })

  it('sits in the URL tile’s panel, after the link’s transcript', () => {
    onLink(T)
    const panel = renderToStaticMarkup(createElement(IngestPanel))
    const at = panel.indexOf('data-best-clips')
    expect([...panel.matchAll(/data-best-clips=/g)]).toHaveLength(1)
    expect(panel.indexOf('data-transcript-rows')).toBeGreaterThan(-1)
    expect(at).toBeGreaterThan(panel.indexOf('data-transcript-rows'))
  })

  it('points at Get transcript, with Analyse greyed, before there are words', () => {
    onLink(null, 'failed')
    expect(markup()).toContain(BEST_CLIPS_NEEDS_TRANSCRIPT)
    expect(buttonNamed('Analyse')!.props.disabled).toBe(true)
  })

  it('says the AI helper is needed on a video with no captions and no helper, and points at Listen to it when the helper is there', () => {
    onLink(null, 'none')
    useEditor.setState({ helperStatus: NO_HELPER })
    expect(markup()).toContain(BEST_CLIPS_NO_CAPTIONS)
    expect(markup()).not.toContain(BEST_CLIPS_LISTEN_FIRST)
    expect(buttonNamed('Analyse')!.props.disabled).toBe(true)
    useEditor.setState({ helperStatus: HELPER })
    expect(markup()).toContain(BEST_CLIPS_LISTEN_FIRST)
    expect(markup()).not.toContain(BEST_CLIPS_NO_CAPTIONS)
  })

  it('shows a running state while Analyse runs, with Analyse greyed', () => {
    onLink(T)
    useEditor.setState((s) => ({ bestClips: { ...s.bestClips, running: { linkKey: LINK_KEY, targetMs: 60_000, transcript: T } } }))
    expect(markup()).toContain(BEST_CLIPS_RUNNING)
    expect(buttonNamed('Analyse')!.props.disabled).toBe(true)
  })
})

describe('the cards', () => {
  it('show each card’s title, why, range, words and who picked it, and the no-model note under them', async () => {
    onLink(T)
    const result = await bestClips(T, null, 60_000)
    expect(result.cards).toHaveLength(3)
    withResult(result)
    const cards = withAttr('data-best-card')
    expect(cards.map((h) => h.props['data-best-card'])).toEqual(result.cards.map((c) => c.windowId))
    const html = markup()
    for (const card of result.cards) {
      expect(html).toContain(card.title.replace(/&/g, '&amp;'))
      expect(html).toContain(card.why)
      expect(html).toContain(cardRange(card))
      expect(html).toContain(cardWords(card))
    }
    expect(withAttr('data-card-by').map((h) => textOf(h.props.children as ReactNode))).toEqual([SCORED_BY_LABEL.signals, SCORED_BY_LABEL.signals, SCORED_BY_LABEL.signals])
    expect(withAttr('data-best-model-note').map((h) => textOf(h.props.children as ReactNode))).toEqual([NO_MODEL_NOTE])
  })

  it('show "Picked by the model" for a model’s card, and the card’s own note', () => {
    onLink(T)
    const card: BestClipCard = { windowId: 'w3', startMs: 61_000, endMs: 121_500, words: 150, title: 'zor plim', why: 'It is clear.', scoredBy: 'model', note: 'A plain made-up note.' }
    withResult(fakeResult([card]))
    expect(withAttr('data-card-by').map((h) => textOf(h.props.children as ReactNode))).toEqual([SCORED_BY_LABEL.model])
    expect(withAttr('data-card-range').map((h) => textOf(h.props.children as ReactNode))).toEqual(['1:01.0 – 2:01.5'])
    expect(withAttr('data-card-note').map((h) => textOf(h.props.children as ReactNode))).toEqual(['A plain made-up note.'])
  })

  it('show the result’s note alone when there are no cards', () => {
    onLink(T)
    withResult(fakeResult([], 'A plain made-up shortfall.'))
    expect(withAttr('data-best-card')).toHaveLength(0)
    expect(withAttr('data-best-cards')).toHaveLength(0)
    expect(withAttr('data-best-note').map((h) => textOf(h.props.children as ReactNode))).toEqual(['A plain made-up shortfall.'])
  })

  it('are not shown for another length than the one picked', async () => {
    onLink(T)
    withResult(await bestClips(T, null, 60_000))
    useEditor.setState((s) => ({ bestClips: { ...s.bestClips, targetMs: 120_000 } }))
    expect(withAttr('data-best-card')).toHaveLength(0)
  })

  it('never show a result’s problems or askNotes, whatever they hold', () => {
    onLink(T)
    const card: BestClipCard = { windowId: 'w1', startMs: 0, endMs: 60_000, words: 140, title: 'zor', why: 'It is.', scoredBy: 'model' }
    withResult({
      ...fakeResult([card]),
      problems: [{ path: '$.picks[0]', message: 'PROBLEM-SENTINEL http://10.0.0.1:1234 sk-sentinel' }],
      askNotes: ['ASKNOTE-SENTINEL the first answer was not JSON']
    })
    const html = markup()
    expect(html).toContain('zor')
    expect(html).not.toContain('PROBLEM-SENTINEL')
    expect(html).not.toContain('ASKNOTE-SENTINEL')
    expect(html).not.toContain('sk-sentinel')
  })

  it('wrap a title in any script whole: never cut, clamped or truncated', () => {
    onLink(T)
    // 60 made-up caseless graphemes (Georgian Mkhedruli code points), and a run with combining marks.
    const caseless = Array.from({ length: 60 }, (_, i) => String.fromCharCode(0x10d0 + ((i * 7) % 33))).join('')
    const marked = Array.from({ length: 20 }, (_, i) => String.fromCharCode(0x61 + (i % 26)) + '́').join('')
    const title = `${caseless} ${marked}`
    const card: BestClipCard = { windowId: 'w2', startMs: 0, endMs: 60_000, words: 140, title, why: 'It is.', scoredBy: 'model' }
    withResult(fakeResult([card]))
    const titleHost = withAttr('data-card-title')[0]
    expect(textOf(titleHost.props.children as ReactNode)).toBe(title)
    const cls = String(titleHost.props.className)
    expect(cls).toContain('[overflow-wrap:anywhere]')
    expect(cls).toContain('whitespace-normal')
    expect(cls).not.toMatch(/truncate|line-clamp|text-ellipsis|whitespace-nowrap|overflow-hidden/)
    expect(markup()).toContain(title)
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
