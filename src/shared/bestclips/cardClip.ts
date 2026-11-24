import type { WordRun } from '../ingest/captions'
import type { Clip, Project, ProjectSettings } from '../timeline'
import type { Transcript } from '../transcript'
import { clipSegments, type ClipWindow } from './windows'

/**
 * Clip it from a Best clips card (docs/CLIPS.md §7.5 steps 0 to 5): the
 * rules the store follows, kept pure so a test can hold them. No `window`,
 * no clock, no `node:`.
 *
 * STEP 0, WHERE THE CLIP GOES (`cardClipPlan`). The three cards are three
 * separate shorts. The first draft's "Make it vertical" called `setAspect`,
 * which re-solves EVERY clip's crop, so a Clip it into an existing 16:9 edit
 * would have flipped and re-cropped that whole edit. So:
 *
 *   - with nothing on the timeline, the clip goes into this project, which is
 *     set to 9:16 if it is not already (setting the aspect then touches no
 *     clip: there is none);
 *   - otherwise it ASKS, naming what each answer does: "Start a new 9:16
 *     project for this clip" (the File > New Project route, after saving this
 *     one) or "Add it to this project" (the aspect unchanged; the clip
 *     followed only if the canvas is already portrait);
 *   - with "Make it vertical" off, it never asks and never changes the
 *     aspect: the clip is added as M0's Clip it adds one.
 *
 * So "Make it vertical" never changes an existing project's aspect without
 * saying so: the only aspect it sets unasked is an empty timeline's. A
 * timeline another card's clip is still downloading into is not empty (three
 * separate shorts), and Start new waits until that clip has landed. Nor does
 * a card change an existing edit's CAPTIONS: step 4 switches them on only in
 * a new project or on an empty timeline (`CardClipPlan.captions`).
 *
 * THE RUN (`cardRun`): the card's window as a run of words, by the window's
 * first and last capped segment over the same `clipSegments` the window was
 * built from. Its first word is the first word of `segFrom`, its last the
 * last word of `segTo`.
 *
 * STEPS 3 TO 5 AFTER THE CLIP LANDS (`CardClipRecord`): follow the subject,
 * captions, graphics, each its own undo step, each listed with what it did or
 * why it was skipped. The ORDER is a rule (§12.1: the local model and the AI
 * helper's models are never resident together on the 8 GB machine):
 * graphics starts only once this clip's reframe has ended or was never
 * started, and no reframe analysis is running for any clip
 * (`graphicsMayStart`); a reframe starts only while no graphics run is out
 * (`reframeMayStart`). A step that is skipped or fails never undoes the clip
 * and never stops the next one that can run.
 */

/* ------------------------------------------------------------- the run */

/**
 * The card's window as a run of words (array positions in `t.words`, as
 * M0's picked runs are): from the first word of the window's first capped
 * segment to the last word of its last. Null when either segment is not in
 * `t`'s capped segments (a window of another transcript).
 */
export function cardRun(t: Transcript, window: Pick<ClipWindow, 'segFrom' | 'segTo'>): WordRun | null {
  const segs = clipSegments(t)
  const first = segs.find((s) => s.id === window.segFrom)
  const last = segs.find((s) => s.id === window.segTo)
  if (!first || !last) return null
  const position = new Map<number, number>()
  t.words.forEach((w, i) => position.set(w.index, i))
  const from = position.get(first.wordStart)
  const to = position.get(last.wordEnd)
  if (from === undefined || to === undefined || to < from) return null
  return { from, to }
}

/* ------------------------------------------------- step 0: where it goes */

/** The question's two answers. */
export type CardClipChoice = 'new' | 'add'

/** What happened to the project's shape, said on the card. */
export type CardShape = 'set' | 'already' | 'new' | 'kept' | 'kept-off'

/** Step 0's answer: ask, or go with what the answer means. */
export type CardClipPlan =
  | { kind: 'ask' }
  | {
      kind: 'go'
      /** Start a new 9:16 project first (the File > New Project route). */
      newProject: boolean
      /** Set this aspect on THIS project before the clip lands: only ever with nothing on its timeline. */
      aspect: '9:16' | null
      /** Follow the subject once the clip lands: the canvas it lands on is portrait. */
      reframe: boolean
      /**
       * Step 4 may switch the project's captions on (and to Smart placement):
       * only when the clip goes into a new project or onto an empty timeline,
       * where there is no edit of the user's whose captions it would change.
       * Into an existing edit, the project's captions are left as they are.
       */
      captions: boolean
      shape: CardShape
    }

/** A portrait canvas: taller than wide. */
export function isPortrait(settings: Pick<ProjectSettings, 'width' | 'height'>): boolean {
  return settings.height > settings.width
}

/** A 9:16 canvas, by its ratio (as `aspectOf` reads a project's shape). */
export function isNineBySixteen(settings: Pick<ProjectSettings, 'width' | 'height'>): boolean {
  return settings.width * 16 === settings.height * 9
}

/**
 * Step 0 (§7.5). `choice` is the question's answer, or null before it is
 * asked. Any clip on the timeline, sound included, makes the timeline not
 * empty: it is somebody’s edit. So does a card's download still on its way
 * into this project (`pendingHere`, `cardDownloadsIn`): the three cards are
 * three separate shorts, and a second card pressed while the first downloads
 * would otherwise land on the same timeline unasked.
 */
export function cardClipPlan(
  project: { clips: readonly Pick<Clip, 'id'>[]; settings: Pick<ProjectSettings, 'width' | 'height'> },
  vertical: boolean,
  choice: CardClipChoice | null,
  pendingHere = 0
): CardClipPlan {
  const portrait = isPortrait(project.settings)
  const noEdit = project.clips.length === 0
  if (!vertical) return { kind: 'go', newProject: false, aspect: null, reframe: portrait, captions: noEdit, shape: 'kept-off' }
  if (noEdit && pendingHere === 0) {
    const already = isNineBySixteen(project.settings)
    return { kind: 'go', newProject: false, aspect: already ? null : '9:16', reframe: true, captions: true, shape: already ? 'already' : 'set' }
  }
  if (choice === 'new') return { kind: 'go', newProject: true, aspect: null, reframe: true, captions: true, shape: 'new' }
  if (choice === 'add') return { kind: 'go', newProject: false, aspect: null, reframe: portrait, captions: noEdit, shape: 'kept' }
  return { kind: 'ask' }
}

/**
 * Whether "Start a new 9:16 project" must save this one first: unsaved
 * changes, or a project that has never been written to a file of its own (one
 * recovered from autosave opens clean but with no path: newProject would
 * leave it only in the autosave folder).
 */
export function unsavedWork(state: { dirty: boolean; projectPath: string | null }): boolean {
  return state.dirty || state.projectPath === null
}

/** Card downloads still on their way into the project `projectId`. */
export function cardDownloadsIn(records: Readonly<Record<string, CardClipRecord>>, projectId: string | null): number {
  return Object.values(records).filter((r) => r.projectId === projectId && stepOf(r, 'download')?.state === 'running').length
}

/* --------------------------------------------- the question's words */

export const MAKE_IT_VERTICAL = 'Make it vertical'
export const MAKE_IT_VERTICAL_TITLE =
  'Clip it makes each card a 9:16 short: on an empty timeline it sets this project to 9:16; with clips already there, it asks first. Off, the clip is added as it is.'
export const CLIP_IT_CARD = 'Clip it'
export const CLIP_IT_CARD_TITLE = 'Download just this stretch and put it on the timeline, with its words and the link’s credit'
export const QUESTION_HEAD = 'This project already has clips on its timeline.'
export const START_NEW_PROJECT = 'Start a new 9:16 project for this clip'
/** Under Start new, when this project has unsaved changes. */
export const START_NEW_SAVES = 'Saves this project first, then opens a new 9:16 project with just this clip.'
/** Under Start new, when this project is saved. */
export const START_NEW_SAVED = 'This project is saved and stays as it is; a new 9:16 project opens with just this clip.'
/** Under Start new (greyed), while a card's clip is still downloading into this project: it would land nowhere. */
export const START_NEW_WAITS = 'Waits until the clip downloading now has landed in this project.'
export const ADD_TO_PROJECT = 'Add it to this project'
/** Under Add, on a portrait canvas. */
export const ADD_PORTRAIT = 'Adds it to this timeline and follows faces. The project keeps its shape.'
/** Under Add, on a landscape or square canvas. */
export const ADD_KEEPS_SHAPE = 'Adds it to this timeline as it is. The project keeps its shape, so nothing is reframed.'
export const NOT_NOW = 'Not now'
/** The Save dialog was closed: nothing was dropped and nothing started. */
export const NOT_SAVED_NOTE = 'This project was not saved, so no new project was started.'
/** Saving failed (its reason is not shown: Best clips shows fixed lines only). */
export const SAVE_FAILED_NOTE = 'This project could not be saved, so no new project was started.'
/** The card no longer belongs to the cards on screen (another link, another length, captions fetched again). */
export const CARD_GONE_NOTE = 'Those cards are gone: press Analyse again.'
/** One question at a time. */
export const QUESTION_OPEN_NOTE = 'Answer the question on the card first.'

/* --------------------------------------------------- the per-card record */

export type CardStepName = 'download' | 'shape' | 'reframe' | 'captions' | 'graphics'
export type CardStepState = 'waiting' | 'running' | 'done' | 'skipped' | 'failed'

export interface CardStep {
  name: CardStepName
  state: CardStepState
  /** One of the fixed lines below: never an error's text. */
  text: string
}

/** What Clip it did for one card, in the store (session state, like the cards). */
export interface CardClipRecord {
  /** `cardKey`: the link and the stretch. */
  key: string
  windowId: string
  linkKey: string
  startMs: number
  endMs: number
  /** The download's job, once queued. */
  jobId: string | null
  /** The clip, once it has landed. */
  clipId: string | null
  /** The project the clip was sent into (`project.id`): which downloads are this project's, for step 0. */
  projectId: string | null
  /** Step 0's answer: follow the subject after landing. */
  reframe: boolean
  /** Step 0's answer: step 4 may switch the project's captions on (`CardClipPlan.captions`). */
  captions: boolean
  /** The reframe's analysis job, while it runs. */
  reframeJobId: string | null
  /** In order: download, shape, reframe, captions, graphics. */
  steps: CardStep[]
}

/** The words each step is listed under. */
export const STEP_LABEL: Readonly<Record<CardStepName, string>> = {
  download: 'Download',
  shape: 'Shape',
  reframe: 'Follow the subject',
  captions: 'Captions',
  graphics: 'Graphics'
}

export const STEP_TEXT = {
  downloading: 'downloading this stretch…',
  landed: 'on the timeline.',
  otherProject: 'it finished under another project, so it was not placed there.',
  downloadFailed: 'the download did not finish.',
  notLanded: 'skipped: the clip did not land.',
  waiting: 'waits for the one before.',
  waitingOther: 'waits for other work to finish first.',
  shapeSet: 'this project set to 9:16.',
  shapeAlready: 'already 9:16.',
  shapeNew: 'a new 9:16 project.',
  shapeKept: 'kept as it is, as you chose.',
  shapeKeptOff: 'kept as it is: Make it vertical is off.',
  reframeRunning: 'finding the faces…',
  reframeDone: 'the crop follows the faces.',
  reframeNotPortrait: 'skipped: the project is not portrait, so the clip keeps its frame.',
  reframeNothing: 'skipped: the clip is not a landscape video, so there is nothing to follow.',
  reframeNoHelper: 'skipped: the AI helper is not installed, so the crop is centred.',
  reframeStarting: 'skipped: the AI helper was still starting, so the crop is centred.',
  reframeNoModel: 'skipped: the face finder is not downloaded, so the crop is centred. Follow the subject, in the Trimmer, gets it.',
  reframeFailed: 'the faces could not be found, so the crop is centred.',
  reframeElsewhere: 'skipped: another project was opened before the faces were found.',
  clipGone: 'skipped: the clip is no longer on the timeline.',
  captionsOn: 'on.',
  captionsSmart: 'on, kept off the faces.',
  captionsNoWords: 'skipped: the clip landed without its words.',
  captionsAlready: 'already on in this project, left as they are.',
  captionsLeftOff: 'skipped: this project has captions off, and they are left off.',
  graphicsWaiting: 'waits for the faces to be found.',
  graphicsRunning: 'finding graphics…',
  graphicsDone: 'listed in the Transcript tile, each with Drop.',
  graphicsNoWords: 'skipped: the clip has no words to read.',
  graphicsFailed: 'could not be found.'
} as const

/** A card's key in the record: the link and the stretch, so a card asked again for the same words shows what it did. */
export function cardKey(linkKey: string, card: { startMs: number; endMs: number }): string {
  return `${linkKey}|${card.startMs}-${card.endMs}`
}

const SHAPE_TEXT: Readonly<Record<CardShape, string>> = {
  set: STEP_TEXT.shapeSet,
  already: STEP_TEXT.shapeAlready,
  new: STEP_TEXT.shapeNew,
  kept: STEP_TEXT.shapeKept,
  'kept-off': STEP_TEXT.shapeKeptOff
}

/** A record as the download is asked for: the shape said, every later step waiting. */
export function newCardRecord(
  key: string,
  linkKey: string,
  card: { windowId: string; startMs: number; endMs: number },
  plan: { reframe: boolean; shape: CardShape; captions?: boolean; projectId?: string | null }
): CardClipRecord {
  return {
    key,
    windowId: card.windowId,
    linkKey,
    startMs: card.startMs,
    endMs: card.endMs,
    jobId: null,
    clipId: null,
    projectId: plan.projectId ?? null,
    reframe: plan.reframe,
    captions: plan.captions ?? false,
    reframeJobId: null,
    steps: [
      { name: 'download', state: 'running', text: STEP_TEXT.downloading },
      { name: 'shape', state: 'done', text: SHAPE_TEXT[plan.shape] },
      { name: 'reframe', state: 'waiting', text: STEP_TEXT.waiting },
      { name: 'captions', state: 'waiting', text: STEP_TEXT.waiting },
      // Not "waits for the faces": no face may ever be looked for (the line changes when the follow starts).
      { name: 'graphics', state: 'waiting', text: STEP_TEXT.waiting }
    ]
  }
}

/** The record with one step's state and line replaced. */
export function withStep(record: CardClipRecord, name: CardStepName, state: CardStepState, text: string): CardClipRecord {
  return { ...record, steps: record.steps.map((s) => (s.name === name ? { name, state, text } : s)) }
}

/** The record once the download did not land: that step's line, and every later waiting step skipped. */
export function notLanded(record: CardClipRecord, text: string): CardClipRecord {
  return {
    ...record,
    steps: record.steps.map((s) =>
      s.name === 'download' ? { ...s, state: 'failed', text } : s.state === 'waiting' ? { ...s, state: 'skipped', text: STEP_TEXT.notLanded } : s
    )
  }
}

export function stepOf(record: CardClipRecord, name: CardStepName): CardStep | undefined {
  return record.steps.find((s) => s.name === name)
}

/** A step that will not change again. */
export function stepEnded(step: CardStep | undefined): boolean {
  return step !== undefined && (step.state === 'done' || step.state === 'skipped' || step.state === 'failed')
}

/** What the rest of the app is doing, as the order rules read it. */
export interface CardWorld {
  /** Reframe analyses in flight, for any clip (`reframe.pending`). */
  reframesRunning: number
  /** A Find graphics run is out (`findingGraphics`). */
  graphicsRunning: boolean
}

/**
 * Graphics may start for this card's clip (§12.1): the clip has landed, its
 * own follow step has ended (done, skipped or failed: never 'waiting' or
 * 'running'), its captions step has ended, no reframe analysis runs for any
 * clip (so the helper has released its sessions before the local model
 * loads), and no other graphics run is out (Find graphics is one at a time).
 */
export function graphicsMayStart(record: CardClipRecord, world: CardWorld): boolean {
  return (
    record.clipId !== null &&
    stepOf(record, 'graphics')?.state === 'waiting' &&
    stepEnded(stepOf(record, 'reframe')) &&
    stepEnded(stepOf(record, 'captions')) &&
    world.reframesRunning === 0 &&
    !world.graphicsRunning
  )
}

/** A reframe may start: no graphics run is out, so the local model is not resident while the helper's models load (§12.1). */
export function reframeMayStart(world: CardWorld): boolean {
  return !world.graphicsRunning
}

/**
 * The card's clip landed but is not on this timeline: undone, deleted, or
 * another project open. What the record says no longer holds here.
 */
export function cardClipGone(record: CardClipRecord, clips: readonly Pick<Clip, 'id'>[]): boolean {
  return stepOf(record, 'download')?.state === 'done' && !clips.some((c) => c.id === record.clipId)
}

/**
 * Whether a card's Clip it can be pressed (again): never clipped, its
 * download did not land, or the clip it landed is no longer on this timeline.
 */
export function cardClippable(record: CardClipRecord | undefined, clips: readonly Pick<Clip, 'id'>[]): boolean {
  return record === undefined || stepOf(record, 'download')?.state === 'failed' || cardClipGone(record, clips)
}

/**
 * Step 4's change to the project's captions (§7.5), or none. Into a new
 * project or onto an empty timeline (`mayChange`), captions go on, with Smart
 * placement when a subject track exists to keep them off. Into an existing
 * edit, the project's captions are its own: left exactly as they are, on or
 * off, placement included.
 */
export function captionsStep(
  mayChange: boolean,
  captions: Pick<Project['captions'], 'enabled' | 'placement'>,
  smart: boolean
): { change: { enabled: true; placement?: 'smart' } | null; state: CardStepState; text: string } {
  if (!mayChange) {
    return captions.enabled
      ? { change: null, state: 'done', text: STEP_TEXT.captionsAlready }
      : { change: null, state: 'skipped', text: STEP_TEXT.captionsLeftOff }
  }
  const text = smart ? STEP_TEXT.captionsSmart : STEP_TEXT.captionsOn
  if (captions.enabled && (!smart || captions.placement === 'smart')) return { change: null, state: 'done', text }
  return { change: smart ? { enabled: true, placement: 'smart' } : { enabled: true }, state: 'done', text }
}
