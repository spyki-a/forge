import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { GRAPHIC_TEMPLATES, type GraphicData, type GraphicSpec, type TemplateDef } from '@shared/graphics/template'
import { LEAD_S, TAIL_S, graphicSeconds, readingSeconds } from '@shared/graphics/beats'
import { EXIT_S } from '@shared/graphics/frame'
import { graphemeCount } from '@shared/ingest/captions'
import { loadGraphicsFixtures } from './eval/graphicsFixtures'

/*
 * M16, the reading holds (docs/CLIPS.md §6.2, "Reading holds (M16)"; §6.15's
 * M16 row). Per template and language, the longest fixture label (the
 * strings the fixture draws, joined by spaces, as specs.json's note counts
 * them) must be readable inside the template's seconds: LEAD_S, its grapheme
 * count at 20 a second, and EXIT_S, held to `seconds.max` by
 * `graphicSeconds`. The stricter figure, twice at 200 words a minute (0.6 s a
 * word), is printed beside it and not enforced (§6.2: not until its result
 * is read into EFFECTS §61).
 */

interface Fixture {
  id: string
  shape: string
  language: 'en' | 'hi' | 'te'
  spec: GraphicSpec
}

const FIXTURES = (JSON.parse(readFileSync(new URL('./fixtures/graphics/specs.json', import.meta.url), 'utf8')) as { specs: Fixture[] }).specs
const LANGUAGES = ['en', 'hi', 'te'] as const
const TEMPLATES = ['counter', 'bars', 'steps', 'quote', 'callout', 'ring', 'keyword', 'lower-third'] as const

/** The 0.6 s a word of §6.2's stricter rule, twice at 200 words a minute (the research [34]). */
const WORD_S = 0.6

/** The strings a graphic draws, as its data holds them (the template's fixed glyphs are not read). */
function drawnStrings(d: GraphicData): string[] {
  switch (d.template) {
    case 'counter':
    case 'ring':
      return [d.value, d.label]
    case 'bars':
      return [d.title, ...d.items.flatMap((i) => [i.label, i.value])]
    case 'steps':
      return [d.title, ...d.items.map((i) => i.label)]
    case 'quote':
      return d.kind === 'social' ? [d.text, d.name, d.handle, d.date] : [d.text, d.speaker]
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
const drawnText = (d: GraphicData): string => drawnStrings(d).join(' ')

/** Words: whitespace-separated runs, never an empty piece (a leading, trailing or doubled space is not a word). */
const wordsOf = (text: string): string[] => text.split(/\s+/).filter((w) => w.length > 0)

/** The longest fixture label of a template in a language, by grapheme count. */
function longest(template: string, language: string): Fixture {
  const own = FIXTURES.filter((f) => f.spec.data.template === template && f.language === language)
  expect(own.length, `${template} ${language}: a fixture`).toBeGreaterThan(0)
  return own.reduce((a, b) => (graphemeCount(drawnText(b.spec.data)) > graphemeCount(drawnText(a.spec.data)) ? b : a))
}

/** The problem with a fixture's hold under `def`, naming its label; null when it holds. */
function holdProblem(f: Fixture, def: Pick<TemplateDef, 'seconds'>): string | null {
  const text = drawnText(f.spec.data)
  const seconds = graphicSeconds(def, f.spec.beats, text)
  if (seconds === null) {
    const needs = LEAD_S + readingSeconds(text) + EXIT_S
    return `${f.id}: "${text}" needs ${needs.toFixed(2)} s to read; the template holds ${def.seconds.max}`
  }
  return null
}

describe('graphicHolds (M16): every template’s longest fixture label is read inside its seconds', () => {
  it('per template and language: LEAD_S + graphemes ÷ 20 + EXIT_S, and the last beat + TAIL_S, fit seconds.max; the fixture holds exactly that, rounded up to 0.1 s', () => {
    const rows: string[] = []
    for (const template of TEMPLATES) {
      const def = GRAPHIC_TEMPLATES[template]!
      for (const language of LANGUAGES) {
        const f = longest(template, language)
        const text = drawnText(f.spec.data)
        const reading = LEAD_S + readingSeconds(text) + EXIT_S
        const last = Math.max(...f.spec.beats)
        expect(holdProblem(f, def), `${f.id}`).toBeNull()
        const seconds = graphicSeconds(def, f.spec.beats, text)!
        expect(seconds, `${f.id}: at least its reading time`).toBeGreaterThanOrEqual(reading - 1e-9)
        expect(seconds, `${f.id}: at least its last beat plus TAIL_S`).toBeGreaterThanOrEqual(last + TAIL_S - 1e-9)
        expect(seconds, `${f.id}: at least seconds.min`).toBeGreaterThanOrEqual(def.seconds.min)
        expect(seconds, `${f.id}: the largest of the three, no more`).toBeCloseTo(Math.max(def.seconds.min, last + TAIL_S, reading), 9)
        expect(seconds, `${f.id}: within seconds.max`).toBeLessThanOrEqual(def.seconds.max)
        // The fixture's own seconds are that figure rounded up to 0.1 s (specs.json's note).
        expect(f.spec.seconds, `${f.id}: its seconds`).toBeGreaterThanOrEqual(seconds - 1e-9)
        expect(f.spec.seconds, `${f.id}: its seconds`).toBeLessThan(seconds + 0.1 + 1e-9)
        const words = wordsOf(text).length
        const strict = LEAD_S + words * WORD_S + EXIT_S
        rows.push(
          `${f.id}: ${graphemeCount(text)} graphemes → ${reading.toFixed(2)} s; ${words} words at 0.6 s → ${strict.toFixed(2)} s (${strict <= def.seconds.max ? 'fits' : 'over'} ${def.seconds.max}); holds ${seconds.toFixed(2)} s`
        )
      }
    }
    process.stderr.write(`graphicHolds (M16): ${rows.join('; ')}\n`)
    expect(rows).toHaveLength(TEMPLATES.length * LANGUAGES.length)
  })

  it('every nested fixture (piece 2’s reader: the three English ones today, the owner’s Hindi and Telugu ones when added), drawn as the steps its title and items make, is read inside steps’ seconds', () => {
    const nested = loadGraphicsFixtures().nested
    expect(nested.length).toBeGreaterThanOrEqual(3)
    const def = GRAPHIC_TEMPLATES.steps!
    const rows: string[] = []
    for (const f of nested) {
      const data: GraphicData = { template: 'steps', title: f.title, items: f.items.map((label, i) => ({ label, parent: f.parents[i] })), connector: 'tree' }
      const fixture: Fixture = { id: f.id, shape: 'steps', language: f.language as Fixture['language'], spec: { data, seconds: def.seconds.default, beats: [LEAD_S], place: { auto: true, third: 'middle' }, seed: 1, version: 1 } }
      expect(holdProblem(fixture, def), f.file).toBeNull()
      const text = drawnText(data)
      rows.push(`${f.id}: ${graphemeCount(text)} graphemes → ${(LEAD_S + readingSeconds(text) + EXIT_S).toFixed(2)} s of ${def.seconds.max}`)
    }
    process.stderr.write(`graphicHolds (M16), the nested fixtures: ${rows.join('; ')}\n`)
  })

  it('a template whose maximum is short fails, naming the label', () => {
    const f = longest('quote', 'en')
    const def = GRAPHIC_TEMPLATES.quote!
    const short = { seconds: { ...def.seconds, max: def.seconds.min } }
    const problem = holdProblem(f, short)
    expect(problem).not.toBeNull()
    expect(problem).toContain((f.spec.data as { text: string }).text)
    expect(problem).toContain(f.id)
    expect(graphicSeconds(short, f.spec.beats, drawnText(f.spec.data))).toBeNull()
    // And the bound is the maximum itself: a label needing exactly the maximum holds.
    const exact = { seconds: { min: 1, default: 2, max: LEAD_S + readingSeconds('a'.repeat(40)) + EXIT_S } }
    expect(graphicSeconds(exact, [0.5], 'a'.repeat(40))).toBeCloseTo(exact.seconds.max, 9)
    expect(graphicSeconds(exact, [0.5], 'a'.repeat(41))).toBeNull()
  })

  it('pins the grapheme count of a Hindi and a Telugu label: a vowel sign is not a character of its own', () => {
    // Neither label has a conjunct, so the count does not depend on the ICU version (GB9c, Unicode 15.1).
    const hindi = FIXTURES.find((f) => f.id === 'steps-hi')!.spec.data as Extract<GraphicData, { template: 'steps' }>
    const telugu = FIXTURES.find((f) => f.id === 'steps-connected-te')!.spec.data as Extract<GraphicData, { template: 'steps' }>
    expect(hindi.items[2].label).toBe('जगह देख लें')
    expect(telugu.items[0].label).toBe('మేకప్')
    expect(readingSeconds(hindi.items[2].label) * 20).toBe(8) // 11 UTF-16 units
    expect(readingSeconds(telugu.items[0].label) * 20).toBe(3) // 5 UTF-16 units
  })

  it('counts words without empty pieces: the 0.6 s figure of a label is its said words, whatever its spacing', () => {
    expect(wordsOf(' Priya  Raman ')).toEqual(['Priya', 'Raman'])
    expect(wordsOf('')).toEqual([])
    // A lower third with no role draws its name alone: joined, the empty role leaves a trailing space that is not a word.
    const lt = FIXTURES.find((f) => f.id === 'lower-third-en')!.spec.data as Extract<GraphicData, { template: 'lower-third' }>
    expect(wordsOf(drawnText({ ...lt, role: '' }))).toEqual(lt.name.split(' '))
  })
})
