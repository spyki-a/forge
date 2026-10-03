import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Every Shelf tool that takes media starts with where it comes from
 * (docs/WINDOW.md §3.10–3.14, §6 Step 12).
 *
 * The user's rule (sheet 20): each such tool begins "upload a file, or choose
 * from the media". tools/SourceLine.tsx is that beginning — Upload a file, and
 * a "Uses:" line saying what the tool will take — and what can undo it is
 * quiet: a tool that loses its line (nothing else on screen says what it
 * takes), a line moved down under the settings where nobody reads it first,
 * a Choose list on a tool whose store action cannot take the choice (phase 2,
 * WINDOW.md §7 answer 7 — the list would mark a photo the build then
 * ignores), a choice that is shown but never passed to the build, or an
 * Upload button that opens the dialog and drops what was picked.
 *
 * Read with the TypeScript parser, in the style of tests/shelf.test.ts and
 * tests/oneClickWiring.test.ts: a mount is a JSX element, its place is read
 * from the tree, every name is the store's. The store half — that the action
 * builds from the id it is given — is tests/renderer/sourceChoice.test.ts.
 */

const root = resolve(__dirname, '..')
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8')
const parse = (path: string): ts.SourceFile =>
  ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

const COMPONENTS = 'src/renderer/src/components'
const SOURCE_LINE = `${COMPONENTS}/tools/SourceLine.tsx`
const REGISTRY = `${COMPONENTS}/shelf/tools.ts`

type Tagged = ts.JsxElement | ts.JsxSelfClosingElement
const isTagged = (node: ts.Node): node is Tagged => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)
const opening = (node: Tagged): ts.JsxOpeningLikeElement => (ts.isJsxElement(node) ? node.openingElement : node)
const tag = (node: Tagged, file: ts.SourceFile): string => opening(node).tagName.getText(file)

function mounts(file: ts.Node, name: string, sf: ts.SourceFile): Tagged[] {
  const out: Tagged[] = []
  const visit = (node: ts.Node): void => {
    if (isTagged(node) && tag(node, sf) === name) out.push(node)
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

function functionOf(node: ts.Node): ts.FunctionDeclaration | null {
  for (let at = node.parent; at; at = at.parent) if (ts.isFunctionDeclaration(at)) return at
  return null
}

/** `const name = <init>` in a subtree. */
function declarations(node: ts.Node): { name: string; init: ts.Expression | undefined; node: ts.VariableDeclaration }[] {
  const out: { name: string; init: ts.Expression | undefined; node: ts.VariableDeclaration }[] = []
  const visit = (at: ts.Node): void => {
    if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name)) out.push({ name: at.name.text, init: at.initializer, node: at })
    ts.forEachChild(at, visit)
  }
  visit(node)
  return out
}

/** The JSX text inside a node, joined and collapsed. */
function words(node: ts.Node, file: ts.SourceFile): string {
  const out: string[] = []
  const visit = (at: ts.Node): void => {
    if (ts.isJsxText(at)) out.push(at.getText(file))
    ts.forEachChild(at, visit)
  }
  visit(node)
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

/** An element's (or fragment's) children that are elements — not text, not `{…}` (comments, conditionals). */
function elementChildren(node: ts.JsxElement | ts.JsxFragment): Tagged[] {
  return node.children.filter(isTagged)
}

/** The one `return (…)` JSX of a function: what it draws. */
function drawn(fn: ts.FunctionDeclaration): ts.JsxElement | ts.JsxFragment {
  const found: (ts.JsxElement | ts.JsxFragment)[] = []
  for (const statement of fn.body?.statements ?? []) {
    if (!ts.isReturnStatement(statement) || !statement.expression) continue
    let expr: ts.Expression = statement.expression
    while (ts.isParenthesizedExpression(expr)) expr = expr.expression
    if (ts.isJsxElement(expr) || ts.isJsxFragment(expr)) found.push(expr)
  }
  expect(found, `${fn.name?.text}: one returned JSX tree`).toHaveLength(1)
  return found[0]
}

function fn(file: ts.SourceFile, name: string): ts.FunctionDeclaration {
  const found = file.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name)
  expect(found, `function ${name}`).toHaveLength(1)
  return found[0]
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}
const posix = (path: string): string => relative(root, path).split(sep).join('/')

/* ------------------------------------------------------------- the seven */

/**
 * Each media tool's panel: the file, the component that draws it, the tool id
 * its line is for, and the header it opens on (the tool's own, step 10). Card
 * ring has no header (a one-click panel); Director's line goes over its
 * picture list, which is the Director's source picker.
 */
const PANELS: { tool: string; path: string; component: string; header?: string }[] = [
  { tool: 'beat-sync', path: `${COMPONENTS}/tools/BeatSync.tsx`, component: 'BeatSync', header: 'Beat-synced reel' },
  { tool: 'one-photo', path: `${COMPONENTS}/tools/OnePhoto.tsx`, component: 'OnePhoto', header: 'One photo' },
  { tool: 'grid-split', path: `${COMPONENTS}/tools/GridSplit.tsx`, component: 'GridSplit', header: 'Grid split' },
  { tool: 'strip-flashes', path: `${COMPONENTS}/tools/StripFlashes.tsx`, component: 'StripFlashes', header: 'Strip flashes' },
  { tool: 'film-strip', path: `${COMPONENTS}/tools/FilmStrip.tsx`, component: 'FilmStrip', header: 'Filmstrip' },
  { tool: 'card-ring', path: `${COMPONENTS}/shelf/panels.tsx`, component: 'CardRingPanel' },
  { tool: 'director', path: `${COMPONENTS}/Director.tsx`, component: 'Director' }
]

/** The two whose store action takes the photo: buildOnePhotoReel(assetId?), buildGrid(assetId?). */
const CHOOSING: Record<string, string> = { 'one-photo': 'buildOnePhotoReel', 'grid-split': 'buildGrid' }

describe('every media tool starts with its source line', () => {
  it('mounts SourceLine once in each of the seven, for its own tool, and nowhere else', () => {
    const everywhere = walk(resolve(root, 'src'))
      .map((path) => ({ path: posix(path), n: [...readFileSync(path, 'utf8').matchAll(/<SourceLine\b/g)].length }))
      .filter((f) => f.n > 0)
    // Not vacuous: the walk sees the seven.
    expect(everywhere.map((f) => f.path).sort()).toEqual(PANELS.map((p) => p.path).sort())
    for (const f of everywhere) expect(f.n, f.path).toBe(1)

    for (const { tool, path, component } of PANELS) {
      const file = parse(path)
      const lines = mounts(file, 'SourceLine', file)
      expect(lines, path).toHaveLength(1)
      expect(functionOf(lines[0])?.name?.text, path).toBe(component)
      expect(attrs(lines[0], file).tool, path).toBe(`"${tool}"`)
      // From the one module, by name.
      expect([...source(path).matchAll(/^import \{ SourceLine \} from '(\.\/SourceLine|\.\.\/tools\/SourceLine|\.\/tools\/SourceLine)'$/gm)], path).toHaveLength(1)
    }
  })

  it('gives the line only to tools the registry says take media', () => {
    // Membership: each of the seven is a takesMedia tool (shelf/tools.ts).
    const file = parse(REGISTRY)
    const takes = new Map<string, string>()
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const prop = (name: string): ts.Expression | undefined =>
          node.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(file) === name)?.initializer
        const id = prop('id')
        const media = prop('takesMedia')
        if (id && ts.isStringLiteral(id) && media) takes.set(id.text, media.getText(file))
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
    for (const { tool } of PANELS) expect(takes.get(tool), tool).toBe('true')
  })

  for (const { tool, path, component, header } of PANELS.filter((p) => p.header)) {
    it(`${component}: the line is the first thing under the tool's header, before what the tool is`, () => {
      const file = parse(path)
      const tree = drawn(fn(file, component))
      expect(ts.isJsxElement(tree) && tag(tree, file), `${component} draws a <section>`).toBe('section')
      const kids = elementChildren(tree)
      // The ordered shape at the top: the header row, the line, the description.
      expect(kids.slice(0, 3).map((k) => tag(k, file)), component).toEqual(['div', 'SourceLine', 'p'])
      // The header row's first part is the tool's name (the second, a count or a note).
      const name = ts.isJsxElement(kids[0]) ? elementChildren(kids[0])[0] : undefined
      expect(name && words(name, file), `${component}: its header`).toBe(header!)
      expect(attrs(kids[1], file).tool).toBe(`"${tool}"`)
    })
  }

  it('CardRingPanel: the line over the Add button, as the panel’s first part', () => {
    const file = parse(`${COMPONENTS}/shelf/panels.tsx`)
    const tree = drawn(fn(file, 'CardRingPanel'))
    expect(ts.isJsxFragment(tree)).toBe(true)
    const kids = elementChildren(tree)
    expect(kids.map((k) => tag(k, file))).toEqual(['div', 'OneClick'])
    // The wrapper holds the line alone: it is padding, not another control.
    expect(ts.isJsxElement(kids[0]) && elementChildren(kids[0]).map((k) => tag(k, file))).toEqual(['SourceLine'])
    expect(attrs(kids[1], file).add).toBe('"addCarouselClip"')
  })

  it('Director: the line straight over “Your pictures, in order”, its source picker', () => {
    const file = parse(`${COMPONENTS}/Director.tsx`)
    const [line] = mounts(file, 'SourceLine', file)
    const parent = line.parent
    expect(ts.isJsxElement(parent) && tag(parent, file)).toBe('section')
    const kids = elementChildren(parent as ts.JsxElement)
    const at = kids.indexOf(line)
    expect(at).toBeGreaterThan(0)
    const next = kids[at + 1]
    expect(tag(next, file)).toBe('button')
    expect(words(next, file)).toBe('Your pictures, in order')
    // And the list it points at is the slot list, right after.
    expect([...source(`${COMPONENTS}/Director.tsx`).matchAll(/Your pictures, in order/g)]).toHaveLength(1)
  })
})

/* --------------------------------------------------------- choose from media */

describe('Choose from media is on One photo and Grid split only, and the build takes the choice', () => {
  it('passes `choose` on exactly the two tools whose store action takes a photo', () => {
    const given = PANELS.filter(({ path }) => {
      const file = parse(path)
      return mounts(file, 'SourceLine', file).some((m) => 'choose' in attrs(m, file))
    }).map((p) => p.tool)
    expect(given.sort()).toEqual(Object.keys(CHOOSING).sort())
  })

  for (const [tool, build] of Object.entries(CHOOSING)) {
    it(`${tool}: the panel's own choice goes to the list and to ${build}`, () => {
      const { path, component } = PANELS.find((p) => p.tool === tool)!
      const file = parse(path)
      const panel = fn(file, component)
      // The state, the panel's own, at the top of the component…
      const pairs = panel.body!.statements
        .filter(ts.isVariableStatement)
        .flatMap((s) => s.declarationList.declarations)
        .filter((d) => ts.isArrayBindingPattern(d.name) && d.name.getText(file) === '[chosen, setChosen]')
      expect(pairs, `${component}: const [chosen, setChosen]`).toHaveLength(1)
      expect(pairs[0].initializer?.getText(file)).toBe('useState<string | undefined>(undefined)')
      // …and no other `chosen` in the panel to shadow it (a `const chosen = undefined` would keep every text below).
      expect(declarations(panel).filter((d) => d.name === 'chosen')).toEqual([])
      // …handed to the line…
      const [line] = mounts(file, 'SourceLine', file)
      expect(attrs(line, file).choose).toBe('{{ chosen, onChoose: setChosen }}')
      // …and the build button passes it. Exactly one click calls the build, with `chosen`.
      const builds = mounts(file, 'button', file).filter((b) => (attrs(b, file).onClick ?? '').includes(`${build}(`))
      expect(builds, `${component}: the build button`).toHaveLength(1)
      expect(attrs(builds[0], file).onClick).toBe(`{() => void ${build}(chosen)}`)
      expect(declarations(panel).filter((d) => d.name === build).map((d) => d.init?.getText(file))).toEqual([`useEditor((s) => s.${build})`])
    })
  }

  it('draws the list only when it is given a choice, and types the choice to the two tools', () => {
    const file = parse(SOURCE_LINE)
    const text = source(SOURCE_LINE)
    const line = fn(file, 'SourceLine')
    // The list is one component, mounted once, under `choose && …`.
    const lists = mounts(file, 'ChooseFromMedia', file)
    expect(lists).toHaveLength(1)
    expect(functionOf(lists[0])).toBe(line)
    // `choose && <ChooseFromMedia …/>`, or `choose ? <ChooseFromMedia …/> : …` — the condition is the prop.
    const guard = lists[0].parent
    const condition = ts.isBinaryExpression(guard) && guard.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && guard.right === lists[0]
      ? guard.left.getText(file)
      : ts.isConditionalExpression(guard) && guard.whenTrue === lists[0]
        ? guard.condition.getText(file)
        : null
    expect(condition, 'the list is drawn under `choose`').toBe('choose')
    expect(attrs(lists[0], file).choice).toBe('{choose}')
    // Its heading is written there and nowhere else in the file.
    expect([...text.matchAll(/Choose from media<\/div>/g)]).toHaveLength(1)
    // The element whose OWN text it is (the block around it has no other words, so `words` would find both).
    const own = (d: Tagged): string =>
      ts.isJsxElement(d) ? d.children.filter(ts.isJsxText).map((t) => t.getText(file)).join(' ').replace(/\s+/g, ' ').trim() : ''
    const heading = mounts(file, 'div', file).filter((d) => own(d) === 'Choose from media')
    expect(heading).toHaveLength(1)
    expect(functionOf(heading[0])?.name?.text).toBe('ChooseFromMedia')
    // The props' type: `choose` only, and always, for the two choosing tools.
    expect([...text.matchAll(/^export type ChoosingTool = 'one-photo' \| 'grid-split'$/gm)]).toHaveLength(1)
    expect([...text.matchAll(/^type SourceLineProps = \{ tool: ChoosingTool; choose: PhotoChoice \} \| \{ tool: StatingTool; choose\?: never \}$/gm)]).toHaveLength(1)
    expect([...text.matchAll(/^export function SourceLine\(\{ tool, choose \}: SourceLineProps\): ReactNode \{$/gm)]).toHaveLength(1)
  })

  it('marks the photo the build will use, by the store’s rule, and toggles the choice', () => {
    const file = parse(SOURCE_LINE)
    const list = fn(file, 'ChooseFromMedia')
    const used = declarations(list).filter((d) => d.name === 'used')
    expect(used.map((d) => d.init?.getText(file))).toEqual([
      'useEditor((s) => photoFor(s.project, s.selectedClipId, choice.chosen)?.photo.id ?? null)'
    ])
    const choices = mounts(list, 'button', file)
    expect(choices).toHaveLength(1)
    expect(attrs(choices[0], file).onClick).toBe('{() => choice.onChoose(chosen ? undefined : asset.id)}')
    expect(attrs(choices[0], file)['aria-pressed']).toBe('{chosen}')
    // `chosen` is THIS row being the panel's choice — what the press toggles and
    // aria-pressed says. A constant, or another row's id, would leave the click
    // text above unchanged and a second press unable to clear the choice.
    expect(declarations(list).filter((d) => d.name === 'chosen').map((d) => d.init?.getText(file))).toEqual(['choice.chosen === asset.id'])
    // The row names its asset (the harness's `source-chosen` recipe clicks by it).
    expect(attrs(choices[0], file)['data-source-choice']).toBe('{asset.id}')
    // And the rows are the photos by the builds' own rule, not a list of their own.
    expect(declarations(list).filter((d) => d.name === 'photos').map((d) => d.init?.getText(file))).toEqual(['photosOf(project)'])
  })
})

/* ----------------------------------------------------------- the line's text */

describe('the line shows what the store’s rule says, for the panel’s own choice', () => {
  const file = parse(SOURCE_LINE)
  const line = fn(file, 'SourceLine')

  it('reads "Uses:" through usesOf, with the selection, the playhead and the panel’s choice', () => {
    // tests/renderer/sourceChoice.test.ts holds usesOf to each build; this is
    // the call that makes what it checks the line on screen. Passing anything
    // but `choose?.chosen` names the default photo while the build uses the chosen one.
    expect(declarations(line).filter((d) => d.name === 'uses').map((d) => d.init?.getText(file))).toEqual([
      'useEditor((s) => usesOf(tool, s.project, s.selectedClipId, s.playhead, choose?.chosen))'
    ])
    expect(declarations(line).filter((d) => d.name === 'music').map((d) => d.init?.getText(file))).toEqual([
      'useEditor((s) => (TIMED_TO_MUSIC.includes(tool) ? musicLineOf(s.project) : null))'
    ])
    // And both are drawn: `{uses}` and `{music}` each once, as a span's whole content.
    const shown = (name: string): number =>
      mounts(line, 'span', file).filter((s) => ts.isJsxElement(s) && s.children.some((k) => ts.isJsxExpression(k) && k.expression?.getText(file) === name)).length
    expect(shown('uses')).toBe(1)
    expect(shown('music')).toBe(1)
  })

  it('the panels count photos by the builds’ rule: a drawn still is not one', () => {
    // Membership: each panel that counts photos counts them with isPhoto
    // (shared/edit/photos.ts), the filter the store's builds apply — so a
    // "+ Text" does not make Beat sync say "4 photos" or enable a build that
    // then says "Import some photos first".
    for (const { path, component } of PANELS.filter((p) => ['beat-sync', 'one-photo', 'grid-split', 'film-strip'].includes(p.tool))) {
      const tsx = parse(path)
      const counts = declarations(fn(tsx, component)).filter((d) => d.name === 'images').map((d) => d.init?.getText(tsx))
      expect(counts, component).toEqual(['project.assets.filter(isPhoto).length'])
      expect([...source(path).matchAll(/^import \{ isPhoto \} from '@shared\/edit\/photos'$/gm)], path).toHaveLength(1)
    }
  })
})

/* ------------------------------------------------------------- upload a file */

describe('Upload a file uploads: the file dialog, then importAssets with what was picked', () => {
  const file = parse(SOURCE_LINE)
  const line = fn(file, 'SourceLine')

  it('has one Upload a file button, busy while it runs, and its click runs the upload', () => {
    const uploads = mounts(file, 'button', file).filter((b) => words(b, file) === 'Upload a file')
    expect(uploads).toHaveLength(1)
    expect(functionOf(uploads[0])).toBe(line)
    expect(attrs(uploads[0], file).onClick).toBe('{() => void upload()}')
    expect(attrs(uploads[0], file).disabled).toBe('{picking}')
  })

  it('picks, then imports exactly the picked paths, through the store’s importAssets', () => {
    const ups = declarations(line).filter((d) => d.name === 'upload')
    expect(ups).toHaveLength(1)
    const body = ups[0].init!
    expect(ts.isArrowFunction(body) && body.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)).toBe(true)

    const picked = declarations(body).filter((d) => d.init?.getText(file) === 'await window.forge.pickMedia()')
    expect(picked, 'the dialog').toHaveLength(1)
    const calls: ts.CallExpression[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) calls.push(node)
      ts.forEachChild(node, visit)
    }
    visit(body)
    const imports = calls.filter((c) => c.expression.getText(file) === 'importAssets')
    expect(imports, 'importAssets(…) in the upload').toHaveLength(1)
    expect(imports[0].arguments.map((a) => a.getText(file))).toEqual([picked[0].name])
    // Awaited, so the button stays busy until the import is done — and after the dialog.
    expect(ts.isAwaitExpression(imports[0].parent)).toBe(true)
    expect(imports[0].getStart(file)).toBeGreaterThan(picked[0].node.getStart(file))
    // Busy on before the dialog, off in a finally, whatever the import does.
    const busy = calls.filter((c) => c.expression.getText(file) === 'setPicking').map((c) => c.getText(file))
    expect(busy).toEqual(['setPicking(true)', 'setPicking(false)'])
    const off = calls.find((c) => c.getText(file) === 'setPicking(false)')!
    let inFinally = false
    for (let at: ts.Node | undefined = off; at && at !== body; at = at.parent) {
      if (ts.isBlock(at) && ts.isTryStatement(at.parent) && at.parent.finallyBlock === at) inFinally = true
    }
    expect(inFinally, 'setPicking(false) in a finally').toBe(true)

    // And `importAssets` is the store's, read in SourceLine itself.
    expect(declarations(line).filter((d) => d.name === 'importAssets').map((d) => d.init?.getText(file))).toEqual([
      'useEditor((s) => s.importAssets)'
    ])
    expect([...source('src/renderer/src/store.ts').matchAll(/^ {2}importAssets: async \(paths\) => \{$/gm)]).toHaveLength(1)
  })
})
