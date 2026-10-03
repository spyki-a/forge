import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { usePanelRef, type PanelImperativeHandle, type PanelSize } from 'react-resizable-panels'
import { ChevronRight, Diamond, Spline } from 'lucide-react'
import { TRAY_OPEN, hasKeysOrPath, trayOpenAt } from '@shared/curveTray'
import { useEditor, type TrayTab } from '../store'
import { CurvePanel } from './CurvePanel'
import { Keyframes } from './Keyframes'
import { MotionPathPanel } from './MotionPathPanel'

/**
 * The Curve tray: keys and curves, in a small side bar on the timeline.
 *
 * The user's decision (docs/WINDOW.md §3.19): the graphs and keyframes live
 * "in a small side bar on the timeline, only the user uses it when needed".
 * So it is closed by default — a 28 px rail with a button for each tab — and
 * nothing but a person opens it: not selecting a clip, not keying one. What
 * the rail does say on its own is whether the selected clip has anything in
 * there, with a dot.
 *
 * Open, it has two tabs. Keys is the keyframe rows and the motion path, moved
 * here from the Inspector unchanged; Curves is the CurvePanel that sat beside
 * the timeline before, also unchanged, with its own Motion and Colour tabs.
 * Both stay mounted while the tray is open and the one not showing is hidden,
 * so the Curves tab keeps the property and the Motion/Colour choice it was on
 * across a look at the Keys.
 *
 * Its Panel in App.tsx is collapsible, and the store's `trayOpen` is the one
 * truth both ways: a click here sets it and the Panel follows; a drag on the
 * divider moves the Panel and `useTrayPanel` writes it back.
 *
 * Flat, like the timeline beside it. No transform, filter or backdrop-filter:
 * the full-window pickers are `fixed`, and any of those on an ancestor would
 * become their containing block.
 */

const KEYS_TITLE = 'Keys — keyframes and the motion path'
const CURVES_TITLE = 'Curves — the motion graph and the tone curve'
const DOT_TITLE = 'The selected clip has keys or a motion path'
const CLOSE_TITLE = 'Close keys & curves'

const TABS = [
  { id: 'keys', label: 'Keys', title: KEYS_TITLE, Icon: Diamond },
  { id: 'curves', label: 'Curves', title: CURVES_TITLE, Icon: Spline }
] as const satisfies readonly { id: TrayTab; label: string; title: string; Icon: typeof Diamond }[]

export function CurveTray(): ReactNode {
  const open = useEditor((s) => s.trayOpen)
  const tab = useEditor((s) => s.trayTab)
  const setTrayOpen = useEditor((s) => s.setTrayOpen)
  const setTrayTab = useEditor((s) => s.setTrayTab)
  /*
   * The selected clip, on the Inspector's terms: one whose asset is in the
   * project. The Inspector showed its keyframe rows only then, and the Keys
   * tab is those rows moved.
   */
  const clip = useEditor((s) => {
    const found = s.project.clips.find((c) => c.id === s.selectedClipId)
    return found && s.project.assets.some((a) => a.id === found.assetId) ? found : null
  })

  const show = (next: TrayTab): void => {
    setTrayTab(next)
    setTrayOpen(true)
  }

  if (!open) {
    const keyed = hasKeysOrPath(clip)
    return (
      <div data-curve-tray="rail" className="flex h-full min-h-0 flex-col items-center gap-1 bg-ink-900 py-1.5">
        {TABS.map(({ id, title, Icon }) => (
          <button
            key={id}
            onClick={() => show(id)}
            title={title}
            className="relative flex size-6 shrink-0 items-center justify-center rounded text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-200"
          >
            <Icon size={14} />
            {/* On Keys, because that is where the keys and the path are. */}
            {id === 'keys' && keyed && (
              <span title={DOT_TITLE} className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-accent-500" />
            )}
          </button>
        ))}
        {/* The rail's name, and the biggest thing on it to click. */}
        <button
          onClick={() => show(tab)}
          className="mt-1 min-h-0 flex-1 overflow-hidden text-[10px] tracking-wide text-ink-500 transition-colors [writing-mode:vertical-rl] hover:text-ink-200"
        >
          {'Keys & curves'}
        </button>
      </div>
    )
  }

  return (
    <div data-curve-tray={tab} className="flex h-full min-h-0 flex-col bg-ink-900">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-ink-850 pl-1.5 pr-1">
        {TABS.map(({ id, label, title, Icon }) => (
          <button
            key={id}
            onClick={() => setTrayTab(id)}
            aria-pressed={tab === id}
            title={title}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] transition-colors ${
              tab === id
                ? 'bg-accent-900 text-accent-400'
                : 'text-ink-500 hover:bg-ink-850 hover:text-ink-300'
            }`}
          >
            <Icon size={11} />
            {label}
          </button>
        ))}
        <button
          onClick={() => setTrayOpen(false)}
          title={CLOSE_TITLE}
          aria-label={CLOSE_TITLE}
          className="ml-auto flex size-5 items-center justify-center rounded text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-200"
        >
          <ChevronRight size={13} />
        </button>
      </div>

      <div className={tab === 'keys' ? 'min-h-0 flex-1 overflow-y-auto p-2' : 'hidden'}>
        {clip ? (
          <div className="space-y-2">
            <Keyframes clip={clip} />
            <MotionPathPanel clip={clip} />
          </div>
        ) : (
          <p className="text-[10.5px] leading-snug text-ink-600">Select a clip to key it</p>
        )}
      </div>

      <div className={tab === 'curves' ? 'min-h-0 flex-1' : 'hidden'}>
        <CurvePanel />
      </div>
    </div>
  )
}

/**
 * The tray's Panel, kept in step with the store.
 *
 * Two directions, one truth (`trayOpen`):
 * - The store changes (a rail button, the close chevron, the Inspector's Open
 *   keys): the Panel is resized open or collapsed to match.
 * - The Panel changes (a drag on the divider, its keyboard, a double-click
 *   back to the default): `onResize` writes what it now is into the store, so
 *   dragging the tray shut also closes it.
 * Each side only acts when the two disagree, so neither answers the other.
 *
 * The store is followed by a subscription rather than a selector: App calls
 * this, and a selector would re-render the whole window — Preview, Timeline,
 * Inspector — every time the tray opens. Following inside the subscription
 * also resizes the Panel in the same event as the click, so the open tray is
 * never drawn for a frame inside the 28 px rail.
 *
 * Opened with `resize`, not `expand`: in react-resizable-panels 4.12.4
 * `expand()` returns to the size the last imperative `collapse()` left
 * (`expandToSize`), else to `minSize`, and only when the current size equals
 * the collapsed one exactly — so a tray dragged shut by hand would reopen at
 * 240 px rather than where it was. This remembers the last open width itself.
 */
export function useTrayPanel(): {
  panelRef: RefObject<PanelImperativeHandle | null>
  onResize: (size: PanelSize) => void
} {
  const panelRef = usePanelRef()
  const width = useRef(TRAY_OPEN)

  useEffect(() => {
    const follow = (open: boolean): void => {
      const panel = panelRef.current
      if (!panel) return
      try {
        if (open === !panel.isCollapsed()) return
        if (open) panel.resize(width.current)
        else panel.collapse()
        // The Group refused (no room): say so, rather than draw the open tray in 28 px.
        if (open && panel.isCollapsed()) useEditor.getState().setTrayOpen(false)
      } catch {
        // The Group has not laid out yet. Its first onResize reports the real state.
      }
    }
    follow(useEditor.getState().trayOpen)
    return useEditor.subscribe((state, prev) => {
      if (state.trayOpen !== prev.trayOpen) follow(state.trayOpen)
    })
  }, [panelRef])

  const onResize = useCallback((size: PanelSize): void => {
    const opened = trayOpenAt(size.inPixels)
    if (opened) width.current = size.inPixels
    const { trayOpen, setTrayOpen } = useEditor.getState()
    if (opened !== trayOpen) setTrayOpen(opened)
  }, [])

  return { panelRef, onResize }
}
