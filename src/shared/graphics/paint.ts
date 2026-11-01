/// <reference lib="dom" />
//
// DOM types for this file alone, as render/textPaint.ts asks for them.
// `src/shared` is compiled into the main process too, where a canvas does not
// exist and where a stray `document` would be a real bug, so the lib is asked
// for here rather than widened for everything. Nothing here touches `document`
// at load time; the default layer does, and only when a dim is drawn in the
// renderer.

/**
 * Painter A (docs/CLIPS.md §6.3, "Painter A"): the canvas 2D painter of a
 * draw list. One engine (§16.54, D1): a pure function returns a list of
 * items (`drawListAt`, drawList.ts), and this paints it, or painter B (the
 * three.js compositor, §6.16) does from phase 3. The preview, the bake and the
 * harness's frames all paint through `paintDrawList2d`, so they cannot paint
 * differently.
 *
 * What it does and does not do. Items are drawn in list order; for each,
 * `save`, its opacity multiplied into `globalAlpha` (down a group's tree),
 * its transform applied about `itemOrigin` (items.ts, the point `itemBounds`
 * turns about), the kind drawn as §6.3's kinds table says, `restore`. Every
 * text item goes through `drawTextOnto` (render/textPaint.ts) whole, as the
 * `TextSpec` `textSpecOf` makes of it, so the painter splits, joins,
 * re-cases and formats nothing: the 42 looks apply (within
 * `GRAPHIC_TEXT_STYLES`, §6.5) and Chromium shapes the text (M22, §6.15). A
 * stroke is the polyline `strokeShape` (stroke.ts) computes, never a dashed
 * `Path2D` draw-on, so the line's end and its riding head are one number;
 * its width is `strokeWidth`'s, the floor `STROKE_MIN_PX` of a 1080-pixel
 * side, both imported from stroke.ts and declared nowhere here (§6.3's file
 * table, corrected 2026-10-28). A dim is a cached full-frame layer with its
 * hole cut by `destination-out`, composited at the item's opacity. `z`,
 * `camera` and `glow` are painter B's and are not read.
 *
 * It reads no clock and no random; the one state it keeps is two memos (the
 * flattened path per `d`, the dim's layer per hole and size), each bounded.
 */

import { STROKE_TOLERANCE, flattenPath, strokeShape, type HeadShape, type PathGeometry, type Point } from './stroke'
import { itemOrigin, textSpecOf, type DimItem, type DrawItem, type DrawList, type ImageItem, type ShapeItem, type StrokeItem, type TextItem } from './items'
import { drawTextOnto } from '../render/textPaint'

/**
 * The width rule is stroke.ts's, re-exported rather than redeclared: a reader
 * of the painter (its test; the harness's `strokes` widths check, §6.11) takes
 * the floor and the rule from the painter's own module, and the two cannot
 * differ. `paintDrawList2d` draws `strokeShape`'s width, which is
 * `strokeWidth(item.width, list)`.
 */
export { STROKE_MIN_PX, strokeWidth } from './stroke'

/** What a caller hands painter A beside the context and the list (§6.3). */
export interface PaintOptions {
  /** Translates the whole list: the box bake draws at `−box.x, −box.y`, as the caption band draws at `−band.y` (captionBake.ts). */
  offset?: Point
  /**
   * Makes the dim's offscreen context, of the frame's size. In the renderer
   * it defaults to a `document.createElement('canvas')`; node's tests pass a
   * second fake, since a fake context cannot make a canvas. Each call must
   * make a NEW canvas: the painter keeps up to four of them (per factory) and
   * draws their contents on later frames, so a shared scratch canvas would
   * wear the last hole cut on every cached dim. A factory that hands back a
   * canvas the painter already holds is refused with an error.
   */
  layer?: (width: number, height: number) => CanvasRenderingContext2D
  /** The decoded bitmaps an `image` item names by `src`; an item whose bitmap is missing is skipped. */
  images?: ReadonlyMap<string, ImageBitmap>
}

/**
 * Canvas's default `miterLimit`, set explicitly on every stroke item so a
 * caller's context state cannot widen a miter join past what `itemBounds`
 * allows (items.ts's `MITER_LIMIT`: ten half-widths). Never larger than 10.
 */
const MITER_LIMIT = 10

/* ------------------------------------------------------------------ memos */

/** Flattened paths per `d` (§6.3: "Painter A memoises it per d (64 entries)"); `STROKE_TOLERANCE` is a constant, so `d` alone is the key. */
const PATH_MEMO = 64
const paths = new Map<string, PathGeometry>()

function pathOf(d: string): PathGeometry {
  const hit = paths.get(d)
  if (hit) return hit
  const path = flattenPath(d, STROKE_TOLERANCE)
  if (paths.size >= PATH_MEMO) paths.delete(paths.keys().next().value as string)
  paths.set(d, path)
  return path
}

/**
 * The dim's layers, per hole and size and colour (§6.3, "The dim": the hole
 * is fixed at onset, so one layer serves every frame of a clip and only its
 * opacity animates). Keyed on the `layer` factory too, so two callers with
 * their own factories (two bakes, or node's tests) never see each other's
 * contexts. Four entries, the oldest dropped: a layer is a frame-sized canvas
 * (8 MB at 1080×1920, 33 MB at the 4K stills size), the cache's point is the
 * frames of one clip, and a graphic baked again after four others pays one
 * layer, not a blur per frame.
 */
const LAYER_MEMO = 4
const layers = new WeakMap<(width: number, height: number) => CanvasRenderingContext2D, Map<string, CanvasRenderingContext2D>>()

function dimKey(item: DimItem, width: number, height: number): string {
  const hole = item.hole
  const holeKey = hole ? `${hole.box.x},${hole.box.y},${hole.box.width},${hole.box.height},${hole.radius},${hole.feather}` : 'none'
  return `${width}x${height}|${item.color}|${item.alpha}|${holeKey}`
}

/** The renderer's default layer: a fresh canvas of the frame's size. Reached only when a dim is drawn with no `layer` given. */
function defaultLayer(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('paintDrawList2d: no 2D context for the dim layer')
  return ctx
}

/* ---------------------------------------------------------------- helpers */

/** 0 to 1, and 0 for what is not a number. */
function clamp01(value: number): number {
  return value > 0 ? (value < 1 ? value : 1) : 0
}

/**
 * A hex colour (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, the forms
 * `resolveGraphicStyle` admits) at an opacity, as `rgba()`, the colour's own
 * alpha multiplied in; any other string is returned as given, the opacity
 * then lost, since a canvas keeps its previous colour on one it cannot parse.
 */
function withAlpha(color: string, alpha: number): string {
  const hex = color.startsWith('#') ? color.slice(1) : ''
  const short = hex.length === 3 || hex.length === 4
  if (!(short || hex.length === 6 || hex.length === 8) || !/^[0-9a-f]+$/i.test(hex)) return color
  const channel = (i: number): number => (short ? parseInt(hex[i] + hex[i], 16) : parseInt(hex.slice(2 * i, 2 * i + 2), 16))
  const own = hex.length === 4 || hex.length === 8 ? channel(3) / 255 : 1
  return `rgba(${channel(0)},${channel(1)},${channel(2)},${clamp01(alpha) * own})`
}

/** Applies an item's transform about its origin, `ItemTransform`'s order (items.ts): what `itemBounds` maps the corners through. */
function applyTransform(ctx: CanvasRenderingContext2D, item: DrawItem, size: { width: number; height: number }): void {
  const t = item.transform
  if (!t) return
  const origin = itemOrigin(item, size)
  ctx.translate(origin.x + t.x, origin.y + t.y)
  ctx.rotate((t.rotate * Math.PI) / 180)
  ctx.scale(t.scale, t.scale)
  ctx.translate(-origin.x, -origin.y)
}

function polyline(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
}

function triangle(ctx: CanvasRenderingContext2D, head: HeadShape): void {
  const [p, a, b] = head.points
  ctx.beginPath()
  ctx.moveTo(p.x, p.y)
  ctx.lineTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.closePath()
  ctx.fill()
}

/* ------------------------------------------------------------------ kinds */

/**
 * A stroke: the visible span's polyline (stopped short of each head) stroked
 * at `strokeShape`'s width with the item's cap, join and dash, then each head
 * as a filled triangle whose point is the span's tip (`end`) or start
 * (`start`). The `marker` look is drawn clean until M10 passes (D7, §16.60).
 */
function paintStroke(ctx: CanvasRenderingContext2D, item: StrokeItem, size: { width: number; height: number }): void {
  const shape = strokeShape(pathOf(item.d), item, size)
  ctx.strokeStyle = item.color
  ctx.fillStyle = item.color
  ctx.lineWidth = shape.width
  ctx.lineCap = item.cap
  ctx.lineJoin = item.join
  ctx.miterLimit = MITER_LIMIT
  if (shape.line.length >= 2) {
    if (item.dash) {
      ctx.setLineDash(item.dash.pattern)
      ctx.lineDashOffset = item.dash.offset
    }
    polyline(ctx, shape.line)
    ctx.stroke()
  }
  if (shape.start) triangle(ctx, shape.start)
  if (shape.end) triangle(ctx, shape.end)
}

/**
 * A text item: the context translated to its box, then one `drawTextOnto`
 * call with the `TextSpec` `textSpecOf` makes of it, the box's size as the
 * canvas's. The text is drawn whole, in its look's face and its text style's
 * ink and weight (§6.3, "Text items and their units"); a lit word's accent
 * reaches the paint through the spec's `highlight`.
 */
function paintText(ctx: CanvasRenderingContext2D, item: TextItem): void {
  ctx.translate(item.box.x, item.box.y)
  drawTextOnto(ctx, textSpecOf(item.text, item.look, item.box), item.box.width, item.box.height)
}

/**
 * The shape's path: its geometry on the box's edge, a stroke centred on it
 * (`itemBounds` widens the box by half the stroke). False when there is
 * nothing to draw. Two guards are measured, not assumed (Chrome 152,
 * 2026-10-30): `roundRect` throws a RangeError on a negative radius, and
 * `ellipse` and `arc` throw an IndexSizeError on a negative radius, so a
 * circle or ring in a box of negative size draws nothing rather than failing
 * the whole frame's paint; `rect` and `roundRect` take a negative extent
 * (mirrored, no throw) and a radius of 0 is fine for all of them.
 */
function shapePath(ctx: CanvasRenderingContext2D, item: ShapeItem): boolean {
  const { x, y, width, height } = item.box
  ctx.beginPath()
  switch (item.shape) {
    case 'rect':
      ctx.rect(x, y, width, height)
      return true
    case 'rounded':
      ctx.roundRect(x, y, width, height, Math.max(0, item.radius ?? 0))
      return true
    case 'circle':
      if (!(width > 0) || !(height > 0)) return false
      ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, 2 * Math.PI)
      return true
    case 'ring': {
      // An arc of `sweep` turns from `start`, on the circle inscribed in the box; nothing at sweep 0.
      const sweep = clamp01(item.sweep ?? 1)
      if (!(sweep > 0) || !(width > 0) || !(height > 0)) return false
      const start = item.start ?? 0
      ctx.arc(x + width / 2, y + height / 2, Math.min(width, height) / 2, start, start + sweep * 2 * Math.PI)
      return true
    }
  }
}

/**
 * A shape: `rect`, `roundRect`, `ellipse`, or a ring as an arc; filled, then
 * stroked. The shadow rides the first pass drawn and is cleared before the
 * next: canvas applies a shadow to everything drawn while it is set, so a fill
 * and a stroke in one pass would double it round the edge (textPaint.ts's
 * reason). A ring has no interior, so its `fill` is not read.
 */
function paintShape(ctx: CanvasRenderingContext2D, item: ShapeItem): void {
  if (!shapePath(ctx, item)) return
  const shadow = item.shadow && item.shadow.opacity > 0 && item.shadow.blur >= 0 ? item.shadow : null
  let shadowed = false
  const setShadow = (): void => {
    if (!shadow || shadowed) return
    ctx.shadowColor = withAlpha(shadow.color, shadow.opacity)
    ctx.shadowBlur = shadow.blur
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = shadow.dy
    shadowed = true
  }
  const clearShadow = (): void => {
    if (!shadowed) return
    ctx.shadowColor = 'rgba(0,0,0,0)'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
  }
  if (item.fill !== undefined && item.shape !== 'ring') {
    setShadow()
    ctx.fillStyle = item.fill
    ctx.fill()
    clearShadow()
  }
  if (item.stroke && item.stroke.width > 0) {
    setShadow()
    ctx.strokeStyle = item.stroke.color
    ctx.lineWidth = item.stroke.width
    // Round join: a miter on a rect's corner would ink √2 × half the width past the box, beyond the half-width `itemBounds` widens it by.
    ctx.lineCap = 'butt'
    ctx.lineJoin = 'round'
    ctx.stroke()
    clearShadow()
  }
}

/**
 * An image: `drawImage` of the bitmap `options.images` holds for its `src`,
 * fitted to its box, `contain` letterboxed inside it and `cover` cropped from
 * the bitmap's middle; skipped when the bitmap is missing or has no size.
 */
function paintImage(ctx: CanvasRenderingContext2D, item: ImageItem, images: ReadonlyMap<string, ImageBitmap> | undefined): void {
  const bitmap = images?.get(item.src)
  if (!bitmap || !(bitmap.width > 0) || !(bitmap.height > 0)) return
  const { x, y, width, height } = item.box
  if (!(width > 0) || !(height > 0)) return
  const scale = item.fit === 'cover' ? Math.max(width / bitmap.width, height / bitmap.height) : Math.min(width / bitmap.width, height / bitmap.height)
  if (item.fit === 'cover') {
    const sw = width / scale
    const sh = height / scale
    ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, x, y, width, height)
  } else {
    const dw = bitmap.width * scale
    const dh = bitmap.height * scale
    ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, x + (width - dw) / 2, y + (height - dh) / 2, dw, dh)
  }
}

/**
 * The dim's layer: the frame filled with `color` at `alpha`, the hole cut
 * with `destination-out` (a hard edge at `feather` 0, softened with a blur
 * filter of `feather` px otherwise). Made once per hole, size and colour
 * through `layer` and kept (§6.3, "The dim"); the opacity is applied where
 * it is composited, so animating it costs no blur.
 */
function dimLayer(item: DimItem, size: { width: number; height: number }, layer: (width: number, height: number) => CanvasRenderingContext2D): CanvasRenderingContext2D {
  const key = dimKey(item, size.width, size.height)
  let own = layers.get(layer)
  if (!own) {
    own = new Map()
    layers.set(layer, own)
  }
  const hit = own.get(key)
  if (hit) return hit
  const ctx = layer(size.width, size.height)
  for (const held of own.values()) {
    if (held.canvas === ctx.canvas) throw new Error('paintDrawList2d: `layer` must make a new canvas on each call; the painter keeps up to four and composites them on later frames')
  }
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = clamp01(item.alpha)
  ctx.fillStyle = item.color
  ctx.fillRect(0, 0, size.width, size.height)
  if (item.hole) {
    const { box, radius, feather } = item.hole
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'destination-out'
    ctx.filter = feather > 0 ? `blur(${feather}px)` : 'none'
    ctx.fillStyle = '#000000'
    ctx.beginPath()
    ctx.roundRect(box.x, box.y, box.width, box.height, Math.max(0, radius))
    ctx.fill()
    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'source-over'
  }
  ctx.restore()
  if (own.size >= LAYER_MEMO) own.delete(own.keys().next().value as string)
  own.set(key, ctx)
  return ctx
}

/**
 * A dim: its layer composited over the frame at the item's opacity (already
 * in `globalAlpha`). A list without a size inks nothing: `drawImage` of a
 * canvas with a 0 side throws an InvalidStateError (measured, Chrome 152).
 */
function paintDim(ctx: CanvasRenderingContext2D, item: DimItem, size: { width: number; height: number }, layer: (width: number, height: number) => CanvasRenderingContext2D): void {
  if (!(size.width > 0) || !(size.height > 0)) return
  ctx.drawImage(dimLayer(item, size, layer).canvas, 0, 0)
}

/* ---------------------------------------------------------------- the list */

function paintItem(ctx: CanvasRenderingContext2D, item: DrawItem, list: DrawList, options: PaintOptions): void {
  const alpha = ctx.globalAlpha * clamp01(item.opacity)
  // Nothing of it shows: no ink, so no work; its children neither.
  if (!(alpha > 0)) return
  ctx.save()
  // The restore is owed whatever a kind throws (a template bug `flattenPath`
  // refuses, say): the caller's context is left as it was, not translated and
  // alpha'd by the saves of the item that failed. The error still propagates.
  try {
    ctx.globalAlpha = alpha
    applyTransform(ctx, item, list)
    switch (item.kind) {
      case 'stroke':
        paintStroke(ctx, item, list)
        break
      case 'text':
        paintText(ctx, item)
        break
      case 'shape':
        paintShape(ctx, item)
        break
      case 'image':
        paintImage(ctx, item, options.images)
        break
      case 'dim':
        paintDim(ctx, item, list, options.layer ?? defaultLayer)
        break
      case 'group':
        for (const child of item.children) paintItem(ctx, child, list, options)
        break
    }
  } finally {
    ctx.restore()
  }
}

/**
 * Paints a draw list onto a 2D context (§6.3, "Painter A"): the items in list
 * order, each under `save`/`restore` with its opacity multiplied into
 * `globalAlpha` (so a group's children inherit it), its transform about
 * `itemOrigin`, and its kind drawn as the kinds table says; the whole list
 * translated by `options.offset`. Draws into whatever the context already
 * holds: the caller clears. `list.camera`, `list.glow` and any item's `z`
 * are painter B's and are not read.
 */
export function paintDrawList2d(ctx: CanvasRenderingContext2D, list: DrawList, options: PaintOptions = {}): void {
  ctx.save()
  try {
    if (options.offset) ctx.translate(options.offset.x, options.offset.y)
    for (const item of list.items) paintItem(ctx, item, list, options)
  } finally {
    ctx.restore()
  }
}
