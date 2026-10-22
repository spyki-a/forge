/**
 * The graphics engine's forks, measured before anything relies on them
 * (docs/CLIPS.md §6.15, phase 0's piece 0.2; the options are §6.11's table).
 *
 *   await window.__forgeGraphicCheck({ encode: { frames: 120, region: ['canvas', 'box'], pool: [1, 2, 4] } })   M1
 *   await window.__forgeGraphicCheck({ encode: { frames: 120, workers: [1, 2, 4] } })                          M2
 *   await window.__forgeGraphicCheck({ segments: true })                                                       M3
 *   await window.__forgeGraphicCheck({ blur: { words: 10, px: 8 } })                                           M5
 *   await window.__forgeGraphicCheck({ parity: true })                                       M6, Indic and colour
 *   await window.__forgeGraphicCheck({ indic: true })                                         M22's numeric halves
 *
 * Every option is independent; one not passed runs nothing. The result carries
 * the numbers, a bounded sample of the frames drawn (PNG data URLs, never all
 * of them), a `summary` to copy into EFFECTS.md §61, and `navigator.userAgent`,
 * so a result names the browser that made it. The same frames are put on the
 * page as a contact sheet.
 *
 * Installed in the harness and, behind `import.meta.env.DEV`, in the
 * development app (`src/renderer/src/main.tsx`). M3 and M22 depend on
 * Electron 44's Chromium, ICU and HarfBuzz, so they are run in `npm run dev`'s
 * DevTools console, never on the harness page, whose browser is whichever
 * opened it; the timings may fall back to the harness with its user agent
 * recorded (§6.11, "Where it runs").
 *
 * Phase 0 measures; it decides nothing. The verdicts are §6.15's outcome
 * table's, read by the phase's recorder. What this file throws on is only its
 * own failure: nothing drawn, a frame outside its box, a texture read back
 * blank, where a number would otherwise be reported that measured nothing.
 */

import { DEFAULT_TEXT, type TextSpec } from '@shared/timeline'
import { drawTextOnto } from '@shared/render/textPaint'
import { layoutText } from '@shared/render/textLayout'
import { encodeFrames } from '../encodePool'
import { sharedRenderer } from '../threeShared'
import {
  SYNTHETIC,
  contains,
  diffRgba,
  inkBox,
  padRect,
  spread,
  syntheticBox,
  syntheticPanelAt,
  unionRect,
  type PixelDiff,
  type Rect,
  type Spread
} from './graphicMeasure'

/* ---------------------------------------------------------------- options */

export interface GraphicCheckOptions {
  /**
   * M1 (`region`, `pool`) and M2 (`workers`): §6.15's synthetic graphic,
   * `frames` of it (120 when absent), encoded through `encodeFrames` per
   * region and pool depth, and in module workers. `pool` and `region` default
   * to [1, 2, 4] and ['canvas', 'box'] when neither `workers` nor either of
   * them is given; `workers` runs on `region` (['canvas'] when absent) beside
   * a four-deep pool on the same frames.
   */
  encode?: { frames?: number; region?: ('canvas' | 'box')[]; pool?: number[]; workers?: number[] }
  /** M3: the Indic words segmented into grapheme clusters and painted cluster by cluster. */
  segments?: boolean
  /** M5: a ten-word line, every word under `blur(px)` every frame (60 frames when absent). */
  blur?: { words?: number; px?: number; frames?: number }
  /** M6's phase-0 parts: the §51 clusters through a `CanvasTexture`, and colour, with colour management on and off. */
  parity?: boolean
  /** M22's numeric halves: each §51 cluster drawn whole and one code point at a time. */
  indic?: boolean
}

/* ------------------------------------------------------------- the result */

export interface CheckFrame {
  label: string
  /** A PNG data URL. */
  png: string
}

export interface EncodeRun {
  route: 'pool' | 'workers'
  region: 'canvas' | 'box'
  /** Pool depth, or workers. */
  depth: number
  frames: number
  width: number
  height: number
  /** First draw to last write, over the frames. */
  msPerFrame: number
  wallMs: number
  /** Between one frame's write and the next's: the pace of the run. */
  gapMs: Spread
  /** The draw callback's own time: the commands, not their rasterising, which the encode pays. */
  drawMs: Spread
  bytes: Spread
}

export interface WorkerRun {
  route: 'workers'
  region: 'canvas' | 'box'
  workers: number
  /** Why no worker ran: a refusal by the page's CSP reads here, never as a throw. */
  refused: string
}

export interface EncodeResult {
  synthetic: { width: number; height: number; panel: Rect; box: Rect; frames: number }
  runs: EncodeRun[]
  workers: (EncodeRun | WorkerRun)[]
  /** The box route's frames against the canvas route's, cropped to the box: the same picture, or the box is wrong. */
  boxAgainstCanvas?: PixelDiff
  /** The workers' PNGs against the pool's, frame 0 and the last: byte-equal, or decoded and compared. */
  workersAgainstPool?: { frame: number; sameBytes: boolean; diff: PixelDiff | null }[]
  note: string
}

export interface SegmentRow {
  word: string
  /** Intl.Segmenter's grapheme clusters, in order. */
  clusters: string[]
  count: number
  /** The cumulative per-cluster paint's last frame against the word drawn whole, over the word's box. */
  diff: PixelDiff
  equal: boolean
}

export interface SegmentsResult {
  font: string
  locale: string
  rows: SegmentRow[]
}

export interface BlurResult {
  words: number
  px: number
  frames: number
  width: number
  height: number
  /** Per frame, every word under `blur(px)`: the drawing, then a one-pixel read so it is rasterised. */
  blurMs: Spread
  /** The same frames without the filter. */
  plainMs: Spread
  note: string
}

export interface ColourSquare {
  name: string
  /** The canvas's pixel and three's, at the square's middle (straight RGBA). */
  canvas: number[]
  three: number[]
  /** Over the square's inside, three against the canvas. */
  diff: PixelDiff
}

export interface ParitySetting {
  setting: 'on' | 'off'
  /** What the setting is, in three's terms. */
  means: string
  /** The clusters through the texture at 1:1, against the canvas they were uploaded from: the whole frame, and the ink. */
  indic: { frame: PixelDiff; ink: PixelDiff }
  colour: ColourSquare[]
  /** The largest difference in levels of any colour square. */
  colourMax: number
}

export interface ParityResult {
  rig: string
  settings: ParitySetting[]
}

export interface FontCandidate {
  font: string
  scripts: Script[]
  /** §6.15: installed only if a Latin probe in it differs from the same probe in a family that does not exist. */
  installed: boolean
  latinDiffers: boolean
  /** Its own drawing of a letter of each script differs from the fallback's: it has the script and is not the fallback. */
  scriptDiffers: Partial<Record<Script, boolean>>
}

export interface IndicRow {
  cluster: string
  codePoints: string[]
  script: Script
  /** Has a virama: a conjunct, which shaping must draw narrower than its parts. */
  conjunct: boolean
  wholeWidth: number
  codePointWidths: number[]
  sumWidth: number
  narrower: boolean
  /** The whole drawing against the one drawn a code point at a time, over the two's ink. */
  diff: PixelDiff
  /** More than 1/255 mean (§6.11's proposal). */
  differs: boolean
  /** For a pre-base vowel sign (कि): its ink starts left of the consonant drawn alone; null where there is none. */
  matraFirst: boolean | null
  /** The whole width equals the missing-glyph box's, once per code point. */
  likeMissingGlyph: boolean
  /** Installed candidates of the cluster's script whose drawing of it equals the painter's, pixel for pixel. */
  resolvedBy: string[]
  /** Every installed candidate of the script: its width and its drawing's mean difference from the painter's. */
  candidates: { font: string; width: number; mean: number }[]
}

export interface IndicResult {
  font: string
  px: number
  width: number
  missingGlyphWidth: number
  candidates: FontCandidate[]
  rows: IndicRow[]
  note: string
}

export interface GraphicCheckResult {
  userAgent: string
  page: string
  date: string
  encode?: EncodeResult
  segments?: SegmentsResult
  blur?: BlurResult
  parity?: ParityResult
  indic?: IndicResult
  /** One line per figure, to copy. */
  summary: string[]
  notes: string[]
  frames: CheckFrame[]
}

/* -------------------------------------------------------------- constants */

/* The theme's own (styles.css @theme): accent-500, ink-950 (the page), ink-50. */
const BLUE = '#2563eb'
const CREAM = '#f6f2ea'
const NEAR_BLACK = '#100e0b'

type Script = 'deva' | 'telu'

/** EFFECTS §51's clusters (EFFECTS.md:4721): क्ष त्र ज्ञ श्र कि, క్ష త్ర శ్రీ కి స్త. */
export const INDIC_CLUSTERS: readonly string[] = [
  'क्ष',
  'त्र',
  'ज्ञ',
  'श्र',
  'कि',
  'క్ష',
  'త్ర',
  'శ్రీ',
  'కి',
  'స్త'
]

/** M3's words (§6.15): स्कूल, क्षत्रिय, स्त्री, తెలుగు, క్ష, స్త్ర; then the clusters not among them. */
const M3_WORDS: readonly string[] = [
  'स्कूल',
  'क्षत्रिय',
  'स्त्री',
  'తెలుగు',
  'క్ష',
  'స్త్ర'
]

const VIRAMA = /[्్]/
const PRE_BASE_I = 'ि'

/*
 * Faces that may hold Devanagari or Telugu, named per script so a face is
 * only ever matched against a script it was made for: a Telugu face drawing a
 * Devanagari cluster falls back to the very face the painter fell back to,
 * and would read as a match. §6.20's two Noto faces first, then the Mac's,
 * then Windows', then two that either may have.
 */
const FONT_CANDIDATES: readonly { font: string; scripts: Script[] }[] = [
  { font: 'Noto Sans Devanagari', scripts: ['deva'] },
  { font: 'Noto Sans Telugu', scripts: ['telu'] },
  { font: 'Kohinoor Devanagari', scripts: ['deva'] },
  { font: 'Devanagari Sangam MN', scripts: ['deva'] },
  { font: 'Devanagari MT', scripts: ['deva'] },
  { font: 'ITF Devanagari', scripts: ['deva'] },
  { font: 'Shree Devanagari 714', scripts: ['deva'] },
  { font: 'Kohinoor Telugu', scripts: ['telu'] },
  { font: 'Telugu Sangam MN', scripts: ['telu'] },
  { font: 'Telugu MN', scripts: ['telu'] },
  { font: 'Nirmala UI', scripts: ['deva', 'telu'] },
  { font: 'Mangal', scripts: ['deva'] },
  { font: 'Aparajita', scripts: ['deva'] },
  { font: 'Kokila', scripts: ['deva'] },
  { font: 'Utsaah', scripts: ['deva'] },
  { font: 'Gautami', scripts: ['telu'] },
  { font: 'Vani', scripts: ['telu'] },
  { font: 'Arial Unicode MS', scripts: ['deva', 'telu'] },
  { font: 'Lohit Devanagari', scripts: ['deva'] },
  { font: 'Lohit Telugu', scripts: ['telu'] }
]
const NO_SUCH_FAMILY = 'Forge No Such Family 7f3a'
const SCRIPT_PROBE: Record<Script, string> = { deva: 'क', telu: 'క' }
const LATIN_PROBE = 'Hamburgefonstiv 0123'

/** At most this many frames ride in a result; each is a PNG data URL. */
const MAX_FRAMES = 48

/* ---------------------------------------------------------------- helpers */

/** A plain text spec: no shadow, outline, tracking or casing, so the letters are the only ink. */
function textSpec(content: string, patch: Partial<TextSpec> = {}): TextSpec {
  return { ...DEFAULT_TEXT, content, color: CREAM, uppercase: false, tracking: 0, shadow: 0, stroke: 0, version: 1, ...patch }
}

/*
 * A plain context, as the bake's and the preview's are: `willReadFrequently`
 * would put it on the CPU, and the timings and the pixels would then be a
 * different canvas's from the one that ships.
 */
function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('graphic check: no 2D context')
  return { canvas, ctx }
}

const pixels = (ctx: CanvasRenderingContext2D): Uint8ClampedArray => ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data

/**
 * The font `drawTextOnto` set for a spec, read back from the context it drew
 * on: the painter's own string, not a copy of its rule (`fontString`,
 * textPaint.ts), so a measurement made with it measures what was drawn.
 */
function painterFont(spec: TextSpec, width: number, height: number): string {
  const { ctx } = canvas2d(width, height)
  drawTextOnto(ctx, spec, width, height)
  return ctx.font
}

function crop(source: HTMLCanvasElement, rect: Rect): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d(Math.max(1, rect.width), Math.max(1, rect.height))
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
  return canvas
}

/** Pictures in a grid, each cell scaled to fit, on one canvas: a sheet for the eye. */
function sheet(rows: HTMLCanvasElement[][], cell: { width: number; height: number }): HTMLCanvasElement {
  const columns = Math.max(1, ...rows.map((r) => r.length))
  const { canvas, ctx } = canvas2d(columns * cell.width, Math.max(1, rows.length) * cell.height)
  ctx.fillStyle = NEAR_BLACK
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  rows.forEach((row, r) =>
    row.forEach((picture, c) => {
      const scale = Math.min(1, (cell.width - 8) / picture.width, (cell.height - 8) / picture.height)
      const w = picture.width * scale
      const h = picture.height * scale
      ctx.drawImage(picture, c * cell.width + (cell.width - w) / 2, r * cell.height + (cell.height - h) / 2, w, h)
    })
  )
  return canvas
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** A PNG's pixels as straight RGBA, decoded as the bundled ffmpeg would read the file: no colour conversion. */
async function decodePng(bytes: ArrayBuffer, width: number, height: number): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none'
  })
  const { ctx } = canvas2d(width, height)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return pixels(ctx)
}

const ms = (n: number): string => (Number.isFinite(n) ? n.toFixed(2) : 'n/a')
const kb = (n: number): string => (Number.isFinite(n) ? `${(n / 1024).toFixed(1)} KB` : 'n/a')

class Frames {
  readonly list: CheckFrame[] = []
  dropped = 0
  add(label: string, png: string): void {
    if (this.list.length < MAX_FRAMES) this.list.push({ label, png })
    else this.dropped++
  }
  canvas(label: string, canvas: HTMLCanvasElement): void {
    if (this.list.length < MAX_FRAMES) this.add(label, canvas.toDataURL('image/png'))
    else this.dropped++
  }
}

/* --------------------------------------------------- the synthetic graphic */

/** Two lines of type, centred on the panel at frame 0 (`layoutText`'s centre is the frame's, 960). */
const SYNTHETIC_TEXT = textSpec('Measured, not assumed\nevery frame through the pool', {
  size: 0.03,
  weight: 700,
  align: 'center',
  position: 'center',
  offsetY: (SYNTHETIC.panel.y + SYNTHETIC.panel.height / 2 - SYNTHETIC.height / 2) / SYNTHETIC.height
})

/** §6.15's synthetic graphic at a frame, in frame coordinates. */
function drawSynthetic(ctx: CanvasRenderingContext2D, frame: number, frames: number): void {
  const panel = syntheticPanelAt(frame)
  const lift = SYNTHETIC.panel.y - panel.y

  ctx.save()
  ctx.globalAlpha = SYNTHETIC.opacity
  ctx.fillStyle = NEAR_BLACK
  ctx.beginPath()
  ctx.roundRect(panel.x, panel.y, panel.width, panel.height, SYNTHETIC.panel.radius)
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.translate(0, -lift)
  drawTextOnto(ctx, SYNTHETIC_TEXT, SYNTHETIC.width, SYNTHETIC.height)
  ctx.restore()

  // The stroke draws on along the panel's foot, left to right, over the run.
  const t = frames > 1 ? frame / (frames - 1) : 1
  const y = panel.y + panel.height - 56
  const from = panel.x + 60
  const to = panel.x + panel.width - 60
  ctx.save()
  ctx.lineWidth = SYNTHETIC.stroke
  ctx.lineCap = 'round'
  ctx.strokeStyle = BLUE
  ctx.beginPath()
  ctx.moveTo(from, y)
  ctx.lineTo(from + (to - from) * t, y)
  ctx.stroke()
  ctx.restore()
}

function regionRect(region: 'canvas' | 'box', frames: number): Rect {
  return region === 'box' ? syntheticBox(frames) : { x: 0, y: 0, width: SYNTHETIC.width, height: SYNTHETIC.height }
}

const sampleFrames = (frames: number): number[] => [...new Set([0, Math.floor((frames - 1) / 2), frames - 1])]

/* ----------------------------------------------------------------- M1: pool */

interface Timed {
  run: EncodeRun
  kept: Map<number, ArrayBuffer>
}

async function poolRun(region: 'canvas' | 'box', depth: number, frames: number): Promise<Timed> {
  const box = regionRect(region, frames)
  const keep = new Set(sampleFrames(frames))
  const kept = new Map<number, ArrayBuffer>()
  const draws: number[] = []
  const bytes: number[] = []
  const writtenAt: number[] = []
  const started = performance.now()
  const path = await encodeFrames({
    count: frames,
    width: box.width,
    height: box.height,
    depth,
    draw: (ctx, index) => {
      const t0 = performance.now()
      // Frame coordinates into a box-sized canvas, as captionBake.ts paints its band.
      ctx.translate(-box.x, -box.y)
      drawSynthetic(ctx, index, frames)
      draws.push(performance.now() - t0)
    },
    // A recorder, not a file: M1 times the drawing and the encode, not the IPC and disk a bake adds.
    write: async (index, data) => {
      writtenAt.push(performance.now())
      bytes.push(data.byteLength)
      if (keep.has(index)) kept.set(index, data)
      return `graphic-check/${index}`
    },
    cancelled: () => false
  })
  const wallMs = performance.now() - started
  if (path !== `graphic-check/${frames - 1}`) throw new Error(`graphic check: encodeFrames answered ${String(path)} for ${frames} frames`)
  return {
    run: {
      route: 'pool',
      region,
      depth,
      frames,
      width: box.width,
      height: box.height,
      msPerFrame: wallMs / frames,
      wallMs,
      gapMs: spread(writtenAt.slice(1).map((t, i) => t - writtenAt[i])),
      drawMs: spread(draws),
      bytes: spread(bytes)
    },
    kept
  }
}

/* -------------------------------------------------------------- M2: workers */

interface Reply {
  id: number
  ready?: boolean
  bytes?: ArrayBuffer
  error?: string
}

/** One module worker, started and answering, or the reason it is not. */
async function startWorker(): Promise<Worker | string> {
  let violation = ''
  const onViolation = (event: SecurityPolicyViolationEvent): void => {
    violation = `the page's CSP refused it (${event.effectiveDirective || event.violatedDirective}: ${event.blockedURI})`
  }
  document.addEventListener('securitypolicyviolation', onViolation)
  try {
    let worker: Worker
    try {
      worker = new Worker(new URL('./graphicEncodeWorker.ts', import.meta.url), { type: 'module' })
    } catch (error) {
      return `the worker could not be made: ${error instanceof Error ? error.message : String(error)}`
    }
    return await new Promise<Worker | string>((resolve) => {
      // Generous: the development server transforms the worker's file on its first request.
      const timer = setTimeout(() => {
        worker.terminate()
        resolve(violation || 'the worker did not answer within 15 s')
      }, 15_000)
      worker.onerror = (event) => {
        clearTimeout(timer)
        worker.terminate()
        // A CSP refusal or a failed load arrives as an error event with no message.
        resolve(violation || `the worker failed to start: ${event.message || 'an error event with no message'}`)
      }
      worker.onmessage = (event: MessageEvent<Reply>) => {
        if (!event.data.ready) return
        clearTimeout(timer)
        worker.onerror = null
        worker.onmessage = null
        resolve(worker)
      }
      worker.postMessage('ping')
    })
  } finally {
    document.removeEventListener('securitypolicyviolation', onViolation)
  }
}

/** Jobs to one worker, one reply each, matched by id. */
function encoderOn(worker: Worker): (id: number, bitmap: ImageBitmap, width: number, height: number) => Promise<ArrayBuffer> {
  const waiting = new Map<number, { resolve: (bytes: ArrayBuffer) => void; reject: (error: Error) => void }>()
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const reply = event.data
    const job = waiting.get(reply.id)
    if (!job) return
    waiting.delete(reply.id)
    if (reply.bytes) job.resolve(reply.bytes)
    else job.reject(new Error(`graphic check: a worker could not encode frame ${reply.id}: ${reply.error ?? 'no bytes'}`))
  }
  worker.onerror = (event) => {
    for (const job of waiting.values()) job.reject(new Error(`graphic check: a worker failed: ${event.message}`))
    waiting.clear()
  }
  return (id, bitmap, width, height) =>
    new Promise<ArrayBuffer>((resolve, reject) => {
      waiting.set(id, { resolve, reject })
      worker.postMessage({ id, bitmap, width, height }, [bitmap])
    })
}

/**
 * The same frames, drawn on the main thread (where `drawTextOnto` sees the
 * document's fonts), handed to `count` workers as `ImageBitmap`s and encoded
 * there with `convertToBlob`: §6.3's worker back-end as it would be built.
 * One frame in flight per worker; writes in frame order, as `encodeFrames`'s.
 */
async function workerRun(region: 'canvas' | 'box', count: number, frames: number): Promise<{ run: EncodeRun | WorkerRun; kept: Map<number, ArrayBuffer> }> {
  const kept = new Map<number, ArrayBuffer>()
  const workers: Worker[] = []
  try {
    for (let i = 0; i < count; i++) {
      const started = await startWorker()
      if (typeof started === 'string') return { run: { route: 'workers', region, workers: count, refused: started }, kept }
      workers.push(started)
    }
    const encoders = workers.map(encoderOn)
    const box = regionRect(region, frames)
    const { canvas, ctx } = canvas2d(box.width, box.height)
    const draw = (index: number): void => {
      ctx.save()
      ctx.clearRect(0, 0, box.width, box.height)
      ctx.translate(-box.x, -box.y)
      drawSynthetic(ctx, index, frames)
      ctx.restore()
    }

    // Each worker's first encode is not timed: it starts the worker's encoder.
    for (const [i, encode] of encoders.entries()) {
      draw(0)
      await encode(-2 - i, await createImageBitmap(canvas), box.width, box.height)
    }

    const keep = new Set(sampleFrames(frames))
    const draws: number[] = []
    const bytes: number[] = []
    const writtenAt: number[] = []
    const busy: (Promise<void> | undefined)[] = new Array(count).fill(undefined)
    let previous: Promise<void> = Promise.resolve()
    const started = performance.now()
    for (let index = 0; index < frames; index++) {
      const slot = index % count
      const held = busy[slot]
      if (held) await held
      const t0 = performance.now()
      draw(index)
      draws.push(performance.now() - t0)
      const encoded = encoders[slot](index, await createImageBitmap(canvas), box.width, box.height)
      const before = previous
      const job = (async () => {
        const data = await encoded
        await before
        writtenAt.push(performance.now())
        bytes.push(data.byteLength)
        if (keep.has(index)) kept.set(index, data)
      })()
      job.catch(() => undefined)
      busy[slot] = job
      previous = job
    }
    await previous
    const wallMs = performance.now() - started
    return {
      run: {
        route: 'workers',
        region,
        depth: count,
        frames,
        width: box.width,
        height: box.height,
        msPerFrame: wallMs / frames,
        wallMs,
        gapMs: spread(writtenAt.slice(1).map((t, i) => t - writtenAt[i])),
        drawMs: spread(draws),
        bytes: spread(bytes)
      },
      kept
    }
  } finally {
    for (const worker of workers) worker.terminate()
  }
}

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
  return true
}

async function checkEncode(options: NonNullable<GraphicCheckOptions['encode']>, frames: Frames, summary: string[]): Promise<EncodeResult> {
  const count = Math.max(2, Math.floor(options.frames ?? 120))
  const poolAsked = options.pool !== undefined || options.region !== undefined || options.workers === undefined
  const depths = poolAsked ? (options.pool ?? [1, 2, 4]) : []
  const regions: ('canvas' | 'box')[] = options.region ?? (poolAsked ? ['canvas', 'box'] : ['canvas'])
  const box = syntheticBox(count)

  // Warm: the first encode of a page pays for starting its encoder, and the first draw for the face.
  await poolRun('canvas', 4, 8)

  const runs: EncodeRun[] = []
  const kept = new Map<string, Map<number, ArrayBuffer>>()
  for (const region of regions) {
    for (const depth of depths) {
      const timed = await poolRun(region, depth, count)
      runs.push(timed.run)
      if (!kept.has(`pool:${region}`)) kept.set(`pool:${region}`, timed.kept)
      summary.push(
        `M1 ${region} pool ${depth}: ${ms(timed.run.msPerFrame)} ms/frame over ${count} (gap p50 ${ms(timed.run.gapMs.p50)}, p95 ${ms(timed.run.gapMs.p95)}), ${kb(timed.run.bytes.mean)}/frame at ${timed.run.width}x${timed.run.height}`
      )
    }
  }

  const workerRuns: (EncodeRun | WorkerRun)[] = []
  let workersAgainstPool: EncodeResult['workersAgainstPool']
  if (options.workers?.length) {
    for (const region of regions) {
      // M2's baseline: the four-deep pool, on the same frames, in the same call.
      const baseline = await poolRun(region, 4, count)
      workerRuns.push(baseline.run)
      if (!kept.has(`pool:${region}`)) kept.set(`pool:${region}`, baseline.kept)
      summary.push(`M2 ${region} baseline pool 4: ${ms(baseline.run.msPerFrame)} ms/frame (gap p50 ${ms(baseline.run.gapMs.p50)}, p95 ${ms(baseline.run.gapMs.p95)})`)
      for (const n of options.workers) {
        const { run, kept: theirs } = await workerRun(region, Math.max(1, Math.floor(n)), count)
        workerRuns.push(run)
        if ('refused' in run) {
          summary.push(`M2 ${region} workers ${n}: not run, ${run.refused}`)
          continue
        }
        summary.push(`M2 ${region} workers ${n}: ${ms(run.msPerFrame)} ms/frame (gap p50 ${ms(run.gapMs.p50)}, p95 ${ms(run.gapMs.p95)})`)
        if (!workersAgainstPool) {
          workersAgainstPool = []
          const ours = kept.get(`pool:${region}`)!
          for (const frame of [0, count - 1]) {
            const a = ours.get(frame)
            const b = theirs.get(frame)
            if (!a || !b) continue
            const same = sameBytes(a, b)
            const diff = same ? null : diffRgba(await decodePng(a, run.width, run.height), await decodePng(b, run.width, run.height), run.width)
            workersAgainstPool.push({ frame, sameBytes: same, diff })
            if (!same) {
              frames.add(`M2 workers frame ${frame}`, await blobToDataUrl(new Blob([b], { type: 'image/png' })))
            }
          }
        }
      }
    }
  }

  // The frames themselves: a sample from each region, decoded, so the check can see what it timed.
  let boxAgainstCanvas: PixelDiff | undefined
  const canvasKept = kept.get('pool:canvas')
  const boxKept = kept.get('pool:box')
  if (canvasKept) {
    for (const [frame, bytes] of canvasKept) {
      const data = await decodePng(bytes, SYNTHETIC.width, SYNTHETIC.height)
      const ink = inkBox(data, SYNTHETIC.width, SYNTHETIC.height)
      if (!ink) throw new Error(`graphic check: canvas frame ${frame} encoded blank`)
      if (!contains(box, ink)) throw new Error(`graphic check: frame ${frame}'s ink ${JSON.stringify(ink)} is outside the box ${JSON.stringify(box)}`)
      frames.add(`M1 canvas frame ${frame}`, await blobToDataUrl(new Blob([bytes], { type: 'image/png' })))
    }
  }
  if (boxKept) {
    for (const [frame, bytes] of boxKept) frames.add(`M1 box frame ${frame}`, await blobToDataUrl(new Blob([bytes], { type: 'image/png' })))
  }
  if (canvasKept && boxKept) {
    const frame = 0
    const whole = await decodePng(canvasKept.get(frame)!, SYNTHETIC.width, SYNTHETIC.height)
    const part = await decodePng(boxKept.get(frame)!, box.width, box.height)
    const cropped = new Uint8ClampedArray(box.width * box.height * 4)
    for (let y = 0; y < box.height; y++) {
      const from = ((box.y + y) * SYNTHETIC.width + box.x) * 4
      cropped.set(whole.subarray(from, from + box.width * 4), y * box.width * 4)
    }
    boxAgainstCanvas = diffRgba(cropped, part, box.width)
    summary.push(`M1 box against canvas, frame 0: mean ${boxAgainstCanvas.mean.toFixed(3)}, max ${boxAgainstCanvas.max}`)
  }

  return {
    synthetic: { width: SYNTHETIC.width, height: SYNTHETIC.height, panel: syntheticPanelAt(0), box, frames: count },
    runs,
    workers: workerRuns,
    boxAgainstCanvas,
    workersAgainstPool,
    note:
      'write is a recorder (bytes and time), not writeTitleFrame: these are the drawing and the encode, not the IPC and disk a bake adds. ' +
      'msPerFrame is the run\'s wall time over its frames; gapMs is between consecutive frames\' writes, which go out in order. ' +
      'The workers\' times include createImageBitmap on the main thread.'
  }
}

/* -------------------------------------------------------------- M3: segments */

function checkSegments(frames: Frames, summary: string[]): SegmentsResult {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const words = [...new Set([...M3_WORDS, ...INDIC_CLUSTERS])]
  // 120 px, in the painter's own font string (its family chain), as a keyword card would draw.
  const font = painterFont(textSpec(M3_WORDS[0], { size: 120 / 1920 }), 1080, 1920)
  const width = 1080
  const height = 260
  const x = 60
  const baseline = 180
  const rows: SegmentRow[] = []
  const pictures: HTMLCanvasElement[][] = []

  for (const word of words) {
    const clusters = [...segmenter.segment(word)].map((s) => s.segment)
    const whole = canvas2d(width, height)
    const parts = canvas2d(width, height)
    for (const { ctx } of [whole, parts]) {
      ctx.font = font
      ctx.letterSpacing = '0px'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = CREAM
    }
    whole.ctx.fillText(word, x, baseline)
    // The cumulative paint's last frame: every cluster drawn on its own, each
    // where the word's own layout puts it (the advance of the clusters before it).
    for (let k = 0; k < clusters.length; k++) {
      const before = parts.ctx.measureText(clusters.slice(0, k).join('')).width
      parts.ctx.fillText(clusters[k], x + before, baseline)
    }
    const a = pixels(whole.ctx)
    const b = pixels(parts.ctx)
    const ink = unionRect(inkBox(a, width, height), inkBox(b, width, height))
    if (!ink) throw new Error(`graphic check: ${word} drew nothing`)
    const area = padRect(ink, 2, width, height)
    const diff = diffRgba(a, b, width, area)
    rows.push({ word, clusters, count: clusters.length, diff, equal: diff.mean === 0 })
    pictures.push([crop(whole.canvas, area), crop(parts.canvas, area)])
    summary.push(`M3 ${word}: ${clusters.length} cluster${clusters.length === 1 ? '' : 's'} [${clusters.join(' | ')}], per-cluster paint against whole: mean ${diff.mean.toFixed(3)}, max ${diff.max}`)
  }
  frames.canvas('M3: each word whole (left) and painted cluster by cluster (right)', sheet(pictures, { width: 360, height: 150 }))
  return { font, locale: segmenter.resolvedOptions().locale, rows }
}

/* ----------------------------------------------------------------- M5: blur */

const BLUR_WORDS = ['every', 'word', 'lands', 'on', 'the', 'beat', 'it', 'was', 'said', 'at']

function checkBlur(options: NonNullable<GraphicCheckOptions['blur']>, frames: Frames, summary: string[]): BlurResult {
  const count = Math.max(1, Math.floor(options.words ?? 10))
  const px = Math.max(0, options.px ?? 8)
  const runFrames = Math.max(2, Math.floor(options.frames ?? 60))
  const width = SYNTHETIC.width
  const height = SYNTHETIC.height
  const words = Array.from({ length: count }, (_, i) => BLUR_WORDS[i % BLUR_WORDS.length])
  const base = textSpec('', { size: 0.035, weight: 700, align: 'left', position: 'lower' })
  const layout = layoutText({ ...base, content: 'x' }, width, height)

  // Where each word goes: one line, wrapped at the title-safe width, the last row where a one-line block sits.
  const { ctx: measure } = canvas2d(8, 8)
  measure.font = painterFont({ ...base, content: words[0] }, width, height)
  const space = measure.measureText(' ').width
  const safe = width - layout.marginX * 2
  const placed: { word: string; x: number; row: number }[] = []
  let pen = 0
  let row = 0
  for (const word of words) {
    const w = measure.measureText(word).width
    if (pen > 0 && pen + w > safe) {
      pen = 0
      row++
    }
    placed.push({ word, x: pen, row })
    pen += w + space
  }
  const rows = row + 1

  const { canvas, ctx } = canvas2d(width, height)
  const drawFrame = (frame: number, filter: string): number => {
    const t0 = performance.now()
    ctx.clearRect(0, 0, width, height)
    for (const p of placed) {
      ctx.save()
      ctx.filter = filter
      // Rising 2 px a frame, as the synthetic graphic does, so every frame differs.
      ctx.translate(p.x, (p.row - (rows - 1)) * layout.lineHeight - 2 * frame)
      drawTextOnto(ctx, { ...base, content: p.word }, width, height)
      ctx.restore()
    }
    // A one-pixel read makes the canvas rasterise what was asked of it, so the time is the drawing's, not the command list's.
    ctx.getImageData(0, 0, 1, 1)
    return performance.now() - t0
  }

  const time = (filter: string): number[] => {
    for (let f = 0; f < 5; f++) drawFrame(f, filter)
    return Array.from({ length: runFrames }, (_, f) => drawFrame(f, filter))
  }
  const plainMs = spread(time('none'))
  const blurMs = spread(time(`blur(${px}px)`))
  const ink = inkBox(pixels(ctx), width, height)
  if (!ink) throw new Error('graphic check: the blur line drew nothing')
  frames.canvas(`M5 blur(${px}px), last frame`, crop(canvas, padRect(ink, 8, width, height)))
  summary.push(
    `M5 ${count} words, blur(${px}px) at ${width}x${height}: p50 ${ms(blurMs.p50)}, p95 ${ms(blurMs.p95)} ms/frame; without the filter p50 ${ms(plainMs.p50)}, p95 ${ms(plainMs.p95)}`
  )
  return {
    words: count,
    px,
    frames: runFrames,
    width,
    height,
    blurMs,
    plainMs,
    note:
      'Every word under the filter every frame, the worst case the row names, not a staggered entrance. Each frame ends in a one-pixel getImageData so it is rasterised; ' +
      'a canvas Chrome sees read back often may move to the CPU, as the bake\'s does under toBlob, so these are that canvas\'s times.'
  }
}

/* -------------------------------------------------------------- M6: parity */

/* The moments' identity quad (momentCanvas.ts:189-194) and the depth push's straight-in, premultiplied-out sampling (:309-317). */
const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

const STRAIGHT_IN_PREMULTIPLIED_OUT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
void main() {
  vec4 c = texture2D(uTex, vec2(vUv.x, 1.0 - vUv.y));
  gl_FragColor = vec4(c.rgb * c.a, c.a);
}`

const SQUARE = 160
const SQUARES: { name: string; hex: string }[] = [
  { name: 'accent #2563eb', hex: BLUE },
  { name: 'page #f6f2ea', hex: CREAM },
  { name: 'ink #100e0b', hex: NEAR_BLACK },
  { name: 'mid grey #808080', hex: '#808080' }
]
const squareAt = (i: number, row: number): Rect => ({ x: 80 + i * 240, y: 200 + row * 300, width: SQUARE, height: SQUARE })
const inside = (r: Rect): Rect => ({ x: r.x + 8, y: r.y + 8, width: r.width - 16, height: r.height - 16 })

async function checkParity(frames: Frames, summary: string[]): Promise<ParityResult> {
  const width = SYNTHETIC.width
  const height = SYNTHETIC.height

  // The clusters, painted by drawTextOnto on a transparent frame.
  const flat = canvas2d(width, height)
  drawTextOnto(flat.ctx, textSpec(`${INDIC_CLUSTERS.slice(0, 5).join(' ')}\n${INDIC_CLUSTERS.slice(5).join(' ')}`, { size: 0.05, weight: 700, align: 'center', position: 'center' }), width, height)
  const flatPixels = pixels(flat.ctx)
  const textInk = inkBox(flatPixels, width, height)
  if (!textInk) throw new Error('graphic check: the clusters drew nothing')
  const textArea = padRect(textInk, 2, width, height)

  // The colours, by canvas 2D: four squares, then the accent at 50 % over the page, and over nothing.
  const swatch = canvas2d(width, height)
  SQUARES.forEach((s, i) => {
    const r = squareAt(i, 0)
    swatch.ctx.fillStyle = s.hex
    swatch.ctx.fillRect(r.x, r.y, r.width, r.height)
  })
  {
    const over = squareAt(0, 1)
    swatch.ctx.fillStyle = CREAM
    swatch.ctx.fillRect(over.x, over.y, over.width, over.height)
    swatch.ctx.globalAlpha = 0.5
    swatch.ctx.fillStyle = BLUE
    swatch.ctx.fillRect(over.x, over.y, over.width, over.height)
    const alone = squareAt(1, 1)
    swatch.ctx.fillRect(alone.x, alone.y, alone.width, alone.height)
    swatch.ctx.globalAlpha = 1
  }
  const swatchPixels = pixels(swatch.ctx)
  const regions: { name: string; rect: Rect }[] = [
    ...SQUARES.map((s, i) => ({ name: s.name, rect: squareAt(i, 0) })),
    { name: 'accent at 50 % over the page', rect: squareAt(0, 1) },
    { name: 'accent at 50 % over nothing', rect: squareAt(1, 1) }
  ]

  const { three, renderer, canvas: gl } = await sharedRenderer(width, height)
  const was = { enabled: three.ColorManagement.enabled, output: renderer.outputColorSpace }
  const disposables: { dispose: () => void }[] = []
  const readback = canvas2d(width, height)
  const render = (scene: import('three').Scene, camera: import('three').Camera): Uint8ClampedArray => {
    // The renderer is shared; another drawer may have resized it since.
    if (gl.width !== width || gl.height !== height) renderer.setSize(width, height, false)
    renderer.render(scene, camera)
    readback.ctx.clearRect(0, 0, width, height)
    readback.ctx.drawImage(gl, 0, 0)
    return pixels(readback.ctx)
  }

  const settings: ParitySetting[] = []
  try {
    for (const setting of ['on', 'off'] as const) {
      three.ColorManagement.enabled = setting === 'on'
      renderer.outputColorSpace = setting === 'on' ? three.SRGBColorSpace : three.LinearSRGBColorSpace

      // Indic: the frame as a CanvasTexture, uploaded as the moments upload theirs (momentCanvas.ts:321-335).
      const texture = new three.CanvasTexture(flat.canvas)
      texture.colorSpace = three.NoColorSpace
      texture.flipY = false
      texture.premultiplyAlpha = false
      texture.generateMipmaps = false
      texture.minFilter = three.LinearFilter
      texture.magFilter = three.LinearFilter
      texture.wrapS = three.ClampToEdgeWrapping
      texture.wrapT = three.ClampToEdgeWrapping
      texture.needsUpdate = true
      const quad = new three.PlaneGeometry(2, 2)
      const material = new three.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: STRAIGHT_IN_PREMULTIPLIED_OUT,
        uniforms: { uTex: { value: texture } },
        depthTest: false,
        depthWrite: false,
        blending: three.NoBlending
      })
      disposables.push(texture, quad, material)
      const textScene = new three.Scene()
      textScene.add(new three.Mesh(quad, material))
      const throughTexture = render(textScene, new three.OrthographicCamera(-1, 1, 1, -1, 0, 1))
      if (!inkBox(throughTexture, width, height)) throw new Error('graphic check: the texture read back blank (no WebGL?)')
      const indic = { frame: diffRgba(flatPixels, throughTexture, width), ink: diffRgba(flatPixels, throughTexture, width, textArea) }

      // Colour: the same squares as three meshes under an orthographic camera at 1:1, y down.
      const colourScene = new three.Scene()
      const camera = new three.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, -10, 10)
      const square = new three.PlaneGeometry(SQUARE, SQUARE)
      disposables.push(square)
      const mesh = (rect: Rect, hex: string, opacity: number, order: number): void => {
        const m = new three.MeshBasicMaterial({ color: hex, transparent: opacity < 1, opacity, depthTest: false, depthWrite: false })
        disposables.push(m)
        const object = new three.Mesh(square, m)
        object.position.set(rect.x + rect.width / 2 - width / 2, height / 2 - rect.y - rect.height / 2, order * 0.01)
        object.renderOrder = order
        colourScene.add(object)
      }
      SQUARES.forEach((s, i) => mesh(squareAt(i, 0), s.hex, 1, 0))
      mesh(squareAt(0, 1), CREAM, 1, 0)
      mesh(squareAt(0, 1), BLUE, 0.5, 1)
      mesh(squareAt(1, 1), BLUE, 0.5, 1)
      const throughThree = render(colourScene, camera)

      const colour: ColourSquare[] = regions.map(({ name, rect }) => {
        const mid = ((rect.y + rect.height / 2) * width + rect.x + rect.width / 2) * 4
        return {
          name,
          canvas: Array.from(swatchPixels.subarray(mid, mid + 4)),
          three: Array.from(throughThree.subarray(mid, mid + 4)),
          diff: diffRgba(swatchPixels, throughThree, width, inside(rect))
        }
      })
      const colourMax = Math.max(...colour.map((c) => c.diff.max))
      settings.push({
        setting,
        means:
          setting === 'on'
            ? 'ColorManagement.enabled = true, outputColorSpace = SRGBColorSpace (three\'s defaults)'
            : 'ColorManagement.enabled = false, outputColorSpace = LinearSRGBColorSpace (bytes through untouched)',
        indic,
        colour,
        colourMax
      })
      summary.push(
        `M6 colour management ${setting}: Indic through the texture, frame mean ${indic.frame.mean.toFixed(3)} max ${indic.frame.max}, ink mean ${indic.ink.mean.toFixed(3)}; colour max ${colourMax} levels (${colour.map((c) => `${c.name} ${c.diff.max}`).join(', ')})`
      )

      if (setting === 'on') {
        const readCanvas = (data: Uint8ClampedArray): HTMLCanvasElement => {
          const c = canvas2d(width, height)
          c.ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0)
          return c.canvas
        }
        frames.canvas('M6 clusters: the canvas (top), through the texture (bottom)', sheet([[crop(flat.canvas, textArea)], [crop(readCanvas(throughTexture), textArea)]], { width: textArea.width + 8, height: textArea.height + 8 }))
        const colourArea = { x: 72, y: 192, width: 4 * 240, height: 2 * 300 }
        frames.canvas('M6 colour: canvas 2D (top), three with colour management on (bottom)', sheet([[crop(swatch.canvas, colourArea)], [crop(readCanvas(throughThree), colourArea)]], { width: colourArea.width, height: colourArea.height }))
      }
    }
  } finally {
    three.ColorManagement.enabled = was.enabled
    renderer.outputColorSpace = was.output
    for (const d of disposables) d.dispose()
  }

  return {
    rig:
      'a CanvasTexture (NoColorSpace, flipY false, premultiplyAlpha false, no mipmaps, linear filters) on the shared renderer under the identity quad, ' +
      'sampled straight and written premultiplied with no blending, read back by drawImage into a 2D canvas; colour as MeshBasicMaterial squares under an orthographic camera at 1:1. ' +
      'The 1 px line is phase 3\'s.',
    settings
  }
}

/* --------------------------------------------------------------- M22: indic */

function scriptOf(text: string): Script {
  return /[ఀ-౿]/.test(text) ? 'telu' : 'deva'
}

/** Two drawings of a probe, in a face and in a family that does not exist: do they differ? */
function differsFromFallback(font: string, weight: number, probe: string): boolean {
  const width = 640
  const height = 120
  const draw = (family: string): { data: Uint8ClampedArray; advance: number } => {
    const { ctx } = canvas2d(width, height)
    ctx.font = `${weight} 64px "${family}"`
    ctx.fillStyle = '#ffffff'
    ctx.fillText(probe, 8, 88)
    return { data: pixels(ctx), advance: ctx.measureText(probe).width }
  }
  const a = draw(font)
  const b = draw(NO_SUCH_FAMILY)
  return a.advance !== b.advance || diffRgba(a.data, b.data, width).differing > 0
}

function checkIndic(frames: Frames, summary: string[]): IndicResult {
  // 120 px at 1080 wide (a keyword card's size: no graphic style exists in phase 0), drawTextOnto's own layout.
  const width = 1080
  const height = 480
  const base = textSpec('', { size: 0.25, weight: 700, align: 'left', position: 'center' })
  const font = painterFont({ ...base, content: INDIC_CLUSTERS[0] }, width, height)
  const px = layoutText({ ...base, content: 'x' }, width, height).fontPx
  const { ctx: measure } = canvas2d(8, 8)
  measure.font = font
  measure.letterSpacing = '0px'
  const advance = (text: string): number => measure.measureText(text).width
  const missingGlyphWidth = advance('\u{10FFFD}')

  const candidates: FontCandidate[] = FONT_CANDIDATES.map(({ font: face, scripts }) => {
    const latinDiffers = differsFromFallback(face, base.weight, LATIN_PROBE)
    const scriptDiffers: Partial<Record<Script, boolean>> = {}
    for (const s of scripts) scriptDiffers[s] = differsFromFallback(face, base.weight, SCRIPT_PROBE[s])
    return { font: face, scripts, installed: latinDiffers, latinDiffers, scriptDiffers }
  })

  const draw = (spec: TextSpec): { canvas: HTMLCanvasElement; data: Uint8ClampedArray } => {
    const c = canvas2d(width, height)
    drawTextOnto(c.ctx, spec, width, height)
    return { canvas: c.canvas, data: pixels(c.ctx) }
  }

  const rows: IndicRow[] = []
  const pictures: HTMLCanvasElement[][] = [[], []]
  for (const cluster of INDIC_CLUSTERS) {
    const codePoints = Array.from(cluster)
    const script = scriptOf(cluster)
    const whole = draw({ ...base, content: cluster })

    // One code point at a time, each where the last one's advance left the pen
    // (Array.from, standing in for libass's shaping=simple), through the same painter.
    const split = canvas2d(width, height)
    let pen = 0
    for (const cp of codePoints) {
      split.ctx.save()
      split.ctx.translate(pen, 0)
      drawTextOnto(split.ctx, { ...base, content: cp }, width, height)
      split.ctx.restore()
      pen += advance(cp)
    }
    const splitData = pixels(split.ctx)

    const wholeInk = inkBox(whole.data, width, height)
    if (!wholeInk) throw new Error(`graphic check: ${cluster} drew nothing`)
    const area = padRect(unionRect(wholeInk, inkBox(splitData, width, height))!, 2, width, height)
    const diff = diffRgba(whole.data, splitData, width, area)

    let matraFirst: boolean | null = null
    if (codePoints.includes(PRE_BASE_I)) {
      const consonant = inkBox(draw({ ...base, content: codePoints.filter((cp) => cp !== PRE_BASE_I).join('') }).data, width, height)
      matraFirst = consonant ? wholeInk.x < consonant.x - 1 : null
    }

    const wholeWidth = advance(cluster)
    const codePointWidths = codePoints.map(advance)
    const sumWidth = codePointWidths.reduce((a, b) => a + b, 0)
    const conjunct = VIRAMA.test(cluster)

    const theirs = candidates
      .filter((c) => c.installed && c.scripts.includes(script))
      .map((c) => {
        const drawn = draw({ ...base, content: cluster, font: c.font })
        const { ctx } = canvas2d(8, 8)
        ctx.font = `${base.weight} ${px}px "${c.font}"`
        return { font: c.font, width: ctx.measureText(cluster).width, mean: diffRgba(whole.data, drawn.data, width, area).mean }
      })

    rows.push({
      cluster,
      codePoints,
      script,
      conjunct,
      wholeWidth,
      codePointWidths,
      sumWidth,
      narrower: wholeWidth < sumWidth,
      diff,
      differs: diff.mean > 1,
      matraFirst,
      likeMissingGlyph: missingGlyphWidth > 0 && Math.abs(wholeWidth - codePoints.length * missingGlyphWidth) < 0.5,
      resolvedBy: theirs.filter((c) => c.mean === 0).map((c) => c.font),
      candidates: theirs
    })
    pictures[0].push(crop(whole.canvas, padRect(area, 6, width, height)))
    pictures[1].push(crop(split.canvas, padRect(area, 6, width, height)))
    const r = rows[rows.length - 1]
    summary.push(
      `M22 ${cluster}: whole ${wholeWidth.toFixed(1)} px against ${codePoints.length} code points' ${sumWidth.toFixed(1)}${conjunct ? (r.narrower ? ' (narrower)' : ' (NOT narrower)') : ''}; ` +
        `frames ${r.differs ? 'differ' : 'DO NOT differ'} (mean ${diff.mean.toFixed(3)} over the ink)` +
        `${matraFirst === null ? '' : matraFirst ? '; i-matra first' : '; i-matra NOT first'}; resolved by ${r.resolvedBy.length ? r.resolvedBy.join(', ') : 'no installed candidate'}`
    )
  }
  frames.canvas('M22: each cluster whole (top row) and one code point at a time (bottom row)', sheet(pictures, { width: 220, height: 200 }))
  summary.push(`M22 installed candidates: ${candidates.filter((c) => c.installed).map((c) => c.font).join(', ') || 'none'}`)

  return {
    font,
    px,
    width,
    missingGlyphWidth,
    candidates,
    rows,
    note:
      'Drawn by drawTextOnto, cream on transparent, left-aligned, no tracking. A lone combining mark drawn on its own may take HarfBuzz\'s dotted circle, ' +
      'which widens its advance and shows in the per-code-point row; libass\'s simple shaper draws none. ' +
      'resolvedBy lists only installed faces named for the cluster\'s script whose drawing equals the painter\'s pixel for pixel; the eye check against graphic.int\'s libass sheets is yours.'
  }
}

/* ------------------------------------------------------------ the sheet */

const SHEET_ID = 'forge-graphic-check-sheet'

/** The frames on the page, over everything, on a checkerboard so transparency shows. Replaced by each run. */
function showSheet(result: GraphicCheckResult): void {
  document.getElementById(SHEET_ID)?.remove()
  const panel = document.createElement('div')
  panel.id = SHEET_ID
  Object.assign(panel.style, {
    position: 'fixed',
    top: '8px',
    right: '8px',
    width: 'min(760px, calc(100vw - 16px))',
    maxHeight: 'calc(100vh - 16px)',
    overflow: 'auto',
    zIndex: '2147483647',
    background: NEAR_BLACK,
    color: CREAM,
    font: '12px system-ui, sans-serif',
    padding: '8px',
    border: `1px solid ${BLUE}`,
    borderRadius: '6px'
  })
  const head = document.createElement('div')
  Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' })
  const title = document.createElement('strong')
  title.textContent = `Graphic check · ${result.frames.length} frames · ${result.date}`
  const close = document.createElement('button')
  close.textContent = 'Close'
  close.onclick = () => panel.remove()
  head.append(title, close)
  panel.append(head)
  const summary = document.createElement('pre')
  Object.assign(summary.style, { whiteSpace: 'pre-wrap', margin: '0 0 8px' })
  summary.textContent = [...result.summary, ...result.notes].join('\n')
  panel.append(summary)
  const grid = document.createElement('div')
  Object.assign(grid.style, { display: 'flex', flexWrap: 'wrap', gap: '8px' })
  for (const frame of result.frames) {
    const figure = document.createElement('figure')
    Object.assign(figure.style, { margin: '0', maxWidth: '360px' })
    const img = document.createElement('img')
    img.src = frame.png
    img.alt = frame.label
    Object.assign(img.style, {
      display: 'block',
      maxWidth: '360px',
      maxHeight: '320px',
      background: 'repeating-conic-gradient(#808080 0 25%, #b0b0b0 0 50%) 0 0 / 16px 16px'
    })
    const caption = document.createElement('figcaption')
    caption.textContent = frame.label
    figure.append(img, caption)
    grid.append(figure)
  }
  panel.append(grid)
  document.body.append(panel)
}

/* ------------------------------------------------------------- the check */

export async function runGraphicCheck(options: GraphicCheckOptions = {}): Promise<GraphicCheckResult> {
  const frames = new Frames()
  const summary: string[] = []
  const notes: string[] = []
  const result: GraphicCheckResult = {
    userAgent: navigator.userAgent,
    page: location.href,
    date: new Date().toISOString(),
    summary,
    notes,
    frames: frames.list
  }
  await document.fonts.ready
  if (options.encode) result.encode = await checkEncode(options.encode, frames, summary)
  if (options.segments) result.segments = checkSegments(frames, summary)
  if (options.blur) result.blur = checkBlur(options.blur, frames, summary)
  if (options.parity) result.parity = await checkParity(frames, summary)
  if (options.indic) result.indic = checkIndic(frames, summary)
  if (!options.encode && !options.segments && !options.blur && !options.parity && !options.indic) {
    notes.push('No option was passed, so nothing ran: encode, segments, blur, parity and indic (docs/CLIPS.md §6.11).')
  }
  if (frames.dropped > 0) notes.push(`${frames.dropped} more frames were drawn than a result carries (${MAX_FRAMES}).`)
  showSheet(result)
  return result
}

export function installGraphicCheck(): void {
  ;(window as unknown as { __forgeGraphicCheck: typeof runGraphicCheck }).__forgeGraphicCheck = runGraphicCheck
}
