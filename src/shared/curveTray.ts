import type { Clip } from './timeline'

/**
 * The Curve tray's rules: its sizes, when it counts as open, and when its rail
 * shows a dot (docs/WINDOW.md §2, §3.19; components/CurveTray.tsx).
 *
 * Here rather than beside the component so tests/curveTray.test.ts can hold
 * them in plain node, as shared/fullScreen.ts is for the full-screen rule.
 */

/**
 * The closed tray: a rail just wide enough for its icon buttons, in pixels.
 *
 * App.tsx writes this and TRAY_MIN as literals on the tray's Panel —
 * `collapsedSize={28}`, `defaultSize={28}`, `minSize={240}` — because a number
 * there is pixels and a string percent in react-resizable-panels 4.x, and the
 * literal is what someone reading the layout looks at. The test holds the two
 * copies equal.
 */
export const TRAY_RAIL = 28

/**
 * The narrowest open tray, in pixels. A Keyframes row's fixed chrome is about
 * 146 px (diamond, label, value), so below this the slider is a sliver.
 */
export const TRAY_MIN = 240

/** Where the tray opens the first time, in pixels; after that it reopens where it was left. */
export const TRAY_OPEN = 320

/**
 * Is a tray this many pixels wide open?
 *
 * The library never leaves a collapsible panel between its collapsed size and
 * its minimum — a drag snaps it to one or the other at the midpoint — so the
 * midpoint is the line. Not "exactly 28": a width measured off the page can
 * round either way once the window has been resized.
 */
export function trayOpenAt(pixels: number): boolean {
  return pixels >= (TRAY_RAIL + TRAY_MIN) / 2
}

/**
 * Has this clip got anything in the tray — a key on any track, or a point on
 * its motion path? The rail's dot.
 *
 * The tray is closed by default and never opens by itself (the user's
 * decision), so a clip's keys are out of sight until someone asks for them.
 * The dot answers the one question that hiding raises: is there anything in
 * there for this clip?
 *
 * Any key counts, not only an animation: one key is a held value rather than a
 * move (`hasKeys` in render/keyframes.ts says two), but it is still something
 * the Keys tab shows and someone may have forgotten. Every track counts — the
 * mask's four, which its Animate writes, and the volume envelope drawn on the
 * timeline, both of which the tray shows — and so does a path of one point,
 * an offset the Keys tab offers to clear.
 */
export function hasKeysOrPath(clip: Pick<Clip, 'keyframes' | 'path'> | null | undefined): boolean {
  if (!clip) return false
  if ((clip.path?.length ?? 0) > 0) return true
  return Object.values(clip.keyframes ?? {}).some((track) => (track?.length ?? 0) > 0)
}
