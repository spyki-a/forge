import { describe, expect, it } from 'vitest'
import {
  CAP_MS,
  CAP_WORDS,
  clipSegments,
  lengthBand,
  shortfallNote,
  windowsFor,
  type ClipWindow
} from '@shared/bestclips/windows'
import {
  CONDENSED_MAX_CHARS,
  MAX_CANDIDATES,
  MAX_OVERLAP,
  SIGNAL_ORDER,
  SIGNAL_WEIGHTS,
  TITLE_MAX_GRAPHEMES,
  candidatesFor,
  condense,
  cutText,
  graphemes,
  overlapShare,
  prefilter,
  scoreOf,
  scoreWindows,
  signalsPicks,
  strongestReason,
  titleOf,
  transcriptTraits,
  type ScoredWindow,
  type Signals
} from '@shared/bestclips/signals'
import type { LinkHeat } from '@shared/ingest/args'
import { PAUSE_BOUNDARY_MS, segmentIntoSentences, type Transcript, type Word } from '@shared/transcript'

/*
 * Best clips, piece 1 (docs/CLIPS.md §7.3, §7.4's first half): the windows,
 * the six signals, the prefilter, the condensed text and the no-model three.
 * Every transcript is built here from made-up words: Latin nonsense, and a
 * caseless script (Georgian Mkhedruli code points, written as escapes, in
 * made-up runs). No model, no network.
 */

/* ------------------------------------------------------------- fixtures */

/** mulberry32: a seeded generator of our own, so every run draws the same transcripts. */
function rng(seed: number): () => number {
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

function transcriptOf(spoken: readonly Spoken[], language = 'xx'): Transcript {
  let at = 0
  const words: Word[] = spoken.map((s, index) => {
    const w: Word = { index, text: s.text, startMs: at, endMs: at + s.dur, confidence: null }
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

const LATIN = ['zor', 'plim', 'tavek', 'mubo', 'senra', 'kilo', 'drav', 'oppen', 'vestra', 'nim', 'rulo', 'fesh', 'gandu', 'brel']

/** A made-up word in a caseless script: three Mkhedruli letters from U+10D0..U+10F0. */
function caseless(i: number): string {
  return String.fromCharCode(0x10d0 + ((i * 7) % 33), 0x10d0 + ((i * 3 + 5) % 33), 0x10d0 + ((i * 11 + 2) % 33))
}

/**
 * Sentences of made-up words, each word 280 ms with 60 ms between, 300 ms
 * between sentences (under the 700 ms pause rule, so only punctuation or the
 * cap splits). `mark` closes each sentence ('' for an unpunctuated track).
 */
function talk(sentences: readonly (readonly string[])[], mark = '.', wordMs = 280, gapMs = 60, sentenceGapMs = 300): Spoken[] {
  const out: Spoken[] = []
  for (const sentence of sentences) {
    sentence.forEach((text, k) => {
      const last = k === sentence.length - 1
      out.push({ text: last ? text + mark : text, dur: wordMs, gap: last ? sentenceGapMs : gapMs })
    })
  }
  return out
}

/** `n` sentences of 8..14 words from a vocabulary, drawn from a seed. */
function sentencesOf(n: number, vocab: (i: number) => string, seed: number): string[][] {
  const r = rng(seed)
  return Array.from({ length: n }, () => Array.from({ length: 8 + Math.floor(r() * 7) }, () => vocab(Math.floor(r() * 400))))
}

const latin = (i: number): string => LATIN[i % LATIN.length]
const flatHeat = (seconds: number, value = 0.4): LinkHeat[] =>
  Array.from({ length: 100 }, (_, i) => ({ start_time: (seconds * i) / 100, end_time: (seconds * (i + 1)) / 100, value }))

/* ---------------------------------------------------------- the windows */

describe('windowsFor: boundaries, band and stride (§7.3)', () => {
  it('every window starts at a capped segment start and ends at a capped segment end, inside the band, for random transcripts', () => {
    // MUTATION (windows.ts, endMs: segs[best].endMs -> the middle of that segment):
    // fails "expect(w.endMs).toBe(to.endMs)". MUTATION (the `if (length < lo) continue` removed):
    // fails "expect(length).toBeGreaterThanOrEqual(lo - 1e-6)". MUTATION (a start with no end in the
    // band takes its own segment's end): fails "expect(length).toBeGreaterThanOrEqual(lo - 1e-6)".
    let checked = 0
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed)
      const punctuated = r() < 0.5
      const n = 200 + Math.floor(r() * 1000)
      const spoken: Spoken[] = Array.from({ length: n }, (_, i) => {
        const pause = r() < 0.04 ? 800 + Math.floor(r() * 3000) : 30 + Math.floor(r() * 170)
        const end = punctuated && r() < 1 / 12 ? (r() < 0.8 ? '.' : '?') : ''
        return { text: latin(Math.floor(r() * 50)) + end, dur: 150 + Math.floor(r() * 350), gap: pause }
      })
      const t = transcriptOf(spoken)
      const targetMs = [60_000, 120_000, 180_000, 240_000][Math.floor(r() * 4)]
      const tolerance = [0.1, 0.2, 0.3][Math.floor(r() * 3)]
      const { lo, hi } = lengthBand(targetMs, tolerance)
      const segs = clipSegments(t)
      const at = new Map(segs.map((s, i) => [s.id, i]))
      const windows = windowsFor(t, targetMs, tolerance)
      windows.forEach((w, k) => {
        expect(w.id).toBe(`w${k + 1}`)
        const from = segs[at.get(w.segFrom)!]
        const to = segs[at.get(w.segTo)!]
        expect(from).toBeDefined()
        expect(to).toBeDefined()
        expect(w.startMs).toBe(from.startMs)
        expect(w.endMs).toBe(to.endMs)
        expect(at.get(w.segFrom)!).toBeLessThanOrEqual(at.get(w.segTo)!)
        const length = w.endMs - w.startMs
        expect(length).toBeGreaterThanOrEqual(lo - 1e-6)
        expect(length).toBeLessThanOrEqual(hi + 1e-6)
        expect(w.words).toBe(to.wordEnd - from.wordStart + 1)
        checked++
      })
      // Stride one segment: a window from exactly every start that has an end in the band, and from no other.
      const feasible = segs.flatMap((s, i) =>
        segs.slice(i).some((e) => e.endMs - s.startMs >= lo && e.endMs - s.startMs <= hi) ? [s.id] : []
      )
      const starts = windows.map((w) => w.segFrom)
      expect(starts).toEqual(feasible)
    }
    expect(checked).toBeGreaterThan(500)
  })

  it('prefers an end on a full stop to a nearer end without one', () => {
    // Twelve 10-word unpunctuated lines (pauses split them), every one ~4.2 s; the 9th of 14 ends on a full stop.
    // MUTATION (the `punctuated[j] && !bestPunct` preference removed): fails "expect(first.segTo).toBe(dotted.id)".
    const sentences = Array.from({ length: 14 }, (_, i) => Array.from({ length: 10 }, (_, k) => latin(i + k)))
    const spoken = sentences.flatMap((s, i) =>
      s.map((text, k): Spoken => ({ text: k === 9 && i === 8 ? text + '.' : text, dur: 360, gap: k === 9 ? 800 : 60 }))
    )
    const t = transcriptOf(spoken)
    const segs = clipSegments(t)
    const dotted = segs[8]
    // A target whose nearest end is segment 10 (index 9); segment 9 (index 8) is inside ±20 % too.
    const target = segs[9].endMs - segs[0].startMs
    expect(dotted.endMs - segs[0].startMs).toBeGreaterThanOrEqual(lengthBand(target).lo)
    const first = windowsFor(t, target)[0]
    expect(first.segFrom).toBe(segs[0].id)
    expect(first.segTo).toBe(dotted.id)
  })

  it('a talk shorter than the band gives no window and says so plainly; a segment longer than the band starts none', () => {
    // MUTATION (shortfallNote's talk-length branch removed): fails "toContain('shorter than the 1 min asked for')".
    const short = transcriptOf(talk(sentencesOf(6, latin, 3)))
    expect(short.durationMs).toBeLessThan(48_000)
    expect(windowsFor(short, 60_000)).toEqual([])
    const c = candidatesFor(short, 60_000, null)
    expect(c.candidates).toEqual([])
    expect(c.note).toContain('shorter than the 1 min asked for')

    // One word lasting 80 s (capRun never splits a word): over the 72 s upper bound, so nothing starts on it.
    const long = transcriptOf([{ text: 'zor', dur: 80_000, gap: 900 }, ...talk(sentencesOf(20, latin, 4))])
    const segs = clipSegments(long)
    expect(segs[0].endMs - segs[0].startMs).toBe(80_000)
    expect(windowsFor(long, 60_000).some((w) => w.segFrom === segs[0].id)).toBe(false)
    expect(windowsFor(long, 60_000).length).toBeGreaterThan(0)
  })

  it('a talk with room for fewer than three apart says how many fit', () => {
    // MUTATION (shortfallNote's `found >= 3` -> `found >= 1`): fails "toContain('Only 2 stretches')".
    const t = transcriptOf(talk(sentencesOf(24, latin, 5)))
    expect(t.durationMs).toBeLessThan(110_000)
    const c = candidatesFor(t, 60_000, null)
    expect(c.candidates.length).toBe(2)
    expect(c.note).toContain('Only 2 stretches of about 1 min')
    expect(shortfallNote(t, 60_000, 3)).toBeNull()
  })
})

/* ---------------------------------------------------------- the prefilter */

describe('prefilter: at most 24, best first, none overlapping by more than half of the shorter', () => {
  const hour = (): Transcript => transcriptOf(talk(sentencesOf(900, latin, 11)))

  it('keeps at most MAX_CANDIDATES, best first, pairwise within MAX_OVERLAP', () => {
    // MUTATION (the `out.length >= max` stop removed): fails "toBeLessThanOrEqual(MAX_CANDIDATES)".
    // MUTATION (the overlap check `<= MAX_OVERLAP` -> `<= 1`): fails "toBeLessThanOrEqual(MAX_OVERLAP)".
    const t = hour()
    const r = rng(9)
    const heat = Array.from({ length: 100 }, (_, i): LinkHeat => ({ start_time: i * 36, end_time: (i + 1) * 36, value: r() }))
    for (const target of [60_000, 120_000, 240_000]) {
      const c = candidatesFor(t, target, heat)
      expect(c.windows.length).toBeGreaterThan(MAX_CANDIDATES)
      expect(c.candidates.length).toBeLessThanOrEqual(MAX_CANDIDATES)
      expect(c.candidates.length).toBe(MAX_CANDIDATES)
      for (let i = 1; i < c.candidates.length; i++) expect(c.candidates[i].score).toBeLessThanOrEqual(c.candidates[i - 1].score)
      for (const a of c.candidates)
        for (const b of c.candidates) if (a !== b) expect(overlapShare(a.window, b.window)).toBeLessThanOrEqual(MAX_OVERLAP)
    }
  })

  it('measures overlap against the SHORTER window, and allows exactly half', () => {
    // MUTATION (overlapShare divides by the LONGER): fails "expect(overlapShare(long, short)).toBeCloseTo(0.6)"
    // and "expect(kept.map((k) => k.window.id)).toEqual(['a', 'c'])".
    const w = (id: string, startMs: number, endMs: number): ClipWindow => ({ id, segFrom: id, segTo: id, startMs, endMs, words: 1 })
    const long = w('a', 0, 200_000)
    const short = w('b', 140_000, 240_000) // shares 60 s: 0.6 of the shorter (100 s), 0.3 of the longer
    const half = w('c', 150_000, 350_000) // shares 50 s with a (0.25 of either), 90 s with b (0.9 of b, 0.45 of c)
    expect(overlapShare(long, short)).toBeCloseTo(0.6)
    expect(overlapShare(short, long)).toBeCloseTo(0.6)
    expect(overlapShare(short, half)).toBeCloseTo(0.9)
    const scored = (win: ClipWindow, score: number): ScoredWindow => ({ window: win, score, why: '', signals: {} as Signals })
    const kept = prefilter([scored(long, 0.9), scored(short, 0.8), scored(half, 0.7)])
    expect(kept.map((k) => k.window.id)).toEqual(['a', 'c'])
    // Exactly half of the shorter is allowed.
    const x = w('x', 0, 100_000)
    const y = w('y', 50_000, 150_000)
    expect(overlapShare(x, y)).toBe(0.5)
    expect(prefilter([scored(x, 0.5), scored(y, 0.4)]).map((k) => k.window.id)).toEqual(['x', 'y'])
  })
})

/* ---------------------------------------------------------- the signals */

describe('signals: absent, not zero', () => {
  const t = transcriptOf(talk(sentencesOf(160, latin, 21)))
  const seconds = t.durationMs / 1000

  it('a missing heatmap changes no other signal, and ranks exactly as a flat heatmap does', () => {
    // MUTATION (heatOver returns sum, not sum / covered): the flat heat then grows with a window's length,
    // and fails "expect(ids(flat)).toEqual(ids(none))".
    const windows = windowsFor(t, 120_000)
    const none = scoreWindows(t, windows, null)
    const flat = scoreWindows(t, windows, flatHeat(seconds))
    const r = rng(2)
    const varied = scoreWindows(t, windows, Array.from({ length: 100 }, (_, i): LinkHeat => ({ start_time: (seconds * i) / 100, end_time: (seconds * (i + 1)) / 100, value: r() })))
    for (let k = 0; k < windows.length; k++) {
      expect(none[k].signals.heat).toBeNull()
      expect(flat[k].signals.heat).not.toBeNull()
      for (const name of SIGNAL_ORDER.filter((n) => n !== 'heat')) {
        expect(flat[k].signals[name]).toEqual(none[k].signals[name])
        expect(varied[k].signals[name]).toEqual(none[k].signals[name])
      }
    }
    const ids = (s: ScoredWindow[]): string[] => prefilter(s).map((x) => x.window.id)
    expect(ids(flat)).toEqual(ids(none))
  })

  it("an absent signal's weight is not counted: a window the heatmap does not cover scores on its other signals", () => {
    // MUTATION (scoreOf counts an absent signal's weight as a zero): fails
    // "expect(scoreOf(uncovered.signals)).toBeCloseTo(mean, 12)" (the covered/uncovered comparison alone
    // would not: both sides are then scored by the same wrong rule).
    const windows = windowsFor(t, 60_000)
    // The heatmap covers the first half of the video only.
    const half: LinkHeat[] = flatHeat(seconds / 2, 0.7)
    const scored = scoreWindows(t, windows, half)
    const plain = scoreWindows(t, windows, null)
    const k = windows.findIndex((w) => w.startMs > (seconds / 2) * 1000)
    expect(k).toBeGreaterThan(0)
    const uncovered = scored[k]
    const noHeat = plain[k]
    expect(uncovered.signals.heat).toBeNull()
    expect(uncovered.score).toBeCloseTo(noHeat.score, 12)
    // And the weighted mean is of the present ones only.
    const present = SIGNAL_ORDER.filter((n) => uncovered.signals[n])
    const mean =
      present.reduce((s, n) => s + SIGNAL_WEIGHTS[n] * uncovered.signals[n]!.value, 0) / present.reduce((s, n) => s + SIGNAL_WEIGHTS[n], 0)
    expect(scoreOf(uncovered.signals)).toBeCloseTo(mean, 12)
  })

  it('the most replayed window says so, and comes first', () => {
    // MUTATION (the `h === heatMax` branch of the heat reason removed): fails
    // "expect(top.signals.heat?.reason).toBe('the most replayed part')".
    const heat = flatHeat(seconds, 0.2).map((b) => (b.start_time >= 200 && b.end_time <= 330 ? { ...b, value: 1 } : b))
    const c = candidatesFor(t, 120_000, heat)
    const top = c.candidates[0]
    expect(top.window.startMs).toBeGreaterThanOrEqual(190_000)
    expect(top.window.endMs).toBeLessThanOrEqual(350_000)
    expect(top.signals.heat?.reason).toBe('the most replayed part')
    expect(signalsPicks(c).picks[0].why).toBe('the most replayed part')
  })

  it('the why is the strongest present reason, not the first', () => {
    // MUTATION (strongestReason returns the first present reason): fails "toBe('opens with a number')".
    const signals: Signals = {
      heat: null,
      density: { value: 0.1, reason: 'slower than most of the video' },
      ending: { value: 0, reason: 'stops in the middle of a sentence' },
      opening: null,
      hook: { value: 1, reason: 'opens with a number' },
      quiet: { value: 0.3, reason: 'has long stretches with no talking' }
    }
    expect(strongestReason(signals)).toBe('opens with a number')
  })
})

describe('signals: the scripts', () => {
  it('English: a window opening on a connective is marked down, and "you" is a hook', () => {
    // MUTATION (the CONNECTIVES check in the opening removed): fails "expect(opening?.value).toBe(0)".
    // MUTATION (ADDRESS left out of the hook): fails "toBe('speaks straight to the viewer from the start')".
    const sentences = sentencesOf(60, latin, 31).map((s, i) => (i % 3 === 0 ? ['and', ...s] : i % 3 === 1 ? ['you', ...s] : s))
    const t = transcriptOf(talk(sentences), 'en')
    expect(transcriptTraits(t.words, clipSegments(t))).toEqual({ punctuated: true, english: true })
    const scored = scoreWindows(t, windowsFor(t, 60_000), null)
    const onAnd = scored.find((s) => t.segments.find((x) => x.id === s.window.segFrom)?.text.startsWith('and '))!
    const onYou = scored.find((s) => t.segments.find((x) => x.id === s.window.segFrom)?.text.startsWith('you '))!
    expect(onAnd.signals.opening?.value).toBe(0)
    expect(onAnd.signals.opening?.reason).toBe('starts on "and", in the middle of a thought')
    expect(onYou.signals.opening?.value).toBe(1)
    expect(onYou.signals.hook?.reason).toBe('speaks straight to the viewer from the start')
  })

  it('a caseless, unpunctuated transcript: no ending and no opening signal, the number check alone in the hook', () => {
    // MUTATION (the ending signal present whatever the traits): fails "expect(s.signals.ending).toBeNull()".
    // MUTATION (the number check /[0-9]/ instead of /\p{Nd}/u): fails "toBe('opens with a number')" (a Thai digit).
    const lines = sentencesOf(80, caseless, 41)
    lines[10] = ['๓', ...lines[10]] // a digit in another script opens line 11
    const spoken = lines.flatMap((s) => s.map((text, k): Spoken => ({ text, dur: 280, gap: k === s.length - 1 ? 900 : 60 })))
    const t = transcriptOf(spoken, 'xx')
    const segs = clipSegments(t)
    expect(transcriptTraits(t.words, segs)).toEqual({ punctuated: false, english: false })
    const scored = scoreWindows(t, windowsFor(t, 60_000), null)
    expect(scored.length).toBeGreaterThan(5)
    for (const s of scored) {
      expect(s.signals.ending).toBeNull()
      expect(s.signals.opening).toBeNull()
      expect(s.signals.heat).toBeNull()
      expect(s.signals.hook).not.toBeNull()
      expect(s.signals.density).not.toBeNull()
      expect(s.signals.quiet).not.toBeNull()
    }
    const withDigit = scored.find((s) => s.window.segFrom === segs[10].id)!
    expect(withDigit.signals.hook?.reason).toBe('opens with a number')
    // Not ranked below for its script: the same talk in made-up Latin words, unpunctuated, scores the same.
    const twin = transcriptOf(
      spoken.map((s, i) => ({ ...s, text: i === spoken.findIndex((x) => x.text === '๓') ? '3' : latin(i) })),
      'xx'
    )
    const twinScored = scoreWindows(twin, windowsFor(twin, 60_000), null)
    expect(twinScored.map((s) => s.score)).toEqual(scored.map((s) => s.score))
  })

  it('an unpunctuated window is condensed from its capped segments, within the budget, never mid-word', () => {
    // MUTATION (cutText always cuts at `taken`, mid-word): fails "expect(words.has(token)).toBe(true)".
    const lines = sentencesOf(80, caseless, 43).map((s) => [...s, ...s, ...s]) // ~33 words: the cap splits them
    const spoken = lines.flatMap((s) => s.map((text, k): Spoken => ({ text, dur: 250, gap: k === s.length - 1 ? 900 : 40 })))
    const t = transcriptOf(spoken)
    const c = candidatesFor(t, 60_000, null)
    expect(c.candidates.length).toBeGreaterThanOrEqual(3)
    const words = new Set(t.words.map((w) => w.text))
    const segs = clipSegments(t)
    for (const x of c.candidates) {
      expect(x.condensed.length).toBeLessThanOrEqual(CONDENSED_MAX_CHARS)
      const first = segs.find((s) => s.id === x.window.segFrom)!
      expect(x.firstSentence).toBe(first.text)
      for (const token of x.condensed.replace(/…/g, ' ').split(' ').filter(Boolean)) expect(words.has(token)).toBe(true)
    }
  })
})

/* ------------------------------------------------------------- the text */

describe('the condensed text and the title', () => {
  it('the first two sentences, then the densest of the rest after " … "', () => {
    // MUTATION (the densest taken as the first of the rest): fails "toContain(' … ' + fast)".
    const words = (n: number, seed: number): string[] => Array.from({ length: n }, (_, i) => latin(i + seed))
    const sentence = (text: string[], wordMs: number): { text: string; startMs: number; endMs: number; words: number } => ({
      text: text.join(' ') + '.',
      startMs: 0,
      endMs: text.length * wordMs,
      words: text.length
    })
    const fast = words(4, 3).join(' ') + '.'
    const s = [sentence(words(3, 0), 400), sentence(words(3, 1), 400), sentence(words(4, 2), 900), sentence(words(4, 3), 150)]
    const out = condense(s)
    expect(out.startsWith(s[0].text + ' ' + s[1].text)).toBe(true)
    expect(out).toContain(' … ' + fast)
    expect(out.length).toBeLessThanOrEqual(CONDENSED_MAX_CHARS)
  })

  it('a long punctuated window stays within the budget and cuts only between words', () => {
    // MUTATION (CONDENSED_MAX_CHARS ignored: condense's default budget 10000): fails "toBeLessThanOrEqual(CONDENSED_MAX_CHARS)".
    const t = transcriptOf(talk(sentencesOf(400, latin, 51).map((s) => [...s, ...s])))
    const c = candidatesFor(t, 180_000, null)
    const vocab = new Set(t.words.map((w) => w.text))
    for (const x of c.candidates) {
      expect(x.condensed.length).toBeLessThanOrEqual(CONDENSED_MAX_CHARS)
      expect(x.condensed.length).toBeGreaterThan(CONDENSED_MAX_CHARS * 0.6)
      for (const token of x.condensed.replace(/…/g, ' ').split(' ').filter(Boolean)) expect(vocab.has(token)).toBe(true)
    }
  })

  it('the title is cut to 40 graphemes, never inside a cluster', () => {
    // MUTATION (cutText counts UTF-16 units: `size = g.length` for graphemes too): fails
    // "expect(graphemes(cut).length).toBe(TITLE_MAX_GRAPHEMES)".
    // MUTATION (graphemes() as Array.from): fails "expect(cut.endsWith('á…')).toBe(true)".
    const cluster = 'á' // a and a combining acute: one grapheme, two code points
    const run = cluster.repeat(60) // one 60-grapheme word, no space to cut at
    const cut = titleOf(run)
    expect(graphemes(cut).length).toBe(TITLE_MAX_GRAPHEMES)
    expect(cut.endsWith('á…')).toBe(true)
    // With spaces, the cut is at a word: none of the made-up words is broken.
    const sentence = 'zor plim tavek mubo senra kilo drav oppen vestra nim rulo fesh'
    const title = titleOf(sentence)
    expect(graphemes(title).length).toBeLessThanOrEqual(TITLE_MAX_GRAPHEMES)
    expect(title).toBe('zor plim tavek mubo senra kilo drav…')
    expect(titleOf('zor plim.')).toBe('zor plim.')
    expect(cutText(caseless(1) + ' ' + caseless(2), 5, 'graphemes')).toBe(caseless(1) + '…')
  })
})

/* ------------------------------------------------------- the no-model three */

describe('signalsPicks: the no-model three', () => {
  it('three, apart, each titled with its first sentence cut and its strongest reason as the why', () => {
    // MUTATION (signalsPicks takes c.windows.slice(0, 3) rather than the candidates): fails
    // "expect(overlapShare(a.window, b.window)).toBeLessThanOrEqual(MAX_OVERLAP)".
    const t = transcriptOf(talk(sentencesOf(300, latin, 61)))
    const c = candidatesFor(t, 60_000, null)
    const { picks, note } = signalsPicks(c)
    expect(note).toBeNull()
    expect(picks.length).toBe(3)
    for (const a of picks) for (const b of picks) if (a !== b) expect(overlapShare(a.window, b.window)).toBeLessThanOrEqual(MAX_OVERLAP)
    picks.forEach((p, k) => {
      const cand = c.candidates[k]
      expect(p.id).toBe(cand.id)
      expect(p.title).toBe(titleOf(cand.firstSentence))
      expect(graphemes(p.title).length).toBeLessThanOrEqual(TITLE_MAX_GRAPHEMES)
      expect(p.why).toBe(strongestReason(cand.signals))
      expect(cand.reasons).toContain(p.why)
    })
  })
})

/* --------------------------------------------------------- determinism */

describe('determinism', () => {
  it('the same transcript, meta and length give the same windows, ids, scores and order, with fresh objects', () => {
    // MUTATION (prefilter's tie-break replaced by `Math.random() - 0.5`): fails
    // "expect(again.candidates.map((x) => x.id)).toEqual(first.candidates.map((x) => x.id))".
    // A talk of identical sentences: nearly every window ties, so only the tie-break orders them.
    const same = Array.from({ length: 200 }, () => LATIN.slice(0, 10))
    const t = transcriptOf(talk(same))
    const first = candidatesFor(t, 60_000, null)
    const again = candidatesFor(structuredClone(t), 60_000, null)
    expect(again.windows).toEqual(first.windows)
    expect(again.candidates.map((x) => x.id)).toEqual(first.candidates.map((x) => x.id))
    expect(again.candidates.map((x) => x.score)).toEqual(first.candidates.map((x) => x.score))
    expect(again).toEqual(first)
    // Ties keep the earlier window.
    for (let i = 1; i < first.candidates.length; i++)
      if (first.candidates[i].score === first.candidates[i - 1].score)
        expect(first.candidates[i].window.startMs).toBeGreaterThan(first.candidates[i - 1].window.startMs)
  })
})

/* -------------------------------------------------------------- the hour */

describe('size: a synthetic hour', () => {
  it('windows, signals, prefilter and text for all four lengths well inside the pinned bound', () => {
    // 10,800 words over an hour (~3 words a second), sentences of 8..14 words.
    // MUTATION (transcriptTraits recounts the words for each word: quadratic): fails "toBeLessThan(HOUR_BOUND_MS)".
    const HOUR_BOUND_MS = 1500
    const sentences: string[][] = []
    const r = rng(77)
    let n = 0
    while (n < 10_800) {
      const len = Math.min(10_800 - n, 8 + Math.floor(r() * 7))
      sentences.push(Array.from({ length: len }, () => latin(Math.floor(r() * 50))))
      n += len
    }
    const t = transcriptOf(talk(sentences, '.', 260, 40, 200))
    expect(t.words.length).toBe(10_800)
    expect(t.durationMs).toBeGreaterThan(3_300_000)
    const heat = flatHeat(t.durationMs / 1000).map((b, i) => ({ ...b, value: (i * 37) % 100 / 100 }))
    const began = performance.now()
    let windows = 0
    for (const target of [60_000, 120_000, 180_000, 240_000]) {
      const c = candidatesFor(t, target, heat)
      windows += c.windows.length
      expect(c.candidates.length).toBeGreaterThanOrEqual(3)
      expect(c.candidates.length).toBeLessThanOrEqual(MAX_CANDIDATES)
    }
    const took = performance.now() - began
    console.log(`bestClips hour: ${t.words.length} words, ${clipSegments(t).length} capped segments, ${windows} windows over four lengths, ${took.toFixed(0)} ms`)
    expect(took).toBeLessThan(HOUR_BOUND_MS)
  })
})
