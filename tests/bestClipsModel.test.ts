import { describe, expect, it } from 'vitest'
import { conforms, flatViolations, unsupportedKeywords, type ObjectSchema } from '@shared/director/conforms'
import { ollamaRequestBody, openaiRequestBody } from '@shared/director/provider'
import { THINKING_EXTRA_TOKENS } from '@shared/director/ask'
import { UNDETERMINED_LINE, graphicsLanguageLine } from '@shared/director/promptGraphics'
import {
  BEST_CLIPS_DECODE_CHARS,
  PICKS,
  TITLE_KEPT_GRAPHEMES,
  WHY_KEPT_GRAPHEMES,
  bestClipsSchema,
  picksWanted
} from '@shared/bestclips/schema'
import {
  BEST_CLIPS_SYSTEM,
  NUM_CTX,
  PROMPT_BUDGET_TOKENS,
  bestClipsPrompt,
  pickLine,
  maxTokensForBestClips,
  promptTokensAtMost,
  requestTokensAtMost
} from '@shared/bestclips/prompt'
import { ungroundedIn, validateBestClips } from '@shared/bestclips/validate'
import {
  FILLED_NOTE,
  MODEL_FAILED_NOTE,
  MODEL_SLOW_NOTE,
  MODEL_UNUSABLE_NOTE,
  NO_MODEL_NOTE,
  TITLE_EMPTY_NOTE,
  TITLE_FALLBACK_NOTE,
  WHY_EMPTY_NOTE,
  WHY_FALLBACK_NOTE,
  bestClips,
  bestClipsRequest,
  filledNote,
  type BestClipsAsk
} from '@shared/bestclips/run'
import { CONDENSED_MAX_CHARS, MAX_CANDIDATES, candidatesFor, graphemes, windowText, type ClipCandidate } from '@shared/bestclips/signals'
import type { Transcript } from '@shared/transcript'
import { bestClipsFixtures, caseless, heatOf, latin, sentencesOf, talk, transcriptOf } from './eval/bestClipsFixtures'
import {
  bestClipsFigures,
  bestClipsRequestId,
  bestClipsRequestsFor,
  bestClipsScoreRefusal,
  scoreBestClipsFixture
} from './eval/bestClipsEval'
import { credentialsIn } from './eval/graphicsEval'
import type { EvalResponse } from './eval/pipeline'

/*
 * Best clips, piece 2 (docs/CLIPS.md §7.4's second half): the schema of the
 * one comparative call, its prompt and budget, the validator, `bestClips`
 * (run.ts, shared with the eval) and the eval's prepare and score steps. Every
 * transcript is built here from made-up words: Latin nonsense, and a caseless
 * script (Georgian Mkhedruli code points, written as escapes). No model, no
 * network.
 */

/* ------------------------------------------------------------- fixtures */

/** A punctuated talk of 60 sentences (~3.7 s each) with a name and numbers said in known places. */
const NAMED: Record<number, string[]> = {
  2: ['Zorvan', 'plim', 'tavek', 'mubo', '2,500', 'senra', 'kilo', 'drav'],
  20: ['brel', 'gandu', 'vestra', '40%', 'oppen', 'zor', 'plim', 'nim', 'rulo'],
  41: ['tavek', 'Oskiri', 'mubo', 'senra', 'twelve', 'kilo', 'drav', 'oppen']
}
const EN: Transcript = transcriptOf(talk(sentencesOf(60, latin, 21, NAMED)), 'en')
const EN_C = candidatesFor(EN, 60_000, null)

/** A caseless, unpunctuated talk. */
const CL: Transcript = transcriptOf(talk(sentencesOf(70, caseless, 22), ''), 'und')
const CL_C = candidatesFor(CL, 60_000, null)

const answerOf = (picks: { id: string; title: string; why: string }[]): { reasoning: string; picks: typeof picks } => ({ reasoning: 'compared', picks })

/** An ask that answers `value` as the app's askStructured would hand it over. */
const answering = (value: unknown, seen: { requests: unknown[] } = { requests: [] }): BestClipsAsk => async (request) => {
  seen.requests.push(request)
  return { answer: { value, truncated: false }, model: { id: 'stub', runtime: 'openai' }, notes: [] }
}

/** The candidate whose window text contains `word`, as a bare token. */
function candidateSaying(c: readonly ClipCandidate[], t: Transcript, word: string): ClipCandidate {
  const found = c.find((x) => windowText(t, x.window).split(' ').some((w) => w.replace(/[.,]$/u, '') === word))
  if (!found) throw new Error(`no candidate says ${word}`)
  return found
}

/* ---------------------------------------------------------------- schema */

describe('bestClipsSchema: one flat comparative call (§7.4)', () => {
  const ids = EN_C.candidates.map((c) => c.id)

  it('is flat and inside conforms.ts\' subset (both providers\' rule), constrained or not, reasoning first, and names no time', () => {
    // MUTATION (the pick object's additionalProperties: false -> true as never): fails "expect(flatViolations(s)).toEqual([])".
    // MUTATION (a `start` field added to the pick): fails the not.toContain('start') loop and the required order.
    expect(ids.length).toBeGreaterThanOrEqual(PICKS)
    for (const constrained of [true, false]) {
      const s = bestClipsSchema(ids, { constrained })
      expect(unsupportedKeywords(s)).toEqual([])
      expect(flatViolations(s)).toEqual([])
      expect(Object.keys(s.properties)).toEqual(['reasoning', 'picks'])
      expect(s.required).toEqual(['reasoning', 'picks'])
      const pick = (s.properties.picks as { items: ObjectSchema }).items
      expect(Object.keys(pick.properties)).toEqual(['id', 'title', 'why'])
      expect(pick.required).toEqual(['id', 'title', 'why'])
      const names = JSON.stringify(s)
      for (const never of ['start', 'end', 'startMs', 'endMs', 'time', 'seconds', 'duration', 'score', 'rank']) {
        expect(names, `the schema offers '${never}'`).not.toContain(`"${never}"`)
      }
    }
  })

  it('conforms accepts a good three-pick answer and refuses four picks, two picks and an id outside the enum', () => {
    // MUTATION (minItems dropped from the constrained schema): fails the two-pick refusal.
    // MUTATION (maxItems dropped): fails the four-pick refusal. MUTATION (the id enum dropped): fails the off-menu refusal.
    const s = bestClipsSchema(ids)
    const good = answerOf(ids.slice(0, 3).map((id) => ({ id, title: 'plim tavek', why: 'it lands' })))
    expect(conforms(s, good)).toEqual([])
    const four = answerOf(ids.slice(0, 4).map((id) => ({ id, title: 't', why: 'w' })))
    expect(conforms(s, four).map((p) => p.message)).toContain('has 4 items, at most 3 allowed')
    const two = answerOf(ids.slice(0, 2).map((id) => ({ id, title: 't', why: 'w' })))
    expect(conforms(s, two).map((p) => p.message)).toContain('has 2 items, needs at least 3')
    const off = answerOf([{ id: 'w9999', title: 't', why: 'w' }, ...ids.slice(1, 3).map((id) => ({ id, title: 't', why: 'w' }))])
    expect(conforms(s, off).map((p) => p.path)).toEqual(['$.picks[0].id'])
    // Decode headroom: three code points a kept grapheme (an Indic cluster), reasoning the spine's 300.
    const pick = (s.properties.picks as { items: ObjectSchema }).items.properties as Record<string, { maxLength?: number }>
    expect([pick.title.maxLength, pick.why.maxLength, (s.properties.reasoning as { maxLength: number }).maxLength]).toEqual([
      BEST_CLIPS_DECODE_CHARS.title,
      BEST_CLIPS_DECODE_CHARS.why,
      300
    ])
    expect(BEST_CLIPS_DECODE_CHARS.title).toBeGreaterThan(TITLE_KEPT_GRAPHEMES)
    expect(BEST_CLIPS_DECODE_CHARS.why).toBeGreaterThan(WHY_KEPT_GRAPHEMES)
    // Unconstrained: no enum, no length, no count, so the validator repairs one pick at a time.
    expect(JSON.stringify(bestClipsSchema(ids, { constrained: false }))).not.toMatch(/"enum"|"maxLength"|"minItems"|"maxItems"/u)
  })

  it('asks for no more picks than there are candidates, and cannot be built for none', () => {
    // MUTATION (picksWanted returns PICKS whatever the count): fails "toEqual([0, 1, 2, 3, 3])" and the two-candidate minItems.
    expect([0, 1, 2, 3, 24].map(picksWanted)).toEqual([0, 1, 2, 3, 3])
    const s = bestClipsSchema(['w1', 'w4'])
    expect(s.properties.picks).toMatchObject({ minItems: 2, maxItems: 2 })
    expect(() => bestClipsSchema([])).toThrow('at least one candidate')
  })
})

/* ---------------------------------------------------------------- prompt */

describe('bestClipsPrompt: ids and condensed text only, the language line last, inside its budget', () => {
  it('lists every candidate as id and quoted text, best first, with no time; the pick count; the language line last', () => {
    // MUTATION (each row also shows the window's start as m:ss, promptGraphics' clockOf): fails "not.toMatch(/\d+:\d\d/)".
    // MUTATION (rows sorted by id instead of the prefilter's order): fails the row-order toEqual.
    const { system, user } = bestClipsPrompt(EN_C.candidates, 'en')
    expect(system).toBe(BEST_CLIPS_SYSTEM)
    const lines = user.split('\n')
    expect(lines[0]).toBe('CANDIDATES (id, then a few of its sentences)')
    const rows = lines.slice(1, 1 + EN_C.candidates.length)
    expect(rows).toEqual(EN_C.candidates.map((c) => `${c.id}  ${JSON.stringify(c.condensed)}`))
    expect(user).not.toMatch(/\d+:\d\d/u)
    expect(lines).toContain('Pick the 3 candidates a viewer would most want to watch on their own, each a different id.')
    expect(lines[lines.length - 1]).toBe('Write all copy in English.')
    expect(bestClipsPrompt(CL_C.candidates, 'und').user.split('\n').pop()).toBe(UNDETERMINED_LINE)
    // A quote inside a candidate's words cannot close its row.
    const tricky = bestClipsPrompt([{ id: 'w1', condensed: 'plim "zor" tavek' }], 'en').user
    expect(tricky).toContain('w1  "plim \\"zor\\" tavek"')
  })

  it('24 candidates of the longest condensed text, the system text and the answer fit PROMPT_BUDGET_TOKENS, and with the thinking retry, num_ctx', () => {
    // MUTATION (maxTokensForBestClips -> 200 + 1500 a pick): fails "toBeLessThanOrEqual(PROMPT_BUDGET_TOKENS)".
    // MUTATION (NUM_CTX 8192 -> 16384): fails the agreement with provider.ts' num_ctx.
    const longest = Array.from({ length: MAX_CANDIDATES }, (_, i) => ({ id: `w${100 + i}`, condensed: 'x'.repeat(CONDENSED_MAX_CHARS) }))
    const prompt = bestClipsPrompt(longest, 'te')
    const total = requestTokensAtMost(prompt, 3)
    console.log(
      `bestclips@1 budget: system ${promptTokensAtMost(prompt.system)} + user ${promptTokensAtMost(prompt.user)} + answer ${maxTokensForBestClips(3)} = ${total} tokens at 3.0 chars a token (budget ${PROMPT_BUDGET_TOKENS}, num_ctx ${NUM_CTX}); at 1 char a token the prompt alone is ${prompt.system.length + prompt.user.length}`
    )
    expect(total).toBeLessThanOrEqual(PROMPT_BUDGET_TOKENS)
    expect(total + THINKING_EXTRA_TOKENS).toBeLessThanOrEqual(NUM_CTX)
    // Even at a worst-case one character a token (Indic, unmeasured) the prompt and the answer fit num_ctx.
    expect(prompt.system.length + prompt.user.length + maxTokensForBestClips(3)).toBeLessThanOrEqual(NUM_CTX)
    const body = ollamaRequestBody({ system: prompt.system, user: prompt.user, schema: {}, maxTokens: 1 }, [], 'm') as { options: { num_ctx: number } }
    expect(body.options.num_ctx).toBe(NUM_CTX)
  })
})

/* -------------------------------------------------------------- validate */

describe('ungroundedIn: every number and capitalised token in the window; a caseless title word for word', () => {
  const said = 'zor plim Zorvan tavek $2,500 mubo 40 clients twelve senra kilo'

  it('a title number must be said as that number: bare digits ground on a currency, a percent does not ground on a count, a time or a range not said fails', () => {
    // MUTATION (the numbers check skipped: numberSpans' loop removed): fails "toEqual(['3,000'])" and the 40% case.
    expect(ungroundedIn('Plim 2,500 tavek', said, 'title')).toEqual([])
    expect(ungroundedIn('Plim 2500 dollars', said, 'title')).toEqual([])
    expect(ungroundedIn('Plim 3,000 tavek', said, 'title')).toEqual(['3,000'])
    expect(ungroundedIn('zor 40% mubo', said, 'title')).toEqual(['40%'])
    expect(ungroundedIn('Twelve senra', said, 'title')).toEqual([])
    expect(ungroundedIn('zor 12 senra', said, 'title')).toEqual([])
    expect(ungroundedIn('zor at 12:30', said, 'title')).toEqual(['12:30'])
    expect(ungroundedIn('zor 40-50 kilo', said, 'title')).toEqual(['40-50'])
  })

  it('every capitalised token, the first word included, must be said (case-blind), a possessive allowed', () => {
    // MUTATION (the first word exempt from the capital rule, `i > 0 &&`): fails "toEqual(['Kesmer'])".
    expect(ungroundedIn('Kesmer admits failure', said, 'title')).toEqual(['Kesmer'])
    expect(ungroundedIn('Plim tavek Zorvan', said, 'title')).toEqual([])
    expect(ungroundedIn("Zorvan's mubo", said, 'title')).toEqual([])
    expect(ungroundedIn('zor and NASA', said, 'title')).toEqual(['NASA'])
    // A lower-case Latin word is not checked (the plan's rule): open for romanised Hindi.
    expect(ungroundedIn('zor gleebish tavek', said, 'title')).toEqual([])
  })

  it('a caseless title is held word for word; Hinglish gets each rule by its word\'s script', () => {
    // MUTATION (the caseless rule removed, `caseless` always false): fails "toEqual([made])" and the Hinglish line.
    const words = [caseless(1), caseless(2), caseless(3), caseless(4)]
    const saidCl = `${words.join(' ')} 7`
    expect(ungroundedIn(`${words[2]} ${words[0]}`, saidCl, 'title')).toEqual([])
    const made = '\u10E0\u10E2\u10E4'
    expect(saidCl.includes(made)).toBe(false)
    expect(ungroundedIn(`${words[0]} ${made}`, saidCl, 'title')).toEqual([made])
    expect(ungroundedIn(`${words[0]} 7`, saidCl, 'title')).toEqual([])
    expect(ungroundedIn(`${words[0]} 8`, saidCl, 'title')).toEqual(['8'])
    // Hinglish-shaped: Latin and caseless words mixed.
    const mixed = `zor ${words[1]} Zorvan ${words[3]}`
    expect(ungroundedIn(`${words[1]} Zorvan plimmo`, mixed, 'title')).toEqual([])
    expect(ungroundedIn(`${made} Zorvan`, mixed, 'title')).toEqual([made])
    expect(ungroundedIn(`${words[1]} Kesmer`, mixed, 'title')).toEqual(['Kesmer'])
    // A why is a judgement: its caseless words are not held to the window, its numbers are.
    expect(ungroundedIn(`${made} ${words[0]}`, saidCl, 'why')).toEqual([])
    expect(ungroundedIn(`${made} 9`, saidCl, 'why')).toEqual(['9'])
  })

  it('a why: its numbers, and a capital that does not open one of its sentences', () => {
    // MUTATION (the why's sentence-opening exemption removed): fails "ungroundedIn('It is funny and honest. ...')" toEqual([]).
    expect(ungroundedIn('It is funny and honest. A story about Zorvan.', said, 'why')).toEqual([])
    expect(ungroundedIn('A story about Kesmer and 40 clients.', said, 'why')).toEqual(['Kesmer'])
    expect(ungroundedIn('It has 90 clients.', said, 'why')).toEqual(['90'])
  })
})

describe('validateBestClips: the picks, the titles and the whys a card may show', () => {
  const [a, b, c, d] = EN_C.candidates

  it('keeps grounded picks in the answer\'s order; drops an id off the menu, an id twice and picks beyond three', () => {
    // MUTATION (the duplicate check removed; the overlap check then drops the second a.id under its own words): fails "toBe(`'${a.id}' is picked twice`)".
    // MUTATION (the off-menu check removed, `byId.get` defaulting to the first candidate): fails "toBe(\"'w9999' is not one of the candidates\")".
    const v = validateBestClips(
      answerOf([
        { id: a.id, title: 'plim', why: 'it lands' },
        { id: 'w9999', title: 'plim', why: 'it lands' },
        { id: a.id, title: 'plim', why: 'it lands' },
        { id: b.id, title: 'plim', why: 'it lands' },
        { id: c.id, title: 'plim', why: 'it lands' },
        { id: d.id, title: 'plim', why: 'it lands' }
      ]),
      EN_C,
      EN
    )
    if ('rejected' in v) throw new Error(v.rejected)
    expect(v.picks.map((p) => p.id)).toEqual([a.id, b.id, c.id])
    expect(v.problems.map((p) => p.path)).toEqual(['$.picks[1].id', '$.picks[2].id', '$.picks[5]'])
    expect(v.problems[0].message).toBe("'w9999' is not one of the candidates")
    expect(v.problems[1].message).toBe(`'${a.id}' is picked twice`)
  })

  it('a pick sharing more than half its time with an earlier pick is dropped, the first kept', () => {
    // MUTATION (the overlap check removed): fails "toEqual(['w1'])".
    const base = EN_C.candidates[0]
    const overlapping: ClipCandidate = { ...base, id: 'wX', window: { ...base.window, id: 'wX', startMs: base.window.startMs + 1000, endMs: base.window.endMs + 1000 } }
    const v = validateBestClips(answerOf([{ id: base.id, title: 'plim', why: 'w' }, { id: 'wX', title: 'plim', why: 'w' }]), { candidates: [base, overlapping] }, EN)
    if ('rejected' in v) throw new Error(v.rejected)
    expect(v.picks.map((p) => p.id)).toEqual([base.id])
    expect(v.problems[0].message).toContain('shares more than half its time')
  })

  it('a title with a number not in its window, or a first-word name not in it, falls back to the first sentence cut to 40; a grounded one is kept', () => {
    // MUTATION (validate keeps the model's title whatever ungroundedIn says): fails the two titleFrom 'first-sentence' expectations.
    const withName = candidateSaying(EN_C.candidates, EN, 'Zorvan')
    const v = validateBestClips(
      answerOf([
        { id: withName.id, title: 'Zorvan plim 2,500', why: 'grounded' },
        ...EN_C.candidates
          .filter((x) => x.id !== withName.id)
          .slice(0, 2)
          .map((x, i) => ({ id: x.id, title: i === 0 ? 'Plim 7,777 tavek' : 'Kesmer admits failure', why: 'w' }))
      ]),
      EN_C,
      EN
    )
    if ('rejected' in v) throw new Error(v.rejected)
    expect(v.picks.map((p) => [p.titleFrom, p.title])).toEqual([
      ['model', 'Zorvan plim 2,500'],
      ['first-sentence', v.picks[1].candidate.title],
      ['first-sentence', v.picks[2].candidate.title]
    ])
    expect(graphemes(v.picks[1].title).length).toBeLessThanOrEqual(40)
    expect(v.problems.map((p) => p.message)).toEqual([
      expect.stringContaining("says '7,777'"),
      expect.stringContaining("says 'Kesmer'")
    ])
  })

  it('the caseless rule over real windows: words of the window reordered are kept, one made-up word falls back', () => {
    // MUTATION (the caseless rule removed): fails "toEqual(['model', 'first-sentence'])".
    const [x, y] = CL_C.candidates
    const xs = windowText(CL, x.window).split(' ')
    const made = '\u10E0\u10E2\u10E4\u10E0'
    expect(windowText(CL, y.window).split(' ')).not.toContain(made)
    const v = validateBestClips(
      answerOf([
        { id: x.id, title: `${xs[3]} ${xs[0]}`, why: 'w' },
        { id: y.id, title: `${made} ${windowText(CL, y.window).split(' ')[0]}`, why: 'w' }
      ]),
      CL_C,
      CL
    )
    if ('rejected' in v) throw new Error(v.rejected)
    expect(v.picks.map((p) => p.titleFrom)).toEqual(['model', 'first-sentence'])
  })

  it('keeps a title to 60 graphemes and a why to 120 (cut between words); an empty title or why falls back; an ungrounded why takes the signals\' line', () => {
    // MUTATION (TITLE_KEPT_GRAPHEMES 60 -> 600): fails "toBeLessThanOrEqual(TITLE_KEPT_GRAPHEMES)".
    const long = Array.from({ length: 40 }, () => 'plim').join(' ')
    const v = validateBestClips(
      answerOf([
        { id: a.id, title: long, why: long },
        { id: b.id, title: '  ', why: '' },
        { id: c.id, title: 'plim', why: 'Because 99 people say so' }
      ]),
      EN_C,
      EN
    )
    if ('rejected' in v) throw new Error(v.rejected)
    const [p0, p1, p2] = v.picks
    expect(graphemes(p0.title).length).toBeLessThanOrEqual(TITLE_KEPT_GRAPHEMES)
    expect(graphemes(p0.why).length).toBeLessThanOrEqual(WHY_KEPT_GRAPHEMES)
    expect(p0.title.endsWith('plim…')).toBe(true)
    expect([p1.titleFrom, p1.whyFrom, p1.title, p1.why]).toEqual(['first-sentence', 'signals', b.title, b.why])
    expect([p2.whyFrom, p2.why]).toEqual(['signals', c.why])
  })

  it('an answer not of the shape is rejected whole, extra time fields included', () => {
    // MUTATION (the shape check skipped): fails the `rejected` toMatch for the extra startMs field.
    expect(validateBestClips({ picks: [] }, EN_C, EN)).toEqual({ rejected: expect.stringContaining('$.reasoning is missing') })
    expect(validateBestClips(answerOf([{ ...{ id: a.id, title: 'plim', why: 'w' }, startMs: 0 } as never]), EN_C, EN)).toEqual({
      rejected: expect.stringContaining('$.picks[0].startMs is not a field the plan has')
    })
  })
})

/* ------------------------------------------------------------------- run */

describe('bestClips: three cards, the times the windows\', the fallbacks plain', () => {
  const card = (x: ClipCandidate): Record<string, unknown> => ({ windowId: x.id, startMs: x.window.startMs, endMs: x.window.endMs, words: x.window.words })

  it('no ask: the signals\' three, by start time, each titled and reasoned by the signals, with NO_MODEL_NOTE', async () => {
    // MUTATION (the signals' cards not sorted by time): fails "toEqual(...sort by startMs...)": a heatmap rising to the end ranks the latest first.
    const heatmap = heatOf(EN.durationMs / 1000, (i) => i / 100)
    const r = await bestClips(EN, { heatmap, language: 'en' }, 60_000)
    const top = candidatesFor(EN, 60_000, heatmap).candidates.slice(0, 3)
    expect(top.map((x) => x.window.startMs)).not.toEqual([...top.map((x) => x.window.startMs)].sort((p, q) => p - q))
    expect(r.cards).toEqual(
      [...top].sort((p, q) => p.window.startMs - q.window.startMs).map((x) => ({ ...card(x), title: x.title, why: x.why, scoredBy: 'signals' }))
    )
    expect(r.cards.map((x) => x.startMs)).toEqual([...r.cards.map((x) => x.startMs)].sort((p, q) => p - q))
    expect([r.modelNote, r.fallback, r.model]).toEqual([NO_MODEL_NOTE, 'no-model', null])
  })

  it('a good answer: model cards in time order, every time and word count from the window its id names', async () => {
    // MUTATION (run.ts's model cards built from the first candidate's window, not the picked one's): fails "toEqual(expected)".
    // MUTATION (the cards' time order replaced by a random comparator): fails "toEqual(expected)" (and the determinism case).
    const picks = EN_C.candidates.slice(0, 3).reverse()
    const seen = { requests: [] as unknown[] }
    const r = await bestClips(EN, { heatmap: null, language: 'en' }, 60_000, answering(answerOf(picks.map((x) => ({ id: x.id, title: 'plim', why: 'it lands' }))), seen))
    const expected = [...picks].sort((p, q) => p.window.startMs - q.window.startMs).map((x) => ({ ...card(x), title: 'plim', why: 'it lands', scoredBy: 'model' }))
    expect(r.cards).toEqual(expected)
    expect([r.modelNote, r.fallback, r.model]).toEqual([null, null, { id: 'stub', runtime: 'openai' }])
    expect(seen.requests).toEqual([bestClipsRequest(EN_C.candidates, 'en')])
  })

  it('an answer carrying time fields is not read as time (rejected, the signals\' three at the windows\' times); a title holding a time falls back, the window\'s times kept', async () => {
    // MUTATION (validate ignores 'not a field the plan has' and run lays a pick's numeric startMs over the window's): fails "expect(r1.fallback).toBe('unusable')".
    const [x] = EN_C.candidates
    const timed = answerOf(EN_C.candidates.slice(0, 3).map((c) => ({ id: c.id, title: 'plim', why: 'w', startMs: 1, endMs: 2 }) as never))
    const r1 = await bestClips(EN, null, 60_000, answering(timed))
    expect(r1.fallback).toBe('unusable')
    expect(r1.modelNote).toBe(MODEL_UNUSABLE_NOTE)
    for (const c of r1.cards) {
      const w = EN_C.windows.find((v) => v.id === c.windowId)!
      expect([c.startMs, c.endMs, c.words]).toEqual([w.startMs, w.endMs, w.words])
    }
    const r2 = await bestClips(EN, null, 60_000, answering(answerOf([{ id: x.id, title: 'Plim from 0:01 to 9:59', why: 'w' }, ...EN_C.candidates.slice(1, 3).map((c) => ({ id: c.id, title: 'plim', why: 'w' }))])))
    const mine = r2.cards.find((c) => c.windowId === x.id)!
    expect(mine).toEqual({ ...card(x), title: x.title, why: 'w', scoredBy: 'model', note: TITLE_FALLBACK_NOTE })
  })

  it('fewer than three valid picks are filled from the signals, never on a kept window or one sharing more than half with it, and the notes say so', async () => {
    // MUTATION (no fill: the room `wanted - kept` -> 0): fails "toHaveLength(3)". MUTATION (the fill does not look at the kept picks, `[...taken, ...out]` -> `[...out]`): fails the distinct-ids toBe(3).
    const kept = EN_C.candidates[1]
    const r = await bestClips(
      EN,
      null,
      60_000,
      answering(answerOf([{ id: kept.id, title: 'plim', why: 'Zorvan says 77' }, { id: 'w9999', title: 't', why: 'w' }, { id: kept.id, title: 't', why: 'w' }]))
    )
    expect(r.cards).toHaveLength(3)
    expect(new Set(r.cards.map((c) => c.windowId)).size).toBe(3)
    const model = r.cards.filter((c) => c.scoredBy === 'model')
    expect(model.map((c) => [c.windowId, c.why, c.note])).toEqual([[kept.id, kept.why, WHY_FALLBACK_NOTE]])
    const filled = r.cards.filter((c) => c.scoredBy === 'signals')
    expect(filled.map((c) => c.note)).toEqual([FILLED_NOTE, FILLED_NOTE])
    for (const f of filled) {
      const shared = Math.min(f.endMs, kept.window.endMs) - Math.max(f.startMs, kept.window.startMs)
      expect(shared / Math.min(f.endMs - f.startMs, kept.window.endMs - kept.window.startMs)).toBeLessThanOrEqual(0.5)
    }
    expect(r.modelNote).toBe(filledNote(1, 3))
    expect(r.modelNote).toBe("The model gave 1 usable pick of 3; the rest are picked from the talk's own signals.")
  })

  it('a throwing ask never puts its text on a card or a note; a timeout and an unparsed answer say so plainly', async () => {
    // MUTATION (modelNote set to the thrown error's message): fails "not.toContain('sk-abcdefghijklmnop')" and the MODEL_FAILED_NOTE toBe.
    const secret = 'connect ECONNREFUSED http://user:pass@10.0.0.5:1234/v1 key sk-abcdefghijklmnop'
    const r = await bestClips(EN, null, 60_000, async () => {
      throw new Error(secret)
    })
    const text = JSON.stringify(r)
    for (const part of ['sk-abcdefghijklmnop', 'ECONNREFUSED', '10.0.0.5', 'user:pass']) expect(text).not.toContain(part)
    expect([r.modelNote, r.fallback, r.cards.every((c) => c.scoredBy === 'signals'), r.cards.length]).toEqual([MODEL_FAILED_NOTE, 'ask-failed', true, 3])

    const slow = await bestClips(EN, null, 60_000, () => new Promise(() => undefined), { timeoutMs: 20 })
    expect([slow.modelNote, slow.fallback]).toEqual([MODEL_SLOW_NOTE, 'timeout'])

    const prose = await bestClips(EN, null, 60_000, async () => ({ answer: { error: 'The model returned no JSON object' }, model: null }))
    expect([prose.modelNote, prose.fallback, JSON.stringify(prose).includes('no JSON object')]).toEqual([MODEL_UNUSABLE_NOTE, 'unusable', false])
  })

  it('a talk with fewer than three candidates asks for as many as there are; with none, asks nothing and says why', async () => {
    // MUTATION (bestClipsRequest's maxTokens for PICKS whatever the candidates): fails "toBe(maxTokensForBestClips(c.candidates.length))".
    const short = transcriptOf(talk(sentencesOf(24, latin, 23)), 'en')
    const c = candidatesFor(short, 60_000, null)
    expect(c.candidates.length).toBeGreaterThan(0)
    expect(c.candidates.length).toBeLessThan(3)
    const seen = { requests: [] as { schema: ObjectSchema; maxTokens: number }[] }
    const r = await bestClips(short, null, 60_000, answering(answerOf(c.candidates.map((x) => ({ id: x.id, title: 'plim', why: 'w' }))), seen as never))
    expect(seen.requests[0].schema.properties.picks).toMatchObject({ minItems: c.candidates.length, maxItems: c.candidates.length })
    expect(seen.requests[0].maxTokens).toBe(maxTokensForBestClips(c.candidates.length))
    // MUTATION (the prompt's pick line for PICKS whatever the candidates, `pickLine(PICKS)`): fails this toContain.
    expect((seen.requests[0] as unknown as { user: string }).user.split('\n')).toContain(pickLine(c.candidates.length))
    expect(bestClipsPrompt([{ id: 'w1', condensed: 'plim' }], 'en').user.split('\n')).toContain('Pick the 1 candidate a viewer would most want to watch on its own.')
    expect(r.cards.map((x) => x.scoredBy)).toEqual(c.candidates.map(() => 'model'))
    expect(r.note).toBe(c.note)
    expect(r.note).not.toBeNull()

    const tiny = transcriptOf(talk(sentencesOf(3, latin, 24)), 'en')
    let called = 0
    const none = await bestClips(tiny, null, 60_000, async () => {
      called++
      throw new Error('never')
    })
    expect([called, none.cards, none.modelNote]).toEqual([0, [], null])
    expect(none.note).toMatch(/^The talk here runs about \d+ s, shorter than the 1 min asked for\./u)
  })

  it('the same transcript, meta, length and answer give the same result, twice', async () => {
    // MUTATION (the cards' time order replaced by a random comparator, `byTime` -> `() => Math.random() - 0.5`): fails this toEqual.
    const meta = { heatmap: heatOf(EN.durationMs / 1000, (i) => (i % 9) / 10), language: 'en' }
    const value = answerOf(EN_C.candidates.slice(2, 5).map((x) => ({ id: x.id, title: 'plim', why: 'w' })))
    expect(await bestClips(EN, meta, 60_000, answering(value))).toEqual(await bestClips(EN, meta, 60_000, answering(value)))
  })
})

/* ------------------------------------------------- the critics' fixes */

describe("the critics' fixes: quantity words, empty text, a caseless window, a why's opening name, the prompt's rules, the language", () => {
  const said = 'zor plim Zorvan tavek $2,500 mubo 40 clients twelve senra kilo'

  it('a number word numberSpans does not read (a qualifier, an unapplied scale, a fraction, a pair) must still be said, in a title and in a why', () => {
    // MUTATION (the quantity-word line removed from ungroundedIn's word loop): fails every "toEqual(['nine'])"-style line below.
    expect(ungroundedIn('zor cost about nine', said, 'title')).toEqual(['nine'])
    expect(ungroundedIn('twenty grand for plim', said, 'title')).toEqual(['twenty', 'grand'])
    expect(ungroundedIn('two and a half million paid', said, 'title')).toEqual(['two', 'half', 'million'])
    expect(ungroundedIn('hundreds of plim', said, 'title')).toEqual(['hundreds'])
    expect(ungroundedIn('zor paid nineteen ninety nine', said, 'title')).toEqual(['nineteen', 'ninety', 'nine'])
    expect(ungroundedIn('It drew about nine guests.', said, 'why')).toEqual(['nine'])
    // Said in the window as the word or as the same value: kept.
    expect(ungroundedIn('about twelve senra', said, 'title')).toEqual([])
    expect(ungroundedIn('nearly forty clients', said, 'title')).toEqual([])
  })

  it("over real windows, 'about nine' in a title or a why falls back on the English and the caseless talk alike", () => {
    // MUTATION (the quantity-word line removed): fails "toEqual(['first-sentence', ...])" and the whyFrom 'signals' lines.
    for (const [c, t] of [
      [EN_C, EN],
      [CL_C, CL]
    ] as const) {
      const three = c.candidates.slice(0, 3)
      for (const x of three) expect(windowText(t, x.window).split(' ')).not.toContain('nine')
      const v = validateBestClips(answerOf(three.map((x) => ({ id: x.id, title: 'the hall cost about nine thousand', why: 'It has about nine guests crying.' }))), c, t)
      if ('rejected' in v) throw new Error(v.rejected)
      expect(v.picks.map((p) => [p.titleFrom, p.whyFrom, p.titleFallback, p.whyFallback])).toEqual(three.map(() => ['first-sentence', 'signals', 'ungrounded', 'ungrounded']))
    }
  })

  it('a title or why with no letter and no digit is empty (zero-width, soft hyphen, word joiner, punctuation, emoji); invisible marks are removed from a kept one', async () => {
    // MUTATION (hasContent -> `text !== ''`): fails the titleFallback 'empty' lines for '…' and '— — —' and the emoji run.
    // MUTATION (clean() keeps \p{Cf}): fails "toBe('plim tavek')".
    // MUTATION (run.ts gives TITLE_FALLBACK_NOTE for an empty title too): fails "toBe(`${TITLE_EMPTY_NOTE} ${WHY_EMPTY_NOTE}`)".
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'
    const empties = ['\u200B', '\u2060\u2060', '\u00AD', '\u2026', '\u2014 \u2014 \u2014', family.repeat(61)]
    for (let k = 0; k < empties.length; k += 3) {
      const group = empties.slice(k, k + 3)
      const three = EN_C.candidates.slice(0, group.length)
      const v = validateBestClips(answerOf(three.map((x, i) => ({ id: x.id, title: group[i], why: group[i] }))), EN_C, EN)
      if ('rejected' in v) throw new Error(v.rejected)
      expect(v.picks.map((p) => [p.title, p.titleFallback, p.why, p.whyFallback])).toEqual(three.map((x) => [x.title, 'empty', x.why, 'empty']))
    }
    const v = validateBestClips(answerOf([{ id: EN_C.candidates[0].id, title: '\u200Bplim\u00AD tavek\u2060', why: 'It lands.' }]), EN_C, EN)
    if ('rejected' in v) throw new Error(v.rejected)
    const [x] = EN_C.candidates
    expect(windowText(EN, x.window).split(/[ .,]+/u)).toEqual(expect.arrayContaining(['plim', 'tavek']))
    expect([v.picks[0].title, v.picks[0].titleFrom]).toEqual(['plim tavek', 'model'])

    const r = await bestClips(EN, null, 60_000, answering(answerOf(EN_C.candidates.slice(0, 3).map((c, i) => ({ id: c.id, title: i === 0 ? '…' : 'plim', why: i === 0 ? '\u200B' : 'It lands.' })))))
    expect(r.cards.find((c) => c.windowId === x.id)!.note).toBe(`${TITLE_EMPTY_NOTE} ${WHY_EMPTY_NOTE}`)
  })

  it('over a window with no capitalising-script letter, every title word with a letter is held to the window, a lower-case Latin one included', () => {
    // MUTATION (the window rule removed: `caseless` is `caselessWord(w)` alone): fails "toEqual(['kesmer', 'quits', 'forever'])" and the 'first-sentence' line.
    const words = [caseless(1), caseless(2), caseless(3)]
    const saidCl = words.join(' ')
    expect(ungroundedIn('kesmer quits forever', saidCl, 'title')).toEqual(['kesmer', 'quits', 'forever'])
    expect(ungroundedIn(`${words[2]} ${words[0]}`, saidCl, 'title')).toEqual([])
    // A mixed window (letters of both kinds) keeps the per-word split: a lower-case Latin word is not held there.
    expect(ungroundedIn(`${words[0]} plimmo`, `zor ${saidCl}`, 'title')).toEqual([])
    const [y] = CL_C.candidates
    const v = validateBestClips(answerOf([{ id: y.id, title: 'kesmer quits forever', why: 'It lands.' }]), CL_C, CL)
    if ('rejected' in v) throw new Error(v.rejected)
    expect([v.picks[0].titleFrom, v.picks[0].titleFallback]).toEqual(['first-sentence', 'ungrounded'])
  })

  it("a why opening on a name the window does not say falls back; one opening on a function word or a said name is kept", () => {
    // MUTATION (the opening exemption for every capital again, `&& functionWord(w)` removed): fails "toEqual(['Kesmer'])" (both).
    expect(ungroundedIn('Kesmer admits failure.', said, 'why')).toEqual(['Kesmer'])
    expect(ungroundedIn('A story. Kesmer lied about the plim.', said, 'why')).toEqual(['Kesmer'])
    expect(ungroundedIn('It is funny. This lands.', said, 'why')).toEqual([])
    expect(ungroundedIn('Zorvan explains the plim.', said, 'why')).toEqual([])
  })

  it('digits that are not decimal (roman numerals, superscripts) must be said too', () => {
    // MUTATION (DIGIT back to \p{Nd}): fails "toEqual(['Ⅻ'])" and the superscript line.
    expect(ungroundedIn('Ⅻ hours of plim', said, 'title')).toEqual(['Ⅻ'])
    expect(ungroundedIn('plim² zor', said, 'title')).toEqual(['plim²'])
  })

  it("the system text tells the model the validator's rules: sentence case from the candidate's words, a why opening on This or It", () => {
    // MUTATION (the title's sentence-case sentence removed from BEST_CLIPS_SYSTEM): fails the first toContain.
    // MUTATION (the why's opening sentence removed): fails the second.
    expect(BEST_CLIPS_SYSTEM).toContain("Write it in sentence case from the candidate's own words: start with a word the candidate says, and capitalise only a name the candidate says.")
    expect(BEST_CLIPS_SYSTEM).toContain('In English, start it with "This" or "It".')
  })

  it("the link's language wins over the transcript's; the transcript's is used when the link names none", async () => {
    // MUTATION (run.ts's lang -> `t.language || ''`): fails the first toBe. MUTATION (lang -> `(meta?.language ?? '') || ''`): fails the second and third.
    const lastLine = async (t: Transcript, meta: { heatmap: null; language: string } | null): Promise<string> => {
      const seen = { requests: [] as unknown[] }
      await bestClips(t, meta, 60_000, answering(answerOf([]), seen))
      return (seen.requests[0] as { user: string }).user.split('\n').pop()!
    }
    expect(await lastLine({ ...EN, language: 'und' }, { heatmap: null, language: 'te' })).toBe(graphicsLanguageLine('te'))
    expect(await lastLine({ ...EN, language: 'te' }, { heatmap: null, language: '' })).toBe(graphicsLanguageLine('te'))
    expect(await lastLine({ ...EN, language: 'te' }, null)).toBe(graphicsLanguageLine('te'))
    expect(graphicsLanguageLine('te')).not.toBe(graphicsLanguageLine('en'))
  })

  it('a conforming answer with no usable pick reports no model, fills all three and says none could be used', async () => {
    // MUTATION (`model: used ? asked.model : null` -> `asked.model`): fails "toBeNull()".
    const r = await bestClips(EN, null, 60_000, answering(answerOf(['w9997', 'w9998', 'w9999'].map((id) => ({ id, title: 'plim', why: 'It lands.' })))))
    expect(r.model).toBeNull()
    expect([r.modelNote, r.fallback, r.cards.map((c) => c.scoredBy)]).toEqual([filledNote(0, 3), null, ['signals', 'signals', 'signals']])
  })

  it("run's why is judged as a why: a caseless why of words the window does not say is kept on the card", async () => {
    // MUTATION (validateBestClips grounds the why in 'title' mode): fails "toEqual(made)".
    const made = '\u10E0\u10E2\u10E4 \u10E4\u10E0'
    const three = CL_C.candidates.slice(0, 3)
    for (const x of three) expect(windowText(CL, x.window)).not.toContain('\u10E0\u10E2\u10E4')
    const r = await bestClips(CL, null, 60_000, answering(answerOf(three.map((x) => ({ id: x.id, title: windowText(CL, x.window).split(' ')[0], why: made })))))
    expect(r.cards.map((c) => c.why)).toEqual(three.map(() => made))
    expect(r.cards.every((c) => c.scoredBy === 'model' && c.note === undefined)).toBe(true)
  })
})

/* ------------------------------------------------------------------ eval */

describe('the eval block: prepare sends what the app sends; score settles as the app settles', () => {
  const CONFIG = { provider: 'openai' as const, model: 'test-model' }
  const fixtures = bestClipsFixtures()

  it('prepare: one request a fixture, the app\'s own body with thinking off, on either shape, and no key', async () => {
    // MUTATION (bestClipsRequestsFor builds its own request with maxTokens 2000): fails the body toEqual.
    for (const f of fixtures) {
      const [r, ...more] = await bestClipsRequestsFor(f, CONFIG)
      expect(more).toEqual([])
      expect([r.id, r.fixtureId, r.path]).toEqual([bestClipsRequestId(f.id), f.id, '/v1/chat/completions'])
      const c = candidatesFor(f.transcript, f.targetMs, f.heatmap)
      expect(c.candidates.length).toBeGreaterThanOrEqual(3)
      expect(r.body).toEqual(openaiRequestBody({ ...bestClipsRequest(c.candidates, f.language || f.transcript.language), think: false }, [], 'test-model'))
      expect(credentialsIn(JSON.stringify(r))).toEqual([])
    }
    const [f] = fixtures
    const [o] = await bestClipsRequestsFor(f, { provider: 'ollama', model: 'gemma4:e2b' })
    const c = candidatesFor(f.transcript, f.targetMs, f.heatmap)
    expect([o.path, o.body]).toEqual(['/api/chat', ollamaRequestBody({ ...bestClipsRequest(c.candidates, f.language), think: false }, [], 'gemma4:e2b')])
  })

  it('score: a saved answer settles exactly as the app\'s run settles it; a prose answer returns its retry; the figures count by hand', async () => {
    // MUTATION (scoreBestClipsFixture's signals side run with the model's ask): fails "toEqual(alone.cards)".
    const [f, g, h] = fixtures
    const c = candidatesFor(f.transcript, f.targetMs, f.heatmap)
    const value = answerOf([
      { id: c.candidates[0].id, title: 'Kesmer wins', why: 'w' },
      { id: c.candidates[1].id, title: 'plim', why: 'it lands' },
      { id: 'w9999', title: 't', why: 'w' }
    ])
    const saved = (id: string): EvalResponse | null =>
      id === bestClipsRequestId(f.id)
        ? { id, status: 200, ms: 5, data: { choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 80 } } }
        : id === bestClipsRequestId(g.id)
          ? { id, status: 200, ms: 5, data: { choices: [{ message: { content: 'I think w3 is best.' }, finish_reason: 'stop' }] } }
          : null
    const app = await bestClips(f.transcript, { heatmap: f.heatmap, language: f.language }, f.targetMs, answering(value))
    const alone = await bestClips(f.transcript, { heatmap: f.heatmap, language: f.language }, f.targetMs)
    const one = await scoreBestClipsFixture(f, CONFIG, saved)
    expect(one.result.model.cards).toEqual(app.cards)
    expect(one.result.model.problems).toEqual(app.problems)
    expect(one.result.signals.cards).toEqual(alone.cards)
    expect(one.pending).toEqual([])
    expect([one.result.model.answered, one.result.model.parsed, one.result.model.promptTokens]).toEqual([true, true, 900])

    const two = await scoreBestClipsFixture(g, CONFIG, saved)
    expect(two.result.model.prose).toBe(true)
    expect(two.pending.map((p) => p.id)).toEqual([`${bestClipsRequestId(g.id)}.retry`])
    expect(JSON.stringify(two.pending[0].body)).toContain('Answer with the JSON object only.')
    expect(two.result.model.fallback).toBe('ask-failed')

    const three = await scoreBestClipsFixture(h, CONFIG, saved)
    const figures = bestClipsFigures([one.result, two.result, three.result])
    expect(figures).toEqual({
      fixtures: 3,
      answered: 2,
      parsed: 1,
      prose: 1,
      truncated: 0,
      wrongShape: 0,
      unusable: 2,
      modelCards: 2,
      filledCards: 1,
      titleFallbacks: 1,
      whyFallbacks: 0,
      droppedPicks: 1,
      agreeWithSignals: one.result.model.cards.filter((x) => x.scoredBy === 'model' && alone.cards.some((y) => y.windowId === x.windowId)).length
    })
    expect(credentialsIn(JSON.stringify([one.result, two.result, three.result]))).toEqual([])
  })

  it('score refuses an unprepared run, another pass\'s run, and one with no answer saved', () => {
    // MUTATION (the no-answer refusal removed): fails "toContain('No answer is saved')".
    const req = { id: 'bc-en-heat.bestclips', fixtureId: 'bc-en-heat', provider: 'openai' as const, path: '/v1/chat/completions', body: {} }
    expect(bestClipsScoreRefusal('r', null, () => true)).toContain('was never prepared')
    expect(bestClipsScoreRefusal('r', [{ ...req, id: 'x.graphics.s00' }], () => true)).toContain('holds no best clips request')
    expect(bestClipsScoreRefusal('r', [req], () => false)).toContain('No answer is saved')
    expect(bestClipsScoreRefusal('r', [req], () => true)).toBeNull()
  })
})
