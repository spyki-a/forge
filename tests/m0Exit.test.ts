import { describe, expect, it } from 'vitest'
import { buildAss, toAssTime } from '@shared/captions/ass'
import { styleById } from '@shared/captions/style'
import { rowsOf } from '@shared/ingest/wordRun'
import { PAUSE_BOUNDARY_MS, segmentIntoSentences, type Transcript, type Word } from '@shared/transcript'
import {
  AMBIGUOUS_BELOW,
  RUN_MAX_WORDS,
  RUN_MIN_WORDS,
  assTimeMs,
  audioLag,
  firstFrameAt,
  frameLabels,
  frameMs,
  frameReading,
  matchFrame,
  matchOnsets,
  noiseFloor,
  parseAss,
  pickMidRun,
  pickRun,
  readOnsets,
  shapingSensitive,
  type AssEvent
} from './fixtures/m0Exit'

/*
 * The readings M0's exit check concludes from (tests/fixtures/m0Exit.ts;
 * the check is tests/integration/m0Exit.int.test.ts, on ten real links).
 * Each is held here to a made-up case whose answer is known, so a reading
 * that is wrong fails in seconds, without YouTube — and each was
 * mutation-checked against these cases. Nothing here is anyone's speech:
 * words are w0, w1, …; pictures and sound are seeded noise.
 */

/** A deterministic generator (mulberry32), so a failing case names its seed. */
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

/**
 * Rows of the given sizes: each word 300 ms after the last, 250 ms long; the
 * row's last word ends with a full stop and a 2 s pause follows, so each row
 * is one segment, and one row (`rowsOf`).
 */
function rowsSized(sizes: number[]): Transcript {
  const words: Word[] = []
  let at = 1000
  for (const size of sizes) {
    for (let k = 0; k < size; k++) {
      const i = words.length
      words.push({ index: i, text: `w${i}${k === size - 1 ? '.' : ''}`, startMs: at, endMs: at + 250, confidence: null })
      at += 300
    }
    at += 2000
  }
  return {
    assetId: 'url:test',
    language: 'en',
    model: 'youtube-asr',
    durationMs: at,
    words,
    segments: segmentIntoSentences(words, PAUSE_BOUNDARY_MS, { maxWords: 30, maxMs: 15_000 })
  }
}

describe('pickRun — the run the check clips', () => {
  // Rows: 5 words, 3, 4, 30, 2.
  const t = rowsSized([5, 3, 4, 30, 2])
  const rows = rowsOf(t)

  it('the fixture has the rows it says', () => {
    expect(rows.map((r) => r.words[1] - r.words[0] + 1)).toEqual([5, 3, 4, 30, 2])
  })

  it('takes the first row starting AT or after the target — a row starting exactly there is taken', () => {
    const picked = pickRun(t, rows[1].startMs)!
    expect(picked.firstRow).toBe(1)
    expect(picked.run.from).toBe(rows[1].words[0])
    // One ms later, the next row.
    expect(pickRun(t, rows[1].startMs + 1)!.firstRow).toBe(2)
  })

  it('extends over the next rows only while the run is under eight words', () => {
    // Row 0 (5) + row 1 (3) = 8: stops there.
    const a = pickRun(t, rows[0].startMs)!
    expect(a.rows).toBe(2)
    expect(a.run).toEqual({ from: rows[0].words[0], to: rows[1].words[1] })
    expect(a.run.to - a.run.from + 1).toBe(RUN_MIN_WORDS)
    // Row 1 (3) + row 2 (4) = 7 < 8, so row 3 too — then cut to twenty.
    const b = pickRun(t, rows[1].startMs)!
    expect(b.rows).toBe(3)
    expect(b.run).toEqual({ from: rows[1].words[0], to: rows[1].words[0] + RUN_MAX_WORDS - 1 })
  })

  it('cuts a long row to twenty words from its first', () => {
    const c = pickRun(t, rows[3].startMs)!
    expect(c.rows).toBe(1)
    expect(c.run).toEqual({ from: rows[3].words[0], to: rows[3].words[0] + RUN_MAX_WORDS - 1 })
  })

  it('takes what there is at the end, and nothing past the last row', () => {
    const d = pickRun(t, rows[4].startMs)!
    expect(d.run).toEqual({ from: rows[4].words[0], to: rows[4].words[1] })
    expect(pickRun(t, rows[4].startMs + 1)).toBeNull()
  })
})

describe('pickMidRun — a run with hard edges, for "nothing outside it"', () => {
  /*
   * Forty words 300 ms apart, each 250 ms long, no pause, a sentence ending
   * at 19 (two rows of twenty) — and the word before each index in TOUCH
   * ends exactly where it starts. 20 starts a row.
   */
  const TOUCH = [3, 9, 12, 15, 20, 23, 28]
  const words: Word[] = Array.from({ length: 40 }, (_, i) => ({ index: i, text: `w${i}`, startMs: 1000 + i * 300, endMs: 1250 + i * 300, confidence: null }))
  for (const k of TOUCH) words[k - 1] = { ...words[k - 1], endMs: words[k].startMs }
  // A sentence ends at 19, so 20 starts a row whatever the gaps.
  words[19] = { ...words[19], text: 'w19.' }
  // One that misses by a millisecond is not a hard edge.
  words[35] = { ...words[35], endMs: words[36].startMs - 1 }
  const t: Transcript = {
    assetId: 'url:test', language: 'en', model: 'youtube-asr', durationMs: 14_000, words,
    segments: segmentIntoSentences(words, PAUSE_BOUNDARY_MS, { maxWords: 30, maxMs: 15_000 })
  }
  const at = (i: number): number => words[i].startMs

  it('the fixture has the rows it says', () => {
    expect(rowsOf(t).map((r) => r.words)).toEqual([[0, 19], [20, 39]])
  })

  it('starts on a word the one before runs straight into, and ends on one the next follows at once — 8 to 20 words', () => {
    expect(pickMidRun(t, at(0))?.run).toEqual({ from: 3, to: 11 })
    expect(pickMidRun(t, at(4))?.run).toEqual({ from: 9, to: 19 })
    expect(pickMidRun(t, at(13))?.run).toEqual({ from: 15, to: 22 })
    for (const target of [0, 4, 13]) {
      const { run } = pickMidRun(t, at(target))!
      expect(words[run.from - 1].endMs).toBe(words[run.from].startMs)
      expect(words[run.to].endMs).toBe(words[run.to + 1].startMs)
      expect(run.to - run.from + 1).toBeGreaterThanOrEqual(RUN_MIN_WORDS)
      expect(run.to - run.from + 1).toBeLessThanOrEqual(RUN_MAX_WORDS)
    }
  })

  it('never starts on a row’s first word, and a millisecond’s gap is not an edge', () => {
    // 20 starts a row (it would run to 27). 23: no hard end 8–20 words on. 28: it would end on 35, whose next word is a millisecond late.
    expect(pickMidRun(t, at(16))).toBeNull()
  })
})

/** A gray picture of seeded noise. */
function noise(seed: number, size = 160 * 90): Uint8Array {
  const r = random(seed)
  return Uint8Array.from({ length: size }, () => Math.floor(r() * 256))
}

/** A copy with ±`amount` levels of seeded noise, as a re-encode leaves. */
function jitter(picture: Uint8Array, seed: number, amount = 3): Uint8Array {
  const r = random(seed)
  return picture.map((v) => Math.max(0, Math.min(255, v + Math.round((r() * 2 - 1) * amount))))
}

describe('matchFrame — where the exact clip’s first frame sits in the padded file', () => {
  // A 25 fps stretch of distinct pictures around 10 s.
  const frames = Array.from({ length: 51 }, (_, k) => ({ ptsMs: 9000 + k * 40, data: noise(100 + k) }))

  it('finds the frame the target was made from, and how far it is from where it was expected', () => {
    const target = jitter(frames[26].data, 7) // 10.040 s
    const m = matchFrame(target, frames, 10_000)!
    expect(m.bestPtsMs).toBe(10_040)
    expect(m.offsetMs).toBe(40)
    expect(m.mad).toBeLessThan(3)
    expect(m.secondMad).toBeGreaterThan(60)
    expect(m.margin).toBeGreaterThan(0.9)
    expect(m.ambiguous).toBe(false)
    // Within ±500 ms of 10 s: 25 frames each side and the one at 10 s.
    expect(m.candidates).toBe(25)
  })

  it('looks only within the window: the same picture a second away is not a candidate', () => {
    const far = [...frames, { ptsMs: 11_600, data: frames[26].data }]
    const target = jitter(frames[30].data, 8)
    const m = matchFrame(target, far, 10_000)!
    expect(m.bestPtsMs).toBe(frames[30].ptsMs)
    // The window excludes it even when it is the only exact match.
    expect(matchFrame(frames[26].data, [{ ptsMs: 11_600, data: frames[26].data }], 10_000)).toBeNull()
  })

  it('says ambiguous when the neighbours are as alike as a still talking head', () => {
    const still = noise(5)
    const near = frames.map((f, k) => ({ ptsMs: f.ptsMs, data: jitter(still, 200 + k, 2) }))
    const m = matchFrame(jitter(still, 9, 2), near, 10_000)!
    expect(m.margin).toBeLessThan(AMBIGUOUS_BELOW)
    expect(m.ambiguous).toBe(true)
  })
})

/** Seeded noise at 16 kHz, a little smoothed so it has some speech-like low end. */
function sound(seconds: number, seed: number, rate = 16_000): Float32Array {
  const r = random(seed)
  const out = new Float32Array(Math.round(seconds * rate))
  let v = 0
  for (let i = 0; i < out.length; i++) {
    v = 0.6 * v + 0.4 * (r() * 2 - 1)
    out[i] = v
  }
  return out
}

describe('audioLag — where the exact clip’s first 500 ms of sound sits in the padded file', () => {
  const padded = sound(4, 11)

  for (const samples of [123, -77, 0]) {
    it(`finds a start ${samples} samples from where it was expected`, () => {
      const at = 2000 + (samples * 1000) / 16_000
      const from = Math.round((at * 16_000) / 1000)
      const clip = padded.slice(from, from + 16_000)
      const lag = audioLag(clip, padded, 16_000, 2000)
      expect(lag.lagMs).toBeCloseTo((samples * 1000) / 16_000, 6)
      expect(lag.corr).toBeGreaterThan(0.999)
      expect(lag.secondCorr!).toBeLessThan(0.5)
    })
  }

  it('through a re-encode’s noise, still to the sample', () => {
    const from = Math.round((2.25 * 16_000))
    const r = random(3)
    const clip = padded.slice(from, from + 16_000).map((v) => v + (r() * 2 - 1) * 0.05)
    const lag = audioLag(clip, padded, 16_000, 2000)
    expect(lag.lagMs).toBeCloseTo(250, 6)
    expect(lag.corr).toBeGreaterThan(0.95)
  })
})

describe('parseAss — the .ass libass burns, read back', () => {
  // Words w0…w6 a line's worth apart, made by the app's own builder in the style a new project has.
  const words: Word[] = Array.from({ length: 7 }, (_, i) => ({
    index: i,
    text: `w${i}`,
    startMs: 1234 + i * 317,
    endMs: 1234 + i * 317 + 200,
    confidence: null
  }))
  const segments = segmentIntoSentences(words, PAUSE_BOUNDARY_MS)
  const ass = buildAss(segments, words, { width: 1280, height: 720, style: styleById('pop') })
  const events = parseAss(ass)

  it('one event per word, its start the word’s rounded down to the centisecond, its lit word the word', () => {
    expect(events).toHaveLength(words.length)
    expect(events.map((e) => e.startMs)).toEqual(words.map((w) => assTimeMs(toAssTime(w.startMs))))
    expect(events.map((e) => e.startMs)).toEqual(words.map((w) => Math.floor(w.startMs / 10) * 10))
    expect(events.map((e) => e.lit)).toEqual(words.map((w) => w.text.toUpperCase()))
  })

  it('reads hours and centiseconds', () => {
    expect(assTimeMs('1:02:03.45')).toBe(3_723_450)
    expect(assTimeMs('0:00:00.07')).toBe(70)
  })

  it('reads a word with a comma or an escaped brace in it', () => {
    const line = 'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\c&H00FFFFFF&\\fscx100\\fscy100}A,B {\\c&H0000D4FF&\\fscx118\\fscy118}C\\{D'
    expect(parseAss(line)).toEqual([{ startMs: 1000, endMs: 2000, lit: 'C{D', text: line.split(',,0,0,0,,')[1] }])
  })
})

/** A band of `w`×`h` gray: a background, and blocks of caption drawn opaque over it. */
function band(background: (x: number, y: number) => number, blocks: { x: number; y: number; w: number; h: number; v: number }[], w = 64, h = 32): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = background(x, y)
  for (const b of blocks) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) out[y * w + x] = b.v
  return out
}

describe('frameReading — a frame’s caption pixels, and what moved', () => {
  const dark = (): number => 60
  // Bright on the left half, where white fill disappears into it; dark on the right.
  const split = (x: number): number => (x < 32 ? 240 : 60)
  const word = { x: 20, y: 8, w: 24, h: 16, v: 255 }

  it('ink is the pixels more than 40 levels from the captionless picture', () => {
    const plain = band(dark, [])
    const cap = band(dark, [word])
    expect(frameReading(cap, plain, null).ink).toBe(24 * 16)
    // Over a bright background, white fill is no longer ink: only the part over the dark half counts.
    expect(frameReading(band(split, [word]), band(split, []), null).ink).toBe(12 * 16)
  })

  it('a HELD caption over a shot change: the mask moves (xor), the caption’s pixels do not (change)', () => {
    const before = { cap: band(dark, [word]), plain: band(dark, []) }
    const first = frameReading(before.cap, before.plain, null)
    const after = frameReading(band(split, [word]), band(split, []), { cap: before.cap, mask: first.mask })
    expect(after.xor).toBe(12 * 16)
    expect(after.change).toBe(0)
  })

  it('a word changing: the caption’s pixels move', () => {
    const plain = band(dark, [])
    const first = frameReading(band(dark, [word]), plain, null)
    const moved = frameReading(band(dark, [{ ...word, x: 28 }]), plain, { cap: band(dark, [word]), mask: first.mask })
    // Columns 20–27 left the caption, 44–51 joined it.
    expect(moved.change).toBe(16 * 16)
    expect(moved.xor).toBe(16 * 16)
  })

  it('the first frame’s change is its ink: whatever is there has just appeared', () => {
    const r = frameReading(band(dark, [word]), band(dark, []), null)
    expect(r.change).toBe(r.ink)
    expect(r.xor).toBe(r.ink)
  })
})

describe('readOnsets — where captions appear and change, from the counts alone', () => {
  // 50 frames: blank to 4; a full line from 5; words lit at 12 (smeared over 12–13, 13 the larger) and 20;
  // blank 25–29; a one-short-word line 30–34; blank after. Held frames move a few pixels.
  const ink = Array.from({ length: 50 }, (_, f) => (f < 5 ? 15 : f < 25 ? 6000 : f < 30 ? 20 : f < 35 ? 800 : 10))
  const change = Array.from({ length: 50 }, (_, f) => (f === 5 ? 6000 : f === 12 ? 1500 : f === 13 ? 4200 : f === 20 ? 3800 : f === 30 ? 800 : f === 25 || f === 35 ? 6000 : 25))

  it('lines where a caption follows a blank; words where the caption’s pixels move — two a frame apart are two', () => {
    // 12 and 13 both moved: two words a frame apart (j4aoo1qbGoE's export, frames 136 and 137), not one smeared.
    const r = readOnsets(ink, change)
    expect(r.lines).toEqual([5, 30])
    expect(r.onsets).toEqual([5, 12, 13, 20, 30])
  })

  it('a line of one short word is still a caption: 800 pixels against lines of 6000', () => {
    expect(readOnsets(ink, change).inkThreshold).toBeLessThan(800)
  })

  it('a line’s first frame is an onset however little its pixels moved, and a held frame is none', () => {
    const ink2 = [10, 10, 6000, 6000, 6000, 6000]
    const change2 = [10, 10, 200, 25, 25, 25]
    expect(readOnsets(ink2, change2).onsets).toEqual([2])
  })
})

describe('frameLabels and noiseFloor — what the .ass says each frame is', () => {
  const ev = (startMs: number, endMs: number): AssEvent => ({ startMs, endMs, lit: null, text: '' })
  // At 30 fps: frame 3 is 100 ms, 9 is 300, 15 is 500, 24 is 800, 30 is 1000.
  const events = [ev(100, 300), ev(300, 500), ev(800, 1000)]
  const labels = frameLabels(events, 36, 30)

  it('frame times as libass is handed them: pts × (1/fps) × 1000 in a double, truncated', () => {
    expect([0, 1, 2, 3, 4].map((f) => frameMs(f, 30))).toEqual([0, 33, 66, 100, 133])
    // The product falls just under the exact value here, so libass draws the frame a millisecond early.
    expect(frameMs(414, 30)).toBe(13_799)
    expect(frameMs(111, 30)).toBe(3_699)
    expect(firstFrameAt(100, 30)).toBe(3)
    expect(firstFrameAt(101, 30)).toBe(4)
    expect(firstFrameAt(2840, 30)).toBe(86)
    // A Dialogue at 13.80 s is not on frame 414 (13,799 ms) but on 415 — measured on eK71EN3P78U's export.
    expect(firstFrameAt(13_800, 30)).toBe(415)
    expect(firstFrameAt(3_700, 30)).toBe(112)
  })

  it('onset, held, blank — and edge for the frame before an onset, the frame after it, and a line’s last', () => {
    expect(labels.slice(0, 17).join(' ')).toBe(
      'blank blank edge onset edge held held held edge onset edge held held held edge edge blank'
    )
    expect(labels.slice(24, 32).join(' ')).toBe('onset edge held held held edge edge blank')
  })

  it('the floor: the most ink on a blank frame, the least on a captioned one, the most change held, the least at an onset', () => {
    const ink = labels.map((l, f) => (l === 'blank' ? 10 + f : l === 'edge' ? 99_999 : 5000 + f))
    const change = labels.map((l, f) => (l === 'onset' ? 3000 + f : l === 'held' ? 40 + f : l === 'edge' ? 500 + f : 7))
    // The onset at frame 9 smeared: its own frame changed little, the next (an edge) most.
    change[9] = 100
    change[10] = 2500
    const fl = noiseFloor(ink, change, labels)
    expect(fl.blankMaxInk).toBe(10 + 35)
    expect(fl.captionedMinInk).toBe(5000 + 3)
    expect(fl.heldMaxChange).toBe(40 + 28)
    // An onset's change is the larger of its frame and the next.
    expect(fl.onsetMinChange).toBe(2500)
    expect([fl.blankFrames, fl.heldFrames, fl.onsetFrames]).toEqual([14, 9, 3])
  })
})

describe('matchOnsets — each word to an onset of its own, within a frame', () => {
  it('matches within a frame, says which words got none and which onsets no word took', () => {
    const m = matchOnsets([0, 8, 15, 21, 105], [0, 8, 14, 23, 101])
    expect(m.offsets).toEqual([0, 0, -1, null, null])
    expect(m.nearest).toEqual([0, 0, -1, 2, -4])
    expect(m.within).toBe(3)
    expect(m.extra).toEqual([23, 101])
    expect(matchOnsets([5], []).offsets).toEqual([null])
  })

  it('one onset cannot answer for two words a frame apart: the second word’s caption never showed', () => {
    expect(matchOnsets([136, 137], [137])).toMatchObject({ offsets: [1, null], within: 1, extra: [] })
    expect(matchOnsets([136, 137], [136, 137])).toMatchObject({ offsets: [0, 0], within: 2, extra: [] })
  })

  it('a caption that flickers leaves onsets no word took', () => {
    expect(matchOnsets([10], [9, 10, 11])).toMatchObject({ within: 1, extra: [10, 11] })
  })
})

describe('shapingSensitive — words that need complex shaping to be spelt right', () => {
  it('counts a conjunct (a virama) or a vowel sign drawn before its consonant, in made-up clusters', () => {
    // क्ष and క్ష: conjuncts. कि and হি: the i-matra goes first. का, కి and Latin need neither.
    expect(shapingSensitive(['क्ष', 'कि', 'का', 'క్ష', 'కి', 'abc', 'হি'])).toBe(4)
  })
})
