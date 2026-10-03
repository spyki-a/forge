import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * The Automation panel became one panel per tool (docs/WINDOW.md §3.8–3.14,
 * §6 Step 10).
 *
 * In step 9 all eight automation tiles opened the same Automation panel, so a
 * tile pointed at the wrong section could not be seen. Now each opens its own,
 * and what can undo that is a tile pointed at another tile's panel, the old
 * panel left on disk to be mounted again, or a tool losing a control it had
 * while it sat beside the others: One photo READS the reel's Motion and
 * Transitions and runs on the reel's state (store.ts buildOnePhotoReel), so
 * alone it needs mirrors of those sliders and of the reel's Stop; and the
 * Depth / Parallax tile mirrors the reel's Depth parallax box.
 *
 * Read with the TypeScript parser, in the style of tests/shelf.test.ts and
 * tests/shelfRegistry.test.ts. The loaded half — that each tile's `panel` IS
 * that component — is tests/renderer/shelfTools.test.ts; the guards on the
 * build buttons are tests/toolInterlocks.test.ts.
 */

const root = resolve(__dirname, '..')
const COMPONENTS = 'src/renderer/src/components'
const TOOLS = `${COMPONENTS}/tools`
const REGISTRY = `${COMPONENTS}/shelf/tools.ts`

const source = (path: string): string => readFileSync(resolve(root, path), 'utf8')
const parse = (path: string): ts.SourceFile =>
  ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

type Tagged = ts.JsxElement | ts.JsxSelfClosingElement
const isTagged = (node: ts.Node): node is Tagged => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)
const opening = (node: Tagged): ts.JsxOpeningLikeElement => (ts.isJsxElement(node) ? node.openingElement : node)
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

/** Each attribute of an element, as written: `{…}` and `"…"` kept. */
function attrs(node: Tagged, file: ts.SourceFile): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of opening(node).attributes.properties) {
    if (ts.isJsxAttribute(p)) out[p.name.getText(file)] = p.initializer?.getText(file) ?? 'true'
  }
  return out
}

/** `const name = <init>` anywhere in a file, as text. */
function declared(file: ts.SourceFile, name: string): string[] {
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      out.push(node.initializer?.getText(file) ?? '')
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

/** The text of an element's JSX text children, joined. */
const words = (node: ts.Node, file: ts.SourceFile): string => {
  const out: string[] = []
  const visit = (at: ts.Node): void => {
    if (ts.isJsxText(at)) out.push(at.getText(file))
    ts.forEachChild(at, visit)
  }
  visit(node)
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

/* ------------------------------------------------------------ the registry */

/** Each registry entry's id and panel name, in order. */
function registry(): { id: string; panel: string }[] {
  const file = parse(REGISTRY)
  const found: ts.ArrayLiteralExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'SHELF_TOOLS' && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      found.push(node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  expect(found, 'export const SHELF_TOOLS = [ … ]').toHaveLength(1)
  return found[0].elements.map((element) => {
    const props = new Map<string, ts.Expression>()
    for (const p of (element as ts.ObjectLiteralExpression).properties) {
      if (ts.isPropertyAssignment(p)) props.set(p.name.getText(file), p.initializer)
    }
    const id = props.get('id')
    const panel = props.get('panel')
    return {
      id: id && ts.isStringLiteral(id) ? id.text : '',
      panel: panel && ts.isIdentifier(panel) ? panel.text : ''
    }
  })
}

/** Every name the registry imports, with the module it comes from. */
function imports(): Map<string, string> {
  const file = parse(REGISTRY)
  const out = new Map<string, string>()
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue
    const from = (statement.moduleSpecifier as ts.StringLiteral).text
    const named = statement.importClause.namedBindings
    if (named && ts.isNamedImports(named)) for (const el of named.elements) out.set(el.name.text, from)
  }
  return out
}

/** Each automation tile, the panel it opens, and where that panel is written. */
const OWN: [id: string, panel: string, module: string][] = [
  ['director', 'Director', '../Director'],
  ['depth-parallax', 'DepthParallax', '../tools/DepthParallax'],
  ['beat-sync', 'BeatSync', '../tools/BeatSync'],
  ['one-photo', 'OnePhoto', '../tools/OnePhoto'],
  ['grid-split', 'GridSplit', '../tools/GridSplit'],
  ['strip-flashes', 'StripFlashes', '../tools/StripFlashes'],
  ['film-strip', 'FilmStrip', '../tools/FilmStrip'],
  ['props-3d', 'Props3d', '../tools/Props3d']
]

describe('the Automation panel is gone', () => {
  it('is not on disk, and nothing under src imports it', () => {
    expect(existsSync(resolve(root, `${COMPONENTS}/Automation.tsx`))).toBe(false)
    const files = walk(resolve(root, 'src'))
    // Not vacuous: the walk does see the tools.
    expect(files.some((path) => path.endsWith(join('tools', 'BeatSync.tsx')))).toBe(true)
    const importers = files.filter((path) => /from '[^']*\/Automation'/.test(readFileSync(path, 'utf8')))
    expect(importers).toEqual([])
  })
})

describe('each automation tile opens a panel of its own', () => {
  const entries = registry()
  const from = imports()

  for (const [id, panel, module] of OWN) {
    it(`${id} opens ${panel}, written in ${module}`, () => {
      const mine = entries.filter((entry) => entry.id === id)
      expect(mine.map((entry) => entry.panel)).toEqual([panel])
      expect(from.get(panel)).toBe(module)
      // And the module exports that component, by that name.
      const path = `${COMPONENTS}/${module.slice(3)}.tsx`
      expect(existsSync(resolve(root, path)), path).toBe(true)
      expect([...source(path).matchAll(new RegExp(`^export function ${panel}\\(\\): ReactNode \\{$`, 'gm'))], path).toHaveLength(1)
    })
  }

  it('gives the eight tiles eight different panels, none another tile’s', () => {
    const automation = OWN.map(([id]) => entries.find((entry) => entry.id === id)?.panel)
    expect(new Set(automation).size).toBe(OWN.length)
    const others = entries.filter((entry) => !OWN.some(([id]) => id === entry.id)).map((entry) => entry.panel)
    expect(automation.filter((panel) => others.includes(panel ?? ''))).toEqual([])
  })
})

/* -------------------------------------------------- the panels themselves */

/**
 * A button's click: an arrow calling `build…()`, or `build…` itself. The call
 * may pass one name — One photo and Grid split pass the photo chosen in their
 * Choose from media list (`buildGrid(chosen)`, step 12).
 */
function buildCalled(button: Tagged, file: ts.SourceFile): string | null {
  const click = attrs(button, file).onClick ?? ''
  const m = /^\{(?:\(\) => (?:void )?)?(build\w*)(?:\((?:\w+)?\))?\}$/.exec(click)
  return m ? m[1] : null
}

describe('each tool panel has one build button, and only the tools that build have one', () => {
  const BUILDS: Record<string, string> = {
    'BeatSync.tsx': 'buildReel',
    'OnePhoto.tsx': 'buildOnePhotoReel',
    'GridSplit.tsx': 'buildGrid',
    'StripFlashes.tsx': 'buildStrips',
    'FilmStrip.tsx': 'buildFilmstrip'
  }

  it('reads every tool file there is', () => {
    const present = readdirSync(resolve(root, TOOLS)).filter((name) => name.endsWith('.tsx'))
    expect(present).toEqual(expect.arrayContaining([...Object.keys(BUILDS), 'Props3d.tsx', 'DepthParallax.tsx']))
  })

  for (const [name, build] of Object.entries(BUILDS)) {
    it(`${name}: one button runs ${build}, the store's`, () => {
      const file = parse(`${TOOLS}/${name}`)
      const all = mounts(file, 'button')
      expect(all.length, `${name} has buttons`).toBeGreaterThan(0)
      const builds = all.map((b) => buildCalled(b, file)).filter((called): called is string => called !== null)
      expect(builds).toEqual([build])
      expect(declared(file, build)).toEqual([`useEditor((s) => s.${build})`])
    })
  }

  it('Props3d places props instead: no build button, one that runs the prop rule', () => {
    const file = parse(`${TOOLS}/Props3d.tsx`)
    const all = mounts(file, 'button')
    // The On/Off switch, Place props / Regenerate, and Clear.
    expect(all).toHaveLength(3)
    expect(all.map((b) => buildCalled(b, file)).filter(Boolean)).toEqual([])
    const runs = all.filter((b) => attrs(b, file).onClick === '{() => void run()}')
    expect(runs).toHaveLength(1)
    expect(declared(file, 'applyPropRule')).toEqual(['useEditor((s) => s.applyPropRule)'])
    expect([...source(`${TOOLS}/Props3d.tsx`).matchAll(/await applyPropRule\(\)/g)]).toHaveLength(1)
  })

  it('DepthParallax builds nothing: it is a pointer panel, with no button at all', () => {
    const file = parse(`${TOOLS}/DepthParallax.tsx`)
    expect(mounts(file, 'button')).toHaveLength(0)
    // Not vacuous: the parse sees its elements.
    expect(mounts(file, 'input')).toHaveLength(1)
  })
})

/* ------------------------------------------------------------- the mirrors */

/** The `<input>` in a file whose change calls `setter(`, each with its row's label. */
function controls(path: string, setter: string): { attrs: Record<string, string>; label: string }[] {
  const file = parse(path)
  return mounts(file, 'input')
    .filter((input) => (attrs(input, file).onChange ?? '').includes(`${setter}(`))
    .map((input) => {
      // The row is the input's parent element; its label the row's own words.
      let row: ts.Node = input.parent
      while (row && !isTagged(row)) row = row.parent
      return { attrs: attrs(input, file), label: row ? words(row, file) : '' }
    })
}

describe('One photo mirrors what it reads of the reel', () => {
  const ONE = `${TOOLS}/OnePhoto.tsx`
  const BEAT = `${TOOLS}/BeatSync.tsx`
  const one = parse(ONE)
  const beat = parse(BEAT)

  it('the store has the two fields and their setters', () => {
    const store = source('src/renderer/src/store.ts')
    // The interface's lines: each once (the implementations below them read differently).
    for (const line of ['reelMotion: number', 'setReelMotion: (amount: number) => void', 'reelTransitions: number', 'setReelTransitions: (rate: number) => void']) {
      expect([...store.matchAll(new RegExp(`^ {2}${line.replace(/[()]/g, '\\$&')}$`, 'gm'))], line).toHaveLength(1)
    }
  })

  for (const [field, setter, label] of [
    ['reelMotion', 'setReelMotion', 'Motion'],
    ['reelTransitions', 'setReelTransitions', 'Transitions']
  ] as const) {
    it(`has a ${label} slider bound to ${field}, written as Beat sync's`, () => {
      const mine = controls(ONE, setter)
      expect(mine, `<input onChange={… ${setter}(…)}> in OnePhoto`).toHaveLength(1)
      expect(mine[0].attrs.type).toBe('"range"')
      expect(mine[0].attrs.value).toContain(field)
      expect(mine[0].label).toBe(label)
      // The store's field and setter, not a local copy of either.
      expect(declared(one, field)).toEqual([`useEditor((s) => s.${field})`])
      expect(declared(one, setter)).toEqual([`useEditor((s) => s.${setter})`])
      // The same control as Beat sync's: one setting, two places to set it.
      const theirs = controls(BEAT, setter)
      expect(theirs).toHaveLength(1)
      expect(declared(beat, setter)).toEqual([`useEditor((s) => s.${setter})`])
      expect(mine[0]).toEqual(theirs[0])
    })
  }

  it('has the reel’s Stop, on the reel’s cancel, while the reel’s state says it runs', () => {
    const stops = mounts(one, 'button').filter((b) => words(b, one) === 'Stop')
    expect(stops).toHaveLength(1)
    expect(attrs(stops[0], one).onClick).toBe('{cancelReel}')
    expect(declared(one, 'cancelReel')).toEqual(['useEditor((s) => s.cancelReel)'])
    expect(declared(one, 'reelBuilding')).toEqual(['useEditor((s) => s.reelBuilding)'])
    // And the reel's progress: the stage it is at, or what is being baked.
    expect([...source(ONE).matchAll(/\{bakeMessage \?\? reelStage \?\? 'analysing the music'\}/g)]).toHaveLength(1)
  })
})

describe('Depth / Parallax mirrors the reel’s Depth parallax box', () => {
  it('is the same box: the same field, the same setter, the same words', () => {
    const DEPTH = `${TOOLS}/DepthParallax.tsx`
    const BEAT = `${TOOLS}/BeatSync.tsx`
    const mine = controls(DEPTH, 'setReelParallax')
    const theirs = controls(BEAT, 'setReelParallax')
    expect(mine).toHaveLength(1)
    expect(theirs).toHaveLength(1)
    expect(mine[0].attrs).toEqual(theirs[0].attrs)
    expect(mine[0].attrs.checked).toBe('{reelParallax}')
    for (const path of [DEPTH, BEAT]) {
      const file = parse(path)
      expect(declared(file, 'reelParallax'), path).toEqual(['useEditor((s) => s.reelParallax)'])
      expect(declared(file, 'setReelParallax'), path).toEqual(['useEditor((s) => s.setReelParallax)'])
    }
    // Its label reads as Beat sync's does, so the census finds the same words in both.
    const label = (path: string): string[] => {
      const file = parse(path)
      return mounts(file, 'label').map((l) => words(l, file))
    }
    expect(label(DEPTH).some((text) => text.startsWith('Depth parallax '))).toBe(true)
    expect(label(BEAT).some((text) => text.startsWith('Depth parallax '))).toBe(true)
  })
})
