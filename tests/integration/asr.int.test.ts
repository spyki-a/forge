import { it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { SidecarClient } from '../../src/main/sidecar/client'
import { SIDECAR_METHODS, RPC_ERRORS, type ModelStatus } from '@shared/sidecar/protocol'
import { SPEECH_MODEL_HOST, SPEECH_MODEL_LABEL, speechModelLabel } from '@shared/asr/speechModel'
import { segmentIntoSentences, type Word } from '@shared/transcript'
import { SIDECAR_DIR, VENV_PYTHON, describeWithVenv, launchFor } from './venv'

const MODELS_DIR = process.env.FORGE_MODELS_DIR ?? join(tmpdir(), 'forge-models')
const FIXTURE = join(process.env.TMPDIR ?? tmpdir(), 'asr-check/jfk.flac')

/*
 * The speech model is the snapshot of ONE pinned commit (asr.py MODEL_REVISION,
 * docs/CLIPS.md §3a.4), fetched only by asr.model's press. Whether it is in
 * MODELS_DIR is read here from the cache's own layout, so a machine without it
 * skips the transcription with the reason rather than fetching 486 MB unasked.
 * Seed it once with the press: asr.model {download: true} with FORGE_MODELS_DIR
 * set (docs/CLIPS.md §3a.8 row 35).
 */
const ASR_PY = readFileSync(resolve(SIDECAR_DIR, 'forge_sidecar', 'capabilities', 'asr.py'), 'utf8')
const REVISIONS = [...ASR_PY.matchAll(/^MODEL_REVISION = "([0-9a-f]{40})"$/gm)].map((m) => m[1])
if (REVISIONS.length !== 1) throw new Error(`asr.py names MODEL_REVISION ${REVISIONS.length} times`)
const SNAPSHOT = join(MODELS_DIR, 'models--Systran--faster-whisper-small', 'snapshots', REVISIONS[0])
const MODEL_ON_DISK = ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt'].every((f) => existsSync(join(SNAPSHOT, f)))

interface TranscribeResult {
  language: string
  durationMs: number
  model: string
  words: Word[]
}

/* -------------------------------------------- the press, on an empty folder */

let empty: string
let fresh: SidecarClient

describeWithVenv('asr.model: the speech model’s own press', () => {
  beforeAll(() => {
    // A models folder of the suite's own, empty: nothing in it may appear.
    empty = mkdtempSync(join(tmpdir(), 'forge-asr-empty-'))
    fresh = new SidecarClient({ cwd: SIDECAR_DIR, launch: launchFor(VENV_PYTHON, { modelsDir: empty }), maxRestarts: 0 })
  })

  afterAll(() => {
    fresh?.stop()
    if (empty) rmSync(empty, { recursive: true, force: true })
  })

  it('advertises both methods once faster-whisper is installed', async () => {
    const hello = await fresh.start()
    for (const method of [SIDECAR_METHODS.transcribe, SIDECAR_METHODS.asrModel]) {
      expect(hello.capabilities).toContain(method)
      expect(hello.degraded[method]).toBeUndefined()
    }
  }, 120_000)

  it('answers what the press names, with nothing on disk and nothing fetched', async () => {
    await fresh.start()
    const status = await fresh.request<ModelStatus>(SIDECAR_METHODS.asrModel, {})
    expect(status).toEqual({ present: false, bytes: 486_212_372, label: SPEECH_MODEL_LABEL, host: SPEECH_MODEL_HOST })
    expect(speechModelLabel(status)).toBe('Get the speech model · 464 MB')
    expect(readdirSync(empty)).toEqual([])
  }, 120_000)

  it('transcribe without the model is unavailable, in words, and fetches nothing', async () => {
    await fresh.start()
    const audio = join(SIDECAR_DIR, 'forge_sidecar', '__init__.py') // any file: the model is asked about first
    await expect(fresh.request(SIDECAR_METHODS.transcribe, { path: audio })).rejects.toMatchObject({
      code: RPC_ERRORS.unavailable,
      message: 'The speech model is not downloaded yet'
    })
    expect(readdirSync(empty)).toEqual([])
  }, 120_000)

  it('refuses a size other than the pinned one, rather than fetching it', async () => {
    await fresh.start()
    const audio = join(SIDECAR_DIR, 'forge_sidecar', '__init__.py')
    await expect(fresh.request(SIDECAR_METHODS.transcribe, { path: audio, model: 'tiny' })).rejects.toMatchObject({
      code: RPC_ERRORS.internalError,
      message: expect.stringContaining("'tiny'")
    })
    expect(readdirSync(empty)).toEqual([])
  }, 120_000)

  it('reports a missing file as an error rather than hanging', async () => {
    await fresh.start()
    await expect(fresh.request(SIDECAR_METHODS.transcribe, { path: '/no/such/file.wav' })).rejects.toMatchObject({
      code: RPC_ERRORS.internalError
    })
  }, 120_000)
})

/* ------------------------------------------- the work, with the model seeded */

let client: SidecarClient

describeWithVenv(
  'asr.transcribe',
  () => {
    beforeAll(() => {
      client = new SidecarClient({
        cwd: SIDECAR_DIR,
        launch: launchFor(VENV_PYTHON, { modelsDir: MODELS_DIR }),
        maxRestarts: 0
      })
    })

    afterAll(() => client?.stop())

    it('reads the seeded model as present', async () => {
      await client.start()
      expect(await client.request<ModelStatus>(SIDECAR_METHODS.asrModel, {})).toMatchObject({ present: true })
    }, 120_000)

    it('transcribes speech with word-level timestamps', async () => {
      await client.start()
      const progress: (number | null)[] = []

      const result = await client.request<TranscribeResult>(
        SIDECAR_METHODS.transcribe,
        { path: FIXTURE, language: 'en' },
        { onProgress: (p) => progress.push(p) }
      )

      expect(result.language).toBe('en')
      expect(result.model).toBe('faster-whisper/small/int8')
      expect(result.words.length).toBeGreaterThan(15)

      const text = result.words.map((w) => w.text).join(' ').toLowerCase()
      expect(text).toContain('ask not what your country')

      // Indices must be dense and ordered — the director references them.
      expect(result.words.map((w) => w.index)).toEqual(result.words.map((_, i) => i))

      // Timings must be sane and non-overlapping.
      for (const word of result.words) {
        expect(word.endMs).toBeGreaterThan(word.startMs)
        expect(word.startMs).toBeGreaterThanOrEqual(0)
        expect(word.endMs).toBeLessThanOrEqual(result.durationMs + 2000)
      }
      for (let i = 1; i < result.words.length; i++) {
        expect(result.words[i].startMs).toBeGreaterThanOrEqual(result.words[i - 1].startMs)
      }

      expect(progress.length).toBeGreaterThan(0)
      expect(progress.at(-1)).toBe(1)
    }, 300_000)

    it('segments the real transcript into referenceable boundaries', async () => {
      await client.start()
      const result = await client.request<TranscribeResult>(SIDECAR_METHODS.transcribe, { path: FIXTURE, language: 'en' })
      const segments = segmentIntoSentences(result.words)

      expect(segments.length).toBeGreaterThan(0)
      // Every segment boundary must land on a real word edge, never mid-word.
      const starts = new Set(result.words.map((w) => w.startMs))
      const ends = new Set(result.words.map((w) => w.endMs))
      for (const segment of segments) {
        expect(starts.has(segment.startMs)).toBe(true)
        expect(ends.has(segment.endMs)).toBe(true)
      }
    }, 300_000)
  },
  // ASR needs the audio fixture and the pinned model seeded: skip, with why, when either is absent.
  { [`audio fixture at ${FIXTURE}`]: existsSync(FIXTURE), [`speech model at ${SNAPSHOT}`]: MODEL_ON_DISK }
)
