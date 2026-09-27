import type { MomentSpec } from '@shared/timeline'
import { mediaUrl } from '@shared/mediaUrl'
import { footageFrameIndex, momentParams, momentT, movingFrames, shotPicture, type TexturePlan } from '@shared/render/moment'
import { withFootageFrames, type MomentTextures } from '@shared/render/momentTextures'
import { beginBake, endBake, isSuperseded } from '@shared/bakeGuard'
import { sharedRenderer, sharedRendererSync, type Three } from './threeShared'

/**
 * The moments, drawn with three.js (docs/PLAN.md §7.2).
 *
 * `render/moment.ts` decides WHEN a moment's frames fall and WHAT each one
 * draws from — the numbers, seeded — and imports no three.js at all; this
 * turns them into pixels. Same division as the card ring (carouselCanvas.ts),
 * and the same rails: the one shared renderer, a canvas the preview shows
 * live, numbered PNGs with alpha for the export, held by `tpad`. Nothing in
 * the export knows three.js exists.
 *
 * Every kind is a full-frame quad with a fragment shader. What the shaders
 * sample is each shot's PICTURE AS THE RENDER COMPOSES IT on that frame:
 * `shotPicture` says which rectangle of the photo — or of each depth plane,
 * moved by its own share — sits where on the frame (the crop, the box, the
 * fit, the camera move, the transition's punch-in), and `compose` draws that
 * onto a frame-sized 2D canvas from the full-resolution picture. So a
 * moment's first frame is the outgoing shot's frame to the pixel, its last
 * the incoming's, and the hand-offs beneath cannot be seen. The pictures are
 * decoded raw (no EXIF turn, no colour management — as the bundled ffmpeg
 * reads them) and sampled raw, so that equality holds; the mixes in between
 * are in the picture's own space, as gl-transitions' are.
 */

/* ------------------------------------------------------------- pictures */

/**
 * The photographs, decoded once at full size and kept by recency.
 *
 * A moment fills the frame, so it draws from the whole picture: a 12 MP
 * photograph is 48 MB decoded, and a wedding set has hundreds of them. The
 * cache is bounded by bytes and lets the oldest go, closing its bitmap so the
 * memory really returns.
 */
const PICTURE_BYTES = 512 * 1024 * 1024
const pictures = new Map<string, { bitmap: ImageBitmap; bytes: number }>()
let pictureBytes = 0
/** Pictures a built scene is drawing from, by how many scenes hold them: never let go while pinned, whatever the budget says. */
const pinned = new Map<string, number>()

function pin(paths: string[]): void {
  for (const p of paths) pinned.set(p, (pinned.get(p) ?? 0) + 1)
}

function unpin(paths: string[]): void {
  for (const p of paths) {
    const n = (pinned.get(p) ?? 1) - 1
    if (n > 0) pinned.set(p, n)
    else pinned.delete(p)
  }
}

async function pictureFor(path: string): Promise<ImageBitmap | null> {
  const hit = pictures.get(path)
  if (hit) {
    // Most recently used last.
    pictures.delete(path)
    pictures.set(path, hit)
    return hit.bitmap
  }
  let bitmap: ImageBitmap
  try {
    const blob = await (await fetch(mediaUrl(path))).blob()
    // As ffmpeg reads the file: the stored orientation, the stored colour values.
    bitmap = await createImageBitmap(blob, { imageOrientation: 'none', colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  } catch {
    return null
  }
  const bytes = bitmap.width * bitmap.height * 4
  // The oldest go first, but never a picture a scene is still drawing: closing that throws on the next draw.
  for (const [oldest, entry] of pictures) {
    if (pictureBytes + bytes <= PICTURE_BYTES) break
    if (pinned.has(oldest)) continue
    entry.bitmap.close()
    pictures.delete(oldest)
    pictureBytes -= entry.bytes
  }
  pictures.set(path, { bitmap, bytes })
  pictureBytes += bytes
  return bitmap
}

/** Tests and the harness: forget every decoded picture. */
export function forgetPictures(): void {
  for (const { bitmap } of pictures.values()) bitmap.close()
  pictures.clear()
  pinned.clear()
  pictureBytes = 0
}

/* ------------------------------------------------------------- composing */

/** A shot's pictures, decoded and pinned: the photo and its planes, far to near — or, for footage, its frames under the moment. */
interface Sources {
  plan: TexturePlan
  photo: ImageBitmap
  planes: ImageBitmap[]
  frames: ImageBitmap[]
  /** What is pinned for this scene; `release` when it is disposed. */
  paths: string[]
}

async function sourcesFor(given: TexturePlan): Promise<Sources | null> {
  let plan = given
  if (plan.footage) {
    // Footage: ask the pre-pass for the shot's frames under the moment (main/render/momentFrames.ts), once and kept.
    try {
      plan = withFootageFrames(plan, await window.forge.momentFrames(plan.footage))
    } catch (err) {
      console.warn("A moment's footage frames could not be pulled", err)
      return null
    }
  }
  if (plan.pulled) {
    const paths = plan.pulled.files
    const frames = await Promise.all(paths.map((f) => pictureFor(f)))
    if (frames.length === 0 || frames.some((f) => f === null)) return null
    const loaded = frames as ImageBitmap[]
    pin(paths)
    return { plan, photo: loaded[0], planes: [], frames: loaded, paths }
  }
  const photo = await pictureFor(plan.path)
  if (!photo) return null
  const planeFiles = plan.planes?.map((p) => p.file) ?? []
  const planes = await Promise.all(planeFiles.map((f) => pictureFor(f)))
  // Planes that did not all load are no planes: the photo whole, as the render falls back.
  const usable = planes.every((p) => p !== null)
  const paths = [plan.path, ...(usable ? planeFiles : [])]
  pin(paths)
  return { plan: usable ? plan : { ...plan, planes: undefined }, photo, planes: usable ? (planes as ImageBitmap[]) : [], frames: [], paths }
}

/**
 * One shot's picture on one of the moment's frames, drawn onto a canvas the
 * frame's size — `shotPicture`'s rectangles, as pixels. The canvas is reused
 * and only redrawn when the rectangles change, so a still shot composes once.
 */
class Composed {
  readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private key = ''
  /** Which layer to draw: every one (a bridge's picture), or one plane of a depth push. */
  constructor(
    private readonly sources: Sources,
    private readonly width: number,
    private readonly height: number,
    private readonly fps: number,
    private readonly only: number | null = null
  ) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    this.ctx = this.canvas.getContext('2d')!
  }

  /** Draw the frame; true when the picture changed. */
  at(frame: number): boolean {
    const picture = shotPicture(this.sources.plan, frame, { width: this.width, height: this.height }, this.fps)
    const layers = this.only === null ? picture.layers : picture.layers.filter((l) => l.plane === this.only)
    // Footage: the shot's own frame under this one.
    const index = this.sources.frames.length > 0 ? footageFrameIndex(this.sources.plan, frame) : -1
    const key = JSON.stringify({ box: picture.box, layers, index })
    if (key === this.key) return false
    this.key = key
    const { ctx, width, height } = this
    ctx.clearRect(0, 0, width, height)
    const box = picture.box
    for (const layer of layers) {
      const source = index >= 0 ? this.sources.frames[index] : layer.plane === null ? this.sources.photo : this.sources.planes[layer.plane]
      if (!source) continue
      ctx.drawImage(
        source,
        layer.src.x * source.width, layer.src.y * source.height, layer.src.width * source.width, layer.src.height * source.height,
        box.x * width, box.y * height, box.width * width, box.height * height
      )
    }
    return true
  }
}

/* ------------------------------------------------------------------ GLSL */

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

/**
 * What every fragment shader shares. The textures are the composed frames,
 * so a shot's picture is wherever the shot shows it and the rest is clear;
 * `pick` outside the frame is nothing, which is how a slid or shrunk
 * picture keeps its edge. Frame coordinates run y-down, like the pictures
 * (uploaded unflipped). A sample is straight colour with alpha 0 or 1; an
 * AVERAGE of samples is coverage-weighted, which is already premultiplied.
 */
const COMMON = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uHasFrom;
uniform float uAspectY;

vec4 pick(sampler2D tex, vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  return texture2D(tex, uv);
}

/* Premultiplied "over". */
vec4 over(vec4 top, vec4 under) {
  return top + under * (1.0 - top.a);
}
`

/** Radial blur toward the centre with a scale pop: the outgoing grows away, the incoming pops in. */
const ZOOM_PUNCH = COMMON + /* glsl */ `
uniform float uMix;
uniform float uBlur;
uniform float uFromScale;
uniform float uToScale;

/* Averaged samples: premultiplied out. */
vec4 radial(sampler2D tex, vec2 uv, float scale, float blur) {
  vec2 c = vec2(0.5);
  vec2 d = uv - c;
  vec4 acc = vec4(0.0);
  const int N = 12;
  for (int i = 0; i < N; i++) {
    float k = float(i) / float(N - 1);
    acc += pick(tex, c + d * (1.0 - blur * 0.18 * k) / scale);
  }
  return acc / float(N);
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 a = uHasFrom > 0.5 ? radial(uFrom, uv, uFromScale, uBlur) : vec4(0.0);
  vec4 b = radial(uTo, uv, uToScale, uBlur);
  gl_FragColor = mix(a, b, uMix);
}`

/** Directional blur along the whip's axis; the incoming slides in over the outgoing sliding out. */
const WHIP_BLUR = COMMON + /* glsl */ `
uniform float uBlur;
uniform float uFromOffset;
uniform float uToOffset;
uniform vec2 uAxis;

/* Averaged samples: premultiplied out. */
vec4 smear(sampler2D tex, vec2 uv, float offset, float blur) {
  vec4 acc = vec4(0.0);
  const int N = 16;
  for (int i = 0; i < N; i++) {
    float k = float(i) / float(N - 1) - 0.5;
    acc += pick(tex, uv - uAxis * offset + uAxis * (k * blur * 0.35));
  }
  return acc / float(N);
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 a = uHasFrom > 0.5 ? smear(uFrom, uv, uFromOffset, uBlur) : vec4(0.0);
  vec4 b = smear(uTo, uv, uToOffset, uBlur);
  gl_FragColor = over(b, a);
}`

/** A hard cut under two drifting soft lights and grain, additive, peaking on the cut. */
const LIGHT_BURN = COMMON + /* glsl */ `
uniform float uMix;
uniform float uGlow;
uniform float uGrain;
uniform float uSeed;
uniform vec4 uLightA;
uniform vec4 uLightB;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 leak(vec4 light, vec2 uv) {
  vec2 d = (uv - light.xy) * vec2(1.0, uAspectY);
  float r = length(d) / light.z;
  float s = smoothstep(1.0, 0.0, r);
  s *= s;
  vec3 warm = mix(vec3(1.0, 0.55, 0.25), vec3(1.0, 0.88, 0.62), light.w);
  return warm * s;
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 base = (uHasFrom > 0.5 && uMix < 0.5) ? pick(uFrom, uv) : pick(uTo, uv);
  vec3 light = (leak(uLightA, uv) + leak(uLightB, uv)) * uGlow;
  float grain = (hash(uv * 977.0 + uSeed) - 0.5) * uGrain;
  /* Valid premultiplied colour: the light lights the bars too, and no channel exceeds the alpha. */
  float a = clamp(max(base.a, max(light.r, max(light.g, light.b))), 0.0, 1.0);
  vec3 rgb = min(base.rgb * base.a + light + grain * base.a, vec3(a));
  gl_FragColor = vec4(max(rgb, vec3(0.0)), a);
}`

/** One picture — or one depth plane — scaled about the centre: the dolly. */
const DEPTH_PUSH = COMMON + /* glsl */ `
uniform float uScale;

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 c = vec2(0.5);
  vec4 s = pick(uTo, c + (uv - c) / uScale);
  gl_FragColor = vec4(s.rgb * s.a, s.a);
}`

/* ---------------------------------------------------------------- scene */

function textureOf(three: Three, canvas: HTMLCanvasElement): import('three').CanvasTexture {
  const texture = new three.CanvasTexture(canvas)
  // Raw bytes in, raw bytes out: the frame at t = 1 has to BE the incoming picture.
  texture.colorSpace = three.NoColorSpace
  // Rows as the picture has them, so the y-down frame coordinates apply unchanged.
  texture.flipY = false
  texture.premultiplyAlpha = false
  texture.generateMipmaps = false
  texture.minFilter = three.LinearFilter
  texture.magFilter = three.LinearFilter
  texture.wrapS = three.ClampToEdgeWrapping
  texture.wrapT = three.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

interface Built {
  draw: (frame: number) => void
  dispose: () => void
}

/** Build the scene once and hand back a function that draws it at a frame. */
async function scene(
  three: Three,
  gl: import('three').WebGLRenderer,
  spec: MomentSpec,
  textures: MomentTextures,
  width: number,
  height: number,
  total: number,
  fps: number
): Promise<Built | null> {
  const to = await sourcesFor(textures.to)
  if (!to) return null
  const from = textures.from ? await sourcesFor(textures.from) : null
  if (textures.from && !from) {
    // A bridge with no outgoing picture would cut to the incoming early, or ghost it in: not drawn at all.
    unpin(to.paths)
    return null
  }
  const disposables: { dispose: () => void }[] = [{ dispose: () => unpin([...to.paths, ...(from?.paths ?? [])]) }]

  const root = new three.Scene()
  const camera = new three.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const geometry = new three.PlaneGeometry(2, 2)
  disposables.push(geometry)

  const material = (fragmentShader: string, extra: Record<string, import('three').IUniform>, blend: boolean): import('three').ShaderMaterial => {
    const m = new three.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader,
      uniforms: { uFrom: { value: null }, uTo: { value: null }, uHasFrom: { value: 0 }, uAspectY: { value: height / Math.max(1, width) }, ...extra },
      depthTest: false,
      depthWrite: false,
      transparent: true
    })
    if (blend) {
      // The shaders write premultiplied colour; a plane over a plane is "over" in those terms.
      m.blending = three.CustomBlending
      m.blendEquation = three.AddEquation
      m.blendSrc = three.OneFactor
      m.blendDst = three.OneMinusSrcAlphaFactor
      m.blendSrcAlpha = three.OneFactor
      m.blendDstAlpha = three.OneMinusSrcAlphaFactor
    } else {
      m.blending = three.NoBlending
    }
    disposables.push(m)
    return m
  }

  /* The one renderer is shared, and another caller may have resized it between two of our frames. */
  const sized = (): void => {
    if (gl.domElement.width !== width || gl.domElement.height !== height) gl.setSize(width, height, false)
  }

  const dispose = (): void => {
    for (const d of disposables) d.dispose()
  }

  if (spec.kind === 'depth-push' || spec.kind === 'kinetic-type') {
    /*
     * The dolly: each depth plane on its own quad, far to near, the nearer
     * scaled the more — the parallax of a camera moving into the picture. A
     * photo without planes is pushed whole. The push does not follow the
     * shot's own move, so each plane composes once (frame 0) and holds.
     */
    const planes = to.plan.planes && to.planes.length >= 2 ? to.plan.planes : null
    const passes = (planes ? planes.map((p, i) => ({ depth: p.depth, only: i as number | null })) : [{ depth: 1, only: null }]).map((p, i) => {
      const composed = new Composed(to, width, height, fps, p.only)
      composed.at(0)
      const texture = textureOf(three, composed.canvas)
      disposables.push(texture)
      const m = material(DEPTH_PUSH, { uScale: { value: 1 } }, planes !== null)
      m.uniforms.uTo.value = texture
      const mesh = new three.Mesh(geometry, m)
      mesh.renderOrder = i
      root.add(mesh)
      return { depth: p.depth, material: m }
    })
    return {
      draw: (frame) => {
        const params = momentParams(spec, momentT(frame, total))
        if (params.kind !== 'depth-push') return
        for (const pass of passes) pass.material.uniforms.uScale.value = planes ? params.planeScale(pass.depth) : params.scale
        sized()
        gl.render(root, camera)
      },
      dispose
    }
  }

  const toComposed = new Composed(to, width, height, fps)
  const fromComposed = from ? new Composed(from, width, height, fps) : null
  toComposed.at(0)
  fromComposed?.at(0)
  const toTexture = textureOf(three, toComposed.canvas)
  const fromTexture = fromComposed ? textureOf(three, fromComposed.canvas) : toTexture
  disposables.push(toTexture)
  if (fromComposed) disposables.push(fromTexture)

  const extra: Record<string, import('three').IUniform> =
    spec.kind === 'zoom-punch'
      ? { uMix: { value: 0 }, uBlur: { value: 0 }, uFromScale: { value: 1 }, uToScale: { value: 1 } }
      : spec.kind === 'whip-blur'
        ? { uBlur: { value: 0 }, uFromOffset: { value: 0 }, uToOffset: { value: 1 }, uAxis: { value: new three.Vector2(1, 0) } }
        : {
            uMix: { value: 0 },
            uGlow: { value: 0 },
            uGrain: { value: 0 },
            uSeed: { value: (spec.seed % 1000) / 7 },
            uLightA: { value: new three.Vector4(0.5, 0.5, 0.5, 1) },
            uLightB: { value: new three.Vector4(0.5, 0.5, 0.5, 1) }
          }
  const shader = spec.kind === 'zoom-punch' ? ZOOM_PUNCH : spec.kind === 'whip-blur' ? WHIP_BLUR : LIGHT_BURN
  const m = material(shader, extra, false)
  m.uniforms.uFrom.value = fromTexture
  m.uniforms.uTo.value = toTexture
  m.uniforms.uHasFrom.value = fromComposed ? 1 : 0
  root.add(new three.Mesh(geometry, m))

  return {
    draw: (frame) => {
      // Each shot's picture as it is on THIS frame — its move runs on under the moment.
      if (toComposed.at(frame)) toTexture.needsUpdate = true
      if (fromComposed?.at(frame)) fromTexture.needsUpdate = true
      const params = momentParams(spec, momentT(frame, total))
      const u = m.uniforms
      if (params.kind === 'zoom-punch') {
        u.uMix.value = params.mix
        u.uBlur.value = params.blur
        u.uFromScale.value = params.fromScale
        u.uToScale.value = params.toScale
      } else if (params.kind === 'whip-blur') {
        u.uBlur.value = params.blur
        u.uFromOffset.value = params.fromOffset
        u.uToOffset.value = params.toOffset
        ;(u.uAxis.value as import('three').Vector2).set(params.axis.x, params.axis.y)
      } else if (params.kind === 'light-burn') {
        u.uMix.value = params.mix
        u.uGlow.value = params.glow
        u.uGrain.value = params.grain
        const [a, b] = params.lights
        ;(u.uLightA.value as import('three').Vector4).set(a.x, a.y, a.radius, a.warmth)
        ;(u.uLightB.value as import('three').Vector4).set(b.x, b.y, b.radius, b.warmth)
      }
      sized()
      gl.render(root, camera)
    },
    dispose
  }
}

/* -------------------------------------------------------------- preview */

const previews = new Map<string, { signature: string; canvas: HTMLCanvasElement; built: Built | null }>()

/** How many moment frames have been painted — each one's stamp (grade.ts canvasContentKey). */
let paints = 0

/**
 * The live picture of a moment, copied onto a 2D canvas — exactly as the ring
 * is (carouselCanvas.ts says why a copy). Null until three.js and the pictures
 * have loaded, and asks for a repaint when they have. Once built, the frame is
 * drawn HERE, before the canvas is handed back: the compositor draws it in the
 * same pass, so a paused or stepped frame is the frame asked for and not the
 * one before.
 */
export function momentPreviewCanvas(
  clipId: string,
  spec: MomentSpec,
  textures: MomentTextures,
  width: number,
  height: number,
  clock: { frame: number; total: number; fps: number },
  onReady?: () => void
): HTMLCanvasElement | null {
  if (width < 2 || height < 2) return null
  const signature = `${width}x${height}|${clock.total}|${clock.fps}|${JSON.stringify(spec)}|${JSON.stringify(textures)}`

  const existing = previews.get(clipId)
  if (!existing || existing.signature !== signature) {
    existing?.built?.dispose()
    const canvas = existing?.canvas ?? document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const entry = { signature, canvas, built: null as Built | null }
    previews.set(clipId, entry)
    void (async () => {
      const { three, renderer: gl } = await sharedRenderer(width, height)
      // The frames that move; past them the picture holds (movingFrames), as the export holds it.
      const built = await scene(three, gl, spec, textures, width, height, movingFrames(spec, clock.fps, clock.total), clock.fps)
      if (previews.get(clipId) !== entry) {
        built?.dispose()
        return
      }
      entry.built = built
      onReady?.()
    })()
    return null
  }

  if (!existing.built) return null
  const shared = sharedRendererSync(width, height)
  if (!shared) return null
  existing.built.draw(clock.frame)
  const ctx = existing.canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(shared.canvas, 0, 0, width, height)
  existing.canvas.dataset.forgeRev = String(++paints)
  return existing.canvas
}

export function forgetMomentPreview(clipId: string): void {
  previews.get(clipId)?.built?.dispose()
  previews.delete(clipId)
}

/* ----------------------------------------------------------------- bake */

/**
 * Bake a moment as a numbered frame sequence: one per frame of the clip for a
 * bridge, so `tpad` has nothing to hold; for a depth push only the frames
 * that move, and the export holds the last for the rest of the shot
 * (`movingFrames`).
 *
 * Guarded as the ring and the paper bakes are: two bakes of one clip
 * overlapping means the older writes into the directory the newer cleared.
 */
export async function bakeMomentSequence(
  spec: MomentSpec,
  clipId: string,
  textures: MomentTextures,
  width: number,
  height: number,
  frames: number,
  fps: number
): Promise<{ pattern: string; frames: number } | null> {
  const total = movingFrames(spec, fps, Math.max(1, frames))
  const { three, renderer: r, canvas: gl } = await sharedRenderer(width, height)
  const built = await scene(three, r, spec, textures, width, height, total, fps)
  if (!built) return null

  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d')
  if (!ctx) {
    built.dispose()
    return null
  }

  let pattern = ''
  const token = beginBake(clipId)
  try {
    await window.forge.clearTitleFrames(clipId)
    if (isSuperseded(clipId, token)) return null
    for (let frame = 0; frame < total; frame++) {
      built.draw(frame)
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(gl, 0, 0, width, height)
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Could not encode a moment frame')
      const buffer = await blob.arrayBuffer()
      if (isSuperseded(clipId, token)) return null
      pattern = await window.forge.writeTitleFrame(clipId, frame, buffer)
    }
    return { pattern, frames: total }
  } finally {
    endBake(clipId)
    built.dispose()
  }
}

/**
 * Frames of a moment, each drawn into a canvas of its own — for the harness
 * check (`window.__forgeMomentCheck`) and the eval's drawing of a directed
 * ad's moments, neither of which has a timeline to preview. `total` is the
 * clip's length; the frames asked for are numbered within it.
 */
export async function momentFrameCanvases(
  spec: MomentSpec,
  textures: MomentTextures,
  width: number,
  height: number,
  total: number,
  fps: number,
  frames: number[]
): Promise<HTMLCanvasElement[] | null> {
  const { three, renderer: r, canvas: gl } = await sharedRenderer(width, height)
  const built = await scene(three, r, spec, textures, width, height, movingFrames(spec, fps, total), fps)
  if (!built) return null
  try {
    return frames.map((frame) => {
      built.draw(frame)
      const out = document.createElement('canvas')
      out.width = width
      out.height = height
      out.getContext('2d')?.drawImage(gl, 0, 0, width, height)
      return out
    })
  } finally {
    built.dispose()
  }
}
