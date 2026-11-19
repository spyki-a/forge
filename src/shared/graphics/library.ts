/**
 * The graphics engine's templates as things to place by hand: the Library's
 * Graphics drawer (try-out 1, 2026-11-15, piece 6, the owner's "all our
 * graphics engine assets can be visible in our library assets?"). One entry
 * per template a person can place by hand, each with its on-screen name and
 * a sample of plain English placeholder words; the spec the store lands for
 * one (`libraryGraphicSpec`); the tile's face (`librarySampleList`); and
 * where and whether one lands at a frame (`libraryGraphicAt`).
 *
 * The list is DERIVED from what is drawn (`drawnTemplates`, the drawers'
 * table, with GRAPHIC_TEMPLATES' rows): every template is listed or is left
 * out by a named reason in `LIBRARY_LEFT_OUT`, and tests/graphicLibrary.test.ts
 * fails until a new template is one or the other. The seven looks are not
 * here: a look is the project's setting (OUTPUT's Graphics section), not a
 * thing placed.
 *
 * No grounding, no proposal: a graphic placed from the Library is tied to no
 * words (the dock's panel says so, `NO_GROUNDING_NOTE`) and is the owner's
 * (`LIBRARY_GRAPHIC_RULE`). The app writes no headline and no name: every
 * word a tile lands with reads as a placeholder (`SPEAKER_PLACEHOLDER` for a
 * lower third over footage with no Speaker).
 *
 * Pure and node-runnable: no DOM, no clock, no `node:path`.
 */

import type { DragPayload } from '../dragPayload'
import type { MediaAsset, Project } from '../timeline'
import { momentSeed } from '../director/apply2'
import { drawnText, lastRoleOf, quoteSpeakerOf } from './apply'
import { LEAD_S, graphicSeconds, spreadBeats } from './beats'
import { byHandRefusal } from './budget'
import { drawListAt, drawnTemplates } from './drawList'
import { graphicMovingFrames } from './frame'
import { itemBounds, unionRect, type DrawList, type Rect, type TextMeasure } from './items'
import { NO_FREE_THIRD_NOTE, placeGraphic, thirdPreference } from './place'
import { footageOf } from './sound'
import type { GraphicStyle } from './style'
import { GRAPHIC_TEMPLATES, SPEAKER_PLACEHOLDER, type GraphicData, type GraphicSpec, type GraphicTemplateId } from './template'

/** One tile of the Graphics drawer: the template, its on-screen name and the placeholder words it lands with. */
export interface LibraryGraphic {
  id: GraphicTemplateId
  name: string
  data: GraphicData
}

/**
 * Why the callout is not offered (measured 2026-11-15 for piece 6): placed
 * by hand it carries no subject, and `drawCallout` draws NO items at all
 * when `targets.subject` is null (templates/callout.ts). `graphicTargetsAt`
 * falls back to the subject of the clip the captions follow, so it draws only
 * over footage with a subject track and a face on its first frame; over
 * footage with none, and over no footage, it would land as an empty clip.
 */
export const CALLOUT_LEFT_OUT = 'a callout points at a face in the shot, and placed by hand it draws nothing over footage with no subject found or over no footage'

/** Why the screen card is not offered: it frames a clip of yours (docs/CLIPS.md §6.16), so it is made from that clip in the dock, never placed on its own. */
export const SCREEN_CARD_LEFT_OUT = "the screen card frames a video clip of yours: it is made from that clip's Screen card in the dock, never placed on its own"

/** Why the quote's social kind is not offered: step 5's card (after the beta), every field pasted by the owner. */
export const SOCIAL_QUOTE_LEFT_OUT = 'the social quote card is step 5, after the beta, and is filled by pasting'

/** Each template the Library leaves out, with its reason. Every other template with a drawer is listed. */
export const LIBRARY_LEFT_OUT: Readonly<Partial<Record<GraphicTemplateId, string>>> = Object.freeze({
  callout: CALLOUT_LEFT_OUT,
  'screen-card': SCREEN_CARD_LEFT_OUT
})

/**
 * Each listed template's name and placeholder words. Plain English that reads
 * as a placeholder; the two titles are the templates' own fixed titles
 * (`fixedTitles`). A table by template, so a template added later has no
 * sample until one is written here, and the list's test says so.
 */
const SAMPLES: Readonly<Partial<Record<GraphicTemplateId, { name: string; data: GraphicData }>>> = Object.freeze({
  counter: { name: 'Counter', data: { template: 'counter', value: '100', label: 'Your label here' } },
  bars: {
    name: 'Bars',
    data: {
      template: 'bars',
      title: 'Compared',
      items: [
        { label: 'First', value: '40' },
        { label: 'Second', value: '70' },
        { label: 'Third', value: '100' }
      ]
    }
  },
  steps: {
    name: 'Steps',
    data: { template: 'steps', title: 'Step by step', items: [{ label: 'First step' }, { label: 'Second step' }, { label: 'Third step' }], connector: 'line' }
  },
  quote: { name: 'Quote', data: { template: 'quote', kind: 'said', text: 'Your quote here', speaker: '' } },
  ring: { name: 'Ring', data: { template: 'ring', value: '75%', label: 'Your label here' } },
  keyword: { name: 'Keyword', data: { template: 'keyword', words: 'Your words here', lit: 1 } },
  'lower-third': { name: 'Lower third', data: { template: 'lower-third', name: SPEAKER_PLACEHOLDER, role: 'Their role' } }
})

/** Every template id the engine knows a row or a drawer for, the drawn ones first in the drawers' order. */
export function libraryCandidates(): GraphicTemplateId[] {
  const out = drawnTemplates()
  for (const id of Object.keys(GRAPHIC_TEMPLATES) as GraphicTemplateId[]) if (!out.includes(id)) out.push(id)
  return out
}

/** The Graphics drawer's tiles, in the drawers' order: every drawn template with a row and a sample that is not left out. */
export const LIBRARY_GRAPHICS: readonly LibraryGraphic[] = Object.freeze(
  drawnTemplates()
    .filter((id) => LIBRARY_LEFT_OUT[id] === undefined && GRAPHIC_TEMPLATES[id] !== undefined && SAMPLES[id] !== undefined)
    .map((id) => Object.freeze({ id, name: SAMPLES[id]!.name, data: SAMPLES[id]!.data }))
)

/** The tile whose template is `id`, or undefined when the Library does not offer it. */
export function libraryGraphic(id: string): LibraryGraphic | undefined {
  return LIBRARY_GRAPHICS.find((e) => e.id === id)
}

/** The drawer's search: the tiles whose name holds `query`, ignoring case and the spaces around it. */
export function searchLibraryGraphics(query: string): LibraryGraphic[] {
  const q = query.trim().toLowerCase()
  return q === '' ? [...LIBRARY_GRAPHICS] : LIBRARY_GRAPHICS.filter((e) => e.name.toLowerCase().includes(q))
}

/** What a tile carries while dragged (dragPayload.ts): no file, the template's id. */
export function libraryDragPayload(entry: LibraryGraphic): DragPayload {
  return { kind: 'graphic', file: '', name: entry.name, template: entry.id }
}

/**
 * How many elements arrive in turn: a row per item for bars and steps, a
 * word per word for a said quote (its beats light words, one each, as the
 * drawer reads them, `litWordAt`), one for every other template.
 */
export function libraryElements(data: GraphicData): number {
  switch (data.template) {
    case 'bars':
    case 'steps':
      return Math.max(1, data.items.length)
    case 'quote':
      return Math.max(1, data.text.trim().split(/\s+/u).filter(Boolean).length)
    default:
      return 1
  }
}

/** The drawn words of a tile: the footage's Speaker for a lower third's name or a said quote's speaker, the Role carried over. */
function namedData(data: GraphicData, asset: Pick<MediaAsset, 'speaker' | 'credit'> | undefined, role: string): GraphicData {
  if (data.template === 'lower-third') {
    const name = asset?.speaker?.trim() ?? ''
    return { ...data, name: name === '' ? SPEAKER_PLACEHOLDER : name, role: role.trim() === '' ? data.role : role }
  }
  if (data.template === 'quote' && data.kind !== 'social') return { ...data, speaker: asset ? quoteSpeakerOf(asset) : '' }
  return data
}

/**
 * The whole spec the store lands for one tile, with no words to time on:
 *
 * - **beats**: every element arrives in turn, `LEAD_S` after the clip's
 *   start and then `spreadBeats`' 160 ms apart, the engine's own spacing; no
 *   second timing rule.
 * - **seconds**: the template's default, or longer where `graphicSeconds`
 *   (§6.2's reading hold over those beats and what it draws) asks for more,
 *   rounded up to 0.1 s; never past the template's max (a long Speaker then
 *   gets the panel's warning, never a block).
 * - **place**: `third` when given, else the template's first preferred
 *   third; `libraryGraphicAt` chooses it over the footage.
 * - no grounding, no proposal, no style of its own (the project's look).
 *
 * `asset` is the footage's under where it lands (its Speaker for a lower
 * third's name, else `SPEAKER_PLACEHOLDER`; `quoteSpeakerOf` for a said
 * quote's speaker); `role` a lower third's Role carried over (`lastRoleOf`).
 */
export function libraryGraphicSpec(
  entry: LibraryGraphic,
  options: { asset?: Pick<MediaAsset, 'speaker' | 'credit'>; role?: string; seed?: number; place?: GraphicSpec['place'] } = {}
): GraphicSpec {
  const def = GRAPHIC_TEMPLATES[entry.id]!
  const data = namedData(entry.data, options.asset, options.role ?? '')
  const beats = spreadBeats(Array.from({ length: libraryElements(data) }, () => LEAD_S))
  const need = graphicSeconds(def, beats, drawnText(data))
  const seconds = need === null ? def.seconds.max : Math.min(def.seconds.max, Math.max(def.seconds.default, Math.ceil(need * 10 - 1e-6) / 10))
  return {
    data,
    seconds,
    beats,
    place: options.place ?? { auto: true, third: thirdPreference(entry.id)[0] },
    seed: options.seed ?? 1,
    version: 1
  }
}

/** The tile's place: most of the tile, as OUTPUT's sample is drawn (OutputStrip.tsx `GRAPHIC_SAMPLE`). */
const TILE_PLACE: GraphicSpec['place'] = Object.freeze({ auto: false as const, box: Object.freeze({ x: 0.04, y: 0.04, width: 0.92, height: 0.92 }) })

/** The rate a tile is timed at; it only picks which frame is the settled one. */
const TILE_FPS = 30

/**
 * The frame a tile's face is laid out at: a real 16:9 frame, never the tile's
 * own few pixels. The templates lay out for a video frame; asked to lay out
 * at a tile's size (95 by 53 px on the harness page, 2026-11-15) bars drew
 * NO item and every other face set its lines on top of each other. So the
 * face is drawn here, at a size the fit tests cover, and the tile shows that
 * drawing scaled down (`librarySampleFace`, `tileFit`).
 */
export const TILE_FRAME: Readonly<{ width: number; height: number }> = Object.freeze({ width: 1280, height: 720 })

/** The share of the tile left clear around a face, each side. */
export const TILE_PAD = 0.08

/**
 * A tile's draw list: the entry's spec (its placeholder words) drawn by the
 * engine's own draw list at its settled frame, the last moving one
 * (`graphicMovingFrames` − 1, what the Preview holds past it), in `style`
 * (the project's look), at `TILE_FRAME`.
 */
export function librarySampleList(entry: LibraryGraphic, style: GraphicStyle, measure: TextMeasure): DrawList {
  const spec = libraryGraphicSpec(entry, { place: TILE_PLACE })
  const total = Math.max(1, Math.round(spec.seconds * TILE_FPS))
  const settled = Math.max(0, graphicMovingFrames(spec, style, TILE_FPS, total) - 1)
  return drawListAt(spec, style, settled, TILE_FPS, TILE_FRAME, measure)
}

/**
 * A tile's face: `librarySampleList` and the rectangle of `TILE_FRAME` its
 * items can ink (the union of `itemBounds`, held inside the frame), which is
 * the part the tile shows. `bounds` is null when nothing is drawn: the tile
 * then stays blank rather than showing a wrong picture.
 */
export function librarySampleFace(entry: LibraryGraphic, style: GraphicStyle, measure: TextMeasure): { list: DrawList; bounds: Rect | null } {
  const list = librarySampleList(entry, style, measure)
  let all: Rect | null = null
  for (const item of list.items) all = unionRect(all, itemBounds(item, TILE_FRAME, measure))
  if (!all) return { list, bounds: null }
  const x = Math.max(0, all.x)
  const y = Math.max(0, all.y)
  const width = Math.min(TILE_FRAME.width, all.x + all.width) - x
  const height = Math.min(TILE_FRAME.height, all.y + all.height) - y
  return { list, bounds: width > 0 && height > 0 ? { x, y, width, height } : null }
}

/**
 * Where a face's `bounds` go in a tile `tile` pixels large: scaled by one
 * factor (its shape kept), as large as fits with `TILE_PAD` clear on each
 * side, centred. The tile draws `bounds` of the laid-out frame into the
 * rectangle this returns.
 */
export function tileFit(bounds: Rect, tile: { width: number; height: number }): Rect {
  const room = { width: tile.width * (1 - 2 * TILE_PAD), height: tile.height * (1 - 2 * TILE_PAD) }
  const scale = Math.min(room.width / bounds.width, room.height / bounds.height)
  const width = bounds.width * scale
  const height = bounds.height * scale
  return { x: (tile.width - width) / 2, y: (tile.height - height) / 2, width, height }
}

/** A tile asked for that the Library does not offer (a stale drag). Not the plan's words. */
export const NOT_IN_LIBRARY_NOTE = 'that graphic is not in the Library'

/**
 * Whether and how one tile lands at project frame `start` (the dropped frame,
 * or the playhead): the spec with its third, its length in frames, the
 * footage clip under it (null: none), or why it is refused.
 *
 * - The footage is the clip the sounds and the Transcript tile read as a
 *   graphic's (`footageOf` at that frame): the bottom-most clip on a video
 *   track that draws nothing itself.
 * - Refused, as the Transcript tile's Add refuses (`byHandRefusal`, the
 *   budget's own rules 2 and 3): another graphic or a Director card on screen
 *   over any of its frames (`ON_SCREEN_REASON`), a zoom punch under it. The
 *   rules of taste (the 6 s gap, the count, the per-minute cap) are not
 *   read: the owner placed it.
 * - The third: over footage, `placeGraphic` (the third the captions leave,
 *   the subject's overlap read, the template's preference), the call Add's
 *   placement makes; none free, refused with `NO_FREE_THIRD_NOTE`. Over no
 *   footage, the template's first preferred third.
 * - A lower third takes the footage asset's Speaker and its last Role; a said
 *   quote its `quoteSpeakerOf`. The seed is `momentSeed(start, 0)`, as a
 *   landed graphic's.
 *
 * No clip end is read: a graphic placed by hand may run past its footage clip.
 */
export function libraryGraphicAt(
  project: Project,
  templateId: string,
  start: number
): { spec: GraphicSpec; duration: number; footageId: string | null } | { refused: string } {
  const entry = libraryGraphic(templateId)
  if (!entry) return { refused: NOT_IN_LIBRARY_NOTE }
  const at = Math.max(0, Math.round(start))
  const fps = project.settings.fps
  const footageId = footageOf(project, { id: '', start: at }, {})
  const footage = footageId === null ? undefined : project.clips.find((c) => c.id === footageId)
  const asset = footage ? project.assets.find((a) => a.id === footage.assetId) : undefined
  const spec = libraryGraphicSpec(entry, { asset, role: asset ? lastRoleOf(project, asset.id) : '', seed: momentSeed(at, 0) })
  const duration = Math.max(1, Math.round(spec.seconds * fps))
  const refused = byHandRefusal(project, footageId, at, duration)
  if (refused !== null) return { refused }
  const canvas = { width: project.settings.width, height: project.settings.height }
  const place = footageId === null ? spec.place : placeGraphic(project, footageId, at, duration, entry.id, canvas)
  if (!place) return { refused: NO_FREE_THIRD_NOTE }
  return { spec: { ...spec, place }, duration, footageId }
}
