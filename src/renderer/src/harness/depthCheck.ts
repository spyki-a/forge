/**
 * `window.__forgeGraphicCheck({ depth: true })` (docs/CLIPS.md §6.11's options
 * table, the `parity` row's phase-3 half: "each 2.5D variant's settled frame
 * against its flat twin"; §6.16, "The 2.5D variants of `counter` and `ring`"
 * and "What glows"; phase 3's piece 3), on this page's own WebGL. A new key,
 * not `parity`, so phase 0's parity rig and its recorded output stay as they
 * were (the compositor option's precedent).
 *
 * For specs.json's English `counter` and `ring` (counter-en, ring-en), under
 * `clean`, each of the four depths, and the hero (`depth: 'tilt'`, `hero`)
 * under `neon` and under `energetic`, at 540×960 and 30 fps, every moving frame of the entrance
 * through `paintDrawList3d` (one compositor for the option), against the flat
 * twin (the same spec with no depth and no hero, the same style) by painter A:
 *
 * - the settled frame (the last moving one, what `tpad` holds) against the
 *   twin: 0 by route one (§6.12's M6 whole); the hero's, its glow left out
 *   (the probe), within route two's bars;
 * - the last moving frame's camera fields, read off its list: each exactly 0;
 * - the first frame where the twin has ink against the twin's: visibly not 0,
 *   so a dead depth branch cannot pass (`DEPTH_BAR.firstMinMax`);
 * - the hero only: what its glow adds beyond the glow's reach from the
 *   glowing item's own ink (alpha 0, M7's bar, and colour within route two's
 *   bar; the frame with the glow against the frame without, so a style that
 *   dims the whole frame is read too) and that the glow is there (the same
 *   two frames, anywhere).
 *
 * A contact sheet per case over a dark grey, at half the size, frame numbers
 * in its caption: the frames `depthSheetFrames` picks, every frame from the
 * first with ink while the move shows, the last off flat and the first at
 * rest. The summary also prints the milliseconds per frame `paintDrawList3d`
 * took over the case's moving frames (the GPU's cost; no bar).
 */

import type { DrawList } from '@shared/graphics/items'
import { drawListAt } from '@shared/graphics/drawList'
import { cameraIsFlat, glowItemsOf } from '@shared/graphics/compositor'
import { graphicMovingFrames } from '@shared/graphics/frame'
import { paintDrawList2d } from '@shared/graphics/paint'
import { resolveGraphicStyle, type GraphicStyle } from '@shared/graphics/style'
import type { GraphicSpec } from '@shared/graphics/template'
import { DEPTH_MOVES, type DepthMove } from '@shared/graphics/templates/depth'
import { facesFor } from '@shared/render/textPaint'
import { useCatalog } from '../catalog'
import { createCompositor, paintDrawList3d, resetCompositorSession, type Compositor, type CompositorProbe } from '../graphicCompositor'
import { graphicMeasure } from '../graphicCanvas'
import { diffChannels, type ChannelDiff } from './compositorMeasure'
import { depthSheetFrames, depthVerdict, glowBeyondReach, type DepthCaseReading } from './depthMeasure'
import { HERO_LANDING_BAR, glowChange, heroLandingWithin, type HeroLandingReading } from './phase3Measure'

export interface DepthResult {
  size: { width: number; height: number }
  fps: number
  cases: DepthCaseReading[]
  verdict: { pass: boolean; failures: string[] }
}

const W = 540
const H = 960
const FPS = 30
/** The fixtures read: specs.json's English counter and ring. */
export const DEPTH_CHECK_FIXTURES: readonly string[] = Object.freeze(['counter-en', 'ring-en'])
/** The style the four depths are read under, and the glowing ones the hero is read under: neon (expo-out) and energetic (out-back, whose camera overshoots past flat before it lands). */
export const DEPTH_CHECK_STYLE = 'clean'
export const DEPTH_CHECK_HERO_STYLES: readonly string[] = Object.freeze(['neon', 'energetic'])
/** Half the size: a third made the move a pixel or less on every frame after the first few (the critics' reading). */
const SHEET_SCALE = 1 / 2
const SHEET_BACKGROUND = '#2a2a2a'

function canvas2d(width = W, height = H): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('depth check: no 2D context')
  return { canvas, ctx }
}

const freshLayer = (width: number, height: number): CanvasRenderingContext2D => canvas2d(width, height).ctx
const pixelsOf = (canvas: HTMLCanvasElement): Uint8ClampedArray => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data

function painterA(l: DrawList): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d()
  paintDrawList2d(ctx, l, { layer: freshLayer })
  return canvas
}

/** Painter B, copied out at once as the seam copies it (graphicCanvas.ts `paintFrame`). */
function painterB(l: DrawList, compositor: Compositor, probe: CompositorProbe = {}): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d()
  ctx.drawImage(paintDrawList3d(l, compositor, { layer: freshLayer }, probe), 0, 0)
  return canvas
}

const hasInk = (data: Uint8ClampedArray): boolean => {
  for (let p = 3; p < data.length; p += 4) if (data[p] > 0) return true
  return false
}

/** The frames side by side, at `SHEET_SCALE`, over a dark grey so light ink shows. */
function contactSheet(pictures: readonly HTMLCanvasElement[]): HTMLCanvasElement {
  const w = Math.round(W * SHEET_SCALE)
  const h = Math.round(H * SHEET_SCALE)
  const { canvas, ctx } = canvas2d(w * pictures.length, h)
  ctx.fillStyle = SHEET_BACKGROUND
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  pictures.forEach((p, i) => ctx.drawImage(p, i * w, 0, w, h))
  return canvas
}

const line = (d: ChannelDiff): string => `mean ${d.meanAll.toFixed(3)}, max ${d.maxAll}`

async function readCase(
  fixture: string,
  base: GraphicSpec,
  variant: DepthMove | 'hero',
  style: GraphicStyle,
  compositor: Compositor,
  frames: { canvas: (label: string, canvas: HTMLCanvasElement) => void },
  summary: string[]
): Promise<DepthCaseReading> {
  const { depth: _depth, hero: _hero, ...plain } = base
  const twinSpec: GraphicSpec = plain
  const spec: GraphicSpec = variant === 'hero' ? { ...plain, depth: 'tilt', hero: true } : { ...plain, depth: variant }
  const measure = graphicMeasure()
  const size = { width: W, height: H }
  const total = Math.max(1, Math.round(spec.seconds * FPS))
  const moving = graphicMovingFrames(spec, style, FPS, total)
  const lists = Array.from({ length: moving }, (_, f) => drawListAt(spec, style, f, FPS, size, measure, {}))
  const twins = Array.from({ length: moving }, (_, f) => drawListAt(twinSpec, style, f, FPS, size, measure, {}))
  const last = moving - 1
  const camera = lists[last].camera
  const lastCamera = camera ? { tilt: camera.tilt, yaw: camera.yaw, dolly: camera.dolly, focusPx: camera.focus?.px ?? 0 } : null
  const movingCamera = lists.filter((l) => !cameraIsFlat(l.camera)).length

  // The settled frame: for the hero, its base under the glow (the glow left out), as route two's 1:1 is read.
  const twinSettled = pixelsOf(painterA(twins[last]))
  const settledPicture = painterB(lists[last], compositor, variant === 'hero' ? { glow: false } : {})
  const settled = diffChannels(twinSettled, pixelsOf(settledPicture))

  let firstFrame = -1
  let first: ChannelDiff = diffChannels(twinSettled, twinSettled)
  for (let f = 0; f < moving; f++) {
    const twin = pixelsOf(painterA(twins[f]))
    if (!hasInk(twin)) continue
    firstFrame = f
    first = diffChannels(twin, pixelsOf(painterB(lists[f], compositor)))
    break
  }

  let glow: DepthCaseReading['glow']
  let landing: HeroLandingReading | undefined
  if (variant === 'hero') {
    const request = lists[last].glow?.[0]
    const radius = request?.radius ?? 0
    const withGlow = painterB(lists[last], compositor)
    const withPixels = pixelsOf(withGlow)
    const withoutPixels = pixelsOf(settledPicture)
    // The glowing item alone, as the glow canvas holds it: the reach is read from its ink, not from the whole graphic's (a dim fills the frame).
    const ink = pixelsOf(painterA({ ...lists[last], items: glowItemsOf(lists[last].items, lists[last].glow ?? []), glow: undefined }))
    const beyond = glowBeyondReach(ink, withPixels, withoutPixels, W, H, radius)
    glow = { radius, reach: beyond.reach, outsideReach: beyond.outsideReach, outsideColour: beyond.outsideColour, outsidePixels: beyond.outsidePixels, present: diffChannels(withoutPixels, withPixels) }
    frames.canvas(`depth: ${fixture} hero under ${style.id}, settled, with its glow (over grey)`, contactSheet([withGlow]))
    // The landing (piece 6): the last frame off flat (route three) against the first at rest (route two), with and without the glow.
    const lastMoving = lists.map((l) => !cameraIsFlat(l.camera)).lastIndexOf(true)
    const firstFlat = lastMoving + 1
    if (lastMoving >= 0 && firstFlat < moving) {
      const a = { with: pixelsOf(painterB(lists[lastMoving], compositor)), without: pixelsOf(painterB(lists[lastMoving], compositor, { glow: false })) }
      const b = { with: pixelsOf(painterB(lists[firstFlat], compositor)), without: pixelsOf(painterB(lists[firstFlat], compositor, { glow: false })) }
      const change = glowChange(a.with, a.without, b.with, b.without)
      landing = { lastMoving, firstFlat, withGlow: diffChannels(a.with, b.with), withoutGlow: diffChannels(a.without, b.without), glowMean: change.mean, glowMax: change.max, glowPixels: change.pixels, lastGlowPixels: change.lastPixels, firstGlowPixels: change.firstPixels }
      // The same frame by both routes: the template still moves across the landing (a count's digits, an arc), so the routes are read against
      // each other on ONE frame's content, the last moving frame drawn as it is (route three) and with its camera taken off (route two).
      const still = { ...lists[lastMoving], camera: undefined }
      const c = { with: pixelsOf(painterB(still, compositor)), without: pixelsOf(painterB(still, compositor, { glow: false })) }
      const same = glowChange(a.with, a.without, c.with, c.without)
      landing.same = { camera: lists[lastMoving].camera, glowMean: same.mean, glowMax: same.max, glowPixels: same.pixels, lastGlowPixels: same.lastPixels, firstGlowPixels: same.firstPixels }
    }
  }

  const began = performance.now()
  for (const l of lists) paintDrawList3d(l, compositor, { layer: freshLayer })
  const msPerFrame = (performance.now() - began) / Math.max(1, lists.length)

  const shown = depthSheetFrames(firstFrame, lists.map((l) => !cameraIsFlat(l.camera)))
  frames.canvas(`depth: ${fixture} ${variant} under ${style.id}, frames ${shown.join(', ')} of ${moving}`, contactSheet(shown.map((f) => painterB(lists[f], compositor))))

  const reading: DepthCaseReading = {
    fixture,
    template: base.data.template as 'counter' | 'ring',
    variant,
    style: style.id,
    moving,
    movingCamera,
    lastCamera,
    settled,
    firstFrame,
    first,
    ...(glow ? { glow } : {}),
    ...(landing ? { landing } : {})
  }
  summary.push(
    `depth ${fixture} ${variant} under ${style.id}: ${moving} moving frames, ${movingCamera} off flat; last camera ${JSON.stringify(lastCamera)}; ` +
      `${msPerFrame.toFixed(1)} ms a frame through paintDrawList3d; settled against the flat twin ${line(settled)}${variant === 'hero' ? ' (the glow left out)' : ''}; frame ${firstFrame} against the twin ${line(first)}` +
      (glow ? `; glow radius ${glow.radius.toFixed(1)} px, beyond its ${glow.reach} px reach from the item's ink alpha added ${glow.outsideReach} and colour off by ${glow.outsideColour} over ${glow.outsidePixels} pixels, with against without ${line(glow.present)}` : '') +
      (landing
        ? `; the landing, frame ${landing.lastMoving} (route three) against ${landing.firstFlat} (route two): with the glow ${line(landing.withGlow)}, without it ${line(landing.withoutGlow)}, the glow's own change mean ${landing.glowMean.toFixed(3)} over its ${landing.glowPixels} pixels (glowing ${landing.lastGlowPixels} before, ${landing.firstGlowPixels} after), max ${landing.glowMax} ` +
          `; frame ${landing.lastMoving} by both routes (its camera ${JSON.stringify(landing.same?.camera)} taken off for route two), the glow's own change mean ${landing.same?.glowMean.toFixed(3)} ` +
          `over ${landing.same?.glowPixels} pixels (glowing ${landing.same?.lastGlowPixels} by route three, ${landing.same?.firstGlowPixels} by route two), max ${landing.same?.glowMax} ` +
          `(proposed bar mean ≤ ${HERO_LANDING_BAR.glowMean}, max ≤ ${HERO_LANDING_BAR.glowMax}: ${landing.same && heroLandingWithin(landing.same) ? 'within' : 'OVER'}; not in the verdict)`
        : variant === 'hero' ? '; the landing: no frame off flat followed by one at rest, not read' : '')
  )
  return reading
}

export async function checkDepth(
  fixtures: readonly { id: string; spec: GraphicSpec }[],
  frames: { canvas: (label: string, canvas: HTMLCanvasElement) => void },
  summary: string[],
  notes: string[]
): Promise<DepthResult> {
  const plain = resolveGraphicStyle(DEPTH_CHECK_STYLE)
  const glowing = DEPTH_CHECK_HERO_STYLES.map((id) => resolveGraphicStyle(id))
  const chosen = DEPTH_CHECK_FIXTURES.map((id) => {
    const f = fixtures.find((x) => x.id === id)
    if (!f) throw new Error(`depth check: specs.json has no fixture ${id}`)
    return f
  })
  // Every face the lists draw, loaded before either painter paints.
  const { ensureFont } = useCatalog.getState()
  const measure = graphicMeasure()
  const faces = new Set<string>([plain.font, ...glowing.map((st) => st.font)])
  for (const f of chosen) {
    for (const st of [plain, ...glowing]) {
      for (const item of drawListAt(f.spec, st, 60, FPS, { width: W, height: H }, measure, {}).items) if (item.kind === 'text') for (const face of facesFor(item.look.font, item.text)) faces.add(face)
    }
  }
  await Promise.all([...faces].map((face) => ensureFont(face)))

  resetCompositorSession()
  const compositor = await createCompositor(W, H)
  if (!compositor) throw new Error('depth check: createCompositor gave null on this page: WebGL did not start')
  const cases: DepthCaseReading[] = []
  try {
    for (const f of chosen) {
      for (const move of DEPTH_MOVES) cases.push(await readCase(f.id, f.spec, move, plain, compositor, frames, summary))
      for (const st of glowing) cases.push(await readCase(f.id, f.spec, 'hero', st, compositor, frames, summary))
    }
  } finally {
    compositor.dispose()
  }
  const verdict = depthVerdict(cases)
  summary.push(`depth verdict: ${verdict.pass ? 'PASS' : `FAIL: ${verdict.failures.join('; ')}`}`)
  if (!verdict.pass) notes.push(...verdict.failures.map((f) => `depth: ${f}`))
  return { size: { width: W, height: H }, fps: FPS, cases, verdict }
}
