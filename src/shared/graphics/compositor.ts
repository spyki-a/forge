/**
 * The compositor's pure half (docs/CLIPS.md §6.16, "The compositor"): which
 * route a frame's list takes, its planes, the order painter A paints a flat
 * frame in, and the camera's matrices. Here, not in the renderer's
 * `graphicCompositor.ts`, so node's tests import it without three.js or a
 * DOM; that file re-exports every name below, so §6.16's exports are its.
 *
 * Units. A plane's `z` is in frame heights, positive toward the viewer. The
 * world is the frame in pixels about its centre, x right and y UP (three's
 * convention), z toward the viewer: the `z = 0` plane is the frame itself,
 * `width` by `height` world units centred on the origin. Matrices are 4×4,
 * column-major, as three's `Matrix4.elements` and `fromArray` read them.
 *
 * Pure: no clock, no random, no DOM, no `node:path`.
 */

import type { Camera, DimItem, DrawItem, DrawList, GlowRequest } from './items'

/** At most this many distinct `z` values in one list (§6.16, proposal); a draw function never emits more. */
export const MAX_PLANES = 4

/** The camera's vertical field of view when the list gives none, in degrees (§6.16, proposal). */
export const DEFAULT_FOV = 30

/** The near and far clip planes, as fractions of the flat distance D: far outside every plane a drawer can place (depth testing is off). */
const NEAR_OF_D = 0.01
const FAR_OF_D = 100

/** One plane: a `z` and its items, in list order. */
export interface Plane {
  z: number
  items: DrawItem[]
}

/** Which of §6.16's three routes a list takes. */
export type CompositorRoute = 'flat' | 'glow' | 'perspective'

/**
 * The screen-space items: every top-level `dim`, in list order. A dim is a
 * darkened region of the frame, not an object in it, so it is painted on a
 * base layer under every plane by the identity route and never placed under
 * the camera (§6.16, "`dim` items are screen space").
 */
export function screenItemsOf(list: DrawList): DimItem[] {
  return list.items.filter((item): item is DimItem => item.kind === 'dim')
}

/**
 * The list's planes (§6.16, "Planes"): every top-level item but the dims,
 * grouped by `z ?? 0`, ascending (far to near, so drawn back to front), list
 * order kept inside a plane. A group's children ride their group's plane:
 * the plane is the top-level item's.
 */
export function planesOf(list: DrawList): Plane[] {
  const byZ = new Map<number, DrawItem[]>()
  for (const item of list.items) {
    if (item.kind === 'dim') continue
    const z = item.z ?? 0
    const plane = byZ.get(z)
    if (plane) plane.push(item)
    else byZ.set(z, [item])
  }
  return [...byZ.entries()].sort((a, b) => a[0] - b[0]).map(([z, items]) => ({ z, items }))
}

/**
 * The order painter A paints a flat frame in (routes one and two): the dims,
 * then each plane's items, far to near. A drawer that asks for depth emits
 * its dim first and its items in ascending `z` (§6.16), so this is its list
 * order, and the settled frame is the flat graphic's own.
 */
export function flatItems(list: DrawList): DrawItem[] {
  return [...screenItemsOf(list), ...planesOf(list).flatMap((plane) => plane.items)]
}

/** Whether the camera is flat: none, or tilt, yaw and dolly all 0 and no focus blur above 0. */
export function cameraIsFlat(camera: Camera | undefined): boolean {
  if (!camera) return true
  return camera.tilt === 0 && camera.yaw === 0 && camera.dolly === 0 && !(camera.focus && camera.focus.px > 0)
}

/** Whether the list's glow draws anywhere: a request of radius or strength 0 or below is left out (`glowBatches`), so a glow that has faded to 0 at rest is route one, exact by construction. */
const glows = (list: DrawList): boolean => glowBatches(list).length > 0

/**
 * §6.16's route one: the camera flat (none, or tilt, yaw and dolly all 0 and
 * no focus blur) and no glow. Painter A then paints every item onto one 2D
 * canvas and nothing reaches WebGL, so a 2.5D move's settled frame equals
 * the flat graphic by construction.
 */
export function isFlat(list: DrawList): boolean {
  return cameraIsFlat(list.camera) && !glows(list)
}

/** §6.16's table, from the list alone: flat; flat with a glow; or a camera off flat or a focus blur. */
export function compositorRoute(list: DrawList): CompositorRoute {
  if (!cameraIsFlat(list.camera)) return 'perspective'
  return glows(list) ? 'glow' : 'flat'
}

/* ------------------------------------------------------------------ matrices */

/** A 4×4 matrix, column-major. */
export type Mat4 = number[]

/** `a × b`, column-major. */
export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k]
      out[col * 4 + row] = sum
    }
  }
  return out
}

const translation = (x: number, y: number, z: number): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
const scaling = (x: number, y: number, z: number): Mat4 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]
const rad = (degrees: number): number => (degrees * Math.PI) / 180
/** About x: y toward z for a positive angle. */
function rotationX(radians: number): Mat4 {
  const c = Math.cos(radians), s = Math.sin(radians)
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]
}
/** About y: z toward x for a positive angle. */
function rotationY(radians: number): Mat4 {
  const c = Math.cos(radians), s = Math.sin(radians)
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]
}

/** three's `Matrix4.makePerspective` for a symmetric frustum: vertical `fov` in degrees. */
function perspective(fovDegrees: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(rad(fovDegrees) / 2)
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]
}

/** The flat distance D: from it, at `fov`, the `z = 0` plane exactly fills a frame `height` tall. */
export function flatDistance(fovDegrees: number, height: number): number {
  return height / 2 / Math.tan(rad(fovDegrees) / 2)
}

/**
 * The camera's matrices for a frame of `size` (§6.16, "The camera"): a
 * perspective at `fov` (`DEFAULT_FOV` when the list gives none) looking at
 * the frame's centre from `D × (1 − dolly)`, where `D` (`distance`) is the
 * flat distance, so dolly 0 is flat and a negative dolly starts further
 * away. The planes turn about the frame's centre lines: `tilt` about the
 * horizontal one, a positive tilt taking the top away from the viewer; `yaw`
 * about the vertical one, a positive yaw taking the right edge away. As
 * matrices, `view = T(0, 0, −D(1 − dolly)) · Rx(−tilt) · Ry(yaw)`. The
 * focus is not the camera's: the blur is the plane's (piece 2's shader).
 */
export function cameraFor(camera: Camera | undefined, size: { width: number; height: number }): { projection: Mat4; view: Mat4; distance: number } {
  const fov = camera && camera.fov > 0 ? camera.fov : DEFAULT_FOV
  const distance = flatDistance(fov, size.height)
  const at = distance * (1 - (camera?.dolly ?? 0))
  const projection = perspective(fov, size.width / size.height, distance * NEAR_OF_D, distance * FAR_OF_D)
  const view = mat4Multiply(translation(0, 0, -at), mat4Multiply(rotationX(-rad(camera?.tilt ?? 0)), rotationY(rad(camera?.yaw ?? 0))))
  return { projection, view, distance }
}

/** The parallax compensation (§6.16): a plane at `z` frame heights is scaled by `(D − zH) / D`, so under the flat camera it projects to the whole frame. */
export function compensation(z: number, height: number, distance: number): number {
  return (distance - z * height) / distance
}

/**
 * A plane's model matrix for the compositor's 2×2 quad (three's
 * `PlaneGeometry(2, 2)`, corners at ±1): scaled to the frame's half size
 * times the compensation, and moved to `z × H`.
 */
export function planeModel(z: number, size: { width: number; height: number }, distance: number): Mat4 {
  const s = compensation(z, size.height, distance)
  return mat4Multiply(translation(0, 0, z * size.height), scaling((size.width / 2) * s, (size.height / 2) * s, 1))
}

/* --------------------------------------------------------------- the focus */

/**
 * The focus blur's taps (§6.16, "Shaders": "a fixed disc of taps (13,
 * proposal)"): the texel itself, four at half the radius on the diagonals,
 * and eight at the radius every 45°, each weighted equally (1/13). In units
 * of the plane's radius; the shader scales them by it.
 */
export const FOCUS_TAPS = 13

const HALF = Math.SQRT1_2 / 2
const FOCUS_DISC: readonly (readonly [number, number])[] = Object.freeze(
  [
    [0, 0],
    [HALF, HALF],
    [-HALF, HALF],
    [-HALF, -HALF],
    [HALF, -HALF],
    ...Array.from({ length: 8 }, (_, i): [number, number] => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)])
  ].map((p) => Object.freeze(p) as readonly [number, number])
)

/** The disc's offsets, `FOCUS_TAPS` of them, the first the texel itself, in units of the radius. */
export function focusDisc(): readonly (readonly [number, number])[] {
  return FOCUS_DISC
}

/**
 * A plane's focus blur radius in frame pixels (§6.16, "The camera":
 * `Camera.focus` is "the depth in focus and the blur in frame pixels per frame
 * height of distance from it"): `px × |z − focus.z|`, with `z` in frame
 * heights. Exactly 0 on the depth in focus, and with no camera, no focus or a
 * focus of 0 px: the shader then returns the texel itself, so a settled plane
 * is exact.
 */
export function focusRadius(camera: Camera | undefined, z: number): number {
  const focus = camera?.focus
  if (!focus || !(focus.px > 0)) return 0
  const distance = Math.abs(z - focus.z)
  return distance === 0 ? 0 : focus.px * distance
}

/* ---------------------------------------------------------------- the glow */

/**
 * The glow's two routes behind one seam (§6.16, "Glow"): `'quad'`, the
 * planned route (the requested items alone, blurred in two separable passes,
 * added over the planes), and `'unreal'`, three r186's own `UnrealBloomPass`.
 * M7 (§6.15) runs both on the owner's two machines and the route not taken
 * is removed: a deletion of its branch, its module and its name here.
 */
export type GlowRoute = 'quad' | 'unreal'
export const GLOW_ROUTES: readonly GlowRoute[] = Object.freeze(['quad', 'unreal'] as GlowRoute[])

/** The route every compositor takes unless it is made with another (the harness's M7 does). The planned one until M7 decides. */
export const GLOW_ROUTE: GlowRoute = 'quad'

/** At most this many taps each side of the centre in one blur pass; a wider radius spaces them out (proposal). */
export const GLOW_MAX_HALF_TAPS = 32

/** The kernel's sigma as a fraction of the radius: the kernel stops at the radius, three sigmas out (proposal). */
export const GLOW_SIGMA_OF_RADIUS = 1 / 3

/** The quad route's cap on the glow's alpha, so the glow is below 1 wherever the shape is not (proposal). */
export const GLOW_MAX_ALPHA = 0.85

/** The `'unreal'` route's mapping of a request's radius in pixels onto `UnrealBloomPass.radius`, 0..1: this many pixels is 1 (proposal; M7's alternative only). */
export const UNREAL_RADIUS_PX = 64

/**
 * The `'unreal'` route's gain: r186's composite multiplies its five mips by
 * `3.0 * bloomStrength` and by `lerpBloomFactor` of the factors 1.0, 0.8,
 * 0.6, 0.4, 0.2, which sum to 3.0 at every `bloomRadius` (read in
 * node_modules, UnrealBloomPass.js), so a white input's bloom is 9 × the
 * mips' weighted mean. A request's strength is divided by this before it
 * becomes `bloomStrength`, so strength 1 is the mips' mean on that route as
 * it is the Gaussian's on the quad route, and M7 compares like with like.
 */
export const UNREAL_GAIN = 9

/** At most this many distinct (radius, strength) pairs of glow in one list: a drawer never emits more (the hero's and the edge sweep's; proposal). */
export const MAX_GLOW_BATCHES = 2

/**
 * One blur pass's kernel for a glow of `radius` frame pixels: the offsets
 * and weights of the taps from the centre out (`offsets[0]` is 0, the
 * centre; each other tap is sampled on both sides), Gaussian with sigma
 * `radius × GLOW_SIGMA_OF_RADIUS`, cut at the radius, normalised so the
 * centre plus twice every other weight is exactly 1 (a flat field stays
 * flat). The offsets are whole pixels, so every sample lands on a texel
 * centre and nothing beyond the radius is read: the glow's alpha is 0
 * beyond its reach. A radius of 0 or below is the texel itself.
 */
export function glowKernel(radius: number): { offsets: number[]; weights: number[] } {
  const reach = Math.round(radius)
  if (!(reach > 0)) return { offsets: [0], weights: [1] }
  const n = Math.min(reach, GLOW_MAX_HALF_TAPS)
  const offsets = Array.from({ length: n + 1 }, (_, i) => Math.round((i * reach) / n))
  const sigma = reach * GLOW_SIGMA_OF_RADIUS
  const raw = offsets.map((o) => Math.exp(-0.5 * (o / sigma) ** 2))
  const total = raw[0] + 2 * raw.slice(1).reduce((a, b) => a + b, 0)
  return { offsets, weights: raw.map((w) => w / total) }
}

/**
 * Whether an item is the one a request names: its id, or a piece of it
 * (`textItems` names a field's pieces `<field>-<n>`, `n` a whole number,
 * items.ts), and nothing else: `value-bg` is not a piece of `value`.
 * Top-level items only: a group is taken whole by its own id.
 */
export function glowMatches(id: string, request: GlowRequest): boolean {
  if (id === request.item) return true
  const prefix = `${request.item}-`
  return id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length))
}

/** The requested items alone, in list order: what a glow canvas holds (§6.16: "the requested items are painted alone"). Never a dim. */
export function glowItemsOf(items: readonly DrawItem[], requests: readonly GlowRequest[]): DrawItem[] {
  return items.filter((item) => item.kind !== 'dim' && requests.some((r) => glowMatches(item.id, r)))
}

/** Requests of one radius and strength: blurred and added once. */
export interface GlowBatch {
  radius: number
  strength: number
  requests: GlowRequest[]
}

/** The list's glow requests grouped by radius and strength, in first-seen order; a request of radius or strength 0 or below glows nowhere and is left out. */
export function glowBatches(list: DrawList): GlowBatch[] {
  const batches: GlowBatch[] = []
  for (const request of list.glow ?? []) {
    if (!(request.radius > 0) || !(request.strength > 0)) continue
    const batch = batches.find((b) => b.radius === request.radius && b.strength === request.strength)
    if (batch) batch.requests.push(request)
    else batches.push({ radius: request.radius, strength: request.strength, requests: [request] })
  }
  return batches
}

