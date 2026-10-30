import { framesToSeconds, secondsToFrames, type Clip } from '../timeline'
import type { Third } from '../reframe/freeSpace'
import type { Word } from '../transcript'
import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from './style'

/**
 * Smart placement on the caption routes (docs/CLIPS.md §5.4): what a line
 * looks like in another third, and which frame says which third a line takes.
 *
 * A leaf on purpose: ass.ts and line.ts read it, and the thirds themselves
 * (reframe/freeSpace.ts) reach the export planner, which reads
 * captions/timeline.ts — so nothing here imports them at run time, and the
 * lookup arrives as a function (`ThirdLookup`, made by captions/smart.ts).
 */

export type { Third }

/** The third a line takes at a PROJECT frame — the shot's (§5.2) — or null where the style's own stands. */
export type ThirdLookup = (frame: number) => Third | null

/** The style position that sits in each third. */
const POSITION: Record<Third, CaptionStyle['position']> = { top: 'top', middle: 'center', bottom: 'bottom' }

/**
 * The edge distance, in reference pixels, of a CENTRED style moved to the top
 * or the bottom: the default style's own (`DEFAULT_CAPTION_STYLE`, 220 of
 * 1080). A centred caption has no edge distance of its own — its `marginV` is
 * neither drawn nor shown (OUTPUT hides the Margin slider at Middle), and the
 * Bold centre preset's is 0 — so keeping it would put the moved line on the
 * frame's very edge, under a phone's own buttons.
 */
export const CENTRE_MOVED_MARGIN_V = DEFAULT_CAPTION_STYLE.marginV

/**
 * The style a line takes in `third`: its position moved there, its distance
 * from the edge kept (a bottom caption 220 px up moves to 220 px down from
 * the top). The style itself, untouched, when there is no third or it is the
 * style's own — so a line Smart placement leaves alone is today's, byte for
 * byte.
 */
export function placedStyle(style: CaptionStyle, third: Third | null | undefined): CaptionStyle {
  if (!third) return style
  const position = POSITION[third]
  if (position === style.position) return style
  return {
    ...style,
    position,
    marginV: style.position === 'center' ? CENTRE_MOVED_MARGIN_V : style.marginV
  }
}

/**
 * A clip's window on the CAPTION clock, in source ms: [inPoint, inPoint +
 * duration), with no speed — the window buildTimelineCaptions and
 * buildCaptionLayers caption from, and so the one every route reads here.
 */
export function captionWindowMs(clip: Pick<Clip, 'inPoint' | 'duration'>, fps: number): { startMs: number; endMs: number } {
  const startMs = framesToSeconds(clip.inPoint, fps) * 1000
  return { startMs, endMs: startMs + framesToSeconds(clip.duration, fps) * 1000 }
}

/** A line's first word that the clip shows (caption clock), or null when it shows none. */
export function firstShownWord(group: readonly Word[], clip: Pick<Clip, 'inPoint' | 'duration'>, fps: number): Word | null {
  const { startMs, endMs } = captionWindowMs(clip, fps)
  return group.find((w) => w.endMs > startMs && w.startMs < endMs) ?? null
}

/**
 * The project frame the CANVAS BAKE shows a line starting at source `ms` on:
 * the caption clock, `clip.start` plus (ms − in-point) in frames, rounded —
 * no speed, as buildTimelineCaptions shifts its cues — held to the clip's own
 * frames. buildCaptionLayers's layer `startFrame` for the same line.
 */
export function captionLineFrame(clip: Pick<Clip, 'start' | 'inPoint' | 'duration'>, fps: number, ms: number): number {
  const { startMs } = captionWindowMs(clip, fps)
  const at = clip.start + secondsToFrames((ms - startMs) / 1000, fps)
  return Math.min(Math.max(at, clip.start), clip.start + clip.duration - 1)
}

/**
 * The time an ASS timestamp written for `ms` stands for, in ms: whole
 * centiseconds of the rounded ms, the rest dropped (2975 → 0:00:02.97, 2970).
 * ass.ts `toAssTime` formats exactly this.
 */
export function assTimeMs(ms: number): number {
  return Math.floor(Math.max(0, Math.round(ms)) / 10) * 10
}

/**
 * The project frame LIBASS first draws a line on whose first word starts at
 * source `ms`: buildTimelineCaptions shifts the cue by (in-point −
 * clip.start), toAssTime writes it in whole centiseconds, and the `ass`
 * filter draws a cue from the first frame whose time is at or after its
 * start — so the frame is the cue's time rounded UP, where the canvas bake
 * (`captionLineFrame`) rounds to nearest. Held to the clip's own frames.
 *
 * Measured on the bundled ffmpeg (macOS 4.1.5) through buildRenderPlan's
 * `ass=` burn, 2026-10-16: 80 cues at 24, 25, 30 and 60 fps, each first
 * drawn on ceil(cue ms × fps / 1000) and none elsewhere — a cue at 2.97 s
 * first shows on frame 90 (3.000 s) at 30 fps, where rounding says 89; one
 * exactly on a frame's time (3.00 s and 4.00 s at every rate) shows on that
 * frame. So a line starting between half a frame and a frame before a cut
 * is drawn first in the shot AFTER it on this route, and §5.2 rule 4 asks
 * that shot.
 */
export function libassLineFrame(clip: Pick<Clip, 'start' | 'inPoint' | 'duration'>, fps: number, ms: number): number {
  // buildTimelineCaptions' own offset, the same expression, so the cue's ms is the one buildAss writes.
  const offsetMs = captionWindowMs(clip, fps).startMs - framesToSeconds(clip.start, fps) * 1000
  const at = Math.ceil((assTimeMs(ms - offsetMs) * fps) / 1000 - 1e-6)
  return Math.min(Math.max(at, clip.start), clip.start + clip.duration - 1)
}

/**
 * The export route that draws the captions, the whole track's: the canvas
 * bake for a look libass cannot express or for words in a shaped script,
 * libass for the rest (graphics/fromTimeline.ts `captionRoute`). The two show
 * a line from different frames when it starts part-way through one
 * (`libassLineFrame`, `captionLineFrame`).
 */
export type CaptionRoute = 'libass' | 'canvas'

/** The project frame `route` first shows a line starting at source `ms` on. */
export function routeLineFrame(route: CaptionRoute, clip: Pick<Clip, 'start' | 'inPoint' | 'duration'>, fps: number, ms: number): number {
  return route === 'libass' ? libassLineFrame(clip, fps, ms) : captionLineFrame(clip, fps, ms)
}

/**
 * Rule 4 of §5.2 on the caption clock: a line takes the shot where it STARTS
 * — the third at the frame `route` first shows its first shown word on, so
 * the preview asks as the export's route will draw it. Null with no lookup
 * (Smart placement off) or no word shown: the style's own.
 */
export function lineThird(
  lookup: ThirdLookup | null | undefined,
  clip: Pick<Clip, 'start' | 'inPoint' | 'duration'>,
  fps: number,
  group: readonly Word[],
  route: CaptionRoute
): Third | null {
  if (!lookup) return null
  const first = firstShownWord(group, clip, fps)
  return first ? lookup(routeLineFrame(route, clip, fps, first.startMs)) : null
}
