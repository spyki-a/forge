/**
 * A flat sum's TEXT, read back and evaluated the way ffmpeg's crop evaluates
 * it — for the tests of `src/shared/reframe/expression.ts` and `keys.ts`.
 *
 * Deliberately a parser of the string, not a call to `flatSumAt`: what the
 * export runs is the text, so a test that read the keys' numbers instead
 * would pass with a boundary written wrong. Each term must be exactly one of
 * the two measured shapes (EFFECTS.md §52), or this throws:
 *
 *     ±Δ*gte(t,B)
 *     ±Δ*(P)*(P)*(3-2*(P)),   P = min(1,max(0,(t∓T0)/SPAN))
 *
 * either all on the top level, or past `FLAT_GROUP` terms in groups,
 * `base+(t1…)+(…)`, each group added up from its first term and then to the
 * running value, as ffmpeg's parser builds the tree.
 *
 * `t` is formed as the crop forms it after `fps=`: frame × (1/fps).
 */

const NUMBER = String.raw`\d+(?:\.\d+)?`
const BASE = new RegExp(`^-?${NUMBER}`)
const HELD = new RegExp(String.raw`^([+-]${NUMBER})\*gte\(t,(-?\d+\.\d{6})\)`)
const P = String.raw`min\(1,max\(0,\(t([+-])(\d+\.\d{6})\)/(\d+\.\d{6})\)\)`
const SAME_P = String.raw`min\(1,max\(0,\(t\2\3\)/\4\)\)`
const PAN = new RegExp(String.raw`^([+-]${NUMBER})\*\(${P}\)\*\(${SAME_P}\)\*\(3-2\*\(${SAME_P}\)\)`)

export interface ParsedTerm {
  kind: 'held' | 'pan'
  /** Which parenthesised group it is in, when the sum is grouped. */
  group?: number
  delta: number
  /** held: the boundary; pan: its start */
  at: number
  span?: number
}

/** The base and each term, in the order written. Throws on anything else. */
export function parseFlatSum(expression: string): { base: number; terms: ParsedTerm[] } {
  const base = BASE.exec(expression)
  if (!base) throw new Error(`no base at the start of ${expression.slice(0, 40)}`)
  let rest = expression.slice(base[0].length)
  const terms: ParsedTerm[] = []
  let group: number | undefined
  let groups = 0
  while (rest.length > 0) {
    if (group === undefined && rest.startsWith('+(')) {
      group = groups++
      rest = rest.slice(2)
      continue
    }
    if (group !== undefined && rest.startsWith(')')) {
      group = undefined
      rest = rest.slice(1)
      continue
    }
    const held = HELD.exec(rest)
    if (held) {
      terms.push({ kind: 'held', delta: Number(held[1]), at: Number(held[2]), ...(group !== undefined ? { group } : {}) })
      rest = rest.slice(held[0].length)
      continue
    }
    const pan = PAN.exec(rest)
    if (pan) {
      // `t-0.5` starts at 0.5; `t+0.5` at −0.5.
      const t0 = pan[2] === '-' ? Number(pan[3]) : -Number(pan[3])
      terms.push({ kind: 'pan', delta: Number(pan[1]), at: t0, span: Number(pan[4]), ...(group !== undefined ? { group } : {}) })
      rest = rest.slice(pan[0].length)
      continue
    }
    throw new Error(`not a flat-sum term: ${rest.slice(0, 60)}`)
  }
  if (group !== undefined) throw new Error('a group is not closed')
  return { base: Number(base[0]), terms }
}

/** The expression's raw value at a frame — before the crop's clamp and its lrint & ~1. */
export function evaluateFlatSum(expression: string, frame: number, fps: number): number {
  const { base, terms } = parseFlatSum(expression)
  const t = frame * (1 / fps)
  const of = (term: ParsedTerm): number => {
    if (term.kind === 'held') return term.delta * (t >= term.at ? 1 : 0)
    const p = Math.min(1, Math.max(0, (t - term.at) / term.span!))
    return term.delta * p * p * (3 - 2 * p)
  }
  let value = base
  for (let i = 0; i < terms.length; ) {
    const g = terms[i].group
    if (g === undefined) {
      value += of(terms[i++])
      continue
    }
    // A group: its own sum from its first term, then added once.
    let sum = of(terms[i++])
    while (i < terms.length && terms[i].group === g) sum += of(terms[i++])
    value += sum
  }
  return value
}

/**
 * The longest chain of additions at any one level of parentheses — how deep
 * ffmpeg's evaluator recurses on the sum (its tree for `a+b+c…` is a chain).
 * A `+` or `-` straight after `(` or `,` is a sign, not a link.
 */
export function longestChain(expression: string): number {
  const links: number[] = [0]
  let most = 0
  let prev = ''
  for (const ch of expression) {
    if (ch === '(') links.push(0)
    else if (ch === ')') most = Math.max(most, links.pop()!)
    else if ((ch === '+' || ch === '-') && prev !== '(' && prev !== ',' && prev !== '') links[links.length - 1]++
    prev = ch
  }
  return Math.max(most, links[0])
}

/** How deep the parentheses go: a nested `if` grows with every key, a flat sum does not. */
export function parenDepth(expression: string): number {
  let depth = 0
  let most = 0
  for (const ch of expression) {
    if (ch === '(') most = Math.max(most, ++depth)
    else if (ch === ')') depth--
  }
  return most
}
