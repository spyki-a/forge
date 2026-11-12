/**
 * The graphics baseline (docs/CLIPS.md §6.10, "The baseline (no model)"):
 * what runs when no model answers a window, and what "preferred to the
 * standard" compares against. Deterministic: the same transcript and menu
 * give the same candidates, read in the menu's sentence order only.
 *
 * The four rules, as §6.10 words them:
 *
 * - a sentence with a `%` → `ring`;
 * - a number with a unit or currency → `counter`;
 * - two or more consecutive sentences opening with ordinals ("first",
 *   "second", "step one") → `steps`, its connector and parents from `tree.ts`
 *   (§6.2);
 * - an English sentence of at most `BASELINE_KEYWORD_MAX_WORDS` words, not a
 *   question, whose last one to three words hold a content word → `keyword`
 *   of those words, `lit` the last. Hindi and Telugu get no baseline keyword
 *   in v1.
 *
 * Each is validated the same way as a model's graphic (§6.7):
 * `settleGraphics` puts these candidates through `validateBaseline`, so a
 * negated percent, a number the stretch does not hold or a keyword lifted
 * from a negated phrase is dropped THERE, with its reason, not here. No rule
 * of the validator is repeated in this file. Never a `lower-third` (the
 * app's, §6.6), never a `callout`, never a template the menu does not offer.
 *
 * What a number, a unit, a currency and a percent are is `claims.ts`'
 * `numberSpans` (§6.7 rule 4, which reads `numbers.ts`' grouping and
 * multipliers): there is one number reader. A unit is rule 4's: `%`
 * (`percent`, `per cent`) or a currency, so "40 clients" gives no counter.
 * The content words are what `FUNCTION_WORDS_EN` (rule 8's list) is not.
 *
 * Pure and node-runnable.
 */

import type { Transcript, Word } from '../transcript'
import type { GraphicCandidate, GraphicData } from '../graphics/template'
import { GRAPHIC_TEMPLATES } from '../graphics/template'
import { connectorFor, treeParents } from '../graphics/tree'
import { CLAUSE_BREAK, FUNCTION_WORDS_EN, claimTokens, isNegator, numberSpans, type CanonNumber } from './claims'
import { GRAPHIC_KEPT_CHARS, STRETCH_SENTENCES } from './validateGraphics'
import type { GraphicsMenu } from './run'

/** The longest sentence that gives a baseline keyword (§6.10: "at most 8 words", a proposal). */
export const BASELINE_KEYWORD_MAX_WORDS = 8

/** How many of a sentence's last words a baseline keyword may take (§6.10: "its last one to three words"). */
export const BASELINE_KEYWORD_TAIL = 3

/**
 * The words a sentence opens with that make it a step (§6.10: "first",
 * "second", "step one"), as `claimToken` writes them: an ordinal alone, or
 * "step" and a count. Up to six, a steps graphic's most items (§6.2).
 */
export const BASELINE_ORDINALS: readonly string[] = Object.freeze(['first', 'second', 'third', 'fourth', 'fifth', 'sixth'])
export const BASELINE_STEP_COUNTS: readonly string[] = Object.freeze(['one', 'two', 'three', 'four', 'five', 'six', '1', '2', '3', '4', '5', '6'])

/** Each baseline graphic's `why` (the decision record's, §6.6): what the rule saw. */
export const BASELINE_WHY = Object.freeze({
  ring: 'a percentage is said',
  counter: 'an amount is said',
  steps: 'the steps are counted off',
  keyword: 'a short line ends on these words'
})

/** The English test, as `validateGraphics`' `bind` reads a language tag ('en', 'en-GB', 'en_US'). */
function isEnglish(lang: string): boolean {
  return /^en(?:$|[-_])/iu.test(lang)
}

/** A word's edge punctuation off (a sentence's full stop, a comma, quotes); a leading currency sign and a trailing % kept. */
function bare(text: string): string {
  return text.replace(/^[^\p{L}\p{M}\p{N}$€£₹]+|[^\p{L}\p{M}\p{N}%]+$/gu, '')
}

/** One menu sentence, read: its shown words and their tokens, each token with its word's place in `words`. */
interface Read {
  id: string
  words: Word[]
  tokens: string[]
  wordOf: number[]
}

function readSentence(sentence: GraphicsMenu['sentences'][number], byIndex: ReadonlyMap<number, Word>): Read {
  const words: Word[] = []
  for (let i = sentence.wordStart; i <= sentence.wordEnd; i += 1) {
    const w = byIndex.get(i)
    if (w) words.push(w)
  }
  const tokens: string[] = []
  const wordOf: number[] = []
  words.forEach((w, k) => {
    for (const t of claimTokens(w.text)) {
      tokens.push(t)
      wordOf.push(k)
    }
  })
  return { id: sentence.id, words, tokens, wordOf }
}

/** A content token: holds a letter, is not one of rule 8's English function words, and is no negator. */
function isContent(t: string): boolean {
  return /\p{L}/u.test(t) && !FUNCTION_WORDS_EN.includes(t) && !isNegator(t)
}

/** A number's value as drawn: its words as said when they hold a digit ('40%', '$1,200', '500 rupees'), else rule 4's value in digits ('forty percent' → '40%'). */
function valueText(read: Read, from: number, end: number, value: CanonNumber): string {
  const lo = read.wordOf[from]
  const hi = read.wordOf[end - 1]
  const said = read.words
    .slice(lo, hi + 1)
    .map((w) => w.text)
    .join(' ')
  if (/\p{N}/u.test(said)) return bare(said)
  const sign = value.n < 0 ? '-' : ''
  const n = String(Math.abs(value.n))
  if (value.unit === '%') return `${sign}${n}%`
  return `${sign}${value.currency ?? ''}${n}`
}

/**
 * The label a number is said of: the first content word after it in its
 * clause, else the last content word before it in its clause; never a word
 * of a number. Null when the clause holds none.
 */
function labelFor(read: Read, from: number, end: number, spans: readonly { from: number; end: number }[]): string | null {
  const inNumber = (i: number): boolean => spans.some((s) => i >= s.from && i < s.end)
  const take = (i: number): string | null => (isContent(read.tokens[i]) && !inNumber(i) ? bare(read.words[read.wordOf[i]].text) : null)
  for (let i = end; i < read.tokens.length && read.tokens[i] !== CLAUSE_BREAK; i += 1) {
    const label = take(i)
    if (label) return label
  }
  for (let i = from - 1; i >= 0 && read.tokens[i] !== CLAUSE_BREAK; i -= 1) {
    const label = take(i)
    if (label) return label
  }
  return null
}

/** A sentence's ring (its first percent) or, with none, its counter (its first currency amount); null for neither. */
function numberGraphic(read: Read): GraphicCandidate | null {
  const spans = numberSpans(read.tokens)
  for (const template of ['ring', 'counter'] as const) {
    for (const s of spans) {
      const wanted = template === 'ring' ? s.value.unit === '%' : s.value.unit === 'currency'
      if (!wanted) continue
      const label = labelFor(read, s.from, s.end, spans)
      if (!label) continue
      const data: GraphicData = { template, value: valueText(read, s.from, s.end, s.value), label }
      return candidate(read.id, data, BASELINE_WHY[template])
    }
  }
  return null
}

/**
 * The item a sentence opens with an ordinal for, or null: the words after
 * "first" or "step one" up to the first clause or sentence mark, the
 * function words before its first content word left off, cut to whole words
 * within a steps row's drawn length (`GRAPHIC_KEPT_CHARS.itemLabel`).
 */
function stepItem(read: Read): string | null {
  const words = read.words.map((w) => w.text)
  const first = claimTokens(words[0] ?? '')
  let skip: number
  if (BASELINE_ORDINALS.includes(first[0])) skip = 1
  else if (first[0] === 'step' && first.length === 1 && BASELINE_STEP_COUNTS.includes(claimTokens(words[1] ?? '')[0])) skip = 2
  else return null
  // "First, the plan" — the opener's own comma ends nothing.
  const label: string[] = []
  for (let k = skip; k < words.length; k += 1) {
    const tokens = claimTokens(words[k])
    const said = tokens.filter((t) => t !== CLAUSE_BREAK)
    if (said.length > 0 && (label.length > 0 || said.some(isContent))) label.push(bare(words[k]))
    if (label.length > 0 && tokens[tokens.length - 1] === CLAUSE_BREAK) break
  }
  const kept: string[] = []
  for (const w of label) {
    if (w === '') continue
    if (Array.from([...kept, w].join(' ')).length > GRAPHIC_KEPT_CHARS.itemLabel) break
    kept.push(w)
  }
  return kept.length > 0 ? kept.join(' ') : null
}

/** A keyword of the sentence's last one to three words, the fewest that hold a content word; null when §6.10's keyword rule does not apply. */
function keywordGraphic(read: Read, language: string): GraphicCandidate | null {
  if (!isEnglish(language)) return null
  const words = read.words.map((w) => w.text)
  if (words.length === 0 || words.length > BASELINE_KEYWORD_MAX_WORDS) return null
  if (/\?["'”’)\]]*$/u.test(words[words.length - 1])) return null
  for (let n = 1; n <= Math.min(BASELINE_KEYWORD_TAIL, words.length); n += 1) {
    const tail = words.slice(words.length - n)
    if (!tail.some((w) => claimTokens(w).some(isContent))) continue
    const drawn = tail.map(bare).filter((w) => w !== '')
    if (drawn.length === 0) return null
    return candidate(read.id, { template: 'keyword', words: drawn.join(' '), lit: drawn.length - 1 }, BASELINE_WHY.keyword)
  }
  return null
}

/** `bound` and `beatWords` are left empty: `validateBaseline` recomputes both from the transcript and never reads a candidate's. */
function candidate(sentence: string, data: GraphicData, why: string): GraphicCandidate {
  return { sentence, data, bound: [], beatWords: [], why, source: 'baseline' }
}

/**
 * The baseline's graphics for one menu window (docs/CLIPS.md §6.10), in the
 * menu's sentence order. At most one graphic a sentence: a run of ordinal
 * sentences is one `steps` (its first `2 × STRETCH_SENTENCES + 1`, the
 * stretch of its middle sentence, which it cites, so every item is in the
 * stretch the validator reads); every other sentence gives a `ring`, else a
 * `counter`, else a `keyword`. Only templates the menu offers.
 */
export function baselineGraphics(transcript: Transcript, menu: GraphicsMenu): GraphicCandidate[] {
  const byIndex = new Map(transcript.words.map((w) => [w.index, w]))
  const reads = menu.sentences.map((s) => readSentence(s, byIndex))
  const offered = (t: GraphicData['template']): boolean => menu.templates.includes(t)
  const out: GraphicCandidate[] = []
  const items = reads.map(stepItem)
  const most = 2 * STRETCH_SENTENCES + 1
  const steps = GRAPHIC_TEMPLATES.steps!
  let k = 0
  while (k < reads.length) {
    let run = 0
    while (k + run < reads.length && items[k + run] !== null) run += 1
    if (run >= 2 && offered('steps')) {
      const taken = Math.min(run, most, steps.maxItems ?? run)
      const labels = items.slice(k, k + taken) as string[]
      const words = reads.slice(k, k + taken).flatMap((r) => r.words)
      const title = steps.fixedTitles![0]
      const parents = treeParents(
        labels.map((label) => ({ label })),
        title,
        words
      )
      const cited = reads[k + Math.min(1, taken - 1)].id
      out.push(
        candidate(
          cited,
          { template: 'steps', title, items: labels.map((label, j) => ({ label, parent: parents[j] })), connector: connectorFor(parents) },
          BASELINE_WHY.steps
        )
      )
      k += run
      continue
    }
    const read = reads[k]
    const number = numberGraphic(read)
    if (number && offered(number.data.template)) out.push(number)
    else {
      const keyword = offered('keyword') ? keywordGraphic(read, menu.language) : null
      if (keyword) out.push(keyword)
    }
    k += 1
  }
  return out
}
