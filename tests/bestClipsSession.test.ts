import { describe, expect, it } from 'vitest'
import type { CompletionRequest, CompletionResult, LlmStatus } from '@shared/director/provider'
import { bestClips, MODEL_FAILED_NOTE, MODEL_UNUSABLE_NOTE } from '@shared/bestclips/run'
import {
  analyseRefusal,
  BEST_CLIPS_LENGTHS,
  BEST_CLIPS_TIMEOUT_MS,
  bestClipsAskOver,
  bestClipsBelongs,
  cardRange,
  cardWords,
  DEFAULT_BEST_CLIPS_MS,
  initialBestClips,
  modelReady,
  runningHere,
  SCORED_BY_LABEL,
  shownBestClips,
  withLength,
  type BestClipsState
} from '@shared/bestclips/session'
import { latin, sentencesOf, talk, transcriptOf } from './eval/bestClipsFixtures'

/*
 * Best clips' session rules (docs/CLIPS.md §7.5's first half): what an answer
 * belongs to, one Analyse at a time, a length change, the ask's wrapping, the
 * no-model test, and the words a card shows. The store's half is
 * tests/renderer/bestClipsStore.test.ts; the panel's is
 * tests/renderer/bestClipsPanel.test.tsx. Every transcript is made up.
 */

const T = transcriptOf(talk(sentencesOf(40, latin, 31)), 'en')
/** The same words, fetched again: Get transcript always builds a new transcript. */
const T_AGAIN = transcriptOf(talk(sentencesOf(40, latin, 31)), 'en')

const asked = { linkKey: 'yt-a', targetMs: 60_000, transcript: T }

describe('what an answer belongs to', () => {
  it('is the same link, the same length and the same transcript', () => {
    expect(bestClipsBelongs(asked, { linkKey: 'yt-a', targetMs: 60_000, transcript: T })).toBe(true)
  })

  it('is dropped when the link changed', () => {
    expect(bestClipsBelongs(asked, { linkKey: 'yt-b', targetMs: 60_000, transcript: T })).toBe(false)
  })

  it('is dropped when the length changed', () => {
    expect(bestClipsBelongs(asked, { linkKey: 'yt-a', targetMs: 120_000, transcript: T })).toBe(false)
  })

  it('is dropped when the captions were fetched again, even with the same words', () => {
    expect(T_AGAIN.words.map((w) => w.text)).toEqual(T.words.map((w) => w.text))
    expect(bestClipsBelongs(asked, { linkKey: 'yt-a', targetMs: 60_000, transcript: T_AGAIN })).toBe(false)
    expect(bestClipsBelongs(asked, { linkKey: 'yt-a', targetMs: 60_000, transcript: null })).toBe(false)
    expect(bestClipsBelongs(asked, null)).toBe(false)
  })

  it('shows a kept result only for its link and length', async () => {
    const result = await bestClips(T, null, 60_000)
    const state: BestClipsState = { ...initialBestClips(), last: { ...asked, result } }
    expect(shownBestClips(state, { linkKey: 'yt-a', transcript: T })).toBe(result)
    expect(shownBestClips(state, { linkKey: 'yt-b', transcript: T })).toBeNull()
    expect(shownBestClips({ ...state, targetMs: 120_000 }, { linkKey: 'yt-a', transcript: T })).toBeNull()
    expect(shownBestClips(state, null)).toBeNull()
  })
})

describe('one Analyse at a time', () => {
  it('refuses a second press while one runs, and a press with no words', () => {
    const idle = initialBestClips()
    expect(analyseRefusal(idle, { transcript: T })).toBeNull()
    expect(analyseRefusal({ ...idle, running: asked }, { transcript: T })).toBe('running')
    expect(analyseRefusal(idle, { transcript: null })).toBe('no-transcript')
    expect(analyseRefusal(idle, null)).toBe('no-transcript')
    expect(analyseRefusal(idle, { transcript: { ...T, words: [], segments: [] } })).toBe('no-transcript')
  })
  it('names the run this panel’s only for the same link and the same captions, at any length', () => {
    const running = { ...initialBestClips(), running: asked }
    expect(runningHere(running, { linkKey: 'yt-a', transcript: T })).toBe(true)
    expect(runningHere({ ...running, targetMs: 120_000 }, { linkKey: 'yt-a', transcript: T })).toBe(true)
    expect(runningHere(running, { linkKey: 'yt-b', transcript: T })).toBe(false)
    expect(runningHere(running, { linkKey: 'yt-a', transcript: T_AGAIN })).toBe(false)
    expect(runningHere(running, null)).toBe(false)
    expect(runningHere(initialBestClips(), { linkKey: 'yt-a', transcript: T })).toBe(false)
  })
})

describe('the length', () => {
  it('offers 1, 2, 3 and 4 min, 1 min first', () => {
    expect(BEST_CLIPS_LENGTHS.map((l) => [l.ms, l.label])).toEqual([
      [60_000, '1 min'],
      [120_000, '2 min'],
      [180_000, '3 min'],
      [240_000, '4 min']
    ])
    expect(DEFAULT_BEST_CLIPS_MS).toBe(60_000)
    expect(initialBestClips().targetMs).toBe(60_000)
  })

  it('clears the cards when it changes, keeps them when the same is picked, and ignores a length not offered', async () => {
    const result = await bestClips(T, null, 60_000)
    const state: BestClipsState = { ...initialBestClips(), last: { ...asked, result } }
    const changed = withLength(state, 120_000)
    expect(changed.targetMs).toBe(120_000)
    expect(changed.last).toBeNull()
    expect(withLength(state, 60_000)).toBe(state)
    expect(withLength(state, 90_000)).toBe(state)
  })

  it('waits three minutes for the model', () => {
    expect(BEST_CLIPS_TIMEOUT_MS).toBe(180_000)
  })
})

describe('whether a model would answer', () => {
  const status = (ready: boolean[]): LlmStatus[] => [
    { id: 'ollama', label: 'Ollama', kind: 'local', ready: ready[0], reason: ready[0] ? null : 'off' },
    { id: 'openai', label: 'Local server', kind: 'local', ready: ready[1], reason: ready[1] ? null : 'off' }
  ]

  it('is main complete’s own test: chooseProvider over the status and the choice', () => {
    expect(modelReady(status([false, false]), 'auto')).toBe(false)
    expect(modelReady(status([true, false]), 'auto')).toBe(true)
    expect(modelReady(status([false, true]), 'auto')).toBe(true)
    // An explicit choice is honoured or fails: auto may fall back, a pick may not.
    expect(modelReady(status([true, false]), 'openai')).toBe(false)
    expect(modelReady([], 'auto')).toBe(false)
  })
})

describe('the ask', () => {
  const result = (text: string, truncated = false): CompletionResult => ({
    text,
    provider: 'openai',
    model: 'made-up-model',
    promptTokens: null,
    outputTokens: null,
    durationMs: 1,
    truncated
  })

  it('is askStructured over complete, as the graphics ask: a parsed answer is { value, truncated }', async () => {
    const seen: CompletionRequest[] = []
    const ask = bestClipsAskOver(async (request) => {
      seen.push(request)
      return result('{"reasoning":"r","picks":[]}')
    })
    const request: CompletionRequest = { system: 's', user: 'u', schema: {} }
    const out = await ask(request)
    expect(out.answer).toEqual({ value: { reasoning: 'r', picks: [] }, truncated: false })
    expect(out.model).toEqual({ id: 'made-up-model', runtime: 'openai' })
    expect(seen).toHaveLength(1)
    expect(seen[0].think).toBe(false)
  })

  it('makes an answer that is not JSON { error } (after askStructured’s one retry), and bestClips says it could not be used', async () => {
    let calls = 0
    const ask = bestClipsAskOver(async () => {
      calls++
      return result('Sure! Here are the clips you asked for.')
    })
    const out = await ask({ system: 's', user: 'u', schema: {} })
    expect('error' in out.answer).toBe(true)
    expect(calls).toBe(2)
    const run = await bestClips(T, null, 60_000, ask)
    expect(run.modelNote).toBe(MODEL_UNUSABLE_NOTE)
    expect(run.cards.every((c) => c.scoredBy === 'signals')).toBe(true)
  })

  it('lets a failing complete fail, and bestClips keeps none of its text: no server address, no key', async () => {
    const SERVER = 'http://10.1.2.3:1234/v1'
    const KEY = 'sk-madeupkey0123456789'
    const ask = bestClipsAskOver(async () => {
      throw new Error(`could not reach ${SERVER} with key ${KEY}`)
    })
    const run = await bestClips(T, null, 60_000, ask)
    expect(run.modelNote).toBe(MODEL_FAILED_NOTE)
    expect(run.fallback).toBe('ask-failed')
    expect(run.cards.length).toBeGreaterThan(0)
    const everything = JSON.stringify(run)
    expect(everything).not.toContain(SERVER)
    expect(everything).not.toContain(KEY)
  })
})

describe('what a card shows', () => {
  it('names who picked it in words a user reads', () => {
    expect(SCORED_BY_LABEL.model).toBe('Picked by the model')
    expect(SCORED_BY_LABEL.signals).toBe("Picked from the talk's own signals")
    expect(SCORED_BY_LABEL.model).not.toBe(SCORED_BY_LABEL.signals)
    for (const label of Object.values(SCORED_BY_LABEL)) expect(label).not.toMatch(/LLM|scoredBy|sidecar/i)
  })

  it('gives its range in the URL tile’s time marks, and its words', () => {
    expect(cardRange({ startMs: 61_000, endMs: 125_500 })).toBe('1:01.0 – 2:05.5')
    expect(cardRange({ startMs: 0, endMs: 59_960 })).toBe('0:00.0 – 1:00.0')
    expect(cardRange({ startMs: 3_600_000, endMs: 3_661_000 })).toBe('1:00:00.0 – 1:01:01.0')
    expect(cardWords({ words: 1 })).toBe('1 word')
    expect(cardWords({ words: 152 })).toBe('152 words')
  })
})
