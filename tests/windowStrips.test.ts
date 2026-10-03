import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { emptyProject } from '@shared/timeline'
import { outputSummary } from '@shared/project/outputSummary'
import { exportHeadline } from '@shared/render/exportHeadline'
import type { Job } from '@shared/types'
import { DOCK_FLOOR, TABS_FLOOR, holderFloor } from '../src/renderer/src/dock'

/**
 * OUTPUT and EXPORT, the two strips under the left panel (docs/WINDOW.md §3.16,
 * §3.17, §6 step 7).
 *
 * The rule that matters: EXPORT holds the export flow and the File › Export
 * listener, which used to live in the always-mounted Inspector. The menu item
 * only bumps a counter in the store (`requestExport`); if nothing is mounted to
 * react to it, File › Export silently does nothing. So the strip must be
 * rendered whatever its state, and closing it may hide its body but never take
 * the component out of the tree.
 *
 * This half reads the source with the TypeScript parser. The other half renders
 * the strips, closed and open (tests/renderer/stripsRender.test.ts).
 */

const root = resolve(__dirname, '..')
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8')
const parse = (path: string): ts.SourceFile =>
  ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

type Tagged = ts.JsxElement | ts.JsxSelfClosingElement
const opening = (node: Tagged): ts.JsxOpeningLikeElement => (ts.isJsxElement(node) ? node.openingElement : node)

/** Every JSX element named `name` in the file, self-closing or not. */
function mounts(file: ts.SourceFile, name: string): Tagged[] {
  const out: Tagged[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && opening(node).tagName.getText(file) === name) {
      out.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

/**
 * Plain JSX nesting: an element's children, or a prop's value written as JSX
 * (`aside={<>…</>}`), which is passed whatever the state is.
 */
const nests = (at: ts.Node): boolean =>
  ts.isJsxElement(at) ||
  ts.isJsxFragment(at) ||
  ts.isParenthesizedExpression(at) ||
  ts.isJsxOpeningElement(at) ||
  ts.isJsxSelfClosingElement(at) ||
  ts.isJsxAttributes(at) ||
  ts.isJsxAttribute(at) ||
  (ts.isJsxExpression(at) && ts.isJsxAttribute(at.parent))

/**
 * What stands between a JSX element and the `return` of the function it is in,
 * when anything does other than plain JSX nesting: `{open && …}`, `{a ? … : …}`,
 * a `.map(…)`, any `{…}` among the children. Empty means the element is
 * rendered whenever its function renders. Also says which function that is.
 */
function gates(node: ts.Node, file: ts.SourceFile): { gates: string[]; fn: string | null } {
  const found: string[] = []
  for (let at = node.parent; at; at = at.parent) {
    if (nests(at)) continue
    if (ts.isReturnStatement(at)) {
      let fn: ts.Node | undefined = at.parent
      while (fn && !ts.isFunctionLike(fn)) fn = fn.parent
      const name = fn && ts.isFunctionDeclaration(fn) && fn.name ? fn.name.getText(file) : null
      return { gates: found, fn: name }
    }
    found.push(`${ts.SyntaxKind[at.kind]}: ${at.getText(file).slice(0, 60)}`)
  }
  return { gates: found, fn: null }
}

describe('App renders both strips, always', () => {
  const path = 'src/renderer/src/App.tsx'
  const text = source(path)
  const app = parse(path)

  it('mounts each strip exactly once', () => {
    // Counted on the text as well as the tree: a mount in a comment would not
    // be a mount, and a second one anywhere would be a second listener.
    expect([...text.matchAll(/<OutputStrip\b/g)]).toHaveLength(1)
    expect([...text.matchAll(/<ExportStrip\b/g)]).toHaveLength(1)
    expect(mounts(app, 'OutputStrip')).toHaveLength(1)
    expect(mounts(app, 'ExportStrip')).toHaveLength(1)
  })

  it('renders them unconditionally, straight from App’s own return', () => {
    for (const name of ['OutputStrip', 'ExportStrip']) {
      const [mount] = mounts(app, name)
      expect(mount, name).toBeDefined()
      const { gates: between, fn } = gates(mount, app)
      expect(between, `${name} is behind a condition`).toEqual([])
      expect(fn, name).toBe('App')
    }
  })

  it('stacks them under the left panel, OUTPUT over EXPORT, in one column', () => {
    const [left] = mounts(app, 'LeftPanel')
    const [output] = mounts(app, 'OutputStrip')
    const [exporting] = mounts(app, 'ExportStrip')
    expect(left && output && exporting).toBeTruthy()
    // The two strips are siblings, and the left panel's holder is the one before them.
    expect(output.parent).toBe(exporting.parent)
    const column = output.parent as ts.JsxElement
    const kids = column.children.filter((c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c))
    expect(kids).toHaveLength(3)
    expect(kids[1]).toBe(output)
    expect(kids[2]).toBe(exporting)
    // Since step 8 the holder is LeftSplit's root (the tabs and the Trimmer
    // dock share it), a component of App.tsx so that the dock coming and going
    // does not re-render the window: the first child is that component, and
    // what it returns is the holder the left panel is in.
    const holder = leftHolder(app)
    const first = kids[0]
    if (first !== holder) {
      expect(ts.isJsxSelfClosingElement(first), 'a component in the holder’s place').toBe(true)
      const { gates: between, fn } = gates(holder, app)
      expect(between, 'the holder is what the component returns, unconditionally').toEqual([])
      expect(fn).toBe(opening(first).tagName.getText(app))
    }
  })
})

/**
 * The element the left panel's Group sits in: the holder the tabs and the
 * Trimmer dock share, over the strips (step 8; before it, the LeftPanel's own
 * holder).
 */
function leftHolder(app: ts.SourceFile): ts.JsxElement {
  const [left] = mounts(app, 'LeftPanel')
  expect(left).toBeDefined()
  let group: ts.Node | undefined = left.parent
  while (group && !(ts.isJsxElement(group) && opening(group).tagName.getText(app) === 'Group')) group = group.parent
  expect(group, 'the Group the left panel is in').toBeDefined()
  let holder: ts.Node = group!.parent
  while (!ts.isJsxElement(holder)) holder = holder.parent
  return holder
}

describe('an open strip never squeezes the tabs or the Trimmer dock below their floors', () => {
  /*
   * The first build gave the left panel's holder a floor of 40 % and nothing
   * clipped, so opening a strip squeezed the tabs until their content drew
   * over the 112 px waveform dock — 6.7 px of tab content at 1100×680, at
   * every window size (step 7's verifier). Step 7 held it with a floor on the
   * holder (16.5rem: tab row, 120 px of tab content, the waveform) and a
   * clipped tab-content box.
   *
   * Step 8 moved the waveform into the Trimmer dock, and the holder became a
   * vertical Group of the tabs and, only while there is something to trim,
   * the dock (App.tsx LeftSplit). The same guarantees, re-pinned on that
   * shape: each panel's floor is its minimum size — the tabs' tab row and
   * 120 px of content, the dock's header, the waveform and 120 px of editor —
   * and the holder's min-height keeps the column's room for the panels it is
   * showing before an open strip gets any, as long as both strip headers fit.
   * The floors live in dock.ts so the panels and the holder cannot disagree.
   *
   * The holder's floor is CSS arithmetic (min, max, %, px, rem), evaluated
   * here against column heights the harness measured — in step 7, 375 px at
   * the 1100×680 minimum window and 512 px at 1400×900; since step 8 made the
   * left column full height, with the source row at its head, 578 px and
   * 798 px — so any way of writing a floor that keeps the room passes, and one
   * that loses it does not. If the floor moves off the holder's min-height
   * into another mechanism, move this test with it.
   */
  const TABS = 31.5 // the tab row, measured
  const WAVEFORM = 112 // the waveform's `h-28` box, in the dock now
  const DOCK_HEADER = 28 // the dock's header row (TrimmerDock.tsx `h-7`)
  const HEADERS = 56 // two closed strips, 28 px each (ui/Strip.tsx `h-7`)
  const DIVIDER = 1 // the `h-px` separator between the tabs and the dock

  /** `min(max(60%,16.5rem),100%_-_3.5rem)` as a function of the column's height. */
  function cssLength(expr: string): (column: number) => number {
    const js = expr
      .replace(/_/g, ' ')
      .replace(/\bcalc\(/g, '(')
      .replace(/\bmin\(/g, 'Math.min(')
      .replace(/\bmax\(/g, 'Math.max(')
      .replace(/(\d+(?:\.\d+)?)%/g, '($1 / 100 * H)')
      .replace(/(\d+(?:\.\d+)?)rem\b/g, '($1 * 16)')
      .replace(/(\d+(?:\.\d+)?)px\b/g, '($1)')
    // Nothing but arithmetic is evaluated.
    expect(js).toMatch(/^(?:Math\.(?:min|max)|[\s\d.()+\-*/,H])*$/)
    return new Function('H', `return ${js}`) as (column: number) => number
  }

  const app = parse('src/renderer/src/App.tsx')
  const attribute = (node: ts.JsxElement | ts.JsxSelfClosingElement, name: string): string | undefined =>
    opening(node)
      .attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(app) === name)
      ?.initializer?.getText(app)
  /** The Panel a component is mounted in, in App.tsx. */
  const panelAround = (name: string): ts.JsxElement => {
    const [mount] = mounts(app, name)
    expect(mount, name).toBeDefined()
    let at: ts.Node = mount.parent
    while (!(ts.isJsxElement(at) && opening(at).tagName.getText(app) === 'Panel')) at = at.parent
    return at
  }
  /** The holder's min-height, as a function of the column's height, with and without the dock. */
  const holderFloorAt = (dock: boolean): ((column: number) => number) => cssLength(holderFloor(dock))

  it('gives the tabs and the dock their floors as minimum sizes, in pixels', () => {
    // Numbers are pixels in react-resizable-panels 4.x; a string would be percent.
    expect(attribute(panelAround('LeftPanel'), 'minSize')).toBe('{TABS_FLOOR}')
    expect(attribute(panelAround('TrimmerDock'), 'minSize')).toBe('{DOCK_FLOOR}')
    // ~120 px of tab content under the tab row; ~120 px of editor under the dock's header and the waveform.
    expect(TABS_FLOOR - TABS, 'tab content at the tabs’ floor').toBeGreaterThanOrEqual(120)
    expect(DOCK_FLOOR - DOCK_HEADER - WAVEFORM, 'editor at the dock’s floor').toBeGreaterThanOrEqual(120)
  })

  it('gives the holder a min-height that follows the dock: the subject that draws it, never a constant', () => {
    const holder = leftHolder(app)
    const style = attribute(holder, 'style') ?? ''
    const floor = /^\{\{\s*minHeight: holderFloor\((\w+) !== null\)\s*\}\}$/.exec(style)
    expect(floor, `the holder's style, ${style}`).not.toBeNull()
    // The same name the dock's panel is gated by (tests/trimmerDock.test.ts reads that gate).
    let fn: ts.Node | undefined = holder.parent
    while (fn && !ts.isFunctionDeclaration(fn)) fn = fn.parent
    expect(fn?.getText(app)).toContain(`const ${floor![1]} = useEditor((s) => dockSubject(s.project, s.selectedClipId, s.audition))`)
    expect(fn?.getText(app)).toMatch(new RegExp(`\\{${floor![1]} && \\(`))
    // And no class floor beside it that a later edit could take for the real one.
    expect(attribute(holder, 'className') ?? '').not.toMatch(/\bmin-h-/)
  })

  it('keeps the tabs ~120 px of content with no dock, at every measured column', () => {
    const floor = holderFloorAt(false)
    // Step 7's 1100×680 and 1400×900 columns, step 8's, and a tall one.
    for (const column of [320, 375.4, 511.8, 578, 798, 1000]) {
      expect(floor(column) - TABS, `tab content in a ${column} px column`).toBeGreaterThanOrEqual(120)
    }
  })

  it('keeps the tabs AND the dock their floors with the dock open, wherever the column has the room', () => {
    const floor = holderFloorAt(true)
    const both = TABS_FLOOR + DIVIDER + DOCK_FLOOR
    // In step 8's full-height column there is room for both, and both strip
    // headers, from the 1100×680 minimum window up (578 px there, 798 px at
    // 1400×900); in step 7's, only from 1400×900 (511.8).
    for (const column of [511.8, 578, 798, 1000]) {
      expect(floor(column), `the holder in a ${column} px column`).toBeGreaterThanOrEqual(both)
    }
    // Shorter, the strip headers win and the holder takes all the rest — it
    // never stops short of what it could have had.
    for (const column of [150, 320, 375.4, 449.8]) {
      expect(floor(column), `the holder in a ${column} px column`).toBeGreaterThanOrEqual(Math.min(both, column - HEADERS) - 0.01)
    }
  })

  it('leaves both strip headers room under it, however short the column, dock or not', () => {
    for (const dock of [false, true]) {
      const floor = holderFloorAt(dock)
      for (const column of [150, 200, 300, 320, 375.4, 511.8, 578, 798]) {
        expect(column - floor(column), `room under the holder in a ${column} px column, dock ${dock}`).toBeGreaterThanOrEqual(HEADERS)
      }
    }
  })

  it('clips: the holder, and the panel’s tab-content box', () => {
    expect((attribute(leftHolder(app), 'className') ?? '').replace(/^"|"$/g, '').split(/\s+/)).toContain('overflow-hidden')
    // The box under the tab row, the one the tabs are drawn in: what is under
    // it now is the Trimmer dock, or the strips.
    const panel = parse('src/renderer/src/components/LeftPanel.tsx')
    const boxes: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node) && node.children.some((c) => ts.isJsxExpression(c) && /^\{tab === 'media' &&/.test(c.getText(panel)))) {
        const cls = opening(node).attributes.properties.find(
          (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(panel) === 'className'
        )
        boxes.push(cls?.initializer?.getText(panel) ?? '')
      }
      ts.forEachChild(node, visit)
    }
    visit(panel)
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toMatch(/\boverflow-(?:hidden|clip|auto|y-auto|y-hidden|y-clip)\b/)
  })
})

describe('EXPORT owns the export flow and the File › Export listener', () => {
  const strip = source('src/renderer/src/components/ExportStrip.tsx')
  const inspector = source('src/renderer/src/components/Inspector.tsx')
  const LISTENER = [
    '  useEffect(() => {',
    '    if (exportRequests === seenExportRequest.current) return',
    '    seenExportRequest.current = exportRequests',
    '    void onExport()',
    '  }, [exportRequests, onExport])'
  ].join('\n')
  const count = (text: string, needle: string): number =>
    [...text.matchAll(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].length

  it('has the listener, once, reading the store’s counter', () => {
    expect(count(strip, LISTENER)).toBe(1)
    expect(count(strip, 'const exportRequests = useEditor((s) => s.exportRequests)')).toBe(1)
    expect(count(strip, 'const seenExportRequest = useRef(exportRequests)')).toBe(1)
    expect(count(strip, 'const onExport = useCallback(')).toBe(1)
  })

  it('listens in ExportStrip itself, unconditionally, whether the strip is open or not', () => {
    /*
     * Read from the tree, because the text cannot say WHERE the effect is: the
     * same five lines moved into a child that renders only while the strip is
     * open (`{open && <Listener />}`) read exactly the same, and the menu item
     * would do nothing with the strip shut. So: every effect in the file that
     * depends on `exportRequests` — there must be one — is a statement of
     * ExportStrip's own body (not a child component's, not under an `if`, not
     * after an early return), and nothing in it asks whether anything is open:
     * an `if (!open) return` inside it is the same dead menu item.
     */
    const file = parse('src/renderer/src/components/ExportStrip.tsx')
    const owner = file.statements.find(
      (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'ExportStrip'
    )
    expect(owner?.body, 'function ExportStrip').toBeDefined()
    const body = owner!.body!

    const names = (node: ts.Node): string[] => {
      const out: string[] = []
      const visit = (at: ts.Node): void => {
        if (ts.isIdentifier(at)) out.push(at.text)
        ts.forEachChild(at, visit)
      }
      visit(node)
      return out
    }
    const effects: ts.CallExpression[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect') {
        effects.push(node)
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
    const listeners = effects.filter((call) => call.arguments.some((arg) => names(arg).includes('exportRequests')))
    expect(listeners, 'the File › Export listener').toHaveLength(1)

    const [listener] = listeners
    const [callback, deps] = listener.arguments
    // A statement of ExportStrip's own body, with no return before it.
    const statement = listener.parent
    expect(ts.isExpressionStatement(statement) && statement.parent === body, 'in ExportStrip’s own body').toBe(true)
    const before = body.statements.slice(0, body.statements.indexOf(statement as ts.Statement))
    expect(before.filter(ts.isReturnStatement), 'a return before the listener').toEqual([])
    // It reacts to the counter, and exports.
    expect(deps && ts.isArrayLiteralExpression(deps) ? deps.elements.map((e) => e.getText(file)) : []).toContain(
      'exportRequests'
    )
    expect(callback.getText(file)).toMatch(/\bonExport\(\)/)
    // And never asks whether the strip — or anything — is open: no `open`,
    // `exportOpen`, `getState().exportOpen` among its names, deps included.
    expect(names(listener).filter((name) => /open/i.test(name))).toEqual([])
  })

  it('left nothing of it behind in the Inspector', () => {
    expect(count(inspector, 'const onExport')).toBe(0)
    expect(count(inspector, 'exportRequests')).toBe(0)
    expect(count(inspector, '<ExportSettings')).toBe(0)
  })

  it('hands its body to the strip frame, which hides it by class', () => {
    // The body is the Strip's children, written straight inside it; the frame
    // renders them always and switches a class (ui/Strip.tsx). The rendered
    // proof is tests/renderer/stripsRender.test.ts; this is the shape.
    // Whatever the open face's classes are, the closed face is `hidden` and the
    // children are written there unconditionally.
    const frame = source('src/renderer/src/components/ui/Strip.tsx')
    expect([...frame.matchAll(/data-strip-body/g)]).toHaveLength(1)
    expect(frame).toMatch(/data-strip-body className=\{open \? '[^']*' : 'hidden'\}>\s*\{children\}\s*<\/div>/)
    // And the header's `aside` — the Export button — is drawn open or closed.
    expect(frame).toMatch(/<\/button>\s*\{aside\}\s*<\/div>/)
    const file = parse('src/renderer/src/components/ExportStrip.tsx')
    const [frameMount] = mounts(file, 'Strip')
    expect(frameMount).toBeDefined()
    for (const name of ['ExportSettings', 'BigButton']) {
      const [mount] = mounts(file, name)
      expect(mount, name).toBeDefined()
      expect(gates(mount, file).gates, `${name} is behind a condition`).toEqual([])
    }
  })

  it('keeps the header’s Export button to a header’s height', () => {
    // WINDOW.md §2 budgets the two closed strips at ~56 px. At its natural
    // size the big button (py-2) made EXPORT's header 47 px; the header row is
    // 28 px, so the button in it is a smaller size than the default.
    const file = parse('src/renderer/src/components/ExportStrip.tsx')
    const buttons = mounts(file, 'BigButton')
    expect(buttons).toHaveLength(1)
    const size = opening(buttons[0]).attributes.properties.find(
      (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(file) === 'size'
    )
    expect(size?.initializer?.getText(file), 'the size the header’s button asks for').toBeDefined()
    expect(size!.initializer!.getText(file)).not.toMatch(/^["'{]*md\b/)
  })

  it('exports whether the strip is open or not — the flow itself never asks', () => {
    /*
     * The listener test above keeps `open` out of the EFFECT; this keeps it out
     * of the flow the effect calls. An `if (!open) return` at the top of
     * onExport would pass the listener test and still kill File › Export and
     * the header's own Export button with the strip shut — the same dead menu
     * item by another door. Identifiers only: the comments may say "open".
     */
    const file = parse('src/renderer/src/components/ExportStrip.tsx')
    const owner = file.statements.find(
      (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'ExportStrip'
    )
    const flows = owner!.body!.statements.flatMap((s) =>
      ts.isVariableStatement(s)
        ? s.declarationList.declarations.filter((d) => ts.isIdentifier(d.name) && d.name.text === 'onExport')
        : []
    )
    expect(flows, 'const onExport').toHaveLength(1)
    const found: string[] = []
    const visit = (at: ts.Node): void => {
      if (ts.isIdentifier(at) && /open/i.test(at.text)) found.push(at.text)
      ts.forEachChild(at, visit)
    }
    visit(flows[0].initializer!)
    expect(found).toEqual([])
  })

  it('header clicks: Done shows the file, Failed opens the strip', () => {
    // The rendered test reads only the titles; these two clicks were checked
    // in the harness, and this pins what each one does so a swap cannot pass.
    const file = parse('src/renderer/src/components/ExportStrip.tsx')
    const byTitle = (starts: string): string | undefined => {
      let click: string | undefined
      const visit = (at: ts.Node): void => {
        if (ts.isJsxOpeningLikeElement(at) && at.tagName.getText(file) === 'button') {
          const attrs = at.attributes.properties.filter(ts.isJsxAttribute)
          const title = attrs.find((a) => a.name.getText(file) === 'title')?.initializer?.getText(file) ?? ''
          if (title.includes(starts)) click = attrs.find((a) => a.name.getText(file) === 'onClick')?.initializer?.getText(file)
        }
        ts.forEachChild(at, visit)
      }
      visit(file)
      return click
    }
    expect(byTitle('Done: ')).toMatch(/window\.forge\.revealPath\(headline\.job\.output\)/)
    expect(byTitle('Failed: ')).toMatch(/setExportOpen\(true\)/)
    expect(byTitle('Failed: ')).not.toMatch(/revealPath/)
  })

  it('keeps the header row and the small button at the 28 px the budget assumes', () => {
    // §2 budgets ~28 px per closed strip; the floor test above hard-codes 56
    // for the two, so the pieces that make 28 are pinned here: the frame's
    // header row is `h-7` (once), and the `sm` button size keeps a half-unit
    // of vertical padding — py-2 overflowed a 28 px row at 47 px.
    const frame = source('src/renderer/src/components/ui/Strip.tsx')
    expect([...frame.matchAll(/className="flex h-7 shrink-0 items-center/g)]).toHaveLength(1)
    const tile = source('src/renderer/src/components/ui/Tile.tsx')
    const sm = tile.match(/sm: \{ box: '([^']*)'/)
    expect(sm, 'the sm size').not.toBeNull()
    expect(sm![1]).toMatch(/\bpy-0\.5\b/)
    expect(sm![1]).not.toMatch(/\bpy-[1-9]/)
  })
})

describe('the OUTPUT strip’s one line', () => {
  it('says the rate, the loudness and the captions of a new project', () => {
    expect(outputSummary(emptyProject())).toBe('30 fps · -14 LUFS · captions on')
  })

  it('follows each of them', () => {
    const p = emptyProject()
    p.settings = { ...p.settings, fps: 25, loudness: undefined }
    p.captions = { ...p.captions, enabled: false }
    expect(outputSummary(p)).toBe('25 fps · loudness off · captions off')
    p.settings = { ...p.settings, loudness: -23 }
    expect(outputSummary(p)).toBe('25 fps · -23 LUFS · captions off')
  })

  it('reads an older file’s null loudness as off, as the Loudness row does', () => {
    const p = emptyProject()
    p.settings = { ...p.settings, loudness: null as unknown as undefined }
    expect(outputSummary(p)).toBe('30 fps · loudness off · captions on')
  })

  it('is what the strip shows while closed', () => {
    const strip = source('src/renderer/src/components/OutputStrip.tsx')
    expect([...strip.matchAll(/summary=\{outputSummary\(project\)\}/g)]).toHaveLength(1)
  })
})

describe('what EXPORT’s header says about the jobs', () => {
  /*
   * Both strips start closed, and the Exports list is in the hidden body, so
   * the header carries one line of it (shared/render/exportHeadline.ts): the
   * job under way, else how the last export ended. Rendered in
   * tests/renderer/stripsRender.test.ts.
   */
  let clock = 0
  function job(status: Job['status'], over: Partial<Job> = {}): Job {
    clock += 1000
    const ended = status === 'done' || status === 'failed' || status === 'cancelled'
    return {
      id: `job-${clock}`,
      presetId: 'render',
      input: '',
      inputName: `${status} ${clock}`,
      output: status === 'done' ? `/out/${clock}.mp4` : '',
      params: {},
      status,
      progress: status === 'done' ? 1 : 0.5,
      speed: null,
      error: status === 'failed' ? 'ffmpeg exited with code 1' : null,
      startedAt: clock - 500,
      finishedAt: ended ? clock : null,
      ...over
    }
  }

  it('says nothing with no jobs', () => {
    expect(exportHeadline([])).toBeNull()
  })

  it('shows the job under way first — running, else the first waiting — downloads too', () => {
    const done = job('done')
    const running = job('running', { presetId: 'ingest' })
    const waiting = job('queued')
    expect(exportHeadline([done, waiting, running])).toEqual({ kind: 'running', job: running })
    expect(exportHeadline([done, waiting])).toEqual({ kind: 'waiting', job: waiting })
  })

  it('otherwise says how the last export ended, by when it ended, not where it is in the list', () => {
    const failed = job('failed')
    const done = job('done')
    expect(exportHeadline([done, failed])).toEqual({ kind: 'done', job: done })
    expect(exportHeadline([failed, done])).toEqual({ kind: 'done', job: done })
    const later = job('failed')
    expect(exportHeadline([later, done, failed])).toEqual({ kind: 'failed', job: later })
  })

  it('counts only renders: a download’s ending shows elsewhere', () => {
    const failed = job('failed')
    const download = job('done', { presetId: 'ingest' })
    expect(exportHeadline([failed, download])).toEqual({ kind: 'failed', job: failed })
    expect(exportHeadline([job('done', { presetId: 'ingest' })])).toBeNull()
  })

  it('says nothing when the last export was cancelled — not an older one’s news', () => {
    const done = job('done')
    expect(exportHeadline([done, job('cancelled')])).toBeNull()
  })
})
