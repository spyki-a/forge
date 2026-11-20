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
import { drawListAt, graphicBox, needsCompositor, onsetTargetsAt } from '@shared/graphics/drawList'
import { paintDrawList2d, type PaintOptions } from '@shared/graphics/paint'
import { compositorRoute, flatItems } from '@shared/graphics/compositor'
import { graphicMovingFrames } from '@shared/graphics/frame'
import { landingFrame } from '@shared/graphics/templates/screenCard'
import { footageFrameIndex, type FootageRequest } from '@shared/render/moment'
import { facesFor, textSpecFont } from '@shared/render/textPaint'
import { ASCENT, LINE_HEIGHT } from '@shared/render/textLayout'
import { mediaUrl } from '@shared/mediaUrl'
import { beginBake, endBake, isSuperseded } from '@shared/bakeGuard'
import { encodeFrames } from './encodePool'
import { faceSettled, useCatalog } from './catalog'
import { create } from 'zustand'
import { WEBGL_MISSING_NOTE, createCompositor, forgetPlanes, paintDrawList3d, webglMissing, type Compositor } from './graphicCompositor'

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
      const bitmap = await createImageBitmap(await response.blob(), RAW_DECODE)
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

/**
 * How an `image` item's file is decoded: as ffmpeg reads it, the stored
 * orientation and the stored colour values (the moments' `pictureFor`,
 * momentCanvas.ts), so a screen card's frame `L` is the recording's own frame
 * to the level and its hand-off cannot be seen (§6.16).
 */
const RAW_DECODE: ImageBitmapOptions = Object.freeze({ imageOrientation: 'none', colorSpaceConversion: 'none', premultiplyAlpha: 'none' }) as ImageBitmapOptions

/**
 * Every `src` decoded into a map of its own, for one bake's (or the harness
 * frames') length, closed by the caller when it is done: a screen card's
 * moving frames are a picture each (31 at 30 fps), more than the preview's
 * memo of `BITMAP_MEMO` holds, so a bake decoding them there would close the
 * first ones before it painted them. A file that will not decode is left out
 * (its item skipped), as the memo's own decode does.
 */
async function decodeAll(srcs: readonly string[]): Promise<Map<string, ImageBitmap>> {
  const out = new Map<string, ImageBitmap>()
  await Promise.all(
    srcs.map(async (src) => {
      // Remembered with the memo's own: a file that would not decode is not fetched again, bake after bake.
      if (undecodable.has(src)) return
      try {
        const response = await fetch(mediaUrl(src))
        if (!response.ok) throw new Error(`${response.status}`)
        out.set(src, await createImageBitmap(await response.blob(), RAW_DECODE))
      } catch (error) {
        undecodable.add(src)
        console.warn('A graphic image will not decode and is left out', src, error instanceof Error ? error.message : String(error))
      }
    })
  )
  return out
}

function closeAll(images: Map<string, ImageBitmap>): void {
  for (const bitmap of images.values()) bitmap.close()
  images.clear()
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
 * (`needsCompositor`, drawList.ts) is §6.16's seam: given the caller's
 * compositor, painter B draws the whole frame (`paintDrawList3d`) and it is
 * copied into the caller's canvas with `drawImage`, as the moments copy
 * theirs; with none (WebGL missing, or not landed yet), painter A, which
 * ignores `camera`, `glow` and `z`, so the graphic draws flat, its items
 * in route one's order (`flatItems`: the dims, then the planes far to near),
 * so a list drawn without WebGL is the picture route one draws at rest
 * whatever order its drawer emitted. From phase 3's piece 3 a counter or
 * ring with a depth, or its clip's hero, asks for it (templates/depth.ts);
 * no other template does yet (pinned in tests/graphicDrawList.test.ts).
 */
function paintFrame(list: DrawList, ctx: CanvasRenderingContext2D, options: PaintOptions, compositor?: Compositor | null): void {
  if (compositor && needsCompositor(list)) {
    const frame = paintDrawList3d(list, compositor, { layer: options.layer, images: options.images })
    ctx.drawImage(frame, options.offset?.x ?? 0, options.offset?.y ?? 0)
    return
  }
  paintDrawList2d(ctx, needsCompositor(list) ? { ...list, items: flatItems(list) } : list, options)
}

/* ------------------------------------------------------- WebGL missing */

/** Preview clips drawn flat because WebGL did not start: the dock's graphic panel says so (§6.16). */
const drawnFlat = new Set<string>()

/**
 * The same clips as state a component subscribes to (phase 3's piece 3): the
 * dock's graphic panel reads it through this hook, so its note appears the
 * moment the preview learns WebGL is missing (a compositor that lands null),
 * not on the panel's next render for some other reason. A new set on every
 * change, so a selector sees it change.
 */
export const useGraphicDrawnFlat = create<{ ids: ReadonlySet<string> }>(() => ({ ids: new Set<string>() }))

function markDrawnFlat(clipId: string): void {
  if (drawnFlat.has(clipId)) return
  drawnFlat.add(clipId)
  useGraphicDrawnFlat.setState({ ids: new Set(drawnFlat) })
}

function unmarkDrawnFlat(clipId: string): void {
  if (!drawnFlat.delete(clipId)) return
  useGraphicDrawnFlat.setState({ ids: new Set(drawnFlat) })
}
/** The bakes' notes since they were last taken: a set, so the export records each once (§6.16, "WebGL missing"). */
const bakeNotes = new Set<string>()

/** Whether this clip's preview is drawn flat for want of WebGL (§6.16): the dock's graphic panel shows `WEBGL_MISSING_NOTE`. */
export function graphicDrawnFlat(clipId: string): boolean {
  return drawnFlat.has(clipId)
}

/**
 * The notes the graphic bakes recorded since the last call, each once, and
 * forgotten: the export takes them before its bake (dropping any a store
 * bake left) and after it, into its notes.
 */
export function takeGraphicBakeNotes(): string[] {
  const notes = [...bakeNotes]
  bakeNotes.clear()
  return notes
}

/** One compositor for a bake's (or the harness frames') length when a list asks for it; null, with the note, when WebGL is missing. */
async function compositorFor(lists: readonly DrawList[], width: number, height: number): Promise<Compositor | null> {
  if (!lists.some(needsCompositor)) return null
  const compositor = await createCompositor(width, height)
  if (!compositor) bakeNotes.add(WEBGL_MISSING_NOTE)
  return compositor
}

/* ------------------------------------------------------------ screen card */

/**
 * A screen card's targets with each frame's file filled from the moments'
 * footage pre-pass (§6.3, §6.16): `window.forge.momentFrames(footage)`, the
 * pull a bridge over footage makes, then for card frame `f` up to the landing
 * `L` (`landingFrame(footage.fps)`) the pulled file `footageFrameIndex` names,
 * and from `L + 1` on `null`, with the box `targetsAt` gave. Past `L` the
 * targets are read once and handed back for every frame: the card's box is
 * fixed at its first frame (graphics/targets.ts), and a 600 s card's hold
 * would otherwise map the recording's crop once a frame while the bake looks
 * for the last frame whose targets differ. `footage.first` is where the card
 * starts in the recording (0: a card spans its recording). Rejects when the
 * pull fails or comes back empty: the export then drops the card and strikes
 * its two keys (exportBake.ts), the store's bake keeps the frames it had.
 * Every other template never reaches here.
 */
export async function screenTargetsAt(footage: FootageRequest, targetsAt: (frame: number) => GraphicTargets): Promise<(frame: number) => GraphicTargets> {
  const pulled = await window.forge.momentFrames(footage)
  if (pulled.files.length === 0) throw new Error("the screen card's recording gave no frames")
  return filledScreenTargets(pulled.files, footage, targetsAt)
}

/** `targetsAt` with each frame's `screen.file` from `files` (the pull's), up to the landing; the hold's targets read once. */
function filledScreenTargets(files: readonly string[], footage: Pick<FootageRequest, 'first' | 'duration' | 'fps'>, targetsAt: (frame: number) => GraphicTargets): (frame: number) => GraphicTargets {
  const L = landingFrame(footage.fps)
  const plan = { pulled: { files: [...files], first: footage.first }, at: footage.first, frames: Math.max(1, footage.duration) }
  let held: GraphicTargets | undefined
  return (frame) => {
    if (frame > L) {
      if (held === undefined) {
        const t = targetsAt(L + 1)
        held = t.screen ? { ...t, screen: { box: t.screen.box, file: null } } : t
      }
      return held
    }
    const t = targetsAt(frame)
    return t.screen ? { ...t, screen: { box: t.screen.box, file: files[footageFrameIndex(plan, frame)] ?? null } } : t
  }
}

/**
 * The preview's pulls, by card clip: the request asked for, what came back,
 * and its frames decoded (`bitmaps`), held with the pull and closed with it
 * (a new request, `forgetGraphicPreview`): the move's frames are a picture
 * each, 31 at 30 fps, and the memo of `BITMAP_MEMO` evicts its oldest, so
 * each play of the move would miss every frame and draw the card's box empty
 * until its decode landed, over a recording its hold key hides (the critics'
 * fix to piece 4). The pull is ready only once they are decoded.
 */
interface ScreenPull {
  key: string
  state: 'pending' | 'ready' | 'failed'
  fill?: (frame: number) => GraphicTargets
  files: string[]
  bitmaps: Map<string, ImageBitmap>
  onReady?: () => void
}
const screenPulls = new Map<string, ScreenPull>()

/** A card's pull let go: its decoded frames closed. */
function dropScreenPull(clipId: string): void {
  const pull = screenPulls.get(clipId)
  if (pull) closeAll(pull.bitmaps)
  screenPulls.delete(clipId)
}

/** The bitmap a preview frame's card picture is drawn from: the card's own pull's, held for the pull's life. */
function pulledBitmap(clipId: string, targets: GraphicTargets): { src: string; bitmap: ImageBitmap } | null {
  const src = targets.screen?.file
  const bitmap = src ? screenPulls.get(clipId)?.bitmaps.get(src) : undefined
  return src && bitmap ? { src, bitmap } : null
}

/**
 * Cards whose recording's frames could not be pulled for the preview (the
 * file gone, the pre-pass refusing): the dock's graphic panel says the export
 * will leave the card out (§14's row: "a pull that fails drops the card from
 * the export with its note and strikes its two keys").
 */
export const useScreenCardFailed = create<{ ids: ReadonlySet<string> }>(() => ({ ids: new Set<string>() }))

function markScreenFailed(clipId: string, failed: boolean): void {
  const has = useScreenCardFailed.getState().ids.has(clipId)
  if (has === failed) return
  const ids = new Set(useScreenCardFailed.getState().ids)
  if (failed) ids.add(clipId)
  else ids.delete(clipId)
  useScreenCardFailed.setState({ ids })
}

/**
 * The preview's targets for a screen card at card frame `frame` (§6.16): its
 * box from `targets` (graphicTargetsAt), and up to the landing the pulled
 * frame's file, the pull asked for once per request (`footage`, from
 * `screenCardFootage` on the project as it is) and kept with the clip. Null
 * while the pull is on its way and the frame needs a picture (the Preview
 * draws nothing for the card, as for a moment still loading), `onReady`
 * called once it lands. When the pull fails, or no request can be built, the
 * card is drawn without its picture and marked (`useScreenCardFailed`). From
 * `L + 1` the targets as given: the hold needs no frame. Any target that is
 * not a card's comes back as given.
 */
export function screenPreviewTargets(
  clipId: string,
  footage: FootageRequest | null,
  targets: GraphicTargets,
  frame: number,
  onReady?: () => void
): GraphicTargets | null {
  if (!targets.screen) return targets
  if (!footage) {
    markScreenFailed(clipId, true)
    return targets
  }
  if (frame > landingFrame(footage.fps)) return targets
  const key = JSON.stringify(footage)
  let pull = screenPulls.get(clipId)
  if (!pull || pull.key !== key) {
    dropScreenPull(clipId)
    const started: ScreenPull = { key, state: 'pending', files: [], bitmaps: new Map(), onReady }
    pull = started
    screenPulls.set(clipId, started)
    markScreenFailed(clipId, false)
    void window.forge.momentFrames(footage).then(
      async (pulled) => {
        if (screenPulls.get(clipId) !== started) return
        if (pulled.files.length === 0) started.state = 'failed'
        else {
          // Every frame of the move decoded before the pull is ready, held with it (`ScreenPull`).
          const bitmaps = await decodeAll(pulled.files)
          if (screenPulls.get(clipId) !== started) {
            closeAll(bitmaps)
            return
          }
          started.bitmaps = bitmaps
          started.state = 'ready'
          started.files = pulled.files
        }
        markScreenFailed(clipId, started.state === 'failed')
        started.onReady?.()
      },
      (error: unknown) => {
        if (screenPulls.get(clipId) !== started) return
        console.warn("A screen card's recording frames could not be pulled", error instanceof Error ? error.message : String(error))
        started.state = 'failed'
        markScreenFailed(clipId, true)
        started.onReady?.()
      }
    )
  }
  pull.onReady = onReady
  if (pull.state === 'pending') return null
  if (pull.state === 'failed') return targets
  pull.fill ??= filledScreenTargets(pull.files, footage, () => targets)
  // The box is the one given now: the fill was made from these targets, and a moved box is a new request.
  const filled = pull.fill(frame)
  return filled.screen ? { ...targets, screen: { box: targets.screen.box, file: filled.screen.file } } : targets
}

/* ----------------------------------------------------------------- preview */

interface PreviewEntry {
  canvas: HTMLCanvasElement
  signature: string
}

const previews = new Map<string, PreviewEntry>()

/**
 * Per clip, the compositor its preview keeps once a list has asked for one
 * (§6.16), made for one size: `pending` while `createCompositor` runs, then
 * the compositor, or null when WebGL is missing. Rebuilt (the old one
 * disposed) when the size changes; disposed with the clip
 * (`forgetGraphicPreview`); one that lands for a slot no longer the clip's
 * (superseded, or the clip forgotten meanwhile) is disposed on landing, as
 * the moments dispose theirs (momentCanvas.ts).
 */
interface DeepSlot {
  size: string
  pending: boolean
  compositor: Compositor | null
  onReady?: () => void
  /** When its clip last drew through it (`Date.now()`): a slot drawn within `PREVIEW_COMPOSITOR_HOLD_MS` is never evicted. */
  drawnAt: number
}

/**
 * The preview's compositors, by clip, least recently drawn first (a `Map`
 * keeps insertion order; a drawn slot is moved to the end). Bounded two ways
 * (phase 3's piece 3; pieces 1 and 2 kept one per clip that ever asked, never
 * freed until the clip went): a clip whose frame is route one's (a settled
 * frame with no glow, `compositorRoute` 'flat', which painter A draws with
 * no WebGL call) gives its compositor back at once, so a hero at rest holds
 * none; and at most `PREVIEW_COMPOSITOR_CAP` are kept, the least recently
 * drawn disposed when another is made, but never one drawn within
 * `PREVIEW_COMPOSITOR_HOLD_MS`: those are on screen now, in this paint pass
 * or the last. With every kept slot that fresh, the clip asking is drawn flat
 * with no compositor made, not cached, and asks again on its next draw. An
 * eviction of a fresh slot would loop: four clips needing one on the same
 * frame evicted each other in turn, each landing's `onReady` repainted, the
 * repaint evicted again, and no clip was ever drawn through WebGL. Each holds a frame-sized canvas and
 * texture per layer (up to `MAX_PLANES` planes, a base, the 1:1 layer, and
 * the glow's targets), so a session that scrubbed past many heroes would
 * otherwise keep them all.
 */
const compositors = new Map<string, DeepSlot>()

/**
 * At most this many preview compositors alive at once (proposal): the clips
 * moving or glowing on screen together. A hero's entrance, a glowing hero
 * at rest and a graphic of yours with a depth can share a frame; a fourth
 * evicts the least recently drawn, which is made again (drawn flat while it
 * lands) if it is drawn again.
 */
export const PREVIEW_COMPOSITOR_CAP = 3

/**
 * A kept compositor drawn this recently is on screen and is not evicted for
 * another clip (proposal): longer than one paint pass of every clip and
 * than a frame at the slowest rate, short enough that a hero scrolled away
 * gives its slot up within a quarter second.
 */
export const PREVIEW_COMPOSITOR_HOLD_MS = 250

/**
 * Whether the clip's Preview holds a compositor that has landed (not on its
 * way, not null for want of WebGL). The harness's `bake3d` option reads it so
 * a Preview frame drawn flat (WebGL missing, or the cap full) is named, not
 * compared with a flat bake and passed. No production caller.
 */
export function graphicPreviewHasCompositor(clipId: string): boolean {
  return Boolean(compositors.get(clipId)?.compositor)
}

/** Give back a clip's preview compositor; one still on its way is disposed on landing (the slot is no longer the clip's). */
function releaseDeepSlot(clipId: string): void {
  compositors.get(clipId)?.compositor?.dispose()
  compositors.delete(clipId)
}

/** The clip's slot, made when there is room; null when the cap is full of slots drawn within the hold (the clip is drawn flat, `compositors`). */
function deepSlotOf(clipId: string, width: number, height: number, onReady?: () => void): DeepSlot | null {
  const size = `${width}x${height}`
  const now = Date.now()
  const existing = compositors.get(clipId)
  if (existing && existing.size === size) {
    existing.onReady = onReady
    existing.drawnAt = now
    // The most recently drawn, last.
    compositors.delete(clipId)
    compositors.set(clipId, existing)
    return existing
  }
  releaseDeepSlot(clipId)
  while (compositors.size >= PREVIEW_COMPOSITOR_CAP) {
    // The least recently drawn is first: if it is still on screen, every other one is too.
    const [oldest, kept] = compositors.entries().next().value as [string, DeepSlot]
    if (now - kept.drawnAt < PREVIEW_COMPOSITOR_HOLD_MS) return null
    releaseDeepSlot(oldest)
  }
  const slot: DeepSlot = { size, pending: true, compositor: null, onReady, drawnAt: now }
  compositors.set(clipId, slot)
  void createCompositor(width, height).then((compositor) => {
    if (compositors.get(clipId) !== slot) {
      compositor?.dispose()
      return
    }
    slot.pending = false
    slot.compositor = compositor
    // WebGL missing: marked now, so the dock's note appears with this repaint, not on a later unrelated one.
    if (!compositor) markDrawnFlat(clipId)
    slot.onReady?.()
  })
  return slot
}

/** Per clip, its own dim layer factory: the painter keeps its dim layers per factory, so a clip's go when the clip is forgotten and no clip pays for another's. */
const previewLayers = new Map<string, (width: number, height: number) => CanvasRenderingContext2D>()
/**
 * Per clip, the faces and images a redraw is already waiting on, so one
 * `onReady` is owed per face, not one per frame drawn meanwhile; and the
 * latest `onReady` given, the one called when something lands, so a caller
 * that passes a new callback per render is not called back on a stale one.
 */
const warming = new Map<string, { owed: Set<string>; onReady?: () => void }>()
/** Every redraw of any preview canvas, counted: the stamp `canvasContentKey` (grade.ts) reads must move with the picture, not with the key. */
let paints = 0

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
 * `dataset.forgeRev`, which `canvasContentKey` (grade.ts) reads, with a count
 * of redraws, as `momentCanvas` does, not with the key: the same frame is
 * redrawn on the same canvas while a face loads and once more when it has
 * landed, and a stamp that stayed the key's would serve the grade's copy of
 * the fallback face for as long as the playhead held there. `targets` is an
 * argument so that the preview draws the same targets the bake does.
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
  canvas.dataset.forgeRev = String(++paints)

  const list = drawListAt(spec, style, drawn, clock.fps, { width, height }, graphicMeasure(), targets, drawer)
  /*
   * §6.16's seam: a list that asks for the compositor gets the clip's; drawn
   * flat until it lands, and for good without WebGL. A frame that is route
   * one's (settled, no glow) is painter A's alone, so it needs none and the
   * clip's is given back (`compositors`).
   */
  const asks = needsCompositor(list)
  const wants = asks && compositorRoute(list) !== 'flat'
  const deep = wants ? deepSlotOf(clipId, width, height, onReady) : null
  // Given back on any frame that does not want one, a list that no longer asks at all included: a screen card
  // after its landing (and after its edge sweep's loop) carries no camera and no glow (piece 5's fix: it kept its slot).
  if (!wants) releaseDeepSlot(clipId)
  if (asks && (webglMissing() || (deep && !deep.pending && !deep.compositor))) markDrawnFlat(clipId)
  // A screen card's frame from its own pull's bitmaps (`ScreenPull`), the memo's for every other image.
  const pulled = pulledBitmap(clipId, targets)
  const images: ReadonlyMap<string, ImageBitmap> = pulled ? new Map(bitmaps).set(pulled.src, pulled.bitmap) : bitmaps
  paintFrame(list, ctx, { layer: previewLayerOf(clipId), images }, deep?.compositor)

  const faces = facesOf([list], style)
  const imageReady = (src: string): boolean => images.has(src) || undecodable.has(src)
  const waiting = [...faces.filter((face) => !faceSettled(face)), ...imagesOf([list]).filter((src) => !imageReady(src))]
  // A layer painted in the fallback face would be kept by its key once the face lands.
  if (waiting.length > 0 && deep?.compositor) forgetPlanes(deep.compositor)
  if (waiting.length > 0) {
    const slot = warming.get(clipId) ?? { owed: new Set<string>() }
    slot.onReady = onReady
    warming.set(clipId, slot)
    const { owed } = slot
    const fresh = waiting.filter((name) => !owed.has(name))
    for (const name of fresh) owed.add(name)
    if (fresh.length > 0) {
      const { ensureFont } = useCatalog.getState()
      const isFace = new Set(faces)
      void Promise.all(fresh.map((name) => (isFace.has(name) ? ensureFont(name).then(() => undefined) : decodeImage(name))))
        .then(
          () => true,
          (error: unknown) => {
            // `ensureFont` catches its own load errors and `decodeImage` its own, so this is the
            // bridge failing: swallowed, and the names are owed no more, so the next draw asks again.
            console.warn('A graphic preview could not ask for a face or an image', error instanceof Error ? error.message : String(error))
            return false
          }
        )
        .then((answered) => {
          for (const name of fresh) owed.delete(name)
          // Only what landed (or failed for good) earns a repaint: before the
          // catalogue has loaded, `ensureFont` answers false at once and records
          // nothing, and a repaint then would ask again, and again.
          if (answered && fresh.some((name) => (isFace.has(name) ? faceSettled(name) : imageReady(name)))) slot.onReady?.()
        })
    }
    // The canvas is kept for the next frame, the picture is not: no signature matches the empty one.
    previews.set(clipId, { canvas, signature: '' })
    return canvas
  }

  // Drawn flat while the compositor is on its way, or for want of a free one: not kept, so the frame is drawn again.
  previews.set(clipId, { canvas, signature: deep?.pending || (wants && !deep) ? '' : signature })
  return canvas
}

/** Drop a graphic clip's preview canvas: the clip was removed (Preview's sweep). */
export function forgetGraphicPreview(clipId: string): void {
  previews.delete(clipId)
  dropScreenPull(clipId)
  markScreenFailed(clipId, false)
  previewLayers.delete(clipId)
  warming.delete(clipId)
  releaseDeepSlot(clipId)
  unmarkDrawnFlat(clipId)
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
 * clip's bake waits (D10), and the lists and the box are built AFTER they
 * have landed (the lists once before, only to learn what they need): a text
 * item is boxed at its measured width, and a width measured in the fallback
 * face while the real one loaded would have the painter shrink the landed
 * glyphs into the narrower box, and the box route cut the canvas to it,
 * permanently, in the export. The clip is claimed (`beginBake`) BEFORE the
 * awaits and checked after them, so an older bake whose face lands late
 * finds the clip taken by the newer one that finished meanwhile and answers
 * null, rather than clearing that bake's frames and writing its stale
 * picture over them (`bakeTextSequence` in textCanvas.ts still claims after
 * its await; outside this file). Then, under `bakeGuard` (`isSuperseded`
 * before each write, `endBake` in a `finally`, as `bakeMomentSequence`), the
 * clip's frames are cleared and `encodeFrames` draws, encodes and writes
 * them `GRAPHIC_POOL_DEPTH` at a time through `writeTitleFrame`. Returns the
 * ffmpeg pattern with the frame count and the box, or null when superseded,
 * when nothing is drawn, when the box route finds every frame's ink outside
 * the frame, or when no frame or rate is given.
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
  // Built once to learn the faces and images the frames need (neither depends
  // on the measure), and again below once they have landed, since the memo
  // behind `measure` is dropped when a face does and every text item's box
  // is its measured width.
  const probe = listsOf(spec, style, fps, size, measure, at, moving, drawer)
  if (probe.every((list) => list.items.length === 0)) return null

  const token = beginBake(clipId)
  let compositor: Compositor | null = null
  let images = new Map<string, ImageBitmap>()
  try {
    // The faces, then the images, before any canvas: a face that is not loaded
    // yet would bake in the fallback and look exactly like the font picker
    // doing nothing, permanently, in the export (textCanvas.ts). The images
    // into the bake's own map (`decodeAll`), closed in the `finally`.
    await ensureFaces(facesOf(probe, style))
    images = await decodeAll(imagesOf(probe))
    if (isSuperseded(clipId, token)) return null

    const lists = listsOf(spec, style, fps, size, measure, at, moving, drawer)
    // A list that asks for the compositor is drawn whole-frame (§6.16): a tilt or a glow inks outside
    // the flat `itemBounds` that `graphicBox` unions, so the box would crop it. The canvas, then.
    const deep = lists.some(needsCompositor)
    const boxRoute = GRAPHIC_BAKE_REGION === 'box' && boxAllowed && !deep
    const box = boxRoute ? graphicBox(spec, style, fps, total, size, measure, targetsAt, drawer) : null
    if (boxRoute && !box) return null
    compositor = await compositorFor(lists, width, height)
    if (isSuperseded(clipId, token)) return null
    const region = box ?? { x: 0, y: 0, width, height }

    await window.forge.clearTitleFrames(clipId)
    // The rule, stated; `encodeFrames`'s first `cancelled()` would catch it too, before any draw.
    if (isSuperseded(clipId, token)) return null
    const layer = (w: number, h: number): CanvasRenderingContext2D => freshLayer(w, h)
    const offset = box ? { x: -box.x, y: -box.y } : undefined
    const pattern = await encodeFrames({
      count: moving,
      width: region.width,
      height: region.height,
      depth: GRAPHIC_POOL_DEPTH,
      draw: (ctx, index) => paintFrame(lists[index], ctx, { offset, layer, images }, compositor),
      write: (index, bytes) => window.forge.writeTitleFrame(clipId, index, bytes),
      cancelled: () => isSuperseded(clipId, token)
    })
    if (pattern === null) return null
    return box ? { pattern, frames: moving, box } : { pattern, frames: moving }
  } finally {
    endBake(clipId)
    compositor?.dispose()
    closeAll(images)
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
 * and the bake, after the same faces and images have landed, the lists
 * built again then, as the bake's are, so no text is boxed at the fallback
 * face's width.
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
  const listsNow = (): DrawList[] => frames.map((frame) => drawListAt(spec, style, within(frame), fps, { width, height }, measure, at(within(frame)), drawer))
  const probe = listsNow()
  await ensureFaces(facesOf(probe, style))
  const images = await decodeAll(imagesOf(probe))
  const lists = listsNow()
  const compositor = await compositorFor(lists, width, height)
  try {
    return lists.map((list) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (ctx) paintFrame(list, ctx, { layer: freshLayer, images }, compositor)
      return canvas
    })
  } finally {
    compositor?.dispose()
    closeAll(images)
  }
}
