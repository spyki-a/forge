import { SUBJECT_TRACK_VERSION, type FaceBox, type Shot, type SubjectSample, type SubjectTrack } from '@shared/reframe/types'
import { REDUCE } from '@shared/reframe/job'
import { SCENE_BACKEND, SCENE_DEFAULTS } from '@shared/reframe/shots'

/**
 * The harness's subject track (docs/CLIPS.md §4.9's harness check), what the
 * bridge's `analyseSubjects` stub "finds" in the harness's 640×360 webm.
 *
 * Deterministic and pure, so a test can hold it to the shape the check
 * needs: shots at 0–2 / 2–4 / 4–end s; one face centred at x 0.25, then one
 * at 0.75, then two at 0.35 and 0.65 — 192 px apart between centres, too far
 * apart for the 202 px crop a 9:16 canvas cuts from 360 px of height, so the
 * third shot is a two-up (tests/bridgeMethods.test.ts runs `cropPath` on it).
 *
 * This is NOT detection: the harness has no AI helper. It stands in for the
 * job's RESULT so everything after it — the store's one update, the preview's
 * followed crop, the Source outline's two rectangles, the drags — can be
 * looked at in a browser. Detection is the integration tests'.
 */

/** Where the shots change, SOURCE ms. The last shot runs to the file's end. */
export const HARNESS_SHOT_STARTS = [0, 2000, 4000] as const

/** Each shot's face centres on x, 0..1 of the upright frame. */
export const HARNESS_FACE_CENTRES: readonly (readonly number[])[] = [[0.25], [0.75], [0.35, 0.65]]

/** A square face on a 640×360 frame: 64 px each way. */
const FACE = { width: 0.1, height: 0.1778, y: 0.25 }

const round4 = (v: number): number => Math.round(v * 10_000) / 10_000

function faceAt(centre: number): FaceBox {
  return { x: round4(centre - FACE.width / 2), y: FACE.y, width: FACE.width, height: FACE.height, score: 0.95 }
}

export function harnessSubjectTrack(options: {
  /** What the harness's `fileKeys` answers for the file: `harness:${path}`. */
  key: string
  width: number
  height: number
  durationMs: number
}): SubjectTrack {
  const { key, width, height } = options
  const durationMs = Math.max(HARNESS_SHOT_STARTS[HARNESS_SHOT_STARTS.length - 1] + 1, Math.round(options.durationMs))
  const shots: Shot[] = HARNESS_SHOT_STARTS.map((startMs, i) => ({
    startMs,
    endMs: HARNESS_SHOT_STARTS[i + 1] ?? durationMs,
    score: i === 0 ? 0 : 1
  }))
  const step = 1000 / REDUCE.samplesPerSecond
  const samples: SubjectSample[] = []
  for (let ms = 0; ms < durationMs; ms += step) {
    const shot = shots.findIndex((s) => ms >= s.startMs && ms < s.endMs)
    // Largest first, as the reduction keeps them; equal sizes keep the left one first.
    samples.push({ ms, faces: (HARNESS_FACE_CENTRES[shot] ?? []).slice(0, REDUCE.maxFaces).map(faceAt) })
  }
  return {
    key,
    version: SUBJECT_TRACK_VERSION,
    width,
    height,
    durationMs,
    shots,
    samples,
    perShot: shots.map(() => ({})),
    detector: 'harness/stub',
    scene: { threshold: SCENE_DEFAULTS.threshold, minShotMs: SCENE_DEFAULTS.minShotMs, backend: SCENE_BACKEND },
    at: '2026-10-13T00:00:00.000Z'
  }
}
