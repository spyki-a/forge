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
  while (rest.length > 0) {
    const held = HELD.exec(rest)
    if (held) {
      terms.push({ kind: 'held', delta: Number(held[1]), at: Number(held[2]) })
      rest = rest.slice(held[0].length)
      continue
    }
    const pan = PAN.exec(rest)
    if (pan) {
      // `t-0.5` starts at 0.5; `t+0.5` at −0.5.
      const t0 = pan[2] === '-' ? Number(pan[3]) : -Number(pan[3])
      terms.push({ kind: 'pan', delta: Number(pan[1]), at: t0, span: Number(pan[4]) })
      rest = rest.slice(pan[0].length)
      continue
    }
    throw new Error(`not a flat-sum term: ${rest.slice(0, 60)}`)
  }
  return { base: Number(base[0]), terms }
}

/** The expression's raw value at a frame — before the crop's clamp and its lrint & ~1. */
export function evaluateFlatSum(expression: string, frame: number, fps: number): number {
  const { base, terms } = parseFlatSum(expression)
  const t = frame * (1 / fps)
  let value = base
  for (const term of terms) {
    if (term.kind === 'held') value += term.delta * (t >= term.at ? 1 : 0)
    else {
      const p = Math.min(1, Math.max(0, (t - term.at) / term.span!))
      value += term.delta * p * p * (3 - 2 * p)
    }
  }
  return value
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
