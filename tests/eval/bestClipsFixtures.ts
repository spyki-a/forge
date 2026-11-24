import type { LinkHeat } from '@shared/ingest/args'
import { PAUSE_BOUNDARY_MS, segmentIntoSentences, type Transcript, type Word } from '@shared/transcript'
import { CAP_MS, CAP_WORDS } from '@shared/bestclips/windows'

/**
 * Best clips' eval fixtures (docs/CLIPS.md §7.4, §7.7), built in code from
 * made-up words: Latin nonsense, and a caseless script (Georgian Mkhedruli
 * code points, written as escapes, in made-up runs), as piece 1's tests build
 * theirs. No third party's speech and no file: the owner's ten real links
 * (§7.8) are run B's and the owner's. Read by tests/bestClipsModel.test.ts and
 * the eval's FORGE_EVAL_BESTCLIPS block (director.eval.test.ts).
 */

/** mulberry32: a seeded generator of our own, so every run draws the same transcripts. */
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

export interface Spoken {
  text: string
  dur: number
  gap: number
}

export function transcriptOf(spoken: readonly Spoken[], language = 'xx'): Transcript {
  let at = 0
  const words: Word[] = spoken.map((s, i) => {
    const w: Word = { index: i, text: s.text, startMs: at, endMs: at + s.dur, confidence: null }
    at += s.dur + s.gap
    return w
  })
  return {
    assetId: 'url:test',
    language,
    model: 'test',
    durationMs: at,
    words,
    segments: segmentIntoSentences(words, PAUSE_BOUNDARY_MS, { maxWords: CAP_WORDS, maxMs: CAP_MS })
  }
}

export const LATIN = ['zor', 'plim', 'tavek', 'mubo', 'senra', 'kilo', 'drav', 'oppen', 'vestra', 'nim', 'rulo', 'fesh', 'gandu', 'brel']
export const latin = (i: number): string => LATIN[i % LATIN.length]

/** A made-up word in a caseless script: three Mkhedruli letters from U+10D0..U+10F0. */
export function caseless(i: number): string {
  return String.fromCharCode(0x10d0 + ((i * 7) % 33), 0x10d0 + ((i * 3 + 5) % 33), 0x10d0 + ((i * 11 + 2) % 33))
}

/**
 * Sentences of words, each word 280 ms with 60 ms between, 300 ms between
 * sentences. `mark` closes each sentence ('' for an unpunctuated track).
 */
export function talk(sentences: readonly (readonly string[])[], mark = '.', wordMs = 280, gapMs = 60, sentenceGapMs = 300): Spoken[] {
  const out: Spoken[] = []
  for (const sentence of sentences) {
    sentence.forEach((text, k) => {
      const last = k === sentence.length - 1
      out.push({ text: last ? text + mark : text, dur: wordMs, gap: last ? sentenceGapMs : gapMs })
    })
  }
  return out
}

/** `n` sentences of 8..14 words from a vocabulary, drawn from a seed; sentence `k` of `extra` replaces sentence k. */
export function sentencesOf(n: number, vocab: (i: number) => string, seed: number, extra: Readonly<Record<number, readonly string[]>> = {}): string[][] {
  const r = rng(seed)
  return Array.from({ length: n }, (_, k) => {
    const drawn = Array.from({ length: 8 + Math.floor(r() * 7) }, () => vocab(Math.floor(r() * 400)))
    return extra[k] ? [...extra[k]] : drawn
  })
}

/** A heatmap of 100 buckets over `seconds`, `value(i)` each. */
export function heatOf(seconds: number, value: (i: number) => number): LinkHeat[] {
  return Array.from({ length: 100 }, (_, i) => ({ start_time: (seconds * i) / 100, end_time: (seconds * (i + 1)) / 100, value: value(i) }))
}

export interface BestClipsEvalFixture {
  id: string
  /** The link's language, as its meta would give it ('' when it names none). */
  language: string
  transcript: Transcript
  heatmap: LinkHeat[] | null
  targetMs: number
}

/**
 * The eval set, made-up: an English-shaped punctuated talk with a heatmap, a
 * name ("Zorvan") and numbers said; an unpunctuated lower-case track with no
 * heatmap; a caseless, unpunctuated track with no language named.
 */
export function bestClipsFixtures(): BestClipsEvalFixture[] {
  const named: Record<number, string[]> = {
    4: ['Zorvan', 'tavek', 'plim', 'mubo', '2,500', 'senra', 'kilo', 'drav', 'oppen'],
    40: ['why', 'did', 'Zorvan', 'drav', 'nim', 'rulo', 'twelve', 'fesh'],
    90: ['you', 'brel', 'gandu', 'vestra', '40%', 'oppen', 'zor', 'plim']
  }
  const en = transcriptOf(talk(sentencesOf(140, latin, 11, named)), 'en')
  const enHeat = heatOf(en.durationMs / 1000, (i) => (i >= 30 && i < 38 ? 0.9 : 0.2 + (i % 7) / 20))
  const plain = transcriptOf(talk(sentencesOf(160, latin, 12), ''), 'en')
  const cl = transcriptOf(talk(sentencesOf(120, caseless, 13), ''), 'und')
  return [
    { id: 'bc-en-heat', language: 'en', transcript: en, heatmap: enHeat, targetMs: 60_000 },
    { id: 'bc-en-plain', language: 'en', transcript: plain, heatmap: null, targetMs: 120_000 },
    { id: 'bc-caseless', language: '', transcript: cl, heatmap: null, targetMs: 60_000 }
  ]
}
