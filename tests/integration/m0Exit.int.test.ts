import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createElement, type FunctionComponent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { app } from 'electron'
import { LinkRuns, captionTrackHandler, captionsHandler, metaHandler, runCaptions } from '../../src/main/ingest/meta'
import { downloadMedia, downloadsDir, type IngestTool } from '../../src/main/ingest/download'
import { ensureYtDlp, type YtDlpTool } from '../../src/main/ingest/binary'
import { startRequest } from '../../src/main/ingest/start'
import { probeFile, probeMany } from '../../src/main/ffmpeg/probe'
import { FFMPEG_PATH } from '../../src/main/ffmpeg/paths'
import { toAsset } from '../../src/main/assets'
import { captionsForExport } from '../../src/main/captions'
import { startRender } from '../../src/main/render/renderJob'
import { collectDownload, type IngestEntry } from '@shared/ingest/collect'
import { buildCaptionArgs, buildYtDlpArgs, captionKeys, outputStem, type IngestRequest, type LinkMeta } from '@shared/ingest/args'
import { json3Kind, transcriptFromTracks, type CaptionFetch, type WordRun } from '@shared/ingest/captions'
import { linkCredit, runWords, type LinkClip, type TranscriptFrom } from '@shared/ingest/linkClip'
import { offsetIntoDownload, sectionPlan, type Range } from '@shared/ingest/section'
import { linkCacheKey, parseLink } from '@shared/ingest/url'
import { rowsOf, runOfChapter, runRange } from '@shared/ingest/wordRun'
import { buildRenderPlan } from '@shared/render/plan'
import { exportCanvas } from '@shared/render/exportShape'
import { encodeSpecOf, type EncodeChoice } from '@shared/render/presets'
import type { AspectKey } from '@shared/render/aspect'
import { captionNeedsCanvas, captionRoute } from '@shared/graphics/fromTimeline'
import { resolveStyle, type StyleOverrides } from '@shared/captions/style'
import { captionTrack } from '@shared/captions/timeline'
import { clipsOnTrack, type MediaAsset, type Project } from '@shared/timeline'
import type { Transcript, Word } from '@shared/transcript'
import {
  MID_RUN_AT,
  RUN_AT,
  RUN_MAX_WORDS,
  RUN_MIN_WORDS,
  SECOND_RUN_AT,
  AMBIGUOUS_BELOW,
  audioLag,
  firstFrameAt,
  frameLabels,
  frameReading,
  matchFrame,
  matchOnsets,
  noiseFloor,
  parseAss,
  pickMidRun,
  pickRun,
  readOnsets,
  shapingSensitive,
  type AssEvent,
  type PickedRun
} from '../fixtures/m0Exit'
import { FFMPEG, OUTPUT_ROOT, run, saveFrame, writeNote } from './output'

/*
 * M0's exit check (docs/CLIPS.md §3b.9, its first bullet), on the ten links
 * the user chose — talks, podcasts and raw vlogs; English, Hindi and Telugu;
 * two with no caption track at all — through the app's OWN path, end to end,
 * against YouTube. Opt-in: FORGE_M0_EXIT=1 on the development Mac. Every
 * test is skipped otherwise, and always under CI: the suite must not depend
 * on YouTube.
 *
 * FORGE_M0_LINKS="id,id" runs some of the links. An id that is not one of
 * the ten, or the variable set to a list that names none (`""`, `","`),
 * stops the run before anything is touched; a partial run clears and rewrites only its own links' folders and
 * downloads, and MERGES its rows into summary.json and README.txt — the
 * other links' clips, which the user may be listening to, stay as they were.
 * FORGE_M0_REUSE=1 keeps the downloads (every download then reports cached).
 *
 * The path, per link, is clipIt.int's with the real yt-dlp in place of the
 * fake (ensureYtDlp, as exactCut.int) and real footage in place of bars:
 *   - main's `ingest:meta` / `ingest:captions` / `ingest:captionTrack`
 *     handlers, `ingest:start`'s check (`startRequest`), `downloadMedia` with
 *     the app's argv and the bundled ffmpeg as `--ffmpeg-location`, and
 *     `ingest:collect` (`collectDownload` with main's probe and `toAsset`) —
 *     behind a window.forge bridge;
 *   - the renderer's real STORE: Get transcript, a run set with `setUrlRun`,
 *     Clip download (`clipItFromLink`, exact — the app's default), then
 *     `collectIngest`; on two links Add another clip and a second run; on
 *     every link a run with hard edges (below), in a project of its own;
 *   - the export as render:start runs it with no overlay: main's
 *     `captionsForExport`, so `prepareCaptions` (libass,
 *     the 'pop' style a new project has) and `startRender`, the executor, at
 *     the export strip's default canvas (16:9 at 1080p, 1920×1080) and
 *     encode (`encodeSpecOf` of the store's export choice). What is not the
 *     app's: the queue and its IPC, and the cards' bake (there are none). On
 *     the two `indic` links (Telugu and Hindi, LINKS) the app's route for the
 *     captions is the canvas bake (`captionRoute`, docs/CLIPS.md §16.66 (a)),
 *     which needs a DOM, so there this libass export is what it now is in the
 *     app, the failed bake's fallback; the readings (the .ass against the run,
 *     the onsets) hold for it.
 *
 * The runs are not chosen by hand (fixtures/m0Exit.ts):
 *   - `pickRun`: the first row starting at 40 % of the video (2877 s on
 *     lqOH-zxtCDE, the time the user's link carried), extended over the next
 *     rows to at least 8 words, cut to at most 20; on O35KGzkS4VA (the
 *     user's pick for it) and eK71EN3P78U (Telugu, the longest), Add another
 *     clip and a second run the same way at 70 %;
 *   - `pickMidRun`, at 55 %: a run whose first word starts where the word
 *     before it ends and whose last word ends where the next starts — no
 *     pause either side. `pickRun` always starts after a pause, so its cuts
 *     never met a neighbour; these do, which is where a sliver of the next
 *     word's sound would show.
 *
 * What is measured, and how (the readings are pure and unit-tested in
 * tests/m0Exit.test.ts):
 *   - the transcript: the keys asked, the tracks fetched and their kind, and
 *     where yt-dlp says each key's track comes from (its URL's lang, tlang
 *     and variant, from a simulate run just after); the words, segments and
 *     rows, and a run for every chapter; on a link with no caption track,
 *     the URL tile itself, rendered from the store's real state;
 *   - the clip: one job and one asset per Clip download; the request exact,
 *     its range the run's, its edges inside the gaps to the words around it
 *     (from the transcript, not from `runRange`); the collected words exactly
 *     the run's, each start and end the run's moved onto the file's clock;
 *     the placed clip as long as the range (0 to +2 frames); the credit; no
 *     error notice; and WHICH AUDIO — yt-dlp's pick read with the job's own
 *     argv plus `--simulate`, and, on a link with dubs, read off the FILE:
 *     the original track's own section fetched by its format id and
 *     cross-correlated with the clip's sound (a dub's too, on the first run,
 *     for the contrast);
 *   - the exact cut on a REAL stream (EFFECTS.md §41 had synthetic ones): the
 *     same range fetched again as Clip it's fast cut; the exact clip's first
 *     frame found among the padded file's frames where its own first frame's
 *     time says it should be (gray 160×90, mean absolute difference;
 *     "ambiguous" when the best beats the next by under 20 %), within one
 *     source frame when not ambiguous; its first 500 ms of sound found in
 *     the padded file's to the millisecond, that file's sound starting at its
 *     own 0; and the sound's level either side of each cut, for the ear;
 *   - the export: the .ass read back against the RUN — one Dialogue per word
 *     of the run(s), each lit word the word, each start the word's own time
 *     on the timeline floored to libass's centisecond — and the picture: per
 *     frame, in the lower half, the pixels more than 40 levels from the same
 *     edit exported without captions (ink), how that mask changed (xor), and
 *     how many of the caption's own pixels moved (change). Onsets are read by
 *     `change` and matched to the run's words ONE TO ONE within a frame; an
 *     onset no word took fails the check.
 *
 * Nobody's speech is committed: the ten video ids are here, and nothing else
 * of theirs. The runs' words go to tests/output/m0-exit/ (gitignored), for
 * whoever watches the clips — the ear is the judge of "the words you hear are
 * the run's words".
 */

/** The user's ten links, as given (2026-10-12). Ids only — no title or word of any of them is written here. */
const LINKS = [
  { n: 1, url: 'https://www.youtube.com/watch?v=O35KGzkS4VA', id: 'O35KGzkS4VA', captions: true, second: true },
  // `indic`: the run's words hold Devanagari or Telugu (a script flag, read off the last run's .ass), so the app's route for
  // its captions is the canvas bake (captionRoute, docs/CLIPS.md §16.66 (a)) and this libass export is the failed bake's fallback.
  { n: 2, url: 'https://www.youtube.com/watch?v=eK71EN3P78U', id: 'eK71EN3P78U', captions: true, second: true, indic: true },
  // The link carried &t=2877s: the run is taken there.
  { n: 3, url: 'https://www.youtube.com/watch?v=lqOH-zxtCDE&t=2877s', id: 'lqOH-zxtCDE', captions: true, atMs: 2_877_000, indic: true },
  { n: 4, url: 'https://www.youtube.com/watch?v=3pG8Hgq3Z8M', id: '3pG8Hgq3Z8M', captions: true },
  { n: 5, url: 'https://www.youtube.com/watch?v=bvz_zK5ZxpM', id: 'bvz_zK5ZxpM', captions: true },
  { n: 6, url: 'https://www.youtube.com/watch?v=j4aoo1qbGoE', id: 'j4aoo1qbGoE', captions: true },
  { n: 7, url: 'https://www.youtube.com/watch?v=xON4Vot8j8g&t=2s', id: 'xON4Vot8j8g', captions: true },
  // No caption track, no language: a live concert, and a vlog with nobody talking.
  { n: 8, url: 'https://www.youtube.com/watch?v=zEqLXGE_re4', id: 'zEqLXGE_re4', captions: false },
  { n: 9, url: 'https://www.youtube.com/watch?v=F7Lg2yHtqRA', id: 'F7Lg2yHtqRA', captions: false },
  // Language 'en', and an uploader track keyed 'en-US', which captionKeys('en') does not ask for.
  { n: 10, url: 'https://www.youtube.com/watch?v=jze_5hvaVV8', id: 'jze_5hvaVV8', captions: true, uploaderKey: 'en-US' }
] as const
type LinkSpec = (typeof LINKS)[number]
/** Whether this link's captions are the canvas bake's in the app (`indic` above). */
const indicLink = (spec: LinkSpec): boolean => 'indic' in spec && spec.indic

const inCi = !!process.env.CI && process.env.CI !== 'false'
const ENABLED = process.env.FORGE_M0_EXIT === '1' && !inCi
const REASON = inCi
  ? 'skipped under CI: the suite must not depend on YouTube'
  : 'needs FORGE_M0_EXIT=1: ten public YouTube links through the real yt-dlp; the development Mac'
if (!ENABLED) process.stderr.write(`m0Exit.int: every test SKIPPED — ${REASON}\n`)
/** Unset: all ten. Set: exactly the ids it names — and set to nothing ("", ","), none, which refuses to start. */
const ONLY: string[] | null =
  process.env.FORGE_M0_LINKS === undefined
    ? null
    : process.env.FORGE_M0_LINKS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
/** Ids FORGE_M0_LINKS names that are not among the ten: the run refuses to start. */
const UNKNOWN = (ONLY ?? []).filter((id) => !LINKS.some((l) => l.id === id))
const CHOSEN = LINKS.filter((l) => ONLY === null || ONLY.includes(l.id))
/** Keep the downloads between runs (for working on the readings): every download then reports `cached`. */
const REUSE = process.env.FORGE_M0_REUSE === '1'

const DOWNLOAD_MS = 180_000
const CAPTIONS_MS = 120_000
/** The picture the exact clip's first frame is matched at. */
const SMALL = { width: 160, height: 90 }
const RATE = 16_000
/** Either side of each cut, for the sound's level there. */
const EDGE_MS = 40
const RAN_AT = new Date().toISOString()

const OUT = join(OUTPUT_ROOT, 'm0-exit')
let userData = ''
let tool: YtDlpTool | null = null
const savedEnv = { userData: process.env.FORGE_TEST_USERDATA, fonts: process.env.FORGE_FONTS_DIR, xdg: process.env.XDG_CACHE_HOME }
/** This run's own lines for the top README: the tools and what was chosen. */
const runInfo: string[] = []
const summary: Record<string, unknown>[] = []

/* ------------------------------------------------- the store, renderable */

/*
 * The store is the real one; only `useEditor` is wrapped so a component can
 * be rendered from it outside React's hooks (as tests/renderer/ingestPanel
 * does): the URL tile is rendered from the state the real handlers left.
 * Typed loosely: the node project that checks tests/ cannot compile renderer
 * code (clipIt.int's note).
 */
vi.mock('../../src/renderer/src/store', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>()
  const store = real.useEditor as {
    getState(): unknown
    setState(next: unknown): void
    getInitialState(): unknown
    subscribe(listener: () => void): () => void
  }
  const useEditor = Object.assign((select: (s: unknown) => unknown) => select(store.getState()), {
    getState: store.getState,
    setState: store.setState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe
  })
  return { ...real, useEditor }
})

/* ------------------------------------------------------------- the bridge */

interface Job {
  request: IngestRequest
  clip: LinkClip | null
  ms: number | null
  error: string | null
}
const entries = new Map<string, IngestEntry>()
const downloads = new Map<string, Promise<void>>()
const jobs = new Map<string, Job>()
let jobSeq = 0
/** What main's handlers answered, and how long they took: the last of each per link. */
const asked = { meta: new Map<string, { meta: LinkMeta; ms: number }>(), captions: new Map<string, { fetch: CaptionFetch; ms: number }>() }

const ytTool = (): IngestTool => ({ command: tool!.path })
/**
 * The downloads' yt-dlp, through a shell that writes each run's argv to a log
 * first and then becomes yt-dlp (`exec`, so the job's kill still reaches it):
 * how many runs a download took — the app runs a refused cut again
 * (download.ts, CUT_TRIES) — is read off the log.
 */
const runLog = (): string => join(userData, 'yt-dlp-runs.log')
const countedTool = (): IngestTool => ({
  command: '/bin/sh',
  prefixArgs: ['-c', 'printf "%s\\n" "$*" >> "$M0_RUN_LOG"; exec "$0" "$@"', tool!.path]
})
/** How many times yt-dlp was started for this request's file. */
async function runsFor(request: IngestRequest): Promise<number> {
  const stem = ` ${outputStem(parseLink(request.url)!, request)}.%(ext)s `
  const log = await readFile(runLog(), 'utf8').catch(() => '')
  return log.split('\n').filter((l) => `${l} `.includes(stem)).length
}

/** `ingest:collect`'s read: main's probe and `toAsset`, as ipc.ts's `readDownload`. */
async function readDownload(path: string, name: string, fps: number): Promise<MediaAsset> {
  const { ok, failed } = await probeMany([path])
  if (ok.length === 0) throw new Error(failed[0]?.error ?? 'Could not read the downloaded file')
  return toAsset({ ...ok[0], name }, fps)
}

function bridge(): Record<string, unknown> {
  const runs = new LinkRuns()
  const find = async (): Promise<IngestTool> => ytTool()
  const meta = metaHandler(runs, find)
  const captions = captionsHandler(runs, find, { timeoutMs: CAPTIONS_MS })
  const track = captionTrackHandler()
  return {
    ingestMeta: async (url: string) => {
      const t0 = Date.now()
      const answer = await meta({ url })
      asked.meta.set(url, { meta: answer, ms: Date.now() - t0 })
      return answer
    },
    ingestCaptions: async (url: string, language: string) => {
      const t0 = Date.now()
      const answer = await captions({ url, language })
      asked.captions.set(url, { fetch: answer, ms: Date.now() - t0 })
      return answer
    },
    ingestCaptionTrack: (linkKey: string, key: string) => track({ linkKey, key }),
    // `ingest:start`: checked by main's own `startRequest`, then the download the job runs.
    startIngest: async (request: IngestRequest, clip?: LinkClip | null) => {
      const checked = startRequest(clip ? { ...request, clip } : request)
      const id = `job-${++jobSeq}`
      const entry: IngestEntry = { request: checked.request, outcome: null, clip: checked.clip }
      const job: Job = { request: checked.request, clip: checked.clip, ms: null, error: null }
      entries.set(id, entry)
      jobs.set(id, job)
      const t0 = Date.now()
      const handle = downloadMedia(checked.request, countedTool(), () => undefined)
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        handle.cancel()
      }, DOWNLOAD_MS)
      downloads.set(
        id,
        handle.promise.then(
          (outcome) => {
            clearTimeout(timer)
            entry.outcome = outcome
            job.ms = Date.now() - t0
          },
          (err: unknown) => {
            clearTimeout(timer)
            job.error = timedOut ? `the download took over ${DOWNLOAD_MS / 1000} s` : err instanceof Error ? err.message : String(err)
            throw new Error(`${id}: ${job.error}`)
          }
        )
      )
      return { id, presetId: 'ingest', status: 'queued' }
    },
    collectIngest: (jobId: string, fps: number) => collectDownload(entries, { jobId, fps }, readDownload)
  }
}

/* ------------------------------------------------------------- the store */

/**
 * The renderer's store — `useEditor` itself, loaded when the check starts, by
 * a specifier tsc does not follow. The part it drives is typed here.
 */
const STORE_MODULE = '../../src/renderer/src/store'
const PANEL_MODULE = '../../src/renderer/src/components/IngestPanel'

interface UrlSourceView {
  linkKey: string
  url: string
  meta: LinkMeta | null
  fetchedAt: string | null
  transcript: Transcript | null
  tracks: { key: string; kind: 'asr' | 'lines' }[]
  language: string | null
  status: string
  error: string | null
  run: WordRun | null
  clipped: boolean
}

interface StoreView {
  project: Project
  notices: { id: number; text: string; tone: 'error' | 'info' }[]
  urlSource: UrlSourceView | null
  aspect: AspectKey
  exportChoice: EncodeChoice
  ingest: { useRange: boolean }
  setIngest(patch: { url?: string; useRange?: boolean }): void
  getTranscript(language?: string): Promise<void>
  newProject(): void
  addAnotherClip(): void
  setUrlRun(run: WordRun | null, anchorRow?: number | null): void
  clipItFromLink(): Promise<void>
  startIngest(override: { url: string; range: Range; exact: boolean; clip: LinkClip }): Promise<string | null>
  collectIngest(jobId: string): Promise<void>
}

let store: { getState(): StoreView; setState(next: unknown): void; getInitialState(): unknown } | null = null
let IngestPanel: FunctionComponent | null = null
const state = (): StoreView => store!.getState()
/** The highest notice id so far, to count what a step adds. */
const lastNotice = (): number => state().notices.reduce((m, n) => Math.max(m, n.id), 0)

/* ------------------------------------------------------------- decoding */

/** A file's video frames, counted by decoding (ffprobe `-count_frames`). */
async function countFrames(file: string): Promise<number> {
  const { stdout } = await run(ffprobeInstaller.path, [
    '-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file
  ])
  return Number(String(stdout).trim().split(/\r?\n/)[0])
}

/** Each stream's start and length in ms, as the container says (edit lists applied). */
async function streamSpans(file: string): Promise<{ video: { startMs: number; ms: number } | null; audio: { startMs: number; ms: number } | null }> {
  const { stdout } = await run(ffprobeInstaller.path, [
    '-v', 'error', '-show_entries', 'stream=codec_type,start_time,duration', '-of', 'csv=p=0', file
  ])
  const spans = String(stdout)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split(','))
    .map(([type, start, length]) => ({ type, startMs: Math.round(Number(start) * 1000), ms: Math.round(Number(length) * 1000) }))
  const of = (type: string): { startMs: number; ms: number } | null => {
    const s = spans.find((x) => x.type === type)
    return s ? { startMs: s.startMs, ms: s.ms } : null
  }
  return { video: of('video'), audio: of('audio') }
}

/** The audio stream's language tag, if the file carries one. */
async function audioTag(file: string): Promise<string | null> {
  const { stdout } = await run(ffprobeInstaller.path, [
    '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream_tags=language', '-of', 'csv=p=0', file
  ])
  const tag = String(stdout).trim()
  return tag || null
}

/** Frames at 160×90 gray, each with its presentation time (showinfo), in presentation order. */
async function smallFrames(file: string, max?: number): Promise<{ ptsMs: number; data: Uint8Array }[]> {
  const { stdout, stderr } = await run(
    FFMPEG,
    [
      '-hide_banner', '-nostats', '-loglevel', 'info', '-i', file, '-map', '0:v:0',
      '-vf', `scale=${SMALL.width}:${SMALL.height}:flags=area,showinfo`, '-vsync', 'passthrough',
      ...(max ? ['-frames:v', String(max)] : []),
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-'
    ],
    { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 }
  )
  const buf = stdout as unknown as Buffer
  const size = SMALL.width * SMALL.height
  const times = [...String(stderr).matchAll(/\bn:\s*\d+\s+pts:\s*-?\d+\s+pts_time:\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)/g)].map((m) => Number(m[1]) * 1000)
  const count = Math.floor(buf.length / size)
  // showinfo may see a frame more than `-frames:v` lets out; never fewer.
  if (times.length < count || (!max && times.length !== count)) throw new Error(`${file}: ${count} frames decoded, ${times.length} times read`)
  return Array.from({ length: count }, (_, k) => ({ ptsMs: times[k], data: new Uint8Array(buf.subarray(k * size, (k + 1) * size)) }))
}

/** Mono f32 at 16 kHz (edit lists honoured, as the app's renders read a file). */
async function pcm(file: string): Promise<Float32Array> {
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'],
    { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }
  )
  const buf = stdout as unknown as Buffer
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4)))
}

/** The RMS level of `[fromMs, toMs)` of a 16 kHz signal, in dBFS (−Infinity for silence or nothing). */
function levelDb(samples: Float32Array, fromMs: number, toMs: number): number {
  const a = Math.max(0, Math.round((fromMs * RATE) / 1000))
  const b = Math.min(samples.length, Math.round((toMs * RATE) / 1000))
  if (b <= a) return Number.NEGATIVE_INFINITY
  let sq = 0
  for (let i = a; i < b; i++) sq += samples[i] * samples[i]
  const rms = Math.sqrt(sq / (b - a))
  return rms > 0 ? Math.round(20 * Math.log10(rms) * 10) / 10 : Number.NEGATIVE_INFINITY
}

/**
 * The lower half of two exports, frame by frame, gray, streamed: one ffmpeg
 * stacks the captioned band over the captionless one, and `onFrame` reads
 * each pair as it arrives.
 */
function bandPairs(
  captioned: string,
  plain: string,
  canvas: { width: number; height: number },
  onFrame: (cap: Uint8Array, plain: Uint8Array) => void
): Promise<number> {
  const top = canvas.height / 2
  const bandH = canvas.height - top
  const crop = `crop=${canvas.width}:${bandH}:0:${top},format=gray`
  const args = [
    '-hide_banner', '-loglevel', 'error', '-i', captioned, '-i', plain,
    '-filter_complex', `[0:v]${crop}[a];[1:v]${crop}[b];[a][b]vstack=inputs=2[d]`,
    '-map', '[d]', '-vsync', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'
  ]
  const half = canvas.width * bandH
  const size = 2 * half
  return new Promise((resolvePromise, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let frame = Buffer.alloc(size)
    let filled = 0
    let frames = 0
    let err = ''
    child.stdout.on('data', (chunk: Buffer) => {
      let at = 0
      while (at < chunk.length) {
        const n = Math.min(size - filled, chunk.length - at)
        chunk.copy(frame, filled, at, at + n)
        filled += n
        at += n
        if (filled === size) {
          onFrame(frame.subarray(0, half), frame.subarray(half))
          frames++
          frame = Buffer.alloc(size)
          filled = 0
        }
      }
    })
    child.stderr.on('data', (c: Buffer) => {
      err = (err + c.toString()).slice(-4000)
    })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolvePromise(frames) : reject(new Error(`ffmpeg exited ${code}: ${err}`))))
  })
}

/* ----------------------------------------------------- what yt-dlp picks */

interface Fmt {
  format_id?: string
  language?: string | null
  language_preference?: number
  acodec?: string
  vcodec?: string
  format_note?: string
  fps?: number
  width?: number
  height?: number
}
const RF = '@m0rf@'
const AF = '@m0af@'
const SF = '@m0sf@'
const PIN = '@m0pin@'

/** Run yt-dlp, and once more when it fails (a refused stream URL fails at once and passes again, EFFECTS.md §51). */
async function ytdlp(args: string[], timeout = 180_000): Promise<{ stdout: string; stderr: string; tries: number }> {
  try {
    const { stdout, stderr } = await run(tool!.path, args, { maxBuffer: 64 * 1024 * 1024, timeout })
    return { stdout: String(stdout), stderr: String(stderr), tries: 1 }
  } catch {
    const { stdout, stderr } = await run(tool!.path, args, { maxBuffer: 64 * 1024 * 1024, timeout })
    return { stdout: String(stdout), stderr: String(stderr), tries: 2 }
  }
}

/** The value after a marked line, or null. */
const marked = (stdout: string, mark: string): string | null =>
  stdout.split(/\r?\n/).find((l) => l.startsWith(mark))?.slice(mark.length).trim() ?? null

/**
 * Which formats the job's own argv picks, and every audio track on offer:
 * the argv `downloadMedia` builds for that request (`buildYtDlpArgs`, the
 * bundled ffmpeg, the downloads folder, its stem), plus `--simulate` and two
 * prints. `--simulate` after the argv's `--no-simulate`: the later wins.
 */
async function formatPick(request: IngestRequest): Promise<{ argv: string[]; requested: Fmt[]; audio: Fmt[]; warnings: string[] }> {
  const link = parseLink(request.url)!
  const built = buildYtDlpArgs(request, { ffmpegPath: FFMPEG_PATH, destDir: downloadsDir(), stem: outputStem(link, request) })
  const { stdout, stderr } = await ytdlp([
    ...built.args,
    '--simulate',
    '--print', `${AF}%(formats.:.{format_id,language,language_preference,acodec,vcodec,format_note})j`,
    '--print', `${RF}%(requested_formats)j`
  ], 120_000)
  const take = (mark: string): Fmt[] => {
    const value = marked(stdout, mark)
    // `NA` when the field is absent: one progressive format has no requested_formats.
    return value && value !== 'NA' ? (JSON.parse(value) as Fmt[]) : []
  }
  const audio = take(AF).filter((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none')
  const warnings = stderr
    .split(/\r?\n/)
    .filter((l) => /WARNING|ERROR/.test(l))
    .map((l) => l.replace(/https?:\/\/\S+/g, '<url>').slice(0, 200))
  return { argv: built.args, requested: take(RF), audio, warnings }
}

/**
 * Where yt-dlp says each caption key's track comes from: the app's own
 * caption argv for these keys, `--simulate` after it, and the
 * `requested_subtitles` dict printed — each entry's URL's `lang`, `tlang`
 * and `variant`. A simulate run just AFTER the app's fetch: which candidate a
 * key resolves to varied between requests (EFFECTS.md §51), so this is a
 * reading of the moment, not of the fetch itself.
 */
async function captionSources(url: string, keys: string[]): Promise<Record<string, { lang: string | null; tlang: string | null; variant: string | null; kind: string | null }>> {
  const args = buildCaptionArgs(url, keys, join(userData, 'probe'), 'm0probe')
  const { stdout } = await ytdlp([...args, '--simulate', '--print', `${SF}%(requested_subtitles)j`], 120_000)
  const value = marked(stdout, SF)
  if (!value || value === 'NA') return {}
  const dict = JSON.parse(value) as Record<string, { url?: string }>
  return Object.fromEntries(
    Object.entries(dict).map(([key, entry]) => {
      const q = entry.url ? new URL(entry.url).searchParams : new URLSearchParams()
      return [key, { lang: q.get('lang'), tlang: q.get('tlang'), variant: q.get('variant'), kind: q.get('kind') }]
    })
  )
}

/**
 * One audio format's own section, fetched by its id (padded a second each
 * side, a copy), and where the clip's opening sound sits in it: a
 * correlation near 1 says the clip's sound IS that track's. The pin read off
 * the file, not off yt-dlp's plan for it.
 */
async function sectionOf(s: LinkState, leg: Leg, fmt: Fmt, label: string): Promise<{ formatId: string; language: string | null; note: string | null; corr: number; lagMs: number; tries: number }> {
  const start = Math.max(0, leg.range.startMs - 1000)
  const end = leg.range.endMs + 1000
  const dir = join(userData, 'm0-pin', s.spec.id)
  const stem = `${leg.name}-${label}-${fmt.format_id}`.replace(/[^A-Za-z0-9_-]/g, '_')
  const { stdout, tries } = await ytdlp([
    '--ignore-config', parseLink(s.spec.url)!.url, '--no-playlist', '--playlist-items', '1', '--encoding', 'utf-8',
    '--ffmpeg-location', FFMPEG_PATH, '-f', fmt.format_id!,
    '--download-sections', `*${(start / 1000).toFixed(3)}-${(end / 1000).toFixed(3)}`,
    '--downloader-args', 'ffmpeg:-loglevel error',
    '-P', dir, '-o', `${stem}.%(ext)s`, '--no-simulate', '--print', `after_move:${PIN}%(filepath)s`,
    '--retries', '5', '--socket-timeout', '30'
  ])
  const file = marked(stdout, PIN)
  if (!file) throw new Error(`${s.spec.id} ${leg.name}: yt-dlp did not say where format ${fmt.format_id} went`)
  const lag = audioLag(await pcm(leg.exact!.file), await pcm(file), RATE, leg.range.startMs - start)
  return {
    formatId: fmt.format_id!,
    language: fmt.language ?? null,
    note: fmt.format_note ?? null,
    corr: Math.round(lag.corr * 10000) / 10000,
    lagMs: Math.round(lag.lagMs * 100) / 100,
    tries
  }
}

/* ------------------------------------------------------------ per link */

interface Leg {
  name: 'first' | 'second' | 'mid'
  prefix: '' | 'second-' | 'mid-'
  picked: PickedRun
  targetMs: number
  range: Range
  /** The run's words, in the link's transcript. */
  words: Word[]
  exact?: { jobId: string; asset: MediaAsset; file: string }
  fast?: { jobId: string; asset: MediaAsset; file: string }
}

interface LinkState {
  spec: LinkSpec
  dir: string
  meta: LinkMeta
  fetch: CaptionFetch | null
  fetchMs: number
  transcript: Transcript | null
  legs: Leg[]
  /** The project after the first Clip download — what is exported. */
  project?: Project
  /** The links that take Add another clip: after it, both clips. */
  both?: Project
  /** Why Get transcript failed, when it did. */
  failed?: string
  notes: string[]
  row: Record<string, unknown>
  /** This link's lines for the top README. */
  top: string[]
}
const links = new Map<string, LinkState>()

function need(id: string): LinkState {
  const s = links.get(id)
  if (!s) throw new Error(`${id}: the transcript step did not complete, so there is nothing to clip`)
  if (s.failed) throw new Error(`${id}: Get transcript failed in the app ("${s.failed}"), so there is nothing to clip`)
  return s
}

const fmtMs = (ms: number): string => `${(ms / 1000).toFixed(3)} s`

function legOf(t: Transcript, name: Leg['name'], picked: PickedRun, targetMs: number): Leg {
  const prefix = name === 'first' ? '' : name === 'second' ? 'second-' : 'mid-'
  return { name, prefix, picked, targetMs, range: runRange(t, picked.run), words: t.words.slice(picked.run.from, picked.run.to + 1) }
}

/** Clip download on the run now set, as the URL tile's button does it, then collected. */
async function clipDownload(s: LinkState, leg: Leg): Promise<{ jobId: string; job: Job; asset: MediaAsset }> {
  const before = jobSeq
  const assetsBefore = state().project.assets.length
  await state().clipItFromLink()
  expect(jobSeq, `${s.spec.id} ${leg.name}: one job`).toBe(before + 1)
  const jobId = `job-${jobSeq}`
  const job = jobs.get(jobId)!
  try {
    await downloads.get(jobId)
  } catch (err) {
    // Written down before the test fails: what was asked, and what yt-dlp would have picked for it.
    const pick = await formatPick(job.request).catch((e: unknown) => ({ argv: [] as string[], requested: [] as Fmt[], audio: [] as Fmt[], warnings: [String(e)] }))
    const section = pick.argv[pick.argv.indexOf('--download-sections') + 1]
    const message = `${err instanceof Error ? err.message : String(err)} (after ${await runsFor(job.request)} yt-dlp run(s))`
    s.notes.push(
      '',
      `## ${leg.name} run: Clip download FAILED — ${message}`,
      `words ${leg.picked.run.from}–${leg.picked.run.to} (${leg.words.length}), ${fmtMs(leg.range.startMs)} → ${fmtMs(leg.range.endMs)}; section ${section}; ` +
        `formats ${pick.requested.map((f) => `${f.format_id} (${f.vcodec}/${f.acodec})`).join(' + ')}`,
      ...(pick.warnings.length ? [`yt-dlp warned: ${pick.warnings.join(' | ')}`] : [])
    )
    s.row[`${leg.name}Clip`] = { failed: message, section, formats: pick.requested.map((f) => f.format_id) }
    s.top.push(`  - ${s.spec.id} ${leg.name}: Clip download FAILED — ${message} (section ${section})`)
    throw err
  }
  await state().collectIngest(jobId)
  const project = state().project
  expect(project.assets, `${s.spec.id} ${leg.name}: one asset more`).toHaveLength(assetsBefore + 1)
  return { jobId, job, asset: project.assets[project.assets.length - 1] }
}

/** The words a project's captions are built from, on the timeline's clock — clip by clip, as `buildTimelineCaptions` takes them. */
function timelineWords(project: Project): { text: string; ms: number }[] {
  const fps = project.settings.fps
  const track = captionTrack(project)
  if (!track) return []
  const out: { text: string; ms: number }[] = []
  for (const clip of clipsOnTrack(project, track.id)) {
    const t = project.transcripts[clip.assetId]
    if (!t) continue
    const inMs = (clip.inPoint * 1000) / fps
    const lengthMs = (clip.duration * 1000) / fps
    const startMs = (clip.start * 1000) / fps
    for (const w of t.words) {
      if (w.endMs <= inMs || w.startMs >= inMs + lengthMs) continue
      out.push({ text: w.text, ms: w.startMs - inMs + startMs })
    }
  }
  return out
}

/**
 * What the export's captions SHOULD be, from the runs themselves: each leg's
 * words, in the link's transcript, moved onto the timeline by where the leg's
 * clip sits — `start − inPoint` — and the range's start. Not from the
 * project's own transcripts, which is what the export is built from.
 */
function expectedWords(project: Project, legs: readonly Leg[]): { text: string; ms: number }[] {
  const fps = project.settings.fps
  const out: { text: string; ms: number }[] = []
  for (const leg of legs) {
    const clip = project.clips.find((c) => c.assetId === leg.exact?.asset.id)
    if (!clip) throw new Error(`${leg.name}: its clip is not in the exported project`)
    const at = ((clip.start - clip.inPoint) * 1000) / fps
    for (const w of leg.words) out.push({ text: w.text, ms: w.startMs - leg.range.startMs + at })
  }
  return out.map((w, i) => ({ w, i })).sort((a, b) => a.w.ms - b.w.ms || a.i - b.i).map((x) => x.w)
}

/** toAssTime: the ms rounded, then floored to the centisecond. */
const assStartOf = (ms: number): number => Math.floor(Math.round(ms) / 10) * 10

interface ExportReading {
  canvas: { width: number; height: number }
  frames: number
  events: AssEvent[]
  /** What the captions should be: from the runs (`expectedWords`). */
  expected: { text: string; ms: number }[]
  /** What the export was built from: the project's transcripts, cut by its clips. */
  built: { text: string; ms: number }[]
  onsets: ReturnType<typeof readOnsets>
  /** The margins of the change the onsets are read by (the caption's own pixels). */
  floor: ReturnType<typeof noiseFloor>
  /** The same margins for the mask's XOR, which the footage moves too. */
  xorFloor: ReturnType<typeof noiseFloor>
  match: ReturnType<typeof matchOnsets>
  wordFrames: number[]
  /** Per word: the frame libass should first draw its Dialogue on. */
  assFrames: number[]
  png: { frame: number; file: string }
}

/**
 * One export as render:start runs it with no overlay: main's captions (`captionsForExport`, so libass), the executor,
 * the strip's default canvas and encode. On an `indic` link that is the failed bake's fallback, the bake needing a DOM.
 */
async function appExport(project: Project, outputPath: string, canvas: { width: number; height: number }, withCaptions: boolean): Promise<{ ass: string | null; durationFrames: number }> {
  const encode = encodeSpecOf(state().exportChoice)
  const p = withCaptions ? project : { ...project, captions: { ...project.captions, enabled: false } }
  const prepared = withCaptions ? await captionsForExport(p, canvas, undefined) : null
  if (withCaptions && !prepared) throw new Error('captionsForExport found nothing to burn')
  const request = { project: p, outputPath, canvas, encode, subtitlesPath: prepared?.subtitlesPath, fontsDir: prepared?.fontsDir }
  const { durationFrames } = buildRenderPlan(request)
  await startRender({ ...request, tempDir: join(userData, 'tmp') }, () => undefined).promise
  const ass = prepared ? await readFile(prepared.subtitlesPath, 'utf8') : null
  await prepared?.cleanup()
  return { ass, durationFrames }
}

/** Export one project with captions and without, read the .ass and the picture, leave every file in `into`. */
async function exportAndRead(project: Project, legs: readonly Leg[], into: string, prefix: string, indic: boolean): Promise<ExportReading> {
  const name = (f: string): string => join(into, `${prefix}${f}`)
  const fps = project.settings.fps
  const canvas = exportCanvas(state().aspect, state().exportChoice.resolution)

  // 'pop', a new project's style: flat, the style's half of the route (captionNeedsCanvas).
  expect(project.captions.enabled, 'captions are on in a new project').toBe(true)
  const style = resolveStyle(project.captions.styleId, project.captions.overrides as StyleOverrides | undefined)
  expect(captionNeedsCanvas(style), 'pop is flat').toBe(false)
  // The route the app takes (ExportStrip asks captionRoute): the canvas for a Hindi or Telugu track, libass for the rest.
  // This export is libass either way; on an `indic` link it is the failed bake's fallback.
  expect(captionRoute(project).route, 'the app’s route for these captions').toBe(indic ? 'canvas' : 'libass')
  const plain = await appExport(project, name('clip-plain.mp4'), canvas, false)
  const captioned = await appExport(project, name('clip-captions.mp4'), canvas, true)
  const ass = captioned.ass!
  await writeFile(name('captions.ass'), ass)

  const framesPlain = await countFrames(name('clip-plain.mp4'))
  const framesCaptioned = await countFrames(name('clip-captions.mp4'))
  expect.soft(framesPlain, `${prefix}clip-plain frames against the plan`).toBe(plain.durationFrames)
  expect.soft(framesCaptioned, `${prefix}clip-captions frames against the plan`).toBe(captioned.durationFrames)

  const ink: number[] = []
  const xor: number[] = []
  const change: number[] = []
  let previous: { cap: Uint8Array; mask: Uint8Array } | null = null
  const read = await bandPairs(name('clip-captions.mp4'), name('clip-plain.mp4'), canvas, (cap, plainBand) => {
    const r = frameReading(cap, plainBand, previous)
    ink.push(r.ink)
    xor.push(r.xor)
    change.push(r.change)
    previous = { cap: new Uint8Array(cap), mask: r.mask }
  })
  expect.soft(read, `${prefix}frames read`).toBe(framesCaptioned)

  const events = parseAss(ass)
  const expected = expectedWords(project, legs)
  const built = timelineWords(project)
  const onsets = readOnsets(ink, change)
  const labels = frameLabels(events, read, fps)
  const floor = noiseFloor(ink, change, labels)
  const xorFloor = noiseFloor(ink, xor, labels)
  const wordFrames = expected.map((w) => firstFrameAt(w.ms, fps))
  const assFrames = expected.map((w) => firstFrameAt(assStartOf(w.ms), fps))
  const match = matchOnsets(wordFrames, onsets.onsets, 1)
  const onsetSet = new Set(onsets.onsets)
  const wordAt = new Map<number, number>()
  wordFrames.forEach((f, i) => {
    if (!wordAt.has(f)) wordAt.set(f, i)
  })
  const csv = ['frame,ms,ink,xor,change,label,onset_seen,word_starts']
  for (let f = 0; f < read; f++) {
    csv.push(`${f},${((f * 1000) / fps).toFixed(1)},${ink[f]},${xor[f]},${change[f]},${labels[f]},${onsetSet.has(f) ? 1 : 0},${wordAt.has(f) ? wordAt.get(f) : ''}`)
  }
  await writeFile(name('frames.csv'), `${csv.join('\n')}\n`)

  // The middle word, lit: the frame its onset was taken on, or its own frame.
  const mid = Math.floor(expected.length / 2)
  const offset = match.offsets[mid]
  const pngFrame = wordFrames[mid] + (offset ?? 0)
  await saveFrame(name('clip-captions.mp4'), Math.max(0, (pngFrame - 0.25) / fps), name('onset.png'))

  return { canvas, frames: read, events, expected, built, onsets, floor, xorFloor, match, wordFrames, assFrames, png: { frame: pngFrame, file: name('onset.png') } }
}

/**
 * The hard .ass check, against the runs: one Dialogue per word of the
 * run(s), in order; each lit word the word; each start the word's own time
 * on the timeline, rounded and floored to the centisecond (toAssTime). And
 * what the export was built from is the runs' words, in order.
 */
function assertAss(id: string, prefix: string, r: ExportReading): void {
  expect.soft(r.built.map((w) => w.text), `${id} ${prefix}: the project's caption words are the runs' words`).toEqual(r.expected.map((w) => w.text))
  expect(r.events.length, `${id} ${prefix}: one Dialogue per word of the run(s)`).toBe(r.expected.length)
  r.expected.forEach((w, i) => {
    // 'pop' is uppercase (style.ts); buildAss writes the word upper-cased, as JS does.
    expect.soft(r.events[i]?.lit, `${id} ${prefix}: word ${i}'s lit word`).toBe(w.text.toUpperCase())
    expect.soft(r.events[i]?.startMs, `${id} ${prefix}: word ${i} at ${w.ms.toFixed(1)} ms on the timeline, its Dialogue`).toBe(assStartOf(w.ms))
  })
}

/* ----------------------------------------------------------------- setup */

beforeAll(async () => {
  if (!ENABLED) return
  // Refused before anything is touched: a typo must not cost the user the other links' clips.
  if (UNKNOWN.length > 0) throw new Error(`FORGE_M0_LINKS names ${UNKNOWN.join(', ')}, not among the ten links — nothing was cleared`)
  if (CHOSEN.length === 0) throw new Error('FORGE_M0_LINKS is set and names no link (unset it for all ten) — nothing was cleared')

  await mkdir(OUT, { recursive: true })
  // A temp userData, never the app's: the downloads, the caption cache, the .ass files, and yt-dlp's cache.
  userData = join(tmpdir(), 'forge-m0exit-userdata')
  await mkdir(userData, { recursive: true })
  process.env.FORGE_TEST_USERDATA = userData
  process.env.M0_RUN_LOG = runLog()
  await rm(runLog(), { force: true })
  // Only the chosen links' own: their folders here, and (without REUSE) their downloads and caches.
  for (const l of CHOSEN) {
    await rm(join(OUT, `${l.n}-${l.id}`), { recursive: true, force: true })
    if (REUSE) continue
    const key = parseLink(l.url)!.key
    const names = await readdir(downloadsDir()).catch(() => [] as string[])
    for (const n of names.filter((n) => n.startsWith(`${key}.`))) await rm(join(downloadsDir(), n), { force: true })
    // Where main puts them: the stub's getPath('userData') is <FORGE_TEST_USERDATA>/userData.
    await rm(join(app.getPath('userData'), 'url', linkCacheKey(parseLink(l.url)!)), { recursive: true, force: true })
    await rm(join(userData, 'm0-pin', l.id), { recursive: true, force: true })
    await rm(join(userData, 'leftover', l.id), { recursive: true, force: true })
  }
  // yt-dlp writes its cache under XDG_CACHE_HOME; ~/.cache is not writable here (EFFECTS.md §40).
  process.env.XDG_CACHE_HOME = join(userData, 'xdg-cache')
  process.env.FORGE_FONTS_DIR = resolve(__dirname, '../../assets/fonts')

  tool = await ensureYtDlp()
  const ffmpegVersion = String((await run(FFMPEG, ['-version'])).stdout).split(/\r?\n/)[0]
  runInfo.push(
    `last run ${RAN_AT}: links ${CHOSEN.map((l) => l.id).join(', ')}${REUSE ? ' (FORGE_M0_REUSE=1: downloads kept from an earlier run)' : ''}`,
    `yt-dlp ${tool.version ?? '?'} (${tool.source}: ${tool.path}); ffmpeg "${ffmpegVersion}" (${FFMPEG}); ${process.platform}; userData ${userData}`
  )

  vi.stubGlobal('window', { forge: bridge() })
  store = ((await import(/* @vite-ignore */ STORE_MODULE)) as { useEditor: NonNullable<typeof store> }).useEditor
  store.setState(store.getInitialState())
  IngestPanel = ((await import(/* @vite-ignore */ PANEL_MODULE)) as { IngestPanel: FunctionComponent }).IngestPanel
}, 600_000)

/** Rows kept from earlier runs for the links this run did not touch, merged with this run's. */
async function mergedRows(): Promise<Record<string, unknown>[]> {
  const ran = new Set<string>(CHOSEN.map((l) => l.id))
  let earlier: Record<string, unknown>[] = []
  try {
    const parsed: unknown = JSON.parse(await readFile(join(OUT, 'summary.json'), 'utf8'))
    if (Array.isArray(parsed)) earlier = parsed.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
  } catch {
    // None yet, or unreadable: this run's rows alone.
  }
  return [...earlier.filter((r) => !ran.has(String(r.id))), ...summary].sort((a, b) => Number(a.n) - Number(b.n))
}

afterAll(async () => {
  if (!ENABLED) return
  vi.unstubAllGlobals()
  delete process.env.M0_RUN_LOG
  for (const [key, value] of [
    ['FORGE_TEST_USERDATA', savedEnv.userData],
    ['FORGE_FONTS_DIR', savedEnv.fonts],
    ['XDG_CACHE_HOME', savedEnv.xdg]
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  if (runInfo.length === 0) return
  for (const s of links.values()) await writeNote(s.dir, s.notes)
  const rows = await mergedRows()
  await writeFile(join(OUT, 'summary.json'), `${JSON.stringify(rows, null, 2)}\n`)
  await writeNote(OUT, [
    '# m0-exit — M0’s exit check on the user’s ten links (docs/CLIPS.md §3b.9)',
    '',
    'Each link through the app’s own path: main’s ingest:meta / ingest:captions handlers and the real yt-dlp, the renderer’s store',
    '(Get transcript, a run, Clip download, collect), then the export as render:start runs it with no overlay (captionsForExport, libass, the "pop"',
    'style; startRender at the export strip’s default 1920×1080). The runs: the first row at 40 % of the video (2877 s on',
    'lqOH-zxtCDE), extended to ≥ 8 words, cut to ≤ 20; O35KGzkS4VA and eK71EN3P78U also take Add another clip and a second run',
    'at 70 %; every link with captions also a "mid" run at 55 % whose first and last words touch their neighbours (no pause).',
    '',
    'Per link, <n>-<id>/:',
    '  exact-download.mp4   what Clip download fetched (the exact cut, --force-keyframes-at-cuts) and the clip plays',
    '  fast-download.mp4    the same range as Clip it’s fast cut: padded 10 s each side, copied — the words’ surroundings',
    '  clip-captions.mp4    the project exported with its captions on — WATCH AND LISTEN TO THIS ONE',
    '  clip-plain.mp4       the same export without captions (what the caption reading subtracts)',
    '  captions.ass         the subtitles libass burnt in (on eK71EN3P78U and lqOH-zxtCDE, Telugu and Hindi, the app draws',
    '                       the captions with the canvas bake instead; libass there is the failed bake’s fallback)',
    '  frames.csv           per export frame: ink, xor, change (what onsets are read by), what the .ass says the frame is,',
    '                       whether an onset was read, which word starts there',
    '  onset.png            the export frame where the middle word is lit — where the glyphs are judged',
    '  README.txt           the runs’ words (to read while listening) and every reading',
    '  second-*             O35KGzkS4VA and eK71EN3P78U: the second run, and the project after Add another clip (both clips) exported',
    '  mid-*                the run with hard edges: LISTEN TO mid-exact-download.mp4’s first and last word for a neighbour’s sliver',
    '  panel.html           the two no-caption links: the URL tile as the store left it',
    'summary.json           the per-link numbers, no words; a partial run replaces only its own links’ rows',
    '',
    ...runInfo,
    '',
    ...rows.flatMap((r) => {
      const lines = Array.isArray(r.top) ? (r.top as string[]) : [`- ${String(r.n)}. ${String(r.id)}: (from an earlier run, before these notes were kept per link)`]
      return [...lines.map((l, i) => (i === 0 ? `${l}   [run ${String(r.ranAt ?? 'earlier')}]` : l))]
    })
  ])
})

/* ----------------------------------------------------------------- tests */

describe.skipIf(!ENABLED)('M0’s exit check on the user’s ten links (docs/CLIPS.md §3b.9)', () => {
  for (const spec of CHOSEN) {
    const tag = `${spec.n}. ${spec.id}`

    it(`${tag}: Get transcript`, async () => {
      const linkDir = join(OUT, `${spec.n}-${spec.id}`)
      await mkdir(linkDir, { recursive: true })
      state().newProject()
      state().setIngest({ url: spec.url })
      const t0 = Date.now()
      await state().getTranscript()
      let source = state().urlSource!
      const metaAnswer = [...asked.meta.values()].at(-1)
      const notes: string[] = [`# ${tag}`, '', `link as given: ${spec.url}`]
      const row: Record<string, unknown> = { n: spec.n, id: spec.id, ranAt: RAN_AT }
      const top: string[] = []
      row.top = top
      summary.push(row)

      if (!spec.captions) {
        // No caption track of any kind: the app says so at once, with From, To and Listen to it — no language asked.
        const first = { status: source.status, language: source.meta?.language ?? null, hasCaptions: source.meta?.hasCaptions ?? null }
        const fetchedFirst = asked.captions.has(source.url)
        /*
         * The URL tile as the store left it. The start and end fields are
         * sheet 12's, behind "Just a part of it" (off in a new session), so
         * the tile is read twice: as it opens, and with that pressed — the
         * toggle's own onClick, `setIngest({ useRange: !useRange })`.
         */
        const tile = (): string => renderToStaticMarkup(createElement(IngestPanel!))
        const opened = tile()
        const rangeWasOn = state().ingest.useRange
        state().setIngest({ useRange: !rangeWasOn })
        const panel = tile()
        state().setIngest({ useRange: rangeWasOn })
        await writeFile(join(linkDir, 'panel.html'), `<!-- as it opens -->\n${opened}\n<!-- with "Just a part of it" pressed -->\n${panel}\n`)
        const shows = {
          noCaptions: panel.includes('This video has no captions'),
          rangeToggle: opened.includes('Just a part of it') && !rangeWasOn,
          from: panel.includes('aria-label="From — minutes and seconds"'),
          to: panel.includes('aria-label="To — minutes and seconds"'),
          listenGreyed: /<button type="button" disabled="" title="[^"]*"[^>]*>(?:(?!<\/button>).)*Listen to it<\/button>/.test(panel),
          needsHelper: panel.includes('needs the AI helper'),
          askedLanguage: opened.includes('Choose the language') || panel.includes('Choose the language')
        }
        const fieldsAtOnce = opened.includes('aria-label="From — minutes and seconds"')
        // And a language picked by hand finds none either: the flag is yt-dlp's word, checked against a real fetch.
        await state().getTranscript('en')
        source = state().urlSource!
        const fetched = [...asked.captions.values()].at(-1)
        Object.assign(row, {
          language: first.language,
          hasCaptions: first.hasCaptions,
          statusAtOnce: first.status,
          captionsFetchedAtOnce: fetchedFirst,
          panel: shows,
          fieldsWithoutPressing: fieldsAtOnce,
          statusWithEn: source.status,
          keysAsked: fetched?.fetch.keys ?? null,
          tracks: source.tracks,
          ms: Date.now() - t0
        })
        notes.push(
          `meta: duration ${source.meta?.duration} s, language ${first.language}, any caption track ${first.hasCaptions}, chapters ${source.meta?.chapters.length}`,
          `getTranscript(): status '${first.status}' (no caption fetch: ${!fetchedFirst}); the URL tile, rendered from that state (panel.html): ${JSON.stringify(shows)}; ` +
            `the start and end fields ${fieldsAtOnce ? 'are open at once' : 'are behind "Just a part of it", as for any link'}`,
          `getTranscript('en') as a cross-check: keys asked ${JSON.stringify(fetched?.fetch.keys)}, tracks ${JSON.stringify(source.tracks)}, status '${source.status}'`
        )
        links.set(spec.id, { spec, dir: linkDir, meta: source.meta!, fetch: fetched?.fetch ?? null, fetchMs: Date.now() - t0, transcript: null, legs: [], notes, row, top })
        top.push(`- ${tag}: no captions — getTranscript() '${first.status}' at once (language ${first.language}, any track ${first.hasCaptions}); panel ${JSON.stringify(shows)}; getTranscript('en') '${source.status}', tracks ${source.tracks.length}`)
        expect(first.language, 'no language in the metadata').toBeNull()
        expect(first.hasCaptions, 'yt-dlp lists no caption track of either kind').toBe(false)
        expect(first.status, '"This video has no captions", at once').toBe('none')
        expect(fetchedFirst, 'nothing to fetch, so no caption fetch').toBe(false)
        expect(shows, 'the URL tile: the notice, From and To (behind "Just a part of it"), Listen to it greyed without the helper, no language asked').toEqual({
          noCaptions: true, rangeToggle: true, from: true, to: true, listenGreyed: true, needsHelper: true, askedLanguage: false
        })
        expect(source.tracks, 'no caption track in English either').toEqual([])
        expect(source.status, 'and still "This video has no captions"').toBe('none')
        return
      }

      const meta = source.meta!
      const answered = asked.captions.get(source.url)
      if (source.status !== 'ready' || !answered) {
        // The app's own failure, said in the panel: recorded, and the test fails on it below.
        const failed = source.error ?? `status '${source.status}'`
        Object.assign(row, { durationS: meta?.duration ?? null, language: meta?.language ?? null, status: source.status, failed, keysAsked: captionKeys(meta?.language) })
        notes.push(
          `meta: duration ${meta?.duration} s, language ${meta?.language}, chapters ${meta?.chapters.length}`,
          `Get transcript FAILED in the app: status '${source.status}', "${failed}" (keys ${JSON.stringify(captionKeys(meta?.language))}), after ${Date.now() - t0} ms`
        )
        top.push(`- ${tag}: Get transcript FAILED — status '${source.status}', "${failed}" (keys ${JSON.stringify(captionKeys(meta?.language))})`)
        links.set(spec.id, { spec, dir: linkDir, meta, fetch: null, fetchMs: Date.now() - t0, transcript: null, legs: [], failed, notes, row, top })
        expect(source.status, `Get transcript: "${failed}"`).toBe('ready')
      }
      const fetched = answered!
      const t = source.transcript
      const rows = t ? rowsOf(t) : []
      const chapterRuns = t ? meta.chapters.map((ch) => runOfChapter(t, ch)) : []
      const sources = await captionSources(spec.url, fetched.fetch.keys).catch((e: unknown) => ({ error: String(e) }))
      Object.assign(row, {
        durationS: meta.duration,
        language: meta.language,
        hasCaptions: meta.hasCaptions ?? null,
        channel: meta.channel !== null,
        webpageUrl: meta.webpage_url !== null,
        chapters: meta.chapters.length,
        chapterRuns: chapterRuns.filter((r) => r !== null).length,
        keysAsked: fetched.fetch.keys,
        tracks: source.tracks,
        keySources: sources,
        words: t?.words.length ?? 0,
        segments: t?.segments.length ?? 0,
        rows: rows.length,
        approximate: t?.approximate ?? false,
        model: t?.model ?? null,
        shapingSensitiveWords: t ? shapingSensitive(t.words.map((w) => w.text)) : 0,
        fetchMs: Date.now() - t0,
        metaMs: metaAnswer?.ms ?? null,
        captionsMs: fetched.ms
      })
      notes.push(
        `meta: duration ${meta.duration} s, language ${meta.language}, any caption track ${meta.hasCaptions}, channel ${meta.channel ? 'present' : 'ABSENT'}, webpage_url ${meta.webpage_url ? 'present' : 'ABSENT'}, chapters ${meta.chapters.length}`,
        `keys asked ${JSON.stringify(fetched.fetch.keys)} (captionKeys(${JSON.stringify(meta.language)}) = ${JSON.stringify(captionKeys(meta.language))}); tracks ${JSON.stringify(source.tracks)}`,
        `where each key comes from (a simulate run just after; lang → tlang): ${JSON.stringify(sources)}`,
        `transcript: ${t?.words.length ?? 0} words (${row.shapingSensitiveWords as number} need complex shaping), ${t?.segments.length ?? 0} segments, ${rows.length} rows, model ${t?.model}${t?.approximate ? ', approximate' : ''}`,
        `Get transcript took ${Date.now() - t0} ms (metadata ${metaAnswer?.ms ?? '?'} ms, captions ${fetched.ms} ms)`,
        `chapters with a run (runOfChapter): ${chapterRuns.filter((r) => r !== null).length} of ${meta.chapters.length}` +
          (chapterRuns.some((r) => r === null) ? ` — none for chapter(s) ${chapterRuns.flatMap((r, i) => (r === null ? [i + 1] : [])).join(', ')}` : '')
      )
      top.push(
        `- ${tag}: ${meta.language}, ${Math.round(meta.duration ?? 0)} s, tracks ${source.tracks.map((x) => `${x.key}:${x.kind}`).join(' ')}, ` +
          `${t?.words.length ?? 0} words, ${rows.length} rows, chapters ${chapterRuns.filter((r) => r !== null).length}/${meta.chapters.length}, Get transcript ${Date.now() - t0} ms; ` +
          `key sources ${Object.entries(sources).map(([k, v]) => (typeof v === 'object' && v ? `${k}=${(v as { lang: string | null }).lang}${(v as { tlang: string | null }).tlang ? `→${(v as { tlang: string | null }).tlang}` : ''}` : `${k}=?`)).join(' ')}`
      )
      links.set(spec.id, { spec, dir: linkDir, meta, fetch: fetched.fetch, fetchMs: Date.now() - t0, transcript: t, legs: [], notes, row, top })

      /*
       * The uploader's track the keys never ask for (jze_5hvaVV8): fetched
       * here OUTSIDE the app's path, by main's own runCaptions with that key
       * named, into a folder of its own — to measure what the app leaves out.
       */
      if ('uploaderKey' in spec && t) {
        const leftDir = join(userData, 'leftover', spec.id)
        await rm(leftDir, { recursive: true, force: true })
        const extra = await runCaptions(spec.url, [spec.uploaderKey], ytTool(), { dir: leftDir })
        const reads = await Promise.all(
          [...fetched.fetch.tracks, ...extra.tracks].map(async (x) => {
            const json: unknown = JSON.parse(await readFile(x.path, 'utf8'))
            return { key: x.key, kind: json3Kind(json) ?? x.kind, json }
          })
        )
        const merged = transcriptFromTracks(reads, 'leftover', 'en')
        const ending = (ws: readonly Word[]): number => ws.filter((w) => /[.!?…]$/.test(w.text)).length
        const uploaderOnly = extra.transcript
        const leftover = {
          uploaderTracks: extra.tracks.map((x) => ({ key: x.key, kind: x.kind })),
          uploaderWords: uploaderOnly?.words.length ?? 0,
          uploaderSentenceEnds: uploaderOnly ? ending(uploaderOnly.words) : 0,
          asrWords: t.words.length,
          asrSentenceEnds: ending(t.words),
          asrRows: rows.length,
          mergedModel: merged?.model ?? null,
          mergedWords: merged?.words.length ?? 0,
          mergedSentenceEnds: merged ? ending(merged.words) : 0,
          mergedRows: merged ? rowsOf(merged).length : 0,
          mergedApproximate: merged?.approximate ?? false
        }
        row.leftover = leftover
        notes.push(`LEFTOVER (measured outside the app's path): ${JSON.stringify(leftover)}`)
        top.push(`  - ${spec.id}'s uploader track ${spec.uploaderKey}, which the app never asks for: ${JSON.stringify(leftover)}`)
      }

      expect.soft(meta.channel, 'channel').not.toBeNull()
      expect.soft(meta.webpage_url, 'webpage_url').not.toBeNull()
      expect.soft(meta.hasCaptions, 'yt-dlp lists a caption track').toBe(true)
      expect.soft(fetched.fetch.keys, 'the keys asked').toEqual(captionKeys(meta.language))
      expect(source.status, `the transcript (${source.error ?? 'no error'})`).toBe('ready')
      expect(t!.words.length).toBeGreaterThan(0)
      expect(source.tracks.length).toBeGreaterThan(0)
      expect.soft(chapterRuns.filter((r) => r !== null).length, 'a run for every chapter').toBe(meta.chapters.length)
    }, 300_000)

    if (!spec.captions) continue

    it(`${tag}: Clip download — the run lands as a clip with exactly its words, the original audio, the credit`, async () => {
      const s = need(spec.id)
      const t = s.transcript!
      state().newProject()
      const targetMs = 'atMs' in spec ? spec.atMs : Math.round((s.meta.duration ?? 0) * 1000 * RUN_AT)
      const picked = pickRun(t, targetMs)
      expect(picked, `a row at or after ${targetMs} ms`).not.toBeNull()
      const leg = legOf(t, 'first', picked!, targetMs)
      s.legs.push(leg)
      state().setUrlRun(leg.picked.run)
      await landLeg(s, leg)
      s.project = state().project

      if ('second' in spec) {
        // Add another clip: the rows stay, the run is cleared — and with no run, Clip download starts nothing.
        const before = s.project
        const rowsBefore = state().urlSource!.transcript
        const runBefore = state().urlSource!.run
        const jobsBefore = jobSeq
        const assetsBefore = state().project.assets.length
        state().addAnotherClip()
        const after = state().urlSource!
        await state().clipItFromLink()
        const startedWithNoRun = jobSeq - jobsBefore
        const landedWithNoRun = state().project.assets.length - assetsBefore
        s.notes.push(
          '',
          `Add another clip: the run ${JSON.stringify(runBefore)} became ${JSON.stringify(after.run)}; the rows ${after.transcript === rowsBefore ? 'kept' : 'REPLACED'}; ` +
            `Clip download then started ${startedWithNoRun} job(s) and placed ${landedWithNoRun} asset(s)`
        )
        expect(after.run, 'Add another clip clears the run').toBeNull()
        expect(after.transcript, 'and keeps the rows').toBe(rowsBefore)
        expect(startedWithNoRun, 'Clip download with no run picked starts nothing').toBe(0)
        expect(landedWithNoRun, 'and places nothing').toBe(0)

        const target2 = Math.round((s.meta.duration ?? 0) * 1000 * SECOND_RUN_AT)
        const picked2 = pickRun(t, target2)
        expect(picked2).not.toBeNull()
        const leg2 = legOf(t, 'second', picked2!, target2)
        s.legs.push(leg2)
        state().setUrlRun(leg2.picked.run)
        await landLeg(s, leg2)
        s.both = state().project
        const first = before.assets[0]
        // The first clip untouched: its asset, its clip, its words.
        expect.soft(s.both.assets[0], 'the first asset untouched').toEqual(first)
        expect.soft(s.both.clips.find((c) => c.assetId === first.id), 'the first clip untouched').toEqual(before.clips[0])
        expect.soft(s.both.transcripts[first.id], 'the first clip’s words untouched').toEqual(before.transcripts[first.id])
        expect.soft(s.both.clips, 'two clips').toHaveLength(2)
        const second = s.both.assets[1]
        expect.soft(s.both.transcripts[second.id].words.map((w) => w.text), 'the second clip holds only the second run’s words').toEqual(leg2.words.map((w) => w.text))
        s.notes.push(`second run at ${SECOND_RUN_AT * 100} % (${fmtMs(target2)}); the first clip, asset and words unchanged after it.`)
      }
    }, 900_000)

    it(`${tag}: Clip download, mid-row — a run whose first and last words touch their neighbours`, async () => {
      const s = need(spec.id)
      const t = s.transcript!
      state().newProject()
      const targetMs = Math.round((s.meta.duration ?? 0) * 1000 * MID_RUN_AT)
      const picked = pickMidRun(t, targetMs)
      if (!picked) {
        s.notes.push('', `## mid run: none — no word after ${fmtMs(targetMs)} starts where the one before ends, with a hard end 8–20 words on`)
        s.top.push(`  - ${spec.id} mid: no hard-edged run after ${fmtMs(targetMs)}`)
      }
      expect(picked, `a run with hard edges after ${targetMs} ms`).not.toBeNull()
      const leg = legOf(t, 'mid', picked!, targetMs)
      s.legs.push(leg)
      state().setUrlRun(leg.picked.run)
      await landLeg(s, leg)
    }, 900_000)

    it(`${tag}: exact against fast — the first frame and the sound`, async () => {
      const s = need(spec.id)
      expect(s.legs.length, 'a clip landed').toBeGreaterThan(0)
      // Every leg is read even when one's download fails; the failures are said together at the end.
      const failed: string[] = []
      for (const leg of s.legs) {
        if (!leg.exact) continue
        await fastLeg(s, leg).catch((err: unknown) => failed.push(`${leg.name}: ${err instanceof Error ? err.message : String(err)}`))
      }
      expect(failed, `${spec.id}: fast cuts that failed`).toEqual([])
    }, 1_200_000)

    it(`${tag}: exported with captions — one Dialogue per word of the run, each word's caption within a frame`, async () => {
      const s = need(spec.id)
      expect(s.project, 'the clip landed').toBeDefined()
      const firstLegs = s.legs.filter((l) => l.name === 'first')
      const outs: [Project, Leg[], string][] = [[s.project!, firstLegs, '']]
      if (s.both) outs.push([s.both, s.legs.filter((l) => l.name === 'first' || l.name === 'second'), 'second-'])
      const failures: (() => void)[] = []
      for (const [project, legs, prefix] of outs) {
        const r = await exportAndRead(project, legs, s.dir, prefix, indicLink(spec))
        if (indicLink(spec)) {
          s.notes.push(
            '',
            `## ${prefix}export: the app draws this track with the canvas bake (its words are Devanagari or Telugu, docs/CLIPS.md §16.66 (a)); ` +
              'this export is libass, the failed bake’s fallback, and the readings below are of it'
          )
        }
        const off = r.match.offsets.map((o) => (o === null ? 'NONE' : `${o >= 0 ? '+' : ''}${o}`))
        const fl = r.floor
        const onTime = r.match.offsets.filter((o, i) => o !== null && r.wordFrames[i] + o === r.assFrames[i]).length
        const reading = {
          canvas: r.canvas,
          exportFrames: r.frames,
          dialogues: r.events.length,
          words: r.expected.length,
          assMaxEarlyMs: Math.max(...r.expected.map((w, i) => Math.round(w.ms) - (r.events[i]?.startMs ?? Number.NaN))),
          onsetsSeen: r.onsets.onsets.length,
          linesSeen: r.onsets.lines.length,
          within: r.match.within,
          offsets: r.match.offsets,
          extraOnsets: r.match.extra,
          onTheFrameLibassDraws: onTime,
          inkThreshold: Math.round(r.onsets.inkThreshold),
          changeThreshold: Math.round(r.onsets.changeThreshold),
          floor: fl,
          xorFloor: r.xorFloor,
          shapingSensitiveWords: shapingSensitive(r.expected.map((w) => w.text)),
          pngFrame: r.png.frame
        }
        s.row[`${prefix || 'first-'}export`] = reading
        s.notes.push(
          '',
          `## export${prefix ? ' after Add another clip (both clips)' : ''}: ${prefix}clip-captions.mp4, ${r.frames} frames at ${project.settings.fps} fps, ${r.canvas.width}×${r.canvas.height}`,
          `.ass: ${r.events.length} Dialogues for the run's ${r.expected.length} words; each Dialogue's start is its word's own time on the timeline rounded and floored to the centisecond, ` +
            `0–${reading.assMaxEarlyMs} ms early; ${reading.shapingSensitiveWords} of the words need complex shaping (a conjunct or a pre-base vowel sign)`,
          `picture: ink threshold ${reading.inkThreshold} px, change threshold ${reading.changeThreshold} px (from the counts alone); ` +
            `${r.onsets.onsets.length} onsets read (lines at ${r.onsets.lines.join(', ') || 'none'}); onsets no word took: ${r.match.extra.join(', ') || 'none'}`,
          `noise floor (by the .ass): blank frames ${fl.blankFrames}, their most ink ${fl.blankMaxInk ?? '—'}; captioned frames' least ink ${fl.captionedMinInk ?? '—'}; ` +
            `held frames ${fl.heldFrames}, their most change ${fl.heldMaxChange ?? '—'}; ${fl.onsetFrames} onsets, their least change ${fl.onsetMinChange ?? '—'} ` +
            `(the mask's XOR instead, which the footage moves too: held at most ${r.xorFloor.heldMaxChange ?? '—'}, onsets at least ${r.xorFloor.onsetMinChange ?? '—'})`,
          `words with an onset of their own within a frame: ${r.match.within} of ${r.expected.length}; on the very frame libass should first draw its Dialogue: ${onTime}; ` +
            `per word (onset − word frame): ${off.join(' ')}`,
          `${prefix}onset.png: frame ${r.png.frame}, the middle word lit`,
          '',
          'word | its ms on the export | its frame | Dialogue start | libass draws it from | onset taken',
          ...r.expected.map((w, i) => `${w.text} | ${w.ms.toFixed(1)} | ${r.wordFrames[i]} | ${r.events[i]?.startMs ?? '—'} | ${r.assFrames[i]} | ${off[i]}`)
        )
        s.top.push(
          `  - ${spec.id} ${prefix || ''}export ${r.canvas.width}×${r.canvas.height}: ${r.events.length} Dialogues / ${r.expected.length} run words (≤ ${reading.assMaxEarlyMs} ms early), ` +
            `onsets one-to-one within a frame ${r.match.within}/${r.expected.length}, on libass's frame ${onTime}, extra ${r.match.extra.length}; ` +
            `thresholds ink ${reading.inkThreshold} change ${reading.changeThreshold}; floor: blank max ink ${fl.blankMaxInk ?? '—'}, captioned min ink ${fl.captionedMinInk ?? '—'}, ` +
            `held max change ${fl.heldMaxChange ?? '—'}, onset min change ${fl.onsetMinChange ?? '—'}`
        )
        failures.push(() => {
          expect.soft(r.match.within, `${spec.id} ${prefix}: words whose caption starts within a frame of them, each its own onset (offsets ${off.join(' ')})`).toBe(r.expected.length)
          expect.soft(r.match.extra, `${spec.id} ${prefix}: onsets no word took`).toEqual([])
          assertAss(spec.id, prefix, r)
        })
      }
      for (const f of failures) f()
    }, 900_000)
  }
})

/**
 * One Clip download, landed and checked: the job, the request, the collected
 * words and credit, the notices — and the audio yt-dlp picked, read off the
 * file where there were dubs to pick from, the file, the placed clip's
 * length against the range's. Everything is written down before the hard
 * assertions run.
 */
async function landLeg(s: LinkState, leg: Leg): Promise<void> {
  const id = s.spec.id
  const t = s.transcript!
  expect(state().urlSource?.transcript, 'the run is picked in the transcript on screen').toBe(t)
  expect(state().urlSource?.run, 'the run set is the picked one').toEqual(leg.picked.run)
  const fps = state().project.settings.fps
  const noticesBefore = lastNotice()
  const { jobId, job, asset } = await clipDownload(s, leg)
  leg.exact = { jobId, asset, file: join(s.dir, `${leg.prefix}exact-download.mp4`) }
  await copyFile(asset.path, leg.exact.file)
  const project = state().project
  const clip = project.clips.find((c) => c.assetId === asset.id)!
  const collected = project.transcripts[asset.id]
  const info = await probeFile(asset.path)
  const frames = await countFrames(asset.path)
  const outcome = entries.get(jobId)!.outcome!
  // Every notice the leg raised, by id — not by its wording: a collect's error reaches the panel as whatever its
  // message was, and "landed without its words" is said as info. A clip that lands as it should says nothing.
  const notices = state().notices.filter((n) => n.id > noticesBefore).map((n) => `${n.tone}: ${n.text}`)
  const runs = await runsFor(job.request)
  const pick = await formatPick(job.request)
  const sections = pick.argv.filter((a) => a === '--download-sections').length
  const section = pick.argv[pick.argv.indexOf('--download-sections') + 1]
  // A video-only and an audio-only format, as YouTube serves 1080p (EFFECTS.md §41).
  const audio = pick.requested.find((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none')
  const video = pick.requested.find((f) => f.vcodec && f.vcodec !== 'none')
  const languages = [...new Set(pick.audio.map((f) => f.language ?? null))]
  const dubbed = languages.length > 1
  const primary = (l: string | null | undefined): string => (l ?? '').split('-')[0].toLowerCase()

  // The pin read off the file: the original track's own section against the clip's sound (and a dub's, once, for the contrast).
  const originals = pick.audio.filter((f) => f.language_preference === 10)
  const original = dubbed ? (originals.find((f) => f.format_id === audio?.format_id) ?? originals.find((f) => /mp4a/.test(f.acodec ?? '')) ?? originals[0]) : undefined
  const dub = dubbed && leg.name === 'first' ? pick.audio.find((f) => primary(f.language) !== primary(s.meta.language) && /mp4a/.test(f.acodec ?? '')) : undefined
  const pinned = original ? await sectionOf(s, leg, original, 'original').catch((e: unknown) => ({ error: String(e) })) : null
  const contrast = dub ? await sectionOf(s, leg, dub, 'dub').catch((e: unknown) => ({ error: String(e) })) : null

  const tag = await audioTag(asset.path)
  const spans = await streamSpans(asset.path)
  const rangeMs = leg.range.endMs - leg.range.startMs
  const rangeFrames = Math.round((rangeMs * fps) / 1000)
  const lengthMs = info.durationMs ?? 0
  const words = collected?.words ?? []
  // The run's edges against the words around it, from the transcript — not from `runRange`, which made the range.
  const prev = t.words[leg.picked.run.from - 1]
  const next = t.words[leg.picked.run.to + 1]
  const edges = {
    gapBeforeMs: prev ? leg.words[0].startMs - prev.endMs : null,
    startMarginMs: prev ? leg.range.startMs - prev.endMs : null,
    gapAfterMs: next ? next.startMs - leg.words.at(-1)!.endMs : null,
    endMarginMs: next ? next.startMs - leg.range.endMs : null
  }
  const shaping = shapingSensitive(leg.words.map((w) => w.text))

  const reading = {
    run: { from: leg.picked.run.from, to: leg.picked.run.to, words: leg.words.length, row: leg.picked.firstRow, rowsTaken: leg.picked.rows },
    targetMs: leg.targetMs,
    range: leg.range,
    rangeMs,
    edges,
    shapingSensitiveWords: shaping,
    section,
    sections,
    downloadMs: job.ms,
    ytdlpRuns: runs,
    cached: outcome.cached,
    size: info.size,
    file: { frames, fps: info.fps, width: info.width, height: info.height, vcodec: info.videoCodec, acodec: info.audioCodec, durationMs: info.durationMs },
    streams: spans,
    asset: { durationFrames: asset.durationFrames, rangeFrames, diff: asset.durationFrames - rangeFrames },
    clip: { start: clip.start, inPoint: clip.inPoint, duration: clip.duration, minusRange: clip.duration - rangeFrames },
    formats: { video: video?.format_id ?? null, videoNote: video?.format_note ?? null, audio: audio?.format_id ?? null },
    audio: { language: audio?.language ?? null, preference: audio?.language_preference ?? null, note: audio?.format_note ?? null, tag, tracksOnOffer: languages.length, languages, dubbed },
    pinnedFromFile: pinned,
    dubContrast: contrast,
    ytdlpWarnings: pick.warnings,
    notices,
    collected: { words: words.length, firstStartMs: words[0]?.startMs ?? null, lastEndMs: words.at(-1)?.endMs ?? null },
    credit: { source: asset.credit?.source ?? null, author: asset.credit?.author != null, pageUrl: asset.credit?.pageUrl ?? null }
  }
  s.row[`${leg.name}Clip`] = reading
  const pinText = (p: typeof pinned): string =>
    !p ? '—' : 'error' in p ? `FAILED (${p.error.slice(0, 160)})` : `${p.formatId} ${p.language} "${p.note}": corr ${p.corr} at ${p.lagMs} ms${p.tries > 1 ? ` (${p.tries} tries)` : ''}`
  s.notes.push(
    '',
    `## ${leg.name} run (${leg.prefix}exact-download.mp4)`,
    leg.name === 'mid'
      ? `rule: the first word at or after ${fmtMs(leg.targetMs)}, not a row's first, that the word before runs straight into, and the first word 8–20 on that the next follows at once: ` +
        `words ${leg.picked.run.from}–${leg.picked.run.to} (${leg.words.length}), ${fmtMs(leg.range.startMs)} → ${fmtMs(leg.range.endMs)} (${rangeMs} ms)`
      : `rule: first row at or after ${fmtMs(leg.targetMs)} (row ${leg.picked.firstRow}), ${leg.picked.rows} row(s) taken, ${RUN_MIN_WORDS}–${RUN_MAX_WORDS} words: ` +
        `words ${leg.picked.run.from}–${leg.picked.run.to} (${leg.words.length}), ${fmtMs(leg.range.startMs)} → ${fmtMs(leg.range.endMs)} (${rangeMs} ms)`,
    `THE RUN'S WORDS: ${leg.words.map((w) => w.text).join(' ')}`,
    `edges, from the transcript: the word before ends ${edges.gapBeforeMs ?? '—'} ms before the run's first (the range starts ${edges.startMarginMs ?? '—'} ms after it); ` +
      `the next starts ${edges.gapAfterMs ?? '—'} ms after the run's last word's estimated end (the range ends ${edges.endMarginMs ?? '—'} ms before it); ` +
      `${shaping} of the run's words need complex shaping`,
    `download: --download-sections ${section} (${sections} in the argv), ${job.ms ?? '?'} ms${outcome.cached ? ' (CACHED)' : ''}, ${info.size} bytes, yt-dlp run ${runs} time(s)`,
    `file: ${frames} frames, ${info.fps} fps, ${info.width}×${info.height}, ${info.videoCodec}/${info.audioCodec}, ${info.durationMs} ms; ` +
      `asset ${asset.durationFrames} frames at ${fps} against the range's ${rangeFrames} (${reading.asset.diff >= 0 ? '+' : ''}${reading.asset.diff}); ` +
      `streams: sound ${spans.audio?.startMs}+${spans.audio?.ms} ms, picture ${spans.video?.startMs}+${spans.video?.ms} ms, against the range's ${rangeMs}`,
    `formats: video ${video?.format_id} (${video?.format_note}), audio ${audio?.format_id} — language ${audio?.language ?? 'none'}, preference ${audio?.language_preference}, "${audio?.format_note}"; ` +
      `${languages.length} audio language(s) on offer${dubbed ? ` (${languages.join(', ')})` : ''}; the file's audio tag ${tag ?? 'none'}`,
    `the audio read off the file: the original's own section ${pinText(pinned)}; a dub's ${pinText(contrast)}`,
    ...(pick.warnings.length ? [`yt-dlp warned: ${pick.warnings.join(' | ')}`] : []),
    `clip: start ${clip.start}, in-point ${clip.inPoint}, ${clip.duration} frames (range ${rangeFrames}); collected ${words.length} words, the first at ${words[0]?.startMs} ms, the last ending ${words.at(-1)?.endMs} ms (file ${lengthMs} ms)`,
    `credit: source ${asset.credit?.source}, author ${asset.credit?.author ? 'present' : 'ABSENT'}, page ${asset.credit?.pageUrl}; notices ${notices.length}`
  )
  s.top.push(
    `  - ${id} ${leg.name}: ${leg.words.length} words, ${rangeMs} ms, edges ${edges.startMarginMs ?? '—'}/${edges.endMarginMs ?? '—'} ms, section ${section}, ${job.ms ?? '?'} ms in ${runs} run(s), ${frames} frames @ ${info.fps} fps, ` +
      `clip − range ${clip.duration - rangeFrames} frames, sound ${spans.audio?.startMs}+${spans.audio?.ms} ms, audio ${audio?.format_id} ${audio?.language ?? '-'} pref ${audio?.language_preference} of ${languages.length} language(s); ` +
      `from the file: original ${pinText(pinned)}${contrast ? `, dub ${pinText(contrast)}` : ''}`
  )

  // The checks.
  expect.soft(job.request.exact, `${id} ${leg.name}: Clip download is exact`).toBe(true)
  expect.soft(job.request.range, `${id} ${leg.name}: the request's range is the run's`).toEqual(leg.range)
  expect.soft(sections, `${id} ${leg.name}: one --download-sections`).toBe(1)
  // Nothing outside the run, from the transcript: the range lies inside the gaps to the words around it.
  if (prev) expect.soft(leg.range.startMs, `${id} ${leg.name}: the range starts no earlier than the word before ends`).toBeGreaterThanOrEqual(prev.endMs)
  if (next) expect.soft(leg.range.endMs, `${id} ${leg.name}: the range ends no later than the next word starts`).toBeLessThanOrEqual(next.startMs)
  if (leg.name === 'mid') {
    expect.soft(edges.gapBeforeMs, `${id} mid: no pause before the run`).toBe(0)
    expect.soft(edges.gapAfterMs, `${id} mid: no pause after it`).toBe(0)
  }
  expect.soft(words.map((w) => w.text), `${id} ${leg.name}: exactly the run's words, in order`).toEqual(leg.words.map((w) => w.text))
  // Every word's start and end on the file's clock: the link's, less the range's start.
  expect.soft(
    words.map((w) => [w.startMs, w.endMs]),
    `${id} ${leg.name}: each word where the run had it, on the file's clock`
  ).toEqual(leg.words.map((w) => [w.startMs - leg.range.startMs, w.endMs - leg.range.startMs]))
  expect.soft(words.at(-1)?.endMs ?? Number.NaN, `${id} ${leg.name}: the last word ends inside the file (${lengthMs} ms)`).toBeLessThanOrEqual(lengthMs)
  // Nothing outside the run in the SOUND: the audio stream is the range, to the ms (the picture may hold its last frame a little longer).
  expect.soft(spans.audio?.startMs, `${id} ${leg.name}: the sound starts at the file's 0`).toBe(0)
  expect.soft((spans.audio?.startMs ?? 0) + (spans.audio?.ms ?? Number.NaN), `${id} ${leg.name}: no sound past the run's range (${rangeMs} ms)`).toBeLessThanOrEqual(rangeMs + 1)
  // The placed clip is the range: measured 0 to +2 frames longer (the picture's last frame held).
  expect.soft(clip.duration, `${id} ${leg.name}: the clip at least the range (${rangeFrames} frames)`).toBeGreaterThanOrEqual(rangeFrames)
  expect.soft(clip.duration, `${id} ${leg.name}: the clip at most two frames past the range`).toBeLessThanOrEqual(rangeFrames + 2)
  expect.soft(clip.inPoint, `${id} ${leg.name}: in-point`).toBe(0)
  expect.soft(asset.credit?.source, `${id} ${leg.name}: credit source`).toBe('link')
  expect.soft(asset.credit?.author, `${id} ${leg.name}: credit channel`).toBeTruthy()
  expect.soft(asset.credit?.pageUrl, `${id} ${leg.name}: credit page`).toBe(s.meta.webpage_url)
  expect.soft(notices, `${id} ${leg.name}: no notice at all`).toEqual([])
  // The audio is the video's own: yt-dlp's list was read, the pick is an audio format in the video's language,
  // and where there are dubs it is YouTube's "original" — and the file's sound is that track's.
  expect.soft(pick.audio.length, `${id} ${leg.name}: yt-dlp listed the audio formats`).toBeGreaterThan(0)
  expect.soft(audio, `${id} ${leg.name}: an audio format was picked`).toBeDefined()
  expect.soft(primary(audio?.language), `${id} ${leg.name}: in the video's language`).toBe(primary(s.meta.language))
  expect.soft(languages.length === 1 || audio?.language_preference === 10, `${id} ${leg.name}: one language on offer, or the original (${audio?.format_note})`).toBe(true)
  if (dubbed) {
    expect.soft(audio?.format_note ?? '', `${id} ${leg.name}: the original audio`).toMatch(/original/i)
    expect.soft(pinned && !('error' in pinned) ? pinned.corr : null, `${id} ${leg.name}: the clip's sound is the original track's (${pinText(pinned)})`).toBeGreaterThanOrEqual(0.9)
    if (contrast && !('error' in contrast)) expect.soft(contrast.corr, `${id} ${leg.name}: and not a dub's (${pinText(contrast)})`).toBeLessThan(0.5)
  }
}

/**
 * The same range fetched as Clip it's fast cut — `startIngest` with the
 * override clipItFromLink builds, `exact: false`, its head
 * `offsetIntoDownload` — collected into a project of its own; then the exact
 * clip's first frame and first 500 ms of sound found in it, and the sound's
 * level either side of each cut.
 */
async function fastLeg(s: LinkState, leg: Leg): Promise<void> {
  const id = s.spec.id
  if (!leg.exact) throw new Error(`${id} ${leg.name}: the exact clip did not land`)
  const source = state().urlSource!
  const t = s.transcript!
  expect(source.linkKey, 'the link on screen is this one').toBe(linkCacheKey(parseLink(s.spec.url)!))
  expect(source.transcript, 'and its transcript the one the run was picked in').toBe(t)
  state().newProject()
  const head = offsetIntoDownload(leg.range)
  const transcriptFrom: TranscriptFrom = {
    linkKey: source.linkKey,
    keys: source.tracks.map((track) => track.key),
    range: leg.range,
    run: leg.picked.run,
    headOffsetMs: head,
    words: runWords(t, leg.picked.run)
  }
  const credit = linkCredit(source.meta, source.url, source.fetchedAt ?? new Date().toISOString())
  const before = jobSeq
  await state().startIngest({ url: source.url, range: leg.range, exact: false, clip: { transcriptFrom, credit } })
  expect(jobSeq, `${id} ${leg.name} fast: one job`).toBe(before + 1)
  const jobId = `job-${jobSeq}`
  try {
    await downloads.get(jobId)
  } catch (err) {
    const message = `${err instanceof Error ? err.message : String(err)} (after ${await runsFor(jobs.get(jobId)!.request)} yt-dlp run(s))`
    const section = sectionPlan(leg.range, false).args[1]
    s.notes.push('', `## ${leg.name} run's fast cut: the download FAILED — ${message} (section ${section})`)
    s.row[`${leg.name}Fast`] = { failed: message, section }
    s.top.push(`  - ${id} ${leg.name} fast cut: download FAILED — ${message} (section ${section})`)
    throw err
  }
  await state().collectIngest(jobId)
  const project = state().project
  const asset = project.assets[0]
  leg.fast = { jobId, asset, file: join(s.dir, `${leg.prefix}fast-download.mp4`) }
  await copyFile(asset.path, leg.fast.file)
  const fps = project.settings.fps
  const clip = project.clips[0]
  const words = project.transcripts[asset.id]?.words ?? []
  const job = jobs.get(jobId)!
  const runs = await runsFor(job.request)
  const fastSpans = await streamSpans(leg.fast.file)

  // The picture: the exact clip's frame 0 among the padded file's frames where its own time says it is.
  const exactInfo = await probeFile(leg.exact.file)
  const [exactFirst] = await smallFrames(leg.exact.file, 1)
  const padded = await smallFrames(leg.fast.file)
  const match = matchFrame(exactFirst.data, padded, head + exactFirst.ptsMs)
  const oneFrameMs = 1000 / (exactInfo.fps ?? 30)
  // The sound: the exact clip's first 500 ms in the padded file's, ±1 s around the head.
  const fastPcm = await pcm(leg.fast.file)
  const lag = audioLag(await pcm(leg.exact.file), fastPcm, RATE, head)
  // The level either side of each cut, on the padded file: what the ear will hear at the clip's edges.
  const tail = head + (leg.range.endMs - leg.range.startMs)
  const levels = {
    beforeHead: levelDb(fastPcm, head - EDGE_MS, head),
    afterHead: levelDb(fastPcm, head, head + EDGE_MS),
    beforeTail: levelDb(fastPcm, tail - EDGE_MS, tail),
    afterTail: levelDb(fastPcm, tail, tail + EDGE_MS),
    clip: levelDb(fastPcm, head, tail)
  }
  const reading = {
    downloadMs: job.ms,
    ytdlpRuns: runs,
    cached: entries.get(jobId)!.outcome!.cached,
    size: (await stat(asset.path)).size,
    head,
    streams: fastSpans,
    clip: { inPoint: clip.inPoint, duration: clip.duration, expectedInPoint: Math.round((head / 1000) * fps) },
    collected: { words: words.length, firstStartMs: words[0]?.startMs ?? null },
    exactFirstPtsMs: exactFirst.ptsMs,
    paddedFirstPtsMs: padded[0]?.ptsMs ?? null,
    video: match && {
      offsetMs: Math.round(match.offsetMs * 10) / 10,
      mad: Math.round(match.mad * 100) / 100,
      secondOffsetMs: match.secondPtsMs === null ? null : Math.round((match.secondPtsMs - head - exactFirst.ptsMs) * 10) / 10,
      secondMad: match.secondMad === null ? null : Math.round(match.secondMad * 100) / 100,
      margin: Math.round(match.margin * 1000) / 1000,
      ambiguous: match.ambiguous,
      candidates: match.candidates
    },
    audio: { lagMs: Math.round(lag.lagMs * 100) / 100, corr: Math.round(lag.corr * 10000) / 10000, secondLagMs: lag.secondLagMs === null ? null : Math.round(lag.secondLagMs * 100) / 100, secondCorr: lag.secondCorr === null ? null : Math.round(lag.secondCorr * 10000) / 10000 },
    levelsDb: levels,
    oneFrameMs: Math.round(oneFrameMs * 100) / 100
  }
  s.row[`${leg.name}Fast`] = reading
  s.notes.push(
    '',
    `## ${leg.name} run's fast cut (${leg.prefix}fast-download.mp4): the exact clip against it`,
    `fast: ${job.ms ?? '?'} ms in ${runs} yt-dlp run(s)${reading.cached ? ' (CACHED)' : ''}, ${reading.size} bytes; its sound starts at ${fastSpans.audio?.startMs} ms; head ${head} ms; clip in-point ${clip.inPoint} (expected ${reading.clip.expectedInPoint}), ` +
      `${clip.duration} frames; collected ${words.length} words, the first at ${words[0]?.startMs} ms`,
    `the exact clip's first frame (its pts ${exactFirst.ptsMs} ms) is the padded file's frame at ${match ? fmtMs(match.bestPtsMs) : '—'}: ` +
      (match
        ? `${reading.video!.offsetMs >= 0 ? '+' : ''}${reading.video!.offsetMs} ms from head + its pts (MAD ${reading.video!.mad}; next best ${reading.video!.secondOffsetMs} ms at MAD ${reading.video!.secondMad}; ` +
          `margin ${(match.margin * 100).toFixed(1)} %${match.ambiguous ? ` — AMBIGUOUS, under ${AMBIGUOUS_BELOW * 100} %` : ''}; ${match.candidates} candidates); one source frame is ${reading.oneFrameMs} ms`
        : 'no frame within ±0.5 s'),
    `its first 500 ms of sound is the padded file's at ${reading.audio.lagMs >= 0 ? '+' : ''}${reading.audio.lagMs} ms from the head (corr ${reading.audio.corr}; ` +
      `the next peak ${reading.audio.secondLagMs} ms, corr ${reading.audio.secondCorr})`,
    `the sound either side of the cuts (RMS over ${EDGE_MS} ms, dBFS): before the head ${levels.beforeHead}, after it ${levels.afterHead}; ` +
      `before the tail ${levels.beforeTail}, after it ${levels.afterTail}; the clip as a whole ${levels.clip}`
  )
  s.top.push(
    `  - ${id} ${leg.name} exact vs fast: video ${match ? `${reading.video!.offsetMs} ms, margin ${(match.margin * 100).toFixed(1)} %${match.ambiguous ? ' (ambiguous)' : ''}` : 'no match'}; ` +
      `audio ${reading.audio.lagMs} ms (corr ${reading.audio.corr}); levels head ${levels.beforeHead}|${levels.afterHead} tail ${levels.beforeTail}|${levels.afterTail} dB; fast ${job.ms ?? '?'} ms in ${runs} run(s)`
  )

  expect.soft(words.map((w) => w.text), `${id} ${leg.name} fast: the run's words`).toEqual(leg.words.map((w) => w.text))
  expect.soft(
    words.map((w) => [w.startMs, w.endMs]),
    `${id} ${leg.name} fast: each word where the run had it, on the padded file's clock`
  ).toEqual(leg.words.map((w) => [w.startMs - leg.range.startMs + head, w.endMs - leg.range.startMs + head]))
  expect.soft(clip.inPoint, `${id} ${leg.name} fast: in-point at the head`).toBe(reading.clip.expectedInPoint)
  // Decoded sample positions are the file's clock only if its sound starts at 0.
  expect.soft(fastSpans.audio?.startMs, `${id} ${leg.name} fast: its sound starts at the file's 0`).toBe(0)
  expect.soft(match, `${id} ${leg.name}: a frame near where the exact clip's first frame should be`).not.toBeNull()
  if (match && !match.ambiguous) {
    expect.soft(Math.abs(match.offsetMs), `${id} ${leg.name}: the exact clip's first frame within a source frame of where its own time puts it (${match.offsetMs.toFixed(1)} ms)`).toBeLessThanOrEqual(oneFrameMs)
  }
  // §41: the exact cut's sound is sample-exact.
  expect.soft(Math.abs(lag.lagMs), `${id} ${leg.name}: the exact clip's sound starts where the fast cut's head is (${lag.lagMs.toFixed(2)} ms, corr ${lag.corr.toFixed(4)})`).toBeLessThanOrEqual(1)
}
