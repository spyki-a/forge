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
 * buildGraphicsSpec caption from, and so the one every route reads here.
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
 * The project frame the caption routes show a line starting at source `ms`
 * on: the caption clock, `clip.start` plus (ms − in-point) in frames — no
 * speed, as buildTimelineCaptions shifts its cues — held to the clip's own
 * frames. buildGraphicsSpec's layer `startFrame` for the same line.
 */
export function captionLineFrame(clip: Pick<Clip, 'start' | 'inPoint' | 'duration'>, fps: number, ms: number): number {
  const { startMs } = captionWindowMs(clip, fps)
  const at = clip.start + secondsToFrames((ms - startMs) / 1000, fps)
  return Math.min(Math.max(at, clip.start), clip.start + clip.duration - 1)
}

/**
 * Rule 4 of §5.2 on the caption clock: a line takes the shot where it STARTS
 * — the third at the frame its first shown word appears on. Null with no
 * lookup (Smart placement off) or no word shown: the style's own.
 */
export function lineThird(
  lookup: ThirdLookup | null | undefined,
  clip: Pick<Clip, 'start' | 'inPoint' | 'duration'>,
  fps: number,
  group: readonly Word[]
): Third | null {
  if (!lookup) return null
  const first = firstShownWord(group, clip, fps)
  return first ? lookup(captionLineFrame(clip, fps, first.startMs)) : null
}
