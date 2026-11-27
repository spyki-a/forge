import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { FOLDOUT_MAX, FOLDOUT_MIN, FOLDOUT_OPEN, FOLDOUT_SHUT, PICTURE_MIN } from '@shared/foldout'

/**
 * The fold-out panel's place in the window (App.tsx; components/Foldout.tsx).
 *
 * In the user's sketch's order — tool strip, panel, picture — inside the
 * picture's own row, so the panel's height is the picture's and the picture
 * shrinks beside it, never covered. And the one thing that must not happen:
 * the Preview moving in the tree or remounting when the panel opens or closes
 * — its rAF loop is the playback clock (docs/WINDOW.md §5). So the Group that
 * holds the panel and the picture is ALWAYS rendered, nothing between it and
 * the picture's Panel is a condition, and opening is a resize of a collapsible
 * Panel, never a new element.
 *
 * Read with the TypeScript parser, as tests/trimmerDock.test.ts reads the
 * window: mounts are JSX elements, so a comment or a string is never one, and
 * every anchor's count is asserted before it is trusted — `Panel`, `Group` and
 * `Preview` are each written many times in App.tsx.
 */

const root = resolve(__dirname, '..')
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8')
const APP = 'src/renderer/src/App.tsx'
const FOLDOUT = 'src/renderer/src/components/Foldout.tsx'

type Tagged = ts.JsxElement | ts.JsxSelfClosingElement
const parse = (path: string): ts.SourceFile => ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
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

const written = (text: string, name: string): number => [...text.matchAll(new RegExp(`<${name}\\b`, 'g'))].length

const attr = (node: Tagged, name: string, file: ts.SourceFile): string | undefined => {
  const found = opening(node).attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(file) === name
  )
  if (!found) return undefined
  return found.initializer ? found.initializer.getText(file) : 'true'
}

function enclosing(node: ts.Node, name: string, file: ts.SourceFile): Tagged | null {
  for (let at = node.parent; at; at = at.parent) if (isTagged(at) && tag(at, file) === name) return at
  return null
}

/** The JSX children of an element that are elements, in order. */
const kids = (node: Tagged): Tagged[] => (ts.isJsxElement(node) ? node.children.filter(isTagged) : [])

/** Anything between `inner` and `outer` that is not plain JSX nesting: a condition, a map, a call. */
function gates(inner: ts.Node, outer: ts.Node): string[] {
  const out: string[] = []
  for (let at = inner.parent; at && at !== outer; at = at.parent) {
    if (ts.isConditionalExpression(at) || ts.isBinaryExpression(at) || ts.isCallExpression(at) || ts.isJsxExpression(at)) {
      out.push(at.getText().slice(0, 40))
    }
  }
  return out
}

describe('the fold-out panel in the window', () => {
  const text = source(APP)
  const app = parse(APP)

  it('is mounted once, beside one Preview and one tool strip — counted as text and as JSX', () => {
    for (const name of ['Foldout', 'FoldoutDivider', 'Preview', 'Toolbox', 'CanvasBar']) {
      expect(written(text, name), name).toBe(1)
      expect(mounts(app, name), name).toHaveLength(1)
    }
    // The anchors this test walks from: four Groups and ten Panels in all.
    expect(mounts(app, 'Group')).toHaveLength(written(text, 'Group'))
    expect(mounts(app, 'Panel')).toHaveLength(written(text, 'Panel'))
  })

  it('sits in the picture’s row, in the sketch’s order: tool strip, panel, picture', () => {
    const [foldout] = mounts(app, 'Foldout')
    const [preview] = mounts(app, 'Preview')
    const [toolbox] = mounts(app, 'Toolbox')
    const foldPanel = enclosing(foldout, 'Panel', app)!
    const picturePanel = enclosing(preview, 'Panel', app)!
    expect(foldPanel && picturePanel).toBeTruthy()
    expect(foldPanel).not.toBe(picturePanel)
    // One Group holds the two Panels, and the divider between them, and nothing else.
    const group = enclosing(foldPanel, 'Group', app)!
    expect(enclosing(picturePanel, 'Group', app)).toBe(group)
    expect(attr(group, 'orientation', app)).toBe('"horizontal"')
    expect(kids(group).map((k) => tag(k, app))).toEqual(['Panel', 'FoldoutDivider', 'Panel'])
    expect(kids(group)[0]).toBe(foldPanel)
    expect(kids(group)[2]).toBe(picturePanel)
    // That Group is the picture row's second child, after the tool strip.
    const row = toolbox.parent as ts.JsxElement
    expect(kids(row)).toEqual([toolbox, group])
    // And the row is the picture's: inside the Panel the canvas bar is in, not the timeline's.
    const centre = enclosing(mounts(app, 'CanvasBar')[0], 'Panel', app)!
    expect(enclosing(group, 'Panel', app)).toBe(centre)
    expect(enclosing(mounts(app, 'Timeline')[0], 'Panel', app)).not.toBe(centre)
  })

  it('is always rendered: no condition between the picture’s Panel and the Preview', () => {
    const [preview] = mounts(app, 'Preview')
    const [foldout] = mounts(app, 'Foldout')
    const centre = enclosing(mounts(app, 'CanvasBar')[0], 'Panel', app)!
    expect(gates(preview, centre)).toEqual([])
    expect(gates(foldout, centre)).toEqual([])
    // The divider too: the library pairs separators with the panels around them,
    // and one appearing and going would reshape the Group.
    expect(gates(mounts(app, 'FoldoutDivider')[0], centre)).toEqual([])
  })

  it('collapses to nothing and opens between 280 px and 60 %, the picture never under 35 %', () => {
    const foldPanel = enclosing(mounts(app, 'Foldout')[0], 'Panel', app)!
    const picturePanel = enclosing(mounts(app, 'Preview')[0], 'Panel', app)!
    expect(attr(foldPanel, 'collapsible', app)).toBe('true')
    expect(attr(foldPanel, 'collapsedSize', app)).toBe(`{${FOLDOUT_SHUT}}`)
    expect(attr(foldPanel, 'defaultSize', app)).toBe(`{${FOLDOUT_SHUT}}`)
    expect(attr(foldPanel, 'minSize', app)).toBe(`{${FOLDOUT_MIN}}`)
    expect(attr(foldPanel, 'maxSize', app)).toBe(`"${FOLDOUT_MAX}"`)
    expect(attr(picturePanel, 'minSize', app)).toBe(`"${PICTURE_MIN}"`)
    // Each with an id of its own.
    expect(attr(foldPanel, 'id', app)).toMatch(/^"[\w-]+"$/)
    expect(attr(picturePanel, 'id', app)).toMatch(/^"[\w-]+"$/)
    expect(attr(foldPanel, 'id', app)).not.toBe(attr(picturePanel, 'id', app))
  })

  it('is kept in step with the store by useFoldoutPanel, called once in App', () => {
    const foldPanel = enclosing(mounts(app, 'Foldout')[0], 'Panel', app)!
    expect([...text.matchAll(/const foldout = useFoldoutPanel\(\)/g)]).toHaveLength(1)
    expect(attr(foldPanel, 'panelRef', app)).toBe('{foldout.panelRef}')
    expect(attr(foldPanel, 'onResize', app)).toBe('{foldout.onResize}')
    // And it opens the first time at FOLDOUT_OPEN.
    expect([...source(FOLDOUT).matchAll(/const width = useRef<number \| string>\(FOLDOUT_OPEN\)/g)]).toHaveLength(1)
    expect(FOLDOUT_OPEN).toBe('40%')
  })

  it('has its divider disabled and drawn at no width while the panel is shut', () => {
    const fn = app.statements.find(
      (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'FoldoutDivider'
    )!
    expect(fn).toBeDefined()
    const body = fn.getText(app)
    expect(body).toContain('const open = useEditor((s) => s.foldout.open)')
    const separators = mounts(app, 'Separator').filter((s) => enclosing(s, 'Separator', app) === null && fn.getStart(app) <= s.getStart(app) && s.end <= fn.end)
    expect(separators).toHaveLength(1)
    expect(attr(separators[0], 'disabled', app)).toBe('{!open}')
    expect(attr(separators[0], 'className', app)).toMatch(/^\{open \? '[^']*\bw-px\b[^']*' : 'w-0'\}$/)
  })
})
