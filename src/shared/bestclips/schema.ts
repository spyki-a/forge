import type { ObjectSchema, StringSchema } from '../director/conforms'
import { MAX_REASONING_CHARS } from '../director/schema'

/**
 * `bestclips@1` — Best clips' one comparative call (docs/CLIPS.md §7.4): the
 * model reads the prefilter's candidates (an id and its condensed text each)
 * and answers `{ reasoning, picks: [{ id, title, why }] }`. It picks ids; code
 * turns an id into time (`run.ts`, from the window the id names), so the
 * schema has no field that could carry one: no start, no end, no length
 * (docs/DIRECTOR.md §1). A small model compares well and rates on an absolute
 * scale badly (`director/look.ts`), so the call is one comparison over every
 * candidate, never a score per window.
 *
 * FLAT, as `conforms.ts` and both providers need it: every object closes with
 * `additionalProperties: false` and requires every field it declares, in
 * declaration order, `reasoning` first; no `oneOf`, `$ref` or `uniqueItems`
 * (not in the subset), so "no id twice" is the validator's.
 *
 * HOW MANY PICKS: `picksWanted(n)`, three, or every candidate when there are
 * fewer (`minItems` = `maxItems` = that number): the model is never asked for
 * more picks than there are windows to pick. With no candidate at all there
 * is nothing to ask, and the constrained schema refuses to be built
 * (`run.ts` never asks then).
 *
 * What the decoder allows is looser than what is kept (§7.4, "with decode
 * headroom"; §6.6: a grammar cut-off mid-string made Gemma 4 E2B close a whole
 * answer early). The kept lengths are graphemes (`validate.ts`: a title 60, a
 * why 120); `maxLength` counts code points (`conforms.ts`' `chars`), and a
 * Devanagari or Telugu grapheme is often two or three code points (a
 * consonant, a virama, a vowel sign), so the decoder gets three code points a
 * kept grapheme: a 60-grapheme Telugu title is never cut off by the grammar.
 *
 * Pure and node-runnable.
 */

export const BEST_CLIPS_PASS = 'bestclips@1'

/** The cards Best clips shows (sheet 27). */
export const PICKS = 3

/** The kept lengths, in graphemes (§7.4): a card's title and why. */
export const TITLE_KEPT_GRAPHEMES = 60
export const WHY_KEPT_GRAPHEMES = 120

/** Code points a kept grapheme may take in the decoder (an Indic cluster is up to about three). */
export const DECODE_POINTS_PER_GRAPHEME = 3

/** What the decoder allows each field (code points): reasoning the spine's 300, title and why three a kept grapheme. */
export const BEST_CLIPS_DECODE_CHARS = {
  reasoning: MAX_REASONING_CHARS,
  title: TITLE_KEPT_GRAPHEMES * DECODE_POINTS_PER_GRAPHEME,
  why: WHY_KEPT_GRAPHEMES * DECODE_POINTS_PER_GRAPHEME
} as const

/** One pick of a `bestclips@1` answer. */
export interface ClipPickAnswer {
  id: string
  title: string
  why: string
}

/** A `bestclips@1` answer: `reasoning` first, then the picks. */
export interface BestClipsAnswer {
  reasoning: string
  picks: ClipPickAnswer[]
}

/** How many picks to ask for from `candidates` candidates: three, or all of them when fewer. */
export function picksWanted(candidates: number): number {
  return Math.max(0, Math.min(PICKS, Math.floor(candidates)))
}

/**
 * The answer schema for a menu of candidate ids. `constrained` (the default)
 * is the decoder's: `id` an enum of the ids, the decoded lengths, exactly
 * `picksWanted(ids.length)` picks. `constrained: false` is the validator's
 * shape check: no enum, no length, no item count, so an id off the menu, a
 * fourth pick or a long title is repaired or dropped one pick at a time
 * (`validate.ts`) rather than failing the whole answer.
 */
export function bestClipsSchema(ids: readonly string[], options: { constrained?: boolean } = {}): ObjectSchema {
  const constrained = options.constrained ?? true
  const wanted = picksWanted(ids.length)
  if (constrained && wanted === 0) throw new Error('Best clips needs at least one candidate to ask about')
  const limit = (n: number): Pick<StringSchema, 'maxLength'> => (constrained ? { maxLength: n } : {})
  const d = BEST_CLIPS_DECODE_CHARS

  const pick: ObjectSchema = {
    type: 'object',
    properties: {
      id: { type: 'string', ...(constrained ? { enum: [...ids] } : {}), description: 'The id of one candidate, from CANDIDATES' },
      title: { type: 'string', ...limit(d.title), description: "A short title for the clip, in the talk's own language" },
      why: { type: 'string', ...limit(d.why), description: 'Why a viewer would want to watch this clip on its own' }
    },
    required: ['id', 'title', 'why'],
    additionalProperties: false
  }

  return {
    type: 'object',
    properties: {
      reasoning: { type: 'string', ...limit(d.reasoning), description: 'Think here first, briefly: compare the candidates' },
      picks: {
        type: 'array',
        items: pick,
        ...(constrained ? { minItems: wanted, maxItems: wanted } : {}),
        description: wanted === 1 ? 'Exactly one pick' : `Exactly ${wanted} picks, each a different candidate`
      }
    },
    required: ['reasoning', 'picks'],
    additionalProperties: false
  }
}
