import { type ReactNode } from 'react'
import { House } from 'lucide-react'
import type { ShelfToolId } from '../../store'
import { useEditor } from '../../store'
import { ErrorBoundary } from '../ErrorBoundary'
import { Tile } from '../ui/Tile'
import { SHELF_TOOLS, shelfToolById, type ShelfTool } from './tools'

/** The strip's first tile, which goes back to the home grid: its tooltip and its name. */
export const HOME_TITLE = 'All the tools'

/**
 * The Shelf: the top of the left column (docs/WINDOW.md §2, §3.2, §6 Steps 9
 * and 11).
 *
 * The user's "sidecar" — the code says Shelf, because the sidecar in code is
 * the Python helper. Two faces, chosen by the store's `shelfTool`:
 *
 * - HOME (null): the tools as a grid of tiles, in the sketch's order
 *   (shelf/tools.ts). No title: the tiles are the page. A tile with a run
 *   under way wears a busy badge, so a reel started inside Beat sync is still
 *   visible from here. The tiles only GO somewhere, so they are plain buttons
 *   and say nothing about being pressed.
 * - AN OPEN TOOL: the grid FOLDS into a strip at the top — every tool again,
 *   as small icon-only tiles in two rows, each named by its tooltip, the open
 *   one PRESSED — and the tool's panel takes everything under it (the user,
 *   2026-10-03: "why not use our full space and make the selected button
 *   appear below … in a light shady blue"). Switching tools is one click on
 *   another tile; Home is the first tile, or the pressed one pressed again.
 *   The tool's own header (step 10) is the panel's title, so there is no
 *   header of the Shelf's over it — the "← Tools · name" row this replaced.
 *
 * Each open panel sits in its OWN error boundary, keyed by the tool: before
 * this, one throw in any of the left panel's tabs replaced the whole window
 * with the crash screen (main.tsx). Now it replaces that panel, the rest of
 * the window carries on, and opening another tool starts clean.
 *
 * The root says what it is showing in `data-shelf-tool` ("home", or the
 * tool's id), the strip is `data-shelf-strip`, and an open tool's panel is in
 * `data-shelf-panel` — how the UI census finds them (harness/census.ts),
 * never by their words.
 */
export function Shelf(): ReactNode {
  const open = useEditor((s) => s.shelfTool)
  const setShelfTool = useEditor((s) => s.setShelfTool)
  const tool = open === null ? null : shelfToolById(open)

  if (!tool) return <ShelfHome onOpen={setShelfTool} />

  const Panel = tool.panel
  return (
    <div data-shelf-tool={tool.id} className="flex h-full flex-col">
      <ShelfStrip open={tool.id} onGo={setShelfTool} />
      {/*
        The panel's box: everything under the strip. It scrolls whatever the
        panel does not scroll itself (the URL form, the one-click panels), and
        clips the rest at its edge, so a panel squeezed by the Trimmer dock
        under it is cut off there rather than drawn over the dock.
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

/**
 * The strip an open tool folds the home grid into: the Home tile, then every
 * tool in the registry's order, all icon-only (Tile `xs`).
 *
 * Ten to a row, so the twenty tiles are two rows: about 20 px square in the
 * 240 px column, never more than 24 px (the tile's `max-w-6`, each centred in
 * its column), so the strip is 65 px at 240 px and at most 73 px however wide
 * the column is dragged (8 + 24 + 8 + 24 + 8 + the 1 px rule) — the Shelf's
 * floor counts on it (dock.ts SHELF_FLOOR, tests/windowStrips.test.ts). Three
 * pixels across and eight down are the small tile's shadow's reach.
 */
function ShelfStrip({ open, onGo }: { open: ShelfToolId; onGo: (tool: ShelfToolId | null) => void }): ReactNode {
  return (
    <div
      data-shelf-strip
      className="grid shrink-0 grid-cols-10 justify-items-center gap-x-[3px] gap-y-2 border-b border-ink-800 px-1.5 pb-2 pt-2"
    >
      <Tile data-shelf-home icon={House} label={HOME_TITLE} title={HOME_TITLE} size="xs" onClick={() => onGo(null)} />
      {SHELF_TOOLS.map((tool) => (
        <StripTile key={tool.id} tool={tool} pressed={tool.id === open} onGo={onGo} />
      ))}
    </div>
  )
}

/**
 * One tool in the strip: a toggle — pressed while its tool is open, and
 * pressing it then goes home. Its name is its tooltip; its busy badge is the
 * home tile's, so a run started in one tool shows while another is open.
 */
function StripTile({
  tool,
  pressed,
  onGo
}: {
  tool: ShelfTool
  pressed: boolean
  onGo: (tool: ShelfToolId | null) => void
}): ReactNode {
  const busy = useEditor((s) => (tool.busy ? tool.busy(s) : false))
  return (
    <Tile
      data-shelf-tile={tool.id}
      icon={tool.icon}
      label={tool.label}
      title={tool.label}
      pressed={pressed}
      busy={busy}
      size="xs"
      onClick={() => onGo(pressed ? null : tool.id)}
    />
  )
}
