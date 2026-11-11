/**
 * Beats and reading time for graphics (docs/CLIPS.md §6.8 and §6.2's
 * "Reading holds (M16)").
 *
 * `readingSeconds`, §6.8's `LEAD_S` and `TAIL_S`, and `graphicSeconds`, §6.2's
 * reading-hold rule. `graphicBeats` (each element's grounded word's start
 * through the clip, the lead, the tail and the 160 ms spread, §6.8) arrives
 * in this file with lane T3, and will call `graphicSeconds`.
 *
 * Pure and node-runnable.
 */

import { graphemeCount } from '../ingest/captions'
import { EXIT_S } from './frame'
import type { TemplateDef } from './template'

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
