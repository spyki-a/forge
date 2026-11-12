import type { Clip, MediaAsset, Project } from '../timeline'
import type { DecisionRecord } from '../project'
import { framesToSeconds } from '../timeline'
import type { MusicAnalysis } from '../automation/cutPlan'
import type { Problem } from './conforms'
import { buildCutMenu, buildSlots, familyMenu, type Menu, type Slot } from './menu'
import { MAX_SEGMENTS, type Brief, type Tone } from './schema'
import { RECIPES, recipeForTone, type Recipe } from './recipes'
import { layout, rhythmGrid, type Grid, type ShotIntent } from './rhythm'
import type { Menu2 } from './schema2'
import { validateSpine2 } from './validate2'
import { baselineSpine2 } from './baseline2'
import { composeAd } from './compose'
import { cohere, type Cohered } from './coherence'
import { capSegments, type Transcript, type Word } from '../transcript'
import { SEGMENT_MAX_MS, SEGMENT_MAX_WORDS } from '../ingest/captions'
import { captionWindowMs } from '../captions/placement'
import { subjectTrackOf } from '../reframe/frameMap'
import { MAX_CANDIDATES } from './menu'
import { GRAPHIC_SPACING, type GraphicCandidate, type GraphicDrop, type GraphicTemplateId, type KeptGraphic } from '../graphics/template'
import { validateBaseline, validateGraphics, type AnswerGraphic } from './validateGraphics'
import { drawnStrings } from '../graphics/apply'
import { GRAPHICS_PASS } from './schemaGraphics'

/**
 * The pure half of a Director run: what the music is, how long the ad is, the
 * menu, and the brief as the model will see it.
 *
 * `store.ts` `direct()` is the runner — it clears the last run, asks, falls
 * back to the standard cut, applies and bakes — and it lives in the renderer,
 * which nothing outside the renderer can import. Everything it decides BEFORE
 * it asks is here instead, so the Director eval (tests/eval/) builds its
 * requests with the app's own code rather than with a copy of it that could
 * drift. Two places computing the same menu is two places to disagree — the
 * lesson apply.ts already states about layout.
 */

/** The brief as the panel holds it: `seconds: null` is "the default", blank fields fill in from the product. */
export interface BriefDraft {
  product: string
  benefit: string
  audience: string
  tone: Tone
  cta: string
  seconds: number | null
  language: string
}

/** The ad's default length when the brief leaves it blank and no recipe says otherwise: this, or the music, whichever is shorter. */
export const DEFAULT_AD_SECONDS = 30
/** The call to action when the brief leaves it blank. */
export const DEFAULT_CTA = 'Shop now'
export const DEFAULT_LANGUAGE = 'English'

export interface MusicChoice {
  clip: Clip
  asset: MediaAsset
  /** How long the music clip is on the timeline — the authority on the window (menu.ts explains). */
  windowMs: number
  /** The part of the FILE the clip plays, for the beat analysis. */
  startMs: number
  endMs: number
}

/**
 * The music the ad is cut to: the first clip on an audio track whose asset has
 * sound. The same rule the reel uses.
 */
export function musicFor(project: Project): MusicChoice | null {
  const fps = project.settings.fps
  const clip = project.clips.find((c) => {
    const track = project.tracks.find((t) => t.id === c.trackId)
    const asset = project.assets.find((a) => a.id === c.assetId)
    return track?.kind === 'audio' && asset?.hasAudio
  })
  if (!clip) return null
  const asset = project.assets.find((a) => a.id === clip.assetId)
  if (!asset) return null
  const startMs = framesToSeconds(clip.inPoint, fps) * 1000
  const windowMs = framesToSeconds(clip.duration, fps) * 1000
  return { clip, asset, windowMs, startMs, endMs: startMs + windowMs }
}

/**
 * How long the ad is: what the brief asked for, else the expected recipe's
 * default — sixty seconds for a wedding teaser, thirty otherwise — or the
 * music, whichever is shorter.
 */
export function adSeconds(
  draft: Pick<BriefDraft, 'seconds'>,
  music: MusicChoice | null,
  recipe?: Pick<Recipe, 'defaultSeconds'> | null
): number {
  const preferred = recipe?.defaultSeconds ?? DEFAULT_AD_SECONDS
  return draft.seconds ?? Math.min(preferred, music ? music.windowMs / 1000 : preferred)
}

/**
 * The recipe an ad is expected to be BEFORE anything is seen: the pinned one,
 * or the tone's from the brief's own words. The length has to be known before
 * the model is asked, so it cannot wait for the model's choice; and the eyes
 * have not run yet, so a calm brief that only its pictures reveal as a wedding
 * keeps the thirty-second default.
 */
export function expectedRecipe(draft: Pick<BriefDraft, 'product' | 'benefit' | 'audience' | 'cta' | 'tone'>, pinned: Recipe | null): Recipe {
  return pinned ?? recipeForTone(draft.tone, { briefText: [draft.product, draft.benefit, draft.audience, draft.cta].join(' '), peopleInSet: false })
}

/** The brief as the model sees it: trimmed, with the blanks filled in. */
export function briefFor(draft: BriefDraft, seconds: number): Brief {
  const product = draft.product.trim()
  return {
    product,
    benefit: draft.benefit.trim() || product,
    audience: draft.audience.trim(),
    tone: draft.tone,
    cta: draft.cta.trim() || DEFAULT_CTA,
    seconds,
    language: draft.language.trim() || DEFAULT_LANGUAGE
  }
}

/** The menu for one run, given the beat analysis (null without music or without the sidecar). */
export function menuFor(
  project: Project,
  slots: Slot[],
  music: MusicChoice | null,
  analysis: MusicAnalysis | null,
  catalogue: { id: string; family: string }[],
  seconds: number
): Menu {
  const fps = project.settings.fps
  return {
    slots,
    cuts: buildCutMenu(analysis, {
      fps,
      seconds,
      offsetFrames: music?.clip.start ?? 0,
      ...(music ? { windowMs: music.windowMs } : {})
    }),
    families: familyMenu(catalogue),
    seconds,
    fps
  }
}

/* ---------------------------------------------------------------- spine@2 */

/**
 * The beats an ad is cut on, for whichever recipe ends up directing it.
 *
 * A function rather than a grid because the recipe is not known until the
 * model has answered, and with no music the grid IS the recipe's tempo.
 */
export function gridsFor(
  project: Project,
  music: MusicChoice | null,
  analysis: MusicAnalysis | null,
  seconds: number
): (recipe: Recipe) => Grid {
  const fps = project.settings.fps
  return (recipe) =>
    rhythmGrid(analysis, {
      fps,
      seconds,
      offsetFrames: music?.clip.start ?? 0,
      ...(music ? { windowMs: music.windowMs } : {}),
      tempo: recipe.tempo
    })
}

/**
 * How many shots the music holds under a recipe, asked of the rhythm engine
 * itself: the most it keeps out of what there is, and the fewest that still
 * fill the ad — fewer than that and it ends early (MAX_STRETCH).
 */
export function holdsFor(recipe: Recipe, grid: Grid, available: number): { min: number; max: number } {
  const stills = (k: number): ShotIntent[] =>
    Array.from({ length: k }, (_, i) => ({
      slotId: `s${i}`, kind: 'image', footageFrames: null, weight: 'normal', face: false, hero: i === Math.floor(k / 2), headline: ''
    }))
  const all = layout(recipe, grid, stills(Math.max(1, Math.min(MAX_SEGMENTS, available))))
  const max = Math.max(1, all.shots.length)
  for (let k = 1; k < max; k++) if (layout(recipe, grid, stills(k)).endFrame >= all.endFrame) return { min: k, max }
  return { min: max, max }
}

/**
 * The `spine@2` menu (docs/PLAN.md §5.2): the gated slots, the recipes on
 * offer — all of them, or the one the user pinned — the tone's recipe for
 * when the model's choice cannot be used, the gate's heroes, and the music
 * as the sentence the prompt gives it.
 */
export function menu2For(
  project: Project,
  gated: { slots: Slot[]; heroCandidates: string[] },
  grids: (recipe: Recipe) => Grid,
  brief: Brief,
  options: { pinned?: Recipe | null } = {}
): Menu2 {
  const fps = project.settings.fps
  const peopleInSet = gated.slots.some((s) => s.look !== undefined && s.look.people !== 'none')
  const fallback =
    options.pinned ?? recipeForTone(brief.tone, { briefText: [brief.product, brief.benefit, brief.audience, brief.cta].join(' '), peopleInSet })
  const grid = grids(fallback)
  const drops = [...grid.structural.entries()]
    .filter(([, s]) => s.reason === 'drop')
    .map(([frame]) => (frame - grid.start) / fps)
    .sort((a, b) => a - b)
  return {
    slots: gated.slots,
    recipes: options.pinned ? [options.pinned] : [...RECIPES],
    fallback,
    heroCandidates: gated.heroCandidates,
    fps,
    seconds: brief.seconds,
    bpm: (60 * fps) / grid.beatFrames,
    holds: holdsFor(fallback, grid, gated.slots.length),
    drops
  }
}

export interface Settled2 {
  /** Validated, timed, and made coherent (coherence.ts). */
  composed: Cohered
  /** The standard cut was built because the model's plan could not be used. */
  baseline: boolean
  /** Why the model's plan could not be used, when it could not. */
  rejected: string | null
  problems: Problem[]
}

/**
 * The model's answer as the ad that lands: validated and timed, or — when it
 * cannot be used — the standard cut, validated and timed the same way. Never
 * nothing. The app's `direct()` and the Director eval both settle an answer
 * here, so what the eval scores is what the user would have got.
 */
export function settle2(
  answer: { value: unknown; truncated: boolean } | { error: string },
  menu: Menu2,
  brief: Brief,
  grids: (recipe: Recipe) => Grid,
  extras: Parameters<typeof composeAd>[4] = {}
): Settled2 {
  const verdict = 'error' in answer ? { rejected: answer.error, problems: [] } : validateSpine2(answer.value, menu, { truncated: answer.truncated })
  const settle = (plan: Parameters<typeof composeAd>[0], recipe: Parameters<typeof composeAd>[1]): Cohered => {
    const grid = grids(recipe)
    return cohere(composeAd(plan, recipe, menu, grid, extras), grid, brief, menu)
  }
  if (!('rejected' in verdict)) {
    const composed = settle(verdict.plan, verdict.recipe)
    return { composed, baseline: false, rejected: null, problems: [...verdict.problems, ...composed.problems] }
  }
  // The pinned recipe, when there is one, is the menu's fallback — so the standard cut honours it too.
  const standard = validateSpine2(baselineSpine2(brief, menu), menu)
  if ('rejected' in standard) throw new Error(`Even the standard cut could not be laid out: ${standard.rejected}`)
  const composed = settle(standard.plan, standard.recipe)
  return { composed, baseline: true, rejected: verdict.rejected, problems: [...verdict.problems, ...standard.problems, ...composed.problems] }
}

/**
 * What the graphics pass is offered for one footage clip (docs/CLIPS.md §6.6):
 * its transcript's asset and the clip, the language line's language, the
 * capped sentences the clip shows (`capSegments` at 30 words or 15 s, §7.2),
 * the templates offered, and where the words came from (§6.6's proposals).
 * Built by `graphicsMenuFor` (lane T2b's).
 */
export interface GraphicsMenu {
  assetId: string
  clipId: string
  language: string
  sentences: { id: string; startMs: number; text: string; wordStart: number; wordEnd: number }[]
  templates: GraphicTemplateId[]
  wordSource: 'whisper' | 'youtube-asr' | 'youtube-lines'
}

/** The templates every graphics menu offers (§6.6), in `GRAPHIC_TEMPLATES`' order; `callout` goes after `quote` when offered. */
export const GRAPHIC_TEMPLATES_ALWAYS: readonly GraphicTemplateId[] = Object.freeze(['counter', 'bars', 'steps', 'quote', 'ring', 'keyword'])

/**
 * Where a transcript's words came from, as §6.6's proposals read it
 * (`proposalOf` in validateGraphics.ts). `approximate` decides only inside a
 * YouTube transcript (§6.6's YouTube bullet): a Whisper transcript is
 * 'whisper', approximate or not.
 */
export function wordSourceOf(transcript: Pick<Transcript, 'model' | 'approximate'>): GraphicsMenu['wordSource'] {
  if (!transcript.model.startsWith('youtube-')) return 'whisper'
  return transcript.model === 'youtube-lines' || transcript.approximate === true ? 'youtube-lines' : 'youtube-asr'
}

/**
 * The graphics pass's menus for one footage clip (docs/CLIPS.md §6.6).
 *
 * - **Sentences**: the transcript's segments capped by `capSegments` at 30
 *   words or 15 s (§7.2), the same capped segments `stretchFor` reads, so a
 *   sentence id here ('s07', 's07.2') is the one the validator finds. Each is
 *   held to the words the clip SHOWS, the caption window
 *   (`captionWindowMs`, `firstShownWord`'s test: `endMs` after the window's
 *   start and `startMs` before its end) that `graphicBeats` reads: a sentence
 *   the clip shows none of is left out; one it shows part of keeps its id and
 *   lists only the shown words, `startMs` its first shown word's.
 * - **Windows**: at most `MAX_CANDIDATES` (24) sentences a menu; a longer
 *   clip is cut into 24-sentence windows, one menu (one call) each.
 * - **Templates**: `GRAPHIC_TEMPLATES_ALWAYS`, and `callout` only when the
 *   clip's asset has a subject track (`subjectTrackOf`). Never `lower-third`,
 *   `screen-card` or a later step's id.
 * - **wordSource**: `wordSourceOf` the transcript.
 *
 * No menu (an empty list) when the clip shows no speech, or the transcript is
 * another file's. Pure.
 */
export function graphicsMenuFor(project: Project, clip: Clip, transcript: Transcript): GraphicsMenu[] {
  if (transcript.assetId !== clip.assetId) return []
  const window = captionWindowMs(clip, project.settings.fps)
  const shown = (w: { startMs: number; endMs: number }): boolean => w.endMs > window.startMs && w.startMs < window.endMs
  const byIndex = new Map(transcript.words.map((w) => [w.index, w]))
  const sentences: GraphicsMenu['sentences'] = []
  for (const s of capSegments(transcript, SEGMENT_MAX_WORDS, SEGMENT_MAX_MS)) {
    const words: Word[] = []
    for (let i = s.wordStart; i <= s.wordEnd; i += 1) {
      const w = byIndex.get(i)
      if (w) words.push(w)
    }
    const seen = words.filter(shown)
    if (seen.length === 0) continue
    if (seen.length === words.length && byIndex.has(s.wordStart) && byIndex.has(s.wordEnd)) {
      sentences.push({ id: s.id, startMs: s.startMs, text: s.text, wordStart: s.wordStart, wordEnd: s.wordEnd })
    } else {
      const text = seen.map((w) => w.text).join(' ').replace(/\s+/gu, ' ').trim()
      sentences.push({ id: s.id, startMs: seen[0].startMs, text, wordStart: seen[0].index, wordEnd: seen[seen.length - 1].index })
    }
  }
  if (sentences.length === 0) return []
  const asset = project.assets.find((a) => a.id === clip.assetId)
  const callout = asset !== undefined && subjectTrackOf(project, clip, asset) !== null
  const templates: GraphicTemplateId[] = callout
    ? [...GRAPHIC_TEMPLATES_ALWAYS.slice(0, 4), 'callout', ...GRAPHIC_TEMPLATES_ALWAYS.slice(4)]
    : [...GRAPHIC_TEMPLATES_ALWAYS]
  const wordSource = wordSourceOf(transcript)
  const menus: GraphicsMenu[] = []
  for (let i = 0; i < sentences.length; i += MAX_CANDIDATES) {
    menus.push({
      assetId: transcript.assetId,
      clipId: clip.id,
      language: transcript.language,
      sentences: sentences.slice(i, i + MAX_CANDIDATES),
      templates: [...templates],
      wordSource
    })
  }
  return menus
}

/** One graphics answer, settled (docs/CLIPS.md §6.6, §6.7): `settle2`'s twin. One per menu (one window). */
export interface SettledGraphics {
  /** Validated and spaced (§6.7 rules 1-10), in onset order. */
  kept: GraphicCandidate[]
  /** Every note: each graphic dropped with its reason, each repair, each spacing drop, a rejection's. */
  dropped: Problem[]
  /**
   * The model's answer was not used (no model, or the pass rejected), so the
   * baseline path ran: `options.baseline`'s candidates, validated, or none
   * while there is no baseline (lane T4's).
   */
  baseline: boolean
  /** Why the model's answer could not be used, when it could not. */
  rejected: string | null
  /**
   * Beyond §6.6's words: each graphic dropped (by the validator or the
   * spacing; never a repair, never the rejection itself), structured: the
   * menu's clip, the template, the first string it would draw, the reason.
   */
  drops: GraphicDrop[]
}

/**
 * The baseline's candidates for a menu (§6.10, `baselineGraphics(transcript,
 * menu)`, lane T4's). Until T4 lands, `settleGraphics` takes none: a rejected
 * answer settles to no graphics, with the reason.
 */
export type GraphicsBaseline = (transcript: Transcript, menu: GraphicsMenu) => GraphicCandidate[]

/** The "graphic dropped: " head the validator's and the spacing's messages carry, taken off a structured drop's reason. */
const DROPPED_HEAD = 'graphic dropped: '

/**
 * Rule 10 within one answer (§6.7): onsets at least `GRAPHIC_SPACING.minGapS`
 * apart, and at most max(1, ⌊clip seconds ÷ `GRAPHIC_SPACING.perS`⌋)
 * graphics, the earlier winning. A graphic's onset is its first beat word's
 * start (the lead before it is the same for every graphic); the clip's seconds
 * are those its menu's sentences span. A menu window (24 sentences, §6.6) is
 * spaced alone; `applyBudget` spaces across the project (§6.9).
 */
function spaceGraphics(
  kept: readonly GraphicCandidate[],
  menu: GraphicsMenu,
  transcript: Transcript
): { kept: GraphicCandidate[]; dropped: Problem[]; drops: GraphicDrop[] } {
  const byIndex = new Map(transcript.words.map((w) => [w.index, w]))
  const onsetMs = (c: GraphicCandidate): number => {
    const words = c.beatWords.length > 0 ? c.beatWords : c.bound
    const starts = words.map((i) => byIndex.get(i)?.startMs).filter((v): v is number => v !== undefined)
    return starts.length > 0 ? Math.min(...starts) : Infinity
  }
  const first = menu.sentences.length > 0 ? byIndex.get(Math.min(...menu.sentences.map((s) => s.wordStart))) : undefined
  const last = menu.sentences.length > 0 ? byIndex.get(Math.max(...menu.sentences.map((s) => s.wordEnd))) : undefined
  const clipS = first && last ? Math.max(0, last.endMs - first.startMs) / 1000 : 0
  const cap = Math.max(1, Math.floor(clipS / GRAPHIC_SPACING.perS))
  const ordered = kept.map((c, i) => ({ c, i, at: onsetMs(c) })).sort((a, b) => a.at - b.at || a.i - b.i)
  const out: GraphicCandidate[] = []
  const dropped: Problem[] = []
  const drops: GraphicDrop[] = []
  let previous = -Infinity
  const drop = (c: GraphicCandidate, reason: string): void => {
    dropped.push({ path: '$.graphics', message: `${DROPPED_HEAD}${reason}` })
    drops.push({ clipId: menu.clipId, template: c.data.template, text: firstDrawn(drawnStrings(c.data)), reason })
  }
  for (const { c, at } of ordered) {
    const name = `the ${c.data.template} on ${c.sentence}`
    if (out.length >= cap) {
      drop(c, `${name} — at most one graphic per ${GRAPHIC_SPACING.perS} s of clip, the earlier ones stay`)
    } else if (at - previous < GRAPHIC_SPACING.minGapS * 1000) {
      drop(c, `${name} is within ${GRAPHIC_SPACING.minGapS} s of the one before — the earlier one stays`)
    } else {
      out.push(c)
      previous = at
    }
  }
  return { kept: out, dropped, drops }
}

function firstDrawn(strings: readonly string[]): string {
  return strings.find((t) => t.trim() !== '') ?? ''
}

/** The strings an answer graphic would draw, in `drawnStrings`' order for its template; every field for one no template holds. */
function answerDrawn(g: AnswerGraphic): string[] {
  const items = g.items ?? []
  switch (g.template) {
    case 'counter':
    case 'ring':
      return [g.value, g.label]
    case 'bars':
      return [g.title, ...items.flatMap((i) => [i.label, i.value])]
    case 'steps':
      return [g.title, ...items.map((i) => i.label)]
    case 'quote':
      return [g.quote]
    case 'callout':
      return [g.label]
    case 'keyword':
      return [g.words]
    default:
      return [g.title, g.value, g.label, g.quote, g.words]
  }
}

/**
 * The validator's drops, structured: its problem paths are rooted at the
 * graphic's place in what was validated ('$.graphics[2].items[0].value',
 * '$.baseline[1].value'), so the index is read off the path, never the
 * message; a graphic dropped for several fields is one drop, its reasons
 * joined by '; '. Repairs ("graphic repaired: …") are not drops.
 */
function dropsOf(
  problems: readonly Problem[],
  root: '$.graphics' | '$.baseline',
  drawn: (i: number) => { template: string; strings: string[] } | undefined,
  clipId: string
): GraphicDrop[] {
  const at = new Map<number, string[]>()
  const pattern = root === '$.graphics' ? /^\$\.graphics\[(\d+)\]/u : /^\$\.baseline\[(\d+)\]/u
  for (const p of problems) {
    const m = pattern.exec(p.path)
    if (!m || !p.message.startsWith(DROPPED_HEAD)) continue
    const i = Number(m[1])
    at.set(i, [...(at.get(i) ?? []), p.message.slice(DROPPED_HEAD.length)])
  }
  return [...at.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([i, reasons]) => {
      const d = drawn(i)
      return d ? [{ clipId, template: d.template, text: firstDrawn(d.strings), reason: reasons.join('; ') }] : []
    })
}

/** How a note names one menu window: its first and last sentence ids. */
export function graphicsWindowName(menu: Pick<GraphicsMenu, 'sentences'>): string {
  const ids = menu.sentences.map((s) => s.id)
  if (ids.length === 0) return 'no sentences'
  return ids.length === 1 ? `sentence ${ids[0]}` : `sentences ${ids[0]} to ${ids[ids.length - 1]}`
}

/**
 * The name the app sets as a said quote's speaker for an asset (§6.6
 * "Speaker", §16.31): its Speaker (`MediaAsset.speaker`) when it holds more
 * than spaces, else a link's channel (`credit.author`), else ''. For the
 * quote only: a lower third reads `MediaAsset.speaker` alone
 * (`lowerThirdFor`), so it is never made from a channel without your press.
 */
export function quoteSpeakerFor(asset: Pick<MediaAsset, 'speaker' | 'credit'> | undefined): string {
  if (!asset) return ''
  if (asset.speaker !== undefined && asset.speaker.trim() !== '') return asset.speaker
  return asset.credit?.author ?? ''
}

/**
 * A graphics answer as what the app would place (docs/CLIPS.md §6.6, §6.7):
 * validated one graphic at a time and spaced (rule 10), or, when the answer is
 * rejected (cut off, the wrong shape, or no answer at all), the baseline's
 * candidates validated the same way, with the reason. Never throws. The app and
 * the eval both settle here, so what the eval scores is what the user gets.
 *
 * One call per menu, so one window's answer: a window cut off or the wrong
 * shape rejects that window's pass only, and its note names the window
 * (`graphicsWindowName`); the clip's other windows settle on their own, and
 * `pairSettled` joins them. Repairs (§6.7) are notes in `dropped`: a `lit`
 * out of range, a title, a steps tree, a field another template holds. A
 * graphic on a sentence not on the menu, or a template not offered, is
 * dropped with a note and never rejects the pass (the shape check is
 * `constrained: false`).
 *
 * `options.baseline` is the seam for §6.10's `baselineGraphics` (lane T4).
 * Without it a rejected pass settles to no graphics, and the note says so
 * ("no graphics for <window>: <why>"); with it, "the baseline's graphics are
 * used for <window>: <why>". `options.speaker` is the app's speaker for a
 * said quote (`quoteSpeakerFor`).
 */
export function settleGraphics(
  answer: { value: unknown; truncated: boolean } | { error: string },
  menu: GraphicsMenu,
  transcript: Transcript,
  options: { baseline?: GraphicsBaseline; speaker?: string } = {}
): SettledGraphics {
  const speaker = options.speaker ?? ''
  const verdict =
    'error' in answer ? { rejected: answer.error } : validateGraphics(answer.value, menu, transcript, { truncated: answer.truncated, speaker })
  if (!('rejected' in verdict)) {
    const graphics = (answer as { value: { graphics: AnswerGraphic[] } }).value.graphics
    const spaced = spaceGraphics(verdict.kept, menu, transcript)
    const drops = dropsOf(verdict.dropped, '$.graphics', (i) => (graphics[i] ? { template: graphics[i].template, strings: answerDrawn(graphics[i]) } : undefined), menu.clipId)
    return { kept: spaced.kept, dropped: [...verdict.dropped, ...spaced.dropped], baseline: false, rejected: null, drops: [...drops, ...spaced.drops] }
  }
  const window = graphicsWindowName(menu)
  const candidates = options.baseline ? options.baseline(transcript, menu) : []
  const standard = validateBaseline(candidates, menu, transcript, { speaker })
  const spaced = spaceGraphics(standard.kept, menu, transcript)
  const head = options.baseline ? `the baseline's graphics are used for ${window}` : `no graphics for ${window}`
  const drops = dropsOf(standard.dropped, '$.baseline', (i) => (candidates[i] ? { template: candidates[i].data.template, strings: drawnStrings(candidates[i].data) } : undefined), menu.clipId)
  return {
    kept: spaced.kept,
    dropped: [{ path: '$', message: `${head}: ${verdict.rejected}` }, ...standard.dropped, ...spaced.dropped],
    baseline: true,
    rejected: verdict.rejected,
    drops: [...drops, ...spaced.drops]
  }
}

/**
 * A run's settled windows, joined (beyond §6.6's words; the store's Find and
 * Direct and lane T4's eval join them here, so they cannot pair differently):
 *
 * - `kept`: each kept candidate paired with the `clipId` and `assetId` of the
 *   menu its answer came from (§6.6: "the caller pairs each kept candidate
 *   with the clipId and assetId of the GraphicsMenu its answer came from"), as
 *   `applyGraphics` takes them, in the parts' order. A rejected window adds
 *   only its baseline's; it takes nothing from the other windows.
 * - `settled`: one `SettledGraphics` for the run's one decision record
 *   (`decisionForGraphics`): every part's kept, notes and drops in order;
 *   `baseline` true only when EVERY window's model answer went unused (so the
 *   record names no model only when none answered); `rejected` each window's
 *   reason joined by '; ', null when none was.
 */
export function pairSettled(parts: readonly { menu: GraphicsMenu; settled: SettledGraphics }[]): {
  kept: KeptGraphic[]
  settled: SettledGraphics
} {
  const kept = parts.flatMap(({ menu, settled }) => settled.kept.map((candidate) => ({ clipId: menu.clipId, assetId: menu.assetId, candidate })))
  const reasons = parts.flatMap(({ settled }) => (settled.rejected === null ? [] : [settled.rejected]))
  return {
    kept,
    settled: {
      kept: parts.flatMap(({ settled }) => settled.kept),
      dropped: parts.flatMap(({ settled }) => settled.dropped),
      baseline: parts.length > 0 && parts.every(({ settled }) => settled.baseline),
      rejected: reasons.length > 0 ? reasons.join('; ') : null,
      drops: parts.flatMap(({ settled }) => settled.drops)
    }
  }
}

const defaultId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/**
 * The graphics pass's decision record (docs/CLIPS.md §6.6, "The decision
 * record"), `decisionFor2`'s twin: `id` from `options.id` or a default made as
 * apply2.ts's `defaultId` makes one; `pass` `GRAPHICS_PASS`; one op, `{
 * graphics, dropped, baseline }` (the settled kept, its notes, and whether the
 * baseline path ran), plus, beyond the plan's words, `drops`, the structured
 * drops; `model` the answering model's `{ id, runtime }`, or `{ id:
 * 'baseline', runtime: 'none' }` when no model answered (`model` null, or
 * `settled.baseline`); `createdAt` from `options.now`. Only `id` and
 * `runtime` are read from `model`, so nothing else a caller's object holds (a
 * key, a header, an address) can reach the record or the project file.
 */
export function decisionForGraphics(
  settled: SettledGraphics,
  model: { id: string; runtime: string } | null,
  options: { id?: string; now?: Date } = {}
): DecisionRecord {
  const answered = model !== null && !settled.baseline
  return {
    id: options.id ?? defaultId('decision'),
    pass: GRAPHICS_PASS,
    ops: [{ graphics: settled.kept, dropped: settled.dropped, baseline: settled.baseline, drops: settled.drops }],
    model: answered ? { id: model.id, runtime: model.runtime } : { id: 'baseline', runtime: 'none' },
    createdAt: (options.now ?? new Date()).toISOString()
  }
}

export { buildSlots }
