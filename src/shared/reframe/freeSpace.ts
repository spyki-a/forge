import { exportFrameAt } from './keys'
import { facesOnFrame, nearestSample, shotSpans, sourceMsAt, subjectTrackOf, type ShotSpan } from './frameMap'
import type { SubjectTrack, UnitRect } from './types'
import { captionTrack } from '../captions/timeline'
import type { CaptionStyle } from '../captions/style'
import { assetById, clipsOnTrack, type Clip, type MediaAsset, type Project } from '../timeline'

/**
 * Which third of the frame the captions take (docs/CLIPS.md §5.2): the
 * style's own, unless the subject is in it.
 *
 * **One choice per shot**, stable within it. For every shot a caption clip
 * shows, each sample of the shot that the clip shows is put on the frame the
 * export shows it on (`exportFrameAt`), its faces extended downward and
 * mapped onto the output frame there (frameMap.ts), and the share of each
 * third they cover is taken (`overlapByThird`). Over the shot's samples each
 * third's overlap is read at the `PERCENTILE`-th percentile, so a gesture in
 * one sample in ten does not move the caption — and in a shot of three to
 * nine samples (1.5 s to under 5 s) the highest is never taken alone, so one
 * gesture does not move it there either (`MIN_SAMPLES_TO_DISCOUNT`). Then:
 *
 * 1. the style's own third stands unless its overlap exceeds `OVERLAP_LIMIT`;
 * 2. if it does, the third with the least overlap is taken, provided it is at
 *    least `BETTER_BY` better — its overlap at most half the style third's —
 *    and otherwise the style's stands: that margin is the hysteresis;
 * 3. a shot with no track (a clip without one, a photo, a shot no sample
 *    reaches) keeps the style's;
 * 4. a line that spans a cut takes the shot where it starts: the answer is
 *    by shot span, and the caller looks a line's START frame up in it
 *    (`thirdAt`).
 *
 * Thirds only in v1 (§16.6). Burned-in text (§5.3, Florence's OCR) is not
 * read: 1g is not built.
 */

export type Third = 'top' | 'middle' | 'bottom'

/** Rule 1: the style's third stands while the subject covers no more than this share of it. */
export const OVERLAP_LIMIT = 0.05
/** Rule 2's hysteresis: another third is taken only when its overlap is at most this share of the style third's. */
export const BETTER_BY = 0.5
/** Each third's overlap over a shot's samples is read at this percentile (nearest rank): one sample in ten can be a gesture. */
export const PERCENTILE = 0.9

export { CHIN_EXTENSION } from './frameMap'

const THIRDS: readonly Third[] = ['top', 'middle', 'bottom']
const BANDS: Record<Third, [number, number]> = { top: [0, 1 / 3], middle: [1 / 3, 2 / 3], bottom: [2 / 3, 1] }

/** A caption style's own third: bottom is the lower third, center the middle. */
export function styleThird(style: Pick<CaptionStyle, 'position'>): Third {
  return style.position === 'top' ? 'top' : style.position === 'center' ? 'middle' : 'bottom'
}

/**
 * The area of the union of `boxes` inside the band y ∈ [y0, y1] of the unit
 * frame, computed exactly: the boxes are cut to the band, the x axis is cut
 * at every box edge, and in each strip the boxes spanning it have their y
 * intervals merged — so two faces that overlap are counted once.
 */
function unionArea(boxes: UnitRect[], y0: number, y1: number): number {
  const rects = boxes
    .map((b) => ({ x0: Math.max(0, b.x), x1: Math.min(1, b.x + b.width), y0: Math.max(y0, b.y), y1: Math.min(y1, b.y + b.height) }))
    .filter((r) => r.x1 > r.x0 && r.y1 > r.y0)
  if (rects.length === 0) return 0
  const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b)
  let area = 0
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i]
    const b = xs[i + 1]
    const spans = rects
      .filter((r) => r.x0 <= a && r.x1 >= b)
      .map((r) => [r.y0, r.y1] as const)
      .sort((p, q) => p[0] - q[0])
    let covered = 0
    let from = -Infinity
    let to = -Infinity
    for (const [s, e] of spans) {
      if (s > to) {
        if (to > from) covered += to - from
        from = s
        to = e
      } else if (e > to) to = e
    }
    if (to > from) covered += to - from
    area += (b - a) * covered
  }
  return area
}

/**
 * The share of each horizontal third of the frame, by area, that the boxes
 * cover — their UNION, so two faces side by side or overlapping are not
 * counted twice. Boxes are in unit coordinates of the output frame.
 */
export function overlapByThird(frameBoxes: UnitRect[]): Record<Third, number> {
  const out = { top: 0, middle: 0, bottom: 0 } as Record<Third, number>
  for (const t of THIRDS) {
    const [y0, y1] = BANDS[t]
    out[t] = Math.min(1, unionArea(frameBoxes, y0, y1) / (y1 - y0))
  }
  return out
}

/**
 * A shot of this many samples or more never has its overlap decided by its
 * highest sample alone. Below ten samples the nearest rank of the 90th
 * percentile IS the highest, so without this a single gesture moved the
 * caption in every shot under 5 s (two samples a second) — short shots being
 * the norm in a short-form edit. One or two samples say too little to call
 * one a gesture: there the higher stands, and the caption keeps off it.
 */
export const MIN_SAMPLES_TO_DISCOUNT = 3

/**
 * The `p`-th percentile of `values` by nearest rank — the smallest value at
 * least that share of them are at or below — but from
 * `MIN_SAMPLES_TO_DISCOUNT` samples on never the highest alone: the
 * second-highest when the rank would be the top (any count from 3 to 9 at
 * 0.9). From ten samples on the rank is below the top anyway.
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const rank = Math.min(n, Math.max(1, Math.ceil(p * n - 1e-9)))
  return sorted[(n >= MIN_SAMPLES_TO_DISCOUNT ? Math.min(rank, n - 1) : rank) - 1]
}

/** Each third's overlap over a shot's samples, at `PERCENTILE` (never the highest alone from `MIN_SAMPLES_TO_DISCOUNT` samples). */
export function shotOverlap(samples: Record<Third, number>[]): Record<Third, number> {
  const out = { top: 0, middle: 0, bottom: 0 } as Record<Third, number>
  for (const t of THIRDS) out[t] = percentile(samples.map((s) => s[t]), PERCENTILE)
  return out
}

/**
 * Rules 1 and 2 on one shot's overlap. Among the other two thirds a tie goes
 * to the one nearer the style's (the caption moves the least), and from the
 * middle to the bottom before the top.
 */
export function chooseThird(overlap: Record<Third, number>, own: Third): Third {
  const mine = overlap[own]
  if (!(mine > OVERLAP_LIMIT)) return own
  const others: Third[] = own === 'bottom' ? ['middle', 'top'] : own === 'top' ? ['middle', 'bottom'] : ['bottom', 'top']
  let best = others[0]
  for (const t of others) if (overlap[t] < overlap[best]) best = t
  return overlap[best] <= BETTER_BY * mine ? best : own
}

/** One span of the caption track and the third its lines take. Frames are PROJECT frames, [startFrame, endFrame). */
export interface CaptionThird {
  startFrame: number
  endFrame: number
  third: Third
}

/**
 * Each third's overlap on every sample of a shot that the clip shows: the
 * sample on the frame the export shows it on, held to the shot's own frames
 * (a sample within a frame before a cut rounds onto the cut's frame, as
 * exit.ts holds it). A shot the clip shows too briefly to hold a sample takes
 * the one nearest its middle frame, from the shot, within reach. Empty when
 * no sample reaches it.
 */
function spanSamples(
  project: Project,
  clip: Clip,
  asset: MediaAsset,
  canvas: { width: number; height: number },
  track: SubjectTrack,
  span: ShotSpan
): Record<Third, number>[] {
  const fps = project.settings.fps
  const shot = track.shots[span.index]
  const out: Record<Third, number>[] = []
  if (!clip.hold) {
    for (const sample of track.samples) {
      if (!Number.isFinite(sample.ms) || sample.ms < shot.startMs || sample.ms >= shot.endMs) continue
      const at = exportFrameAt(clip, fps, sample.ms)
      if (at === null || at < 0 || at >= clip.duration) continue
      const frame = Math.min(Math.max(at, span.from), span.to - 1)
      out.push(overlapByThird(facesOnFrame(project, clip, asset, canvas, clip.start + frame, sample.faces)))
    }
  }
  if (out.length > 0) return out
  const middle = Math.floor((span.from + span.to - 1) / 2)
  const ms = sourceMsAt(clip, fps, middle)
  const near = ms === null ? null : nearestSample(track, span.index, ms)
  return near ? [overlapByThird(facesOnFrame(project, clip, asset, canvas, clip.start + middle, near.faces))] : []
}

/**
 * The third the captions take over the caption track (`captionTrack`, the
 * track the export captions from), one entry per span of a clip's shot, in
 * order — §5.2's rules (the module note). A clip with no subject track is
 * one span at the style's third. Gaps between clips have no entry.
 */
export function captionThirds(project: Project, style: Pick<CaptionStyle, 'position'>, canvas: { width: number; height: number }): CaptionThird[] {
  const own = styleThird(style)
  const track = captionTrack(project)
  if (!track) return []
  const out: CaptionThird[] = []
  for (const clip of clipsOnTrack(project, track.id)) {
    if (!(clip.duration > 0)) continue
    const whole: CaptionThird = { startFrame: clip.start, endFrame: clip.start + clip.duration, third: own }
    const asset = assetById(project, clip.assetId)
    const subject = asset ? subjectTrackOf(project, clip, asset) : null
    const spans = asset && subject ? shotSpans(project, clip, subject, canvas) : []
    if (!asset || !subject || spans.length === 0) {
      out.push(whole)
      continue
    }
    for (const span of spans) {
      const samples = spanSamples(project, clip, asset, canvas, subject, span)
      out.push({
        startFrame: clip.start + span.from,
        endFrame: clip.start + span.to,
        third: samples.length === 0 ? own : chooseThird(shotOverlap(samples), own)
      })
    }
  }
  return out
}

/** The third for a line starting on project frame `frame` (rule 4: the shot where it starts), or null where no span covers it. */
export function thirdAt(thirds: readonly CaptionThird[], frame: number): Third | null {
  for (const t of thirds) if (frame >= t.startFrame && frame < t.endFrame) return t.third
  return null
}
