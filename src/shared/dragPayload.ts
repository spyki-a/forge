import type { AssetKind } from './assets/catalog'
import type { GraphicTemplateId } from './graphics/template'

/**
 * What a library item carries while being dragged.
 *
 * A private MIME type rather than text/plain: the timeline must distinguish an
 * internal library drag from a file dropped in from Finder, because they are
 * different operations — one places a catalog asset, the other imports media.
 */
export const DRAG_MIME = 'application/x-forge-asset'

export interface DragPayload {
  /**
   * `media` is an asset already in the pool; `graphic` a tile of the
   * Library's Graphics drawer (graphics/library.ts), which is no file;
   * everything else comes from the library and still has to be read off disk.
   */
  kind: AssetKind | 'media' | 'graphic'
  /** Path relative to the assets root — or absolute, for a pool asset; '' for a graphic. */
  file: string
  name: string
  /** Transition id, for transition drags. */
  transitionId?: string
  /** Set for a pool drag: the asset is imported and probed already. */
  assetId?: string
  /** What a pool asset actually is, since `kind` only says where it came from. */
  mediaKind?: 'video' | 'audio' | 'image'
  /** The template, for a graphic drag. */
  template?: GraphicTemplateId
}

/** Which track kinds a payload may be dropped onto. */
export function acceptsKind(payload: DragPayload, trackKind: 'video' | 'audio'): boolean {
  // A pool asset goes where its own kind belongs: a song on an audio track, a
  // photograph on a video one. `kind` alone cannot answer this, which is what
  // `mediaKind` is for.
  if (payload.kind === 'media') {
    return payload.mediaKind === 'audio' ? trackKind === 'audio' : trackKind === 'video'
  }
  if (payload.kind === 'sfx') return trackKind === 'audio'
  if (payload.kind === 'transition') return trackKind === 'video'
  // A graphic is drawn over the picture: a video track only.
  if (payload.kind === 'graphic') return trackKind === 'video'
  // Props, stickers and titles are pictures: they belong on a video track.
  return trackKind === 'video'
}

/**
 * What a drop on a timeline track does (Timeline.tsx `handleDrop`): refused
 * (the track's kind is not the payload's), a transition onto a cut, a pool
 * asset placed again, a title made from its template, a Library graphic
 * placed at the frame (the store's `placeLibraryGraphic`), else a library
 * file read off disk.
 */
export type TrackDropRoute = 'refuse' | 'transition' | 'pool' | 'title' | 'graphic' | 'asset'

export function trackDropRoute(payload: DragPayload, trackKind: 'video' | 'audio'): TrackDropRoute {
  if (!acceptsKind(payload, trackKind)) return 'refuse'
  if (payload.kind === 'transition') return 'transition'
  if (payload.kind === 'media' && payload.assetId) return 'pool'
  if (payload.kind === 'title') return 'title'
  if (payload.kind === 'graphic') return 'graphic'
  return 'asset'
}

/**
 * What a drop on the picture does (Preview.tsx `onCanvasDrop`): a sound or a
 * transition refused, a Library graphic placed at the playhead on the top
 * video track (no fill chip: a graphic draws itself over the whole frame, so
 * filling or fitting it is not a choice), else a picture placed there and
 * filled, with the chip (`canvasDropChip`).
 */
export type CanvasDropRoute = 'refuse-sound' | 'refuse-transition' | 'pool' | 'title' | 'graphic' | 'asset'

export function canvasDropRoute(payload: DragPayload): CanvasDropRoute {
  if (payload.mediaKind === 'audio' || payload.kind === 'sfx') return 'refuse-sound'
  if (payload.kind === 'transition') return 'refuse-transition'
  if (payload.kind === 'media' && payload.assetId) return 'pool'
  if (payload.kind === 'title') return 'title'
  if (payload.kind === 'graphic') return 'graphic'
  return 'asset'
}

/** Whether a picture drop offers the fill / fit chip: only a clip that is a picture placed (a pool asset, a title, a library file). */
export function canvasDropChip(route: CanvasDropRoute): boolean {
  return route === 'pool' || route === 'title' || route === 'asset'
}
