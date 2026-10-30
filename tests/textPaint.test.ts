import { describe, expect, it } from 'vitest'
import { drawTextOnto, facesFor, indicFontsFor, INDIC_FONTS } from '@shared/render/textPaint'
import { APP_FONT_FILES, fontFamilyFromFilename } from '@shared/assets/catalog'
import { ASCENT, LINE_HEIGHT, layoutText } from '@shared/render/textLayout'
import { STILL, stepAt, textAnimationById } from '@shared/render/textAnimation'
import { DEFAULT_TEXT, type TextSpec } from '@shared/timeline'

/**
 * Where the painter puts each row — found on the first real ad (2026-09-26).
 *
 * The Hero style is a small lead-in over a big italic line. The end card
 * "Good Molecules Hyaluronic Acid Serum / Shop now" drew SHOP NOW straight
 * through the product's name: the painter stepped from the small row to the
 * big one by the SMALL row's line height, and the big caps, 0.82 of a big size
 * tall, climbed over the small words above them. A canvas with the fonts is
 * only in the renderer, so the painter is driven here with a stand-in context
 * that measures type by its size and records where every row lands.
 */

interface Placed {
  text: string
  y: number
  px: number
  /** The fillStyle set when this fillText ran. */
  fill: string
  /** The font shorthand set when this fillText ran. */
  font: string
}

/** A 2D context that measures a glyph as 0.6 of the font size and remembers each fillText. */
function fakeContext(): { ctx: CanvasRenderingContext2D; placed: Placed[] } {
  const placed: Placed[] = []
  const state: Record<string | symbol, unknown> = { font: '10px sans-serif', textAlign: 'left' }
  const pxOf = (): number => Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 10)
  // Anything else — a gradient, save/restore, a stroke — is a stub that answers with itself.
  const stub: unknown = new Proxy(function stub() {}, { get: () => stub, apply: () => stub })
  const ctx = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'measureText') return (text: string) => ({ width: text.length * pxOf() * 0.6 })
        if (key === 'fillText')
          return (text: string, _x: number, y: number) =>
            placed.push({
              text,
              y,
              px: pxOf(),
              // A gradient here is the stub, which has no string form.
              fill: typeof state.fillStyle === 'string' ? state.fillStyle : 'not a colour',
              font: String(state.font)
            })
        if (key in state) return state[key]
        return () => stub
      },
      set(_target, key, value) {
        state[key] = value
        return true
      }
    }
  ) as unknown as CanvasRenderingContext2D
  return { ctx, placed }
}

/** Each row once, in order — a row is filled several times (glow passes, the shadow, the fill), all at one baseline. */
function rowsOf(placed: Placed[]): Placed[] {
  const seen = new Map<string, Placed>()
  for (const p of placed) {
    const key = `${p.text}@${p.y}`
    if (!seen.has(key)) seen.set(key, p)
  }
  return [...seen.values()].sort((a, b) => a.y - b.y)
}

const spec = (over: Partial<TextSpec>): TextSpec => ({ ...DEFAULT_TEXT, size: 0.1, position: 'center', version: 1, ...over })
const W = 1080
const H = 1920

describe('rows of different sizes', () => {
  it('a big row never climbs over the small row above it: each baseline steps by its own ascent', () => {
    const { ctx, placed } = fakeContext()
    drawTextOnto(ctx, spec({ content: 'Good Molecules Hyaluronic Acid Serum\nShop now', styleId: 'hero' }), W, H)
    const rows = rowsOf(placed)
    // The lead-in wraps into small rows; SHOP NOW into big ones.
    expect(rows.length).toBeGreaterThanOrEqual(3)
    const sizes = new Set(rows.map((r) => r.px))
    expect(sizes.size).toBe(2)
    for (let i = 1; i < rows.length; i++) {
      const above = rows[i - 1]
      const row = rows[i]
      const top = row.y - row.px * ASCENT
      // The row's caps start under the previous baseline, with that row's descent between them.
      expect(top, `row ${i} "${row.text}" (${row.px}px) under "${above.text}" (${above.px}px)`).toBeGreaterThanOrEqual(above.y + above.px * (LINE_HEIGHT - ASCENT) - 1)
    }
  })

  it('the styled block is centred where the layout promised, not where the nominal size would put it', () => {
    const { ctx, placed } = fakeContext()
    drawTextOnto(ctx, spec({ content: 'Good Molecules Hyaluronic Acid Serum\nShop now', styleId: 'hero' }), W, H)
    const rows = rowsOf(placed)
    const top = rows[0].y - rows[0].px * ASCENT
    const bottom = rows[rows.length - 1].y + rows[rows.length - 1].px * (LINE_HEIGHT - ASCENT)
    expect(Math.abs((top + bottom) / 2 - H / 2)).toBeLessThanOrEqual(3)
  })

  it('plain rows of one size keep the layout’s own line height and first baseline', () => {
    const s = spec({ content: 'One\nTwo', styleId: undefined })
    const { ctx, placed } = fakeContext()
    drawTextOnto(ctx, s, W, H)
    const rows = rowsOf(placed)
    const layout = layoutText(s, W, H)
    expect(rows.map((r) => r.text)).toEqual(['ONE', 'TWO'])
    expect(rows[0].y).toBe(layout.firstBaseline)
    expect(rows[1].y - rows[0].y).toBe(layout.lineHeight)
  })
})

/*
 * Letters in motion, in a script whose letters join (D8, CLIPS §6.20, §16.61).
 *
 * `bounce` moves each letter, and the painter drew each code point with a
 * fillText of its own: प्रिय went out as प, ्, र, ि and य, a conjunct pulled
 * apart and an i-matra after its consonant. Each call a canvas makes shapes
 * only the string it is given, so the test of the fix is what reaches fillText.
 */
describe('a shaped line under a letter animation', () => {
  const HINDI = 'प्रिय मित्र किताब'
  const WORDS = HINDI.split(' ')
  const ACCENT = '#ff0000'
  // 0.3 s in: bounce's three word starts are 0, 0.125 and 0.25 s apart, so all
  // three are in flight and none has settled.
  const MID = { frame: 9, fps: 30 }
  // Small enough that the line stays one row: the accent is counted along a row.
  const hindi = (over: Partial<TextSpec> = {}): TextSpec =>
    spec({ content: HINDI, size: 0.03, styleId: undefined, animationId: 'bounce', ...over })

  it('the frame chosen is mid-flight for every word', () => {
    const bounce = textAnimationById('bounce')!
    expect(bounce.scope).toBe('char')
    for (let index = 0; index < WORDS.length; index++) {
      const step = stepAt(bounce, MID.frame, MID.fps, index, WORDS.length)
      expect(step, `word ${index}`).not.toEqual(STILL)
      expect(step.alpha, `word ${index}`).toBeGreaterThan(0.002)
    }
  })

  it('a Hindi line under bounce at a mid frame draws only whole words', () => {
    const { ctx, placed } = fakeContext()
    drawTextOnto(ctx, hindi(), W, H, MID)
    expect(new Set(placed.map((p) => p.y)).size, 'one row').toBe(1)
    expect(placed.length).toBeGreaterThan(0)
    for (const p of placed) expect(WORDS, `fillText("${p.text}")`).toContain(p.text)
    expect(new Set(placed.map((p) => p.text))).toEqual(new Set(WORDS))
  })

  it('an accent on word 1 lands on the second word’s call', () => {
    const { ctx, placed } = fakeContext()
    drawTextOnto(ctx, hindi({ highlight: { word: 1, color: ACCENT } }), W, H, MID)
    expect(new Set(placed.map((p) => p.y)).size, 'one row').toBe(1)
    const accented = placed.filter((p) => p.fill === ACCENT)
    expect(accented.length).toBeGreaterThan(0)
    for (const p of accented) expect(p.text).toBe(WORDS[1])
    for (const word of [WORDS[0], WORDS[2]]) {
      expect(placed.some((p) => p.text === word && p.fill !== ACCENT), word).toBe(true)
    }
  })

  it('a Latin line under bounce still draws letter by letter, its accent on each letter of its word', () => {
    // The fallback is for shaped scripts alone: Latin keeps its per-letter
    // bounce, and the accent still becomes "every letter of word two".
    const { ctx, placed } = fakeContext()
    drawTextOnto(ctx, hindi({ content: 'ab cd', highlight: { word: 1, color: ACCENT } }), W, H, MID)
    expect(new Set(placed.map((p) => p.text))).toEqual(new Set(['A', 'B', 'C', 'D']))
    expect(new Set(placed.filter((p) => p.fill === ACCENT).map((p) => p.text))).toEqual(new Set(['C', 'D']))
  })
})

/*
 * The Hindi and Telugu faces (docs/CLIPS.md §6.20, D10): Noto Sans Devanagari
 * and Noto Sans Telugu ship in the app's own assets/fonts, and the painter's
 * chain falls back to them after the clip's own faces, so a caption or a text
 * clip draws the same letters on both systems instead of whatever each
 * resolves. A family in the chain resolves only once it is registered, so the
 * sites that load a text face load these too, for text holding their script
 * (`indicFontsFor`; the sites' own cases are tests/renderer/indicFontSites).
 * Membership throughout, never the list: a third script added is not a bug.
 */
describe('the Indic faces', () => {
  const DEVANAGARI = 'Noto Sans Devanagari'
  const TELUGU = 'Noto Sans Telugu'

  it('each is the family the catalogue lists for one of the app’s own font files', () => {
    const listed = APP_FONT_FILES.map((file) => fontFamilyFromFilename(file))
    for (const face of [DEVANAGARI, TELUGU]) {
      expect(INDIC_FONTS).toContain(face)
      expect(listed).toContain(face)
    }
  })

  it('Hindi gives Devanagari’s face, Telugu gives Telugu’s, Latin neither', () => {
    expect(indicFontsFor('प्रिय मित्र')).toContain(DEVANAGARI)
    expect(indicFontsFor('प्रिय मित्र')).not.toContain(TELUGU)
    expect(indicFontsFor('నమస్కారం')).toContain(TELUGU)
    expect(indicFontsFor('నమస్కారం')).not.toContain(DEVANAGARI)
    for (const face of INDIC_FONTS) expect(indicFontsFor('Good Molecules, 2 for 1')).not.toContain(face)
  })

  it('a mixed line gives the faces it holds: Latin with one Hindi word, and Hindi with Telugu', () => {
    expect(indicFontsFor('Shop now किताब')).toContain(DEVANAGARI)
    expect(indicFontsFor('Shop now किताब')).not.toContain(TELUGU)
    const both = indicFontsFor('किताब నమస్కారం')
    expect(both).toContain(DEVANAGARI)
    expect(both).toContain(TELUGU)
  })

  it('a lone vowel sign or a digit of the script is enough', () => {
    // U+093F (ि, a combining mark) and U+0C67 (Telugu digit one).
    expect(indicFontsFor('xि')).toContain(DEVANAGARI)
    expect(indicFontsFor('Take ౧')).toContain(TELUGU)
  })

  it('facesFor loads the clip’s own face first and the script’s with it', () => {
    const faces = facesFor('Anton', 'Shop now किताब')
    expect(faces[0]).toBe('Anton')
    expect(faces).toContain(DEVANAGARI)
    expect(facesFor('Anton', 'Shop now')).toEqual(['Anton'])
  })

  /** The families of a font shorthand, in order, unquoted. */
  const familiesOf = (font: string): string[] =>
    font
      .slice(font.indexOf('px ') + 3)
      .split(',')
      .map((family) => family.trim().replace(/^"|"$/g, ''))

  const HINDI = 'प्रिय मित्र किताब'
  const cases: [string, Partial<TextSpec>, { frame: number; fps: number } | undefined][] = [
    ['plain', { styleId: undefined }, undefined],
    ['styled (hero)', { styleId: 'hero' }, undefined],
    ['animated (bounce, mid-flight)', { styleId: undefined, animationId: 'bounce', size: 0.03 }, { frame: 9, fps: 30 }]
  ]
  for (const [name, over, clock] of cases) {
    it(`every fillText of a ${name} Hindi line names the Indic faces after the clip’s own and before sans-serif`, () => {
      const { ctx, placed } = fakeContext()
      drawTextOnto(ctx, spec({ content: HINDI, font: 'Anton', ...over }), W, H, clock)
      expect(placed.length).toBeGreaterThan(0)
      for (const p of placed) {
        const families = familiesOf(p.font)
        const own = families.indexOf('Anton')
        const fallback = families.indexOf('sans-serif')
        expect(own, p.font).toBeGreaterThanOrEqual(0)
        for (const face of [DEVANAGARI, TELUGU]) {
          const at = families.indexOf(face)
          expect(at, `${face} in ${p.font}`).toBeGreaterThan(own)
          expect(at, `${face} in ${p.font}`).toBeLessThan(fallback)
        }
      }
    })
  }
})
