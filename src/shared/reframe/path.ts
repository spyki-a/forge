import { fitRect } from '../automation/framing'
import { evenDown, safeCrop, type Size } from '../render/crop'
import type { Shot, SubjectSample, SubjectTrack, UnitRect } from './types'

/**
 * The crop path — where a followed clip's crop sits, shot by shot
 * (docs/CLIPS.md §4.6, step 1e).
 *
 * Pure and deterministic: the same track and canvas give the same path, so 1f
 * can derive the crop every time it is read rather than storing keys an
 * ordinary edit would leave stale (§4.7). Everything here is in SOURCE pixels
 * of the upright frame and SOURCE milliseconds; 1f maps both onto the clip.
 *
 * The output is shaped for 1f's keys. ffmpeg's expression parser refuses a
 * nested `if` of more than about 92 keys (EFFECTS.md §48), so the keys compile
 * as a flat sum of steps — and a flat sum wants exactly this: per shot one
 * held position (a step on the cut's frame, §45's half-frame boundary) and
 * each pan as one segment `[fromMs, toMs] → to` (one eased term).
 */

export const PATH_RULES = {
  smoothMs: 600, // a running median of the subject's centre, over never fewer than three samples
  marginShare: 0.06, // of the crop's free-axis length, each side
  deadZone: 0.5, // the centre may wander inside the middle half of the crop without a move
  triggerMs: 500, // ... and must stay outside it this long before the crop moves
  panMs: 600, // a move, eased in-out
  maxSpeed: 1.0, // crop lengths per second — a longer move takes longer
  minHoldMs: 1000, // between two moves
  bothShare: 0.6, // two faces together on ≥ 60 % of a shot's samples = a two-shot
  staticShare: 0.9, // the subject inside the held crop on ≥ 90 % of samples = no pan at all
  twoUpFaceY: 0.4 // a two-up half places its face's centre this far down the half
} as const

/**
 * Rule 2: faces lead a shot when at least this share of its samples hold one.
 * The same 20 % decides which shots the salient box is asked about (§4.4), and
 * here also whether a SECOND person is in the shot at all: two faces on fewer
 * samples than this are one person and a stray detection, not a lost face.
 */
export const FACE_SHARE = 0.2

/** Rules 4 and 6: the held position is solved over the shot's first second. */
export const OPENING_MS = 1000

/**
 * Rule 5: nothing triggers in a shot's first three frames — a sample this
 * close after the cut starts no trigger clock. The track carries no frame
 * rate, so the head is a time: three frames at 24 fps, more than three at any
 * faster rate. (It was three of the track's SAMPLES, 1.5 s at 2 a second, and
 * no shot under about 2.6 s could pan at all.)
 */
export const HEAD_MS = 125

/** A portrait source going to 16:9 places the face's centre a third of the way down the crop. */
export const UPPER_THIRD = 1 / 3

/** The track's cadence when it has too few samples to measure (§4.3: 2 a second). */
const DEFAULT_SAMPLE_MS = 500

/** A move on one axis: from wherever the crop is at `fromMs` to `to` at `toMs`, eased in-out. */
export interface Pan {
  fromMs: number
  toMs: number
  to: number
}

/** One half of a stacked two-up: its top-left in source px, `half`-sized; pans move x only. */
export interface HalfCrop {
  x: number
  y: number
  pans: Pan[]
}

export type ShotWhy = 'face' | 'both' | 'two-up' | 'larger' | 'ground' | 'salient' | 'centre'

export interface ShotCrop {
  startMs: number
  endMs: number
  /**
   * The held position on the free axis, source px. On a two-up shot it and
   * `pans` mirror the TOP half's x, so a consumer that can draw only one crop
   * gets the top half's position at `size` (§4.7's fallback).
   */
  at: number
  pans: Pan[]
  why: ShotWhy
  /** why 'two-up' only: each half's top-left in source px, `half`-sized; top = the face further left in the source */
  halves?: { top: HalfCrop; bottom: HalfCrop }
}

export interface CropPath {
  /** x for landscape → portrait/square; y for portrait → landscape. The other axis is always 0. */
  axis: 'x' | 'y'
  /** ONE size for the clip: full height (or width) at the target aspect, even, safeCrop'd */
  size: { width: number; height: number }
  /** size.width × size.height / 2 on a two-up clip (whose size.height is a multiple of 4); evenDown of it otherwise */
  half: { width: number; height: number }
  shots: ShotCrop[]
  notes: string[]
}

/** Shares of each axis the user dragged a two-up half by (§4.7's CropOverlay). */
export interface HalfOffsets {
  top?: { x: number; y: number }
  bottom?: { x: number; y: number }
}

/** The part of `Clip.follow` the path reads. `twoUp` absent means on. */
export interface PathFollow {
  /** By shot start ms: a share of the crop's free-axis length, added after the solve. Not read on a two-up shot. */
  offsets?: Record<number, number>
  /** By shot start ms, a two-up shot's only: each half's own drag, shares of `half`. */
  halfOffsets?: Record<number, HalfOffsets>
  twoUp?: boolean
}

/** A box in source px. */
interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** One sample's subject: where it was, when. */
interface Mark {
  ms: number
  box: Box
}

/** Rule 5's timing, from the track's cadence: the head it ignores, and how far either side the running median reaches. */
interface Pace {
  headMs: number
  reachMs: number
}

/** One free axis: the crop's length on it, the room it can move in, and where the subject sits in it. */
interface Rail {
  axis: 'x' | 'y'
  len: number
  room: number
  /** The share of the crop the subject's centre is placed at: ½ centres it, ⅓ is the upper third. */
  anchor: number
}

/**
 * The path for one clip of `track`'s file on a `target`-shaped canvas.
 *
 * Rules 1–8 of §4.6, in order, per shot. `follow` carries the user's hand
 * corrections and the dock's Stack two people.
 */
export function cropPath(track: SubjectTrack, target: Size, follow?: PathFollow): CropPath {
  const W = track.width
  const H = track.height
  if (!(W > 0 && H > 0 && target.width > 0 && target.height > 0)) {
    return { axis: 'x', size: { width: 0, height: 0 }, half: { width: 0, height: 0 }, shots: [], notes: ['the file or the canvas has no size'] }
  }
  const source = { width: W, height: H }

  // Rule 1: one size for the clip. A wider canvas than the source moves the
  // crop on y; the same shape has no room to move on either.
  const axis: 'x' | 'y' = target.width / target.height > W / H + 0.001 ? 'y' : 'x'
  const base = clipSize(source, target)
  const baseLen = axis === 'x' ? base.width : base.height

  // The source already has the canvas's shape: the crop is the whole frame
  // and has nowhere to go. Nothing to follow — and no two-up, which on
  // setAspect's 9:16 → 16:9 → 9:16 round trip (§4.7) would stack two
  // full-width halves on a 16:9 canvas.
  if ((axis === 'x' ? W : H) - baseLen < 2) {
    return {
      axis,
      size: base,
      half: { width: base.width, height: evenDown(base.height / 2) },
      shots: track.shots.map((s) => ({ startMs: s.startMs, endMs: s.endMs, at: 0, pans: [], why: 'centre' })),
      notes: ['the clip already has the canvas’s shape: nothing to follow']
    }
  }

  const samples = [...track.samples].sort((a, b) => a.ms - b.ms)
  const period = samplePeriod(samples)
  const pace: Pace = { headMs: HEAD_MS, reachMs: Math.max(PATH_RULES.smoothMs / 2, 1.5 * period) }
  const allowTwoUp = axis === 'x' && follow?.twoUp !== false
  const notes: string[] = []

  // Rules 2–3 first, for every shot: whether any shot is a two-up decides the
  // clip's size, and the size decides every position.
  const shots = track.shots.map((shot, i) => {
    const own = samples.filter((s) => s.ms >= shot.startMs && s.ms < shot.endMs)
    return { shot, i, own, ...classify(own, i, axis, baseLen, allowTwoUp, W, H) }
  })
  const stacked = shots.some((s) => s.why === 'two-up')

  // A two-up clip's height is a multiple of 4, so its two halves are even and
  // add up to it exactly (§4.7: the stack reassembles the one crop bit for bit).
  const size = stacked ? { width: base.width, height: Math.max(4, Math.floor(base.height / 4) * 4) } : base
  const half = { width: size.width, height: stacked ? size.height / 2 : evenDown(size.height / 2) }

  const rail: Rail =
    axis === 'x'
      ? { axis, len: size.width, room: W - size.width, anchor: 0.5 }
      : { axis, len: size.height, room: H - size.height, anchor: UPPER_THIRD }

  const out: ShotCrop[] = shots.map(({ shot, i, own, why, note }) => {
    if (note) notes.push(note)
    const n = i + 1
    const rung = ladder(track.perShot[i], rail, W, H)

    if (why === 'two-up') {
      const crop = twoUp(own, shot, half, W, H, pace, follow?.halfOffsets?.[shot.startMs])
      return { startMs: shot.startMs, endMs: shot.endMs, at: crop.top.x, pans: crop.top.pans.map((p) => ({ ...p })), why, halves: crop }
    }

    let solved: { at: number; pans: Pan[]; why: ShotWhy }
    if (why === 'ladder') {
      solved = { at: rung.at, pans: [], why: rung.why }
      if (rung.why === 'centre') notes.push(`shot ${n}: no face or subject to follow, centred`)
    } else {
      const f = followSubject(subjectMarks(own, why, W, H), shot, rail, pace, rung.at)
      if (f.opened) solved = { at: f.at, pans: f.pans, why }
      else {
        // Rule 6: no face in the opening second — the ladder holds the shot
        // until the face, once it shows, earns a pan by rule 5.
        solved = { at: f.at, pans: f.pans, why: rung.why }
        notes.push(`shot ${n}: no face in its first second, starts ${rung.label}`)
      }
    }

    // Rule 8: the user's drag, a share of the crop, added after the solve.
    const share = follow?.offsets?.[shot.startMs]
    const moved = typeof share === 'number' && Number.isFinite(share) ? shift(solved, share * rail.len, rail.room) : solved
    return { startMs: shot.startMs, endMs: shot.endMs, at: moved.at, pans: moved.pans, why: solved.why }
  })

  return { axis, size, half, shots: out, notes }
}

/**
 * Rule 1's size: `fitRect`'s full height (or width) at the target aspect,
 * through `safeCrop` — even, never a pixel past the source. The same shape as
 * the source has nothing to cut, and safeCrop says so with null: the whole
 * frame, evened.
 */
function clipSize(source: Size, target: Size): Size {
  const rect = fitRect(source.width / 2, source.height / 2, source.height, target.width / target.height, source)
  const safe = safeCrop(rect, source)
  return safe ? { width: safe.width, height: safe.height } : { width: evenDown(source.width), height: evenDown(source.height) }
}

/**
 * Rule 7: a position as the export will use it — an even integer (the crop's
 * x snaps to even on 4:2:0, so the preview must too) inside [0, room].
 */
function place(raw: number, room: number): number {
  const top = Math.max(0, Math.floor(room / 2) * 2)
  return Math.min(top, Math.max(0, Math.round(raw / 2) * 2))
}

type Kind = 'face' | 'both' | 'two-up' | 'larger' | 'ladder'

/** Rules 2 and 3: what the shot frames. */
function classify(
  own: SubjectSample[],
  i: number,
  axis: 'x' | 'y',
  len: number,
  allowTwoUp: boolean,
  W: number,
  H: number
): { why: Kind; note?: string } {
  const n = own.length
  const one = own.filter((s) => s.faces.length >= 1).length
  const two = own.filter((s) => s.faces.length >= 2).length
  if (n === 0 || one < FACE_SHARE * n) return { why: 'ladder' }
  const shot = `shot ${i + 1}`

  if (two >= PATH_RULES.bothShare * n) {
    // Does their union, plus the margin, fit inside the crop? Judged on the
    // median union, so one stray box does not split a two-shot.
    const margin = PATH_RULES.marginShare * len
    const spans = own
      .filter((s) => s.faces.length >= 2)
      .map((s) => {
        const u = union(toBox(s.faces[0], W, H), toBox(s.faces[1], W, H))
        return axis === 'x' ? u.x1 - u.x0 : u.y1 - u.y0
      })
    if (median(spans) + 2 * margin <= len) return { why: 'both' }
    if (allowTwoUp) return { why: 'two-up', note: `${shot}: two people too far apart, stacked` }
    return {
      why: 'larger',
      note:
        axis === 'x'
          ? `${shot}: two people too far apart, framing the larger (Stack two people is off)`
          : `${shot}: two people too far apart for this shape, framing the larger`
    }
  }
  if (two >= FACE_SHARE * n) return { why: 'larger', note: `${shot}: one face lost, framing the larger` }
  return { why: 'face' }
}

/** The subject each sample holds, for a shot that follows a face, a two-shot or the larger face. */
function subjectMarks(own: SubjectSample[], why: Kind, W: number, H: number): Mark[] {
  if (why === 'face') return onePerson(own, W, H)
  if (why === 'both') {
    // A one-face sample of a two-shot is someone turning away: it holds.
    return own
      .filter((s) => s.faces.length >= 2)
      .map((s) => ({ ms: s.ms, box: union(toBox(s.faces[0], W, H), toBox(s.faces[1], W, H)) }))
  }
  // 'larger': the person whose face has the larger median area, kept by side
  // across samples, so a sample showing only the other one holds instead of
  // jumping to them.
  const { left, right } = bySide(own, W, H)
  const areaOf = (side: Mark[]): number => (side.length ? median(side.map((m) => area(m.box))) : -1)
  return areaOf(right) > areaOf(left) ? right : left
}

/**
 * A 'face' shot's one person, followed by identity rather than by size. A
 * second face here is on under FACE_SHARE of the samples (rule 2's stray),
 * and a passer-by nearer the lens is the LARGER face: following faces[0], a
 * larger passer-by on three samples of an 8 s shot pulled the crop off its
 * subject for the rest of the shot (measured). So a sample with two takes the
 * one nearer the face last followed, starting from the first sample that
 * holds only one — a 'face' shot always has one, since fewer of its samples
 * hold two than hold any.
 */
function onePerson(own: SubjectSample[], W: number, H: number): Mark[] {
  const alone = own.find((s) => s.faces.length === 1)
  let last: Box | null = alone ? toBox(alone.faces[0], W, H) : null
  const marks: Mark[] = []
  for (const s of own) {
    if (s.faces.length === 0) continue
    const boxes = s.faces.map((f) => toBox(f, W, H))
    const prev = last
    const box = prev === null ? boxes[0] : boxes.reduce((a, b) => (gap(b, prev) < gap(a, prev) ? b : a))
    marks.push({ ms: s.ms, box })
    last = box
  }
  return marks
}

/** How far apart two boxes' centres are. */
function gap(a: Box, b: Box): number {
  return Math.hypot(cx(a) - cx(b), cy(a) - cy(b))
}

/**
 * The two people of a shot, by SIDE: `left` is the face further left in the
 * source (rule 3 puts it on top). A sample with both orders them by x; a
 * sample with one gives it to the side whose usual place it is nearer.
 */
function bySide(own: SubjectSample[], W: number, H: number): { left: Mark[]; right: Mark[] } {
  const pairs = own.map((s) => (s.faces.length >= 2 ? sides(toBox(s.faces[0], W, H), toBox(s.faces[1], W, H)) : null))
  const both = pairs.filter((p): p is [Box, Box] => p !== null)
  const usual = (k: 0 | 1): { x: number; y: number } => ({
    x: median(both.map((p) => cx(p[k]))),
    y: median(both.map((p) => cy(p[k])))
  })
  const refL = usual(0)
  const refR = usual(1)
  const left: Mark[] = []
  const right: Mark[] = []
  own.forEach((s, j) => {
    const pair = pairs[j]
    if (pair) {
      left.push({ ms: s.ms, box: pair[0] })
      right.push({ ms: s.ms, box: pair[1] })
    } else if (s.faces.length === 1) {
      const b = toBox(s.faces[0], W, H)
      const dl = Math.hypot(cx(b) - refL.x, cy(b) - refL.y)
      const dr = Math.hypot(cx(b) - refR.x, cy(b) - refR.y)
      ;(dl <= dr ? left : right).push({ ms: s.ms, box: b })
    }
  })
  return { left, right }
}

/** Two faces ordered by side, left first — never by size. */
function sides(a: Box, b: Box): [Box, Box] {
  return cx(a) <= cx(b) ? [a, b] : [b, a]
}

/**
 * Rules 4–6 for one subject on one rail.
 *
 * The held position centres (or, on y, upper-thirds) the smoothed subject over
 * the opening second; with no subject there it is `fallback`, the ladder's
 * (`opened` false). Then: no pan at all when the margin-widened box stays in
 * the held crop on ≥ staticShare of the samples; otherwise a pan whenever the
 * smoothed centre has stayed outside the dead zone for triggerMs — never in
 * the head, never within minHoldMs of the last move's end, and never one that
 * cannot finish inside its shot. A sample without the subject holds.
 */
function followSubject(
  marks: Mark[],
  shot: Shot,
  rail: Rail,
  pace: Pace,
  fallback: number
): { at: number; pans: Pan[]; opened: boolean } {
  const { len, room, anchor } = rail
  const lo = (b: Box): number => (rail.axis === 'x' ? b.x0 : b.y0)
  const hi = (b: Box): number => (rail.axis === 'x' ? b.x1 : b.y1)
  const centres = marks.map((m) => (lo(m.box) + hi(m.box)) / 2)

  // A running median, centred (marks are in ms order), over smoothMs and
  // never fewer than three of the track's samples: ±1.5 of its spacing. At
  // the plan's 2 a second, smoothMs alone held the sample itself, and a pan
  // fired on a stray box aimed at it (measured: 216 px past the face, then a
  // second pan back); three samples' median drops one stray, and the pan
  // aims where the face is.
  const reach = pace.reachMs
  const smooth: number[] = []
  for (let j = 0, a = 0, b = 0; j < marks.length; j++) {
    while (marks[a].ms < marks[j].ms - reach) a++
    while (b < marks.length && marks[b].ms <= marks[j].ms + reach) b++
    smooth.push(median(centres.slice(a, b)))
  }

  const opening = smooth.filter((_, j) => marks[j].ms < shot.startMs + OPENING_MS)
  const opened = opening.length > 0
  const at = opened ? place(median(opening) - anchor * len, room) : fallback
  if (marks.length === 0) return { at, pans: [], opened }

  // Rule 4: static first.
  const margin = PATH_RULES.marginShare * len
  const inside = marks.filter((m) => lo(m.box) - margin >= at && hi(m.box) + margin <= at + len).length
  if (inside >= PATH_RULES.staticShare * marks.length) return { at, pans: [], opened }

  // Rule 5: a pan only when the subject leaves.
  const zone = (PATH_RULES.deadZone * len) / 2
  const pans: Pan[] = []
  let pos = at
  let since: number | null = null
  let free = -Infinity
  marks.forEach((m, j) => {
    const c = smooth[j]
    if (Math.abs(c - (pos + anchor * len)) <= zone) {
      since = null
      return
    }
    if (m.ms < shot.startMs + pace.headMs) return
    if (since === null) since = m.ms
    if (m.ms - since < PATH_RULES.triggerMs || m.ms < free) return
    const to = place(c - anchor * len, room)
    if (to === pos) return
    const toMs = m.ms + Math.max(PATH_RULES.panMs, Math.ceil((1000 * Math.abs(to - pos)) / (len * PATH_RULES.maxSpeed)))
    if (toMs >= shot.endMs) return
    pans.push({ fromMs: m.ms, toMs, to })
    pos = to
    since = null
    free = toMs + PATH_RULES.minHoldMs
  })
  return { at, pans, opened }
}

/**
 * Rule 3's stacked two-up: one half per face, the face further left on top.
 * Each centres its face on x — held, panning by rule 5 for its own face — and
 * holds the face's centre twoUpFaceY down the half for the whole shot. A face
 * missing from the opening second is placed by its median over the shot (a
 * half has no ladder to fall to).
 */
function twoUp(
  own: SubjectSample[],
  shot: Shot,
  half: Size,
  W: number,
  H: number,
  pace: Pace,
  offsets: HalfOffsets | undefined
): { top: HalfCrop; bottom: HalfCrop } {
  const { left, right } = bySide(own, W, H)
  const rail: Rail = { axis: 'x', len: half.width, room: W - half.width, anchor: 0.5 }
  const yRoom = H - half.height
  const solveHalf = (marks: Mark[], off: { x: number; y: number } | undefined): HalfCrop => {
    const all = marks.map((m) => cx(m.box))
    const fallback = all.length ? place(median(all) - half.width / 2, rail.room) : place(rail.room / 2, rail.room)
    const f = followSubject(marks, shot, rail, pace, fallback)
    const opening = marks.filter((m) => m.ms < shot.startMs + OPENING_MS)
    const ys = (opening.length ? opening : marks).map((m) => cy(m.box))
    const y = ys.length ? place(median(ys) - PATH_RULES.twoUpFaceY * half.height, yRoom) : place(yRoom / 2, yRoom)
    if (!off || !Number.isFinite(off.x) || !Number.isFinite(off.y)) return { x: f.at, y, pans: f.pans }
    const moved = shift(f, off.x * half.width, rail.room)
    return { x: moved.at, y: place(y + off.y * half.height, yRoom), pans: moved.pans }
  }
  return { top: solveHalf(left, offsets?.top), bottom: solveHalf(right, offsets?.bottom) }
}

/**
 * Rule 2's ladder for a shot the faces do not lead: a named subject Florence
 * found, then the salient box, then the centre (`solveCrop`'s position).
 */
function ladder(
  per: SubjectTrack['perShot'][number] | undefined,
  rail: Rail,
  W: number,
  H: number
): { at: number; why: 'ground' | 'salient' | 'centre'; label: string } {
  const centreOf = (b: UnitRect): number => (rail.axis === 'x' ? (b.x + b.width / 2) * W : (b.y + b.height / 2) * H)
  if (per?.ground) return { at: place(centreOf(per.ground.box) - rail.len / 2, rail.room), why: 'ground', label: `on "${per.ground.phrase}"` }
  if (per?.salient) return { at: place(centreOf(per.salient.box) - rail.len / 2, rail.room), why: 'salient', label: 'on the salient subject' }
  return { at: place(rail.room / 2, rail.room), why: 'centre', label: 'centred' }
}

/** Rule 8: a hand correction added after the solve, every position re-clamped; a pan it flattens goes. */
function shift(f: { at: number; pans: Pan[] }, by: number, room: number): { at: number; pans: Pan[] } {
  const at = place(f.at + by, room)
  const pans: Pan[] = []
  let prev = at
  for (const p of f.pans) {
    const to = place(p.to + by, room)
    if (to === prev) continue
    pans.push({ fromMs: p.fromMs, toMs: p.toMs, to })
    prev = to
  }
  return { at, pans }
}

/** The track's own cadence: the median spacing of its samples. */
function samplePeriod(samples: SubjectSample[]): number {
  const gaps: number[] = []
  for (let j = 1; j < samples.length; j++) {
    const d = samples[j].ms - samples[j - 1].ms
    if (d > 0) gaps.push(d)
  }
  return gaps.length ? median(gaps) : DEFAULT_SAMPLE_MS
}

function toBox(b: UnitRect, W: number, H: number): Box {
  return { x0: b.x * W, y0: b.y * H, x1: (b.x + b.width) * W, y1: (b.y + b.height) * H }
}

function union(a: Box, b: Box): Box {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }
}

const cx = (b: Box): number => (b.x0 + b.x1) / 2
const cy = (b: Box): number => (b.y0 + b.y1) / 2
const area = (b: Box): number => (b.x1 - b.x0) * (b.y1 - b.y0)

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
