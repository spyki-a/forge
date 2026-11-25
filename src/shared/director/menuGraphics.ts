import type { Transcript } from '../transcript'
import { CLAUSE_BREAK, claimTokens, numberSpans, type CanonNumber } from './claims'
import type { GraphicTemplateId } from '../graphics/template'
import { TIMELINE_YEARS, saidAsYear } from './validateGraphics'

/**
 * When a graphics menu offers step 6's three templates (docs/CLIPS.md §9:
 * "the menu ... take[s] them as §6.6-§6.10 take the nine shapes"). The other
 * shapes are offered on every menu (run.ts `GRAPHIC_TEMPLATES_ALWAYS`); these
 * three are offered only when a window's sentences hold what each one needs,
 * so a talk with no two-sided comparison is never offered a versus, and a
 * small model is not tempted into one. Read over a stretch as the validator
 * reads one (`STRETCH_SENTENCES`: a sentence and one either side, in the
 * menu's order), each sentence's numbers on its own as `bind` reads them:
 *
 * - `timeline`: at least two different YEARS said in one stretch, each four
 *   digits with no unit, said as a date (validateGraphics.ts `saidAsYear`:
 *   in English after 'in', 'since' ... or opening its clause, and not before
 *   a plural noun, so '1500 guests' offers nothing).
 * - `before-after`: two different numbers said in one unit in one stretch
 *   (the before's and the after's; a year is not one, nor a list's count
 *   after `LIST_NOUNS_EN`: 'step one', 'day 3') and, in English, one of
 *   `BEFORE_AFTER_CUES_EN` in a sentence that holds one of them ('from',
 *   'used', 'went', 'doubled' ...; not 'now' or 'today', which open a
 *   sentence about anything).
 * - `versus`: the same two numbers and, in English, one of `VERSUS_CUES_EN`
 *   in a sentence that holds one of them ('than', 'versus', 'while' ...).
 *
 * In Hindi and Telugu the cue words are the owner's to give (no list here
 * holds a word of theirs, as `CONDITIONALS_EN` holds none), so there the two
 * numbers alone offer both two-sided templates: a necessary condition, never
 * a sufficient one; the validator still binds every pair. Every other
 * language code, an undetermined one ('und', '', 'auto') included, reads the
 * English cue words, the safe direction: a talk none of them is said in is
 * offered neither. Pure.
 */

/** English words that mark a change over time, one of which a stretch says before it is offered a before-and-after (`claimTokens`' form). */
export const BEFORE_AFTER_CUES_EN: readonly string[] = Object.freeze([
  'before', 'after', 'used', 'from', 'went', 'grew', 'rose', 'fell', 'dropped', 'jumped', 'climbed',
  'doubled', 'tripled', 'halved', 'increased', 'decreased', 'became', 'anymore', 'previously'
])

/** English words that set two things against each other, one of which a stretch says before it is offered a versus. */
export const VERSUS_CUES_EN: readonly string[] = Object.freeze([
  'versus', 'vs', 'compared', 'comparison', 'than', 'whereas', 'while', 'against', 'instead', 'other', 'but'
])

/** English nouns a number after which counts a list's place, not an amount ('step one', 'tip 3', 'day 2'): never a side of a comparison. */
export const LIST_NOUNS_EN: readonly string[] = Object.freeze([
  'step', 'tip', 'reason', 'part', 'number', 'day', 'chapter', 'rule', 'point', 'phase', 'stage', 'lesson', 'episode', 'round', 'level'
])

/** Step 6's three, in `GRAPHIC_TEMPLATES`' order: the order a menu lists them in, after the always-offered ones. */
export const STEP_SIX_TEMPLATES: readonly GraphicTemplateId[] = Object.freeze(['timeline', 'before-after', 'versus'] as GraphicTemplateId[])

/** One number of a sentence as the conditions read it: its value, whether it is a year said as a date, whether it counts a list's place. */
interface ReadNumber {
  value: CanonNumber
  year: boolean
  listed: boolean
}

/** One sentence as the conditions read it: its spoken tokens and its numbers. */
interface Read {
  tokens: Set<string>
  numbers: ReadNumber[]
}

function readSentence(transcript: Pick<Transcript, 'words'>, from: number, to: number, english: boolean): Read {
  const tokens = transcript.words.filter((w) => w.index >= from && w.index <= to).flatMap((w) => claimTokens(w.text))
  const numbers = numberSpans(tokens).map((n) => ({
    value: n.value,
    year:
      n.value.unit === '' &&
      n.value.currency === undefined &&
      n.value.n >= TIMELINE_YEARS.from &&
      n.value.n <= TIMELINE_YEARS.to &&
      saidAsYear(tokens, n.at, english),
    listed: english && LIST_NOUNS_EN.includes(tokens[n.from - 1] ?? '')
  }))
  return { tokens: new Set(tokens.filter((t) => t !== CLAUSE_BREAK)), numbers }
}

/** Two numbers of one unit (and currency) with different values, at least one of them said in a sentence `cued` holds; or, with no cue to ask, any two. */
function twoInOneUnit(numbers: readonly { value: CanonNumber; sentence: number }[], cued: ((sentence: number) => boolean) | null): boolean {
  const byUnit = new Map<string, { values: Set<number>; cued: boolean }>()
  for (const { value, sentence } of numbers) {
    const key = `${value.unit}${value.currency ?? ''}`
    const group = byUnit.get(key) ?? { values: new Set<number>(), cued: false }
    group.values.add(value.n)
    group.cued ||= cued === null || cued(sentence)
    byUnit.set(key, group)
  }
  return [...byUnit.values()].some((g) => g.values.size >= 2 && g.cued)
}

/**
 * Which of step 6's three a menu's sentences offer, in `STEP_SIX_TEMPLATES`'
 * order: each sentence's stretch (itself and one menu sentence either side)
 * read for each template's condition above. `language` is the transcript's
 * code: Hindi and Telugu read no cue words (the owner's to give); every
 * other code reads the English ones.
 */
export function stepSixOffered(
  sentences: readonly { wordStart: number; wordEnd: number }[],
  transcript: Pick<Transcript, 'words' | 'language'>
): GraphicTemplateId[] {
  // The validator's own reading of a year (validateGraphics.ts `isEnglish`); the cue words for every code but Hindi and Telugu.
  const english = /^en(?:$|[-_])/iu.test(transcript.language)
  const uncued = /^(?:hi|te)(?:$|[-_])/iu.test(transcript.language)
  const reads = sentences.map((s) => readSentence(transcript, s.wordStart, s.wordEnd, english))
  const found = new Set<GraphicTemplateId>()
  reads.forEach((_, i) => {
    const stretch = reads.slice(Math.max(0, i - 1), i + 2)
    const numbers = stretch.flatMap((r, k) => r.numbers.map((n) => ({ ...n, sentence: k })))
    if (new Set(numbers.filter((n) => n.year).map((n) => n.value.n)).size >= 2) found.add('timeline')
    // A year is a timeline's, and a list's place a list's: never one side of a comparison.
    const sides = numbers.filter((n) => !n.year && !n.listed)
    const cue = (words: readonly string[]) => (uncued ? null : (k: number) => words.some((c) => stretch[k].tokens.has(c)))
    if (twoInOneUnit(sides, cue(BEFORE_AFTER_CUES_EN))) found.add('before-after')
    if (twoInOneUnit(sides, cue(VERSUS_CUES_EN))) found.add('versus')
  })
  return STEP_SIX_TEMPLATES.filter((t) => found.has(t))
}
