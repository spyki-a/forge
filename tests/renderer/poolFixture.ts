import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import type { GraphicSpec } from '@shared/graphics/template'
import { CLIPS_GRAPHIC_RULE } from '@shared/graphics/apply'
import { DEFAULT_CAROUSEL } from '@shared/render/carousel'

/*
 * One project for Remove from project's tests (tests/removeAssets.test.ts,
 * tests/renderer/poolRemove.test.tsx): a talk video played by three clips,
 * a second video ("keep") with its own records, photos in a card ring, a
 * graphic whose drawn asset is in the pool with a sound that follows it and
 * the file that sound brought, and a record of every kind the project keeps
 * by asset id, for both videos. Records are opaque to the removal, so each is
 * a small marked object rather than a real bake, track or look.
 */

export function asset(id: string, patch: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id,
    path: `/media/${id}.mp4`,
    name: `${id}.mp4`,
    kind: 'video',
    durationFrames: 300,
    width: 1920,
    height: 1080,
    fps: 30,
    hasVideo: true,
    hasAudio: true,
    size: 1024,
    ...patch
  }
}

export function clip(id: string, assetId: string, trackId: string, start: number, patch: Partial<Clip> = {}): Clip {
  return { id, assetId, trackId, start, duration: 90, inPoint: 0, volume: 1, transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR }, ...patch }
}

const spec = (patch: Partial<GraphicSpec> = {}): GraphicSpec => ({
  data: { template: 'counter', value: '7', label: 'seven' },
  seconds: 3,
  beats: [1],
  place: { auto: true, third: 'top' },
  seed: 1,
  version: 1,
  ...patch
})

const record = (id: string): never => ({ mark: id }) as never

/** The project: see the comment above. Fresh objects on every call. */
export function poolProject(): Project {
  const base = emptyProject('pool')
  const v1 = 'v1'
  const a1 = 'a1'
  return {
    ...base,
    assets: [
      asset('talk'),
      asset('keep'),
      asset('photo-a', { kind: 'image', path: '/media/photo-a.jpg', name: 'photo-a.jpg', hasAudio: false, fps: null }),
      asset('photo-b', { kind: 'image', path: '/cache/photo-b.png', source: '/media/Bride 5:30pm.heic', name: 'Bride 5:30pm.heic', hasAudio: false, fps: null }),
      asset('unused', { kind: 'image', path: '/media/unused.jpg', name: 'unused.jpg', hasAudio: false, fps: null }),
      asset('ring-mixed-card', { kind: 'image', path: '', name: 'card ring', hasAudio: false, fps: null }),
      asset('ring-only-card', { kind: 'image', path: '', name: 'card ring', hasAudio: false, fps: null }),
      asset('drawn', { kind: 'image', path: '/cache/graphic.png', name: 'graphic', hasAudio: false, fps: null }),
      asset('whoosh', { kind: 'audio', path: '/lib/whoosh.wav', name: 'whoosh.wav', broughtBy: CLIPS_GRAPHIC_RULE, fps: null, hasVideo: false })
    ],
    clips: [
      clip('talk-1', 'talk', v1, 0),
      clip('talk-2', 'talk', v1, 90, { transitionIn: { id: 'fade', durationFrames: 10 } }),
      clip('keep-1', 'keep', v1, 180),
      clip('talk-3', 'talk', v1, 270),
      clip('photo-a-1', 'photo-a', v1, 360, { matte: { clipId: 'talk-1' } }),
      clip('ring-mixed', 'ring-mixed-card', 'v2', 0, { carousel: { ...DEFAULT_CAROUSEL, assetIds: ['photo-a', 'photo-b'] } }),
      clip('ring-only', 'ring-only-card', 'v2', 100, { carousel: { ...DEFAULT_CAROUSEL, assetIds: ['photo-b', 'photo-b'] } }),
      clip('graphic-1', 'drawn', 'v2', 200, { graphic: spec({ grounding: { assetId: 'talk', sentence: 's', words: [] } }), generatedBy: { rule: CLIPS_GRAPHIC_RULE, reason: 'r' } }),
      clip('sound-1', 'whoosh', a1, 200, { forGraphic: 'graphic-1' })
    ],
    transcripts: { talk: record('talk-transcript'), keep: record('keep-transcript') },
    parallax: { 'photo-b': record('photo-b-planes'), 'photo-a': record('photo-a-planes'), talk: record('talk-planes') },
    vision: { talk: record('talk-vision'), keep: record('keep-vision') },
    subjects: { talk: record('talk-subjects'), keep: record('keep-subjects') },
    graphicProposals: [
      { id: 'on-talk-clip', clipId: 'talk-2', spec: spec(), rule: CLIPS_GRAPHIC_RULE, note: '' },
      { id: 'grounded-in-talk', clipId: 'keep-1', spec: spec({ grounding: { assetId: 'talk', sentence: 's', words: [] } }), rule: CLIPS_GRAPHIC_RULE, note: '' },
      { id: 'anchored-on-talk', clipId: 'keep-1', spec: spec({ anchor: { assetId: 'talk', event: 'e' } }), rule: CLIPS_GRAPHIC_RULE, note: '' },
      { id: 'on-keep', clipId: 'keep-1', spec: spec({ grounding: { assetId: 'keep', sentence: 's', words: [] } }), rule: CLIPS_GRAPHIC_RULE, note: '' }
    ]
  }
}
