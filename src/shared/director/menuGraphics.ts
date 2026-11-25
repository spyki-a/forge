import type { Transcript } from '../transcript'
import { CLAUSE_BREAK, claimTokens, numberSpans, type CanonNumber } from './claims'
import type { GraphicTemplateId } from '../graphics/template'
import { TIMELINE_YEARS } from './validateGraphics'

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
 *   digits with no unit (a when is a year, validateGraphics.ts `isYearClaim`).
 * - `before-after`: two different numbers said in one unit in one stretch
 *   (the before's and the after's; a year is not one) and, in English, one of
 *   `BEFORE_AFTER_CUES_EN` in it ('from', 'used', 'went', 'doubled' ...;
 *   not 'now' or 'today', which open a sentence about anything).
 * - `versus`: the same two numbers and, in English, one of `VERSUS_CUES_EN`
 *   ('than', 'versus', 'while', 'compared' ...).
 *
 * In Hindi and Telugu the cue words are the owner's to give (no list here
 * holds a word of theirs, as `CONDITIONALS_EN` holds none), so there the two
 * numbers alone offer both two-sided templates: a necessary condition, never
 * a sufficient one; the validator still binds every pair. Pure.
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

/** Step 6's three, in `GRAPHIC_TEMPLATES`' order: the order a menu lists them in, after the always-offered ones. */
export const STEP_SIX_TEMPLATES: readonly GraphicTemplateId[] = Object.freeze(['timeline', 'before-after', 'versus'] as GraphicTemplateId[])

/** One sentence as the conditions read it: its spoken tokens and its numbers. */
interface Read {
  tokens: string[]
  numbers: { value: CanonNumber; token: string }[]
}

function readSentence(transcript: Pick<Transcript, 'words'>, from: number, to: number): Read {
  const tokens = transcript.words.filter((w) => w.index >= from && w.index <= to).flatMap((w) => claimTokens(w.text))
  const numbers = numberSpans(tokens).map((n) => ({ value: n.value, token: tokens[n.at] }))
  return { tokens: tokens.filter((t) => t !== CLAUSE_BREAK), numbers }
}

const isYear = (n: { value: CanonNumber; token: string }): boolean =>
  n.value.unit === '' && n.value.currency === undefined && /^\d{4}$/u.test(n.token) && n.value.n >= TIMELINE_YEARS.from && n.value.n <= TIMELINE_YEARS.to

/** Two numbers of one unit (and currency) with different values. */
function twoInOneUnit(numbers: readonly { value: CanonNumber }[]): boolean {
  const byUnit = new Map<string, Set<number>>()
  for (const { value } of numbers) {
    const key = `${value.unit}${value.currency ?? ''}`
    const set = byUnit.get(key) ?? new Set<number>()
    set.add(value.n)
    byUnit.set(key, set)
  }
  return [...byUnit.values()].some((s) => s.size >= 2)
}

/**
 * Which of step 6's three a menu's sentences offer, in `STEP_SIX_TEMPLATES`'
 * order: each sentence's stretch (itself and one menu sentence either side)
 * read for each template's condition above. `language` is the transcript's
 * code; English only reads the cue words.
 */
export function stepSixOffered(
  sentences: readonly { wordStart: number; wordEnd: number }[],
  transcript: Pick<Transcript, 'words' | 'language'>
): GraphicTemplateId[] {
  const english = /^en(?:$|[-_])/iu.test(transcript.language)
  const reads = sentences.map((s) => readSentence(transcript, s.wordStart, s.wordEnd))
  const found = new Set<GraphicTemplateId>()
  reads.forEach((_, i) => {
    const stretch = reads.slice(Math.max(0, i - 1), i + 2)
    const numbers = stretch.flatMap((r) => r.numbers)
    const tokens = new Set(stretch.flatMap((r) => r.tokens))
    if (new Set(numbers.filter(isYear).map((n) => n.value.n)).size >= 2) found.add('timeline')
    // A year is a timeline's, never one side of a comparison.
    if (twoInOneUnit(numbers.filter((n) => !isYear(n)))) {
      if (!english || BEFORE_AFTER_CUES_EN.some((c) => tokens.has(c))) found.add('before-after')
      if (!english || VERSUS_CUES_EN.some((c) => tokens.has(c))) found.add('versus')
    }
  })
  return STEP_SIX_TEMPLATES.filter((t) => found.has(t))
}
