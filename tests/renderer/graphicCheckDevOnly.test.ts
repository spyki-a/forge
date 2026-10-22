import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * The graphics check rides in the development app only (docs/CLIPS.md §6.11,
 * "Where it runs"): src/renderer/src/main.tsx imports it dynamically inside
 * `if (import.meta.env.DEV)`, a branch the production build drops, so no
 * bundle it makes carries the check. A static import of anything under
 * harness/ would ship it, and until this test only a grep of a manual build
 * would have seen it.
 */
const source = readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'src', 'main.tsx'), 'utf8')

/** The block whose `{` is at `open`, to its matching `}`, by depth (main.tsx has no braces inside strings). */
function blockFrom(text: string, open: number): { start: number; end: number } {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return { start: open, end: i }
  }
  throw new Error(`no closing brace for the block at ${open}`)
}

describe('main.tsx and the harness', () => {
  it('names harness/ only in dynamic import()s inside its one import.meta.env.DEV block', () => {
    const guards = [...source.matchAll(/if \(import\.meta\.env\.DEV\) \{/g)]
    expect(guards, 'one DEV guard, exactly as written').toHaveLength(1)
    const block = blockFrom(source, guards[0].index! + guards[0][0].length - 1)

    // Every module specifier that reaches into harness/, however it is imported.
    const specifiers = [...source.matchAll(/(['"`])([^'"`\n]*\bharness\/[^'"`\n]*)\1/g)]
    expect(specifiers.length, 'the development app installs the check').toBeGreaterThan(0)
    for (const s of specifiers) {
      const at = s.index!
      expect(at > block.start && at < block.end, `${s[0]} at offset ${at} is outside the DEV block (${block.start}-${block.end})`).toBe(true)
      expect(source.slice(0, at).trimEnd().endsWith('import('), `${s[0]} is not loaded by a dynamic import()`).toBe(true)
    }
  })
})
