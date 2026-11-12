/**
 * The graphics validator's normaliser (docs/CLIPS.md §6.7, "The normaliser").
 *
 * `claimToken` (rules 1-3 on one token, which `graphics/tree.ts` also reads
 * to find each step's run in the spoken words), `claimTokens` (rule 2's unit
 * split before it), `numbersIn` (rule 4: every number in a run of tokens as
 * `{n, unit, currency?}`), and the lists rules 6-8 name (`BIND_WINDOW`,
 * `NEGATORS`, `FUNCTION_WORDS_EN`), then a graphic's claims (`claimsOf`) and
 * their binding to the stretch (`bind`, rules 5-8; `clauseAt` for rule 7's
 * clause). Rule 9's template rules over the bound result are
 * `validateGraphics.ts`'s. Named apart from `automation/keywords.ts`'s `normaliseToken`, which
 * is ASCII-only and maps Hindi and Telugu to '' (§6.7), and from
 * `director/validate.ts`'s `normalise`, which drops final combining marks.
 *
 * Pure and node-runnable.
 */

import { MULTIPLIERS, groupingOf } from '../graphics/numbers'
import type { FieldMode, GraphicData, TemplateDef } from '../graphics/template'
import type { Segment, Word } from '../transcript'

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
 * The token `claimTokens` puts where a word's own punctuation ended or began a
 * clause or a sentence (`, ; : — – . ! ? । ॥ …`), so `numbersIn` never joins
 * number words across it ('forty, two of them' is 40 and 2, never 42), and
 * rule 7's clause has an edge to stop at. `claimToken` trims every
 * character outside letters, marks and numbers, so no spoken word is ever
 * this token.
 */
export const CLAUSE_BREAK = ','

const BREAK_CHARS = /[,;:—–.!?।॥…]/u

/**
 * The leading characters a spoken word sheds: outside letters, marks,
 * numbers, the currency signs and `%`, stopping at a minus (hyphen-minus,
 * U+2212 or an en dash U+2013) or a decimal point that stands directly
 * before the digits (or before a currency sign and the digits).
 */
const LEAD_EDGE = /^(?:(?![-−–]?[$€£₹]?[-−–]?\.?\p{N})[^\p{L}\p{M}\p{N}$€£₹%])+/u

/** The trailing characters a spoken word sheds: outside letters, marks, numbers, the currency signs and `%`. */
const TRAIL_EDGE = /[^\p{L}\p{M}\p{N}$€£₹%]+$/u

/** The digit blocks a token holds (ASCII and rule 3's ten), by each block's zero. */
function digitBlocks(text: string): Set<number> {
  const blocks = new Set<number>()
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if (c >= 0x30 && c <= 0x39) blocks.add(0x30)
    for (const z of NATIVE_ZEROS) if (c >= z && c <= z + 9) blocks.add(z)
  }
  return blocks
}

/**
 * One spoken word as the validator's tokens (§6.7 rule 2): a leading currency
 * sign and a trailing `%` are split off FIRST as unit tokens, then each part
 * goes through `claimToken`. '$40' → ['$', '40'], '40%' → ['40', '%'],
 * '(₹40,000)' → ['₹', '40,000'], '%' → ['%'], 'Parts' → ['parts'].
 *
 * Beyond rule 2's words, each so a number is never read as another value:
 * - a minus directly before the digits ('-5%', '$-5', '-$5', '−5', '–5')
 *   is split off as the token '−' rather than trimmed away, so `numbersIn`
 *   reads −5, not 5: trimmed, a drawn "5%" would ground on a spoken "-5%".
 *   A hyphen before a letter is trimmed as rule 2 says;
 * - a decimal point directly before the digits stays on them ('.5%' →
 *   ['.5', '%']), and `numbersIn` reads no number from it: trimmed, '.5%'
 *   would be read as 5%. `numbers.ts`' `numberOf` refuses it too;
 * - a TRAILING currency sign ('40€') stays on the digits ('40€'), which
 *   `numbersIn` reads as no number: rule 2 splits only a leading sign, and
 *   trimmed, '40€' would be a bare 40;
 * - digits from two blocks in one word ('4०') are not mapped to ASCII, so
 *   `numbersIn` reads no number, as `numberOf` reads none ('digits from two
 *   scripts');
 * - a clause or sentence mark in the punctuation the word sheds becomes a
 *   `CLAUSE_BREAK` token on that side ('forty,' → ['forty', ',']; '—' →
 *   [',']), except the point of the currency word 'Rs.' ('Rs. 500' is ₹500).
 */
export function claimTokens(word: string): string[] {
  const nfc = word.normalize('NFC').toLowerCase()
  const lead = LEAD_EDGE.exec(nfc)?.[0] ?? ''
  let rest = nfc.slice(lead.length)
  const trail = TRAIL_EDGE.exec(rest)?.[0] ?? ''
  rest = rest.slice(0, rest.length - trail.length)
  const head: string[] = BREAK_CHARS.test(lead) ? [CLAUSE_BREAK] : []
  const tail: string[] = []
  let negative = false
  const signLead = /^[-−–](?=[$€£₹])/u.exec(rest)
  if (signLead) {
    negative = true
    rest = rest.slice(signLead[0].length)
  }
  const first = Array.from(rest)[0]
  if (first !== undefined && CURRENCY_SIGNS.includes(first)) {
    head.push(first)
    rest = rest.slice(first.length)
  }
  const minus = /^[-−–](?=\.?\p{N})/u.exec(rest)
  if (minus) {
    negative = true
    rest = rest.slice(minus[0].length)
  }
  if (negative) head.push(MINUS)
  if (rest.endsWith('%')) {
    tail.push('%')
    rest = rest.replace(/%+$/u, '')
  }
  let body: string
  const point = /^\.(?=\p{N})/u.test(rest)
  const last = Array.from(rest).pop()
  const signTail = last !== undefined && CURRENCY_SIGNS.includes(last) && /\p{N}/u.test(rest)
  if (digitBlocks(rest).size > 1) body = rest.replace(EDGES, '')
  else body = claimToken(signTail ? rest.slice(0, -last.length) : rest)
  if (body && signTail) body += last
  if (body && point) body = `.${body}`
  const breakAfter = BREAK_CHARS.test(trail) && !(body === 'rs' && trail === '.' && tail.length === 0)
  return [...head, ...(body ? [body] : []), ...tail, ...(breakAfter ? [CLAUSE_BREAK] : [])]
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

/**
 * Words that scale a number which `numbersIn` does not apply: after a number
 * (and after its one multiplier word) any of these, or a second multiplier
 * word, makes that number NO number, never the bare digits at the wrong
 * magnitude ('5 hundred' is not 5, '₹40 lakh crore' is not ₹40 lakh,
 * '40 हज़ार' is not 40). The short suffixes standing alone are here too
 * ('$5 m', 'plan 4 b'): a letter or a multiplier, the validator cannot tell.
 * The Hindi and Telugu scale words are listed so a digit said before one is
 * dropped, as rule 4 drops their number words; held in `claimToken`'s form.
 */
const UNREAD_SCALES: ReadonlySet<string> = new Set(
  [
    'hundred', 'hundreds', 'thousands', 'millions', 'billions', 'trillion', 'trillions', 'dozen', 'dozens',
    'grand', ...SUFFIXES,
    'सौ', 'हज़ार', 'हजार', 'हज़ारों', 'हजारों', 'लाख', 'लाखों', 'करोड़', 'करोड़ों', 'अरब', 'खरब',
    'వంద', 'వందల', 'వందలు', 'వేయి', 'వెయ్యి', 'వేల', 'వేలు', 'లక్ష', 'లక్షల', 'లక్షలు', 'కోటి', 'కోట్ల', 'కోట్లు'
  ].map(claimToken)
)

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

/** 'forty-two': a ten and a unit (1-9), the only hyphenated number words read ('fifty-fifty' is none). */
function hyphenParts(t: string): string[] | null {
  const parts = t.split('-')
  if (parts.length !== 2 || !TENS.has(parts[0])) return null
  const unit = SMALL.get(parts[1])
  return unit !== undefined && unit >= 1 && unit <= 9 ? parts : null
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
 * NFC, lower case, ASCII digits, the unit signs split off, `CLAUSE_BREAK`
 * where a clause or sentence mark stood); `numbersIn` does not normalise them
 * again, and no number runs across a `CLAUSE_BREAK`.
 *
 * A number is: an optional `minus` or `negative`; an optional currency sign
 * (`$ € £ ₹`) or `rs`; an optional minus (`claimTokens`' '−'); then digits
 * (thousands separators removed in western and Indian grouping, the decimal
 * point kept, an attached `k`, `m`, `mn`, `b`, `bn` applied) or English number
 * words (zero to nineteen, the tens, `forty-two` or `forty two`, `hundred`,
 * `thousand`, `a hundred`); then at most one multiplier word (`thousand`,
 * `million`, `billion`, `lakh`, `crore`); then at most one unit: `%`,
 * `percent`, `per cent`, or a currency word (`dollar(s)`, `rupee(s)`, `rs`,
 * `euro(s)`, `pound(s)`). `at` is the index of the number's first token after
 * any sign: the digits, or the first number word ('a' of 'a hundred').
 *
 * Read as NO number (the whole span skipped), because any reading of it could
 * be a value the speaker did not say: a number followed by a scale word it
 * does not apply or by a second multiplier (`UNREAD_SCALES`); a number next
 * to `point` on either side ('one point two million' is neither 1 nor 2
 * million); a currency number followed by a percent ('$40%'), or by another
 * currency's word ('$40 rupees'); a number followed by a fraction ('two and
 * a half million', 'three quarters', '2 and one third'); two numbers next to
 * each other, both of them ('nineteen ninety nine' is neither 19 nor 99,
 * 'twenty twenty one' neither 20 nor 21); two numbers joined as a range or a
 * ratio by 'to', 'or', 'in', 'of' or 'out of', or as 'between X and Y', both
 * of them ('40 to 50 clients' is not 40 clients, '1 in 4 couples' is not 4
 * couples; so '300 in 2019' is dropped too, the safe direction); a number
 * with a qualifier directly before it (`QUALIFIERS`: 'almost 40', 'up to 40',
 * 'fewer than 40%').
 *
 * Not parsed, so a claim written for them is dropped by the binding (the
 * safe direction, §6.7 rule 4): Hindi and Telugu number words, ordinals
 * ('1st', 'first'), a decimal comma ('1,5'), ranges written '40-50', 'a
 * thousand' and 'a million' (only 'a hundred' is read).
 */
export function numbersIn(tokens: readonly string[]): { value: CanonNumber; at: number }[] {
  return numberSpans(tokens).map(({ value, at }) => ({ value, at }))
}

/**
 * `numbersIn`'s numbers with each one's whole span: `from` the index of its
 * first token (a sign or a currency included), `end` one past its last (a
 * multiplier or a unit included). `bind` needs the span so no other claim can
 * bind a token of a bound number, and `claimsOf` so a value field is one
 * number and nothing else. Exported for `baselineGraphics` (§6.10), which
 * reads its numbers here rather than with a second reader.
 */
export function numberSpans(tokens: readonly string[]): { value: CanonNumber; at: number; from: number; end: number }[] {
  // A hyphenated ten and unit ('forty-two') becomes its parts, each keeping its token's index.
  const ts: string[] = []
  const index: number[] = []
  tokens.forEach((t, i) => {
    for (const w of hyphenParts(t) ?? [t]) {
      ts.push(w)
      index.push(i)
    }
  })

  const out: { value: CanonNumber; at: number; from: number; end: number; tsFrom: number; tsEnd: number }[] = []
  let i = 0
  while (i < ts.length) {
    let j = i
    let sign = 1
    if (ts[j] === 'minus' || ts[j] === 'negative') {
      sign = -1
      j += 1
    }
    let currency: Currency | undefined
    if (CURRENCY_SIGNS.includes(ts[j]) || ts[j] === 'rs') {
      currency = ts[j] === 'rs' ? '₹' : (ts[j] as Currency)
      j += 1
    }
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
    // A fraction after the number ('two and a half', 'three quarters'): no number, its tail skipped.
    let frac = fractionAt(ts, j)
    if (frac > 0) {
      i = j + frac
      continue
    }
    if (MULTIPLIER_WORDS.includes(ts[j] ?? '')) {
      n *= MULTIPLIERS[ts[j]]
      j += 1
    }
    frac = fractionAt(ts, j)
    if (frac > 0) {
      i = j + frac
      continue
    }
    // A scale word not applied, a second multiplier, or 'point' after the number:
    // the span, that word included, is no number.
    if (ts[j] === 'point' || UNREAD_SCALES.has(ts[j] ?? '') || MULTIPLIER_WORDS.includes(ts[j] ?? '')) {
      i = j + 1
      continue
    }
    let unread = ts[i - 1] === 'point'
    let unit: CanonNumber['unit'] = currency ? 'currency' : ''
    if (ts[j] === '%' || ts[j] === 'percent') {
      if (currency) unread = true
      unit = '%'
      j += 1
    } else if (ts[j] === 'per' && ts[j + 1] === 'cent') {
      if (currency) unread = true
      unit = '%'
      j += 2
    } else if (CURRENCY_WORDS.has(ts[j])) {
      const word = CURRENCY_WORDS.get(ts[j])
      if (currency && currency !== word) unread = true
      currency = word
      unit = 'currency'
      j += 1
    }
    if (unread) {
      i = j
      continue
    }
    out.push({
      value: currency ? { n: sign * n, unit, currency } : { n: sign * n, unit },
      at: index[start],
      from: index[i],
      end: index[j - 1] + 1,
      tsFrom: i,
      tsEnd: j
    })
    i = j
  }
  // Two numbers standing next to each other ('nineteen ninety nine', 'twenty twenty one') or
  // joined as a range or a ratio ('40 to 50', '40 or 50', '1 in 4', '3 out of 4', '3 of 4'):
  // both are no number, since either read alone is a value the speaker did not say.
  const joined = new Set<number>()
  for (let k = 0; k + 1 < out.length; k++) {
    const gap = ts.slice(out[k].tsEnd, out[k + 1].tsFrom).join(' ')
    const between = gap === 'and' && ts[out[k].tsFrom - 1] === 'between'
    if (gap === '' || NUMBER_JOINERS.includes(gap) || between) {
      joined.add(k)
      joined.add(k + 1)
    }
  }
  // A number said with a qualifier directly before it ('almost 40', 'up to 40', 'fewer than 40%')
  // is no exact number: drawn bare, it would state one.
  const qualified = (o: { tsFrom: number }): boolean =>
    QUALIFIERS.includes(ts[o.tsFrom - 1] ?? '') ||
    QUALIFIER_PAIRS.some(([a, b]) => ts[o.tsFrom - 2] === a && ts[o.tsFrom - 1] === b)
  return out.filter((o, k) => !joined.has(k) && !qualified(o)).map(({ value, at, from, end }) => ({ value, at, from, end }))
}

/** The words that join two numbers into a range or a ratio, as one space-joined gap (see `numberSpans`). */
const NUMBER_JOINERS: readonly string[] = ['to', 'or', 'in', 'of', 'out of']

/**
 * The words that, directly before a number, make it no exact number
 * ('almost 40', 'over 40%', 'fewer than 40', 'at least 40'), and the two-word
 * ones whose second word alone qualifies nothing ('up to', 'close to',
 * 'upwards of'). Beyond §6.7's words, each only drops more.
 */
export const QUALIFIERS: readonly string[] = [
  'almost', 'nearly', 'about', 'around', 'roughly', 'approximately', 'approx', 'over', 'under', 'than', 'least', 'most'
]
const QUALIFIER_PAIRS: readonly (readonly [string, string])[] = [['up', 'to'], ['close', 'to'], ['upwards', 'of']]

/** The fraction words that may follow a number ('two and a half', 'three quarters'). */
const FRACTIONS: ReadonlySet<string> = new Set(['half', 'halves', 'quarter', 'quarters', 'third', 'thirds'])

/** How many tokens of a fraction start at `j` ('half': 1; 'and a half', 'and one quarter': 3), else 0. */
function fractionAt(ts: readonly string[], j: number): number {
  if (FRACTIONS.has(ts[j] ?? '')) return 1
  const between = ts[j + 1] ?? ''
  if (ts[j] === 'and' && (between === 'a' || between === 'an' || isNumberWord(between) || digitValue(between) !== null)) {
    return FRACTIONS.has(ts[j + 2] ?? '') ? 3 : 0
  }
  return 0
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

// ---------------------------------------------------------------------------
// The claims (§6.7's exports list) and the binding (rules 5-8).

/**
 * One thing a graphic says that the stretch must hold (§6.7's exports list).
 * `path` is the field's, relative to the graphic's `data` ('label',
 * 'items[1].value'); every token claim of one field shares it, which is how
 * `bind` knows a field's tokens bind together. `text` is the value field's
 * string (`number`), one content token (`token`), or the verbatim field's
 * string (`run`). `pair` numbers each label–value pair the data holds, in data
 * order: for `counter` and `ring` it is 0, the index into `TemplateDef.pairs`;
 * for `bars`, whose one pair is a list's, it is the item's index. `mid` is
 * `keyword`'s: its run may start and end mid-clause (rule 8, rule 9).
 */
export interface Claim {
  path: string
  text: string
  kind: 'number' | 'token' | 'run'
  value?: CanonNumber
  pair?: number
  mid?: true
}

/**
 * Spellings of rule 7's negators that `NEGATORS` as §6.7 lists them does not
 * hold, each the same word: 'cannot' (the plan's n't covers "can't"), the n't
 * contractions as ASR writes them without the apostrophe (an explicit list:
 * a pattern on 'nt' would take 'client' and 'want'), and Hindi 'नही', the
 * common spelling of 'नहीं' without the anusvara. Each one only drops more.
 */
export const NEGATOR_SPELLINGS: readonly string[] = [
  'cannot', 'dont', 'doesnt', 'didnt', 'cant', 'wont', 'isnt', 'arent', 'wasnt', 'werent', 'hasnt', 'havent',
  'hadnt', 'couldnt', 'wouldnt', 'shouldnt', 'mustnt', 'neednt', 'aint', 'नही'
]

/**
 * English words that negate what they stand with though §6.7's list does not
 * name them ('It is hardly easy' cannot ship "easy"). Beyond the plan's list,
 * each only drops more.
 */
export const NEAR_NEGATORS: readonly string[] = ['hardly', 'barely', 'scarcely']

/**
 * A word that negates (rule 7): any of `NEGATORS`' lists, whatever the
 * language, one of `NEGATOR_SPELLINGS` or `NEAR_NEGATORS`, or an English
 * contraction ending in n't. `validateGraphics.ts` reads it for a reporting
 * verb's clause (rule 8's speaker).
 */
export function isNegator(t: string): boolean {
  return NEGATORS.en.includes(t) || NEGATORS.hi.includes(t) || NEGATORS.te.includes(t) ||
    NEGATOR_SPELLINGS.includes(t) || NEAR_NEGATORS.includes(t) || /n['’]t$/u.test(t)
}

/** Rule 8's exemption: an English function word, and never a negator, a direction word or a comparative. */
function exempt(t: string): boolean {
  return FUNCTION_WORDS_EN.includes(t)
}

/** A phrase's tokens without the clause breaks: what a field says. */
function spokenTokensOf(text: string): string[] {
  return claimTokensOf(text).filter((t) => t !== CLAUSE_BREAK)
}

// ---------------------------------------------------------------------------
// The marks a spec field may draw (rule 8: no free text lands in a picture).

/** A word's leading and trailing characters outside letters, marks and numbers, as written (NFC). */
function edgesOf(word: string): { lead: string; trail: string; whole: boolean } {
  const w = word.normalize('NFC')
  const lead = /^[^\p{L}\p{M}\p{N}]*/u.exec(w)![0]
  if (lead.length === w.length) return { lead, trail: '', whole: true }
  const trail = /[^\p{L}\p{M}\p{N}]*$/u.exec(w)![0]
  return { lead, trail, whole: false }
}

/** A value word's edges: a minus, a leading currency sign, a minus after it; a trailing % and a point ('Rs.'). */
const VALUE_LEAD = /^[-−–]?[$€£₹]?[-−–]?$/u
const VALUE_TRAIL = /^%?\.?$/u
/** A grounded or verbatim word's edges: opening brackets and quotes, one currency sign; a %, closing marks, plain clause punctuation. */
const WORD_LEAD = /^[(["“‘']*[$€£₹]?$/u
// The danda and double danda too: a Hindi sentence's own full stop, as BREAK_CHARS has them (piece 5's critic).
const WORD_TRAIL = /^%?[)\]"”’'.,;:…।॥]*$/u
/** What a verbatim word may end in when the stretch's word at that place ends in it too (`marksUnsaid`). */
export const SAID_MARKS = /[?!]/u
/** A word of a field that is a dash alone, plain clause punctuation (rule 7's `—`). */
const DASH_WORD = /^[—–-]$/u

/**
 * The characters of a spec field that `claimTokens` trims before comparing
 * and the painter would still draw, beyond plain punctuation: '>40', '40+',
 * '~40', '#1', '±40', '40×', '↑ clients', '-bride', '¬easy', 'clients?'. Rule
 * 2 trims edges so a spoken word compares; on the SPEC side a trimmed mark
 * is model-written text that lands in a picture, which rule 8 forbids ("no
 * free mode for anything drawn into a frame"). Empty when the field draws
 * nothing it was not checked for.
 *
 * `mode` 'value': each word may hold only a minus, a leading currency sign,
 * a trailing `%` and a trailing point at its edges (`soleNumber` reads such a
 * field as not one number). 'words': opening brackets and quotes and one
 * currency sign before, a `%`, closing brackets and quotes and `. , ; : …`
 * after, or a dash alone. 'verbatim': as 'words', and `?` or `!` at a word's
 * end, which `marksUnsaid` then holds to the stretch's own word. Beyond
 * §6.7's words; each only drops more.
 */
export function marksOf(text: string, mode: 'value' | 'words' | 'verbatim'): string[] {
  const out: string[] = []
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    const { lead, trail, whole } = edgesOf(word)
    if (whole) {
      if (mode !== 'value' && DASH_WORD.test(lead)) continue
      out.push(lead)
      continue
    }
    const [leadOk, trailOk] = mode === 'value' ? [VALUE_LEAD, VALUE_TRAIL] : [WORD_LEAD, WORD_TRAIL]
    if (!leadOk.test(lead)) out.push(lead)
    const t = mode === 'verbatim' ? trail.replace(/[?!]+(?=[)\]"”’']*$)/u, '') : trail
    if (!trailOk.test(t)) out.push(trail)
  }
  return out
}

/**
 * The `?` and `!` a verbatim field's words end in that the stretch's word at
 * the same place does not ('keep it simple?' over 'keep it simple.', 'easy!'
 * over 'easy.'): a question or an exclamation the speaker did not make.
 * `first` is the run's first word index (`bind`'s `at`); the field's tokens
 * are aligned to the stretch's from it. Empty when every mark is said.
 */
export function marksUnsaid(text: string, stretch: ClaimStretch, first: number): string[] {
  const field = text.split(/\s+/u).filter(Boolean).map((w) => ({
    n: claimTokens(w).filter((t) => t !== CLAUSE_BREAK).length,
    tokens: claimTokens(w).filter((t) => t !== CLAUSE_BREAK),
    marks: [...edgesOf(w).trail].filter((ch) => SAID_MARKS.test(ch))
  }))
  if (field.every((f) => f.marks.length === 0)) return []
  const want = field.flatMap((f) => f.tokens)
  const said: { t: string; word: Word }[] = []
  for (const w of [...stretch.words].sort((a, b) => a.index - b.index)) {
    if (w.index < first) continue
    for (const t of claimTokens(w.text)) if (t !== CLAUSE_BREAK) said.push({ t, word: w })
  }
  // The run may start inside its first word ('40' of '$40'): the offset where the field's tokens stand.
  let off = -1
  for (let k = 0; k < said.length && said[k].word.index === first; k++) {
    if (want.every((t, j) => said[k + j]?.t === t)) {
      off = k
      break
    }
  }
  const out: string[] = []
  let at = off
  for (const f of field) {
    at += f.n
    if (f.marks.length === 0) continue
    const word = off < 0 || (f.n === 0 && at === off) ? undefined : said[at - 1]?.word
    const theirs = word ? [...edgesOf(word.text).trail] : []
    for (const m of f.marks) if (!theirs.includes(m)) out.push(m)
  }
  return out
}

/** The one number a value field holds, when the field is that number and nothing else ('40 percent', '₹500'); else undefined. */
function soleNumber(text: string): CanonNumber | undefined {
  if (marksOf(text, 'value').length > 0) return undefined
  const tokens = claimTokensOf(text)
  const spans = numberSpans(tokens)
  if (spans.length !== 1) return undefined
  const { value, from, end } = spans[0]
  const outside = tokens.some((t, i) => (i < from || i >= end) && t !== CLAUSE_BREAK)
  return outside ? undefined : value
}

/**
 * Every claim a graphic's data makes (§6.7), in data order: each field the
 * template marks `grounded` or `verbatim` (`TemplateDef.fields`, with
 * `kindFields` for the data's `kind` over them), top-level fields first, then
 * each item's. No claim of an `index`, `user`, `fixed`, `speaker` or app
 * field (`TemplateDef.appFields`).
 *
 * - A pair's value field (`TemplateDef.pairs`' second key) is ONE `number`
 *   claim, its `value` the field's one number when the field is exactly one
 *   number, else undefined, which `bind` finds nowhere: a value field with no
 *   number, two numbers or a word besides its number is dropped.
 * - Any other `grounded` field is one `token` claim per content token: its
 *   tokens (`claimTokensOf`, clause marks set aside) less the English
 *   function words (rule 8). A negator, a direction word or a comparative is
 *   never exempt. A title that is one of the template's `fixedTitles` makes no
 *   claim, nor does an empty field.
 * - A `verbatim` field is one `run` claim; `keyword`'s carries `mid`.
 */
export function claimsOf(data: GraphicData, def: TemplateDef): Claim[] {
  const record = data as unknown as Record<string, unknown>
  const kind = typeof record.kind === 'string' ? record.kind : undefined
  const modes: Record<string, FieldMode> = { ...def.fields, ...((kind && def.kindFields?.[kind]) || {}) }
  const app = new Set(def.appFields ?? [])
  const pairs = def.pairs ?? []
  const fixed = new Set((def.fixedTitles ?? []).map((t) => spokenTokensOf(t).join(' ')))
  const out: Claim[] = []
  let nextPair = 0

  // Top-level pairs take their indices first, then each item's, in item order.
  const topPair = new Map<string, { pair: number; role: 'label' | 'value' }>()
  for (const [label, value] of pairs) {
    if (label.startsWith('items.')) continue
    const pair = nextPair++
    topPair.set(label, { pair, role: 'label' })
    topPair.set(value, { pair, role: 'value' })
  }

  const field = (path: string, key: string, text: unknown, at?: { pair: number; role: 'label' | 'value' }): void => {
    const mode = modes[key]
    const leaf = key.split('.').pop()!
    if (app.has(key) || app.has(leaf)) return
    if (mode !== 'grounded' && mode !== 'verbatim') return
    const s = typeof text === 'string' ? text : ''
    if (mode === 'verbatim') {
      out.push(def.id === 'keyword' ? { path, text: s, kind: 'run', mid: true } : { path, text: s, kind: 'run' })
      return
    }
    if (at?.role === 'value') {
      const value = soleNumber(s)
      out.push(value ? { path, text: s, kind: 'number', value, pair: at.pair } : { path, text: s, kind: 'number', pair: at.pair })
      return
    }
    const tokens = spokenTokensOf(s)
    if (key === 'title' && fixed.has(tokens.join(' '))) return
    for (const t of tokens) {
      if (exempt(t)) continue
      out.push(at ? { path, text: t, kind: 'token', pair: at.pair } : { path, text: t, kind: 'token' })
    }
  }

  const keys = Object.keys(modes)
  for (const key of keys) if (!key.startsWith('items.')) field(key, key, record[key], topPair.get(key))
  const items = Array.isArray(record.items) ? (record.items as Record<string, unknown>[]) : []
  const itemKeys = keys.filter((k) => k.startsWith('items.'))
  const itemPairs = pairs.filter(([label]) => label.startsWith('items.'))
  items.forEach((item, j) => {
    const roles = new Map<string, { pair: number; role: 'label' | 'value' }>()
    for (const [label, value] of itemPairs) {
      const pair = nextPair++
      roles.set(label, { pair, role: 'label' })
      roles.set(value, { pair, role: 'value' })
    }
    for (const key of itemKeys) {
      const leaf = key.slice('items.'.length)
      field(`items[${j}].${leaf}`, key, item?.[leaf], roles.get(key))
    }
  })
  return out
}

/** The words a graphic's facts may come from: the cited sentence and one either side, over capped segments (§6.7, "The stretch"). */
export interface ClaimStretch {
  words: readonly Word[]
  sentences: readonly Segment[]
}

/** One token of the stretch, as `bind` places claims on it. */
interface StretchToken {
  t: string
  /** The `Word.index` it came from. */
  word: number
  /** Which sentence of the stretch (in spoken order). */
  sent: number
  /** Which clause (rule 7): a new one at each sentence start and after each `CLAUSE_BREAK`. */
  clause: number
  /** Its position among the stretch's spoken tokens (clause breaks not counted); −1 on a break. */
  np: number
}

/** The stretch's tokens, in spoken order, and every number in each sentence (none runs across a sentence). */
function tokensOfStretch(stretch: ClaimStretch): {
  toks: StretchToken[]
  numbers: { value: CanonNumber; at: number; from: number; end: number }[]
} {
  const byIndex = new Map<number, Word>()
  for (const w of stretch.words) byIndex.set(w.index, w)
  const sentences = [...stretch.sentences].sort((a, b) => a.wordStart - b.wordStart)
  const toks: StretchToken[] = []
  const numbers: { value: CanonNumber; at: number; from: number; end: number }[] = []
  let clause = -1
  let np = 0
  sentences.forEach((s, sent) => {
    clause += 1
    const first = toks.length
    for (let w = s.wordStart; w <= s.wordEnd; w++) {
      const word = byIndex.get(w)
      if (!word) continue
      for (const t of claimTokens(word.text)) {
        if (t === CLAUSE_BREAK) {
          toks.push({ t, word: w, sent, clause, np: -1 })
          clause += 1
        } else toks.push({ t, word: w, sent, clause, np: np++ })
      }
    }
    for (const n of numberSpans(toks.slice(first).map((x) => x.t))) {
      numbers.push({ value: n.value, at: first + n.at, from: first + n.from, end: first + n.end })
    }
  })
  return { toks, numbers }
}

/** Where one claim may bind: the stretch tokens it takes, and what `bind` judges it by. */
interface Occurrence {
  /** Indices into the stretch's tokens; no two bound claims share one. */
  tokens: number[]
  /** The word index `bind` records for the claim. */
  word: number
  sent: number
  /** The spoken positions of its first and last token. */
  first: number
  last: number
  /** The matched stretch number (a `number` claim's). */
  value?: CanonNumber
  /** A run directly after a negator (rule 8: refused). */
  afterNegator?: true
}

/** Rule 5: equal values, relative 1e-9. */
function sameValue(a: number, b: number): boolean {
  return a === b || Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b))
}

/** Rule 5: a `%` or a currency in the spec must be on the matched stretch number; a bare spec number matches any. */
function unitOk(spec: CanonNumber, said: CanonNumber): boolean {
  if (spec.unit === '') return true
  if (spec.unit === '%') return said.unit === '%'
  return said.unit === 'currency' && said.currency === spec.currency
}

/**
 * English words ending in s or es that are no plural of the word without it
 * ('news' is not 'new's, 'has' not 'ha's): rule 8's fold never makes one.
 */
const NOT_PLURALS: ReadonlySet<string> = new Set([
  'news', 'has', 'his', 'yes', 'bus', 'gas', 'plus', 'less', 'this', 'thus', 'was', 'is', 'us', 'as', 'its', 'does', 'goes'
])

/** Rule 8: one token for another, English plurals (`s`, `es`) folded on both sides. */
function sameToken(a: string, b: string, english: boolean): boolean {
  if (a === b) return true
  if (!english || !/^[a-z]+$/u.test(a) || !/^[a-z]+$/u.test(b)) return false
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  if (NOT_PLURALS.has(long)) return false
  return short + 's' === long || short + 'es' === long
}

/** The spoken distance of a token from an occurrence's span: 0 inside it, 1 next to it. */
function distance(np: number, o: { first: number; last: number }): number {
  return np < o.first ? o.first - np : np > o.last ? np - o.last : 0
}

export type BindResult =
  | { ok: true; at: number[]; matched: (CanonNumber | undefined)[] }
  | {
      ok: false
      missing: Claim[]
      reason: 'absent' | 'unpaired' | 'order' | 'negated' | 'unit'
      at?: number[]
    }

/** How many assignments `bind` tries before it gives up: past this it drops ('unpaired'), the safe direction. */
const BIND_BUDGET = 200_000

/**
 * Bind every claim to the stretch (§6.7 rules 5-8), or say why not.
 *
 * Each claim binds to ONE occurrence and no two claims to the same one:
 * - a `number` claim to a number in the stretch of equal value (rule 5), whose
 *   unit holds the spec's `%` or currency if it has one; a bare spec number may
 *   match a number with a unit. No value-equal number: 'absent'; only ones with
 *   another unit: 'unit'. What the template then requires of the MATCHED
 *   number (ring's `%`, bars' one unit) is rule 9's: `matched` holds the
 *   matched stretch number for each `number` claim (undefined for the others),
 *   never the spec's.
 * - a `token` claim to an equal token (English plurals folded when `lang` is
 *   English). A pair's label tokens sit in the same sentence as their value's
 *   occurrence, each within `BIND_WINDOW` spoken tokens of it (rule 6); an
 *   unpaired field's tokens bind as one run: one sentence, in the field's
 *   order, at most 3 spoken tokens between neighbours.
 * - a `run` claim (verbatim) to a contiguous run of one sentence's spoken
 *   tokens equal to the field's, starting and ending on a sentence or clause
 *   boundary unless `mid` (keyword, rule 9). None: 'absent'.
 * Not every claim placeable that way together: 'unpaired'. Across the pairs,
 * if A's value is said before B's, every token of A's label is said before
 * every token of B's: else 'order'. Then rule 7: the clause each claim binds
 * in (from the previous clause break or sentence start to the next) may hold
 * no negator its field lacks, and a run may not directly follow a negator:
 * else 'negated', with `at` the assignment that came that far, so a caller
 * can demote a quote to the clause (`clauseAt`). Beyond rule 7's words, the
 * clause directly before the claim's, in the same sentence, is judged with
 * it: a negated clause governs the one after its mark ('It is not true, 90%
 * of startups fail'; 'I would never say this: quit your job').
 *
 * `at` holds one word index per claim, in claim order: a number's first digit
 * or number word, a token's word, a run's first word. Negators of every
 * listed language count whatever `lang` says; Telugu's negative verb endings
 * are caught by no list (rule 7). Pure and node-runnable.
 *
 * Beyond rule 6's words, each in the safe direction (a pairing the stretch
 * cannot tell from another is dropped, 'unpaired'):
 * - a pair's label token may not sit as near or nearer to a number of its
 *   sentence that no claim binds as to its own value ('We had 40 clients and
 *   12 staff' cannot ship "12 clients");
 * - when two pairs' values, exchanged, bind as well under every rule, the
 *   graphic is dropped: a label word said twice ('Instagram gave us 30%,
 *   referrals 70%, and Instagram keeps growing') would otherwise let either
 *   chart through;
 * - a list's unpaired rows (steps' items) are said in item order, or
 *   'order' (`itemsDisordered`): a steps graphic numbers them.
 */
export function bind(claims: readonly Claim[], stretch: ClaimStretch, lang: string): BindResult {
  const r = bindOnce(claims, stretch, lang)
  if (!r.ok) return r
  const values = claims.filter((c) => c.kind === 'number' && c.pair !== undefined && c.value !== undefined)
  for (let p = 0; p < values.length; p++) {
    for (let q = p + 1; q < values.length; q++) {
      const [a, b] = [values[p], values[q]]
      if (a.pair === b.pair) continue
      const same = sameValue(a.value!.n, b.value!.n) && a.value!.unit === b.value!.unit && a.value!.currency === b.value!.currency
      if (same) continue
      const swapped = claims.map((c) =>
        c === a ? { ...c, text: b.text, value: b.value } : c === b ? { ...c, text: a.text, value: a.value } : c
      )
      if (bindOnce(swapped, stretch, lang).ok) {
        return { ok: false, missing: claims.filter((c) => c.pair === a.pair || c.pair === b.pair), reason: 'unpaired' }
      }
    }
  }
  return r
}

/** `bind` without the exchange check: one search over every placement. */
function bindOnce(claims: readonly Claim[], stretch: ClaimStretch, lang: string): BindResult {
  const english = /^en(?:$|[-_])/iu.test(lang)
  const { toks, numbers } = tokensOfStretch(stretch)
  const spoken = toks.map((x, i) => i).filter((i) => toks[i].np >= 0)
  // Each clause's sentence: a clause ended by a break has its sentence's next clause after it.
  const clauseSent = new Map<number, number>()
  for (const x of toks) clauseSent.set(x.clause, x.sent)
  const occOf = (tokens: number[], word: number, extra: Partial<Occurrence> = {}): Occurrence => {
    const nps = tokens.map((i) => toks[i].np).filter((n) => n >= 0)
    return { tokens, word, sent: toks[tokens[0]].sent, first: Math.min(...nps), last: Math.max(...nps), ...extra }
  }

  // Every place each claim may bind.
  const candidates: Occurrence[][] = []
  const absent: Claim[] = []
  const unit: Claim[] = []
  for (const c of claims) {
    let found: Occurrence[] = []
    if (c.kind === 'number') {
      const spec = c.value
      const equal = spec ? numbers.filter((n) => sameValue(n.value.n, spec.n)) : []
      const fit = equal.filter((n) => unitOk(spec!, n.value))
      found = fit.map((n) => {
        const span = Array.from({ length: n.end - n.from }, (_, k) => n.from + k)
        return occOf(span, toks[n.at].word, { value: n.value })
      })
      if (equal.length > 0 && fit.length === 0) unit.push(c)
    } else if (c.kind === 'token') {
      found = spoken.filter((i) => sameToken(c.text, toks[i].t, english)).map((i) => occOf([i], toks[i].word))
    } else {
      found = runsOf(spokenTokensOf(c.text), toks, spoken, c.mid === true).map((r) =>
        occOf(r.tokens, toks[r.tokens[0]].word, r.afterNegator ? { afterNegator: true } : {})
      )
    }
    if (found.length === 0 && !unit.includes(c)) absent.push(c)
    candidates.push(found)
  }
  if (absent.length > 0) return { ok: false, missing: absent, reason: 'absent' }
  if (unit.length > 0) return { ok: false, missing: unit, reason: 'unit' }

  // Each field's negators (rule 7: a negator the field lacks).
  const fieldNegators = new Map<string, Set<string>>()
  for (const c of claims) {
    const set = fieldNegators.get(c.path) ?? new Set<string>()
    for (const t of c.kind === 'run' ? spokenTokensOf(c.text) : [c.text]) if (isNegator(t)) set.add(t)
    fieldNegators.set(c.path, set)
  }
  // The claim before each in its unpaired field, for the run rule.
  const previousInField = claims.map((c, i) => {
    if (c.kind !== 'token' || c.pair !== undefined) return -1
    for (let j = i - 1; j >= 0; j--) if (claims[j].path === c.path) return j
    return -1
  })

  // Values first, so each label's window prunes its tokens' places early; the rest in claim order.
  const order = [...claims.keys()].sort((a, b) => Number(claims[b].kind === 'number') - Number(claims[a].kind === 'number'))
  const chosen: Occurrence[] = new Array<Occurrence>(claims.length)
  const used = new Set<number>()
  let tried = 0
  let best: { stage: number; reason: 'order' | 'unpaired' | 'negated'; missing: Claim[]; at: number[] } | null = null

  const fits = (i: number, o: Occurrence): boolean => {
    if (o.tokens.some((t) => used.has(t))) return false
    const c = claims[i]
    if (c.pair !== undefined) {
      for (let j = 0; j < claims.length; j++) {
        const d = claims[j]
        if (!chosen[j] || d.pair !== c.pair || (d.kind === 'number') === (c.kind === 'number')) continue
        const [value, label] = c.kind === 'number' ? [o, chosen[j]] : [chosen[j], o]
        if (label.sent !== value.sent) return false
        if (distance(label.first, value) > BIND_WINDOW) return false
      }
    }
    const p = previousInField[i]
    if (p >= 0) {
      const prev = chosen[p]
      if (o.sent !== prev.sent || o.first <= prev.last || o.first - prev.last - 1 > 3) return false
    }
    return true
  }

  const judge = (): boolean => {
    const at = chosen.map((o) => o.word)
    // Spoken order across the pairs.
    const disordered = [...orderBroken(claims, chosen), ...itemsDisordered(claims, chosen)]
    if (disordered.length > 0) {
      if (!best || best.stage < 1) best = { stage: 1, reason: 'order', missing: disordered, at }
      return false
    }
    // A label token as near or nearer to a number no claim binds as to its own value.
    const nearer = strayNearer()
    if (nearer.length > 0) {
      if (!best || best.stage < 2) best = { stage: 2, reason: 'unpaired', missing: nearer, at }
      return false
    }
    // Rule 7, over each claim's clauses and the clause directly before the first of them in its sentence.
    const negated = claims.filter((c, i) => {
      const o = chosen[i]
      if (o.afterNegator) return true
      const lacks = fieldNegators.get(c.path)!
      const clauses = new Set(o.tokens.map((t) => toks[t].clause))
      const first = Math.min(...clauses)
      if (clauseSent.get(first - 1) === clauseSent.get(first)) clauses.add(first - 1)
      return toks.some((x) => x.np >= 0 && clauses.has(x.clause) && isNegator(x.t) && !lacks.has(x.t))
    })
    if (negated.length > 0) {
      if (!best || best.stage < 3) best = { stage: 3, reason: 'negated', missing: negated, at }
      return false
    }
    return true
  }

  const strayNearer = (): Claim[] => {
    const bound = new Set(claims.flatMap((c, i) => (c.kind === 'number' ? [chosen[i].tokens[0]] : [])))
    const strays = numbers.filter((n) => !bound.has(n.from))
    return claims.filter((c, i) => {
      if (c.kind !== 'token' || c.pair === undefined) return false
      const v = claims.findIndex((d) => d.kind === 'number' && d.pair === c.pair)
      if (v < 0) return false
      const label = chosen[i]
      const own = distance(label.first, chosen[v])
      return strays.some((n) => {
        if (toks[n.from].sent !== label.sent) return false
        if (label.tokens[0] >= n.from && label.tokens[0] < n.end) return false
        const nps = toks.slice(n.from, n.end).map((x) => x.np).filter((x) => x >= 0)
        return distance(label.first, { first: Math.min(...nps), last: Math.max(...nps) }) <= own
      })
    })
  }

  const search = (k: number): boolean => {
    if (k === order.length) return judge()
    const i = order[k]
    for (const o of candidates[i]) {
      if (++tried > BIND_BUDGET) return false
      if (!fits(i, o)) continue
      chosen[i] = o
      for (const t of o.tokens) used.add(t)
      if (search(k + 1)) return true
      delete chosen[i]
      for (const t of o.tokens) used.delete(t)
    }
    return false
  }

  if (search(0)) {
    return {
      ok: true,
      at: chosen.map((o) => o.word),
      matched: chosen.map((o, i) => (claims[i].kind === 'number' ? o.value : undefined))
    }
  }
  if (best) {
    const b: { reason: 'order' | 'unpaired' | 'negated'; missing: Claim[]; at: number[] } = best
    return { ok: false, missing: b.missing, reason: b.reason, at: b.at }
  }
  return { ok: false, missing: [...claims], reason: 'unpaired' }
}

/**
 * Rule 6's spoken order: the claims of every two pairs whose values are said
 * in one order and whose labels are not wholly in the same order. A pair with
 * no label token has no label to order.
 */
function orderBroken(claims: readonly Claim[], chosen: readonly Occurrence[]): Claim[] {
  const pairs = new Map<number, { value?: number; first: number; last: number }>()
  claims.forEach((c, i) => {
    if (c.pair === undefined) return
    const p = pairs.get(c.pair) ?? { first: Infinity, last: -Infinity }
    if (c.kind === 'number') p.value = chosen[i].first
    else {
      p.first = Math.min(p.first, chosen[i].first)
      p.last = Math.max(p.last, chosen[i].last)
    }
    pairs.set(c.pair, p)
  })
  const bad = new Set<number>()
  const list = [...pairs.entries()].filter(([, p]) => p.value !== undefined && p.first !== Infinity)
  for (const [a, pa] of list) {
    for (const [b, pb] of list) {
      if (pa.value! < pb.value! && !(pa.last < pb.first)) {
        bad.add(a)
        bad.add(b)
      }
    }
  }
  return claims.filter((c) => c.pair !== undefined && bad.has(c.pair))
}

/**
 * A list's unpaired rows in spoken order: every token of item j's field is
 * said before every token of item j+1's same field ('first charge batteries,
 * then pack bag' cannot ship steps [pack bag, charge batteries], which draws
 * 1 and 2 on a sequence the speaker did not give). Rule 6 orders a run's
 * tokens within one field and the pairs across a template, and is silent on
 * a list's rows; beyond its words, only drops more ('order').
 */
function itemsDisordered(claims: readonly Claim[], chosen: readonly Occurrence[]): Claim[] {
  const rows = new Map<string, Map<number, { first: number; last: number }>>()
  claims.forEach((c, i) => {
    if (c.kind !== 'token' || c.pair !== undefined) return
    const m = /^items\[(\d+)\]\.(\w+)$/u.exec(c.path)
    if (!m) return
    const byItem = rows.get(m[2]) ?? new Map<number, { first: number; last: number }>()
    const j = Number(m[1])
    const r = byItem.get(j) ?? { first: Infinity, last: -Infinity }
    byItem.set(j, { first: Math.min(r.first, chosen[i].first), last: Math.max(r.last, chosen[i].last) })
    rows.set(m[2], byItem)
  })
  const bad = new Set<string>()
  for (const [leaf, byItem] of rows) {
    const items = [...byItem.keys()].sort((a, b) => a - b)
    for (let k = 0; k + 1 < items.length; k++) {
      if (!(byItem.get(items[k])!.last < byItem.get(items[k + 1])!.first)) {
        bad.add(`items[${items[k]}].${leaf}`)
        bad.add(`items[${items[k + 1]}].${leaf}`)
      }
    }
  }
  return claims.filter((c) => bad.has(c.path))
}

/**
 * Every place a verbatim field's tokens stand as a contiguous run of one
 * sentence's spoken tokens (clause breaks between them allowed, but not in a
 * `mid` run: a keyword is one phrase), starting and ending on a sentence or
 * clause boundary unless `mid`; each marked when the
 * spoken token before it, past any 'ever' and across a sentence break, is a
 * negator (rule 8's "directly after a negator", read in the safe direction).
 */
function runsOf(
  field: readonly string[],
  toks: readonly StretchToken[],
  spoken: readonly number[],
  mid: boolean
): { tokens: number[]; afterNegator: boolean }[] {
  if (field.length === 0) return []
  const out: { tokens: number[]; afterNegator: boolean }[] = []
  for (let s = 0; s + field.length <= spoken.length; s++) {
    const run = spoken.slice(s, s + field.length)
    if (toks[run[0]].sent !== toks[run[run.length - 1]].sent) continue
    if (!run.every((ti, k) => toks[ti].t === field[k])) continue
    const sent = toks[run[0]].sent
    const before = run[0] - 1
    const after = run[run.length - 1] + 1
    const startsOnEdge = before < 0 || toks[before].sent !== sent || toks[before].np < 0
    const endsOnEdge = after >= toks.length || toks[after].sent !== sent || toks[after].np < 0
    if (!mid && !(startsOnEdge && endsOnEdge)) continue
    // A keyword's run is one phrase: no clause or sentence mark inside it ('It is easy, money comes
    // slowly' never says "easy money"; 'I love my. Job is hard' in one segment never says "my job").
    if (mid && toks.slice(run[0], run[run.length - 1] + 1).some((x) => x.np < 0)) continue
    // The spoken token before the run, past any 'ever' ('never, ever, quit'), in this sentence or
    // the one before ('Never.' 'Quit your job.': an ASR sentence break inside one phrase).
    let p = s - 1
    while (p >= 0 && toks[spoken[p]].t === 'ever') p -= 1
    const afterNegator = p >= 0 && isNegator(toks[spoken[p]].t)
    out.push({ tokens: run, afterNegator })
  }
  return out
}

/**
 * The clause a word sits in (rule 7), as the first and last word index of its
 * spoken tokens: from the previous clause break or sentence start to the next.
 * Null when the word is not in the stretch. For a quote demoted to the
 * verbatim clause with its negator (rule 7), which the caller decides.
 */
export function clauseAt(stretch: ClaimStretch, word: number): { start: number; end: number } | null {
  const { toks } = tokensOfStretch(stretch)
  const mine = toks.find((x) => x.word === word && x.np >= 0)
  if (!mine) return null
  const inClause = toks.filter((x) => x.clause === mine.clause && x.np >= 0)
  return { start: inClause[0].word, end: inClause[inClause.length - 1].word }
}
