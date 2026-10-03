import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useEditor } from '../store'
import { dockSubject, type DockSubject } from '../dock'
import { Waveform } from './Waveform'
import { Inspector } from './Inspector'

/**
 * The Trimmer dock: the bottom of the left column, shown only while there is
 * something to trim (docs/WINDOW.md §3.18).
 *
 * A clip selected on the timeline, or a sound picked in the Library and being
 * auditioned before it is placed — `dockSubject` decides, and App.tsx draws
 * the dock's panel only while it says there is one. Under a header with the
 * thing's name and a way to close it: the waveform with its in and out
 * handles (it lived under the left tabs, always on, until step 8), then the
 * clip editor (Inspector.tsx, which keeps its file name — six tests read its
 * JSX there). One scroller for both, so a short dock scrolls the editor up
 * past the waveform rather than squeezing either.
 *
 * Closing it lets go of both: the selection, and the audition. Only the
 * selection would leave a sound being auditioned behind it, and the dock
 * would come straight back for that.
 *
 * Flat, like the waveform and the timeline. `data-dock` is how the harness
 * census finds it (harness/census.ts), never by its words. No transform,
 * filter or backdrop-filter anywhere in it: the Inspector's full-window
 * pickers are `fixed`, and any of those on an ancestor would trap them here.
 */

const CLOSE_TITLE = 'Close the trimmer'

/** What the name in the header is, said in its tooltip — the name alone can be either. */
const ABOUT: Record<DockSubject, string> = {
  clip: 'the selected clip',
  audition: 'a Library sound, not on the timeline yet'
}

export function TrimmerDock(): ReactNode {
  const subject = useEditor((s) => dockSubject(s.project, s.selectedClipId, s.audition))
  const name = useEditor((s) => {
    const clip = s.project.clips.find((c) => c.id === s.selectedClipId)
    if (clip) return s.project.assets.find((a) => a.id === clip.assetId)?.name ?? ''
    return s.audition?.name ?? ''
  })
  const select = useEditor((s) => s.select)
  const setAudition = useEditor((s) => s.setAudition)

  if (!subject) return null

  return (
    <div data-dock className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-ink-800 pl-2.5 pr-1">
        <span className="shrink-0 text-[10.5px] font-medium uppercase tracking-wide text-ink-400">Trimmer</span>
        <span title={`${name} — ${ABOUT[subject]}`} className="min-w-0 flex-1 truncate text-[11px] text-ink-200">
          {name}
        </span>
        <button
          onClick={() => {
            select(null)
            setAudition(null)
          }}
          title={CLOSE_TITLE}
          aria-label={CLOSE_TITLE}
          className="flex size-5 shrink-0 items-center justify-center rounded text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-200"
        >
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* The waveform first, at the 112 px it had under the tabs: the thing being trimmed stays in sight above its settings. */}
        <div className="h-28 border-b border-ink-800 bg-ink-900">
          <Waveform />
        </div>
        <Inspector />
      </div>
    </div>
  )
}
