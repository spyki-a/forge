import { useState, type ReactNode } from 'react'
import { Loader2, Sparkles, Type } from 'lucide-react'
import { generatedCount } from '@shared/automation/apply'
import { ONE_PHOTO_RULE } from '@shared/automation/onePhoto'
import { isPhoto } from '@shared/edit/photos'
import { useEditor } from '../../store'
import { useBakeStatus, useMusicClip } from './shared'
import { SourceLine } from './SourceLine'

/**
 * The One photo tile: one picture, a song and a caption become a reel
 * (docs/WINDOW.md §3.11, §6 Step 10).
 *
 * The One photo section of the Automation panel, moved as it was, plus what it
 * shared with the beat-synced reel and showed nothing for: buildOnePhotoReel
 * reads the reel's Motion and Transitions (store.ts), and runs on the reel's
 * own state — reelBuilding, reelStage, reelCancelled — so its progress and its
 * Stop are the reel's. Beside the reel's section all of that was on screen;
 * alone, without these, One photo would lose two options and its way to stop.
 * They are MIRRORS: the same store fields as Beat sync's controls
 * (BeatSync.tsx), so a change in either panel is a change in both.
 *
 * Which photo: Choose from media (SourceLine.tsx, step 12) sets `chosen`, and
 * the build passes it to buildOnePhotoReel(assetId?), which already took one.
 * Nothing chosen builds from the selected photo, or the first one, as before.
 */
export function OnePhoto(): ReactNode {
  // The photo chosen in the list: this panel's own, for its own build.
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const project = useEditor((s) => s.project)
  const reelBuilding = useEditor((s) => s.reelBuilding)
  const reelStage = useEditor((s) => s.reelStage)
  const cancelReel = useEditor((s) => s.cancelReel)
  // Mirrors of Beat sync's two sliders: the same fields, the same setters.
  const reelMotion = useEditor((s) => s.reelMotion)
  const setReelMotion = useEditor((s) => s.setReelMotion)
  const reelTransitions = useEditor((s) => s.reelTransitions)
  const setReelTransitions = useEditor((s) => s.setReelTransitions)
  const onePhotoCaption = useEditor((s) => s.onePhotoCaption)
  const setOnePhotoCaption = useEditor((s) => s.setOnePhotoCaption)
  const buildOnePhotoReel = useEditor((s) => s.buildOnePhotoReel)
  const clearOnePhotoReel = useEditor((s) => s.clearOnePhotoReel)
  // The grid writes onto the same lane: its run holds this build back (below).
  const gridBuilding = useEditor((s) => s.gridBuilding)

  const images = project.assets.filter(isPhoto).length
  const onePhotoShots = generatedCount(project, ONE_PHOTO_RULE)
  const captionLines = onePhotoCaption.split('\n').filter((l) => l.trim()).length

  const { musicClip } = useMusicClip()
  const { bakeMessage, bakeProgress } = useBakeStatus()

  return (
    <section className="space-y-2 border-b border-ink-800 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-200">
          <Type size={12} className="text-accent-400" />
          One photo
        </span>
        <span className="text-[10px] text-ink-600">
          {onePhotoShots > 0 ? `${onePhotoShots} shots` : 'photo + song + words'}
        </span>
      </div>

      {/* Upload a file, the photo it builds from — chosen here, or the default — and the song (step 12). */}
      <SourceLine tool="one-photo" choose={{ chosen, onChoose: setChosen }} />

      <p className="text-[10.5px] leading-snug text-ink-600">
        One picture becomes several shots — wide, medium, close on the face — cut
        on the bar. Type your caption and it is split into cards sized to fit the
        tempo, each landing on a downbeat.
      </p>

      <textarea
        value={onePhotoCaption}
        onChange={(e) => setOnePhotoCaption(e.target.value)}
        rows={3}
        placeholder={'she said yes\nand we cried\nbest day of my life'}
        className="w-full resize-none rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-[11px] text-ink-200 placeholder:text-ink-600 focus:border-accent-500 focus:outline-none"
      />
      <div className="flex items-center justify-between text-[10px] text-ink-600">
        <span>One line per card. Long lines split themselves.</span>
        {onePhotoCaption.trim() && <span>{captionLines} line{captionLines === 1 ? '' : 's'}</span>}
      </div>

      {/* Beat sync's Motion, mirrored: written as BeatSync.tsx writes it. */}
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

      {/* Beat sync's Transitions, mirrored. */}
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
      <div className="text-[10px] leading-snug text-ink-600">
        Motion and Transitions are Beat sync’s too — one setting, used by both.
      </div>

      <div className="flex gap-1">
        <button
          onClick={() => void buildOnePhotoReel(chosen)}
          disabled={reelBuilding || gridBuilding || images === 0 || !musicClip}
          className="flex flex-1 items-center justify-center gap-1.5 rounded bg-accent-500 px-2 py-1.5 text-[11px] font-medium text-ink-950 hover:bg-accent-400 disabled:opacity-40"
        >
          {reelBuilding ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {reelBuilding ? reelStage ?? 'Working' : onePhotoShots > 0 ? 'Rebuild' : 'Build from one photo'}
        </button>
        {/* The reel's Stop, mirrored: One photo runs on the reel's state, so this stops either. */}
        {reelBuilding && (
          <button
            onClick={cancelReel}
            className="rounded bg-ink-800 px-2 py-1.5 text-[11px] text-ink-400 hover:bg-ink-700 hover:text-ink-200"
          >
            Stop
          </button>
        )}
        {!reelBuilding && onePhotoShots > 0 && (
          <button
            onClick={clearOnePhotoReel}
            className="rounded bg-ink-800 px-2 py-1.5 text-[11px] text-ink-400 hover:bg-ink-700 hover:text-ink-200"
          >
            Clear
          </button>
        )}
      </div>

      {/* The reel's progress, mirrored, for the same reason. */}
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

      {/* Which photo it uses is the "Uses:" line at the top now (step 12). */}
      <div className="text-[10px] leading-snug text-ink-600">
        It bakes the subject cutout first — that is what lets a close-up land
        on a face rather than a waist.
      </div>
    </section>
  )
}
