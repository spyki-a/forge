/**
 * The Director eval's relay, in the harness page (tests/eval/relay.ts has the
 * server half and the reason it exists).
 *
 * A dumb loop on purpose: read the run's prepared requests, POST each body to
 * the model through the harness server's `/__lm` proxy exactly as node built
 * it, and write the raw answer back — status, time, and the server's JSON
 * untouched. Parsing, validating and scoring stay in node, where they are
 * tested. A request that already has an answer is skipped, so a run stopped
 * half way resumes where it was.
 *
 *   window.__forgeEvalRelay('<run>')         start (returns a promise)
 *   window.__forgeEvalProgress               { run, done, total, current, errors }
 *
 * And the one other thing node cannot do: draw type. The headline cards are
 * drawn by the app's own canvas renderer (textCanvas.ts), so an eval render
 * with them in it needs a browser. `cards.json` in the run lists each card's
 * spec and size (tests/eval/pipeline.ts `cardsOf`); each is drawn and written
 * back as the PNG the render then reads.
 *
 *   window.__forgeEvalCards('<run>')         draw every card (returns a promise)
 *   window.__forgeEvalCardsProgress          { run, done, total, errors, finished }
 *
 * And the moments (docs/PLAN.md §7), which need a GPU: `moments.json` lists
 * each one's spec, pictures and size (tests/eval/pipeline.ts `momentsOf`);
 * each moving frame is drawn with the app's own three.js from the run's
 * photos, served by the relay as pictures, and written back as the numbered
 * PNG the render reads.
 *
 *   window.__forgeEvalMoments('<run>')       draw every moment's frames (returns a promise)
 *   window.__forgeEvalMomentsProgress        { run, done, total, errors, finished }
 */

import type { MomentSpec, TextSpec } from '@shared/timeline'
import type { MomentTextures } from '@shared/render/momentTextures'
import { movingFrames } from '@shared/render/moment'
import { renderTextPng } from '../textCanvas'
import { momentFrameCanvases } from '../momentCanvas'

interface RelayRequest {
  id: string
  path: string
  body: unknown
}

interface Progress {
  run: string
  done: number
  total: number
  current: string | null
  errors: string[]
  finished: boolean
}

const file = (path: string): string => `/__eval/file?path=${encodeURIComponent(path)}`

async function relay(run: string): Promise<Progress> {
  const requests = (await (await fetch(file(`${run}/requests.json`))).json()) as RelayRequest[]
  const progress: Progress = { run, done: 0, total: requests.length, current: null, errors: [], finished: false }
  ;(window as unknown as { __forgeEvalProgress: Progress }).__forgeEvalProgress = progress

  for (const request of requests) {
    const target = `${run}/responses/${request.id}.json`
    const existing = await fetch(file(target))
    if (existing.ok) {
      progress.done++
      continue
    }
    progress.current = request.id
    const started = performance.now()
    let record: Record<string, unknown>
    try {
      const response = await fetch(`/__lm${request.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request.body)
      })
      const text = await response.text()
      const ms = Math.round(performance.now() - started)
      try {
        record = { id: request.id, status: response.status, ms, data: JSON.parse(text) as unknown }
      } catch {
        record = { id: request.id, status: response.status, ms, error: text.slice(0, 400) }
      }
    } catch (err) {
      record = {
        id: request.id,
        status: 0,
        ms: Math.round(performance.now() - started),
        error: err instanceof Error ? err.message : String(err)
      }
      progress.errors.push(`${request.id}: ${String(record.error)}`)
    }
    await fetch(file(target), { method: 'PUT', body: JSON.stringify(record, null, 2) })
    progress.done++
  }
  progress.current = null
  progress.finished = true
  return progress
}

interface CardRequest {
  id: string
  /** Where the PNG goes, relative to the run. */
  file: string
  spec: TextSpec
  width: number
  height: number
}

interface CardsProgress {
  run: string
  done: number
  total: number
  errors: string[]
  finished: boolean
}

async function cards(run: string): Promise<CardsProgress> {
  const list = (await (await fetch(file(`${run}/cards.json`))).json()) as CardRequest[]
  const progress: CardsProgress = { run, done: 0, total: list.length, errors: [], finished: false }
  ;(window as unknown as { __forgeEvalCardsProgress: CardsProgress }).__forgeEvalCardsProgress = progress

  for (const card of list) {
    try {
      const png = await renderTextPng(card.spec, card.width, card.height)
      const put = await fetch(file(`${run}/${card.file}`), { method: 'PUT', body: png })
      if (!put.ok) throw new Error(`the harness server answered ${put.status}`)
    } catch (err) {
      progress.errors.push(`${card.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
    progress.done++
  }
  progress.finished = true
  return progress
}

/**
 * A moment for the harness to draw (tests/eval/pipeline.ts `momentsOf`): the
 * spec, the two shots' pictures as paths RELATIVE TO THE EVAL FOLDER (the
 * relay serves nothing outside it), the size, and where the frames go.
 */
interface MomentRequest {
  id: string
  /** `moments/model/dir-moment-7.seq` — the frames land in it as `00000.png`… */
  dir: string
  spec: MomentSpec
  textures: MomentTextures
  width: number
  height: number
  frames: number
  fps: number
}

/**
 * Draw every moment of a run — three.js needs a GPU, which the harness has and
 * node does not. Each frame is drawn from the run's own photos (served by the
 * relay as pictures) and PUT back as the numbered PNG the render reads.
 */
async function moments(run: string): Promise<CardsProgress> {
  const list = (await (await fetch(file(`${run}/moments.json`))).json()) as MomentRequest[]
  const progress: CardsProgress = { run, done: 0, total: list.length, errors: [], finished: false }
  ;(window as unknown as { __forgeEvalMomentsProgress: CardsProgress }).__forgeEvalMomentsProgress = progress
  // An absolute URL, so mediaUrl passes it through untouched rather than wrapping it in forge-media://.
  const served = (path: string): string => `${location.origin}${file(path)}`
  const plan = <T extends { path: string; planes?: { file: string; depth: number }[] } | null>(p: T): T =>
    p ? { ...p, path: served(p.path), ...(p.planes ? { planes: p.planes.map((l) => ({ ...l, file: served(l.file) })) } : {}) } : p

  for (const m of list) {
    try {
      const textures: MomentTextures = { from: plan(m.textures.from), to: plan(m.textures.to)! }
      // Only the frames that move (a depth push holds; the render holds the last PNG for the rest).
      const frames = Array.from({ length: movingFrames(m.spec, m.fps, m.frames) }, (_, i) => i)
      const drawn = await momentFrameCanvases(m.spec, textures, m.width, m.height, m.frames, m.fps, frames)
      if (!drawn) throw new Error('did not draw — a picture did not load')
      for (const [i, canvas] of drawn.entries()) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        if (!blob) throw new Error(`frame ${i} could not be encoded`)
        const put = await fetch(file(`${run}/${m.dir}/${String(i).padStart(5, '0')}.png`), { method: 'PUT', body: blob })
        if (!put.ok) throw new Error(`the harness server answered ${put.status}`)
      }
    } catch (err) {
      progress.errors.push(`${m.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
    progress.done++
  }
  progress.finished = true
  return progress
}

export function installEvalRelay(): void {
  ;(window as unknown as { __forgeEvalRelay: typeof relay }).__forgeEvalRelay = relay
  ;(window as unknown as { __forgeEvalCards: typeof cards }).__forgeEvalCards = cards
  ;(window as unknown as { __forgeEvalMoments: typeof moments }).__forgeEvalMoments = moments
}
