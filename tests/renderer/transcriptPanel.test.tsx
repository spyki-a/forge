import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { clipSourceWindow, clipToRange, clipWords, cutFrames, DETACHED_NOTE, HOLD_NOTE } from '@shared/edit/clipIt'
import { emptyProject, timelineFrameAt, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { PAUSE_BOUNDARY_MS, segmentIntoSentences, withWordText, type Transcript, type Word } from '@shared/transcript'
import { rowsOf, runFromRows } from '@shared/ingest/wordRun'
import { formatMark } from '@shared/ingest/section'

/*
 * The Transcript tile's half of §3b.6 (docs/CLIPS.md §3b.8), rendered and
 * pressed: a selected timeline clip with a transcript shows the rows of the
 * words it PLAYS — TranscriptRows, the URL tile's own — each row's time where
 * it is on the timeline through the clip's speed; a click and a shift-click
 * pick a run and move the playhead to where the cut would open; **Cut to these
 * words** trims the clip to `clipToRange`'s in-point and length in ONE undo
 * step. No transcript, no rows; a hold says so in their place.
 *
 * As tests/renderer/ingestPanel.test.tsx does: static markup for what is on
 * screen, and — for the presses — the rows' half called as a function, the
 * store mocked to a plain selector over the REAL store's state, so every press
 * runs the real action. Every transcript is made up — NATO letters.
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
const { TranscriptPanel, TranscriptBody, ClipWords, EditClipWords, CUT_TITLE, CLIP_ROWS_HINT, NO_WORDS_TEXT } = await import(
  '../../src/renderer/src/components/TranscriptPanel'
)
const { rowStamp } = await import('../../src/renderer/src/components/tools/TranscriptRows')

const FPS = 30

/* ------------------------------------------------------------ fixtures */

const NAMES = ['alpha', 'bravo', 'charlie', 'delta']

/**
 * Rows of four words, 400 ms apart and 300 ms long, a full stop ending each,
 * at 16, 20, 24 and 28 s — and one word either side of what the clip plays
 * (5 s and 80 s), which are not its words.
 */
function talk(): Transcript {
  const spec: [string, number, number][] = [['zulu.', 5000, 5300]]
  for (const [r, at] of [16_000, 20_000, 24_000, 28_000].entries()) {
    NAMES.forEach((name, k) => spec.push([k === 3 ? `${name}${r}.` : name, at + k * 400, at + k * 400 + 300]))
  }
  spec.push(['yankee.', 80_000, 80_300])
  const words: Word[] = spec.map(([text, start, end], i) => ({ index: i, text, startMs: start, endMs: end, confidence: 0.9 }))
  return { assetId: 'talk', language: 'en', model: 'test', durationMs: 80_300, words, segments: segmentIntoSentences(words, PAUSE_BOUNDARY_MS) }
}

const TALK = talk()

const ASSET: MediaAsset = {
  id: 'talk',
  path: '/media/talk.mp4',
  name: 'talk',
  kind: 'video',
  durationFrames: 120 * FPS,
  width: 1920,
  height: 1080,
  fps: FPS,
  hasVideo: true,
  hasAudio: true,
  size: 1
}

/** The talk at 4 s on the timeline, at 2× from 15 s of source: it plays 15 s to 75 s. */
function clip(patch: Partial<Clip> = {}): Clip {
  return {
    id: 'c',
    assetId: 'talk',
    trackId: 'v1',
    start: 120,
    duration: 900,
    inPoint: 450,
    speed: 2,
    volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    color: { brightness: 0, contrast: 1, saturation: 1 },
    ...patch
  }
}

function load(patch: Partial<Clip> = {}, transcript: Transcript | null = TALK): void {
  const base = emptyProject()
  const project: Project = {
    ...base,
    settings: { ...base.settings, fps: FPS },
    assets: [ASSET],
    clips: [clip(patch)],
    transcripts: transcript ? { talk: transcript } : {}
  }
  useEditor.setState({ project, selectedClipIds: ['c'], selectedClipId: 'c', playhead: 0 })
}

beforeEach(() => {
  useEditor.setState(useEditor.getInitialState())
})

const state = () => useEditor.getState()
const theClip = (): Clip => state().project.clips.find((c) => c.id === 'c')!
/** The words the selected clip plays, as the tile computes them. */
const played = (): Transcript => clipWords(TALK, clipSourceWindow(theClip(), FPS))!.transcript

/* ----------------------------------------------------------- the walk */

interface Host {
  type: string
  props: Record<string, unknown>
}

/**
 * Components left as they are, as a host named for them: they hold state of
 * their own (an open word's draft), which a call outside React cannot have,
 * and what a test needs of them is the props they were given.
 */
const LEAVES = new Set(['EditableWord'])

/** Every host element a tree comes to, its handlers included; components and memo rows called as React would. */
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
    if (LEAVES.has((type as { name: string }).name)) {
      out.push({ type: (type as { name: string }).name, props })
      return out
    }
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

/** The rows' half, as the panel draws it for the selected clip. */
const rowsHosts = (): Host[] => hosts(createElement(ClipWords, { clip: theClip(), words: played() }))
const cutButton = (): Host | undefined =>
  rowsHosts().find((h) => h.type === 'button' && textOf(h.props.children as ReactNode).trim() === 'Cut to these words')
const panel = (): string => renderToStaticMarkup(createElement(TranscriptPanel))
/** What is between the header and Listen for with Edit pressed: the words offered to correct. */
const editing = (): Word[] =>
  hosts(createElement(TranscriptBody, { clip: theClip(), transcript: state().project.transcripts.talk ?? null, editing: true }))
    .filter((h) => h.type === 'EditableWord')
    .map((h) => h.props.word as Word)
const EDIT_TITLE = 'Correct a misheard word: click it, type, Enter'

function under(attrs: Record<string, string>): { closest: (selector: string) => { getAttribute: (name: string) => string } | null } {
  return {
    closest: (selector) => {
      const name = selector.slice(1, -1)
      return name in attrs ? { getAttribute: () => attrs[name] } : null
    }
  }
}

function pressRow(row: number, shiftKey = false): void {
  const box = rowsHosts().find((h) => h.props['data-transcript-rows'] !== undefined)
  if (!box) throw new Error('no rows on screen')
  ;(box.props.onClick as (e: unknown) => void)({ target: under({ 'data-row-time': String(row) }), shiftKey })
}

/* -------------------------------------------------------------- tests */

describe('the rows of a selected clip', () => {
  it('are the words the clip plays — not the ones before or after it — each row’s time where it is on the timeline', () => {
    load()
    const html = panel()
    expect(html).toContain('data-transcript-rows')
    const rows = rowsHosts().filter((h) => h.props['data-row'] !== undefined)
    expect(rows).toHaveLength(4)
    expect(rows).toHaveLength(rowsOf(played()).length)
    expect(html).toContain('charlie')
    expect(html).not.toContain('zulu')
    expect(html).not.toContain('yankee')
    // At 2× from 15 s, starting at 4 s: the row at 20 s of source is 4 + 5 / 2 = 6.5 s in.
    const times = rowsHosts().filter((h) => h.props['data-row-time'] !== undefined).map((h) => textOf(h.props.children as ReactNode))
    expect(times).toEqual(['0:04', '0:06', '0:08', '0:10'])
    expect(times[1]).toBe(rowStamp(((timelineFrameAt(theClip(), 20_000, FPS) ?? -1) / FPS) * 1000))
    // With nothing picked: the hint, and the cut greyed.
    expect(html).toContain(CLIP_ROWS_HINT)
    expect(cutButton()?.props.disabled).toBe(true)
    expect(cutButton()?.props.title).toBe(CUT_TITLE)
  })

  it('tint the row under the playhead, read through the clip’s speed', () => {
    load()
    // 8 s on the timeline is 4 s into the clip: at 2× from 15 s, source 23 s — no row (one ends at 21.5 s, the next starts at 24 s).
    useEditor.setState({ playhead: 8 * FPS })
    expect(rowsHosts().filter((h) => h.props['data-active'] !== undefined)).toHaveLength(0)
    // 6.6 s is 2.6 s in: source 20.2 s, inside the second row (20 s to 21.5 s). Read at 1× it would be 17.6 s — no row.
    useEditor.setState({ playhead: Math.round(6.6 * FPS) })
    const active = rowsHosts().filter((h) => h.props['data-active'] !== undefined)
    expect(active.map((h) => h.props['data-row'])).toEqual([1])
    // Off the clip, none.
    useEditor.setState({ playhead: 0 })
    expect(rowsHosts().filter((h) => h.props['data-active'] !== undefined)).toHaveLength(0)
  })

  it('are not there without a transcript, or a selected clip — the panel says what to do', () => {
    load({}, null)
    let html = panel()
    expect(html).not.toContain('data-transcript-rows')
    expect(html).not.toContain('Cut to these words')
    expect(html).toContain('No transcript yet')
    useEditor.setState({ selectedClipIds: [], selectedClipId: null })
    html = panel()
    expect(html).not.toContain('data-transcript-rows')
    expect(html).toContain('Select a clip to see its transcript')
  })

  it('give way to a note on a hold: one frame for its whole length, no words to cut to — and Edit still corrects', () => {
    load({ hold: true, duration: 60, speed: undefined })
    const html = panel()
    expect(html).toContain(HOLD_NOTE)
    expect(html).not.toContain('data-transcript-rows')
    expect(html).not.toContain('Cut to these words')
    // A note, not a block: the rest of the tile is there — Listen for, and Edit, which on a hold lists the whole transcript as it always did.
    expect(html).toContain('Listen for')
    expect(html).toContain(EDIT_TITLE)
    expect(editing().map((w) => w.startMs)).toEqual(TALK.words.map((w) => w.startMs))
  })

  it('give way to a note on a picture whose sound is on its own track — a cut would put them out of sync — and Edit still corrects', () => {
    load({ audioDetached: true })
    const html = panel()
    expect(html).toContain(DETACHED_NOTE)
    expect(html).not.toContain('data-transcript-rows')
    expect(html).not.toContain('Cut to these words')
    expect(html).toContain('Listen for')
    expect(html).toContain(EDIT_TITLE)
    expect(editing().map((w) => w.startMs)).toContain(20_000)
  })

  it('give way to a line when the clip plays a part where nothing is said — and offer no Edit, with nothing to correct', () => {
    // 40 s to 70 s of source: past the last row (28 s), before the last word (80 s).
    load({ inPoint: 1200, duration: 450 })
    const html = panel()
    expect(html).toContain(NO_WORDS_TEXT)
    expect(html).not.toContain('data-transcript-rows')
    expect(html).not.toContain(EDIT_TITLE)
    expect(html).toContain('Listen for')
  })
})

describe('picking a run, and Cut to these words', () => {
  it('a click and a shift-click pick rows; the playhead goes to where the cut opens; the line says its length on the timeline', () => {
    load()
    const w = played()
    pressRow(1)
    pressRow(2, true)
    const run = runFromRows(w, 1, 2)
    expect(state().clipRun?.clipId).toBe('c')
    expect(state().clipRun?.run).toEqual(run)
    // Picking is not an edit.
    expect(state().past).toHaveLength(0)
    const cut = cutFrames(theClip(), w.words[run.from].startMs, w.words[run.to].endMs, FPS)!
    expect(state().playhead).toBe(cut.from)
    // 20 000 to 25 500 ms of source is 5.5 s — at 2×, 2.75 s on the timeline; the last word's end frame ceiled, 83 frames.
    expect(cut.to - cut.from).toBe(83)
    const html = panel()
    expect(html).toContain(`<span class="tabular-nums">${formatMark(((cut.to - cut.from) / FPS) * 1000)}</span> selected`)
    expect(formatMark(((cut.to - cut.from) / FPS) * 1000)).toBe('0:02.8')
    expect(html).not.toContain(CLIP_ROWS_HINT)
    expect(cutButton()?.props.disabled).toBe(false)
  })

  it('Cut to these words trims the clip to clipToRange’s in-point and length in ONE undo step; one undo puts it back', () => {
    load()
    const before = theClip()
    const w = played()
    pressRow(1)
    pressRow(2, true)
    const run = runFromRows(w, 1, 2)
    const predicted = clipToRange(state().project, 'c', w.words[run.from].startMs, w.words[run.to].endMs).project.clips.find((c) => c.id === 'c')!
    ;(cutButton()!.props.onClick as () => void)()

    const after = theClip()
    expect(after).toEqual(predicted)
    expect(after).toMatchObject({ start: 120, inPoint: 600, duration: 83, speed: 2 })
    expect(state().past).toHaveLength(1)
    expect(state().clipRun).toBeNull()
    // The clip now plays just the run: its rows are those two.
    expect(rowsHosts().filter((h) => h.props['data-row'] !== undefined)).toHaveLength(2)

    state().undo()
    expect(theClip()).toEqual(before)
  })

  it('a pick made over other words — the clip trimmed since — is not shown, and the cut is greyed again', () => {
    load()
    pressRow(1)
    expect(cutButton()?.props.disabled).toBe(false)
    // Trimmed on the timeline: the clip now plays from 22 s, so its words are other words.
    state().update((p) => ({ ...p, clips: p.clips.map((c) => (c.id === 'c' ? { ...c, inPoint: 660, duration: 600 } : c)) }))
    expect(cutButton()?.props.disabled).toBe(true)
    expect(panel()).toContain(CLIP_ROWS_HINT)
    expect(panel()).not.toMatch(/<\/span> selected/)
  })
})

describe('Edit', () => {
  it('corrects the clip’s word by the WHOLE transcript’s index — past the words before the clip, across a gap an emptied word left', () => {
    // "zulu." (index 0) emptied: nothing is renumbered, so a word's index is its position + 1 from here on.
    const gapped = withWordText(TALK, 0, '')
    expect(gapped.words[0].index).toBe(1)
    // From 20 s of source: the first row (16 s) is before the clip.
    load({ inPoint: 600 }, gapped)
    const words = clipWords(gapped, clipSourceWindow(theClip(), FPS))!
    expect(words.first).toBe(4)
    const list = hosts(createElement(EditClipWords, { clip: theClip(), transcript: gapped, words }))
    // The second row's "charlie", at 20 800 ms: position 2 in the clip's words, 6 in the whole, index 7.
    const charlie = list.find((h) => h.type === 'EditableWord' && (h.props.word as Word).startMs === 20_800)!
    expect((charlie.props.word as Word).index).toBe(2)
    ;(charlie.props.onEdit as (text: string) => void)('Charlie')
    const changed = state().project.transcripts.talk.words.filter((w) => w.text === 'Charlie')
    expect(changed.map((w) => [w.index, w.startMs])).toEqual([[7, 20_800]])
    // One correction, one undo step.
    expect(state().past).toHaveLength(1)
  })

  it('lists a word the clip’s edge cuts through — not one of its rows, but burned into its captions — and corrects it', () => {
    // From 20 200 ms of source: the second row's "alpha" (20 000–20 300) has its middle before the clip and its end inside it.
    load({ inPoint: 606 })
    const rowWords = played().words.map((w) => w.startMs)
    expect(rowWords).not.toContain(20_000)
    const listed = editing()
    expect(listed.map((w) => w.startMs)).toContain(20_000)
    expect(listed.map((w) => w.startMs).slice(1)).toEqual(rowWords)
    const html = renderToStaticMarkup(createElement(TranscriptBody, { clip: theClip(), transcript: TALK, editing: true }))
    expect(html).toContain('Click a word to correct it')
    // Corrected from here, it lands on the whole transcript's word: zulu, then the first row's four, so index 5.
    const alpha = hosts(createElement(TranscriptBody, { clip: theClip(), transcript: TALK, editing: true })).find(
      (h) => h.type === 'EditableWord' && (h.props.word as Word).startMs === 20_000
    )!
    ;(alpha.props.onEdit as (text: string) => void)('Alfa')
    expect(state().project.transcripts.talk.words.filter((w) => w.text === 'Alfa').map((w) => [w.index, w.startMs])).toEqual([[5, 20_000]])
  })
})
