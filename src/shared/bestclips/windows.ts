/**
 * Best clips' windows (docs/CLIPS.md §7.3): every stretch of about the asked
 * length that starts and ends between sentences, the menu the signals score
 * and the model picks from by id.
 *
 * Pure: no `node:`, no Electron, no renderer import. The renderer, main and
 * the eval all read it.
 *
 * - **Boundaries are segment boundaries only**, and the segments are
 *   `capSegments(t, 30, 15000)` (§7.2: every menu and stretch builds from it,
 *   never written back). A window starts at a capped segment's start and ends
 *   at a capped segment's end, so a cut can never land mid-sentence or
 *   mid-word: neither is on the menu.
 * - **Its length** (first segment's start to last segment's end) is within
 *   ±`tolerance` of the target. A start with no end inside that band gives NO
 *   window: the plan says within the tolerance, so the nearest end outside it
 *   is not taken. That covers a single segment longer than the upper bound
 *   (it cannot start a window; it can sit inside one only if the whole stays
 *   within the band) and a transcript whose talk is shorter than the lower
 *   bound (no window at all; `shortfallNote` says so in plain words).
 * - **Which end, of those inside the band**: one on sentence-final
 *   punctuation (`endsSentence`, the danda included) when any is, else any;
 *   then the one nearest the target; then the earlier. An unpunctuated
 *   transcript has no punctuated end, so it simply takes the nearest: no
 *   script is passed over for lacking a full stop.
 * - **Stride: one segment.** One window per start that has an end, ids `w1`…
 *   in start order. Nothing here reads a locale, the clock or a random
 *   source: the same transcript and target give the same windows everywhere.
 * - **No time from the model.** The model picks ids; this turns ids into ms
 *   (docs/DIRECTOR.md §1).
 */

import { capSegments, endsSentence, type Segment, type Transcript, type Word } from '../transcript'

/** §7.2's cap: every Best clips stretch is built from segments no longer than this. */
export const CAP_WORDS = 30
export const CAP_MS = 15_000
/** ±20 % of the asked length (§7.3). */
export const DEFAULT_TOLERANCE = 0.2

export interface ClipWindow {
  /** 'w1', 'w2'… in start order: the id the model picks. */
  id: string
  /** The capped segment it starts on, and the one it ends on (ids from `capSegments`). */
  segFrom: string
  segTo: string
  startMs: number
  endMs: number
  /** Words in it. */
  words: number
}

/** The capped segments every Best clips window and signal reads. */
export function clipSegments(t: Pick<Transcript, 'words' | 'segments'>): Segment[] {
  return capSegments(t, CAP_WORDS, CAP_MS)
}

/** A segment's last word ends a sentence (its text's last token, as the segmenter read it). */
export function segmentEndsSentence(segment: Segment): boolean {
  const text = segment.text.trimEnd()
  const last = text.slice(text.lastIndexOf(' ') + 1)
  return last.length > 0 && endsSentence(last)
}

/** Positions (not `Word.index`) of each word index, so a word count survives the gaps a hand edit leaves. */
export function wordPositions(words: readonly Word[]): Map<number, number> {
  const at = new Map<number, number>()
  words.forEach((w, i) => at.set(w.index, i))
  return at
}

/** The band a window's length must fall in, in ms: [lo, hi]. */
export function lengthBand(targetMs: number, tolerance: number = DEFAULT_TOLERANCE): { lo: number; hi: number } {
  return { lo: targetMs * (1 - tolerance), hi: targetMs * (1 + tolerance) }
}

export function windowsFor(t: Transcript, targetMs: number, tolerance: number = DEFAULT_TOLERANCE): ClipWindow[] {
  if (!(targetMs > 0) || !(tolerance >= 0)) return []
  const segs = clipSegments(t)
  return windowsOver(segs, wordPositions(t.words), targetMs, tolerance)
}

/** `windowsFor` over segments already capped (the signals reuse them rather than capping twice). */
export function windowsOver(
  segs: readonly Segment[],
  position: ReadonlyMap<number, number>,
  targetMs: number,
  tolerance: number = DEFAULT_TOLERANCE
): ClipWindow[] {
  const { lo, hi } = lengthBand(targetMs, tolerance)
  const punctuated = segs.map(segmentEndsSentence)
  const out: ClipWindow[] = []
  for (let i = 0; i < segs.length; i++) {
    const start = segs[i].startMs
    let best = -1
    let bestPunct = false
    let bestDistance = Infinity
    for (let j = i; j < segs.length; j++) {
      const length = segs[j].endMs - start
      if (length > hi) break
      if (length < lo) continue
      const distance = Math.abs(length - targetMs)
      // A punctuated end beats any unpunctuated one; then nearest the target; then the earlier (strict <).
      if (best < 0 || (punctuated[j] && !bestPunct) || (punctuated[j] === bestPunct && distance < bestDistance)) {
        best = j
        bestPunct = punctuated[j]
        bestDistance = distance
      }
    }
    if (best < 0) continue
    const from = position.get(segs[i].wordStart)
    const to = position.get(segs[best].wordEnd)
    out.push({
      id: `w${out.length + 1}`,
      segFrom: segs[i].id,
      segTo: segs[best].id,
      startMs: start,
      endMs: segs[best].endMs,
      words: from === undefined || to === undefined ? 0 : to - from + 1
    })
  }
  return out
}

/** Minutes for a plain line: 1, 1.5, 2… */
function minutes(ms: number): string {
  const m = Math.round((ms / 60_000) * 2) / 2
  return `${m} min`
}

/**
 * Why there are fewer than three windows, in words a card can show; null when
 * nothing is short. `found` is how many non-overlapping picks there are.
 */
export function shortfallNote(t: Transcript, targetMs: number, found: number): string | null {
  if (found >= 3) return null
  const segs = t.segments
  if (t.words.length === 0 || segs.length === 0) return "This video's transcript has no words to pick a clip from."
  const talkMs = segs[segs.length - 1].endMs - segs[0].startMs
  const { lo } = lengthBand(targetMs)
  if (talkMs < lo) return `The talk here runs about ${minutes(talkMs)}, shorter than the ${minutes(targetMs)} asked for. Try a shorter length.`
  if (found === 0) return `No stretch of about ${minutes(targetMs)} here starts and ends between sentences. Try another length.`
  return found === 1
    ? `Only one stretch of about ${minutes(targetMs)} fits here without repeating another.`
    : `Only ${found} stretches of about ${minutes(targetMs)} fit here without repeating each other.`
}
