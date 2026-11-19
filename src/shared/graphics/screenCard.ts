/**
 * The screen card on the timeline (docs/CLIPS.md §6.16, "The screen card";
 * phase 3's piece 4): everything about the card that reads the project, so
 * the store, the export and node's tests share one body. The drawing is
 * `templates/screenCard.ts`'s.
 *
 * - `screenCardRefusal`: why a clip cannot be a screen card, in the dock's
 *   words (§6.16's "Refused, with the reason in the dock"), or null.
 * - `screenCardSpec`: the card's spec for a recording and a move.
 * - `screenCardKeys`: the hand-off, the two opacity keys on the RECORDING
 *   clip, `[{ frame: cardStart − clip.start, value: 0, ease: 'hold' },
 *   { frame: cardStart − clip.start + L + 1, value: 1 }]`: a key's frame
 *   counts from the recording clip's own start, `L` from the card's.
 * - `screenCardFootage`: the moments' footage pre-pass request for the card's
 *   moving frames, through `footageRequest` (render/momentTextures.ts), the
 *   one builder a bridge over footage asks through.
 * - `realignScreenCards`: after any edit, every card spans its recording
 *   exactly and the recording carries exactly its two keys; a card whose
 *   recording is gone goes with it; a recording whose card went loses the two
 *   keys (and only those); a split's right half loses the copies the split
 *   carried over. The store runs it on every `update`, so a move, a trim, a
 *   retime, a frame-rate change, a delete, a split and a Drop each realign in
 *   the same history step as the edit.
 * - `strikeScreenCardKeys`: the export's strike of a dropped card's two keys
 *   from its copy of the recording clip.
 *
 * The card carries no `generatedBy` rule: it is the user's edit, made by the
 * dock's Screen card, so neither Clear graphics (`'clips.graphic'`) nor
 * Direct's Clear (`DIRECTOR_RULES`) takes it (§16.10).
 *
 * Pure: no clock, no random, no DOM, no `node:path`.
 */

import { clipEnd, isNeutralGrade, type Clip, type Project } from '../timeline'
import type { Keyframe } from '../render/keyframes'
import { footageWindow, type FootageRequest } from '../render/moment'
import { footageRequest } from '../render/momentTextures'
import { SCREEN_CARD_MOVE_S } from './frame'
import type { GraphicSpec } from './template'
import { landingFrame, type ScreenCardMove } from './templates/screenCard'

/**
 * The dock's reasons a clip is refused (§6.16), each said where the Screen
 * card buttons are greyed. Plain words, as the dock's other notes.
 */
export const SCREEN_CARD_REASONS = Object.freeze({
  /** An image clip, or anything that is not footage. */
  notVideo: 'Only a video clip can be a screen card',
  /** One card per recording clip. */
  hasCard: 'It has a screen card already',
  /** The pre-pass does not run the stabiliser (EFFECTS §36). */
  steadied: 'Not on a steadied clip: turn Steady off first',
  /** `sourceToFrame` models neither a turn nor a keyed zoom or turn (frameMap.ts). */
  turned: 'Not on a turned or zooming clip',
  /** The hand-off writes the clip's opacity keys. */
  opacityKeys: 'Not on a clip with opacity keys of its own',
  /** The card's moving frames are above the look, ungraded (§16.7): the landing would show the grade arrive. */
  colour: 'Not on a clip with a colour change',
  /** The same, for an adjustment clip's grade over it. */
  underLook: 'Not under a look',
  /** Shorter than the move: the hand-off would land past its end. */
  short: 'Only on a clip longer than a second'
})

/** Whether a clip is a screen card. */
export function isScreenCard(clip: Pick<Clip, 'graphic'>): boolean {
  return clip.graphic?.data.template === 'screen-card'
}

/** The recording a card frames: its `data.clipId`, or null for a clip that is not a card. */
export function recordingIdOf(clip: Pick<Clip, 'graphic'>): string | null {
  const data = clip.graphic?.data
  return data?.template === 'screen-card' ? data.clipId : null
}

/** The card on the recording clip `recordingId`, if it has one. */
export function screenCardOf(project: Pick<Project, 'clips'>, recordingId: string): Clip | undefined {
  return project.clips.find((c) => recordingIdOf(c) === recordingId)
}

const TINY = 1e-6

/** Whether an adjustment clip with a grade covers any frame of `clip` from a video track above it (render/plan.ts composites the tracks in order, an adjustment grading those before it). */
function underALook(project: Pick<Project, 'clips' | 'tracks'>, clip: Clip): boolean {
  const order = project.tracks.map((t) => t.id)
  const own = order.indexOf(clip.trackId)
  return project.clips.some((c) => {
    if (!c.adjustment || isNeutralGrade(c.color)) return false
    const track = project.tracks.find((t) => t.id === c.trackId)
    if (!track || track.kind !== 'video' || track.hidden) return false
    return order.indexOf(c.trackId) > own && c.start < clipEnd(clip) && clipEnd(c) > clip.start
  })
}

/**
 * Why the clip `clipId` cannot be framed as a screen card (§6.16, "Refused,
 * with the reason in the dock"), or null when it can. In this order: not a
 * video clip (an image clip, a drawn clip, a clip that is gone); a card on it
 * already; steadied; turned, or with keyed zoom or turn; with opacity keys of
 * its own; with a colour change; under an adjustment clip's look; shorter
 * than the move's landing and the frame after it.
 */
export function screenCardRefusal(project: Pick<Project, 'clips' | 'assets' | 'tracks' | 'settings'>, clipId: string): string | null {
  const clip = project.clips.find((c) => c.id === clipId)
  const asset = clip ? project.assets.find((a) => a.id === clip.assetId) : undefined
  if (!clip || !asset || asset.kind !== 'video' || !asset.path || clip.graphic || clip.adjustment) return SCREEN_CARD_REASONS.notVideo
  if (screenCardOf(project, clipId)) return SCREEN_CARD_REASONS.hasCard
  if (clip.steady) return SCREEN_CARD_REASONS.steadied
  const keys = clip.keyframes ?? {}
  if (Math.abs(clip.transform?.rotation ?? 0) > TINY || (keys.zoom?.length ?? 0) > 0 || (keys.rotation?.length ?? 0) > 0) return SCREEN_CARD_REASONS.turned
  if ((keys.opacity?.length ?? 0) > 0) return SCREEN_CARD_REASONS.opacityKeys
  if (!isNeutralGrade(clip.color)) return SCREEN_CARD_REASONS.colour
  if (underALook(project, clip)) return SCREEN_CARD_REASONS.underLook
  if (clip.duration < landingFrame(project.settings.fps) + 2) return SCREEN_CARD_REASONS.short
  return null
}

/**
 * The card's spec for `recording` and `move` (§6.16, "Its spec"): its
 * seconds the recording's length, one beat, the landing; its place the whole
 * frame, held (`auto: false`), which the drawer does not read (the card's box
 * is the recording's): held, so §6.9's recompute on an aspect change or a
 * reframe (`placeAgain`) never looks for a third for it, nor says it kept
 * one; no `generatedBy` (the caller adds none). Seed 1: the card draws nothing
 * random.
 */
export function screenCardSpec(recording: Pick<Clip, 'id' | 'duration'>, move: ScreenCardMove, fps: number): GraphicSpec {
  return {
    data: { template: 'screen-card', clipId: recording.id, move },
    seconds: recording.duration / fps,
    beats: [SCREEN_CARD_MOVE_S],
    place: { auto: false, box: { x: 0, y: 0, width: 1, height: 1 } },
    seed: 1,
    version: 1
  }
}

/**
 * The hand-off (§6.16): the two opacity keys on the recording clip. A key's
 * frame counts from the recording's own start; `L` (`landingFrame`) from the
 * card's; `card.start` and `recording.start` are timeline frames. The second
 * key is the frame after the landing, so at `L` the card draws the recording's
 * frame `L` flat and opaque over the hidden recording, and from `L + 1` the
 * dim's hole shows the recording itself.
 */
export function screenCardKeys(card: Pick<Clip, 'start'>, recording: Pick<Clip, 'start'>, fps: number): Keyframe[] {
  const at = card.start - recording.start
  return [
    { frame: at, value: 0, ease: 'hold' },
    { frame: at + landingFrame(fps) + 1, value: 1 }
  ]
}

/** How many of the card's frames show the recording's picture: frames 0 to `L`. */
export function screenCardPulledFrames(fps: number): number {
  return landingFrame(fps) + 1
}

/**
 * The pre-pass request for a card's moving frames (§6.16, "The recording's
 * frames"): `frames` of the recording from the card's first frame
 * (`cardStart`, a timeline frame), built by `footageRequest` exactly as a
 * moment's shot is, so the pulled frames are the render's own, crop and
 * retime included (EFFECTS §36). Null when the spec is not a card, the
 * recording is gone, is not footage with a file, or is steadied (the pull does
 * not run the stabiliser).
 */
export function screenCardFootage(project: Project, spec: Pick<GraphicSpec, 'data'>, cardStart: number, frames: number, fps: number): FootageRequest | null {
  if (spec.data.template !== 'screen-card') return null
  const recordingId = spec.data.clipId
  const recording = project.clips.find((c) => c.id === recordingId)
  const asset = recording ? project.assets.find((a) => a.id === recording.assetId) : undefined
  if (!recording || !asset || asset.kind !== 'video' || !asset.path || recording.steady) return null
  return footageRequest(project, recording, asset, footageWindow(cardStart - recording.start, Math.max(1, frames), Math.max(1, recording.duration)), fps)
}

/* -------------------------------------------------------------- the keys */

const sameKey = (a: Keyframe, b: Keyframe): boolean => a.frame === b.frame && a.value === b.value && (a.ease ?? undefined) === (b.ease ?? undefined)

/** The clip with its opacity track set to `keys` (sorted by frame), the track dropped when empty, `keyframes` dropped when nothing is left. */
function withOpacity(clip: Clip, keys: readonly Keyframe[]): Clip {
  const rest = { ...(clip.keyframes ?? {}) }
  delete rest.opacity
  const sorted = [...keys].sort((a, b) => a.frame - b.frame)
  const tracks = sorted.length > 0 ? { ...rest, opacity: sorted } : rest
  const next: Clip = { ...clip, keyframes: tracks }
  if (Object.keys(tracks).length === 0) delete next.keyframes
  return next
}

/**
 * `keys` taken off the clip's opacity track, each only where a key of the same
 * frame, value and ease stands, and only when every one of them stands (a
 * pair that is not all there is not the card's); null when they do not all
 * stand. A key of the user's own is never touched.
 */
function withoutExactly(clip: Clip, keys: readonly Keyframe[]): Clip | null {
  const track = clip.keyframes?.opacity ?? []
  const left = [...track]
  for (const key of keys) {
    const at = left.findIndex((k) => sameKey(k, key))
    if (at < 0) return null
    left.splice(at, 1)
  }
  return withOpacity(clip, left)
}

/**
 * The card's pair on an opacity track whose frames an edit moved (a head trim
 * rebases every key, a frame-rate change converts each): the first key of
 * value 0 with ease `'hold'`, and the first key after it of value 1 with no
 * ease, the shape `screenCardKeys` writes. Null when there is none.
 */
function cardPairIn(track: readonly Keyframe[]): [Keyframe, Keyframe] | null {
  const sorted = [...track].sort((a, b) => a.frame - b.frame)
  const i = sorted.findIndex((k) => k.value === 0 && k.ease === 'hold')
  if (i < 0) return null
  const j = sorted.findIndex((k, n) => n > i && k.value === 1 && k.ease === undefined)
  return j < 0 ? null : [sorted[i], sorted[j]]
}

/**
 * The export's strike (§6.16, "The export"): the recording clip of `card`
 * with the card's two keys taken off, exactly `screenCardKeys`' (the edit
 * keeps them aligned, `realignScreenCards`), or else the card's pair as an
 * edit left it; a key of the user's own stays. The clip unchanged when
 * neither stands.
 */
export function withoutCardKeys(recording: Clip, card: Pick<Clip, 'start'>, fps: number): Clip {
  const exact = withoutExactly(recording, screenCardKeys(card, recording, fps))
  if (exact) return exact
  const pair = cardPairIn(recording.keyframes?.opacity ?? [])
  return pair ? (withoutExactly(recording, pair) ?? recording) : recording
}

/** The export's copy of the project with each card in `cards` left out and its two keys struck from its recording (§6.16). */
export function strikeScreenCardKeys(project: Project, cards: readonly Clip[]): Project {
  if (cards.length === 0) return project
  const fps = project.settings.fps
  const struck = new Map<string, Clip>()
  for (const card of cards) {
    const id = recordingIdOf(card)
    if (id === null) continue
    const recording = struck.get(id) ?? project.clips.find((c) => c.id === id)
    if (recording) struck.set(id, withoutCardKeys(recording, card, fps))
  }
  if (struck.size === 0) return project
  return { ...project, clips: project.clips.map((c) => struck.get(c.id) ?? c) }
}

/* -------------------------------------------------------------- realign */

/**
 * Every screen card realigned after an edit (§6.16, "The store"): `before` is
 * the project the edit started from (always aligned, since every edit ends
 * here), `after` what it made.
 *
 * - A card whose recording is gone is removed with it ("deleting the
 *   recording deletes its card"); a second card on one recording (a paste) is
 *   removed, one card per recording clip.
 * - Every other card spans its recording exactly: its start and length the
 *   recording's, its seconds `duration / fps`, its one beat the landing, no
 *   keys of its own (no exit fade), its version bumped when any of that moved.
 * - Its recording carries exactly `screenCardKeys`: the card's pair as the
 *   edit left it (moved by a head trim, converted by a frame-rate change) is
 *   replaced; a key of the user's own stays.
 * - A recording whose card the edit removed (Drop, Delete) loses exactly the
 *   card's two keys.
 * - A split's right half (a new clip on the recording's track and asset,
 *   starting where the recording now ends) loses the copies of the two keys the
 *   split rebased onto it: the card stays with the left half, which keeps the
 *   clip's id, and is not split.
 *
 * `after` itself comes back when nothing needed to change, and when neither
 * project holds a card.
 */
export function realignScreenCards(before: Project, after: Project): Project {
  const hadCards = before.clips.some(isScreenCard)
  const hasCards = after.clips.some(isScreenCard)
  if (!hadCards && !hasCards) return after
  const fps = after.settings.fps
  const fpsBefore = before.settings.fps
  const byId = new Map(after.clips.map((c) => [c.id, c]))
  const gone = new Set<string>()
  const replace = new Map<string, Clip>()
  const current = (id: string): Clip | undefined => (gone.has(id) ? undefined : replace.get(id) ?? byId.get(id))

  // A card the edit removed: its recording loses the two keys; a split's right half, the copies of them.
  const beforeIds = new Set(before.clips.map((c) => c.id))
  for (const was of before.clips) {
    const recordingId = recordingIdOf(was)
    if (recordingId === null) continue
    const recordingBefore = before.clips.find((c) => c.id === recordingId)
    if (!recordingBefore) continue
    const keysBefore = screenCardKeys(was, recordingBefore, fpsBefore)
    const recording = current(recordingId)
    if (!byId.has(was.id) && recording) {
      const struck = withoutExactly(recording, keysBefore) ?? (cardPairIn(recording.keyframes?.opacity ?? []) ? withoutCardKeys(recording, was, fps) : null)
      if (struck) replace.set(recording.id, struck)
    }
    if (!recording) continue
    for (const right of after.clips) {
      if (beforeIds.has(right.id) || right.assetId !== recording.assetId || right.trackId !== recording.trackId || right.start !== clipEnd(recording)) continue
      const shift = right.start - recordingBefore.start
      const copied = withoutExactly(current(right.id) ?? right, keysBefore.map((k) => ({ ...k, frame: k.frame - shift })))
      if (copied) replace.set(right.id, copied)
    }
  }

  // Every card spans its recording, which carries exactly its two keys.
  const framed = new Set<string>()
  for (const card of after.clips) {
    const recordingId = recordingIdOf(card)
    if (recordingId === null) continue
    const recording = current(recordingId)
    if (!recording || framed.has(recordingId)) {
      gone.add(card.id)
      continue
    }
    framed.add(recordingId)
    const spec = card.graphic!
    const seconds = recording.duration / fps
    const aligned =
      card.start === recording.start &&
      card.duration === recording.duration &&
      card.keyframes === undefined &&
      spec.seconds === seconds &&
      spec.beats.length === 1 &&
      spec.beats[0] === SCREEN_CARD_MOVE_S
    const next: Clip = aligned
      ? card
      : (() => {
          const moved: Clip = {
            ...card,
            start: recording.start,
            duration: recording.duration,
            graphic: { ...spec, seconds, beats: [SCREEN_CARD_MOVE_S], version: spec.version + 1 }
          }
          delete moved.keyframes
          return moved
        })()
    if (next !== card) replace.set(card.id, next)

    const want = screenCardKeys(next, recording, fps)
    const track = recording.keyframes?.opacity ?? []
    if (want.every((k) => track.some((t) => sameKey(t, k)))) continue
    const pair = cardPairIn(track)
    const cleared = pair ? (withoutExactly(recording, pair) ?? recording) : recording
    replace.set(recording.id, withOpacity(cleared, [...(cleared.keyframes?.opacity ?? []), ...want]))
  }

  if (gone.size === 0 && replace.size === 0) return after
  return { ...after, clips: after.clips.filter((c) => !gone.has(c.id)).map((c) => replace.get(c.id) ?? c) }
}
