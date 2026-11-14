import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BASELINE_KEYWORD_MAX_WORDS,
  BASELINE_WHY,
  baselineGraphics
} from '@shared/director/baselineGraphics'
import { runGraphicsPass, settleGraphics, type GraphicsMenu } from '@shared/director/run'
import { CLIPS_GRAPHIC_RULE, applyGraphics } from '@shared/graphics/apply'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type Project } from '@shared/timeline'
import { MAX_GRAPHICS, type AnswerGraphic } from '@shared/director/schemaGraphics'
import { GRAPHIC_KEPT_CHARS, validateBaseline, validateGraphics } from '@shared/director/validateGraphics'
import type { GraphicCandidate, GraphicData, GraphicTemplateId } from '@shared/graphics/template'
import type { Segment, Transcript, Word } from '@shared/transcript'

/*
 * The graphics baseline (docs/CLIPS.md §6.10, "The baseline (no model)"),
 * lane T4 piece 1. Every transcript is data built here, in English written for
 * the test; the Hindi and Telugu sentences are the drawing fixtures' own
 * (tests/fixtures/graphics/specs.json), and the nested talks are the three
 * English nested fixtures. Every expected candidate is written by hand.
 */

/** `sentences`, one word every 400 ms, segment ids s00, s01, … (the director tests' `talk`). */
function talk(sentences: string[], language = 'en'): Transcript {
  const words: Word[] = []
  const segments: Segment[] = []
  let index = 0
  sentences.forEach((text, k) => {
    const start = index
    for (const w of text.split(/\s+/u).filter(Boolean)) {
      words.push({ index, text: w, startMs: index * 400, endMs: index * 400 + 350, confidence: null })
      index += 1
    }
    segments.push({ id: `s${String(k).padStart(2, '0')}`, startMs: start * 400, endMs: (index - 1) * 400 + 350, text, wordStart: start, wordEnd: index - 1 })
  })
  return { assetId: 'talk', language, model: 'whisper-small', durationMs: index * 400, words, segments }
}

const ALWAYS: GraphicTemplateId[] = ['counter', 'bars', 'steps', 'quote', 'ring', 'keyword']

/** The menu of every sentence, as `graphicsMenuFor` builds one for a clip that shows them all. */
function menuOf(t: Transcript, templates: GraphicTemplateId[] = ALWAYS): GraphicsMenu {
  return {
    assetId: t.assetId,
    clipId: 'shot',
    language: t.language,
    sentences: t.segments.map((s) => ({ id: s.id, startMs: s.startMs, text: s.text, wordStart: s.wordStart, wordEnd: s.wordEnd })),
    templates: [...templates],
    wordSource: 'whisper'
  }
}

const run = (sentences: string[], language = 'en'): GraphicCandidate[] => {
  const t = talk(sentences, language)
  return baselineGraphics(t, menuOf(t))
}
const shapes = (c: GraphicCandidate[]): [string, GraphicData][] => c.map((g) => [g.sentence, g.data])

const FIXTURES = join(__dirname, 'fixtures', 'graphics')
const specData = (id: string): Record<string, string> => {
  const specs = JSON.parse(readFileSync(join(FIXTURES, 'specs.json'), 'utf8')).specs as { id: string; spec: { data: Record<string, string> } }[]
  return specs.find((s) => s.id === id)!.spec.data
}
const specText = (id: string): string => specData(id).text

describe('the four rules (§6.10)', () => {
  it('a sentence with a % gives a ring: the number as said in digits, said as words in digits, the content word it is said of', () => {
    expect(shapes(run(['We saw 40% of couples return.']))).toEqual([['s00', { template: 'ring', value: '40%', label: 'couples' }]])
    // Rule 4's value of "Forty percent", in digits; the label the first content word after it in its clause.
    expect(shapes(run(['Forty percent of our couples booked again.']))).toEqual([['s00', { template: 'ring', value: '40%', label: 'couples' }]])
    expect(run(['We saw 40% of couples return.'])[0]).toMatchObject({ why: BASELINE_WHY.ring, source: 'baseline' })
  })

  it('a number with a currency gives a counter', () => {
    expect(shapes(run(['We charged $1,200 for the album.']))).toEqual([['s00', { template: 'counter', value: '$1,200', label: 'album' }]])
    // A currency said as a word stays as said; the label the content word after it.
    expect(shapes(run(['It cost 500 rupees in total.']))).toEqual([['s00', { template: 'counter', value: '500 rupees', label: 'total' }]])
    // Rule 4's value of "forty dollars", in digits with its sign.
    expect(shapes(run(['It was forty dollars an album.']))).toEqual([['s00', { template: 'counter', value: '$40', label: 'album' }]])
  })

  it('a percent beats a counter in the same sentence; with no ring offered, the counter', () => {
    expect(shapes(run(['We kept 40% of the $40 fee.']))).toEqual([['s00', { template: 'ring', value: '40%', label: 'fee' }]])
    const t = talk(['We kept 40% of the $40 fee.'])
    expect(shapes(baselineGraphics(t, menuOf(t, ['counter'])))).toEqual([['s00', { template: 'counter', value: '$40', label: 'fee' }]])
  })

  it('a sign said apart from its digits is drawn joined to them, so the validator reads one number', () => {
    const t = talk(['We saw 40 % of couples return.'])
    const out = baselineGraphics(t, menuOf(t))
    expect(shapes(out)).toEqual([['s00', { template: 'ring', value: '40%', label: 'couples' }]])
    expect(validateBaseline(out, menuOf(t), t).dropped).toEqual([])
    // A digit percent said in words stays as said; with no content word after it, the label is the one before.
    expect(shapes(run(['Prices rose 40 percent.']))).toEqual([['s00', { template: 'ring', value: '40 percent', label: 'rose' }]])
  })

  it('a value longer than a value is drawn falls to its digits, which the validator keeps either way', () => {
    const t = talk(['We raised 1.2 million dollars for the charity.'])
    const m = menuOf(t)
    const out = baselineGraphics(t, m)
    // "1.2 million dollars" is 19 characters; GRAPHIC_KEPT_CHARS.value is 16.
    expect(GRAPHIC_KEPT_CHARS.value).toBe(16)
    expect(shapes(out)).toEqual([['s00', { template: 'counter', value: '$1200000', label: 'charity' }]])
    expect(validateBaseline(out, m, t).dropped).toEqual([])
    const asModel = validateGraphics(
      { reasoning: 'r', graphics: [{ sentence: 's00', template: 'counter', title: '', value: '$1200000', label: 'charity', items: [], quote: '', words: '', lit: 0, why: 'w' }] },
      m,
      t
    )
    expect('kept' in asModel && asModel.dropped).toEqual([])
  })

  it('outside English a number\'s label is its clause\'s words, as the drawing fixtures write them (no English function-word list there)', () => {
    // Each sentence is a drawing fixture's own value then its own label (tests/fixtures/graphics/specs.json).
    for (const [id, lang] of [['counter-hi', 'hi'], ['ring-hi', 'hi'], ['ring-te', 'te']] as const) {
      const d = specData(id)
      const t = talk([`${d.value} ${d.label}`], lang)
      const out = baselineGraphics(t, menuOf(t))
      expect(shapes(out), id).toEqual([['s00', { template: d.template, value: d.value, label: d.label }]])
      expect(validateBaseline(out, menuOf(t), t).dropped, id).toEqual([])
    }
  })

  it('a number with no unit and no currency gives nothing (eleven words, so no keyword either)', () => {
    expect(run(['We shot 40 weddings in a long busy season this year.'])).toEqual([])
    // Eight words: no counter, and the keyword rule gives its last word instead.
    expect(shapes(run(['We shot 40 weddings in one busy year.']))).toEqual([['s00', { template: 'keyword', words: 'year', lit: 0 }]])
  })

  it('two or more consecutive sentences opening with ordinals give steps: the middle one cited, a fixed title, the connector and parents from tree.ts', () => {
    expect(shapes(run(['First, pack the bags.', 'Second, check the schedule.', 'Third, eat breakfast.']))).toEqual([
      ['s01', { template: 'steps', title: 'Step by step', items: [{ label: 'pack the bags', parent: -1 }, { label: 'check the schedule', parent: -1 }, { label: 'eat breakfast', parent: -1 }], connector: 'line' }]
    ])
    // "step one": two items, flat, so no connector (tree.ts connectorFor: 'none' for two).
    expect(shapes(run(['Step one, pack the bags.', 'Step two, check the light.']))).toEqual([
      ['s01', { template: 'steps', title: 'Step by step', items: [{ label: 'pack the bags', parent: -1 }, { label: 'check the light', parent: -1 }], connector: 'none' }]
    ])
  })

  it('steps counted off by their own ordinals are siblings: a sub-count in the first item\'s sentence nests nothing, and the validator keeps them flat', () => {
    // "Second" and "Third" are the speaker's own count of top-level items; a sub-count ("two parts") never hangs an
    // item counted off by an ordinal under the one before (tree.ts). Flat, three items, so the connector is a line.
    const t = talk(['First, the plan, in two parts.', 'Second, the budget.', 'Third, the timeline.'])
    const flat = { template: 'steps', title: 'Step by step', items: [{ label: 'plan', parent: -1 }, { label: 'budget', parent: -1 }, { label: 'timeline', parent: -1 }], connector: 'line' }
    const out = baselineGraphics(t, menuOf(t))
    expect(shapes(out)).toEqual([['s01', flat]])
    // validateBaseline recomputes every parent with treeParents (§6.7): it must land flat too.
    expect(validateBaseline(out, menuOf(t), t).kept.map((k) => k.data)).toEqual([flat])
  })

  it('"First of all" counts nothing off: no step "all"', () => {
    // s00 is no item, so s01's ordinal stands alone: no steps. Each sentence gives its keyword instead
    // ("you" is a function word, so the fewest last words holding a content word are "thank you").
    expect(shapes(run(['First of all, thank you.', 'Second, check the schedule.']))).toEqual([
      ['s00', { template: 'keyword', words: 'thank you', lit: 1 }],
      ['s01', { template: 'keyword', words: 'schedule', lit: 0 }]
    ])
  })

  it('a run of four ordinals is one steps of its first three (the cited sentence\'s stretch); the fourth sentence gives nothing', () => {
    expect(shapes(run(['First, pack bags.', 'Second, eat food.', 'Third, drive cars.', 'Fourth, shoot film.']))).toEqual([
      ['s01', { template: 'steps', title: 'Step by step', items: [{ label: 'pack bags', parent: -1 }, { label: 'eat food', parent: -1 }, { label: 'drive cars', parent: -1 }], connector: 'line' }]
    ])
  })

  it('ordinals that are not consecutive give no steps; one ordinal alone gives none', () => {
    const gap = run(['First, pack the bags.', 'The light was soft and warm all through that long day.', 'Second, check the schedule.'])
    expect(gap.filter((c) => c.data.template === 'steps')).toEqual([])
    expect(run(['First, pack the bags.']).filter((c) => c.data.template === 'steps')).toEqual([])
  })

  it('a short English sentence ending on a content word gives a keyword of its last words, lit the last', () => {
    expect(shapes(run(['Keep it simple always today.']))).toEqual([['s00', { template: 'keyword', words: 'today', lit: 0 }]])
    // The last word is a function word, so is the one before: the fewest last words that hold a content word, three.
    expect(shapes(run(['Love is all you have.']))).toEqual([['s00', { template: 'keyword', words: 'all you have', lit: 2 }]])
    // Exactly eight words still gives one.
    expect(BASELINE_KEYWORD_MAX_WORDS).toBe(8)
    expect(shapes(run(['We drove home slowly after the long wedding.']))).toEqual([['s00', { template: 'keyword', words: 'wedding', lit: 0 }]])
  })

  it('a nine-word sentence, a question and a sentence ending on function words give no keyword', () => {
    expect(run(['We drove home very slowly after the long wedding.'])).toEqual([])
    expect(run(['Is the light good today?'])).toEqual([])
    expect(run(['This is it.'])).toEqual([])
    expect(run(['It is so for you.'])).toEqual([])
    // A negator is no content word: it never becomes the keyword.
    expect(run(['That was not.'])).toEqual([])
  })

  it('the keyword is English only by its tag: "und" and "es" give none, "en-GB" and "en_US" do', () => {
    expect(run(['Keep it simple always today.'], 'und')).toEqual([])
    expect(run(['Keep it simple always today.'], 'es')).toEqual([])
    for (const tag of ['en-GB', 'en_US']) expect(shapes(run(['Keep it simple always today.'], tag)), tag).toEqual([['s00', { template: 'keyword', words: 'today', lit: 0 }]])
  })

  it('Hindi and Telugu get no baseline keyword (the drawing fixtures’ quotes, six and seven words)', () => {
    expect(run([specText('quote-hi')], 'hi')).toEqual([])
    expect(run([specText('quote-te')], 'te')).toEqual([])
  })
})

describe('what the baseline never makes', () => {
  const MANY = [
    'We saw 40% of couples return.',
    'The light was soft and warm all through that long day.',
    'We charged $1,200 for the album.',
    'The light was soft and warm all through that long day.',
    'First, pack the bags.',
    'Second, check the schedule.',
    'The light was soft and warm all through that long day.',
    'Keep it simple always today.'
  ]

  it('never a lower-third, a callout or a quote, whatever the menu offers', () => {
    const t = talk(MANY)
    const out = baselineGraphics(t, menuOf(t, ['counter', 'bars', 'steps', 'quote', 'callout', 'ring', 'keyword', 'lower-third']))
    expect(out.map((c) => c.data.template)).toEqual(['ring', 'counter', 'steps', 'keyword'])
  })

  it('never a template the menu does not offer', () => {
    const t = talk(MANY)
    expect(baselineGraphics(t, menuOf(t, ['counter', 'bars', 'quote'])).map((c) => c.data.template)).toEqual(['counter'])
    // Only keywords offered: a sentence whose ring, counter or step is not offered gives its keyword if it has one.
    expect(shapes(baselineGraphics(t, menuOf(t, ['keyword'])))).toEqual([
      ['s00', { template: 'keyword', words: 'return', lit: 0 }],
      ['s02', { template: 'keyword', words: 'album', lit: 0 }],
      ['s04', { template: 'keyword', words: 'bags', lit: 0 }],
      ['s05', { template: 'keyword', words: 'schedule', lit: 0 }],
      ['s07', { template: 'keyword', words: 'today', lit: 0 }]
    ])
  })

  it('is deterministic: two calls deep-equal, and the same with every object’s keys in reverse order', () => {
    const t = talk(MANY)
    const m = menuOf(t)
    const first = baselineGraphics(t, m)
    expect(baselineGraphics(t, m)).toEqual(first)
    const reversed = <T>(o: T): T =>
      Array.isArray(o) ? (o.map(reversed) as T) : o && typeof o === 'object' ? (Object.fromEntries(Object.entries(o).reverse().map(([k, v]) => [k, reversed(v)])) as T) : o
    const t2 = reversed(t)
    const m2 = reversed(m)
    expect(Object.keys(t2)[0]).toBe('segments')
    expect(baselineGraphics(t2, m2)).toEqual(first)
  })
})

describe('validated the same way (§6.7)', () => {
  const CLEAN = [
    'We saw 40% of couples return.',
    'It was forty dollars an album.',
    'First, the plan, in two parts.',
    'Second, the budget.',
    'Third, the timeline.',
    'Keep it simple always today.',
    'Love is all you have.'
  ]

  it('every candidate of a clean transcript survives validateBaseline unchanged, with no note', () => {
    const t = talk(CLEAN)
    const m = menuOf(t)
    const out = baselineGraphics(t, m)
    expect(out.map((c) => c.data.template)).toEqual(['ring', 'counter', 'steps', 'keyword', 'keyword'])
    const v = validateBaseline(out, m, t)
    expect(v.dropped).toEqual([])
    expect(v.kept.map((k) => [k.sentence, k.data, k.source])).toEqual(out.map((c) => [c.sentence, c.data, 'baseline']))
  })

  it('and survives validateGraphics unchanged when written as a model answer', () => {
    const t = talk(CLEAN)
    const m = menuOf(t)
    const out = baselineGraphics(t, m)
    const answer = (c: GraphicCandidate): AnswerGraphic => {
      const g: AnswerGraphic = { sentence: c.sentence, template: c.data.template, title: '', value: '', label: '', items: [], quote: '', words: '', lit: 0, why: c.why }
      const d = c.data
      if (d.template === 'ring' || d.template === 'counter') return { ...g, value: d.value, label: d.label }
      if (d.template === 'steps') return { ...g, title: d.title, items: d.items.map((i) => ({ label: i.label, value: '' })) }
      if (d.template === 'keyword') return { ...g, words: d.words, lit: d.lit }
      throw new Error(`no answer form for ${d.template}`)
    }
    // An answer holds at most MAX_GRAPHICS (four); the fifth candidate goes as an answer of its own.
    expect(MAX_GRAPHICS).toBe(4)
    expect(out).toHaveLength(5)
    for (const part of [out.slice(0, 4), out.slice(4)]) {
      const v = validateGraphics({ reasoning: 'r', graphics: part.map(answer) }, m, t)
      expect('rejected' in v).toBe(false)
      if ('rejected' in v) return
      expect(v.dropped).toEqual([])
      expect(v.kept.map((k) => [k.sentence, k.data])).toEqual(part.map((c) => [c.sentence, c.data]))
    }
  })

  it('a negated percent is made by the baseline and dropped by the validator', () => {
    const t = talk(['Not 40% of couples rebook.'])
    const m = menuOf(t)
    const out = baselineGraphics(t, m)
    // The baseline makes it: the rule reads a percent, not what is said of it.
    expect(shapes(out)).toEqual([['s00', { template: 'ring', value: '40%', label: 'couples' }]])
    // The validator drops it, with its reason.
    const v = validateBaseline(out, m, t)
    expect(v.kept).toEqual([])
    expect(v.dropped.map((p) => p.message)).toContain("graphic dropped: '40%' is said negated in s00")
    // And through the seam: a rejected window settles to none of it, and says why.
    const s = settleGraphics({ error: 'No model is set up' }, m, t, { baseline: baselineGraphics })
    expect(s.kept).toEqual([])
    expect(s.drops.map((d) => [d.template, d.text])).toEqual([['ring', '40%']])
  })
})

describe('the nested English fixtures (§6.10\'s nested set; tree.ts on the baseline\'s items)', () => {
  const nested = (n: number): { transcript: Transcript; items: string[]; parents: number[] } =>
    JSON.parse(readFileSync(join(FIXTURES, `nested-en-${n}.json`), 'utf8'))
  const stepsOf = (t: Transcript): GraphicCandidate[] => baselineGraphics(t, menuOf(t)).filter((c) => c.data.template === 'steps')

  it('the baseline finds an enumeration only where each item opens its own sentence, so none of the three matches its fixture', () => {
    // nested-en-1: "First, the plan …", "Second, the shoot itself.", "Third, the edit.": three top-level items,
    // flat, as the fixture's own top level is (plan, shoot, edit all -1); the fixture's two children, the budget and
    // the timeline, are said inside the plan's sentence, where no ordinal opens them, so the baseline lists neither.
    const one = nested(1)
    const oneFlat = { template: 'steps', title: 'Step by step', items: [{ label: 'plan', parent: -1 }, { label: 'shoot itself', parent: -1 }, { label: 'edit', parent: -1 }], connector: 'line' }
    expect(stepsOf(one.transcript).map((c) => c.data)).toEqual([oneFlat])
    // And so it lands: the validator's own treeParents keeps it flat.
    const oneMenu = menuOf(one.transcript)
    expect(validateBaseline(stepsOf(one.transcript), oneMenu, one.transcript).kept.map((k) => k.data)).toEqual([oneFlat])
    expect(one.parents).toEqual([-1, 0, 0, -1, -1])
    // nested-en-2: "Step one, …", "Step two, …", "Step three, …": three items; "three pieces" is more than the one
    // item after it, so the list stays flat; the fixture's three sub-items are said inside step two's sentence.
    const two = nested(2)
    expect(stepsOf(two.transcript).map((c) => c.data)).toEqual([
      {
        template: 'steps',
        title: 'Step by step',
        items: [{ label: 'pack the bags the night before', parent: -1 }, { label: 'schedule', parent: -1 }, { label: 'eat a real breakfast', parent: -1 }],
        connector: 'line'
      }
    ])
    expect(two.parents).toEqual([-1, -1, 1, 1, 1, -1])
    // nested-en-3: "The first way …", "The second way …" open with "The", not an ordinal: no steps.
    expect(stepsOf(nested(3).transcript)).toEqual([])
  })
})

describe('the proposal bar on the baseline route (§6.6, §6.12): every number heard from an approximate source waits for Keep', () => {
  /**
   * Two sentences 42 s apart on a 50 s clip, so the spacing and the
   * per-20 s count keep both when they are trusted: a percent (the
   * baseline's ring) and a currency amount (its counter). The baseline
   * makes no bars (§6.10's four rules), so ring and counter are every
   * numeric template it can land. Each number's word is unsure (0.3) when
   * `unsure`; every other word is sure.
   */
  const SENTENCES: [number, string][] = [
    [0, 'We saw 40% of couples return.'],
    [42_000, 'We charged $1,200 for the album.']
  ]
  function heard(model: string, approximate: boolean, unsure: boolean): Transcript {
    const words: Word[] = []
    const segments: Segment[] = []
    SENTENCES.forEach(([at, text], k) => {
      const start = words.length
      text.split(' ').forEach((w, j) => {
        const sure = !(unsure && /\d/u.test(w))
        words.push({ index: words.length, text: w, startMs: at + j * 400, endMs: at + j * 400 + 350, confidence: sure ? 0.95 : 0.3 })
      })
      segments.push({ id: `s${String(k).padStart(2, '0')}`, startMs: at, endMs: words[words.length - 1].endMs, text, wordStart: start, wordEnd: words.length - 1 })
    })
    return { assetId: 'talk', language: 'en', model, durationMs: 50_000, words, segments, ...(approximate ? { approximate: true } : {}) }
  }
  function projectOf(t: Transcript): { project: Project; clip: Clip } {
    const base = emptyProject('proposals')
    const clip: Clip = { id: 'shot', assetId: 'talk', trackId: 'v1', start: 0, duration: 1500, inPoint: 0, volume: 1, transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR } }
    const asset = { id: 'talk', path: '/m/talk.mp4', name: 'talk.mp4', kind: 'video' as const, durationFrames: 1500, width: 1080, height: 1920, fps: 30, hasVideo: true, hasAudio: true, size: 1 }
    return { clip, project: { ...base, settings: { ...base.settings, fps: 30 }, assets: [asset], clips: [clip], transcripts: { talk: t } } }
  }
  /** Find graphics with no model, as the store runs it: the baseline through `runGraphicsPass`, then `applyGraphics`. */
  async function find(t: Transcript): Promise<Project> {
    const { project, clip } = projectOf(t)
    const run = await runGraphicsPass(project, [clip], async () => ({ answer: { error: 'No model is set up' }, model: null }), { baseline: baselineGraphics })
    let n = 0
    return applyGraphics(project, run.pair.kept, [], CLIPS_GRAPHIC_RULE, { fps: 30, newId: (prefix) => `${prefix}-${++n}` }).project
  }
  const NUMERIC = ['counter', 'ring']
  const landedNumbers = (p: Project): string[] => p.clips.flatMap((c) => (c.graphic && NUMERIC.includes(c.graphic.data.template) ? [c.graphic.data.template] : []))

  it('a YouTube uploader’s track, YouTube’s speech track and an unsure Whisper word: every ring and counter is a proposal, none lands without Keep', async () => {
    const sources: [string, Transcript][] = [
      ['youtube-lines', heard('youtube-lines', true, false)],
      ['youtube-asr', heard('youtube-asr', false, false)],
      ['whisper-unsure', heard('whisper-small', false, true)]
    ]
    for (const [wordSource, t] of sources) {
      const p = await find(t)
      expect(landedNumbers(p), wordSource).toEqual([])
      const waiting = p.graphicProposals ?? []
      expect(waiting.map((w) => w.spec.data.template).sort(), wordSource).toEqual(['counter', 'ring'])
      for (const w of waiting) expect(w.spec.proposal, wordSource).toEqual({ reason: 'check-the-number', wordSource })
    }
  })

  it('and with sure Whisper words the same talk lands both, so the case above is not empty by accident', async () => {
    const p = await find(heard('whisper-small', false, false))
    expect(landedNumbers(p).sort()).toEqual(['counter', 'ring'])
    expect(p.graphicProposals ?? []).toEqual([])
  })
})
