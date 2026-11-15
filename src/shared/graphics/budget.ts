/**
 * The graphics budget (docs/CLIPS.md §6.9, "The budget"): which of a run's
 * timed graphics the project has room for. Four rules, weighed by rank and
 * then time (`roomRank`: a keyword yields to any other template, and inside a
 * rank the earlier wins; try-out 1, 2026-11-15, changing D12's "the earlier
 * one wins"): the spacing (D12, §16.65), one on screen, none over a zoom
 * punch, and the per-minute cap (null until M17). The screen card (§6.16) is
 * outside all four. This is the one place room is decided: `settleGraphics`
 * no longer spaces a window, so nothing loses room to a graphic the budget
 * itself refuses. (One the budget keeps and placement or the lane then drops
 * still held its room, as §6.6's landing order has it.)
 *
 * It runs in `applyGraphics`' landing order after the beats and the seconds
 * and before placement (§6.6), so a candidate is a graphic with its timeline
 * span and onset but no third yet; Keep (lane T2b) runs it again for one
 * proposal, with the same reasons.
 *
 * Pure and node-runnable: no clock, no DOM, no `node:path`.
 */

import { COPY_RULE, ENDING_RULE, GRAPHIC_RULE } from '../director/apply'
import { normaliseKeys } from '../render/keyframes'
import { clipEnd, framesToSeconds, projectDuration, type Clip, type Project } from '../timeline'
import { NO_CLIP_NOTE } from './place'
import { GRAPHIC_SPACING, roomRank, type GraphicSpec, type GraphicTemplateId } from './template'

/**
 * Rule 4's cap: no 60 s window of the timeline holds more graphics than this
 * (§6.9). Null until M17 gives it a value (§6.15); `applyBudget`'s
 * `options.perMinute` overrides it, for the test.
 */
export const GRAPHICS_PER_MINUTE: number | null = null

/** Rule 4's window, in seconds. */
export const PER_MINUTE_WINDOW_S = 60

/** Rule 2's drop, §6.9's words; Keep shows the same text (§6.6). */
export const ON_SCREEN_REASON = 'another graphic is on screen then'

/**
 * Rule 3's drop, §6.9's words: "over a zoom punch at 12.4 s", the punch's
 * first frame on screen in timeline seconds (a zoom move's first frame inside
 * its footage clip, never before it), to 0.1 s (nearest).
 */
export function zoomPunchReason(seconds: number): string {
  return `over a zoom punch at ${seconds.toFixed(1)} s`
}

/** How a reason names a template: its id with the dash read as a space ("lower third"). */
function templateName(template: string): string {
  return template.replace(/-/gu, ' ')
}

/**
 * Rule 1's gap drop (not §6.9's words; the plan is silent): it names the
 * graphic the candidate lost to, its template and onset in timeline seconds
 * (to 0.1 s), and why that one holds: it is on the timeline already, it
 * outranks a keyword (`roomRank`), or it is the earlier of one rank. As
 * `applyGraphics` shows it: "graphic dropped: the keyword "money" — within
 * 6 s of the counter at 21.3 s; a keyword yields to any other graphic".
 */
export function tooCloseReason(other: { template: string; onset: number; placed: boolean }, why: 'placed' | 'outranked' | 'earlier'): string {
  const head = `within ${GRAPHIC_SPACING.minGapS} s of the ${templateName(other.template)} at ${other.onset.toFixed(1)} s`
  if (why === 'placed') return `${head}, which is on the timeline already`
  if (why === 'outranked') return `${head}; a keyword yields to any other graphic`
  return `${head}, the earlier one stays`
}

/**
 * Rule 1's count drop (not §6.9's words; the plan is silent): per footage clip
 * for Clip it and the tile, per ad for Direct. The places go to the graphics
 * on the timeline already, then to every other template in onset order, then
 * to keywords in onset order (`roomRank`). `filledBy` says what holds the
 * places in its span, so the reason names only what is there: graphics on the
 * timeline already (`placed`), graphics of a higher rank kept in this run
 * (`outranking`, which only a keyword can lose to) and earlier ones of its own
 * rank kept in this run (`earlier`). Left out, all three, the full text.
 */
export function perClipReason(
  scope: 'clip' | 'ad',
  template: string,
  filledBy: { placed: boolean; outranking: boolean; earlier: boolean } = { placed: true, outranking: true, earlier: true }
): string {
  const head = `at most one graphic per ${GRAPHIC_SPACING.perS} s of ${scope === 'ad' ? 'the ad' : 'clip'}`
  const keyword = roomRank(template) === 1
  const stay = [
    ...(filledBy.placed ? ['the ones on the timeline already'] : []),
    ...(filledBy.earlier ? [keyword ? 'the earlier keywords' : 'the earlier ones'] : [])
  ]
  const stays = stay.length > 0 ? `${stay.join(' and ')} stay` : ''
  if (keyword && filledBy.outranking) return `${head}; a keyword yields to any other graphic${stays ? `, and ${stays}` : ''}`
  return stays ? `${head}, ${stays}` : head
}

/** Rule 4's drop (not §6.9's words; the plan is silent). */
export function perMinuteReason(cap: number): string {
  return `more than ${cap} graphic${cap === 1 ? '' : 's'} in a minute`
}

/**
 * One graphic `applyBudget` weighs: what `applyGraphics` holds after the beats
 * and the seconds (§6.6's landing order), and what Keep holds for a proposal.
 * `spec` is the caller's own (its third is not chosen yet, so only `data` and
 * `beats` are read) and comes back unchanged in `dropped`.
 */
export interface BudgetCandidate {
  /** The footage clip it shows over: its zoom keys (rule 3) and, for Clip it, its seconds (rule 1). */
  clipId: string
  /** The run's rule: `GRAPHIC_RULE` is Direct's, spaced over the whole ad; any other is spaced over its footage clip. */
  rule: string
  /** The graphic clip's first timeline frame (`graphicTiming`'s `start`). */
  start: number
  /** Its length in frames (`graphicTiming`'s `duration`). */
  duration: number
  /** `beats` are seconds from `start` (`GraphicSpec.beats`). */
  spec: Pick<GraphicSpec, 'data' | 'beats'>
}

/**
 * A graphic's onset in timeline seconds: its first beat (`start`'s time plus
 * the least of `beats`), or `start`'s time when it has none (a graphic added
 * by hand). `settleGraphics` orders a window's graphics by the same onset, its
 * first beat word's start (`director/run.ts`); `graphicBeats` carries that
 * start to the timeline and `spreadBeats` moves only later beats, so the two
 * agree.
 */
export function onsetSeconds(start: number, beats: readonly number[], fps: number): number {
  const finite = beats.filter((b) => Number.isFinite(b))
  return framesToSeconds(start, fps) + (finite.length > 0 ? Math.min(...finite) : 0)
}

/** A graphic that holds its place: one already on the timeline (`placed`), or a candidate kept before. */
interface Held {
  onset: number
  from: number
  to: number
  template: GraphicTemplateId
  placed: boolean
}

/** 1e-6 s: onsets are sums of a frame's seconds and a beat, so 6 s apart may come out 5.9999999999. */
const EPS = 1e-6

/**
 * The budget (docs/CLIPS.md §6.9): every graphic already on the timeline
 * (any rule) is held first, as placed; then `candidates`, by `roomRank` and
 * then onset (every template but a keyword in onset order, then the keywords
 * in onset order; equal onsets in the order given), each kept only when every
 * rule holds against everything held so far. So a keyword yields to any other
 * graphic, and inside a rank the earlier wins (try-out 1, 2026-11-15; D12
 * said "the earlier one wins" for all):
 *
 * 1. **Spacing** (D12): its onset at least `GRAPHIC_SPACING.minGapS` from
 *    every held graphic's onset, a lower third's included; and, unless it is
 *    a lower third, fewer than max(1, ⌊seconds ÷ `GRAPHIC_SPACING.perS`⌋)
 *    held graphics that are not lower thirds with an onset over "its clip":
 *    the footage clip's span (Clip it and the tile), or the whole ad,
 *    `projectDuration`, for Direct (`GRAPHIC_RULE`).
 * 2. **One on screen**: its frames overlap no held graphic's, nor a Director
 *    card's (`COPY_RULE`, `ENDING_RULE`).
 * 3. **No zoom punch**: its frames overlap neither a clip whose
 *    `moment.kind` is `'zoom-punch'` nor, on its footage clip, the frames
 *    between two adjacent `zoom` keys of different value (keys are frames
 *    from the clip's start, read as the renderer reads them, `normaliseKeys`),
 *    cut to the frames the footage clip is on the timeline. A held zoom is not
 *    a punch: two keys of one value, or the segment after a key whose ease is
 *    `'hold'`, which keeps its value to the next key and jumps ON that key's
 *    frame (render/keyframes.ts `eased` and the ffmpeg expression), so the
 *    punch there is that one frame.
 * 4. **Per minute**: when the cap (`options.perMinute`, else
 *    `GRAPHICS_PER_MINUTE`) is not null, no 60 s window [w, w + 60) that
 *    holds its onset holds more than the cap of onsets.
 *
 * A candidate whose footage clip is gone is dropped with `NO_CLIP_NOTE`,
 * a screen card's included. A `'screen-card'` is otherwise outside the
 * budget (§6.9, §6.16): kept with no rule read, and neither held for the
 * others nor counted. `kept` is in onset
 * order (equal onsets in the order given), whatever order they were weighed
 * in; `dropped` carries each spec as given with its reason, in onset order
 * too (equal onsets in the order given). A graphic
 * already on the timeline always holds, even where a candidate's onset is
 * earlier: it is placed.
 */
export function applyBudget<C extends BudgetCandidate>(
  project: Project,
  candidates: readonly C[],
  options: { perMinute?: number | null; room?: boolean } = {}
): { kept: C[]; dropped: { spec: C['spec']; reason: string }[] } {
  const fps = project.settings.fps
  const cap = options.perMinute === undefined ? GRAPHICS_PER_MINUTE : options.perMinute
  /*
   * `room: false` (the tile's Add on a dropped graphic, try-out 1,
   * 2026-11-15): the rules of taste are not read, rule 1's gap and count and
   * rule 4's per-minute cap, for the owner's click decides room. What cannot
   * be drawn rightly still refuses: rule 2 (one on screen, a card) and rule
   * 3 (a zoom punch), and a footage clip that is gone.
   */
  const room = options.room !== false
  const held: Held[] = []
  for (const c of project.clips) {
    const spec = c.graphic
    if (!spec || spec.data.template === 'screen-card') continue
    held.push({ onset: onsetSeconds(c.start, spec.beats, fps), from: c.start, to: clipEnd(c), template: spec.data.template, placed: true })
  }
  const cards = project.clips.filter((c) => c.generatedBy?.rule === COPY_RULE || c.generatedBy?.rule === ENDING_RULE)
  const punches = project.clips.filter((c) => c.moment?.kind === 'zoom-punch')

  // Weighed by rank, then onset: a keyword yields to any other template (roomRank).
  const ordered = candidates
    .map((c, i) => ({ c, i, onset: onsetSeconds(c.start, c.spec.beats, fps), rank: roomRank(c.spec.data.template) }))
    .sort((a, b) => a.rank - b.rank || a.onset - b.onset || a.i - b.i)
  const kept: { c: C; i: number; onset: number }[] = []
  const dropped: { spec: C['spec']; reason: string; i: number; onset: number }[] = []
  for (const { c, i, onset } of ordered) {
    const template = c.spec.data.template
    if (!project.clips.some((x) => x.id === c.clipId)) {
      dropped.push({ spec: c.spec, reason: NO_CLIP_NOTE, i, onset })
      continue
    }
    if (template === 'screen-card') {
      kept.push({ c, i, onset })
      continue
    }
    const reason = refusal(project, c, onset, held, cards, punches, cap, room)
    if (reason !== null) {
      dropped.push({ spec: c.spec, reason, i, onset })
      continue
    }
    kept.push({ c, i, onset })
    held.push({ onset, from: c.start, to: c.start + c.duration, template, placed: false })
  }
  // Out in onset order, as placement and the seeds expect, whatever the rank weighed first; the drops too, so the dock reads in time order.
  kept.sort((a, b) => a.onset - b.onset || a.i - b.i)
  dropped.sort((a, b) => a.onset - b.onset || a.i - b.i)
  return { kept: kept.map((k) => k.c), dropped: dropped.map(({ spec, reason }) => ({ spec, reason })) }
}

/** The first rule a candidate breaks, as its reason; null when it is kept. */
function refusal(
  project: Project,
  c: BudgetCandidate,
  onset: number,
  held: readonly Held[],
  cards: readonly Clip[],
  punches: readonly Clip[],
  cap: number | null,
  room = true
): string | null {
  const fps = project.settings.fps
  const footage = project.clips.find((x) => x.id === c.clipId)
  if (!footage) return NO_CLIP_NOTE // applyBudget has dropped it already; kept for the type
  const from = c.start
  const to = c.start + c.duration
  const overlaps = (a: number, b: number): boolean => from < b && a < to

  // Rule 1, the gap: every held graphic, a lower third's included; the reason names the nearest.
  const near = held
    .filter((h) => Math.abs(onset - h.onset) < GRAPHIC_SPACING.minGapS - EPS)
    .sort((a, b) => Math.abs(onset - a.onset) - Math.abs(onset - b.onset))[0]
  if (room && near) {
    const template = c.spec.data.template
    const why = near.placed ? 'placed' : roomRank(near.template) < roomRank(template) ? 'outranked' : 'earlier'
    return tooCloseReason(near, why)
  }

  // Rule 2: one piece of designed type at a time.
  if (held.some((h) => overlaps(h.from, h.to)) || cards.some((k) => overlaps(k.start, clipEnd(k)))) return ON_SCREEN_REASON

  // Rule 3: the earliest punch under its frames, a moment's or a zoom move's on the footage beneath.
  const under: number[] = punches.filter((p) => overlaps(p.start, clipEnd(p))).map((p) => p.start)
  const keys = normaliseKeys(footage.keyframes?.zoom ?? [], footage.duration)
  for (let i = 0; i + 1 < keys.length; i++) {
    if (keys[i].value === keys[i + 1].value) continue
    // A hold steps on the next key's frame: the punch is that one frame.
    const a = footage.start + (keys[i].ease === 'hold' ? keys[i + 1].frame : keys[i].frame)
    const b = footage.start + keys[i + 1].frame + (keys[i].ease === 'hold' ? 1 : 0)
    // Only the frames the footage clip is on screen: a head trim rebases keys before its start (timeline.ts rebaseAnimation).
    const lo = Math.max(a, footage.start)
    const hi = Math.min(b, clipEnd(footage))
    if (lo < hi && overlaps(lo, hi)) under.push(lo)
  }
  if (under.length > 0) return zoomPunchReason(framesToSeconds(Math.min(...under), fps))

  // Rule 1, the count: the lower third is outside it (§6.9, a reading of D12 recorded 2026-10-21).
  if (room && c.spec.data.template !== 'lower-third') {
    const scope = c.rule === GRAPHIC_RULE ? 'ad' : 'clip'
    const span = scope === 'ad' ? { from: 0, to: projectDuration(project) } : { from: footage.start, to: clipEnd(footage) }
    const seconds = framesToSeconds(span.to - span.from, fps)
    // Rounded DOWN, as ⌊clip seconds ÷ 20⌋ says; the 1e-9 keeps 40 s from reading as 39.999….
    const most = Math.max(1, Math.floor(seconds / GRAPHIC_SPACING.perS + 1e-9))
    const lo = framesToSeconds(span.from, fps) - EPS
    const hi = framesToSeconds(span.to, fps) - EPS
    const over = held.filter((h) => h.template !== 'lower-third' && h.onset >= lo && h.onset < hi)
    if (over.length >= most) {
      const rank = roomRank(c.spec.data.template)
      return perClipReason(scope, c.spec.data.template, {
        placed: over.some((h) => h.placed),
        outranking: over.some((h) => !h.placed && roomRank(h.template) < rank),
        earlier: over.some((h) => !h.placed && roomRank(h.template) === rank)
      })
    }
  }

  // Rule 4, when M17 has set the cap: every 60 s window that holds this onset.
  if (room && cap !== null) {
    const onsets = [...held.map((h) => h.onset), onset]
    for (const w of onsets) {
      if (w > onset + EPS || w <= onset - PER_MINUTE_WINDOW_S + EPS) continue
      const inside = onsets.filter((t) => t >= w - EPS && t < w + PER_MINUTE_WINDOW_S - EPS).length
      if (inside > cap) return perMinuteReason(cap)
    }
  }
  return null
}
