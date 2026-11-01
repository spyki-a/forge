/**
 * The frame encoder's worker (docs/CLIPS.md §6.3, "The bake region (M1) and
 * the box route"; M2, §6.15): one frame's picture in, its PNG out.
 *
 * `encodeFrames` (`encodePool.ts`, beside this file) and the graphics check
 * (`harness/graphicCheck.ts`, M2) draw each frame on the main thread, where
 * `drawTextOnto` sees the document's fonts, take it off the canvas as an
 * `ImageBitmap`, and transfer it here; this worker draws it on an
 * `OffscreenCanvas` and encodes it with `convertToBlob`. A same-origin module
 * file, not a `blob:` URL: the app's CSP (`index.html:7-8`, `script-src
 * 'self'` and no `worker-src`) admits only that. Written for M2 under
 * `harness/` and moved here on 2026-11-01, M2 having passed on both machines
 * (2026-10-27): the bake's worker back-end, no longer the check's alone.
 *
 *   'ping'                          → { id: -1, ready: true }
 *   { id, bitmap, width, height }   → { id, bytes, ms } or { id, error }
 */

interface Job {
  id: number
  bitmap: ImageBitmap
  width: number
  height: number
}

/* This file runs as a worker; the renderer's DOM types describe a window, so the scope is named by what is used of it. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Job | 'ping'>) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
}

let canvas: OffscreenCanvas | null = null

scope.onmessage = (event) => {
  const job = event.data
  if (job === 'ping') {
    scope.postMessage({ id: -1, ready: true })
    return
  }
  void (async () => {
    try {
      if (!canvas || canvas.width !== job.width || canvas.height !== job.height) canvas = new OffscreenCanvas(job.width, job.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2D context on an OffscreenCanvas')
      ctx.clearRect(0, 0, job.width, job.height)
      ctx.drawImage(job.bitmap, 0, 0)
      job.bitmap.close()
      const started = performance.now()
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      const bytes = await blob.arrayBuffer()
      scope.postMessage({ id: job.id, bytes, ms: performance.now() - started }, [bytes])
    } catch (error) {
      scope.postMessage({ id: job.id, error: error instanceof Error ? error.message : String(error) })
    }
  })()
}

export {}
