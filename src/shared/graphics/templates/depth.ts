/**
 * The 2.5D variants of `counter` and `ring`, and the hero's glow (docs/CLIPS.md
 * §6.16, "The 2.5D variants of `counter` and `ring`" and "What glows"; phase
 * 3's piece 3). One `depth` branch in each draw function, built only from
 * §6.3's item kinds and §6.13's motion: the drawer lays out and moves its
 * items exactly as its flat variant does, then this file puts them on their
 * planes (`z`), gives the list its camera, and, for its clip's hero under a
 * style with `glow`, its one `GlowRequest`. No text item is touched: a depth
 * variant changes `z`, `camera` and `glow` only, so every frame's text (text
 * and look) is the flat variant's and §6.7's property test holds unchanged.
 *
 * Every figure below is §6.16's proposal, named so the look rating changes
 * one line. The curve is the style's (§6.13).
 *
 * **Settling.** The camera moves over the entrance (`DURATIONS.entrance`),
 * ending no later than the first beat, and the focus blur over the count,
 * ending ON the beat with the value; both end on `progress`' exact 1, so at
 * and after the last beat every camera field and the blur are exactly 0
 * (`+ 0` turns a −0 into 0). The last moving frame is then route one's
 * (compositor.ts `isFlat`), and the frame `tpad` holds is the flat graphic's
 * own. `graphicMovingFrames` (frame.ts) reads no depth: a variant bakes the
 * frames its flat twin bakes.
 *
 * **The planes only while it moves.** The items carry their `z` only on a
 * frame whose camera is off flat or whose blur is above 0; on a settled frame
 * they are the flat variant's list itself, in its own order, with no `z`
 * (the list keeps its flat camera). The table's planes put the value in front
 * of the label, which the flat variant paints the other way round (value,
 * then label), and planes are painted far to near; their text styles' reach
 * overlaps (in node, the value's ink bounds run 35 to 95 px into the label's
 * under every preset, neon's and energetic's halos the most), so a settled
 * frame on its planes could differ from the flat twin where the halos meet.
 * On a flat camera with no blur the planes project exactly onto the frame
 * (compositor.ts `compensation`), so dropping `z` there changes no geometry,
 * only the painting order, back to the flat graphic's.
 *
 * Pure: no clock, no random, no DOM, no `node:path`.
 */

import type { Camera, DrawItem, DrawOut, GlowRequest } from '../items'
import { DEFAULT_FOV, cameraIsFlat } from '../compositor'
import { DURATIONS, progress } from '../motion'
import type { GraphicStyle } from '../style'
import { GRAPHIC_TEMPLATES, type GraphicSpec } from '../template'
import { drawOnEase, shortSide } from './layout'

/** The four moves (§6.16's table); `'flat'` and absence draw no move. */
export type DepthMove = 'tilt' | 'parallax' | 'dolly' | 'focus'
export const DEPTH_MOVES: readonly DepthMove[] = Object.freeze(['tilt', 'parallax', 'dolly', 'focus'] as DepthMove[])

/** `tilt`: the camera from this tilt, in degrees, the top away (compositor.ts `cameraFor`), to 0 over the entrance (proposal). */
export const DEPTH_TILT_FROM = 24
/** `parallax`: the camera from this yaw, in degrees, to 0 over the entrance, the planes sliding against each other (proposal). */
export const DEPTH_PARALLAX_YAW_FROM = -8
/** `dolly`: from this dolly (a negative value starts further away, `cameraFor`) to 0 over the entrance (proposal). */
export const DEPTH_DOLLY_FROM = -0.12
/**
 * `focus`: the label plane's blur radius in frame pixels at the start, falling
 * to exactly 0 as the value lands (proposal). `Camera.focus.px` is "the blur
 * in frame pixels per frame height of distance from" the depth in focus
 * (§6.16, compositor.ts `focusRadius`), so the drawer emits `px` = this ÷ the
 * label plane's distance from the focus (10 ÷ 0.02 = 500 at the start): the
 * label plane reads this radius, the value's plane 0.
 */
export const DEPTH_FOCUS_BLUR_PX = 10
/** The depth in focus under `focus`: the value's plane. */
export const DEPTH_FOCUS_Z = 0
/** The field of view every depth variant's camera carries: the compositor's default (§6.16, proposal). */
export const DEPTH_FOV = DEFAULT_FOV

/**
 * Each field's plane per move, in frame heights, positive toward the viewer
 * (§6.16's table, proposals). `tilt` is one plane: no `z` at all. Beyond the
 * table's words, each a decision of piece 3:
 * - the ring's "panel 0" is its `track` (the ring has no panel), and its
 *   label, which the parallax row does not name, rides the track's plane;
 * - `dolly`'s other fields stay on z 0 (the row names only the value's plane);
 * - `focus` puts the counter's PANEL on the label's plane at −0.02: a panel
 *   on z 0 would be drawn over a label behind it (planes are painted far to
 *   near), hiding the label at rest, so the settled frame would not be the
 *   flat twin's. The ring's track and arc stay on z 0 ("the arc and value
 *   sharp").
 */
export const DEPTH_PLANES: Readonly<Record<'counter' | 'ring', Readonly<Record<Exclude<DepthMove, 'tilt'>, Readonly<Record<string, number>>>>>> = Object.freeze({
  counter: Object.freeze({
    parallax: Object.freeze({ panel: 0, label: 0.02, value: 0.05 }),
    dolly: Object.freeze({ panel: 0, label: 0, value: 0.05 }),
    focus: Object.freeze({ panel: -0.02, label: -0.02, value: DEPTH_FOCUS_Z })
  }),
  ring: Object.freeze({
    parallax: Object.freeze({ track: 0, arc: 0.03, value: 0.05, label: 0 }),
    dolly: Object.freeze({ track: 0, arc: 0, value: 0.05, label: 0 }),
    focus: Object.freeze({ track: DEPTH_FOCUS_Z, arc: DEPTH_FOCUS_Z, value: DEPTH_FOCUS_Z, label: -0.02 })
  })
})

/** The item a hero's glow names (§6.16, "What glows"): the counter's value, the ring's arc. */
export const HERO_GLOW_ITEM: Readonly<Record<'counter' | 'ring', string>> = Object.freeze({ counter: 'value', ring: 'arc' })

/** −0 as 0: a camera field must read exactly 0 at rest, and `Object.is(−0, 0)` is false. */
const zero = (v: number): number => v + 0

/**
 * The move a spec's depth asks for: null for none, for `'flat'`, and on a
 * template whose `TemplateDef.threeD` is not true (§6.16: honoured only there).
 */
export function depthOf(spec: Pick<GraphicSpec, 'depth' | 'data'>): DepthMove | null {
  const depth = spec.depth
  if (depth === undefined || depth === 'flat') return null
  return GRAPHIC_TEMPLATES[spec.data.template]?.threeD === true ? depth : null
}

/** A field's id from an item's: a wrapped line's `label-1` is `label`'s. */
const fieldOf = (id: string): string => id.replace(/-\d+$/u, '')

/**
 * The camera of `move` at `t` (§6.16's table): tilt, yaw or dolly from its
 * start to 0 on the style's curve over the entrance, ending no later than
 * `beat`; `focus` flat throughout, its blur falling on the value's own
 * draw-on curve (`drawOnEase`, the count's) to exactly 0 on `beat`.
 */
export function depthCamera(move: DepthMove, style: GraphicStyle, t: number, beat: number, labelZ = DEPTH_PLANES.counter.focus.label): Camera {
  const span = Math.min(DURATIONS.entrance, Math.max(0, beat))
  const rest = 1 - progress(t, 0, span, style.motion.ease)
  const camera: Camera = { tilt: 0, yaw: 0, dolly: 0, fov: DEPTH_FOV }
  if (move === 'tilt') camera.tilt = zero(DEPTH_TILT_FROM * rest)
  if (move === 'parallax') camera.yaw = zero(DEPTH_PARALLAX_YAW_FROM * rest)
  if (move === 'dolly') camera.dolly = zero(DEPTH_DOLLY_FROM * rest)
  if (move === 'focus') {
    const blur = 1 - progress(t, 0, beat, drawOnEase(style))
    camera.focus = { z: DEPTH_FOCUS_Z, px: zero((DEPTH_FOCUS_BLUR_PX * blur) / Math.abs(labelZ - DEPTH_FOCUS_Z)) }
  }
  return camera
}

/**
 * The items on their planes: every item but the dims given its field's `z`
 * (0 for a field the table does not name), the dims first and the rest in
 * ascending `z`, list order kept inside a plane (§6.16: "A draw function that
 * asks for depth emits its items in ascending `z`"). `tilt` leaves the items
 * as they are: one plane.
 */
export function onPlanes(template: 'counter' | 'ring', move: DepthMove, items: readonly DrawItem[]): DrawItem[] {
  if (move === 'tilt') return [...items]
  const table = DEPTH_PLANES[template][move]
  const dims = items.filter((item) => item.kind === 'dim')
  const placed = items.filter((item) => item.kind !== 'dim').map((item) => ({ ...item, z: table[fieldOf(item.id)] ?? 0 }))
  // Array.prototype.sort is stable: list order is kept inside a plane.
  return [...dims, ...placed.sort((a, b) => a.z - b.z)]
}

/**
 * The hero's glow (§6.16, "What glows"): one request, only when the spec is
 * its clip's hero AND the style carries `glow` (`neon`, `energetic`), on the
 * counter's `value` or the ring's `arc`, at the style's strength, its radius
 * the style's `glow.radius` (a fraction of the short side, as the style's
 * other sizes are, style.ts) in frame pixels, in `palette.accent`. Undefined
 * otherwise, and on a template that is not `threeD`.
 */
export function heroGlow(template: 'counter' | 'ring', spec: Pick<GraphicSpec, 'hero' | 'data'>, style: GraphicStyle, size: { width: number; height: number }): GlowRequest[] | undefined {
  if (spec.hero !== true || !style.glow) return undefined
  if (GRAPHIC_TEMPLATES[spec.data.template]?.threeD !== true) return undefined
  return [{ item: HERO_GLOW_ITEM[template], radius: style.glow.radius * shortSide(size), strength: style.glow.strength, color: style.palette.accent }]
}

/**
 * A counter's or ring's `DrawOut` from its flat items (the dim first, as
 * `withDim` returns them): on its planes with its camera when its spec asks
 * for a move, with the hero's glow when it is the hero; the flat items alone
 * otherwise, so a plain graphic's list is phase 2's exactly.
 */
export function depthOut(
  template: 'counter' | 'ring',
  spec: GraphicSpec,
  style: GraphicStyle,
  t: number,
  beat: number,
  size: { width: number; height: number },
  items: DrawItem[]
): DrawOut {
  const move = depthOf(spec)
  const out: DrawOut = { items }
  if (move) {
    const camera = depthCamera(move, style, t, beat, move === 'focus' ? DEPTH_PLANES[template].focus.label : undefined)
    out.camera = camera
    // The planes while the camera moves or the label blurs; at rest the flat variant's own list (see the file's head).
    if (!cameraIsFlat(camera)) out.items = onPlanes(template, move, items)
  }
  const glow = heroGlow(template, spec, style, size)
  if (glow) out.glow = glow
  return out
}
