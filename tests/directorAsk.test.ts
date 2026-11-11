import { describe, expect, it } from 'vitest'
import { JSON_ONLY_NUDGE, THINKING_EXTRA_TOKENS, askStructured } from '@shared/director/ask'
import type { CompletionRequest, CompletionResult } from '@shared/director/provider'

/**
 * The one retry (shared/director/ask.ts): thinking off first; prose back and
 * not cut off → once more with thinking on and more room. Both the spine and
 * the look pass ask through it, so the Ollama `think: false` bug cannot be
 * handled in one and forgotten in the other.
 */

const result = (text: string, truncated = false, provider: CompletionResult['provider'] = 'ollama'): CompletionResult => ({
  text, provider, model: 'm', promptTokens: 1, outputTokens: 1, durationMs: 1, truncated
})

function fake(answers: CompletionResult[]): { complete: (r: CompletionRequest) => Promise<CompletionResult>; asked: CompletionRequest[] } {
  const asked: CompletionRequest[] = []
  return {
    asked,
    complete: async (r) => {
      asked.push(r)
      return answers[asked.length - 1]
    }
  }
}

const request: CompletionRequest = { system: 's', user: 'u', schema: {}, maxTokens: 500 }

describe('askStructured', () => {
  it('asks once, thinking off, when the answer is JSON', async () => {
    const f = fake([result('{"a":1}')])
    const out = await askStructured(f.complete, request)
    expect(f.asked).toHaveLength(1)
    expect(f.asked[0].think).toBe(false)
    expect(out.parsed).toEqual({ value: { a: 1 } })
    expect(out.notes).toEqual([])
  })

  it('asks again with thinking on and more room when prose came back', async () => {
    const f = fake([result('Sure! Here is a plan.'), result('{"a":2}')])
    let retried = 0
    const out = await askStructured(f.complete, request, () => retried++)
    expect(f.asked.map((r) => r.think)).toEqual([false, true])
    expect(f.asked[1].maxTokens).toBe(500 + THINKING_EXTRA_TOKENS)
    expect(retried).toBe(1)
    expect(out.parsed).toEqual({ value: { a: 2 } })
    expect(out.notes[0]).toMatch(/asked again with thinking on/)
  })

  it('on the OpenAI shape the retry appends the nudge as the last line and keeps the raised room (docs/CLIPS.md §6.6)', async () => {
    const f = fake([result('Sure! Here is a plan.', false, 'openai'), result('{"a":3}', false, 'openai')])
    const out = await askStructured(f.complete, request)
    expect(f.asked).toHaveLength(2)
    // The first ask is the caller's prompt untouched; only the retry carries the line.
    expect(f.asked[0].user).toBe('u')
    expect(f.asked[1].user).toBe(`u\n${JSON_ONLY_NUDGE}`)
    expect(f.asked[1].user.split('\n').at(-1)).toBe('Answer with the JSON object only.')
    expect(f.asked[1].maxTokens).toBe(500 + THINKING_EXTRA_TOKENS)
    expect(f.asked[1].system).toBe('s')
    expect(out.parsed).toEqual({ value: { a: 3 } })
    expect(out.notes[0]).toMatch(/asked again for the JSON object only/)
  })

  it('on the Ollama shape the retry is unchanged: thinking on, the same user prompt, more room', async () => {
    const f = fake([result('Sure! Here is a plan.'), result('{"a":4}')])
    await askStructured(f.complete, request)
    expect(f.asked[1]).toEqual({ ...request, maxTokens: 500 + THINKING_EXTRA_TOKENS, think: true })
    expect(f.asked[1].user).not.toContain(JSON_ONLY_NUDGE)
  })

  it('does not ask again when the answer was only cut off — more thinking would not fit either', async () => {
    const f = fake([result('{"a": [1, 2', true)])
    const out = await askStructured(f.complete, request)
    expect(f.asked).toHaveLength(1)
    expect('error' in out.parsed).toBe(true)
  })
})
