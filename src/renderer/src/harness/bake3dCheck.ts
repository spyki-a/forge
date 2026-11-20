/**
 * `window.__forgeGraphicCheck({ bake3d: true })` (phase 3's piece 6;
 * docs/CLIPS.md §6.12's "Phase 3" exit, its preview = export, M13 and
 * disposal lines; §6.15's M13 row, "3 (a 2.5D counter and a screen card)"),
 * on this page's own WebGL, through the app's own bake and Preview:
 *
 * - **Preview = export within 1/255** (`EXPORT_PARITY_BAR`, phase 2's
 *   `TEMPLATES_BAR` reading): specs.json's English `counter` and `ring` under
 *   `clean` with each of the four depths, and each as its clip's hero (the
 *   counter under `neon`, the ring under `energetic`, both glowing), at rest
 *   and on three moving frames (`exportParityFrames`); and the screen card
 *   (Tilt in and Pull back under `clean`, Tilt in under `energetic` with its
 *   edge sweep) over a stand-in recording, on its moving frames
 *   (`screenCardParityFrames`). Each frame read three ways: the Preview's own
 *   canvas (`graphicPreviewCanvas`, drawn again until its compositor and its
 *   pictures have landed), the harness's frames (`graphicFrameCanvases`), and
 *   the bake (`bakeGraphicSequence`, on the export's box route as an
 *   identity-placed clip asks; a list that needs the compositor bakes the
 *   canvas), its PNG decoded; each of the first two against the third over
 *   their ink (`diffOverInk`).
 * - **M13's bakes** (the 2.5D counter, the hero under neon; the screen card,
 *   Tilt in under clean and under energetic): each baked twice under two clip
 *   ids, the PNGs compared byte for byte here, and, where they are files (the
 *   development app), the two sequences named for the framemd5 of each
 *   (`m13Phase3Line`).
 * - **Disposal** (§6.12, proposal): the shared renderer's `info.memory`
 *   geometries and textures before each M13 case and after its bakes, its
 *   harness frames and its Preview entry forgotten (`forgetGraphicPreview`,
 *   the Preview's sweep on a clip's removal), and over the whole option
 *   (`memoryBack`).
 *
 * The stand-in recording is the `screenCard` option's (`standInFrame`, a
 * 1280×720 "screen" numbered by its frame), handed to the app as `blob:` URLs
 * (which `mediaUrl` passes through), so the bake and the Preview decode each
 * frame themselves as they decode a pulled one. In the development app the
 * bakes write title-frame sequences under clip ids
 * `graphic-check-bake3d-<run>-<case>-{a,b}`.
 */

import type { GraphicTargets, Rect } from '@shared/graphics/items'
import { drawListAt, needsCompositor } from '@shared/graphics/drawList'
import { compositorRoute } from '@shared/graphics/compositor'
import { screenCardSpec } from '@shared/graphics/screenCard'
import { graphicMovingFrames } from '@shared/graphics/frame'
import { resolveGraphicStyle, type GraphicStyle } from '@shared/graphics/style'
import type { GraphicSpec } from '@shared/graphics/template'
import { DEPTH_MOVES } from '@shared/graphics/templates/depth'
import { EDGE_SWEEP_SPAN, edgeSweepFrames, landingFrame } from '@shared/graphics/templates/screenCard'
import { facesFor } from '@shared/render/textPaint'
import { mediaUrl } from '@shared/mediaUrl'
import { useCatalog } from '../catalog'
import { sharedRenderer } from '../threeShared'
import {
  bakeGraphicSequence,
  forgetGraphicPreview,
  graphicDrawnFlat,
  graphicFrameCanvases,
  graphicMeasure,
  graphicPreviewCanvas,
  graphicPreviewHasCompositor,
  takeGraphicBakeNotes
} from '../graphicCanvas'
import { WEBGL_MISSING_NOTE } from '../graphicCompositor'
import { diffOverInk, framePath, type PixelDiff } from './graphicMeasure'
import { edgeSweepCrossingFrame } from './screenCardMeasure'
import { REC, standInFrame } from './screenCardCheck'
import {
  exportParityFrames,
  exportParityVerdict,
  m13Phase3Line,
  memoryBack,
  screenCardParityFrames,
  type ExportParityReading
} from './phase3Measure'

const W = 1080
const H = 1920
const FPS = 30
/** The fixtures read: specs.json's English counter and ring, as the depth option reads them. */
export const BAKE3D_FIXTURES: readonly string[] = Object.freeze(['counter-en', 'ring-en'])
/** Each fixture's hero is read under its own glowing style. */
export const BAKE3D_HERO_STYLE: Readonly<Record<string, string>> = Object.freeze({ 'counter-en': 'neon', 'ring-en': 'energetic' })
/** The cases baked twice for M13: a 2.5D counter, and the screen card with and without its sweep. */
export const BAKE3D_M13: readonly string[] = Object.freeze(['counter-en hero under neon', 'screen card tilt-in under clean', 'screen card tilt-in under energetic'])

type Memory = { geometries: number; textures: number }

export interface Bake3dResult {
  size: { width: number; height: number }
  fps: number
  cases: ExportParityReading[]
  /** M13's cases: their two sequences' patterns. */
  m13: { name: string; patterns: [string, string] }[]
  /** `info.memory` before and after each M13 case, and over the whole option. */
  memory: { name: string; before: Memory; after: Memory; back: boolean }[]
  verdict: { pass: boolean; failures: string[] }
  note: string
}

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('bake3d check: no 2D context')
  return { canvas, ctx }
}

/** A canvas's picture read through a copy (never the canvas itself: graphicCheck.ts `copiedPixels`). */
function copied(source: HTMLCanvasElement): Uint8ClampedArray {
  const { ctx } = canvas2d(source.width, source.height)
  ctx.drawImage(source, 0, 0)
  return ctx.getImageData(0, 0, source.width, source.height).data
}

export async function decodePng(bytes: ArrayBuffer, width: number, height: number): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  if (bitmap.width !== width || bitmap.height !== height) {
    const found = `${bitmap.width}x${bitmap.height}`
    bitmap.close()
    throw new Error(`bake3d check: a PNG is ${found}, not ${width}x${height}`)
  }
  const { ctx } = canvas2d(width, height)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return ctx.getImageData(0, 0, width, height).data
}

/**
 * One bake through `bakeGraphicSequence` on the export's box route
 * (`boxAllowed`; a list that needs the compositor bakes the canvas), its
 * writes recorded by frame with the time each landed (the bridge's own
 * `writeTitleFrame` wrapped, as graphicCheck.ts `recordingWrites`), or, where
 * the bridge cannot be wrapped, its files read back through the media scheme.
 * The `screenCard: '<path>'` option (M20) times its bakes through it too.
 */
export async function bakeRecorded(
  spec: GraphicSpec,
  style: GraphicStyle,
  id: string,
  size: { width: number; height: number },
  total: number,
  fps: number,
  targetsAt: (frame: number) => GraphicTargets
): Promise<{ value: { pattern: string; frames: number; box?: Rect }; bytes: Map<number, ArrayBuffer> | null; writtenAt: number[] | null; wallMs: number }> {
  const forge = window.forge as unknown as Record<string, unknown>
  const original = forge.writeTitleFrame as (clipId: string, frame: number, bytes: ArrayBuffer) => Promise<string>
  const writes = new Map<number, { bytes: ArrayBuffer; at: number }>()
  const recorder = (clipId: string, frame: number, bytes: ArrayBuffer): Promise<string> => {
    if (clipId === id) writes.set(frame, { bytes, at: performance.now() })
    return original.call(window.forge, clipId, frame, bytes)
  }
  let installed = false
  try {
    forge.writeTitleFrame = recorder
    installed = forge.writeTitleFrame === recorder
  } catch {
    installed = false
  }
  const began = performance.now()
  let value: { pattern: string; frames: number; box?: Rect } | null
  try {
    value = await bakeGraphicSequence(spec, style, id, size.width, size.height, total, fps, targetsAt, true)
  } finally {
    if (installed) forge.writeTitleFrame = original
  }
  const wallMs = performance.now() - began
  if (!value) throw new Error(`bake3d check: the bake of ${id} answered nothing`)
  if (installed) {
    const bytes = new Map([...writes].map(([i, w]) => [i, w.bytes]))
    const writtenAt = [...writes.entries()].sort((a, b) => a[0] - b[0]).map(([, w]) => w.at)
    return { value, bytes: writes.size === value.frames ? bytes : null, writtenAt, wallMs }
  }
  const read = new Map<number, ArrayBuffer>()
  for (let i = 0; i < value.frames; i++) {
    if (/^harness:/.test(value.pattern)) return { value, bytes: null, writtenAt: null, wallMs }
    try {
      const response = await fetch(mediaUrl(framePath(value.pattern, i)))
      if (!response.ok) return { value, bytes: null, writtenAt: null, wallMs }
      read.set(i, await response.arrayBuffer())
    } catch {
      return { value, bytes: null, writtenAt: null, wallMs }
    }
  }
  return { value, bytes: read, writtenAt: null, wallMs }
}

/** The Preview's own canvas at `frame`, drawn again while it says something is still landing (a compositor, a face, a picture), at most `tries` times. */
async function settledPreview(draw: (onReady: () => void) => HTMLCanvasElement | null, tries = 8, waitMs = 400): Promise<HTMLCanvasElement | null> {
  let canvas: HTMLCanvasElement | null = null
  for (let i = 0; i < tries; i++) {
    let called = false
    let wake: () => void = () => undefined
    const landed = new Promise<void>((resolve) => {
      wake = resolve
    })
    canvas = draw(() => {
      called = true
      wake()
    })
    await Promise.race([landed, new Promise<void>((resolve) => setTimeout(resolve, i === 0 ? waitMs : 200))])
    if (!called) break
  }
  return canvas
}

/** Two PNGs byte for byte (M13's within-a-machine reading); the M20 option compares its twice-baked cases through it too. */
export const sameBytes = (a: ArrayBuffer, b: ArrayBuffer): boolean => {
  if (a.byteLength !== b.byteLength) return false
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
  return true
}

let bake3dRun = 0

interface Bake3dCase {
  name: string
  spec: GraphicSpec
  style: GraphicStyle
  targetsAt: (frame: number) => GraphicTargets
  /** The frames read, from the moving frames. */
  read: (moving: number) => number[]
  twice: boolean
}

export async function checkBake3d(
  fixtures: readonly { id: string; spec: GraphicSpec }[],
  frames: { canvas: (label: string, canvas: HTMLCanvasElement) => void },
  summary: string[],
  notes: string[]
): Promise<Bake3dResult> {
  const run = ++bake3dRun
  const size = { width: W, height: H }
  const measure = graphicMeasure()
  const plain = resolveGraphicStyle('clean')
  const cases: Bake3dCase[] = []
  const noTargets = (): GraphicTargets => ({})
  for (const id of BAKE3D_FIXTURES) {
    const f = fixtures.find((x) => x.id === id)
    if (!f) throw new Error(`bake3d check: specs.json has no fixture ${id}`)
    const { depth: _d, hero: _h, ...base } = f.spec
    for (const move of DEPTH_MOVES) cases.push({ name: `${id} ${move} under clean`, spec: { ...base, depth: move }, style: plain, targetsAt: noTargets, read: exportParityFrames, twice: false })
    const heroStyle = resolveGraphicStyle(BAKE3D_HERO_STYLE[id])
    const name = `${id} hero under ${heroStyle.id}`
    cases.push({ name, spec: { ...base, depth: 'tilt', hero: true }, style: heroStyle, targetsAt: noTargets, read: exportParityFrames, twice: BAKE3D_M13.includes(name) })
  }

  // The stand-in recording, as blob: URLs the bake and the Preview decode for themselves.
  const L = landingFrame(FPS)
  const urls: string[] = []
  for (let f = 0; f <= L; f++) {
    const blob = await new Promise<Blob>((resolve, reject) => standInFrame(f).toBlob((b) => (b ? resolve(b) : reject(new Error('bake3d check: a stand-in frame did not encode'))), 'image/png'))
    urls.push(URL.createObjectURL(blob))
  }
  const scale = Math.min(W / REC.width, H / REC.height)
  const box: Rect = { x: (W - REC.width * scale) / 2, y: (H - REC.height * scale) / 2, width: REC.width * scale, height: REC.height * scale }
  const cardTargets = (f: number): GraphicTargets => ({ screen: { box, file: f <= L ? urls[f] : null } })
  for (const [move, styleId] of [['tilt-in', 'clean'], ['pull-back', 'clean'], ['tilt-in', 'energetic']] as const) {
    const style = resolveGraphicStyle(styleId)
    const name = `screen card ${move} under ${styleId}`
    const N = edgeSweepFrames(FPS)
    cases.push({
      name,
      // The store's own spec for a 10 s recording, so a change to the card's move follows here.
      spec: screenCardSpec({ id: 'standin', duration: 10 * FPS }, move, FPS),
      style,
      targetsAt: cardTargets,
      read: (moving) => screenCardParityFrames(L, moving, style.glow ? { crossing: edgeSweepCrossingFrame(L, N, EDGE_SWEEP_SPAN), loop: N } : null),
      twice: BAKE3D_M13.includes(name)
    })
  }

  // Every face the lists draw, before any painter paints.
  const { ensureFont } = useCatalog.getState()
  const faces = new Set<string>()
  for (const c of cases) {
    faces.add(c.style.font)
    for (const item of drawListAt(c.spec, c.style, 60, FPS, size, measure, c.targetsAt(60)).items) if (item.kind === 'text') for (const face of facesFor(item.look.font, item.text)) faces.add(face)
  }
  await Promise.all([...faces].map((face) => ensureFont(face)))

  const { renderer } = await sharedRenderer(W, H)
  const memoryNow = (): Memory => ({ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures })
  const optionBefore = memoryNow()
  const readings: ExportParityReading[] = []
  const m13: Bake3dResult['m13'] = []
  const memory: Bake3dResult['memory'] = []
  const slug = (s: string): string => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  // Notes a store bake left are not this option's (the export drops them before its bake too); each case's are taken after its bakes.
  takeGraphicBakeNotes()
  try {
    for (const c of cases) {
      const total = Math.max(1, Math.round(c.spec.seconds * FPS))
      const moving = graphicMovingFrames(c.spec, c.style, FPS, total)
      const read = c.read(moving)
      const liveId = `graphic-check-bake3d-live-${slug(c.name)}`
      const before = memoryNow()

      const harness = (await graphicFrameCanvases(c.spec, c.style, W, H, total, FPS, read, c.targetsAt)).map(copied)
      forgetGraphicPreview(liveId)
      const live: (Uint8ClampedArray | null)[] = []
      const flat: string[] = []
      for (const frame of read) {
        const canvas = await settledPreview((onReady) => graphicPreviewCanvas(liveId, c.spec, c.style, W, H, { frame, total, fps: FPS }, c.targetsAt(frame), onReady))
        live.push(canvas ? copied(canvas) : null)
        // A frame that wants the compositor and was drawn without one: WebGL missing (the dock's mark), or the Preview's cap full.
        const list = drawListAt(c.spec, c.style, Math.min(frame, moving - 1), FPS, size, measure, c.targetsAt(frame))
        if (needsCompositor(list) && compositorRoute(list) !== 'flat' && !graphicPreviewHasCompositor(liveId)) {
          flat.push(`the Preview @${frame} had no compositor (${graphicDrawnFlat(liveId) ? 'WebGL did not start' : 'none landed: the Preview\'s cap of 3 full, or still on its way'})`)
        }
      }
      forgetGraphicPreview(liveId)

      const first = await bakeRecorded(c.spec, c.style, `graphic-check-bake3d-${run}-${slug(c.name)}-a`, size, total, FPS, c.targetsAt)
      const second = c.twice ? await bakeRecorded(c.spec, c.style, `graphic-check-bake3d-${run}-${slug(c.name)}-b`, size, total, FPS, c.targetsAt) : null
      // Taken, so none is left for the user's next export; the WebGL note means the bake drew this 2.5D case flat.
      if (takeGraphicBakeNotes().includes(WEBGL_MISSING_NOTE)) flat.push(`the bake recorded "${WEBGL_MISSING_NOTE}"`)
      const region = first.value.box ?? { x: 0, y: 0, width: W, height: H }
      if (first.value.box) notes.push(`bake3d ${c.name}: the bake took the box route (${JSON.stringify(first.value.box)}); a list that needs the compositor must bake the canvas (§6.16)`)
      const liveDiffs: (PixelDiff | null)[] = []
      const harnessDiffs: PixelDiff[] = []
      const sheetTop: HTMLCanvasElement[] = []
      const sheetBottom: HTMLCanvasElement[] = []
      for (let i = 0; i < read.length; i++) {
        const bytes = first.bytes?.get(read[i])
        const baked = bytes && !first.value.box ? await decodePng(bytes, region.width, region.height) : null
        liveDiffs.push(baked && live[i] ? diffOverInk(live[i]!, baked, W, H) : null)
        harnessDiffs.push(baked ? diffOverInk(harness[i], baked, W, H) : { mean: Infinity, max: Infinity, differing: 0, pixels: 0 })
        const top = canvas2d(W, H)
        if (live[i]) top.ctx.putImageData(new ImageData(new Uint8ClampedArray(live[i]!), W, H), 0, 0)
        const bottom = canvas2d(W, H)
        if (baked) bottom.ctx.putImageData(new ImageData(new Uint8ClampedArray(baked), W, H), 0, 0)
        sheetTop.push(top.canvas)
        sheetBottom.push(bottom.canvas)
      }
      let twice: { equal: number; of: number } | null = null
      if (second) {
        let equal = 0
        if (first.bytes && second.bytes) for (const [i, b] of first.bytes) if (second.bytes.has(i) && sameBytes(b, second.bytes.get(i)!)) equal++
        twice = { equal, of: first.bytes?.size ?? 0 }
        m13.push({ name: c.name, patterns: [first.value.pattern, second.value.pattern] })
        const after = memoryNow()
        memory.push({ name: c.name, before, after, back: memoryBack(before, after) })
      }
      const reading: ExportParityReading = { name: c.name, frames: read, live: liveDiffs, harness: harnessDiffs, baked: first.value.frames, moving, twice, flat }
      readings.push(reading)
      // The sheet: the Preview (top) over the bake (bottom), at a sixth of the size, over grey.
      const cell = { width: W / 6, height: H / 6 }
      const sheet = canvas2d(cell.width * read.length, cell.height * 2)
      sheet.ctx.fillStyle = '#2a2a2a'
      sheet.ctx.fillRect(0, 0, sheet.canvas.width, sheet.canvas.height)
      read.forEach((_, i) => {
        sheet.ctx.drawImage(sheetTop[i], i * cell.width, 0, cell.width, cell.height)
        sheet.ctx.drawImage(sheetBottom[i], i * cell.width, cell.height, cell.width, cell.height)
      })
      frames.canvas(`bake3d ${c.name}: the Preview (top) and the bake (bottom) at frames ${read.join(', ')}`, sheet.canvas)
      const worst = (list: (PixelDiff | null)[]): string => list.map((d, i) => `@${read[i]} ${d ? `mean ${d.mean.toFixed(3)} max ${d.max}` : 'not drawn'}`).join(', ')
      summary.push(
        `bake3d ${c.name}: ${moving} moving frames, baked ${reading.baked}; over the ink, the Preview against the export ${worst(liveDiffs)}; the harness's frames against it ${worst(harnessDiffs)}` +
          (twice ? `; baked twice ${twice.equal} of ${twice.of} PNGs byte-equal` : '') +
          (flat.length ? `; DRAWN FLAT: ${flat.join('; ')}` : '; drawn in 2.5D (the Preview held a compositor on every frame that asks for one, the bake recorded no WebGL note)') +
          (memory.length && memory[memory.length - 1].name === c.name ? `; info.memory geometries / textures before ${before.geometries} / ${before.textures}, after its bakes and its Preview forgotten ${memory[memory.length - 1].after.geometries} / ${memory[memory.length - 1].after.textures}` : '')
      )
    }
  } finally {
    for (const url of urls) URL.revokeObjectURL(url)
  }
  const optionAfter = memoryNow()
  memory.push({ name: 'the whole option', before: optionBefore, after: optionAfter, back: memoryBack(optionBefore, optionAfter) })
  const parity = exportParityVerdict(readings)
  const failures = [...parity.failures, ...memory.filter((m) => !m.back).map((m) => `${m.name}: info.memory geometries / textures ${m.before.geometries} / ${m.before.textures} before, ${m.after.geometries} / ${m.after.textures} after`)]
  const verdict = { pass: failures.length === 0, failures }
  summary.push(`bake3d memory: ${memory.map((m) => `${m.name} ${m.before.geometries}/${m.before.textures} → ${m.after.geometries}/${m.after.textures}${m.back ? '' : ' (NOT BACK)'}`).join('; ')}`)
  const line = m13Phase3Line(m13)
  if (line) summary.push(line)
  summary.push(`bake3d verdict: ${verdict.pass ? 'PASS' : `FAIL: ${failures.join('; ')}`} over ${readings.length} cases`)
  if (!verdict.pass) notes.push(...failures.map((f) => `bake3d: ${f}`))
  return {
    size: { width: W, height: H },
    fps: FPS,
    cases: readings,
    m13,
    memory,
    verdict,
    note:
      'Preview = export (§6.12, phase 3): each case at 1080x1920 and 30 fps, its frames read by the Preview (graphicPreviewCanvas, drawn again until nothing is landing), the harness (graphicFrameCanvases) and the bake (bakeGraphicSequence, boxAllowed, its PNG decoded with no premultiply and no colour conversion), ' +
      'each of the first two against the bake over their ink (EXPORT_PARITY_BAR, a mean of at most 1 level). M13: the cases in BAKE3D_M13 baked twice under two ids, byte-compared here; in the development app their sequences are files for the framemd5 of each. ' +
      'Disposal: info.memory around each M13 case (its bakes, its harness frames and its Preview entry forgotten) and around the whole option.'
  }
}
