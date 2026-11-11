import type { ObjectSchema, StringSchema } from './conforms'
import { MAX_REASONING_CHARS } from './schema'
import { MAX_WHY2_DECODE_CHARS } from './schema2'
import type { GraphicsMenu } from './run'

/**
 * `graphics@1` — the third pass's answer (docs/CLIPS.md §6.6): which sentences
 * of a talk a graphic would help, with which offered template, and the words
 * copied into that template's fields. The model fills nothing else: no look,
 * motion, sound, place, beat, duration, connector, parent, anchor, depth,
 * shape or speaker — the schema has no field for any of them.
 *
 * One flat decode. One graphic object carries the union of the offered
 * templates' fields, unused ones left as ''. The six templates every menu
 * offers (counter, bars, steps, quote, ring, keyword) already hold every
 * field a callout has, so the object is the same for every menu: only the
 * `sentence` and `template` enums are the menu's. That is what lets
 * `validateGraphics` check the shape of any answer against
 * `graphicsSchema(menu, { constrained: false })`, the one shape there is.
 *
 * What the decoder allows is looser than what is kept (§6.6: a grammar cut-off
 * mid-string made Gemma 4 E2B close a whole plan after one segment); the kept
 * lengths are `validateGraphics.ts`' `GRAPHIC_KEPT_CHARS`, `QUOTE_MAX_WORDS`
 * and `KEYWORD_MAX_WORDS`, and are not written twice here.
 *
 * Pure and node-runnable.
 */

export const GRAPHICS_PASS = 'graphics@1'

/** At most four graphics an answer (§6.6, `MAX_GRAPHICS`). */
export const MAX_GRAPHICS = 4

/** At most six items a graphic in the answer's shape (§6.6: `items` `maxItems` 6). */
export const MAX_ANSWER_ITEMS = 6

/** What the decoder allows each field to be (§6.6's "decoded to"); `reasoning` is the spine's 300, `why` the spine's 100. */
export const GRAPHIC_DECODE_CHARS = {
  reasoning: MAX_REASONING_CHARS,
  title: 60,
  value: 24,
  label: 60,
  itemLabel: 48,
  itemValue: 24,
  quote: 200,
  words: 60,
  why: MAX_WHY2_DECODE_CHARS
} as const

/** A keyword's `lit` when constrained: which of its at most four words is lit, counting from 0 (§6.6). */
export const LIT_MAX = 3

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

/**
 * The answer schema for one menu. `constrained` (the default) is the
 * decoder's: the menu's sentence ids and offered templates as enums, every
 * text field's decoded length, `lit` 0..3. `constrained: false` is the
 * validator's shape check: no enum, no length, no integer range, so an
 * out-of-list id or an out-of-range `lit` is repaired or dropped one graphic
 * at a time rather than failing the pass (`schema2.ts`' twin). `reasoning`
 * first; every object's `required` in declaration order.
 */
export function graphicsSchema(menu: Pick<GraphicsMenu, 'sentences' | 'templates'>, options: { constrained?: boolean } = {}): ObjectSchema {
  const constrained = options.constrained ?? true
  if (constrained) {
    if (menu.sentences.length === 0) throw new Error('Finding graphics needs at least one sentence')
    if (menu.templates.length === 0) throw new Error('Finding graphics needs at least one template')
  }
  const ids = (values: readonly string[]): Pick<StringSchema, 'enum'> => (constrained ? { enum: [...values] } : {})
  const limit = (n: number): Pick<StringSchema, 'maxLength'> => (constrained ? { maxLength: n } : {})
  const d = GRAPHIC_DECODE_CHARS

  const item: ObjectSchema = {
    type: 'object',
    properties: {
      label: { type: 'string', ...limit(d.itemLabel), description: 'What this row says, copied' },
      value: { type: 'string', ...limit(d.itemValue), description: "This row's number, copied, or empty" }
    },
    required: ['label', 'value'],
    additionalProperties: false
  }

  const graphic: ObjectSchema = {
    type: 'object',
    properties: {
      sentence: { type: 'string', ...ids(menu.sentences.map((s) => s.id)), description: 'The id of the sentence the words are copied from' },
      template: { type: 'string', ...ids(menu.templates), description: 'One template id, from TEMPLATES' },
      title: { type: 'string', ...limit(d.title), description: 'Copied, or empty' },
      value: { type: 'string', ...limit(d.value), description: 'One number, copied, or empty' },
      label: { type: 'string', ...limit(d.label), description: 'What the number counts or what is on screen, copied, or empty' },
      items: { type: 'array', items: item, maxItems: MAX_ANSWER_ITEMS, description: 'The rows, in the order said, or empty' },
      quote: { type: 'string', ...limit(d.quote), description: 'The line, copied word for word, or empty' },
      words: { type: 'string', ...limit(d.words), description: 'One to four words, copied exactly, or empty' },
      lit: { type: 'integer', ...(constrained ? { minimum: 0, maximum: LIT_MAX } : {}), description: 'Which of the words to light, counting from 0' },
      why: { type: 'string', ...limit(d.why), description: 'Why a graphic helps here, in a few words' }
    },
    required: ['sentence', 'template', 'title', 'value', 'label', 'items', 'quote', 'words', 'lit', 'why'],
    additionalProperties: false
  }

  return {
    type: 'object',
    properties: {
      reasoning: { type: 'string', ...limit(d.reasoning), description: 'Think here first, briefly: what the talk says and which moments a graphic helps' },
      graphics: { type: 'array', items: graphic, minItems: 0, maxItems: MAX_GRAPHICS, description: 'At most four, or none' }
    },
    required: ['reasoning', 'graphics'],
    additionalProperties: false
  }
}

/**
 * Room for the answer: 250 for the wrapper and the reasoning and 150 a graphic,
 * four at most (§6.6's starting figure, a proposal: 140 a graphic before
 * `words` and `lit`). Recalibrated from the eval, as `maxTokensFor2` was.
 */
export function maxTokensForGraphics(_menu: Pick<GraphicsMenu, 'sentences'>): number {
  return 250 + 150 * MAX_GRAPHICS
}
