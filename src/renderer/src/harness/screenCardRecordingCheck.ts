/**
 * `window.__forgeGraphicCheck({ screenCard: '<path to a 1080p screen recording>' })`
 * (docs/CLIPS.md §6.15's M20, §6.11's `screenCard: '<path>'` row; phase 3's
 * piece 6). **The development app only** (`npm run dev`, its DevTools): it
 * probes the file (`window.forge.probe`) and pulls its frames through the
 * moments' footage pre-pass (`screenTargetsAt`, `window.forge.momentFrames`),
 * which the harness page's bridge does not have. `screenCard: true`, the
 * stand-in, is the harness page's (screenCardCheck.ts), unchanged.
 *
 * The recording on V1 of a 1080×1920 project at 30 fps, as you would drop it
 * (its transform the default, so contained in the 9:16 frame), at most
 * `M20_MAX_S` of it; a card on V2 spanning it (`screenCardSpec`), its box
 * from `graphicTargetsAt`, its frames 0..L pulled from the file exactly as
 * the export pulls them (`screenCardFootage`, `screenTargetsAt`). Three cases:
 * Tilt in and Pull back under `clean`, and Tilt in under `energetic` (the
 * glowing style read: the one-loop edge sweep). For each:
 *
 * - **Legibility** (yours, by eye): a contact sheet of the move at a quarter
 *   size (frames 0, L/4, L/2, 3L/4, L, L + 1 and the held frame), and two
 *   frames at full size cut to the card's box: the landing `L` (the card flat,
 *   what the recording looks like at rest at 9:16) and `L/2` (the card
 *   moving, its text resampled under the tilt).
 * - **The bake's cost** against M1's whole-hold budget (`bakeBudget`,
 *   `WHOLE_HOLD_BUDGET`: 300 frames in under 10 s on the Surface): its moving
 *   frames, ms a frame (the bake's writes `GRAPHIC_POOL_DEPTH` at a time, p50,
 *   as the primitives option reads its bake), its wall, and 300 frames at
 *   that rate.
 * - **The hand-off on the card's own side** (`HANDOFF_BAR`, 2/255 mean,
 *   proposal): the baked PNG of frame `L`, decoded, against the pulled frame
 *   `L` drawn by a plain `drawImage` into the card's box, inside the box less
 *   the bezel. The render's side, the recording itself beneath at `L + 1`, is
 *   graphic.int's phase-3 case (the stand-in recording through the real plan)
 *   and the pre-pass's own EFFECTS §36 reading (the pulled frames against the
 *   render's, 1.1-1.2/255).
 * - **M13**: Tilt in under `clean` and under `energetic` baked twice, the PNGs
 *   compared byte for byte, and the two sequences named for the framemd5 of
 *   each (`m13Phase3Line`).
 *
 * The bakes write title-frame sequences under clip ids
 * `graphic-check-m20-<run>-<case>-{a,b}` in the app's title-frame folder. No
 * recording is kept by the check; the path is yours.
 */

import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import type { GraphicTargets, Rect } from '@shared/graphics/items'
import { drawnGraphicAsset, graphicMovingFrames } from '@shared/graphics/frame'
import { resolveGraphicStyle } from '@shared/graphics/style'
import { graphicTargetsAt } from '@shared/graphics/targets'
import { screenCardFootage, screenCardPulledFrames, screenCardRefusal, screenCardSpec } from '@shared/graphics/screenCard'
import { bezelWidth, landingFrame, type ScreenCardMove } from '@shared/graphics/templates/screenCard'
import { mediaUrl } from '@shared/mediaUrl'
import { GRAPHIC_POOL_DEPTH, graphicFrameCanvases, screenTargetsAt } from '../graphicCanvas'
import { diffChannels, type ChannelDiff } from './compositorMeasure'
import { perFrameMs, spread } from './graphicMeasure'
import { wholeRegion } from './screenCardMeasure'
import { bakeRecorded, decodePng } from './bake3dCheck'
import { bakeBudget, handoffWithin, m13Phase3Line, type BakeBudget } from './phase3Measure'

const W = 1080
const H = 1920
const FPS = 30
/** At most this much of the recording is laid on the timeline (a card spans its clip; the moving frames are at most L + 1 + the sweep's loop, 211 at 30 fps). */
export const M20_MAX_S = 20
/** The cases: each move under clean, and Tilt in under the glowing style read (its edge sweep). */
export const M20_CASES: readonly { move: ScreenCardMove; style: string; twice: boolean }[] = Object.freeze([
  { move: 'tilt-in', style: 'clean', twice: true },
  { move: 'pull-back', style: 'clean', twice: false },
  { move: 'tilt-in', style: 'energetic', twice: true }
])

export interface ScreenCardRecordingCase {
  move: ScreenCardMove
  style: string
  moving: number
  budget: BakeBudget
  /** ms a frame at p95 of the same writes. */
  p95: number
  handoff: ChannelDiff | null
  twice: { equal: number; of: number } | null
  patterns: string[]
}

export interface ScreenCardRecordingResult {
  /** The file as given, and its probed size, rate and length. */
  recording: { path: string; width: number; height: number; fps: number | null; frames: number }
  size: { width: number; height: number }
  fps: number
  box: Rect
  landing: number
  cases: ScreenCardRecordingCase[]
  verdict: { pass: boolean; failures: string[] }
  note: string
}

let m20Run = 0

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('screen card check: no 2D context')
  return { canvas, ctx }
}

/** A cut of `source` to `rect`, at its own pixels. */
function cut(source: HTMLCanvasElement, rect: Rect): HTMLCanvasElement {
  const x = Math.floor(rect.x)
  const y = Math.floor(rect.y)
  const { canvas, ctx } = canvas2d(Math.ceil(rect.width), Math.ceil(rect.height))
  ctx.fillStyle = '#2a2a2a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, -x, -y)
  return canvas
}

function contactSheet(pictures: readonly HTMLCanvasElement[], scale: number): HTMLCanvasElement {
  const w = Math.round(W * scale)
  const h = Math.round(H * scale)
  const { canvas, ctx } = canvas2d(w * pictures.length, h)
  ctx.fillStyle = '#2a2a2a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  pictures.forEach((p, i) => ctx.drawImage(p, i * w, 0, w, h))
  return canvas
}

export async function checkScreenCardRecording(
  path: string,
  frames: { canvas: (label: string, canvas: HTMLCanvasElement) => void },
  summary: string[],
  notes: string[]
): Promise<ScreenCardRecordingResult> {
  const where = "screenCard: '<path>' runs in the development app (npm run dev, its DevTools), where the recording can be probed and its frames pulled; on the harness page run screenCard: true"
  if (typeof path !== 'string' || path.trim() === '') throw new Error(`graphic check: screenCard takes true, or the path of a screen recording (§6.11): ${where}`)
  let probed: Awaited<ReturnType<typeof window.forge.probe>>
  try {
    probed = await window.forge.probe([path], FPS)
  } catch (error) {
    throw new Error(`graphic check: the recording could not be probed (${error instanceof Error ? error.message : String(error)}). ${where}`)
  }
  const found = probed.assets[0]
  if (!found || found.kind !== 'video' || !found.width || !found.height) {
    throw new Error(`graphic check: the recording did not probe as a video${probed.failed[0] ? ` (${probed.failed[0].error})` : ''}. ${where}`)
  }
  const run = ++m20Run
  const size = { width: W, height: H }
  const duration = Math.max(1, Math.min(found.durationFrames, M20_MAX_S * FPS))
  const asset: MediaAsset = { ...found, id: 'm20-recording' }
  const empty = emptyProject('graphic-check-m20')
  const clip = (over: Partial<Clip> & Pick<Clip, 'id' | 'assetId' | 'trackId' | 'start' | 'duration'>): Clip => ({
    inPoint: 0, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 }, ...over
  })
  const recording = clip({ id: 'm20-recording', assetId: asset.id, trackId: 'v1', start: 0, duration })
  const drawn = drawnGraphicAsset('m20-card', W, H, duration, 'screen card — graphic')
  const projectWith = (card: Clip | null): Project => ({
    ...empty,
    settings: { ...empty.settings, width: W, height: H, fps: FPS },
    captions: { enabled: false, styleId: empty.captions.styleId },
    assets: [asset, drawn],
    clips: card ? [recording, card] : [recording]
  })
  const refused = screenCardRefusal(projectWith(null), recording.id)
  if (refused) throw new Error(`graphic check: the recording cannot be a screen card here: ${refused}`)

  const L = landingFrame(FPS)
  const firstSpec = screenCardSpec(recording, 'tilt-in', FPS)
  const firstCard = clip({ id: 'm20-card', assetId: drawn.id, trackId: 'v2', start: 0, duration, graphic: firstSpec })
  const project = projectWith(firstCard)
  const box = graphicTargetsAt(project, firstCard, firstSpec, 0, size).screen?.box
  if (!box) throw new Error('graphic check: the card found no box for the recording')
  const footage = screenCardFootage(project, firstSpec, 0, screenCardPulledFrames(FPS), FPS)
  if (!footage) throw new Error('graphic check: no pull could be built for the recording')
  // One pull for every case: the request depends on the recording alone, as the export's does.
  let filled: (frame: number) => GraphicTargets
  try {
    filled = await screenTargetsAt(footage, (f) => graphicTargetsAt(project, firstCard, firstSpec, f, size))
  } catch (error) {
    throw new Error(`graphic check: the recording's frames could not be pulled (${error instanceof Error ? error.message : String(error)}). ${where}`)
  }

  // The pulled frame L drawn plainly into the box: the card's side of the hand-off reads against it.
  const landingFile = filled(L).screen?.file ?? null
  const plain = canvas2d(W, H)
  if (landingFile) {
    const response = await fetch(mediaUrl(landingFile))
    const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'none', colorSpaceConversion: 'none', premultiplyAlpha: 'none' } as ImageBitmapOptions)
    plain.ctx.drawImage(bitmap, box.x, box.y, box.width, box.height)
    bitmap.close()
  }
  const inside = wholeRegion(box, Math.ceil(bezelWidth(size) / 2) + 1, 'inset', size)

  const cases: ScreenCardRecordingCase[] = []
  const failures: string[] = []
  const m13: { name: string; patterns: [string, string] }[] = []
  for (const c of M20_CASES) {
    const style = resolveGraphicStyle(c.style)
    const spec = screenCardSpec(recording, c.move, FPS)
    const total = duration
    const moving = graphicMovingFrames(spec, style, FPS, total)
    const label = `${c.move} under ${c.style}`
    const shown = [...new Set([0, Math.round(L / 4), Math.round(L / 2), Math.round((3 * L) / 4), L, L + 1, moving - 1].filter((f) => f < total))]
    const pictures = await graphicFrameCanvases(spec, style, W, H, total, FPS, shown, filled)
    frames.canvas(`M20 ${label}: frames ${shown.join(', ')} of ${moving} moving (L = ${L}), a quarter size, over grey`, contactSheet(pictures, 1 / 4))
    frames.canvas(`M20 ${label}: frame ${L} (the landing, at rest) at full size, cut to the card's box`, cut(pictures[shown.indexOf(L)], box))
    frames.canvas(`M20 ${label}: frame ${Math.round(L / 2)} (moving) at full size, cut to the card's box`, cut(pictures[shown.indexOf(Math.round(L / 2))], box))

    const slug = `${c.move}-${c.style}`
    const first = await bakeRecorded(spec, style, `graphic-check-m20-${run}-${slug}-a`, size, total, FPS, filled)
    const timed = first.writtenAt ? spread(perFrameMs(first.writtenAt, Math.min(GRAPHIC_POOL_DEPTH, first.writtenAt.length))) : null
    const msPerFrame = timed ? timed.p50 : first.wallMs / Math.max(1, first.value.frames)
    const budget = bakeBudget(first.value.frames, msPerFrame, first.wallMs)
    let handoff: ChannelDiff | null = null
    const bytes = first.bytes?.get(L)
    if (bytes && landingFile && !first.value.box) handoff = diffChannels(await decodePng(bytes, W, H), plain.ctx.getImageData(0, 0, W, H).data, { width: W, rect: inside })
    let twice: { equal: number; of: number } | null = null
    const patterns = [first.value.pattern]
    if (c.twice) {
      const second = await bakeRecorded(spec, style, `graphic-check-m20-${run}-${slug}-b`, size, total, FPS, filled)
      let equal = 0
      if (first.bytes && second.bytes) {
        for (const [i, b] of first.bytes) {
          const o = second.bytes.get(i)
          if (o && o.byteLength === b.byteLength && new Uint8Array(o).every((v, k) => v === new Uint8Array(b)[k])) equal++
        }
      }
      twice = { equal, of: first.bytes?.size ?? 0 }
      patterns.push(second.value.pattern)
      m13.push({ name: `screen card ${label}`, patterns: [first.value.pattern, second.value.pattern] })
      if (!(twice.of > 0 && twice.equal === twice.of)) failures.push(`${label}: baked twice, ${twice.equal} of ${twice.of} PNGs byte-equal`)
    }
    if (!budget.withinFrames) failures.push(`${label}: ${budget.frames} moving frames, over the whole-hold budget's 300`)
    if (!budget.withinRate) failures.push(`${label}: ${budget.msPerFrame.toFixed(1)} ms a frame, 300 frames in ${(budget.projectedMs / 1000).toFixed(2)} s, over the budget's 10 s`)
    if (!handoffWithin(handoff)) failures.push(`${label}: the hand-off on the card's side ${handoff ? `mean ${handoff.meanAll.toFixed(3)}` : 'not read'} (bar 2/255)`)
    cases.push({ move: c.move, style: c.style, moving, budget, p95: timed ? timed.p95 : NaN, handoff, twice, patterns })
    summary.push(
      `M20 ${label}: ${moving} moving frames of ${total}; bake ${budget.frames} frames, ${budget.msPerFrame.toFixed(1)} ms a frame at p50${timed ? ` (p95 ${timed.p95.toFixed(1)})` : ' (by its wall)'}, wall ${(budget.totalMs / 1000).toFixed(2)} s, 300 frames at this rate ${(budget.projectedMs / 1000).toFixed(2)} s against the budget's 10 s (${budget.withinFrames && budget.withinRate ? 'within' : 'OVER'})` +
        `; the hand-off on the card's side (its baked frame ${L} against the pulled frame ${L} by drawImage, inside the box less the bezel) ${handoff ? `mean ${handoff.meanAll.toFixed(3)}, max ${handoff.maxAll}` : 'not read'}` +
        (twice ? `; baked twice ${twice.equal} of ${twice.of} PNGs byte-equal` : '')
    )
  }
  const line = m13Phase3Line(m13)
  if (line) summary.push(line)
  const verdict = { pass: failures.length === 0, failures }
  summary.push(`M20 verdict: ${verdict.pass ? 'PASS' : `FAIL: ${failures.join('; ')}`}; legibility at rest and moving is yours, on the sheets`)
  notes.push("M20: legible at rest and its moving frames within M1's whole-hold budget ships the card as planned; legible but slow, Tilt in only; not legible, no card (§6.15's outcome table). The hand-off's render side is graphic.int's phase-3 case.")
  return {
    recording: { path, width: found.width, height: found.height, fps: found.fps ?? null, frames: found.durationFrames },
    size,
    fps: FPS,
    box,
    landing: L,
    cases,
    verdict,
    note:
      'M20 (§6.15): the recording contained in a 1080x1920 frame at 30 fps, a card spanning it, its frames 0..L pulled through screenTargetsAt as the export pulls them; each case drawn by graphicFrameCanvases for the sheets and baked by bakeGraphicSequence (timed by its writes GRAPHIC_POOL_DEPTH at a time), ' +
      "frame L's PNG read against the pulled frame L drawn into the box (HANDOFF_BAR). Run it on the Mac and on the Surface; the bars are the budget's and the hand-off's, the eye's is legibility."
  }
}
