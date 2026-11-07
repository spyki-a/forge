/**
 * The draw list (docs/CLIPS.md §6.3): `drawListAt`, the pure function a
 * template's drawer is called through; `needsCompositor`, whether a list asks
 * for phase 3's painter B; `graphicBox`, the frame rectangle a graphic can
 * ink over its clip, the export's bake region (M1 chose the box, §6.15); and
 * `onsetTargetsAt`, the onset rule applied to a per-frame targets function.
 *
 * The only importer of `templates/index.ts`. Runs in node and the renderer
 * alike; nothing here reads a clock, `Math.random`, the DOM or `node:path`.
 * Randomness is the drawer's, through `seeded(spec.seed)` (render/moment.ts)
 * drawn in a fixed order, so the same arguments give a deep-equal list.
 */

import { DRAWERS } from './templates/index'
import { itemBounds, unionRect, type DrawItem, type DrawList, type Drawer, type GraphicTargets, type Rect, type TextMeasure } from './items'
import type { GraphicSpec } from './template'
import type { GraphicStyle } from './style'

/**
 * The list for one frame: `DRAWERS[spec.data.template]` (or the `drawer`
 * handed in, the seam phase 1's tests and the harness's `primitives` option
 * use) called with `t = frame / fps`, its `items`, `camera` and `glow` copied
 * onto a list of the frame's size; an empty list for a template with no
 * drawer. `targets` defaults to none resolved.
 */
export function drawListAt(
  spec: GraphicSpec,
  style: GraphicStyle,
  frame: number,
  fps: number,
  size: { width: number; height: number },
  measure: TextMeasure,
  targets?: GraphicTargets,
  drawer: Drawer | undefined = DRAWERS[spec.data.template]
): DrawList {
  const list: DrawList = { width: size.width, height: size.height, items: [] }
  if (!drawer) return list
  const out = drawer(spec, style, { t: fps > 0 ? frame / fps : 0, fps }, size, measure, targets ?? {})
  list.items = [...out.items]
  if (out.camera) list.camera = { ...out.camera }
  if (out.glow) list.glow = [...out.glow]
  return list
}

/**
 * Whether a graphic fits its place (§6.2, "Too big"): false when its
 * template's drawer, shrunk to `FIT_MIN` of the layout table
 * (`templates/layout.ts`), still cannot fit the content rect, so it returns
 * an empty list on every frame; the caller then drops the graphic with
 * `TOO_LONG_NOTE`. A `DrawOut` has no note field, so this is the question the
 * store asks, beyond §6.2's words. Read at the clip's start: the layout does
 * not move with t. True for a template with no drawer, which has nothing to
 * fit.
 */
export function graphicFits(
  spec: GraphicSpec,
  style: GraphicStyle,
  size: { width: number; height: number },
  measure: TextMeasure,
  targets?: GraphicTargets,
  drawer: Drawer | undefined = DRAWERS[spec.data.template]
): boolean {
  if (!drawer) return true
  return drawer(spec, style, { t: 0, fps: 30 }, size, measure, targets ?? {}).items.length > 0
}

function anyZ(items: readonly DrawItem[]): boolean {
  for (const item of items) {
    if (item.z !== undefined) return true
    if (item.kind === 'group' && anyZ(item.children)) return true
  }
  return false
}

/**
 * Whether a list asks for painter B (§6.16): any item carries `z` (a group's
 * children included), or the list carries a `camera` or a non-empty `glow`.
 * Painter A ignores all three. False for every list in phases 1 and 2.
 */
export function needsCompositor(list: DrawList): boolean {
  if (list.camera) return true
  if (list.glow && list.glow.length > 0) return true
  return anyZ(list.items)
}

/**
 * The onset rule on a per-frame targets function (§6.3, "Targets": `subject`
 * is evaluated once, at the graphic clip's first frame, for every template,
 * and that value is what `targetsAt` returns for every frame of the clip):
 * `subject` read at frame 0 and handed to every frame, `tip` and `screen`
 * (phases 3 and 4's per-frame targets) read per frame. So a dim's hole and a
 * callout's target are fixed at onset and add no moving frame, whatever the
 * function handed in does. `graphicBox` scans frames through this; the
 * renderer's bake and preview are to as well, so a drawer never sees a
 * subject that moves.
 */
export function onsetTargetsAt(targetsAt: (frame: number) => GraphicTargets): (frame: number) => GraphicTargets {
  let onset: GraphicTargets | undefined
  return (frame) => {
    if (onset === undefined) onset = targetsAt(0)
    const at = frame === 0 ? onset : targetsAt(frame)
    const fixed: GraphicTargets = { ...at }
    delete fixed.subject
    if (onset.subject !== undefined) fixed.subject = onset.subject
    return fixed
  }
}

const evenDown = (v: number): number => 2 * Math.floor(v / 2)
const evenUp = (v: number): number => 2 * Math.ceil(v / 2)
/** Transparent columns past the ink on a box's right and rows below it: what the exit geq's w − 2 / h − 2 clamp copies stay clear (graphicBox). */
const GEQ_EDGE_PX = 2

/**
 * The frame rectangle a graphic can ink over its clip (§6.3, "The box"): the
 * union of `itemBounds`, each clipped to the frame, over every frame of
 * `drawListAt` from 0 to `total − 1` (`targetsAt` through `onsetTargetsAt`),
 * snapped outward to even x, y,
 * width and height (an odd offset or size is invalid for the subsampled
 * chroma, as `captionBand` snaps, captions/bake.ts; even as far as an even
 * frame allows, as `captionBand`: an odd frame side clamps to an odd edge),
 * then widened by GEQ_EDGE_PX on the right and at the bottom (below),
 * clamped to the frame, at least 2×2; null when no frame has ink inside the
 * frame (no item, every item wholly outside it, or one of no area), or
 * `total` is not positive. A non-finite bound (a NaN rotate, a NaN px) is a
 * template bug and throws, as `flattenPath`'s refusal does, rather than
 * sizing a bake canvas by NaN. In node it is geometry; the harness checks
 * the real paint against it (alpha 0 outside the box, §6.11).
 *
 * The scan runs over the clip's frames, not only to the last moving one, so
 * it needs nothing of `frame.ts` (lane B's third piece): a held frame draws
 * the settled list, whose bounds the union already holds, so the box is the
 * same and only the scan is longer; `graphicMovingFrames` may cut it later.
 *
 * The far sides' two transparent columns and rows are for the render's exit
 * fade (plan.ts, the opacity keys' `geq=r='r(X,Y)'…:a='alpha(X,Y)*…'`): geq's
 * `getpix` samples bilinearly with x clamped to w − 2 and y to h − 2, so the
 * stream's last column becomes a copy of the one before it and its last row
 * of the row above, in all four channels. Read in libavfilter/vf_geq.c at
 * f22fcd4 (:91-92, the Windows build's 2018-12-17 master: the clamp on every
 * call and no `interpolation` option, which came later) and run on the Mac's
 * 4.4 build (an 8×6 RGBA identity geq: column 7 equal to column 6, row 5 to
 * row 4). With the box ending at the ink's even edge, or one past an odd
 * one, that copy drew the graphic a pixel wider and taller on the box route
 * than on the canvas route and in the preview (f8d74ee's graphic.int: 39,893
 * plan-frame samples at 9:16, 36,066 at 16:9, all in the box's last column
 * and row). Two more transparent columns and rows make the copied ones
 * transparent too; where the frame's edge clamps the box first, the canvas
 * route's stream ends there as well and both routes copy the same pixels.
 */
export function graphicBox(
  spec: GraphicSpec,
  style: GraphicStyle,
  fps: number,
  total: number,
  size: { width: number; height: number },
  measure: TextMeasure,
  targetsAt: (frame: number) => GraphicTargets,
  drawer: Drawer | undefined = DRAWERS[spec.data.template]
): Rect | null {
  if (!(total > 0)) return null
  const at = onsetTargetsAt(targetsAt)
  let all: Rect | null = null
  for (let frame = 0; frame < total; frame++) {
    const list = drawListAt(spec, style, frame, fps, size, measure, at(frame), drawer)
    for (const item of list.items) {
      const r = itemBounds(item, size, measure)
      if (!r) continue
      if (!Number.isFinite(r.x + r.y + r.width + r.height)) throw new Error(`graphicBox: a non-finite bound on ${item.id}`)
      // Each item's bounds clipped to the frame: what it can ink there. An item wholly outside, or of no area, inks nothing.
      const x0 = Math.max(0, r.x), x1 = Math.min(size.width, r.x + r.width)
      const y0 = Math.max(0, r.y), y1 = Math.min(size.height, r.y + r.height)
      if (x1 <= x0 || y1 <= y0) continue
      all = unionRect(all, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
    }
  }
  if (!all) return null
  const x0 = Math.min(Math.max(0, evenDown(all.x)), Math.max(0, size.width - 2))
  const y0 = Math.min(Math.max(0, evenDown(all.y)), Math.max(0, size.height - 2))
  const x1 = Math.min(size.width, evenUp(all.x + all.width) + GEQ_EDGE_PX)
  const y1 = Math.min(size.height, evenUp(all.y + all.height) + GEQ_EDGE_PX)
  return { x: x0, y: y0, width: Math.max(2, x1 - x0), height: Math.max(2, y1 - y0) }
}
