import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/*
 * The Shelf, rendered (docs/WINDOW.md §3.2, §6 Step 9). The source half is
 * tests/shelf.test.ts.
 *
 * Home: the nineteen tiles, in the registry's order, each with its label and
 * its tooltip; "soon" under Narration; a busy badge on exactly the tiles whose
 * tool has a run under way. Pressing a tile opens its own tool, and the ←
 * goes back. An open tool: the "← Tools · <label>" header over the tool's
 * panel, in the census's box.
 *
 * Rendered to static markup, so no effect runs. The store is a plain selector
 * over a copy of its real initial state, as in stripsRender.test.ts: on the
 * server zustand answers every selector from the initial state, and could
 * never show a tool open.
 */

const fake = vi.hoisted(() => ({
  initial: {} as Record<string, unknown>,
  state: {} as Record<string, unknown>
}))

vi.mock('../../src/renderer/src/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/src/store')>()
  fake.initial = { ...(real.useEditor.getState() as unknown as Record<string, unknown>) }
  const useEditor = Object.assign((select: (s: Record<string, unknown>) => unknown) => select(fake.state), {
    getState: () => fake.state
  })
  return { ...real, useEditor }
})

const { Shelf, BACK_TITLE } = await import('../../src/renderer/src/components/shelf/Shelf')
const { SHELF_TOOLS } = await import('../../src/renderer/src/components/shelf/tools')
const { BUSY_TITLE } = await import('../../src/renderer/src/components/ui/Tile')

const render = (): string => renderToStaticMarkup(createElement(Shelf))

/** Each tile's button markup, by its data-shelf-tile id, in document order. */
function tiles(html: string): { id: string; markup: string }[] {
  return [...html.matchAll(/<button\b[^>]*data-shelf-tile="([^"]+)"[^>]*>[^]*?<\/button>/g)].map((m) => ({ id: m[1], markup: m[0] }))
}

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

beforeEach(() => {
  fake.state = { ...fake.initial, shelfTool: null }
})

describe('the Shelf’s home', () => {
  it('draws every tile, in the registry’s order, with its label and tooltip', () => {
    const html = render()
    expect(html).toContain('data-shelf-tool="home"')
    const drawn = tiles(html)
    expect(drawn.map((t) => t.id)).toEqual(SHELF_TOOLS.map((tool) => tool.id))
    for (const [i, tool] of SHELF_TOOLS.entries()) {
      expect(drawn[i].markup, tool.id).toContain(`title="${escape(tool.hint)}"`)
      expect(drawn[i].markup, tool.id).toContain(`>${escape(tool.label)}</span>`)
      expect(drawn[i].markup, tool.id).toContain('aria-pressed="false"')
    }
    // No tool open: no header, no panel.
    expect(html).not.toContain('data-shelf-panel')
    expect(html).not.toContain(BACK_TITLE)
  })

  it('says "soon" under Narration, and under nothing else', () => {
    const drawn = tiles(render())
    const soon = drawn.filter((t) => t.markup.includes('>soon</span>')).map((t) => t.id)
    expect(soon).toEqual(['narration'])
  })

  it('wears a busy badge on exactly the tiles whose run is under way', () => {
    const badged = (): string[] => tiles(render()).filter((t) => t.markup.includes(`title="${BUSY_TITLE}"`)).map((t) => t.id)
    expect(badged()).toEqual([])
    fake.state.reelBuilding = true
    expect(badged()).toEqual(['beat-sync', 'one-photo'])
    fake.state.reelBuilding = false
    fake.state.gridBuilding = true
    expect(badged()).toEqual(['grid-split'])
    fake.state.gridBuilding = false
    fake.state.transcribing = { a: { progress: null } }
    expect(badged()).toEqual(['upload', 'transcript'])
  })

  it('draws the small tile in a grid of auto-filled columns, three to a 240 px row', () => {
    const html = render()
    const grid = /<div class="([^"]*\bgrid\b[^"]*)"/.exec(html)
    expect(grid, 'the grid').not.toBeNull()
    // minmax(3.5rem) with 12 px gaps in 14 px of padding: 3 × 56 + 2 × 12 = 192 ≤ 212 < 4 × 56 + 3 × 12.
    expect(grid![1]).toContain('grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))]')
    expect(grid![1]).toContain('gap-3')
    expect(html).toMatch(/data-shelf-tool="home" class="[^"]*\bp-3\.5\b/)
    const inner = 240 - 2 * 14
    expect(3 * 56 + 2 * 12).toBeLessThanOrEqual(inner)
    expect(4 * 56 + 3 * 12).toBeGreaterThan(inner)
  })
})

/**
 * The buttons a tree of elements comes to, with their props — the handlers
 * included, which static markup drops.
 *
 * Each function component is called as the renderer would call it. That is
 * safe here only because the store is mocked to a plain selector, so the
 * Shelf's components have no hook of their own; the walk stops at a button,
 * and never expands a class (the panel's error boundary) or an icon.
 */
function buttons(node: ReactNode, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const child of node) buttons(child as ReactNode, out)
    return out
  }
  if (!isValidElement(node)) return out
  const props = node.props as Record<string, unknown> & { children?: ReactNode }
  if (node.type === 'button') {
    out.push(props)
    return out
  }
  const type = node.type as unknown
  if (typeof type === 'function') {
    if ((type as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent) return out
    return buttons((type as (p: unknown) => ReactNode)(props), out)
  }
  // A host element, a fragment — or an icon (forwardRef), which has no children.
  return buttons(props.children, out)
}

describe('pressing a tile', () => {
  it('opens that tile’s tool, for every tile on the home grid', () => {
    // Pinned from the source too (tests/shelf.test.ts), but each link there is
    // pinned on its own: a tile that drew fine and did nothing — ShelfHome
    // handing its tiles a dead `onOpen` — passed every test. This presses each.
    const opened: unknown[] = []
    fake.state.setShelfTool = (tool: unknown): void => {
      opened.push(tool)
    }
    const tiles = buttons(createElement(Shelf)).filter((b) => b['data-shelf-tile'] !== undefined)
    expect(tiles.map((b) => b['data-shelf-tile'])).toEqual(SHELF_TOOLS.map((tool) => tool.id))
    for (const [i, tool] of SHELF_TOOLS.entries()) {
      const click = tiles[i].onClick
      expect(typeof click, tool.id).toBe('function')
      ;(click as () => void)()
      expect(opened, tool.id).toEqual([tool.id])
      opened.length = 0
      // And what the store then holds is the face the Shelf shows.
      fake.state.shelfTool = tool.id
      expect(render(), tool.id).toContain(`data-shelf-tool="${tool.id}"`)
      fake.state.shelfTool = null
    }
  })

  it('and the ← in an open tool goes back to the tiles', () => {
    const opened: unknown[] = []
    fake.state.setShelfTool = (tool: unknown): void => {
      opened.push(tool)
    }
    fake.state.shelfTool = 'grid-split'
    const backs = buttons(createElement(Shelf)).filter((b) => b.title === BACK_TITLE)
    expect(backs).toHaveLength(1)
    ;(backs[0].onClick as () => void)()
    expect(opened).toEqual([null])
  })
})

describe('an open tool', () => {
  it('has the header — the way back and the tool’s name — over its panel, in the census’s box', () => {
    fake.state.shelfTool = 'grade'
    const html = render()
    expect(html).toContain('data-shelf-tool="grade"')
    expect(html).not.toContain('data-shelf-tile')
    const at = html.indexOf('data-shelf-panel')
    expect(at).toBeGreaterThan(-1)
    const [header, panel] = [html.slice(0, at), html.slice(at)]
    expect(header).toContain(`title="${BACK_TITLE}"`)
    expect(header).toMatch(/>Tools<\/button>/)
    expect(header).toContain('>Grade</span>')
    // The Grade tile's own panel, and only there.
    expect(panel).toContain('<span>+ Grade</span>')
    expect(header).not.toContain('+ Grade')
  })

  it('Narration says what it will do and that it is not built', () => {
    fake.state.shelfTool = 'narration'
    const html = render()
    expect(html).toContain('Topic and length in, narration and a cut out.')
    expect(html).toContain('>not built yet</span>')
  })

  it('an id the registry does not have shows the tiles, not an empty column', () => {
    fake.state.shelfTool = 'no-such-tool'
    expect(render()).toContain('data-shelf-tool="home"')
  })
})
