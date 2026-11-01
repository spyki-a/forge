/**
 * A graphic clip's three pictures (docs/CLIPS.md §6.3, "`graphicCanvas.ts` —
 * preview, bake, frames"): the live canvas the Preview shows, the PNG
 * sequence the export plays, and single frames on canvases of their own for
 * the harness check. One engine (§16.54, D1): each asks `drawListAt`
 * (shared/graphics/drawList.ts) for the frame's list and paints it through
 * one `paintFrame`, so the three cannot paint differently. This file holds
 * what only the renderer has: the document's canvases and fonts, the measure
 * (`measureText` on a scratch context set with the very font the painter
 * draws, `textSpecFont`), the catalogue's readiness, the decoded bitmaps an
 * `image` item names, the bake's writes through the main process and its
 * supersede guard.
 *
 * `GRAPHIC_BAKE_REGION` and `GRAPHIC_POOL_DEPTH` are M1's (2026-10-27,
 * §6.15): the export's bake draws the box `graphicBox` computes when the
 * caller allows it (`boxAllowed`, the export's `identityPlaced`), the canvas
 * otherwise; four frames in flight (four workers, `encodePool.ts`).
 */

import type { GraphicSpec } from '@shared/graphics/template'
import type { GraphicStyle } from '@shared/graphics/style'
import type { DrawItem, DrawList, Drawer, GraphicTargets, Rect, TextMeasure } from '@shared/graphics/items'
import { textSpecOf } from '@shared/graphics/items'
import { drawListAt, graphicBox, onsetTargetsAt } from '@shared/graphics/drawList'
import { paintDrawList2d, type PaintOptions } from '@shared/graphics/paint'
import { graphicMovingFrames } from '@shared/graphics/frame'
import { facesFor, textSpecFont } from '@shared/render/textPaint'
import { ASCENT, LINE_HEIGHT } from '@shared/render/textLayout'
import { mediaUrl } from '@shared/mediaUrl'
import { beginBake, endBake, isSuperseded } from '@shared/bakeGuard'
import { encodeFrames } from './encodePool'
import { faceSettled, useCatalog } from './catalog'

/* --------------------------------------------------------------- M1 and M2 */

/**
 * Which region the export's bake encodes (§6.3, "The bake region (M1) and the
 * box route"): `'box'`, set 2026-10-27 from the Surface's M1, where the box's
 * p50 encode was 38.8–46.0 % under the canvas's (§6.15). The store's own
 * bakes always take the canvas; only the export passes `boxAllowed`.
 */
export const GRAPHIC_BAKE_REGION: 'canvas' | 'box' = 'box'

/** Frames in flight at once, the depth fastest on the Surface (M1, 2026-10-27): with the worker back-end, the workers. */
export const GRAPHIC_POOL_DEPTH: 1 | 2 | 4 = 4

/* ------------------------------------------------------------- the measure */

/** Measurements kept, keyed on the font, the spacing and the text; the oldest dropped. */
const MEASURE_MEMO = 4096
const measured = new Map<string, { width: number; ascent: number; descent: number }>()
/** The catalogue's state the memo was filled under: a face landing or failing changes what a family measures as, so the memo is dropped then. */
let measuredUnder = -1
let scratch: CanvasRenderingContext2D | null = null

function scratchContext(): CanvasRenderingContext2D {
  if (scratch) return scratch
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a canvas to measure text on')
  scratch = ctx
  return ctx
}

/**
 * The renderer's `TextMeasure` (§6.3, "The measure"): a text as the painter
 * will draw it, through the `TextSpec` `textSpecOf` makes of it and the font
 * and letter spacing `textSpecFont` reads off that spec, set on a scratch
 * context before `measureText`, so measure and paint cannot read two fonts
 * (node's tests pass a fake of 0.55 em a grapheme instead). The width is the
 * advance; `ascent` and `descent` are the glyphs' own
 * (`actualBoundingBoxAscent` and `-Descent`, the overshoot `itemBounds`
 * widens a box by), the nominal `ASCENT` and `LINE_HEIGHT − ASCENT` of the
 * size where a context does not give them. Memoised, since a bake measures
 * the same strings on every frame, and dropped whenever the catalogue
 * settles or fails a face: a width measured in the fallback face while a
 * face loaded would otherwise outlive it.
 */
export function graphicMeasure(): TextMeasure {
  return (text, look) => {
    const px = Math.round(look.px)
    const height = Math.round(px * LINE_HEIGHT)
    const spec = textSpecOf(text, look, { x: 0, y: 0, width: 0, height })
    const { font, letterSpacing } = textSpecFont(spec, height)
    const { loadedFonts, failedFonts } = useCatalog.getState()
    const under = loadedFonts.size * 65536 + failedFonts.size
    if (under !== measuredUnder) {
      measured.clear()
      measuredUnder = under
    }
    const key = `${font}|${letterSpacing}|${text}`
    const hit = measured.get(key)
    if (hit) return hit
    const ctx = scratchContext()
    ctx.font = font
    ctx.letterSpacing = letterSpacing
    const m = ctx.measureText(text)
    const out = {
      width: m.width,
      ascent: Number.isFinite(m.actualBoundingBoxAscent) ? m.actualBoundingBoxAscent : ASCENT * px,
      descent: Number.isFinite(m.actualBoundingBoxDescent) ? m.actualBoundingBoxDescent : (LINE_HEIGHT - ASCENT) * px
    }
    if (measured.size >= MEASURE_MEMO) measured.delete(measured.keys().next().value as string)
    measured.set(key, out)
    return out
  }
}

/* ---------------------------------------------------------- faces, images */

function eachItem(items: readonly DrawItem[], visit: (item: DrawItem) => void): void {
  for (const item of items) {
    visit(item)
    if (item.kind === 'group') eachItem(item.children, visit)
  }
}

/**
 * Every face these lists draw: the style's (the Latin items' face) and, for
 * each text item, its own and the `INDIC_FONTS` face its script needs
 * (`facesFor`, §6.20), which `textItems` already set as a shaped piece's
 * `look.font`.
 */
function facesOf(lists: readonly DrawList[], style: GraphicStyle): string[] {
  const faces = new Set<string>([style.font])
  for (const list of lists) eachItem(list.items, (item) => {
    if (item.kind === 'text') for (const face of facesFor(item.look.font, item.text)) faces.add(face)
  })
  return [...faces]
}

/** Every `image` item's `src` in these lists. */
function imagesOf(lists: readonly DrawList[]): string[] {
  const srcs = new Set<string>()
  for (const list of lists) eachItem(list.items, (item) => {
    if (item.kind === 'image') srcs.add(item.src)
  })
  return [...srcs]
}

/** Decoded bitmaps by `src`, the oldest closed and dropped past the bound; a `src` that would not decode is remembered and skipped, not fetched again. */
const BITMAP_MEMO = 16
const bitmaps = new Map<string, ImageBitmap>()
const undecodable = new Set<string>()
const decoding = new Map<string, Promise<void>>()

/**
 * The file an `image` item names (an asset path, `assetPath.ts`'s join),
 * fetched over the media scheme the renderer reads every local file through
 * (`mediaUrl`) and decoded with `createImageBitmap`. A failure of either is
 * the item's to be skipped (§6.3's degraded modes), never the frame's.
 */
function decodeImage(src: string): Promise<void> {
  if (bitmaps.has(src) || undecodable.has(src)) return Promise.resolve()
  const pending = decoding.get(src)
  if (pending) return pending
  const promise = (async () => {
    try {
      const response = await fetch(mediaUrl(src))
      if (!response.ok) throw new Error(`${response.status}`)
      const bitmap = await createImageBitmap(await response.blob())
      if (bitmaps.size >= BITMAP_MEMO) {
        const oldest = bitmaps.keys().next().value as string
        bitmaps.get(oldest)?.close()
        bitmaps.delete(oldest)
      }
      bitmaps.set(src, bitmap)
    } catch (error) {
      undecodable.add(src)
      console.warn('A graphic image will not decode and is left out', src, error instanceof Error ? error.message : String(error))
    } finally {
      decoding.delete(src)
    }
  })()
  decoding.set(src, promise)
  return promise
}

/** Every face of `faces` loaded, or failed for good, through the catalogue. */
async function ensureFaces(faces: readonly string[]): Promise<void> {
  const { ensureFont } = useCatalog.getState()
  await Promise.all(faces.map((face) => ensureFont(face)))
}

/* --------------------------------------------------------------- painting */

/** A fresh canvas's context of the frame's size, for the dim's layer: the painter keeps up to four per factory and refuses a canvas it already holds. */
function freshLayer(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a canvas for a graphic layer')
  return ctx
}

/**
 * The one paint the preview, the bake and the harness's frames share
 * (§6.3): painter A over the list, with the caller's offset, its dim layer
 * factory and the decoded bitmaps. A list that asks for the compositor
 * (`needsCompositor`, drawList.ts) is §6.16's seam, phase 3's: painter B
 * into the caller's canvas, and painter A with a note where WebGL is
 * missing. No phase-1 or phase-2 list asks for it (pinned in
 * graphicDrawList), so painter A is the one paint here until then.
 */
function paintFrame(list: DrawList, ctx: CanvasRenderingContext2D, options: PaintOptions): void {
  paintDrawList2d(ctx, list, options)
}

/* ----------------------------------------------------------------- preview */

interface PreviewEntry {
  canvas: HTMLCanvasElement
  signature: string
}

const previews = new Map<string, PreviewEntry>()
/** Per clip, its own dim layer factory: the painter keeps its dim layers per factory, so a clip's go when the clip is forgotten and no clip pays for another's. */
const previewLayers = new Map<string, (width: number, height: number) => CanvasRenderingContext2D>()
/** Per clip, the faces and images a redraw is already waiting on, so one `onReady` is owed per face, not one per frame drawn meanwhile. */
const warming = new Map<string, Set<string>>()

function previewLayerOf(clipId: string): (width: number, height: number) => CanvasRenderingContext2D {
  let layer = previewLayers.get(clipId)
  if (!layer) {
    layer = (width, height) => freshLayer(width, height)
    previewLayers.set(clipId, layer)
  }
  return layer
}

/**
 * The live picture of a graphic clip, for the Preview (§6.3), following
 * `textPreviewCanvas` (textCanvas.ts): cached per clip, keyed on the size,
 * the spec without its `version`, the resolved style, the targets, the
 * clip's length and rate, and the frame, or `'settled'` past the moving
 * frames, so a held frame costs nothing and shows what `tpad` holds in the
 * export: the last moving frame's picture. Every redraw stamps
 * `dataset.forgeRev`, which `canvasContentKey` (grade.ts) reads. `targets`
 * is an argument so that the preview draws the same targets the bake does.
 *
 * Readiness is the catalogue's (`faceSettled`), as D10 made the text clip's:
 * while a face the list draws is still loading, or an `image` still
 * decoding, the frame is drawn and not cached, the face or image is asked
 * for, and `onReady` is called once it has landed (or failed for good), so
 * the Preview repaints; `document.fonts.check` answers true for a family no
 * FontFace names and is not asked. `drawer` is the seam the harness's
 * `primitives` option takes; no production caller passes it.
 */
export function graphicPreviewCanvas(
  clipId: string,
  spec: GraphicSpec,
  style: GraphicStyle,
  width: number,
  height: number,
  clock: { frame: number; total: number; fps: number },
  targets: GraphicTargets,
  onReady?: () => void,
  drawer?: Drawer
): HTMLCanvasElement | null {
  if (width < 2 || height < 2) return null
  const { version: _version, ...visible } = spec
  const moving = graphicMovingFrames(spec, style, clock.fps, clock.total)
  const settled = clock.frame >= moving
  const drawn = settled ? Math.max(0, moving - 1) : Math.max(0, clock.frame)
  const signature = `${width}x${height}|${clock.total}|${clock.fps}|${JSON.stringify(visible)}|${JSON.stringify(style)}|${JSON.stringify(targets)}|${settled ? 'settled' : drawn}`

  const existing = previews.get(clipId)
  if (existing && existing.signature === signature) return existing.canvas

  const canvas = existing?.canvas ?? document.createElement('canvas')
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, width, height)
  // A canvas keeps its identity when it is redrawn; the stamp is what moves when the picture does (grade.ts).
  canvas.dataset.forgeRev = signature

  const list = drawListAt(spec, style, drawn, clock.fps, { width, height }, graphicMeasure(), targets, drawer)
  paintFrame(list, ctx, { layer: previewLayerOf(clipId), images: bitmaps })

  const faces = facesOf([list], style)
  const imageReady = (src: string): boolean => bitmaps.has(src) || undecodable.has(src)
  const waiting = [...faces.filter((face) => !faceSettled(face)), ...imagesOf([list]).filter((src) => !imageReady(src))]
  if (waiting.length > 0) {
    const owed = warming.get(clipId) ?? new Set<string>()
    warming.set(clipId, owed)
    const fresh = waiting.filter((name) => !owed.has(name))
    for (const name of fresh) owed.add(name)
    if (fresh.length > 0) {
      const { ensureFont } = useCatalog.getState()
      const isFace = new Set(faces)
      void Promise.all(fresh.map((name) => (isFace.has(name) ? ensureFont(name).then(() => undefined) : decodeImage(name)))).then(() => {
        for (const name of fresh) owed.delete(name)
        // Only what landed (or failed for good) earns a repaint: before the
        // catalogue has loaded, `ensureFont` answers false at once and records
        // nothing, and a repaint then would ask again, and again.
        if (fresh.some((name) => (isFace.has(name) ? faceSettled(name) : imageReady(name)))) onReady?.()
      })
    }
    // The canvas is kept for the next frame, the picture is not: no signature matches the empty one.
    previews.set(clipId, { canvas, signature: '' })
    return canvas
  }

  previews.set(clipId, { canvas, signature })
  return canvas
}

/** Drop a graphic clip's preview canvas: the clip was removed (Preview's sweep). */
export function forgetGraphicPreview(clipId: string): void {
  previews.delete(clipId)
  previewLayers.delete(clipId)
  warming.delete(clipId)
}

/* -------------------------------------------------------------------- bake */

/** The lists of frames 0..count−1, each through the onset rule. */
function listsOf(
  spec: GraphicSpec,
  style: GraphicStyle,
  fps: number,
  size: { width: number; height: number },
  measure: TextMeasure,
  at: (frame: number) => GraphicTargets,
  count: number,
  drawer?: Drawer
): DrawList[] {
  const lists: DrawList[] = []
  for (let frame = 0; frame < count; frame++) lists.push(drawListAt(spec, style, frame, fps, size, measure, at(frame), drawer))
  return lists
}

/**
 * The moving frames (`graphicMovingFrames`), extended to the last frame
 * whose targets differ from the frame before's (§6.3): in step 3 only phase
 * 3's `screen` and phase 4's `tip` move per frame, `subject` being fixed at
 * onset by `onsetTargetsAt`, so in phase 1 this is `graphicMovingFrames`.
 */
function movingFramesOf(spec: GraphicSpec, style: GraphicStyle, fps: number, total: number, at: (frame: number) => GraphicTargets): number {
  let moving = graphicMovingFrames(spec, style, fps, total)
  let previous = JSON.stringify(at(Math.max(0, moving - 1)))
  for (let frame = moving; frame < total; frame++) {
    const now = JSON.stringify(at(frame))
    if (now !== previous) moving = frame + 1
    previous = now
  }
  return moving
}

/**
 * Bake a graphic clip as a numbered PNG sequence (§6.3): the moving frames
 * only (`graphicMovingFrames`, extended to the last frame whose `targetsAt`
 * differs), the export holding the last with `tpad` for the rest of the
 * clip. The region is the box `graphicBox` computes when `GRAPHIC_BAKE_REGION`
 * is `'box'` and `boxAllowed` (the export's `identityPlaced` clip), each
 * frame then drawn at `−box.x, −box.y` into a box-sized canvas as the
 * caption band is, and the box returned for the export's copy of the asset;
 * the canvas otherwise. Every face the lists draw is awaited through the
 * catalogue and every `image` decoded before a canvas is made, as the text
 * clip's bake waits (D10); then, under `bakeGuard` (`beginBake`,
 * `isSuperseded` before each write, `endBake` in a `finally`, as
 * `bakeMomentSequence`), the clip's frames are cleared and `encodeFrames`
 * draws, encodes and writes them `GRAPHIC_POOL_DEPTH` at a time through
 * `writeTitleFrame`. Returns the ffmpeg pattern with the frame count and the
 * box, or null when superseded, when nothing is drawn, or when no frame or
 * rate is given.
 */
export async function bakeGraphicSequence(
  spec: GraphicSpec,
  style: GraphicStyle,
  clipId: string,
  width: number,
  height: number,
  frames: number,
  fps: number,
  targetsAt: (frame: number) => GraphicTargets,
  boxAllowed: boolean,
  drawer?: Drawer
): Promise<{ pattern: string; frames: number; box?: Rect } | null> {
  if (width < 2 || height < 2 || !(fps > 0) || !(frames >= 1)) return null
  const total = Math.floor(frames)
  const size = { width, height }
  const measure = graphicMeasure()
  const at = onsetTargetsAt(targetsAt)
  const moving = movingFramesOf(spec, style, fps, total, at)
  const lists = listsOf(spec, style, fps, size, measure, at, moving, drawer)
  if (lists.every((list) => list.items.length === 0)) return null

  const box = GRAPHIC_BAKE_REGION === 'box' && boxAllowed ? graphicBox(spec, style, fps, total, size, measure, targetsAt, drawer) : null
  if (GRAPHIC_BAKE_REGION === 'box' && boxAllowed && !box) return null
  const region = box ?? { x: 0, y: 0, width, height }

  // The faces, then the images, before any canvas: a face that is not loaded
  // yet would bake in the fallback and look exactly like the font picker
  // doing nothing, permanently, in the export (textCanvas.ts).
  await ensureFaces(facesOf(lists, style))
  await Promise.all(imagesOf(lists).map(decodeImage))

  const token = beginBake(clipId)
  try {
    await window.forge.clearTitleFrames(clipId)
    if (isSuperseded(clipId, token)) return null
    const layer = (w: number, h: number): CanvasRenderingContext2D => freshLayer(w, h)
    const offset = box ? { x: -box.x, y: -box.y } : undefined
    const pattern = await encodeFrames({
      count: moving,
      width: region.width,
      height: region.height,
      depth: GRAPHIC_POOL_DEPTH,
      draw: (ctx, index) => paintFrame(lists[index], ctx, { offset, layer, images: bitmaps }),
      write: (index, bytes) => window.forge.writeTitleFrame(clipId, index, bytes),
      cancelled: () => isSuperseded(clipId, token)
    })
    if (pattern === null) return null
    return box ? { pattern, frames: moving, box } : { pattern, frames: moving }
  } finally {
    endBake(clipId)
  }
}

/* ------------------------------------------------------------------ frames */

/**
 * Chosen frames of a graphic, each drawn on a canvas of its own, for the
 * harness check (`window.__forgeGraphicCheck`'s `primitives` and `indic`
 * options, §6.11), as `momentFrameCanvases` (momentCanvas.ts). `total` is
 * the clip's length and the frames asked for are numbered within it (one
 * past it draws the last); each is drawn as the drawer gives it, a held
 * frame too, so the check can read the last moving frame against the held
 * end, at the canvas region, through the same `paintFrame` as the preview
 * and the bake, after the same faces and images have landed.
 */
export async function graphicFrameCanvases(
  spec: GraphicSpec,
  style: GraphicStyle,
  width: number,
  height: number,
  total: number,
  fps: number,
  frames: readonly number[],
  targetsAt: (frame: number) => GraphicTargets,
  drawer?: Drawer
): Promise<HTMLCanvasElement[]> {
  const measure = graphicMeasure()
  const at = onsetTargetsAt(targetsAt)
  const last = Math.max(0, Math.floor(total) - 1)
  const within = (frame: number): number => Math.min(last, Math.max(0, Math.floor(frame)))
  const lists = frames.map((frame) => drawListAt(spec, style, within(frame), fps, { width, height }, measure, at(within(frame)), drawer))
  await ensureFaces(facesOf(lists, style))
  await Promise.all(imagesOf(lists).map(decodeImage))
  return lists.map((list) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx) paintFrame(list, ctx, { layer: freshLayer, images: bitmaps })
    return canvas
  })
}
