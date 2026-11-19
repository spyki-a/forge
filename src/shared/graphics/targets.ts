/**
 * A graphic's targets (docs/CLIPS.md §6.3, "Targets"): what a drawer may see
 * of the footage, resolved here from the project and handed into
 * `drawListAt`, so the drawing stays pure. Phase 1 fills `subject`; `tip` is
 * phase 4's branch (§6.18, `tipOnFrame`) and `screen` phase 3's (§6.16, the
 * box here and the file from the renderer's `screenTargetsAt`), both left as
 * the seam `frame` is for. Phase 3's piece 4 fills `screen`'s box and
 * `underCard` (§6.9, §6.16).
 *
 * Pure: reads the project through the export's own readers (`sourceToFrame`,
 * `subjectBoxesAt`, `captionSourceClip`), never a second model of the crop or
 * the fit; no clock, no DOM, no `node:path`.
 */

import { sourceToFrame, subjectBoxesAt } from '../reframe/frameMap'
import type { UnitRect } from '../reframe/types'
import { captionSourceClip } from '../captions/timeline'
import type { Clip, MediaAsset, Project } from '../timeline'
import type { GraphicSpec } from './template'
import type { GraphicTargets, Rect } from './items'

/** A unit box of `size` as frame pixels. */
function toFrame(u: UnitRect, size: { width: number; height: number }): Rect {
  return { x: u.x * size.width, y: u.y * size.height, width: u.width * size.width, height: u.height * size.height }
}

function assetOf(project: Project, clip: Clip): MediaAsset | null {
  return project.assets.find((a) => a.id === clip.assetId) ?? null
}

const shows = (clip: Clip, frame: number): boolean => frame >= clip.start && frame < clip.start + clip.duration

/**
 * The subject on the output frame at project frame `onset`, in pixels of
 * `size`, or null: off screen, no clip under the frame, no track, a clip or
 * asset the project no longer holds. Null is an ordinary answer, not an
 * error (§6.3).
 *
 * With `spec.subject` (a box in SOURCE units on its `clipId`, taken once at
 * onset by §6.9): that box through `sourceToFrame` on that clip at `onset`,
 * null when the clip does not show that frame, and null when the clip is not
 * on a visible video track (its track hidden, or a track id the project no
 * longer has): the export draws no such clip (render/plan.ts, the hidden
 * tracks skipped), so "on screen" means the same on both routes here, the
 * other route getting it from `captionTrack`'s own filter. With `spec.subject`
 * null (§6.9 found none to take, or the shot zooms under the graphic): null,
 * no hole. Without one (absent, a graphic §6.9 never placed): the union of
 * `subjectBoxesAt` on the clip of `captionTrack(project)` under the frame,
 * the track whose speaker the captions follow. The canvas handed to the
 * mapping is `size` itself: the frame being drawn, so a project at another
 * canvas is read through `followCanvas` inside `sourceToFrame` for this one,
 * as the export reads a moment's textures.
 */
function subjectAt(project: Project, spec: Pick<GraphicSpec, 'subject'>, onset: number, size: { width: number; height: number }): Rect | null {
  // A size with no area is `sourceToFrame`'s own refusal (null), on both routes; no guard of this file's.
  const taken = spec.subject
  // §6.9 step 4: looked for and not taken (none at onset, or a zoom under the span): no hole, never the fallback.
  if (taken === null) return null
  if (taken) {
    const footage = project.clips.find((c) => c.id === taken.clipId)
    if (!footage || !shows(footage, onset)) return null
    const track = project.tracks.find((t) => t.id === footage.trackId)
    if (!track || track.kind !== 'video' || track.hidden) return null
    const asset = assetOf(project, footage)
    if (!asset) return null
    const u = sourceToFrame(project, footage, asset, size, onset, taken.box)
    return u ? toFrame(u, size) : null
  }
  const under = captionSourceClip(project, onset)
  if (!under) return null
  const asset = assetOf(project, under)
  if (!asset) return null
  let all: UnitRect | null = null
  for (const b of subjectBoxesAt(project, under, asset, size, onset)) {
    if (!all) {
      all = { ...b }
      continue
    }
    const x = Math.min(all.x, b.x)
    const y = Math.min(all.y, b.y)
    const right = Math.max(all.x + all.width, b.x + b.width)
    const bottom = Math.max(all.y + all.height, b.y + b.height)
    all = { x, y, width: right - x, height: bottom - y }
  }
  return all ? toFrame(all, size) : null
}

/** The whole source, 0..1 of the upright file: what `sourceToFrame` maps to the card's box (§6.16). */
const WHOLE_SOURCE: UnitRect = Object.freeze({ x: 0, y: 0, width: 1, height: 1 }) as UnitRect

/**
 * A screen card's box (§6.16, "The card's box"): where the render already
 * shows the recording, the whole source mapped through `sourceToFrame` on the
 * recording clip (the fitted picture inside the clip's box; contain pads with
 * transparent bars, so the card floats over what is beneath), in pixels of
 * `size`, read at project frame `at`. Null when the recording is gone, not on
 * a visible video track, not on screen at `at`, or has no size: the card then
 * draws nothing.
 */
export function screenCardBox(project: Project, recordingId: string, at: number, size: { width: number; height: number }): Rect | null {
  const recording = project.clips.find((c) => c.id === recordingId)
  if (!recording || !shows(recording, at)) return null
  const track = project.tracks.find((t) => t.id === recording.trackId)
  if (!track || track.kind !== 'video' || track.hidden) return null
  const asset = assetOf(project, recording)
  if (!asset) return null
  const u = sourceToFrame(project, recording, asset, size, at, WHOLE_SOURCE)
  return u ? toFrame(u, size) : null
}

/** Whether a screen card other than `self` is on screen at project frame `at` (§6.9: its dim is then the only dim). */
function cardOnScreen(project: Project, self: Pick<Clip, 'start'> & { id?: string }, at: number): boolean {
  return project.clips.some((c) => c.graphic?.data.template === 'screen-card' && c.id !== self.id && shows(c, at))
}

/**
 * The targets for the graphic clip `clip` at project frame `frame`, in pixels
 * of `size` (§6.3). `subject` is evaluated once, at the clip's first frame,
 * `clip.start`, for every template, the callout included (§6.9 chose it
 * 2026-10-21), and that value is returned for every `frame` of the clip: so
 * a callout's target, a dim's hole and a connector's target are fixed at
 * onset and add no moving frame, whatever `frame` is. `onsetTargetsAt`
 * (drawList.ts) holds the same rule on the caller's side.
 *
 * Phase 3's two (§6.16; `tip` is phase 4's, §6.18):
 * - a screen card's `screen`: its box (`screenCardBox`) with `file: null`,
 *   which the renderer's `screenTargetsAt` fills per frame from the pull. The
 *   box is read at the card's first frame too, so it is the same on every
 *   frame (beyond §6.16's words, which give the box and say nothing of when):
 *   `sourceToFrame` models no animated transform (frameMap.ts), and a followed
 *   crop keeps its size, so the box does not move under a card the dock
 *   offers; read once, a 600 s card's hold costs no mapping per frame.
 * - every other graphic's `underCard`: true when a screen card is on screen
 *   at its first frame (§6.9), so its dim is not drawn.
 */
export function graphicTargetsAt(
  project: Project,
  clip: Pick<Clip, 'start'> & { id?: string },
  spec: Pick<GraphicSpec, 'subject'> & { data?: GraphicSpec['data'] },
  frame: number,
  size: { width: number; height: number }
): GraphicTargets {
  // §6.18's `tip` reads `frame`; the screen card's box is fixed at onset (above).
  void frame
  if (spec.data?.template === 'screen-card') {
    const box = screenCardBox(project, spec.data.clipId, clip.start, size)
    return { screen: box ? { box, file: null } : null }
  }
  const targets: GraphicTargets = { subject: subjectAt(project, spec, clip.start, size) }
  if (cardOnScreen(project, clip, clip.start)) targets.underCard = true
  return targets
}
