/**
 * A run of words picked from a transcript's rows — the two ways of picking it,
 * and what it downloads (docs/CLIPS.md §3b.2, §3b.3).
 *
 * Pure, and shared by both tiles that show rows: the URL tile's transcript of
 * a link, and (slice 3) a timeline clip's in the Transcript tile. A run is a
 * WORD range, so click and shift-click and the two cut handles all set the
 * same thing, and a chapter is just another way to name one.
 *
 * Word indices are `Word.index`, which every producer numbers by position
 * (`transcript.ts`: "Position in the transcript"; parseJson3, mergeTracks and
 * shiftTranscript all renumber from 0), so `t.words[i].index === i`.
 */

import { capSegments, type Transcript } from '../transcript'
import { SEGMENT_MAX_MS, SEGMENT_MAX_WORDS, type WordRun } from './captions'
import { MIN_RANGE_MS, type Range } from './section'

export type { WordRun }

/** One row: a capped segment, its words by index, inclusive. */
export interface TranscriptRow {
  startMs: number
  endMs: number
  words: [number, number]
  text: string
}

/*
 * Rows are computed from the transcript and never written back, so they are
 * kept per transcript object: a handle drag re-renders the rows on every
 * pointer move, and a talk is ten thousand words. Transcripts are never
 * mutated in place (a corrected word makes a new one), so identity is enough.
 */
const rowCache = new WeakMap<object, TranscriptRow[]>()

/**
 * The rows a transcript shows: `capSegments(t, 30, 15000)` (§7.2), each row's
 * word range clamped to the words that exist. Never written back.
 */
export function rowsOf(t: Transcript): TranscriptRow[] {
  const cached = rowCache.get(t)
  if (cached) return cached
  const last = t.words.length - 1
  const rows: TranscriptRow[] = []
  for (const segment of capSegments(t, SEGMENT_MAX_WORDS, SEGMENT_MAX_MS)) {
    const from = Math.max(0, segment.wordStart)
    const to = Math.min(last, segment.wordEnd)
    if (to < from) continue
    rows.push({ startMs: segment.startMs, endMs: segment.endMs, words: [from, to], text: segment.text })
  }
  rowCache.set(t, rows)
  return rows
}

/** The row holding a word, by binary search over the rows' word ranges; -1 when none does. */
export function rowOfWord(rows: readonly TranscriptRow[], word: number): number {
  let lo = 0
  let hi = rows.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [a, b] = rows[mid].words
    if (word < a) hi = mid - 1
    else if (word > b) lo = mid + 1
    else return mid
  }
  return -1
}

const clampIndex = (t: Transcript, i: number): number => Math.max(0, Math.min(t.words.length - 1, Math.round(i)))

/** A run inside the transcript, `from ≤ to`. */
export function clampRun(t: Transcript, run: WordRun): WordRun {
  const a = clampIndex(t, run.from)
  const b = clampIndex(t, run.to)
  return a <= b ? { from: a, to: b } : { from: b, to: a }
}

/** Click a row (`a === b`), or click one and shift-click another: every word of rows a..b, either order. */
export function runFromRows(t: Transcript, a: number, b: number): WordRun {
  const rows = rowsOf(t)
  const lo = Math.max(0, Math.min(rows.length - 1, Math.min(a, b)))
  const hi = Math.max(0, Math.min(rows.length - 1, Math.max(a, b)))
  return { from: rows[lo].words[0], to: rows[hi].words[1] }
}

/**
 * Shift-click a word: the run's start stays where it was picked from and its
 * end moves to the word — or, for a word before the start, the start moves
 * back to it. With no run yet, the word alone.
 */
export function extendRun(run: WordRun | null, word: number): WordRun {
  if (!run) return { from: word, to: word }
  return word >= run.from ? { from: run.from, to: word } : { from: word, to: run.to }
}

/** The index of the value in a non-decreasing list nearest to `ms` (the earlier on a tie). */
function nearest(values: (i: number) => number, n: number, ms: number): number {
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (values(mid) < ms) lo = mid + 1
    else hi = mid
  }
  // lo: the first at or after ms. The one before it may be nearer.
  if (lo >= n) return n - 1
  if (lo > 0 && ms - values(lo - 1) <= values(lo) - ms) return lo - 1
  return lo
}

/**
 * A cut handle dragged to `ms`: Start snaps to the nearest word START, End to
 * the nearest word END — words, not rows — and neither passes the other.
 *
 * Word starts never go backwards (measured, EFFECTS.md §40) and a word ends no
 * later than the next one starts (§7.2's estimate), so both lists are sorted
 * and a binary search finds the nearest.
 */
export function snapHandle(t: Transcript, which: 'start' | 'end', ms: number, run: WordRun): WordRun {
  const n = t.words.length
  if (n === 0) return run
  const current = clampRun(t, run)
  if (which === 'start') {
    const word = nearest((i) => t.words[i].startMs, n, ms)
    return { from: Math.min(word, current.to), to: current.to }
  }
  const word = nearest((i) => t.words[i].endMs, n, ms)
  return { from: current.from, to: Math.max(word, current.from) }
}

/** A handle moved one word by the keyboard, clamped the same way. */
export function stepHandle(t: Transcript, which: 'start' | 'end', delta: number, run: WordRun): WordRun {
  const current = clampRun(t, run)
  if (which === 'start') return { from: Math.max(0, Math.min(current.to, current.from + delta)), to: current.to }
  return { from: current.from, to: Math.min(t.words.length - 1, Math.max(current.from, current.to + delta)) }
}

/**
 * A chapter's words: those whose START lies in `[start, end)` — seconds, as
 * yt-dlp prints them. A word starting exactly at the chapter's end belongs to
 * the next chapter. Null when no word starts inside it.
 *
 * The bounds are rounded to whole ms, as word times are: `4.03 * 1000` is
 * 4030.0000000000005, which would put a word starting at 4030 ms outside the
 * chapter that starts there and inside the one before.
 */
export function runOfChapter(t: Transcript, ch: { start_time: number; end_time: number }): WordRun | null {
  const start = Math.round(ch.start_time * 1000)
  const end = Math.round(ch.end_time * 1000)
  const n = t.words.length
  const firstAtOrAfter = (ms: number): number => {
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (t.words[mid].startMs < ms) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const from = firstAtOrAfter(start)
  const to = firstAtOrAfter(end) - 1
  return from <= to ? { from, to } : null
}

/**
 * What a run downloads: its first word's start to its last word's end, as
 * §7.2 estimates the end — which never reaches the next word's start, so no
 * neighbour's sound is fetched. A run shorter than MIN_RANGE_MS is fetched
 * that long (a shorter range would be read as "the whole video"); that is the
 * MEDIA only — the collected transcript keeps exactly the run's words
 * (`shiftTranscript` with the run).
 */
export function runRange(t: Transcript, run: WordRun): Range {
  const r = clampRun(t, run)
  const startMs = t.words[r.from].startMs
  const endMs = Math.max(t.words[r.to].endMs, startMs + MIN_RANGE_MS)
  return { startMs, endMs }
}

/**
 * Where a pointer at `y` sits along the rows, in ms: the row under it (the
 * first or last when above or below them all), and the time that far through
 * the row. A row is a block of text, so its height stands for its span.
 */
export function msAtY(
  rows: readonly { top: number; bottom: number; startMs: number; endMs: number }[],
  y: number
): number | null {
  if (rows.length === 0) return null
  if (y <= rows[0].top) return rows[0].startMs
  const last = rows[rows.length - 1]
  if (y >= last.bottom) return last.endMs
  const row = rows.find((r) => y >= r.top && y < r.bottom) ?? rows.find((r) => y < r.top) ?? last
  const height = row.bottom - row.top
  const f = height > 0 ? Math.max(0, Math.min(1, (y - row.top) / height)) : 0
  return row.startMs + f * (row.endMs - row.startMs)
}
