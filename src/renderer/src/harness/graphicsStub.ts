import type { Project } from '@shared/timeline'
import type { Segment, Transcript, Word } from '@shared/transcript'
import { graphicsMenuFor, pairSettled, quoteSpeakerFor, settleGraphics } from '@shared/director/run'
import type { AnswerGraphic } from '@shared/director/schemaGraphics'
import { replaceClipGraphics } from '@shared/graphics/apply'

/**
 * The census's graphics run (docs/CLIPS.md §6.6's census rows: "check the
 * number" for a stub transcript of each source — a YouTube ASR track, a
 * YouTube uploader track, an unsure Whisper word).
 *
 * The harness has no model, so this stands in for the ANSWER only: a made-up
 * two-sentence transcript of the source asked for, and a fixed answer (a
 * keyword on the first sentence, a counter on the second's number), settled
 * through the real validator (`settleGraphics`, which decides from the
 * transcript's source whether the counter is a proposal) and landed as Find
 * lands a run (`pairSettled`, `replaceClipGraphics` under the Clip-it rule).
 * So what the Transcript tile then shows — one placed keyword with Drop, one
 * counter waiting with Keep, Drop and "check the number" — is the app's own
 * doing over that transcript.
 *
 * Pure, so tests/renderer/transcriptGraphics.test.tsx holds it to that shape
 * in node; it THROWS when the run does not come out so, because a census
 * scenario that cannot be built must say so rather than count nothing.
 */

export type HarnessWordSource = 'youtube-asr' | 'youtube-lines' | 'whisper-unsure'

/**
 * The two sentences, one word every 400 ms from 0: "simple" at 0.8 s, "40" at 2.4 s; all within the first 4 s.
 * No word is a label the census counts in this state: the tile draws each word
 * as its own text node, so a first word "Keep" was a second whole "Keep" beside
 * the button (tests/renderer/transcriptGraphics.test.tsx counts each row's
 * label over the whole tile in this state).
 */
const SENTENCES = ['Make it simple today.', 'We signed 40 clients this year.']

/** The source's transcript of the two sentences for `assetId`: YouTube's words carry no confidence; Whisper's are sure but for the number. */
export function harnessGraphicsTranscript(assetId: string, source: HarnessWordSource): Transcript {
  const words: Word[] = []
  const segments: Segment[] = []
  let index = 0
  SENTENCES.forEach((text, k) => {
    const start = index
    for (const w of text.split(/\s+/u).filter(Boolean)) {
      const confidence = source === 'whisper-unsure' ? (w === '40' ? 0.3 : 0.95) : null
      words.push({ index, text: w, startMs: index * 400, endMs: index * 400 + 350, confidence })
      index += 1
    }
    segments.push({ id: `s${String(k).padStart(2, '0')}`, startMs: start * 400, endMs: (index - 1) * 400 + 350, text, wordStart: start, wordEnd: index - 1 })
  })
  const model = source === 'whisper-unsure' ? 'whisper-small' : source
  return { assetId, language: 'en', model, durationMs: index * 400, words, segments }
}

const answerGraphic = (fields: Partial<AnswerGraphic> & Pick<AnswerGraphic, 'sentence' | 'template'>): AnswerGraphic => ({
  title: '',
  value: '',
  label: '',
  items: [],
  quote: '',
  words: '',
  lit: 0,
  why: 'the census',
  ...fields
})

/** The fixed answer: the keyword "simple", and the counter "40 clients". */
const ANSWER = {
  reasoning: 'the census',
  graphics: [
    answerGraphic({ sentence: 's00', template: 'keyword', words: 'simple', lit: 0 }),
    answerGraphic({ sentence: 's01', template: 'counter', value: '40', label: 'clients' })
  ]
}

/**
 * `project` with the clip `clipId`'s asset given the source's transcript and
 * the run landed on it: `placed` the graphic clip ids to bake. Throws unless
 * exactly one graphic is placed and one proposal waits on the clip.
 */
export function harnessGraphicsRun(project: Project, clipId: string, source: HarnessWordSource): { project: Project; placed: string[] } {
  const clip = project.clips.find((c) => c.id === clipId)
  if (!clip) throw new Error(`census: clip ${clipId} is not on the timeline`)
  const transcript = harnessGraphicsTranscript(clip.assetId, source)
  const withWords: Project = { ...project, transcripts: { ...project.transcripts, [clip.assetId]: transcript } }
  const speaker = quoteSpeakerFor(withWords.assets.find((a) => a.id === clip.assetId))
  const parts = graphicsMenuFor(withWords, clip, transcript).map((menu) => ({
    menu,
    settled: settleGraphics({ value: ANSWER, truncated: false }, menu, transcript, { speaker })
  }))
  const { kept } = pairSettled(parts)
  const landed = replaceClipGraphics(withWords, clipId, kept, { fps: withWords.settings.fps })
  const proposals = (landed.project.graphicProposals ?? []).filter((g) => g.clipId === clipId)
  if (landed.clipIds.length !== 1 || proposals.length !== 1) {
    const why = [...parts.flatMap((p) => p.settled.dropped), ...landed.problems].map((p) => p.message).join('; ')
    throw new Error(`census: the ${source} graphics run placed ${landed.clipIds.length} and set aside ${proposals.length}, not 1 and 1${why ? ` — ${why}` : ''}`)
  }
  return { project: landed.project, placed: landed.clipIds }
}

/*
 * The census's dropped graphics (try-out 1, 2026-11-15: Add on a dropped
 * graphic). No stubbed answer this time: the harness bridge has no model
 * (`directorComplete` is unsupported), so the census presses the REAL Find
 * and the baseline's graphics (§6.10) go through the validator, the budget
 * and the landing as they would on the owner's machine. The transcript is
 * built so that run drops one graphic for the truth and one for room, each
 * with Add, and so one Add lands and one is refused:
 *
 * - s00 "40% of couples book early." — the ring "40%" on its first word, 0 s:
 *   placed, on screen to about 2 s;
 * - s01 "I do not charge $500." — the counter "$500" at 2.25 s: refused by
 *   the validator as said negated (a truth drop). Add would start it at
 *   1.75 s, under the ring's frames: refused, "another graphic is on screen
 *   then";
 * - s02 "Light matters more than gear." — the keyword "gear" at 3.5 s: within
 *   6 s of the ring, and a keyword yields (a room drop). Add starts it at
 *   3 s, after the ring: it lands.
 *
 * One word every 250 ms from 0, so the last ends at 3.7 s, inside the
 * bridge's 6 s recording (bridge.ts `sampleVideo(6, …)`).
 */
const DROP_SENTENCES = ['40% of couples book early.', 'I do not charge $500.', 'Light matters more than gear.']

/** The dropped-graphics census transcript for `assetId`: English, sure Whisper words, one every 250 ms. */
export function harnessDropsTranscript(assetId: string): Transcript {
  const words: Word[] = []
  const segments: Segment[] = []
  let index = 0
  DROP_SENTENCES.forEach((text, k) => {
    const start = index
    for (const w of text.split(/\s+/u).filter(Boolean)) {
      words.push({ index, text: w, startMs: index * 250, endMs: index * 250 + 200, confidence: 0.95 })
      index += 1
    }
    segments.push({ id: `s${String(k).padStart(2, '0')}`, startMs: start * 250, endMs: (index - 1) * 250 + 200, text, wordStart: start, wordEnd: index - 1 })
  })
  return { assetId, language: 'en', model: 'whisper-small', durationMs: index * 250, words, segments }
}
