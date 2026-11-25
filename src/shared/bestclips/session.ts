import { askStructured } from '../director/ask'
import { chooseProvider, type CompletionRequest, type CompletionResult, type LlmProviderChoice, type LlmStatus } from '../director/provider'
import { formatMark } from '../ingest/section'
import type { Transcript } from '../transcript'
import type { BestClipCard, BestClipsAsk, BestClipsResult } from './run'

/**
 * Best clips in the URL tile (docs/CLIPS.md §7.5's first half, sheet 27): the
 * rules the store's Analyse and the panel's cards follow, kept out of the
 * store so a test can hold them. Pure: no `window`, no clock, no `node:`.
 *
 * WHAT A RESULT BELONGS TO. An Analyse is asked for one link, one length and
 * one transcript of that link (`BestClipsAsked`). Its answer is kept only if
 * all three are still what the store holds when it arrives, and shown only
 * while they are what the panel shows (`bestClipsBelongs`): a link changed, a
 * length changed or the captions fetched again in between, and the answer is
 * dropped, not shown. The transcript is compared by identity: Get transcript
 * always builds a new one, so a re-fetch is a change even with the same words.
 *
 * ONE ANALYSE AT A TIME (`analyseRefusal`): a second press while one runs is
 * refused, not queued and not a replacement. Two asks at once would put two
 * prompts on one local model (§12.1's 8 GB machine), and a run is bounded by
 * `BEST_CLIPS_TIMEOUT_MS`, after which `bestClips` returns the signals' three
 * and the next press is free (the model's late answer is then ignored by
 * `bestClips` itself: its race has already settled).
 *
 * A LENGTH CHANGE CLEARS THE CARDS (`withLength`): cards of 2 min under a
 * picked "1 min" would read as 1-minute cards. Picking the length already
 * shown keeps them.
 */

/** The four lengths of sheet 27, as one choice. The labels are the census rows' (§7.7). */
export const BEST_CLIPS_LENGTHS: readonly { ms: number; label: string }[] = [
  { ms: 60_000, label: '1 min' },
  { ms: 120_000, label: '2 min' },
  { ms: 180_000, label: '3 min' },
  { ms: 240_000, label: '4 min' }
]

export const DEFAULT_BEST_CLIPS_MS = 60_000

/**
 * How long Analyse waits for the model before the signals' three are shown:
 * three minutes. A CPU model answers this prompt (about 3.3k tokens in, up to
 * 950 out, prompt.ts) in tens of seconds; three minutes leaves room for a slow
 * machine's first load of the model, and is not so long that a hung server
 * holds the panel. Unmeasured on a real model (run A's eval could not run).
 */
export const BEST_CLIPS_TIMEOUT_MS = 180_000

/** Who picked a card, in words a user reads (§7.4's `scoredBy`). */
export const SCORED_BY_LABEL: Readonly<Record<BestClipCard['scoredBy'], string>> = {
  model: 'Picked by the model',
  signals: "Picked from the talk's own signals"
}

/**
 * With no caption track, the AI helper there or not. M0's Listen to it is
 * still greyed ("soon"), so this line names no button the user cannot press
 * and promises nothing the helper cannot do: §7.5's "needs the AI helper to
 * listen" was true only once Listen to it is built, and installing the helper
 * for it would have led to this line anyway. When Listen to it is built, it
 * can point there (tests/renderer/bestClipsPanel.test.tsx holds the two
 * together).
 */
export const BEST_CLIPS_CANNOT_LISTEN = 'This video has no captions, and Best clips cannot listen to a video yet.'
/** Before Get transcript has words: Analyse downloads nothing, so it points there. */
export const BEST_CLIPS_NEEDS_TRANSCRIPT = 'Best clips reads the video’s captions: press Get transcript first.'
/** Said while the model or the signals are at work on the link on screen. */
export const BEST_CLIPS_RUNNING = 'Looking for the best stretches…'
/** Said while an Analyse runs for another link, or for this link's earlier captions: its answer will not be shown here. */
export const BEST_CLIPS_RUNNING_ELSEWHERE = 'Best clips is still looking at another video.'
/** A second press while one runs. */
export const BEST_CLIPS_BUSY = 'Best clips is already looking: one Analyse at a time.'
/** Analyse failed outside `bestClips` (which never throws for a failed ask). Never an error's text. */
export const BEST_CLIPS_FAILED = 'Best clips could not finish. Press Analyse to try again.'

/** What an Analyse was asked for. */
export interface BestClipsAsked {
  linkKey: string
  targetMs: number
  transcript: Transcript
}

/** The Best clips slice: session state, like `urlSource` (newProject and loadProject leave it alone). */
export interface BestClipsState {
  /** The length picked, one of `BEST_CLIPS_LENGTHS`. */
  targetMs: number
  /** The Analyse in flight, or null. */
  running: BestClipsAsked | null
  /** The last answer kept, with what it was asked for. */
  last: (BestClipsAsked & { result: BestClipsResult }) | null
}

export function initialBestClips(): BestClipsState {
  return { targetMs: DEFAULT_BEST_CLIPS_MS, running: null, last: null }
}

/** What is on screen or in the store now: the link's key and transcript, and the length picked. */
export interface BestClipsNow {
  linkKey: string
  transcript: Transcript | null
  targetMs: number
}

/** Whether an answer asked as `asked` is still about `now`: the same link, the same length, the same transcript. */
export function bestClipsBelongs(asked: BestClipsAsked, now: BestClipsNow | null): boolean {
  return now !== null && asked.linkKey === now.linkKey && asked.targetMs === now.targetMs && now.transcript !== null && asked.transcript === now.transcript
}

/** The result to show for this link and length, or null. */
export function shownBestClips(state: BestClipsState, source: { linkKey: string; transcript: Transcript | null } | null): BestClipsResult | null {
  if (!state.last || !source) return null
  return bestClipsBelongs(state.last, { ...source, targetMs: state.targetMs }) ? state.last.result : null
}

/** Whether the Analyse in flight is about this link and its transcript (any length: the lengths are greyed while it runs). */
export function runningHere(state: BestClipsState, source: { linkKey: string; transcript: Transcript | null } | null): boolean {
  return state.running !== null && source !== null && state.running.linkKey === source.linkKey && state.running.transcript === source.transcript
}

/** Why Analyse cannot start now, or null: one already running, or no words to read. */
export function analyseRefusal(state: BestClipsState, source: { transcript: Transcript | null } | null): 'running' | 'no-transcript' | null {
  if (state.running !== null) return 'running'
  if (!source || !source.transcript || source.transcript.words.length === 0) return 'no-transcript'
  return null
}

/** The state after picking a length: an unknown length is ignored; a different one clears the cards. */
export function withLength(state: BestClipsState, targetMs: number): BestClipsState {
  if (!BEST_CLIPS_LENGTHS.some((l) => l.ms === targetMs) || targetMs === state.targetMs) return state
  return { ...state, targetMs, last: null }
}

/**
 * Whether a model would answer: the same test main's `complete` makes before
 * it asks anything (`chooseProvider` over the providers' status and the
 * chosen provider, main/director.ts), so "no model" here is exactly the case
 * in which `complete` would throw "No model available".
 */
export function modelReady(status: readonly LlmStatus[], choice: LlmProviderChoice): boolean {
  return !('error' in chooseProvider(choice, [...status]))
}

/**
 * The ask Analyse hands `bestClips`: `askStructured` over the bridge's
 * `complete`, as the store's graphics ask builds it (the key never leaves the
 * main process). An answer that is not JSON becomes `{ error }`; a `complete`
 * that throws is left to throw, and `bestClips` turns that into its fixed
 * MODEL_FAILED_NOTE, keeping none of the error's text (it can name a server's
 * address or carry a key).
 */
export function bestClipsAskOver(complete: (request: CompletionRequest) => Promise<CompletionResult>): BestClipsAsk {
  return async (request) => {
    const asked = await askStructured(complete, request)
    return {
      answer: 'error' in asked.parsed ? { error: asked.parsed.error } : { value: asked.parsed.value, truncated: asked.result.truncated },
      model: { id: asked.result.model, runtime: asked.result.provider },
      notes: asked.notes
    }
  }
}

/** A card's range, in the URL tile's own time marks (`formatMark`, as the rows and the From and To fields show them). */
export function cardRange(card: Pick<BestClipCard, 'startMs' | 'endMs'>): string {
  return `${formatMark(card.startMs)} – ${formatMark(card.endMs)}`
}

/** A card's word count. */
export function cardWords(card: Pick<BestClipCard, 'words'>): string {
  return `${card.words} word${card.words === 1 ? '' : 's'}`
}
