import { useState, type ReactNode } from 'react'
import { Loader2, Sparkles, Wand2 } from 'lucide-react'
import { PROP_RULE, generatedCount } from '@shared/automation/apply'
import { useEditor } from '../../store'

/**
 * The 3D props tile: props that pop up on the words they are named by
 * (docs/WINDOW.md §3.13, §6 Step 10). The props section of the Automation
 * panel and its "Why these fired" list, moved as they were.
 *
 * Its button places props rather than building one thing, and waits on its
 * own run only (a local flag), as it did in the Automation panel.
 */
export function Props3d(): ReactNode {
  const project = useEditor((s) => s.project)
  const propsEnabled = useEditor((s) => s.propsEnabled)
  const propsPerMinute = useEditor((s) => s.propsPerMinute)
  const setPropsEnabled = useEditor((s) => s.setPropsEnabled)
  const setPropsPerMinute = useEditor((s) => s.setPropsPerMinute)
  const applyPropRule = useEditor((s) => s.applyPropRule)
  const clearPropRule = useEditor((s) => s.clearPropRule)

  const [running, setRunning] = useState(false)
  const placed = generatedCount(project, PROP_RULE)
  const transcribed = Object.keys(project.transcripts).length > 0

  const run = async (): Promise<void> => {
    setRunning(true)
    try {
      await applyPropRule()
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <section className="space-y-2 border-b border-ink-800 p-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11.5px] text-ink-200">
            <Sparkles size={12} className="text-accent-400" />
            3D props on keywords
          </span>
          <button
            onClick={() => setPropsEnabled(!propsEnabled)}
            className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
              propsEnabled ? 'bg-accent-500 text-ink-950' : 'bg-ink-800 text-ink-400 hover:bg-ink-700'
            }`}
          >
            {propsEnabled ? 'On' : 'Off'}
          </button>
        </div>

        <p className="text-[10.5px] leading-snug text-ink-600">
          Props appear when a matching word is spoken — fire on “flame”, rocket on
          “launch”. No model involved: the transcript already has word timing.
        </p>

        {propsEnabled && (
          <>
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[10.5px] text-ink-400">Frequency</span>
              <input
                type="range"
                min={1}
                max={20}
                step={1}
                value={propsPerMinute}
                onChange={(e) => setPropsPerMinute(Number(e.target.value))}
                className="min-w-0 flex-1"
              />
              <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-600">
                {propsPerMinute}/min
              </span>
            </div>

            <div className="flex gap-1">
              <button
                onClick={() => void run()}
                disabled={running || !transcribed}
                className="flex flex-1 items-center justify-center gap-1.5 rounded bg-accent-500 px-2 py-1.5 text-[11px] font-medium text-ink-950 hover:bg-accent-400 disabled:opacity-40"
              >
                {running ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                {placed > 0 ? 'Regenerate' : 'Place props'}
              </button>
              {placed > 0 && (
                <button
                  onClick={clearPropRule}
                  className="rounded bg-ink-800 px-2 py-1.5 text-[11px] text-ink-400 hover:bg-ink-700 hover:text-ink-200"
                >
                  Clear
                </button>
              )}
            </div>

            {!transcribed && (
              <div className="text-[10.5px] leading-snug text-amber-800">
                Transcribe a clip first — props fire on spoken words.
              </div>
            )}

            {placed > 0 && (
              <div className="text-[10.5px] text-emerald-800">
                {placed} placed. They are ordinary clips — move, trim or delete any of them.
              </div>
            )}
          </>
        )}
      </section>

      {placed > 0 && (
        <section className="p-3">
          <div className="mb-1.5 text-[10.5px] uppercase tracking-wide text-ink-600">Why these fired</div>
          <div className="space-y-1">
            {project.clips
              .filter((c) => c.generatedBy?.rule === PROP_RULE)
              .slice(0, 12)
              .map((clip) => (
                <div key={clip.id} className="truncate text-[10.5px] text-ink-400">
                  {clip.generatedBy?.reason}
                </div>
              ))}
          </div>
        </section>
      )}
    </>
  )
}
