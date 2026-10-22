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
 *
 * Run the timings (encode, blur) with the window visible, in front, and
 * untouched until the call returns. A main-thread `toBlob` encodes in the
 * renderer's idle time, so its pace follows the frame cadence: the same check
 * in the same page measured 16 ms a frame at 60 Hz and 882 ms once the page
 * was throttled to one frame a second. Each timing result carries the cadence,
 * the visibility and focus before and after, and a 2×2 canvas's `toBlob`, and
 * says THROTTLED when the cadence was not a display's.
 */

import { DEFAULT_TEXT, type TextSpec } from '@shared/timeline'
import { drawTextOnto } from '@shared/render/textPaint'
import { layoutText } from '@shared/render/textLayout'
import { encodeFrames, setPoolCanvases, type PoolCanvas } from '../encodePool'
import { sharedRenderer } from '../threeShared'
import {
  SYNTHETIC,
  contains,
  diffRgba,
  inkBox,
  padRect,
  percentile,
  perFrameMs,
  preBaseLead,
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
  /**
   * §6.15's "ms per frame at p50 and p95", M1's and M2's figure: at every
   * frame, the span of `depth` consecutive writes over `depth`
   * (`perFrameMs`), so a burst of writes from encodes that finished together
   * is counted once.
   */
  msPerFrame: Spread
  /** The run's wall time, first draw to last write, over its frames: one number, msPerFrame's mean in effect. */
  wallMsPerFrame: number
  wallMs: number
  /**
   * Each frame's own encode, from its start to its bytes: `toBlob`'s call to
   * its blob (the pool, timed on the pool's own canvases), or the
   * `postMessage` to the worker's reply (workers). Its floor is `toBlob2x2`
   * in the result's conditions.
   */
  encodeMs: Spread
  /** Workers only: `convertToBlob` inside the worker, as the worker timed it. */
  workerEncodeMs?: Spread
  /**
   * Secondary: between one frame's write and the next's. Deeper than 1 it is
   * bursty (writes back to back, then a wait), so neither its p50 nor its p95
   * is a frame's cost; msPerFrame is.
   */
  gapMs: Spread
  /** The draw callback's own time: the commands, not their rasterising, which the encode pays. */
  drawMs: Spread
  bytes: Spread
}

export interface PageConditions {
  visibility: string
  focused: boolean
  /** The median gap between animation frames over up to ten frames or 2 s; null when no frame came in that time. */
  rafMs: number | null
}

/**
 * What the renderer's scheduling was doing while a timing ran. A main-thread
 * `toBlob` encodes in idle time, so its pace has the frame cadence as a floor;
 * a throttled page (hidden, occluded, or slowed for another reason) drops the
 * cadence to about a frame a second and every pool figure with it, while a
 * worker's `convertToBlob` is unaffected.
 */
export interface RunConditions {
  before: PageConditions
  after: PageConditions
  /** A 2×2 canvas's `toBlob`, call to blob, one after another: the scheduling's floor under every encode here. */
  toBlob2x2: Spread
  /** The page was not visible, or an animation frame came slower than THROTTLE_FRAME_MS or not at all, before or after. */
  throttled: boolean
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
  conditions: RunConditions
  /**
   * The page's Content-Security-Policy, from its meta tag (a policy sent as a
   * header is not seen here); null when it has none. The harness page has
   * none, so only `npm run dev`'s renderer, whose index.html carries the app's
   * policy, answers whether that policy admits the module worker.
   */
  csp: string | null
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
  /** Per frame, every word under `blur(px)`, drawn and then encoded by `toBlob` as a bake pays for it: the draw's start to the blob. */
  blurMs: Spread
  /** The same frames without the filter, each timed just before its blurred twin, on the same canvas. */
  plainMs: Spread
  /** Frame by frame, blurMs less plainMs: what the filter adds to a frame's bake. M5's bar reads its p95. */
  addedMs: Spread
  /** The draw calls alone, with the filter and without: the commands, which the canvas rasterises when the encode reads it. */
  blurDrawMs: Spread
  plainDrawMs: Spread
  conditions: RunConditions
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
  /** Each code point measured alone. A lone mark takes HarfBuzz's dotted circle, so its width here is mostly the circle's. */
  codePointWidths: number[]
  /** Their sum: inflated by a dotted circle per mark (`marks`, and the result's `dottedCircleWidth`), so not the reading. */
  sumWidth: number
  /** Combining marks (virama, vowel signs) among the code points: each one drawn alone carries a dotted circle. */
  marks: number
  /** The cluster's letters without its marks, each measured alone: no circle. A conjunct drawn unshaped is at least this wide. */
  baseWidth: number
  /** Conjuncts only (null otherwise): the whole advance narrower than `baseWidth`, which an unshaped drawing cannot be. */
  narrower: boolean | null
  /**
   * The whole drawing against the one drawn a code point at a time through
   * the same painter, over the two's ink. The per-code-point frame carries a
   * dotted circle on every lone mark, so this differs for any engine that
   * draws circles, shaped or not; it is the reading the plan's mutation needs
   * (an Array.from split in the painter makes the two frames equal), and
   * `narrower`, the eye check and `resolvedBy` are the readings for shaping.
   */
  diff: PixelDiff
  /** More than 1/255 mean (§6.11's proposal). */
  differs: boolean
  /** For a pre-base vowel sign (कि): the consonant drawn alone, found inside the whole drawing, sits right of where it was drawn (`preBaseLead`); null where there is none. */
  matraFirst: boolean | null
  /** That shift, in pixels: about the matra's width when shaped, 0 when drawn in logical order. */
  consonantShift: number | null
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
  /** U+25CC, the dotted circle HarfBuzz draws under a lone mark, measured in the painter's font. */
  dottedCircleWidth: number
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
/** A combining mark: a virama or a vowel sign, which HarfBuzz draws on a dotted circle when it stands alone. */
const MARK = /\p{M}/u
/** U+25CC DOTTED CIRCLE. */
const DOTTED_CIRCLE = String.fromCodePoint(0x25cc)

/**
 * Slower than this between animation frames, the page is throttled, not
 * showing a display's cadence (60 Hz is 16.7 ms, 120 Hz 8.3; 40 Hz is a floor
 * no display the app targets runs under). The check's own line, a proposal.
 */
const THROTTLE_FRAME_MS = 25

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

function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('graphic check: a canvas did not encode'))), 'image/png')
  )
}

/* ------------------------------------------------- the renderer's scheduling */

/** Gaps between animation frames: up to `count` of them, or as many as came in `limitMs`. */
function animationFrameGaps(count = 10, limitMs = 2000): Promise<number[]> {
  return new Promise((resolve) => {
    const times: number[] = []
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(times.slice(1).map((t, i) => t - times[i]))
    }
    const timer = setTimeout(finish, limitMs)
    const tick = (t: number): void => {
      if (done) return
      times.push(t)
      if (times.length > count) finish()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

async function pageConditions(): Promise<PageConditions> {
  const visibility = document.visibilityState
  const focused = document.hasFocus()
  const gaps = await animationFrameGaps()
  return { visibility, focused, rafMs: gaps.length ? percentile(gaps, 50) : null }
}

/** A 2×2 canvas's `toBlob`, one after another: up to `count` of them, or as many as fit in `limitMs`. */
async function toBlobFloor(count = 8, limitMs = 3000): Promise<Spread> {
  const { canvas, ctx } = canvas2d(2, 2)
  ctx.fillStyle = BLUE
  ctx.fillRect(0, 0, 1, 1)
  const times: number[] = []
  const started = performance.now()
  while (times.length < count && performance.now() - started < limitMs) {
    const t0 = performance.now()
    await pngBlob(canvas)
    times.push(performance.now() - t0)
  }
  return spread(times)
}

const throttledPage = (c: PageConditions): boolean => c.visibility !== 'visible' || c.rafMs === null || c.rafMs > THROTTLE_FRAME_MS

const describePage = (c: PageConditions): string =>
  `${c.rafMs === null ? 'no animation frame in 2 s' : `animation frames ${ms(c.rafMs)} ms apart`}, ${c.visibility}, ${c.focused ? 'focused' : 'not focused'}`

/**
 * The timings' conditions as one summary line, and a note when they were
 * throttled: such a run's figures are the throttle's, not the encode's.
 */
function reportConditions(label: string, conditions: RunConditions, summary: string[], notes: string[]): string {
  const line =
    `${label} conditions: before ${describePage(conditions.before)}; after ${describePage(conditions.after)}; ` +
    `a 2x2 toBlob p50 ${ms(conditions.toBlob2x2.p50)}, p95 ${ms(conditions.toBlob2x2.p95)} ms`
  if (conditions.throttled) {
    notes.push(
      `${label} ran THROTTLED (${describePage(conditions.before)} before, ${describePage(conditions.after)} after): its timings are the throttle's, not the encode's. ` +
        'Run it again with the window visible, in front and untouched until it returns.'
    )
    return `${label} THROTTLED: ${line}`
  }
  return line
}

/**
 * The pool's canvases, each the document's own, with `toBlob` timed from its
 * call to its blob: `encodeFrames` itself runs unchanged around them, through
 * its canvas seam (`setPoolCanvases`), put back when the run ends.
 */
function timedPoolCanvases(encodes: number[]): (width: number, height: number) => PoolCanvas {
  return (width, height) => {
    const { canvas } = canvas2d(width, height)
    return {
      getContext: (contextId) => canvas.getContext(contextId),
      toBlob: (callback, type) => {
        const t0 = performance.now()
        canvas.toBlob((blob) => {
          encodes.push(performance.now() - t0)
          callback(blob)
        }, type)
      }
    }
  }
}

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
  const encodes: number[] = []
  setPoolCanvases(timedPoolCanvases(encodes))
  let path: string | null
  let wallMs: number
  try {
    const started = performance.now()
    path = await encodeFrames({
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
    wallMs = performance.now() - started
  } finally {
    setPoolCanvases(null)
  }
  if (path !== `graphic-check/${frames - 1}`) throw new Error(`graphic check: encodeFrames answered ${String(path)} for ${frames} frames`)
  return {
    run: {
      route: 'pool',
      region,
      depth,
      frames,
      width: box.width,
      height: box.height,
      // encodeFrames clamps its depth to the frames; the window is the depth it ran at.
      msPerFrame: spread(perFrameMs(writtenAt, Math.min(depth, frames))),
      wallMsPerFrame: wallMs / frames,
      wallMs,
      encodeMs: spread(encodes),
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
  /** The worker's own time for convertToBlob and the bytes. */
  ms?: number
  error?: string
}

interface Encoded {
  bytes: ArrayBuffer
  /** postMessage to the reply, on the main thread's clock. */
  ms: number
  /** The worker's own time. */
  workerMs: number
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
function encoderOn(worker: Worker): (id: number, bitmap: ImageBitmap, width: number, height: number) => Promise<Encoded> {
  const waiting = new Map<number, { posted: number; resolve: (encoded: Encoded) => void; reject: (error: Error) => void }>()
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const reply = event.data
    const job = waiting.get(reply.id)
    if (!job) return
    waiting.delete(reply.id)
    if (reply.bytes) job.resolve({ bytes: reply.bytes, ms: performance.now() - job.posted, workerMs: reply.ms ?? NaN })
    else job.reject(new Error(`graphic check: a worker could not encode frame ${reply.id}: ${reply.error ?? 'no bytes'}`))
  }
  worker.onerror = (event) => {
    for (const job of waiting.values()) job.reject(new Error(`graphic check: a worker failed: ${event.message}`))
    waiting.clear()
  }
  return (id, bitmap, width, height) =>
    new Promise<Encoded>((resolve, reject) => {
      waiting.set(id, { posted: performance.now(), resolve, reject })
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
    const encodes: number[] = []
    const workerEncodes: number[] = []
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
        const { bytes: data, ms: roundTrip, workerMs } = await encoded
        encodes.push(roundTrip)
        workerEncodes.push(workerMs)
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
        // One frame in flight per worker: the pipeline is as deep as the workers.
        msPerFrame: spread(perFrameMs(writtenAt, Math.min(count, frames))),
        wallMsPerFrame: wallMs / frames,
        wallMs,
        encodeMs: spread(encodes),
        workerEncodeMs: spread(workerEncodes),
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

/** One line for a run: §6.15's ms per frame at p50 and p95 first, then each frame's own encode, then the rest. */
function describeRun(run: EncodeRun): string {
  return (
    `${ms(run.msPerFrame.p50)} ms/frame p50, ${ms(run.msPerFrame.p95)} p95 (wall ${ms(run.wallMsPerFrame)} over ${run.frames}); ` +
    `each frame's encode p50 ${ms(run.encodeMs.p50)}, p95 ${ms(run.encodeMs.p95)}` +
    (run.workerEncodeMs ? ` (in the worker p50 ${ms(run.workerEncodeMs.p50)}, p95 ${ms(run.workerEncodeMs.p95)})` : '') +
    `; ${kb(run.bytes.mean)}/frame at ${run.width}x${run.height}`
  )
}

function pageCsp(): string | null {
  return document.querySelector('meta[http-equiv="Content-Security-Policy" i]')?.getAttribute('content') ?? null
}

async function checkEncode(options: NonNullable<GraphicCheckOptions['encode']>, frames: Frames, summary: string[], notes: string[]): Promise<EncodeResult> {
  const count = Math.max(2, Math.floor(options.frames ?? 120))
  const poolAsked = options.pool !== undefined || options.region !== undefined || options.workers === undefined
  const depths = poolAsked ? (options.pool ?? [1, 2, 4]) : []
  const regions: ('canvas' | 'box')[] = options.region ?? (poolAsked ? ['canvas', 'box'] : ['canvas'])
  const box = syntheticBox(count)
  const csp = pageCsp()
  // The conditions' line goes first, filled in once the runs are done and the cadence after them is known.
  const conditionsAt = summary.length
  summary.push('')
  const before = await pageConditions()
  const toBlob2x2 = await toBlobFloor()

  // Warm: the first encode of a page pays for starting its encoder, and the first draw for the face.
  await poolRun('canvas', 4, 8)

  const runs: EncodeRun[] = []
  // The sampled frames per region, with the label of the run they came from.
  const kept = new Map<string, { label: string; frames: Map<number, ArrayBuffer> }>()
  for (const region of regions) {
    for (const depth of depths) {
      const timed = await poolRun(region, depth, count)
      runs.push(timed.run)
      if (!kept.has(region)) kept.set(region, { label: `M1 ${region} pool ${depth}`, frames: timed.kept })
      summary.push(`M1 ${region} pool ${depth}: ${describeRun(timed.run)}`)
    }
  }

  const workerRuns: (EncodeRun | WorkerRun)[] = []
  let workersAgainstPool: EncodeResult['workersAgainstPool']
  if (options.workers?.length) {
    for (const region of regions) {
      // M2's baseline: the four-deep pool, on the same frames, in the same call.
      const baseline = await poolRun(region, 4, count)
      workerRuns.push(baseline.run)
      if (!kept.has(region)) kept.set(region, { label: `M2 ${region} baseline pool 4`, frames: baseline.kept })
      summary.push(`M2 ${region} baseline pool 4: ${describeRun(baseline.run)}`)
      for (const n of options.workers) {
        const { run, kept: theirs } = await workerRun(region, Math.max(1, Math.floor(n)), count)
        workerRuns.push(run)
        if ('refused' in run) {
          summary.push(`M2 ${region} workers ${n}: not run, ${run.refused}`)
          continue
        }
        summary.push(`M2 ${region} workers ${n}: ${describeRun(run)}`)
        if (!workersAgainstPool) {
          workersAgainstPool = []
          const ours = kept.get(region)!.frames
          for (const frame of [0, count - 1]) {
            const a = ours.get(frame)
            const b = theirs.get(frame)
            if (!a || !b) continue
            const same = sameBytes(a, b)
            const diff = same ? null : diffRgba(await decodePng(a, run.width, run.height), await decodePng(b, run.width, run.height), run.width)
            workersAgainstPool.push({ frame, sameBytes: same, diff })
            // The workers' own frame beside the pool's: the last always, and any that differs.
            if (!same || frame === count - 1) {
              frames.add(`M2 ${region} workers ${run.depth} frame ${frame}${same ? ' (byte-equal to the pool\'s)' : ''}`, await blobToDataUrl(new Blob([b], { type: 'image/png' })))
            }
          }
        }
      }
    }
  }

  const after = await pageConditions()
  const conditions: RunConditions = { before, after, toBlob2x2, throttled: throttledPage(before) || throttledPage(after) }
  summary[conditionsAt] = reportConditions(options.workers?.length ? (depths.length ? 'M1/M2' : 'M2') : 'M1', conditions, summary, notes) + `; CSP ${csp === null ? 'none on this page' : `"${csp}"`}`

  // The frames themselves: a sample from each region, decoded, so the check can see what it timed.
  let boxAgainstCanvas: PixelDiff | undefined
  const canvasKept = kept.get('canvas')
  const boxKept = kept.get('box')
  if (canvasKept) {
    for (const [frame, bytes] of canvasKept.frames) {
      const data = await decodePng(bytes, SYNTHETIC.width, SYNTHETIC.height)
      const ink = inkBox(data, SYNTHETIC.width, SYNTHETIC.height)
      if (!ink) throw new Error(`graphic check: canvas frame ${frame} encoded blank`)
      if (!contains(box, ink)) throw new Error(`graphic check: frame ${frame}'s ink ${JSON.stringify(ink)} is outside the box ${JSON.stringify(box)}`)
      frames.add(`${canvasKept.label} frame ${frame}`, await blobToDataUrl(new Blob([bytes], { type: 'image/png' })))
    }
  }
  if (boxKept) {
    for (const [frame, bytes] of boxKept.frames) frames.add(`${boxKept.label} frame ${frame}`, await blobToDataUrl(new Blob([bytes], { type: 'image/png' })))
  }
  if (canvasKept && boxKept) {
    const frame = 0
    const whole = await decodePng(canvasKept.frames.get(frame)!, SYNTHETIC.width, SYNTHETIC.height)
    const part = await decodePng(boxKept.frames.get(frame)!, box.width, box.height)
    const cropped = new Uint8ClampedArray(box.width * box.height * 4)
    for (let y = 0; y < box.height; y++) {
      const from = ((box.y + y) * SYNTHETIC.width + box.x) * 4
      cropped.set(whole.subarray(from, from + box.width * 4), y * box.width * 4)
    }
    boxAgainstCanvas = diffRgba(cropped, part, box.width)
    // Not always bit-equal: the live run found one pixel on the stroke's moving tip 17 levels apart (GPU rasterisation).
    summary.push(
      `M1 box against canvas, frame 0: mean ${boxAgainstCanvas.mean.toFixed(6)}, max ${boxAgainstCanvas.max}, ${boxAgainstCanvas.differing} of ${boxAgainstCanvas.pixels} pixels differ`
    )
  }

  return {
    synthetic: { width: SYNTHETIC.width, height: SYNTHETIC.height, panel: syntheticPanelAt(0), box, frames: count },
    conditions,
    csp,
    runs,
    workers: workerRuns,
    boxAgainstCanvas,
    workersAgainstPool,
    note:
      'write is a recorder (bytes and time), not writeTitleFrame: these are the drawing and the encode, not the IPC and disk a bake adds. ' +
      'msPerFrame is §6.15\'s ms per frame at p50 and p95: at every frame, the span of depth consecutive writes over depth, since a pool deeper than 1 writes ' +
      'the frames whose encodes finished together back to back; gapMs, the raw gap between writes, is bursty there and is kept only beside it. ' +
      'encodeMs is each frame\'s own encode (toBlob\'s call to its blob; for workers, postMessage to the reply, with workerEncodeMs the worker\'s own convertToBlob). ' +
      'A main-thread toBlob encodes in the renderer\'s idle time, so its figures have the frame cadence as a floor: when encodeMs is close to conditions.toBlob2x2, ' +
      'a 2x2 canvas\'s, the figure is the scheduling and not the encode, and a region or depth that seems to cost nothing may be hidden under it. ' +
      'Run with the window visible, in front and untouched; a THROTTLED run is the throttle\'s. ' +
      'The workers\' times include createImageBitmap on the main thread. csp is this page\'s policy: the harness page has none, so only npm run dev\'s renderer ' +
      '(src/renderer/index.html\'s policy) answers whether the app admits the worker.'
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

async function checkBlur(options: NonNullable<GraphicCheckOptions['blur']>, frames: Frames, summary: string[], notes: string[]): Promise<BlurResult> {
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

  /*
   * The canvas a bake draws on, read only as a bake reads it: by toBlob. Never
   * by getImageData, which the first version did once a frame to make it
   * rasterise: after two readbacks Chrome moves a canvas to the CPU, where
   * blur(8px) cost the live run 120-140 ms a frame against about 8 ms added on
   * a canvas read only by toBlob. The encode makes it rasterise, and its time
   * is in both figures, so the difference is the filter's.
   */
  const { canvas, ctx } = canvas2d(width, height)
  const drawFrame = (frame: number, filter: string): void => {
    ctx.clearRect(0, 0, width, height)
    for (const p of placed) {
      ctx.save()
      ctx.filter = filter
      // Rising 2 px a frame, as the synthetic graphic does, so every frame differs.
      ctx.translate(p.x, (p.row - (rows - 1)) * layout.lineHeight - 2 * frame)
      drawTextOnto(ctx, { ...base, content: p.word }, width, height)
      ctx.restore()
    }
  }
  const bake = async (frame: number, filter: string): Promise<{ draw: number; total: number; blob: Blob }> => {
    const t0 = performance.now()
    drawFrame(frame, filter)
    const t1 = performance.now()
    const blob = await pngBlob(canvas)
    return { draw: t1 - t0, total: performance.now() - t0, blob }
  }

  const blurFilter = `blur(${px}px)`
  const conditionsBefore = await pageConditions()
  const toBlob2x2 = await toBlobFloor()
  // Warm both, then each frame plain and blurred in turn, so a drift in the machine's pace falls on both alike.
  for (let f = 0; f < 3; f++) {
    await bake(f, 'none')
    await bake(f, blurFilter)
  }
  const plain: { draw: number; total: number }[] = []
  const blurred: { draw: number; total: number }[] = []
  let last: Blob | null = null
  for (let f = 0; f < runFrames; f++) {
    const p = await bake(f, 'none')
    plain.push({ draw: p.draw, total: p.total })
    const b = await bake(f, blurFilter)
    blurred.push({ draw: b.draw, total: b.total })
    last = b.blob
  }
  const conditions: RunConditions = {
    before: conditionsBefore,
    after: await pageConditions(),
    toBlob2x2,
    throttled: false
  }
  conditions.throttled = throttledPage(conditions.before) || throttledPage(conditions.after)

  const blurMs = spread(blurred.map((t) => t.total))
  const plainMs = spread(plain.map((t) => t.total))
  const addedMs = spread(blurred.map((t, f) => t.total - plain[f].total))

  // The last blurred frame, decoded from its PNG on a canvas of its own: the timed one is never read back.
  const shown = canvas2d(width, height)
  const bitmap = await createImageBitmap(last!)
  shown.ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const ink = inkBox(pixels(shown.ctx), width, height)
  if (!ink) throw new Error('graphic check: the blur line drew nothing')
  frames.canvas(`M5 blur(${px}px), last frame`, crop(shown.canvas, padRect(ink, 8, width, height)))
  summary.push(reportConditions('M5', conditions, summary, notes))
  summary.push(
    `M5 ${count} words, blur(${px}px) at ${width}x${height}, drawn and encoded by toBlob: the filter adds p50 ${ms(addedMs.p50)}, p95 ${ms(addedMs.p95)} ms/frame ` +
      `(blurred p50 ${ms(blurMs.p50)}, p95 ${ms(blurMs.p95)}; plain p50 ${ms(plainMs.p50)}, p95 ${ms(plainMs.p95)})`
  )
  return {
    words: count,
    px,
    frames: runFrames,
    width,
    height,
    blurMs,
    plainMs,
    addedMs,
    blurDrawMs: spread(blurred.map((t) => t.draw)),
    plainDrawMs: spread(plain.map((t) => t.draw)),
    conditions,
    note:
      'Every word under the filter every frame, the worst case the row names, not a staggered entrance. Each frame is drawn and encoded by toBlob, as a bake pays for it, ' +
      'on a canvas never read back by getImageData (which would move it to the CPU, a canvas no bake uses); its plain twin is timed just before it. ' +
      'addedMs is what the filter adds to a frame, the figure M5\'s bar sets against M1\'s p50 encode. Both totals sit on toBlob\'s scheduling ' +
      '(conditions.toBlob2x2), so a filter cheaper than the slack under the frame cadence can read as nothing added. A THROTTLED run is the throttle\'s.'
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
  const dottedCircleWidth = advance(DOTTED_CIRCLE)

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

    // The consonant drawn alone from the same pen, found inside the whole drawing (preBaseLead says why not by edges).
    let matraFirst: boolean | null = null
    let consonantShift: number | null = null
    if (codePoints.includes(PRE_BASE_I)) {
      const consonant = draw({ ...base, content: codePoints.filter((cp) => cp !== PRE_BASE_I).join('') })
      const lead = preBaseLead(whole.data, consonant.data, width, height)
      matraFirst = lead ? lead.first : null
      consonantShift = lead ? lead.shift : null
    }

    const wholeWidth = advance(cluster)
    const codePointWidths = codePoints.map(advance)
    const sumWidth = codePointWidths.reduce((a, b) => a + b, 0)
    const marks = codePoints.filter((cp) => MARK.test(cp)).length
    // The letters alone, no mark, so no dotted circle: an unshaped conjunct is at least this wide, a shaped one narrower.
    const baseWidth = codePoints.filter((cp) => !MARK.test(cp)).reduce((sum, cp) => sum + advance(cp), 0)
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
      marks,
      baseWidth,
      narrower: conjunct ? wholeWidth < baseWidth : null,
      diff,
      differs: diff.mean > 1,
      matraFirst,
      consonantShift,
      likeMissingGlyph: missingGlyphWidth > 0 && Math.abs(wholeWidth - codePoints.length * missingGlyphWidth) < 0.5,
      resolvedBy: theirs.filter((c) => c.mean === 0).map((c) => c.font),
      candidates: theirs
    })
    pictures[0].push(crop(whole.canvas, padRect(area, 6, width, height)))
    pictures[1].push(crop(split.canvas, padRect(area, 6, width, height)))
    const r = rows[rows.length - 1]
    summary.push(
      `M22 ${cluster}: whole ${wholeWidth.toFixed(1)} px` +
        (conjunct ? ` against its letters' ${baseWidth.toFixed(1)}${r.narrower ? ' (narrower)' : ' (NOT narrower)'}` : '') +
        ` (code points alone ${sumWidth.toFixed(1)}, ${marks} mark${marks === 1 ? '' : 's'} on a dotted circle); ` +
        `frames ${r.differs ? 'differ' : 'DO NOT differ'} from the per-code-point frame (mean ${diff.mean.toFixed(3)} over the ink)` +
        `${matraFirst === null ? '' : `; i-matra ${matraFirst ? 'first' : 'NOT first'} (the consonant ${consonantShift} px right of where it is drawn alone)`}` +
        `; resolved by ${r.resolvedBy.length ? r.resolvedBy.join(', ') : 'no installed candidate'}`
    )
  }
  frames.canvas('M22: each cluster whole (top row) and one code point at a time (bottom row)', sheet(pictures, { width: 220, height: 200 }))
  summary.push(`M22 installed candidates: ${candidates.filter((c) => c.installed).map((c) => c.font).join(', ') || 'none'}; a dotted circle is ${dottedCircleWidth.toFixed(1)} px`)

  return {
    font,
    px,
    width,
    missingGlyphWidth,
    dottedCircleWidth,
    candidates,
    rows,
    note:
      'Drawn by drawTextOnto, cream on transparent, left-aligned, no tracking. A lone combining mark drawn on its own takes HarfBuzz\'s dotted circle ' +
      '(dottedCircleWidth), which widens its advance and inks the per-code-point row; libass\'s simple shaper draws none. So two readings carry the circle and ' +
      'cannot alone tell shaped from unshaped: sumWidth, and differs, which reads true for any engine that draws circles, shaped or not (it is kept as the ' +
      'plan\'s reading because the plan\'s mutation, an Array.from split in the painter, makes the two frames equal and must turn it false). ' +
      'narrower is measured against the letters without their marks (baseWidth), which carry no circle: an unshaped conjunct is at least that wide. ' +
      'matraFirst finds the consonant drawn alone inside the whole drawing (consonantShift, about the matra\'s width when shaped, 0 in logical order); ' +
      'comparing left edges cannot, since a shaped pre-base matra starts at the pen as the consonant alone does. ' +
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
    img.title = 'Click for its natural size; click again to shrink it'
    Object.assign(img.style, {
      display: 'block',
      maxWidth: '360px',
      maxHeight: '320px',
      cursor: 'zoom-in',
      background: 'repeating-conic-gradient(#808080 0 25%, #b0b0b0 0 50%) 0 0 / 16px 16px'
    })
    // The M22 sheet is 2200 px wide: shown at 360 it is too small for the eye check of a loose virama or matra.
    img.onclick = () => {
      const natural = img.style.maxWidth !== 'none'
      Object.assign(img.style, natural ? { maxWidth: 'none', maxHeight: 'none', cursor: 'zoom-out' } : { maxWidth: '360px', maxHeight: '320px', cursor: 'zoom-in' })
      Object.assign(figure.style, { maxWidth: natural ? 'none' : '360px', flexBasis: natural ? '100%' : 'auto', overflowX: natural ? 'auto' : 'visible' })
    }
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
  if (options.encode) result.encode = await checkEncode(options.encode, frames, summary, notes)
  if (options.segments) result.segments = checkSegments(frames, summary)
  if (options.blur) result.blur = await checkBlur(options.blur, frames, summary, notes)
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
