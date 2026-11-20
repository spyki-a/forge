import type { DrawItem, DrawList } from '@shared/graphics/items'
import { paintDrawList2d, type PaintOptions } from '@shared/graphics/paint'
import type { GlowRequest } from '@shared/graphics/items'
import {
  FOCUS_TAPS,
  GLOW_MAX_ALPHA,
  GLOW_MAX_HALF_TAPS,
  GLOW_ROUTE,
  MAX_GLOW_BATCHES,
  MAX_PLANES,
  UNREAL_GAIN,
  UNREAL_RADIUS_PX,
  cameraFor,
  compositorRoute,
  flatItems,
  focusDisc,
  focusRadius,
  glowBatches,
  glowItemsOf,
  glowKernel,
  glowMatches,
  planeModel,
  planesOf,
  screenItemsOf,
  type GlowBatch,
  type GlowRoute,
  type Plane
} from '@shared/graphics/compositor'
import { sharedRenderer, type Three } from './threeShared'
import { VERTEX as IDENTITY_VERTEX, textureOf } from './momentCanvas'
import { loadUnrealBloom, type UnrealBloom } from './graphicGlowUnreal'

export {
  DEFAULT_FOV,
  FOCUS_TAPS,
  GLOW_MAX_ALPHA,
  GLOW_MAX_HALF_TAPS,
  GLOW_ROUTE,
  GLOW_ROUTES,
  GLOW_SIGMA_OF_RADIUS,
  MAX_GLOW_BATCHES,
  MAX_PLANES,
  UNREAL_GAIN,
  UNREAL_RADIUS_PX,
  cameraFor,
  cameraIsFlat,
  compensation,
  compositorRoute,
  flatDistance,
  flatItems,
  focusDisc,
  focusRadius,
  glowBatches,
  glowItemsOf,
  glowKernel,
  isFlat,
  planeModel,
  planesOf,
  screenItemsOf,
  type CompositorRoute,
  type GlowBatch,
  type GlowRoute,
  type Plane
} from '@shared/graphics/compositor'

/**
 * Painter B (docs/CLIPS.md §6.16, "The compositor"): three.js composing what
 * painter A painted, for a list that asks for a camera, a depth, a focus
 * blur or a glow (`needsCompositor`, drawList.ts). Every word is still
 * painted by canvas 2D (`paintDrawList2d`, so `drawTextOnto` shapes it);
 * three.js only places the painted layers. The moments' pattern exactly:
 * compose on a 2D canvas, upload with `textureOf`, shade (momentCanvas.ts),
 * on the one shared renderer (threeShared.ts), every texture, material and
 * geometry on a disposables list.
 *
 * Three routes, chosen per frame from the list alone (`compositorRoute`):
 *
 * - **flat** (the camera flat, no glow): painter A paints every item, in
 *   plane order (`flatItems`), onto the compositor's own 2D canvas; no WebGL
 *   call at all, so a settled 2.5D frame IS the flat graphic.
 * - **glow** (the camera flat, a glow): that same canvas uploaded and drawn
 *   at 1:1 under the identity quad, then the glow pass.
 * - **perspective** (a camera off flat, or a focus blur): the dims on a base
 *   layer by the identity quad, then one quad per plane (`planesOf`) under
 *   the perspective camera (`cameraFor`), each scaled by the parallax
 *   compensation (`planeModel`), each plane blurred by its focus radius
 *   (`focusRadius`), then the glow pass.
 *
 * The glow (§6.16, "Glow"; phase 3's piece 2), on routes two and three: the
 * requested items alone (`glowItemsOf`) painted per plane onto glow layers,
 * rendered through the same camera into a render target, spread by the
 * compositor's glow route, and added over the frame. Two routes behind one
 * seam (`spreadGlow`) until M7 decides (§6.15): `'quad'`, two separable
 * Gaussian passes (`glowKernel`), and `'unreal'`, three r186's
 * `UnrealBloomPass` (`graphicGlowUnreal.ts`). `GLOW_ROUTE` is the default;
 * `createCompositor`'s `glow` option picks one (the harness's M7 does).
 *
 * The pure half (routes, planes, camera) is `src/shared/graphics/compositor.ts`,
 * re-exported here, so node's tests read it without three.js.
 */

/** Recorded once in an export's notes and shown in the dock's graphic panel when WebGL did not start (§6.16, "WebGL missing"). */
export const WEBGL_MISSING_NOTE = 'drawn flat: 3D needs WebGL, which did not start on this computer'

/** A compositor, made once per preview entry or bake; its internals are this file's. */
export interface Compositor {
  dispose(): void
}

/* ------------------------------------------------------------------ GLSL */

/** Three's standard projection: the plane's model, the camera's view and projection (§6.16, "Shaders"). */
const PERSPECTIVE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

/**
 * The layers are uploaded PREMULTIPLIED (each layer's texture set so after
 * `textureOf`, in `makeLayer`), so the texel is already premultiplied
 * colour and the shader writes it as it is; the layers blend premultiplied
 * "over". This departs from §6.16's "samples the straight texel and writes
 * premultiplied colour" (the moments' DEPTH_PUSH) on purpose: the moments'
 * pictures are opaque or clear (momentCanvas.ts COMMON: "a sample is
 * straight colour with alpha 0 or 1"), but a graphic's layer has
 * anti-aliased text, 1 px lines and half-opaque shapes, and a bilinear
 * sample between an ink texel (c, 1) and a clear one (0, 0) at weight t is
 * (t·c, t) straight, which premultiplied AFTER the filter is (t²·c, t): a
 * dark fringe on every edge of a tilted or dollied plane. Filtering
 * premultiplied texels is coverage-weighted, so the fringe is gone, and at
 * 1:1 the upload is the 2D canvas's own premultiplied bytes (no
 * un-premultiply round trip). Rows as the canvas has them (uploaded
 * unflipped).
 *
 * The focus blur (§6.16, "Shaders"): `uBlur` is the plane's radius in frame
 * pixels (`focusRadius`). At 0 the texel itself, and nothing else is read, so
 * a settled plane is exact; above 0 the average of `FOCUS_TAPS` taps on
 * `focusDisc` scaled by it (an average of premultiplied taps is right as it
 * is). The edges are clamped (`textureOf`), so a plane that fills the frame
 * keeps its alpha at the frame's edge.
 */
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uBlur;
uniform vec2 uTexel;
uniform vec2 uDisc[FOCUS_TAPS];
void main() {
  vec2 at = vec2(vUv.x, 1.0 - vUv.y);
  if (uBlur <= 0.0) {
    gl_FragColor = texture2D(uTex, at);
    return;
  }
  vec4 sum = vec4(0.0);
  for (int i = 0; i < FOCUS_TAPS; i++) sum += texture2D(uTex, at + uDisc[i] * uBlur * uTexel);
  gl_FragColor = sum / float(FOCUS_TAPS);
}`

/** The disc's offsets, flat, as the shader's `uDisc` reads them. */
const DISC = focusDisc().flatMap(([x, y]) => [x, y])

/**
 * One separable pass of the quad route's blur, over a render target (rows
 * bottom up, so `vUv` as it is): the centre's weight, then each other tap on
 * both sides, `uStep` the pass's direction times one texel, every offset a
 * whole texel (`glowKernel`), so a sample never reads past the radius.
 */
const BLUR_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uStep;
uniform float uOffsets[GLOW_TAPS];
uniform float uWeights[GLOW_TAPS];
uniform int uCount;
void main() {
  vec4 sum = texture2D(uTex, vUv) * uWeights[0];
  for (int i = 1; i < GLOW_TAPS; i++) {
    if (i > uCount) break;
    vec2 o = uStep * uOffsets[i];
    sum += (texture2D(uTex, vUv + o) + texture2D(uTex, vUv - o)) * uWeights[i];
  }
  gl_FragColor = sum;
}`

/**
 * The glow added over the frame: premultiplied, scaled by the strength, its
 * alpha held at `uMaxAlpha` (the quad route's `GLOW_MAX_ALPHA`; 1 on the
 * unreal route, whose own alpha M7 reads). Blended ONE + ONE on colour and
 * alpha alike (a glow adds light and coverage; three's own
 * `AdditiveBlending` with premultiplied alpha), clamped at 1 by the frame:
 * colour stays at or below alpha, so the frame is still premultiplied where
 * a glow lands on a half-opaque item or an anti-aliased edge (alpha "over"
 * left colour above alpha there by up to base × glow alpha, which the
 * preview kept and the export's un-premultiply clamped: preview ≠ export).
 * Where the base is clear the result is the glow's own texel; beyond the
 * glow's reach the texel is 0 and nothing changes.
 */
const ADD_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uStrength;
uniform float uMaxAlpha;
void main() {
  vec4 glow = texture2D(uTex, vUv) * uStrength;
  if (glow.a > uMaxAlpha) glow *= uMaxAlpha / glow.a;
  gl_FragColor = glow;
}`

/* ------------------------------------------------------------- internals */

/** A frame-sized 2D canvas painted by painter A, uploaded, and drawn by one quad. */
interface Layer {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  texture: import('three').CanvasTexture
  material: import('three').ShaderMaterial
  mesh: import('three').Mesh
  /** What the canvas holds: repainted and re-uploaded only when this changes (`Composed.at`'s rule, momentCanvas.ts). */
  key: string
}

interface Internals {
  three: Three
  renderer: import('three').WebGLRenderer
  width: number
  height: number
  scene: import('three').Scene
  camera: import('three').PerspectiveCamera
  quad: import('three').PlaneGeometry
  /** Route one's canvas: painter A's alone, never uploaded. */
  flat: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null
  /** Route two's one plane at 1:1. */
  whole: Layer | null
  /** Route three's screen-space dims, under every plane. */
  base: Layer | null
  /** Route three's planes, far to near, made as a list first needs them. */
  planes: Layer[]
  /** The glow's route, fixed when the compositor is made. */
  glowRoute: GlowRoute
  /** `UnrealBloomPass`, loaded when the route is `'unreal'`. */
  bloomClass: UnrealBloom | null
  /** The glow's scene, targets and passes, made when a list first asks for a glow. */
  glow: Glow | null
  /** A scratch canvas for a request with its own colour. */
  tint: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null
  disposables: { dispose: () => void }[]
  disposed: boolean
}

type Target = import('three').WebGLRenderTarget

/** One glow batch's slot (`glowBatches`): its glow layers per plane, and its targets or its bloom. */
interface GlowSlot {
  /** Index 0: route two's whole frame at 1:1; index 1 + i: route three's plane i. */
  layers: Layer[]
  /** The glow layers rendered through the camera. */
  input: Target
  /** The quad route's horizontal pass, then its vertical one: the glow. */
  across: Target | null
  out: Target | null
  /** The unreal route's pass. */
  bloom: InstanceType<UnrealBloom> | null
}

interface Glow {
  /** The glow layers of every slot; only the slot being drawn is visible. */
  scene: import('three').Scene
  /** One identity quad, its material swapped between the blur and the add. */
  passScene: import('three').Scene
  pass: import('three').Mesh
  blur: import('three').ShaderMaterial | null
  add: import('three').ShaderMaterial
  slots: GlowSlot[]
}

/** The harness's way past the glow and the focus blur (`paintDrawList3d`'s `probe`): the base under the glow, and route three at rest without its blur. */
export interface CompositorProbe {
  /** False: no glow is drawn, the frame is the planes alone. */
  glow?: boolean
  /** False: every plane's focus radius is 0. */
  focus?: boolean
  /**
   * M12's `readRenderTargetPixelsAsync` (phase 3's piece 6, the harness's
   * `readback` option): the frame rendered into this render target instead
   * of the canvas, so it can be read back from a target. Routes two and three
   * only; route one paints no WebGL frame at all.
   */
  target?: import('three').WebGLRenderTarget
}

const internals = new WeakMap<Compositor, Internals>()

/* ------------------------------------------------------------ the session */

/**
 * Whether WebGL started, once per session: `'missing'` once a renderer threw
 * or came back lost, so no later graphic tries again (§6.16, "WebGL missing").
 */
let webgl: 'unknown' | 'ok' | 'missing' = 'unknown'

/** Whether this session found WebGL missing. */
export function webglMissing(): boolean {
  return webgl === 'missing'
}

/**
 * Tests and the harness only: forget the session's answer, or, with
 * `missing`, pretend WebGL did not start (the harness's "WebGL missing"
 * reading, §6.11). Nothing that draws calls it.
 */
export function resetCompositorSession(options: { missing?: boolean } = {}): void {
  webgl = options.missing ? 'missing' : 'unknown'
}

/* ------------------------------------------------------------- building */

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a canvas for a graphic plane')
  return { canvas, ctx }
}

/**
 * A compositor for frames of `width` × `height` (§6.16): awaits the one
 * shared renderer and builds the scene, the camera and the quad once; the
 * layers are made as a list first needs them. Null when WebGL is missing:
 * the renderer threw, or its context came back lost, remembered for the
 * session. Never throws for that: the caller paints with painter A instead.
 */
export async function createCompositor(width: number, height: number, options: { glow?: GlowRoute } = {}): Promise<Compositor | null> {
  if (webgl === 'missing') return null
  const glowRoute = options.glow ?? GLOW_ROUTE
  // Loaded before the renderer, so a compositor on the unreal route draws its first glow synchronously.
  const bloomClass = glowRoute === 'unreal' ? await loadUnrealBloom() : null
  let shared: Awaited<ReturnType<typeof sharedRenderer>>
  try {
    shared = await sharedRenderer(width, height)
    if (shared.renderer.getContext().isContextLost()) throw new Error('the WebGL context is lost')
  } catch (error) {
    webgl = 'missing'
    console.warn('Graphics are drawn flat: WebGL did not start', error instanceof Error ? error.message : String(error))
    return null
  }
  webgl = 'ok'
  const { three, renderer } = shared
  const disposables: { dispose: () => void }[] = []
  const quad = new three.PlaneGeometry(2, 2)
  disposables.push(quad)
  const camera = new three.PerspectiveCamera()
  // The matrices are cameraFor's, set per frame; three must not recompute them from position and rotation.
  camera.matrixAutoUpdate = false
  camera.matrixWorldAutoUpdate = false
  const state: Internals = {
    three,
    renderer,
    width,
    height,
    scene: new three.Scene(),
    camera,
    quad,
    flat: null,
    whole: null,
    base: null,
    planes: [],
    glowRoute,
    bloomClass,
    glow: null,
    tint: null,
    disposables,
    disposed: false
  }
  const compositor: Compositor = {
    dispose: () => {
      if (state.disposed) return
      state.disposed = true
      for (const d of state.disposables) d.dispose()
      // The layers' frame-sized 2D canvases are given back now, not at the next collection.
      for (const layer of allLayers(state)) layer.canvas.width = layer.canvas.height = 0
      for (const scratch of [state.flat, state.tint]) if (scratch) scratch.canvas.width = scratch.canvas.height = 0
    }
  }
  internals.set(compositor, state)
  return compositor
}

/** Every layer the compositor made: the 1:1 one, the dims' base, the planes, and every glow slot's. */
function allLayers(state: Internals): Layer[] {
  const layers = [state.whole, state.base, ...state.planes].filter((l): l is Layer => l !== null)
  for (const slot of state.glow?.slots ?? []) layers.push(...slot.layers.filter(Boolean))
  return layers
}

/** A layer: its canvas, texture, material and mesh, in `scene` (the frame's, or the glow's); the texture and the material on the disposables list. */
function makeLayer(state: Internals, vertexShader: string, order: number, scene = state.scene): Layer {
  const { three } = state
  const { canvas, ctx } = canvas2d(state.width, state.height)
  const texture = textureOf(three, canvas)
  // The moments' settings, but premultiplied: FRAGMENT writes the texel as it is (see there).
  texture.premultiplyAlpha = true
  state.disposables.push(texture)
  const material = new three.ShaderMaterial({
    vertexShader,
    fragmentShader: FRAGMENT,
    defines: { FOCUS_TAPS },
    uniforms: { uTex: { value: texture }, uBlur: { value: 0 }, uTexel: { value: [1 / state.width, 1 / state.height] }, uDisc: { value: DISC } },
    depthTest: false,
    depthWrite: false,
    transparent: true
  })
  // The shader writes premultiplied colour; a layer over a layer is "over" in those terms (momentCanvas.ts).
  material.blending = three.CustomBlending
  material.blendEquation = three.AddEquation
  material.blendSrc = three.OneFactor
  material.blendDst = three.OneMinusSrcAlphaFactor
  material.blendSrcAlpha = three.OneFactor
  material.blendDstAlpha = three.OneMinusSrcAlphaFactor
  state.disposables.push(material)
  const mesh = new three.Mesh(state.quad, material)
  // The identity quad is not where its geometry says, and nothing is culled: every layer covers the frame.
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  mesh.renderOrder = order
  mesh.visible = false
  scene.add(mesh)
  return { canvas, ctx, texture, material, mesh, key: '' }
}

/* -------------------------------------------------------------- painting */

/**
 * What a layer's canvas would hold: its items, and for each `image` item
 * whether its bitmap is in hand (an item painted before its bitmap landed
 * is skipped by painter A, so the layer must repaint when it lands).
 */
function keyOf(items: readonly DrawItem[], options: PaintOptions, extra = ''): string {
  const images: string[] = []
  const visit = (list: readonly DrawItem[]): void => {
    for (const item of list) {
      if (item.kind === 'image') images.push(options.images?.has(item.src) ? '+' : '-')
      if (item.kind === 'group') visit(item.children)
    }
  }
  visit(items)
  return `${extra}|${images.join('')}|${JSON.stringify(items)}`
}

/** Paint `items` onto a layer's canvas and re-upload it, only when they changed. */
function paintLayer(layer: Layer, list: DrawList, items: DrawItem[], options: PaintOptions, extra = ''): void {
  const key = keyOf(items, options, extra)
  if (key === layer.key) return
  layer.key = key
  layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
  paintDrawList2d(layer.ctx, { width: list.width, height: list.height, items }, { layer: options.layer, images: options.images })
  layer.texture.needsUpdate = true
}

/* ------------------------------------------------------------- the glow */

/** A render target the frame's size: no depth, no mipmaps, linear filters (three's defaults). On the disposables list. */
function makeTarget(state: Internals): Target {
  const target = new state.three.WebGLRenderTarget(state.width, state.height, { depthBuffer: false })
  state.disposables.push(target)
  return target
}

/** The glow's scene and passes, made when a list first asks for a glow: the add material always, the blur on the quad route. */
function glowOf(state: Internals): Glow {
  if (state.glow) return state.glow
  const { three } = state
  const material = (fragmentShader: string, uniforms: Record<string, { value: unknown }>, defines: Record<string, number> = {}): import('three').ShaderMaterial => {
    const m = new three.ShaderMaterial({ vertexShader: IDENTITY_VERTEX, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false, transparent: true })
    state.disposables.push(m)
    return m
  }
  const blur =
    state.glowRoute === 'quad'
      ? material(
          BLUR_FRAGMENT,
          { uTex: { value: null }, uStep: { value: [0, 0] }, uOffsets: { value: new Array<number>(GLOW_MAX_HALF_TAPS + 1).fill(0) }, uWeights: { value: new Array<number>(GLOW_MAX_HALF_TAPS + 1).fill(0) }, uCount: { value: 0 } },
          { GLOW_TAPS: GLOW_MAX_HALF_TAPS + 1 }
        )
      : null
  if (blur) blur.blending = three.NoBlending
  const add = material(ADD_FRAGMENT, { uTex: { value: null }, uStrength: { value: 1 }, uMaxAlpha: { value: 1 } })
  add.blending = three.CustomBlending
  add.blendEquation = three.AddEquation
  add.blendSrc = three.OneFactor
  add.blendDst = three.OneFactor
  add.blendSrcAlpha = three.OneFactor
  add.blendDstAlpha = three.OneFactor
  const passScene = new three.Scene()
  const pass = new three.Mesh(state.quad, add)
  pass.frustumCulled = false
  pass.matrixAutoUpdate = false
  passScene.add(pass)
  state.glow = { scene: new three.Scene(), passScene, pass, blur, add, slots: [] }
  return state.glow
}

/** Batch `b`'s slot, made on first use: its input target, and the quad route's two targets or the unreal route's pass. */
function slotOf(state: Internals, glow: Glow, b: number): GlowSlot {
  while (glow.slots.length <= b) {
    const input = makeTarget(state)
    let bloom: InstanceType<UnrealBloom> | null = null
    if (state.glowRoute === 'unreal') {
      if (!state.bloomClass) throw new Error('paintDrawList3d: the unreal glow route was not loaded')
      bloom = new state.bloomClass(new state.three.Vector2(state.width, state.height), 1, 0, 0)
      // Its dispose() leaves the high-pass material out (UnrealBloomPass.js, r186): ours does both.
      state.disposables.push(bloom, bloom.materialHighPassFilter)
    }
    const quad = state.glowRoute === 'quad'
    glow.slots.push({ layers: [], input, across: quad ? makeTarget(state) : null, out: quad ? makeTarget(state) : null, bloom })
  }
  return glow.slots[b]
}

/**
 * A glow layer's canvas: the requested items alone (`glowItemsOf`), each
 * request's items in its own `color` when it names one (painted, then
 * filled `source-in`), re-uploaded only when they change.
 */
function paintGlowLayer(state: Internals, layer: Layer, list: DrawList, items: DrawItem[], requests: GlowRequest[], options: PaintOptions, extra: string): void {
  const glowing = glowItemsOf(items, requests)
  const key = keyOf(glowing, options, `${extra}|${JSON.stringify(requests.map((r) => [r.item, r.color ?? '']))}`)
  if (key === layer.key) return
  layer.key = key
  layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
  const paint = (ctx: CanvasRenderingContext2D, its: DrawItem[]): void =>
    paintDrawList2d(ctx, { width: list.width, height: list.height, items: its }, { layer: options.layer, images: options.images })
  for (const request of requests) {
    // An item two requests name is the first one's.
    const its = glowing.filter((item) => requests.find((r) => glowMatches(item.id, r)) === request)
    if (its.length === 0) continue
    if (!request.color) {
      paint(layer.ctx, its)
      continue
    }
    state.tint ??= canvas2d(state.width, state.height)
    const { canvas, ctx } = state.tint
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    paint(ctx, its)
    ctx.save()
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = request.color
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    layer.ctx.drawImage(canvas, 0, 0)
  }
  layer.texture.needsUpdate = true
}

/** Where the glow layers sit: route two's whole frame at 1:1, or route three's planes with their models and focus radii. */
interface GlowPlane {
  items: DrawItem[]
  /** Null: the identity quad (route two). */
  model: number[] | null
  z: number
  blur: number
}

/**
 * One batch's glow, spread by the compositor's route (the seam M7 decides):
 * the batch's glow layers rendered through the camera into the slot's input,
 * then the quad route's two separable passes (horizontal, then vertical) or
 * the unreal route's bloom. Returns the texture holding the glow alone,
 * premultiplied.
 */
function spreadGlow(state: Internals, glow: Glow, b: number, batch: GlowBatch, planes: GlowPlane[], list: DrawList, options: PaintOptions): import('three').Texture {
  const { renderer } = state
  const slot = slotOf(state, glow, b)
  for (const s of glow.slots) for (const layer of s.layers) if (layer) layer.mesh.visible = false
  planes.forEach((plane, i) => {
    if (glowItemsOf(plane.items, batch.requests).length === 0) return
    // Slot 0 is route two's identity layer, slots 1.. route three's planes: a compositor that moves between the routes never draws a plane with the other's vertex shader.
    const at = plane.model ? 1 + i : 0
    slot.layers[at] ??= makeLayer(state, plane.model ? PERSPECTIVE_VERTEX : IDENTITY_VERTEX, at, glow.scene)
    const layer = slot.layers[at]
    paintGlowLayer(state, layer, list, plane.items, batch.requests, options, `${plane.model ? 'plane' : 'whole'}|${plane.z}`)
    if (plane.model) {
      layer.mesh.matrix.fromArray(plane.model)
      layer.mesh.matrixWorldNeedsUpdate = true
    }
    layer.material.uniforms.uBlur.value = plane.blur
    layer.mesh.visible = true
  })
  renderer.setRenderTarget(slot.input)
  renderer.clear()
  renderer.render(glow.scene, state.camera)

  if (state.glowRoute === 'unreal') {
    const bloom = slot.bloom!
    // The composite's own gain taken out (UNREAL_GAIN): strength 1 is the mips' weighted mean.
    bloom.strength = batch.strength / UNREAL_GAIN
    bloom.radius = Math.min(1, batch.radius / UNREAL_RADIUS_PX)
    bloom.threshold = 0
    bloom.render(renderer, null as unknown as Target, slot.input, 0, false)
    // The bloom alone, before the pass adds it over its input (graphicGlowUnreal.ts).
    return bloom.renderTargetsHorizontal[0].texture
  }

  const blur = glow.blur!
  const { offsets, weights } = glowKernel(batch.radius)
  const pad = (a: number[]): number[] => [...a, ...new Array<number>(GLOW_MAX_HALF_TAPS + 1 - a.length).fill(0)]
  blur.uniforms.uOffsets.value = pad(offsets)
  blur.uniforms.uWeights.value = pad(weights)
  blur.uniforms.uCount.value = offsets.length - 1
  glow.pass.material = blur
  for (const [from, to, step] of [
    [slot.input, slot.across!, [1 / state.width, 0]],
    [slot.across!, slot.out!, [0, 1 / state.height]]
  ] as const) {
    blur.uniforms.uTex.value = from.texture
    blur.uniforms.uStep.value = step
    renderer.setRenderTarget(to)
    renderer.clear()
    renderer.render(glow.passScene, state.camera)
  }
  return slot.out!.texture
}

/** A batch's glow added over the frame on the canvas (`ADD_FRAGMENT`): the strength and the alpha cap the quad route's, the bloom's own on the unreal route. */
function addGlow(state: Internals, glow: Glow, texture: import('three').Texture, batch: GlowBatch, into: Target | null): void {
  const quad = state.glowRoute === 'quad'
  glow.add.uniforms.uTex.value = texture
  glow.add.uniforms.uStrength.value = quad ? batch.strength : 1
  glow.add.uniforms.uMaxAlpha.value = quad ? GLOW_MAX_ALPHA : 1
  glow.pass.material = glow.add
  state.renderer.setRenderTarget(into)
  state.renderer.render(glow.passScene, state.camera)
}

/** The one renderer is shared, and another drawer may have resized it between two of our frames (momentCanvas.ts `sized`). */
function sized(state: Internals): void {
  const { renderer, width, height } = state
  if (renderer.domElement.width !== width || renderer.domElement.height !== height) renderer.setSize(width, height, false)
}

/**
 * The frame (§6.16): every glow batch spread into its own target first, then
 * the layers on the canvas, then each batch's glow added over them. The one
 * renderer is shared, so its render target, auto-clear and clear colour are
 * put back as they were (the moments draw with theirs); its size is not,
 * since resizing the canvas would blank the frame before the caller copies
 * it, and every drawer sizes it before its own render (`sized`).
 */
function render(state: Internals, list: DrawList, batches: GlowBatch[], planes: GlowPlane[], options: PaintOptions, into: Target | null = null): void {
  const { renderer, three } = state
  sized(state)
  const saved = { target: renderer.getRenderTarget(), autoClear: renderer.autoClear, color: renderer.getClearColor(new three.Color()), alpha: renderer.getClearAlpha() }
  try {
    renderer.autoClear = false
    renderer.setClearColor(0x000000, 0)
    const glow = batches.length > 0 ? glowOf(state) : null
    const textures = glow ? batches.map((batch, b) => spreadGlow(state, glow, b, batch, planes, list, options)) : []
    // The canvas, or the harness's target (M12's `CompositorProbe.target`).
    renderer.setRenderTarget(into)
    renderer.clear()
    renderer.render(state.scene, state.camera)
    textures.forEach((texture, b) => addGlow(state, glow!, texture, batches[b], into))
  } finally {
    renderer.setRenderTarget(saved.target)
    renderer.autoClear = saved.autoClear
    renderer.setClearColor(saved.color, saved.alpha)
  }
}

/**
 * Draw `list` (§6.16): synchronous once the compositor is made, as a
 * moment's preview draws synchronously after an async build. Returns the
 * canvas the frame is on, which the caller copies into its own 2D canvas
 * with `drawImage` at once (the WebGL canvas is the app's one, and the next
 * drawer's frame will be on it). `options` is handed to painter A for each
 * layer: the decoded `images`, the dim's `layer` factory; an `offset` is not
 * read, the compositor drawing the whole frame. A list of another size than
 * the compositor's is refused, as is one with more than `MAX_PLANES` planes
 * (a drawer never emits more: a drawer's bug, thrown as `graphicBox` throws
 * on a non-finite bound), and one with more than `MAX_GLOW_BATCHES` glow
 * batches. `probe` is the harness's alone (`CompositorProbe`): nothing that
 * draws for the app passes it.
 */
export function paintDrawList3d(list: DrawList, compositor: Compositor, options: PaintOptions = {}, probe: CompositorProbe = {}): HTMLCanvasElement {
  const state = internals.get(compositor)
  if (!state) throw new Error('paintDrawList3d: not a compositor')
  if (state.disposed) throw new Error('paintDrawList3d: the compositor was disposed')
  if (list.width !== state.width || list.height !== state.height) {
    throw new Error(`paintDrawList3d: a ${list.width}×${list.height} list on a ${state.width}×${state.height} compositor`)
  }
  const route = compositorRoute(list)
  const batches = probe.glow === false ? [] : glowBatches(list)
  if (batches.length > MAX_GLOW_BATCHES) throw new Error(`paintDrawList3d: ${batches.length} glow batches, at most ${MAX_GLOW_BATCHES}`)
  const radius = (z: number): number => (probe.focus === false ? 0 : focusRadius(list.camera, z))

  if (route === 'flat') {
    // Route one: painter A alone, in plane order; nothing reaches WebGL.
    state.flat ??= canvas2d(state.width, state.height)
    const { canvas, ctx } = state.flat
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    paintDrawList2d(ctx, { width: list.width, height: list.height, items: flatItems(list) }, { layer: options.layer, images: options.images })
    return canvas
  }

  for (const layer of [state.whole, state.base, ...state.planes]) if (layer) layer.mesh.visible = false
  let glowPlanes: GlowPlane[]

  if (route === 'glow') {
    // Route two: painter A's flat canvas at 1:1 under the identity quad; the glow over it.
    state.whole ??= makeLayer(state, IDENTITY_VERTEX, 0)
    const items = flatItems(list)
    paintLayer(state.whole, list, items, options)
    state.whole.mesh.visible = true
    glowPlanes = [{ items, model: null, z: 0, blur: 0 }]
  } else {
    const planes: Plane[] = planesOf(list)
    if (planes.length > MAX_PLANES) throw new Error(`paintDrawList3d: ${planes.length} planes, at most ${MAX_PLANES}`)
    const dims = screenItemsOf(list)
    if (dims.length > 0) {
      state.base ??= makeLayer(state, IDENTITY_VERTEX, 0)
      paintLayer(state.base, list, dims, options)
      state.base.mesh.visible = true
    }
    const { projection, view, distance } = cameraFor(list.camera, list)
    const { camera } = state
    camera.projectionMatrix.fromArray(projection)
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
    camera.matrixWorldInverse.fromArray(view)
    camera.matrixWorld.copy(camera.matrixWorldInverse).invert()
    camera.matrix.copy(camera.matrixWorld)
    // Three r186 renders with projectionMatrix and matrixWorldInverse as set here: it skips updateMatrixWorld (matrixWorldAutoUpdate
    // false, no parent), and calls updateProjectionMatrix only with a reversed depth buffer, which threeShared.ts does not ask for;
    // turning that on would reset this projection to the camera's default fov and aspect.
    glowPlanes = []
    planes.forEach((plane, i) => {
      while (state.planes.length <= i) state.planes.push(makeLayer(state, PERSPECTIVE_VERTEX, 1 + state.planes.length))
      const layer = state.planes[i]
      // Keyed on the plane's z too: slot i holds another plane when the set of planes changes.
      paintLayer(layer, list, plane.items, options, String(plane.z))
      const model = planeModel(plane.z, list, distance)
      layer.mesh.matrix.fromArray(model)
      layer.mesh.matrixWorldNeedsUpdate = true
      layer.material.uniforms.uBlur.value = radius(plane.z)
      layer.mesh.visible = true
      glowPlanes.push({ items: plane.items, model, z: plane.z, blur: radius(plane.z) })
    })
  }

  render(state, list, batches, glowPlanes, options, probe.target ?? null)
  return state.renderer.domElement
}

/**
 * Every layer repainted on its next frame: the caller's preview drew while a
 * face was still loading, and a layer keyed on the same items would keep the
 * fallback face's glyphs.
 */
export function forgetPlanes(compositor: Compositor): void {
  const state = internals.get(compositor)
  if (!state) return
  for (const layer of allLayers(state)) layer.key = ''
}
