import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { emptyProject, type GraphicsSettings } from '@shared/timeline'
import { GRAPHIC_STYLES, GRAPHIC_TEXT_STYLES, graphicEligible, resolveGraphicStyle } from '@shared/graphics/style'
import { TEXT_STYLES } from '@shared/render/textStyle'
import type { DrawItem, TextMeasure } from '@shared/graphics/items'

/*
 * OUTPUT's Graphics section (docs/CLIPS.md §6.5's UI), rendered and pressed
 * as tests/renderer/smartPlacement.test.tsx does the Smart placement toggle:
 * the store mocked to a plain selector over the REAL store's state, so the
 * section, which has no state of its own, can be called as a function and its
 * presses reach the real actions. The two children with hooks of their own
 * (the sample tile and the text style picker) are not called by the walk:
 * their props are read, and the picker is rendered to static markup apart.
 */

vi.mock('../../src/renderer/src/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/src/store')>()
  const store = real.useEditor
  const useEditor = Object.assign((select: (s: unknown) => unknown) => select(store.getState()), {
    getState: store.getState,
    setState: store.setState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe
  })
  return { ...real, useEditor }
})
vi.mock('../../src/renderer/src/exportBakers', () => ({ liveBakers: {} }))
vi.mock('../../src/renderer/src/captionBake', () => ({ bakeCaptions: async () => null }))

const { useEditor } = await import('../../src/renderer/src/store')
const { OutputStrip, GraphicsSection, GRAPHICS, ACCENT_COLOUR, GRAPHIC_TEXT_STYLE_IDS, graphicSampleList } = await import(
  '../../src/renderer/src/components/OutputStrip'
)
const { TextStylePicker } = await import('../../src/renderer/src/components/TextStylePicker')

const state = () => useEditor.getState()

/* ------------------------------------------------------------ the walk */

interface Host {
  type: string
  props: Record<string, unknown>
}

/** Components with hooks of their own: recorded with their props, never called. */
const LEAVES = new Set(['GraphicSample', 'TextStylePicker'])

/** Every host element a tree comes to, in order, and every leaf component with its props. */
function walk(node: ReactNode, out: { hosts: Host[]; leaves: Host[] } = { hosts: [], leaves: [] }) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child as ReactNode, out)
    return out
  }
  if (!isValidElement(node)) return out
  const props = node.props as Record<string, unknown> & { children?: ReactNode }
  const type = node.type as unknown
  if (typeof type === 'string') {
    out.hosts.push({ type, props })
    return walk(props.children, out)
  }
  if (typeof type === 'function') {
    const name = (type as { name: string }).name
    if (LEAVES.has(name)) {
      out.leaves.push({ type: name, props })
      return out
    }
    return walk((type as (p: unknown) => ReactNode)(props), out)
  }
  return walk(props.children, out)
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((n) => textOf(n as ReactNode)).join(' ')
  if (isValidElement(node)) return ` ${textOf((node.props as { children?: ReactNode }).children)} `
  return ''
}

const norm = (text: string): string => text.replace(/\s+/g, ' ').trim()

function section() {
  const all = walk(GraphicsSection())
  const rows = all.hosts.filter((h) => h.type === 'button' && typeof h.props['data-graphic-style'] === 'string')
  const accent = all.hosts.filter((h) => h.type === 'input' && 'data-graphic-accent' in h.props)
  const pickers = all.leaves.filter((l) => l.type === 'TextStylePicker')
  const samples = all.leaves.filter((l) => l.type === 'GraphicSample')
  return { all, rows, accent, pickers, samples }
}

function start(settings?: GraphicsSettings): void {
  useEditor.setState({
    ...useEditor.getInitialState(),
    outputOpen: true,
    project: { ...emptyProject(), ...(settings ? { graphics: settings } : {}) }
  })
}

beforeEach(() => start())

/* ---------------------------------------------------------------- tests */

describe('OUTPUT’s Graphics section (§6.5)', () => {
  it('renders in the open strip under its heading, with every preset as a row of its name and face', () => {
    const html = renderToStaticMarkup(createElement(OutputStrip)).replace(/\s+/g, ' ')
    expect(html).toContain('data-graphics-section')
    expect(html).toContain(`>${GRAPHICS}<`)
    expect(html).toContain(`>${ACCENT_COLOUR}<`)

    const { rows } = section()
    // Membership: each preset has its row, in GRAPHIC_STYLES' order; no row for anything else.
    expect(rows.map((r) => r.props['data-graphic-style'])).toEqual(GRAPHIC_STYLES.map((s) => s.id))
    for (const preset of GRAPHIC_STYLES) {
      const row = rows.find((r) => r.props['data-graphic-style'] === preset.id)!
      expect(norm(textOf(row.props.children as ReactNode)), preset.id).toBe(`${preset.name} ${preset.font}`)
    }
  })

  it('lights the project’s preset, clean when it names none or an unknown one', () => {
    const lit = (): string[] => section().rows.filter((r) => String(r.props.className).includes('bg-ink-700 text-ink-200')).map((r) => String(r.props['data-graphic-style']))
    expect(lit()).toEqual(['clean'])
    start({ styleId: 'editorial', overrides: {}, sound: true })
    expect(lit()).toEqual(['editorial'])
    start({ styleId: 'no-such-style', overrides: {}, sound: true })
    expect(lit()).toEqual(['clean'])
  })

  it('picking a row calls setGraphicsStyle, which keeps the text style and the accent', () => {
    start({ styleId: 'clean', overrides: { textStyleId: 'outline', 'palette.accent': '#e11d48', radius: 0.05 }, sound: true })
    const bold = section().rows.find((r) => r.props['data-graphic-style'] === 'bold')!
    ;(bold.props.onClick as () => void)()
    expect(state().project.graphics).toStrictEqual({
      styleId: 'bold',
      overrides: { textStyleId: 'outline', 'palette.accent': '#e11d48' },
      sound: true
    })
    // One undo, as the action is.
    expect(state().past).toHaveLength(1)
  })

  it('the accent colour sits beside the accent preset and writes palette.accent', () => {
    const { all, accent } = section()
    expect(accent).toHaveLength(1)
    // Beside: the first input after the accent row, before the next preset's row.
    const at = (h: Host): number => all.hosts.indexOf(h)
    const rowAt = (id: string): number => all.hosts.findIndex((h) => h.props['data-graphic-style'] === id)
    expect(at(accent[0])).toBeGreaterThan(rowAt('accent'))
    expect(at(accent[0])).toBeLessThan(rowAt('energetic'))
    // It shows the accent preset's colour: the 3dit blue until a pick.
    expect(accent[0].props.value).toBe('#2563eb')

    ;(accent[0].props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '#e11d48' } })
    expect(state().project.graphics?.overrides).toStrictEqual({ 'palette.accent': '#e11d48' })
    expect(resolveGraphicStyle('accent', state().project.graphics?.overrides).palette.accent).toBe('#e11d48')
    expect(section().accent[0].props.value).toBe('#e11d48')
  })

  it('the text style picker is limited to GRAPHIC_TEXT_STYLES and writes the textStyleId override', () => {
    const { pickers } = section()
    expect(pickers).toHaveLength(1)
    const ids = pickers[0].props.ids as readonly string[]
    expect(ids).toBeDefined()
    expect([...ids].sort()).toEqual(GRAPHIC_TEXT_STYLES.map((t) => t.id).sort())
    expect(ids).toBe(GRAPHIC_TEXT_STYLE_IDS)
    for (const id of ids) expect(graphicEligible(TEXT_STYLES.find((t) => t.id === id)!), id).toBe(true)
    // Its sample is the preset's text style, so that tile is the lit one.
    expect((pickers[0].props.spec as { styleId?: string }).styleId).toBe('clean')

    ;(pickers[0].props.onPick as (id: string | undefined) => void)('midnight')
    expect(state().project.graphics?.overrides).toStrictEqual({ textStyleId: 'midnight' })
    ;(section().pickers[0].props.onPick as (id: string | undefined) => void)(undefined)
    expect('textStyleId' in (state().project.graphics?.overrides ?? {})).toBe(false)
  })

  it('the picker, given the ids, shows only those: its tiles and its count', () => {
    const { pickers } = section()
    const html = renderToStaticMarkup(createElement(TextStylePicker, pickers[0].props as Parameters<typeof TextStylePicker>[0]))
    const allowed = new Set(GRAPHIC_TEXT_STYLES.map((t) => t.name))
    const titles = [...html.matchAll(/title="([^"]*?) — /g)].map((m) => m[1].replace(/&amp;/g, '&'))
    expect(titles.length).toBeGreaterThan(0)
    for (const name of titles) expect(allowed, name).toContain(name)
    const count = (markup: string): number => Number(/Browse all\s*(?:<!-- -->)?(\d+)/.exec(markup)?.[1])
    expect(count(html)).toBe(GRAPHIC_TEXT_STYLES.length)
    // And without the prop, every text style, as the captions' picker shows.
    const open = renderToStaticMarkup(createElement(TextStylePicker, { spec: pickers[0].props.spec as never, onPick: () => undefined }))
    expect(count(open)).toBe(TEXT_STYLES.length)
  })

  it('the picker’s gallery, opened, shows only those too: every tile, the hero and the search count', () => {
    const { pickers } = section()
    const props = { ...(pickers[0].props as Parameters<typeof TextStylePicker>[0]), initialBrowsing: true }
    const html = renderToStaticMarkup(createElement(TextStylePicker, props))
    const allowed = new Set(GRAPHIC_TEXT_STYLES.map((t) => t.name))
    // The gallery's tiles name each style under it, in a truncate div; the inline row's titles are read above.
    const names = [...html.matchAll(/<div class="truncate text-\[10\.5px\] text-ink-200">([^<]*)<\/div>/g)].map((m) => m[1].replace(/&amp;/g, '&'))
    expect(names).toHaveLength(GRAPHIC_TEXT_STYLES.length)
    for (const name of names) expect(allowed, name).toContain(name)
    expect(/placeholder="Search (\d+) styles/.exec(html)?.[1]).toBe(String(GRAPHIC_TEXT_STYLES.length))
    // And the picker opened without the prop is the whole library, so the pattern above reads real tiles.
    const all = renderToStaticMarkup(createElement(TextStylePicker, { ...props, ids: undefined }))
    expect([...all.matchAll(/<div class="truncate text-\[10\.5px\] text-ink-200">/g)]).toHaveLength(TEXT_STYLES.length)
  })

  it('the sample tile draws the counter at its settled frame, in the project’s style', () => {
    const { samples } = section()
    expect(samples).toHaveLength(1)
    expect((samples[0].props.style as { id: string }).id).toBe('clean')
    start({ styleId: 'neon', overrides: {}, sound: true })
    expect((section().samples[0].props.style as { id: string }).id).toBe('neon')

    // The list the tile paints, for every preset: the value whole, as said, not a count on its way.
    const measure: TextMeasure = (text, look) => ({ width: 0.55 * look.px * [...text].length, ascent: 0.8 * look.px, descent: 0.2 * look.px })
    const texts = (items: readonly DrawItem[]): string[] =>
      items.flatMap((item) => (item.kind === 'text' ? [item.text] : item.kind === 'group' ? texts(item.children) : []))
    for (const preset of GRAPHIC_STYLES) {
      const list = graphicSampleList(resolveGraphicStyle(preset.id), 640, 160, measure)
      expect(list.width).toBe(640)
      expect(texts(list.items), preset.id).toContain('10,00,000')
    }
  })
})
