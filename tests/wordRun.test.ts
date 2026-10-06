import { describe, expect, it } from 'vitest'
import {
  clampRun,
  extendRun,
  msAtY,
  rowOfWord,
  rowsOf,
  runFromRows,
  runOfChapter,
  runRange,
  snapHandle,
  stepHandle,
  type WordRun
} from '@shared/ingest/wordRun'
import { MIN_RANGE_MS } from '@shared/ingest/section'
import { shiftTranscript } from '@shared/ingest/captions'
import { PAUSE_BOUNDARY_MS, segmentIntoSentences, type Transcript, type Word } from '@shared/transcript'

/*
 * A run of words picked from a transcript's rows (docs/CLIPS.md §3b.2, §3b.3,
 * §3b.8): click and shift-click, the two cut handles, a chapter, and the range
 * a run downloads. Every transcript here is made up — NATO letters and
 * numbers, nobody's speech.
 */

interface Spec {
  text: string
  start: number
  end: number
}

function transcriptOf(spec: Spec[]): Transcript {
  const words: Word[] = spec.map((w, i) => ({ index: i, text: w.text, startMs: w.start, endMs: w.end, confidence: null }))
  return {
    assetId: 'url:test',
    language: 'en',
    model: 'youtube-asr',
    durationMs: words.length > 0 ? words[words.length - 1].endMs : 0,
    words,
    segments: segmentIntoSentences(words, PAUSE_BOUNDARY_MS, { maxWords: 30, maxMs: 15_000 })
  }
}

/** Four words a row, 400 ms apart and 300 ms long, a full stop ending each row; rows at the given starts. */
function rowsAt(starts: number[]): Transcript {
  const names = ['alpha', 'bravo', 'charlie', 'delta']
  return transcriptOf(
    starts.flatMap((at, r) =>
      names.map((name, k) => ({ text: k === 3 ? `${name}${r}.` : name, start: at + k * 400, end: at + k * 400 + 300 }))
    )
  )
}

/** A deterministic generator, so a failing property names its seed. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random transcript: words with random lengths and gaps, now and then a pause or a full stop. */
function randomTranscript(next: () => number): Transcript {
  const n = 2 + Math.floor(next() * 120)
  const spec: Spec[] = []
  let at = Math.floor(next() * 5000)
  for (let i = 0; i < n; i++) {
    const length = 60 + Math.floor(next() * 540)
    const gap = next() < 0.1 ? 700 + Math.floor(next() * 2000) : Math.floor(next() * 200)
    spec.push({ text: next() < 0.08 ? `word${i}.` : `word${i}`, start: at, end: at + length })
    at += length + gap + 1
  }
  return transcriptOf(spec)
}

describe('the rows', () => {
  it('are the capped segments, every word in one row, in order', () => {
    const t = rowsAt([1000, 5000, 9000])
    const rows = rowsOf(t)
    expect(rows.map((r) => r.words)).toEqual([
      [0, 3],
      [4, 7],
      [8, 11]
    ])
    expect(rows[1].startMs).toBe(5000)
    // Computed once per transcript: the handles redraw on every pointer move.
    expect(rowsOf(t)).toBe(rows)
    expect(rowOfWord(rows, 6)).toBe(1)
    expect(rowOfWord(rows, 99)).toBe(-1)
  })

  it('cap a pause-free run at 30 words, as every YouTube track is (§7.2)', () => {
    const spec: Spec[] = Array.from({ length: 80 }, (_, i) => ({ text: `w${i}`, start: i * 300, end: i * 300 + 300 }))
    const words: Word[] = spec.map((w, i) => ({ index: i, text: w.text, startMs: w.start, endMs: w.end, confidence: null }))
    // Segmented WITHOUT the cap, as a transcript stored before it existed would be.
    const t: Transcript = { assetId: 'a', language: 'en', model: 'm', durationMs: 24_000, words, segments: segmentIntoSentences(words) }
    expect(t.segments).toHaveLength(1)
    const rows = rowsOf(t)
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) expect(row.words[1] - row.words[0] + 1).toBeLessThanOrEqual(30)
  })
})

describe('click and shift-click', () => {
  it('a click picks a row’s words; a shift-click on another row covers every row between, either way', () => {
    const t = rowsAt([1000, 5000, 9000])
    expect(runFromRows(t, 1, 1)).toEqual({ from: 4, to: 7 })
    expect(runFromRows(t, 0, 2)).toEqual({ from: 0, to: 11 })
    expect(runFromRows(t, 2, 1)).toEqual({ from: 4, to: 11 })
  })

  it('a shift-click on a word moves the run’s end to it, or its start back to it', () => {
    expect(extendRun({ from: 4, to: 7 }, 9)).toEqual({ from: 4, to: 9 })
    expect(extendRun({ from: 4, to: 7 }, 5)).toEqual({ from: 4, to: 5 })
    expect(extendRun({ from: 4, to: 7 }, 2)).toEqual({ from: 2, to: 7 })
    expect(extendRun(null, 3)).toEqual({ from: 3, to: 3 })
  })
})

describe('the cut handles', () => {
  const t = rowsAt([1000, 5000, 9000])

  it('snap Start to a word’s start and End to a word’s end — a word inside a row, not the row', () => {
    // Row 2's words start at 5000, 5400, 5800, 6200 and end 300 ms later.
    // 5750 is nearest the third word's start; a row-level snap would give the row's first word.
    expect(snapHandle(t, 'start', 5750, { from: 0, to: 11 })).toEqual({ from: 6, to: 11 })
    // 5650 is nearest the second word's END (5700), not the first's (5300).
    expect(snapHandle(t, 'end', 5650, { from: 4, to: 11 })).toEqual({ from: 4, to: 5 })
  })

  it('never let one handle pass the other', () => {
    // Start dragged past the run's end stops at its last word; End dragged before its start stops at its first.
    expect(snapHandle(t, 'start', 9000, { from: 6, to: 7 })).toEqual({ from: 7, to: 7 })
    expect(snapHandle(t, 'end', 1000, { from: 6, to: 7 })).toEqual({ from: 6, to: 6 })
    // And a run handed in backwards or out of range comes out ordered and inside the transcript.
    expect(clampRun(t, { from: 30, to: -4 })).toEqual({ from: 0, to: 11 })
    expect(snapHandle(t, 'start', -500, { from: 3, to: 2 })).toEqual({ from: 0, to: 3 })
  })

  it('move a word at a time from the keyboard, and stop at the other handle and at the ends', () => {
    expect(stepHandle(t, 'start', 1, { from: 4, to: 7 })).toEqual({ from: 5, to: 7 })
    expect(stepHandle(t, 'start', 1, { from: 7, to: 7 })).toEqual({ from: 7, to: 7 })
    expect(stepHandle(t, 'end', -1, { from: 7, to: 7 })).toEqual({ from: 7, to: 7 })
    expect(stepHandle(t, 'end', 1, { from: 4, to: 11 })).toEqual({ from: 4, to: 11 })
    expect(stepHandle(t, 'start', -1, { from: 0, to: 3 })).toEqual({ from: 0, to: 3 })
  })

  it('read a pointer along the rows: the row under it, that far through its span', () => {
    const boxes = [
      { top: 0, bottom: 40, startMs: 1000, endMs: 2500 },
      { top: 40, bottom: 80, startMs: 5000, endMs: 6500 },
      { top: 90, bottom: 130, startMs: 9000, endMs: 10_500 }
    ]
    expect(msAtY(boxes, -20)).toBe(1000)
    expect(msAtY(boxes, 500)).toBe(10_500)
    expect(msAtY(boxes, 60)).toBe(5750)
    // A gap between two rows reads as the start of the next.
    expect(msAtY(boxes, 85)).toBe(9000)
    expect(msAtY([], 10)).toBeNull()
  })
})

describe('a chapter', () => {
  it('picks exactly the words whose start lies in [start, end): the one at start_time in, the one at end_time out', () => {
    // Row 2's first word starts exactly at 5 s; row 3's exactly at 9 s.
    const t = rowsAt([1000, 5000, 9000])
    expect(t.words[4].startMs).toBe(5000)
    expect(t.words[8].startMs).toBe(9000)
    expect(runOfChapter(t, { start_time: 5, end_time: 9 })).toEqual({ from: 4, to: 7 })
    expect(runOfChapter(t, { start_time: 0, end_time: 5 })).toEqual({ from: 0, to: 3 })
    // A chapter with no word starting in it picks nothing.
    expect(runOfChapter(t, { start_time: 20, end_time: 30 })).toBeNull()
  })

  it('reads a fractional boundary as the whole millisecond it names: a word at 4030 ms is in the chapter from 4.03 s', () => {
    // 4.03 * 1000 is 4030.0000000000005 — compared unrounded, the word at 4030 would fall into the chapter before.
    expect(4.03 * 1000).not.toBe(4030)
    const t = transcriptOf([
      { text: 'kilo', start: 3000, end: 3300 },
      { text: 'lima', start: 4030, end: 4300 },
      { text: 'mike', start: 4600, end: 4900 }
    ])
    expect(runOfChapter(t, { start_time: 4.03, end_time: 6 })).toEqual({ from: 1, to: 2 })
    expect(runOfChapter(t, { start_time: 0, end_time: 4.03 })).toEqual({ from: 0, to: 0 })
  })
})

describe('the range a run downloads', () => {
  it('runs from the first word’s start to the last word’s end, short of the next word', () => {
    const t = rowsAt([1000, 5000, 9000])
    expect(runRange(t, { from: 4, to: 7 })).toEqual({ startMs: 5000, endMs: 6500 })
    expect(runRange(t, { from: 4, to: 7 }).endMs).toBeLessThan(t.words[8].startMs)
  })

  it('is a second long for a one-word run, and the clip still holds that one word — not the neighbour 350 ms on', () => {
    const t = transcriptOf([
      { text: 'kilo', start: 18_000, end: 18_300 },
      { text: 'lima', start: 20_000, end: 20_250 },
      { text: 'mike', start: 20_350, end: 20_700 },
      { text: 'november.', start: 21_500, end: 21_900 }
    ])
    const run: WordRun = { from: 1, to: 1 }
    const range = runRange(t, run)
    expect(range).toEqual({ startMs: 20_000, endMs: 20_000 + MIN_RANGE_MS })
    // The widened range reaches "mike"…
    expect(range.endMs).toBeGreaterThan(t.words[2].startMs)
    // …and the collected words are still the run's alone, on the clip's clock.
    const clip = shiftTranscript(t, range, 0, 'asset-1', run)
    expect(clip.words.map((w) => w.text)).toEqual(['lima'])
    expect(clip.words[0].startMs).toBe(0)
  })

  it('never reaches the next unpicked word unless the run is under a second (a property over random transcripts)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const next = random(seed)
      const t = randomTranscript(next)
      const a = Math.floor(next() * t.words.length)
      const b = Math.floor(next() * t.words.length)
      const run = clampRun(t, { from: a, to: b })
      const range = runRange(t, run)
      expect(range.startMs, `seed ${seed}`).toBe(t.words[run.from].startMs)
      expect(range.endMs - range.startMs, `seed ${seed}`).toBeGreaterThanOrEqual(MIN_RANGE_MS)
      const after = t.words[run.to + 1]
      const spoken = t.words[run.to].endMs - t.words[run.from].startMs
      if (after && spoken >= MIN_RANGE_MS) expect(range.endMs, `seed ${seed}`).toBeLessThanOrEqual(after.startMs)
    }
  })
})

describe('both ways of picking set the same thing', () => {
  it('click and shift-click, and the handles dragged onto the same words, give the same run and the same range (a property)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const next = random(seed * 7919)
      const t = randomTranscript(next)
      const rows = rowsOf(t)
      const a = Math.floor(next() * rows.length)
      const b = Math.floor(next() * rows.length)
      const clicked = runFromRows(t, a, b)

      // The handles rest at the ends with nothing picked; Start is dragged to the
      // run's first word's start, then End to its last word's end.
      const all: WordRun = { from: 0, to: t.words.length - 1 }
      const started = snapHandle(t, 'start', t.words[clicked.from].startMs, all)
      const dragged = snapHandle(t, 'end', t.words[clicked.to].endMs, started)

      expect(dragged, `seed ${seed}`).toEqual(clicked)
      expect(runRange(t, dragged), `seed ${seed}`).toEqual(runRange(t, clicked))
    }
  })
})
