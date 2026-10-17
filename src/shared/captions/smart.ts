import { captionThirds, thirdAt } from '../reframe/freeSpace'
import { subjectTrackOf } from '../reframe/frameMap'
import { helperCan, type HelperStatusLike } from '../sidecar/helperCan'
import { SIDECAR_METHODS } from '../sidecar/protocol'
import { assetById, clipsOnTrack, type Project } from '../timeline'
import type { ThirdLookup } from './placement'
import type { CaptionStyle } from './style'
import { captionTrack } from './timeline'

/**
 * Smart placement's one decision, for every caption route (docs/CLIPS.md
 * §5.4): the OUTPUT strip's toggle sets `project.captions.placement`, and
 * this is the only place that reads it.
 *
 *   libass        main/captions.ts hands the lookup to buildTimelineCaptions,
 *                 which asks it at the frame libass first draws each line's
 *                 cue on (placement.ts `libassLineFrame`) and writes \anN and
 *                 MarginV on the line's events (ass.ts);
 *   canvas bake   buildGraphicsSpec asks it at each caption layer's
 *                 startFrame and gives the third to captionSpec;
 *   preview       Preview.tsx memoises it per project and canvas and asks it
 *                 for the line on screen as the style's export route would
 *                 (placement.ts `lineThird`, captionPreview.ts).
 *
 * So the routes agree about a line: same thirds, each asked at the frame it
 * first shows the line on (§5.2 rule 4, the shot where it starts). Those
 * frames are the same unless a line starts part-way through a frame: libass
 * draws a cue from the frame its centisecond time rounds UP to, the bake
 * from the nearest, so a line starting between half a frame and a frame
 * before a cut is in the later shot on libass and the earlier on the bake —
 * and each takes the shot it is first shown in. The
 * libass route takes it as an argument rather than computing it inside
 * captions/timeline.ts because the thirds (reframe/freeSpace.ts) reach the
 * export planner (render/plan.ts), which imports captions/timeline.ts for
 * escapeFilterPath — computing it there would close an import cycle.
 */

/**
 * The third at each PROJECT frame, from `captionThirds` computed once — or
 * null when the project's placement is not 'smart' (absent, 'style', or
 * anything else), and then every route draws exactly what it did before.
 */
export function smartPlacement(
  project: Project,
  style: Pick<CaptionStyle, 'position'>,
  canvas: { width: number; height: number }
): ThirdLookup | null {
  if (project.captions?.placement !== 'smart') return null
  const thirds = captionThirds(project, style, canvas)
  return (frame) => thirdAt(thirds, frame)
}

/** Whether any clip the captions come from (`captionTrack`) has a subject track Smart placement can read. */
export function captionsHaveSubjects(project: Project): boolean {
  const track = captionTrack(project)
  if (!track) return false
  return clipsOnTrack(project, track.id).some((clip) => {
    const asset = assetById(project, clip.assetId)
    return asset !== null && subjectTrackOf(project, clip, asset) !== null
  })
}

/**
 * The Smart placement toggle's state (§5.4):
 *
 *   ready            a clip the captions come from has a subject track: it works;
 *   no-track         none yet, but the AI helper can find faces: enabled, and
 *                    its tooltip says "reframe a clip first" (with no track
 *                    the thirds are the style's, so nothing moves yet);
 *   helper-starting  none, and the helper has not answered: greyed, said as starting;
 *   needs-helper     none, and nothing on this machine can make one: greyed,
 *                    with the pointer to Settings ("needs the AI helper").
 */
export type SmartPlacementState = 'ready' | 'no-track' | 'helper-starting' | 'needs-helper'

export function smartPlacementState(project: Project, helper: HelperStatusLike | null | undefined): SmartPlacementState {
  if (captionsHaveSubjects(project)) return 'ready'
  if (helperCan(helper, SIDECAR_METHODS.faces)) return 'no-track'
  if (!helper || helper.state === 'starting') return 'helper-starting'
  return 'needs-helper'
}
