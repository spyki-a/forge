import { type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { ShelfToolId } from '../../store'
import { useEditor } from '../../store'
import { ErrorBoundary } from '../ErrorBoundary'
import { Tile } from '../ui/Tile'
import { SHELF_TOOLS, shelfToolById, type ShelfTool } from './tools'

/** The open tool's way back to the grid. */
export const BACK_TITLE = 'Back to all the tools'

/**
 * The Shelf: the top of the left column (docs/WINDOW.md §2, §3.2, §6 Step 9).
 *
 * The user's "sidecar" — the code says Shelf, because the sidecar in code is
 * the Python helper. Two faces, chosen by the store's `shelfTool`:
 *
 * - HOME (null): the tools as a grid of tiles, in the sketch's order
 *   (shelf/tools.ts). No title: the tiles are the page. A tile with a run
 *   under way wears a busy badge, so a reel started inside Beat sync is still
 *   visible from here.
 * - AN OPEN TOOL: a flat header — "← Tools · Grid split" — over that tool's
 *   panel. The header is flat; the tiles are the raised things.
 *
 * Each open panel sits in its OWN error boundary, keyed by the tool: before
 * this, one throw in any of the left panel's tabs replaced the whole window
 * with the crash screen (main.tsx). Now it replaces that panel, the rest of
 * the window carries on, and opening another tool starts clean.
 *
 * The root says what it is showing in `data-shelf-tool` ("home", or the
 * tool's id), and an open tool's panel is in `data-shelf-panel` — how the UI
 * census finds them (harness/census.ts), never by their words.
 */
export function Shelf(): ReactNode {
  const open = useEditor((s) => s.shelfTool)
  const setShelfTool = useEditor((s) => s.setShelfTool)
  const tool = open === null ? null : shelfToolById(open)

  if (!tool) return <ShelfHome onOpen={setShelfTool} />

  const Panel = tool.panel
  return (
    <div data-shelf-tool={tool.id} className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-ink-800 px-1.5 text-[11px]">
        <button
          onClick={() => setShelfTool(null)}
          title={BACK_TITLE}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
        >
          <ArrowLeft size={12} aria-hidden />
          Tools
        </button>
        <span className="text-ink-600" aria-hidden>
          ·
        </span>
        <span className="min-w-0 truncate font-medium text-ink-200">{tool.label}</span>
      </div>
      {/*
        The panel's box. It scrolls whatever the panel does not scroll itself
        (the URL form, the one-click panels), and clips the rest at its edge,
        so a panel squeezed by the Trimmer dock under it is cut off there
        rather than drawn over the dock.
      */}
      <div data-shelf-panel className="min-h-0 flex-1 overflow-y-auto">
        <ErrorBoundary key={tool.id}>
          <Panel />
        </ErrorBoundary>
      </div>
    </div>
  )
}

/**
 * The home grid.
 *
 * `auto-fill` columns at least 3.5rem wide with 12 px gaps, inside 14 px of
 * padding: three a row in the 240 px column (each about 62 px), four from
 * about 290 px. The padding and the gaps are the tiles' shadows' reach
 * (ui/Tile.tsx). The grid scrolls when the Trimmer dock leaves it short.
 */
function ShelfHome({ onOpen }: { onOpen: (tool: ShelfToolId) => void }): ReactNode {
  return (
    <div data-shelf-tool="home" className="h-full overflow-y-auto p-3.5">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-3">
        {SHELF_TOOLS.map((tool) => (
          <ShelfTile key={tool.id} tool={tool} onOpen={onOpen} />
        ))}
      </div>
    </div>
  )
}

/** One tile. A component of its own so each busy selector re-renders its own tile only. */
function ShelfTile({ tool, onOpen }: { tool: ShelfTool; onOpen: (tool: ShelfToolId) => void }): ReactNode {
  const busy = useEditor((s) => (tool.busy ? tool.busy(s) : false))
  return (
    <Tile
      data-shelf-tile={tool.id}
      icon={tool.icon}
      label={tool.label}
      title={tool.hint}
      note={tool.soon ? 'soon' : undefined}
      busy={busy}
      size="sm"
      onClick={() => onOpen(tool.id)}
    />
  )
}
