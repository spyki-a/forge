/**
 * Sound on a graphic's beats (docs/CLIPS.md §6.14): which library files a
 * graphic sounds with, on which frames, at which level, on which lane, under
 * which rule. The app places every sound; the model never picks one (§6.6).
 *
 * - **By file name, never by role.** `SOUND_ROLES` has two `tick` files,
 *   `clock_tick.wav` and `heartbeat_pulse.wav` (director/soundRoles.ts:46-47),
 *   and `pickSound`'s pattern (director/sound.ts:75-80) sorts a role's files
 *   longest first, so a role-based pick lands the heartbeat. The pack is
 *   filtered to `GRAPHIC_SOUND_FILES`' names (`SoundFile.name`) and, within a
 *   key, the file varies by index in the list's own order.
 * - **Placement.** A tick's measured peak on the beat frame (`beatFrame`,
 *   frame.ts), as `placeSounds` lines peaks up (director/sound.ts:113-130); a
 *   whoosh's peak on the fastest frame of its move, the frame whose progress
 *   (motion.ts `progress`, as the drawer calls it) changes most from the frame
 *   before, never a held one.
 * - **The cap.** `GRAPHIC_SOUND_CAP` sounds per footage clip, in onset order,
 *   over every graphic on that footage clip.
 * - **The rule.** Each sound clip carries the graphic's rule (`GRAPHIC_RULE`
 *   or `CLIPS_GRAPHIC_RULE`) and `forGraphic`, and a file the app brings
 *   carries `broughtBy: rule`, never the Director's `SOUND_RULE`.
 *
 * Pure and node-runnable: no clock but the default id maker's (injectable),
 * no DOM, no `node:path`.
 */

import { GRAPHIC_RULE } from '../director/apply'
import { SOUND_LANE_NAME } from '../director/sound'
import type { SoundFile, SoundPack } from '../director/soundRoles'
import { MAX_SOUND_GAIN } from '../render/soundLevels'
import { drawsItself } from '../edit/recipes'
import { addTrack, clipEnd, overlapsOn, trackLimitReached, type Clip, type MediaAsset, type Project, type Track } from '../timeline'
import { beatFrame } from './frame'
import { DURATIONS, progress, type MotionEase } from './motion'
import { graphicStyleOf } from './style'
import { beatOf, drawOnEase } from './templates/layout'
import type { GraphicSpec } from './template'

/* --------------------------------------------------------------- the files */

export type GraphicSoundKey = 'tick' | 'whoosh'

/**
 * The files a graphic may sound with, by key, in the order the index walks
 * them (§6.14). Every name is an entry of `SOUND_ROLES` (soundRoles.ts:35-67):
 * `clock_tick.wav` 0.08 s, peak at 5 ms; the whooshes 0.26-0.65 s, peaks
 * mid-file. `heartbeat_pulse.wav` (a tick by role, a pulse by ear) and
 * `riser_climax.wav` (the table's only hit, a boom) are not here.
 */
export const GRAPHIC_SOUND_FILES: Readonly<Record<GraphicSoundKey, readonly string[]>> = Object.freeze({
  tick: Object.freeze(['clock_tick.wav']),
  whoosh: Object.freeze(['fast_whoosh.wav', 'whoosh_fast.wav', 'sword_swish.wav', 'swoosh_heavy.wav'])
})

/** Sounds per footage clip, in onset order (§6.14; a proposal until M18). */
export const GRAPHIC_SOUND_CAP = 3

/**
 * Each key's level, dBFS peak (§6.14; proposals until M18): under speech,
 * not over the music, so not `SOUND_LEVEL_DB`'s music-relative table.
 */
export const GRAPHIC_SOUND_DB: Readonly<Record<GraphicSoundKey, number>> = Object.freeze({ tick: -24, whoosh: -26 })

/** The audio track a Clip-it or Transcript-tile graphic's sounds go on (§6.14); never the Director's lane. */
export const GRAPHIC_SOUND_LANE_NAME = 'Graphic sounds'

/** §6.14's one note when the library holds none of `GRAPHIC_SOUND_FILES`. */
export const NO_SOUND_LIBRARY_NOTE = 'no sound library is installed — graphics land silent'

/** A key the library has no file for, while it has the other's (not §6.14's words; the plan gives one note for both). */
export function noSoundFileNote(key: GraphicSoundKey): string {
  return `no ${key} in the sound library — that sound is not placed`
}

/**
 * The fader for a graphic's sound (§6.14): `min(MAX_SOUND_GAIN, 10^((level −
 * peakDb) ÷ 20))`, the file's lift to its level capped at the fader's
 * ceiling (render/soundLevels.ts `MAX_SOUND_GAIN`), as `soundGain` computes
 * it, without the music's fader.
 */
export function graphicSoundGain(key: GraphicSoundKey, peakDb: number): number {
  return Math.min(MAX_SOUND_GAIN, Math.pow(10, (GRAPHIC_SOUND_DB[key] - peakDb) / 20))
}

/** The pack's files for each key, in `GRAPHIC_SOUND_FILES`' order; a name the list does not hold is never used. */
export function graphicSoundFiles(pack: SoundPack): Record<GraphicSoundKey, SoundFile[]> {
  const of = (key: GraphicSoundKey): SoundFile[] =>
    GRAPHIC_SOUND_FILES[key].flatMap((name) => {
      const file = pack.find((f) => f.name === name)
      return file ? [file] : []
    })
  return { tick: of('tick'), whoosh: of('whoosh') }
}

/* ------------------------------------------------------------- the cues */

/** One sound a graphic asks for: its key, the timeline frame its peak goes on, and the field it sounds for. */
export interface GraphicSoundCue {
  key: GraphicSoundKey
  /** A timeline frame: the graphic clip's start plus the local frame. */
  frame: number
  /** The text of the field the sound is for, for the clip's reason. */
  field: string
  /** The graphic clip's id. */
  graphicId: string
}

/** A move as a drawer runs it: `progress(t, start, seconds, ease)`, t in seconds from the graphic clip's start. */
interface Move {
  start: number
  seconds: number
  ease: MotionEase
}

/**
 * The fastest frame of a move, local to the graphic clip: the frame f in
 * [1, frames − 1] whose progress changes most from frame f − 1's (the
 * absolute change), the earliest on a tie. Null when no frame changes at all
 * (the move is held over the clip's whole span): a whoosh is never placed on
 * a held frame. Frame 0 has no frame before it on the clip and is not a
 * candidate.
 */
export function fastestFrame(move: Move, fps: number, frames: number): number | null {
  if (!(fps > 0)) return null
  let best: number | null = null
  let most = 0
  let prev = progress(0, move.start, move.seconds, move.ease)
  for (let f = 1; f < frames; f++) {
    const p = progress(f / fps, move.start, move.seconds, move.ease)
    const change = Math.abs(p - prev)
    if (change > most) {
      most = change
      best = f
    }
    prev = p
  }
  return best
}

/**
 * The sounds a graphic asks for, before the cap (§6.14's table). Restrained
 * styles (every preset but `energetic`): `counter`, `ring` a tick on the
 * arrival beat; `bars`, `steps` a tick on the first item's beat; `keyword` a
 * tick on its beat; `callout` a whoosh on its stroke's fastest frame;
 * `quote`, `lower-third`, `screen-card` and every template not yet drawn,
 * none. `energetic` adds a tick on every beat and a whoosh on the fastest
 * frame of each stroke and each entrance, the moves as the drawers in
 * templates/ run them:
 * - `counter`, `ring`: the group's entrance from t = 0 (counter.ts:80, ring.ts:95);
 * - `bars`: the title's from 0 and each row's ending on its beat (bars.ts:96, :106);
 * - `steps`: the title's from 0, each row's ending on its beat, and each
 *   connector stroke ending on its row's beat (`line` from the second row,
 *   `tree` every row; steps.ts:167, :192, :204-221);
 * - `keyword`: the card's ending on its beat and, with a lit word, the
 *   underline's stroke (keyword.ts:85, :114); the words' own staggered
 *   entrances are inside the card's and are not counted separately;
 * - `callout`: the stroke ending on its beat and the label's from the beat
 *   (callout.ts:162, :171).
 * Under `energetic` the quote, the lower third and the screen card are
 * still silent: the table's "none" is read as the template's, not the
 * style's. Two cues of one key on one frame are one. In frame order, ticks
 * before whooshes on a tie.
 */
export function graphicSoundCues(
  project: Pick<Project, 'settings' | 'graphics'>,
  clip: Pick<Clip, 'id' | 'start' | 'duration'>,
  spec: GraphicSpec
): GraphicSoundCue[] {
  const fps = project.settings.fps
  const style = graphicStyleOf(project, spec)
  const energetic = style.energy === 'energetic'
  const E = DURATIONS.entrance
  const S = DURATIONS.stroke
  const enter = (start: number): Move => ({ start, seconds: E, ease: style.motion.ease })
  const strokeTo = (beat: number): Move => ({ start: beat - S, seconds: S, ease: drawOnEase(style) })
  const ticks: { beat: number; field: string }[] = []
  const moves: { move: Move; field: string }[] = []
  const data = spec.data
  // Every beat's tick (energetic), each with the field that arrives on it.
  const everyBeat = (fieldOf: (i: number) => string): void => {
    spec.beats.forEach((b, i) => {
      if (Number.isFinite(b)) ticks.push({ beat: b, field: fieldOf(i) })
    })
  }

  switch (data.template) {
    case 'counter':
    case 'ring':
      if (energetic) {
        everyBeat(() => data.value)
        moves.push({ move: enter(0), field: data.value })
      } else ticks.push({ beat: beatOf(spec, 0), field: data.value })
      break
    case 'bars': {
      const valueOf = (i: number): string => (data.items[i] ?? data.items[data.items.length - 1])?.value ?? ''
      if (energetic) {
        everyBeat(valueOf)
        moves.push({ move: enter(0), field: data.title })
        data.items.forEach((item, i) => moves.push({ move: enter(beatOf(spec, i) - E), field: item.label }))
      } else ticks.push({ beat: beatOf(spec, 0), field: valueOf(0) })
      break
    }
    case 'steps': {
      const labelOf = (i: number): string => (data.items[i] ?? data.items[data.items.length - 1])?.label ?? ''
      if (energetic) {
        everyBeat(labelOf)
        moves.push({ move: enter(0), field: data.title })
        data.items.forEach((item, i) => {
          const beat = beatOf(spec, i)
          if ((data.connector === 'line' && i >= 1) || data.connector === 'tree') moves.push({ move: strokeTo(beat), field: item.label })
          moves.push({ move: enter(beat - E), field: item.label })
        })
      } else ticks.push({ beat: beatOf(spec, 0), field: labelOf(0) })
      break
    }
    case 'keyword':
      if (energetic) {
        everyBeat(() => data.words)
        moves.push({ move: enter(beatOf(spec, 0) - E), field: data.words })
        if (Number.isInteger(data.lit) && data.lit >= 0) moves.push({ move: strokeTo(beatOf(spec, 0)), field: data.words })
      } else ticks.push({ beat: beatOf(spec, 0), field: data.words })
      break
    case 'callout':
      moves.push({ move: strokeTo(beatOf(spec, 0)), field: data.label })
      if (energetic) {
        everyBeat(() => data.label)
        moves.push({ move: enter(beatOf(spec, 0)), field: data.label })
      }
      break
    default:
      break
  }

  const cues: GraphicSoundCue[] = []
  const seen = new Set<string>()
  const add = (key: GraphicSoundKey, local: number, field: string): void => {
    const frame = clip.start + local
    if (seen.has(`${key}@${frame}`)) return
    seen.add(`${key}@${frame}`)
    cues.push({ key, frame, field, graphicId: clip.id })
  }
  // A tick's peak on the frame its element arrives on: §6.3's beat frame, `ceil(beat × fps − 1e-6)`, rounded UP.
  for (const t of ticks) add('tick', beatFrame(t.beat, fps), t.field)
  for (const m of moves) {
    const f = fastestFrame(m.move, fps, clip.duration)
    if (f !== null) add('whoosh', f, m.field)
  }
  return cues.sort(cueOrder)
}

/** Onset order: by frame, a tick before a whoosh on one frame, then by graphic id so the order is total. */
function cueOrder(a: GraphicSoundCue, b: GraphicSoundCue): number {
  return a.frame - b.frame || (a.key === b.key ? 0 : a.key === 'tick' ? -1 : 1) || (a.graphicId < b.graphicId ? -1 : a.graphicId > b.graphicId ? 1 : 0)
}

/* ------------------------------------------------------- the footage clip */

/**
 * The footage clip a graphic clip shows over, for the cap: of the clips on a
 * video track that draw nothing themselves (no `graphic`, `text`, card or
 * moment, `drawsItself`) and are no adjustment layer, and whose span holds
 * the graphic's first frame (`graphicTiming` never starts a graphic before
 * its footage clip), the one its subject was taken from (`spec.subject`),
 * else one of its grounding's asset (`spec.grounding.assetId`), else the
 * bottom-most. Null when there is none. Read from the project alone, so
 * Find again and the "Graphic sounds" switch find the same footage clip.
 */
export function footageOf(project: Pick<Project, 'tracks' | 'clips'>, clip: Pick<Clip, 'id' | 'start'>, spec: Pick<GraphicSpec, 'subject' | 'grounding'>): string | null {
  const video = project.tracks.filter((t) => t.kind === 'video').map((t) => t.id)
  const under = project.clips
    .filter((c) => c.id !== clip.id && video.includes(c.trackId) && !drawsItself(c) && !c.adjustment && c.start <= clip.start && clip.start < clipEnd(c))
    .sort((a, b) => video.indexOf(a.trackId) - video.indexOf(b.trackId))
  const subject = spec.subject?.clipId
  return (
    (subject !== undefined && under.find((c) => c.id === subject)?.id) ||
    (spec.grounding && under.find((c) => c.assetId === spec.grounding!.assetId)?.id) ||
    under[0]?.id ||
    null
  )
}

/* ---------------------------------------------------------------- the lane */

/**
 * The audio track a graphic's sound goes on over [start, start + duration)
 * (§6.14), written as `soundLaneFor` is (director/apply2.ts:628-641, a
 * function inside the spine's apply, not an export). For `GRAPHIC_RULE`
 * (Direct's): an audio track marked `director`, not locked and free over the
 * span, else a new one named `SOUND_LANE_NAME` and marked `director`. For
 * any other rule (`CLIPS_GRAPHIC_RULE`): an unmarked audio track named
 * `GRAPHIC_SOUND_LANE_NAME`, not locked and free, else a new one so named;
 * never the Director's lane. Free counts `placed`, the sounds placed so far
 * that are not on the project yet. Null at the track limit. The project
 * comes back new when a track was added and as the same object when not.
 */
export function graphicSoundLane(
  project: Project,
  rule: string,
  start: number,
  duration: number,
  placed: readonly Clip[] = []
): { project: Project; trackId: string } | null {
  const direct = rule === GRAPHIC_RULE
  const busy = (trackId: string): boolean =>
    overlapsOn(project, trackId, start, duration).length > 0 ||
    placed.some((c) => c.trackId === trackId && start < c.start + c.duration && start + duration > c.start)
  for (const t of project.tracks) {
    if (t.kind !== 'audio' || t.locked) continue
    const ours = direct ? t.director === true : !t.director && t.name === GRAPHIC_SOUND_LANE_NAME
    if (ours && !busy(t.id)) return { project, trackId: t.id }
  }
  if (trackLimitReached(project)) return null
  const next = addTrack(project, 'audio', 'top')
  const added = next.tracks[next.tracks.length - 1]
  const named: Track = direct ? { ...added, name: SOUND_LANE_NAME, director: true } : { ...added, name: GRAPHIC_SOUND_LANE_NAME }
  return { project: { ...next, tracks: next.tracks.map((t) => (t.id === added.id ? named : t)) }, trackId: added.id }
}

/* --------------------------------------------------------------- the sounds */

const defaultId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export interface GraphicSoundsOptions {
  /** Id maker for the sound clips and the assets; injectable so tests are deterministic. */
  newId?: (prefix: string) => string
}

/**
 * The sound clips for one graphic clip `clip` (§6.14), with `spec` its spec
 * (`clip.graphic`, passed as the plan's signature has it). `clip` is the
 * GRAPHIC clip: its id is each sound's `forGraphic`, and its start is what
 * `spec.beats` count from (§6.1).
 *
 * - With `Project.graphics.sound` false: nothing, and no note.
 * - The cap and the index: every graphic clip on the same footage clip
 *   (`footageOf`), this one included whether or not it is on the project
 *   yet, gives its cues (`graphicSoundCues`); those whose key the pack has a
 *   file for are taken in onset order, the first `GRAPHIC_SOUND_CAP` kept,
 *   and this graphic's kept cues are placed. Within a key the file is the
 *   cue's index among the kept cues of that key, modulo the files. So the
 *   result is a function of the project's graphics, whichever order the
 *   caller places them in. A graphic over no footage clip is counted alone.
 * - Each cue: the file's peak frame `min(fileFrames − 1, round(peakSeconds ×
 *   fps))` (rounded to nearest, as `placeSounds`) before the cue's frame, so
 *   the peak lands on it; started part-way in before the timeline's start;
 *   the whole file, never past the graphic clip's end; on
 *   `graphicSoundLane`'s lane; at `graphicSoundGain`.
 * - A file already in the pool as an audio asset of the same path is reused
 *   (no new asset, no new `broughtBy`); else a new asset with `broughtBy:
 *   rule`.
 *
 * Returns the plan's `{ clips, assets }` and, beyond its words, `tracks`
 * (the lanes the project does not have yet, to append in order, as
 * `addTrack` would have) and `notes` (§6.14's one note when the library has
 * no file, and a note for a sound with no lane). The caller merges the
 * tracks, assets and clips into the project before the next graphic's call,
 * so the next call reuses the file and sees the lane busy.
 */
export function graphicSounds(
  project: Project,
  clip: Clip,
  spec: GraphicSpec,
  rule: string,
  pack: SoundPack,
  options: GraphicSoundsOptions = {}
): { clips: Clip[]; assets: MediaAsset[]; tracks: Track[]; notes: string[] } {
  const none = { clips: [], assets: [], tracks: [], notes: [] }
  if (project.graphics?.sound === false) return none
  const fps = project.settings.fps
  const newId = options.newId ?? defaultId
  const files = graphicSoundFiles(pack)
  const own = graphicSoundCues(project, clip, spec)
  if (own.length === 0) return none
  if (files.tick.length === 0 && files.whoosh.length === 0) return { ...none, notes: [NO_SOUND_LIBRARY_NOTE] }

  const notes: string[] = []
  for (const key of ['tick', 'whoosh'] as const) {
    if (files[key].length === 0 && own.some((c) => c.key === key)) notes.push(noSoundFileNote(key))
  }

  // Every graphic on this footage clip, this one as given; counted in onset order.
  const footage = footageOf(project, clip, spec)
  const graphics: { clip: Clip; spec: GraphicSpec }[] = [{ clip, spec }]
  if (footage !== null) {
    for (const c of project.clips) {
      if (c.id === clip.id || !c.graphic) continue
      if (footageOf(project, c, c.graphic) === footage) graphics.push({ clip: c, spec: c.graphic })
    }
  }
  const kept = graphics
    .flatMap((g) => (g.clip.id === clip.id ? own : graphicSoundCues(project, g.clip, g.spec)))
    .filter((c) => files[c.key].length > 0)
    .sort(cueOrder)
    .slice(0, GRAPHIC_SOUND_CAP)

  let next = project
  const clips: Clip[] = []
  const assets: MediaAsset[] = []
  const assetFor = new Map<string, string>(project.assets.filter((a) => a.kind === 'audio').map((a) => [a.path, a.id]))
  const indexOf: Record<GraphicSoundKey, number> = { tick: 0, whoosh: 0 }
  const graphicEnd = clip.start + clip.duration

  for (const cue of kept) {
    const index = indexOf[cue.key]++
    if (cue.graphicId !== clip.id) continue
    const file = files[cue.key][index % files[cue.key].length]
    // Frames from seconds, rounded to nearest, as placeSounds rounds them.
    const fileFrames = Math.max(1, Math.round(file.seconds * fps))
    const peakFrames = Math.min(fileFrames - 1, Math.round(file.peakSeconds * fps))
    let start = cue.frame - peakFrames
    let inPoint = 0
    if (start < 0) {
      inPoint = -start
      start = 0
    }
    const toPeak = peakFrames - inPoint
    const duration = Math.min(fileFrames - inPoint, graphicEnd - start)
    if (duration <= toPeak) {
      notes.push(`the ${cue.key} on "${cue.field}" falls after the graphic ends — not placed`)
      continue
    }
    const lane = graphicSoundLane(next, rule, start, duration, clips)
    if (!lane) {
      notes.push(`no free audio track for the ${cue.key} on "${cue.field}" — not placed`)
      continue
    }
    next = lane.project

    let assetId = assetFor.get(file.file)
    if (!assetId) {
      assetId = newId('graphic-sfx')
      assetFor.set(file.file, assetId)
      assets.push({
        id: assetId,
        path: file.file,
        name: file.name,
        kind: 'audio',
        durationFrames: fileFrames,
        width: null,
        height: null,
        fps: null,
        hasVideo: false,
        hasAudio: true,
        // A library file, not a drawn card: any positive size says so, as placeSounds' assets do.
        size: 1,
        broughtBy: rule
      })
    }

    clips.push({
      id: newId('graphic-sound'),
      assetId,
      trackId: lane.trackId,
      start,
      duration,
      inPoint,
      volume: graphicSoundGain(cue.key, file.peakDb),
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      color: { brightness: 0, contrast: 1, saturation: 1 },
      forGraphic: clip.id,
      generatedBy: { rule, reason: `${cue.key} on "${cue.field}" · ${file.name}` }
    })
  }

  const had = new Set(project.tracks.map((t) => t.id))
  return { clips, assets, tracks: next.tracks.filter((t) => !had.has(t.id)), notes }
}
