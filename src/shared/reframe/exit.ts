import { exportFrameAt, followAt, followKeys, type FollowKeys } from './keys'
import { cropPath, type CropPath, type ShotCrop } from './path'
import { exportPixel } from './expression'
import type { FaceBox, SubjectSample } from './types'
import type { Clip, CropRect, MediaAsset, Project } from '../timeline'
import { followedRetime, videoInputArgs } from '../render/plan'
import { safeTakeBase } from '../render/voiceover'

/**
 * Step 1's exit, read (docs/CLIPS.md §4.10): how well a followed clip's crop
 * keeps the face it was asked to follow, and whether any cut kept the old
 * shot's crop — from the project's own subject tracks and the same keys the
 * export cuts with (`followKeys`, then `followAt` on a clip frame), never a
 * second model of either.
 *
 * Pure and deterministic, no I/O. The frames themselves are pulled and drawn
 * by the gated runner (tests/integration/reframeExit.int.test.ts) through
 * `exitPullArgs` and `exitSheetArgs` below, which are here, pure, so
 * tests/oldestFfmpeg.test.ts can scan them for anything the 2018 build lacks.
 *
 * **What a sample is held to.** Every track sample whose faces hold one (the
 * box four finite numbers with a size, as path.ts reads it) is put on the
 * clip frame the export first shows its moment on (`exportFrameAt`) and read
 * against `followAt` there:
 *
 * - on an ordinary frame, the face the shot follows must lie wholly inside
 *   the crop — a face partly outside is outside. Which face is the shot's
 *   kind (`keys.shots[].why`, path.ts rules 2–3):
 *   - a two-shot (`both`): BOTH people — the two largest faces of a sample,
 *     each inside, so a crop that cuts the second person off is outside (a
 *     sample holding one face holds that one);
 *   - one person (`face`, and a shot the ladder opens — `ground`, `salient`,
 *     `centre` — which follows a face once it shows): the person, by
 *     IDENTITY, not size — on a sample with two, the face nearer the one held
 *     before it, starting from the shot's first sample with one face alone.
 *     That is path.ts's own rule for whom to follow (`onePerson`: a passer-by
 *     nearer the lens is the LARGER face), written out again here so that a
 *     path following the passer-by is read as off its subject, not agreed
 *     with;
 *   - `larger` (two people, one framed): the larger face;
 * - on a stacked two-up frame (`followAt`'s halves, not the one crop a single
 *   shot of a two-up clip keys), the face further left by its centre must lie
 *   inside the TOP half and the other inside the BOTTOM — each its own half,
 *   as path.ts rule 3 stacks them; a sample holding one face there is held to
 *   the half whose centre is nearer it.
 *
 * **Which samples count.** Only those the clip shows: a sample whose frame is
 * before the clip's first or past its last is skipped, and so is one whose
 * shot has no frame in this clip. A sample's shot is the track's shot holding
 * its ms, as path.ts files it. Its label is the frame on screen at that ms
 * (the AI helper's `fps=5:round=up`, EFFECTS.md §54), while `exportFrameAt`
 * rounds a time to the nearest slot, so a label within half a frame before a
 * cut can land on the cut's own frame — the new shot's crop, measured against
 * the old shot's face. Such a sample is held to its own shot's frames.
 *
 * **A crop held across a cut** is a cut (every shot of `keys.shots` after
 * the first, on its `from` frame) where the path moves — the shot's held
 * position (and each half's, on a two-up clip) is not where the shot before
 * it ENDS, its `at` or its last pan's `to` — and yet, on a lane that moves,
 * `followAt` on the cut's frame equals `followAt` on the frame before it: the
 * key did not land. Lane by lane — the crop's free axis, and on a two-up clip
 * each half's x and y — so one half held while the other moves is held: that
 * half shows the old shot's place on the new shot's first frame.
 */

/** §4.10's two bars a reader can measure; the third, ≥ 4 of 5 on ≥ 8 of 10, is the user's rating. */
export const EXIT_BARS = { insideShare: 0.95, heldAcrossCut: 0 } as const

/** One followed clip's reading. */
export interface ExitRow {
  clipId: string
  assetId: string
  /** The shots the clip shows. */
  shots: number
  /** Of them, the stacked two-ups. */
  twoUp: number
  /** Samples on screen in this clip that hold a face. */
  samplesWithFace: number
  /** Of them, the ones whose subject was inside its crop: the followed face, both faces of a two-shot, each face in its own half of a two-up. */
  inside: number
  /** inside / samplesWithFace; null when no sample on screen holds a face. */
  insideShare: number | null
  /** Cuts where the path moves and the export's crop does not. */
  heldAcrossCut: number
  /** The cuts the clip shows: shots − 1. */
  cuts: number
  notes: string[]
}

/** One face as tested: its box and the rectangle it was held to, both in SOURCE px of the upright frame. */
export interface ExitFaceTest {
  face: CropRect
  crop: CropRect
  inside: boolean
}

/** One sample, read: where the clip shows it and what it was held to. */
export interface ExitSample {
  ms: number
  /** The clip frame it was read on. */
  frame: number
  /** The track's shot holding `ms` — its index in the track and the path. */
  shot: number
  /** A stacked two-up frame: each face was held to its own half. */
  twoUp: boolean
  tests: ExitFaceTest[]
  inside: boolean
}

/** One cut, read. */
export interface ExitCut {
  /** The track's index of the shot the cut opens. */
  shot: number
  /** The cut's clip frame: the shot's first. */
  frame: number
  /** The path's position changes here, on at least one lane. */
  moves: boolean
  /** ... and on some lane that changes, the export's crop on `frame` is the one on `frame − 1`. */
  held: boolean
  /** Those lanes: on a two-up clip one half can be held while the other moves. */
  heldLanes: ExitLane[]
}

/** A float's worth of room on a containment test: boxes are 4 dp shares, crops even integers. */
const EPS = 1e-6

/** Four finite numbers and a size: a face path.ts would read (its `usable`). */
function usable(b: FaceBox | null | undefined): b is FaceBox {
  return !!b && [b.x, b.y, b.width, b.height].every((v) => typeof v === 'number' && Number.isFinite(v)) && b.width > 0 && b.height > 0
}

const area = (r: CropRect): number => r.width * r.height
const centreX = (r: CropRect): number => r.x + r.width / 2
const centreY = (r: CropRect): number => r.y + r.height / 2
/** How far apart two boxes' centres are (path.ts `gap`). */
const gap = (a: CropRect, b: CropRect): number => Math.hypot(centreX(a) - centreX(b), centreY(a) - centreY(b))

const largestOf = (faces: CropRect[]): CropRect => faces.reduce((a, b) => (area(b) > area(a) ? b : a))
/** The two largest faces, largest first (one when the sample holds one). */
const largestTwo = (faces: CropRect[]): CropRect[] => [...faces].sort((p, q) => area(q) - area(p)).slice(0, 2)

/**
 * A one-person shot's subject on each of its samples (in ms order), by
 * identity — the module note. path.ts `onePerson`'s rule, on the scorer's own
 * boxes: start from the shot's first sample holding one face alone; on each
 * sample, the face nearest the one held before. A shot with no such sample
 * starts from the largest face.
 */
function onePerson(own: { sample: SubjectSample; faces: CropRect[] }[]): Map<SubjectSample, CropRect> {
  const alone = own.find((s) => s.faces.length === 1)
  let last: CropRect | null = alone ? alone.faces[0] : null
  const out = new Map<SubjectSample, CropRect>()
  for (const { sample, faces } of own) {
    if (faces.length === 0) continue
    const prev = last
    const face = prev === null ? largestOf(faces) : faces.reduce((a, b) => (gap(b, prev) < gap(a, prev) ? b : a))
    out.set(sample, face)
    last = face
  }
  return out
}

function contains(crop: CropRect, face: CropRect): boolean {
  return (
    face.x >= crop.x - EPS &&
    face.y >= crop.y - EPS &&
    face.x + face.width <= crop.x + crop.width + EPS &&
    face.y + face.height <= crop.y + crop.height + EPS
  )
}

/** The path the keys were compiled from — keys.ts `compile`'s own call, on the project's canvas. */
function pathOf(project: Project, clip: Clip): CropPath | null {
  const track = project.subjects?.[clip.assetId]
  if (!track || !clip.follow) return null
  const target = { width: project.settings.width, height: project.settings.height }
  return cropPath(track, target, { offsets: clip.follow.offsets, halfOffsets: clip.follow.halfOffsets, twoUp: clip.follow.twoUp })
}

/** A frame showing a stacked two-up: two halves that are not the one crop (render/crop.ts `cropAt`'s rule). */
function stackedOn(at: ReturnType<typeof followAt>): { top: CropRect; bottom: CropRect } | null {
  if (!at.halves) return null
  const { top, bottom } = at.halves
  const one = top.x === bottom.x && bottom.y === top.y + top.height && top.y === at.crop.y
  return one ? null : at.halves
}

/**
 * Every sample the clip shows that holds a face, read against the export's
 * crop on its frame (the module note). `keys` defaults to the clip's own; a
 * test hands in keys it broke on purpose.
 */
export function exitSamples(project: Project, clip: Clip, fps: number, keys: FollowKeys | null = followKeys(project, clip, fps)): ExitSample[] {
  const track = project.subjects?.[clip.assetId]
  if (!keys || !track || clip.hold) return []
  const W = keys.source.width
  const H = keys.source.height
  const px = (f: FaceBox): CropRect => ({ x: f.x * W, y: f.y * H, width: f.width * W, height: f.height * H })
  const D = clip.duration
  // Each shot's subject on each of its samples, worked out over all of the shot's samples (the clip may show only some).
  const subjects = new Map<number, Map<SubjectSample, CropRect>>()
  const subjectOf = (shot: number, sample: SubjectSample): CropRect | undefined => {
    let byShot = subjects.get(shot)
    if (!byShot) {
      const { startMs, endMs } = track.shots[shot]
      const inShot = track.samples.filter((s) => Number.isFinite(s.ms) && s.ms >= startMs && s.ms < endMs).sort((p, q) => p.ms - q.ms)
      byShot = onePerson(inShot.map((s) => ({ sample: s, faces: (s.faces ?? []).filter(usable).map(px) })))
      subjects.set(shot, byShot)
    }
    return byShot.get(sample)
  }
  const out: ExitSample[] = []
  for (const sample of track.samples) {
    const faces = (sample.faces ?? []).filter(usable).map(px)
    if (faces.length === 0 || !Number.isFinite(sample.ms)) continue
    const at0 = exportFrameAt(clip, fps, sample.ms)
    // Outside the clip: before its first frame or past its last.
    if (at0 === null || at0 < 0 || at0 >= D) continue
    const shot = track.shots.findIndex((s) => sample.ms >= s.startMs && sample.ms < s.endMs)
    const own = keys.shots.find((s) => s.index === shot)
    // Its shot has no frame in this clip: the face is never on screen.
    if (!own) continue
    // Held to its own shot's frames: a label within a frame before a cut rounds onto the cut's.
    const frame = Math.min(Math.max(at0, own.from), own.to - 1)

    const at = followAt(keys, frame)
    const halves = stackedOn(at)
    let tests: ExitFaceTest[]
    if (!halves) {
      const held = own.why === 'both' ? largestTwo(faces) : own.why === 'larger' ? [largestOf(faces)] : [subjectOf(shot, sample) ?? largestOf(faces)]
      tests = held.map((f) => ({ face: f, crop: at.crop, inside: contains(at.crop, f) }))
    } else if (faces.length >= 2) {
      // The two largest, by side: the face further left is the top half's (path.ts rule 3).
      const [a, b] = largestTwo(faces)
      const [left, right] = centreX(a) <= centreX(b) ? [a, b] : [b, a]
      tests = [
        { face: left, crop: halves.top, inside: contains(halves.top, left) },
        { face: right, crop: halves.bottom, inside: contains(halves.bottom, right) }
      ]
    } else {
      // One face on a two-up frame: the half it belongs to, the one whose centre is nearer.
      const f = faces[0]
      const half = Math.abs(centreX(halves.top) - centreX(f)) <= Math.abs(centreX(halves.bottom) - centreX(f)) ? halves.top : halves.bottom
      tests = [{ face: f, crop: half, inside: contains(half, f) }]
    }
    out.push({ ms: sample.ms, frame, shot, twoUp: halves !== null, tests, inside: tests.every((t) => t.inside) })
  }
  return out
}

/** A shot's lanes — the main axis, and each half's x and y as keys.ts keys them — at its first frame or its last. */
interface Lanes {
  main: number
  top: { x: number; y: number }
  bottom: { x: number; y: number }
}

/** The lanes by name, in `Lanes` order: the one crop's free axis, then each half's x and y. */
export type ExitLane = 'crop' | 'top x' | 'top y' | 'bottom x' | 'bottom y'
const LANES: readonly ExitLane[] = ['crop', 'top x', 'top y', 'bottom x', 'bottom y']
const flat = (l: Lanes): number[] => [l.main, l.top.x, l.top.y, l.bottom.x, l.bottom.y]

function lanesOf(shot: ShotCrop, path: CropPath, end: boolean): Lanes {
  const last = (at: number, pans: { to: number }[]): number => (end && pans.length > 0 ? pans[pans.length - 1].to : at)
  const main = last(shot.at, shot.pans)
  if (!shot.halves) return { main, top: { x: main, y: 0 }, bottom: { x: main, y: path.half.height } }
  const { top, bottom } = shot.halves
  return { main, top: { x: last(top.x, top.pans), y: top.y }, bottom: { x: last(bottom.x, bottom.pans), y: bottom.y } }
}

/** `followAt` on a frame, as lanes: the crop's free axis, and each half's position when the clip keys halves. */
function lanesOn(keys: FollowKeys, frame: number): Lanes {
  const at = followAt(keys, frame)
  const main = keys.axis === 'x' ? at.crop.x : at.crop.y
  if (!at.halves) return { main, top: { x: main, y: 0 }, bottom: { x: main, y: keys.half.height } }
  return { main, top: { x: at.halves.top.x, y: at.halves.top.y }, bottom: { x: at.halves.bottom.x, y: at.halves.bottom.y } }
}

/**
 * Every cut the clip shows, with whether the path moves there and whether the
 * export's crop did (the module note). `keys` as for `exitSamples`.
 */
export function exitCuts(project: Project, clip: Clip, fps: number, keys: FollowKeys | null = followKeys(project, clip, fps)): ExitCut[] {
  const path = pathOf(project, clip)
  if (!keys || !path) return []
  const { size, half, source } = keys
  // As followAt clamps and rounds a lane, so a position the path could not reach is compared as the export draws it.
  const pixel = (v: number, room: number): number => exportPixel(Math.max(0, Math.min(v, room)))
  const roomMain = keys.axis === 'x' ? source.width - size.width : source.height - size.height
  const placed = (l: Lanes): Lanes => ({
    main: pixel(l.main, roomMain),
    top: { x: pixel(l.top.x, source.width - half.width), y: pixel(l.top.y, source.height - half.height) },
    bottom: { x: pixel(l.bottom.x, source.width - half.width), y: pixel(l.bottom.y, source.height - half.height) }
  })
  // The lanes the export keys: the crop's axis, and on a two-up clip each half's x and y.
  const count = keys.halves ? LANES.length : 1

  const cuts: ExitCut[] = []
  for (let k = 1; k < keys.shots.length; k++) {
    const before = path.shots[keys.shots[k - 1].index]
    const after = path.shots[keys.shots[k].index]
    if (!before || !after) continue
    const was = flat(placed(lanesOf(before, path, true)))
    const now = flat(placed(lanesOf(after, path, false)))
    const frame = keys.shots[k].from
    const on = flat(lanesOn(keys, frame))
    const prior = flat(lanesOn(keys, frame - 1))
    // Lane by lane: one half kept where the old shot had it is a crop held, whatever the other half did.
    const moving = LANES.slice(0, count).filter((_, j) => was[j] !== now[j])
    const heldLanes = moving.filter((lane) => on[LANES.indexOf(lane)] === prior[LANES.indexOf(lane)])
    cuts.push({ shot: keys.shots[k].index, frame, moves: moving.length > 0, held: heldLanes.length > 0, heldLanes })
  }
  return cuts
}

/**
 * One followed clip's reading, or null when the clip does not follow. A clip
 * that follows but whose file's track this build cannot read (none, another
 * version, another size) is a row of zeros with a note: it shows its stored
 * crop, and that is worth saying, not hiding.
 */
export function scoreFollowedClip(project: Project, clip: Clip, fps: number, keys: FollowKeys | null = followKeys(project, clip, fps)): ExitRow | null {
  if (!clip.follow) return null
  const base = { clipId: clip.id, assetId: clip.assetId }
  if (!keys) {
    return {
      ...base,
      shots: 0,
      twoUp: 0,
      samplesWithFace: 0,
      inside: 0,
      insideShare: null,
      heldAcrossCut: 0,
      cuts: 0,
      notes: ['no subject track this build can read for the file: the clip shows its stored crop, and nothing was scored']
    }
  }
  const samples = exitSamples(project, clip, fps, keys)
  const cuts = exitCuts(project, clip, fps, keys)
  const inside = samples.filter((s) => s.inside).length
  const notes = [...keys.notes]
  if (clip.hold) notes.push('a held frame: its samples are not scored')
  return {
    ...base,
    shots: keys.shots.length,
    twoUp: keys.shots.filter((s) => s.why === 'two-up').length,
    samplesWithFace: samples.length,
    inside,
    insideShare: samples.length > 0 ? inside / samples.length : null,
    heldAcrossCut: cuts.filter((c) => c.held).length,
    cuts: cuts.length,
    notes
  }
}

/** Every clip with `follow`, in timeline order (by start, then as the project lists them). */
export function followedClips(project: Project): Clip[] {
  return project.clips
    .map((clip, i) => ({ clip, i }))
    .filter(({ clip }) => !!clip.follow)
    .sort((a, b) => a.clip.start - b.clip.start || a.i - b.i)
    .map(({ clip }) => clip)
}

/** A row for every followed clip, in `followedClips`' order. */
export function scoreProject(project: Project, fps: number): ExitRow[] {
  return followedClips(project).map((clip) => scoreFollowedClip(project, clip, fps)!)
}

/* ------------------------------------------------------------- the bars */

export type BarMark = 'met' | 'not met' | 'no face found' | 'not scored'

/** The two measurable bars, marked for one row. */
export function exitBars(row: ExitRow): { inside: BarMark; held: BarMark } {
  if (row.shots === 0) return { inside: 'not scored', held: 'not scored' }
  return {
    inside: row.insideShare === null ? 'no face found' : row.insideShare >= EXIT_BARS.insideShare ? 'met' : 'not met',
    held: row.heldAcrossCut <= EXIT_BARS.heldAcrossCut ? 'met' : 'not met'
  }
}

/**
 * The README's table, pipe-delimited at both ends so the last column — the
 * rating, empty, the user's to fill — is still a column: one line a clip,
 * the two bars marked.
 */
export function exitTable(entries: { name: string; row: ExitRow }[]): string[] {
  const head = ['#', 'clip', 'shots', 'two-up shots', 'samples with a face', 'inside share', 'held across a cut', 'inside ≥ 95 %', '0 held', 'rating (1–5)']
  const body = entries.map(({ name, row }, i) => {
    const bars = exitBars(row)
    const share = row.insideShare === null ? '—' : `${(row.insideShare * 100).toFixed(1)} % (${row.inside})`
    const cells = [String(i + 1), name.replace(/\|/g, '\\|'), String(row.shots), String(row.twoUp), String(row.samplesWithFace), share]
    return [...cells, `${row.heldAcrossCut} of ${row.cuts}`, bars.inside, bars.held, '']
  })
  const widths = head.map((h, c) => Math.max(h.length, ...body.map((r) => r[c].length)))
  const line = (cells: string[]): string => `| ${cells.map((cell, c) => cell.padEnd(widths[c])).join(' | ')} |`
  return [line(head), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...body.map(line)]
}

/* ------------------------------------------------- the runner's ffmpeg */

/** The most frames one pull selects: its `select` is a flat sum of `eq(n,k)`, one term a frame, inside `-vf`. */
export const PULL_BATCH = 200

/**
 * One pass that writes the SOURCE frame the export shows on each of `frames`
 * (clip frames) to `pattern` (an image2 pattern, `%05d.png`), in frame order:
 * the export's own input (`videoInputArgs`: its seek and length), its retime
 * (`followedRetime`), and the followed clock `fps=…:start_time=0` that makes
 * clip frame k slot k (plan.ts `followClock`) — then `select` on the slot.
 * The upright frame, uncropped: the runner draws the crop on it. Not for a
 * held clip, which shows one frame.
 */
export function exitPullArgs(
  clip: Clip,
  asset: Pick<MediaAsset, 'path'>,
  fps: number,
  keys: FollowKeys | null,
  frames: readonly number[],
  pattern: string
): string[] {
  if (clip.hold) throw new Error('A held clip shows one frame: there is nothing to pull per frame')
  const wanted = [...new Set(frames)].sort((a, b) => a - b)
  if (wanted.length === 0 || wanted.length > PULL_BATCH) throw new Error(`A pull takes 1–${PULL_BATCH} frames, not ${wanted.length}`)
  if (wanted.some((k) => !Number.isInteger(k) || k < 0 || k >= clip.duration)) throw new Error('A pulled frame must be a frame of the clip')
  const chain = [followedRetime(clip, fps, keys), `fps=${fps}:start_time=0`, `select='${wanted.map((k) => `eq(n,${k})`).join('+')}'`]
    .filter((f): f is string => !!f)
    .join(',')
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...videoInputArgs(clip, asset, fps),
    '-vf', chain,
    // One file per selected frame, in order, and stop at the last: nothing past it is decoded.
    '-vsync', '0', '-frames:v', String(wanted.length),
    pattern
  ]
}

/** drawbox's colours: the crop (a two-up's top half), a two-up's bottom half, the faces. */
export const EXIT_COLOURS = { crop: '0xFF0000', bottom: '0x00A0FF', face: '0x00FF00' } as const

/** One panel of a sheet: a pulled frame and the boxes drawn on it, in its own pixels. */
export interface SheetPanel {
  file: string
  /** The frame's size, so a line stays about 3 px thick after the sheet's scale. */
  size: { width: number; height: number }
  boxes: { rect: CropRect; colour: string }[]
}

/**
 * A contact sheet: each panel's boxes drawn with `drawbox` on its own frame,
 * scaled to `height`, side by side with `hstack` (one panel needs none).
 */
export function exitSheetArgs(panels: readonly SheetPanel[], out: string, height = 540): string[] {
  if (panels.length === 0) throw new Error('A sheet needs a frame')
  const chains = panels.map((p, i) => {
    const t = Math.max(2, Math.ceil((3 * p.size.height) / height))
    const draws = p.boxes.map(
      ({ rect, colour }) =>
        `drawbox=x=${Math.round(rect.x)}:y=${Math.round(rect.y)}:w=${Math.max(1, Math.round(rect.width))}:h=${Math.max(1, Math.round(rect.height))}:color=${colour}:t=${t}`
    )
    return `[${i}:v]${[...draws, `scale=-2:${height}`].join(',')}`
  })
  const graph =
    panels.length === 1
      ? chains[0]
      : `${chains.map((c, i) => `${c}[s${i}]`).join(';')};${panels.map((_, i) => `[s${i}]`).join('')}hstack=inputs=${panels.length}`
  return ['-hide_banner', '-loglevel', 'error', '-y', ...panels.flatMap((p) => ['-i', p.file]), '-filter_complex', graph, '-frames:v', '1', out]
}

/**
 * The folder a clip's frames go in: its place in the table and its file's
 * name, made a name on both platforms — Windows' illegal set and reserved
 * names out (`safeTakeBase`), the extension dropped, and `%` out, which the
 * pull's image2 pattern would read as a field.
 */
export function exitFolderName(n: number, assetName: string): string {
  const name = safeTakeBase(assetName.replace(/\.[^./\\]+$/, ''), 'clip').replace(/%/g, '-')
  return `${n}-${name}`
}
