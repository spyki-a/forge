import { mediaUrl } from '@shared/mediaUrl'

/**
 * What every three.js drawing in the app shares: the library, loaded once and
 * only when something needs it; ONE renderer; and photographs as textures,
 * downscaled first. The card ring (carouselCanvas.ts) and the moments
 * (momentCanvas.ts) both draw through this.
 */

/**
 * three.js is loaded the first time something is drawn with it, and never
 * otherwise.
 *
 * 129 KB gzipped is modest but not nothing, and the overwhelming majority of
 * projects will never contain a card ring or a directed ad. A static import
 * would put it in the main bundle for all of them.
 */
export type Three = typeof import('three')
let threePromise: Promise<Three> | null = null
export function loadThree(): Promise<Three> {
  if (!threePromise) threePromise = import('three')
  return threePromise
}

/**
 * ONE renderer, reused for every ring, every moment and every frame.
 *
 * A browser allows a small number of live WebGL contexts — around sixteen —
 * and silently drops the oldest when you pass it. A renderer per clip, or per
 * frame of a bake, exhausts that in seconds and the symptom is earlier rings
 * going black for no visible reason. So: one context, resized as needed.
 */
let shared: { renderer: import('three').WebGLRenderer; canvas: HTMLCanvasElement } | null = null

export async function sharedRenderer(
  width: number,
  height: number
): Promise<{ three: Three; renderer: import('three').WebGLRenderer; canvas: HTMLCanvasElement }> {
  const three = await loadThree()
  if (!shared) {
    const canvas = document.createElement('canvas')
    const r = new three.WebGLRenderer({ canvas, alpha: true, antialias: true })
    r.setClearColor(0x000000, 0)
    shared = { renderer: r, canvas }
  }
  if (shared.canvas.width !== width || shared.canvas.height !== height) {
    shared.renderer.setSize(width, height, false)
  }
  return { three, renderer: shared.renderer, canvas: shared.canvas }
}

/**
 * The renderer without waiting, once something has loaded it — for a draw that
 * has to land in the same frame as the compositor's, not a microtask later.
 * Null until the first `sharedRenderer` call has resolved.
 */
export function sharedRendererSync(width: number, height: number): { renderer: import('three').WebGLRenderer; canvas: HTMLCanvasElement } | null {
  if (!shared) return null
  if (shared.canvas.width !== width || shared.canvas.height !== height) {
    shared.renderer.setSize(width, height, false)
  }
  return shared
}

/**
 * Photographs as textures, downscaled first.
 *
 * A 4000x3000 photograph as an RGBA texture is ~48 MB on the GPU, and twenty
 * of them is nearly a gigabyte — which is how a card ring takes a laptop down.
 * A card occupies a few hundred pixels on screen, so anything past `maxEdge`
 * is memory spent on detail that cannot be seen. A moment fills the frame, so
 * it asks for more (momentCanvas.ts MOMENT_TEXTURE_EDGE) — the cache is keyed
 * by the size asked for as well as the file.
 */
export const CAROUSEL_TEXTURE_EDGE = 640
const textures = new Map<string, HTMLCanvasElement>()

export async function textureFor(path: string, maxEdge = CAROUSEL_TEXTURE_EDGE): Promise<HTMLCanvasElement | null> {
  const key = `${maxEdge}|${path}`
  const existing = textures.get(key)
  if (existing) return existing

  const image = new Image()
  image.crossOrigin = 'anonymous'
  const loaded = await new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    image.src = mediaUrl(path)
  })
  if (!loaded || image.naturalWidth === 0) return null

  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  textures.set(key, canvas)
  return canvas
}
