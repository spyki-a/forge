/**
 * A graphic's types: which templates exist, what each one draws, how the
 * validator treats each field, and the spec a graphic clip carries
 * (docs/CLIPS.md §6.1). Types only in phase 1: the values, GRAPHIC_TEMPLATES,
 * arrive with phase 2's templates (§6.2).
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
  /** A callout's target and a dim's hole on the clip beneath, in source units, set once at onset (§6.9). */
  subject?: { clipId: string; box: UnitRect; ms: number }
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
  /** Phase 3 (§6.16), only where `TemplateDef.threeD`. */
  depth?: 'tilt' | 'parallax' | 'dolly' | 'focus'
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

/** A kept candidate paired with the footage clip and transcript asset its menu came from: `applyGraphics`' input (docs/CLIPS.md §6.6). */
export interface KeptGraphic {
  clipId: string
  assetId: string
  candidate: GraphicCandidate
}
