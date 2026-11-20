/**
 * `screen-card` (docs/CLIPS.md §6.16, "The screen card"; phase 3's piece 4): a
 * screen recording framed as a card that tilts in (or pulls back) to land flat
 * on the very box where the render already shows the recording, then hands
 * over to the recording itself.
 *
 * One plane at `z` 0 (no item carries a `z`, `planesOf` reads that as 0) plus
 * the screen-space dim (§6.16's "What it draws" table):
 *
 * | frames | items |
 * |---|---|
 * | up to `L` | a full-frame dim (no hole) at the style's `palette.dimOpacity`, fading in with the move whatever the style's `dim` says; the recording's frame as an `image` filling the card's box; the bezel, a square-joined `stroke` round the box in `palette.panel` |
 * | `L + 1` on (held by `tpad`) | the dim with its hole on the card's box (radius 0), and the bezel; no image |
 *
 * `L` = `landingFrame(fps)` = round(SCREEN_CARD_MOVE_S × fps), counted from
 * the CARD's own first frame (`clock.t × fps`), never a timeline frame. Both
 * moves land exactly flat on the card's box at `L` (the move runs over `L /
 * fps` seconds, so `progress` reads its exact 1 on frame `L` at every rate),
 * and from `L + 1` the list carries no camera at all: the held frame is route
 * one's, painter A's alone.
 *
 * - **Tilt in**: the camera from tilt `SCREEN_CARD_TILT_IN.tilt` (the top
 *   away, compositor.ts `cameraFor`), yaw `.yaw`, dolly `.dolly` to flat on
 *   the style's curve; the card (image and bezel) from opacity 0 to 1 over the
 *   first `.fadeS` seconds.
 * - **Pull back** (the research's §1.2 row 23, "start with the screen filling
 *   the frame"): the card's transform from scale `SCREEN_CARD_PULL_BACK.scale`
 *   about its own centre to 1, with a tilt from `.tilt` to 0, opaque
 *   throughout.
 *
 * Without WebGL the camera is ignored (painter A): Tilt in is the card fading
 * in on its box, Pull back its flat scale (the transform painter A honours).
 *
 * The box and the recording's frame come in through `targets.screen`
 * (§6.3's `GraphicTargets.screen`): the pure `graphicTargetsAt` gives the box,
 * the renderer's `screenTargetsAt` the file of each frame up to `L`, null
 * after. With no `screen` target the card draws nothing; with a frame whose
 * file is null up to `L` (a pull that failed or is still on its way) it draws
 * the move without the picture.
 *
 * **The edge sweep** (§6.16, "The edge sweep"; phase 3's piece 5): under a
 * style with `glow` (`neon`, `energetic`) and only then, a highlight runs
 * once round the bezel after the landing. With `N` = `edgeSweepFrames(fps)` =
 * round(EDGE_SWEEP_S × fps):
 *
 * | card frame `f` | the sweep |
 * |---|---|
 * | up to `L` | none (the move) |
 * | `L + 1` .. `L + N − 1` | its head at `edgeSweepHead(f)` = EDGE_SWEEP_START + (f − L) / N of the perimeter (mod 1), its tail `EDGE_SWEEP_SPAN` behind it; one `stroke` on `bezelPath(box)` with `from` = tail and `to` = head, or two (`sweep-1` from 1 − (SPAN − head) to 1, then `sweep-2` from 0 to head) while the span crosses the path's start; and one `GlowRequest` naming `sweep`, which `glowMatches` reads as `sweep` and its `sweep-<n>` pieces and never as the bezel |
 * | `L + N` on | none, and no glow: the settled card exactly, the bezel and the dim with its hole |
 *
 * So the sweep starts on `L + 1` with its head 1/N of the perimeter past the
 * path's start (the box's top-left corner, `bezelPath`), its tail on the
 * left edge, the span crossing the start; it runs the path's way, along the
 * top to the right, down the right edge, back along the bottom and up the
 * left edge (clockwise on screen); its last frame is `L + N − 1`, the head
 * 1/N short of where it began; and `L + N` is `graphicMovingFrames`' last
 * baked frame (`L + 1 + N` frames, frame.ts), the frame `tpad` holds: the
 * plain held card. Without WebGL painter A draws the strokes and ignores the
 * glow (§6.16).
 *
 * Every figure is a named export: §6.16's proposals, so the look rating
 * changes one line. Pure: no clock, no random, no DOM, no `node:path`.
 */

import type { Camera, DimItem, DrawItem, DrawOut, Drawer, GlowRequest, ImageItem, Rect, StrokeItem } from '../items'
import { DEFAULT_FOV } from '../compositor'
import { EDGE_SWEEP_S, SCREEN_CARD_MOVE_S } from '../frame'
import { progress } from '../motion'
import { STROKE_MIN_PX } from '../stroke'
import type { GraphicStyle } from '../style'
import { drawOnEase, shortSide } from './layout'

export { EDGE_SWEEP_S, SCREEN_CARD_MOVE_S } from '../frame'

/** The edge sweep's span, a fraction of the bezel's perimeter (§6.16, proposal). */
export const EDGE_SWEEP_SPAN = 0.12

/**
 * Where the sweep's head is at the landing `L`, a fraction of the perimeter
 * from `bezelPath`'s start (the box's top-left corner): 0, so the loop starts
 * and ends at that corner and the span crosses the path's start on its first
 * frames (this piece's choice; the plan names no place).
 */
export const EDGE_SWEEP_START = 0

/** The sweep's item id, and its glow request's: its two pieces are `sweep-1` and `sweep-2` (`glowMatches`' `<id>-<n>`). */
export const EDGE_SWEEP_ID = 'sweep'

/** The sweep's frames `N` = round(EDGE_SWEEP_S × fps): one loop. 0 for a rate that is not a positive number. */
export function edgeSweepFrames(fps: number): number {
  return fps > 0 && Number.isFinite(fps) ? Math.round(EDGE_SWEEP_S * fps) : 0
}

/**
 * The sweep's head at card frame `frame`, a fraction of the perimeter in
 * [0, 1), advancing linearly by 1/N a frame from `EDGE_SWEEP_START` at `L`;
 * null on a frame it is not drawn: up to `L`, and from `L + N` on.
 */
export function edgeSweepHead(frame: number, fps: number): number | null {
  const L = landingFrame(fps)
  const N = edgeSweepFrames(fps)
  if (!(frame > L) || !(frame < L + N)) return null
  const head = (EDGE_SWEEP_START + (frame - L) / N) % 1
  return head < 0 ? head + 1 : head
}

/**
 * The span behind a head, as `[from, to]` fractions of the path: one span
 * `[head − SPAN, head]`, or, while it crosses the path's start (the tail
 * below 0), two: `[1 − (SPAN − head), 1]` then `[0, head]`, whose lengths sum
 * to `EDGE_SWEEP_SPAN`. A head exactly on the start is the first piece alone.
 */
export function edgeSweepSpans(head: number): [number, number][] {
  const tail = head - EDGE_SWEEP_SPAN
  if (tail >= 0) return [[tail, head]]
  const wrapped: [number, number][] = [[1 + tail, 1]]
  if (head > 0) wrapped.push([0, head])
  return wrapped
}

/** The two moves (§6.1's `move`). */
export type ScreenCardMove = 'tilt-in' | 'pull-back'
export const SCREEN_CARD_MOVES: readonly ScreenCardMove[] = Object.freeze(['tilt-in', 'pull-back'] as ScreenCardMove[])

/** Tilt in (§6.16, proposals): the camera's tilt and yaw in degrees and its dolly, each to 0 at `L`; the card's fade-in in seconds. */
export const SCREEN_CARD_TILT_IN = Object.freeze({ tilt: 22, yaw: -10, dolly: -0.15, fadeS: 0.25 })

/** Pull back (§6.16, proposals): the card's scale about its centre and the camera's tilt in degrees, to 1 and 0 at `L`. */
export const SCREEN_CARD_PULL_BACK = Object.freeze({ scale: 1.35, tilt: 6 })

/** The bezel's width as a fraction of the short side (§6.16: round(0.004 × the short side), proposal). */
export const SCREEN_CARD_BEZEL = 0.004

/** The field of view the card's camera carries: the compositor's default (§6.16). */
export const SCREEN_CARD_FOV = DEFAULT_FOV

/** The dim's hole on the card's box from `L + 1`: square corners in v1 (§6.16), a hard edge. */
export const SCREEN_CARD_HOLE_RADIUS = 0

/**
 * The landing frame `L` (§6.16): round(SCREEN_CARD_MOVE_S × fps), counted from
 * the card's own first frame. 0 for a rate that is not a positive number.
 */
export function landingFrame(fps: number): number {
  return fps > 0 && Number.isFinite(fps) ? Math.round(SCREEN_CARD_MOVE_S * fps) : 0
}

/**
 * The bezel's width in frame pixels (§6.16): max(M19's minimum, round(0.004 ×
 * the short side)), M19's minimum being `STROKE_MIN_PX` of a 1080-pixel side
 * scaled to this frame (stroke.ts `strokeWidth`'s floor): 4 px at 1080, 2 at 540.
 */
export function bezelWidth(size: { width: number; height: number }): number {
  const s = shortSide(size)
  return Math.max((STROKE_MIN_PX * s) / 1080, Math.round(SCREEN_CARD_BEZEL * s))
}

/** The bezel's path: the box's rectangle, closed (a square cap fills the corner where it starts). */
export function bezelPath(box: Rect): string {
  const { x, y, width, height } = box
  return `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`
}

/** −0 as 0: a camera field must read exactly 0 at the landing, and `Object.is(−0, 0)` is false. */
const zero = (v: number): number => v + 0

/**
 * The move's camera at progress `p` (the style's curve, 1 at `L`): Tilt in's
 * tilt, yaw and dolly, Pull back's tilt, each its start × (1 − p), exactly 0
 * at `p` = 1.
 */
export function screenCardCamera(move: ScreenCardMove, p: number): Camera {
  const rest = 1 - p
  if (move === 'tilt-in') {
    return { tilt: zero(SCREEN_CARD_TILT_IN.tilt * rest), yaw: zero(SCREEN_CARD_TILT_IN.yaw * rest), dolly: zero(SCREEN_CARD_TILT_IN.dolly * rest), fov: SCREEN_CARD_FOV }
  }
  return { tilt: zero(SCREEN_CARD_PULL_BACK.tilt * rest), yaw: 0, dolly: 0, fov: SCREEN_CARD_FOV }
}

/** The dim (§6.16): the style's dim colour at `palette.dimOpacity` whatever `style.dim` says; its hole only from `L + 1`. */
function cardDim(style: GraphicStyle, opacity: number, hole: Rect | null): DimItem {
  const dim: DimItem = { kind: 'dim', id: 'dim', opacity, color: style.palette.dim, alpha: style.palette.dimOpacity }
  if (hole) dim.hole = { box: { ...hole }, radius: SCREEN_CARD_HOLE_RADIUS, feather: 0 }
  return dim
}

function bezel(box: Rect, style: GraphicStyle, size: { width: number; height: number }): StrokeItem {
  return {
    kind: 'stroke',
    id: 'bezel',
    opacity: 1,
    d: bezelPath(box),
    from: 0,
    to: 1,
    width: bezelWidth(size),
    color: style.palette.panel,
    cap: 'square',
    join: 'miter'
  }
}

/**
 * The sweep's strokes at card frame `frame`: none on a frame it is not drawn
 * (`edgeSweepHead`) or under a style with no `glow`; else one stroke per span
 * (`edgeSweepSpans`), on the bezel's own path, at the bezel's width and with
 * its square caps and miter join, so the two pieces meet at the corner where
 * the path starts as the bezel's own ends do, in the style's `palette.accent`.
 */
export function edgeSweepItems(box: Rect, style: GraphicStyle, size: { width: number; height: number }, frame: number, fps: number): StrokeItem[] {
  if (!style.glow) return []
  const head = edgeSweepHead(frame, fps)
  if (head === null) return []
  const spans = edgeSweepSpans(head)
  const d = bezelPath(box)
  const width = bezelWidth(size)
  return spans.map(([from, to], i) => ({
    kind: 'stroke',
    id: spans.length === 1 ? EDGE_SWEEP_ID : `${EDGE_SWEEP_ID}-${i + 1}`,
    opacity: 1,
    d,
    from,
    to,
    width,
    color: style.palette.accent,
    cap: 'square',
    join: 'miter'
  }))
}

/**
 * The sweep's glow (§6.16, "What glows": "The screen card's edge sweep is the
 * only other glow in step 3"): one request naming `EDGE_SWEEP_ID`, at the
 * style's `glow.strength`, its radius the style's `glow.radius` (a fraction of
 * the short side) in frame pixels as the hero's glow converts it
 * (templates/depth.ts `heroGlow`), in `palette.accent`. Undefined under a
 * style with no `glow`.
 */
export function edgeSweepGlow(style: GraphicStyle, size: { width: number; height: number }): GlowRequest[] | undefined {
  if (!style.glow) return undefined
  return [{ item: EDGE_SWEEP_ID, radius: style.glow.radius * shortSide(size), strength: style.glow.strength, color: style.palette.accent }]
}

export const drawScreenCard: Drawer =(spec, style, clock, size, _measure, targets): DrawOut => {
  const data = spec.data
  if (data.template !== 'screen-card') return { items: [] }
  const screen = targets.screen
  if (!screen || !(screen.box.width > 0) || !(screen.box.height > 0)) return { items: [] }
  const fps = clock.fps
  const L = landingFrame(fps)
  // The card's own frame: drawListAt hands t = frame / fps, so this is that frame exactly.
  const frame = fps > 0 ? Math.round(clock.t * fps) : 0
  const box = screen.box

  if (frame > L) {
    // L + 1 on: the bezel and the dim with its hole on the box; the recording itself shows through.
    // Under a style with glow, the edge sweep over the bezel for one loop, L + 1 .. L + N − 1, with its glow; then the plain card.
    const sweep = edgeSweepItems(box, style, size, frame, fps)
    const held: DrawOut = { items: [cardDim(style, 1, box), bezel(box, style, size), ...sweep] }
    if (sweep.length > 0) held.glow = edgeSweepGlow(style, size)
    return held
  }

  const landing = L / (fps > 0 ? fps : 1)
  const p = progress(clock.t, 0, landing, style.motion.ease)
  // The dim fades in with the move, never overshooting: the draw-on curve (no out-back), exactly 1 at L.
  const dimOpacity = progress(clock.t, 0, landing, drawOnEase(style))
  const card: DrawItem[] = []
  if (screen.file !== null) {
    const image: ImageItem = { kind: 'image', id: 'screen', opacity: 1, src: screen.file, box: { ...box }, fit: 'cover' }
    card.push(image)
  }
  card.push(bezel(box, style, size))

  let placed = card
  if (data.move === 'tilt-in') {
    const fade = progress(clock.t, 0, SCREEN_CARD_TILT_IN.fadeS, drawOnEase(style))
    if (fade < 1) placed = card.map((item) => ({ ...item, opacity: item.opacity * fade }))
  } else {
    const scale = 1 + (SCREEN_CARD_PULL_BACK.scale - 1) * (1 - p)
    // Both items turn about the box's centre (`itemOrigin`: the image's box, the bezel's points), so one scale moves the card whole.
    if (scale !== 1) placed = card.map((item) => ({ ...item, transform: { x: 0, y: 0, scale, rotate: 0 } }))
  }
  return { items: [cardDim(style, dimOpacity, null), ...placed], camera: screenCardCamera(data.move, p) }
}
