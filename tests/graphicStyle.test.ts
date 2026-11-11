import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  CLEAN_GRAPHIC_STYLE,
  GRAPHIC_OVERRIDE_KEYS,
  GRAPHIC_STYLES,
  GRAPHIC_TEXT_STYLES,
  MARKER_READY,
  graphicEligible,
  graphicStyleOf,
  resolveGraphicStyle,
  type GraphicStyle
} from '@shared/graphics/style'
import { STROKE_MIN_PX } from '@shared/graphics/stroke'
import { TEXT_STYLES, type TextStyle } from '@shared/render/textStyle'
import { drawTextOnto } from '@shared/render/textPaint'
import type { TextSpec } from '@shared/timeline'

/*
 * The graphic style's first half (docs/CLIPS.md §6.5, phase 1): the guards of
 * `resolveGraphicStyle`, its gates, the `clean` preset, `GRAPHIC_TEXT_STYLES`
 * and `graphicStyleOf`. `clean`'s rules (the default, restrained, no `pop`,
 * no `out-back`, no dim, no glow) are asserted on `clean` itself; phase 2's
 * cases, the seven presets by id, `energy` and `dim` across them, and each
 * preset's ink against its text style's fill, are under "the seven presets".
 */

const clean = (): GraphicStyle => resolveGraphicStyle('clean')

/* ------------------------------------------------------------------ numbers */

/** Every number an override may set, with §6.5's range. */
const NUMBERS: { key: string; read: (s: GraphicStyle) => number; min: number; max: number }[] = [
  { key: 'palette.panelOpacity', read: (s) => s.palette.panelOpacity, min: 0, max: 1 },
  { key: 'palette.dimOpacity', read: (s) => s.palette.dimOpacity, min: 0, max: 1 },
  { key: 'radius', read: (s) => s.radius, min: 0, max: 0.1 },
  // §6.3's floor: STROKE_MIN_PX of a 1080-pixel side, as a fraction of the short side.
  { key: 'stroke', read: (s) => s.stroke, min: STROKE_MIN_PX / 1080, max: 0.02 },
  { key: 'shadow', read: (s) => s.shadow, min: 0, max: 1 }
]

describe('resolveGraphicStyle guards every number (§6.5)', () => {
  it('takes one in range, clamps one out of range, and gives a NaN, a negative or a non-number the preset’s', () => {
    for (const { key, read, min, max } of NUMBERS) {
      expect(GRAPHIC_OVERRIDE_KEYS, key).toContain(key)
      const preset = read(clean())
      const at = (value: unknown): number => read(resolveGraphicStyle('clean', { [key]: value }))
      for (const bad of [Number.NaN, -0.01, -5, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, '0.5', null, true, {}]) {
        expect(at(bad), `${key} = ${String(bad)}`).toBe(preset)
      }
      const middle = (min + max) / 2
      expect(at(middle), `${key} in range`).toBe(middle)
      expect(at(max), `${key} at its top`).toBe(max)
      expect(at(max + 0.5), `${key} above its top`).toBe(max)
      expect(at(1000), `${key} far above`).toBe(max)
      expect(at(0), `${key} at 0`).toBe(min)
      if (min > 0) expect(at(min / 2), `${key} under its floor`).toBe(min)
    }
  })
})

/* ---------------------------------------------------------------- the preset */

describe('the preset (§6.5)', () => {
  it('an unknown id resolves to clean, overrides and all', () => {
    expect(GRAPHIC_STYLES.map((s) => s.id)).toContain('clean')
    for (const id of ['no-such-style', '', 'CLEAN', 'toString', '__proto__']) {
      expect(resolveGraphicStyle(id), id).toEqual(clean())
      expect(resolveGraphicStyle(id, { radius: 0.05 }).radius, id).toBe(0.05)
    }
    expect(clean().id).toBe('clean')
  })

  it('a resolved style is a new object: changing it changes no preset and no later resolve', () => {
    const a = resolveGraphicStyle('clean')
    a.palette.accent = '#000000'
    a.motion.ease = 'linear'
    a.radius = 0.09
    const b = resolveGraphicStyle('clean')
    expect(b.palette.accent).toBe(CLEAN_GRAPHIC_STYLE.palette.accent)
    expect(b.motion.ease).toBe(CLEAN_GRAPHIC_STYLE.motion.ease)
    expect(b.radius).toBe(CLEAN_GRAPHIC_STYLE.radius)
    expect(CLEAN_GRAPHIC_STYLE.palette.accent).toBe('#FFD400')
  })

  it('clean is the default and restrained, by D5’s rules, not by its proposed values', () => {
    // What a project with no graphics settings and a spec naming no style draws with.
    expect(graphicStyleOf({}, {}).id).toBe('clean')
    for (const [why, style] of [
      ['the preset', CLEAN_GRAPHIC_STYLE],
      ['resolved', clean()]
    ] as const) {
      expect(style.energy, why).toBe('restrained')
      // `energetic` is the only one with `pop` and `out-back` (§16.58).
      expect(style.motion.entrance, why).not.toBe('pop')
      expect(style.motion.ease, why).not.toBe('out-back')
      expect(style.motion.exit, why).not.toBe('out-back')
      // Off in every restrained preset (§6.5, "The dim"); if §6.10's look
      // rating turns it on in the restrained presets, this line goes with them.
      expect(style.dim, why).toBe(false)
      // "Every preset is clean" (§6.5, "The stroke look").
      expect(style.strokeLook, why).toBe('clean')
      // No phase-1 preset has a glow (phase 3's, §6.16): no key at all, not an empty one.
      expect('glow' in style, why).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------- gates */

describe('the gates (§6.5)', () => {
  it('strokeLook marker resolves to clean while MARKER_READY is false', () => {
    expect(MARKER_READY).toBe(false)
    expect(resolveGraphicStyle('clean', { strokeLook: 'marker' }).strokeLook).toBe('clean')
    expect(resolveGraphicStyle('clean', { strokeLook: 'clean' }).strokeLook).toBe('clean')
    expect(resolveGraphicStyle('clean', { strokeLook: 'rough' }).strokeLook).toBe('clean')
  })

  it('blur-rise resolves to rise (M5 did not allow it), and wipe to rise; pop is kept and an unknown entrance is the preset’s', () => {
    const entranceOf = (value: unknown): string => resolveGraphicStyle('clean', { 'motion.entrance': value }).motion.entrance
    expect(entranceOf('blur-rise')).toBe('rise')
    expect(entranceOf('wipe')).toBe('rise')
    expect(entranceOf('rise')).toBe('rise')
    expect(entranceOf('pop')).toBe('pop')
    expect(entranceOf('zoom')).toBe(CLEAN_GRAPHIC_STYLE.motion.entrance)
    expect(entranceOf(3)).toBe(CLEAN_GRAPHIC_STYLE.motion.entrance)
  })
})

/* ------------------------------------------------------------------ formats */

/** Every key of an object, nested keys dotted. */
function keysOf(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, inner]) => [`${prefix}${key}`, ...keysOf(inner, `${prefix}${key}.`)])
}

describe('no number format (§6.5)', () => {
  it('no key of a style, of any preset or of the overrides names a format, a locale, a grouping or a separator', () => {
    const keys = [
      ...GRAPHIC_STYLES.flatMap((s) => keysOf(s)),
      ...keysOf(clean()),
      ...GRAPHIC_OVERRIDE_KEYS.flatMap((k) => k.split('.'))
    ]
    // The walk reached the nested keys, so a clean result is not an empty one.
    for (const key of ['textStyleId', 'palette.accent', 'motion.ease', 'strokeLook']) expect(keys).toContain(key)
    expect(keys.filter((k) => /format|locale|group|separator/i.test(k))).toEqual([])
  })

  it('no key of the GraphicStyle type names one either, an optional key no preset sets and glow’s included (checked by the compiler)', () => {
    // The pattern catches what it is meant to, so the never below is not an empty answer.
    expectTypeOf<FormatNamed<'numberFormat' | 'Locale' | 'thousandsSeparator' | 'digitGrouping' | 'accent'>>().toEqualTypeOf<
      'numberFormat' | 'Locale' | 'thousandsSeparator' | 'digitGrouping'
    >()
    // And StyleKey reaches the nested and the optional keys.
    expectTypeOf<Extract<StyleKey, 'textStyleId' | 'accent' | 'ease' | 'strength'>>().toEqualTypeOf<
      'textStyleId' | 'accent' | 'ease' | 'strength'
    >()
    expectTypeOf<FormatNamed<StyleKey>>().toEqualTypeOf<never>()
  })
})

/** The keys of `GraphicStyle` whose name has format, locale, group or separator in it, in any case (§6.5's regex, at the type level). */
type FormatNamed<K> = K extends string
  ? Lowercase<K> extends `${string}${'format' | 'locale' | 'group' | 'separator'}${string}`
    ? K
    : never
  : never
/** Every key of the type, its nested objects' and the optional glow's included. */
type StyleKey =
  | keyof GraphicStyle
  | keyof GraphicStyle['palette']
  | keyof GraphicStyle['motion']
  | keyof NonNullable<GraphicStyle['glow']>

/* ------------------------------------------------------- the text styles */

const plainBase = { fill: { kind: 'solid', color: '#ffffff' }, weight: 700 } as const
const synthetic = (over: Partial<TextStyle>): TextStyle => ({
  id: 'synthetic',
  name: 'Synthetic',
  description: 'A test style.',
  base: { ...plainBase },
  ...over
})

describe('GRAPHIC_TEXT_STYLES (§6.3, §6.5)', () => {
  it('is TEXT_STYLES filtered by graphicEligible, every member passing it', () => {
    expect(GRAPHIC_TEXT_STYLES.map((s) => s.id)).toEqual(TEXT_STYLES.filter(graphicEligible).map((s) => s.id))
    for (const style of GRAPHIC_TEXT_STYLES) expect(graphicEligible(style), style.id).toBe(true)
    // §6.5's presets' text styles are members; chrome, which re-cases, is not.
    const ids = GRAPHIC_TEXT_STYLES.map((s) => s.id)
    for (const id of ['clean', 'outline', 'midnight', 'neon-green', 'shadow-pop']) expect(ids).toContain(id)
    expect(ids).not.toContain('chrome')
    expect(ids).toContain(CLEAN_GRAPHIC_STYLE.textStyleId)
  })

  it('graphicEligible refuses a synthetic style for each condition, and takes the plain one', () => {
    expect(graphicEligible(synthetic({})), 'plain').toBe(true)
    // A line-scoped accent that only colours is no reason to refuse.
    expect(graphicEligible(synthetic({ accent: { fill: { kind: 'solid', color: '#ffd400' } }, accentScope: 'line' })), 'line accent').toBe(true)
    const refused: [string, TextStyle][] = [
      ['base re-cases', synthetic({ base: { ...plainBase, uppercase: true } })],
      ['accent re-cases', synthetic({ accent: { uppercase: true }, accentScope: 'line' })],
      // No style of the 42 sets a face today, so this condition is synthetic only.
      ['base sets a face', synthetic({ base: { ...plainBase, font: 'Anton' } })],
      ['accent sets a face', synthetic({ accent: { font: 'Anton' }, accentScope: 'line' })],
      ['first-word accent', synthetic({ accent: { fill: { kind: 'solid', color: '#ffd400' } }, accentScope: 'firstWord' })],
      ['last-word accent', synthetic({ accent: { fill: { kind: 'solid', color: '#ffd400' } }, accentScope: 'lastWord' })]
    ]
    for (const [why, style] of refused) expect(graphicEligible(style), why).toBe(false)
  })

  it('"Mixed Case 10,00,000" drawn through each comes back unchanged', () => {
    const TEXT = 'Mixed Case 10,00,000'
    // Wide enough that the line never wraps under any member's size.
    const box = { width: 4000, height: 200 }
    const px = 80
    for (const style of GRAPHIC_TEXT_STYLES) {
      // As §6.3's textSpecOf builds it (lane B's, so written out here).
      const spec: TextSpec = {
        version: 0,
        content: TEXT,
        font: CLEAN_GRAPHIC_STYLE.font,
        size: px / box.height,
        color: '#FFFFFF',
        weight: 700,
        align: 'center',
        position: 'center',
        tracking: 0,
        uppercase: false,
        shadow: 0,
        stroke: 0,
        strokeColor: '#000000',
        styleId: style.id,
        margin: 0,
        offsetX: 0,
        offsetY: 0
      }
      const { ctx, drawn } = fakeContext()
      drawTextOnto(ctx, spec, box.width, box.height)
      expect(drawn.length, style.id).toBeGreaterThan(0)
      expect(new Set(drawn), style.id).toEqual(new Set([TEXT]))
    }
  })

  it('chrome, a re-casing style by its faces, asked for resolves to the preset’s text style; an eligible one is taken', () => {
    const textStyleOf = (value: unknown): string => resolveGraphicStyle('clean', { textStyleId: value }).textStyleId
    expect(textStyleOf('chrome')).toBe(CLEAN_GRAPHIC_STYLE.textStyleId)
    // Word-scoped, so refused too.
    expect(textStyleOf('highlight-word')).toBe(CLEAN_GRAPHIC_STYLE.textStyleId)
    expect(textStyleOf('no-such-style')).toBe(CLEAN_GRAPHIC_STYLE.textStyleId)
    expect(textStyleOf(7)).toBe(CLEAN_GRAPHIC_STYLE.textStyleId)
    expect(textStyleOf('outline')).toBe('outline')
  })
})

/** A 2D context that measures a glyph as 0.6 of the font size and records every string filled or stroked (tests/textPaint.test.ts's). */
function fakeContext(): { ctx: CanvasRenderingContext2D; drawn: string[] } {
  const drawn: string[] = []
  const state: Record<string | symbol, unknown> = { font: '10px sans-serif', textAlign: 'left' }
  const pxOf = (): number => Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 10)
  const stub: unknown = new Proxy(function stub() {}, { get: () => stub, apply: () => stub })
  const ctx = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'measureText') return (text: string) => ({ width: text.length * pxOf() * 0.6 })
        if (key === 'fillText' || key === 'strokeText') return (text: string) => drawn.push(text)
        if (key in state) return state[key]
        return () => stub
      },
      set(_target, key, value) {
        state[key] = value
        return true
      }
    }
  ) as unknown as CanvasRenderingContext2D
  return { ctx, drawn }
}

/* ------------------------------------------------------- the other guards */

describe('the other overrides (§6.5)', () => {
  it('a missing font, an unknown ease, a colour that is not hex and a dim that is not a boolean fall back to the preset’s; good ones are taken', () => {
    const preset = CLEAN_GRAPHIC_STYLE
    const with1 = (key: string, value: unknown): GraphicStyle => resolveGraphicStyle('clean', { [key]: value })

    for (const bad of ['', '   ', 42, null]) expect(with1('font', bad).font, `font ${String(bad)}`).toBe(preset.font)
    expect(with1('font', 'Anton').font).toBe('Anton')

    for (const key of ['motion.ease', 'motion.exit'] as const) {
      const read = (s: GraphicStyle): string => (key === 'motion.ease' ? s.motion.ease : s.motion.exit)
      const fallback = read(clean())
      for (const bad of ['bounce', 'toString', 'constructor', '', 1]) expect(read(with1(key, bad)), `${key} ${String(bad)}`).toBe(fallback)
      for (const good of ['decelerate', 'spring1', 'out-back', 'linear']) expect(read(with1(key, good)), `${key} ${good}`).toBe(good)
    }

    for (const key of ['palette.ink', 'palette.accent', 'palette.muted', 'palette.panel', 'palette.dim'] as const) {
      const field = key.slice('palette.'.length) as 'ink' | 'accent' | 'muted' | 'panel' | 'dim'
      for (const bad of ['blue', '#12345', '#GGGGGG', 'FFD400', 0xffd400, '']) {
        expect(with1(key, bad).palette[field], `${key} ${String(bad)}`).toBe(preset.palette[field])
      }
      for (const good of ['#2563EB', '#fff', '#2563eb80']) expect(with1(key, good).palette[field], `${key} ${good}`).toBe(good)
    }

    for (const bad of ['true', 1, null]) expect(with1('dim', bad).dim, `dim ${String(bad)}`).toBe(preset.dim)
    expect(with1('dim', true).dim).toBe(true)
  })

  it('ignores unknown keys, nested objects, inherited keys and overrides that are not an object', () => {
    const plain = clean()
    const ignored: [string, unknown][] = [
      ['the preset’s own keys', { id: 'bold', name: 'Bold', energy: 'energetic', glow: { radius: 4, strength: 1 }, 'glow.radius': 4 }],
      ['nested objects', { palette: { accent: '#000000' }, motion: { ease: 'linear' } }],
      ['unknown keys', { 'palette.accentColour': '#000000', numberFormat: 'en-IN', Radius: 0.05 }],
      ['inherited keys', Object.create({ radius: 0.05, 'palette.accent': '#000000' })],
      ['a string', 'radius'],
      ['an array', [0.05]],
      ['null', null]
    ]
    for (const [why, overrides] of ignored) {
      expect(resolveGraphicStyle('clean', overrides as Record<string, unknown>), why).toEqual(plain)
    }
  })
})

/* ------------------------------------------------------- the seven presets */

/*
 * Phase 2's cases (§6.5): the six other presets of the table beside `clean`.
 * Membership over GRAPHIC_STYLES, never its length or a snapshot of its
 * values: every number is a proposal the look rating (§6.10) will revise, so
 * what is pinned is the rules the values must keep, not the values.
 */

/** §6.5's presets table: id, name and text style. */
const TABLE: readonly (readonly [string, string, string])[] = [
  ['clean', 'Clean', 'clean'],
  ['bold', 'Bold', 'outline'],
  ['editorial', 'Editorial', 'midnight'],
  ['neon', 'Neon', 'neon-green'],
  ['mono', 'Mono', 'clean'],
  ['accent', 'Accent', 'clean'],
  ['energetic', 'Energetic', 'shadow-pop']
]

/** A text style's base fill as the ink must match it: a solid's colour, a gradient's last stop (§6.5). */
function inkOf(textStyleId: string): string {
  const style = TEXT_STYLES.find((t) => t.id === textStyleId)
  if (!style) throw new Error(`no text style ${textStyleId}`)
  const fill = style.base.fill
  if (fill.kind === 'solid') return fill.color.toUpperCase()
  if (fill.kind === 'gradient') return fill.stops[fill.stops.length - 1].color.toUpperCase()
  throw new Error(`${textStyleId} has no fill to match`)
}

describe('the seven presets (§6.5, phase 2)', () => {
  it('each of the table’s seven, by id, resolves to itself, with the table’s name and text style', () => {
    const ids = GRAPHIC_STYLES.map((s) => s.id)
    expect(new Set(ids).size, 'ids are unique').toBe(ids.length)
    for (const [id, name, textStyleId] of TABLE) {
      const preset = GRAPHIC_STYLES.find((s) => s.id === id)
      expect(preset, id).toBeDefined()
      expect(preset!.name, id).toBe(name)
      expect(preset!.textStyleId, id).toBe(textStyleId)
      // A text style a graphic may use (§6.3), so resolving keeps it.
      expect(GRAPHIC_TEXT_STYLES.map((t) => t.id), id).toContain(textStyleId)
      const resolved = resolveGraphicStyle(id)
      expect(resolved.id, id).toBe(id)
      expect(resolved, id).toEqual(preset)
      // Frozen, as clean is: a caller that changes a resolved style changes no preset.
      expect(Object.isFrozen(preset), id).toBe(true)
      expect(Object.isFrozen(preset!.palette), id).toBe(true)
    }
  })

  it('every preset is restrained but energetic, the only one with pop and out-back (§16.58)', () => {
    expect(GRAPHIC_STYLES.map((s) => s.id)).toContain('energetic')
    for (const style of GRAPHIC_STYLES) {
      if (style.id === 'energetic') {
        expect(style.energy).toBe('energetic')
        expect(style.motion.entrance).toBe('pop')
        expect(style.motion.ease).toBe('out-back')
        continue
      }
      expect(style.energy, style.id).toBe('restrained')
      expect(style.motion.entrance, style.id).not.toBe('pop')
      expect(style.motion.ease, style.id).not.toBe('out-back')
      expect(style.motion.exit, style.id).not.toBe('out-back')
    }
  })

  it('dim is false in every preset but energetic; every stroke look is clean (MARKER_READY is false)', () => {
    for (const style of GRAPHIC_STYLES) {
      expect(style.dim, style.id).toBe(style.id === 'energetic')
      expect(style.strokeLook, style.id).toBe('clean')
    }
  })

  it('each preset’s ink is its text style’s base fill, or a gradient’s last stop, read from TEXT_STYLES', () => {
    for (const style of GRAPHIC_STYLES) {
      expect(style.palette.ink.toUpperCase(), `${style.id} on ${style.textStyleId}`).toBe(inkOf(style.textStyleId))
    }
  })

  it('neon and energetic carry the glow phase 3 reads; the restrained others carry no glow key', () => {
    for (const style of GRAPHIC_STYLES) {
      if (style.id === 'neon' || style.id === 'energetic') {
        expect(style.glow, style.id).toBeDefined()
        expect(style.glow!.radius, style.id).toBeGreaterThan(0)
        expect(style.glow!.strength, style.id).toBeGreaterThan(0)
      } else {
        expect('glow' in style, style.id).toBe(false)
      }
    }
  })

  it('the accent preset is the 3dit blue until the user picks a colour, and takes the pick through palette.accent', () => {
    expect(resolveGraphicStyle('accent').palette.accent).toBe('#2563EB')
    expect(resolveGraphicStyle('accent', { 'palette.accent': '#E11D48' }).palette.accent).toBe('#E11D48')
    // Guarded as every colour: not hex, the preset's.
    expect(resolveGraphicStyle('accent', { 'palette.accent': 'red' }).palette.accent).toBe('#2563EB')
  })
})

/* ------------------------------------------------------------ graphicStyleOf */

describe('graphicStyleOf (§6.5)', () => {
  it('resolves with the project’s overrides, and is clean with none', () => {
    expect(graphicStyleOf({}, {})).toEqual(clean())
    const graphics = { styleId: 'clean', overrides: { 'palette.accent': '#2563EB', radius: 5 }, sound: true }
    const style = graphicStyleOf({ graphics }, {})
    expect(style.palette.accent).toBe('#2563EB')
    // Guarded on the way, as every override is.
    expect(style.radius).toBe(0.1)
    // A spec naming a style keeps the project's overrides (and an unknown one is clean).
    expect(graphicStyleOf({ graphics }, { style: 'no-such-style' }).palette.accent).toBe('#2563EB')
    expect(graphicStyleOf({ graphics: { ...graphics, styleId: 'no-such-style' } }, {})).toEqual(style)
    // Which id wins, the spec's or the project's, with two presets: tests/renderer/graphicStyleStore.test.ts.
  })
})
