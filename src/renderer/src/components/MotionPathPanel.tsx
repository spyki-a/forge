import { type ReactNode } from 'react'
import type { Clip } from '@shared/timeline'
import { PATH_PRESETS } from '@shared/render/path'
import { useEditor } from '../store'

/**
 * A clip's motion path: the presets, a point recorded at the playhead, and a
 * way back to no path.
 *
 * Moved out of the Inspector into the Curve tray's Keys tab, under the
 * keyframe rows (docs/WINDOW.md §3.19) — the path is the one property that
 * animates without a key, so it belongs where the keys are. The block is the
 * Inspector's, verbatim, except that Clear says in its tooltip that it is the
 * PATH it clears: in the tray it sits under the keyframe rows' own "clear".
 */
export function MotionPathPanel({ clip }: { clip: Clip }): ReactNode {
  const setPath = useEditor((s) => s.setPath)
  const addWaypoint = useEditor((s) => s.addWaypoint)

  /*
   * Position only: `scale` with eval=frame re-evaluates but does not
   * follow its own expression, so animated size is not offered
   * rather than offered and wrong.
   */
  return (
    <div className="pt-1">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10.5px] text-ink-400">Motion path</span>
        {clip.path && clip.path.length > 0 && (
          <span className="font-mono text-[10px] text-accent-400">
            {clip.path.length} point{clip.path.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {PATH_PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => setPath(clip.id, preset.build(clip.duration))}
            className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400 hover:bg-ink-700 hover:text-ink-200"
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        <button
          onClick={() => addWaypoint(clip.id)}
          title="Record where this clip sits right now, at the playhead"
          className="flex-1 rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-400 hover:bg-ink-700 hover:text-ink-200"
        >
          Add point at playhead
        </button>
        {clip.path && (
          <button
            onClick={() => setPath(clip.id, undefined)}
            title="Clear path — remove every point of this clip's motion path"
            className="rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-400 hover:bg-ink-700 hover:text-ink-200"
          >
            Clear
          </button>
        )}
      </div>
      {clip.path && clip.path.length === 1 && (
        <div className="mt-1 text-[10px] leading-snug text-amber-800">
          One point is a fixed offset, not a move — add a second.
        </div>
      )}
    </div>
  )
}
