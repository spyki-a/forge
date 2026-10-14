import { describe, expect, it } from 'vitest'
import { emptyProject, type Clip, type MediaAsset, type MomentSpec, type Project } from '@shared/timeline'
import { buildRenderPlan } from '@shared/render/plan'
import { filterGraphOf } from '@shared/render/graphFile'
import { momentTextures, type MomentTextures } from '@shared/render/momentTextures'
import { bakeForExport, type Bakers } from '@shared/render/exportBake'
import { followKeys } from '@shared/reframe/keys'
import { fourShotTrack, printedMs } from './fixtures/reframe/track'

/*
 * The followed crop's consumers outside the store and the preview
 * (docs/CLIPS.md §4.7, slice B):
 *
 * - The export follows on ITS canvas. A preset's own aspect (a 9:16 Reel of
 *   a 16:9 edit) asked a 16:9 project for "nothing to follow" and letterboxed
 *   the whole frame; compiled at the export's shape it cuts exactly what the
 *   9:16 project would. Decided here; plan.ts `followCanvas`.
 * - A moment over a followed clip pulls its footage with the followed keys
 *   (momentTextures spreads `followedFootage`), not the stored first-frame
 *   crop — and the export's moments pull them at the export's shape.
 */

const FPS = 30

const TRACK = fourShotTrack({ cutMs: [29, 61, 165].map((f) => printedMs(f / FPS)), durationMs: 7500, twoUp: false })

const talkAsset: MediaAsset = { id: 'v', path: '/media/talk.mp4', name: 'talk.mp4', kind: 'video', durationFrames: 225, width: 1920, height: 1080, fps: FPS, hasVideo: true, hasAudio: true, size: 0 }

function clip(over: Partial<Clip> & { id: string; assetId: string }): Clip {
  return {
    trackId: 'v1', start: 0, duration: 210, inPoint: 6, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 },
    ...over
  }
}

function project(canvas: { width: number; height: number }, extra: { assets?: MediaAsset[]; clips?: Clip[] } = {}): Project {
  return {
    ...emptyProject(),
    settings: { ...emptyProject().settings, width: canvas.width, height: canvas.height, fps: FPS },
    tracks: [
      { id: 'v1', kind: 'video', name: 'V1', muted: false, hidden: false, locked: false },
      { id: 'v2', kind: 'video', name: 'V2', muted: false, hidden: false, locked: false }
    ],
    assets: [talkAsset, ...(extra.assets ?? [])],
    clips: [clip({ id: 'c', assetId: 'v', follow: { version: 1 }, crop: { x: 0, y: 0, width: 1920, height: 1080 } }), ...(extra.clips ?? [])],
    subjects: { v: TRACK }
  }
}

/** The followed clip's own chain in the export's graph. */
const chainOf = (p: Project, canvas?: { width: number; height: number }): string =>
  /\[0:v\]([^;]*)/.exec(filterGraphOf(buildRenderPlan({ project: p, outputPath: '/tmp/out.mp4', ...(canvas ? { canvas } : {}) }).args))![1]
/** Up to the crop's end: what the follow decides (the fit after it depends on the canvas's size). */
const cropOf = (chain: string): string => chain.slice(0, chain.indexOf(",scale="))

describe('an export whose canvas is not the project’s', () => {
  const wide = project({ width: 1920, height: 1080 })
  const tall = project({ width: 1080, height: 1920 })

  it('follows on the export’s shape: a 9:16 export of a 16:9 edit cuts what the 9:16 project cuts', () => {
    const exported = cropOf(chainOf(wide, { width: 1080, height: 1920 }))
    expect(exported).toBe(cropOf(chainOf(tall)))
    expect(exported.startsWith("fps=30:start_time=0,crop=w='min(608,in_w)':h='min(1080,in_h)'")).toBe(true)
    // The keys are the 9:16 path's: the first cut steps x by 960 on its export frame.
    expect(exported).toContain('+960*gte(t,0.750000)')
  })

  it('at the project’s own canvas, the project’s shape: a 16:9 edit of a 16:9 file has nothing to follow', () => {
    expect(chainOf(wide)).toContain("crop=w='min(1920,in_w)':h='min(1080,in_h)'")
    expect(chainOf(wide)).not.toContain('start_time=0')
  })

  it('the same shape at another resolution compiles the same crop', () => {
    expect(cropOf(chainOf(tall, { width: 720, height: 1280 }))).toBe(cropOf(chainOf(tall)))
  })
})

const momentSpec: MomentSpec = { kind: 'zoom-punch', from: { clipId: 'c' }, to: { clipId: 'p' }, seconds: 0.4, intensity: 0.5, seed: 7, version: 1 }
const photo: MediaAsset = { id: 'photo', path: '/media/photo.jpg', name: 'photo', kind: 'image', durationFrames: 150, width: 1080, height: 1920, fps: null, hasVideo: true, hasAudio: false, size: 0 }

/** A moment over the cut from the followed talk (frames 0–210) to a photo. */
function withMoment(canvas: { width: number; height: number }): Project {
  return project(canvas, {
    assets: [photo, { ...photo, id: 'm', path: '', name: 'moment' }],
    clips: [clip({ id: 'p', assetId: 'photo', start: 210, duration: 60, inPoint: 0 }), clip({ id: 'mo', assetId: 'm', trackId: 'v2', start: 204, duration: 12, inPoint: 0, moment: momentSpec })]
  })
}

describe('a moment over a followed clip', () => {
  it('pulls the footage with the followed keys and size, not the stored first-frame crop', () => {
    const p = withMoment({ width: 1080, height: 1920 })
    const keys = followKeys(p, p.clips[0], FPS)!
    const footage = momentTextures(p, momentSpec, 204)!.from!.footage!
    expect(footage.crop).toEqual(keys.crop)
    expect(footage.crop).toMatchObject({ width: 608, height: 1080 })
    expect(footage.cropX).toBe(keys.cropX)
    expect(footage.cropX).toBeDefined()
  })

  it('in the export, pulls them at the EXPORT’s shape, as the render beneath it cuts', async () => {
    const asked: MomentTextures[] = []
    const none = async (): Promise<null> => null
    const bakers: Bakers = {
      text: async () => '/t.png', textSequence: none, solid: async () => '/s.png', title: async () => '/ti.png',
      paper: none, carousel: none,
      moment: async (_spec, _key, textures, _w, _h, frames) => {
        asked.push(textures)
        return { pattern: '/m/%05d.png', frames }
      }
    }
    await bakeForExport(withMoment({ width: 1920, height: 1080 }), { width: 1080, height: 1920 }, bakers)
    expect(asked).toHaveLength(1)
    expect(asked[0].from?.footage?.crop).toMatchObject({ width: 608, height: 1080 })
    expect(asked[0].from?.footage?.cropX).toBeDefined()
  })
})
