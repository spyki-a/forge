import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { graphemesOf, type DrawItem, type TextItem, type TextMeasure } from '@shared/graphics/items'
import { drawListAt } from '@shared/graphics/drawList'
import { resolveGraphicStyle } from '@shared/graphics/style'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type Project } from '@shared/timeline'
import type { GraphicSpec } from '@shared/graphics/template'
import {
  DRAWN_TEMPLATES,
  GRAPHIC_CHECK_OPTIONS,
  INDIC_CLUSTERS,
  TEMPLATE_FIXTURES,
  curveStyle,
  indicItemsOf,
  lookStyle,
  startReadings,
  templateFrames,
  textItemsOf,
  type CurvesResult,
  type LookResult
} from '../../src/renderer/src/harness/graphicCheck'
import {
  BLIND_KEY_FIELD,
  BLIND_LETTERS,
  INDIC_LANGUAGES,
  LOOK_QUESTIONS,
  LOOK_VARIANTS,
  M14_CURVES,
  TEMPLATES_BAR,
  blindLines,
  blindPage,
  curvesError,
  fixtureTargets,
  framesAt,
  graphicClipOf,
  indicItemPass,
  indicTemplateCases,
  keyPath,
  letterBlind,
  lookError,
  noClipLine,
  notGraphicLine,
  parseTemplateFixtures,
  saveKeyLine,
  tallyBy,
  templateCasesFor,
  templateVerdict,
  type PixelDiff,
  type TemplateFixture,
  type TemplateReading
} from '../../src/renderer/src/harness/graphicMeasure'

/*
 * The pure half of the graphics check's phase-2 options (docs/CLIPS.md §6.11's
 * `templates`, `curves`, `look` rows and the phase-2 sentence of "The Indic
 * render check"; §6.10's two blind ratings; §6.12's phase 2 exit). What they
 * draw and bake is read in a browser (the harness page, and the development
 * app, which is the user's); a wrong verdict, a key on the page or a shuffle
 * that does not shuffle would be certified in a console where no test runs.
 * Every expectation here is written by hand.
 */

const CLEAN = resolveGraphicStyle('clean')
const SPECS_FILE = join(__dirname, '..', 'fixtures', 'graphics', 'specs.json')
const specsText = readFileSync(SPECS_FILE, 'utf8')

/** 0.55 em a grapheme, as tests/renderer/graphicCanvas.test.ts's fake measures. */
const measure: TextMeasure = (text, look) => {
  const count = graphemesOf(text)?.length ?? Array.from(text).length
  return { width: count * look.px * 0.55, ascent: look.px * 0.8, descent: look.px * 0.2 }
}

const fixture = (id: string): TemplateFixture => {
  const f = TEMPLATE_FIXTURES.find((x) => x.id === id)
  if (!f) throw new Error(`no fixture ${id}`)
  return f
}

/* ------------------------------------------------------------- the options */

describe('the phase-2 options', () => {
  it('are named in GRAPHIC_CHECK_OPTIONS, the Indic sites still before anything that loads the faces', () => {
    for (const name of ['templates', 'curves', 'look']) expect(GRAPHIC_CHECK_OPTIONS as readonly string[], name).toContain(name)
    expect(GRAPHIC_CHECK_OPTIONS.indexOf('indic')).toBeLessThan(GRAPHIC_CHECK_OPTIONS.indexOf('templates'))
  })

  /*
   * Read as source, as graphicCheckPrimitives reads runGraphicCheck: phase 2's
   * Indic half sits inside indic's guard, after phase 1's sites, and only when
   * templates are named; the blind panel is shown after the sheet.
   */
  it('runs the Indic templates half inside indic, after phase 1, only with templates named', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'src', 'harness', 'graphicCheck.ts'), 'utf8')
    const start = source.indexOf('export async function runGraphicCheck(')
    const body = source.slice(start, source.indexOf('\n}\n', start))
    const indicGuard = [...body.matchAll(/if \(options\.indic\) \{/g)]
    const phase1 = [...body.matchAll(/checkIndicPhase1\(/g)]
    const templatesHalf = [...body.matchAll(/if \(options\.templates !== undefined\) result\.indic\.templates = await checkIndicTemplates\(/g)]
    expect(indicGuard).toHaveLength(1)
    expect(phase1).toHaveLength(1)
    expect(templatesHalf).toHaveLength(1)
    const close = body.indexOf('\n  }\n', indicGuard[0].index!)
    expect(phase1[0].index!).toBeLessThan(templatesHalf[0].index!)
    expect(templatesHalf[0].index!).toBeLessThan(close)
    const sheet = [...body.matchAll(/showSheet\(result\)/g)]
    const blind = [...body.matchAll(/showBlind\(blind\)/g)]
    expect(sheet).toHaveLength(1)
    expect(blind).toHaveLength(1)
    expect(sheet[0].index!).toBeLessThan(blind[0].index!)
  })
})

/* ------------------------------------------------------------ the fixtures */

describe('TEMPLATE_FIXTURES, specs.json as the page reads it', () => {
  it('is the file the node tests read: its 27 entries, in its order, each spec the file\'s', () => {
    const file = JSON.parse(specsText) as { specs: { id: string; spec: GraphicSpec }[] }
    expect(TEMPLATE_FIXTURES).toHaveLength(27)
    expect(TEMPLATE_FIXTURES.map((f) => f.id)).toEqual(file.specs.map((e) => e.id))
    for (const e of file.specs) expect(fixture(e.id).spec, e.id).toEqual(e.spec)
  })

  it('throws on an entry that is not an id, a shape, a language and a spec', () => {
    expect(() => parseTemplateFixtures('{"specs": [{"id": "x", "shape": "counter", "language": "en"}]}')).toThrow(/entry 0/)
    expect(() => parseTemplateFixtures('{"note": "no list"}')).toThrow(/no specs list/)
  })

  it('DRAWN_TEMPLATES holds the eight drawn templates and no screen card', () => {
    for (const id of ['counter', 'bars', 'steps', 'quote', 'callout', 'ring', 'keyword', 'lower-third']) expect(DRAWN_TEMPLATES, id).toContain(id)
    expect(DRAWN_TEMPLATES).not.toContain('screen-card')
  })
})

describe('templateCasesFor', () => {
  const f = (id: string, template: string): TemplateFixture => ({ id, shape: template, language: id.slice(-2), spec: { data: { template } } as unknown as GraphicSpec })
  const fixtures = [f('a-en', 'counter'), f('b-en', 'bars'), f('a-hi', 'counter')]

  it('takes every fixture of each template asked for, once, in the order asked', () => {
    const got = templateCasesFor(['bars', 'counter', 'bars'], fixtures, ['counter', 'bars', 'ring'])
    expect(got.cases.map((c) => c.id)).toEqual(['b-en', 'a-en', 'a-hi'])
    expect(got.unknown).toEqual([])
    expect(got.noSpec).toEqual([])
  })

  it('names an id no drawer draws, and a drawn template with no fixture: never skipped silently', () => {
    const got = templateCasesFor(['counter', 'ring', 'bogus', 'screen-card'], fixtures, ['counter', 'bars', 'ring'])
    expect(got.cases.map((c) => c.id)).toEqual(['a-en', 'a-hi'])
    expect(got.unknown).toEqual(['bogus', 'screen-card'])
    expect(got.noSpec).toEqual(['ring'])
  })

  it('over the real fixtures: steps takes both the plain and the connected shapes, three languages each', () => {
    const got = templateCasesFor(['steps'], TEMPLATE_FIXTURES, DRAWN_TEMPLATES)
    expect(got.cases.map((c) => c.id)).toEqual(['steps-en', 'steps-hi', 'steps-te', 'steps-connected-en', 'steps-connected-hi', 'steps-connected-te'])
  })
})

describe('indicTemplateCases (the Indic render check\'s phase 2 sentence: every Hindi and Telugu fixture)', () => {
  it('takes Hindi and Telugu, both', () => {
    expect(INDIC_LANGUAGES).toContain('hi')
    expect(INDIC_LANGUAGES).toContain('te')
    expect(INDIC_LANGUAGES).not.toContain('en')
  })

  it('over the real 27 fixtures and every drawn template: the eighteen Hindi and Telugu ones, no English, nothing unnamed', () => {
    const got = indicTemplateCases(['counter', 'bars', 'steps', 'quote', 'callout', 'ring', 'keyword', 'lower-third'], TEMPLATE_FIXTURES, DRAWN_TEMPLATES)
    // specs.json's ids, read by hand: each of the eight templates in hi and te, and steps' connected shape in both.
    const want = [
      'counter-hi', 'counter-te', 'bars-hi', 'bars-te', 'steps-hi', 'steps-te', 'steps-connected-hi', 'steps-connected-te', 'quote-hi', 'quote-te',
      'callout-hi', 'callout-te', 'ring-hi', 'ring-te', 'keyword-hi', 'keyword-te', 'lower-third-hi', 'lower-third-te'
    ]
    const ids = got.cases.map((c) => c.id)
    for (const id of want) expect(ids, id).toContain(id)
    expect(ids).toHaveLength(18)
    for (const id of ids) expect(id, id).not.toMatch(/-en$/)
    expect(got.noIndic).toEqual([])
    expect(got.unknown).toEqual([])
    expect(got.noSpec).toEqual([])
  })

  it('steps gives its four: plain and connected, Hindi and Telugu', () => {
    expect(indicTemplateCases(['steps'], TEMPLATE_FIXTURES, DRAWN_TEMPLATES).cases.map((c) => c.id)).toEqual(['steps-hi', 'steps-te', 'steps-connected-hi', 'steps-connected-te'])
  })

  it('names a template whose fixtures are English only, an unknown id and a template with no fixture: none dropped silently', () => {
    const f = (id: string, template: string, language: string): TemplateFixture => ({ id, shape: template, language, spec: { data: { template } } as unknown as GraphicSpec })
    const fixtures = [f('a-en', 'counter', 'en'), f('b-en', 'bars', 'en'), f('b-te', 'bars', 'te')]
    const got = indicTemplateCases(['counter', 'bars', 'ring', 'bogus'], fixtures, ['counter', 'bars', 'ring'])
    expect(got.cases.map((c) => c.id)).toEqual(['b-te'])
    expect(got.noIndic).toEqual(['counter'])
    expect(got.noSpec).toEqual(['ring'])
    expect(got.unknown).toEqual(['bogus'])
  })
})

describe('templateFrames', () => {
  it('reads counter-en (2.5 s, a beat at 0.5 s) at frames 0, 15, 30 and 74: 75 frames, 31 moving', () => {
    // 2.5 s × 30 = 75; the beat at 0.5 s is frame 15; the last frame baked is beatFrame(0.5 + 0.5) = 30, so 31 moving.
    expect(templateFrames(fixture('counter-en').spec, CLEAN, 30)).toEqual({ total: 75, moving: 31, beat: 15, lastMoving: 30, heldEnd: 74, read: [0, 15, 30, 74] })
  })

  it('takes the earliest beat, however the beats are ordered', () => {
    const spec = { ...fixture('counter-en').spec, beats: [1.0, 0.5] }
    // Moving to beatFrame(1.0 + 0.5) = 45, so 46 moving; the beat read is the first, 0.5 s.
    expect(templateFrames(spec, CLEAN, 30)).toEqual({ total: 75, moving: 46, beat: 15, lastMoving: 45, heldEnd: 74, read: [0, 15, 45, 74] })
  })
})

describe('fixtureTargets', () => {
  it('reads a callout fixture\'s subject box as if the footage filled the frame', () => {
    // callout-en: { x: 0.35, y: 0.2, width: 0.3, height: 0.35 } at 1080×1920.
    expect(fixtureTargets(fixture('callout-en').spec, { width: 1080, height: 1920 })).toEqual({ subject: { x: 378, y: 384, width: 324, height: 672 } })
  })
  it('has no target for a fixture without a subject', () => {
    expect(fixtureTargets(fixture('counter-en').spec, { width: 1080, height: 1920 })).toEqual({})
  })
})

/* --------------------------------------------------------- the readings */

/** A 2×1 RGBA picture: its two pixels' alphas, white. */
const pic = (a0: number, a1: number): Uint8ClampedArray => new Uint8ClampedArray([255, 255, 255, a0, 255, 255, 255, a1])

describe('startReadings', () => {
  it('reads frame 0 against the beat and against the last moving frame', () => {
    const frames: Record<number, Uint8ClampedArray> = { 0: pic(0, 0), 15: pic(255, 0), 30: pic(255, 255) }
    const r = startReadings({ beat: 15, moving: 31, lastMoving: 30 }, (f) => frames[f], 2)
    expect(r.startAgainstBeat).toMatchObject({ differing: 1, max: 255, pixels: 2 })
    expect(r.startAgainstEnd).toMatchObject({ differing: 2, max: 255, pixels: 2 })
  })
  it('reads nothing where the beat is frame 0 or past the moving frames, or nothing moves', () => {
    const at = (): Uint8ClampedArray => pic(0, 0)
    expect(startReadings({ beat: 0, moving: 31, lastMoving: 30 }, at, 2).startAgainstBeat).toBeNull()
    expect(startReadings({ beat: 40, moving: 31, lastMoving: 30 }, at, 2).startAgainstBeat).toBeNull()
    expect(startReadings({ beat: 0, moving: 1, lastMoving: 0 }, at, 2).startAgainstEnd).toBeNull()
  })
})

const d = (o: Partial<PixelDiff> = {}): PixelDiff => ({ mean: 0, max: 0, differing: 0, pixels: 100, ...o })

/** A reading every part of which passes, built by hand. */
function passing(): TemplateReading {
  return {
    bakeAgainstPreview: [d(), d({ mean: 0.4, max: 9, differing: 3 })],
    canvasAgainstPreview: [d(), d()],
    heldAgainstLast: d(),
    outside: [{ max: 0, pixels: 0 }, { max: 0, pixels: 0 }],
    drawnTwice: [d(), d()],
    bakedTwice: { equal: 31, of: 31 },
    live: [d(), d()],
    boxes: { check: { x: 130, y: 1130, width: 820, height: 420 }, bake: { x: 130, y: 1130, width: 820, height: 420 } },
    frames: { baked: 31, canvas: 31, moving: 31 },
    startAgainstBeat: d({ mean: 3, max: 255, differing: 40 }),
    startAgainstEnd: d({ mean: 5, max: 255, differing: 80 }),
    total: 75
  }
}

describe('templateVerdict (§6.12\'s phase 2 exit, TEMPLATES_BAR)', () => {
  it('passes a reading that meets every part, the bake at exactly 1 level included', () => {
    expect(TEMPLATES_BAR).toEqual({ bakeMeanLevels: 1, heldMean: 0, outsideAlpha: 0 })
    expect(templateVerdict(passing()).pass).toBe(true)
    const r = passing()
    r.bakeAgainstPreview = [d({ mean: 1, max: 40, differing: 9 })]
    expect(templateVerdict(r).pass).toBe(true)
    r.canvasAgainstPreview = [d({ mean: 1.01, max: 40, differing: 9 })]
    expect(templateVerdict(r).bake).toBe(false)
  })

  it('wants frame 0 to differ from the beat\'s frame and from the last moving frame', () => {
    const atBeat = passing()
    atBeat.startAgainstBeat = d()
    expect(templateVerdict(atBeat).moves).toBe(false)
    expect(templateVerdict(atBeat).pass).toBe(false)
    const atEnd = passing()
    atEnd.startAgainstEnd = d()
    expect(templateVerdict(atEnd).moves).toBe(false)
  })

  it('wants the held end exactly the last moving frame: one level on one pixel fails it', () => {
    const r = passing()
    // One channel of one of 100 pixels a level apart: mean 1 / 400 = 0.0025.
    r.heldAgainstLast = d({ mean: 0.0025, max: 1, differing: 1 })
    expect(templateVerdict(r).held).toBe(false)
    expect(templateVerdict(r).pass).toBe(false)
  })

  it('wants no alpha at all outside the box, on any frame read', () => {
    const r = passing()
    r.outside = [{ max: 0, pixels: 0 }, { max: 1, pixels: 1 }]
    expect(templateVerdict(r).outside).toBe(false)
    expect(templateVerdict(r).pass).toBe(false)
  })

  it('passes nothing it did not read, part by part', () => {
    const cases: [string, (r: TemplateReading) => void, keyof ReturnType<typeof templateVerdict>][] = [
      ['no box-route PNG read', (r) => (r.bakeAgainstPreview = []), 'bake'],
      ['no canvas-route PNG read', (r) => (r.canvasAgainstPreview = []), 'bake'],
      ['no held end to read: every frame moves', (r) => (r.total = r.frames.moving), 'held'],
      ['an empty held reading', (r) => (r.heldAgainstLast = d({ pixels: 0 })), 'held'],
      ['no frame read for the alpha outside', (r) => (r.outside = []), 'outside'],
      ['not drawn twice', (r) => (r.drawnTwice = []), 'twice'],
      ['no PNG of the second bake', (r) => (r.bakedTwice = { equal: 0, of: 0 }), 'twice'],
      ['no live Preview read', (r) => (r.live = []), 'live'],
      ['no box: nothing drawn', (r) => (r.boxes = { check: null, bake: null }), 'box'],
      ['no moving frame', (r) => (r.frames = { baked: 0, canvas: 0, moving: 0 }), 'count'],
      ['no beat frame read', (r) => (r.startAgainstBeat = null), 'moves'],
      ['no last moving frame read', (r) => (r.startAgainstEnd = null), 'moves']
    ]
    for (const [why, cut, part] of cases) {
      const r = passing()
      cut(r)
      const v = templateVerdict(r)
      expect(v[part], why).toBe(false)
      expect(v.pass, why).toBe(false)
    }
  })

  it('wants the spec drawn twice equal and the bake writing the moving frames, no more', () => {
    const twice = passing()
    twice.bakedTwice = { equal: 30, of: 31 }
    expect(templateVerdict(twice).twice).toBe(false)
    const count = passing()
    count.frames = { baked: 75, canvas: 31, moving: 31 }
    expect(templateVerdict(count).count).toBe(false)
  })
})

describe('tallyBy', () => {
  it('passes a key only when every case of it passed', () => {
    const cases = [
      { shape: 'counter', pass: true },
      { shape: 'counter', pass: false },
      { shape: 'bars', pass: true }
    ]
    expect(tallyBy(cases, (c) => c.shape, (c) => c.pass)).toEqual({ counter: false, bars: true })
    expect(tallyBy([], () => 'x', () => true)).toEqual({})
  })

  it('a failing case before a passing one still fails its key: the tally is every case, not the last', () => {
    const cases = [
      { shape: 'ring', pass: false },
      { shape: 'ring', pass: true },
      { shape: 'quote', pass: true },
      { shape: 'quote', pass: false },
      { shape: 'quote', pass: true }
    ]
    expect(tallyBy(cases, (c) => c.shape, (c) => c.pass)).toEqual({ ring: false, quote: false })
  })
})

/* ------------------------------------------- the Indic reading over the templates */

describe('the Indic items of a template', () => {
  const look = { textStyleId: 'clean', font: 'Montserrat', px: 60, align: 'left' as const }
  const text = (id: string, t: string): TextItem => ({ kind: 'text', id, opacity: 1, text: t, look, box: { x: 0, y: 0, width: 100, height: 72 } })

  it('textItemsOf reads text inside groups too, in paint order', () => {
    const items: DrawItem[] = [
      text('title', 'हर'),
      { kind: 'group', id: 'g', opacity: 1, children: [text('n', '1'), text('label', 'మేకప్')] },
      { kind: 'shape', id: 'panel', opacity: 1, shape: 'rounded', box: { x: 0, y: 0, width: 10, height: 10 }, radius: 2, fill: '#000000' }
    ]
    expect(textItemsOf(items).map((i) => i.id)).toEqual(['title', 'n', 'label'])
    expect(indicItemsOf({ items }).map((i) => i.id)).toEqual(['title', 'label'])
  })

  it('reads steps-hi\'s title and its three labels, inside their groups, and not their digits', () => {
    const f = fixture('steps-hi')
    const layout = templateFrames(f.spec, CLEAN, 30)
    const list = drawListAt(f.spec, CLEAN, layout.lastMoving, 30, { width: 1080, height: 1920 }, measure, {})
    // specs.json's steps-hi: its title and its three items' labels.
    expect(indicItemsOf(list).map((i) => i.text)).toEqual(['शादी से पहले', 'बैटरी चार्ज करें', 'कार्ड खाली करें', 'जगह देख लें'])
  })

  it('indicItemPass: equal to drawTextOnto, a shaped item apart per code point, a conjunct narrower, an i-matra first', () => {
    const conjunct = INDIC_CLUSTERS[0]
    expect(conjunct).toBe('क्ष')
    const ok = { text: conjunct, equal: true, differs: true, narrower: true, matraFirst: null }
    expect(indicItemPass(ok)).toBe(true)
    expect(indicItemPass({ ...ok, equal: false })).toBe(false)
    expect(indicItemPass({ ...ok, differs: false })).toBe(false)
    expect(indicItemPass({ ...ok, narrower: false })).toBe(false)
    expect(indicItemPass({ ...ok, matraFirst: false })).toBe(false)
    expect(indicItemPass({ ...ok, matraFirst: true })).toBe(true)
    // 'हर' carries no mark: whole and per code point may rightly be equal.
    expect(indicItemPass({ text: 'हर', equal: true, differs: false, narrower: null, matraFirst: null })).toBe(true)
  })
})

/* ------------------------------------------------------- the blind ratings */

describe('letterBlind', () => {
  const names = ['a', 'b', 'c', 'd']
  /** A source that answers `values` in turn. */
  const source = (...values: number[]): (() => number) => {
    let i = 0
    return () => values[i++ % values.length]
  }

  it('gives every name exactly one letter, A first, and the key maps each letter back to its name', () => {
    const { order, key } = letterBlind(M14_CURVES, Math.random)
    expect(Object.keys(key)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
    expect([...Object.values(key)].sort()).toEqual([...M14_CURVES].sort())
    order.forEach((name, i) => expect(key[BLIND_LETTERS[i]]).toBe(name))
  })

  it('a pinned source gives a pinned order: all zeros swap each place with the first', () => {
    // i = 3: j = 0, [d, b, c, a]; i = 2: j = 0, [c, b, d, a]; i = 1: j = 0, [b, c, d, a].
    const { order, key } = letterBlind(names, source(0))
    expect(order).toEqual(['b', 'c', 'd', 'a'])
    expect(key).toEqual({ A: 'b', B: 'c', C: 'd', D: 'a' })
  })

  it('a source near 1 swaps each place with itself, so two sources give two orders', () => {
    expect(letterBlind(names, source(0.999)).order).toEqual(['a', 'b', 'c', 'd'])
    // i = 3: floor(0.5 × 4) = 2, [a, b, d, c]; i = 2: floor(0.5 × 3) = 1, [a, d, b, c]; i = 1: floor(0.5 × 2) = 1, unchanged.
    expect(letterBlind(names, source(0.5)).order).toEqual(['a', 'd', 'b', 'c'])
  })

  it('two default runs can differ: Math.random over forty runs gives more than one order', () => {
    const orders = new Set(Array.from({ length: 40 }, () => letterBlind(M14_CURVES, Math.random).order.join(',')))
    expect(orders.size).toBeGreaterThan(1)
  })

  it('a source answering NaN or an infinity loses no name: such a draw counts as 0', () => {
    // As all zeros: [b, c, d, a].
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const { order, key } = letterBlind(names, source(bad))
      expect(order, String(bad)).toEqual(['b', 'c', 'd', 'a'])
      expect(key, String(bad)).toEqual({ A: 'b', B: 'c', C: 'd', D: 'a' })
    }
  })

  it('refuses no name, a name twice, and more names than letters', () => {
    expect(() => letterBlind([], Math.random)).toThrow(/1 to 26/)
    expect(() => letterBlind(['a', 'a'], Math.random)).toThrow(/once/)
    expect(() => letterBlind(Array.from({ length: 27 }, (_, i) => `n${i}`), Math.random)).toThrow(/1 to 26/)
  })
})

describe('the blind page holds no key', () => {
  const lettered = letterBlind(M14_CURVES, Math.random)
  const page = blindPage('M14, curves blind: clip g1 (counter)', [{ label: 'clip g1 (counter)', lettered }], ['Which is best?'], saveKeyLine('curves', '2026-11-14T01:00:00.000Z'))

  it('shows the letters, the questions and how to save, and not one curve name', () => {
    expect(page.rows).toEqual([{ label: 'clip g1 (counter)', letters: ['A', 'B', 'C', 'D', 'E', 'F'] }])
    const shown = JSON.stringify(page)
    for (const name of M14_CURVES) expect(shown, name).not.toContain(`"${name}"`)
    expect(Object.keys(page).sort()).toEqual(['heading', 'howToSave', 'questions', 'rows'])
    for (const row of page.rows) expect(Object.keys(row).sort()).toEqual(['label', 'letters'])
  })

  it('the summary lines, read from the page, name no curve beside a letter', () => {
    const lines = blindLines(page)
    expect(lines).toContain('clip g1 (counter): renders A, B, C, D, E, F')
    for (const line of lines) for (const name of M14_CURVES) expect(line, name).not.toMatch(new RegExp(`\\b${name}\\b`))
  })

  it('the look rating\'s page names no preset beside a letter', () => {
    const look = letterBlind(LOOK_VARIANTS.map((v) => v.name), Math.random)
    const p = blindPage('look', [{ label: 'clip g1 (counter)', lettered: look }], LOOK_QUESTIONS, saveKeyLine('look', '2026-11-14'))
    expect(p.rows[0].letters).toEqual(['A', 'B', 'C', 'D', 'E'])
    for (const v of LOOK_VARIANTS) expect(JSON.stringify(p.rows), v.name).not.toContain(v.name)
  })
})

describe('saveKeyLine and keyPath', () => {
  it('names §6.10\'s file by the run\'s date, and a route that echoes nothing', () => {
    expect(keyPath('curves', '2026-11-14T01:02:03.000Z')).toBe('tests/output/graphic/curves/key-2026-11-14.json')
    const line = saveKeyLine('look', '2026-11-14T01:02:03.000Z')
    expect(line).toContain('tests/output/graphic/look/key-2026-11-14.json')
    expect(line).toContain('const r = await window.__forgeGraphicCheck(')
    expect(line).toContain("DevTools' copy(r.look.keys)")
    expect(saveKeyLine('curves', '2026-11-14')).toContain("DevTools' copy(r.curves.key)")
  })

  it('the path it names holds the key on a result of each rating: curves.key, look.keys', () => {
    const blind = { option: 'look' as const, date: '2026-11-14', clipId: 'g1', template: 'counter', letters: { A: 'clean' } }
    // Hand-built as the two result types hold their keys (graphicCheck.ts: CurvesResult.key, LookResult.keys).
    const r: { curves: Pick<CurvesResult, 'key'>; look: Pick<LookResult, 'keys'> } = { curves: { key: { ...blind, option: 'curves' } }, look: { keys: [blind] } }
    for (const option of ['curves', 'look'] as const) {
      const named = saveKeyLine(option, '2026-11-14').match(/copy\(r\.([a-z]+)\.([a-z]+)\)/)
      expect(named, option).not.toBeNull()
      expect(named![1]).toBe(option)
      const at = (r[option] as Record<string, unknown>)[named![2]]
      expect(at, `r.${option}.${named![2]}`).toBeDefined()
    }
    expect(BLIND_KEY_FIELD).toEqual({ curves: 'key', look: 'keys' })
  })

  it('states no route nobody measured: copy() is the route, as §6.10 says', () => {
    for (const option of ['curves', 'look'] as const) {
      const line = saveKeyLine(option, '2026-11-14')
      expect(line).not.toMatch(/has no copy\(\)|setTimeout|writeText/)
    }
  })
})

/*
 * Read as source: the glue that puts a rating on the page. The pure page is
 * guarded above; this is the half that writes the summary and the notes, and
 * letters the renders it also keys.
 */
describe('the phase-2 glue, read as source: the key off the page and the console, the cases from their pure readers', () => {
  const source = readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'src', 'harness', 'graphicCheck.ts'), 'utf8')
  const bodyOf = (name: string): string => {
    const heads = [...source.matchAll(new RegExp(`async function ${name}\\(`, 'g'))]
    expect(heads, name).toHaveLength(1)
    const start = heads[0].index!
    return source.slice(start, source.indexOf('\n}\n', start))
  }

  for (const name of ['checkCurves', 'checkLook']) {
    it(`${name}: the key is read only into the returned key, and no summary or note line names it`, () => {
      const body = bodyOf(name)
      const reads = [...body.matchAll(/lettered\.key\b/g)]
      expect(reads.length, name).toBeGreaterThan(0)
      for (const m of reads) expect(body.slice(m.index! - 'letters: { ...'.length, m.index!), name).toBe('letters: { ...')
      const logged = body.split('\n').filter((l) => /summary\.push\(|notes\.push\(|console\./.test(l))
      expect(logged.length, name).toBeGreaterThan(0)
      for (const line of logged) expect(line, name).not.toMatch(/\bkeys?\b|lettered|JSON\.stringify/)
    })

    it(`${name}: letters its renders once, so the key it returns is the lettering the players drew`, () => {
      expect([...bodyOf(name).matchAll(/letterBlind\(/g)], name).toHaveLength(1)
    })
  }
  it('checkIndicTemplates takes its cases from indicTemplateCases alone, with no language filter of its own', () => {
    const body = bodyOf('checkIndicTemplates')
    expect([...body.matchAll(/indicTemplateCases\(/g)]).toHaveLength(1)
    expect([...body.matchAll(/templateCasesFor\(/g)]).toHaveLength(0)
    expect(body).not.toMatch(/\.language\)/)
  })

  it('checkTemplates puts an id no drawer draws on the by-template line as FAIL, beside a template with no fixture', () => {
    const body = bodyOf('checkTemplates')
    expect([...body.matchAll(/for \(const id of unknown\) byTemplate\[id\] = false/g)]).toHaveLength(1)
    expect([...body.matchAll(/for \(const id of noSpec\) byTemplate\[id\] = false/g)]).toHaveLength(1)
    const tally = body.indexOf('const byTemplate = tallyBy(')
    const line = body.indexOf('summary.push(`templates by template:')
    expect(tally).toBeGreaterThan(-1)
    expect(body.indexOf('for (const id of unknown) byTemplate[id] = false')).toBeGreaterThan(tally)
    expect(body.indexOf('for (const id of unknown) byTemplate[id] = false')).toBeLessThan(line)
  })
})

describe('curvesError and lookError', () => {
  it('takes M14\'s six (spring1 among them) and a clip id', () => {
    for (const name of ['expo-out', 'out-cubic', 'spring1', 'linear', 'decelerate', 'carbon-expressive']) expect(M14_CURVES, name).toContain(name)
    expect(curvesError({ names: [...M14_CURVES], clipId: 'g1' })).toBeNull()
  })
  it('refuses no names, an unknown curve, a curve twice and no clip id, each in words', () => {
    expect(curvesError(undefined)).toMatch(/takes \{ names, clipId \}/)
    expect(curvesError({ names: [], clipId: 'g1' })).toMatch(/takes \{ names, clipId \}/)
    expect(curvesError({ names: ['expo-out', 'wobble'], clipId: 'g1' })).toMatch(/not a curve: "wobble"/)
    expect(curvesError({ names: ['linear', 'linear'], clipId: 'g1' })).toMatch(/once/)
    expect(curvesError({ names: ['linear'] })).toMatch(/clipId/)
  })
  it('look takes clip ids, each once', () => {
    expect(lookError({ clipIds: ['g1', 'g2'] })).toBeNull()
    expect(lookError({ clipIds: [] })).toMatch(/takes \{ clipIds \}/)
    expect(lookError({ clipIds: ['g1', 'g1'] })).toMatch(/once/)
  })
})

describe('graphicClipOf', () => {
  const clip = (id: string, graphic?: GraphicSpec): Clip => ({
    id, assetId: `asset-${id}`, trackId: 'v1', start: 0, duration: 90, inPoint: 0, volume: 1,
    transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR }, ...(graphic ? { graphic } : {})
  })
  const project: Project = { ...emptyProject('blind'), clips: [clip('v1'), clip('g1', fixture('counter-en').spec)] }

  it('finds the graphic clip, and refuses an id it does not know and a clip that is not a graphic, with a plain line', () => {
    const got = graphicClipOf(project, 'g1')
    expect('clip' in got && got.clip.id).toBe('g1')
    expect(graphicClipOf(project, 'nope')).toEqual({ refused: 'No clip "nope" in the open project.' })
    expect(graphicClipOf(project, 'v1')).toEqual({ refused: 'Clip "v1" is not a graphic clip: name a clip a graphic was made into.' })
    expect(noClipLine('nope')).toBe('No clip "nope" in the open project.')
    expect(notGraphicLine('v1')).toBe('Clip "v1" is not a graphic clip: name a clip a graphic was made into.')
  })
})

describe('framesAt (the ratings at 30 fps)', () => {
  it('turns a clip\'s length at the project\'s rate into frames at 30', () => {
    expect(framesAt(90, 30)).toBe(90)
    expect(framesAt(60, 60)).toBe(30)
    expect(framesAt(48, 24)).toBe(60)
    expect(framesAt(0, 30)).toBe(1)
    expect(framesAt(90, 0)).toBe(1)
  })
})

describe('curveStyle: one variable at a time', () => {
  it('changes the ease and nothing else, and leaves its base alone', () => {
    const base = resolveGraphicStyle('clean')
    const linear = curveStyle(base, 'linear')
    expect(linear.motion.ease).toBe('linear')
    expect({ ...linear, motion: { ...linear.motion, ease: 'expo-out' } }).toEqual(resolveGraphicStyle('clean'))
    expect(base).toEqual(resolveGraphicStyle('clean'))
  })
})

describe('the look rating\'s renders', () => {
  it('are clean, bold, editorial, energetic and clean with the dim, each its preset as it stands', () => {
    expect(LOOK_VARIANTS.map((v) => v.name)).toEqual(['clean', 'bold', 'editorial', 'energetic', 'clean with dim'])
    // §6.5's table: the restrained presets dim nothing, energetic dims.
    expect(LOOK_VARIANTS.map((v) => [lookStyle(v).id, lookStyle(v).dim])).toEqual([
      ['clean', false],
      ['bold', false],
      ['editorial', false],
      ['energetic', true],
      ['clean', true]
    ])
    expect({ ...lookStyle(LOOK_VARIANTS[4]), dim: false }).toEqual(resolveGraphicStyle('clean'))
  })

  it('shows §6.10 step 2\'s questions beside them', () => {
    expect(LOOK_QUESTIONS).toHaveLength(7)
    const asks = ['pro reveal or tutorial', 'Restrained against energetic', 'dim wanted', 'motion blur', 'check tick', 'ripples, a burst', 'too quick or too slow']
    asks.forEach((phrase, i) => expect(LOOK_QUESTIONS[i], phrase).toContain(phrase))
  })
})
