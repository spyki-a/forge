import { beforeEach, describe, expect, it } from 'vitest'
import { emptyProject, type Clip, type MediaAsset } from '@shared/timeline'
import { defaultMask } from '@shared/render/mask'
import { useEditor } from '../../src/renderer/src/store'

/*
 * The Curve tray never opens by itself (docs/WINDOW.md §3.19).
 *
 * The user's words: "a small side bar on the timeline, only the user uses it
 * when needed". The tray's buttons, its divider and the Inspector's Open keys
 * set `trayOpen`; nothing a person does to a CLIP may — not selecting it, not
 * keying it, not giving it a path or an animated mask. Those are exactly the
 * moments an over-helpful store would pop it open, so each is done here and
 * the tray must still be shut. (tests/curveTray.test.ts has the rest; this
 * needs the store, so it lives with the other store tests.)
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
  state().loadProject({ ...emptyProject(), assets: [photo], clips: [clip('a', 0), clip('b', 60)] }, '', [])
  state().setTrayOpen(false)
  state().setTrayTab('keys')
})

describe('the Curve tray stays shut until someone opens it', () => {
  it('through selecting a clip, keying it, giving it a path and animating its mask', () => {
    state().select('a')
    state().revealClip('b')
    state().select('a')
    state().setPlayhead(10)
    state().setKeyframe('a', 'zoom', 10, 1.4)
    state().setKeyframe('a', 'zoom', 40, 1.1)
    state().addWaypoint('a')
    state().setMask('a', defaultMask('blur'))
    state().animateMask('a', true)
    // The work landed — so a shut tray is the store's choice, not a no-op.
    const a = state().project.clips.find((c) => c.id === 'a')!
    expect(a.keyframes?.zoom).toHaveLength(2)
    expect(a.path).toHaveLength(1)
    expect(Object.keys(a.keyframes ?? {}).some((k) => k.startsWith('mask'))).toBe(true)
    expect(state().trayOpen).toBe(false)
    expect(state().trayTab).toBe('keys')
  })

  it('opens when asked, on the tab asked for', () => {
    state().setTrayTab('curves')
    state().setTrayOpen(true)
    expect(state().trayOpen).toBe(true)
    expect(state().trayTab).toBe('curves')
  })
})
