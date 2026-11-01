/**
 * A graphic clip's frames (docs/CLIPS.md §6.3, "Moving frames, the beat frame
 * and the exit"): `beatFrame`, the first frame at or after a beat;
 * `graphicMovingFrames`, how many frames the bake draws before `tpad` holds
 * the settled picture; `graphicExitKeys`, the clip's own 0.3 s opacity fade,
 * drawn by the render's keys and never baked; and `drawnGraphicAsset`, the
 * drawn asset a graphic clip is placed on, the one helper the store's
 * `addGraphicClip` and §6.6's pure `applyGraphics` both call.
 *
 * Phase 1 builds all four as §6.3 specifies them. `graphicFrame`'s second
 * half (§6.19's T1) is the test's phase-2 cases over the 27 fixtures, not
 * code here; §6.16's `screenCardKeys` is phase 3's.
 *
 * Pure: no clock, no random, no DOM, no `node:path`; nothing from the renderer
 * or main.
 */

import type { KeyframeTracks } from '../render/keyframes'
import type { MediaAsset } from '../timeline'
import type { GraphicSpec } from './template'
import type { GraphicStyle } from './style'

/* --------------------------------------------------------------- constants */

/**
 * Seconds after the last beat the bake keeps drawing, so the last frame baked
 * is the first settled one and the frame `tpad` holds is the settled picture,
 * not one a frame short of it (§6.3).
 */
export const SETTLE_S = 0.5

/**
 * The clip's own exit: opacity keys over its last `EXIT_S` seconds (§6.3). Not
 * a `DURATIONS` entry (§6.13): it is the keys', never a drawer's, so held
 * frames are never baked to fade.
 */
export const EXIT_S = 0.3

/**
 * The allowance `beatFrame` subtracts, in frames (§6.3: `ceil(beat × fps −
 * 1e-6)`), so a beat a hair after a frame's time, by float error, still names
 * that frame. `progress` (motion.ts) adds its own 1e-6 in seconds, which §6.3
 * and §6.13's Built note record as an open item of the user's: for a beat
 * between 1e-6 of a frame and 1e-6 s after a frame's time, `progress` reads 1
 * a frame before the one named here. Left as specified; `graphicFrame` measures
 * the window and prints it, and pins nothing on either side of it.
 */
export const BEAT_FRAME_ALLOWANCE = 1e-6

/**
 * §6.16's screen card (phase 3): its move lands flat at frame `L` =
 * `round(SCREEN_CARD_MOVE_S × fps)` of the card's own frames, and under a
 * style with `glow` its edge sweep runs one loop of `EDGE_SWEEP_S` from the
 * landing, then is gone. Both are §6.16's proposals; they live here, not in
 * phase 3's `templates/screenCard.ts`, because `graphicMovingFrames` reads
 * them in phase 1 (its third past-settle case) and the drawer must agree with
 * the bake on where the loop ends.
 */
export const SCREEN_CARD_MOVE_S = 1.0
export const EDGE_SWEEP_S = 6

/* -------------------------------------------------------------- the frames */

/**
 * The first frame at or after `beat` seconds: `ceil(beat × fps − 1e-6)`
 * (§6.3). An element arrives ON its beat: `progress` (§6.13) starts its curve
 * `seconds` before the beat and reads 1 on this frame, not before. Never
 * below 0 (a beat before the clip's start, which a trim clamps to 0 anyway,
 * names frame 0), and never −0, which `Math.ceil` yields for a beat at 0. A
 * beat or a rate that is not finite names frame 0 too, never Infinity.
 */
export function beatFrame(beat: number, fps: number): number {
  if (!(Number.isFinite(fps) && fps > 0) || !Number.isFinite(beat)) return 0
  return Math.max(0, Math.ceil(beat * fps - BEAT_FRAME_ALLOWANCE))
}

/**
 * How many of the clip's `total` frames the bake draws (§6.3): `min(total,
 * beatFrame(last beat + SETTLE_S, fps) + 1)`, the last frame baked being the
 * first settled one, so a beat at 1.0 s at 30 fps gives 46 moving frames, not
 * 45; `tpad` holds the rest (`holdFilter`, render/plan.ts). A spec with no
 * beats settles `SETTLE_S` after its start.
 *
 * It runs past the settle in exactly three cases, each a hold that moves,
 * once per clip at most:
 * - a `steps` with a `line` connector under the energetic style, whose
 *   connector carries the travelling beam (§6.2; allowed by M1, 2026-10-27):
 *   `total`, at most 8 s;
 * - a callout with an `anchor` (its tip follows the hand, §6.18): `total`, at
 *   most 3 s;
 * - a screen card under a style with `glow` (§6.16): `min(total, L + 1 +
 *   round(EDGE_SWEEP_S × fps))`, the landing plus one loop of its edge sweep,
 *   never the card's whole hold (211 frames at 30 fps).
 *
 * 0 for a clip of no frames or a frame rate that is not positive.
 */
export function graphicMovingFrames(spec: GraphicSpec, style: GraphicStyle, fps: number, total: number): number {
  if (!(total > 0) || !(fps > 0)) return 0
  const { data } = spec
  if (data.template === 'steps' && data.connector === 'line' && style.energy === 'energetic') return total
  if (data.template === 'callout' && spec.anchor !== undefined) return total
  if (data.template === 'screen-card' && style.glow !== undefined) {
    const landing = Math.round(SCREEN_CARD_MOVE_S * fps)
    return Math.min(total, landing + 1 + Math.round(EDGE_SWEEP_S * fps))
  }
  let last = 0
  for (const beat of spec.beats) if (Number.isFinite(beat) && beat > last) last = beat
  return Math.min(total, beatFrame(last + SETTLE_S, fps) + 1)
}

/* ---------------------------------------------------------------- the exit */

/**
 * The clip's exit as opacity keys (§6.3): 1 at `durationFrames − round(EXIT_S
 * × fps)`, leaving it `'smooth'` (the keys' own vocabulary,
 * render/keyframes.ts, not the motion module's), and 0 on the clip's last
 * frame, `durationFrames − 1` (keys count from the clip's own frame 0, as
 * `arrivalKeys` in automation/grid.ts writes them). The render already draws
 * them (geq on alpha), so held frames are never baked to fade. Written by
 * `addGraphicClip` and the Director's apply, again by `setGraphic` when
 * `seconds` changes, and again on a trim (§6.3, the store).
 *
 * A clip shorter than the exit fades from its first frame; a clip of one
 * frame cannot fade and is shown whole (one key, value 1), since two keys on
 * one frame are a contradiction `normaliseKeys` resolves by dropping one. A
 * duration or a rate that is not a positive number gets that same one key,
 * never a key at frame NaN (`Math.max(0, NaN)` is NaN, so the guard is a
 * comparison, as `graphicMovingFrames`'s is).
 */
export function graphicExitKeys(durationFrames: number, fps: number): KeyframeTracks {
  const frames = durationFrames > 0 ? Math.floor(durationFrames) : 0
  const last = Math.max(0, frames - 1)
  // The fade's frames are the clip's last round(EXIT_S × fps), the 1 key and the 0 key both among them.
  const first = Math.max(0, frames - Math.round(EXIT_S * (fps > 0 ? fps : 0)))
  if (first >= last) return { opacity: [{ frame: 0, value: 1 }] }
  return {
    opacity: [
      { frame: first, value: 1, ease: 'smooth' },
      { frame: last, value: 0 }
    ]
  }
}

/* --------------------------------------------------------------- the asset */

/**
 * A graphic's drawn asset (§6.3): `path: ''` until the store's bake lands
 * (`fillAssetPath`), `kind: 'image'`, `size: 0` so it stays out of the photo
 * tools (`isPhoto`, edit/photos.ts), `fps: null` as a still's. Its callers pass
 * `name` = the template's id and " — graphic" ("counter — graphic") and
 * `durationFrames` = `max(duration, round(fps × 10))`, as the paper asset
 * does, so a trim can lengthen the clip (`trimEnd` stops at the asset's
 * length). The one helper the store's `addGraphicClip` and §6.6's pure
 * `applyGraphics` both call, so the two shapes cannot differ.
 */
export function drawnGraphicAsset(clipId: string, width: number, height: number, durationFrames: number, name: string): MediaAsset {
  return {
    id: `graphic-asset-${clipId}`,
    path: '',
    name,
    kind: 'image',
    durationFrames,
    size: 0,
    width,
    height,
    fps: null,
    hasVideo: true,
    hasAudio: false
  }
}
