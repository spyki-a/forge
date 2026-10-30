import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { APP_FONT_FILES, CATALOG_VERSION, type AssetCatalog, type AssetKind, type CatalogEntry } from '@shared/assets/catalog'

/*
 * The Library opens the pack list by itself when the library is empty
 * (components/Library.tsx, "An empty library IS the offer") — the fix for the
 * Surface's "there was no download option, it was empty".
 *
 * Since D10 (docs/CLIPS.md §6.20) every catalogue lists the app's own two Noto
 * faces, pack or none, so a fresh install from CI is never empty by
 * `entries.length`. Empty means empty of everything but those: a catalogue
 * holding only them opens the list, one holding a further font does not. The
 * two faces are listed one relative (the scan found them under the root, a
 * development checkout) and one absolute with Windows separators (listed from
 * the app's folder beside a pack root).
 *
 * Rendered to static markup over plain-selector stand-ins for the three stores
 * (zustand's server snapshot is the INITIAL state, so the real hooks would
 * render no catalogue), as tests/renderer/ingestPanel.test.tsx does for the
 * editor's store.
 */

const stand = vi.hoisted(() => ({ catalog: null as unknown }))

function selectorOver<T extends object>(state: () => T) {
  return (select: (s: T) => unknown) => select(state())
}

vi.mock('../../src/renderer/src/catalog', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/src/catalog')>()
  const useCatalog = selectorOver(() => ({
    ...real.useCatalog.getState(),
    catalog: stand.catalog as AssetCatalog | null,
    root: '/assets',
    loading: false,
    error: null
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

const { Library } = await import('../../src/renderer/src/components/Library')

function font(file: string): CatalogEntry {
  const name = file.split(/[\\/]/).pop() ?? file
  const family = name.replace(/-Regular\.ttf$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
  return {
    id: `font:${name.toLowerCase()}`,
    kind: 'font',
    name: family,
    file,
    tags: [family, 'bundled'],
    meta: { family, source: 'bundled' }
  }
}

function catalogOf(entries: CatalogEntry[]): AssetCatalog {
  return { version: CATALOG_VERSION, generatedAt: '2026-10-29T00:00:00.000Z', scannedFrom: '/assets', entries }
}

/** Only the app's two faces: the first relative, the second absolute with Windows separators. */
const APP_ONLY = [
  font(`fonts/${APP_FONT_FILES[0]}`),
  font(`C:\\Program Files\\3dit\\resources\\assets\\fonts\\${APP_FONT_FILES[1]}`)
]

/**
 * PackList's own heading, drawn only while the list is open. The bare words
 * are not enough: the Library's toggle carries "Asset packs — download more…"
 * as its title whether the list is open or not.
 */
const PACKS_OPEN = '>Asset packs</span>'

function render(catalog: AssetCatalog | null): string {
  stand.catalog = catalog
  return renderToStaticMarkup(createElement(Library as (props: { initialKind?: AssetKind }) => ReactNode, { initialKind: 'font' }))
}

afterEach(() => {
  stand.catalog = null
})

describe('the Library opens the pack list on an empty library, not counting the app\'s own faces', () => {
  it('opens it when the catalogue holds only the two Noto faces, one relative and one absolute', () => {
    expect(APP_ONLY).toHaveLength(2)
    const html = render(catalogOf(APP_ONLY))
    expect(html, 'the pack list did not open on a library holding only the app\'s own faces').toContain(PACKS_OPEN)
    // The two faces still show under Fonts: not counted, not hidden.
    expect(html).toContain('Noto Sans Devanagari')
    expect(html).toContain('Noto Sans Telugu')
  })

  it('opens it when the catalogue is empty outright', () => {
    expect(render(catalogOf([]))).toContain(PACKS_OPEN)
  })

  it('leaves it shut when the catalogue holds one further font', () => {
    const html = render(catalogOf([...APP_ONLY, font('fonts/Anton-Regular.ttf')]))
    expect(html, 'the pack list opened on a library that holds a font of its own').not.toContain(PACKS_OPEN)
  })

  it('leaves it shut when a library file only shares a Noto name as a sticker, not a font', () => {
    const sticker: CatalogEntry = { ...font(`stickers/${APP_FONT_FILES[0]}`), id: 'sticker:x', kind: 'sticker', meta: {} }
    expect(render(catalogOf([...APP_ONLY, sticker]))).not.toContain(PACKS_OPEN)
  })

  it('leaves it shut while no catalogue has loaded', () => {
    expect(render(null)).not.toContain(PACKS_OPEN)
  })
})
