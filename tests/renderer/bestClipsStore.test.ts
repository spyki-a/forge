import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditor, type UrlSource } from '../../src/renderer/src/store'
import { linkCacheKey, parseLink } from '@shared/ingest/url'
import type { CompletionRequest, CompletionResult, LlmStatus } from '@shared/director/provider'
import { MODEL_FAILED_NOTE, MODEL_SLOW_NOTE, NO_MODEL_NOTE } from '@shared/bestclips/run'
import { BEST_CLIPS_BUSY, BEST_CLIPS_TIMEOUT_MS } from '@shared/bestclips/session'
import { PAUSE_BOUNDARY_MS, segmentIntoSentences, type Transcript, type Word } from '@shared/transcript'
import { CAP_MS, CAP_WORDS } from '@shared/bestclips/windows'

/*
 * The store's half of Best clips' Analyse (docs/CLIPS.md §7.5): no model means
 * no ask; a model's answer lands; one Analyse at a time; an answer for a
 * link, a length or a transcript no longer the store's is dropped; the
 * timeout frees the next press; an error's text never reaches a notice.
 * window.forge is a stub; every transcript is made up.
 */

const URL_A = 'https://www.youtube.com/watch?v=MadeUpTalk7'
const URL_B = 'https://www.youtube.com/watch?v=MadeUpTalk8'

/** A made-up punctuated talk: `n` sentences of 8..14 Latin nonsense words (seeded), 280 ms a word, as tests/eval/bestClipsFixtures.ts builds them. */
function madeUpTalk(n: number, seed: number): Transcript {
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
    const length = 8 + Math.floor(r() * 7)
    for (let i = 0; i < length; i++) {
      const last = i === length - 1
      const text = VOCAB[Math.floor(r() * 400) % VOCAB.length] + (last ? '.' : '')
      words.push({ index: words.length, text, startMs: at, endMs: at + 280, confidence: null })
      at += 280 + (last ? 300 : 60)
    }
  }
  return { assetId: 'url:test', language: 'en', model: 'test', durationMs: at, words, segments: segmentIntoSentences(words, PAUSE_BOUNDARY_MS, { maxWords: CAP_WORDS, maxMs: CAP_MS }) }
}

const T = madeUpTalk(60, 41)

const NONE: LlmStatus[] = [
  { id: 'ollama', label: 'Ollama', kind: 'local', ready: false, reason: 'off' },
  { id: 'openai', label: 'Local server', kind: 'local', ready: false, reason: 'off' }
]
const READY: LlmStatus[] = [NONE[0], { ...NONE[1], ready: true, reason: null }]

let status: LlmStatus[] = NONE
let asks: CompletionRequest[] = []
let complete: (r: CompletionRequest) => Promise<CompletionResult> = async () => {
  throw new Error('no answer set')
}

/** The model's answer: the first `n` ids of the menu, titled with a word of the talk. */
function answerFor(r: CompletionRequest, n = 3): CompletionResult {
  const schema = r.schema as { properties: { picks: { minItems: number; items: { properties: { id: { enum: string[] } } } } } }
  const ids = schema.properties.picks.items.properties.id.enum.slice(0, Math.min(n, schema.properties.picks.minItems))
  const picks = ids.map((id) => ({ id, title: 'zor plim', why: 'It is the clearest stretch.' }))
  return { text: JSON.stringify({ reasoning: 'r', picks }), provider: 'openai', model: 'made-up-model', promptTokens: 1, outputTokens: 1, durationMs: 1, truncated: false }
}

/** A promise held open until the test lets it go. */
function held<V>(): { promise: Promise<V>; resolve: (v: V) => void } {
  let resolve!: (v: V) => void
  const promise = new Promise<V>((r) => (resolve = r))
  return { promise, resolve }
}

function sourceFor(url: string, transcript: Transcript | null, patch: Partial<UrlSource> = {}): UrlSource {
  const link = parseLink(url)!
  return {
    linkKey: linkCacheKey(link),
    url: link.url,
    meta: null,
    fetchedAt: null,
    transcript,
    tracks: [{ key: 'en-orig', kind: 'asr' }],
    language: 'en',
    status: transcript ? 'ready' : 'none',
    error: null,
    run: null,
    anchorRow: null,
    clipped: false,
    ...patch
  }
}

function onLink(url: string, transcript: Transcript | null = T): void {
  useEditor.setState((s) => ({ ingest: { ...s.ingest, url }, urlSource: sourceFor(url, transcript) }))
}

const state = () => useEditor.getState()

/** Until `n` asks have gone out: microtasks only, so no timer moves (fake or real). */
async function asked(n: number): Promise<void> {
  for (let i = 0; i < 200 && asks.length < n; i++) await new Promise<void>((r) => queueMicrotask(r))
  expect(asks).toHaveLength(n)
}
const noticeTexts = (): string[] => state().notices.map((n) => n.text)

beforeEach(() => {
  status = NONE
  asks = []
  vi.stubGlobal('window', {
    forge: {
      directorStatus: async () => status,
      directorSettings: async () => ({ provider: 'auto', ollama: { baseUrl: '', model: '' }, openai: { baseUrl: '', model: '', hasKey: false } }),
      directorComplete: (r: CompletionRequest) => {
        asks.push(r)
        return complete(r)
      }
    }
  })
  useEditor.setState({ ...useEditor.getInitialState(), notices: [] })
  onLink(URL_A)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Analyse', () => {
  it('with no model configured asks nothing, and the talk’s own signals pick', async () => {
    await state().analyseBestClips()
    expect(asks).toHaveLength(0)
    const last = state().bestClips.last!
    expect(last.result.modelNote).toBe(NO_MODEL_NOTE)
    expect(last.result.cards.length).toBe(3)
    expect(last.result.cards.every((c) => c.scoredBy === 'signals')).toBe(true)
    expect(last.linkKey).toBe(linkCacheKey(parseLink(URL_A)!))
    expect(last.targetMs).toBe(60_000)
    expect(state().bestClips.running).toBeNull()
  })

  it('with a model asks it once, through directorComplete, and its picks land', async () => {
    status = READY
    complete = async (r) => answerFor(r)
    await state().analyseBestClips()
    expect(asks).toHaveLength(1)
    const result = state().bestClips.last!.result
    expect(result.modelNote).toBeNull()
    expect(result.cards.map((c) => c.scoredBy)).toEqual(['model', 'model', 'model'])
  })

  it('at the length picked', async () => {
    state().setBestClipsLength(120_000)
    await state().analyseBestClips()
    expect(state().bestClips.last!.targetMs).toBe(120_000)
    expect(state().bestClips.last!.result.targetMs).toBe(120_000)
  })

  it('with no words yet starts nothing and asks nothing', async () => {
    onLink(URL_A, null)
    let looked = 0
    ;(window as unknown as { forge: { directorStatus: () => Promise<LlmStatus[]> } }).forge.directorStatus = async () => {
      looked++
      return status
    }
    await state().analyseBestClips()
    expect(looked).toBe(0)
    expect(state().bestClips.running).toBeNull()
    expect(state().bestClips.last).toBeNull()
  })

  it('refuses a second press while one runs: one ask, and a plain notice', async () => {
    status = READY
    const answer = held<CompletionResult>()
    complete = () => answer.promise
    const first = state().analyseBestClips()
    await asked(1)
    await state().analyseBestClips()
    expect(asks).toHaveLength(1)
    expect(noticeTexts()).toContain(BEST_CLIPS_BUSY)
    answer.resolve(answerFor(asks[0]))
    await first
    expect(state().bestClips.last!.result.cards.length).toBe(3)
    expect(state().bestClips.running).toBeNull()
  })

  it('drops an answer that arrives after the length changed', async () => {
    status = READY
    const answer = held<CompletionResult>()
    complete = () => answer.promise
    const first = state().analyseBestClips()
    await asked(1)
    state().setBestClipsLength(180_000)
    answer.resolve(answerFor(asks[0]))
    await first
    expect(state().bestClips.last).toBeNull()
    expect(state().bestClips.running).toBeNull()
  })

  it('drops an answer that arrives after another link’s transcript was fetched', async () => {
    status = READY
    const answer = held<CompletionResult>()
    complete = () => answer.promise
    const first = state().analyseBestClips()
    await asked(1)
    onLink(URL_B)
    answer.resolve(answerFor(asks[0]))
    await first
    expect(state().bestClips.last).toBeNull()
  })

  it('drops an answer that arrives after the same link’s captions were fetched again', async () => {
    status = READY
    const answer = held<CompletionResult>()
    complete = () => answer.promise
    const first = state().analyseBestClips()
    await asked(1)
    onLink(URL_A, madeUpTalk(60, 41))
    answer.resolve(answerFor(asks[0]))
    await first
    expect(state().bestClips.last).toBeNull()
  })

  it('clears the cards when the length changes, and Analyse at the new length gives new ones', async () => {
    await state().analyseBestClips()
    expect(state().bestClips.last).not.toBeNull()
    state().setBestClipsLength(120_000)
    expect(state().bestClips.last).toBeNull()
    await state().analyseBestClips()
    expect(state().bestClips.last!.targetMs).toBe(120_000)
  })

  it('stops waiting after the timeout: the signals pick, and the next press is not blocked by the late answer', async () => {
    vi.useFakeTimers()
    status = READY
    const never = held<CompletionResult>()
    complete = () => never.promise
    const first = state().analyseBestClips()
    await asked(1)
    expect(state().bestClips.running).not.toBeNull()
    await vi.advanceTimersByTimeAsync(BEST_CLIPS_TIMEOUT_MS - 1)
    expect(state().bestClips.running).not.toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    await first
    expect(state().bestClips.running).toBeNull()
    expect(state().bestClips.last!.result.modelNote).toBe(MODEL_SLOW_NOTE)
    // The next press asks again at once.
    complete = async (r) => answerFor(r)
    await state().analyseBestClips()
    expect(asks).toHaveLength(2)
    expect(state().bestClips.last!.result.modelNote).toBeNull()
    // The first ask's answer, arriving at last, changes nothing.
    const now = state().bestClips.last
    never.resolve(answerFor(asks[0], 1))
    await vi.advanceTimersByTimeAsync(10)
    expect(state().bestClips.last).toBe(now)
  })

  it('never puts an error’s text in a notice or the state: a failing complete reads as the model not answering', async () => {
    status = READY
    const SERVER = 'http://10.9.8.7:1234/v1'
    const KEY = 'sk-madeupkey9876543210'
    complete = async () => {
      throw new Error(`fetch failed: ${SERVER} refused key ${KEY}`)
    }
    await state().analyseBestClips()
    expect(state().bestClips.last!.result.modelNote).toBe(MODEL_FAILED_NOTE)
    const seen = JSON.stringify({ notices: state().notices, bestClips: state().bestClips.last!.result })
    expect(seen).not.toContain(SERVER)
    expect(seen).not.toContain(KEY)
  })

  it('leaves the cards alone on a new project: they are session state', async () => {
    await state().analyseBestClips()
    const last = state().bestClips.last
    state().newProject()
    expect(state().bestClips.last).toBe(last)
  })
})
