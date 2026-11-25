import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { drawListAt } from '@shared/graphics/drawList'
import { beatFrame, graphicMovingFrames } from '@shared/graphics/frame'
import { graphemesOf, itemBounds, type DrawItem, type DrawList, type ShapeItem, type StrokeItem, type TextItem, type TextMeasure } from '@shared/graphics/items'
import { DURATIONS } from '@shared/graphics/motion'
import { resolveGraphicStyle, type GraphicStyle } from '@shared/graphics/style'
import { GRAPHIC_TEMPLATES, type GraphicData, type GraphicSpec } from '@shared/graphics/template'
import { DRAWERS } from '@shared/graphics/templates/index'
import { LAYOUT_SIZES, contentRect } from '@shared/graphics/templates/layout'
import { REVEAL_OPACITY } from '@shared/graphics/templates/beforeAfter'
import { checkGraphicData } from '@shared/director/validateGraphics'
import { drawnStrings, drawnText } from '@shared/graphics/apply'
import { graphicSeconds } from '@shared/graphics/beats'
import { seeded } from '@shared/render/moment'
import { ASCENT, LINE_HEIGHT } from '@shared/render/textLayout'
import type { Segment, Transcript, Word } from '@shared/transcript'

/*
 * Step 6's three templates drawn flat (docs/CLIPS.md §9, "The 3D templates";
 * piece 1): `timeline`, `before-after` and `versus`, each through its own
 * DRAWERS row, over their English fixtures in specs.json and over seeded
 * made-up specs.
 *
 * - the draw list at chosen frames: which items are there and how far on,
 *   before, on and after each beat, at 24, 25, 30 and 60 fps; the settled
 *   frame (the last the bake draws) is the clip's last frame's list and
 *   nothing moves after it;
 * - the property over the text items (§6.12's phase-2 bar, as the draw list
 *   has it): at both shapes, for short, long and non-Latin strings, every text
 *   item inside the frame and inside the content rect on every frame read, and
 *   at the settled frame the text items are every data string verbatim and
 *   nothing else (the painter pinned to them);
 * - each template's own geometry (the rail, the reveal, the divider);
 * - the validator's shape half (`checkGraphicData`): a side missing, the
 *   item counts, an empty row, and a side's fields read where the data holds
 *   them.
 *
 * Non-Latin strings are made-up words in Greek, Georgian and Armenian script,
 * and the owner's Hindi and Telugu fixture strings by reference (read from
 * specs.json, never written here).
 */

const FPS = 30
const RATES = [24, 25, 30, 60]
const PORTRAIT = { width: 1080, height: 1920 }
const LANDSCAPE = { width: 1920, height: 1080 }
const SHAPES = [PORTRAIT, LANDSCAPE]
const THREE = ['timeline', 'before-after', 'versus'] as const

const clean = (): GraphicStyle => resolveGraphicStyle('clean')

const graphemeCount = (text: string): number => {
  const parts = graphemesOf(text)
  if (parts === null) throw new Error('node 24 has Intl.Segmenter')
  return parts.length
}
/** §6.3's node measure: 0.55 of the pixel size per grapheme, ascent and descent as the layout assumes. */
const measure: TextMeasure = (text, look) => ({
  width: (graphemeCount(text) * look.px * 11) / 20,
  ascent: ASCENT * look.px,
  descent: (LINE_HEIGHT - ASCENT) * look.px
})

interface Fixture {
  id: string
  shape: string
  language: string
  spec: GraphicSpec
}
const ALL = (JSON.parse(readFileSync(new URL('./fixtures/graphics/specs.json', import.meta.url), 'utf8')) as { specs: Fixture[] }).specs
const FIXTURES = ALL.filter((f) => (THREE as readonly string[]).includes(f.spec.data.template))
const fixture = (template: string): GraphicSpec => FIXTURES.find((f) => f.spec.data.template === template && f.language === 'en')!.spec

const totalOf = (s: GraphicSpec, fps: number): number => Math.max(1, Math.round(s.seconds * fps))
const listAt = (s: GraphicSpec, frame: number, fps = FPS, size = PORTRAIT, style = clean()): DrawList => drawListAt(s, style, frame, fps, size, measure)
const settledFrame = (s: GraphicSpec, fps = FPS, style = clean()): number => graphicMovingFrames(s, style, fps, totalOf(s, fps)) - 1

function flat(items: readonly DrawItem[]): DrawItem[] {
  return items.flatMap((item) => (item.kind === 'group' ? flat(item.children) : [item]))
}
const textsOf = (list: DrawList): TextItem[] => flat(list.items).filter((i): i is TextItem => i.kind === 'text')
const find = (list: DrawList, id: string): DrawItem[] => flat(list.items).filter((i) => i.id === id)
const byId = <T extends DrawItem>(list: DrawList, id: string): T => {
  const found = find(list, id)
  expect(found, `one item ${id}`).toHaveLength(1)
  return found[0] as T
}
/** A field's drawn string: its pieces (wrapped lines) in reading order, joined by single spaces. */
function drawnField(list: DrawList, path: string): string | null {
  const pieces = textsOf(list)
    .filter((t) => t.source?.path === path)
    .sort((a, b) => a.source!.piece - b.source!.piece || a.box.y - b.box.y)
  return pieces.length === 0 ? null : pieces.map((t) => t.text).join(' ')
}
const normalised = (s: string): string => s.split(/\s+/u).filter(Boolean).join(' ')

/** Every drawn field of the data by its source path, as the painter must draw it settled; an empty string draws no item. */
function expectedFields(data: GraphicData): Record<string, string> {
  const out: Record<string, string> = {}
  const put = (path: string, v: string): void => {
    if (normalised(v) !== '') out[path] = normalised(v)
  }
  if (data.template === 'timeline') {
    data.items.forEach((item, i) => {
      put(`data.items.${i}.when`, item.when)
      put(`data.items.${i}.label`, item.label)
    })
  } else if (data.template === 'before-after' || data.template === 'versus') {
    const [a, b] = data.template === 'versus' ? (['left', 'right'] as const) : (['before', 'after'] as const)
    const sides = data as unknown as Record<string, { label: string; value: string }>
    for (const side of [a, b]) {
      put(`data.${side}.label`, sides[side].label)
      put(`data.${side}.value`, sides[side].value)
    }
  } else throw new Error(`not one of step 6's: ${data.template}`)
  return out
}

/** The ids of the items each element of a template brings, by element (a beat each), for an arrival read. */
function elementsOf(data: GraphicData): { text: string[]; shapes: string[]; strokes: string[] }[] {
  if (data.template === 'timeline') {
    return data.items.map((_, i) => ({ text: [`when-${i}`, `label-${i}`], shapes: [`dot-${i}`], strokes: i >= 1 ? [`edge-${i}`] : [] }))
  }
  if (data.template === 'before-after') {
    return [
      { text: ['before-label', 'before-value'], shapes: ['panel'], strokes: [] },
      { text: ['after-label', 'after-value'], shapes: [], strokes: [] }
    ]
  }
  if (data.template === 'versus') {
    return [
      { text: ['left-label', 'left-value'], shapes: ['left-panel'], strokes: [] },
      { text: ['right-label', 'right-value'], shapes: ['right-panel'], strokes: ['divider'] }
    ]
  }
  throw new Error(data.template)
}

/* ------------------------------------------------------------ the fixtures */

describe('step 6’s three, drawn flat over their English fixtures (§9)', () => {
  it('has one English fixture per template, each drawn by its own DRAWERS row, drawing something at both shapes', () => {
    for (const id of THREE) {
      const f = FIXTURES.filter((x) => x.spec.data.template === id && x.language === 'en')
      expect(f, id).toHaveLength(1)
      expect(DRAWERS[id], id).toBeDefined()
      for (const size of SHAPES) expect(listAt(f[0].spec, settledFrame(f[0].spec), FPS, size).items.length, `${id} ${size.width}x${size.height}`).toBeGreaterThan(0)
    }
    // The timeline's fixture holds its most items (§6.10's longest in English).
    const t = fixture('timeline').data
    expect(t.template === 'timeline' && t.items.length).toBe(GRAPHIC_TEMPLATES.timeline!.maxItems)
  })

  it('at the settled frame the text items are every data string verbatim and nothing else, fully shown and untransformed, at both shapes', () => {
    for (const f of FIXTURES) {
      for (const size of SHAPES) {
        const list = listAt(f.spec, settledFrame(f.spec), FPS, size)
        const want = expectedFields(f.spec.data)
        const at = `${f.id} ${size.width}x${size.height}`
        for (const [path, text] of Object.entries(want)) expect(drawnField(list, path), `${at} ${path}`).toBe(text)
        for (const t of textsOf(list)) {
          expect(Object.keys(want), `${at}: ${t.id} "${t.text}"`).toContain(t.source?.path)
          expect(t.opacity, `${at} ${t.id}`).toBe(1)
          expect(t.transform, `${at} ${t.id}`).toBeUndefined()
        }
      }
    }
  })

  it('each element arrives on its beat frame and not the frame before, at 24, 25, 30 and 60 fps: its words at full opacity and untransformed, its edge or divider drawn to 1', () => {
    for (const fps of RATES) {
      for (const f of FIXTURES) {
        const s = f.spec
        elementsOf(s.data).forEach((el, i) => {
          const bf = beatFrame(s.beats[i], fps)
          const on = listAt(s, bf, fps)
          const before = listAt(s, bf - 1, fps)
          const at = `${f.id} element ${i} at ${fps} fps, beat frame ${bf}`
          for (const id of el.text) {
            expect(byId<TextItem>(on, id).opacity, `${at}: ${id}`).toBe(1)
            expect(byId<TextItem>(on, id).transform, `${at}: ${id}`).toBeUndefined()
            expect(byId<TextItem>(before, id).opacity, `${at}: ${id} the frame before`).toBeLessThan(1)
          }
          for (const id of el.shapes) {
            expect(byId<ShapeItem>(on, id).transform, `${at}: ${id}`).toBeUndefined()
            expect(byId<ShapeItem>(before, id).opacity, `${at}: ${id} the frame before`).toBeLessThan(byId<ShapeItem>(on, id).opacity)
          }
          for (const id of el.strokes) {
            expect(byId<StrokeItem>(on, id).to, `${at}: ${id}`).toBe(1)
            expect(byId<StrokeItem>(before, id).to, `${at}: ${id} the frame before`).toBeLessThan(1)
          }
        })
        if (s.data.template === 'before-after') {
          // The reveal: its whole half on the after's beat frame, short of it the frame before.
          const bf = beatFrame(s.beats[1], fps)
          const half = byId<ShapeItem>(listAt(s, settledFrame(s, fps), fps), 'reveal').box.width
          expect(byId<ShapeItem>(listAt(s, bf, fps), 'reveal').box.width, `${f.id} the reveal on its beat frame at ${fps}`).toBe(half)
          expect(byId<ShapeItem>(listAt(s, bf - 1, fps), 'reveal').box.width, `${f.id} the reveal the frame before at ${fps}`).toBeLessThan(half)
        }
      }
    }
  })

  it('before its span an element is there at opacity 0 (its edge or divider at 0, the reveal at width 0 and opacity 0), and every frame draws the same ids in the same order', () => {
    for (const f of FIXTURES) {
      const s = f.spec
      const total = totalOf(s, FPS)
      const ids = (l: DrawList): string[] => flat(l.items).map((i) => i.id)
      const first = ids(listAt(s, 0))
      for (let frame = 0; frame < total; frame++) expect(ids(listAt(s, frame)), `${f.id} frame ${frame}`).toEqual(first)
      elementsOf(s.data).forEach((el, i) => {
        // The last frame whose time is at or before the element's start, beat − entrance (and the stroke's, beat − stroke).
        const quiet = Math.floor((s.beats[i] - DURATIONS.entrance) * FPS - 1e-9)
        const still = Math.floor((s.beats[i] - DURATIONS.stroke) * FPS - 1e-9)
        if (quiet >= 0) {
          for (const id of [...el.text, ...el.shapes]) for (const item of find(listAt(s, quiet), id)) expect(item.opacity, `${f.id} ${id} frame ${quiet}`).toBe(0)
        }
        if (still >= 0) for (const id of el.strokes) expect(byId<StrokeItem>(listAt(s, still), id).to, `${f.id} ${id} frame ${still}`).toBe(0)
      })
      if (s.data.template === 'before-after') {
        const quiet = Math.floor((s.beats[1] - DURATIONS.entrance) * FPS - 1e-9)
        const reveal = byId<ShapeItem>(listAt(s, quiet), 'reveal')
        expect(reveal.box.width, `${f.id} reveal frame ${quiet}`).toBe(0)
        expect(reveal.opacity, `${f.id} reveal frame ${quiet}`).toBe(0)
        expect(byId<ShapeItem>(listAt(s, settledFrame(s)), 'reveal').opacity).toBe(REVEAL_OPACITY)
      }
    }
  })

  it('the reading hold reads every string they draw: drawnStrings is the data’s strings in drawn order, and each fixture’s seconds is graphicSeconds over them, rounded up to 0.1 s', () => {
    for (const f of FIXTURES) {
      const d = f.spec.data
      const want =
        d.template === 'timeline'
          ? d.items.flatMap((i) => [i.when, i.label])
          : d.template === 'before-after'
            ? [d.before.label, d.before.value, d.after.label, d.after.value]
            : d.template === 'versus'
              ? [d.left.label, d.left.value, d.right.label, d.right.value]
              : []
      expect(drawnStrings(d), f.id).toEqual(want)
      const need = graphicSeconds(GRAPHIC_TEMPLATES[d.template]!, f.spec.beats, drawnText(d))
      expect(need, f.id).not.toBeNull()
      expect(f.spec.seconds, f.id).toBe(Math.ceil(need! * 10 - 1e-6) / 10)
    }
  })

  it('settles: the list at the last moving frame deep-equals every later frame’s, to the clip’s last, at every rate', () => {
    for (const fps of RATES) {
      for (const f of FIXTURES) {
        const settled = settledFrame(f.spec, fps)
        expect(settled, f.id).toBeGreaterThanOrEqual(beatFrame(f.spec.beats[f.spec.beats.length - 1], fps))
        const want = listAt(f.spec, settled, fps)
        for (let frame = settled + 1; frame < totalOf(f.spec, fps); frame++) expect(listAt(f.spec, frame, fps), `${f.id} frame ${frame} at ${fps}`).toStrictEqual(want)
      }
    }
  })
})

/* ------------------------------------------------------------ the property */

/** Made-up words, never a language's: short, long and in three non-Latin scripts (none of them Hindi or Telugu). */
const SHORT = ['Gear', 'Edit', 'Rent', 'Ads', 'Day one']
const LONG = ['A considerably longer label that has to wrap', 'Everything we delivered over the whole season', 'Second shooter plus assistant and travel']
/** Long enough that a side or a row fits its third only scaled down (the too-big rule's height half). */
const LONGER = [
  'Every single print and album we delivered across the whole of last wedding season to every couple',
  'The second shooter, the assistant, the travel and the hotel for the two nights before the day itself'
]
const OTHER = ['Βαλμόρι τελ', 'ქალვერი მონთა', 'Սավրիկ մելթան', 'Ξενόρα', 'ლომპი', 'Արմիգա պելոտ սարվինա']
/** The owner's Hindi and Telugu strings, by reference: every label and value string of their fixtures. */
const INDIC = ALL.filter((f) => f.language === 'hi' || f.language === 'te')
  .flatMap((f) => {
    const d = f.spec.data as unknown as Record<string, unknown>
    const strings = [d.label, d.title, d.role].filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    const items = Array.isArray(d.items) ? (d.items as { label?: unknown }[]).map((i) => i.label).filter((v): v is string => typeof v === 'string') : []
    return [...strings, ...items]
  })
const VALUES = ['40', '$1,500', '10,00,000', '₹4,000', '12.5', '2019', '3', '600']

type Pool = 'short' | 'long' | 'longer' | 'other' | 'indic'
const POOLS: Record<Pool, readonly string[]> = { short: SHORT, long: LONG, longer: LONGER, other: OTHER, indic: INDIC }

function madeUp(template: (typeof THREE)[number], pool: Pool, rnd: () => number): GraphicSpec {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]
  const words = POOLS[pool]
  const thirds = ['top', 'middle', 'bottom'] as const
  const place: GraphicSpec['place'] = rnd() < 0.2 ? { auto: false, box: { x: 0.1, y: 0.3, width: 0.8, height: 0.4 } } : { auto: true, third: pick(thirds) }
  let data: GraphicData
  let beats: number[]
  if (template === 'timeline') {
    const n = 2 + Math.floor(rnd() * 4)
    data = { template, items: Array.from({ length: n }, () => ({ when: pick(VALUES), label: pick(words) })) }
    beats = Array.from({ length: n }, (_, i) => 0.5 + 0.6 * i)
  } else {
    const side = () => ({ label: pick(words), value: pick(VALUES) })
    data = template === 'versus' ? { template, left: side(), right: side() } : { template, before: side(), after: side() }
    beats = [0.5, 1.2]
  }
  return { data, seconds: GRAPHIC_TEMPLATES[template]!.seconds.max, beats, place, seed: 1, version: 1 }
}

describe('step 6’s three: the property over the text items (§6.12’s phase-2 bar), short, long and non-Latin, at both shapes', () => {
  it('has the owner’s Hindi and Telugu strings to read, by reference', () => {
    expect(INDIC.length).toBeGreaterThan(10)
  })

  it('every text item lies inside the frame and inside the content rect on every frame read; settled, the text items are the data strings verbatim and nothing else; short, long and non-Latin specs are drawn', () => {
    const rnd = seeded(20261125)
    let read = 0
    const dropped: Record<string, number> = { timeline: 0, 'before-after': 0, versus: 0 }
    const drawnLonger: Record<string, number> = { timeline: 0, 'before-after': 0, versus: 0 }
    for (const template of THREE) {
      for (const pool of Object.keys(POOLS) as Pool[]) {
        for (let n = 0; n < 12; n++) {
          const spec = madeUp(template, pool, rnd)
          for (const size of SHAPES) {
            const rect = contentRect(spec.place, size)
            const settled = settledFrame(spec)
            const frames = [0, ...spec.beats.map((b) => beatFrame(b, FPS)), ...spec.beats.map((b) => beatFrame(b, FPS) - 1), settled]
            const at = `${template} ${pool} #${n} ${size.width}x${size.height}`
            const list = listAt(spec, settled, FPS, size)
            // Drawn: none but the longer pool is past the too-big rule; a longer one may rightly draw nothing, and is counted.
            if (pool !== 'longer') expect(list.items.length, `${at}: drawn`).toBeGreaterThan(0)
            else if (list.items.length === 0) {
              dropped[template]++
              continue
            } else drawnLonger[template]++
            for (const frame of frames) {
              for (const t of textsOf(listAt(spec, frame, FPS, size))) {
                const b = t.box
                const what = `${at} frame ${frame} ${t.id} "${t.text}" ${JSON.stringify(b)}`
                expect(b.x >= 0 && b.y >= 0 && b.x + b.width <= size.width + 1e-6 && b.y + b.height <= size.height + 1e-6, `${what}: inside the frame`).toBe(true)
                expect(
                  b.x >= rect.x - 1e-6 && b.y >= rect.y - 1e-6 && b.x + b.width <= rect.x + rect.width + 1e-6 && b.y + b.height <= rect.y + rect.height + 1e-6,
                  `${what}: inside the content rect ${JSON.stringify(rect)}`
                ).toBe(true)
                read++
              }
            }
            // Settled, every item (a shape's or a word's own box, a stroke's bounds) lies inside the content rect too, as graphicFrame's phase-2 case reads it.
            for (const item of flat(list.items)) {
              if (item.kind === 'dim') continue
              const b = item.kind === 'stroke' ? itemBounds(item, size)! : (item as ShapeItem | TextItem).box
              expect(
                b.x >= rect.x - 1e-6 && b.y >= rect.y - 1e-6 && b.x + b.width <= rect.x + rect.width + 1e-6 && b.y + b.height <= rect.y + rect.height + 1e-6,
                `${at} settled ${item.id} ${JSON.stringify(b)}: inside the content rect ${JSON.stringify(rect)}`
              ).toBe(true)
            }
            const want = expectedFields(spec.data)
            for (const [path, text] of Object.entries(want)) expect(drawnField(list, path), `${at} ${path}`).toBe(text)
            for (const t of textsOf(list)) expect(Object.keys(want), `${at}: ${t.id}`).toContain(t.source?.path)
          }
        }
      }
    }
    expect(read).toBeGreaterThan(5000)
    // The longer pool reaches the too-big rule's height half on the two-sided templates: drawn there, scaled down, every time.
    expect(drawnLonger['before-after']).toBeGreaterThan(0)
    expect(drawnLonger.versus).toBeGreaterThan(0)
    process.stderr.write(`graphic3dTemplates, the longer pool: drawn ${JSON.stringify(drawnLonger)}, dropped as too big ${JSON.stringify(dropped)}\n`)
  })

  it('a field too long for its place at FIT_MIN draws nothing at all (the too-big rule), at both shapes', () => {
    const huge = 'Unbreakablewordthatnoplaceonanyframecanholdatall'.repeat(3)
    const specs: GraphicSpec[] = [
      { ...fixture('timeline'), data: { template: 'timeline', items: [{ when: '2019', label: huge }, { when: '2020', label: 'Fine' }] } },
      { ...fixture('before-after'), data: { template: 'before-after', before: { label: huge, value: '1' }, after: { label: 'After', value: '2' } } },
      { ...fixture('versus'), data: { template: 'versus', left: { label: 'Left', value: '1' }, right: { label: huge, value: '2' } } }
    ]
    for (const s of specs) for (const size of SHAPES) expect(listAt(s, settledFrame(s), FPS, size).items, `${s.data.template} ${size.width}`).toEqual([])
  })
})

/* ------------------------------------------------------------ the geometry */

describe('step 6’s three: each one’s own geometry', () => {
  it('timeline: every dot on one rail, each row below the last, each edge joining two dots down the rail; every when left of its label', () => {
    for (const size of SHAPES) {
      const s = fixture('timeline')
      const list = listAt(s, settledFrame(s), FPS, size)
      const d = s.data as Extract<GraphicData, { template: 'timeline' }>
      const dots = d.items.map((_, i) => byId<ShapeItem>(list, `dot-${i}`))
      const cx = (b: ShapeItem): number => b.box.x + b.box.width / 2
      const cy = (b: ShapeItem): number => b.box.y + b.box.height / 2
      for (const dot of dots) expect(cx(dot)).toBeCloseTo(cx(dots[0]), 9)
      for (let i = 1; i < dots.length; i++) {
        expect(cy(dots[i]), `row ${i} below row ${i - 1}`).toBeGreaterThan(cy(dots[i - 1]))
        expect(byId<StrokeItem>(list, `edge-${i}`).d).toBe(`M ${cx(dots[i - 1])} ${cy(dots[i - 1])} L ${cx(dots[i])} ${cy(dots[i])}`)
      }
      expect(find(list, 'edge-0')).toEqual([])
      d.items.forEach((_, i) => {
        const when = textsOf(list).filter((t) => t.source?.path === `data.items.${i}.when`)
        const label = textsOf(list).filter((t) => t.source?.path === `data.items.${i}.label`)
        expect(when.length * label.length, `row ${i}`).toBeGreaterThan(0)
        const whenRight = Math.max(...when.map((t) => t.box.x + t.box.width))
        for (const l of label) expect(l.box.x, `row ${i}: the label right of its when`).toBeGreaterThan(whenRight)
        for (const t of [...when, ...label]) expect(t.box.x, `row ${i}: right of the rail`).toBeGreaterThan(cx(dots[i]))
      })
    }
  })

  it('before-after: the reveal grows from the card’s middle over the after’s half only, never past it and never over the before’s words; the panel is the whole card', () => {
    for (const size of SHAPES) {
      const s = fixture('before-after')
      const settled = listAt(s, settledFrame(s), FPS, size)
      const panel = byId<ShapeItem>(settled, 'panel')
      const full = byId<ShapeItem>(settled, 'reveal')
      // The reveal's settled box is the card's right half.
      expect(full.box.x).toBeCloseTo(panel.box.x + panel.box.width / 2, 9)
      expect(full.box.x + full.box.width).toBeCloseTo(panel.box.x + panel.box.width, 9)
      expect(full.box.y).toBe(panel.box.y)
      expect(full.box.height).toBe(panel.box.height)
      const beforeRight = Math.max(...textsOf(settled).filter((t) => t.source?.path.startsWith('data.before.')).map((t) => t.box.x + t.box.width))
      const afterLeft = Math.min(...textsOf(settled).filter((t) => t.source?.path.startsWith('data.after.')).map((t) => t.box.x))
      expect(beforeRight).toBeLessThanOrEqual(full.box.x + 1e-6)
      expect(afterLeft).toBeGreaterThanOrEqual(full.box.x - 1e-6)
      let last = -1
      for (let frame = 0; frame <= settledFrame(s); frame++) {
        const r = byId<ShapeItem>(listAt(s, frame, FPS, size), 'reveal')
        const x = r.box.x + (r.transform?.x ?? 0)
        expect(x, `frame ${frame}: from the middle`).toBeCloseTo(full.box.x, 6)
        expect(r.box.width, `frame ${frame}: never past its half`).toBeLessThanOrEqual(full.box.width + 1e-9)
        expect(r.box.width, `frame ${frame}: growing, never shrinking`).toBeGreaterThanOrEqual(last)
        last = r.box.width
      }
    }
  })

  it('versus: the divider runs down the gap between the two halves, and no text but the four fields is drawn (no "vs")', () => {
    for (const size of SHAPES) {
      const s = fixture('versus')
      const list = listAt(s, settledFrame(s), FPS, size)
      const left = byId<ShapeItem>(list, 'left-panel').box
      const right = byId<ShapeItem>(list, 'right-panel').box
      const gap = right.x - (left.x + left.width)
      expect(gap).toBeCloseTo(LAYOUT_SIZES.versus.middle * LAYOUT_SIZES.versus.label * Math.min(size.width, size.height), 0)
      const m = /^M (\S+) (\S+) L (\S+) (\S+)$/.exec(byId<StrokeItem>(list, 'divider').d)!
      const x = Number(m[1])
      expect(Number(m[3])).toBe(x)
      expect(x).toBeCloseTo(left.x + left.width + gap / 2, 9)
      expect(Number(m[2])).toBeGreaterThanOrEqual(left.y)
      expect(Number(m[4])).toBeLessThanOrEqual(left.y + left.height)
      expect([...new Set(textsOf(list).map((t) => t.source?.path))].sort()).toEqual(['data.left.label', 'data.left.value', 'data.right.label', 'data.right.value'])
    }
  })

  it('a missing side, an empty field or no items: no text for it and no throw; nothing at all to draw draws nothing', () => {
    const ba = fixture('before-after')
    const noAfter = { ...ba, data: { template: 'before-after', before: { label: 'Before', value: '10' } } as unknown as GraphicData }
    const texts = textsOf(listAt(noAfter, settledFrame(noAfter))).map((t) => t.source?.path)
    expect(texts.sort()).toEqual(['data.before.label', 'data.before.value'])
    const vs = fixture('versus')
    const emptyLabel = { ...vs, data: { template: 'versus', left: { label: '', value: '1' }, right: { label: 'Right', value: '2' } } as GraphicData }
    expect(textsOf(listAt(emptyLabel, settledFrame(emptyLabel))).map((t) => t.source?.path).sort()).toEqual(['data.left.value', 'data.right.label', 'data.right.value'])
    const nothing = { ...vs, data: { template: 'versus', left: { label: '', value: '' }, right: { label: ' ', value: '' } } as GraphicData }
    expect(listAt(nothing, 10).items).toEqual([])
    const tl = fixture('timeline')
    expect(listAt({ ...tl, data: { template: 'timeline', items: [] } }, 10).items).toEqual([])
    const noWhen = { ...tl, data: { template: 'timeline', items: [{ when: '', label: 'One' }, { when: '', label: 'Two' }] } as GraphicData }
    const l = listAt(noWhen, settledFrame(noWhen))
    expect(textsOf(l).map((t) => t.source?.path)).toEqual(['data.items.0.label', 'data.items.1.label'])
    expect(find(l, 'dot-1')).toHaveLength(1)
  })
})

/* ------------------------------------------------------------ the validator's shape half */

/** One segment per sentence, ids s00, s01 …, a word every 400 ms. */
function talk(sentences: string[]): Transcript {
  const words: Word[] = []
  const segments: Segment[] = []
  let index = 0
  sentences.forEach((text, k) => {
    const start = index
    for (const w of text.split(/\s+/u).filter(Boolean)) {
      words.push({ index, text: w, startMs: index * 400, endMs: index * 400 + 350, confidence: null })
      index += 1
    }
    segments.push({ id: `s${String(k).padStart(2, '0')}`, startMs: start * 400, endMs: (index - 1) * 400 + 350, text, wordStart: start, wordEnd: index - 1 })
  })
  return { assetId: 'a', language: 'en', model: 'test', durationMs: index * 400, words, segments }
}

describe('checkGraphicData, the shape half for step 6’s three (§6.7 rule 9; the binding is the next piece’s)', () => {
  const t = talk(['Before we charged $1,500 and after the rebrand $4,000.', 'In 2019 we started and in 2021 we hired help.'])
  const at = (sentence: string) => ({ assetId: 'a', sentence, words: [] })
  const def = (id: (typeof THREE)[number]) => GRAPHIC_TEMPLATES[id]!

  it('a two-sided template missing a side, or a side that is not a label and a value of strings, is refused with a plain note on that side, and nothing is bound', () => {
    const noAfter = { template: 'before-after', before: { label: 'before', value: '$1,500' } } as unknown as GraphicData
    expect(checkGraphicData(noAfter, def('before-after'), at('s00'), t)).toEqual([{ path: '$.after', message: 'a before after needs its after: a label and a value' }])
    const badLeft = { template: 'versus', left: { label: 'x', value: 3 }, right: { label: 'after', value: '$4,000' } } as unknown as GraphicData
    expect(checkGraphicData(badLeft, def('versus'), at('s00'), t)).toEqual([{ path: '$.left', message: 'a versus needs its left: a label and a value' }])
  })

  it('a timeline holds 2 to 5 rows, and each row’s label must say something', () => {
    const row = (when: string, label: string) => ({ when, label })
    const one = { template: 'timeline', items: [row('2019', 'started')] } as GraphicData
    expect(checkGraphicData(one, def('timeline'), at('s01'), t)).toContainEqual({ path: '$.items', message: 'a timeline needs at least 2 items, has 1' })
    const six = { template: 'timeline', items: Array.from({ length: 6 }, () => row('2019', 'started')) } as GraphicData
    expect(checkGraphicData(six, def('timeline'), at('s01'), t)).toContainEqual({ path: '$.items', message: 'a timeline holds at most 5 items, has 6' })
    const empty = { template: 'timeline', items: [row('2019', 'started'), row('2021', '')] } as GraphicData
    expect(checkGraphicData(empty, def('timeline'), at('s01'), t)).toContainEqual({ path: '$.items[1].label', message: "'' holds no word the transcript can ground" })
  })

  it('reads each side’s fields where the data holds them: a said before-after and versus ground with no note, and a value not said is named by its own words on its own path', () => {
    const said: GraphicData = { template: 'before-after', before: { label: 'before', value: '$1,500' }, after: { label: 'rebrand', value: '$4,000' } }
    expect(checkGraphicData(said, def('before-after'), at('s00'), t)).toEqual([])
    const vs: GraphicData = { template: 'versus', left: { label: 'before', value: '$1,500' }, right: { label: 'rebrand', value: '$4,000' } }
    expect(checkGraphicData(vs, def('versus'), at('s00'), t)).toEqual([])
    const unsaid: GraphicData = { template: 'before-after', before: { label: 'before', value: '$1,500' }, after: { label: 'rebrand', value: '$9,000' } }
    expect(checkGraphicData(unsaid, def('before-after'), at('s00'), t)).toEqual([{ path: '$.after.value', message: "'$9,000' is not said in s00" }])
    const tl: GraphicData = { template: 'timeline', items: [{ when: '2019', label: 'started' }, { when: '2021', label: 'hired help' }] }
    expect(checkGraphicData(tl, def('timeline'), at('s01'), t)).toEqual([])
  })
})
