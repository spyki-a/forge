import type { CompletionRequest, CompletionResult } from '@shared/director/provider'
import { ollamaAnswer, openaiAnswer } from '@shared/director/provider'
import { askStructured } from '@shared/director/ask'
import { conforms, type Problem } from '@shared/director/conforms'
import { bestClips, type BestClipCard, type BestClipsAsk, type BestClipsResult } from '@shared/bestclips/run'
import { BEST_CLIPS_PASS, bestClipsSchema } from '@shared/bestclips/schema'
import type { EvalRequest, EvalResponse } from './pipeline'
import { RETRY_SUFFIX, evalRequestOf, noAnswerNote, type GraphicsEvalConfig } from './graphicsEval'
import type { BestClipsEvalFixture } from './bestClipsFixtures'

/**
 * The Best clips eval (docs/CLIPS.md §7.4, §7.7): the request a fixture
 * sends and its saved answer settled as the app settles it, each a pure
 * function over data so the normal suite tests it
 * (tests/bestClipsModel.test.ts). No model, no network and no file here: the
 * eval's FORGE_EVAL_BESTCLIPS block (director.eval.test.ts) reads and writes
 * the files around these.
 *
 * Both steps run the app's own `bestClips` (bestclips/run.ts) with the ask the
 * app's own `askStructured` (director/ask.ts) over a `complete` that, in
 * prepare, records the request and stops, and in score, reads the answer the
 * relay (or node) saved. So a request is byte for byte what the app sends
 * (`candidatesFor`, `bestClipsPrompt`, `bestClipsSchema`,
 * `maxTokensForBestClips`, then askStructured's `think: false`), and an answer
 * is settled by `validateBestClips` and filled from the signals exactly as
 * Analyse settles it.
 */

export type BestClipsEvalConfig = GraphicsEvalConfig

/** A fixture's request id ('bc-en-heat.bestclips'). */
export function bestClipsRequestId(fixtureId: string): string {
  return `${fixtureId}.bestclips`
}

/** A best clips request's id ends in '.bestclips' (or its retry's). */
export const isBestClipsRequest = (r: Pick<EvalRequest, 'id'>): boolean => /\.bestclips(?:\.retry)?$/u.test(r.id)

const PREPARED = 'prepared, not asked'

/** STEP=prepare: the one request of a fixture, or none when it has no candidate (nothing to ask). */
export async function bestClipsRequestsFor(fixture: BestClipsEvalFixture, config: BestClipsEvalConfig): Promise<EvalRequest[]> {
  const out: EvalRequest[] = []
  const ask: BestClipsAsk = async (request) => {
    await askStructured(async (sent) => {
      out.push(evalRequestOf(bestClipsRequestId(fixture.id), fixture.id, sent, config))
      throw new Error(PREPARED)
    }, request)
    throw new Error(PREPARED)
  }
  await bestClips(fixture.transcript, { heatmap: fixture.heatmap, language: fixture.language }, fixture.targetMs, ask)
  return out
}

/** One side of a fixture, as scored. */
export interface BestClipsSideRecord {
  answered: boolean
  status: number
  ms: number
  promptTokens: number | null
  outputTokens: number | null
  parsed: boolean
  truncated: boolean
  /** Parsed, not cut off, and not the shape asked for. */
  wrongShape: boolean
  /** The first answer was prose, so askStructured asked again. */
  prose: boolean
  retryPending: boolean
  answer: unknown
  cards: BestClipCard[]
  modelNote: string | null
  fallback: BestClipsResult['fallback']
  problems: Problem[]
  notes: string[]
}

export interface BestClipsFixtureResult {
  fixtureId: string
  language: string
  pass: typeof BEST_CLIPS_PASS
  targetMs: number
  note: string | null
  candidates: { id: string; startMs: number; endMs: number; score: number; why: string; condensed: string }[]
  model: BestClipsSideRecord
  signals: BestClipsSideRecord
}

const emptySide = (r: BestClipsResult): BestClipsSideRecord => ({
  answered: false,
  status: 0,
  ms: 0,
  promptTokens: null,
  outputTokens: null,
  parsed: false,
  truncated: false,
  wrongShape: false,
  prose: false,
  retryPending: false,
  answer: null,
  cards: r.cards,
  modelNote: r.modelNote,
  fallback: r.fallback,
  problems: r.problems,
  notes: r.askNotes
})

/**
 * STEP=score for one fixture: its request asked again through `bestClips`,
 * the answer read from `responseFor` (the saved `responses/<id>.json`); then
 * the same fixture with no model, for "model against signals". A first answer
 * that was prose has its retry request returned in `pending` until its answer
 * (`<id>.retry`) is saved.
 */
export async function scoreBestClipsFixture(
  fixture: BestClipsEvalFixture,
  config: BestClipsEvalConfig,
  responseFor: (id: string) => EvalResponse | null
): Promise<{ result: BestClipsFixtureResult; pending: EvalRequest[] }> {
  const id = bestClipsRequestId(fixture.id)
  const pending: EvalRequest[] = []
  const info = { answered: false, status: 0, ms: 0, promptTokens: null as number | null, outputTokens: null as number | null, parsed: false, truncated: false, prose: false, retryPending: false, answer: null as unknown }
  let asked = false
  const ask: BestClipsAsk = async (request) => {
    asked = true
    let calls = 0
    const complete = async (sent: CompletionRequest): Promise<CompletionResult> => {
      calls += 1
      const rid = calls === 1 ? id : `${id}${RETRY_SUFFIX}`
      if (calls > 1) info.prose = true
      const response = responseFor(rid)
      if (!response) {
        if (calls > 1) {
          info.retryPending = true
          pending.push(evalRequestOf(rid, fixture.id, sent, config))
        }
        throw new Error(noAnswerNote(rid))
      }
      info.status = response.status
      info.ms += response.ms
      if (response.status !== 200 || response.data === undefined) throw new Error(`${rid}: ${response.error ?? `status ${response.status}`}`)
      if (calls === 1) info.answered = true
      const a = config.provider === 'openai' ? openaiAnswer(response.data) : ollamaAnswer(response.data)
      info.promptTokens = a.promptTokens
      info.outputTokens = a.outputTokens
      return { text: a.text, provider: config.provider, model: config.model, promptTokens: a.promptTokens, outputTokens: a.outputTokens, durationMs: response.ms, truncated: a.truncated }
    }
    const got = await askStructured(complete, request)
    info.truncated = got.result.truncated
    info.parsed = !('error' in got.parsed)
    info.answer = 'error' in got.parsed ? null : got.parsed.value
    return {
      answer: 'error' in got.parsed ? { error: got.parsed.error } : { value: got.parsed.value, truncated: got.result.truncated },
      model: { id: got.result.model, runtime: got.result.provider },
      notes: got.notes
    }
  }
  const meta = { heatmap: fixture.heatmap, language: fixture.language }
  const withModel = await bestClips(fixture.transcript, meta, fixture.targetMs, ask)
  const ids = withModel.candidates.candidates.map((c) => c.id)
  const model: BestClipsSideRecord = {
    ...emptySide(withModel),
    ...info,
    wrongShape: asked && info.parsed && !info.truncated && ids.length > 0 && conforms(bestClipsSchema(ids, { constrained: false }), info.answer).length > 0
  }
  const alone = await bestClips(fixture.transcript, meta, fixture.targetMs)
  return {
    result: {
      fixtureId: fixture.id,
      language: fixture.language,
      pass: BEST_CLIPS_PASS,
      targetMs: fixture.targetMs,
      note: withModel.note,
      candidates: withModel.candidates.candidates.map((c) => ({ id: c.id, startMs: c.window.startMs, endMs: c.window.endMs, score: c.score, why: c.why, condensed: c.condensed })),
      model,
      signals: emptySide(alone)
    },
    pending
  }
}

/** A run's figures, over its fixtures. */
export interface BestClipsFigures {
  fixtures: number
  answered: number
  parsed: number
  prose: number
  truncated: number
  wrongShape: number
  /** Fixtures whose answer was not used at all (unparsed, wrong shape, failed). */
  unusable: number
  /** Cards the model picked, and cards the signals filled beside them. */
  modelCards: number
  filledCards: number
  /** Model picks whose title, or why, fell back (not grounded, or empty). */
  titleFallbacks: number
  whyFallbacks: number
  /** Picks dropped: off the menu, twice, overlapping, or beyond the count. */
  droppedPicks: number
  /** Model cards on a window the signals' three also hold. */
  agreeWithSignals: number
}

/** The figures, counted from the records' cards and problem paths (validate.ts writes each path). */
export function bestClipsFigures(results: readonly BestClipsFixtureResult[]): BestClipsFigures {
  const f: BestClipsFigures = { fixtures: results.length, answered: 0, parsed: 0, prose: 0, truncated: 0, wrongShape: 0, unusable: 0, modelCards: 0, filledCards: 0, titleFallbacks: 0, whyFallbacks: 0, droppedPicks: 0, agreeWithSignals: 0 }
  for (const r of results) {
    const m = r.model
    if (m.answered) f.answered++
    if (m.parsed) f.parsed++
    if (m.prose) f.prose++
    if (m.truncated) f.truncated++
    if (m.wrongShape) f.wrongShape++
    if (m.fallback === 'unusable' || m.fallback === 'ask-failed' || m.fallback === 'timeout') f.unusable++
    const signalIds = new Set(r.signals.cards.map((c) => c.windowId))
    for (const c of m.cards) {
      if (c.scoredBy === 'model') {
        f.modelCards++
        if (signalIds.has(c.windowId)) f.agreeWithSignals++
      } else if (m.fallback === null) f.filledCards++
    }
    for (const p of m.problems) {
      if (/^\$\.picks\[\d+\]\.title$/u.test(p.path)) f.titleFallbacks++
      else if (/^\$\.picks\[\d+\]\.why$/u.test(p.path)) f.whyFallbacks++
      else if (/^\$\.picks\[\d+\](?:\.id)?$/u.test(p.path)) f.droppedPicks++
    }
  }
  return f
}

/**
 * Why STEP=score must not write a result, or null when it may: the run was
 * never prepared, holds no best clips request (another pass's run name
 * reused), or no answer is saved for any of them (the relay not run yet).
 */
export function bestClipsScoreRefusal(runId: string, requests: readonly EvalRequest[] | null, answered: (id: string) => boolean): string | null {
  if (requests === null) return `${runId} was never prepared: it has no requests.json. Run STEP=prepare with FORGE_EVAL_RUN=${runId}, then the relay, then STEP=score.`
  const mine = requests.filter(isBestClipsRequest)
  if (mine.length === 0) return `${runId}'s requests.json holds no best clips request: name the best clips run with FORGE_EVAL_RUN.`
  if (!mine.some((r) => answered(r.id))) return `No answer is saved for any of ${runId}'s ${mine.length} best clips requests: run the relay on it first, then STEP=score.`
  return null
}
