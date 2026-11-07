/**
 * A drawn number's in-between values and its size (docs/CLIPS.md §6.2,
 * "graphics/numbers.ts"). The only place a template formats a number.
 *
 * `inBetween` reads the value's own format off the value as written: what
 * stands before the number (a currency sign, a minus), its grouping (western
 * 3-3, Indian 3-2-2, or none), its decimal places, its digit script, and what
 * stands after it (`%`, `k`, ` million`, ` lakh`, ` percent` …). It writes
 * the in-between number back in exactly that format, so "10,00,000" counts
 * through "9,50,000", never "950,000", and "४०%" stays Devanagari. Nothing
 * here calls `toLocaleString`: the style has no number format of its own
 * (§6.5), and the value is the only format there is.
 *
 * Pure and node-runnable; the renderer imports it through the drawers.
 */

/**
 * The zero of each digit block a value may be written in: ASCII and the
 * blocks §6.7 rule 3 lists (Devanagari, Bengali, Gurmukhi, Gujarati, Tamil,
 * Telugu, Kannada, Malayalam, Arabic-Indic and Extended Arabic-Indic).
 */
const DIGIT_ZEROS = [0x30, 0x966, 0x9e6, 0xa66, 0xae6, 0xbe6, 0xc66, 0xce6, 0xd66, 0x660, 0x6f0] as const

/** The block's zero for one character, or null when it is not a digit of any listed block. */
function zeroOf(ch: string): number | null {
  const c = ch.codePointAt(0)
  if (c === undefined) return null
  for (const z of DIGIT_ZEROS) if (c >= z && c <= z + 9) return z
  return null
}

function isDigit(ch: string): boolean {
  return zeroOf(ch) !== null
}

type Grouping = 'none' | 'western' | 'indian'

/** A value's one number, read in its own format. */
interface Parsed {
  prefix: string
  suffix: string
  /** The digit block's zero (0x30 for ASCII). */
  zero: number
  grouping: Grouping
  decimals: number
  /** The number's digits as an integer, decimals included: "1,234.50" → 123450. */
  scaled: number
}

/**
 * Read the value's single number. Null when it has no digits, two numbers
 * ("1,000-2,000", "40 to 50"), digits from two scripts, or a grouping that is
 * neither western nor Indian ("1,0", which may be a decimal comma).
 */
function parse(value: string): Parsed | null {
  const chars = Array.from(value)
  const first = chars.findIndex(isDigit)
  if (first < 0) return null
  const zero = zeroOf(chars[first])!

  // The number runs over digits of one block, commas between digits, and one
  // point followed by a digit.
  let end = first
  let sawPoint = false
  while (end < chars.length) {
    const ch = chars[end]
    if (zeroOf(ch) === zero) {
      end++
      continue
    }
    const next = chars[end + 1]
    const nextIsSame = next !== undefined && zeroOf(next) === zero
    if (ch === ',' && !sawPoint && nextIsSame) {
      end++
      continue
    }
    if (ch === '.' && !sawPoint && nextIsSame) {
      sawPoint = true
      end++
      continue
    }
    break
  }
  // A second number, or a digit of another block, after this one: no single value.
  if (chars.slice(end).some(isDigit)) return null

  const body = chars.slice(first, end).join('')
  const [intPart, decPart = ''] = body.split('.')
  const groups = intPart.split(',')
  let grouping: Grouping = 'none'
  if (groups.length > 1) {
    const last = groups[groups.length - 1]
    const lead = groups[0]
    const middle = groups.slice(1, -1)
    if (Array.from(last).length !== 3 || Array.from(lead).length > 3) return null
    if (middle.every((g) => Array.from(g).length === 3)) grouping = 'western'
    else if (middle.every((g) => Array.from(g).length === 2) && Array.from(lead).length <= 2) grouping = 'indian'
    else return null
  }

  const digits = Array.from(groups.join('') + decPart)
  let scaled = 0
  for (const d of digits) scaled = scaled * 10 + (d.codePointAt(0)! - zero)

  return {
    prefix: chars.slice(0, first).join(''),
    suffix: chars.slice(end).join(''),
    zero,
    grouping,
    decimals: Array.from(decPart).length,
    scaled
  }
}

/** Insert the grouping's separators into an ASCII digit run. */
function group(intDigits: string, grouping: Grouping): string {
  if (grouping === 'none' || intDigits.length <= 3) return intDigits
  const last = intDigits.slice(-3)
  let rest = intDigits.slice(0, -3)
  const size = grouping === 'western' ? 3 : 2
  const parts: string[] = []
  while (rest.length > size) {
    parts.unshift(rest.slice(-size))
    rest = rest.slice(0, -size)
  }
  if (rest) parts.unshift(rest)
  return [...parts, last].join(',')
}

/**
 * The value at `fraction` of the way from 0, in the value's own format
 * (docs/CLIPS.md §6.2). At `fraction` ≥ 1, `value` itself, unchanged. A
 * value with no in-between (no digits, or two numbers) is returned whole at
 * every fraction, fraction 0 included: it appears whole on its beat.
 *
 * The seam for the drawers (counter, ring, bars): inBetween does not hold
 * such a value back before its beat. A drawer that shows inBetween(value, p)
 * over the lead tests `numberOf(value) === null` and draws nothing until the
 * beat, so the value is "whole on its beat" (§6.2), not from t = 0.
 */
export function inBetween(value: string, fraction: number): string {
  if (fraction >= 1) return value
  const p = parse(value)
  if (!p) return value
  const f = Number.isFinite(fraction) && fraction > 0 ? fraction : 0
  const n = Math.round(p.scaled * f)
  const ascii = String(n).padStart(p.decimals + 1, '0')
  const intDigits = p.decimals > 0 ? ascii.slice(0, -p.decimals) : ascii
  const decDigits = p.decimals > 0 ? ascii.slice(-p.decimals) : ''
  const written = group(intDigits, p.grouping) + (decDigits ? `.${decDigits}` : '')
  const script = Array.from(written)
    .map((ch) => (ch >= '0' && ch <= '9' ? String.fromCodePoint(p.zero + (ch.charCodeAt(0) - 48)) : ch))
    .join('')
  return p.prefix + script + p.suffix
}

/** The suffix words that multiply a number (§6.7 rule 4's list), as a bar's size needs them. */
const MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mn: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  lakh: 1e5,
  lakhs: 1e5,
  crore: 1e7,
  crores: 1e7
}

/**
 * The value's size, for a bar's length or a ring's sweep (docs/CLIPS.md
 * §6.2): its one number with grouping removed, decimals kept, the script read
 * as digits, a minus before it applied and an English multiplier after it
 * (`k`, `million`, `lakh` …) applied. Null when the value has no in-between.
 */
export function numberOf(value: string): number | null {
  const p = parse(value)
  if (!p) return null
  let n = p.scaled / 10 ** p.decimals
  if (p.prefix.includes('-') || p.prefix.includes('−')) n = -n
  const word = p.suffix.trim().toLowerCase().split(/\s+/)[0] ?? ''
  const multiplier = MULTIPLIERS[word]
  return multiplier ? n * multiplier : n
}
