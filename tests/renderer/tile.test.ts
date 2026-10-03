import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Check, Download, Grid3x3, Loader } from 'lucide-react'
import { BigButton, Tile } from '../../src/renderer/src/components/ui/Tile'

/*
 * A pressed tile changes colour AND icon as well as shadow, never shadow alone
 * (docs/WINDOW.md §2 "Style"; the user's rule). On cream an inset shadow is
 * 1.5:1 at its darkest, so a press that only moved the shadow would be a state
 * nobody could see.
 *
 * Rendered to markup rather than read as source, so what is compared is what
 * the button actually wears in each state — a class table nobody applies would
 * pass a source test.
 */

const html = (element: ReturnType<typeof createElement>): string => renderToStaticMarkup(element)

/** The class tokens of the first element whose tag is `tag`. */
function classesOf(markup: string, tag: string): string[] {
  const m = new RegExp(`<${tag}\\b[^>]*\\bclass="([^"]*)"`).exec(markup)
  expect(m, `<${tag} class=…> in ${markup.slice(0, 80)}`).not.toBeNull()
  return m![1].split(/\s+/).filter(Boolean)
}
const allClasses = (markup: string): string[] => [...markup.matchAll(/\bclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/))
const svgOf = (markup: string): string => {
  const m = /<svg\b[^]*?<\/svg>/.exec(markup)
  expect(m, 'an icon').not.toBeNull()
  return m![0]
}
/**
 * The picture itself: the svg without its class (so a colour change alone is
 * not "a different icon"), plus whether the pressed dot is drawn.
 */
const glyphOf = (markup: string): string =>
  svgOf(markup).replace(/\sclass="[^"]*"/, '') + (markup.includes('data-pressed-badge') ? '+dot' : '')
/** A plain (variant-free) utility of a family: `bg-accent-900`, `shadow-pressed`, `text-ink-200`. */
const family = (classes: string[], prefix: 'bg-' | 'text-' | 'shadow-'): string[] =>
  classes.filter((c) => c.startsWith(prefix) && !c.includes(':'))
const added = (pressed: string[], idle: string[]): string[] => pressed.filter((c) => !idle.includes(c))

/** Anything that would make a containing block for the app's fixed overlays. */
const TRAPS = /^(?:[a-z-]+:)*-?(?:transform|filter|backdrop-[\w-]+|scale-[\w./-]+|translate-[\w./-]+|rotate-[\w./-]+|skew-[\w./-]+|blur(?:-[\w-]+)?|drop-shadow(?:-[\w-]+)?|perspective-[\w-]+)$/

describe('Tile', () => {
  const idle = html(createElement(Tile, { icon: Grid3x3, label: 'Grid split' }))
  const pressed = html(createElement(Tile, { icon: Grid3x3, label: 'Grid split', pressed: true }))
  const swapped = html(createElement(Tile, { icon: Grid3x3, pressedIcon: Check, label: 'Grid split', pressed: true }))

  it('is a real, focusable toggle button that says whether it is pressed', () => {
    expect(idle).toMatch(/^<button\b[^>]*type="button"/)
    expect(idle).toContain('aria-pressed="false"')
    expect(pressed).toContain('aria-pressed="true"')
    expect(idle).not.toMatch(/tabindex="-1"/)
    expect(idle).toContain('Grid split')
  })

  it('pressed changes the surface colour, a text colour and the shadow together', () => {
    for (const [name, markup] of [['heavier glyph', pressed], ['pressedIcon', swapped]] as const) {
      const [on, off] = [allClasses(markup), allClasses(idle)]
      expect(added(family(classesOf(markup, 'button'), 'bg-'), family(classesOf(idle, 'button'), 'bg-')), `${name}: a new bg`).not.toEqual([])
      expect(added(family(on, 'text-'), family(off, 'text-')), `${name}: a new text colour`).not.toEqual([])
      expect(added(family(classesOf(markup, 'button'), 'shadow-'), family(classesOf(idle, 'button'), 'shadow-')), `${name}: a new shadow`).not.toEqual([])
    }
    // And the shadow is the inset one, while the idle tile is raised.
    expect(classesOf(pressed, 'button')).toContain('shadow-pressed')
    expect(classesOf(idle, 'button')).toContain('shadow-raised')
  })

  it('pressed draws a different icon, with or without a glyph of its own', () => {
    expect(glyphOf(pressed)).not.toBe(glyphOf(idle))
    expect(glyphOf(swapped)).not.toBe(glyphOf(idle))
    // With pressedIcon the glyph itself is the other one…
    expect(svgOf(idle)).toContain('lucide-grid-3x3') // the anchor below is real
    expect(svgOf(swapped)).toContain('lucide-check')
    expect(svgOf(swapped)).not.toContain('lucide-grid-3x3')
    // …and without it, the same glyph heavier, with a dot.
    expect(svgOf(pressed)).toContain('stroke-width="2.25"')
    expect(pressed).toContain('data-pressed-badge')
    expect(idle).not.toContain('data-pressed-badge')
  })

  it('a momentary press changes colour only, and a disabled tile goes flat', () => {
    const button = classesOf(idle, 'button')
    expect(button.filter((c) => c.startsWith('active:'))).toEqual(['active:bg-ink-850'])
    const disabled = classesOf(html(createElement(Tile, { icon: Grid3x3, label: 'x', disabled: true })), 'button')
    expect(disabled).toEqual(expect.arrayContaining(['disabled:shadow-none', 'disabled:opacity-50', 'disabled:cursor-not-allowed']))
  })

  it('never transforms, filters or blurs — it would trap the fixed overlays', () => {
    for (const markup of [idle, pressed, swapped]) {
      expect(allClasses(markup).filter((c) => TRAPS.test(c))).toEqual([])
      expect(markup).not.toMatch(/style="[^"]*(?:transform|filter)/)
    }
  })
})

describe('BigButton', () => {
  for (const variant of ['primary', 'secondary'] as const) {
    it(`${variant}: pressed changes colour, icon and shadow together`, () => {
      const idle = html(createElement(BigButton, { icon: Download, variant, children: 'Export' }))
      const pressed = html(createElement(BigButton, { icon: Download, variant, pressed: true, children: 'Export' }))
      const [on, off] = [classesOf(pressed, 'button'), classesOf(idle, 'button')]
      expect(added(family(on, 'bg-'), family(off, 'bg-'))).not.toEqual([])
      expect(added(family(on, 'shadow-'), family(off, 'shadow-'))).toEqual(['shadow-pressed'])
      expect(glyphOf(pressed)).not.toBe(glyphOf(idle))
      expect(pressed).toContain('aria-pressed="true"')
      for (const markup of [idle, pressed]) expect(allClasses(markup).filter((c) => TRAPS.test(c))).toEqual([])
    })
  }

  it('says nothing about pressed unless it toggles, and announces busy', () => {
    const plain = html(createElement(BigButton, { icon: Download, children: 'Export' }))
    expect(plain).not.toContain('aria-pressed')
    const busy = html(createElement(BigButton, { icon: Download, pressedIcon: Loader, busy: true, children: 'Exporting' }))
    expect(busy).toContain('aria-busy="true"')
    expect(classesOf(busy, 'button')).toContain('shadow-pressed')
    expect(svgOf(busy)).toContain('lucide-loader')
  })
})
