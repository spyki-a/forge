import { beforeEach, describe, expect, it } from 'vitest'
import { emptyProject, type Clip, type MediaAsset } from '@shared/timeline'
import { FOLDOUT_START } from '@shared/foldout'
import { useEditor } from '../../src/renderer/src/store'

/*
 * The fold-out panel in the store (store.ts `foldout`, `openFoldout`,
 * `closeFoldout`, `toggleFoldout`; the rules are shared/foldout.ts).
 *
 * Session state, as the Curve tray's is: opening, switching and closing it is
 * not an edit, so none of it may leave an undo step, mark the project dirty,
 * or touch the project at all. Each action is done on a project with a
 * history and a clean flag, and those must be exactly as they were.
 */

const photo: MediaAsset = {
  id: 'p', path: '/p/p.jpg', name: 'p.jpg', kind: 'image', durationFrames: 150,
  width: 1600, height: 1067, fps: null, hasVideo: true, hasAudio: false, size: 10
}

const clip = (id: string, start: number): Clip => ({
  id, assetId: 'p', trackId: 'v1', start, duration: 60, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  color: { brightness: 0, contrast: 1, saturation: 1 }
})

const state = () => useEditor.getState()

beforeEach(() => {
  state().loadProject({ ...emptyProject(), assets: [photo], clips: [clip('a', 0)] }, '', [])
  useEditor.setState({ foldout: FOLDOUT_START })
  // One real edit, so there is a history whose length can be watched, then saved clean.
  state().select('a')
  state().setKeyframe('a', 'zoom', 10, 1.4)
  state().markSaved('/x/p.forge')
})

describe('the fold-out panel in the store', () => {
  it('starts shut, on Clips, on the link’s words', () => {
    expect(useEditor.getInitialState().foldout).toEqual({ open: false, tab: 'clips', words: 'link' })
  })

  it('opens, switches, closes and toggles as the rules say', () => {
    state().openFoldout('clips')
    expect(state().foldout).toEqual({ open: true, tab: 'clips', words: 'link' })
    // The other tab: switches.
    state().toggleFoldout('transcript', 'clip')
    expect(state().foldout).toEqual({ open: true, tab: 'transcript', words: 'clip' })
    // The tab already showing: closes, keeping where it was.
    state().toggleFoldout('transcript', 'clip')
    expect(state().foldout).toEqual({ open: false, tab: 'transcript', words: 'clip' })
    // Shut: a toggle opens.
    state().toggleFoldout('clips')
    expect(state().foldout).toEqual({ open: true, tab: 'clips', words: 'clip' })
    state().closeFoldout()
    expect(state().foldout.open).toBe(false)
    // Open with words names them.
    state().openFoldout('transcript', 'link')
    expect(state().foldout).toEqual({ open: true, tab: 'transcript', words: 'link' })
  })

  it('leaves no undo step, never marks the project dirty, and leaves the project alone', () => {
    const { past, future, project } = state()
    expect(past.length).toBeGreaterThan(0)
    expect(state().dirty).toBe(false)
    state().openFoldout('clips')
    state().toggleFoldout('transcript', 'clip')
    state().toggleFoldout('transcript', 'clip')
    state().openFoldout('transcript', 'link')
    state().closeFoldout()
    expect(state().past).toBe(past)
    expect(state().future).toBe(future)
    expect(state().project).toBe(project)
    expect(state().dirty).toBe(false)
  })

  it('is left alone by opening another project, as the rest of the window’s layout is', () => {
    state().openFoldout('transcript', 'clip')
    state().loadProject({ ...emptyProject() }, '', [])
    expect(state().foldout).toEqual({ open: true, tab: 'transcript', words: 'clip' })
    state().newProject()
    expect(state().foldout).toEqual({ open: true, tab: 'transcript', words: 'clip' })
  })
})

/*
 * The one open fold-down list (store.ts `foldDownOpen`, components/ui/FoldDown.tsx):
 * held in the store so Best clips' Duration keeps no hook of its own. View
 * state, as the panel's is.
 */
describe('the open fold-down list in the store', () => {
  it('starts with none open, holds one by its id, and opening another folds the last', () => {
    expect(useEditor.getInitialState().foldDownOpen).toBe(null)
    state().setFoldDownOpen('best-length')
    expect(state().foldDownOpen).toBe('best-length')
    state().setFoldDownOpen('another')
    expect(state().foldDownOpen).toBe('another')
    state().setFoldDownOpen(null)
    expect(state().foldDownOpen).toBe(null)
  })

  it('leaves no undo step, never marks the project dirty, and leaves the project alone', () => {
    const { past, future, project } = state()
    state().setFoldDownOpen('best-length')
    state().setFoldDownOpen(null)
    expect(state().past).toBe(past)
    expect(state().future).toBe(future)
    expect(state().project).toBe(project)
    expect(state().dirty).toBe(false)
  })
})
