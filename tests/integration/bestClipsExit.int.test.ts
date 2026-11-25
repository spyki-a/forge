import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LinkRuns, captionsHandler, metaHandler } from '../../src/main/ingest/meta'
import type { IngestTool } from '../../src/main/ingest/download'
import { ensureYtDlp, type YtDlpTool } from '../../src/main/ingest/binary'
import { captionKeys, type LinkHeat, type LinkMeta } from '@shared/ingest/args'
import { bestClips } from '@shared/bestclips/run'
import type { Transcript } from '@shared/transcript'
import { bestClipsRequestsFor, bestClipsScoreRefusal, scoreBestClipsFixture } from '../eval/bestClipsEval'
import type { BestClipsEvalFixture } from '../eval/bestClipsFixtures'
import { credentialsIn } from '../eval/graphicsEval'
import type { EvalRequest, EvalResponse } from '../eval/pipeline'
import { EXIT_LINKS_FILE, exitFileName, exitPage, parseExitLinks, sideOf, type ExitRecord } from '../fixtures/bestClipsExit'
import { OUTPUT_ROOT } from './output'

/*
 * Best clips' exit recorder (docs/CLIPS.md §7.8's first bullet): the owner's
 * ten links (talks and podcasts; two in Hindi or Telugu), each at the length
 * the owner wants, through the app's OWN ingest code with the REAL yt-dlp on
 * the owner's machine — main's `ingest:meta` and `ingest:captions` handlers,
 * exactly as Get transcript calls them (the video's language, or the one the
 * owner names) — then `bestClips` with signals alone, and ONE page to rate:
 * tests/output/bestclips-exit/index.html. Nothing is downloaded but metadata
 * and captions; no media.
 *
 * Opt-in: FORGE_BESTCLIPS_EXIT=1, never under CI (the suite must not depend
 * on YouTube). Every test is skipped otherwise.
 *
 * THE LINKS: tests/output/_session-keep/bestclips-exit-links.txt (gitignored),
 * one link a line, then the length in minutes (1, 2, 3 or 4), then, when the
 * video names no language of its own, its captions' language:
 *
 *     https://www.youtube.com/watch?v=XXXXXXXXXXX 2
 *     https://youtu.be/YYYYYYYYYYY 1 hi
 *
 * A file with any problem stops the run before anything is fetched
 * (tests/fixtures/bestClipsExit.ts `parseExitLinks`).
 *
 * TWO PASSES, as the eval block runs (docs/CLIPS.md §7.4; the relay because
 * the shell cannot reach the model server, MEMORY):
 *   1. FORGE_BESTCLIPS_EXIT_STEP=prepare (the default): fetch, signals' cards,
 *      the page, and the model's requests in tests/output/eval/bestclips-exit/
 *      requests.json, one per link with cards to pick from, built by the eval
 *      block's own `bestClipsRequestsFor` (so each is byte for byte what
 *      Analyse sends), for FORGE_EVAL (openai, the default, or ollama) and
 *      FORGE_EVAL_MODEL (default google/gemma-4-e2b). Then, in the harness page,
 *      `window.__forgeEvalRelay('bestclips-exit')` saves each answer.
 *   2. FORGE_BESTCLIPS_EXIT_STEP=score: no network — each link's saved words
 *      (links/<nn>-<title>.json, from pass 1) asked again through
 *      `scoreBestClipsFixture` with the saved answers, so the model's cards are
 *      settled exactly as Analyse settles them; the page is written again with
 *      the model's cards beside the signals', rated separately. An answer that
 *      came back as prose adds its retry to requests.json: relay again, score
 *      again.
 *
 * WHAT IS WRITTEN (all under tests/output/, gitignored; nothing is committed,
 * no third party's words in the repo): bestclips-exit/index.html (the page),
 * bestclips-exit/summary.json (per link: the status and the cards, both
 * sides), bestclips-exit/links/<nn>-<title>.json (the link's details and
 * words, for pass 2; the name from the title, Windows-safe), bestclips-exit/
 * userData/ (main's caption cache), eval/bestclips-exit/ (requests and, after
 * the relay, responses). Each written JSON is checked to hold no key, header
 * or credentialed URL (`credentialsIn`).
 */

const inCi = !!process.env.CI && process.env.CI !== 'false'
const ENABLED = process.env.FORGE_BESTCLIPS_EXIT === '1' && !inCi
const REASON = inCi ? 'skipped under CI: the suite must not depend on YouTube' : 'needs FORGE_BESTCLIPS_EXIT=1 and the owner’s links file; the owner’s machine'
if (!ENABLED) process.stderr.write(`bestClipsExit.int: every test SKIPPED — ${REASON}\n`)

const STEP = (process.env.FORGE_BESTCLIPS_EXIT_STEP ?? 'prepare') as 'prepare' | 'score'
const LINKS_PATH = join(OUTPUT_ROOT, '_session-keep', EXIT_LINKS_FILE)
const OUT = join(OUTPUT_ROOT, 'bestclips-exit')
const RUN = 'bestclips-exit'
const EVAL_DIR = join(OUTPUT_ROOT, 'eval', RUN)
const CONFIG = { provider: (process.env.FORGE_EVAL ?? 'openai') as 'openai' | 'ollama', model: process.env.FORGE_EVAL_MODEL ?? 'google/gemma-4-e2b' }
const FETCH_MS = 120_000

/** What pass 1 keeps of a link, for pass 2 (no network then). */
interface SavedLink {
  record: ExitRecord
  meta: Pick<LinkMeta, 'title' | 'language' | 'heatmap' | 'channel'> | null
  transcript: Transcript | null
  ytdlp: string
  ranAt: string
}

const fixtureOf = (saved: SavedLink): BestClipsEvalFixture | null =>
  saved.transcript
    ? {
        id: `exit-${String(saved.record.n).padStart(2, '0')}`,
        language: saved.meta?.language ?? saved.record.language ?? '',
        transcript: saved.transcript,
        heatmap: (saved.meta?.heatmap ?? null) as LinkHeat[] | null,
        targetMs: saved.record.targetMs
      }
    : null

async function writeChecked(path: string, value: unknown): Promise<void> {
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 1)}\n`
  expect(credentialsIn(text), `${path} holds no key, header or credentialed URL`).toEqual([])
  await writeFile(path, text)
}

describe.skipIf(!ENABLED)('Best clips’ exit on the owner’s links (docs/CLIPS.md §7.8)', () => {
  it(
    STEP === 'score' ? 'scores the model’s saved answers and writes the page with both sides' : 'fetches each link’s captions, picks the signals’ cards, writes the page and the model’s requests',
    async () => {
      expect(existsSync(LINKS_PATH), `write the links file first: ${LINKS_PATH}, one link a line, then 1, 2, 3 or 4 (minutes), then a language when the video names none`).toBe(true)
      const { links, problems } = parseExitLinks(await readFile(LINKS_PATH, 'utf8'))
      expect(problems, `the links file (${LINKS_PATH})`).toEqual([])
      await mkdir(join(OUT, 'links'), { recursive: true })
      await mkdir(EVAL_DIR, { recursive: true })
      const nameOf = (n: number, title: string | null): string => `${String(n).padStart(2, '0')}-${exitFileName(title ?? '', 'link')}.json`

      if (STEP === 'prepare') {
        // The caption cache is main's (userData/url/<linkKey>/); yt-dlp's own cache under XDG_CACHE_HOME (EFFECTS.md §40).
        process.env.FORGE_TEST_USERDATA = join(OUT, 'userData')
        process.env.XDG_CACHE_HOME = join(OUT, 'userData', 'xdg-cache')
        const tool: YtDlpTool = await ensureYtDlp()
        const ytdlp = tool.version ?? '?'
        const find = async (): Promise<IngestTool> => ({ command: tool.path })
        const runs = new LinkRuns()
        const meta = metaHandler(runs, find, { timeoutMs: FETCH_MS })
        const captions = captionsHandler(runs, find, { timeoutMs: FETCH_MS })
        const ranAt = new Date().toISOString()
        const records: ExitRecord[] = []
        const requests: EvalRequest[] = []
        for (const [i, link] of links.entries()) {
          const record: ExitRecord = { n: i + 1, url: link.url, key: link.key, targetMs: link.targetMs, title: null, language: link.language, status: 'failed', problem: null, signals: null, model: null }
          let details: LinkMeta | null = null
          let transcript: Transcript | null = null
          try {
            // As Get transcript: the details once, then the captions in the language chosen, else the video's own.
            details = await meta({ url: link.url })
            record.title = details.title
            const language = link.language ?? details.language ?? null
            record.language = language
            if (!captionKeys(language)) record.status = details.hasCaptions === false ? 'no-captions' : 'no-language'
            else {
              const fetched = await captions({ url: link.url, language })
              transcript = fetched.transcript && fetched.transcript.words.length > 0 ? fetched.transcript : null
              if (!transcript) record.status = 'no-captions'
              else {
                record.signals = sideOf(await bestClips(transcript, { heatmap: details.heatmap, language: details.language }, link.targetMs))
                record.status = 'cards'
              }
            }
          } catch (err) {
            // The owner's own machine's reason (yt-dlp's line); never a key: none is near this path.
            record.problem = err instanceof Error ? err.message : String(err)
          }
          records.push(record)
          const saved: SavedLink = { record, meta: details ? { title: details.title, language: details.language, heatmap: details.heatmap, channel: details.channel } : null, transcript, ytdlp, ranAt }
          await writeChecked(join(OUT, 'links', nameOf(record.n, record.title)), saved)
          const fixture = fixtureOf(saved)
          if (fixture && record.status === 'cards') requests.push(...(await bestClipsRequestsFor(fixture, CONFIG)))
          console.log(`${record.n}. ${record.status}${record.signals ? `: ${record.signals.cards.length} cards` : ''}${record.problem ? ` (${record.problem.split('\n')[0]})` : ''}`)
        }
        await writeChecked(join(EVAL_DIR, 'requests.json'), requests)
        await writeChecked(join(OUT, 'summary.json'), { ranAt, ytdlp, model: null, records })
        await writeChecked(join(OUT, 'index.html'), exitPage(records, { ranAt, ytdlp, model: null }))
        console.log(
          `bestclips-exit: ${records.length} links, ${records.filter((r) => r.status === 'cards').length} with cards; ${requests.length} model requests in ${join(EVAL_DIR, 'requests.json')}. ` +
            `Open ${join(OUT, 'index.html')}; for the model's cards, relay ('${RUN}') then run again with FORGE_BESTCLIPS_EXIT_STEP=score`
        )
        return
      }

      // Pass 2: the saved words, the saved answers; no network. Refused, as the eval's score is, before any answer is saved.
      const prepared = existsSync(join(EVAL_DIR, 'requests.json')) ? (JSON.parse(readFileSync(join(EVAL_DIR, 'requests.json'), 'utf8')) as EvalRequest[]) : null
      const refusal = bestClipsScoreRefusal(RUN, prepared, (id) => existsSync(join(EVAL_DIR, 'responses', `${id}.json`)))
      expect(refusal, 'the model’s answers, saved by the relay').toBeNull()
      const savedFiles = links.map((_, i) => String(i + 1).padStart(2, '0'))
      const { readdir } = await import('node:fs/promises')
      const names = await readdir(join(OUT, 'links'))
      const records: ExitRecord[] = []
      const pending: EvalRequest[] = []
      let info = { ranAt: '', ytdlp: '' }
      for (const nn of savedFiles) {
        const file = names.find((n) => n.startsWith(`${nn}-`))
        expect(file, `links/${nn}-….json from the first pass`).toBeTruthy()
        const saved = JSON.parse(readFileSync(join(OUT, 'links', file!), 'utf8')) as SavedLink
        info = { ranAt: saved.ranAt, ytdlp: saved.ytdlp }
        const fixture = fixtureOf(saved)
        const record = { ...saved.record }
        if (fixture && record.status === 'cards') {
          const responseFor = (id: string): EvalResponse | null => {
            const path = join(EVAL_DIR, 'responses', `${id}.json`)
            return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as EvalResponse) : null
          }
          const scored = await scoreBestClipsFixture(fixture, CONFIG, responseFor)
          record.model = sideOf({ cards: scored.result.model.cards, note: scored.result.note, modelNote: scored.result.model.modelNote })
          pending.push(...scored.pending)
        }
        records.push(record)
      }
      if (pending.length > 0) {
        const have = new Set(prepared!.map((r) => r.id))
        await writeChecked(join(EVAL_DIR, 'requests.json'), [...prepared!, ...pending.filter((p) => !have.has(p.id))])
        console.log(`bestclips-exit: ${pending.length} answers came back as prose; their retries are in requests.json: relay again, then score again`)
      }
      const model = `${CONFIG.model} (${CONFIG.provider})`
      await writeChecked(join(OUT, 'summary.json'), { ...info, model, records })
      await writeChecked(join(OUT, 'index.html'), exitPage(records, { ...info, model }))
      console.log(`bestclips-exit: the page now holds the model's cards beside the signals': open ${join(OUT, 'index.html')}`)
    },
    30 * 60_000
  )
})
