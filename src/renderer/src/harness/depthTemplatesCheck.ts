/**
 * The depth readings of `window.__forgeGraphicCheck({ parity: true, templates: [...] })`
 * (docs/CLIPS.md §9, "Measure in the harness": "flat and with each depth";
 * step 6's 3D exit; §6.16; the 3D templates' piece 3), on this page's own
 * WebGL. graphicCheck.ts runs it after the `templates` row and adds the flat
 * preview against the export; the bars and the verdict are
 * `depthTemplatesMeasure.ts`.
 *
 * For every specs.json fixture of each asked depth template, under `clean`,
 * at 540×960 and 960×540 (`DEPTH_TEMPLATE_SHAPES`), each of the four depths:
 *
 * - the list half (`depthListReading`): the last moving frame's camera
 *   exactly flat, some frame off flat and not all, every text item of every
 *   moving frame the flat twin's, the settled list the twin's own;
 * - the settled frame through `paintDrawList3d` against the twin by painter
 *   A: 0 (route one); the first frame where the twin has ink, against the
 *   twin's: at least `DEPTH_BAR.firstMinMax` levels somewhere (a dead branch
 *   cannot pass);
 * - WebGL pretended missing (`resetCompositorSession({ missing: true })`):
 *   `createCompositor` null, the harness frames' one `WEBGL_MISSING_NOTE`,
 *   the first frame off flat drawn by `graphicFrameCanvases` equal to painter
 *   A's own picture of that list, the settled frame equal to the twin's; and
 *   once per fixture and shape, the Preview marking its clip drawn flat.
 *
 * A contact sheet per fixture and shape: each depth's first inked frame and
 * its settled frame. No hero is read: step 6's three are never a hero
 * (templates/depth.ts `HERO_GLOW_ITEM`, graphics/apply.ts `HERO_TEMPLATES`).
 */

import type { DrawList, GraphicTargets } from '@shared/graphics/items'
import { drawListAt } from '@shared/graphics/drawList'
import { paintDrawList2d } from '@shared/graphics/paint'
import { resolveGraphicStyle, type GraphicStyle } from '@shared/graphics/style'
import type { GraphicSpec } from '@shared/graphics/template'
import { DEPTH_MOVES, type DepthMove } from '@shared/graphics/templates/depth'
import { facesFor } from '@shared/render/textPaint'
import { useCatalog } from '../catalog'
import { createCompositor, paintDrawList3d, resetCompositorSession, type Compositor } from '../graphicCompositor'
import { forgetGraphicPreview, graphicDrawnFlat, graphicFrameCanvases, graphicMeasure, graphicPreviewCanvas, takeGraphicBakeNotes } from '../graphicCanvas'
import { diffChannels } from './compositorMeasure'
import { DEPTH_TEMPLATE_SHAPES, depthListReading, type DepthTemplateCase, type DepthTemplateMoveReading } from './depthTemplatesMeasure'

const FPS = 30
/** The style the depths are read under: the depth option's (`DEPTH_CHECK_STYLE`). */
export const DEPTH_TEMPLATES_STYLE = 'clean'

type Size = { width: number; height: number }

function canvas2d(size: Size): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('parity templates: no 2D context')
  return { canvas, ctx }
}

const pixelsOf = (canvas: HTMLCanvasElement): Uint8ClampedArray => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data

/** A canvas read through a copy (never the canvas itself: graphicCheck.ts `copiedPixels`). */
function copied(source: HTMLCanvasElement): Uint8ClampedArray {
  const { ctx } = canvas2d({ width: source.width, height: source.height })
  ctx.drawImage(source, 0, 0)
  return ctx.getImageData(0, 0, source.width, source.height).data
}

function painterA(l: DrawList, size: Size): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d(size)
  paintDrawList2d(ctx, l, { layer: (w, h) => canvas2d({ width: w, height: h }).ctx })
  return canvas
}

/** Painter B, copied out at once as the seam copies it (graphicCanvas.ts `paintFrame`). */
function painterB(l: DrawList, compositor: Compositor, size: Size): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d(size)
  ctx.drawImage(paintDrawList3d(l, compositor, { layer: (w, h) => canvas2d({ width: w, height: h }).ctx }), 0, 0)
  return canvas
}

const hasInk = (data: Uint8ClampedArray): boolean => {
  for (let p = 3; p < data.length; p += 4) if (data[p] > 0) return true
  return false
}

const noTargets = (): GraphicTargets => ({})

/** One depth of one fixture at one shape, with WebGL working (`compositor`); the WebGL-missing half is read after, by `readMissing`. */
function readMove(base: GraphicSpec, move: DepthMove, style: GraphicStyle, size: Size, compositor: Compositor, sheet: HTMLCanvasElement[]): Omit<DepthTemplateMoveReading, 'missing'> {
  const { depth: _d, hero: _h, ...plain } = base
  const spec: GraphicSpec = { ...plain, depth: move }
  const measure = graphicMeasure()
  const list = depthListReading(spec, style, FPS, size, measure)
  const last = Math.max(0, list.moving - 1)
  const settledTwin = pixelsOf(painterA(drawListAt(plain, style, last, FPS, size, measure, {}), size))
  const settledPicture = painterB(drawListAt(spec, style, last, FPS, size, measure, {}), compositor, size)
  const settled = diffChannels(settledTwin, pixelsOf(settledPicture))
  let firstFrame = -1
  let first = diffChannels(settledTwin, settledTwin)
  for (let f = 0; f < list.moving; f++) {
    const twin = pixelsOf(painterA(drawListAt(plain, style, f, FPS, size, measure, {}), size))
    if (!hasInk(twin)) continue
    firstFrame = f
    const picture = painterB(drawListAt(spec, style, f, FPS, size, measure, {}), compositor, size)
    first = diffChannels(twin, pixelsOf(picture))
    sheet.push(picture)
    break
  }
  sheet.push(settledPicture)
  return { ...list, move, settled, firstFrame, first }
}

/** WebGL pretended missing for one depth: the session is reset to missing by the caller. */
async function readMissing(base: GraphicSpec, move: DepthMove, style: GraphicStyle, size: Size, firstOffFlat: number, moving: number): Promise<DepthTemplateMoveReading['missing']> {
  const { depth: _d, hero: _h, ...plain } = base
  const spec: GraphicSpec = { ...plain, depth: move }
  const measure = graphicMeasure()
  const total = Math.max(1, Math.round(spec.seconds * FPS))
  const frame = Math.max(0, firstOffFlat)
  const last = Math.max(0, moving - 1)
  takeGraphicBakeNotes()
  const nothing = await createCompositor(size.width, size.height)
  const [moved, settledFrame] = await graphicFrameCanvases(spec, style, size.width, size.height, total, FPS, [frame, last], noTargets)
  const notes = takeGraphicBakeNotes()
  nothing?.dispose()
  return {
    compositor: nothing ? 'a compositor' : 'null',
    notes,
    frame,
    againstPainterA: diffChannels(pixelsOf(painterA(drawListAt(spec, style, frame, FPS, size, measure, {}), size)), copied(moved)),
    settledAgainstTwin: diffChannels(pixelsOf(painterA(drawListAt(plain, style, last, FPS, size, measure, {}), size)), copied(settledFrame))
  }
}

/** The frames side by side over a dark grey, at half the size. */
function contactSheet(pictures: readonly HTMLCanvasElement[], size: Size): HTMLCanvasElement {
  const w = Math.round(size.width / 2)
  const h = Math.round(size.height / 2)
  const { canvas, ctx } = canvas2d({ width: Math.max(1, w * pictures.length), height: h })
  ctx.fillStyle = '#2a2a2a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  pictures.forEach((p, i) => ctx.drawImage(p, i * w, 0, w, h))
  return canvas
}

export async function checkDepthTemplates(
  fixtures: readonly { id: string; spec: GraphicSpec }[],
  frames: { canvas: (label: string, canvas: HTMLCanvasElement) => void },
  summary: string[]
): Promise<DepthTemplateCase[]> {
  const style = resolveGraphicStyle(DEPTH_TEMPLATES_STYLE)
  // Every face the lists draw, loaded before either painter paints.
  const { ensureFont } = useCatalog.getState()
  const measure = graphicMeasure()
  const faces = new Set<string>([style.font])
  for (const f of fixtures) {
    for (const size of DEPTH_TEMPLATE_SHAPES) {
      const settled = Math.max(0, Math.round(Math.max(0, ...f.spec.beats) * FPS) + 1)
      for (const item of drawListAt(f.spec, style, settled, FPS, size, measure, {}).items) if (item.kind === 'text') for (const face of facesFor(item.look.font, item.text)) faces.add(face)
    }
  }
  await Promise.all([...faces].map((face) => ensureFont(face)))

  const cases: DepthTemplateCase[] = []
  for (const shape of DEPTH_TEMPLATE_SHAPES) {
    const size = { width: shape.width, height: shape.height }
    const readings = new Map<string, Omit<DepthTemplateMoveReading, 'missing'>[]>()
    resetCompositorSession()
    const compositor = await createCompositor(size.width, size.height)
    if (!compositor) throw new Error('parity templates: createCompositor gave null on this page: WebGL did not start')
    try {
      for (const f of fixtures) {
        const sheet: HTMLCanvasElement[] = []
        const began = performance.now()
        readings.set(f.id, DEPTH_MOVES.map((move) => readMove(f.spec, move, style, size, compositor, sheet)))
        frames.canvas(`parity templates: ${f.id} at ${shape.name}, each of ${DEPTH_MOVES.join(', ')}: its first inked frame, then its settled frame`, contactSheet(sheet, size))
        summary.push(`parity templates ${f.id} at ${shape.name}: the four depths read through paintDrawList3d in ${(performance.now() - began).toFixed(0)} ms`)
      }
    } finally {
      compositor.dispose()
    }

    // WebGL pretended missing, for every depth; then the Preview's mark, once per fixture.
    resetCompositorSession({ missing: true })
    try {
      for (const f of fixtures) {
        const moves: DepthTemplateMoveReading[] = []
        for (const r of readings.get(f.id)!) moves.push({ ...r, missing: await readMissing(f.spec, r.move, style, size, r.firstOffFlat, r.moving) })
        const liveId = `parity-templates-missing-${f.id}-${shape.name.replace(':', 'x')}`
        const { depth: _d, hero: _h, ...plain } = f.spec
        const spec: GraphicSpec = { ...plain, depth: 'tilt' }
        const total = Math.max(1, Math.round(spec.seconds * FPS))
        const at = Math.max(0, moves[0].firstOffFlat)
        forgetGraphicPreview(liveId)
        graphicPreviewCanvas(liveId, spec, style, size.width, size.height, { frame: at, total, fps: FPS }, {})
        await new Promise((resolve) => setTimeout(resolve, 0))
        graphicPreviewCanvas(liveId, spec, style, size.width, size.height, { frame: at + 1, total, fps: FPS }, {})
        const previewDrawnFlat = graphicDrawnFlat(liveId)
        forgetGraphicPreview(liveId)
        takeGraphicBakeNotes()
        cases.push({ fixture: f.id, template: f.spec.data.template, shape: shape.name, width: size.width, height: size.height, moves, previewDrawnFlat })
      }
    } finally {
      resetCompositorSession()
    }
  }
  for (const c of cases) {
    for (const r of c.moves) {
      summary.push(
        `parity templates ${c.fixture} ${r.move} at ${c.shape}: ${r.moving} moving frames, ${r.movingCamera} off flat (the first ${r.firstOffFlat}, ${r.offFlatAfterLastBeat} from the last beat on); last camera ${JSON.stringify(r.lastCamera)}; ` +
          `${r.textsChecked} text items against the flat twin's, ${r.textsDiffer.length} differ; settled list the twin's: ${r.settledListEqual}; ` +
          `settled against the flat twin max ${r.settled.maxAll}; frame ${r.firstFrame} against the twin max ${r.first.maxAll}; ` +
          `WebGL missing: createCompositor ${r.missing.compositor}, notes ${JSON.stringify(r.missing.notes)}, frame ${r.missing.frame} against painter A max ${r.missing.againstPainterA.maxAll}, settled against the twin max ${r.missing.settledAgainstTwin.maxAll}`
      )
    }
    summary.push(`parity templates ${c.fixture} at ${c.shape}: with WebGL missing the Preview marked it drawn flat: ${c.previewDrawnFlat}`)
  }
  return cases
}

