/**
 * The draw list's items (docs/CLIPS.md §6.3, "The draw list" and "Text items
 * and their units"): what a template's drawer emits and what the two
 * painters draw. One engine from the first commit (§16.54, D1): a pure
 * function returns a list of these, and painter A (canvas 2D, `paint.ts`) or
 * painter B (three.js, §6.16) draws it.
 *
 * Here: the item kinds and their fields, as §6.3's kinds table lists them;
 * `Drawer` and `DrawOut`, a template's draw function and what it returns
 * (§6.2); `DrawList`, the list `drawListAt` hands a painter; `GraphicTargets`,
 * what a drawer may see of the footage (resolved by the caller, so the drawing
 * stays pure; `targets.ts` fills it); `unitFor` and `CLUSTER_SCRIPTS`, the
 * unit a text field is cut into; `textItems`, a field laid out into one item
 * per line, word or cluster; `textSpecOf`, the `TextSpec` a text item draws
 * as; `itemOrigin`, the point an item's transform turns about; and
 * `itemBounds`, the frame rectangle an item can ink.
 *
 * The templates import this file, never `drawList.ts`, so no import cycle
 * runs through `templates/index.ts`. `Point` and `Arrowhead` are
 * `stroke.ts`'s, taken from there and declared nowhere else.
 *
 * Every rectangle and point is in output-frame pixels, of the size the list
 * was made at (never preview pixels; `UnitRect`, `reframe/types.ts`, is the
 * 0..1 kind). Pure: no clock, no random, no DOM, no `node:path`.
 */

import { STROKE_TOLERANCE, flattenPath, strokeWidth, type Arrowhead, type Point } from './stroke'
import type { GraphicSpec } from './template'
import type { GraphicStyle } from './style'
import type { TextSpec } from '../timeline'
import { shapedScript } from '../render/textAnimation'
import { indicFontsFor } from '../render/textPaint'
import { ASCENT, LINE_HEIGHT } from '../render/textLayout'
import { textInkReach, type InkReach } from '../render/textStyle'

export type { Arrowhead, Point } from './stroke'

/* ------------------------------------------------------------------- types */

/** A rectangle in frame pixels. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * An item's placement: a translation in frame pixels, a scale and a rotation
 * in degrees, both about the item's own centre, `itemOrigin`: the centre of
 * its own geometry (a text, shape or image's `box`; a stroke's flattened
 * points; the frame for a dim; a group's children under theirs), read from
 * the item alone, with no measure and no style, so painter A and `itemBounds`
 * turn about the identical point. The painter applies it as
 * `translate(origin.x + x, origin.y + y)`, `rotate(rotate)`, `scale(scale,
 * scale)`, `translate(-origin.x, -origin.y)`, which is what `itemBounds`
 * maps the corners through.
 * Named so, not `Transform`, because `timeline.ts` already exports a
 * `Transform` (the clip's, in fractions of the half canvas) and two exported
 * types of one name are an anchor trap (§6.5's `MotionEase`). `Rect` keeps
 * §6.3's name; the harness's `graphicMeasure.ts` exports one of the same
 * shape for its own measuring, which lane D may replace with this one.
 */
export interface ItemTransform {
  x: number
  y: number
  scale: number
  rotate: number
}

/** What every item carries: an id stable per element across frames, its opacity, an optional transform, and phase 3's plane. */
interface ItemBase {
  id: string
  opacity: number
  transform?: ItemTransform
  /** Phase 3's planes (§6.16); typed here, given meaning there. `needsCompositor` reads it. */
  z?: number
}

/**
 * How a text item is drawn: its text style (one of `GRAPHIC_TEXT_STYLES`,
 * §6.5), its face (the style's for Latin; `INDIC_FONTS`' face for a shaped
 * item, which `textItems` sets), its size in frame pixels, its alignment and,
 * for a lit word alone, the accent colour its `highlight` carries. No colour
 * or weight: a graphic's ink and weight are its text style's (§6.3).
 */
export interface TextLook {
  textStyleId: string
  font: string
  px: number
  align: 'left' | 'center' | 'right'
  accent?: string
}

/** A draw-on along SVG path data (frame px), the visible span `from`..`to` as fractions of its length (§6.3's stroke primitive). */
export interface StrokeItem extends ItemBase {
  kind: 'stroke'
  d: string
  from: number
  to: number
  width: number
  color: string
  cap: 'round' | 'butt' | 'square'
  join: 'round' | 'miter' | 'bevel'
  dash?: { pattern: number[]; offset: number }
  heads?: { start?: Arrowhead; end?: Arrowhead }
  /** `marker` is drawn clean until M10 passes (D7, §16.60). */
  look?: 'clean' | 'marker'
}

/** One string, drawn whole by one `drawTextOnto` call, never split by the painter. */
export interface TextItem extends ItemBase {
  kind: 'text'
  text: string
  look: TextLook
  box: Rect
  /** The `GraphicData` field it came from and its index among that field's pieces, in reading order; absent for a template's listed fixed glyph (§6.2). */
  source?: { path: string; piece: number }
}

export interface ShapeItem extends ItemBase {
  kind: 'shape'
  shape: 'rect' | 'rounded' | 'circle' | 'ring'
  box: Rect
  radius?: number
  /** A ring's arc, 0..1 of the turn. */
  sweep?: number
  /** A ring's start, radians. */
  start?: number
  fill?: string
  stroke?: { color: string; width: number }
  shadow?: { blur: number; dy: number; color: string; opacity: number }
}

/** A bitmap the caller decoded first and hands painter A in `options.images`, by `src` (an asset path joined by `assetPath.ts`). */
export interface ImageItem extends ItemBase {
  kind: 'image'
  src: string
  box: Rect
  fit: 'contain' | 'cover'
}

/** A full-frame darkening with an optional rounded hole, fixed at onset (§6.3, "The dim"). */
export interface DimItem extends ItemBase {
  kind: 'dim'
  color: string
  alpha: number
  hole?: { box: Rect; radius: number; feather: number }
}

/** Its children, drawn with its opacity and transform applied to them. */
export interface GroupItem extends ItemBase {
  kind: 'group'
  children: DrawItem[]
}

export type DrawItem = StrokeItem | TextItem | ShapeItem | ImageItem | DimItem | GroupItem

/** Phase 3's camera (§6.16): degrees; `dolly` 0 is flat; `focus` the depth in focus and the blur per frame height of distance from it. */
export interface Camera {
  tilt: number
  yaw: number
  dolly: number
  fov: number
  focus?: { z: number; px: number }
}

/** Phase 3's glow on one item, by id (§6.16). */
export interface GlowRequest {
  item: string
  radius: number
  strength: number
  color?: string
}

/** Measures a string as the painter will draw it, injected: node's tests pass a fake, the renderer `measureText` on a scratch context (§6.3, "The measure"). */
export type TextMeasure = (text: string, look: TextLook) => { width: number; ascent: number; descent: number }

/**
 * What a drawer may see of the footage, in frame pixels, resolved by the
 * caller (§6.3, "Targets"): `subject`, the box a callout points at and a dim
 * cuts its hole round, taken once at onset (§6.9); `tip`, phase 4's
 * fingertip; `screen`, phase 3's screen card. Null is an ordinary answer (off
 * screen, no track), not an error. `targets.ts`' `graphicTargetsAt` fills it
 * (lane B's third piece); the type lives here because `Drawer` names it.
 */
export interface GraphicTargets {
  subject?: Rect | null
  tip?: Point | null
  screen?: { box: Rect; file: string | null } | null
}

/** What a template's draw function returns (§6.2): its items, and from phase 3 its camera and glow (§6.16). In phases 1 and 2, `items` alone. */
export interface DrawOut {
  items: DrawItem[]
  camera?: Camera
  glow?: GlowRequest[]
}

/** What `drawListAt` hands a painter: a `DrawOut` with the frame size it was made at. */
export interface DrawList extends DrawOut {
  width: number
  height: number
}

/**
 * A template's draw function, §6.2's `draw<Id>`: `t` in seconds from the
 * graphic clip's start. It never paints, measures text only through
 * `measure`, reads the project only through `targets`, and draws its random
 * through `seeded(spec.seed)` (render/moment.ts) in a fixed order, so the same
 * arguments give a deep-equal `DrawOut`.
 */
export type Drawer = (
  spec: GraphicSpec,
  style: GraphicStyle,
  clock: { t: number; fps: number },
  size: { width: number; height: number },
  measure: TextMeasure,
  targets: GraphicTargets
) => DrawOut

/** The piece a text field is cut into (§6.3, "The unit"). */
export type TextUnit = 'line' | 'word' | 'cluster'

/* ------------------------------------------------------------------- units */

/**
 * The shaped scripts a text may be cut below a word, into grapheme clusters:
 * Unicode script names, as `\p{Script=…}` reads them. Empty until M3 cleared
 * one; set 2026-10-27 to Devanagari and Telugu, both cleared on both machines
 * (§6.15: the cumulative per-cluster paint's last frame equals the word drawn
 * whole, mean 0 over every word listed, and the counts show the current rule,
 * स्कूल two clusters). A script enters only once M3 measures it; any other
 * shaped script asked for clusters animates per word (§16.61).
 */
export const CLUSTER_SCRIPTS: readonly string[] = Object.freeze(['Devanagari', 'Telugu'])

/** Every code point of a `CLUSTER_SCRIPTS` script, to strike from a text before asking whether anything shaped is left. */
const CLUSTER_RE: RegExp | null =
  CLUSTER_SCRIPTS.length > 0
    ? new RegExp(CLUSTER_SCRIPTS.map((script) => `\\p{Script=${script}}`).join('|'), 'gu')
    : null

/**
 * The unit a text is actually cut into when `wanted` is asked for (§6.3):
 * `'line'` and `'word'` as asked; `'cluster'` only when the text holds no
 * shaped script (`shapedScript`, §6.20) or every shaped script in it is in
 * `CLUSTER_SCRIPTS`, otherwise `'word'`. Read by striking the cleared
 * scripts' code points from the text and asking `shapedScript` of what is
 * left, so the two read the same property. Never a code point, the defect D8
 * fixed in the captions (§16.61).
 */
export function unitFor(text: string, wanted: TextUnit): TextUnit {
  if (wanted !== 'cluster') return wanted
  if (!shapedScript(text)) return 'cluster'
  const rest = CLUSTER_RE ? text.replace(CLUSTER_RE, '') : text
  return shapedScript(rest) ? 'word' : 'cluster'
}

type GraphemeSegmenter = { segment: (text: string) => Iterable<{ segment: string }> }
let segmenter: GraphemeSegmenter | null | undefined

/**
 * A text's grapheme clusters through `Intl.Segmenter` at `granularity:
 * 'grapheme'`, as `ingest/captions.ts` counts them; null where the runtime
 * has no segmenter, and the caller then cuts by word. Never `Array.from`: a
 * conjunct's virama or a vowel sign is a code point of its own and would be
 * drawn as a piece (D8).
 */
export function graphemesOf(text: string): string[] | null {
  if (segmenter === undefined) {
    const Segmenter = (Intl as { Segmenter?: new (locale?: string, options?: { granularity: string }) => GraphemeSegmenter })
      .Segmenter
    segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null
  }
  if (!segmenter) return null
  const out: string[] = []
  for (const part of segmenter.segment(text)) out.push(part.segment)
  return out
}

/* -------------------------------------------------------------- text items */

/** A text field for `textItems`: where its lines run (`at`: the first line's top-left and the wrap width) and what it is cut into. */
export interface TextField {
  /** The items' id stem; each piece is `<id>-<piece>`. */
  id: string
  text: string
  look: TextLook
  at: { x: number; y: number; width: number }
  /** The unit asked for; `unitFor` decides the one used. */
  unit: TextUnit
  /** The `GraphicData` field path (`items.2.label`); absent for a fixed glyph, whose items then carry no `source`. */
  source?: string
}

/** The look a piece draws in: `INDIC_FONTS`' face for a shaped piece (the first its text holds), the given look otherwise (§6.3, "Shaped-script items take their script's face"). */
function lookFor(look: TextLook, text: string): TextLook {
  const indic = indicFontsFor(text)
  return indic.length > 0 && indic[0] !== look.font ? { ...look, font: indic[0] } : look
}

/**
 * A line's words with the look each draws in, and whether the line is of one
 * face (`mixed` false: every word's look is the line's) or holds pieces of
 * more than one (Latin beside Hindi, say, whose pieces draw in different
 * faces whose advances differ).
 */
interface LineLooks {
  text: string
  look: TextLook
  words: readonly { text: string; look: TextLook }[]
  mixed: boolean
}

function lineLooksOf(look: TextLook, lineWords: readonly string[]): LineLooks {
  const text = lineWords.join(' ')
  const lineLook = lookFor(look, text)
  const words = lineWords.map((w) => ({ text: w, look: lookFor(look, w) }))
  return { text, look: lineLook, words, mixed: words.some((w) => w.look.font !== lineLook.font) }
}

/**
 * A line's width: measured whole in its look when it is of one face; when
 * mixed, the sum of each word in its own look plus the spaces in the line's,
 * which is where `textItems` puts the pieces.
 */
function lineWidthOf(line: LineLooks, measure: TextMeasure): number {
  if (!line.mixed) return measure(line.text, line.look).width
  const space = measure(' ', line.look).width
  return line.words.reduce((sum, word, i) => sum + measure(word.text, word.look).width + (i > 0 ? space : 0), 0)
}

/**
 * A field laid out into text items, one per line, word or cluster (§6.3,
 * "One line per item, drawn whole"), using `measure` and never the painter,
 * which splits, joins and re-cases nothing. Words are runs between
 * whitespace; lines wrap greedily at `at.width` (a word wider than it stands
 * alone on its line). A line of one face has its pieces where the line,
 * measured whole in that look, puts them (each piece's x is the width of the
 * line's text before it, so kerning is kept and the pieces land where the
 * line drawn whole would). A line of mixed faces, Latin beside Hindi, has
 * each word placed by the running sum of the words before it, each measured
 * in its own look, plus the spaces in the line's, since a Latin piece draws
 * in the style's face and a shaped one in `INDIC_FONTS`' and the two faces'
 * advances differ; within a word, a cluster still sits at the width of the
 * word's text before it in the word's look. Lines are `round(px ×
 * LINE_HEIGHT)` tall, `px` rounded to whole pixels first, so `layoutText` on
 * `textSpecOf`'s spec puts the baseline where this measured it. A shaped
 * piece takes its script's face. Pieces are numbered in reading order across
 * the field; `source.piece` is that number when `source` is set. Every item's
 * opacity is 1 and it carries no transform: the template moves them.
 */
export function textItems(field: TextField, measure: TextMeasure): TextItem[] {
  const px = Math.round(field.look.px)
  const look: TextLook = { ...field.look, px }
  const lineHeight = Math.round(px * LINE_HEIGHT)
  const unit = unitFor(field.text, field.unit)
  const words = field.text.split(/\s+/).filter((w) => w.length > 0)
  if (words.length === 0) return []

  // Greedy wrapping, the rule a browser and libass both use (textPaint.ts).
  const lines: string[][] = []
  let current: string[] = []
  for (const word of words) {
    const candidate = [...current, word]
    if (current.length > 0 && lineWidthOf(lineLooksOf(look, candidate), measure) > field.at.width) {
      lines.push(current)
      current = [word]
    } else {
      current = candidate
    }
  }
  lines.push(current)

  const items: TextItem[] = []
  let piece = 0
  const push = (text: string, x: number, y: number, pieceLook: TextLook): number => {
    const width = measure(text, pieceLook).width
    const box: Rect = { x, y, width, height: lineHeight }
    const item: TextItem = { kind: 'text', id: `${field.id}-${piece}`, opacity: 1, text, look: pieceLook, box }
    if (field.source !== undefined) item.source = { path: field.source, piece }
    items.push(item)
    piece += 1
    return width
  }

  lines.forEach((lineWords, row) => {
    const line = lineLooksOf(look, lineWords)
    const lineWidth = lineWidthOf(line, measure)
    const left =
      look.align === 'left'
        ? field.at.x
        : look.align === 'right'
          ? field.at.x + field.at.width - lineWidth
          : field.at.x + (field.at.width - lineWidth) / 2
    const y = field.at.y + row * lineHeight
    if (unit === 'line') {
      push(line.text, left, y, line.look)
      return
    }
    // One face: the x of a piece is where the line's text before it ends, in the line's look.
    const before = (prefix: string, inLook: TextLook): number => (prefix.length === 0 ? 0 : measure(prefix, inLook).width)
    const space = line.mixed ? measure(' ', line.look).width : 0
    let prefix = ''
    let x = left
    for (const word of line.words) {
      // The line's text before this word, its space included.
      let wordPrefix = prefix.length === 0 ? '' : `${prefix} `
      const wordX = line.mixed ? x : left + before(wordPrefix, line.look)
      const clusters = unit === 'cluster' ? graphemesOf(word.text) : null
      if (clusters === null) {
        const width = push(word.text, wordX, y, word.look)
        x = wordX + width + space
        prefix = wordPrefix + word.text
        continue
      }
      // Mixed: a cluster sits at the width of the word's text before it, in the word's look.
      let inWord = ''
      for (const cluster of clusters) {
        if (cluster.trim().length === 0) continue
        const clusterX = line.mixed ? wordX + before(inWord, word.look) : left + before(wordPrefix, line.look)
        push(cluster, clusterX, y, lookFor(look, cluster))
        wordPrefix += cluster
        inWord += cluster
      }
      x = wordX + measure(word.text, word.look).width + space
      prefix = wordPrefix
    }
  })
  return items
}

/**
 * The `TextSpec` a text item draws as (§6.3, "A text item becomes a
 * TextSpec"), every required field set: the text whole; `size` so that
 * `layoutText` reads `look.px` back from the box's height; `margin` 0 and
 * `position` `'center'`, so the one line sits where `textItems` measured it;
 * no outline or shadow of the spec's own (a panel's shadow is the style's, a
 * text's the text style's); `color` and `weight` read only on the styleless
 * route, which a graphic never takes; and `highlight` on word 0 in
 * `look.accent` when that is set, the captions' own per-word override, which
 * lights a one-word item. Pure and shared, so the renderer's measure measures
 * the very spec the painter draws.
 */
export function textSpecOf(text: string, look: TextLook, box: Rect): TextSpec {
  const spec: TextSpec = {
    version: 0,
    content: text,
    font: look.font,
    size: box.height > 0 ? look.px / box.height : 0,
    color: '#FFFFFF',
    align: look.align,
    position: 'center',
    weight: 700,
    tracking: 0,
    uppercase: false,
    shadow: 0,
    stroke: 0,
    strokeColor: '#000000',
    styleId: look.textStyleId,
    margin: 0,
    offsetX: 0,
    offsetY: 0
  }
  if (look.accent !== undefined) spec.highlight = { word: 0, color: look.accent }
  return spec
}

/* ------------------------------------------------------------------ bounds */

/**
 * How far a riding head can reach from its point, as a multiple of its size:
 * the base's corners lie √(1 + 0.45²) ≈ 1.097 of the size from the point
 * (`headShape`, stroke.ts); 1.1 covers them.
 */
const HEAD_REACH = 1.1
/**
 * Canvas's default `miterLimit`: a miter join may spike this many half-widths
 * from the corner. The bound assumes it, so painter A (`paint.ts`) may set a
 * smaller limit on a stroke item and must never set a larger one.
 */
const MITER_LIMIT = 10

const NO_REACH = (): InkReach => ({ left: 0, right: 0, top: 0, bottom: 0 })

function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

function widen(r: Rect, by: InkReach): Rect {
  return { x: r.x - by.left, y: r.y - by.top, width: r.width + by.left + by.right, height: r.height + by.top + by.bottom }
}

function maxReach(a: InkReach, b: InkReach): InkReach {
  return { left: Math.max(a.left, b.left), right: Math.max(a.right, b.right), top: Math.max(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) }
}

const centreOf = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })

/** The bounds of a rectangle's four corners after `t` about `origin` (`ItemTransform`'s order). */
function transformed(r: Rect, t: ItemTransform, origin: Point): Rect {
  const radians = (t.rotate * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [cx, cy] of [
    [r.x, r.y],
    [r.x + r.width, r.y],
    [r.x, r.y + r.height],
    [r.x + r.width, r.y + r.height]
  ]) {
    const dx = (cx - origin.x) * t.scale
    const dy = (cy - origin.y) * t.scale
    const x = origin.x + dx * cos - dy * sin + t.x
    const y = origin.y + dx * sin + dy * cos + t.y
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** A stroke's flattened points' bounding box, null with no points; path data `flattenPath` refuses throws, as a template bug should. */
function strokePoints(item: StrokeItem): Rect | null {
  const path = flattenPath(item.d, STROKE_TOLERANCE)
  let r: Rect | null = null
  for (const p of path.points) r = union(r, { x: p.x, y: p.y, width: 0, height: 0 })
  return r
}

/**
 * An item's own geometry before its transform, unwidened by any reach and
 * read without a measure: a text, shape or image's box; a stroke's flattened
 * points (null with none); the frame for a dim; a group's children each
 * under its own transform (`itemGeometry`), null for an empty group.
 */
function localGeometry(item: DrawItem, size: { width: number; height: number }): Rect | null {
  switch (item.kind) {
    case 'text':
    case 'shape':
    case 'image':
      return { ...item.box }
    case 'stroke':
      return strokePoints(item)
    case 'dim':
      return { x: 0, y: 0, width: size.width, height: size.height }
    case 'group': {
      let r: Rect | null = null
      for (const child of item.children) r = union(r, itemGeometry(child, size))
      return r
    }
  }
}

/** `localGeometry` under the item's own transform, about `itemOrigin`. */
function itemGeometry(item: DrawItem, size: { width: number; height: number }): Rect | null {
  const local = localGeometry(item, size)
  if (!local || !item.transform) return local
  return transformed(local, item.transform, itemOrigin(item, size))
}

/**
 * The point an item's `transform` turns and scales about (`ItemTransform`):
 * the centre of its own geometry, read from the item alone, so painter A finds
 * the same point with no measure and no style. A stroke with no points, or an
 * empty group, has no geometry and turns about the frame's origin, which
 * nothing it draws can tell.
 */
export function itemOrigin(item: DrawItem, size: { width: number; height: number }): Point {
  const local = localGeometry(item, size)
  return local ? centreOf(local) : { x: 0, y: 0 }
}

/** What an item can ink before its own transform: `rect` in the item's own space, and the `device` reach to add after any transform. */
interface LocalBounds {
  rect: Rect
  device: InkReach
}

/**
 * The rectangle an item can ink in its own space, before its transform, and
 * the reach it adds in the frame's (§6.3, "The box"): a text item's box
 * widened by its style's user-space reach (`textInkReach`'s `user`: outline,
 * extrusion, split, bar, rule) and, with `measure`, by what its glyphs rise
 * above `ASCENT` or fall below the line's descent, its shadow and glow the
 * device part; a shape's box widened by half its stroke, its shadow (3σ of
 * the blur, and its `dy`) the device part; a stroke's full path, whatever
 * `from` and `to` show on this frame, widened by half its drawn width
 * (`strokeWidth`, ten half-widths on a miter join, canvas's default limit)
 * and by its heads; an image's box; the whole frame for a dim; a group's
 * children under their own transforms, each widened by its own user reach,
 * their device reaches' largest per side carried up, since a group's
 * transform does not scale or turn a child's shadow either. Null for an
 * empty group or a stroke with no points. Opacity is not read: an item at
 * opacity 0 still claims its place, so the box covers it on the frame it
 * appears.
 */
function userBounds(item: DrawItem, size: { width: number; height: number }, measure?: TextMeasure): LocalBounds | null {
  switch (item.kind) {
    case 'text': {
      const reach = textInkReach(item.look.textStyleId, item.look.px)
      const user = { ...reach.user }
      if (measure) {
        const ink = measure(item.text, item.look)
        user.top += Math.max(0, ink.ascent - ASCENT * item.look.px)
        user.bottom += Math.max(0, ink.descent - (LINE_HEIGHT - ASCENT) * item.look.px)
      }
      return { rect: widen(item.box, user), device: { ...reach.device } }
    }
    case 'shape': {
      const half = item.stroke ? item.stroke.width / 2 : 0
      const blur = item.shadow && item.shadow.opacity > 0 ? 1.5 * item.shadow.blur : 0
      const dy = item.shadow && item.shadow.opacity > 0 ? item.shadow.dy : 0
      return {
        rect: widen(item.box, { left: half, right: half, top: half, bottom: half }),
        device: { left: blur, right: blur, top: blur + Math.max(0, -dy), bottom: blur + Math.max(0, dy) }
      }
    }
    case 'stroke': {
      const points = strokePoints(item)
      if (!points) return null
      const half = strokeWidth(item.width, size) / 2
      const head = Math.max(item.heads?.start?.size ?? 0, item.heads?.end?.size ?? 0) * HEAD_REACH
      const by = Math.max(item.join === 'miter' ? half * MITER_LIMIT : half, head)
      return { rect: widen(points, { left: by, right: by, top: by, bottom: by }), device: NO_REACH() }
    }
    case 'image':
      return { rect: { ...item.box }, device: NO_REACH() }
    case 'dim':
      return { rect: { x: 0, y: 0, width: size.width, height: size.height }, device: NO_REACH() }
    case 'group': {
      let rect: Rect | null = null
      let device = NO_REACH()
      for (const child of item.children) {
        const placed = placedBounds(child, size, measure)
        if (!placed) continue
        rect = union(rect, placed.rect)
        device = maxReach(device, placed.device)
      }
      return rect ? { rect, device } : null
    }
  }
}

/** `userBounds` under the item's own transform about `itemOrigin`, its device reach carried through untouched. */
function placedBounds(item: DrawItem, size: { width: number; height: number }, measure?: TextMeasure): LocalBounds | null {
  const local = userBounds(item, size, measure)
  if (!local || !item.transform) return local
  return { rect: transformed(local.rect, item.transform, itemOrigin(item, size)), device: local.device }
}

/**
 * The frame rectangle an item can ink with its own `transform` left aside
 * (`userBounds` widened by its device reach): what `itemBounds` is for an
 * item without one.
 */
export function localBounds(item: DrawItem, size: { width: number; height: number }, measure?: TextMeasure): Rect | null {
  const local = userBounds(item, size, measure)
  return local ? widen(local.rect, local.device) : null
}

/**
 * The frame rectangle an item can ink on this frame: its user-space bounds
 * under its own `transform` about `itemOrigin`, then widened by its device
 * reach, which a transform neither scales nor turns. `graphicBox` unions
 * these over every frame.
 */
export function itemBounds(item: DrawItem, size: { width: number; height: number }, measure?: TextMeasure): Rect | null {
  const placed = placedBounds(item, size, measure)
  return placed ? widen(placed.rect, placed.device) : null
}

/** The union of two rectangles, or the one that is not null. Exported for `graphicBox`. */
export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  return union(a, b)
}
