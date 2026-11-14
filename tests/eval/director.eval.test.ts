import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { TRANSITIONS } from '@shared/transitions/registry'
import { loadFixtures } from './fixtures'
import { makeFixtureMedia } from './media'
import { REPO, librarySounds, libraryTransitions, sidecarBeats } from './local'
import {
  askNode,
  prepareFixture,
  readJson,
  requestFor,
  scoreFixture,
  writeJson,
  type EvalConfig,
  type EvalRequest,
  type EvalResponse,
  type Prepared,
  type RunRecord
} from './pipeline'
import { EVAL_ROOT } from './relay'
import { recipeById, type RecipeId } from '@shared/director/recipes'

/**
 * `npm run eval` — the Director measured on a real model (docs/PLAN.md §3).
 *
 * Skipped unless FORGE_EVAL names a provider, so `npm test` never waits on a
 * model. The environment:
 *
 *   FORGE_EVAL          openai | ollama        (the API shape; LM Studio is openai)
 *   FORGE_EVAL_MODEL    e.g. google/gemma-4-e2b, gemma4:e2b
 *   FORGE_EVAL_THINK    on | off               (Ollama only; default off)
 *   FORGE_EVAL_SERVER   default http://127.0.0.1:1234 (openai) or :11434 (ollama)
 *   FORGE_EVAL_RUN      the run's name; default a timestamp
 *   FORGE_EVAL_STEP     prepare | score | all  (default all)
 *   FORGE_EVAL_ONLY     comma-separated fixture ids
 *   FORGE_EVAL_MEDIA    a folder of real photos, <fixture-id>/<name>
 *   FORGE_EVAL_RENDER   off to skip the renders
 *   FORGE_EVAL_RECIPE   a recipe id to pin, as the panel's Recipe picker does (default: the model chooses)
 *
 * `all` asks from node. Where node cannot reach the model — the development
 * sandbox — run `prepare`, then `window.__forgeEvalRelay('<run>')` in the
 * harness page (it posts each prepared body through the harness server), then
 * `score`. Both routes send the same bytes: the bodies are built by the app's
 * own `openaiRequestBody` / `ollamaRequestBody`.
 */

const PROVIDER = process.env.FORGE_EVAL as EvalConfig['provider'] | undefined
const STEP = (process.env.FORGE_EVAL_STEP ?? 'all') as 'prepare' | 'score' | 'all'

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

describe.skipIf(!PROVIDER)('the Director on a real model', () => {
  it(
    'prepares, asks and scores every brief',
    async () => {
      const config: EvalConfig = {
        provider: PROVIDER!,
        model: process.env.FORGE_EVAL_MODEL ?? '',
        think: process.env.FORGE_EVAL_THINK === 'on'
      }
      expect(config.model, 'FORGE_EVAL_MODEL names the model').not.toBe('')
      const server =
        process.env.FORGE_EVAL_SERVER ?? (config.provider === 'openai' ? 'http://127.0.0.1:1234' : 'http://127.0.0.1:11434')
      const runId = process.env.FORGE_EVAL_RUN ?? `${stamp()}-${config.provider}-${config.model.replace(/[^a-z0-9.-]+/gi, '_')}-${config.think ? 'think' : 'nothink'}`
      const runDir = join(EVAL_ROOT, runId)
      const only = new Set((process.env.FORGE_EVAL_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean))
      const fixtures = (await loadFixtures()).filter((f) => only.size === 0 || only.has(f.id))
      const library = await libraryTransitions()
      const transitions = [...TRANSITIONS, ...library.transitions]
      const pinned = (process.env.FORGE_EVAL_RECIPE ?? '') || null
      expect(pinned === null || recipeById(pinned) !== null, `FORGE_EVAL_RECIPE ${pinned} is not a recipe`).toBe(true)

      /* prepare */
      if (STEP === 'prepare' || STEP === 'all') {
        const beats = await sidecarBeats()
        try {
          const requests: EvalRequest[] = []
          for (const fixture of fixtures) {
            const made = await makeFixtureMedia(fixture, join(EVAL_ROOT, 'media', fixture.id))
            const prepared = await prepareFixture(fixture, made, { analyseBeats: beats.analyse, transitions, pinned: pinned as RecipeId | null })
            if (beats.note && !prepared.beatsNote) prepared.beatsNote = beats.note
            await writeJson(join(runDir, 'prepared', `${fixture.id}.json`), prepared)
            requests.push(requestFor(prepared, config))
          }
          await writeJson(join(runDir, 'requests.json'), requests)
          await writeJson(join(runDir, 'config.json'), { ...config, server, runId })
        } finally {
          beats.stop()
        }
      }

      /* ask, from node */
      if (STEP === 'all') {
        const requests = (await readJson<EvalRequest[]>(join(runDir, 'requests.json'))) ?? []
        for (const request of requests) {
          const file = join(runDir, 'responses', `${request.id}.json`)
          if (existsSync(file)) continue
          await writeJson(file, await askNode(request, server))
        }
      }

      /* score */
      if (STEP === 'score' || STEP === 'all') {
        const requests = (await readJson<EvalRequest[]>(join(runDir, 'requests.json'))) ?? []
        const results = []
        const byId = new Map(fixtures.map((f) => [f.id, f]))
        const sounds = await librarySounds()
        let real = false
        for (const request of requests) {
          const fixture = byId.get(request.fixtureId)
          if (!fixture) continue
          const prepared = await readJson<Prepared>(join(runDir, 'prepared', `${fixture.id}.json`))
          if (!prepared) throw new Error(`${fixture.id} was never prepared in ${runId}`)
          real ||= prepared.realMedia.length > 0
          const response = await readJson<EvalResponse>(join(runDir, 'responses', `${request.id}.json`))
          const result = await scoreFixture(fixture, prepared, request, response, {
            model: config.model,
            render:
              process.env.FORGE_EVAL_RENDER === 'off'
                ? null
                : { dir: join(runDir, 'renders'), extraTransitions: library.transitions, resolveAsset: library.resolveAsset, sounds }
          })
          results.push({
            ...result,
            renders: {
              model: result.renders.model && relative(REPO, result.renders.model),
              baseline: result.renders.baseline && relative(REPO, result.renders.baseline)
            }
          })
        }
        const record: RunRecord = {
          run: runId,
          stamp: new Date().toISOString(),
          provider: config.provider,
          model: config.model,
          think: config.think,
          server,
          transport: STEP === 'all' ? 'node' : 'relay',
          catalogue: { builtIn: TRANSITIONS.length, library: library.transitions.length },
          media: real ? 'mixed' : 'synthetic',
          results
        }
        await writeJson(join(runDir, 'results.json'), record)
        await writeJson(join(REPO, 'eval', 'runs', `${runId}.json`), record)
        await writeFile(
          join(runDir, 'README.md'),
          [
            `# ${runId}`,
            '',
            `${config.provider} · ${config.model} · think ${config.think ? 'on' : 'off'} · ${record.transport}`,
            '',
            'renders/<brief>.model.mp4 is the model\'s ad; <brief>.baseline.mp4 the standard cut from the same menu.',
            'Each is a spine@2 ad, timed by the rhythm engine: the black, the end card\'s ground and the recipe\'s look',
            'are drawn. The headline cards are drawn by the renderer in the app, so they are not in these renders — the',
            'headlines are in results.json, and `npm run eval:rate` shows them.',
            ''
          ].join('\n')
        )
        const counts = results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }), {})
        console.log(`${runId}: ${JSON.stringify(counts)}`)
        expect(results.length).toBe(requests.length)
      }
    },
    3_600_000
  )
})

/**
 * `FORGE_EVAL_LOOKS=<folder> npm run eval` — the look pass (docs/PLAN.md §4.1)
 * on every picture in a folder, one image a call, built with the app's own
 * `encodeImages`, `lookPrompt`, `lookSchema` and request body. STEP=prepare
 * writes the requests (ask them with the relay), STEP=score reads the answers
 * into results-looks.json. The VLM half of C0: time and tokens per picture,
 * and — with a person's ground truth beside it — whether the eyes see.
 */
const LOOKS = process.env.FORGE_EVAL_LOOKS
describe.skipIf(!PROVIDER || !LOOKS)('the look pass on a real model', () => {
  it(
    'prepares or scores one look per picture',
    async () => {
      const { readdir } = await import('node:fs/promises')
      const { encodeImages } = await import('../../src/main/director')
      const { lookPrompt, lookSchema, readLook, LOOK_MAX_TOKENS } = await import('@shared/director/look')
      const { openaiRequestBody, ollamaRequestBody, openaiAnswer, ollamaAnswer, parseModelJson } = await import('@shared/director/provider')
      const runId = process.env.FORGE_EVAL_RUN ?? `looks-${stamp()}`
      const runDir = join(EVAL_ROOT, runId)
      const openai = PROVIDER === 'openai'
      const model = process.env.FORGE_EVAL_MODEL ?? ''
      const files = (await readdir(LOOKS!)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort()

      if (STEP === 'prepare' || STEP === 'all') {
        const { system, user } = lookPrompt({ product: process.env.FORGE_EVAL_PRODUCT ?? 'a wedding film', language: 'English' })
        const requests: EvalRequest[] = []
        for (const f of files) {
          const images = await encodeImages([join(LOOKS!, f)])
          const request = { system, user, schema: lookSchema(), maxTokens: LOOK_MAX_TOKENS, think: false }
          requests.push({
            id: `look.${f}`,
            fixtureId: f,
            provider: PROVIDER!,
            path: openai ? '/v1/chat/completions' : '/api/chat',
            body: openai ? openaiRequestBody(request, images, model) : ollamaRequestBody(request, images, model)
          })
        }
        await writeJson(join(runDir, 'requests.json'), requests)
      }
      if (STEP === 'score' || STEP === 'all') {
        const requests = (await readJson<EvalRequest[]>(join(runDir, 'requests.json'))) ?? []
        const results = []
        for (const r of requests) {
          const response = await readJson<EvalResponse>(join(runDir, 'responses', `${r.id}.json`))
          let look = null
          let why: string | null = null
          let tokens: [number | null, number | null] = [null, null]
          try {
            if (!response || response.status !== 200) throw new Error(response?.error ?? `status ${response?.status}`)
            const answer = openai ? openaiAnswer(response.data) : ollamaAnswer(response.data)
            tokens = [answer.promptTokens, answer.outputTokens]
            const parsed = parseModelJson(answer.text)
            look = 'error' in parsed ? null : readLook(parsed.value)
            if (!look) why = 'error' in parsed ? parsed.error : 'not a look'
          } catch (err) {
            why = err instanceof Error ? err.message : String(err)
          }
          results.push({ picture: r.fixtureId, ms: response?.ms ?? 0, promptTokens: tokens[0], outputTokens: tokens[1], look, why })
        }
        await writeJson(join(runDir, 'results-looks.json'), { run: runId, model, results })
        console.log(JSON.stringify(results, null, 1))
      }
    },
    3_600_000
  )
})

/**
 * `FORGE_EVAL_GRAPHICS=<folder> npm run eval -- -t "the graphics pass"` — the
 * graphics pass (docs/CLIPS.md §6.10) on every `eval-*.json` and
 * `nested-*.json` in a folder (tests/fixtures/graphics), one request per
 * menu window, built by the app's own loop (`runGraphicsPass`, with
 * `graphicsMenuFor`, `graphicsPrompt`, `graphicsSchema`,
 * `maxTokensForGraphics` and `askStructured`; tests/eval/graphicsEval.ts).
 * STEP=prepare writes the requests (ask them with the relay, as the look
 * pass's), STEP=score settles each saved answer through `settleGraphics`, with
 * `baselineGraphics` for a window it cannot use and again alone for "model
 * against baseline", into results-graphics.json in the run's folder and the
 * run's record in eval/runs/. An answer that came back as prose adds its
 * retry (askStructured's second ask) to requests.json: relay again, score
 * again. FORGE_EVAL_THINK is not read: askStructured sets thinking as the app
 * does. Registered only when both FORGE_EVAL and FORGE_EVAL_GRAPHICS are set,
 * so the normal suite's counts for this file do not change.
 */
const GRAPHICS = process.env.FORGE_EVAL_GRAPHICS
if (PROVIDER && GRAPHICS) {
  describe('the graphics pass on a real model', () => {
    it(
      'prepares or scores one request per window of each fixture',
      async () => {
        const { resolve } = await import('node:path')
        const { readFileSync } = await import('node:fs')
        const { GRAPHICS_PASS } = await import('@shared/director/schemaGraphics')
        const { loadGraphicsFixtures, noEvalFixturesLine } = await import('./graphicsFixtures')
        const { credentialsIn, graphicsFigures, graphicsRequestsFor, graphicsScoreRefusal, scoreGraphicsFixture, withRatingsOf } = await import('./graphicsEval')
        const folder = resolve(GRAPHICS!)
        const config = { provider: PROVIDER!, model: process.env.FORGE_EVAL_MODEL ?? '' }
        expect(config.model, 'FORGE_EVAL_MODEL names the model').not.toBe('')
        const server =
          process.env.FORGE_EVAL_SERVER ?? (config.provider === 'openai' ? 'http://127.0.0.1:1234' : 'http://127.0.0.1:11434')
        const runId = process.env.FORGE_EVAL_RUN ?? `graphics-${stamp()}`
        const runDir = join(EVAL_ROOT, runId)
        const fixtures = loadGraphicsFixtures(folder)
        if (fixtures.eval.length === 0) {
          console.log(noEvalFixturesLine(folder))
          return
        }
        const inputs = [
          ...fixtures.eval.map((f) => ({ ...f, set: 'eval' as const })),
          ...fixtures.nested.map((f) => ({ ...f, set: 'nested' as const }))
        ]
        const clean = async (path: string): Promise<void> => {
          const { readFile } = await import('node:fs/promises')
          expect(credentialsIn(await readFile(path, 'utf8')), `${path} holds no key, header or credentialed URL`).toEqual([])
        }
        expect(credentialsIn(JSON.stringify(server)), 'FORGE_EVAL_SERVER carries no credentials').toEqual([])

        if (STEP === 'prepare' || STEP === 'all') {
          const requests: EvalRequest[] = []
          for (const f of inputs) requests.push(...(await graphicsRequestsFor(f, config)))
          await writeJson(join(runDir, 'requests.json'), requests)
          await clean(join(runDir, 'requests.json'))
          console.log(`${runId}: ${requests.length} graphics requests for ${inputs.length} fixtures`)
        }

        const score = async (): Promise<EvalRequest[]> => {
          const responseFor = (id: string): EvalResponse | null => {
            const file = join(runDir, 'responses', `${id}.json`)
            if (!existsSync(file)) return null
            return JSON.parse(readFileSync(file, 'utf8')) as EvalResponse
          }
          // Refuse before writing anything: an unprepared run, another pass's run, or one the relay has not answered.
          const prepared = await readJson<EvalRequest[]>(join(runDir, 'requests.json'))
          const refusal = graphicsScoreRefusal(runId, prepared, (id) => existsSync(join(runDir, 'responses', `${id}.json`)))
          if (refusal !== null) throw new Error(refusal)
          const asked = new Set(prepared!.map((r) => r.fixtureId))
          const results = []
          const pending: EvalRequest[] = []
          for (const f of inputs.filter((i) => asked.has(i.id))) {
            const scored = await scoreGraphicsFixture(f, config, responseFor)
            results.push(scored.result)
            pending.push(...scored.pending)
          }
          const figures = { model: graphicsFigures(results, 'model'), baseline: graphicsFigures(results, 'baseline') }
          await writeJson(join(runDir, 'results-graphics.json'), { run: runId, model: config.model, figures, results })
          await clean(join(runDir, 'results-graphics.json'))
          const recordPath = join(REPO, 'eval', 'runs', `${runId}.json`)
          const record = withRatingsOf({
            run: runId,
            stamp: new Date().toISOString(),
            pass: GRAPHICS_PASS,
            provider: config.provider,
            model: config.model,
            server,
            transport: STEP === 'all' ? 'node' : 'relay',
            figures,
            results
          }, await readJson<unknown>(recordPath))
          await writeJson(recordPath, record)
          await clean(recordPath)
          if (pending.length > 0) {
            const requests = (await readJson<EvalRequest[]>(join(runDir, 'requests.json'))) ?? []
            const have = new Set(requests.map((r) => r.id))
            await writeJson(join(runDir, 'requests.json'), [...requests, ...pending.filter((p) => !have.has(p.id))])
            await clean(join(runDir, 'requests.json'))
            console.log(`${runId}: ${pending.length} answers came back as prose; their retries are added to requests.json: run the relay again, then score again`)
          }
          const m = figures.model
          console.log(
            `${runId}: ${m.windows} windows, ${m.parsed} parsed, ${m.prose} prose, ${m.proposed} proposed, ${m.dropped} dropped, hallucination ${m.hallucinationRate ?? '—'}, truth hits ${m.truthHits}/${m.truths} (baseline ${figures.baseline.truthHits}/${figures.baseline.truths})`
          )
          return pending
        }

        if (STEP === 'all') {
          for (let round = 0; round < 2; round += 1) {
            const requests = (await readJson<EvalRequest[]>(join(runDir, 'requests.json'))) ?? []
            for (const request of requests) {
              const file = join(runDir, 'responses', `${request.id}.json`)
              if (existsSync(file)) continue
              await writeJson(file, await askNode(request, server))
            }
            if ((await score()).length === 0) break
          }
        } else if (STEP === 'score') {
          await score()
        }
      },
      3_600_000
    )
  })
}
