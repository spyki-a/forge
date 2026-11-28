import { footageOf } from './graphics/sound'
import type { Clip, Project } from './timeline'

/**
 * The clip whose words the Transcript tab and the Transcript tile show for
 * what is selected on the timeline.
 *
 * A selected footage clip is its own. A selected GRAPHIC is the footage clip
 * it shows over (`footageOf`: the clip Find graphics made it from, the one
 * its sounds and Find again read): a graphic has no words of its own, so
 * until 2026-11-27 selecting one — to change it in the Trimmer dock, the
 * moment after Find graphics placed it — turned the tab to "No transcript
 * yet" and took the rows, Graphics and its list of what was found away until
 * the footage clip was selected again. The user's word, asked: "yes please".
 *
 * A graphic with no footage clip under its first frame stays itself, as
 * before; so does every other clip that draws itself (a title, a card): they
 * were not asked about. The selection itself is not changed — the dock still
 * shows the graphic's own settings.
 */
export function wordsClipOf(project: Pick<Project, 'tracks' | 'clips'>, selectedClipId: string | null): Clip | null {
  const selected = selectedClipId === null ? null : (project.clips.find((c) => c.id === selectedClipId) ?? null)
  if (!selected?.graphic) return selected
  const footage = footageOf(project, selected, selected.graphic)
  return (footage !== null && project.clips.find((c) => c.id === footage)) || selected
}
