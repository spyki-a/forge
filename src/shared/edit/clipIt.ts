/**
 * A clip on the timeline cut to a run of its own words (docs/CLIPS.md §3b.6,
 * sheet 26: "Clip it cuts the download, or the clip, to those words").
 *
 * The URL tile's Clip download fetches exactly a run's span; this is the same
 * pick on a clip that is already on the timeline — your own footage after
 * Whisper, or a clip collected from a link — and there nothing is downloaded:
 * the clip's in-point and length are trimmed to the run. Pure, so the store's
 * one `update()` is the whole of it and one undo takes it back.
 *
 * Transcript words are in SOURCE ms (transcript.ts), and a clip may play its
 * source at 2×, at 0.5×, or along a ramp, so a word's source time is not its
 * time on the timeline. Every mapping here goes through `sourceFrameFor` and
 * its inverse `timelineFrameAt` (timeline.ts), which honour both; the panel's
 * own mapping, which ignored speed, moved onto them too.
 *
 * A HOLD is refused with a note: it shows one frame for its whole length, so
 * no word has a frame of its own in it. So is a picture whose SOUND was lifted
 * onto a track of its own (`audioDetached`): the cut keeps the clip's start and
 * moves its in-point, and the lifted sound — the very words the rows list —
 * would stay where it was, seconds out of sync with its picture.
 */

import { clipRamp, clipRateAt, sourceFrameAt } from '../render/speed'
import { clipEnd, rebaseAnimation, timelineFrameAt, type Clip, type Frames, type Project } from '../timeline'
import type { Segment, Transcript } from '../transcript'

/**
 * What the Transcript tile says for a hold, in place of its rows. A note, not a
 * block: Edit (the whole transcript, as before §3b.6) and Listen for still work.
 */
export const HOLD_NOTE = 'this clip has a hold; cut it by hand'

/**
 * What it says for a picture whose sound is on a track of its own (detached by
 * hand, or a Director J-cut): cutting the picture alone would put it out of
 * sync with its sound. A note in place of the rows, as the hold's.
 */
export const DETACHED_NOTE = 'this clip’s sound is on its own track; cut both by hand'

type Timed = Pick<Clip, 'speed' | 'start' | 'inPoint' | 'ramp' | 'duration' | 'hold'>

/**
 * The source a clip plays, in ms: from the start of the frame it opens on to
 * the end of what it consumes — `sourceFrameFor` at its first frame and at
 * `clipEnd`, which at 2× is two source frames a timeline frame and along a
 * ramp the whole curve.
 */
export function clipSourceWindow(clip: Timed, fps: number): { startMs: number; endMs: number } {
  const from = sourceFrameAt(clip, clip.start)
  const to = sourceFrameAt(clip, clip.start + clip.duration)
  return { startMs: (from * 1000) / fps, endMs: (Math.max(from, to) * 1000) / fps }
}

/**
 * A run's source frames: the frame its first moment is in, and the first
 * frame wholly after its last — `[startSource, endSource)`, never empty.
 */
function runSourceFrames(startMs: number, endMs: number, fps: number): { startSource: Frames; endSource: Frames } {
  const startSource = Math.floor((Math.min(startMs, endMs) * fps) / 1000 + 1e-6)
  const endSource = Math.max(startSource + 1, Math.ceil((Math.max(startMs, endMs) * fps) / 1000 - 1e-6))
  return { startSource, endSource }
}

/** Whether `[startMs, endMs)` lies wholly outside the source a clip plays (`clipSourceWindow`): nothing of it to cut to. */
export function outsideWindow(plays: { startMs: number; endMs: number }, startMs: number, endMs: number): boolean {
  return Math.max(startMs, endMs) <= plays.startMs || Math.min(startMs, endMs) >= plays.endMs
}

/**
 * The timeline frames a cut to `[startMs, endMs)` of source keeps, as
 * `[from, to)`: from the frame showing the run's first moment to the first
 * frame wholly after its last.
 *
 * The first word's start is FLOORED to its frame (the frame its first sound is
 * in) and the last word's end CEILED (the first frame after it), so the cut
 * holds every word whole. At a speed above 1 the timeline skips source frames,
 * and the frame showing the start may be after it: then the one before is
 * taken, so a word's first sound is not lost — the cut opens on its frame or
 * just before it. Clamped to the clip, never empty; null for a hold.
 */
export function cutFrames(clip: Timed, startMs: number, endMs: number, fps: number): { from: Frames; to: Frames } | null {
  if (clip.hold) return null
  const end = clip.start + clip.duration
  const { startSource, endSource } = runSourceFrames(startMs, endMs, fps)
  let from = timelineFrameAt(clip, (startSource * 1000) / fps, fps)
  const after = timelineFrameAt(clip, (endSource * 1000) / fps, fps)
  if (from === null || after === null) return null
  if (from > clip.start && sourceFrameAt(clip, from) > startSource) from -= 1
  from = Math.min(from, end - 1)
  return { from, to: Math.max(from + 1, Math.min(after, end)) }
}

/** What a cut did: the project, and a note when it was refused for a reason a person must be told (a hold, a lifted sound). */
export interface ClipCut {
  project: Project
  note: string | null
}

/**
 * The clip trimmed to `[startMs, endMs)` of its source (§3b.6): its START on
 * the timeline stays and the kept footage moves to it — its in-point and
 * length become the run's — and nothing else on the track moves. Not what
 * dragging its edges does: a head drag (`trimStart`) moves the start with the
 * in-point, so the footage stays where it was on the timeline; this keeps the
 * clip where it is and slides the run to its start, which is why a picture
 * whose sound was lifted away is refused (below).
 *
 * What the cut keeps is shown as it was: the new in-point is the source frame
 * the old clip showed at the cut's first frame, so every kept frame shows the
 * same footage it did — exactly at a whole-number speed, within one source
 * frame otherwise, since an in-point is a whole frame (`splitClip`'s limit
 * too). A ramp keeps the part of its curve the cut keeps — from the rate under
 * its first frame to the rate under its end — as `splitClip` gives each half
 * its part; that sub-ramp plays the kept footage over the kept frames
 * (EFFECTS.md §18's integral). The animation stays on the picture it was drawn
 * against (`rebaseAnimation`), as a head trim's does; fades and an incoming
 * transition stay with the edges they belong to, which are still there.
 *
 * At a constant speed the cut is a fixed point: cutting the cut clip to the
 * same run again changes nothing (the Transcript tile then lists only the
 * run, so pressing again on all its rows is an ordinary thing to do). Its
 * length is counted on its OWN mapping, from the whole-frame in-point — the
 * old clip's, counted from a fractional source, could reach the run's end a
 * frame early, and each press shaved a frame (0.5×: 299 runs of 300). And at
 * a speed between 1× and 1.5×, where the old clip skipped the word's first
 * frame and opened on the one before, a clip anchored on that frame shows the
 * word's own first frame next, so it opens there instead (1.25×: 66 of 300
 * re-opened a frame later on a second press). A ramp keeps the property it
 * had: within one frame, not a fixed point.
 *
 * Refused, the project unchanged: a hold (with HOLD_NOTE); a picture whose
 * sound is on its own track (with DETACHED_NOTE); a clip that is not there, a
 * still, or a range wholly outside what the clip plays (no note — the
 * Transcript tile only lists the words a clip plays, so it never asks). A cut
 * that keeps the whole clip changes nothing, and adds no undo step.
 */
export function clipToRange(project: Project, clipId: string, startMs: number, endMs: number): ClipCut {
  const clip = project.clips.find((c) => c.id === clipId)
  if (!clip) return { project, note: null }
  if (clip.hold) return { project, note: HOLD_NOTE }
  if (clip.audioDetached) return { project, note: DETACHED_NOTE }
  const asset = project.assets.find((a) => a.id === clip.assetId)
  if (!asset || asset.kind === 'image') return { project, note: null }
  const fps = project.settings.fps
  if (outsideWindow(clipSourceWindow(clip, fps), startMs, endMs)) return { project, note: null }
  const lo = Math.min(startMs, endMs)
  const hi = Math.max(startMs, endMs)

  const frames = cutFrames(clip, lo, hi, fps)
  if (!frames) return { project, note: null }
  if (frames.from === clip.start && frames.to === clipEnd(clip)) return { project, note: null }

  const delta = frames.from - clip.start
  const ramp = clipRamp(clip)
  const cut: Clip = {
    ...clip,
    ...rebaseAnimation(clip, -delta),
    // A shared move keeps its place on the picture, as a head trim's does (trimStart).
    ...(clip.motion?.window
      ? { motion: { ...clip.motion, window: { ...clip.motion.window, from: Math.max(0, clip.motion.window.from + delta) } } }
      : {}),
    inPoint: sourceFrameAt(clip, frames.from),
    duration: frames.to - frames.from,
    ...(ramp ? { ramp: { from: clipRateAt(clip, frames.from), to: clipRateAt(clip, frames.to) } } : {})
  }
  if (!ramp) {
    const { startSource, endSource } = runSourceFrames(lo, hi, fps)
    // Opens on the word's own first frame when the clip, anchored a frame before it, would show it next.
    if (cut.inPoint < startSource && sourceFrameAt(cut, cut.start + 1) === startSource) cut.inPoint = startSource
    // Its length on its own mapping — the first of its frames past the run's end — never longer than the cut.
    const reach = timelineFrameAt(cut, (endSource * 1000) / fps, fps) ?? clipEnd(cut)
    cut.duration = Math.max(1, reach - cut.start)
  }
  return { project: { ...project, clips: project.clips.map((c) => (c.id === clipId ? cut : c)) }, note: null }
}

/**
 * The words Edit lists for a clip: every word it plays any part of (`overlap`,
 * what its captions burn) — or, for a hold, which has no span of its own, the
 * whole transcript, as Edit listed for every clip before §3b.6. Null when
 * there is nothing to correct from this clip; the tile then offers no Edit.
 */
export function clipEditWords(clip: Timed, t: Transcript, fps: number): ClipWords | null {
  if (clip.hold) return clipWords(t, { startMs: -Infinity, endMs: Infinity })
  return clipWords(t, clipSourceWindow(clip, fps), 'overlap')
}

/** The words a clip plays, as a transcript of their own, and where they start in the whole one. */
export interface ClipWords {
  /** Numbered from 0 by position, its segments the whole transcript's cut to these words — so a row is a sentence as before. */
  transcript: Transcript
  /** The position in the whole transcript's `words` of this one's first word. */
  first: number
}

/*
 * Kept per transcript, for the spans it last gave: the Transcript tile draws
 * on every playhead move, and its rows (wordRun.ts `rowsOf`) are cached by the
 * transcript object they were made from — a new object every draw would make
 * them all again and draw every row again. Transcripts are never changed in
 * place (a corrected word makes a new one), so identity is enough. A few
 * spans, not one: the tile asks for the rows' words AND Edit's (by overlap)
 * on the same draw, and with one slot each would throw the other's away.
 */
const clipWordsCache = new WeakMap<Transcript, Map<string, ClipWords>>()
const CLIP_WORDS_KEPT = 8

/**
 * Which words are a clip's. `middle`, the rows': those whose middle lies inside
 * the source it plays — a word cut through by a clip's edge is the clip's when
 * most of it is in it, so every row can be cut to. `overlap`, Edit's: every
 * word the clip plays any part of — what the captions burn (ass.ts takes each
 * word that overlaps the clip's range), so a misheard word half cut off by the
 * clip's edge can still be corrected from it.
 */
export type ClipWordsRule = 'middle' | 'overlap'

/**
 * The words a clip plays (`clipSourceWindow`), by `rule` (the middle, unless
 * said). Null when it plays none.
 *
 * Renumbered from 0 by POSITION, which is what the rows and a run index by
 * (wordRun.ts). A Whisper transcript's indices can have gaps — a word a
 * person emptied is taken out and nothing is renumbered (transcript.ts
 * `withWordText`) — so the segments are mapped from index to position here,
 * and a correction made through this transcript goes back by position:
 * `t.words[first + i]`.
 */
export function clipWords(t: Transcript, plays: { startMs: number; endMs: number }, rule: ClipWordsRule = 'middle'): ClipWords | null {
  let first = -1
  let last = -1
  for (let i = 0; i < t.words.length; i++) {
    const w = t.words[i]
    const middle = (w.startMs + w.endMs) / 2
    const its = rule === 'overlap' ? w.endMs > plays.startMs && w.startMs < plays.endMs : middle >= plays.startMs && middle < plays.endMs
    if (its) {
      if (first < 0) first = i
      last = i
    }
  }
  if (first < 0) return null
  // What is made depends only on the transcript and the span, so both rules share one cache.
  const key = `${first}:${last}`
  let kept = clipWordsCache.get(t)
  const cached = kept?.get(key)
  if (cached) return cached
  if (!kept || kept.size >= CLIP_WORDS_KEPT) {
    kept = new Map()
    clipWordsCache.set(t, kept)
  }

  const words = t.words.slice(first, last + 1).map((w, i) => ({ ...w, index: i }))
  const position = new Map<number, number>()
  t.words.forEach((w, i) => position.set(w.index, i))
  const segments: Segment[] = []
  for (const s of t.segments) {
    const a = position.get(s.wordStart)
    const b = position.get(s.wordEnd)
    if (a === undefined || b === undefined) continue
    const lo = Math.max(a, first)
    const hi = Math.min(b, last)
    if (hi < lo) continue
    const slice = words.slice(lo - first, hi - first + 1)
    segments.push({
      id: s.id,
      startMs: slice[0].startMs,
      endMs: slice[slice.length - 1].endMs,
      text: slice.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim(),
      wordStart: lo - first,
      wordEnd: hi - first
    })
  }
  const value: ClipWords = { transcript: { ...t, words, segments }, first }
  kept.set(key, value)
  return value
}
