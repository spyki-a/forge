import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * The Shelf replaces the left panel's tabs and the source row (docs/WINDOW.md
 * §3.1, §3.2, §6 Step 9).
 *
 * What can undo it is a line left behind — the old LeftPanel or SourceBar
 * still mounted beside the Shelf, or still on disk to be mounted again — or a
 * Shelf that loses the two things it is for: each open tool in its own error
 * boundary (before it, one throw in any of the left panel's tabs replaced the
 * whole window), and a way back from a tool to the tiles.
 *
 * Read with the TypeScript parser, in the style of tests/windowStrips.test.ts:
 * a mount is a JSX element (a comment or a string is not one), and what wraps
 * it is read from the tree. The rendered half is tests/renderer/shelfRender.test.ts.
 */

const root = resolve(__dirname, '..')
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8')
const parse = (path: string): ts.SourceFile =>
  ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

const APP = 'src/renderer/src/App.tsx'
const SHELF = 'src/renderer/src/components/shelf/Shelf.tsx'
const LEFT_PANEL = 'src/renderer/src/components/LeftPanel.tsx'
const SOURCE_BAR = 'src/renderer/src/components/SourceBar.tsx'

type Tagged = ts.JsxElement | ts.JsxSelfClosingElement
const opening = (node: Tagged): ts.JsxOpeningLikeElement => (ts.isJsxElement(node) ? node.openingElement : node)
const isTagged = (node: ts.Node): node is Tagged => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)
const tag = (node: Tagged, file: ts.SourceFile): string => opening(node).tagName.getText(file)

function mounts(file: ts.SourceFile, name: string): Tagged[] {
  const out: Tagged[] = []
  const visit = (node: ts.Node): void => {
    if (isTagged(node) && tag(node, file) === name) out.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

/** `<Name` as text, however the tag is laid out: the parse can miss nothing the text has. */
const written = (text: string, name: string): number => [...text.matchAll(new RegExp(`<${name}\\b`, 'g'))].length

const attr = (node: Tagged, name: string, file: ts.SourceFile): string | undefined =>
  opening(node)
    .attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(file) === name)
    ?.initializer?.getText(file)

function enclosing(node: ts.Node, name: string, file: ts.SourceFile): Tagged | null {
  for (let at = node.parent; at; at = at.parent) if (isTagged(at) && tag(at, file) === name) return at
  return null
}

function functionOf(node: ts.Node): ts.FunctionDeclaration | null {
  for (let at = node.parent; at; at = at.parent) if (ts.isFunctionDeclaration(at)) return at
  return null
}

/** `const name = <initializer>` anywhere in a file, as text. */
function declarations(file: ts.SourceFile): { name: string; init: string; node: ts.VariableDeclaration }[] {
  const out: { name: string; init: string; node: ts.VariableDeclaration }[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      out.push({ name: node.name.text, init: node.initializer?.getText(file) ?? '', node })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

describe('App mounts the Shelf where the tabs and the source row were', () => {
  const text = source(APP)
  const app = parse(APP)

  it('mounts the Shelf exactly once, from shelf/Shelf', () => {
    expect(written(text, 'Shelf')).toBe(1)
    expect(mounts(app, 'Shelf')).toHaveLength(1)
    expect([...text.matchAll(/^import \{ Shelf \} from '\.\/components\/shelf\/Shelf'$/gm)]).toHaveLength(1)
  })

  it('mounts neither the old left panel nor the source row', () => {
    for (const name of ['LeftPanel', 'SourceBar']) {
      expect(written(text, name), name).toBe(0)
      expect(mounts(app, name), name).toHaveLength(0)
      expect(text, name).not.toMatch(new RegExp(`from '\\./components/${name}'`))
    }
  })

  it('puts the Shelf in the left column’s first panel, where the tabs were', () => {
    // The panel that holds it is the one whose floor is the Shelf's.
    const [shelf] = mounts(app, 'Shelf')
    const panel = enclosing(shelf, 'Panel', app)
    expect(panel, 'the Panel around the Shelf').not.toBeNull()
    expect(attr(panel!, 'minSize', app)).toBe('{SHELF_FLOOR}')
    expect(functionOf(panel!)?.name?.text).toBe('LeftSplit')
  })
})

describe('the left panel and the source row are gone', () => {
  it('has neither file on disk', () => {
    expect(existsSync(resolve(root, LEFT_PANEL)), LEFT_PANEL).toBe(false)
    expect(existsSync(resolve(root, SOURCE_BAR)), SOURCE_BAR).toBe(false)
  })

  it('has nothing under src that imports either, and no source mode left in the store', () => {
    const importers = walk(resolve(root, 'src')).filter((path) =>
      /from '[^']*\/(?:LeftPanel|SourceBar)'/.test(readFileSync(path, 'utf8'))
    )
    expect(importers).toEqual([])
    // `shelfTool` replaced `sourceMode` (WINDOW.md §3.22); SourceBar was its
    // only reader. Identifiers from the parse — a comment may tell the history.
    const names = new Set<string>()
    for (const path of walk(resolve(root, 'src'))) {
      const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) names.add(node.text)
        ts.forEachChild(node, visit)
      }
      visit(file)
    }
    expect(['sourceMode', 'SourceMode', 'setSourceMode'].filter((name) => names.has(name))).toEqual([])
    // Not vacuous: the walk does see the store's names.
    expect(names.has('setShelfTool')).toBe(true)
    const store = source('src/renderer/src/store.ts')
    expect([...store.matchAll(/^ {2}shelfTool: ShelfToolId \| null$/gm)]).toHaveLength(1)
  })
})

describe('the Shelf', () => {
  const text = source(SHELF)
  const shelf = parse(SHELF)

  it('renders an open tool’s panel only inside its own error boundary, keyed by the tool', () => {
    // The panel is the registry entry's component: `const X = tool.panel`, once —
    // and it reaches the page by no other road (no createElement, no second name).
    const panels = declarations(shelf).filter((d) => /^\w+\.panel$/.test(d.init))
    expect(panels, 'const … = tool.panel').toHaveLength(1)
    expect([...text.matchAll(/\.panel\b/g)], 'the only read of .panel').toHaveLength(1)
    const [{ name, init }] = panels
    const owner = init.split('.')[0]

    const rendered = mounts(shelf, name)
    expect(rendered.length, `<${name} />`).toBeGreaterThan(0)
    for (const mount of rendered) {
      const boundary = enclosing(mount, 'ErrorBoundary', shelf)
      expect(boundary, `<${name} /> inside <ErrorBoundary>`).not.toBeNull()
      // Keyed by the tool, so another tool starts with a clean boundary, not
      // the last one's crash screen.
      expect(attr(boundary!, 'key', shelf)).toBe(`{${owner}.id}`)
    }
    // The window's own boundary, not some other component of the same name.
    expect([...text.matchAll(/^import \{ ErrorBoundary \} from '\.\.\/ErrorBoundary'$/gm)]).toHaveLength(1)
  })

  /*
   * Step 11, the user's design (WINDOW.md §6 Step 11, "Added 2026-10-03"): an
   * open tool folds the home grid into a strip of every tool over its panel —
   * the open one pressed, one click to switch, Home first — and the
   * "← Tools · name" header goes. The rendered half (shelfRender.test.ts)
   * counts the tiles and the pressed one and presses each; this pins each
   * link from the store's setter to the tiles, as the home grid's are.
   */
  it('folds an open tool’s header into the strip: the strip over the panel, and no ← header left', () => {
    // The header and every word of it: its title, its "Tools", its arrow.
    expect(text).not.toMatch(/BACK_TITLE|Back to all the tools|ArrowLeft/)
    const jsxTexts: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isJsxText(node) && node.text.trim()) jsxTexts.push(node.text.trim())
      ts.forEachChild(node, visit)
    }
    visit(shelf)
    expect(jsxTexts.filter((t) => /\bTools\b/.test(t))).toEqual([])
    // The Shelf's open face is exactly [strip, panel]: the strip, mounted
    // once, first; the census's panel box second (harness/census.ts shelfFace).
    const strips = mounts(shelf, 'ShelfStrip')
    expect(strips).toHaveLength(1)
    expect(written(text, 'ShelfStrip')).toBe(1)
    expect(functionOf(strips[0])?.name?.text).toBe('Shelf')
    const face = strips[0].parent
    expect(ts.isJsxElement(face) && /data-shelf-tool=\{tool\.id\}/.test(face.openingElement.getText(shelf))).toBe(true)
    const kids = (face as ts.JsxElement).children.filter(isTagged)
    expect(kids).toHaveLength(2)
    expect(kids[0]).toBe(strips[0])
    expect(/\bdata-shelf-panel\b/.test(opening(kids[1]).getText(shelf))).toBe(true)
    // Told which tool is open, and given the store's setter — no other.
    expect(attr(strips[0], 'open', shelf)).toBe('{tool.id}')
    expect(attr(strips[0], 'onGo', shelf)).toBe('{setShelfTool}')
    const fn = functionOf(strips[0])!
    const setter = declarations(shelf).filter((d) => d.name === 'setShelfTool' && functionOf(d.node) === fn)
    expect(setter.map((d) => d.init)).toEqual(['useEditor((s) => s.setShelfTool)'])
  })

  it('starts the strip with Home, then every tool in the registry, each a toggle of its own tool', () => {
    expect([...text.matchAll(/^export const HOME_TITLE = 'All the tools'$/gm)]).toHaveLength(1)
    const roots = mounts(shelf, 'div').filter((d) => /\bdata-shelf-strip\b/.test(opening(d).getText(shelf)))
    expect(roots).toHaveLength(1)
    expect(functionOf(roots[0])?.name?.text).toBe('ShelfStrip')
    // What the strip holds, in order: the Home tile, then the registry's map.
    const strip = roots[0] as ts.JsxElement
    const [home, ...rest] = strip.children.filter((c) => isTagged(c) || ts.isJsxExpression(c))
    expect(isTagged(home) && tag(home, shelf)).toBe('Tile')
    expect(rest.map((c) => c.getText(shelf).replace(/\s+/g, ' '))).toEqual([
      '{SHELF_TOOLS.map((tool) => ( <StripTile key={tool.id} tool={tool} pressed={tool.id === open} onGo={onGo} /> ))}'
    ])
    // Home: named and titled "All the tools", the house glyph, and it sets no tool.
    const homeTile = home as Tagged
    expect(attr(homeTile, 'title', shelf)).toBe('{HOME_TITLE}')
    expect(attr(homeTile, 'label', shelf)).toBe('{HOME_TITLE}')
    expect(attr(homeTile, 'icon', shelf)).toBe('{House}')
    expect(attr(homeTile, 'size', shelf)).toBe('"xs"')
    expect(attr(homeTile, 'onClick', shelf)).toBe('{() => onGo(null)}')
    // Not a toggle: Home is never the open tool.
    expect(attr(homeTile, 'pressed', shelf)).toBeUndefined()
    // Each tool's strip tile: pressed while it is the open one, and pressing
    // it then goes home; otherwise it opens its tool.
    const stripTiles = mounts(shelf, 'StripTile')
    expect(stripTiles).toHaveLength(1)
    expect(written(text, 'StripTile')).toBe(1)
    const tiles = mounts(shelf, 'Tile').filter((t) => functionOf(t)?.name?.text === 'StripTile')
    expect(tiles).toHaveLength(1)
    expect(attr(tiles[0], 'pressed', shelf)).toBe('{pressed}')
    expect(attr(tiles[0], 'onClick', shelf)).toBe('{() => onGo(pressed ? null : tool.id)}')
    expect(attr(tiles[0], 'title', shelf)).toBe('{tool.label}')
    expect(attr(tiles[0], 'label', shelf)).toBe('{tool.label}')
    expect(attr(tiles[0], 'size', shelf)).toBe('"xs"')
    expect(attr(tiles[0], 'busy', shelf)).toBe('{busy}')
    // The busy badge is the home tile's selector, so a run shows while another tool is open.
    const busy = declarations(shelf).filter((d) => d.name === 'busy')
    expect(busy.map((d) => [functionOf(d.node)?.name?.text, d.init])).toEqual([
      ['ShelfTile', 'useEditor((s) => (tool.busy ? tool.busy(s) : false))'],
      ['StripTile', 'useEditor((s) => (tool.busy ? tool.busy(s) : false))']
    ])
  })

  it('opens a tool from its tile, and shows the home grid when none is open', () => {
    // Home is what the Shelf returns while the store's tool is null — or one
    // the registry does not have, which must not leave the column blank.
    expect(text).toMatch(/const tool = open === null \? null : shelfToolById\(open\)\n\s*\n\s*if \(!tool\) return <ShelfHome onOpen=\{setShelfTool\} \/>/)
    // Every tile in the registry, in its order — no filter between them: once
    // on the home grid, once in the strip (step 11).
    const maps = [...text.matchAll(/SHELF_TOOLS\.map\(\(tool\) => \(/g)]
    expect(maps).toHaveLength(2)
    expect(text).not.toMatch(/SHELF_TOOLS\.filter/)
    // Each link from the store's setter to the tile, and the middle one too:
    // ShelfHome handing its tiles a dead `onOpen` drew every tile and opened
    // nothing, and passed. (The rendered half presses each tile.)
    const homes = mounts(shelf, 'ShelfHome')
    expect(homes).toHaveLength(1)
    expect(written(text, 'ShelfHome')).toBe(1)
    expect(attr(homes[0], 'onOpen', shelf)).toBe('{setShelfTool}')
    const shelfTiles = mounts(shelf, 'ShelfTile')
    expect(shelfTiles).toHaveLength(1)
    expect(written(text, 'ShelfTile')).toBe(1)
    expect(functionOf(shelfTiles[0])?.name?.text).toBe('ShelfHome')
    expect(attr(shelfTiles[0], 'onOpen', shelf)).toBe('{onOpen}')
    const tiles = mounts(shelf, 'Tile').filter((t) => functionOf(t)?.name?.text === 'ShelfTile')
    expect(tiles).toHaveLength(1)
    expect(attr(tiles[0], 'onClick', shelf)).toBe('{() => onOpen(tool.id)}')
    expect(attr(tiles[0], 'title', shelf)).toBe('{tool.hint}')
    expect(attr(tiles[0], 'label', shelf)).toBe('{tool.label}')
    // A home tile only goes somewhere: no `pressed`, so it is a plain button,
    // not a toggle that is always "not pressed" (ui/Tile.tsx).
    expect(attr(tiles[0], 'pressed', shelf)).toBeUndefined()
    // And the Shelf mounts Tile nowhere else: the home grid's, the strip's Home and its tools'.
    expect(mounts(shelf, 'Tile').map((t) => functionOf(t)?.name?.text).sort()).toEqual(['ShelfStrip', 'ShelfTile', 'StripTile'])
  })

  it('opens the Library on Stickers, and the Transitions tile on Transitions', () => {
    // The user (WINDOW.md §7.6): not on Fonts, the one drawer where nothing can
    // be clicked or dragged. The Library reads its first drawer from a prop.
    const library = source('src/renderer/src/components/Library.tsx')
    expect([...library.matchAll(/^export function Library\(\{ initialKind = 'sticker' \}: \{ initialKind\?: AssetKind \} = \{\}\): ReactNode \{$/gm)]).toHaveLength(1)
    expect([...library.matchAll(/useState<AssetKind>\(/g)]).toHaveLength(1)
    expect([...library.matchAll(/useState<AssetKind>\(initialKind\)/g)]).toHaveLength(1)
    const panels = parse('src/renderer/src/components/shelf/panels.tsx')
    const opened = Object.fromEntries(
      mounts(panels, 'Library').map((mount) => [functionOf(mount)?.name?.text, attr(mount, 'initialKind', panels)])
    )
    expect(opened).toEqual({ LibraryPanel: '"sticker"', TransitionsPanel: '"transition"' })
  })

  it('says what it shows, for the census: data-shelf-tool on both faces, data-shelf-panel on the panel', () => {
    expect([...text.matchAll(/data-shelf-tool=\{tool\.id\}/g)]).toHaveLength(1)
    expect([...text.matchAll(/data-shelf-tool="home"/g)]).toHaveLength(1)
    const boxes = mounts(shelf, 'div').filter((d) => /\bdata-shelf-panel\b/.test(opening(d).getText(shelf)))
    expect(boxes).toHaveLength(1)
    // The boundary sits straight in it, so the census's panel IS the tool's panel.
    const [boundary] = mounts(shelf, 'ErrorBoundary')
    expect(boundary.parent).toBe(boxes[0])
  })
})
