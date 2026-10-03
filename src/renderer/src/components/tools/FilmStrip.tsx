import { type ReactNode } from 'react'
import { Film } from 'lucide-react'
import { generatedCount } from '@shared/automation/apply'
import { FILMSTRIP_RULE } from '@shared/automation/filmstrip'
import { useEditor } from '../../store'

/**
 * The Film strip tile: the photos as full-height panels panning across frame
 * (docs/WINDOW.md §3.13, §6 Step 10). The Filmstrip section of the Automation
 * panel, moved as it was. Its build is synchronous, so it has no running flag
 * to wait on and no other build to hold back.
 */
export function FilmStrip(): ReactNode {
  const project = useEditor((s) => s.project)
  const buildFilmstrip = useEditor((s) => s.buildFilmstrip)
  const clearFilmstrip = useEditor((s) => s.clearFilmstrip)
  const filmstripPanels = useEditor((s) => s.filmstripPanels)
  const setFilmstripPanels = useEditor((s) => s.setFilmstripPanels)
  const filmstripSeconds = useEditor((s) => s.filmstripSeconds)
  const setFilmstripSeconds = useEditor((s) => s.setFilmstripSeconds)

  const strips = generatedCount(project, FILMSTRIP_RULE)
  const images = project.assets.filter((a) => a.kind === 'image').length

  return (
    <section className="space-y-2 border-b border-ink-800 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-200">
          <Film size={12} className="text-accent-400" />
          Filmstrip
        </span>
        <span className="text-[10px] text-ink-600">at the playhead</span>
      </div>
      <p className="text-[10.5px] leading-snug text-ink-600">
        Your photos as full-height panels in one long row, panning across frame.
        Every panel is an ordinary clip with its own path.
      </p>

      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[10.5px] text-ink-400">Panels</span>
        <input
          type="range"
          min={2}
          max={8}
          step={1}
          value={filmstripPanels}
          onChange={(e) => setFilmstripPanels(Number(e.target.value))}
          className="min-w-0 flex-1"
        />
        <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-600">
          {filmstripPanels} wide
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[10.5px] text-ink-400">Length</span>
        <input
          type="range"
          min={1}
          max={12}
          step={0.5}
          value={filmstripSeconds}
          onChange={(e) => setFilmstripSeconds(Number(e.target.value))}
          className="min-w-0 flex-1"
        />
        <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-600">
          {filmstripSeconds}s
        </span>
      </div>

      <div className="flex gap-1">
        <button
          onClick={buildFilmstrip}
          disabled={images === 0}
          className="flex flex-1 items-center justify-center gap-1.5 rounded bg-accent-500 px-2 py-1.5 text-[11px] font-medium text-ink-950 hover:bg-accent-400 disabled:opacity-40"
        >
          <Film size={12} />
          {strips > 0 ? 'Rebuild strip' : 'Build strip'}
        </button>
        {strips > 0 && (
          <button
            onClick={clearFilmstrip}
            className="rounded bg-ink-800 px-2 py-1.5 text-[11px] text-ink-400 hover:bg-ink-700 hover:text-ink-200"
          >
            Clear
          </button>
        )}
      </div>
      {strips > 0 && (
        <div className="text-[10.5px] text-emerald-800">{strips} panels placed.</div>
      )}
    </section>
  )
}
