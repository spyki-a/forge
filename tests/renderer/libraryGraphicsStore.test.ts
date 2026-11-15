import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { clearDirector } from '@shared/director/apply'
import { CLIPS_GRAPHIC_RULE, LIBRARY_GRAPHIC_RULE } from '@shared/graphics/apply'
import { ON_SCREEN_REASON } from '@shared/graphics/budget'
import { GRAPHIC_SOUND_LANE_NAME } from '@shared/graphics/sound'
import { libraryGraphicAt } from '@shared/graphics/library'
import { dockSubject } from '../../src/renderer/src/dock'

/*
 * Try-out 1 (2026-11-15), piece 6: a tile of the Library's Graphics drawer
 * placed through the store (`placeLibraryGraphic`, which lands through
 * `addGraphicClip`): a click (and a drop on the picture) at the playhead on
 * the top unlocked video track, a timeline drop at its frame on its track;
 * ONE undo step, selected, so the dock opens on its Graphic panel; refused
 * as the Transcript tile's Add refuses, with a notice; its sounds on its
 * beats when "Graphic sounds" is on and the library holds them; the owner's,
 * so Clear graphics and Direct's Clear leave it; listed in the Transcript
 * tile's Graphics section with Drop. The store mocked to a plain selector
 * over the REAL store (tests/renderer/transcriptGraphics.test.tsx's way), so
 * the tile's section can be called as a function; the bake a recorder.
 */

vi.mock('../../src/renderer/src/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/src/store')>()
  const store = real.useEditor
  const useEditor = Object.assign((select: (s: unknown) => unknown) => select(store.getState()), {
    getState: store.getState,
    setState: store.setState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe
  })
  return { ...real, useEditor }
})

const bake = vi.hoisted(() => ({ asks: [] as string[] }))
vi.mock('../../src/renderer/src/graphicCanvas', () => ({
  bakeGraphicSequence: async (_spec: unknown, _style: unknown, clipId: string) => {
    bake.asks.push(clipId)
    return null
  },
  forgetGraphicPreview: () => undefined,
  graphicPreviewCanvas: () => null,
  graphicMeasure: () => () => ({ width: 0, ascent: 0, descent: 0 })
}))

const { useEditor, LIBRARY_GRAPHIC_TRACK_NOTE, GRAPHIC_NO_TRACK_NOTE } = await import('../../src/renderer/src/store')
const { useCatalog } = await import('../../src/renderer/src/catalog')
const { TranscriptGraphics, DROP } = await import('../../src/renderer/src/components/TranscriptGraphics')

const FPS = 30

const footage = (id: string, extra: Partial<MediaAsset> = {}): MediaAsset => ({
  id, path: `/media/${id}.mp4`, name: id, kind: 'video', durationFrames: FPS * 60, width: 1080, height: 1920, fps: FPS, hasVideo: true, hasAudio: true, size: 1, ...extra
})
const shotOf = (id: string, assetId: string, start: number): Clip => ({
  id, assetId, trackId: 'v1', start, duration: FPS * 30, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 }
})

function start(over: Partial<Project> = {}, playhead = 60): void {
  const base = emptyProject('library graphics')
  useEditor.setState({
    ...useEditor.getInitialState(),
    project: {
      ...base,
      settings: { ...base.settings, width: 1080, height: 1920, fps: FPS },
      assets: [footage('talk')],
      clips: [shotOf('shot', 'talk', 0)],
      ...over
    },
    playhead,
    selectedClipId: null,
    selectedClipIds: [],
    decisions: [],
    past: [],
    future: [],
    notices: []
  })
}

const state = () => useEditor.getState()
const project = (): Project => state().project
const notices = (): string[] => state().notices.map((n) => n.text)
const graphics = (): Clip[] => project().clips.filter((c) => c.graphic !== undefined)
const soundsOf = (id: string): Clip[] => project().clips.filter((c) => c.forGraphic === id)

/** The library's tick, as the Director reads it (soundPackFor). */
function withSoundLibrary(): void {
  useCatalog.setState({
    catalog: { version: 3, generatedAt: '', scannedFrom: '/lib', entries: [{ id: 'clock', kind: 'sfx', name: 'clock tick', file: 'sfx/clock_tick.wav', tags: [], meta: {} }] },
    root: '/lib'
  })
}

beforeEach(() => {
  bake.asks = []
  useCatalog.setState(useCatalog.getInitialState())
  start()
})

afterEach(() => {
  useCatalog.setState(useCatalog.getInitialState())
})

describe('a click on a tile (and a drop on the picture): the playhead, the top unlocked video track', () => {
  it('lands the graphic there as ONE undo step, the owner’s, selected so the dock opens on it, placed as libraryGraphicAt places it', () => {
    const before = project()
    const past = state().past.length
    expect(state().placeLibraryGraphic('counter')).toBeNull()
    const [g] = graphics()
    expect(g, 'a graphic landed').toBeDefined()
    expect(g.start).toBe(60)
    expect(g.graphic!.data.template).toBe('counter')
    expect(g.generatedBy?.rule).toBe(LIBRARY_GRAPHIC_RULE)
    // The top unlocked video track of the project as it was: V2, above the footage.
    expect(g.trackId).toBe('v2')
    const want = libraryGraphicAt(before, 'counter', 60)
    expect('spec' in want && want.spec).toEqual(g.graphic)
    expect(g.graphic).not.toHaveProperty('grounding')
    expect(state().selectedClipId).toBe(g.id)
    expect(dockSubject(project(), state().selectedClipId, state().audition)).toBe('clip')
    expect(bake.asks).toContain(g.id)
    expect(state().past.length).toBe(past + 1)
    state().undo()
    expect(project()).toEqual(before)
  })

  it('refuses a second click at the same playhead with the Add path’s words, as a notice, and adds nothing', () => {
    state().placeLibraryGraphic('counter')
    const after = project()
    const past = state().past.length
    expect(state().placeLibraryGraphic('ring')).toBe(ON_SCREEN_REASON)
    expect(notices()).toContain(ON_SCREEN_REASON)
    expect(project()).toBe(after)
    expect(state().past.length).toBe(past)
  })

  it('lands above footage on the top track, never on an empty track under it', () => {
    // The footage on V2 and V1 empty: the bottom track would take it, under the picture, where it is never seen.
    start({ clips: [{ ...shotOf('shot', 'talk', 0), trackId: 'v2' }] })
    state().placeLibraryGraphic('ring')
    const [g] = graphics()
    const video = project().tracks.filter((t) => t.kind === 'video').map((t) => t.id)
    expect(video.indexOf(g.trackId), `on ${g.trackId} of ${video.join(', ')}`).toBeGreaterThan(video.indexOf('v2'))
  })

  it('lands on V2 when V2 is the top unlocked track even with V3 locked above it', () => {
    start({ tracks: [...emptyProject().tracks, { id: 'v3', kind: 'video', name: 'V3', muted: false, hidden: false, locked: true }] })
    state().placeLibraryGraphic('ring')
    expect(graphics()[0].trackId).toBe('v2')
  })
})

describe('a drop on the timeline: its frame, its track', () => {
  it('lands at the dropped frame, climbing over the footage on V1', () => {
    expect(state().placeLibraryGraphic('steps', 'v1', 300)).toBeNull()
    const [g] = graphics()
    expect(g.start).toBe(300)
    expect(g.trackId).not.toBe('v1')
  })

  it('refuses an audio track, and a locked one, with the notice and nothing added', () => {
    expect(state().placeLibraryGraphic('steps', 'a1', 300)).toBe(LIBRARY_GRAPHIC_TRACK_NOTE)
    start({ tracks: emptyProject().tracks.map((t) => (t.id === 'v2' ? { ...t, locked: true } : t)) })
    expect(state().placeLibraryGraphic('steps', 'v2', 300)).toBe(LIBRARY_GRAPHIC_TRACK_NOTE)
    expect(graphics()).toEqual([])
    expect(notices()).toContain(LIBRARY_GRAPHIC_TRACK_NOTE)
  })
})

describe('its sounds', () => {
  it('with "Graphic sounds" on and the library holding a tick: a tick on its beat, tied to it, under its rule, in the same undo step', () => {
    withSoundLibrary()
    const before = project()
    state().placeLibraryGraphic('counter')
    const [g] = graphics()
    const [tick] = soundsOf(g.id)
    expect(tick, 'a sound tied to the graphic').toBeDefined()
    expect(tick.generatedBy?.rule).toBe(LIBRARY_GRAPHIC_RULE)
    expect(project().tracks.find((t) => t.id === tick.trackId)?.name).toBe(GRAPHIC_SOUND_LANE_NAME)
    // Delete takes it along (forGraphic).
    state().removeClip(g.id)
    expect(soundsOf(g.id)).toEqual([])
    state().undo()
    state().undo()
    expect(project()).toEqual(before)
  })

  it('lands silent with "Graphic sounds" off, and with no library, with no notice', () => {
    withSoundLibrary()
    start({ graphics: { styleId: 'clean', sound: false } })
    state().placeLibraryGraphic('counter')
    expect(soundsOf(graphics()[0].id)).toEqual([])
    useCatalog.setState(useCatalog.getInitialState())
    start()
    state().placeLibraryGraphic('counter')
    expect(soundsOf(graphics()[0].id)).toEqual([])
    expect(notices()).toEqual([])
  })

  it('gets its tick when "Graphic sounds" is switched on afterwards, as a graphic of a rule does', () => {
    withSoundLibrary()
    start({ graphics: { styleId: 'clean', sound: false } })
    state().placeLibraryGraphic('counter')
    const [g] = graphics()
    expect(soundsOf(g.id)).toEqual([])
    state().setGraphicSounds(true)
    expect(soundsOf(g.id)).toHaveLength(1)
    expect(soundsOf(g.id)[0].generatedBy?.rule).toBe(LIBRARY_GRAPHIC_RULE)
  })
})

describe('whose it is', () => {
  it('stays through Clear graphics with its sound, while a Find graphic beside it goes', () => {
    withSoundLibrary()
    state().placeLibraryGraphic('counter')
    const [lib] = graphics()
    const found: Clip = { ...lib, id: 'find-g', start: 600, graphic: { ...lib.graphic! }, generatedBy: { rule: CLIPS_GRAPHIC_RULE, reason: 'r' } }
    useEditor.setState({ project: { ...project(), clips: [...project().clips, found] } })
    state().clearGraphics()
    const ids = project().clips.map((c) => c.id)
    expect(ids).toContain(lib.id)
    expect(soundsOf(lib.id)).toHaveLength(1)
    expect(ids).not.toContain('find-g')
    // Direct's Clear (the store calls clearDirector) leaves it too.
    expect(clearDirector(project()).clips.map((c) => c.id)).toContain(lib.id)
  })

  it('is listed in the Transcript tile’s Graphics section with Drop, and Drop takes it with its sound', () => {
    withSoundLibrary()
    state().placeLibraryGraphic('lower-third')
    const [lib] = graphics()
    const html = renderToStaticMarkup(createElement(() => TranscriptGraphics({ clip: project().clips.find((c) => c.id === 'shot')!, hasTranscript: false })))
    expect(html).toContain(`data-graphic="${lib.id}"`)
    expect(html).toContain('lower third')
    expect(html).toContain(`>${DROP}</button>`)
    state().dropGraphic(lib.id)
    expect(graphics()).toEqual([])
    expect(soundsOf(lib.id)).toEqual([])
  })
})

describe('at the track ceiling (the fixes of piece 6)', () => {
  /** Twelve video tracks (MAX_TRACKS), each busy over [0, 900): no track is free at frame 60 and none can be added. */
  function full(): void {
    const tracks = Array.from({ length: 12 }, (_, i) => ({ id: `v${i + 1}`, kind: 'video' as const, name: `V${i + 1}`, muted: false, hidden: false, locked: false }))
    const clips = tracks.map((t, i) => ({ ...shotOf(i === 0 ? 'shot' : `s${i}`, 'talk', 0), trackId: t.id }))
    start({ tracks, clips })
  }

  it('refuses a tile with a notice rather than sliding it to frames nobody read it for', () => {
    full()
    const before = project()
    expect(state().placeLibraryGraphic('counter', 'v1', 60)).toBe(GRAPHIC_NO_TRACK_NOTE)
    expect(state().placeLibraryGraphic('counter')).toBe(GRAPHIC_NO_TRACK_NOTE)
    expect(project()).toBe(before)
    expect(graphics()).toEqual([])
    expect(notices()).toEqual([GRAPHIC_NO_TRACK_NOTE, GRAPHIC_NO_TRACK_NOTE])
  })

  it('addGraphicClip itself refuses the slide, so no caller lands a graphic later than asked', async () => {
    full()
    const want = libraryGraphicAt(project(), 'counter', 60)
    if (!('spec' in want)) throw new Error('the counter was refused')
    expect(await state().addGraphicClip('v1', 60, want.spec)).toBeNull()
    expect(graphics()).toEqual([])
    expect(notices()).toEqual([GRAPHIC_NO_TRACK_NOTE])
  })

  it('still lands at its frame where a track is free there', () => {
    full()
    // Frame 950: after every busy clip, so V1 is free and nothing slides.
    expect(state().placeLibraryGraphic('counter', 'v12', 950)).toBeNull()
    expect(graphics().map((g) => g.start)).toEqual([950])
  })
})
