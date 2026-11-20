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
 *   the box's height (its scale is a transform painter A honours), and on a
 *   box `SCREEN_CARD_LOW_BOX_PX` below the centre, its ink centred on that
 *   box's own middle (the scale is about the card's centre, not the frame's).
 *
 * Contact sheets at a third of the size over a dark grey: each case's frames
 * (`screenCardSheetFrames`), and, per move, the landing beside the plain
 * `drawImage` and the frame after it, and the two moves drawn flat. The
 * summary prints the milliseconds per frame through `paintDrawList3d`.
 *
 * Under a glowing style (`energetic` here) the hole and the dim round it are
 * read on the held frame `L + N` rather than on `L + 1` (`holeFrame`): on
 * `L + 1` the edge sweep's glow reaches into the hole by design.
 *
 * **The edge sweep** (§6.16, "The edge sweep"; phase 3's piece 5), for each
 * glowing style read, on Tilt in (the sweep is the same after either move),
 * held to `EDGE_SWEEP_BAR` (`edgeSweepVerdict`): its first and last frames
 * from the lists (`L + 1` and `L + N − 1`) and the moving frames `L + 1 + N`;
 * a frame crossing the path's start carries two strokes; the frame after the
 * loop, `L + N`, against the card's frame at the end of its hold, max 0, and
 * the loop's last frame not equal to it; its glow on the crossing frame and
 * on the half-way frame, against the same frame with the glow left out,
 * beyond the reach from the sweep's own ink (`glowBeyondReach`, the reading
 * a74576d gave the hero, over the dim): no alpha added, colour within 2, and
 * the glow there; a contact sheet of the loop (`edgeSweepSheetFrames`: its
 * first frame, the crossing one, eighths of the loop, its last and the frame
 * after it) and one of the glow alone (with against without, over grey); and
 * the milliseconds a frame through `paintDrawList3d` over the sweep's frames.
 *
 * The true hand-off, the card's frame `L` against the RENDER's frame of the
 * recording beneath (within 2/255 mean on both machines), is M20, graphic.int's
 * phase-3 case (§6.11), piece 6's.
 */

import type { DrawItem, DrawList, GraphicTargets, Rect } from '@shared/graphics/items'
import { drawListAt } from '@shared/graphics/drawList'
import { cameraIsFlat, flatItems, glowItemsOf } from '@shared/graphics/compositor'
import { SETTLE_S, graphicMovingFrames } from '@shared/graphics/frame'
import { paintDrawList2d } from '@shared/graphics/paint'
import { resolveGraphicStyle, type GraphicStyle } from '@shared/graphics/style'
import type { GraphicSpec } from '@shared/graphics/template'
import { EDGE_SWEEP_SPAN, SCREEN_CARD_MOVES, bezelWidth, edgeSweepFrames, landingFrame, type ScreenCardMove } from '@shared/graphics/templates/screenCard'
import { createCompositor, paintDrawList3d, resetCompositorSession, type Compositor, type CompositorProbe } from '../graphicCompositor'
import { graphicMeasure } from '../graphicCanvas'
import { diffChannels } from './compositorMeasure'
import { glowBeyondReach } from './depthMeasure'
import {
  SCREEN_CARD_LOW_BOX_PX,
  SCREEN_CARD_MOVE_FRAME,
  alphaMaxIn,
  alphaOutside,
  edgeSweepCrossingFrame,
  edgeSweepSheetFrames,
  edgeSweepVerdict,
  inkRows,
  screenCardSheetFrames,
  screenCardVerdict,
  wholeRegion,
  type EdgeSweepReading,
  type ScreenCardReading
} from './screenCardMeasure'

export interface ScreenCardResult {
  size: { width: number; height: number }
  fps: number
  /** The stand-in recording's size and the card's box on the frame. */
  recording: { width: number; height: number }
  box: Rect
  cases: ScreenCardReading[]
  /** The edge sweep, one reading per glowing style read (piece 5). */
  sweeps: EdgeSweepReading[]
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
  const painterB = (list: DrawList, probe: CompositorProbe = {}): HTMLCanvasElement => {
    const { canvas, ctx } = canvas2d()
    ctx.drawImage(paintDrawList3d(list, compositor, { layer: freshLayer, images: bitmaps }, probe), 0, 0)
    return canvas
  }
  const painterA = (list: DrawList): HTMLCanvasElement => {
    const { canvas, ctx } = canvas2d()
    paintDrawList2d(ctx, { ...list, items: flatItems(list) }, { layer: freshLayer, images: bitmaps })
    return canvas
  }

  /** The edge sweep under a glowing style (piece 5): `lists` are the card's moving frames, `listAt` any frame of its `total`. */
  const readSweep = (style: GraphicStyle, lists: readonly DrawList[], total: number, listAt: (f: number) => DrawList): EdgeSweepReading => {
    const N = edgeSweepFrames(FPS)
    const sweepIds = (l: DrawList): string[] => l.items.filter((i) => i.kind === 'stroke' && i.id !== 'bezel').map((i) => i.id)
    const drawn = lists.map((l) => sweepIds(l).length > 0)
    const crossing = edgeSweepCrossingFrame(L, N, EDGE_SWEEP_SPAN)
    const held = pixelsOf(painterB(listAt(total - 1)))
    const afterLoop = diffChannels(pixelsOf(painterB(lists[lists.length - 1])), held)
    const lastSweep = diffChannels(pixelsOf(painterB(lists[Math.max(0, lists.length - 2)])), held)
    const glow: EdgeSweepReading['glow'] = []
    const glowSheet: HTMLCanvasElement[] = []
    for (const frame of [crossing, L + Math.round(N / 2)]) {
      const list = lists[frame]
      const radius = list.glow?.[0]?.radius ?? 0
      const withGlow = painterB(list)
      const withoutGlow = painterB(list, { glow: false })
      const withPixels = pixelsOf(withGlow)
      const withoutPixels = pixelsOf(withoutGlow)
      // The sweep's strokes alone, as the glow canvas holds them: the reach is read from their ink, not from the whole card's (the dim covers the frame).
      const ink = pixelsOf(painterA({ ...list, items: glowItemsOf(list.items, list.glow ?? []), glow: undefined }))
      const beyond = glowBeyondReach(ink, withPixels, withoutPixels, W, H, radius)
      // Route two's base under the dim and its hole, against painter A drawing the same list: the reading above is route two against route two.
      const base = diffChannels(withoutPixels, pixelsOf(painterA(list)))
      glow.push({
        frame,
        radius,
        reach: beyond.reach,
        outsideReach: beyond.outsideReach,
        outsideColour: beyond.outsideColour,
        outsidePixels: beyond.outsidePixels,
        present: diffChannels(withoutPixels, withPixels),
        base,
        holeAlpha: alphaMaxIn(withPixels, W, inside)
      })
      glowSheet.push(withGlow, withoutGlow)
    }
    const sweepLists = lists.slice(L + 1, L + N)
    const began = performance.now()
    for (const l of sweepLists) paintDrawList3d(l, compositor, { layer: freshLayer, images: bitmaps })
    const msPerFrame = (performance.now() - began) / Math.max(1, sweepLists.length)
    const shown = edgeSweepSheetFrames(L, N, EDGE_SWEEP_SPAN).filter((f) => f < lists.length)
    frames.canvas(`edge sweep under ${style.id}, frames ${shown.join(', ')} (L = ${L}, N = ${N}; frame ${crossing} crosses the path's start; ${L + N} is the held card)`, contactSheet(shown.map((f) => painterB(lists[f]))))
    frames.canvas(`edge sweep under ${style.id}: frames ${crossing} and ${L + Math.round(N / 2)}, each with its glow then with the glow left out`, contactSheet(glowSheet))
    const reading: EdgeSweepReading = {
      style: style.id,
      landing: L,
      loop: N,
      moving: lists.length,
      firstFrame: drawn.indexOf(true),
      lastFrame: drawn.lastIndexOf(true),
      crossing: { frame: crossing, pieces: sweepIds(lists[crossing] ?? { items: [], width: W, height: H }).length },
      afterLoop,
      afterLoopItems: lists[lists.length - 1].items.map((i) => i.id),
      lastSweep,
      glow,
      msPerFrame
    }
    summary.push(
      `edge sweep under ${style.id}: drawn on frames ${reading.firstFrame}..${reading.lastFrame} of ${reading.moving} moving (L ${L}, N ${N}); frame ${crossing} carries ${reading.crossing.pieces} strokes; ` +
        `the frame after the loop against the held card max ${afterLoop.maxAll} (${reading.afterLoopItems.join(', ')}), the loop's last against it max ${lastSweep.maxAll}; ` +
        glow
          .map((g) => `@${g.frame} glow radius ${g.radius.toFixed(1)} px, beyond its ${g.reach} px reach from the sweep's ink alpha added ${g.outsideReach} and colour off by ${g.outsideColour} over ${g.outsidePixels} pixels, with against without max ${g.present.maxAll}, the glow left out against painter A max ${g.base.maxAll} mean ${g.base.meanAll.toFixed(4)}, alpha inside the hole ${g.holeAlpha} (no bar)`)
          .join('; ') +
        `; ${msPerFrame.toFixed(1)} ms a frame through paintDrawList3d over the sweep's ${sweepLists.length} frames`
    )
    return reading
  }

  const cases: ScreenCardReading[] = []
  const sweeps: EdgeSweepReading[] = []
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
        // The hole on L + 1, or under a glowing style on the held frame L + N: the sweep's glow reaches into the hole on L + 1 by design.
        const holeFrame = style.glow ? moving - 1 : L + 1
        const after = painterB(lists[holeFrame])
        const afterPixels = pixelsOf(after)
        const outside = alphaOutside(afterPixels, W, H, around) ?? { min: -1, max: -1 }
        const early = diffChannels(pixelsOf(painterB(lists[SCREEN_CARD_MOVE_FRAME])), pixelsOf(landing))
        let flatScale: number | null = null
        let flatCentreOff: number | null = null
        if (move === 'pull-back') {
          const flat = painterA(lists[0])
          const ink = inkRows(pixelsOf(flat), W, H)
          flatScale = ink ? ink.height / box.height : null
          // The same frame on a box moved down: the scale must stay about the card's own centre, not the frame's.
          const low: Rect = { ...box, y: box.y + SCREEN_CARD_LOW_BOX_PX }
          const lowInk = inkRows(pixelsOf(painterA(drawListAt(spec, style, 0, FPS, size, measure, { screen: { box: low, file: srcOf(0) } }))), W, H)
          flatCentreOff = lowInk ? Math.abs(lowInk.top + lowInk.height / 2 - (low.y + low.height / 2)) : null
          if (styleId === 'clean') flatSheet.push(flat, painterA(lists[Math.round(L / 2)]))
        } else if (styleId === 'clean') flatSheet.push(painterA(lists[2]), painterA(lists[Math.round(L / 2)]))

        // Over the move, the landing and the settle (46 frames at 30 fps), as before the sweep: the sweep's frames are timed on their own below.
        const timed = lists.slice(0, Math.min(lists.length, L + 1 + Math.round(SETTLE_S * FPS)))
        const began = performance.now()
        for (const l of timed) paintDrawList3d(l, compositor, { layer: freshLayer, images: bitmaps })
        const msPerFrame = (performance.now() - began) / Math.max(1, timed.length)

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
          holeFrame,
          holeInside: alphaMaxIn(afterPixels, W, inside),
          holeOutside: outside,
          dimAlpha: Math.round(style.palette.dimOpacity * 255),
          early,
          flatScale,
          flatCentreOff
        }
        cases.push(reading)
        const shown = screenCardSheetFrames(L, moving)
        frames.canvas(`screen card: ${move} under ${style.id}, frames ${shown.join(', ')} of ${moving} (L = ${L})`, contactSheet(shown.map((f) => painterB(lists[f]))))
        if (styleId === 'clean') frames.canvas(`screen card: ${move}, the landing L = ${L}, a plain drawImage of the same frame into the box, and L + 1 (the hole)`, contactSheet([landing, plain.canvas, after]))
        summary.push(
          `screen card ${move} under ${style.id}: L ${L}, ${moving} moving frames, ${reading.movingCamera} off flat; camera at L ${JSON.stringify(reading.cameraAtL)}, after L ${reading.cameraAfter ? 'SOME' : 'none'}; ` +
            `frame 0 card opacity ${reading.firstOpacity.toFixed(4)}; landing against a plain drawImage mean ${handoff.meanAll.toFixed(3)}, max ${handoff.maxAll} over ${handoff.pixels} pixels; ` +
            `${holeFrame === L + 1 ? 'L + 1' : `the held frame ${holeFrame}`} alpha inside the hole ${reading.holeInside}, outside ${outside.min}..${outside.max} (the dim ${reading.dimAlpha}); frame ${SCREEN_CARD_MOVE_FRAME} against L max ${early.maxAll}` +
            (flatScale !== null ? `; drawn flat, frame 0 is ${flatScale.toFixed(3)} × the box` : '') +
            (flatCentreOff !== null ? `, its ink ${flatCentreOff.toFixed(1)} px off the centre of a box ${SCREEN_CARD_LOW_BOX_PX} px low` : '') +
            `; ${msPerFrame.toFixed(1)} ms a frame through paintDrawList3d`
        )

        if (style.glow && move === 'tilt-in') {
          const sweep = readSweep(style, lists, total, (f) => drawListAt(spec, style, f, FPS, size, measure, targetsAt(f)))
          sweeps.push(sweep)
        }
      }
    }
    frames.canvas('screen card drawn flat (WebGL missing, painter A): Tilt in at frames 2 and 15, Pull back at frames 0 and 15', contactSheet(flatSheet))
  } finally {
    compositor.dispose()
    for (const bitmap of bitmaps.values()) bitmap.close()
  }
  const cardVerdict = screenCardVerdict(cases)
  const sweepVerdict = edgeSweepVerdict(
    sweeps,
    SCREEN_CARD_CHECK_STYLES.filter((id) => resolveGraphicStyle(id).glow)
  )
  const verdict = { pass: cardVerdict.pass && sweepVerdict.pass, failures: [...cardVerdict.failures, ...sweepVerdict.failures] }
  summary.push(`screen card verdict: ${cardVerdict.pass ? 'PASS' : `FAIL: ${cardVerdict.failures.join('; ')}`}`)
  summary.push(`edge sweep verdict: ${sweepVerdict.pass ? 'PASS' : `FAIL: ${sweepVerdict.failures.join('; ')}`} over ${sweeps.length} glowing style${sweeps.length === 1 ? '' : 's'}`)
  if (!verdict.pass) notes.push(...verdict.failures.map((f) => `screen card: ${f}`))
  notes.push('screen card: the true hand-off (the card’s frame L against the render’s frame of the recording) is M20, graphic.int’s phase-3 case (§6.11), not read here.')
  return { size: { width: W, height: H }, fps: FPS, recording: { ...REC }, box, cases, sweeps, verdict }
}
