import type { CompletionRequest, CompletionResult, LlmStatus } from '@shared/director/provider'
import type { LinkHeat } from '@shared/ingest/args'
import { PAUSE_BOUNDARY_MS, segmentIntoSentences, type Transcript, type Word } from '@shared/transcript'
import { CAP_MS, CAP_WORDS, clipSegments, lengthBand, DEFAULT_TOLERANCE, type ClipWindow } from '@shared/bestclips/windows'
import { candidatesFor, graphemes, MAX_OVERLAP, MOST_REPLAYED, overlapShare, windowText, type Candidates } from '@shared/bestclips/signals'
import {
  FILLED_NOTE,
  filledNote,
  MODEL_FAILED_NOTE,
  MODEL_SLOW_NOTE,
  MODEL_UNUSABLE_NOTE,
  NO_MODEL_NOTE,
  TITLE_EMPTY_NOTE,
  TITLE_FALLBACK_NOTE,
  WHY_EMPTY_NOTE,
  WHY_FALLBACK_NOTE,
  type BestClipsResult
} from '@shared/bestclips/run'
import { cardRange, cardWords, SCORED_BY_LABEL } from '@shared/bestclips/session'

/**
 * Best clips' harness cases (docs/CLIPS.md §7.7, the cards half): made-up
 * transcripts and a MODEL STUB, and what each case must show, for run A's
 * rules 1 to 26 (tests/output/_session-keep/step4-run-a-facts.md) that a page
 * can show. Pure: the harness check (bestClipsCheck.ts) drives the real store
 * and the real panel with these and reads the cards off the screen; the node
 * test (tests/renderer/bestClipsStub.test.ts) runs the same cases through
 * `bestClips` itself, so every expectation here is known to hold before
 * anyone opens a browser.
 *
 * NO ONE'S SPEECH. The words are made up: Latin nonsense, and a caseless
 * script's made-up runs (Georgian Mkhedruli code points, built from numbers,
 * never written as text), as run A's fixtures are. No Hindi or Telugu string
 * anywhere (the owner's rule).
 *
 * THE STUB answers as `askStructured` hands an answer over: a `complete` whose
 * text is the JSON. It reads the ids from the request's schema
 * (`picks.items.properties.id.enum`, the candidates best first) and how many
 * to give from `picks.minItems`; it reads nothing else of the request but the
 * schema, so a request the app shapes differently shows here. Its titles are
 * the picked window's own words (computed from the same transcript), or a
 * deliberately bad one, by mode.
 */

/* ------------------------------------------------------------ the words */

/** mulberry32: a seeded generator, so every run draws the same transcripts. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Spoken {
  text: string
  dur: number
  gap: number
}

function transcriptOf(spoken: readonly Spoken[], language: string): Transcript {
  let at = 0
  const words: Word[] = spoken.map((s, i) => {
    const w: Word = { index: i, text: s.text, startMs: at, endMs: at + s.dur, confidence: null }
    at += s.dur + s.gap
    return w
  })
  return {
    assetId: 'url:harness-best-clips',
    language,
    model: 'youtube-asr',
    durationMs: at,
    words,
    segments: segmentIntoSentences(words, PAUSE_BOUNDARY_MS, { maxWords: CAP_WORDS, maxMs: CAP_MS })
  }
}

const LATIN = ['zor', 'plim', 'tavek', 'mubo', 'senra', 'kilo', 'drav', 'oppen', 'vestra', 'nim', 'rulo', 'fesh', 'gandu', 'brel']
const latin = (i: number): string => LATIN[i % LATIN.length]

/** A made-up word in a caseless script: three Mkhedruli letters from U+10D0..U+10F0, built from numbers. */
export function caselessWord(i: number): string {
  return String.fromCharCode(0x10d0 + ((i * 7) % 33), 0x10d0 + ((i * 3 + 5) % 33), 0x10d0 + ((i * 11 + 2) % 33))
}

/** A four-letter caseless run: no window word is four letters, so it is said nowhere. */
export const MADE_UP_CASELESS = String.fromCharCode(0x10f0, 0x10d1, 0x10ef, 0x10d2)

/** Sentences of words: each word 280 ms with 60 ms between, 300 ms between sentences; `mark` closes each ('' unpunctuated). */
function talk(sentences: readonly (readonly string[])[], mark: string): Spoken[] {
  const out: Spoken[] = []
  for (const sentence of sentences) {
    sentence.forEach((text, k) => {
      const last = k === sentence.length - 1
      out.push({ text: last ? text + mark : text, dur: 280, gap: last ? 300 : 60 })
    })
  }
  return out
}

/** `n` sentences of `min`..`min + spread - 1` words from a vocabulary, drawn from a seed. */
function sentencesOf(n: number, vocab: (i: number) => string, seed: number, min = 8, spread = 7): string[][] {
  const r = rng(seed)
  return Array.from({ length: n }, () => Array.from({ length: min + Math.floor(r() * spread) }, () => vocab(Math.floor(r() * 400))))
}

/** A heatmap of 100 buckets over `seconds`. */
function heatOf(seconds: number, value: (i: number) => number): LinkHeat[] {
  return Array.from({ length: 100 }, (_, i) => ({ start_time: (seconds * i) / 100, end_time: (seconds * (i + 1)) / 100, value: value(i) }))
}

/** What one case puts in the URL tile: the words, the link's heatmap and language, and the length pressed. */
export interface StubLink {
  transcript: Transcript
  heatmap: LinkHeat[] | null
  /** The link's language as its details give it ('' when they name none). */
  language: string
  targetMs: number
}

/** A punctuated made-up talk of about nine minutes. */
export const stubTalk = (): Transcript => transcriptOf(talk(sentencesOf(140, latin, 21), '.'), 'en')
/** The same kind of talk, unpunctuated. */
export const stubPlain = (): Transcript => transcriptOf(talk(sentencesOf(150, latin, 22), ''), 'en')
/** A caseless, unpunctuated track: made-up Mkhedruli runs, no language named. */
export const stubCaseless = (): Transcript => transcriptOf(talk(sentencesOf(120, caselessWord, 23), ''), 'und')
/** Sentences of 40 to 50 words, punctuated: the 30-word cap splits each, so a window could start mid-sentence. */
export const stubLongSentences = (): Transcript => transcriptOf(talk(sentencesOf(36, latin, 24, 40, 11), '.'), 'en')
/** A punctuated talk of `sentences` sentences of 8..14 words (about 4 s each). */
export const stubShort = (sentences: number, seed: number): Transcript => transcriptOf(talk(sentencesOf(sentences, latin, seed), '.'), 'en')
/** Two words: a 2 s talk (`about 2 s`). */
export const stubTwoSeconds = (): Transcript =>
  transcriptOf(
    [
      { text: 'zor', dur: 900, gap: 200 },
      { text: 'plim.', dur: 900, gap: 0 }
    ],
    'en'
  )

const seconds = (t: Transcript): number => t.durationMs / 1000

/* ------------------------------------------------------------- the stub */

/** How the stub answers. */
export type StubMode =
  /** Three (minItems) picks of the first ids, each titled with its window's own words, each why opening "It". */
  | 'good'
  /** The first pick titled with a capitalised made-up name ("Kesmer …"). */
  | 'kesmer'
  /** The first pick's title has a number its window never says. */
  | 'number'
  /** Over the caseless track: the first title is window words in another order, the second a made-up run. */
  | 'caseless'
  /** One good pick, one off the menu, one the first again. */
  | 'mixed'
  /** Every pick carries startMs and endMs as well. */
  | 'extra'
  /** Titles of ~90 graphemes and whys of ~200, all window words. */
  | 'long'
  /** The first title says "about nine thousand", its why "about nine guests". */
  | 'nine'
  /** The first title is "…" and its why empty; the second title a zero-width space. */
  | 'empty'
  /** Over the caseless track: lower-case Latin titles. */
  | 'lower-latin'
  /** The first why names "Kesmer"; the second opens "It". */
  | 'kesmer-why'

/** A stub that throws, with a server's address and a key in its message: none of it may reach the screen. */
export const STUB_SECRET_URL = 'http://10.0.0.7:1234/v1/chat/completions'
export const STUB_SECRET_KEY = 'sk-harness-0000-not-a-real-key'
export const STUB_THROW_MESSAGE = `fetch failed: ${STUB_SECRET_URL} refused key ${STUB_SECRET_KEY}`

interface SchemaView {
  properties?: { picks?: { minItems?: number; items?: { properties?: { id?: { enum?: unknown } } } } }
}

/** The ids the request offers, best first, from its schema's enum. */
export function stubIds(request: CompletionRequest): string[] {
  const ids = (request.schema as SchemaView).properties?.picks?.items?.properties?.id?.enum
  if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === 'string')) throw new Error('best clips stub: the request has no id enum')
  return ids
}

/** How many picks the request asks for, from its schema's minItems. */
export function stubCount(request: CompletionRequest): number {
  const n = (request.schema as SchemaView).properties?.picks?.minItems
  if (typeof n !== 'number') throw new Error('best clips stub: the request has no minItems')
  return n
}

/** A window's words, bare: punctuation off the ends, in order. */
function bareWords(t: Transcript, w: ClipWindow): string[] {
  return windowText(t, w)
    .split(/\s+/u)
    .map((x) => x.replace(/^[\p{P}]+|[\p{P}]+$/gu, ''))
    .filter(Boolean)
}

/** `words` repeated and joined until `n` graphemes are reached. */
function atLeast(words: readonly string[], n: number): string {
  let out = ''
  for (let k = 0; graphemes(out).length < n; k++) out += (out ? ' ' : '') + words[k % words.length]
  return out
}

/** The answer's value for `mode`: ids from the schema, the count from minItems, words from the picked windows. */
export function stubValue(mode: StubMode, request: CompletionRequest, link: StubLink): { reasoning: string; picks: Record<string, unknown>[] } {
  const ids = stubIds(request)
  const count = stubCount(request)
  const c = candidatesFor(link.transcript, link.targetMs, link.heatmap)
  const windowOf = (id: string): ClipWindow => {
    const w = c.windows.find((x) => x.id === id)
    if (!w) throw new Error(`best clips stub: the schema offers ${id}, which is not a window of this transcript`)
    return w
  }
  const good = (id: string): Record<string, unknown> => {
    const words = bareWords(link.transcript, windowOf(id))
    return { id, title: words.slice(0, 4).join(' '), why: 'It is a stretch worth posting.' }
  }
  const picks = ids.slice(0, count).map(good)
  switch (mode) {
    case 'good':
      break
    case 'kesmer':
      picks[0] = { ...picks[0], title: `Kesmer ${picks[0].title as string}` }
      break
    case 'number':
      picks[0] = { ...picks[0], title: `47 ${picks[0].title as string}` }
      break
    case 'caseless': {
      const words = bareWords(link.transcript, windowOf(ids[0]))
      picks[0] = { ...picks[0], title: words.slice(0, 3).reverse().join(' ') }
      if (picks[1]) picks[1] = { ...picks[1], title: `${MADE_UP_CASELESS} ${bareWords(link.transcript, windowOf(ids[1]))[0]}` }
      break
    }
    case 'mixed':
      picks.splice(0, picks.length, good(ids[0]), { id: 'w99999', title: 'off the menu', why: 'It is not offered.' }, good(ids[0]))
      break
    case 'extra': {
      for (let k = 0; k < picks.length; k++) picks[k] = { ...picks[k], startMs: 0, endMs: 1000 }
      break
    }
    case 'long':
      for (let k = 0; k < picks.length; k++) {
        const words = bareWords(link.transcript, windowOf(ids[k]))
        picks[k] = { ...picks[k], title: atLeast(words, 90), why: `It ${atLeast(words, 200)}` }
      }
      break
    case 'nine':
      picks[0] = { ...picks[0], title: 'the hall cost about nine thousand', why: 'It has about nine guests crying.' }
      break
    case 'empty':
      picks[0] = { ...picks[0], title: '…', why: '' }
      if (picks[1]) picks[1] = { ...picks[1], title: '\u200B' }
      break
    case 'lower-latin':
      for (let k = 0; k < picks.length; k++) picks[k] = { ...picks[k], title: 'plim tavek mubo' }
      break
    case 'kesmer-why':
      picks[0] = { ...picks[0], why: 'Kesmer admits failure.' }
      if (picks[1]) picks[1] = { ...picks[1], why: 'It moves fast and ends well.' }
      break
  }
  return { reasoning: 'the harness stub', picks }
}

/** What a stub `complete` was asked: a check counts them. */
export interface StubCalls {
  n: number
}

/**
 * A `complete` (the bridge's `directorComplete`) answering as `mode` for
 * `link`; or one that throws with an address and a key; or one that never
 * answers.
 */
export function stubComplete(
  mode: StubMode | 'throws' | 'never',
  link: StubLink,
  calls: StubCalls = { n: 0 }
): (request: CompletionRequest) => Promise<CompletionResult> {
  return async (request) => {
    calls.n += 1
    if (mode === 'throws') throw new Error(STUB_THROW_MESSAGE)
    if (mode === 'never') return new Promise<never>(() => undefined)
    const text = JSON.stringify(stubValue(mode, request, link))
    return { text, provider: 'openai', model: 'harness-stub', promptTokens: null, outputTokens: null, durationMs: 1, truncated: false }
  }
}

/* ------------------------------------------------------------- the cases */

/** One card as the screen shows it (or as the node test reads it off the result). */
export interface SeenCard {
  windowId: string
  title: string
  why: string
  by: 'model' | 'signals'
  /** The "Picked by …" line as shown. */
  byLabel: string
  note: string | null
  range: string
  words: string
}

export interface SeenCards {
  cards: SeenCard[]
  note: string | null
  modelNote: string | null
}

/** A result as the panel would show it: what the node test compares against. */
export function seenOf(result: BestClipsResult): SeenCards {
  return {
    cards: result.cards.map((c) => ({
      windowId: c.windowId,
      title: c.title,
      why: c.why,
      by: c.scoredBy,
      byLabel: SCORED_BY_LABEL[c.scoredBy],
      note: c.note ?? null,
      range: cardRange(c),
      words: cardWords(c)
    })),
    note: result.note,
    modelNote: result.modelNote
  }
}

export interface StubCase {
  /** Run A's rule numbers it shows, then what. */
  name: string
  link: () => StubLink
  /** null: no model configured (the bridge's own status). */
  model: StubMode | 'throws' | 'never' | null
  /** Analyse pressed twice: the second press's cards must be the first's (rule 7). */
  twice?: boolean
  /** Failures, or []: what the screen showed against what the case wants. */
  expect: (seen: SeenCards, c: Candidates, t: Transcript) => string[]
}

/** The lines that are never a reason to post (run A's rule 8). */
export const NOT_A_WHY: readonly (string | RegExp)[] = [
  'replayed about as much as the rest',
  'replayed less than other parts',
  'talked at the usual pace',
  'slower than most of the video',
  'stops in the middle of a sentence',
  /^starts on "/u,
  'starts at the beginning of a thought',
  'no hook in the first sentence',
  'has long stretches with no talking'
]

const isNotAWhy = (why: string): boolean => NOT_A_WHY.some((x) => (typeof x === 'string' ? x === why : x.test(why)))

const fails = (...checks: [boolean, string][]): string[] => checks.filter(([ok]) => !ok).map(([, what]) => what)

/**
 * What every case's cards must hold (run A's rules 5 and 6, and "times come
 * from the windows"): at most three, in time order, each card's range and
 * word count its window's, "Picked by" in words, no two sharing more than
 * half of the shorter.
 */
export function commonChecks(seen: SeenCards, c: Candidates): string[] {
  const out: string[] = []
  if (seen.cards.length > 3) out.push(`${seen.cards.length} cards, more than 3`)
  const windows = seen.cards.map((card) => c.windows.find((w) => w.id === card.windowId))
  seen.cards.forEach((card, i) => {
    const w = windows[i]
    if (!w) return void out.push(`card ${i + 1} names ${card.windowId}, not a window of this transcript`)
    if (card.range !== cardRange(w)) out.push(`card ${i + 1} shows ${card.range}, not its window's ${cardRange(w)}`)
    if (card.words !== cardWords(w)) out.push(`card ${i + 1} shows ${card.words}, not its window's ${cardWords(w)}`)
    if (card.byLabel !== SCORED_BY_LABEL[card.by]) out.push(`card ${i + 1} reads "${card.byLabel}" for ${card.by}`)
    if (i > 0 && windows[i - 1] && windows[i - 1]!.startMs > w.startMs) out.push(`card ${i + 1} starts before card ${i}`)
  })
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const a = windows[i]
      const b = windows[j]
      if (a && b && overlapShare(a, b) > MAX_OVERLAP) out.push(`cards ${i + 1} and ${j + 1} share ${Math.round(overlapShare(a, b) * 100)} % of the shorter`)
    }
  }
  return out
}

/** Rule 1: every card starts on a row's start and ends on a row's end, within ±20 % of the length. */
function onRows(seen: SeenCards, c: Candidates, t: Transcript, targetMs: number): string[] {
  const segs = clipSegments(t)
  const starts = new Set(segs.map((s) => s.startMs))
  const ends = new Set(segs.map((s) => s.endMs))
  const band = lengthBand(targetMs, DEFAULT_TOLERANCE)
  const out: string[] = []
  if (seen.cards.length !== 3) out.push(`${seen.cards.length} cards at ${targetMs / 60_000} min, not 3`)
  for (const card of seen.cards) {
    const w = c.windows.find((x) => x.id === card.windowId)
    if (!w) continue
    if (!starts.has(w.startMs)) out.push(`${card.windowId} starts at ${w.startMs} ms, not on a row's start`)
    if (!ends.has(w.endMs)) out.push(`${card.windowId} ends at ${w.endMs} ms, not on a row's end`)
    const len = w.endMs - w.startMs
    if (len < targetMs * 0.8 - 1e-6 || len > targetMs * 1.2 + 1e-6 || len < band.lo - 1e-6 || len > band.hi + 1e-6) {
      out.push(`${card.windowId} runs ${len} ms, outside ±20 % of ${targetMs}`)
    }
  }
  return out
}

const allBy = (seen: SeenCards, by: 'model' | 'signals'): boolean => seen.cards.every((x) => x.by === by)

/** The talk's first word of a window, bare, and whether the word before it closed a sentence. */
function opensSentence(t: Transcript, w: ClipWindow): { first: string; atStart: boolean } {
  const at = t.words.findIndex((x) => x.startMs >= w.startMs)
  const first = (t.words[at]?.text ?? '').replace(/[\p{P}]+$/u, '')
  const before = at > 0 ? t.words[at - 1].text : null
  return { first, atStart: before === null || /[.?!]$/u.test(before) }
}

const latinTalk = (targetMs: number, heatmap: (t: Transcript) => LinkHeat[] | null = () => null): (() => StubLink) => () => {
  const transcript = stubTalk()
  return { transcript, heatmap: heatmap(transcript), language: 'en', targetMs }
}

/** The peak's buckets in `onePeak` (30 to 33 of 100). */
const PEAK = { from: 30, to: 34 }
const onePeak = (t: Transcript): LinkHeat[] => heatOf(seconds(t), (i) => (i >= PEAK.from && i < PEAK.to ? 1 : 0.3 + (i % 5) / 50))
const flatHeat = (t: Transcript): LinkHeat[] => heatOf(seconds(t), () => 0.6)
const variedHeat = (t: Transcript): LinkHeat[] => heatOf(seconds(t), (i) => 0.6 + ((i * 37) % 31) / 100)
/**
 * A plateau: buckets 10 to 89 all at the top, so every card's window sits on it. The values are 1 and 0.5, exact in binary, so
 * every window on the plateau means exactly 1 (0.95 measured 0.9499999999999998 on some windows, which then were not at the top).
 */
const plateau = (t: Transcript): LinkHeat[] => heatOf(seconds(t), (i) => (i >= 10 && i < 90 ? 1 : 0.5))

const titleCut = (title: string, max: number): boolean => graphemes(title).length <= max

export const BEST_CLIPS_STUB_CASES: readonly StubCase[] = [
  ...[60_000, 120_000, 180_000, 240_000].map(
    (targetMs): StubCase => ({
      name: `1, 6, 17: no model at ${targetMs / 60_000} min: three cards on the rows, within ±20 %, picked from the signals, the no-model note`,
      link: latinTalk(targetMs),
      model: null,
      expect: (seen, c, t) => [
        ...onRows(seen, c, t, targetMs),
        ...fails([allBy(seen, 'signals'), 'a card is not the signals’'], [seen.modelNote === NO_MODEL_NOTE, `the model note reads ${JSON.stringify(seen.modelNote)}`])
      ]
    })
  ),
  {
    name: '2: no heatmap: no card’s why mentions replays',
    link: latinTalk(60_000),
    model: null,
    expect: (seen) => fails([seen.cards.length === 3, `${seen.cards.length} cards`], [seen.cards.every((x) => !/replay/u.test(x.why)), 'a why mentions replays without a heatmap'])
  },
  {
    name: '2: one peak in the heatmap: a card covers it and reads “the most replayed part”',
    link: latinTalk(60_000, onePeak),
    model: null,
    expect: (seen, c, t) => {
      const peakMs = ((PEAK.from + PEAK.to) / 2 / 100) * t.durationMs
      const covering = seen.cards.filter((x) => {
        const w = c.windows.find((y) => y.id === x.windowId)
        return w !== undefined && w.startMs <= peakMs && w.endMs >= peakMs
      })
      // Two cards may both reach the peak (they share at most half); one of them, and only one card at all, is "the most replayed part".
      return fails(
        [covering.length >= 1, `no card covers the peak at ${Math.round(peakMs)} ms`],
        [covering.some((x) => x.why === MOST_REPLAYED), `no card over the peak reads "${MOST_REPLAYED}" (${covering.map((x) => JSON.stringify(x.why)).join(', ')})`],
        [seen.cards.filter((x) => x.why === MOST_REPLAYED).length === 1, `${seen.cards.filter((x) => x.why === MOST_REPLAYED).length} cards read "${MOST_REPLAYED}"`]
      )
    }
  },
  {
    name: '3: a caseless, unpunctuated track: three cards, no full-stop or “starts on” line, titles at most 40 graphemes, cut with …',
    link: () => ({ transcript: stubCaseless(), heatmap: null, language: '', targetMs: 60_000 }),
    model: null,
    expect: (seen, c) =>
      fails(
        [seen.cards.length === 3, `${seen.cards.length} cards`],
        [seen.cards.every((x) => x.why !== 'ends on a full stop' && !x.why.startsWith('starts on')), 'a why speaks of punctuation'],
        [seen.cards.every((x) => titleCut(x.title, 40)), 'a title is over 40 graphemes'],
        [
          seen.cards.every((x) => {
            const cand = c.candidates.find((y) => y.id === x.windowId)
            return cand !== undefined && (x.title === cand.firstSentence || x.title.endsWith('…'))
          }),
          'a title is cut without …'
        ],
        [seen.cards.some((x) => x.title.endsWith('…')), 'no title was long enough to be cut: the case shows nothing']
      )
  },
  {
    name: '4, 11: a 2 s talk at 1 min: no card, “about 2 s” and the shortest-length line',
    link: () => ({ transcript: stubTwoSeconds(), heatmap: null, language: 'en', targetMs: 60_000 }),
    model: null,
    expect: (seen) =>
      fails(
        [seen.cards.length === 0, `${seen.cards.length} cards`],
        [seen.note === 'The talk here runs about 2 s, shorter than the 1 min asked for. 1 min is the shortest length there is.', `the note reads ${JSON.stringify(seen.note)}`]
      )
  },
  {
    name: '11: a talk under a minute at 2 min: “Try a shorter length.”',
    link: () => ({ transcript: stubShort(13, 31), heatmap: null, language: 'en', targetMs: 120_000 }),
    model: null,
    expect: (seen) =>
      fails([seen.cards.length === 0, `${seen.cards.length} cards`], [/^The talk here runs about \d+ s, shorter than the 2 min asked for\. Try a shorter length\.$/u.test(seen.note ?? ''), `the note reads ${JSON.stringify(seen.note)}`])
  },
  {
    name: '4: a talk of about 100 s at 1 min: two cards and “Only 2 stretches…”',
    link: () => ({ transcript: stubShort(24, 32), heatmap: null, language: 'en', targetMs: 60_000 }),
    model: null,
    expect: (seen) =>
      fails([seen.cards.length === 2, `${seen.cards.length} cards`], [(seen.note ?? '').startsWith('Only 2 stretches of about 1 min fit here'), `the note reads ${JSON.stringify(seen.note)}`])
  },
  {
    name: '7: Analyse pressed twice: the same three cards in the same order',
    link: latinTalk(120_000),
    model: null,
    twice: true,
    expect: (seen) => fails([seen.cards.length === 3, `${seen.cards.length} cards`])
  },
  ...[
    ['a flat heatmap', flatHeat],
    ['varied heat', variedHeat]
  ].map(
    ([what, heat]): StubCase => ({
      name: `8: ${what as string}: no card’s why is a line that is not a reason to post`,
      link: latinTalk(60_000, heat as (t: Transcript) => LinkHeat[]),
      model: null,
      expect: (seen) => fails([seen.cards.length === 3, `${seen.cards.length} cards`], [seen.cards.every((x) => !isNotAWhy(x.why)), `a why reads ${JSON.stringify(seen.cards.find((x) => isNotAWhy(x.why))?.why)}`])
    })
  ),
  {
    name: '9: a plateau of heat under every card: one card, and only one, reads “the most replayed part”',
    link: latinTalk(60_000, plateau),
    model: null,
    expect: (seen) => {
      const most = seen.cards.filter((x) => x.why === MOST_REPLAYED).length
      return fails([seen.cards.length === 3, `${seen.cards.length} cards`], [most === 1, `${most} cards read the most replayed part`])
    }
  },
  {
    name: '10: sentences longer than a row: every title opens on a sentence’s first word',
    link: () => ({ transcript: stubLongSentences(), heatmap: null, language: 'en', targetMs: 60_000 }),
    model: null,
    expect: (seen, c, t) =>
      seen.cards.length === 0
        ? ['no cards']
        : seen.cards.flatMap((x) => {
            const w = c.windows.find((y) => y.id === x.windowId)
            if (!w) return []
            const { first, atStart } = opensSentence(t, w)
            return fails([atStart, `${x.windowId} starts mid-sentence`], [x.title.startsWith(first), `${x.windowId}'s title "${x.title}" does not open on "${first}"`])
          })
  },
  {
    name: '12: three good picks: three cards picked by the model, in time order, no model note',
    link: latinTalk(60_000),
    model: 'good',
    expect: (seen) => fails([seen.cards.length === 3, `${seen.cards.length} cards`], [allBy(seen, 'model'), 'a card is not the model’s'], [seen.modelNote === null, `the model note reads ${JSON.stringify(seen.modelNote)}`], [seen.cards.every((x) => x.note === null), 'a card has a note'])
  },
  {
    name: '13: a title naming “Kesmer”, never said: the first sentence and the title note',
    link: latinTalk(60_000),
    model: 'kesmer',
    expect: (seen, c) => titleFellBack(seen, c, TITLE_FALLBACK_NOTE)
  },
  {
    name: '14: a title with a number never said: the first sentence and the title note',
    link: latinTalk(60_000),
    model: 'number',
    expect: (seen, c) => titleFellBack(seen, c, TITLE_FALLBACK_NOTE)
  },
  {
    name: '15: the caseless track: window words in another order kept; a made-up run falls back',
    link: () => ({ transcript: stubCaseless(), heatmap: null, language: '', targetMs: 60_000 }),
    model: 'caseless',
    expect: (seen) => {
      const noted = seen.cards.filter((x) => x.note === TITLE_FALLBACK_NOTE)
      const kept = seen.cards.filter((x) => x.note === null)
      return fails(
        [seen.cards.length === 3 && allBy(seen, 'model'), `${seen.cards.length} cards, ${seen.cards.filter((x) => x.by === 'model').length} the model's`],
        [noted.length === 1, `${noted.length} titles fell back, not 1`],
        [kept.length === 2, `${kept.length} titles kept, not 2`],
        [!seen.cards.some((x) => x.title.includes(MADE_UP_CASELESS)), 'the made-up run is on a card']
      )
    }
  },
  {
    name: '16: one good pick, one off the menu, one twice: one model card, two filled, and the filled note',
    link: latinTalk(60_000),
    model: 'mixed',
    expect: (seen) =>
      fails(
        [seen.cards.filter((x) => x.by === 'model').length === 1, `${seen.cards.filter((x) => x.by === 'model').length} model cards`],
        [seen.cards.filter((x) => x.by === 'signals' && x.note === FILLED_NOTE).length === 2, 'not two filled cards with the filled note'],
        [seen.modelNote === filledNote(1, 3), `the model note reads ${JSON.stringify(seen.modelNote)}`]
      )
  },
  {
    name: '18: a model that throws with an address and a key: the did-not-answer note, and neither on the page',
    link: latinTalk(60_000),
    model: 'throws',
    expect: (seen) => {
      const all = JSON.stringify(seen)
      return fails(
        [seen.cards.length === 3 && allBy(seen, 'signals'), 'not the signals’ three'],
        [seen.modelNote === MODEL_FAILED_NOTE, `the model note reads ${JSON.stringify(seen.modelNote)}`],
        [!all.includes('10.0.0.7') && !all.includes('sk-harness'), 'the address or the key is on a card']
      )
    }
  },
  {
    name: '19: a model that never answers, with a short timeout: the too-long note',
    link: latinTalk(60_000),
    model: 'never',
    expect: (seen) => fails([seen.cards.length === 3 && allBy(seen, 'signals'), 'not the signals’ three'], [seen.modelNote === MODEL_SLOW_NOTE, `the model note reads ${JSON.stringify(seen.modelNote)}`])
  },
  {
    name: '20: an answer with start and end times: could-not-be-used, and every range its window’s',
    link: latinTalk(60_000),
    model: 'extra',
    expect: (seen) => fails([seen.cards.length === 3 && allBy(seen, 'signals'), 'not the signals’ three'], [seen.modelNote === MODEL_UNUSABLE_NOTE, `the model note reads ${JSON.stringify(seen.modelNote)}`])
  },
  {
    name: '21: a short talk with two candidates: two model cards and the shortfall note',
    link: () => ({ transcript: stubShort(24, 32), heatmap: null, language: 'en', targetMs: 60_000 }),
    model: 'good',
    expect: (seen) =>
      fails(
        [seen.cards.length === 2 && allBy(seen, 'model'), `${seen.cards.length} cards, not two of the model's`],
        [(seen.note ?? '').startsWith('Only 2 stretches'), `the note reads ${JSON.stringify(seen.note)}`],
        [seen.modelNote === null, `the model note reads ${JSON.stringify(seen.modelNote)}`]
      )
  },
  {
    name: '22: a long title and why: cut to 60 and 120 graphemes, with …',
    link: latinTalk(60_000),
    model: 'long',
    expect: (seen) =>
      fails(
        [seen.cards.length === 3 && allBy(seen, 'model'), 'not the model’s three'],
        [seen.cards.every((x) => titleCut(x.title, 60) && x.title.endsWith('…')), 'a title is not cut to 60 with …'],
        [seen.cards.every((x) => titleCut(x.why, 120) && x.why.endsWith('…')), 'a why is not cut to 120 with …'],
        [seen.cards.every((x) => x.note === null), 'a long card fell back']
      )
  },
  {
    name: '23: “about nine thousand” and “about nine guests”, never said: both fall back, both notes',
    link: latinTalk(60_000),
    model: 'nine',
    expect: (seen, c) => noteOnFirstPick(seen, c, `${TITLE_FALLBACK_NOTE} ${WHY_FALLBACK_NOTE}`)
  },
  {
    name: '24: a title of “…” and an empty why; a zero-width title: the empty notes',
    link: latinTalk(60_000),
    model: 'empty',
    expect: (seen) =>
      fails(
        [seen.cards.filter((x) => x.note === `${TITLE_EMPTY_NOTE} ${WHY_EMPTY_NOTE}`).length === 1, 'no card with both empty notes'],
        [seen.cards.filter((x) => x.note === TITLE_EMPTY_NOTE).length === 1, 'no card with the empty-title note alone'],
        [!seen.cards.some((x) => x.title === '…' || x.title.includes('\u200B') || x.title === ''), 'an empty title is on a card']
      )
  },
  {
    name: '25: lower-case Latin titles over the caseless track: every title falls back',
    link: () => ({ transcript: stubCaseless(), heatmap: null, language: '', targetMs: 60_000 }),
    model: 'lower-latin',
    expect: (seen) =>
      fails([seen.cards.length === 3, `${seen.cards.length} cards`], [seen.cards.every((x) => x.note === TITLE_FALLBACK_NOTE && x.by === 'model'), 'a Latin title was kept'], [!seen.cards.some((x) => x.title.includes('plim')), 'a Latin title is on a card'])
  },
  {
    name: '26: a why naming “Kesmer” falls back; one opening “It” is kept',
    link: latinTalk(60_000),
    model: 'kesmer-why',
    expect: (seen) =>
      fails(
        [seen.cards.filter((x) => x.note === WHY_FALLBACK_NOTE).length === 1, 'not one card with the why note'],
        [seen.cards.some((x) => x.why === 'It moves fast and ends well.' && x.note === null), 'the why opening “It” was not kept'],
        [!seen.cards.some((x) => x.why.includes('Kesmer')), 'Kesmer is on a card']
      )
  }
]

/** The first pick's card (the best candidate's) fell back: its title is the clip's first sentence, with `note`. */
function titleFellBack(seen: SeenCards, c: Candidates, note: string): string[] {
  const first = c.candidates[0]
  const card = seen.cards.find((x) => x.windowId === first?.id)
  return fails(
    [seen.cards.length === 3 && allBy(seen, 'model'), 'not the model’s three'],
    [card !== undefined && card.title === first.title, `the first pick's title reads ${JSON.stringify(card?.title)}, not its first sentence ${JSON.stringify(first?.title)}`],
    [card?.note === note, `the first pick's note reads ${JSON.stringify(card?.note)}`],
    [seen.cards.filter((x) => x.note !== null).length === 1, 'more than one card has a note']
  )
}

/** The first pick's card carries `note`, and no other card has one. */
function noteOnFirstPick(seen: SeenCards, c: Candidates, note: string): string[] {
  const card = seen.cards.find((x) => x.windowId === c.candidates[0]?.id)
  return fails(
    [seen.cards.length === 3 && allBy(seen, 'model'), 'not the model’s three'],
    [card?.note === note, `the first pick's note reads ${JSON.stringify(card?.note)}`],
    [card !== undefined && card.title === c.candidates[0].title, 'the first pick does not show its first sentence'],
    [seen.cards.filter((x) => x.note !== null).length === 1, 'more than one card has a note']
  )
}

/** Every case's own checks and the common ones. */
export function caseFailures(k: StubCase, seen: SeenCards, c: Candidates, t: Transcript): string[] {
  return [...commonChecks(seen, c), ...k.expect(seen, c, t)]
}

/**
 * The model's status the harness stands in while the stub answers: BOTH
 * providers ready and local, so main's own choice (`chooseProvider`, which
 * Analyse's `modelReady` asks) picks one whatever the page's director setting
 * is (auto, ollama or openai). Only `directorComplete` is the stub's.
 */
export const STUB_READY: LlmStatus[] = [
  { id: 'ollama', label: 'the harness’s model stub', kind: 'local', ready: true, reason: null },
  { id: 'openai', label: 'the harness’s model stub', kind: 'local', ready: true, reason: null }
]

/** The page check's Clip it half, by name (bestClipsCheck.ts runs them in this order, after the cards' cases). */
export const CLIP_IT_CASE_NAMES = [
  'Clip it on an empty timeline: this project set to 9:16, one exact download of the card’s range',
  'landed without the AI helper: the crop centred and said, captions turned on in one undo step, graphics after',
  'landed with the AI helper: followed, captions kept off the faces, graphics only after the analysis ended',
  'the AI helper there, the face finder not on disk: named, never fetched; the crop centred; captions turned on, graphics still run',
  'a 16:9 edit on the timeline: the card asks; Not now sends nothing; Add it to this project keeps the aspect and every crop',
  'unsaved work: Start a new 9:16 project saves first, then a new 9:16 project and the download',
  'M0’s Clip download from picked rows: one undo step on landing and nothing after it, captions left off'
] as const

/** What the session reads from `window.__forgeBestClipsCheck()` when all is well: every case, each `ok`. */
export const BEST_CLIPS_CHECK_CASES = BEST_CLIPS_STUB_CASES.length + CLIP_IT_CASE_NAMES.length
