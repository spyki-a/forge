import { describe, expect, it } from 'vitest'
import { reframeOffer } from '@shared/edit/reframeOffer'
import { orientationMismatch } from '@shared/edit/orientation'
import { followCandidates } from '@shared/reframe/follow'
import { DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'

/*
 * The canvas bar's reframe offer (docs/CLIPS.md §4.8): landscape VIDEO on a
 * portrait canvas, not yet following its subject, on the timeline.
 *
 * Its own rule, never a branch of the photo rule (orientation.ts): a landscape
 * talk on a 9:16 canvas is the case where "switch the canvas" is the wrong
 * advice. Which of the two chips the bar SHOWS is pinned where it is decided,
 * in the rendered bar (tests/renderer/reframePanel.test.tsx); here, that each
 * rule would speak, so the bar has a precedence to apply.
 */

const PORTRAIT = { width: 1080, height: 1920 }
const LANDSCAPE = { width: 1920, height: 1080 }
const SQUARE = { width: 1080, height: 1080 }

const asset = (id: string, kind: MediaAsset['kind'], width: number | null, height: number | null): MediaAsset => ({
  id,
  path: `/media/${id}`,
  name: id,
  kind,
  durationFrames: 300,
  width,
  height,
  fps: kind === 'image' ? null : 30,
  hasVideo: kind !== 'audio',
  hasAudio: kind !== 'image',
  size: 1
})
const video = (id: string, width: number | null, height: number | null): MediaAsset => asset(id, 'video', width, height)
const photo = (id: string, width: number, height: number): MediaAsset => asset(id, 'image', width, height)

let start = 0
const clip = (id: string, assetId: string, followed = false): Clip => ({
  id,
  assetId,
  trackId: 'v1',
  start: (start += 100),
  duration: 90,
  inPoint: 0,
  volume: 1,
  transform: { ...DEFAULT_TRANSFORM },
  color: { brightness: 0, contrast: 1, saturation: 1 },
  ...(followed ? { follow: { version: 1 } } : {})
})

function project(assets: MediaAsset[], clips: Clip[], settings: { width: number; height: number }): Project {
  const p = emptyProject()
  return { ...p, assets, clips, settings: { ...p.settings, ...settings } }
}

const TALK = video('talk', 1920, 1080)

describe('reframeOffer', () => {
  it('fires for a landscape video clip on a 9:16 canvas, with the count of clips', () => {
    expect(reframeOffer(project([TALK], [clip('c1', 'talk')], PORTRAIT))).toBe(1)
    // Clips, not files: two clips of one talk and one of another are three — each will follow.
    const other = video('other', 1280, 720)
    expect(reframeOffer(project([TALK, other], [clip('c1', 'talk'), clip('c2', 'talk'), clip('c3', 'other')], PORTRAIT))).toBe(3)
  })

  it('does not fire for a clip that already follows its subject', () => {
    expect(reframeOffer(project([TALK], [clip('c1', 'talk', true)], PORTRAIT))).toBeNull()
    // And counts only the ones that do not.
    expect(reframeOffer(project([TALK], [clip('c1', 'talk', true), clip('c2', 'talk')], PORTRAIT))).toBe(1)
  })

  it('does not fire for a landscape video in the pool but on no clip', () => {
    expect(reframeOffer(project([TALK], [], PORTRAIT))).toBeNull()
    // A clip of something else does not make the pool's video count.
    const still = photo('still', 4000, 3000)
    expect(reframeOffer(project([TALK, still], [clip('p1', 'still')], PORTRAIT))).toBeNull()
  })

  it('fires only on a portrait canvas — a square one is not', () => {
    expect(reframeOffer(project([TALK], [clip('c1', 'talk')], LANDSCAPE))).toBeNull()
    expect(reframeOffer(project([TALK], [clip('c1', 'talk')], SQUARE))).toBeNull()
  })

  it('counts landscape VIDEO only: a portrait, square or unsized video is not, nor any photo', () => {
    // The upright size (R5): a phone clip shot standing up is portrait and needs nothing.
    for (const v of [video('v', 1080, 1920), video('v', 1080, 1080), video('v', null, null)]) {
      expect(reframeOffer(project([v], [clip('c1', 'v')], PORTRAIT)), JSON.stringify([v.width, v.height])).toBeNull()
    }
    // A landscape photo on a 9:16 canvas is the photo chip's (orientationMismatch), not this one's.
    expect(reframeOffer(project([photo('still', 4000, 3000)], [clip('p1', 'still')], PORTRAIT))).toBeNull()
  })

  it('counts exactly the clips reframeAll follows, so the chip never offers a press that does nothing', () => {
    const p = project(
      [TALK, photo('still', 4000, 3000)],
      [clip('c1', 'talk'), clip('p1', 'still'), clip('c2', 'talk', true), clip('c3', 'talk')],
      PORTRAIT
    )
    expect(followCandidates(p).map((c) => c.id)).toEqual(['c1', 'c3'])
    expect(reframeOffer(p)).toBe(followCandidates(p).length)
    expect(reframeOffer({ ...p, settings: { ...p.settings, ...LANDSCAPE } })).toBeNull()
  })

  it('with landscape photos AND a landscape talk on 9:16, both rules would speak — and give opposite advice', () => {
    const assets = [photo('a', 4000, 3000), photo('b', 4000, 3000), photo('c', 4000, 3000), TALK]
    const p = project(assets, [clip('c1', 'talk')], PORTRAIT)
    // The reframe offer: keep the canvas, follow the subject.
    expect(reframeOffer(p)).toBe(1)
    // The photo rule, unchanged and photos-only: switch the canvas to 16:9.
    expect(orientationMismatch(assets, PORTRAIT)).toBe('16:9')
    // So the bar needs a precedence; it shows the offer (pinned rendered, tests/renderer/reframePanel.test.tsx).
  })
})
