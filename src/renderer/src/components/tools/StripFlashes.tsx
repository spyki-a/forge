import { type ReactNode } from 'react'
import { Loader2, Zap } from 'lucide-react'
import { generatedCount } from '@shared/automation/apply'
import { CADENCES, CADENCE_LABEL } from '@shared/automation/grid'
import {
  STRIP_LOOK_HINT,
  STRIP_LOOK_LABEL,
  STRIP_RULE,
  type StripLook
} from '@shared/automation/strips'
import {
  STRIP_LAYOUT_HINT,
  STRIP_LAYOUT_LABEL,
  type StripLayout
} from '@shared/render/strips'
import { useEditor } from '../../store'
import { SourceLine } from './SourceLine'

/**
 * The Strip flashes tile: slices of a brightened copy flashing over the shot
 * under the playhead (docs/WINDOW.md §3.13, §6 Step 10). The Strip flashes
 * section of the Automation panel, moved as it was.
 */
export function StripFlashes(): ReactNode {
  const project = useEditor((s) => s.project)
  const buildStrips = useEditor((s) => s.buildStrips)
  const clearStrips = useEditor((s) => s.clearStrips)
  const stripsBuilding = useEditor((s) => s.stripsBuilding)
  // The reel and the grid write onto lanes this lays over: either run holds it back (below).
  const reelBuilding = useEditor((s) => s.reelBuilding)
  const gridBuilding = useEditor((s) => s.gridBuilding)
  const stripLayout = useEditor((s) => s.stripLayout)
  const setStripLayout = useEditor((s) => s.setStripLayout)
  const stripCount = useEditor((s) => s.stripCount)
  const setStripCount = useEditor((s) => s.setStripCount)
  const stripPerHit = useEditor((s) => s.stripPerHit)
  const setStripPerHit = useEditor((s) => s.setStripPerHit)
  const stripLook = useEditor((s) => s.stripLook)
  const setStripLook = useEditor((s) => s.setStripLook)
  const stripBeatsPerHit = useEditor((s) => s.stripBeatsPerHit)
  const setStripBeatsPerHit = useEditor((s) => s.setStripBeatsPerHit)
  const stripBursts = useEditor((s) => s.stripBursts)
  const setStripBursts = useEditor((s) => s.setStripBursts)

  const stripClipCount = generatedCount(project, STRIP_RULE)

  return (
    <section className="space-y-2 border-b border-ink-800 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-200">
          <Zap size={12} className="text-accent-400" />
          Strip flashes
        </span>
        <span className="text-[10px] text-ink-600">
          {stripClipCount > 0 ? `${stripClipCount} flashes` : 'over the shot'}
        </span>
      </div>

      {/* Upload a file, and the shot it flashes over, named (step 12). */}
      <SourceLine tool="strip-flashes" />

      <p className="text-[10.5px] leading-snug text-ink-600">
        Slices of a brightened copy flashing over the shot that is already
        there — four a beat. The footage never stops; only the slices change,
        which is why this can run far faster than a cut ever should.
      </p>

      <div className="grid grid-cols-3 gap-1">
        {(Object.keys(STRIP_LAYOUT_LABEL) as StripLayout[]).map((layout) => (
          <button
            key={layout}
            onClick={() => setStripLayout(layout)}
            title={STRIP_LAYOUT_HINT[layout]}
            className={`rounded px-1.5 py-1 text-[10.5px] transition-colors ${
              stripLayout === layout
                ? 'bg-accent-500 text-ink-950'
                : 'bg-ink-800 text-ink-400 hover:bg-ink-700 hover:text-ink-200'
            }`}
          >
            {STRIP_LAYOUT_LABEL[layout]}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[10.5px] text-ink-400">Slices</span>
        <input
          type="range"
          min={2}
          max={12}
          step={1}
          value={stripCount}
          onChange={(e) => setStripCount(Number(e.target.value))}
          className="min-w-0 flex-1"
        />
        <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-600">
          {stripCount}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[10.5px] text-ink-400">At once</span>
        <input
          type="range"
          min={1}
          max={6}
          step={1}
          value={stripPerHit}
          onChange={(e) => setStripPerHit(Number(e.target.value))}
          className="min-w-0 flex-1"
        />
        <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-600">
          {stripPerHit}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[10.5px] text-ink-400">Rate</span>
        <select
          value={stripBeatsPerHit}
          onChange={(e) => setStripBeatsPerHit(Number(e.target.value))}
          className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-950 px-1.5 py-1 text-[10.5px] text-ink-200 focus:border-accent-500 focus:outline-none"
        >
          {CADENCES.filter((r) => r <= 4).map((rate) => (
            <option key={rate} value={rate}>
              {CADENCE_LABEL[rate]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[10.5px] text-ink-400">Look</span>
        <select
          value={stripLook}
          onChange={(e) => setStripLook(e.target.value as StripLook)}
          title={STRIP_LOOK_HINT[stripLook]}
          className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-950 px-1.5 py-1 text-[10.5px] text-ink-200 focus:border-accent-500 focus:outline-none"
        >
          {(Object.keys(STRIP_LOOK_LABEL) as StripLook[]).map((look) => (
            <option key={look} value={look}>
              {STRIP_LOOK_LABEL[look]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[10.5px] text-ink-400">Stutters</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(stripBursts * 100)}
          onChange={(e) => setStripBursts(Number(e.target.value) / 100)}
          className="min-w-0 flex-1"
        />
        <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-600">
          {stripBursts === 0 ? 'none' : `${Math.round(stripBursts * 100)}%`}
        </span>
      </div>

      <div className="flex gap-1">
        <button
          onClick={() => void buildStrips()}
          disabled={stripsBuilding || reelBuilding || gridBuilding}
          className="flex flex-1 items-center justify-center gap-1.5 rounded bg-accent-500 px-2 py-1.5 text-[11px] font-medium text-ink-950 hover:bg-accent-400 disabled:opacity-40"
        >
          {stripsBuilding ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
          {stripClipCount > 0 ? 'Rebuild flashes' : 'Add flashes'}
        </button>
        {!stripsBuilding && stripClipCount > 0 && (
          <button
            onClick={clearStrips}
            className="rounded bg-ink-800 px-2 py-1.5 text-[11px] text-ink-400 hover:bg-ink-700 hover:text-ink-200"
          >
            Clear
          </button>
        )}
      </div>

      {/* Which shot it uses is the "Uses:" line at the top now (step 12). */}
      <div className="text-[10px] leading-snug text-ink-600">
        Lays the flashes on the track above the shot. Every one is an ordinary
        clip — delete them all and the shot is exactly as it was.
      </div>
    </section>
  )
}
