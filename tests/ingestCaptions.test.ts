import { describe, it, expect } from 'vitest'
import {
  GRAPHEME_MS,
  SEGMENT_MAX_MS,
  SEGMENT_MAX_WORDS,
  WORD_MAX_MS,
  graphemeCount,
  json3Kind,
  mergeTracks,
  parseJson3,
  shiftTranscript,
  transcriptFromTracks,
  wordEstimateMs
} from '@shared/ingest/captions'
import { offsetIntoDownload } from '@shared/ingest/section'
import { PAUSE_BOUNDARY_MS, capSegments, segmentIntoSentences, type Segment, type Transcript, type Word } from '@shared/transcript'

/*
 * json3 → Transcript (docs/CLIPS.md §7.2, §7.7).
 *
 * Every fixture is BUILT here, in the structure measured on real tracks
 * (docs/EFFECTS.md §40) — a window event, roll-up word events whose first seg
 * sits at `tStartMs` and the rest at `tOffsetMs`, `acAsrConf` 0, "\n" aAppend
 * events between lines — from made-up words. No one's speech is committed.
 */

type Seg = { utf8: string; tOffsetMs?: number; acAsrConf?: number }
type Ev = { tStartMs: number; dDurationMs?: number; segs?: Seg[]; aAppend?: number; wWinId?: number; id?: number }

const WINDOW: Ev = { tStartMs: 0, dDurationMs: 600_000, id: 1 }

/** An ASR word event: [word, offset from the event's start]. The first word has no tOffsetMs, as measured. */
function asr(tStartMs: number, dDurationMs: number, words: [string, number][]): Ev {
  return {
    tStartMs,
    dDurationMs,
    wWinId: 1,
    segs: words.map(([w, off], k) =>
      k === 0 && off === 0 ? { utf8: w, acAsrConf: 0 } : { utf8: ` ${w}`, tOffsetMs: off, acAsrConf: 0 }
    )
  }
}
const newline = (tStartMs: number): Ev => ({ tStartMs, dDurationMs: 2000, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] })
const track = (...events: Ev[]): unknown => ({ wireMagic: 'pb3', events: [WINDOW, ...events] })
const lines = (...events: { tStartMs: number; dDurationMs: number; text: string }[]): unknown => ({
  wireMagic: 'pb3',
  events: events.map((e) => ({ tStartMs: e.tStartMs, dDurationMs: e.dDurationMs, segs: [{ utf8: e.text }] }))
})

/** Words spaced `step` ms apart from `at`, as [word, offset] pairs. */
function evenly(words: string[], step: number, at = 0): [string, number][] {
  return words.map((w, k) => [w, at + k * step])
}

const texts = (t: Transcript): string[] => t.words.map((w) => w.text)
/** Inclusive POSITION ranges of each segment (the fixtures' indices are positions). */
const ranges = (segments: Segment[]): [number, number][] => segments.map((s) => [s.wordStart, s.wordEnd])

describe('word timing from json3', () => {
  it('starts each word at tStartMs + tOffsetMs, the first seg at tStartMs', () => {
    const t = parseJson3(track(asr(10_000, 3_000, [['one', 0], ['two', 240], ['three', 560]])), 'a', 'youtube-asr')
    expect(t.words.map((w) => w.startMs)).toEqual([10_000, 10_240, 10_560])
  })

  it('ends a word at the next word, the event end or the grapheme cap — whichever is first', () => {
    const t = parseJson3(
      track(
        // "international" (13 graphemes, estimate capped at 600) is followed 300 ms later: the NEXT START ends it.
        // "cat" (3 graphemes, 240 ms) is followed 900 ms later: the GRAPHEME CAP ends it.
        // "tomorrow" (8, capped at 600) starts 100 ms before its event ends at 21 300: the EVENT END ends it.
        asr(20_000, 1_300, [['international', 0], ['cat', 300], ['tomorrow', 1_200]]),
        // "extraordinary" (13) with two seconds to the next word: the 600 ms CEILING ends it.
        asr(25_000, 9_000, [['extraordinary', 0], ['end', 2_000]])
      ),
      'a',
      'youtube-asr'
    )
    const end = (text: string): number => t.words.find((w) => w.text === text)!.endMs
    expect(end('international')).toBe(20_300)
    expect(end('cat')).toBe(20_300 + 3 * GRAPHEME_MS)
    expect(end('tomorrow')).toBe(21_300)
    expect(end('extraordinary')).toBe(25_000 + WORD_MAX_MS)
    expect(wordEstimateMs('extraordinary')).toBe(WORD_MAX_MS)
  })

  it('leaves confidence null, never 0 — the panel underlines anything under 0.5', () => {
    const t = parseJson3(track(asr(0, 2_000, evenly(['one', 'two', 'three'], 300))), 'a', 'youtube-asr')
    // TranscriptPanel.tsx's own rule, word for word.
    const unsure = (w: Word): boolean => w.confidence !== null && w.confidence < 0.5
    expect(t.words.length).toBe(3)
    for (const w of t.words) {
      expect(w.confidence, w.text).toBeNull()
      expect(unsure(w), w.text).toBe(false)
    }
  })

  it('drops "\\n" segs and bracket tags, and keeps every spoken word', () => {
    const t = parseJson3(
      track(
        { tStartMs: 100, dDurationMs: 4_000, wWinId: 1, segs: [{ utf8: '[Music]' }] },
        newline(4_990),
        asr(5_000, 3_000, [['hello', 0], ['[ __ ]', 300], ['there', 600]]),
        newline(7_990),
        asr(8_000, 3_000, [['again', 0]])
      ),
      'a',
      'youtube-asr'
    )
    expect(texts(t)).toEqual(['hello', 'there', 'again'])
    for (const w of t.words) {
      expect(w.text).not.toContain('\n')
      expect(w.text).not.toContain('[')
    }
  })

  it('handles overlapping roll-up events: no word runs into the next, none ends before it starts', () => {
    // Each event's display runs on past the next event's start, as 97–99% did on the measured tracks.
    const t = parseJson3(
      track(
        asr(1_000, 7_000, evenly(['one', 'two', 'three', 'four'], 300)),
        newline(2_190),
        asr(2_200, 7_000, evenly(['five', 'six', 'seven', 'eight'], 300)),
        newline(3_390),
        asr(3_400, 7_000, evenly(['nine', 'ten'], 300))
      ),
      'a',
      'youtube-asr'
    )
    expect(t.words.length).toBe(10)
    for (let i = 0; i < t.words.length; i++) {
      const w = t.words[i]
      expect(w.endMs, w.text).toBeGreaterThanOrEqual(w.startMs)
      if (i + 1 < t.words.length) expect(w.endMs, w.text).toBeLessThanOrEqual(t.words[i + 1].startMs)
    }
  })

  it('spreads an uploader line over its words by grapheme count, and says the times are approximate', () => {
    // 3 + 3 + 5 + 4 = 15 graphemes over 1500 ms: 100 ms a grapheme.
    const t = parseJson3(lines({ tStartMs: 1_000, dDurationMs: 1_500, text: 'one two three four' }), 'a', 'youtube-lines')
    expect(t.words.map((w) => w.startMs)).toEqual([1_000, 1_300, 1_600, 2_100])
    expect(t.words.map((w) => w.endMs)).toEqual([1_300, 1_600, 2_100, 2_500])
    expect(t.approximate).toBe(true)
    expect(t.model).toBe('youtube-lines')
  })

  it('keeps two overlapping uploader lines in order, each spread no further than the next line', () => {
    // On screen together for two seconds. Spread to their own ends and sorted
    // by start, these interleaved: one two five three six four seven eight.
    const t = parseJson3(
      lines(
        { tStartMs: 1_000, dDurationMs: 3_000, text: 'one two three four' },
        { tStartMs: 2_000, dDurationMs: 3_000, text: 'five six seven eight' }
      ),
      'a',
      'youtube-lines'
    )
    expect(texts(t)).toEqual(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'])
    expect(t.words[3].startMs).toBeLessThan(2_000)
    expect(t.words[4].startMs).toBe(2_000)
  })

  it('counts graphemes, not code points, so a Devanagari word is not doubled', () => {
    expect(graphemeCount('है')).toBe(1) // ह + the vowel sign ै
    expect(graphemeCount('cat')).toBe(3)
  })
})

describe('segments of a YouTube track', () => {
  it('breaks at each 1 s pause INSIDE one roll-up event — which only the word-end estimate can see', () => {
    // One event, no event gap anywhere. Short words 300 ms apart (each ends on
    // the next one's start), with a second's silence after "four" and "eight".
    const words: [string, number][] = [
      ...evenly(['one', 'two', 'three', 'four'], 300, 0),
      ...evenly(['five', 'six', 'seven', 'eight'], 300, 900 + 4 * GRAPHEME_MS + 1_000),
      ...evenly(['nine', 'ten', 'eleven', 'twelve'], 300, 900 + 4 * GRAPHEME_MS + 1_000 + 900 + 5 * GRAPHEME_MS + 1_000)
    ]
    const t = parseJson3(track(asr(0, 20_000, words)), 'a', 'youtube-asr')
    expect(ranges(t.segments)).toEqual([
      [0, 3],
      [4, 7],
      [8, 11]
    ])
  })

  it('breaks between events where the event gap is a pause — the pause rule, the event end keeping the gap', () => {
    const t = parseJson3(
      track(
        asr(0, 1_200, evenly(['one', 'two', 'three', 'four'], 300)),
        // Starts a second after the first event's display ends.
        asr(2_200, 1_200, evenly(['five', 'six', 'seven', 'eight'], 300))
      ),
      'a',
      'youtube-asr'
    )
    expect(ranges(t.segments)).toEqual([
      [0, 3],
      [4, 7]
    ])
  })

  it('breaks at an event gap the word gap does not show — the event-gap rule alone', () => {
    // "cc" starts 500 ms past its event's end (a tOffsetMs beyond dDurationMs),
    // so its end clamps to its start and the word gap to "dd" is 500 ms: under
    // the pause rule. The events are a second apart; only that rule breaks here.
    const t = parseJson3(
      track(
        asr(0, 1_000, [['aa', 0], ['bb', 300], ['cc', 1_500]]),
        asr(2_000, 1_000, [['dd', 0], ['ee', 300]])
      ),
      'a',
      'youtube-asr'
    )
    expect(texts(t)).toEqual(['aa', 'bb', 'cc', 'dd', 'ee'])
    expect(t.words[3].startMs - t.words[2].endMs).toBeLessThan(PAUSE_BOUNDARY_MS)
    expect(ranges(t.segments)).toEqual([
      [0, 1],
      [2, 2],
      [3, 4]
    ])
  })

  it('splits a pause-free run of 80 words by the cap: none over 30 words or 15 s, every word once', () => {
    // 80 words 300 ms apart (24 s), unpunctuated, each ending on the next.
    const words = Array.from({ length: 80 }, (_, k) => `word${k}`)
    const events: Ev[] = []
    for (let e = 0; e < 8; e++) {
      events.push(asr(e * 3_000, 6_000, evenly(words.slice(e * 10, e * 10 + 10), 300)))
    }
    const t = parseJson3(track(...events), 'a', 'youtube-asr')
    expect(t.words.length).toBe(80)
    expect(t.segments.length).toBeGreaterThan(1)
    for (const s of t.segments) {
      expect(s.wordEnd - s.wordStart + 1, s.id).toBeLessThanOrEqual(SEGMENT_MAX_WORDS)
      expect(s.endMs - s.startMs, s.id).toBeLessThanOrEqual(SEGMENT_MAX_MS)
    }
    expect(t.segments.flatMap((s) => Array.from({ length: s.wordEnd - s.wordStart + 1 }, (_, k) => s.wordStart + k))).toEqual(
      t.words.map((w) => w.index)
    )
  })

  it('splits a Hindi track where a line ends in the danda', () => {
    // Fluent — every word ends on the next one's start, no pause anywhere — so
    // only the danda can end the first sentence. Made-up words.
    const t = parseJson3(
      track(asr(0, 6_000, evenly(['यह', 'पहली', 'पंक्ति', 'है।', 'यह', 'दूसरी', 'है॥', 'और', 'आगे'], 150))),
      'a',
      'youtube-asr',
      'hi'
    )
    expect(ranges(t.segments)).toEqual([
      [0, 3],
      [4, 6],
      [7, 8]
    ])
  })

  it('keeps a danda set off by a space with the word before it', () => {
    const t = parseJson3(track(asr(0, 3_000, evenly(['यह', 'है', '।', 'और'], 150))), 'a', 'youtube-asr', 'hi')
    expect(texts(t)).toEqual(['यह', 'है।', 'और'])
    expect(ranges(t.segments)).toEqual([
      [0, 1],
      [2, 2]
    ])
  })
})

describe('the cap is off unless asked for', () => {
  const run = (n: number): Word[] =>
    Array.from({ length: n }, (_, k) => ({ index: k, text: `w${k}`, startMs: k * 300, endMs: (k + 1) * 300, confidence: 0.9 }))

  it('leaves the Director a 100-word pause-free run as one segment', () => {
    expect(segmentIntoSentences(run(100))).toHaveLength(1)
  })

  it('splits equal gaps into pieces of a readable size, not one word at a time off the front', () => {
    const segments = segmentIntoSentences(run(80), 700, { maxWords: 30, maxMs: 15_000 })
    for (const s of segments) {
      const size = s.wordEnd - s.wordStart + 1
      expect(size, s.id).toBeLessThanOrEqual(30)
      // Peeling off the front leaves crumbs of one word; ten is far from that.
      expect(size, s.id).toBeGreaterThanOrEqual(10)
    }
    expect(segments.flatMap((s) => Array.from({ length: s.wordEnd - s.wordStart + 1 }, (_, k) => s.wordStart + k))).toEqual(
      Array.from({ length: 80 }, (_, k) => k)
    )
  })
})

describe('capSegments — rows and menus, never written back', () => {
  // A 520 ms gap after word 30: under the 700 ms pause rule, so the Director's
  // segmentation leaves words 10–49 as one 40-word segment.
  const words: Word[] = Array.from({ length: 50 }, (_, k) => ({
    index: k,
    text: k === 9 ? 'stop.' : `w${k}`,
    startMs: k * 300 + (k > 30 ? 500 : 0),
    endMs: k * 300 + 280 + (k > 30 ? 500 : 0),
    confidence: null
  }))
  const t: Transcript = {
    assetId: 'a',
    language: 'en',
    model: 'faster-whisper',
    durationMs: 20_000,
    words,
    // As the Director segments: punctuation and pauses, no cap.
    segments: segmentIntoSentences(words)
  }

  it('returns a capped copy and leaves the transcript exactly as it was', () => {
    const deepFreeze = <T>(o: T): T => {
      if (o && typeof o === 'object') {
        for (const v of Object.values(o)) deepFreeze(v)
        Object.freeze(o)
      }
      return o
    }
    const frozen = deepFreeze(structuredClone(t))
    const before = JSON.stringify(frozen)
    const capped = capSegments(frozen, 30, 15_000)
    expect(JSON.stringify(frozen)).toBe(before)
    expect(capped).not.toBe(frozen.segments)

    // [0..9] ends on "stop."; [10..49] is 40 words, split at its largest gap.
    expect(ranges(frozen.segments)).toEqual([
      [0, 9],
      [10, 49]
    ])
    expect(ranges(capped)).toEqual([
      [0, 9],
      [10, 30],
      [31, 49]
    ])
    // Within the cap: the very same object.
    expect(capped[0]).toBe(frozen.segments[0])
    for (const s of capped) expect(s.wordEnd - s.wordStart + 1, s.id).toBeLessThanOrEqual(30)
  })

  it('splits only what is over the cap, at its largest gap, with unique ids', () => {
    const long: Word[] = Array.from({ length: 40 }, (_, k) => ({
      index: k,
      text: `w${k}`,
      startMs: k * 300 + (k >= 25 ? 500 : 0),
      endMs: k * 300 + 280 + (k >= 25 ? 500 : 0),
      confidence: null
    }))
    const one: Transcript = { ...t, words: long, segments: segmentIntoSentences(long) }
    expect(one.segments).toHaveLength(1)
    const capped = capSegments(one, 30, 15_000)
    // The 520 ms gap before word 25 is the largest: the split is there, not at the middle.
    expect(ranges(capped)).toEqual([
      [0, 24],
      [25, 39]
    ])
    expect(capped.map((s) => s.id)).toEqual(['s1.1', 's1.2'])
  })
})

describe('shiftTranscript — onto a ranged download', () => {
  // Words every 500 ms from 58 s, each 300 ms long.
  const words: Word[] = Array.from({ length: 24 }, (_, k) => ({
    index: k,
    text: `w${k}`,
    startMs: 58_000 + k * 500,
    endMs: 58_300 + k * 500,
    confidence: null
  }))
  const t: Transcript = { assetId: 'url:x', language: 'en', model: 'youtube-asr', durationMs: 80_000, words, segments: segmentIntoSentences(words) }
  const range = { startMs: 60_000, endMs: 66_000 }

  it('keeps the words that start in the range and moves them onto an exact cut (head 0)', () => {
    const s = shiftTranscript(t, range, 0, 'asset-1')
    expect(s.assetId).toBe('asset-1')
    expect(texts(s)).toEqual(Array.from({ length: 12 }, (_, k) => `w${k + 4}`))
    expect(s.words[0]).toMatchObject({ index: 0, startMs: 0, endMs: 300 })
    expect(s.words.map((w) => w.index)).toEqual(s.words.map((_, i) => i))
  })

  it('moves them onto a fast cut, which starts offsetIntoDownload early', () => {
    const head = offsetIntoDownload(range)
    expect(head).toBe(10_000)
    const s = shiftTranscript(t, range, head, 'asset-1')
    expect(s.words[0].startMs).toBe(10_000)
    expect(texts(s)[0]).toBe('w4')
  })

  it('with a run, keeps EXACTLY the run — not a neighbour the widened range reaches', () => {
    // A one-word run (w10, 63 000–63 300), downloaded a full second wide; w11
    // starts 200 ms after w10 ends — inside that second, and not picked.
    const runRange = { startMs: 63_000, endMs: 64_000 }
    expect(words[11].startMs).toBeLessThan(runRange.endMs)
    const s = shiftTranscript(t, runRange, 0, 'asset-1', { from: 10, to: 10 })
    expect(texts(s)).toEqual(['w10'])
    expect(s.words[0]).toMatchObject({ index: 0, startMs: 0 })
  })

  it('keeps the approximate mark through the shift, and adds none', () => {
    const spreadLine: Transcript = { ...t, model: 'youtube-lines', approximate: true }
    expect(shiftTranscript(spreadLine, range, 0, 'asset-1').approximate).toBe(true)
    expect(shiftTranscript(spreadLine, range, 0, 'asset-1', { from: 10, to: 11 }).approximate).toBe(true)
    expect(shiftTranscript(t, range, 0, 'asset-1').approximate).toBeUndefined()
  })

  it('keeps a neighbour 350 ms away out of a three-word run', () => {
    const near: Word[] = [
      { index: 0, text: 'a', startMs: 1_000, endMs: 1_200, confidence: null },
      { index: 1, text: 'b', startMs: 1_200, endMs: 1_400, confidence: null },
      { index: 2, text: 'c', startMs: 1_400, endMs: 1_600, confidence: null },
      { index: 3, text: 'neighbour', startMs: 1_950, endMs: 2_300, confidence: null }
    ]
    const nt: Transcript = { ...t, words: near, segments: segmentIntoSentences(near) }
    const s = shiftTranscript(nt, { startMs: 1_000, endMs: 2_000 }, 0, 'asset-2', { from: 0, to: 2 })
    expect(texts(s)).toEqual(['a', 'b', 'c'])
  })
})

describe('which track wins (CLIPS.md §16.12)', () => {
  const asrWords = ['so', 'this', 'is', 'the', 'first', 'line', 'and', 'here', 'is', 'another']
  // The ASR: unpunctuated, word-timed, on the video's clock.
  const asrJson = track(
    asr(20_000, 4_000, evenly(asrWords.slice(0, 6), 300)),
    newline(21_790),
    asr(23_000, 4_000, evenly(asrWords.slice(6), 300))
  )
  // The uploader's: punctuated, line-timed — and 12 s early, as measured on one video.
  const upJson = lines(
    { tStartMs: 8_000, dDurationMs: 2_000, text: 'So this is the first line.' },
    { tStartMs: 11_000, dDurationMs: 2_000, text: 'And here is another.' }
  )

  it('tells the tracks apart by their contents', () => {
    expect(json3Kind(asrJson)).toBe('asr')
    expect(json3Kind(upJson)).toBe('lines')
    expect(json3Kind({ events: [{ tStartMs: 0, segs: [{ utf8: '\n' }] }] })).toBeNull()
  })

  it('takes the uploader’s words at the ASR’s times, across a 12 s clock offset', () => {
    const merged = mergeTracks(parseJson3(asrJson, 'x', 'youtube-asr'), upJson, 'x')
    expect(merged.model).toBe('youtube-asr+lines')
    expect(texts(merged)).toEqual(['So', 'this', 'is', 'the', 'first', 'line.', 'And', 'here', 'is', 'another.'])
    expect(merged.words.map((w) => w.startMs)).toEqual([
      20_000, 20_300, 20_600, 20_900, 21_200, 21_500, 23_000, 23_300, 23_600, 23_900
    ])
    for (const w of merged.words) expect(w.confidence, w.text).toBeNull()
    expect(merged.approximate).toBeUndefined()
    expect(ranges(merged.segments)).toEqual([
      [0, 5],
      [6, 9]
    ])
  })

  it('prefers the -orig ASR, merges the uploader’s track when there is one, and is null with none', () => {
    const both = transcriptFromTracks(
      [
        { key: 'en', kind: 'lines', json: upJson },
        { key: 'en-orig', kind: 'asr', json: asrJson }
      ],
      'x',
      'en'
    )
    expect(both?.model).toBe('youtube-asr+lines')
    // No uploader track: `en` is a copy of the ASR (measured) — the -orig one is read.
    const copy = track(asr(0, 2_000, evenly(['copy'], 300)))
    const asrOnly = transcriptFromTracks(
      [
        { key: 'en', kind: 'asr', json: copy },
        { key: 'en-orig', kind: 'asr', json: asrJson }
      ],
      'x',
      'en'
    )
    expect(asrOnly?.model).toBe('youtube-asr')
    expect(texts(asrOnly!)).toEqual(asrWords)
    expect(transcriptFromTracks([], 'x', 'en')).toBeNull()
  })

  it('places an uploader word the ASR did not hear between its neighbours, and says so', () => {
    const merged = mergeTracks(
      parseJson3(track(asr(10_000, 3_000, evenly(['alpha', 'bravo', 'charlie', 'delta'], 300))), 'x', 'youtube-asr'),
      lines({ tStartMs: 10_000, dDurationMs: 1_500, text: 'Alpha bravo zulu charlie delta.' }),
      'x'
    )
    expect(texts(merged)).toEqual(['Alpha', 'bravo', 'zulu', 'charlie', 'delta.'])
    const at = (text: string): number => merged.words.find((w) => w.text === text)!.startMs
    expect(at('zulu')).toBeGreaterThan(at('bravo'))
    expect(at('zulu')).toBeLessThan(at('charlie'))
    expect(merged.approximate).toBe(true)
  })

  it('ends a segment at a line gap the words do not show', () => {
    // Long words 800 ms apart: each ends 200 ms before the next (the 600 ms
    // ceiling), so the words alone never pause. The uploader's lines are
    // 700 ms apart between the fourth word and the fifth.
    const words = ['aardvarks', 'buffaloes', 'chipmunks', 'dolphins', 'elephants', 'flamingos', 'giraffes', 'hedgehogs']
    const merged = mergeTracks(
      parseJson3(track(asr(10_000, 8_000, evenly(words, 800))), 'x', 'youtube-asr'),
      lines(
        { tStartMs: 10_000, dDurationMs: 2_500, text: words.slice(0, 4).join(' ') },
        { tStartMs: 13_200, dDurationMs: 3_000, text: words.slice(4).join(' ') }
      ),
      'x'
    )
    expect(texts(merged)).toEqual(words)
    expect(merged.approximate).toBeUndefined()
    expect(merged.words[4].startMs - merged.words[3].endMs).toBeLessThan(PAUSE_BOUNDARY_MS)
    expect(merged.segments.some((s) => s.wordEnd === 3)).toBe(true)
    expect(merged.segments.some((s) => s.wordStart === 4)).toBe(true)
  })

  it('glues a danda set off by a space, in a line or opening the next, as the lone track does', () => {
    const asrT = parseJson3(track(asr(0, 3_000, evenly(['यह', 'है', 'और', 'वह'], 300))), 'x', 'youtube-asr', 'hi')
    const oneLine = lines({ tStartMs: 0, dDurationMs: 2_000, text: 'यह है । और वह' })
    const twoLines = lines({ tStartMs: 0, dDurationMs: 600, text: 'यह है' }, { tStartMs: 600, dDurationMs: 1_400, text: '। और वह' })
    for (const up of [oneLine, twoLines]) {
      const merged = mergeTracks(asrT, up, 'x', 'hi')
      for (const w of merged.words) expect(w.text, w.text).toMatch(/[\p{L}\p{M}\p{N}]/u)
      expect(merged.words.map((w) => w.text)).toContain('है।')
      expect(texts(merged)).toEqual(texts(parseJson3(up, 'x', 'youtube-lines', 'hi')))
      expect(merged.approximate).toBeUndefined()
    }
  })

  it('re-keys the ASR when the uploader’s track has no line', () => {
    const asrT = parseJson3(asrJson, 'x', 'youtube-asr', 'en')
    const merged = mergeTracks(asrT, { events: [{ tStartMs: 0, segs: [{ utf8: '\n' }] }] }, 'other', 'xx')
    expect(merged).toMatchObject({ assetId: 'other', language: 'xx', model: 'youtube-asr' })
    expect(texts(merged)).toEqual(asrWords)
  })
})

describe('a partial uploader track keeps the speech it did not caption', () => {
  // The uploader captioned only the middle: one line, 10.0–11.0 s.
  const line = lines({ tStartMs: 10_000, dDurationMs: 1_000, text: 'Alpha bravo charlie delta' })

  it('keeps every ASR word outside the lines, with its own text and time, in order', () => {
    const asrT = parseJson3(
      track(
        asr(5_000, 1_000, evenly(['so', 'well'], 300)),
        asr(10_000, 1_500, evenly(['alpha', 'bravo', 'charlie', 'delta'], 300)),
        asr(14_000, 1_500, evenly(['echo', 'foxtrot', 'golf', 'hotel'], 300)),
        asr(18_000, 1_500, evenly(['india', 'juliet', 'kilo', 'lima'], 300))
      ),
      'x',
      'youtube-asr'
    )
    const merged = mergeTracks(asrT, line, 'x')
    const outside = asrT.words.filter((w) => w.startMs <= 10_000 - 700 || w.startMs >= 11_000 + 700)
    expect(outside).toHaveLength(10)
    for (const w of outside) {
      expect(merged.words, w.text).toContainEqual(expect.objectContaining({ text: w.text, startMs: w.startMs }))
    }
    expect(texts(merged)).toEqual([
      'so', 'well', 'Alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima'
    ])
    for (let i = 1; i < merged.words.length; i++) expect(merged.words[i].startMs).toBeGreaterThanOrEqual(merged.words[i - 1].startMs)
    // Every word is timed by the ASR — nothing here was estimated.
    expect(merged.approximate).toBeUndefined()
  })

  it('ends the line’s segment where the uncaptioned speech begins, even without a pause', () => {
    // "delta" is the line's (650 ms past its end, still within reach); "echo"
    // starts 800 ms past it, on "delta"'s heels.
    const asrT = parseJson3(
      track(asr(10_000, 3_000, [['alpha', 0], ['bravo', 300], ['charlie', 600], ['delta', 1_650], ['echo', 1_800], ['foxtrot', 2_100]])),
      'x',
      'youtube-asr'
    )
    const merged = mergeTracks(asrT, line, 'x')
    expect(texts(merged)).toEqual(['Alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'])
    expect(merged.words[4].startMs - merged.words[3].endMs).toBeLessThan(PAUSE_BOUNDARY_MS)
    expect(merged.segments.some((s) => s.wordEnd === 3)).toBe(true)
  })

  it('keeps the ASR’s own segment ends inside an uncaptioned stretch', () => {
    // The event-gap fixture again, after the line: "golf" starts past its
    // event's end, so only the ASR's event-gap break separates it from "hotel".
    const asrT = parseJson3(
      track(
        asr(10_000, 1_500, evenly(['alpha', 'bravo', 'charlie', 'delta'], 300)),
        asr(20_000, 1_000, [['echo', 0], ['foxtrot', 300], ['golf', 1_500]]),
        asr(22_000, 1_000, [['hotel', 0], ['india', 300]])
      ),
      'x',
      'youtube-asr'
    )
    const merged = mergeTracks(asrT, line, 'x')
    const golf = texts(merged).indexOf('golf')
    expect(texts(merged)[golf + 1]).toBe('hotel')
    expect(merged.words[golf + 1].startMs - merged.words[golf].endMs).toBeLessThan(PAUSE_BOUNDARY_MS)
    expect(merged.segments.some((s) => s.wordEnd === golf)).toBe(true)
  })
})
