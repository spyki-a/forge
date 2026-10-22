/**
 * M2's encoder (docs/CLIPS.md §6.15): one frame's picture in, its PNG out.
 *
 * The graphics check (`graphicCheck.ts`) draws each frame on the main thread,
 * where `drawTextOnto` sees the document's fonts, takes it off the canvas as
 * an `ImageBitmap`, and transfers it here; this worker draws it on an
 * `OffscreenCanvas` and encodes it with `convertToBlob`, the route §6.3 would
 * give `encodeFrames` as a worker back-end if M2 takes it. A same-origin
 * module file, not a `blob:` URL: the app's CSP (`index.html:7-8`,
 * `script-src 'self'` and no `worker-src`) admits only that. Moved beside
 * `encodePool.ts` only if M2 passes its bar.
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
