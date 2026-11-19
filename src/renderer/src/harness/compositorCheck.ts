/**
 * `window.__forgeGraphicCheck({ compositor: true })` (docs/CLIPS.md §6.11's
 * options table, §6.16; phase 3's piece 1): painter B read against painter A
 * on this page's own WebGL.
 *
 * - **Routes.** Hand-made lists at 540×960 (shapes in the theme's colours,
 *   one at 50 % over another and alone, a rounded panel with a border, a ring
 *   arc, a stroke, a Latin line and EFFECTS §51's clusters) painted by
 *   painter A onto a 2D canvas, and by `paintDrawList3d` through each route:
 *   `flat` (a flat camera: painter A, no WebGL), `glow` (a glow request
 *   under a flat camera: the 1:1 identity quad, the glow pass a no-op until
 *   piece 2) and `perspective` (a flat camera with a focus blur, which
 *   piece 1 draws as the texel itself: one compensated plane per z under the
 *   perspective camera). Each route's frame is copied out as the seam copies
 *   it (`drawImage` into a 2D canvas) and read per channel against painter
 *   A's. The 1 px line at 10, 50 and 90 % alpha is read composited over black
 *   and over white. A settled 2.5D list (planes at z 0, 0.02 and 0.05, the
 *   camera flat) is read against its flat twin. EFFECTS §51's clusters are
 *   read again on their own ink box (painter A's clusters alone, `inkBox`,
 *   `padRect` by 2, as phase 0's parity reads them) in the glow and
 *   perspective frames: §6.12's M6 at 0.000 on the clusters themselves, not
 *   diluted by the whole frame.
 * - **Edges.** One cream rounded panel and ring on the z 0 plane, tilted 24°
 *   and dollied back 0.12: where a pixel is at least `edgeMinAlpha` opaque,
 *   its straight colour must be the fill's (`edgeColour`); a layer filtered
 *   straight and premultiplied after would read a dark fringe there.
 * - **Memory.** The shared renderer's `info.memory` geometries and textures
 *   before the compositor is made, after the WebGL routes have drawn, and
 *   after `dispose`.
 * - **WebGL missing.** `resetCompositorSession({ missing: true })`, then
 *   `createCompositor` (null), `graphicFrameCanvases` over a drawer that
 *   tilts (painter A, flat) against its flat twin, the notes the bake path
 *   recorded (`WEBGL_MISSING_NOTE` once), and the Preview's canvas, which
 *   marks its clip drawn flat (the dock's note). The session is restored
 *   after, whatever happens.
 *
 * Frames for the eye go on the sheet: each route's picture, a 24° tilt and a
 * dolly back (the moving routes, not measured: a moving frame has no twin).
 */

import type { Camera, DrawItem, DrawList, Drawer, GraphicTargets, ShapeItem, StrokeItem, TextLook } from '@shared/graphics/items'
import { textItems } from '@shared/graphics/items'
import { paintDrawList2d } from '@shared/graphics/paint'
import { resolveGraphicStyle } from '@shared/graphics/style'
import type { GraphicSpec } from '@shared/graphics/template'
import { facesFor } from '@shared/render/textPaint'
import { useCatalog } from '../catalog'
import { sharedRenderer } from '../threeShared'
import { WEBGL_MISSING_NOTE, createCompositor, paintDrawList3d, resetCompositorSession, type Compositor } from '../graphicCompositor'
import { forgetGraphicPreview, graphicDrawnFlat, graphicFrameCanvases, graphicMeasure, graphicPreviewCanvas, takeGraphicBakeNotes } from '../graphicCanvas'
import { COMPOSITOR_BAR, compositorVerdict, diffChannels, edgeColour, type ChannelDiff, type CompositorReadings, type EdgeReading, type RouteReading } from './compositorMeasure'
import { inkBox, padRect } from './graphicMeasure'

export interface CompositorResult extends CompositorReadings {
  size: { width: number; height: number }
  verdict: { pass: boolean; failures: string[] }
  /** The Preview's canvas marked its clip drawn flat with WebGL pretended missing: the dock's graphic panel then shows the note. */
  previewDrawnFlat: boolean
}

const W = 540
const H = 960
const BLUE = '#2563eb'
const CREAM = '#f6f2ea'
const NEAR_BLACK = '#100e0b'
const STYLE = resolveGraphicStyle('clean')
const FLAT: Camera = { tilt: 0, yaw: 0, dolly: 0, fov: 30 }
/** A focus blur above 0 with a flat camera: the perspective route at rest, its shader the texel itself in piece 1. */
const FOCUSED: Camera = { ...FLAT, focus: { z: 0, px: 1 } }
const SPEC: GraphicSpec = { data: { template: 'counter', value: '40', label: 'forty' }, seconds: 1, beats: [0.5], place: { auto: true, third: 'middle' }, seed: 1, version: 0 }

function canvas2d(width = W, height = H): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('compositor check: no 2D context')
  return { canvas, ctx }
}

const freshLayer = (width: number, height: number): CanvasRenderingContext2D => canvas2d(width, height).ctx
const pixelsOf = (canvas: HTMLCanvasElement): Uint8ClampedArray => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data

const rect = (x: number, y: number, width: number, height: number): { x: number; y: number; width: number; height: number } => ({ x, y, width, height })
const fillShape = (id: string, box: ReturnType<typeof rect>, fill: string, opacity = 1): ShapeItem => ({ kind: 'shape', id, opacity, shape: 'rect', box, fill })

/** The colours list, in list order; `textItems` measured by the renderer's own measure. */
function coloursItems(clusters: readonly string[]): DrawItem[] {
  const look: TextLook = { textStyleId: STYLE.textStyleId, font: STYLE.font, px: 40, align: 'left' }
  return [
    fillShape('blue', rect(30, 40, 100, 100), BLUE),
    fillShape('cream', rect(150, 40, 100, 100), CREAM),
    fillShape('ink', rect(270, 40, 100, 100), NEAR_BLACK),
    fillShape('grey', rect(390, 40, 100, 100), '#808080'),
    fillShape('under', rect(30, 170, 100, 100), CREAM),
    fillShape('over', rect(30, 170, 100, 100), BLUE, 0.5),
    fillShape('alone', rect(150, 170, 100, 100), BLUE, 0.5),
    { kind: 'shape', id: 'panel', opacity: 0.9, shape: 'rounded', box: rect(280, 170, 220, 110), radius: 18, fill: NEAR_BLACK, stroke: { color: CREAM, width: 3 } },
    { kind: 'shape', id: 'ring', opacity: 1, shape: 'ring', box: rect(40, 310, 160, 160), sweep: 0.7, start: -Math.PI / 2, stroke: { color: BLUE, width: 14 } },
    { kind: 'stroke', id: 'curve', opacity: 1, d: 'M 240 460 C 300 300 420 520 500 330', from: 0, to: 1, width: 6, color: CREAM, cap: 'round', join: 'round' },
    ...textItems({ id: 'latin', text: 'Forty percent faster', look, at: { x: 30, y: 520, width: 480 }, unit: 'line', source: 'label' }, graphicMeasure()),
    ...textItems({ id: 'clusters', text: clusters.join(' '), look, at: { x: 30, y: 620, width: 480 }, unit: 'line', source: 'label' }, graphicMeasure())
  ]
}

/** The 1 px line at one alpha: a diagonal and a near-horizontal, so every coverage is drawn. */
function lineItems(alpha: number): StrokeItem[] {
  const line = (id: string, d: string): StrokeItem => ({ kind: 'stroke', id, opacity: alpha, d, from: 0, to: 1, width: 1, color: BLUE, cap: 'butt', join: 'miter' })
  return [line('diagonal', 'M 30 100 L 510 860'), line('shallow', 'M 20 480 L 520 520')]
}

/** The items on planes at z 0, 0.02 and 0.05 by thirds of the list, so plane order is list order. */
function onPlanes(items: readonly DrawItem[]): DrawItem[] {
  return items.map((item, i) => ({ ...item, z: [0, 0.02, 0.05][Math.min(2, Math.floor((3 * i) / items.length))] }))
}

const list = (items: DrawItem[], extra: Partial<DrawList> = {}): DrawList => ({ width: W, height: H, items, ...extra })

/** Painter A over a cleared canvas. */
function painterA(l: DrawList): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d()
  paintDrawList2d(ctx, l, { layer: freshLayer })
  return canvas
}

/** Painter B, copied out at once as the seam copies it (graphicCanvas.ts `paintFrame`). */
function painterB(l: DrawList, compositor: Compositor): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d()
  ctx.drawImage(paintDrawList3d(l, compositor, { layer: freshLayer }), 0, 0)
  return canvas
}

/** A picture composited over a solid background. */
function over(picture: HTMLCanvasElement, background: string): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d()
  ctx.fillStyle = background
  ctx.fillRect(0, 0, W, H)
  ctx.drawImage(picture, 0, 0)
  return canvas
}

const line = (d: ChannelDiff): string => `mean ${d.meanAll.toFixed(3)} (R ${d.mean.map((m) => m.toFixed(3)).join(' / ')}), max ${d.maxAll} (${d.max.join(' / ')})`

export async function checkCompositor(
  clusters: readonly string[],
  frames: { canvas: (label: string, canvas: HTMLCanvasElement) => void },
  summary: string[],
  notes: string[]
): Promise<CompositorResult> {
  // Every face the lists draw, loaded before either painter paints.
  const { ensureFont } = useCatalog.getState()
  const colours = coloursItems(clusters)
  const faces = new Set<string>([STYLE.font])
  for (const item of colours) if (item.kind === 'text') for (const face of facesFor(item.look.font, item.text)) faces.add(face)
  await Promise.all([...faces].map((face) => ensureFont(face)))
  const coloursNow = coloursItems(clusters)

  resetCompositorSession()
  const { renderer } = await sharedRenderer(W, H)
  const memoryNow = (): { geometries: number; textures: number } => ({ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures })
  const before = memoryNow()
  const compositor = await createCompositor(W, H)
  if (!compositor) throw new Error('compositor check: createCompositor gave null on this page: WebGL did not start')

  const routes: RouteReading[] = []
  const edges: EdgeReading[] = []
  let built = before
  let settled: ChannelDiff
  try {
    const reference = painterA(list(coloursNow))
    const referencePixels = pixelsOf(reference)
    frames.canvas('compositor: painter A (the reference)', reference)
    const cases: { route: RouteReading['route']; l: DrawList }[] = [
      { route: 'flat', l: list(coloursNow, { camera: FLAT }) },
      { route: 'glow', l: list(coloursNow, { glow: [{ item: 'blue', radius: 8, strength: 1 }] }) },
      { route: 'perspective', l: list(onPlanes(coloursNow), { camera: FOCUSED }) }
    ]
    // The clusters' own ink box, from painter A's clusters alone, grown by 2 (phase 0's parity: inkBox, padRect).
    const clustersInk = inkBox(pixelsOf(painterA(list(coloursNow.filter((item) => item.id.startsWith('clusters'))))), W, H)
    if (!clustersInk) throw new Error('compositor check: the clusters drew no ink (their face did not load?)')
    const clustersArea = { width: W, rect: padRect(clustersInk, 2, W, H) }
    for (const { route, l } of cases) {
      const picture = painterB(l, compositor)
      const picturePixels = pixelsOf(picture)
      const diff = diffChannels(referencePixels, picturePixels)
      routes.push({ list: 'colours', route, over: 'clear', diff })
      summary.push(`compositor colours by route ${route}: ${line(diff)}`)
      if (route !== 'flat') {
        const clusters = diffChannels(referencePixels, picturePixels, clustersArea)
        routes.push({ list: 'clusters', route, over: 'clear', diff: clusters })
        summary.push(`compositor clusters (ink box ${JSON.stringify(clustersArea.rect)}) by route ${route}: ${line(clusters)}`)
      }
      frames.canvas(`compositor: colours by route ${route}`, picture)
    }

    for (const alpha of [0.1, 0.5, 0.9]) {
      const items = lineItems(alpha)
      const a = painterA(list(items))
      for (const { route, l } of [
        { route: 'glow' as const, l: list(items, { glow: [{ item: 'diagonal', radius: 4, strength: 1 }] }) },
        { route: 'perspective' as const, l: list(items, { camera: FOCUSED }) }
      ]) {
        const b = painterB(l, compositor)
        for (const background of ['black', 'white'] as const) {
          const hex = background === 'black' ? '#000000' : '#ffffff'
          const diff = diffChannels(pixelsOf(over(a, hex)), pixelsOf(over(b, hex)))
          routes.push({ list: 'line', route, over: background, alpha, diff })
          summary.push(`compositor 1 px line at ${alpha * 100} % by route ${route} over ${background}: ${line(diff)}`)
        }
      }
    }

    // The settled 2.5D frame (planes, a flat camera) against its flat twin: route one, 0 by construction.
    const planed = onPlanes(coloursNow)
    settled = diffChannels(referencePixels, pixelsOf(painterB(list(planed, { camera: FLAT }), compositor)))
    summary.push(`compositor settled 2.5D against its flat twin: ${line(settled)}`)

    // For the eye: a 24° tilt and a dolly back, the planes sliding.
    frames.canvas('compositor: tilt 24° (top away), planes at z 0 / 0.02 / 0.05', painterB(list(planed, { camera: { ...FLAT, tilt: 24 } }), compositor))
    frames.canvas('compositor: dolly −0.12, yaw −8°', painterB(list(planed, { camera: { ...FLAT, dolly: -0.12, yaw: -8 } }), compositor))

    // A moving plane's edges: one colour, so every pixel's straight colour is the fill's wherever it is opaque enough to read.
    const cream: readonly [number, number, number] = [0xf6, 0xf2, 0xea]
    const edgeItems: DrawItem[] = [
      { kind: 'shape', id: 'edge-panel', opacity: 1, shape: 'rounded', box: rect(60, 200, 420, 260), radius: 40, fill: CREAM, z: 0 },
      { kind: 'shape', id: 'edge-ring', opacity: 1, shape: 'ring', box: rect(150, 520, 240, 240), sweep: 0.8, start: -Math.PI / 2, stroke: { color: CREAM, width: 9 }, z: 0 }
    ]
    for (const [camera, view] of [
      ['tilt 24°', { ...FLAT, tilt: 24 }],
      ['dolly −0.12', { ...FLAT, dolly: -0.12 }]
    ] as const) {
      const picture = painterB(list(edgeItems, { camera: view }), compositor)
      const reading: EdgeReading = { camera, ...edgeColour(pixelsOf(picture), cream, COMPOSITOR_BAR.edgeMinAlpha) }
      edges.push(reading)
      summary.push(`compositor edges at ${camera}: straight colour off the fill by at most ${reading.max} over ${reading.pixels} pixels at alpha ${COMPOSITOR_BAR.edgeMinAlpha}+ (${reading.edgePixels} of them edge pixels)`)
      frames.canvas(`compositor: edges at ${camera} (one cream colour: no dark rim)`, over(picture, '#ffffff'))
    }
    built = memoryNow()
  } finally {
    compositor.dispose()
  }
  const after = memoryNow()
  summary.push(`compositor memory, geometries / textures: before ${before.geometries} / ${before.textures}, built ${built.geometries} / ${built.textures}, after dispose ${after.geometries} / ${after.textures}`)

  // WebGL pretended missing: the flat picture, the note once, the dock's mark.
  let missing: CompositorReadings['missing']
  let previewDrawnFlat = false
  const tilting: Drawer = () => ({ items: onPlanes(coloursNow), camera: { ...FLAT, tilt: 24 } })
  const liveId = `compositor-check-missing-${Date.now()}`
  takeGraphicBakeNotes()
  resetCompositorSession({ missing: true })
  try {
    const nothing = await createCompositor(W, H)
    const noTargets = (): GraphicTargets => ({})
    const [flatFrame] = await graphicFrameCanvases(SPEC, STYLE, W, H, 30, 30, [0], noTargets, tilting)
    const notesTaken = takeGraphicBakeNotes()
    const diff = diffChannels(pixelsOf(painterA(list(coloursNow))), pixelsOf(flatFrame))
    missing = { compositor: nothing ? 'a compositor' : 'null', notes: notesTaken, diff }
    frames.canvas('compositor: WebGL pretended missing, the tilted list drawn flat', flatFrame)
    graphicPreviewCanvas(liveId, SPEC, STYLE, W, H, { frame: 0, total: 30, fps: 30 }, {}, undefined, tilting)
    await new Promise((resolve) => setTimeout(resolve, 0))
    graphicPreviewCanvas(liveId, SPEC, STYLE, W, H, { frame: 1, total: 30, fps: 30 }, {}, undefined, tilting)
    previewDrawnFlat = graphicDrawnFlat(liveId)
    nothing?.dispose()
  } finally {
    forgetGraphicPreview(liveId)
    resetCompositorSession()
  }
  summary.push(`compositor with WebGL pretended missing: createCompositor ${missing.compositor}, notes ${JSON.stringify(missing.notes)}, the frame against the flat twin ${line(missing.diff)}, the preview marked drawn flat: ${previewDrawnFlat}`)

  const readings: CompositorReadings = { routes, settled, memory: { before, built, after }, missing, edges }
  const verdict = compositorVerdict(readings, WEBGL_MISSING_NOTE)
  if (!previewDrawnFlat) verdict.failures.push('with WebGL missing, the Preview did not mark its clip drawn flat (the dock would show no note)')
  verdict.pass = verdict.failures.length === 0
  summary.push(`compositor verdict: ${verdict.pass ? 'PASS' : `FAIL: ${verdict.failures.join('; ')}`}`)
  if (!verdict.pass) notes.push(...verdict.failures.map((f) => `compositor: ${f}`))
  return { ...readings, size: { width: W, height: H }, verdict, previewDrawnFlat }
}
