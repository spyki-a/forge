/**
 * Best clips' signals, the prefilter, the condensed text and the no-model
 * answer's material (docs/CLIPS.md §7.4). Pure: no `node:`, no Electron, no
 * renderer import.
 *
 * SIX SIGNALS, each a value in [0, 1] with its own plain reason line, or ABSENT
 * (null) when its input is missing. A window's score is the weighted mean of
 * the signals that are PRESENT: an absent signal's weight is left out of both
 * the sum and the divisor, never counted as a zero. So a video with no heatmap
 * is ranked by its other five signals exactly as a video whose heatmap is flat
 * would be (a flat heatmap adds the same term to every window: the order does
 * not change), and a transcript with no Latin punctuation or no English is
 * ranked by the signals it does have, not pulled down for its script.
 *
 * WHICH SIGNALS APPLY is decided once per transcript (`transcriptTraits`), so
 * every window of one video is scored on the same set: scores only ever
 * compare windows of one video, and a script never competes with another. The
 * one per-window exception is the heatmap, absent for a window it covers less
 * than half of.
 *
 * - heat: the time-weighted mean of YouTube's "Most replayed" values over the
 *   window. Absent with no heatmap (most videos have none: 4 of 8 measured).
 * - density: words a minute against the median window's. Compared within the
 *   video, so a script that writes more or fewer words for the same speech is
 *   neither rewarded nor punished. Always present when there are words.
 * - ending: whether the window ends on sentence-final punctuation (`.`, `!`,
 *   `?`, `…`, the danda). Present only when the transcript is punctuated (at
 *   least PUNCTUATED_SHARE of its capped segments end on such a mark);
 *   an unpunctuated ASR track has no full stop to end on, and is not marked
 *   down for it.
 * - opening: a penalty for a window that opens on an English connective
 *   ("and", "so", "but", "or", "because"). Present only when the transcript
 *   has English to look for (ENGLISH_MIN_SHARE of its words are connectives or
 *   "you" words). There is no list for Hindi or Telugu (open: the owner's to
 *   give), so such a transcript has no opening signal rather than a zero.
 * - hook: the window's first sentence opens on a question, a number or direct
 *   address. A NUMBER is any decimal digit in any script (`\p{Nd}`: 0-9, the
 *   Devanagari and Telugu digits alike), so it applies everywhere. A QUESTION
 *   (the first sentence ends on `?`) counts only in a punctuated transcript.
 *   DIRECT ADDRESS ("you", "your"…) counts only in a transcript with English
 *   (the same gate as the opening). An unpunctuated, caseless transcript with
 *   no English therefore gets the number check alone. No rule here reads a
 *   capital letter.
 * - quiet: the share of the window spent in a pause of QUIET_GAP_MS or more
 *   between words (`[Music]`-style tags are dropped at parse, so music is a
 *   gap). Always present.
 *
 * Nothing here reads a locale, the clock or a random source: lower-casing is
 * `toLowerCase` (locale-free), every sort has a total, numeric comparator.
 */

import type { LinkHeat } from '../ingest/args'
import { endsSentence, type Segment, type Transcript, type Word } from '../transcript'
import {
  clipSegments,
  segmentEndsSentence,
  shortfallNote,
  windowsOver,
  wordPositions,
  DEFAULT_TOLERANCE,
  type ClipWindow
} from './windows'

/* ------------------------------------------------------------ constants */

export type SignalName = 'heat' | 'density' | 'ending' | 'opening' | 'hook' | 'quiet'
/** The fixed order: reason lines are listed in it, and a tie for the strongest goes to the earlier. */
export const SIGNAL_ORDER: readonly SignalName[] = ['heat', 'density', 'ending', 'opening', 'hook', 'quiet']

/**
 * The weights of the weighted mean. The heatmap is what viewers actually did,
 * so it counts most; density and quiet say whether there is talk to post;
 * the three text checks are tie-breakers of equal weight.
 */
export const SIGNAL_WEIGHTS: Readonly<Record<SignalName, number>> = {
  heat: 3,
  density: 1.5,
  ending: 1,
  opening: 1,
  hook: 1,
  quiet: 1.5
}

/** A transcript is "punctuated" when at least this share of its capped segments end on a sentence mark. */
export const PUNCTUATED_SHARE = 0.2
/** A transcript "has English" when at least this share of its words (and at least ENGLISH_MIN_COUNT) are connectives or "you" words. */
export const ENGLISH_MIN_SHARE = 0.01
export const ENGLISH_MIN_COUNT = 3
/** The connectives a window should not open on (the plan's three, and two more of the same kind). */
export const CONNECTIVES: ReadonlySet<string> = new Set(['and', 'so', 'but', 'or', 'because'])
/** Direct address. */
export const ADDRESS: ReadonlySet<string> = new Set(['you', "you're", 'your', 'yours', "you've", "you'll", "you'd", 'yourself'])
/** A pause this long between two words is a quiet stretch (music, silence). */
export const QUIET_GAP_MS = 2000
/** A window this quiet or quieter scores 0 on quiet. */
export const QUIET_ZERO_SHARE = 0.5
/** The heatmap counts for a window only if its buckets cover at least this share of it. */
export const HEAT_MIN_COVER = 0.5
/** Heat values this close across all windows are "flat": no window is called the most replayed. */
export const HEAT_FLAT_SPREAD = 0.05

/** At most this many windows go to the model (§7.4). */
export const MAX_CANDIDATES = 24
/** Two windows overlap too much when their shared time is more than this share of the SHORTER one. */
export const MAX_OVERLAP = 0.5

/**
 * The condensed text's budget, in UTF-16 characters: 80 tokens at 3.0
 * characters a token, the LOW end of the 3.0-3.55 measured on Gemma 4 E2B
 * (§7.4), so the text stays within ~80 tokens at either end (~68 at 3.55).
 * Measured on English spine runs only: Devanagari and Telugu tokenise
 * differently (open).
 */
export const CONDENSED_MAX_CHARS = 240
/** The no-model title: the first sentence cut to this many graphemes (§7.4). */
export const TITLE_MAX_GRAPHEMES = 40
const ELLIPSIS = '…'
/** Between the first two sentences and the densest one in the condensed text. */
const CONDENSED_GAP = ' … '

/* ---------------------------------------------------------------- types */

export interface Signal {
  /** 0..1, higher is better. */
  value: number
  /** A plain line a card can show. */
  reason: string
}

export type Signals = Record<SignalName, Signal | null>

export interface TranscriptTraits {
  /** Enough sentence marks to judge an ending and a question by. */
  punctuated: boolean
  /** Enough English connectives or "you" words to look for them. */
  english: boolean
}

export interface ScoredWindow {
  window: ClipWindow
  signals: Signals
  /** The weighted mean of the present signals, 0..1. */
  score: number
  /** The strongest present signal's reason line (weight × value; ties to the earlier in SIGNAL_ORDER). */
  why: string
}

export interface ClipCandidate extends ScoredWindow {
  id: string
  /** Every present signal's reason line, in SIGNAL_ORDER. */
  reasons: string[]
  /** The window's first sentence, whole. */
  firstSentence: string
  /** The no-model title: the first sentence cut to TITLE_MAX_GRAPHEMES. */
  title: string
  /** What the model reads: the first two sentences and the densest, within CONDENSED_MAX_CHARS. */
  condensed: string
}

export interface Candidates {
  targetMs: number
  /** Every window, in id order: what turns a picked id into ms. */
  windows: ClipWindow[]
  /** At most MAX_CANDIDATES, best first, none overlapping another by more than MAX_OVERLAP. */
  candidates: ClipCandidate[]
  /** Why there are fewer than three, in plain words; null when there are three or more. */
  note: string | null
}

export interface SignalsPick {
  id: string
  window: ClipWindow
  title: string
  why: string
}

/* ------------------------------------------------------------- the words */

/** A word as compared against the lists: lower-cased (locale-free), curly apostrophe made straight, outer punctuation off. */
export function bareWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

export function transcriptTraits(words: readonly Word[], segs: readonly Segment[]): TranscriptTraits {
  const ended = segs.reduce((n, s) => n + (segmentEndsSentence(s) ? 1 : 0), 0)
  let english = 0
  for (const w of words) {
    const bare = bareWord(w.text)
    if (CONNECTIVES.has(bare) || ADDRESS.has(bare)) english++
  }
  return {
    punctuated: segs.length > 0 && ended / segs.length >= PUNCTUATED_SHARE,
    english: english >= ENGLISH_MIN_COUNT && english / Math.max(1, words.length) >= ENGLISH_MIN_SHARE
  }
}

/* ------------------------------------------------------------ the context */

interface Prepared {
  t: Transcript
  segs: Segment[]
  segAt: Map<string, number>
  position: Map<number, number>
  traits: TranscriptTraits
}

function prepare(t: Transcript): Prepared {
  const segs = clipSegments(t)
  const segAt = new Map<string, number>()
  segs.forEach((s, i) => segAt.set(s.id, i))
  return { t, segs, segAt, position: wordPositions(t.words), traits: transcriptTraits(t.words, segs) }
}

/** The window's words, by position. */
function windowWords(p: Prepared, w: ClipWindow): Word[] {
  const from = p.position.get(p.segs[p.segAt.get(w.segFrom)!].wordStart)
  const to = p.position.get(p.segs[p.segAt.get(w.segTo)!].wordEnd)
  return from === undefined || to === undefined ? [] : p.t.words.slice(from, to + 1)
}

export interface Sentence {
  text: string
  startMs: number
  endMs: number
  words: number
}

function sentenceOf(words: readonly Word[]): Sentence {
  return {
    text: words.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim(),
    startMs: words[0].startMs,
    endMs: words[words.length - 1].endMs,
    words: words.length
  }
}

/**
 * A window's sentences. Punctuated: its words split after each sentence mark.
 * Unpunctuated: its capped segments, each one "sentence" (a pause, an event
 * gap or the 30-word cap made them), since there is no mark to split on.
 */
function windowSentences(p: Prepared, w: ClipWindow): Sentence[] {
  if (!p.traits.punctuated) {
    const out: Sentence[] = []
    for (let i = p.segAt.get(w.segFrom)!; i <= p.segAt.get(w.segTo)!; i++) {
      const s = p.segs[i]
      const from = p.position.get(s.wordStart)
      const to = p.position.get(s.wordEnd)
      if (from !== undefined && to !== undefined && to >= from) out.push(sentenceOf(p.t.words.slice(from, to + 1)))
    }
    return out
  }
  const words = windowWords(p, w)
  const out: Sentence[] = []
  let start = 0
  words.forEach((word, i) => {
    if (endsSentence(word.text) || i === words.length - 1) {
      out.push(sentenceOf(words.slice(start, i + 1)))
      start = i + 1
    }
  })
  return out
}

/* ---------------------------------------------------------- the signals */

/** The time-weighted mean heat over [startMs, endMs), or null when the buckets cover less than HEAT_MIN_COVER of it. */
export function heatOver(heatmap: readonly LinkHeat[] | null, startMs: number, endMs: number): number | null {
  if (!heatmap || heatmap.length === 0 || !(endMs > startMs)) return null
  let covered = 0
  let sum = 0
  for (const b of heatmap) {
    const overlap = Math.min(endMs, b.end_time * 1000) - Math.max(startMs, b.start_time * 1000)
    if (overlap <= 0 || !Number.isFinite(b.value)) continue
    covered += overlap
    sum += overlap * Math.min(1, Math.max(0, b.value))
  }
  return covered >= HEAT_MIN_COVER * (endMs - startMs) ? sum / covered : null
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

function endingReason(text: string): string {
  const bare = text.replace(/["')\]]+$/, '')
  if (bare.endsWith('?')) return 'ends on a question'
  if (bare.endsWith('.') || bare.endsWith('।') || bare.endsWith('॥')) return 'ends on a full stop'
  return 'ends at the end of a sentence'
}

/**
 * Every window's signals, in window order. `windows` must come from this
 * transcript (`windowsFor` / `windowsOver`).
 */
function signalsOver(p: Prepared, windows: readonly ClipWindow[], heatmap: readonly LinkHeat[] | null): Signals[] {
  const wpm = windows.map((w) => (w.endMs > w.startMs ? (w.words * 60_000) / (w.endMs - w.startMs) : 0))
  const typicalWpm = median(wpm)
  const heats = windows.map((w) => heatOver(heatmap, w.startMs, w.endMs))
  const present = heats.filter((h): h is number => h !== null)
  const heatMax = present.length ? Math.max(...present) : 0
  const heatMin = present.length ? Math.min(...present) : 0
  const heatMid = median(present)
  const flat = heatMax - heatMin < HEAT_FLAT_SPREAD

  return windows.map((w, k): Signals => {
    const words = windowWords(p, w)
    const lastSeg = p.segs[p.segAt.get(w.segTo)!]
    const sentences = windowSentences(p, w)

    const h = heats[k]
    const heat: Signal | null =
      h === null
        ? null
        : {
            value: h,
            reason: flat
              ? 'replayed about as much as the rest'
              : h === heatMax
                ? 'the most replayed part'
                : h > heatMid
                  ? 'replayed more than most of the video'
                  : 'replayed less than other parts'
          }

    const ratio = typicalWpm > 0 ? wpm[k] / typicalWpm : 0
    const density: Signal | null =
      typicalWpm > 0
        ? {
            value: clamp01(ratio - 0.5),
            reason: ratio >= 1.15 ? 'dense: more words a minute than most of the video' : ratio <= 0.85 ? 'slower than most of the video' : 'talked at the usual pace'
          }
        : null

    const ends = segmentEndsSentence(lastSeg)
    const ending: Signal | null = p.traits.punctuated
      ? { value: ends ? 1 : 0, reason: ends ? endingReason(lastSeg.text) : 'stops in the middle of a sentence' }
      : null

    const first = words.length ? bareWord(words[0].text) : ''
    const opening: Signal | null = p.traits.english
      ? CONNECTIVES.has(first)
        ? { value: 0, reason: `starts on "${first}", in the middle of a thought` }
        : { value: 1, reason: 'starts at the beginning of a thought' }
      : null

    const firstSentence = sentences[0]?.text ?? ''
    const question = p.traits.punctuated && /\?["')\]]*$/.test(firstSentence)
    const number = /\p{Nd}/u.test(firstSentence)
    const address = p.traits.english && firstSentence.split(' ').some((x) => ADDRESS.has(bareWord(x)))
    const hook: Signal = question
      ? { value: 1, reason: 'opens with a question' }
      : number
        ? { value: 1, reason: 'opens with a number' }
        : address
          ? { value: 1, reason: 'speaks straight to the viewer from the start' }
          : { value: 0, reason: 'no hook in the first sentence' }

    let quietMs = 0
    for (let i = 1; i < words.length; i++) {
      const gap = words[i].startMs - words[i - 1].endMs
      if (gap >= QUIET_GAP_MS) quietMs += gap
    }
    const share = w.endMs > w.startMs ? quietMs / (w.endMs - w.startMs) : 0
    const quiet: Signal = {
      value: clamp01(1 - share / QUIET_ZERO_SHARE),
      reason: share >= 0.15 ? 'has long stretches with no talking' : 'talking nearly all the way through'
    }

    return { heat, density, ending, opening, hook, quiet }
  })
}

/** The weighted mean of the present signals; 0 when none is present. An absent signal's weight is not counted. */
export function scoreOf(signals: Signals): number {
  let sum = 0
  let weight = 0
  for (const name of SIGNAL_ORDER) {
    const s = signals[name]
    if (!s) continue
    sum += SIGNAL_WEIGHTS[name] * s.value
    weight += SIGNAL_WEIGHTS[name]
  }
  return weight > 0 ? sum / weight : 0
}

/** The strongest present signal's reason: the largest weight × value, ties to the earlier in SIGNAL_ORDER. */
export function strongestReason(signals: Signals): string {
  let best: string | null = null
  let bestScore = -Infinity
  for (const name of SIGNAL_ORDER) {
    const s = signals[name]
    if (!s) continue
    const v = SIGNAL_WEIGHTS[name] * s.value
    if (v > bestScore) {
      bestScore = v
      best = s.reason
    }
  }
  return best ?? ''
}

/** Score every window of a transcript, in window order. */
export function scoreWindows(t: Transcript, windows: readonly ClipWindow[], heatmap: readonly LinkHeat[] | null): ScoredWindow[] {
  const p = prepare(t)
  return scoreWith(p, windows, heatmap)
}

function scoreWith(p: Prepared, windows: readonly ClipWindow[], heatmap: readonly LinkHeat[] | null): ScoredWindow[] {
  return signalsOver(p, windows, heatmap).map((signals, k) => ({
    window: windows[k],
    signals,
    score: scoreOf(signals),
    why: strongestReason(signals)
  }))
}

/* --------------------------------------------------------- the prefilter */

/** Shared time as a share of the SHORTER window (0 when they do not meet). */
export function overlapShare(a: Pick<ClipWindow, 'startMs' | 'endMs'>, b: Pick<ClipWindow, 'startMs' | 'endMs'>): number {
  const shared = Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs)
  const shorter = Math.min(a.endMs - a.startMs, b.endMs - b.startMs)
  return shared <= 0 || shorter <= 0 ? 0 : shared / shorter
}

/**
 * Best first, at most `max`, none overlapping an earlier pick by more than
 * MAX_OVERLAP of the shorter (exactly half is allowed). Ties in score keep the
 * earlier window (by start), so the order is the same on every machine.
 */
export function prefilter<T extends ScoredWindow>(scored: readonly T[], max: number = MAX_CANDIDATES): T[] {
  const order = scored
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.score - a.s.score || a.s.window.startMs - b.s.window.startMs || a.i - b.i)
  const out: T[] = []
  for (const { s } of order) {
    if (out.length >= max) break
    if (out.every((o) => overlapShare(o.window, s.window) <= MAX_OVERLAP)) out.push(s)
  }
  return out
}

/* ------------------------------------------------------------- the text */

type GraphemeSegmenter = { segment: (text: string) => Iterable<{ segment: string }> }
let segmenter: GraphemeSegmenter | null | undefined

/** Grapheme clusters through `Intl.Segmenter` (as `graphics/items.ts` and `ingest/captions.ts` read them); code points where there is none. */
export function graphemes(text: string): string[] {
  if (segmenter === undefined) {
    const Segmenter = (Intl as { Segmenter?: new (locale?: string, options?: { granularity: string }) => GraphemeSegmenter })
      .Segmenter
    segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null
  }
  if (!segmenter) return Array.from(text)
  const out: string[] = []
  for (const part of segmenter.segment(text)) out.push(part.segment)
  return out
}

/**
 * `text` within `max` units (graphemes, or UTF-16 characters for a token
 * budget), the ellipsis counted inside. The cut is at the last space that
 * fits, so no word is broken; only a first word longer than the whole budget
 * (a script written without spaces, a run-on token) is cut at a grapheme
 * boundary, never inside a cluster.
 */
export function cutText(text: string, max: number, unit: 'graphemes' | 'chars'): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  const parts = graphemes(clean)
  const size = (g: string): number => (unit === 'chars' ? g.length : 1)
  const total = parts.reduce((n, g) => n + size(g), 0)
  if (total <= max) return clean
  if (max < 1) return ''
  const room = max - size(ELLIPSIS)
  let used = 0
  let taken = 0
  let lastSpace = -1
  while (taken < parts.length && used + size(parts[taken]) <= room) {
    if (parts[taken] === ' ') lastSpace = taken
    used += size(parts[taken])
    taken++
  }
  // The next grapheme being a space means the words taken end on a whole word.
  const end = taken < parts.length && parts[taken] === ' ' ? taken : lastSpace > 0 ? lastSpace : taken
  return parts.slice(0, end).join('').trimEnd() + ELLIPSIS
}

/** The no-model title: a sentence cut to TITLE_MAX_GRAPHEMES. */
export function titleOf(sentence: string): string {
  return cutText(sentence, TITLE_MAX_GRAPHEMES, 'graphemes')
}

/** Words a second, a sentence under a second counted as a second (so one quick word is not "densest"). */
const densityOf = (s: Sentence): number => s.words / Math.max(1, (s.endMs - s.startMs) / 1000)

/**
 * The condensed text the model reads (§7.4): the first two sentences, then
 * the densest of the REST (the densest overall may already be one of the
 * first two; the rest adds what they do not show), after " … ". The budget is
 * shared out in order, each part getting an even share of what is left, so a
 * short first sentence leaves room for the others. An unpunctuated window's
 * "sentences" are its capped segments.
 */
export function condense(sentences: readonly Sentence[], max: number = CONDENSED_MAX_CHARS): string {
  if (sentences.length === 0) return ''
  const parts: string[] = sentences.slice(0, 2).map((s) => s.text)
  let densest: Sentence | null = null
  for (const s of sentences.slice(2)) if (!densest || densityOf(s) > densityOf(densest)) densest = s
  // One space between the first two, and the gap before the densest.
  let left = max - (parts.length - 1) - (densest ? CONDENSED_GAP.length : 0)
  const all = densest ? [...parts, densest.text] : parts
  const cut: string[] = []
  all.forEach((text, k) => {
    const share = Math.floor(left / (all.length - k))
    const piece = cutText(text, Math.max(0, share), 'chars')
    cut.push(piece)
    left -= piece.length
  })
  const head = cut.slice(0, parts.length).filter((x) => x.length > 0).join(' ')
  return densest && cut[cut.length - 1] ? `${head}${CONDENSED_GAP}${cut[cut.length - 1]}` : head
}

/* ------------------------------------------------------------ the whole */

/**
 * The windows, their signals, the prefilter and each candidate's text, for a
 * transcript, a length and the link's heatmap (null when it has none).
 */
export function candidatesFor(
  t: Transcript,
  targetMs: number,
  heatmap: readonly LinkHeat[] | null,
  max: number = MAX_CANDIDATES
): Candidates {
  const p = prepare(t)
  const windows = targetMs > 0 ? windowsOver(p.segs, p.position, targetMs, DEFAULT_TOLERANCE) : []
  const kept = prefilter(scoreWith(p, windows, heatmap), max)
  const candidates = kept.map((s): ClipCandidate => {
    const sentences = windowSentences(p, s.window)
    const firstSentence = sentences[0]?.text ?? ''
    return {
      ...s,
      id: s.window.id,
      reasons: SIGNAL_ORDER.flatMap((n) => (s.signals[n] ? [s.signals[n]!.reason] : [])),
      firstSentence,
      title: titleOf(firstSentence),
      condensed: condense(sentences)
    }
  })
  return { targetMs, windows, candidates, note: shortfallNote(t, targetMs, Math.min(3, candidates.length)) }
}

/**
 * The no-model answer's three (§7.4): the top three candidates (already best
 * first and none overlapping another by more than half), each titled with its
 * first sentence cut to TITLE_MAX_GRAPHEMES, its strongest reason as the why.
 * Fewer when there are fewer, with the candidates' note saying why.
 */
export function signalsPicks(c: Candidates): { picks: SignalsPick[]; note: string | null } {
  return {
    picks: c.candidates.slice(0, 3).map((x) => ({ id: x.id, window: x.window, title: x.title, why: x.why })),
    note: c.note
  }
}
