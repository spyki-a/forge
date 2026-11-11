import { describe, it, expect } from 'vitest'
import { claimToken, numbersIn, type CanonNumber } from '@shared/director/claims'
import { settleGraphics, type GraphicsMenu, type SettledGraphics } from '@shared/director/run'
import type { AnswerGraphic } from '@shared/director/validateGraphics'
import { drawListAt, graphicFits } from '@shared/graphics/drawList'
import { graphicMovingFrames } from '@shared/graphics/frame'
import type { DrawItem, DrawList, TextItem, TextMeasure } from '@shared/graphics/items'
import { resolveGraphicStyle } from '@shared/graphics/style'
import { GRAPHIC_TEMPLATES, type GraphicCandidate, type GraphicData, type GraphicSpec } from '@shared/graphics/template'
import type { Segment, Transcript, Word } from '@shared/transcript'

/*
 * docs/CLIPS.md §6.7's second test, the property test, and §6.12's phase-2
 * exit bar: "no graphic states what the speaker did not say, by construction".
 *
 * 1. A fixed-seed generator (a seeded PRNG below; no Math.random) writes random
 *    talks in English, Hindi and Telugu and, for each, one graphic a model
 *    could write from what was said, on every template the model may write
 *    (not lower-third), with numbers in every format rule 4 names.
 * 2. Adversarial generators each turn a graphic the speaker DID say (one
 *    settleGraphics kept) into one they did not: two pairs' values swapped; a
 *    negator put into the bound clause; a label from the neighbouring
 *    sentence; a unit stripped from the talk but not the spec; a keyword run
 *    with a gap; a keyword run in a negated clause; a lit past the run's end;
 *    a model-written parent. Each asserts what the rules demand on EVERY case
 *    (dropped, or repaired for lit and parent) and counts its cases against a
 *    floor: a generator that yields nothing proves nothing.
 * 3. An independent matcher, written here from §6.7's words and importing
 *    neither bind nor checkGraphicData: it checks BINDING (one occurrence per
 *    claim, the same sentence, the window, spoken order, no unmatched
 *    negator), not membership. Every graphic settleGraphics keeps must ground
 *    by it. It shares two functions with claims.ts, claimToken and numbersIn,
 *    and pins both below against hand-written expectations.
 * 4. Over what the painter draws: each kept graphic, given beats, is drawn at
 *    its settled frame by drawListAt with a fake measure (node, no context),
 *    and its text items, per-word pieces joined and the fixed glyphs set
 *    aside, must (a) be exactly the strings the validator checked, and (b)
 *    reassembled as a graphic, ground by the matcher.
 */

// ---------------------------------------------------------------------------
// A seeded PRNG (mulberry32): the same seed, the same cases, every run.

class Rng {
  private a: number
  constructor(seed: number) {
    this.a = seed >>> 0
  }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0
    let t = this.a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1))
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)]
  }
  chance(p: number): boolean {
    return this.next() < p
  }
  sample<T>(xs: readonly T[], n: number): T[] {
    const pool = [...xs]
    const out: T[] = []
    while (out.length < n && pool.length > 0) out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0])
    return out
  }
}

// ---------------------------------------------------------------------------
// The independent matcher (§6.7, from its words). Shares claimToken (rules 1-3
// on one token) and numbersIn (rule 4) with claims.ts; both are pinned here.

type Lang = 'en' | 'hi' | 'te'

/** Rule 8's forty English function words, copied from §6.7's text. */
const M_FUNCTION_EN = [
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'for', 'from', 'by', 'with', 'and', 'or', 'but', 'so', 'as', 'is', 'are', 'was',
  'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those', 'our', 'my', 'your', 'their', 'we', 'i', 'you', 'they', 'he', 'she', 'have'
]
/** Rule 7's negators, copied from §6.7's text. */
const M_NEGATORS = ['not', 'no', 'never', "n't", 'without', 'nor', 'neither', 'none', 'nobody', 'nothing', 'नहीं', 'न', 'मत', 'కాదు', 'లేదు']
const isNeg = (t: string): boolean => M_NEGATORS.includes(t) || /n['’]t$/u.test(t)
/** §6.2's fixed titles (never checked). */
const M_FIXED_TITLES: Record<string, string[]> = { bars: ['By the numbers', 'Compared'], steps: ['Step by step'] }
const M_WINDOW = 8
const M_RUN_GAP = 3

/** A word's own trailing clause or sentence mark. */
const M_BREAK = /[,;:—–.!?।॥…]+$/u
const M_SIGNS = ['$', '€', '£', '₹']

/** One spoken word as tokens: a leading currency sign and a trailing % split off, the rest through claimToken. */
function wordTokens(text: string): { toks: string[]; breakAfter: boolean } {
  let w = text.normalize('NFC')
  const m = M_BREAK.exec(w)
  if (m) w = w.slice(0, m.index)
  const toks: string[] = []
  const first = Array.from(w)[0]
  if (first !== undefined && M_SIGNS.includes(first)) {
    toks.push(first)
    w = w.slice(first.length)
  }
  let pct = false
  if (w.endsWith('%')) {
    pct = true
    w = w.slice(0, -1)
  }
  const t = claimToken(w)
  if (t) toks.push(t)
  if (pct) toks.push('%')
  return { toks, breakAfter: m !== null }
}
const phraseTokens = (text: string): string[] => text.split(/\s+/u).filter(Boolean).flatMap((w) => wordTokens(w).toks)

/** Tokens that belong to a spoken number's span (after its first token). */
const NUMBERISH = new Set([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty',
  'ninety', 'hundred', 'thousand', 'million', 'billion', 'lakh', 'lakhs', 'crore', 'crores', '%', 'percent', 'per', 'cent',
  'dollar', 'dollars', 'rupee', 'rupees', 'euro', 'euros', 'pound', 'pounds'
])
const isNumberish = (t: string): boolean => NUMBERISH.has(t) || /\d/u.test(t) || /^[a-z]+-[a-z]+$/u.test(t)

interface MTok {
  t: string
  sent: number
  clause: number
  /** Position among its sentence's tokens. */
  pos: number
  key: number
}
interface MNum {
  value: CanonNumber
  sent: number
  first: number
  last: number
  keys: number[]
}
interface MStretch {
  toks: MTok[]
  nums: MNum[]
}

/** The cited sentence and one either side (the generator's sentences are short, so no capping applies). */
function mStretch(t: Transcript, sentence: string): MStretch | null {
  const at = t.segments.findIndex((s) => s.id === sentence)
  if (at < 0) return null
  const segs = t.segments.slice(Math.max(0, at - 1), at + 2)
  const byIndex = new Map(t.words.map((w) => [w.index, w]))
  const toks: MTok[] = []
  let clause = 0
  let key = 0
  segs.forEach((s, sent) => {
    clause += 1
    let pos = 0
    for (let i = s.wordStart; i <= s.wordEnd; i++) {
      const w = byIndex.get(i)
      if (!w) continue
      const { toks: ts, breakAfter } = wordTokens(w.text)
      for (const x of ts) toks.push({ t: x, sent, clause, pos: pos++, key: key++ })
      if (breakAfter) clause += 1
    }
  })
  const nums: MNum[] = []
  const clauses = [...new Set(toks.map((x) => x.clause))]
  for (const c of clauses) {
    const ct = toks.filter((x) => x.clause === c)
    for (const n of numbersIn(ct.map((x) => x.t))) {
      let a = n.at
      while (a > 0 && (M_SIGNS.includes(ct[a - 1].t) || ct[a - 1].t === 'rs')) a -= 1
      let b = n.at
      while (b + 1 < ct.length && isNumberish(ct[b + 1].t) && !(ct[b + 1].t === 'and')) b += 1
      const span = ct.slice(a, b + 1)
      nums.push({ value: n.value, sent: ct[0].sent, first: span[0].pos, last: span[span.length - 1].pos, keys: span.map((x) => x.key) })
    }
  }
  return { toks, nums }
}

/** A value field's one number: exactly one number, and nothing in the field but it. */
function valueOf(text: string): CanonNumber | null {
  const ts = phraseTokens(text)
  const ns = numbersIn(ts)
  if (ns.length !== 1) return null
  if (!ts.every((t) => isNumberish(t) || M_SIGNS.includes(t) || t === 'rs' || t === 'a' || t === 'and')) return null
  return ns[0].value
}

type MKind = 'num' | 'tok' | 'run' | 'kw'
interface MClaim {
  field: string
  kind: MKind
  tok?: string
  run?: string[]
  value?: CanonNumber
  pair?: number
  negs: Set<string>
}
interface MOcc {
  keys: number[]
  sent: number
  first: number
  last: number
  clauses: number[]
  value?: CanonNumber
}

const sameVal = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b))
const unitFits = (spec: CanonNumber, said: CanonNumber): boolean =>
  spec.unit === '' || (spec.unit === '%' ? said.unit === '%' : said.unit === 'currency' && said.currency === spec.currency)
function sameTok(a: string, b: string, en: boolean): boolean {
  if (a === b) return true
  if (!en || !/^[a-z]+$/u.test(a) || !/^[a-z]+$/u.test(b)) return false
  return a + 's' === b || a + 'es' === b || b + 's' === a || b + 'es' === a
}

/**
 * Whether a graphic's data grounds in the stretch of `sentence` (§6.7 rules
 * 4-9, from the plan's words): null when it does, else why not.
 */
function grounds(data: GraphicData, t: Transcript, sentence: string): string | null {
  const st = mStretch(t, sentence)
  if (!st) return 'no such sentence'
  const en = t.language === 'en'
  const claims: MClaim[] = []
  const negsOf = (text: string): Set<string> => new Set(phraseTokens(text).filter(isNeg))
  /** A grounded field's content tokens as claims; a non-empty field with none grounds nothing. */
  const tokens = (field: string, text: string, pair?: number): string | null => {
    const ts = phraseTokens(text).filter((x) => !(en && M_FUNCTION_EN.includes(x)))
    if (text.trim() !== '' && ts.length === 0) return `${field} '${text}' says nothing`
    for (const tok of ts) claims.push({ field, kind: 'tok', tok, pair, negs: negsOf(text) })
    return null
  }
  const value = (field: string, text: string, pair: number): string | null => {
    const v = valueOf(text)
    if (!v) return `${field} '${text}' is not one number`
    claims.push({ field, kind: 'num', value: v, pair, negs: new Set() })
    return null
  }
  let bad: string | null = null
  const fixed = (template: string, title: string): boolean => (M_FIXED_TITLES[template] ?? []).includes(title)
  switch (data.template) {
    case 'counter':
    case 'ring':
      bad = value('value', data.value, 0) ?? tokens('label', data.label, 0)
      break
    case 'bars':
      if (!fixed('bars', data.title)) bad = tokens('title', data.title)
      data.items.forEach((it, i) => {
        bad = bad ?? value(`items[${i}].value`, it.value, i + 1) ?? tokens(`items[${i}].label`, it.label, i + 1)
      })
      break
    case 'steps':
      if (!fixed('steps', data.title)) bad = tokens('title', data.title)
      data.items.forEach((it, i) => {
        bad = bad ?? (it.label.trim() === '' ? `items[${i}].label is empty` : tokens(`items[${i}].label`, it.label))
      })
      break
    case 'callout':
      bad = data.label.trim() === '' ? 'empty label' : tokens('label', data.label)
      break
    case 'quote': {
      const run = phraseTokens(data.text)
      if (run.length === 0) bad = 'empty quote'
      else claims.push({ field: 'text', kind: 'run', run, negs: negsOf(data.text) })
      break
    }
    case 'keyword': {
      const words = data.words.split(/\s+/u).filter(Boolean)
      const run = phraseTokens(data.words)
      if (words.length < 1 || words.length > 4) bad = 'a keyword is 1 to 4 words'
      else if (en && run.every((x) => M_FUNCTION_EN.includes(x))) bad = 'a keyword with no content word'
      else claims.push({ field: 'words', kind: 'kw', run, negs: negsOf(data.words) })
      break
    }
    default:
      bad = `${data.template} is not a template the model writes`
  }
  if (bad) return bad

  // Every place each claim may stand.
  const sentToks = (s: number): MTok[] => st.toks.filter((x) => x.sent === s)
  const occ = (ts: MTok[], value?: CanonNumber): MOcc => ({
    keys: ts.map((x) => x.key),
    sent: ts[0].sent,
    first: Math.min(...ts.map((x) => x.pos)),
    last: Math.max(...ts.map((x) => x.pos)),
    clauses: [...new Set(ts.map((x) => x.clause))],
    ...(value ? { value } : {})
  })
  const sents = [...new Set(st.toks.map((x) => x.sent))]
  const places: MOcc[][] = claims.map((c) => {
    if (c.kind === 'num') {
      return st.nums
        .filter((n) => sameVal(n.value.n, c.value!.n) && unitFits(c.value!, n.value))
        .map((n) => ({ keys: n.keys, sent: n.sent, first: n.first, last: n.last, clauses: [], value: n.value }))
    }
    if (c.kind === 'tok') return st.toks.filter((x) => sameTok(c.tok!, x.t, en)).map((x) => occ([x]))
    const out: MOcc[] = []
    for (const s of sents) {
      const ts = sentToks(s)
      for (let i = 0; i + c.run!.length <= ts.length; i++) {
        const win = ts.slice(i, i + c.run!.length)
        if (!win.every((x, k) => x.t === c.run![k])) continue
        if (i > 0 && isNeg(ts[i - 1].t)) continue
        if (c.kind === 'kw') {
          if (new Set(win.map((x) => x.clause)).size !== 1) continue
        } else {
          const startsClause = i === 0 || ts[i - 1].clause !== win[0].clause
          const endsClause = i + win.length === ts.length || ts[i + win.length].clause !== win[win.length - 1].clause
          if (!startsClause || !endsClause) continue
        }
        out.push(occ(win))
      }
    }
    return out
  })
  const missing = claims.findIndex((_, i) => places[i].length === 0)
  if (missing >= 0) return `${claims[missing].field}: '${claims[missing].tok ?? claims[missing].run?.join(' ') ?? claims[missing].value?.n}' is not said`

  const order = [...claims.keys()].sort((a, b) => Number(claims[b].kind === 'num') - Number(claims[a].kind === 'num'))
  const chosen: (MOcc | undefined)[] = claims.map(() => undefined)
  const used = new Set<number>()
  const dist = (pos: number, o: MOcc): number => (pos < o.first ? o.first - pos : pos > o.last ? pos - o.last : 0)
  const prevInField = claims.map((c, i) => {
    if (c.kind !== 'tok' || c.pair !== undefined) return -1
    for (let j = i - 1; j >= 0; j--) if (claims[j].field === c.field) return j
    return -1
  })
  const fits = (i: number, o: MOcc): boolean => {
    if (o.keys.some((k) => used.has(k))) return false
    const c = claims[i]
    if (c.pair !== undefined) {
      const v = claims.findIndex((d) => d.kind === 'num' && d.pair === c.pair)
      const vo = chosen[v]
      if (c.kind === 'tok' && vo && (o.sent !== vo.sent || dist(o.first, vo) > M_WINDOW)) return false
    }
    const p = prevInField[i]
    if (p >= 0) {
      const po = chosen[p]!
      if (o.sent !== po.sent || o.first <= po.last || o.first - po.last - 1 > M_RUN_GAP) return false
    }
    return true
  }
  const whole = (): boolean => {
    // Spoken order across the pairs.
    const pairs = [...new Set(claims.flatMap((c) => (c.pair === undefined ? [] : [c.pair])))]
    const span = (p: number): { v: number; lo: number; hi: number } | null => {
      const v = chosen[claims.findIndex((c) => c.kind === 'num' && c.pair === p)]!
      const ls = claims.flatMap((c, i) => (c.kind === 'tok' && c.pair === p ? [chosen[i]!.first] : []))
      return ls.length === 0 ? null : { v: v.first + 1000 * v.sent, lo: Math.min(...ls) + 1000 * v.sent, hi: Math.max(...ls) + 1000 * v.sent }
    }
    for (const a of pairs) {
      for (const b of pairs) {
        const sa = span(a)
        const sb = span(b)
        if (sa && sb && sa.v < sb.v && !(sa.hi < sb.lo)) return false
      }
    }
    // No negator the field lacks in any clause a claim binds in.
    for (let i = 0; i < claims.length; i++) {
      const o = chosen[i]!
      const clauses = new Set(o.clauses.length > 0 ? o.clauses : st.toks.filter((x) => o.keys.includes(x.key)).map((x) => x.clause))
      if (st.toks.some((x) => clauses.has(x.clause) && isNeg(x.t) && !claims[i].negs.has(x.t))) return false
    }
    // The template decides on the matched numbers.
    const matched = claims.flatMap((c, i) => (c.kind === 'num' ? [chosen[i]!.value!] : []))
    if (data.template === 'ring' && !(matched[0].unit === '%' && matched[0].n >= 0 && matched[0].n <= 100)) return false
    if (data.template === 'bars' && new Set(matched.map((m) => `${m.unit}${m.currency ?? ''}`)).size > 1) return false
    return true
  }
  const search = (k: number): boolean => {
    if (k === order.length) return whole()
    const i = order[k]
    for (const o of places[i]) {
      if (!fits(i, o)) continue
      chosen[i] = o
      for (const key of o.keys) used.add(key)
      if (search(k + 1)) return true
      for (const key of o.keys) used.delete(key)
      chosen[i] = undefined
    }
    return false
  }
  return search(0) ? null : 'no binding: one occurrence each, same sentence, the window, spoken order, no unmatched negator, the unit'
}

// ---------------------------------------------------------------------------
// The talks and graphics the generators write.

const NOUNS: Record<Lang, string[]> = {
  en: ['clients', 'couples', 'albums', 'referrals', 'bookings', 'venues', 'guests', 'editors', 'reels', 'prints', 'leads', 'students', 'orders', 'followers', 'brides', 'inquiries'],
  hi: ['ग्राहक', 'शादियाँ', 'तस्वीरें', 'एल्बम', 'मेहमान', 'दुल्हनें', 'वीडियो', 'बुकिंग', 'रील्स', 'छात्र'],
  // 'వైబ్స్' holds a vowel sign NFD decomposes, so a talk written in NFD differs from the spec in NFC.
  te: ['వైబ్స్', 'క్లయింట్లు', 'పెళ్లిళ్లు', 'ఫోటోలు', 'ఆల్బమ్స్', 'అతిథులు', 'వీడియోలు', 'బుకింగ్స్', 'రీల్స్', 'విద్యార్థులు']
}
const ADJ: Record<Lang, string[]> = { en: ['new', 'happy', 'local', 'repeat'], hi: ['नए', 'खुश'], te: ['కొత్త', 'సంతోషంగా'] }
const FILL: Record<Lang, string[]> = {
  en: ['we', 'had', 'this', 'year', 'last', 'month', 'honestly', 'our', 'studio', 'then', 'you', 'see', 'in', 'total', 'really', 'season', 'got'],
  hi: ['हमने', 'पिछले', 'साल', 'इस', 'महीने', 'स्टूडियो', 'में', 'कुल', 'सच', 'तो'],
  te: ['మేము', 'గత', 'సంవత్సరం', 'ఈ', 'నెల', 'స్టూడియోలో', 'మొత్తం', 'నిజంగా']
}
const END: Record<Lang, string> = { en: '.', hi: '।', te: '.' }
const NEGATOR: Record<Lang, string> = { en: 'not', hi: 'नहीं', te: 'లేదు' }
const CAME: Record<Lang, string> = { en: 'came', hi: 'आए', te: 'వచ్చారు' }
const ZERO: Record<Lang, number> = { en: 0x30, hi: 0x966, te: 0xc66 }

const SMALL_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS_WORDS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
/** An English number word form of 1-99: 'seventeen', 'forty', 'forty-two' or 'forty two'. */
function enWords(rng: Rng, d: number): string[] {
  if (d < 20) return [SMALL_WORDS[d]]
  const t = TENS_WORDS[Math.floor(d / 10)]
  const u = d % 10
  if (u === 0) return [t]
  return rng.chance(0.5) ? [`${t}-${SMALL_WORDS[u]}`] : [t, SMALL_WORDS[u]]
}
const toNative = (s: string, lang: Lang): string => s.replace(/[0-9]/gu, (d) => String.fromCodePoint(ZERO[lang] + Number(d)))

/** A spoken number: how it is said, how a model may write it, and the same said without its unit. */
interface Num {
  said: string[]
  stripped: string[]
  written: string[]
  /** A written form that carries the said unit (for the unit generator). */
  withUnit: string
  n: number
  unit: '' | '%' | 'currency'
  family: string
}

type Family = 'bare' | 'pct' | 'cur' | 'big' | 'words'
const CUR_WORD: Record<string, string> = { $: 'dollars', '€': 'euros', '£': 'pounds', '₹': 'rupees' }

function numberOf(rng: Rng, lang: Lang, family: Family, sign = '$'): Num {
  const d = rng.int(2, 99)
  if (lang !== 'en') {
    const nat = rng.chance(0.5)
    const D = (s: string): string => (nat ? toNative(s, lang) : s)
    if (family === 'pct') return { said: [`${D(String(d))}%`], stripped: [D(String(d))], written: [`${d}%`, `${D(String(d))}%`, `${d}`], withUnit: `${d}%`, n: d, unit: '%', family }
    if (family === 'cur') return { said: [`₹${D(String(d * 10))}`], stripped: [D(String(d * 10))], written: [`₹${d * 10}`, `${d * 10}`], withUnit: `₹${d * 10}`, n: d * 10, unit: 'currency', family }
    if (family === 'big') {
      const l = rng.int(2, 9)
      return { said: [D(`${l},00,000`)], stripped: [D(`${l},00,000`)], written: [`${l},00,000`, `${l}00,000`, `${l} lakh`], withUnit: '', n: l * 1e5, unit: '', family }
    }
    return { said: [D(String(d))], stripped: [D(String(d))], written: [String(d), D(String(d))], withUnit: '', n: d, unit: '', family }
  }
  switch (family) {
    case 'pct': {
      const dec = rng.chance(0.15)
      const v = dec ? d + 0.5 : d
      const said = rng.pick([[`${v}%`], [`${v}`, 'percent'], [`${v}`, 'per', 'cent'], ...(dec ? [] : [[...enWords(rng, d), 'percent']])])
      const stripped = said.filter((w) => !['percent', 'per', 'cent'].includes(w)).map((w) => w.replace(/%$/u, ''))
      return { said, stripped, written: [`${v}%`, `${v} percent`, `${v}`], withUnit: `${v}%`, n: v, unit: '%', family }
    }
    case 'cur': {
      const v = sign === '₹' ? d * 10 : d
      const said = rng.pick([[`${sign}${v}`], [`${v}`, CUR_WORD[sign]]])
      return { said, stripped: [`${v}`], written: [`${sign}${v}`, `${v} ${CUR_WORD[sign]}`, `${v}`], withUnit: `${sign}${v}`, n: v, unit: 'currency', family }
    }
    case 'big': {
      const k = rng.int(0, 4)
      if (k === 0) {
        const t = rng.int(2, 99)
        const said = rng.pick([[`${t},000`], [`${t}k`], [`${t}`, 'thousand'], [`${t}000`]])
        return { said, stripped: said, written: [`${t},000`, `${t}k`, `${t} thousand`, `${t}000`], withUnit: '', n: t * 1000, unit: '', family }
      }
      if (k === 1) {
        const l = rng.int(2, 9)
        const said = rng.pick([[`${l}`, 'lakh'], [`${l},00,000`]])
        return { said, stripped: said, written: [`${l} lakh`, `${l},00,000`, `${l}00,000`], withUnit: '', n: l * 1e5, unit: '', family }
      }
      if (k === 2) {
        const m = rng.int(11, 49) / 10
        const said = rng.pick([[`${m}`, 'million'], [`${m}m`]])
        return { said, stripped: said, written: [`${m} million`, `${m}m`, `${m}M`], withUnit: '', n: m * 1e6, unit: '', family }
      }
      if (k === 3) {
        const c = rng.int(2, 9)
        const said = rng.pick([[`${c}`, 'crore'], [`${c},00,00,000`]])
        return { said, stripped: said, written: [`${c} crore`, `${c},00,00,000`], withUnit: '', n: c * 1e7, unit: '', family }
      }
      const h = rng.pick([{ said: ['a', 'hundred'], n: 100 }, { said: ['two', 'hundred', 'and', 'five'], n: 205 }, { said: ['three', 'hundred'], n: 300 }])
      return { said: h.said, stripped: h.said, written: [String(h.n)], withUnit: '', n: h.n, unit: '', family }
    }
    case 'words': {
      const said = enWords(rng, d)
      return { said, stripped: said, written: [String(d)], withUnit: '', n: d, unit: '', family }
    }
    default:
      return { said: [String(d)], stripped: [String(d)], written: [String(d)], withUnit: '', n: d, unit: '', family }
  }
}

type Tpl = 'counter' | 'ring' | 'bars' | 'steps' | 'quote' | 'callout' | 'keyword'
const TEMPLATES: Tpl[] = ['counter', 'ring', 'bars', 'steps', 'quote', 'callout', 'keyword']

/** Where a pair stands in the fact sentence (word indices into it). */
interface PairAt {
  num: Num
  numAt: number
  label: string[]
  labelAt: number
}
/** A generated case: its talk (sentences of words), which is the fact's, which the graphic cites, and the graphic. */
interface Case {
  seed: number
  lang: Lang
  template: Tpl
  sentences: string[][]
  fact: number
  cite: number
  graphic: AnswerGraphic
  pairs?: PairAt[]
  /** The bound word of a non-pair graphic: steps' items' first words, callout's label, quote's run, keyword's run. */
  runs?: { at: number; len: number }[]
}

const fill = (rng: Rng, lang: Lang, lo: number, hi: number): string[] => Array.from({ length: rng.int(lo, hi) }, () => rng.pick(FILL[lang]))
const labelOf = (rng: Rng, lang: Lang, noun: string): string[] => (rng.chance(0.3) ? [rng.pick(ADJ[lang]), noun] : [noun])
const ended = (words: string[], lang: Lang): string[] => words.map((w, i) => (i === words.length - 1 ? w + END[lang] : w))

/** A sentence that says none of `avoid`'s nouns: fill, one other noun, sometimes a bare number. */
function neighbour(rng: Rng, lang: Lang, avoid: Set<string>): string[] {
  // Neither a noun the fact says nor its English plural or singular.
  const nouns = NOUNS[lang].filter((n) => ![...avoid].some((a) => sameTok(a.toLowerCase(), n, lang === 'en')))
  const noun = rng.pick(nouns)
  avoid.add(noun)
  const words = [...fill(rng, lang, 1, 3), noun, ...(rng.chance(0.4) ? [String(rng.int(2, 99)), rng.pick(nouns.filter((n) => n !== noun))] : []), ...fill(rng, lang, 1, 2)]
  return ended(words, lang)
}

function answerGraphic(fields: Partial<AnswerGraphic> & Pick<AnswerGraphic, 'sentence' | 'template'>): AnswerGraphic {
  return { title: '', value: '', label: '', items: [], quote: '', words: '', lit: 0, why: 'it shows the fact', ...fields }
}

const STEP_VERBS: Record<Lang, string[]> = {
  en: ['charge', 'format', 'pack', 'clean', 'label', 'export', 'upload', 'print', 'sort', 'backup'],
  hi: ['चार्ज', 'फॉर्मेट', 'पैक', 'साफ़', 'चेक'],
  te: ['ఛార్జ్', 'ఫార్మాట్', 'ప్యాక్', 'శుభ్రం', 'చెక్']
}
const STEP_NOUNS: Record<Lang, string[]> = {
  en: ['batteries', 'cards', 'bag', 'lenses', 'files', 'drives', 'tripods', 'gimbal', 'flashes'],
  hi: ['बैटरी', 'कार्ड', 'बैग', 'लेंस', 'फ़ाइलें', 'ड्राइव'],
  te: ['బ్యాటరీ', 'కార్డ్', 'బ్యాగ్', 'లెన్స్', 'ఫైల్స్', 'డ్రైవ్']
}
const STEP_DO: Record<Lang, string> = { en: '', hi: 'करें', te: 'చేయండి' }
const STEP_JOIN: Record<Lang, [string, string]> = { en: ['first', 'then'], hi: ['पहले', 'फिर'], te: ['ముందు', 'తర్వాత'] }
const CALLOUT_NOUNS: Record<Lang, string[]> = {
  en: ['bride', 'groom', 'cake', 'dress', 'venue', 'camera', 'bouquet'],
  hi: ['दुल्हन', 'दूल्हा', 'केक', 'अंगूठी'],
  te: ['వధువు', 'వరుడు', 'కేక్', 'ఉంగరం']
}
const QUOTE_WORDS: Record<Lang, string[]> = {
  en: ['light', 'beats', 'gear', 'every', 'time', 'good', 'stories', 'sell', 'themselves', 'shoot', 'what', 'you', 'love', 'clients', 'remember', 'feelings', 'keep', 'it', 'simple'],
  hi: ['रोशनी', 'गियर', 'से', 'बड़ी', 'है', 'कहानी', 'हमेशा', 'जीतती', 'अच्छी', 'तस्वीरें', 'याद', 'रहती', 'हैं'],
  te: ['వెలుగు', 'గేర్', 'కంటే', 'ముఖ్యం', 'కథ', 'ఎప్పుడూ', 'గెలుస్తుంది', 'మంచి', 'ఫోటోలు', 'గుర్తుంటాయి']
}
const QUOTE_INTRO: Record<Lang, string[][]> = {
  en: [['honestly'], ['for', 'me'], ['look'], ['in', 'the', 'end'], ['believe', 'me'], ['my', 'rule']],
  hi: [['सच', 'में'], ['मेरे', 'लिए']],
  te: [['నిజంగా'], ['నా', 'దృష్టిలో']]
}

/** The fact sentence and graphic for one template. */
function factFor(rng: Rng, lang: Lang, template: Tpl, cite: string): { words: string[]; graphic: AnswerGraphic; pairs?: PairAt[]; runs?: { at: number; len: number }[]; nouns: string[] } {
  switch (template) {
    case 'counter':
    case 'ring': {
      const family: Family = template === 'ring' ? 'pct' : rng.pick(lang === 'en' ? ['bare', 'pct', 'cur', 'big', 'words'] : ['bare', 'pct', 'cur', 'big'])
      const num = numberOf(rng, lang, family, rng.pick(M_SIGNS))
      const noun = rng.pick(NOUNS[lang])
      const label = labelOf(rng, lang, noun)
      const head = fill(rng, lang, 1, 3)
      let words: string[]
      let numAt: number
      let labelAt: number
      if (lang === 'en' && rng.chance(0.3)) {
        // the label before the number: '... referrals reached 40% ...'
        words = [...head, ...label, 'reached', ...num.said, ...fill(rng, lang, 0, 2)]
        labelAt = head.length
        numAt = head.length + label.length + 1
      } else {
        const of = lang === 'en' && rng.chance(0.3) ? ['of', 'our'] : []
        words = [...head, ...num.said, ...of, ...label, ...(lang === 'en' ? fill(rng, lang, 0, 2) : [CAME[lang]])]
        numAt = head.length
        labelAt = head.length + num.said.length + of.length
      }
      // In English the model may write the singular of a plural said (rule 8 folds s and es).
      const written = lang === 'en' && rng.chance(0.25) ? label.map((w) => w.replace(/s$/u, '')) : label
      const graphic = answerGraphic({ sentence: cite, template, value: rng.pick(num.written), label: written.join(' ') })
      return { words: ended(words, lang), graphic, pairs: [{ num, numAt, label, labelAt }], nouns: [noun] }
    }
    case 'bars': {
      const family: Family = rng.pick(['bare', 'pct', 'cur', 'big'])
      const sign = rng.pick(M_SIGNS)
      const k = rng.int(2, 4)
      const nouns = rng.sample(NOUNS[lang], k)
      const nums: Num[] = []
      while (nums.length < k) {
        const n = numberOf(rng, lang, family, sign)
        if (!nums.some((m) => m.n === n.n)) nums.push(n)
      }
      const labelFirst = lang === 'en' && rng.chance(0.4)
      const words: string[] = [...fill(rng, lang, 1, 2)]
      const pairs: PairAt[] = []
      nouns.forEach((noun, i) => {
        if (i > 0) {
          if (rng.chance(0.5)) words[words.length - 1] += ','
          else words.push(lang === 'en' ? 'and' : lang === 'hi' ? 'और' : 'మరియు')
        }
        const label = [noun]
        if (labelFirst) {
          pairs.push({ num: nums[i], numAt: words.length + 1, label, labelAt: words.length })
          words.push(noun, ...nums[i].said)
        } else {
          pairs.push({ num: nums[i], numAt: words.length, label, labelAt: words.length + nums[i].said.length })
          words.push(...nums[i].said, noun)
        }
      })
      if (lang !== 'en') words.push(CAME[lang])
      const graphic = answerGraphic({
        sentence: cite,
        template,
        title: rng.pick(['', 'By the numbers', 'Compared']),
        items: pairs.map((p) => ({ label: p.label.join(' '), value: rng.pick(p.num.written) }))
      })
      return { words: ended(words, lang), graphic, pairs, nouns }
    }
    case 'steps': {
      const k = rng.int(2, 4)
      const verbs = rng.sample(STEP_VERBS[lang], k)
      const objs = rng.sample(STEP_NOUNS[lang], k)
      const words: string[] = []
      const runs: { at: number; len: number }[] = []
      const labels: string[] = []
      verbs.forEach((v, i) => {
        if (i > 0) words[words.length - 1] += ','
        words.push(i === 0 ? STEP_JOIN[lang][0] : STEP_JOIN[lang][1])
        const at = words.length
        let item: string[]
        if (lang === 'en') item = rng.chance(0.5) ? [v, 'the', objs[i]] : [v, objs[i]]
        else item = [objs[i], v, STEP_DO[lang]]
        words.push(...item)
        runs.push({ at, len: item.length })
        labels.push(lang === 'en' && rng.chance(0.5) ? [v, objs[i]].join(' ') : item.join(' '))
      })
      const graphic = answerGraphic({ sentence: cite, template, title: rng.pick(['', 'Step by step']), items: labels.map((label) => ({ label, value: '' })) })
      return { words: ended(words, lang), graphic, runs, nouns: [] }
    }
    case 'callout': {
      const noun = rng.pick(CALLOUT_NOUNS[lang])
      const pre = lang === 'en' ? ['look', 'at', 'the'] : lang === 'hi' ? ['यहाँ'] : ['ఇక్కడ']
      const post = lang === 'en' ? ['right', 'here'] : lang === 'hi' ? ['देखिए'] : ['చూడండి']
      const words = [...pre, noun, ...post]
      const label = lang === 'en' && rng.chance(0.5) ? `the ${noun}` : noun
      return { words: ended(words, lang), graphic: answerGraphic({ sentence: cite, template, label }), runs: [{ at: pre.length, len: 1 }], nouns: [] }
    }
    case 'quote': {
      const intro = rng.pick(QUOTE_INTRO[lang])
      const clause = Array.from({ length: rng.int(2, 8) }, () => rng.pick(QUOTE_WORDS[lang]))
      const words = [...intro.slice(0, -1), intro[intro.length - 1] + ',', ...clause]
      return { words: ended(words, lang), graphic: answerGraphic({ sentence: cite, template, quote: clause.join(' ') }), runs: [{ at: intro.length, len: clause.length }], nouns: [] }
    }
    case 'keyword': {
      const nouns = rng.sample(NOUNS[lang], 2)
      const words = [...fill(rng, lang, 1, 3), nouns[0], ...fill(rng, lang, 0, 2), nouns[1], ...fill(rng, lang, 0, 2)]
      // A run of 1-4 words holding a noun (a content word in English).
      const holds = words.map((w, i) => (nouns.includes(w) ? i : -1)).filter((i) => i >= 0)
      const anchor = rng.pick(holds)
      const len = rng.int(1, 4)
      const start = Math.max(0, Math.min(anchor - rng.int(0, len - 1), words.length - len))
      const run = words.slice(start, start + Math.min(len, words.length - start))
      const graphic = answerGraphic({ sentence: cite, template, words: run.join(' '), lit: rng.int(0, run.length - 1) })
      return { words: ended(words, lang), graphic, runs: [{ at: start, len: run.length }], nouns }
    }
  }
}

/** One true case: a talk of 3-4 sentences, the fact in one, the graphic citing it or a neighbour. */
function trueCase(seed: number, lang: Lang, template: Tpl): Case {
  const rng = new Rng(seed)
  const count = rng.int(3, 4)
  const fact = rng.int(0, count - 1)
  const cite = Math.min(count - 1, Math.max(0, fact + rng.pick([-1, 0, 0, 1])))
  const f = factFor(rng, lang, template, `s${String(cite).padStart(2, '0')}`)
  const avoid = new Set([...f.nouns, ...f.words.map((w) => w.replace(M_BREAK, ''))])
  const sentences = Array.from({ length: count }, (_, i) => (i === fact ? f.words : neighbour(rng, lang, avoid)))
  return { seed, lang, template, sentences, fact, cite, graphic: f.graphic, pairs: f.pairs, runs: f.runs }
}

/** The transcript of a case's sentences: 400 ms a word; in Hindi and Telugu a third of the talks in NFD. */
function transcriptOf(c: Case): Transcript {
  const nfd = c.lang !== 'en' && c.seed % 3 === 0
  const words: Word[] = []
  const segments: Segment[] = []
  let index = 0
  c.sentences.forEach((ws, k) => {
    const start = index
    for (const w of ws) {
      words.push({ index, text: nfd ? w.normalize('NFD') : w, startMs: index * 400, endMs: index * 400 + 350, confidence: null })
      index += 1
    }
    segments.push({ id: `s${String(k).padStart(2, '0')}`, startMs: start * 400, endMs: (index - 1) * 400 + 350, text: ws.join(' '), wordStart: start, wordEnd: index - 1 })
  })
  return { assetId: 'asset-1', language: c.lang, model: 'test', durationMs: index * 400, words, segments }
}

function menuOf(t: Transcript): GraphicsMenu {
  return {
    assetId: t.assetId,
    clipId: 'clip-1',
    language: t.language,
    sentences: t.segments.map((s) => ({ id: s.id, startMs: s.startMs, text: s.text, wordStart: s.wordStart, wordEnd: s.wordEnd })),
    templates: ['counter', 'bars', 'steps', 'quote', 'callout', 'ring', 'keyword'],
    wordSource: 'whisper'
  }
}

function settle(c: Case, graphic: AnswerGraphic = c.graphic): { s: SettledGraphics; t: Transcript } {
  const t = transcriptOf(c)
  return { s: settleGraphics({ value: { reasoning: 'r', graphics: [graphic] }, truncated: false }, menuOf(t), t), t }
}

/** A case as a failure line: the seed, language, template, talk and graphic. */
function show(c: Case, graphic: AnswerGraphic | GraphicData = c.graphic): string {
  return `seed ${c.seed} ${c.lang} ${c.template} cite s0${c.cite}: [${c.sentences.map((s) => s.join(' ')).join(' | ')}] ${JSON.stringify(graphic)}`
}

/** The graphic the answer graphic describes, as data (for the matcher's view of a false graphic). */
function dataOfAnswer(g: AnswerGraphic): GraphicData {
  switch (g.template) {
    case 'counter':
    case 'ring':
      return { template: g.template, value: g.value, label: g.label }
    case 'bars':
      return { template: 'bars', title: g.title, items: g.items.map((i) => ({ label: i.label, value: i.value })) }
    case 'steps':
      return { template: 'steps', title: g.title, items: g.items.map((i) => ({ label: i.label })), connector: 'none' }
    case 'quote':
      return { template: 'quote', kind: 'said', text: g.quote, speaker: '' }
    case 'callout':
      return { template: 'callout', label: g.label, shape: 'arrow' }
    default:
      return { template: 'keyword', words: g.words, lit: g.lit }
  }
}

// ---------------------------------------------------------------------------
// The painter's view: the settled frame's text items.

const SIZE = { width: 1080, height: 1920 }
const FPS = 30
const fakeMeasure: TextMeasure = (text, look) => ({ width: text.length * look.px * 0.55, ascent: look.px * 0.8, descent: look.px * 0.2 })
/** The glyphs §6.2's table lists that no data field holds: the quote's marks and dash, steps' numerals. */
const FIXED_GLYPHS = ['“', '”', '— ', '1', '2', '3', '4', '5', '6']
const RING_PERCENT = /%|\bper\s?cent\b/iu
const normalised = (s: string): string => s.split(/\s+/u).filter(Boolean).join(' ')

function flat(items: readonly DrawItem[]): DrawItem[] {
  return items.flatMap((i) => (i.kind === 'group' ? flat(i.children) : [i]))
}

/** The kept graphic at its settled frame: beats from its beat words, 0.15 s apart from 0.3 s; null when it does not fit (§6.2, "Too big": the store drops it, nothing is drawn). */
function settledList(k: GraphicCandidate): DrawList | null {
  const def = GRAPHIC_TEMPLATES[k.data.template]!
  const beats = (k.beatWords.length > 0 ? k.beatWords : [0]).map((_, i) => 0.3 + 0.15 * i)
  const spec: GraphicSpec = { data: k.data, seconds: def.seconds.default, beats, place: { auto: true, third: 'middle' }, seed: 7, version: 0 }
  const style = resolveGraphicStyle('clean')
  const total = Math.max(1, Math.round(spec.seconds * FPS))
  const frame = graphicMovingFrames(spec, style, FPS, total) - 1
  const targets = k.data.template === 'callout' ? { subject: { x: 300, y: 1300, width: 240, height: 320 } } : {}
  if (!graphicFits(spec, style, SIZE, fakeMeasure, targets)) return null
  return drawListAt(spec, style, frame, FPS, SIZE, fakeMeasure, targets)
}

/** Every string a kept graphic's data asks the painter to draw, by source path (the ring's % glyph added where §6.2 adds it). */
function expectedDrawn(d: GraphicData): Record<string, string> {
  switch (d.template) {
    case 'counter':
      return { 'data.value': d.value, 'data.label': d.label }
    case 'ring':
      return { 'data.value': RING_PERCENT.test(d.value) ? d.value : `${d.value}%`, 'data.label': d.label }
    case 'bars':
    case 'steps': {
      const out: Record<string, string> = { 'data.title': d.title }
      d.items.forEach((it, i) => {
        out[`data.items.${i}.label`] = it.label
        if ('value' in it) out[`data.items.${i}.value`] = it.value
      })
      return out
    }
    case 'quote':
      return d.kind === 'social' ? {} : { 'data.text': normalised(d.text), 'data.speaker': d.speaker }
    case 'callout':
      return { 'data.label': d.label }
    case 'keyword':
      return { 'data.words': normalised(d.words) }
    default:
      return {}
  }
}

/**
 * Whether what the painter draws for a kept graphic grounds: null when it
 * does, else why not. (a) Each drawn field is exactly the string the
 * validator checked, nothing else is drawn but the fixed glyphs, and the
 * frame is not empty; (b) the drawn strings, put back as the graphic's data,
 * ground by the matcher; a drawn speaker is a word of the stretch.
 */
function drawnGrounds(k: GraphicCandidate, t: Transcript): string | null {
  const list = settledList(k)
  if (list === null) return null
  const texts = flat(list.items).filter((i): i is TextItem => i.kind === 'text')
  if (texts.length === 0) return 'nothing drawn'
  const drawn = new Map<string, TextItem[]>()
  for (const x of texts) {
    if (!x.source) {
      if (!FIXED_GLYPHS.includes(x.text)) return `'${x.text}' is drawn with no field and is not a fixed glyph`
      continue
    }
    drawn.set(x.source.path, [...(drawn.get(x.source.path) ?? []), x])
  }
  const field = (path: string): string => (drawn.get(path) ?? []).sort((a, b) => a.source!.piece - b.source!.piece).map((x) => x.text).join(' ')
  const want = expectedDrawn(k.data)
  for (const path of drawn.keys()) if (!(path in want)) return `${path} is drawn and is no field of the data`
  for (const [path, text] of Object.entries(want)) {
    if (field(path) !== normalised(text)) return `${path} is drawn '${field(path)}', the validator checked '${text}'`
  }
  // The drawn strings back into data, through the matcher.
  const d = k.data
  let back: GraphicData
  switch (d.template) {
    case 'counter':
    case 'ring':
      back = { template: d.template, value: field('data.value'), label: field('data.label') }
      break
    case 'bars':
      back = { template: 'bars', title: field('data.title'), items: d.items.map((_, i) => ({ label: field(`data.items.${i}.label`), value: field(`data.items.${i}.value`) })) }
      break
    case 'steps':
      back = { template: 'steps', title: field('data.title'), items: d.items.map((_, i) => ({ label: field(`data.items.${i}.label`) })), connector: d.connector }
      break
    case 'quote':
      back = { template: 'quote', kind: 'said', text: field('data.text'), speaker: '' }
      if (field('data.speaker') !== '') {
        const st = mStretch(t, k.sentence)!
        const said = phraseTokens(field('data.speaker'))
        if (!said.every((x) => st.toks.some((y) => y.t === x))) return `the speaker '${field('data.speaker')}' is not said`
      }
      break
    case 'callout':
      back = { template: 'callout', label: field('data.label'), shape: d.shape }
      break
    case 'keyword':
      back = { template: 'keyword', words: field('data.words'), lit: d.lit }
      break
    default:
      return `${d.template} is not drawn here`
  }
  const why = grounds(back, t, k.sentence)
  return why === null ? null : `drawn: ${why}`
}

// ---------------------------------------------------------------------------
// The two shared functions, pinned by hand (the matcher's own footing).

describe('the matcher’s two shared functions, pinned against hand-written expectations', () => {
  it('claimToken: NFC, lower case, edges trimmed, combining marks kept, native digits to ASCII', () => {
    expect(claimToken('Clients,')).toBe('clients')
    expect(claimToken('పెళ్లిళ్లు')).toBe('పెళ్లిళ్లు')
    // NFC: a decomposed Telugu AI vowel sign and a decomposed é meet their composed twins.
    for (const w of ['వైబ్స్', 'Café']) {
      expect(w.normalize('NFD')).not.toBe(w.normalize('NFC'))
      expect(claimToken(w.normalize('NFD'))).toBe(w.normalize('NFC').toLowerCase())
    }
    expect(claimToken('४०')).toBe('40')
    expect(claimToken('౭౫')).toBe('75')
    expect(claimToken('1.2')).toBe('1.2')
    expect(claimToken('10,00,000')).toBe('10,00,000')
    expect(claimToken('Forty-Two')).toBe('forty-two')
  })

  it('numbersIn: each format the generators write, by value and unit', () => {
    const v = (text: string): { n: number; unit: string; currency?: string }[] => numbersIn(phraseTokens(text)).map((x) => ({ ...x.value }))
    expect(v('40')).toEqual([{ n: 40, unit: '' }])
    expect(v('40%')).toEqual([{ n: 40, unit: '%' }])
    expect(v('40 percent')).toEqual([{ n: 40, unit: '%' }])
    expect(v('40 per cent')).toEqual([{ n: 40, unit: '%' }])
    expect(v('forty percent')).toEqual([{ n: 40, unit: '%' }])
    expect(v('12.5%')).toEqual([{ n: 12.5, unit: '%' }])
    expect(v('$40')).toEqual([{ n: 40, unit: 'currency', currency: '$' }])
    expect(v('40 dollars')).toEqual([{ n: 40, unit: 'currency', currency: '$' }])
    expect(v('₹400')).toEqual([{ n: 400, unit: 'currency', currency: '₹' }])
    expect(v('40 euros')).toEqual([{ n: 40, unit: 'currency', currency: '€' }])
    expect(v('40,000')).toEqual([{ n: 40000, unit: '' }])
    expect(v('40000')).toEqual([{ n: 40000, unit: '' }])
    expect(v('40k')).toEqual([{ n: 40000, unit: '' }])
    expect(v('40 thousand')).toEqual([{ n: 40000, unit: '' }])
    expect(v('5 lakh')).toEqual([{ n: 500000, unit: '' }])
    expect(v('5,00,000')).toEqual([{ n: 500000, unit: '' }])
    expect(v('2.4 million')).toEqual([{ n: 2400000, unit: '' }])
    expect(v('2.4M')).toEqual([{ n: 2400000, unit: '' }])
    expect(v('3 crore')).toEqual([{ n: 30000000, unit: '' }])
    expect(v('3,00,00,000')).toEqual([{ n: 30000000, unit: '' }])
    expect(v('a hundred')).toEqual([{ n: 100, unit: '' }])
    expect(v('two hundred and five')).toEqual([{ n: 205, unit: '' }])
    expect(v('forty-two')).toEqual([{ n: 42, unit: '' }])
    expect(v('forty two')).toEqual([{ n: 42, unit: '' }])
    expect(v('seventeen')).toEqual([{ n: 17, unit: '' }])
    expect(v('४०%')).toEqual([{ n: 40, unit: '%' }])
    expect(v('౪,౦౦,౦౦౦')).toEqual([{ n: 400000, unit: '' }])
    expect(v('1.2')).not.toEqual(v('12'))
    expect(v('we had 30 clients and 70 guests')).toEqual([{ n: 30, unit: '' }, { n: 70, unit: '' }])
    // Hindi number words are not parsed (v1).
    expect(v('चालीस')).toEqual([])
  })
})

describe('the independent matcher, by hand: it binds, it does not just match (§6.7’s review cases)', () => {
  const talk = (sentences: string[], language: Lang = 'en'): Transcript =>
    transcriptOf({ seed: 1, lang: language, template: 'counter', sentences: sentences.map((s) => s.split(' ')), fact: 0, cite: 0, graphic: answerGraphic({ sentence: 's00', template: 'counter' }) })
  it('grounds what was said', () => {
    expect(grounds({ template: 'counter', value: '40', label: 'clients' }, talk(['we signed 40 clients.']), 's00')).toBeNull()
    expect(grounds({ template: 'ring', value: '30%', label: 'Instagram' }, talk(['30% of our clients came from Instagram and 70% from referrals.']), 's00')).toBeNull()
  })
  it('refuses each review case', () => {
    const insta = talk(['30% of our clients came from Instagram and 70% from referrals.'])
    expect(grounds({ template: 'bars', title: '', items: [{ label: 'Instagram', value: '70%' }, { label: 'referrals', value: '30%' }] }, insta, 's00')).not.toBeNull()
    expect(grounds({ template: 'bars', title: '', items: [{ label: '2019', value: '12' }, { label: 'now', value: '3' }] }, talk(['We had 3 offices and 40 staff in 2019, now 12 offices.']), 's00')).not.toBeNull()
    expect(grounds({ template: 'ring', value: '90%', label: 'startups fail' }, talk(["It's not true that 90% of startups fail."]), 's00')).not.toBeNull()
    expect(grounds({ template: 'ring', value: '40', label: 'clients' }, talk(['we signed 40 clients.']), 's00')).not.toBeNull()
    expect(grounds({ template: 'bars', title: '', items: [{ label: 'ads', value: '40' }, { label: 'signups', value: '40' }] }, talk(['we spent $40 on ads and 40% of signups came from them.']), 's00')).not.toBeNull()
  })
  it('refuses a label from the next sentence, a gapped keyword, a keyword in a negated clause', () => {
    const t = talk(['we signed 40 couples.', 'clients loved it.'])
    expect(grounds({ template: 'counter', value: '40', label: 'clients' }, t, 's00')).not.toBeNull()
    expect(grounds({ template: 'keyword', words: 'signed couples', lit: 0 }, t, 's00')).not.toBeNull()
    expect(grounds({ template: 'keyword', words: 'signed 40', lit: 0 }, t, 's00')).toBeNull()
    expect(grounds({ template: 'keyword', words: 'easy', lit: 0 }, talk(['this is not easy.']), 's00')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The property.

const LANGS: Lang[] = ['en', 'hi', 'te']
const PER = 60
/** Every true case, generated once: PER per template per language. */
const TRUE_CASES: Case[] = LANGS.flatMap((lang, li) =>
  TEMPLATES.flatMap((template, ti) => Array.from({ length: PER }, (_, i) => trueCase(100_000 + 10_000 * li + 1000 * ti + i, lang, template)))
)
/** Each true case settled, once. */
const SETTLED = TRUE_CASES.map((c) => ({ c, ...settle(c) }))
const KEPT_TRUE = SETTLED.filter((x) => x.s.kept.length === 1)

/** A run of failure lines as an assertion: the first few in full. */
function noFailures(failures: string[]): void {
  expect(failures.slice(0, 4), `${failures.length} failing`).toEqual([])
}

describe('the property: every graphic settleGraphics keeps grounds by the independent matcher, as data and as drawn (§6.7, §6.12)', () => {
  it('the generator writes every template the model may write, in English, Hindi and Telugu, each sentence short enough to need no cap', () => {
    for (const lang of LANGS) for (const template of TEMPLATES) expect(TRUE_CASES.filter((c) => c.lang === lang && c.template === template)).toHaveLength(PER)
    for (const c of TRUE_CASES) for (const s of c.sentences) expect(s.length, show(c)).toBeLessThanOrEqual(30)
    // Talks whose words differ in NFD from the spec's NFC, kept.
    const nfd = KEPT_TRUE.filter(({ t }) => t.words.some((w) => w.text !== w.text.normalize('NFC')))
    expect(nfd.length, 'kept graphics over NFD talks').toBeGreaterThanOrEqual(5)
    // Numbers in every format rule 4 names.
    const said = TRUE_CASES.flatMap((c) => c.pairs ?? []).map((p) => p.num.said.join(' '))
    for (const shape of [/^\d+$/u, /^\d+%$/u, /^\d+(\.\d+)? percent$/u, /per cent$/u, /^[$€£]\d+$/u, /^₹/u, / (dollars|euros|pounds)$/u, /^\d+,000$/u, /,00,000$/u, /,00,00,000$/u, /k$/u, / thousand$/u, / lakh$/u, / million$/u, /\dm$/u, / crore$/u, /hundred/u, /^[a-z]+(-[a-z]+)?$/u, /^[a-z]+ [a-z]+ percent$/u, /^\d+\.\d+%$/u, /[०-९]/u, /[౦-౯]/u]) {
      expect(said.some((s) => shape.test(s)), `a number said like ${shape}`).toBe(true)
    }
  })

  it('every true graphic the generator writes grounds by the matcher (the generator says what it means to)', () => {
    noFailures(TRUE_CASES.flatMap((c) => {
      const why = grounds(dataOfAnswer(c.graphic), transcriptOf(c), c.graphic.sentence)
      return why === null ? [] : [`${why} — ${show(c)}`]
    }))
  })

  it('keeps enough of them that the property is not vacuous: a floor per template and language', () => {
    for (const lang of LANGS) {
      for (const template of TEMPLATES) {
        const n = KEPT_TRUE.filter((x) => x.c.lang === lang && x.c.template === template).length
        expect(n, `${lang} ${template}: ${n} of ${PER} kept`).toBeGreaterThanOrEqual(FLOOR_KEPT)
      }
    }
  })

  it('every kept graphic grounds by the independent matcher', () => {
    noFailures(KEPT_TRUE.flatMap(({ c, s, t }) => {
      const k = s.kept[0]
      const why = grounds(k.data, t, k.sentence)
      return why === null ? [] : [`${why} — ${show(c, k.data)}`]
    }))
  })

  it('what the painter draws for every kept graphic, at its settled frame, is what the validator checked, and grounds', () => {
    noFailures(KEPT_TRUE.flatMap(({ c, s, t }) => {
      const why = drawnGrounds(s.kept[0], t)
      return why === null ? [] : [`${why} — ${show(c, s.kept[0].data)}`]
    }))
    // Drawn, not only dropped as too big: a floor per template.
    for (const template of TEMPLATES) {
      const drawn = KEPT_TRUE.filter((x) => x.c.template === template && settledList(x.s.kept[0]) !== null).length
      expect(drawn, `${template}: ${drawn} kept graphics drawn`).toBeGreaterThanOrEqual(FLOOR_DRAWN)
    }
  })
})

/** The fewest of PER true cases per template and language settleGraphics must keep. */
const FLOOR_KEPT = 50
/** The fewest kept graphics per template that fit and are drawn (the rest are §6.2's "Too big"). */
const FLOOR_DRAWN = 150
/** The fewest cases each adversarial generator must produce. */
const FLOOR_ADVERSARIAL = 150

// ---------------------------------------------------------------------------
// The adversarial generators.

/** A case with its fact sentence's words replaced. */
const withFact = (c: Case, words: string[]): Case => ({ ...c, sentences: c.sentences.map((s, i) => (i === c.fact ? words : s)) })
/** The word index where the clause holding word `i` of a sentence starts. */
function clauseStart(words: readonly string[], i: number): number {
  let s = i
  while (s > 0 && !M_BREAK.test(words[s - 1])) s -= 1
  return s
}
const insertAt = (words: readonly string[], i: number, w: string): string[] => [...words.slice(0, i), w, ...words.slice(i)]

/** What one adversarial generator made of one kept true case: a false case, or nothing to make. */
type Made = { case: Case; graphic: AnswerGraphic } | null

const ADVERSARIAL: { name: string; from: Tpl[]; make: (c: Case, rng: Rng) => Made; outcome: 'dropped' }[] = [
  {
    name: 'swap the values of two pairs',
    from: ['bars'],
    make: (c, rng) => {
      const items = c.graphic.items
      const [i, j] = rng.sample([...items.keys()], 2)
      const swapped = items.map((it, k) => (k === i ? { ...it, value: items[j].value } : k === j ? { ...it, value: items[i].value } : it))
      return { case: c, graphic: { ...c.graphic, items: swapped } }
    },
    outcome: 'dropped'
  },
  {
    name: 'insert a negator into the bound clause',
    from: ['counter', 'ring', 'bars', 'steps', 'callout', 'quote'],
    make: (c, rng) => {
      const words = c.sentences[c.fact]
      const at = c.pairs ? rng.pick(c.pairs).numAt : rng.pick(c.runs!).at
      return { case: withFact(c, insertAt(words, clauseStart(words, at), NEGATOR[c.lang])), graphic: c.graphic }
    },
    outcome: 'dropped'
  },
  {
    name: 'take a label from the neighbouring sentence',
    from: ['counter', 'ring', 'bars'],
    make: (c, rng) => {
      const near = [c.fact - 1, c.fact + 1].filter((i) => i >= 0 && i < c.sentences.length && Math.abs(i - c.cite) <= 1)
      if (near.length === 0) return null
      const fact = new Set(c.sentences[c.fact].map((w) => w.replace(M_BREAK, '')))
      const nouns = c.sentences[rng.pick(near)].map((w) => w.replace(M_BREAK, '')).filter((w) => NOUNS[c.lang].includes(w) && !fact.has(w))
      if (nouns.length === 0) return null
      const noun = rng.pick(nouns)
      if (c.template === 'bars') {
        const i = rng.int(0, c.graphic.items.length - 1)
        return { case: c, graphic: { ...c.graphic, items: c.graphic.items.map((it, k) => (k === i ? { ...it, label: noun } : it)) } }
      }
      return { case: c, graphic: { ...c.graphic, label: noun } }
    },
    outcome: 'dropped'
  },
  {
    name: 'strip a unit from the talk but not the spec',
    from: ['counter', 'ring', 'bars'],
    make: (c, rng) => {
      const withUnit = (c.pairs ?? []).map((p, i) => ({ p, i })).filter(({ p }) => p.num.unit !== '')
      if (withUnit.length === 0) return null
      const { p, i } = rng.pick(withUnit)
      const words = c.sentences[c.fact]
      const last = p.numAt + p.num.said.length - 1
      const end = M_BREAK.exec(words[last])?.[0] ?? ''
      const stripped = p.num.stripped.map((w, k) => (k === p.num.stripped.length - 1 ? w + end : w))
      const next = [...words.slice(0, p.numAt), ...stripped, ...words.slice(last + 1)]
      const graphic =
        c.template === 'bars'
          ? { ...c.graphic, items: c.graphic.items.map((it, k) => (k === i ? { ...it, value: p.num.withUnit } : it)) }
          : { ...c.graphic, value: p.num.withUnit }
      return { case: withFact(c, next), graphic }
    },
    outcome: 'dropped'
  },
  {
    name: 'a keyword run with a gap in it',
    from: ['keyword'],
    make: (c, rng) => {
      const words = c.sentences[c.fact].map((w) => w.replace(M_BREAK, ''))
      const i = rng.int(0, words.length - 3)
      const j = rng.int(i + 2, Math.min(words.length - 1, i + 3))
      const run = rng.chance(0.5) || j - i < 3 ? [words[i], words[j]] : [words[i], words[i + 1], words[j]]
      if (c.lang === 'en' && run.every((w) => M_FUNCTION_EN.includes(w.toLowerCase()))) return null
      // Not a gap at all when the run is also said contiguously somewhere in the talk.
      if (c.sentences.some((s) => s.map((w) => w.replace(M_BREAK, '')).join(' ').includes(run.join(' ')))) return null
      return { case: c, graphic: { ...c.graphic, words: run.join(' '), lit: 0 } }
    },
    outcome: 'dropped'
  },
  {
    name: 'a keyword run in a negated clause',
    from: ['keyword'],
    make: (c) => {
      const words = c.sentences[c.fact]
      return { case: withFact(c, insertAt(words, clauseStart(words, c.runs![0].at), NEGATOR[c.lang])), graphic: c.graphic }
    },
    outcome: 'dropped'
  }
]

describe('the adversarial generators: each false graphic is dropped, every case, above a floor', () => {
  for (const gen of ADVERSARIAL) {
    it(`${gen.name}: the matcher finds it false, and settleGraphics keeps nothing`, () => {
      const rng = new Rng(7 + gen.name.length)
      const failures: string[] = []
      let made = 0
      for (const { c } of KEPT_TRUE.filter((x) => gen.from.includes(x.c.template))) {
        const m = gen.make(c, rng)
        if (!m) continue
        made += 1
        const t = transcriptOf(m.case)
        if (grounds(dataOfAnswer(m.graphic), t, m.graphic.sentence) === null) {
          failures.push(`the generator made a graphic that was said — ${show(m.case, m.graphic)}`)
          continue
        }
        const { s } = settle(m.case, m.graphic)
        if (s.rejected !== null || s.kept.length !== 0) failures.push(`kept ${JSON.stringify(s.kept.map((k) => k.data))} (rejected: ${s.rejected}) — ${show(m.case, m.graphic)}`)
      }
      noFailures(failures)
      expect(made, `${gen.name}: ${made} cases`).toBeGreaterThanOrEqual(FLOOR_ADVERSARIAL)
    })
  }

  it('a lit past the run’s end: repaired to the run’s last word with a note, every case', () => {
    const rng = new Rng(41)
    const failures: string[] = []
    let made = 0
    for (const { c } of KEPT_TRUE.filter((x) => x.c.template === 'keyword')) {
      const n = c.graphic.words.split(/\s+/u).filter(Boolean).length
      const graphic = { ...c.graphic, lit: n + rng.int(0, 4) }
      made += 1
      const { s, t } = settle(c, graphic)
      const k = s.kept[0]
      const note = s.dropped.some((p) => p.path === '$.graphics[0].lit' && p.message.startsWith('graphic repaired'))
      if (s.kept.length !== 1 || k.data.template !== 'keyword' || k.data.lit !== n - 1 || !note) {
        failures.push(`lit ${graphic.lit} of ${n}: kept ${JSON.stringify(s.kept.map((x) => x.data))}, notes ${JSON.stringify(s.dropped)} — ${show(c, graphic)}`)
      } else if (grounds(k.data, t, k.sentence) !== null || drawnGrounds(k, t) !== null) failures.push(`the repaired keyword does not ground — ${show(c, graphic)}`)
    }
    noFailures(failures)
    expect(made).toBeGreaterThanOrEqual(FLOOR_ADVERSARIAL)
  })

  it('a model-written parent: the answer is the wrong shape, and the baseline’s steps with written parents get the app’s, every case', () => {
    const rng = new Rng(43)
    const failures: string[] = []
    let made = 0
    for (const { c } of KEPT_TRUE.filter((x) => x.c.template === 'steps')) {
      const t = transcriptOf(c)
      const menu = menuOf(t)
      const labels = c.graphic.items.map((i) => i.label)
      const reference = settleGraphics({ error: 'none' }, menu, t, {
        baseline: () => [{ sentence: c.graphic.sentence, data: { template: 'steps', title: c.graphic.title, items: labels.map((label) => ({ label })), connector: 'none' }, bound: [], beatWords: [], why: 'w', source: 'baseline' }]
      })
      if (reference.kept.length !== 1) continue
      const appParents = (reference.kept[0].data as Extract<GraphicData, { template: 'steps' }>).items.map((i) => i.parent)
      // A written tree that is not the app's.
      let written: number[] = []
      for (let tries = 0; tries < 20; tries++) {
        written = labels.map((_, j) => (j === 0 ? -1 : rng.int(-1, j - 1)))
        if (written.join() !== appParents.join()) break
      }
      if (written.join() === appParents.join()) continue
      made += 1
      const answer = { reasoning: 'r', graphics: [{ ...c.graphic, items: c.graphic.items.map((it, j) => ({ ...it, parent: written[j] })) }] }
      const s = settleGraphics({ value: answer, truncated: false }, menu, t, {
        baseline: () => [{ sentence: c.graphic.sentence, data: { template: 'steps', title: c.graphic.title, items: labels.map((label, j) => ({ label, parent: written[j] })), connector: 'tree' }, bound: [], beatWords: [], why: 'w', source: 'baseline' }]
      })
      const got = s.kept[0]?.data as Extract<GraphicData, { template: 'steps' }> | undefined
      const ok =
        s.rejected !== null && /not the shape/u.test(s.rejected) && s.baseline && s.kept.length === 1 && got !== undefined &&
        got.items.map((i) => i.parent).join() === appParents.join() &&
        got.connector === (reference.kept[0].data as Extract<GraphicData, { template: 'steps' }>).connector
      if (!ok) failures.push(`written ${written.join()}, app ${appParents.join()}: ${JSON.stringify({ rejected: s.rejected, kept: s.kept.map((k) => k.data) })} — ${show(c)}`)
      else if (grounds(got, t, s.kept[0].sentence) !== null || drawnGrounds(s.kept[0], t) !== null) failures.push(`the repaired steps do not ground — ${show(c)}`)
    }
    noFailures(failures)
    expect(made).toBeGreaterThanOrEqual(FLOOR_ADVERSARIAL)
  })
})
