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

import type { Camera, DimItem, DrawItem, DrawList } from './items'

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

const glows = (list: DrawList): boolean => (list.glow?.length ?? 0) > 0

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

