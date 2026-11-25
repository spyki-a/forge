/**
 * A creator style, "my look" (docs/CLIPS.md §10, step 7's first bullet): a
 * caption style and a graphic style saved together, exported and imported as
 * a small file with MARKET.md §1's header (`author`, `version`, `licence`),
 * and applied in one click.
 *
 * What a look holds is the two styles and nothing else: the caption preset
 * with its overrides and placement, the graphic preset with its overrides.
 * NOT whether captions are on, not the graphics' sound switch, no text, no
 * clip, no media, no path, no font FILE (a font is named by its family), no
 * key and nothing from Settings.
 *
 * Reading a file is reading a stranger's input, so `parseLook` never throws:
 * it keeps only the keys it knows, each value only if the renderer would use
 * it, builds every object itself (no key named `__proto__`, `constructor` or
 * `prototype` is ever copied, since only allow-listed keys are read), caps
 * every string, and answers a plain reason or the look with plain notes. No
 * reason or note carries the file's content or a path.
 *
 * Every line a person reads is a named constant here, for the OUTPUT strip's
 * "My look" section and the census.
 *
 * Pure: no DOM, no `node:path`, no clock; the caller passes what it needs.
 */

import {
  CAPTION_STYLES,
  resolveStyle,
  type CaptionStyle,
  type StyleOverrides
} from './captions/style'
import {
  GRAPHIC_OVERRIDE_KEYS,
  GRAPHIC_STYLES,
  graphicOverrideAccepted,
  resolveGraphicStyle
} from './graphics/style'
import { TEXT_STYLES } from './render/textStyle'
import { TEXT_ANIMATIONS } from './render/textAnimation'
import { safeTakeBase } from './render/voiceover'
import type { Project } from './timeline'

/* ------------------------------------------------------------ the format */

/** What a look file says it is. */
export const LOOK_KIND = 'forge-look'
/** The FILE format's number, for a later migration: a file with a larger one is refused as made by a newer app. */
export const LOOK_SCHEMA = 1
/** A look file's extension, without the dot. */
export const LOOK_EXTENSION = 'forgelook'
export { LOOK_CHANNELS } from './lookChannels'
/** The settings key the saved looks are kept under (app-level, not in a project). */
export const LOOKS_SETTING = 'creatorLooks'

/**
 * The largest look file read, in bytes, refused before it is parsed. A look
 * holding every override and the longest name, maker and licence line it
 * may carry serialises to under 4 KB (tests/look.test.ts measures it), so
 * 64 KB leaves room for a hand-edited, re-indented file and still refuses,
 * before any parse, anything that is plainly not a look.
 */
export const LOOK_FILE_MAX_BYTES = 64 * 1024
/** The longest name kept, in characters (code points). */
export const LOOK_NAME_MAX = 60
/** The longest maker ("author") kept. */
export const LOOK_AUTHOR_MAX = 80
/** The longest licence line kept. */
export const LOOK_LICENCE_MAX = 200
/** The longest font family name kept (the longest in the catalogue is far shorter). */
export const LOOK_FONT_MAX = 100
/**
 * How many looks may be saved. Each sane look is bounded (every string
 * capped, only known keys), at most a few KB, so fifty keep the settings file
 * small; and fifty rows is already a long list in a 240-pixel column.
 */
export const SAVED_LOOKS_MAX = 50
/** The largest version number kept; anything else reads as 1, and saving over a look at it keeps it there. */
export const LOOK_VERSION_MAX = 1_000_000

/** The header MARKET.md §1 names: who made it, which version, what the receiver may do. */
export interface LookHeader {
  /** Who made the look; may be empty. */
  author: string
  /** The look's own version, a whole number from 1; saving over a look of the same name adds 1. */
  version: number
  /** What the receiver may do, in the maker's words; may be empty. The app writes no wording of its own (MARKET.md §10 item 3 is the owner's). */
  licence: string
}

export interface LookCaptions {
  /** A CAPTION_STYLES id. */
  styleId: string
  /** Absent when the look has none: applying it clears the project's. */
  overrides?: StyleOverrides
  /** 'smart' or absent (the style's own place), as CaptionSettings writes it. */
  placement?: 'smart'
}

export interface LookGraphics {
  /** A GRAPHIC_STYLES id. */
  styleId: string
  /** Dotted keys, as GraphicsSettings holds them; absent when none. */
  overrides?: Record<string, unknown>
}

export interface Look extends LookHeader {
  kind: typeof LOOK_KIND
  schema: typeof LOOK_SCHEMA
  name: string
  captions: LookCaptions
  graphics: LookGraphics
}

/** What reading a look answers: the look with its notes, or why it was refused. */
export type LookRead = { ok: true; look: Look; notes: string[] } | { ok: false; reason: string }

/* ------------------------------------------------------- the words shown */

/** The OUTPUT strip section's name. */
export const LOOK_SECTION_LABEL = 'My look'
/** A file that is not a look, or not one this app wrote. */
export const LOOK_NOT_A_LOOK = 'This file is not a saved look. Choose a file that ends in .forgelook.'
/** A file over LOOK_FILE_MAX_BYTES, refused before it is read. */
export const LOOK_TOO_LARGE = 'This file is too large to be a saved look. Choose a file that ends in .forgelook.'
/** A file that could not be opened or read as a look at all. */
export const LOOK_UNREADABLE = 'This file could not be read. It may be damaged: ask for it again, or choose another file.'
/** A schema newer than LOOK_SCHEMA. */
export const LOOK_NEWER = 'This look was made by a newer version of the app. Update the app, then import it again.'
/** A caption preset this app does not have. */
export const LOOK_UNKNOWN_CAPTION_STYLE =
  'This look uses a caption style this version of the app does not have. Update the app, then import it again.'
/** A graphic preset this app does not have. */
export const LOOK_UNKNOWN_GRAPHIC_STYLE =
  'This look uses a graphic style this version of the app does not have. Update the app, then import it again.'
/** A text style id (captions' or graphics') this app does not have, dropped. */
export const LOOK_NOTE_TEXT_STYLE = 'A text style in this look is not in this version of the app, so the style’s own is used.'
/** A caption animation id this app does not have, dropped. */
export const LOOK_NOTE_ANIMATION = 'An animation in this look is not in this version of the app, so the style’s own is used.'
/** A name, maker or licence line past its cap. */
export const LOOK_NOTE_SHORTENED = 'A name, maker or licence line in this look was too long and was shortened.'
/** An import whose name was already saved. */
export const LOOK_NOTE_RENAMED = 'A saved look already had this name, so a number was added after it.'
/** Save pressed with no name. */
export const LOOK_NAME_NEEDED = 'Type a name to save this look.'
/** Save or import with the list full. */
export const LOOK_LIST_FULL = `You have ${SAVED_LOOKS_MAX} saved looks. Remove one to save or import another.`
/** An export that could not be written. */
export const LOOK_EXPORT_FAILED = 'The look could not be written. Choose another folder and try again.'

/** How many override settings were left out: one note for all of them. */
export function lookDroppedNote(count: number): string {
  return count === 1
    ? '1 setting in this look could not be used and was left out.'
    : `${count} settings in this look could not be used and were left out.`
}

/** A font family the look names that this computer does not have (the family only, never a path). */
export function lookFontMissingNote(family: string): string {
  return `The font “${family}” is not on this computer, so another face is drawn in its place until it is added.`
}

/** Said after an export: the file's name only, never its folder. */
export function lookExportedNote(fileName: string): string {
  return `Exported as ${fileName}.`
}

/* ----------------------------------------------------------- small reads */

/** A plain object (not an array, not null, not a function). Reading one never throws past `parseLook`'s guard. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The value of an own key, or undefined: an inherited `__proto__` or `constructor` is never read. */
function own(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

/** Control characters out, ends trimmed, capped in code points so no surrogate pair is split. */
function cleanText(value: string, max: number): { text: string; shortened: boolean } {
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  const points = Array.from(text)
  if (points.length <= max) return { text, shortened: false }
  return { text: points.slice(0, max).join('').trim(), shortened: true }
}

/**
 * A font family a look may name: no control character and none of the
 * characters that end a family in the two places a family is written, the
 * caption file's style line (`,`) and a canvas font string (`"`, `;`), nor
 * braces or a backslash (libass's override tags). Stricter than the
 * project's own reads, because this is a stranger's file.
 */
// eslint-disable-next-line no-control-regex
const FONT_FAMILY_OK = /^[^\u0000-\u001f\u007f,;"{}\\<>]+$/

function isFontFamily(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value !== '' &&
    Array.from(value).length <= LOOK_FONT_MAX &&
    FONT_FAMILY_OK.test(value)
  )
}

/** A caption colour: the caption file's writer (`toAssColor`) reads exactly six hex digits. */
const CAPTION_COLOUR = /^#[0-9a-f]{6}$/i

function finiteIn(min: number, max: number): (value: unknown) => boolean {
  return (value) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

const isBoolean = (value: unknown): boolean => typeof value === 'boolean'
const isCaptionColour = (value: unknown): boolean => typeof value === 'string' && CAPTION_COLOUR.test(value)

/**
 * Each caption override a look may carry, with what it accepts. Typed by
 * `StyleOverrides`' own keys, so a key added there without its row here
 * fails typecheck.
 *
 * `resolveStyle` guards only the numbers it divides or scales by, and only
 * from below; nothing else on the caption path checks a value, so these
 * ranges are this file's, set around what the OUTPUT strip's controls write
 * (Size 2..30 % of 1080, Words 1..8, Margin 0..40 %) with room to spare, and
 * each floor at or below `resolveStyle`'s own, so a value kept here resolves
 * the same in the project it came from and the one it lands in.
 */
const CAPTION_ACCEPTS: { [K in keyof Required<StyleOverrides>]: (value: unknown) => boolean } = {
  fontFamily: isFontFamily,
  fontSize: finiteIn(1, 1080),
  primaryColor: isCaptionColour,
  highlightColor: isCaptionColour,
  outlineColor: isCaptionColour,
  outlineWidth: finiteIn(0, 100),
  uppercase: isBoolean,
  position: (v) => v === 'top' || v === 'center' || v === 'bottom',
  marginV: finiteIn(0, 1080),
  wordsPerLine: finiteIn(1, 50),
  highlightScale: finiteIn(0.1, 10),
  animated: isBoolean,
  textStyleId: (v) => typeof v === 'string' && TEXT_STYLES.some((s) => s.id === v),
  animationId: (v) => typeof v === 'string' && TEXT_ANIMATIONS.some((a) => a.id === v),
  bold: isBoolean,
  shadowDepth: finiteIn(0, 100)
}

/** The caption override keys a look may carry. */
export const LOOK_CAPTION_KEYS: readonly string[] = Object.freeze(Object.keys(CAPTION_ACCEPTS))

/** What sorting a raw overrides object gave: what was kept, and why the rest went. */
interface Sorted {
  kept: Record<string, unknown>
  dropped: number
  textStyle: boolean
  animation: boolean
}

/** An id-shaped value that names nothing this app has: its own note rather than the count. */
const isUnknownId = (value: unknown): boolean => typeof value === 'string'

function sortCaptionOverrides(raw: unknown): Sorted {
  const out: Sorted = { kept: {}, dropped: 0, textStyle: false, animation: false }
  if (raw === undefined) return out
  if (!isRecord(raw)) {
    out.dropped = 1
    return out
  }
  for (const key of Object.keys(raw)) {
    const value = raw[key]
    if (!Object.hasOwn(CAPTION_ACCEPTS, key)) {
      out.dropped++
      continue
    }
    if (CAPTION_ACCEPTS[key as keyof StyleOverrides](value)) {
      out.kept[key] = value
    } else if (key === 'textStyleId' && isUnknownId(value)) out.textStyle = true
    else if (key === 'animationId' && isUnknownId(value)) out.animation = true
    else out.dropped++
  }
  return out
}

function sortGraphicOverrides(raw: unknown): Sorted {
  const out: Sorted = { kept: {}, dropped: 0, textStyle: false, animation: false }
  if (raw === undefined) return out
  if (!isRecord(raw)) {
    out.dropped = 1
    return out
  }
  for (const key of Object.keys(raw)) {
    const value = raw[key]
    if (!GRAPHIC_OVERRIDE_KEYS.includes(key)) {
      out.dropped++
      continue
    }
    // The font as the captions' (a stranger's family), on top of the graphic guard.
    const usable = graphicOverrideAccepted(key, value) && (key !== 'font' || isFontFamily(value))
    if (usable) out.kept[key] = value
    // A text style the app has but a graphic may not use is a setting left out, not one this version lacks.
    else if (key === 'textStyleId' && isUnknownId(value) && !TEXT_STYLES.some((s) => s.id === value)) out.textStyle = true
    else out.dropped++
  }
  return out
}

/** Overrides in a stable order, or undefined for none. */
function sortedOrNone(kept: Record<string, unknown>): Record<string, unknown> | undefined {
  const keys = Object.keys(kept).sort()
  if (keys.length === 0) return undefined
  const out: Record<string, unknown> = {}
  for (const key of keys) out[key] = kept[key]
  return out
}

/* --------------------------------------------------------- making a look */

/** The header a caller passes when a look is made: the name, and the two optional lines. */
export interface LookMade {
  name: string
  author?: string
  licence?: string
  /** 1 for a new look; the store passes the old one's plus 1 when saving over a name. */
  version?: number
}

function saneVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= LOOK_VERSION_MAX ? value : null
}

/**
 * The project's two styles as a look. Its overrides go through the same
 * checks a file's do, so a saved look never holds a value `parseLook` would
 * drop; the name, maker and licence are cleaned and capped as a file's are.
 */
export function lookFromProject(project: Pick<Project, 'captions' | 'graphics'>, made: LookMade): Look {
  const captions = sortCaptionOverrides(project.captions.overrides)
  const graphics = sortGraphicOverrides(project.graphics?.overrides)
  const look: Look = {
    kind: LOOK_KIND,
    schema: LOOK_SCHEMA,
    name: cleanText(made.name, LOOK_NAME_MAX).text,
    author: cleanText(made.author ?? '', LOOK_AUTHOR_MAX).text,
    version: saneVersion(made.version) ?? 1,
    licence: cleanText(made.licence ?? '', LOOK_LICENCE_MAX).text,
    captions: { styleId: project.captions.styleId },
    graphics: { styleId: project.graphics?.styleId ?? GRAPHIC_STYLES[0].id }
  }
  const co = sortedOrNone(captions.kept)
  if (co) look.captions.overrides = co as StyleOverrides
  if (project.captions.placement === 'smart') look.captions.placement = 'smart'
  const go = sortedOrNone(graphics.kept)
  if (go) look.graphics.overrides = go
  return look
}

/** A canonical text for a value: keys sorted at every level, so two equal styles compare equal whatever order they were built in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** The caption style a look resolves to, as the export and the preview resolve a project's. */
export function lookCaptionStyle(look: Look): CaptionStyle {
  return resolveStyle(look.captions.styleId, look.captions.overrides)
}

/**
 * The project with the look's two styles: the caption preset, overrides and
 * placement, the graphic preset and overrides, each REPLACED (a look without
 * overrides clears the project's). Whether captions are on and the graphics'
 * sound switch are left as they are (absent graphics means sounds on, and is
 * written so); no clip, transcript or caption word is touched. The same
 * project back when it already holds exactly these styles.
 */
export function applyLook(project: Project, look: Look): Project {
  const captionOverrides: Record<string, unknown> = { ...(look.captions.overrides ?? {}) }
  const graphicOverrides: Record<string, unknown> = { ...(look.graphics.overrides ?? {}) }
  const same =
    project.captions.styleId === look.captions.styleId &&
    canonical(project.captions.overrides ?? {}) === canonical(captionOverrides) &&
    (project.captions.placement === 'smart') === (look.captions.placement === 'smart') &&
    project.graphics !== undefined &&
    project.graphics.styleId === look.graphics.styleId &&
    canonical(project.graphics.overrides ?? {}) === canonical(graphicOverrides)
  if (same) return project
  const { placement: _was, ...captions } = project.captions
  return {
    ...project,
    captions: {
      ...captions,
      styleId: look.captions.styleId,
      overrides: captionOverrides,
      ...(look.captions.placement === 'smart' ? { placement: 'smart' as const } : {})
    },
    graphics: {
      sound: project.graphics?.sound ?? true,
      styleId: look.graphics.styleId,
      overrides: graphicOverrides
    }
  }
}

/** Whether the graphics' own settings differ between two projects (preset or overrides): what needs the graphic clips rebaked. */
export function graphicsStyleChanged(before: Pick<Project, 'graphics'>, after: Pick<Project, 'graphics'>): boolean {
  return (
    (before.graphics?.styleId ?? GRAPHIC_STYLES[0].id) !== (after.graphics?.styleId ?? GRAPHIC_STYLES[0].id) ||
    canonical(before.graphics?.overrides ?? {}) !== canonical(after.graphics?.overrides ?? {})
  )
}

/**
 * Whether this look is the one the project shows: its caption style and its
 * graphic style resolve to the same as the project's, and its placement is
 * the project's. A comparison of what is drawn, not a stored flag.
 */
export function lookIsApplied(project: Pick<Project, 'captions' | 'graphics'>, look: Look): boolean {
  const projectCaption = resolveStyle(project.captions.styleId, project.captions.overrides as StyleOverrides | undefined)
  const projectGraphic = resolveGraphicStyle(project.graphics?.styleId ?? GRAPHIC_STYLES[0].id, project.graphics?.overrides)
  return (
    canonical(projectCaption) === canonical(lookCaptionStyle(look)) &&
    canonical(projectGraphic) === canonical(resolveGraphicStyle(look.graphics.styleId, look.graphics.overrides)) &&
    (project.captions.placement === 'smart') === (look.captions.placement === 'smart')
  )
}

/** The font families a look's overrides name, which the machine may not have (the presets' own ship with the app). */
export function lookFontFamilies(look: Look): string[] {
  const out: string[] = []
  const caption = look.captions.overrides?.fontFamily
  if (typeof caption === 'string') out.push(caption)
  const graphic = look.graphics.overrides?.font
  if (typeof graphic === 'string' && !out.includes(graphic)) out.push(graphic)
  return out
}

/**
 * One note per font family the look's overrides name that is not among
 * `installed` (the families this computer can draw: the system's and the
 * catalogue's). Null `installed` is "not known yet" (the catalogue has not
 * loaded), which says nothing rather than guess. A missing family is not
 * refused: the canvas and libass each draw a stand-in face for it, as they
 * do for any project naming a font this computer lacks.
 */
export function lookFontNotes(look: Look, installed: readonly string[] | null): string[] {
  if (installed === null) return []
  return lookFontFamilies(look)
    .filter((family) => !installed.includes(family))
    .map(lookFontMissingNote)
}

/* --------------------------------------------------------- reading a look */

/**
 * A look from an unknown value (a parsed file, or a saved entry): never
 * throws. Refuses what is not a look (LOOK_NOT_A_LOOK), a schema newer than
 * LOOK_SCHEMA (LOOK_NEWER), a preset this app lacks; keeps only the keys it
 * knows, each override only when it would be used, dropping the rest with
 * one counted note, and an unknown text style or animation with its own.
 */
export function parseLook(value: unknown): LookRead {
  try {
    return readLook(value)
  } catch {
    // A getter that throws, a proxy, anything an in-memory caller could hand in.
    return { ok: false, reason: LOOK_NOT_A_LOOK }
  }
}

function readLook(value: unknown): LookRead {
  if (!isRecord(value) || own(value, 'kind') !== LOOK_KIND) return { ok: false, reason: LOOK_NOT_A_LOOK }
  const schema = own(value, 'schema')
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) return { ok: false, reason: LOOK_NOT_A_LOOK }
  if (schema > LOOK_SCHEMA) return { ok: false, reason: LOOK_NEWER }

  const rawCaptions = own(value, 'captions')
  const rawGraphics = own(value, 'graphics')
  if (!isRecord(rawCaptions) || !isRecord(rawGraphics)) return { ok: false, reason: LOOK_NOT_A_LOOK }
  const captionId = own(rawCaptions, 'styleId')
  const graphicId = own(rawGraphics, 'styleId')
  if (typeof captionId !== 'string' || typeof graphicId !== 'string') return { ok: false, reason: LOOK_NOT_A_LOOK }
  if (!CAPTION_STYLES.some((s) => s.id === captionId)) return { ok: false, reason: LOOK_UNKNOWN_CAPTION_STYLE }
  if (!GRAPHIC_STYLES.some((s) => s.id === graphicId)) return { ok: false, reason: LOOK_UNKNOWN_GRAPHIC_STYLE }

  let shortened = false
  let dropped = 0
  const text = (key: string, max: number): string => {
    const raw = own(value, key)
    if (raw === undefined) return ''
    if (typeof raw !== 'string') {
      dropped++
      return ''
    }
    const cleaned = cleanText(raw, max)
    if (cleaned.shortened) shortened = true
    return cleaned.text
  }
  const name = text('name', LOOK_NAME_MAX)
  const author = text('author', LOOK_AUTHOR_MAX)
  const licence = text('licence', LOOK_LICENCE_MAX)
  const rawVersion = own(value, 'version')
  const version = saneVersion(rawVersion)
  if (version === null && rawVersion !== undefined) dropped++

  const captions = sortCaptionOverrides(own(rawCaptions, 'overrides'))
  const graphics = sortGraphicOverrides(own(rawGraphics, 'overrides'))
  dropped += captions.dropped + graphics.dropped
  const placement = own(rawCaptions, 'placement')
  if (placement !== undefined && placement !== 'smart' && placement !== 'style') dropped++

  const look: Look = {
    kind: LOOK_KIND,
    schema: LOOK_SCHEMA,
    name,
    author,
    version: version ?? 1,
    licence,
    captions: { styleId: captionId },
    graphics: { styleId: graphicId }
  }
  const co = sortedOrNone(captions.kept)
  if (co) look.captions.overrides = co as StyleOverrides
  if (placement === 'smart') look.captions.placement = 'smart'
  const go = sortedOrNone(graphics.kept)
  if (go) look.graphics.overrides = go

  const notes: string[] = []
  if (shortened) notes.push(LOOK_NOTE_SHORTENED)
  if (captions.textStyle || graphics.textStyle) notes.push(LOOK_NOTE_TEXT_STYLE)
  if (captions.animation) notes.push(LOOK_NOTE_ANIMATION)
  if (dropped > 0) notes.push(lookDroppedNote(dropped))
  return { ok: true, look, notes }
}

/** The size refusal, from a byte count the caller measured (main: `stat`, before reading). */
export function lookSizeRefusal(bytes: number): string | null {
  return bytes > LOOK_FILE_MAX_BYTES ? LOOK_TOO_LARGE : null
}

/**
 * A look from a file's text: the size cap (in UTF-8 bytes) again, a byte
 * order mark dropped, the text parsed inside a guard, then `parseLook`. A
 * text that is not a look's says LOOK_UNREADABLE and nothing of the text.
 */
export function readLookText(text: string): LookRead {
  const bytes = new TextEncoder().encode(text).length
  const tooLarge = lookSizeRefusal(bytes)
  if (tooLarge) return { ok: false, reason: tooLarge }
  let value: unknown
  try {
    value = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    return { ok: false, reason: LOOK_UNREADABLE }
  }
  return parseLook(value)
}

/**
 * The look as its file's text: keys in a fixed order (the header first, then
 * captions, then graphics; overrides sorted), two-space indent, a final
 * newline. Only the look's own fields are written, whatever else the object
 * carries.
 */
export function serializeLook(look: Look): string {
  const captions: Record<string, unknown> = { styleId: look.captions.styleId }
  const co = look.captions.overrides ? sortedOrNone(look.captions.overrides as Record<string, unknown>) : undefined
  if (co) captions.overrides = co
  if (look.captions.placement === 'smart') captions.placement = 'smart'
  const graphics: Record<string, unknown> = { styleId: look.graphics.styleId }
  const go = look.graphics.overrides ? sortedOrNone(look.graphics.overrides) : undefined
  if (go) graphics.overrides = go
  const file = {
    kind: LOOK_KIND,
    schema: LOOK_SCHEMA,
    name: look.name,
    author: look.author,
    version: look.version,
    licence: look.licence,
    captions,
    graphics
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

/* ---------------------------------------------------- names and the list */

/** What an unnamed look's file is called. */
const FILE_FALLBACK = 'look'

/**
 * A Windows-safe file name base for a look (no extension): path separators
 * become hyphens first (a name is not a path, and "Before/After" keeps both
 * words), then `safeTakeBase`'s rules (the illegal set, control characters,
 * leading and trailing dots and spaces, 80 characters, the reserved names),
 * and a half surrogate pair left by its cut removed.
 */
export function lookFileBase(name: string): string {
  const base = safeTakeBase(name.replace(/[/\\]/g, '-'), FILE_FALLBACK)
  const whole = base.replace(/[\uD800-\uDBFF]$/, '').replace(/[. ]+$/, '')
  return whole === '' ? FILE_FALLBACK : whole
}

/** The last segment of a path, by either separator: the renderer has no `node:path`, and a note shows a name, never a folder. */
export function fileNameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? ''
}

/** Names compare without regard to case or the ends' spaces. */
export function sameLookName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
}

/** The name an import takes: its own if free, else its own with the first free number after it (" 2", " 3", …), within LOOK_NAME_MAX. */
export function uniqueLookName(name: string, taken: readonly string[]): string {
  const base = name.trim() === '' ? 'Imported look' : name
  if (!taken.some((t) => sameLookName(t, base))) return base
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`
    const room = LOOK_NAME_MAX - suffix.length
    const candidate = `${Array.from(base).slice(0, room).join('').trimEnd()}${suffix}`
    if (!taken.some((t) => sameLookName(t, candidate))) return candidate
  }
}

/**
 * The saved list as read from settings: each entry through `parseLook`, the
 * refused ones dropped, an unnamed one dropped, a second of the same name
 * dropped (the first kept), at most SAVED_LOOKS_MAX. Anything that is not a
 * list is no list.
 */
export function saneSavedLooks(raw: unknown): Look[] {
  if (!Array.isArray(raw)) return []
  const out: Look[] = []
  for (const entry of raw) {
    if (out.length >= SAVED_LOOKS_MAX) break
    const read = parseLook(entry)
    if (!read.ok || read.look.name === '') continue
    if (out.some((l) => sameLookName(l.name, read.look.name))) continue
    out.push(read.look)
  }
  return out
}
