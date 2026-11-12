import type { CompletionRequest, CompletionResult } from '@shared/director/provider'
import { ollamaAnswer, ollamaRequestBody, openaiAnswer, openaiRequestBody } from '@shared/director/provider'
import { askStructured } from '@shared/director/ask'
import { conforms, type Problem } from '@shared/director/conforms'
import { runGraphicsPass, type GraphicsAsk, type GraphicsMenu, type GraphicsRunPart } from '@shared/director/run'
import { GRAPHICS_PASS, graphicsSchema } from '@shared/director/schemaGraphics'
import { baselineGraphics } from '@shared/director/baselineGraphics'
import { STRETCH_SENTENCES } from '@shared/director/validateGraphics'
import { drawnStrings } from '@shared/graphics/apply'
import type { GraphicData, GraphicDrop } from '@shared/graphics/template'
import type { Transcript } from '@shared/transcript'
import type { EvalProvider, EvalRequest, EvalResponse } from './pipeline'
import { menuSentencesOf, projectForTranscript, type EvalGraphicsFixture, type NestedGraphicsFixture } from './graphicsFixtures'

/**
 * The graphics eval (docs/CLIPS.md §6.10, "The eval" and "Recorded per run"):
 * the requests a fixture's windows send, the saved answers settled as the app
 * settles them, and the per-run figures, every one a pure function over data
 * so the normal suite tests it (tests/graphicsEval.test.ts). No model, no
 * network and no file here: the eval's FORGE_EVAL_GRAPHICS block
 * (director.eval.test.ts) reads and writes the files around these.
 *
 * Both steps run the app's own loop, `runGraphicsPass` (run.ts), over a
 * project of one clip showing the fixture's transcript, with the ask the app's
 * own `askStructured` (ask.ts) over a `complete` that, in prepare, records the
 * request and stops, and in score, reads the answer the relay (or node) saved.
 * So a request is byte for byte what the app sends (`graphicsMenuFor`,
 * `graphicsPrompt`, `graphicsSchema`, `maxTokensForGraphics`, then
 * `askStructured`'s `think: false`), and an answer is settled by
 * `settleGraphics` with `baselineGraphics` for a window it cannot use, as
 * Find graphics settles it.
 */

export interface GraphicsEvalConfig {
  provider: EvalProvider
  model: string
}

/** A fixture as the eval scores it: the eval set's truth and traps, or the nested set's expectation. */
export type GraphicsEvalInput =
  | (Pick<EvalGraphicsFixture, 'id' | 'language' | 'transcript' | 'truth' | 'traps'> & { set: 'eval' })
  | (Pick<NestedGraphicsFixture, 'id' | 'language' | 'transcript' | 'title' | 'items' | 'parents'> & { set: 'nested' })

/** A window's request id: the fixture's, the pass and the window's first sentence ('eval-en-1.graphics.s00'). */
export function graphicsRequestId(fixtureId: string, menu: Pick<GraphicsMenu, 'sentences'>): string {
  return `${fixtureId}.graphics.${menu.sentences[0]?.id ?? 'none'}`
}

/** A retry's id: askStructured's second ask of a window whose first answer was not JSON. */
export const RETRY_SUFFIX = '.retry'

/** The EvalRequest for one CompletionRequest, as the relay posts it unchanged (harness/evalRelay.ts). */
export function evalRequestOf(id: string, fixtureId: string, request: CompletionRequest, config: GraphicsEvalConfig): EvalRequest {
  const openai = config.provider === 'openai'
  return {
    id,
    fixtureId,
    provider: config.provider,
    path: openai ? '/v1/chat/completions' : '/api/chat',
    body: openai ? openaiRequestBody(request, [], config.model) : ollamaRequestBody(request, [], config.model)
  }
}

/** Thrown by prepare's `complete`: the request is recorded and the ask goes no further. */
const PREPARED = 'prepared, not asked'

/** STEP=prepare: one request per window of the fixture's transcript, in the app's window order. */
export async function graphicsRequestsFor(fixture: { id: string; transcript: Transcript }, config: GraphicsEvalConfig): Promise<EvalRequest[]> {
  const { project, clip } = projectForTranscript(fixture.transcript)
  const out: EvalRequest[] = []
  const ask: GraphicsAsk = async (request, menu) => {
    await askStructured(async (sent) => {
      out.push(evalRequestOf(graphicsRequestId(fixture.id, menu), fixture.id, sent, config))
      throw new Error(PREPARED)
    }, request)
    throw new Error(PREPARED)
  }
  await runGraphicsPass(project, [clip], ask)
  return out
}

/** A kept graphic as the record holds it: where, what it draws, and whose. */
export interface KeptRecord {
  sentence: string
  /** The sentence as the menu offered it, for the blind rating. */
  said: string
  template: string
  data: GraphicData
  strings: string[]
  source: 'model' | 'baseline'
  proposal: boolean
}

/** One window of one side, as scored. */
export interface GraphicsWindowRecord {
  id: string
  first: string
  last: string
  /** A saved answer was read for the first ask (status 200 with a body). */
  answered: boolean
  status: number
  ms: number
  promptTokens: number | null
  outputTokens: number | null
  /** The answer that was settled parsed as JSON. */
  parsed: boolean
  /** The decoder stopped at its token cap. */
  truncated: boolean
  /** Parsed, not cut off, and not the shape asked for (`conforms` against the unconstrained schema, as `validateGraphics` checks it). */
  wrongShape: boolean
  /**
   * Prose came back (§6.6's nudge): the first answer was not JSON and was not
   * cut off, so `askStructured` asked a second time with `JSON_ONLY_NUDGE`
   * (OpenAI shape) or thinking on (Ollama), and noted `notJsonRetryNote`.
   */
  prose: boolean
  /** The second ask has no saved answer yet: its request is returned in `pending`. */
  retryPending: boolean
  /** The window's answer went unused and the baseline's graphics settled it. */
  baseline: boolean
  rejected: string | null
  /** The parsed answer, as the model wrote it. */
  answer: unknown
  kept: KeptRecord[]
  /** settleGraphics' notes: every drop and every repair, with its path. */
  dropped: Problem[]
  drops: GraphicDrop[]
  /** askStructured's notes. */
  notes: string[]
}

export interface GraphicsFixtureResult {
  fixtureId: string
  set: 'eval' | 'nested'
  language: string
  pass: typeof GRAPHICS_PASS
  sentences: { id: string; text: string }[]
  truth?: { sentence: string; template: string }[]
  traps?: string[]
  title?: string
  items?: string[]
  parents?: number[]
  /** Windows settled from the model's saved answers (a window it could not use falls to the baseline, as in the app). */
  model: GraphicsWindowRecord[]
  /** The same windows with no model: every one the baseline's. */
  baseline: GraphicsWindowRecord[]
}

/** The note when a window has no saved answer. */
export function noAnswerNote(id: string): string {
  return `no saved answer for ${id}`
}

interface AskInfo {
  id: string
  answered: boolean
  status: number
  ms: number
  promptTokens: number | null
  outputTokens: number | null
  parsed: boolean
  truncated: boolean
  prose: boolean
  retryPending: boolean
  answer: unknown
  notes: string[]
}

function keptRecords(part: GraphicsRunPart): KeptRecord[] {
  const said = new Map(part.menu.sentences.map((s) => [s.id, s.text]))
  return part.settled.kept.map((c) => ({
    sentence: c.sentence,
    said: said.get(c.sentence) ?? '',
    template: c.data.template,
    data: c.data,
    strings: drawnStrings(c.data),
    source: c.source,
    proposal: c.proposal !== undefined
  }))
}

function windowRecord(info: AskInfo, part: GraphicsRunPart): GraphicsWindowRecord {
  const ids = part.menu.sentences.map((s) => s.id)
  const wrongShape = info.parsed && !info.truncated && conforms(graphicsSchema(part.menu, { constrained: false }), info.answer).length > 0
  return {
    id: info.id,
    first: ids[0] ?? '',
    last: ids[ids.length - 1] ?? '',
    answered: info.answered,
    status: info.status,
    ms: info.ms,
    promptTokens: info.promptTokens,
    outputTokens: info.outputTokens,
    parsed: info.parsed,
    truncated: info.truncated,
    wrongShape,
    prose: info.prose,
    retryPending: info.retryPending,
    baseline: part.settled.baseline,
    rejected: part.settled.rejected,
    answer: info.answer,
    kept: keptRecords(part),
    dropped: part.settled.dropped,
    drops: part.settled.drops,
    notes: info.notes
  }
}

/**
 * STEP=score for one fixture: its windows asked again through
 * `runGraphicsPass`, each answer read from `responseFor` (the saved
 * `responses/<id>.json`) and settled with the baseline available; then the
 * same windows with no model, for "model against baseline". A window whose
 * first answer was prose has its retry request returned in `pending` until
 * its answer (`<id>.retry`) is saved.
 */
export async function scoreGraphicsFixture(
  fixture: GraphicsEvalInput,
  config: GraphicsEvalConfig,
  responseFor: (id: string) => EvalResponse | null
): Promise<{ result: GraphicsFixtureResult; pending: EvalRequest[] }> {
  const { project, clip } = projectForTranscript(fixture.transcript)
  const infos: AskInfo[] = []
  const pending: EvalRequest[] = []
  const ask: GraphicsAsk = async (request, menu) => {
    const id = graphicsRequestId(fixture.id, menu)
    const info: AskInfo = { id, answered: false, status: 0, ms: 0, promptTokens: null, outputTokens: null, parsed: false, truncated: false, prose: false, retryPending: false, answer: null, notes: [] }
    infos.push(info)
    let calls = 0
    const complete = async (sent: CompletionRequest): Promise<CompletionResult> => {
      calls += 1
      const rid = calls === 1 ? id : `${id}${RETRY_SUFFIX}`
      // askStructured asks a second time only when the first answer was not JSON and not cut off.
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
    const asked = await askStructured(complete, request)
    info.notes = asked.notes
    info.truncated = asked.result.truncated
    info.parsed = !('error' in asked.parsed)
    info.answer = 'error' in asked.parsed ? null : asked.parsed.value
    return {
      answer: 'error' in asked.parsed ? { error: asked.parsed.error } : { value: asked.parsed.value, truncated: asked.result.truncated },
      model: { id: asked.result.model, runtime: asked.result.provider },
      notes: asked.notes
    }
  }
  const modelRun = await runGraphicsPass(project, [clip], ask, { baseline: baselineGraphics })
  const model = modelRun.parts.map((part, i) => windowRecord(infos[i], part))

  const noModel = (menu: GraphicsMenu): AskInfo => ({ id: graphicsRequestId(fixture.id, menu), answered: false, status: 0, ms: 0, promptTokens: null, outputTokens: null, parsed: false, truncated: false, prose: false, retryPending: false, answer: null, notes: [] })
  const baselineRun = await runGraphicsPass(project, [clip], async () => {
    throw new Error(BASELINE_ONLY)
  }, { baseline: baselineGraphics })
  const baseline = baselineRun.parts.map((part) => windowRecord(noModel(part.menu), part))

  const head: Pick<GraphicsFixtureResult, 'fixtureId' | 'set' | 'language' | 'pass' | 'sentences'> = {
    fixtureId: fixture.id,
    set: fixture.set,
    language: fixture.language,
    pass: GRAPHICS_PASS,
    sentences: menuSentencesOf(fixture.transcript)
  }
  const result: GraphicsFixtureResult =
    fixture.set === 'eval'
      ? { ...head, truth: fixture.truth.map((t) => ({ ...t })), traps: [...fixture.traps], model, baseline }
      : { ...head, title: fixture.title, items: [...fixture.items], parents: [...fixture.parents], model, baseline }
  return { result, pending }
}

/** Why the baseline side's windows have no answer: no model is asked. */
export const BASELINE_ONLY = 'no model: the baseline only'

// ---------------------------------------------------------------------------
// The figures of "Recorded per run".

/**
 * A drop's reason, classed from the validator's and the spacing's message
 * texts as they are in code (validateGraphics.ts `reasonText`, `check`,
 * `overLength`, `offered`, `settleOne`; run.ts `spaceGraphics`). A drop whose
 * reason joins several (`dropsOf` joins them with '; ') takes the first class
 * here that matches, in this order; none is 'other'. The order matters only
 * where two patterns could both match: 'order' and 'not-a-percentage' before
 * 'not-said'.
 */
export const DROP_REASONS: readonly (readonly [string, RegExp])[] = Object.freeze([
  ['spacing', /at most one graphic per [\d.]+ s of clip|is within [\d.]+ s of the one before/u],
  ['not-offered', /' is not offered(?:;|$)/u],
  ['not-on-menu', /is not a sentence on the menu|is not a sentence of the transcript|has no sentence to ground it/u],
  ['too-long', /is \d+ characters, at most \d+ are drawn/u],
  ['negated', /is said negated in /u],
  ['unpaired', /is not said with what it is paired with/u],
  ['order', /is not said in the order /u],
  ['other-unit', /is said in \S+ in another unit/u],
  ['not-a-percentage', /is not said as a percentage in |is not a share of a whole/u],
  ['not-a-number', /is not one number/u],
  ['ungrounded', /holds no word the transcript can ground|which the transcript cannot ground/u],
  ['not-said', /is not said in /u],
  ['speaker', /is not who said it|it is reported speech and the transcript does not name who said it/u],
  [
    'template-rule',
    /needs at least \d+ items|holds at most \d+ items|a quote is at most \d+ words|a keyword is 1 to \d+ said words|is not one of the keyword's|holds no word that says anything|in more than one unit|are not a valid tree/u
  ]
] as const)

export type DropReason = string

/** A drop's class (`DROP_REASONS`), 'other' when none matches. */
export function dropReasonOf(reason: string): DropReason {
  for (const [name, pattern] of DROP_REASONS) if (pattern.test(reason)) return name
  return 'other'
}

/**
 * The reasons counted as a hallucination (the key number): text or a number
 * the transcript does not say. 'not-said' (a value, label, title, item or
 * keyword said nowhere in the stretch, or a '?' or '!' not said), 'ungrounded'
 * (a field with words that ground to nothing, or a drawn mark the transcript
 * cannot ground) and 'other-unit' (a number said in another unit). Not
 * counted: a mispairing, a negation, an order, a template rule, a length, the
 * spacing or a sentence off the menu.
 */
export const HALLUCINATION_REASONS: readonly DropReason[] = Object.freeze(['not-said', 'ungrounded', 'other-unit'])

/** The repair note of a keyword's `lit` out of range (validateGraphics.ts `settleOne`). */
export const LIT_REPAIR_HEAD = 'graphic repaired: lit '

/** The numeric templates a number said as a word would drop (§16.11). */
const NUMBER_TEMPLATES: readonly string[] = ['counter', 'ring', 'bars']
const VALUE_PATH = /^\$\.graphics\[(\d+)\]\.(?:value|items\[\d+\]\.value)$/u

const isHindiOrTelugu = (lang: string): 'hi' | 'te' | null => (/^hi(?:$|[-_])/iu.test(lang) ? 'hi' : /^te(?:$|[-_])/iu.test(lang) ? 'te' : null)
const isEnglish = (lang: string): boolean => /^en(?:$|[-_])/iu.test(lang)

export interface NestedMatch {
  fixtureId: string
  language: string
  /** Steps graphics the side kept on this talk. */
  steps: number
  title: boolean
  items: boolean
  parents: boolean
  /** One kept steps graphic matches title, items and parents together. */
  exact: boolean
  /** English must match (§6.12, `treeParents`' exit); Hindi and Telugu are scored and recorded, not passed (§6.2). */
  bar: 'pass' | 'fail' | 'recorded'
}

export interface GraphicsFigures {
  side: 'model' | 'baseline'
  fixtures: number
  windows: number
  /** The model side's windows: a saved answer read, parsed, cut off, the wrong shape, prose, a retry still to ask, settled by the baseline instead. */
  answered: number
  parsed: number
  truncated: number
  wrongShape: number
  prose: number
  retryPending: number
  fellBack: number
  /** Graphics proposed: each one the side's settle kept or dropped (a drop counted once, however many reasons it has). */
  proposed: number
  proposedByTemplate: Record<string, number>
  kept: number
  keptByTemplate: Record<string, number>
  dropped: number
  /** Dropped over proposed; null with nothing proposed. */
  droppedShare: number | null
  /** Dropped by the validator: every drop but the spacing's (rule 10, run.ts `spaceGraphics`), and its share of proposed. */
  droppedByValidator: number
  validatorShare: number | null
  droppedByReason: Record<string, number>
  /** Drops whose class is one of `HALLUCINATION_REASONS`, and their share of proposed (the key number). */
  hallucinations: number
  hallucinationRate: number | null
  /**
   * Hindi and Telugu graphics dropped because a number was said as a word
   * (§16.11): a counter, ring or bars of the model's whose value field was
   * dropped as not said or not one number, when its stretch (the sentence
   * and one either side) holds no digit of any script. An upper bound: the
   * number may not have been said at all; which it was is the reader's call.
   */
  numberAsWord: { hi: number; te: number }
  /**
   * Telugu clauses with a negative ending missed (§15 row 11), as far as a
   * fixture can tell: the side's kept graphics on a Telugu fixture's trap
   * sentence. `NEGATORS.te` holds two words and no ending (claims.ts), so a
   * clause negated by its verb ending keeps its graphic; a trap kept is the
   * count's upper bound, since a trap may be another kind.
   */
  teluguTrapsKept: number
  /** Kept graphics on any fixture's trap sentence. */
  trapsKept: number
  litRepairs: number
  /**
   * The truth-hit rate (±1 sentence): a truth is hit when a kept graphic of
   * its template sits on its sentence or the one before or after it in the
   * transcript's sentence order (`menuSentencesOf`); each truth counted once.
   */
  truths: number
  truthHits: number
  truthHitRate: number | null
  /** Eval fixtures with at least one truth hit, of those with a truth. */
  fixturesHit: number
  fixturesWithTruth: number
  nested: NestedMatch[]
}

const bump = (m: Record<string, number>, k: string, by = 1): void => {
  m[k] = (m[k] ?? 0) + by
}
const share = (n: number, of: number): number | null => (of > 0 ? n / of : null)

/** A string compared as the nested set compares it: NFC, case-folded, spaces collapsed, an end mark off. */
export function nestedKey(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim().replace(/[.!?।…:;,]+$/u, '').trim()
}

/** The nested set's match for one fixture: its expected title, items and parents against the side's kept steps graphics. */
export function nestedMatchOf(result: GraphicsFixtureResult, windows: readonly GraphicsWindowRecord[]): NestedMatch {
  const steps = windows.flatMap((w) => w.kept).flatMap((k) => (k.data.template === 'steps' ? [k.data] : []))
  const title = (d: (typeof steps)[number]): boolean => nestedKey(d.title) === nestedKey(result.title ?? '')
  const items = (d: (typeof steps)[number]): boolean =>
    d.items.length === (result.items ?? []).length && d.items.every((it, i) => nestedKey(it.label) === nestedKey(result.items![i]))
  const parents = (d: (typeof steps)[number]): boolean => JSON.stringify(d.items.map((it) => it.parent ?? -1)) === JSON.stringify(result.parents ?? [])
  const exact = steps.some((d) => title(d) && items(d) && parents(d))
  return {
    fixtureId: result.fixtureId,
    language: result.language,
    steps: steps.length,
    title: steps.some(title),
    items: steps.some(items),
    parents: steps.some(parents),
    exact,
    bar: isEnglish(result.language) ? (exact ? 'pass' : 'fail') : 'recorded'
  }
}

/** The windows one side is scored on: the model's own answers (a window settled by the baseline is not the model's), or every baseline window. */
export function sideWindows(result: GraphicsFixtureResult, side: 'model' | 'baseline'): GraphicsWindowRecord[] {
  return side === 'model' ? result.model.filter((w) => !w.baseline) : result.baseline
}

/** Every figure of "Recorded per run" for one side, over every fixture of a run. Pure. */
export function graphicsFigures(results: readonly GraphicsFixtureResult[], side: 'model' | 'baseline'): GraphicsFigures {
  const f: GraphicsFigures = {
    side,
    fixtures: results.length,
    windows: 0,
    answered: 0,
    parsed: 0,
    truncated: 0,
    wrongShape: 0,
    prose: 0,
    retryPending: 0,
    fellBack: 0,
    proposed: 0,
    proposedByTemplate: {},
    kept: 0,
    keptByTemplate: {},
    dropped: 0,
    droppedShare: null,
    droppedByValidator: 0,
    validatorShare: null,
    droppedByReason: {},
    hallucinations: 0,
    hallucinationRate: null,
    numberAsWord: { hi: 0, te: 0 },
    teluguTrapsKept: 0,
    trapsKept: 0,
    litRepairs: 0,
    truths: 0,
    truthHits: 0,
    truthHitRate: null,
    fixturesHit: 0,
    fixturesWithTruth: 0,
    nested: []
  }
  for (const r of results) {
    const all = side === 'model' ? r.model : r.baseline
    f.windows += all.length
    if (side === 'model') {
      for (const w of all) {
        if (w.answered) f.answered += 1
        if (w.parsed) f.parsed += 1
        if (w.truncated) f.truncated += 1
        if (w.wrongShape) f.wrongShape += 1
        if (w.prose) f.prose += 1
        if (w.retryPending) f.retryPending += 1
        if (w.baseline) f.fellBack += 1
      }
    }
    const windows = sideWindows(r, side)
    const kept = windows.flatMap((w) => w.kept)
    for (const k of kept) {
      bump(f.proposedByTemplate, k.template)
      bump(f.keptByTemplate, k.template)
    }
    f.kept += kept.length
    for (const w of windows) {
      for (const d of w.drops) {
        bump(f.proposedByTemplate, d.template)
        const why = dropReasonOf(d.reason)
        bump(f.droppedByReason, why)
        f.dropped += 1
        if (why !== 'spacing') f.droppedByValidator += 1
        if (HALLUCINATION_REASONS.includes(why)) f.hallucinations += 1
      }
      f.litRepairs += w.dropped.filter((p) => p.message.startsWith(LIT_REPAIR_HEAD)).length
    }

    const lang = isHindiOrTelugu(r.language)
    const order = new Map(r.sentences.map((s, i) => [s.id, i]))
    if (lang) {
      for (const w of windows) {
        const graphics = (w.answer as { graphics?: { sentence?: unknown; template?: unknown }[] } | null)?.graphics
        if (!Array.isArray(graphics)) continue
        const counted = new Set<number>()
        for (const p of w.dropped) {
          const m = VALUE_PATH.exec(p.path)
          if (!m) continue
          const why = dropReasonOf(p.message)
          if (why !== 'not-said' && why !== 'not-a-number') continue
          const i = Number(m[1])
          const g = graphics[i]
          if (!g || typeof g.template !== 'string' || !NUMBER_TEMPLATES.includes(g.template) || typeof g.sentence !== 'string') continue
          const at = order.get(g.sentence)
          if (at === undefined) continue
          const stretch = r.sentences.slice(Math.max(0, at - STRETCH_SENTENCES), at + STRETCH_SENTENCES + 1)
          if (stretch.some((s) => /\p{Nd}/u.test(s.text))) continue
          counted.add(i)
        }
        f.numberAsWord[lang] += counted.size
      }
    }

    if (r.set === 'eval') {
      const traps = new Set(r.traps ?? [])
      const onTraps = kept.filter((k) => traps.has(k.sentence)).length
      f.trapsKept += onTraps
      if (lang === 'te') f.teluguTrapsKept += onTraps
      const truth = r.truth ?? []
      let hits = 0
      for (const t of truth) {
        const at = order.get(t.sentence)
        if (at === undefined) continue
        const hit = kept.some((k) => {
          const where = order.get(k.sentence)
          return k.template === t.template && where !== undefined && Math.abs(where - at) <= 1
        })
        if (hit) hits += 1
      }
      f.truths += truth.length
      f.truthHits += hits
      if (truth.length > 0) {
        f.fixturesWithTruth += 1
        if (hits > 0) f.fixturesHit += 1
      }
    } else {
      f.nested.push(nestedMatchOf(r, windows))
    }
  }
  f.proposed = f.kept + f.dropped
  f.droppedShare = share(f.dropped, f.proposed)
  f.validatorShare = share(f.droppedByValidator, f.proposed)
  f.hallucinationRate = share(f.hallucinations, f.proposed)
  f.truthHitRate = share(f.truthHits, f.truths)
  return f
}

// ---------------------------------------------------------------------------
// What may never be written.

/**
 * Anything in a request or result file's text that looks like a key, a
 * header or a credentialed URL: an `authorization`, `api_key`/`apiKey`,
 * `x-api-key` or `headers` field; a bearer token; an `sk-` key; a URL with a
 * user and password. Empty when clean. The eval asserts it on every file it
 * writes.
 */
export function credentialsIn(text: string): string[] {
  const patterns: [string, RegExp][] = [
    ['an authorization field', /"authorization"\s*:/iu],
    ['an api key field', /"(?:api[-_]?key|x-api-key|apikey)"\s*:/iu],
    ['a headers field', /"headers"\s*:/iu],
    ['a bearer token', /\bbearer\s+[A-Za-z0-9._~+/-]{12,}/iu],
    ['an sk- key', /\bsk-[A-Za-z0-9_-]{12,}/u],
    ['a credentialed URL', /[a-z][a-z0-9+.-]*:\/\/[^/\s"@]+:[^/\s"@]*@/iu]
  ]
  return patterns.filter(([, p]) => p.test(text)).map(([name]) => name)
}
