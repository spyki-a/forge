import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PICKED_WORDS_WHY, baselineGraphics, sentenceGraphic } from '@shared/director/baselineGraphics'
import { graphicsMenuFor, settleByHand, type GraphicsMenu } from '@shared/director/run'
import { NOTHING_TO_DRAW_NOTE, graphicFromWords, pickForGraphic, type WordsPick } from '@shared/director/fromWords'
import { CLIPS_GRAPHIC_RULE } from '@shared/graphics/apply'
import { ON_SCREEN_REASON } from '@shared/graphics/budget'
import { clipSourceWindow, clipWords } from '@shared/edit/clipIt'
import type { GraphicCandidate } from '@shared/graphics/template'
import type { Segment, Transcript, Word } from '@shared/transcript'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'

/*
 * Try-out 1 (2026-11-15), piece 5: a graphic added from the transcript by
 * hand, the pure half. One sentence read as the baseline reads it (taste
 * limits off), picked words as a keyword, the validator's refusal as a
 * dropped row, placement through Add's path. English transcripts are
 * synthetic, built from the session's own script lines; the Hindi and Telugu
 * sentences are the drawing fixtures' own (tests/fixtures/graphics/specs.json),
 * read at test time, and nothing here writes a Hindi or Telugu word.
 */

const FPS = 30

function talk(sentences: string[], language = 'en', assetId = 'talk', gapMs = 250): Transcript {
  const words: Word[] = []
  const segments: Segment[] = []
  sentences.forEach((text, k) => {
    const first = words.length
    for (const w of text.split(/\s+/u).filter(Boolean)) {
      const i = words.length
      words.push({ index: i, text: w, startMs: i * gapMs, endMs: i * gapMs + 200, confidence: 0.95 })
    }
    segments.push({ id: `s${String(k).padStart(2, '0')}`, startMs: first * gapMs, endMs: (words.length - 1) * gapMs + 200, text, wordStart: first, wordEnd: words.length - 1 })
  })
  return { assetId, language, model: 'whisper-small', durationMs: words.length * gapMs, words, segments }
}

function setup(sentences: string[], language = 'en', seconds = 60, extra: Partial<Clip> = {}): { project: Project; clip: Clip; t: Transcript } {
  const base = emptyProject('from words')
  const trackId = base.tracks.find((tr) => tr.kind === 'video')!.id
  const asset: MediaAsset = { id: 'talk', path: '/media/talk.mp4', name: 'talk.mp4', kind: 'video', durationFrames: FPS * 120, width: 1080, height: 1920, fps: FPS, hasVideo: true, hasAudio: true, size: 1 }
  const clip: Clip = { id: 'shot', assetId: 'talk', trackId, start: 0, duration: Math.round(FPS * seconds), inPoint: 0, volume: 1, transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR }, ...extra }
  const t = talk(sentences, language)
  return { clip, t, project: { ...base, settings: { ...base.settings, width: 1080, height: 1920, fps: FPS }, assets: [asset], clips: [clip], transcripts: { talk: t } } }
}

const menuOf = (project: Project, clip: Clip, t: Transcript): GraphicsMenu => {
  const menus = graphicsMenuFor(project, clip, t)
  expect(menus).toHaveLength(1)
  return menus[0]
}
const readOne = (sentences: string[], id: string, picked: [number, number] | null = null, language = 'en'): GraphicCandidate | null => {
  const { project, clip, t } = setup(sentences, language)
  return sentenceGraphic(t, menuOf(project, clip, t), id, picked)
}

const specs = (): { id: string; spec: { data: Record<string, string> } }[] =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'graphics', 'specs.json'), 'utf8')).specs
const specText = (id: string): string => specs().find((s) => s.id === id)!.spec.data.text

const RING = 'Forty percent of my couples book me a year ahead.'
const COUNTER = 'A full wedding costs two thousand five hundred dollars.'
const STEPS = ['First, charge your batteries.', 'Second, clear your cards.', 'Third, check the venue.']
const LIGHT = 'Light matters more than gear.'
const NEGATED = 'I do not charge five hundred dollars for an album.'
const WHAT_IF = 'If I charged ten thousand dollars, nobody would book.'
const THANKS = 'First of all, thank you for watching.'

describe('one sentence read as the baseline reads it (sentenceGraphic)', () => {
  it('a percent gives a ring and a currency amount a counter, as Find would', () => {
    expect(readOne([RING], 's00')!.data).toEqual({ template: 'ring', value: '40%', label: 'couples' })
    const counter = readOne([COUNTER], 's00')!
    expect(counter.data).toMatchObject({ template: 'counter', value: '$2500' })
    expect(counter.source).toBe('baseline')
  })

  it('a run of ordinal sentences starting at the one chosen gives steps; from its last there is no run, so its tail keyword', () => {
    const all = readOne(STEPS, 's00')!
    expect(all.data.template).toBe('steps')
    expect(all.data.template === 'steps' && all.data.items.map((i) => i.label)).toEqual(['charge your batteries', 'clear your cards', 'check the venue'])
    const fromSecond = readOne(STEPS, 's01')!
    expect(fromSecond.data.template === 'steps' && fromSecond.data.items.map((i) => i.label)).toEqual(['clear your cards', 'check the venue'])
    expect(readOne(STEPS, 's02')!.data).toEqual({ template: 'keyword', words: 'venue', lit: 0 })
  })

  it('the keyword rule’s taste limits are off: a courtesy line, a filler, one word and a pause cut each give their tail, which Find refuses', () => {
    for (const [line, words] of [
      [THANKS, 'watching'],
      ['People mix those up.', 'up'],
      ['Okay.', 'Okay'],
      ['Last year I shot', 'shot']
    ] as const) {
      const { project, clip, t } = setup([line])
      const menu = menuOf(project, clip, t)
      expect(baselineGraphics(t, menu), line).toEqual([])
      expect(sentenceGraphic(t, menu, 's00')!.data, line).toEqual({ template: 'keyword', words, lit: 0 })
    }
  })

  it('picked words are a keyword of exactly those words, in English', () => {
    // "more than gear" are words 2..4 of s00.
    const c = readOne([LIGHT], 's00', [2, 4])!
    expect(c.data).toEqual({ template: 'keyword', words: 'more than gear', lit: 2 })
    expect(c.why).toBe(PICKED_WORDS_WHY)
    // Only the chosen sentence's words: a pick reaching past it is held to it.
    expect(readOne([LIGHT, RING], 's00', [3, 6])!.data).toEqual({ template: 'keyword', words: 'than gear', lit: 1 })
  })

  it.each([
    ['quote-hi', 'hi'],
    ['quote-te', 'te']
  ] as const)('picked words are a keyword of exactly those words in %s, read from the drawing fixture, and the validator keeps it', (id, lang) => {
    const sentence = specText(id)
    const said = sentence.split(/\s+/u)
    const { project, clip, t } = setup([sentence], lang)
    const menu = menuOf(project, clip, t)
    // Without a pick there is no keyword outside English (no function-word list to find a tail by).
    expect(sentenceGraphic(t, menu, 's00')).toBeNull()
    const c = sentenceGraphic(t, menu, 's00', [1, 2])!
    expect(c.data).toEqual({ template: 'keyword', words: `${said[1]} ${said[2]}`, lit: 1 })
    const settled = settleByHand(c, menu, t)
    expect(settled.drop).toBeNull()
    expect(settled.kept!.candidate.data).toEqual(c.data)
    // A keyword binds where its words are said: the first picked word.
    expect(settled.kept!.candidate.bound).toContain(1)
  })

  it('a sentence not on the menu, or picked words with nothing to draw, give nothing', () => {
    expect(readOne([LIGHT], 's09')).toBeNull()
    expect(readOne(['Light matters — more.'], 's00', [2, 2])).toBeNull()
  })
})

describe('the tile’s pick as the whole transcript’s words (pickForGraphic)', () => {
  // A clip that starts at s01 ("Second, ..." word 4), so the rows' positions are not the transcript's indices.
  const { project, t } = setup(['Zero one two three.', ...STEPS])
  const clip: Clip = { ...project.clips[0], inPoint: Math.round((4 * 250 * FPS) / 1000), duration: FPS * 10 }
  const cw = clipWords(t, clipSourceWindow(clip, FPS))!

  it('reads through the clip’s first word: positions count from 0 in the rows, indices from 0 in the transcript', () => {
    expect(cw.first).toBe(4)
    // Row 0 is s01, "Second, clear your cards.", positions 0..3: the whole row is its sentence.
    expect(pickForGraphic(t, cw, { from: 0, to: 3 })).toEqual({ word: 4, words: null })
    // "your cards." inside it, positions 2..3, are transcript words 6..7.
    expect(pickForGraphic(t, cw, { from: 2, to: 3 })).toEqual({ word: 6, words: [6, 7] })
  })

  it('whole rows, or a pick across a row’s edge, choose the first row’s sentence', () => {
    expect(pickForGraphic(t, cw, { from: 0, to: 7 })).toEqual({ word: 4, words: null })
    expect(pickForGraphic(t, cw, { from: 2, to: 5 })).toEqual({ word: 6, words: null })
  })
})

describe('the validator’s refusal as a dropped row, and the Add path (graphicFromWords)', () => {
  const pickOf = (word: number, words: [number, number] | null = null): WordsPick => ({ word, words })

  it('a negated amount is not placed: it comes back as a dropped row with its reason and piece 4’s Add, timed on the words it was refused for', () => {
    const { project } = setup([NEGATED])
    const out = graphicFromWords(project, 'shot', pickOf(0), { fps: FPS })
    expect(out.outcome).toBe('listed')
    if (out.outcome !== 'listed') return
    expect(out.drop.reason).toContain('said negated')
    expect(out.drop.template).toBe('counter')
    expect(out.drop.add).toBeDefined()
    // "five" is word 4.
    expect(out.drop.add!.candidate.beatWords).toEqual([4])
  })

  it('a what-if amount comes back as a dropped row too', () => {
    const { project } = setup([WHAT_IF])
    const out = graphicFromWords(project, 'shot', pickOf(0), { fps: FPS })
    expect(out.outcome === 'listed' && out.drop.reason).toContain('what-if')
  })

  it('a picked keyword longer than a keyword is drawn is listed with its reason and no Add', () => {
    const line = 'We photographed extraordinarily beautiful celebrations everywhere across the country.'
    const { project } = setup([line])
    const out = graphicFromWords(project, 'shot', pickOf(1, [1, 6]), { fps: FPS })
    expect(out.outcome).toBe('listed')
    expect(out.outcome === 'listed' && out.drop.add).toBeUndefined()
  })

  it('a kept graphic lands through Add’s path: under Find’s rule, no proposal, on its own words, and within 6 s of another graphic', () => {
    const { project } = setup([RING, LIGHT])
    const first = graphicFromWords(project, 'shot', pickOf(0), { fps: FPS })
    expect(first.outcome).toBe('added')
    if (first.outcome !== 'added') return
    const ring = first.project.clips.find((c) => c.id === first.clipIds[0])!
    expect(ring.graphic!.data).toEqual({ template: 'ring', value: '40%', label: 'couples' })
    expect(ring.generatedBy!.rule).toBe(CLIPS_GRAPHIC_RULE)
    expect(ring.graphic!.proposal).toBeUndefined()
    // "gear" (word 14, 3.5 s) is within 6 s of the ring: Find's gap would drop it, the owner's add does not read it.
    const second = graphicFromWords(first.project, 'shot', pickOf(14, [14, 14]), { fps: FPS })
    expect(second.outcome).toBe('added')
    if (second.outcome !== 'added') return
    const kw = second.project.clips.find((c) => c.id === second.clipIds[0])!
    expect(kw.graphic!.data).toEqual({ template: 'keyword', words: 'gear', lit: 0 })
    expect(kw.graphic!.grounding!.words).toEqual([14])
  })

  it('another graphic on screen still refuses it, and the project is not changed', () => {
    const { project } = setup([RING, LIGHT])
    const first = graphicFromWords(project, 'shot', pickOf(0), { fps: FPS })
    if (first.outcome !== 'added') throw new Error(first.outcome)
    // "couples" (word 4, 1.0 s) is under the ring's frames.
    const again = graphicFromWords(first.project, 'shot', pickOf(4, [4, 4]), { fps: FPS })
    expect(again).toEqual({ outcome: 'refused', reason: ON_SCREEN_REASON })
  })

  it('nothing to draw says so in a note: a Hindi sentence with no number and no pick, a word the clip does not show, no clip', () => {
    const hi = setup([specText('quote-hi')], 'hi')
    expect(graphicFromWords(hi.project, 'shot', pickOf(0), { fps: FPS })).toEqual({ outcome: 'nothing', note: NOTHING_TO_DRAW_NOTE })
    const { project } = setup([LIGHT])
    expect(graphicFromWords(project, 'shot', pickOf(99), { fps: FPS })).toEqual({ outcome: 'nothing', note: NOTHING_TO_DRAW_NOTE })
    expect(graphicFromWords(project, 'gone', pickOf(0), { fps: FPS })).toEqual({ outcome: 'nothing', note: NOTHING_TO_DRAW_NOTE })
  })
})
