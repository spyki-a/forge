import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * The Shelf's one-click tiles each add THEIR OWN thing, and Upload uploads
 * (docs/WINDOW.md §3.3, §3.14, §6 Step 11 — step 9's known list).
 *
 * Step 9 moved the five Add buttons from above the media grid into a tile
 * each (shelf/panels.tsx) and merged "Add files" and "+ Import" into one
 * Upload button (MediaPool.tsx). Both were checked only in the harness: a
 * Text tile whose button added a colour card, or an Upload button that opened
 * the file dialog and dropped what was picked, would have drawn exactly the
 * same and passed every test. So each link is pinned here — from the tile to
 * its panel (shelf/tools.ts), from the panel to its store action, from the
 * action to the button's click — and Upload's pick-then-import.
 *
 * Read with the TypeScript parser, in the style of tests/shelf.test.ts: the
 * click is the `onClick` OF the button, the action is the one the panel names,
 * and every name is the store's.
 */

const root = resolve(__dirname, '..')
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8')
const parse = (path: string): ts.SourceFile =>
  ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

const PANELS = 'src/renderer/src/components/shelf/panels.tsx'
const TOOLS = 'src/renderer/src/components/shelf/tools.ts'
const POOL = 'src/renderer/src/components/MediaPool.tsx'
const STORE = 'src/renderer/src/store.ts'

type Tagged = ts.JsxElement | ts.JsxSelfClosingElement
const opening = (node: Tagged): ts.JsxOpeningLikeElement => (ts.isJsxElement(node) ? node.openingElement : node)
const isTagged = (node: ts.Node): node is Tagged => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)

function mounts(file: ts.SourceFile, name: string): Tagged[] {
  const out: Tagged[] = []
  const visit = (node: ts.Node): void => {
    if (isTagged(node) && opening(node).tagName.getText(file) === name) out.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

const attr = (node: Tagged, name: string, file: ts.SourceFile): string | undefined =>
  opening(node)
    .attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(file) === name)
    ?.initializer?.getText(file)

function functionOf(node: ts.Node): ts.FunctionDeclaration | null {
  for (let at = node.parent; at; at = at.parent) if (ts.isFunctionDeclaration(at)) return at
  return null
}

/** `const name = <initializer>` in a subtree, with where it is. */
function declarations(node: ts.Node): { name: string; init: ts.Expression | undefined; node: ts.VariableDeclaration }[] {
  const out: { name: string; init: ts.Expression | undefined; node: ts.VariableDeclaration }[] = []
  const visit = (at: ts.Node): void => {
    if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name)) out.push({ name: at.name.text, init: at.initializer, node: at })
    ts.forEachChild(at, visit)
  }
  visit(node)
  return out
}

/** A JSX element's children as text, whitespace collapsed. */
const childrenText = (node: Tagged, file: ts.SourceFile): string =>
  ts.isJsxElement(node) ? node.children.map((c) => c.getText(file)).join('').replace(/\s+/g, ' ').trim() : ''

/**
 * Each one-click tile: the panel the registry opens for it, the label on its
 * Add button, and the store action that button runs. The labels are the ones
 * the buttons wore above the media grid (LeftPanel.tsx:82-122 at 422801b).
 */
const ONE_CLICK = [
  { tool: 'text', panel: 'TextPanel', label: '+ Text', action: 'addTextClip' },
  { tool: 'colour-cards', panel: 'ColourCardsPanel', label: '+ Colour', action: 'addSolidClip' },
  { tool: 'grade', panel: 'GradePanel', label: '+ Grade', action: 'addAdjustmentLayer' },
  { tool: 'newspaper', panel: 'NewspaperPanel', label: '+ Newspaper clippings', action: 'addPaperClip' },
  { tool: 'card-ring', panel: 'CardRingPanel', label: '+ Card ring', action: 'addCarouselClip' }
] as const

describe('the one-click tiles each add their own thing', () => {
  const panels = parse(PANELS)

  it('opens each one-click tile on its own panel (shelf/tools.ts)', () => {
    // Every registry entry's id and panel, from the object literals themselves.
    const tools = parse(TOOLS)
    const opened = new Map<string, string[]>()
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const prop = (name: string): ts.Expression | undefined =>
          node.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(tools) === name)?.initializer
        const id = prop('id')
        const panel = prop('panel')
        if (id && ts.isStringLiteral(id) && panel) opened.set(id.text, [...(opened.get(id.text) ?? []), panel.getText(tools)])
      }
      ts.forEachChild(node, visit)
    }
    visit(tools)
    for (const { tool, panel } of ONE_CLICK) expect(opened.get(tool), tool).toEqual([panel])
    // And each of those panels is the one panels.tsx exports under that name.
    for (const { panel } of ONE_CLICK) {
      expect([...source(PANELS).matchAll(new RegExp(`^export function ${panel}\\(\\): ReactNode \\{$`, 'gm'))], panel).toHaveLength(1)
    }
  })

  it('gives each panel ITS OWN action and label — pinned pair by pair', () => {
    // Every OneClick in the file, by the function that mounts it: the five, and
    // no sixth that a swap could hide behind.
    const mounted = mounts(panels, 'OneClick').map((m) => ({
      panel: functionOf(m)?.name?.text,
      add: attr(m, 'add', panels),
      label: attr(m, 'label', panels)
    }))
    expect(mounted.map((m) => m.panel).sort()).toEqual(ONE_CLICK.map((o) => o.panel).sort())
    for (const { panel, action, label } of ONE_CLICK) {
      const mine = mounted.filter((m) => m.panel === panel)
      expect(mine, panel).toHaveLength(1)
      expect(mine[0].add, `${panel}: the action`).toBe(`"${action}"`)
      expect(mine[0].label, `${panel}: the label`).toBe(`"${label}"`)
    }
    // Five panels, five different actions: none adds another's thing.
    expect(new Set(mounted.map((m) => m.add)).size).toBe(ONE_CLICK.length)
  })

  it('runs the action the panel names, from the Add button, at the playhead on the top video track', () => {
    const fns = panels.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'OneClick')
    expect(fns).toHaveLength(1)
    const oneClick = fns[0]
    // The action is read from the store BY the prop — `s[add]` — not a fixed one.
    const adders = declarations(oneClick).filter((d) => d.init && /\buseEditor\(/.test(d.init.getText(panels)))
    expect(adders.map((d) => `${d.name} = ${d.init!.getText(panels)}`).sort()).toEqual([
      'adder = useEditor((s) => s[add])',
      'playhead = useEditor((s) => s.playhead)'
    ])
    expect(declarations(oneClick).find((d) => d.name === 'track')?.init?.getText(panels)).toBe('useTopVideoTrack()')
    // `add` and `label` are the props, by name, unrenamed.
    const [props] = oneClick.parameters
    expect(props.name.getText(panels).replace(/\s+/g, ' ')).toBe('{ icon, add, label, what }')
    // The one button: its click runs the adder there, and it wears the label.
    const button = mounts(panels, 'BigButton').filter((b) => functionOf(b) === oneClick)
    expect(button).toHaveLength(1)
    expect(attr(button[0], 'onClick', panels)).toBe('{() => void adder(track, playhead)}')
    expect(childrenText(button[0], panels)).toBe('{label}')
    expect(mounts(panels, 'BigButton')).toHaveLength(1)
  })

  it('names only the store’s own actions, each one it really has', () => {
    // The union OneClick accepts is exactly the five, and each is a store action
    // with an implementation — a name the store does not have would read undefined.
    const text = source(PANELS)
    const union = /^type Adder = ((?:'[A-Za-z]+'(?: \| )?)+)$/m.exec(text)
    expect(union, 'type Adder').not.toBeNull()
    expect([...union![1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]).sort()).toEqual(ONE_CLICK.map((o) => o.action).sort())
    const store = source(STORE)
    for (const { action } of ONE_CLICK) {
      expect([...store.matchAll(new RegExp(`^ {2}${action}: \\(trackId: string, startFrame: number`, 'gm'))], `${action}: declared`).toHaveLength(1)
      expect([...store.matchAll(new RegExp(`^ {2}${action}: async \\(trackId, startFrame`, 'gm'))], `${action}: implemented`).toHaveLength(1)
    }
  })
})

describe('Upload uploads: the file dialog, then importAssets with what was picked', () => {
  const pool = parse(POOL)
  const fn = pool.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'MediaPool')!

  it('has one Upload button, and its click runs the pick', () => {
    expect(fn, 'function MediaPool').toBeDefined()
    const uploads = mounts(pool, 'BigButton').filter((b) => childrenText(b, pool) === 'Upload')
    expect(uploads).toHaveLength(1)
    expect(functionOf(uploads[0])).toBe(fn)
    expect(attr(uploads[0], 'onClick', pool)).toBe('{() => void pick()}')
  })

  it('picks, then imports exactly the picked paths, through the store’s importAssets', () => {
    const picks = declarations(fn).filter((d) => d.name === 'pick')
    expect(picks).toHaveLength(1)
    const init = picks[0].init!
    // useCallback(async () => { … }, [importAssets])
    expect(ts.isCallExpression(init) && init.expression.getText(pool)).toBe('useCallback')
    const body = (init as ts.CallExpression).arguments[0]
    expect(ts.isArrowFunction(body) && body.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)).toBe(true)
    expect((init as ts.CallExpression).arguments[1]?.getText(pool)).toBe('[importAssets]')

    // Inside it: `const paths = await window.forge.pickMedia()`, then
    // `await importAssets(paths)` — in that order, with that variable.
    const inside = declarations(body)
    const picked = inside.filter((d) => d.init?.getText(pool) === 'await window.forge.pickMedia()')
    expect(picked, 'the dialog').toHaveLength(1)
    const pathsName = picked[0].name
    const calls: ts.CallExpression[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) calls.push(node)
      ts.forEachChild(node, visit)
    }
    visit(body)
    const imports = calls.filter((c) => c.expression.getText(pool) === 'importAssets')
    expect(imports, 'importAssets(…) in the pick').toHaveLength(1)
    expect(imports[0].arguments.map((a) => a.getText(pool))).toEqual([pathsName])
    // Awaited, so the button stays busy until the import is done.
    expect(ts.isAwaitExpression(imports[0].parent)).toBe(true)
    // After the dialog, not before it.
    expect(imports[0].getStart(pool)).toBeGreaterThan(picked[0].node.getStart(pool))

    // And `importAssets` is the store's, read in MediaPool itself.
    const store = declarations(fn).filter((d) => d.name === 'importAssets')
    expect(store.map((d) => d.init?.getText(pool))).toEqual(['useEditor((s) => s.importAssets)'])
    expect([...source(STORE).matchAll(/^ {2}importAssets: async \(paths\) => \{$/gm)]).toHaveLength(1)
  })
})
