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

/** The two sentences, one word every 400 ms from 0: "simple" at 0.8 s, "40" at 2.4 s; all within the first 4 s. */
const SENTENCES = ['Keep it simple today.', 'We signed 40 clients this year.']

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
