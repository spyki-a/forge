import type { Project } from '@shared/timeline'

/**
 * The Trimmer dock: what it shows, and how much of the left column it takes.
 *
 * The dock is the bottom of the left column (docs/WINDOW.md §2, §3.18): the
 * waveform with its in and out handles, and under it the clip editor (the
 * Inspector). The user's decision is that it appears ONLY when there is
 * something to trim — a clip selected on the timeline, or a sound picked in
 * the Library and being auditioned before it is placed — and that the rest of
 * the time the Shelf has the whole column. Pure, so the rule is tested without
 * a window (tests/dock.test.ts).
 */

/** What the dock is about: a clip on the timeline, or a Library sound not placed yet. */
export type DockSubject = 'clip' | 'audition'

/**
 * What the dock shows, or null for no dock.
 *
 * - A selected clip that is in the project: `'clip'`. The id is checked
 *   against the project rather than trusted, because a selection can outlive
 *   its clip (an undo, a delete from the menu, a file opened over it) and a
 *   dock for a clip that is not there would be a header over nothing.
 * - Otherwise a sound being auditioned: `'audition'`. Only when no clip is
 *   selected — the waveform has always shown the selected clip over an
 *   audition (Waveform.tsx), so the dock follows it.
 * - Neither: null, and the dock is not drawn at all.
 */
export function dockSubject(
  project: Pick<Project, 'clips'>,
  selectedClipId: string | null,
  audition: { path: string } | null
): DockSubject | null {
  if (selectedClipId !== null && project.clips.some((clip) => clip.id === selectedClipId)) return 'clip'
  if (audition) return 'audition'
  return null
}

/*
 * The left column's floors, in CSS pixels.
 *
 * Step 7 gave the tabs' holder a floor of 16.5rem (264 px): the 31.5 px tab
 * row, 120 px of tab content, and the 112 px waveform that sat under the tabs.
 * The waveform has moved into the dock, so the tabs kept the first two and the
 * dock took the third, with its own header and its own 120 px of editor:
 * they are the two panels' minimum sizes (App.tsx), and together, with the
 * 1 px divider between them, what the column keeps for them before an open
 * OUTPUT or EXPORT strip gets any (`holderFloor`). Step 9 put the Shelf where
 * the tabs were, on the same floor: an open tool's 28 px header and 124 px of
 * its panel, or two rows of the home grid's tiles. Step 11 folded that header
 * and the grid into the strip of tool tiles over an open tool's panel — 65 px
 * at the 240 px column, at most 73 px however wide (shelf/Shelf.tsx
 * ShelfStrip) — so the floor rose by the difference to keep the panel its
 * ~120 px: 73 + 121. Not more: with the dock, 194 + 1 + 260 = 455 is all the
 * holder can keep and still leave both strip headers room in the 511.8 px
 * column tests/windowStrips.test.ts measures from.
 */

/** The Shelf: an open tool's strip of tiles (at most 73 px) and about 120 px of its panel. */
export const SHELF_FLOOR = 194

/** The dock: its 28 px header, the 112 px waveform, and 120 px of the clip editor under it. */
export const DOCK_FLOOR = 260

/**
 * The min-height of the holder the tabs and the dock share, as CSS.
 *
 * Three fifths of the column, and never less than what the panels in it need
 * — the Shelf, or the Shelf and the dock — as long as the two 28 px strip
 * headers under it still fit (the 3.5rem). An open strip takes what is left
 * and scrolls its body; the Shelf and the dock do not give way to it. When the
 * column is shorter than all of that the headers win, and the two panels share
 * the holder in proportion to their floors. Since step 8 the column runs the
 * window's full height under the header (and since step 9 nothing heads it),
 * so with the dock showing that takes a window under about 505 px — below the
 * 680 px minimum.
 */
export function holderFloor(dock: boolean): string {
  const room = dock ? SHELF_FLOOR + 1 + DOCK_FLOOR : SHELF_FLOOR
  return `min(max(60%, ${room}px), 100% - 3.5rem)`
}
