import type { Clip, MomentSpec, Project } from '../timeline'
import { previewAt, transitionById } from '../transitions/registry'
import { bridgesCut, momentSpan, texturePlanFor, type TexturePlan } from './moment'

/**
 * The pictures a moment draws from, found in the project: the shot it comes
 * from and the shot it lands on, each as that shot shows its file — the
 * Director's crop, the fit, the camera move, the punch-in of the transition
 * it entered with, its depth planes when its move reads them, and where in
 * the shot the moment's first frame (`momentStart`) falls. Null when the
 * shot it lands on is gone, or is footage (a moment over footage is not drawn
 * yet — its frames would need pulling from the file; docs/PLAN.md §7.2); a
 * missing "from" is a single-shot moment.
 *
 * Found by id first, then by POSITION: a split keeps the id on the left half
 * (timeline.ts splitClip), so the clip the id names may no longer be the one
 * under the cut. The clip on the same track that covers the moment's first
 * frame (for "from") or its last (for "to") is the picture beneath.
 */
export interface MomentTextures {
  from: TexturePlan | null
  to: TexturePlan
}

export function momentTextures(
  project: Pick<Project, 'clips' | 'assets' | 'parallax' | 'settings'>,
  spec: MomentSpec,
  momentStart: number
): MomentTextures | null {
  const total = momentSpan(spec, project.settings.fps).total
  const canvas = { width: project.settings.width, height: project.settings.height }
  const covering = (clip: Clip, frame: number): Clip => {
    if (frame >= clip.start && frame < clip.start + clip.duration) return clip
    return project.clips.find((c) => c.trackId === clip.trackId && frame >= c.start && frame < c.start + c.duration) ?? clip
  }
  const plan = (clipId: string, frame: number): TexturePlan | null => {
    const named = project.clips.find((c) => c.id === clipId)
    const clip = named ? covering(named, frame) : undefined
    const asset = clip ? project.assets.find((a) => a.id === clip.assetId) : undefined
    if (!clip || !asset || !asset.path || asset.kind !== 'image') return null
    const bake = project.parallax?.[asset.id]
    const planes = bake && bake.separated ? bake.layers.map((l) => ({ file: l.file, depth: l.depth })) : undefined
    // The zoom family's punch-in enlarges the whole clip (registry.ts punchIn); nothing else changes the picture past the blend.
    const def = clip.transitionIn ? transitionById(clip.transitionIn.id) : null
    const inset = def ? previewAt(def, 1, { duration: clip.transitionIn!.durationFrames / project.settings.fps, canvasWidth: canvas.width, canvasHeight: canvas.height }).scale : 1
    // A bridge follows each shot's own move so its ends match the shots; a depth push is the move.
    return texturePlanFor(clip, asset, momentStart, planes, bridgesCut(spec.kind), inset)
  }
  const to = plan(spec.to.clipId, momentStart + total - 1)
  if (!to) return null
  return { from: spec.from ? plan(spec.from.clipId, momentStart) : null, to }
}
