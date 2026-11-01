import { describe, it, expect } from 'vitest'
import { paintDrawList2d, STROKE_MIN_PX as PAINT_STROKE_MIN_PX, strokeWidth as paintStrokeWidth, type PaintOptions } from '@shared/graphics/paint'
import { STROKE_MIN_PX, STROKE_TOLERANCE, flattenPath, strokeAt, strokeShape, strokeWidth } from '@shared/graphics/stroke'
import {
  CLUSTER_SCRIPTS,
  graphemesOf,
  itemBounds,
  textItems,
  textSpecOf,
  type DrawItem,
  type DrawList,
  type Rect,
  type TextItem,
  type TextLook,
  type TextMeasure
} from '@shared/graphics/items'
import { GRAPHIC_TEXT_STYLES, resolveGraphicStyle } from '@shared/graphics/style'
import { drawTextOnto } from '@shared/render/textPaint'
import { shapedScript, textAnimationById } from '@shared/render/textAnimation'
import { ASCENT, LINE_HEIGHT } from '@shared/render/textLayout'
import { textStyleById } from '@shared/render/textStyle'

/*
 * Painter A (docs/CLIPS.md §6.3, "Painter A", and its Tests bullet): a fake 2D
 * context in the manner of tests/textPaint.test.ts records every call with the
 * state set when it was made and the device point each path point lands on;
 * a second fake is the dim's `layer`. The pin per text item is membership,
 * never an exact call list: a style draws one string several times
 * (`shadow-pop` two glow passes, `neon-green` three), so joining every call
 * would read "40 40 40".
 */

/* -------------------------------------------------------------- the fake */

type Mat = [number, number, number, number, number, number]
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]
interface Pt {
  x: number
  y: number
}

/** `m × n`, as canvas post-multiplies a transform onto the current one. */
function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ]
}

const apply = (m: Mat, x: number, y: number): Pt => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })

interface State {
  ctm: Mat
  globalAlpha: number
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  lineCap: string
  lineJoin: string
  miterLimit: number
  lineDashOffset: number
  globalCompositeOperation: string
  filter: string
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  shadowColor: string
  font: string
  textAlign: string
  textBaseline: string
  letterSpacing: string
  dash: number[]
}

/** One part of the current path, its points mapped to device space when it was added. */
interface PathPart {
  kind: 'move' | 'line' | 'close' | 'rect' | 'roundRect' | 'ellipse' | 'arc'
  points: Pt[]
  args: number[]
}

interface Op {
  op: string
  args: unknown[]
  /** Saves outstanding when the call was made (the outer save makes it 1; an item's, 2). */
  depth: number
  state: Omit<State, 'ctm'> & { fill: string }
  path: PathPart[]
  /** A text call's device point; a drawImage's destination origin. */
  at?: Pt
  /** A drawImage's destination corners in device space. */
  points?: Pt[]
  text?: string
}

interface Fake {
  ctx: CanvasRenderingContext2D
  ops: Op[]
  canvas: { width: number; height: number }
}

const pxOf = (font: string): number => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10)

const graphemeCount = (text: string): number => {
  const parts = graphemesOf(text)
  if (parts === null) throw new Error('node 24 has Intl.Segmenter')
  return parts.length
}

/** §6.3's node measure: 0.55 of the pixel size per grapheme, as graphicDrawList's; the fake's `measureText` reads the same rule, so the painter wraps and shrinks nothing. */
const EM = 0.55
const measure: TextMeasure = (text, look) => ({
  width: graphemeCount(text) * look.px * EM,
  ascent: ASCENT * look.px,
  descent: (LINE_HEIGHT - ASCENT) * look.px
})

/**
 * A 2D context that records every call, with the state set when it was made
 * (a gradient is the stub, which has no string form), keeps a save stack and
 * the current transform, and maps every path point to device space. `em` is
 * what it measures a grapheme at, of the font's size.
 */
function fake(width: number, height: number, em = EM): Fake {
  const ops: Op[] = []
  const canvas = { width, height }
  const fresh = (): State => ({
    ctm: IDENTITY,
    globalAlpha: 1,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    lineDashOffset: 0,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    letterSpacing: '0px',
    dash: []
  })
  let state = fresh()
  const stack: State[] = []
  let path: PathPart[] = []
  const stub: unknown = new Proxy(function stub() {}, { get: () => stub, apply: () => stub })
  const record = (op: string, args: unknown[], extra: Partial<Op> = {}): void => {
    const { ctm: _ctm, ...rest } = state
    void _ctm
    ops.push({
      op,
      args,
      depth: stack.length,
      state: { ...rest, dash: [...state.dash], fill: typeof state.fillStyle === 'string' ? state.fillStyle : 'not a colour' },
      path: path.map((part) => ({ ...part, points: part.points.map((p) => ({ ...p })) })),
      ...extra
    })
  }
  const map = (x: number, y: number): Pt => apply(state.ctm, x, y)
  const methods: Record<string, (...args: never[]) => unknown> = {
    save: () => {
      record('save', [])
      stack.push({ ...state, dash: [...state.dash] })
    },
    restore: () => {
      record('restore', [])
      const top = stack.pop()
      if (top) state = top
    },
    translate: (x: number, y: number) => {
      state.ctm = mul(state.ctm, [1, 0, 0, 1, x, y])
    },
    rotate: (r: number) => {
      state.ctm = mul(state.ctm, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0])
    },
    scale: (sx: number, sy: number) => {
      state.ctm = mul(state.ctm, [sx, 0, 0, sy, 0, 0])
    },
    beginPath: () => {
      path = []
    },
    closePath: () => path.push({ kind: 'close', points: [], args: [] }),
    moveTo: (x: number, y: number) => path.push({ kind: 'move', points: [map(x, y)], args: [x, y] }),
    lineTo: (x: number, y: number) => path.push({ kind: 'line', points: [map(x, y)], args: [x, y] }),
    rect: (x: number, y: number, w: number, h: number) =>
      path.push({ kind: 'rect', points: [map(x, y), map(x + w, y), map(x + w, y + h), map(x, y + h)], args: [x, y, w, h] }),
    roundRect: (x: number, y: number, w: number, h: number, r: number) =>
      path.push({ kind: 'roundRect', points: [map(x, y), map(x + w, y), map(x + w, y + h), map(x, y + h)], args: [x, y, w, h, r] }),
    ellipse: (cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number) =>
      path.push({ kind: 'ellipse', points: [map(cx, cy)], args: [cx, cy, rx, ry, rot, a0, a1] }),
    arc: (cx: number, cy: number, r: number, a0: number, a1: number) => path.push({ kind: 'arc', points: [map(cx, cy)], args: [cx, cy, r, a0, a1] }),
    fill: () => record('fill', []),
    stroke: () => record('stroke', []),
    clip: () => record('clip', []),
    fillRect: (x: number, y: number, w: number, h: number) => record('fillRect', [x, y, w, h], { at: map(x, y) }),
    clearRect: (x: number, y: number, w: number, h: number) => record('clearRect', [x, y, w, h]),
    fillText: (text: string, x: number, y: number) => record('fillText', [text, x, y], { text, at: map(x, y) }),
    strokeText: (text: string, x: number, y: number) => record('strokeText', [text, x, y], { text, at: map(x, y) }),
    measureText: (text: string) => ({ width: graphemeCount(text) * pxOf(state.font) * em }),
    setLineDash: (segments: number[]) => {
      state.dash = [...segments]
      record('setLineDash', [[...segments]])
    },
    getLineDash: () => [...state.dash],
    drawImage: (...args: unknown[]) => {
      // The destination's four corners mapped to device space: (dx, dy, dw, dh) are the last four of nine arguments, or arguments 1 and 2 of three.
      const n = args.slice(1) as number[]
      const [dx, dy, dw, dh] = n.length >= 8 ? n.slice(4, 8) : [n[0], n[1], 0, 0]
      record('drawImage', args, { at: map(dx, dy), points: [map(dx, dy), map(dx + dw, dy), map(dx + dw, dy + dh), map(dx, dy + dh)] })
    },
    createLinearGradient: () => stub,
    createRadialGradient: () => stub,
    createPattern: () => stub
  }
  const ctx = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'canvas') return canvas
        if (typeof key === 'string' && key in methods) return methods[key]
        if (typeof key === 'string' && key in state) return state[key as keyof State]
        return (...args: unknown[]) => {
          record(String(key), args)
          return stub
        }
      },
      set(_target, key, value) {
        if (typeof key === 'string' && key in state && key !== 'ctm') (state as unknown as Record<string, unknown>)[key] = value
        return true
      }
    }
  ) as unknown as CanvasRenderingContext2D
  return { ctx, ops, canvas }
}

/** The ops of each top-level item, in list order: from an item's save (made with the outer save outstanding) to its restore. */
function itemSpans(ops: Op[]): Op[][] {
  const spans: Op[][] = []
  let current: Op[] | null = null
  for (const op of ops) {
    if (current === null) {
      if (op.op === 'save' && op.depth === 1) current = [op]
      continue
    }
    current.push(op)
    if (op.op === 'restore' && op.depth === 2) {
      spans.push(current)
      current = null
    }
  }
  return spans
}

const fillsOf = (span: Op[]): Op[] => span.filter((op) => op.op === 'fillText')
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()
/** The distinct strings a span fills, in the order first drawn. */
const stringsOf = (span: Op[]): string[] => [...new Set(fillsOf(span).map((op) => norm(op.text ?? '')))]

/** The bounding box of some device points. */
function bbox(points: Pt[]): Rect {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

const closeRect = (a: Rect, b: Rect, digits = 9): void => {
  expect(a.x).toBeCloseTo(b.x, digits)
  expect(a.y).toBeCloseTo(b.y, digits)
  expect(a.width).toBeCloseTo(b.width, digits)
  expect(a.height).toBeCloseTo(b.height, digits)
}

/* ---------------------------------------------------------------- fixtures */

const SIZE = { width: 1080, height: 1920 }
const SMALL = { width: 270, height: 480 }
const flat = (items: DrawItem[], size = SIZE): DrawList => ({ width: size.width, height: size.height, items })
const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height })

const look = (px = 40, over: Partial<TextLook> = {}): TextLook => ({ textStyleId: 'clean', font: 'Montserrat', px, align: 'left', ...over })

const shape = (id: string, box: Rect, over: Partial<Extract<DrawItem, { kind: 'shape' }>> = {}): DrawItem => ({
  kind: 'shape',
  id,
  opacity: 1,
  shape: 'rect',
  box,
  fill: '#ffffff',
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
  color: '#ff8800',
  cap: 'round',
  join: 'round',
  ...over
})

const dim = (id = 'dim', hole?: Rect, over: Partial<Extract<DrawItem, { kind: 'dim' }>> = {}): DrawItem => ({
  kind: 'dim',
  id,
  opacity: 1,
  color: '#000000',
  alpha: 0.35,
  ...(hole ? { hole: { box: hole, radius: 12, feather: 8 } } : {}),
  ...over
})

/** A field's items at (100, 200), 5000 wide, in `style`'s text style. */
function field(text: string, unit: 'line' | 'word' | 'cluster', styleId: string, m = measure, over: Partial<TextLook> = {}): TextItem[] {
  return textItems({ id: 'f', text, look: look(40, { textStyleId: styleId, ...over }), at: { x: 100, y: 200, width: 5000 }, unit, source: 'data.label' }, m)
}

const STYLES = ['clean', 'shadow-pop', 'neon-green'] as const
const ACCENT = resolveGraphicStyle('clean').palette.accent

const HINDI = 'स्कूल में क्षत्रिय बच्चे'
const TELUGU = 'తెలుగు భాష మధురం'
const TAMIL = 'இது புத்தகம்'

const HEAD = 'M100 100 L500 100'

/* ------------------------------------------------------------ the text pin */

describe('graphicPaint: the pin, per text item', () => {
  it('the three styles exist, and two of them draw one string several times, which is why the pin is membership', () => {
    for (const id of STYLES) expect(textStyleById(id), id).toBeTruthy()
    expect(GRAPHIC_TEXT_STYLES.map((s) => s.id)).toContain('clean')
    for (const id of ['shadow-pop', 'neon-green']) {
      const { ctx, ops } = fake(SIZE.width, SIZE.height)
      paintDrawList2d(ctx, flat(field('40', 'line', id)))
      const [span] = itemSpans(ops)
      expect(fillsOf(span).length, id).toBeGreaterThanOrEqual(2)
      expect(stringsOf(span), id).toEqual(['40'])
    }
  })

  for (const id of STYLES) {
    it(`under ${id}: every fillText string between an item's save and restore is the item's text, or one of its laid-out rows, and every row is drawn; the font is the look's, the weight the style's`, () => {
      const text = 'Price 1000000 now'
      for (const unit of ['line', 'word', 'cluster'] as const) {
        const items = field(text, unit, id)
        const { ctx, ops } = fake(SIZE.width, SIZE.height)
        paintDrawList2d(ctx, flat(items))
        const spans = itemSpans(ops)
        expect(spans, `${id} ${unit}`).toHaveLength(items.length)
        items.forEach((item, i) => {
          const strings = stringsOf(spans[i])
          const where = `${id} ${unit} "${item.text}"`
          expect(strings.length, where).toBeGreaterThanOrEqual(1)
          // Each string drawn is the text, or a row of it (never a piece smaller than a row, never a reformatted one); the rows join back to the text.
          for (const s of strings) expect(norm(item.text).includes(s), `${where}: "${s}"`).toBe(true)
          expect(strings.join(' '), where).toBe(norm(item.text))
          for (const op of fillsOf(spans[i])) {
            expect(op.state.font, where).toMatch(new RegExp(`^(italic )?${textStyleById(id)!.base.weight} 40px "Montserrat"`))
            expect(op.state.font, where).toContain('"Noto Sans Devanagari"')
          }
        })
        // The numeric word is drawn as written, never grouped: "1000000" across the items' strings (one, a word, or seven clusters) and no "1,000,000".
        expect(spans.flatMap(stringsOf).join(''), `${id} ${unit}`).toContain('1000000')
        for (const span of spans) for (const s of stringsOf(span)) expect(s, `${id} ${unit}`).not.toMatch(/1,000,000|10,00,000/)
      }
    })
  }

  it('a row wrapped by drawTextOnto (a context measuring wider than the list did) still satisfies the pin: its rows join to the text, each drawn', () => {
    // The fake measures a grapheme at 1.1 em, twice what the list laid the item out at, so a three-word line item wraps into three rows.
    const [item] = field('Price 1000000 now', 'line', 'clean')
    const { ctx, ops } = fake(SIZE.width, SIZE.height, 2 * EM)
    paintDrawList2d(ctx, flat([item]))
    const [span] = itemSpans(ops)
    const strings = stringsOf(span)
    expect(strings.length).toBeGreaterThan(1)
    expect(strings.join(' ')).toBe('Price 1000000 now')
    for (const s of strings) expect(fillsOf(span).filter((op) => norm(op.text ?? '') === s).length, s).toBeGreaterThanOrEqual(1)
  })

  it("a text item is drawn translated to its box: the baseline lands at box.y + round(ASCENT × px), a left line at box.x, and `offset` moves it", () => {
    const [item] = field('forty', 'line', 'clean')
    expect(item.box).toEqual({ x: 100, y: 200, width: 5 * 40 * EM, height: 47 })
    const { ctx, ops } = fake(SIZE.width, SIZE.height)
    paintDrawList2d(ctx, flat([item]))
    const fills = fillsOf(itemSpans(ops)[0])
    expect(fills.length).toBeGreaterThan(0)
    for (const op of fills) {
      expect(op.at!.x).toBeCloseTo(100, 9)
      expect(op.at!.y).toBeCloseTo(200 + Math.round(ASCENT * 40), 9)
    }
    const moved = fake(SIZE.width, SIZE.height)
    paintDrawList2d(moved.ctx, flat([item]), { offset: { x: -100, y: -200 } })
    for (const op of fillsOf(itemSpans(moved.ops)[0])) {
      expect(op.at!.x).toBeCloseTo(0, 9)
      expect(op.at!.y).toBeCloseTo(Math.round(ASCENT * 40), 9)
    }
  })
})

/* ---------------------------------------------------------------- the ink */

describe('graphicPaint: the ink', () => {
  for (const id of STYLES) {
    it(`under ${id}: a lit word's last fillText (the fill pass) is made with the palette's accent; an unlit word's is not`, () => {
      const lit = field('forty', 'word', id, measure, { accent: ACCENT })
      const plain = field('forty', 'word', id)
      expect(lit).toHaveLength(1)
      expect(lit[0].look.accent).toBe(ACCENT)
      const { ctx, ops } = fake(SIZE.width, SIZE.height)
      paintDrawList2d(ctx, flat([lit[0], plain[0]]))
      const [litSpan, plainSpan] = itemSpans(ops)
      const last = (span: Op[]): Op => fillsOf(span)[fillsOf(span).length - 1]
      expect(last(litSpan).text, id).toBe('forty')
      expect(last(litSpan).state.fill, id).toBe(ACCENT)
      expect(last(plainSpan).text, id).toBe('forty')
      expect(last(plainSpan).state.fill, id).not.toBe(ACCENT)
      // A lit word keeps the style's other passes: the same number of fillText calls as the unlit one.
      expect(fillsOf(litSpan).length, id).toBe(fillsOf(plainSpan).length)
    })
  }

  it("a text item's opacity reaches every pass drawTextOnto makes: the style's box bar, and (directly, no graphic route) the chromatic split and an animation step", () => {
    // The styles under test are computed, never listed: every eligible style with a box on either face.
    const barred = GRAPHIC_TEXT_STYLES.filter((s) => s.base.box || s.accent?.box)
    expect(barred.map((s) => s.id)).toContain('highlight-bar')
    for (const style of barred) {
      const faded = field('forty', 'word', style.id).map((item) => ({ ...item, opacity: 0.5 }))
      const { ctx, ops } = fake(SIZE.width, SIZE.height)
      paintDrawList2d(ctx, flat(faded))
      const inks = itemSpans(ops)[0].filter((op) => op.op === 'fill' || op.op === 'fillText' || op.op === 'strokeText')
      expect(inks.length, style.id).toBeGreaterThan(1)
      for (const op of inks) expect(op.state.globalAlpha, `${style.id} ${op.op}`).toBeLessThanOrEqual(0.5 + 1e-9)
      // The bar itself (the roundRect fill) is at 0.5 × the box's own opacity.
      const bars = inks.filter((op) => op.op === 'fill' && op.path[0]?.kind === 'roundRect')
      expect(bars.length, style.id).toBe(1)
      expect(bars[0].state.globalAlpha, style.id).toBeCloseTo(0.5 * (style.base.box?.opacity ?? 1), 12)
    }
    // The split pass: no eligible style carries one (glitch and glitch-red re-case), so drawTextOnto is driven directly, at 0.5 going in.
    const splitStyle = textStyleById('glitch')!
    expect(splitStyle.base.split).toBeTruthy()
    const [item] = field('forty', 'word', 'clean')
    const split = fake(SIZE.width, SIZE.height)
    split.ctx.globalAlpha = 0.5
    drawTextOnto(split.ctx, textSpecOf(item.text, { ...item.look, textStyleId: 'glitch' }, item.box), item.box.width, item.box.height)
    const splitFills = fillsOf(split.ops)
    expect(splitFills.length).toBeGreaterThanOrEqual(3)
    for (const op of splitFills) expect(op.state.globalAlpha, `glitch fillText "${op.text}"`).toBeLessThanOrEqual(0.5 + 1e-9)
    expect(split.ctx.globalAlpha).toBe(0.5)
    // The animation step, reached only with a clock (the painter passes none): the settled frame's STILL alpha of 1 multiplies in, never overwrites.
    expect(textAnimationById('fade')).toBeTruthy()
    const moving = fake(SIZE.width, SIZE.height)
    moving.ctx.globalAlpha = 0.5
    drawTextOnto(moving.ctx, { ...textSpecOf(item.text, item.look, item.box), animationId: 'fade' }, item.box.width, item.box.height, { frame: 1000, fps: 30 })
    const movingFills = fillsOf(moving.ops)
    expect(movingFills.length).toBeGreaterThanOrEqual(1)
    for (const op of movingFills) expect(op.state.globalAlpha, `fade fillText "${op.text}"`).toBeLessThanOrEqual(0.5 + 1e-9)
  })
})

/* ----------------------------------------------------- the shaped scripts */

describe('graphicPaint: the shaped-script rule (§6.12, phase 1)', () => {
  /** Whether `s`, a drawn string holding a shaped script, is a whole word of `sentence`, or a whole grapheme cluster of one where the script is in CLUSTER_SCRIPTS. */
  function wholeUnit(s: string, sentence: string, clusters: boolean): boolean {
    const words = sentence.split(/\s+/)
    if (words.includes(s)) return true
    if (!clusters) return false
    return words.some((w) => (graphemesOf(w) ?? []).includes(s))
  }

  for (const id of STYLES) {
    it(`under ${id}: no Hindi or Telugu string reaches fillText in a piece smaller than a cluster, and no Tamil string smaller than a word`, () => {
      const cases: [string, boolean][] = [
        [HINDI, true],
        [TELUGU, true],
        [TAMIL, false]
      ]
      for (const [sentence, clusters] of cases) {
        for (const unit of ['cluster', 'word', 'line'] as const) {
          const items = field(sentence, unit, id)
          expect(items.length).toBeGreaterThan(0)
          const { ctx, ops } = fake(SIZE.width, SIZE.height)
          paintDrawList2d(ctx, flat(items))
          const spans = itemSpans(ops)
          expect(spans).toHaveLength(items.length)
          let drawn = 0
          spans.forEach((span, i) => {
            const strings = stringsOf(span)
            expect(strings.join(' '), `${id} ${unit} "${items[i].text}"`).toBe(norm(items[i].text))
            for (const op of fillsOf(span)) {
              const s = op.text ?? ''
              if (!shapedScript(s)) continue
              drawn++
              expect(s, `${id} ${unit}: fillText("${s}") is a lone mark`).not.toMatch(/^\p{M}+$/u)
              // A line item's string is the line; otherwise a word, or a cluster where M3 allowed it.
              const ok = s === norm(items[i].text) || wholeUnit(s, sentence, clusters)
              expect(ok, `${id} ${unit}: fillText("${s}") is less than a ${clusters ? 'cluster' : 'word'} of "${sentence}"`).toBe(true)
            }
          })
          expect(drawn, `${id} ${unit} ${sentence}`).toBeGreaterThan(0)
        }
        // By cluster, the Hindi and Telugu items are clusters, which M3 cleared, and each cluster is drawn whole: a string of one grapheme and more than one code point exists.
        if (clusters) {
          const items = field(sentence, 'cluster', id)
          const { ctx, ops } = fake(SIZE.width, SIZE.height)
          paintDrawList2d(ctx, flat(items))
          const strings = itemSpans(ops).flatMap(stringsOf)
          expect(strings.some((s) => graphemeCount(s) === 1 && Array.from(s).length > 1), `${id} ${sentence}`).toBe(true)
          for (const s of strings) expect(graphemeCount(s), `${id}: "${s}"`).toBe(1)
        }
      }
      expect(CLUSTER_SCRIPTS).toContain('Devanagari')
      expect(CLUSTER_SCRIPTS).toContain('Telugu')
      expect(CLUSTER_SCRIPTS).not.toContain('Tamil')
    })
  }
})

/* -------------------------------------------------------------- the strokes */

describe('graphicPaint: strokes', () => {
  it("a stroke reaches the context as one stroke of the span's polyline, at strokeShape's width, cap and join, a miter limit of at most 10", () => {
    const item = stroke('k', HEAD, { from: 0, to: 0.5, cap: 'square', join: 'bevel' })
    const { ctx, ops } = fake(SIZE.width, SIZE.height)
    paintDrawList2d(ctx, flat([item]))
    const [span] = itemSpans(ops)
    const strokes = span.filter((op) => op.op === 'stroke')
    expect(strokes).toHaveLength(1)
    const [op] = strokes
    expect(op.state.strokeStyle).toBe('#ff8800')
    expect(op.state.lineWidth).toBe(strokeWidth(4, SIZE))
    expect(op.state.lineCap).toBe('square')
    expect(op.state.lineJoin).toBe('bevel')
    expect(op.state.miterLimit).toBeLessThanOrEqual(10)
    expect(op.state.dash).toEqual([])
    // The polyline is the span strokeAt gives, in frame pixels: (100, 100) to (300, 100).
    const points = op.path.filter((p) => p.kind === 'move' || p.kind === 'line').map((p) => p.points[0])
    expect(points).toEqual(strokeAt(flattenPath(HEAD, STROKE_TOLERANCE), 0, 0.5).points)
    expect(points[points.length - 1]).toEqual({ x: 300, y: 100 })
    // No head asked for: no fill.
    expect(span.some((o) => o.op === 'fill')).toBe(false)
    // from = to: nothing reaches the context.
    const empty = fake(SIZE.width, SIZE.height)
    paintDrawList2d(empty.ctx, flat([stroke('k', HEAD, { from: 0.5, to: 0.5, heads: { end: { size: 40, grow: 1 } } })]))
    expect(itemSpans(empty.ops)[0].some((o) => o.op === 'stroke' || o.op === 'fill')).toBe(false)
  })

  it("the head is a filled path whose point is the span's tip, not the path's end, and the line stops short of it; a start head turned back", () => {
    const item = stroke('k', HEAD, { from: 0, to: 0.5, heads: { start: { size: 20, grow: 1 }, end: { size: 40, grow: 1 } } })
    const { ctx, ops } = fake(SIZE.width, SIZE.height)
    paintDrawList2d(ctx, flat([item]))
    const [span] = itemSpans(ops)
    const fills = span.filter((op) => op.op === 'fill')
    expect(fills).toHaveLength(2)
    const tri = (op: Op): Pt[] => op.path.filter((p) => p.kind === 'move' || p.kind === 'line').map((p) => p.points[0])
    // The end head's point is the tip (300, 100), the span's end at to = 0.5, not (500, 100); its base 40 back, 18 wide each side.
    const end = fills.find((op) => tri(op)[0].x === 300)!
    expect(end).toBeTruthy()
    expect(tri(end)).toEqual([
      { x: 300, y: 100 },
      { x: 260, y: 118 },
      { x: 260, y: 82 }
    ])
    expect(end.state.fill).toBe('#ff8800')
    expect(end.path.some((p) => p.kind === 'close')).toBe(true)
    // The start head's point is the span's start, turned back.
    const start = fills.find((op) => op !== end)!
    expect(tri(start)[0]).toEqual({ x: 100, y: 100 })
    expect(tri(start)[1].x).toBeCloseTo(120, 9)
    // The line stops 0.6 × size short of each head: from 112 to 276.
    const line = span.find((op) => op.op === 'stroke')!
    const points = line.path.filter((p) => p.kind === 'move' || p.kind === 'line').map((p) => p.points[0])
    expect(points[0].x).toBeCloseTo(112, 9)
    expect(points[points.length - 1].x).toBeCloseTo(276, 9)
    expect(points).toEqual(strokeShape(flattenPath(HEAD, STROKE_TOLERANCE), item as never, SIZE).line)
    // No head of a stroke's own at grow 0.
    const none = fake(SIZE.width, SIZE.height)
    paintDrawList2d(none.ctx, flat([stroke('k', HEAD, { from: 0, to: 0.5, heads: { end: { size: 40, grow: 0 } } })]))
    expect(itemSpans(none.ops)[0].filter((o) => o.op === 'fill')).toHaveLength(0)
  })

  it('the minimum width: a stroke under the floor draws at STROKE_MIN_PX of a 1080 side, scaled to the frame; one above it at its own', () => {
    const widthAt = (width: number, size: { width: number; height: number }): number => {
      const { ctx, ops } = fake(size.width, size.height)
      paintDrawList2d(ctx, flat([stroke('k', HEAD, { width })], size))
      return itemSpans(ops)[0].find((op) => op.op === 'stroke')!.state.lineWidth
    }
    expect(STROKE_MIN_PX).toBe(2)
    expect(widthAt(0.5, SIZE)).toBe(2)
    expect(widthAt(0.5, SMALL)).toBe(0.5)
    expect(widthAt(10, SIZE)).toBe(10)
    expect(widthAt(10, SMALL)).toBe(10)
    expect(widthAt(1, { width: 3840, height: 2160 })).toBe(4)
    // The painter's rule is stroke.ts's own binding, re-exported, never a copy.
    expect(PAINT_STROKE_MIN_PX).toBe(STROKE_MIN_PX)
    expect(paintStrokeWidth).toBe(strokeWidth)
  })

  it('a dash applies the pattern and its offset to the same polyline, and the next item is undashed; a marker look is drawn clean', () => {
    const dashed = stroke('k', HEAD, { dash: { pattern: [12, 6], offset: 3 } })
    const { ctx, ops } = fake(SIZE.width, SIZE.height)
    paintDrawList2d(ctx, flat([dashed, stroke('plain', HEAD)]))
    const [a, b] = itemSpans(ops)
    const strokeOp = a.find((op) => op.op === 'stroke')!
    expect(strokeOp.state.dash).toEqual([12, 6])
    expect(strokeOp.state.lineDashOffset).toBe(3)
    expect(b.find((op) => op.op === 'stroke')!.state.dash).toEqual([])
    expect(b.find((op) => op.op === 'stroke')!.state.lineDashOffset).toBe(0)
    const clean = fake(SIZE.width, SIZE.height)
    paintDrawList2d(clean.ctx, flat([stroke('k', HEAD, { look: 'clean' })]))
    const marker = fake(SIZE.width, SIZE.height)
    paintDrawList2d(marker.ctx, flat([stroke('k', HEAD, { look: 'marker' })]))
    // Until M10 (§16.60, phase 2): when the marker outline lands, this becomes a case that the marker's ops differ from clean's.
    expect(marker.ops).toEqual(clean.ops)
  })

  it('the path memo is per d: two strokes of different paths in one list each reach the context on their own points', () => {
    const other = 'M100 300 L500 300'
    const { ctx, ops } = fake(SIZE.width, SIZE.height)
    paintDrawList2d(ctx, flat([stroke('a', HEAD), stroke('b', other)]))
    const pts = (span: Op[]): Pt[] =>
      span
        .find((op) => op.op === 'stroke')!
        .path.filter((p) => p.kind === 'move' || p.kind === 'line')
        .map((p) => p.points[0])
    const [a, b] = itemSpans(ops)
    expect(pts(a)).toEqual(strokeAt(flattenPath(HEAD, STROKE_TOLERANCE), 0, 1).points)
    expect(pts(b)).toEqual(strokeAt(flattenPath(other, STROKE_TOLERANCE), 0, 1).points)
    expect(pts(b)[0]).toEqual({ x: 100, y: 300 })
  })
})

/* ---------------------------------------------------------------- shapes */

describe('graphicPaint: shapes, images and the dim', () => {
  it('each shape reaches the context by its path: rect, roundRect, ellipse, a ring as an arc; filled then stroked, the shadow on the first pass only', () => {
    const box = rect(100, 100, 200, 120)
    const shadow = { blur: 10, dy: 4, color: '#102030', opacity: 0.5 }
    const items: DrawItem[] = [
      shape('r', box, { fill: '#111111', stroke: { color: '#eeeeee', width: 6 }, shadow }),
      shape('o', box, { shape: 'rounded', radius: 16, fill: '#222222' }),
      shape('c', box, { shape: 'circle', fill: '#333333' }),
      shape('g', box, { shape: 'ring', sweep: 0.25, start: -Math.PI / 2, stroke: { color: '#444444', width: 8 }, fill: '#999999' }),
      shape('s', box, { fill: undefined, stroke: { color: '#555555', width: 2 }, shadow })
    ]
    const { ctx, ops } = fake(SIZE.width, SIZE.height)
    // The context's own shadow offset going in: the painter forces 0 on the item, and the outer restore gives it back.
    ctx.shadowOffsetX = 7
    paintDrawList2d(ctx, flat(items))
    expect(ctx.shadowOffsetX).toBe(7)
    const [r, o, c, g, s] = itemSpans(ops)
    // rect: a fill with the shadow, then a stroke without it.
    const rFill = r.find((op) => op.op === 'fill')!
    const rStroke = r.find((op) => op.op === 'stroke')!
    expect(r.indexOf(rFill)).toBeLessThan(r.indexOf(rStroke))
    expect(rFill.path.map((p) => p.kind)).toEqual(['rect'])
    expect(rFill.path[0].args).toEqual([100, 100, 200, 120])
    expect(rFill.state.fill).toBe('#111111')
    expect(rFill.state.shadowBlur).toBe(10)
    expect(rFill.state.shadowOffsetY).toBe(4)
    expect(rFill.state.shadowOffsetX).toBe(0)
    expect(rFill.state.shadowColor).toBe('rgba(16,32,48,0.5)')
    expect(rStroke.state.strokeStyle).toBe('#eeeeee')
    expect(rStroke.state.lineWidth).toBe(6)
    expect(rStroke.state.shadowBlur).toBe(0)
    expect(rStroke.state.shadowOffsetY).toBe(0)
    // rounded: roundRect with its radius; circle: an ellipse on the box's centre and half sizes.
    expect(o.find((op) => op.op === 'fill')!.path[0]).toMatchObject({ kind: 'roundRect', args: [100, 100, 200, 120, 16] })
    expect(c.find((op) => op.op === 'fill')!.path[0]).toMatchObject({ kind: 'ellipse', args: [200, 160, 100, 60, 0, 0, 2 * Math.PI] })
    // ring: an arc of sweep × 2π from start, stroked, never filled.
    expect(g.some((op) => op.op === 'fill')).toBe(false)
    const gStroke = g.find((op) => op.op === 'stroke')!
    expect(gStroke.path[0].kind).toBe('arc')
    expect(gStroke.path[0].args.slice(0, 3)).toEqual([200, 160, 60])
    expect(gStroke.path[0].args[3]).toBeCloseTo(-Math.PI / 2, 12)
    expect(gStroke.path[0].args[4]).toBeCloseTo(0, 12)
    expect(gStroke.state.strokeStyle).toBe('#444444')
    expect(gStroke.state.lineWidth).toBe(8)
    // A stroke-only shape carries the shadow on its stroke.
    expect(s.some((op) => op.op === 'fill')).toBe(false)
    expect(s.find((op) => op.op === 'stroke')!.state.shadowBlur).toBe(10)
    // A ring of sweep 0 draws nothing; a shadow at opacity 0 is not set.
    const none = fake(SIZE.width, SIZE.height)
    paintDrawList2d(none.ctx, flat([shape('g', box, { shape: 'ring', sweep: 0, stroke: { color: '#444444', width: 8 } }), shape('r', box, { shadow: { ...shadow, opacity: 0 } })]))
    const [g0, r0] = itemSpans(none.ops)
    expect(g0.some((op) => op.op === 'stroke' || op.op === 'fill')).toBe(false)
    expect(r0.find((op) => op.op === 'fill')!.state.shadowBlur).toBe(0)
    // A circle or ring in a box of negative size reaches no fill or stroke (a real canvas throws on a negative radius, measured); a rect draws, mirrored.
    const flipped = rect(0, 0, -20, -10)
    const neg = fake(SIZE.width, SIZE.height)
    paintDrawList2d(neg.ctx, flat([shape('c', flipped, { shape: 'circle', stroke: { color: '#444444', width: 2 } }), shape('g', flipped, { shape: 'ring', stroke: { color: '#444444', width: 2 } }), shape('r', flipped)]))
    const [cNeg, gNeg, rNeg] = itemSpans(neg.ops)
    expect(cNeg.some((op) => op.op === 'stroke' || op.op === 'fill')).toBe(false)
    expect(gNeg.some((op) => op.op === 'stroke' || op.op === 'fill')).toBe(false)
    expect(rNeg.some((op) => op.op === 'fill')).toBe(true)
  })

  it("an image is drawImage of the bitmap `images` holds for its src, contain letterboxed and cover cropped from the middle; a missing bitmap is skipped", () => {
    const bitmap = { width: 200, height: 100 } as unknown as ImageBitmap
    const images = new Map([
      ['a.png', bitmap],
      ['z.png', { width: 0, height: 0 } as unknown as ImageBitmap]
    ])
    const box = rect(10, 20, 100, 100)
    const items: DrawItem[] = [
      { kind: 'image', id: 'contain', opacity: 1, src: 'a.png', box, fit: 'contain' },
      { kind: 'image', id: 'cover', opacity: 1, src: 'a.png', box, fit: 'cover' },
      { kind: 'image', id: 'missing', opacity: 1, src: 'b.png', box, fit: 'cover' },
      { kind: 'image', id: 'empty', opacity: 1, src: 'z.png', box, fit: 'cover' }
    ]
    const { ctx, ops } = fake(SIZE.width, SIZE.height)
    paintDrawList2d(ctx, flat(items), { images })
    const [contain, cover, missing, empty] = itemSpans(ops)
    expect(contain.find((op) => op.op === 'drawImage')!.args).toEqual([bitmap, 0, 0, 200, 100, 10, 45, 100, 50])
    expect(cover.find((op) => op.op === 'drawImage')!.args).toEqual([bitmap, 50, 0, 100, 100, 10, 20, 100, 100])
    expect(missing.some((op) => op.op === 'drawImage')).toBe(false)
    // A sizeless bitmap is skipped too (its cover scale would be Infinity, its source 0 wide).
    expect(empty.some((op) => op.op === 'drawImage')).toBe(false)
    const none = fake(SIZE.width, SIZE.height)
    paintDrawList2d(none.ctx, flat([items[0]]))
    expect(none.ops.some((op) => op.op === 'drawImage')).toBe(false)
  })

  it('the dim: a frame-sized layer filled with the colour at alpha, its hole cut by destination-out under a blur of feather px, composited at the opacity', () => {
    const made: { width: number; height: number; layer: Fake }[] = []
    const layer: PaintOptions['layer'] = (width, height) => {
      const l = fake(width, height)
      made.push({ width, height, layer: l })
      return l.ctx
    }
    const hole = rect(300, 600, 200, 200)
    const { ctx, ops } = fake(SIZE.width, SIZE.height)
    paintDrawList2d(ctx, flat([dim('d', hole, { opacity: 0.6 })]), { layer })
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({ width: 1080, height: 1920 })
    const lops = made[0].layer.ops
    const sheet = lops.find((op) => op.op === 'fillRect')!
    expect(sheet.args).toEqual([0, 0, 1080, 1920])
    expect(sheet.state.fill).toBe('#000000')
    expect(sheet.state.globalAlpha).toBeCloseTo(0.35, 12)
    expect(sheet.state.globalCompositeOperation).toBe('source-over')
    const cut = lops.find((op) => op.op === 'fill')!
    expect(lops.indexOf(cut)).toBeGreaterThan(lops.indexOf(sheet))
    expect(cut.state.globalCompositeOperation).toBe('destination-out')
    expect(cut.state.filter).toBe('blur(8px)')
    expect(cut.state.globalAlpha).toBe(1)
    expect(cut.path[0]).toMatchObject({ kind: 'roundRect', args: [300, 600, 200, 200, 12] })
    // The main context gets the layer's canvas once, at the item's opacity, at the frame's origin.
    const [span] = itemSpans(ops)
    const composite = span.filter((op) => op.op === 'drawImage')
    expect(composite).toHaveLength(1)
    expect(composite[0].args[0]).toBe(made[0].layer.canvas)
    expect(composite[0].args.slice(1)).toEqual([0, 0])
    expect(composite[0].state.globalAlpha).toBeCloseTo(0.6, 12)
    expect(composite[0].at).toEqual({ x: 0, y: 0 })
    expect(composite[0].points![0]).toEqual({ x: 0, y: 0 })
    // Nothing of the dim is drawn on the main context directly.
    expect(span.some((op) => op.op === 'fillRect' || op.op === 'fill')).toBe(false)
    // Feather 0: a hard edge, no filter. No hole: no cut.
    const hard = fake(SIZE.width, SIZE.height)
    paintDrawList2d(hard.ctx, flat([{ ...dim('d', hole), hole: { box: hole, radius: 0, feather: 0 } } as DrawItem]), { layer })
    expect(made).toHaveLength(2)
    expect(made[1].layer.ops.find((op) => op.op === 'fill')!.state.filter).toBe('none')
    const whole = fake(SIZE.width, SIZE.height)
    paintDrawList2d(whole.ctx, flat([dim('d')]), { layer })
    expect(made).toHaveLength(3)
    expect(made[2].layer.ops.some((op) => op.op === 'fill')).toBe(false)
    expect(made[2].layer.ops.some((op) => op.op === 'fillRect')).toBe(true)
    // A list without a size: no layer made, nothing composited (drawImage of a 0-sided canvas throws on a real context, measured).
    const sizeless = fake(0, 0)
    paintDrawList2d(sizeless.ctx, flat([dim('d')], { width: 0, height: 0 }), { layer })
    expect(made).toHaveLength(3)
    expect(sizeless.ops.some((op) => op.op === 'drawImage')).toBe(false)
  })

  it('the layer is cached per hole and size: only the opacity animates, a second frame makes no layer; another hole, size or colour makes one', () => {
    let made = 0
    const layer: PaintOptions['layer'] = (width, height) => {
      made++
      return fake(width, height).ctx
    }
    const hole = rect(300, 600, 200, 200)
    const alphas: number[] = []
    for (const opacity of [0.2, 0.5, 1]) {
      const { ctx, ops } = fake(SIZE.width, SIZE.height)
      paintDrawList2d(ctx, flat([dim('d', hole, { opacity })]), { layer })
      alphas.push(itemSpans(ops)[0].find((op) => op.op === 'drawImage')!.state.globalAlpha)
    }
    expect(made).toBe(1)
    expect(alphas.map((a) => Number(a.toFixed(12)))).toEqual([0.2, 0.5, 1])
    paintDrawList2d(fake(SIZE.width, SIZE.height).ctx, flat([dim('d', rect(300, 600, 200, 201))]), { layer })
    expect(made).toBe(2)
    paintDrawList2d(fake(SMALL.width, SMALL.height).ctx, flat([dim('d', hole)], SMALL), { layer })
    expect(made).toBe(3)
    paintDrawList2d(fake(SIZE.width, SIZE.height).ctx, flat([dim('d', hole, { color: '#ffffff' })]), { layer })
    expect(made).toBe(4)
    // The first hole again, three others since: still cached.
    paintDrawList2d(fake(SIZE.width, SIZE.height).ctx, flat([dim('d', hole)]), { layer })
    expect(made).toBe(4)
    // The memo is BOUNDED (a layer is a frame-sized canvas), whatever its policy: after a fifth distinct layer, painting all five again makes at least one more; after eight distinct, at most 8 + 5 were ever made.
    const five: DrawList[] = [flat([dim('d', hole)]), flat([dim('d', rect(300, 600, 200, 201))]), flat([dim('d', hole)], SMALL), flat([dim('d', hole, { color: '#ffffff' })]), flat([dim('d', hole, { alpha: 0.5 })])]
    paintDrawList2d(fake(SIZE.width, SIZE.height).ctx, five[4], { layer })
    expect(made).toBe(5)
    for (const list of five) paintDrawList2d(fake(list.width, list.height).ctx, list, { layer })
    expect(made).toBeGreaterThan(5)
    const before = made
    for (const alpha of [0.6, 0.7, 0.8]) paintDrawList2d(fake(SIZE.width, SIZE.height).ctx, flat([dim('d', hole, { alpha })]), { layer })
    expect(made).toBe(before + 3)
    expect(made).toBeLessThanOrEqual(8 + 5)
    // Another caller's layer factory never sees this one's contexts.
    let other = 0
    paintDrawList2d(fake(SIZE.width, SIZE.height).ctx, flat([dim('d', hole)]), {
      layer: (w, h) => {
        other++
        return fake(w, h).ctx
      }
    })
    expect(other).toBe(1)
    expect(made).toBe(before + 3)
  })

  it('a `layer` factory that hands back a canvas the painter already holds is refused: the cache composites its canvases on later frames', () => {
    const shared = fake(SIZE.width, SIZE.height)
    const scratch: PaintOptions['layer'] = () => shared.ctx
    const hole = rect(300, 600, 200, 200)
    paintDrawList2d(fake(SIZE.width, SIZE.height).ctx, flat([dim('d', hole)]), { layer: scratch })
    expect(() => paintDrawList2d(fake(SIZE.width, SIZE.height).ctx, flat([dim('d', rect(0, 0, 50, 50))]), { layer: scratch })).toThrow(/new canvas/)
    // The same dim again is the cached one: no new layer asked for, no throw.
    expect(() => paintDrawList2d(fake(SIZE.width, SIZE.height).ctx, flat([dim('d', hole)]), { layer: scratch })).not.toThrow()
  })
})

/* ------------------------------------------------------ order and transform */

describe('graphicPaint: the order of operations', () => {
  it('items are drawn in list order, each between its own save and restore, with the whole list between one more pair', () => {
    const items: DrawItem[] = [shape('a', rect(0, 0, 10, 10), { fill: '#111111' }), shape('b', rect(0, 0, 10, 10), { fill: '#222222' }), shape('c', rect(0, 0, 10, 10), { fill: '#333333' })]
    const { ctx, ops } = fake(SIZE.width, SIZE.height)
    paintDrawList2d(ctx, flat(items))
    expect(ops.filter((op) => op.op === 'fill').map((op) => op.state.fill)).toEqual(['#111111', '#222222', '#333333'])
    expect(ops[0].op).toBe('save')
    expect(ops[ops.length - 1]).toMatchObject({ op: 'restore', depth: 1 })
    expect(ops.filter((op) => op.op === 'save')).toHaveLength(4)
    expect(ops.filter((op) => op.op === 'restore')).toHaveLength(4)
    expect(itemSpans(ops)).toHaveLength(3)
    // An empty list saves and restores, nothing more.
    const empty = fake(SIZE.width, SIZE.height)
    paintDrawList2d(empty.ctx, flat([]))
    expect(empty.ops.map((op) => op.op)).toEqual(['save', 'restore'])
  })

  it("a kind that throws (a path flattenPath refuses) still leaves the caller's context as it was: every save restored, the error propagated", () => {
    const { ctx, ops } = fake(SIZE.width, SIZE.height)
    ctx.globalAlpha = 0.7
    const bad = stroke('arc', 'M0 0 A10 10 0 0 1 20 20', { opacity: 0.5, transform: { x: 5, y: 5, scale: 2, rotate: 10 } })
    expect(() => paintDrawList2d(ctx, flat([shape('a', rect(0, 0, 10, 10)), bad]), { offset: { x: 3, y: 3 } })).toThrow(/arcs/)
    expect(ops.filter((op) => op.op === 'save')).toHaveLength(3)
    expect(ops.filter((op) => op.op === 'restore')).toHaveLength(3)
    expect(ctx.globalAlpha).toBe(0.7)
    // What was drawn before the throw reached the context.
    expect(ops.some((op) => op.op === 'fill')).toBe(true)
  })

  it("opacity multiplies into globalAlpha down the group tree; an item nothing of which shows draws nothing", () => {
    const items: DrawItem[] = [
      { kind: 'group', id: 'g', opacity: 0.5, children: [shape('a', rect(0, 0, 10, 10), { fill: '#111111', opacity: 0.5 }), { kind: 'group', id: 'h', opacity: 0.5, children: [shape('b', rect(0, 0, 10, 10), { fill: '#222222' })] }] },
      shape('c', rect(0, 0, 10, 10), { fill: '#333333', opacity: 0.25 }),
      shape('z', rect(0, 0, 10, 10), { fill: '#444444', opacity: 0 })
    ]
    const { ctx, ops } = fake(SIZE.width, SIZE.height)
    paintDrawList2d(ctx, flat(items))
    const alpha = (fill: string): number => ops.find((op) => op.op === 'fill' && op.state.fill === fill)!.state.globalAlpha
    expect(alpha('#111111')).toBeCloseTo(0.25, 12)
    expect(alpha('#222222')).toBeCloseTo(0.25, 12)
    expect(alpha('#333333')).toBeCloseTo(0.25, 12)
    expect(ops.some((op) => op.state.fill === '#444444')).toBe(false)
    // The context's own alpha going in is honoured too.
    const dimmed = fake(SIZE.width, SIZE.height)
    dimmed.ctx.globalAlpha = 0.5
    paintDrawList2d(dimmed.ctx, flat([shape('c', rect(0, 0, 10, 10), { fill: '#333333', opacity: 0.5 })]))
    expect(dimmed.ops.find((op) => op.op === 'fill')!.state.globalAlpha).toBeCloseTo(0.25, 12)
    expect(dimmed.ctx.globalAlpha).toBe(0.5)
  })

  it("a transform is applied about the item's own centre, the point itemBounds turns about: the painted corners' box equals itemBounds", () => {
    const cases: DrawItem[] = [
      shape('r', rect(100, 100, 200, 100), { transform: { x: 0, y: 0, scale: 1, rotate: 90 } }),
      shape('s', rect(100, 100, 200, 100), { transform: { x: 10, y: 20, scale: 2, rotate: 0 } }),
      shape('t', rect(100, 100, 200, 100), { transform: { x: -30, y: 5, scale: 0.5, rotate: 37 } }),
      { kind: 'image', id: 'i', opacity: 1, src: 'a.png', box: rect(50, 50, 80, 40), fit: 'contain', transform: { x: 0, y: 0, scale: 3, rotate: 180 } }
    ]
    const images = new Map([['a.png', { width: 80, height: 40 } as unknown as ImageBitmap]])
    for (const item of cases) {
      const { ctx, ops } = fake(SIZE.width, SIZE.height)
      paintDrawList2d(ctx, flat([item]), { images })
      const op = ops.find((o) => o.op === 'fill' || o.op === 'drawImage')!
      expect(op, item.id).toBeTruthy()
      const bounds = itemBounds(item, SIZE) as Rect
      const corners = op.op === 'fill' ? op.path[0].points : op.points!
      closeRect(bbox(corners), bounds)
      if (item.id === 'i') closeRect(bounds, rect(90 - 120, 70 - 60, 240, 120))
    }
    // Without a transform, the painted rect is the box itself.
    const plain = fake(SIZE.width, SIZE.height)
    paintDrawList2d(plain.ctx, flat([shape('p', rect(100, 100, 200, 100))]))
    closeRect(bbox(plain.ops.find((o) => o.op === 'fill')!.path[0].points), rect(100, 100, 200, 100))
  })

  it("a group's transform is about its children's union centre, each child then under its own; a stroke's about its points' centre, its head riding", () => {
    const group: DrawItem = {
      kind: 'group',
      id: 'g',
      opacity: 1,
      transform: { x: 0, y: 0, scale: 2, rotate: 0 },
      children: [shape('a', rect(0, 0, 100, 50)), shape('b', rect(100, 0, 100, 50), { transform: { x: 50, y: 0, scale: 1, rotate: 0 } })]
    }
    const { ctx, ops } = fake(SIZE.width, SIZE.height)
    paintDrawList2d(ctx, flat([group]))
    const fills = ops.filter((op) => op.op === 'fill')
    expect(fills).toHaveLength(2)
    closeRect(bbox(fills.flatMap((op) => op.path[0].points)), itemBounds(group, SIZE) as Rect)
    closeRect(bbox(fills[0].path[0].points), rect(-125, -25, 200, 100))
    closeRect(bbox(fills[1].path[0].points), rect(175, -25, 200, 100))

    // A stroke scaled 2 about its points' centre (300, 100), with an offset of (−50, −50): the tip, at the centre, lands at (250, 50); the start at (−150, 50).
    const item = stroke('k', HEAD, { from: 0, to: 0.5, heads: { end: { size: 40, grow: 1 } }, transform: { x: 0, y: 0, scale: 2, rotate: 0 } })
    const moved = fake(SIZE.width, SIZE.height)
    paintDrawList2d(moved.ctx, flat([item]), { offset: { x: -50, y: -50 } })
    const head = moved.ops.find((op) => op.op === 'fill')!
    const tip = head.path[0].points[0]
    expect(tip.x).toBeCloseTo(250, 9)
    expect(tip.y).toBeCloseTo(50, 9)
    const line = moved.ops.find((op) => op.op === 'stroke')!
    expect(line.path[0].points[0].x).toBeCloseTo(-150, 9)
    expect(line.path[0].points[0].y).toBeCloseTo(50, 9)
    // The width is in frame units before the transform: the context's lineWidth is still strokeWidth's (the CTM scales it on the canvas).
    expect(line.state.lineWidth).toBe(strokeWidth(4, SIZE))
  })

  it('z, camera and glow change nothing the painter does', () => {
    const items: DrawItem[] = [shape('a', rect(0, 0, 10, 10), { fill: '#111111' }), ...field('forty', 'word', 'clean'), stroke('k', HEAD, { heads: { end: { size: 20, grow: 1 } } })]
    const flatRun = fake(SIZE.width, SIZE.height)
    paintDrawList2d(flatRun.ctx, flat(items))
    const deep = fake(SIZE.width, SIZE.height)
    paintDrawList2d(deep.ctx, {
      ...flat(items.map((item, i) => ({ ...item, z: 0.05 * i }))),
      camera: { tilt: 5, yaw: 2, dolly: 0.2, fov: 40, focus: { z: 0, px: 4 } },
      glow: [{ item: 'a', radius: 12, strength: 0.6 }]
    })
    expect(deep.ops).toEqual(flatRun.ops)
    expect(flatRun.ops.filter((op) => op.op === 'fill' || op.op === 'fillText' || op.op === 'stroke').length).toBeGreaterThanOrEqual(3)
  })
})
