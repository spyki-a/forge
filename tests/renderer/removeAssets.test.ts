import { describe, expect, it } from 'vitest'
import { assetClipCount, assetClipsGoing, removeAssets } from '@shared/edit/removeAssets'
import { removeWithFollowers } from '@shared/graphics/apply'
import { removeMany } from '@shared/edit/recipes'
import { asset, poolProject } from './poolFixture'

/*
 * Remove from project, the pure half (src/shared/edit/removeAssets.ts): a
 * file out of the PROJECT, its clips removed as the timeline's Delete removes
 * them, and every record the project keeps by its id or by those clips.
 * Each assertion is about the thing removed or the thing that must stay —
 * membership — never the whole project written out, so a record kind added
 * later does not fail a test that was right.
 */

const ids = (list: { id: string }[]): string[] => list.map((x) => x.id)

describe('removeAssets', () => {
  it('takes the file and every clip that plays it, as the timeline’s Delete takes those clips', () => {
    const before = poolProject()
    const after = removeAssets(before, ['talk'])
    expect(ids(after.assets)).not.toContain('talk')
    for (const id of ['talk-1', 'talk-2', 'talk-3']) expect(ids(after.clips)).not.toContain(id)
    // The same clips the timeline's Delete would leave, the same objects.
    const deleted = removeWithFollowers(before, ['talk-1', 'talk-2', 'talk-3'], removeMany)
    for (const c of deleted.clips) expect(after.clips).toContain(c)
  })

  it('takes the file’s transcript, depth planes, vision and subject track, and leaves another file’s', () => {
    const before = poolProject()
    const after = removeAssets(before, ['talk'])
    expect(Object.keys(after.transcripts)).not.toContain('talk')
    expect(Object.keys(after.parallax!)).not.toContain('talk')
    expect(Object.keys(after.vision!)).not.toContain('talk')
    expect(Object.keys(after.subjects!)).not.toContain('talk')
    expect(after.transcripts.keep).toBe(before.transcripts.keep)
    expect(after.parallax!['photo-a']).toBe(before.parallax!['photo-a'])
    expect(after.vision!.keep).toBe(before.vision!.keep)
    expect(after.subjects!.keep).toBe(before.subjects!.keep)
  })

  it('takes the proposals on its clips, grounded in its words or anchored on it, and leaves another file’s', () => {
    const before = poolProject()
    const after = removeAssets(before, ['talk'])
    const left = ids(after.graphicProposals!)
    expect(left).not.toContain('on-talk-clip')
    expect(left).not.toContain('grounded-in-talk')
    expect(left).not.toContain('anchored-on-talk')
    expect(after.graphicProposals).toContain(before.graphicProposals!.find((g) => g.id === 'on-keep'))
  })

  it('changes nothing else: another file, its clips, the tracks, the settings, the captions', () => {
    const before = poolProject()
    const after = removeAssets(before, ['talk'])
    expect(after.assets).toContain(before.assets.find((a) => a.id === 'keep'))
    expect(after.clips).toContain(before.clips.find((c) => c.id === 'keep-1'))
    // A clip whose matte named a removed clip is left as the timeline's Delete leaves it.
    expect(after.clips).toContain(before.clips.find((c) => c.id === 'photo-a-1'))
    expect(after.tracks).toBe(before.tracks)
    expect(after.settings).toBe(before.settings)
    expect(after.captions).toBe(before.captions)
    expect(after.id).toBe(before.id)
  })

  it('takes a graphic’s sound and the file it brought with the graphic, as the timeline does', () => {
    const before = poolProject()
    const after = removeAssets(before, ['drawn'])
    expect(ids(after.clips)).not.toContain('graphic-1')
    expect(ids(after.clips)).not.toContain('sound-1')
    expect(ids(after.assets)).not.toContain('whoosh')
    expect(ids(after.assets)).toContain('talk')
  })

  it('takes a card ring made only of the photo, and takes the photo out of a ring that has others', () => {
    const before = poolProject()
    // Both rings show it; only the ring made of nothing else goes with it.
    expect(assetClipCount(before, 'photo-b')).toBe(2)
    expect(assetClipsGoing(before, 'photo-b')).toBe(1)
    const after = removeAssets(before, ['photo-b'])
    expect(ids(after.clips)).not.toContain('ring-only')
    const mixed = after.clips.find((c) => c.id === 'ring-mixed')
    expect(mixed?.carousel?.assetIds).toEqual(['photo-a'])
    expect(Object.keys(after.parallax!)).not.toContain('photo-b')
    expect(after.parallax!['photo-a']).toBe(before.parallax!['photo-a'])
  })

  it('counts the clips that show a file, and those of them that go with it', () => {
    const project = poolProject()
    expect(assetClipCount(project, 'talk')).toBe(3)
    expect(assetClipCount(project, 'keep')).toBe(1)
    expect(assetClipCount(project, 'unused')).toBe(0)
    // Its own clip and the ring it shares with photo-b: both show it, so both are asked about; only its own goes.
    expect(assetClipCount(project, 'photo-a')).toBe(2)
    expect(assetClipsGoing(project, 'photo-a')).toBe(1)
    expect(assetClipsGoing(project, 'talk')).toBe(3)
  })

  it('counts a photo that only a ring with other photos shows: one clip shows it, none goes, the ring keeps the rest', () => {
    const base = poolProject()
    const project = {
      ...base,
      assets: [...base.assets, asset('photo-c', { kind: 'image', path: '/media/photo-c.jpg', hasAudio: false, fps: null })],
      clips: base.clips.map((c) => (c.id === 'ring-mixed' ? { ...c, carousel: { ...c.carousel!, assetIds: ['photo-a', 'photo-c'] } } : c))
    }
    expect(assetClipCount(project, 'photo-c')).toBe(1)
    expect(assetClipsGoing(project, 'photo-c')).toBe(0)
    const after = removeAssets(project, ['photo-c'])
    expect(after.clips.find((c) => c.id === 'ring-mixed')?.carousel?.assetIds).toEqual(['photo-a'])
    expect(ids(after.assets)).toContain('ring-mixed-card')
  })

  it('takes the drawn asset of a ring that went with the photo, never another ring’s', () => {
    const before = poolProject()
    const after = removeAssets(before, ['photo-b'])
    expect(ids(after.assets)).not.toContain('ring-only-card')
    expect(ids(after.assets)).toContain('ring-mixed-card')
  })

  it('takes an unused file alone, and gives the same project back for a file that is not there', () => {
    const before = poolProject()
    const after = removeAssets(before, ['unused'])
    expect(ids(after.assets)).not.toContain('unused')
    expect(after.clips).toBe(before.clips)
    expect(removeAssets(before, ['nothing'])).toBe(before)
  })
})
