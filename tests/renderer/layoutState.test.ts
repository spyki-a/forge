import { beforeEach, describe, expect, it } from 'vitest'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { aspectOf, useEditor } from '../../src/renderer/src/store'

/*
 * The new window's layout state, and the three store fixes it leans on
 * (docs/WINDOW.md §6 Step 2, §3.22).
 *
 * - undo/redo carry `aspect` with the project. It is a slice of its own that
 *   every reframe reads, and restoring only the project left a 9:16 switch
 *   undone with the settings at 1920x1080 and the picture still portrait — a
 *   one-tap shape switch on the canvas bar makes that the common case.
 * - revealClip sets BOTH halves of the selection; the dock reads the list. It
 *   drops a selected gap too, as select() does, or Delete closes the gap while
 *   the new clip is the one highlighted.
 * - loadProject clears the selection, the gap and the marks, as newProject
 *   does: they are ids and frames of the project being closed.
 * - The layout fields are view state: newProject and loadProject leave them be.
 *
 * Nothing here touches the bridge: setAspect's rebake returns before it would
 * (no drawn clips), and the rest is pure store.
 */

const photo: MediaAsset = {
  id: 'p', path: '/p/p.jpg', name: 'p.jpg', kind: 'image', durationFrames: 150,
  width: 1080, height: 1350, fps: null, hasVideo: true, hasAudio: false, size: 10
}

const clip = (id: string, start: number): Clip => ({
  id, assetId: 'p', trackId: 'v1', start, duration: 60, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  color: { brightness: 0, contrast: 1, saturation: 1 }
})

const withClips = (): Project => ({ ...emptyProject(), assets: [photo], clips: [clip('a', 0), clip('b', 60), clip('c', 120)] })

const state = () => useEditor.getState()

beforeEach(() => {
  const project = withClips()
  useEditor.setState({
    project,
    aspect: aspectOf(project.settings),
    projectPath: null,
    playhead: 0,
    selectedClipIds: [],
    selectedClipId: null,
    selectedGap: null,
    rangeIn: null,
    rangeOut: null,
    past: [],
    future: [],
    notices: []
  })
})

describe('undo and redo carry the aspect', () => {
  it('a 9:16 switch undone is landscape again, and redone is portrait — the slice agreeing with the settings each time', () => {
    expect(state().aspect).toBe('16:9')
    state().setAspect('9:16')
    expect(state().aspect).toBe('9:16')
    expect(state().project.settings).toMatchObject({ width: 1080, height: 1920 })

    state().undo()
    expect(state().project.settings).toMatchObject({ width: 1920, height: 1080 })
    expect(state().aspect).toBe('16:9')

    state().redo()
    expect(state().project.settings).toMatchObject({ width: 1080, height: 1920 })
    expect(state().aspect).toBe('9:16')
  })

  it('undoing an edit that did not change the shape keeps the shape', () => {
    state().setAspect('1:1')
    state().update((p) => ({ ...p, name: 'Renamed' }))
    state().undo()
    expect(state().project.name).not.toBe('Renamed')
    expect(state().aspect).toBe('1:1')
    state().undo()
    expect(state().aspect).toBe('16:9')
    state().redo()
    expect(state().aspect).toBe('1:1')
  })
})

describe('revealClip selects the clip in both halves of the selection', () => {
  it('replaces whatever was selected before, list and primary alike', () => {
    state().selectMany(['a', 'c'])
    state().revealClip('b')
    expect(state().selectedClipIds).toEqual(['b'])
    expect(state().selectedClipId).toBe('b')
  })

  it('from nothing selected', () => {
    state().revealClip('c')
    expect(state().selectedClipIds).toEqual(['c'])
    expect(state().selectedClipId).toBe('c')
  })

  it('drops a selected gap, so Delete removes the revealed clip and leaves the hole', () => {
    // a@0 and c@120 with a hole from 60 to 120 on v1.
    useEditor.setState({ project: { ...withClips(), clips: [clip('a', 0), clip('c', 120)] } })
    state().selectGapAt('v1', 90)
    expect(state().selectedGap).toEqual({ trackId: 'v1', start: 60, duration: 60 })

    state().revealClip('a')
    expect(state().selectedGap).toBeNull()
    expect(state().selectedClipIds).toEqual(['a'])

    state().deleteSelection()
    const ids = state().project.clips.map((c) => c.id)
    expect(ids).not.toContain('a')
    expect(state().project.clips.find((c) => c.id === 'c')?.start).toBe(120)
  })

  it('an id that is not on the timeline changes nothing', () => {
    state().select('a')
    state().revealClip('gone')
    expect(state().selectedClipIds).toEqual(['a'])
    expect(state().selectedClipId).toBe('a')
  })
})

describe('loadProject clears the selection and the marks, as newProject does', () => {
  it('no clip ids, no gap and no in/out marks survive into the opened file', () => {
    useEditor.setState({
      selectedClipIds: ['a', 'b'],
      selectedClipId: 'a',
      selectedGap: { trackId: 'v1', start: 180, duration: 30 },
      rangeIn: 10,
      rangeOut: 40
    })
    const opened = { ...emptyProject('Opened'), settings: { ...emptyProject().settings, width: 1080, height: 1920 } }
    state().loadProject(opened, '/p/opened.forge', [])
    expect(state().project.name).toBe('Opened')
    expect(state().selectedClipIds).toEqual([])
    expect(state().selectedClipId).toBeNull()
    expect(state().selectedGap).toBeNull()
    expect(state().rangeIn).toBeNull()
    expect(state().rangeOut).toBeNull()
    expect(state().aspect).toBe('9:16')
  })
})

describe('the layout is view state', () => {
  it('starts on the Shelf home with every strip, the tray and the settings closed, on the Keys tab', () => {
    const initial = useEditor.getInitialState()
    expect(initial.shelfTool).toBeNull()
    expect(initial.outputOpen).toBe(false)
    expect(initial.exportOpen).toBe(false)
    expect(initial.trayOpen).toBe(false)
    expect(initial.trayTab).toBe('keys')
    expect(initial.settingsOpen).toBe(false)
  })

  it('each setter sets its own field', () => {
    state().setShelfTool('grid-split')
    expect(state().shelfTool).toBe('grid-split')
    state().setShelfTool(null)
    expect(state().shelfTool).toBeNull()
    state().setOutputOpen(true)
    expect(state().outputOpen).toBe(true)
    state().setExportOpen(true)
    expect(state().exportOpen).toBe(true)
    state().setTrayOpen(true)
    expect(state().trayOpen).toBe(true)
    state().setTrayTab('curves')
    expect(state().trayTab).toBe('curves')
    state().setSettingsOpen(true)
    expect(state().settingsOpen).toBe(true)
  })

  const open = (): void => {
    state().setShelfTool('card-ring')
    state().setOutputOpen(true)
    state().setExportOpen(true)
    state().setTrayOpen(true)
    state().setTrayTab('curves')
    state().setSettingsOpen(true)
  }
  const layout = () => {
    const { shelfTool, outputOpen, exportOpen, trayOpen, trayTab, settingsOpen } = state()
    return { shelfTool, outputOpen, exportOpen, trayOpen, trayTab, settingsOpen }
  }
  const opened = { shelfTool: 'card-ring', outputOpen: true, exportOpen: true, trayOpen: true, trayTab: 'curves', settingsOpen: true }

  it('newProject leaves it alone', () => {
    open()
    state().newProject()
    expect(layout()).toEqual(opened)
  })

  it('loadProject leaves it alone', () => {
    open()
    state().loadProject(emptyProject('Opened'), '/p/opened.forge', [])
    expect(layout()).toEqual(opened)
  })
})
