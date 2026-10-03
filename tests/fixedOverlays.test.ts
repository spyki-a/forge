import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/*
 * A `fixed inset-0` overlay covers the whole window, or it is not an overlay.
 *
 * Fixed positioning takes an element out of the flow, but not out of its
 * parent's child selectors: Tailwind's `space-y-*` is a margin on every child
 * but the last, and `divide-*` a border, and both reach a fixed child too. The
 * text-card font picker (Inspector.tsx) sat in a `space-y-1.5` column, and its
 * scrim stopped 6px short of the window's bottom edge, over the timeline —
 * measured in the harness at 1239x713 in a 1239x719 window. The style gallery
 * sits in one too and is fine only because it is the last child, which is one
 * appended line away from the same bug.
 *
 * Read with the TypeScript parser: an overlay's parent is the nearest JSX
 * element around it, through `{cond && (…)}` and `.map(…)`. An overlay a
 * component returns has a parent this file cannot see, and is left out.
 */

const ROOT = resolve(__dirname, '..')
const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : name.endsWith('.tsx') ? [path] : []
  })
const rel = (file: string): string => relative(ROOT, file).split(sep).join('/')

type Tagged = ts.JsxElement | ts.JsxSelfClosingElement
const opening = (node: Tagged): ts.JsxOpeningLikeElement => (ts.isJsxElement(node) ? node.openingElement : node)

/** Every class a className could carry, from both arms of any conditional. */
function classesOf(node: Tagged, file: ts.SourceFile): Set<string> {
  const attr = opening(node).attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(file) === 'className'
  )
  if (!attr?.initializer) return new Set()
  const text = attr.initializer.getText(file)
  return new Set([...text.matchAll(/[!\w:/.[\]()-]+/g)].map((m) => m[0]))
}

/**
 * The element whose children this one is. Null when the chain leaves the JSX
 * tree first: returned from a component, or passed as a prop.
 */
function parentElement(node: Tagged): Tagged | null {
  for (let at: ts.Node = node.parent; at; at = at.parent) {
    if (ts.isJsxElement(at)) return at
    if (ts.isJsxAttribute(at) || ts.isReturnStatement(at) || ts.isVariableDeclaration(at) || ts.isFunctionDeclaration(at)) return null
    if (ts.isSourceFile(at)) return null
  }
  return null
}

interface Overlay {
  where: string
  classes: Set<string>
  parent: Set<string> | null
}

function overlays(): Overlay[] {
  const out: Overlay[] = []
  for (const path of filesUnder(join(ROOT, 'src/renderer'))) {
    const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const classes = classesOf(node, file)
        if (classes.has('fixed') && classes.has('inset-0')) {
          const parent = parentElement(node)
          const line = file.getLineAndCharacterOfPosition(opening(node).getStart(file)).line + 1
          out.push({ where: `${rel(path)}:${line}`, classes, parent: parent ? classesOf(parent, file) : null })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  return out
}

/** `space-y-1.5`, `md:space-x-2`, `-space-y-px`, `divide-y`, `divide-x-2`. */
const SPACING = /^(?:[a-z0-9-]+:)*-?space-[xy](?:-|$)/
const DIVIDING = /^(?:[a-z0-9-]+:)*divide-[xy](?:-|$)/

describe('full-window overlays', () => {
  it('cover the whole window, whatever column they are written in', () => {
    const found = overlays()
    // About something: the overlays are there to find, and two of them are in
    // a spaced column, the font picker among them.
    expect(found.length, found.map((o) => o.where).join(', ')).toBeGreaterThanOrEqual(4)
    const spaced = found.filter((o) => o.parent && [...o.parent].some((c) => SPACING.test(c)))
    expect(spaced.map((o) => basename(o.where.split(':')[0]))).toContain('Inspector.tsx')

    const short: string[] = []
    for (const o of found) {
      if (!o.parent) continue
      const parent = [...o.parent]
      if (parent.some((c) => SPACING.test(c)) && !o.classes.has('m-0')) short.push(`${o.where}: in a space-* column, without m-0`)
      if (parent.some((c) => DIVIDING.test(c)) && !o.classes.has('border-0')) short.push(`${o.where}: in a divide-* column, without border-0`)
    }
    expect(short).toEqual([])
  })
})
