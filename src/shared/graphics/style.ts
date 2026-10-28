/**
 * The graphic style (docs/CLIPS.md §6.5): the twin of the caption styles
 * (`captions/style.ts`), carrying a graphic's text style and face, its
 * palette, corner radius, stroke width and panel shadow, its motion names,
 * its stroke look and its dim.
 *
 * Phase 1 builds the first half: the type, `resolveGraphicStyle` and its
 * guards, the `clean` preset, `GRAPHIC_TEXT_STYLES` and `graphicStyleOf`
 * (the store's `setGraphicsStyle` and `setGraphicsOverride` are in
 * `renderer/src/store.ts`). The six other presets of §6.5's table (`bold`,
 * `editorial`, `neon`, `mono`, `accent`, `energetic`), chosen against the
 * sample tiles, the OUTPUT strip's Graphics section and, if M10 passes, the
 * marker painter and `MARKER_READY` set are phase 2's (§6.5, "Days").
 *
 * No number format, locale, grouping or separator: a style that regrouped
 * "10,00,000" as "1,000,000" would draw a string nobody said (§6.2), so no
 * key here names one.
 *
 * Pure: no clock, no DOM, no `node:path`; nothing from the renderer or main.
 */

import type { GraphicSpec } from './template'
import type { EntranceName, MotionEase } from './motion'
import { STROKE_MIN_PX } from './stroke'
import { TEXT_STYLES, type TextStyle } from '../render/textStyle'
import type { Project } from '../timeline'

/** A graphic's look (§6.5). Sizes are fractions of the output frame's short side. */
export interface GraphicStyle {
  id: string
  name: string
  /** One of `GRAPHIC_TEXT_STYLES`: the type's ink and weight are this text style's (§6.3). */
  textStyleId: string
  /** The face for Latin items; a Hindi or Telugu item draws in `INDIC_FONTS`' face whatever this says (§6.3, §6.20). */
  font: string
  palette: {
    /** Strokes, arrowheads, bars and the ring's arc; never text, which takes its text style's fill. Set to match that fill (§6.5). */
    ink: string
    /** A lit word (through `highlight`, §6.3), the lower third's bar, the keyword's underline. */
    accent: string
    /** The ring's track (§6.2). */
    muted: string
    /** The panel behind a counter, a callout's label, a keyword. */
    panel: string
    /** 0..1; a panel is drawn only when it is above 0 (§6.2). */
    panelOpacity: number
    /** The dim's colour, drawn only when `dim` is true. */
    dim: string
    /** 0..1. */
    dimOpacity: number
  }
  /** A panel's corner, 0..0.1 of the short side. */
  radius: number
  /** A stroke's width, from §6.3's minimum (`STROKE_MIN_PX` of a 1080-pixel side) up to 0.02 of the short side. */
  stroke: number
  /** 0..1, a soft shadow under panels. */
  shadow: number
  motion: { entrance: EntranceName; ease: MotionEase; exit: MotionEase }
  /** `marker` only while `MARKER_READY` (D7, §16.60). */
  strokeLook: 'clean' | 'marker'
  /** Whether a template may dim with this style (§6.5, "The dim"). */
  dim: boolean
  /** Restrained by default (D5, §16.58); a preset's character, not a user's override. */
  energy: 'restrained' | 'energetic'
  /** Phase 3's hero glow and the screen card's edge sweep (§6.16); no phase-1 preset has one. */
  glow?: { radius: number; strength: number }
}

/**
 * Whether the marker stroke look may be drawn (D7, §16.60): false until M10
 * passes on its scratch branch and phase 2 adds perfect-freehand and the
 * marker painter. Until then `resolveGraphicStyle` never yields `marker`.
 * Typed `boolean` so the gate is not read as dead code.
 */
export const MARKER_READY: boolean = false

/**
 * What each entrance resolves to (§6.5, "The entrances"). `blur-rise` to
 * `rise`: M5 did not allow its blur (2026-10-27, §6.15's final note: blur
 * adds 38.60 ms a frame at p95 on the Surface, against M1's p50 encode of
 * 32.70 at the box and pool 4), so `DrawItem` gains no blur. `wipe` to
 * `rise`: a masked reveal needs a clip on items, which waits for a source
 * that times it and phase 2's ratings. A Record, so an entrance added to
 * `EntranceName` without its row here fails typecheck.
 */
const ENTRANCES: Record<EntranceName, EntranceName> = {
  rise: 'rise',
  pop: 'pop',
  wipe: 'rise',
  'blur-rise': 'rise'
}

/** Every `MotionEase`, as a Record so a curve added to `motion.ts` without its row here fails typecheck. */
const EASES: Record<MotionEase, true> = {
  'expo-out': true,
  decelerate: true,
  accelerate: true,
  standard: true,
  'out-cubic': true,
  'out-back': true,
  linear: true,
  'carbon-expressive': true,
  spring1: true
}

/** The largest corner radius, of the short side (§6.5). */
const RADIUS_MAX = 0.1
/** The widest stroke, of the short side (§6.5). */
const STROKE_MAX = 0.02
/** The thinnest: §6.3's floor, `STROKE_MIN_PX` of a 1080-pixel side, as a fraction of the short side (painter A's `strokeWidth`). */
const STROKE_MIN = STROKE_MIN_PX / 1080

/**
 * Whether a text style may draw a graphic's text (§6.3, "Only text styles
 * that keep the words as given"; §6.5's `graphicEligible`): its faces do not
 * re-case, which would draw a string the data does not hold; set no face of
 * their own, so a shaped item's `INDIC_FONTS` face is the one drawn
 * (`fontString` draws `paint?.font ?? spec.font`); and its accent is not
 * word-scoped, which on per-word items would light every word. Both faces
 * are read, the base and the accent ("by its faces", §6.5): a line-scoped
 * accent never engages on a one-line item, but a re-casing or face-setting
 * accent would on any second line. Reading the accent changes nothing among
 * the 42 today (counted 2026-10-27 under node 24: 15 re-case in their base
 * face, the 4 whose line-scoped accent re-cases among them; none sets a face;
 * 5 scope their accent to a word, one of them among the 15; 23 pass).
 */
export function graphicEligible(style: TextStyle): boolean {
  for (const face of [style.base, style.accent]) {
    if (!face) continue
    if (face.uppercase) return false
    if (face.font !== undefined) return false
  }
  if (style.accentScope === 'firstWord' || style.accentScope === 'lastWord') return false
  return true
}

/** The text styles a graphic may use: `TEXT_STYLES` filtered by `graphicEligible`, computed from the faces, not listed (§6.3). */
export const GRAPHIC_TEXT_STYLES: readonly TextStyle[] = Object.freeze(TEXT_STYLES.filter(graphicEligible))

function frozen(style: GraphicStyle): GraphicStyle {
  Object.freeze(style.palette)
  Object.freeze(style.motion)
  if (style.glow) Object.freeze(style.glow)
  return Object.freeze(style)
}

/**
 * `clean`, the default (§6.5's presets table): the `clean` text style
 * (#FFFFFF), Montserrat, rise · `expo-out` (M14's winner replaces it) ·
 * `accelerate`, ink #FFFFFF, accent #FFD400 (the Director's punch colour),
 * panel #0B0D10 (the preview's stage) at 0.55, no dim at 0.35, restrained.
 * Every value a proposal, chosen against the sample tiles in phase 2 and
 * revised by the look rating (§6.10). `muted`, the dim's colour, `radius`,
 * `stroke` and `shadow` are not in the table: these are this file's
 * proposals for those tiles.
 */
export const CLEAN_GRAPHIC_STYLE: GraphicStyle = frozen({
  id: 'clean',
  name: 'Clean',
  textStyleId: 'clean',
  font: 'Montserrat',
  palette: {
    ink: '#FFFFFF',
    accent: '#FFD400',
    muted: '#6B7078',
    panel: '#0B0D10',
    panelOpacity: 0.55,
    dim: '#000000',
    dimOpacity: 0.35
  },
  radius: 0.02,
  stroke: 0.006,
  shadow: 0.35,
  motion: { entrance: 'rise', ease: 'expo-out', exit: 'accelerate' },
  strokeLook: 'clean',
  dim: false,
  energy: 'restrained'
})

/** The presets by id. Phase 1 has `clean` alone; phase 2 adds the six others of §6.5's table. */
export const GRAPHIC_STYLES: readonly GraphicStyle[] = Object.freeze([CLEAN_GRAPHIC_STYLE])

/** A colour as the app's colour inputs write it: `#` and 3, 4, 6 or 8 hex digits. */
const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function colourOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOUR.test(value) ? value : fallback
}

/** A number in [min, max]: not a finite number, or negative, is the fallback (the preset's); out of range is clamped. */
function numberIn(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback
  return value < min ? min : value > max ? max : value
}

function easeOr(value: unknown, fallback: MotionEase): MotionEase {
  return typeof value === 'string' && Object.hasOwn(EASES, value) ? (value as MotionEase) : fallback
}

/**
 * Every key a project's `overrides` may set, each with its guard. Keys are
 * dotted paths into `GraphicStyle` (`'palette.accent'`, §6.5's accent
 * preset). `id`, `name` and `energy` are the preset's own, and `glow` is
 * phase 3's, so none of them is here, and any key not here is ignored.
 */
const OVERRIDES: Record<string, (style: GraphicStyle, value: unknown) => void> = {
  textStyleId: (s, v) => {
    if (typeof v === 'string' && GRAPHIC_TEXT_STYLES.some((t) => t.id === v)) s.textStyleId = v
  },
  font: (s, v) => {
    if (typeof v === 'string' && v.trim() !== '') s.font = v
  },
  'palette.ink': (s, v) => (s.palette.ink = colourOr(v, s.palette.ink)),
  'palette.accent': (s, v) => (s.palette.accent = colourOr(v, s.palette.accent)),
  'palette.muted': (s, v) => (s.palette.muted = colourOr(v, s.palette.muted)),
  'palette.panel': (s, v) => (s.palette.panel = colourOr(v, s.palette.panel)),
  'palette.panelOpacity': (s, v) => (s.palette.panelOpacity = numberIn(v, s.palette.panelOpacity, 0, 1)),
  'palette.dim': (s, v) => (s.palette.dim = colourOr(v, s.palette.dim)),
  'palette.dimOpacity': (s, v) => (s.palette.dimOpacity = numberIn(v, s.palette.dimOpacity, 0, 1)),
  radius: (s, v) => (s.radius = numberIn(v, s.radius, 0, RADIUS_MAX)),
  stroke: (s, v) => (s.stroke = numberIn(v, s.stroke, STROKE_MIN, STROKE_MAX)),
  shadow: (s, v) => (s.shadow = numberIn(v, s.shadow, 0, 1)),
  'motion.entrance': (s, v) => {
    if (typeof v === 'string' && Object.hasOwn(ENTRANCES, v)) s.motion.entrance = v as EntranceName
  },
  'motion.ease': (s, v) => (s.motion.ease = easeOr(v, s.motion.ease)),
  'motion.exit': (s, v) => (s.motion.exit = easeOr(v, s.motion.exit)),
  strokeLook: (s, v) => {
    if (v === 'clean' || v === 'marker') s.strokeLook = v
  },
  dim: (s, v) => {
    if (typeof v === 'boolean') s.dim = v
  }
}

/** The keys `resolveGraphicStyle` reads from `overrides`, in the order it applies them. */
export const GRAPHIC_OVERRIDE_KEYS: readonly string[] = Object.freeze(Object.keys(OVERRIDES))

/**
 * A preset plus the project's overrides (§6.5), as `resolveStyle` does for
 * captions: the preset by id, `clean` for an unknown one; each override
 * guarded (opacities and the shadow to 0..1, `radius` to 0..0.1, `stroke` to
 * §6.3's minimum up to 0.02, a NaN or negative number to the preset's; a
 * `textStyleId` outside `GRAPHIC_TEXT_STYLES`, a missing `font`, an unknown
 * ease or entrance, a colour that is not hex to the preset's); unknown keys
 * ignored. Then the gates, on the preset's own value as on an override's:
 * the entrance through `ENTRANCES` (`blur-rise` and `wipe` to `rise`), and
 * `marker` to `clean` while `MARKER_READY` is false. Always a new object, so
 * a caller that changes it changes no preset.
 */
export function resolveGraphicStyle(styleId: string, overrides?: Record<string, unknown>): GraphicStyle {
  const preset = GRAPHIC_STYLES.find((s) => s.id === styleId) ?? CLEAN_GRAPHIC_STYLE
  const style: GraphicStyle = { ...preset, palette: { ...preset.palette }, motion: { ...preset.motion } }
  if (preset.glow) style.glow = { ...preset.glow }
  if (overrides !== null && typeof overrides === 'object') {
    for (const key of GRAPHIC_OVERRIDE_KEYS) {
      if (Object.hasOwn(overrides, key)) OVERRIDES[key](style, overrides[key])
    }
  }
  style.motion.entrance = ENTRANCES[style.motion.entrance]
  if (style.strokeLook === 'marker' && !MARKER_READY) style.strokeLook = 'clean'
  return style
}

/**
 * A graphic's style: `spec.style ?? project.graphics?.styleId ?? 'clean'`,
 * with the project's overrides (§6.5). The one call the store, the Preview
 * and the export make, so three sites cannot resolve a style three ways.
 */
export function graphicStyleOf(project: Pick<Project, 'graphics'>, spec: Pick<GraphicSpec, 'style'>): GraphicStyle {
  return resolveGraphicStyle(
    spec.style ?? project.graphics?.styleId ?? CLEAN_GRAPHIC_STYLE.id,
    project.graphics?.overrides
  )
}
