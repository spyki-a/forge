import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Camera, DrawItem, DrawList, Drawer, GraphicTargets, ShapeItem } from '@shared/graphics/items'
import { cameraFor, cameraIsFlat, compensation, flatDistance } from '@shared/graphics/compositor'
import { drawListAt, needsCompositor } from '@shared/graphics/drawList'
import { paintDrawList2d } from '@shared/graphics/paint'
import { resolveGraphicStyle } from '@shared/graphics/style'
import type { GraphicSpec } from '@shared/graphics/template'
import { resetBakeGuard } from '@shared/bakeGuard'

/*
 * The compositor's renderer half (docs/CLIPS.md §6.16, "The compositor";
 * phase 3's piece 1): `graphicCompositor.ts` and its seam in
 * `graphicCanvas.ts`, driven in node on a counting stand-in for three.js
 * (threeShared mocked) and a document of recording 2D canvases. The pure half
 * is tests/graphicCompositor.test.ts; WebGL's pixels are the harness's
 * `compositor` option (§6.11).
 */

/* ------------------------------------------------------- the stand-in three */

interface Counted {
  kind: 'geometry' | 'texture' | 'material' | 'target' | 'pass'
  disposed: number
}

const made: Counted[] = []
/**
 * Each render: the scene, the camera, the shared canvas's size at that moment
 * (what three would draw into), the render target (null: the canvas), and,
 * for a one-mesh pass scene, its material and a copy of its uniforms' values
 * then. A bloom's render is recorded with `bloom` set.
 */
interface Render {
  scene: FakeScene
  camera: FakeCamera
  size: string
  target: unknown
  material?: FakeMaterial
  uniforms?: Record<string, unknown>
  bloom?: FakeBloom
}
const renders: Render[] = []
/** What `sharedRenderer` does next: hand the renderer back, throw, or hand back one whose context is lost. */
const webgl = { mode: 'ok' as 'ok' | 'throw' | 'lost', calls: 0 }

class FakeMatrix {
  elements: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  fromArray(a: number[]): this {
    this.elements = [...a]
    return this
  }
  copy(m: FakeMatrix): this {
    this.elements = [...m.elements]
    return this
  }
  invert(): this {
    return this
  }
}

class Disposable implements Counted {
  disposed = 0
  constructor(readonly kind: Counted['kind']) {
    made.push(this)
  }
  dispose(): void {
    this.disposed++
  }
}

class FakeTexture extends Disposable {
  needsUpdate = false
  uploads = 0
  colorSpace = ''
  premultiplyAlpha = false
  constructor(readonly image: FakeCanvas) {
    super('texture')
  }
}

class FakeMaterial extends Disposable {
  vertexShader = ''
  fragmentShader = ''
  uniforms: Record<string, { value: unknown }> = {}
  constructor(params: Record<string, unknown>) {
    super('material')
    Object.assign(this, params)
  }
}

class FakeMesh {
  material: FakeMaterial
  matrix = new FakeMatrix()
  matrixAutoUpdate = true
  matrixWorldNeedsUpdate = false
  visible = true
  renderOrder = 0
  frustumCulled = true
  constructor(
    readonly geometry: Disposable,
    material: FakeMaterial
  ) {
    this.material = material
  }
}

class FakeTargetTexture {
  readonly isRenderTargetTexture = true
}

class FakeTarget extends Disposable {
  texture = new FakeTargetTexture()
  constructor(
    readonly width: number,
    readonly height: number,
    readonly options: Record<string, unknown>
  ) {
    super('target')
  }
}

class FakeColor {
  constructor(public hex = 0) {}
}

/** UnrealBloomPass's stand-in: the fields the compositor reads and writes, its render recorded, its dispose counted. */
class FakeBloom extends Disposable {
  strength = 1
  radius = 0
  threshold = 1
  materialHighPassFilter = new FakeMaterial({})
  renderTargetsHorizontal = [{ texture: new FakeTargetTexture() }]
  constructor(
    readonly resolution: { x: number; y: number },
    strength: number
  ) {
    super('pass')
    this.strength = strength
  }
  render(_renderer: unknown, _write: unknown, read: unknown): void {
    renders.push({ scene: new FakeScene(), camera: new FakeCamera(), size: `${glCanvas.width}x${glCanvas.height}`, target: read, bloom: this })
  }
}
const bloomLoads = { calls: 0 }

class FakeScene {
  children: FakeMesh[] = []
  add(mesh: FakeMesh): void {
    this.children.push(mesh)
  }
}

class FakeCamera {
  projectionMatrix = new FakeMatrix()
  projectionMatrixInverse = new FakeMatrix()
  matrixWorld = new FakeMatrix()
  matrixWorldInverse = new FakeMatrix()
  matrix = new FakeMatrix()
  matrixAutoUpdate = true
  matrixWorldAutoUpdate = true
}

const fakeThree = {
  PlaneGeometry: class extends Disposable {
    constructor() {
      super('geometry')
    }
  },
  CanvasTexture: FakeTexture,
  ShaderMaterial: FakeMaterial,
  Mesh: FakeMesh,
  Scene: FakeScene,
  PerspectiveCamera: FakeCamera,
  WebGLRenderTarget: FakeTarget,
  Vector2: class {
    constructor(
      readonly x: number,
      readonly y: number
    ) {}
  },
  Color: FakeColor,
  NoBlending: 0,
  NoColorSpace: 'none',
  LinearFilter: 1,
  ClampToEdgeWrapping: 2,
  CustomBlending: 3,
  AddEquation: 4,
  OneFactor: 5,
  OneMinusSrcAlphaFactor: 6
}

const glCanvas = { width: 0, height: 0, gl: true }
/** The renderer's state the compositor must put back: what a moment's draw left it with. */
const rendererState = { target: null as unknown, autoClear: true, clearColor: new FakeColor(0), clearAlpha: 0, clears: [] as unknown[], clearAlphas: [] as number[] }
const fakeRenderer = {
  domElement: glCanvas,
  get autoClear(): boolean {
    return rendererState.autoClear
  },
  set autoClear(v: boolean) {
    rendererState.autoClear = v
  },
  setSize: (w: number, h: number) => {
    glCanvas.width = w
    glCanvas.height = h
  },
  getRenderTarget: () => rendererState.target,
  setRenderTarget: (target: unknown) => {
    rendererState.target = target
  },
  clear: () => {
    rendererState.clears.push(rendererState.target)
    rendererState.clearAlphas.push(rendererState.clearAlpha)
  },
  getClearColor: (target: FakeColor) => {
    target.hex = rendererState.clearColor.hex
    return target
  },
  getClearAlpha: () => rendererState.clearAlpha,
  setClearColor: (color: number | FakeColor, alpha: number) => {
    rendererState.clearColor = typeof color === 'number' ? new FakeColor(color) : color
    rendererState.clearAlpha = alpha
  },
  render: (scene: FakeScene, camera: FakeCamera) => {
    // What three would upload on this render: every texture flagged since the last.
    for (const mesh of scene.children) {
      const texture = mesh.material.uniforms.uTex?.value as FakeTexture | undefined
      if (mesh.visible && texture instanceof FakeTexture && texture.needsUpdate) {
        texture.uploads++
        texture.needsUpdate = false
      }
    }
    const pass = scene.children.length === 1 && !(scene.children[0].material.uniforms.uTex?.value instanceof FakeTexture) ? scene.children[0].material : undefined
    const uniforms = pass ? Object.fromEntries(Object.entries(pass.uniforms).map(([k, u]) => [k, Array.isArray(u.value) ? [...u.value] : u.value])) : undefined
    renders.push({ scene, camera, size: `${glCanvas.width}x${glCanvas.height}`, target: rendererState.target, material: pass, uniforms })
  },
  getContext: () => ({ isContextLost: () => webgl.mode === 'lost' })
}

vi.mock('../../src/renderer/src/threeShared', () => ({
  sharedRenderer: async (width: number, height: number) => {
    webgl.calls++
    if (webgl.mode === 'throw') throw new Error('Error creating WebGL context.')
    fakeRenderer.setSize(width, height)
    return { three: fakeThree, renderer: fakeRenderer, canvas: glCanvas }
  },
  sharedRendererSync: () => null,
  loadThree: async () => fakeThree
}))

vi.mock('../../src/renderer/src/graphicGlowUnreal', () => ({
  loadUnrealBloom: async () => {
    bloomLoads.calls++
    return FakeBloom
  }
}))

/* ------------------------------------------------------- the stand-in document */

interface Op {
  op: string
  fill?: unknown
  image?: unknown
  /** The canvas's globalCompositeOperation at a fillRect. */
  composite?: unknown
  /** The canvas's strokeStyle at a stroke. */
  stroke?: unknown
}

interface FakeCanvas {
  width: number
  height: number
  dataset: Record<string, string>
  ops: Op[]
  getContext: () => CanvasRenderingContext2D
  toBlob: (callback: (blob: Blob | null) => void) => void
}

const canvases: FakeCanvas[] = []

function fakeCanvas(): FakeCanvas {
  const ops: Op[] = []
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, fillStyle: '#000000', globalCompositeOperation: 'source-over' }
  const stack: Record<string | symbol, unknown>[] = []
  const canvas: FakeCanvas = {
    width: 0,
    height: 0,
    dataset: {},
    ops,
    getContext: () => ctx,
    toBlob: (callback) => setTimeout(() => callback(new Blob([new Uint8Array([ops.length & 255])])), 1)
  }
  const methods: Record<string, (...args: never[]) => unknown> = {
    save: () => stack.push({ ...state }),
    restore: () => {
      const top = stack.pop()
      if (top) {
        for (const key of Object.keys(state)) delete state[key]
        Object.assign(state, top)
      }
    },
    clearRect: () => ops.push({ op: 'clearRect' }),
    fill: () => ops.push({ op: 'fill', fill: state.fillStyle }),
    fillRect: () => ops.push({ op: 'fillRect', fill: state.fillStyle, composite: state.globalCompositeOperation }),
    drawImage: (image: unknown) => ops.push({ op: 'drawImage', image }),
    stroke: () => ops.push({ op: 'stroke', stroke: state.strokeStyle }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    // The renderer's measure (graphicMeasure) on a scratch canvas: 0.55 em a character, as node's fake measures.
    measureText: (text: string) => {
      const px = Number(/(\d+(?:\.\d+)?)px/u.exec(String(state.font ?? ''))?.[1] ?? 10)
      return { width: String(text).length * px * 0.55, actualBoundingBoxAscent: px * 0.8, actualBoundingBoxDescent: px * 0.2 }
    }
  }
  const ctx = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'canvas') return canvas
        if (typeof key === 'string' && key in methods) return methods[key]
        if (key in state) return state[key]
        return () => undefined
      },
      set(_target, key, value) {
        state[key] = value
        return true
      }
    }
  ) as CanvasRenderingContext2D
  canvases.push(canvas)
  return canvas
}

const layerFactory = (w: number, h: number): CanvasRenderingContext2D => {
  const c = fakeCanvas()
  c.width = w
  c.height = h
  return c.getContext()
}

/* ------------------------------------------------------------------ items */

const SIZE = { width: 1080, height: 1920 }

function shape(id: string, fill: string, z?: number): ShapeItem {
  return { kind: 'shape', id, opacity: 1, shape: 'rect', box: { x: 100, y: 100, width: 200, height: 100 }, fill, ...(z === undefined ? {} : { z }) }
}
const dim = (z?: number): DrawItem => ({ kind: 'dim', id: 'dim', opacity: 1, color: '#000000', alpha: 0.5, ...(z === undefined ? {} : { z }) })
const list = (items: DrawItem[], extra: Partial<DrawList> = {}): DrawList => ({ ...SIZE, items, ...extra })
const FLAT: Camera = { tilt: 0, yaw: 0, dolly: 0, fov: 30 }
const TILTED: Camera = { tilt: 24, yaw: 0, dolly: 0, fov: 30 }

/* ------------------------------------------------------- the renderer's half */

type CompositorModule = typeof import('../../src/renderer/src/graphicCompositor')
type CanvasModule = typeof import('../../src/renderer/src/graphicCanvas')
let C: CompositorModule
let G: CanvasModule

beforeEach(async () => {
  made.length = 0
  renders.length = 0
  canvases.length = 0
  webgl.mode = 'ok'
  webgl.calls = 0
  bloomLoads.calls = 0
  Object.assign(rendererState, { target: null, autoClear: true, clearColor: new FakeColor(0), clearAlpha: 0, clears: [], clearAlphas: [] })
  vi.stubGlobal('document', { createElement: () => fakeCanvas(), fonts: { check: () => true } })
  C = await import('../../src/renderer/src/graphicCompositor')
  G = await import('../../src/renderer/src/graphicCanvas')
  C.resetCompositorSession()
  G.takeGraphicBakeNotes()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const texturesOf = (): Counted[] => made.filter((m) => m.kind === 'texture')
/** The frame's own renders: to the canvas, of the layers' scene (not a glow pass's one quad, not a bloom). */
const frameRenders = (): Render[] => renders.filter((r) => r.target === null && !r.material && !r.bloom)
const sceneOf = (): FakeScene => frameRenders()[frameRenders().length - 1].scene
const layerCanvas = (mesh: FakeMesh): FakeCanvas => (mesh.material.uniforms.uTex.value as FakeTexture).image
const perspective = (mesh: FakeMesh): boolean => mesh.material.vertexShader.includes('projectionMatrix')

describe('graphicCompositor: createCompositor and WebGL missing', () => {
  it('is a compositor when the shared renderer starts, built once (one quad geometry, no layer yet)', async () => {
    const c = await C.createCompositor(SIZE.width, SIZE.height)
    expect(c).not.toBeNull()
    expect(made.map((m) => m.kind)).toEqual(['geometry'])
    expect(C.webglMissing()).toBe(false)
  })

  it('is null, never a throw, when the renderer throws, and remembered for the session: the renderer is not asked again', async () => {
    webgl.mode = 'throw'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(C.createCompositor(SIZE.width, SIZE.height)).resolves.toBeNull()
    expect(C.webglMissing()).toBe(true)
    webgl.mode = 'ok'
    await expect(C.createCompositor(SIZE.width, SIZE.height)).resolves.toBeNull()
    expect(webgl.calls).toBe(1)
    expect(made).toEqual([])
    warn.mockRestore()
  })

  it('is null when the context comes back lost', async () => {
    webgl.mode = 'lost'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(C.createCompositor(SIZE.width, SIZE.height)).resolves.toBeNull()
    expect(C.webglMissing()).toBe(true)
    warn.mockRestore()
  })

  it('WEBGL_MISSING_NOTE is the plan’s wording', () => {
    expect(C.WEBGL_MISSING_NOTE).toBe('drawn flat: 3D needs WebGL, which did not start on this computer')
  })
})

describe('graphicCompositor: paintDrawList3d', () => {
  it('route one, at rest: painter A alone in plane order on a 2D canvas, no render, no texture; the same calls painter A makes', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    const items = [dim(), shape('panel', '#111111'), shape('value', '#222222', 0.05)]
    const settled = list(items, { camera: FLAT })
    const out = C.paintDrawList3d(settled, c, { layer: layerFactory }) as unknown as FakeCanvas
    expect(renders).toHaveLength(0)
    expect(texturesOf()).toHaveLength(0)
    expect(out).not.toBe(glCanvas)
    // The flat graphic, by construction: painter A's own calls over the same items.
    const twin = fakeCanvas()
    paintDrawList2d(twin.getContext(), list(items), { layer: layerFactory })
    const shapeOps = (ops: Op[]): Op[] => ops.filter((o) => o.op !== 'drawImage' && o.op !== 'clearRect')
    expect(shapeOps(out.ops)).toEqual(shapeOps(twin.ops))
    expect(out.ops.filter((o) => o.op === 'fill').map((o) => o.fill)).toEqual(['#111111', '#222222'])
  })

  it('route two: one layer at 1:1 under the identity quad, uploaded once while its items hold', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    const glowing = list([shape('value', '#222222')], { glow: [{ item: 'value', radius: 8, strength: 1 }] })
    expect(C.paintDrawList3d(glowing, c)).toBe(glCanvas)
    C.paintDrawList3d(glowing, c)
    const visible = sceneOf().children.filter((m) => m.visible)
    expect(visible).toHaveLength(1)
    expect(perspective(visible[0])).toBe(false)
    // The 1:1 layer's texture, and the glow layer's (piece 2); the 1:1 one uploaded once.
    expect(texturesOf()).toHaveLength(2)
    expect((visible[0].material.uniforms.uTex.value as FakeTexture).uploads).toBe(1)
    expect(frameRenders()).toHaveLength(2)
  })

  it('route three: the dims on an identity base layer, one perspective layer per plane far to near, each uploaded once while only the camera moves', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    const items = [dim(0.05), shape('panel', '#111111'), shape('value', '#222222', 0.05), shape('label', '#333333', 0.02)]
    for (const tilt of [24, 12, 0.5]) C.paintDrawList3d(list(items, { camera: { ...TILTED, tilt } }), c, { layer: layerFactory })
    const visible = sceneOf().children.filter((m) => m.visible).sort((a, b) => a.renderOrder - b.renderOrder)
    expect(visible.map(perspective)).toEqual([false, true, true, true])
    // The dim is the base layer's alone (painter A draws a dim by drawImage of its layer); no plane has it.
    expect(layerCanvas(visible[0]).ops.some((o) => o.op === 'drawImage')).toBe(true)
    for (const mesh of visible.slice(1)) expect(layerCanvas(mesh).ops.some((o) => o.op === 'drawImage')).toBe(false)
    expect(visible.slice(1).map((m) => layerCanvas(m).ops.filter((o) => o.op === 'fill').map((o) => o.fill))).toEqual([['#111111'], ['#333333'], ['#222222']])
    // Each plane's model: the compensation, at z × H.
    const D = flatDistance(30, SIZE.height)
    expect(visible.slice(1).map((m) => m.matrix.elements[14])).toEqual([0, 0.02 * SIZE.height, 0.05 * SIZE.height])
    expect(visible[3].matrix.elements[0]).toBeCloseTo((SIZE.width / 2) * compensation(0.05, SIZE.height, D), 9)
    expect(texturesOf().map((t) => (t as FakeTexture).uploads)).toEqual([1, 1, 1, 1])
    expect(renders).toHaveLength(3)
  })

  it('a plane whose items change is repainted and uploaded again; the others are not', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    const at = (value: string): DrawList => list([shape('panel', '#111111'), shape(value, '#222222', 0.05)], { camera: TILTED })
    C.paintDrawList3d(at('v1'), c)
    C.paintDrawList3d(at('v2'), c)
    expect(texturesOf().map((t) => (t as FakeTexture).uploads)).toEqual([1, 2])
  })

  it('refuses more than MAX_PLANES planes, a list of another size, and a disposed compositor', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    const five = [0, 0.01, 0.02, 0.03, 0.04].map((z, i) => shape(`s${i}`, '#111111', z))
    expect(() => C.paintDrawList3d(list(five, { camera: TILTED }), c)).toThrow(/5 planes, at most 4/)
    expect(() => C.paintDrawList3d({ ...list([]), width: 540 }, c)).toThrow(/540/)
    c.dispose()
    expect(() => C.paintDrawList3d(list([]), c)).toThrow(/disposed/)
  })
})

describe('graphicCompositor: the shared renderer, the layers and the camera', () => {
  it('sizes the shared renderer to its own frame before every render: another drawer may have resized it between two frames', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    const glowing = list([shape('value', '#222222')], { glow: [{ item: 'value', radius: 8, strength: 1 }] })
    const tilted = list([shape('panel', '#111111'), shape('value', '#222222', 0.05)], { camera: TILTED })
    // A moment's preview, or a graphic at another size, takes the one renderer between our frames.
    fakeRenderer.setSize(540, 960)
    C.paintDrawList3d(glowing, c)
    fakeRenderer.setSize(720, 1280)
    C.paintDrawList3d(tilted, c)
    expect(frameRenders().map((r) => r.size)).toEqual([`${SIZE.width}x${SIZE.height}`, `${SIZE.width}x${SIZE.height}`])
    // The glow's passes too: every render of both frames at the compositor's size.
    expect(new Set(renders.map((r) => r.size))).toEqual(new Set([`${SIZE.width}x${SIZE.height}`]))
  })

  it('uploads every layer premultiplied and writes the texel as it is: filtering straight texels darkens every edge of a tilted plane', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(list([shape('a', '#1')], { glow: [{ item: 'a', radius: 4, strength: 1 }] }), c)
    C.paintDrawList3d(list([dim(), shape('b', '#2'), shape('c', '#3', 0.05)], { camera: TILTED }), c, { layer: layerFactory })
    const textures = texturesOf() as FakeTexture[]
    // The 1:1 layer, the glow layer of its request, the dims' base and two planes.
    expect(textures).toHaveLength(5)
    for (const t of textures) expect(t.premultiplyAlpha).toBe(true)
    const shaders = [...new Set(sceneOf().children.map((m) => m.material.fragmentShader))]
    expect(shaders).toHaveLength(1)
    // At rest (a focus radius of 0) the texel itself, written as it is; the blur's average only above 0 (piece 2).
    const source = shaders[0].replace(/\s+/g, '')
    expect(source).toContain('vec2at=vec2(vUv.x,1.0-vUv.y);')
    expect(source).toContain('if(uBlur<=0.0){gl_FragColor=texture2D(uTex,at);return;}')
  })

  it('shows only the route’s own layers: the 1:1 layer is hidden under the planes, and the planes under the 1:1 layer', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    const glowing = list([shape('a', '#1')], { glow: [{ item: 'a', radius: 4, strength: 1 }] })
    const tilted = list([shape('b', '#2'), shape('c', '#3', 0.05)], { camera: TILTED })
    const visible = (): boolean[] => sceneOf().children.map((m) => m.visible)
    C.paintDrawList3d(glowing, c)
    expect(visible()).toEqual([true])
    C.paintDrawList3d(tilted, c)
    expect(visible()).toEqual([false, true, true])
    C.paintDrawList3d(glowing, c)
    expect(visible()).toEqual([true, false, false])
  })

  it('draws the dims’ base layer under every plane, though it was made after them', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(list([shape('b', '#2'), shape('c', '#3', 0.05)], { camera: TILTED }), c)
    C.paintDrawList3d(list([dim(), shape('b', '#2'), shape('c', '#3', 0.05)], { camera: TILTED }), c, { layer: layerFactory })
    const meshes = sceneOf().children.filter((m) => m.visible)
    const base = meshes.filter((m) => !perspective(m))
    const planes = meshes.filter(perspective)
    expect(base).toHaveLength(1)
    expect(planes).toHaveLength(2)
    for (const plane of planes) expect(base[0].renderOrder).toBeLessThan(plane.renderOrder)
    expect(planes[0].renderOrder).toBeLessThan(planes[1].renderOrder)
  })

  it('renders through cameraFor’s projection and view', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    const camera: Camera = { tilt: 24, yaw: -8, dolly: -0.12, fov: 30 }
    C.paintDrawList3d(list([shape('b', '#2'), shape('c', '#3', 0.05)], { camera }), c)
    const { projection, view } = cameraFor(camera, SIZE)
    const used = renders[renders.length - 1].camera
    expect(used.projectionMatrix.elements).toEqual(projection)
    expect(used.matrixWorldInverse.elements).toEqual(view)
  })

  it('route two paints the 1:1 layer in route one’s order (dims, then far to near), whatever the list’s order', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(list([shape('value', '#222222', 0.05), shape('panel', '#111111', 0)], { glow: [{ item: 'value', radius: 8, strength: 1 }] }), c)
    const whole = sceneOf().children.filter((m) => m.visible)
    expect(whole).toHaveLength(1)
    expect(layerCanvas(whole[0]).ops.filter((o) => o.op === 'fill').map((o) => o.fill)).toEqual(['#111111', '#222222'])
  })
})

describe('graphicCompositor: disposal', () => {
  it('holds every texture, material and geometry a build makes, each disposed exactly once, however often dispose is called', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(list([shape('a', '#1')], { glow: [{ item: 'a', radius: 4, strength: 1 }] }), c)
    C.paintDrawList3d(list([dim(), shape('b', '#2'), shape('c', '#3', 0.02), shape('d', '#4', 0.05)], { camera: TILTED }), c, { layer: layerFactory })
    // The 1:1 layer, its glow layer, the dims' base, three planes; the glow's blur and add; its input and two pass targets.
    expect(made.map((m) => m.kind).sort()).toEqual(['geometry', ...Array(8).fill('material'), ...Array(3).fill('target'), ...Array(6).fill('texture')].sort())
    c.dispose()
    c.dispose()
    expect(made.map((m) => m.disposed)).toEqual(made.map(() => 1))
  })

  it('the quad route: every render target and glow material on the list, each disposed once', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(list([shape('a', '#1'), shape('b', '#2', 0.05)], { camera: TILTED, glow: [{ item: 'a', radius: 4, strength: 1 }, { item: 'b', radius: 9, strength: 0.5 }] }), c)
    const targets = made.filter((m) => m.kind === 'target')
    // Two batches, each its input, its horizontal and its vertical target.
    expect(targets).toHaveLength(6)
    c.dispose()
    for (const m of made) expect(m.disposed, m.kind).toBe(1)
  })

  it('the unreal route: its pass and the high-pass material its own dispose() leaves out, each disposed once', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height, { glow: 'unreal' }))!
    C.paintDrawList3d(list([shape('a', '#1')], { glow: [{ item: 'a', radius: 8, strength: 1 }] }), c)
    const bloom = made.find((m) => m.kind === 'pass') as FakeBloom
    expect(bloom).toBeDefined()
    expect(made).toContain(bloom.materialHighPassFilter)
    c.dispose()
    for (const m of made) expect(m.disposed, m.kind).toBe(1)
  })
})

/* ------------------------------------------------------- the glow and the focus */

describe('graphicCompositor: the glow (piece 2)', () => {
  const glowing = (extra: Partial<DrawList> = {}): DrawList =>
    list([shape('panel', '#111111'), shape('value', '#222222'), shape('label', '#333333')], { glow: [{ item: 'value', radius: 8, strength: 0.75 }], ...extra })
  const glowLayers = (): FakeMesh[] => {
    const input = renders.find((r) => r.target instanceof FakeTarget && !r.material)
    return input ? input.scene.children.filter((m) => m.visible) : []
  }

  it('takes GLOW_ROUTE, the quad route, unless made with another, and loads UnrealBloomPass only for the unreal route', async () => {
    expect(C.GLOW_ROUTE).toBe('quad')
    await C.createCompositor(SIZE.width, SIZE.height)
    expect(bloomLoads.calls).toBe(0)
    await C.createCompositor(SIZE.width, SIZE.height, { glow: 'unreal' })
    expect(bloomLoads.calls).toBe(1)
  })

  it('the glow canvas holds the requested items alone', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(glowing(), c)
    const layers = glowLayers()
    expect(layers).toHaveLength(1)
    expect(layerCanvas(layers[0]).ops.filter((o) => o.op === 'fill').map((o) => o.fill)).toEqual(['#222222'])
  })

  it('a request with a colour paints its items in that colour (source-in over a scratch canvas), drawn onto the glow canvas', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(glowing({ glow: [{ item: 'value', radius: 8, strength: 1, color: '#2563eb' }] }), c)
    const ops = layerCanvas(glowLayers()[0]).ops
    expect(ops.filter((o) => o.op === 'fill')).toEqual([])
    const tint = ops.find((o) => o.op === 'drawImage')?.image as FakeCanvas
    expect(tint).toBeDefined()
    expect(tint.ops.filter((o) => o.op === 'fill' || o.op === 'fillRect').map((o) => o.fill)).toEqual(['#222222', '#2563eb'])
    // The colour fills only where the items are: source-in. Source-over would flood the whole glow layer.
    const colourFills = tint.ops.filter((o) => o.op === 'fillRect' && o.fill === '#2563eb')
    expect(colourFills).toHaveLength(1)
    expect(colourFills[0].composite).toBe('source-in')
  })

  it('a request whose colour changes repaints its glow layer, though its items are the same', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(glowing({ glow: [{ item: 'value', radius: 8, strength: 1, color: '#2563eb' }] }), c)
    const texture = glowLayers()[0].material.uniforms.uTex.value as FakeTexture
    renders.length = 0
    C.paintDrawList3d(glowing({ glow: [{ item: 'value', radius: 8, strength: 1, color: '#2563eb' }] }), c)
    expect(texture.uploads).toBe(1)
    renders.length = 0
    C.paintDrawList3d(glowing({ glow: [{ item: 'value', radius: 8, strength: 1, color: '#ff0000' }] }), c)
    expect(texture.uploads).toBe(2)
  })

  it('forgetPlanes repaints the glow layers too (a glow drawn while a face loaded), and dispose gives back their canvases', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(glowing(), c)
    const layer = glowLayers()[0]
    const texture = layer.material.uniforms.uTex.value as FakeTexture
    C.paintDrawList3d(glowing(), c)
    expect(texture.uploads).toBe(1)
    C.forgetPlanes(c)
    C.paintDrawList3d(glowing(), c)
    expect(texture.uploads).toBe(2)
    const canvas = layerCanvas(layer)
    expect(canvas.width).toBe(SIZE.width)
    c.dispose()
    expect([canvas.width, canvas.height]).toEqual([0, 0])
  })

  it('route three: a plane’s glow layer under the plane’s own model and focus radius, through the same camera', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    const camera: Camera = { ...TILTED, focus: { z: 0, px: 200 } }
    C.paintDrawList3d(list([shape('panel', '#111111'), shape('value', '#222222', 0.05)], { camera, glow: [{ item: 'value', radius: 8, strength: 1 }] }), c)
    const layers = glowLayers()
    expect(layers).toHaveLength(1)
    expect(perspective(layers[0])).toBe(true)
    const plane = sceneOf().children.filter((m) => m.visible && perspective(m))[1]
    expect(layers[0].matrix.elements).toEqual(plane.matrix.elements)
    expect(layers[0].material.uniforms.uBlur.value).toBeCloseTo(10, 9)
    const input = renders.find((r) => r.target instanceof FakeTarget && !r.material)!
    expect(input.camera).toBe(renders[renders.length - 1].camera)
  })

  it('a compositor moving from route two to route three draws the plane’s glow with the perspective shader, and back with the identity one', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(glowing(), c)
    expect(glowLayers().map(perspective)).toEqual([false])
    renders.length = 0
    C.paintDrawList3d(glowing({ camera: TILTED }), c)
    expect(glowLayers().map(perspective)).toEqual([true])
    renders.length = 0
    C.paintDrawList3d(glowing(), c)
    expect(glowLayers().map(perspective)).toEqual([false])
  })

  it('the quad route: the glow layers into a target, a horizontal then a vertical pass, the layers on the canvas, then the glow added', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(glowing(), c)
    const kinds = renders.map((r) => (r.target === null ? (r.material ? 'add' : 'frame') : r.material ? 'blur' : 'input'))
    expect(kinds).toEqual(['input', 'blur', 'blur', 'frame', 'add'])
    const [, h, v, , add] = renders
    expect(h.uniforms!.uStep).toEqual([1 / SIZE.width, 0])
    expect(v.uniforms!.uStep).toEqual([0, 1 / SIZE.height])
    // Each pass reads the one before: the input's texture, then the horizontal's.
    expect(h.uniforms!.uTex).toBe((renders[0].target as FakeTarget).texture)
    expect(v.uniforms!.uTex).toBe((h.target as FakeTarget).texture)
    expect(add.uniforms!.uTex).toBe((v.target as FakeTarget).texture)
    // The kernel: glowKernel's, padded; the strength and the cap the quad route's.
    const { offsets, weights } = C.glowKernel(8)
    expect((h.uniforms!.uOffsets as number[]).slice(0, offsets.length)).toEqual(offsets)
    expect((h.uniforms!.uWeights as number[]).slice(0, weights.length)).toEqual(weights)
    expect(h.uniforms!.uCount).toBe(offsets.length - 1)
    expect(add.uniforms!.uStrength).toBe(0.75)
    expect(add.uniforms!.uMaxAlpha).toBe(C.GLOW_MAX_ALPHA)
    // Added, never "over", on colour and alpha alike (ONE + ONE): alpha "over" (ONE_MINUS_SRC_ALPHA) leaves colour above alpha where the glow lands on a half-opaque item.
    const m = add.material as unknown as Record<string, number>
    expect([m.blending, m.blendSrc, m.blendDst, m.blendSrcAlpha, m.blendDstAlpha]).toEqual([fakeThree.CustomBlending, fakeThree.OneFactor, fakeThree.OneFactor, fakeThree.OneFactor, fakeThree.OneFactor])
    // The blur replaces its target, never blends into it.
    expect((h.material as unknown as Record<string, unknown>).blending).toBe(fakeThree.NoBlending)
    expect(v.material).toBe(h.material)
  })

  /*
   * The quad route's two shaders, read whole (whitespace taken out): the blur's
   * symmetric pair of taps either side, its sum written as it is, and the add's
   * strength and alpha cap. Nothing in node can run them; the harness's
   * glowReference reading checks their pixels.
   */
  it('the blur pass: the centre, then each tap at +o and −o with its weight, up to uCount, the sum written as it is', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(glowing(), c)
    const blur = renders.find((r) => r.material && r.target instanceof FakeTarget)!.material!
    expect(blur.fragmentShader.replace(/\s+/g, '')).toBe(
      'precisionhighpfloat;varyingvec2vUv;uniformsampler2DuTex;uniformvec2uStep;uniformfloatuOffsets[GLOW_TAPS];uniformfloatuWeights[GLOW_TAPS];uniformintuCount;' +
        'voidmain(){vec4sum=texture2D(uTex,vUv)*uWeights[0];for(inti=1;i<GLOW_TAPS;i++){if(i>uCount)break;vec2o=uStep*uOffsets[i];' +
        'sum+=(texture2D(uTex,vUv+o)+texture2D(uTex,vUv-o))*uWeights[i];}gl_FragColor=sum;}'
    )
  })

  it('the add pass: the glow times the strength, every channel scaled down so its alpha is at most uMaxAlpha', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(glowing(), c)
    const add = renders[renders.length - 1].material!
    expect(add.fragmentShader.replace(/\s+/g, '')).toBe(
      'precisionhighpfloat;varyingvec2vUv;uniformsampler2DuTex;uniformfloatuStrength;uniformfloatuMaxAlpha;' +
        'voidmain(){vec4glow=texture2D(uTex,vUv)*uStrength;if(glow.a>uMaxAlpha)glow*=uMaxAlpha/glow.a;gl_FragColor=glow;}'
    )
  })

  it('two batches: each spread into its own slot, then each added at its own strength from its own slot’s glow, in batch order', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(list([shape('a', '#1'), shape('b', '#2')], { glow: [{ item: 'a', radius: 4, strength: 1 }, { item: 'b', radius: 9, strength: 0.5 }] }), c)
    const kinds = renders.map((r) => (r.target === null ? (r.material ? 'add' : 'frame') : r.material ? 'blur' : 'input'))
    expect(kinds).toEqual(['input', 'blur', 'blur', 'input', 'blur', 'blur', 'frame', 'add', 'add'])
    const outs = [renders[2], renders[5]].map((r) => (r.target as FakeTarget).texture)
    expect(outs[0]).not.toBe(outs[1])
    const adds = renders.slice(7)
    expect(adds.map((r) => r.uniforms!.uStrength)).toEqual([1, 0.5])
    expect(adds.map((r) => r.uniforms!.uTex)).toEqual(outs)
    // Each batch blurred by its own radius's kernel.
    expect([renders[1], renders[4]].map((r) => r.uniforms!.uCount)).toEqual([C.glowKernel(4).offsets.length - 1, C.glowKernel(9).offsets.length - 1])
  })

  it('the unreal route: the bloom reads the glow layers’ target, and its own composite, the bloom alone, is added at strength 1 with no cap', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height, { glow: 'unreal' }))!
    C.paintDrawList3d(glowing(), c)
    const bloomRender = renders.find((r) => r.bloom)!
    const input = renders.find((r) => r.target instanceof FakeTarget && !r.material)!
    expect(bloomRender.target).toBe(input.target)
    const bloom = bloomRender.bloom!
    // The request's strength with the composite's own gain taken out (UNREAL_GAIN).
    expect([bloom.strength, bloom.radius, bloom.threshold]).toEqual([0.75 / C.UNREAL_GAIN, 8 / C.UNREAL_RADIUS_PX, 0])
    expect(bloom.resolution).toEqual({ x: SIZE.width, y: SIZE.height })
    const add = renders[renders.length - 1]
    expect(add.uniforms!.uTex).toBe(bloom.renderTargetsHorizontal[0].texture)
    expect([add.uniforms!.uStrength, add.uniforms!.uMaxAlpha]).toEqual([1, 1])
    expect(renders.some((r) => r.material && r.target !== null)).toBe(false)
  })

  it('puts the shared renderer’s render target, auto-clear and clear colour back as a moment left them', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    const momentTarget = { moment: true }
    const momentColour = new FakeColor(0x123456)
    Object.assign(rendererState, { target: momentTarget, autoClear: true, clearColor: momentColour, clearAlpha: 1 })
    C.paintDrawList3d(glowing(), c)
    expect(rendererState.target).toBe(momentTarget)
    expect(rendererState.autoClear).toBe(true)
    expect(rendererState.clearColor.hex).toBe(0x123456)
    expect(rendererState.clearAlpha).toBe(1)
    // While it drew, every target and the canvas were cleared to transparent black (the moment's clear alpha was 1).
    expect(renders.map((r) => r.target).filter((t) => t !== null)).toHaveLength(3)
    expect(rendererState.clears).toHaveLength(4)
    expect(rendererState.clearAlphas).toEqual([0, 0, 0, 0])
  })

  it('no glow is drawn under the probe’s glow: false (the harness’s base under the glow); a request of radius or strength 0 is route one, no render', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(glowing(), c, {}, { glow: false })
    expect(renders.map((r) => r.target)).toEqual([null])
    C.paintDrawList3d(glowing({ glow: [{ item: 'value', radius: 0, strength: 1 }] }), c)
    C.paintDrawList3d(glowing({ glow: [{ item: 'value', radius: 8, strength: 0 }] }), c)
    expect(renders).toHaveLength(1)
    expect(made.filter((m) => m.kind === 'target')).toEqual([])
  })

  /*
   * Phase 3's piece 6, M12: the harness's readRenderTargetPixelsAsync needs the
   * frame in a render target. The probe's `target` takes the canvas's place for
   * the frame and the glow added over it, and nothing else moves; without it
   * both are the canvas (null), as every drawer for the app has them.
   */
  it('the probe’s target takes the canvas’s place for the frame and the glow added, and only the harness passes it', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    const into = new FakeTarget(SIZE.width, SIZE.height, {})
    C.paintDrawList3d(glowing(), c, {}, { target: into as unknown as import('three').WebGLRenderTarget })
    const kinds = renders.map((r) => (r.target === into ? (r.material ? 'add' : 'frame') : r.target === null ? 'canvas' : r.material ? 'blur' : 'input'))
    expect(kinds).toEqual(['input', 'blur', 'blur', 'frame', 'add'])
    renders.length = 0
    C.paintDrawList3d(glowing(), c)
    expect(renders.filter((r) => r.target === null)).toHaveLength(2)
    expect(renders.some((r) => r.target === into)).toBe(false)
    // No drawer for the app passes a probe target: paintFrame hands paintDrawList3d three arguments.
    const canvasSource = readFileSync(resolve(__dirname, '../../src/renderer/src/graphicCanvas.ts'), 'utf8')
    const calls = [...canvasSource.matchAll(/paintDrawList3d\(([^)]*)\)/g)]
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) expect(call[1], call[0]).not.toMatch(/target/)
  })

  it('refuses more than MAX_GLOW_BATCHES batches', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    const glow = [1, 2, 3].map((radius) => ({ item: 'value', radius, strength: 1 }))
    expect(() => C.paintDrawList3d(glowing({ glow }), c)).toThrow(/3 glow batches, at most 2/)
  })
})

describe('graphicCompositor: the focus blur (piece 2)', () => {
  it('each plane’s uBlur is focusRadius: 0 on the depth in focus, px × distance elsewhere; the base and the 1:1 layer 0', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    const camera: Camera = { ...FLAT, focus: { z: 0, px: 500 } }
    C.paintDrawList3d(list([dim(), shape('label', '#1', -0.02), shape('panel', '#2'), shape('value', '#3', 0.05)], { camera }), c, { layer: layerFactory })
    const visible = sceneOf().children.filter((m) => m.visible).sort((a, b) => a.renderOrder - b.renderOrder)
    expect(visible.map((m) => m.material.uniforms.uBlur.value)).toEqual([0, 10, 0, 25])
    expect(visible[2].material.uniforms.uBlur.value).toBe(0)
  })

  it('the probe’s focus: false draws route three with every radius 0 (the harness’s route three at rest)', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(list([shape('panel', '#2'), shape('value', '#3', 0.05)], { camera: { ...FLAT, focus: { z: 0, px: 500 } } }), c, {}, { focus: false })
    expect(sceneOf().children.filter((m) => m.visible).map((m) => m.material.uniforms.uBlur.value)).toEqual([0, 0])
  })

  it('a focus of 0 px is route one: painter A, no render', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(list([shape('panel', '#2'), shape('value', '#3', 0.05)], { camera: { ...FLAT, focus: { z: -0.02, px: 0 } } }), c)
    expect(renders).toEqual([])
  })

  it('the shader’s disc is focusDisc, FOCUS_TAPS of them, in the frame’s texels', async () => {
    const c = (await C.createCompositor(SIZE.width, SIZE.height))!
    C.paintDrawList3d(list([shape('value', '#3', 0.05)], { camera: TILTED }), c)
    const material = sceneOf().children[0].material as FakeMaterial & { defines: Record<string, number> }
    expect(material.defines.FOCUS_TAPS).toBe(13)
    expect(material.uniforms.uDisc.value).toEqual(C.focusDisc().flatMap(([x, y]) => [x, y]))
    expect(material.uniforms.uTexel.value).toEqual([1 / SIZE.width, 1 / SIZE.height])
    expect(material.fragmentShader).toMatch(/for \(int i = 0; i < FOCUS_TAPS; i\+\+\) sum \+= texture2D\(uTex, at \+ uDisc\[i\] \* uBlur \* uTexel\);\s*gl_FragColor = sum \/ float\(FOCUS_TAPS\);/)
  })
})

/* ----------------------------------------------------------- the seam */

const STYLE = resolveGraphicStyle('clean')
const SPEC: GraphicSpec = { data: { template: 'counter', value: '40', label: 'forty' }, seconds: 1, beats: [0.5], place: { auto: true, third: 'middle' }, seed: 1, version: 0 }
const NO_TARGETS = (): GraphicTargets => ({})
/** A tilt from 24° to 0 over the first half second, the panel at z 0 and the value at 0.05: what piece 3's counter will emit. */
const tilting: Drawer = (_s, _style, clock) => ({
  items: [shape('panel', '#111111'), shape('value', '#222222', 0.05)],
  camera: { ...TILTED, tilt: Math.max(0, 24 * (1 - clock.t / 0.5)) }
})

describe('graphicCanvas: the compositor seam', () => {
  let written: number[]

  beforeEach(async () => {
    written = []
    resetBakeGuard()
    const { useCatalog } = await import('../../src/renderer/src/catalog')
    useCatalog.setState({ ensureFont: async () => true, loadedFonts: new Set([STYLE.font]), failedFonts: new Map() })
    const { setPoolCanvases } = await import('../../src/renderer/src/encodePool')
    setPoolCanvases((w, h) => {
      const c = fakeCanvas()
      c.width = w
      c.height = h
      return c as unknown as HTMLCanvasElement
    })
    vi.stubGlobal('window', {
      forge: {
        clearTitleFrames: async () => undefined,
        writeTitleFrame: async (_clipId: string, frame: number) => {
          written.push(frame)
          return '/cache/clip.seq/%06d.png'
        }
      }
    })
  })

  afterEach(async () => {
    const { setPoolCanvases } = await import('../../src/renderer/src/encodePool')
    setPoolCanvases(null)
  })

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))
  const preview = (clipId: string, frame: number, onReady?: () => void, size = SIZE): HTMLCanvasElement | null =>
    G.graphicPreviewCanvas(clipId, SPEC, STYLE, size.width, size.height, { frame, total: 30, fps: 30 }, {}, onReady, tilting)

  it('the hand-built drawer’s tilting list needs it (which production drawers ask is pinned per template in tests/graphicDrawList.test.ts: counter and ring since piece 3)', () => {
    expect(needsCompositor({ ...SIZE, ...tilting(SPEC, STYLE, { t: 0, fps: 30 }, SIZE, () => ({ width: 0, ascent: 0, descent: 0 }), {}) })).toBe(true)
  })

  it('the preview makes one compositor for the entry, paints flat until it lands, then through it; rebuilt on a new size; disposed on clip removal', async () => {
    const ready = vi.fn()
    expect(preview('g1', 0, ready)).not.toBeNull()
    expect(renders).toHaveLength(0)
    await settle()
    expect(ready).toHaveBeenCalledTimes(1)
    const copy = preview('g1', 1, ready) as unknown as FakeCanvas
    expect(renders).toHaveLength(1)
    // The frame is copied from the WebGL canvas into the entry's own.
    expect(copy.ops.some((o) => o.op === 'drawImage' && o.image === glCanvas)).toBe(true)
    preview('g1', 2, ready)
    expect(made.filter((m) => m.kind === 'geometry')).toHaveLength(1)

    // A new size rebuilds: the old compositor's every disposable disposed once.
    const first = [...made]
    preview('g1', 3, ready, { width: 540, height: 960 })
    await settle()
    expect(first.map((m) => m.disposed)).toEqual(first.map(() => 1))
    expect(made.filter((m) => m.kind === 'geometry')).toHaveLength(2)

    // Clip removal disposes the second.
    preview('g1', 4, ready, { width: 540, height: 960 })
    G.forgetGraphicPreview('g1')
    expect(made.map((m) => m.disposed)).toEqual(made.map(() => 1))
  })

  it('a frame drawn while a face loads is uploaded again once it has landed, though its items are the same', async () => {
    const { useCatalog } = await import('../../src/renderer/src/catalog')
    preview('g8', 1)
    await settle()
    useCatalog.setState({ loadedFonts: new Set() })
    preview('g8', 1)
    const uploads = (): number[] => made.filter((m) => m.kind === 'texture').map((t) => (t as FakeTexture).uploads)
    expect(uploads()).toEqual([1, 1])
    useCatalog.setState({ loadedFonts: new Set([STYLE.font]) })
    preview('g8', 1)
    expect(uploads()).toEqual([2, 2])
    G.forgetGraphicPreview('g8')
  })

  /** The compositors alive: one quad geometry each, made by createCompositor and disposed with it. */
  const alive = (): number => made.filter((m) => m.kind === 'geometry' && m.disposed === 0).length

  it('the preview keeps at most PREVIEW_COMPOSITOR_CAP compositors, the least recently drawn disposed first, each exactly once', async () => {
    expect(G.PREVIEW_COMPOSITOR_CAP).toBe(3)
    // Each clip drawn a hold apart: the ones before it are off screen.
    let now = 1_000_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5']
    for (const id of ids) {
      now += G.PREVIEW_COMPOSITOR_HOLD_MS
      preview(id, 1)
      await settle()
      preview(id, 2)
      expect(alive(), id).toBeLessThanOrEqual(G.PREVIEW_COMPOSITOR_CAP)
    }
    expect(alive()).toBe(3)
    // c1 and c2 went first; c3, c4 and c5 are kept. Drawing c3 makes it the most recent, so c6 evicts c4.
    now += G.PREVIEW_COMPOSITOR_HOLD_MS
    preview('c3', 3)
    preview('c6', 1)
    await settle()
    const geometries = made.filter((m) => m.kind === 'geometry')
    expect(geometries.map((g) => g.disposed)).toEqual([1, 1, 0, 1, 0, 0])
    for (const id of [...ids, 'c6']) G.forgetGraphicPreview(id)
    expect(made.map((m) => m.disposed)).toEqual(made.map(() => 1))
    clock.mockRestore()
  })

  it('four clips needing one on the same frame: three draw through WebGL every pass, the fourth flat with no compositor made, and the repaints stop; it takes a slot once one is off screen', async () => {
    let now = 2_000_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const ids = ['d1', 'd2', 'd3', 'd4']
    try {
      const ready = vi.fn()
      const perPass: number[] = []
      // Playback: each pass is the next frame of the tilt (frames 1..6 all move), every clip drawn on it.
      for (let pass = 0; pass < 6; pass++) {
        const before = frameRenders().length
        for (const id of ids) preview(id, pass + 1, ready)
        perPass.push(frameRenders().length - before)
        await settle()
        // Six passes span more than the hold: a slot is kept by being drawn, not by when it was made.
        now += 100
      }
      // Pass 0 waits for the landings; every pass after draws three through WebGL.
      expect(perPass).toEqual([0, 3, 3, 3, 3, 3])
      expect(made.filter((m) => m.kind === 'geometry')).toHaveLength(3)
      expect(ready).toHaveBeenCalledTimes(3)
      // d4's flat frame is not kept: drawn again on the SAME frame once the others have been off screen for the hold, it asks again and takes the least recently drawn's slot (d1's).
      now += G.PREVIEW_COMPOSITOR_HOLD_MS
      preview('d4', 6, ready)
      await settle()
      expect(made.filter((m) => m.kind === 'geometry').map((g) => g.disposed)).toEqual([1, 0, 0, 0])
      const before = frameRenders().length
      preview('d4', 7, ready)
      expect(frameRenders().length - before).toBe(1)
    } finally {
      for (const id of ids) G.forgetGraphicPreview(id)
      clock.mockRestore()
    }
    expect(made.map((m) => m.disposed)).toEqual(made.map(() => 1))
  })

  it('a frame that is route one’s (settled, no glow) gives the clip’s compositor back; a moving frame makes one again', async () => {
    preview('r1', 1)
    await settle()
    preview('r1', 2)
    expect(alive()).toBe(1)
    // Frame 20: the tilt has settled (0 from t = 0.5 s), the list is route one's.
    const rest = preview('r1', 20) as unknown as FakeCanvas
    expect(alive()).toBe(0)
    expect(made.map((m) => m.disposed)).toEqual(made.map(() => 1))
    // Painter A's own picture, no copy of a WebGL canvas.
    expect(rest.ops.slice(rest.ops.map((o) => o.op).lastIndexOf('clearRect')).some((o) => o.image === glCanvas)).toBe(false)
    preview('r1', 3)
    await settle()
    expect(alive()).toBe(1)
    G.forgetGraphicPreview('r1')
    expect(alive()).toBe(0)
  })

  it('WebGL missing: the clip is marked drawn flat the moment its compositor lands null, and the panel’s hook hears it, with no other render', async () => {
    webgl.mode = 'throw'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const heard: boolean[] = []
    const stop = G.useGraphicDrawnFlat.subscribe((state) => heard.push(state.ids.has('w1')))
    preview('w1', 0)
    expect(G.graphicDrawnFlat('w1')).toBe(false)
    await settle()
    // No second preview call: the landing itself marked it.
    expect(G.graphicDrawnFlat('w1')).toBe(true)
    expect(G.useGraphicDrawnFlat.getState().ids.has('w1')).toBe(true)
    expect(heard).toEqual([true])
    // A later clip in the same session is marked on its first frame: the session already knows.
    preview('w2', 0)
    expect(G.graphicDrawnFlat('w2')).toBe(true)
    G.forgetGraphicPreview('w1')
    G.forgetGraphicPreview('w2')
    expect(G.useGraphicDrawnFlat.getState().ids.size).toBe(0)
    expect(heard[heard.length - 1]).toBe(false)
    stop()
    warn.mockRestore()
  })

  it('a compositor that lands after its entry was superseded is disposed, not kept', async () => {
    preview('g2', 0)
    G.forgetGraphicPreview('g2')
    await settle()
    expect(made.length).toBeGreaterThan(0)
    expect(made.map((m) => m.disposed)).toEqual(made.map(() => 1))
  })

  it('the bake keeps one compositor for its length, disposes it in its finally, and bakes the canvas region though the box was allowed', async () => {
    const run = await G.bakeGraphicSequence(SPEC, STYLE, 'g3', SIZE.width, SIZE.height, 30, 30, NO_TARGETS, true, tilting)
    expect(run).not.toBeNull()
    expect(run!.box).toBeUndefined()
    expect(written.length).toBe(run!.frames)
    expect(made.filter((m) => m.kind === 'geometry')).toHaveLength(1)
    expect(made.map((m) => m.disposed)).toEqual(made.map(() => 1))
    // Frames 0..14 tilt (route three), the rest are flat (route one): only the tilted ones render.
    expect(run!.frames).toBeGreaterThan(15)
    expect(renders.length).toBe(15)
    expect(G.takeGraphicBakeNotes()).toEqual([])
  })

  it('a real hero counter (DRAWERS, no drawer handed in) bakes the canvas region though the box was allowed, and no more frames than its flat twin; its settled frames are route one’s', async () => {
    const counter: GraphicSpec = { ...SPEC, seconds: 2 }
    const clean = resolveGraphicStyle('clean')
    const neon = resolveGraphicStyle('neon')
    const flat = await G.bakeGraphicSequence(counter, clean, 'h0', SIZE.width, SIZE.height, 60, 30, NO_TARGETS, true)
    expect(flat!.box).toBeDefined()
    expect(made).toEqual([])
    // The hero under neon: tilted while it enters, glowing throughout. A tilt or a glow inks outside the flat itemBounds.
    const hero = await G.bakeGraphicSequence({ ...counter, depth: 'tilt', hero: true }, neon, 'h1', SIZE.width, SIZE.height, 60, 30, NO_TARGETS, true)
    expect(hero!.box).toBeUndefined()
    expect(hero!.frames).toBe(flat!.frames)
    // Every frame reaches WebGL (the glow persists at rest, route two).
    expect(frameRenders().length).toBe(hero!.frames)
    renders.length = 0
    // Tilt alone, under clean: only the frames whose camera is off flat render; the rest, the held one among them, are painter A's.
    const tilt = await G.bakeGraphicSequence({ ...counter, depth: 'tilt' }, clean, 'h2', SIZE.width, SIZE.height, 60, 30, NO_TARGETS, true)
    expect(tilt!.box).toBeUndefined()
    expect(tilt!.frames).toBe(flat!.frames)
    const measure = G.graphicMeasure()
    const tilted = Array.from({ length: tilt!.frames }, (_, f) => drawListAt({ ...counter, depth: 'tilt' }, clean, f, 30, SIZE, measure)).filter((l) => !cameraIsFlat(l.camera)).length
    expect(tilted).toBeGreaterThan(0)
    expect(tilted).toBeLessThan(tilt!.frames)
    expect(frameRenders().length).toBe(tilted)
  })

  /** Step 6's three (docs/CLIPS.md §9), their English fixtures; the owner's Hindi and Telugu join by membership. */
  const STEP_SIX_SPECS = (JSON.parse(readFileSync(resolve(__dirname, '../fixtures/graphics/specs.json'), 'utf8')) as { specs: { id: string; spec: GraphicSpec }[] }).specs.filter((f) =>
    ['timeline', 'before-after', 'versus'].includes(f.spec.data.template)
  )

  it('step 6’s three with a depth (DRAWERS, 3D templates piece 3): the canvas region though the box was allowed, as many frames as the flat twin, WebGL only on the frames off flat; with WebGL missing, painter A every frame, the note once, the Preview marked', async () => {
    const clean = resolveGraphicStyle('clean')
    const measure = G.graphicMeasure()
    for (const id of ['timeline-en', 'before-after-en', 'versus-en']) expect(STEP_SIX_SPECS.map((f) => f.id), id).toContain(id)
    let n = 0
    for (const f of STEP_SIX_SPECS) {
      const total = Math.round(f.spec.seconds * 30)
      const flat = await G.bakeGraphicSequence(f.spec, clean, `s6-${++n}`, SIZE.width, SIZE.height, total, 30, NO_TARGETS, true)
      expect(flat!.box, f.id).toBeDefined()
      for (const depth of ['tilt', 'parallax', 'dolly', 'focus'] as const) {
        const where = `${f.id} ${depth}`
        renders.length = 0
        const spec: GraphicSpec = { ...f.spec, depth }
        const run = await G.bakeGraphicSequence(spec, clean, `s6-${++n}`, SIZE.width, SIZE.height, total, 30, NO_TARGETS, true)
        expect(run!.box, where).toBeUndefined()
        expect(run!.frames, where).toBe(flat!.frames)
        const off = Array.from({ length: run!.frames }, (_, fr) => drawListAt(spec, clean, fr, 30, SIZE, measure)).filter((l) => !cameraIsFlat(l.camera)).length
        expect(off, where).toBeGreaterThan(0)
        expect(off, where).toBeLessThan(run!.frames)
        expect(frameRenders().length, where).toBe(off)
      }
    }
    expect(G.takeGraphicBakeNotes()).toEqual([])
    made.length = 0

    webgl.mode = 'throw'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    renders.length = 0
    for (const f of STEP_SIX_SPECS) {
      for (const depth of ['tilt', 'parallax', 'dolly', 'focus'] as const) {
        const run = await G.bakeGraphicSequence({ ...f.spec, depth }, clean, `s6-${++n}`, SIZE.width, SIZE.height, Math.round(f.spec.seconds * 30), 30, NO_TARGETS, true)
        expect(run, `${f.id} ${depth}`).not.toBeNull()
      }
      // The Preview: marked drawn flat on the frame its compositor lands null.
      const live = `s6-live-${f.id}`
      G.graphicPreviewCanvas(live, { ...f.spec, depth: 'parallax' }, clean, SIZE.width, SIZE.height, { frame: 2, total: 90, fps: 30 }, {})
      await settle()
      expect(G.graphicDrawnFlat(live), f.id).toBe(true)
      G.forgetGraphicPreview(live)
    }
    expect(renders).toHaveLength(0)
    expect(made).toEqual([])
    expect(G.takeGraphicBakeNotes()).toEqual([C.WEBGL_MISSING_NOTE])
    warn.mockRestore()
  })

  it('the harness frames (graphicFrameCanvases) keep one compositor and dispose it in their finally', async () => {
    const frames = await G.graphicFrameCanvases(SPEC, STYLE, SIZE.width, SIZE.height, 30, 30, [0, 5, 29], NO_TARGETS, tilting)
    expect(frames).toHaveLength(3)
    expect(made.filter((m) => m.kind === 'geometry')).toHaveLength(1)
    expect(made.map((m) => m.disposed)).toEqual(made.map(() => 1))
  })

  it('a flat drawer still takes the box route: only a list that needs the compositor forces the canvas', async () => {
    const flat: Drawer = () => ({ items: [shape('panel', '#111111')] })
    const run = await G.bakeGraphicSequence(SPEC, STYLE, 'g4', SIZE.width, SIZE.height, 30, 30, NO_TARGETS, true, flat)
    expect(run!.box).toEqual({ x: 100, y: 100, width: 202, height: 102 })
    expect(made).toEqual([])
  })

  it('WebGL missing: painter A paints every frame (no camera, no z), and WEBGL_MISSING_NOTE is recorded once over two bakes; the preview marks its clip', async () => {
    webgl.mode = 'throw'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const a = await G.bakeGraphicSequence(SPEC, STYLE, 'g5', SIZE.width, SIZE.height, 30, 30, NO_TARGETS, true, tilting)
    const b = await G.bakeGraphicSequence(SPEC, STYLE, 'g6', SIZE.width, SIZE.height, 30, 30, NO_TARGETS, false, tilting)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(renders).toHaveLength(0)
    expect(made).toEqual([])
    expect(G.takeGraphicBakeNotes()).toEqual([C.WEBGL_MISSING_NOTE])
    expect(G.takeGraphicBakeNotes()).toEqual([])

    // Painter A paints such a list in route one's order, whatever order its drawer emitted: the picture route one draws at rest.
    const backwards: Drawer = (spec, style, clock, size, measure, targets) => {
      const at = tilting(spec, style, clock, size, measure, targets)
      return { ...at, items: [...at.items].reverse() }
    }
    const [frame] = (await G.graphicFrameCanvases(SPEC, STYLE, SIZE.width, SIZE.height, 30, 30, [29], NO_TARGETS, backwards)) as unknown as FakeCanvas[]
    expect(frame.ops.filter((o) => o.op === 'fill').map((o) => o.fill)).toEqual(['#111111', '#222222'])
    G.takeGraphicBakeNotes()

    expect(G.graphicDrawnFlat('g7')).toBe(false)
    preview('g7', 0)
    await settle()
    const drawn = preview('g7', 1) as unknown as FakeCanvas
    expect(G.graphicDrawnFlat('g7')).toBe(true)
    // Painter A's own fills, flat: the panel then the value, no copy from a WebGL canvas.
    // This frame's calls: the canvas is the entry's, kept across frames, and cleared before each.
    const thisFrame = drawn.ops.slice(drawn.ops.map((o) => o.op).lastIndexOf('clearRect'))
    expect(thisFrame.filter((o) => o.op === 'fill').map((o) => o.fill)).toEqual(['#111111', '#222222'])
    expect(drawn.ops.some((o) => o.image === glCanvas)).toBe(false)
    G.forgetGraphicPreview('g7')
    expect(G.graphicDrawnFlat('g7')).toBe(false)
    warn.mockRestore()
  })

  /*
   * The screen card's edge sweep (docs/CLIPS.md §6.16, phase 3's piece 5): a
   * real card (DRAWERS), 20 s at 30 fps, L = 30 and N = 180; its frames'
   * files left out, so nothing is decoded (the sweep needs no picture).
   */
  const CARD: GraphicSpec = { data: { template: 'screen-card', clipId: 'rec', move: 'tilt-in' }, seconds: 20, beats: [1], place: { auto: true, third: 'middle' }, seed: 1, version: 1 }
  const CARD_TARGETS = (): GraphicTargets => ({ screen: { box: { x: 0, y: 656.25, width: 1080, height: 607.5 }, file: null } })
  const cardPreview = (clipId: string, frame: number, style: ReturnType<typeof resolveGraphicStyle>): HTMLCanvasElement | null =>
    G.graphicPreviewCanvas(clipId, CARD, style, SIZE.width, SIZE.height, { frame, total: 600, fps: 30 }, CARD_TARGETS())

  it('a glowing screen card’s edge sweep draws through the clip’s compositor for its loop, a scrub into its middle too, and gives it back on L + N, its last baked frame, where the card is route one’s; a card with no glow holds none after its landing', async () => {
    const neon = resolveGraphicStyle('neon')
    const clean = resolveGraphicStyle('clean')
    // A scrub straight into the sweep's middle: drawn flat while the compositor lands, then through it.
    cardPreview('s1', 120, neon)
    await settle()
    let before = frameRenders().length
    cardPreview('s1', 121, neon)
    expect(frameRenders().length - before).toBe(1)
    expect(alive()).toBe(1)
    // Its last frame, L + N − 1 = 209, still through it.
    before = frameRenders().length
    cardPreview('s1', 209, neon)
    expect(frameRenders().length - before).toBe(1)
    expect(alive()).toBe(1)
    // L + N = 210: the plain card, painter A's, and the compositor given back, every disposable once.
    before = frameRenders().length
    const rest = cardPreview('s1', 210, neon) as unknown as FakeCanvas
    expect(frameRenders().length - before).toBe(0)
    expect(alive()).toBe(0)
    expect(made.map((m) => m.disposed)).toEqual(made.map(() => 1))
    expect(rest.ops.slice(rest.ops.map((o) => o.op).lastIndexOf('clearRect')).some((o) => o.image === glCanvas)).toBe(false)
    // The hold shows that frame and makes none.
    cardPreview('s1', 400, neon)
    await settle()
    expect(alive()).toBe(0)
    // Under clean the card has no sweep: after its landing it never asks.
    cardPreview('s2', 31, clean)
    cardPreview('s2', 120, clean)
    await settle()
    expect(made.filter((m) => m.kind === 'geometry')).toHaveLength(1)
    G.forgetGraphicPreview('s1')
    G.forgetGraphicPreview('s2')
  })

  it('WebGL missing: the edge sweep is drawn by painter A without its glow, the bezel and the sweep both stroked, and the card is marked drawn flat', async () => {
    webgl.mode = 'throw'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const neon = resolveGraphicStyle('neon')
    cardPreview('s3', 35, neon)
    await settle()
    const drawn = cardPreview('s3', 36, neon) as unknown as FakeCanvas
    expect(G.graphicDrawnFlat('s3')).toBe(true)
    const thisFrame = drawn.ops.slice(drawn.ops.map((o) => o.op).lastIndexOf('clearRect'))
    expect(thisFrame.some((o) => o.image === glCanvas)).toBe(false)
    // Frame 36 is L + 6: the span still crosses the path's start, so two sweep strokes in the accent, after the bezel in the panel colour.
    expect(thisFrame.filter((o) => o.op === 'stroke').map((o) => o.stroke)).toEqual([neon.palette.panel, neon.palette.accent, neon.palette.accent])
    expect(renders).toHaveLength(0)
    G.forgetGraphicPreview('s3')
    warn.mockRestore()
  })

  it('the bake of a glowing card writes L + 1 + N frames (211 at 30 fps) at the canvas region, the move and the sweep through WebGL, the landing and the held card not; under clean 46', async () => {
    const neon = resolveGraphicStyle('neon')
    const clean = resolveGraphicStyle('clean')
    const glowing = await G.bakeGraphicSequence(CARD, neon, 'k1', SIZE.width, SIZE.height, 600, 30, CARD_TARGETS, true)
    expect(glowing!.frames).toBe(211)
    expect(written).toHaveLength(211)
    expect(glowing!.box).toBeUndefined()
    // Frames 0..29 move (route three); L = 30 lands flat (route one, painter A); 31..209 sweep (route two); 210 is the plain held card (route one).
    expect(frameRenders().length).toBe(30 + 179)
    expect(made.map((m) => m.disposed)).toEqual(made.map(() => 1))
    written = []
    const plain = await G.bakeGraphicSequence(CARD, clean, 'k2', SIZE.width, SIZE.height, 600, 30, CARD_TARGETS, true)
    expect(plain!.frames).toBe(46)
    expect(written).toHaveLength(46)
  })
})

describe('the export takes the graphic bakes’ notes', () => {
  it('drops a store bake’s before its bake and notifies its own after, each once (ExportStrip.tsx, in that order)', () => {
    const source = readFileSync(resolve(__dirname, '../../src/renderer/src/components/ExportStrip.tsx'), 'utf8')
    const takes = [...source.matchAll(/takeGraphicBakeNotes\(\)/g)].map((m) => m.index!)
    const bakes = [...source.matchAll(/await bakeForExport\(/g)].map((m) => m.index!)
    expect(takes).toHaveLength(2)
    expect(bakes).toHaveLength(1)
    expect(takes[0]).toBeLessThan(bakes[0])
    expect(takes[1]).toBeGreaterThan(bakes[0])
    expect(source.slice(takes[1] - 40, takes[1] + 80)).toMatch(/for \(const note of takeGraphicBakeNotes\(\)\) notify\(`A graphic was \$\{note\}`, 'info'\)/)
  })
})
