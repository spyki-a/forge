/**
 * What a clip IS, for the eye.
 *
 * Every clip on the timeline was the same grey box, so a reel of thirty was a
 * grey wall: the sticker, the caption, the sound effect and the shot all looked
 * alike, and the only way to find the one you wanted was to click through them.
 * Premiere and CapCut both colour by kind for exactly this reason — you find
 * the music by looking for the green, not by reading thirty labels.
 *
 * Derived from what the clip already carries rather than stored on it. A stored
 * kind is a second source of truth that goes stale the moment a clip is turned
 * into something else, and nothing would notice.
 *
 * The classes are Tailwind's, resolved at build time, so they are written out
 * in full rather than composed — `bg-${colour}-500` is invisible to the
 * compiler and comes out as no class at all.
 */

import type { Clip, MediaAsset, Track } from '../timeline'

export type ClipKind =
  | 'video'
  | 'image'
  | 'text'
  | 'sticker'
  | 'graphic'
  | 'music'
  | 'sfx'
  | 'voice'
  | 'adjustment'

export interface KindStyle {
  kind: ClipKind
  label: string
  /** Body and border, selected and not. */
  idle: string
  selected: string
  /** A solid swatch, for a legend or a badge. */
  dot: string
}

/*
 * One colour per kind, spread around the wheel.
 *
 * These were six families — everything drawn from a spec violet, every picture
 * blue — and the families turned out to be the problem: a text clip and a
 * paper clipping side by side read as one purple, a photo and a shot as one
 * blue. Colour is for FINDING a clip, so each kind gets a hue of its own, and
 * none is blue, which is the app's accent for the playhead and the selection
 * (tests/voiceAndKinds.test.ts measures the distance, not just the name).
 *
 * On the light timeline every kind wears the same recipe: a pale body (the
 * -300 at half strength) under dark ink-200 text, and when selected a fuller
 * body with a DEEP -700 border. The light -300 borders the dark theme used are
 * 1.1-1.6:1 against cream — a selected clip was nearly invisible — while the
 * -700s are 4.2:1 at worst (yellow). Video took violet when the accent became
 * blue (the photo beside it on the main lane is teal, well apart), so graphics
 * moved to green.
 *
 * Not to sky, which was tried first: its -500 swatch is far enough from the
 * accent, but every sky deep enough to be a border (-600 to -900) is 0.095-0.111
 * from one of the accent's steps in OKLab, under the 0.12 floor, and the
 * accent-400 drag box and markers sit on the same timeline. Nor cyan, whose
 * body is closer to the teal photo (0.031) than any two picture-lane kinds
 * already are; green's nearest picture-lane kind is that photo too, at 0.041.
 *
 * Neighbours that are close on the wheel are kinds that do not share a lane:
 * amber and yellow are SFX (audio lanes) and text (picture lanes), green and
 * emerald are graphics (picture) and music (audio).
 */
const STYLES: Record<ClipKind, KindStyle> = {
  video: {
    kind: 'video', label: 'Video',
    idle: 'border-violet-400 bg-violet-300/50 hover:bg-violet-300/70',
    selected: 'border-violet-700 bg-violet-300/85',
    dot: 'bg-violet-500'
  },
  image: {
    kind: 'image', label: 'Photo',
    idle: 'border-teal-400 bg-teal-300/50 hover:bg-teal-300/70',
    selected: 'border-teal-700 bg-teal-300/85',
    dot: 'bg-teal-500'
  },
  text: {
    kind: 'text', label: 'Text',
    idle: 'border-yellow-400 bg-yellow-300/50 hover:bg-yellow-300/70',
    selected: 'border-yellow-700 bg-yellow-300/85',
    dot: 'bg-yellow-500'
  },
  sticker: {
    kind: 'sticker', label: 'Sticker',
    idle: 'border-pink-400 bg-pink-300/50 hover:bg-pink-300/70',
    selected: 'border-pink-700 bg-pink-300/85',
    dot: 'bg-pink-500'
  },
  graphic: {
    kind: 'graphic', label: 'Graphic',
    idle: 'border-green-400 bg-green-300/50 hover:bg-green-300/70',
    selected: 'border-green-700 bg-green-300/85',
    dot: 'bg-green-500'
  },
  music: {
    kind: 'music', label: 'Music',
    idle: 'border-emerald-400 bg-emerald-300/50 hover:bg-emerald-300/70',
    selected: 'border-emerald-700 bg-emerald-300/85',
    dot: 'bg-emerald-500'
  },
  sfx: {
    kind: 'sfx', label: 'SFX',
    idle: 'border-amber-400 bg-amber-300/50 hover:bg-amber-300/70',
    selected: 'border-amber-700 bg-amber-300/85',
    dot: 'bg-amber-500'
  },
  voice: {
    kind: 'voice', label: 'Voice',
    idle: 'border-lime-400 bg-lime-300/50 hover:bg-lime-300/70',
    selected: 'border-lime-700 bg-lime-300/85',
    dot: 'bg-lime-500'
  },
  adjustment: {
    kind: 'adjustment', label: 'Adjustment',
    idle: 'border-red-400 bg-red-300/50 hover:bg-red-300/70',
    selected: 'border-red-700 bg-red-300/85',
    dot: 'bg-red-500'
  }
}

export const KIND_STYLES = STYLES

/** Every kind present on a timeline, in a stable order, for a legend. */
export function kindsPresent(kinds: ClipKind[]): KindStyle[] {
  const order = Object.keys(STYLES) as ClipKind[]
  const seen = new Set(kinds)
  return order.filter((k) => seen.has(k)).map((k) => STYLES[k])
}

/**
 * Sound effect or music?
 *
 * There is no flag for it, and inventing one would mean every existing project
 * guessed wrong. Length is the honest signal: an effect is a hit — a whoosh, a
 * pop, a riser — and a bed runs under the edit. Four seconds is the line, which
 * is long for an effect and short for a track. A track marked to duck is music
 * whatever its length, because that mark IS someone saying so.
 */
export const SFX_MAX_SECONDS = 4

export function clipKind(
  clip: Clip,
  asset: MediaAsset | undefined,
  track: Track | undefined,
  fps: number
): ClipKind {
  if (clip.adjustment) return 'adjustment'
  if (clip.text ?? clip.title) return 'text'
  if (clip.paper ?? clip.carousel ?? clip.solid ?? clip.moment) return 'graphic'

  if (track?.kind === 'audio') {
    if (track.duck) return 'music'
    const seconds = fps > 0 ? clip.duration / fps : 0
    return seconds <= SFX_MAX_SECONDS ? 'sfx' : 'music'
  }

  // A clip sticker carries its own cut-out matte; that is what makes it one.
  if (asset?.matte) return 'sticker'
  if (asset?.kind === 'image') return 'image'
  /*
   * A video clip on a video track whose sound is the point.
   *
   * Not guessed from the file: a talking head and a b-roll shot are the same
   * kind of file. It is the clip having a voice effect, or being the only
   * thing carrying dialogue, that makes it worth marking — and the first of
   * those is something the user said explicitly.
   */
  if (clip.voice) return 'voice'
  return 'video'
}

export function styleFor(kind: ClipKind): KindStyle {
  return STYLES[kind]
}
