import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { usePanelRef, type PanelImperativeHandle, type PanelSize } from 'react-resizable-panels'
import { X } from 'lucide-react'
import {
  FOLDOUT_OPEN,
  followFoldout,
  foldoutResized,
  foldoutTranscript,
  type FoldoutTab,
  type FoldoutWords
} from '@shared/foldout'
import { useEditor, wordsShown } from '../store'
import { ErrorBoundary } from './ErrorBoundary'
import { BestClipsCards } from './tools/BestClips'

/**
 * The fold-out panel beside the picture: Clips and Transcript (the clip
 * maker's layout, 2026-11-27; the rules are shared/foldout.ts).
 *
 * The left column is about 240 px and kept the two longest things in the app
 * — the Best clips cards and the transcript rows — with the Trimmer dock
 * opening in the same column under them. They unfold here instead, between
 * the tool strip and the picture, and the picture shrinks beside the panel:
 * it is never covered, and the Preview never moves in the tree (App.tsx).
 *
 * On screen it has no name of its own: a bar with its two tabs, the open one
 * selected, and a close button; under it the open tab's body, which scrolls
 * inside the panel. Each body is in its own error boundary, keyed by the tab,
 * as the Shelf's panels are: a throw in one replaces that body, not the
 * window.
 *
 * Shut, it draws nothing at all — an empty root, so the census and the
 * harness still find the panel by `data-foldout="shut"` — and its Panel is
 * collapsed to zero with its divider disabled (App.tsx `FoldoutDivider`).
 *
 * No transform, filter or backdrop-filter here or on anything around it: the
 * full-window pickers are `fixed`, and any of those on an ancestor would
 * become their containing block (CurveTray.tsx's head comment).
 *
 * No hook but the store's, so a test can call it as a function.
 */

/** The bar's tabs, as a group: its name for a screen reader. */
export const FOLDOUT_TABS_LABEL = 'Clips and transcript'
export const FOLDOUT_CLIPS_TAB = 'Clips'
export const FOLDOUT_TRANSCRIPT_TAB = 'Transcript'
export const FOLDOUT_CLIPS_TAB_TITLE = 'The best clips found in the link'
export const FOLDOUT_TRANSCRIPT_TAB_TITLE = 'The words of the link, or of the selected clip'
export const FOLDOUT_CLOSE_TITLE = 'Close and give the picture its room back'

/** The Transcript tab asked for the link's words, with none ready and no clip selected. */
export const FOLDOUT_LINK_EMPTY = 'No words from a link yet. Paste a link in the URL tile and press Get transcript.'
/** The Transcript tab asked for the selected clip's words, with no clip selected and no link words ready. */
export const FOLDOUT_CLIP_EMPTY = 'Select a clip on the timeline to see its words here.'

const TABS = [
  { id: 'clips', label: FOLDOUT_CLIPS_TAB, title: FOLDOUT_CLIPS_TAB_TITLE },
  { id: 'transcript', label: FOLDOUT_TRANSCRIPT_TAB, title: FOLDOUT_TRANSCRIPT_TAB_TITLE }
] as const satisfies readonly { id: FoldoutTab; label: string; title: string }[]

export function Foldout(): ReactNode {
  const open = useEditor((s) => s.foldout.open)
  const tab = useEditor((s) => s.foldout.tab)
  const openFoldout = useEditor((s) => s.openFoldout)
  const closeFoldout = useEditor((s) => s.closeFoldout)

  if (!open) return <div data-foldout="shut" className="h-full" />

  return (
    <div data-foldout={tab} className="flex h-full min-h-0 min-w-0 flex-col bg-ink-900">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-ink-850 pl-1.5 pr-1">
        <div role="tablist" aria-label={FOLDOUT_TABS_LABEL} className="flex min-w-0 items-center gap-1">
          {TABS.map(({ id, label, title }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              // Only the open tab's panel is in the page, so only it is pointed at.
              aria-controls={tab === id ? `foldout-${id}` : undefined}
              data-foldout-tab={id}
              id={`foldout-tab-${id}`}
              onClick={() => openFoldout(id)}
              title={title}
              className={`rounded px-1.5 py-0.5 text-[10.5px] transition-colors ${
                tab === id
                  ? 'bg-accent-900 text-accent-400'
                  : 'text-ink-500 hover:bg-ink-850 hover:text-ink-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-foldout-close
          onClick={closeFoldout}
          title={FOLDOUT_CLOSE_TITLE}
          aria-label={FOLDOUT_CLOSE_TITLE}
          className="ml-auto flex size-5 shrink-0 items-center justify-center rounded text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-200"
        >
          <X size={13} />
        </button>
      </div>

      {/* The open tab's body: everything under the bar, scrolled here, cut at the panel's edge. */}
      <div
        id={`foldout-${tab}`}
        role="tabpanel"
        aria-labelledby={`foldout-tab-${tab}`}
        data-foldout-body={tab}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-2"
      >
        <ErrorBoundary key={tab}>{tab === 'clips' ? <FoldoutClips /> : <FoldoutTranscript />}</ErrorBoundary>
      </div>
    </div>
  )
}

/**
 * The Clips tab: what Best clips found (tools/BestClips.tsx `BestClipsCards`:
 * the running line, the cards, the notes, or what to press first). Its lines
 * for nothing yet live there with the rest of Best clips' words.
 */
export function FoldoutClips(): ReactNode {
  return <BestClipsCards />
}

/**
 * The Transcript tab: the link's words or the selected clip's, by
 * `foldoutTranscript`. For now its empty state; the rows move in later, and
 * with words ready it shows nothing until they do.
 */
export function FoldoutTranscript(): ReactNode {
  // Three plain values, each its own selector: an object built in a selector is new every time.
  const asked = useEditor((s) => s.foldout.words)
  const link = useEditor((s) => wordsShown(s))
  const clip = useEditor((s) => s.selectedClipId !== null && s.project.clips.some((c) => c.id === s.selectedClipId))
  const shown = foldoutTranscript(asked, { link, clip })
  return <FoldoutTranscriptFace words={shown.words} ready={shown.ready} />
}

/** What the Transcript tab draws for one answer of `foldoutTranscript`. */
export function FoldoutTranscriptFace({ words, ready }: { words: FoldoutWords; ready: boolean }): ReactNode {
  if (ready) return <div data-foldout-words={words} />
  return (
    <div data-foldout-words={words}>
      <Line>{words === 'link' ? FOLDOUT_LINK_EMPTY : FOLDOUT_CLIP_EMPTY}</Line>
    </div>
  )
}

function Line({ children }: { children: ReactNode }): ReactNode {
  return <p className="text-[11px] leading-snug text-ink-500">{children}</p>
}

/**
 * The fold-out's Panel, kept in step with the store: the Curve tray's way
 * (CurveTray.tsx `useTrayPanel`), whose comment says why each part is as it is.
 *
 * - The store changes (a toggle, a tab, the close button): the Panel is
 *   resized open to where it was last left, or collapsed to nothing.
 * - The Panel changes (a drag on its divider, its keyboard, the window): its
 *   `onResize` writes into the store whether it is open, so dragging it shut
 *   closes it.
 * Each side acts only when the two disagree (shared/foldout.ts
 * `followFoldout`, `foldoutResized`).
 *
 * Followed by a subscription, not a selector: App calls this, and a selector
 * would re-render the whole window — the Preview among it — on every open.
 */
export function useFoldoutPanel(): {
  panelRef: RefObject<PanelImperativeHandle | null>
  onResize: (size: PanelSize) => void
} {
  const panelRef = usePanelRef()
  const width = useRef<number | string>(FOLDOUT_OPEN)

  useEffect(() => {
    const follow = (open: boolean): void => {
      const panel = panelRef.current
      if (!panel) return
      try {
        // The Group refused (no room): say so, rather than draw the open panel in nothing.
        if (followFoldout(panel, open, width.current) === 'refused') useEditor.getState().closeFoldout()
      } catch {
        // The Group has not laid out yet. Its first onResize reports the real state.
      }
    }
    follow(useEditor.getState().foldout.open)
    return useEditor.subscribe((state, prev) => {
      if (state.foldout.open !== prev.foldout.open) follow(state.foldout.open)
    })
  }, [panelRef])

  const onResize = useCallback((size: PanelSize): void => {
    const now = foldoutResized(size)
    if (now.width !== null) width.current = now.width
    const { foldout, openFoldout, closeFoldout } = useEditor.getState()
    if (now.open !== foldout.open) {
      if (now.open) openFoldout(foldout.tab)
      else closeFoldout()
    }
  }, [])

  return { panelRef, onResize }
}
