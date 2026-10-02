import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyProject, type Project } from '@shared/timeline'
import { resolveStyle, type CaptionStyle, type StyleOverrides } from '@shared/captions/style'

/**
 * The startup loads belong to the app shell, not to a panel.
 *
 * The transition table, the asset catalog, the built-in looks and the caption
 * font were all loaded by the Inspector's mount effects — which ran at startup
 * only because the Inspector was always on screen. The new window shows the
 * clip editor only on a selection (docs/WINDOW.md §3.20, §6 step 1), and the
 * Preview's wipes, the Timeline's labels, `ensureFont` and the live captions
 * need these whether or not any panel is open. So App.tsx loads them.
 *
 * Read with the TypeScript parser, not searched: a call is counted only where
 * it is a CALL (never a comment or a string), and its place is checked by
 * walking up — inside a `useEffect` callback, inside `function App`.
 */

const root = resolve(__dirname, '..')

/*
 * Renderer modules, imported at run time by a computed path: this file is
 * type-checked as node code (tsconfig.node.json), which has no `window`, so a
 * static import would pull the renderer into that program and fail it.
 */
const renderer = (name: string): Promise<unknown> => import(/* @vite-ignore */ `../src/renderer/src/${name}`)

interface CatalogStore {
  getState(): {
    looks: unknown[]
    catalog: unknown
    failedFonts: Map<string, string>
    loadedFonts: Set<string>
    load(): Promise<void>
    loadLooks(): Promise<void>
    ensureFont(family: string): Promise<boolean>
  }
}
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')
const parse = (path: string): ts.SourceFile =>
  ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function calls(file: ts.SourceFile, callee: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === callee) out.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

/** The `useEffect(…)` whose callback this node sits in, if any. */
function enclosingEffect(node: ts.Node, file: ts.SourceFile): ts.CallExpression | null {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (
      (ts.isArrowFunction(at) || ts.isFunctionExpression(at)) &&
      ts.isCallExpression(at.parent) &&
      at.parent.expression.getText(file) === 'useEffect' &&
      at.parent.arguments[0] === at
    ) {
      return at.parent
    }
  }
  return null
}

/** The name of the function declaration this node sits in, if any. */
function enclosingFunction(node: ts.Node): string | null {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isFunctionDeclaration(at)) return at.name?.text ?? null
  }
  return null
}

const deps = (effect: ts.CallExpression, file: ts.SourceFile): string[] => {
  const list = effect.arguments[1]
  return list && ts.isArrayLiteralExpression(list) ? list.elements.map((e) => e.getText(file)) : []
}

describe('the app shell loads what the whole window draws from', () => {
  const app = parse('src/renderer/src/App.tsx')

  /*
   * Each loader exactly once, in an effect of App. More than one would be a
   * second site nobody meant; none is the regression this file is for.
   */
  for (const callee of [
    'useCatalog.getState().loadTransitions',
    'useCatalog.getState().load',
    'useCatalog.getState().loadLooks',
    'useCatalog.getState().ensureFont'
  ]) {
    it(`calls ${callee}() once, from an effect of App`, () => {
      const found = calls(app, callee)
      expect(found, callee).toHaveLength(1)
      const effect = enclosingEffect(found[0], app)
      expect(effect, `${callee} is not inside a useEffect callback`).not.toBeNull()
      expect(enclosingFunction(effect!), callee).toBe('App')
    })
  }

  it('asks for the caption face of the RESOLVED style, and again once the catalog lands', () => {
    const [ensure] = calls(app, 'useCatalog.getState().ensureFont')
    expect(ensure.arguments.map((a) => a.getText(app))).toEqual(['captionFont'])
    // Before the catalog there is nothing to find the face in, so the effect
    // has to run again when it arrives — or the font is never registered.
    expect(deps(enclosingEffect(ensure, app)!, app)).toEqual(
      expect.arrayContaining(['captionFont', 'catalogLoaded'])
    )

    // `captionFont` is the preset with the project's overrides on top, the
    // way the Preview draws captions — not the preset's face alone.
    const declared: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.name.getText(app) === 'captionFont') {
        declared.push(node.initializer?.getText(app) ?? '')
      }
      ts.forEachChild(node, visit)
    }
    visit(app)
    expect(declared).toHaveLength(1)
    expect(declared[0]).toContain('activeCaptionStyle(s.project).fontFamily')
  })

  it('resolves the caption style the way the Inspector does', async () => {
    const { activeCaptionStyle } = (await renderer('captionPreview')) as {
      activeCaptionStyle: (project: Project) => CaptionStyle
    }
    const project = emptyProject()
    project.captions = { ...project.captions, styleId: 'pop', overrides: { fontFamily: 'Bebas Neue' } }
    const inspectorWay = resolveStyle(
      project.captions.styleId,
      project.captions.overrides as StyleOverrides | undefined
    )
    expect(activeCaptionStyle(project)).toEqual(inspectorWay)
    expect(activeCaptionStyle(project).fontFamily).toBe('Bebas Neue')
    // And without overrides, the preset's own face.
    project.captions = { enabled: true, styleId: 'pop' }
    expect(activeCaptionStyle(project).fontFamily).toBe(resolveStyle('pop').fontFamily)
  })
})

describe('the Inspector no longer loads them', () => {
  const path = 'src/renderer/src/components/Inspector.tsx'
  const source = read(path)
  const inspector = parse(path)

  it('reads the looks from the catalog store instead of fetching them', () => {
    expect([...source.matchAll(/window\.forge\.builtInLooks\(/g)]).toHaveLength(0)
    expect(calls(inspector, 'window.forge.builtInLooks')).toHaveLength(0)
    // The positive half, so the negative above cannot pass on a rename alone.
    expect([...source.matchAll(/useCatalog\(\(s\) => s\.looks\)/g)]).toHaveLength(1)
    expect([...source.matchAll(/\{looks\.map\(\(look\) =>/g)]).toHaveLength(1)
  })

  it('does not load the transition table', () => {
    const loads: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && /(^|\.)loadTransitions$/.test(node.expression.getText(inspector))) {
        loads.push(node.getText(inspector))
      }
      ts.forEachChild(node, visit)
    }
    visit(inspector)
    expect(loads).toEqual([])
  })
})

describe('the startup calls exist on both stand-in bridges', () => {
  it('the fallback bridge answers builtInLooks with an empty list', () => {
    const main = parse('src/renderer/src/main.tsx')
    const found: string[] = []
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(main) === 'builtInLooks' &&
        enclosingFunction(node) === 'installFallbackBridge'
      ) {
        found.push(node.initializer.getText(main))
      }
      ts.forEachChild(node, visit)
    }
    visit(main)
    expect(found).toEqual(['async () => []'])
  })

  it('the harness bridge answers builtInLooks', () => {
    const bridge = read('src/renderer/src/harness/bridge.ts')
    expect([...bridge.matchAll(/^\s*builtInLooks: async \(\) =>/gm)]).toHaveLength(1)
  })
})

/* ------------------------------------------------------------- behaviour */

/** A fresh catalog module, so the one-request guard starts clean in each test. */
async function freshCatalog(): Promise<CatalogStore> {
  vi.resetModules()
  return ((await renderer('catalog')) as { useCatalog: CatalogStore }).useCatalog
}

const LOOKS = [{ id: 'warm', name: 'Warm', description: 'Warm film', file: '/looks/warm.cube' }]

describe('loadLooks', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('asks the bridge once, however many times it is called', async () => {
    const builtInLooks = vi.fn(async () => LOOKS)
    vi.stubGlobal('window', { forge: { builtInLooks } })
    const useCatalog = await freshCatalog()
    expect(useCatalog.getState().looks).toEqual([])
    // StrictMode runs the mount effect twice; the second must not ask again.
    await Promise.all([useCatalog.getState().loadLooks(), useCatalog.getState().loadLooks()])
    await useCatalog.getState().loadLooks()
    expect(builtInLooks).toHaveBeenCalledTimes(1)
    expect(useCatalog.getState().looks).toEqual(LOOKS)
  })

  it('a failure leaves an empty list and says so in the console', async () => {
    vi.stubGlobal('window', {
      forge: {
        builtInLooks: async () => {
          throw new Error('looks:list not handled')
        }
      }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const useCatalog = await freshCatalog()
    await expect(useCatalog.getState().loadLooks()).resolves.toBeUndefined()
    expect(useCatalog.getState().looks).toEqual([])
    expect(warn).toHaveBeenCalledWith('Built-in looks failed to load', expect.any(Error))
  })
})

describe('ensureFont before the catalog has landed', () => {
  /*
   * Measured 2026-10-02: the Preview asks for the caption face in its first
   * effect, before the shell's catalog load has started, and `ensureFont`
   * recorded that as "not in the catalog" — for good. The ask made once the
   * catalog had arrived was answered from that record, so the default caption
   * font (Anton) was never registered.
   */
  const anton = {
    catalog: {
      version: 1,
      generatedAt: '',
      entries: [
        { id: 'font-anton', kind: 'font', name: 'Anton', file: 'fonts/Anton.ttf', tags: [], meta: { family: 'Anton' } }
      ]
    },
    root: '/assets',
    exists: true
  }

  let added: string[]

  beforeEach(() => {
    added = []
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(readonly family: string) {}
        async load(): Promise<this> {
          return this
        }
      }
    )
    vi.stubGlobal('document', { fonts: { add: (face: { family: string }) => added.push(face.family) } })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('is not a failure — the same family loads once the catalog is there', async () => {
    let land!: () => void
    const landed = new Promise<void>((done) => (land = done))
    vi.stubGlobal('window', {
      forge: {
        assetCatalog: async () => {
          await landed
          return anton
        },
        assetFontData: async () => new ArrayBuffer(8)
      }
    })
    const useCatalog = await freshCatalog()

    // The order the window runs them in: the Preview's ask, then the shell's load.
    const early = useCatalog.getState().ensureFont('Anton')
    const loading = useCatalog.getState().load()
    expect(await early).toBe(false)
    land()
    await loading
    expect(useCatalog.getState().catalog).not.toBeNull()

    expect(useCatalog.getState().failedFonts.has('Anton')).toBe(false)
    expect(await useCatalog.getState().ensureFont('Anton')).toBe(true)
    expect(useCatalog.getState().loadedFonts.has('Anton')).toBe(true)
    expect(added).toEqual(['Anton'])
  })

  it('a catalog that really lacks the family still records it', async () => {
    vi.stubGlobal('window', {
      forge: { assetCatalog: async () => anton, assetFontData: async () => new ArrayBuffer(8) }
    })
    const useCatalog = await freshCatalog()
    await useCatalog.getState().load()
    expect(await useCatalog.getState().ensureFont('Nonesuch')).toBe(false)
    expect(useCatalog.getState().failedFonts.get('Nonesuch')).toBe('not in the catalog')
  })
})
