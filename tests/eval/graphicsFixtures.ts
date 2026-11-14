import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import type { Transcript } from '@shared/transcript'
import type { GraphicTemplateId } from '@shared/graphics/template'
import { GRAPHIC_TEMPLATES_ALWAYS, graphicsMenuFor } from '@shared/director/run'

/**
 * The graphics eval's fixtures (docs/CLIPS.md §6.10, "Fixtures"), read with a
 * shape check: the two shapes of §6.10 exactly, each file's fields named by
 * the file's basename when they are wrong.
 *
 *   eval-*.json    { language, transcript, truth: { sentence, template }[], traps: string[] }
 *   nested-*.json  { language, transcript, title, items, parents }
 *
 * The ten eval transcripts are the owner's recordings and the owner's truth;
 * none is in the repo yet, and every reader here returns an empty list
 * without them. A field beyond the shape (the nested fixtures' `note`) is
 * allowed and ignored. Used by the eval's FORGE_EVAL_GRAPHICS block and the
 * normal suite (tests/graphicsEval.test.ts) alike.
 */

export const GRAPHICS_FIXTURE_DIR = resolve(__dirname, '..', 'fixtures', 'graphics')
const REPO = resolve(__dirname, '..', '..')

/**
 * The template ids a truth may name: the ones the eval's menu offers
 * (`GRAPHIC_TEMPLATES_ALWAYS`, run.ts `graphicsMenuFor`). A `callout` is
 * offered only beside a subject track, and the eval's project has none
 * (`projectForTranscript`), so no side could ever hit a callout truth: it is
 * refused with `CALLOUT_TRUTH_LINE`. A lower third and a screen card are the
 * app's, never a pass's (§6.6).
 */
export const EVAL_TEMPLATE_IDS: readonly GraphicTemplateId[] = Object.freeze([...GRAPHIC_TEMPLATES_ALWAYS])

/** Why a callout truth is refused: the eval offers no callout. */
export const CALLOUT_TRUTH_LINE = "is a callout, which the eval never offers (its project has no subject track), so neither side could hit it"

export interface EvalGraphicsFixture {
  /** The file's basename without `.json`. */
  id: string
  file: string
  language: string
  transcript: Transcript
  truth: { sentence: string; template: GraphicTemplateId }[]
  traps: string[]
}

export interface NestedGraphicsFixture {
  id: string
  file: string
  language: string
  transcript: Transcript
  title: string
  items: string[]
  parents: number[]
}

/** The frame rate of the project a fixture's transcript is read in. */
export const FIXTURE_FPS = 30

/**
 * A project of one footage clip showing the whole of a transcript's file, as
 * the eval and the readers ask `graphicsMenuFor` over it: the asset is the
 * transcript's own id, a vertical video long enough for its last word, no
 * Speaker (so a said quote has no app speaker) and no subject track (so
 * `callout` is not offered).
 */
export function projectForTranscript(transcript: Transcript): { project: Project; clip: Clip } {
  const lastMs = Math.max(transcript.durationMs, ...transcript.words.map((w) => w.endMs), 0)
  const frames = Math.ceil((lastMs / 1000) * FIXTURE_FPS) + FIXTURE_FPS
  const asset: MediaAsset = {
    id: transcript.assetId,
    path: `/eval/${transcript.assetId}.mp4`,
    name: `${transcript.assetId}.mp4`,
    kind: 'video',
    durationFrames: frames,
    width: 1080,
    height: 1920,
    fps: FIXTURE_FPS,
    hasVideo: true,
    hasAudio: true,
    size: 1
  }
  const base = emptyProject(`graphics eval ${transcript.assetId}`)
  const trackId = base.tracks.find((t) => t.kind === 'video')!.id
  const clip: Clip = {
    id: `clip-${transcript.assetId}`,
    assetId: asset.id,
    trackId,
    start: 0,
    duration: frames,
    inPoint: 0,
    volume: 1,
    transform: { ...DEFAULT_TRANSFORM },
    color: { ...DEFAULT_COLOR }
  }
  return {
    clip,
    project: { ...base, settings: { ...base.settings, fps: FIXTURE_FPS }, assets: [asset], clips: [clip], transcripts: { [asset.id]: transcript } }
  }
}

/** The sentences a fixture's transcript is offered as, in order: every window's of `graphicsMenuFor` over `projectForTranscript`. */
export function menuSentencesOf(transcript: Transcript): { id: string; text: string }[] {
  const { project, clip } = projectForTranscript(transcript)
  return graphicsMenuFor(project, clip, transcript).flatMap((m) => m.sentences.map((s) => ({ id: s.id, text: s.text })))
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Everything wrong with a transcript's shape, each naming the field under `transcript`. */
function transcriptProblems(t: unknown): string[] {
  if (!isObject(t)) return ['transcript is not an object']
  const out: string[] = []
  for (const k of ['assetId', 'language', 'model'] as const) if (typeof t[k] !== 'string' || t[k] === '') out.push(`transcript.${k} is not a non-empty string`)
  if (typeof t.durationMs !== 'number' || !Number.isFinite(t.durationMs)) out.push('transcript.durationMs is not a number')
  if (!Array.isArray(t.words) || t.words.length === 0) out.push('transcript.words is not a non-empty list')
  else
    t.words.forEach((w, i) => {
      if (!isObject(w) || typeof w.index !== 'number' || typeof w.text !== 'string' || typeof w.startMs !== 'number' || typeof w.endMs !== 'number') {
        out.push(`transcript.words[${i}] is not { index, text, startMs, endMs }`)
      }
    })
  if (!Array.isArray(t.segments) || t.segments.length === 0) out.push('transcript.segments is not a non-empty list')
  else
    t.segments.forEach((s, i) => {
      if (
        !isObject(s) ||
        typeof s.id !== 'string' ||
        typeof s.text !== 'string' ||
        typeof s.startMs !== 'number' ||
        typeof s.endMs !== 'number' ||
        typeof s.wordStart !== 'number' ||
        typeof s.wordEnd !== 'number'
      ) {
        out.push(`transcript.segments[${i}] is not { id, startMs, endMs, text, wordStart, wordEnd }`)
      }
    })
  return out
}

/** The common half: a language that is the transcript's, and the transcript's shape. */
function headProblems(raw: Record<string, unknown>): string[] {
  const out: string[] = []
  if (typeof raw.language !== 'string' || raw.language === '') out.push('language is not a non-empty string')
  out.push(...transcriptProblems(raw.transcript))
  if (out.length === 0 && raw.language !== (raw.transcript as Transcript).language) {
    out.push(`language '${String(raw.language)}' is not the transcript's language '${(raw.transcript as Transcript).language}'`)
  }
  return out
}

function fail(file: string, problems: string[]): never {
  throw new Error(problems.map((p) => `${file}: ${p}`).join('\n'))
}

/**
 * An `eval-*.json` fixture, checked: the shape of §6.10; every truth and trap
 * sentence id one the transcript is offered as (`menuSentencesOf`, the ids
 * `graphicsMenuFor` gives); every truth template one of `EVAL_TEMPLATE_IDS`.
 * Throws one error naming the file (its basename) and each field wrong.
 */
export function readEvalFixture(path: string, raw: unknown): EvalGraphicsFixture {
  const file = basename(path)
  if (!isObject(raw)) fail(file, ['is not a JSON object'])
  const problems = headProblems(raw)
  if (!Array.isArray(raw.truth)) problems.push('truth is not a list')
  if (!Array.isArray(raw.traps)) problems.push('traps is not a list')
  if (problems.length > 0) fail(file, problems)
  const transcript = raw.transcript as Transcript
  const ids = new Set(menuSentencesOf(transcript).map((s) => s.id))
  const truth = raw.truth as unknown[]
  truth.forEach((t, i) => {
    if (!isObject(t) || typeof t.sentence !== 'string' || typeof t.template !== 'string') {
      problems.push(`truth[${i}] is not { sentence, template }`)
      return
    }
    if (!ids.has(t.sentence)) problems.push(`truth[${i}].sentence '${t.sentence}' is not a sentence of the transcript`)
    if (t.template === 'callout') problems.push(`truth[${i}].template ${CALLOUT_TRUTH_LINE}`)
    else if (!(EVAL_TEMPLATE_IDS as string[]).includes(t.template)) problems.push(`truth[${i}].template '${t.template}' is not one of ${EVAL_TEMPLATE_IDS.join(', ')}`)
  })
  ;(raw.traps as unknown[]).forEach((t, i) => {
    if (typeof t !== 'string') problems.push(`traps[${i}] is not a sentence id`)
    else if (!ids.has(t)) problems.push(`traps[${i}] '${t}' is not a sentence of the transcript`)
  })
  if (problems.length > 0) fail(file, problems)
  return {
    id: basename(file, '.json'),
    file,
    language: raw.language as string,
    transcript,
    truth: (truth as { sentence: string; template: GraphicTemplateId }[]).map((t) => ({ sentence: t.sentence, template: t.template })),
    traps: [...(raw.traps as string[])]
  }
}

/** A `nested-*.json` fixture, checked: the shape of §6.10, `items` and `parents` the same length, each parent −1 or an earlier item. */
export function readNestedFixture(path: string, raw: unknown): NestedGraphicsFixture {
  const file = basename(path)
  if (!isObject(raw)) fail(file, ['is not a JSON object'])
  const problems = headProblems(raw)
  if (typeof raw.title !== 'string') problems.push('title is not a string')
  if (!Array.isArray(raw.items) || raw.items.some((i) => typeof i !== 'string')) problems.push('items is not a list of strings')
  if (!Array.isArray(raw.parents) || raw.parents.some((p) => !Number.isInteger(p))) problems.push('parents is not a list of whole numbers')
  else if (Array.isArray(raw.items) && raw.items.length !== raw.parents.length) problems.push(`parents has ${raw.parents.length} entries for ${raw.items.length} items`)
  else (raw.parents as number[]).forEach((p, i) => (p < -1 || p >= i ? problems.push(`parents[${i}] ${p} is not -1 or an earlier item`) : undefined))
  if (problems.length > 0) fail(file, problems)
  return {
    id: basename(file, '.json'),
    file,
    language: raw.language as string,
    transcript: raw.transcript as Transcript,
    title: raw.title as string,
    items: [...(raw.items as string[])],
    parents: [...(raw.parents as number[])]
  }
}

/** Every `eval-*.json` and `nested-*.json` in a folder, by name; both lists empty when there are none (or no folder). */
export function loadGraphicsFixtures(dir = GRAPHICS_FIXTURE_DIR): { eval: EvalGraphicsFixture[]; nested: NestedGraphicsFixture[] } {
  if (!existsSync(dir)) return { eval: [], nested: [] }
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  const read = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), 'utf8'))
  return {
    eval: files.filter((f) => f.startsWith('eval-')).map((f) => readEvalFixture(f, read(f))),
    nested: files.filter((f) => f.startsWith('nested-')).map((f) => readNestedFixture(f, read(f)))
  }
}

/**
 * The one line the eval prints when a folder holds no `eval-*.json` (today):
 * it names the folder (relative to the repo when inside it) and whose the ten
 * transcripts are; prepare then writes no request and fails nothing.
 */
export function noEvalFixturesLine(dir = GRAPHICS_FIXTURE_DIR): string {
  const rel = relative(REPO, dir)
  const where = rel === '' || rel.startsWith('..') ? dir : rel.split('\\').join('/')
  return `No eval-*.json in ${where}: the ten eval transcripts are your recordings and are not there yet, so no graphics request was written.`
}
