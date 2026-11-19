/**
 * `window.__forgeGraphicCheck({ glow: ['unreal', 'quad'] })` (M7) and
 * `window.__forgeGraphicCheck({ focus: true })` (docs/CLIPS.md §6.11's
 * options table, §6.15's M7, §6.16 "Glow" and "Shaders"; phase 3's piece 2),
 * on this page's own WebGL.
 *
 * - **M7.** A rounded blue panel asking for a glow (`GLOW_CHECK_REQUEST`),
 *   over a transparent frame, through a compositor on each named route
 *   (`createCompositor`'s `glow`): the glow frame's alpha against the shape
 *   painter A drew (`glowAlpha`: beyond the reach exactly 0, the glow below
 *   255 outside the shape), the base under the glow (the same compositor with
 *   the glow left out, `CompositorProbe`) against painter A, the time per
 *   glowing frame, and the shared renderer's `info.memory` before, built and
 *   after `dispose`. `'pmndrs'` is a scratch branch's (§6.15) and is named in
 *   the notes, not drawn. Pictures for the eye: each route's glow over black,
 *   its alpha alone (white is opaque), and the glow under a 24° tilt.
 * - **Focus.** A cream field filling the frame with blue stripes on it, every
 *   item on the plane at z 0.05: with the depth in focus there (radius 0)
 *   against painter A, and with the focus at z 0 (`FOCUS_CHECK_PX` per frame
 *   height, so a radius of `FOCUS_CHECK_PX × 0.05` px) against painter A over
 *   the stripes, and the frame's border alpha.
 */

import type { Camera, DrawItem, DrawList, GlowRequest, ShapeItem } from '@shared/graphics/items'
import { paintDrawList2d } from '@shared/graphics/paint'
import { focusRadius } from '@shared/graphics/compositor'
import { sharedRenderer } from '../threeShared'
import { createCompositor, paintDrawList3d, resetCompositorSession, type Compositor, type CompositorProbe } from '../graphicCompositor'
import { diffChannels } from './compositorMeasure'
import { inkBox, padRect, percentile } from './graphicMeasure'
import {
  borderAlphaMin,
  focusVerdict,
  glowAlpha,
  glowRouteVerdict,
  type FocusReadings,
  type GlowRouteName,
  type GlowRouteReading
} from './glowMeasure'

const W = 540
const H = 960
const BLUE = '#2563eb'
const CREAM = '#f6f2ea'
const FLAT: Camera = { tilt: 0, yaw: 0, dolly: 0, fov: 30 }

/** M7's request: a 24 px glow at full strength on the panel. */
export const GLOW_CHECK_REQUEST: GlowRequest = Object.freeze({ item: 'shape', radius: 24, strength: 1 })
/** Glowing frames timed per route. */
export const GLOW_CHECK_FRAMES = 30
/** The focus check's blur, px per frame height of distance: 200 × 0.05 = a 10 px radius (§6.16's focus variant starts at 10 px). */
export const FOCUS_CHECK_PX = 200

export interface GlowResult {
  size: { width: number; height: number }
  request: GlowRequest
  routes: (GlowRouteReading & { verdict: { pass: boolean; failures: string[] } })[]
  /** Routes asked for and not drawn here (`'pmndrs'`: a scratch branch's). */
  skipped: string[]
}

export interface FocusResult extends FocusReadings {
  size: { width: number; height: number }
  verdict: { pass: boolean; failures: string[] }
}

interface Frames {
  canvas: (label: string, canvas: HTMLCanvasElement) => void
}

function canvas2d(width = W, height = H): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('glow check: no 2D context')
  return { canvas, ctx }
}

const freshLayer = (width: number, height: number): CanvasRenderingContext2D => canvas2d(width, height).ctx
const pixelsOf = (canvas: HTMLCanvasElement): Uint8ClampedArray => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
const list = (items: DrawItem[], extra: Partial<DrawList> = {}): DrawList => ({ width: W, height: H, items, ...extra })

function painterA(l: DrawList): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d()
  paintDrawList2d(ctx, l, { layer: freshLayer })
  return canvas
}

/** Painter B, copied out at once as the seam copies it. */
function painterB(l: DrawList, compositor: Compositor, probe: CompositorProbe = {}): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d()
  ctx.drawImage(paintDrawList3d(l, compositor, { layer: freshLayer }, probe), 0, 0)
  return canvas
}

function over(picture: HTMLCanvasElement, background: string): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d()
  ctx.fillStyle = background
  ctx.fillRect(0, 0, W, H)
  ctx.drawImage(picture, 0, 0)
  return canvas
}

/** A picture's alpha alone, as grey on black: white is opaque, so the glow's reach shows. */
function alphaView(picture: HTMLCanvasElement): HTMLCanvasElement {
  const data = pixelsOf(picture)
  const { canvas, ctx } = canvas2d()
  const image = ctx.createImageData(W, H)
  for (let p = 0; p < W * H; p++) {
    const a = data[p * 4 + 3]
    image.data[p * 4] = image.data[p * 4 + 1] = image.data[p * 4 + 2] = a
    image.data[p * 4 + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

const panel = (z?: number): ShapeItem => ({ kind: 'shape', id: 'shape', opacity: 1, shape: 'rounded', box: { x: 160, y: 400, width: 220, height: 140 }, radius: 24, fill: BLUE, ...(z === undefined ? {} : { z }) })

export async function checkGlow(asked: readonly string[] | true, frames: Frames, summary: string[], notes: string[]): Promise<GlowResult> {
  const names = asked === true ? ['unreal', 'quad'] : [...asked]
  const routes = names.filter((n): n is GlowRouteName => n === 'quad' || n === 'unreal')
  const skipped = names.filter((n) => n !== 'quad' && n !== 'unreal')
  for (const name of skipped) notes.push(`glow: '${name}' is not drawn here: ${name === 'pmndrs' ? 'pmndrs postprocessing is run only from a scratch branch with the package added there (§6.15)' : 'not a glow route'}.`)

  const request = GLOW_CHECK_REQUEST
  const flatList = list([panel()])
  const glowing = list([panel()], { glow: [request] })
  const reference = pixelsOf(painterA(flatList))
  frames.canvas('M7: the shape, painter A (no glow)', over(painterA(flatList), '#000000'))

  resetCompositorSession()
  const { renderer } = await sharedRenderer(W, H)
  const memoryNow = (): { geometries: number; textures: number } => ({ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures })
  const result: GlowResult = { size: { width: W, height: H }, request: { ...request }, routes: [], skipped }
  for (const route of routes) {
    const before = memoryNow()
    const compositor = await createCompositor(W, H, { glow: route })
    if (!compositor) throw new Error('glow check: createCompositor gave null on this page: WebGL did not start')
    let reading: GlowRouteReading
    try {
      const picture = painterB(glowing, compositor)
      const alpha = glowAlpha(reference, pixelsOf(picture), W, H, request.radius)
      const base = diffChannels(reference, pixelsOf(painterB(glowing, compositor, { glow: false })))
      const times: number[] = []
      const { ctx } = canvas2d()
      for (let i = 0; i < GLOW_CHECK_FRAMES; i++) {
        const start = performance.now()
        ctx.clearRect(0, 0, W, H)
        ctx.drawImage(paintDrawList3d(glowing, compositor, { layer: freshLayer }), 0, 0)
        // A read back waits for the GPU, so the time is the frame's, not its submission's.
        ctx.getImageData(0, 0, 1, 1)
        times.push(performance.now() - start)
      }
      frames.canvas(`M7: route ${route}, the glow over black`, over(picture, '#000000'))
      frames.canvas(`M7: route ${route}, its alpha alone (white is opaque; the reach is ${alpha.reach} px)`, alphaView(picture))
      frames.canvas(`M7: route ${route}, the glow under a 24° tilt, over black`, over(painterB(list([panel(0)], { glow: [request], camera: { ...FLAT, tilt: 24 } }), compositor), '#000000'))
      reading = { route, alpha, base, msPerFrame: percentile(times, 50), memory: { before, built: memoryNow(), after: before } }
    } finally {
      compositor.dispose()
    }
    reading.memory.after = memoryNow()
    const verdict = glowRouteVerdict(reading)
    result.routes.push({ ...reading, verdict })
    const a = reading.alpha
    summary.push(
      `M7 route ${route}: alpha beyond the reach (${a.reach} px) max ${a.outsideReach} over ${a.outsidePixels} px; the glow outside the shape max ${a.glowMax} over ${a.glowPixels} px; ` +
        `by distance ${a.bands.map((b) => `(${b.from}, ${b.to === Infinity ? '∞' : b.to}] ${b.maxAlpha}`).join(', ')}; the base against painter A mean ${reading.base.meanAll.toFixed(3)} max ${reading.base.maxAll}; ` +
        `${reading.msPerFrame.toFixed(2)} ms a frame (median of ${GLOW_CHECK_FRAMES}); memory before ${reading.memory.before.geometries} / ${reading.memory.before.textures}, after ${reading.memory.after.geometries} / ${reading.memory.after.textures}; ` +
        `verdict: ${verdict.pass ? 'PASS' : `FAIL: ${verdict.failures.join('; ')}`}`
    )
    if (!verdict.pass) notes.push(...verdict.failures.map((f) => `M7: ${f}`))
  }
  const passed = result.routes.filter((r) => r.verdict.pass).map((r) => r.route)
  summary.push(`M7 on this machine: ${passed.length ? `${passed.join(' and ')} pass${passed.length === 1 ? 'es' : ''}` : 'no route passes'}. The rule (§6.16): unreal is the route if it passes on both machines; else quad.`)
  return result
}

export async function checkFocus(frames: Frames, summary: string[], notes: string[]): Promise<FocusResult> {
  const z = 0.05
  const field: ShapeItem = { kind: 'shape', id: 'field', opacity: 1, shape: 'rect', box: { x: 0, y: 0, width: W, height: H }, fill: CREAM }
  const stripes: ShapeItem[] = Array.from({ length: 8 }, (_, i) => ({ kind: 'shape', id: `stripe-${i}`, opacity: 1, shape: 'rect', box: { x: 150 + i * 30, y: 380, width: 12, height: 200 }, fill: BLUE }))
  const items: DrawItem[] = [field, ...stripes]
  const onPlane = items.map((item) => ({ ...item, z }))
  const reference = painterA(list(items))
  const referencePixels = pixelsOf(reference)
  const stripesInk = inkBox(pixelsOf(painterA(list(stripes))), W, H)
  if (!stripesInk) throw new Error('focus check: the stripes drew no ink')
  const sharpCamera: Camera = { ...FLAT, focus: { z, px: FOCUS_CHECK_PX } }
  const blurCamera: Camera = { ...FLAT, focus: { z: 0, px: FOCUS_CHECK_PX } }
  const radius = focusRadius(blurCamera, z)
  const area = { width: W, rect: padRect(stripesInk, Math.ceil(radius) + 2, W, H) }

  resetCompositorSession()
  const compositor = await createCompositor(W, H)
  if (!compositor) throw new Error('focus check: createCompositor gave null on this page: WebGL did not start')
  let readings: FocusReadings
  try {
    const sharp = painterB(list(onPlane, { camera: sharpCamera }), compositor)
    const blurred = painterB(list(onPlane, { camera: blurCamera }), compositor)
    const blurredPixels = pixelsOf(blurred)
    readings = {
      radius,
      sharp: diffChannels(referencePixels, pixelsOf(sharp)),
      blurred: diffChannels(referencePixels, blurredPixels, area),
      edgeAlphaMin: borderAlphaMin(blurredPixels, W, H)
    }
    frames.canvas('focus: every plane on the depth in focus (radius 0), drawn exact', sharp)
    frames.canvas(`focus: the plane ${radius} px out of focus (the frame's edge keeps its alpha), over black`, over(blurred, '#000000'))
  } finally {
    compositor.dispose()
  }
  const verdict = focusVerdict(readings)
  summary.push(
    `focus: radius 0 against painter A mean ${readings.sharp.meanAll.toFixed(3)} max ${readings.sharp.maxAll}; radius ${radius} px over the stripes (${JSON.stringify(area.rect)}) max ${readings.blurred.maxAll} mean ${readings.blurred.meanAll.toFixed(3)}; ` +
      `the frame's border alpha at least ${readings.edgeAlphaMin}; verdict: ${verdict.pass ? 'PASS' : `FAIL: ${verdict.failures.join('; ')}`}`
  )
  if (!verdict.pass) notes.push(...verdict.failures.map((f) => `focus: ${f}`))
  return { ...readings, size: { width: W, height: H }, verdict }
}
