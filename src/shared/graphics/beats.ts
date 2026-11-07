/**
 * Beats and reading time for graphics (docs/CLIPS.md §6.8 and §6.2's
 * "Reading holds (M16)").
 *
 * Only `readingSeconds` so far. `graphicBeats` (each element's grounded
 * word's start through the clip, the lead, the tail and the 160 ms spread,
 * §6.8) arrives in this file with lane T3.
 *
 * Pure and node-runnable.
 */

import { graphemeCount } from '../ingest/captions'

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
