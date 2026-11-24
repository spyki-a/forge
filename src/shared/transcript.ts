/**
 * Transcripts and word-level timing.
 *
 * Times are milliseconds into the SOURCE media, never timeline frames. A
 * transcript belongs to an asset, not to a project — storing frames would
 * silently corrupt every transcript the moment the project frame rate changed.
 * Conversion to frames happens where a transcript meets the timeline.
 */

import { claimTokens, numberSpans } from './director/claims'

export interface Word {
  /** Position in the transcript. Stable, and what emphasis ops reference. */
  index: number
  text: string
  startMs: number
  endMs: number
  confidence: number | null
}

/**
 * A sentence-ish span. These are the boundary IDs the director picks from: a
 * cut can never land mid-word because mid-word is not on the menu.
 * See docs/DIRECTOR.md §1.
 */
export interface Segment {
  /** Stable opaque id, e.g. "s47". */
  id: string
  startMs: number
  endMs: number
  text: string
  /** Inclusive range of word indices. */
  wordStart: number
  wordEnd: number
}

export interface Transcript {
  assetId: string
  language: string
  /** Model id and runtime, recorded so a later upgrade is visible. */
  model: string
  durationMs: number
  words: Word[]
  segments: Segment[]
  /**
   * Word times placed by an estimate rather than heard word by word: an
   * uploader's caption line spread over its words by grapheme count, or an
   * uploader word with no ASR word to take its time from
   * (`shared/ingest/captions.ts`). Absent means word-timed.
   */
  approximate?: boolean
}

/* ------------------------------------------------------- split numbers */

/** A word that ends in a digit: nothing after it, so no closing punctuation either. */
const ENDS_IN_DIGIT = /\p{Nd}$/u
/** A word that opens with a group separator and digits: ",500." ",200" ",000,". */
const GROUP_TAIL = /^,\p{Nd}/u
/** A word that is only a percent sign, with or without closing punctuation: "%", "%.", "%,". */
const PERCENT_ONLY = /^%[.,;:!?…"')\]]*$/u

/**
 * Join the number words the transcriber split (try-out 1, 2026-11-15).
 *
 * faster-whisper gives a grouped number as two words and a percent sign as a
 * word of its own: "$2" ",500." and "40" "%". Read as two words, "$2" ",500."
 * is $2 and a bare 500 (`claimTokens` closes the first word's number at the
 * comma), so a counter drew "$2"; and a caption shows "$2 ,500." with a space.
 *
 * Joined, each into one word:
 * - a word opening with a comma and digits, after a word that ends in a digit
 *   (and so carries no closing punctuation of its own), when the joined word
 *   reads as ONE number by the validator's own reader (`numberSpans` over
 *   `claimTokens`), so exactly the groupings it accepts are joined: western
 *   threes ("$2,500.") and Indian lakh grouping ("1,50,000"), never "2,50"
 *   or "2019,000". "$2, 500 people", where the comma closes the first word,
 *   is left: the first word does not end in a digit. A run split three ways
 *   ("$1" ",000" ",000") joins whole when each step reads as one number
 *   ("$1,000", then "$1,000,000"); a lakh number split three ways ("₹1" ",50"
 *   ",000") does not ("₹1,50" alone is not one number) and is left as it is.
 *   A tail never joins onto a word that is itself a leftover tail, so "1"
 *   ",2" ",000" stays three words rather than fusing ",2,000";
 * - a word that is only `%` (with or without closing punctuation) after a
 *   word that ends in a digit: "40" "%" is "40%".
 *
 * A joined word keeps the first word's start, the last word's end, and the
 * lower confidence of the two, or null when either is null: null is
 * "unknown" (a corrected word, an uploader's track), and the lower of a
 * known and an unknown is not known. Words come out indexed 0..n-1 in order.
 * Pure; joining twice changes nothing. A decimal split as "2" ".5" was not
 * seen and is left as it is.
 */
export function joinSplitNumbers(words: readonly Word[]): Word[] {
  const out: Word[] = []
  for (const word of words) {
    const prev = out[out.length - 1]
    const tailOntoHead = GROUP_TAIL.test(word.text) && !GROUP_TAIL.test(prev?.text ?? '') && readsAsOneNumber((prev?.text ?? '') + word.text)
    if (prev && ENDS_IN_DIGIT.test(prev.text) && (PERCENT_ONLY.test(word.text) || tailOntoHead)) {
      out[out.length - 1] = {
        ...prev,
        text: prev.text + word.text,
        endMs: Math.max(prev.endMs, word.endMs),
        confidence: prev.confidence === null || word.confidence === null ? null : Math.min(prev.confidence, word.confidence)
      }
      continue
    }
    out.push({ ...word })
  }
  return out.map((w, index) => (w.index === index ? w : { ...w, index }))
}

/** One word reads as exactly one number by the validator's reader (`director/claims.ts`). */
function readsAsOneNumber(text: string): boolean {
  return numberSpans(claimTokens(text)).length === 1
}

/** A pause at least this long ends a segment even without punctuation. */
export const PAUSE_BOUNDARY_MS = 700

/*
 * The Devanagari danda `।` and double danda `॥` end a sentence too.
 *
 * Measured (docs/EFFECTS.md §40): YouTube's Hindi ASR tracks end their
 * sentences with the danda — 909 of 13,872 words on one track, 566 and 595 on
 * two others, and not one `.` among them — so without it a Hindi track
 * segments on pauses alone. Whisper's Hindi output uses it as well. Stored
 * transcripts keep their segments: nothing re-segments on load.
 */
const SENTENCE_END = /[.!?…।॥]["')\]]*$/
/** Abbreviations whose trailing dot is not a sentence end. */
const ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.', 'st.',
  'vs.', 'etc.', 'e.g.', 'i.e.', 'inc.', 'ltd.', 'co.', 'approx.'
])

/** Whether a word closes a sentence: the rule segments are cut on, shared with Best clips (`bestclips/windows.ts`). */
export function endsSentence(text: string): boolean {
  const lower = text.toLowerCase()
  if (ABBREVIATIONS.has(lower)) return false
  // A single capital followed by a dot is an initial ("J." in "J. Smith").
  if (/^[A-Z]\.$/.test(text)) return false
  return SENTENCE_END.test(text)
}

/**
 * How long a segment may run, when a caller asks for a limit.
 *
 * `breakAfter` holds array positions (not `Word.index`) after which a segment
 * must end whatever the words say — a boundary the caller knows about and the
 * words do not, such as a gap between two caption events.
 */
export interface SegmentCap {
  maxWords?: number
  maxMs?: number
  breakAfter?: ReadonlySet<number>
}

/**
 * Split `words[from..to]` until every piece is within the cap, each time at the
 * piece's largest inter-word gap.
 *
 * The largest gap is the likeliest breath, so a capped boundary still falls
 * where the speaker paused rather than at an arbitrary count. Equal gaps — a
 * pause-free run, where every word ends on the next one's start — split
 * nearest the middle, so eighty such words become pieces of twenty rather than
 * seventy-nine single words peeled off the front. Returns inclusive position
 * ranges in order. A single word is never split, however long it lasts.
 */
function capRun(
  words: readonly Word[],
  from: number,
  to: number,
  maxWords: number,
  maxMs: number
): [number, number][] {
  const fits = (a: number, b: number): boolean =>
    b - a + 1 <= maxWords && words[b].endMs - words[a].startMs <= maxMs
  const out: [number, number][] = []
  const stack: [number, number][] = [[from, to]]
  while (stack.length > 0) {
    const [a, b] = stack.pop()!
    if (a === b || fits(a, b)) {
      out.push([a, b])
      continue
    }
    const middle = (a + b) / 2
    let at = a
    let best = -Infinity
    for (let i = a; i < b; i++) {
      const gap = words[i + 1].startMs - words[i].endMs
      if (gap > best || (gap === best && Math.abs(i - middle) < Math.abs(at - middle))) {
        best = gap
        at = i
      }
    }
    // Right first onto the stack, so the left piece is popped and emitted first.
    stack.push([at + 1, b], [a, at])
  }
  return out
}

/**
 * Group words into sentence-like segments.
 *
 * Splits on sentence punctuation, and on long pauses — speech often runs on
 * without punctuation, and a pause is a better cut point than an arbitrary word
 * count. Both rules operate on whole words, so a boundary can never fall inside
 * one.
 *
 * `cap` is OPTIONAL and off by default, so the Director's segments are exactly
 * what they were. A YouTube track asks for it (docs/CLIPS.md §7.2): an
 * unpunctuated caption track with no long pause would otherwise be one segment
 * for the whole talk. A run over the cap is split at its largest inter-word gap.
 */
export function segmentIntoSentences(
  words: Word[],
  pauseMs: number = PAUSE_BOUNDARY_MS,
  cap?: SegmentCap
): Segment[] {
  const segments: Segment[] = []
  if (words.length === 0) return segments

  const runs: [number, number][] = []
  let start = 0
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    const next = words[i + 1]
    if (
      endsSentence(word.text) ||
      (next && next.startMs - word.endMs >= pauseMs) ||
      (next && cap?.breakAfter?.has(i))
    ) {
      runs.push([start, i])
      start = i + 1
    }
  }
  if (start < words.length) runs.push([start, words.length - 1])

  const maxWords = cap?.maxWords ?? Infinity
  const maxMs = cap?.maxMs ?? Infinity
  for (const [from, to] of runs) {
    const pieces =
      maxWords === Infinity && maxMs === Infinity ? [[from, to] as [number, number]] : capRun(words, from, to, maxWords, maxMs)
    for (const [a, b] of pieces) {
      const slice = words.slice(a, b + 1)
      segments.push({
        id: `s${segments.length + 1}`,
        startMs: slice[0].startMs,
        endMs: slice[slice.length - 1].endMs,
        text: slice.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim(),
        wordStart: slice[0].index,
        wordEnd: slice[slice.length - 1].index
      })
    }
  }
  return segments
}

/**
 * Segments no longer than `maxWords` words or `maxMs` milliseconds, for rows
 * and menus — PURE, and never written back to a transcript.
 *
 * Every menu and stretch built over a transcript reads from this (docs/CLIPS.md
 * §7.2), so a Whisper transcript segmented before the cap existed, or one whose
 * segments were rebuilt by a word edit (`withWordText` does not cap), still
 * gives rows of a readable size. A segment within the cap comes back as the
 * same object; one over it is split at its largest inter-word gap, the pieces
 * keeping the segment's id with `.1`, `.2`… appended, so ids stay unique.
 *
 * It takes the transcript rather than `t.segments` alone because the split
 * point is a gap BETWEEN words, which segments do not carry.
 */
export function capSegments(
  t: { readonly words: readonly Word[]; readonly segments: readonly Segment[] },
  maxWords: number,
  maxMs: number
): Segment[] {
  const position = new Map<number, number>()
  t.words.forEach((w, i) => position.set(w.index, i))
  const out: Segment[] = []
  for (const segment of t.segments) {
    const from = position.get(segment.wordStart)
    const to = position.get(segment.wordEnd)
    if (from === undefined || to === undefined || to < from) {
      out.push(segment)
      continue
    }
    const pieces = capRun(t.words, from, to, maxWords, maxMs)
    if (pieces.length === 1) {
      out.push(segment)
      continue
    }
    pieces.forEach(([a, b], k) => {
      const slice = t.words.slice(a, b + 1)
      out.push({
        id: `${segment.id}.${k + 1}`,
        startMs: slice[0].startMs,
        endMs: slice[slice.length - 1].endMs,
        text: slice.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim(),
        wordStart: slice[0].index,
        wordEnd: slice[slice.length - 1].index
      })
    })
  }
  return out
}

/* ------------------------------------------------------------- editing */

/**
 * A word corrected by hand (FIX.md B3).
 *
 * The text changes and the timing stays — a misheard name is still said at
 * the same moment. An empty word is taken out. Indices are NOT renumbered:
 * they are what emphasis and captions reference, and a gap in them costs
 * nothing. The segments are rebuilt from the words, because an edit can add
 * or remove the full stop a sentence ends on; with the same boundaries the
 * segment ids come out the same. Captions read the transcript live, so they
 * follow in the preview and the export with nothing else to do. A corrected
 * word's confidence is unknown rather than the model's.
 */
export function withWordText(transcript: Transcript, index: number, text: string): Transcript {
  const clean = text.replace(/\s+/g, ' ').trim()
  const at = transcript.words.findIndex((w) => w.index === index)
  if (at < 0 || transcript.words[at].text === clean) return transcript
  const words = clean
    ? transcript.words.map((w, i) => (i === at ? { ...w, text: clean, confidence: null } : w))
    : transcript.words.filter((_, i) => i !== at)
  return { ...transcript, words, segments: segmentIntoSentences(words) }
}

/** Whisper reads at most 224 tokens of prompt; this keeps well inside it. */
export const VOCABULARY_MAX_CHARS = 600

/**
 * Names and words to listen for, as the text Whisper is primed with.
 *
 * faster-whisper's `initial_prompt` conditions the model on text it treats as
 * having come just before the audio, so spelling a name there makes it far
 * likelier to be heard as that name — the couple's names, a venue, a brand.
 * Commas or new lines separate the terms; nothing given, nothing sent.
 */
export function vocabularyPrompt(vocabulary: string | undefined): string | undefined {
  const terms = (vocabulary ?? '')
    .split(/[,\n]/)
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 0)
  if (terms.length === 0) return undefined
  return `${terms.join(', ')}.`.slice(0, VOCABULARY_MAX_CHARS)
}

/* ------------------------------------------------------------- queries */

export function wordsInRange(transcript: Transcript, startMs: number, endMs: number): Word[] {
  return transcript.words.filter((w) => w.endMs > startMs && w.startMs < endMs)
}

export function segmentById(transcript: Transcript, id: string): Segment | null {
  return transcript.segments.find((s) => s.id === id) ?? null
}

/** The word being spoken at a moment, for caption highlighting. */
export function wordAt(transcript: Transcript, ms: number): Word | null {
  return transcript.words.find((w) => ms >= w.startMs && ms < w.endMs) ?? null
}

export function transcriptText(transcript: Transcript): string {
  return transcript.segments.map((s) => s.text).join(' ')
}

/**
 * Nearest segment boundary to a time — the snap that turns an approximate
 * intent into a frame-accurate cut.
 */
export function nearestBoundaryMs(transcript: Transcript, ms: number): number {
  let best = ms
  let bestDistance = Infinity
  for (const segment of transcript.segments) {
    for (const candidate of [segment.startMs, segment.endMs]) {
      const distance = Math.abs(candidate - ms)
      if (distance < bestDistance) {
        bestDistance = distance
        best = candidate
      }
    }
  }
  return best
}
