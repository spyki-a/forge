import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { emptyProject, type Clip, type MediaAsset, type MomentSpec, type Motion, type Project, type Track } from '@shared/timeline'
import {
  DRAWN_MOMENTS,
  MOMENT_SECONDS,
  bridgesCut,
  fitSpan,
  footageFrameIndex,
  footageWindow,
  momentAmount,
  momentParams,
  momentPlacement,
  momentSpan,
  momentT,
  movingFrames,
  seeded,
  shotPicture,
  texturePlanFor,
  type FootageRequest
} from '@shared/render/moment'
import { FOOTAGE_MAX_EDGE, footageCapFilter, momentFrameArgs, momentFramesKey } from '@shared/render/momentFrames'
import { motionSourceRect } from '@shared/render/motion'
import { planeShare, retimeFilter } from '@shared/render/plan'
import { sourceFramesFor } from '@shared/render/speed'
import { momentTextures, withFootageFrames } from '@shared/render/momentTextures'
import { bakeForExport, exportKey, type Bakers } from '@shared/render/exportBake'
import { drawsItself } from '@shared/edit/recipes'
import { clipKind } from '@shared/edit/clipKind'
import { canMoveCamera } from '@shared/edit/camera'
import { isKeyable } from '@shared/render/chromaKey'
import { canSteady } from '@shared/render/steady'
import { DIRECTOR_RULES, MOMENT_RULE } from '@shared/director/apply'

/*
 * The moments, without a GPU (docs/PLAN.md §7.4): how many frames a moment
 * has and where they sit against the cut, that its parameters at t = 0 and
 * t = 1 are the two shots' pictures exactly, that a seed draws the same
 * picture twice, that a shot's picture is composed where and how the render
 * composes it, and that the new self-drawing kind is on every guard. The
 * drawing itself is proved in the harness (`window.__forgeMomentCheck`) and
 * the bake path by tests/integration/moment.int.test.ts.
 */

const fps = 30
const spec = (over: Partial<MomentSpec> = {}): MomentSpec => ({
  kind: 'zoom-punch', from: { clipId: 'a' }, to: { clipId: 'b' }, seconds: 0.4, intensity: 0.5, seed: 7, version: 1, ...over
})
const TRANSFORM = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }

describe('when a moment’s frames fall', () => {
  it('a bridge is split evenly about the cut, the odd frame after; a depth push starts on its shot', () => {
    expect(momentSpan(spec(), fps)).toEqual({ before: 6, after: 6, total: 12 })
    expect(momentSpan(spec({ kind: 'light-burn', seconds: 0.55 }), fps)).toEqual({ before: 8, after: 9, total: 17 })
    expect(momentSpan(spec({ kind: 'depth-push', seconds: 2 }), fps)).toEqual({ before: 0, after: 60, total: 60 })
    expect(bridgesCut('zoom-punch')).toBe(true)
    expect(bridgesCut('whip-blur')).toBe(true)
    expect(bridgesCut('light-burn')).toBe(true)
    expect(bridgesCut('depth-push')).toBe(false)
  })

  it('seconds are held to the kind’s bounds', () => {
    expect(momentSpan(spec({ seconds: 0.05 }), fps).total).toBe(Math.round(MOMENT_SECONDS['zoom-punch'].min * fps))
    expect(momentSpan(spec({ seconds: 5 }), fps).total).toBe(Math.round(MOMENT_SECONDS['zoom-punch'].max * fps))
    expect(momentSpan(spec({ kind: 'depth-push', seconds: 0.4 }), fps).total).toBe(Math.round(MOMENT_SECONDS['depth-push'].min * fps))
  })

  it('never runs past either shot’s footage, and says when it shrank', () => {
    const span = momentSpan(spec(), fps)
    expect(fitSpan(span, { before: 100, after: 100 })).toEqual({ span, shrank: false })
    expect(fitSpan(span, { before: 2, after: 100 })).toEqual({ span: { before: 2, after: 6, total: 8 }, shrank: true })
    expect(fitSpan(span, { before: 100, after: 3 })).toEqual({ span: { before: 6, after: 3, total: 9 }, shrank: true })
    // Always at least one frame on the incoming shot.
    expect(fitSpan(span, { before: 0, after: 0 }).span).toEqual({ before: 0, after: 1, total: 1 })
  })

  it('the clip starts `before` frames ahead of the cut and lasts the span', () => {
    expect(momentPlacement(90, { before: 6, after: 6, total: 12 })).toEqual({ start: 84, duration: 12 })
    expect(momentPlacement(90, { before: 0, after: 60, total: 60 })).toEqual({ start: 90, duration: 60 })
  })

  it('every frame of a bridge moves; a depth push moves for its seconds and holds for the rest of its shot', () => {
    expect(movingFrames(spec(), fps, 12)).toBe(12)
    const push = spec({ kind: 'depth-push', seconds: 2, from: undefined })
    expect(movingFrames(push, fps, 150)).toBe(60)
    // A shot shorter than the push: the push is squeezed into it.
    expect(movingFrames(push, fps, 40)).toBe(40)
    expect(movingFrames(push, fps, 0)).toBe(1)
  })

  it('t is 0 on the first frame and 1 on the last', () => {
    expect(momentT(0, 12)).toBe(0)
    expect(momentT(11, 12)).toBe(1)
    expect(momentT(6, 12)).toBeCloseTo(6 / 11, 9)
    expect(momentT(5, 1)).toBe(1)
  })
})

describe('what a moment draws from', () => {
  it('a seed is a picture: the same numbers twice, different numbers for another seed', () => {
    const a = seeded(42)
    const b = seeded(42)
    const first = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(first)
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true)
    const c = seeded(43)
    expect([c(), c(), c()]).not.toEqual(first)
  })

  it('every kind is the outgoing picture at t = 0 and the incoming at t = 1 — nothing blurred, moved, lit or scaled', () => {
    const zoom0 = momentParams(spec(), 0)
    const zoom1 = momentParams(spec(), 1)
    expect(zoom0).toMatchObject({ kind: 'zoom-punch', mix: 0, blur: 0, fromScale: 1 })
    expect(zoom1).toMatchObject({ kind: 'zoom-punch', mix: 1, blur: 0, toScale: 1 })

    const whip0 = momentParams(spec({ kind: 'whip-blur' }), 0)
    const whip1 = momentParams(spec({ kind: 'whip-blur' }), 1)
    expect(whip0).toMatchObject({ kind: 'whip-blur', blur: 0, fromOffset: 0, toOffset: 1 })
    expect(whip1).toMatchObject({ kind: 'whip-blur', blur: 0, fromOffset: -1, toOffset: 0 })

    const burn0 = momentParams(spec({ kind: 'light-burn' }), 0)
    const burn1 = momentParams(spec({ kind: 'light-burn' }), 1)
    expect(burn0).toMatchObject({ kind: 'light-burn', mix: 0, glow: 0, grain: 0 })
    expect(burn1).toMatchObject({ kind: 'light-burn', mix: 1, glow: 0, grain: 0 })

    const push0 = momentParams(spec({ kind: 'depth-push', from: undefined }), 0)
    const push1 = momentParams(spec({ kind: 'depth-push', from: undefined }), 1)
    expect(push0).toMatchObject({ kind: 'depth-push', push: 0, scale: 1 })
    if (push0.kind === 'depth-push') expect(push0.planeScale(1)).toBe(1)
    if (push1.kind === 'depth-push') {
      expect(push1.scale).toBeGreaterThan(1)
      // The nearest plane moves the most: the parallax of a real dolly.
      expect(push1.planeScale(1)).toBeGreaterThan(push1.planeScale(0))
      expect(push1.planeScale(1)).toBeCloseTo(push1.scale, 9)
    }
  })

  it('in between, something happens — and harder with a louder ad', () => {
    const calm = momentParams(spec({ intensity: 0 }), 0.5)
    const loud = momentParams(spec({ intensity: 1 }), 0.5)
    if (calm.kind !== 'zoom-punch' || loud.kind !== 'zoom-punch') throw new Error('kind')
    expect(calm.blur).toBeGreaterThan(0)
    expect(loud.blur).toBeGreaterThan(calm.blur)
    expect(momentAmount(0)).toBeCloseTo(0.35, 9)
    expect(momentAmount(1)).toBeCloseTo(1, 9)
    const burn = momentParams(spec({ kind: 'light-burn' }), 0.5)
    if (burn.kind === 'light-burn') {
      expect(burn.glow).toBeGreaterThan(0.3)
      expect(burn.lights).toHaveLength(2)
    }
  })

  it('the same seed places the lights and points the whip the same way at every t; another seed differs; a whip is never tilted', () => {
    const at = (seed: number, t: number) => momentParams(spec({ kind: 'light-burn', seed }), t)
    const a = at(5, 0.3)
    const b = at(5, 0.3)
    expect(a).toEqual(b)
    // t changes the drift, never which drift the seed chose: the light's radius and warmth hold.
    const later = at(5, 0.7)
    if (a.kind === 'light-burn' && later.kind === 'light-burn') {
      expect(later.lights.map((l) => [l.radius, l.warmth])).toEqual(a.lights.map((l) => [l.radius, l.warmth]))
    }
    const axes = Array.from({ length: 24 }, (_, seed) => momentParams(spec({ kind: 'whip-blur', seed }), 0.5)).map((p) => (p.kind === 'whip-blur' ? p.axis : { x: 0, y: 0 }))
    expect(new Set(axes.map((a) => JSON.stringify(a))).size).toBeGreaterThan(1)
    // Sideways or up and down, never a diagonal: two pictures sliding on a tilt leave corners neither covers.
    for (const axis of axes) expect(Math.abs(axis.x) < 1e-9 || Math.abs(axis.y) < 1e-9, JSON.stringify(axis)).toBe(true)
  })
})

describe('where a shot’s picture is composed', () => {
  const portrait = { width: 1080, height: 1920 }
  const landscape = { width: 1920, height: 1080 }
  const plan = (over: Partial<Parameters<typeof shotPicture>[0]> = {}): Parameters<typeof shotPicture>[0] => ({
    size: { width: 1600, height: 900 }, fit: 'contain', frames: 60, at: 0, ...over
  })

  it('a landscape picture contained in a portrait frame is a letterbox; the whole picture is the one layer', () => {
    const { box, layers } = shotPicture(plan(), 0, portrait, fps)
    expect(layers).toEqual([{ plane: null, src: { x: 0, y: 0, width: 1, height: 1 } }])
    expect(box.x).toBe(0)
    expect(box.width).toBe(1)
    expect(box.height).toBeCloseTo((1080 / 1920) / (1600 / 900), 9)
    expect(box.y).toBeCloseTo((1 - box.height) / 2, 9)
  })

  it('a portrait picture contained in a landscape frame is a pillarbox, centred', () => {
    const { box, layers } = shotPicture(plan({ size: portrait }), 0, landscape, fps)
    expect(layers[0].src).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(box.y).toBe(0)
    expect(box.height).toBe(1)
    expect(box.width).toBeCloseTo((1080 / 1920) / (1920 / 1080), 9)
    expect(box.x).toBeCloseTo((1 - box.width) / 2, 9)
  })

  it('a filled picture is narrowed to the frame’s shape, centred', () => {
    const { box, layers } = shotPicture(plan({ fit: 'cover' }), 0, portrait, fps)
    expect(box).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    const [{ src }] = layers
    // 1600×900 covering 9:16 shows a 506×900 column of it, centred.
    expect(src.height).toBe(1)
    expect(src.width).toBeCloseTo((900 * (1080 / 1920)) / 1600, 9)
    expect(src.x).toBeCloseTo((1 - src.width) / 2, 9)
  })

  it('the Director’s crop is where the sampling starts — its offset kept — and a crop within 1 % of the frame’s shape fills it', () => {
    // A 4:5 photo reframed for 9:16: 758×1350 of 1080×1350 (plan.ts NEAR_SHAPE says why this fills).
    const filled = shotPicture(plan({ size: { width: 1080, height: 1350 }, crop: { x: 161, y: 0, width: 758, height: 1350 } }), 0, portrait, fps)
    expect(filled.box).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    const [{ src }] = filled.layers
    expect(src.x).toBeCloseTo(161 / 1080, 6)
    expect(src.width).toBeCloseTo(758 / 1080, 6)
    // Filled, so the 0.2 % the crop is narrower than the frame comes off the top and bottom — a pixel each, not a line of black.
    expect(src.height).toBeGreaterThan(0.99)
    expect(src.height).toBeLessThan(1)
    expect(src.y).toBeCloseTo((1 - src.height) / 2, 9)
    // A crop with a y offset — a phone screenshot's top band cut away — samples from that offset.
    const tall = shotPicture(plan({ size: { width: 1170, height: 2532 }, crop: { x: 0, y: 100, width: 1170, height: 2080 } }), 0, portrait, fps)
    expect(tall.layers[0].src.y).toBeCloseTo(100 / 2532, 9)
    expect(tall.layers[0].src.height).toBeCloseTo(2080 / 2532, 9)
    // A crop 4 % off the frame's shape is really contained: a pillarbox, the whole crop shown.
    const off = shotPicture(plan({ size: { width: 1000, height: 1000 }, crop: { x: 0, y: 0, width: 540, height: 1000 } }), 0, portrait, fps)
    expect(off.layers[0].src).toEqual({ x: 0, y: 0, width: 0.54, height: 1 })
    expect(off.box.width).toBeCloseTo(0.54 / 0.5625, 9)
    expect(off.box.x).toBeCloseTo((1 - off.box.width) / 2, 9)
  })

  it('the shot’s camera move runs under the moment, read at the shot’s own frame and clamped to the shot', () => {
    const moving = plan({ size: portrait, fit: 'cover', motion: { kind: 'kenburns', direction: 'in', amount: 0.2 }, frames: 60, at: -6 })
    const first = shotPicture(moving, 0, portrait, fps).layers[0].src
    const start = shotPicture(moving, 6, portrait, fps).layers[0].src
    const later = shotPicture(moving, 36, portrait, fps).layers[0].src
    const past = shotPicture(moving, 200, portrait, fps).layers[0].src
    const last = shotPicture(moving, 65, portrait, fps).layers[0].src
    // Before the shot begins, its first frame: the whole picture, since a push-in starts wide.
    expect(first).toEqual(start)
    expect(start.width).toBeCloseTo(1, 6)
    // Thirty frames in, it has pushed in: less of the picture, still centred.
    expect(later.width).toBeLessThan(start.width)
    expect(later.x).toBeCloseTo((1 - later.width) / 2, 6)
    // After the shot ends, its last frame — however far past.
    expect(past).toEqual(last)
    expect(past.width).toBeLessThan(later.width)
  })

  it('a parallax shot is its planes, far to near, each moved by its own share of the move — as plan.ts and the preview draw it', () => {
    const motion: Motion = { kind: 'parallax', direction: 'in', amount: 0.2 }
    const planes = [{ file: '/far.png', depth: 0 }, { file: '/mid.png', depth: 0.5 }, { file: '/near.png', depth: 1 }]
    const size = portrait
    const { layers } = shotPicture(plan({ size, fit: 'cover', motion, planes, frames: 60, at: 30 }), 0, portrait, fps)
    expect(layers.map((l) => l.plane)).toEqual([0, 1, 2])
    const progress = 30 / 59
    layers.forEach((layer, i) => {
      const want = motionSourceRect(motion, progress, 30 / fps, size.width, size.height, planeShare(motion, motion.amount, planes[i].depth))
      expect(layer.src.width, `plane ${i}`).toBeCloseTo(want.sw / size.width, 9)
      expect(layer.src.x, `plane ${i}`).toBeCloseTo(want.sx / size.width, 9)
    })
    // The near plane has moved the most: it shows the least of itself.
    expect(layers[2].src.width).toBeLessThan(layers[0].src.width)
    // A move that does not read the planes draws the photo whole, planes or not (plan.ts parallaxBakeFor).
    const flat = shotPicture(plan({ size, fit: 'cover', motion: { kind: 'kenburns', direction: 'in', amount: 0.2 }, planes, frames: 60, at: 30 }), 0, portrait, fps)
    expect(flat.layers).toHaveLength(1)
    expect(flat.layers[0].plane).toBeNull()
  })

  it('the punch-in of the transition the shot entered with narrows the picture about its centre for the whole clip', () => {
    const plain = shotPicture(plan({ size: portrait, fit: 'cover' }), 0, portrait, fps).layers[0].src
    const punched = shotPicture(plan({ size: portrait, fit: 'cover', inset: 1.15 }), 0, portrait, fps).layers[0].src
    expect(punched.width).toBeCloseTo(plain.width / 1.15, 9)
    expect(punched.height).toBeCloseTo(plain.height / 1.15, 9)
    expect(punched.x).toBeCloseTo((1 - punched.width) / 2, 9)
    expect(punched.y).toBeCloseTo((1 - punched.height) / 2, 9)
  })

  it('a clip scaled or moved by its transform sits in its own box, as clipBox places it', () => {
    const { box } = shotPicture(plan({ size: portrait, fit: 'cover', box: { scale: 0.5, x: 0.5, y: 0 } }), 0, portrait, fps)
    expect(box.width).toBe(0.5)
    expect(box.height).toBe(0.5)
    expect(box.x).toBeCloseTo((1 - 0.5) / 2 + 0.5 / 2, 9)
    expect(box.y).toBeCloseTo((1 - 0.5) / 2, 9)
  })

  it('a plan is the clip’s crop, box, fit, move, punch-in and length, and where the moment starts within the shot', () => {
    const clip = { crop: { x: 1, y: 2, width: 3, height: 4 }, transform: { ...TRANSFORM, fit: 'cover' as const }, motion: { kind: 'kenburns' as const, direction: 'in' as const, amount: 0.1 }, start: 100, duration: 50 }
    const plan = texturePlanFor(clip, { path: '/p.jpg', width: 800, height: 600 }, 94, [{ file: '/far.png', depth: 0 }, { file: '/near.png', depth: 1 }], true, 1.15)
    expect(plan).toEqual({
      path: '/p.jpg', size: { width: 800, height: 600 }, crop: clip.crop, fit: 'cover', motion: clip.motion, inset: 1.15, frames: 50, at: -6,
      planes: [{ file: '/far.png', depth: 0 }, { file: '/near.png', depth: 1 }]
    })
    // No fit on the clip is the render's default, contain; one plane is no planes; no punch-in is no inset; a plain transform is no box.
    const plain = texturePlanFor({ start: 0, duration: 10, transform: TRANSFORM }, { path: '/p.jpg' }, 0, [{ file: '/only.png', depth: 1 }])
    expect(plain.fit).toBe('contain')
    expect(plain.planes).toBeUndefined()
    expect(plain.inset).toBeUndefined()
    expect(plain.box).toBeUndefined()
    expect(plain.size).toEqual({ width: 0, height: 0 })
    // A transform that scales or moves the clip is its box.
    expect(texturePlanFor({ start: 0, duration: 10, transform: { ...TRANSFORM, scale: 0.5, x: 0.25 } }, { path: '/p.jpg' }, 0).box).toEqual({ scale: 0.5, x: 0.25, y: 0 })
    // A depth push does not follow the shot's own move — it IS the move, and the two would double.
    expect(texturePlanFor(clip, { path: '/p.jpg' }, 94, undefined, false).motion).toBeUndefined()
  })
})

/* ------------------------------------------------------------- textures */

const asset = (id: string, over: Partial<MediaAsset> = {}): MediaAsset => ({
  id, path: `/media/${id}.jpg`, name: id, kind: 'image', durationFrames: 150, width: 1080, height: 1920, fps: null, hasVideo: true, hasAudio: false, size: 100, ...over
})
const clip = (over: Partial<Clip> & { id: string; assetId: string }): Clip => ({
  trackId: 'v1', start: 0, duration: 60, inPoint: 0, volume: 1,
  transform: { ...TRANSFORM },
  color: { brightness: 0, contrast: 1, saturation: 1 }, ...over
})

describe('finding a moment’s pictures in the project', () => {
  const settings = { ...emptyProject().settings, width: 1080, height: 1920, fps }
  const project: Pick<Project, 'clips' | 'assets' | 'parallax' | 'settings'> = {
    settings,
    assets: [asset('p1'), asset('p2'), asset('p3'), asset('v', { kind: 'video', path: '/media/v.mp4', fps: 30 })],
    clips: [clip({ id: 'a', assetId: 'p1', start: 0, duration: 60 }), clip({ id: 'b', assetId: 'p2', start: 60, duration: 60 }), clip({ id: 'c', assetId: 'v', start: 120, duration: 60 })],
    parallax: { p2: { width: 540, height: 960, separated: true, spread: 0.5, layers: [{ file: '/far.png', index: 0, depth: 0, coverage: 1 }, { file: '/near.png', index: 1, depth: 1, coverage: 0.4 }] } }
  }

  it('resolves both shots, with the moment’s start placed in each, and the planes of a separated photo', () => {
    const t = momentTextures(project, spec(), 54)!
    expect(t.from?.path).toBe('/media/p1.jpg')
    expect(t.from?.at).toBe(54)
    expect(t.to.path).toBe('/media/p2.jpg')
    expect(t.to.at).toBe(-6)
    expect(t.to.planes).toEqual([{ file: '/far.png', depth: 0 }, { file: '/near.png', depth: 1 }])
  })

  it('a single-shot moment has no "from" and leaves the shot’s move to itself; a shot that is gone, or is footage, is nothing to draw', () => {
    const moving: typeof project = { ...project, clips: project.clips.map((c) => (c.id === 'b' ? { ...c, motion: { kind: 'kenburns', direction: 'in', amount: 0.2 } } : c)) }
    const push = momentTextures(moving, spec({ kind: 'depth-push', from: undefined }), 60)!
    expect(push.from).toBeNull()
    expect(push.to.motion).toBeUndefined()
    // A bridge into the same shot follows its move, so its last frame is the shot's frame.
    expect(momentTextures(moving, spec(), 54)!.to.motion).toEqual({ kind: 'kenburns', direction: 'in', amount: 0.2 })
    expect(momentTextures(project, spec({ to: { clipId: 'zz' } }), 0)).toBeNull()
    // Into the footage at 120 with a depth push — a photograph's move — is nothing; a bridge there is a request for its frames.
    expect(momentTextures(project, spec({ kind: 'depth-push', from: undefined, to: { clipId: 'c' } }), 120)).toBeNull()
    expect(momentTextures(project, spec({ from: { clipId: 'b' }, to: { clipId: 'c' } }), 114)!.to.footage).toBeDefined()
    // A missing "from" with a present "to" is drawn as a single shot rather than dropped.
    expect(momentTextures(project, spec({ from: { clipId: 'zz' } }), 0)!.from).toBeNull()
  })

  it('carries the punch-in of the transition the shot entered with, and only that', () => {
    const punched: typeof project = { ...project, clips: project.clips.map((c) => (c.id === 'b' ? { ...c, transitionIn: { id: 'zoom-in', durationFrames: 9 } } : c)) }
    expect(momentTextures(punched, spec(), 54)!.to.inset).toBeCloseTo(1.15, 9)
    expect(momentTextures(punched, spec(), 54)!.from?.inset).toBeUndefined()
    const dissolved: typeof project = { ...project, clips: project.clips.map((c) => (c.id === 'b' ? { ...c, transitionIn: { id: 'dissolve', durationFrames: 9 } } : c)) }
    expect(momentTextures(dissolved, spec(), 54)!.to.inset).toBeUndefined()
  })

  it('footage under a bridge is a request for its frames under the moment, through the clip’s own retime; under a push it is nothing', () => {
    const footage: typeof project = {
      ...project,
      assets: [...project.assets, asset('vid', { kind: 'video', path: '/media/vid.mp4', width: 1920, height: 1080, fps: 30, durationFrames: 900 })],
      clips: [
        ...project.clips.filter((c) => c.id !== 'c'),
        clip({ id: 'e', assetId: 'vid', start: 120, duration: 60, inPoint: 30, speed: 0.5, crop: { x: 656, y: 0, width: 608, height: 1080 } }),
        clip({ id: 'd', assetId: 'p1', start: 180, duration: 60 })
      ]
    }
    // Into the footage: the moment's last six frames are the clip's first six.
    const into = momentTextures(footage, spec({ from: { clipId: 'b' }, to: { clipId: 'e' } }), 114)!
    expect(into.to.footage).toEqual({
      path: '/media/vid.mp4', inPoint: 30, duration: 60, speed: 0.5, first: 0, count: 6, fps, crop: { x: 656, y: 0, width: 608, height: 1080 }, size: { width: 1920, height: 1080 }, maxEdge: FOOTAGE_MAX_EDGE
    })
    expect(into.to.at).toBe(-6)
    expect(into.from?.footage).toBeUndefined()
    // Out of the footage: its last six frames.
    const outOf = momentTextures(footage, spec({ from: { clipId: 'e' }, to: { clipId: 'd' } }), 174)!
    expect(outOf.from?.footage).toMatchObject({ first: 54, count: 6 })
    // A depth push is a photograph's move.
    expect(momentTextures(footage, spec({ kind: 'depth-push', from: undefined, to: { clipId: 'e' } }), 120)).toBeNull()
    // A steadied clip's frames are the stabiliser's, which the pull does not run: nothing to draw from.
    const steadied: typeof footage = { ...footage, clips: footage.clips.map((c) => (c.id === 'e' ? { ...c, steady: true } : c)) }
    expect(momentTextures(steadied, spec({ from: { clipId: 'b' }, to: { clipId: 'e' } }), 114)).toBeNull()
    // Pulled: the crop is cut, the size is the frames', and the files start at `first`.
    const pulled = withFootageFrames(into.to, { files: ['/f/00000.png', '/f/00001.png'], width: 608, height: 1080 })
    expect(pulled.footage).toBeUndefined()
    expect(pulled.crop).toBeUndefined()
    expect(pulled.size).toEqual({ width: 608, height: 1080 })
    expect(pulled.pulled).toEqual({ files: ['/f/00000.png', '/f/00001.png'], first: 0 })
  })

  it('a split shot: the picture is the clip UNDER the CUT, not the half that kept the id', () => {
    // splitClip keeps the id on the left half; the right half is what meets the cut at 60.
    const split: typeof project = {
      ...project,
      clips: [clip({ id: 'a', assetId: 'p1', start: 0, duration: 30 }), clip({ id: 'a-b', assetId: 'p3', start: 30, duration: 30 }), ...project.clips.slice(1)]
    }
    const t = momentTextures(split, spec(), 54)!
    expect(t.from?.path).toBe('/media/p3.jpg')
    expect(t.from?.at).toBe(24)
    // Split INSIDE the moment's span (at 57, three frames before the cut): the outgoing picture is still the half under the frame before the cut.
    const inside: typeof project = {
      ...project,
      clips: [clip({ id: 'a', assetId: 'p1', start: 0, duration: 57 }), clip({ id: 'a-b', assetId: 'p3', start: 57, duration: 3 }), ...project.clips.slice(1)]
    }
    expect(momentTextures(inside, spec(), 54)!.from?.path).toBe('/media/p3.jpg')
  })
})

/* -------------------------------------------------------------- footage */

describe('the footage pre-pass', () => {
  const req = (over: Partial<FootageRequest> = {}): FootageRequest => ({
    path: '/media/v.mp4', inPoint: 30, duration: 60, first: 5, count: 6, fps, size: { width: 1920, height: 1080 }, maxEdge: FOOTAGE_MAX_EDGE, ...over
  })

  it('the window is the shot’s frames under the moment, clamped to the shot', () => {
    expect(footageWindow(-6, 12, 60)).toEqual({ first: 0, count: 6 })
    expect(footageWindow(54, 12, 60)).toEqual({ first: 54, count: 6 })
    expect(footageWindow(10, 12, 60)).toEqual({ first: 10, count: 12 })
    // A shot shorter than the moment: what there is.
    expect(footageWindow(2, 12, 4)).toEqual({ first: 2, count: 2 })
    expect(footageWindow(100, 12, 60)).toEqual({ first: 59, count: 1 })
  })

  it('a moment frame shows the pulled frame under it, clamped at both ends', () => {
    const plan = { at: -6, frames: 60, pulled: { files: ['a', 'b', 'c', 'd', 'e', 'f'], first: 0 } }
    expect(footageFrameIndex(plan, 0)).toBe(0)
    expect(footageFrameIndex(plan, 6)).toBe(0)
    expect(footageFrameIndex(plan, 9)).toBe(3)
    expect(footageFrameIndex(plan, 40)).toBe(5)
    // Pulled from the shot's frame 54 on: the moment's first frame is the FIRST file, not the fifty-fourth.
    expect(footageFrameIndex({ ...plan, at: 54, pulled: { files: ['a', 'b'], first: 54 } }, 0)).toBe(0)
    expect(footageFrameIndex({ ...plan, at: 54, pulled: { files: ['a', 'b'], first: 54 } }, 1)).toBe(1)
    expect(footageFrameIndex({ ...plan, pulled: undefined }, 3)).toBe(0)
  })

  const cap = footageCapFilter(FOOTAGE_MAX_EDGE)

  it('every case decodes from the in-point through the render’s own retime — its fps step at speed 1 — and trims the window out; a hold is one frame', () => {
    const held6 = (count: number): string => `tpad=stop_mode=clone:stop_duration=${(count / fps).toFixed(6)}`
    const plain = momentFrameArgs(req(), '/out/%05d.png')
    // From the in-point (frame 30 → 1 s), the render's whole input window: the sixty source frames the clip eats.
    expect(plain.slice(0, 4)).toEqual(['-ss', '1.000000', '-t', (sourceFramesFor({ duration: 60 }) / fps).toFixed(6)])
    expect(plain).toContain('/media/v.mp4')
    expect(plain[plain.indexOf('-frames:v') + 1]).toBe('6')
    expect(plain.slice(-3)).toEqual(['-start_number', '0', '/out/%05d.png'])
    // The render's fps step, so 24p and 60p footage gives the frames the render plays; the tail held; then the window.
    expect(plain[plain.indexOf('-vf') + 1]).toBe(`fps=30,${held6(6)},trim=start_frame=5:end_frame=11,setpts=PTS-STARTPTS,${cap},format=rgba`)

    const slow = momentFrameArgs(req({ speed: 0.5, first: 21, count: 4 }), '/out/%05d.png')
    // Through the render's own retime: a seek to 21 × 0.5 would land a frame off its phase.
    expect(slow.slice(0, 2)).toEqual(['-ss', '1.000000'])
    expect(slow[slow.indexOf('-t') + 1]).toBe((sourceFramesFor({ speed: 0.5, duration: 60 }) / fps).toFixed(6))
    expect(slow[slow.indexOf('-vf') + 1]).toBe(`setpts=PTS/0.5,fps=30,${held6(4)},trim=start_frame=21:end_frame=25,setpts=PTS-STARTPTS,${cap},format=rgba`)
    expect(slow[slow.indexOf('-frames:v') + 1]).toBe('4')

    // Smooth slow-motion looks ahead, so it gets the render's whole input window and eight source frames more (the 2018 build's minterpolate does not flush), its tail held.
    const smooth = momentFrameArgs(req({ speed: 0.5, smoothSlow: true, first: 54, count: 6 }), '/out/%05d.png')
    expect(smooth[smooth.indexOf('-t') + 1]).toBe(((sourceFramesFor({ speed: 0.5, duration: 60 }) + 8) / fps).toFixed(6))
    expect(smooth[smooth.indexOf('-vf') + 1]).toBe(`${retimeFilter({ speed: 0.5, smoothSlow: true, duration: 60 }, fps)},${held6(6)},trim=start_frame=54:end_frame=60,setpts=PTS-STARTPTS,${cap},format=rgba`)

    const ramped = momentFrameArgs(req({ ramp: { from: 1, to: 0.4 }, first: 30, count: 4 }), '/out/%05d.png')
    expect(ramped.slice(0, 2)).toEqual(['-ss', '1.000000'])
    // The render's own ramp over the clip's WHOLE length (sixty frames), not over the window: the curve depends on it.
    expect(ramped[ramped.indexOf('-vf') + 1]).toBe(`${retimeFilter({ ramp: { from: 1, to: 0.4 }, duration: 60 }, fps)},${held6(4)},trim=start_frame=30:end_frame=34,setpts=PTS-STARTPTS,${cap},format=rgba`)
    expect(ramped[ramped.indexOf('-frames:v') + 1]).toBe('4')
    // And the file decoded for the whole ramp: the source frames the clip eats (speed.ts sourceFramesFor).
    expect(ramped[ramped.indexOf('-t') + 1]).toBe((sourceFramesFor({ ramp: { from: 1, to: 0.4 }, duration: 60 }) / fps).toFixed(6))

    const held = momentFrameArgs(req({ hold: true, first: 54, count: 6 }), '/out/%05d.png')
    // Its one frame is the in-point's, whatever the window says.
    expect(held.slice(0, 2)).toEqual(['-ss', '1.000000'])
    expect(held[held.indexOf('-frames:v') + 1]).toBe('1')
    expect(held[held.indexOf('-vf') + 1]).toMatch(/^trim=end_frame=1,setpts=PTS-STARTPTS,/)
  })

  it('the crop is cut in the file’s pixels with the render’s own crop filter, and the cap is measured on the frame that arrives', () => {
    const cropped = momentFrameArgs(req({ crop: { x: 656, y: 0, width: 608, height: 1080 } }), '/out/%05d.png')
    const vf = cropped[cropped.indexOf('-vf') + 1]
    expect(vf).toContain(`crop=w='min(608,in_w)':h='min(1080,in_h)':x='max(0,min(656,in_w-out_w))':y='max(0,min(0,in_h-out_h))',${cap}`)
    // Never sized from the probe: a phone clip's probed size is its coded size, and it decodes turned.
    expect(cap).toBe("scale=w='trunc(iw*min(1,2160/max(iw,ih))/2)*2':h='trunc(ih*min(1,2160/max(iw,ih))/2)*2':flags=bicubic")
    expect(vf).not.toMatch(/scale=\d+:\d+/)
  })

  it('the frames are kept under a name that changes with the file, the window, the retime and the cut — each on its own — and nothing else', () => {
    const file = { size: 1000, mtimeMs: 12345 }
    const a = momentFramesKey(req(), file)
    expect(momentFramesKey(req(), file)).toBe(a)
    const changes: Partial<FootageRequest>[] = [
      { first: 6 }, { count: 7 }, { inPoint: 31 }, { speed: 0.5 }, { ramp: { from: 1, to: 0.4 } }, { hold: true }, { smoothSlow: true }, { fps: 25 }, { maxEdge: 1080 },
      { crop: { x: 0, y: 0, width: 10, height: 10 } }
    ]
    for (const change of changes) expect(momentFramesKey(req(change), file), JSON.stringify(change)).not.toBe(a)
    expect(momentFramesKey(req(), { size: 1001, mtimeMs: 12345 })).not.toBe(a)
    expect(momentFramesKey(req(), { size: 1000, mtimeMs: 99999 })).not.toBe(a)
    // The clip's length is the input window every pull decodes, so it is part of the name.
    expect(momentFramesKey(req({ duration: 90 }), file)).not.toBe(a)
    expect(momentFramesKey(req({ speed: 1 }), file)).toBe(a)
  })
})

/* --------------------------------------------------------------- export */

describe('an export redraws a moment', () => {
  const project = (settings: { width: number; height: number }): Project => ({
    ...emptyProject(),
    settings: { ...emptyProject().settings, ...settings, fps },
    assets: [asset('p1'), asset('p2'), asset('m', { path: '', size: 0 })],
    clips: [
      clip({ id: 'a', assetId: 'p1', start: 0, duration: 60 }),
      clip({ id: 'b', assetId: 'p2', start: 60, duration: 60 }),
      clip({ id: 'm', assetId: 'm', trackId: 'v2', start: 54, duration: 12, moment: spec() })
    ]
  })
  const unused = async (): Promise<never> => { throw new Error('not this one') }

  it('at the export’s own shape — the stills’ size — from the shots’ pictures placed at the moment’s start, under `<clip>-export`', async () => {
    const calls: { key: string; width: number; height: number; from: string | null; to: string; at: (number | null)[] }[] = []
    const bakers: Bakers = {
      moment: async (_s, key, textures, width, height, frames) => {
        calls.push({ key, width, height, from: textures.from?.path ?? null, to: textures.to.path, at: [textures.from?.at ?? null, textures.to.at] })
        return { pattern: `/cache/${key}.seq/%05d.png`, frames }
      },
      text: unused, textSequence: async () => null, solid: unused, title: unused, paper: unused, carousel: unused
    }
    const edit = project({ width: 1080, height: 1920 })
    const baked = await bakeForExport(edit, { width: 1920, height: 1080 }, bakers)
    // The shots as they are 54 frames into the outgoing and 6 before the incoming — not their first frames.
    expect(calls).toEqual([{ key: exportKey('m'), width: 1920, height: 1080, from: '/media/p1.jpg', to: '/media/p2.jpg', at: [54, -6] }])
    const drawn = baked.assets.find((a) => a.id === 'm')!
    expect(drawn.frames).toEqual({ pattern: '/cache/m-export.seq/%05d.png', count: 12 })
    expect(drawn.path).toBe('/cache/m-export.seq/00000.png')
    expect(drawn.width).toBe(1920)
    expect(drawn.height).toBe(1080)
    // The edit is untouched.
    expect(edit.assets.find((a) => a.id === 'm')!.path).toBe('')

    // At 4K the stills' size is the export canvas, twice the project's pixels — not the runs' size, which stays at the project's.
    calls.length = 0
    await bakeForExport(project({ width: 1920, height: 1080 }), { width: 3840, height: 2160 }, bakers)
    expect(calls[0].width).toBe(3840)
    expect(calls[0].height).toBe(2160)
  })

  it('a moment that cannot be drawn — its shot gone, or the drawing failing — is left out of the export, and said', async () => {
    let asked = 0
    const errors: string[] = []
    const bakers: Bakers = {
      moment: async () => { asked++; return null },
      text: async () => '', textSequence: async () => null, solid: async () => '', title: async () => '', paper: async () => null, carousel: async () => null
    }
    const gone: Project = {
      ...emptyProject(),
      assets: [asset('p1'), asset('m', { path: '/old/m.png' })],
      clips: [clip({ id: 'a', assetId: 'p1' }), clip({ id: 'm', assetId: 'm', trackId: 'v2', moment: spec({ to: { clipId: 'gone' } }) })]
    }
    const baked = await bakeForExport(gone, { width: 1080, height: 1920 }, bakers, (c, err) => errors.push(`${c.id}: ${String(err)}`))
    expect(asked).toBe(0)
    // Never the stale frames of a picture that is no longer beneath it.
    expect(baked.clips.map((c) => c.id)).toEqual(['a'])
    expect(errors).toEqual(['m: Error: a shot the moment bridges is gone or is footage'])

    const failed = await bakeForExport(project({ width: 1080, height: 1920 }), { width: 1080, height: 1920 }, bakers, (c, err) => errors.push(`${c.id}: ${String(err)}`))
    expect(asked).toBe(1)
    expect(failed.clips.some((c) => c.id === 'm')).toBe(false)
    expect(errors[1]).toBe('m: Error: the moment could not be drawn')

    // A bake that THROWS — no WebGL, a picture that will not decode — likewise: never an asset with an empty path in the export.
    const threw = await bakeForExport(
      project({ width: 1080, height: 1920 }),
      { width: 1080, height: 1920 },
      { ...bakers, moment: async () => { throw new Error('no WebGL') } },
      (c, err) => errors.push(`${c.id}: ${String(err)}`)
    )
    expect(threw.clips.some((c) => c.id === 'm')).toBe(false)
    expect(errors[2]).toBe('m: Error: no WebGL')
  })
})

/* --------------------------------------------------------------- guards */

describe('a moment is a self-drawing clip on every guard', () => {
  const moment = { moment: spec() }
  const image = { kind: 'image', hasVideo: true } as const
  const video: Track = { id: 'v1', kind: 'video', name: 'V1', muted: false, hidden: false, locked: false }

  it('is drawn by the app (recipes.ts), a graphic to the eye, and takes no move, key or steady', () => {
    expect(drawsItself(clip({ id: 'm', assetId: 'x', ...moment }))).toBe(true)
    expect(clipKind(clip({ id: 'm', assetId: 'x', ...moment }), asset('x'), video, fps)).toBe('graphic')
    expect(canMoveCamera(moment, image)).toBe(false)
    expect(isKeyable(moment, image)).toBe(false)
    expect(canSteady(moment, { kind: 'video', hasVideo: true, frames: undefined } as unknown as MediaAsset)).toBe(false)
    expect(DIRECTOR_RULES).toContain(MOMENT_RULE)
    for (const kind of ['zoom-punch', 'whip-blur', 'light-burn', 'depth-push'] as const) expect(DRAWN_MOMENTS).toContain(kind)
  })

  /*
   * The places the store, the preview and the bake spell the wiring out —
   * membership of the thing under test, with its ARGUMENTS, since a call that
   * exists with the wrong clip start draws the shots' first frames under every
   * moment (CLAUDE.md: anchor on text that is unique).
   */
  const source = (rel: string): string => readFileSync(resolve(__dirname, '..', rel), 'utf8')

  it('the store reframes and redraws it with the other drawn kinds, and bakes it after the Director — from the moment’s own start', () => {
    const store = source('src/renderer/src/store.ts')
    const aspect = store.indexOf('setAspect: (aspect) => {')
    expect(aspect).toBeGreaterThan(-1)
    expect(store.slice(aspect, aspect + 2500)).toContain('if (drawsItself(c)) return { ...c, crop: undefined }')
    const rebake = store.indexOf('rebakeGenerated: async () => {')
    expect(rebake).toBeGreaterThan(-1)
    const rebakeBody = store.slice(rebake, rebake + 4000)
    expect(rebakeBody).toContain('project.clips.filter(drawsItself)')
    expect(rebakeBody).toContain('if (clip.moment) {')
    expect(rebakeBody).toContain('momentTextures(get().project, clip.moment, clip.start)')
    expect(rebakeBody).toContain('bakeMomentSequence(clip.moment, clip.id, textures, width, height, clip.duration, fps)')
    const direct = store.indexOf('for (const clipId of applied.momentClipIds) {')
    expect(direct).toBeGreaterThan(-1)
    const directBody = store.slice(direct, direct + 1200)
    expect(directBody).toContain('momentTextures(applied.project, clip.moment, clip.start)')
    expect(directBody).toContain('bakeMomentSequence(clip.moment, clipId, textures, width, height, clip.duration, fps)')
  })

  it('the preview lets it past the readiness gate, draws it live from the moment’s own frame, and shows nothing rather than a stale file', () => {
    const preview = source('src/renderer/src/components/Preview.tsx')
    expect(preview).toMatch(/const drawsItself = \(layer: Layer\): boolean =>[\s\S]{0,200}layer\.clip\.moment/)
    const at = preview.indexOf('const sourceFor = (layer: Layer)')
    expect(at).toBeGreaterThan(-1)
    const body = preview.slice(at, at + 2200)
    expect(body).toContain('if (layer.clip.moment) {')
    expect(body).toContain('momentTextures(project, layer.clip.moment, layer.clip.start)')
    expect(body).toContain('{ frame: playhead - layer.clip.start, total: layer.clip.duration, fps }')
    expect(body).toContain('return live ?? nothing()')
    // And lets its scene go with the clip.
    expect(preview).toContain('forgetMomentPreview(clipId)')
  })

  it('the export bakers hand a moment to the same bake the store uses, and the bake writes only the frames that move', () => {
    const bakers = source('src/renderer/src/exportBakers.ts')
    expect(bakers).toMatch(/moment: \(spec, key, textures, width, height, frames, fps\) =>\s*bakeMomentSequence\(spec, key, textures, width, height, frames, fps\)/)
    const canvas = source('src/renderer/src/momentCanvas.ts')
    const bake = canvas.indexOf('export async function bakeMomentSequence(')
    expect(bake).toBeGreaterThan(-1)
    expect(canvas.slice(bake, bake + 900)).toContain('const total = movingFrames(spec, fps, Math.max(1, frames))')
  })
})
