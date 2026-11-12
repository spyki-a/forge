import { describe, expect, it } from 'vitest'
import { conforms, flatViolations, unsupportedKeywords, type FlatSchema, type ObjectSchema } from '@shared/director/conforms'
import {
  GRAPHICS_PASS,
  GRAPHIC_DECODE_CHARS,
  LIT_MAX,
  MAX_ANSWER_ITEMS,
  MAX_GRAPHICS,
  graphicsSchema,
  maxTokensForGraphics,
  type AnswerGraphic
} from '@shared/director/schemaGraphics'
import { GRAPHICS_SYSTEM, GRAPHIC_TEMPLATE_ROWS, UNDETERMINED_LINE, clockOf, graphicsLanguageLine, graphicsPrompt } from '@shared/director/promptGraphics'
import {
  decisionForGraphics,
  graphicsMenuFor,
  graphicsWindowName,
  pairSettled,
  quoteSpeakerFor,
  runGraphicsPass,
  settleGraphics,
  wordSourceOf,
  type GraphicsAsk,
  type GraphicsMenu
} from '@shared/director/run'
import { CLIPS_GRAPHIC_RULE, WRONG_ASSET_NOTE, applyGraphics, graphicDropsOf, lowerThirdFor } from '@shared/graphics/apply'
import { RETIMED_NOTE } from '@shared/graphics/beats'
import { NO_CLIP_NOTE } from '@shared/graphics/place'
import type { GraphicCandidate, KeptGraphic } from '@shared/graphics/template'
import { GRAPHIC_KEPT_CHARS, KEYWORD_MAX_WORDS, validateGraphics } from '@shared/director/validateGraphics'
import { MAX_CANDIDATES } from '@shared/director/menu'
import { baselineGraphics } from '@shared/director/baselineGraphics'
import { captionWindowMs } from '@shared/captions/placement'
import { SUBJECT_TRACK_VERSION, type SubjectTrack } from '@shared/reframe/types'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { capSegments, type Segment, type Transcript, type Word } from '@shared/transcript'

/*
 * The graphics pass's menu, prompt and schema (docs/CLIPS.md §6.6), lane T2b
 * piece 1; settleGraphics whole, pairSettled and decisionForGraphics, piece 2. Every transcript here is built as data; no model is called.
 */

const FPS = 30

/** A talk of `sentences`, one word every 400 ms, segment ids s00, s01, … (the T2a tests' `talk`). */
function talk(sentences: string[], options: { model?: string; language?: string; approximate?: boolean; confidence?: Record<string, number | null>; assetId?: string } = {}): Transcript {
  const words: Word[] = []
  const segments: Segment[] = []
  let index = 0
  sentences.forEach((text, k) => {
    const start = index
    for (const w of text.split(/\s+/u).filter(Boolean)) {
      words.push({ index, text: w, startMs: index * 400, endMs: index * 400 + 350, confidence: options.confidence?.[w] ?? null })
      index += 1
    }
    segments.push({ id: `s${String(k).padStart(2, '0')}`, startMs: start * 400, endMs: (index - 1) * 400 + 350, text, wordStart: start, wordEnd: index - 1 })
  })
  return {
    assetId: options.assetId ?? 'a',
    language: options.language ?? 'en',
    model: options.model ?? 'whisper-small',
    durationMs: index * 400,
    words,
    segments,
    ...(options.approximate ? { approximate: true } : {})
  }
}

function subjectTrack(width = 1080, height = 1920): SubjectTrack {
  return {
    key: '1:1',
    version: SUBJECT_TRACK_VERSION,
    width,
    height,
    durationMs: 600_000,
    shots: [{ startMs: 0, endMs: 600_000, score: 0 }],
    samples: [{ ms: 0, faces: [{ x: 0.4, y: 0.3, width: 0.2, height: 0.2, score: 0.9 }] }],
    perShot: [{}],
    detector: 'synthetic',
    scene: { threshold: 0.3, minShotMs: 500, backend: 'ffmpeg-select-rgb24' },
    at: '2026-11-11T00:00:00.000Z'
  }
}

/** One footage clip of asset 'a' on the first video track, showing [inPoint, inPoint + duration) of the file. */
function fixture(t: Transcript, patch: Partial<Clip> = {}, options: { track?: SubjectTrack } = {}): { project: Project; clip: Clip } {
  const asset: MediaAsset = {
    id: 'a', path: '/media/a.mp4', name: 'a.mp4', kind: 'video', durationFrames: FPS * 600,
    width: 1080, height: 1920, fps: FPS, hasVideo: true, hasAudio: true, size: 1
  }
  const base = emptyProject('graphics menu')
  const trackId = base.tracks.find((tr) => tr.kind === 'video')!.id
  const clip: Clip = {
    id: 'c', assetId: 'a', trackId, start: 0, duration: FPS * 600, inPoint: 0, volume: 1,
    transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR }, ...patch
  }
  return {
    clip,
    project: {
      ...base,
      settings: { ...base.settings, fps: FPS },
      assets: [asset],
      clips: [clip],
      transcripts: { a: t },
      ...(options.track ? { subjects: { a: options.track } } : {})
    }
  }
}

function menusOf(t: Transcript, patch: Partial<Clip> = {}, options: { track?: SubjectTrack } = {}): GraphicsMenu[] {
  const { project, clip } = fixture(t, patch, options)
  return graphicsMenuFor(project, clip, t)
}

/** Every property name and every enum value in a schema, walked recursively. */
function namesIn(schema: unknown): string[] {
  if (typeof schema !== 'object' || schema === null) return []
  const s = schema as Record<string, unknown>
  const out: string[] = []
  if (Array.isArray(s.enum)) out.push(...(s.enum as string[]))
  if (typeof s.properties === 'object' && s.properties !== null) {
    for (const [name, sub] of Object.entries(s.properties as Record<string, unknown>)) {
      out.push(name, ...namesIn(sub))
    }
  }
  if ('items' in s) out.push(...namesIn(s.items))
  return out
}

const TALK = talk(['We signed 40 clients this year.', 'Then we grew to 70 percent of the market.', 'Keep it simple, always.'])

/** One answer graphic, every unused field '' as the schema has it. */
function g(fields: Partial<AnswerGraphic> & Pick<AnswerGraphic, 'sentence' | 'template'>): AnswerGraphic {
  return { title: '', value: '', label: '', items: [], quote: '', words: '', lit: 0, why: 'it helps', ...fields }
}

describe('graphicsSchema: flat, reasoning first, required in declaration order', () => {
  const [menu] = menusOf(TALK, {}, { track: subjectTrack() })

  it('is flat and inside conforms.ts\' subset, constrained or not, and its size is printed', () => {
    for (const constrained of [true, false]) {
      const s = graphicsSchema(menu, { constrained })
      expect(unsupportedKeywords(s)).toEqual([])
      expect(flatViolations(s)).toEqual([])
      expect(Object.keys(s.properties)[0]).toBe('reasoning')
      expect(Object.keys(s.properties)).toEqual(s.required)
      const graphics = s.properties.graphics as { type: 'array'; items: ObjectSchema; minItems: number; maxItems: number }
      expect(graphics.minItems).toBe(0)
      expect(graphics.maxItems).toBe(MAX_GRAPHICS)
      expect(MAX_GRAPHICS).toBe(4)
      const item = graphics.items
      // §6.6's declaration order, exactly: these are the fields the decoder fills, in the order it fills them.
      expect(Object.keys(item.properties)).toEqual(['sentence', 'template', 'title', 'value', 'label', 'items', 'quote', 'words', 'lit', 'why'])
      expect(Object.keys(item.properties)).toEqual(item.required)
      const rows = item.properties.items as { type: 'array'; items: ObjectSchema; maxItems: number }
      expect(rows.maxItems).toBe(MAX_ANSWER_ITEMS)
      expect(MAX_ANSWER_ITEMS).toBe(6)
      expect(Object.keys(rows.items.properties)).toEqual(['label', 'value'])
      expect(Object.keys(rows.items.properties)).toEqual(rows.items.required)
    }
    const one = JSON.stringify(graphicsSchema(menu)).length
    const full = menusOf(talk(Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`)), {}, { track: subjectTrack() })[0]
    const most = JSON.stringify(graphicsSchema(full)).length
    console.log(`graphics@1 schema size: ${one} chars (3 sentences, 7 templates), ${most} chars (24 sentences, 7 templates), unconstrained ${JSON.stringify(graphicsSchema(menu, { constrained: false })).length}`)
  })

  it('constrained: the menu\'s ids and templates as enums, the decoded lengths, lit 0..3; unconstrained: none of them', () => {
    const s = graphicsSchema(menu)
    const item = (s.properties.graphics as { items: ObjectSchema }).items
    const p = item.properties as Record<string, FlatSchema & { enum?: string[]; maxLength?: number; minimum?: number; maximum?: number }>
    expect(p.sentence.enum).toEqual(menu.sentences.map((x) => x.id))
    expect(p.template.enum).toEqual(menu.templates)
    expect((s.properties.reasoning as { maxLength: number }).maxLength).toBe(300)
    expect([p.title.maxLength, p.value.maxLength, p.label.maxLength, p.quote.maxLength, p.words.maxLength, p.why.maxLength]).toEqual([60, 24, 60, 200, 60, 100])
    const row = (p.items as unknown as { items: ObjectSchema }).items.properties as Record<string, { maxLength: number }>
    expect([row.label.maxLength, row.value.maxLength]).toEqual([48, 24])
    expect(p.lit).toMatchObject({ type: 'integer', minimum: 0, maximum: 3 })
    expect(LIT_MAX).toBe(KEYWORD_MAX_WORDS - 1)
    // Decode limits are looser than what is kept (§6.6), field by field.
    const d = GRAPHIC_DECODE_CHARS
    const k = GRAPHIC_KEPT_CHARS
    for (const [decoded, kept] of [[d.title, k.title], [d.value, k.value], [d.label, k.label], [d.itemLabel, k.itemLabel], [d.itemValue, k.itemValue], [d.quote, k.quote], [d.words, k.words], [d.why, k.why]]) {
      expect(decoded).toBeGreaterThan(kept)
    }
    const loose = graphicsSchema(menu, { constrained: false })
    const looseItem = (loose.properties.graphics as { items: ObjectSchema }).items
    expect(JSON.stringify(loose)).not.toMatch(/"enum"|"maxLength"|"minimum"|"maximum"/u)
    expect(looseItem.properties.lit).toMatchObject({ type: 'integer' })
  })

  it('offers keyword\'s words and lit, and no name a model must never fill, in any property or enum', () => {
    for (const constrained of [true, false]) {
      const names = namesIn(graphicsSchema(menu, { constrained }))
      expect(names).toContain('words')
      expect(names).toContain('lit')
      if (constrained) expect(names).toContain('keyword')
      for (const never of [
        'lower-third', 'screen-card', 'parent', 'connector', 'anchor', 'depth', 'shape', 'speaker', 'name', 'role',
        'curve', 'ease', 'easing', 'motion', 'duration', 'seconds', 'start', 'place', 'third', 'box', 'beat', 'beats', 'sound', 'sounds', 'look', 'style'
      ]) {
        expect(names, `the schema offers '${never}'`).not.toContain(never)
      }
    }
  })

  it('the shape check: a parent written into an item, or a lit of 0.5, is the wrong shape; an id off the menu is not', () => {
    const loose = graphicsSchema(menu, { constrained: false })
    const steps = g({ sentence: 's00', template: 'steps', items: [{ label: 'a', value: '' }] })
    const withParent = { reasoning: 'r', graphics: [{ ...steps, items: [{ label: 'a', value: '', parent: 0 }] }] }
    expect(conforms(loose, withParent)).toEqual([{ path: '$.graphics[0].items[0].parent', message: 'is not a field the plan has' }])
    expect(validateGraphics(withParent, menu, TALK)).toEqual({
      rejected: 'The graphics are not the shape asked for — $.graphics[0].items[0].parent is not a field the plan has'
    })
    const half = { reasoning: 'r', graphics: [g({ sentence: 's00', template: 'keyword', words: 'clients', lit: 0.5 })] }
    expect(validateGraphics(half, menu, TALK)).toEqual({ rejected: 'The graphics are not the shape asked for — $.graphics[0].lit is 0.5, expected a whole number' })
    // An id off the menu and an out-of-range lit are one graphic's problem, never the pass's.
    const off = { reasoning: 'r', graphics: [g({ sentence: 's99', template: 'counter', value: '40', label: 'clients' }), g({ sentence: 's00', template: 'keyword', words: 'clients', lit: 7 })] }
    expect(conforms(loose, off)).toEqual([])
    expect(validateGraphics(off, menu, TALK)).not.toHaveProperty('rejected')
  })

  it('the pass and its token room', () => {
    expect(GRAPHICS_PASS).toBe('graphics@1')
    expect(maxTokensForGraphics(menu)).toBe(250 + 150 * 4)
  })
})

describe('graphicsPrompt: the SENTENCES table, the TEMPLATES table, the language line last', () => {
  const [menu] = menusOf(talk(Array.from({ length: 8 }, (_, i) => `Sentence ${i} says a lot of things here now.`)))

  it('the system prompt says each of §6.6\'s clauses', () => {
    for (const clause of [
      'mark the moments in a talk where a simple graphic would help a viewer',
      'a number, a comparison, steps, a line worth quoting, a thing on screen worth pointing at, a share of a whole, or a few words worth seeing',
      'You copy words',
      'never invent a number or a name',
      'never choose a look, a motion, a sound, a connector or a name: the app does',
      'At most four graphics',
      'empty list of graphics'
    ]) {
      expect(GRAPHICS_SYSTEM, clause).toContain(clause)
    }
    expect(graphicsPrompt(menu, 'en').system).toBe(GRAPHICS_SYSTEM)
  })

  it('the SENTENCES lines are `s07  0:42  "…"`, then the offered templates only, with §6.6\'s words', () => {
    const user = graphicsPrompt(menu, 'en').user.split('\n')
    expect(user[0]).toMatch(/^SENTENCES/u)
    // s07 starts at word 63 (9 words a sentence): 63 × 400 ms = 25.2 s.
    expect(user).toContain('s07  0:25  "Sentence 7 says a lot of things here now."')
    expect(user).toContain('s00  0:00  "Sentence 0 says a lot of things here now."')
    const at = user.findIndex((l) => l.startsWith('TEMPLATES'))
    expect(at).toBeGreaterThan(user.findIndex((l) => l.startsWith('s07')))
    // §6.6's TEMPLATES table, its "when" words written here as literals, one row for each offered template.
    const rows: Record<string, string> = {
      counter: 'counter — one number, said with what it counts — value, label',
      bars: 'bars — two to five numbers said as a comparison, in one unit — title, items',
      steps: 'steps — two to six steps or reasons said in order — title, items[].label',
      quote: 'quote — a line worth quoting, copied word for word from clause to clause — quote',
      ring: 'ring — a share of a whole, said as a percentage — value, label',
      keyword: 'keyword — one to four words the speaker stresses, copied exactly; lit is which of them to light, counting from 0 — words, lit'
    }
    const offered = user.slice(at + 1, user.length - 2)
    expect(offered).toEqual(['counter', 'bars', 'steps', 'quote', 'ring', 'keyword'].map((id) => rows[id]))
    expect(user.some((l) => l.startsWith('callout'))).toBe(false)
    expect(user.some((l) => /lower-third|screen-card/u.test(l))).toBe(false)
    const withTrack = graphicsPrompt(menusOf(TALK, {}, { track: subjectTrack() })[0], 'en').user.split('\n')
    expect(withTrack).toContain('callout — a thing on screen the speaker names — label')
    // Membership: a later step's template may rightly get a row; these seven have one, and the two never offered have none.
    for (const id of ['counter', 'bars', 'steps', 'quote', 'callout', 'ring', 'keyword'] as const) expect(GRAPHIC_TEMPLATE_ROWS[id], id).toBeDefined()
    for (const id of ['lower-third', 'screen-card'] as const) expect(GRAPHIC_TEMPLATE_ROWS[id], id).toBeUndefined()
  })

  it('the clock is m:ss, floored, minutes past 0 and past 9', () => {
    expect(clockOf(3600)).toBe('0:03')
    expect(clockOf(59_999)).toBe('0:59')
    expect(clockOf(72_000)).toBe('1:12')
    expect(clockOf(605_400)).toBe('10:05')
    // In the table: s10 of 10-word sentences starts at word 100, 100 × 400 ms = 40 s; s18 at word 180 = 72 s.
    const long = menusOf(talk(Array.from({ length: 20 }, (_, i) => `Sentence ${i} has exactly ten words in it right now.`)))[0]
    const user = graphicsPrompt(long, 'en').user.split('\n')
    expect(user).toContain('s18  1:12  "Sentence 18 has exactly ten words in it right now."')
  })

  it('every sentence of a full 24-sentence menu is in the SENTENCES table, once each, in order', () => {
    const [full] = menusOf(talk(Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`)))
    expect(full.sentences).toHaveLength(24)
    const user = graphicsPrompt(full, 'en').user.split('\n')
    const listed = [...user.join('\n').matchAll(/^(s\d\d(?:\.\d+)?)  /gmu)].map((m) => m[1])
    expect(listed).toEqual(full.sentences.map((s) => s.id))
  })

  it('the last line is the language, for a code and for the language\'s name, Telugu and Hindi included', () => {
    for (const [lang, says] of [
      ['en', 'Write all copy in English.'],
      ['English', 'Write all copy in English.'],
      ['te', 'Telugu script (తెలుగు)'],
      ['Telugu', 'Telugu script (తెలుగు)'],
      ['hi', 'Devanagari (हिन्दी)'],
      ['Hindi', 'Devanagari (हिन्दी)']
    ] as const) {
      const user = graphicsPrompt(menu, lang).user.split('\n')
      expect(user[user.length - 1], lang).toBe(graphicsLanguageLine(lang))
      expect(user[user.length - 1], lang).toContain(says)
      expect(user.filter((l) => l.startsWith('Write all copy')), lang).toHaveLength(1)
    }
  })

  it('a code that names no language (parseJson3\'s \'und\', \'auto\', nothing) is not named', () => {
    for (const lang of ['und', 'UND', 'auto', '', ' ']) {
      const user = graphicsPrompt(menu, lang).user.split('\n')
      expect(user[user.length - 1], JSON.stringify(lang)).toBe(UNDETERMINED_LINE)
      expect(user[user.length - 1]).toBe('Write all copy in the language of the sentences, in its own script.')
      expect(user[user.length - 1]).not.toMatch(/root|auto|English/u)
    }
  })
})

describe('graphicsMenuFor', () => {
  it('never offers lower-third or screen-card; callout only when the asset has a subject track', () => {
    const plain = menusOf(TALK)
    const tracked = menusOf(TALK, {}, { track: subjectTrack() })
    const wrongSize = menusOf(TALK, {}, { track: subjectTrack(720, 1280) })
    for (const m of [...plain, ...tracked, ...wrongSize]) {
      expect(m.templates).not.toContain('lower-third')
      expect(m.templates).not.toContain('screen-card')
      for (const id of ['counter', 'bars', 'steps', 'quote', 'ring', 'keyword'] as const) expect(m.templates).toContain(id)
      for (const later of ['timeline', 'before-after', 'versus', 'source']) expect(m.templates as string[]).not.toContain(later)
    }
    expect(plain[0].templates).not.toContain('callout')
    expect(wrongSize[0].templates).not.toContain('callout')
    expect(tracked[0].templates).toContain('callout')
    // And the schema built on the plain menu does not offer it either.
    expect(namesIn(graphicsSchema(plain[0]))).not.toContain('callout')
  })

  it('an untrimmed clip\'s menu is the capped sentences, as the validator\'s tests build it, ids the stretch finds', () => {
    // 40 words with no sentence mark: capped into pieces s00.1, s00.2, … (30 words or 15 s).
    const t = talk([Array.from({ length: 40 }, (_, i) => `w${i}`).join(' '), 'We signed 40 clients this year.'])
    const [menu, ...rest] = menusOf(t)
    expect(rest).toEqual([])
    expect(menu).toEqual({
      assetId: 'a',
      clipId: 'c',
      language: 'en',
      sentences: capSegments(t, 30, 15000).map((s) => ({ id: s.id, startMs: s.startMs, text: s.text, wordStart: s.wordStart, wordEnd: s.wordEnd })),
      templates: ['counter', 'bars', 'steps', 'quote', 'ring', 'keyword'],
      wordSource: 'whisper'
    })
    expect(menu.sentences.map((s) => s.id)).toContain('s00.2')
    const v = validateGraphics({ reasoning: 'r', graphics: [g({ sentence: 's01', template: 'counter', value: '40', label: 'clients' })] }, menu, t)
    expect('kept' in v && v.kept.length).toBe(1)
  })

  it('cuts a long clip into 24-sentence windows, one menu each, every sentence once and in order', () => {
    const t = talk(Array.from({ length: 50 }, (_, i) => `Sentence ${i} is here.`))
    const menus = menusOf(t)
    expect(MAX_CANDIDATES).toBe(24)
    expect(menus.map((m) => m.sentences.length)).toEqual([24, 24, 2])
    expect(menus.flatMap((m) => m.sentences.map((s) => s.id))).toEqual(t.segments.map((s) => s.id))
    for (const m of menus) expect(m.clipId).toBe('c')
    expect(menusOf(talk(Array.from({ length: 24 }, (_, i) => `Sentence ${i} is here.`))).map((m) => m.sentences.length)).toEqual([24])
  })

  it('a trimmed clip\'s menu holds only the words the clip shows', () => {
    // Nine words a sentence, 400 ms a word: s00 is words 0-8 (0-3.55 s), s01 9-17 (3.6-7.15 s), s02 18-26 (7.2-10.75 s), s03 27-35.
    const t = talk([
      'one two three four five six seven eight nine.',
      'alpha beta gamma delta epsilon zeta eta theta iota.',
      'red orange yellow green blue indigo violet black white.',
      'north south east west up down left right centre.'
    ])
    // In-point 5.0 s (150 frames) for 4.0 s: shows [5000, 9000) ms. Word 12 ('delta', 4800-5150) is cut into, and shown;
    // word 22 ('blue', 8800-9150) is shown; word 23 ('indigo', 9200) is not.
    const patch = { inPoint: 150, duration: 120, start: 30 }
    const [menu, ...rest] = menusOf(t, patch)
    expect(rest).toEqual([])
    expect(menu.sentences).toEqual([
      { id: 's01', startMs: 4800, text: 'delta epsilon zeta eta theta iota.', wordStart: 12, wordEnd: 17 },
      { id: 's02', startMs: 7200, text: 'red orange yellow green blue', wordStart: 18, wordEnd: 22 }
    ])
    // Every listed word is one the captions show (firstShownWord's test over the caption window).
    const w = captionWindowMs({ inPoint: 150, duration: 120 }, FPS)
    for (const s of menu.sentences) {
      for (const word of t.words.filter((x) => x.index >= s.wordStart && x.index <= s.wordEnd)) {
        expect(word.endMs > w.startMs && word.startMs < w.endMs, word.text).toBe(true)
      }
      for (const word of s.text.split(' ')) expect(t.words.find((x) => x.text === word)!.endMs).toBeGreaterThan(w.startMs)
    }
    // No speech in the clip's span, or another file's transcript: no menu.
    expect(menusOf(t, { inPoint: FPS * 60, duration: FPS * 5 })).toEqual([])
    const { project, clip } = fixture(t)
    expect(graphicsMenuFor(project, clip, { ...t, assetId: 'other' })).toEqual([])
  })

  it('wordSource for each transcript source, in agreement with the validator\'s proposals', () => {
    const said = ['We signed 40 clients this year.']
    const cases: [Transcript, GraphicsMenu['wordSource'], string | null][] = [
      [talk(said, { model: 'whisper-small' }), 'whisper', null],
      [talk(said, { model: 'whisper-small', confidence: { '40': 0.3 } }), 'whisper', 'whisper-unsure'],
      [talk(said, { model: 'whisper-small', confidence: { '40': 0.9 } }), 'whisper', null],
      [talk(said, { model: 'youtube-asr' }), 'youtube-asr', 'youtube-asr'],
      [talk(said, { model: 'youtube-lines', approximate: true }), 'youtube-lines', 'youtube-lines'],
      [talk(said, { model: 'youtube-lines' }), 'youtube-lines', 'youtube-lines'],
      [talk(said, { model: 'youtube-asr+lines' }), 'youtube-asr', 'youtube-asr'],
      [talk(said, { model: 'youtube-asr+lines', approximate: true }), 'youtube-lines', 'youtube-lines'],
      // approximate decides only inside a YouTube transcript (§6.6's YouTube bullet): a Whisper one stays 'whisper'.
      [talk(said, { model: 'faster-whisper small', approximate: true }), 'whisper', null]
    ]
    for (const [t, source, proposal] of cases) {
      const [menu] = menusOf(t)
      expect(menu.wordSource, t.model).toBe(source)
      expect(wordSourceOf(t)).toBe(source)
      const v = validateGraphics({ reasoning: 'r', graphics: [g({ sentence: 's00', template: 'counter', value: '40', label: 'clients' })] }, menu, t)
      const kept = 'kept' in v ? v.kept : []
      expect(kept, t.model).toHaveLength(1)
      expect(kept[0].proposal?.wordSource ?? null, `${t.model} ${JSON.stringify(t.words[2].confidence)}`).toBe(proposal)
    }
  })

  it('language from the transcript', () => {
    const t = talk(['మేము 40 క్లయింట్లను సంతకం చేసాము.'], { language: 'te' })
    expect(menusOf(t)[0].language).toBe('te')
    const user = graphicsPrompt(menusOf(t)[0], menusOf(t)[0].language).user.split('\n')
    expect(user[user.length - 1]).toContain('Telugu script')
  })
})

/* ------------------------------------------------------------- piece 2 */

/** A clip's answer for one menu, as the ask returns it. */
const answered = (...graphics: AnswerGraphic[]): { value: unknown; truncated: boolean } => ({ value: { reasoning: 'r', graphics }, truncated: false })

/** n sentences 'In week K we signed N clients today.' (8 words, 3.2 s each): a counter may sit on any of them. */
const weeks = (n: number): string[] => Array.from({ length: n }, (_, k) => `In week ${k} we signed ${k + 10} clients today.`)

/** A counter on sentence k of `weeks`. */
const counterOn = (k: number): AnswerGraphic => g({ sentence: `s${String(k).padStart(2, '0')}`, template: 'counter', value: String(k + 10), label: 'clients' })

/** Seventeen six-word filler sentences after the given ones: 40 s and more of clip, so rule 10 allows two graphics. */
const padded = (said: string[]): string[] => [...said, ...Array.from({ length: 17 }, () => 'The light was soft that day.')]

const FILLER = 'The light was soft that day.'

/** `a` as s00 and `b` as s03, two fillers between (`b` 7.2 s after `a`'s start), then `padded`'s. */
const apart = (a: string, b: string): string[] => padded([a, FILLER, FILLER, b])

describe('settleGraphics: one window rejected never takes the clip; the notes say which window', () => {
  const t = talk(weeks(30))
  const menus = menusOf(t)

  it('a long clip is two windows, and graphicsWindowName names each', () => {
    expect(menus).toHaveLength(2)
    expect(graphicsWindowName(menus[0])).toBe('sentences s00 to s23')
    expect(graphicsWindowName(menus[1])).toBe('sentences s24 to s29')
    expect(graphicsWindowName({ sentences: menus[1].sentences.slice(0, 1) })).toBe('sentence s24')
  })

  for (const [name, first] of [
    ['cut off at the token cap', { value: { reasoning: 'r', graphics: [counterOn(0)] }, truncated: true }],
    ['the wrong shape', { value: { reasoning: 'r', graphics: 'none' }, truncated: false }]
  ] as const) {
    it(`window 1 ${name}: window 2 still settles, and pairSettled keeps its graphic`, () => {
      const one = settleGraphics(first, menus[0], t)
      const two = settleGraphics(answered(counterOn(25)), menus[1], t)
      expect(one).toMatchObject({ kept: [], baseline: true })
      expect(one.rejected).toMatch(name === 'the wrong shape' ? /not the shape asked for/u : /ran out of room/u)
      expect(one.dropped[0]).toEqual({ path: '$', message: `no graphics for sentences s00 to s23: ${one.rejected}` })
      expect(two).toMatchObject({ baseline: false, rejected: null })
      expect(two.kept.map((k) => k.sentence)).toEqual(['s25'])

      const run = pairSettled([{ menu: menus[0], settled: one }, { menu: menus[1], settled: two }])
      expect(run.kept).toHaveLength(1)
      expect(run.kept[0]).toEqual({ clipId: 'c', assetId: 'a', candidate: two.kept[0] })
      // The model answered for window 2, so the run is not the baseline's; window 1's reason is kept.
      expect(run.settled.baseline).toBe(false)
      expect(run.settled.rejected).toBe(one.rejected)
      expect(run.settled.dropped).toContainEqual(one.dropped[0])
    })
  }

  it('with the baseline seam given, its note says the baseline is used for that window', () => {
    const one = settleGraphics({ value: answered().value, truncated: true }, menus[0], t, { baseline: () => [] })
    expect(one.dropped[0].message).toBe("the baseline's graphics are used for sentences s00 to s23: The model's graphics ran out of room before it finished")
  })
})

describe('settleGraphics: an out-of-range lit and a wrong-template field are repaired, an id off the menu drops one graphic, never the pass', () => {
  const t = talk(apart('We signed 40 clients this year.', 'Keep it simple always today.'))
  const [menu] = menusOf(t)

  it('lit 7 of two words lights the last; a counter that filled `quote` keeps its own fields; s99 drops alone', () => {
    const s = settleGraphics(
      answered(
        g({ sentence: 's00', template: 'counter', value: '40', label: 'clients', quote: 'We signed 40 clients' }),
        // Not graphics[0]'s template or text, so a drop read off the wrong index shows.
        g({ sentence: 's99', template: 'ring', value: '70%', label: 'brides' }),
        g({ sentence: 's03', template: 'keyword', words: 'simple always', lit: 7 })
      ),
      menu,
      t
    )
    expect(s.rejected).toBeNull()
    expect(s.baseline).toBe(false)
    expect(s.kept.map((k) => k.data)).toEqual([
      { template: 'counter', value: '40', label: 'clients' },
      { template: 'keyword', words: 'simple always', lit: 1 }
    ])
    expect(s.dropped).toContainEqual({ path: '$.graphics[0].quote', message: "graphic repaired: 'quote' is not a field of a counter — left out" })
    expect(s.dropped).toContainEqual({ path: '$.graphics[2].lit', message: 'graphic repaired: lit 7 is not one of the 2 words — the last one is lit' })
    expect(s.dropped).toContainEqual({ path: '$.graphics[1].sentence', message: "graphic dropped: 's99' is not a sentence on the menu" })
    // Only the off-menu graphic is a drop; the repairs are notes.
    expect(s.drops).toEqual([{ clipId: 'c', template: 'ring', text: '70%', reason: "'s99' is not a sentence on the menu" }])
  })

  it('a clean answer carries no repair note', () => {
    const s = settleGraphics(answered(g({ sentence: 's00', template: 'counter', value: '40', label: 'clients' })), menu, t)
    expect(s.dropped).toEqual([])
    expect(s.drops).toEqual([])
  })
})

describe('settleGraphics: spacing (rule 10) and the structured drops', () => {
  it('two counters 3.2 s apart: the earlier stays, the later is a note and a drop', () => {
    const t = talk(padded(weeks(2)))
    const [menu] = menusOf(t)
    const s = settleGraphics(answered(counterOn(1), counterOn(0)), menu, t)
    expect(s.kept.map((k) => k.sentence)).toEqual(['s00'])
    const reason = 'the counter on s01 is within 6 s of the one before — the earlier one stays'
    expect(s.dropped).toEqual([{ path: '$.graphics', message: `graphic dropped: ${reason}` }])
    expect(s.drops).toEqual([{ clipId: 'c', template: 'counter', text: '11', reason }])
  })

  it('a graphic dropped for two fields is one drop, its reasons joined', () => {
    const t = talk(padded(['We signed 40 clients this year.']))
    const [menu] = menusOf(t)
    const s = settleGraphics(answered(g({ sentence: 's00', template: 'counter', value: '45', label: 'brides' })), menu, t)
    expect(s.kept).toEqual([])
    expect(s.drops).toHaveLength(1)
    expect(s.drops[0]).toMatchObject({ clipId: 'c', template: 'counter', text: '45' })
    expect(s.dropped.length).toBe(2)
    expect(s.drops[0].reason).toBe("'45' is not said in s00; 'brides' is not said in s00")
  })
})

describe('settleGraphics: what is a proposal, per wordSource (§6.6, "What is placed without review")', () => {
  const said = apart('We signed 40 clients this year.', 'Keep it simple always today.')
  const counter = g({ sentence: 's00', template: 'counter', value: '40', label: 'clients' })
  const keyword = g({ sentence: 's03', template: 'keyword', words: 'simple', lit: 0 })
  const cases: [string, Transcript, string | null][] = [
    ['a YouTube ASR number', talk(said, { model: 'youtube-asr' }), 'youtube-asr'],
    ["a YouTube uploader's number", talk(said, { model: 'youtube-lines' }), 'youtube-lines'],
    ['a Whisper number under 0.5', talk(said, { confidence: { '40': 0.3 } }), 'whisper-unsure'],
    ['a Whisper number at 0.5', talk(said, { confidence: { '40': 0.5 } }), null],
    ['a corrected word (confidence null)', talk(said, { confidence: { '40': null } }), null]
  ]
  for (const [name, t, wordSource] of cases) {
    it(`${name}: ${wordSource === null ? 'trusted' : 'a proposal'}`, () => {
      const [menu] = menusOf(t)
      const s = settleGraphics(answered(counter, keyword), menu, t)
      expect(s.kept.map((k) => k.data.template)).toEqual(['counter', 'keyword'])
      expect(s.kept[0].proposal ?? null).toEqual(wordSource === null ? null : { reason: 'check-the-number', wordSource })
      // A keyword holds no number, so it is never a proposal, whatever the source.
      expect(s.kept[1].proposal).toBeUndefined()
    })
  }

  it('a YouTube number lands as a proposal, not on the timeline, through pairSettled and applyGraphics', () => {
    const t = talk(said, { model: 'youtube-asr' })
    const { project, clip } = fixture(t)
    const [menu] = graphicsMenuFor(project, clip, t)
    const run = pairSettled([{ menu, settled: settleGraphics(answered(counter, keyword), menu, t) }])
    let n = 0
    const out = applyGraphics(project, run.kept, [clip.id], CLIPS_GRAPHIC_RULE, { fps: FPS, newId: (p) => `${p}-${++n}` })
    const placed = out.project.clips.filter((c) => c.graphic)
    expect(placed.map((c) => c.graphic!.data.template)).toEqual(['keyword'])
    expect(out.project.graphicProposals?.map((p) => p.spec.data.template)).toEqual(['counter'])
    expect(out.project.graphicProposals?.[0].note).toBe('check the number: heard "40 clients"')
    // A proposal set aside is no drop, and neither is the sound library's note.
    expect(out.problems.some((p) => p.path === '$.sounds')).toBe(true)
    expect(graphicDropsOf(project, run.kept, [clip.id], out.problems)).toEqual([])
  })
})

describe('pairSettled: each kept candidate with its own menu’s clip and asset', () => {
  it('two clips of two assets; the run is the baseline only when every window was', () => {
    const ta = talk(padded(['We signed 40 clients this year.']), { assetId: 'a' })
    const tb = talk(padded(['We signed 70 clients this year.']))
    const [ma] = menusOf(ta)
    const mb: GraphicsMenu = { ...menusOf(tb)[0], assetId: 'b', clipId: 'c2' }
    const sa = settleGraphics(answered(g({ sentence: 's00', template: 'counter', value: '40', label: 'clients' })), ma, ta)
    const sb = settleGraphics(answered(g({ sentence: 's00', template: 'counter', value: '70', label: 'clients' })), mb, tb)
    const run = pairSettled([{ menu: ma, settled: sa }, { menu: mb, settled: sb }])
    expect(run.kept.map((k) => [k.clipId, k.assetId, (k.candidate.data as { value: string }).value])).toEqual([
      ['c', 'a', '40'],
      ['c2', 'b', '70']
    ])
    expect(run.settled.kept).toEqual([...sa.kept, ...sb.kept])
    expect(run.settled.baseline).toBe(false)

    const none = settleGraphics({ error: 'no model is set up' }, ma, ta)
    const both = pairSettled([{ menu: ma, settled: none }, { menu: mb, settled: settleGraphics({ error: 'no model is set up' }, mb, tb) }])
    expect(both.kept).toEqual([])
    expect(both.settled.baseline).toBe(true)
    expect(both.settled.rejected).toBe('no model is set up; no model is set up')
    // No windows (no speech in the span): no model was asked, so the run is the baseline's.
    expect(pairSettled([]).settled).toEqual({ kept: [], dropped: [], baseline: true, rejected: null, drops: [] })
  })
})

describe("the quote's speaker: the asset's Speaker, else a link's channel; a lower third never from the channel (§6.6, §16.31)", () => {
  const said = padded(['Fail fast and learn faster every day.'])
  const quote = g({ sentence: 's00', template: 'quote', quote: 'Fail fast and learn faster every day.' })
  const credit = { source: 'link' as const, title: 'A talk', author: 'Studio Channel', pageUrl: 'https://example.com/v', line: 'A talk — Studio Channel, https://example.com/v', attributionRequired: true, fetchedAt: '2026-11-11T00:00:00.000Z' }

  it('quoteSpeakerFor: the Speaker, then the channel, then nothing; a Speaker of spaces is none', () => {
    expect(quoteSpeakerFor({ speaker: 'Ana', credit })).toBe('Ana')
    expect(quoteSpeakerFor({ credit })).toBe('Studio Channel')
    expect(quoteSpeakerFor({ speaker: '  ', credit })).toBe('Studio Channel')
    expect(quoteSpeakerFor({ speaker: '' })).toBe('')
    expect(quoteSpeakerFor({ credit: { ...credit, author: null } })).toBe('')
    expect(quoteSpeakerFor(undefined)).toBe('')
  })

  it('a quote lands with the speaker settleGraphics is given; a lower third waits for a Speaker', () => {
    const t = talk(said, { model: 'youtube-asr' })
    const { project, clip } = fixture(t)
    const linked = { ...project, assets: project.assets.map((a) => ({ ...a, credit })) }
    const [menu] = graphicsMenuFor(linked, clip, t)
    const speaker = quoteSpeakerFor(linked.assets[0])
    const s = settleGraphics(answered(quote), menu, t, { speaker })
    expect(s.kept.map((k) => k.data)).toEqual([{ template: 'quote', kind: 'said', text: 'Fail fast and learn faster every day.', speaker: 'Studio Channel' }])
    expect(settleGraphics(answered(quote), menu, t).kept.map((k) => (k.data as { speaker: string }).speaker)).toEqual([''])
    expect(lowerThirdFor(linked, clip)).toBeNull()
    const named = { ...linked, assets: linked.assets.map((a) => ({ ...a, speaker: 'Ana' })) }
    expect(settleGraphics(answered(quote), menu, t, { speaker: quoteSpeakerFor(named.assets[0]) }).kept.map((k) => (k.data as { speaker: string }).speaker)).toEqual(['Ana'])
    expect(lowerThirdFor(named, clip)?.candidate.data).toEqual({ template: 'lower-third', name: 'Ana', role: '' })
  })

  it('a reported quote keeps the name the stretch says said it, whatever speaker is given', () => {
    const t = talk(padded(['Then Elon said: fail fast.']))
    const [menu] = menusOf(t)
    const s = settleGraphics(answered(g({ sentence: 's00', template: 'quote', quote: 'fail fast.' })), menu, t, { speaker: 'Studio Channel' })
    expect(s.kept.map((k) => (k.data as { speaker: string }).speaker)).toEqual(['Elon'])
  })
})

describe('decisionForGraphics: decisionFor2’s twin', () => {
  const t = talk(padded(['We signed 40 clients this year.']))
  const [menu] = menusOf(t)
  const settled = settleGraphics(answered(g({ sentence: 's00', template: 'counter', value: '40', label: 'clients' })), menu, t)
  const now = new Date('2026-11-11T10:00:00.000Z')

  it('the record: id, pass, one op of graphics, dropped and baseline, the model at the top, createdAt', () => {
    const rec = decisionForGraphics(settled, { id: 'google/gemma-4-e2b', runtime: 'openai' }, { id: 'decision-1', now })
    expect(rec.id).toBe('decision-1')
    expect(rec.pass).toBe('graphics@1')
    expect(rec.pass).toBe(GRAPHICS_PASS)
    expect(rec.model).toEqual({ id: 'google/gemma-4-e2b', runtime: 'openai' })
    expect(rec.createdAt).toBe('2026-11-11T10:00:00.000Z')
    expect(rec.ops).toHaveLength(1)
    const op = rec.ops[0] as Record<string, unknown>
    expect(op).toMatchObject({ graphics: settled.kept, dropped: settled.dropped, baseline: false })
    expect(Object.keys(op)).not.toContain('model')
    expect(decisionForGraphics(settled, { id: 'm', runtime: 'ollama' }).id).toMatch(/^decision-[0-9a-z]+-[0-9a-z]{1,5}$/u)
  })

  it("model.id is 'baseline' when no model answered: no model, or a rejected pass", () => {
    expect(decisionForGraphics(settled, null, { now }).model).toEqual({ id: 'baseline', runtime: 'none' })
    const rejected = settleGraphics({ value: answered().value, truncated: true }, menu, t)
    const rec = decisionForGraphics(rejected, { id: 'google/gemma-4-e2b', runtime: 'openai' }, { now })
    expect(rec.model).toEqual({ id: 'baseline', runtime: 'none' })
    expect(rec.ops[0]).toMatchObject({ baseline: true, graphics: [] })
  })

  it('nothing of a key, a header or a credentialed address reaches the record', () => {
    const model = {
      id: 'gpt-x',
      runtime: 'openai',
      apiKey: 'sk-SECRET-1234567890',
      headers: { Authorization: 'Bearer sk-SECRET-1234567890' },
      baseUrl: 'https://user:hunter2@api.example.com/v1'
    }
    const text = JSON.stringify(decisionForGraphics(settled, model, { now }))
    for (const secret of ['sk-SECRET', 'Bearer', 'Authorization', 'hunter2', 'apiKey', 'baseUrl', 'api.example.com']) expect(text).not.toContain(secret)
  })
})

describe("graphicDropsOf: applyGraphics' drops, structured from its problems", () => {
  it('a graphic whose clip is gone, with a dash in its words; a retimed clip drops each of its graphics', () => {
    const t = talk(apart('We signed 40 clients this year.', 'Keep it simple always today.'))
    const { project, clip } = fixture(t)
    const cand = (data: KeptGraphic['candidate']['data'], words: number[]): KeptGraphic['candidate'] => ({ sentence: 's00', data, bound: words, beatWords: words, why: 'w', source: 'model' })
    const kept: KeptGraphic[] = [
      { clipId: 'gone', assetId: 'a', candidate: cand({ template: 'keyword', words: 'fast — slow', lit: 0 }, [2]) }
    ]
    const out = applyGraphics(project, kept, [], CLIPS_GRAPHIC_RULE, { fps: FPS, newId: (p) => `${p}-1` })
    expect(out.problems.map((p) => p.message)).toContain(`graphic dropped: the keyword "fast — slow" — ${NO_CLIP_NOTE}`)
    expect(graphicDropsOf(project, kept, [], out.problems)).toEqual([{ clipId: 'gone', template: 'keyword', text: 'fast — slow', reason: NO_CLIP_NOTE }])

    const fast = { ...project, clips: project.clips.map((c) => ({ ...c, speed: 2 })) }
    const two: KeptGraphic[] = [
      { clipId: clip.id, assetId: 'a', candidate: cand({ template: 'counter', value: '40', label: 'clients' }, [2, 3]) },
      { clipId: clip.id, assetId: 'a', candidate: cand({ template: 'keyword', words: 'simple always', lit: 0 }, [20]) }
    ]
    const slow = applyGraphics(fast, two, [], CLIPS_GRAPHIC_RULE, { fps: FPS, newId: (p) => `${p}-1` })
    expect(slow.problems.filter((p) => p.message.includes(RETIMED_NOTE))).toHaveLength(1)
    expect(graphicDropsOf(fast, two, [], slow.problems)).toEqual([
      { clipId: clip.id, template: 'counter', text: '40', reason: RETIMED_NOTE },
      { clipId: clip.id, template: 'keyword', text: 'simple always', reason: RETIMED_NOTE }
    ])
  })

  it("a lower third dropped at '$.covered[j]' is read off the project as given", () => {
    const t = talk(padded(['We signed 40 clients this year.']))
    const { project, clip } = fixture(t)
    const named = { ...project, assets: project.assets.map((a) => ({ ...a, speaker: 'Ana' })), clips: project.clips.map((c) => ({ ...c, speed: 2 })) }
    const out = applyGraphics(named, [], [clip.id], CLIPS_GRAPHIC_RULE, { fps: FPS, newId: (p) => `${p}-1` })
    expect(graphicDropsOf(named, [], [clip.id], out.problems)).toEqual([{ clipId: clip.id, template: 'lower-third', text: 'Ana', reason: RETIMED_NOTE }])
  })
})

/* ------------------------------------------------- piece 2, the fixer's cases */

describe('settleGraphics: a proposal is not spaced and spaces nothing (rule 10 counts what the app would place)', () => {
  // s00 a number, s01 2.4 s later, s04 9.6 s in; over 50 s of clip, so rule 10 allows two graphics.
  const said = padded(['We signed 40 clients this year.', 'Keep it simple always today.', FILLER, FILLER, 'The garden was quiet that evening.'])
  const counter = g({ sentence: 's00', template: 'counter', value: '40', label: 'clients' })
  const simple = g({ sentence: 's01', template: 'keyword', words: 'simple', lit: 0 })
  const quiet = g({ sentence: 's04', template: 'keyword', words: 'quiet', lit: 0 })

  it('a YouTube number 2.4 s before a keyword: both kept, the number a proposal; two trusted graphics still fit beside it', () => {
    const t = talk(said, { model: 'youtube-asr' })
    const [menu] = menusOf(t)
    const s = settleGraphics(answered(counter, simple, quiet), menu, t)
    expect(s.kept.map((k) => [k.sentence, k.data.template, k.proposal?.reason ?? null])).toEqual([
      ['s00', 'counter', 'check-the-number'],
      ['s01', 'keyword', null],
      ['s04', 'keyword', null]
    ])
    expect(s.drops).toEqual([])
    // Through applyGraphics: the keywords are placed, the number waits for Keep.
    const { project, clip } = fixture(t)
    const run = pairSettled([{ menu: graphicsMenuFor(project, clip, t)[0], settled: s }])
    let n = 0
    const out = applyGraphics(project, run.kept, [clip.id], CLIPS_GRAPHIC_RULE, { fps: FPS, newId: (p) => `${p}-${++n}` })
    expect(out.project.clips.filter((c) => c.graphic).map((c) => (c.graphic!.data as { words: string }).words)).toEqual(['simple', 'quiet'])
    expect(out.project.graphicProposals?.map((p) => p.spec.data.template)).toEqual(['counter'])
  })

  it('the same answer from Whisper: the number is trusted and spaces the keyword 2.4 s after it out', () => {
    const t = talk(said)
    const [menu] = menusOf(t)
    const s = settleGraphics(answered(counter, simple, quiet), menu, t)
    expect(s.kept.map((k) => k.sentence)).toEqual(['s00', 's04'])
    expect(s.drops.map((d) => d.text)).toEqual(['simple'])
  })
})

describe('the run of no windows names no model', () => {
  it('pairSettled([]) is the baseline, and its record says no model answered', () => {
    const run = pairSettled([])
    expect(run.kept).toEqual([])
    expect(run.settled.baseline).toBe(true)
    const rec = decisionForGraphics(run.settled, { id: 'google/gemma-4-e2b', runtime: 'openai' }, { id: 'd', now: new Date('2026-11-11T10:00:00.000Z') })
    expect(rec.model).toEqual({ id: 'baseline', runtime: 'none' })
    expect(rec.ops[0]).toMatchObject({ graphics: [], baseline: true })
  })
})

describe('settleGraphics: the baseline route', () => {
  const t = talk(padded(['We signed 40% of clients.']))
  const [menu] = menusOf(t)
  const good: GraphicCandidate = { sentence: 's00', data: { template: 'ring', value: '40%', label: 'clients' }, bound: [], beatWords: [], why: 'a share', source: 'baseline' }
  const bad: GraphicCandidate = { ...good, data: { template: 'ring', value: '45%', label: 'clients' } }

  it("a baseline graphic the validator drops is a structured drop", () => {
    const s = settleGraphics({ value: answered().value, truncated: true }, menu, t, { baseline: () => [bad, good] })
    expect(s.kept).toHaveLength(1)
    expect(s.drops).toEqual([{ clipId: 'c', template: 'ring', text: '45%', reason: "'45%' is not said in s00" }])
  })

  it("a baseline quote lands with the app's speaker", () => {
    const q = talk(padded(['Fail fast and learn faster every day.']))
    const [m] = menusOf(q)
    const quote: GraphicCandidate = {
      sentence: 's00',
      data: { template: 'quote', kind: 'said', text: 'Fail fast and learn faster every day.', speaker: '' },
      bound: [],
      beatWords: [],
      why: 'a line',
      source: 'baseline'
    }
    const s = settleGraphics({ error: 'no model is set up' }, m, q, { baseline: () => [quote], speaker: 'Ana' })
    expect(s.kept.map((k) => (k.data as { speaker: string }).speaker)).toEqual(['Ana'])
  })
})

describe("settleGraphics: the speaker it is given, trimmed; quoteSpeakerFor reads a link's channel only", () => {
  it("a speaker of spaces is no speaker; a credit that is not a link's names nobody", () => {
    const t = talk(padded(['Fail fast and learn faster every day.']))
    const [menu] = menusOf(t)
    const s = settleGraphics(answered(g({ sentence: 's00', template: 'quote', quote: 'Fail fast and learn faster every day.' })), menu, t, { speaker: '   ' })
    expect(s.kept.map((k) => (k.data as { speaker: string }).speaker)).toEqual([''])
    const credit = { source: 'stock', title: 'A photo', author: 'A Photographer', pageUrl: 'https://example.com/p', line: 'l', attributionRequired: true, fetchedAt: '2026-11-11T00:00:00.000Z' }
    expect(quoteSpeakerFor({ credit } as never)).toBe('')
  })
})

describe('settleGraphics: every kind of wrong-template field is a repair note, never a drop', () => {
  const t = talk(padded(['We signed 40 clients this year.', FILLER, FILLER, 'First plan then shoot then edit.']))
  const [menu] = menusOf(t)

  it("a counter's lit and title, a steps row's value: each a note at its own path, the graphic kept", () => {
    const s = settleGraphics(
      answered(
        g({ sentence: 's00', template: 'counter', value: '40', label: 'clients', lit: 3, title: 'Growth' }),
        g({ sentence: 's03', template: 'steps', title: '', items: [{ label: 'plan', value: '1' }, { label: 'shoot', value: '' }, { label: 'edit', value: '' }] })
      ),
      menu,
      t
    )
    expect(s.kept.map((k) => k.data.template)).toEqual(['counter', 'steps'])
    expect(s.drops).toEqual([])
    expect(s.dropped).toContainEqual({ path: '$.graphics[0].lit', message: "graphic repaired: 'lit' is not a field of a counter — left out" })
    expect(s.dropped).toContainEqual({ path: '$.graphics[0].title', message: "graphic repaired: 'title' is not a field of a counter — left out" })
    expect(s.dropped).toContainEqual({ path: '$.graphics[1].items[0].value', message: "graphic repaired: 'items[0].value' is not a field of a steps — left out" })
  })

  it("an off-menu bars graphic's drop text is its title", () => {
    const s = settleGraphics(answered(g({ sentence: 's99', template: 'bars', title: 'Our year', items: [{ label: 'a', value: '1' }] })), menu, t)
    expect(s.drops).toEqual([{ clipId: 'c', template: 'bars', text: 'Our year', reason: "'s99' is not a sentence on the menu" }])
  })
})

describe('graphicDropsOf: a retimed clip drops only its own graphics, each once', () => {
  const t = talk(apart('We signed 40 clients this year.', 'Keep it simple always today.'))
  const cand = (data: KeptGraphic['candidate']['data'], words: number[]): KeptGraphic['candidate'] => ({ sentence: 's00', data, bound: words, beatWords: words, why: 'w', source: 'model' })

  it('a second clip, not retimed, keeps its graphic', () => {
    const { project, clip } = fixture(t, { speed: 2, duration: FPS * 300 })
    const { speed: _retimed, ...plain } = clip
    const other: Clip = { ...plain, id: 'c2', start: FPS * 300 }
    const two = { ...project, clips: [...project.clips, other] }
    const kept: KeptGraphic[] = [
      { clipId: clip.id, assetId: 'a', candidate: cand({ template: 'counter', value: '40', label: 'clients' }, [2, 3]) },
      { clipId: 'c2', assetId: 'a', candidate: cand({ template: 'keyword', words: 'simple always', lit: 0 }, [20]) }
    ]
    const out = applyGraphics(two, kept, [], CLIPS_GRAPHIC_RULE, { fps: FPS, newId: (p) => `${p}-1` })
    expect(out.project.clips.filter((c) => c.graphic && c.graphic.data.template === 'keyword')).toHaveLength(1)
    expect(graphicDropsOf(two, kept, [], out.problems)).toEqual([{ clipId: clip.id, template: 'counter', text: '40', reason: RETIMED_NOTE }])
  })

  for (const order of ['wrong file first', 'wrong file after the retime'] as const) {
    it(`a graphic dropped for its own reason is not dropped again for the retime (${order})`, () => {
      const { project, clip } = fixture(t, { speed: 2 })
      const wrong: KeptGraphic = { clipId: clip.id, assetId: 'zz', candidate: cand({ template: 'counter', value: '40', label: 'clients' }, [2, 3]) }
      const timed: KeptGraphic = { clipId: clip.id, assetId: 'a', candidate: cand({ template: 'keyword', words: 'simple always', lit: 0 }, [20]) }
      const kept = order === 'wrong file first' ? [wrong, timed] : [timed, wrong]
      const out = applyGraphics(project, kept, [], CLIPS_GRAPHIC_RULE, { fps: FPS, newId: (p) => `${p}-1` })
      const drops = graphicDropsOf(project, kept, [], out.problems)
      expect(drops).toHaveLength(2)
      expect(drops).toContainEqual({ clipId: clip.id, template: 'counter', text: '40', reason: WRONG_ASSET_NOTE })
      expect(drops).toContainEqual({ clipId: clip.id, template: 'keyword', text: 'simple always', reason: RETIMED_NOTE })
    })
  }
})

describe('runGraphicsPass (lane T4: the one loop Find, Direct and the eval run)', () => {
  /*
   * Thirty sentences, so two windows (24 a menu): s00 to s23 and s24 to s29. Every sentence but s25 is eleven words
   * with no number, so the baseline finds nothing in it; s25 holds a percent, so window 2's baseline is its ring.
   */
  const LONG = 'The light was soft and warm all through that long day.'
  const SENTENCES = Array.from({ length: 30 }, (_, i) => (i === 25 ? 'We saw 40% of couples return.' : LONG))
  const EMPTY = { value: { reasoning: 'r', graphics: [] }, truncated: false }

  it('asks each window once, returns every part, falls to the baseline for the window whose ask threw, and hands the ask\'s notes back', async () => {
    const t = talk(SENTENCES)
    const { project, clip } = fixture(t)
    const asked: string[] = []
    const ask: GraphicsAsk = async (_request, menu) => {
      asked.push(menu.sentences[0].id)
      if (menu.sentences[0].id === 's24') throw new Error('the bridge broke')
      return { answer: EMPTY, model: { id: 'm1', runtime: 'openai' }, notes: ['asked again'] }
    }
    const r = await runGraphicsPass(project, [clip], ask, { baseline: baselineGraphics })
    expect(asked).toEqual(['s00', 's24'])
    expect(r.parts.map((p) => [p.menu.sentences[0].id, p.menu.sentences[p.menu.sentences.length - 1].id, p.transcript === t, p.settled.baseline])).toEqual([
      ['s00', 's23', true, false],
      ['s24', 's29', true, true]
    ])
    expect(r.parts[0].settled.kept).toEqual([])
    expect(r.parts[1].settled.kept.map((k) => [k.sentence, k.data, k.source])).toEqual([['s25', { template: 'ring', value: '40%', label: 'couples' }, 'baseline']])
    expect(r.parts[1].settled.dropped[0].message).toBe("the baseline's graphics are used for sentences s24 to s29: the bridge broke")
    expect(r.pair.kept.map((k) => [k.clipId, k.candidate.sentence])).toEqual([['c', 's25']])
    expect(r.model).toEqual({ id: 'm1', runtime: 'openai' })
    expect(r.notes).toEqual(['asked again'])
  })

  it('keeps the last model that answered when a later window\'s ask names none; null when none ever did', async () => {
    const t = talk(SENTENCES)
    const { project, clip } = fixture(t)
    const named: GraphicsAsk = async (_r, menu) => ({ answer: EMPTY, model: menu.sentences[0].id === 's00' ? { id: 'm1', runtime: 'openai' } : null })
    expect((await runGraphicsPass(project, [clip], named, { baseline: baselineGraphics })).model).toEqual({ id: 'm1', runtime: 'openai' })
    const none: GraphicsAsk = async () => ({ answer: { error: 'No model is set up' }, model: null })
    const r = await runGraphicsPass(project, [clip], none, { baseline: baselineGraphics })
    expect(r.model).toBeNull()
    expect(r.notes).toEqual([])
    expect(r.parts.map((p) => p.settled.baseline)).toEqual([true, true])
  })
})
