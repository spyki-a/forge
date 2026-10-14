import type { FacesTrack } from '../sidecar/protocol'
import { REDUCE } from './job'
import { SUBJECT_TRACK_VERSION, type FaceBox, type Shot, type SubjectSample, type SubjectTrack } from './types'

/**
 * The face finder's track, reduced for the project (docs/CLIPS.md §4.3, §4.6):
 * the helper samples 5 frames a second and keeps the two largest faces of
 * each; the project keeps 2 samples a second (`REDUCE`), so a 10-minute clip
 * adds about 1,200 samples to the project file rather than 3,000. Pans need
 * about 0.5 s of resolution, which 2 a second still gives.
 *
 * **A sample is PICKED, never averaged.** A box is one decoded frame's fact:
 * the mean of two frames' boxes is a box no frame had — across a head turn it
 * is a box half on the face — and a crop path that later sits on it centres
 * on nothing. So each 500 ms tick keeps the one sample whose `ms` is nearest
 * it, with that sample's own `ms` and its own boxes.
 *
 * **Never across a cut.** A tick takes its sample from the shot the tick is
 * in: the sample just past a cut is the next shot's picture, and path.ts
 * decides which shot a sample belongs to by its `ms`, so a sample relabelled
 * to the tick's time would carry one shot's face into another. Keeping the
 * sample's own `ms` keeps that honest. A shot no tick falls in (shorter than
 * a tick, which `SCENE_DEFAULTS.minShotMs` 500 rules out today) keeps the
 * sample nearest its middle, so a shot with samples never ends up with none.
 *
 * Pure: main's analysis job (main/reframe/analyse.ts) runs it, and the tests.
 */

export interface ReduceOptions {
  samplesPerSecond: number
  maxFaces: number
}

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/**
 * One face made clean, or null when nothing usable is left: every number
 * finite, the box clamped to the frame (0..1 of the UPRIGHT frame) and
 * rounded to 4 dp with `x + width` and `y + height` never past 1, the score
 * clamped to 0..1. A box with no area inside the frame is dropped (path.ts
 * drops a non-finite one too, but the track is written clean).
 */
export function cleanFace(face: unknown): FaceBox | null {
  if (typeof face !== 'object' || face === null) return null
  const { x, y, width, height, score } = face as Record<string, unknown>
  const n = [x, y, width, height, score]
  if (!n.every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  const [fx, fy, fw, fh, fs] = n as number[]
  const left = r4(clamp01(fx))
  const top = r4(clamp01(fy))
  const right = r4(clamp01(fx + fw))
  const bottom = r4(clamp01(fy + fh))
  const w = r4(right - left)
  const h = r4(bottom - top)
  if (!(w > 0 && h > 0)) return null
  return { x: left, y: top, width: w, height: h, score: r4(clamp01(fs)) }
}

/** The two largest by area, largest first; a tie goes to the higher score (the helper's rule). */
function largest(faces: unknown, maxFaces: number): FaceBox[] {
  if (!Array.isArray(faces)) return []
  return faces
    .map(cleanFace)
    .filter((f): f is FaceBox => f !== null)
    .sort((a, b) => b.width * b.height - a.width * a.height || b.score - a.score)
    .slice(0, Math.max(0, Math.floor(maxFaces)))
}

/**
 * `faces`' samples down to `samplesPerSecond`: a tick every 1000 /
 * samplesPerSecond ms from 0 to the last shot's end, each keeping the sample
 * of its own shot nearest it (the earlier on a tie), within one tick; a
 * sample two ticks pick is kept once. Out come the picked samples in time
 * order, each with its own `ms` and its faces cleaned and cut to the
 * `maxFaces` largest.
 */
export function reduceTrack(faces: FacesTrack, shots: Shot[], o: ReduceOptions = REDUCE): SubjectSample[] {
  if (!(o.samplesPerSecond > 0) || !Number.isFinite(o.samplesPerSecond)) throw new Error(`Cannot keep ${o.samplesPerSecond} samples a second`)
  const step = 1000 / o.samplesPerSecond
  // In time order, one per ms (the first), each with a time.
  const raw = Array.isArray(faces?.samples) ? faces.samples : []
  const seen = new Set<number>()
  const samples = raw
    .filter((s) => typeof s?.ms === 'number' && Number.isFinite(s.ms) && s.ms >= 0)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.ms - b.s.ms || a.i - b.i)
    .map(({ s }) => s)
    .filter((s) => (seen.has(s.ms) ? false : (seen.add(s.ms), true)))
  if (samples.length === 0) return []

  const tiles: Shot[] =
    shots.length > 0 ? shots : [{ startMs: 0, endMs: samples[samples.length - 1].ms + step, score: 0 }]
  const endMs = tiles[tiles.length - 1].endMs
  const picked = new Set<number>()

  /** The first sample at or after `ms` (binary search: a two-hour clip is 36,000 samples). */
  const firstFrom = (ms: number): number => {
    let lo = 0
    let hi = samples.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (samples[mid].ms < ms) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** Of the samples in [from, to), the one nearest `at` within `within`; the earlier on a tie. */
  const nearest = (from: number, to: number, at: number, within: number): number | null => {
    let best: number | null = null
    let bestGap = Infinity
    for (let i = firstFrom(Math.max(from, at - within)); i < samples.length; i++) {
      const ms = samples[i].ms
      if (ms >= to || ms > at + within) break
      const gap = Math.abs(ms - at)
      if (gap < bestGap) {
        best = i
        bestGap = gap
      }
    }
    return best
  }

  for (const shot of tiles) {
    let any = false
    // The ticks inside this shot: k·step in [startMs, endMs), as integers of k so they never drift.
    for (let k = Math.max(0, Math.ceil(shot.startMs / step)); k * step < Math.min(shot.endMs, endMs); k++) {
      any = true
      const i = nearest(shot.startMs, shot.endMs, k * step, step)
      if (i !== null) picked.add(i)
    }
    if (!any) {
      const i = nearest(shot.startMs, shot.endMs, (shot.startMs + shot.endMs) / 2, Infinity)
      if (i !== null) picked.add(i)
    }
  }

  return [...picked].sort((a, b) => a - b).map((i) => ({ ms: samples[i].ms, faces: largest(samples[i].faces, o.maxFaces) }))
}

/* ------------------------------------------------------------ the track */

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)

/**
 * A `SubjectTrack` as main writes it, checked whole: the file read back from
 * `$userData/subjects/` (a cache hit), and the job's own result before it is
 * written. Null when anything is off — main then analyses again rather than
 * hand on a track path.ts or keys.ts would misread:
 *
 * - the version is `SUBJECT_TRACK_VERSION`, the key a non-empty string, the
 *   size whole and positive, the duration finite and positive;
 * - the shots tile [0, durationMs) in order with no gap, each `startPts`
 *   (when present) a whole number, and `perShot` parallel to them;
 * - every sample's `ms` finite, in order, and every face exactly what
 *   `cleanFace` would keep: finite, inside the frame, the score 0..1;
 * - the scene's backend the one this build writes, `timeBase` (when
 *   present) whole and positive.
 */
export function checkSubjectTrack(value: unknown): SubjectTrack | null {
  if (typeof value !== 'object' || value === null) return null
  const t = value as Partial<SubjectTrack> & Record<string, unknown>
  if (t.version !== SUBJECT_TRACK_VERSION) return null
  if (typeof t.key !== 'string' || t.key.length === 0) return null
  if (!isWhole(t.width) || !isWhole(t.height) || t.width <= 0 || t.height <= 0) return null
  if (!isNumber(t.durationMs) || t.durationMs <= 0) return null
  if (typeof t.detector !== 'string' || typeof t.at !== 'string') return null

  const shots = t.shots
  if (!Array.isArray(shots) || shots.length === 0) return null
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i] as Partial<Shot> | null
    if (!s || !isNumber(s.startMs) || !isNumber(s.endMs) || !isNumber(s.score) || !(s.endMs > s.startMs)) return null
    if (s.startMs !== (i === 0 ? 0 : shots[i - 1].endMs)) return null
    if (s.startPts !== undefined && !isWhole(s.startPts)) return null
  }
  if (shots[shots.length - 1].endMs !== t.durationMs) return null
  if (!Array.isArray(t.perShot) || t.perShot.length !== shots.length) return null
  if (t.perShot.some((p) => typeof p !== 'object' || p === null)) return null

  if (!Array.isArray(t.samples)) return null
  let last = -Infinity
  for (const sample of t.samples) {
    if (!sample || !isNumber(sample.ms) || sample.ms < last || !Array.isArray(sample.faces)) return null
    last = sample.ms
    for (const face of sample.faces) {
      const clean = cleanFace(face)
      if (!clean || clean.x !== face.x || clean.y !== face.y || clean.width !== face.width || clean.height !== face.height || clean.score !== face.score) {
        return null
      }
    }
  }

  const scene = t.scene
  if (!scene || !isNumber(scene.threshold) || !isNumber(scene.minShotMs) || scene.backend !== 'ffmpeg-select-rgb24') return null
  if (t.timeBase !== undefined) {
    const tb = t.timeBase
    if (!tb || !isWhole(tb.num) || !isWhole(tb.den) || tb.num <= 0 || tb.den <= 0) return null
  }
  return t as SubjectTrack
}
