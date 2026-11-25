import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LinkRuns, captionTrackHandler, captionsHandler, metaHandler } from '../../src/main/ingest/meta'
import { downloadMedia, type IngestTool } from '../../src/main/ingest/download'
import { startRequest } from '../../src/main/ingest/start'
import { probeMany } from '../../src/main/ffmpeg/probe'
import { toAsset } from '../../src/main/assets'
import { prepareCaptions } from '../../src/main/captions'
import { collectDownload, type IngestEntry } from '@shared/ingest/collect'
import type { IngestRequest } from '@shared/ingest/args'
import type { LinkClip } from '@shared/ingest/linkClip'
import { buildRenderPlan } from '@shared/render/plan'
import { captionsNeedBaking } from '@shared/graphics/fromTimeline'
import { resolveStyle, type StyleOverrides } from '@shared/captions/style'
import { STEP_TEXT, graphicsResultText, type CardClipRecord } from '@shared/bestclips/cardClip'
import type { BestClipCard, BestClipsResult } from '@shared/bestclips/run'
import type { MediaAsset, Project } from '@shared/timeline'
import type { Transcript } from '@shared/transcript'
import { FFMPEG, outputDir, run, writeNote } from './output'

/*
 * The render check for Clip it FROM A CARD (docs/CLIPS.md §7.7's render check,
 * §7.5 steps 0 to 5), in the manner of clipIt.int: a made-up talk long enough
 * for 1-minute windows, Analyse (no model: the signals' three), Clip it on a
 * card through the REAL store, the card's exact range "downloaded" by the fake
 * yt-dlp (tests/fixtures/fake-yt-dlp.mjs, which cuts with the bundled ffmpeg
 * in yt-dlp's two-input shape), collected with its shifted words — then the
 * steps after it as the store runs them (no AI helper in the suite: the crop
 * stays centred, said; captions on; graphics) — and exported with the bundled
 * ffmpeg at the project's own shape, and READ.
 *
 * What is read, off the PICTURE (never the code's own numbers):
 *   - the export is portrait, 9:16 (ffprobe's size of the file);
 *   - which source frame each export frame shows, from thirteen bars along the
 *     top of the source, placed inside the middle 182 px of its 640 so they
 *     survive a centred 9:16 crop (202.5 px of 640) and nothing else: the
 *     clip's first frame must be the card's first word's frame;
 *   - WHERE the frame was cut from: a ramp under the bars whose level says
 *     its own source column (16 at column 160, 235 at 480, 0.684 levels a
 *     column). The export's left edge, middle and right edge must read the
 *     centred crop's columns (218.75, 320, 421.25) within 4 columns: a
 *     letterboxed whole frame reads 16 and 235 at its edges, an uncentred crop
 *     another middle;
 *   - captions: the empty project's captions are turned OFF before Clip it
 *     (a new project's are on already, so step 4 would otherwise change
 *     nothing), and step 4 must turn them on in one undo step of its own;
 *   - the captions, libass ('pop', a new project's style, flat on Latin
 *     words), against the same edit exported without them: the first line's
 *     first frame within one frame of the frame showing its first word, and
 *     every word lit in the first CHECK_SECONDS likewise.
 *
 * The 2018 Windows ffmpeg (CI): the source is made with color, geq (N, X, if,
 * lt, gt, mod, floor, pow), pad and overlay, all of 2018 or
 * older (EFFECTS.md §25); the export is the app's own plan. Every path goes
 * through argv, never a filtergraph, except what the app's plan writes (its
 * own escaping, tests/integration/filterPath.int.test.ts).
 *
 * Graphics: the step runs (the baseline, there being no model), and its line
 * is asserted; the graphics it may place are left out of the export (their
 * pictures are the renderer's canvas to draw, and graphic.int is their render
 * check), so what is read here is the clip, its crop and its captions.
 *
 * Into tests/output/bestclips-card/: the source, the download, both exports,
 * the .ass, per-frame readings and a README.
 */

const FAKE = resolve(__dirname, '../fixtures/fake-yt-dlp.mjs')
const URL = 'https://www.youtube.com/watch?v=SynthCards1'
const TITLE = 'A synthetic talk for cards'
const CHANNEL = 'Synthetic channel'

const W = 640
const H = 360
const FPS = 30
const SECONDS = 140

/** Thirteen bars of 14 px, x 229..410 (4,200 frames need 13 bits), across the top 48 rows: the frame's index, bit by bit. */
const BITS = 13
const BAR = 14
const BAR_X = 229
const BARS_H = 48
/** The ramp: rows 48..111, its level its own column between 160 and 480. */
const RAMP_Y = 48
const RAMP_H = 64
const RAMP_FROM = 160
const RAMP_TO = 480
/**
 * A column from the ramp's level as READ: every reading here decodes to gray, and ffmpeg's yuv → gray stretches Y's 16..235 to
 * 0..255 (measured on this source: Y 43, 70, 125, 180 at columns 200, 240, 320, 400 read 31, 63, 127, 191 as gray).
 */
const columnOf = (gray: number): number => RAMP_FROM + (gray * (RAMP_TO - RAMP_FROM)) / 255

/** The export's height; its width is the project's shape at that height. */
const OUT_H = 512
/** A centred 9:16 crop of 640×360, by its definition: 202.5 columns about column 320. */
const CROP_W = (H * 9) / 16
const CROP_X = (W - CROP_W) / 2
/** The export's columns the edges are read at: this far in, clear of the scaler's edge. */
const EDGE = 3
/** How far the edges and middle may read from the centred crop's, in source columns. */
const COLUMN_SLACK = 4
/** The captions are read over the export's first seconds: its first line and every word lit in them. */
const CHECK_SECONDS = 12

/** A pixel is a caption's when it differs from the captionless export by more than this. */
const PIXEL = 40
const INK_MIN = 40
const CHANGE_MIN = 40

/** mulberry32. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/*
 * The words: made up, every 15 to 25 frames, irregularly (so a run of onsets
 * is told by its spacing, as clipIt.int's are), in sentences of 6 to 11
 * words each ending on '.', so windows start on sentence starts. No digit in
 * any word: the graphics step's baseline then has no number to place.
 */
const VOCAB = ['zor', 'plim', 'tavek', 'mubo', 'senra', 'kilo', 'drav', 'oppen', 'vestra', 'nim', 'rulo', 'fesh', 'gandu', 'brel']
const draw = rng(4242)
const GAPS: number[] = []
const ENDS = new Set<number>()
{
  let frame = 0
  let left = 6 + Math.floor(draw() * 6)
  for (let k = 1; ; k++) {
    const gap = 15 + Math.floor(draw() * 11)
    if (frame + gap > (SECONDS - 2) * FPS) break
    frame += gap
    GAPS.push(gap)
    if (--left === 0) {
      ENDS.add(k)
      left = 6 + Math.floor(draw() * 6)
    }
  }
}
const WORDS = GAPS.length
ENDS.add(WORDS)
/** Word k's source frame (k from 1). */
const FRAME = GAPS.reduce((acc, g) => [...acc, acc[acc.length - 1] + g], [0])
const wordMs = (k: number): number => Math.floor((FRAME[k] * 1000) / FPS)
const wordText = (k: number): string => VOCAB[(k * 5) % VOCAB.length] + (ENDS.has(k) ? '.' : '')
/** The first source frame at or after an instant. */
const frameAt = (ms: number): number => Math.ceil((ms * FPS) / 1000 - 1e-6)

let dir = ''
let media = ''
let videoPath = ''
let audioPath = ''
let json3Path = ''
const notes: string[] = []
const savedEnv = { userData: process.env.FORGE_TEST_USERDATA, fonts: process.env.FORGE_FONTS_DIR }

/* ------------------------------------------------------------- the bridge */

const entries = new Map<string, IngestEntry>()
const downloads = new Map<string, Promise<void>>()
let jobSeq = 0
let fakeEnv: Record<string, string> = {}

function tool(env: Record<string, string>): IngestTool {
  const assignments = Object.entries(env).map(([k, v]) => `process.env.${k}=${JSON.stringify(v)};`)
  return {
    command: process.execPath,
    prefixArgs: ['--input-type=module', '-e', `${assignments.join('')}await import(${JSON.stringify(pathToFileURL(FAKE).href)});`, '--']
  }
}

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
    collectIngest: (jobId: string, fps: number) => collectDownload(entries, { jobId, fps }, readDownload),
    // No model in the suite: main's status says so, and a complete would throw (Analyse never asks: no model is ready).
    directorStatus: async () => [{ id: 'openai', label: 'Local server', kind: 'local', ready: false, reason: 'no model in the suite' }],
    directorSettings: async () => ({ provider: 'auto', ollama: { baseUrl: '', model: '' }, openai: { baseUrl: '', model: '', hasKey: false } }),
    directorComplete: async () => {
      throw new Error('no model in the suite')
    }
  }
}

/* ------------------------------------------------------------- the store */

/* As clipIt.int: by a specifier tsc does not follow; the part driven is typed here. */
const STORE_MODULE = '../../src/renderer/src/store'

interface StoreView {
  project: Project
  aspect: string
  notices: { text: string }[]
  urlSource: { linkKey: string; transcript: Transcript | null; status: string } | null
  bestClips: { last: { result: BestClipsResult } | null }
  bestClipsClipped: Record<string, CardClipRecord>
  setIngest(patch: { url: string }): void
  getTranscript(language?: string): Promise<void>
  setBestClipsLength(ms: number): void
  analyseBestClips(): Promise<void>
  clipItFromCard(card: BestClipCard): Promise<void>
  collectIngest(jobId: string): Promise<void>
  setReframeHelper(helper: 'missing' | 'ready' | 'unknown'): void
  setCaptionsEnabled(enabled: boolean): void
  past: unknown[]
}

let store: { getState(): StoreView; setState(next: unknown): void; getInitialState(): unknown } | null = null
const state = (): StoreView => store!.getState()

/* --------------------------------------------------------------- reading */

interface Reading {
  width: number
  height: number
  /** Each frame's source frame, off its bars. */
  index: number[]
  /** Each frame's source column at the export's left edge, middle and right edge, off the ramp. */
  columns: [number, number, number][]
  /** The rows below the ramp, gray. */
  band: Buffer[]
}

/** The export's first `seconds`, frame by frame (gray), as the bundled ffmpeg decodes it. */
async function readExport(file: string, seconds: number): Promise<Reading> {
  const { ok } = await probeMany([file])
  const width = ok[0]?.width ?? 0
  const height = ok[0]?.height ?? 0
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-t', String(seconds), '-map', '0:v:0', '-vsync', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024 }
  )
  const buf = stdout as unknown as Buffer
  const size = width * height
  const scaleX = width / CROP_W
  const scaleY = height / H
  const index: number[] = []
  const columns: [number, number, number][] = []
  const band: Buffer[] = []
  // Where the centred crop puts each bar, and the ramp's middle row: from the crop's definition, not the code's.
  const barX = (b: number): number => Math.round((BAR_X + BAR * b + BAR / 2 - CROP_X) * scaleX)
  const barRows = [Math.round(14 * scaleY), Math.round(34 * scaleY)]
  const rampRow = Math.round((RAMP_Y + RAMP_H / 2) * scaleY)
  const bandTop = Math.round((RAMP_Y + RAMP_H + 8) * scaleY)
  for (let f = 0; size > 0 && (f + 1) * size <= buf.length; f++) {
    const at = f * size
    let n = 0
    for (let b = 0; b < BITS; b++) {
      let sum = 0
      let count = 0
      for (let y = barRows[0]; y < barRows[1]; y++) {
        for (let x = barX(b) - 4; x <= barX(b) + 4; x++) {
          sum += buf[at + y * width + x]
          count++
        }
      }
      if (sum / count > 128) n |= 1 << b
    }
    index.push(n)
    const level = (x: number): number => {
      let sum = 0
      let count = 0
      for (let y = rampRow - 4; y <= rampRow + 4; y++) {
        sum += buf[at + y * width + x]
        count++
      }
      return sum / count
    }
    columns.push([columnOf(level(EDGE)), columnOf(level(width >> 1)), columnOf(level(width - 1 - EDGE))])
    band.push(Buffer.from(buf.subarray(at + bandTop * width, at + height * width)))
  }
  return { width, height, index, columns, band }
}

function differing(a: Buffer, b: Buffer): number {
  let n = 0
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > PIXEL) n++
  return n
}

/** libass's captions against the captionless export: a caption after a blank is a line; a change inside one is the next word lit. */
function onsets(cap: Reading, plain: Reading): { lines: number[]; words: number[]; trace: string[] } {
  const frames = Math.min(cap.band.length, plain.band.length)
  const lines: number[] = []
  const words: number[] = []
  const trace = ['frame,source,ink,change,left,middle,right']
  let wasOn = false
  for (let f = 0; f < frames; f++) {
    const ink = differing(cap.band[f], plain.band[f])
    const change = f === 0 ? 0 : differing(cap.band[f], cap.band[f - 1])
    const on = ink >= INK_MIN
    if (on && !wasOn) lines.push(f)
    if ((on && !wasOn) || (on && change >= CHANGE_MIN)) words.push(f)
    wasOn = on
    trace.push(`${f},${cap.index[f]},${ink},${change},${cap.columns[f].map((c) => c.toFixed(1)).join(',')}`)
  }
  return { lines, words, trace }
}

/* -------------------------------------------------------------- fixtures */

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
      segs: ks.map((k, i) => (i === 0 ? { utf8: wordText(k), acAsrConf: 0 } : { utf8: ` ${wordText(k)}`, tOffsetMs: wordMs(k) - start, acAsrConf: 0 }))
    })
    events.push({ tStartMs: wordMs(ks[ks.length - 1]) + 300, dDurationMs: 1000, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] })
  }
  return { wireMagic: 'pb3', events }
}

const until = async (test: () => boolean, ms: number, what: string): Promise<void> => {
  const stop = Date.now() + ms
  while (!test()) {
    if (Date.now() > stop) throw new Error(`${what} did not happen in ${ms / 1000} s`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

/* ----------------------------------------------------------------- setup */

beforeAll(async () => {
  dir = await outputDir('bestclips-card')
  media = join(dir, 'media')
  await mkdir(media, { recursive: true })
  process.env.FORGE_TEST_USERDATA = dir
  process.env.FORGE_FONTS_DIR = resolve(__dirname, '../../assets/fonts')

  videoPath = join(media, 'video.mp4')
  audioPath = join(media, 'audio.m4a')
  json3Path = join(media, 'talk.en-orig.json3')
  // Lossless; keyframes every 3 s and nowhere else, so a card's start is not one. The ramp is drawn in Y as the bars are (a PNG
  // between would carry it through RGB and stretch its levels to full range: measured, 30 at column 200 for 43).
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=black:s=${BAR * BITS}x${BARS_H}:rate=${FPS}:duration=${SECONDS}`,
    '-f', 'lavfi', '-i', `color=c=black:s=${W}x${RAMP_H}:rate=${FPS}:duration=${SECONDS}`,
    '-filter_complex',
    `[0:v]geq=lum='if(mod(floor(N/pow(2,floor(X/${BAR}))),2),235,16)':cb=128:cr=128,pad=${W}:${H}:${BAR_X}:0:color=0x808080[top];` +
      `[1:v]geq=lum='if(lt(X,${RAMP_FROM}),16,if(gt(X,${RAMP_TO - 1}),235,16+(X-${RAMP_FROM})*219/${RAMP_TO - RAMP_FROM}))':cb=128:cr=128[ramp];` +
      `[top][ramp]overlay=0:${RAMP_Y}[v]`,
    '-map', '[v]',
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
    FAKE_META: JSON.stringify({ id: 'SynthCards1', title: TITLE, duration: SECONDS, language: 'en', chapters: [], channel: CHANNEL, uploader: 'Synthetic uploader' }),
    FAKE_JSON3: json3Path,
    FAKE_SUBS: 'en,en-orig',
    FAKE_SECTION_VIDEO: videoPath,
    FAKE_SECTION_AUDIO: audioPath
  }
  vi.stubGlobal('window', { forge: bridge() })
  store = ((await import(/* @vite-ignore */ STORE_MODULE)) as { useEditor: NonNullable<typeof store> }).useEditor
  store.setState(store.getInitialState())
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
    '# bestclips-card — Clip it from a Best clips card, exported and read back',
    '',
    `Platform ${process.platform}; ffmpeg ${FFMPEG}.`,
    '',
    `media/: the "video" (640×360, 30 fps, ${SECONDS} s, lossless): thirteen bars at x 229..410 in the top 48 rows (frame N, bit by bit),`,
    'a ramp in rows 48..111 whose level is its own column (16 at 160, 235 at 480), flat grey below; a 440 Hz tone; the json3 track',
    `the fake yt-dlp serves: ${WORDS} made-up words, 15 to 25 frames apart, in sentences of 6 to 11 ending on '.'.`,
    'The store: Get transcript, Analyse at 1 min with no model, Clip it on the card that starts latest (an empty timeline: this project',
    'set to 9:16), the fake cuts the exact range, collectIngest lands it, the steps after it run (no AI helper: centred, said; captions;',
    'graphics, left out of the export). Exported at the project’s shape, 512 rows high, without and with captions (libass, pop).',
    'Read: the bars (which source frame), the ramp at the left edge, middle and right edge (which source columns), the captions',
    `against the captionless export in the rows below the ramp, over the first ${CHECK_SECONDS} s.`,
    '',
    ...notes
  ])
})

/* ----------------------------------------------------------------- tests */

describe('Clip it from a card, exported: portrait, the centred crop, the card’s words, each caption on its word', () => {
  it('the fixture: the talk is the synthetic one, long enough for 1-minute windows', async () => {
    const u = state().urlSource
    expect(u?.status).toBe('ready')
    const words = u!.transcript!.words
    expect(words.map((w) => w.startMs)).toEqual(Array.from({ length: WORDS }, (_, i) => wordMs(i + 1)))
    expect(words[words.length - 1].startMs).toBeGreaterThan(60_000)
    // No word has a digit: the graphics step's baseline has no number to place.
    expect(words.some((w) => /\d/u.test(w.text))).toBe(false)
    // The ramp, read back off the source: the level says the column.
    const { stdout } = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', videoPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {
      encoding: 'buffer',
      maxBuffer: 16 * 1024 * 1024
    })
    const frame = stdout as unknown as Buffer
    const row = RAMP_Y + RAMP_H / 2
    for (const x of [200, 320, 440]) expect(Math.abs(columnOf(frame[row * W + x]) - x), `the ramp at column ${x}`).toBeLessThanOrEqual(3)
    notes.push(`- the talk: ${WORDS} words, the last at ${wordMs(WORDS)} ms; ${ENDS.size} sentences`)
  })

  it('a card’s Clip it on an empty timeline: one exact download of the card’s range, 9:16, its words; then exported and read', async () => {
    state().setReframeHelper('missing')
    state().setBestClipsLength(60_000)
    await state().analyseBestClips()
    const result = state().bestClips.last?.result
    expect(result, 'Analyse kept a result').toBeTruthy()
    expect(result!.cards.length, 'cards').toBeGreaterThan(0)
    // The card that starts latest: its range is mid-video, so a shift of it is not hidden at 0.
    const card = [...result!.cards].sort((a, b) => b.startMs - a.startMs)[0]
    const t = state().urlSource!.transcript!
    // The card's words, independently: the transcript's words from its start to its end.
    const first = t.words.findIndex((w) => w.startMs === card.startMs)
    expect(first, 'the card starts on a word').toBeGreaterThanOrEqual(0)
    const cardWords = t.words.filter((w) => w.startMs >= card.startMs && w.startMs < card.endMs)
    expect(cardWords.length, 'the card’s word count').toBe(card.words)
    const k0 = first + 1
    notes.push(`- the card: ${card.windowId} ${card.startMs}–${card.endMs} ms, ${card.words} words, from word ${k0} (source frame ${frameAt(wordMs(k0))}); ${result!.cards.length} cards`)

    expect(state().project.clips, 'an empty timeline').toHaveLength(0)
    // A new project's captions are on already, so step 4 would change nothing to see: off first, and step 4 must turn them on.
    state().setCaptionsEnabled(false)
    expect(state().project.captions.enabled).toBe(false)
    const before = jobSeq
    await state().clipItFromCard(card)
    expect(jobSeq, 'one download').toBe(before + 1)
    const id = `job-${jobSeq}`
    const request = entries.get(id)!.request
    expect.soft(request.exact, 'an exact cut').toBe(true)
    expect.soft(request.range, 'the card’s own range').toEqual({ startMs: card.startMs, endMs: card.endMs })
    expect.soft(state().aspect, 'the empty timeline set to 9:16').toBe('9:16')

    await downloads.get(id)
    // The undo stack's depth as each step's line ends (the record is keyed once the download is asked).
    const key = Object.keys(state().bestClipsClipped).find((k) => state().bestClipsClipped[k].jobId === id)!
    const depthAt: Record<string, number> = {}
    const readDepth = (): void => {
      for (const step of state().bestClipsClipped[key]?.steps ?? []) {
        if (depthAt[step.name] === undefined && ['done', 'skipped', 'failed'].includes(step.state)) depthAt[step.name] = state().past.length
      }
    }
    const unwatch = (store as unknown as { subscribe(f: () => void): () => void }).subscribe(readDepth)
    await state().collectIngest(id)
    await until(() => ['done', 'skipped', 'failed'].includes(state().bestClipsClipped[key]?.steps.find((s) => s.name === 'graphics')?.state ?? ''), 60_000, 'the graphics step ending')
    unwatch()
    const record = state().bestClipsClipped[key]
    const line = (name: string): string => {
      const s = record.steps.find((x) => x.name === name)
      return s ? `${s.state}: ${s.text}` : 'none'
    }
    notes.push(`- the card’s lines: ${record.steps.map((s) => `${s.name} ${s.state} “${s.text}”`).join('; ')}`)
    expect.soft(line('download')).toBe(`done: ${STEP_TEXT.landed}`)
    expect.soft(line('shape')).toBe(`done: ${STEP_TEXT.shapeSet}`)
    expect.soft(line('reframe')).toBe(`skipped: ${STEP_TEXT.reframeNoHelper}`)
    expect.soft(line('captions')).toBe(`done: ${STEP_TEXT.captionsOn}`)
    // The line says what is THERE: counted here independently, every graphic clip being over the one footage clip. The talk has
    // no number, so nothing waits for Keep; the baseline's keywords are placed (measured: two on this talk).
    const placedHere = state().project.clips.filter((c) => c.graphic !== undefined).length
    const waitingHere = (state().project.graphicProposals ?? []).length
    expect.soft(waitingHere, 'nothing waits for Keep on a talk with no number').toBe(0)
    expect.soft(placedHere, 'the baseline placed its keywords').toBeGreaterThan(0)
    expect.soft(line('graphics')).toBe(`done: ${graphicsResultText(placedHere, waitingHere)}`)
    // Step 4 turned the captions on, in one undo step of its own (the follow, skipped, wrote none).
    notes.push(`- undo depth as each line ended: ${JSON.stringify(depthAt)}`)
    expect.soft(depthAt.captions - depthAt.reframe, 'step 4’s own undo steps').toBe(1)
    expect.soft(depthAt.reframe - depthAt.download, 'the skipped follow’s undo steps').toBe(0)

    const project = state().project
    expect.soft(project.captions.enabled, 'captions on').toBe(true)
    const asset = project.assets.find((a) => project.clips.some((c) => c.id === record.clipId && c.assetId === a.id))!
    expect(asset, 'the clip landed').toBeTruthy()
    await copyFile(asset.path, join(dir, 'download.mp4'))
    // The card's words on the file's clock: exactly the card's, moved by its start (an exact cut's head is 0).
    const landed = project.transcripts[asset.id]
    expect.soft(landed.words.map((w) => w.text)).toEqual(cardWords.map((w) => w.text))
    expect.soft(landed.words.map((w) => w.startMs)).toEqual(cardWords.map((w) => w.startMs - card.startMs))

    // The export: the clip and its captions (graphics left out, see the head); the project's shape at OUT_H rows.
    const s = project.settings
    const canvas = { width: Math.max(2, Math.round((s.width * OUT_H) / s.height / 2) * 2), height: OUT_H }
    const edit: Project = { ...project, clips: project.clips.filter((c) => c.graphic === undefined) }
    notes.push(`- graphics placed: ${project.clips.filter((c) => c.graphic !== undefined).map((c) => JSON.stringify(c.graphic!.data ?? null).slice(0, 80)).join('; ') || 'none'}`)
    notes.push(`- the project: ${s.width}×${s.height}, exported at ${canvas.width}×${canvas.height}; ${project.clips.length - edit.clips.length} graphic clips left out`)
    const plainFile = join(dir, 'card-plain.mp4')
    const plainPlan = buildRenderPlan({ project: { ...edit, captions: { ...edit.captions, enabled: false } }, outputPath: plainFile, canvas })
    await run(FFMPEG, plainPlan.args, { maxBuffer: 64 * 1024 * 1024 })
    expect(captionsNeedBaking(edit), 'pop is libass’s').toBe(false)
    const prepared = await prepareCaptions(edit, canvas)
    expect(prepared, 'captions to burn').toBeTruthy()
    await copyFile(prepared!.subtitlesPath, join(dir, 'card-captions.ass'))
    const capFile = join(dir, 'card-libass.mp4')
    const capPlan = buildRenderPlan({
      project: edit,
      outputPath: capFile,
      canvas,
      subtitlesPath: prepared!.subtitlesPath,
      fontsDir: prepared!.fontsDir && existsSync(prepared!.fontsDir) ? prepared!.fontsDir : undefined
    })
    await run(FFMPEG, capPlan.args, { maxBuffer: 64 * 1024 * 1024 })

    const plain = await readExport(plainFile, CHECK_SECONDS)
    const cap = await readExport(capFile, CHECK_SECONDS)

    // Portrait, 9:16, off the file.
    notes.push(`- the export: ${plain.width}×${plain.height}`)
    expect(plain.height, 'portrait').toBeGreaterThan(plain.width)
    expect.soft(plain.width * 16, '9:16').toBe(plain.height * 9)

    // The centred crop, off the ramp: left edge, middle, right edge, on every frame read.
    const perPixel = CROP_W / plain.width
    const want: [number, number, number] = [CROP_X + (EDGE + 0.5) * perPixel, W / 2, CROP_X + CROP_W - (EDGE + 0.5) * perPixel]
    const worst = [0, 1, 2].map((i) => Math.max(...plain.columns.map((c) => Math.abs(c[i] - want[i]))))
    notes.push(`- the crop, off the ramp: frame 0 reads columns ${plain.columns[0].map((c) => c.toFixed(1)).join(', ')} against ${want.map((c) => c.toFixed(1)).join(', ')}; worst ${worst.map((w) => w.toFixed(1)).join(', ')}`)
    expect.soft(worst[0], 'the left edge is the centred crop’s').toBeLessThanOrEqual(COLUMN_SLACK)
    expect.soft(worst[1], 'the middle is the source’s middle').toBeLessThanOrEqual(COLUMN_SLACK)
    expect.soft(worst[2], 'the right edge is the centred crop’s').toBeLessThanOrEqual(COLUMN_SLACK)

    // The picture: the card's first word's frame first, frame for frame from there.
    const firstFrame = frameAt(wordMs(k0))
    expect.soft(plain.index[0], 'the clip’s first frame shows the card’s first word’s frame').toBe(firstFrame)
    expect.soft(plain.index, 'frame for frame').toEqual(plain.index.map((_, i) => firstFrame + i))
    expect.soft(cap.index, 'the captioned export shows the same frames').toEqual(plain.index)

    // The captions, against the picture: where each word is said is the frame showing its source frame.
    const seen = onsets(cap, plain)
    await writeFile(join(dir, 'card-libass-frames.csv'), `${seen.trace.join('\n')}\n`)
    const inView = cardWords.map((_, i) => k0 + i).filter((k) => {
      const f = plain.index.indexOf(frameAt(wordMs(k)))
      return f >= 0 && f < plain.index.length - 2
    })
    const wordFrames = inView.map((k) => plain.index.indexOf(frameAt(wordMs(k))))
    const perLine = resolveStyle(edit.captions.styleId, edit.captions.overrides as StyleOverrides | undefined).wordsPerLine
    notes.push(
      `- captions (${edit.captions.styleId}, ${perLine} words a line): lines at ${seen.lines.join(', ') || 'none'}; word onsets ${seen.words.join(', ')}; ` +
        `the words' frames ${wordFrames.join(', ')}`
    )
    expect(seen.lines.length, 'a caption line in the first seconds').toBeGreaterThan(0)
    // The clip starts on the card's first word, so this is frame 0 against frame 0: it holds that the captions start with the
    // clip. A shift of the range or the words is caught by the per-word onsets below (mutations I1, I2).
    expect(Math.abs(seen.lines[0] - wordFrames[0]), `the first line at ${seen.lines[0]}, its word at ${wordFrames[0]}`).toBeLessThanOrEqual(1)
    for (const [i, frame] of wordFrames.entries()) {
      expect.soft(Math.abs((seen.words[i] ?? Infinity) - frame), `word ${inView[i]}'s caption at ${seen.words[i]}, its word at ${frame}`).toBeLessThanOrEqual(1)
    }
  }, 300_000)
})
