/**
 * Where a graphic sits (docs/CLIPS.md §6.9, its first half): which third of
 * the frame (`placeGraphic`), the subject it points at, taken once at onset
 * (`subjectAtOnset`), and the lane it sits on (`graphicLane`). The budget is
 * budget.ts's.
 *
 * Pure and node-runnable: it reads the project through the export's own
 * readers (Smart placement's `smartPlacement` and `samplesOver`, the subject
 * track's `shotSpans`, `sourceMsAt`, `nearestSample` and `sourceToFrame`),
 * never a second model of the captions, the crop or the fit. No clock, no
 * DOM, no `node:path`; the one track id `addTrack` mints is its own
 * (timeline.ts).
 */

import { smartPlacement } from '../captions/smart'
import { resolveStyle, type StyleOverrides } from '../captions/style'
import { COPY_RULE, DIRECTOR_RULES, ENDING_RULE } from '../director/apply'
import { nearestSample, shotSpans, sourceMsAt, sourceToFrame, subjectTrackOf } from '../reframe/frameMap'
import { OVERLAP_LIMIT, samplesOver, shotOverlap, styleThird, type Third } from '../reframe/freeSpace'
import type { UnitRect } from '../reframe/types'
import { hasKeys, valueAt } from '../render/keyframes'
import { addTrack, stackedSlot, trackLimitReached, type Clip, type Project } from '../timeline'
import type { GraphicSpec, GraphicTemplateId } from './template'

/** §6.9 step 3: the caption takes every third over the span, so nothing is left to place the graphic in. */
export const NO_FREE_THIRD_NOTE = 'no free third'

/** §6.7 rule 9's note, which §6.9 step 4 drops a callout with when its subject is missing at onset. */
export const NO_SUBJECT_NOTE = 'no subject found to point at'

/** §6.9 step 4: a callout over a camera move or a zoom, which `sourceToFrame` does not model. */
export const ZOOMS_UNDER_NOTE = 'the shot zooms under it, so its target would miss'

/** §6.9 "On the timeline": at the track limit, with no free lane above the footage and the cards. */
export const NO_LANE_NOTE = 'no free layer above the footage and the cards'

/** The footage clip a graphic is placed over is not in the project. */
export const NO_CLIP_NOTE = 'the clip it sits on is gone'

/**
 * §6.9 step 3's preference among free thirds, by template: `lower-third`
 * takes the bottom, then the top (never the middle); every other template,
 * `steps` (any connector) and `bars` included, the middle, the top, then the
 * bottom.
 */
export function thirdPreference(template: GraphicTemplateId): readonly Third[] {
  return template === 'lower-third' ? ['bottom', 'top'] : ['middle', 'top', 'bottom']
}

/**
 * §6.9 step 1: the thirds the captions take over project frames
 * [startFrame, startFrame + frames). Captions off: none. Smart placement on:
 * every third its lookup (`smartPlacement`, the one reader of
 * `project.captions.placement`, over `captionThirds`) gives on a frame of the
 * span; a frame no caption clip covers gives none. Otherwise the style's own
 * third (`styleThird`).
 */
export function captionThirdsOver(
  project: Project,
  startFrame: number,
  frames: number,
  canvas: { width: number; height: number }
): Set<Third> {
  const out = new Set<Third>()
  if (!project.captions?.enabled) return out
  const style = resolveStyle(project.captions.styleId, project.captions.overrides as StyleOverrides | undefined)
  const lookup = smartPlacement(project, style, canvas)
  if (!lookup) {
    out.add(styleThird(style))
    return out
  }
  for (let f = startFrame; f < startFrame + frames; f++) {
    const t = lookup(f)
    if (t) out.add(t)
  }
  return out
}

/**
 * The third a graphic takes (docs/CLIPS.md §6.9 steps 1-3), over the footage
 * clip `clipId` for project frames [startFrame, startFrame + frames) on the
 * output frame `canvas`; null is "no free third" (`NO_FREE_THIRD_NOTE`), and
 * the caller drops the graphic. Null too when the clip is not in the project
 * (`NO_CLIP_NOTE`).
 *
 * 1. The captions' thirds over the span are excluded (`captionThirdsOver`).
 * 2. The subject's overlap per third is the 90th percentile (`shotOverlap`)
 *    of `samplesOver` on the clip's frames of the span.
 * 3. Among the template's thirds (`thirdPreference`) not excluded, the first
 *    free one (overlap at most `OVERLAP_LIMIT`); else the least covered, a
 *    tie going to the earlier preferred; none remaining, null.
 *
 * With no subject track, or no sample near the span, every remaining third
 * reads 0 and so is free: the template's first remaining third. For every
 * template but the lower third that is §6.9's no-track default, the middle,
 * or the top when the captions use the middle; a lower third keeps its own
 * preference, the bottom, or the top when the captions use the bottom.
 */
export function placeGraphic(
  project: Project,
  clipId: string,
  startFrame: number,
  frames: number,
  template: GraphicTemplateId,
  canvas: { width: number; height: number }
): GraphicSpec['place'] | null {
  const clip = project.clips.find((c) => c.id === clipId)
  if (!clip) return null
  const excluded = captionThirdsOver(project, startFrame, frames, canvas)
  const remaining = thirdPreference(template).filter((t) => !excluded.has(t))
  if (remaining.length === 0) return null
  const asset = project.assets.find((a) => a.id === clip.assetId)
  const from = startFrame - clip.start
  const overlap = asset ? shotOverlap(samplesOver(project, clip, asset, canvas, from, from + frames)) : { top: 0, middle: 0, bottom: 0 }
  const free = remaining.find((t) => !(overlap[t] > OVERLAP_LIMIT))
  if (free) return { auto: true, third: free }
  let best = remaining[0]
  for (const t of remaining) if (overlap[t] < overlap[best]) best = t
  return { auto: true, third: best }
}

/**
 * True when the footage clip moves its picture under a graphic over clip
 * frames [from, to): a `motion` (Ken Burns, a shake), or a zoom the export
 * applies (two keys or more, render/plan.ts `zoomKeyframeFilter`) whose value
 * is other than 1 on any frame of the span (`valueAt`, the export's curve).
 * A held zoom of 1 is no zoom.
 */
function zoomsUnder(clip: Clip, from: number, to: number): boolean {
  if (clip.motion) return true
  const keys = clip.keyframes?.zoom
  if (!keys || !hasKeys(clip.keyframes, 'zoom')) return false
  for (let k = from; k < to; k++) if (valueAt(keys, k, clip.duration, 1) !== 1) return true
  return false
}

const usable = (b: UnitRect | null | undefined): b is UnitRect =>
  !!b && [b.x, b.y, b.width, b.height].every((v) => typeof v === 'number' && Number.isFinite(v)) && b.width > 0 && b.height > 0

/**
 * The subject at onset (docs/CLIPS.md §6.9 step 4), taken ONCE on the
 * graphic's first frame `startFrame` (a project frame) over the footage clip
 * `clipId`: the sample `subjectBoxesAt` reads on that frame (the shot the
 * export shows there, `sourceMsAt`, `nearestSample` within reach), its
 * largest face by area, in SOURCE units, WITHOUT the chin extension, and
 * that sample's ms. `graphicTargetsAt` (targets.ts) maps exactly this box
 * through `sourceToFrame` at the graphic clip's first frame.
 *
 * - `{ subject }` with the box, or `{ subject: null }` for a template that
 *   then draws its dim without a hole;
 * - `{ dropped }` only for a `callout`: `ZOOMS_UNDER_NOTE` when the clip
 *   carries a `motion` or a zoom other than 1 anywhere over
 *   [startFrame, startFrame + frames) (the subject is then not taken for any
 *   template); `NO_SUBJECT_NOTE` when there is no subject track, no sample
 *   near the onset, no usable face, or the face maps to null there (off
 *   screen); `NO_CLIP_NOTE` when the clip is gone.
 */
export function subjectAtOnset(
  project: Project,
  clipId: string,
  startFrame: number,
  frames: number,
  template: GraphicTemplateId,
  canvas: { width: number; height: number }
): { subject: NonNullable<GraphicSpec['subject']> | null } | { dropped: string } {
  const callout = template === 'callout'
  const none = (note: string): { subject: null } | { dropped: string } => (callout ? { dropped: note } : { subject: null })
  const clip = project.clips.find((c) => c.id === clipId)
  if (!clip) return none(NO_CLIP_NOTE)
  const k = startFrame - clip.start
  if (zoomsUnder(clip, k, k + frames)) return none(ZOOMS_UNDER_NOTE)
  const asset = project.assets.find((a) => a.id === clip.assetId)
  const track = asset ? subjectTrackOf(project, clip, asset) : null
  if (!asset || !track || !(k >= 0 && k < clip.duration)) return none(NO_SUBJECT_NOTE)
  const span = shotSpans(project, clip, track, canvas).find((s) => k >= s.from && k < s.to)
  const ms = span ? sourceMsAt(clip, project.settings.fps, k) : null
  const sample = span && ms !== null ? nearestSample(track, span.index, ms) : null
  let face: UnitRect | null = null
  for (const f of sample?.faces ?? []) {
    if (usable(f) && (!face || f.width * f.height > face.width * face.height)) face = f
  }
  if (!sample || !face) return none(NO_SUBJECT_NOTE)
  const box: UnitRect = { x: face.x, y: face.y, width: face.width, height: face.height }
  if (!sourceToFrame(project, clip, asset, canvas, startFrame, box)) return none(NO_SUBJECT_NOTE)
  return { subject: { clipId, box, ms: sample.ms } }
}

/**
 * The lane a graphic sits on (docs/CLIPS.md §6.9 "On the timeline"), over
 * the footage clip `clipId` for project frames [startFrame, startFrame +
 * frames), for a run of rule `rule`.
 *
 * The starting lane is the lowest video track above both the footage clip's
 * track and every track holding an adjustment clip (the look, a grade of
 * yours), a moment, or a Director card (`COPY_RULE`, `ENDING_RULE`), anywhere
 * on the timeline: director/apply2.ts `cardsAbove`'s rule, widened to cards
 * and adjustments. From there the first lane free over the span
 * (`stackedSlot`, which skips a locked track); else a new top track
 * (`addTrack`). A track this adds — the starting lane when there is none
 * above, or the new top — is marked `director: true` when the rule is one of
 * `DIRECTOR_RULES` (Direct's, so its Clear takes the track when empty) and is
 * not marked for any other (Clip it's, `'clips.graphic'`). At the track
 * limit (`trackLimitReached`) the graphic is dropped with `NO_LANE_NOTE`.
 *
 * The project comes back new when a track was added and as the same object
 * when not; the input is never edited.
 */
export function graphicLane(
  project: Project,
  clipId: string,
  startFrame: number,
  frames: number,
  rule: string
): { project: Project; trackId: string } | { dropped: string } {
  const footage = project.clips.find((c) => c.id === clipId)
  if (!footage) return { dropped: NO_CLIP_NOTE }
  let next = project
  const lanes = (): Project['tracks'] => next.tracks.filter((t) => t.kind === 'video')
  const indexOf = (trackId: string): number => lanes().findIndex((t) => t.id === trackId)
  const under = next.clips
    .filter((c) => c.adjustment || c.moment || c.generatedBy?.rule === COPY_RULE || c.generatedBy?.rule === ENDING_RULE)
    .map((c) => indexOf(c.trackId))
  const top = Math.max(indexOf(footage.trackId), ...under)
  const addTop = (): string | null => {
    if (trackLimitReached(next)) return null
    next = addTrack(next, 'video', 'top')
    const added = lanes()[lanes().length - 1]
    if (DIRECTOR_RULES.includes(rule)) {
      next = { ...next, tracks: next.tracks.map((t) => (t.id === added.id ? { ...t, director: true as const } : t)) }
    }
    return added.id
  }
  const from = lanes()[top + 1]?.id ?? addTop()
  if (!from) return { dropped: NO_LANE_NOTE }
  let slot = stackedSlot(next, from, startFrame, frames)
  if (!slot) {
    if (!addTop()) return { dropped: NO_LANE_NOTE }
    slot = stackedSlot(next, from, startFrame, frames)
  }
  if (!slot) return { dropped: NO_LANE_NOTE }
  return { project: next, trackId: slot.trackId }
}
