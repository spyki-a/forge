import { describe, expect, it } from 'vitest'
import { bestClips, bestClipsRequest } from '@shared/bestclips/run'
import { bestClipsAskOver, modelReady } from '@shared/bestclips/session'
import { candidatesFor } from '@shared/bestclips/signals'
import {
  BEST_CLIPS_CHECK_CASES,
  BEST_CLIPS_STUB_CASES,
  caseFailures,
  CLIP_IT_CASE_NAMES,
  STUB_READY,
  seenOf,
  stubComplete,
  stubCount,
  stubIds,
  stubTalk,
  STUB_SECRET_KEY,
  STUB_SECRET_URL,
  type StubCalls
} from '../../src/renderer/src/harness/bestClipsStub'

/*
 * The harness's Best clips cases (docs/CLIPS.md §7.7's cards half), run here
 * through `bestClips` itself with the harness's model stub: every case the
 * page's check (harness/bestClipsCheck.ts) drives through the store and the
 * panel must already hold on the result, so a failure on the page is the
 * page's (the store, the panel), never a case that could not have passed.
 */

describe('the harness model stub', () => {
  it('reads the ids from the schema enum (best first) and the count from minItems', () => {
    const t = stubTalk()
    const c = candidatesFor(t, 60_000, null)
    const request = bestClipsRequest(c.candidates, 'en')
    expect(stubIds(request)).toEqual(c.candidates.map((x) => x.id))
    expect(stubCount(request)).toBe(3)
    const two = bestClipsRequest(c.candidates.slice(0, 2), 'en')
    expect(stubCount(two)).toBe(2)
  })

  it('a stub that throws carries an address and a key; bestClips keeps neither', async () => {
    const k = BEST_CLIPS_STUB_CASES.find((x) => x.model === 'throws')!
    const link = k.link()
    const calls: StubCalls = { n: 0 }
    const result = await bestClips(link.transcript, { heatmap: link.heatmap, language: link.language }, link.targetMs, bestClipsAskOver(stubComplete('throws', link, calls)))
    expect(calls.n).toBe(1)
    const all = JSON.stringify(result)
    expect(all).not.toContain(STUB_SECRET_URL)
    expect(all).not.toContain(STUB_SECRET_KEY)
  })
})

describe('every harness case holds on bestClips’ own result', () => {
  for (const k of BEST_CLIPS_STUB_CASES) {
    it(k.name, async () => {
      const link = k.link()
      const ask = k.model === null ? undefined : bestClipsAskOver(stubComplete(k.model, link))
      const run = () => bestClips(link.transcript, { heatmap: link.heatmap, language: link.language }, link.targetMs, ask, { timeoutMs: k.model === 'never' ? 50 : 5_000 })
      const result = await run()
      const seen = seenOf(result)
      expect(caseFailures(k, seen, result.candidates, link.transcript)).toEqual([])
      if (k.twice) expect(seenOf(await run()).cards.map((x) => x.windowId)).toEqual(seen.cards.map((x) => x.windowId))
    })
  }
})

describe('what the page check runs', () => {
  it('is 29 card cases and 7 Clip it cases, 36 in all: the number the session reads', () => {
    // Pinned here, not derived on the page from the same arrays (emptied arrays would read { ok: true, cases: [] } there).
    expect(BEST_CLIPS_STUB_CASES).toHaveLength(29)
    expect(CLIP_IT_CASE_NAMES).toHaveLength(7)
    expect(BEST_CLIPS_CHECK_CASES).toBe(36)
    expect(new Set([...BEST_CLIPS_STUB_CASES.map((k) => k.name), ...CLIP_IT_CASE_NAMES]).size).toBe(36)
  })

  it('the stub’s status is a ready model whatever the director setting is', () => {
    for (const choice of ['auto', 'ollama', 'openai'] as const) expect(modelReady(STUB_READY, choice), choice).toBe(true)
  })
})
