/**
 * `window.__forgeGraphicCheck({ screenCard: true })` (docs/CLIPS.md §6.16,
 * "The screen card" and "The hand-off"; phase 3's piece 4), on this page's own
 * WebGL. Both moves, Tilt in and Pull back, under `clean` and under
 * `energetic` (whose out-back curve overshoots past flat before it lands), at
 * 540×960 and 30 fps, every frame through `paintDrawList3d`, over a stand-in
 * recording this file paints itself: the harness page has no preload, so
 * `window.forge.momentFrames` is not there to pull a file's frames (bridge.ts
 * refuses it), and the card's `targets.screen` is handed in as
 * `screenTargetsAt` would fill it, each frame's file a bitmap of its own in
 * the painter's `images` (a 1280×720 "screen" whose number is its frame).
 *
 * Read (the bars in `SCREEN_CARD_BAR`, `screenCardMeasure.ts`):
 * - the landing frame `L` against a plain `drawImage` of the stand-in's frame
 *   `L` into the card's box, inside the box less the bezel: the hand-off's
 *   own side (expected 0.000: route one draws the very call);
 * - the frame `L + 1`: alpha 0 inside the box less the bezel (the hole), the
 *   dim's alpha outside it and its bezel;
 * - frame 0's card opacity (Tilt in 0, Pull back 1); the camera at `L`, each
 *   field exactly 0, and none after;
 * - an early frame against `L` (the move is there);
 * - Pull back drawn flat by painter A, as without WebGL: frame 0's ink 1.35 ×
 *   the box's height (its scale is a transform painter A honours).
 *
 * Contact sheets at a third of the size over a dark grey: each case's frames
 * (`screenCardSheetFrames`), and, per move, the landing beside the plain
 * `drawImage` and the frame after it, and the two moves drawn flat. The
 * summary prints the milliseconds per frame through `paintDrawList3d`.
 *
 * The true hand-off, the card's frame `L` against the RENDER's frame of the
 * recording beneath (within 2/255 mean on both machines), is M20, graphic.int's
 * phase-3 case (§6.11), piece 6's.
 */

import type { DrawItem, DrawList, GraphicTargets, Rect } from '@shared/graphics/items'
import { drawListAt } from '@shared/graphics/drawList'
import { cameraIsFlat, flatItems } from '@shared/graphics/compositor'
import { graphicMovingFrames } from '@shared/graphics/frame'
import { paintDrawList2d } from '@shared/graphics/paint'
import { resolveGraphicStyle, type GraphicStyle } from '@shared/graphics/style'
import type { GraphicSpec } from '@shared/graphics/template'
import { SCREEN_CARD_MOVES, bezelWidth, landingFrame, type ScreenCardMove } from '@shared/graphics/templates/screenCard'
import { createCompositor, paintDrawList3d, resetCompositorSession, type Compositor } from '../graphicCompositor'
import { graphicMeasure } from '../graphicCanvas'
import { diffChannels } from './compositorMeasure'
import {
  SCREEN_CARD_MOVE_FRAME,
  alphaMaxIn,
  alphaOutside,
  inkRows,
  screenCardSheetFrames,
  screenCardVerdict,
  wholeRegion,
  type ScreenCardReading
} from './screenCardMeasure'

export interface ScreenCardResult {
  size: { width: number; height: number }
  fps: number
  /** The stand-in recording's size and the card's box on the frame. */
  recording: { width: number; height: number }
  box: Rect
  cases: ScreenCardReading[]
  verdict: { pass: boolean; failures: string[] }
}

const W = 540
const H = 960
const FPS = 30
/** The stand-in recording: a 16:9 screen, as a laptop records one. */
const REC = { width: 1280, height: 720 } as const
/** The styles read: the default, and the one whose out-back curve overshoots before it lands. */
export const SCREEN_CARD_CHECK_STYLES: readonly string[] = Object.freeze(['clean', 'energetic'])
const SHEET_SCALE = 1 / 3
const SHEET_BACKGROUND = '#2a2a2a'

function canvas2d(width = W, height = H): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('screen card check: no 2D context')
  return { canvas, ctx }
}

const freshLayer = (width: number, height: number): CanvasRenderingContext2D => canvas2d(width, height).ctx
const pixelsOf = (canvas: HTMLCanvasElement): Uint8ClampedArray => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data

/** The card's box: the recording contained in the frame, as `sourceToFrame` maps a plain 16:9 clip into a 9:16 canvas (tests/graphicFrame.test.ts pins that mapping). */
function containedBox(): Rect {
  const scale = Math.min(W / REC.width, H / REC.height)
  const width = REC.width * scale
  const height = REC.height * scale
  return { x: (W - width) / 2, y: (H - height) / 2, width, height }
}

/** The stand-in recording's frame `f`: a window with a title bar, rows of "text", a grid, a colour that walks with the frame, and the frame's number. */
function standInFrame(f: number): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d(REC.width, REC.height)
  ctx.fillStyle = `hsl(${(f * 9) % 360} 35% 22%)`
  ctx.fillRect(0, 0, REC.width, REC.height)
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  for (let x = 0; x < REC.width; x += 64) ctx.strokeRect(x, 0, 1, REC.height)
  for (let y = 0; y < REC.height; y += 64) ctx.strokeRect(0, y, REC.width, 1)
  ctx.fillStyle = '#f2efe7'
  ctx.fillRect(120, 90, 1040, 540)
  ctx.fillStyle = '#2663e9'
  ctx.fillRect(120, 90, 1040, 48)
  ctx.fillStyle = '#9aa0a6'
  for (let row = 0; row < 7; row++) ctx.fillRect(160, 180 + row * 52, 300 + ((row * 137 + f * 11) % 520), 18)
  ctx.fillStyle = '#101014'
  ctx.font = 'bold 120px sans-serif'
  ctx.fillText(String(f), 860, 560)
  return canvas
}

function contactSheet(pictures: readonly HTMLCanvasElement[]): HTMLCanvasElement {
  const w = Math.round(W * SHEET_SCALE)
  const h = Math.round(H * SHEET_SCALE)
  const { canvas, ctx } = canvas2d(w * pictures.length, h)
  ctx.fillStyle = SHEET_BACKGROUND
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  pictures.forEach((p, i) => ctx.drawImage(p, i * w, 0, w, h))
  return canvas
}

/** The card's items' opacity, the least of them (the dim aside). */
const cardOpacity = (list: DrawList): number => Math.min(1, ...list.items.filter((i: DrawItem) => i.kind !== 'dim').map((i) => i.opacity))

export async function checkScreenCard(
  frames: { canvas: (label: string, canvas: HTMLCanvasElement) => void },
  summary: string[],
  notes: string[]
): Promise<ScreenCardResult> {
  const L = landingFrame(FPS)
  const box = containedBox()
  const size = { width: W, height: H }
  const measure = graphicMeasure()
  const bitmaps = new Map<string, ImageBitmap>()
  const srcOf = (f: number): string => `standin://screen-card/${f}`
  for (let f = 0; f <= L; f++) bitmaps.set(srcOf(f), await createImageBitmap(standInFrame(f)))
  const targetsAt = (f: number): GraphicTargets => ({ screen: { box, file: f <= L ? srcOf(f) : null } })
  const bezel = bezelWidth(size)
  const inside = wholeRegion(box, Math.ceil(bezel / 2) + 1, 'inset', size)
  const around = wholeRegion(box, Math.ceil(bezel / 2) + 1, 'outset', size)

  resetCompositorSession()
  const compositor: Compositor | null = await createCompositor(W, H)
  if (!compositor) throw new Error('screen card check: createCompositor gave null on this page: WebGL did not start')
  const painterB = (list: DrawList): HTMLCanvasElement => {
    const { canvas, ctx } = canvas2d()
    ctx.drawImage(paintDrawList3d(list, compositor, { layer: freshLayer, images: bitmaps }), 0, 0)
    return canvas
  }
  const painterA = (list: DrawList): HTMLCanvasElement => {
    const { canvas, ctx } = canvas2d()
    paintDrawList2d(ctx, { ...list, items: flatItems(list) }, { layer: freshLayer, images: bitmaps })
    return canvas
  }

  const cases: ScreenCardReading[] = []
  const flatSheet: HTMLCanvasElement[] = []
  try {
    for (const styleId of SCREEN_CARD_CHECK_STYLES) {
      const style: GraphicStyle = resolveGraphicStyle(styleId)
      for (const move of SCREEN_CARD_MOVES as readonly ScreenCardMove[]) {
        const spec: GraphicSpec = { data: { template: 'screen-card', clipId: 'standin', move }, seconds: 10, beats: [1], place: { auto: true, third: 'middle' }, seed: 1, version: 1 }
        const total = Math.round(spec.seconds * FPS)
        const moving = graphicMovingFrames(spec, style, FPS, total)
        const lists = Array.from({ length: moving }, (_, f) => drawListAt(spec, style, f, FPS, size, measure, targetsAt(f)))
        const cameraOf = lists[L].camera
        const landing = painterB(lists[L])
        const plain = canvas2d()
        plain.ctx.drawImage(bitmaps.get(srcOf(L))!, box.x, box.y, box.width, box.height)
        const handoff = diffChannels(pixelsOf(landing), pixelsOf(plain.canvas), { width: W, rect: inside })
        const after = painterB(lists[L + 1])
        const afterPixels = pixelsOf(after)
        const outside = alphaOutside(afterPixels, W, H, around) ?? { min: -1, max: -1 }
        const early = diffChannels(pixelsOf(painterB(lists[SCREEN_CARD_MOVE_FRAME])), pixelsOf(landing))
        let flatScale: number | null = null
        if (move === 'pull-back') {
          const flat = painterA(lists[0])
          const ink = inkRows(pixelsOf(flat), W, H)
          flatScale = ink ? ink.height / box.height : null
          if (styleId === 'clean') flatSheet.push(flat, painterA(lists[Math.round(L / 2)]))
        } else if (styleId === 'clean') flatSheet.push(painterA(lists[2]), painterA(lists[Math.round(L / 2)]))

        const began = performance.now()
        for (const l of lists) paintDrawList3d(l, compositor, { layer: freshLayer, images: bitmaps })
        const msPerFrame = (performance.now() - began) / Math.max(1, lists.length)

        const reading: ScreenCardReading = {
          move,
          style: style.id,
          landing: L,
          moving,
          movingCamera: lists.filter((l) => !cameraIsFlat(l.camera)).length,
          cameraAtL: cameraOf ? { tilt: cameraOf.tilt, yaw: cameraOf.yaw, dolly: cameraOf.dolly } : null,
          cameraAfter: lists.slice(L + 1).some((l) => l.camera !== undefined),
          firstOpacity: cardOpacity(lists[0]),
          handoff,
          holeInside: alphaMaxIn(afterPixels, W, inside),
          holeOutside: outside,
          dimAlpha: Math.round(style.palette.dimOpacity * 255),
          early,
          flatScale
        }
        cases.push(reading)
        const shown = screenCardSheetFrames(L, moving)
        frames.canvas(`screen card: ${move} under ${style.id}, frames ${shown.join(', ')} of ${moving} (L = ${L})`, contactSheet(shown.map((f) => painterB(lists[f]))))
        if (styleId === 'clean') frames.canvas(`screen card: ${move}, the landing L = ${L}, a plain drawImage of the same frame into the box, and L + 1 (the hole)`, contactSheet([landing, plain.canvas, after]))
        summary.push(
          `screen card ${move} under ${style.id}: L ${L}, ${moving} moving frames, ${reading.movingCamera} off flat; camera at L ${JSON.stringify(reading.cameraAtL)}, after L ${reading.cameraAfter ? 'SOME' : 'none'}; ` +
            `frame 0 card opacity ${reading.firstOpacity.toFixed(4)}; landing against a plain drawImage mean ${handoff.meanAll.toFixed(3)}, max ${handoff.maxAll} over ${handoff.pixels} pixels; ` +
            `L + 1 alpha inside the hole ${reading.holeInside}, outside ${outside.min}..${outside.max} (the dim ${reading.dimAlpha}); frame ${SCREEN_CARD_MOVE_FRAME} against L max ${early.maxAll}` +
            (flatScale !== null ? `; drawn flat, frame 0 is ${flatScale.toFixed(3)} × the box` : '') +
            `; ${msPerFrame.toFixed(1)} ms a frame through paintDrawList3d`
        )
      }
    }
    frames.canvas('screen card drawn flat (WebGL missing, painter A): Tilt in at frames 2 and 15, Pull back at frames 0 and 15', contactSheet(flatSheet))
  } finally {
    compositor.dispose()
    for (const bitmap of bitmaps.values()) bitmap.close()
  }
  const verdict = screenCardVerdict(cases)
  summary.push(`screen card verdict: ${verdict.pass ? 'PASS' : `FAIL: ${verdict.failures.join('; ')}`}`)
  if (!verdict.pass) notes.push(...verdict.failures.map((f) => `screen card: ${f}`))
  notes.push('screen card: the true hand-off (the card’s frame L against the render’s frame of the recording) is M20, graphic.int’s phase-3 case (§6.11), not read here.')
  return { size: { width: W, height: H }, fps: FPS, recording: { ...REC }, box, cases, verdict }
}
