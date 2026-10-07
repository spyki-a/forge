import { describe, expect, it } from 'vitest'
import { clipEditWords, clipSourceWindow, clipToRange, clipWords, cutFrames, DETACHED_NOTE, HOLD_NOTE } from '@shared/edit/clipIt'
import { detachAudio } from '@shared/edit/recipes'
import { clipEnd, emptyProject, sourceFrameFor, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { PAUSE_BOUNDARY_MS, segmentIntoSentences, withWordText, type Transcript, type Word } from '@shared/transcript'

/*
 * A clip already on the timeline cut to a run of its words (docs/CLIPS.md
 * §3b.6, §3b.8): `clipToRange` at 1×, 2×, 0.5× and through ramps — the cut
 * lands on the frames whose source frames are the run's words, and every kept
 * frame shows the footage it showed — a hold refused with its note, and the
 * words a clip plays (`clipWords`). The store's half — Cut to these words and
 * `placeAssetRange`, each ONE undo step — is tests/renderer/clipItStore.test.ts
 * (the store is the renderer's, typechecked with it).
 *
 * Every transcript here is made up — NATO letters, nobody's speech.
 */

const FPS = 30

function asset(patch: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'talk',
    path: '/media/talk.mp4',
    name: 'talk',
    kind: 'video',
    durationFrames: 120 * FPS,
    width: 1920,
    height: 1080,
    fps: FPS,
    hasVideo: true,
    hasAudio: true,
    size: 1,
    ...patch
  }
}

/** A clip of the talk at 4 s on the timeline, playing source from 15 s, and another after it on the same track. */
function project(patch: Partial<Clip> = {}): Project {
  const base = emptyProject()
  const clip: Clip = {
    id: 'c',
    assetId: 'talk',
    trackId: 'v1',
    start: 120,
    duration: 900,
    inPoint: 450,
    volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    color: { brightness: 0, contrast: 1, saturation: 1 },
    ...patch
  }
  const after: Clip = { ...clip, id: 'next', start: 3000, duration: 60, inPoint: 0, speed: undefined, ramp: undefined, hold: undefined }
  return { ...base, settings: { ...base.settings, fps: FPS }, assets: [asset(), asset({ id: 'still', kind: 'image', path: '/media/still.jpg' })], clips: [clip, after] }
}

const theClip = (p: Project): Clip => p.clips.find((c) => c.id === 'c')!

/** A deterministic generator, so a failing case names its seed. */
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

const floorFrame = (ms: number): number => Math.floor((ms * FPS) / 1000 + 1e-6)
const ceilFrame = (ms: number): number => Math.ceil((ms * FPS) / 1000 - 1e-6)

describe('clipToRange — exactly, at 1×, 2× and 0.5×', () => {
  it('at 1× opens on the first word’s frame and ends on the frame after the last word’s, its start unmoved', () => {
    // 20 000 ms is source frame 600; 22 510 ms ends inside 675, so 676 is the first frame after it.
    const { project: p, note } = clipToRange(project(), 'c', 20_000, 22_510)
    expect(note).toBeNull()
    expect(theClip(p)).toMatchObject({ start: 120, inPoint: 600, duration: 76 })
    expect(sourceFrameFor(theClip(p), 120)).toBe(600)
    expect(sourceFrameFor(theClip(p), 120 + 75)).toBe(675)
  })

  it('at 2× takes half the timeline frames — and the frame before a word whose start the timeline skips', () => {
    expect(theClip(clipToRange(project({ speed: 2 }), 'c', 20_000, 22_510).project)).toMatchObject({ start: 120, inPoint: 600, duration: 38, speed: 2 })
    // 20 040 ms is source frame 601, which 2× from 450 never shows: the cut opens on 600, not 602 — the word's first sound kept.
    expect(theClip(clipToRange(project({ speed: 2 }), 'c', 20_040, 22_510).project)).toMatchObject({ inPoint: 600, duration: 38 })
  })

  it('at 0.5× takes twice the timeline frames, counted on the cut clip’s own frames', () => {
    // 0.5× from 450: source 600 is first shown on clip frame 299 (round(599.5) = 600), and 676 on frame 451 — 152 of the OLD clip's frames.
    // The cut clip runs from a whole 600, not 599.5: it shows 676 at its own frame 151 (round(600 + 75.5) = 676), so it is 151 long.
    const cut = theClip(clipToRange(project({ speed: 0.5 }), 'c', 20_000, 22_510).project)
    expect(cut).toMatchObject({ start: 120, inPoint: 600, duration: 151, speed: 0.5 })
    expect(sourceFrameFor(cut, clipEnd(cut) - 1)).toBe(675)
    expect(sourceFrameFor(cut, clipEnd(cut))).toBe(676)
  })
})

describe('clipToRange — the cut lands on the run’s words, at every speed', () => {
  const SPEEDS: [string, Partial<Clip>, number, boolean][] = [
    // name, the clip's speed or ramp, how far a kept frame may drift from what it showed (rounding a half frame, or a curve),
    // and whether its length is the old clip's frames exactly (a whole-number speed, a ramp) or counted on its own (any other speed)
    ['1×', {}, 0, true],
    ['2×', { speed: 2 }, 0, true],
    ['0.5×', { speed: 0.5 }, 1, false],
    ['1.25×', { speed: 1.25 }, 1, false],
    ['1.5×', { speed: 1.5 }, 1, false],
    ['a ramp slowing 1× → 0.25×', { ramp: { from: 1, to: 0.25 } }, 1, true],
    ['a ramp speeding 0.5× → 3×', { ramp: { from: 0.5, to: 3 } }, 1, true]
  ]

  for (const [name, patch, drift, exactLength] of SPEEDS) {
    it(`${name}: 150 random runs — the first word’s frame to past the last word’s, every kept frame showing what it showed`, () => {
      const p = project(patch)
      const before = theClip(p)
      const plays = clipSourceWindow(before, FPS)
      const next = random(name.length * 104_729)
      for (let n = 0; n < 150; n++) {
        const startMs = Math.round(plays.startMs + next() * (plays.endMs - plays.startMs - 600))
        const endMs = Math.min(Math.round(plays.endMs) - 1, startMs + 80 + Math.round(next() * 6000))
        const { project: out, note } = clipToRange(p, 'c', startMs, endMs)
        const after = theClip(out)
        const cut = cutFrames(before, startMs, endMs, FPS)!
        const startSource = floorFrame(startMs)
        const endSource = ceilFrame(endMs)
        const at = `${name}, run ${startMs}–${endMs} ms`
        expect(note, at).toBeNull()

        // Where the old clip showed the words: the first word's start is in the cut's first frame or just after it…
        expect(sourceFrameFor(before, cut.from), at).toBeLessThanOrEqual(startSource)
        expect(sourceFrameFor(before, cut.from), at).toBeGreaterThan(startSource - 3)
        // …and the last word's end is in its last frame, with the frame after it already past.
        expect(sourceFrameFor(before, cut.to - 1), at).toBeLessThan(endSource)
        if (cut.to < clipEnd(before)) expect(sourceFrameFor(before, cut.to), at).toBeGreaterThanOrEqual(endSource)

        // The clip is those frames: its start unmoved, its in-point the frame it opened on, its length theirs.
        if (cut.from === before.start && cut.to === clipEnd(before)) {
          expect(out, at).toBe(p)
          continue
        }
        expect(after.start, at).toBe(before.start)
        // The frame the old clip opened on — or, where it skipped the word's first frame and the cut clip would not, that frame.
        if (after.inPoint !== sourceFrameFor(before, cut.from)) expect(after.inPoint, at).toBe(startSource)
        expect(sourceFrameFor(after, after.start), at).toBeLessThanOrEqual(startSource)
        expect(sourceFrameFor(after, after.start), at).toBeGreaterThan(startSource - 3)
        if (exactLength) expect(after.duration, at).toBe(cut.to - cut.from)
        else expect(after.duration, at).toBeLessThanOrEqual(cut.to - cut.from)
        // On its own frames: the last word's end in its last frame, and — where it stopped short of the old cut — the next one past it.
        // Exactly at a constant speed; a ramp's sub-curve, rebuilt from rates, may land a frame either side (documented).
        const slack = patch.ramp ? 1 : 0
        // How far a frame steps through the source at its fastest: the last frame is at most that short of the end.
        const step = Math.ceil(Math.max(patch.speed ?? 1, patch.ramp?.from ?? 0, patch.ramp?.to ?? 0))
        expect(sourceFrameFor(after, clipEnd(after) - 1), at).toBeLessThan(endSource + slack)
        expect(sourceFrameFor(after, clipEnd(after) - 1), at).toBeGreaterThanOrEqual(endSource - step - slack)
        if (after.duration < cut.to - cut.from) expect(sourceFrameFor(after, clipEnd(after)), at).toBeGreaterThanOrEqual(endSource)
        for (let k = 0; k < after.duration; k++) {
          const off = Math.abs(sourceFrameFor(after, after.start + k) - sourceFrameFor(before, cut.from + k))
          if (off > drift) expect.fail(`${at}: kept frame ${k} shows ${sourceFrameFor(after, after.start + k)}, was ${sourceFrameFor(before, cut.from + k)}`)
        }
        // Nothing else on the track moved.
        expect(out.clips.find((c) => c.id === 'next'), at).toBe(p.clips.find((c) => c.id === 'next'))
      }
    })
  }

  it('keeps the part of a ramp the cut keeps — the rate under its first frame to the rate under its end', () => {
    const p = project({ ramp: { from: 1, to: 0.25 } })
    const after = theClip(clipToRange(p, 'c', 20_000, 24_000).project)
    expect(after.ramp!.from).toBeLessThan(1)
    expect(after.ramp!.to).toBeGreaterThan(0.25)
    expect(after.ramp!.from).toBeGreaterThan(after.ramp!.to)
    expect(after.speed).toBeUndefined()
  })

  it('keeps the animation on the picture it was drawn against, as a head trim does', () => {
    const p = project({ keyframes: { opacity: [{ frame: 0, value: 0 }, { frame: 200, value: 1 }] } })
    // At 1× the cut opens 150 frames in (source 600 against an in-point of 450).
    const after = theClip(clipToRange(p, 'c', 20_000, 22_510).project)
    expect(after.keyframes!.opacity!.map((k) => k.frame)).toEqual([-150, 50])
  })

  /*
   * After a cut the tile lists only the run, so picking all its rows and
   * pressing again is ordinary. Measured before the fix, 300 runs each: 0.5×
   * 299 shaved a frame off the end (0.3× up to two), 0.75× 102, 1.5× 27, and
   * 1.25× 107 — 66 of them opening a frame later. A ramp is not held to this
   * (within one frame, as documented).
   */
  for (const speed of [1, 2, 3, 0.5, 0.3, 0.75, 1.25, 1.5]) {
    it(`at ${speed}×, cutting the cut clip to the same run again changes nothing — 150 random runs`, () => {
      const p = project(speed === 1 ? {} : { speed })
      const plays = clipSourceWindow(theClip(p), FPS)
      const next = random(Math.round(speed * 1000) + 17)
      for (let n = 0; n < 150; n++) {
        const startMs = Math.round(plays.startMs + next() * (plays.endMs - plays.startMs - 600))
        const endMs = Math.min(Math.round(plays.endMs) - 1, startMs + 80 + Math.round(next() * 6000))
        const once = clipToRange(p, 'c', startMs, endMs).project
        const twice = clipToRange(once, 'c', startMs, endMs).project
        if (twice !== once) {
          expect.fail(`${speed}×, run ${startMs}–${endMs} ms: ${JSON.stringify(theClip(once))} cut again became in ${theClip(twice).inPoint}, length ${theClip(twice).duration}`)
        }
      }
    })
  }
})

describe('clipToRange — what it refuses', () => {
  it('a hold, with its note, the project unchanged', () => {
    const p = project({ hold: true, duration: 60 })
    const out = clipToRange(p, 'c', 15_000, 15_500)
    expect(out.note).toBe(HOLD_NOTE)
    expect(out.note).toBe('this clip has a hold; cut it by hand')
    expect(out.project).toBe(p)
    expect(cutFrames(theClip(p), 15_000, 15_500, FPS)).toBeNull()
  })

  it('a picture whose sound was lifted onto its own track, with its note — cutting it alone would put it out of sync', () => {
    const lifted = detachAudio(project(), 'c')
    if (!lifted.ok) throw new Error(`detachAudio refused: ${lifted.reason}`)
    const p = lifted.project
    const picture = theClip(p)
    const sound = p.clips.find((c) => c.id === lifted.audioClipId)!
    expect(picture.audioDetached).toBe(true)
    expect([sound.start, sound.inPoint, sound.duration]).toEqual([picture.start, picture.inPoint, picture.duration])
    // Without the refusal: picture {120, 600, 76} over sound {120, 450, 900} — 5 s apart at frame 120.
    const out = clipToRange(p, 'c', 20_000, 22_510)
    expect(out.note).toBe(DETACHED_NOTE)
    expect(out.note).toBe('this clip’s sound is on its own track; cut both by hand')
    expect(out.project).toBe(p)
  })

  it('a run covering the whole clip, a range outside what it plays, a still, a clip not there: unchanged, no note', () => {
    const p = project()
    const plays = clipSourceWindow(theClip(p), FPS)
    expect(plays).toEqual({ startMs: 15_000, endMs: 45_000 })
    for (const [from, to] of [
      [plays.startMs, plays.endMs],
      [0, 14_000],
      [46_000, 50_000]
    ]) {
      const out = clipToRange(p, 'c', from, to)
      expect(out.project).toBe(p)
      expect(out.note).toBeNull()
    }
    const still = { ...p, clips: p.clips.map((c) => (c.id === 'c' ? { ...c, assetId: 'still' } : c)) }
    expect(clipToRange(still, 'c', 20_000, 22_000).project).toBe(still)
    expect(clipToRange(p, 'gone', 20_000, 22_000).project).toBe(p)
  })
})

/* --------------------------------------------------------- the clip's words */

function transcriptOf(spec: [string, number, number][]): Transcript {
  const words: Word[] = spec.map(([text, start, end], i) => ({ index: i, text, startMs: start, endMs: end, confidence: 0.9 }))
  return {
    assetId: 'talk',
    language: 'en',
    model: 'test',
    durationMs: words[words.length - 1].endMs,
    words,
    segments: segmentIntoSentences(words, PAUSE_BOUNDARY_MS)
  }
}

/** Two sentences a second apart, either side of 15 s and of 45 s — the clip plays 15 s to 45 s. */
const TALK = transcriptOf([
  ['alpha', 14_000, 14_400],
  ['bravo.', 14_800, 15_300], // its middle (15 050) is inside: most of it is played
  ['charlie', 20_000, 20_400],
  ['delta.', 20_600, 21_000],
  ['echo', 44_500, 44_900],
  ['foxtrot.', 44_950, 45_400], // middle 45 175: not played
  ['golf.', 50_000, 50_400]
])

describe('clipWords — the words a clip plays', () => {
  it('are those whose middle the clip plays, numbered from 0, their sentences the whole transcript’s', () => {
    const words = clipWords(TALK, { startMs: 15_000, endMs: 45_000 })!
    expect(words.first).toBe(1)
    expect(words.transcript.words.map((w) => [w.index, w.text])).toEqual([
      [0, 'bravo.'],
      [1, 'charlie'],
      [2, 'delta.'],
      [3, 'echo']
    ])
    // "alpha bravo." was one sentence: its played part is a row of its own.
    expect(words.transcript.segments.map((s) => [s.wordStart, s.wordEnd, s.text])).toEqual([
      [0, 0, 'bravo.'],
      [1, 2, 'charlie delta.'],
      [3, 3, 'echo']
    ])
    expect(clipWords(TALK, { startMs: 30_000, endMs: 40_000 })).toBeNull()
  })

  it('follow a word taken out by hand, whose index then has a gap', () => {
    // withWordText takes an emptied word out and does not renumber (transcript.ts).
    const gapped = withWordText(TALK, 2, '')
    expect(gapped.words.map((w) => w.index)).toEqual([0, 1, 3, 4, 5, 6])
    const words = clipWords(gapped, { startMs: 15_000, endMs: 45_000 })!
    expect(words.transcript.words.map((w) => [w.index, w.text])).toEqual([
      [0, 'bravo.'],
      [1, 'delta.'],
      [2, 'echo']
    ])
    expect(words.transcript.segments.map((s) => [s.wordStart, s.wordEnd])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2]
    ])
    // A word picked here goes back to the store by position: position first + 1 is index 3.
    expect(gapped.words[words.first + 1].index).toBe(3)
  })

  it('are the same object while the same words are played, so the rows are not made again', () => {
    const a = clipWords(TALK, { startMs: 15_000, endMs: 45_000 })
    expect(clipWords(TALK, { startMs: 15_010, endMs: 44_990 })).toBe(a)
    expect(clipWords(TALK, { startMs: 16_000, endMs: 45_000 })).not.toBe(a)
  })

  it('for Edit, are every word the clip plays any part of — what its captions burn — and a hold’s are the whole transcript', () => {
    const p = { ...project(), transcripts: { talk: TALK } }
    const edit = clipEditWords(theClip(p), TALK, FPS)!
    // "foxtrot." (44 950–45 400) is cut through by the clip's end at 45 s: not a row (its middle is past it), but the captions show it.
    expect(edit.transcript.words.map((w) => w.text)).toEqual(['bravo.', 'charlie', 'delta.', 'echo', 'foxtrot.'])
    expect(edit.first).toBe(1)
    expect(clipWords(TALK, clipSourceWindow(theClip(p), FPS))!.transcript.words.map((w) => w.text)).not.toContain('foxtrot.')
    // A correction goes back by position: foxtrot is the whole transcript's word 5.
    expect(TALK.words[edit.first + 4].index).toBe(5)
    // A hold has no span of its own: Edit lists everything, as before §3b.6.
    expect(clipEditWords({ ...theClip(p), hold: true }, TALK, FPS)!.transcript.words.map((w) => w.text)).toEqual(TALK.words.map((w) => w.text))
    // A clip in a stretch where nothing is said has none to correct.
    expect(clipEditWords({ ...theClip(p), inPoint: 30 * FPS, duration: 10 * FPS }, TALK, FPS)).toBeNull()
  })

  it('both kinds kept at once: the rows’ words stay the same object while Edit’s are asked for between', () => {
    const window = { startMs: 15_000, endMs: 45_000 }
    const rows = clipWords(TALK, window)
    expect(clipWords(TALK, window, 'overlap')).not.toBe(rows)
    expect(clipWords(TALK, window)).toBe(rows)
  })
})
