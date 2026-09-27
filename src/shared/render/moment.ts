import type { Clip, CropRect, MomentKind, MomentSpec, Motion } from '../timeline'
import { effectiveCrop } from './crop'
import { motionSourceRect, moveAt, type SourceRect } from './motion'
import { fitFor, planeShare } from './plan'

/**
 * Moments, decided without a GPU (docs/PLAN.md §7).
 *
 * `momentCanvas.ts` draws; this says WHEN — how many frames a moment has and
 * where they sit against the cut — and WHAT, the numbers each kind draws from
 * at a time `t`, seeded so the same spec draws the same picture twice. Same
 * division as `carousel.ts` and `carouselCanvas.ts`: the geometry is testable
 * in node, and the drawing file contains nothing worth asserting beyond "it
 * drew".
 *
 * The contract every moment keeps: it spans `[cut − before, cut + after]`
 * frames on the layer above the cut; its frames are opaque where it draws;
 * its FIRST frame (t = 0) is the outgoing shot's picture and its LAST (t = 1)
 * the incoming one's, so the hand-offs beneath it are invisible.
 */

export const DRAWN_MOMENTS: readonly MomentKind[] = ['zoom-punch', 'whip-blur', 'light-burn', 'depth-push']

/** Seconds each kind wants, by default, and its bounds. */
export const MOMENT_SECONDS: Record<MomentKind, { default: number; min: number; max: number }> = {
  'zoom-punch': { default: 0.4, min: 0.3, max: 0.7 },
  'whip-blur': { default: 0.4, min: 0.3, max: 0.7 },
  'light-burn': { default: 0.55, min: 0.3, max: 0.7 },
  'depth-push': { default: 2, min: 1.5, max: 3 },
  'kinetic-type': { default: 2, min: 1, max: 4 }
}

/** A depth push is a move into one picture; the rest bridge a cut. */
export function bridgesCut(kind: MomentKind): boolean {
  return kind !== 'depth-push' && kind !== 'kinetic-type'
}

export interface MomentSpan {
  /** Frames before the cut — over the outgoing shot. */
  before: number
  /** Frames from the cut on — over the incoming. */
  after: number
  total: number
}

/**
 * How a moment's frames sit against its cut. A bridge is split evenly, the
 * odd frame going after, so the cut frame itself is the moment's midpoint —
 * where a light burn peaks. A single-shot moment is all "after": it starts
 * on the shot's first frame.
 */
export function momentSpan(spec: Pick<MomentSpec, 'kind' | 'seconds'>, fps: number): MomentSpan {
  const bounds = MOMENT_SECONDS[spec.kind]
  const seconds = Math.max(bounds.min, Math.min(bounds.max, spec.seconds))
  const total = Math.max(2, Math.round(seconds * fps))
  if (!bridgesCut(spec.kind)) return { before: 0, after: total, total }
  const before = Math.floor(total / 2)
  return { before, after: total - before, total }
}

/**
 * The span, shrunk to the footage on either side: never past the outgoing
 * shot's start or the incoming shot's end. Says when it shrank.
 */
export function fitSpan(
  span: MomentSpan,
  room: { before: number; after: number }
): { span: MomentSpan; shrank: boolean } {
  const before = Math.max(0, Math.min(span.before, room.before))
  const after = Math.max(1, Math.min(span.after, room.after))
  const total = before + after
  return { span: { before, after, total }, shrank: total < span.total }
}

/** Where a moment's clip sits: `start` on the timeline, `duration` its frames. */
export function momentPlacement(cut: number, span: MomentSpan): { start: number; duration: number } {
  return { start: cut - span.before, duration: span.total }
}

/**
 * How many of a moment's `total` frames MOVE. All of a bridge's. A depth push
 * runs the whole of its shot — its clip is as long as the shot — but eases
 * over its own seconds and then HOLDS, so the shot never pops back to where
 * the push left it: the bake writes only the moving frames and the export
 * holds the last (plan.ts `holdFilter`), exactly as an animated caption's.
 */
export function movingFrames(spec: Pick<MomentSpec, 'kind' | 'seconds'>, fps: number, total: number): number {
  if (bridgesCut(spec.kind)) return Math.max(1, total)
  return Math.max(1, Math.min(total, momentSpan(spec, fps).total))
}

/** The moment's own time at a frame of its clip, 0 at its first frame, 1 at its last. */
export function momentT(frame: number, total: number): number {
  if (total <= 1) return 1
  return Math.max(0, Math.min(1, frame / (total - 1)))
}

/* --------------------------------------------------------------- random */

/** mulberry32: a small seeded generator, so a seed is a picture and not a mood. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ----------------------------------------------------------- parameters */

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))
const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3)

export interface ZoomPunchParams {
  kind: 'zoom-punch'
  /** 0..1 — how much of the incoming shows (the cross-over). */
  mix: number
  /** Radial blur strength, 0..1, peaking on the cut. */
  blur: number
  /** Scale of the outgoing picture (it falls away — grows and fades). */
  fromScale: number
  /** Scale of the incoming (pops in from slightly large, settles to 1). */
  toScale: number
}

export interface WhipBlurParams {
  kind: 'whip-blur'
  mix: number
  /** Blur length as a share of the frame along the axis, peaking mid-moment. */
  blur: number
  /** Unit vector of the whip axis. */
  axis: { x: number; y: number }
  /** How far the outgoing has slid out and the incoming in, −1..1 frame widths. */
  fromOffset: number
  toOffset: number
}

export interface LightBurnParams {
  kind: 'light-burn'
  /** Hard cut at the midpoint: 0 shows the outgoing, 1 the incoming. */
  mix: number
  /** Overall light strength, 0..1, peaking on the cut. */
  glow: number
  /** Two soft lights: centre (0..1 frame coords), radius (frame widths), warmth. */
  lights: { x: number; y: number; radius: number; warmth: number }[]
  /** Film grain strength, 0..1. */
  grain: number
}

export interface DepthPushParams {
  kind: 'depth-push'
  /** Camera dolly progress with a slow ease, 0..1. */
  push: number
  /** Scale of the whole picture without planes — the fallback push. */
  scale: number
  /** Per-plane scale, nearest last: nearer planes grow more, the parallax of a real dolly. */
  planeScale: (depth: number) => number
}

export type MomentParams = ZoomPunchParams | WhipBlurParams | LightBurnParams | DepthPushParams

/** How hard a moment hits: the coherence dial, with a floor so a calm ad's moment is still one. */
export function momentAmount(intensity: number): number {
  return 0.35 + 0.65 * clamp01(intensity)
}

/**
 * Everything a frame needs, from the spec and a time — a pure function, with
 * the seed's randomness drawn in a fixed order so t never changes what the
 * seed chose.
 */
export function momentParams(spec: MomentSpec, t: number): MomentParams {
  const time = clamp01(t)
  const amount = momentAmount(spec.intensity)
  const random = seeded(spec.seed)
  switch (spec.kind) {
    case 'zoom-punch': {
      // A bell over the cut; the incoming takes over just before the middle so the pop lands on it.
      const bell = Math.sin(Math.PI * time)
      return {
        kind: 'zoom-punch',
        mix: time < 0.45 ? 0 : time < 0.55 ? (time - 0.45) / 0.1 : 1,
        blur: time === 0 || time === 1 ? 0 : bell * amount,
        fromScale: 1 + easeOut(time) * 0.6 * amount,
        toScale: 1 + (1 - easeOut(Math.max(0, (time - 0.5) * 2))) * 0.25 * amount * (time < 1 ? 1 : 0)
      }
    }
    case 'whip-blur': {
      // The seed chooses the whip's direction: mostly sideways, sometimes up or down. Never a tilt — two
      // pictures sliding along a tilted axis leave corners of the frame that neither covers.
      const angle = (random() < 0.7 ? 0 : Math.PI / 2) + (random() < 0.5 ? 0 : Math.PI)
      const bell = Math.sin(Math.PI * time)
      const slide = easeInOut(time)
      return {
        kind: 'whip-blur',
        mix: time < 0.5 ? 0 : 1,
        blur: time === 0 || time === 1 ? 0 : bell * amount,
        axis: { x: Math.cos(angle), y: Math.sin(angle) },
        // `0 - slide`, not `-slide`: at t = 0 the outgoing has not moved, and "not moved" is +0, not −0.
        fromOffset: 0 - slide,
        toOffset: 1 - slide
      }
    }
    case 'light-burn': {
      const drift = random() * 2 - 1
      const lights = [0, 1].map((i) => {
        const x0 = random()
        const y0 = random()
        const radius = 0.35 + random() * 0.3
        const warmth = 0.6 + random() * 0.4
        // Each light drifts across the frame over the moment, the seed's way.
        return { x: clamp01(x0 + (time - 0.5) * 0.5 * drift * (i === 0 ? 1 : -1)), y: clamp01(y0 + (time - 0.5) * 0.25 * drift), radius, warmth }
      })
      const bell = Math.pow(Math.sin(Math.PI * time), 1.5)
      return {
        kind: 'light-burn',
        mix: time < 0.5 ? 0 : 1,
        glow: time === 0 || time === 1 ? 0 : bell * amount,
        lights,
        grain: time === 0 || time === 1 ? 0 : 0.15 * amount * bell
      }
    }
    case 'depth-push':
    case 'kinetic-type': {
      // A slow ease in, so the camera is already moving when the shot is seen and never lurches.
      const push = easeInOut(time)
      const reach = 0.18 * amount
      return {
        kind: 'depth-push',
        push,
        scale: 1 + push * reach,
        // The nearest plane (depth 1) grows the full reach; the farthest (0) barely moves.
        planeScale: (depth: number) => 1 + push * reach * (0.25 + 0.75 * clamp01(depth))
      }
    }
  }
}

/* ------------------------------------------------------------- textures */

/**
 * A shot's picture as the moment sees it: the file and its size, the shot's
 * crop, its box and fit, its camera move, the punch-in of the transition it
 * entered with, its depth planes, and where in the shot the moment's first
 * frame falls — everything `shotPicture` needs to show the SAME picture the
 * shot itself shows on that frame, so the hand-off under the moment's first
 * and last frames is invisible.
 */
export interface TexturePlan {
  path: string
  /** The picture's own pixels. */
  size: { width: number; height: number }
  crop?: CropRect
  /** As the render fits the shot: `contain` unless the clip says `cover` (plan.ts `clipBox`). */
  fit: 'cover' | 'contain'
  /** The clip's box on the frame — its transform's scale and offset, as `clipBox` reads them. */
  box?: { scale: number; scaleY?: number; x: number; y: number }
  /** The shot's camera move, so the moment's picture moves with the shot beneath it. */
  motion?: Motion
  /**
   * The punch-in of the transition the shot entered with: a constant
   * enlargement of the whole clip (registry.ts `punchIn`, 1.15 for the zoom
   * family), applied by the render for the clip's entire length. 1 = none.
   */
  inset?: number
  /** The shot's length in frames — the move runs across it. */
  frames: number
  /** The shot's frame under the moment's FIRST frame: negative before the shot starts, clamped when read. */
  at: number
  /**
   * The parallax planes, far to near, as the render draws them: for a shot
   * whose move is a parallax (each plane moved by its own share) and for a
   * depth push (each plane pushed by its depth). Absent, the picture alone.
   */
  planes?: { file: string; depth: number }[]
  /**
   * Footage: the shot's frames under the moment, one file each from the
   * shot's frame `first` on — already cropped, at `size`, as the pre-pass
   * pulled them through the render's own retime (momentFrames.ts). A frame
   * of the moment shows `pulled.files[footageFrameIndex(...)]`.
   */
  pulled?: { files: string[]; first: number }
  /**
   * Footage not yet pulled: what to ask the pre-pass for. The renderer
   * resolves it into `pulled` (and drops the crop, which the pre-pass
   * applies) before it draws; the eval does the same in node.
   */
  footage?: FootageRequest
}

/** What the pre-pass pulls for one shot under a moment: the frames, cropped and capped, through the clip's own retime. */
export interface FootageRequest {
  path: string
  /** The clip's in-point, speed, ramp and hold — its retime, exactly as the render plays it. */
  inPoint: number
  /** The clip's length on the timeline: a ramp's curve runs across the whole of it. */
  duration: number
  speed?: number
  ramp?: { from: number; to: number }
  smoothSlow?: boolean
  hold?: boolean
  /** The clip's frames wanted: from `first`, `count` of them. */
  first: number
  count: number
  fps: number
  /** The clip's crop, in the file's pixels, and the file's size as probed. */
  crop?: CropRect
  size: { width: number; height: number }
  /** The longest edge the frames are kept at. */
  maxEdge: number
}

/** The frames of a shot a moment shows: the shot's frame under each of the moment's `total` frames, clamped to the shot. */
export function footageWindow(at: number, total: number, frames: number): { first: number; count: number } {
  const last = Math.max(0, frames - 1)
  const first = Math.max(0, Math.min(last, at))
  const end = Math.max(0, Math.min(last, at + Math.max(1, total) - 1))
  return { first, count: end - first + 1 }
}

/** Which of a shot's pulled frames a moment frame shows. */
export function footageFrameIndex(plan: Pick<TexturePlan, 'pulled' | 'at' | 'frames'>, momentFrame: number): number {
  if (!plan.pulled || plan.pulled.files.length === 0) return 0
  const into = Math.max(0, Math.min(plan.frames - 1, plan.at + momentFrame))
  return Math.max(0, Math.min(plan.pulled.files.length - 1, into - plan.pulled.first))
}

/**
 * The picture a shot clip shows, for the moment to draw from — its crop, box,
 * fit, move and punch-in as the render applies them. `followMove` is off for
 * a depth push: the push IS the shot's move for as long as it covers the
 * shot, and the photo's own move under it would be doubled.
 */
export function texturePlanFor(
  clip: Pick<Clip, 'crop' | 'transform' | 'motion' | 'start' | 'duration'>,
  asset: { path: string; width?: number | null; height?: number | null },
  momentStart: number,
  planes?: { file: string; depth: number }[],
  followMove = true,
  inset = 1
): TexturePlan {
  const t = clip.transform
  const plain = !t || ((t.scale ?? 1) === 1 && (t.scaleY ?? t.scale ?? 1) === 1 && (t.x ?? 0) === 0 && (t.y ?? 0) === 0)
  return {
    path: asset.path,
    size: { width: asset.width ?? 0, height: asset.height ?? 0 },
    ...(clip.crop ? { crop: clip.crop } : {}),
    fit: t?.fit ?? 'contain',
    ...(plain ? {} : { box: { scale: t.scale, ...(t.scaleY !== undefined ? { scaleY: t.scaleY } : {}), x: t.x, y: t.y } }),
    ...(clip.motion && followMove ? { motion: clip.motion } : {}),
    ...(inset > 1 ? { inset } : {}),
    frames: Math.max(1, clip.duration),
    at: momentStart - clip.start,
    ...(planes && planes.length >= 2 ? { planes } : {})
  }
}

/** A rectangle in 0..1 units of whatever it is measured against. */
export interface UnitRect {
  x: number
  y: number
  width: number
  height: number
}

/** One layer of a shot's picture: the whole photo (`plane: null`) or one of its depth planes, and the part of it shown. */
export interface ShotLayer {
  plane: number | null
  /** The part of that picture shown, in 0..1 of its own pixels. */
  src: UnitRect
}

/**
 * A shot's picture on one of the moment's frames, as the render composes it:
 * `box`, the part of the FRAME the picture covers (the clip's box, all of the
 * frame for a plain clip; within it a letterbox for a contained picture), and
 * the `layers` drawn into it, far to near — the whole photo, or each depth
 * plane with its own share of the move. Each layer's `src` is the shot's crop,
 * narrowed by the camera move at that frame (`motionSourceRect`, per plane by
 * `planeShare` as plan.ts does), narrowed by the transition's punch-in about
 * its centre (`insetRect` in the preview), and for a filled picture narrowed
 * again to the box's shape, centred (`coverTransform` in the preview,
 * `fitFilter` in the render).
 *
 * The move is read at the shot's own frame under this one (`plan.at` plus the
 * moment frame), clamped to the shot: before the shot starts it shows the
 * shot's first frame, after it ends its last.
 */
export function shotPicture(
  plan: Pick<TexturePlan, 'size' | 'crop' | 'fit' | 'box' | 'motion' | 'inset' | 'frames' | 'at' | 'planes'>,
  momentFrame: number,
  canvas: { width: number; height: number },
  fps: number
): { box: UnitRect; layers: ShotLayer[] } {
  const size = plan.size.width > 0 && plan.size.height > 0 ? plan.size : { width: 1, height: 1 }
  const crop = effectiveCrop(plan.crop, size)
  const into = Math.max(0, Math.min(plan.frames - 1, plan.at + momentFrame))
  const { progress, seconds } = plan.motion ? moveAt(plan.motion, plan.frames, into, fps) : { progress: 0, seconds: 0 }
  const whole: SourceRect = { sx: 0, sy: 0, sw: crop.width, sh: crop.height }
  const inset = (r: SourceRect): SourceRect => {
    const z = Math.max(1, plan.inset ?? 1)
    const sw = r.sw / z
    const sh = r.sh / z
    return { sx: r.sx + (r.sw - sw) / 2, sy: r.sy + (r.sh - sh) / 2, sw, sh }
  }
  // The planes move only under a move that reads them (plan.ts parallaxBakeFor); otherwise the photo, whole.
  const motion = plan.motion
  const perPlane = motion !== undefined && plan.planes !== undefined && plan.planes.length >= 2 && (motion.kind === 'parallax' || (motion.kind === 'shake' && motion.anchor === 'subject'))
  const moved: { plane: number | null; rect: SourceRect }[] = perPlane
    ? plan.planes!.map((p, i) => ({
        plane: i,
        rect: inset(motionSourceRect(motion, progress, seconds, crop.width, crop.height, planeShare(motion, motion.amount, p.depth)))
      }))
    : [{ plane: null, rect: inset(motion ? motionSourceRect(motion, progress, seconds, crop.width, crop.height) : whole) }]

  /* The clip's box on the frame: the whole of it unless the transform says otherwise (plan.ts clipBox). */
  const scale = Math.max(0.02, Math.min(4, plan.box?.scale ?? 1))
  const scaleY = Math.max(0.02, Math.min(4, plan.box?.scaleY ?? scale))
  const clipBox: UnitRect = { x: (1 - scale) / 2 + (plan.box?.x ?? 0) / 2, y: (1 - scaleY) / 2 + (plan.box?.y ?? 0) / 2, width: scale, height: scaleY }
  const boxPx = { width: clipBox.width * canvas.width, height: clipBox.height * canvas.height }
  const boxRatio = boxPx.width / Math.max(1, boxPx.height)
  // Every layer is the same shape (the move only shifts and zooms), so the fit is decided once.
  const shownRatio = moved[0].rect.sw / Math.max(1, moved[0].rect.sh)
  // A crop within 1 % of the box's shape fills it rather than drawing a line of black (plan.ts NEAR_SHAPE).
  const fit = fitFor({ width: boxPx.width, height: boxPx.height, fit: plan.fit }, { width: moved[0].rect.sw, height: moved[0].rect.sh })
  let box = clipBox
  const narrow = (r: SourceRect): SourceRect => {
    if (fit !== 'cover') return r
    if (shownRatio > boxRatio) {
      const sw = r.sh * boxRatio
      return { ...r, sx: r.sx + (r.sw - sw) / 2, sw }
    }
    if (shownRatio < boxRatio) {
      const sh = r.sw / boxRatio
      return { ...r, sy: r.sy + (r.sh - sh) / 2, sh }
    }
    return r
  }
  if (fit !== 'cover') {
    if (shownRatio > boxRatio) {
      const height = clipBox.height * (boxRatio / shownRatio)
      box = { ...clipBox, y: clipBox.y + (clipBox.height - height) / 2, height }
    } else if (shownRatio < boxRatio) {
      const width = clipBox.width * (shownRatio / boxRatio)
      box = { ...clipBox, x: clipBox.x + (clipBox.width - width) / 2, width }
    }
  }
  return {
    box,
    layers: moved.map(({ plane, rect }) => {
      const r = narrow(rect)
      return { plane, src: { x: (crop.x + r.sx) / size.width, y: (crop.y + r.sy) / size.height, width: r.sw / size.width, height: r.sh / size.height } }
    })
  }
}
