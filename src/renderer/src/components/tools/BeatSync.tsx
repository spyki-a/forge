import { useState, type ReactNode } from 'react'
import { Layers, Loader2, Mic, Music, Plus } from 'lucide-react'
import { generatedCount } from '@shared/automation/apply'
import { REEL_RULE } from '@shared/automation/reel'
import { isPhoto } from '@shared/edit/photos'
import { useEditor } from '../../store'
import { MusicRange } from '../MusicRange'
import { useBakeStatus, useMusicClip } from './shared'
import { SourceLine } from './SourceLine'

/**
 * The Beat sync / Cut to words tile: the beat-synced reel (docs/WINDOW.md
 * §3.10, §6 Step 10).
 *
 * The reel's section of the Automation panel, moved as it was. The rule writes
 * ordinary clips onto the timeline, each labelled with why it fired, and Clear
 * removes exactly its own output — nothing is hidden, which is what keeps an
 * automated edit auditable (docs/AUTOMATION.md §6).
 *
 * Motion and Transitions are read by One photo too, which mirrors both
 * (OnePhoto.tsx) — the same store fields, so either panel sets them for both.
 * Depth parallax is mirrored in the Depth / Parallax tile (DepthParallax.tsx).
 */
export function BeatSync(): ReactNode {
  const project = useEditor((s) => s.project)
  const buildReel = useEditor((s) => s.buildReel)
  const clearReel = useEditor((s) => s.clearReel)
  const reelBuilding = useEditor((s) => s.reelBuilding)
  const reelMotion = useEditor((s) => s.reelMotion)
  const setReelMotion = useEditor((s) => s.setReelMotion)
  const reelTransitions = useEditor((s) => s.reelTransitions)
  const setReelTransitions = useEditor((s) => s.setReelTransitions)
  const reelParallax = useEditor((s) => s.reelParallax)
  const setReelParallax = useEditor((s) => s.setReelParallax)
  const reelLyrics = useEditor((s) => s.reelLyrics)
  const setReelLyrics = useEditor((s) => s.setReelLyrics)
  const reelStage = useEditor((s) => s.reelStage)
  const cancelReel = useEditor((s) => s.cancelReel)
  const importAssets = useEditor((s) => s.importAssets)
  // The grid writes onto the same lane: its run holds this build back (below).
  const gridBuilding = useEditor((s) => s.gridBuilding)

  const [adding, setAdding] = useState(false)
  const reelShots = generatedCount(project, REEL_RULE)
  const images = project.assets.filter(isPhoto).length

  const { musicClip, musicAsset } = useMusicClip()
  const { bakeMessage, bakeProgress } = useBakeStatus()

  const addMusic = async (): Promise<void> => {
    setAdding(true)
    try {
      const paths = await window.forge.pickMedia()
      if (paths.length > 0) await importAssets(paths)
    } finally {
      setAdding(false)
    }
  }

  return (
    <section className="space-y-2 border-b border-ink-800 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-200">
          <Music size={12} className="text-accent-400" />
          Beat-synced reel
        </span>
        <span className="text-[10px] text-ink-600">{images} photo{images === 1 ? '' : 's'}</span>
      </div>

      {/* Upload a file, and what the reel takes: every photo, and the song (step 12). */}
      <SourceLine tool="beat-sync" />

      <p className="text-[10.5px] leading-snug text-ink-600">
        Cuts your photos to the music — pacing set by tempo, treatment by how loud
        the moment is.
      </p>

      {musicClip && musicAsset ? (
        <MusicRange clip={musicClip} asset={musicAsset} />
      ) : (
        <button
          onClick={() => void addMusic()}
          disabled={adding}
          className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-ink-700 px-2 py-3 text-[11px] text-ink-400 hover:border-accent-500 hover:text-ink-200 disabled:opacity-40"
        >
          {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Add music
        </button>
      )}

      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[10.5px] text-ink-400">Motion</span>
        <input
          type="range"
          min={0}
          max={35}
          step={1}
          value={Math.round(reelMotion * 100)}
          onChange={(e) => setReelMotion(Number(e.target.value) / 100)}
          className="min-w-0 flex-1"
        />
        <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-600">
          {reelMotion === 0 ? 'none' : `${Math.round(reelMotion * 100)}%`}
        </span>
      </div>

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
            Cuts each photo into depth planes so near things move faster than far
            ones. Takes a few seconds per photo the first time, then it is cached.
            Photos too flat to separate keep the ordinary move.
          </span>
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-2 rounded p-1 hover:bg-ink-850">
        <input
          type="checkbox"
          checked={reelLyrics}
          onChange={(e) => setReelLyrics(e.target.checked)}
          className="mt-0.5 shrink-0 accent-accent-500"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[11px] text-ink-200">
            <Mic size={11} className="text-accent-400" />
            Cut to the words
          </span>
          <span className="mt-0.5 block text-[10px] leading-snug text-ink-600">
            Splits the song, reads the vocal, and puts cuts on the words that
            land hardest — a “b” or a “t” has a real attack in it, where a
            word starting on a vowel has none. Kept where they were sung
            rather than dragged onto the beat, which is the whole point.
            Instrumental tracks fall back to beats on their own.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[10.5px] text-ink-400">Transitions</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(reelTransitions * 100)}
          onChange={(e) => setReelTransitions(Number(e.target.value) / 100)}
          className="min-w-0 flex-1"
        />
        <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-600">
          {reelTransitions === 0 ? 'cuts' : `${Math.round(reelTransitions * 100)}%`}
        </span>
      </div>

      <div className="flex gap-1">
        <button
          onClick={() => void buildReel()}
          disabled={reelBuilding || gridBuilding || images === 0 || !musicClip}
          className="flex flex-1 items-center justify-center gap-1.5 rounded bg-accent-500 px-2 py-1.5 text-[11px] font-medium text-ink-950 hover:bg-accent-400 disabled:opacity-40"
        >
          {reelBuilding ? <Loader2 size={12} className="animate-spin" /> : <Music size={12} />}
          {reelBuilding ? reelStage ?? 'Analysing' : reelShots > 0 ? 'Rebuild' : 'Analyse & build'}
        </button>
        {reelBuilding && (
          <button
            onClick={cancelReel}
            className="rounded bg-ink-800 px-2 py-1.5 text-[11px] text-ink-400 hover:bg-ink-700 hover:text-ink-200"
          >
            Stop
          </button>
        )}
        {!reelBuilding && reelShots > 0 && (
          <button
            onClick={clearReel}
            className="rounded bg-ink-800 px-2 py-1.5 text-[11px] text-ink-400 hover:bg-ink-700 hover:text-ink-200"
          >
            Clear
          </button>
        )}
      </div>

      {reelBuilding && (
        <div className="space-y-1 rounded bg-ink-950/60 px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[10.5px] text-ink-300">
              {bakeMessage ?? reelStage ?? 'analysing the music'}
            </span>
            {reelStage && (
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-600">
                {reelStage}
              </span>
            )}
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-ink-800">
            <div
              className={`h-full bg-accent-500 ${bakeProgress === null ? 'w-1/3 animate-pulse' : ''}`}
              style={bakeProgress === null ? undefined : { width: `${Math.round(bakeProgress * 100)}%` }}
            />
          </div>
        </div>
      )}

      {musicClip && images === 0 && (
        <div className="text-[10.5px] leading-snug text-amber-800">
          Upload some photos — they are what the cuts are made of.
        </div>
      )}
      {reelShots > 0 && (
        <div className="text-[10.5px] text-emerald-800">
          {reelShots} shots placed. Every one is an ordinary clip.
        </div>
      )}
    </section>
  )
}
