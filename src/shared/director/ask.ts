import { parseModelJson, type CompletionRequest, type CompletionResult } from './provider'

/**
 * One structured question to a model, with the one retry this project knows it needs.
 *
 * Ollama has an open bug where `think: false` makes it drop the schema for
 * Gemma 4 and Qwen 3.5 (ollama/ollama #15260, #14645), and the answer comes
 * back as prose. So: ask with thinking off; if prose came back and the answer
 * was not simply cut off, ask once more with thinking on and more room.
 * Thinking costs seconds; the alternative is the fallback every time, looking
 * like a model failure.
 *
 * Every caller that asks a model for JSON goes through this — the spine, the
 * look pass and the graphics pass alike (docs/PLAN.md §4.1, docs/CLIPS.md
 * §6.6) — so the recovery cannot be present in one and forgotten in the other.
 *
 * On the OpenAI shape thinking on changes nothing: `openaiRequestBody` never
 * sends `think` (provider.ts), so on LM Studio the "retry" would be the same
 * request with more room. When the FIRST result's `provider` is 'openai', the
 * retry also appends `JSON_ONLY_NUDGE` to the user prompt, as its own last
 * line, keeping the raised `maxTokens` (docs/CLIPS.md §6.6, "The ask").
 */

/** The line the OpenAI-shaped retry appends to the user prompt (§6.6). */
export const JSON_ONLY_NUDGE = 'Answer with the JSON object only.'

/** How much more room the second, thinking, attempt gets. */
export const THINKING_EXTRA_TOKENS = 800

export interface Asked {
  result: CompletionResult
  /** The parsed JSON, or why there is none. */
  parsed: { value: unknown } | { error: string }
  /** What happened on the way, for the notice. */
  notes: string[]
}

export async function askStructured(
  complete: (request: CompletionRequest) => Promise<CompletionResult>,
  request: CompletionRequest,
  onRetry?: () => void
): Promise<Asked> {
  const notes: string[] = []
  let result = await complete({ ...request, think: false })
  let parsed = parseModelJson(result.text)
  if ('error' in parsed && !result.truncated) {
    onRetry?.()
    const openai = result.provider === 'openai'
    notes.push(
      openai
        ? `the first answer was not JSON (${parsed.error}) — asked again for the JSON object only`
        : `the first answer was not JSON (${parsed.error}) — asked again with thinking on`
    )
    result = await complete({
      ...request,
      ...(openai ? { user: `${request.user}\n${JSON_ONLY_NUDGE}` } : {}),
      maxTokens: (request.maxTokens ?? 0) > 0 ? request.maxTokens! + THINKING_EXTRA_TOKENS : request.maxTokens,
      think: true
    })
    parsed = parseModelJson(result.text)
  }
  return { result, parsed, notes }
}
