import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * The Export strip's four-to-a-row choices keep their words inside their
 * buttons.
 *
 * Quality and Speed are four buttons to a row. In the left column at about
 * its 240 px floor a cell is 50 px wide, and at 11 px "Standard" is 47.1 px
 * and "Balanced" 47.8 px (measured on the page, 2026-11-27). With `px-2` the
 * word started 8 px in and ran 5 and 6 px past its button, under the next one
 * — found by the overlap check (scroll widths 55 and 56 in 50). Those rows now
 * take no side padding and 10.5 px type: 45.6 px of word in 50.
 *
 * The page's own check (harness/overlapCheck.ts, state `export-open`) is what
 * measures it; this holds what it measured, since jsdom has no widths: every
 * button of a four-column row asks for the `four` class, and that class has
 * no side padding and the smaller type.
 */

const SOURCE = readFileSync(join(__dirname, '..', 'src/renderer/src/components/ExportSettings.tsx'), 'utf8')

describe('the Export strip’s four-to-a-row choices', () => {
  const four = [...SOURCE.matchAll(/\$\{four \? '([^']*)' : '([^']*)'\}/g)]
  /** Each four-column row, from its grid to the grid's closing tag. */
  const rows = [...SOURCE.matchAll(/<div className="[^"]*\bgrid-cols-4\b[^"]*">([\s\S]*?)\n {10,12}<\/div>/g)].map((m) => m[1])

  it('has one class for a choice, with one four-to-a-row variant', () => {
    expect([...SOURCE.matchAll(/const segment = \(on: boolean, four = false\): string =>/g)]).toHaveLength(1)
    expect(four).toHaveLength(1)
  })

  it('the four-to-a-row variant has no side padding and the 10.5 px type; the others keep theirs', () => {
    const [, tight, plain] = four[0]
    expect(tight.split(' ').sort()).toEqual(['px-0', 'text-[10.5px]'])
    expect(plain.split(' ').sort()).toEqual(['px-2', 'text-[11px]'])
  })

  it('every button of every four-column row asks for it', () => {
    expect(rows).toHaveLength(2)
    const calls = rows.flatMap((row) => [...row.matchAll(/className=\{segment\(([^}]*)\)\}/g)].map((m) => m[1]))
    // Quality's presets, its Bitrate button, and Speed's presets.
    expect(calls).toHaveLength(3)
    for (const call of calls) expect(call, call).toMatch(/, true$/)
  })
})
