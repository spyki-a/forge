import { describe, expect, it } from 'vitest'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { buildRenderPlan, cropFilter, type CropFollow } from '@shared/render/plan'
import { filterGraphOf } from '@shared/render/graphFile'
import { cropAt, effectiveCrop } from '@shared/render/crop'
import { exportPixel, flatSumAt, flatSumExpression, type FlatSum } from '@shared/reframe/expression'
import { followKeys } from '@shared/reframe/keys'
import { fourShotTrack, printedMs } from './fixtures/reframe/track'

/*
 * The followed crop in the render's own argv (docs/CLIPS.md §4.7): cropFilter
 * with keyed x and the stacked two-up, buildRenderPlan putting `fps=` ahead of
 * a followed crop at speed 1, the one reader `cropAt`, and the moments'
 * pre-pass cutting with the same keys before its trim. Shapes are asserted in
 * order and every anchor's matches are counted: in a plan's graph `crop=`
 * appears twice (the clip's and the fit's `crop=1080:1920`), and with a
 * followed clip `fps=30` appears twice (before the crop and the chain's own).
 * Whether these shapes put each frame on its crop is
 * tests/integration/reframe.int.test.ts's to say, on rendered frames.
 */

const FPS = 30
const CUTS = [29, 61, 165]

function asset(over: Partial<MediaAsset> = {}): MediaAsset {
  return { id: 'v', path: '/media/talk.mp4', name: 'talk.mp4', kind: 'video', durationFrames: 225, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: true, size: 0, ...over }
}

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: 'c', assetId: 'v', trackId: 'v1', start: 15, duration: 210, inPoint: 6, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 },
    follow: { version: 1 }, crop: { x: 176, y: 0, width: 608, height: 1080 },
    ...over
  }
}

function project(o: { twoUp?: boolean; canvas?: { width: number; height: number }; clip?: Partial<Clip>; asset?: Partial<MediaAsset> } = {}): Project {
  const canvas = o.canvas ?? { width: 1080, height: 1920 }
  const track = fourShotTrack({ cutMs: CUTS.map((f) => printedMs(f / 30)), durationMs: 7500, twoUp: o.twoUp ?? false })
  return {
    ...emptyProject(),
    settings: { width: canvas.width, height: canvas.height, fps: FPS, sampleRate: 48000 },
    tracks: [{ id: 'v1', kind: 'video', name: 'V1', muted: false, hidden: false, locked: false }],
    assets: [asset(o.asset)],
    clips: [clip(o.clip)],
    subjects: { v: track }
  }
}

const graphOf = (p: Project): string => filterGraphOf(buildRenderPlan({ project: p, outputPath: '/tmp/out.mp4' }).args)
const count = (text: string, needle: string): number => [...text.matchAll(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].length
/** The clip's own chain, from its input label to the first label it ends in. */
const chainOf = (graph: string): string => /\[0:v\]([^;]*)/.exec(graph)![1]

describe('cropFilter: a followed crop', () => {
  const sum: FlatSum = { base: 176, terms: [{ atFrame: 23, delta: 960 }, { fromFrame: 114, toFrame: 142, delta: 576 }] }
  const follow: CropFollow = { crop: { x: 176, y: 0, width: 608, height: 1080 }, cropX: sum }

  it('with no follow, the crop it always was', () => {
    expect(cropFilter({ crop: { x: 656, y: 0, width: 608, height: 1080 } }, { width: 1920, height: 1080 })).toBe(
      "crop=w='min(608,in_w)':h='min(1080,in_h)':x='max(0,min(656,in_w-out_w))':y='max(0,min(0,in_h-out_h))'"
    )
  })

  it('x is the flat sum inside the filter’s own clamp; w and h stay literal; nothing nests', () => {
    const text = cropFilter({ crop: { x: 999, y: 0, width: 10, height: 10 } }, { width: 1920, height: 1080 }, follow, FPS)!
    const x = flatSumExpression(sum, { fps: FPS, startSeconds: 0 })
    // The follow's size, never the stored crop's.
    expect(text).toBe(`crop=w='min(608,in_w)':h='min(1080,in_h)':x='max(0,min(${x},in_w-out_w))':y='max(0,min(0,in_h-out_h))'`)
    // Clip-relative time (startSeconds 0): the step on frame 23 is at its half-frame boundary from the clip's FIRST frame.
    expect(text).toContain(`+960*gte(t,${((23 - 0.5) / FPS).toFixed(6)})`)
    expect(text).not.toMatch(/\bif\(/)
  })

  it('a two-up clip: split, two crops keyed on x and y, vstack, then the tpad that keeps the last frame — labels by the clip’s index', () => {
    const halves = {
      top: { x: { base: 176, terms: [{ atFrame: 159, delta: -96 }] }, y: { base: 0, terms: [{ atFrame: 159, delta: 162 }] } },
      bottom: { x: { base: 176, terms: [{ atFrame: 159, delta: 1056 }] }, y: { base: 540, terms: [{ atFrame: 159, delta: -162 }] } }
    }
    const text = cropFilter({}, { width: 1920, height: 1080 }, { crop: { x: 176, y: 0, width: 608, height: 1080 }, halves }, FPS, 3)!
    const e = (s: FlatSum): string => flatSumExpression(s, { fps: FPS, startSeconds: 0 })
    const half = (h: { x: FlatSum; y: FlatSum }): string =>
      `crop=w='min(608,in_w)':h='min(540,in_h)':x='max(0,min(${e(h.x)},in_w-out_w))':y='max(0,min(${e(h.y)},in_h-out_h))'`
    expect(text).toBe(`split=2[r3a][r3b];[r3a]${half(halves.top)}[r3t];[r3b]${half(halves.bottom)}[r3u];[r3t][r3u]vstack,tpad=stop_mode=clone:stop=1`)
    expect(count(text, "crop=w='min(608,in_w)':h='min(540,in_h)'")).toBe(2)
    // The bottom crop is the bottom's own keys, not the top's.
    expect(text.indexOf(`x='max(0,min(${e(halves.bottom.x)},`)).toBeGreaterThan(text.indexOf('[r3b]'))
  })
})

describe('buildRenderPlan: the followed crop in the chain', () => {
  it('at speed 1: fps= right before the crop, which holds the keys; the fit after it as ever', () => {
    const graph = graphOf(project())
    const chain = chainOf(graph)
    expect(count(graph, 'fps=30,crop=w=')).toBe(1)
    expect(chain.startsWith("fps=30,crop=w='min(608,in_w)':h='min(1080,in_h)':x='max(0,min(176+960*gte(t,")).toBe(true)
    // Two fps=30 in the clip's chain: the one before the crop and the chain's own after the fit.
    expect(count(chain, 'fps=30')).toBe(2)
    expect(chain).toMatch(/in_h-out_h\)\)',scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,/)
    // The keys are compiled from the clip's first frame: the first cut on clip frame 23 (source 29 − in-point 6), not 23 + 15.
    expect(chain).toContain(`gte(t,${(22.5 / FPS).toFixed(6)})`)
    expect(chain).toMatch(/\*\(min\(1,max\(0,\(t-/)
  })

  it('at speed 2: no fps= added — the retime already ends in one — and the crop right after it', () => {
    const chain = chainOf(graphOf(project({ clip: { speed: 2, duration: 105 } })))
    expect(chain.startsWith("setpts=PTS/2,fps=30,crop=w='min(608,in_w)'")).toBe(true)
    expect(count(chain, 'fps=30')).toBe(2)
  })

  it('a two-up clip: fps=, the split and its two crops, the stack, its tpad, then the fit', () => {
    const graph = graphOf(project({ twoUp: true }))
    expect(count(graph, 'fps=30,split=2[r0a][r0b];[r0a]crop=w=')).toBe(1)
    expect(count(graph, 'crop=w=')).toBe(2)
    expect(count(graph, '[r0t][r0u]vstack,tpad=stop_mode=clone:stop=1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30')).toBe(1)
  })

  it('the stream after the crop is the follow’s size, whatever the stored crop says', () => {
    // A stale stored crop of another size: the fit is still sized for 608×1080, and the crop cuts 608×1080.
    const graph = graphOf(project({ clip: { crop: { x: 0, y: 0, width: 1000, height: 1080 } } }))
    expect(count(graph, "crop=w='min(608,in_w)':h='min(1080,in_h)'")).toBe(1)
    expect(count(graph, 'min(1000,in_w)')).toBe(0)
    // streamSize is the follow's: a 608×1080 stream on a 1080×1920 box is within 1 % of its shape, so the fit fills (cover).
    // Sized from the stored 1000×1080 it would letterbox (contain) a picture the crop had already cut to 608.
    expect(count(chainOf(graph), "in_h-out_h))',scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30")).toBe(1)
    expect(graph).not.toContain('force_original_aspect_ratio=decrease')
  })

  it('no follow, a refused track, a canvas of the source’s shape, a photograph: no keys and no fps= before the crop', () => {
    const plain = graphOf(project({ clip: { follow: undefined } }))
    const refused = graphOf(project({ asset: { width: 1280, height: 720 } }))
    const same = graphOf(project({ canvas: { width: 1920, height: 1080 } }))
    for (const [name, graph] of [['no follow', plain], ['refused', refused], ['same shape', same]] as const) {
      expect(count(chainOf(graph), 'fps=30'), name).toBe(1)
      expect(graph, name).not.toContain('gte(t,')
      expect(graph, name).not.toContain('split=2[r0a]')
    }
    expect(chainOf(plain).startsWith("crop=w='min(608,in_w)':h='min(1080,in_h)':x='max(0,min(176,in_w-out_w))'")).toBe(true)
  })
})

describe('cropAt: the one reader of a clip’s crop', () => {
  const source = { width: 1920, height: 1080 }

  it('an unfollowed clip: the rectangle the export’s clamped crop makes of the stored one', () => {
    const p = project({ clip: { follow: undefined, crop: { x: 1500, y: 0, width: 608, height: 1080 } } })
    expect(cropAt(p, p.clips[0], source, 40)).toEqual({ crop: effectiveCrop(p.clips[0].crop, source) })
    expect(cropAt(p, p.clips[0], source, 40).crop.x).toBe(1312)
  })

  it('a followed clip: the old shot’s crop on the frame before the cut, the new one’s on it, at the export’s rounding through a pan', () => {
    const p = project()
    const c = p.clips[0]
    const keys = followKeys(p, c, FPS)!
    const step = keys.cropX!.terms.find((t) => 'atFrame' in t)!
    const cut = (step as { atFrame: number }).atFrame
    expect(cropAt(p, c, source, cut - 1)).toEqual({ crop: { x: 176, y: 0, width: 608, height: 1080 } })
    expect(cropAt(p, c, source, cut)).toEqual({ crop: { x: 1136, y: 0, width: 608, height: 1080 } })
    // Every frame of the clip: lrint(x) & ~1 of the sum the export evaluates, clamped as the filter clamps.
    for (let f = 0; f < c.duration; f++) {
      const raw = flatSumAt(keys.cropX!, f, { fps: FPS, startSeconds: 0 })
      const want = exportPixel(Math.max(0, Math.min(raw, 1920 - 608)))
      const got = cropAt(p, c, source, f).crop.x
      if (got !== want) throw new Error(`frame ${f}: ${got}, the export's ${want}`)
      expect(got % 2).toBe(0)
    }
    // A pan frame lands between its ends, on an even pixel.
    const pan = keys.cropX!.terms.find((t) => 'fromFrame' in t) as { fromFrame: number; toFrame: number }
    const mid = cropAt(p, c, source, Math.round((pan.fromFrame + pan.toFrame) / 2)).crop.x
    expect(mid).toBeGreaterThan(272)
    expect(mid).toBeLessThan(848)
  })

  it('a two-up frame: both halves, the top on the left face; a single shot in the same clip: one crop', () => {
    const p = project({ twoUp: true })
    const c = p.clips[0]
    const keys = followKeys(p, c, FPS)!
    const stackAt = keys.shots.find((s) => s.why === 'two-up')!.from
    const stacked = cropAt(p, c, source, stackAt)
    expect(stacked.halves).toEqual({
      top: { x: 80, y: 162, width: 608, height: 540 },
      bottom: { x: 1232, y: 378, width: 608, height: 540 }
    })
    // What a consumer that draws one rectangle gets: the top half's x at the clip's full size.
    expect(stacked.crop).toEqual({ x: 80, y: 0, width: 608, height: 1080 })
    const single = cropAt(p, c, source, stackAt - 1)
    expect(single.halves).toBeUndefined()
    expect(single.crop).toEqual({ x: 848, y: 0, width: 608, height: 1080 })
  })

  it('a canvas of the source’s own shape: the whole frame, nothing to follow', () => {
    const p = project({ canvas: { width: 1920, height: 1080 } })
    expect(cropAt(p, p.clips[0], source, 100)).toEqual({ crop: { x: 0, y: 0, width: 1920, height: 1080 } })
  })
})
