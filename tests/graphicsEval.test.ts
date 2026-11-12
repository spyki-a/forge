import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JSON_ONLY_NUDGE } from '@shared/director/ask'
import { openaiRequestBody, ollamaRequestBody } from '@shared/director/provider'
import { graphicsMenuFor, settleGraphics } from '@shared/director/run'
import { graphicsSchema, maxTokensForGraphics } from '@shared/director/schemaGraphics'
import { graphicsPrompt } from '@shared/director/promptGraphics'
import type { Segment, Transcript, Word } from '@shared/transcript'
import {
  GRAPHICS_FIXTURE_DIR,
  loadGraphicsFixtures,
  noEvalFixturesLine,
  projectForTranscript,
  readEvalFixture,
  readNestedFixture
} from './eval/graphicsFixtures'
import {
  BASELINE_ONLY,
  HALLUCINATION_REASONS,
  credentialsIn,
  dropReasonOf,
  graphicsFigures,
  graphicsRequestsFor,
  scoreGraphicsFixture,
  type GraphicsEvalInput,
  type GraphicsFixtureResult
} from './eval/graphicsEval'
import type { EvalResponse } from './eval/pipeline'
import { buildReport, summarise } from '../scripts/eval-report.mjs'
import { graphicLinesOf, graphicsRating } from '../scripts/eval-rate.mjs'

/*
 * The graphics eval's readers, requests, settle and per-run figures
 * (docs/CLIPS.md §6.10, "The eval", "Fixtures", "Recorded per run"), lane T4
 * piece 2. Every transcript and answer here is English text written for this
 * test, or a string already in the repo (tests/fixtures/graphics/specs.json's
 * quote-hi and keyword-te); no model and no network. The ten eval-*.json are
 * the owner's recordings and are not in the repo: the reader's case over the
 * real folder says so.
 */

/** A talk, one word every `ms` (1.2 s: a 12-word sentence stays one capped segment under 15 s), segment ids s00, s01, …. */
function talk(sentences: string[], options: { ms?: number; language?: string; assetId?: string } = {}): Transcript {
  const ms = options.ms ?? 1200
  const words: Word[] = []
  const segments: Segment[] = []
  let index = 0
  sentences.forEach((text, k) => {
    const start = index
    for (const w of text.split(/\s+/u).filter(Boolean)) {
      words.push({ index, text: w, startMs: index * ms, endMs: index * ms + ms - 100, confidence: null })
      index += 1
    }
    segments.push({ id: `s${String(k).padStart(2, '0')}`, startMs: start * ms, endMs: (index - 1) * ms + ms - 100, text, wordStart: start, wordEnd: index - 1 })
  })
  return { assetId: options.assetId ?? 'a', language: options.language ?? 'en', model: 'whisper-small', durationMs: index * ms, words, segments }
}

/** One answer graphic, every unused field '' as the schema has it. */
const g = (fields: Record<string, unknown>): Record<string, unknown> => ({ title: '', value: '', label: '', items: [], quote: '', words: '', lit: 0, why: 'it helps', ...fields })

/** A saved OpenAI-shaped answer, as the relay writes it. */
const saved = (id: string, content: string, finish = 'stop'): EvalResponse => ({
  id,
  status: 200,
  ms: 1000,
  data: { choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: 900, completion_tokens: 120 } }
})

const CONFIG = { provider: 'openai' as const, model: 'test-model' }

/* Fixture A: five sentences, one window. */
const A = talk(
  [
    'We signed 40 clients over the whole of this year.',
    'Then we grew to 70 percent of the local market share.',
    'Our plan for every couple stays simple and calm, always and forever.',
    'We never lost 20 percent of our couples in any season.',
    'The album costs $1,200 for the full day of the wedding.'
  ],
  { assetId: 'A' }
)
const ANSWER_A = {
  reasoning: 'numbers',
  graphics: [
    g({ sentence: 's00', template: 'counter', value: '40', label: 'clients' }),
    g({ sentence: 's01', template: 'ring', value: '70%', label: 'market' }),
    // Neither said: one graphic, two problems, one drop.
    g({ sentence: 's02', template: 'counter', value: '90', label: 'weddings' }),
    // Said, but negated.
    g({ sentence: 's03', template: 'ring', value: '20%', label: 'couples' })
  ]
}
const FIXTURE_A: GraphicsEvalInput = {
  set: 'eval',
  id: 'eval-a',
  language: 'en',
  transcript: A,
  truth: [
    { sentence: 's00', template: 'counter' }, // the counter on s00: hit
    { sentence: 's02', template: 'ring' }, // the ring on s01, one sentence away: hit
    { sentence: 's04', template: 'counter' }, // no model counter within one: miss
    { sentence: 's02', template: 'counter' } // the counter on s00 is two away: miss
  ],
  traps: ['s03']
}

/* Fixture B: prose first, then the nudged retry's keyword with lit out of range, on a trap sentence. */
const B = talk(
  [
    'Welcome back to the studio for one more short lesson today.',
    'Good light makes every portrait look calm, honest and very warm.',
    'Our plan for every couple stays simple and calm, always and forever.'
  ],
  { assetId: 'B' }
)
const ANSWER_B = { reasoning: 'a phrase', graphics: [g({ sentence: 's02', template: 'keyword', words: 'simple and calm', lit: 7 })] }
const FIXTURE_B: GraphicsEvalInput = { set: 'eval', id: 'eval-b', language: 'en', transcript: B, truth: [{ sentence: 's01', template: 'keyword' }], traps: ['s02'] }

const RESPONSES: Record<string, EvalResponse> = {
  'eval-a.graphics.s00': saved('eval-a.graphics.s00', JSON.stringify(ANSWER_A)),
  'eval-b.graphics.s00': saved('eval-b.graphics.s00', 'Sure! I would put a keyword on the last sentence.'),
  'eval-b.graphics.s00.retry': saved('eval-b.graphics.s00.retry', JSON.stringify(ANSWER_B))
}
const from =
  (responses: Record<string, EvalResponse>) =>
  (id: string): EvalResponse | null =>
    responses[id] ?? null

async function scoredAB(): Promise<GraphicsFixtureResult[]> {
  const a = await scoreGraphicsFixture(FIXTURE_A, CONFIG, from(RESPONSES))
  const b = await scoreGraphicsFixture(FIXTURE_B, CONFIG, from(RESPONSES))
  expect([a.pending, b.pending]).toEqual([[], []])
  return [a.result, b.result]
}

describe('the fixture readers (§6.10 "Fixtures")', () => {
  it('reads the repo’s folder: no eval-*.json (the owner’s ten are not there), the three English nested fixtures', () => {
    const { eval: evals, nested } = loadGraphicsFixtures()
    expect(evals).toEqual([])
    expect(nested.map((n) => [n.id, n.language, n.parents])).toEqual([
      ['nested-en-1', 'en', [-1, 0, 0, -1, -1]],
      ['nested-en-2', 'en', [-1, -1, 1, 1, 1, -1]],
      ['nested-en-3', 'en', [-1, 0, 0, -1, 3, 3]]
    ])
    expect(noEvalFixturesLine()).toBe(
      'No eval-*.json in tests/fixtures/graphics: the ten eval transcripts are your recordings and are not there yet, so no graphics request was written.'
    )
    expect(noEvalFixturesLine(GRAPHICS_FIXTURE_DIR)).toBe(noEvalFixturesLine())
  })

  it('reads an eval fixture of the §6.10 shape, a note beside it allowed', () => {
    const f = readEvalFixture('eval-a.json', { note: 'written for the test', language: 'en', transcript: A, truth: FIXTURE_A.set === 'eval' ? FIXTURE_A.truth : [], traps: ['s03'] })
    expect([f.id, f.file, f.language, f.truth.length, f.traps]).toEqual(['eval-a', 'eval-a.json', 'en', 4, ['s03']])
  })

  it('names the file by its basename and the field, for every shape fault', () => {
    const base = { language: 'en', transcript: A, truth: [{ sentence: 's00', template: 'counter' }], traps: [] as string[] }
    const err = (raw: unknown, path = '/somewhere/else/eval-x.json'): string => {
      try {
        readEvalFixture(path, raw)
      } catch (e) {
        return (e as Error).message
      }
      return 'no error'
    }
    expect(err({ ...base, truth: undefined })).toBe('eval-x.json: truth is not a list')
    expect(err({ ...base, traps: 's03' })).toBe('eval-x.json: traps is not a list')
    expect(err({ ...base, truth: [{ sentence: 's00', template: 'tree' }] })).toBe(
      "eval-x.json: truth[0].template 'tree' is not one of counter, bars, steps, quote, ring, keyword, callout"
    )
    expect(err({ ...base, truth: [{ sentence: 's09', template: 'ring' }] })).toBe("eval-x.json: truth[0].sentence 's09' is not a sentence of the transcript")
    expect(err({ ...base, truth: [{ sentence: 's00' }] })).toBe('eval-x.json: truth[0] is not { sentence, template }')
    expect(err({ ...base, traps: ['s05'] })).toBe("eval-x.json: traps[0] 's05' is not a sentence of the transcript")
    expect(err({ ...base, language: 'hi' })).toBe("eval-x.json: language 'hi' is not the transcript's language 'en'")
    expect(err({ ...base, transcript: { ...A, words: [] } })).toBe('eval-x.json: transcript.words is not a non-empty list')
    expect(err({ ...base, transcript: { ...A, segments: [{ id: 's00' }] } })).toBe(
      'eval-x.json: transcript.segments[0] is not { id, startMs, endMs, text, wordStart, wordEnd }'
    )
    expect(err([])).toBe('eval-x.json: is not a JSON object')
    // A Windows-shaped name is still its basename on Windows; here it is checked by what node:path takes on this machine.
    expect(err({ ...base, truth: undefined }, 'eval-y.json')).toBe('eval-y.json: truth is not a list')
  })

  it('checks a truth id against the capped sentences the menu offers, not the stored segments', () => {
    // One 16-word sentence at 1.2 s a word lasts over 15 s: capSegments splits it into s00.1 and s00.2.
    const long = talk(['one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen.'], { assetId: 'L' })
    const raw = { language: 'en', transcript: long, truth: [{ sentence: 's00', template: 'keyword' }], traps: [] }
    expect(() => readEvalFixture('eval-l.json', raw)).toThrow("eval-l.json: truth[0].sentence 's00' is not a sentence of the transcript")
    expect(readEvalFixture('eval-l.json', { ...raw, truth: [{ sentence: 's00.2', template: 'keyword' }] }).truth).toEqual([{ sentence: 's00.2', template: 'keyword' }])
  })

  it('reads a nested fixture and refuses parents that are not a tree list', () => {
    const raw = { language: 'en', transcript: A, title: 'Two things', items: ['plan', 'shoot'], parents: [-1, -1] }
    expect(readNestedFixture('nested-x.json', raw).items).toEqual(['plan', 'shoot'])
    expect(() => readNestedFixture('nested-x.json', { ...raw, parents: [-1] })).toThrow('nested-x.json: parents has 1 entries for 2 items')
    expect(() => readNestedFixture('nested-x.json', { ...raw, parents: [-1, 1] })).toThrow('nested-x.json: parents[1] 1 is not -1 or an earlier item')
    expect(() => readNestedFixture('nested-x.json', { ...raw, title: 3 })).toThrow('nested-x.json: title is not a string')
  })

  it('picks up an eval fixture when one is added to the folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'graphics-fixtures-'))
    writeFileSync(join(dir, 'eval-en-1.json'), JSON.stringify({ language: 'en', transcript: A, truth: [{ sentence: 's01', template: 'ring' }], traps: ['s03'] }))
    writeFileSync(join(dir, 'specs.json'), '{"specs": []}')
    const read = loadGraphicsFixtures(dir)
    expect(read.eval.map((f) => [f.id, f.truth])).toEqual([['eval-en-1', [{ sentence: 's01', template: 'ring' }]]])
    expect(read.nested).toEqual([])
    expect(loadGraphicsFixtures(join(dir, 'not-there'))).toEqual({ eval: [], nested: [] })
  })
})

describe('STEP=prepare: the requests (§6.10 "The eval")', () => {
  // 30 sentences: two menu windows, 24 and 6 (MAX_CANDIDATES), as the app cuts them.
  const LONG = talk(Array.from({ length: 30 }, (_, i) => `Sentence number ${i} says a little more here.`), { assetId: 'W' })

  it('writes one request per window, each the app’s own body with thinking off, and no key', async () => {
    const requests = await graphicsRequestsFor({ id: 'eval-w', transcript: LONG }, CONFIG)
    expect(requests.map((r) => [r.id, r.fixtureId, r.provider, r.path])).toEqual([
      ['eval-w.graphics.s00', 'eval-w', 'openai', '/v1/chat/completions'],
      ['eval-w.graphics.s24', 'eval-w', 'openai', '/v1/chat/completions']
    ])
    const { project, clip } = projectForTranscript(LONG)
    const menus = graphicsMenuFor(project, clip, LONG)
    expect(menus.map((m) => m.sentences.length)).toEqual([24, 6])
    menus.forEach((menu, i) => {
      const { system, user } = graphicsPrompt(menu, menu.language)
      expect(requests[i].body).toEqual(openaiRequestBody({ system, user, schema: graphicsSchema(menu), maxTokens: maxTokensForGraphics(menu), think: false }, [], 'test-model'))
    })
    expect(credentialsIn(JSON.stringify(requests, null, 2))).toEqual([])
  })

  it('builds the Ollama body on the Ollama shape', async () => {
    const [r] = await graphicsRequestsFor({ id: 'eval-a', transcript: A }, { provider: 'ollama', model: 'gemma4:e2b' })
    const { project, clip } = projectForTranscript(A)
    const [menu] = graphicsMenuFor(project, clip, A)
    const { system, user } = graphicsPrompt(menu, menu.language)
    expect([r.path, r.body]).toEqual(['/api/chat', ollamaRequestBody({ system, user, schema: graphicsSchema(menu), maxTokens: maxTokensForGraphics(menu), think: false }, [], 'gemma4:e2b')])
  })
})

describe('credentialsIn: what no request or result file may hold', () => {
  it('finds a key, a header and a credentialed URL, and nothing in a clean body', () => {
    expect(credentialsIn(JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'Then we grew to 70 percent.' }] }))).toEqual([])
    expect(credentialsIn('{"apiKey": "x"}')).toEqual(['an api key field'])
    expect(credentialsIn('{"headers": {"Authorization": "Bearer abcdefghijklmnop"}}')).toEqual(['an authorization field', 'a headers field', 'a bearer token'])
    expect(credentialsIn('{"server": "https://user:secret@example.com/v1"}')).toEqual(['a credentialed URL'])
    expect(credentialsIn('{"x": "sk-abcdefghijklmnop1234"}')).toEqual(['an sk- key'])
  })

  it('finds none in a scored run’s results', async () => {
    expect(credentialsIn(JSON.stringify(await scoredAB(), null, 2))).toEqual([])
  })
})

describe('STEP=score: each saved answer settled as the app settles it', () => {
  it('reads the answers, asks the retry of a prose answer as askStructured does, and scores the baseline alone beside it', async () => {
    const [a, b] = await scoredAB()
    expect(a.model.map((w) => [w.id, w.first, w.last, w.answered, w.parsed, w.prose, w.baseline])).toEqual([['eval-a.graphics.s00', 's00', 's04', true, true, false, false]])
    expect(a.model[0].kept.map((k) => [k.sentence, k.template, k.strings, k.source])).toEqual([
      ['s00', 'counter', ['40', 'clients'], 'model'],
      ['s01', 'ring', ['70%', 'market'], 'model']
    ])
    expect(b.model.map((w) => [w.answered, w.parsed, w.prose, w.baseline, w.ms])).toEqual([[true, true, true, false, 2000]])
    expect(b.model[0].notes).toEqual(['the first answer was not JSON (The model returned no JSON object) — asked again for the JSON object only'])
    expect(b.model[0].kept.map((k) => [k.sentence, k.template, k.data])).toEqual([['s02', 'keyword', { template: 'keyword', words: 'simple and calm', lit: 2 }]])
    // The baseline alone: no model asked.
    expect(a.baseline.map((w) => [w.answered, w.baseline, w.rejected])).toEqual([[false, true, BASELINE_ONLY]])
    expect(a.baseline[0].kept.map((k) => [k.sentence, k.template, k.strings, k.source])).toEqual([
      ['s01', 'ring', ['70 percent', 'local'], 'baseline'],
      ['s04', 'counter', ['$1,200', 'full'], 'baseline']
    ])
    expect(b.baseline[0].kept).toEqual([])
    expect(a.sentences.map((s) => s.id)).toEqual(['s00', 's01', 's02', 's03', 's04'])
  })

  it('returns a prose answer’s retry, nudged as the app nudges it, until its answer is saved', async () => {
    const r = await scoreGraphicsFixture(FIXTURE_B, CONFIG, from({ 'eval-b.graphics.s00': RESPONSES['eval-b.graphics.s00'] }))
    expect(r.pending.map((p) => [p.id, p.path])).toEqual([['eval-b.graphics.s00.retry', '/v1/chat/completions']])
    const messages = (r.pending[0].body as { messages: { content: string }[] }).messages
    expect(messages[1].content.endsWith(`\n${JSON_ONLY_NUDGE}`)).toBe(true)
    expect(r.result.model.map((w) => [w.prose, w.retryPending, w.parsed, w.baseline])).toEqual([[true, true, false, true]])
  })

  it('marks an answer cut off, the wrong shape, and no answer at all', async () => {
    const cut = await scoreGraphicsFixture(FIXTURE_A, CONFIG, from({ 'eval-a.graphics.s00': saved('eval-a.graphics.s00', JSON.stringify(ANSWER_A), 'length') }))
    expect(cut.result.model.map((w) => [w.parsed, w.truncated, w.wrongShape, w.prose, w.baseline])).toEqual([[true, true, false, false, true]])
    const shape = await scoreGraphicsFixture(FIXTURE_A, CONFIG, from({ 'eval-a.graphics.s00': saved('eval-a.graphics.s00', '{"graphics": []}') }))
    expect(shape.result.model.map((w) => [w.parsed, w.truncated, w.wrongShape, w.baseline])).toEqual([[true, false, true, true]])
    const none = await scoreGraphicsFixture(FIXTURE_A, CONFIG, from({}))
    expect(none.result.model.map((w) => [w.answered, w.parsed, w.baseline, w.rejected])).toEqual([[false, false, true, 'no saved answer for eval-a.graphics.s00']])
    const figures = graphicsFigures([cut.result, shape.result, none.result], 'model')
    expect([figures.windows, figures.answered, figures.parsed, figures.truncated, figures.wrongShape, figures.prose, figures.fellBack]).toEqual([3, 2, 2, 1, 1, 0, 3])
    // A window settled by the baseline is not the model's: nothing proposed.
    expect([figures.proposed, figures.truthHits]).toEqual([0, 0])
  })
})

describe('the figures of "Recorded per run" (§6.10)', () => {
  it('counts the model’s side by hand', async () => {
    const f = graphicsFigures(await scoredAB(), 'model')
    expect([f.fixtures, f.windows, f.answered, f.parsed, f.truncated, f.wrongShape, f.prose, f.retryPending, f.fellBack]).toEqual([2, 2, 2, 2, 0, 0, 1, 0, 0])
    // Proposed: A's four (two kept, two dropped) and B's keyword.
    expect([f.proposed, f.kept, f.dropped, f.droppedByValidator]).toEqual([5, 3, 2, 2])
    expect(f.proposedByTemplate).toEqual({ counter: 2, ring: 2, keyword: 1 })
    expect(f.keptByTemplate).toEqual({ counter: 1, ring: 1, keyword: 1 })
    expect(f.droppedByReason).toEqual({ 'not-said': 1, negated: 1 })
    expect([f.droppedShare, f.validatorShare]).toEqual([2 / 5, 2 / 5])
    // The key number: the '90 weddings' counter, said nowhere. The negated ring is not a hallucination.
    expect([f.hallucinations, f.hallucinationRate]).toEqual([1, 1 / 5])
    expect(f.litRepairs).toBe(1)
    // B's keyword sits on its trap sentence s02.
    expect([f.trapsKept, f.teluguTrapsKept]).toEqual([1, 0])
    // A: s00 counter hit, s02 ring hit (the ring on s01), s04 counter miss, s02 counter miss (two away); B: s01 keyword hit (on s02).
    expect([f.truths, f.truthHits, f.truthHitRate, f.fixturesHit, f.fixturesWithTruth]).toEqual([5, 3, 3 / 5, 2, 2])
    expect(f.numberAsWord).toEqual({ hi: 0, te: 0 })
  })

  it('counts the baseline’s side by hand, over the same fixtures (model against baseline)', async () => {
    const f = graphicsFigures(await scoredAB(), 'baseline')
    // A: a ring on s01 (70 percent), a counter on s04 ($1,200), a ring on s03 dropped as negated; no keyword (every sentence over 8 words). B: none.
    expect([f.windows, f.answered, f.prose, f.proposed, f.kept, f.dropped]).toEqual([2, 0, 0, 3, 2, 1])
    expect(f.droppedByReason).toEqual({ negated: 1 })
    expect([f.hallucinations, f.hallucinationRate, f.litRepairs, f.trapsKept]).toEqual([0, 0, 0, 0])
    // A: s02 ring hit (s01), s04 counter hit; s00 and the s02 counter missed. B: missed.
    expect([f.truths, f.truthHits, f.truthHitRate, f.fixturesHit]).toEqual([5, 2, 2 / 5, 1])
  })

  it('counts a Hindi graphic dropped for a number said as a word, and only when its stretch says no digit', async () => {
    // specs.json's quote-hi says "एक" (one) as a word; the counter-hi row (value then label) says ₹500 in digits.
    const specs = JSON.parse(readFileSync(join(GRAPHICS_FIXTURE_DIR, 'specs.json'), 'utf8')).specs as { id: string; spec: { data: Record<string, string> } }[]
    const data = (id: string): Record<string, string> => specs.find((s) => s.id === id)!.spec.data
    const quote = data('quote-hi').text
    const answer = { reasoning: '', graphics: [g({ sentence: 's00', template: 'counter', value: '1', label: 'कहानी' })] }
    const alone = talk([quote], { language: 'hi', assetId: 'H1' })
    const beside = talk([quote, `${data('counter-hi').value} ${data('counter-hi').label}`], { language: 'hi', assetId: 'H2' })
    const run = async (id: string, t: Transcript): Promise<GraphicsFixtureResult> =>
      (await scoreGraphicsFixture({ set: 'eval', id, language: 'hi', transcript: t, truth: [], traps: [] }, CONFIG, from({ [`${id}.graphics.s00`]: saved(`${id}.graphics.s00`, JSON.stringify(answer)) }))).result
    const h1 = await run('eval-h1', alone)
    const h2 = await run('eval-h2', beside)
    expect([h1, h2].map((r) => r.model[0].drops.map((d) => dropReasonOf(d.reason)))).toEqual([['not-said'], ['not-said']])
    expect(graphicsFigures([h1], 'model').numberAsWord).toEqual({ hi: 1, te: 0 })
    expect(graphicsFigures([h2], 'model').numberAsWord).toEqual({ hi: 0, te: 0 })
    expect(graphicsFigures([h1, h2], 'baseline').numberAsWord).toEqual({ hi: 0, te: 0 })
  })

  it('counts a Telugu graphic kept on a trap sentence (the negative endings missed, at most)', async () => {
    const words = (JSON.parse(readFileSync(join(GRAPHICS_FIXTURE_DIR, 'specs.json'), 'utf8')).specs as { id: string; spec: { data: Record<string, string> } }[]).find((s) => s.id === 'keyword-te')!.spec.data.words
    const t = talk([words], { language: 'te', assetId: 'T' })
    const answer = { reasoning: '', graphics: [g({ sentence: 's00', template: 'keyword', words, lit: 1 })] }
    const r = (await scoreGraphicsFixture({ set: 'eval', id: 'eval-t', language: 'te', transcript: t, truth: [], traps: ['s00'] }, CONFIG, from({ 'eval-t.graphics.s00': saved('eval-t.graphics.s00', JSON.stringify(answer)) }))).result
    expect(r.model[0].kept.map((k) => k.template)).toEqual(['keyword'])
    const f = graphicsFigures([r], 'model')
    expect([f.trapsKept, f.teluguTrapsKept]).toEqual([1, 1])
  })

  it('scores the nested set exactly: English passes or fails, a Hindi or Telugu talk is recorded', async () => {
    const t = talk(['Three steps today: first, the light; second, the lens; third, the frame.'], { assetId: 'N' })
    const answer = { reasoning: '', graphics: [g({ sentence: 's00', template: 'steps', title: 'Three steps today', items: [{ label: 'light', value: '' }, { label: 'lens', value: '' }, { label: 'frame', value: '' }] })] }
    const nested = (id: string, language: string, parents: number[]): GraphicsEvalInput => ({ set: 'nested', id, language, transcript: { ...t, language }, title: 'Three steps today.', items: ['Light', 'lens', 'frame'], parents })
    const score = async (input: GraphicsEvalInput): Promise<GraphicsFixtureResult> =>
      (await scoreGraphicsFixture(input, CONFIG, from({ [`${input.id}.graphics.s00`]: saved(`${input.id}.graphics.s00`, JSON.stringify(answer)) }))).result
    const right = await score(nested('nested-a', 'en', [-1, -1, -1]))
    const wrong = await score(nested('nested-b', 'en', [-1, 0, 0]))
    const model = graphicsFigures([right, wrong], 'model').nested
    expect(model.map((n) => [n.fixtureId, n.steps, n.title, n.items, n.parents, n.exact, n.bar])).toEqual([
      ['nested-a', 1, true, true, true, true, 'pass'],
      ['nested-b', 1, true, true, false, false, 'fail']
    ])
    // The baseline finds no steps here (no sentence opens with an ordinal): no match, so English fails.
    expect(graphicsFigures([right], 'baseline').nested.map((n) => [n.steps, n.exact, n.bar])).toEqual([[0, false, 'fail']])
    // Only the bar's reading changes outside English.
    const notEnglish: GraphicsFixtureResult = { ...right, fixtureId: 'nested-c', language: 'te' }
    expect(graphicsFigures([notEnglish], 'model').nested.map((n) => [n.exact, n.bar])).toEqual([[true, 'recorded']])
  })

  it('classes every drop reason it names from the messages as the code writes them', () => {
    const t = talk([
      'We spent 40 dollars on flowers for the whole hall.',
      'We had 40 clients and 12 staff all year long.',
      'Pick the light, then the lens, then the frame for it.'
    ])
    const { project, clip } = projectForTranscript(t)
    const [menu] = graphicsMenuFor(project, clip, t)
    const reasonOf = (...graphics: Record<string, unknown>[]): string[] =>
      settleGraphics({ value: { reasoning: '', graphics }, truncated: false }, menu, t).drops.map((d) => dropReasonOf(d.reason))
    expect(reasonOf(g({ sentence: 's00', template: 'ring', value: '40%', label: 'flowers' }))).toEqual(['other-unit'])
    expect(reasonOf(g({ sentence: 's01', template: 'ring', value: '40', label: 'clients' }))).toEqual(['not-a-percentage'])
    expect(reasonOf(g({ sentence: 's01', template: 'counter', value: '12', label: 'clients' }))).toEqual(['unpaired'])
    expect(reasonOf(g({ sentence: 's01', template: 'counter', value: 'many', label: 'clients' }))).toEqual(['not-a-number'])
    expect(reasonOf(g({ sentence: 's00', template: 'callout', label: 'flowers' }))).toEqual(['not-offered'])
    expect(reasonOf(g({ sentence: 's09', template: 'counter', value: '40', label: 'flowers' }))).toEqual(['not-on-menu'])
    expect(reasonOf(g({ sentence: 's00', template: 'keyword', words: 'flowers '.repeat(8).trim() }))).toEqual(['too-long'])
    expect(reasonOf(g({ sentence: 's00', template: 'keyword', words: 'on flowers for the whole' }))).toEqual(['template-rule'])
    expect(reasonOf(g({ sentence: 's02', template: 'steps', title: 'Step by step', items: [{ label: 'the', value: '' }, { label: 'lens', value: '' }] }))).toEqual(['ungrounded'])
    expect(reasonOf(g({ sentence: 's02', template: 'steps', title: 'Step by step', items: [{ label: 'light', value: '' }, { label: 'lens?', value: '' }] }))).toEqual(['ungrounded'])
    expect(reasonOf(g({ sentence: 's00', template: 'counter', value: '90', label: 'flowers' }))).toEqual(['not-said'])
    expect(reasonOf(g({ sentence: 's00', template: 'keyword', words: 'flowers' }), g({ sentence: 's00', template: 'keyword', words: 'hall' }))).toEqual(['spacing'])
    expect(dropReasonOf('something new')).toBe('other')
    expect([...HALLUCINATION_REASONS]).toEqual(['not-said', 'ungrounded', 'other-unit'])
  })
})

describe('the report and the blind rating with a graphics run (§6.10)', () => {
  const spineRun = {
    run: 'r1',
    model: 'm',
    provider: 'openai',
    think: false,
    transport: 'relay',
    media: 'synthetic',
    catalogue: { builtIn: 1, library: 0 },
    results: [{ fixtureId: 'b0', language: 'English', verdict: 'used', ms: 1500, promptTokens: 800, outputTokens: 400, problems: [], reasoning: 'r', headlines: [{ role: 'hook', text: 'Hi', chars: 2, capacity: 9, fits: true }] }]
  }

  it('keeps a report with no graphics run byte for byte as it was', () => {
    // Written by hand from buildReport's lines before the pass filter (scripts/eval-report.mjs at 530c3b6).
    const expected = [
      '# The Director, measured',
      '',
      '> Generated by `npm run eval:report` from `eval/runs/*.json` — do not edit by hand.',
      '> What the plan is (`docs/PLAN.md` §3) and how to run it are there; what was concluded is',
      '> `eval/findings.md`, included below.',
      '',
      'F.',
      '',
      '## Runs',
      '',
      '| run | model | think | transport | landed | used · repaired · rejected · error | median s | median tokens in/out | headlines that fit | copy (model / standard) | preferred to standard | C0 bar |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|',
      '| r1 | m | off | relay | 1/1 | 1 · 0 · 0 · 0 | 1.5 | 800 / 400 | 1/1 | — / — (0 rated) | — | not rated |',
      '',
      '## r1',
      '',
      'openai · `m` · think off · relay · media synthetic · transitions 1 built-in + 0 library',
      '',
      '| brief | lang | verdict | s | tokens in/out | headlines (fit/written) | notes | reasoning |',
      '|---|---|---|---|---|---|---|---|',
      '| b0 | English | used | 1.5 | 800 / 400 | 1/1 |  | r |',
      '',
      '<details><summary>Every headline</summary>',
      '',
      '| brief | role | headline | chars / fit in the shot |',
      '|---|---|---|---|',
      '| b0 | hook | Hi | 2 / 9 |',
      '',
      '</details>',
      '',
      ''
    ].join('\n')
    expect(buildReport([spineRun], 'F.')).toBe(expected)
  })

  it('never reads a graphics run as a spine row, and prints its figures in its own section', async () => {
    const results = await scoredAB()
    const figures = { model: graphicsFigures(results, 'model'), baseline: graphicsFigures(results, 'baseline') }
    const graphicsRun = { run: 'g1', pass: 'graphics@1', provider: 'openai', model: 'm', transport: 'relay', figures, results, ratings: { 'eval-a': { fit: 4, baselineFit: 2 }, 'eval-b': { fit: 2, baselineFit: 1 } } }
    // summarise's pass filter: a graphics result is no brief of the spine's.
    expect(summarise(graphicsRun).briefs).toBe(0)
    expect(summarise(graphicsRun, { pass: 'graphics@1' }).briefs).toBe(2)
    expect(summarise({ ...spineRun, results: [...spineRun.results, ...results] }).briefs).toBe(1)
    const both = buildReport([spineRun, graphicsRun], 'F.')
    const spineOnly = buildReport([spineRun], 'F.')
    expect(both.startsWith(spineOnly.slice(0, -1))).toBe(true)
    expect(both).not.toContain('| g1 |')
    const section = both.slice(spineOnly.length - 1).split('\n')
    expect(section).toContain('## Graphics runs')
    expect(section).toContain('### g1')
    expect(section).toContain('| prose came back (asked again) · retries not yet asked | 1 · 0 | — |')
    expect(section).toContain('| proposed, by template | counter 2 · ring 2 · keyword 1 | ring 2 · counter 1 |')
    expect(section).toContain('| dropped, by reason | not-said 1 · negated 1 | negated 1 |')
    expect(section).toContain('| **hallucination rate** | **1/5 (20%)** | **0/3 (0%)** |')
    expect(section).toContain('| lit repairs | 1 | 0 |')
    expect(section).toContain('| truth hits (±1 sentence) | 3/5 (60%) · 2 of 2 fixtures | 2/5 (40%) · 1 of 2 fixtures |')
    expect(section).toContain('| template fit, blind 1–5 | 3.0 (1 of 2 rated ≥ 3) | 1.5 |')
  })

  it('shows each side’s kept graphics for the blind template-fit rating, and puts each rating back on its side', async () => {
    const [a] = await scoredAB()
    expect(graphicLinesOf(a.model, 'model')).toEqual([
      '  s00 "We signed 40 clients over the whole of this year." → counter: 40 · clients',
      '  s01 "Then we grew to 70 percent of the local market share." → ring: 70% · market'
    ])
    expect(graphicLinesOf(a.baseline, 'baseline')).toEqual([
      '  s01 "Then we grew to 70 percent of the local market share." → ring: 70 percent · local',
      '  s04 "The album costs $1,200 for the full day of the wedding." → counter: $1,200 · full'
    ])
    // A window the baseline settled is not shown as the model's.
    expect(graphicLinesOf([{ ...a.model[0], baseline: true }], 'model')).toEqual([])
    expect(graphicsRating(true, 4, 2)).toEqual({ fit: 4, baselineFit: 2 })
    expect(graphicsRating(false, 4, 2)).toEqual({ fit: 2, baselineFit: 4 })
  })
})
