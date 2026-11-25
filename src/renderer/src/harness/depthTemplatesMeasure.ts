/**
 * The `parity` option's phase-3 half over named templates, its numbers and
 * its verdict (docs/CLIPS.md §9, "Measure in the harness" and step 6's 3D
 * exit; §6.11's `parity` row, phase 3's half; §6.12's phase-2 and phase-3
 * bars; the 3D templates' piece 3):
 *
 *   await window.__forgeGraphicCheck({ parity: true, templates: ['timeline', 'before-after', 'versus'] })
 *
 * Pure, so node's tests read the bars and the draw-list half without a
 * browser. The pictures are drawn by `depthTemplatesCheck.ts` and, for the
 * flat preview against the export, by the `templates` row's own reading
 * (graphicCheck.ts `readTemplateFixture`).
 */

import type { Camera, DrawItem, DrawList, Drawer, TextItem, TextMeasure } from '@shared/graphics/items'
import { drawListAt } from '@shared/graphics/drawList'
import { cameraIsFlat, focusRadius } from '@shared/graphics/compositor'
import { graphicMovingFrames } from '@shared/graphics/frame'
import type { GraphicStyle } from '@shared/graphics/style'
import { GRAPHIC_TEMPLATES, type GraphicSpec, type GraphicTemplateId } from '@shared/graphics/template'
import {
  DEPTH_DOLLY_FROM,
  DEPTH_FOCUS_BLUR_PX,
  DEPTH_FOCUS_LABEL_Z,
  DEPTH_MOVES,
  DEPTH_PARALLAX_YAW_FROM,
  DEPTH_TEMPLATES,
  DEPTH_TILT_FROM,
  type DepthMove,
  type DepthTemplate
} from '@shared/graphics/templates/depth'
import type { ChannelDiff } from './compositorMeasure'
import { DEPTH_BAR } from './depthMeasure'

/** The two shapes the depth readings are drawn at: the depth option's 540×960 (§6.16's readings are size-free; half the export's for time) and its 16:9 twin. */
export const DEPTH_TEMPLATE_SHAPES: readonly { readonly name: '9:16' | '16:9'; readonly width: number; readonly height: number }[] = Object.freeze([
  Object.freeze({ name: '9:16' as const, width: 540, height: 960 }),
  Object.freeze({ name: '16:9' as const, width: 960, height: 540 })
])

/** The flat preview against the export is read at the export's own sizes: the `templates` row's 1080×1920 and its 16:9 twin. */
export const FLAT_PARITY_WIDE: { readonly width: number; readonly height: number } = Object.freeze({ width: 1920, height: 1080 })

/** The bars: `DEPTH_BAR`'s for the depth readings (settled 0, the dead-branch guard), and WebGL missing drawn exactly as painter A draws the list. */
export const DEPTH_TEMPLATES_BAR = Object.freeze({
  settledMax: DEPTH_BAR.settledMax,
  firstMinMax: DEPTH_BAR.firstMinMax,
  missingMax: 0,
  /** On the first frame with ink, at least half of the move still to make: a move is seen, not spent on blank frames (the critics of piece 3). */
  moveLeftAtFirstInkMin: 0.5
})

/** The templates whose depth this half reads: a drawn depth template whose `TemplateDef.threeD` is true. */
export function isDepthTemplate(id: string): boolean {
  return (DEPTH_TEMPLATES as readonly string[]).includes(id) && GRAPHIC_TEMPLATES[id as GraphicTemplateId]?.threeD === true
}

/** The draw-list half of one depth: what node can read without a picture. */
export interface DepthListReading {
  /** The frames the bake draws (`graphicMovingFrames`), and how many carry a camera off flat (a blur above 0 counts). */
  moving: number
  movingCamera: number
  /** The first frame off flat (−1 for none), and the last moving frame's camera, every field exactly 0 at rest. */
  firstOffFlat: number
  /** The frames from the last beat's (`ceil(last beat × fps)`) on whose camera is off flat: 0, the move settles flat ON the last beat (§9, §6.16). */
  offFlatAfterLastBeat: number
  lastCamera: { tilt: number; yaw: number; dolly: number; focusPx: number } | null
  /**
   * Text items (text, look, box and opacity) compared against the flat
   * twin's over every moving frame, and where one differed (`@frame id`).
   * Not `z`, by design, and not the blur: focus is the camera's, so this
   * cannot see words blurred while said (the focus blur ends on the first
   * beat, templates/depth.ts `depthCamera`, and graphicDrawList pins it).
   */
  textsChecked: number
  textsDiffer: string[]
  /** The settled frame's whole list equal to the flat twin's, in its order (route one's picture). */
  settledListEqual: boolean
  /** The settled frame draws something (`hasListInk`): a drawer that draws nothing fails here, under its own name. */
  settledInk: boolean
  /**
   * The first frame where the flat twin shows ink (`hasListInk`: an item that
   * is not the dim, at opacity above 0, with extent; a stroke drawn), −1 for
   * none; and how much of its move the camera still has to make there, as a
   * fraction of the move's start (§6.16's `DEPTH_*_FROM`; under focus the
   * label plane's blur against `DEPTH_FOCUS_BLUR_PX`). A move spent while
   * nothing is on screen reads near 0 here.
   */
  firstInkFrame: number
  moveLeftAtFirstInk: number
}

/** An item that puts ink on the frame: not the dim, opacity above 0, a scale not 0, and extent (a text with words and a box, a shape with a box, a stroke drawn; a group with such a child). */
export function itemHasInk(item: DrawItem): boolean {
  if (item.kind === 'dim' || !(item.opacity > 0)) return false
  if (item.transform && item.transform.scale === 0) return false
  switch (item.kind) {
    case 'text':
      return item.text.trim() !== '' && item.box.width > 0 && item.box.height > 0
    case 'shape':
    case 'image':
      return item.box.width > 0 && item.box.height > 0
    case 'stroke':
      return item.to > item.from
    case 'group':
      return item.children.some(itemHasInk)
  }
}

export const hasListInk = (l: DrawList): boolean => l.items.some(itemHasInk)

/** The fraction of `move`'s start the camera still holds (1 at its start, 0 flat), for `template`'s label plane under focus. */
export function moveLeft(move: DepthMove, camera: Camera | undefined, template: DepthTemplate): number {
  if (!camera) return 0
  if (move === 'tilt') return camera.tilt / DEPTH_TILT_FROM
  if (move === 'parallax') return camera.yaw / DEPTH_PARALLAX_YAW_FROM
  if (move === 'dolly') return camera.dolly / DEPTH_DOLLY_FROM
  return focusRadius(camera, DEPTH_FOCUS_LABEL_Z[template]) / DEPTH_FOCUS_BLUR_PX
}

const texts = (l: DrawList): TextItem[] => l.items.filter((i): i is TextItem => i.kind === 'text')

/** One depth's draw-list reading of `spec` (its depth set) against its flat twin (the same spec with no depth and no hero); `drawer` for node's tests of the reading itself. */
export function depthListReading(spec: GraphicSpec, style: GraphicStyle, fps: number, size: { width: number; height: number }, measure: TextMeasure, drawer?: Drawer): DepthListReading {
  const { depth: _depth, hero: _hero, ...twinSpec } = spec
  const total = Math.max(1, Math.round(spec.seconds * fps))
  const moving = graphicMovingFrames(spec, style, fps, total)
  let movingCamera = 0
  let firstOffFlat = -1
  let offFlatAfterLastBeat = 0
  const lastBeatFrame = Math.ceil(Math.max(0, ...spec.beats.filter((b) => Number.isFinite(b))) * fps - 1e-6)
  let textsChecked = 0
  const textsDiffer: string[] = []
  let firstInkFrame = -1
  let moveLeftAtFirstInk = 0
  let last: DrawList | null = null
  let lastTwin: DrawList | null = null
  for (let f = 0; f < moving; f++) {
    const list = drawListAt(spec, style, f, fps, size, measure, {}, drawer)
    const twin = drawListAt(twinSpec, style, f, fps, size, measure, {}, drawer)
    if (firstInkFrame < 0 && hasListInk(twin)) {
      firstInkFrame = f
      moveLeftAtFirstInk = spec.depth && spec.depth !== 'flat' && isDepthTemplate(spec.data.template) ? moveLeft(spec.depth, list.camera, spec.data.template as DepthTemplate) : 0
    }
    if (!cameraIsFlat(list.camera)) {
      movingCamera++
      if (firstOffFlat < 0) firstOffFlat = f
      if (f >= lastBeatFrame) offFlatAfterLastBeat++
    }
    const own = new Map(texts(list).map((t) => [t.id, t]))
    const theirs = texts(twin)
    if (own.size !== theirs.length) textsDiffer.push(`@${f} ${own.size} text items against ${theirs.length}`)
    for (const t of theirs) {
      textsChecked++
      const o = own.get(t.id)
      if (!o || o.text !== t.text || JSON.stringify(o.look) !== JSON.stringify(t.look) || JSON.stringify(o.box) !== JSON.stringify(t.box) || o.opacity !== t.opacity) textsDiffer.push(`@${f} ${t.id}`)
    }
    last = list
    lastTwin = twin
  }
  const camera = last?.camera
  return {
    moving,
    movingCamera,
    firstOffFlat,
    offFlatAfterLastBeat,
    lastCamera: camera ? { tilt: camera.tilt, yaw: camera.yaw, dolly: camera.dolly, focusPx: camera.focus?.px ?? 0 } : null,
    textsChecked,
    textsDiffer,
    settledListEqual: last !== null && lastTwin !== null && JSON.stringify(last.items) === JSON.stringify(lastTwin.items),
    settledInk: last !== null && hasListInk(last),
    firstInkFrame,
    moveLeftAtFirstInk
  }
}

/** One depth of one fixture at one shape, read on the page: the list half and the pictures. */
export interface DepthTemplateMoveReading extends DepthListReading {
  move: DepthMove
  /** The settled frame through `paintDrawList3d` against the flat twin's by painter A (0 by route one). */
  settled: ChannelDiff
  /** The first frame where the twin has ink, and that frame through painter B against the twin's (the dead-branch guard). */
  firstFrame: number
  first: ChannelDiff
  /**
   * WebGL pretended missing: `createCompositor`'s answer, the bake notes the
   * harness frames left, the first frame off flat drawn by
   * `graphicFrameCanvases` against painter A's own picture of the same list
   * (camera and planes ignored), and the settled frame against the flat twin.
   * `frame` is the first frame with ink (`firstInkFrame`, off flat by the
   * first-ink bar), and `inked` says painter A's picture of it has ink: two
   * blank pictures would agree and prove nothing.
   */
  missing: { compositor: 'null' | 'a compositor'; notes: string[]; frame: number; inked: boolean; againstPainterA: ChannelDiff; settledAgainstTwin: ChannelDiff }
}

export interface DepthTemplateCase {
  fixture: string
  template: string
  shape: '9:16' | '16:9'
  width: number
  height: number
  moves: DepthTemplateMoveReading[]
  /** With WebGL missing, the Preview marked the clip drawn flat (the dock's note). */
  previewDrawnFlat: boolean
}

/** The flat preview against the export at one shape: the `templates` row's verdict (`TEMPLATES_BAR`, preview = export within 1/255). */
export interface FlatParityRow {
  fixture: string
  template: string
  shape: '9:16' | '16:9'
  width: number
  height: number
  pass: boolean
  /** The parts of `templateVerdict` that failed. */
  failed: string[]
  /** The worst mean, in levels, of either bake route against the preview over the ink (the bar is 1). */
  worstMean: number
}

const exactlyZero = (c: NonNullable<DepthListReading['lastCamera']>): string[] =>
  (
    [
      ['tilt', c.tilt],
      ['yaw', c.yaw],
      ['dolly', c.dolly],
      ['focus px', c.focusPx]
    ] as const
  )
    .filter(([, v]) => !Object.is(v, 0))
    .map(([field, v]) => `${field} ${v}`)

/** The bars of one depth's list half, every failure named (node reads these too). */
export function depthListFailures(name: string, r: DepthListReading): string[] {
  const failures: string[] = []
  if (r.lastCamera === null) failures.push(`${name}: the last moving frame carries no camera (the depth was not honoured)`)
  else for (const off of exactlyZero(r.lastCamera)) failures.push(`${name}: the last moving frame's ${off}, not exactly 0`)
  if (r.movingCamera === 0) failures.push(`${name}: no frame has a camera off flat (a dead branch)`)
  if (r.movingCamera >= r.moving) failures.push(`${name}: every frame moves, so the held frame is not the flat graphic's`)
  if (r.offFlatAfterLastBeat > 0) failures.push(`${name}: ${r.offFlatAfterLastBeat} frames from the last beat on are off flat (it must settle flat on the last beat)`)
  if (r.firstInkFrame < 0) failures.push(`${name}: no frame has ink`)
  else if (!(r.moveLeftAtFirstInk >= DEPTH_TEMPLATES_BAR.moveLeftAtFirstInkMin))
    failures.push(`${name}: on the first frame with ink (${r.firstInkFrame}) the camera has ${r.moveLeftAtFirstInk.toFixed(3)} of its move left, under ${DEPTH_TEMPLATES_BAR.moveLeftAtFirstInkMin} (the move is spent on blank frames)`)
  if (!r.settledInk) failures.push(`${name}: the settled frame draws nothing`)
  if (r.textsChecked === 0) failures.push(`${name}: no text item was compared`)
  if (r.textsDiffer.length > 0) failures.push(`${name}: text items changed by depth at ${r.textsDiffer.slice(0, 5).join(', ')}${r.textsDiffer.length > 5 ? ` and ${r.textsDiffer.length - 5} more` : ''}`)
  if (!r.settledListEqual) failures.push(`${name}: the settled frame's list is not the flat twin's`)
  return failures
}

/**
 * The verdict over the templates asked: each asked template that draws in
 * depth must have, for each of its fixtures, the flat preview against the
 * export passing at both shapes, and at both shapes each of the four depths
 * read and within its bars, WebGL missing included. A template asked that
 * has no depth, or no fixture, is FAIL and named; `byTemplate` carries it.
 */
export function depthTemplatesVerdict(
  asked: { depth: readonly string[]; notDepth: readonly string[]; noSpec: readonly string[]; unknown: readonly string[] },
  flat: readonly FlatParityRow[],
  cases: readonly DepthTemplateCase[],
  missingNote: string
): { pass: boolean; failures: string[]; byTemplate: Record<string, boolean> } {
  const failures: string[] = []
  const byTemplate: Record<string, boolean> = {}
  const fail = (template: string, line: string): void => {
    failures.push(line)
    byTemplate[template] = false
  }
  for (const t of asked.depth) byTemplate[t] = true
  for (const t of [...asked.notDepth, ...asked.noSpec, ...asked.unknown]) byTemplate[t] = false
  for (const t of asked.notDepth) failures.push(`${t}: not read, it has no depth (TemplateDef.threeD is not true, or templates/depth.ts has no rows for it)`)
  for (const t of asked.noSpec) failures.push(`${t}: not read, no fixture in specs.json`)
  for (const t of asked.unknown) failures.push(`${t}: not read, no drawer draws it`)

  for (const row of flat) if (!row.pass) fail(row.template, `${row.fixture} flat at ${row.shape} (${row.width}x${row.height}): preview against export FAIL (${row.failed.join(', ')}; worst mean ${row.worstMean.toFixed(3)})`)
  const B = DEPTH_TEMPLATES_BAR
  for (const c of cases) {
    for (const r of c.moves) {
      const name = `${c.fixture} ${r.move} at ${c.shape}`
      for (const line of depthListFailures(name, r)) fail(c.template, line)
      if (r.settled.maxAll > B.settledMax) fail(c.template, `${name}: the settled frame differs from its flat twin, max ${r.settled.maxAll} (route one must equal it)`)
      if (!(r.first.maxAll >= B.firstMinMax)) fail(c.template, `${name}: frame ${r.firstFrame} differs from its flat twin by at most ${r.first.maxAll} < ${B.firstMinMax} (a dead branch draws the twin)`)
      const m = r.missing
      if (m.compositor !== 'null') fail(c.template, `${name}: with WebGL missing, createCompositor gave ${m.compositor}`)
      if (m.notes.length !== 1 || m.notes[0] !== missingNote) fail(c.template, `${name}: with WebGL missing, the notes were ${JSON.stringify(m.notes)}, not the one note`)
      if (!m.inked) fail(c.template, `${name}: with WebGL missing, frame ${m.frame} has no ink, so drawing it flat proves nothing`)
      if (m.againstPainterA.maxAll > B.missingMax) fail(c.template, `${name}: with WebGL missing, frame ${m.frame} is not painter A's own picture (max ${m.againstPainterA.maxAll})`)
      if (m.settledAgainstTwin.maxAll > B.missingMax) fail(c.template, `${name}: with WebGL missing, the settled frame differs from its flat twin (max ${m.settledAgainstTwin.maxAll})`)
    }
    if (!c.previewDrawnFlat) fail(c.template, `${c.fixture} at ${c.shape}: with WebGL missing, the Preview did not mark its clip drawn flat (the dock would show no note)`)
  }
  // Every asked depth template, every fixture of it, both shapes, every move, and both flat shapes.
  for (const t of asked.depth) {
    const fixtures = [...new Set(cases.filter((c) => c.template === t).map((c) => c.fixture))]
    if (fixtures.length === 0) fail(t, `${t}: no depth case was read`)
    for (const fixture of fixtures) {
      for (const shape of DEPTH_TEMPLATE_SHAPES) {
        const c = cases.find((x) => x.fixture === fixture && x.shape === shape.name)
        if (!c) {
          fail(t, `${fixture} at ${shape.name}: not read`)
          continue
        }
        for (const move of DEPTH_MOVES) if (!c.moves.some((r) => r.move === move)) fail(t, `${fixture} ${move} at ${shape.name}: not read`)
        if (!flat.some((row) => row.fixture === fixture && row.shape === shape.name)) fail(t, `${fixture} flat at ${shape.name}: preview against export not read`)
      }
    }
  }
  return { pass: failures.length === 0, failures, byTemplate }
}
