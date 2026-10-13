import { cropPath, type CropPath, type Pan, type ShotCrop, type ShotWhy } from './path'
import { SUBJECT_TRACK_VERSION, type SubjectTrack } from './types'
import { exportPixel, flatSumAt, smoothstep, type FlatSum, type Term } from './expression'
import { clipRamp, clipSpeed, isNormalSpeed, rampRate } from '../render/speed'
import type { Clip, CropRect, Project } from '../timeline'

/**
 * The followed crop's keys — a clip's crop path put on the clip's own frames
 * (docs/CLIPS.md §4.7, step 1f).
 *
 * **Compiled, never stored.** Stored crop keys go stale under ordinary edits:
 * `withClipSpeed` and a ramp edit never touch keyframes, and
 * `convertFrameRate` rounds every stored key. So the keys are derived every
 * time they are read, from facts that do not go stale — the file's
 * `Project.subjects[assetId]` (source ms), the clip's `follow`, and its
 * current in-point, length, speed and ramp — and a speed change, a ramp, a
 * frame-rate change, a head trim or a split is right by construction.
 *
 * **Each cut's held key is on the EXPORT's frame for it** — the measure
 * phase's contract for this slice, measured on the Mac's 4.4 build:
 *
 * - The render puts the followed clock ahead of the crop at every speed
 *   (plan.ts `followClock`: `fps=${fps}:start_time=0`, §3.4's remedy), and
 *   `fps=` shows on output slot n the last source frame whose time rounds
 *   (half up, NEAR_INF) to n. So the cut's frame is `floor(t·fps + 0.5)`, t
 *   its time after the in-point's seek — with fps= first, on every cut of
 *   every source measured: 44 of 44 at 30 and 29.97 fps (43 of 43 with a tie
 *   added), 39 and 45 of 45 at 60, 44 of 44 on both VFR sources, and with an
 *   in-point of 7.
 * - **Clip frame k is slot k**, at t = k/fps, because of the clock's
 *   `start_time=0`. Without it `fps=` starts at the slot the first frame
 *   after the seek rounds to — slot 1 when that frame is half a slot or more
 *   past the seek (VFR at in-point 1; 29.97 footage past 16.7 s about half
 *   the time; 24 fps at three in-points of five) — and the clip's
 *   `setpts=PTS-STARTPTS` made clip frame k slot k + 1: every frame here,
 *   and `followAt`/`cropAt`, one frame early against the export (measured,
 *   reframe.int's p0 rows; the export itself stayed self-consistent).
 * - At another constant speed the retime's `setpts=PTS/s` truncates (pts
 *   1001/2 → 500), then its own `fps=` rounds the same way: the frame is
 *   `floor(trunc(pts/s)·fps/den + 0.5)` — every cut measured at 2× and 0.5×.
 * - `timelineFrameAt` is NOT that frame. It inverts the preview's
 *   `sourceFrameFor`, which rounds the source position half up, while the
 *   export at 0.5× shows source frame floor(n/2): it is one frame early on
 *   every cut at 0.5× (two at 60 fps). On the shot finder's printed time it
 *   was early on 15 of 44 cuts at 30 fps, 20 of 44 at 29.97, and 21 of 44 on
 *   VFR, even at speed 1, because it floors the time to a source frame.
 * - A ramp's frame is its own `setpts` (speed.ts `rampVideoFilter`, its
 *   constants at the 4 dp it writes them) on the SEEK's clock: a followed
 *   clip's ramp is written with `T`, not `T-STARTT` (plan.ts
 *   `followedRetime`), because STARTT is the first frame kept after the
 *   seek, up to a source frame past the in-point, and from it every cut
 *   moved — 721 of 721 cuts off on a VFR file at in-point 7, by up to 5
 *   frames over four ramps. On `T`, 0 off on VFR, 29.97, 30 and 60 fps
 *   sources, ramps 1→0.5, 0.5→2, 2→1 and 0.25→4, at in-points 0 and 7.
 *
 * **The shot finder's time is not exact.** `Shot.startMs` is ffmpeg's
 * `pts_time` printed `%.6g`: frame 500 of a 29.97 file prints 16.6833, and
 * its exact slot at 30 fps (t·30 = 500.5, a tie) needs the integer pts the
 * same line carries (`pts:500500`). `exportFrameAt` takes that exact time
 * when it is given; until 1b keeps `Shot.startPts` and the track's time base
 * (a follow-up outside this slice's files), it rounds the printed time, and
 * a printed time within its own print precision of a tie is taken as the tie
 * (`TIE_SLACK`). Measured by arithmetic over every frame of 30-minute files
 * at 24/25/30/60 fps projects, 1×/2×/0.5×, sources at 23.976–60 fps and an
 * iPhone-style VFR (tb 1/600): wrong on 0 % of frames under 10 s (plain
 * rounding: 1.39 %), 0.07 % in 10–100 s (1.43 %), 0.73 % in 100–1000 s
 * (1.86 %), and the same as plain rounding past that, where the print keeps
 * too few digits for either. A 60 fps source's odd frames on a 30 fps
 * project, and every odd cut of a same-rate clip at 2×, are exact ties, and
 * plain rounding of the printed time gets about half of them a frame early.
 *
 * Pans go on the frame grid the same way: each pan's start and end are the
 * export's frames for its source ms, so a pan can never still be easing on
 * the next cut's frame (its end is clamped to that frame as well, in case).
 */

/* ------------------------------------------------------------- positions */

export interface FollowPosition {
  x: number
  y: number
  /** On a two-up shot: each half's top-left, `half`-sized. */
  halves?: { top: { x: number; y: number }; bottom: { x: number; y: number } }
}

/**
 * Where the path is at a SOURCE time: the shot holding `sourceMs`, its held
 * position and its pans, eased by smoothstep and rounded as the export's crop
 * rounds (`exportPixel`, lrint & ~1). The fixed axis is 0.
 *
 * This is the path's own clock. The export runs the same curve on the clip's
 * frame grid (`followKeys`), and reads it at its frames — `followAt` is that
 * reader, the one the preview takes so the two cannot disagree; the two
 * agree on every frame where the path's cuts and pans fall on frames.
 */
export function positionAt(path: CropPath, sourceMs: number): FollowPosition {
  const shot = shotAt(path, sourceMs)
  if (!shot) return { x: 0, y: 0 }
  const v = exportPixel(along(shot.at, shot.pans, sourceMs))
  const position: FollowPosition = { x: path.axis === 'x' ? v : 0, y: path.axis === 'y' ? v : 0 }
  if (shot.halves) {
    const { top, bottom } = shot.halves
    position.halves = {
      top: { x: exportPixel(along(top.x, top.pans, sourceMs)), y: top.y },
      bottom: { x: exportPixel(along(bottom.x, bottom.pans, sourceMs)), y: bottom.y }
    }
  }
  return position
}

/**
 * The shot holding `ms` — shots tile [0, duration). A cut's `startMs` is its
 * frame's time as ffmpeg printed it (`%.6g`), so a frame's own time is in the
 * shot that starts within the print's precision of it: frame 95 at 30 fps is
 * 3166.666… ms, and its cut prints 3166.67.
 */
function shotAt(path: CropPath, ms: number): ShotCrop | undefined {
  let found = path.shots[0]
  for (const shot of path.shots) {
    if (shot.startMs <= ms + printSlack(shot.startMs) * 1000) found = shot
    else break
  }
  return found
}

/** A held position and its sequential pans, at `ms`. */
function along(at: number, pans: Pan[], ms: number): number {
  let v = at
  for (const pan of pans) {
    if (ms <= pan.fromMs) break
    if (ms >= pan.toMs) {
      v = pan.to
      continue
    }
    return v + (pan.to - v) * smoothstep((ms - pan.fromMs) / (pan.toMs - pan.fromMs))
  }
  return v
}

/* ------------------------------------------------- source ms → clip frame */

/** What the export's frame for a moment depends on. */
export type RetimedClip = Pick<Clip, 'inPoint' | 'duration' | 'speed' | 'ramp' | 'hold'>

/** A frame's exact time: its integer pts in the stream's time base, as the scene pass's `metadata=print` line carries it. */
export interface ExactTime {
  pts: number
  timeBase: { num: number; den: number }
}

/**
 * How near a printed time may be to a tie and still be taken as one, in
 * output frames: beyond this the print keeps too few digits to tell, and the
 * time is rounded as printed (see the module note; measured by arithmetic).
 */
export const TIE_SLACK = 0.05

/** A number as a filter graph writes it (speed.ts `n`): 4 dp. */
const graphNumber = (v: number): number => Number(v.toFixed(4))

/**
 * The export's retime: clip-relative SOURCE seconds → clip-relative OUTPUT
 * seconds, as the chain's `setpts` computes them, and the most it stretches
 * time (for the slack). Identity at speed 1; null for a hold, which shows one
 * frame and has no map.
 */
function retimeOf(clip: RetimedClip, fps: number): { at: (tau: number) => number; stretch: number; divisor: number | null } | null {
  if (clip.hold) return null
  const ramp = clipRamp(clip)
  if (ramp) {
    const k = ramp.to - ramp.from
    if (Math.abs(k) >= 1e-9) {
      // followedRetime: setpts='(D/k)*log((from+k*T/D)/from)/TB', D the footage it plays and T seek-relative.
      const D = (clip.duration * rampRate(ramp.from, ramp.to)) / fps
      const scale = graphNumber(D / k)
      const from = graphNumber(ramp.from)
      const kk = graphNumber(k)
      const d = graphNumber(D)
      return { at: (tau) => scale * Math.log((from + (kk * tau) / d) / from), stretch: 1 / Math.min(ramp.from, ramp.to), divisor: null }
    }
    // A flat ramp is a constant speed (rampVideoFilter → speedVideoFilter).
    if (Math.abs(ramp.from - 1) < 0.001) return { at: (tau) => tau, stretch: 1, divisor: 1 }
    const s = graphNumber(ramp.from)
    return { at: (tau) => tau / s, stretch: 1 / s, divisor: s }
  }
  if (isNormalSpeed(clip)) return { at: (tau) => tau, stretch: 1, divisor: 1 }
  const s = graphNumber(clipSpeed(clip))
  return { at: (tau) => tau / s, stretch: 1 / s, divisor: s }
}

/** How far ffmpeg's `%.6g` print of a time (and `msOf`'s µs, and the seek's 6 dp) can be from the frame's own, in seconds. */
function printSlack(sourceMs: number): number {
  const s = Math.abs(sourceMs) / 1000
  const half = s > 0 ? 0.5 * Math.pow(10, Math.floor(Math.log10(s)) - 5) : 0
  return half + 1e-6
}

/**
 * The clip-relative frame on which the export shows the source moment
 * `sourceMs` (or `exact`, its integer pts) first — the frame a cut's held key
 * goes on: its `fps=` slot after the seek, which is the clip's frame because
 * the followed clock starts at slot 0 (plan.ts `followClock`). Before the
 * clip's first frame it is ≤ 0; past its last it is ≥ `duration`. Null for a
 * hold.
 */
export function exportFrameAt(clip: RetimedClip, fps: number, sourceMs: number, exact?: ExactTime): number | null {
  const retime = retimeOf(clip, fps)
  if (!retime || !(fps > 0)) return null
  if (exact) {
    const { pts, timeBase } = exact
    const { num, den } = timeBase
    // `-ss` writes the in-point to 6 dp (plan.ts `seconds`); ffmpeg holds it
    // in µs and rescales it into the stream's time base, rounding.
    const seekUs = Math.round(Number((clip.inPoint / fps).toFixed(6)) * 1e6)
    const rel = pts - Math.round((seekUs * den) / (num * 1e6))
    // setpts' D2TS truncates (setpts.c:144 at f22fcd4; measured 1001/2 → 500).
    const q =
      retime.divisor === 1
        ? rel
        : retime.divisor !== null
          ? Math.trunc(rel / retime.divisor)
          : Math.trunc((retime.at((rel * num) / den) * den) / num)
    // fps= rescales with NEAR_INF (vf_fps.c:81): floor(q·num·fps/den + ½), in integers.
    return Math.floor((2 * q * num * fps + den) / (2 * den))
  }
  const position = (sourceMs * fps) / 1000 - clip.inPoint
  const out = retime.divisor === 1 ? position : retime.divisor !== null ? position / retime.divisor : retime.at(position / fps) * fps
  const slack = printSlack(sourceMs) * fps * retime.stretch
  return Math.floor(out + 0.5 + (slack <= TIE_SLACK ? slack : 0))
}

/* ------------------------------------------------------------------ keys */

/** One shot as the clip shows it: frames [from, to) of the clip. */
export interface FollowShot {
  /** Its index in the track's (and the path's) shots — what a drag's offset belongs to. */
  index: number
  /** The shot's start as the track writes it: `follow.offsets` and `halfOffsets` are keyed by this. */
  startMs: number
  from: number
  to: number
  why: ShotWhy
}

/** A two-up clip's two crops, each keyed on x and y (§4.7's stack). */
export interface FollowHalves {
  top: { x: FlatSum; y: FlatSum }
  bottom: { x: FlatSum; y: FlatSum }
}

export interface FollowKeys {
  /**
   * The rectangle a consumer that knows nothing of following uses, and the
   * one `setAspect` stores: the path's one size, at the position on the
   * clip's first frame (on a two-up clip, the top half's x at the full size).
   * With no keys below, it IS the crop.
   */
  crop: CropRect
  /** The free axis's position, SOURCE px, when it moves. On a two-up clip it is the top half's x. */
  cropX?: FlatSum
  cropY?: FlatSum
  /** Present when a two-up shot is on screen in this clip: every shot of the clip keys both halves. */
  halves?: FollowHalves
  axis: 'x' | 'y'
  /** The clip's one crop size, and each half's on a two-up clip. */
  size: { width: number; height: number }
  half: { width: number; height: number }
  /** The file's size — the export clamps each crop to `in_w − out_w`. */
  source: { width: number; height: number }
  /** The rate the keys were compiled at, which `followAt` reads them at. */
  fps: number
  /** The shots the clip shows, in order. */
  shots: FollowShot[]
  notes: string[]
}

/** Does the export need the keyed crop (and its `fps=` first) for this clip, or is `crop` all of it? */
export function isKeyed(keys: FollowKeys | null | undefined): keys is FollowKeys {
  return !!keys && !!(keys.cropX || keys.cropY || keys.halves)
}

/** Which value of a shot a key lane follows. */
type Lane = (shot: ShotCrop, path: CropPath) => { at: number; pans: Pan[] }

const MAIN: Lane = (s) => ({ at: s.at, pans: s.pans })
const TOP_X: Lane = (s, path) => (s.halves ? { at: s.halves.top.x, pans: s.halves.top.pans } : MAIN(s, path))
const TOP_Y: Lane = (s) => ({ at: s.halves ? s.halves.top.y : 0, pans: [] })
/** A single shot on a two-up clip keys the bottom half at (x, half.height): the two halves are then the one crop, exactly. */
const BOTTOM_X: Lane = (s, path) => (s.halves ? { at: s.halves.bottom.x, pans: s.halves.bottom.pans } : MAIN(s, path))
const BOTTOM_Y: Lane = (s, path) => ({ at: s.halves ? s.halves.bottom.y : path.half.height, pans: [] })

/** Memoised per track object (a re-analysis is a new one), then on everything else the keys read. */
const memo = new WeakMap<SubjectTrack, Map<string, FollowKeys | null>>()
const MEMO_PER_TRACK = 64

/**
 * The followed crop of `clip`, compiled at `fps` — or null when the clip does
 * not follow: no `follow`, not a video, no track for its file, a track of
 * another version, or a track whose size is not the asset's (§3.1: a track
 * measured on the coded frame of a rotated phone clip would aim every crop at
 * the wrong place).
 *
 * Pure, and memoised on the track, its key and version, `follow`, the
 * in-point, length, speed, ramp and hold, `fps`, the canvas and the asset's
 * size. The result is shared: do not change it.
 */
export function followKeys(project: Project, clip: Clip, fps: number): FollowKeys | null {
  if (!clip.follow || !(fps > 0) || !Number.isFinite(fps)) return null
  const asset = project.assets.find((a) => a.id === clip.assetId)
  if (!asset || asset.kind !== 'video') return null
  const track = project.subjects?.[clip.assetId]
  if (!track || track.version !== SUBJECT_TRACK_VERSION) return null
  if (asset.width !== track.width || asset.height !== track.height) return null
  const target = { width: project.settings.width, height: project.settings.height }

  const key = JSON.stringify([
    track.key,
    track.version,
    clip.follow,
    clip.inPoint,
    clip.duration,
    clipSpeed(clip),
    clipRamp(clip),
    clip.hold === true,
    clip.smoothSlow === true,
    fps,
    target.width,
    target.height,
    asset.width,
    asset.height
  ])
  let byKey = memo.get(track)
  if (!byKey) {
    byKey = new Map()
    memo.set(track, byKey)
  }
  if (byKey.has(key)) return byKey.get(key)!
  const keys = compile(track, clip, fps, target)
  if (byKey.size >= MEMO_PER_TRACK) byKey.delete(byKey.keys().next().value!)
  byKey.set(key, keys)
  return keys
}

function compile(track: SubjectTrack, clip: Clip, fps: number, target: { width: number; height: number }): FollowKeys | null {
  const follow = clip.follow!
  const path = cropPath(track, target, { offsets: follow.offsets, halfOffsets: follow.halfOffsets, twoUp: follow.twoUp })
  if (path.shots.length === 0 || !(path.size.width > 0 && path.size.height > 0)) return null
  const source = { width: track.width, height: track.height }
  const room = { x: source.width - path.size.width, y: source.height - path.size.height }
  const frame = { axis: path.axis, size: path.size, half: path.half, source, fps }
  // The canvas of the source's own shape needs no branch here: the path
  // gives every shot 'centre' at 0 with no pans (path.ts) and its note, so
  // nothing below differs from shot to shot and no key is written.
  const notes = [...path.notes]

  // A hold shows one frame for its whole length: it does not follow. Its
  // crop is held where the path is on that frame — freezeFrame's hold keeps
  // `follow`, and the stored crop is the clip's first frame's, not the frame
  // it froze.
  if (clip.hold) {
    const asIfPlaying = { ...clip, hold: undefined, speed: undefined, ramp: undefined }
    let index = 0
    path.shots.forEach((s, i) => {
      if (i > 0 && (exportFrameAt(asIfPlaying, fps, s.startMs) ?? 1) <= 0) index = i
    })
    const shot = path.shots[index]
    const at = positionAt(path, Math.max((clip.inPoint * 1000) / fps, shot.startMs))
    notes.push('a held frame does not follow: its crop stays where the subject is on that frame')
    const held: FollowKeys = {
      ...frame,
      crop: { x: at.x, y: at.y, ...path.size },
      shots: [{ index, startMs: shot.startMs, from: 0, to: clip.duration, why: shot.why }],
      notes
    }
    if (at.halves) {
      const still = (v: number): FlatSum => ({ base: v, terms: [] })
      held.halves = {
        top: { x: still(at.halves.top.x), y: still(at.halves.top.y) },
        bottom: { x: still(at.halves.bottom.x), y: still(at.halves.bottom.y) }
      }
    }
    return held
  }

  if (clip.smoothSlow && clipSpeed(clip) < 1) notes.push('a smooth slow clip’s cut frames are interpolated: unmeasured')

  // Each shot's frames on the clip: [its cut's frame, the next cut's frame).
  const D = clip.duration
  const slots = path.shots.map((s, i) => (i === 0 ? -Infinity : (exportFrameAt(clip, fps, s.startMs) as number)))
  const visible: FollowShot[] = []
  path.shots.forEach((s, i) => {
    const from = Math.max(0, slots[i])
    const to = Math.min(D, i + 1 < slots.length ? slots[i + 1] : Infinity)
    if (from < to) visible.push({ index: i, startMs: s.startMs, from, to, why: s.why })
  })

  const lane = (of: Lane): FlatSum => {
    let base = 0
    let value = 0
    const terms: Term[] = []
    visible.forEach((v, k) => {
      const { at, pans } = of(path.shots[v.index], path)
      if (k === 0) {
        base = at
        value = at
      } else {
        // The cut: held from its own frame on (§45's half-frame boundary).
        if (at !== value) terms.push({ atFrame: v.from, delta: at - value })
        value = at
      }
      const nextCut = v.index + 1 < slots.length ? slots[v.index + 1] : Infinity
      for (const pan of pans) {
        const a = exportFrameAt(clip, fps, pan.fromMs) as number
        // Never still easing on the next cut's frame: the cut's step must win.
        const b = Math.min(exportFrameAt(clip, fps, pan.toMs) as number, nextCut)
        // Starts on or after the shot's last frame here: none of it is seen.
        if (a >= v.to) break
        if (b <= 0) {
          // Over by the clip's first frame: where it ended is where the clip starts.
          value = pan.to
          base = value
          continue
        }
        if (pan.to === value) continue
        // A pan inside one frame of the grid is a step on that frame.
        terms.push(b > a ? { fromFrame: a, toFrame: b, delta: pan.to - value } : { atFrame: a, delta: pan.to - value })
        value = pan.to
      }
    })
    return { base, terms }
  }

  const main = lane(MAIN)
  const keys: FollowKeys = { ...frame, crop: { x: 0, y: 0, ...path.size }, shots: visible, notes }
  if (main.terms.length > 0) keys[path.axis === 'x' ? 'cropX' : 'cropY'] = main
  if (visible.some((v) => path.shots[v.index].halves)) {
    keys.halves = {
      top: { x: lane(TOP_X), y: lane(TOP_Y) },
      bottom: { x: lane(BOTTOM_X), y: lane(BOTTOM_Y) }
    }
  }
  const first = valueOn(main, 0, fps, path.axis === 'x' ? room.x : room.y)
  keys.crop = { x: path.axis === 'x' ? first : 0, y: path.axis === 'y' ? first : 0, ...path.size }
  return keys
}

/** A lane's position on a frame, as the export's crop puts it: the expression's clamp, then lrint & ~1. */
function valueOn(sum: FlatSum, frame: number, fps: number, room: number): number {
  const raw = flatSumAt(sum, frame, { fps, startSeconds: 0 })
  return exportPixel(Math.max(0, Math.min(raw, room)))
}

/**
 * The followed crop on a frame of the clip (clip-relative) — what the export
 * draws there, from the same sums on the same constants. On a two-up clip,
 * `halves` are the two rectangles stacked top over bottom, and `crop` is the
 * top half's position at the full size, for a consumer that can draw only one.
 */
export function followAt(keys: FollowKeys, frame: number): { crop: CropRect; halves?: { top: CropRect; bottom: CropRect } } {
  const { size, half, source, fps } = keys
  const roomX = source.width - size.width
  const roomY = source.height - size.height
  const crop: CropRect = {
    x: keys.cropX ? valueOn(keys.cropX, frame, fps, roomX) : keys.crop.x,
    y: keys.cropY ? valueOn(keys.cropY, frame, fps, roomY) : keys.crop.y,
    width: size.width,
    height: size.height
  }
  if (!keys.halves) return { crop }
  const hx = source.width - half.width
  const hy = source.height - half.height
  const rect = (h: { x: FlatSum; y: FlatSum }): CropRect => ({
    x: valueOn(h.x, frame, fps, hx),
    y: valueOn(h.y, frame, fps, hy),
    width: half.width,
    height: half.height
  })
  return { crop, halves: { top: rect(keys.halves.top), bottom: rect(keys.halves.bottom) } }
}
