import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyProject, type Clip, type Project } from '@shared/timeline'
import type { DragPayload } from '@shared/dragPayload'
import { libraryDragPayload, libraryGraphic } from '@shared/graphics/library'
import { dropOnCanvas, dropOnTrack, type CanvasDropActions, type TrackDropActions } from '../../src/renderer/src/dropHandlers'

/*
 * Try-out 1 (2026-11-15), piece 6's fixes: what a drop on a timeline track
 * and a drop on the picture DO (src/renderer/src/dropHandlers.ts), with the
 * store's actions recorded. A tile of the Library's Graphics drawer reaches
 * placeLibraryGraphic with the dropped track and frame on the timeline, and
 * on the picture with neither (the store's playhead and top track), never
 * reaching applyDropIntent or the fill chip; every other kind behaves as
 * before. And the two components call these, not a copy of their own.
 */

const root = join(__dirname, '..', '..')

const sticker: DragPayload = { kind: 'sticker', file: 'stickers/heart.png', name: 'heart' }
const sfx: DragPayload = { kind: 'sfx', file: 'sfx/pop.wav', name: 'pop' }
const transition: DragPayload = { kind: 'transition', file: '', name: 'Wipe', transitionId: 'wipe' }
const graphicOf = (id: 'counter' | 'steps'): DragPayload => libraryDragPayload(libraryGraphic(id)!)

interface Calls { log: string[] }

function base(): { project: Project; calls: Calls } {
  return { project: emptyProject('drops'), calls: { log: [] } }
}

/** A clip appears in the project when an asset is placed, as the store's placing does, so the chip has something to belong to. */
const made = (id: string, trackId: string, start: number): Clip => ({
  id, assetId: id, trackId, start, duration: 30, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 }
})

function canvasActions(): { a: CanvasDropActions; calls: Calls } {
  const s = base()
  const a: CanvasDropActions = {
    project: () => s.project,
    playhead: 75,
    notify: (text) => void s.calls.log.push(`notify ${text}`),
    placePoolAsset: (id, t, f) => void s.calls.log.push(`pool ${id} ${t} ${f}`),
    placeTitle: async (tpl, _n, t, f) => void s.calls.log.push(`title ${tpl} ${t} ${f}`),
    placeLibraryGraphic: (...args) => {
      s.calls.log.push(`graphic ${JSON.stringify(args)}`)
      return null
    },
    placeLibraryAsset: async (file, _n, t, f) => {
      s.calls.log.push(`asset ${file} ${t} ${f}`)
      s.project = { ...s.project, clips: [...s.project.clips, made('new', t, f)] }
    },
    applyDropIntent: (id, intent) => void s.calls.log.push(`intent ${id} ${intent}`),
    setDropChip: (chip) => void s.calls.log.push(`chip ${chip.clipId} ${chip.intent}`)
  }
  return { a, calls: s.calls }
}

function trackActions(): { a: TrackDropActions; calls: Calls } {
  const s = base()
  const a: TrackDropActions = {
    project: () => s.project,
    notify: (text) => void s.calls.log.push(`notify ${text}`),
    setTransition: (id, t) => void s.calls.log.push(`transition ${id} ${t}`),
    select: (id) => void s.calls.log.push(`select ${id}`),
    placePoolAsset: (id, t, f) => void s.calls.log.push(`pool ${id} ${t} ${f}`),
    placeTitle: async (tpl, _n, t, f) => void s.calls.log.push(`title ${tpl} ${t} ${f}`),
    placeLibraryGraphic: (...args) => {
      s.calls.log.push(`graphic ${JSON.stringify(args)}`)
      return null
    },
    placeLibraryAsset: async (file, _n, t, f) => void s.calls.log.push(`asset ${file} ${t} ${f}`)
  }
  return { a, calls: s.calls }
}

describe('a drop on the picture (dropOnCanvas)', () => {
  it('sends a graphic to placeLibraryGraphic with only its template, and never fills it or offers the chip', async () => {
    const { a, calls } = canvasActions()
    await dropOnCanvas(graphicOf('counter'), a)
    expect(calls.log).toEqual(['graphic ["counter"]'])
  })

  it('still fills a picture and offers the chip, on the top video track at the playhead', async () => {
    const { a, calls } = canvasActions()
    await dropOnCanvas(sticker, a)
    expect(calls.log).toEqual(['asset stickers/heart.png v2 75', 'intent new fill', 'chip new fill'])
  })

  it('refuses a sound and a transition with their notices', async () => {
    const { a, calls } = canvasActions()
    await dropOnCanvas(sfx, a)
    await dropOnCanvas(transition, a)
    await dropOnCanvas(null, a)
    expect(calls.log).toEqual(['notify Sounds go on an audio track, not on the picture', 'notify A transition goes on a cut in the timeline'])
  })
})

describe('a drop on a timeline track (dropOnTrack)', () => {
  it('lands a graphic on the dropped video track at the dropped frame', async () => {
    const { a, calls } = trackActions()
    await dropOnTrack(graphicOf('steps'), 'v1', 'video', 300, a)
    expect(calls.log).toEqual(['graphic ["steps","v1",300]'])
  })

  it('refuses a graphic on an audio track with the existing notice, placing nothing', async () => {
    const { a, calls } = trackActions()
    await dropOnTrack(graphicOf('counter'), 'a1', 'audio', 300, a)
    expect(calls.log).toEqual(['notify That belongs on a video track'])
  })

  it('places a picture and a sound as before, and refuses a sound on a video track', async () => {
    const { a, calls } = trackActions()
    await dropOnTrack(sticker, 'v2', 'video', 40, a)
    await dropOnTrack(sfx, 'a1', 'audio', 50, a)
    await dropOnTrack(sfx, 'v1', 'video', 50, a)
    expect(calls.log).toEqual(['asset stickers/heart.png v2 40', 'asset sfx/pop.wav a1 50', 'notify Sounds go on an audio track'])
  })
})

describe('the two components call these handlers', () => {
  const source = (file: string): string => readFileSync(join(root, 'src/renderer/src/components', file), 'utf8')

  it('Preview’s onCanvasDrop is dropOnCanvas, and no other fill-on-drop is left in it', () => {
    const preview = source('Preview.tsx')
    expect([...preview.matchAll(/const onCanvasDrop = useCallback\(\s*\(payload: DragPayload \| null\): Promise<void> =>\s*dropOnCanvas\(payload,/g)]).toHaveLength(1)
    expect(preview).not.toMatch(/applyDropIntent\([^)]*'fill'\)/)
  })

  it('Timeline’s handleDrop is dropOnTrack', () => {
    const timeline = source('Timeline.tsx')
    expect([...timeline.matchAll(/const handleDrop = useCallback\([^]*?=>\s*dropOnTrack\(payload, trackId, trackKind, frame,/g)]).toHaveLength(1)
    expect(timeline).not.toContain('placeLibraryGraphic(payload.template')
  })
})
