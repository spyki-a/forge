/**
 * The layout every drawer is built to (docs/CLIPS.md §6.2, "The layout"):
 * the content rect, the wrapping rule, the too-big rule and the per-template
 * sizes, as fractions of the output frame's short side `s`. Every figure is
 * §6.2's proposal, set against the sample tiles in phase 2 and revised with
 * the look rating (§6.10).
 *
 * The plan names no file for the layout; it lives here, beside the drawers
 * that read it. Also here, the few helpers every drawer shares: the dim that
 * opens a list when the style dims, a text field laid out into line items
 * with §6.2's item ids, an entrance applied to an item about a block's
 * centre, and the ease of a draw-on.
 *
 * Pure: no clock, no random, no DOM, no `node:path`. Measures only through
 * the injected `measure`.
 */

import { TITLE_SAFE } from '../../timeline'
import { textItems, itemOrigin, type DimItem, type DrawItem, type GraphicTargets, type Point, type Rect, type ShapeItem, type TextItem, type TextLook, type TextMeasure } from '../items'
import { DURATIONS, entrance, progress, type MotionEase } from '../motion'
import type { GraphicStyle } from '../style'
import type { GraphicSpec } from '../template'
import { LINE_HEIGHT } from '../../render/textLayout'

/* --------------------------------------------------------------- constants */

/** A field never wraps wider than this share of the frame's width (§6.2, "Wrapping"). */
export const WRAP_MAX = 0.8

/** The too-big rule's floor: every size scales down together, never below this share of the table (§6.2). */
export const FIT_MIN = 0.6

/**
 * The step the too-big rule scales down by, from 1 to `FIT_MIN`: 1, 0.95 …
 * 0.6, the first that fits. Beyond §6.2's words, which say "scales down
 * together to fit" and no step.
 */
export const FIT_STEP = 0.05

/** The note a graphic that does not fit at `FIT_MIN` is dropped with (§6.2, "Too big"). */
export const TOO_LONG_NOTE = 'too long to fit its place'

/**
 * §6.2's per-template sizes, of the short side `s` for the text sizes and the
 * geometry the table gives in `s`; the multipliers of a text's own px (a gap,
 * a padding) and the shares of the content width as the table words them.
 * Frozen. The eight templates drawn in phase 2 have their row.
 */
export const LAYOUT_SIZES = Object.freeze({
  /** value 0.11, label 0.045; value above label, 0.25 × the label's px apart; the panel padded 0.6 × the label's px. */
  counter: Object.freeze({ value: 0.11, label: 0.045, gap: 0.25, pad: 0.6 }),
  /** value 0.07, label 0.045; the ring 0.28 across, track and arc 0.025 thick; the label 0.3 × its px below the ring. */
  ring: Object.freeze({ value: 0.07, label: 0.045, across: 0.28, thick: 0.025, gap: 0.3 }),
  /** title 0.05, labels and values 0.04; a label column of 0.3 of the content width, tracks over the next 0.55, each 0.6 × the label's px tall; rows 0.5 × the label's px apart. */
  bars: Object.freeze({ title: 0.05, label: 0.04, labelColumn: 0.3, track: 0.55, trackHeight: 0.6, rowGap: 0.5 }),
  /** words 0.08; the panel padded 0.5 × the words' px. */
  keyword: Object.freeze({ words: 0.08, pad: 0.5 }),
  /** name 0.05, role 0.035; the bar 0.008 tall, under the name, as wide as the name plus 0.04. */
  'lower-third': Object.freeze({ name: 0.05, role: 0.035, barHeight: 0.008, barExtra: 0.04 }),
  /** title 0.05, numerals and labels 0.045; a numeral column 0.07 wide; rows 0.6 × the label's px apart; a tree indents a child 0.06. */
  steps: Object.freeze({ title: 0.05, num: 0.045, label: 0.045, numColumn: 0.07, rowGap: 0.6, indent: 0.06 }),
  /** words 0.055, marks 0.09, speaker 0.035; the speaker right-aligned beneath, 0.5 × its px below. */
  quote: Object.freeze({ words: 0.055, marks: 0.09, speaker: 0.035, speakerGap: 0.5 }),
  /** label 0.045, with a panel as the counter's (padded 0.6 × the label's px). */
  callout: Object.freeze({ label: 0.045, pad: 0.6 })
})

/**
 * A riding arrowhead's full length, of `s` (the tree's edges, the callout's
 * arrow). Beyond §6.2's words, which name `heads.end` and no size; the
 * phase-1 harness drew 44 px at 1080 (0.041), this is a little smaller so a
 * tree's 0.06 indent still shows a line before the head.
 */
export const HEAD_SIZE = 0.025

/** A stroke's width in frame pixels: the style's `stroke`, a fraction of `s` (§6.5). */
export function strokePx(style: GraphicStyle, size: { width: number; height: number }): number {
  return style.stroke * shortSide(size)
}

/* --------------------------------------------------------------- the rects */

/** The frame's short side, `s`. */
export function shortSide(size: { width: number; height: number }): number {
  return Math.min(size.width, size.height)
}

/**
 * The content rect (§6.2): with `place.auto`, the chosen third (the frame's
 * full width, a third of its height) inset at each side by `TITLE_SAFE` of
 * the width and, where the third meets the frame's top or bottom edge, by
 * `TITLE_SAFE` of the height; with `auto: false`, the dragged box itself, its
 * unit rect in frame pixels.
 */
export function contentRect(place: GraphicSpec['place'], size: { width: number; height: number }): Rect {
  if (!place.auto) {
    const b = place.box
    return { x: b.x * size.width, y: b.y * size.height, width: b.width * size.width, height: b.height * size.height }
  }
  const third = size.height / 3
  const index = place.third === 'top' ? 0 : place.third === 'middle' ? 1 : 2
  const side = TITLE_SAFE * size.width
  const top = index === 0 ? TITLE_SAFE * size.height : 0
  const bottom = index === 2 ? TITLE_SAFE * size.height : 0
  return { x: side, y: index * third + top, width: size.width - 2 * side, height: third - top - bottom }
}

/** The width a field wraps at (§6.2): the content rect's, never wider than `WRAP_MAX` of the frame's. */
export function wrapWidth(rect: Rect, size: { width: number; height: number }): number {
  return Math.max(0, Math.min(rect.width, WRAP_MAX * size.width))
}

/** Whether a laid-out block lies within the content rect (a hair of float error allowed). */
export function fitsIn(block: { width: number; height: number }, rect: Rect): boolean {
  return block.width <= rect.width + 1e-6 && block.height <= rect.height + 1e-6
}

/**
 * The too-big rule (§6.2): the first scale, from 1 down by `FIT_STEP` to
 * `FIT_MIN`, at which `fits` holds; null past that, when the graphic is
 * dropped with `TOO_LONG_NOTE`.
 */
export function fitScale(fits: (scale: number) => boolean): number | null {
  const steps = Math.round((1 - FIT_MIN) / FIT_STEP)
  for (let i = 0; i <= steps; i++) {
    const scale = Math.round((1 - i * FIT_STEP) * 1000) / 1000
    if (fits(scale)) return scale
  }
  return null
}

/* ------------------------------------------------------------------- looks */

/** A text look in the style's text style and face, at `px` rounded to whole pixels, as `textItems` rounds it. */
export function lookOf(style: GraphicStyle, px: number, align: TextLook['align'], accent?: string): TextLook {
  const look: TextLook = { textStyleId: style.textStyleId, font: style.font, px: Math.round(px), align }
  if (accent !== undefined) look.accent = accent
  return look
}

/** A line's height for a look, as `textItems` lays it: `round(px × LINE_HEIGHT)`, px rounded first. */
export function lineHeightOf(look: TextLook): number {
  return Math.round(Math.round(look.px) * LINE_HEIGHT)
}

/**
 * A field laid out into one text item per line (§6.3's `textItems` at unit
 * `line`), with §6.2's ids: the first line takes `id` itself (`value`,
 * `label`, `label-2`), any further line `<id>-<line>` (`label-1` for a
 * counter's second label line, `label-2-1` for a bar's). §6.2 names one id
 * per field and says nothing of a wrapped field's further lines; this is the
 * smallest scheme that keeps every id stable across frames. `source` is the
 * `GraphicData` path, `data.`-prefixed as §6.2 writes keyword's
 * (`data.words`).
 */
export function lineItems(
  id: string,
  text: string,
  look: TextLook,
  at: { x: number; y: number; width: number },
  measure: TextMeasure,
  source?: string
): TextItem[] {
  const items = textItems({ id, text, look, at, unit: 'line', source }, measure)
  return items.map((item, i) => ({ ...item, id: i === 0 ? id : `${id}-${i}` }))
}

/** The union of text items' boxes, null with none. */
export function boxOf(items: readonly { box: Rect }[]): Rect | null {
  if (items.length === 0) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const { box } of items) {
    x0 = Math.min(x0, box.x)
    y0 = Math.min(y0, box.y)
    x1 = Math.max(x1, box.x + box.width)
    y1 = Math.max(y1, box.y + box.height)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** The widest line's width among text items, 0 with none. */
export function widestOf(items: readonly { box: Rect }[]): number {
  return items.reduce((w, item) => Math.max(w, item.box.width), 0)
}

/* ------------------------------------------------------------------ motion */

/**
 * The ease of a draw-on, a count, a growing bar or a sweep: the style's own,
 * except `out-back`, which §6.13 keeps for the `pop` entrance only; its
 * overshoot would draw a count past its value, a bar past its share and a
 * stroke past its end before the beat. `expo-out` stands in for it, §6.13's
 * default. Beyond §6.2's words, which give the counter `style.motion.ease`.
 */
export function drawOnEase(style: GraphicStyle): MotionEase {
  return style.motion.ease === 'out-back' ? 'expo-out' : style.motion.ease
}

/** An entrance's values as `entrance` (motion.ts) gives them, with `dy` already in pixels. */
export interface Move {
  dy: number
  scale: number
  opacity: number
}

/**
 * An item moved by `move` about `about` (a block's centre), composed onto the
 * item's own transform: its opacity multiplied, and its transform such that
 * the item is scaled about `about` (not its own centre, as `ItemTransform`
 * turns), then lowered by `move.dy`. For an item with a transform `{x, y,
 * s}` about its own centre c, scaled by `k` about `C`: scale `k s`,
 * translation `(k − 1)(c − C) + k (x, y) + (0, dy)`. No rotation: no
 * entrance turns. An item a still move leaves alone is returned as it is, so
 * a settled list carries no identity transform.
 */
export function moved<T extends DrawItem>(item: T, move: Move, about: Point, size: { width: number; height: number }): T {
  if (move.dy === 0 && move.scale === 1 && move.opacity === 1) return item
  const own = item.transform ?? { x: 0, y: 0, scale: 1, rotate: 0 }
  const c = itemOrigin(item, size)
  const k = move.scale
  return {
    ...item,
    opacity: item.opacity * move.opacity,
    transform: {
      x: (k - 1) * (c.x - about.x) + k * own.x,
      y: (k - 1) * (c.y - about.y) + k * own.y + move.dy,
      scale: k * own.scale,
      rotate: own.rotate
    }
  }
}

/**
 * The style's entrance at progress `p` (`entrance`, motion.ts) as a `Move`,
 * its `dy` turned into pixels by `px`, the text size it is a fraction of.
 */
export function enterMove(style: GraphicStyle, p: number, px: number): Move {
  const e = entrance(style.motion.entrance, p)
  return { dy: e.dy * px, scale: e.scale, opacity: e.opacity }
}

/** A rectangle's centre. */
export function centreOf(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}

/* --------------------------------------------------------------------- dim */

/**
 * The dim every list opens with when the style dims (§6.2, "The draw
 * lists"): `palette.dim` at `palette.dimOpacity`, fading in from t = 0 over
 * `DURATIONS.dim` (§6.13), its hole round `targets.subject` (fixed at onset,
 * §6.9) and none when that is null or absent; null when the style does not
 * dim. The fade's ease (`drawOnEase`), the hole's corner (the style's
 * `radius` of `s`) and its hard edge (feather 0) are beyond §6.2's words.
 */
export function dimFor(style: GraphicStyle, t: number, targets: GraphicTargets, size: { width: number; height: number }): DimItem | null {
  if (!style.dim) return null
  const dim: DimItem = {
    kind: 'dim',
    id: 'dim',
    opacity: progress(t, 0, DURATIONS.dim, drawOnEase(style)),
    color: style.palette.dim,
    alpha: style.palette.dimOpacity
  }
  const subject = targets.subject
  if (subject) dim.hole = { box: { ...subject }, radius: style.radius * shortSide(size), feather: 0 }
  return dim
}

/**
 * A panel (a rounded shape in `palette.panel` at `palette.panelOpacity`,
 * corner the style's `radius` of `s`, the style's soft `shadow` under it);
 * null when `panelOpacity` is 0 (§6.2: "drawn only when `palette.panelOpacity`
 * > 0"). The shadow's blur (0.02 of `s`) and drop (0.006 of `s`) are beyond
 * §6.5's words, which give `shadow` as a 0..1 strength only.
 */
export function panelFor(id: string, box: Rect, style: GraphicStyle, size: { width: number; height: number }): ShapeItem | null {
  if (!(style.palette.panelOpacity > 0)) return null
  const s = shortSide(size)
  const panel: ShapeItem = {
    kind: 'shape',
    id,
    opacity: style.palette.panelOpacity,
    shape: 'rounded',
    box: { ...box },
    radius: style.radius * s,
    fill: style.palette.panel
  }
  if (style.shadow > 0) panel.shadow = { blur: 0.02 * s, dy: 0.006 * s, color: '#000000', opacity: style.shadow }
  return panel
}

/** The list a drawer returns: the dim first when the style dims, then the items. */
export function withDim(dim: DimItem | null, items: DrawItem[]): DrawItem[] {
  return dim ? [dim, ...items] : items
}

/** The beat of element `i`: its own, else the last there is, else 0. */
export function beatOf(spec: GraphicSpec, i: number): number {
  const beat = spec.beats[i] ?? spec.beats[spec.beats.length - 1]
  return Number.isFinite(beat) ? beat : 0
}
