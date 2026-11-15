/**
 * A graphic added from the transcript by hand (try-out 1, 2026-11-15, piece 5:
 * the owner's "or if the user wants to add from the transcript?"): the
 * Transcript tile's **Add graphic from these words**, acting on the tile's
 * existing pick (`clipRun`, the run "Cut to these words" cuts to).
 *
 * - A pick of whole rows (a row clicked, or shift-clicked out to more rows)
 *   chooses its first row's SENTENCE, read as the baseline reads it
 *   (`sentenceGraphic`): steps from a run of ordinal sentences starting
 *   there, a ring, a counter, else a keyword of its last words, Find's taste
 *   limits not applied.
 * - A pick of words inside one row (a word shift-clicked with nothing picked,
 *   or Start and End dragged in) is a keyword of exactly those words, in any
 *   language: the transcript's own words, so the app writes none.
 *
 * No model is asked: this is the owner's add, and the baseline's reading is
 * instant and offline. The graphic goes through the validator as every one
 * does (`settleByHand`), then lands through piece 4's Add path (`addDropped`:
 * Keep's steps, the gap, the count and the per-minute cap not read; another
 * graphic on screen, a card, a zoom punch, the clip's end, a third, a lane
 * still refuse). A truth refusal is not lost: it comes back as a dropped row
 * (`GraphicDrop`, with piece 4's `add` when it can be drawn) for the tile's
 * Graphics section to list. Pure.
 */

import type { Project } from '../timeline'
import type { Transcript } from '../transcript'
import type { ClipWords } from '../edit/clipIt'
import { rowOfWord, rowsOf, clampRun, type WordRun } from '../ingest/wordRun'
import { graphemeCount } from '../ingest/captions'
import { addDropped, type GraphicsApplyContext } from '../graphics/apply'
import type { GraphicDrop } from '../graphics/template'
import type { Problem } from './conforms'
import { sentenceGraphic } from './baselineGraphics'
import { graphicsMenuFor, quoteSpeakerFor, settleByHand } from './run'
import { GRAPHIC_KEPT_CHARS } from './validateGraphics'

/** What the pick asks for, in the WHOLE transcript's word indices (`Word.index`). */
export interface WordsPick {
  /** A word of the chosen sentence: the pick's first. */
  word: number
  /** The picked words when they lie inside one row and are not all of it; null for a sentence. */
  words: [number, number] | null
}

/**
 * The tile's pick (`run`, over `clipWords`' transcript `words`, numbered from
 * 0 by position) as the whole transcript `whole`'s word indices: position
 * `i` there is `whole.words[words.first + i]` (clipIt.ts). Whole rows, or a
 * pick that crosses a row's edge, choose the sentence of its first word; a
 * pick inside one row that is not the whole row picks words. Null for an
 * empty transcript or a pick that is not over `whole`.
 */
export function pickForGraphic(whole: Transcript, words: ClipWords, run: WordRun): WordsPick | null {
  const t = words.transcript
  if (t.words.length === 0) return null
  const at = clampRun(t, run)
  const rows = rowsOf(t)
  const r0 = rowOfWord(rows, at.from)
  const r1 = rowOfWord(rows, at.to)
  const from = whole.words[words.first + at.from]?.index
  const to = whole.words[words.first + at.to]?.index
  if (from === undefined || to === undefined) return null
  const inside = r0 >= 0 && r0 === r1 && !(at.from === rows[r0].words[0] && at.to === rows[r0].words[1])
  return { word: from, words: inside ? [from, to] : null }
}

/** Said when the picked words or sentence give nothing to draw (not the plan's words). */
export const NOTHING_TO_DRAW_NOTE = 'Nothing here to make a graphic of — pick words inside the sentence for a keyword'
/** The row's note when the validator refused a by-hand graphic that can still be drawn (not the plan's words). */
export const FROM_WORDS_LISTED_NOTE = 'Not added, for the reason above — press Add to place it anyway'
/** The row's note when the validator refused one that cannot be drawn at all (not the plan's words). */
export const FROM_WORDS_NOT_ADDED_NOTE = 'Not added, for the reason above'
/** The note shown as the row is listed (not the plan's words): the reason, and where the row is. */
export function fromWordsListedToast(reason: string): string {
  return `Graphic not added: ${reason} — it is listed under Graphics`
}

export type FromWordsResult =
  | { outcome: 'added'; project: Project; clipIds: string[]; problems: Problem[] }
  | { outcome: 'refused'; reason: string }
  | { outcome: 'listed'; drop: GraphicDrop }
  | { outcome: 'nothing'; note: string }

/**
 * The graphic for `pick` on footage clip `clipId`, placed or not. 'added': the
 * project with it landed (one update for the caller, one undo). 'refused':
 * validated, but a rule of drawing refused it (another graphic on screen, a
 * card, a zoom punch, the clip's end…), with that reason. 'listed': the
 * validator refused it; the drop to list, its `add` absent when it cannot be
 * drawn (a picked keyword over `GRAPHIC_KEPT_CHARS.words`). 'nothing': no
 * clip, no transcript, a sentence the clip does not show, or nothing to draw.
 */
export function graphicFromWords(project: Project, clipId: string, pick: WordsPick, ctx: GraphicsApplyContext): FromWordsResult {
  const nothing: FromWordsResult = { outcome: 'nothing', note: NOTHING_TO_DRAW_NOTE }
  const clip = project.clips.find((c) => c.id === clipId)
  const transcript = clip ? project.transcripts[clip.assetId] : undefined
  if (!clip || !transcript || clip.graphic !== undefined) return nothing
  const menus = graphicsMenuFor(project, clip, transcript)
  const menu = menus.find((m) => m.sentences.some((s) => pick.word >= s.wordStart && pick.word <= s.wordEnd))
  const sentence = menu?.sentences.find((s) => pick.word >= s.wordStart && pick.word <= s.wordEnd)
  if (!menu || !sentence) return nothing
  const candidate = sentenceGraphic(transcript, menu, sentence.id, pick.words)
  if (!candidate) return nothing
  const speaker = quoteSpeakerFor(project.assets.find((a) => a.id === clip.assetId))
  const settled = settleByHand(candidate, menu, transcript, speaker)
  if (settled.kept) {
    const landed = addDropped(project, { add: settled.kept }, ctx)
    if (landed.refused !== null) return { outcome: 'refused', reason: landed.refused }
    return { outcome: 'added', project: landed.project, clipIds: landed.clipIds, problems: landed.problems }
  }
  const drop = settled.drop!
  // A picked keyword longer than a keyword is drawn: listed with its reason, never placed.
  const tooLong = candidate.data.template === 'keyword' && graphemeCount(candidate.data.words) > GRAPHIC_KEPT_CHARS.words
  if (tooLong && drop.add) {
    const { add: _add, ...rest } = drop
    return { outcome: 'listed', drop: rest }
  }
  return { outcome: 'listed', drop }
}
