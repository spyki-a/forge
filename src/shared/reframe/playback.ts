import { exportFrameAt, type FollowKeys, type FollowShot, type RetimedClip } from './keys'
import type { Clip, CropRect } from '../timeline'

/**
 * Which frame of a followed clip the PREVIEW reads its crop at, and what a
 * drag on the preview's crop writes (docs/CLIPS.md §4.7, slice B).
 *
 * The crop is `cropAt(project, clip, source, clipFrame)` (render/crop.ts),
 * and `clipFrame` is the clip's OWN frame, counted from its first — the frame
 * the export's keys are compiled on. Two ways to know it:
 *
 * - **Paused or scrubbing**, it is the playhead's frame of the clip,
 *   `playhead − clip.start`. That is the export's frame at that playhead, so
 *   the crop on screen is the crop in the file there.
 * - **Playing**, the `<video>` element runs on its own clock and may be up to
 *   `DRIFT_TOLERANCE` (0.18 s, about five frames) from the playhead before the
 *   preview re-seeks it. A cut must change the crop on the frame the element
 *   SHOWS, or the new shot plays a few frames under the old shot's crop. So
 *   the frame comes from the element's presented media time
 *   (`requestVideoFrameCallback`'s `mediaTime`, else `currentTime`) through
 *   `exportFrameAt` — the clip frame on which the export first shows that
 *   source moment, which is where the cut's held key sits.
 *
 * Never through `sourceFrameFor` or `timelineFrameAt`: those are the
 * preview's own rounding of the source position, half up, while the export
 * at 0.5× shows source frame floor(n/2). Read through them, the crop changed
 * a frame BEFORE the export's key (measured, keys.ts' module note: one frame
 * early on every cut at 0.5×).
 *
 * Pure, so the mapping is tested without a canvas (tests/reframePlayback.test.ts).
 */

type PlayedClip = RetimedClip & Pick<Clip, 'start'>

/** Clamped into the clip: frames [0, duration). */
function inside(clip: Pick<Clip, 'duration'>, frame: number): number {
  return Math.max(0, Math.min(Math.max(0, clip.duration - 1), Math.round(frame)))
}

/** The playhead's frame of the clip — what a paused preview reads the crop at. */
export function clipFrameAtPlayhead(clip: Pick<Clip, 'start' | 'duration'>, playhead: number): number {
  return inside(clip, playhead - clip.start)
}

/**
 * The clip frame showing the source moment a playing element presents
 * (`mediaTimeS`, seconds of the file): the export's frame for it. Null for a
 * hold, which shows one frame and has no map, and for a time that is not a
 * number.
 */
export function clipFrameForMediaTime(clip: RetimedClip, fps: number, mediaTimeS: number): number | null {
  if (!Number.isFinite(mediaTimeS)) return null
  const frame = exportFrameAt(clip, fps, mediaTimeS * 1000)
  return frame === null ? null : inside(clip, frame)
}

/**
 * The frame the preview reads a clip's crop at: the element's when it is
 * playing and its presented time is known, the playhead's otherwise.
 */
export function previewClipFrame(clip: PlayedClip, fps: number, playhead: number, mediaTimeS: number | null): number {
  if (mediaTimeS !== null) {
    const played = clipFrameForMediaTime(clip, fps, mediaTimeS)
    if (played !== null) return played
  }
  return clipFrameAtPlayhead(clip, playhead)
}

/* ------------------------------------------------------------------ drags */

/** The shot a clip frame shows — what a drag on the preview moves. Shots tile the clip, [from, to). */
export function followShotAt(keys: Pick<FollowKeys, 'shots'>, frame: number): FollowShot | null {
  const shots = keys.shots
  if (shots.length === 0) return null
  return shots.find((s) => frame >= s.from && frame < s.to) ?? (frame < shots[0].from ? shots[0] : shots[shots.length - 1])
}

/** A point in SOURCE pixels inside a rectangle. */
function contains(rect: CropRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
}

/**
 * Which half of a stacked two-up a drag on the SOURCE outline starts in: the
 * rectangle under the pointer (SOURCE px). The two can overlap — two faces
 * just too far apart for one crop sit in halves a few pixels into each other —
 * and there the nearer centre wins. Null outside both.
 */
export function halfUnderPointer(halves: { top: CropRect; bottom: CropRect }, x: number, y: number): 'top' | 'bottom' | null {
  const inTop = contains(halves.top, x, y)
  const inBottom = contains(halves.bottom, x, y)
  if (inTop && inBottom) {
    const d = (r: CropRect): number => Math.hypot(x - (r.x + r.width / 2), y - (r.y + r.height / 2))
    return d(halves.top) <= d(halves.bottom) ? 'top' : 'bottom'
  }
  return inTop ? 'top' : inBottom ? 'bottom' : null
}

/**
 * Which half a drag on the OUTPUT starts in: the stack puts the top half over
 * the bottom one, so the upper half of the clip's picture is `top`.
 * `share` is the pointer's height down the picture, 0..1.
 */
export function halfAtOutput(share: number): 'top' | 'bottom' {
  return share < 0.5 ? 'top' : 'bottom'
}

/**
 * SOURCE pixels per screen pixel for a drag on the OUTPUT picture of a
 * followed clip — negative: **on the Output the picture follows the pointer**
 * (you grab the picture, as the Output's own drags move a clip), so the crop
 * moves the other way. On the Source outline the rectangle IS the crop and
 * follows the pointer (+1 / the view's scale). Decided 2026-10-14 (slice B's
 * fix phase, docs/CLIPS.md §4.7): as first built, +40 px dragged in the
 * two-up's lower half on the Output moved the bottom crop +40 source px, and
 * the picture inside it slid against the pointer.
 *
 * `cropWidth` is the drawn crop's (a two-up half's on a stacked frame: the
 * stack fills the frame at the canvas's shape), `frameWidth` the Output
 * frame's on screen.
 */
export function outputDragScale(cropWidth: number, frameWidth: number): number {
  return frameWidth > 0 && cropWidth > 0 ? -cropWidth / frameWidth : -1
}

/**
 * A drag's total, as the share `dragFollowOffset` SETS: where the shot's
 * offset was when the drag started, plus how far the pointer has moved, as a
 * share of the length it is measured in (the crop's free axis for one crop;
 * each axis of `half` for a two-up half — path.ts rule 8 adds them after the
 * solve). Moving in SOURCE pixels.
 */
export function dragShare(keys: Pick<FollowKeys, 'axis' | 'size'>, origin: number, dx: number, dy: number): number {
  const len = keys.axis === 'x' ? keys.size.width : keys.size.height
  const moved = keys.axis === 'x' ? dx : dy
  return len > 0 ? origin + moved / len : origin
}

export function dragHalfShare(
  keys: Pick<FollowKeys, 'half'>,
  origin: { x: number; y: number },
  dx: number,
  dy: number
): { x: number; y: number } {
  return {
    x: keys.half.width > 0 ? origin.x + dx / keys.half.width : origin.x,
    y: keys.half.height > 0 ? origin.y + dy / keys.half.height : origin.y
  }
}
