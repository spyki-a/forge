/**
 * Beats and reading time for graphics (docs/CLIPS.md §6.8 and §6.2's
 * "Reading holds (M16)").
 *
 * `readingSeconds`, §6.8's `LEAD_S` and `TAIL_S`, and `graphicSeconds`, §6.2's
 * reading-hold rule (lane T1). Lane T3 adds `graphicBeats` (each element's
 * grounded word's start through the clip, with the captions' offset, and the
 * 160 ms spread, `spreadBeats`) and `graphicTiming` (the lead, the seconds
 * and the clip's end, in frames, for one graphic from its beats), with the
 * notes a graphic is dropped with.
 *
 * Pure and node-runnable.
 */

import { graphemeCount } from '../ingest/captions'
import { DEFAULT_MIN_GAP_MS } from '../automation/lyrics'
import { captionWindowMs } from '../captions/placement'
import { framesToSeconds, type Clip, type Project } from '../timeline'
import type { Transcript } from '../transcript'
import { EXIT_S, beatFrame } from './frame'
import type { GraphicTemplateId, TemplateDef } from './template'

/** The graphic clip starts this long before its first beat, the entrance (§6.8). */
export const LEAD_S = 0.5

/** A graphic holds at least to its last beat plus this (§6.8). */
export const TAIL_S = 0.8

/** Netflix's 20 characters a second (the research [33]), as §6.2 sets it. */
export const READING_GRAPHEMES_PER_S = 20

/**
 * How long `text` takes to read: its grapheme count ÷ 20, counted with
 * `graphemeCount` (`ingest/captions.ts`, through `Intl.Segmenter`) so a
 * Hindi or Telugu vowel sign is not a character of its own (§6.2).
 */
export function readingSeconds(text: string): number {
  return graphemeCount(text) / READING_GRAPHEMES_PER_S
}

/**
 * A graphic's seconds (§6.2, "Reading holds (M16)"): the largest of the
 * template's `seconds.min`; its last beat plus `TAIL_S`; and `LEAD_S` plus
 * `readingSeconds(drawn)` plus `EXIT_S`. Null when that is more than the
 * template's `seconds.max`: the graphic is dropped with a note ("said over
 * 9 s; a steps card holds 8"), the caller's. `drawn` is the text the graphic
 * draws, its data strings joined by spaces. Not rounded: the fixtures round
 * up to 0.1 s, a choice of theirs (§6.10's note in specs.json).
 */
export function graphicSeconds(def: Pick<TemplateDef, 'seconds'>, beats: readonly number[], drawn: string): number | null {
  let last = 0
  for (const beat of beats) if (Number.isFinite(beat) && beat > last) last = beat
  const seconds = Math.max(def.seconds.min, last + TAIL_S, LEAD_S + readingSeconds(drawn) + EXIT_S)
  return seconds > def.seconds.max + 1e-9 ? null : seconds
}

/* ------------------------------------------------------------ the beats (§6.8) */

/** The note a graphic on a retimed clip is dropped with (§6.8), the words `applyGraphics` writes. */
export const RETIMED_NOTE = 'graphics on a speed-changed clip are not timed yet'

/** The note a graphic the footage clip ends too soon for is dropped with (§6.8). */
export const CLIP_END_NOTE = "too close to the clip's end to be read"

/**
 * The note a graphic is dropped with when a word it lands on is not one the
 * clip shows: its index names no word of the transcript, or the word starts
 * outside the clip's caption window. Not §6.8's words (the plan is silent);
 * the graphic is dropped rather than its beat clamped, as a graphic that
 * cannot be timed is never placed approximately.
 */
export const NOT_SHOWN_NOTE = 'a word it lands on is not on this clip'

/** The note a graphic with no beat at all is dropped with (not §6.8's words; the plan is silent). */
export const NO_BEAT_NOTE = 'no word to time it on'

/** The least gap between two arriving beats, in seconds: `planLyricCuts`' 160 ms (§6.8). */
export const BEAT_GAP_S = DEFAULT_MIN_GAP_MS / 1000

/**
 * Each word's beat in TIMELINE seconds (§6.8): `word.startMs` carried through
 * the footage clip `clip` with the offset the captions use —
 * `buildTimelineCaptions`' `offsetMs` (captions/timeline.ts:96), in-point ms
 * minus `clip.start`'s ms, the in-point ms read through `captionWindowMs` as
 * `libassLineFrame` reads it (captions/placement.ts) — so the graphic agrees
 * with the captions on a trimmed clip and on a moved one. Not rounded: a
 * beat is a time; `graphicTiming` names its frame.
 *
 * `wordIndices` are `Word.index` values (as `GraphicCandidate.beatWords`
 * holds them, and `director/run.ts` reads them by `Word.index`), not array
 * positions. A beat is NaN when its index names no word, or when the word
 * starts outside the clip's caption window [in-point, in-point + duration)
 * (`captionWindowMs`): the clip does not show that start, so the beat is
 * not on it. `graphicTiming` drops a graphic with a NaN beat
 * (`NOT_SHOWN_NOTE`); nothing is clamped.
 *
 * Null when the clip is retimed, `speed` or `ramp` set, as the J-cut refuses
 * one (director/apply2.ts:248): the captions ignore speed, so a speed-aware
 * beat would drift from them (§6.8). The caller's note is `RETIMED_NOTE`.
 *
 * Arriving beats are spread to 160 ms (`spreadBeats`) unless `options.spread`
 * is false, which `applyGraphics` passes for a quote: a quote's beats light
 * words, as the captions' highlight does, and are not spread (§6.8).
 */
export function graphicBeats(
  project: Pick<Project, 'settings'>,
  clip: Pick<Clip, 'start' | 'inPoint' | 'duration' | 'speed' | 'ramp'>,
  transcript: Pick<Transcript, 'words'>,
  wordIndices: number[],
  options: { spread?: boolean } = {}
): number[] | null {
  if (clip.speed !== undefined || clip.ramp !== undefined) return null
  const fps = project.settings.fps
  const window = captionWindowMs(clip, fps)
  // buildTimelineCaptions' offset, the same expression: a word at source ms sits at (ms − offsetMs) on the timeline.
  const offsetMs = window.startMs - framesToSeconds(clip.start, fps) * 1000
  const byIndex = new Map(transcript.words.map((w) => [w.index, w]))
  const beats = wordIndices.map((i) => {
    const word = byIndex.get(i)
    if (!word || !(word.startMs >= window.startMs && word.startMs < window.endMs)) return Number.NaN
    return (word.startMs - offsetMs) / 1000
  })
  return options.spread === false ? beats : spreadBeats(beats)
}

/**
 * §6.8's spacing: in the order given (the elements' order, which the
 * validator keeps in spoken order), a beat closer than 160 ms
 * (`DEFAULT_MIN_GAP_MS`, automation/lyrics.ts) after the one before it, as
 * moved, is moved to 160 ms after it — the later moved, never the earlier.
 * A gap of exactly 160 ms is left (1e-9 s allowance for float error). A NaN
 * beat is left NaN and is no beat to space from. A new array.
 */
export function spreadBeats(beats: readonly number[]): number[] {
  const out = [...beats]
  let prev = Number.NaN
  for (let i = 0; i < out.length; i++) {
    if (!Number.isFinite(out[i])) continue
    if (Number.isFinite(prev) && out[i] - prev < BEAT_GAP_S - 1e-9) out[i] = prev + BEAT_GAP_S
    prev = out[i]
  }
  return out
}

/** One graphic's place in time on the timeline, or the note it is dropped with. */
export type GraphicTiming =
  | {
      ok: true
      /** The graphic clip's first frame on the timeline. */
      start: number
      /** Its length in frames: `max(1, round(seconds × fps))`, as the store's `addGraphicClip` makes it. */
      duration: number
      /** `GraphicSpec.seconds`, not rounded (`graphicSeconds`). */
      seconds: number
      /** `GraphicSpec.beats`: each beat in seconds from `start`'s time. */
      beats: number[]
    }
  | { ok: false; note: string }

/**
 * One graphic's timing from its beats (§6.8, §6.2), on the footage clip
 * `clip` it shows over; `beats` are `graphicBeats`' (timeline seconds,
 * already spread or not), `drawn` the text it draws for `readingSeconds`.
 *
 * - **Start**: the first frame at or after the first beat less `LEAD_S`,
 *   `beatFrame(first − LEAD_S, fps)` — §6.3's beat-frame rule, rounded UP,
 *   no second rule — and never before `clip.start`. So the lead is at most
 *   0.5 s and more than 0.5 s less one frame.
 * - **Beats**: each beat less `start`'s time, in seconds (`GraphicSpec.beats`),
 *   held to 0 against float error. Since `start` is a whole frame, the frame
 *   an element arrives on, `start + beatFrame(beat, fps)` (§6.3), is the
 *   beat's own timeline frame `beatFrame(timeline beat, fps)`: it lands ON
 *   its beat.
 * - **Seconds**: `graphicSeconds` over those beats (at least the last beat
 *   plus `TAIL_S`, within the template's bounds); over `seconds.max`, the
 *   drop "said over 8.8 s; a steps card holds 8", the figure rounded DOWN to
 *   0.1 s so "over" stays true.
 * - **Duration**: `max(1, round(seconds × fps))` frames, rounded to nearest,
 *   the store's own rule (store.ts `addGraphicClip`, `setGraphic`), so a
 *   later `setGraphic` makes the same length.
 * - **The clip's end**: past `clip.start + clip.duration`, dropped with
 *   `CLIP_END_NOTE`.
 *
 * A beat that is not a number (a word the clip does not show) drops with
 * `NOT_SHOWN_NOTE`, no beats with `NO_BEAT_NOTE`.
 */
export function graphicTiming(
  clip: Pick<Clip, 'start' | 'duration'>,
  beats: readonly number[],
  def: Pick<TemplateDef, 'id' | 'seconds'>,
  drawn: string,
  fps: number
): GraphicTiming {
  if (beats.length === 0) return { ok: false, note: NO_BEAT_NOTE }
  if (beats.some((b) => !Number.isFinite(b))) return { ok: false, note: NOT_SHOWN_NOTE }
  const first = Math.min(...beats)
  const start = Math.max(clip.start, beatFrame(first - LEAD_S, fps))
  const startS = framesToSeconds(start, fps)
  const relative = beats.map((b) => Math.max(0, b - startS))
  const seconds = graphicSeconds(def, relative, drawn)
  if (seconds === null) {
    const needed = graphicSeconds({ seconds: { ...def.seconds, max: Number.POSITIVE_INFINITY } }, relative, drawn)!
    return { ok: false, note: `said over ${Math.floor(needed * 10 + 1e-6) / 10} s; a ${cardName(def.id)} card holds ${def.seconds.max}` }
  }
  const duration = Math.max(1, Math.round(seconds * fps))
  if (start + duration > clip.start + clip.duration) return { ok: false, note: CLIP_END_NOTE }
  return { ok: true, start, duration, seconds, beats: relative }
}

/** A template's id as the note says it: "lower third", not "lower-third". */
function cardName(id: GraphicTemplateId): string {
  return id.replace(/-/g, ' ')
}
