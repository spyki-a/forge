import { describe, expect, it } from 'vitest'
import {
  captionsStep,
  cardClipGone,
  cardClippable,
  cardDownloadsIn,
  cardKey,
  cardRun,
  graphicsMayStart,
  newCardRecord,
  notLanded,
  reframeMayStart,
  STEP_TEXT,
  stepOf,
  unsavedWork,
  withStep,
  type CardClipRecord,
  type CardStepName,
  type CardStepState
} from '@shared/bestclips/cardClip'
import { CAP_MS, CAP_WORDS, clipSegments, windowsFor } from '@shared/bestclips/windows'
import { PAUSE_BOUNDARY_MS, segmentIntoSentences, type Transcript, type Word } from '@shared/transcript'

/*
 * Clip it from a Best clips card, its pure half (docs/CLIPS.md §7.5 steps 0
 * to 5; shared/bestclips/cardClip.ts): the card's window as a run of words,
 * the per-card record, and the order rule that keeps the local model and the
 * AI helper's models from being resident together (§12.1). Step 0's question
 * is tests/clipIt.test.ts's (§7.7 puts it there). Every transcript is made up.
 */

/** `n` sentences of `min..max` Latin nonsense words (seeded), 280 ms a word; `stop` ends each with a full stop. */
function madeUpTalk(n: number, seed: number, { min = 8, max = 14, stop = true } = {}): Transcript {
  const VOCAB = ['zor', 'plim', 'tavek', 'mubo', 'senra', 'kilo', 'drav', 'oppen', 'vestra', 'nim', 'rulo', 'fesh', 'gandu', 'brel']
  let a = seed >>> 0
  const r = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const words: Word[] = []
  let at = 0
  for (let k = 0; k < n; k++) {
    const length = min + Math.floor(r() * (max - min + 1))
    for (let i = 0; i < length; i++) {
      const last = i === length - 1
      const text = VOCAB[Math.floor(r() * 400) % VOCAB.length] + (last && stop ? '.' : '')
      words.push({ index: words.length, text, startMs: at, endMs: at + 280, confidence: null })
      at += 280 + (last ? 300 : 60)
    }
  }
  return { assetId: 'url:test', language: 'en', model: 'test', durationMs: at, words, segments: segmentIntoSentences(words, PAUSE_BOUNDARY_MS) }
}

describe('cardRun — the card’s window as a run of words', () => {
  const talks: [string, Transcript][] = [
    ['punctuated, 8–14-word sentences', madeUpTalk(80, 7)],
    // 40–60-word sentences: the 30-word cap splits each into pieces (ids like s4.2), which windows start and end on.
    ['long sentences the cap splits', madeUpTalk(30, 11, { min: 40, max: 60 })],
    ['unpunctuated', madeUpTalk(60, 23, { stop: false })]
  ]

  for (const [name, t] of talks) {
    it(`${name}: its first word opens the window’s first segment and its last closes its last, at every length`, () => {
      const segs = clipSegments(t)
      let seen = 0
      for (const targetMs of [60_000, 120_000]) {
        for (const w of windowsFor(t, targetMs)) {
          const run = cardRun(t, w)
          expect(run, w.id).not.toBeNull()
          const first = segs.find((s) => s.id === w.segFrom)!
          const last = segs.find((s) => s.id === w.segTo)!
          // The very words: the segment's first word index, and its last.
          expect(t.words[run!.from].index, w.id).toBe(first.wordStart)
          expect(t.words[run!.to].index, w.id).toBe(last.wordEnd)
          // As many words as the window counts, starting when it starts.
          expect(run!.to - run!.from + 1, w.id).toBe(w.words)
          expect(t.words[run!.from].startMs, w.id).toBe(w.startMs)
          expect(t.words[run!.to].endMs, w.id).toBe(w.endMs)
          seen++
        }
      }
      expect(seen).toBeGreaterThan(5)
    })
  }

  it('the long-sentence talk really has split segments among its windows’ ends', () => {
    const t = talks[1][1]
    const ids = windowsFor(t, 60_000).flatMap((w) => [w.segFrom, w.segTo])
    expect(ids.some((id) => id.includes('.'))).toBe(true)
    expect(clipSegments(t).every((s) => s.wordEnd - s.wordStart + 1 <= CAP_WORDS && s.endMs - s.startMs <= CAP_MS)).toBe(true)
  })

  it('is null for a window whose segments are not this transcript’s', () => {
    const t = madeUpTalk(20, 3)
    expect(cardRun(t, { segFrom: 'nope', segTo: 's1' })).toBeNull()
    expect(cardRun(t, { segFrom: 's1', segTo: 'nope' })).toBeNull()
  })
})

const WINDOW = { windowId: 'w3', startMs: 12_000, endMs: 70_000 }

function landed(reframe: CardStepState, captions: CardStepState = 'done'): CardClipRecord {
  let r = newCardRecord(cardKey('lk', WINDOW), 'lk', WINDOW, { reframe: true, shape: 'set' })
  r = { ...withStep(r, 'download', 'done', STEP_TEXT.landed), clipId: 'clip-1' }
  r = withStep(r, 'reframe', reframe, 'x')
  return withStep(r, 'captions', captions, 'x')
}

describe('the order of the steps after the clip lands (§12.1)', () => {
  const idle = { reframesRunning: 0, graphicsRunning: false }

  it('graphics never starts while this clip’s reframe is waiting or running', () => {
    expect(graphicsMayStart(landed('waiting'), idle)).toBe(false)
    expect(graphicsMayStart(landed('running'), idle)).toBe(false)
  })

  it('graphics starts once the reframe has ended, however it ended, or was never started', () => {
    for (const ended of ['done', 'skipped', 'failed'] as const) expect(graphicsMayStart(landed(ended), idle), ended).toBe(true)
  })

  it('and never while ANY reframe analysis runs, or another graphics run is out', () => {
    expect(graphicsMayStart(landed('done'), { reframesRunning: 1, graphicsRunning: false })).toBe(false)
    expect(graphicsMayStart(landed('done'), { reframesRunning: 0, graphicsRunning: true })).toBe(false)
  })

  it('nor before the clip has landed, before captions, or a second time', () => {
    const notYet = newCardRecord('k', 'lk', WINDOW, { reframe: true, shape: 'set' })
    expect(graphicsMayStart(withStep(withStep(notYet, 'reframe', 'skipped', 'x'), 'captions', 'done', 'x'), idle)).toBe(false)
    expect(graphicsMayStart(landed('done', 'waiting'), idle)).toBe(false)
    expect(graphicsMayStart(withStep(landed('done'), 'graphics', 'running', 'x'), idle)).toBe(false)
  })

  it('a reframe never starts while a graphics run is out', () => {
    expect(reframeMayStart({ reframesRunning: 0, graphicsRunning: true })).toBe(false)
    expect(reframeMayStart({ reframesRunning: 2, graphicsRunning: false })).toBe(true)
  })
})

describe('the per-card record', () => {
  it('starts with the download running, the shape said, and every later step waiting, in order', () => {
    const r = newCardRecord(cardKey('lk', WINDOW), 'lk', WINDOW, { reframe: false, shape: 'kept' })
    expect(r.steps.map((s) => s.name)).toEqual<CardStepName[]>(['download', 'shape', 'reframe', 'captions', 'graphics'])
    expect(stepOf(r, 'download')).toMatchObject({ state: 'running', text: STEP_TEXT.downloading })
    expect(stepOf(r, 'shape')).toMatchObject({ state: 'done', text: STEP_TEXT.shapeKept })
    for (const name of ['reframe', 'captions', 'graphics'] as const) expect(stepOf(r, name)?.state).toBe('waiting')
    expect(r).toMatchObject({ key: 'lk|12000-70000', windowId: 'w3', jobId: null, clipId: null, reframe: false })
  })

  it('a download that did not land skips every waiting step, says why, and lets the card be pressed again', () => {
    const r = notLanded(newCardRecord('k', 'lk', WINDOW, { reframe: true, shape: 'set' }), STEP_TEXT.otherProject)
    expect(stepOf(r, 'download')).toMatchObject({ state: 'failed', text: STEP_TEXT.otherProject })
    for (const name of ['reframe', 'captions', 'graphics'] as const) expect(stepOf(r, name)).toMatchObject({ state: 'skipped', text: STEP_TEXT.notLanded })
    // The shape line stays what it said: it happened before the download.
    expect(stepOf(r, 'shape')?.state).toBe('done')
    expect(cardClippable(r, [])).toBe(true)
  })

  it('a card sent or landed is not pressable again; one never pressed is', () => {
    expect(cardClippable(undefined, [])).toBe(true)
    expect(cardClippable(newCardRecord('k', 'lk', WINDOW, { reframe: true, shape: 'set' }), [])).toBe(false)
    expect(cardClippable(landed('done'), [{ id: 'clip-1' }, { id: 'other' }])).toBe(false)
  })

  it('a landed clip no longer on the timeline (undone, deleted, another project) lets the card be clipped again, and its record no longer holds', () => {
    const r = landed('done')
    expect(cardClipGone(r, [{ id: 'clip-1' }])).toBe(false)
    expect(cardClipGone(r, [{ id: 'other' }])).toBe(true)
    expect(cardClippable(r, [])).toBe(true)
    expect(cardClippable(r, [{ id: 'other' }])).toBe(true)
    // A download still on its way has no clip yet: not gone, not pressable.
    expect(cardClipGone(newCardRecord('k', 'lk', WINDOW, { reframe: true, shape: 'set' }), [])).toBe(false)
  })

  it('the graphics line does not promise faces before any follow has started', () => {
    for (const reframe of [true, false]) {
      const r = newCardRecord('k', 'lk', WINDOW, { reframe, shape: 'set' })
      expect(stepOf(r, 'graphics'), String(reframe)).toMatchObject({ state: 'waiting', text: STEP_TEXT.waiting })
    }
  })

  it('carries the project it was sent into and whether captions are its to change', () => {
    const r = newCardRecord('k', 'lk', WINDOW, { reframe: true, shape: 'set', captions: true, projectId: 'p-1' })
    expect(r).toMatchObject({ projectId: 'p-1', captions: true })
    // Defaults: no project, and captions left alone.
    expect(newCardRecord('k', 'lk', WINDOW, { reframe: true, shape: 'set' })).toMatchObject({ projectId: null, captions: false })
  })
})

describe('step 4 — captions, never an existing edit’s', () => {
  it('into an existing edit, the project’s captions are left exactly as they are, on or off, placement included', () => {
    expect(captionsStep(false, { enabled: false }, true)).toEqual({ change: null, state: 'skipped', text: STEP_TEXT.captionsLeftOff })
    expect(captionsStep(false, { enabled: false, placement: 'style' }, false)).toMatchObject({ change: null, state: 'skipped' })
    expect(captionsStep(false, { enabled: true, placement: 'style' }, true)).toEqual({ change: null, state: 'done', text: STEP_TEXT.captionsAlready })
  })

  it('into a new project or an empty timeline, captions go on, kept off the faces when a subject track exists', () => {
    expect(captionsStep(true, { enabled: false }, false)).toEqual({ change: { enabled: true }, state: 'done', text: STEP_TEXT.captionsOn })
    expect(captionsStep(true, { enabled: false }, true)).toEqual({ change: { enabled: true, placement: 'smart' }, state: 'done', text: STEP_TEXT.captionsSmart })
    expect(captionsStep(true, { enabled: true, placement: 'style' }, true)).toMatchObject({ change: { enabled: true, placement: 'smart' } })
    // Already so: no change, so no undo step.
    expect(captionsStep(true, { enabled: true, placement: 'smart' }, true)).toEqual({ change: null, state: 'done', text: STEP_TEXT.captionsSmart })
    expect(captionsStep(true, { enabled: true }, false)).toEqual({ change: null, state: 'done', text: STEP_TEXT.captionsOn })
  })
})

describe('step 0’s helpers', () => {
  it('unsaved work: changed, or never written to a file of its own (a recovered project opens clean, with no path)', () => {
    expect(unsavedWork({ dirty: true, projectPath: '/p/a.forge' })).toBe(true)
    expect(unsavedWork({ dirty: false, projectPath: null })).toBe(true)
    expect(unsavedWork({ dirty: false, projectPath: '/p/a.forge' })).toBe(false)
  })

  it('counts the card downloads still on their way into one project, by its id', () => {
    const going = newCardRecord('a', 'lk', WINDOW, { reframe: true, shape: 'set', projectId: 'p-1' })
    const elsewhere = newCardRecord('b', 'lk', WINDOW, { reframe: true, shape: 'set', projectId: 'p-2' })
    const done = { ...withStep(newCardRecord('c', 'lk', WINDOW, { reframe: true, shape: 'set', projectId: 'p-1' }), 'download', 'done', STEP_TEXT.landed), clipId: 'x' }
    const failed = notLanded(newCardRecord('d', 'lk', WINDOW, { reframe: true, shape: 'set', projectId: 'p-1' }), STEP_TEXT.downloadFailed)
    const records = { a: going, b: elsewhere, c: done, d: failed }
    expect(cardDownloadsIn(records, 'p-1')).toBe(1)
    expect(cardDownloadsIn(records, 'p-2')).toBe(1)
    expect(cardDownloadsIn(records, 'p-3')).toBe(0)
  })
})
