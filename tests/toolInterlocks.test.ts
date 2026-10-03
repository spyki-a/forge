import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * The automation tools' build buttons hold each other back (docs/WINDOW.md
 * §3.10–3.13, §6 Step 10).
 *
 * The reel, One photo, the grid and the strips all write onto lanes anchored
 * at the music, and letting two run at once meant whichever finished second
 * was silently shoved past the other's output. So each build button is
 * disabled while the others that share its lane are running — a guard that
 * only ever lived in the panel's `disabled`. While they were sections of one
 * Automation panel the four guards sat side by side; step 10 put each tool in
 * a file of its own, and a guard dropped in one file is invisible from the
 * others. These are the guards exactly as they stood at 422801b
 * (Automation.tsx:280, 369, 525, 668), each on its own tool's build button.
 *
 * Read with the TypeScript parser, in the style of tests/shelf.test.ts: the
 * guard is the `disabled` attribute OF the button whose click runs the build,
 * not a string somewhere in the file; and every flag in it is the store's —
 * a local `const gridBuilding = false` would keep the text and lose the lock.
 */

const root = resolve(__dirname, '..')
const TOOLS = 'src/renderer/src/components/tools'

type Tagged = ts.JsxElement | ts.JsxSelfClosingElement
const isTagged = (node: ts.Node): node is Tagged => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)
const opening = (node: Tagged): ts.JsxOpeningLikeElement => (ts.isJsxElement(node) ? node.openingElement : node)

function read(name: string): { text: string; file: ts.SourceFile } {
  const path = `${TOOLS}/${name}`
  const text = readFileSync(resolve(root, path), 'utf8')
  return { text, file: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }
}

function buttons(file: ts.SourceFile): Tagged[] {
  const out: Tagged[] = []
  const visit = (node: ts.Node): void => {
    if (isTagged(node) && opening(node).tagName.getText(file) === 'button') out.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

/** A JSX attribute's expression, as written (the braces dropped), or undefined. */
function attr(node: Tagged, name: string, file: ts.SourceFile): ts.Expression | undefined {
  const found = opening(node).attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(file) === name
  )
  const init = found?.initializer
  return init && ts.isJsxExpression(init) ? init.expression : undefined
}

/** `a || b || c` as its operands, left to right. */
function operands(expr: ts.Expression, file: ts.SourceFile): string[] {
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    return [...operands(expr.left, file), ...operands(expr.right, file)]
  }
  return [expr.getText(file)]
}

/** `const name = <init>` anywhere in the file, as text. */
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

const GUARDS: {
  tool: string
  /** The build button's click, as written. */
  click: string
  /** Its `disabled`, as it stood at 422801b. */
  guard: string
  /** The run flags in it: the tool's own, then the ones it waits on. */
  flags: string[]
  /** How many `disabled=` the file has in all — the anchor for the count below. */
  disables: number
}[] = [
  {
    tool: 'BeatSync.tsx',
    click: '() => void buildReel()',
    guard: 'reelBuilding || gridBuilding || images === 0 || !musicClip',
    flags: ['reelBuilding', 'gridBuilding'],
    // and Add music's `disabled={adding}`
    disables: 2
  },
  {
    tool: 'OnePhoto.tsx',
    // Step 12: the click passes the photo Choose from media set (tools/SourceLine.tsx;
    // tests/sourceLine.test.ts pins that). Only the anchor moved — the guard is 422801b's.
    click: '() => void buildOnePhotoReel(chosen)',
    guard: 'reelBuilding || gridBuilding || images === 0 || !musicClip',
    flags: ['reelBuilding', 'gridBuilding'],
    disables: 1
  },
  {
    tool: 'GridSplit.tsx',
    // Step 12, as One photo's: the chosen photo is passed; the guard is unchanged.
    click: '() => void buildGrid(chosen)',
    guard: 'gridBuilding || reelBuilding || images === 0',
    flags: ['gridBuilding', 'reelBuilding'],
    disables: 1
  },
  {
    tool: 'StripFlashes.tsx',
    click: '() => void buildStrips()',
    guard: 'stripsBuilding || reelBuilding || gridBuilding',
    flags: ['stripsBuilding', 'reelBuilding', 'gridBuilding'],
    disables: 1
  }
]

describe('each automation tool’s build button keeps its interlock', () => {
  for (const { tool, click, guard, flags, disables } of GUARDS) {
    describe(tool, () => {
      const { text, file } = read(tool)

      it('has its build button, once, and the guard on it — word for word', () => {
        // Anchors first: the file's `disabled=`s, counted, and the guard among
        // them exactly once — so the AST read below cannot be reading nothing.
        expect([...text.matchAll(/\bdisabled=\{/g)], `${tool}: disabled= expressions`).toHaveLength(disables)
        const escaped = guard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        expect([...text.matchAll(new RegExp(`\\bdisabled=\\{${escaped}\\}`, 'g'))], `${tool}: disabled={${guard}}`).toHaveLength(1)

        const builds = buttons(file).filter((b) => attr(b, 'onClick', file)?.getText(file) === click)
        expect(builds, `${tool}: <button onClick={${click}}>`).toHaveLength(1)
        const disabled = attr(builds[0], 'disabled', file)
        expect(disabled, `${tool}: the build button's disabled`).toBeDefined()
        expect(disabled!.getText(file).replace(/\s+/g, ' ')).toBe(guard)
      })

      it('waits on every run that shares its lane, each flag by name', () => {
        // Membership, so a dropped flag is named in the failure.
        const [build] = buttons(file).filter((b) => attr(b, 'onClick', file)?.getText(file) === click)
        const held = operands(attr(build, 'disabled', file)!, file)
        for (const flag of flags) expect(held, `${tool} waits on ${flag}`).toContain(flag)
      })

      it('reads each flag from the store, not from something that only looks like it', () => {
        for (const flag of flags) {
          expect(declared(file, flag), `${tool}: const ${flag}`).toEqual([`useEditor((s) => s.${flag})`])
        }
      })
    })
  }

  it('keeps the grid’s reason for waiting on the reel, beside its guard', () => {
    // The comment that says why the guard exists, moved with it (Automation.tsx:522-524 at 422801b).
    const { text } = read('GridSplit.tsx')
    const why = [
      '// Also while the reel is analysing: both rules write onto a video',
      '// lane anchored at the music, and letting them race meant whichever',
      "// finished second was silently shoved past the other's output.",
      'disabled={gridBuilding || reelBuilding || images === 0}'
    ]
    const at = [...text.matchAll(/\/\/ Also while the reel is analysing/g)]
    expect(at).toHaveLength(1)
    const lines = text.slice(at[0].index).split('\n').slice(0, why.length).map((line) => line.trim())
    expect(lines).toEqual(why)
  })
})

/*
 * The two build buttons that are NOT interlocks still have guards, and after
 * the split each sits alone in its file where nothing else reads it: the
 * filmstrip cannot build from no photos, and props cannot be placed until
 * something is transcribed and while a run is on. Pinned the same way — the
 * `disabled` of the button whose click builds, word for word.
 */
const SOLO_GUARDS: { tool: string; click: string; guard: string }[] = [
  { tool: 'FilmStrip.tsx', click: 'buildFilmstrip', guard: 'images === 0' },
  { tool: 'Props3d.tsx', click: '() => void run()', guard: 'running || !transcribed' }
]

describe('the other build buttons keep their own guards', () => {
  for (const { tool, click, guard } of SOLO_GUARDS) {
    it(`${tool}: disabled={${guard}} on its build button`, () => {
      const { text, file } = read(tool)
      const escaped = guard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expect([...text.matchAll(new RegExp(`\\bdisabled=\\{${escaped}\\}`, 'g'))], `${tool}: the guard, once`).toHaveLength(1)
      const builds = buttons(file).filter((b) => attr(b, 'onClick', file)?.getText(file) === click)
      expect(builds, `${tool}: <button onClick={${click}}>`).toHaveLength(1)
      const disabled = attr(builds[0], 'disabled', file)
      expect(disabled, `${tool}: the build button's disabled`).toBeDefined()
      expect(disabled!.getText(file).replace(/\s+/g, ' ')).toBe(guard)
    })
  }
})
