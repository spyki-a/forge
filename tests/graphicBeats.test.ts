import { describe, expect, it } from 'vitest'
import {
  BEAT_GAP_S,
  CLIP_END_NOTE,
  LEAD_S,
  NOT_SHOWN_NOTE,
  NO_BEAT_NOTE,
  RETIMED_NOTE,
  TAIL_S,
  graphicBeats,
  graphicTiming,
  spreadBeats
} from '@shared/graphics/beats'
import { DEFAULT_MIN_GAP_MS } from '@shared/automation/lyrics'
import { buildTimelineCaptions } from '@shared/captions/timeline'
import { captionLineFrame, libassLineFrame } from '@shared/captions/placement'
import { resolveStyle } from '@shared/captions/style'
import { beatFrame } from '@shared/graphics/frame'
import { GRAPHIC_TEMPLATES, type TemplateDef } from '@shared/graphics/template'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { segmentIntoSentences, type Word } from '@shared/transcript'

/*
 * §6.8's beats (docs/CLIPS.md): a beat is its word's startMs carried to the
 * timeline through the footage clip with the captions' own offset; the
 * graphic starts LEAD_S before its first beat, never before the clip; holds
 * to the last beat plus TAIL_S within the template's bounds and never past the
 * clip's end; arriving beats closer than 160 ms are spread, a quote's are not;
 * a retimed clip is refused. Every time and frame below is worked by hand in
 * the comment beside it, not read from a helper of beats.ts.
 */

const CANVAS = { width: 1080, height: 1920 }
const COUNTER = GRAPHIC_TEMPLATES.counter! // seconds 2..4
const STEPS = GRAPHIC_TEMPLATES.steps! // seconds 3..8
const BARS = GRAPHIC_TEMPLATES.bars! // seconds 3..6

function words(list: [string, number, number][], from = 0): Word[] {
  return list.map(([text, startMs, endMs], i) => ({ index: from + i, text, startMs, endMs, confidence: 1 }))
}

/** One footage clip on the first video track, its transcript `ws`. */
function fixture(fps: number, patch: Partial<Clip>, ws: Word[]): { project: Project; clip: Clip } {
  const asset: MediaAsset = {
    id: 'a', path: '/media/a.mp4', name: 'a.mp4', kind: 'video', durationFrames: fps * 60,
    width: 1080, height: 1920, fps, hasVideo: true, hasAudio: true, size: 1
  }
  const base = emptyProject('beats')
  const trackId = base.tracks.find((t) => t.kind === 'video')!.id
  const clip: Clip = {
    id: 'c', assetId: 'a', trackId, start: 0, duration: fps * 20, inPoint: 0, volume: 1,
    transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR }, ...patch
  }
  return {
    clip,
    project: {
      ...base,
      settings: { ...base.settings, ...CANVAS, fps },
      assets: [asset],
      clips: [clip],
      transcripts: { a: { assetId: 'a', language: 'en', model: 'test', durationMs: 60000, words: ws, segments: segmentIntoSentences(ws) } },
      captions: { enabled: true, styleId: 'pop', overrides: {} }
    }
  }
}

/** Every Dialogue event's start in the libass captions, in ms (centiseconds, as written). */
function dialogueStartsMs(ass: string): number[] {
  return [...ass.matchAll(/^Dialogue: \d+,(\d+):(\d\d):(\d\d)\.(\d\d),/gm)].map(
    (m) => ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]) * 10
  )
}

describe('a beat is its word\'s start through the clip, with the captions\' offset', () => {
  // A one-word line, so the captions' only event starts at that word.
  const ONE = words([['Forty.', 2500, 2900]])

  it('on a trimmed clip: in-point 2.0 s, at 1.5 s on the timeline, a word at 2.5 s sits at 2.0 s', () => {
    // 30 fps: in-point 60 frames = 2000 ms, start 45 frames = 1500 ms; 2500 − (2000 − 1500) = 2000 ms.
    const { project, clip } = fixture(30, { start: 45, inPoint: 60, duration: 150 }, ONE)
    const beats = graphicBeats(project, clip, project.transcripts.a, [0])!
    expect(beats).toEqual([2])
    // The captions' own answer for the same word, three ways: the libass cue, its frame, the canvas bake's frame.
    const ass = buildTimelineCaptions(project, resolveStyle('pop', {}), CANVAS)!
    expect(dialogueStartsMs(ass)).toEqual([beats[0] * 1000])
    expect(libassLineFrame(clip, 30, 2500)).toBe(60)
    expect(captionLineFrame(clip, 30, 2500)).toBe(60)
    expect(beatFrame(beats[0], 30)).toBe(60)
  })

  it('on a clip moved later: the same trim at 3.0 s on the timeline puts the word at 3.5 s', () => {
    // start 90 frames = 3000 ms; 2500 − (2000 − 3000) = 3500 ms.
    const { project, clip } = fixture(30, { start: 90, inPoint: 60, duration: 150 }, ONE)
    const beats = graphicBeats(project, clip, project.transcripts.a, [0])!
    expect(beats).toEqual([3.5])
    expect(dialogueStartsMs(buildTimelineCaptions(project, resolveStyle('pop', {}), CANVAS)!)).toEqual([3500])
    expect(libassLineFrame(clip, 30, 2500)).toBe(105)
  })

  it('reads startMs, not endMs', () => {
    const { project, clip } = fixture(30, { start: 0, inPoint: 0, duration: 300 }, words([['ten', 1200, 1800]]))
    expect(graphicBeats(project, clip, project.transcripts.a, [0])).toEqual([1.2])
  })

  it('reads a word by its Word.index, not its place in the array', () => {
    const ws = words([['a', 1000, 1100], ['b', 2000, 2100]], 40)
    const { project, clip } = fixture(30, { duration: 300 }, ws)
    expect(graphicBeats(project, clip, project.transcripts.a, [41, 40], { spread: false })).toEqual([2, 1])
  })
})

describe('a word the clip does not show is no beat: the graphic drops, nothing is clamped', () => {
  // 30 fps, in-point 60 (2000 ms), duration 90 (3000 ms): the window is [2000, 5000).
  const WS = words([['early', 1900, 2100], ['first', 2000, 2200], ['late', 5000, 5200], ['last', 4990, 5100]])
  const { project, clip } = fixture(30, { start: 30, inPoint: 60, duration: 90 }, WS)

  it('a word starting before the in-point, after the window, or no word at all, reads NaN', () => {
    const beats = graphicBeats(project, clip, project.transcripts.a, [0, 1, 2, 3, 99], { spread: false })!
    // 'first' at 2000 ms sits on the clip's first frame, 30 = 1.0 s; 'last' at 4990 ms at 1.0 + 2.99 = 3.99 s.
    expect(beats[1]).toBe(1)
    expect(beats[3]).toBeCloseTo(3.99, 9)
    expect(beats[0]).toBeNaN()
    expect(beats[2]).toBeNaN()
    expect(beats[4]).toBeNaN()
  })

  it('graphicTiming drops a graphic with a beat that is not on the clip, and one with no beat', () => {
    const beats = graphicBeats(project, clip, project.transcripts.a, [1, 0])!
    expect(graphicTiming(clip, beats, COUNTER, '40%', 30)).toEqual({ ok: false, note: NOT_SHOWN_NOTE })
    expect(graphicTiming(clip, [], COUNTER, '40%', 30)).toEqual({ ok: false, note: NO_BEAT_NOTE })
  })
})

describe('spacing: arriving beats are spread to 160 ms, the later moved; a quote\'s are not', () => {
  // Timeline = source (start 0, in-point 0): 1000, 1050, 1300 ms.
  const WS = words([['one', 1000, 1040], ['two', 1050, 1290], ['three', 1300, 1500], ['four', 1460, 1600]])
  const { project, clip } = fixture(30, { duration: 300 }, WS)

  it('the gap is DEFAULT_MIN_GAP_MS, 160 ms', () => {
    expect(DEFAULT_MIN_GAP_MS).toBe(160)
    expect(BEAT_GAP_S).toBe(0.16)
  })

  it('1.00, 1.05, 1.30 arrive at 1.00, 1.16, 1.32', () => {
    // 1.05 is 50 ms after 1.00, so it moves to 1.16; 1.30 is then 140 ms after 1.16, so 1.32.
    const beats = graphicBeats(project, clip, project.transcripts.a, [0, 1, 2])!
    expect(beats[0]).toBe(1)
    expect(beats[1]).toBeCloseTo(1.16, 9)
    expect(beats[2]).toBeCloseTo(1.32, 9)
  })

  it('a gap of exactly 160 ms is left alone', () => {
    // 1300 and 1460 ms, 160 ms apart.
    const beats = graphicBeats(project, clip, project.transcripts.a, [2, 3])!
    expect(beats).toEqual([1.3, 1.46])
  })

  it('a quote\'s beats (spread: false) are the words\' own times', () => {
    expect(graphicBeats(project, clip, project.transcripts.a, [0, 1, 2], { spread: false })).toEqual([1, 1.05, 1.3])
  })

  it('spreadBeats leaves a NaN alone and spaces from the last real beat', () => {
    const out = spreadBeats([1, Number.NaN, 1.1])
    expect(out[0]).toBe(1)
    expect(out[1]).toBeNaN()
    expect(out[2]).toBeCloseTo(1.16, 9)
  })
})

describe('a retimed clip is refused', () => {
  const WS = words([['one', 1000, 1200]])
  it('speed set, or a ramp: null, and the note is §6.8\'s', () => {
    const slow = fixture(30, { speed: 0.5 }, WS)
    expect(graphicBeats(slow.project, slow.clip, slow.project.transcripts.a, [0])).toBeNull()
    const ramped = fixture(30, { ramp: { from: 1, to: 2 } }, WS)
    expect(graphicBeats(ramped.project, ramped.clip, ramped.project.transcripts.a, [0])).toBeNull()
    expect(RETIMED_NOTE).toBe('graphics on a speed-changed clip are not timed yet')
  })
  it('a plain clip is timed', () => {
    const plain = fixture(30, {}, WS)
    expect(graphicBeats(plain.project, plain.clip, plain.project.transcripts.a, [0])).toEqual([1])
  })
})

describe('graphicTiming: the lead, the tail, the template\'s bounds and the clip\'s end', () => {
  const clip = { start: 45, duration: 300 } // 1.5 s .. 11.5 s at 30 fps

  it('the lead: 0.5 s before the first beat, on a whole frame', () => {
    // Beat at 4.0 s: 3.5 s × 30 = frame 105; the beat is 0.5 s after it.
    const t = graphicTiming(clip, [4], COUNTER, '40%', 30)
    expect(t).toMatchObject({ ok: true, start: 105 })
    expect(t.ok && t.beats).toEqual([LEAD_S])
  })

  it('the lead clamped at the footage clip\'s start', () => {
    // Beat at 1.6 s: 1.1 s is frame 33, before the clip's 45, so the graphic starts at 45 and the beat is 0.1 s in.
    const t = graphicTiming(clip, [1.6], COUNTER, '40%', 30)
    expect(t).toMatchObject({ ok: true, start: 45 })
    expect(t.ok && t.beats[0]).toBeCloseTo(0.1, 9)
  })

  it('the template\'s minimum: one beat 0.5 s in holds a counter 2 s, 60 frames', () => {
    // max(2, 0.5 + 0.8, 0.5 + 3/20 + 0.3) = 2.
    expect(graphicTiming(clip, [4], COUNTER, '40%', 30)).toMatchObject({ ok: true, seconds: 2, duration: 60 })
  })

  it('the tail: a last beat 4.0 s in holds bars 4.8 s, 144 frames', () => {
    // Beats at 4.0 and 7.5 s; start 105 (3.5 s); relative 0.5 and 4.0; 4.0 + 0.8 = 4.8 s; 4.8 × 30 = 144.
    const t = graphicTiming(clip, [4, 7.5], BARS, 'ab', 30)
    expect(t.ok).toBe(true)
    if (!t.ok) return
    expect(t.seconds).toBeCloseTo(4 + TAIL_S, 9)
    expect(t.duration).toBe(144)
  })

  it('past the template\'s maximum: dropped, with what was needed and what the card holds', () => {
    // Steps, beats at 2.0 and 9.5 s: start 1.5 s (frame 45, exactly the clip's), relative 0.5 and 8.0; 8.8 > 8.
    expect(graphicTiming(clip, [2, 9.5], STEPS, 'ab', 30)).toEqual({ ok: false, note: 'said over 8.8 s; a steps card holds 8' })
  })

  it('a lower third\'s note says "lower third"', () => {
    const lt = GRAPHIC_TEMPLATES['lower-third'] as TemplateDef // max 5
    // Beat at 2.0 s, start 1.5 s; a second beat at 7.0 s is 5.5 s in, 6.3 s needed.
    expect(graphicTiming(clip, [2, 7], lt, 'Ana', 30)).toEqual({ ok: false, note: 'said over 6.3 s; a lower third card holds 5' })
  })

  it('too close to the clip\'s end: dropped; one frame further from it, timed', () => {
    // Clip ends at frame 345 (11.5 s). A counter needs 60 frames from its start.
    // Beat at 10.5 s: start 300 (10.0 s); 300 + 60 = 360 > 345: dropped.
    expect(graphicTiming(clip, [10.5], COUNTER, '40%', 30)).toEqual({ ok: false, note: CLIP_END_NOTE })
    expect(CLIP_END_NOTE).toBe("too close to the clip's end to be read")
    // Beat at 10.0 s: start 285 (9.5 s); 285 + 60 = 345, the clip's end exactly: timed.
    expect(graphicTiming(clip, [10], COUNTER, '40%', 30)).toMatchObject({ ok: true, start: 285, duration: 60 })
    // Beat at 10.0 s plus one frame: start 286; 346 > 345: dropped.
    expect(graphicTiming(clip, [10 + 1 / 30], COUNTER, '40%', 30)).toEqual({ ok: false, note: CLIP_END_NOTE })
  })
})

describe('the element lands ON its beat\'s frame, at 24, 25, 30 and 60 fps', () => {
  /*
   * The clip sits at 2.0 s on the timeline with its in-point at 1.0 s, so a
   * word at source 1730 ms is at 2.73 s and one at 2000 ms at 3.00 s. Worked
   * by hand: start = ceil((beat − 0.5) × fps), arrival = ceil(beat × fps),
   * a counter's 2 s = 2 × fps frames.
   */
  const ROWS: { fps: number; word: number; start: number; arrival: number }[] = [
    { fps: 24, word: 1730, start: 54, arrival: 66 }, // 2.23 × 24 = 53.52; 2.73 × 24 = 65.52
    { fps: 25, word: 1730, start: 56, arrival: 69 }, // 55.75; 68.25
    { fps: 30, word: 1730, start: 67, arrival: 82 }, // 66.9; 81.9
    { fps: 60, word: 1730, start: 134, arrival: 164 }, // 133.8; 163.8
    { fps: 24, word: 2000, start: 60, arrival: 72 }, // 2.5 × 24 = 60; 3 × 24 = 72, a beat exactly on a frame
    { fps: 25, word: 2000, start: 63, arrival: 75 }, // 62.5; 75
    { fps: 30, word: 2000, start: 75, arrival: 90 },
    { fps: 60, word: 2000, start: 150, arrival: 180 }
  ]
  for (const row of ROWS) {
    it(`${row.fps} fps, a word at ${row.word} ms: starts on ${row.start}, arrives on ${row.arrival}`, () => {
      const { project, clip } = fixture(row.fps, { start: 2 * row.fps, inPoint: row.fps, duration: 10 * row.fps }, words([['x', row.word, row.word + 100]]))
      const beats = graphicBeats(project, clip, project.transcripts.a, [0])!
      const t = graphicTiming(clip, beats, COUNTER, 'x', row.fps)
      expect(t.ok).toBe(true)
      if (!t.ok) return
      expect(t.start).toBe(row.start)
      expect(t.duration).toBe(2 * row.fps)
      // §6.3: an element arrives on its clip's frame beatFrame(beat); on the timeline, start plus that.
      expect(t.start + beatFrame(t.beats[0], row.fps)).toBe(row.arrival)
      // And the libass captions first draw the same word on that frame.
      expect(libassLineFrame(clip, row.fps, row.word)).toBe(row.arrival)
    })
  }
})
