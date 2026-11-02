import { describe, expect, it } from 'vitest'
import { buildRenderPlan, clipBox, identityPlaced } from '@shared/render/plan'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'

/*
 * The (box) route's two shared halves (docs/CLIPS.md §6.1 (box), §6.3 "The
 * bake region (M1) and the box route"): `identityPlaced`, the one predicate
 * the export's bake and the plan both read, and the plan's read of
 * `frames.box` on an asset the export's bake wrote it to. The box's own
 * numbers reach ffmpeg only here: the stream is the box's size, so the fit
 * scales nothing, and the overlay lands at the box's even x and y.
 */

const BOX = { x: 120, y: 1400, width: 840, height: 300 }

const clip = (over: Partial<Clip> & { id: string; assetId: string }): Clip => ({
  trackId: 'v1', start: 0, duration: 60, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  color: { brightness: 0, contrast: 1, saturation: 1 }, ...over
})

/** The exit fade's two keys: the one keyframe track a graphic placed at the identity carries. */
const EXIT = { opacity: [{ frame: 31, value: 1, ease: 'smooth' as const }, { frame: 39, value: 0 }] }

describe('identityPlaced', () => {
  const at = (over: Partial<Clip> = {}): Clip => clip({ id: 'g', assetId: 'g', keyframes: EXIT, ...over })

  it('is true at x 0, y 0, scale 1, rotation 0, with no path and no keyframes but the exit’s opacity', () => {
    expect(identityPlaced(at())).toBe(true)
    expect(identityPlaced(at({ keyframes: undefined }))).toBe(true)
    // A scaleY of 1 is the same geometry `clipBox` reads for no scaleY; an empty track is no track.
    expect(identityPlaced(at({ transform: { x: 0, y: 0, scale: 1, scaleY: 1, rotation: 0, opacity: 1 } }))).toBe(true)
    expect(identityPlaced(at({ keyframes: { ...EXIT, zoom: [] } }))).toBe(true)
    expect(identityPlaced(at({ path: [] }))).toBe(true)
    // Opacity is not a placement.
    expect(identityPlaced(at({ transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 0.5 } }))).toBe(true)
  })

  it('is false for any other placement: a moved, scaled, stretched or turned clip, a motion path, or a keyed zoom', () => {
    const moved = { x: 0.2, y: 0, scale: 1, rotation: 0, opacity: 1 }
    const down = { x: 0, y: -0.1, scale: 1, rotation: 0, opacity: 1 }
    const scaled = { x: 0, y: 0, scale: 0.5, rotation: 0, opacity: 1 }
    const stretched = { x: 0, y: 0, scale: 1, scaleY: 0.5, rotation: 0, opacity: 1 }
    const turned = { x: 0, y: 0, scale: 1, rotation: 10, opacity: 1 }
    for (const transform of [moved, down, scaled, stretched, turned]) expect(identityPlaced(at({ transform })), JSON.stringify(transform)).toBe(false)
    expect(identityPlaced(at({ path: [{ frame: 0, x: 0, y: 0 }, { frame: 30, x: 0.5, y: 0 }] as Clip['path'] }))).toBe(false)
    expect(identityPlaced(at({ keyframes: { ...EXIT, zoom: [{ frame: 0, value: 1 }, { frame: 30, value: 1.4 }] } }))).toBe(false)
  })
})

describe('the plan reads frames.box', () => {
  const video: MediaAsset = { id: 'video', path: '/media/shot.mp4', name: 'shot', kind: 'video', durationFrames: 300, width: 1080, height: 1920, fps: 30, hasVideo: true, hasAudio: false, size: 1 }
  /** The export's copy of a graphic's asset after the box route: the box's size, and the box on its frames. */
  const drawn = (box: boolean): MediaAsset => ({
    id: 'g', path: '/cache/g-export.seq/00000.png', name: 'counter — graphic', kind: 'image', durationFrames: 300,
    width: box ? BOX.width : 1080, height: box ? BOX.height : 1920, fps: null, hasVideo: true, hasAudio: false, size: 0,
    frames: box ? { pattern: '/cache/g-export.seq/%05d.png', count: 20, box: BOX } : { pattern: '/cache/g-export.seq/%05d.png', count: 20 }
  })
  const project = (graphic: Clip, asset: MediaAsset): Project => {
    const base = emptyProject('box')
    return {
      ...base,
      settings: { ...base.settings, width: 1080, height: 1920, fps: 30 },
      assets: [video, asset],
      clips: [clip({ id: 'shot', assetId: 'video' }), graphic]
    }
  }
  const graph = (p: Project): string => {
    const args = buildRenderPlan({ project: p, outputPath: '/o.mp4' }).args
    return args[args.indexOf('-filter_complex') + 1]
  }
  /** The overlay placing the graphic (the second overlay of the graph: the shot's is the first). */
  const graphicOverlay = (g: string): { x: string; y: string } => {
    const all = [...g.matchAll(/overlay=x='([^']*)':y='([^']*)'/g)].map((m) => ({ x: m[1], y: m[2] }))
    expect(all).toHaveLength(2)
    return all[1]
  }

  it('overlays a boxed graphic at the box’s x and y with a same-size scale, where the canvas route scales to the canvas at 0,0', () => {
    const identity = clip({ id: 'g', assetId: 'g', trackId: 'v2', start: 10, duration: 40, keyframes: EXIT })
    const boxed = graph(project(identity, drawn(true)))
    expect(graphicOverlay(boxed)).toEqual({ x: '120', y: '1400' })
    expect(boxed).toContain(`scale=${BOX.width}:${BOX.height}:force_original_aspect_ratio=decrease,pad=${BOX.width}:${BOX.height}:`)
    // The held last moving frame, as every frames asset is.
    expect(boxed).toContain('tpad=stop_mode=clone')
    // The same clip by the canvas route: the whole frame, at the canvas's origin.
    const canvas = graph(project(identity, drawn(false)))
    expect(graphicOverlay(canvas)).toEqual({ x: '0', y: '0' })
    expect(canvas).toContain('scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:')
  })

  it('reads the box only for a clip placed at the identity: a turned clip keeps clipBox’s placement', () => {
    const turned = clip({ id: 'g', assetId: 'g', trackId: 'v2', start: 10, duration: 40, keyframes: EXIT, transform: { x: 0, y: 0, scale: 1, rotation: 10, opacity: 1 } })
    const g = graph(project(turned, drawn(true)))
    // Not the box's 120, 1400; clipBox's, less the room the turn grows the stream by (a negative offset).
    const own = clipBox(turned, { width: 1080, height: 1920 })
    const place = graphicOverlay(g)
    expect(own).toMatchObject({ x: 0, y: 0 })
    expect(Number(place.x)).toBeLessThanOrEqual(0)
    expect(Number(place.y)).toBeLessThanOrEqual(0)
    expect(g).not.toContain(`scale=${BOX.width}:${BOX.height}:force_original_aspect_ratio`)
  })
})
