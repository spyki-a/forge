import type { DrawItem, DrawList } from '@shared/graphics/items'
import { paintDrawList2d, type PaintOptions } from '@shared/graphics/paint'
import {
  MAX_PLANES,
  cameraFor,
  compositorRoute,
  flatItems,
  planeModel,
  planesOf,
  screenItemsOf,
  type Plane
} from '@shared/graphics/compositor'
import { sharedRenderer, type Three } from './threeShared'
import { VERTEX as IDENTITY_VERTEX, textureOf } from './momentCanvas'

export {
  DEFAULT_FOV,
  MAX_PLANES,
  cameraFor,
  cameraIsFlat,
  compensation,
  compositorRoute,
  flatDistance,
  flatItems,
  isFlat,
  planeModel,
  planesOf,
  screenItemsOf,
  type CompositorRoute,
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
 *   compensation (`planeModel`), then the glow pass.
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
 * The straight texel in, premultiplied colour out, as the moments' depth
 * push writes (momentCanvas.ts DEPTH_PUSH); the layers blend premultiplied
 * "over". Rows as the canvas has them (uploaded unflipped). `uBlur` is the
 * plane's focus blur in frame pixels: phase 3's piece 2 averages a disc of
 * taps above 0; at 0, and in piece 1 always, the texel itself.
 */
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uBlur;
void main() {
  vec4 s = texture2D(uTex, vec2(vUv.x, 1.0 - vUv.y));
  gl_FragColor = vec4(s.rgb * s.a, s.a);
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
  disposables: { dispose: () => void }[]
  disposed: boolean
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
export async function createCompositor(width: number, height: number): Promise<Compositor | null> {
  if (webgl === 'missing') return null
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
    disposables,
    disposed: false
  }
  const compositor: Compositor = {
    dispose: () => {
      if (state.disposed) return
      state.disposed = true
      for (const d of state.disposables) d.dispose()
    }
  }
  internals.set(compositor, state)
  return compositor
}

/** A layer: its canvas, texture, material and mesh; the texture and the material on the disposables list. */
function makeLayer(state: Internals, vertexShader: string, order: number): Layer {
  const { three } = state
  const { canvas, ctx } = canvas2d(state.width, state.height)
  const texture = textureOf(three, canvas)
  state.disposables.push(texture)
  const material = new three.ShaderMaterial({
    vertexShader,
    fragmentShader: FRAGMENT,
    uniforms: { uTex: { value: texture }, uBlur: { value: 0 } },
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
  state.scene.add(mesh)
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

/**
 * The glow pass (§6.16, "Glow"): phase 3's piece 2 fills it, with both
 * routes (the two separable passes, and three's `UnrealBloomPass`) behind
 * this one seam until M7 decides. In piece 1 a no-op: the planes are drawn
 * and nothing is added over them.
 */
function glowPass(_state: Internals, _list: DrawList): void {
  // Piece 2.
}

/** The one renderer is shared, and another drawer may have resized it between two of our frames (momentCanvas.ts `sized`). */
function sized(state: Internals): void {
  const { renderer, width, height } = state
  if (renderer.domElement.width !== width || renderer.domElement.height !== height) renderer.setSize(width, height, false)
}

function render(state: Internals): void {
  sized(state)
  state.renderer.render(state.scene, state.camera)
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
 * on a non-finite bound).
 */
export function paintDrawList3d(list: DrawList, compositor: Compositor, options: PaintOptions = {}): HTMLCanvasElement {
  const state = internals.get(compositor)
  if (!state) throw new Error('paintDrawList3d: not a compositor')
  if (state.disposed) throw new Error('paintDrawList3d: the compositor was disposed')
  if (list.width !== state.width || list.height !== state.height) {
    throw new Error(`paintDrawList3d: a ${list.width}×${list.height} list on a ${state.width}×${state.height} compositor`)
  }
  const route = compositorRoute(list)

  if (route === 'flat') {
    // Route one: painter A alone, in plane order; nothing reaches WebGL.
    state.flat ??= canvas2d(state.width, state.height)
    const { canvas, ctx } = state.flat
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    paintDrawList2d(ctx, { width: list.width, height: list.height, items: flatItems(list) }, { layer: options.layer, images: options.images })
    return canvas
  }

  for (const layer of [state.whole, state.base, ...state.planes]) if (layer) layer.mesh.visible = false

  if (route === 'glow') {
    // Route two: painter A's flat canvas at 1:1 under the identity quad; the glow over it.
    state.whole ??= makeLayer(state, IDENTITY_VERTEX, 0)
    paintLayer(state.whole, list, flatItems(list), options)
    state.whole.mesh.visible = true
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
    planes.forEach((plane, i) => {
      while (state.planes.length <= i) state.planes.push(makeLayer(state, PERSPECTIVE_VERTEX, 1 + state.planes.length))
      const layer = state.planes[i]
      // Keyed on the plane's z too: slot i holds another plane when the set of planes changes.
      paintLayer(layer, list, plane.items, options, String(plane.z))
      layer.mesh.matrix.fromArray(planeModel(plane.z, list, distance))
      layer.mesh.matrixWorldNeedsUpdate = true
      layer.mesh.visible = true
    })
  }

  glowPass(state, list)
  render(state)
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
  for (const layer of [state.whole, state.base, ...state.planes]) if (layer) layer.key = ''
}
