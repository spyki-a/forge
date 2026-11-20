/**
 * `window.__forgeGraphicCheck({ readback: ['drawImage', 'readPixels', 'readRenderTargetPixelsAsync'], frames: 120 })`
 * (docs/CLIPS.md §6.15's M12, §6.11's `readback` row; phase 3's piece 6): the
 * three ways of getting a compositor frame out, each timed over `frames`
 * frames, on a real 2.5D frame at 1080×1920: specs.json's English counter as
 * its clip's hero under `neon` (a 24° tilt settling, its value glowing), its
 * frames off flat (route three, the camera and the glow) taken in turn.
 *
 * - `drawImage`: the shared WebGL canvas drawn into the bake's 2D canvas, as
 *   `paintFrame` does today (graphicCanvas.ts);
 * - `readPixels`: `gl.readPixels` into a `Uint8Array` (premultiplied, rows
 *   bottom up), made straight and top-down (`straightTopDown`) and put into
 *   the 2D canvas;
 * - `readRenderTargetPixelsAsync`: the frame rendered into a render target
 *   (`CompositorProbe.target`, the harness's alone), read by three's
 *   `readRenderTargetPixelsAsync`, then as `readPixels`.
 *
 * Each frame is painted first (not timed), then timed to straight pixels in
 * the 2D canvas (one pixel read back after, so the copy has landed), then on
 * to `toBlob('image/png')`, the canvas the bake encodes. The GPU's own paint
 * finishes inside whichever read waits on it first, the same for every
 * route. ms at p50 and p95 per route; and, on one frame, each route's PNG
 * decoded against its own GL frame's bytes made straight (`straightAgainst`):
 * whether it keeps straight alpha through to the PNG. `readbackVerdict` names
 * the fastest at p50 that keeps it and what the rule chooses (`READBACK_BAR`:
 * drawImage stays unless another is at least twice as fast). It measures and
 * reports; the bake's route is the plan owner's to change after the
 * Surface's reading.
 *
 * Run it with the window visible and untouched (the encode timings follow
 * the frame cadence, graphicCheck.ts's note), on the harness page or in the
 * development app; M12's row asks for the development app on the Mac and the
 * Surface.
 */

import type { DrawList } from '@shared/graphics/items'
import { drawListAt } from '@shared/graphics/drawList'
import { cameraIsFlat } from '@shared/graphics/compositor'
import { graphicMovingFrames } from '@shared/graphics/frame'
import { resolveGraphicStyle } from '@shared/graphics/style'
import type { GraphicSpec } from '@shared/graphics/template'
import { facesFor } from '@shared/render/textPaint'
import { useCatalog } from '../catalog'
import { loadThree, sharedRendererSync } from '../threeShared'
import { createCompositor, paintDrawList3d, resetCompositorSession, type Compositor } from '../graphicCompositor'
import { graphicMeasure } from '../graphicCanvas'
import { readbackFrames, readbackRoutes, readbackVerdict, straightAgainst, straightTopDown, type ReadbackRoute, type ReadbackRow, type ReadbackVerdict } from './phase3Measure'

export interface ReadbackResult {
  size: { width: number; height: number }
  fps: number
  /** The case: its fixture, move and style, and the frames off flat taken in turn. */
  case: { fixture: string; style: string; frames: number[] }
  /** Frames timed per route. */
  timed: number
  rows: ReadbackRow[]
  verdict: ReadbackVerdict
  note: string
}

const W = 1080
const H = 1920
const FPS = 30
/** The case read: the counter's English fixture as its clip's hero under neon (depth tilt, its value glowing). */
export const READBACK_FIXTURE = 'counter-en'
export const READBACK_STYLE = 'neon'

function canvas2d(width = W, height = H): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  if (!ctx) throw new Error('readback check: no 2D context')
  return { canvas, ctx }
}

const freshLayer = (width: number, height: number): CanvasRenderingContext2D => canvas2d(width, height).ctx

function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('readback check: a canvas did not encode'))), 'image/png'))
}

/** A PNG's straight RGBA, decoded with no colour conversion and no premultiply (as graphicCheck.ts `decodePng`). */
async function decodePng(blob: Blob): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const { ctx } = canvas2d(bitmap.width, bitmap.height)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return ctx.getImageData(0, 0, W, H).data
}

export async function checkReadback(
  fixtures: readonly { id: string; spec: GraphicSpec }[],
  asked: unknown,
  framesAsked: unknown,
  frames: { canvas: (label: string, canvas: HTMLCanvasElement) => void },
  summary: string[],
  notes: string[]
): Promise<ReadbackResult> {
  const routes = readbackRoutes(asked)
  const count = readbackFrames(framesAsked)
  const fixture = fixtures.find((f) => f.id === READBACK_FIXTURE)
  if (!fixture) throw new Error(`readback check: specs.json has no fixture ${READBACK_FIXTURE}`)
  const { depth: _d, hero: _h, ...plain } = fixture.spec
  const spec: GraphicSpec = { ...plain, depth: 'tilt', hero: true }
  const style = resolveGraphicStyle(READBACK_STYLE)
  const measure = graphicMeasure()
  const size = { width: W, height: H }
  const total = Math.max(1, Math.round(spec.seconds * FPS))
  const moving = graphicMovingFrames(spec, style, FPS, total)
  // Faces first, as every check that paints text loads them.
  const { ensureFont } = useCatalog.getState()
  const faces = new Set<string>([style.font])
  for (const item of drawListAt(spec, style, moving - 1, FPS, size, measure, {}).items) if (item.kind === 'text') for (const face of facesFor(item.look.font, item.text)) faces.add(face)
  await Promise.all([...faces].map((face) => ensureFont(face)))
  const all: DrawList[] = Array.from({ length: moving }, (_, f) => drawListAt(spec, style, f, FPS, size, measure, {}))
  const offFlat = all.map((l, f) => ({ l, f })).filter(({ l }) => !cameraIsFlat(l.camera) && (l.glow?.length ?? 0) > 0)
  if (offFlat.length === 0) throw new Error('readback check: the hero counter has no frame off flat with its glow')

  resetCompositorSession()
  const compositor: Compositor | null = await createCompositor(W, H)
  if (!compositor) throw new Error('readback check: createCompositor gave null on this page: WebGL did not start')
  const shared = sharedRendererSync(W, H)
  if (!shared) throw new Error('readback check: no shared renderer')
  const { renderer } = shared
  const gl = renderer.getContext()
  const three = await loadThree()
  // No multisampling: three resolves and then invalidates a multisampled target's colour, so the glow's add pass (a second render into it) would land on nothing.
  const target = new three.WebGLRenderTarget(W, H, { depthBuffer: false })
  const out = canvas2d()
  const options = { layer: freshLayer }
  const bytes = new Uint8Array(W * H * 4)

  /** One frame through `route`: painted (untimed), read to straight pixels in the bake's 2D canvas (timed), then encoded (timed). Returns the GL bytes it read where it read any. */
  const once = async (route: ReadbackRoute, list: DrawList): Promise<{ readMs: number; pngMs: number; blob: Blob; gl: Uint8Array | null }> => {
    if (route === 'readRenderTargetPixelsAsync') paintDrawList3d(list, compositor, options, { target })
    else paintDrawList3d(list, compositor, options)
    const t0 = performance.now()
    let read: Uint8Array | null = null
    if (route === 'drawImage') {
      out.ctx.clearRect(0, 0, W, H)
      out.ctx.drawImage(renderer.domElement, 0, 0)
    } else {
      if (route === 'readPixels') gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
      else await renderer.readRenderTargetPixelsAsync(target, 0, 0, W, H, bytes)
      read = bytes
      out.ctx.putImageData(new ImageData(straightTopDown(bytes, W, H), W, H), 0, 0)
    }
    out.ctx.getImageData(0, 0, 1, 1)
    const t1 = performance.now()
    const blob = await pngBlob(out.canvas)
    return { readMs: t1 - t0, pngMs: performance.now() - t0, blob, gl: read }
  }

  const rows: ReadbackRow[] = []
  const checkFrame = offFlat[Math.floor(offFlat.length / 2)]
  try {
    for (const route of routes) {
      const row: ReadbackRow = { route, error: null, readMs: [], pngMs: [], straight: null }
      try {
        // The straight-alpha reading on one frame: the route's PNG against the very GL frame it read (drawImage's frame read by readPixels before it is copied).
        let frameBytes: Uint8Array
        let blob: Blob
        if (route === 'drawImage') {
          paintDrawList3d(checkFrame.l, compositor, options)
          gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
          frameBytes = bytes.slice()
          out.ctx.clearRect(0, 0, W, H)
          out.ctx.drawImage(renderer.domElement, 0, 0)
          blob = await pngBlob(out.canvas)
        } else {
          const r = await once(route, checkFrame.l)
          frameBytes = r.gl!.slice()
          blob = r.blob
        }
        const decoded = await decodePng(blob)
        row.straight = straightAgainst(straightTopDown(frameBytes, W, H), decoded)
        if (route !== 'drawImage') {
          const picture = canvas2d()
          picture.ctx.putImageData(new ImageData(new Uint8ClampedArray(decoded), W, H), 0, 0)
          frames.canvas(`readback ${route}: frame ${checkFrame.f}'s PNG decoded`, picture.canvas)
        }
        for (let i = 0; i < count; i++) {
          const r = await once(route, offFlat[i % offFlat.length].l)
          row.readMs.push(r.readMs)
          row.pngMs.push(r.pngMs)
        }
      } catch (error) {
        row.error = error instanceof Error ? error.message : String(error)
      }
      rows.push(row)
    }
  } finally {
    target.dispose()
    compositor.dispose()
  }
  const verdict = readbackVerdict(rows)
  const ms = (n: number): string => (Number.isFinite(n) ? n.toFixed(2) : 'n/a')
  for (const r of verdict.rows) {
    const row = rows.find((x) => x.route === r.route)!
    const s = row.straight
    summary.push(
      `readback ${r.route}: to pixels p50 ${ms(r.p50)}, p95 ${ms(r.p95)} ms; to PNG p50 ${ms(r.pngP50)}, p95 ${ms(r.pngP95)} ms, over ${row.readMs.length} frames at ${W}x${H}; ` +
        `its PNG against its frame alpha off by ${s ? s.alphaMax : 'n/a'}, colour by ${s ? s.colourMax : 'n/a'} over ${s ? s.colourPixels : 0} pixels (keeps straight alpha: ${r.keeps ? 'yes' : 'NO'})`
    )
  }
  for (const r of rows) if (r.error !== null) summary.push(`readback ${r.route}: not run, ${r.error}`)
  summary.push(
    `readback verdict: fastest at p50 that keeps straight alpha ${verdict.fastest ?? 'none'}; by the rule (drawImage unless another is at least twice as fast) ${verdict.chosen ?? 'none'}` +
      (verdict.failures.length ? `; ${verdict.failures.join('; ')}` : '')
  )
  notes.push('readback: M12 measures and reports; the bake keeps drawImage (paintFrame) until the plan owner reads the Surface\'s figures (§6.15).')
  return {
    size: { width: W, height: H },
    fps: FPS,
    case: { fixture: READBACK_FIXTURE, style: READBACK_STYLE, frames: offFlat.map((x) => x.f) },
    timed: count,
    rows,
    verdict,
    note:
      'M12 (§6.15): the hero counter (counter-en, depth tilt, its value glowing under neon) at 1080x1920, its frames off flat through paintDrawList3d in turn; each route timed from the painted frame to straight pixels in the 2D canvas the bake encodes (one pixel read after), ' +
      'then to toBlob PNG. drawImage: the WebGL canvas drawn in. readPixels: into a Uint8Array, made straight and top-down, put in. readRenderTargetPixelsAsync: the frame rendered into a render target with no multisampling (CompositorProbe.target), read, then as readPixels. ' +
      'Straight alpha: each route\'s PNG decoded against the GL frame it read, made straight (READBACK_BAR). The verdict names the fastest that keeps it and the rule\'s choice; nothing changes in the bake.'
  }
}
