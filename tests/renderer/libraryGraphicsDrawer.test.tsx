import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CATALOG_VERSION, type AssetCatalog, type CatalogEntry } from '@shared/assets/catalog'
import { DRAG_MIME } from '@shared/dragPayload'
import { LIBRARY_GRAPHICS } from '@shared/graphics/library'
import { CLEAN_GRAPHIC_STYLE } from '@shared/graphics/style'

/*
 * Try-out 1 (2026-11-15), piece 6: the Library's Graphics drawer
 * (components/Library.tsx), rendered to static markup over plain-selector
 * stand-ins for the stores, as tests/renderer/libraryPacksOpen.test.tsx
 * renders the Library. Its tiles show with no catalogue at all (still
 * loading, failed, none) and with an empty one or a full one, where
 * "Scanning the asset library…", "No library loaded" and "Nothing here."
 * would; its chip counts them; it never offers "Get graphics →"; the Library
 * still opens on Stickers. A tile is called as a function and pressed: its
 * drag carries the template, its click places it.
 */

const stand = vi.hoisted(() => ({ catalog: null as unknown, loading: false, error: null as string | null }))

function selectorOver<T extends object>(state: () => T) {
  return (select: (s: T) => unknown) => select(state())
}

vi.mock('../../src/renderer/src/catalog', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/src/catalog')>()
  const useCatalog = selectorOver(() => ({
    ...real.useCatalog.getState(),
    catalog: stand.catalog as AssetCatalog | null,
    root: '/assets',
    loading: stand.loading,
    error: stand.error
  }))
  return { ...real, useCatalog }
})

vi.mock('../../src/renderer/src/packs', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/src/packs')>()
  return { ...real, usePacks: selectorOver(() => real.usePacks.getState()) }
})

vi.mock('../../src/renderer/src/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/src/store')>()
  return { ...real, useEditor: selectorOver(() => real.useEditor.getState()) }
})

const { Library, GraphicTile, GRAPHICS_DRAWER_LABEL, GRAPHIC_TILE_TITLE } = await import('../../src/renderer/src/components/Library')

type Props = { initialKind?: string }
function render(catalog: AssetCatalog | null, initialKind: string | null = 'graphic', over: { loading?: boolean; error?: string | null } = {}): string {
  stand.catalog = catalog
  stand.loading = over.loading ?? false
  stand.error = over.error ?? null
  return renderToStaticMarkup(createElement(Library as (props: Props) => ReactNode, initialKind === null ? {} : { initialKind }))
}

const catalogOf = (entries: CatalogEntry[]): AssetCatalog => ({ version: CATALOG_VERSION, generatedAt: '2026-11-15T00:00:00.000Z', scannedFrom: '/assets', entries })
const sticker: CatalogEntry = { id: 'sticker:x', kind: 'sticker', name: 'a sticker', file: 'stickers/x.png', tags: [], meta: {} }

/** How many tiles the markup draws. */
const tiles = (html: string): number => html.split('data-library-graphic=').length - 1

afterEach(() => {
  stand.catalog = null
  stand.loading = false
  stand.error = null
})

describe('the Graphics drawer', () => {
  const cases: [string, AssetCatalog | null, { loading?: boolean; error?: string | null }][] = [
    ['no catalogue, none loading', null, {}],
    ['no catalogue, still loading', null, { loading: true }],
    ['a catalogue that failed', null, { error: 'census: the scan failed' }],
    ['an empty catalogue (an installer’s)', catalogOf([]), {}],
    ['a catalogue holding a sticker', catalogOf([sticker]), {}]
  ]
  for (const [name, catalog, over] of cases) {
    it(`shows a tile per entry, named, with ${name}, and none of the empty states nor "Get graphics →"`, () => {
      const html = render(catalog, 'graphic', over)
      expect(tiles(html)).toBe(LIBRARY_GRAPHICS.length)
      for (const e of LIBRARY_GRAPHICS) {
        expect(html, e.name).toContain(`data-library-graphic="${e.id}"`)
        expect(html, e.name).toContain(`>${e.name}</span>`)
      }
      expect(html).not.toContain('Scanning the asset library')
      expect(html).not.toContain('No library loaded')
      expect(html).not.toContain('Nothing here.')
      expect(html).not.toContain('Get graphics')
      expect(html).not.toContain('census: the scan failed')
    })
  }

  it('counts its tiles on its chip and beside the search', () => {
    const html = render(null)
    expect(html).toContain(`${GRAPHICS_DRAWER_LABEL}<span class="ml-1 text-ink-600">${LIBRARY_GRAPHICS.length}</span>`)
    expect(html).toContain(`tabular-nums text-ink-600">${LIBRARY_GRAPHICS.length}</span>`)
  })

  it('leaves the Library opening on Stickers, where no Graphics tile shows, and keeps "Get stickers →" there', () => {
    // null: no initialKind at all, the Library tile's own default.
    const html = render(catalogOf([{ ...sticker, kind: 'sfx', id: 'sfx:x' }]), null)
    expect(tiles(html)).toBe(0)
    expect(html).toContain('Get stickers')
    // The chip is there all the same, after the six.
    expect(html.indexOf('>SFX<')).toBeLessThan(html.indexOf(`>${GRAPHICS_DRAWER_LABEL}<`))
  })
})

describe('a Graphics tile, pressed', () => {
  const entry = LIBRARY_GRAPHICS.find((e) => e.id === 'counter')!
  const placed: string[] = []
  const tile = GraphicTile({ entry, style: CLEAN_GRAPHIC_STYLE, onPlace: (id) => placed.push(id) }) as ReactElement<{
    draggable: boolean
    title: string
    onClick: () => void
    onDragStart: (e: unknown) => void
  }>

  it('is a draggable button titled with its name', () => {
    expect(isValidElement(tile)).toBe(true)
    expect(tile.type).toBe('button')
    expect(tile.props.draggable).toBe(true)
    expect(tile.props.title).toBe(`Counter ${GRAPHIC_TILE_TITLE}`)
  })

  it('sets the graphic’s payload on a drag: the template, no file', () => {
    const data = new Map<string, string>()
    tile.props.onDragStart({ dataTransfer: { setData: (k: string, v: string) => data.set(k, v), effectAllowed: '' } })
    expect(JSON.parse(data.get(DRAG_MIME)!)).toEqual({ kind: 'graphic', file: '', name: 'Counter', template: 'counter' })
  })

  it('places its template on a click', () => {
    tile.props.onClick()
    expect(placed).toEqual(['counter'])
  })
})
