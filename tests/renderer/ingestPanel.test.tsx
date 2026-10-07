import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { linkCacheKey, parseLink } from '@shared/ingest/url'
import { buildYtDlpArgs, outputStem, type IngestRequest, type LinkMeta } from '@shared/ingest/args'
import { json3Kind, transcriptFromTracks } from '@shared/ingest/captions'
import { formatMark } from '@shared/ingest/section'
import { rowsOf, runFromRows, runOfChapter, runRange } from '@shared/ingest/wordRun'
import type { LinkClip } from '@shared/ingest/linkClip'

/*
 * The URL tile's transcript, rendered and pressed (docs/CLIPS.md §3b.2–3b.5,
 * §3b.8): Get transcript shows rows; a click and a shift-click pick a run; the
 * handles snap to words; a chapter chip picks its words; Clip it — its button
 * "Clip download", beside Get's "Full download" — starts one
 * exact job for exactly the run's range, its argv holding one
 * `--download-sections`; Add another clip starts nothing and clears the run;
 * From and To mirror the run, read-only, while there are words, and are typed
 * when there are none — no captions, or a fetch that failed — where "This
 * video has no captions" and a greyed Listen to it say why.
 *
 * Rendered to static markup for what is on screen, and — for the presses —
 * called as functions, the store mocked to a plain selector over the REAL
 * store's state, so every press runs the real action. The panel's transcript
 * half has no hook but the store's for exactly this; its row box carries every
 * handler and reads what was pressed from the element under the pointer, so a
 * press is that handler called with the element it would have found.
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
const { IngestPanel, LinkBox, FULL_DOWNLOAD_TITLE } = await import('../../src/renderer/src/components/IngestPanel')
const { LinkTranscript, CLIP_DOWNLOAD_TITLE } = await import('../../src/renderer/src/components/tools/LinkTranscript')

const URL = 'https://www.youtube.com/watch?v=MadeUpTalk2'
const NO_CAPTIONS = 'https://www.youtube.com/watch?v=MadeUpTalk3'
const LINK_KEY = linkCacheKey(parseLink(URL)!)

/* ------------------------------------------------------------ fixtures */

type Seg = { utf8: string; tOffsetMs?: number; acAsrConf?: number }

const NAMES = ['alpha', 'bravo', 'charlie', 'delta']

/** Four ASR lines of four made-up words, at 1, 5, 9 and 13 s — four rows, the last word of each ending a sentence. */
function json3(): unknown {
  return {
    wireMagic: 'pb3',
    events: [
      { tStartMs: 0, dDurationMs: 60_000, id: 1 },
      ...[1000, 5000, 9000, 13_000].map((at, r) => ({
        tStartMs: at,
        dDurationMs: 3000,
        wWinId: 1,
        segs: NAMES.map((name, k): Seg => {
          const text = k === 3 ? `${name}${r}.` : name
          return k === 0 ? { utf8: text, acAsrConf: 0 } : { utf8: ` ${text}`, tOffsetMs: k * 400, acAsrConf: 0 }
        })
      }))
    ]
  }
}

function meta(url: string): LinkMeta {
  return {
    id: parseLink(url)!.videoId,
    title: 'A made-up talk',
    duration: 20,
    language: 'en',
    chapters: [
      { start_time: 0, end_time: 5, title: 'Opening' },
      { start_time: 5, end_time: 13, title: 'Middle' },
      { start_time: 13, end_time: 20, title: 'Close' }
    ],
    heatmap: null,
    channel: 'Made-up channel',
    uploader: 'Made-up channel',
    webpage_url: parseLink(url)!.url
  }
}

let started: { request: IngestRequest; clip: LinkClip | null }[] = []
let captions: (url: string, language: string) => Promise<unknown>

function fetchCaptions(url: string, language: string): unknown {
  const linkKey = linkCacheKey(parseLink(url)!)
  if (url === NO_CAPTIONS) return { linkKey, keys: ['en', 'en-orig'], tracks: [], transcript: null }
  const read = [{ key: 'en-orig', kind: json3Kind(json3())!, json: json3() }]
  return {
    linkKey,
    keys: ['en', 'en-orig'],
    tracks: read.map(({ key, kind }) => ({ key, kind, path: `/userData/url/${linkKey}/${linkKey}.captions.${key}.json3` })),
    transcript: transcriptFromTracks(read, `url:${linkKey}`, language)
  }
}

beforeEach(() => {
  started = []
  captions = async (url, language) => fetchCaptions(url, language)
  vi.stubGlobal('window', {
    forge: {
      ingestMeta: async (url: string) => meta(url),
      ingestCaptions: (url: string, language: string) => captions(url, language),
      startIngest: async (request: IngestRequest, clip?: LinkClip | null) => {
        started.push({ request, clip: clip ?? null })
        return { id: `job-${started.length}`, presetId: 'ingest', status: 'queued' }
      }
    }
  })
  useEditor.setState(useEditor.getInitialState())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const state = () => useEditor.getState()

/* ----------------------------------------------------------- the walk */

interface Host {
  type: string
  props: Record<string, unknown>
}

/**
 * Every host element a tree of elements comes to, with its props — the
 * handlers included, which static markup drops. Function components and memo
 * rows are called as the renderer would call them (the store is a plain
 * selector here, so they have no hook of their own); an icon (forwardRef) and
 * a class are left alone.
 */
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

/** A host's text, as it would read on screen. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((n) => textOf(n as ReactNode)).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

const transcriptHosts = (): Host[] => hosts(createElement(LinkTranscript))
const buttonNamed = (label: string): Host | undefined =>
  transcriptHosts().find((h) => h.type === 'button' && textOf(h.props.children as ReactNode).trim() === label)
const rowBox = (): Host => {
  const box = transcriptHosts().find((h) => h.props['data-transcript-rows'] !== undefined)
  if (!box) throw new Error('no rows on screen')
  return box
}
const panel = (): string => renderToStaticMarkup(createElement(IngestPanel))

/** What `closest` finds from a pressed element: the attributes named, on the elements around it. */
function under(attrs: Record<string, string>): { closest: (selector: string) => { getAttribute: (name: string) => string } | null } {
  return {
    closest: (selector) => {
      const name = selector.slice(1, -1)
      return name in attrs ? { getAttribute: () => attrs[name] } : null
    }
  }
}

/** Press a row's time (0-based), shift or not. */
function pressRow(row: number, shiftKey = false): void {
  ;(rowBox().props.onClick as (e: unknown) => void)({ target: under({ 'data-row-time': String(row) }), shiftKey })
}

/** Press a word, shift or not. */
function pressWord(word: number, shiftKey = false): void {
  ;(rowBox().props.onClick as (e: unknown) => void)({ target: under({ 'data-word': String(word) }), shiftKey })
}

/**
 * A key pressed on a focused handle. What the handler did besides moving it is
 * recorded: whether it stopped the key there, and which element it put focus
 * back on once the next frame was drawn (requestAnimationFrame is run at once).
 */
function pressKey(which: string, key: string): { stopped: boolean; focused: string[] } {
  const seen = { stopped: false, focused: [] as string[] }
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => {
    f()
    return 0
  })
  const box = { querySelector: (selector: string) => ({ focus: () => seen.focused.push(selector) }) }
  ;(rowBox().props.onKeyDown as (e: unknown) => void)({
    target: under({ 'data-handle': which }),
    currentTarget: box,
    key,
    preventDefault: () => undefined,
    stopPropagation: () => {
      seen.stopped = true
    }
  })
  return seen
}

/** The link box and Get, as host elements. */
const linkBox = (): Host[] => hosts(createElement(LinkBox))
const getButton = (): Host => {
  const found = linkBox().filter((h) => h.type === 'button')
  expect(found).toHaveLength(1)
  return found[0]
}

/** A box the drag handlers can read: four rows 40 px tall, and somewhere to keep the drag. */
function fakeBox(rowCount: number): Record<string, unknown> {
  const attrs = new Map<string, string>()
  return {
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    removeAttribute: (name: string) => attrs.delete(name),
    setPointerCapture: () => undefined,
    querySelectorAll: () =>
      Array.from({ length: rowCount }, (_, r) => ({
        getAttribute: () => String(r),
        getBoundingClientRect: () => ({ top: r * 40, bottom: r * 40 + 40 })
      }))
  }
}

/** Drag a handle to `y` on a fake box, as the pointer would: down on the handle, move on the box. */
function drag(which: 'start' | 'end', y: number): void {
  const box = fakeBox(rowsOf(state().urlSource!.transcript!).length)
  const noop = (): void => undefined
  ;(rowBox().props.onPointerDown as (e: unknown) => void)({ target: under({ 'data-handle': which }), currentTarget: box, pointerId: 1, preventDefault: noop })
  // The move handler of the render the drag began in, as React's would be until the run changes.
  ;(rowBox().props.onPointerMove as (e: unknown) => void)({ currentTarget: box, clientY: y })
}

async function getTranscript(url = URL): Promise<void> {
  state().setIngest({ url })
  const button = buttonNamed('Get transcript')
  expect(button, 'Get transcript').toBeTruthy()
  ;(button!.props.onClick as () => void)()
  await vi.waitFor(() => expect(['ready', 'none', 'failed']).toContain(state().urlSource?.status))
}

/* -------------------------------------------------------------- tests */

describe('Get transcript', () => {
  it('shows the link’s rows, time | text', async () => {
    expect(panel()).not.toContain('data-transcript-rows')
    await getTranscript()
    const t = state().urlSource!.transcript!
    const rows = transcriptHosts().filter((h) => h.props['data-row'] !== undefined)
    expect(rows).toHaveLength(rowsOf(t).length)
    expect(rows.length).toBe(4)
    const html = panel()
    expect(html).toContain('data-transcript-rows')
    expect(html).toContain('>0:05</button>')
    expect(html).toContain('charlie')
  })

  it('is greyed until the box holds a link', () => {
    state().setIngest({ url: '' })
    expect(buttonNamed('Get transcript')?.props.disabled).toBe(true)
    state().setIngest({ url: 'not a link' })
    expect(buttonNamed('Get transcript')?.props.disabled).toBe(true)
    state().setIngest({ url: URL })
    expect(buttonNamed('Get transcript')?.props.disabled).toBe(false)
  })

  it('failing — offline — says so, and From and To stay typed fields', async () => {
    captions = async () => {
      throw new Error('Unable to download webpage: offline')
    }
    state().setIngest({ useRange: true })
    await getTranscript()
    expect(state().urlSource?.status).toBe('failed')
    const html = panel()
    expect(html).toContain('Could not get the transcript.')
    expect(html).toContain('offline')
    expect(html).toContain('aria-label="From — minutes and seconds"')
    expect(html).toContain('aria-label="To — minutes and seconds"')
    expect(html).not.toMatch(/readonly/i)
    expect(html).not.toContain('data-transcript-rows')
  })
})

describe('picking a run', () => {
  it('a click picks a row; a shift-click on another row extends to it; a shift-click on a word moves the end there', async () => {
    await getTranscript()
    const t = state().urlSource!.transcript!
    pressRow(1)
    expect(state().urlSource!.run).toEqual(runFromRows(t, 1, 1))
    pressRow(3, true)
    expect(state().urlSource!.run).toEqual(runFromRows(t, 1, 3))
    pressWord(9, true)
    expect(state().urlSource!.run).toEqual({ from: 4, to: 9 })
    // A plain click on a word picks its row.
    pressWord(2)
    expect(state().urlSource!.run).toEqual(runFromRows(t, 0, 0))
  })

  it('the handles snap to words — Start to a word’s start, End to a word’s end — and the arrows move them a word', async () => {
    await getTranscript()
    const t = state().urlSource!.transcript!
    // Nothing picked: Start rests on the first word and End on the last.
    const handles = transcriptHosts().filter((h) => h.props['data-handle'] !== undefined)
    expect(handles.map((h) => [h.props['data-handle'], h.props['aria-label'], h.props['aria-valuenow']])).toEqual([
      ['start', 'Start', 0],
      ['end', 'End', t.words.length - 1]
    ])
    // Row 2 (y 40–80) spans 5000–6500 ms; 55% down is 5825 ms, nearest the third word's START (5800) — a word, not the row.
    drag('start', 40 + 0.55 * 40)
    expect(state().urlSource!.run).toEqual({ from: 6, to: t.words.length - 1 })
    // Row 3 (y 80–120) spans 9000–10 500 ms; 45% down is 9675 ms, nearest the second word's END (9800, against 9400).
    drag('end', 80 + 0.45 * 40)
    expect(state().urlSource!.run).toEqual({ from: 6, to: 9 })
    expect([t.words[8].endMs, t.words[9].endMs]).toEqual([9400, 9800])
    // The keyboard: End one word on, Start one word back.
    pressKey('end', 'ArrowDown')
    expect(state().urlSource!.run).toEqual({ from: 6, to: 10 })
    pressKey('start', 'ArrowUp')
    expect(state().urlSource!.run).toEqual({ from: 5, to: 10 })
  })

  it('a handle moved by a key keeps the focus — into the next row too — and the key stops there', async () => {
    await getTranscript()
    pressRow(1)
    expect(state().urlSource!.run).toEqual({ from: 4, to: 7 })
    // Word 7 ends row 2; one more is row 3's first word, where End is a new element.
    const step = pressKey('end', 'ArrowDown')
    expect(state().urlSource!.run).toEqual({ from: 4, to: 8 })
    expect(step.focused).toEqual(['[data-handle="end"]'])
    // The window's arrows move the playhead: a key the handle took goes no further.
    expect(step.stopped).toBe(true)
    const back = pressKey('start', 'ArrowLeft')
    expect(state().urlSource!.run).toEqual({ from: 3, to: 8 })
    expect(back.focused).toEqual(['[data-handle="start"]'])
    expect(back.stopped).toBe(true)
    // A key the handle does not take is left for the window.
    const other = pressKey('start', 'KeyS')
    expect(other).toEqual({ stopped: false, focused: [] })
  })

  it('shift-clicks a row from the row last clicked, either way — row 3, then row 1, then row 4 is rows 3–4', async () => {
    await getTranscript()
    const t = state().urlSource!.transcript!
    pressRow(2)
    pressRow(0, true)
    expect(state().urlSource!.run).toEqual(runFromRows(t, 0, 2))
    pressRow(3, true)
    expect(state().urlSource!.run).toEqual(runFromRows(t, 2, 3))
  })

  it('after a drag, a key or a word shift-click, a row shift-click extends the run on screen — the start just set stays', async () => {
    await getTranscript()
    const t = state().urlSource!.transcript!
    // Dragged: rows 2–3 picked, Start dragged up to row 1's third word (row 1, y 0–40, 1000–2500 ms; 1800 ms at 53%).
    pressRow(1)
    pressRow(2, true)
    drag('start', 0.53 * 40)
    expect(state().urlSource!.run).toEqual({ from: 2, to: 11 })
    pressRow(3, true)
    expect(state().urlSource!.run).toEqual({ from: 2, to: t.words.length - 1 })

    // A key: rows 2–3, Start two words back into row 1, then a shift-click on row 4.
    pressRow(1)
    pressRow(2, true)
    pressKey('start', 'ArrowUp')
    pressKey('start', 'ArrowUp')
    expect(state().urlSource!.run).toEqual({ from: 2, to: 11 })
    pressRow(3, true)
    expect(state().urlSource!.run).toEqual({ from: 2, to: t.words.length - 1 })

    // A word: row 2, its start shift-clicked back to word 2, then a shift-click on row 4.
    pressRow(1)
    pressWord(2, true)
    expect(state().urlSource!.run).toEqual({ from: 2, to: 7 })
    pressRow(3, true)
    expect(state().urlSource!.run).toEqual({ from: 2, to: t.words.length - 1 })
    // And the other way: row 3 with its end shift-clicked on to word 13, then row 1 — the start moves back, the end stays.
    pressRow(2)
    pressWord(13, true)
    expect(state().urlSource!.run).toEqual({ from: 8, to: 13 })
    pressRow(0, true)
    expect(state().urlSource!.run).toEqual({ from: 0, to: 13 })
  })

  it('says how long the run is: its range’s length', async () => {
    await getTranscript()
    const t = state().urlSource!.transcript!
    expect(panel()).not.toContain(' selected')
    pressRow(1)
    pressRow(2, true)
    const range = runRange(t, runFromRows(t, 1, 2))
    expect(range.endMs - range.startMs).toBeGreaterThan(5000)
    expect(panel()).toContain(`<span class="tabular-nums">${formatMark(range.endMs - range.startMs)}</span> selected`)
  })

  it('a chapter chip picks the words that start inside the chapter', async () => {
    await getTranscript()
    const t = state().urlSource!.transcript!
    const chips = transcriptHosts().filter((h) => h.props['data-chapter'] !== undefined)
    expect(chips).toHaveLength(3)
    ;(chips[1].props.onClick as () => void)()
    const middle = runOfChapter(t, meta(URL).chapters[1])
    expect(middle).toEqual({ from: 4, to: 11 })
    expect(state().urlSource!.run).toEqual(middle)
  })
})

describe('Clip it, and Add another clip', () => {
  it('Clip download is greyed until a run is picked, and says it takes only the picked words', async () => {
    await getTranscript()
    expect(buttonNamed('Clip download')?.props.disabled).toBe(true)
    // The user's words for it (2026-10-06), and no button still called Clip it.
    expect(buttonNamed('Clip download')?.props.title).toBe(CLIP_DOWNLOAD_TITLE)
    expect(CLIP_DOWNLOAD_TITLE).toBe('Download only the words you picked and put them on the timeline')
    expect(buttonNamed('Clip it')).toBeUndefined()
    pressRow(1)
    expect(buttonNamed('Clip download')?.props.disabled).toBe(false)
    state().setUrlRun(null)
    expect(buttonNamed('Clip download')?.props.disabled).toBe(true)
  })

  it('takes the video, or its sound — never a song’s split left chosen from an earlier download', async () => {
    await getTranscript()
    const kinds: string[] = []
    for (const kind of ['instrumental', 'vocal', 'audio', 'video'] as const) {
      state().setIngest({ kind })
      pressRow(kinds.length)
      ;(buttonNamed('Clip download')!.props.onClick as () => void)()
      await vi.waitFor(() => expect(started).toHaveLength(kinds.length + 1))
      kinds.push(started[kinds.length].request.kind)
    }
    expect(kinds).toEqual(['video', 'video', 'audio', 'video'])
  })

  it('Clip it starts ONE exact job for exactly the run’s range, its argv holding one --download-sections', async () => {
    await getTranscript()
    const t = state().urlSource!.transcript!
    pressRow(1)
    pressRow(2, true)
    const range = runRange(t, runFromRows(t, 1, 2))
    ;(buttonNamed('Clip download')!.props.onClick as () => void)()
    await vi.waitFor(() => expect(state().urlSource?.clipped).toBe(true))

    expect(started).toHaveLength(1)
    const { request, clip } = started[0]
    expect(request.exact).toBe(true)
    expect(request.range).toEqual(range)
    expect(clip?.transcriptFrom.run).toEqual(runFromRows(t, 1, 2))
    expect(clip?.transcriptFrom.linkKey).toBe(LINK_KEY)
    const link = parseLink(request.url)!
    const { args } = buildYtDlpArgs(request, { ffmpegPath: '/ffmpeg', destDir: '/downloads', stem: outputStem(link, request) })
    const sections = args.filter((arg) => arg === '--download-sections')
    expect(sections).toHaveLength(1)
    expect(args[args.indexOf('--download-sections') + 1]).toBe(`*${(range.startMs / 1000).toFixed(3)}-${(range.endMs / 1000).toFixed(3)}`)
    // The plain Get keeps its fast default: the override changed only this job.
    expect(state().ingest.exact).toBe(false)
  })

  it('Add another clip starts nothing, keeps the rows and clears the run — and the next Clip it is a job of its own', async () => {
    await getTranscript()
    const t = state().urlSource!.transcript!
    pressRow(0)
    ;(buttonNamed('Clip download')!.props.onClick as () => void)()
    await vi.waitFor(() => expect(state().urlSource?.clipped).toBe(true))
    expect(buttonNamed('Clip download')).toBeUndefined()

    ;(buttonNamed('Add another clip')!.props.onClick as () => void)()
    expect(started).toHaveLength(1)
    expect(state().urlSource!.run).toBeNull()
    expect(state().urlSource!.transcript).toBe(t)
    expect(transcriptHosts().filter((h) => h.props['data-row'] !== undefined)).toHaveLength(4)
    expect(buttonNamed('Clip download')).toBeTruthy()

    pressRow(3)
    ;(buttonNamed('Clip download')!.props.onClick as () => void)()
    await vi.waitFor(() => expect(started).toHaveLength(2))
    const sections = started.map(({ request }) => {
      const { args } = buildYtDlpArgs(request, { ffmpegPath: '/ffmpeg', destDir: '/downloads', stem: outputStem(parseLink(request.url)!, request) })
      return args.filter((arg) => arg === '--download-sections').length
    })
    expect(sections).toEqual([1, 1])
    expect(started[1].request.range).toEqual(runRange(t, runFromRows(t, 3, 3)))
    expect(started[1].request.range).not.toEqual(started[0].request.range)
  })
})

describe('the From and To fields', () => {
  it('mirror the run, read-only, while there are words — and follow it when it changes', async () => {
    state().setIngest({ useRange: true })
    await getTranscript()
    const t = state().urlSource!.transcript!
    pressRow(1)
    let html = panel()
    // The typed fields are gone…
    expect(html).not.toContain('aria-label="From — minutes and seconds"')
    expect(html).not.toContain('aria-label="To — minutes and seconds"')
    // …and the run's own stand in their place, read-only.
    let range = runRange(t, runFromRows(t, 1, 1))
    expect(html).toMatch(new RegExp(`<input readOnly="" data-mirror="from" class="[^"]*" value="${formatMark(range.startMs)}"/>`))
    expect(html).toMatch(new RegExp(`<input readOnly="" data-mirror="to" class="[^"]*" value="${formatMark(range.endMs)}"/>`))
    expect(html).toContain('set by the words you picked')

    pressRow(3, true)
    html = panel()
    range = runRange(t, runFromRows(t, 1, 3))
    expect(html).toMatch(new RegExp(`<input readOnly="" data-mirror="from" class="[^"]*" value="${formatMark(range.startMs)}"/>`))
    expect(html).toMatch(new RegExp(`<input readOnly="" data-mirror="to" class="[^"]*" value="${formatMark(range.endMs)}"/>`))
  })

  it('are not sent by a plain Get while the words stand in for them — it takes the whole video — and are when typed', async () => {
    state().setIngest({ useRange: true, startMs: 2000, endMs: 4000 })
    await getTranscript()
    pressRow(1)
    await state().startIngest()
    expect(started[0].request.range).toBeNull()
    expect(started[0].clip).toBeNull()

    // A link with no words: the typed range is what Get asks for, at the form's (fast) cut.
    state().setIngest({ url: URL, useRange: true, startMs: 2000, endMs: 4000 })
    useEditor.setState({ urlSource: null })
    await state().startIngest()
    expect(started[1].request.range).toEqual({ startMs: 2000, endMs: 4000 })
    expect(started[1].request.exact).toBe(false)
  })

  it('while the words are shown, Get reads Full download, is not the accent button, and Enter does not press it', async () => {
    // No words: "Get", the accent button, and Enter in the box presses it.
    state().setIngest({ url: URL })
    let get = getButton()
    expect(textOf(get.props.children as ReactNode).trim()).toBe('Get')
    expect(String(get.props.className)).toContain('bg-accent-500')
    const enter = (): void => {
      const box = linkBox().find((h) => h.type === 'input')!
      ;(box.props.onKeyDown as (e: unknown) => void)({ key: 'Enter' })
    }
    enter()
    await vi.waitFor(() => expect(started).toHaveLength(1))
    expect(started[0].request.range).toBeNull()

    // Words on screen and a run picked, its range in the read-only From and To.
    state().setIngest({ url: URL })
    await getTranscript()
    pressRow(1)
    get = getButton()
    expect(textOf(get.props.children as ReactNode).trim()).toBe('Full download')
    expect(get.props.title).toBe(FULL_DOWNLOAD_TITLE)
    expect(FULL_DOWNLOAD_TITLE).toBe('Download the whole video and put it on the timeline')
    expect(String(get.props.className)).not.toContain('bg-accent-500')
    // Clip download is the accent button now.
    expect(String(buttonNamed('Clip download')!.props.className)).toContain('bg-accent-500')
    enter()
    await Promise.resolve()
    expect(started).toHaveLength(1)
    // Pressed, it takes what it says.
    ;(get.props.onClick as () => void)()
    await vi.waitFor(() => expect(started).toHaveLength(2))
    expect(started[1].request.range).toBeNull()
    expect(started[1].clip).toBeNull()
  })

  it('are typed fields, as before, with no transcript', () => {
    state().setIngest({ url: URL, useRange: true })
    const html = panel()
    expect(html).toContain('aria-label="From — minutes and seconds"')
    expect(html).toContain('aria-label="To — minutes and seconds"')
    expect(html).not.toMatch(/readonly/i)
    expect(html).not.toContain('data-mirror')
  })
})

describe('a video with no captions', () => {
  it('says so, greys Listen to it with "needs the AI helper", and keeps From and To typed', async () => {
    state().setIngest({ useRange: true })
    await getTranscript(NO_CAPTIONS)
    expect(state().urlSource?.status).toBe('none')
    const html = panel()
    expect(html).toContain('This video has no captions')
    expect(html).toMatch(/<button type="button" disabled="" title="[^"]*"[^>]*>(?:(?!<\/button>).)*Listen to it<\/button>/)
    expect(html).toContain('needs the AI helper')
    expect(html).toContain('aria-label="From — minutes and seconds"')
    expect(html).not.toMatch(/readonly/i)
    expect(html).not.toContain('data-transcript-rows')

    // With the helper up it is still greyed: listening is not built yet, and never downloads here.
    state().setSidecar(true, null)
    const listen = transcriptHosts().find((h) => h.type === 'button' && textOf(h.props.children as ReactNode).trim() === 'Listen to it')
    expect(listen?.props.disabled).toBe(true)
    expect(listen?.props.onClick).toBeUndefined()
    expect(panel()).not.toContain('needs the AI helper')
    expect(started).toHaveLength(0)
  })

  it('lets a chapter chip set From and To instead', async () => {
    await getTranscript(NO_CAPTIONS)
    const chips = transcriptHosts().filter((h) => h.props['data-chapter'] !== undefined)
    ;(chips[2].props.onClick as () => void)()
    expect(state().ingest).toMatchObject({ useRange: true, startMs: 13_000, endMs: 20_000 })
  })
})
