/**
 * A graphic's types: which templates exist, what each one draws, how the
 * validator treats each field, and the spec a graphic clip carries
 * (docs/CLIPS.md §6.1). The types are phase 1's; the values, GRAPHIC_TEMPLATES
 * at the foot of the file, are phase 2's (§6.2). Which templates the model is
 * offered (§6.2's last column, §6.6's "Templates offered") is the menu's to
 * say, not a field here.
 *
 * Nothing here imports the timeline, so `timeline.ts` can take
 * `GraphicSpec` from this file without an import cycle.
 */

import type { UnitRect } from '../reframe/types'

/** Every template id, those drawn later included (docs/CLIPS.md §6.1); no `tree` id, the tree is `steps` with a connector. */
export type GraphicTemplateId =
  | 'counter'
  | 'bars'
  | 'steps'
  | 'quote'
  | 'callout'
  | 'ring'
  // phase 2
  | 'keyword'
  | 'lower-third'
  // phase 3 (§6.16)
  | 'screen-card'
  // step 6
  | 'timeline'
  | 'before-after'
  | 'versus'
  // steps 5/6
  | 'source'

/** What a graphic draws, by template: every drawn value a string as said; keyword's `lit` and steps' `parent` are indices into other fields (docs/CLIPS.md §6.1, meanings §6.2). */
export type GraphicData =
  | { template: 'counter'; value: string; label: string }
  | { template: 'bars'; title: string; items: { label: string; value: string }[] }
  /** `parent` (an index into `items`, −1 the title) and `connector` are the app's, never the model's (§6.2, §6.7). */
  | { template: 'steps'; title: string; items: { label: string; parent?: number }[]; connector: 'none' | 'line' | 'tree' }
  | { template: 'quote'; kind?: 'said'; text: string; speaker: string }
  /** Step 5's social quote card (§8.4): every field typed or pasted by the user; `link` stored, never fetched. */
  | { template: 'quote'; kind: 'social'; text: string; name: string; handle: string; date: string; link: string }
  | { template: 'callout'; label: string; shape: 'arrow' | 'circle' }
  | { template: 'ring'; value: string; label: string }
  /** One to four said words in a contiguous run; `lit` an index into them. */
  | { template: 'keyword'; words: string; lit: number }
  /** `name` from `MediaAsset.speaker`, `role` typed by the user. */
  | { template: 'lower-third'; name: string; role: string }
  /** Phase 3 (§6.16): no string field that is a claim, so the validator never sees it. */
  | { template: 'screen-card'; clipId: string; move: 'tilt-in' | 'pull-back' }
  | { template: 'timeline'; items: { when: string; label: string }[] }
  | { template: 'before-after'; before: { label: string; value: string }; after: { label: string; value: string } }
  | { template: 'versus'; left: { label: string; value: string }; right: { label: string; value: string } }
  | { template: 'source'; kind: 'wiki' | 'page' | 'headline' | 'answer'; title: string; excerpt: string; outlet: string; date: string }

/** How the validator treats a field (docs/CLIPS.md §6.1, §6.7 rule 8); `index` points into another field and is checked for range only. */
export type FieldMode = 'verbatim' | 'grounded' | 'fixed' | 'speaker' | 'user' | 'index'

/** A template's definition, one row of phase 2's GRAPHIC_TEMPLATES (docs/CLIPS.md §6.1, values §6.2). */
export interface TemplateDef {
  id: GraphicTemplateId
  seconds: { min: number; default: number; max: number }
  /** No field drawn into a frame is ever free. */
  fields: Record<string, FieldMode>
  /** Per `data.kind`, overriding `fields`: quote's `social` is every field `user` (§8.4). */
  kindFields?: Record<string, Record<string, FieldMode>>
  /** Every field the app sets and no model is offered (§6.2's table). */
  appFields?: string[]
  /** The titles the template may draw without grounding. */
  fixedTitles?: string[]
  /** Fields that bind as label–value pairs (§6.7 rule 6). */
  pairs?: [label: string, value: string][]
  maxItems?: number
  /** The fewest items a list template draws: §6.2's "(at least 2)" for bars and steps. */
  minItems?: number
  needsSubject?: boolean
  /** "This template may ask for depth" (§6.16). */
  threeD: boolean
}

/** What a graphic clip draws, and when and where (docs/CLIPS.md §6.1's table). */
export interface GraphicSpec {
  /** Every string the painter draws, or the template's listed fixed glyphs. */
  data: GraphicData
  /** On screen, inside `TemplateDef.seconds`. */
  seconds: number
  /** When each element arrives, seconds from the clip's start, from word timings (§6.8); never the model's. */
  beats: number[]
  /** The transcript's asset, the cited sentence, the word index each beat landed on. */
  grounding?: { assetId: string; sentence: string; words: number[] }
  /** Where it sits (§6.9); `auto` is recomputed on rebake. */
  place: { auto: true; third: 'top' | 'middle' | 'bottom' } | { auto: false; box: UnitRect }
  /**
   * A callout's target and a dim's hole on the clip beneath, in source units, set once at onset (§6.9).
   * `null`: the subject was looked for and not taken (none at onset, or the shot zooms under the graphic,
   * §6.9 step 4), so no hole is drawn. Absent: never placed by §6.9 (a graphic added by hand), and
   * targets.ts falls back to the caption track's subject.
   */
  subject?: { clipId: string; box: UnitRect; ms: number } | null
  /** Retrieved facts, steps 5/6. */
  sources?: { title: string; url: string; outlet: string; date: string; licence: string }[]
  /** A graphic the user keeps before it is placed (§6.6; `'pointed'` §6.18). */
  proposal?: {
    reason: 'check-the-number' | 'pointed'
    wordSource?: 'youtube-asr' | 'youtube-lines' | 'whisper-unsure'
  }
  /** A GRAPHIC_STYLES id; absent is the project's. */
  style?: string
  /** Stored; never `Math.random` at draw time. */
  seed: number
  /** Bumped on every edit; left out of every cache key. */
  version: number
  /**
   * Phase 3 (§6.16), only where `TemplateDef.threeD`. `'flat'` is beyond
   * §6.1's type: the dock's Flat, the user's choice of no move, kept as a
   * value so it is remembered as the user's (as `place.auto: false` remembers
   * a dragged box): a graphic with a `depth` and no `hero` has the user's
   * depth, and the hero rule never takes it (graphics/apply.ts `withHeroes`).
   * Absent: never chosen, drawn flat.
   */
  depth?: 'flat' | 'tilt' | 'parallax' | 'dolly' | 'focus'
  /** Phase 3 (§6.16): its footage clip's hero graphic; cleared by the user's Depth choice. */
  hero?: true
  /** Phase 4 (§6.18): `event` is a `PointEvent.id`. */
  anchor?: { assetId: string; event: string }
}

/** A graphic the validator kept, before it is placed (docs/CLIPS.md §6.7); its ids are menu-local. */
export interface GraphicCandidate {
  sentence: string
  data: GraphicData
  /** One word index per claim, in claim order. */
  bound: number[]
  /** The word index of each beat (§6.8). */
  beatWords: number[]
  why: string
  source: 'model' | 'baseline'
  proposal?: GraphicSpec['proposal']
}

/** A kept candidate paired with the footage clip and transcript asset its menu came from: `applyGraphics`' input (docs/CLIPS.md §6.6; `pairSettled` in director/run.ts pairs them). */
export interface KeptGraphic {
  clipId: string
  assetId: string
  candidate: GraphicCandidate
}

/**
 * A graphic that was not kept or not placed, structured (beyond §6.6's words:
 * the drops otherwise come back only as `Problem` text): the footage clip it
 * was for, its template as named, the first string it would draw ('' when it
 * draws none) and why, without the "graphic dropped: " head. Built by
 * `settleGraphics` (the validator's drops) and
 * `graphicDropsOf` (applyGraphics'), for the decision record, the panel's
 * notes and the eval.
 */
export interface GraphicDrop {
  clipId: string
  template: string
  text: string
  reason: string
  /**
   * What the Transcript tile's **Add** places (try-out 1, 2026-11-15, the
   * owner's "even the ones that did not trigger, add them too"), absent when
   * the graphic cannot be drawn at all (no template drawn, nothing to draw, a
   * sentence that is not the menu's, a field over its kept length).
   * - A drop of `applyGraphics` (the budget's room rules, placement, the
   *   lane, a retime: `graphicDropsOf`) carries the validated `KeptGraphic`
   *   itself: bound words, beat words and all.
   * - A drop of the validator (`settleGraphics`: not said, negated, a
   *   what-if, a pairing, …) carries the graphic as it would have been drawn
   *   (`droppedCandidate` in director/validateGraphics.ts): its beat words
   *   from the binding as far as `bind` came, else its sentence's first word,
   *   so it lands on its sentence.
   * Session state only: `decisionForGraphics` leaves it out of the record.
   */
  add?: KeptGraphic
}

/** Seconds, field modes and the rest for each drawn template (docs/CLIPS.md §6.2's GRAPHIC_TEMPLATES table; the seconds are the nine shapes' table, proposals until M16). Frozen through and through. */
export const GRAPHIC_TEMPLATES: Partial<Record<GraphicTemplateId, TemplateDef>> = deepFreeze({
  counter: {
    id: 'counter',
    seconds: { min: 2, default: 3, max: 4 },
    fields: { value: 'grounded', label: 'grounded' },
    pairs: [['label', 'value']],
    threeD: true
  },
  bars: {
    id: 'bars',
    seconds: { min: 3, default: 5, max: 6 },
    fields: { title: 'grounded', 'items.label': 'grounded', 'items.value': 'grounded' },
    fixedTitles: ['By the numbers', 'Compared'],
    pairs: [['items.label', 'items.value']],
    maxItems: 5,
    minItems: 2,
    threeD: false
  },
  steps: {
    id: 'steps',
    seconds: { min: 3, default: 6, max: 8 },
    fields: { title: 'grounded', 'items.label': 'grounded' },
    fixedTitles: ['Step by step'],
    maxItems: 6,
    minItems: 2,
    appFields: ['parent', 'connector'],
    threeD: false
  },
  quote: {
    id: 'quote',
    seconds: { min: 2, default: 4, max: 6 },
    fields: { text: 'verbatim', speaker: 'speaker' },
    kindFields: { social: { text: 'user', name: 'user', handle: 'user', date: 'user', link: 'user' } },
    appFields: ['speaker'],
    threeD: false
  },
  callout: {
    id: 'callout',
    seconds: { min: 1.5, default: 2.5, max: 3 },
    fields: { label: 'grounded' },
    appFields: ['shape'],
    needsSubject: true,
    threeD: false
  },
  ring: {
    id: 'ring',
    seconds: { min: 2, default: 3, max: 4 },
    fields: { value: 'grounded', label: 'grounded' },
    pairs: [['label', 'value']],
    threeD: true
  },
  keyword: {
    id: 'keyword',
    seconds: { min: 1.5, default: 2.5, max: 3.5 },
    fields: { words: 'verbatim', lit: 'index' },
    threeD: false
  },
  'lower-third': {
    id: 'lower-third',
    seconds: { min: 2.5, default: 3.5, max: 5 },
    fields: { name: 'speaker', role: 'user' },
    appFields: ['name'],
    threeD: false
  },
  'screen-card': {
    id: 'screen-card',
    seconds: { min: 1, default: 10, max: 600 },
    fields: {},
    appFields: ['clipId', 'move'],
    threeD: true
  },
  /*
   * Step 6's three (docs/CLIPS.md §9, "The 3D templates"): every drawn string
   * grounded, each pair as §6.7 rule 6 binds a bars item (a value with its
   * label; a timeline item's `when` is its value), no title and no fixed
   * title, flat by default with depth the user's (`threeD`). The seconds are
   * this piece's proposals until M16, set beside §6.2's rows:
   * - `timeline`, 3 / 6 / 8, steps' own: a list arriving one row per beat as
   *   steps does, two strings a row (a when and a label, about a steps row's
   *   words), at most 5 rows to steps' 6; the same reading hold.
   * - `before-after` and `versus`, 2.5 / 4 / 6: two label-value pairs, two
   *   beats. Twice a counter's or a ring's one pair (2 / 3 / 4) to read, so
   *   the default a second longer and the most bars' 6; the least is two
   *   beats about a second apart after LEAD_S, plus TAIL_S (0.5 + 1 + 0.8 =
   *   2.3), rounded up.
   */
  timeline: {
    id: 'timeline',
    seconds: { min: 3, default: 6, max: 8 },
    fields: { 'items.when': 'grounded', 'items.label': 'grounded' },
    pairs: [['items.label', 'items.when']],
    maxItems: 5,
    minItems: 2,
    threeD: true
  },
  'before-after': {
    id: 'before-after',
    seconds: { min: 2.5, default: 4, max: 6 },
    fields: { 'before.label': 'grounded', 'before.value': 'grounded', 'after.label': 'grounded', 'after.value': 'grounded' },
    pairs: [
      ['before.label', 'before.value'],
      ['after.label', 'after.value']
    ],
    threeD: true
  },
  versus: {
    id: 'versus',
    seconds: { min: 2.5, default: 4, max: 6 },
    fields: { 'left.label': 'grounded', 'left.value': 'grounded', 'right.label': 'grounded', 'right.value': 'grounded' },
    pairs: [
      ['left.label', 'left.value'],
      ['right.label', 'right.value']
    ],
    threeD: true
  }
} satisfies Partial<Record<GraphicTemplateId, TemplateDef>>)

/**
 * The sides of the two-sided templates (step 6, docs/CLIPS.md §9): each a
 * `{ label, value }` field of the data, in the order they are drawn and said.
 * A field key `<side>.<leaf>` of their rows names one side's leaf.
 */
export const GRAPHIC_SIDES: Readonly<Partial<Record<GraphicTemplateId, readonly [string, string]>>> = Object.freeze({
  'before-after': Object.freeze(['before', 'after'] as const),
  versus: Object.freeze(['left', 'right'] as const)
})

/**
 * How the words on screen name a template (the dock's heading, the
 * Transcript tile's lists, the notes): its id with the dash read as a space
 * ("lower third", "screen card"), except where that reads wrong: a
 * before-after said "before after" beside the Library's "Before and after"
 * tile. Any string, since a dropped answer's template may be no known id.
 */
const GRAPHIC_NAMES: Readonly<Partial<Record<GraphicTemplateId, string>>> = Object.freeze({ 'before-after': 'before-and-after' })

export function graphicName(template: string): string {
  return GRAPHIC_NAMES[template as GraphicTemplateId] ?? template.replace(/-/gu, ' ')
}

/**
 * The string at a field path of a graphic's data, '' when it is not one: a
 * top-level field (`value`), an item's (`items[1].label`) or a side's
 * (`before.value`, step 6's two-sided templates). The one reader of a path the
 * validator, the claims and the dock share.
 */
export function graphicFieldText(data: GraphicData, path: string): string {
  const record = data as unknown as Record<string, unknown>
  const item = /^items\[(\d+)\]\.(\w+)$/u.exec(path)
  if (item) {
    const v = (record.items as Record<string, unknown>[] | undefined)?.[Number(item[1])]?.[item[2]]
    return typeof v === 'string' ? v : String(v ?? '')
  }
  const side = /^(\w+)\.(\w+)$/u.exec(path)
  if (side) {
    const owner = record[side[1]]
    const v = owner !== null && typeof owner === 'object' ? (owner as Record<string, unknown>)[side[2]] : undefined
    return typeof v === 'string' ? v : String(v ?? '')
  }
  const v = record[path]
  return typeof v === 'string' ? v : String(v ?? '')
}

/**
 * The name a lower third placed by hand from the Library draws when the
 * footage under it has no Speaker (try-out 1 piece 6, 2026-11-15): words
 * that read as a placeholder, never a name the app made up. Typing the
 * Speaker in the dock's panel then draws the Speaker instead (`withSpeaker`).
 * Here, beside the templates, so graphics/apply.ts and graphics/library.ts
 * share it without importing each other.
 */
export const SPEAKER_PLACEHOLDER = 'Speaker name'

/**
 * Rule 10's spacing (docs/CLIPS.md §6.7; D12, §16.65), kept for every graphic:
 * onsets at least `minGapS` apart, and at most one graphic per `perS` seconds of
 * clip, weighed by `roomRank` (a keyword yields to any other template; inside
 * a rank the earlier wins). `applyBudget` (`graphics/budget.ts`, §6.9) is the
 * one place that decides room, across the project, with the lower third and
 * the graphics already placed in view; `settleGraphics` no longer spaces
 * within one answer (try-out 1, 2026-11-15: a window cannot see what will
 * hold room at apply time, so a ring lost its room there to a keyword the
 * budget then dropped). Here, beside the templates, so it stays the
 * templates' fact and not the budget's.
 */
export const GRAPHIC_SPACING: Readonly<{ minGapS: number; perS: number }> = Object.freeze({ minGapS: 6, perS: 20 })

/**
 * The templates that yield room (try-out 1, 2026-11-15; it changes D12's
 * tie-break, "the earlier one wins", §16.65): when graphics compete for the
 * 6 s gap or the per-20 s count, one of these loses to any template not
 * listed, whatever their order in time. A keyword only repeats words the
 * caption already shows; a number, a list or a name card says something the
 * caption cannot draw.
 */
export const ROOM_YIELDING_TEMPLATES: readonly GraphicTemplateId[] = Object.freeze(['keyword'] as GraphicTemplateId[])

/**
 * A template's rank for room (`applyBudget`): 0 for every template, 1 for one
 * in `ROOM_YIELDING_TEMPLATES`. Rank 0 is weighed first, in onset order, then
 * rank 1, in onset order; a graphic already on the timeline holds whatever
 * its rank (it is placed). A template id this build does not know ranks 0.
 */
export function roomRank(template: string): 0 | 1 {
  return (ROOM_YIELDING_TEMPLATES as readonly string[]).includes(template) ? 1 : 0
}

/** Object.freeze all the way down, so no caller can edit a field mode in place. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
  }
  return value
}
