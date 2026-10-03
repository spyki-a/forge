import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { DOCK_FLOOR, TABS_FLOOR } from '../src/renderer/src/dock'

/**
 * The Trimmer dock, and the right column it replaces (docs/WINDOW.md §3.18,
 * §6 step 8).
 *
 * The full-height Inspector on the right goes: its clip editor moves into a
 * dock at the bottom of the left column, under the waveform that moved there
 * from under the tabs, and the dock is drawn ONLY while there is something to
 * trim (dock.ts `dockSubject`). Each half of that can be undone by a line left
 * behind — a second Inspector in App, the old always-on waveform still in the
 * left panel — or by a dock that never closes: before this step nothing ever
 * ended an audition, so a dock shown for one would stay for the session.
 *
 * Read with the TypeScript parser, in the style of tests/windowStrips.test.ts:
 * mounts are JSX elements (a comment or a string is not one), and the gate is
 * read from the tree, so a dock behind some other flag fails.
 */

const root = resolve(__dirname, '..')
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8')
const parse = (path: string, text = source(path)): ts.SourceFile =>
  ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

const APP = 'src/renderer/src/App.tsx'
const DOCK = 'src/renderer/src/components/TrimmerDock.tsx'
const LEFT = 'src/renderer/src/components/LeftPanel.tsx'
const LIBRARY = 'src/renderer/src/components/Library.tsx'
const INSPECTOR = 'src/renderer/src/components/Inspector.tsx'

type Tagged = ts.JsxElement | ts.JsxSelfClosingElement
const opening = (node: Tagged): ts.JsxOpeningLikeElement => (ts.isJsxElement(node) ? node.openingElement : node)
const isTagged = (node: ts.Node): node is Tagged => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)
const tag = (node: Tagged, file: ts.SourceFile): string => opening(node).tagName.getText(file)

/** Every JSX element named `name` in the file, self-closing or not. */
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

/** The nearest enclosing JSX element called `name`. */
function enclosing(node: ts.Node, name: string, file: ts.SourceFile): Tagged | null {
  for (let at = node.parent; at; at = at.parent) if (isTagged(at) && tag(at, file) === name) return at
  return null
}

/** The function declaration a node is written in. */
function functionOf(node: ts.Node): ts.FunctionDeclaration | null {
  for (let at = node.parent; at; at = at.parent) if (ts.isFunctionDeclaration(at)) return at
  return null
}

/** Every call in a subtree, by callee text, with its arguments' text. */
function callsIn(node: ts.Node, file: ts.SourceFile): { callee: string; args: string[] }[] {
  const out: { callee: string; args: string[] }[] = []
  const visit = (at: ts.Node): void => {
    if (ts.isCallExpression(at)) out.push({ callee: at.expression.getText(file), args: at.arguments.map((a) => a.getText(file)) })
    ts.forEachChild(at, visit)
  }
  visit(node)
  return out
}

/** `const name = <initializer>` in a function's own body, as text. */
function declared(fn: ts.FunctionDeclaration, name: string, file: ts.SourceFile): string[] {
  const out: string[] = []
  for (const statement of fn.body?.statements ?? []) {
    if (!ts.isVariableStatement(statement)) continue
    for (const d of statement.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === name) out.push(d.initializer?.getText(file) ?? '')
    }
  }
  return out
}

describe('the right column is gone; its editor is in the dock', () => {
  const text = source(APP)
  const app = parse(APP)

  it('App mounts no Inspector, and exactly one TrimmerDock', () => {
    expect(written(text, 'Inspector')).toBe(0)
    expect(mounts(app, 'Inspector')).toHaveLength(0)
    expect(written(text, 'TrimmerDock')).toBe(1)
    expect(mounts(app, 'TrimmerDock')).toHaveLength(1)
  })

  it('the window is two full-height columns: the left about 240 px, the right the picture over the timeline', () => {
    /*
     * The user's answers to WINDOW.md §7.1 and §7.2: one side panel, about
     * 240 px, running the full height, and the timeline under the picture
     * only. Read from App's own tree: its outermost Group, straight under the
     * header with nothing between them (the source row that ran across the
     * whole window heads the left column now), of exactly two Panels.
     */
    const inApp = (node: ts.Node): boolean => functionOf(node)?.name?.text === 'App'
    const outermost = mounts(app, 'Group').filter((g) => inApp(g) && enclosing(g, 'Group', app) === null)
    expect(outermost).toHaveLength(1)
    const [frame] = outermost
    expect(attr(frame, 'orientation', app)).toBe('"horizontal"')
    const [header] = mounts(app, 'Header')
    expect(header, '<Header />').toBeDefined()
    const siblings = (header.parent as ts.JsxElement).children.filter(
      (c) => isTagged(c) || (ts.isJsxExpression(c) && c.expression !== undefined)
    )
    expect(siblings[siblings.indexOf(header) + 1], 'the Group straight after the header').toBe(frame)

    const panelsOf = (group: Tagged): Tagged[] =>
      ts.isJsxElement(group) ? group.children.filter((c): c is Tagged => isTagged(c) && tag(c, app) === 'Panel') : []
    const within = (outer: ts.Node, inner: ts.Node): boolean => inner.getStart(app) >= outer.getStart(app) && inner.end <= outer.end
    const holds = (panel: Tagged, name: string): boolean => {
      const found = mounts(app, name)
      return found.length === 1 && within(panel, found[0])
    }
    const [left, right, ...more] = panelsOf(frame)
    expect(more).toHaveLength(0)

    // The left column: about 240 px, and the source row, the tabs and the
    // dock, and the strips, top to bottom.
    expect(attr(left, 'defaultSize', app)).toBe('"17%"')
    expect(attr(left, 'minSize', app)).toBe('{240}')
    expect(attr(left, 'maxSize', app)).toBe('"30%"')
    for (const name of ['SourceBar', 'LeftSplit', 'OutputStrip', 'ExportStrip']) expect(holds(left, name), name).toBe(true)
    const [source] = mounts(app, 'SourceBar')
    const [output] = mounts(app, 'OutputStrip')
    expect(within(output.parent, source), 'the source row is above the strips’ column, not in it').toBe(false)
    expect(source.getStart(app)).toBeLessThan(output.parent.getStart(app))

    // The right column: one vertical Group, the picture over the timeline row.
    expect(attr(right, 'defaultSize', app)).toBe('"83%"')
    const inner = ts.isJsxElement(right) ? right.children.filter(isTagged) : []
    expect(inner).toHaveLength(1)
    expect(tag(inner[0], app)).toBe('Group')
    expect(attr(inner[0], 'orientation', app)).toBe('"vertical"')
    const [centre, lower, ...rest] = panelsOf(inner[0])
    expect(rest).toHaveLength(0)
    for (const name of ['CanvasBar', 'Toolbox', 'Preview']) expect(holds(centre, name), name).toBe(true)
    for (const name of ['Transport', 'Timeline', 'CurveTray']) expect(holds(lower, name), name).toBe(true)
  })

  it('writes every Panel size given as a string with its unit', () => {
    /*
     * Numbers are pixels and strings without a unit are percent in
     * react-resizable-panels 4.12.4 — but the library ALSO writes `defaultSize`
     * straight into the panel's flex-basis for the first frame, where a bare
     * "17" is invalid CSS and is dropped. The panels then take their content's
     * width, the library measures the group as the sum of those (under 800 px
     * at a 1400 px window), converts the 240 px minSize against that short
     * sum into more than 30 %, clamps to maxSize, and keeps that percentage
     * when the real width arrives: the left column opened at 420 px, not 240
     * (measured in the harness; "17%" gives 240). So a string size always
     * says its unit, and a number or a name is pixels. The step's first test
     * pinned "17" itself and passed against the 420 px column.
     */
    const SIZES = ['defaultSize', 'minSize', 'maxSize', 'collapsedSize']
    const PIXELS: Record<string, unknown> = { TABS_FLOOR, DOCK_FLOOR }
    const panels = mounts(app, 'Panel')
    // The window's two columns, the picture and the timeline row, the timeline
    // and the tray, the tabs and the dock.
    expect(panels).toHaveLength(8)
    const strings: string[] = []
    for (const panel of panels) {
      for (const p of opening(panel).attributes.properties) {
        if (!ts.isJsxAttribute(p) || !SIZES.includes(p.name.getText(app))) continue
        const where = `${p.getText(app)} on the Panel at line ${app.getLineAndCharacterOfPosition(panel.getStart(app)).line + 1}`
        const value: ts.Node | undefined =
          p.initializer && ts.isJsxExpression(p.initializer) ? p.initializer.expression : p.initializer
        expect(value, where).toBeDefined()
        if (ts.isStringLiteral(value!) || ts.isNoSubstitutionTemplateLiteral(value!)) {
          strings.push(value.text)
          expect(value.text, where).toMatch(/^\d+(?:\.\d+)?(?:%|px|rem|em|vh|vw)$/)
        } else if (ts.isIdentifier(value!)) {
          expect(typeof PIXELS[value.text], `${where}: a name this test does not know is a number`).toBe('number')
        } else {
          expect(ts.isNumericLiteral(value!), `${where}: a string, a number or a known name`).toBe(true)
        }
      }
    }
    // Not vacuous: the percentages are all in the list.
    expect(strings.length).toBeGreaterThanOrEqual(12)
  })

  it('gives the picture the room, at the window’s default size, against the step-0 baseline', () => {
    /*
     * Step 0 measured the preview canvas at 1400×900 at 778×512, a 16:9 frame
     * 778×438 and a 9:16 frame 288×512 (WINDOW.md step 0). Step 8's check:
     * at least 1.35× that width, and a TALLER 9:16 frame — the user asked for
     * "bigger room to edit for both landscape and vertical". The geometry,
     * from the props above and the fixed chrome the harness measured: the
     * header 36 px (`h-9`), each divider 1 px, the canvas bar 32 px, the tool
     * strip 36 px (`w-9`). At 62 % — the share it had under a source row — a
     * 9:16 frame was 270×480, shorter than before the step.
     *
     * And the timeline keeps its height: step 5 measured the lower row at
     * 230 px at the 1100×680 minimum window, already short, so the picture's
     * height must not come from it.
     */
    const main = readFileSync(resolve(root, 'src/main/index.ts'), 'utf8')
    const size = /width: (\d+),\s*height: (\d+),\s*minWidth: (\d+),\s*minHeight: (\d+),/.exec(main)
    expect(size, 'the window’s sizes in main/index.ts').not.toBeNull()
    const [W, H, minW, minH] = size!.slice(1).map(Number)
    expect([W, H]).toEqual([1400, 900])

    const HEADER = 36
    const DIVIDER = 1
    const CANVAS_BAR = 32
    const TOOLBOX = 36
    const percent = (value: string | undefined): number => {
      const m = /^"(\d+(?:\.\d+)?)%"$/.exec(value ?? '')
      expect(m, `a percentage, ${value}`).not.toBeNull()
      return Number(m![1]) / 100
    }
    // Each Panel by what it holds, never by its props — those are what is read.
    const [left] = mounts(app, 'OutputStrip').map((strip) => enclosing(strip, 'Panel', app)!)
    const [centre] = mounts(app, 'CanvasBar').map((bar) => enclosing(bar, 'Panel', app)!)
    const [lower] = mounts(app, 'Timeline').map((t) => enclosing(enclosing(t, 'Group', app)!, 'Panel', app)!)
    expect(left && centre && lower).toBeTruthy()
    expect(attr(left, 'minSize', app)).toBe('{240}')
    // The header is the 36 px: `h-9`, once.
    expect([...source(APP).matchAll(/className="drag-region flex h-9 shrink-0 /g)]).toHaveLength(1)

    const leftWidth = (w: number): number => Math.min(Math.max(240, percent(attr(left, 'defaultSize', app)) * w), percent(attr(left, 'maxSize', app)) * w)
    const canvas = (w: number, h: number): [number, number] => [
      w - leftWidth(w) - DIVIDER - TOOLBOX,
      percent(attr(centre, 'defaultSize', app)) * (h - HEADER - DIVIDER) - CANVAS_BAR
    ]
    const [cw, ch] = canvas(W, H)
    expect(cw / 778, 'the canvas width against 778').toBeGreaterThanOrEqual(1.35)
    const tall = Math.min(ch, (cw * 16) / 9)
    expect(tall, 'the 9:16 frame’s height against 512').toBeGreaterThan(512)
    const wide = Math.min(cw, (ch * 16) / 9)
    expect(wide, 'the 16:9 frame’s width against 778').toBeGreaterThan(778)

    const timeline = percent(attr(lower, 'defaultSize', app)) * (minH - HEADER - DIVIDER)
    expect(timeline, 'the timeline row at the minimum window').toBeGreaterThanOrEqual(230)
    expect(minW).toBe(1100)
  })

  it('puts the dock in the left column’s vertical Group, under the tabs', () => {
    const [dock] = mounts(app, 'TrimmerDock')
    const [left] = mounts(app, 'LeftPanel')
    const dockPanel = enclosing(dock, 'Panel', app)
    const tabsPanel = enclosing(left, 'Panel', app)
    expect(dockPanel && tabsPanel).toBeTruthy()
    const group = enclosing(dockPanel!, 'Group', app)
    expect(group, 'the Group around the dock').not.toBeNull()
    expect(enclosing(tabsPanel!, 'Group', app)).toBe(group)
    expect(attr(group!, 'orientation', app)).toBe('"vertical"')
    // Tabs first, dock second; each panel with an id, so the layout the library
    // keeps per set of panels is never the other set's.
    expect(tabsPanel!.getStart(app)).toBeLessThan(dockPanel!.getStart(app))
    expect(attr(tabsPanel!, 'id', app)).toMatch(/^"[\w-]+"$/)
    expect(attr(dockPanel!, 'id', app)).toMatch(/^"[\w-]+"$/)
    expect(attr(tabsPanel!, 'id', app)).not.toBe(attr(dockPanel!, 'id', app))
    // And that Group is the top of the column the strips are in: whichever
    // component renders it, it is the first thing over OUTPUT and EXPORT.
    const [output] = mounts(app, 'OutputStrip')
    const kids = (output.parent as ts.JsxElement).children.filter(isTagged)
    const holder = group!.parent
    const first = kids[0]
    const rendersHolder =
      first === holder ||
      (ts.isJsxSelfClosingElement(first) && functionOf(group!)?.name?.text === tag(first, app))
    expect(rendersHolder, 'the dock’s Group is the top of the strips’ column').toBe(true)
  })

  it('draws the dock only while dockSubject says there is something to trim — no other gate', () => {
    /*
     * Everything between the dock and the Group it sits in that is not plain
     * JSX nesting, read from the tree: exactly one `{x && (…)}`, and `x` is
     * the dock subject. Not an open flag, not a ternary, not a second
     * condition — an "is the dock open" switch would let it show with nothing
     * to trim, or hide with something.
     */
    const [dock] = mounts(app, 'TrimmerDock')
    const group = enclosing(dock, 'Group', app)!
    const conditions: ts.Node[] = []
    for (let at = dock.parent; at && at !== group; at = at.parent) {
      if (ts.isConditionalExpression(at) || ts.isBinaryExpression(at) || ts.isCallExpression(at)) conditions.push(at)
    }
    expect(conditions.map((c) => c.getText(app).slice(0, 40))).toHaveLength(1)
    const [gate] = conditions as ts.BinaryExpression[]
    expect(ts.isBinaryExpression(gate) && gate.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken).toBe(true)
    expect(ts.isIdentifier(gate.left), 'the gate is one name').toBe(true)
    const name = (gate.left as ts.Identifier).text
    const fn = functionOf(gate)
    expect(fn, 'the function the gate is in').not.toBeNull()
    expect(declared(fn!, name, app)).toEqual(['useEditor((s) => dockSubject(s.project, s.selectedClipId, s.audition))'])
  })

  it('the dock decides for itself too, by the same rule', () => {
    const dock = parse(DOCK)
    const fn = dock.statements.find(
      (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'TrimmerDock'
    )
    expect(fn).toBeDefined()
    expect(declared(fn!, 'subject', dock)).toEqual(['useEditor((s) => dockSubject(s.project, s.selectedClipId, s.audition))'])
    expect(source(DOCK)).toMatch(/\n {2}if \(!subject\) return null\n/)
  })
})

describe('the dock holds the waveform and the clip editor, once each, in one scroller', () => {
  const text = source(DOCK)
  const dock = parse(DOCK)

  it('mounts Waveform and Inspector exactly once each, waveform first', () => {
    for (const name of ['Waveform', 'Inspector']) {
      expect(written(text, name), name).toBe(1)
      expect(mounts(dock, name), name).toHaveLength(1)
    }
    expect(mounts(dock, 'Waveform')[0].getStart(dock)).toBeLessThan(mounts(dock, 'Inspector')[0].getStart(dock))
  })

  it('scrolls them as one: the same scroller holds both, and the editor has none of its own', () => {
    const scroller = (node: ts.Node): Tagged | null => {
      for (let at = node.parent; at; at = at.parent) {
        if (isTagged(at) && /\boverflow-y-auto\b/.test(attr(at, 'className', dock) ?? '')) return at
      }
      return null
    }
    const [wave] = mounts(dock, 'Waveform')
    const [editor] = mounts(dock, 'Inspector')
    expect(scroller(wave)).not.toBeNull()
    expect(scroller(wave)).toBe(scroller(editor))
    // The Inspector's own root no longer scrolls or fills a height: it is a
    // block in the dock's scroller.
    const inspector = parse(INSPECTOR)
    const fn = inspector.statements.find(
      (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'Inspector'
    )!
    const returned = fn.body!.statements.filter(ts.isReturnStatement)
    const roots = returned.map((r) => r.expression).filter((e): e is ts.Expression => !!e && e.kind !== ts.SyntaxKind.NullKeyword)
    expect(roots).toHaveLength(1)
    let rootEl: ts.Node = roots[0]
    while (ts.isParenthesizedExpression(rootEl)) rootEl = rootEl.expression
    expect(isTagged(rootEl)).toBe(true)
    expect(attr(rootEl as Tagged, 'className', inspector) ?? '').not.toMatch(/\b(?:overflow-\S+|h-full|flex-1)\b/)
  })

  it('is found by data-dock on its root, which is what the census looks for', () => {
    // The attribute, from the tree (the doc comment names it too): once, on
    // the element the component returns.
    const carriers: ts.JsxAttribute[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isJsxAttribute(node) && node.name.getText(dock) === 'data-dock') carriers.push(node)
      ts.forEachChild(node, visit)
    }
    visit(dock)
    expect(carriers).toHaveLength(1)
    // attribute → attributes → opening tag → the element (a self-closing tag is the element itself)
    const tagNode = carriers[0].parent.parent
    const element = ts.isJsxOpeningElement(tagNode) ? tagNode.parent : tagNode
    let up: ts.Node = element.parent
    while (ts.isParenthesizedExpression(up)) up = up.parent
    expect(ts.isReturnStatement(up), 'data-dock is on what TrimmerDock returns').toBe(true)
    expect(functionOf(up)?.name?.text).toBe('TrimmerDock')
  })

  it('its X lets go of the selection AND the audition', () => {
    // Only the selection would leave a sound being auditioned, and the dock
    // would come straight back for it.
    const buttons = mounts(dock, 'button').filter((b) => attr(b, 'title', dock) === '{CLOSE_TITLE}')
    expect(buttons).toHaveLength(1)
    expect(text).toContain("const CLOSE_TITLE = 'Close the trimmer'")
    const click = opening(buttons[0]).attributes.properties.find(
      (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(dock) === 'onClick'
    )
    expect(click?.initializer).toBeDefined()
    const calls = callsIn(click!.initializer!, dock).map((c) => `${c.callee}(${c.args.join(', ')})`)
    expect(calls).toContain('select(null)')
    expect(calls).toContain('setAudition(null)')
    // And those are the store's actions.
    const fn = functionOf(buttons[0])!
    expect(declared(fn, 'select', dock)).toEqual(['useEditor((s) => s.select)'])
    expect(declared(fn, 'setAudition', dock)).toEqual(['useEditor((s) => s.setAudition)'])
  })
})

describe('the left panel is the tabs and their content only', () => {
  it('has no Waveform any more', () => {
    const text = source(LEFT)
    expect(written(text, 'Waveform')).toBe(0)
    expect(mounts(parse(LEFT), 'Waveform')).toHaveLength(0)
    expect(text).not.toMatch(/from '\.\/Waveform'/)
  })
})

describe('leaving the Library ends the audition', () => {
  /*
   * Nothing else ever set `audition` back to null, so a dock shown for a
   * Library sound would have stayed for the session. The effect has to be a
   * statement of Library's own body (not a child's, not under an `if`), and
   * the clearing has to be in its CLEANUP — an effect that cleared on mount
   * would end the audition the moment the Library opened, and never on leaving.
   */
  it('clears it when the Library unmounts', () => {
    const file = parse(LIBRARY)
    const fn = file.statements.find(
      (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'Library'
    )
    expect(fn?.body).toBeDefined()
    const effects = fn!.body!.statements
      .filter(ts.isExpressionStatement)
      .map((s) => s.expression)
      .filter((e): e is ts.CallExpression => ts.isCallExpression(e) && e.expression.getText(file) === 'useEffect')

    /** What an effect callback hands back as its cleanup, if anything. */
    const cleanup = (callback: ts.Expression | undefined): ts.Node | null => {
      if (!callback || !ts.isArrowFunction(callback)) return null
      if (!ts.isBlock(callback.body)) return ts.isArrowFunction(callback.body) || ts.isFunctionExpression(callback.body) ? callback.body : null
      const ret = callback.body.statements.find(ts.isReturnStatement)?.expression
      return ret && (ts.isArrowFunction(ret) || ts.isFunctionExpression(ret)) ? ret : null
    }
    const clearing = effects.filter((effect) => {
      const back = cleanup(effect.arguments[0])
      return back !== null && callsIn(back, file).some((c) => /(^|\.)setAudition$/.test(c.callee) && c.args.join() === 'null')
    })
    expect(clearing, 'an effect whose cleanup calls setAudition(null)').toHaveLength(1)
    // Once, on unmount: no deps that change while the Library is open.
    const deps = clearing[0].arguments[1]
    expect(deps && ts.isArrayLiteralExpression(deps)).toBe(true)
    expect((deps as ts.ArrayLiteralExpression).elements.map((e) => e.getText(file)).every((d) => d === 'setAudition')).toBe(true)
  })
})
