import { describe, expect, it } from 'vitest'
import { graphicsMenuFor, pairSettled, runGraphicsPass, settleGraphics, type GraphicsAsk, type GraphicsMenu } from '@shared/director/run'
import { GRAPHICS_SYSTEM, GRAPHIC_TEMPLATE_ROWS, graphicsPrompt } from '@shared/director/promptGraphics'
import { MAX_GRAPHICS, graphicsSchema, maxTokensForGraphics, type AnswerGraphic } from '@shared/director/schemaGraphics'
import { BEFORE_AFTER_CUES_EN, STEP_SIX_TEMPLATES, VERSUS_CUES_EN, stepSixOffered } from '@shared/director/menuGraphics'
import { SIDE_ROWS, checkGraphicData, notAYear, sideRowsNote } from '@shared/director/validateGraphics'
import { baselineGraphics } from '@shared/director/baselineGraphics'
import { MAX_CANDIDATES } from '@shared/director/menu'
import { THINKING_EXTRA_TOKENS } from '@shared/director/ask'
import { NUM_CTX, promptTokensAtMost } from '@shared/bestclips/prompt'
import { ollamaRequestBody } from '@shared/director/provider'
import { replaceClipGraphics } from '@shared/graphics/apply'
import { drawListAt } from '@shared/graphics/drawList'
import { graphicMovingFrames } from '@shared/graphics/frame'
import type { DrawItem, TextItem, TextMeasure } from '@shared/graphics/items'
import { resolveGraphicStyle } from '@shared/graphics/style'
import { GRAPHIC_TEMPLATES, type GraphicData, type GraphicTemplateId } from '@shared/graphics/template'
import { SOUND_ROLES, type SoundPack } from '@shared/director/soundRoles'
import type { Transcript } from '@shared/transcript'
import { EVAL_TEMPLATE_IDS, notOfferedTruthLine, projectForTranscript, readEvalFixture } from './eval/graphicsFixtures'
import { dropReasonOf, graphicsFigures, scoreGraphicsFixture } from './eval/graphicsEval'
import type { EvalResponse } from './eval/pipeline'
import { BEFORE_AFTER_SENTENCES, TIMELINE_SENTENCES, VERSUS_SENTENCES, stepSixFixtures, stepSixTalk } from './eval/stepSixFixtures'

/*
 * 3D templates, piece 2 (docs/CLIPS.md §9, "The 3D templates"): the model's
 * side of timeline, before-after and versus. Rule 6 binds each pair as a bars
 * item, the values in drawn order; the menu offers each only when its talk
 * holds what it needs; the answer fills `items` (no new key); the prompt
 * lists a row only when offered; the request fits num_ctx; the baseline never
 * makes them; and a kept one of each lands, draws and sounds. Every talk is
 * made-up English (tests/eval/stepSixFixtures.ts) or built here; no model, no
 * network.
 */

const ans = (fields: Partial<AnswerGraphic> & Pick<AnswerGraphic, 'sentence' | 'template'>): AnswerGraphic => ({
  title: '', value: '', label: '', items: [], quote: '', words: '', lit: 0, why: 'it helps', ...fields
})
const rows = (...pairs: [string, string][]): AnswerGraphic['items'] => pairs.map(([label, value]) => ({ label, value }))

/** The menus the app builds for a talk: one clip showing the whole file (the eval's project). */
function menusOf(t: Transcript): GraphicsMenu[] {
  const { project, clip } = projectForTranscript(t)
  return graphicsMenuFor(project, clip, t)
}

/** One answer settled on a talk's first menu, as Find settles it. */
function settle(t: Transcript, ...graphics: AnswerGraphic[]) {
  const [menu] = menusOf(t)
  return settleGraphics({ value: { reasoning: 'r', graphics }, truncated: false }, menu, t)
}

const BA = stepSixTalk('ba', BEFORE_AFTER_SENTENCES)
const VS = stepSixTalk('vs', VERSUS_SENTENCES)
const TL = stepSixTalk('tl', TIMELINE_SENTENCES)
const wordAt = (t: Transcript, text: string): number => {
  const hits = t.words.filter((w) => w.text.replace(/[.,]$/u, '') === text)
  expect(hits, `'${text}' said once`).toHaveLength(1)
  return hits[0].index
}

const BA_GOOD = ans({ sentence: 's01', template: 'before-after', items: rows(['Before the course', '$1,500'], ['After the course', '$4,000']) })
const VS_GOOD = ans({ sentence: 's01', template: 'versus', items: rows(['Instagram', '600'], ['referrals', '350']) })
const TL_GOOD = ans({ sentence: 's01', template: 'timeline', items: rows(['shot our first wedding', '2015'], ['hired an editor', '2018'], ['opened the studio', '2021']) })

/* ------------------------------------------------------------- rule 6 */

describe('rule 6 binds each pair of the three as it binds a bars item, in drawn order (§9, §6.7)', () => {
  it('keeps each fixture talk’s graphic: the data from the answer’s items, bound, its beats on the values’ words in drawn order', () => {
    // MUTATION (dataOf's before-after arm swaps the two rows): fails the before-after toEqual (and the order rule drops it).
    // MUTATION (beatWordsOf's step-6 arms removed, so no beat words): fails the beatWords toEqual.
    const ba = settle(BA, BA_GOOD)
    expect(ba.dropped).toEqual([])
    expect(ba.kept.map((k) => k.data)).toEqual([{ template: 'before-after', before: { label: 'Before the course', value: '$1,500' }, after: { label: 'After the course', value: '$4,000' } }])
    expect(ba.kept[0].beatWords).toEqual([wordAt(BA, '$1,500'), wordAt(BA, '$4,000')])
    const vs = settle(VS, VS_GOOD)
    expect(vs.dropped).toEqual([])
    expect(vs.kept.map((k) => k.data)).toEqual([{ template: 'versus', left: { label: 'Instagram', value: '600' }, right: { label: 'referrals', value: '350' } }])
    expect(vs.kept[0].beatWords).toEqual([wordAt(VS, '600'), wordAt(VS, '350')])
    const tl = settle(TL, TL_GOOD)
    expect(tl.dropped).toEqual([])
    expect(tl.kept.map((k) => k.data)).toEqual([
      { template: 'timeline', items: [{ when: '2015', label: 'shot our first wedding' }, { when: '2018', label: 'hired an editor' }, { when: '2021', label: 'opened the studio' }] }
    ])
    expect(tl.kept[0].beatWords).toEqual([wordAt(TL, '2015'), wordAt(TL, '2018'), wordAt(TL, '2021')])
  })

  it('before and after swapped against spoken order: dropped, "not said in the order the before-and-after draws it" (a fall drawn as a rise); the same for a versus and a timeline', () => {
    // MUTATION (valuesDisordered returns [] in claims.ts' judge): fails all three: the swapped graphics are kept.
    // MUTATION (pairsInOrder removed from before-after's row): fails the before-after case only.
    const swapped = settle(BA, ans({ sentence: 's01', template: 'before-after', items: rows(['After the course', '$4,000'], ['Before the course', '$1,500']) }))
    expect(swapped.kept).toEqual([])
    expect(swapped.drops).toHaveLength(1)
    for (const part of ["'$4,000'", "'$1,500'", "'After the course'", "'Before the course'"]) {
      expect(swapped.drops[0].reason).toContain(`${part} is not said in the order the before-and-after draws it in s01`)
    }
    // Add (the owner's click is the review) places it as answered, on the words bind judged: the two values' words.
    expect(swapped.drops[0].add?.candidate.data).toEqual({ template: 'before-after', before: { label: 'After the course', value: '$4,000' }, after: { label: 'Before the course', value: '$1,500' } })
    expect(swapped.drops[0].add?.candidate.beatWords).toEqual([wordAt(BA, '$4,000'), wordAt(BA, '$1,500')])
    // The paths are the answer's: a side is its item.
    expect(swapped.dropped.map((p) => p.path)).toEqual(expect.arrayContaining(['$.graphics[0].items[0].value', '$.graphics[0].items[1].value', '$.graphics[0].items[0].label']))
    const vs = settle(VS, ans({ sentence: 's01', template: 'versus', items: rows(['referrals', '350'], ['Instagram', '600']) }))
    expect(vs.kept).toEqual([])
    expect(vs.drops[0].reason).toContain("'350' is not said in the order the versus draws it in s01")
    const tl = settle(TL, ans({ sentence: 's01', template: 'timeline', items: rows(['hired an editor', '2018'], ['shot our first wedding', '2015'], ['opened the studio', '2021']) }))
    expect(tl.kept).toEqual([])
    expect(tl.drops[0].reason).toContain("'2018' is not said in the order the timeline draws it in s01")
  })

  it('a pair split across two sentences is refused: a label said in one sentence and its value in the next', () => {
    // MUTATION (bind's same-sentence test for a pair, `label.sent !== value.sent`, removed): fails: the split versus is kept.
    const r = settle(VS, ans({ sentence: 's01', template: 'versus', items: rows(['Instagram', '600'], ['couples', '350']) }))
    expect(r.kept).toEqual([])
    expect(r.drops[0].reason).toContain("'couples' is not said with what it is paired with, in one sentence of s01")
  })

  it('a value the speaker did not say is refused, and counts as unsaid', () => {
    const r = settle(BA, ans({ sentence: 's01', template: 'before-after', items: rows(['Before the course', '$2,000'], ['After the course', '$4,000']) }))
    expect(r.kept).toEqual([])
    expect(r.drops[0].reason).toBe("'$2,000' is not said in s01")
    expect(r.drops[0].template).toBe('before-after')
    // The drop names what it would draw first, in the drawn order: the before's label.
    expect(r.drops[0].text).toBe('Before the course')
  })

  it('a side said negated is refused, as rule 7 refuses any pair', () => {
    const t = stepSixTalk('neg', ['Before the course I did not charge $1,500 a wedding.', 'After the course I charge $4,000 a wedding.'])
    const r = settle(t, ans({ sentence: 's00', template: 'before-after', items: rows(['Before the course', '$1,500'], ['After the course', '$4,000']) }))
    expect(r.kept).toEqual([])
    expect(r.drops[0].reason).toContain("'$1,500' is said negated in s00")
  })

  it('a timeline of one item is refused (minItems 2); a row with a when and no label is refused; a when that is not a year is refused', () => {
    // MUTATION (the timeline's mustSay removed in check): fails the empty-label case: it is kept.
    // MUTATION (isYearClaim returns true for any one number): fails the '15' case.
    const one = settle(TL, ans({ sentence: 's01', template: 'timeline', items: rows(['shot our first wedding', '2015']) }))
    expect(one.kept).toEqual([])
    expect(one.drops[0].reason).toBe('a timeline needs at least 2 items, has 1')
    const unlabelled = settle(TL, ans({ sentence: 's01', template: 'timeline', items: rows(['shot our first wedding', '2015'], ['', '2018']) }))
    expect(unlabelled.kept).toEqual([])
    expect(unlabelled.dropped).toContainEqual({ path: '$.graphics[0].items[1].label', message: "graphic dropped: '' holds no word the transcript can ground" })
    for (const when of ['last year', 'March 2018', '15', '2015-2018']) {
      const r = settle(TL, ans({ sentence: 's01', template: 'timeline', items: rows(['shot our first wedding', '2015'], ['hired an editor', when]) }))
      expect(r.kept, when).toEqual([])
      expect(r.dropped, when).toContainEqual({ path: '$.graphics[0].items[1].value', message: `graphic dropped: ${notAYear(when)}` })
    }
    expect(notAYear('last year')).toBe("'last year' is not a year: a timeline's when is one year as said, such as 2019")
  })

  it('a year the speaker said as an amount does not bind as a when (the dock’s check, checkGraphicData)', () => {
    // MUTATION (the matched-unit rule for a timeline's when removed): fails: no problem is found.
    const t = stepSixTalk('amount', ['We paid $2018 for the lens and $2021 for the body.'])
    const data: GraphicData = { template: 'timeline', items: [{ when: '2018', label: 'lens' }, { when: '2021', label: 'body' }] }
    const problems = checkGraphicData(data, GRAPHIC_TEMPLATES.timeline!, { assetId: 'amount', sentence: 's00', words: [] }, t)
    expect(problems).toEqual([
      { path: '$.items[0].when', message: "'2018' is said in s00 in another unit" },
      { path: '$.items[1].when', message: "'2021' is said in s00 in another unit" }
    ])
    // Said as years, the same rows ground.
    const years = stepSixTalk('years', ['We bought the lens in 2018 and the body in 2021.'])
    expect(checkGraphicData(data, GRAPHIC_TEMPLATES.timeline!, { assetId: 'years', sentence: 's00', words: [] }, years)).toEqual([])
  })

  it('a two-sided graphic is two items: a third row, or one, drops it with a plain note', () => {
    // MUTATION (the SIDE_ROWS check in validateGraphics removed): fails: the three-row before-after is kept with its third row lost.
    expect(SIDE_ROWS).toBe(2)
    const three = settle(BA, ans({ sentence: 's01', template: 'before-after', items: [...BA_GOOD.items, { label: 'a wedding', value: '$900' }] }))
    expect(three.kept).toEqual([])
    expect(three.dropped).toEqual([{ path: '$.graphics[0].items', message: `graphic dropped: ${sideRowsNote('before-after', 3)}` }])
    expect(sideRowsNote('before-after', 3)).toBe('a before-and-after is 2 items, the before and then the after; this has 3')
    expect(sideRowsNote('versus', 1)).toBe('a versus is 2 items, the left and then the right; this has 1')
  })

  it('a field another template holds is left out with a note, never drawn (the flat answer’s strays)', () => {
    const r = settle(VS, { ...VS_GOOD, value: '600', label: 'Instagram' })
    expect(r.kept).toHaveLength(1)
    expect(r.dropped.map((p) => p.message)).toEqual(["graphic repaired: 'value' is not a field of a versus — left out", "graphic repaired: 'label' is not a field of a versus — left out"])
  })
})

/* --------------------------------------------------------------- the menu */

describe('the menu offers each of the three only when its talk holds it (menuGraphics.ts)', () => {
  it('each fixture talk offers its own template and neither other, after the always-offered six', () => {
    // MUTATION (stepSixOffered returns all three always): fails every toEqual.
    // MUTATION (the year filter dropped from the two-sided condition): fails the timeline talk (a before-and-after offered beside it: 'grew').
    for (const f of stepSixFixtures()) {
      const [menu] = menusOf(f.transcript)
      expect(menu.templates, f.id).toEqual(['counter', 'bars', 'steps', 'quote', 'ring', 'keyword', f.template])
    }
  })

  it('a talk with no comparison, no change and no dates offers none of the three', () => {
    const plain = stepSixTalk('plain', ['We signed 40 clients this year.', 'Keep it simple, always.', 'Light matters more than gear.'])
    expect(stepSixOffered(menusOf(plain)[0].sentences, plain)).toEqual([])
  })

  it('timeline: two different years said as four digits with no unit, in one stretch', () => {
    // MUTATION (isYear drops its four-digit test): fails the '1,500 and 2,000' case (offered).
    const offers = (...s: string[]): GraphicTemplateId[] => {
      const t = stepSixTalk('y', s)
      return stepSixOffered(menusOf(t)[0].sentences, t)
    }
    expect(offers('In 2019 we started.', 'In 2021 we moved.')).toEqual(['timeline'])
    expect(offers('In 2019 we started.')).toEqual([])
    expect(offers('In 2019 we started, in 2019 we moved.')).toEqual([])
    expect(offers('We paid $2018 and $2021.')).toEqual([])
    expect(offers('We sold 1,500 prints and 2,000 cards.')).toEqual([])
    // Three sentences apart is past one stretch: no stretch holds both.
    expect(offers('In 2019 we started.', 'Filler words here.', 'More filler words.', 'In 2021 we moved.')).toEqual([])
  })

  it('before-after and versus: two numbers in one unit, and in English a cue word of each', () => {
    // MUTATION (the English cue test removed): fails the 'no cue' case (both offered).
    const offers = (lang: string, ...s: string[]): GraphicTemplateId[] => {
      const t = { ...stepSixTalk('c', s), language: lang }
      return stepSixOffered(menusOf(t)[0].sentences, t)
    }
    expect(offers('en', 'I charged $1,500 and $4,000.')).toEqual([])
    expect(offers('en', 'I used to charge $1,500, and I charge $4,000.')).toEqual(['before-after'])
    expect(offers('en', 'Instagram brought 600 leads, more than the 350 referrals brought.')).toEqual(['versus'])
    expect(offers('en', 'We went from 40 couples, compared with 90 couples.')).toEqual(['before-after', 'versus'])
    // Two units are not one comparison: $1,500 against 40%.
    expect(offers('en', 'I used to charge $1,500, and 40% book early.')).toEqual([])
    // Not English: the cue words are the owner's to give, so two numbers in one unit offer both (made-up words).
    expect(offers('hi', 'zor plim 40 tavek', 'mubo 70 senra')).toEqual(['before-after', 'versus'])
    expect(offers('te', 'zor plim 40 tavek')).toEqual([])
    // The lists are lower case, as claimTokens writes a word.
    for (const w of [...BEFORE_AFTER_CUES_EN, ...VERSUS_CUES_EN]) expect(w).toBe(w.toLowerCase())
    expect(STEP_SIX_TEMPLATES).toEqual(['timeline', 'before-after', 'versus'])
  })

  it('graphicsMenuFor decides per window: years only in the second window offer a timeline there only', () => {
    const filler = Array.from({ length: MAX_CANDIDATES }, (_, i) => `Filler sentence number ${i} here.`).map((s) => s.replace(/\d+/u, 'x'))
    const t = stepSixTalk('w', [...filler, 'In 2019 we started.', 'In 2021 we moved.'])
    const menus = menusOf(t)
    expect(menus).toHaveLength(2)
    expect(menus[0].templates).not.toContain('timeline')
    expect(menus[1].templates).toContain('timeline')
  })
})

/* ------------------------------------------------- the schema and the prompt */

describe('the schema gains no key; the prompt lists a row for each of the three only when offered', () => {
  it('the graphic object’s keys are what they were: the three fill items (label, value)', () => {
    // MUTATION (a 'when' key added to the item object): fails the items toEqual.
    const [menu] = menusOf(BA)
    const schema = graphicsSchema(menu) as unknown as { properties: { graphics: { items: { properties: Record<string, { items?: { properties: Record<string, unknown> }; enum?: string[] }> } } } }
    const graphic = schema.properties.graphics.items.properties
    expect(Object.keys(graphic)).toEqual(['sentence', 'template', 'title', 'value', 'label', 'items', 'quote', 'words', 'lit', 'why'])
    expect(Object.keys(graphic.items.items!.properties)).toEqual(['label', 'value'])
    expect(graphic.template.enum).toContain('before-after')
    expect(graphic.template.enum).not.toContain('versus')
  })

  it('a TEMPLATES row for each of the three, in the table’s manner, only when the menu offers it', () => {
    // MUTATION (graphicsPrompt lists every GRAPHIC_TEMPLATE_ROWS row, offered or not): fails the not.toContain lines.
    const rowOf = (id: GraphicTemplateId): string => `${id} — ${GRAPHIC_TEMPLATE_ROWS[id]!.when} — ${GRAPHIC_TEMPLATE_ROWS[id]!.fields}`
    expect(rowOf('timeline')).toBe('timeline — two to five dated moments said in order (items: label is what happened, value is its year) — items[].label, items[].value')
    expect(rowOf('before-after')).toBe('before-after — a number said as it was and as it is now (two items: the before, then the after) — items[].label, items[].value')
    expect(rowOf('versus')).toBe('versus — two things set against each other, each with its number (two items, in the order said) — items[].label, items[].value')
    for (const f of stepSixFixtures()) {
      const user = graphicsPrompt(menusOf(f.transcript)[0], 'en').user.split('\n')
      for (const id of STEP_SIX_TEMPLATES) {
        if (id === f.template) expect(user, `${f.id} lists ${id}`).toContain(rowOf(id))
        else expect(user.some((l) => l.startsWith(`${id} —`)), `${f.id} does not list ${id}`).toBe(false)
      }
    }
    // The system text is the one constant playbook: the three add nothing to it.
    expect(GRAPHICS_SYSTEM).not.toMatch(/timeline|before-after|versus/u)
  })

  it('THE BUDGET: 24 sentences of 30 long words with all ten templates offered, the system text and the answer’s room fit num_ctx with the thinking retry', () => {
    // MUTATION (maxTokensForGraphics -> 250 + 900 a graphic): fails "toBeLessThanOrEqual(NUM_CTX)".
    const word = 'abcdefghijkl'
    const sentences = Array.from({ length: MAX_CANDIDATES }, (_, i) => ({
      id: `s${String(i).padStart(2, '0')}`,
      startMs: i * 15_000,
      text: Array.from({ length: 30 }, () => word).join(' '),
      wordStart: i * 30,
      wordEnd: i * 30 + 29
    }))
    const all: GraphicTemplateId[] = ['counter', 'bars', 'steps', 'quote', 'callout', 'ring', 'keyword', 'timeline', 'before-after', 'versus']
    const menu: GraphicsMenu = { assetId: 'a', clipId: 'c', language: 'te', sentences, templates: all, wordSource: 'whisper' }
    const without: GraphicsMenu = { ...menu, templates: all.filter((t) => !(STEP_SIX_TEMPLATES as string[]).includes(t)) }
    const p = graphicsPrompt(menu, 'te')
    const q = graphicsPrompt(without, 'te')
    const answer = maxTokensForGraphics(menu)
    const total = promptTokensAtMost(p.system) + promptTokensAtMost(p.user) + answer
    const before = promptTokensAtMost(q.system) + promptTokensAtMost(q.user) + answer
    console.log(
      `graphics@1 budget, worst menu: system ${promptTokensAtMost(p.system)} + user ${promptTokensAtMost(p.user)} + answer ${answer} = ${total} tokens at 3.0 chars a token ` +
        `(${total - before} of them the three's rows; ${before} without them); with the thinking retry ${total + THINKING_EXTRA_TOKENS} of num_ctx ${NUM_CTX}; ` +
        `the prompt at 1 char a token ${p.system.length + p.user.length}`
    )
    expect(answer).toBe(250 + 150 * MAX_GRAPHICS)
    expect(total + THINKING_EXTRA_TOKENS).toBeLessThanOrEqual(NUM_CTX)
    // The three's rows cost 129 tokens at 3.0 characters a token (measured here, 2026-11-25).
    expect(total - before).toBeGreaterThan(0)
    expect(total - before).toBeLessThan(150)
    // num_ctx is the provider's own.
    const body = ollamaRequestBody({ system: p.system, user: p.user, schema: {}, maxTokens: 1 }, [], 'm') as { options: { num_ctx: number } }
    expect(body.options.num_ctx).toBe(NUM_CTX)
  })
})

/* ------------------------------------------------------------ the baseline */

describe('the baseline never makes the three (§9: "the baseline does not")', () => {
  it('over each fixture talk, whose menu offers its template, and the talks the validator tests use: no candidate of the three', () => {
    // MUTATION (baselineGraphics returns a versus for every window that offers one): fails the toEqual([]).
    const talks = [...stepSixFixtures().map((f) => f.transcript), stepSixTalk('mix', [...BEFORE_AFTER_SENTENCES, ...VERSUS_SENTENCES, ...TIMELINE_SENTENCES])]
    let offeredSeen = 0
    for (const t of talks) {
      for (const menu of menusOf(t)) {
        offeredSeen += menu.templates.filter((id) => (STEP_SIX_TEMPLATES as string[]).includes(id)).length
        const made = baselineGraphics(t, menu).map((c) => c.data.template)
        expect(made.filter((id) => (STEP_SIX_TEMPLATES as string[]).includes(id)), t.assetId).toEqual([])
        // And settled with no model, the same.
        const s = settleGraphics({ error: 'no model' }, menu, t, { baseline: baselineGraphics })
        expect(s.kept.map((k) => k.data.template).filter((id) => (STEP_SIX_TEMPLATES as string[]).includes(id))).toEqual([])
      }
    }
    // Not vacuous: the menus did offer them.
    expect(offeredSeen).toBeGreaterThanOrEqual(6)
  })
})

/* ------------------------------------------------------------- the path */

const SIZE = { width: 1080, height: 1920 }
const fakeMeasure: TextMeasure = (text, look) => ({ width: text.length * look.px * 0.55, ascent: look.px * 0.8, descent: look.px * 0.2 })
const flat = (items: readonly DrawItem[]): DrawItem[] => items.flatMap((i) => (i.kind === 'group' ? flat(i.children) : [i]))
const PACK: SoundPack = ['clock_tick.wav', 'fast_whoosh.wav', 'whoosh_fast.wav', 'sword_swish.wav', 'swoosh_heavy.wav'].map((name) => ({ ...SOUND_ROLES[name], id: name, name, file: `/lib/sfx/${name}` }))

describe('the whole path: a kept graphic of each of the three lands, draws and sounds (settle, beats, place, budget, sounds, apply)', () => {
  const GOOD: Record<string, AnswerGraphic> = { timeline: TL_GOOD, 'before-after': BA_GOOD, versus: VS_GOOD }

  it.each(stepSixFixtures().map((f) => [f.template, f] as const))('%s: Find’s loop over the fixture talk places one graphic clip with one beat an element, drawn whole at its settled frame, with a tick', async (template, f) => {
    // MUTATION (graphicSoundCues' step-6 arms removed): fails "the tick" toHaveLength(1).
    const { project, clip } = projectForTranscript(f.transcript)
    const ask: GraphicsAsk = async () => ({ answer: { value: { reasoning: 'r', graphics: [GOOD[template]] }, truncated: false }, model: { id: 'stub', runtime: 'test' } })
    const run = await runGraphicsPass(project, [clip], ask, { baseline: baselineGraphics })
    expect(run.parts.flatMap((p) => p.settled.dropped)).toEqual([])
    const { kept } = pairSettled(run.parts)
    expect(kept.map((k) => k.candidate.data.template)).toEqual([template])
    let n = 0
    const landed = replaceClipGraphics(project, clip.id, kept, { fps: project.settings.fps, sounds: PACK, newId: (p) => `${p}-${++n}` })
    expect(landed.problems).toEqual([])
    expect(landed.clipIds).toHaveLength(1)
    const g = landed.project.clips.find((c) => c.id === landed.clipIds[0])!
    const spec = g.graphic!
    const def = GRAPHIC_TEMPLATES[template]!
    expect(spec.data).toEqual(settle(f.transcript, GOOD[template]).kept[0].data)
    // One beat an element, rising: two sides, or a timeline's three rows.
    expect(spec.beats).toHaveLength(template === 'timeline' ? 3 : 2)
    expect([...spec.beats].sort((a, b) => a - b)).toEqual(spec.beats)
    expect(spec.seconds).toBeGreaterThanOrEqual(def.seconds.min)
    expect(spec.seconds).toBeLessThanOrEqual(def.seconds.max)
    expect(spec.place).toMatchObject({ auto: true })
    expect(spec.depth).toBeUndefined()
    expect(spec.hero).toBeUndefined()
    // Drawn whole at the settled frame: every string the data holds is drawn.
    const style = resolveGraphicStyle('clean')
    const fps = project.settings.fps
    const frame = graphicMovingFrames(spec, style, fps, g.duration) - 1
    const texts = flat(drawListAt(spec, style, frame, fps, SIZE, fakeMeasure, {}).items).filter((i): i is TextItem => i.kind === 'text').map((i) => i.text)
    const strings = template === 'timeline' ? (spec.data as Extract<GraphicData, { template: 'timeline' }>).items.flatMap((i) => [i.when, i.label]) : Object.values(spec.data).flatMap((v) => (typeof v === 'object' ? [v.label, v.value] : []))
    for (const s of strings) expect(texts.join(' '), s).toContain(s)
    // The tick, on the first element's beat, carrying the graphic's rule.
    const sounds = landed.project.clips.filter((c) => c.forGraphic === g.id)
    expect(sounds, 'the tick').toHaveLength(1)
    expect(sounds[0].generatedBy?.reason).toMatch(/^tick on "/u)
  })
})

/* ---------------------------------------------------------------- the eval */

const savedAnswer = (id: string, graphics: AnswerGraphic[]): EvalResponse => ({
  id,
  status: 200,
  ms: 1000,
  data: { choices: [{ message: { content: JSON.stringify({ reasoning: 'r', graphics }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 120 } }
})
const CONFIG = { provider: 'openai' as const, model: 'test-model' }

describe('the eval scores the three English talks with saved answers (§6.10, "Recorded per run")', () => {
  it('a truth of each may be named only where the talk offers it: the readers take step 6’s three, and refuse one no window offers', () => {
    // MUTATION (readEvalFixture's offered check removed): fails the refusal toThrow.
    expect(EVAL_TEMPLATE_IDS).toEqual(expect.arrayContaining(['timeline', 'before-after', 'versus']))
    for (const f of stepSixFixtures()) {
      const read = readEvalFixture(`/x/${f.id}.json`, { language: 'en', transcript: f.transcript, truth: f.truth, traps: f.traps })
      expect(read.truth).toEqual(f.truth)
    }
    const [ba] = stepSixFixtures().filter((f) => f.template === 'before-after')
    expect(() => readEvalFixture('/x/eval-z.json', { language: 'en', transcript: ba.transcript, truth: [{ sentence: 's01', template: 'versus' }], traps: [] })).toThrow(
      `eval-z.json: truth[0].template ${notOfferedTruthLine('versus')}`
    )
  })

  it('kept, bound and dropped, and why, counted by hand over the three talks: one right graphic each, one swapped, one unsaid, one not offered', async () => {
    // MUTATION (DROP_REASONS' 'order' class removed): fails the droppedByReason toEqual (the swap is 'other').
    const [tl, ba, vs] = stepSixFixtures()
    const answers: Record<string, AnswerGraphic[]> = {
      // The timeline right; a versus on a talk that offers none.
      [tl.id]: [TL_GOOD, ans({ sentence: 's01', template: 'versus', items: rows(['wedding', '2015'], ['editor', '2018']) })],
      // The before-and-after swapped (a fall drawn as a rise).
      [ba.id]: [ans({ sentence: 's01', template: 'before-after', items: rows(['After the course', '$4,000'], ['Before the course', '$1,500']) })],
      // The versus right, and one with a value never said.
      [vs.id]: [VS_GOOD, ans({ sentence: 's01', template: 'versus', items: rows(['Instagram', '700'], ['referrals', '350']) })]
    }
    const results = []
    for (const f of [tl, ba, vs]) {
      const id = `${f.id}.graphics.s00`
      const scored = await scoreGraphicsFixture(f, CONFIG, (rid) => (rid === id ? savedAnswer(id, answers[f.id]) : null))
      expect(scored.pending).toEqual([])
      results.push(scored.result)
    }
    const m = graphicsFigures(results, 'model')
    expect([m.proposed, m.kept, m.dropped, m.droppedByValidator, m.droppedAtLanding]).toEqual([5, 2, 3, 3, 0])
    expect(m.keptByTemplate).toEqual({ timeline: 1, versus: 1 })
    expect(m.proposedByTemplate).toEqual({ timeline: 1, versus: 3, 'before-after': 1 })
    expect(m.droppedByReason).toEqual({ 'not-offered': 1, order: 1, 'not-said': 1 })
    expect([m.hallucinations, m.truths, m.truthHits, m.trapsKept]).toEqual([1, 3, 2, 0])
    // The baseline side makes none of the three, so it hits none of their truths.
    const b = graphicsFigures(results, 'baseline')
    expect(Object.keys(b.keptByTemplate).filter((t) => (STEP_SIX_TEMPLATES as string[]).includes(t))).toEqual([])
    expect(b.truthHits).toBe(0)
  })

  it('classes the three’s own notes: a when that is not a year, two items, a missing side', () => {
    expect(dropReasonOf(notAYear('last year'))).toBe('not-a-number')
    expect(dropReasonOf(sideRowsNote('versus', 3))).toBe('template-rule')
    expect(dropReasonOf('a before-and-after needs its after side: a label and a value')).toBe('template-rule')
    expect(dropReasonOf("'2018' is not said in the order the timeline draws it in s01")).toBe('order')
  })
})
