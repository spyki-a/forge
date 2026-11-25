import { describe, expect, it } from 'vitest'
import { CAPTION_STYLES, resolveStyle, type StyleOverrides } from '../src/shared/captions/style'
import {
  GRAPHIC_OVERRIDE_KEYS,
  GRAPHIC_STYLES,
  GRAPHIC_TEXT_STYLES,
  graphicOverrideAccepted,
  resolveGraphicStyle
} from '../src/shared/graphics/style'
import { TEXT_STYLES } from '../src/shared/render/textStyle'
import { TEXT_ANIMATIONS } from '../src/shared/render/textAnimation'
import { emptyProject, type Project } from '../src/shared/timeline'
import {
  LOOK_AUTHOR_MAX,
  LOOK_CAPTION_KEYS,
  LOOK_FILE_MAX_BYTES,
  LOOK_KIND,
  LOOK_LICENCE_MAX,
  LOOK_NAME_MAX,
  LOOK_NEWER,
  LOOK_NOTE_ANIMATION,
  LOOK_NOTE_SHORTENED,
  LOOK_NOTE_TEXT_STYLE,
  LOOK_NOT_A_LOOK,
  LOOK_SCHEMA,
  LOOK_TOO_LARGE,
  LOOK_UNKNOWN_CAPTION_STYLE,
  LOOK_UNKNOWN_GRAPHIC_STYLE,
  LOOK_UNREADABLE,
  SAVED_LOOKS_MAX,
  applyLook,
  fileNameOf,
  lookDroppedNote,
  lookFileBase,
  lookFontNotes,
  lookFromProject,
  lookIsApplied,
  parseLook,
  readLookText,
  saneSavedLooks,
  serializeLook,
  uniqueLookName,
  type Look
} from '../src/shared/look'

/*
 * The creator style, "my look" (docs/CLIPS.md §10, step 7's first bullet):
 * shared/look.ts. A look's file is a stranger's input, so most of this file
 * is what parseLook does with one; the round trip is a property over every
 * caption preset with every graphic preset and generated overrides.
 *
 * The non-Latin names are made-up words in Georgian and Gothic letters, not
 * words of any language the app captions.
 */

/* --------------------------------------------------------------- helpers */

/** A small seeded generator (mulberry32), so a failing case can be replayed. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Gen = (r: () => number) => unknown
const pick = <T,>(items: readonly T[]): ((r: () => number) => T) => (r) => items[Math.floor(r() * items.length)]
const between = (min: number, max: number): Gen => (r) => min + r() * (max - min)
const whole = (min: number, max: number): Gen => (r) => Math.floor(min + r() * (max - min + 1))
const bool: Gen = (r) => r() < 0.5
const hex = (digits: number): Gen => (r) =>
  `#${Array.from({ length: digits }, () => '0123456789abcdefABCDEF'[Math.floor(r() * 22)]).join('')}`
const FONTS = ['Anton', 'Montserrat', 'Bebas Neue', 'Poppins', 'Playfair Display']

/** A value the look keeps, for every caption override key. */
const CAPTION_GENS: Record<string, Gen> = {
  fontFamily: pick(FONTS),
  fontSize: whole(8, 320),
  primaryColor: hex(6),
  highlightColor: hex(6),
  outlineColor: hex(6),
  outlineWidth: between(0, 20),
  uppercase: bool,
  position: pick(['top', 'center', 'bottom']),
  marginV: whole(0, 430),
  wordsPerLine: whole(1, 8),
  highlightScale: between(1, 1.5),
  animated: bool,
  textStyleId: pick(TEXT_STYLES.map((s) => s.id)),
  animationId: pick(TEXT_ANIMATIONS.map((a) => a.id)),
  bold: bool,
  shadowDepth: between(0, 10)
}

/** A value resolveGraphicStyle uses (as given or clamped), for every graphic override key. */
const GRAPHIC_GENS: Record<string, Gen> = {
  textStyleId: pick(GRAPHIC_TEXT_STYLES.map((s) => s.id)),
  font: pick(FONTS),
  'palette.ink': (r) => hex(pick([3, 4, 6, 8])(r))(r),
  'palette.accent': hex(6),
  'palette.muted': hex(8),
  'palette.panel': hex(3),
  'palette.panelOpacity': between(0, 1.5),
  'palette.dim': hex(6),
  'palette.dimOpacity': between(0, 1),
  radius: between(0, 0.2),
  stroke: between(0, 0.05),
  shadow: between(0, 1),
  'motion.entrance': pick(['rise', 'pop', 'wipe', 'blur-rise']),
  'motion.ease': pick(['expo-out', 'decelerate', 'linear', 'out-back', 'spring1']),
  'motion.exit': pick(['accelerate', 'standard', 'out-cubic']),
  strokeLook: pick(['clean', 'marker']),
  dim: bool
}

function overridesFrom(gens: Record<string, Gen>, r: () => number, every: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, gen] of Object.entries(gens)) if (every || r() < 0.5) out[key] = gen(r)
  return out
}

function projectWith(captions: Partial<Project['captions']>, graphics?: Project['graphics']): Project {
  const p = emptyProject()
  return { ...p, captions: { ...p.captions, ...captions }, ...(graphics ? { graphics } : {}) }
}

const HEADER = { name: 'Studio look', author: 'Ana', licence: 'Use it on your own videos' }

/** A good look's file object, to break one field at a time. */
function goodFile(): Record<string, unknown> {
  return JSON.parse(
    serializeLook(
      lookFromProject(
        projectWith(
          { styleId: 'clean', overrides: { fontSize: 70, primaryColor: '#FFEE00' }, placement: 'smart' },
          { styleId: 'bold', overrides: { 'palette.accent': '#2563EB', radius: 0.04 }, sound: true }
        ),
        HEADER
      )
    )
  ) as Record<string, unknown>
}

const ok = (read: ReturnType<typeof parseLook>): { look: Look; notes: string[] } => {
  if (!read.ok) throw new Error(`refused: ${read.reason}`)
  return read
}

/* ------------------------------------------------------------- the round trip */

describe('the round trip: make, write, read, apply', () => {
  it('has a generator for every overridable key, so the property covers each one', () => {
    for (const key of LOOK_CAPTION_KEYS) expect(Object.keys(CAPTION_GENS), key).toContain(key)
    for (const key of GRAPHIC_OVERRIDE_KEYS) expect(Object.keys(GRAPHIC_GENS), key).toContain(key)
  })

  it('every caption preset with every graphic preset, with generated overrides, resolves to the same two styles on a default project', () => {
    const r = rng(20261125)
    let cases = 0
    for (const caption of CAPTION_STYLES) {
      for (const graphic of GRAPHIC_STYLES) {
        for (let round = 0; round < 6; round++) {
          // Round 0 has none, round 1 every key, the rest a random half.
          const co = round === 0 ? undefined : overridesFrom(CAPTION_GENS, r, round === 1)
          const go = round === 0 ? undefined : overridesFrom(GRAPHIC_GENS, r, round === 1)
          const source = projectWith(
            { styleId: caption.id, overrides: co, placement: round % 2 === 1 ? 'smart' : undefined },
            { styleId: graphic.id, overrides: go, sound: false }
          )
          const look = lookFromProject(source, HEADER)
          const read = ok(readLookText(serializeLook(look)))
          expect(read.notes, `${caption.id}/${graphic.id}/${round}`).toEqual([])
          const target = applyLook(emptyProject(), read.look)
          const where = `${caption.id}/${graphic.id}/${round}`
          expect(resolveStyle(target.captions.styleId, target.captions.overrides as StyleOverrides), where).toStrictEqual(
            resolveStyle(source.captions.styleId, source.captions.overrides as StyleOverrides)
          )
          expect(resolveGraphicStyle(target.graphics!.styleId, target.graphics!.overrides), where).toStrictEqual(
            resolveGraphicStyle(source.graphics!.styleId, source.graphics!.overrides)
          )
          expect(target.captions.placement, where).toBe(source.captions.placement)
          expect(lookIsApplied(target, read.look), where).toBe(true)
          expect(lookIsApplied(source, look), where).toBe(true)
          cases++
        }
      }
    }
    expect(cases).toBe(CAPTION_STYLES.length * GRAPHIC_STYLES.length * 6)
  })

  it('a look is not "the one applied" to a project that draws differently', () => {
    const look = lookFromProject(projectWith({ styleId: 'clean' }, { styleId: 'neon', sound: true }), HEADER)
    expect(lookIsApplied(projectWith({ styleId: 'clean' }, { styleId: 'neon', sound: true }), look)).toBe(true)
    // The captions differ.
    expect(lookIsApplied(projectWith({ styleId: 'pop' }, { styleId: 'neon', sound: true }), look)).toBe(false)
    // The graphics differ.
    expect(lookIsApplied(projectWith({ styleId: 'clean' }, { styleId: 'mono', sound: true }), look)).toBe(false)
    // An override that changes the drawing.
    expect(lookIsApplied(projectWith({ styleId: 'clean' }, { styleId: 'neon', overrides: { radius: 0.09 }, sound: true }), look)).toBe(false)
    // The placement differs.
    expect(lookIsApplied(projectWith({ styleId: 'clean', placement: 'smart' }, { styleId: 'neon', sound: true }), look)).toBe(false)
    // An override that sets what the preset already has is still the same drawing.
    expect(lookIsApplied(projectWith({ styleId: 'clean', overrides: { fontFamily: 'Montserrat' } }, { styleId: 'neon', sound: true }), look)).toBe(true)
  })
})

/* --------------------------------------------------------- a stranger's file */

describe('parseLook against a stranger’s file', () => {
  it('refuses what is not a look, saying what to do, and never throws', () => {
    for (const bad of [null, undefined, 7, 'look', true, [], [goodFile()], () => 1, { ...goodFile(), kind: 'forge-project' }, { ...goodFile(), kind: undefined }]) {
      const read = parseLook(bad)
      expect(read.ok).toBe(false)
      if (!read.ok) expect(read.reason).toBe(LOOK_NOT_A_LOOK)
    }
    // Captions or graphics missing, an array, or with no preset id.
    for (const field of ['captions', 'graphics']) {
      for (const value of [undefined, null, [], new Array(100_000).fill(1), { overrides: {} }, { styleId: 3 }]) {
        const read = parseLook({ ...goodFile(), [field]: value })
        expect(read, `${field} ${JSON.stringify(value)?.slice(0, 30)}`).toStrictEqual({ ok: false, reason: LOOK_NOT_A_LOOK })
      }
    }
    // A schema that is not a whole number from 1.
    for (const schema of [0, -1, 1.5, '1', null, Number.NaN]) {
      expect(parseLook({ ...goodFile(), schema })).toStrictEqual({ ok: false, reason: LOOK_NOT_A_LOOK })
    }
    // A getter that throws is refused, not thrown.
    const hostile = goodFile()
    Object.defineProperty(hostile, 'captions', { enumerable: true, get: () => { throw new Error('boom') } })
    expect(parseLook(hostile)).toStrictEqual({ ok: false, reason: LOOK_NOT_A_LOOK })
  })

  it('refuses a newer schema as made by a newer app, and accepts its own', () => {
    expect(parseLook({ ...goodFile(), schema: LOOK_SCHEMA + 1 })).toStrictEqual({ ok: false, reason: LOOK_NEWER })
    expect(LOOK_NEWER).toMatch(/newer version of the app/)
    expect(parseLook({ ...goodFile(), schema: LOOK_SCHEMA }).ok).toBe(true)
  })

  it('refuses a preset id it does not have, captions’ or graphics’', () => {
    const file = goodFile()
    expect(parseLook({ ...file, captions: { ...(file.captions as object), styleId: 'sparkle' } })).toStrictEqual({ ok: false, reason: LOOK_UNKNOWN_CAPTION_STYLE })
    expect(parseLook({ ...file, graphics: { ...(file.graphics as object), styleId: 'sparkle' } })).toStrictEqual({ ok: false, reason: LOOK_UNKNOWN_GRAPHIC_STYLE })
  })

  it('drops an override of the wrong type, an unknown key, NaN and Infinity, counting them in one note', () => {
    const read = ok(
      parseLook({
        ...goodFile(),
        captions: {
          styleId: 'pop',
          overrides: {
            fontSize: 'big', // wrong type
            wordsPerLine: Number.NaN,
            marginV: Number.POSITIVE_INFINITY,
            primaryColor: 'red', // not a hex colour
            highlightColor: '#ABC', // three digits: the caption file reads six
            position: 'left',
            shadow: 3, // a graphics key, not a caption one
            bold: true // kept
          }
        },
        graphics: {
          styleId: 'clean',
          overrides: {
            radius: -1,
            stroke: Number.NEGATIVE_INFINITY,
            'palette.accent': 'blue',
            'motion.ease': 'bounce',
            colour: '#fff', // unknown
            dim: false // kept
          }
        }
      })
    )
    expect(read.look.captions.overrides).toStrictEqual({ bold: true })
    expect(read.look.graphics.overrides).toStrictEqual({ dim: false })
    expect(read.notes).toContain(lookDroppedNote(12))
    expect(read.notes.filter((n) => /could not be used/.test(n))).toHaveLength(1)
  })

  it('drops an overrides value that is not an object (a huge array) as one setting', () => {
    const file = goodFile()
    const read = ok(parseLook({ ...file, captions: { styleId: 'pop', overrides: new Array(200_000).fill('x') } }))
    expect(read.look.captions.overrides).toBeUndefined()
    expect(read.notes).toContain(lookDroppedNote(1))
  })

  it('drops an unknown text style or animation with its own note, not the count', () => {
    const read = ok(
      parseLook({
        ...goodFile(),
        captions: { styleId: 'pop', overrides: { textStyleId: 'aurora-9', animationId: 'warp-9', fontSize: 70 } },
        graphics: { styleId: 'clean', overrides: { textStyleId: 'aurora-9' } }
      })
    )
    expect(read.look.captions.overrides).toStrictEqual({ fontSize: 70 })
    expect(read.look.graphics.overrides).toBeUndefined()
    expect(read.notes).toContain(LOOK_NOTE_TEXT_STYLE)
    expect(read.notes).toContain(LOOK_NOTE_ANIMATION)
    expect(read.notes.some((n) => /could not be used/.test(n))).toBe(false)
    // A text style the app has but a graphic may not use is a setting left out, not one the app lacks.
    const ineligible = TEXT_STYLES.find((s) => !GRAPHIC_TEXT_STYLES.includes(s))!
    const again = ok(parseLook({ ...goodFile(), graphics: { styleId: 'clean', overrides: { textStyleId: ineligible.id } } }))
    expect(again.notes).toContain(lookDroppedNote(1))
    expect(again.notes).not.toContain(LOOK_NOTE_TEXT_STYLE)
  })

  it('copies no __proto__, constructor or prototype key at any level, and leaves Object.prototype untouched', () => {
    const text = JSON.stringify(goodFile()).replace(/^\{/, '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},')
    const raw = JSON.parse(text) as Record<string, unknown>
    // JSON.parse makes "__proto__" an own key: the file really carries one.
    expect(Object.hasOwn(raw, '__proto__')).toBe(true)
    const captions = raw.captions as Record<string, unknown>
    const graphics = raw.graphics as Record<string, unknown>
    raw.captions = JSON.parse(JSON.stringify(captions).replace(/^\{/, '{"__proto__":{"polluted":3},'))
    ;(raw.captions as Record<string, unknown>).overrides = JSON.parse('{"__proto__":{"polluted":4},"constructor":{"x":1},"prototype":5,"bold":true}')
    raw.graphics = { ...graphics, overrides: JSON.parse('{"__proto__":{"polluted":5},"constructor":1,"prototype":{"y":2},"dim":true}') }

    const read = ok(parseLook(raw))
    expect(Object.prototype).not.toHaveProperty('polluted')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    const objects = [read.look, read.look.captions, read.look.graphics, read.look.captions.overrides, read.look.graphics.overrides]
    for (const object of objects) {
      expect(Object.getPrototypeOf(object)).toBe(Object.prototype)
      for (const key of ['__proto__', 'constructor', 'prototype']) expect(Object.hasOwn(object as object, key), key).toBe(false)
      expect((object as Record<string, unknown>).polluted).toBeUndefined()
    }
    expect(read.look.captions.overrides).toStrictEqual({ bold: true })
    expect(read.look.graphics.overrides).toStrictEqual({ dim: true })
    // Three bad keys in each overrides, counted; the top-level and captions-level ones are not read at all.
    expect(read.notes).toContain(lookDroppedNote(6))
    // And the file written from it carries none of them.
    expect(serializeLook(read.look)).not.toMatch(/__proto__|constructor|prototype|polluted/)
  })

  it('caps the name, maker and licence line, in characters, with one note, and keeps a name in another script whole', () => {
    const long = 'ა'.repeat(LOOK_NAME_MAX + 40)
    const read = ok(parseLook({ ...goodFile(), name: long, author: 'x'.repeat(5000), licence: 'y'.repeat(50_000) }))
    expect(Array.from(read.look.name)).toHaveLength(LOOK_NAME_MAX)
    expect(Array.from(read.look.author)).toHaveLength(LOOK_AUTHOR_MAX)
    expect(Array.from(read.look.licence)).toHaveLength(LOOK_LICENCE_MAX)
    expect(read.notes).toEqual([LOOK_NOTE_SHORTENED])
    // Astral letters are never split in half.
    const gothic = ok(parseLook({ ...goodFile(), name: '𐌰𐌱𐌲'.repeat(40) }))
    expect(Array.from(gothic.look.name)).toHaveLength(LOOK_NAME_MAX)
    expect(gothic.look.name).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    // A made-up name in Georgian letters survives the round trip untouched.
    const named = ok(parseLook({ ...goodFile(), name: 'ქალო ბერა' }))
    expect(named.notes).toEqual([])
    expect(ok(readLookText(serializeLook(named.look))).look.name).toBe('ქალო ბერა')
    // Control characters go; a header field of the wrong type is a counted setting.
    const control = ok(parseLook({ ...goodFile(), name: 'a\u0000b\u001fc\u007f', author: 42 }))
    expect(control.look.name).toBe('abc')
    expect(control.look.author).toBe('')
    expect(control.notes).toContain(lookDroppedNote(1))
  })

  it('refuses a font family that could end a style line, and keeps an ordinary one', () => {
    for (const family of ['Anton, Arial', 'Bad"Font', 'X;Y', '{\\b1}', ' Padded', 'f'.repeat(101), '']) {
      const read = ok(parseLook({ ...goodFile(), captions: { styleId: 'pop', overrides: { fontFamily: family } }, graphics: { styleId: 'clean', overrides: { font: family } } }))
      expect(read.look.captions.overrides, family).toBeUndefined()
      expect(read.look.graphics.overrides, family).toBeUndefined()
    }
    const fine = ok(parseLook({ ...goodFile(), captions: { styleId: 'pop', overrides: { fontFamily: 'Noto Sans' } }, graphics: { styleId: 'clean', overrides: { font: 'Noto Sans' } } }))
    expect(fine.look.captions.overrides).toStrictEqual({ fontFamily: 'Noto Sans' })
    expect(fine.look.graphics.overrides).toStrictEqual({ font: 'Noto Sans' })
  })

  it('a version that is not a whole number from 1 reads as 1, counted', () => {
    for (const version of [0, -3, 2.5, '4', Number.NaN, Number.POSITIVE_INFINITY, 1e12]) {
      const read = ok(parseLook({ ...goodFile(), version }))
      expect(read.look.version, String(version)).toBe(1)
      expect(read.notes).toContain(lookDroppedNote(1))
    }
    expect(ok(parseLook({ ...goodFile(), version: 7 })).look.version).toBe(7)
  })
})

describe('readLookText: the file’s text', () => {
  it('refuses a text past the cap before parsing, and text that is not a look’s with a reason that holds none of it', () => {
    const big = `{"kind":"${LOOK_KIND}","pad":"${'z'.repeat(LOOK_FILE_MAX_BYTES)}"}`
    expect(readLookText(big)).toStrictEqual({ ok: false, reason: LOOK_TOO_LARGE })
    for (const text of ['not a look at all: SECRET-TOKEN', '{"kind": "forge-look", SECRET', '', '\u0000\u0001']) {
      const read = readLookText(text)
      expect(read).toStrictEqual({ ok: false, reason: LOOK_UNREADABLE })
    }
    // A byte order mark is read past.
    expect(readLookText(`\uFEFF${serializeLook(ok(parseLook(goodFile())).look)}`).ok).toBe(true)
  })

  it('measures the cap in UTF-8 bytes, not characters', () => {
    // Under the cap in characters, over it in bytes (each Georgian letter is three).
    const pad = 'ა'.repeat(Math.ceil(LOOK_FILE_MAX_BYTES / 3) + 10)
    expect(pad.length).toBeLessThan(LOOK_FILE_MAX_BYTES)
    expect(readLookText(JSON.stringify({ ...goodFile(), name: pad }))).toStrictEqual({ ok: false, reason: LOOK_TOO_LARGE })
  })

  it('a look with every override and the longest strings is far under the cap', () => {
    const r = rng(7)
    const look = lookFromProject(
      projectWith({ styleId: 'pop', overrides: overridesFrom(CAPTION_GENS, r, true), placement: 'smart' }, { styleId: 'neon', overrides: overridesFrom(GRAPHIC_GENS, r, true), sound: true }),
      { name: 'ა'.repeat(LOOK_NAME_MAX), author: 'ა'.repeat(LOOK_AUTHOR_MAX), licence: 'ა'.repeat(LOOK_LICENCE_MAX) }
    )
    const bytes = new TextEncoder().encode(serializeLook(look)).length
    expect(bytes).toBeLessThan(4096)
  })
})

/* ------------------------------------------------------------------ the file */

describe('serializeLook', () => {
  const look = lookFromProject(
    projectWith({ styleId: 'clean', overrides: { primaryColor: '#FFEE00', fontSize: 70 }, placement: 'smart' }, { styleId: 'bold', overrides: { radius: 0.04, 'palette.accent': '#2563EB' }, sound: false }),
    { name: 'Studio look' }
  )

  it('writes the keys in a stable order, the header’s three fields always, two-space indent and one final newline', () => {
    const text = serializeLook(look)
    expect(text.endsWith('}\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
    expect(text.split('\n')[1]).toBe(`  "kind": "${LOOK_KIND}",`)
    const file = JSON.parse(text) as Record<string, Record<string, unknown>>
    expect(Object.keys(file)).toEqual(['kind', 'schema', 'name', 'author', 'version', 'licence', 'captions', 'graphics'])
    // Empty author and licence are written, not left out.
    expect(file.author).toBe('')
    expect(file.licence).toBe('')
    expect(file.version).toBe(1)
    expect(Object.keys(file.captions)).toEqual(['styleId', 'overrides', 'placement'])
    expect(Object.keys(file.captions.overrides as object)).toEqual(['fontSize', 'primaryColor'])
    expect(Object.keys(file.graphics.overrides as object)).toEqual(['palette.accent', 'radius'])
    // The same look written twice, from objects built in another order, is the same text.
    const shuffled = {
      graphics: { overrides: { radius: 0.04, 'palette.accent': '#2563EB' }, styleId: 'bold' },
      captions: { placement: look.captions.placement, overrides: { primaryColor: '#FFEE00', fontSize: 70 }, styleId: 'clean' },
      licence: look.licence,
      version: look.version,
      author: look.author,
      name: look.name,
      schema: look.schema,
      kind: look.kind
    } as Look
    expect(serializeLook(shuffled)).toBe(text)
  })

  it('writes no key that is not a look’s, whatever the object carries', () => {
    const carrying = {
      ...look,
      path: '/Users/someone/Bride 5:30pm.forge',
      apiKey: 'sk-live-123',
      enabled: true,
      sound: true,
      captions: { ...look.captions, enabled: true, words: ['hello'] },
      graphics: { ...look.graphics, sound: false, clips: [1] }
    } as unknown as Look
    const file = JSON.parse(serializeLook(carrying)) as Record<string, Record<string, unknown>>
    const allowed = ['kind', 'schema', 'name', 'author', 'version', 'licence', 'captions', 'graphics']
    for (const key of Object.keys(file)) expect(allowed).toContain(key)
    for (const key of Object.keys(file.captions)) expect(['styleId', 'overrides', 'placement']).toContain(key)
    for (const key of Object.keys(file.graphics)) expect(['styleId', 'overrides']).toContain(key)
    expect(serializeLook(carrying)).not.toMatch(/sk-live|Users|enabled|sound|hello|clips/)
  })
})

describe('lookFileBase: a Windows-safe file name', () => {
  it('drops the illegal characters and keeps the rest of an ordinary name', () => {
    expect(lookFileBase('Bride 5:30pm')).toBe('Bride 530pm')
    expect(lookFileBase('a<b>c"d|e?f*g')).toBe('abcdefg')
    // A name is not a path: a separator becomes a hyphen and both words stay.
    expect(lookFileBase('Before/After\\Look')).toBe('Before-After-Look')
  })

  it('trailing dots and spaces, reserved names, a name of only illegal characters', () => {
    expect(lookFileBase('Summer. . ')).toBe('Summer')
    expect(lookFileBase('...Look')).toBe('Look')
    for (const reserved of ['CON', 'nul', 'Com1', 'LPT9', 'aux.look']) expect(lookFileBase(reserved)).toBe(`_${reserved}`)
    expect(lookFileBase('<>:"|?*')).toBe('look')
    expect(lookFileBase('   ')).toBe('look')
    expect(lookFileBase('')).toBe('look')
  })

  it('keeps a name in another script, and never cuts a letter in half', () => {
    expect(lookFileBase('ქალო ბერა')).toBe('ქალო ბერა')
    // One BMP letter, then astral ones: the 80-unit cut lands inside a pair.
    const base = lookFileBase(`a${'𐌰'.repeat(60)}`)
    expect(base).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    expect(base.length).toBeLessThanOrEqual(80)
    expect(base.startsWith('a𐌰')).toBe(true)
  })

  it('holds no illegal character in the BASENAME of a file named from any of them', () => {
    for (const name of ['Bride 5:30pm', 'CON', '<>:"|?*', 'ქალო ბერა', 'x/y\\z', 'Look.  ']) {
      const file = fileNameOf(`C:\\Users\\me\\Looks\\${lookFileBase(name)}.forgelook`)
      expect(file, name).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/)
      expect(file, name).not.toMatch(/[. ]\.forgelook$/)
    }
  })

  it('fileNameOf takes the last segment by either separator', () => {
    expect(fileNameOf('C:\\a\\b\\Studio.forgelook')).toBe('Studio.forgelook')
    expect(fileNameOf('/a/b/Studio.forgelook')).toBe('Studio.forgelook')
  })
})

/* --------------------------------------------------------------------- apply */

describe('applyLook', () => {
  const look = lookFromProject(projectWith({ styleId: 'kinetic', overrides: { fontSize: 60 } }, { styleId: 'editorial', overrides: { radius: 0.05 }, sound: true }), { name: 'L' })

  it('sets both styles and leaves captions on or off and the sounds switch as they were', () => {
    for (const enabled of [true, false]) {
      for (const sound of [true, false]) {
        const source = projectWith({ enabled, styleId: 'pop' }, { styleId: 'clean', sound })
        const after = applyLook(source, look)
        expect(after.captions.enabled).toBe(enabled)
        expect(after.graphics!.sound).toBe(sound)
        expect(after.captions.styleId).toBe('kinetic')
        expect(after.graphics!.styleId).toBe('editorial')
      }
    }
    // No graphics at all is sounds on (timeline.ts), and stays so.
    const none = applyLook(projectWith({ styleId: 'pop' }), look)
    expect(none.graphics).toStrictEqual({ sound: true, styleId: 'editorial', overrides: { radius: 0.05 } })
  })

  it('touches no clip, no transcript and no caption word', () => {
    const base = projectWith({ styleId: 'pop' }, { styleId: 'clean', sound: true })
    const clip = { id: 'c1', assetId: 'a', trackId: 'v1', start: 0, duration: 30, inPoint: 0, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 } }
    const transcripts = { a: { language: 'en', words: [{ text: 'hello', start: 0, end: 0.4 }] } } as unknown as Project['transcripts']
    const source: Project = { ...base, clips: [clip as unknown as Project['clips'][number]], transcripts }
    const after = applyLook(source, look)
    expect(after.clips).toBe(source.clips)
    expect(after.transcripts).toBe(source.transcripts)
    expect(after.tracks).toBe(source.tracks)
    expect(after.assets).toBe(source.assets)
    expect(after.settings).toBe(source.settings)
  })

  it('REPLACES the overrides: a look without one clears the project’s', () => {
    const plain = lookFromProject(projectWith({ styleId: 'clean' }, { styleId: 'mono', sound: true }), { name: 'Plain' })
    expect(plain.captions.overrides).toBeUndefined()
    expect(plain.graphics.overrides).toBeUndefined()
    const source = projectWith(
      { styleId: 'pop', overrides: { fontSize: 99, textStyleId: TEXT_STYLES[0].id }, placement: 'smart' },
      { styleId: 'clean', overrides: { 'palette.accent': '#E11D48', textStyleId: GRAPHIC_TEXT_STYLES[0].id }, sound: true }
    )
    const after = applyLook(source, plain)
    expect(after.captions.overrides).toStrictEqual({})
    expect(after.graphics!.overrides).toStrictEqual({})
    expect('placement' in after.captions).toBe(false)
    // And one that has some sets exactly those, nothing of the project's kept.
    const merged = applyLook(source, look)
    expect(merged.captions.overrides).toStrictEqual({ fontSize: 60 })
    expect(merged.graphics!.overrides).toStrictEqual({ radius: 0.05 })
  })

  it('is the same project back when it already holds the look', () => {
    const once = applyLook(projectWith({ styleId: 'pop' }), look)
    expect(applyLook(once, look)).toBe(once)
  })
})

/* ------------------------------------------------------------ names, list */

describe('names and the saved list', () => {
  it('uniqueLookName adds the first free number, without regard to case, within the cap', () => {
    expect(uniqueLookName('Studio', [])).toBe('Studio')
    expect(uniqueLookName('Studio', ['studio'])).toBe('Studio 2')
    expect(uniqueLookName('Studio', ['Studio', 'Studio 2', 'STUDIO 3'])).toBe('Studio 4')
    const long = 'ა'.repeat(LOOK_NAME_MAX)
    const next = uniqueLookName(long, [long])
    expect(Array.from(next)).toHaveLength(LOOK_NAME_MAX)
    expect(next.endsWith(' 2')).toBe(true)
    expect(uniqueLookName('', [])).toBe('Imported look')
  })

  it('saneSavedLooks keeps the sane ones, drops refused, unnamed and repeated ones, and caps the list', () => {
    const good = (name: string): Look => lookFromProject(projectWith({ styleId: 'pop' }), { name })
    const raw = [good('A'), { kind: 'nope' }, 5, null, good(''), good('a'), { ...good('B'), schema: 99 }, good('C')]
    expect(saneSavedLooks(raw).map((l) => l.name)).toEqual(['A', 'C'])
    for (const bad of [undefined, null, 'x', { 0: good('A') }, 3]) expect(saneSavedLooks(bad)).toEqual([])
    const many = Array.from({ length: SAVED_LOOKS_MAX + 20 }, (_, i) => good(`Look ${i}`))
    const kept = saneSavedLooks(many)
    expect(kept).toHaveLength(SAVED_LOOKS_MAX)
    expect(kept[0].name).toBe('Look 0')
  })
})

describe('a font the machine lacks', () => {
  const look = lookFromProject(
    projectWith({ styleId: 'pop', overrides: { fontFamily: 'Nowhere Sans' } }, { styleId: 'clean', overrides: { font: 'Elsewhere Serif' }, sound: true }),
    { name: 'Fonts' }
  )

  it('is not refused, and gets one note per missing family, naming only the family', () => {
    expect(lookFontNotes(look, ['Anton', 'Nowhere Sans'])).toEqual([expect.stringContaining('“Elsewhere Serif”')])
    expect(lookFontNotes(look, [])).toHaveLength(2)
    expect(lookFontNotes(look, ['Nowhere Sans', 'Elsewhere Serif'])).toEqual([])
  })

  it('says nothing while what is installed is not known yet', () => {
    expect(lookFontNotes(look, null)).toEqual([])
  })
})

describe('graphicOverrideAccepted agrees with resolveGraphicStyle', () => {
  it('for every key: an accepted value changes the drawing from a different start, a refused one never does', () => {
    const values: unknown[] = [-1, 0, 0.005, 0.5, 2, Number.NaN, Number.POSITIVE_INFINITY, true, false, 'clean', 'marker', 'rise', 'wipe', 'linear', 'bounce', '#123', '#123456', '#12345678', 'red', '', 'Anton', GRAPHIC_TEXT_STYLES[1].id, null, undefined, {}]
    for (const key of GRAPHIC_OVERRIDE_KEYS) {
      for (const value of values) {
        const accepted = graphicOverrideAccepted(key, value)
        if (accepted) continue
        // A refused value draws exactly as no override, on every preset.
        for (const preset of GRAPHIC_STYLES) {
          expect(resolveGraphicStyle(preset.id, { [key]: value }), `${key}=${String(value)} on ${preset.id}`).toStrictEqual(resolveGraphicStyle(preset.id))
        }
      }
    }
    // And the accepted ones are what resolve uses: a negative radius is refused, a large one clamped and kept.
    expect(graphicOverrideAccepted('radius', -0.1)).toBe(false)
    expect(graphicOverrideAccepted('radius', 5)).toBe(true)
    expect(resolveGraphicStyle('clean', { radius: 5 }).radius).toBe(0.1)
    expect(graphicOverrideAccepted('no-such-key', 1)).toBe(false)
    expect(graphicOverrideAccepted('__proto__', {})).toBe(false)
  })
})
