import type { Project } from '../timeline'
import type { ApplyContext } from '../director/apply'
import type { Problem } from '../director/conforms'
import type { KeptGraphic } from './template'

/**
 * The clips flow's graphics rule (docs/CLIPS.md §6.6): the `generatedBy` of
 * every graphic a clips run lands, and what its Clear takes. It lives here,
 * outside the Director, so the Director's rules and Clear never see it.
 */
export const CLIPS_GRAPHIC_RULE = 'clips.graphic'

/**
 * Lands a run's kept graphics on the project (docs/CLIPS.md §6.6). This is
 * the seam between lanes T2 and T3 (§6.19): the signature is committed
 * first, as this typed stub, before T2's wiring starts. The stub changes
 * nothing: it returns the same project object, no clip ids, and one problem
 * saying graphics are not built yet. T3 fills it in.
 */
export function applyGraphics(
  project: Project,
  kept: KeptGraphic[],
  covered: string[],
  rule: string,
  ctx: Pick<ApplyContext, 'fps' | 'newId'>
): { project: Project; problems: Problem[]; clipIds: string[] } {
  void kept
  void covered
  void rule
  void ctx
  return { project, problems: [{ path: '$', message: 'graphics are not built yet — nothing was placed' }], clipIds: [] }
}
