import { exportFrameAt, followKeys, type ExactTime } from './keys'
import { SUBJECT_TRACK_VERSION, type FaceBox, type SubjectSample, type SubjectTrack, type UnitRect } from './types'
import { cropAt } from '../render/crop'
import { clipBox, fitFor, followCanvas } from '../render/plan'
import { MAX_SPEED, RAMP_MAX } from '../render/speed'
import type { Clip, CropRect, MediaAsset, Project } from '../timeline'

/**
 * Where the subject is on the OUTPUT frame (docs/CLIPS.md §5.1) — the half of
 * caption free space that knows nothing of captions.
 *
 * A subject track's faces are in the SOURCE: normalised 0..1 against the
 * upright file, sampled twice a second, in source ms (types.ts). A caption is
 * drawn on the OUTPUT frame. Between the two are the crop the export cuts
 * that frame with and the clip's fit into the canvas, and both are read here
 * from the export's own readers, never a second model of either:
 *
 * - the crop: `cropAt` (render/crop.ts), THE reader — a followed clip's
 *   compiled keys at the export's rounding, or the stored crop as the
 *   export's clamped expressions make it. On a frame showing a stacked
 *   two-up it gives both halves, and a box goes through the half that holds
 *   it into that half's own half of the stack (§4.6 rule 3), which is what
 *   the export's `vstack` puts there. The project handed to it carries the
 *   canvas the caller asks about (`followCanvas`), as the export compiles
 *   the followed crop for its own canvas;
 * - the fit: the clip's box (`clipBox`) and its fit (`fitFor`, so a crop
 *   within 1 % of the box's shape fills it), as the export's `fitFilter`
 *   scales and pads (contain) or scales and centre-cuts (cover), and as the
 *   moments' `shotPicture` lands a cropped picture in a box.
 *
 * Not modelled: a clip's rotation, its animated transform and a camera move
 * (Ken Burns, zoom keys) on top of the crop — footage that follows its
 * subject has none of them by default. The mapping is continuous: the
 * export's scale rounds its picture to whole pixels, which is a pixel of a
 * 1920-tall frame at most.
 */

/** The faces are extended downward by this share of their own height, so the chin and the mouth count too (§5.1). */
export const CHIN_EXTENSION = 0.5

/** A frame takes the sample nearest its source time, if one is this near, in source ms — the track samples twice a second (§4.3). */
export const SAMPLE_REACH_MS = 500

/** Four finite numbers and a size: a face path.ts would read (its `usable`). */
function usable(b: UnitRect | null | undefined): b is UnitRect {
  return !!b && [b.x, b.y, b.width, b.height].every((v) => typeof v === 'number' && Number.isFinite(v)) && b.width > 0 && b.height > 0
}

/** The overlap of two rectangles, or null when they share no area. */
function intersect(a: CropRect, b: CropRect): CropRect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

const holds = (r: CropRect, x: number, y: number): boolean => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height

/**
 * Which half of a stacked two-up a source box (px) is in: the half holding
 * its centre; when both hold it (the halves overlap in the source) or
 * neither does, the half it touches whose centre is nearer its own. Null
 * when it touches neither.
 */
function halfOf(halves: { top: CropRect; bottom: CropRect }, box: CropRect): 'top' | 'bottom' | null {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const inTop = holds(halves.top, cx, cy)
  const inBottom = holds(halves.bottom, cx, cy)
  if (inTop !== inBottom) return inTop ? 'top' : 'bottom'
  const near = (r: CropRect): number => Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy)
  const touching = (['top', 'bottom'] as const).filter((h) => intersect(halves[h], box) !== null)
  if (touching.length === 0) return null
  return touching.reduce((a, b) => (near(halves[b]) < near(halves[a]) ? b : a))
}

/**
 * A SOURCE-normalised box (0..1 of the upright file) as it lands on the
 * OUTPUT frame on project frame `frame`: in unit coordinates of `canvas`
 * (0..1 of its width and height), clipped to what the frame shows — the
 * crop's edges (on a two-up, its half's), the clip's box, the canvas. Null
 * when none of it is on screen: the box is wholly outside the crop (or its
 * half), or the fit cuts it away.
 */
export function sourceToFrame(
  project: Project,
  clip: Clip,
  asset: Pick<MediaAsset, 'width' | 'height'>,
  canvas: { width: number; height: number },
  frame: number,
  box: UnitRect
): UnitRect | null {
  const W = asset.width ?? 0
  const H = asset.height ?? 0
  if (!(W > 0 && H > 0 && canvas.width > 0 && canvas.height > 0) || !usable(box)) return null
  const on = cropAt(followCanvas(project, canvas), clip, { width: W, height: H }, frame - clip.start)
  const px: CropRect = { x: box.x * W, y: box.y * H, width: box.width * W, height: box.height * H }

  // The piece of the source the box is in, and where that piece sits in the stream the fit receives.
  let piece = on.crop
  let below = 0
  let stream = { width: on.crop.width, height: on.crop.height }
  if (on.halves) {
    const half = halfOf(on.halves, px)
    if (!half) return null
    piece = on.halves[half]
    // vstack: the top half over the bottom one, each its own size.
    below = half === 'top' ? 0 : on.halves.top.height
    stream = { width: Math.max(on.halves.top.width, on.halves.bottom.width), height: on.halves.top.height + on.halves.bottom.height }
  }
  const seen = intersect(px, piece)
  if (!seen || !(stream.width > 0 && stream.height > 0)) return null

  // The clip's box on the canvas, and the stream fitted into it (plan.ts fitFilter).
  const b = clipBox(clip, canvas)
  const fit = fitFor(b, stream)
  const scale = fit === 'cover' ? Math.max(b.width / stream.width, b.height / stream.height) : Math.min(b.width / stream.width, b.height / stream.height)
  const left = b.x + (b.width - stream.width * scale) / 2
  const top = b.y + (b.height - stream.height * scale) / 2
  const out: CropRect = {
    x: left + (seen.x - piece.x) * scale,
    y: top + (seen.y - piece.y + below) * scale,
    width: seen.width * scale,
    height: seen.height * scale
  }
  // Cover cuts the overflow at the box; the canvas cuts whatever hangs off it.
  const inBox = fit === 'cover' ? intersect(out, { x: b.x, y: b.y, width: b.width, height: b.height }) : out
  const shown = inBox && intersect(inBox, { x: 0, y: 0, width: canvas.width, height: canvas.height })
  if (!shown) return null
  return { x: shown.x / canvas.width, y: shown.y / canvas.height, width: shown.width / canvas.width, height: shown.height / canvas.height }
}

/* ----------------------------------------------------- the clip's shots */

/**
 * The file's subject track as this clip may read it: present, of today's
 * version, measured on a video of the asset's own size — keys.ts
 * `followKeys`' own refusals, so a clip that could not follow its subject
 * does not place captions by it either.
 */
export function subjectTrackOf(project: Project, clip: Clip, asset: Pick<MediaAsset, 'kind' | 'width' | 'height'>): SubjectTrack | null {
  if (asset.kind !== 'video') return null
  const track = project.subjects?.[clip.assetId]
  if (!track || track.version !== SUBJECT_TRACK_VERSION) return null
  if (asset.width !== track.width || asset.height !== track.height) return null
  return track
}

/** A track shot as the clip shows it: clip frames [from, to). */
export interface ShotSpan {
  /** The shot's index in the track. */
  index: number
  from: number
  to: number
}

/** A cut's exact time when the track kept it (keys.ts `exactOf`): its integer pts on a whole, positive time base. */
function exactCut(track: SubjectTrack, index: number): ExactTime | undefined {
  const tb = track.timeBase
  const pts = track.shots[index]?.startPts
  if (!tb || !Number.isSafeInteger(tb.num) || !Number.isSafeInteger(tb.den) || tb.num <= 0 || tb.den <= 0) return undefined
  return typeof pts === 'number' && Number.isSafeInteger(pts) ? { pts, timeBase: { num: tb.num, den: tb.den } } : undefined
}

/**
 * The track's shots on the clip's own frames, in order — each from its cut's
 * EXPORT frame (`exportFrameAt`, on the cut's exact pts when the track kept
 * it) to the next one's, cut to the clip. A followed clip's are its compiled
 * keys' own (`followKeys(...).shots`), the frames its crop steps on, so a
 * face is never read through the crop of the shot beside it. A held frame is
 * one shot for its whole length: the one its frame is in.
 */
export function shotSpans(project: Project, clip: Clip, track: SubjectTrack, canvas: { width: number; height: number }): ShotSpan[] {
  const fps = project.settings.fps
  const D = clip.duration
  if (!(fps > 0) || !(D > 0) || track.shots.length === 0) return []
  const keys = followKeys(followCanvas(project, canvas), clip, fps)
  if (keys) return keys.shots.map((s) => ({ index: s.index, from: s.from, to: s.to }))
  if (clip.hold) {
    // keys.ts compile's own choice for a hold: the last cut the clip's first frame is at or past.
    const asIfPlaying = { ...clip, hold: undefined, speed: undefined, ramp: undefined }
    let index = 0
    track.shots.forEach((s, i) => {
      if (i > 0 && (exportFrameAt(asIfPlaying, fps, s.startMs, exactCut(track, i)) ?? 1) <= 0) index = i
    })
    return [{ index, from: 0, to: D }]
  }
  const slots = track.shots.map((s, i) => (i === 0 ? -Infinity : (exportFrameAt(clip, fps, s.startMs, exactCut(track, i)) as number)))
  const spans: ShotSpan[] = []
  track.shots.forEach((_, i) => {
    const from = Math.max(0, slots[i])
    const to = Math.min(D, i + 1 < slots.length ? slots[i + 1] : Infinity)
    if (from < to) spans.push({ index: i, from, to })
  })
  return spans
}

/**
 * The SOURCE ms the export shows on clip frame `k`: the middle of the source
 * interval `exportFrameAt` puts on that frame — the export's own map
 * (in-point seek, `setpts`, `fps=`'s half-up rounding; a ramp on the clock a
 * followed clip ramps on), inverted by bisection rather than written again.
 * A held frame shows its in-point. Not the preview's `sourceFrameAt`, which
 * rounds the source position half up where the export at 0.5× shows source
 * frame floor(n/2) (keys.ts's note); an UNfollowed ramp's export runs on
 * `T-STARTT` (plan.ts `followedRetime`), up to a source frame from this —
 * a frame against samples 500 ms apart.
 */
export function sourceMsAt(clip: Clip, fps: number, k: number): number | null {
  if (!(fps > 0)) return null
  const inMs = (clip.inPoint * 1000) / fps
  if (clip.hold) return inMs
  // Outside a ramp's domain its log is NaN: before the in-point that is before every frame, after it past every one.
  const frameOf = (ms: number): number => {
    const f = exportFrameAt(clip, fps, ms)
    return f === null || Number.isNaN(f) ? (ms < inMs ? -Infinity : Infinity) : f
  }
  // The first ms whose frame is at or past `target`; the bracket holds the clip's footage at the fastest rate there is, and then some.
  const fastest = Math.max(MAX_SPEED, RAMP_MAX)
  const firstAt = (target: number): number => {
    let lo = inMs - 2000
    let hi = inMs + 2000 + (fastest * (clip.duration + 2) * 1000) / fps
    for (let i = 0; i < 64; i++) {
      const mid = (lo + hi) / 2
      if (frameOf(mid) < target) lo = mid
      else hi = mid
    }
    return hi
  }
  return (firstAt(k) + firstAt(k + 1)) / 2
}

/** The shot's sample nearest `ms`, within `SAMPLE_REACH_MS` — only its own: a sample across the cut is another picture. */
export function nearestSample(track: SubjectTrack, index: number, ms: number): SubjectSample | null {
  const shot = track.shots[index]
  if (!shot || !Number.isFinite(ms)) return null
  let best: SubjectSample | null = null
  for (const s of track.samples) {
    if (!Number.isFinite(s.ms) || s.ms < shot.startMs || s.ms >= shot.endMs) continue
    const d = Math.abs(s.ms - ms)
    if (d <= SAMPLE_REACH_MS && (!best || d < Math.abs(best.ms - ms))) best = s
  }
  return best
}

/** A face with its chin and mouth: the same box, `CHIN_EXTENSION` of its height longer downward. */
export function extendDown(face: UnitRect): UnitRect {
  return { x: face.x, y: face.y, width: face.width, height: face.height * (1 + CHIN_EXTENSION) }
}

/** A sample's faces, each extended downward, on the output frame at project frame `frame`; the ones off screen dropped. */
export function facesOnFrame(
  project: Project,
  clip: Clip,
  asset: Pick<MediaAsset, 'width' | 'height'>,
  canvas: { width: number; height: number },
  frame: number,
  faces: readonly FaceBox[] | null | undefined
): UnitRect[] {
  return (faces ?? [])
    .filter(usable)
    .map((f) => sourceToFrame(project, clip, asset, canvas, frame, extendDown(f)))
    .filter((r): r is UnitRect => r !== null)
}

/**
 * The subject's boxes on the output frame at project frame `frame`: the
 * faces of the track's sample nearest the frame's source time (`sourceMsAt`)
 * within `SAMPLE_REACH_MS`, from the shot the export shows on that frame,
 * each extended downward by `CHIN_EXTENSION` of its height and mapped
 * through `sourceToFrame`. Empty for a frame the clip does not show, a clip
 * with no track, or no sample near enough.
 */
export function subjectBoxesAt(
  project: Project,
  clip: Clip,
  asset: Pick<MediaAsset, 'kind' | 'width' | 'height'>,
  canvas: { width: number; height: number },
  frame: number
): UnitRect[] {
  const track = subjectTrackOf(project, clip, asset)
  if (!track) return []
  const k = Math.round(frame - clip.start)
  if (!(k >= 0 && k < clip.duration)) return []
  const span = shotSpans(project, clip, track, canvas).find((s) => k >= s.from && k < s.to)
  if (!span) return []
  const ms = sourceMsAt(clip, project.settings.fps, k)
  const sample = ms === null ? null : nearestSample(track, span.index, ms)
  return sample ? facesOnFrame(project, clip, asset, canvas, frame, sample.faces) : []
}
