import type { Project } from '../timeline'
import { followCandidates } from '../reframe/follow'

/**
 * Is there landscape VIDEO on a portrait canvas that nothing is following yet?
 *
 * The canvas bar's second chip (docs/CLIPS.md §4.8): "Landscape video on a
 * 9:16 canvas", with **Reframe to 9:16**, which follows the subject in every
 * such clip (the store's `reframeAll`). It is NOT a branch of
 * `orientationMismatch` (orientation.ts), and must not become one:
 *
 * - That chip means "the canvas is the wrong way round for your photos —
 *   switch the canvas", and on a portrait canvas with a landscape majority it
 *   offers 16:9. A landscape talk cut for a 9:16 reel is exactly the case where
 *   switching the canvas is the wrong advice: the canvas already has the shape
 *   the person wants, and it is the clip that has to follow its subject.
 * - Folded into one rule, landscape photos and a landscape talk on one 9:16
 *   canvas would give opposite advice in one chip slot.
 *
 * So the photo rule stays photos-only and unchanged (tests/orientation.test.ts
 * pins it), and this is its own rule with its own chip. When both would show,
 * this one does and the photo chip does not (components/CanvasBar.tsx): the
 * video is what the reel is made of, and one chip slot gives one piece of
 * advice.
 *
 * The rule:
 * - the canvas is portrait: its height is greater than its width (a square
 *   canvas is not — there is no 1:1 offer);
 * - and at least one of `followCandidates` (reframe/follow.ts) — the very
 *   clips `reframeAll` follows, so the chip never offers a press that does
 *   nothing: a clip ON THE TIMELINE (a video only in the pool is not counted:
 *   reframing is done to clips, and the pool is not what is exported) of a
 *   landscape VIDEO by its UPRIGHT size (R5 — a phone clip shot standing up is
 *   portrait and needs nothing), on a video lane, not already following, and
 *   not a Director backdrop or a strip, which following would undo.
 *
 * The answer is how many clips — `reframeAll`'s work, one job per FILE — or
 * null when there are none.
 */
export function reframeOffer(project: Pick<Project, 'clips' | 'assets' | 'tracks' | 'settings'>): number | null {
  if (!(project.settings.height > project.settings.width)) return null
  const n = followCandidates(project).length
  return n > 0 ? n : null
}
