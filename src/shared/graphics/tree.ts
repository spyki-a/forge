/**
 * The tree behind a `steps` graphic with a connector (docs/CLIPS.md §6.2,
 * "The tree — graphics/tree.ts"). The app computes every parent; the model
 * never fills them.
 *
 * Rule 1: every parent is −1, the title, by default. Rule 2 (English, v1): a
 * count of two to six said between item j's run and item j+1's, within two
 * tokens of a word such as "parts" or "ways", makes the next that-many items
 * j's children. A child's own count is ignored, so depth is at most two.
 * An item counted off by an ordinal ("Second, the shoot", "step two") is the
 * speaker's own top-level item, never a child: a count whose next items are
 * one nests nothing (lane T4's fix; nested-en-1 read with only its ordinal
 * items, as the baseline finds them).
 * Hindi and Telugu stay flat in v1: the cue list is English, as §16.11's
 * number words are.
 *
 * Pure and node-runnable.
 */

import type { Word } from '../transcript'
import { claimToken } from '../director/claims'

/** The words a sub-count is said of (§6.2's list, a proposal). */
export const SUB_COUNT_CUES: readonly string[] = Object.freeze([
  'parts',
  'things',
  'steps',
  'ways',
  'kinds',
  'types',
  'reasons',
  'points',
  'pieces',
  'stages',
  'options'
])

/** A count from two to six, in digits (native digits already ASCII) or as an English number word. */
const COUNTS: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6
}

/**
 * The words that count an item off (§6.10's "first", "second", "step one"),
 * as `claimToken` writes them: an ordinal, or "step" and a count. Up to six,
 * a steps graphic's most items. English, as the cue list is.
 */
export const ORDINAL_OPENERS: readonly string[] = Object.freeze(['first', 'second', 'third', 'fourth', 'fifth', 'sixth'])
export const STEP_COUNT_WORDS: readonly string[] = Object.freeze(['one', 'two', 'three', 'four', 'five', 'six', '1', '2', '3', '4', '5', '6'])

/** How many tokens before an item's run an ordinal still counts it off ("Second, the shoot": two; "The second way is flash": three). */
const OPENER_REACH = 3

/** Whether the tokens just before `start` (none before `after`) count the item there off: an ordinal, or "step" and a count. */
function countedOff(tokens: string[], after: number, start: number): boolean {
  const lead = tokens.slice(Math.max(after, start - OPENER_REACH), start)
  return lead.some((t, i) => ORDINAL_OPENERS.includes(t) || (t === 'step' && STEP_COUNT_WORDS.includes(lead[i + 1] ?? '')))
}

/** How far a count may sit from its cue word, in tokens. */
const CUE_REACH = 2

/** The most tokens skipped between two of a label's tokens (§6.7 rule 6's run gap). */
const RUN_GAP = 3

/** Each label's run in `tokens`, in spoken order: [first, last] token positions, or null when one is not found. */
function labelRuns(labels: string[], tokens: string[]): [number, number][] | null {
  const runs: [number, number][] = []
  let cursor = 0
  for (const label of labels) {
    const want = label.split(/\s+/).map(claimToken).filter(Boolean)
    if (want.length === 0) return null
    let found: [number, number] | null = null
    for (let s = cursor; s < tokens.length && !found; s++) {
      if (tokens[s] !== want[0]) continue
      let at = s
      let ok = true
      for (let w = 1; w < want.length && ok; w++) {
        let next = -1
        for (let i = at + 1; i <= at + 1 + RUN_GAP && i < tokens.length; i++) {
          if (tokens[i] === want[w]) {
            next = i
            break
          }
        }
        if (next < 0) ok = false
        else at = next
      }
      if (ok) found = [s, at]
    }
    if (!found) return null
    runs.push(found)
    cursor = found[1] + 1
  }
  return runs
}

/** The sub-count said in tokens[from..to), or null. */
function subCount(tokens: string[], from: number, to: number): number | null {
  for (let i = from; i < to; i++) {
    const n = COUNTS[tokens[i]]
    if (n === undefined) continue
    for (let c = Math.max(from, i - CUE_REACH); c <= Math.min(to - 1, i + CUE_REACH); c++) {
      if (c !== i && SUB_COUNT_CUES.includes(tokens[c])) return n
    }
  }
  return null
}

/**
 * One parent per item (docs/CLIPS.md §6.2): −1 is the title, any other value
 * an earlier item. `words` are the stretch's words, from the first item's
 * first bound word to the last item's last; each label's run is found in
 * spoken order with `claimToken`. A label not found leaves the list flat.
 */
export function treeParents(items: { label: string }[], title: string, words: Word[]): number[] {
  void title
  const parents = items.map(() => -1)
  const tokens = words.map((w) => claimToken(w.text)).filter(Boolean)
  const runs = labelRuns(
    items.map((i) => i.label),
    tokens
  )
  if (!runs) return parents
  for (let j = 0; j + 1 < items.length; j++) {
    if (parents[j] !== -1) continue // a child's own count is ignored: depth ≤ 2
    const k = subCount(tokens, runs[j][1] + 1, runs[j + 1][0])
    if (k === null || k > items.length - 1 - j) continue
    let counted = false
    for (let c = j + 1; c <= j + k; c++) if (countedOff(tokens, runs[c - 1][1] + 1, runs[c][0])) counted = true
    if (counted) continue
    for (let c = j + 1; c <= j + k; c++) parents[c] = j
  }
  return parents
}

/** Every parent −1 or an earlier index, and no parent's own parent other than −1: one root, depth ≤ 2 (§6.2). */
export function parentsValid(parents: number[]): boolean {
  return parents.every(
    (p, i) => p === -1 || (Number.isInteger(p) && p >= 0 && p < i && parents[p] === -1)
  )
}

/**
 * The app's connector for a steps list (§6.2): `tree` when any parent is ≥ 0
 * (a nested enumeration), `line` for three or more items, `none` for two.
 * The dock may change it (§6.6).
 */
export function connectorFor(parents: number[]): 'none' | 'line' | 'tree' {
  if (parents.some((p) => p >= 0)) return 'tree'
  return parents.length >= 3 ? 'line' : 'none'
}
