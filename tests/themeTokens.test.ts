import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'

/*
 * The light theme's tokens: every class the app writes has one, the scales
 * count the way the palette comment says, and the pairs the app actually uses
 * clear their contrast floors (docs/WINDOW.md §6 Step 3).
 *
 * Why each part exists:
 * - A class with no token builds NO CSS. Tailwind is silent about it, and the
 *   element falls back to inheritance — which is how text-ink-300, -500 and
 *   -100 (some 150 sites) rendered as nothing in the dark theme for months.
 * - The ink scale runs toward the page (950 is the cream page, 50 the darkest
 *   ink), against Tailwind's habit. One token left un-inverted would put a dark
 *   surface in a light stack; the order catches it.
 * - The orange accent was removed by the user. Its classes were renamed to
 *   accent-*, and its literals (canvas strokes, SVG fills) re-pointed by hand;
 *   "flame" survives only as real words: the Flames caption style and the fire
 *   keyword list.
 */

const ROOT = resolve(__dirname, '..')
const STYLES = join(ROOT, 'src/renderer/src/styles.css')
const css = readFileSync(STYLES, 'utf8')

const filesUnder = (dir: string, pattern: RegExp): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path, pattern) : pattern.test(name) ? [path] : []
  })
const rel = (file: string): string => relative(ROOT, file).split(sep).join('/')

const SOURCES = [...filesUnder(join(ROOT, 'src/renderer'), /\.(ts|tsx)$/), ...filesUnder(join(ROOT, 'src/shared'), /\.(ts|tsx)$/)]
const EVERYTHING = filesUnder(join(ROOT, 'src'), /./)

/** The body of the one @theme block, found or the test is about nothing. */
function themeBlock(): string {
  const at = css.indexOf('@theme {')
  expect(at, '@theme block in styles.css').toBeGreaterThan(-1)
  expect([...css.matchAll(/@theme \{/g)], 'exactly one @theme block').toHaveLength(1)
  const end = css.indexOf('\n}', at)
  expect(end).toBeGreaterThan(at)
  return css.slice(at, end)
}

function hexes(prefix: 'ink' | 'accent'): Map<number, string> {
  const out = new Map<number, string>()
  for (const m of themeBlock().matchAll(new RegExp(`--color-${prefix}-(\\d{2,3}):\\s*#([0-9a-f]{6});`, 'gi'))) {
    out.set(Number(m[1]), m[2])
  }
  return out
}

const luminance = (hex: string): number => {
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/*
 * A colour utility on an ink or accent step, with any variants in front:
 * `hover:bg-ink-700`, `placeholder:text-ink-600`, `accent-accent-500`,
 * `border-t-ink-800`, `bg-ink-950/60`. Whole class only — not the middle of
 * `--color-ink-950` in a var().
 */
const UTILITY =
  /(?<![\w-])(?:[a-z0-9-]+:)*!?(?:text|bg|border(?:-[trblxy])?|ring(?:-offset)?|accent|decoration|from|to|via|outline|divide|placeholder|shadow|fill|stroke|caret)-(ink|accent)-(\d{2,3})(?:\/\d{1,3})?(?![\w-])/g

describe('the theme tokens', () => {
  it('defines a token for every ink and accent class the app writes', () => {
    const theme = themeBlock()
    const used = new Map<string, string>() // token -> first file using it
    for (const file of SOURCES) {
      for (const m of readFileSync(file, 'utf8').matchAll(UTILITY)) {
        const token = `--color-${m[1]}-${m[2]}`
        if (!used.has(token)) used.set(token, `${rel(file)} (${m[0]})`)
      }
    }
    // The check is about something: the classes are there to find, on both scales.
    expect(used.size).toBeGreaterThan(10)
    expect([...used.keys()]).toContain('--color-ink-200')
    expect([...used.keys()]).toContain('--color-accent-500')
    const missing = [...used].filter(([token]) => !new RegExp(`${token}:\\s*#`).test(theme)).map(([t, where]) => `${t} ← ${where}`)
    expect(missing, 'classes with no token build no CSS').toEqual([])
  })

  it('defines the stage colour and the raised and pressed shadows the tiles use', () => {
    const theme = themeBlock()
    const sources = SOURCES.map((f) => readFileSync(f, 'utf8')).join('\n')
    // Every raised size, not a list of them: step 11's icon-only tile brought a
    // third (`raised-xs`), and the next size added right must not fail this.
    // Membership below keeps the scan from being about nothing.
    const shadows = new Set([...sources.matchAll(/(?<![\w-])(?:[a-z-]+:)*shadow-(raised(?:-[a-z]+)?|pressed)(?![\w-])/g)].map((m) => m[1]))
    expect([...shadows]).toEqual(expect.arrayContaining(['pressed', 'raised', 'raised-sm', 'raised-xs']))
    for (const name of shadows) expect(theme, `--shadow-${name}`).toMatch(new RegExp(`--shadow-${name}:\\s*\\S`))
    expect(sources).toMatch(/(?<![\w-])bg-stage(?![\w-])/)
    expect(theme).toMatch(/--color-stage:\s*#[0-9a-f]{6};/i)
  })

  it('counts both scales toward the page: 950 the lightest ink, 300 the deepest accent', () => {
    const ink = hexes('ink')
    const accent = hexes('accent')
    const inkOrder = [950, 900, 850, 800, 750, 700, 600, 500, 400, 300, 200, 100, 50]
    const accentOrder = [900, 500, 400, 300]
    for (const step of inkOrder) expect(ink.has(step), `--color-ink-${step}`).toBe(true)
    for (const step of accentOrder) expect(accent.has(step), `--color-accent-${step}`).toBe(true)
    for (let i = 1; i < inkOrder.length; i++) {
      const [lighter, darker] = [inkOrder[i - 1], inkOrder[i]]
      expect(luminance(ink.get(lighter)!), `ink-${lighter} lighter than ink-${darker}`).toBeGreaterThan(luminance(ink.get(darker)!))
    }
    for (let i = 1; i < accentOrder.length; i++) {
      const [lighter, darker] = [accentOrder[i - 1], accentOrder[i]]
      expect(luminance(accent.get(lighter)!), `accent-${lighter} lighter than accent-${darker}`).toBeGreaterThan(luminance(accent.get(darker)!))
    }
  })

  it('keeps every text grey and the accent readable on every surface it sits on', () => {
    const ink = hexes('ink')
    const accent = hexes('accent')
    const surfaces = [950, 900, 850, 800, 700]
    const floor = (fg: string, bg: string, label: string, min = 4.5): void => {
      expect(contrast(fg, bg), label).toBeGreaterThanOrEqual(min)
    }
    for (const text of [100, 200, 300, 400, 500, 600]) {
      for (const surface of surfaces) floor(ink.get(text)!, ink.get(surface)!, `text-ink-${text} on bg-ink-${surface}`)
    }
    // Cream text on the accent buttons, at rest, hovered, and deepest.
    for (const fill of [500, 400, 300]) floor(ink.get(950)!, accent.get(fill)!, `text-ink-950 on bg-accent-${fill}`)
    // Blue as text: links, hints, "on".
    for (const text of [400, 300]) {
      for (const surface of surfaces) floor(accent.get(text)!, ink.get(surface)!, `text-accent-${text} on bg-ink-${surface}`)
    }
    // A pressed tile: its label as text, its icon as a graphic (3:1).
    floor(ink.get(200)!, accent.get(900)!, 'pressed label text-ink-200 on bg-accent-900')
    floor(accent.get(400)!, accent.get(900)!, 'pressed icon text-accent-400 on bg-accent-900', 3)
  })

  it('leaves no trace of the orange accent', () => {
    // (a) no flame class or token anywhere in src — the rename was total.
    const classes = EVERYTHING.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?<![\w-])(?:[a-z-]+:)*!?[a-z]+-flame-\d{3}|--color-flame/g)].map((m) => `${rel(file)}: ${m[0]}`)
    )
    expect(classes).toEqual([])

    // (b) "flame" survives only as a real word, in the files that mean one:
    // the Flames caption style, the fire keyword list, and copy about them
    // (the 3D props panel's "fire on “flame”", in Automation.tsx until step 10).
    const allowed = new Set(['keywords.ts', 'textStyle.ts', 'coherence.ts', 'TextStylePicker.tsx', 'Props3d.tsx'])
    const words = EVERYTHING.filter((file) => /flame/i.test(readFileSync(file, 'utf8'))).map((file) => basename(file))
    expect(words.length, 'the real words are still there to find').toBeGreaterThan(0)
    expect(words.filter((name) => !allowed.has(name))).toEqual([])

    // (c) nor its literals, which no rename can reach: canvas and SVG strokes.
    const literal =
      /#ef7a4b|#f59a75|#f9bda4|#f97341|rgba?\(\s*245\s*,\s*154\s*,\s*117|rgba?\(\s*249\s*,\s*115\s*,\s*65|rgba?\(\s*249\s*,\s*122\s*,\s*75|rgba?\(\s*239\s*,\s*122\s*,\s*75/gi
    const literals = filesUnder(join(ROOT, 'src/renderer'), /./).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(literal)].map((m) => `${rel(file)}: ${m[0]}`)
    )
    expect(literals).toEqual([])
  })

  it('puts the paper grain on the page and nowhere else', () => {
    /*
     * The texture is one tiled SVG noise image on body, so it costs one paint.
     * On a control it would repaint with every hover, and inside a component it
     * could reach the export capture page.
     */
    const sites = [...css.matchAll(/feTurbulence/g)]
    expect(sites, 'the grain is in styles.css').toHaveLength(1)
    const at = sites[0].index!
    const open = css.lastIndexOf('{', at)
    const close = css.lastIndexOf('}', at)
    expect(open).toBeGreaterThan(close) // inside a rule, not between two
    // The selector: what lies between the end of the previous rule (or comment) and the brace.
    const start = Math.max(close + 1, css.lastIndexOf('*/', open) + 2)
    const selector = css.slice(start, open).trim()
    expect(selector).toBe('body')
    expect(css.slice(open, css.indexOf('}', at))).toContain('background-image:')
    const elsewhere = EVERYTHING.filter((file) => file !== STYLES && /feTurbulence/.test(readFileSync(file, 'utf8'))).map(rel)
    expect(elsewhere).toEqual([])
  })
})
