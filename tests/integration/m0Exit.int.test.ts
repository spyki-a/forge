import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { app } from 'electron'
import { LinkRuns, captionTrackHandler, captionsHandler, metaHandler, runCaptions } from '../../src/main/ingest/meta'
import { downloadMedia, downloadsDir, type IngestTool } from '../../src/main/ingest/download'
import { ensureYtDlp, type YtDlpTool } from '../../src/main/ingest/binary'
import { startRequest } from '../../src/main/ingest/start'
import { probeFile, probeMany } from '../../src/main/ffmpeg/probe'
import { FFMPEG_PATH } from '../../src/main/ffmpeg/paths'
import { toAsset } from '../../src/main/assets'
import { prepareCaptions } from '../../src/main/captions'
import { collectDownload, type IngestEntry } from '@shared/ingest/collect'
import { buildYtDlpArgs, captionKeys, outputStem, type IngestRequest, type LinkMeta } from '@shared/ingest/args'
import { json3Kind, transcriptFromTracks, type CaptionFetch, type WordRun } from '@shared/ingest/captions'
import { linkCredit, runWords, type LinkClip, type TranscriptFrom } from '@shared/ingest/linkClip'
import { offsetIntoDownload, sectionPlan, type Range } from '@shared/ingest/section'
import { linkCacheKey, parseLink } from '@shared/ingest/url'
import { rowsOf, runOfChapter, runRange } from '@shared/ingest/wordRun'
import { buildRenderPlan } from '@shared/render/plan'
import { captionsNeedBaking } from '@shared/graphics/fromTimeline'
import { captionTrack } from '@shared/captions/timeline'
import { clipsOnTrack, type MediaAsset, type Project } from '@shared/timeline'
import type { Transcript, Word } from '@shared/transcript'
import {
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
  pickRun,
  readOnsets,
  type AssEvent,
  type PickedRun
} from '../fixtures/m0Exit'
import { FFMPEG, outputDir, run, saveFrame, writeNote } from './output'

/*
 * M0's exit check (docs/CLIPS.md §3b.9, its first bullet), on the ten links
 * the user chose — talks, podcasts and raw vlogs; English, Hindi and Telugu;
 * two with no caption track at all — through the app's OWN path, end to end,
 * against YouTube. Opt-in: FORGE_M0_EXIT=1 on the development Mac. Every
 * test is skipped otherwise, and always under CI: the suite must not depend
 * on YouTube. FORGE_M0_LINKS="id,id" limits it to some of the links.
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
 *     `collectIngest`; on two links Add another clip and a second run;
 *   - the export: main's `prepareCaptions` (libass, the 'pop' style a new
 *     project has) and `buildRenderPlan`, through the bundled ffmpeg.
 *
 * The run is not chosen by hand: the first row starting at 40 % of the video
 * (2877 s on lqOH-zxtCDE, the time the user's link carried), extended over
 * the next rows to at least 8 words, cut to at most 20 (fixtures/m0Exit.ts,
 * `pickRun`). Add another clip and a second run, taken the same way at 70 %,
 * on O35KGzkS4VA (the user's pick for it) and on eK71EN3P78U (Telugu, the
 * longest) — so the property is read on a second language, and still read if
 * one of the two cannot be clipped at all.
 *
 * What is measured, and how (the readings are pure and unit-tested in
 * tests/m0Exit.test.ts):
 *   - the transcript: the keys asked, the tracks fetched and their kind, the
 *     words, segments and rows, and a run for every chapter;
 *   - the clip: one job and one asset per Clip download; the request exact,
 *     its range the run's; the collected words exactly the run's, the first at
 *     0 on the file's clock; the credit; no failure notice; and WHICH AUDIO
 *     yt-dlp picked — YouTube now serves machine-dubbed tracks beside the
 *     original, and a wrong pick would put another language's voice under the
 *     run's words. The pick is read with the job's own argv plus `--simulate
 *     --print %(requested_formats)j`, and asserted on every link with dubs;
 *   - the exact cut on a REAL stream (EFFECTS.md §41 had synthetic ones): the
 *     same range fetched again as Clip it's fast cut (`startIngest` with the
 *     override clipItFromLink builds, `exact: false`, the head
 *     `offsetIntoDownload`); the exact clip's first frame found among the
 *     padded file's frames near that head (gray 160×90, mean absolute
 *     difference; "ambiguous" when the best beats the next by under 20 %),
 *     and its first 500 ms of sound found in the padded file's (16 kHz,
 *     cross-correlated within ±1 s);
 *   - the export: the .ass read back (one Dialogue per word, each starting at
 *     its word within libass's centisecond), and the picture: per frame, in
 *     the lower half of a 1280×720 export, the pixels more than 40 levels
 *     from the same edit exported without captions (ink), how that mask
 *     changed from the frame before (xor), and how many of the caption's own
 *     pixels moved in the captioned picture (change). The footage moves; the
 *     captionless export is what cancels it — but the mask depends on the
 *     footage under it, and a cut under a held line moved it by more than a
 *     word onset did (bvz_zK5ZxpM), so onsets are read by `change`, which a
 *     cut does not move (`frameReading`). The noise floor of both (what the
 *     .ass says is blank or held, against what it says starts) is recorded
 *     beside the thresholds.
 *
 * Nobody's speech is committed: the ten video ids are here, and nothing else
 * of theirs. The run's words go to tests/output/m0-exit/ (gitignored), for
 * whoever watches the clips — the ear is the judge of "the words you hear are
 * the run's words".
 */

/** The user's ten links, as given (2026-10-12). Ids only — no title or word of any of them is written here. */
const LINKS = [
  { n: 1, url: 'https://www.youtube.com/watch?v=O35KGzkS4VA', id: 'O35KGzkS4VA', captions: true, second: true },
  { n: 2, url: 'https://www.youtube.com/watch?v=eK71EN3P78U', id: 'eK71EN3P78U', captions: true, second: true },
  // The link carried &t=2877s: the run is taken there.
  { n: 3, url: 'https://www.youtube.com/watch?v=lqOH-zxtCDE&t=2877s', id: 'lqOH-zxtCDE', captions: true, atMs: 2_877_000 },
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

const inCi = !!process.env.CI && process.env.CI !== 'false'
const ENABLED = process.env.FORGE_M0_EXIT === '1' && !inCi
const REASON = inCi
  ? 'skipped under CI: the suite must not depend on YouTube'
  : 'needs FORGE_M0_EXIT=1: ten public YouTube links through the real yt-dlp; the development Mac'
if (!ENABLED) process.stderr.write(`m0Exit.int: every test SKIPPED — ${REASON}\n`)
const ONLY = (process.env.FORGE_M0_LINKS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const CHOSEN = LINKS.filter((l) => ONLY.length === 0 || ONLY.includes(l.id))
/** Keep the downloads between runs (for working on the readings): every download then reports `cached`. */
const REUSE = process.env.FORGE_M0_REUSE === '1'

const DOWNLOAD_MS = 180_000
const CAPTIONS_MS = 120_000
const CANVAS = { width: 1280, height: 720 }
/** The band captions are read in: the lower half of the export. */
const BAND_TOP = CANVAS.height / 2
const BAND_H = CANVAS.height - BAND_TOP
/** The picture the exact clip's first frame is matched at. */
const SMALL = { width: 160, height: 90 }
const RATE = 16_000

let dir = ''
let userData = ''
let tool: YtDlpTool | null = null
const savedEnv = { userData: process.env.FORGE_TEST_USERDATA, fonts: process.env.FORGE_FONTS_DIR, xdg: process.env.XDG_CACHE_HOME }
const top: string[] = []
const summary: Record<string, unknown>[] = []

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
      const handle = downloadMedia(checked.request, ytTool(), () => undefined)
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
 * a specifier tsc does not follow (the node project that checks tests/ cannot
 * compile renderer code; clipIt.int's note). The part it drives is typed here.
 */
const STORE_MODULE = '../../src/renderer/src/store'

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
  notices: { text: string }[]
  urlSource: UrlSourceView | null
  setIngest(patch: { url: string }): void
  getTranscript(language?: string): Promise<void>
  newProject(): void
  addAnotherClip(): void
  setUrlRun(run: WordRun | null, anchorRow?: number | null): void
  clipItFromLink(): Promise<void>
  startIngest(override: { url: string; range: Range; exact: boolean; clip: LinkClip }): Promise<string | null>
  collectIngest(jobId: string): Promise<void>
}

let store: { getState(): StoreView; setState(next: unknown): void; getInitialState(): unknown } | null = null
const state = (): StoreView => store!.getState()

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

/**
 * The lower half of two exports, frame by frame, gray, streamed (a 1280×360
 * band is 460 KB a frame): one ffmpeg stacks the captioned band over the
 * captionless one, and `onFrame` reads each pair as it arrives.
 */
function bandPairs(captioned: string, plain: string, onFrame: (cap: Uint8Array, plain: Uint8Array) => void): Promise<number> {
  const crop = `crop=${CANVAS.width}:${BAND_H}:0:${BAND_TOP},format=gray`
  const args = [
    '-hide_banner', '-loglevel', 'error', '-i', captioned, '-i', plain,
    '-filter_complex', `[0:v]${crop}[a];[1:v]${crop}[b];[a][b]vstack=inputs=2[d]`,
    '-map', '[d]', '-vsync', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'
  ]
  const half = CANVAS.width * BAND_H
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

/**
 * Which formats the job's own argv picks, and every audio track on offer:
 * the argv `downloadMedia` builds for that request (`buildYtDlpArgs`, the
 * bundled ffmpeg, the downloads folder, its stem), plus `--simulate` and two
 * prints. `--simulate` after the argv's `--no-simulate`: the later wins.
 */
async function formatPick(request: IngestRequest): Promise<{ argv: string[]; requested: Fmt[]; audio: Fmt[]; warnings: string[] }> {
  const link = parseLink(request.url)!
  const built = buildYtDlpArgs(request, { ffmpegPath: FFMPEG_PATH, destDir: downloadsDir(), stem: outputStem(link, request) })
  const { stdout, stderr } = await run(
    tool!.path,
    [
      ...built.args,
      '--simulate',
      '--print', `${AF}%(formats.:.{format_id,language,language_preference,acodec,vcodec,format_note})j`,
      '--print', `${RF}%(requested_formats)j`
    ],
    { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 }
  )
  const lines = String(stdout).split(/\r?\n/)
  const take = (mark: string): Fmt[] => {
    const value = lines.find((l) => l.startsWith(mark))?.slice(mark.length).trim()
    // `NA` when the field is absent: one progressive format has no requested_formats.
    return value && value !== 'NA' ? (JSON.parse(value) as Fmt[]) : []
  }
  const audio = take(AF).filter((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none')
  const warnings = String(stderr)
    .split(/\r?\n/)
    .filter((l) => /WARNING|ERROR/.test(l))
    .map((l) => l.replace(/https?:\/\/\S+/g, '<url>').slice(0, 200))
  return { argv: built.args, requested: take(RF), audio, warnings }
}

/* ------------------------------------------------------------ per link */

interface Leg {
  name: 'first' | 'second'
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
}
const links = new Map<string, LinkState>()

function need(id: string): LinkState {
  const s = links.get(id)
  if (!s) throw new Error(`${id}: the transcript step did not complete, so there is nothing to clip`)
  if (s.failed) throw new Error(`${id}: Get transcript failed in the app ("${s.failed}"), so there is nothing to clip`)
  return s
}

const fmtMs = (ms: number): string => `${(ms / 1000).toFixed(3)} s`

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
    const message = err instanceof Error ? err.message : String(err)
    s.notes.push(
      '',
      `## ${leg.name} run: Clip download FAILED — ${message}`,
      `words ${leg.picked.run.from}–${leg.picked.run.to} (${leg.words.length}), ${fmtMs(leg.range.startMs)} → ${fmtMs(leg.range.endMs)}; section ${section}; ` +
        `formats ${pick.requested.map((f) => `${f.format_id} (${f.vcodec}/${f.acodec})`).join(' + ')}`,
      ...(pick.warnings.length ? [`yt-dlp warned: ${pick.warnings.join(' | ')}`] : [])
    )
    s.row[`${leg.name}Clip`] = { failed: message, section, formats: pick.requested.map((f) => f.format_id) }
    top.push(`  - ${s.spec.id} ${leg.name}: Clip download FAILED — ${message} (section ${section})`)
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

interface ExportReading {
  frames: number
  events: AssEvent[]
  words: { text: string; ms: number }[]
  /** Hard check's material: per word, its Dialogue's start against its own. */
  assRows: { word: string; lit: string | null; wordMs: number; assMs: number | null }[]
  onsets: ReturnType<typeof readOnsets>
  /** The margins of the change the onsets are read by (the caption's own pixels). */
  floor: ReturnType<typeof noiseFloor>
  /** The same margins for the mask's XOR, which the footage moves too. */
  xorFloor: ReturnType<typeof noiseFloor>
  match: ReturnType<typeof matchOnsets>
  wordFrames: number[]
  png: { frame: number; file: string }
}

/** Export one project with captions and without, read the .ass and the picture, leave every file in `into`. */
async function exportAndRead(project: Project, into: string, prefix: string): Promise<ExportReading> {
  const name = (f: string): string => join(into, `${prefix}${f}`)
  const fps = project.settings.fps

  const plainPlan = buildRenderPlan({
    project: { ...project, captions: { ...project.captions, enabled: false } },
    outputPath: name('clip-plain.mp4'),
    canvas: CANVAS
  })
  await run(FFMPEG, plainPlan.args, { maxBuffer: 64 * 1024 * 1024 })

  // 'pop', a new project's style: flat, so the app burns it with libass (ExportStrip, captionNeedsCanvas).
  expect(project.captions.enabled, 'captions are on in a new project').toBe(true)
  expect(captionsNeedBaking(project), 'pop is libass’s').toBe(false)
  const prepared = await prepareCaptions(project, CANVAS)
  if (!prepared) throw new Error('prepareCaptions found nothing to burn')
  const ass = await readFile(prepared.subtitlesPath, 'utf8')
  await copyFile(prepared.subtitlesPath, name('captions.ass'))
  const plan = buildRenderPlan({
    project,
    outputPath: name('clip-captions.mp4'),
    canvas: CANVAS,
    subtitlesPath: prepared.subtitlesPath,
    fontsDir: prepared.fontsDir
  })
  await run(FFMPEG, plan.args, { maxBuffer: 64 * 1024 * 1024 })
  await prepared.cleanup()

  const framesPlain = await countFrames(name('clip-plain.mp4'))
  const framesCaptioned = await countFrames(name('clip-captions.mp4'))
  expect.soft(framesPlain, `${prefix}clip-plain frames against the plan`).toBe(plainPlan.durationFrames)
  expect.soft(framesCaptioned, `${prefix}clip-captions frames against the plan`).toBe(plan.durationFrames)

  const ink: number[] = []
  const xor: number[] = []
  const change: number[] = []
  let previous: { cap: Uint8Array; mask: Uint8Array } | null = null
  const read = await bandPairs(name('clip-captions.mp4'), name('clip-plain.mp4'), (cap, plain) => {
    const r = frameReading(cap, plain, previous)
    ink.push(r.ink)
    xor.push(r.xor)
    change.push(r.change)
    previous = { cap: new Uint8Array(cap), mask: r.mask }
  })
  expect.soft(read, `${prefix}frames read`).toBe(framesCaptioned)

  const events = parseAss(ass)
  const words = timelineWords(project)
  const onsets = readOnsets(ink, change)
  const labels = frameLabels(events, read, fps)
  const floor = noiseFloor(ink, change, labels)
  const xorFloor = noiseFloor(ink, xor, labels)
  const wordFrames = words.map((w) => firstFrameAt(w.ms, fps))
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

  // The middle word, lit: the frame its onset was seen on, or its own frame.
  const mid = Math.floor(words.length / 2)
  const offset = match.offsets[mid]
  const pngFrame = wordFrames[mid] + (offset !== null && Math.abs(offset) <= 1 ? offset : 0)
  await saveFrame(name('clip-captions.mp4'), Math.max(0, (pngFrame - 0.25) / fps), name('onset.png'))

  const assRows = words.map((w, i) => ({ word: w.text, lit: events[i]?.lit ?? null, wordMs: w.ms, assMs: events[i]?.startMs ?? null }))
  return { frames: read, events, words, assRows, onsets, floor, xorFloor, match, wordFrames, png: { frame: pngFrame, file: name('onset.png') } }
}

/** The hard .ass check: one Dialogue per word, in order, each lit word the word, each start its word's within libass's centisecond. */
function assertAss(id: string, prefix: string, r: ExportReading): void {
  expect(r.events.length, `${id} ${prefix}: one Dialogue per word`).toBe(r.words.length)
  for (const row of r.assRows) {
    // 'pop' is uppercase (style.ts); buildAss writes the word upper-cased, as JS does.
    expect(row.lit, `${id} ${prefix}: the lit word`).toBe(row.word.toUpperCase())
    // toAssTime: the ms rounded, then floored to the centisecond — so 0..9 ms early, never late.
    const early = Math.round(row.wordMs) - (row.assMs ?? Number.NaN)
    expect(early, `${id} ${prefix}: "${row.word}" at ${row.wordMs} ms, its Dialogue at ${row.assMs}`).toBeGreaterThanOrEqual(0)
    expect(early, `${id} ${prefix}: "${row.word}" at ${row.wordMs} ms, its Dialogue at ${row.assMs}`).toBeLessThan(10)
  }
}

/* ----------------------------------------------------------------- setup */

beforeAll(async () => {
  if (!ENABLED) return
  dir = await outputDir('m0-exit')
  // A temp userData, never the app's: the downloads, the caption cache, the .ass files, and yt-dlp's cache.
  userData = join(tmpdir(), 'forge-m0exit-userdata')
  await mkdir(userData, { recursive: true })
  process.env.FORGE_TEST_USERDATA = userData
  if (!REUSE) {
    // Where main puts them: the stub's getPath('userData') is <FORGE_TEST_USERDATA>/userData.
    await rm(downloadsDir(), { recursive: true, force: true })
    await rm(join(app.getPath('userData'), 'url'), { recursive: true, force: true })
  }
  // yt-dlp writes its cache under XDG_CACHE_HOME; ~/.cache is not writable here (EFFECTS.md §40).
  process.env.XDG_CACHE_HOME = join(userData, 'xdg-cache')
  process.env.FORGE_FONTS_DIR = resolve(__dirname, '../../assets/fonts')

  tool = await ensureYtDlp()
  const ffmpegVersion = String((await run(FFMPEG, ['-version'])).stdout).split(/\r?\n/)[0]
  top.push(
    `yt-dlp ${tool.version ?? '?'} (${tool.source}: ${tool.path}); ffmpeg "${ffmpegVersion}" (${FFMPEG}); ${process.platform}`,
    `userData ${userData}${REUSE ? ' (FORGE_M0_REUSE=1: downloads kept from an earlier run)' : ''}; links: ${CHOSEN.map((l) => l.id).join(', ')}`
  )

  vi.stubGlobal('window', { forge: bridge() })
  store = ((await import(/* @vite-ignore */ STORE_MODULE)) as { useEditor: NonNullable<typeof store> }).useEditor
  store.setState(store.getInitialState())
}, 600_000)

afterAll(async () => {
  if (!ENABLED) return
  vi.unstubAllGlobals()
  for (const [key, value] of [
    ['FORGE_TEST_USERDATA', savedEnv.userData],
    ['FORGE_FONTS_DIR', savedEnv.fonts],
    ['XDG_CACHE_HOME', savedEnv.xdg]
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  if (!dir) return
  for (const s of links.values()) await writeNote(s.dir, s.notes)
  await writeFile(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  await writeNote(dir, [
    '# m0-exit — M0’s exit check on the user’s ten links (docs/CLIPS.md §3b.9)',
    '',
    'Each link through the app’s own path: main’s ingest:meta / ingest:captions handlers and the real yt-dlp, the renderer’s store',
    '(Get transcript, a run, Clip download, collect), then the export with captions (prepareCaptions, libass, the "pop" style) at 1280×720.',
    'The run: the first row at 40 % of the video (2877 s on lqOH-zxtCDE), extended to ≥ 8 words, cut to ≤ 20. O35KGzkS4VA and',
    'eK71EN3P78U also take Add another clip and a second run at 70 %.',
    '',
    'Per link, <n>-<id>/:',
    '  exact-download.mp4   what Clip download fetched (the exact cut, --force-keyframes-at-cuts) and the clip plays',
    '  fast-download.mp4    the same range as Clip it’s fast cut: padded 10 s each side, copied — the words’ surroundings',
    '  clip-captions.mp4    the project exported with its captions on — WATCH AND LISTEN TO THIS ONE',
    '  clip-plain.mp4       the same export without captions (what the caption reading subtracts)',
    '  captions.ass         the subtitles libass burnt in',
    '  frames.csv           per export frame: ink (band pixels > 40 levels from clip-plain), xor (that mask against the frame',
    '                       before), change (the caption’s own pixels that moved — what onsets are read by), what the .ass says',
    '                       the frame is, whether an onset was read, which word starts there',
    '  onset.png            the export frame where the middle word is lit — where the glyphs are judged',
    '  README.txt           the run’s words (to read while listening) and every reading',
    '  second-*             O35KGzkS4VA and eK71EN3P78U: the second run, and the project after Add another clip (both clips) exported',
    'summary.json           the per-link numbers, no words',
    '',
    ...top
  ])
})

/* ----------------------------------------------------------------- tests */

describe.skipIf(!ENABLED)('M0’s exit: the user’s ten links, Get transcript → Clip download → captions', () => {
  for (const spec of CHOSEN) {
    const tag = `${spec.n}. ${spec.id}`

    it(`${tag}: Get transcript`, async () => {
      const linkDir = join(dir, `${spec.n}-${spec.id}`)
      await mkdir(linkDir, { recursive: true })
      state().newProject()
      state().setIngest({ url: spec.url })
      const t0 = Date.now()
      await state().getTranscript()
      let source = state().urlSource!
      const metaAnswer = [...asked.meta.values()].at(-1)
      const notes: string[] = [`# ${tag}`, '', `link as given: ${spec.url}`]
      const row: Record<string, unknown> = { n: spec.n, id: spec.id }
      summary.push(row)

      if (!spec.captions) {
        // No language: the app asks for one. Then English, and the video has no captions.
        const first = { status: source.status, language: source.meta?.language ?? null }
        await state().getTranscript('en')
        source = state().urlSource!
        const fetched = [...asked.captions.values()].at(-1)
        Object.assign(row, {
          language: first.language,
          statusWithoutLanguage: first.status,
          statusWithEn: source.status,
          keysAsked: fetched?.fetch.keys ?? null,
          tracks: source.tracks,
          ms: Date.now() - t0
        })
        notes.push(
          `meta: duration ${source.meta?.duration} s, language ${first.language}, chapters ${source.meta?.chapters.length}`,
          `getTranscript(): status '${first.status}'; getTranscript('en'): keys asked ${JSON.stringify(fetched?.fetch.keys)}, tracks ${JSON.stringify(source.tracks)}, status '${source.status}'`,
          'The URL tile then shows the start and end fields, "This video has no captions" and Listen to it greyed (tests/renderer/ingestPanel.test.tsx).'
        )
        links.set(spec.id, { spec, dir: linkDir, meta: source.meta!, fetch: fetched?.fetch ?? null, fetchMs: Date.now() - t0, transcript: null, legs: [], notes, row })
        top.push(`- ${tag}: no captions — getTranscript() '${first.status}' (language ${first.language}), getTranscript('en') '${source.status}', tracks ${source.tracks.length}`)
        expect(first.language, 'no language in the metadata').toBeNull()
        expect(first.status, 'the app asks for the language').toBe('language')
        expect(source.tracks, 'no caption track').toEqual([])
        expect(source.status, '"This video has no captions"').toBe('none')
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
        links.set(spec.id, { spec, dir: linkDir, meta, fetch: null, fetchMs: Date.now() - t0, transcript: null, legs: [], failed, notes, row })
        expect(source.status, `Get transcript: "${failed}"`).toBe('ready')
      }
      const fetched = answered!
      const t = source.transcript
      const rows = t ? rowsOf(t) : []
      const chapterRuns = t ? meta.chapters.map((ch) => runOfChapter(t, ch)) : []
      Object.assign(row, {
        durationS: meta.duration,
        language: meta.language,
        channel: meta.channel !== null,
        webpageUrl: meta.webpage_url !== null,
        chapters: meta.chapters.length,
        chapterRuns: chapterRuns.filter((r) => r !== null).length,
        keysAsked: fetched.fetch.keys,
        tracks: source.tracks,
        words: t?.words.length ?? 0,
        segments: t?.segments.length ?? 0,
        rows: rows.length,
        approximate: t?.approximate ?? false,
        model: t?.model ?? null,
        fetchMs: Date.now() - t0,
        metaMs: metaAnswer?.ms ?? null,
        captionsMs: fetched.ms
      })
      notes.push(
        `meta: duration ${meta.duration} s, language ${meta.language}, channel ${meta.channel ? 'present' : 'ABSENT'}, webpage_url ${meta.webpage_url ? 'present' : 'ABSENT'}, chapters ${meta.chapters.length}`,
        `keys asked ${JSON.stringify(fetched.fetch.keys)} (captionKeys(${JSON.stringify(meta.language)}) = ${JSON.stringify(captionKeys(meta.language))}); tracks ${JSON.stringify(source.tracks)}`,
        `transcript: ${t?.words.length ?? 0} words, ${t?.segments.length ?? 0} segments, ${rows.length} rows, model ${t?.model}${t?.approximate ? ', approximate' : ''}`,
        `Get transcript took ${Date.now() - t0} ms (metadata ${metaAnswer?.ms ?? '?'} ms, captions ${fetched.ms} ms)`,
        `chapters with a run (runOfChapter): ${chapterRuns.filter((r) => r !== null).length} of ${meta.chapters.length}` +
          (chapterRuns.some((r) => r === null) ? ` — none for chapter(s) ${chapterRuns.flatMap((r, i) => (r === null ? [i + 1] : [])).join(', ')}` : '')
      )
      top.push(
        `- ${tag}: ${meta.language}, ${Math.round(meta.duration ?? 0)} s, tracks ${source.tracks.map((x) => `${x.key}:${x.kind}`).join(' ')}, ` +
          `${t?.words.length ?? 0} words, ${rows.length} rows, chapters ${chapterRuns.filter((r) => r !== null).length}/${meta.chapters.length}, Get transcript ${Date.now() - t0} ms`
      )
      links.set(spec.id, { spec, dir: linkDir, meta, fetch: fetched.fetch, fetchMs: Date.now() - t0, transcript: t, legs: [], notes, row })

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
      const leg: Leg = { name: 'first', picked: picked!, targetMs, range: runRange(t, picked!.run), words: t.words.slice(picked!.run.from, picked!.run.to + 1) }
      s.legs.push(leg)
      state().setUrlRun(leg.picked.run)
      await landLeg(s, leg, '')
      s.project = state().project

      if ('second' in spec) {
        // Add another clip: the rows stay, the run is cleared — then the second run, the same way at 70 %.
        const before = s.project
        const rowsBefore = state().urlSource!.transcript
        state().addAnotherClip()
        expect(state().urlSource!.run, 'Add another clip clears the run').toBeNull()
        expect(state().urlSource!.transcript, 'and keeps the rows').toBe(rowsBefore)
        const target2 = Math.round((s.meta.duration ?? 0) * 1000 * SECOND_RUN_AT)
        const picked2 = pickRun(t, target2)
        expect(picked2).not.toBeNull()
        const leg2: Leg = { name: 'second', picked: picked2!, targetMs: target2, range: runRange(t, picked2!.run), words: t.words.slice(picked2!.run.from, picked2!.run.to + 1) }
        s.legs.push(leg2)
        state().setUrlRun(leg2.picked.run)
        await landLeg(s, leg2, 'second-')
        s.both = state().project
        const first = before.assets[0]
        // The first clip untouched: its asset, its clip, its words.
        expect.soft(s.both.assets[0], 'the first asset untouched').toEqual(first)
        expect.soft(s.both.clips.find((c) => c.assetId === first.id), 'the first clip untouched').toEqual(before.clips[0])
        expect.soft(s.both.transcripts[first.id], 'the first clip’s words untouched').toEqual(before.transcripts[first.id])
        expect.soft(s.both.clips, 'two clips').toHaveLength(2)
        const second = s.both.assets[1]
        expect.soft(s.both.transcripts[second.id].words.map((w) => w.text), 'the second clip holds only the second run’s words').toEqual(leg2.words.map((w) => w.text))
        s.notes.push(`Add another clip: the rows kept, the run cleared; second run at ${SECOND_RUN_AT * 100} % (${fmtMs(target2)}); the first clip, asset and words unchanged after it.`)
      }
    }, 900_000)

    it(`${tag}: the exact cut against the fast cut of the same range — the first frame and the sound`, async () => {
      const s = need(spec.id)
      for (const leg of s.legs) await fastLeg(s, leg, leg.name === 'first' ? '' : 'second-')
    }, 900_000)

    it(`${tag}: exported with captions — one Dialogue per word, each word's caption within a frame`, async () => {
      const s = need(spec.id)
      expect(s.project, 'the clip landed').toBeDefined()
      const outs: [Project, string][] = [[s.project!, '']]
      if (s.both) outs.push([s.both, 'second-'])
      const failures: (() => void)[] = []
      for (const [project, prefix] of outs) {
        const r = await exportAndRead(project, s.dir, prefix)
        const within = r.match.within
        const off = r.match.offsets.map((o) => (o === null ? 'none' : `${o >= 0 ? '+' : ''}${o}`))
        const fl = r.floor
        const reading = {
          exportFrames: r.frames,
          dialogues: r.events.length,
          words: r.words.length,
          assMaxEarlyMs: Math.max(...r.assRows.map((x) => Math.round(x.wordMs) - (x.assMs ?? Number.NaN))),
          onsetsSeen: r.onsets.onsets.length,
          linesSeen: r.onsets.lines.length,
          within,
          offsets: r.match.offsets,
          inkThreshold: Math.round(r.onsets.inkThreshold),
          changeThreshold: Math.round(r.onsets.changeThreshold),
          floor: fl,
          xorFloor: r.xorFloor,
          extraOnsets: r.onsets.onsets.filter((o) => !r.wordFrames.some((w) => Math.abs(w - o) <= 1)).length,
          pngFrame: r.png.frame
        }
        s.row[`${prefix || 'first-'}export`] = reading
        s.notes.push(
          '',
          `## export${prefix ? ' after Add another clip (both clips)' : ''}: ${prefix}clip-captions.mp4, ${r.frames} frames at ${project.settings.fps} fps, 1280×720`,
          `.ass: ${r.events.length} Dialogues for ${r.words.length} words; each Dialogue's start is its word's rounded and floored to the centisecond, ` +
            `0–${reading.assMaxEarlyMs} ms early`,
          `picture: ink threshold ${reading.inkThreshold} px, change threshold ${reading.changeThreshold} px (from the counts alone); ` +
            `${r.onsets.onsets.length} onsets read (lines at ${r.onsets.lines.join(', ') || 'none'}), ${reading.extraOnsets} of them more than a frame from every word`,
          `noise floor (by the .ass): blank frames ${fl.blankFrames}, their most ink ${fl.blankMaxInk ?? '—'}; captioned frames' least ink ${fl.captionedMinInk ?? '—'}; ` +
            `held frames ${fl.heldFrames}, their most change ${fl.heldMaxChange ?? '—'}; ${fl.onsetFrames} onsets, their least change ${fl.onsetMinChange ?? '—'} ` +
            `(the mask's XOR instead, which the footage moves too: held at most ${r.xorFloor.heldMaxChange ?? '—'}, onsets at least ${r.xorFloor.onsetMinChange ?? '—'})`,
          `words with an onset within a frame: ${within} of ${r.words.length}; per word (onset − word frame): ${off.join(' ')}`,
          `${prefix}onset.png: frame ${r.png.frame}, the middle word lit`,
          '',
          'word | its ms on the export | its frame | Dialogue start | onset seen',
          ...r.words.map((w, i) => `${w.text} | ${w.ms.toFixed(1)} | ${r.wordFrames[i]} | ${r.assRows[i].assMs ?? '—'} | ${off[i]}`)
        )
        top.push(
          `  - ${spec.id} ${prefix || ''}export: ${r.events.length} Dialogues / ${r.words.length} words (≤ ${reading.assMaxEarlyMs} ms early), onsets within a frame ${within}/${r.words.length}, ` +
            `thresholds ink ${reading.inkThreshold} change ${reading.changeThreshold}; floor: blank max ink ${fl.blankMaxInk ?? '—'}, captioned min ink ${fl.captionedMinInk ?? '—'}, ` +
            `held max change ${fl.heldMaxChange ?? '—'}, onset min change ${fl.onsetMinChange ?? '—'}; extra onsets ${reading.extraOnsets}`
        )
        failures.push(() => {
          expect.soft(within, `${spec.id} ${prefix}: words whose caption starts within a frame of them (offsets ${off.join(' ')})`).toBe(r.words.length)
          assertAss(spec.id, prefix, r)
        })
      }
      for (const f of failures) f()
    }, 600_000)
  }
})

/**
 * One Clip download, landed and checked: the job, the request, the collected
 * words and credit, the notices — and the audio yt-dlp picked, the file, the
 * asset's length against the range's. Everything is written down before the
 * hard assertions run.
 */
async function landLeg(s: LinkState, leg: Leg, prefix: string): Promise<void> {
  const id = s.spec.id
  expect(state().urlSource?.transcript, 'the run is picked in the transcript on screen').toBe(s.transcript)
  expect(state().urlSource?.run, 'the run set is the picked one').toEqual(leg.picked.run)
  const fps = state().project.settings.fps
  const { jobId, job, asset } = await clipDownload(s, leg)
  leg.exact = { jobId, asset, file: join(s.dir, `${prefix}exact-download.mp4`) }
  await copyFile(asset.path, leg.exact.file)
  const project = state().project
  const clip = project.clips.find((c) => c.assetId === asset.id)!
  const collected = project.transcripts[asset.id]
  const info = await probeFile(asset.path)
  const frames = await countFrames(asset.path)
  const outcome = entries.get(jobId)!.outcome!
  const pick = await formatPick(job.request)
  const sections = pick.argv.filter((a) => a === '--download-sections').length
  const section = pick.argv[pick.argv.indexOf('--download-sections') + 1]
  // A video-only and an audio-only format, as YouTube serves 1080p (EFFECTS.md §41).
  const audio = pick.requested.find((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none')
  const video = pick.requested.find((f) => f.vcodec && f.vcodec !== 'none')
  const languages = [...new Set(pick.audio.map((f) => f.language ?? null))]
  const dubbed = languages.length > 1
  const tag = await audioTag(asset.path)
  const spans = await streamSpans(asset.path)
  const rangeFrames = Math.round(((leg.range.endMs - leg.range.startMs) * fps) / 1000)
  const lengthMs = info.durationMs ?? 0
  const words = collected?.words ?? []

  const reading = {
    run: { from: leg.picked.run.from, to: leg.picked.run.to, words: leg.words.length, row: leg.picked.firstRow, rowsTaken: leg.picked.rows },
    targetMs: leg.targetMs,
    range: leg.range,
    rangeMs: leg.range.endMs - leg.range.startMs,
    section,
    sections,
    downloadMs: job.ms,
    cached: outcome.cached,
    size: info.size,
    file: { frames, fps: info.fps, width: info.width, height: info.height, vcodec: info.videoCodec, acodec: info.audioCodec, durationMs: info.durationMs },
    streams: spans,
    asset: { durationFrames: asset.durationFrames, rangeFrames, diff: asset.durationFrames - rangeFrames },
    clip: { start: clip.start, inPoint: clip.inPoint, duration: clip.duration },
    formats: { video: video?.format_id ?? null, videoNote: video?.format_note ?? null, audio: audio?.format_id ?? null },
    audio: { language: audio?.language ?? null, preference: audio?.language_preference ?? null, note: audio?.format_note ?? null, tag, tracksOnOffer: languages.length, dubbed },
    ytdlpWarnings: pick.warnings,
    collected: { words: words.length, firstStartMs: words[0]?.startMs ?? null, lastEndMs: words.at(-1)?.endMs ?? null },
    credit: { source: asset.credit?.source ?? null, author: asset.credit?.author != null, pageUrl: asset.credit?.pageUrl ?? null }
  }
  s.row[`${leg.name}Clip`] = reading
  s.notes.push(
    '',
    `## ${leg.name} run (${prefix}exact-download.mp4)`,
    `rule: first row at or after ${fmtMs(leg.targetMs)} (row ${leg.picked.firstRow}), ${leg.picked.rows} row(s) taken, ${RUN_MIN_WORDS}–${RUN_MAX_WORDS} words: ` +
      `words ${leg.picked.run.from}–${leg.picked.run.to} (${leg.words.length}), ${fmtMs(leg.range.startMs)} → ${fmtMs(leg.range.endMs)} (${reading.rangeMs} ms)`,
    `THE RUN'S WORDS: ${leg.words.map((w) => w.text).join(' ')}`,
    `download: --download-sections ${section} (${sections} in the argv), ${job.ms ?? '?'} ms${outcome.cached ? ' (CACHED)' : ''}, ${info.size} bytes`,
    `file: ${frames} frames, ${info.fps} fps, ${info.width}×${info.height}, ${info.videoCodec}/${info.audioCodec}, ${info.durationMs} ms; ` +
      `asset ${asset.durationFrames} frames at ${fps} against the range's ${rangeFrames} (${reading.asset.diff >= 0 ? '+' : ''}${reading.asset.diff}); ` +
      `streams: sound ${spans.audio?.startMs}+${spans.audio?.ms} ms, picture ${spans.video?.startMs}+${spans.video?.ms} ms, against the range's ${reading.rangeMs}`,
    `formats: video ${video?.format_id} (${video?.format_note}), audio ${audio?.format_id} — language ${audio?.language ?? 'none'}, preference ${audio?.language_preference}, "${audio?.format_note}"; ` +
      `${languages.length} audio language(s) on offer${dubbed ? ` (${languages.join(', ')})` : ''}; the file's audio tag ${tag ?? 'none'}`,
    ...(pick.warnings.length ? [`yt-dlp warned: ${pick.warnings.join(' | ')}`] : []),
    `clip: start ${clip.start}, in-point ${clip.inPoint}, ${clip.duration} frames; collected ${words.length} words, the first at ${words[0]?.startMs} ms, the last ending ${words.at(-1)?.endMs} ms (file ${lengthMs} ms)`,
    `credit: source ${asset.credit?.source}, author ${asset.credit?.author ? 'present' : 'ABSENT'}, page ${asset.credit?.pageUrl}`
  )
  top.push(
    `  - ${id} ${leg.name}: ${leg.words.length} words, ${reading.rangeMs} ms, section ${section}, ${job.ms ?? '?'} ms, ${frames} frames @ ${info.fps} fps, ${info.size} B, ` +
      `asset − range ${reading.asset.diff} frames, sound ${spans.audio?.startMs}+${spans.audio?.ms} ms, audio ${audio?.format_id} ${audio?.language ?? '-'} pref ${audio?.language_preference} of ${languages.length} language(s)`
  )

  // The checks.
  expect.soft(job.request.exact, `${id} ${leg.name}: Clip download is exact`).toBe(true)
  expect.soft(job.request.range, `${id} ${leg.name}: the request's range is the run's`).toEqual(leg.range)
  expect.soft(sections, `${id} ${leg.name}: one --download-sections`).toBe(1)
  expect.soft(words.map((w) => w.text), `${id} ${leg.name}: exactly the run's words, in order`).toEqual(leg.words.map((w) => w.text))
  expect.soft(words.length, `${id} ${leg.name}: as many words as the run`).toBe(leg.picked.run.to - leg.picked.run.from + 1)
  expect.soft(Math.abs(words[0]?.startMs ?? Number.NaN), `${id} ${leg.name}: the first word at 0 on the file's clock`).toBeLessThanOrEqual(1)
  expect.soft(words.at(-1)?.endMs ?? Number.NaN, `${id} ${leg.name}: the last word ends inside the file (${lengthMs} ms)`).toBeLessThanOrEqual(lengthMs)
  // Nothing outside the run in the SOUND: the audio stream is the range, to the ms (the picture may hold its last frame a little longer).
  expect.soft(spans.audio?.startMs, `${id} ${leg.name}: the sound starts at the file's 0`).toBe(0)
  expect.soft((spans.audio?.startMs ?? 0) + (spans.audio?.ms ?? Number.NaN), `${id} ${leg.name}: no sound past the run's range (${reading.rangeMs} ms)`).toBeLessThanOrEqual(reading.rangeMs + 1)
  expect.soft(clip.inPoint, `${id} ${leg.name}: in-point`).toBe(0)
  expect.soft(asset.credit?.source, `${id} ${leg.name}: credit source`).toBe('link')
  expect.soft(asset.credit?.author, `${id} ${leg.name}: credit channel`).toBeTruthy()
  expect.soft(asset.credit?.pageUrl, `${id} ${leg.name}: credit page`).toBe(s.meta.webpage_url)
  expect.soft(
    state().notices.map((n) => n.text).filter((x) => /could not|failed|without its words/i.test(x)),
    `${id} ${leg.name}: no failure notice`
  ).toEqual([])
  // The audio is the video's own: on a link with dubs, YouTube's "original" (preference 10) and the video's language.
  expect.soft(audio, `${id} ${leg.name}: an audio format was picked`).toBeDefined()
  if (dubbed) {
    expect.soft(audio?.language_preference, `${id} ${leg.name}: the original audio, not a dub (${audio?.format_note})`).toBe(10)
    expect.soft(audio?.format_note ?? '', `${id} ${leg.name}: the original audio`).toMatch(/original/i)
    expect.soft((audio?.language ?? '').split('-')[0], `${id} ${leg.name}: in the video's language`).toBe((s.meta.language ?? '').split('-')[0])
  }
}

/**
 * The same range fetched as Clip it's fast cut — `startIngest` with the
 * override clipItFromLink builds, `exact: false`, its head
 * `offsetIntoDownload` — collected into a project of its own; then the exact
 * clip's first frame and first 500 ms of sound found in it.
 */
async function fastLeg(s: LinkState, leg: Leg, prefix: string): Promise<void> {
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
    const message = err instanceof Error ? err.message : String(err)
    const section = sectionPlan(leg.range, false).args[1]
    s.notes.push('', `## ${leg.name} run's fast cut: the download FAILED — ${message} (section ${section})`)
    s.row[`${leg.name}Fast`] = { failed: message, section }
    top.push(`  - ${id} ${leg.name} fast cut: download FAILED — ${message} (section ${section})`)
    throw err
  }
  await state().collectIngest(jobId)
  const project = state().project
  const asset = project.assets[0]
  leg.fast = { jobId, asset, file: join(s.dir, `${prefix}fast-download.mp4`) }
  await copyFile(asset.path, leg.fast.file)
  const fps = project.settings.fps
  const clip = project.clips[0]
  const words = project.transcripts[asset.id]?.words ?? []
  const job = jobs.get(jobId)!

  // The picture: the exact clip's frame 0 among the padded file's frames near the head.
  const exactInfo = await probeFile(leg.exact.file)
  const [exactFirst] = await smallFrames(leg.exact.file, 1)
  const padded = await smallFrames(leg.fast.file)
  const match = matchFrame(exactFirst.data, padded, head)
  // The sound: the exact clip's first 500 ms in the padded file's, ±1 s around the head.
  const lag = audioLag(await pcm(leg.exact.file), await pcm(leg.fast.file), RATE, head)
  const frameMs = 1000 / (exactInfo.fps ?? 30)
  const reading = {
    downloadMs: job.ms,
    cached: entries.get(jobId)!.outcome!.cached,
    size: (await stat(asset.path)).size,
    head,
    clip: { inPoint: clip.inPoint, duration: clip.duration, expectedInPoint: Math.round((head / 1000) * fps) },
    collected: { words: words.length, firstStartMs: words[0]?.startMs ?? null },
    exactFirstPtsMs: exactFirst.ptsMs,
    paddedFirstPtsMs: padded[0]?.ptsMs ?? null,
    video: match && {
      offsetMs: Math.round(match.offsetMs * 10) / 10,
      mad: Math.round(match.mad * 100) / 100,
      secondOffsetMs: match.secondPtsMs === null ? null : Math.round((match.secondPtsMs - head) * 10) / 10,
      secondMad: match.secondMad === null ? null : Math.round(match.secondMad * 100) / 100,
      margin: Math.round(match.margin * 1000) / 1000,
      ambiguous: match.ambiguous,
      candidates: match.candidates
    },
    audio: { lagMs: Math.round(lag.lagMs * 100) / 100, corr: Math.round(lag.corr * 10000) / 10000, secondLagMs: lag.secondLagMs === null ? null : Math.round(lag.secondLagMs * 100) / 100, secondCorr: lag.secondCorr === null ? null : Math.round(lag.secondCorr * 10000) / 10000 },
    oneFrameMs: Math.round(frameMs * 100) / 100
  }
  s.row[`${leg.name}Fast`] = reading
  s.notes.push(
    '',
    `## ${leg.name} run's fast cut (${prefix}fast-download.mp4): the exact clip against it`,
    `fast: ${job.ms ?? '?'} ms${reading.cached ? ' (CACHED)' : ''}, ${reading.size} bytes; head ${head} ms; clip in-point ${clip.inPoint} (expected ${reading.clip.expectedInPoint}), ` +
      `${clip.duration} frames; collected ${words.length} words, the first at ${words[0]?.startMs} ms`,
    `the exact clip's first frame (pts ${exactFirst.ptsMs} ms) is the padded file's frame at ${match ? fmtMs(match.bestPtsMs) : '—'}: ` +
      (match
        ? `${reading.video!.offsetMs >= 0 ? '+' : ''}${reading.video!.offsetMs} ms from the head (MAD ${reading.video!.mad}; next best ${reading.video!.secondOffsetMs} ms at MAD ${reading.video!.secondMad}; ` +
          `margin ${(match.margin * 100).toFixed(1)} %${match.ambiguous ? ` — AMBIGUOUS, under ${AMBIGUOUS_BELOW * 100} %` : ''}; ${match.candidates} candidates)`
        : 'no frame within ±0.5 s'),
    `its first 500 ms of sound is the padded file's at ${reading.audio.lagMs >= 0 ? '+' : ''}${reading.audio.lagMs} ms from the head (corr ${reading.audio.corr}; ` +
      `the next peak ${reading.audio.secondLagMs} ms, corr ${reading.audio.secondCorr}); one frame is ${reading.oneFrameMs} ms`
  )
  top.push(
    `  - ${id} ${leg.name} exact vs fast: video ${match ? `${reading.video!.offsetMs} ms, margin ${(match.margin * 100).toFixed(1)} %${match.ambiguous ? ' (ambiguous)' : ''}` : 'no match'}; ` +
      `audio ${reading.audio.lagMs} ms (corr ${reading.audio.corr}); fast ${job.ms ?? '?'} ms`
  )

  expect.soft(words.map((w) => w.text), `${id} ${leg.name} fast: the run's words`).toEqual(leg.words.map((w) => w.text))
  expect.soft(Math.abs((words[0]?.startMs ?? Number.NaN) - head), `${id} ${leg.name} fast: the first word at the head`).toBeLessThanOrEqual(1)
  expect.soft(clip.inPoint, `${id} ${leg.name} fast: in-point at the head`).toBe(reading.clip.expectedInPoint)
  expect.soft(match, `${id} ${leg.name}: a frame near the head`).not.toBeNull()
  expect.soft(Math.abs(lag.lagMs), `${id} ${leg.name}: the exact clip's sound starts within a frame of the fast cut's head (${lag.lagMs.toFixed(2)} ms, corr ${lag.corr.toFixed(4)})`).toBeLessThanOrEqual(frameMs)
}
