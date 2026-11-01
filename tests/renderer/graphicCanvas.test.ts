import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TEXT, type TextSpec } from '@shared/timeline'
import { graphemesOf, textItems, textSpecOf, type DrawItem, type Drawer, type GraphicTargets, type TextLook } from '@shared/graphics/items'
import { graphicBox } from '@shared/graphics/drawList'
import { beatFrame, graphicMovingFrames } from '@shared/graphics/frame'
import { resolveGraphicStyle, type GraphicStyle } from '@shared/graphics/style'
import type { GraphicSpec } from '@shared/graphics/template'
import { drawTextOnto, INDIC_FONTS, textSpecFont } from '@shared/render/textPaint'
import { ASCENT, LINE_HEIGHT } from '@shared/render/textLayout'
import { mediaUrl } from '@shared/mediaUrl'
import { isBaking, resetBakeGuard } from '@shared/bakeGuard'
import { useCatalog } from '../../src/renderer/src/catalog'
import { setPoolCanvases } from '../../src/renderer/src/encodePool'
import {
  GRAPHIC_BAKE_REGION,
  GRAPHIC_POOL_DEPTH,
  bakeGraphicSequence,
  forgetGraphicPreview,
  graphicFrameCanvases,
  graphicMeasure,
  graphicPreviewCanvas
} from '../../src/renderer/src/graphicCanvas'

/*
 * The renderer's three pictures of a graphic (docs/CLIPS.md §6.3,
 * "`graphicCanvas.ts` — preview, bake, frames") and its measure, driven in
 * node on a document of fake canvases, in the manner of
 * tests/renderer/indicFontSites.test.ts (the catalogue's `ensureFont` a
 * recorder, `document` stood in for) and tests/graphicPaint.test.ts (a 2D
 * context that records every call with the state set when it was made and
 * the device point it landed on). Every graphic draws through the drawer
 * seam with a hand-built drawer: phase 1 has no template.
 */

/* ---------------------------------------------------------------- the fake */

type Mat = [number, number, number, number, number, number]
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5]
]

interface Op {
  op: string
  /** The call's first point, in device space. */
  at: { x: number; y: number }
  text?: string
  font: string
  letterSpacing: string
  image?: unknown
}

interface FakeCanvas {
  width: number
  height: number
  dataset: Record<string, string>
  ctx: CanvasRenderingContext2D
  ops: Op[]
  clears: number
  measures: { text: string; font: string; letterSpacing: string }[]
  toBlob: (callback: (blob: Blob | null) => void, type?: string) => void
  getContext: (id: string) => CanvasRenderingContext2D | null
}

const EM = 0.55
/** The fake's advance per grapheme, of the font's size; one test moves it to show a stale memo. */
const fakeEm = { value: EM }
const pxOf = (font: string): number => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10)
const graphemeCount = (text: string): number => {
  const parts = graphemesOf(text)
  if (parts === null) throw new Error('node 24 has Intl.Segmenter')
  return parts.length
}

/** The document's state: every canvas made in this case, in order; and every one ever made, for the measure's scratch, which outlives a case. */
const made: FakeCanvas[] = []
const everMade: FakeCanvas[] = []
let inFlight = 0
let maxInFlight = 0
/** Whether the fake's `measureText` reports the glyphs' own bounds; off for the nominal-fallback case. */
const bounds = { value: true }

function fakeCanvas(): FakeCanvas {
  const ops: Op[] = []
  const measures: FakeCanvas['measures'] = []
  let ctm: Mat = IDENTITY
  const state: Record<string | symbol, unknown> = { font: '10px sans-serif', letterSpacing: '0px', globalAlpha: 1, fillStyle: '#000000' }
  const stack: { ctm: Mat; state: Record<string | symbol, unknown> }[] = []
  const stub: unknown = new Proxy(function stub() {}, { get: () => stub, apply: () => stub })
  const device = (x: number, y: number): { x: number; y: number } => ({ x: ctm[0] * x + ctm[2] * y + ctm[4], y: ctm[1] * x + ctm[3] * y + ctm[5] })
  const record = (op: string, x: number, y: number, extra: Partial<Op> = {}): void => {
    ops.push({ op, at: device(x, y), font: String(state.font), letterSpacing: String(state.letterSpacing), ...extra })
  }
  const canvas: FakeCanvas = {
    width: 0,
    height: 0,
    dataset: {},
    ops,
    clears: 0,
    measures,
    ctx: null as unknown as CanvasRenderingContext2D,
    toBlob: (callback) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      setTimeout(() => {
        inFlight--
        callback(new Blob([new Uint8Array([ops.length & 255])]))
      }, 2)
    },
    getContext: () => canvas.ctx
  }
  const methods: Record<string, (...args: never[]) => unknown> = {
    save: () => stack.push({ ctm, state: { ...state } }),
    restore: () => {
      const top = stack.pop()
      if (top) {
        ctm = top.ctm
        for (const key of Object.keys(state)) delete state[key]
        Object.assign(state, top.state)
      }
    },
    translate: (x: number, y: number) => (ctm = mul(ctm, [1, 0, 0, 1, x, y])),
    scale: (sx: number, sy: number) => (ctm = mul(ctm, [sx, 0, 0, sy, 0, 0])),
    rotate: (r: number) => (ctm = mul(ctm, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0])),
    clearRect: () => void canvas.clears++,
    fillText: (text: string, x: number, y: number) => record('fillText', x, y, { text }),
    strokeText: (text: string, x: number, y: number) => record('strokeText', x, y, { text }),
    rect: (x: number, y: number) => record('rect', x, y),
    roundRect: (x: number, y: number) => record('roundRect', x, y),
    fillRect: (x: number, y: number) => record('fillRect', x, y),
    drawImage: (image: unknown, ...rest: number[]) => {
      // The destination origin: the 2- and 4-argument forms' first pair, the 8-argument form's fifth and sixth.
      const [x, y] = rest.length >= 8 ? [rest[4], rest[5]] : [rest[0], rest[1]]
      record('drawImage', x, y, { image })
    },
    measureText: (text: string) => {
      const px = pxOf(String(state.font))
      measures.push({ text, font: String(state.font), letterSpacing: String(state.letterSpacing) })
      return bounds.value
        ? { width: graphemeCount(text) * px * fakeEm.value, actualBoundingBoxAscent: ASCENT * px + 3, actualBoundingBoxDescent: (LINE_HEIGHT - ASCENT) * px + 2 }
        : { width: graphemeCount(text) * px * fakeEm.value }
    }
  }
  canvas.ctx = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'canvas') return canvas
        if (typeof key === 'string' && key in methods) return methods[key]
        if (key in state) return state[key]
        return () => stub
      },
      set(_target, key, value) {
        state[key] = value
        return true
      }
    }
  ) as CanvasRenderingContext2D
  made.push(canvas)
  everMade.push(canvas)
  return canvas
}

/** Canvases of a picture's size: not the measure's 1×1 scratch. */
const pictures = (): FakeCanvas[] => made.filter((c) => c.width > 1)

let asked: string[] = []
let written: { clipId: string; frame: number; bytes: number }[] = []
let cleared: string[] = []
let fetched: string[] = []
/** Holds `clearTitleFrames` until released, per call, when set. */
let holdClear: (() => void)[] | null = null
const real = (({ ensureFont, loadedFonts, failedFonts }) => ({ ensureFont, loadedFonts, failedFonts }))(useCatalog.getState())

const FAKE_BITMAP = { width: 64, height: 32, close: () => undefined, fake: 'bitmap' }

beforeEach(() => {
  made.length = 0
  inFlight = 0
  maxInFlight = 0
  asked = []
  written = []
  cleared = []
  fetched = []
  holdClear = null
  fakeEm.value = EM
  bounds.value = true
  resetBakeGuard()
  useCatalog.setState({
    ensureFont: async (family: string) => {
      asked.push(family)
      return true
    },
    loadedFonts: new Set(),
    failedFonts: new Map()
  })
  vi.stubGlobal('document', { createElement: () => fakeCanvas(), fonts: { check: () => true } })
  vi.stubGlobal('window', {
    forge: {
      clearTitleFrames: async (clipId: string) => {
        cleared.push(clipId)
        if (holdClear) await new Promise<void>((resolve) => holdClear!.push(resolve))
      },
      writeTitleFrame: async (clipId: string, frame: number, bytes: ArrayBuffer) => {
        written.push({ clipId, frame, bytes: new Uint8Array(bytes)[0] })
        await new Promise((resolve) => setTimeout(resolve, 1))
        return `/cache/${clipId}.seq/%06d.png`
      }
    }
  })
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url)
    return { ok: !url.includes('missing'), status: url.includes('missing') ? 404 : 200, blob: async () => new Blob([new Uint8Array([1])]) }
  })
  vi.stubGlobal('createImageBitmap', async () => FAKE_BITMAP)
})

afterEach(() => {
  useCatalog.setState(real)
  setPoolCanvases(null)
  vi.unstubAllGlobals()
})

/* ---------------------------------------------------------- the graphic */

const SIZE = { width: 1080, height: 1920 }
const FPS = 30
const TOTAL = 90
const HINDI = 'प्रिय मित्र'
const IMAGE = '/assets/pics/logo.png'
/** The bake's own, since a decoded image is kept across cases. */
const IMAGE_BAKED = '/assets/pics/baked.png'

const clean = (): GraphicStyle => resolveGraphicStyle('clean')

function spec(over: Partial<GraphicSpec> = {}): GraphicSpec {
  return {
    data: { template: 'counter', value: '40', label: 'forty' },
    seconds: 3,
    beats: [0.5],
    place: { auto: true, third: 'middle' },
    seed: 1,
    version: 0,
    ...over
  }
}

/**
 * A drawer whose label slides right with `t` (200 px a second, so a held
 * frame is told from a moving one), with a box at the subject when there is
 * one, a tip mark when there is one, and, when asked, an image, a dim and a
 * Hindi line.
 */
function drawer(options: { image?: string; dim?: boolean; hindi?: boolean; empty?: boolean } = {}): Drawer {
  return (s, style, clock, size, measure, targets) => {
    if (options.empty) return { items: [] }
    const label = s.data.template === 'counter' ? s.data.label : 'label'
    const look: TextLook = { textStyleId: style.textStyleId, font: style.font, px: 60, align: 'left' }
    const items: DrawItem[] = textItems({ id: 'label', text: label, look, at: { x: 100 + 200 * clock.t, y: 800, width: 800 }, unit: 'line', source: 'label' }, measure)
    // Built by hand in the style's own face, as a template's fixed glyph would be, so the Noto face is the site's to add (`facesFor`), not `textItems`' (which sets a shaped piece's face itself).
    if (options.hindi) items.push({ kind: 'text', id: 'hindi', opacity: 1, text: HINDI, look, box: { x: 100, y: 900, width: 400, height: Math.round(60 * LINE_HEIGHT) } })
    if (targets.subject) items.push({ kind: 'shape', id: 'subject', opacity: 1, shape: 'rect', box: { ...targets.subject }, fill: '#ff0000' })
    if (targets.tip) items.push({ kind: 'shape', id: 'tip', opacity: 1, shape: 'rect', box: { x: targets.tip.x, y: targets.tip.y, width: 4, height: 4 }, fill: '#00ff00' })
    if (options.image) items.push({ kind: 'image', id: 'pic', opacity: 1, src: options.image, box: { x: 500, y: 1000, width: 200, height: 100 }, fit: 'contain' })
    if (options.dim) items.unshift({ kind: 'dim', id: 'dim', opacity: 0.5, color: '#000000', alpha: 0.4, hole: { box: { x: 300, y: 600, width: 200, height: 200 }, radius: 12, feather: 0 } })
    void size
    return { items }
  }
}

const NO_TARGETS = (): GraphicTargets => ({})
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10))
const labelFill = (c: FakeCanvas): Op[] => c.ops.filter((o) => o.op === 'fillText' && o.text === 'forty')

/* ---------------------------------------------------------- the measure */

describe('textSpecFont and the renderer’s measure', () => {
  const look = (textStyleId: string, px = 60): TextLook => ({ textStyleId, font: 'Montserrat', px, align: 'left' })
  const itemSpec = (styleId: string, px = 60): { spec: TextSpec; height: number } => {
    const height = Math.round(px * LINE_HEIGHT)
    return { spec: textSpecOf('Hello', look(styleId, px), { x: 0, y: 0, width: 0, height }), height }
  }

  it('is the font and letter spacing drawTextOnto sets for its fill pass, under a plain style, a face that scales (hero, glow-bar), an italic one and the styleless route with tracking', () => {
    const cases: { spec: TextSpec; height: number; name: string }[] = [
      { ...itemSpec('clean'), name: 'clean' },
      { ...itemSpec('hero'), name: 'hero' },
      { ...itemSpec('glow-bar'), name: 'glow-bar' },
      { ...itemSpec('neon-green'), name: 'neon-green' },
      { ...itemSpec('clean', 4), name: 'clean at 4 px, floored at 8' },
      { spec: { ...DEFAULT_TEXT, version: 1, font: 'Anton', size: 0.05, tracking: 0.1, styleId: undefined, content: 'Hello' }, height: 1920, name: 'styleless, tracking 0.1' }
    ]
    for (const { spec: s, height, name } of cases) {
      const canvas = fakeCanvas()
      drawTextOnto(canvas.ctx, s, 1080, height)
      const fills = canvas.ops.filter((o) => o.op === 'fillText')
      expect(fills.length, name).toBeGreaterThan(0)
      const last = fills[fills.length - 1]
      const got = textSpecFont(s, height)
      expect(got.font, name).toBe(last.font)
      expect(got.letterSpacing, name).toBe(last.letterSpacing)
      expect(got.px, name).toBe(pxOf(last.font))
    }
    // The faces that scale really do: hero's 0.42 of 60, glow-bar's 0.7; the floor of 8 at 4 px.
    expect(textSpecFont(itemSpec('hero').spec, itemSpec('hero').height).px).toBe(25)
    expect(textSpecFont(itemSpec('glow-bar').spec, itemSpec('glow-bar').height).px).toBe(42)
    expect(textSpecFont(itemSpec('clean').spec, itemSpec('clean').height).px).toBe(60)
    expect(textSpecFont(itemSpec('clean', 4).spec, itemSpec('clean', 4).height).px).toBe(8)
    expect(textSpecFont(itemSpec('neon-green').spec, itemSpec('neon-green').height).font).toMatch(/^italic /)
    expect(textSpecFont({ ...DEFAULT_TEXT, version: 1, size: 0.05, tracking: 0.1 }, 1920).letterSpacing).toBe('9.60px')
  })

  it('measures with the scratch context set to that font and spacing, at the drawn size, the glyphs’ own bounds, and the nominal ones where a context gives none', () => {
    const measure = graphicMeasure()
    const hello = measure('Hello', look('hero'))
    const scratch = everMade.find((c) => c.width === 1 && c.height === 1)
    expect(scratch, 'a 1×1 scratch canvas').toBeDefined()
    const m = scratch!.measures.find((x) => x.text === 'Hello')
    expect(m).toBeDefined()
    const expected = textSpecFont(itemSpec('hero').spec, itemSpec('hero').height)
    expect(m!.font).toBe(expected.font)
    expect(m!.letterSpacing).toBe(expected.letterSpacing)
    // hero draws 60 px at 0.42: 25 px, and the width is of the drawn size, not the look's.
    expect(hello.width).toBeCloseTo(5 * 25 * EM, 9)
    expect(hello.ascent).toBeCloseTo(ASCENT * 25 + 3, 9)
    expect(hello.descent).toBeCloseTo((LINE_HEIGHT - ASCENT) * 25 + 2, 9)

    bounds.value = false
    const plain = measure('World', look('clean'))
    expect(plain.width).toBeCloseTo(5 * 60 * EM, 9)
    expect(plain.ascent).toBeCloseTo(ASCENT * 60, 9)
    expect(plain.descent).toBeCloseTo((LINE_HEIGHT - ASCENT) * 60, 9)
  })

  it('remembers a measurement until a face lands or fails, then measures again', () => {
    const measure = graphicMeasure()
    const scratch = (): FakeCanvas => everMade.find((c) => c.width === 1 && c.height === 1)!
    const count = (): number => scratch().measures.filter((x) => x.text === 'Memo').length
    const first = measure('Memo', look('clean'))
    measure('Memo', look('clean'))
    expect(count()).toBe(1)
    expect(first.width).toBeCloseTo(4 * 60 * EM, 9)

    // The face lands: what the family measures as has changed.
    fakeEm.value = 0.7
    useCatalog.setState({ loadedFonts: new Set(['Montserrat']) })
    const landed = measure('Memo', look('clean'))
    expect(count()).toBe(2)
    expect(landed.width).toBeCloseTo(4 * 60 * 0.7, 9)
    measure('Memo', look('clean'))
    expect(count()).toBe(2)

    // A face failing for good is a change too.
    useCatalog.setState({ failedFonts: new Map([['Zz', 'not in the catalog']]) })
    measure('Memo', look('clean'))
    expect(count()).toBe(3)
    // Leave the memo on a state no later case starts from.
    useCatalog.setState({ loadedFonts: new Set(['Montserrat', 'Anton', 'Zz']) })
  })
})

/* ----------------------------------------------------------- the preview */

describe('graphicPreviewCanvas', () => {
  const settledCatalogue = (): void => useCatalog.setState({ loadedFonts: new Set(['Montserrat', ...INDIC_FONTS]) })
  const clock = (frame: number): { frame: number; total: number; fps: number } => ({ frame, total: TOTAL, fps: FPS })
  const MOVING = graphicMovingFrames(spec(), clean(), FPS, TOTAL)

  it('draws the frame asked, caches it per clip, and redraws only when the spec, the style, the targets, the size or the frame changes, never for the version', () => {
    settledCatalogue()
    const d = drawer()
    const a = graphicPreviewCanvas('g1', spec(), clean(), SIZE.width, SIZE.height, clock(10), NO_TARGETS(), undefined, d)!
    expect(a).toBeTruthy()
    const canvas = made.find((c) => (c as unknown) === (a as unknown))!
    expect(canvas.clears).toBe(1)
    expect(canvas.dataset.forgeRev).toBeTruthy()
    const stamp = canvas.dataset.forgeRev

    expect(graphicPreviewCanvas('g1', spec(), clean(), SIZE.width, SIZE.height, clock(10), NO_TARGETS(), undefined, d)).toBe(a)
    expect(graphicPreviewCanvas('g1', spec({ version: 7 }), clean(), SIZE.width, SIZE.height, clock(10), NO_TARGETS(), undefined, d)).toBe(a)
    expect(canvas.clears, 'cached for the same picture and for a version bump').toBe(1)
    expect(canvas.dataset.forgeRev).toBe(stamp)

    graphicPreviewCanvas('g1', spec({ data: { template: 'counter', value: '41', label: 'forty' } }), clean(), SIZE.width, SIZE.height, clock(10), NO_TARGETS(), undefined, d)
    expect(canvas.clears, 'the spec changed').toBe(2)
    expect(canvas.dataset.forgeRev).not.toBe(stamp)
    graphicPreviewCanvas('g1', spec(), clean(), SIZE.width, SIZE.height, clock(10), NO_TARGETS(), undefined, d)
    expect(canvas.clears).toBe(3)
    graphicPreviewCanvas('g1', spec(), resolveGraphicStyle('clean', { 'palette.accent': '#00FF00' }), SIZE.width, SIZE.height, clock(10), NO_TARGETS(), undefined, d)
    expect(canvas.clears, 'the style changed').toBe(4)
    graphicPreviewCanvas('g1', spec(), clean(), SIZE.width, SIZE.height, clock(10), { subject: { x: 1, y: 2, width: 3, height: 4 } }, undefined, d)
    expect(canvas.clears, 'the targets changed').toBe(5)
    graphicPreviewCanvas('g1', spec(), clean(), 540, 960, clock(10), NO_TARGETS(), undefined, d)
    expect(canvas.clears, 'the size changed').toBe(6)
    expect(canvas.width).toBe(540)
    graphicPreviewCanvas('g1', spec(), clean(), 540, 960, clock(11), NO_TARGETS(), undefined, d)
    expect(canvas.clears, 'a moving frame').toBe(7)
    expect(graphicPreviewCanvas('g2', spec(), clean(), 540, 960, clock(11), NO_TARGETS(), undefined, d)).not.toBe(a)
  })

  it('past the moving frames shows the last moving frame’s picture, what tpad holds, drawn once and held', () => {
    settledCatalogue()
    const d = drawer()
    expect(MOVING).toBe(beatFrame(1.0, FPS) + 1)
    const at = (frame: number): number => {
      const drawn = graphicPreviewCanvas('g3', spec(), clean(), SIZE.width, SIZE.height, clock(frame), NO_TARGETS(), undefined, d)
      const c = made.find((x) => (x as unknown) === (drawn as unknown))!
      return labelFill(c)[labelFill(c).length - 1].at.x
    }
    const atLastMoving = at(MOVING - 1)
    const canvas = made.find((c) => c.width === SIZE.width)!
    const before = canvas.clears
    expect(at(MOVING)).toBe(atLastMoving)
    expect(canvas.clears, 'the first held frame is drawn').toBe(before + 1)
    expect(at(TOTAL - 1)).toBe(atLastMoving)
    expect(at(MOVING + 7)).toBe(atLastMoving)
    expect(canvas.clears, 'and every later held frame is the cached picture').toBe(before + 1)
    // A moving frame earlier is somewhere else: the label slides 200 px a second.
    expect(at(0)).toBeCloseTo(atLastMoving - 200 * ((MOVING - 1) / FPS), 6)
    expect(canvas.dataset.forgeRev).toContain(`|${0}`)
  })

  it('while a face is loading, draws and does not cache, asks the catalogue once, and repaints once it lands; a Hindi item asks for its Noto face', async () => {
    const d = drawer({ hindi: true })
    let ready = 0
    const onReady = (): void => void ready++
    const first = graphicPreviewCanvas('g4', spec(), clean(), SIZE.width, SIZE.height, clock(5), NO_TARGETS(), onReady, d)!
    const canvas = made.find((c) => (c as unknown) === (first as unknown))!
    expect(canvas.clears).toBe(1)
    expect(asked).toContain('Montserrat')
    expect(asked).toContain('Noto Sans Devanagari')
    expect(asked).not.toContain('Noto Sans Telugu')
    // Not cached: the same frame is drawn again, and the faces, already asked for, are not asked again.
    graphicPreviewCanvas('g4', spec(), clean(), SIZE.width, SIZE.height, clock(5), NO_TARGETS(), onReady, d)
    expect(canvas.clears).toBe(2)
    expect(asked.filter((f) => f === 'Montserrat')).toHaveLength(1)
    await settle()
    // The recorder answered true but settled nothing (the catalogue before it has loaded): no repaint is owed, and nothing loops.
    expect(ready).toBe(0)

    // Now the faces land.
    useCatalog.setState({
      ensureFont: async (family: string) => {
        asked.push(family)
        useCatalog.setState((s) => ({ loadedFonts: new Set(s.loadedFonts).add(family) }))
        return true
      }
    })
    graphicPreviewCanvas('g4', spec(), clean(), SIZE.width, SIZE.height, clock(5), NO_TARGETS(), onReady, d)
    expect(canvas.clears).toBe(3)
    await settle()
    expect(ready).toBe(1)
    graphicPreviewCanvas('g4', spec(), clean(), SIZE.width, SIZE.height, clock(5), NO_TARGETS(), onReady, d)
    graphicPreviewCanvas('g4', spec(), clean(), SIZE.width, SIZE.height, clock(5), NO_TARGETS(), onReady, d)
    expect(canvas.clears, 'drawn once more, then cached').toBe(4)
    await settle()
    expect(ready).toBe(1)
  })

  it('a face that failed for good counts as settled: drawn in the fallback and cached', () => {
    useCatalog.setState({ loadedFonts: new Set(['Montserrat']), failedFonts: new Map([['Noto Sans Devanagari', 'not in the catalog']]) })
    const d = drawer({ hindi: true })
    const a = graphicPreviewCanvas('g5', spec(), clean(), SIZE.width, SIZE.height, clock(5), NO_TARGETS(), undefined, d)
    expect(graphicPreviewCanvas('g5', spec(), clean(), SIZE.width, SIZE.height, clock(5), NO_TARGETS(), undefined, d)).toBe(a)
    expect(made.find((c) => (c as unknown) === (a as unknown))!.clears).toBe(1)
    expect(asked).toEqual([])
  })

  it('an image item is fetched over the media scheme and decoded once, drawn and cached once it has, and skipped for good when it will not decode', async () => {
    settledCatalogue()
    const d = drawer({ image: IMAGE })
    let ready = 0
    const first = graphicPreviewCanvas('g6', spec(), clean(), SIZE.width, SIZE.height, clock(5), NO_TARGETS(), () => void ready++, d)!
    const canvas = made.find((c) => (c as unknown) === (first as unknown))!
    expect(canvas.ops.filter((o) => o.op === 'drawImage')).toEqual([])
    expect(fetched).toEqual([mediaUrl(IMAGE)])
    graphicPreviewCanvas('g6', spec(), clean(), SIZE.width, SIZE.height, clock(5), NO_TARGETS(), () => void ready++, d)
    expect(canvas.clears, 'not cached while decoding').toBe(2)
    expect(fetched, 'fetched once').toHaveLength(1)
    await settle()
    expect(ready).toBe(1)
    graphicPreviewCanvas('g6', spec(), clean(), SIZE.width, SIZE.height, clock(5), NO_TARGETS(), () => void ready++, d)
    const drawn = canvas.ops.filter((o) => o.op === 'drawImage')
    expect(drawn).toHaveLength(1)
    expect(drawn[0].image).toBe(FAKE_BITMAP)
    graphicPreviewCanvas('g6', spec(), clean(), SIZE.width, SIZE.height, clock(5), NO_TARGETS(), () => void ready++, d)
    expect(canvas.clears, 'cached once the image is in').toBe(3)

    const missing = drawer({ image: '/assets/pics/missing.png' })
    const m = graphicPreviewCanvas('g7', spec(), clean(), SIZE.width, SIZE.height, clock(5), NO_TARGETS(), undefined, missing)!
    const mc = made.find((c) => (c as unknown) === (m as unknown))!
    await settle()
    graphicPreviewCanvas('g7', spec(), clean(), SIZE.width, SIZE.height, clock(5), NO_TARGETS(), undefined, missing)
    graphicPreviewCanvas('g7', spec(), clean(), SIZE.width, SIZE.height, clock(5), NO_TARGETS(), undefined, missing)
    expect(mc.clears, 'drawn again once the failure is known, then cached').toBe(2)
    expect(mc.ops.filter((o) => o.op === 'drawImage')).toEqual([])
    expect(fetched.filter((u) => u.includes('missing')), 'not fetched again').toHaveLength(1)
  })

  it('forgetGraphicPreview drops the entry, so the next ask draws afresh', () => {
    settledCatalogue()
    const d = drawer()
    const a = graphicPreviewCanvas('g8', spec(), clean(), SIZE.width, SIZE.height, clock(5), NO_TARGETS(), undefined, d)!
    const canvas = made.find((c) => (c as unknown) === (a as unknown))!
    forgetGraphicPreview('g8')
    graphicPreviewCanvas('g8', spec(), clean(), SIZE.width, SIZE.height, clock(5), NO_TARGETS(), undefined, d)
    expect(canvas.clears, 'the old canvas is not redrawn').toBe(1)
    expect(made.filter((c) => c.width === SIZE.width)).toHaveLength(2)
  })

  it('a dim is drawn through a fresh layer canvas of the frame’s size, and a canvas under 2 px gives null', () => {
    settledCatalogue()
    const d = drawer({ dim: true })
    graphicPreviewCanvas('g9', spec(), clean(), SIZE.width, SIZE.height, clock(5), NO_TARGETS(), undefined, d)
    const layers = made.filter((c) => c.width === SIZE.width && c.ops.some((o) => o.op === 'fillRect'))
    expect(layers.length).toBe(1)
    expect(graphicPreviewCanvas('g9', spec(), clean(), 1, 1920, clock(5), NO_TARGETS(), undefined, d)).toBeNull()
  })
})

/* -------------------------------------------------------------- the bake */

describe('bakeGraphicSequence', () => {
  const MOVING = graphicMovingFrames(spec(), clean(), FPS, TOTAL)
  const settledCatalogue = (): void => useCatalog.setState({ loadedFonts: new Set(['Montserrat', ...INDIC_FONTS]) })

  it('M1’s constants: the box region and a depth of four', () => {
    expect(GRAPHIC_BAKE_REGION).toBe('box')
    expect(GRAPHIC_POOL_DEPTH).toBe(4)
  })

  it('clears the clip’s frames, then writes the moving frames only, in order, four in flight, through writeTitleFrame, and returns the pattern with the count', async () => {
    settledCatalogue()
    const result = await bakeGraphicSequence(spec(), clean(), 'clip-a', SIZE.width, SIZE.height, TOTAL, FPS, NO_TARGETS, false, drawer())
    expect(cleared).toEqual(['clip-a'])
    expect(result).toEqual({ pattern: '/cache/clip-a.seq/%06d.png', frames: MOVING })
    expect(MOVING).toBe(31)
    expect(written.map((w) => w.frame)).toEqual(Array.from({ length: MOVING }, (_, i) => i))
    expect(written.every((w) => w.clipId === 'clip-a')).toBe(true)
    expect(maxInFlight).toBe(GRAPHIC_POOL_DEPTH)
    // The canvas route: the pool's canvases are the frame's size, and the label is drawn where the frame puts it.
    const pool = pictures().filter((c) => c.ops.some((o) => o.op === 'fillText'))
    expect(pool.length).toBe(GRAPHIC_POOL_DEPTH)
    for (const c of pool) expect([c.width, c.height]).toEqual([SIZE.width, SIZE.height])
    const xs = pool.flatMap((c) => labelFill(c).map((o) => o.at.x))
    expect(Math.min(...xs)).toBeCloseTo(100, 6)
    expect(Math.max(...xs)).toBeCloseTo(100 + 200 * ((MOVING - 1) / FPS), 6)
  })

  it('on the box route, bakes graphicBox’s region into a box-sized canvas, each frame at −box.x, −box.y, and returns the box; the canvas route when the clip is not placed at the identity', async () => {
    settledCatalogue()
    const d = drawer()
    const box = graphicBox(spec(), clean(), FPS, TOTAL, SIZE, graphicMeasure(), NO_TARGETS, d)!
    expect(box).toBeTruthy()
    expect(box.width).toBeLessThan(SIZE.width)
    expect(box.height).toBeLessThan(SIZE.height)
    for (const v of [box.x, box.y, box.width, box.height]) expect(v % 2).toBe(0)

    const boxed = await bakeGraphicSequence(spec(), clean(), 'clip-b', SIZE.width, SIZE.height, TOTAL, FPS, NO_TARGETS, true, d)
    expect(boxed).toEqual({ pattern: '/cache/clip-b.seq/%06d.png', frames: MOVING, box })
    const pool = pictures().filter((c) => c.ops.some((o) => o.op === 'fillText'))
    expect(pool.length).toBe(GRAPHIC_POOL_DEPTH)
    for (const c of pool) expect([c.width, c.height]).toEqual([box.width, box.height])
    const xs = pool.flatMap((c) => labelFill(c).map((o) => o.at.x))
    const ys = pool.flatMap((c) => labelFill(c).map((o) => o.at.y))
    expect(Math.min(...xs)).toBeCloseTo(100 - box.x, 6)
    expect(Math.max(...xs)).toBeCloseTo(100 + 200 * ((MOVING - 1) / FPS) - box.x, 6)
    expect(new Set(ys).size).toBe(1)
    expect(ys[0]).toBeCloseTo(800 + Math.round(ASCENT * 60) - box.y, 6)

    made.length = 0
    const plain = await bakeGraphicSequence(spec(), clean(), 'clip-c', SIZE.width, SIZE.height, TOTAL, FPS, NO_TARGETS, false, d)
    expect(plain).toEqual({ pattern: '/cache/clip-c.seq/%06d.png', frames: MOVING })
    expect(plain).not.toHaveProperty('box')
    for (const c of pictures().filter((x) => x.ops.some((o) => o.op === 'fillText'))) expect([c.width, c.height]).toEqual([SIZE.width, SIZE.height])
  })

  it('a bake superseded while it clears writes nothing and answers null; one superseded mid-way stops writing; endBake runs in every case', async () => {
    settledCatalogue()
    holdClear = []
    const first = bakeGraphicSequence(spec(), clean(), 'clip-d', SIZE.width, SIZE.height, TOTAL, FPS, NO_TARGETS, false, drawer())
    await settle()
    expect(holdClear).toHaveLength(1)
    const second = bakeGraphicSequence(spec(), clean(), 'clip-d', SIZE.width, SIZE.height, TOTAL, FPS, NO_TARGETS, false, drawer())
    await settle()
    expect(holdClear).toHaveLength(2)
    expect(isBaking('clip-d')).toBe(true)
    for (const release of holdClear) release()
    holdClear = null
    expect(await first).toBeNull()
    expect(await second).toEqual({ pattern: '/cache/clip-d.seq/%06d.png', frames: MOVING })
    expect(written.map((w) => w.frame)).toEqual(Array.from({ length: MOVING }, (_, i) => i))
    expect(isBaking('clip-d')).toBe(false)

    // Mid-way: the fifth write starts another bake of the clip.
    written = []
    let third: Promise<unknown> | null = null
    const writeTitleFrame = window.forge.writeTitleFrame
    window.forge.writeTitleFrame = async (clipId, frame, bytes) => {
      const path = await writeTitleFrame(clipId, frame, bytes)
      if (written.length === 5 && third === null) third = bakeGraphicSequence(spec(), clean(), 'clip-e', SIZE.width, SIZE.height, TOTAL, FPS, NO_TARGETS, false, drawer())
      return path
    }
    const stopped = await bakeGraphicSequence(spec(), clean(), 'clip-e', SIZE.width, SIZE.height, TOTAL, FPS, NO_TARGETS, false, drawer())
    expect(stopped).toBeNull()
    expect(third).not.toBeNull()
    expect(await third!).toEqual({ pattern: '/cache/clip-e.seq/%06d.png', frames: MOVING })
    // The first bake stopped at its first check after the second claimed the clip (which the second does after its faces land, a few
    // microtasks past the fifth write), so it wrote at least five frames and well short of its run, an unbroken one; the second wrote all.
    const stoppedAt = written.length - MOVING
    expect(stoppedAt).toBeGreaterThanOrEqual(5)
    expect(stoppedAt).toBeLessThan(MOVING / 2)
    expect(written.slice(0, stoppedAt).map((w) => w.frame)).toEqual(Array.from({ length: stoppedAt }, (_, i) => i))
    expect(written.slice(stoppedAt).map((w) => w.frame)).toEqual(Array.from({ length: MOVING }, (_, i) => i))
    expect(isBaking('clip-e')).toBe(false)

    // A write that fails: the bake rejects, and the clip is not left "baking".
    window.forge.writeTitleFrame = async (_clipId, frame) => {
      if (frame === 3) throw new Error('disk full')
      await new Promise((resolve) => setTimeout(resolve, 1))
      return 'x'
    }
    await expect(bakeGraphicSequence(spec(), clean(), 'clip-f', SIZE.width, SIZE.height, TOTAL, FPS, NO_TARGETS, false, drawer())).rejects.toThrow('disk full')
    expect(isBaking('clip-f')).toBe(false)
  })

  it('waits for every face the lists draw, the style’s and a Hindi item’s Noto face, before any canvas is made', async () => {
    let release: () => void = () => undefined
    const held = new Promise<boolean>((resolve) => {
      release = () => resolve(true)
    })
    useCatalog.setState({
      ensureFont: (family: string) => {
        asked.push(family)
        return family === 'Noto Sans Devanagari' ? held : Promise.resolve(true)
      }
    })
    const done = bakeGraphicSequence(spec(), clean(), 'clip-g', SIZE.width, SIZE.height, TOTAL, FPS, NO_TARGETS, false, drawer({ hindi: true }))
    await settle()
    expect(asked).toContain('Montserrat')
    expect(asked).toContain('Noto Sans Devanagari')
    expect(asked).not.toContain('Noto Sans Telugu')
    expect(pictures(), 'a canvas made while the Noto face was still loading').toHaveLength(0)
    expect(cleared).toEqual([])
    release()
    expect(await done).toEqual({ pattern: '/cache/clip-g.seq/%06d.png', frames: MOVING })
    expect(pictures().length).toBeGreaterThan(0)
  })

  it('decodes every image the lists name before drawing, and hands the bitmap to the painter', async () => {
    settledCatalogue()
    const result = await bakeGraphicSequence(spec(), clean(), 'clip-h', SIZE.width, SIZE.height, TOTAL, FPS, NO_TARGETS, false, drawer({ image: IMAGE_BAKED }))
    expect(result).not.toBeNull()
    expect(fetched).toEqual([mediaUrl(IMAGE_BAKED)])
    const drawn = pictures().flatMap((c) => c.ops.filter((o) => o.op === 'drawImage'))
    expect(drawn.length).toBe(MOVING)
    expect(drawn.every((o) => o.image === FAKE_BITMAP)).toBe(true)
  })

  it('the subject is the onset’s on every frame though targetsAt moves it; a tip that changes past the settle extends the moving frames to it', async () => {
    settledCatalogue()
    const moving = (frame: number): GraphicTargets => ({ subject: { x: 100 + frame, y: 100, width: 50, height: 50 } })
    await bakeGraphicSequence(spec(), clean(), 'clip-i', SIZE.width, SIZE.height, TOTAL, FPS, moving, false, drawer())
    const rects = pictures().flatMap((c) => c.ops.filter((o) => o.op === 'rect'))
    expect(rects.length).toBe(MOVING)
    expect(new Set(rects.map((o) => o.at.x))).toEqual(new Set([100]))

    written = []
    const tip = (frame: number): GraphicTargets => ({ tip: frame >= 50 ? { x: 10, y: 10 } : null })
    const result = await bakeGraphicSequence(spec(), clean(), 'clip-j', SIZE.width, SIZE.height, TOTAL, FPS, tip, false, drawer())
    expect(result?.frames).toBe(51)
    expect(written.length).toBe(51)
  })

  it('answers null, clearing and writing nothing, for a graphic that draws nothing, no frames, or no rate', async () => {
    settledCatalogue()
    expect(await bakeGraphicSequence(spec(), clean(), 'clip-k', SIZE.width, SIZE.height, TOTAL, FPS, NO_TARGETS, true, drawer({ empty: true }))).toBeNull()
    expect(await bakeGraphicSequence(spec(), clean(), 'clip-k', SIZE.width, SIZE.height, TOTAL, FPS, NO_TARGETS, false, drawer({ empty: true }))).toBeNull()
    expect(await bakeGraphicSequence(spec(), clean(), 'clip-k', SIZE.width, SIZE.height, 0, FPS, NO_TARGETS, false, drawer())).toBeNull()
    expect(await bakeGraphicSequence(spec(), clean(), 'clip-k', SIZE.width, SIZE.height, TOTAL, 0, NO_TARGETS, false, drawer())).toBeNull()
    expect(cleared).toEqual([])
    expect(written).toEqual([])
    expect(isBaking('clip-k')).toBe(false)
  })
})

/* ------------------------------------------------------------ the frames */

describe('graphicFrameCanvases', () => {
  it('draws each asked frame on its own canvas of the frame’s size, as the drawer gives it, a frame past the clip as its last, after the faces have landed', async () => {
    let release: () => void = () => undefined
    const held = new Promise<boolean>((resolve) => {
      release = () => resolve(true)
    })
    useCatalog.setState({
      ensureFont: (family: string) => {
        asked.push(family)
        return family === 'Montserrat' ? held : Promise.resolve(true)
      }
    })
    const done = graphicFrameCanvases(spec(), clean(), SIZE.width, SIZE.height, TOTAL, FPS, [0, 15, 60, 95], NO_TARGETS, drawer())
    await settle()
    expect(asked).toContain('Montserrat')
    expect(pictures()).toHaveLength(0)
    release()
    const canvases = await done
    expect(canvases).toHaveLength(4)
    const fakes = canvases.map((c) => made.find((m) => (m as unknown) === (c as unknown))!)
    for (const c of fakes) expect([c.width, c.height]).toEqual([SIZE.width, SIZE.height])
    const x = (c: FakeCanvas): number => labelFill(c)[labelFill(c).length - 1].at.x
    expect(x(fakes[0])).toBeCloseTo(100, 6)
    expect(x(fakes[1])).toBeCloseTo(100 + 200 * (15 / FPS), 6)
    // A held frame is drawn as the drawer gives it, not as the last moving one: the check reads the two against each other.
    expect(x(fakes[2])).toBeCloseTo(100 + 200 * (60 / FPS), 6)
    expect(x(fakes[3])).toBeCloseTo(100 + 200 * ((TOTAL - 1) / FPS), 6)
  })
})
