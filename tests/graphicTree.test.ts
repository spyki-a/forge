import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { connectorFor, parentsValid, treeParents, SUB_COUNT_CUES } from '@shared/graphics/tree'
import { claimToken } from '@shared/director/claims'
import { GRAPHIC_TEMPLATES } from '@shared/graphics/template'
import type { Transcript, Word } from '@shared/transcript'

/*
 * graphics/tree.ts (docs/CLIPS.md §6.2, "The tree"; the test as §6.2 words
 * it): the three English nested-enumeration fixtures give their expected
 * parent lists exactly; over generated item lists every parent points
 * backwards with one root and depth ≤ 2; parentsValid refuses a forward
 * parent and two levels below a child; the connector rule.
 */

interface NestedFixture {
  language: string
  transcript: Transcript
  title: string
  items: string[]
  parents: number[]
}

const NESTED = ['nested-en-1', 'nested-en-2', 'nested-en-3'].map((name) => ({
  name,
  fixture: JSON.parse(
    readFileSync(new URL(`./fixtures/graphics/${name}.json`, import.meta.url), 'utf8')
  ) as NestedFixture
}))

/** Words timed 0.3 s apart, as a text-written fixture's are (§6.10). */
function wordsOf(text: string): Word[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((t, index) => ({ index, text: t, startMs: index * 300, endMs: index * 300 + 300, confidence: null }))
}

/** The rule written out apart from parentsValid: backwards, from −1 or a root item, so depth ≤ 2. */
function oracle(parents: number[]): boolean {
  for (let i = 0; i < parents.length; i++) {
    const p = parents[i]
    if (p === -1) continue
    if (!Number.isInteger(p) || p < 0 || p >= i) return false
    if (parents[p] !== -1) return false
  }
  return true
}

/** Depth of item i below the title (1 for a child of the title). */
function depth(parents: number[], i: number): number {
  let d = 1
  for (let p = parents[i]; p !== -1; p = parents[p]) {
    d++
    if (d > parents.length + 1) return Infinity
  }
  return d
}

/** A seeded generator (mulberry32), so a failure names the seed that made it. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const COUNT_WORDS = ['2', '3', '4', '5', '6', 'two', 'three', 'four', 'five', 'six', 'seven', '1', 'one']
const FILLER = ['and', 'which', 'has', 'the', 'then', 'so', 'it', 'of', 'with', 'next']

/** A generated stretch: n items, and between each pair a gap that often says a sub-count, the children's gaps too. */
function generated(seed: number): { items: { label: string }[]; words: Word[] } {
  const r = rng(seed)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const n = 2 + Math.floor(r() * 5) // 2..6 items, the steps template's range
  const items = Array.from({ length: n }, (_, i) => ({
    label: r() < 0.3 ? `item${i} part${i}` : `item${i}`
  }))
  const out: string[] = ['first,']
  for (let i = 0; i < n; i++) {
    out.push(items[i].label + (r() < 0.5 ? ',' : ''))
    if (i + 1 < n) {
      const gap = 1 + Math.floor(r() * 5)
      const words = Array.from({ length: gap }, () => pick(FILLER))
      if (r() < 0.7) {
        const at = Math.floor(r() * (words.length + 1))
        const cue = pick(SUB_COUNT_CUES) + (r() < 0.5 ? ':' : '')
        // 0-2 fillers between the count and its cue: the rule's reach is two tokens
        const between = Array.from({ length: Math.floor(r() * 3) }, () => pick(FILLER))
        const pair = r() < 0.5 ? [pick(COUNT_WORDS), ...between, cue] : [cue, ...between, pick(COUNT_WORDS)]
        words.splice(at, 0, ...pair)
      }
      out.push(...words)
    }
  }
  return { items, words: wordsOf(out.join(' ')) }
}

describe('treeParents on the English nested-enumeration fixtures (§6.10)', () => {
  it.each(NESTED)('$name gives its expected parent list exactly', ({ fixture }) => {
    expect(fixture.language).toBe('en')
    expect(fixture.parents).toHaveLength(fixture.items.length)
    // `words` is the stretch (§6.2): from the first item's first word, as the app will pass it;
    // each fixture's last word is its last item's, so the stretch runs to the end
    const first = claimToken(fixture.items[0].split(/\s+/)[0])
    const from = fixture.transcript.words.findIndex((w) => claimToken(w.text) === first)
    expect(from).toBeGreaterThan(0)
    const parents = treeParents(
      fixture.items.map((label) => ({ label })),
      fixture.title,
      fixture.transcript.words.slice(from)
    )
    expect(parents).toEqual(fixture.parents)
  })

  it('every fixture is a list the steps template can hold (minItems..maxItems)', () => {
    const steps = GRAPHIC_TEMPLATES.steps!
    for (const { name, fixture } of NESTED) {
      expect(fixture.items.length, name).toBeGreaterThanOrEqual(steps.minItems!)
      expect(fixture.items.length, name).toBeLessThanOrEqual(steps.maxItems!)
    }
  })

  it('every fixture nests somewhere, so a flat answer cannot pass it', () => {
    for (const { name, fixture } of NESTED) expect(fixture.parents.some((p) => p >= 0), name).toBe(true)
  })

  it('takes the case §6.2 names: "Plan, which has two parts: budget and timeline. Second, shoot"', () => {
    const words = wordsOf('Plan, which has two parts: budget and timeline. Second, shoot.')
    expect(treeParents([{ label: 'plan' }, { label: 'budget' }, { label: 'timeline' }, { label: 'shoot' }], '', words)).toEqual([
      -1, 0, 0, -1
    ])
  })

  it('takes a count two tokens from its cue, and not one three tokens away', () => {
    const labels = ['plan', 'budget', 'timeline', 'shoot'].map((label) => ({ label }))
    expect(treeParents(labels, '', wordsOf('Plan, which has two main parts: budget and timeline. Then shoot.'))).toEqual([
      -1, 0, 0, -1
    ])
    expect(
      treeParents(labels, '', wordsOf('Plan, which has two quite separate parts: budget and timeline. Then shoot.'))
    ).toEqual([-1, -1, -1, -1])
  })

  it('finds each run in spoken order, after the run before it', () => {
    // "lenses" is said before "shoot"; its own run is the one after the count
    const words = wordsOf('Plan around the lenses you own. Shoot, which needs two things: lenses and light.')
    expect(treeParents(['plan', 'shoot', 'lenses', 'light'].map((label) => ({ label })), '', words)).toEqual([
      -1, -1, 1, 1
    ])
  })

  it('ignores a child’s own count, so depth stays at most two', () => {
    const words = wordsOf('Plan, which has two parts: budget, which has three kinds of cost, timeline, shoot and edit.')
    const parents = treeParents(
      ['plan', 'budget', 'timeline', 'shoot', 'edit'].map((label) => ({ label })),
      '',
      words
    )
    expect(parents).toEqual([-1, 0, 0, -1, -1])
  })

  it('never makes a child of an item counted off by an ordinal (lane T4: nested-en-1 read with its ordinal items only)', () => {
    // nested-en-1's own words, with the three items the baseline finds: "two parts" is said after "plan", but the
    // next two items are counted off ("Second, the shoot itself", "Third, the edit"), so neither is the plan's part.
    const one = NESTED[0].fixture
    expect(treeParents(['plan', 'shoot itself', 'edit'].map((label) => ({ label })), '', one.transcript.words)).toEqual([-1, -1, -1])
    // "Step two" counts off as "Second" does, and so does an ordinal three tokens before the item.
    expect(treeParents(['plan', 'budget', 'timeline'].map((label) => ({ label })), '', wordsOf('Step one, the plan, in two parts. Step two, the budget. Step three, the timeline.'))).toEqual([-1, -1, -1])
    expect(treeParents(['light', 'flash', 'bounce'].map((label) => ({ label })), '', wordsOf('First, light, which has two kinds. The second way is flash. Then bounce.'))).toEqual([-1, -1, -1])
    // The parts said with no ordinal still nest, the counted-off item after them stays a sibling.
    expect(treeParents(['plan', 'budget', 'timeline', 'shoot itself', 'edit'].map((label) => ({ label })), '', one.transcript.words)).toEqual([-1, 0, 0, -1, -1])
  })

  it('nests nothing when the count is more than the items left', () => {
    const words = wordsOf('Plan, which has five parts: budget and timeline.')
    expect(treeParents([{ label: 'plan' }, { label: 'budget' }, { label: 'timeline' }], '', words)).toEqual([-1, -1, -1])
  })

  it('keeps every item under the title when no count is said (rule 1)', () => {
    const words = wordsOf('First, charge the batteries. Second, format the cards. Third, scout the venue.')
    expect(
      treeParents([{ label: 'charge the batteries' }, { label: 'format the cards' }, { label: 'scout the venue' }], '', words)
    ).toEqual([-1, -1, -1])
  })

  it('keeps a Hindi and a Telugu list flat (v1)', () => {
    const hi = wordsOf('पहला, योजना, जिसके दो हिस्से हैं: बजट और समय। दूसरा, शूट।')
    expect(treeParents(['योजना', 'बजट', 'समय', 'शूट'].map((label) => ({ label })), '', hi)).toEqual([-1, -1, -1, -1])
    const te = wordsOf('మొదటిది, ప్రణాళిక, దానికి రెండు భాగాలు: బడ్జెట్, సమయం. రెండవది, షూట్.')
    expect(treeParents(['ప్రణాళిక', 'బడ్జెట్', 'సమయం', 'షూట్'].map((label) => ({ label })), '', te)).toEqual([-1, -1, -1, -1])
    expect(claimToken('हिस्से:')).toBe('हिस्से')
  })

  it('reads a count in Devanagari digits as its number', () => {
    const words = wordsOf('Plan, which has २ parts: budget and timeline. Then shoot.')
    expect(treeParents(['plan', 'budget', 'timeline', 'shoot'].map((label) => ({ label })), '', words)).toEqual([-1, 0, 0, -1])
  })
})

describe('the tree’s property over generated item lists (§6.2)', () => {
  const SEEDS = Array.from({ length: 500 }, (_, i) => i + 1)

  it('gives every item a parent that points backwards, from one root, depth ≤ 2', () => {
    let nested = 0
    for (const seed of SEEDS) {
      const { items, words } = generated(seed)
      const parents = treeParents(items, 'title', words)
      expect(parents, `seed ${seed}`).toHaveLength(items.length)
      expect(oracle(parents), `seed ${seed}: ${JSON.stringify(parents)}`).toBe(true)
      expect(parentsValid(parents), `seed ${seed}`).toBe(true)
      for (let i = 0; i < parents.length; i++) {
        expect(parents[i] < i, `seed ${seed} item ${i}`).toBe(true)
        expect(depth(parents, i), `seed ${seed} item ${i}`).toBeLessThanOrEqual(2)
      }
      if (parents.some((p) => p >= 0)) nested++
    }
    // the generator must reach the rule it is testing
    expect(nested).toBeGreaterThan(SEEDS.length / 5)
  })

  it('parentsValid agrees with the rule over generated parent lists, forward and deep ones included', () => {
    let refused = 0
    for (const seed of SEEDS) {
      const r = rng(seed * 7919)
      const n = 1 + Math.floor(r() * 7)
      const parents = Array.from({ length: n }, () => Math.floor(r() * (n + 1)) - 1)
      expect(parentsValid(parents), `seed ${seed}: ${JSON.stringify(parents)}`).toBe(oracle(parents))
      if (!oracle(parents)) refused++
    }
    expect(refused).toBeGreaterThan(SEEDS.length / 5)
  })
})

describe('parentsValid (§6.2)', () => {
  it('accepts a flat list, and children of a root item', () => {
    expect(parentsValid([-1, -1, -1])).toBe(true)
    expect(parentsValid([-1, 0, 0, -1, 3])).toBe(true)
    expect(parentsValid([])).toBe(true)
  })

  it('refuses a forward parent and a self parent', () => {
    expect(parentsValid([1, -1])).toBe(false)
    expect(parentsValid([-1, 2, -1])).toBe(false)
    expect(parentsValid([-1, 1])).toBe(false)
  })

  it('refuses two levels below a child', () => {
    expect(parentsValid([-1, 0, 1])).toBe(false)
  })

  it('refuses a parent that is not an index', () => {
    expect(parentsValid([-1, 0.5])).toBe(false)
    expect(parentsValid([-2, -1])).toBe(false)
  })
})

describe('connectorFor, the app’s connector (§6.2)', () => {
  it('is tree when any parent is ≥ 0', () => {
    expect(connectorFor([-1, 0, 0])).toBe('tree')
    expect(connectorFor([-1, 0])).toBe('tree')
  })

  it('is line for three or more flat items and none for two', () => {
    expect(connectorFor([-1, -1, -1])).toBe('line')
    expect(connectorFor([-1, -1, -1, -1, -1, -1])).toBe('line')
    expect(connectorFor([-1, -1])).toBe('none')
  })

  it('gives each nested fixture a tree', () => {
    for (const { fixture } of NESTED) expect(connectorFor(fixture.parents)).toBe('tree')
  })
})

describe('claimToken, as the tree needs it (§6.7 rules 1-3)', () => {
  it('trims punctuation, lower-cases, keeps combining marks and maps native digits', () => {
    expect(claimToken('Parts:')).toBe('parts')
    expect(claimToken('“Budget,”')).toBe('budget')
    expect(claimToken('పెళ్లి')).toBe('పెళ్లి')
    expect(claimToken('शादी')).toBe('शादी')
    expect(claimToken('४०')).toBe('40')
    expect(claimToken('౩')).toBe('3')
    expect(claimToken('—')).toBe('')
  })

  it('composes to NFC, so a decomposed word meets its composed twin', () => {
    expect(claimToken('Café')).toBe(claimToken('Café'))
  })
})
