import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  CLUSTER_SCRIPTS,
  graphemesOf,
  itemBounds,
  itemOrigin,
  localBounds,
  textItems,
  textSpecOf,
  unitFor,
  type DrawItem,
  type DrawList,
  type Drawer,
  type GraphicTargets,
  type Rect,
  type StrokeItem,
  type TextItem,
  type TextLook,
  type TextMeasure,
  type TextUnit
} from '@shared/graphics/items'
import { drawListAt, graphicBox, needsCompositor, onsetTargetsAt } from '@shared/graphics/drawList'
import { MAX_GLOW_BATCHES, MAX_PLANES, cameraIsFlat, compositorRoute, flatItems, focusRadius, glowBatches, glowItemsOf, isFlat } from '@shared/graphics/compositor'
import { DEPTH_DOLLY_FROM, DEPTH_FOCUS_BLUR_PX, DEPTH_FOCUS_LABEL_Z, DEPTH_MOVES, DEPTH_PARALLAX_YAW_FROM, DEPTH_PLANES, DEPTH_TEMPLATES, DEPTH_TILT_FROM, depthOf, heroGlow } from '@shared/graphics/templates/depth'
import { DRAWERS } from '@shared/graphics/templates/index'
import { drawTimeline } from '@shared/graphics/templates/timeline'
import { drawBeforeAfter } from '@shared/graphics/templates/beforeAfter'
import { drawVersus } from '@shared/graphics/templates/versus'
import { EDGE_SWEEP_ID, EDGE_SWEEP_S, EDGE_SWEEP_SPAN, EDGE_SWEEP_START, bezelPath, bezelWidth, drawScreenCard, edgeSweepFrames, landingFrame } from '@shared/graphics/templates/screenCard'
import { DURATIONS, entrance, progress } from '@shared/graphics/motion'
import { graphicMovingFrames } from '@shared/graphics/frame'
import { GRAPHIC_STYLES, GRAPHIC_TEXT_STYLES, resolveGraphicStyle, type GraphicStyle } from '@shared/graphics/style'
import type { GraphicData, GraphicSpec, GraphicTemplateId } from '@shared/graphics/template'
import { seeded } from '@shared/render/moment'
import { INDIC_FONTS } from '@shared/render/textPaint'
import { ASCENT, LINE_HEIGHT, layoutText } from '@shared/render/textLayout'
import { textInkReach } from '@shared/render/textStyle'

/*
 * The draw list (docs/CLIPS.md §6.3, phase 1): `drawListAt` through the
 * drawer seam, with hand-built drawers (phase 1 had no template: `DRAWERS` was
 * empty; phase 2's drawers are graphicFrame's); the units a text field is cut into (`unitFor`, `CLUSTER_SCRIPTS` as
 * M3 set it, 2026-10-27, §6.15); `textItems` and `textSpecOf`; the onset
 * targets; `needsCompositor`; `graphicBox` and `itemBounds`. §6.16's two
 * depth cases wait for phase 3's `counter` and `ring` variants.
 */

/* ----------------------------------------------------------------- fixtures */

const SIZE = { width: 1080, height: 1920 }
const FPS = 30

const style = (): GraphicStyle => resolveGraphicStyle('clean')

function spec(seed = 1, template: GraphicTemplateId = 'counter'): GraphicSpec {
  const data = (template === 'counter' ? { template, value: '40', label: 'forty' } : { template }) as GraphicData
  return { data, seconds: 2, beats: [0.5, 1], place: { auto: true, third: 'middle' }, seed, version: 0 }
}

/** Every template id, as a Record so one added to the type without a row here fails typecheck. */
const TEMPLATE_IDS: Record<GraphicTemplateId, true> = {
  counter: true,
  bars: true,
  steps: true,
  quote: true,
  callout: true,
  ring: true,
  keyword: true,
  'lower-third': true,
  'screen-card': true,
  timeline: true,
  'before-after': true,
  versus: true,
  source: true
}

const graphemeCount = (text: string): number => {
  const parts = graphemesOf(text)
  if (parts === null) throw new Error('node 24 has Intl.Segmenter')
  return parts.length
}

/** §6.3's node measure: 0.55 of the pixel size per grapheme (as 11/20, exact in doubles for whole px), deterministic; ascent and descent as the layout assumes. */
const measure: TextMeasure = (text, look) => ({
  width: (graphemeCount(text) * look.px * 11) / 20,
  ascent: ASCENT * look.px,
  descent: (LINE_HEIGHT - ASCENT) * look.px
})

const look = (px = 40, over: Partial<TextLook> = {}): TextLook => ({
  textStyleId: 'clean',
  font: 'Montserrat',
  px,
  align: 'left',
  ...over
})

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height })

const shape = (id: string, box: Rect, over: Partial<Extract<DrawItem, { kind: 'shape' }>> = {}): DrawItem => ({
  kind: 'shape',
  id,
  opacity: 1,
  shape: 'rect',
  box,
  fill: '#ffffff',
  ...over
})

const text = (id: string, content: string, box: Rect, over: Partial<TextItem> = {}): TextItem => ({
  kind: 'text',
  id,
  opacity: 1,
  text: content,
  look: look(),
  box,
  ...over
})

const stroke = (id: string, d: string, over: Partial<Extract<DrawItem, { kind: 'stroke' }>> = {}): DrawItem => ({
  kind: 'stroke',
  id,
  opacity: 1,
  d,
  from: 0,
  to: 1,
  width: 4,
  color: '#ffffff',
  cap: 'round',
  join: 'round',
  ...over
})

const dim = (id = 'dim', hole?: Rect): DrawItem => ({
  kind: 'dim',
  id,
  opacity: 1,
  color: '#000000',
  alpha: 0.35,
  ...(hole ? { hole: { box: hole, radius: 12, feather: 8 } } : {})
})

const flat = (items: DrawItem[]): DrawList => ({ width: SIZE.width, height: SIZE.height, items })

/** No reach on any side. */
const NONE = { left: 0, right: 0, top: 0, bottom: 0 }

/** The EFFECTS §51 clusters, one conjunct or pre-base vowel each: a grapheme cluster of two to four code points. */
const DEVANAGARI_CLUSTERS = ['क्ष', 'त्र', 'ज्ञ', 'श्र', 'कि']
const TELUGU_CLUSTERS = ['క్ష', 'త్ర', 'శ్రీ', 'కి', 'స్త']
const HINDI = 'स्कूल में क्षत्रिय बच्चे'
const TELUGU = 'తెలుగు భాష మధురం'
const TAMIL = 'இது புத்தகம்'
const ARABIC = 'مرحبا بالعالم'

/* -------------------------------------------------------------- the drawers */

describe('graphicDrawList: the drawer seam', () => {
  it('DRAWERS is a frozen record, each row a function, never the source card (after the beta); the screen card drawn since phase 3 piece 4, step 6’s three since its piece 1', () => {
    // Empty in phase 1; phase 2's template commits add rows (§6.2), so membership is asserted, not the whole list.
    expect(Object.isFrozen(DRAWERS)).toBe(true)
    for (const [id, drawer] of Object.entries(DRAWERS)) expect(typeof drawer, id).toBe('function')
    // The retrieved-fact cards are after the beta (docs/CLIPS.md §16.75): no row draws them.
    expect(DRAWERS.source).toBeUndefined()
    // Phase 3's piece 4 (§6.16): the screen card's row is its own drawer.
    expect(DRAWERS['screen-card']).toBe(drawScreenCard)
    // Step 6's piece 1 (§9): each of the three is its own file's drawer.
    expect(DRAWERS.timeline).toBe(drawTimeline)
    expect(DRAWERS['before-after']).toBe(drawBeforeAfter)
    expect(DRAWERS.versus).toBe(drawVersus)
  })

  it('with no drawer for the template, the list is empty and flat, for every template id without a row in DRAWERS', () => {
    const without = (Object.keys(TEMPLATE_IDS) as GraphicTemplateId[]).filter((id) => DRAWERS[id] === undefined)
    expect(without).toContain('source')
    for (const id of without) {
      const list = drawListAt(spec(1, id), style(), 7, FPS, SIZE, measure)
      expect(list, id).toStrictEqual({ width: SIZE.width, height: SIZE.height, items: [] })
      expect(needsCompositor(list), id).toBe(false)
    }
  })

  it("a hand-built drawer's items, camera and glow arrive on the list, with t = frame / fps and the targets given", () => {
    const seen: { t: number; fps: number; targets: GraphicTargets }[] = []
    const items: DrawItem[] = [shape('panel', rect(100, 100, 400, 200)), text('value', '40', rect(120, 120, 44, 47))]
    const drawer: Drawer = (_spec, _style, clock, _size, _measure, targets) => {
      seen.push({ ...clock, targets })
      return { items, camera: { tilt: 5, yaw: 0, dolly: 0.2, fov: 40 }, glow: [{ item: 'value', radius: 12, strength: 0.6 }] }
    }
    const subject = rect(300, 600, 200, 200)
    const list = drawListAt(spec(), style(), 15, FPS, SIZE, measure, { subject }, drawer)
    expect(list.items).toEqual(items)
    expect(list.items).not.toBe(items)
    expect(list.camera).toEqual({ tilt: 5, yaw: 0, dolly: 0.2, fov: 40 })
    expect(list.glow).toEqual([{ item: 'value', radius: 12, strength: 0.6 }])
    expect(list.width).toBe(SIZE.width)
    expect(list.height).toBe(SIZE.height)
    expect(seen).toEqual([{ t: 0.5, fps: FPS, targets: { subject } }])
    expect(needsCompositor(list)).toBe(true)

    // No targets given: the drawer sees none resolved, never undefined.
    drawListAt(spec(), style(), 0, FPS, SIZE, measure, undefined, drawer)
    expect(seen[1]).toEqual({ t: 0, fps: FPS, targets: {} })

    // A phase-1 or phase-2 drawer returns items alone: the list carries no camera or glow key.
    const plain = drawListAt(spec(), style(), 3, FPS, SIZE, measure, undefined, () => ({ items }))
    expect('camera' in plain).toBe(false)
    expect('glow' in plain).toBe(false)
    expect(needsCompositor(plain)).toBe(false)
  })

  it('is deterministic: the same arguments twice give deep-equal lists, and another seed changes only the seeded items', () => {
    // A jitter from `seeded(spec.seed)`, drawn in a fixed order, beside an item that never moves.
    const jitter: Drawer = (s, _style, clock) => {
      const random = seeded(s.seed)
      const dx = random() * 40
      const dy = random() * 40
      return {
        items: [
          shape('fixed', rect(100, 100, 200, 100)),
          shape('dot', rect(500 + dx, 500 + dy + clock.t * 10, 20, 20), { shape: 'circle' })
        ]
      }
    }
    const a = drawListAt(spec(1), style(), 9, FPS, SIZE, measure, undefined, jitter)
    const b = drawListAt(spec(1), style(), 9, FPS, SIZE, measure, undefined, jitter)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    const c = drawListAt(spec(2), style(), 9, FPS, SIZE, measure, undefined, jitter)
    expect(c.items[0]).toEqual(a.items[0])
    expect(c.items[1]).not.toEqual(a.items[1])
    expect(c.items[1].id).toBe('dot')
  })
})

/* ------------------------------------------------------------------- units */

describe('graphicDrawList: units', () => {
  it('CLUSTER_SCRIPTS holds the scripts M3 cleared, Devanagari and Telugu, and is frozen', () => {
    // Membership, not the whole list: a script M3 clears later joins it; one M3 did not measure may not.
    expect(CLUSTER_SCRIPTS).toContain('Devanagari')
    expect(CLUSTER_SCRIPTS).toContain('Telugu')
    const measured = new Set(['Devanagari', 'Telugu'])
    for (const script of CLUSTER_SCRIPTS) expect(measured.has(script), `${script} was not measured by M3`).toBe(true)
    expect(Object.isFrozen(CLUSTER_SCRIPTS)).toBe(true)
  })

  it("unitFor: 'line' and 'word' as asked; 'cluster' only with no shaped script or every shaped script in CLUSTER_SCRIPTS", () => {
    const cluster = ['Hello world', HINDI, TELUGU, `Price ${HINDI}`, ...DEVANAGARI_CLUSTERS, ...TELUGU_CLUSTERS, `${HINDI} ${TELUGU}`]
    for (const t of cluster) expect(unitFor(t, 'cluster'), t).toBe('cluster')
    // A shaped script M3 did not clear animates per word (§16.61), alone or beside a cleared one.
    const word = [TAMIL, ARABIC, `${HINDI} ${TAMIL}`, `${TELUGU} ${ARABIC}`]
    for (const t of word) expect(unitFor(t, 'cluster'), t).toBe('word')
    for (const t of [...cluster, ...word]) {
      expect(unitFor(t, 'line'), t).toBe('line')
      expect(unitFor(t, 'word'), t).toBe('word')
    }
  })

  it("textItems: Hindi and Telugu asked for by 'cluster' come back in grapheme clusters, never code points, and never less than a word for Tamil", () => {
    const counts: string[] = []
    for (const [sentence, expected] of [
      [HINDI, { स्कूल: 2, क्षत्रिय: 3 }],
      [TELUGU, { తెలుగు: 3 }]
    ] as const) {
      const items = textItems({ id: 'q', text: sentence, look: look(), at: { x: 0, y: 0, width: 5000 }, unit: 'cluster' }, measure)
      for (const item of items) {
        expect(graphemeCount(item.text), `${item.text} is one cluster`).toBe(1)
        expect(item.text, `${item.text} is not a lone mark`).not.toMatch(/^\p{M}+$/u)
        expect(item.text).not.toMatch(/\s/)
      }
      expect(items.map((i) => i.text).join('')).toBe(sentence.replace(/\s+/g, ''))
      for (const word of sentence.split(' ')) {
        const pieces = items.filter((i) => word.includes(i.text) && i.text.length > 0).length
        const byCluster = graphemeCount(word)
        const byCodePoint = Array.from(word).length
        counts.push(`${word} ${byCluster} (${byCodePoint} code points)`)
        expect(byCluster, word).toBeLessThan(byCodePoint)
        const want = (expected as Record<string, number>)[word]
        if (want !== undefined) expect(byCluster, `M3's count for ${word}`).toBe(want)
        expect(pieces, `${word} pieces`).toBeGreaterThanOrEqual(byCluster)
      }
    }
    // Each §51 cluster is exactly one piece, the cluster whole.
    for (const cluster of [...DEVANAGARI_CLUSTERS, ...TELUGU_CLUSTERS]) {
      const items = textItems({ id: 'c', text: cluster, look: look(), at: { x: 0, y: 0, width: 500 }, unit: 'cluster' }, measure)
      expect(items.map((i) => i.text), cluster).toEqual([cluster])
      expect(Array.from(cluster).length, cluster).toBeGreaterThan(1)
    }
    // Tamil asked for by cluster: per word, never below.
    const tamil = textItems({ id: 't', text: TAMIL, look: look(), at: { x: 0, y: 0, width: 5000 }, unit: 'cluster' }, measure)
    expect(tamil.map((i) => i.text)).toEqual(TAMIL.split(' '))
    process.stderr.write(`graphicDrawList: Intl.Segmenter grapheme counts on node ${process.version}: ${counts.join('; ')}\n`)
  })

  it("textItems: Latin asked for by 'cluster' comes back in graphemes; 'word' and 'line' as asked", () => {
    const at = { x: 0, y: 0, width: 5000 }
    expect(textItems({ id: 'l', text: 'Hi yo', look: look(), at, unit: 'cluster' }, measure).map((i) => i.text)).toEqual(['H', 'i', 'y', 'o'])
    expect(textItems({ id: 'l', text: 'Hi yo', look: look(), at, unit: 'word' }, measure).map((i) => i.text)).toEqual(['Hi', 'yo'])
    expect(textItems({ id: 'l', text: 'Hi  yo', look: look(), at, unit: 'line' }, measure).map((i) => i.text)).toEqual(['Hi yo'])
    expect(textItems({ id: 'l', text: HINDI, look: look(), at, unit: 'word' }, measure).map((i) => i.text)).toEqual(HINDI.split(' '))
    // A flag is two code points and one grapheme; a combining acute rides its letter.
    expect(textItems({ id: 'l', text: 'é🇮🇳', look: look(), at, unit: 'cluster' }, measure).map((i) => i.text)).toEqual(['é', '🇮🇳'])
  })
})

/* -------------------------------------------------------------- text items */

describe('graphicDrawList: textItems and textSpecOf', () => {
  it('wraps greedily at the width into lines round(px × LINE_HEIGHT) tall, ids and sources in reading order, pieces where the line puts them', () => {
    // 40 px: 22 px a grapheme; "one two" is 7 graphemes, 154 px, and fits a width of 154 exactly; "one two three" does not.
    const at = { x: 100, y: 200, width: 154 }
    const lines = textItems({ id: 'f', text: 'one two three four', look: look(40, { align: 'center' }), at, unit: 'line', source: 'data.label' }, measure)
    expect(lines.map((i) => i.text)).toEqual(['one two', 'three', 'four'])
    expect(lines.map((i) => i.id)).toEqual(['f-0', 'f-1', 'f-2'])
    expect(lines.map((i) => i.source)).toEqual([
      { path: 'data.label', piece: 0 },
      { path: 'data.label', piece: 1 },
      { path: 'data.label', piece: 2 }
    ])
    const lineHeight = Math.round(40 * LINE_HEIGHT)
    expect(lineHeight).toBe(47)
    lines.forEach((item, row) => {
      expect(item.box.height).toBe(lineHeight)
      expect(item.box.y).toBe(200 + row * lineHeight)
      expect(item.opacity).toBe(1)
      expect(item.transform).toBeUndefined()
    })
    expect(lines.map((i) => i.box.width)).toEqual([154, 110, 88])
    // Centred in the width: each line's left is the width's middle less half the line.
    expect(lines.map((i) => i.box.x)).toEqual([100, 100 + (154 - 110) / 2, 100 + (154 - 88) / 2])

    const words = textItems({ id: 'f', text: 'one two three four', look: look(40), at, unit: 'word', source: 'data.label' }, measure)
    expect(words.map((i) => i.text)).toEqual(['one', 'two', 'three', 'four'])
    expect(words.map((i) => i.id)).toEqual(['f-0', 'f-1', 'f-2', 'f-3'])
    expect(words.map((i) => i.source?.piece)).toEqual([0, 1, 2, 3])
    // "two" sits where "one " ends: four graphemes in, on the first line; "three" starts the second line at the left.
    expect(words[1].box).toEqual({ x: 100 + 4 * 22, y: 200, width: 66, height: lineHeight })
    expect(words[2].box).toEqual({ x: 100, y: 200 + lineHeight, width: 110, height: lineHeight })
    expect(words[3].box.y).toBe(200 + 2 * lineHeight)

    // Clusters: each at the width of the line's text before it.
    const clusters = textItems({ id: 'f', text: 'ab c', look: look(40), at: { x: 0, y: 0, width: 5000 }, unit: 'cluster' }, measure)
    expect(clusters.map((i) => [i.text, i.box.x])).toEqual([
      ['a', 0],
      ['b', 22],
      ['c', 66]
    ])

    // A fixed glyph has no source; a word wider than the width stands alone; px is rounded; empty text draws nothing.
    const glyph = textItems({ id: 'num', text: '1', look: look(40), at, unit: 'line' }, measure)
    expect(glyph).toHaveLength(1)
    expect('source' in glyph[0]).toBe(false)
    const wide = textItems({ id: 'w', text: 'abcdefghij kl', look: look(40), at: { x: 0, y: 0, width: 100 }, unit: 'line' }, measure)
    expect(wide.map((i) => i.text)).toEqual(['abcdefghij', 'kl'])
    const rounded = textItems({ id: 'r', text: 'a', look: look(40.4), at, unit: 'line' }, measure)
    expect(rounded[0].look.px).toBe(40)
    expect(rounded[0].box.height).toBe(47)
    expect(textItems({ id: 'e', text: '  ', look: look(), at, unit: 'word' }, measure)).toEqual([])
  })

  it("shaped pieces take INDIC_FONTS' face; Latin pieces keep the style's", () => {
    const at = { x: 0, y: 0, width: 5000 }
    const mixed = textItems({ id: 'm', text: 'Price दाम ధర', look: look(40), at, unit: 'word' }, measure)
    expect(mixed.map((i) => i.look.font)).toEqual(['Montserrat', 'Noto Sans Devanagari', 'Noto Sans Telugu'])
    expect(INDIC_FONTS).toContain(mixed[1].look.font)
    expect(INDIC_FONTS).toContain(mixed[2].look.font)
    // The rest of the look rides along.
    expect(mixed[1].look).toEqual({ ...look(40), font: 'Noto Sans Devanagari' })
    // A line holding Hindi is one item in the Devanagari face; clusters too.
    const line = textItems({ id: 'm', text: 'Price दाम', look: look(40), at, unit: 'line' }, measure)
    expect(line.map((i) => i.look.font)).toEqual(['Noto Sans Devanagari'])
    const clusters = textItems({ id: 'm', text: 'దాం', look: look(40), at, unit: 'cluster' }, measure)
    for (const item of clusters) expect(item.look.font).toBe('Noto Sans Telugu')
  })

  it('a line of mixed faces places each word by the sum of the words before it, each in its own face; a line of one face by the prefix in that face', () => {
    // A measure whose advance depends on the face: Montserrat 0.7 em a grapheme, the Noto faces 0.5 (the renderer's differ too; node's fake above does not).
    const perFace: TextMeasure = (t, l) => ({
      width: graphemeCount(t) * l.px * (l.font === 'Montserrat' ? 0.7 : 0.5),
      ascent: ASCENT * l.px,
      descent: (LINE_HEIGHT - ASCENT) * l.px
    })
    const at = { x: 0, y: 0, width: 5000 }
    const pieces = (items: TextItem[]): string => items.map((i) => `${i.text}@${i.box.x}+${i.box.width}`).join(' ')
    for (const unit of ['word', 'cluster'] as const) {
      const items = textItems({ id: 'm', text: 'Price दाम ధర', look: look(100), at, unit }, perFace)
      // Pieces never overlap and never gap: each starts where the one before it ends, plus a space between words.
      for (let i = 1; i < items.length; i++) {
        const gap = items[i].box.x - (items[i - 1].box.x + items[i - 1].box.width)
        const betweenWords = items[i].look.font !== items[i - 1].look.font
        expect(gap, `${unit}: ${pieces(items)}`).toBeCloseTo(betweenWords ? 50 : 0, 9)
      }
      // "Price" in Montserrat is 350 wide; "दाम" (two clusters) starts after it and a space in the line's face (50), at 400.
      const price = items.filter((i) => i.look.font === 'Montserrat')
      expect(price[price.length - 1].box.x + price[price.length - 1].box.width).toBe(350)
      expect(items.find((i) => i.look.font === 'Noto Sans Devanagari')?.box.x).toBe(400)
      // The last piece ends at the line's width as the same rule computes it: 350 + 50 + 100 + 50 + 100.
      const last = items[items.length - 1]
      expect(last.box.x + last.box.width).toBe(650)
    }
    // Centred, the line's width for the placement is that sum, not the line measured whole in one face.
    const centred = textItems({ id: 'c', text: 'Price दाम', look: look(100, { align: 'center' }), at: { x: 0, y: 0, width: 1000 }, unit: 'word' }, perFace)
    expect(centred[0].box.x).toBe((1000 - (350 + 50 + 100)) / 2)
    // Wrapping measures a mixed candidate the same way: "Price दाम" is 500, so it wraps at 499 and fits at 500.
    expect(textItems({ id: 'w', text: 'Price दाम', look: look(100), at: { x: 0, y: 0, width: 499 }, unit: 'word' }, perFace).map((i) => i.box.y)).toEqual([0, 118])
    expect(textItems({ id: 'w', text: 'Price दाम', look: look(100), at: { x: 0, y: 0, width: 500 }, unit: 'word' }, perFace).map((i) => i.box.y)).toEqual([0, 0])
    // One face keeps the prefix rule: the line measured whole in its own face, so kerning stays.
    const one = textItems({ id: 'o', text: 'Price now', look: look(100), at, unit: 'word' }, perFace)
    expect(one.map((i) => i.box.x)).toEqual([0, 6 * 70])
    const hindi = textItems({ id: 'h', text: 'दाम दाम', look: look(100), at, unit: 'cluster' }, perFace)
    expect(hindi.map((i) => i.box.x)).toEqual([0, 50, 150, 200])
  })

  it('textSpecOf sets every required field, and layoutText reads the px back from the box, one line at the measured baseline', () => {
    const box = rect(100, 200, 154, 47)
    const spec = textSpecOf('one two', look(40, { align: 'center' }), box)
    expect(spec).toEqual({
      version: 0,
      content: 'one two',
      font: 'Montserrat',
      size: 40 / 47,
      color: '#FFFFFF',
      align: 'center',
      position: 'center',
      weight: 700,
      tracking: 0,
      uppercase: false,
      shadow: 0,
      stroke: 0,
      strokeColor: '#000000',
      styleId: 'clean',
      margin: 0,
      offsetX: 0,
      offsetY: 0
    })
    expect('highlight' in spec).toBe(false)
    expect('animationId' in spec).toBe(false)
    const layout = layoutText(spec, box.width, box.height)
    expect(layout.fontPx).toBe(40)
    expect(layout.lines).toEqual(['one two'])
    expect(layout.firstBaseline).toBe(Math.round(ASCENT * 40))
    expect(layout.marginX).toBe(0)
    expect(layout.x).toBe(Math.round(box.width / 2))

    // The round trip holds at every size a graphic draws, through textItems' own boxes.
    for (const px of [12, 23, 40, 97, 160, 301]) {
      const [item] = textItems({ id: 'p', text: 'x', look: look(px), at: { x: 0, y: 0, width: 5000 }, unit: 'line' }, measure)
      const l = layoutText(textSpecOf(item.text, item.look, item.box), item.box.width, item.box.height)
      expect(l.fontPx, `${px}`).toBe(px)
      expect(l.lines, `${px}`).toHaveLength(1)
    }

    // A lit word: its accent through `highlight` on word 0, the captions' own per-word override.
    const lit = textSpecOf('forty', look(40, { accent: '#FFD400' }), box)
    expect(lit.highlight).toEqual({ word: 0, color: '#FFD400' })
  })
})

/* ------------------------------------------------------------------ onset */

describe('graphicDrawList: the onset targets', () => {
  it("with the subject moving on every frame, the dim's hole and the subject the template sees are the onset's on every frame", () => {
    const seen: { frame: number; subject: Rect | null | undefined; tip: { x: number; y: number } | null | undefined }[] = []
    const holes: Rect[] = []
    const drawer: Drawer = (_spec, _style, clock, _size, _measure, targets) => {
      seen.push({ frame: Math.round(clock.t * clock.fps), subject: targets.subject, tip: targets.tip })
      const items: DrawItem[] = targets.subject ? [dim('dim', targets.subject)] : [dim('dim')]
      if (items[0].kind === 'dim' && items[0].hole) holes.push(items[0].hole.box)
      return { items }
    }
    // The subject walks 10 px a frame; the tip (phase 4's, per frame) walks with it.
    const targetsAt = (frame: number): GraphicTargets => ({
      subject: rect(300 + frame * 10, 600, 200, 200),
      tip: { x: frame, y: 0 }
    })
    const box = graphicBox(spec(), style(), FPS, 12, SIZE, measure, targetsAt, drawer)
    expect(box).toEqual(rect(0, 0, SIZE.width, SIZE.height))
    expect(seen).toHaveLength(12)
    expect(holes).toHaveLength(12)
    for (const s of seen) expect(s.subject, `frame ${s.frame}`).toEqual(rect(300, 600, 200, 200))
    for (const hole of holes) expect(hole).toEqual(rect(300, 600, 200, 200))
    // The per-frame targets still reach the drawer per frame.
    expect(seen.map((s) => s.tip?.x)).toEqual(seen.map((s) => s.frame))
  })

  it("onsetTargetsAt: the onset's subject, present or absent, on every frame; tip and screen per frame", () => {
    const at = onsetTargetsAt((frame) => ({ subject: rect(frame, 0, 10, 10), tip: { x: frame, y: frame } }))
    expect(at(5)).toEqual({ subject: rect(0, 0, 10, 10), tip: { x: 5, y: 5 } })
    expect(at(0)).toEqual({ subject: rect(0, 0, 10, 10), tip: { x: 0, y: 0 } })
    // No subject at onset: none later either, even where the frame's own function offers one.
    const none = onsetTargetsAt((frame) => (frame === 0 ? {} : { subject: rect(1, 1, 1, 1), screen: null }))
    expect(none(3)).toEqual({ screen: null })
    expect('subject' in none(3)).toBe(false)
    // A null subject at onset stays null.
    const nul = onsetTargetsAt((frame) => ({ subject: frame === 0 ? null : rect(1, 1, 1, 1) }))
    expect(nul(2)).toEqual({ subject: null })
  })
})

/* ---------------------------------------------------------- needsCompositor */

describe('graphicDrawList: needsCompositor', () => {
  it('is false for a flat list of every kind, and true for each of z, camera and glow alone', () => {
    const every: DrawItem[] = [
      dim('d', rect(1, 1, 1, 1)),
      shape('s', rect(0, 0, 10, 10)),
      text('t', 'x', rect(0, 0, 22, 47)),
      stroke('k', 'M0 0 L10 0'),
      { kind: 'image', id: 'i', opacity: 1, src: 'a.png', box: rect(0, 0, 10, 10), fit: 'contain' },
      { kind: 'group', id: 'g', opacity: 1, children: [shape('c', rect(0, 0, 5, 5))] }
    ]
    expect(needsCompositor(flat(every))).toBe(false)
    expect(needsCompositor({ ...flat(every), glow: [] })).toBe(false)
    expect(needsCompositor(flat([shape('s', rect(0, 0, 10, 10), { z: 0.05 })]))).toBe(true)
    expect(needsCompositor(flat([shape('s', rect(0, 0, 10, 10), { z: 0 })]))).toBe(true)
    expect(needsCompositor(flat([{ kind: 'group', id: 'g', opacity: 1, children: [shape('c', rect(0, 0, 5, 5), { z: 1 })] }]))).toBe(true)
    expect(needsCompositor({ ...flat(every), camera: { tilt: 0, yaw: 0, dolly: 0, fov: 40 } })).toBe(true)
    expect(needsCompositor({ ...flat(every), glow: [{ item: 's', radius: 10, strength: 1 }] })).toBe(true)
    expect(needsCompositor(flat([]))).toBe(false)
  })
})

/*
 * No production graphic reaches §6.16's compositor before phase 3's piece 3:
 * every template's drawer, over every fixture of specs.json, under every
 * style, on every third frame and the last moving one, emits no camera, no
 * glow and no z. Two halves, each with its own membership set, so the
 * piece that rightly makes a template ask adds it to a set and deletes no
 * case. A spec with no `depth` and no `hero` asks only where its template is
 * in `ALWAYS_ASK`: empty until piece 4, which adds `screen-card` (its move,
 * 'tilt-in' or 'pull-back', is a camera with neither field, and its edge
 * sweep a glow, §6.16). A spec WITH a depth or marked hero may ask only where
 * its template is in `MAY_ASK` (or `ALWAYS_ASK`): empty in piece 1; piece 3
 * added `counter` and `ring` (their 2.5D variants and the hero's glow).
 */
describe('graphicDrawList: which drawers ask for the compositor (MAY_ASK, ALWAYS_ASK, MAY_GLOW)', () => {
  /** The templates whose depth variants or hero glow may ask for the compositor: piece 3 adds 'counter' and 'ring'; the 3D templates' piece 3 (§9) adds step 6's three. */
  const MAY_ASK = new Set<GraphicTemplateId>(['counter', 'ring', 'timeline', 'before-after', 'versus'])
  /** The templates whose plain specs ask too, their motion being a camera or a glow of its own: piece 4 adds 'screen-card'. */
  const ALWAYS_ASK = new Set<GraphicTemplateId>(['screen-card'])
  const fixtures = (
    JSON.parse(readFileSync(new URL('./fixtures/graphics/specs.json', import.meta.url), 'utf8')) as { specs: { id: string; spec: GraphicSpec }[] }
  ).specs.filter((f) => DRAWERS[f.spec.data.template] !== undefined)
  const fake: TextMeasure = (t, look) => ({ width: t.length * look.px * 0.55, ascent: look.px * 0.8, descent: look.px * 0.2 })
  const targetsOf = (s: GraphicSpec): GraphicTargets =>
    s.subject ? { subject: { x: s.subject.box.x * SIZE.width, y: s.subject.box.y * SIZE.height, width: s.subject.box.width * SIZE.width, height: s.subject.box.height * SIZE.height } } : {}
  /** The frames read: every third, and the last moving one (what the export holds). */
  const framesOf = (s: GraphicSpec, st: GraphicStyle): number[] => {
    const total = Math.max(1, Math.round(s.seconds * FPS))
    const moving = Math.max(1, graphicMovingFrames(s, st, FPS, total))
    const frames = new Set<number>([moving - 1])
    for (let f = 0; f < total; f += 3) frames.add(f)
    return [...frames]
  }
  const asking = (s: GraphicSpec): string[] => {
    const found: string[] = []
    for (const st of GRAPHIC_STYLES) {
      for (const frame of framesOf(s, st)) {
        if (needsCompositor(drawListAt(s, st, frame, FPS, SIZE, fake, targetsOf(s)))) found.push(`${st.id}@${frame}`)
      }
    }
    return found
  }

  /**
   * The drawn templates specs.json has no fixture for, each with its reason:
   * the screen card draws only over a recording's box (`targets.screen`),
   * which a fixture with no project cannot carry; its own case is below.
   */
  const NO_FIXTURE = new Set<GraphicTemplateId>(['screen-card'])

  it('reads every drawn template, from the fixtures, but those in NO_FIXTURE (the screen card, read on its own below)', () => {
    const read = new Set(fixtures.map((f) => f.spec.data.template))
    for (const id of Object.keys(DRAWERS) as GraphicTemplateId[]) expect(read.has(id) || NO_FIXTURE.has(id), id).toBe(true)
    for (const id of NO_FIXTURE) expect(read.has(id), id).toBe(false)
  })

  it('a plain screen card asks on its moving frames, as ALWAYS_ASK says: under a style with no glow on no frame after its landing; under a glowing one for its edge sweep’s loop, then on no frame', () => {
    expect(ALWAYS_ASK.has('screen-card')).toBe(true)
    const box = { x: 0, y: 656, width: 1080, height: 608 }
    let glowingRead = 0
    for (const move of ['tilt-in', 'pull-back'] as const) {
      const card: GraphicSpec = { data: { template: 'screen-card', clipId: 'rec', move }, seconds: 10, beats: [1], place: { auto: true, third: 'middle' }, seed: 1, version: 1 }
      for (const st of GRAPHIC_STYLES) {
        const L = landingFrame(FPS)
        const N = Math.round(6 * FPS)
        const at = (frame: number): GraphicTargets => ({ screen: { box, file: frame <= L ? `/f/${frame}.png` : null } })
        const lists = Array.from({ length: 300 }, (_, frame) => drawListAt(card, st, frame, FPS, SIZE, fake, at(frame)))
        const asks = lists.map(needsCompositor)
        const where = `${move} ${st.id}`
        // Every frame up to the landing carries the move's camera.
        expect(asks.slice(0, L + 1).every(Boolean), where).toBe(true)
        if (!st.glow) {
          // No glow: nothing asks after the landing, and no frame carries a glow.
          expect(asks.slice(L + 1).some(Boolean), where).toBe(false)
          expect(drawListAt(card, st, L + 5, FPS, SIZE, fake, at(L + 5)).glow, where).toBeUndefined()
          expect(lists.filter((l) => l.glow !== undefined).length, where).toBe(0)
        } else {
          glowingRead++
          // A glowing style: L + 1 .. L + N − 1 ask for the sweep's glow (route two, no camera), L + N on ask for nothing.
          expect(asks.slice(L + 1, L + N).every(Boolean), where).toBe(true)
          expect(asks.slice(L + N).some(Boolean), where).toBe(false)
          for (const frame of [L + 1, L + 5, L + N - 1]) {
            expect(lists[frame].camera, `${where} @${frame}`).toBeUndefined()
            expect(compositorRoute(lists[frame]), `${where} @${frame}`).toBe('glow')
          }
          expect(lists[L + 5].glow, where).toEqual([{ item: 'sweep', radius: st.glow.radius * 1080, strength: st.glow.strength, color: st.palette.accent }])
        }
      }
    }
    // The glowing half was read: neon and energetic, both moves.
    expect(glowingRead).toBe(4)
  })

  it('a spec with no depth and no hero never asks, unless its template is in ALWAYS_ASK (none in piece 1)', () => {
    for (const f of fixtures) {
      if (ALWAYS_ASK.has(f.spec.data.template)) continue
      const { depth: _depth, hero: _hero, ...plain } = f.spec
      expect(asking(plain), f.id).toEqual([])
    }
  })

  /**
   * Phase 3's piece 2 built the glow (graphicCompositor.ts) with no template
   * asking for one: production behaviour unchanged. The templates whose lists
   * may carry a `GlowRequest`: piece 3 adds 'counter' and 'ring' (the hero's
   * glow under a glowing style), piece 5 'screen-card' (its edge sweep, which
   * no fixture carries: its own cases are above and in the sweep's describe).
   */
  const MAY_GLOW = new Set<GraphicTemplateId>(['counter', 'ring', 'screen-card'])

  it('no drawer emits a glow request, plain, with a depth or as a hero, under any style, unless its template is in MAY_GLOW (counter and ring since piece 3; the screen card since piece 5, read on its own above and below)', () => {
    for (const f of fixtures) {
      if (MAY_GLOW.has(f.spec.data.template)) continue
      const { depth: _depth, hero: _hero, ...plain } = f.spec
      for (const variant of [{}, { hero: true as const }, ...(['tilt', 'parallax', 'dolly', 'focus'] as const).map((depth) => ({ depth }))]) {
        const s: GraphicSpec = { ...plain, ...variant }
        const glowing: string[] = []
        for (const st of GRAPHIC_STYLES) {
          for (const frame of framesOf(s, st)) if ((drawListAt(s, st, frame, FPS, SIZE, fake, targetsOf(s)).glow ?? []).length > 0) glowing.push(`${st.id}@${frame}`)
        }
        expect(glowing, `${f.id} ${JSON.stringify(variant)}`).toEqual([])
      }
    }
  })

  it('a depth or a hero asks only on a template in MAY_ASK (counter and ring since piece 3; step 6’s three since the 3D templates’ piece 3)', () => {
    for (const f of fixtures) {
      if (MAY_ASK.has(f.spec.data.template) || ALWAYS_ASK.has(f.spec.data.template)) continue
      for (const variant of [{ hero: true as const }, ...(['tilt', 'parallax', 'dolly', 'focus'] as const).map((depth) => ({ depth }))]) {
        expect(asking({ ...f.spec, ...variant }), `${f.id} ${JSON.stringify(variant)}`).toEqual([])
      }
    }
  })
})

/*
 * §6.16's two depth cases (phase 3's piece 3): `counter` and `ring`, each of
 * their specs.json fixtures, under every style, with each depth, against the
 * flat variant (the same spec with no depth and no hero), on every frame of
 * the clip.
 */
describe('graphicDrawList: the 2.5D variants of counter and ring (§6.16)', () => {
  const fixtures = (
    JSON.parse(readFileSync(new URL('./fixtures/graphics/specs.json', import.meta.url), 'utf8')) as { specs: { id: string; spec: GraphicSpec }[] }
  ).specs.filter((f) => f.spec.data.template === 'counter' || f.spec.data.template === 'ring')
  const fake: TextMeasure = (t, look) => ({ width: t.length * look.px * 0.55, ascent: look.px * 0.8, descent: look.px * 0.2 })
  const plain = (s: GraphicSpec): GraphicSpec => {
    const { depth: _depth, hero: _hero, ...rest } = s
    return rest
  }
  const framesOf = (s: GraphicSpec): number[] => Array.from({ length: Math.max(1, Math.round(s.seconds * FPS)) }, (_, f) => f)
  /** An item with its plane taken off: what the flat variant draws. */
  const unplaned = (item: DrawItem): DrawItem => {
    const { z: _z, ...rest } = item
    return rest as DrawItem
  }
  const byId = (items: readonly DrawItem[]): DrawItem[] => [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const textsOf = (list: DrawList): Record<string, { text: string; look: TextLook }> =>
    Object.fromEntries(list.items.filter((i): i is TextItem => i.kind === 'text').map((i) => [i.id, { text: i.text, look: i.look }]))

  it('reads the six counter and ring fixtures', () => {
    expect(fixtures.map((f) => f.id).sort()).toEqual(['counter-en', 'counter-hi', 'counter-te', 'ring-en', 'ring-hi', 'ring-te'])
  })

  it('every frame’s text items (text and look) equal the flat variant’s, and its every item but for z; at and after the last beat every camera field and the focus blur are exactly 0; at most MAX_PLANES distinct z', () => {
    for (const f of fixtures) {
      for (const st of GRAPHIC_STYLES) {
        const flatSpec = plain(f.spec)
        const lastBeat = Math.max(0, ...flatSpec.beats)
        const settledFrom = Math.ceil(lastBeat * FPS - 1e-6)
        for (const depth of DEPTH_MOVES) {
          const s: GraphicSpec = { ...flatSpec, depth }
          let moved = false
          for (const frame of framesOf(s)) {
            const where = `${f.id} ${depth} ${st.id} @${frame}`
            const twin = drawListAt(flatSpec, st, frame, FPS, SIZE, fake)
            const list = drawListAt(s, st, frame, FPS, SIZE, fake)
            expect(textsOf(list), where).toEqual(textsOf(twin))
            expect(byId(list.items.map(unplaned)), where).toEqual(byId(twin.items))
            // The dims first, then ascending z: painter A's order is painter B's (§6.16).
            const zs = list.items.filter((i) => i.kind !== 'dim').map((i) => i.z ?? 0)
            expect(zs, where).toEqual([...zs].sort((a, b) => a - b))
            expect(new Set(zs).size, where).toBeLessThanOrEqual(MAX_PLANES)
            if (depth === 'tilt') expect(list.items.some((i) => i.z !== undefined), where).toBe(false)
            // The depth is honoured: a camera on every frame.
            expect(list.camera, where).toBeDefined()
            const camera = list.camera!
            if (frame >= settledFrom) {
              // Exactly 0, not within a tolerance: route one takes the settled frame.
              expect(camera.tilt, where).toBe(0)
              expect(camera.yaw, where).toBe(0)
              expect(camera.dolly, where).toBe(0)
              if (camera.focus) expect(camera.focus.px, where).toBe(0)
              expect(cameraIsFlat(camera), where).toBe(true)
              expect(isFlat(list), where).toBe(true)
            } else if (!cameraIsFlat(camera)) {
              moved = true
              // While it moves, each field on its table's plane (the value's named by every multi-plane row).
              if (depth !== 'tilt') expect(list.items.find((i) => i.id === 'value')?.z, where).toBe(DEPTH_PLANES[f.spec.data.template as 'counter' | 'ring'][depth].value)
            }
          }
          // A dead branch cannot pass: each move is off flat on some frame before the beat.
          expect(moved, `${f.id} ${depth} ${st.id} never moves`).toBe(true)
        }
      }
    }
  })

  it('a variant bakes no more frames than its flat twin, and its last moving frame is route one’s picture: the twin’s own list, in its order, with no z', () => {
    for (const f of fixtures) {
      for (const st of GRAPHIC_STYLES) {
        const flatSpec = plain(f.spec)
        const total = Math.max(1, Math.round(flatSpec.seconds * FPS))
        const moving = graphicMovingFrames(flatSpec, st, FPS, total)
        for (const depth of DEPTH_MOVES) {
          const s: GraphicSpec = { ...flatSpec, depth }
          expect(graphicMovingFrames(s, st, FPS, total), `${f.id} ${depth} ${st.id}`).toBe(moving)
          const last = drawListAt(s, st, moving - 1, FPS, SIZE, fake)
          expect(compositorRoute(last), `${f.id} ${depth} ${st.id}`).toBe('flat')
          // On a settled frame the items are the flat variant's own list, in its order and with no z (templates/depth.ts).
          expect(last.items, `${f.id} ${depth} ${st.id}`).toEqual(drawListAt(flatSpec, st, moving - 1, FPS, SIZE, fake).items)
          expect(flatItems(last), `${f.id} ${depth} ${st.id}`).toEqual(last.items)
        }
      }
    }
  })

  it('without WebGL (painter A, flatItems, camera and z ignored) each variant draws its flat twin’s items on every frame; while it moves only the label changes places with what is in front of it', () => {
    const field = (id: string): string => id.replace(/-\d+$/u, '')
    const swapped = new Set<string>()
    for (const f of fixtures) {
      for (const st of GRAPHIC_STYLES) {
        const flatSpec = plain(f.spec)
        for (const depth of DEPTH_MOVES) {
          for (const frame of framesOf(flatSpec)) {
            const where = `${f.id} ${depth} ${st.id} @${frame}`
            const twin = drawListAt(flatSpec, st, frame, FPS, SIZE, fake).items
            const painted = flatItems(drawListAt({ ...flatSpec, depth }, st, frame, FPS, SIZE, fake)).map(unplaned)
            // The same items, geometry, opacity and text: painter A ignores z and the camera.
            expect(byId(painted), where).toEqual(byId(twin))
            const at = (id: string, items: readonly DrawItem[]): number => items.findIndex((i) => i.id === id)
            for (const a of twin) for (const b of twin) if (at(a.id, twin) < at(b.id, twin) && at(a.id, painted) > at(b.id, painted)) swapped.add(`${f.spec.data.template}: ${field(a.id)} / ${field(b.id)}`)
          }
        }
      }
    }
    // The label goes behind (it is on a farther plane than the value, and for the ring's focus than the track and arc); nothing else moves.
    expect([...swapped].sort()).toEqual(['counter: value / label', 'ring: arc / label', 'ring: track / label', 'ring: value / label'])
  })

  it('each move goes the plan’s way, whatever its figure: tilt starts positive (the top away, tests/graphicCompositor.test.ts), parallax’s yaw negative, dolly negative (further away), each returning to 0 without changing sign under a curve that does not overshoot; and the planes stand in the table’s order on every moving frame', () => {
    const z = (items: readonly DrawItem[], field: string): number[] => items.filter((i) => i.id.replace(/-\d+$/u, '') === field).map((i) => i.z ?? 0)
    const one = (items: readonly DrawItem[], field: string, where: string): number => {
      const zs = [...new Set(z(items, field))]
      expect(zs, `${where} ${field}`).toHaveLength(1)
      return zs[0]
    }
    for (const f of fixtures) {
      const template = f.spec.data.template as 'counter' | 'ring'
      for (const st of GRAPHIC_STYLES) {
        const flatSpec = plain(f.spec)
        const sign = { tilt: 1, parallax: -1, dolly: -1 } as const
        for (const depth of ['tilt', 'parallax', 'dolly'] as const) {
          const field = depth === 'tilt' ? 'tilt' : depth === 'parallax' ? 'yaw' : 'dolly'
          const at0 = drawListAt({ ...flatSpec, depth }, st, 0, FPS, SIZE, fake).camera!
          expect(Math.sign(at0[field]), `${f.id} ${depth} ${st.id} @0`).toBe(sign[depth])
          if (st.motion.ease !== 'out-back') {
            for (const frame of framesOf(flatSpec)) {
              const c = drawListAt({ ...flatSpec, depth }, st, frame, FPS, SIZE, fake).camera!
              expect(Math.sign(c[field]), `${f.id} ${depth} ${st.id} @${frame}`).not.toBe(-sign[depth])
            }
          }
        }
        for (const depth of ['parallax', 'dolly', 'focus'] as const) {
          for (const frame of framesOf(flatSpec)) {
            const list = drawListAt({ ...flatSpec, depth }, st, frame, FPS, SIZE, fake)
            if (cameraIsFlat(list.camera!)) continue
            const where = `${f.id} ${depth} ${st.id} @${frame}`
            // Every field on its table's plane: the mapping from an item's id (a wrapped line's `label-1` too) to the table.
            for (const item of list.items) if (item.kind !== 'dim') expect(item.z, `${where} ${item.id}`).toBe(DEPTH_PLANES[template][depth][item.id.replace(/-\d+$/u, '')] ?? 0)
            const value = one(list.items, 'value', where)
            const label = one(list.items, 'label', where)
            if (template === 'counter') {
              const panel = one(list.items, 'panel', where)
              if (depth === 'parallax') {
                expect(value, where).toBeGreaterThan(label)
                expect(label, where).toBeGreaterThan(panel)
              }
              if (depth === 'dolly') expect([value > 0, label, panel], where).toEqual([true, 0, 0])
              if (depth === 'focus') expect([label < 0, value], where).toEqual([true, 0])
            } else {
              const arc = one(list.items, 'arc', where)
              const track = one(list.items, 'track', where)
              if (depth === 'parallax') {
                expect(value, where).toBeGreaterThan(arc)
                expect(arc, where).toBeGreaterThan(track)
              }
              if (depth === 'dolly') expect([value > 0, arc, track], where).toEqual([true, 0, 0])
              if (depth === 'focus') expect([label < 0, value, arc, track], where).toEqual([true, 0, 0, 0])
            }
          }
        }
      }
    }
  })

  it('the figures are §6.16’s proposals (one line each to change at the look rating)', () => {
    expect([DEPTH_TILT_FROM, DEPTH_PARALLAX_YAW_FROM, DEPTH_DOLLY_FROM, DEPTH_FOCUS_BLUR_PX]).toEqual([24, -8, -0.12, 10])
    expect(DEPTH_PLANES.counter.parallax).toEqual({ panel: 0, label: 0.02, value: 0.05 })
    expect(DEPTH_PLANES.ring.parallax).toMatchObject({ track: 0, arc: 0.03, value: 0.05 })
    expect(DEPTH_PLANES.counter.dolly.value).toBe(0.05)
    expect(DEPTH_PLANES.ring.dolly.value).toBe(0.05)
    expect(DEPTH_PLANES.counter.focus.label).toBe(-0.02)
    expect(DEPTH_PLANES.ring.focus.label).toBe(-0.02)
  })

  it('the focus variant: the label plane at −0.02 reads DEPTH_FOCUS_BLUR_PX at the start and exactly 0 on the beat; the value’s plane is in focus', () => {
    const counter = fixtures.find((f) => f.id === 'counter-en')!.spec
    const s: GraphicSpec = { ...plain(counter), depth: 'focus' }
    const st = resolveGraphicStyle('clean')
    const first = drawListAt(s, st, 0, FPS, SIZE, fake)
    const label = first.items.find((i) => i.id === 'label')!
    const value = first.items.find((i) => i.id === 'value')!
    expect(label.z).toBe(-0.02)
    expect(value.z).toBe(0)
    // Frame 0 is t = 0, where `progress` adds its 1e-6 s: 10 px less a hair.
    expect(focusRadius(first.camera, label.z!)).toBeCloseTo(DEPTH_FOCUS_BLUR_PX, 3)
    expect(focusRadius(first.camera, value.z!)).toBe(0)
    const beat = Math.ceil(s.beats[0] * FPS - 1e-6)
    expect(focusRadius(drawListAt(s, st, beat - 1, FPS, SIZE, fake).camera, -0.02)).toBeGreaterThan(0)
    expect(focusRadius(drawListAt(s, st, beat, FPS, SIZE, fake).camera, -0.02)).toBe(0)
  })

  it('the hero’s glow: only for the hero under a style with glow, on the counter’s value or the ring’s arc, at the style’s radius in frame px and strength, in palette.accent, naming an item the list carries on every frame', () => {
    for (const f of fixtures) {
      const template = f.spec.data.template as 'counter' | 'ring'
      for (const st of GRAPHIC_STYLES) {
        for (const variant of [{ hero: true as const, depth: 'tilt' as const }, { hero: true as const }, { depth: 'tilt' as const }, {}]) {
          const s: GraphicSpec = { ...plain(f.spec), ...variant }
          for (const frame of framesOf(s)) {
            const list = drawListAt(s, st, frame, FPS, SIZE, fake)
            const where = `${f.id} ${JSON.stringify(variant)} ${st.id} @${frame}`
            if (!('hero' in variant) || !st.glow) {
              expect(list.glow, where).toBeUndefined()
              continue
            }
            expect(list.glow, where).toEqual([
              { item: template === 'counter' ? 'value' : 'arc', radius: st.glow.radius * Math.min(SIZE.width, SIZE.height), strength: st.glow.strength, color: st.palette.accent }
            ])
            expect(glowBatches(list).length, where).toBeLessThanOrEqual(MAX_GLOW_BATCHES)
            expect(glowItemsOf(list.items, list.glow!).length, where).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it('depth is honoured only where TemplateDef.threeD is true, and Flat or none is the flat list', () => {
    expect(depthOf({ depth: 'tilt', data: { template: 'counter', value: '1', label: 'a' } })).toBe('tilt')
    expect(depthOf({ depth: 'flat', data: { template: 'counter', value: '1', label: 'a' } })).toBeNull()
    expect(depthOf({ data: { template: 'ring', value: '1', label: 'a' } })).toBeNull()
    expect(depthOf({ depth: 'tilt', data: { template: 'keyword', words: 'a', lit: 0 } })).toBeNull()
    const counter = plain(fixtures.find((f) => f.id === 'counter-en')!.spec)
    for (const frame of [0, 5, 20]) {
      expect(drawListAt({ ...counter, depth: 'flat' }, style(), frame, FPS, SIZE, fake)).toEqual(drawListAt(counter, style(), frame, FPS, SIZE, fake))
    }
  })
})

/*
 * Step 6's three in depth (docs/CLIPS.md §9, "The 3D templates"; §6.16; the
 * 3D templates' piece 3): `timeline`, `before-after` and `versus`, every
 * specs.json fixture of theirs (English today; the owner's Hindi and Telugu
 * join by membership), under every style, at both shapes, with each depth,
 * against the flat variant (the same spec with no depth), on every frame.
 */
describe('graphicDrawList: the depth variants of timeline, before-after and versus (§9, §6.16)', () => {
  const STEP_SIX = ['timeline', 'before-after', 'versus'] as const
  type StepSix = (typeof STEP_SIX)[number]
  const fixtures = (
    JSON.parse(readFileSync(new URL('./fixtures/graphics/specs.json', import.meta.url), 'utf8')) as { specs: { id: string; spec: GraphicSpec }[] }
  ).specs.filter((f) => (STEP_SIX as readonly string[]).includes(f.spec.data.template))
  const fake: TextMeasure = (t, look) => ({ width: t.length * look.px * 0.55, ascent: look.px * 0.8, descent: look.px * 0.2 })
  const SHAPES = [SIZE, { width: SIZE.height, height: SIZE.width }]
  const plain = (s: GraphicSpec): GraphicSpec => {
    const { depth: _depth, hero: _hero, ...rest } = s
    return rest
  }
  const framesOf = (s: GraphicSpec): number[] => Array.from({ length: Math.max(1, Math.round(s.seconds * FPS)) }, (_, f) => f)
  const unplaned = (item: DrawItem): DrawItem => {
    const { z: _z, ...rest } = item
    return rest as DrawItem
  }
  const byId = (items: readonly DrawItem[]): DrawItem[] => [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const textsOf = (list: DrawList): Record<string, { text: string; look: TextLook }> =>
    Object.fromEntries(list.items.filter((i): i is TextItem => i.kind === 'text').map((i) => [i.id, { text: i.text, look: i.look }]))
  const lastBeatOf = (s: GraphicSpec): number => Math.max(0, ...s.beats)
  /** A field's id from an item's, worked here apart from depth.ts: every trailing number off (`when-2-1` is `when`, `before-label-1` is `before-label`). */
  const field = (id: string): string => id.replace(/(?:-\d+)+$/u, '')

  it('reads at least the three English fixtures, and the three are depth templates whose threeD is true', () => {
    const ids = fixtures.map((f) => f.id)
    for (const id of ['timeline-en', 'before-after-en', 'versus-en']) expect(ids, id).toContain(id)
    for (const t of STEP_SIX) {
      expect(DEPTH_TEMPLATES, t).toContain(t)
      expect(depthOf({ depth: 'parallax', data: fixtures.find((f) => f.spec.data.template === t)!.spec.data }), t).toBe('parallax')
    }
  })

  it('every frame’s text items (text and look) equal the flat variant’s, and its every item but for z; from the last beat every camera field and the focus blur are exactly 0; at most MAX_PLANES distinct z; each move off flat on some frame', () => {
    for (const f of fixtures) {
      for (const size of SHAPES) {
        for (const st of GRAPHIC_STYLES) {
          const flatSpec = plain(f.spec)
          const settledFrom = Math.ceil(lastBeatOf(flatSpec) * FPS - 1e-6)
          for (const depth of DEPTH_MOVES) {
            const s: GraphicSpec = { ...flatSpec, depth }
            let moved = false
            for (const frame of framesOf(s)) {
              const where = `${f.id} ${size.width}x${size.height} ${depth} ${st.id} @${frame}`
              const twin = drawListAt(flatSpec, st, frame, FPS, size, fake)
              const list = drawListAt(s, st, frame, FPS, size, fake)
              expect(textsOf(list), where).toEqual(textsOf(twin))
              expect(byId(list.items.map(unplaned)), where).toEqual(byId(twin.items))
              const zs = list.items.filter((i) => i.kind !== 'dim').map((i) => i.z ?? 0)
              expect(zs, where).toEqual([...zs].sort((a, b) => a - b))
              expect(new Set(zs).size, where).toBeLessThanOrEqual(MAX_PLANES)
              if (depth === 'tilt') expect(list.items.some((i) => i.z !== undefined), where).toBe(false)
              expect(list.camera, where).toBeDefined()
              const camera = list.camera!
              if (frame >= settledFrom) {
                expect(camera.tilt, where).toBe(0)
                expect(camera.yaw, where).toBe(0)
                expect(camera.dolly, where).toBe(0)
                if (camera.focus) expect(camera.focus.px, where).toBe(0)
                expect(isFlat(list), where).toBe(true)
                // At rest, the flat variant's own list in its own order: route one's picture.
                expect(list.items, where).toEqual(twin.items)
              } else if (!cameraIsFlat(camera)) moved = true
            }
            expect(moved, `${f.id} ${size.width}x${size.height} ${depth} ${st.id} never moves`).toBe(true)
          }
        }
      }
    }
  })

  it('a variant bakes no more frames than its flat twin, and its last moving frame is the twin’s own list, route one, no z', () => {
    for (const f of fixtures) {
      for (const size of SHAPES) {
        for (const st of GRAPHIC_STYLES) {
          const flatSpec = plain(f.spec)
          const total = Math.max(1, Math.round(flatSpec.seconds * FPS))
          const moving = graphicMovingFrames(flatSpec, st, FPS, total)
          for (const depth of DEPTH_MOVES) {
            const where = `${f.id} ${size.width}x${size.height} ${depth} ${st.id}`
            const s: GraphicSpec = { ...flatSpec, depth }
            expect(graphicMovingFrames(s, st, FPS, total), where).toBe(moving)
            const last = drawListAt(s, st, moving - 1, FPS, size, fake)
            expect(compositorRoute(last), where).toBe('flat')
            expect(last.items, where).toEqual(drawListAt(flatSpec, st, moving - 1, FPS, size, fake).items)
            expect(last.items.length, where).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it('while it moves, every item sits on its DEPTH_PLANES row (every field named, none falling back to 0 unlisted); parallax has three planes, dolly and focus two; values before labels before backing; no backing nearer than a word it lies under', () => {
    const SHAPE_IDS = /panel|reveal/u
    const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    const planesSeen: Record<string, Set<number>> = {}
    for (const f of fixtures) {
      const template = f.spec.data.template as StepSix
      for (const size of SHAPES) {
        for (const st of GRAPHIC_STYLES) {
          for (const depth of ['parallax', 'dolly', 'focus'] as const) {
            const table = DEPTH_PLANES[template][depth]
            let read = 0
            for (const frame of framesOf(f.spec)) {
              const list = drawListAt({ ...plain(f.spec), depth }, st, frame, FPS, size, fake)
              if (cameraIsFlat(list.camera)) continue
              read++
              const where = `${f.id} ${size.width}x${size.height} ${depth} ${st.id} @${frame}`
              for (const item of list.items) {
                if (item.kind === 'dim') continue
                expect(Object.keys(table), `${where} ${item.id}: its field is in the table`).toContain(field(item.id))
                expect(item.z, `${where} ${item.id}`).toBe(table[field(item.id)])
                ;(planesSeen[`${template} ${depth}`] ??= new Set()).add(item.z!)
              }
              const words = list.items.filter((i): i is TextItem => i.kind === 'text')
              const valueZ = words.filter((w) => /value|when/u.test(field(w.id))).map((w) => w.z!)
              const labelZ = words.filter((w) => /label/u.test(field(w.id))).map((w) => w.z!)
              for (const v of valueZ) for (const l of labelZ) expect(v, `${where}: a value or when behind a label`).toBeGreaterThanOrEqual(l)
              for (const b of list.items.filter((i) => i.kind === 'shape' && SHAPE_IDS.test(i.id))) {
                if (b.kind !== 'shape') continue
                for (const w of words) if (overlaps(b.box, w.box)) expect(b.z!, `${where}: ${b.id} nearer than ${w.id} over it`).toBeLessThanOrEqual(w.z!)
              }
            }
            expect(read, `${f.id} ${depth} ${st.id}: frames off flat read`).toBeGreaterThan(0)
          }
        }
      }
    }
    const count = (k: string): number => planesSeen[k]?.size ?? 0
    for (const t of STEP_SIX) {
      expect(count(`${t} parallax`), t).toBe(3)
      expect(count(`${t} dolly`), t).toBe(2)
      expect(count(`${t} focus`), t).toBe(2)
      // Focus: the values on the plane in focus, the labels behind it.
      expect(Object.entries(DEPTH_PLANES[t].focus).filter(([k]) => /value|when/u.test(k)).every(([, z]) => z === 0), t).toBe(true)
      expect(Object.entries(DEPTH_PLANES[t].focus).filter(([k]) => /label/u.test(k)).every(([, z]) => z === DEPTH_FOCUS_LABEL_Z[t]), t).toBe(true)
    }
  })

  it('without WebGL (painter A, flatItems, camera and z ignored) each variant draws its flat twin’s items on every frame, the settled one in the twin’s order', () => {
    for (const f of fixtures) {
      for (const size of SHAPES) {
        for (const st of GRAPHIC_STYLES) {
          const flatSpec = plain(f.spec)
          const total = Math.max(1, Math.round(flatSpec.seconds * FPS))
          const moving = graphicMovingFrames(flatSpec, st, FPS, total)
          for (const depth of DEPTH_MOVES) {
            for (const frame of framesOf(flatSpec)) {
              const where = `${f.id} ${size.width}x${size.height} ${depth} ${st.id} @${frame}`
              const twin = drawListAt(flatSpec, st, frame, FPS, size, fake).items
              const painted = flatItems(drawListAt({ ...flatSpec, depth }, st, frame, FPS, size, fake)).map(unplaned)
              expect(byId(painted), where).toEqual(byId(twin))
              if (frame >= moving - 1) expect(painted, where).toEqual(twin)
            }
          }
        }
      }
    }
  })

  it('the focus variant: the label plane reads DEPTH_FOCUS_BLUR_PX at the start, above 0 the frame before the LAST beat and exactly 0 on it; the values are in focus throughout', () => {
    const st = resolveGraphicStyle('clean')
    for (const t of STEP_SIX) {
      const f = fixtures.find((x) => x.id === `${t}-en`)!
      const s: GraphicSpec = { ...plain(f.spec), depth: 'focus' }
      const first = drawListAt(s, st, 0, FPS, SIZE, fake)
      expect(focusRadius(first.camera, DEPTH_FOCUS_LABEL_Z[t]), t).toBeCloseTo(DEPTH_FOCUS_BLUR_PX, 3)
      expect(focusRadius(first.camera, 0), t).toBe(0)
      const last = Math.ceil(lastBeatOf(s) * FPS - 1e-6)
      expect(last, t).toBeGreaterThan(Math.ceil(s.beats[0] * FPS - 1e-6))
      expect(focusRadius(drawListAt(s, st, last - 1, FPS, SIZE, fake).camera, DEPTH_FOCUS_LABEL_Z[t]), t).toBeGreaterThan(0)
      expect(focusRadius(drawListAt(s, st, last, FPS, SIZE, fake).camera, DEPTH_FOCUS_LABEL_Z[t]), t).toBe(0)
    }
  })

  it('no hero: a `hero` on one of the three (a project file may carry one) glows nothing under any style, and heroGlow names no item for them', () => {
    const neon = resolveGraphicStyle('neon')
    for (const t of STEP_SIX) {
      const spec = fixtures.find((x) => x.id === `${t}-en`)!.spec
      expect(heroGlow(t, { hero: true, data: spec.data }, neon, SIZE), t).toBeUndefined()
      for (const st of GRAPHIC_STYLES) {
        for (const frame of [0, 10, 60]) expect(drawListAt({ ...plain(spec), depth: 'tilt', hero: true }, st, frame, FPS, SIZE, fake).glow, `${t} ${st.id} @${frame}`).toBeUndefined()
      }
    }
  })
})

/*
 * §6.16's edge sweep (phase 3's piece 5): on the screen card only, under a
 * style with `glow` only, from the landing on, one loop of EDGE_SWEEP_S, a
 * span of EDGE_SWEEP_SPAN of the bezel's perimeter advancing linearly, split
 * in two while it crosses the path's start, with one GlowRequest naming it
 * and nothing else; then gone, so the frame tpad holds is the plain card.
 */
describe('graphicDrawList: the screen card’s edge sweep (§6.16)', () => {
  const fake: TextMeasure = (t, look) => ({ width: t.length * look.px * 0.55, ascent: look.px * 0.8, descent: look.px * 0.2 })
  const BOX: Rect = { x: 0, y: 656.25, width: 1080, height: 607.5 }
  const RATES = [24, 25, 30, 60]
  const card = (move: 'tilt-in' | 'pull-back' = 'tilt-in'): GraphicSpec => ({
    data: { template: 'screen-card', clipId: 'rec', move },
    seconds: 60,
    beats: [1],
    place: { auto: true, third: 'middle' },
    seed: 1,
    version: 1
  })
  const targetsAt = (fps: number) => (frame: number): GraphicTargets => ({ screen: { box: BOX, file: frame <= landingFrame(fps) ? `/f/${frame}.png` : null } })
  const listAt = (st: GraphicStyle, frame: number, fps = FPS, move: 'tilt-in' | 'pull-back' = 'tilt-in'): DrawList =>
    drawListAt(card(move), st, frame, fps, SIZE, fake, targetsAt(fps)(frame))
  /** Every stroke that is not the bezel: the sweep's. */
  const sweepOf = (list: DrawList): StrokeItem[] => list.items.filter((i): i is StrokeItem => i.kind === 'stroke' && i.id !== 'bezel')
  const GLOWING = GRAPHIC_STYLES.filter((st) => st.glow)
  const PLAIN = GRAPHIC_STYLES.filter((st) => !st.glow)

  it('its figures: a 6 s loop, a span of 0.12 of the perimeter, from the path’s start; neon and energetic carry glow, and the loop is round(EDGE_SWEEP_S × fps) frames', () => {
    expect(EDGE_SWEEP_S).toBe(6)
    expect(EDGE_SWEEP_SPAN).toBe(0.12)
    expect(EDGE_SWEEP_START).toBe(0)
    expect(EDGE_SWEEP_ID).toBe('sweep')
    const glowing = GLOWING.map((st) => st.id)
    expect(glowing).toContain('neon')
    expect(glowing).toContain('energetic')
    expect(PLAIN.map((st) => st.id)).toContain('clean')
    expect(RATES.map(edgeSweepFrames)).toEqual([144, 150, 180, 360])
  })

  it('is absent under every style with no glow, on every frame of a 60 s card: the bezel the only stroke, no glow', () => {
    for (const st of PLAIN) {
      for (let frame = 0; frame < 60 * FPS; frame++) {
        const list = listAt(st, frame)
        expect(sweepOf(list), `${st.id} @${frame}`).toEqual([])
        expect(list.glow, `${st.id} @${frame}`).toBeUndefined()
      }
    }
  })

  it('under a glowing style: none up to the landing; on L + 1 .. L + N − 1 a span of 0.12 of the perimeter, one stroke or two summing to it, its head (f − L) / N of the way round, on the bezel’s path in the accent; then none, at every rate', () => {
    for (const fps of RATES) {
      const L = landingFrame(fps)
      const N = edgeSweepFrames(fps)
      for (const st of GLOWING) {
        for (const move of ['tilt-in', 'pull-back'] as const) {
          let split = 0
          for (let frame = 0; frame <= L + N + 2; frame++) {
            const list = listAt(st, frame, fps, move)
            const sweep = sweepOf(list)
            const where = `${st.id} ${move} @${frame} of L ${L}, N ${N} at ${fps}`
            if (frame <= L || frame >= L + N) {
              // Never before the landing (the move draws), never on L + N or after (the held card).
              expect(sweep, where).toEqual([])
              if (frame > L) expect(list.glow, where).toBeUndefined()
              continue
            }
            expect(sweep.length === 1 || sweep.length === 2, where).toBe(true)
            for (const s of sweep) {
              expect(s, where).toMatchObject({ d: bezelPath(BOX), width: bezelWidth(SIZE), color: st.palette.accent, cap: 'square', join: 'miter', opacity: 1 })
              expect(s.from, where).toBeGreaterThanOrEqual(0)
              expect(s.to, where).toBeLessThanOrEqual(1)
              expect(s.to, where).toBeGreaterThan(s.from)
            }
            const length = sweep.reduce((sum, s) => sum + (s.to - s.from), 0)
            expect(length, where).toBeCloseTo(EDGE_SWEEP_SPAN, 12)
            const head = sweep[sweep.length - 1].to
            expect(head, where).toBeCloseTo((frame - L) / N, 12)
            if (sweep.length === 2) {
              split++
              // Crossing the path's start: the tail runs to the path's end, the head from its start; no gap, no overlap.
              expect(sweep.map((s) => s.id), where).toEqual(['sweep-1', 'sweep-2'])
              expect(sweep[0].to, where).toBe(1)
              expect(sweep[1].from, where).toBe(0)
            } else {
              expect(sweep[0].id, where).toBe('sweep')
              expect(sweep[0].from, where).toBeCloseTo(head - EDGE_SWEEP_SPAN, 12)
            }
            // Split exactly while the tail would be behind the start.
            expect(sweep.length === 2, where).toBe((frame - L) / N < EDGE_SWEEP_SPAN)
          }
          // It crosses the start on its first frames: frame L + 1 is one of them.
          expect(split, `${st.id} ${move} at ${fps}`).toBeGreaterThan(0)
          expect(sweepOf(listAt(st, L + 1, fps, move)).length).toBe(2)
        }
      }
    }
  })

  it('its glow: one request naming the sweep, at the style’s strength and its radius in frame pixels, in the accent; it names the sweep’s strokes, one or both pieces, and nothing else the list carries (never the bezel)', () => {
    const L = landingFrame(FPS)
    const N = edgeSweepFrames(FPS)
    for (const st of GLOWING) {
      for (let frame = L + 1; frame < L + N; frame++) {
        const list = listAt(st, frame)
        const where = `${st.id} @${frame}`
        expect(list.glow, where).toEqual([{ item: 'sweep', radius: st.glow!.radius * Math.min(SIZE.width, SIZE.height), strength: st.glow!.strength, color: st.palette.accent }])
        expect(glowItemsOf(list.items, list.glow!).map((i) => i.id), where).toEqual(sweepOf(list).map((s) => s.id))
        expect(glowItemsOf(list.items, list.glow!).some((i) => i.id === 'bezel'), where).toBe(false)
        expect(glowBatches(list).length, where).toBe(1)
        expect(glowBatches(list).length, where).toBeLessThanOrEqual(MAX_GLOW_BATCHES)
        // Route two: a flat camera (none) with a glow.
        expect(list.camera, where).toBeUndefined()
        expect(compositorRoute(list), where).toBe('glow')
        // Without WebGL painter A draws route one's order, the sweep's strokes among them, its glow ignored.
        expect(flatItems(list).map((i) => i.id), where).toEqual(list.items.map((i) => i.id))
      }
    }
  })

  it('on a landscape frame its glow’s radius and its strokes’ width follow the SHORT side (the height), not the width', () => {
    // 1920 × 1080: the short side is the height, so a radius or width read off the width would be 16/9 too large.
    const LAND = { width: 1920, height: 1080 }
    const box: Rect = { x: 420, y: 90, width: 1080, height: 900 }
    const L = landingFrame(FPS)
    const N = edgeSweepFrames(FPS)
    expect(bezelWidth(LAND)).toBe(4)
    for (const st of GLOWING) {
      for (const frame of [L + 1, L + Math.round(N / 2), L + N - 1]) {
        const list = drawListAt(card(), st, frame, FPS, LAND, fake, { screen: { box, file: null } })
        const where = `${st.id} @${frame} on 1920×1080`
        expect(list.glow, where).toEqual([{ item: 'sweep', radius: st.glow!.radius * 1080, strength: st.glow!.strength, color: st.palette.accent }])
        const sweep = sweepOf(list)
        expect(sweep.length, where).toBeGreaterThan(0)
        for (const s of sweep) {
          expect(s.width, where).toBe(4)
          expect(s.d, where).toBe(bezelPath(box))
        }
      }
    }
  })

  it('the last baked frame, L + N (graphicMovingFrames − 1), is the plain held card: exactly the frame the hold shows, the dim with its hole and the bezel, no sweep and no glow, route one', () => {
    for (const fps of RATES) {
      const L = landingFrame(fps)
      const N = edgeSweepFrames(fps)
      for (const st of GLOWING) {
        const moving = graphicMovingFrames(card(), st, fps, 60 * fps)
        expect(moving, `${st.id} at ${fps}`).toBe(L + 1 + N)
        const last = listAt(st, moving - 1, fps)
        const where = `${st.id} @${moving - 1} at ${fps}`
        expect(last.items.map((i) => i.id), where).toEqual(['dim', 'bezel'])
        expect(last.glow, where).toBeUndefined()
        expect(isFlat(last), where).toBe(true)
        expect(needsCompositor(last), where).toBe(false)
        // The frame tpad holds is every later frame's list exactly.
        expect(listAt(st, 60 * fps - 1, fps), where).toEqual(last)
        // And the frame before it still carries the sweep.
        expect(sweepOf(listAt(st, moving - 2, fps)).length, where).toBeGreaterThan(0)
      }
    }
  })

  it('no other template draws a sweep: counter and ring, plain, with each depth or as a hero, under every style, carry no sweep stroke, and their glow names only the hero’s value or arc', () => {
    const fixtures = (
      JSON.parse(readFileSync(new URL('./fixtures/graphics/specs.json', import.meta.url), 'utf8')) as { specs: { id: string; spec: GraphicSpec }[] }
    ).specs.filter((f) => DRAWERS[f.spec.data.template] !== undefined)
    let read = 0
    for (const f of fixtures) {
      for (const variant of [{}, { hero: true as const }, { depth: 'tilt' as const, hero: true as const }]) {
        const s: GraphicSpec = { ...f.spec, ...variant }
        for (const st of GLOWING) {
          const total = Math.max(1, Math.round(s.seconds * FPS))
          for (let frame = 0; frame < total; frame += 2) {
            const list = drawListAt(s, st, frame, FPS, SIZE, fake, {})
            const where = `${f.id} ${JSON.stringify(variant)} ${st.id} @${frame}`
            read++
            expect(list.items.some((i) => i.id === 'sweep' || i.id.startsWith('sweep-')), where).toBe(false)
            for (const request of list.glow ?? []) expect(['value', 'arc'], where).toContain(request.item)
          }
        }
      }
    }
    expect(read).toBeGreaterThan(0)
  })
})

/* -------------------------------------------------------------- graphicBox */

/** The rise entrance over DURATIONS.entrance from t = 0, the item's own height below its place at p = 0 (as a template multiplies `dy`). */
function risingText(t: number, height: number): TextItem {
  const p = progress(t, 0, DURATIONS.entrance, 'expo-out')
  const e = entrance('rise', p)
  return text('label', 'forty', rect(400, 1000 + e.dy * height, 110, height), { opacity: e.opacity })
}

/** A seeded random list: every kind, moving with the frame, some transformed. */
function randomDrawer(seed: number): Drawer {
  return (_spec, _style, clock, size) => {
    const random = seeded(seed)
    const n = 1 + Math.floor(random() * 6)
    const items: DrawItem[] = [risingText(clock.t, 47)]
    for (let i = 0; i < n; i++) {
      const kind = Math.floor(random() * 5)
      const x = random() * size.width
      const y = random() * size.height + clock.t * 50
      const w = 1 + random() * 300
      const h = 1 + random() * 300
      const transform = random() < 0.5 ? { x: random() * 20, y: random() * 20, scale: 0.5 + random(), rotate: random() * 360 } : undefined
      const base = transform ? { transform } : {}
      if (kind === 0) items.push(shape(`s${i}`, rect(x, y, w, h), { ...base, stroke: { color: '#fff', width: random() * 10 } }))
      else if (kind === 1) items.push(text(`t${i}`, 'ab', rect(x, y, w, 47), base))
      else if (kind === 2)
        items.push(stroke(`k${i}`, `M${x} ${y} L${x + w} ${y + h}`, { ...base, heads: { end: { size: 10 + random() * 30, grow: 1 } } }))
      else if (kind === 3) items.push({ kind: 'image', id: `i${i}`, opacity: 1, src: 'a.png', box: rect(x, y, w, h), fit: 'cover', ...base })
      else items.push({ kind: 'group', id: `g${i}`, opacity: 1, children: [shape(`c${i}`, rect(x, y, w, h))], ...base })
    }
    return { items }
  }
}

describe('graphicDrawList: graphicBox', () => {
  it("holds every frame's itemBounds, clipped to the frame, and is even on all four numbers (200 seeded lists)", () => {
    let checked = 0
    for (let seed = 1; seed <= 200; seed++) {
      const drawer = randomDrawer(seed)
      const total = 12
      const box = graphicBox(spec(seed), style(), FPS, total, SIZE, measure, () => ({}), drawer)
      expect(box, `seed ${seed}`).not.toBeNull()
      const b = box as Rect
      for (const v of [b.x, b.y, b.width, b.height]) expect(v % 2, `seed ${seed}: even`).toBe(0)
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.width).toBeGreaterThanOrEqual(2)
      expect(b.height).toBeGreaterThanOrEqual(2)
      expect(b.x + b.width).toBeLessThanOrEqual(SIZE.width)
      expect(b.y + b.height).toBeLessThanOrEqual(SIZE.height)
      for (let frame = 0; frame < total; frame++) {
        const list = drawListAt(spec(seed), style(), frame, FPS, SIZE, measure, undefined, drawer)
        for (const item of list.items) {
          const r = itemBounds(item, SIZE, measure)
          if (!r) continue
          const x0 = Math.max(0, r.x), x1 = Math.min(SIZE.width, r.x + r.width)
          const y0 = Math.max(0, r.y), y1 = Math.min(SIZE.height, r.y + r.height)
          if (x0 >= x1 || y0 >= y1) continue // wholly outside the frame
          const where = `seed ${seed}, frame ${frame}, ${item.id}`
          expect(x0, where).toBeGreaterThanOrEqual(b.x)
          expect(y0, where).toBeGreaterThanOrEqual(b.y)
          expect(x1, where).toBeLessThanOrEqual(b.x + b.width)
          expect(y1, where).toBeLessThanOrEqual(b.y + b.height)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(2000)
  })

  it("an entrance that rises from below its place is inside the box, with the settled frame", () => {
    const drawer: Drawer = (_s, _st, clock) => ({ items: [risingText(clock.t, 200)] })
    const total = Math.round(2 * FPS)
    const box = graphicBox(spec(), style(), FPS, total, SIZE, measure, () => ({}), drawer) as Rect
    const first = itemBounds(risingText(0, 200), SIZE, measure) as Rect
    const settled = itemBounds(risingText((total - 1) / FPS, 200), SIZE, measure) as Rect
    // Frame 0 sits half its height below the settled place (less progress's 1e-6 s allowance); both are inside the box.
    expect(first.y - settled.y).toBeCloseTo(100, 1)
    expect(box.y).toBeLessThanOrEqual(settled.y)
    expect(box.y + box.height).toBeGreaterThanOrEqual(first.y + first.height)
    // And the box is no bigger than those two frames' union, snapped, with the two rows below it for the exit geq: the frames between lie between them.
    expect(box.y).toBeGreaterThanOrEqual(settled.y - 2)
    expect(box.y + box.height).toBeLessThanOrEqual(first.y + first.height + 4)
  })

  it('is null with no items, no drawer or no frames; a dim makes it the whole frame; it clamps to the frame and is at least 2×2', () => {
    expect(graphicBox(spec(), style(), FPS, 10, SIZE, measure, () => ({}), () => ({ items: [] }))).toBeNull()
    // A template with no drawer (`source` is steps 5/6's): the default DRAWERS row is absent.
    expect(DRAWERS.source).toBeUndefined()
    expect(graphicBox(spec(1, 'source'), style(), FPS, 10, SIZE, measure, () => ({}))).toBeNull()
    expect(graphicBox(spec(), style(), FPS, 0, SIZE, measure, () => ({}), () => ({ items: [shape('s', rect(0, 0, 10, 10))] }))).toBeNull()
    expect(graphicBox(spec(), style(), FPS, 1, SIZE, measure, () => ({}), () => ({ items: [dim('d', rect(1, 1, 1, 1))] }))).toEqual(
      rect(0, 0, SIZE.width, SIZE.height)
    )
    const off = graphicBox(spec(), style(), FPS, 1, SIZE, measure, () => ({}), () => ({ items: [shape('s', rect(-50, -50, 100, 100))] }))
    expect(off).toEqual(rect(0, 0, 52, 52))
    const past = graphicBox(spec(), style(), FPS, 1, SIZE, measure, () => ({}), () => ({ items: [shape('s', rect(1000, 1900, 300, 300))] }))
    expect(past).toEqual(rect(1000, 1900, 80, 20))
    const tiny = graphicBox(spec(), style(), FPS, 1, SIZE, measure, () => ({}), () => ({ items: [shape('s', rect(10.3, 10.3, 0.5, 0.5))] }))
    expect(tiny).toEqual(rect(10, 10, 4, 4))
    // A sliver inside the far edge is kept, at the 2×2 minimum.
    const edge = graphicBox(spec(), style(), FPS, 1, SIZE, measure, () => ({}), () => ({ items: [shape('s', rect(1079.5, 1919.5, 0.5, 0.5))] }))
    expect(edge).toEqual(rect(1078, 1918, 2, 2))
    // Odd edges snap outward: 11..21 becomes 10..22, then two more on the right and at the bottom: 10..24.
    const odd = graphicBox(spec(), style(), FPS, 1, SIZE, measure, () => ({}), () => ({ items: [shape('s', rect(11, 11, 10, 10))] }))
    expect(odd).toEqual(rect(10, 10, 14, 14))
  })

  it('is null when no frame has ink inside the frame: an item of no area, or one wholly outside it, never a sliver at the edge', () => {
    const boxOf = (items: DrawItem[]): Rect | null => graphicBox(spec(), style(), FPS, 1, SIZE, measure, () => ({}), () => ({ items }))
    expect(boxOf([shape('s', rect(10, 10, 0, 0))])).toBeNull()
    expect(boxOf([shape('s', rect(1080, 1920, 0, 0))])).toBeNull()
    // Off every side, touching the edge or past it.
    expect(boxOf([shape('s', rect(1080, 100, 50, 50))])).toBeNull()
    expect(boxOf([shape('s', rect(2000, 100, 50, 50))])).toBeNull()
    expect(boxOf([shape('s', rect(-50, 100, 50, 50))])).toBeNull()
    expect(boxOf([shape('s', rect(-500, 100, 50, 50))])).toBeNull()
    expect(boxOf([shape('s', rect(100, 1920, 50, 50))])).toBeNull()
    expect(boxOf([shape('s', rect(100, -50, 50, 50))])).toBeNull()
    expect(boxOf([{ kind: 'image', id: 'i', opacity: 1, src: 'a.png', box: rect(-10, -10, 10, 10), fit: 'cover' }])).toBeNull()
    // Its reach can bring it in: a shadow of blur 10 on a shape just past the right edge inks 15 px of the frame.
    expect(boxOf([shape('s', rect(1080, 100, 50, 50), { shadow: { blur: 10, dy: 0, color: '#000', opacity: 1 } })])).toEqual(rect(1064, 84, 16, 84))
    // One item outside beside one inside: the box is the inside one's (with its two columns and rows for the exit geq).
    expect(boxOf([shape('a', rect(2000, 100, 50, 50)), shape('b', rect(100, 100, 50, 50))])).toEqual(rect(100, 100, 52, 52))
    // A non-finite bound is a template bug and throws, never a NaN box for a bake canvas.
    expect(() => boxOf([shape('s', rect(100, 100, 50, 50), { transform: { x: 0, y: 0, scale: 1, rotate: NaN } })])).toThrow(/non-finite/)
    expect(() => boxOf([text('t', 'x', rect(100, 100, 50, 47), { look: look(NaN) })])).toThrow(/non-finite/)
  })
  it("keeps two transparent columns past the ink's right edge and two rows below its bottom, for the exit geq's w − 2 / h − 2 copy; none added on the left or top; the frame's edge clamps them", () => {
    const boxOf = (r: Rect): Rect | null => graphicBox(spec(), style(), FPS, 1, SIZE, measure, () => ({}), () => ({ items: [shape('s', r)] }))
    // Ink on even edges 100..150: the box's last two columns (150, 151) and rows are past it, the left and top flush.
    for (const [r, want] of [
      [rect(100, 200, 50, 60), rect(100, 200, 52, 62)],
      // Odd edges 101..151 snap to 100..152, then 154: columns 152 and 153 are clear, and 151's half-column snapped over.
      [rect(101, 201, 50, 60), rect(100, 200, 54, 64)],
      // Fractional: 100.5..149.5 snaps to 100..150, then 152.
      [rect(100.5, 200.5, 49, 59), rect(100, 200, 52, 62)]
    ] as const) {
      const box = boxOf(r) as Rect
      expect(box, JSON.stringify(r)).toEqual(want)
      // Hand-checked against the rule, not only the numbers: the last two columns and rows hold no ink.
      expect(box.x + box.width - 2, `${JSON.stringify(r)}: the column geq copies from`).toBeGreaterThanOrEqual(r.x + r.width)
      expect(box.y + box.height - 2, `${JSON.stringify(r)}: the row geq copies from`).toBeGreaterThanOrEqual(r.y + r.height)
      expect(box.x).toBe(2 * Math.floor(r.x / 2))
      expect(box.y).toBe(2 * Math.floor(r.y / 2))
    }
    // At the frame's far edge the frame clamps first: both routes' streams end there, and geq copies the same pixels on each.
    expect(boxOf(rect(1000, 1850, 79, 69))).toEqual(rect(1000, 1850, 80, 70))
    expect(boxOf(rect(1000, 1850, 78, 68))).toEqual(rect(1000, 1850, 80, 70))
  })
})

/* -------------------------------------------------------------- itemBounds */

describe('graphicDrawList: itemBounds', () => {
  it("a text item's box widened by its style's reach, and by what its glyphs rise or fall past the line", () => {
    const box = rect(100, 200, 110, 47)
    const reach = textInkReach('clean', 40)
    // `clean` is a soft shadow: blur 0.16 (3σ = 0.24) each side and dy 0.06 below, all of it in the frame's space (a canvas shadow ignores the transform).
    expect(reach.device.left).toBeCloseTo(0.24 * 40, 9)
    expect(reach.device.bottom).toBeCloseTo(0.24 * 40 + 0.06 * 40, 9)
    expect(reach.device.top).toBeCloseTo(0.24 * 40, 9)
    expect(reach.user).toEqual(NONE)
    expect(itemBounds(text('t', 'forty', box), SIZE, measure)).toEqual({
      x: 100 - reach.device.left,
      y: 200 - reach.device.top,
      width: 110 + reach.device.left + reach.device.right,
      height: 47 + reach.device.top + reach.device.bottom
    })
    // An unknown text style has no reach: the box itself.
    expect(itemBounds(text('t', 'forty', box, { look: look(40, { textStyleId: 'no-such-style' }) }), SIZE, measure)).toEqual(box)
    // An outline reaches half its width in the item's space, its shadow in the frame's; a glow its blur in the frame's.
    expect(textInkReach('outline', 100).user.left).toBeCloseTo(0.09 * 50, 9)
    expect(textInkReach('outline', 100).device.left).toBeCloseTo(0.24 * 100, 9)
    expect(textInkReach('shadow-pop', 100).device.left).toBeCloseTo(1.5 * 0.06 * 100 + 1.5 * 0.45 * 100, 9)
    expect(textInkReach('shadow-pop', 100).user).toEqual(NONE)
    expect(textInkReach(undefined, 100)).toEqual({ user: NONE, device: NONE })
    // The base face only: a graphic's item is one line, which `paintForLine(style, 0)` draws in the base. `hero`'s base is
    // 0.42 of the size under a soft shadow; its accent (1.6 of the size, a glow of 0.5) never draws on an item and widens nothing.
    expect(GRAPHIC_TEXT_STYLES.map((s) => s.id)).toContain('hero')
    expect(textInkReach('hero', 100).device.left).toBeCloseTo(1.5 * 0.16 * 42, 9)
    expect(textInkReach('hero', 100).user).toEqual(NONE)
    // A rule reaches its 0.04 overhang plus its round cap each side, and its thickness below.
    expect(textInkReach('underline', 100).user.left).toBeCloseTo((0.04 + 0.055 / 2) * 100, 9)
    expect(textInkReach('underline', 100).user.bottom).toBeCloseTo(0.055 * 100, 9)
    expect(textInkReach('underline', 100).user.top).toBe(0)
    // Glyphs taller than ASCENT (Noto Sans Devanagari's ascender, about 1.07 em) widen the top by the overshoot.
    const tall: TextMeasure = (t, l) => ({ width: measure(t, l).width, ascent: 1.07 * l.px, descent: 0.5 * l.px })
    const grown = itemBounds(text('t', 'forty', box, { look: look(40, { textStyleId: 'no-such-style' }) }), SIZE, tall) as Rect
    expect(grown.y).toBeCloseTo(200 - (1.07 - ASCENT) * 40, 9)
    expect(grown.y + grown.height).toBeCloseTo(247 + (0.5 - (LINE_HEIGHT - ASCENT)) * 40, 9)
    expect(grown.x).toBe(100)
  })

  it("a stroke's full path, whatever the frame shows, widened by half its drawn width and its heads; a miter join by ten half-widths", () => {
    const d = 'M0 0 L100 0'
    expect(itemBounds(stroke('k', d, { from: 0, to: 0.1 }), SIZE, measure)).toEqual(rect(-2, -2, 104, 4))
    expect(itemBounds(stroke('k', d, { from: 0.5, to: 0.5 }), SIZE, measure)).toEqual(rect(-2, -2, 104, 4))
    // Under the floor: a 1 px stroke draws at STROKE_MIN_PX of the short side, 2 px at 1080 wide; at 270 the floor is 0.5, so 1 stays 1 and 0.2 draws at 0.5.
    expect(itemBounds(stroke('k', d, { width: 1 }), SIZE, measure)).toEqual(rect(-1, -1, 102, 2))
    expect(itemBounds(stroke('k', d, { width: 1 }), { width: 270, height: 480 }, measure)).toEqual(rect(-0.5, -0.5, 101, 1))
    expect(itemBounds(stroke('k', d, { width: 0.2 }), { width: 270, height: 480 }, measure)).toEqual(rect(-0.25, -0.25, 100.5, 0.5))
    // A head of 20 reaches 22 from the path.
    expect(itemBounds(stroke('k', d, { heads: { end: { size: 20, grow: 0.3 } } }), SIZE, measure)).toEqual(rect(-22, -22, 144, 44))
    expect(itemBounds(stroke('k', d, { join: 'miter' }), SIZE, measure)).toEqual(rect(-20, -20, 140, 40))
    expect(itemBounds(stroke('k', '', {}), SIZE, measure)).toBeNull()
    // A curve's bounds come from its flattened points.
    const arc = itemBounds(stroke('k', 'M0 0 C0 100 100 100 100 0', { width: 2 }), SIZE, measure) as Rect
    expect(arc.y + arc.height).toBeCloseTo(75 + 1, 1)
    expect(arc.x).toBe(-1)
  })

  it('a shape widened by half its stroke and its shadow; an image its box; a dim the whole frame', () => {
    const box = rect(100, 100, 200, 50)
    expect(itemBounds(shape('s', box), SIZE, measure)).toEqual(box)
    expect(itemBounds(shape('s', box, { stroke: { color: '#fff', width: 6 } }), SIZE, measure)).toEqual(rect(97, 97, 206, 56))
    expect(itemBounds(shape('s', box, { shadow: { blur: 10, dy: 4, color: '#000', opacity: 0.5 } }), SIZE, measure)).toEqual(rect(85, 85, 230, 50 + 15 + 19))
    expect(itemBounds(shape('s', box, { shadow: { blur: 10, dy: 4, color: '#000', opacity: 0 } }), SIZE, measure)).toEqual(box)
    expect(itemBounds({ kind: 'image', id: 'i', opacity: 1, src: 'a.png', box, fit: 'contain' }, SIZE, measure)).toEqual(box)
    expect(itemBounds(dim('d', rect(10, 10, 10, 10)), { width: 640, height: 360 }, measure)).toEqual(rect(0, 0, 640, 360))
  })

  it("a transform turns about the item's own centre; a group's children under their own, then the group's about their union", () => {
    const box = rect(0, 0, 100, 50)
    const turned = itemBounds(shape('s', box, { transform: { x: 0, y: 0, scale: 1, rotate: 90 } }), SIZE, measure) as Rect
    expect(turned.x).toBeCloseTo(25, 9)
    expect(turned.y).toBeCloseTo(-25, 9)
    expect(turned.width).toBeCloseTo(50, 9)
    expect(turned.height).toBeCloseTo(100, 9)
    expect(itemBounds(shape('s', box, { transform: { x: 10, y: 20, scale: 2, rotate: 0 } }), SIZE, measure)).toEqual(rect(-40, -5, 200, 100))
    expect(localBounds(shape('s', box, { transform: { x: 10, y: 20, scale: 2, rotate: 0 } }), SIZE, measure)).toEqual(box)
    // Two children 100 wide, the second moved 50 right by its own transform (so the union runs 0..250, centre (125, 25)), the group scaled by 2 about that centre.
    const group: DrawItem = {
      kind: 'group',
      id: 'g',
      opacity: 1,
      transform: { x: 0, y: 0, scale: 2, rotate: 0 },
      children: [shape('a', rect(0, 0, 100, 50)), shape('b', rect(100, 0, 100, 50), { transform: { x: 50, y: 0, scale: 1, rotate: 0 } })]
    }
    expect(localBounds(group, SIZE, measure)).toEqual(rect(0, 0, 250, 50))
    expect(itemBounds(group, SIZE, measure)).toEqual(rect(-125, -25, 500, 100))
    expect(itemBounds({ kind: 'group', id: 'g', opacity: 1, children: [] }, SIZE, measure)).toBeNull()
  })

  it("itemOrigin is the centre of the item's own geometry, read without a measure or a style, the point the painter turns about", () => {
    const box = rect(100, 200, 110, 47)
    expect(itemOrigin(text('t', 'forty', box), SIZE)).toEqual({ x: 155, y: 223.5 })
    // The same point whatever the style's reach or the glyphs' overshoot: those widen the bounds, not the origin.
    expect(itemOrigin(text('t', 'forty', box, { look: look(40, { textStyleId: 'shadow-pop' }) }), SIZE)).toEqual({ x: 155, y: 223.5 })
    expect(itemOrigin(shape('s', box, { stroke: { color: '#fff', width: 20 }, shadow: { blur: 30, dy: 40, color: '#000', opacity: 1 } }), SIZE)).toEqual({ x: 155, y: 223.5 })
    expect(itemOrigin({ kind: 'image', id: 'i', opacity: 1, src: 'a.png', box, fit: 'cover' }, SIZE)).toEqual({ x: 155, y: 223.5 })
    expect(itemOrigin(stroke('k', 'M0 0 L100 50', { width: 40, heads: { end: { size: 60, grow: 1 } } }), SIZE)).toEqual({ x: 50, y: 25 })
    expect(itemOrigin(dim('d', rect(1, 1, 1, 1)), { width: 640, height: 360 })).toEqual({ x: 320, y: 180 })
    // A group: the centre of its children's geometry, each under its own transform (the second child moved 50 right: 0..250).
    const group: DrawItem = {
      kind: 'group',
      id: 'g',
      opacity: 1,
      children: [shape('a', rect(0, 0, 100, 50)), shape('b', rect(100, 0, 100, 50), { transform: { x: 50, y: 0, scale: 1, rotate: 0 } })]
    }
    expect(itemOrigin(group, SIZE)).toEqual({ x: 125, y: 25 })
    // The transform's own translation does not move the origin: it is applied after.
    expect(itemOrigin(shape('s', box, { transform: { x: 500, y: 500, scale: 3, rotate: 45 } }), SIZE)).toEqual({ x: 155, y: 223.5 })
    expect(itemOrigin(stroke('k', ''), SIZE)).toEqual({ x: 0, y: 0 })
  })

  it("a shadow or glow is in the frame's space: it widens the bounds after the transform, unscaled and unturned", () => {
    // A 200×50 shape with a shadow of blur 10 (3σ = 15) and dy 4, held at scale 0.5 about its centre (200, 125): geometry 150..250 × 112.5..137.5,
    // the shadow reaching 15 each side and 4 more below in device pixels, so the bottom is 137.5 + 15 + 4 = 156.5, not scaled to half.
    const box = rect(100, 100, 200, 50)
    const shadow = { blur: 10, dy: 4, color: '#000', opacity: 0.5 }
    const half = itemBounds(shape('s', box, { shadow, transform: { x: 0, y: 0, scale: 0.5, rotate: 0 } }), SIZE, measure) as Rect
    expect(half.x).toBeCloseTo(150 - 15, 9)
    expect(half.y).toBeCloseTo(112.5 - 15, 9)
    expect(half.x + half.width).toBeCloseTo(250 + 15, 9)
    expect(half.y + half.height).toBeCloseTo(137.5 + 15 + 4, 9)
    // Turned a quarter: the geometry is 175..225 × 25..225, the shadow still 15 each side and its dy still downward.
    const turned = itemBounds(shape('s', box, { shadow, transform: { x: 0, y: 0, scale: 1, rotate: 90 } }), SIZE, measure) as Rect
    expect(turned.x).toBeCloseTo(175 - 15, 9)
    expect(turned.y).toBeCloseTo(25 - 15, 9)
    expect(turned.x + turned.width).toBeCloseTo(225 + 15, 9)
    expect(turned.y + turned.height).toBeCloseTo(225 + 15 + 4, 9)
    // A shape's stroke is in its own space: half of 6 is 3, scaled to 1.5.
    const stroked = itemBounds(shape('s', box, { stroke: { color: '#fff', width: 6 }, transform: { x: 0, y: 0, scale: 0.5, rotate: 0 } }), SIZE, measure) as Rect
    expect(stroked.x).toBeCloseTo(150 - 1.5, 9)
    expect(stroked.y + stroked.height).toBeCloseTo(137.5 + 1.5, 9)

    // A text item under `clean` (all of its reach a shadow) turned a quarter about its box's centre (155, 223.5): the box 47 wide and 110 tall
    // there, 131.5..178.5 × 168.5..278.5, then the shadow's 9.6 each side and 2.4 more below.
    const tbox = rect(100, 200, 110, 47)
    const reach = textInkReach('clean', 40).device
    const t = itemBounds(text('t', 'forty', tbox, { transform: { x: 0, y: 0, scale: 1, rotate: 90 } }), SIZE, measure) as Rect
    expect(t.x).toBeCloseTo(131.5 - reach.left, 9)
    expect(t.y).toBeCloseTo(168.5 - reach.top, 9)
    expect(t.x + t.width).toBeCloseTo(178.5 + reach.right, 9)
    expect(t.y + t.height).toBeCloseTo(278.5 + reach.bottom, 9)
    // An outline is in the item's space: `outline` at 40 reaches 1.8 each side, which scale 2 doubles, under its shadow's 9.6 undoubled.
    const o = itemBounds(text('t', 'forty', tbox, { look: look(40, { textStyleId: 'outline' }), transform: { x: 0, y: 0, scale: 2, rotate: 0 } }), SIZE, measure) as Rect
    expect(o.x).toBeCloseTo(155 - 110 - 2 * 1.8 - 9.6, 9)
    expect(o.x + o.width).toBeCloseTo(155 + 110 + 2 * 1.8 + 9.6, 9)

    // A group carries its children's device reach up through its own transform unscaled: the shadowed shape in a group at scale 0.5.
    const group: DrawItem = { kind: 'group', id: 'g', opacity: 1, transform: { x: 0, y: 0, scale: 0.5, rotate: 0 }, children: [shape('s', box, { shadow })] }
    expect(itemBounds(group, SIZE, measure)).toEqual(half)
    // Without a transform, itemBounds and localBounds agree, the device reach included.
    expect(itemBounds(shape('s', box, { shadow }), SIZE, measure)).toEqual(localBounds(shape('s', box, { shadow }), SIZE, measure))
  })
})

/* The type is exercised, so a unit added to `TextUnit` without a case above is seen here. */
const UNITS: Record<TextUnit, true> = { line: true, word: true, cluster: true }
void UNITS
