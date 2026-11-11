/**
 * The graphics validator's normaliser (docs/CLIPS.md §6.7, "The normaliser").
 *
 * `claimToken` (rules 1-3 on one token, which `graphics/tree.ts` also reads
 * to find each step's run in the spoken words), `claimTokens` (rule 2's unit
 * split before it), `numbersIn` (rule 4: every number in a run of tokens as
 * `{n, unit, currency?}`), and the lists rules 6-8 name (`BIND_WINDOW`,
 * `NEGATORS`, `FUNCTION_WORDS_EN`). The claims and the binding (`claimsOf`,
 * `bind`) are the second half of lane T2a. Named apart from `automation/keywords.ts`'s `normaliseToken`, which
 * is ASCII-only and maps Hindi and Telugu to '' (§6.7), and from
 * `director/validate.ts`'s `normalise`, which drops final combining marks.
 *
 * Pure and node-runnable.
 */

import { MULTIPLIERS, groupingOf } from '../graphics/numbers'

/** The zero of each native digit block §6.7 rule 3 maps to ASCII. */
const NATIVE_ZEROS = [0x966, 0x9e6, 0xa66, 0xae6, 0xbe6, 0xc66, 0xce6, 0xd66, 0x660, 0x6f0] as const

/** Leading and trailing characters outside letters, marks and numbers. */
const EDGES = /^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu

/**
 * One word as the validator compares it (§6.7 rules 1-3): NFC, lower case
 * (locale-independent), leading and trailing characters outside
 * `[\p{L}\p{M}\p{N}]` trimmed with combining marks kept, and native digits
 * mapped to ASCII by block offset. 'పెళ్లి' stays 'పెళ్లి', 'शादी' stays
 * 'शादी', 'Parts:' is 'parts', '४०' is '40'. A word of punctuation alone is ''.
 */
export function claimToken(word: string): string {
  const trimmed = word.normalize('NFC').toLowerCase().replace(EDGES, '')
  let out = ''
  for (const ch of trimmed) {
    const c = ch.codePointAt(0)!
    const zero = NATIVE_ZEROS.find((z) => c >= z && c <= z + 9)
    out += zero === undefined ? ch : String.fromCharCode(48 + c - zero)
  }
  return out
}

// ---------------------------------------------------------------------------
// Rule 2's unit split.

/** The currency signs §6.7 rule 4 reads, as `CanonNumber.currency` holds them. */
export type Currency = '$' | '€' | '£' | '₹'

const CURRENCY_SIGNS: readonly string[] = ['$', '€', '£', '₹']

/** The minus a spoken number may carry, kept as its own token (see `claimTokens`). */
const MINUS = '−'

/**
 * Leading and trailing characters outside letters, marks, numbers, the
 * currency signs and `%`; a leading run stops at a minus directly before a
 * digit or a currency sign and a digit.
 */
const UNIT_EDGES = /^(?:(?![-−][$€£₹]?\p{N})[^\p{L}\p{M}\p{N}$€£₹%])+|[^\p{L}\p{M}\p{N}$€£₹%]+$/gu

/**
 * One spoken word as the validator's tokens (§6.7 rule 2): a leading currency
 * sign and a trailing `%` are split off FIRST as unit tokens, then each part
 * goes through `claimToken`. '$40' → ['$', '40'], '40%.' → ['40', '%'],
 * '(₹40,000)' → ['₹', '40,000'], '%' → ['%'], 'Parts:' → ['parts'], '—' → [].
 *
 * Beyond rule 2's words: a minus directly before the digits ('-5%', '$-5',
 * '-$5', '−5') is split off as the token '−' rather than trimmed away, so `numbersIn`
 * reads −5, not 5: trimming it would let a drawn "5%" ground on a spoken
 * "-5%". A hyphen before a letter is trimmed as rule 2 says.
 */
export function claimTokens(word: string): string[] {
  let rest = word.normalize('NFC').toLowerCase().replace(UNIT_EDGES, '')
  const head: string[] = []
  const tail: string[] = []
  let negative = false
  const lead = /^[-−](?=[$€£₹])/u.exec(rest)
  if (lead) {
    negative = true
    rest = rest.slice(lead[0].length)
  }
  const first = Array.from(rest)[0]
  if (first !== undefined && CURRENCY_SIGNS.includes(first)) {
    head.push(first)
    rest = rest.slice(first.length)
  }
  const minus = /^[-−](?=\p{N})/u.exec(rest)
  if (minus) {
    negative = true
    rest = rest.slice(minus[0].length)
  }
  if (negative) head.push(MINUS)
  if (rest.endsWith('%')) {
    tail.push('%')
    rest = rest.replace(/%+$/u, '')
  }
  const body = claimToken(rest)
  return [...head, ...(body ? [body] : []), ...tail]
}

/** Every token of a phrase, words split on white space (a spec's value or label, a transcript's run). */
export function claimTokensOf(text: string): string[] {
  return text.split(/\s+/u).filter(Boolean).flatMap(claimTokens)
}

// ---------------------------------------------------------------------------
// Rule 4: a number is canonical {n, unit, currency?}.

/** A number as the validator compares it (§6.7 rule 4). */
export interface CanonNumber {
  n: number
  unit: '' | '%' | 'currency'
  currency?: Currency
}

/** English number words, zero to nineteen (§6.7 rule 4). Hindi and Telugu are not parsed in v1. */
const SMALL: ReadonlyMap<string, number> = new Map(
  ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'].map((w, n) => [w, n])
)

/** The English tens (§6.7 rule 4). */
const TENS: ReadonlyMap<string, number> = new Map(
  ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'].map((w, i) => [w, 20 + 10 * i])
)

/** The currency words of rule 4, each to its sign. */
const CURRENCY_WORDS: ReadonlyMap<string, Currency> = new Map([
  ['dollar', '$'], ['dollars', '$'],
  ['rupee', '₹'], ['rupees', '₹'], ['rs', '₹'],
  ['euro', '€'], ['euros', '€'],
  ['pound', '£'], ['pounds', '£']
])

/**
 * The multipliers that may follow a number as their own word. The short
 * suffixes (`k`, `m`, `mn`, `b`, `bn`) count only when written ON the digits
 * ('1.2m', '4k'): as a word of their own they are letters, not multipliers.
 */
const MULTIPLIER_WORDS: readonly string[] = ['thousand', 'million', 'billion', 'lakh', 'lakhs', 'crore', 'crores']
const SUFFIXES: readonly string[] = ['k', 'm', 'mn', 'b', 'bn']

/** A token of ASCII digits: optional comma groups, an optional decimal part, an optional short suffix. */
const DIGITS = /^(\d+(?:,\d+)*)(?:\.(\d+))?([a-z]*)$/u

/** A digit token's value, or null when it is not one number (a bad grouping, an unknown suffix). */
function digitValue(token: string): number | null {
  const m = DIGITS.exec(token)
  if (!m) return null
  const [, int, dec = '', suffix] = m
  if (groupingOf(int.split(',')) === null) return null
  if (suffix && !SUFFIXES.includes(suffix)) return null
  const n = Number(int.replace(/,/gu, '') + (dec ? `.${dec}` : ''))
  return suffix ? n * MULTIPLIERS[suffix] : n
}

function isNumberWord(t: string): boolean {
  return SMALL.has(t) || TENS.has(t)
}

/** One sub-thousand group of number words from `i`: 'forty two', 'two hundred and five', 'a hundred'. */
function wordGroup(ts: readonly string[], i: number): { n: number; next: number } | null {
  let n: number
  let j = i
  if (ts[j] === 'a' && ts[j + 1] === 'hundred') {
    n = 1
    j += 1
  } else if (TENS.has(ts[j])) {
    n = TENS.get(ts[j++])!
    const unit = SMALL.get(ts[j])
    if (unit !== undefined && unit >= 1 && unit <= 9) {
      n += unit
      j += 1
    }
  } else if (SMALL.has(ts[j])) {
    n = SMALL.get(ts[j++])!
  } else return null
  if (ts[j] === 'hundred' && n >= 1 && n <= 99) {
    n *= 100
    j += 1
    // 'two hundred and five', 'two hundred five'
    const k = ts[j] === 'and' && ts[j + 1] !== undefined && isNumberWord(ts[j + 1]) ? j + 1 : j
    if (ts[k] !== undefined && isNumberWord(ts[k]) && ts[k] !== 'zero') {
      const rest = wordGroup(ts, k)
      if (rest && rest.n < 100) {
        n += rest.n
        j = rest.next
      }
    }
  }
  return { n, next: j }
}

/**
 * Every number in a run of tokens (§6.7 rule 4), each with the token index it
 * starts at. The tokens are `claimTokens`' (already through `claimToken`:
 * NFC, lower case, ASCII digits, the unit signs split off); `numbersIn` does
 * not normalise them again.
 *
 * A number is: an optional currency sign (`$ € £ ₹`) or `rs`; an optional
 * minus (`claimTokens`' '−'); then digits (thousands separators removed in
 * western and Indian grouping, the decimal point kept, an attached `k`, `m`,
 * `mn`, `b`, `bn` applied) or English number words (zero to nineteen, the
 * tens, hyphenated or spaced, `hundred`, `thousand`, `a hundred`); then at
 * most one multiplier word (`thousand`, `million`, `billion`, `lakh`,
 * `crore`); then at most one unit: `%`, `percent`, `per cent`, or a currency
 * word (`dollar(s)`, `rupee(s)`, `rs`, `euro(s)`, `pound(s)`). `at` is the
 * index of the number's first token after any sign: the digits, or the first
 * number word ('a' of 'a hundred').
 *
 * Not parsed, so a claim written for them is dropped by the binding (the
 * safe direction, §6.7 rule 4): Hindi and Telugu number words, ordinals
 * ('1st', 'first'), a decimal comma ('1,5'), ranges ('40-50'), 'minus' as a
 * word, and a digit run followed by 'hundred'.
 */
export function numbersIn(tokens: readonly string[]): { value: CanonNumber; at: number }[] {
  // Hyphenated number words ('forty-two') become their parts, each keeping its token's index.
  const ts: string[] = []
  const index: number[] = []
  tokens.forEach((t, i) => {
    const parts = t.split('-')
    const words = parts.length > 1 && parts.every(isNumberWord) ? parts : [t]
    for (const w of words) {
      ts.push(w)
      index.push(i)
    }
  })

  const out: { value: CanonNumber; at: number }[] = []
  let i = 0
  while (i < ts.length) {
    let j = i
    let currency: Currency | undefined
    if (CURRENCY_SIGNS.includes(ts[j]) || ts[j] === 'rs') {
      currency = ts[j] === 'rs' ? '₹' : (ts[j] as Currency)
      j += 1
    }
    let sign = 1
    if (ts[j] === MINUS) {
      sign = -1
      j += 1
    }
    const start = j
    let n: number | null = digitValue(ts[j] ?? '')
    if (n !== null) j += 1
    else {
      const g = wordGroup(ts, j)
      if (g) {
        n = g.n
        j = g.next
        if (ts[j] === 'thousand') {
          n *= 1000
          j += 1
          const after = isNumberWord(ts[j] ?? '') ? wordGroup(ts, j) : null
          if (after && after.n < 1000) {
            n += after.n
            j = after.next
          }
        }
      }
    }
    if (n === null) {
      i += 1
      continue
    }
    if (MULTIPLIER_WORDS.includes(ts[j] ?? '')) {
      n *= MULTIPLIERS[ts[j]]
      j += 1
    }
    let unit: CanonNumber['unit'] = currency ? 'currency' : ''
    if (ts[j] === '%' || ts[j] === 'percent') {
      if (!currency) unit = '%'
      j += 1
    } else if (ts[j] === 'per' && ts[j + 1] === 'cent') {
      if (!currency) unit = '%'
      j += 2
    } else if (!currency && CURRENCY_WORDS.has(ts[j])) {
      currency = CURRENCY_WORDS.get(ts[j])
      unit = 'currency'
      j += 1
    }
    out.push({ value: currency ? { n: sign * n, unit, currency } : { n: sign * n, unit }, at: index[start] })
    i = j
  }
  return out
}

// ---------------------------------------------------------------------------
// The lists rules 6-8 name.

/** Rule 6: a label's content tokens sit within this many tokens of its value's occurrence. Set by the eval. */
export const BIND_WINDOW = 8

/**
 * Rule 7's negators, exactly as §6.7 lists them. Telugu mostly negates with a
 * verb ending, which no word list catches (rule 7's second bullet: the eval's
 * fixtures collect the suffixes; none are collected yet, so none are here).
 */
export const NEGATORS: Readonly<Record<'en' | 'hi' | 'te', readonly string[]>> = {
  en: ['not', 'no', 'never', "n't", 'without', 'nor', 'neither', 'none', 'nobody', 'nothing'],
  hi: ['नहीं', 'न', 'मत'],
  te: ['కాదు', 'లేదు']
}

/**
 * Rule 8's English function words, exempt from grounding: the 40 of §6.7 as
 * written. It holds no negator, direction word or comparative (rule 8's
 * "never exempt"); tests/claims.test.ts checks that by membership. No list
 * exists for Hindi or Telugu, so every token there is checked.
 */
export const FUNCTION_WORDS_EN: readonly string[] = [
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'for', 'from',
  'by', 'with', 'and', 'or', 'but', 'so', 'as', 'is', 'are', 'was',
  'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those', 'our',
  'my', 'your', 'their', 'we', 'i', 'you', 'they', 'he', 'she', 'have'
]
