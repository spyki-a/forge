/**
 * The graphics pass's validator (docs/CLIPS.md §6.7): `validateGraphics`, the
 * answer as a whole, and `checkGraphicData`, the per-graphic core it calls for
 * each graphic and the dock calls on each edit (§6.6), so the two cannot check
 * differently. Rules 1-8's normaliser, claims and binding are `claims.ts`';
 * this file holds the stretch, rule 8's `fixed`, `speaker` and `index` modes,
 * rule 9's template rules over the bound result, and the per-graphic repairs.
 * Rule 10's spacing is `settleGraphics`' (`run.ts`), over the kept list. Rule
 * 11 (a callout's `anchor`, phase 4, §6.18) is not checked here: no graphic
 * this file keeps carries an `anchor`, and the seam is `GraphicSpec.anchor`.
 *
 * When in doubt it drops. Pure and node-runnable.
 */

import { capSegments, type Segment, type Transcript, type Word } from '../transcript'
import { SEGMENT_MAX_MS, SEGMENT_MAX_WORDS, graphemeCount } from '../ingest/captions'
import {
  CLAUSE_BREAK,
  FUNCTION_WORDS_EN,
  bind,
  isNegator,
  claimTokens,
  claimTokensOf,
  claimsOf,
  marksOf,
  marksUnsaid,
  type Claim,
  type ClaimStretch
} from './claims'
import { conforms, type ObjectSchema, type Problem } from './conforms'
import { parentsValid, treeParents, connectorFor } from '../graphics/tree'
import {
  GRAPHIC_TEMPLATES,
  type GraphicCandidate,
  type GraphicData,
  type GraphicSpec,
  type GraphicTemplateId,
  type TemplateDef
} from '../graphics/template'
import type { GraphicsMenu } from './run'
// The module's own exports, so `validateGraphics` calls `checkGraphicData` through
// the export a test (and the dock's test, §6.6) spies on, never a private copy.
import * as self from './validateGraphics'

// ---------------------------------------------------------------------------
// The answer (§6.6's fields, in declaration order).

/** One graphic of a `graphics@1` answer: the union of the offered templates' fields, unused ones '' (§6.6). */
export interface AnswerGraphic {
  sentence: string
  template: string
  title: string
  value: string
  label: string
  items: { label: string; value: string }[]
  quote: string
  words: string
  lit: number
  why: string
}

/** A `graphics@1` answer (§6.6): `reasoning` first, then at most `MAX_GRAPHICS` graphics. */
export interface GraphicsAnswer {
  reasoning: string
  graphics: AnswerGraphic[]
}

/** At most four graphics an answer (§6.6, `MAX_GRAPHICS`). */
export const MAX_GRAPHICS = 4

/** At most six items a graphic in the answer's shape (§6.6: `items` `maxItems` 6). */
export const MAX_ANSWER_ITEMS = 6

/**
 * The answer's shape as the validator checks it: §6.6's fields in declaration
 * order, unconstrained (no enum, no length, no integer range), so an
 * out-of-list id or an out-of-range `lit` is repaired or dropped one graphic at
 * a time rather than failing the pass (`schema2.ts`' `constrained: false`).
 * Lane T2b's `graphicsSchema(menu, { constrained: false })` (`schemaGraphics.ts`)
 * must accept exactly what this accepts; when it lands, `validateGraphics`
 * checks against it and this goes.
 */
export function graphicsAnswerShape(): ObjectSchema {
  const text = { type: 'string' } as const
  return {
    type: 'object',
    properties: {
      reasoning: text,
      graphics: {
        type: 'array',
        minItems: 0,
        maxItems: MAX_GRAPHICS,
        items: {
          type: 'object',
          properties: {
            sentence: text,
            template: text,
            title: text,
            value: text,
            label: text,
            items: {
              type: 'array',
              maxItems: MAX_ANSWER_ITEMS,
              items: {
                type: 'object',
                properties: { label: text, value: text },
                required: ['label', 'value'],
                additionalProperties: false
              }
            },
            quote: text,
            words: text,
            lit: { type: 'integer' },
            why: text
          },
          required: ['sentence', 'template', 'title', 'value', 'label', 'items', 'quote', 'words', 'lit', 'why'],
          additionalProperties: false
        }
      }
    },
    required: ['reasoning', 'graphics'],
    additionalProperties: false
  }
}

// ---------------------------------------------------------------------------
// The stretch.

/** The sentences either side of the cited one a graphic's facts may come from (§6.7, "The stretch"). */
export const STRETCH_SENTENCES = 1

/**
 * The words a graphic's facts may come from (§6.7, "The stretch"): the cited
 * sentence and one either side, over the transcript's segments CAPPED at 30
 * words or 15 s (§7.2, `SEGMENT_MAX_WORDS`, `SEGMENT_MAX_MS`), so an
 * unpunctuated track does not make the stretch the whole talk. `sentence` is a
 * capped segment's id, as the menu shows it ('s07', 's07.2'). Null when no
 * capped segment has that id.
 */
export function stretchFor(transcript: Transcript, sentence: string): ClaimStretch | null {
  const capped = capSegments(transcript, SEGMENT_MAX_WORDS, SEGMENT_MAX_MS)
  const at = capped.findIndex((s) => s.id === sentence)
  if (at < 0) return null
  const sentences: Segment[] = capped.slice(Math.max(0, at - STRETCH_SENTENCES), at + STRETCH_SENTENCES + 1)
  const lo = sentences[0].wordStart
  const hi = sentences[sentences.length - 1].wordEnd
  const words: Word[] = transcript.words.filter((w) => w.index >= lo && w.index <= hi)
  return { words, sentences }
}

// ---------------------------------------------------------------------------
// Rule 8's speaker mode.

/** The reporting verbs that make a run directly after them a reported quote (rule 8; read wide, the safe direction). */
const REPORTING_VERBS: readonly string[] = ['say', 'says', 'said', 'saying', 'tell', 'tells', 'told', 'telling', 'ask', 'asks', 'asked', 'wrote', 'writes']

/** The verbs whose subject may be named as a quote's speaker: "<name> said / says / told" (rule 8, exactly). */
const NAMING_VERBS: readonly string[] = ['said', 'says', 'told']

/** The object a reporting verb may take before the quoted run ("told me: …"). */
const OBJECT_PRONOUNS: readonly string[] = ['me', 'us', 'him', 'her', 'them', 'you']

/** Words that are never a name, though written with a capital. */
const NOT_NAMES: readonly string[] = ['i', 'he', 'she', 'we', 'they', 'you', 'it', 'someone', 'somebody', 'everyone', 'everybody', 'people', 'who', 'one']

/** The object a reporting verb may take that points at the run after it ("said this: …", "told me that …"). */
const DEMONSTRATIVES: readonly string[] = ['that', 'this', 'it']

/** A word whose own punctuation ends a sentence, inside a segment ('great.', 'really?'). */
const SENTENCE_END = /[.!?।॥…]["'”’)\]]*$/u

/** A word's letters, its edges trimmed, as it was written (the case kept). */
function bare(text: string): string {
  return text.normalize('NFC').replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '')
}

/**
 * Who a quote's run is reported as said by (rule 8's `speaker`): the spoken
 * words directly before the run's first word (`first`, a word index), read
 * back across clause and sentence marks, past an object pronoun after the verb
 * and a 'that', 'this' or 'it'. When they end in a reporting verb the run is a
 * REPORTED quote: `{ reported: true, name }`, else `{ reported: false }`.
 *
 * `name` is the verb's subject only when the verb DIRECTLY GOVERNS the run
 * (rule 8, "<name> said / says / told"), and null otherwise, so the quote is
 * refused: the verb is one of "said / says / told"; the subject, the verb and
 * the run are in one sentence (a segment, and no sentence mark between them);
 * no negator stands in that sentence from its start to the verb ('Never has
 * Elon said: …', 'That is not what Elon said. Fail fast.'); and the subject is
 * a name: written with a capital, not a pronoun or a function word (a
 * negator subject, 'Nobody said: …', is the scan's above), and either not the first word of its sentence or written
 * with a capital again in the stretch where no sentence starts ('Mentors said:
 * …' and 'Then said: …' name no one). When in doubt, no name. Hindi and Telugu
 * reporting verbs are not listed, so a reported quote there reads as not
 * reported (its speaker stays the app's); their scripts have no capitals, so
 * no name is ever read from them.
 */
export function reportedBy(stretch: ClaimStretch, first: number): { reported: false } | { reported: true; name: string | null } {
  const ordered = [...stretch.words].sort((a, b) => a.index - b.index)
  const before = ordered.filter((w) => w.index < first)
  // The spoken words before the run, nearest first, each with its main token.
  const spoken: { word: Word; t: string }[] = []
  for (let k = before.length - 1; k >= 0; k--) {
    const t = claimTokens(before[k].text).filter((x) => x !== CLAUSE_BREAK)
    if (t.length > 0) spoken.push({ word: before[k], t: t[t.length - 1] })
  }
  let k = 0
  if (spoken[k] && DEMONSTRATIVES.includes(spoken[k].t)) k += 1
  if (spoken[k] && OBJECT_PRONOUNS.includes(spoken[k].t) && spoken[k + 1] && REPORTING_VERBS.includes(spoken[k + 1].t)) k += 1
  const verb = spoken[k]
  if (!verb || !REPORTING_VERBS.includes(verb.t)) return { reported: false }
  const subject = spoken[k + 1]
  if (!NAMING_VERBS.includes(verb.t) || !subject) return { reported: true, name: null }
  const unnamed = { reported: true as const, name: null }

  // One sentence: one segment, and no sentence mark from the subject to the run.
  const segmentOf = (i: number): number => stretch.sentences.findIndex((s) => i >= s.wordStart && i <= s.wordEnd)
  if (segmentOf(subject.word.index) !== segmentOf(first) || segmentOf(first) < 0) return unnamed
  if (ordered.some((w) => w.index >= subject.word.index && w.index < first && SENTENCE_END.test(w.text))) return unnamed
  // That sentence's words up to the verb: from the segment's start or the last sentence mark before the subject.
  const segment = stretch.sentences[segmentOf(first)]
  const lead = ordered.filter((w) => w.index >= segment.wordStart && w.index < subject.word.index)
  let from = segment.wordStart
  for (const w of lead) if (SENTENCE_END.test(w.text)) from = w.index + 1
  const upToVerb = ordered.filter((w) => w.index >= from && w.index <= verb.word.index)
  if (upToVerb.some((w) => claimTokens(w.text).some(isNegator))) return unnamed

  // A name.
  const raw = bare(subject.word.text)
  const t = subject.t
  if (!/^\p{Lu}/u.test(raw) || NOT_NAMES.includes(t) || FUNCTION_WORDS_EN.includes(t)) return unnamed
  const startsSentence = (w: Word): boolean => {
    const seg = stretch.sentences[segmentOf(w.index)]
    if (!seg || w.index === seg.wordStart) return true
    const prev = ordered.filter((x) => x.index < w.index && x.index >= seg.wordStart).pop()
    return !prev || SENTENCE_END.test(prev.text)
  }
  if (startsSentence(subject.word)) {
    const again = ordered.some((w) => w.index !== subject.word.index && bare(w.text) === raw && !startsSentence(w))
    if (!again) return unnamed
  }
  return { reported: true, name: raw }
}

// ---------------------------------------------------------------------------
// The per-graphic core.

/** The most words a quote holds (rule 9). */
export const QUOTE_MAX_WORDS = 16

/** A keyword's words: one to four (rule 9). */
export const KEYWORD_MAX_WORDS = 4

/** Rule 6's English test, as `bind` reads `lang`. */
function isEnglish(lang: string): boolean {
  return /^en(?:$|[-_])/iu.test(lang)
}

/** A phrase's spoken tokens as one key, as `claimsOf` compares a title with the fixed titles. */
function spokenKey(text: string): string {
  return claimTokensOf(text).filter((t) => t !== CLAUSE_BREAK).join(' ')
}

function wordsOf(text: string): string[] {
  return text.split(/\s+/u).filter(Boolean)
}

/** The string at a claim's path in the data ('items[1].value'). */
function fieldText(data: GraphicData, path: string): string {
  const m = /^items\[(\d+)\]\.(\w+)$/u.exec(path)
  const record = data as unknown as Record<string, unknown>
  const v = m ? (record.items as Record<string, unknown>[] | undefined)?.[Number(m[1])]?.[m[2]] : record[path]
  return typeof v === 'string' ? v : String(v ?? '')
}

/** What `checkGraphicData` found, and what a kept graphic is built from. */
interface Checked {
  problems: Problem[]
  claims: Claim[]
  bound: number[]
  stretch: ClaimStretch | null
}

function reasonText(reason: 'absent' | 'unpaired' | 'order' | 'negated' | 'unit', text: string, sentence: string): string {
  switch (reason) {
    case 'absent':
      return `'${text}' is not said in ${sentence}`
    case 'unit':
      return `'${text}' is said in ${sentence} in another unit`
    case 'unpaired':
      return `'${text}' is not said with what it is paired with, in one sentence of ${sentence}`
    case 'order':
      return `'${text}' is not said in the order of its value in ${sentence}`
    case 'negated':
      return `'${text}' is said negated in ${sentence}`
  }
}

/** The per-graphic core, which `checkGraphicData` returns the problems of and `validateGraphics` keeps the binding of. */
function check(
  data: GraphicData,
  def: TemplateDef,
  grounding: GraphicSpec['grounding'],
  transcript: Transcript,
  speakers: readonly string[]
): Checked {
  const problems: Problem[] = []
  const out = (stretch: ClaimStretch | null, claims: Claim[] = [], bound: number[] = []): Checked => ({ problems, claims, bound, stretch })
  if (!grounding) {
    problems.push({ path: '$', message: 'has no sentence to ground it' })
    return out(null)
  }
  const sentence = grounding.sentence
  const stretch = stretchFor(transcript, sentence)
  if (!stretch) {
    problems.push({ path: '$.sentence', message: `'${sentence}' is not a sentence of the transcript` })
    return out(null)
  }
  const english = isEnglish(transcript.language)
  const record = data as unknown as Record<string, unknown>

  // Rule 9, what the template holds before anything binds.
  const items = Array.isArray(record.items) ? (record.items as unknown[]) : null
  if (items) {
    if (def.minItems !== undefined && items.length < def.minItems) {
      problems.push({ path: '$.items', message: `a ${def.id} needs at least ${def.minItems} items, has ${items.length}` })
    }
    if (def.maxItems !== undefined && items.length > def.maxItems) {
      problems.push({ path: '$.items', message: `a ${def.id} holds at most ${def.maxItems} items, has ${items.length}` })
    }
  }
  if (data.template === 'quote' && data.kind !== 'social' && wordsOf(data.text).length > QUOTE_MAX_WORDS) {
    problems.push({ path: '$.text', message: `a quote is at most ${QUOTE_MAX_WORDS} words, this is ${wordsOf(data.text).length}` })
  }
  if (data.template === 'keyword') {
    const n = wordsOf(data.words).length
    if (n < 1 || n > KEYWORD_MAX_WORDS) {
      problems.push({ path: '$.words', message: `a keyword is 1 to ${KEYWORD_MAX_WORDS} said words, this is ${n}` })
    }
    // Rule 8's index mode: a range check is all the validator can do.
    if (!Number.isInteger(data.lit) || data.lit < 0 || data.lit >= n) {
      problems.push({ path: '$.lit', message: `lit ${data.lit} is not one of the keyword's ${n} words` })
    }
    // Rule 9: in English, at least one token outside the function words.
    if (english && n > 0 && claimTokensOf(data.words).filter((t) => t !== CLAUSE_BREAK).every((t) => FUNCTION_WORDS_EN.includes(t))) {
      problems.push({ path: '$.words', message: `'${data.words}' holds no word that says anything` })
    }
  }

  const claims = claimsOf(data, def)
  // A value field must be one number (rule 9: a counter must contain a number).
  for (const c of claims) {
    if (c.kind === 'number' && c.value === undefined) {
      problems.push({ path: `$.${c.path}`, message: `'${c.text}' is not one number` })
    }
  }
  // A grounded field with words but no content word grounds nothing (its words would be drawn unchecked);
  // a steps row and a callout's label must say something, for each is a beat.
  const fixedTitles = new Set((def.fixedTitles ?? []).map(spokenKey))
  const hasClaim = new Set(claims.map((c) => c.path))
  const fields: string[] = []
  for (const key of Object.keys(def.fields)) {
    if (def.fields[key] !== 'grounded') continue
    if (!key.startsWith('items.')) fields.push(key)
    else if (items) items.forEach((_, j) => fields.push(`items[${j}].${key.slice('items.'.length)}`))
  }
  // Rule 8: no mark lands in the picture that the binding trimmed away ('-bride', 'clients?', '¬easy').
  const kind = typeof record.kind === 'string' ? record.kind : undefined
  const modes = { ...def.fields, ...((kind && def.kindFields?.[kind]) || {}) }
  const valuePaths = new Set(claims.filter((c) => c.kind === 'number').map((c) => c.path))
  for (const key of Object.keys(modes)) {
    const mode = modes[key]
    if (mode !== 'grounded' && mode !== 'verbatim') continue
    const paths = !key.startsWith('items.') ? [key] : items ? items.map((_, j) => `items[${j}].${key.slice('items.'.length)}`) : []
    for (const path of paths) {
      if (valuePaths.has(path)) continue
      const text = fieldText(data, path)
      const marks = marksOf(text, mode === 'verbatim' ? 'verbatim' : 'words')
      if (marks.length > 0) problems.push({ path: `$.${path}`, message: `'${text}' draws '${marks.join("', '")}', which the transcript cannot ground` })
    }
  }
  for (const path of fields) {
    if (hasClaim.has(path)) continue
    const text = fieldText(data, path)
    const mustSay = (data.template === 'steps' && path.endsWith('.label')) || (data.template === 'callout' && path === 'label')
    if (path === 'title' && fixedTitles.has(spokenKey(text))) continue
    if (text.trim() !== '' || mustSay) {
      problems.push({ path: `$.${path}`, message: `'${text}' holds no word the transcript can ground` })
    }
  }
  if (problems.length > 0) return out(stretch, claims)

  // Rules 5-8: one occurrence per claim, pairs together, spoken order, negation, runs.
  const r = bind(claims, stretch, transcript.language)
  if (!r.ok) {
    const seen = new Set<string>()
    for (const c of r.missing) {
      if (seen.has(c.path)) continue
      seen.add(c.path)
      const row = r.reason === 'order' && c.kind === 'token' && c.pair === undefined
      const message = row
        ? `'${fieldText(data, c.path)}' is not said in the order the list draws it in ${sentence}`
        : reasonText(r.reason, fieldText(data, c.path), sentence)
      problems.push({ path: `$.${c.path}`, message })
    }
    return out(stretch, claims)
  }
  // A verbatim field's '?' and '!' only where the speaker's own word carries them.
  claims.forEach((c, i) => {
    if (c.kind !== 'run') return
    const unsaid = marksUnsaid(c.text, stretch, r.at[i])
    if (unsaid.length > 0) problems.push({ path: `$.${c.path}`, message: `'${c.text}' draws '${unsaid.join("', '")}', which is not said in ${sentence}` })
  })

  // Rule 9 on the MATCHED stretch numbers (rule 5: the template decides).
  if (data.template === 'ring') {
    const i = claims.findIndex((c) => c.kind === 'number')
    const m = r.matched[i]
    if (!m || m.unit !== '%') problems.push({ path: '$.value', message: `'${data.value}' is not said as a percentage in ${sentence}` })
    else if (m.n < 0 || m.n > 100) problems.push({ path: '$.value', message: `'${data.value}' is not a share of a whole (0 to 100%)` })
  }
  if (data.template === 'bars') {
    const units = claims.flatMap((c, i) => (c.kind === 'number' && r.matched[i] ? [`${r.matched[i]!.unit}${r.matched[i]!.currency ?? ''}`] : []))
    if (new Set(units).size > 1) problems.push({ path: '$.items', message: `the bars are said in ${sentence} in more than one unit` })
  }
  // Rule 8's speaker mode, a said quote's.
  if (data.template === 'quote' && data.kind !== 'social') {
    const allowed = speakerFor(stretch, r.at[0])
    const said = data.speaker.normalize('NFC').toLowerCase()
    const ok =
      'refused' in allowed
        ? false
        : allowed.reported
          ? said === allowed.speaker.normalize('NFC').toLowerCase()
          : said === '' || speakers.some((s) => s.normalize('NFC').toLowerCase() === said)
    if (!ok) {
      const why = 'refused' in allowed ? allowed.refused : allowed.reported ? `the stretch says ${allowed.speaker} said it` : 'no one is named saying it'
      problems.push({ path: '$.speaker', message: `'${data.speaker}' is not who said it: ${why}` })
    }
  }
  // Steps' parents are the app's (rule 9): a tree that is not one is never drawn.
  if (data.template === 'steps' && data.items.some((it) => it.parent !== undefined)) {
    if (!parentsValid(data.items.map((it) => it.parent ?? -1))) problems.push({ path: '$.items', message: 'the steps are not a valid tree' })
  }
  return out(stretch, claims, r.at)
}

/** The speaker a said quote's run allows (rule 8): the reporting verb's named subject, or the app's ('' or the asset's), or refused. */
function speakerFor(stretch: ClaimStretch, first: number): { reported: true; speaker: string } | { reported: false } | { refused: string } {
  const r = reportedBy(stretch, first)
  if (!r.reported) return { reported: false }
  if (r.name === null) return { refused: 'it is reported speech and the transcript does not name who said it' }
  return { reported: true, speaker: r.name }
}

/**
 * The per-graphic core (§6.7): rules 4-9 over one graphic's data against its
 * stretch (`grounding.sentence` and one sentence either side, over capped
 * segments; binding within one sentence). Empty means it grounds. Each
 * problem's path is the field's, rooted at the data ('$.items[1].value'), and
 * its message says why without "dropped": the dock shows it as a warning under
 * the field (§6.6), and `validateGraphics` drops the graphic with it.
 *
 * `speakers` (beyond §6.7's signature, optional): the names the app may set as
 * a said quote's speaker, the asset's Speaker and a link's channel. The
 * validator has no project, so it passes none: a model's quote takes '' or the
 * name the stretch says said it ("<name> said / says / told"), never another.
 * `user`, `fixed` and app fields are never checked; a lower third's `name` is
 * the app's and is not checked here.
 */
export function checkGraphicData(
  data: GraphicData,
  def: TemplateDef,
  grounding: GraphicSpec['grounding'],
  transcript: Transcript,
  speakers: readonly string[] = []
): Problem[] {
  return check(data, def, grounding, transcript, speakers).problems
}

// ---------------------------------------------------------------------------
// The answer as a whole.

/** Templates no model ever fills, whatever a menu offers (rule 9; §6.6). */
const NEVER_FROM_A_MODEL: readonly string[] = ['lower-third', 'screen-card']

/** What the panel keeps of each drawn field, in grapheme clusters (§6.6's "kept to"); `why` is cut, the rest drop. */
export const GRAPHIC_KEPT_CHARS = { title: 40, value: 16, label: 40, itemLabel: 32, itemValue: 16, quote: 120, words: 40, why: 60 } as const

/** A graphic's data from one answer graphic's flat fields: the template's own fields, the app's at their defaults (§6.6). */
function dataOf(g: AnswerGraphic, id: GraphicTemplateId): GraphicData | null {
  switch (id) {
    case 'counter':
    case 'ring':
      return { template: id, value: g.value, label: g.label }
    case 'bars':
      return { template: 'bars', title: g.title, items: g.items.map((i) => ({ label: i.label, value: i.value })) }
    case 'steps':
      return { template: 'steps', title: g.title, items: g.items.map((i) => ({ label: i.label })), connector: 'none' }
    case 'quote':
      return { template: 'quote', kind: 'said', text: g.quote, speaker: '' }
    case 'callout':
      // `shape` is the app's, set at placement (§6.2); arrow until then.
      return { template: 'callout', label: g.label, shape: 'arrow' }
    case 'keyword':
      return { template: 'keyword', words: g.words, lit: g.lit }
    case 'lower-third':
      // Built so that it is rule 9's "not offered", not a missing arm, that drops a model's lower third.
      return { template: 'lower-third', name: '', role: '' }
    default:
      return null
  }
}

/** The answer's path of a data path: a quote's `text` is the answer's `quote`. */
function answerPath(root: string, dataPath: string, template: string): string {
  const rest = dataPath.replace(/^\$/u, '')
  return `${root}${template === 'quote' ? rest.replace(/^\.text\b/u, '.quote') : rest}`
}

function cutGraphemes(text: string, max: number): string {
  if (graphemeCount(text) <= max) return text
  const S = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter
  const parts = S ? Array.from(new S(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment) : Array.from(text)
  return `${parts.slice(0, max - 1).join('')}…`
}

/** Over its kept length (§6.6), each drawn field of the answer graphic, as problems on the answer's paths. */
function overLength(g: AnswerGraphic, def: TemplateDef, root: string): Problem[] {
  const k = GRAPHIC_KEPT_CHARS
  const out: Problem[] = []
  const over = (path: string, text: string, max: number): void => {
    const n = graphemeCount(text)
    if (n > max) out.push({ path: `${root}.${path}`, message: `is ${n} characters, at most ${max} are drawn` })
  }
  const f = def.fields
  if (f.title) over('title', g.title, k.title)
  if (f.value) over('value', g.value, k.value)
  if (f.label) over('label', g.label, k.label)
  if (f.text) over('quote', g.quote, k.quote)
  if (f.words) over('words', g.words, k.words)
  g.items.forEach((it, j) => {
    if (f['items.label']) over(`items[${j}].label`, it.label, k.itemLabel)
    if (f['items.value']) over(`items[${j}].value`, it.value, k.itemValue)
  })
  return out
}

/**
 * The word index of each beat (§6.8, §6.2's table), from the bound claims:
 * `counter` and `ring` their value's word; `bars` each item's value's word, in
 * item order; `steps` each item's label's first bound word; `callout` its
 * label's first bound word; `keyword` its run's first word; `quote` one per
 * word of the run, from its first word (§6.8: "A quote's are its words"). How
 * those words become times, spread and lead included, is `graphicBeats`'
 * (T3's).
 */
function beatWordsOf(data: GraphicData, claims: readonly Claim[], bound: readonly number[], stretch: ClaimStretch): number[] {
  const at = (pred: (c: Claim) => boolean): number[] => claims.flatMap((c, i) => (pred(c) ? [bound[i]] : []))
  switch (data.template) {
    case 'counter':
    case 'ring':
      return at((c) => c.kind === 'number').slice(0, 1)
    case 'bars':
      return at((c) => c.kind === 'number')
    case 'steps':
      return data.items.flatMap((_, j) => {
        const mine = at((c) => c.path === `items[${j}].label`)
        return mine.length > 0 ? [Math.min(...mine)] : []
      })
    case 'callout': {
      const mine = at((c) => c.path === 'label')
      return mine.length > 0 ? [Math.min(...mine)] : []
    }
    case 'keyword':
      return bound.slice(0, 1)
    case 'quote': {
      if (bound.length === 0) return []
      const want = claimTokensOf(data.text).filter((t) => t !== CLAUSE_BREAK).length
      const ordered = [...stretch.words].sort((a, b) => a.index - b.index).filter((w) => w.index >= bound[0])
      const out: number[] = []
      let got = 0
      for (const w of ordered) {
        if (got >= want) break
        const n = claimTokens(w.text).filter((t) => t !== CLAUSE_BREAK).length
        if (n === 0) continue
        out.push(w.index)
        got += n
      }
      return out
    }
    default:
      return []
  }
}

/** §6.6: a graphic whose number claims bound to a YouTube word or an unsure Whisper word is a proposal only. */
function proposalOf(claims: readonly Claim[], bound: readonly number[], menu: GraphicsMenu, transcript: Transcript): GraphicSpec['proposal'] {
  const numbers = claims.flatMap((c, i) => (c.kind === 'number' ? [bound[i]] : []))
  if (numbers.length === 0) return undefined
  if (menu.wordSource !== 'whisper') return { reason: 'check-the-number', wordSource: menu.wordSource }
  const byIndex = new Map(transcript.words.map((w) => [w.index, w]))
  const unsure = numbers.some((i) => {
    const c = byIndex.get(i)?.confidence
    return c !== null && c !== undefined && c < 0.5
  })
  return unsure ? { reason: 'check-the-number', wordSource: 'whisper-unsure' } : undefined
}

/**
 * One graphic, repaired and checked, or the problems that drop it (§6.7:
 * "Everything else is one graphic at a time"). `root` is its path in the
 * answer ('$.graphics[2]'). Repairs, each with a note: a keyword's `lit` out of
 * range to its last word (rule 8's index mode); a bars or steps title that
 * does not ground to the template's first fixed title (§6.6); a steps list's
 * connector and every parent set by the app (`treeParents`), flat with a
 * `line` when `parentsValid` fails (rule 9); a said quote's speaker set by the
 * app (rule 8). Everything else that fails drops the graphic.
 */
function settleOne(
  input: GraphicData,
  sentence: string,
  why: string,
  source: GraphicCandidate['source'],
  root: string,
  menu: GraphicsMenu,
  transcript: Transcript
): { kept: GraphicCandidate; notes: Problem[] } | { dropped: Problem[] } {
  const notes: Problem[] = []
  const def = GRAPHIC_TEMPLATES[input.template]
  if (!def) return { dropped: [{ path: `${root}.template`, message: `graphic dropped: '${input.template}' is not offered` }] }
  const data = structuredClone(input) as GraphicData
  const drop = (problems: Problem[]): { dropped: Problem[] } => ({
    dropped: problems.map((p) => ({ path: answerPath(root, p.path, data.template), message: `graphic dropped: ${p.message}` }))
  })

  if (data.template === 'keyword') {
    const n = wordsOf(data.words).length
    if (n > 0 && (!Number.isInteger(data.lit) || data.lit < 0 || data.lit >= n)) {
      notes.push({ path: `${root}.lit`, message: `graphic repaired: lit ${data.lit} is not one of the ${n} words — the last one is lit` })
      data.lit = n - 1
    }
  }
  if (data.template === 'steps') {
    // A parent from anywhere but tree.ts is never trusted.
    data.items = data.items.map((it) => ({ label: it.label }))
    data.connector = 'none'
  }
  if (data.template === 'quote' && data.kind !== 'social') data.speaker = ''

  const grounding = { assetId: menu.assetId, sentence, words: [] as number[] }
  if (data.template === 'quote' && data.kind !== 'social') {
    // The app's speaker (rule 8): the name the stretch says said a reported quote, else ''.
    const c0 = check(data, def, grounding, transcript, [])
    if (c0.stretch && c0.bound.length > 0) {
      const allowed = speakerFor(c0.stretch, c0.bound[0])
      if ('refused' in allowed) return drop([{ path: '$.text', message: `'${data.text}': ${allowed.refused}` }])
      if (allowed.reported) data.speaker = allowed.speaker
    }
  }
  let problems = self.checkGraphicData(data, def, grounding, transcript)
  if ((data.template === 'bars' || data.template === 'steps') && def.fixedTitles?.length && problems.some((p) => p.path === '$.title')) {
    const fixed = def.fixedTitles[0]
    notes.push({ path: `${root}.title`, message: `graphic repaired: the title '${data.title}' is not said in ${sentence} — '${fixed}'` })
    data.title = fixed
    problems = self.checkGraphicData(data, def, grounding, transcript)
  }
  if (problems.length > 0) return drop(problems)

  const c = check(data, def, grounding, transcript, [])
  const stretch = c.stretch!
  if (data.template === 'steps') {
    const items = c.claims.flatMap((cl, i) => (cl.path.startsWith('items[') ? [c.bound[i]] : []))
    const lo = Math.min(...items)
    const hi = Math.max(...items)
    const words = transcript.words.filter((w) => w.index >= lo && w.index <= hi)
    const parents = treeParents(data.items, data.title, words)
    if (parentsValid(parents)) {
      data.items = data.items.map((it, j) => ({ label: it.label, parent: parents[j] }))
      data.connector = connectorFor(parents)
    } else {
      notes.push({ path: `${root}.items`, message: 'graphic repaired: the steps do not make a valid tree — drawn as a list with a line' })
      data.items = data.items.map((it) => ({ label: it.label, parent: -1 }))
      data.connector = 'line'
    }
  }
  const proposal = proposalOf(c.claims, c.bound, menu, transcript)
  const kept: GraphicCandidate = {
    sentence,
    data,
    bound: c.bound,
    beatWords: beatWordsOf(data, c.claims, c.bound, stretch),
    why: cutGraphemes(why, GRAPHIC_KEPT_CHARS.why),
    source,
    ...(proposal ? { proposal } : {})
  }
  return { kept, notes }
}

/**
 * Rule 9's "not offered" and the menu's sentences: a template the menu did not
 * offer (a `callout` without a subject track, §6.6), or `lower-third` or
 * `screen-card` whatever the menu says, or a sentence not on the menu, drops
 * the graphic. Null when it may go on.
 */
function offered(template: string, sentence: string, menu: GraphicsMenu, root: string): Problem | null {
  if (NEVER_FROM_A_MODEL.includes(template) || !(menu.templates as string[]).includes(template)) {
    return { path: `${root}.template`, message: `graphic dropped: '${template}' is not offered` }
  }
  if (!menu.sentences.some((s) => s.id === sentence)) {
    return { path: `${root}.sentence`, message: `graphic dropped: '${sentence}' is not a sentence on the menu` }
  }
  return null
}

/**
 * Does a `graphics@1` answer make sense against its menu (§6.7). Rejects only
 * what `validate2.ts` rejects: an answer cut off at the token cap and the wrong
 * shape (checked by `conforms` against `graphicsAnswerShape`). Everything else
 * is one graphic at a time: repaired with a note, or dropped with problems
 * whose paths are the answer's ('$.graphics[1].items[0].value') and whose
 * messages the panel shows ("graphic dropped: '45%' is not said in s07").
 * `dropped` holds every note, the repairs' included ("graphic repaired: …").
 *
 * Per graphic: its sentence must be one of the menu's; its template one the
 * menu offers, and never `lower-third` or `screen-card`, whatever the menu
 * says ("not offered"); each drawn field within its kept length (§6.6); then
 * `checkGraphicData`, the one the dock calls.
 */
export function validateGraphics(
  answer: unknown,
  menu: GraphicsMenu,
  transcript: Transcript,
  options: { truncated?: boolean } = {}
): { kept: GraphicCandidate[]; dropped: Problem[] } | { rejected: string } {
  if (options.truncated) return { rejected: "The model's graphics ran out of room before it finished" }
  const shape = conforms(graphicsAnswerShape(), answer)
  if (shape.length > 0) return { rejected: `The graphics are not the shape asked for — ${shape[0].path} ${shape[0].message}` }
  const graphics = (answer as GraphicsAnswer).graphics
  const kept: GraphicCandidate[] = []
  const dropped: Problem[] = []
  graphics.forEach((g, i) => {
    const root = `$.graphics[${i}]`
    const off = offered(g.template, g.sentence, menu, root)
    if (off) {
      dropped.push(off)
      return
    }
    const data = dataOf(g, g.template as GraphicTemplateId)
    const def = GRAPHIC_TEMPLATES[g.template as GraphicTemplateId]
    if (!data || !def) {
      dropped.push({ path: `${root}.template`, message: `graphic dropped: '${g.template}' is not offered` })
      return
    }
    const long = overLength(g, def, root)
    if (long.length > 0) {
      dropped.push(...long.map((p) => ({ path: p.path, message: `graphic dropped: ${p.message}` })))
      return
    }
    const r = settleOne(data, g.sentence, g.why, 'model', root, menu, transcript)
    if ('dropped' in r) dropped.push(...r.dropped)
    else {
      kept.push(r.kept)
      dropped.push(...r.notes)
    }
  })
  return { kept, dropped }
}

/**
 * The baseline's candidates (§6.10, lane T4's `baselineGraphics`), validated
 * the same way as a model's graphics (§6.7): each one's data through the same
 * repairs and `checkGraphicData`, its `bound`, `beatWords` and proposal
 * recomputed, never taken from the candidate; paths '$.baseline[i]'.
 */
export function validateBaseline(
  candidates: readonly GraphicCandidate[],
  menu: GraphicsMenu,
  transcript: Transcript
): { kept: GraphicCandidate[]; dropped: Problem[] } {
  const kept: GraphicCandidate[] = []
  const dropped: Problem[] = []
  candidates.forEach((cand, i) => {
    const root = `$.baseline[${i}]`
    const off = offered(cand.data.template, cand.sentence, menu, root)
    if (off) {
      dropped.push(off)
      return
    }
    const r = settleOne(cand.data, cand.sentence, cand.why, 'baseline', root, menu, transcript)
    if ('dropped' in r) dropped.push(...r.dropped)
    else {
      kept.push(r.kept)
      dropped.push(...r.notes)
    }
  })
  return { kept, dropped }
}

