import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LinkRuns, captionTrackHandler, captionsHandler, metaHandler } from '../../src/main/ingest/meta'
import { downloadMedia, type IngestTool } from '../../src/main/ingest/download'
import { startRequest } from '../../src/main/ingest/start'
import { probeMany } from '../../src/main/ffmpeg/probe'
import { toAsset } from '../../src/main/assets'
import { clearCaptionFrames, prepareCaptions, writeCaptionFrame, writeCaptionList } from '../../src/main/captions'
import { collectDownload, type IngestEntry } from '@shared/ingest/collect'
import type { IngestRequest, LinkMeta } from '@shared/ingest/args'
import type { WordRun } from '@shared/ingest/captions'
import { linkCredit, runWords, type LinkClip, type TranscriptFrom } from '@shared/ingest/linkClip'
import { offsetIntoDownload } from '@shared/ingest/section'
import { runRange } from '@shared/ingest/wordRun'
import { buildRenderPlan } from '@shared/render/plan'
import { buildGraphicsSpec, captionsNeedBaking } from '@shared/graphics/fromTimeline'
import type { CaptionLayer } from '@shared/graphics/spec'
import { concatList, planCaptionBake } from '@shared/captions/bake'
import { resolveStyle, type StyleOverrides } from '@shared/captions/style'
import type { MediaAsset, Project } from '@shared/timeline'
import type { Transcript } from '@shared/transcript'
import type { Range } from '@shared/ingest/section'
import { FFMPEG, outputDir, run, writeNote } from './output'

/*
 * The render check for Clip it (docs/CLIPS.md §3b.8, §7.7): a link's run of
 * words, downloaded as its range, collected with its words, exported with
 * captions — and READ. Each caption line's first frame must be within one
 * frame of its word, judged against the picture.
 *
 * Nothing here is anyone's speech or footage. The "video" is made in the
 * test: 40 s at 30 fps, lossless, every frame naming itself in twelve bars
 * along the top (bar b white when bit b of the frame's index is set, as
 * exactCut.int's fixture) over a flat grey, with a quiet tone on its own
 * audio-only stream — a video-only and an audio-only file, as YouTube serves
 * them. The "transcript" is a json3 track in the measured ASR shape with a
 * made-up word every 15 to 25 frames, irregularly (`GAPS`): w01 at frame 25 …
 * w57 at frame 1176, each at floor(frame × 1000 / 30) ms, so its first frame
 * at or after its start is exactly its frame, and most sit between frames by
 * a fraction of a millisecond, as YouTube's do.
 *
 * The path is the app's, end to end, around one stand-in: the fake yt-dlp
 * (tests/fixtures/fake-yt-dlp.mjs) speaks yt-dlp's lines and CUTS the section
 * with the bundled ffmpeg (the binary `--ffmpeg-location` names) in the
 * two-input shape yt-dlp's FFmpegFD runs (EFFECTS.md §41): a re-encode for an
 * exact cut, `-c copy` for a fast one. Around it, the real pieces:
 *   - main's `ingest:meta` and `ingest:captions` handlers (the fake writes the
 *     json3; main parses it), `ingest:start`'s check (`startRequest`),
 *     `downloadMedia` with the app's argv, and `ingest:collect`
 *     (`collectDownload` with main's probe and `toAsset`);
 *   - the renderer's STORE behind a bridge of exactly those: Get transcript,
 *     a run picked, Clip it (`clipItFromLink`, exact, as the app defaults),
 *     then `collectIngest` — the asset, the clip, the run's words shifted onto
 *     the file's clock and the link's credit;
 *   - the export: main's `prepareCaptions` (the libass `subtitles` route, the
 *     .ass written as render:start writes it) and the canvas bake's plan
 *     (`buildGraphicsSpec` → `planCaptionBake` → `concatList`, main's
 *     `writeCaptionFrame` / `writeCaptionList`, the band overlaid as
 *     `captionOverlay`), each through `buildRenderPlan` and the bundled ffmpeg.
 *
 * The fast cut cannot go through `clipItFromLink`, whose cut is the constant
 * `CLIP_IT_EXACT` (true). It goes through `startIngest` with the override
 * `clipItFromLink` builds — the same pure pieces (`runRange`, `runWords`,
 * `linkCredit`) — with `exact: false` and `headOffsetMs =
 * offsetIntoDownload(range)`, as §3b.4 says Clip it would if the exact cut
 * were refused. The collect, and the trim to the requested range, are the
 * store's own.
 *
 * HOW A CAPTION IS READ. Each export is decoded whole, frame by frame
 * (`-vsync passthrough`, gray). The bars give every frame's SOURCE frame, so
 * a word's frame in the export is the frame whose picture is the word's
 * source frame — read off the picture, not computed from any offset the code
 * under test also computes; it is read in the captionless export, and every
 * captioned export must show the same source frame on every frame, so a
 * picture that moves against its captions cannot hide behind that export's
 * clean timing. Captions are read in a band of rows clear of the
 * bars, against the same edit exported WITHOUT captions:
 *   - libass draws real glyphs, one Dialogue per word (the whole line shown,
 *     the spoken word lit and enlarged). A frame has a caption when enough of
 *     the band differs from the captionless export; a line's first frame is
 *     where that begins after a blank; a word's is that, or a frame where the
 *     band differs from the frame before (the highlight moving on). Font and
 *     colours do not matter, so a machine without the style's font (CI: the
 *     asset library is not in the repo) reads the same way. Which words they
 *     are is told by WHEN: the spacing is irregular, so ten onsets within a
 *     frame of w31–w40's frames are w31–w40 — no other ten-word window comes
 *     within ten frames of that pattern (the fixture test checks it).
 *   - the bake's pictures are the renderer's to paint (a canvas, so Chromium);
 *     here each is a stand-in PNG, transparent but for white blocks that spell
 *     the lit word's own number, taken from the line's text as the painter
 *     takes it (`spec.content`, the picture's `word`). What is under test is
 *     the plan's timing through the concat demuxer and the overlay; the blocks
 *     say WHICH word is shown on every frame, so an extra, a missing or a
 *     wrong word cannot hide in a count.
 * Robust because it is relative twice over: to the picture for "when", and to
 * the captionless export for "is there a caption" — no glyph shapes, no
 * absolute levels, no encoder noise (two encodes of a flat grey agree within
 * a few levels; a caption differs by a hundred).
 *
 * Into tests/output/clipit/: the source, each download, each export, the .ass
 * and the bake's list (under userData/), per-frame readings, and a README.
 */

const FAKE = resolve(__dirname, '../fixtures/fake-yt-dlp.mjs')
const URL = 'https://www.youtube.com/watch?v=SynthTalk01'
const TITLE = 'A synthetic talk'
const CHANNEL = 'Synthetic channel'

const W = 640
const H = 360
const FPS = 30
const SECONDS = 40
const CANVAS = { width: W, height: H }

/** Twelve bars of 40 px across the top 48 rows: the frame's index, bit by bit. */
const BAR = 40
const BITS = 12
const BARS_H = 48

/**
 * The frames between one made-up word and the next: 15 to 25, irregular, so a
 * run's pattern of onsets is its own. Evenly spaced words would let a caption
 * track shifted by a whole number of words — another run's words, at the same
 * spacing — read as right. Drawn once from a seeded generator (mulberry32,
 * seed 116, the seed of 400 whose closest other ten-word window is furthest
 * from w31–w40's) and written out; the fixture test checks the property.
 */
const GAPS = [
  25, 24, 18, 22, 25, 15, 22, 21, 20, 22, 24, 20, 17, 23, 17, 16, 22, 23, 20, 17, 24, 24, 18, 21, 22, 15, 17, 18, 18,
  16, 25, 15, 15, 17, 22, 16, 22, 24, 23, 25, 19, 22, 25, 22, 19, 15, 20, 19, 25, 20, 25, 25, 24, 20, 25, 23, 16
]
const WORDS = GAPS.length
/** Word k's source frame: w01 at 25 … w57 at 1176. */
const FRAME = GAPS.reduce((acc, g) => [...acc, acc[acc.length - 1] + g], [0])
/** Its start, as json3 has it: whole ms, floored, so its first frame at or after is exactly FRAME[k] — and most sit a fraction of a ms before it, as YouTube's do. */
const wordMs = (k: number): number => Math.floor((FRAME[k] * 1000) / FPS)
const wordText = (k: number): string => `w${String(k).padStart(2, '0')}`
/** The first source frame at or after an instant — the first on which a word is being said. */
const frameAt = (ms: number): number => Math.ceil((ms * FPS) / 1000 - 1e-6)

/** The rows captions are read in: below the bars, round the lower third both routes draw in. */
const BAND_TOP = 190
const BAND_BOTTOM = 346

/**
 * The bake's band, and its stand-ins: eight block positions. A picture with a
 * word lit shows block 6 and the word's own number, read from the line's text,
 * in blocks 0–5 (bit b in block b); a line with no word lit shows block 7.
 */
const BAKE_Y = 264
const BAKE_H = 64
const SLOTS = 8
const WORD_FLAG = 6
const NO_WORD_FLAG = 7
const slotX = (k: number): number => 16 + 78 * k
const SLOT_W = 40

/** A pixel is a caption's when it differs from the captionless export by more than this. */
const PIXEL = 40
/** A frame shows a caption when this many band pixels are the caption's; a word starts where this many change. */
const INK_MIN = 40
const CHANGE_MIN = 40

let dir = ''
let media = ''
let videoPath = ''
let audioPath = ''
let json3Path = ''
let fontsDir = ''
const notes: string[] = []
/** What each leg's captionless export showed, for the notes that compare legs. */
const lengths: { exact?: { frames: number; first: number; last: number } } = {}
const savedEnv = { userData: process.env.FORGE_TEST_USERDATA, fonts: process.env.FORGE_FONTS_DIR }

/* ------------------------------------------------------------- the bridge */

const entries = new Map<string, IngestEntry>()
const downloads = new Map<string, Promise<void>>()
let jobSeq = 0
let fakeEnv: Record<string, string> = {}

/** The fake as a tool: node running it, its knobs handed over in the script (a file URL — Windows' ESM loader refuses a path). */
function tool(env: Record<string, string>): IngestTool {
  const assignments = Object.entries(env).map(([k, v]) => `process.env.${k}=${JSON.stringify(v)};`)
  return {
    command: process.execPath,
    prefixArgs: ['--input-type=module', '-e', `${assignments.join('')}await import(${JSON.stringify(pathToFileURL(FAKE).href)});`, '--']
  }
}

/** `ingest:collect`'s read: main's probe and `toAsset`, as ipc.ts's `readDownload`. */
async function readDownload(path: string, name: string, fps: number): Promise<MediaAsset> {
  const { ok, failed } = await probeMany([path])
  if (ok.length === 0) throw new Error(failed[0]?.error ?? 'Could not read the downloaded file')
  return toAsset({ ...ok[0], name }, fps)
}

function bridge(): Record<string, unknown> {
  const runs = new LinkRuns()
  const find = async (): Promise<IngestTool> => tool(fakeEnv)
  const meta = metaHandler(runs, find)
  const captions = captionsHandler(runs, find)
  const track = captionTrackHandler()
  return {
    ingestMeta: (url: string) => meta({ url }),
    ingestCaptions: (url: string, language: string) => captions({ url, language }),
    ingestCaptionTrack: (linkKey: string, key: string) => track({ linkKey, key }),
    // `ingest:start`: checked by main's own `startRequest`, then the download the job runs.
    startIngest: async (request: IngestRequest, clip?: LinkClip | null) => {
      const checked = startRequest(clip ? { ...request, clip } : request)
      const id = `job-${++jobSeq}`
      const entry: IngestEntry = { request: checked.request, outcome: null, clip: checked.clip }
      entries.set(id, entry)
      downloads.set(
        id,
        downloadMedia(checked.request, tool(fakeEnv), () => undefined).promise.then((outcome) => {
          entry.outcome = outcome
        })
      )
      return { id, presetId: 'ingest', status: 'queued' }
    },
    collectIngest: (jobId: string, fps: number) => collectDownload(entries, { jobId, fps }, readDownload)
  }
}

/* --------------------------------------------------------------- reading */

interface Reading {
  /** Each frame's source frame, off its bars. */
  index: number[]
  /** Rows BAND_TOP..BAND_BOTTOM of each frame, gray. */
  band: Buffer[]
}

/** Every frame of a file, in presentation order (edit lists honoured), as the bundled ffmpeg decodes it. */
async function readFrames(file: string, rows = H): Promise<Reading> {
  const crop = rows < H ? ['-vf', `crop=${W}:${rows}:0:0`] : []
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', ...crop, '-vsync', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024 }
  )
  const buf = stdout as unknown as Buffer
  const size = W * rows
  const index: number[] = []
  const band: Buffer[] = []
  for (let f = 0; (f + 1) * size <= buf.length; f++) {
    const at = f * size
    let n = 0
    for (let b = 0; b < BITS; b++) {
      // The bar's middle, away from its edges, where a lossy encode rings.
      let sum = 0
      let count = 0
      for (let y = BARS_H / 4; y < (3 * BARS_H) / 4; y++) {
        for (let x = b * BAR + BAR / 4; x < (b + 1) * BAR - BAR / 4; x++) {
          sum += buf[at + y * W + x]
          count++
        }
      }
      if (sum / count > 128) n |= 1 << b
    }
    index.push(n)
    if (rows === H) band.push(Buffer.from(buf.subarray(at + BAND_TOP * W, at + BAND_BOTTOM * W)))
  }
  return { index, band }
}

/** Band pixels that differ by more than PIXEL. */
function differing(a: Buffer, b: Buffer): number {
  let n = 0
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > PIXEL) n++
  return n
}

/**
 * What the bake shows on a frame, off its blocks: the lit word's number, 0 for
 * a line with no word lit, null for no caption, -1 for a pattern no stand-in has.
 */
function codeOn(cap: Buffer, plain: Buffer): number | null {
  let lit = 0
  for (let k = 0; k < SLOTS; k++) {
    let sum = 0
    let count = 0
    // The block's middle: band rows 24..40, its middle 20 columns.
    for (let y = BAKE_Y + 24 - BAND_TOP; y < BAKE_Y + 40 - BAND_TOP; y++) {
      for (let x = slotX(k) + 10; x < slotX(k) + SLOT_W - 10; x++) {
        sum += Math.abs(cap[y * W + x] - plain[y * W + x])
        count++
      }
    }
    if (sum / count > 60) lit |= 1 << k
  }
  if (lit === 0) return null
  if (lit === 1 << NO_WORD_FLAG) return 0
  const k = lit & 0b111111
  return lit === ((1 << WORD_FLAG) | k) && k > 0 ? k : -1
}

interface Seen {
  /** First frame of each line: a caption after a blank. */
  lines: number[]
  /** First frame of each word: a line's first, or a change inside one. */
  words: number[]
  /** For the bake: the word each onset showed, by its number. */
  codes?: (number | null)[]
  /** Per frame, for the record. */
  trace: string[]
}

function seenLibass(cap: Reading, plain: Reading): Seen {
  const ink = cap.band.map((b, f) => differing(b, plain.band[f]))
  const change = cap.band.map((b, f) => (f === 0 ? 0 : differing(b, cap.band[f - 1])))
  const lines: number[] = []
  const words: number[] = []
  const trace: string[] = ['frame,source,ink,change']
  for (let f = 0; f < ink.length; f++) {
    const on = ink[f] >= INK_MIN
    const fresh = on && (f === 0 || ink[f - 1] < INK_MIN)
    if (fresh) lines.push(f)
    if (fresh || (on && change[f] >= CHANGE_MIN)) words.push(f)
    trace.push(`${f},${cap.index[f]},${ink[f]},${change[f]}`)
  }
  return { lines, words, trace }
}

function seenBake(cap: Reading, plain: Reading): Seen {
  const code = cap.band.map((b, f) => codeOn(b, plain.band[f]))
  const lines: number[] = []
  const words: number[] = []
  const codes: (number | null)[] = []
  const trace: string[] = ['frame,source,word']
  for (let f = 0; f < code.length; f++) {
    const c = code[f]
    if (c !== null && (f === 0 || code[f - 1] === null)) lines.push(f)
    if (c !== null && (f === 0 || code[f - 1] !== c)) {
      words.push(f)
      codes.push(c)
    }
    trace.push(`${f},${cap.index[f]},${c ?? ''}`)
  }
  return { lines, words, codes, trace }
}

/** The captionless export's band holds the grey and nothing else: what reads as a caption is one. */
function bandIsBare(plain: Reading): number {
  let worst = 0
  for (const band of plain.band) {
    const sorted = Buffer.from(band).sort()
    const median = sorted[sorted.length >> 1]
    for (const v of band) worst = Math.max(worst, Math.abs(v - median))
  }
  return worst
}

/* -------------------------------------------------------------- fixtures */

/** Six words a line, ASR-shaped (EFFECTS.md §40): starts as tStartMs + tOffsetMs, a '\n' appended, confidence 0. */
function json3(): unknown {
  const events: Record<string, unknown>[] = [{ tStartMs: 0, dDurationMs: SECONDS * 1000, id: 1, wpWinPosId: 1, wsWinStyleId: 1 }]
  for (let first = 1; first <= WORDS; first += 6) {
    const ks = Array.from({ length: Math.min(6, WORDS - first + 1) }, (_, i) => first + i)
    const start = wordMs(first)
    const next = first + 6 <= WORDS ? wordMs(first + 6) : SECONDS * 1000
    events.push({
      tStartMs: start,
      dDurationMs: next - start + 1000,
      wWinId: 1,
      segs: ks.map((k, i) =>
        i === 0 ? { utf8: wordText(k), acAsrConf: 0 } : { utf8: ` ${wordText(k)}`, tOffsetMs: wordMs(k) - start, acAsrConf: 0 }
      )
    })
    events.push({ tStartMs: wordMs(ks[ks.length - 1]) + 300, dDurationMs: 1000, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] })
  }
  return { wireMagic: 'pb3', events }
}

/** CRC-32 as PNG wants it (ISO 3309), for the stand-ins' chunks. */
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(bytes: Buffer): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * A band-sized RGBA PNG, transparent but for opaque white blocks — what the
 * canvas would have painted, standing in for the words. Written here, byte by
 * byte, rather than by ffmpeg: one picture per word lit, and nothing else
 * decides what is in it.
 */
function bandPng(blocks: number[]): Buffer {
  const row = 1 + W * 4
  const raw = Buffer.alloc(row * BAKE_H)
  for (let y = 0; y < BAKE_H; y++) {
    for (const k of blocks) {
      if (y < 16 || y >= 48) continue
      for (let x = slotX(k); x < slotX(k) + SLOT_W; x++) raw.fill(255, y * row + 1 + x * 4, y * row + 1 + x * 4 + 4)
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(BAKE_H, 4)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8 bits, RGBA, deflate, no filter method, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** The stand-in for one picture of a line: its lit word's number in blocks 0–5 and block 6, block 7 for none lit, nothing for a blank. */
function standIn(text: string | null | undefined): Buffer {
  if (text === null) return bandPng([])
  if (text === undefined) return bandPng([NO_WORD_FLAG])
  const k = Number(/^w(\d+)$/.exec(text)?.[1] ?? 0)
  return bandPng([WORD_FLAG, ...Array.from({ length: 6 }, (_, b) => b).filter((b) => k & (1 << b))])
}

/* ------------------------------------------------------------- the legs */

/**
 * The renderer's store — `useEditor` itself, loaded when the check starts.
 *
 * By a specifier tsc does not follow, because the node project that checks
 * tests/ cannot compile renderer code (no DOM types; keyStore.test.ts), and
 * this check also needs main's modules, which the web project cannot. So the
 * part of the store it drives is typed here, and vitest loads the real one.
 */
const STORE_MODULE = '../../src/renderer/src/store'

interface UrlSourceView {
  linkKey: string
  url: string
  meta: LinkMeta | null
  fetchedAt: string | null
  transcript: Transcript | null
  tracks: { key: string; kind: 'asr' | 'lines' }[]
  status: string
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

interface Landed {
  project: Project
  asset: MediaAsset
  request: IngestRequest
  /** The source words the run picked, in order. */
  ks: number[]
}

/** Clip a run of words as the app does, into a new project, and collect it. */
async function clipRun(name: string, run: WordRun, exact: boolean): Promise<Landed> {
  state().newProject()
  state().addAnotherClip()
  state().setUrlRun(run)
  const before = jobSeq
  if (exact) {
    await state().clipItFromLink()
  } else {
    // clipItFromLink's override, with the fast cut's head.
    const source = state().urlSource!
    const t = source.transcript!
    const range = runRange(t, run)
    const transcriptFrom: TranscriptFrom = {
      linkKey: source.linkKey,
      keys: source.tracks.map((track) => track.key),
      range,
      run,
      headOffsetMs: offsetIntoDownload(range),
      words: runWords(t, run)
    }
    const credit = linkCredit(source.meta, source.url, source.fetchedAt ?? new Date().toISOString())
    await state().startIngest({ url: source.url, range, exact: false, clip: { transcriptFrom, credit } })
  }
  expect(jobSeq, `${name}: one job`).toBe(before + 1)
  const id = `job-${jobSeq}`
  await downloads.get(id)
  await state().collectIngest(id)
  const project = state().project
  expect.soft(state().notices.map((n) => n.text).filter((t) => /could not|failed|without its words/i.test(t)), `${name}: notices`).toEqual([])
  expect(project.assets, `${name}: one asset`).toHaveLength(1)
  const asset = project.assets[0]
  const download = join(dir, `${name}-download.mp4`)
  await copyFile(asset.path, download)
  return { project, asset, request: entries.get(id)!.request, ks: Array.from({ length: run.to - run.from + 1 }, (_, i) => run.from + 1 + i) }
}

type Route = 'plain' | 'libass' | 'bake'

/** The edit exported one way: its file, and what the plan said its length is. */
async function exportAs(name: string, project: Project, route: Route): Promise<{ file: string; frames: number }> {
  const file = join(dir, `${name}-${route}.mp4`)
  if (route === 'plain') {
    const plan = buildRenderPlan({ project: { ...project, captions: { ...project.captions, enabled: false } }, outputPath: file, canvas: CANVAS })
    await run(FFMPEG, plan.args, { maxBuffer: 64 * 1024 * 1024 })
    return { file, frames: plan.durationFrames }
  }
  if (route === 'libass') {
    // 'pop', a new project's style: flat, so the app burns it with libass (ExportStrip, captionNeedsCanvas).
    expect(captionsNeedBaking(project), 'pop is libass’s').toBe(false)
    // Null when there is nothing to burn — and then, as render:start does, the export goes without (the reading says so).
    const prepared = await prepareCaptions(project, CANVAS)
    if (prepared) await copyFile(prepared.subtitlesPath, join(dir, `${name}-captions.ass`))
    const plan = buildRenderPlan({
      project,
      outputPath: file,
      canvas: CANVAS,
      subtitlesPath: prepared?.subtitlesPath,
      // The app's folder in development (main/captions.ts); absent where the asset library is (CI), so libass's own fallback, as captions.int.
      fontsDir: prepared?.fontsDir && existsSync(prepared.fontsDir) ? prepared.fontsDir : undefined
    })
    await run(FFMPEG, plan.args, { maxBuffer: 64 * 1024 * 1024 })
    return { file, frames: plan.durationFrames }
  }
  // 'kinetic': animated, so the app bakes it on a canvas instead.
  const baked: Project = { ...project, captions: { ...project.captions, styleId: 'kinetic', overrides: {} } }
  expect(captionsNeedBaking(baked), 'kinetic is the bake’s').toBe(true)
  const spec = buildGraphicsSpec(baked, CANVAS)
  const layers = (spec?.layers ?? []).filter((l): l is CaptionLayer => l.kind === 'caption')
  const plan = spec ? planCaptionBake(layers, FPS, spec.durationFrames) : null
  if (!plan) {
    // Nothing to draw: bakeCaptions returns null and the export goes without an overlay (ExportStrip).
    const bare = buildRenderPlan({ project: baked, outputPath: file, canvas: CANVAS })
    await run(FFMPEG, bare.args, { maxBuffer: 64 * 1024 * 1024 })
    return { file, frames: bare.durationFrames }
  }
  await clearCaptionFrames()
  const files: string[] = []
  for (const [i, picture] of plan.pictures.entries()) {
    // The word the painter would light: the line's own text, by the picture's word — what bakeCaptions draws from (spec.content, highlight.word).
    const text = picture.layer < 0 ? null : picture.word < 0 ? undefined : (layers[picture.layer].spec.content.split(' ')[picture.word] ?? '')
    files.push(await writeCaptionFrame(i, standIn(text)))
  }
  const listPath = await writeCaptionList(concatList(plan, FPS, (p) => files[p]))
  await copyFile(listPath, join(dir, `${name}-bake-list.txt`))
  const render = buildRenderPlan({ project: baked, outputPath: file, canvas: CANVAS, captionOverlay: { listPath, y: BAKE_Y, height: BAKE_H } })
  await run(FFMPEG, render.args, { maxBuffer: 64 * 1024 * 1024 })
  return { file, frames: render.durationFrames }
}

/**
 * The whole check for one Clip it: the picture starts on the run's first word,
 * and on both routes every word's caption starts within one frame of the frame
 * showing that word — so every line's does — with no word missing or extra.
 */
async function check(
  name: string,
  landed: Landed,
  routes: readonly ('libass' | 'bake')[] = ['libass', 'bake']
): Promise<{ frames: number; first: number; last: number }> {
  const { project, ks } = landed
  const plainOut = await exportAs(name, project, 'plain')
  const plain = await readFrames(plainOut.file)

  // The picture: the run's first word's source frame first, and frame for frame from there.
  const first = frameAt(wordMs(ks[0]))
  expect.soft(plain.index.length, `${name}: frames exported`).toBe(plainOut.frames)
  expect.soft(plain.index[0], `${name}: the clip's first frame shows source frame`).toBe(first)
  expect.soft(plain.index, `${name}: frame for frame`).toEqual(plain.index.map((_, i) => first + i))
  expect.soft(bandIsBare(plain), `${name}: the captionless band holds only the grey`).toBeLessThan(PIXEL)

  // Where each word is said, in the export: the frame showing its source frame.
  const wordFrames = ks.map((k) => plain.index.indexOf(frameAt(wordMs(k))))
  notes.push(`- ${name}: run ${wordText(ks[0])}–${wordText(ks[ks.length - 1])}; export ${plain.index.length} frames, source ${plain.index[0]}…${plain.index[plain.index.length - 1]}`)

  for (const route of routes) {
    const out = await exportAs(name, project, route)
    const cap = await readFrames(out.file)
    expect.soft(cap.index.length, `${name} ${route}: frames exported`).toBe(out.frames)
    // The words' frames are read off the captionless export, so the captioned one must show the same picture on
    // every frame — or a picture that moved against its own captions (a frame late under the overlay) reads as right.
    expect.soft(cap.index, `${name} ${route}: the same frames as the captionless export`).toEqual(plain.index)
    const seen = route === 'libass' ? seenLibass(cap, plain) : seenBake(cap, plain)
    await writeFile(join(dir, `${name}-${route}-frames.csv`), `${seen.trace.join('\n')}\n`)
    const styleId = route === 'libass' ? project.captions.styleId : 'kinetic'
    const perLine = resolveStyle(styleId, (route === 'libass' ? project.captions.overrides : {}) as StyleOverrides | undefined).wordsPerLine
    const lineFrames = wordFrames.filter((_, i) => i % perLine === 0)

    if (route === 'libass') {
      // The margins the thresholds sit in, for the record: what a blank or a held frame reads, against a caption and a word lit.
      const parsed = seen.trace.slice(1).map((l) => l.split(',').map(Number))
      const onsets = new Set(seen.words)
      const blank = parsed.filter((p) => p[2] < INK_MIN).map((p) => p[2])
      const shown = parsed.filter((p) => p[2] >= INK_MIN)
      const held = shown.filter((p) => !onsets.has(p[0])).map((p) => p[3])
      const lit = shown.filter((p) => onsets.has(p[0]) && p[0] > 0).map((p) => p[3])
      notes.push(
        `  - libass margins: a blank frame reads at most ${Math.max(0, ...blank)} caption pixels, a captioned one at least ${Math.min(...shown.map((p) => p[2]))}; ` +
          `a held frame changes at most ${Math.max(0, ...held)}, a word onset at least ${lit.length ? Math.min(...lit) : '—'}`
      )
    }
    const rows = ks.map((k, i) => {
      const at = seen.words[i]
      return `${wordText(k)} at export frame ${wordFrames[i]}: caption ${at ?? 'none'}${at === undefined ? '' : ` (${at - wordFrames[i] >= 0 ? '+' : ''}${at - wordFrames[i]})`}`
    })
    notes.push(
      `  - ${route} (${styleId}, ${perLine} words a line): lines first seen at ${seen.lines.join(', ') || 'none'} against ${lineFrames.join(', ')}; ` +
        `${seen.words.length} word onsets for ${ks.length} words${seen.codes ? `, showing ${seen.codes.map((c) => (c === null ? '-' : c > 0 ? wordText(c) : c === 0 ? 'no word' : '?')).join(',')}` : ''}`,
      `    ${rows.join('; ')}`
    )

    // Every word, then every line: as many as the run has, each within a frame of its word.
    expect.soft(seen.words.length, `${name} ${route}: caption words seen (onsets ${seen.words.join(',')})`).toBe(ks.length)
    for (const [i, frame] of wordFrames.entries()) {
      expect.soft(frame, `${name}: ${wordText(ks[i])} is on screen`).toBeGreaterThanOrEqual(0)
      expect.soft(Math.abs((seen.words[i] ?? Infinity) - frame), `${name} ${route}: ${wordText(ks[i])}'s caption at ${seen.words[i]}, its word at ${frame}`).toBeLessThanOrEqual(1)
    }
    expect.soft(seen.lines.length, `${name} ${route}: caption lines seen (at ${seen.lines.join(',')})`).toBe(lineFrames.length)
    for (const [j, frame] of lineFrames.entries()) {
      expect.soft(Math.abs((seen.lines[j] ?? Infinity) - frame), `${name} ${route}: line ${j + 1} first seen at ${seen.lines[j]}, its word at ${frame}`).toBeLessThanOrEqual(1)
    }
    // The bake says WHICH word, by its own text: the onsets show the run's words, in order, and nothing else.
    if (seen.codes) expect.soft(seen.codes, `${name} bake: the word each onset shows`).toEqual(ks)
  }
  return { frames: plain.index.length, first: plain.index[0], last: plain.index[plain.index.length - 1] }
}

/* ----------------------------------------------------------------- setup */

beforeAll(async () => {
  dir = await outputDir('clipit')
  media = join(dir, 'media')
  await mkdir(media, { recursive: true })
  // The stub's userData is `<this>/userData`: the .ass, the bake's pictures and list, the downloads and the caption cache land there.
  process.env.FORGE_TEST_USERDATA = dir
  // The app's fonts folder in development (main/captions.ts: <app>/assets/fonts); the stub has no getAppPath.
  fontsDir = resolve(__dirname, '../../assets/fonts')
  process.env.FORGE_FONTS_DIR = fontsDir

  videoPath = join(media, 'video.mp4')
  audioPath = join(media, 'audio.m4a')
  json3Path = join(media, 'talk.en-orig.json3')
  // Lossless; keyframes every 3 s and nowhere else, so neither cut's start (20.666 s, its pad at 10.666 s) is one.
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=black:s=${W}x${BARS_H}:rate=${FPS}:duration=${SECONDS}`,
    '-vf', `geq=lum='if(mod(floor(N/pow(2,floor(X/${BAR}))),2)*lt(X,${BAR * BITS}),235,16)':cb=128:cr=128,pad=${W}:${H}:0:0:color=0x808080`,
    '-c:v', 'libx264', '-qp', '0', '-g', String(3 * FPS), '-keyint_min', String(3 * FPS), '-sc_threshold', '0',
    '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', videoPath
  ])
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${SECONDS}:sample_rate=48000`,
    '-af', 'volume=0.05', '-c:a', 'aac', '-b:a', '128k', audioPath
  ])
  await writeFile(json3Path, JSON.stringify(json3()))

  fakeEnv = {
    FAKE_TITLE: TITLE,
    FAKE_META: JSON.stringify({ id: 'SynthTalk01', title: TITLE, duration: SECONDS, language: 'en', chapters: [], channel: CHANNEL, uploader: 'Synthetic uploader' }),
    FAKE_JSON3: json3Path,
    FAKE_SUBS: 'en,en-orig',
    FAKE_SECTION_VIDEO: videoPath,
    FAKE_SECTION_AUDIO: audioPath
  }
  vi.stubGlobal('window', { forge: bridge() })
  store = ((await import(/* @vite-ignore */ STORE_MODULE)) as { useEditor: NonNullable<typeof store> }).useEditor
  store.setState(store.getInitialState())

  // Get transcript, as the URL tile does.
  state().setIngest({ url: URL })
  await state().getTranscript()
}, 300_000)

afterAll(async () => {
  vi.unstubAllGlobals()
  if (savedEnv.userData === undefined) delete process.env.FORGE_TEST_USERDATA
  else process.env.FORGE_TEST_USERDATA = savedEnv.userData
  if (savedEnv.fonts === undefined) delete process.env.FORGE_FONTS_DIR
  else process.env.FORGE_FONTS_DIR = savedEnv.fonts
  if (!dir) return
  await writeNote(dir, [
    '# clipit — Clip it, exported with its captions, read back',
    '',
    `Platform ${process.platform}; ffmpeg ${FFMPEG}; libass fonts from ${existsSync(fontsDir) ? fontsDir : 'libass’s own fallback (no assets/fonts here)'}.`,
    '',
    'media/: the "video" (640×360, 30 fps, 40 s, lossless, frame N names itself in twelve bars on top; flat grey below; keyframes every 3 s),',
    'its audio-only stream (a 440 Hz tone at -26 dBFS), and the json3 track the fake yt-dlp serves: w01…w57, 15 to 25 frames apart, irregularly,',
    'word k at floor(frame × 1000 / 30) ms so its first frame is its own. Main parses it; the store picks a run, clips it (Clip download) and',
    'collects it; the fake cuts the section with the bundled ffmpeg in yt-dlp’s two-input shape (EFFECTS.md §41). Each export is read frame by',
    'frame: the bars say which source frame each export frame shows, so a word’s frame is the frame showing its source frame; a caption is read in',
    'rows 190–345 against the same edit exported without captions — libass: a caption after a blank is a line, a change inside one the next word',
    'lit, and which words they are is told by the irregular spacing; the bake: stand-in pictures whose white blocks spell the lit word’s number,',
    'taken from the line’s text. A pixel is a caption’s past 40 levels; a frame has a caption at 40 such pixels, a word starts where 40 change.',
    'Files: <leg>-download.mp4 (what was collected), <leg>-{plain,libass,bake}.mp4, <leg>-captions.ass, <leg>-bake-list.txt,',
    '<leg>-<route>-frames.csv (per frame: source frame, then caption pixels and change, or the word the bake shows),',
    'userData/ (the app’s: the caption cache, the downloads, the .ass, the bake’s pictures).',
    '',
    ...notes,
    '',
    'History, not this run: this check found the bake ending an export at its last caption (EFFECTS.md §42: the one-word clip, 8 of 30',
    'frames, measured before §43); §43 is the fix and has its own check (captionBakeLength.int). This run’s one-word bake length is on that',
    'leg’s "bake:" line above. Where the bake reads a word a frame early or late, it is §42’s 40 ms grid: the concat input is the first PNG’s',
    'stream, image2 at its default 25 fps, so a picture starts on the nearest 1/25 s; libass, timed by each frame’s pts, is not.'
  ])
})

/* ----------------------------------------------------------------- tests */

describe('Clip it, exported with its captions — each line within a frame of its word', () => {
  it('the fixture: every source frame names itself, and the link’s words are the synthetic ones, where they were put', async () => {
    const source = await readFrames(videoPath, BARS_H)
    expect(source.index).toEqual(Array.from({ length: SECONDS * FPS }, (_, i) => i))
    const u = state().urlSource
    expect(u?.status).toBe('ready')
    const words = u!.transcript!.words
    expect(words.map((w) => w.text)).toEqual(Array.from({ length: WORDS }, (_, i) => wordText(i + 1)))
    expect(words.map((w) => w.startMs)).toEqual(Array.from({ length: WORDS }, (_, i) => wordMs(i + 1)))
    expect(words.map((w) => frameAt(w.startMs))).toEqual(FRAME.slice(1))
    expect(u!.tracks.map((t) => t.key).sort()).toEqual(['en', 'en-orig'])
    // The run's spacing is its own: every other ten-word window, relative to its first word, strays from w31–w40's
    // pattern by more than the frame a reading may be off on each side — so ten onsets on that pattern are those words.
    const shape = (s: number): number[] => Array.from({ length: 10 }, (_, i) => FRAME[s + i] - FRAME[s])
    let closest = Infinity
    for (let s = 1; s + 9 <= WORDS; s++) {
      if (s !== 31) closest = Math.min(closest, Math.max(...shape(s).map((v, i) => Math.abs(v - shape(31)[i]))))
    }
    expect(closest, 'the closest other ten-word window, in frames').toBeGreaterThan(2)
    notes.push(`- the spacing: every other ten-word window strays from w31–w40's pattern by at least ${closest} frames somewhere`)
    notes.push(`- the transcript: ${words.length} words from main's parse of the fake's json3; ${wordText(31)} at ${wordMs(31)} ms (source frame ${frameAt(wordMs(31))}), ends ${words[30].endMs} ms`)
  })

  it('an EXACT cut (Clip it’s default): w31–w40, the clip opens on w31’s frame and each caption on its word', async () => {
    const landed = await clipRun('exact', { from: 30, to: 39 }, true)
    const { project, asset, request } = landed
    const clip = project.clips[0]
    expect.soft(request.exact).toBe(true)
    expect.soft(request.range).toEqual({ startMs: wordMs(31), endMs: wordMs(40) + 240 })
    // The words: exactly the run's, on the file's clock (an exact cut's head is 0).
    const t = project.transcripts[asset.id]
    expect.soft(t.words.map((w) => w.text)).toEqual(landed.ks.map(wordText))
    expect.soft(t.words.map((w) => w.startMs)).toEqual(landed.ks.map((k) => wordMs(k) - wordMs(31)))
    // The link's credit, on the asset, from the link's own metadata.
    expect.soft(asset.credit).toMatchObject({ source: 'link', title: TITLE, author: CHANNEL, pageUrl: parseLinkUrl() })
    expect.soft(asset.credit?.line).toBe(`${TITLE} — ${CHANNEL}, ${parseLinkUrl()}`)
    expect.soft(clip).toMatchObject({ start: 0, inPoint: 0 })
    const got = await readFrames(asset.path, BARS_H)
    notes.push(`- exact: section *${(wordMs(31) / 1000).toFixed(3)}-${((wordMs(40) + 240) / 1000).toFixed(3)}, the download's first frame is source ${got.index[0]}; clip in-point ${clip.inPoint}, ${clip.duration} frames`)
    expect.soft(got.index[0], 'the exact download’s first frame').toBe(frameAt(wordMs(31)))
    lengths.exact = await check('exact', landed)
  })

  it('a FAST cut: the same run, padded and copied, the in-point and the words both moved by the head', async () => {
    const landed = await clipRun('fast', { from: 30, to: 39 }, false)
    const { project, asset, request } = landed
    const clip = project.clips[0]
    const range = { startMs: wordMs(31), endMs: wordMs(40) + 240 }
    const head = offsetIntoDownload(range)
    expect.soft(request.exact).toBe(false)
    expect.soft(request.range).toEqual(range)
    const t = project.transcripts[asset.id]
    expect.soft(t.words.map((w) => w.text)).toEqual(landed.ks.map(wordText))
    // On the FILE's clock: the range's start sits `head` into the padded file.
    expect.soft(t.words.map((w) => w.startMs)).toEqual(landed.ks.map((k) => wordMs(k) - range.startMs + head))
    expect.soft(clip.inPoint).toBe(Math.round((head / 1000) * FPS))
    const got = await readFrames(asset.path, BARS_H)
    notes.push(`- fast: section *${((range.startMs - 10_000) / 1000).toFixed(3)}-${((range.endMs + 10_000) / 1000).toFixed(3)}, the download's first frame is source ${got.index[0]}; head ${head} ms, clip in-point ${clip.inPoint}, ${clip.duration} frames`)
    // The copy starts on the first frame at or after the padded start (EFFECTS.md §41), the edit list hiding the GOP before it.
    expect.soft(got.index[0], 'the fast download’s first frame').toBe(frameAt(range.startMs - head))
    await check('fast', landed)
    // For the record, not asserted: one range, two lengths. The exact file holds every source frame that starts
    // inside the range; the fast clip is trimToRequestedRange's round(range × fps) frames from the in-point.
    if (lengths.exact) {
      const raw = ((range.endMs - range.startMs) * FPS) / 1000
      notes.push(
        `- one range, two lengths: exact ${lengths.exact.frames} frames (source ${lengths.exact.first}…${lengths.exact.last}), fast ${clip.duration} ` +
          `(the range is ${raw.toFixed(2)} frames, rounded to ${Math.round(raw)}; the last source frame starting inside it is ${frameAt(range.endMs) - 1})`
      )
    }
  })

  it('a ONE-WORD run (exact): fetched a second long, which reaches the next word — and only the picked word is captioned', async () => {
    // w46 alone: its range is stretched to MIN_RANGE_MS, so w47 (667 ms on) is in the file but not in the run.
    const landed = await clipRun('one-word', { from: 45, to: 45 }, true)
    const { project, asset, request } = landed
    expect.soft(request.range).toEqual({ startMs: wordMs(46), endMs: wordMs(46) + 1000 })
    expect.soft(wordMs(47)).toBeLessThan(request.range!.endMs)
    expect.soft(project.transcripts[asset.id].words.map((w) => w.text)).toEqual([wordText(46)])
    /*
     * Both routes. This leg is the one that caught the bake ending an export
     * where its last caption did (EFFECTS.md §42: this 30-frame clip came out
     * 8 frames long through the bake, planned to the last line's end and
     * overlaid `shortest=1`). §43 plans the bake to the edit's end, so the
     * bake now keeps all 30 frames here; `check` asserts the frame count
     * against the plan on both routes, so this leg guards §43 as well.
     */
    await check('one-word', landed)
  })
})

/** The link as yt-dlp's metadata names it: the canonical watch URL (the fake prints it as `webpage_url`). */
function parseLinkUrl(): string {
  return state().urlSource?.url ?? URL
}
