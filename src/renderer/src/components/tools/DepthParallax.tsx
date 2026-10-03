import { type ReactNode } from 'react'
import { Layers, Loader2 } from 'lucide-react'
import { useEditor } from '../../store'
import { useBakeStatus } from './shared'

/**
 * The Depth / Parallax tile: a pointer panel (docs/WINDOW.md §3.14, §6 Steps
 * 10–11, Decision 5).
 *
 * Depth is not a tool of its own yet — it is a switch on the beat-synced reel
 * and a camera move in the Trimmer — so this says where those are rather than
 * pretending to be more. The switch is a MIRROR of Beat sync's Depth parallax
 * box: the same store field, `reelParallax`, so ticking either ticks both.
 * Baking one chosen photo from here (`bakeParallax`) is phase 2.
 *
 * The tile wears its busy badge while anything is baking (shelf/tools.ts), so
 * the panel says what is being baked.
 */
export function DepthParallax(): ReactNode {
  const reelParallax = useEditor((s) => s.reelParallax)
  const setReelParallax = useEditor((s) => s.setReelParallax)
  const { bakeMessage, bakeProgress } = useBakeStatus()
  const baking = useEditor((s) => Object.keys(s.baking).length)

  return (
    <section className="space-y-2 border-b border-ink-800 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-200">
          <Layers size={12} className="text-accent-400" />
          Depth / Parallax
        </span>
      </div>

      <p className="text-[10.5px] leading-snug text-ink-600">
        A photo cut into depth planes, so near things move further than far ones
        as the camera drifts.
      </p>

      <label className="flex cursor-pointer items-start gap-2 rounded p-1 hover:bg-ink-850">
        <input
          type="checkbox"
          checked={reelParallax}
          onChange={(e) => setReelParallax(e.target.checked)}
          className="mt-0.5 shrink-0 accent-accent-500"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[11px] text-ink-200">
            <Layers size={11} className="text-accent-400" />
            Depth parallax
          </span>
          <span className="mt-0.5 block text-[10px] leading-snug text-ink-600">
            For the beat-synced reel: the same switch as Beat sync’s, so ticking
            it here ticks it there.
          </span>
        </span>
      </label>

      {baking > 0 && (
        <div className="flex items-center gap-1.5 rounded bg-ink-950/60 px-2 py-1.5 text-[10.5px] text-ink-300">
          <Loader2 size={11} className="shrink-0 animate-spin" />
          <span className="min-w-0 flex-1 truncate">{bakeMessage ?? 'Baking depth'}</span>
          {bakeProgress !== null && (
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-600">
              {Math.round(bakeProgress * 100)}%
            </span>
          )}
        </div>
      )}

      <div className="text-[10px] leading-snug text-ink-600">
        Where a photo’s depth comes from: Beat sync bakes each photo the first time
        it builds with Depth parallax on, and One photo always bakes its photo. A
        few seconds a photo; the bake is kept with the project.
      </div>
      <div className="text-[10px] leading-snug text-ink-600">
        For one clip: select a photo on the timeline, and in the Trimmer below
        choose Camera → Depth — offered once that photo has been baked into planes.
      </div>
    </section>
  )
}
