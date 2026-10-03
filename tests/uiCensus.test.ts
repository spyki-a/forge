import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * The UI census, checked against the source.
 *
 * tests/fixtures/ui-census.json lists every control the window has — label,
 * home, the state it needs — and `window.__forgeCensus()` in the harness counts
 * each one on screen (src/renderer/src/harness/census.ts, docs/WINDOW.md §6
 * Step 0). That needs a browser. This is the half that does not: every label is
 * still WRITTEN in the interface's source, as text the interface can put on
 * screen, so a control renamed or deleted fails here first, on every machine
 * and in CI.
 *
 * "Written" means in a string literal, a template literal's text or JSX text —
 * parsed, not searched. The first version searched each file's raw text, so a
 * label survived its control in a COMMENT ("Exit full screen" in
 * shared/fullScreen.ts, "New project" in shared/timeline.ts) or inside a longer
 * word ("Key" in "Keyframes"). And the label has to be the WHOLE literal unless
 * the row says `part` — the static half of "3 words" — and then it has to sit
 * at word boundaries.
 *
 * What this cannot do is tell two literals with the same words apart: "Cut",
 * "Clear" and "Key" are each written in several places, and deleting one leaves
 * the others. The census in the harness counts those on screen, inside their
 * own home, and catches it there. Rows the harness cannot show at all have no
 * such second check, so they are held to the file the fixture names.
 *
 * Membership, never a snapshot. The window is being rebuilt, controls move
 * between files at nearly every step, and a test that pinned which file each
 * label lives in — or how many rows there are — would fail the moment a move
 * was done right. What it pins is that the words survive the move.
 */

const root = resolve(__dirname, '..')
const posix = (path: string): string => relative(root, path).split(sep).join('/')

interface Row {
  label: string
  match: string
  home: string
  needs: string
  part?: true
  count?: number
  file: string
  line: number
  newHome: string
  harnessOnly?: false
  note?: string
}

const rows: Row[] = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/ui-census.json'), 'utf8'))

function walk(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path, keep)
    return keep(posix(path)) ? [path] : []
  })
}

/* ------------------------------------------------------------- matching */

/*
 * The same two functions are in src/renderer/src/harness/census.ts, which
 * applies the same rule to the screen. Change both or neither.
 */

/** Whitespace as the screen shows it: runs collapsed, ends trimmed. */
const norm = (text: string): string => text.replace(/\s+/g, ' ').trim()

const WORD = /[\p{L}\p{N}]/u

/** `label` inside `text`, but not inside a longer word: "Key" is not in "Keyframes", nor "Split" in "Splits". */
function bounded(text: string, label: string): boolean {
  const first = WORD.test(label[0])
  const last = WORD.test(label[label.length - 1])
  for (let at = text.indexOf(label); at !== -1; at = text.indexOf(label, at + 1)) {
    const before = at > 0 ? text[at - 1] : ''
    const after = text[at + label.length] ?? ''
    if ((!first || !WORD.test(before)) && (!last || !WORD.test(after))) return true
  }
  return false
}

const fits = (text: string, label: string, part: boolean): boolean => text === label || (part && bounded(text, label))

/* ------------------------------------------------------------- reading */

/** The HTML entities JSX decodes, as far as this interface uses them. An unknown one is left as written. */
const ENTITIES: Record<string, string> = {
  amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ',
  middot: '·', mdash: '—', ndash: '–', hellip: '…', rarr: '→', larr: '←', times: '×', bull: '•', deg: '°'
}

const decode = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) =>
    entity[0] === '#'
      ? String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10))
      : (ENTITIES[entity] ?? whole)
  )

/** JSX text as React renders it: each line trimmed where it meets a line break, blank lines dropped, the rest joined by a space. */
function jsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/)
  return lines
    .map((line, i) => {
      let kept = line
      if (i > 0) kept = kept.trimStart()
      if (i < lines.length - 1) kept = kept.trimEnd()
      return kept
    })
    .filter((line) => line.length > 0)
    .join(' ')
}

/**
 * Every piece of text a source file could put on screen: JSX text, and the
 * text of every string and template literal (a template's text between its
 * `${…}`s, piece by piece). Parsed with TypeScript, so a comment is never in
 * it and neither is an identifier.
 */
function literals(path: string, text: string): string[] {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      out.push(decode(jsxText(node.text)))
    } else if (ts.isStringLiteral(node)) {
      // A JSX attribute's string decodes entities, as JSX text does; a JS string does not.
      out.push(ts.isJsxAttribute(node.parent) ? decode(node.text) : node.text)
    } else if (
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      out.push(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out.map(norm).filter((piece) => piece.length > 0)
}

/*
 * Where on-screen words are written: the interface's components, the
 * renderer's own tables of them (the Shelf's tool registry, shelf/tools.ts,
 * gives every tile its label and tooltip — step 9), and the shared constants
 * several of them render (a loudness target's name, a mask mode's hint, an
 * encoder's label). Not the harness — its strings are not the interface — and
 * not the census itself, which would find every label in its own fixture.
 */
const sources = [
  ...walk(
    resolve(root, 'src/renderer/src'),
    (p) => (p.endsWith('.tsx') || p.endsWith('.ts')) && !p.endsWith('.d.ts') && !p.startsWith('src/renderer/src/harness/')
  ),
  ...walk(resolve(root, 'src/shared'), (p) => p.endsWith('.ts'))
].map((path) => {
  const text = readFileSync(path, 'utf8')
  return { path: posix(path), pieces: literals(path, text) }
})

const writtenIn = (row: Row, among = sources): string[] =>
  among.filter((source) => source.pieces.some((piece) => fits(piece, row.label, Boolean(row.part)))).map((s) => s.path)

const where = (row: Row): string => `${JSON.stringify(row.label)} [${row.home}/${row.needs}] last seen ${row.file}:${row.line}`

/* ---------------------------------------------------------------- tests */

describe('reading the interface source', () => {
  it('takes JSX text, attributes and literals, and leaves comments and names alone', () => {
    const pieces = literals(
      'x.tsx',
      [
        '/* Exit full screen */',
        '// New project',
        'const Keyframes = 1',
        'export const A = () => (',
        '  <button title="Don&apos;t go" aria-label={`${n} — minutes and seconds`}>',
        '    Exit full',
        '    screen',
        '    {n} placed. They are ordinary clips',
        '  </button>',
        ')',
        "const b = 'Not yet released'"
      ].join('\n')
    )
    expect(pieces).toContain('Exit full screen')
    expect(pieces).toContain("Don't go")
    expect(pieces).toContain('— minutes and seconds')
    expect(pieces).toContain('placed. They are ordinary clips')
    expect(pieces).toContain('Not yet released')
    expect(pieces).not.toContain('New project')
    expect(pieces).not.toContain('Keyframes')
    expect(pieces.filter((piece) => piece.includes('Exit full screen'))).toEqual(['Exit full screen'])
  })

  it('matches a whole piece, or a part only at word boundaries', () => {
    expect(fits('Key', 'Key', false)).toBe(true)
    expect(fits('Keyframes', 'Key', true)).toBe(false)
    expect(fits('Splits the song', 'Split', true)).toBe(false)
    expect(fits('Diagonal sweep', 'Diagonal', false)).toBe(false)
    expect(fits('Diagonal sweep', 'Diagonal', true)).toBe(true)
    expect(fits('Get · 81 MB', 'Get ·', true)).toBe(true)
    expect(fits('3 words', 'words', true)).toBe(true)
  })
})

describe('the UI census fixture', () => {
  it('has rows, each with a label, a match rule, a home and a state', () => {
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(typeof row.label, JSON.stringify(row)).toBe('string')
      expect(row.label.trim(), JSON.stringify(row)).not.toBe('')
      // Leading or trailing space is invisible in the fixture and fragile on screen.
      expect(row.label, JSON.stringify(row)).toBe(row.label.trim())
      expect(['text', 'title', 'aria-label', 'placeholder'], JSON.stringify(row)).toContain(row.match)
      expect(row.home, JSON.stringify(row)).toMatch(/^[a-z]+$/)
      expect(row.needs, JSON.stringify(row)).toMatch(/^[a-z0-9-]+$/)
      if (row.part !== undefined) expect(row.part, JSON.stringify(row)).toBe(true)
      // One is the default and is left out; a count says how many controls one row stands for.
      if (row.count !== undefined) {
        expect(Number.isInteger(row.count) && row.count >= 2, JSON.stringify(row)).toBe(true)
      }
      if (row.harnessOnly !== undefined) {
        expect(row.harnessOnly, JSON.stringify(row)).toBe(false)
        expect(row.note ?? '', `${JSON.stringify(row)} says why the harness cannot show it`).not.toBe('')
      }
    }
  })

  it('has no two rows for the same label in the same home and state', () => {
    const seen = new Map<string, number>()
    const twice: string[] = []
    rows.forEach((row, i) => {
      const key = JSON.stringify([row.label, row.home, row.needs])
      if (seen.has(key)) twice.push(`${key} (rows ${seen.get(key)} and ${i})`)
      else seen.set(key, i)
    })
    expect(twice).toEqual([])
  })

  it('has no part-of-a-text label so short that a word boundary means nothing', () => {
    // A whole-text match of "On" is one button; "On" anywhere inside a sentence is any sentence.
    const short = rows.filter((row) => row.part && row.label.length < 3)
    expect(short.map((row) => `${row.label} [${row.home}/${row.needs}]`)).toEqual([])
  })

  it('finds every label written in the interface source', () => {
    const lost = rows.filter((row) => writtenIn(row).length === 0)
    expect(lost.map(where)).toEqual([])
  })

  it('finds each label the harness cannot show in the file the fixture names', () => {
    // Nothing else watches these: the census skips them. A deliberate move updates `file`.
    const hidden = rows.filter((row) => row.harnessOnly === false)
    expect(hidden.length).toBeGreaterThan(0)
    const lost = hidden.filter((row) => writtenIn(row, sources.filter((s) => s.path === row.file)).length === 0)
    expect(lost.map(where)).toEqual([])
  })
})

describe('the census in the harness can build every row', () => {
  const census = readFileSync(resolve(root, 'src/renderer/src/harness/census.ts'), 'utf8')
  const start = census.indexOf('const RECIPES')
  const end = census.indexOf('\n}\n', start)
  const recipes = census.slice(start, end)

  it('has its recipe table where this test looks for it', () => {
    // A missing anchor would make `recipes` a stray slice, and the check below
    // would pass or fail by accident.
    expect([...census.matchAll(/const RECIPES/g)]).toHaveLength(1)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(recipes.length).toBeGreaterThan(1000)
  })

  it('has a recipe for every state a row needs', () => {
    const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const unbuilt = [...new Set(rows.map((row) => row.needs))].filter(
      (needs) => !new RegExp(`^\\s*(?:'${escape(needs)}'|${escape(needs)}): async`, 'm').test(recipes)
    )
    expect(unbuilt).toEqual([])
  })
})
