import type { ReactNode } from 'react'

/**
 * Follow the subject — the Trimmer dock's reframe section for a selected
 * VIDEO clip (docs/CLIPS.md §4.8; home `dock`, WINDOW.md §3.18).
 *
 * Scaffold only: slice B's U fills it and mounts it in Inspector.tsx, under
 * Steady (the `canSteady` line, where §4.8's "Inspector.tsx:218-221" points),
 * for a selected video clip. What it will hold, top to bottom:
 * - Follow the subject (or Unfollow); while the face finder is not on disk it
 *   reads "Follow the subject · gets the face finder, 1.1 MB, first time", and
 *   it is greyed with "needs the AI helper" without one;
 * - Follow: with a phrase field, greyed with 1g's reason (not built);
 * - Stack two people (on by default);
 * - the shot count and followKeys' notes.
 * NOT "Get the subject model" or "Find subjects without faces" (§16.35).
 */
export interface ReframePanelProps {
  clipId: string
}

export function ReframePanel(_props: ReframePanelProps): ReactNode {
  return null
}
