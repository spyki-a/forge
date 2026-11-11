/**
 * The graphics budget (docs/CLIPS.md §6.9, "The budget"): which of a run's
 * timed graphics the project has room for. Four rules, the earlier graphic
 * winning: the spacing (D12, §16.65), one on screen, none over a zoom punch,
 * and the per-minute cap (null until M17). The screen card (§6.16) is outside
 * all four.
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
import { GRAPHIC_SPACING, type GraphicSpec, type GraphicTemplateId } from './template'

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

/** Rule 1's gap drop (not §6.9's words; the plan is silent). */
export const TOO_CLOSE_REASON = `within ${GRAPHIC_SPACING.minGapS} s of another graphic, the earlier one stays`

/** Rule 1's count drop (not §6.9's words; the plan is silent): per footage clip for Clip it and the tile, per ad for Direct. */
export function perClipReason(scope: 'clip' | 'ad'): string {
  return `at most one graphic per ${GRAPHIC_SPACING.perS} s of ${scope === 'ad' ? 'the ad' : 'clip'}, the earlier ones stay`
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
 * by hand). The validator's spacing (`director/run.ts` `spaceGraphics`) takes
 * a graphic's onset as its first beat word's start; `graphicBeats` carries
 * that start to the timeline and `spreadBeats` moves only later beats, so the
 * two agree.
 */
export function onsetSeconds(start: number, beats: readonly number[], fps: number): number {
  const finite = beats.filter((b) => Number.isFinite(b))
  return framesToSeconds(start, fps) + (finite.length > 0 ? Math.min(...finite) : 0)
}

/** A graphic that holds its place: one already on the timeline, or a candidate kept before. */
interface Held {
  onset: number
  from: number
  to: number
  template: GraphicTemplateId
}

/** 1e-6 s: onsets are sums of a frame's seconds and a beat, so 6 s apart may come out 5.9999999999. */
const EPS = 1e-6

/**
 * The budget (docs/CLIPS.md §6.9): every graphic already on the timeline
 * (any rule) is held first, as placed; then `candidates`, in onset order
 * (equal onsets in the order given), each kept only when every rule holds
 * against everything held so far, so the earlier wins:
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
 * order; `dropped` carries each spec as given with its reason. A graphic
 * already on the timeline always holds, even where a candidate's onset is
 * earlier: it is placed.
 */
export function applyBudget<C extends BudgetCandidate>(
  project: Project,
  candidates: readonly C[],
  options: { perMinute?: number | null } = {}
): { kept: C[]; dropped: { spec: C['spec']; reason: string }[] } {
  const fps = project.settings.fps
  const cap = options.perMinute === undefined ? GRAPHICS_PER_MINUTE : options.perMinute
  const held: Held[] = []
  for (const c of project.clips) {
    const spec = c.graphic
    if (!spec || spec.data.template === 'screen-card') continue
    held.push({ onset: onsetSeconds(c.start, spec.beats, fps), from: c.start, to: clipEnd(c), template: spec.data.template })
  }
  const cards = project.clips.filter((c) => c.generatedBy?.rule === COPY_RULE || c.generatedBy?.rule === ENDING_RULE)
  const punches = project.clips.filter((c) => c.moment?.kind === 'zoom-punch')

  const ordered = candidates
    .map((c, i) => ({ c, i, onset: onsetSeconds(c.start, c.spec.beats, fps) }))
    .sort((a, b) => a.onset - b.onset || a.i - b.i)
  const kept: C[] = []
  const dropped: { spec: C['spec']; reason: string }[] = []
  for (const { c, onset } of ordered) {
    const template = c.spec.data.template
    if (!project.clips.some((x) => x.id === c.clipId)) {
      dropped.push({ spec: c.spec, reason: NO_CLIP_NOTE })
      continue
    }
    if (template === 'screen-card') {
      kept.push(c)
      continue
    }
    const reason = refusal(project, c, onset, held, cards, punches, cap)
    if (reason !== null) {
      dropped.push({ spec: c.spec, reason })
      continue
    }
    kept.push(c)
    held.push({ onset, from: c.start, to: c.start + c.duration, template })
  }
  return { kept, dropped }
}

/** The first rule a candidate breaks, as its reason; null when it is kept. */
function refusal(
  project: Project,
  c: BudgetCandidate,
  onset: number,
  held: readonly Held[],
  cards: readonly Clip[],
  punches: readonly Clip[],
  cap: number | null
): string | null {
  const fps = project.settings.fps
  const footage = project.clips.find((x) => x.id === c.clipId)
  if (!footage) return NO_CLIP_NOTE // applyBudget has dropped it already; kept for the type
  const from = c.start
  const to = c.start + c.duration
  const overlaps = (a: number, b: number): boolean => from < b && a < to

  // Rule 1, the gap: every held graphic, a lower third's included.
  if (held.some((h) => Math.abs(onset - h.onset) < GRAPHIC_SPACING.minGapS - EPS)) return TOO_CLOSE_REASON

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
  if (c.spec.data.template !== 'lower-third') {
    const scope = c.rule === GRAPHIC_RULE ? 'ad' : 'clip'
    const span = scope === 'ad' ? { from: 0, to: projectDuration(project) } : { from: footage.start, to: clipEnd(footage) }
    const seconds = framesToSeconds(span.to - span.from, fps)
    // Rounded DOWN, as ⌊clip seconds ÷ 20⌋ says; the 1e-9 keeps 40 s from reading as 39.999….
    const most = Math.max(1, Math.floor(seconds / GRAPHIC_SPACING.perS + 1e-9))
    const lo = framesToSeconds(span.from, fps) - EPS
    const hi = framesToSeconds(span.to, fps) - EPS
    const over = held.filter((h) => h.template !== 'lower-third' && h.onset >= lo && h.onset < hi).length
    if (over >= most) return perClipReason(scope)
  }

  // Rule 4, when M17 has set the cap: every 60 s window that holds this onset.
  if (cap !== null) {
    const onsets = [...held.map((h) => h.onset), onset]
    for (const w of onsets) {
      if (w > onset + EPS || w <= onset - PER_MINUTE_WINDOW_S + EPS) continue
      const inside = onsets.filter((t) => t >= w - EPS && t < w + PER_MINUTE_WINDOW_S - EPS).length
      if (inside > cap) return perMinuteReason(cap)
    }
  }
  return null
}
