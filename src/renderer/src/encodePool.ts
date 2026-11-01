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
 *
 * Two back-ends (§6.3, "The bake region (M1) and the box route"; M2 taken
 * 2026-10-27, §6.15): the `toBlob` pool, each canvas's own encode on the
 * main thread's idle time; and module workers, each frame's picture taken off
 * its canvas as an `ImageBitmap` and transferred to a worker
 * (`graphicEncodeWorker.ts`, beside this file) that draws it on an
 * `OffscreenCanvas` and encodes it with `convertToBlob`. The drawing stays on
 * the main thread, where `drawTextOnto` sees the document's fonts. Measured
 * on the harness page in Chrome 152 (EFFECTS.md §61, M2): four workers 72 %
 * under the four-deep pool at p50 on the Mac and 79 % on the Surface, the
 * PNGs byte-identical to the pool's. The workers are the default where the
 * page has them; a page that refuses the worker (a CSP without `worker-src`,
 * the packaged app's not yet measured) falls back to the pool, once, for the
 * session, and the harness's M1 asks for the pool by name so its figure stays
 * the pool's.
 */

/** The two things the pool asks of a canvas. An `HTMLCanvasElement` is one. */
export interface PoolCanvas {
  getContext(contextId: '2d'): CanvasRenderingContext2D | null
  toBlob(callback: (blob: Blob | null) => void, type?: string): void
}

/**
 * One encoder of the depth: what turns a drawn canvas into PNG bytes. The
 * `toBlob` route is one per canvas; the worker route one per worker, the
 * frame in flight with it. `close` is called when the bake is over, finished
 * or not.
 */
export interface FrameEncoder {
  /** The PNG of what `canvas` holds now; the canvas may be drawn on again once this resolves. */
  encode(canvas: PoolCanvas): Promise<ArrayBuffer>
  close(): void
}

export interface EncodeFramesOptions {
  /** Frames to draw, numbered 0 to count − 1. */
  count: number
  width: number
  height: number
  /** Canvases, and so encodes in flight at once (workers, on that route); clamped to 1..count. */
  depth: number
  /** Draws frame `index` onto a cleared canvas; the context's state is restored after. */
  draw: (ctx: CanvasRenderingContext2D, index: number) => void
  /** Writes one encoded frame and returns its path. Called in frame order, one at a time. */
  write: (index: number, bytes: ArrayBuffer) => Promise<string>
  /** Asked before each draw and before each write; once true, nothing more is written. */
  cancelled: () => boolean
  /**
   * Which back-end: `'workers'` (the default) takes the module workers where
   * the page has them and falls back to the pool where it does not, or where
   * they were refused; `'pool'` is the `toBlob` pool whatever the page has,
   * which the harness's M1 asks for so that its figure is the pool's.
   */
  encoder?: 'workers' | 'pool'
}

function documentCanvas(width: number, height: number): PoolCanvas {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

let makeCanvas: (width: number, height: number) => PoolCanvas = documentCanvas

/**
 * Tests (canvases without a DOM) and the harness's graphics check (the
 * document's own canvases with `toBlob` timed, for M1's per-frame encode)
 * only; nothing that bakes calls it. `null` puts the document's back.
 */
export function setPoolCanvases(factory: ((width: number, height: number) => PoolCanvas) | null): void {
  makeCanvas = factory ?? documentCanvas
}

/* ---------------------------------------------------------- the toBlob pool */

function encodePng(canvas: PoolCanvas): Promise<ArrayBuffer> {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png')).then((blob) => {
    if (!blob) throw new Error('Could not encode a frame')
    return blob.arrayBuffer()
  })
}

/** The pool's encoder: the canvas's own `toBlob`. Stateless, so one serves every slot. */
const TO_BLOB: FrameEncoder = { encode: encodePng, close: () => undefined }

/* ------------------------------------------------------------- the workers */

/** How long a worker may take to answer its ping; a refusal by the page's CSP arrives at once, as an error event. */
const WORKER_START_MS = 10_000

/** Why the workers were refused on this page, once they were; the pool is taken from then on without asking again. */
let workersRefused: string | null = null

/** Whether this page can make the worker route at all: a module `Worker`, an `OffscreenCanvas` in it, and `createImageBitmap` to hand it the frame. */
function workersAvailable(): boolean {
  return typeof Worker === 'function' && typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function'
}

interface Reply {
  id: number
  ready?: boolean
  bytes?: ArrayBuffer
  error?: string
}

/** One module worker, started and answering its ping, or the reason it is not. */
function startWorker(): Promise<Worker | string> {
  let violation = ''
  const onViolation = (event: SecurityPolicyViolationEvent): void => {
    violation = `the page's CSP refused it (${event.effectiveDirective || event.violatedDirective}: ${event.blockedURI})`
  }
  const listens = typeof document !== 'undefined'
  if (listens) document.addEventListener('securitypolicyviolation', onViolation)
  let worker: Worker
  try {
    // A same-origin module file, never a `blob:` URL: the app's CSP (`index.html`, `script-src 'self'`, no `worker-src`) admits only that.
    worker = new Worker(new URL('./graphicEncodeWorker.ts', import.meta.url), { type: 'module' })
  } catch (error) {
    if (listens) document.removeEventListener('securitypolicyviolation', onViolation)
    return Promise.resolve(`the worker could not be made: ${error instanceof Error ? error.message : String(error)}`)
  }
  return new Promise<Worker | string>((resolve) => {
    const done = (answer: Worker | string): void => {
      clearTimeout(timer)
      worker.onerror = null
      worker.onmessage = null
      if (listens) document.removeEventListener('securitypolicyviolation', onViolation)
      if (typeof answer === 'string') worker.terminate()
      resolve(answer)
    }
    const timer = setTimeout(() => done(violation || `the worker did not answer within ${WORKER_START_MS / 1000} s`), WORKER_START_MS)
    worker.onerror = (event) => done(violation || `the worker failed to start: ${event.message || 'an error event with no message'}`)
    worker.onmessage = (event: MessageEvent<Reply>) => {
      if (event.data.ready) done(worker)
    }
    worker.postMessage('ping')
  })
}

/**
 * A worker as a `FrameEncoder`: each frame's picture off its canvas as an
 * `ImageBitmap` (a copy, so the canvas is free at once), transferred with an
 * id the reply carries back. One frame in flight per worker is what
 * `encodeFrames` sends; the map allows more.
 */
function workerEncoder(worker: Worker, width: number, height: number): FrameEncoder {
  const waiting = new Map<number, { resolve: (bytes: ArrayBuffer) => void; reject: (error: Error) => void }>()
  let next = 0
  const failAll = (message: string): void => {
    for (const job of waiting.values()) job.reject(new Error(message))
    waiting.clear()
  }
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const reply = event.data
    const job = waiting.get(reply.id)
    if (!job) return
    waiting.delete(reply.id)
    if (reply.bytes) job.resolve(reply.bytes)
    else job.reject(new Error(`Could not encode a frame in a worker: ${reply.error ?? 'no bytes'}`))
  }
  worker.onerror = (event) => failAll(`Could not encode a frame: the worker failed (${event.message || 'no message'})`)
  return {
    encode: async (canvas) => {
      const bitmap = await createImageBitmap(canvas as unknown as HTMLCanvasElement)
      const id = next++
      return new Promise<ArrayBuffer>((resolve, reject) => {
        waiting.set(id, { resolve, reject })
        worker.postMessage({ id, bitmap, width, height }, [bitmap])
      })
    },
    close: () => {
      worker.terminate()
      failAll('Could not encode a frame: the worker was closed')
    }
  }
}

/**
 * `count` workers, each started and answering, as encoders; null when any is
 * refused (every started one terminated), the reason remembered so no later
 * bake waits on the same refusal.
 */
async function startWorkers(count: number, width: number, height: number): Promise<FrameEncoder[] | null> {
  if (workersRefused !== null) return null
  const started = await Promise.all(Array.from({ length: count }, startWorker))
  const refused = started.find((s): s is string => typeof s === 'string')
  if (refused !== undefined) {
    for (const s of started) if (typeof s !== 'string') s.terminate()
    workersRefused = refused
    console.warn('Graphic frames are encoded on the main thread:', refused)
    return null
  }
  return started.map((worker) => workerEncoder(worker as Worker, width, height))
}

type EncoderFactory = (count: number, width: number, height: number) => Promise<FrameEncoder[] | null>

let makeEncoders: EncoderFactory | null = null

/**
 * Tests only (node has no `Worker` of the DOM's kind): stands in for the
 * workers, `count` encoders or null for "refused". `null` puts the real
 * workers back, taken where `workersAvailable()`.
 */
export function setPoolEncoders(factory: EncoderFactory | null): void {
  makeEncoders = factory
}

/** The encoders for a bake of `depth`: the workers when asked for and had, else the pool's `toBlob` in every slot. */
async function encodersFor(depth: number, width: number, height: number, route: 'workers' | 'pool'): Promise<FrameEncoder[]> {
  if (route === 'workers') {
    const factory = makeEncoders ?? (workersAvailable() ? startWorkers : null)
    const workers = factory ? await factory(depth, width, height) : null
    if (workers && workers.length > 0) return workers
  }
  return Array.from({ length: depth }, () => TO_BLOB)
}

/* -------------------------------------------------------------- the frames */

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
 * is written behind the caller's back once it has its answer. On the worker
 * route the depth is the number of workers, one frame in flight each (the
 * depth M1 read fastest, 4, is the fastest there too, §6.15); the workers are
 * closed when the call ends, however it ends.
 */
export async function encodeFrames(options: EncodeFramesOptions): Promise<string | null> {
  const { count, width, height, draw, write, cancelled } = options
  if (!(count >= 1)) return null
  const depth = Math.max(1, Math.min(count, Math.floor(options.depth) || 1))
  const encoders = await encodersFor(depth, width, height, options.encoder ?? 'workers')
  // The workers may be fewer than asked (a factory's answer); the slots are theirs.
  const slots = encoders.length
  const canvases = Array.from({ length: slots }, () => makeCanvas(width, height))
  // What each canvas last held: its frame's encode and its write.
  const jobs: (Promise<void> | undefined)[] = new Array(slots).fill(undefined)
  let stopped = false
  let last: string | null = null
  // The newest frame's job. Each job's write waits on the one before it.
  let previous: Promise<void> = Promise.resolve()

  try {
    for (let index = 0; index < count; index++) {
      const slot = index % slots
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

      const encoded = encoders[slot].encode(canvas)
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
  } finally {
    for (const encoder of encoders) encoder.close()
  }

  if (stopped || cancelled()) return null
  return last
}
