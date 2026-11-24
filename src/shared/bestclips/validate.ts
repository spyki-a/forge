import { CLAUSE_BREAK, FUNCTION_WORDS_EN, claimTokens, isQuantityWord, numberSpans, type CanonNumber } from '../director/claims'
import { conforms, type Problem } from '../director/conforms'
import { bestClipsSchema, picksWanted, TITLE_KEPT_GRAPHEMES, WHY_KEPT_GRAPHEMES, type ClipPickAnswer } from './schema'
import { cutText, overlapShare, windowText, MAX_OVERLAP, type Candidates, type ClipCandidate } from './signals'
import type { Transcript } from '../transcript'

/**
 * Best clips' validator (docs/CLIPS.md §7.4): what of a `bestclips@1` answer
 * a card may show. The answer picks ids; every time comes from the window the
 * id names, never from the answer (`run.ts`). When in doubt it falls back:
 * the pick to the signals', the title to the window's first sentence, the why
 * to the signals' reason line.
 *
 * THE PICKS, in the answer's order:
 * - the answer as a whole must have the shape (`bestClipsSchema(ids,
 *   { constrained: false })`: an object with `reasoning` and a list of `{ id,
 *   title, why }` strings); anything else is REJECTED whole, and the run uses
 *   the signals' three;
 * - a pick whose id is not one of the CANDIDATES (the menu the model was
 *   shown, not every window) is dropped;
 * - an id already picked is dropped (the second; the first stays);
 * - a pick overlapping an earlier kept pick by more than MAX_OVERLAP of the
 *   shorter is dropped, the first kept. The prefilter already keeps every
 *   candidate pair at most half shared, so this cannot fire on a menu from
 *   `candidatesFor`; it is kept so no menu built another way can put two
 *   cards on one stretch;
 * - picks beyond `picksWanted` are dropped.
 * `run.ts` fills the places left from the signals' candidates.
 *
 * THE TITLE, kept to TITLE_KEPT_GRAPHEMES (cut between words, `cutText`), is
 * shown on the card only, never drawn, so it may be the model's words, but it
 * may not say what the window does not (§7.4). It must be GROUNDED in the
 * window's whole text (`windowText`; the condensed text is cut) by
 * `ungroundedIn(title, text, 'title')`, else it is the window's first sentence
 * cut to 40 graphemes (the candidate's no-model title). An empty title (no
 * letter and no digit once invisible marks are gone: `clean`) falls back the
 * same way.
 *
 * THE WHY, kept to WHY_KEPT_GRAPHEMES (cut), is the model's reason, shown and
 * never drawn. It is a judgement, not a copy, so its words are not required
 * to be the window's; its NUMBERS and quantity words are (as the title's), and
 * its capitalised Latin, Greek, Cyrillic or Armenian tokens, except a function
 * word opening one of its sentences ('It', 'This'). Else, or empty,
 * the why is the candidate's signals line. In a script that does not
 * capitalise names a why could name anyone; that is open.
 *
 * Pure and node-runnable.
 */

/**
 * The scripts whose ordinary writing marks a name with a capital letter. A
 * word written with a letter OUTSIDE them (Devanagari, Telugu, Georgian,
 * Arabic, Han…) is in a script where no capital says "this is a name", so the
 * capital rule could check nothing there; such a word is checked word for
 * word instead (below).
 */
const CAPITALISING = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Armenian}]/u
const LETTER = /\p{L}/u
const UPPER = /\p{Lu}/u
/** A digit of any kind: decimal in any script, and roman-numeral and superscript ones ('Ⅻ', '²'), which `numberSpans` does not read. */
const DIGIT = /[\p{Nd}\p{Nl}\p{No}]/u
/** A word, title or why with something to read: a letter or a digit. Punctuation, emoji and invisible marks alone are empty. */
const CONTENT = /[\p{L}\p{N}]/u

/** A word has a letter outside the capitalising scripts: it is checked word for word. */
function caselessWord(word: string): boolean {
  for (const ch of word) if (LETTER.test(ch) && !CAPITALISING.test(ch)) return true
  return false
}

/** A word's tokens as the graphics validator reads them (`claims.ts` `claimTokens`: NFC, lower case, edges trimmed, native digits ASCII), the clause marks left out. */
function wordTokens(word: string): string[] {
  return claimTokens(word).filter((t) => t !== CLAUSE_BREAK)
}

/** A possessive's base ("zorvan's" → "zorvan"): a name said once may be owned in a title. */
function withoutPossessive(token: string): string {
  return token.replace(/['’]s$/u, '')
}

const sameNumber = (said: CanonNumber, written: CanonNumber): boolean =>
  said.n === written.n && (written.unit === '' || (said.unit === written.unit && said.currency === written.currency))

/** The words of a text and its tokens, each token with the word it came from. */
function tokensOf(text: string): { words: string[]; tokens: string[]; wordOf: number[] } {
  const words = text.normalize('NFC').split(/\s+/u).filter(Boolean)
  const tokens: string[] = []
  const wordOf: number[] = []
  words.forEach((w, i) => {
    for (const t of claimTokens(w)) {
      tokens.push(t)
      wordOf.push(i)
    }
  })
  return { words, tokens, wordOf }
}

/** A word opens a sentence of `words`: the first, or after a word ending on a sentence mark. */
function opensSentence(words: readonly string[], i: number): boolean {
  // The danda and double danda as escapes (U+0964, U+0965).
  return i === 0 || /[.!?\u0964\u0965…]["'”’)\]]*$/u.test(words[i - 1])
}

/**
 * What of `text` (a model's title or why) its window does not say, as the
 * offending words (empty: grounded). `said` is the window's whole text.
 *
 * - NUMBERS: every number `claims.ts`' `numberSpans` reads in the text (digits
 *   in any script, English number words, a currency, a percent) must be said
 *   in the window as the same value: the same `n`, and the same unit and
 *   currency unless the text writes the number bare ("2,500" is grounded by
 *   "$2,500"; "40%" is not grounded by "40 clients"). A word with a digit that
 *   is NOT read as one number ('1st', '40-50', '12:30', '4' and a native digit) must be said in
 *   the window token for token, so a time or a range the model wrote is caught
 *   unless the talk says it.
 * - QUANTITY WORDS (`claims.ts` `isQuantityWord`: an English number word, a
 *   multiplier, a scale word, a fraction) that are NOT inside a number
 *   `numberSpans` reads: `numberSpans` drops on purpose a number with a
 *   qualifier ('about nine'), an unapplied scale ('twenty grand', 'hundreds'),
 *   a fraction ('two and a half million'), a pair ('nineteen ninety nine') or a
 *   range ('forty to fifty'), the safe direction for a graphic's claim, but a
 *   title showing those words claims them. Each such token must be said in the
 *   window as itself, or as a number of the same value ('nine' grounded by a
 *   '9' anywhere in the window).
 * - CAPITALS (Latin, Greek, Cyrillic, Armenian): a word with a capital letter
 *   anywhere ('Zorvan', 'NASA', 'iPhone'), THE FIRST WORD INCLUDED for a title
 *   (§7.4: "Modi admits failure" no longer passes on the first-word
 *   exemption), must be said in the window: each of its tokens, compared after
 *   `claimTokens` (so case-blind: "Admits" is grounded by "admits"), a
 *   possessive "'s" allowed. For a why, a word that opens one of the why's
 *   sentences is exempt only when it is an English function word
 *   (`FUNCTION_WORDS_EN`: 'It', 'This', 'A', 'We'…); any other opening capital
 *   ('Kesmer admits failure.') is held as a title's first word is.
 * - CASELESS (a title only): a word with any letter outside those scripts
 *   must be said in the window, token for token after `claimTokens` (NFC,
 *   lower case, edge punctuation trimmed, combining marks kept, native digits
 *   as ASCII). In such a script the capital rule would check nothing, so a
 *   title in it is held to words the talk says, reordered as the model likes.
 *   And when the WINDOW has no letter of a capitalising script at all (a
 *   Telugu, Hindi or Georgian talk), every title word with a letter is held
 *   the same way, whatever its script: a lower-case Latin title over such a
 *   talk ('kesmer quits forever') would otherwise be checked for nothing.
 *   Hinglish (a window with letters of both kinds) gets both, word by word:
 *   its Latin words the capital rule, its Devanagari words this one. A Latin
 *   word with no capital in a window that has Latin letters is not checked
 *   (the plan's rule): romanised Hindi or a name written in lower case is not
 *   held to the window (open).
 * - Words that are part of a grounded number are not checked again ("Three
 *   reasons" with "3 reasons" said).
 */
export function ungroundedIn(text: string, said: string, mode: 'title' | 'why'): string[] {
  const window = tokensOf(said)
  const windowSet = new Set(window.tokens.filter((t) => t !== CLAUSE_BREAK))
  const windowNumbers = numberSpans(window.tokens).map((s) => s.value)

  const { words, tokens, wordOf } = tokensOf(text)
  const bad = new Set<number>()
  const covered = new Set<number>()
  for (const span of numberSpans(tokens)) {
    const grounded = windowNumbers.some((n) => sameNumber(n, span.value))
    for (let k = span.from; k < span.end; k++) {
      if (grounded) covered.add(wordOf[k])
      else bad.add(wordOf[k])
    }
  }
  // Every value the window says, a lone number word's included ('about nine' is no number to
  // numberSpans, but it says nine): a quantity word of the text is grounded by any of them.
  const windowValues = new Set(windowNumbers.map((n) => n.n))
  for (const t of windowSet) for (const s of numberSpans([t])) windowValues.add(s.value.n)
  const windowCases = [...said].some((ch) => LETTER.test(ch) && CAPITALISING.test(ch))

  const saidWord = (w: string): boolean => {
    const ts = wordTokens(w)
    return ts.length > 0 && ts.every((t) => windowSet.has(t) || windowSet.has(withoutPossessive(t)))
  }
  const quantitySaid = (t: string): boolean => windowSet.has(t) || numberSpans([t]).some((s) => windowValues.has(s.value.n))
  const functionWord = (w: string): boolean => {
    const ts = wordTokens(w)
    return ts.length > 0 && ts.every((t) => FUNCTION_WORDS_EN.includes(t))
  }
  words.forEach((w, i) => {
    if (covered.has(i) || bad.has(i)) return
    if (wordTokens(w).some((t) => isQuantityWord(t) && !quantitySaid(t))) return void bad.add(i)
    const digit = DIGIT.test(w)
    const capital = UPPER.test(w) && !(mode === 'why' && opensSentence(words, i) && functionWord(w))
    const caseless = mode === 'title' && (caselessWord(w) || (!windowCases && LETTER.test(w)))
    if ((digit || capital || caseless) && !saidWord(w)) bad.add(i)
  })
  return [...bad].sort((a, b) => a - b).map((i) => words[i])
}

/** One pick the validator keeps: its candidate, and the title and why a card shows. */
export interface ValidPick {
  id: string
  candidate: ClipCandidate
  title: string
  why: string
  /** Where the title came from: the model, or the window's first sentence (the model's was empty or not grounded). */
  titleFrom: 'model' | 'first-sentence'
  /** Where the why came from: the model, or the signals' line (the model's was empty or not grounded). */
  whyFrom: 'model' | 'signals'
  /** Why the title is not the model's: it had nothing to read (`'empty'`), or said what the window does not; null when it is the model's. */
  titleFallback: 'empty' | 'ungrounded' | null
  /** Why the why is not the model's, as `titleFallback`. */
  whyFallback: 'empty' | 'ungrounded' | null
}

export type BestClipsVerdict = { picks: ValidPick[]; problems: Problem[] } | { rejected: string }

/** The whole answer's problems as one line, for a rejected answer (the eval's record; a card never shows it). */
function problemsLine(problems: readonly Problem[]): string {
  return problems
    .slice(0, 3)
    .map((p) => `${p.path} ${p.message}`)
    .join('; ')
}

/**
 * The model's text as a card would show it: invisible format characters
 * (`\p{Cf}`: a zero-width space, a word joiner, a soft hyphen, a bidi mark)
 * removed, except the zero-width joiner and non-joiner (U+200D, U+200C), which
 * shape Indic conjuncts and emoji; white space collapsed. Text with no letter
 * and no digit left ('…', '— — —', emoji alone) is EMPTY (`hasContent`).
 */
const clean = (text: string): string =>
  text
    .replace(/(?![\u200C\u200D])\p{Cf}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
const hasContent = (text: string): boolean => CONTENT.test(text)

/**
 * Settle one `bestclips@1` answer against the candidates it was asked about
 * and the transcript they were cut from. Never throws. `problems` lists every
 * pick dropped and every title or why replaced, with its path, for the eval;
 * the messages may quote the model's words and are never shown on a card.
 */
export function validateBestClips(answer: unknown, c: Pick<Candidates, 'candidates'>, t: Transcript): BestClipsVerdict {
  const ids = c.candidates.map((x) => x.id)
  const shape = conforms(bestClipsSchema(ids, { constrained: false }), answer)
  if (shape.length > 0) return { rejected: `the answer is not the shape asked for: ${problemsLine(shape)}` }
  const picks = (answer as { picks: ClipPickAnswer[] }).picks
  const byId = new Map(c.candidates.map((x) => [x.id, x]))
  const wanted = picksWanted(ids.length)
  const problems: Problem[] = []
  const kept: ValidPick[] = []

  picks.forEach((p, i) => {
    const path = `$.picks[${i}]`
    const candidate = byId.get(p.id)
    if (!candidate) return void problems.push({ path: `${path}.id`, message: `'${p.id}' is not one of the candidates` })
    if (kept.some((k) => k.id === p.id)) return void problems.push({ path: `${path}.id`, message: `'${p.id}' is picked twice` })
    const over = kept.find((k) => overlapShare(k.candidate.window, candidate.window) > MAX_OVERLAP)
    if (over) return void problems.push({ path: `${path}.id`, message: `'${p.id}' shares more than half its time with '${over.id}', picked first` })
    if (kept.length >= wanted) return void problems.push({ path: `${path}`, message: `more than ${wanted} picks` })

    const said = windowText(t, candidate.window)
    let title = cutText(clean(p.title), TITLE_KEPT_GRAPHEMES, 'graphemes')
    let titleFrom: ValidPick['titleFrom'] = 'model'
    const titleEmpty = !hasContent(title)
    const titleBad = titleEmpty ? null : ungroundedIn(title, said, 'title')
    const titleFallback: ValidPick['titleFallback'] = titleEmpty ? 'empty' : titleBad!.length > 0 ? 'ungrounded' : null
    if (titleFallback) {
      problems.push({
        path: `${path}.title`,
        message: titleEmpty ? 'is empty: the first sentence is used' : `says ${titleBad!.map((w) => `'${w}'`).join(', ')}, which ${p.id} does not: the first sentence is used`
      })
      title = candidate.title
      titleFrom = 'first-sentence'
    }
    let why = cutText(clean(p.why), WHY_KEPT_GRAPHEMES, 'graphemes')
    let whyFrom: ValidPick['whyFrom'] = 'model'
    const whyEmpty = !hasContent(why)
    const whyBad = whyEmpty ? null : ungroundedIn(why, said, 'why')
    const whyFallback: ValidPick['whyFallback'] = whyEmpty ? 'empty' : whyBad!.length > 0 ? 'ungrounded' : null
    if (whyFallback) {
      problems.push({
        path: `${path}.why`,
        message: whyEmpty ? "is empty: the signals' reason is used" : `says ${whyBad!.map((w) => `'${w}'`).join(', ')}, which ${p.id} does not: the signals' reason is used`
      })
      why = candidate.why
      whyFrom = 'signals'
    }
    kept.push({ id: p.id, candidate, title, why, titleFrom, whyFrom, titleFallback, whyFallback })
  })
  return { picks: kept, problems }
}
