import type { Segment, Transcript, Word } from '@shared/transcript'
import type { GraphicTemplateId } from '@shared/graphics/template'

/**
 * Step 6's three English fixture talks (docs/CLIPS.md §9: "the fixtures
 * (English, Hindi and Telugu, yours)"), built in code as the best clips
 * eval's are (bestClipsFixtures.ts), with made-up content: a before and an
 * after, a two-sided comparison, a sequence of dated events. Each is an
 * eval-set fixture (`truth`, `traps`) the graphics eval's FORGE_EVAL_GRAPHICS
 * block scores beside the owner's eval-*.json, and the normal suite scores
 * with saved answers (tests/graphic3dModel.test.ts). The Hindi and Telugu
 * talks for the three are the owner's to record and write; none is here.
 *
 * Each talk is the only one of the three conditions it meets
 * (menuGraphics.ts `stepSixOffered`): the before-and-after talk offers a
 * before-and-after and no versus or timeline, and so on, so a model that
 * names another of the three there is refused as not offered.
 */

/** One word every `ms` from 0, segment ids s00, s01, …; English, sure Whisper words. */
export function stepSixTalk(assetId: string, sentences: readonly string[], ms = 350): Transcript {
  const words: Word[] = []
  const segments: Segment[] = []
  let index = 0
  sentences.forEach((text, k) => {
    const start = index
    for (const w of text.split(/\s+/u).filter(Boolean)) {
      words.push({ index, text: w, startMs: index * ms, endMs: index * ms + ms - 50, confidence: 0.95 })
      index += 1
    }
    segments.push({ id: `s${String(k).padStart(2, '0')}`, startMs: start * ms, endMs: (index - 1) * ms + ms - 50, text, wordStart: start, wordEnd: index - 1 })
  })
  return { assetId, language: 'en', model: 'whisper-small', durationMs: index * ms, words, segments }
}

export interface StepSixFixture {
  set: 'eval'
  id: string
  language: 'en'
  /** The template the talk is written for. */
  template: GraphicTemplateId
  transcript: Transcript
  truth: { sentence: string; template: GraphicTemplateId }[]
  traps: string[]
}

/** The before-and-after talk: s01 the before, s02 the after; s03 a negated price (a trap). */
export const BEFORE_AFTER_SENTENCES = [
  'Let me tell you how my pricing changed.',
  'Before the course I charged $1,500 a wedding.',
  'After the course I charge $4,000 a wedding.',
  'I do not shoot for $900 anymore.'
] as const

/** The versus talk: s01 two sources set against each other; s03 a negated count (a trap). */
export const VERSUS_SENTENCES = [
  'We tried a few ways to find couples.',
  'Instagram brought 600 leads, while referrals brought 350 leads.',
  'Referrals cost us almost nothing.',
  'Ads did not bring 900 leads.'
] as const

/** The timeline talk: s01 three dated moments in order; s02 a negated year (a trap). */
export const TIMELINE_SENTENCES = [
  'Here is how the studio grew.',
  'In 2015 we shot our first wedding, in 2018 we hired an editor, and in 2021 we opened the studio.',
  'We never opened a second studio in 2023.'
] as const

/** The three fixtures, in `STEP_SIX_TEMPLATES`' order. */
export function stepSixFixtures(): StepSixFixture[] {
  return [
    {
      set: 'eval',
      id: 'step6-timeline-en',
      language: 'en',
      template: 'timeline',
      transcript: stepSixTalk('step6-timeline-en', TIMELINE_SENTENCES),
      truth: [{ sentence: 's01', template: 'timeline' }],
      traps: ['s02']
    },
    {
      set: 'eval',
      id: 'step6-before-after-en',
      language: 'en',
      template: 'before-after',
      transcript: stepSixTalk('step6-before-after-en', BEFORE_AFTER_SENTENCES),
      truth: [{ sentence: 's01', template: 'before-after' }],
      traps: ['s03']
    },
    {
      set: 'eval',
      id: 'step6-versus-en',
      language: 'en',
      template: 'versus',
      transcript: stepSixTalk('step6-versus-en', VERSUS_SENTENCES),
      truth: [{ sentence: 's01', template: 'versus' }],
      traps: ['s03']
    }
  ]
}
