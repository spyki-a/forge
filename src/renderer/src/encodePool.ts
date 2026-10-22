/**
 * Frames drawn on canvases and encoded as PNGs, several at once.
 *
 * `captionBake.ts`'s pool, written once for every bake that writes a numbered
 * PNG sequence (docs/CLIPS.md §6.3, "`encodePool.ts` is extracted"). Drawing a
 * 1080×1920 frame costs a fraction of a millisecond; turning it into a PNG
 * costs tens, and that work runs off the main thread. Awaiting each encode in
 * turn leaves the encoder idle while the next frame is drawn and the drawing
 * idle while the last one encodes: on 60 caption pictures, 1000 ms in a
 * straight loop, 264 ms four at a time (captionBake.ts:119-128). So `depth`
 * canvases, one encode in flight per canvas, and a canvas is drawn on again
 * only once the frame it last held has been encoded and written.
 *
 * Written in phase 0 (§6.15's piece 0.2) so that M1 and M2 time the code that
 * ships: the harness check (`harness/graphicCheck.ts`) encodes its synthetic
 * graphic through this very function. `captionBake.ts` keeps its own loop in
 * step 3 (it writes a concat list and has no supersede guard).
 */

/** The two things the pool asks of a canvas. An `HTMLCanvasElement` is one. */
export interface PoolCanvas {
  getContext(contextId: '2d'): CanvasRenderingContext2D | null
  toBlob(callback: (blob: Blob | null) => void, type?: string): void
}

export interface EncodeFramesOptions {
  /** Frames to draw, numbered 0 to count − 1. */
  count: number
  width: number
  height: number
  /** Canvases, and so encodes in flight at once; clamped to 1..count. */
  depth: number
  /** Draws frame `index` onto a cleared canvas; the context's state is restored after. */
  draw: (ctx: CanvasRenderingContext2D, index: number) => void
  /** Writes one encoded frame and returns its path. Called in frame order, one at a time. */
  write: (index: number, bytes: ArrayBuffer) => Promise<string>
  /** Asked before each draw and before each write; once true, nothing more is written. */
  cancelled: () => boolean
}

function documentCanvas(width: number, height: number): PoolCanvas {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

let makeCanvas: (width: number, height: number) => PoolCanvas = documentCanvas

/** Tests only: canvases without a DOM. `null` puts the document's back. */
export function setPoolCanvases(factory: ((width: number, height: number) => PoolCanvas) | null): void {
  makeCanvas = factory ?? documentCanvas
}

function encodePng(canvas: PoolCanvas): Promise<ArrayBuffer> {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png')).then((blob) => {
    if (!blob) throw new Error('Could not encode a frame')
    return blob.arrayBuffer()
  })
}

/**
 * Draw, encode and write `count` frames through `depth` canvases.
 *
 * Resolves to the path the last `write` returned (for a bake through
 * `writeTitleFrame`, the sequence's pattern, the same for every frame), or
 * null when `cancelled()` was true at any check, the last one taken after the
 * final write, or when `count` is below 1 and there is no path to give. The
 * plan names the string only as `Promise<string | null>`; the last write's
 * path is the simplest reading of it.
 *
 * Writes go out in frame order, each after the one before has resolved, while
 * the encodes behind them overlap: a cancelled bake leaves frames 0..k on
 * disk, never a sequence with a hole in it. A failed encode or write rejects
 * the whole call, after every encode still in flight has settled, so nothing
 * is written behind the caller's back once it has its answer.
 */
export async function encodeFrames(options: EncodeFramesOptions): Promise<string | null> {
  const { count, width, height, draw, write, cancelled } = options
  if (!(count >= 1)) return null
  const depth = Math.max(1, Math.min(count, Math.floor(options.depth) || 1))
  const canvases = Array.from({ length: depth }, () => makeCanvas(width, height))
  // What each canvas last held: its frame's encode and its write.
  const jobs: (Promise<void> | undefined)[] = new Array(depth).fill(undefined)
  let stopped = false
  let last: string | null = null
  // The newest frame's job. Each job's write waits on the one before it.
  let previous: Promise<void> = Promise.resolve()

  try {
    for (let index = 0; index < count; index++) {
      const slot = index % depth
      // Reclaim the canvas only once the frame drawn on it has been encoded and written.
      const held = jobs[slot]
      if (held) await held
      if (stopped || cancelled()) {
        stopped = true
        break
      }

      const canvas = canvases[slot]
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not draw a frame: no 2D context')
      ctx.save()
      ctx.clearRect(0, 0, width, height)
      draw(ctx, index)
      ctx.restore()

      const encoded = encodePng(canvas)
      const before = previous
      const job = (async () => {
        const bytes = await encoded
        await before
        if (stopped || cancelled()) {
          stopped = true
          return
        }
        last = await write(index, bytes)
      })()
      // Handled here so a failure is never reported as unhandled while the loop
      // waits on another canvas, and no further frame is drawn after it; the
      // loop and the end still see it reject.
      job.catch(() => {
        stopped = true
      })
      jobs[slot] = job
      previous = job
    }
    await previous
  } catch (error) {
    stopped = true
    await Promise.allSettled(jobs.filter((job): job is Promise<void> => job !== undefined))
    throw error
  }

  if (stopped || cancelled()) return null
  return last
}
