import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/*
 * The settings panel under the header's gear (docs/WINDOW.md §3.9, step 6).
 *
 * The user's decision, sheet 28: every outside service in one panel at the top
 * right, where the "AI" dot was. The Director's model servers moved into it,
 * and with them the one thing in this window that must never travel the other
 * way: the hosted API key. It lives in the settings file in the main process;
 * the renderer learns only `hasKey`, and only ever SENDS a key, through
 * setDirectorProvider → window.forge.setDirectorSettings. So this file pins
 * that the panel reads nothing key-shaped but `hasKey`, that the field holds
 * only what is being typed and sends it nowhere but the save. The rendered
 * half — a key smuggled into the config does not reach the screen — is
 * tests/renderer/settingsPanelRender.test.ts.
 *
 * Source anchors are counted, never trusted to be unique (CLAUDE.md).
 */

const root = resolve(__dirname, '..')
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8')
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const count = (text: string, needle: string): number => [...text.matchAll(new RegExp(escapeRe(needle), 'g'))].length

const PANEL = 'src/renderer/src/components/SettingsPanel.tsx'
const DIRECTOR = 'src/renderer/src/components/Director.tsx'
const APP = 'src/renderer/src/App.tsx'

const parse = (path: string, text = source(path)): ts.SourceFile =>
  ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

function everyNode(file: ts.SourceFile): ts.Node[] {
  const out: ts.Node[] = []
  const visit = (node: ts.Node): void => {
    out.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

/** The name a property access or a string-keyed element access reads, or null. */
function readName(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text
  return null
}

const ancestors = (node: ts.Node): ts.Node[] => {
  const out: ts.Node[] = []
  for (let at = node.parent; at; at = at.parent) out.push(at)
  return out
}

type Tagged = ts.JsxElement | ts.JsxSelfClosingElement
const opening = (node: Tagged): ts.JsxOpeningLikeElement => (ts.isJsxElement(node) ? node.openingElement : node)
const attribute = (node: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined =>
  node.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name)
const stringAttr = (node: ts.JsxOpeningLikeElement, name: string): string | null => {
  const init = attribute(node, name)?.initializer
  return init && ts.isStringLiteral(init) ? init.text : null
}

describe('the model servers leave the Director for the settings panel', () => {
  const director = source(DIRECTOR)
  const panel = source(PANEL)

  it('the Director keeps no provider or key handling — only the line saying who answers, and a gear to the panel', () => {
    for (const gone of ['setDirectorProvider', 'setDirectorSettings', 'apiKey', 'hasKey', 'type="password"', 'modelPicker', 'setKey(']) {
      expect(count(director, gone), gone).toBe(0)
    }
    expect(count(director, 'onClick={() => setSettingsOpen(true)}')).toBe(1)
    // It still asks on its own mount, so its status line resolves without the panel ever opening.
    expect([...director.matchAll(/useEffect\(\(\) => \{\s*void refresh\(\)\s*\}, \[refresh\]\)/g)]).toHaveLength(1)
  })

  it('the panel has the whole block, on the same store actions', () => {
    for (const part of [
      'useEditor((s) => s.setDirectorProvider)',
      'useEditor((s) => s.refreshDirector)',
      "(['auto', 'ollama', 'openai'] as LlmProviderChoice[]).map((p) =>",
      'onClick={() => void setProvider({ provider: p })}',
      'onChange={(e) => void setProvider({ ollama: { baseUrl: e.target.value } })}',
      'onChange={(e) => void setProvider({ openai: { baseUrl: e.target.value } })}',
      "void setProvider({ openai: { apiKey: key.trim() } })",
      "onClick={() => void setProvider({ openai: { apiKey: '' } })}",
      'onClick={() => void refresh()}'
    ]) {
      expect(count(panel, part), part).toBe(1)
    }
    // Both model fields go through the one picker.
    expect(count(panel, "{modelPicker('ollama', ollama?.models, config.ollama.model)}")).toBe(1)
    expect(count(panel, "{modelPicker('openai', openai?.models, config.openai.model)}")).toBe(1)
  })

  it('the panel asks the servers again when it opens', () => {
    expect([...panel.matchAll(/useEffect\(\(\) => \{\s*void refresh\(\)\s*\}, \[refresh\]\)/g)]).toHaveLength(1)
  })
})

describe('the key is write-only', () => {
  const file = parse(PANEL)
  const nodes = everyNode(file)

  it('the panel reads hasKey back, and nothing else key-shaped', () => {
    const reads = nodes.map((n) => ({ n, name: readName(n) })).filter((r): r is { n: ts.Node; name: string } => r.name !== null)
    expect(reads.filter((r) => r.name === 'hasKey').length).toBeGreaterThanOrEqual(1)
    // `e.key` is the keyboard's key, in the Escape handler; every other key-shaped read is a leak.
    const leaks = reads
      .filter((r) => /key/i.test(r.name) && r.name !== 'hasKey' && r.n.getText() !== 'e.key')
      .map((r) => `${r.n.getText()} (line ${file.getLineAndCharacterOfPosition(r.n.getStart()).line + 1})`)
    expect(leaks).toEqual([])
  })

  it('apiKey is only ever written: a property of what setProvider sends, twice — Save and Clear', () => {
    const named = nodes.filter((n): n is ts.Identifier => ts.isIdentifier(n) && n.text === 'apiKey')
    expect(named.length).toBe(2)
    for (const id of named) {
      const where = `line ${file.getLineAndCharacterOfPosition(id.getStart()).line + 1}`
      expect(ts.isPropertyAssignment(id.parent) && id.parent.name === id, where).toBe(true)
      const call = ancestors(id).find(ts.isCallExpression)
      expect(call?.expression.getText(), where).toBe('setProvider')
    }
  })

  it('the field holds only what is typed, and it goes nowhere but the save', () => {
    const draft = nodes.filter(
      (n): n is ts.Identifier =>
        ts.isIdentifier(n) &&
        n.text === 'key' &&
        // Not a name being read off something (e.key), not a JSX key={…}, not the declaration.
        !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) &&
        !(ts.isJsxAttribute(n.parent) && n.parent.name === n) &&
        !ts.isBindingElement(n.parent)
    )
    expect(draft.length).toBeGreaterThan(0)
    const misused: string[] = []
    for (const ref of draft) {
      const where = `${ref.parent.getText().slice(0, 60)} (line ${file.getLineAndCharacterOfPosition(ref.getStart()).line + 1})`
      // value={key} on the one password field.
      if (ts.isJsxExpression(ref.parent) && ts.isJsxAttribute(ref.parent.parent) && ref.parent.parent.name.getText() === 'value') {
        const element = ref.parent.parent.parent.parent as ts.JsxOpeningLikeElement
        if (stringAttr(element, 'type') !== 'password') misused.push(`value on a field that is not a password: ${where}`)
        continue
      }
      // key.trim(), deciding whether Save can be pressed, or being sent as the key.
      const trims = ts.isPropertyAccessExpression(ref.parent) && ref.parent.name.text === 'trim' && ts.isCallExpression(ref.parent.parent)
      const up = ancestors(ref)
      const inDisabled = up.some((a) => ts.isJsxAttribute(a) && a.name.getText() === 'disabled')
      const sent = up.some((a) => ts.isPropertyAssignment(a) && a.name.getText() === 'apiKey')
      if (trims && (inDisabled || sent)) continue
      misused.push(where)
    }
    expect(misused).toEqual([])
    expect(count(source(PANEL), 'type="password"')).toBe(1)
    // And it is emptied once sent.
    expect(count(source(PANEL), "setKey('')")).toBe(1)
  })

  it('goes through the store only, and logs nothing', () => {
    const panel = source(PANEL)
    expect(count(panel, 'window.forge')).toBe(0)
    expect(count(panel, 'console.')).toBe(0)
  })
})

describe('the header gear', () => {
  const file = parse(APP)
  const titled = everyNode(file).filter(
    (n): n is Tagged => (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) && stringAttr(opening(n), 'title') === 'Settings'
  )

  it('is one button titled Settings, pressable inside the drag region', () => {
    expect(titled).toHaveLength(1)
    const gear = opening(titled[0])
    expect(gear.tagName.getText()).toBe('button')
    // The header is a .drag-region: without no-drag the press moves the window.
    const className = attribute(gear, 'className')?.initializer?.getText() ?? ''
    expect([...className.matchAll(/(?<![\w-])no-drag(?![\w-])/g)]).toHaveLength(1)
    expect(attribute(gear, 'onClick')?.initializer?.getText()).toBe('{() => setSettingsOpen(!settingsOpen)}')
    // It carries the AI helper's dot, as the "AI" span it replaced did.
    expect(count(titled[0].getText(), 'helper.dot')).toBe(1)
  })

  it('is always rendered, in the Header', () => {
    expect(titled).toHaveLength(1)
    const up = ancestors(titled[0])
    const fn = up.find((a) => ts.isFunctionDeclaration(a) || ts.isArrowFunction(a) || ts.isFunctionExpression(a))
    expect(fn && ts.isFunctionDeclaration(fn) ? fn.name?.text : null).toBe('Header')
    const between = up.slice(0, up.indexOf(fn!))
    const gated = between.filter((a) => ts.isJsxExpression(a) || ts.isConditionalExpression(a) || ts.isBinaryExpression(a))
    expect(gated.map((a) => a.getText().slice(0, 40))).toEqual([])
  })

  it('the panel is mounted once, unconditionally, and the old AI span is gone', () => {
    const app = source(APP)
    expect(count(app, '<SettingsPanel />')).toBe(1)
    expect(app).toMatch(/\n\s*<SettingsPanel \/>\n/)
    expect(count(app, 'AI sidecar')).toBe(0)
  })
})

describe('on screen it is the AI helper, never the sidecar', () => {
  /* The user's "sidecar" is the left panel (WINDOW.md §1); code names stay. */
  const posix = (path: string): string => relative(root, path).split(sep).join('/')
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return walk(path)
      return /\.tsx?$/.test(entry.name) ? [path] : []
    })

  /** What a file could put on screen: string literals, template text, JSX text — not names, not comments. */
  const words = (path: string): string[] => {
    const out: string[] = []
    for (const node of everyNode(parse(path, readFileSync(path, 'utf8')))) {
      if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        out.push(node.text)
      }
    }
    return out
  }

  it('no interface string says sidecar', () => {
    // The harness is not the interface: its bridge's helper is "no sidecar" by design.
    const files = walk(resolve(root, 'src/renderer/src')).filter((p) => !posix(p).startsWith('src/renderer/src/harness/'))
    expect(files.length).toBeGreaterThan(20)
    const said = files.flatMap((p) => words(p).filter((w) => /sidecar/i.test(w)).map((w) => `${posix(p)}: ${w.trim()}`))
    expect(said).toEqual([])
  })

  it('the Media pool says which helper is missing', () => {
    expect(count(source('src/renderer/src/components/MediaPool.tsx'), "'The AI helper (Python) is not running'")).toBe(1)
  })

  /*
   * Nor the messages the main process sends up to be shown. A failed start
   * reaches the panel's AI helper row word for word (service.ts → sidecarError
   * → SettingsPanel), and a voice reason reaches the voice picker — so on the
   * Windows machine without Python, the row read "The sidecar stopped (code
   * 9009)". What counts as a message: the text inside `new …Error(…)`, and
   * whatever is put in an `error`, `reason` or `message` — a property, a
   * variable or an assignment. Names, channels, paths and logs stay "sidecar".
   */
  it('nor any message the main process sends up to the screen', () => {
    const slot = /(?:^|\.)(?:error|reason|message)$|(?:Reason|Message)$/i
    const inSlot = (a: ts.Node): boolean =>
      (ts.isNewExpression(a) && /Error$/.test(a.expression.getText())) ||
      (ts.isPropertyAssignment(a) && slot.test(a.name.getText())) ||
      (ts.isVariableDeclaration(a) && slot.test(a.name.getText())) ||
      (ts.isBinaryExpression(a) && a.operatorToken.kind === ts.SyntaxKind.EqualsToken && slot.test(a.left.getText()))
    const messages = (path: string): string[] =>
      everyNode(parse(path, readFileSync(path, 'utf8')))
        .filter(
          (n) =>
            ts.isStringLiteral(n) ||
            ts.isNoSubstitutionTemplateLiteral(n) ||
            ts.isTemplateHead(n) ||
            ts.isTemplateMiddle(n) ||
            ts.isTemplateTail(n)
        )
        .filter((n) => ancestors(n).some(inSlot))
        .map((n) => (n as ts.LiteralLikeNode).text)

    const files = [...walk(resolve(root, 'src/main')), ...walk(resolve(root, 'src/shared'))]
    const all = files.flatMap((p) => messages(p).map((text) => ({ at: posix(p), text })))
    // The walk does find the helper's messages — so an empty answer below means none, not unseen.
    for (const [at, text] of [
      ['src/main/sidecar/client.ts', 'The AI helper is not running'],
      ['src/main/sidecar/client.ts', 'The AI helper stopped ('],
      ['src/main/sidecar/service.ts', 'The AI helper keeps crashing and has been stopped'],
      ['src/main/voice.ts', 'The AI helper is not running']
    ]) {
      expect(all.some((m) => m.at === at && m.text === text), `${at}: ${text}`).toBe(true)
    }
    expect(all.filter((m) => /sidecar/i.test(m.text)).map((m) => `${m.at}: ${m.text}`)).toEqual([])
  })
})
