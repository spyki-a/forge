import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * The Shelf's registry (docs/WINDOW.md §3.2, §6 Step 9): one entry per tile,
 * in the sketch's order, each with the panel its tile opens.
 *
 * The order is the user's ("order yes", sheet 20), read row by row from the
 * sketch, and it is the grid's reading order whatever the column's width:
 *   Upload · URL · Narration · Library
 *   Transcript · Director · Depth / Parallax · Beat sync / Cut to words
 *   Transitions · One photo · Grid split · Strip flashes
 *   Film strip · 3D props · Text · Colour cards
 *   Grade · Newspaper clipping · Card ring
 *
 * Each id is checked for membership on its own — so a dropped tool is named —
 * and the order as one ordered shape, so a swap fails even though every id is
 * still there.
 *
 * Read from shelf/tools.ts with the TypeScript parser: this is a node test,
 * and the registry imports the panels, which only the renderer's project can
 * compile. The loaded half — which component each tile opens, the busy
 * selectors — is tests/renderer/shelfTools.test.ts.
 */

const PATH = 'src/renderer/src/components/shelf/tools.ts'
const text = readFileSync(resolve(__dirname, '..', PATH), 'utf8')
const file = ts.createSourceFile(PATH, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

const SKETCH: [id: string, label: string][] = [
  ['upload', 'Upload'],
  ['url', 'URL'],
  ['narration', 'Narration'],
  ['library', 'Library'],
  ['transcript', 'Transcript'],
  ['director', 'Director'],
  ['depth-parallax', 'Depth / Parallax'],
  ['beat-sync', 'Beat sync / Cut to words'],
  ['transitions', 'Transitions'],
  ['one-photo', 'One photo'],
  ['grid-split', 'Grid split'],
  ['strip-flashes', 'Strip flashes'],
  ['film-strip', 'Film strip'],
  ['props-3d', '3D props'],
  ['text', 'Text'],
  ['colour-cards', 'Colour cards'],
  ['grade', 'Grade'],
  ['newspaper', 'Newspaper clipping'],
  ['card-ring', 'Card ring']
]

interface Entry {
  /** Each property's initializer, as written. */
  props: Map<string, ts.Expression>
  /** A string literal's value, or null. */
  str: (name: string) => string | null
}

/** The entries of `export const SHELF_TOOLS = [ … ]`, in order. Throws unless it is one array of object literals. */
function entries(): Entry[] {
  const found: ts.ArrayLiteralExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'SHELF_TOOLS' && node.initializer) {
      if (ts.isArrayLiteralExpression(node.initializer)) found.push(node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  expect(found, 'export const SHELF_TOOLS = [ … ]').toHaveLength(1)
  return found[0].elements.map((element, i) => {
    expect(ts.isObjectLiteralExpression(element), `entry ${i} is an object literal`).toBe(true)
    const props = new Map<string, ts.Expression>()
    for (const p of (element as ts.ObjectLiteralExpression).properties) {
      expect(ts.isPropertyAssignment(p), `entry ${i}: ${p.getText(file).slice(0, 40)} is a plain property`).toBe(true)
      const assignment = p as ts.PropertyAssignment
      props.set(assignment.name.getText(file), assignment.initializer)
    }
    const str = (name: string): string | null => {
      const value = props.get(name)
      return value && ts.isStringLiteral(value) ? value.text : null
    }
    return { props, str }
  })
}

/** Every name the file imports, with the module it comes from. */
const imports = new Map<string, string>()
for (const statement of file.statements) {
  if (!ts.isImportDeclaration(statement) || !statement.importClause) continue
  const from = (statement.moduleSpecifier as ts.StringLiteral).text
  const named = statement.importClause.namedBindings
  if (named && ts.isNamedImports(named)) for (const el of named.elements) imports.set(el.name.text, from)
}

describe('the Shelf registry', () => {
  const tools = entries()
  const ids = tools.map((tool) => tool.str('id'))

  for (const [id, label] of SKETCH) {
    it(`has ${id}, once, labelled "${label}"`, () => {
      const mine = tools.filter((tool) => tool.str('id') === id)
      expect(mine.map((tool) => tool.str('id'))).toEqual([id])
      expect(mine[0].str('label')).toBe(label)
    })
  }

  it('has them in the sketch’s order, and nothing else', () => {
    expect(tools.map((tool) => [tool.str('id'), tool.str('label')])).toEqual(SKETCH)
  })

  it('gives every entry a panel: a component imported into the registry', () => {
    for (const [i, tool] of tools.entries()) {
      const panel = tool.props.get('panel')
      expect(panel, `${ids[i]}: panel`).toBeDefined()
      expect(ts.isIdentifier(panel!), `${ids[i]}: the panel is a component's name`).toBe(true)
      const name = (panel as ts.Identifier).text
      // Imported from a component module: '../X', './panels', or since step 10
      // an automation tool's own panel, '../tools/X'.
      expect(imports.get(name), `${ids[i]}: ${name} is imported`).toMatch(/^\.\.?\/(?:[A-Z]\w*|panels|tools\/[A-Z]\w*)$/)
      // And an icon and a tooltip of its own.
      expect(tool.props.get('icon'), `${ids[i]}: icon`).toBeDefined()
      expect((tool.str('hint') ?? '').length, `${ids[i]}: hint`).toBeGreaterThan(10)
      expect(tool.props.get('takesMedia')?.kind, `${ids[i]}: takesMedia`).toBeOneOf([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword])
    }
  })

  it('marks Narration, and only Narration, as coming soon', () => {
    expect(tools.filter((tool) => tool.props.has('soon')).map((tool) => tool.str('id'))).toEqual(['narration'])
  })
})
