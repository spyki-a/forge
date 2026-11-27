/**
 * The fold-out panel's rules: its state, which transcript its Transcript tab
 * shows, its sizes, and how its Panel and the store keep in step
 * (components/Foldout.tsx; the clip maker's layout, 2026-11-27).
 *
 * The user's sketch: "only when the clips toggle on the left panel unfolds the
 * clips on the right canvas", and the same for the transcript, "so that when
 * the trim create wont ever collide". So the two longest things in the window
 * — the Best clips cards and the transcript rows — leave the 240 px left
 * column for one panel beside the picture, with two tabs, Clips and
 * Transcript. The picture shrinks beside it and is never covered.
 *
 * In code it is the FOLDOUT. Never "sidecar": that is the Python helper in
 * code, and the user's word for the left column. On screen it has no name of
 * its own, only its two tabs.
 *
 * Here, with no DOM, so tests/foldout.test.ts holds the rules in plain node,
 * as shared/curveTray.ts is for the Curve tray.
 */

/** The panel's two tabs. */
export type FoldoutTab = 'clips' | 'transcript'

/**
 * Which transcript the Transcript tab is asked for: the words of the link in
 * the URL tile, or the words of the clip selected on the timeline.
 */
export type FoldoutWords = 'link' | 'clip'

/**
 * The panel, as the store holds it. Session state only: not in the project,
 * not in its file, no undo step, never marks the project dirty, and not kept
 * across launches. `tab` and `words` outlive a close, so the panel reopens
 * where it was.
 */
export interface FoldoutState {
  open: boolean
  tab: FoldoutTab
  words: FoldoutWords
}

/** How every window starts: shut, on Clips, the Transcript tab on the link's words. */
export const FOLDOUT_START: FoldoutState = Object.freeze({ open: false, tab: 'clips', words: 'link' })

/** Open on `tab`; `words` changes only when given. Already so: the same object back. */
export function foldoutOpened(state: FoldoutState, tab: FoldoutTab, words?: FoldoutWords): FoldoutState {
  const next = { open: true, tab, words: words ?? state.words }
  return next.open === state.open && next.tab === state.tab && next.words === state.words ? state : next
}

/** Shut, keeping the tab and the words for the next open. Already shut: the same object back. */
export function foldoutClosed(state: FoldoutState): FoldoutState {
  return state.open ? { ...state, open: false } : state
}

/**
 * Is the panel showing exactly what a toggle asks for?
 *
 * Open on that tab — and for the Transcript tab, on those words when the toggle
 * names them. The link's toggle pressed while the panel shows the clip's
 * transcript is not "the tab already showing": it switches to the link's
 * words rather than closing the panel on the person.
 */
export function foldoutShowing(state: FoldoutState, tab: FoldoutTab, words?: FoldoutWords): boolean {
  if (!state.open || state.tab !== tab) return false
  return tab !== 'transcript' || words === undefined || words === state.words
}

/**
 * A toggle: on what is already showing it closes the panel; on anything else
 * it opens the panel there (the other tab, or the other transcript).
 */
export function foldoutToggled(state: FoldoutState, tab: FoldoutTab, words?: FoldoutWords): FoldoutState {
  return foldoutShowing(state, tab, words) ? foldoutClosed(state) : foldoutOpened(state, tab, words)
}

/**
 * Which transcript the Transcript tab shows, and whether it has words to show.
 *
 * The one asked for if it exists; else the other one if THAT exists; else the
 * asked one's empty state. "Exists" for the link: the link in the URL tile's
 * box has its words ready (store `wordsShown`). For the clip: a clip is
 * selected on the timeline.
 */
export function foldoutTranscript(
  asked: FoldoutWords,
  has: { link: boolean; clip: boolean }
): { words: FoldoutWords; ready: boolean } {
  const other: FoldoutWords = asked === 'link' ? 'clip' : 'link'
  if (has[asked]) return { words: asked, ready: true }
  if (has[other]) return { words: other, ready: true }
  return { words: asked, ready: false }
}

/**
 * Is the Transcript tab showing THESE words — the ones it shows by
 * `foldoutTranscript`, not merely the ones it was asked for?
 *
 * The two can differ: with no clip selected and the link's words ready, the
 * tab can be asked for the clip's words and show the link's. A toggle that
 * read the asked words would then say "pressed" for words that are not on
 * screen, and close the panel when pressed. So the Transcript toggles (the
 * URL tile's, the Transcript tile's) and the tab's two-way switch read this.
 */
export function foldoutShowsWords(state: FoldoutState, words: FoldoutWords, has: { link: boolean; clip: boolean }): boolean {
  return state.open && state.tab === 'transcript' && foldoutTranscript(state.words, has).words === words
}

/**
 * A Transcript toggle naming its words: on those words, as shown, it closes
 * the panel; on anything else it opens the Transcript tab asking for them.
 */
export function foldoutToggledWords(state: FoldoutState, words: FoldoutWords, has: { link: boolean; clip: boolean }): FoldoutState {
  return foldoutShowsWords(state, words, has) ? foldoutClosed(state) : foldoutOpened(state, 'transcript', words)
}

/*
 * Its sizes, in the row beside the tool strip that holds it and the picture.
 *
 * App.tsx writes these as literals on the two Panels — `defaultSize={0}`,
 * `collapsedSize={0}`, `minSize={280}`, `maxSize="60%"`, and `minSize="35%"` on
 * the picture's — because a number there is pixels and a string percent in
 * react-resizable-panels 4.x, and the literal is what someone reading the
 * layout looks at. tests/foldoutWindow.test.ts holds the copies equal.
 */

/** Shut: nothing at all, not a rail. */
export const FOLDOUT_SHUT = 0

/**
 * The narrowest open panel, in pixels: a Best clips card's buttons and a
 * transcript row's time and words need about this much.
 */
export const FOLDOUT_MIN = 280

/** Where it opens the first time, as a share of the row; after that it reopens where it was left. */
export const FOLDOUT_OPEN = '40%'

/** The widest it goes, as a share of the row. */
export const FOLDOUT_MAX = '60%'

/** The picture's least share of the row, the panel open: it shrinks, and is never covered. */
export const PICTURE_MIN = '35%'

/**
 * Is a panel this many pixels wide open?
 *
 * The library never leaves a collapsible panel between its collapsed size and
 * its minimum — a drag snaps it to one or the other at the midpoint — so the
 * midpoint is the line, as `trayOpenAt` draws it for the Curve tray.
 */
export function foldoutOpenAt(pixels: number): boolean {
  return pixels >= (FOLDOUT_SHUT + FOLDOUT_MIN) / 2
}

/** What `followFoldout` needs of the library's Panel handle. */
export interface FoldoutPanelHandle {
  isCollapsed: () => boolean
  resize: (size: number | string) => void
  collapse: () => void
}

/**
 * Bring the Panel to what the store says, from the store's side.
 *
 * Only when the two disagree, so neither answers the other. Opened with
 * `resize` to where it was last left (`width`), never `expand` (CurveTray.tsx
 * `useTrayPanel` says why). Returns 'refused' when the Group would not open it
 * (no room for 280 px beside 35 % of picture): the caller then writes the
 * store shut, rather than draw the open panel in nothing.
 */
export function followFoldout(panel: FoldoutPanelHandle, open: boolean, width: number | string): 'same' | 'moved' | 'refused' {
  if (open === !panel.isCollapsed()) return 'same'
  if (open) panel.resize(width)
  else panel.collapse()
  return open && panel.isCollapsed() ? 'refused' : 'moved'
}

/**
 * From the Panel's side: what it is now, after a drag on its divider, its
 * keyboard, or the window changing size. Returns whether it is open, and the
 * width to reopen at (its share of the row, so a window resized since keeps
 * the proportion) when it is.
 */
export function foldoutResized(size: { inPixels: number; asPercentage: number }): { open: boolean; width: string | null } {
  const open = foldoutOpenAt(size.inPixels)
  return { open, width: open ? `${size.asPercentage}%` : null }
}
