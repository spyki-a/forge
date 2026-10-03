import { useState, type ReactNode } from 'react'
import { Grid3x3, Loader2 } from 'lucide-react'
import { generatedCount } from '@shared/automation/apply'
import {
  ARRIVAL_HINT,
  ARRIVAL_LABEL,
  CADENCES,
  CADENCE_LABEL,
  GRID_RULE,
  type Arrival
} from '@shared/automation/grid'
import { isPhoto } from '@shared/edit/photos'
import {
  CELL_SHAPE_HINT,
  CELL_SHAPE_LABEL,
  REVEAL_ORDER_LABEL,
  gridFor,
  type CellShape,
  type RevealOrder
} from '@shared/render/grid'
import { useEditor } from '../../store'
import { useMusicClip } from './shared'
import { SourceLine } from './SourceLine'

/**
 * The Grid split tile: one photo cut into pieces that land one per beat
 * (docs/WINDOW.md §3.12, §6 Step 10). The Grid split section of the
 * Automation panel, moved as it was.
 *
 * Which photo: Choose from media (SourceLine.tsx, step 12) sets `chosen`, and
 * the build passes it to buildGrid(assetId?), which already took one. Nothing
 * chosen builds from the selected photo, or the first one, as before.
 */
export function GridSplit(): ReactNode {
  // The photo chosen in the list: this panel's own, for its own build.
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const project = useEditor((s) => s.project)
  const buildGrid = useEditor((s) => s.buildGrid)
  const clearGrid = useEditor((s) => s.clearGrid)
  const gridBuilding = useEditor((s) => s.gridBuilding)
  // The reel writes onto the same lane: its run holds this build back (below).
  const reelBuilding = useEditor((s) => s.reelBuilding)
  const gridPieces = useEditor((s) => s.gridPieces)
  const setGridPieces = useEditor((s) => s.setGridPieces)
  const gridShape = useEditor((s) => s.gridShape)
  const setGridShape = useEditor((s) => s.setGridShape)
  const gridOrder = useEditor((s) => s.gridOrder)
  const setGridOrder = useEditor((s) => s.setGridOrder)
  const gridArrival = useEditor((s) => s.gridArrival)
  const setGridArrival = useEditor((s) => s.setGridArrival)
  const gridGap = useEditor((s) => s.gridGap)
  const setGridGap = useEditor((s) => s.setGridGap)
  const gridTilt = useEditor((s) => s.gridTilt)
  const setGridTilt = useEditor((s) => s.setGridTilt)
  const gridBeatsPerCell = useEditor((s) => s.gridBeatsPerCell)
  const setGridBeatsPerCell = useEditor((s) => s.setGridBeatsPerCell)

  const images = project.assets.filter(isPhoto).length
  const gridClipCount = generatedCount(project, GRID_RULE)
  // Shown before the build, so the shape of the grid is never a surprise: a
  // prime number of pieces can only be strips, and saying so up front is
  // kinder than letting someone pick 7 and wonder what happened.
  const { rows, cols } = gridFor(gridPieces, project.settings.width / project.settings.height)

  const { musicClip } = useMusicClip()

  return (
    <section className="space-y-2 border-b border-ink-800 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-200">
          <Grid3x3 size={12} className="text-accent-400" />
          Grid split
        </span>
        <span className="text-[10px] text-ink-600">
          {gridClipCount > 0 ? `${gridClipCount} pieces` : `${rows} × ${cols}`}
        </span>
      </div>

      {/* Upload a file, the photo it is cut from — chosen here, or the default — and the song (step 12). */}
      <SourceLine tool="grid-split" choose={{ chosen, onChoose: setChosen }} />

      <p className="text-[10.5px] leading-snug text-ink-600">
        One photo cut into pieces that arrive one per beat, until the picture is
        whole. This is the one place cutting on every beat is right — the frame
        is not changing, it is filling in.
      </p>

      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[10.5px] text-ink-400">Pieces</span>
        <input
          type="range"
          min={2}
          max={36}
          step={1}
          value={gridPieces}
          onChange={(e) => setGridPieces(Number(e.target.value))}
          className="min-w-0 flex-1"
        />
        <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-600">
          {rows} × {cols}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1">
        {(Object.keys(CELL_SHAPE_LABEL) as CellShape[]).map((shape) => (
          <button
            key={shape}
            onClick={() => setGridShape(shape)}
            title={CELL_SHAPE_HINT[shape]}
            className={`rounded px-1.5 py-1 text-[10.5px] transition-colors ${
              gridShape === shape
                ? 'bg-accent-500 text-ink-950'
                : 'bg-ink-800 text-ink-400 hover:bg-ink-700 hover:text-ink-200'
            }`}
          >
            {CELL_SHAPE_LABEL[shape]}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[10.5px] text-ink-400">Order</span>
        <select
          value={gridOrder}
          onChange={(e) => setGridOrder(e.target.value as RevealOrder)}
          className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-950 px-1.5 py-1 text-[10.5px] text-ink-200 focus:border-accent-500 focus:outline-none"
        >
          {(Object.keys(REVEAL_ORDER_LABEL) as RevealOrder[]).map((order) => (
            <option key={order} value={order}>
              {REVEAL_ORDER_LABEL[order]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[10.5px] text-ink-400">Landing</span>
        <select
          value={gridArrival}
          onChange={(e) => setGridArrival(e.target.value as Arrival)}
          title={ARRIVAL_HINT[gridArrival]}
          className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-950 px-1.5 py-1 text-[10.5px] text-ink-200 focus:border-accent-500 focus:outline-none"
        >
          {(Object.keys(ARRIVAL_LABEL) as Arrival[]).map((arrival) => (
            <option key={arrival} value={arrival}>
              {ARRIVAL_LABEL[arrival]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[10.5px] text-ink-400">Cadence</span>
        <select
          value={gridBeatsPerCell}
          onChange={(e) => setGridBeatsPerCell(Number(e.target.value))}
          className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-950 px-1.5 py-1 text-[10.5px] text-ink-200 focus:border-accent-500 focus:outline-none"
        >
          {CADENCES.map((rate) => (
            <option key={rate} value={rate}>
              {CADENCE_LABEL[rate]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[10.5px] text-ink-400">Gutter</span>
        <input
          type="range"
          min={0}
          max={30}
          step={1}
          value={Math.round(gridGap * 100)}
          onChange={(e) => setGridGap(Number(e.target.value) / 100)}
          className="min-w-0 flex-1"
        />
        <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-600">
          {gridGap === 0 ? 'none' : `${Math.round(gridGap * 100)}%`}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[10.5px] text-ink-400">Tilt</span>
        <input
          type="range"
          min={0}
          max={25}
          step={1}
          value={gridTilt}
          onChange={(e) => setGridTilt(Number(e.target.value))}
          className="min-w-0 flex-1"
        />
        <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-600">
          {gridTilt === 0 ? 'square' : `±${gridTilt}°`}
        </span>
      </div>

      <div className="flex gap-1">
        <button
          onClick={() => void buildGrid(chosen)}
          // Also while the reel is analysing: both rules write onto a video
          // lane anchored at the music, and letting them race meant whichever
          // finished second was silently shoved past the other's output.
          disabled={gridBuilding || reelBuilding || images === 0}
          className="flex flex-1 items-center justify-center gap-1.5 rounded bg-accent-500 px-2 py-1.5 text-[11px] font-medium text-ink-950 hover:bg-accent-400 disabled:opacity-40"
        >
          {gridBuilding ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Grid3x3 size={12} />
          )}
          {gridClipCount > 0 ? 'Rebuild grid' : 'Build grid'}
        </button>
        {!gridBuilding && gridClipCount > 0 && (
          <button
            onClick={clearGrid}
            className="rounded bg-ink-800 px-2 py-1.5 text-[11px] text-ink-400 hover:bg-ink-700 hover:text-ink-200"
          >
            Clear
          </button>
        )}
      </div>

      {/* Which photo it uses is the "Uses:" line at the top now (step 12). */}
      <div className="text-[10px] leading-snug text-ink-600">
        {musicClip
          ? 'The pieces land on the track’s beats.'
          : 'No music on the timeline — the pieces will arrive on an even cadence instead.'}
      </div>
    </section>
  )
}
