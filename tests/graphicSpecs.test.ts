import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { GRAPHIC_TEMPLATES, type GraphicSpec } from '@shared/graphics/template'
import { readingSeconds } from '@shared/graphics/beats'
import { parentsValid } from '@shared/graphics/tree'
import { numberOf } from '@shared/graphics/numbers'

/*
 * The 27 drawing fixtures (docs/CLIPS.md §6.2, "Fixtures for drawing"; §6.10)
 * as the tests that will draw them need them, and readingSeconds (§6.2,
 * "Reading holds"). graphicFrame, graphicPaint, graphicHolds and the
 * harness read tests/fixtures/graphics/specs.json; this file holds it to its
 * shape so they can stand on it.
 */

interface Entry {
  id: string
  shape: string
  language: 'en' | 'hi' | 'te'
  spec: GraphicSpec
}

const FILE = JSON.parse(
  readFileSync(new URL('./fixtures/graphics/specs.json', import.meta.url), 'utf8')
) as { note: string; specs: Entry[] }

const SHAPES = ['counter', 'bars', 'steps', 'steps-connected', 'quote', 'callout', 'ring', 'keyword', 'lower-third']
const LANGUAGES = ['en', 'hi', 'te'] as const
const LEAD_S = 0.5 // §6.8, not yet a constant in src (graphicBeats arrives with T3)
const DEVANAGARI = /[ऀ-ॿ]/
const TELUGU = /[ఀ-౿]/

/** The strings a spec draws, as data holds them. */
function drawn(spec: GraphicSpec): string[] {
  const d = spec.data
  switch (d.template) {
    case 'counter':
    case 'ring':
      return [d.value, d.label]
    case 'bars':
      return [d.title, ...d.items.flatMap((i) => [i.label, i.value])]
    case 'steps':
      return [d.title, ...d.items.map((i) => i.label)]
    case 'quote':
      return d.kind === 'social' ? [d.text, d.name] : [d.text, d.speaker]
    case 'callout':
      return [d.label]
    case 'keyword':
      return [d.words]
    case 'lower-third':
      return [d.name, d.role]
    default:
      return []
  }
}

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean)

describe('specs.json, the drawing fixtures (§6.2, §6.10)', () => {
  it('holds 27 specs, one per shape and language, ids unique', () => {
    expect(FILE.specs).toHaveLength(27)
    expect(new Set(FILE.specs.map((e) => e.id)).size).toBe(27)
    for (const shape of SHAPES) {
      for (const language of LANGUAGES) {
        expect(
          FILE.specs.filter((e) => e.shape === shape && e.language === language),
          `${shape} ${language}`
        ).toHaveLength(1)
      }
    }
  })

  it('says in its note that the Hindi and Telugu strings await the user’s check', () => {
    expect(FILE.note).toMatch(/Hindi and Telugu strings AWAIT THE USER'S CHECK/)
  })

  it('gives each spec a template row, its seconds inside the row’s bounds, a seed and a version', () => {
    for (const { id, spec } of FILE.specs) {
      const def = GRAPHIC_TEMPLATES[spec.data.template]
      expect(def, id).toBeDefined()
      expect(spec.seconds, id).toBeGreaterThanOrEqual(def!.seconds.min)
      expect(spec.seconds, id).toBeLessThanOrEqual(def!.seconds.max)
      expect(Number.isInteger(spec.seed), id).toBe(true)
      expect(spec.version, id).toBe(1)
      if (spec.place.auto) expect(['top', 'middle', 'bottom'], id).toContain(spec.place.third)
      else for (const v of Object.values(spec.place.box)) expect(v >= 0 && v <= 1, id).toBe(true)
    }
  })

  it('has one beat per element as §6.2’s table counts them, rising, the first at the lead, the last inside the clip', () => {
    for (const { id, spec } of FILE.specs) {
      const d = spec.data
      const expected =
        d.template === 'bars' || d.template === 'steps'
          ? d.items.length
          : d.template === 'quote'
            ? words(d.text).length
            : 1
      expect(spec.beats, id).toHaveLength(expected)
      expect(spec.beats[0], id).toBeGreaterThanOrEqual(LEAD_S)
      for (let i = 1; i < spec.beats.length; i++) expect(spec.beats[i], id).toBeGreaterThan(spec.beats[i - 1])
      expect(spec.beats[spec.beats.length - 1], id).toBeLessThan(spec.seconds)
    }
  })

  it('keeps each template’s own limits: item counts, parents, words, lit, shape and subject', () => {
    for (const { id, shape, spec } of FILE.specs) {
      const d = spec.data
      if (d.template === 'bars' || d.template === 'steps') {
        const def = GRAPHIC_TEMPLATES[d.template]!
        expect(d.items.length, id).toBeGreaterThanOrEqual(def.minItems!)
        expect(d.items.length, id).toBeLessThanOrEqual(def.maxItems!)
      }
      if (d.template === 'bars') for (const item of d.items) expect(numberOf(item.value), id).not.toBeNull()
      if (d.template === 'steps') {
        expect(parentsValid(d.items.map((i) => i.parent ?? -1)), id).toBe(true)
        expect(d.connector === 'none', id).toBe(shape === 'steps')
      }
      if (d.template === 'quote') expect(words(d.text).length, id).toBeLessThanOrEqual(16)
      if (d.template === 'keyword') {
        const n = words(d.words).length
        expect(n >= 1 && n <= 4, id).toBe(true)
        expect(Number.isInteger(d.lit) && d.lit >= 0 && d.lit < n, id).toBe(true)
      }
      if (d.template === 'ring') {
        // §6.2's shapes table: the number carries % (or "percent") and is ≤ 100
        expect(d.value, id).toMatch(/(%|\bpercent)$/)
        expect(numberOf(d.value)!, id).toBeLessThanOrEqual(100)
      }
      if (d.template === 'counter' || d.template === 'ring') expect(numberOf(d.value), id).not.toBeNull()
      if (d.template === 'callout') expect(spec.subject, id).toBeDefined()
    }
  })

  it('has a ring written with "percent", so the painter’s add-% rule has a case that must not add one', () => {
    const rings = FILE.specs.filter((e) => e.spec.data.template === 'ring').map((e) => e.spec.data)
    expect(rings.some((d) => d.template === 'ring' && /\bpercent$/.test(d.value))).toBe(true)
    expect(rings.some((d) => d.template === 'ring' && d.value.endsWith('%'))).toBe(true)
  })

  it('covers the line and the tree, a nested tree among them', () => {
    const connected = FILE.specs.filter((e) => e.shape === 'steps-connected').map((e) => e.spec.data)
    const connectors = connected.map((d) => (d.template === 'steps' ? d.connector : null))
    expect(connectors).toContain('line')
    expect(connectors).toContain('tree')
    expect(connected.some((d) => d.template === 'steps' && d.items.some((i) => (i.parent ?? -1) >= 0))).toBe(true)
  })

  it('puts each template’s longest allowed label among its fixtures: bars 5 items, steps 6, quote 16 words, keyword 4', () => {
    const most = (shape: string, size: (s: GraphicSpec) => number): number =>
      Math.max(...FILE.specs.filter((e) => e.shape === shape).map((e) => size(e.spec)))
    expect(most('bars', (s) => (s.data.template === 'bars' ? s.data.items.length : 0))).toBe(5)
    expect(most('steps', (s) => (s.data.template === 'steps' ? s.data.items.length : 0))).toBe(6)
    expect(most('quote', (s) => (s.data.template === 'quote' ? words(s.data.text).length : 0))).toBe(16)
    expect(most('keyword', (s) => (s.data.template === 'keyword' ? words(s.data.words).length : 0))).toBe(4)
  })

  it('writes every Hindi string in Devanagari and every Telugu one in Telugu, numbers aside', () => {
    for (const { id, language, spec } of FILE.specs) {
      if (language === 'en') continue
      const script = language === 'hi' ? DEVANAGARI : TELUGU
      for (const s of drawn(spec)) {
        if (numberOf(s) !== null) continue
        expect(s, id).toMatch(script)
      }
    }
  })
})

describe('readingSeconds (§6.2)', () => {
  it('is the grapheme count over 20', () => {
    expect(readingSeconds('')).toBe(0)
    expect(readingSeconds('a'.repeat(20))).toBe(1)
    expect(readingSeconds('Before the ceremony')).toBe(19 / 20)
  })

  // Pinned on Node 24's ICU 78 (Unicode 17), which CI's setup-node 24 runs on
  // both runners; the Telugu conjunct "ళ్లి" is one cluster only from ICU 74
  // (Unicode 15.1's GB9c), so an older Node skips this case rather than fail it.
  const ICU_MAJOR = Number((process.versions.icu ?? '0').split('.')[0])
  it.skipIf(ICU_MAJOR < 74)('counts a Hindi and a Telugu label in graphemes, not UTF-16 units', () => {
    expect(readingSeconds('शादी से पहले')).toBe(8 / 20) // 12 UTF-16 units
    expect(readingSeconds('పెళ్లికి ముందు')).toBe(6 / 20) // 14 UTF-16 units
  })
})
