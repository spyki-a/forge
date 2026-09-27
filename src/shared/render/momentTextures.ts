import type { Clip, MomentSpec, Project } from '../timeline'
import { previewAt, transitionById } from '../transitions/registry'
import { bridgesCut, footageWindow, momentSpan, texturePlanFor, type TexturePlan } from './moment'
import { FOOTAGE_MAX_EDGE } from './momentFrames'

/**
 * The pictures a moment draws from, found in the project: the shot it comes
 * from and the shot it lands on, each as that shot shows its file — the
 * Director's crop, the fit, the camera move, the punch-in of the transition
 * it entered with, its depth planes when its move reads them, and where in
 * the shot the moment's first frame (`momentStart`) falls. A photograph is
 * its file; footage is a request for its frames under the moment, pulled
 * through the clip's own retime by the pre-pass (momentFrames.ts) and
 * resolved by whoever draws. Null when the shot it lands on is gone, or is
 * footage under a depth push (a push is a photograph's move); a missing
 * "from" is a single-shot moment.
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
  const fps = project.settings.fps
  const total = momentSpan(spec, fps).total
  const canvas = { width: project.settings.width, height: project.settings.height }
  const bridge = bridgesCut(spec.kind)
  const covering = (clip: Clip, frame: number): Clip => {
    if (frame >= clip.start && frame < clip.start + clip.duration) return clip
    return project.clips.find((c) => c.trackId === clip.trackId && frame >= c.start && frame < c.start + c.duration) ?? clip
  }
  const plan = (clipId: string, frame: number): TexturePlan | null => {
    const named = project.clips.find((c) => c.id === clipId)
    const clip = named ? covering(named, frame) : undefined
    const asset = clip ? project.assets.find((a) => a.id === clip.assetId) : undefined
    if (!clip || !asset || !asset.path) return null
    if (asset.kind !== 'image' && !(asset.kind === 'video' && bridge)) return null
    // A steadied clip's frames are the stabiliser's (vidstab's transforms, deshake), which the pull does not run: nothing to draw from yet.
    if (asset.kind === 'video' && clip.steady) return null
    const bake = project.parallax?.[asset.id]
    const planes = bake && bake.separated ? bake.layers.map((l) => ({ file: l.file, depth: l.depth })) : undefined
    // The zoom family's punch-in enlarges the whole clip (registry.ts punchIn); nothing else changes the picture past the blend.
    const def = clip.transitionIn ? transitionById(clip.transitionIn.id) : null
    const inset = def ? previewAt(def, 1, { duration: clip.transitionIn!.durationFrames / fps, canvasWidth: canvas.width, canvasHeight: canvas.height }).scale : 1
    // A bridge follows each shot's own move so its ends match the shots; a depth push is the move.
    const base = texturePlanFor(clip, asset, momentStart, planes, bridge, inset)
    if (asset.kind !== 'video') return base
    const window = footageWindow(base.at, total, base.frames)
    return {
      ...base,
      footage: {
        path: asset.path,
        inPoint: clip.inPoint,
        duration: clip.duration,
        ...(clip.speed !== undefined ? { speed: clip.speed } : {}),
        ...(clip.ramp ? { ramp: { from: clip.ramp.from, to: clip.ramp.to } } : {}),
        ...(clip.smoothSlow ? { smoothSlow: true } : {}),
        ...(clip.hold ? { hold: true } : {}),
        first: window.first,
        count: window.count,
        fps,
        ...(clip.crop ? { crop: clip.crop } : {}),
        size: { width: asset.width ?? 0, height: asset.height ?? 0 },
        maxEdge: FOOTAGE_MAX_EDGE
      }
    }
  }
  // The outgoing shot is the clip under the frame just before the cut, the incoming the one under the moment's
  // last frame: the two frames the hand-offs are judged on, whatever a split did to the ids.
  const before = momentSpan(spec, fps).before
  const to = plan(spec.to.clipId, momentStart + total - 1)
  if (!to) return null
  return { from: spec.from ? plan(spec.from.clipId, momentStart + Math.max(0, before - 1)) : null, to }
}

/**
 * A footage plan with its frames pulled: the files from the shot's frame
 * `first` on, at the pulled size, the crop already cut. What the renderer
 * and the eval both make of the pre-pass's answer.
 */
export function withFootageFrames(plan: TexturePlan, pulled: { files: string[]; width: number; height: number }): TexturePlan {
  const { footage, crop: _cut, ...rest } = plan
  return { ...rest, size: { width: pulled.width, height: pulled.height }, pulled: { files: pulled.files, first: footage?.first ?? 0 } }
}
