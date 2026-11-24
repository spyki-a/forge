import { graphicsLanguageLine } from '../director/promptGraphics'
import { THINKING_EXTRA_TOKENS } from '../director/ask'
import type { ClipCandidate } from './signals'
import { PICKS, TITLE_KEPT_GRAPHEMES, WHY_KEPT_GRAPHEMES, picksWanted } from './schema'

/**
 * What the model is told for `bestclips@1` (docs/CLIPS.md §7.4).
 *
 * The system prompt is one constant, the same for every video, so a server
 * caches it once. The user prompt is the CANDIDATES table (an id and the
 * condensed text, nothing else: no time, no length, no score, so the model
 * has no time to copy and no signal to echo), how many to pick, and the
 * language line LAST (`promptGraphics.ts`' `graphicsLanguageLine`: the
 * measured line that took Telugu and Hindi copy to the target script, or
 * "the language of the sentences" when the link names none).
 *
 * The candidates are listed in the prefilter's order, best by the signals
 * first. A small model favours what it reads first; listed by time, that
 * would favour a video's opening, which is rarely its best minute, while
 * listed best first the bias leans the way the signals already lean. The ten
 * links (§7.8) judge it.
 *
 * THE BUDGET (§7.4's arithmetic). The density measured on Gemma 4 E2B is 3.0
 * to 3.55 UTF-16 characters a prompt token, from the recorded spine runs
 * (English). `promptTokensAtMost` counts at the LOW end, 3.0, so it never
 * undercounts English. Twenty-four candidates at `CONDENSED_MAX_CHARS` (240
 * characters, 80 tokens) and their framing are 2,071 tokens; this system text
 * 317; the answer `maxTokensForBestClips(3)` = 950. 3,338 in all (measured
 * 2026-11-23 on 24 rows of 240 characters and the Telugu language line),
 * inside `PROMPT_BUDGET_TOKENS` (4,096), and with askStructured's thinking
 * retry (`THINKING_EXTRA_TOKENS` more) inside `NUM_CTX` (8,192, provider.ts'
 * `num_ctx`). tests/bestClipsModel.test.ts holds both for 24 candidates of the
 * longest condensed text. Devanagari and Telugu tokenise denser than English
 * and are unmeasured (open); at the worst plausible one character a token the
 * prompts are 7,164 tokens and the answer 950: 8,114, inside 8,192 with 78 to
 * spare, but not the thinking retry's.
 */

/** Ollama's context for every request (provider.ts `ollamaRequestBody`, `num_ctx`). */
export const NUM_CTX = 8192

/** The prompt and the answer together stay within this (§7.4: "about 3k tokens"), leaving the thinking retry room inside `NUM_CTX`. */
export const PROMPT_BUDGET_TOKENS = 4096

/** UTF-16 characters a prompt token, the low end of the measured 3.0 to 3.55 (Gemma 4 E2B, English). */
export const CHARS_PER_TOKEN = 3.0

/** An upper estimate of a text's prompt tokens at `CHARS_PER_TOKEN` (English; Indic scripts unmeasured). */
export function promptTokensAtMost(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export const BEST_CLIPS_SYSTEM = `You pick the best short clips from a long video. You are given CANDIDATES: stretches of the video's talk, each an id and a few of its sentences. You compare them with each other and pick the ones a viewer would most want to watch on their own, as a short post: a clear point, a story, a strong opinion, a surprise, something that makes sense without the rest of the video. You answer with one JSON object and nothing else.

RULES
- Compare the candidates with each other; do not score them one by one.
- id: one id from CANDIDATES. Never the same id twice.
- title: a short title for the clip, at most ${TITLE_KEPT_GRAPHEMES} characters, in the language the candidate is spoken in.
- why: why a viewer would watch this clip on its own, at most ${WHY_KEPT_GRAPHEMES} characters, in the same language.
- Never write a time, a timestamp or a length.
- Never write a number or a name that the candidate's words do not say.
- reasoning comes first: one or two sentences comparing the candidates.`

/** The line that says how many to pick. */
export function pickLine(wanted: number): string {
  return wanted === 1 ? 'Pick the 1 candidate a viewer would most want to watch on its own.' : `Pick the ${wanted} candidates a viewer would most want to watch on their own, each a different id.`
}

/**
 * The two prompts for a menu of candidates (already the prefilter's, best
 * first) and the link's language (a code such as 'te' or 'hi-IN', a name, or
 * '' / 'und' when none is known).
 */
export function bestClipsPrompt(candidates: readonly Pick<ClipCandidate, 'id' | 'condensed'>[], lang: string): { system: string; user: string } {
  const lines: string[] = []
  lines.push('CANDIDATES (id, then a few of its sentences)')
  // JSON.stringify quotes the text and escapes a quote or a backslash in it, so a candidate's words cannot close its row.
  for (const c of candidates) lines.push(`${c.id}  ${JSON.stringify(c.condensed)}`)
  lines.push('')
  lines.push(pickLine(picksWanted(candidates.length)))
  lines.push('')
  lines.push(graphicsLanguageLine(lang))
  return { system: BEST_CLIPS_SYSTEM, user: lines.join('\n') }
}

/**
 * Room for the answer: 200 tokens for the wrapper and the reasoning (300
 * characters, ~100 tokens of English, and the keys), and 250 a pick. An
 * English pick is about 85 (the keys, an id, a 60-character title at ~20 and a
 * 120-character why at ~40); the rest is for a Devanagari or Telugu title and
 * why, whose tokens are unmeasured and whose decode limits are three code
 * points a grapheme (`schema.ts`). 950 for three. Recalibrated from the eval,
 * as `maxTokensForGraphics` is to be.
 */
export function maxTokensForBestClips(wanted: number = PICKS): number {
  return 200 + 250 * Math.max(1, wanted)
}

/** The whole request's tokens at most: the prompts at `CHARS_PER_TOKEN` and the answer's room (the thinking retry's extra not counted). */
export function requestTokensAtMost(prompt: { system: string; user: string }, wanted: number): number {
  return promptTokensAtMost(prompt.system) + promptTokensAtMost(prompt.user) + maxTokensForBestClips(wanted)
}

export { THINKING_EXTRA_TOKENS }
