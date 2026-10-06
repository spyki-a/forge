/**
 * A link's caption track as a Transcript — YouTube's json3, read without a
 * model (docs/CLIPS.md §7.2, built in M0, §3b.1).
 *
 * Measured with yt-dlp 2026.08.19 (docs/EFFECTS.md §40), and the shape this
 * file depends on:
 *
 *   ASR track (`<lang>-orig`)  one window event first (no segs); then word
 *       events, each `{tStartMs, dDurationMs, wWinId, segs}` with one word per
 *       seg, the first seg at `tStartMs` and the rest at `tStartMs + tOffsetMs`;
 *       `acAsrConf` 0 on every word; between them `aAppend` events whose only
 *       seg is "\n". Events overlap (roll-up): 97–99% of consecutive word events
 *       end after the next begins, so an event's end is a DISPLAY end, not the
 *       end of its speech. Word starts never went backwards (0 of ~5,700
 *       events on six tracks). There is no word end at all.
 *   Uploader track (`<lang>`)  one seg per event: line timing only.
 *   No uploader track          `<lang>` comes back byte-identical to
 *       `<lang>-orig` (measured on six videos).
 *
 * So word ends are estimated, and that estimate is what makes pauses visible:
 * with `end = min(next start, event end)` the gap between words is about 0, the
 * 700 ms pause rule never fires, and an unpunctuated track can be one segment
 * for the whole talk — one of the four measured was (31 minutes); the others
 * came to 3, 5 and 70 segments for 2,000–9,000 words.
 */

import { PAUSE_BOUNDARY_MS, segmentIntoSentences, type Transcript, type Word } from '../transcript'

export type CaptionSource = 'youtube-asr' | 'youtube-lines'

/**
 * Milliseconds a grapheme is assumed to take, for a word's estimated end.
 *
 * Set by the three-track measurement (docs/EFFECTS.md §40): see there for the
 * start-to-start spacing per grapheme on each track and how many pauses each
 * value finds.
 */
export const GRAPHEME_MS = 80
/** No word is estimated longer than this, so a real pause after a long word stays a gap. */
export const WORD_MAX_MS = 600
/** A gap of at least this between two caption events ends a segment. */
export const EVENT_GAP_MS = PAUSE_BOUNDARY_MS
/** Every YouTube track is segmented under this cap (docs/CLIPS.md §7.2). */
export const SEGMENT_MAX_WORDS = 30
export const SEGMENT_MAX_MS = 15_000

/* ------------------------------------------------------------ graphemes */

type GraphemeSegmenter = { segment: (text: string) => Iterable<unknown> }
let segmenter: GraphemeSegmenter | null | undefined

/**
 * Grapheme clusters, not code points: a Devanagari or Telugu vowel sign is a
 * code point of its own and would double a Hindi word's estimate. One
 * segmenter, made once — a track is thousands of words.
 */
export function graphemeCount(text: string): number {
  if (segmenter === undefined) {
    const Segmenter = (
      Intl as unknown as {
        Segmenter?: new (locale?: string, options?: { granularity: string }) => GraphemeSegmenter
      }
    ).Segmenter
    segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null
  }
  if (!segmenter) return Array.from(text).length
  let n = 0
  for (const _ of segmenter.segment(text)) n++
  return n
}

/** How long a word is assumed to last: GRAPHEME_MS a grapheme, at most WORD_MAX_MS. */
export function wordEstimateMs(text: string, graphemeMs: number = GRAPHEME_MS): number {
  return Math.min(WORD_MAX_MS, graphemeCount(text) * graphemeMs)
}

/* ------------------------------------------------------------- reading */

interface Json3Seg {
  utf8?: unknown
  tOffsetMs?: unknown
  acAsrConf?: unknown
}

interface Json3Event {
  tStartMs?: unknown
  dDurationMs?: unknown
  segs?: unknown
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function eventsOf(json: unknown): Json3Event[] {
  const events = (json as { events?: unknown } | null)?.events
  return Array.isArray(events) ? events.filter((e): e is Json3Event => typeof e === 'object' && e !== null) : []
}

function segsOf(event: Json3Event): Json3Seg[] {
  return Array.isArray(event.segs) ? event.segs.filter((s): s is Json3Seg => typeof s === 'object' && s !== null) : []
}

/** An event's text, its segs joined: an uploader's line. */
function textOf(event: Json3Event): string {
  return segsOf(event)
    .map((s) => (typeof s.utf8 === 'string' ? s.utf8 : ''))
    .join('')
}

/**
 * Bracket tags — `[Music]`, `[Applause]`, `[संगीत]`, and YouTube's censored
 * `[ __ ]` — are not words anyone said in that form, and are dropped.
 */
const BRACKET_TAG = /\[[^\]]*\]/g
/** A token of punctuation alone (a danda after a space) belongs to the word before it. */
const PUNCTUATION_ONLY = /^\p{P}+$/u
/** Anything with no letter, mark, number or punctuation in it (♪) is not a word. */
const WORDLIKE = /[\p{L}\p{M}\p{N}\p{P}]/u

function tokensOf(text: string): string[] {
  return text
    .replace(BRACKET_TAG, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && WORDLIKE.test(t))
}

/**
 * Which kind of track this is, from its contents rather than its key.
 *
 * Measured: ASR segs carry `tOffsetMs` (every word after an event's first) or
 * `acAsrConf` (every word), an uploader track's never do. The key cannot say:
 * `<lang>` is the uploader's track when one exists and a copy of the ASR when
 * not. Null for a track with no words.
 */
export function json3Kind(json: unknown): 'asr' | 'lines' | null {
  let words = false
  for (const event of eventsOf(json)) {
    for (const seg of segsOf(event)) {
      if ('tOffsetMs' in seg || 'acAsrConf' in seg) return 'asr'
      if (typeof seg.utf8 === 'string' && tokensOf(seg.utf8).length > 0) words = true
    }
  }
  return words ? 'lines' : null
}

interface RawWord {
  text: string
  startMs: number
  /** The latest this word may end: the event's end for ASR; the end of its share of the line for a spread line. */
  boundMs: number
  /** Which event it came from, for the event-gap rule. */
  event: number
}

/** Spread tokens over [startMs, endMs) by grapheme count; each gets its share. */
function spread(tokens: string[], startMs: number, endMs: number, event: number): RawWord[] {
  const weights = tokens.map((t) => Math.max(1, graphemeCount(t)))
  const total = weights.reduce((a, b) => a + b, 0)
  const span = Math.max(0, endMs - startMs)
  const out: RawWord[] = []
  let before = 0
  tokens.forEach((text, k) => {
    const s = startMs + (span * before) / total
    before += weights[k]
    out.push({ text, startMs: Math.round(s), boundMs: Math.round(startMs + (span * before) / total), event })
  })
  return out
}

/**
 * Glue a punctuation-only token onto the word before it ("है ।" reads as "है।").
 * One with no word before it is dropped: there is nothing to say it after.
 */
function glue(raw: RawWord[]): RawWord[] {
  const out: RawWord[] = []
  for (const word of raw) {
    if (PUNCTUATION_ONLY.test(word.text) && out.length > 0) {
      out[out.length - 1] = { ...out[out.length - 1], text: out[out.length - 1].text + word.text }
    } else if (!PUNCTUATION_ONLY.test(word.text)) {
      out.push(word)
    }
  }
  return out
}

export interface Json3Words {
  words: Word[]
  /** Positions after which an event gap of at least EVENT_GAP_MS falls. */
  breakAfter: Set<number>
  /** The last event's end: the video's length, as far as the track knows it. */
  durationMs: number
}

/**
 * The words of a json3 track, timed.
 *
 *   start  `tStartMs + (tOffsetMs ?? 0)` for an ASR word; an uploader line's
 *          words are spread over the line by grapheme count
 *   end    ASR: `min(next word's start, event end, start + estimate)`, the
 *          estimate GRAPHEME_MS a grapheme up to WORD_MAX_MS, so a real pause
 *          inside one roll-up event stays a gap. A spread line: the end of the
 *          word's share, which is the next word's start inside the line and
 *          the line's end for its last word — the spread already IS the
 *          estimate, and capping it again would invent pauses mid-line
 *   confidence  null, never 0: `acAsrConf` is 0 on every word, and the
 *          Transcript panel underlines anything under 0.5 as unsure
 */
export function json3Words(json: unknown, source: CaptionSource, graphemeMs: number = GRAPHEME_MS): Json3Words {
  const raw: RawWord[] = []
  const eventStart = new Map<number, number>()
  const eventEnd = new Map<number, number>()
  let durationMs = 0
  const events = eventsOf(json)

  /*
   * An uploader's line is spread no further than the next line's start.
   *
   * Lines can overlap on screen, and every word is sorted by its start below:
   * two overlapping lines spread to their own ends would interleave word by
   * word ("one two five three six…"). Capped at the next line, each line's
   * words stay together and in order. Measured: no two consecutive lines
   * overlapped on the two uploader tracks read (283 and 326 pairs), so on
   * them this changes nothing.
   */
  const lineTokens = source === 'youtube-lines' ? events.map((e) => tokensOf(textOf(e))) : []
  const nextLineStart = new Map<number, number>()
  if (source === 'youtube-lines') {
    const order = events
      .map((e, k) => ({ k, start: e.tStartMs }))
      .filter((x): x is { k: number; start: number } => finite(x.start) && lineTokens[x.k].length > 0)
      .sort((a, b) => a.start - b.start || a.k - b.k)
    order.forEach((line, n) => {
      if (n + 1 < order.length) nextLineStart.set(line.k, order[n + 1].start)
    })
  }

  events.forEach((event, k) => {
    if (!finite(event.tStartMs)) return
    const start = event.tStartMs
    const end = finite(event.dDurationMs) ? start + Math.max(0, event.dDurationMs) : null
    if (end !== null) durationMs = Math.max(durationMs, end)
    const segs = segsOf(event)
    const before = raw.length

    if (source === 'youtube-lines') {
      const tokens = lineTokens[k]
      if (tokens.length > 0) {
        const ownEnd = end ?? start + tokens.reduce((t, w) => t + wordEstimateMs(w, graphemeMs), 0)
        raw.push(...spread(tokens, start, Math.min(ownEnd, nextLineStart.get(k) ?? Infinity), k))
      }
    } else {
      const starts = segs.map((s) => start + (finite(s.tOffsetMs) ? s.tOffsetMs : 0))
      segs.forEach((seg, j) => {
        if (typeof seg.utf8 !== 'string') return
        const tokens = tokensOf(seg.utf8)
        if (tokens.length === 0) return
        if (tokens.length === 1) {
          raw.push({ text: tokens[0], startMs: starts[j], boundMs: end ?? Infinity, event: k })
          return
        }
        // Not seen in a measured track (one word a seg), but a seg is free text:
        // share its time among its words rather than stack them on one start.
        const segEnd = starts[j + 1] ?? end ?? starts[j] + tokens.reduce((t, w) => t + wordEstimateMs(w, graphemeMs), 0)
        for (const word of spread(tokens, starts[j], segEnd, k)) raw.push({ ...word, boundMs: end ?? Infinity })
      })
    }

    if (raw.length > before) {
      eventStart.set(k, start)
      if (end !== null) eventEnd.set(k, end)
    }
  })

  // Measured monotonic, but a stable sort costs nothing and a word that went
  // backwards would otherwise end before it started.
  const sorted = glue(raw.map((w, i) => ({ w, i })).sort((a, b) => a.w.startMs - b.w.startMs || a.i - b.i).map((x) => x.w))

  const words: Word[] = sorted.map((w, i) => {
    const next = sorted[i + 1]?.startMs ?? Infinity
    const estimate = source === 'youtube-asr' ? w.startMs + wordEstimateMs(w.text, graphemeMs) : Infinity
    const end = Math.min(next, w.boundMs, estimate)
    return {
      index: i,
      text: w.text,
      startMs: w.startMs,
      endMs: Number.isFinite(end) ? Math.max(w.startMs, end) : w.startMs + wordEstimateMs(w.text, graphemeMs),
      confidence: null
    }
  })

  /*
   * A gap between two caption events ends a segment.
   *
   * Derived, and measured to agree: every word's end is bounded by its event's
   * end and the next event's first word starts at that event's start, so the
   * word gap across two events is never smaller than the event gap, and the
   * pause rule already breaks there whenever the word ends are right (it added
   * no break on six real tracks, docs/EFFECTS.md §40). This is the break that
   * does not depend on them being right — with the ends set to the next start,
   * as CLIPS.md §7.2's first draft had them, it is the only one left between
   * events.
   */
  const breakAfter = new Set<number>()
  for (let i = 0; i + 1 < sorted.length; i++) {
    const here = sorted[i].event
    const there = sorted[i + 1].event
    if (here === there) continue
    const end = eventEnd.get(here)
    const start = eventStart.get(there)
    if (end !== undefined && start !== undefined && start - end >= EVENT_GAP_MS) breakAfter.add(i)
  }

  const lastEnd = words.length > 0 ? words[words.length - 1].endMs : 0
  return { words, breakAfter, durationMs: Math.max(durationMs, lastEnd) }
}

/** The segmentation every YouTube track gets: pauses, punctuation, event gaps, and the cap. */
function segmentTrack(words: Word[], breakAfter: ReadonlySet<number>): Transcript['segments'] {
  return segmentIntoSentences(words, PAUSE_BOUNDARY_MS, {
    maxWords: SEGMENT_MAX_WORDS,
    maxMs: SEGMENT_MAX_MS,
    breakAfter
  })
}

/**
 * One json3 track as a Transcript.
 *
 * `assetId` is whatever the caller keys it by; a link's transcript before any
 * download has no asset yet, and `shiftTranscript` re-keys it at collect.
 */
export function parseJson3(json: unknown, assetId: string, source: CaptionSource, language = 'und'): Transcript {
  const { words, breakAfter, durationMs } = json3Words(json, source)
  return {
    assetId,
    language,
    model: source,
    durationMs,
    words,
    segments: segmentTrack(words, breakAfter),
    ...(source === 'youtube-lines' ? { approximate: true } : {})
  }
}

/* ----------------------------------------------- which track wins (§16.12) */

interface Cue {
  startMs: number
  endMs: number
  tokens: string[]
}

/**
 * The uploader's lines in time order, their tokens glued the way `parseJson3`
 * glues a lone track's: a punctuation-only token — a danda set off by a space,
 * as typed Hindi often has it — joins the token before it (the previous line's
 * last when it opens a line). Unglued it would be a "word" whose text
 * normalises to nothing, which the LCS can never match, and one such token
 * marked a whole merge approximate. A line left with no token is dropped.
 */
function cuesOf(json: unknown): Cue[] {
  const cues: Cue[] = []
  for (const event of eventsOf(json)) {
    if (!finite(event.tStartMs)) continue
    const tokens = tokensOf(textOf(event))
    if (tokens.length === 0) continue
    const end = finite(event.dDurationMs) ? event.tStartMs + Math.max(0, event.dDurationMs) : event.tStartMs
    cues.push({ startMs: event.tStartMs, endMs: end, tokens })
  }
  cues.sort((a, b) => a.startMs - b.startMs)
  const out: Cue[] = []
  for (const cue of cues) {
    const tokens: string[] = []
    for (const token of cue.tokens) {
      if (!PUNCTUATION_ONLY.test(token)) tokens.push(token)
      else if (tokens.length > 0) tokens[tokens.length - 1] += token
      else if (out.length > 0) {
        const previous = out[out.length - 1].tokens
        previous[previous.length - 1] += token
      }
    }
    if (tokens.length > 0) out.push({ ...cue, tokens })
  }
  return out
}

const normal = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]/gu, '')

/** Longest common subsequence of two token lists, as matched index pairs in order. */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length
  const m = b.length
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] !== '' && a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const pairs: [number, number][] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] !== '' && a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) i++
    else j++
  }
  return pairs
}

/** How many lines either side a line's offset is the median of. */
const OFFSET_NEIGHBOURS = 8

/**
 * The uploader's lines moved onto the ASR's clock.
 *
 * Measured (docs/EFFECTS.md §40): on one of the two videos with both tracks,
 * every uploader line sat about 12.0 s BEFORE the same words in the ASR
 * (offsets p10/p50/p90 11,826 / 11,966 / 12,026 ms over 304 lines) while 97.6%
 * of its words were the ASR's words — captions made for a cut without the
 * intro, presumably. The ASR is made from the audio, so its clock is the
 * video's. Matching by the uploader's clock found 8.7% of the words.
 *
 * So each line's offset is estimated first: a line whose first three words
 * occur exactly once, in a row, in the ASR gives a candidate (that ASR run's
 * start minus the line's start), and each line takes the median candidate of
 * the lines around it — local, so a cut in the middle of the video moves only
 * the lines after it. With no candidates at all the clocks are taken as equal.
 */
function alignCues(cues: Cue[], asrWords: readonly Word[]): Cue[] {
  const key = (a: string, b: string, c: string): string | null => (a && b && c ? `${a}\u0001${b}\u0001${c}` : null)
  const asrNorm = asrWords.map((w) => normal(w.text))
  const seen = new Map<string, number>()
  for (let i = 0; i + 2 < asrNorm.length; i++) {
    const k = key(asrNorm[i], asrNorm[i + 1], asrNorm[i + 2])
    if (k) seen.set(k, seen.has(k) ? -1 : i)
  }
  const candidate = cues.map((cue): number | null => {
    const t = cue.tokens.map(normal).filter((x) => x !== '')
    const k = t.length >= 3 ? key(t[0], t[1], t[2]) : null
    const at = k ? seen.get(k) : undefined
    return at !== undefined && at >= 0 ? asrWords[at].startMs - cue.startMs : null
  })
  const all = candidate.filter((x): x is number => x !== null)
  if (all.length === 0) return cues
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
  }
  const global = median(all)
  return cues
    .map((cue, k) => {
      const near = candidate
        .slice(Math.max(0, k - OFFSET_NEIGHBOURS), k + OFFSET_NEIGHBOURS + 1)
        .filter((x): x is number => x !== null)
      const offset = near.length > 0 ? median(near) : global
      return { ...cue, startMs: cue.startMs + offset, endMs: cue.endMs + offset }
    })
    .sort((a, b) => a.startMs - b.startMs)
}

/**
 * `-orig` timing with the uploader's text (docs/CLIPS.md §16.12, taken as
 * recommended): the uploader's words, punctuated and spelled by a person, each
 * timed by the ASR word it matches.
 *
 * Matched line by line, once the lines are on the ASR's clock (`alignCues`).
 * Each ASR word belongs to the uploader line whose span holds its start (the
 * nearest line when none does); within a line the two
 * word lists are aligned by their longest common subsequence over lowercased,
 * unpunctuated text. A matched word takes its ASR word's start. An unmatched
 * one is placed between its matched neighbours (or the line's edges) by
 * grapheme count, and the transcript is then marked approximate. Ends follow
 * the ASR rule: the next start, or the grapheme estimate.
 *
 * An ASR word that starts EVENT_GAP_MS or more outside every line is speech
 * the uploader did not caption — an intro, an outro, a section left out — and
 * is kept as the ASR has it, text and times, in its place. Before, the output
 * was the uploader's words only, so such a stretch vanished from the rows
 * without a trace. Those words are word-timed, so they do not make the
 * transcript approximate; their stretch is its own segment.
 */
export function mergeTracks(asr: Transcript, linesJson: unknown, assetId: string, language = asr.language): Transcript {
  const asrWords = asr.words
  const cues = alignCues(cuesOf(linesJson), asrWords)
  if (cues.length === 0) return { ...asr, assetId, language }

  // reach[k]: the latest end among cues[0..k] — how far the lines so far cover.
  const reach: number[] = []
  cues.forEach((cue, k) => reach.push(Math.max(cue.endMs, k > 0 ? reach[k - 1] : -Infinity)))

  // Each ASR word to one cue, both lists in time order — or kept, uncovered.
  const owned: number[][] = cues.map(() => [])
  const kept: number[] = []
  let last = -1
  for (let w = 0; w < asrWords.length; w++) {
    const start = asrWords[w].startMs
    while (last + 1 < cues.length && cues[last + 1].startMs <= start) last++
    const fromEarlier = last >= 0 ? Math.max(0, start - reach[last]) : Infinity
    const toLater = last + 1 < cues.length ? cues[last + 1].startMs - start : Infinity
    if (Math.min(fromEarlier, toLater) >= EVENT_GAP_MS) {
      kept.push(w)
      continue
    }
    // Between cue `last`'s end and the next cue's start: the nearer of the two.
    let at = Math.max(0, last)
    if (
      last >= 0 &&
      start >= cues[last].endMs &&
      last + 1 < cues.length &&
      cues[last + 1].startMs - start < start - cues[last].endMs
    ) {
      at = last + 1
    }
    owned[at].push(w)
  }

  /** One output word: a line's token (`cue` ≥ 0) or a kept ASR word (`asr` ≥ 0). */
  interface Entry {
    text: string
    startMs: number
    endMs: number | null
    /** Lines sort as blocks, by their start; a kept word by its own. */
    key: number
    cue: number
    asr: number
  }
  const entries: Entry[] = []
  let unmatched = 0
  cues.forEach((cue, k) => {
    const mine = owned[k]
    const tokens = cue.tokens
    const pairs = lcsPairs(
      tokens.map(normal),
      mine.map((w) => normal(asrWords[w].text))
    )
    const anchor = new Map<number, number>(pairs.map(([u, a]) => [u, asrWords[mine[a]].startMs]))
    unmatched += tokens.length - anchor.size
    const anchored = [...anchor.keys()].sort((x, y) => x - y)

    /*
     * The edges an unmatched word can be placed between. The ASR's own words
     * in this line bound it where there are any — its clock, not the
     * uploader's, which can sit a second off — and the line's span where
     * there are none (then every word here is a spread, as on a lone
     * uploader track).
     */
    const est = (from: number, to: number): number =>
      tokens.slice(from, to).reduce((t, w) => t + wordEstimateMs(w), 0)
    let left = mine.length > 0 ? asrWords[mine[0]].startMs : cue.startMs
    let right = mine.length > 0 ? asrWords[mine[mine.length - 1]].endMs : cue.endMs
    if (anchored.length > 0) {
      const first = anchored[0]
      const lastAnchor = anchored[anchored.length - 1]
      left = Math.min(left, anchor.get(first)! - est(0, first))
      right = Math.max(right, anchor.get(lastAnchor)! + est(lastAnchor, tokens.length))
    }
    right = Math.max(right, left)

    // Fence posts — the anchors, with the edges as posts at -1 and n — and the
    // unmatched words between two posts share that span by grapheme count.
    const posts: { index: number; time: number }[] = [
      { index: -1, time: left },
      ...anchored.map((u) => ({ index: u, time: anchor.get(u)! })),
      { index: tokens.length, time: right }
    ]
    const starts = new Array<number>(tokens.length)
    for (const u of anchored) starts[u] = anchor.get(u)!
    for (let p = 0; p + 1 < posts.length; p++) {
      const a = posts[p]
      const b = posts[p + 1]
      if (b.index - a.index <= 1) continue
      const from = Math.max(0, a.index)
      const placed = spread(tokens.slice(from, b.index), a.time, Math.max(a.time, b.time), k)
      placed.forEach((word, t) => {
        if (from + t !== a.index) starts[from + t] = word.startMs
      })
    }
    tokens.forEach((text, u) => entries.push({ text, startMs: starts[u], endMs: null, key: cue.startMs, cue: k, asr: -1 }))
  })
  for (const w of kept) {
    const word = asrWords[w]
    entries.push({ text: word.text, startMs: word.startMs, endMs: word.endMs, key: word.startMs, cue: -1, asr: w })
  }

  // A kept word is EVENT_GAP_MS clear of every line, so it sorts between the
  // lines around it; a line's tokens stay together and in their order.
  const timed = entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.key - b.e.key || a.i - b.i)
    .map((x) => x.e)

  // Monotonic whatever the two clocks disagreed about at a line's edge.
  for (let i = 1; i < timed.length; i++) {
    if (timed[i].startMs < timed[i - 1].startMs) timed[i] = { ...timed[i], startMs: timed[i - 1].startMs }
  }

  const words: Word[] = timed.map((w, i) => {
    const next = timed[i + 1]?.startMs ?? Infinity
    const own = w.endMs ?? w.startMs + wordEstimateMs(w.text)
    return {
      index: i,
      text: w.text,
      startMs: w.startMs,
      endMs: Math.max(w.startMs, Math.min(next, own)),
      confidence: null
    }
  })

  /*
   * Breaks the words cannot show. The uploader's own line gaps are pauses too;
   * a line and a stretch it did not caption are apart by construction; and
   * among kept ASR words, the ASR's own segment ends stand.
   */
  const asrEnds = new Set(asr.segments.map((s) => s.wordEnd))
  const breakAfter = new Set<number>()
  for (let i = 0; i + 1 < timed.length; i++) {
    const a = timed[i]
    const b = timed[i + 1]
    if (a.cue >= 0 && b.cue >= 0) {
      if (a.cue !== b.cue && cues[b.cue].startMs - cues[a.cue].endMs >= EVENT_GAP_MS) breakAfter.add(i)
    } else if (a.cue >= 0 || b.cue >= 0) {
      breakAfter.add(i)
    } else if (asrEnds.has(asrWords[a.asr].index)) {
      breakAfter.add(i)
    }
  }

  return {
    assetId,
    language,
    model: 'youtube-asr+lines',
    durationMs: Math.max(asr.durationMs, words.length > 0 ? words[words.length - 1].endMs : 0),
    words,
    segments: segmentTrack(words, breakAfter),
    ...(unmatched > 0 ? { approximate: true } : {})
  }
}

/* ------------------------------------------------------ several tracks */

export interface CaptionTrack {
  /** yt-dlp's key: `en`, `en-orig`. */
  key: string
  /** Where main wrote it, under `userData/url/<linkKey>/`. */
  path: string
  kind: 'asr' | 'lines'
}

/** What `ingest:captions` hands the renderer. */
export interface CaptionFetch {
  linkKey: string
  /** The keys asked for, e.g. `['en', 'en-orig']`. */
  keys: string[]
  /** What yt-dlp wrote. Empty when the video has no captions in those languages. */
  tracks: CaptionTrack[]
  /** The rows' words, or null when there is no track. */
  transcript: Transcript | null
}

/**
 * The transcript from what was fetched: the ASR's timing with the uploader's
 * text where both exist (§16.12); otherwise whichever exists, the `-orig` ASR
 * first. Null when nothing has words.
 */
export function transcriptFromTracks(
  tracks: { key: string; kind: 'asr' | 'lines'; json: unknown }[],
  assetId: string,
  language: string
): Transcript | null {
  const asrTracks = tracks.filter((t) => t.kind === 'asr')
  const asr = asrTracks.find((t) => t.key.endsWith('-orig')) ?? asrTracks[0]
  const lines = tracks.find((t) => t.kind === 'lines')
  if (asr) {
    const timed = parseJson3(asr.json, assetId, 'youtube-asr', language)
    return lines ? mergeTracks(timed, lines.json, assetId, language) : timed
  }
  return lines ? parseJson3(lines.json, assetId, 'youtube-lines', language) : null
}

/* ------------------------------------------------- onto a ranged download */

/** A run of words, by `Word.index`, inclusive (docs/CLIPS.md §3b.2). */
export interface WordRun {
  from: number
  to: number
}

/**
 * The link's transcript, cut to what was downloaded and moved onto its clock.
 *
 * Captions are always in the ORIGINAL video's clock (measured: a 6 s section
 * still wrote the whole 18.7-minute json3), and a ranged file starts at the
 * range — exactly, for an exact cut (head offset 0), or `offsetIntoDownload`
 * early for a fast one. So every time moves by `range.startMs − headOffsetMs`.
 *
 * With a run, EXACTLY the run's words are kept — a run shorter than a second
 * is downloaded a little wider (MIN_RANGE_MS), and the neighbour that widening
 * reaches must not be collected as if it had been picked. Without one, the
 * words that START inside the range. Renumbered from 0 and re-segmented.
 */
export function shiftTranscript(
  t: Transcript,
  range: { startMs: number; endMs: number },
  headOffsetMs: number,
  assetId: string,
  run?: WordRun
): Transcript {
  const lo = Math.min(range.startMs, range.endMs)
  const hi = Math.max(range.startMs, range.endMs)
  const kept = run
    ? t.words.filter((w) => w.index >= run.from && w.index <= run.to)
    : t.words.filter((w) => w.startMs >= lo && w.startMs < hi)
  const shift = lo - headOffsetMs
  const words: Word[] = kept.map((w, i) => ({
    ...w,
    index: i,
    startMs: Math.max(0, w.startMs - shift),
    endMs: Math.max(0, w.endMs - shift)
  }))
  const { approximate, ...rest } = t
  return {
    ...rest,
    assetId,
    durationMs: Math.max(hi - lo + headOffsetMs, words.length > 0 ? words[words.length - 1].endMs : 0),
    words,
    segments: segmentIntoSentences(words, PAUSE_BOUNDARY_MS, { maxWords: SEGMENT_MAX_WORDS, maxMs: SEGMENT_MAX_MS }),
    ...(approximate ? { approximate } : {})
  }
}
