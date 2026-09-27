/**
 * The moments, measured in the one place they can be: a browser with WebGL
 * (docs/PLAN.md §7.4). Node has no GPU, so the shaders are proved here and
 * the bake/overlay/timing path is proved by tests/integration/moment.int.test.ts
 * with a fake drawer that follows the same contract.
 *
 *   await window.__forgeMomentCheck()       → one record per kind, or throws
 *
 * For each of the four kinds, drawn over two synthetic pictures at its first
 * moving frame, its middle one and its last: the three frames differ from
 * each other; for the three bridges the first frame IS the outgoing picture
 * and the last IS the incoming one (mean difference under 2/255 — it measures
 * 0); for the depth push the first frame is the photo, and its last moving
 * frame equals the frame held to the end of the shot. Any of those failing
 * throws. The pictures are gradients with a square in them, so a blur, a
 * slide or a scale is a measurable difference and a plain copy is not. Also
 * timed: the drawing and the PNG encode of 1080×1920 frames, for EFFECTS.md
 * §34 — the synthetic pictures' figures, not a photograph's.
 */

import type { MomentKind, MomentSpec } from '@shared/timeline'
import { DRAWN_MOMENTS, MOMENT_SECONDS, movingFrames } from '@shared/render/moment'
import type { MomentTextures } from '@shared/render/momentTextures'
import { momentFrameCanvases } from '../momentCanvas'

export interface MomentCheck {
  kind: MomentKind
  /** Mean absolute difference (0..255) between the frames at t = 0, 0.5 and 1, pairwise. */
  differ: { first_mid: number; mid_last: number; first_last: number }
  /** Mean absolute difference between the frame at t = 1 and the incoming picture. */
  lastVsIncoming: number
  /** Mean absolute difference between the frame at t = 0 and the outgoing picture (the photo, for a depth push). */
  firstVsOutgoing: number
  /** Frames per second drawing 1080×1920 frames — the drawing half of the bake rate. */
  framesPerSecond: number
  /** Milliseconds to encode one 1080×1920 frame as PNG — the other half, which the export pays per frame. */
  encodeMs: number
  /** For a depth push, the frame at which the hold begins equals the last drawn one — `movingFrames`. */
  holdMatches: boolean | null
  frames: number
}

function picture(width: number, height: number, hue: number, square: { x: number; y: number }): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, width, height)
  grad.addColorStop(0, `hsl(${hue}, 70%, 25%)`)
  grad.addColorStop(1, `hsl(${hue + 60}, 70%, 65%)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(width * square.x, height * square.y, width * 0.2, height * 0.12)
  return canvas
}

function meanDiff(a: HTMLCanvasElement, b: HTMLCanvasElement): number {
  const pa = a.getContext('2d')!.getImageData(0, 0, a.width, a.height).data
  const pb = b.getContext('2d')!.getImageData(0, 0, b.width, b.height).data
  let sum = 0
  let n = 0
  for (let i = 0; i < pa.length; i += 4) {
    sum += Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2])
    n += 3
  }
  return n > 0 ? sum / n : 0
}

async function check(): Promise<MomentCheck[]> {
  const width = 270
  const height = 480
  const fps = 30
  const outgoing = picture(width, height, 10, { x: 0.15, y: 0.2 })
  const incoming = picture(width, height, 200, { x: 0.6, y: 0.65 })
  const plan = (canvas: HTMLCanvasElement, at: number) => ({
    path: canvas.toDataURL('image/png'),
    size: { width, height },
    fit: 'contain' as const,
    frames: 90,
    at
  })
  const out: MomentCheck[] = []
  for (const kind of DRAWN_MOMENTS) {
    const single = kind === 'depth-push'
    const spec: MomentSpec = {
      kind,
      ...(single ? {} : { from: { clipId: 'from' } }),
      to: { clipId: 'to' },
      seconds: MOMENT_SECONDS[kind].default,
      intensity: 0.7,
      seed: 12345,
      version: 1
    }
    // A bridge's clip is its span; a depth push's is its whole shot (three seconds here), of which its seconds move.
    const total = single ? 90 : Math.max(2, Math.round(spec.seconds * fps))
    const moving = movingFrames(spec, fps, total)
    const textures: MomentTextures = {
      from: single ? null : plan(outgoing, 0),
      to: plan(incoming, -Math.floor(total / 2))
    }
    const mid = Math.floor((moving - 1) / 2)
    const frames = await momentFrameCanvases(spec, textures, width, height, total, fps, [0, mid, moving - 1, total - 1])
    if (!frames) throw new Error(`${kind} did not draw`)
    const [first, middle, last, end] = frames

    // The bake rate, at the export's own size: the drawing, then the PNG encode the export pays per frame.
    const bakeTotal = 12
    const started = performance.now()
    const big = await momentFrameCanvases(spec, textures, 1080, 1920, single ? 90 : bakeTotal, fps, Array.from({ length: bakeTotal }, (_, i) => i))
    const seconds = (performance.now() - started) / 1000
    if (!big) throw new Error(`${kind} did not draw at 1080×1920`)
    const encodeStarted = performance.now()
    for (const canvas of big) await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    const encodeMs = (performance.now() - encodeStarted) / bakeTotal

    const record: MomentCheck = {
      kind,
      differ: { first_mid: meanDiff(first, middle), mid_last: meanDiff(middle, last), first_last: meanDiff(first, last) },
      lastVsIncoming: meanDiff(last, incoming),
      firstVsOutgoing: meanDiff(first, single ? incoming : outgoing),
      framesPerSecond: seconds > 0 ? bakeTotal / seconds : 0,
      encodeMs,
      holdMatches: single ? meanDiff(last, end) === 0 : null,
      frames: moving
    }
    // The contract, enforced: a number nobody compares is a number nobody reads.
    const limit = 2
    if (record.firstVsOutgoing > limit) throw new Error(`${kind}: the first frame is not the outgoing picture (${record.firstVsOutgoing.toFixed(2)}/255)`)
    if (!single && record.lastVsIncoming > limit) throw new Error(`${kind}: the last frame is not the incoming picture (${record.lastVsIncoming.toFixed(2)}/255)`)
    if (single && record.holdMatches === false) throw new Error(`${kind}: the held frame differs from the last moving one`)
    if (record.differ.first_mid < 1 || record.differ.mid_last < 1) throw new Error(`${kind}: its frames do not differ — nothing was drawn`)
    out.push(record)
  }

  /*
   * Footage: the incoming shot as six pulled frames (each a picture of its
   * own), a light burn into it. Its last frame is the last pulled frame,
   * exactly; the frame before differs from it, since the footage moved.
   */
  const pulledFrames = Array.from({ length: 6 }, (_, i) => picture(width, height, 120 + i * 20, { x: 0.1 + i * 0.12, y: 0.5 }))
  const burn: MomentSpec = { kind: 'light-burn', from: { clipId: 'from' }, to: { clipId: 'to' }, seconds: 0.55, intensity: 0.7, seed: 8, version: 1 }
  const total = Math.max(2, Math.round(burn.seconds * fps))
  const before = Math.floor(total / 2)
  const footage: MomentTextures = {
    from: plan(outgoing, 0),
    to: { ...plan(incoming, -before), pulled: { files: pulledFrames.map((c) => c.toDataURL('image/png')), first: 0 } }
  }
  const drawn = await momentFrameCanvases(burn, footage, width, height, total, fps, [total - 2, total - 1])
  if (!drawn) throw new Error('footage: did not draw')
  const [penultimate, last] = drawn
  const lastVsPulled = meanDiff(last, pulledFrames[5])
  const moved = meanDiff(penultimate, last)
  if (lastVsPulled > 2) throw new Error(`footage: the last frame is not the last pulled frame (${lastVsPulled.toFixed(2)}/255)`)
  if (moved < 1) throw new Error('footage: consecutive frames do not differ — the pulled frames are not advancing')
  out.push({
    kind: 'light-burn',
    differ: { first_mid: 0, mid_last: moved, first_last: 0 },
    lastVsIncoming: lastVsPulled,
    firstVsOutgoing: 0,
    framesPerSecond: 0,
    encodeMs: 0,
    holdMatches: null,
    frames: total
  })
  return out
}

export function installMomentCheck(): void {
  ;(window as unknown as { __forgeMomentCheck: typeof check }).__forgeMomentCheck = check
}
