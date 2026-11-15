import { nearestTransitionTarget, type Project } from '@shared/timeline'
import type { DropIntent } from '@shared/render/dropIntent'
import { canvasDropChip, canvasDropRoute, trackDropRoute, type DragPayload } from '@shared/dragPayload'

/*
 * What a drop on a timeline track and a drop on the picture DO, given the
 * store's actions: Timeline's handleDrop and Preview's onCanvasDrop call these
 * with the real ones, a test with fakes. Pulled out of the two components
 * (try-out 1, 2026-11-15, piece 6's fixes) because neither handler had a test,
 * and a graphic from the Library's Graphics drawer must reach
 * placeLibraryGraphic with the dropped track and frame on the timeline, and
 * on the picture never reach applyDropIntent or the fill chip.
 */

type Notify = (text: string, tone?: 'error' | 'info') => void

export interface TrackDropActions {
  project: () => Project
  notify: Notify
  setTransition: (clipId: string, transitionId: string) => void
  select: (clipId: string | null) => void
  placePoolAsset: (assetId: string, trackId: string, startFrame: number) => void
  placeTitle: (template: string, name: string, trackId: string, startFrame: number) => Promise<void>
  placeLibraryGraphic: (templateId: string, trackId?: string, frame?: number) => string | null
  placeLibraryAsset: (file: string, name: string, trackId: string, startFrame: number) => Promise<void>
}

/**
 * A transition attaches to a cut, everything else becomes a clip.
 *
 * Dropping a transition onto a clip applies it to that clip's incoming edge,
 * which is the only place a transition can live — so it is rejected anywhere
 * else rather than silently doing nothing.
 */
export async function dropOnTrack(
  payload: DragPayload,
  trackId: string,
  trackKind: 'video' | 'audio',
  frame: number,
  a: TrackDropActions
): Promise<void> {
  const route = trackDropRoute(payload, trackKind)
  if (route === 'refuse') {
    a.notify(payload.kind === 'sfx' ? 'Sounds go on an audio track' : 'That belongs on a video track', 'info')
    return
  }

  if (route === 'transition') {
    // Snap to the nearest cut within half a second of the drop.
    const project = a.project()
    const tolerance = Math.round(project.settings.fps / 2)
    const result = nearestTransitionTarget(project, trackId, frame, tolerance)
    if (!result.clip) {
      // Previously this failed silently, which looked exactly like the drop
      // not registering at all.
      a.notify(result.reason, 'info')
      return
    }
    if (!payload.transitionId) return
    a.setTransition(result.clip.id, payload.transitionId)
    a.select(result.clip.id)
    a.notify(`${payload.name} applied`, 'info')
    return
  }

  // Already imported: reuse the asset rather than reading the file again,
  // which would put a second copy of the same photograph in the pool.
  if (route === 'pool' && payload.assetId) {
    a.placePoolAsset(payload.assetId, trackId, frame)
    return
  }

  // Titles are generated from a template rather than placed as a file.
  if (route === 'title') {
    await a.placeTitle(payload.file, payload.name, trackId, frame)
    return
  }

  // A graphic from the Library's Graphics drawer: drawn by the engine, on the dropped track at the dropped frame (graphics/library.ts).
  if (route === 'graphic') {
    if (payload.template) a.placeLibraryGraphic(payload.template, trackId, frame)
    return
  }

  await a.placeLibraryAsset(payload.file, payload.name, trackId, frame)
}

export interface CanvasDropActions {
  project: () => Project
  playhead: number
  notify: Notify
  placePoolAsset: (assetId: string, trackId: string, startFrame: number) => void
  placeTitle: (template: string, name: string, trackId: string, startFrame: number) => Promise<void>
  placeLibraryGraphic: (templateId: string, trackId?: string, frame?: number) => string | null
  placeLibraryAsset: (file: string, name: string, trackId: string, startFrame: number) => Promise<void>
  applyDropIntent: (clipId: string, intent: DropIntent) => void
  setDropChip: (chip: { clipId: string; intent: DropIntent }) => void
}

/**
 * Something dropped on the picture.
 *
 * It lands on the top video track at the playhead — "here, over this" is what
 * the gesture means — filling the frame, because a clip has to look like
 * something the instant it arrives. The chip then offers the other two.
 *
 * Audio is refused rather than quietly placed: a sound has no appearance, so
 * there is nothing for the canvas to say about it and nothing for the chip to
 * offer. The timeline is where a sound goes.
 */
export async function dropOnCanvas(payload: DragPayload | null, a: CanvasDropActions): Promise<void> {
  if (!payload) return
  const route = canvasDropRoute(payload)
  if (route === 'refuse-sound') {
    a.notify('Sounds go on an audio track, not on the picture', 'info')
    return
  }
  if (route === 'refuse-transition') {
    a.notify('A transition goes on a cut in the timeline', 'info')
    return
  }
  /*
   * A graphic from the Library's Graphics drawer: the store lands it on the
   * top unlocked video track at the playhead, selected (the dock opens on
   * its Graphic panel). No fill and no chip: a graphic draws itself in its
   * own third over the whole frame, and the chip's fill or fit would scale
   * that frame and send the clip to the back or the front, which is not a
   * choice a graphic has (canvasDropChip).
   */
  if (route === 'graphic') {
    if (payload.template) a.placeLibraryGraphic(payload.template)
    return
  }

  const tracks = a.project().tracks.filter((t) => t.kind === 'video' && !t.locked)
  const top = tracks[tracks.length - 1]
  if (!top) return
  const before = new Set(a.project().clips.map((c) => c.id))

  if (route === 'pool' && payload.assetId) {
    a.placePoolAsset(payload.assetId, top.id, a.playhead)
  } else if (route === 'title') {
    await a.placeTitle(payload.file, payload.name, top.id, a.playhead)
  } else {
    await a.placeLibraryAsset(payload.file, payload.name, top.id, a.playhead)
  }

  // Whichever clip is new is the one the chip belongs to. Asked after the
  // fact rather than threaded back, because each of those three places a
  // clip its own way and only one of them returns an id.
  const made = a.project().clips.find((c) => !before.has(c.id))
  if (!made || !canvasDropChip(route)) return
  a.applyDropIntent(made.id, 'fill')
  a.setDropChip({ clipId: made.id, intent: 'fill' })
}
