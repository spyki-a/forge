import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SHELF_TOOLS } from '../../src/renderer/src/components/shelf/tools'
import { HOMES, TOOL_HOMES, toolHomeOf } from '../../src/renderer/src/harness/census'

/**
 * The UI census's Shelf homes (src/renderer/src/harness/census.ts, docs/WINDOW.md
 * §6 Step 9): one per tool, each opening the tool it is named for.
 *
 * Why this exists: the table from home to tool was hand-written, and a
 * verifier swapped two of its pairs — director with beat-sync, text with
 * grade — with every test passing. Each home was still there; it only opened
 * the wrong tool, so its rows would be looked for in another panel. The eight
 * automation tiles all opened the same panel until step 10, so between them
 * not even the harness census would have noticed then. The table is now
 * derived from the registry; this holds it to the rule.
 *
 * Membership over the registry, never a list of the nineteen: a tool added
 * correctly must not fail this.
 */

describe('the census’s Shelf homes', () => {
  it('gives every tool a home of its own, and that home opens that tool', () => {
    expect(Object.keys(TOOL_HOMES)).toHaveLength(SHELF_TOOLS.length)
    for (const tool of SHELF_TOOLS) {
      expect(TOOL_HOMES[toolHomeOf(tool.id)], tool.id).toBe(tool.id)
    }
  })

  it('names each home after its tool: the id’s words run together, less any that starts with a digit', () => {
    for (const [home, id] of Object.entries(TOOL_HOMES)) {
      // Spelled independently of census.ts's own rule.
      expect(home, id).toBe(id.replace(/-\d[a-z\d]*/g, '').replace(/-/g, ''))
      // The fixture's rule for a home (tests/uiCensus.test.ts).
      expect(home, id).toMatch(/^[a-z]+$/)
    }
    // The two the fixture's rows depend on. Letters only would give "propsd".
    expect(toolHomeOf('beat-sync')).toBe('beatsync')
    expect(toolHomeOf('props-3d')).toBe('props')
  })

  it('has every home a fixture row names, and no tool home the other homes also use', () => {
    const rows = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/ui-census.json'), 'utf8')) as { label: string; home: string }[]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.filter((row) => !HOMES.includes(row.home)).map((row) => `${row.label} [${row.home}]`)).toEqual([])
    // Each tool home once in the whole list: a tool named after a strip or an
    // overlay would have its rows counted in that strip.
    for (const home of Object.keys(TOOL_HOMES)) {
      expect(HOMES.filter((h) => h === home), home).toHaveLength(1)
    }
  })
})

/*
 * The reframe's rows (docs/CLIPS.md §4.8), each counted on screen by a recipe
 * in harness/census.ts: the canvas bar's offer, the dock's Follow the subject
 * section, and the analysis's row in EXPORT. Membership: each label in its own
 * home — never the whole list, so a row added correctly later does not fail.
 *
 * And two labels the plan once listed that must NOT be rows: the analysis
 * never calls the salient finder (decided 2026-10-13, §16.35), so there is no
 * "Get the subject model" and no "Find subjects without faces" to find.
 */
describe('the census’s reframe rows', () => {
  const rows = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/ui-census.json'), 'utf8')) as {
    label: string
    home: string
    needs: string
  }[]
  const homesOf = (label: string): string[] => rows.filter((row) => row.label === label).map((row) => row.home)

  it('counts each of §4.8’s labels in its own home', () => {
    const expected: [string, string][] = [
      ['Landscape video on a 9:16 canvas', 'canvasbar'],
      ['Reframe to 9:16', 'canvasbar'],
      ['Follow the subject', 'dock'],
      ['Unfollow', 'dock'],
      ['Follow:', 'dock'],
      ['Stack two people', 'dock'],
      ['Finding the subject', 'export'],
      ['needs the AI helper', 'canvasbar'],
      ['needs the AI helper', 'dock']
    ]
    for (const [label, home] of expected) expect(homesOf(label), label).toContain(home)
    // Every home they name is one the census can open.
    for (const [, home] of expected) expect(HOMES).toContain(home)
  })

  it('has no row for the salient finder’s controls (§16.35)', () => {
    expect(homesOf('Get the subject model')).toEqual([])
    expect(homesOf('Find subjects without faces')).toEqual([])
  })
})
