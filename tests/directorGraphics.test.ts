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
import { graphicsMenuFor, wordSourceOf, type GraphicsMenu } from '@shared/director/run'
import { GRAPHIC_KEPT_CHARS, KEYWORD_MAX_WORDS, validateGraphics } from '@shared/director/validateGraphics'
import { MAX_CANDIDATES } from '@shared/director/menu'
import { captionWindowMs } from '@shared/captions/placement'
import { SUBJECT_TRACK_VERSION, type SubjectTrack } from '@shared/reframe/types'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { capSegments, type Segment, type Transcript, type Word } from '@shared/transcript'

/*
 * The graphics pass's menu, prompt and schema (docs/CLIPS.md §6.6), lane T2b
 * piece 1. Every transcript here is built as data; no model is called.
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
