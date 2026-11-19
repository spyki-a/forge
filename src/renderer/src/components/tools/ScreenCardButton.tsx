import type { ReactNode } from 'react'
import { screenCardRefusal } from '@shared/graphics/screenCard'
import type { ScreenCardMove } from '@shared/graphics/templates/screenCard'
import { useEditor } from '../../store'

/**
 * Screen card — the Trimmer dock's action on a selected VIDEO clip
 * (docs/CLIPS.md §6.16, "Its trigger", phase 3's piece 4). Mounted in
 * Inspector.tsx beside the reframe section, for a video clip only: not a
 * Director suggestion, since nothing tells the app a clip is a screen
 * recording.
 *
 * **Screen card**, then **Tilt in** and **Pull back**: each press is the
 * store's `addScreenCard`, one undo step (the card, spanning the clip, and
 * its two opacity keys on the clip). When the clip cannot be one
 * (`screenCardRefusal`: steadied, turned or zooming, its own opacity keys, a
 * colour change, under a look, too short, or a card on it already), both
 * buttons are greyed and the reason is said under them.
 *
 * No hook but the store's, so a test can call it as a function.
 */

/** The section's label and the two moves' words (§6.16: "Screen card" with "Tilt in" and "Pull back"). */
export const SCREEN_CARD = 'Screen card'
export const SCREEN_CARD_MOVES_SHOWN: readonly { move: ScreenCardMove; label: string }[] = Object.freeze([
  { move: 'tilt-in', label: 'Tilt in' },
  { move: 'pull-back', label: 'Pull back' }
])

export function ScreenCardButton({ clipId }: { clipId: string }): ReactNode {
  const project = useEditor((s) => s.project)
  const addScreenCard = useEditor((s) => s.addScreenCard)
  const reason = screenCardRefusal(project, clipId)
  return (
    <div data-screen-card-tool="" className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-16 shrink-0 text-[10px] text-ink-500">{SCREEN_CARD}</span>
        {SCREEN_CARD_MOVES_SHOWN.map((m) => (
          <button
            key={m.move}
            type="button"
            data-screen-card-move={m.move}
            disabled={reason !== null}
            onClick={() => void addScreenCard(clipId, m.move)}
            className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300 transition-colors hover:bg-ink-700 hover:text-ink-100 disabled:opacity-40"
          >
            {m.label}
          </button>
        ))}
      </div>
      {reason !== null && (
        <p data-screen-card-reason="" className="text-[10px] leading-snug text-ink-500">
          {reason}
        </p>
      )}
    </div>
  )
}
