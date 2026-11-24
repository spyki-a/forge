import type { CompletionRequest } from '../director/provider'
import type { Problem } from '../director/conforms'
import type { LinkMeta } from '../ingest/args'
import type { Transcript } from '../transcript'
import { candidatesFor, overlapShare, MAX_OVERLAP, type Candidates, type ClipCandidate } from './signals'
import { bestClipsSchema, picksWanted, PICKS } from './schema'
import { bestClipsPrompt, maxTokensForBestClips } from './prompt'
import { validateBestClips, type ValidPick } from './validate'

/**
 * Best clips on Analyse (docs/CLIPS.md §7.4), shared by the app and the eval
 * as the Director's run.ts is: the windows, the signals and the prefilter
 * (piece 1, `candidatesFor`), ONE comparative ask through an injected `ask`
 * (the app's `askStructured` over its `complete`, in main; the eval's over
 * saved answers; no provider code and no key here), the answer settled by
 * `validateBestClips`, and at most three cards.
 *
 * TIME COMES FROM THE WINDOWS. A card's `startMs`, `endMs` and `words` are
 * read from the window its id names (`Candidates.windows`), never from the
 * answer: whatever else an answer carries (a start, an end, a time in its
 * title) is not read as time (docs/DIRECTOR.md §1).
 *
 * THE ORDER of the cards: by start time, model picks and filled ones alike
 * (ties to the earlier id). The model is asked to pick, not to rank, and the
 * three are three separate shorts; in time order they read as the video goes.
 *
 * WHEN THE MODEL'S ANSWER IS NOT USED, the signals' three (`scoredBy:
 * 'signals'`, titled with their first sentence, their reason line as the why)
 * with a plain `modelNote` that never carries an error's text, since a thrown
 * error could hold a server's address or a key: no ask given
 * (`NO_MODEL_NOTE`), an ask that throws (`MODEL_FAILED_NOTE`), an answer that
 * does not parse or is not the shape asked for (`MODEL_UNUSABLE_NOTE`), no
 * answer within `options.timeoutMs` (`MODEL_SLOW_NOTE`). A model answer with
 * fewer usable picks than asked is filled from the signals' candidates, best
 * first, that do not share more than half their time with a kept pick
 * (`filledNote`), each filled card `scoredBy: 'signals'` with `FILLED_NOTE`.
 *
 * Never throws for a failed ask. Nothing here reads a clock (the timeout is a
 * timer), a locale or a random source.
 */

/** The ask the run is handed: the app's askStructured over its complete, or the eval's over saved answers. */
export type BestClipsAsk = (request: CompletionRequest) => Promise<{
  answer: { value: unknown; truncated: boolean } | { error: string }
  model: { id: string; runtime: string } | null
  notes?: string[]
}>

/** One card (sheet 27): a stretch, its title and why, and who picked it. */
export interface BestClipCard {
  windowId: string
  startMs: number
  endMs: number
  words: number
  title: string
  why: string
  /** 'model': the model picked this window; 'signals': the signals did (no model, or filled). */
  scoredBy: 'model' | 'signals'
  /** A plain line about this card: why the signals filled it, or why its title or why is not the model's. */
  note?: string
}

export interface BestClipsResult {
  targetMs: number
  /** At most three, by start time. */
  cards: BestClipCard[]
  /** Why there are fewer than three (`shortfallNote`), or null. */
  note: string | null
  /** Why the model's answer is not (wholly) on the cards, in plain words, or null. Never an error's text. */
  modelNote: string | null
  /** The model that answered, when its answer was used; null otherwise. */
  model: { id: string; runtime: string } | null
  /** The ask's own notes (askStructured's retry), for the eval and a log. */
  askNotes: string[]
  /** The validator's notes, for the eval (they may quote the model; never shown on a card). */
  problems: Problem[]
  /** What was rejected or failed, for the eval: a code, never the error's text. */
  fallback: 'no-model' | 'ask-failed' | 'unusable' | 'timeout' | null
  /** The candidates the model was (or would have been) shown. */
  candidates: Candidates
}

export const NO_MODEL_NOTE = "Picked without a model, from the talk's own signals."
export const MODEL_FAILED_NOTE = "The model did not answer, so these are picked from the talk's own signals."
export const MODEL_UNUSABLE_NOTE = "The model's answer could not be used, so these are picked from the talk's own signals."
export const MODEL_SLOW_NOTE = "The model took too long, so these are picked from the talk's own signals."
export const FILLED_NOTE = "Picked from the talk's own signals: the model's pick in its place could not be used."
export const TITLE_FALLBACK_NOTE = "The title is the clip's first sentence: the model's title said something the clip does not."
export const WHY_FALLBACK_NOTE = "The reason is the talk's own signal: the model's reason said something the clip does not."
export const TITLE_EMPTY_NOTE = "The title is the clip's first sentence: the model gave no title."
export const WHY_EMPTY_NOTE = "The reason is the talk's own signal: the model gave no reason."

/** The model note when `kept` of `wanted` picks were usable and the rest were filled. */
export function filledNote(kept: number, wanted: number): string {
  return kept === 0
    ? "None of the model's picks could be used, so these are picked from the talk's own signals."
    : `The model gave ${kept} usable pick${kept === 1 ? '' : 's'} of ${wanted}; the rest ${wanted - kept === 1 ? 'is' : 'are'} picked from the talk's own signals.`
}

/** Thrown inside the race when `timeoutMs` passes first. */
class AskTimeout extends Error {}

function cardOf(c: ClipCandidate, title: string, why: string, scoredBy: BestClipCard['scoredBy'], note?: string): BestClipCard {
  const w = c.window
  return { windowId: w.id, startMs: w.startMs, endMs: w.endMs, words: w.words, title, why, scoredBy, ...(note ? { note } : {}) }
}

const byTime = (a: BestClipCard, b: BestClipCard): number => a.startMs - b.startMs || a.endMs - b.endMs || (a.windowId < b.windowId ? -1 : a.windowId > b.windowId ? 1 : 0)

/** The signals' candidates, best first, that do not share more than half their time with any of `taken`, up to `room`. */
function fillFrom(c: Candidates, taken: readonly ClipCandidate[], room: number): ClipCandidate[] {
  const out: ClipCandidate[] = []
  for (const x of c.candidates) {
    if (out.length >= room) break
    // The id check is belt and braces: a candidate shares all its time with itself, so the overlap check drops it too.
    if ([...taken, ...out].some((k) => k.id === x.id || overlapShare(k.window, x.window) > MAX_OVERLAP)) continue
    out.push(x)
  }
  return out
}

/** The request the app sends for these candidates (the eval builds the same through `bestClips`). */
export function bestClipsRequest(candidates: Candidates['candidates'], lang: string): CompletionRequest {
  const { system, user } = bestClipsPrompt(candidates, lang)
  const wanted = picksWanted(candidates.length)
  return { system, user, schema: bestClipsSchema(candidates.map((x) => x.id)), maxTokens: maxTokensForBestClips(wanted) }
}

/**
 * Best clips for a transcript, the link's meta (its heatmap and language; null
 * when there is none) and a length in ms (60_000 … 240_000). `ask` absent
 * means no model. `options.timeoutMs`, when given, is how long the ask may
 * take before the signals' three are used.
 */
export async function bestClips(
  t: Transcript,
  meta: Pick<LinkMeta, 'heatmap' | 'language'> | null,
  targetMs: number,
  ask?: BestClipsAsk,
  options: { timeoutMs?: number } = {}
): Promise<BestClipsResult> {
  const c = candidatesFor(t, targetMs, meta?.heatmap ?? null)
  const wanted = Math.min(PICKS, c.candidates.length)
  const base = { targetMs, note: c.note, candidates: c, askNotes: [] as string[], problems: [] as Problem[] }
  const signalsOnly = (fallback: BestClipsResult['fallback'], modelNote: string | null, extra: Partial<BestClipsResult> = {}): BestClipsResult => ({
    ...base,
    ...extra,
    cards: c.candidates
      .slice(0, wanted)
      .map((x) => cardOf(x, x.title, x.why, 'signals'))
      .sort(byTime),
    modelNote,
    model: null,
    fallback
  })

  if (wanted === 0) return signalsOnly(ask ? null : 'no-model', null)
  if (!ask) return signalsOnly('no-model', NO_MODEL_NOTE)

  const lang = (meta?.language ?? '') || t.language || ''
  const request = bestClipsRequest(c.candidates, lang)
  let asked: Awaited<ReturnType<BestClipsAsk>>
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const pending = ask(request)
    asked =
      options.timeoutMs !== undefined && options.timeoutMs > 0
        ? await Promise.race([
            pending,
            new Promise<never>((_, fail) => {
              timer = setTimeout(() => fail(new AskTimeout()), options.timeoutMs)
            })
          ])
        : await pending
  } catch (err) {
    // The error's text is never kept: it could name a server, a URL or a key.
    return err instanceof AskTimeout ? signalsOnly('timeout', MODEL_SLOW_NOTE) : signalsOnly('ask-failed', MODEL_FAILED_NOTE)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  const askNotes = [...(asked.notes ?? [])]
  if ('error' in asked.answer) return signalsOnly('unusable', MODEL_UNUSABLE_NOTE, { askNotes })
  const verdict = validateBestClips(asked.answer.value, c, t)
  if ('rejected' in verdict) return signalsOnly('unusable', MODEL_UNUSABLE_NOTE, { askNotes, problems: [{ path: '$', message: verdict.rejected }] })

  const modelCards = verdict.picks.map((p: ValidPick) => {
    const notes = [
      p.titleFallback === 'empty' ? TITLE_EMPTY_NOTE : p.titleFallback === 'ungrounded' ? TITLE_FALLBACK_NOTE : '',
      p.whyFallback === 'empty' ? WHY_EMPTY_NOTE : p.whyFallback === 'ungrounded' ? WHY_FALLBACK_NOTE : ''
    ].filter(Boolean)
    return cardOf(p.candidate, p.title, p.why, 'model', notes.length ? notes.join(' ') : undefined)
  })
  const filled = fillFrom(
    c,
    verdict.picks.map((p) => p.candidate),
    wanted - verdict.picks.length
  ).map((x) => cardOf(x, x.title, x.why, 'signals', FILLED_NOTE))
  const used = verdict.picks.length > 0
  return {
    ...base,
    askNotes,
    problems: verdict.problems,
    cards: [...modelCards, ...filled].sort(byTime),
    modelNote: verdict.picks.length < wanted ? filledNote(verdict.picks.length, wanted) : null,
    model: used ? asked.model : null,
    fallback: null
  }
}
