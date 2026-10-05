import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditor } from '../../src/renderer/src/store'

/**
 * Paste and duplicate through the store, with a fake bridge: a self-drawn
 * clip's copy gets an asset of its OWN, its bake lands there, and editing the
 * copy leaves the original's record alone (shared/edit/recipes.ts
 * pasteClipboard; store.ts placeCopies).
 *
 * Before the fix the copy kept the source's `assetId`. The export rebakes
 * every generated card and repoints the record BY ASSET ID (exportBake.ts),
 * so with two clips over one record the last bake won and one card exported
 * with the other's picture.
 */

const renders: { clipId: string; color: string }[] = []

beforeEach(() => {
  renders.length = 0
  vi.stubGlobal('window', {
    forge: {
      // The colour card's picture: a file named by the CLIP, as main writes it.
      renderSolid: async (o: { color: string; opacity: number; width: number; height: number; clipId: string }) => {
        renders.push({ clipId: o.clipId, color: o.color })
        return `/baked/${o.clipId}.png`
      },
      placeAsset: async (file: string) => ({
        id: `asset-${file.split('/').pop()!.replace('.png', '')}`,
        path: file,
        name: 'Colour',
        kind: 'image' as const,
        durationFrames: 90,
        width: 1920,
        height: 1080,
        fps: null,
        hasVideo: true,
        hasAudio: false,
        size: 0
      })
    }
  })
  useEditor.setState(useEditor.getInitialState())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const state = () => useEditor.getState()

describe('pasting a self-drawn clip', () => {
  it('gives the copy its own asset record, baked under the copy’s id', async () => {
    const original = (await state().addSolidClip('v1', 0))!
    expect(original).toBeTruthy()
    const before = state().project.clips.find((c) => c.id === original)!

    state().select(original)
    await state().duplicateSelection()

    const clips = state().project.clips
    expect(clips).toHaveLength(2)
    const copy = clips.find((c) => c.id !== original)!
    // Two clips, two records.
    expect(copy.assetId).not.toBe(before.assetId)
    const ids = state().project.assets.map((a) => a.id)
    expect(ids).toContain(before.assetId)
    expect(ids).toContain(copy.assetId)
    expect(new Set(ids).size).toBe(ids.length)
    // And the copy's bake was asked for under the COPY's id, not the source's.
    expect(renders.map((r) => r.clipId)).toContain(copy.id)
  })

  it('keeps the original untouched when the copy is edited', async () => {
    const original = (await state().addSolidClip('v1', 0))!
    state().select(original)
    await state().duplicateSelection()
    const copy = state().project.clips.find((c) => c.id !== original)!
    const originalAssetBefore = state().project.assets.find((a) => a.id === state().project.clips.find((c) => c.id === original)!.assetId)!

    renders.length = 0
    await state().setSolid(copy.id, { color: '#ff0000' })

    const after = state().project
    expect(after.clips.find((c) => c.id === copy.id)!.solid!.color).toBe('#ff0000')
    expect(after.clips.find((c) => c.id === original)!.solid!.color).toBe('#000000')
    // The edit rendered the copy's picture only, and the original's record is as it was.
    expect(renders).toEqual([{ clipId: copy.id, color: '#ff0000' }])
    expect(after.assets.find((a) => a.id === originalAssetBefore.id)).toEqual(originalAssetBefore)
  })
})
