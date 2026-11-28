import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { emptyProject, type Clip, type MediaAsset } from '@shared/timeline'
import { linkCacheKey, parseLink } from '@shared/ingest/url'
import { FOLDOUT_START } from '@shared/foldout'
import type { Transcript } from '@shared/transcript'
import type { LinkMeta } from '@shared/ingest/args'

/*
 * The fold-out panel's Transcript tab (the clip maker's layout, piece 3; the
 * user's sketch of 2026-11-27: "a toggle like the clips and it unfoldes on the
 * right … so that when the trim creat wont ever collide").
 *
 * - The URL tile keeps Get transcript, its status lines, the languages and the
 *   no-captions block, and — once the words are ready — a Transcript toggle;
 *   no row, chip, run line or Clip download of the link's is drawn there.
 * - The tab shows the link's words (tools/LinkTranscript.tsx `LinkWords`) or
 *   the selected clip's whole transcript (`TranscriptPanel`: Edit, Cut to
 *   these words, Find graphics, Listen for), by shared/foldout.ts's rule, with
 *   a two-way switch at its top only while both are there.
 * - The panel opens on the link's words when Get transcript's words arrive,
 *   and on the clip's when the Transcript tile opens (the Shelf's press,
 *   tests/renderer/shelfRender.test.ts).
 * - The Transcript tile is one line and a toggle; closing the panel leaves the
 *   tile open and the toggle un-pressed.
 * - Every toggle decides on the words the tab SHOWS (piece 1's critics, (b)).
 *
 * The store mocked to a plain selector over the REAL store's state, as the
 * neighbours do, so each part is called as a function and every press runs
 * the real action. Every word in these transcripts is made up.
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
const F = await import('../../src/renderer/src/components/Foldout')
const { Foldout, FoldoutTranscript, FoldoutTranscriptFace, WordsSwitch } = F
const LT = await import('../../src/renderer/src/components/tools/LinkTranscript')
const { LinkWords } = LT
/**
 * The link's transcript in the URL tile: since piece 4 of the clip maker's layout, three parts the tile
 * places apart (Get transcript in a row with Analyse, the status lines under it, the toggle beside Clips).
 * Walked together, so every assertion that read the tile's half still reads all of it.
 */
const LinkTranscript = (): ReactNode =>
  createElement(Fragment, null, createElement(LT.GetTranscriptButton), createElement(LT.LinkTranscriptStatus), createElement(LT.LinkTranscriptToggle))
const TP = await import('../../src/renderer/src/components/TranscriptPanel')
const { TranscriptPanel, TranscriptTile } = TP
const { ErrorBoundary } = await import('../../src/renderer/src/components/ErrorBoundary')
const { STEP_TEXT, graphicsResultText } = await import('@shared/bestclips/cardClip')

const URL = 'https://www.youtube.com/watch?v=MadeUpFold3'
const NO_CAPTIONS = 'https://www.youtube.com/watch?v=MadeUpFold4'

const video: MediaAsset = {
  id: 'talk', path: '/v/talk.mp4', name: 'talk.mp4', kind: 'video', durationFrames: 300,
  width: 1280, height: 720, fps: 30, hasVideo: true, hasAudio: true, size: 10
}
const clip: Clip = {
  id: 'v', assetId: 'talk', trackId: 'v1', start: 0, duration: 300, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  color: { brightness: 0, contrast: 1, saturation: 1 }
}
/** Two made-up sentences, the clip's. */
const CLIP_WORDS: Transcript = {
  assetId: 'talk', language: 'en', model: 'test', durationMs: 4000,
  words: [
    { index: 0, text: 'Velmora', startMs: 0, endMs: 400, confidence: 0.9 },
    { index: 1, text: 'tasked.', startMs: 400, endMs: 900, confidence: 0.9 },
    { index: 2, text: 'Quindle', startMs: 2000, endMs: 2400, confidence: 0.9 },
    { index: 3, text: 'brosk.', startMs: 2400, endMs: 2900, confidence: 0.9 }
  ],
  segments: [
    { id: 's0', startMs: 0, endMs: 900, text: 'Velmora tasked.', wordStart: 0, wordEnd: 1 },
    { id: 's1', startMs: 2000, endMs: 2900, text: 'Quindle brosk.', wordStart: 2, wordEnd: 3 }
  ]
}
/** The link's: one made-up word in another script, and two Latin ones. */
const LINK_WORDS: Transcript = {
  assetId: 'url:fold', language: 'en', model: 'test', durationMs: 3000,
  words: [
    { index: 0, text: 'Жорплим', startMs: 0, endMs: 400, confidence: null },
    { index: 1, text: 'zevra.', startMs: 400, endMs: 900, confidence: null },
    { index: 2, text: 'Tolvek.', startMs: 1500, endMs: 2000, confidence: null }
  ],
  segments: [
    { id: 's0', startMs: 0, endMs: 900, text: 'Жорплим zevra.', wordStart: 0, wordEnd: 1 },
    { id: 's1', startMs: 1500, endMs: 2000, text: 'Tolvek.', wordStart: 2, wordEnd: 2 }
  ]
}

const state = () => useEditor.getState()

function linkWords(ready: boolean): void {
  useEditor.setState((s) => ({
    ingest: { ...s.ingest, url: URL },
    urlSource: ready
      ? {
          linkKey: linkCacheKey(parseLink(URL)!), url: parseLink(URL)!.url, meta: null, fetchedAt: null,
          transcript: LINK_WORDS, tracks: [{ key: 'en-orig', kind: 'asr' }], language: 'en', status: 'ready',
          error: null, run: null, anchorRow: null, clipped: false
        }
      : null
  }))
}
const selectClip = (on: boolean): void => useEditor.setState({ selectedClipId: on ? 'v' : null })

beforeEach(() => {
  useEditor.setState(useEditor.getInitialState())
  state().loadProject({ ...emptyProject(), assets: [video], clips: [clip], transcripts: { talk: CLIP_WORDS } }, '', [])
  useEditor.setState({ foldout: FOLDOUT_START, selectedClipId: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/* ----------------------------------------------------------- the walk */

interface Host {
  type: string
  props: Record<string, unknown>
}

/** Every host element a tree comes to, function components called (no hook but the store's); a class — an error boundary — is left alone. */
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

const named = (list: Host[], label: string): Host | undefined =>
  list.find((h) => h.type === 'button' && textOf(h.props.children as ReactNode).trim() === label)
const press = (host: Host | undefined): void => (host!.props.onClick as () => void)()
const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')

/** The tab's body as the window draws it. */
function tab(): string {
  const html = renderToStaticMarkup(createElement(Foldout))
  const at = html.indexOf('data-foldout-body="transcript"')
  expect(at, 'the Transcript tab is open').toBeGreaterThan(-1)
  return html.slice(at)
}

/* -------------------------------------------------------------- tests */

describe('the URL tile, once the link’s words are ready', () => {
  it('holds no row, chip, run line or Clip download — only Get transcript and the Transcript toggle', () => {
    linkWords(true)
    state().setUrlRun({ from: 0, to: 1 })
    const left = hosts(createElement(LinkTranscript))
    expect(left.filter((h) => h.props['data-transcript-rows'] !== undefined || h.props['data-row'] !== undefined)).toEqual([])
    expect(left.filter((h) => h.props['data-chapter'] !== undefined || h.props['data-mirror'] !== undefined)).toEqual([])
    expect(named(left, 'Clip download')).toBeUndefined()
    expect(named(left, 'Add another clip')).toBeUndefined()
    const html = renderToStaticMarkup(createElement(LinkTranscript))
    expect(html).not.toContain(' selected')
    expect(html).not.toContain('set by the words you picked')
    expect(named(left, 'Get transcript')).toBeTruthy()
    const toggle = left.filter((h) => h.props['data-link-transcript-toggle'] !== undefined)
    expect(toggle).toHaveLength(1)
    expect(textOf(toggle[0].props.children as ReactNode).trim()).toBe(LT.TRANSCRIPT_TOGGLE)
    expect(toggle[0].props.title).toBe(LT.LINK_TRANSCRIPT_TOGGLE_TITLE)
    // And the words it no longer draws are the panel's: every one of them.
    const right = hosts(createElement(LinkWords))
    expect(right.filter((h) => h.props['data-row'] !== undefined)).toHaveLength(2)
    expect(right.filter((h) => h.props['data-mirror'] !== undefined)).toHaveLength(2)
    expect(named(right, 'Clip download')).toBeTruthy()
  })

  it('still holds every status line, the languages and the no-captions block, and no toggle before the words', () => {
    const at = (status: 'meta' | 'captions' | 'failed' | 'language' | 'none'): string => {
      useEditor.setState((s) => ({
        ingest: { ...s.ingest, url: URL },
        urlSource: {
          linkKey: linkCacheKey(parseLink(URL)!), url: parseLink(URL)!.url,
          meta: { id: 'x', title: 't', duration: 20, language: null, chapters: [{ start_time: 2, end_time: 9, title: 'Opening' }], heatmap: null, channel: 'c', uploader: 'c', webpage_url: URL, hasCaptions: true } as LinkMeta,
          fetchedAt: null, transcript: null, tracks: [], language: null, status, error: status === 'failed' ? 'made-up failure' : null,
          run: null, anchorRow: null, clipped: false
        }
      }))
      return renderToStaticMarkup(createElement(LinkTranscript))
    }
    expect(at('meta')).toContain('Reading the link…')
    expect(at('captions')).toContain('Fetching the captions…')
    expect(at('failed')).toContain('Could not get the transcript.')
    expect(at('failed')).toContain('made-up failure')
    expect(at('language')).toContain('Choose the language')
    const none = at('none')
    expect(none).toContain('This video has no captions')
    expect(none).toContain('Listen to it')
    // Its chips are the tile's, and set the tile's From and To.
    const chips = hosts(createElement(LinkTranscript)).filter((h) => h.props['data-chapter'] !== undefined)
    expect(chips).toHaveLength(1)
    press(chips[0])
    expect(state().ingest).toMatchObject({ useRange: true, startMs: 2000, endMs: 9000 })
    for (const status of ['meta', 'captions', 'failed', 'language', 'none'] as const) {
      expect(at(status), status).not.toContain('data-link-transcript-toggle')
    }
    // A language chosen fetches through the same handler as Get transcript.
    at('language')
    const english = hosts(createElement(LinkTranscript)).find((h) => h.props['data-language'] === 'en')
    expect(english).toBeTruthy()
  })
})

describe('the panel opens on the link’s words when they arrive', () => {
  const stub = (transcript: Transcript | null): void => {
    vi.stubGlobal('window', {
      forge: {
        ingestMeta: async () => ({ id: 'x', title: 't', duration: 20, language: 'en', chapters: [], heatmap: null, channel: 'c', uploader: 'c', webpage_url: URL }),
        ingestCaptions: async () => ({ linkKey: 'k', keys: ['en'], tracks: transcript ? [{ key: 'en', kind: 'asr', path: '/x' }] : [], transcript })
      }
    })
  }

  it('Get transcript pressed, the words come back: the panel is open on them', async () => {
    stub(LINK_WORDS)
    state().setIngest({ url: URL })
    expect(state().foldout.open).toBe(false)
    press(named(hosts(createElement(LinkTranscript)), 'Get transcript'))
    await vi.waitFor(() => expect(state().urlSource?.status).toBe('ready'))
    await vi.waitFor(() => expect(state().foldout).toEqual({ open: true, tab: 'transcript', words: 'link' }))
  })

  it('a language chosen, the words come back: open on them too', async () => {
    stub(LINK_WORDS)
    state().setIngest({ url: URL })
    useEditor.setState({
      urlSource: {
        linkKey: linkCacheKey(parseLink(URL)!), url: parseLink(URL)!.url, meta: null, fetchedAt: null, transcript: null,
        tracks: [], language: null, status: 'language', error: null, run: null, anchorRow: null, clipped: false
      }
    })
    press(hosts(createElement(LinkTranscript)).find((h) => h.props['data-language'] === 'en'))
    await vi.waitFor(() => expect(state().foldout).toEqual({ open: true, tab: 'transcript', words: 'link' }))
  })

  it('a language chosen again after “no captions”, the words come back: open on them too', async () => {
    stub(LINK_WORDS)
    state().setIngest({ url: URL })
    useEditor.setState({
      urlSource: {
        linkKey: linkCacheKey(parseLink(URL)!), url: parseLink(URL)!.url,
        meta: { id: 'x', title: 't', duration: 20, language: null, chapters: [], heatmap: null, channel: 'c', uploader: 'c', webpage_url: URL, hasCaptions: true } as LinkMeta,
        fetchedAt: null, transcript: null, tracks: [], language: null, status: 'none', error: null, run: null, anchorRow: null, clipped: false
      }
    })
    const english = hosts(createElement(LinkTranscript)).find((h) => h.props['data-language'] === 'en')
    expect(english, 'the no-captions block offers the languages again').toBeTruthy()
    press(english)
    await vi.waitFor(() => expect(state().foldout).toEqual({ open: true, tab: 'transcript', words: 'link' }))
  })

  it('no words come back (no captions): it stays shut', async () => {
    stub(null)
    state().setIngest({ url: NO_CAPTIONS })
    press(named(hosts(createElement(LinkTranscript)), 'Get transcript'))
    await vi.waitFor(() => expect(state().urlSource?.status).toBe('none'))
    await Promise.resolve()
    expect(state().foldout.open).toBe(false)
  })
})

describe('the Transcript tab on the link’s words', () => {
  it('draws them beside the picture, and each control works as it did in the tile', () => {
    linkWords(true)
    state().openFoldout('transcript', 'link')
    const body = tab()
    expect(body).toContain('data-foldout-words="link"')
    expect(body).toContain('data-transcript-rows')
    expect(body).toContain('Жорплим')
    expect(body).toContain('>Clip download<')
    // The face is LinkWords itself, so its controls are the ones ingestPanel.test.tsx presses.
    const face = FoldoutTranscriptFace({ words: 'link', ready: true }) as ReactElement<{ children: ReactElement }>
    expect(face.props.children.type).toBe(LinkWords)
    const list = hosts(face)
    const box = list.find((h) => h.props['data-transcript-rows'] !== undefined)!
    ;(box.props.onClick as (e: unknown) => void)({ target: { closest: (sel: string) => (sel === '[data-row-time]' ? { getAttribute: () => '1' } : null) }, shiftKey: false })
    expect(state().urlSource?.run).toEqual({ from: 2, to: 2 })
    expect(named(hosts(face), 'Clip download')?.props.disabled).toBe(false)
  })
})

describe('the Transcript tab on the selected clip’s words', () => {
  it('draws the whole transcript: Edit, the rows and Cut to these words, Find graphics, Listen for', () => {
    selectClip(true)
    state().openFoldout('transcript', 'clip')
    const body = tab()
    expect(body).toContain('data-foldout-words="clip"')
    expect(body).toContain(`title="${escapeHtml('Correct a misheard word: click it, type, Enter')}"`)
    expect(body).toContain('>Edit<')
    expect(body).toContain('data-transcript-rows')
    expect(body).toContain('Velmora')
    expect(body).toContain('Cut to these words')
    expect(body).toContain('>Find graphics in this clip<')
    expect(body).toContain('Listen for — names and words')
    const face = FoldoutTranscriptFace({ words: 'clip', ready: true }) as ReactElement<{ children: ReactElement }>
    expect(face.props.children.type).toBe(TranscriptPanel)
  })

  it('with no clip selected and no link words, says to select one', () => {
    state().openFoldout('transcript', 'clip')
    expect(tab()).toContain(escapeHtml(F.FOLDOUT_CLIP_EMPTY))
    expect(tab()).not.toContain('data-transcript-rows')
  })
})

describe('the two-way switch', () => {
  const sides = (): Host[] => hosts(FoldoutTranscript()).filter((h) => h.props['data-foldout-side'] !== undefined)

  it('is drawn only while both transcripts are there', () => {
    state().openFoldout('transcript', 'link')
    expect(sides()).toEqual([])
    linkWords(true)
    expect(sides()).toEqual([])
    selectClip(true)
    expect(sides().map((h) => h.props['data-foldout-side'])).toEqual(['link', 'clip'])
    linkWords(false)
    expect(sides()).toEqual([])
  })

  it('shows the side pressed, and each side opens the tab on its words', () => {
    linkWords(true)
    selectClip(true)
    state().openFoldout('transcript', 'link')
    expect(sides().map((h) => [h.props['data-foldout-side'], h.props['aria-pressed']])).toEqual([['link', true], ['clip', false]])
    // The side showing is lit as every chosen choice is (ui/lit.ts), the other is not.
    expect(sides().map((h) => String(h.props.className).split(' ').includes('shadow-lit'))).toEqual([true, false])
    expect(tab()).toContain('data-foldout-words="link"')
    press(sides()[1])
    expect(state().foldout).toEqual({ open: true, tab: 'transcript', words: 'clip' })
    expect(sides().map((h) => h.props['aria-pressed'])).toEqual([false, true])
    expect(tab()).toContain('data-foldout-words="clip"')
    expect(tab()).not.toContain('data-foldout-words="link"')
    press(sides()[0])
    expect(state().foldout.words).toBe('link')
    expect(tab()).toContain('data-foldout-words="link"')
    // Its words, as constants.
    expect([F.FOLDOUT_LINK_WORDS, F.FOLDOUT_CLIP_WORDS]).toEqual(['The link', 'The selected clip'])
    const html = renderToStaticMarkup(createElement(WordsSwitch, { shown: 'link', onPick: () => undefined }))
    expect(html).toContain(`aria-label="${F.FOLDOUT_WORDS_LABEL}"`)
  })

  it('stands outside the face’s error boundary, which is keyed by the words shown', () => {
    linkWords(true)
    selectClip(true)
    const boundary = (): ReactElement[] => {
      const found: ReactElement[] = []
      const visit = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(visit)
        if (!isValidElement(node)) return
        if (node.type === ErrorBoundary) found.push(node)
        visit((node.props as { children?: unknown }).children)
      }
      visit(FoldoutTranscript())
      return found
    }
    state().openFoldout('transcript', 'link')
    expect(boundary().map((b) => b.key)).toEqual(['transcript:link'])
    state().openFoldout('transcript', 'clip')
    expect(boundary().map((b) => b.key)).toEqual(['transcript:clip'])
    // Asked for the clip with none selected: the key is the words SHOWN, the link's.
    selectClip(false)
    expect(boundary().map((b) => b.key)).toEqual(['transcript:link'])
    // The switch is not inside it: the boundary holds the face alone, and the switch is drawn beside it.
    selectClip(true)
    const held = (boundary()[0].props as { children: ReactElement }).children
    expect(held.type).toBe(FoldoutTranscriptFace)
    expect(hosts(FoldoutTranscript()).filter((h) => h.props['data-foldout-side'] !== undefined)).toHaveLength(2)
  })
})

describe('the Transcript tile', () => {
  const tile = (): Host[] => hosts(createElement(TranscriptTile))
  const toggle = (): Host => tile().find((h) => h.props['data-clip-transcript-toggle'] !== undefined)!
  const line = (): string => textOf(tile().find((h) => h.props['data-transcript-tile-line'] !== undefined)!.props.children as ReactNode)

  it('is one line and a toggle: no row, no Edit, no Find graphics, no Listen for', () => {
    selectClip(true)
    const html = renderToStaticMarkup(createElement(TranscriptTile))
    expect(html).not.toContain('data-transcript-rows')
    expect(html).not.toContain('Edit')
    expect(html).not.toContain('Find graphics')
    expect(html).not.toContain('Listen for')
    expect(line()).toBe('en · 4 words')
    expect(textOf(toggle().props.children as ReactNode).trim()).toBe(TP.CLIP_TRANSCRIPT_TOGGLE)
    expect(toggle().props.title).toBe(TP.CLIP_TRANSCRIPT_TOGGLE_TITLE)
  })

  it('says to select a clip with none, its toggle greyed; and that a clip has no transcript yet', () => {
    expect(line()).toBe(TP.SELECT_CLIP_TEXT)
    expect(toggle().props.disabled).toBe(true)
    selectClip(true)
    useEditor.setState((s) => ({ project: { ...s.project, transcripts: {} } }))
    expect(line()).toBe(TP.TILE_NO_TRANSCRIPT)
    expect(toggle().props.disabled).toBe(false)
  })

  it('its toggle opens the tab on the clip’s words and closes it; closing leaves the tile open and the toggle un-pressed', () => {
    selectClip(true)
    state().setShelfTool('transcript')
    expect(toggle().props['aria-pressed']).toBe(false)
    press(toggle())
    expect(state().foldout).toEqual({ open: true, tab: 'transcript', words: 'clip' })
    expect(toggle().props['aria-pressed']).toBe(true)
    press(toggle())
    expect(state().foldout.open).toBe(false)
    // The close button too.
    state().openFoldout('transcript', 'clip')
    state().closeFoldout()
    expect(state().shelfTool).toBe('transcript')
    expect(toggle().props['aria-pressed']).toBe(false)
  })
})

describe('the Transcript tile’s toggle with no clip (piece 3’s critics)', () => {
  const toggle = (): Host => hosts(createElement(TranscriptTile)).find((h) => h.props['data-clip-transcript-toggle'] !== undefined)!

  it('no link, no clip, the tab opened on the clip’s empty face: the toggle reads pressed, is not greyed, and closes it', () => {
    state().openFoldout('transcript', 'clip')
    expect(tab()).toContain('data-foldout-words="clip"')
    expect(toggle().props['aria-pressed']).toBe(true)
    expect(toggle().props.disabled).toBe(false)
    press(toggle())
    expect(state().foldout.open).toBe(false)
    // Shut again, with no clip, it greys as before.
    expect(toggle().props.disabled).toBe(true)
  })
})

describe('the toggles decide on the words the tab shows (piece 1’s critics, (b))', () => {
  const linkToggle = (): Host => hosts(createElement(LinkTranscript)).find((h) => h.props['data-link-transcript-toggle'] !== undefined)!
  const clipToggle = (): Host => hosts(createElement(TranscriptTile)).find((h) => h.props['data-clip-transcript-toggle'] !== undefined)!

  it('asked for the clip, no clip selected, the link’s words shown: the URL tile’s toggle reads pressed and closes', () => {
    linkWords(true)
    state().openFoldout('transcript', 'clip')
    expect(tab()).toContain('data-foldout-words="link"')
    expect(linkToggle().props['aria-pressed']).toBe(true)
    expect(clipToggle().props['aria-pressed']).toBe(false)
    press(linkToggle())
    expect(state().foldout.open).toBe(false)
  })

  it('both there, the clip’s shown: the URL tile’s toggle switches to the link’s words and keeps the panel open', () => {
    linkWords(true)
    selectClip(true)
    state().openFoldout('transcript', 'clip')
    expect(linkToggle().props['aria-pressed']).toBe(false)
    expect(clipToggle().props['aria-pressed']).toBe(true)
    press(linkToggle())
    expect(state().foldout).toEqual({ open: true, tab: 'transcript', words: 'link' })
    expect(linkToggle().props['aria-pressed']).toBe(true)
    expect(clipToggle().props['aria-pressed']).toBe(false)
    press(clipToggle())
    expect(state().foldout).toEqual({ open: true, tab: 'transcript', words: 'clip' })
  })

  it('asked for the link (the tab bar’s way), no link words, a clip selected, the clip’s shown: the tile’s toggle reads pressed and closes', () => {
    selectClip(true)
    state().openFoldout('transcript')
    expect(state().foldout.words).toBe('link')
    expect(tab()).toContain('data-foldout-words="clip"')
    expect(clipToggle().props['aria-pressed']).toBe(true)
    press(clipToggle())
    expect(state().foldout.open).toBe(false)
  })

  it('on the Clips tab, neither reads pressed, and each opens the Transcript tab on its words', () => {
    linkWords(true)
    selectClip(true)
    state().openFoldout('clips')
    expect(linkToggle().props['aria-pressed']).toBe(false)
    expect(clipToggle().props['aria-pressed']).toBe(false)
    press(clipToggle())
    expect(state().foldout).toEqual({ open: true, tab: 'transcript', words: 'clip' })
  })
})

describe('the lines that say where something is', () => {
  it('a card’s graphics line points beside the picture, not at the Transcript tile', () => {
    expect(STEP_TEXT.graphicsListed).not.toMatch(/Transcript tile/u)
    expect(graphicsResultText(1, 0)).toBe('1 placed: listed under the clip’s words, beside the picture.')
  })

  it('the tile’s line points at Transcribe beside the picture, and the panel’s empty lines at the URL tile', () => {
    expect(TP.TILE_NO_TRANSCRIPT).toBe('This clip has no transcript yet. Transcribe it beside the picture.')
    expect(F.FOLDOUT_LINK_EMPTY).toContain('URL tile')
    expect(F.FOLDOUT_LINK_EMPTY).toContain('Get transcript')
  })

  it('no on-screen words anywhere still send the person to the Transcript tile for words, rows or graphics', () => {
    // Parsed, so a comment telling the history is not on screen; the harness is not the interface.
    const root = resolve(__dirname, '../..')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const path = join(dir, e.name)
        if (e.isDirectory()) return path.includes(`${join('src', 'renderer', 'src', 'harness')}`) ? [] : walk(path)
        return /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') ? [path] : []
      })
    const said: string[] = []
    for (const path of [...walk(resolve(root, 'src/renderer/src')), ...walk(resolve(root, 'src/shared'))]) {
      const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const visit = (node: ts.Node): void => {
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) && /Transcript tile/u.test(node.text)) said.push(`${path}: ${node.text}`)
        ts.forEachChild(node, visit)
      }
      visit(file)
    }
    expect(said).toEqual([])
  })
})
