import { SUBJECT_TRACK_VERSION, type FaceBox, type Shot, type SubjectSample, type SubjectTrack } from '@shared/reframe/types'

/*
 * Hand-built subject tracks for the reframe render check (docs/CLIPS.md
 * §4.9): no detector, so what the crop should do is known before the render.
 *
 * Times are the source's own, in ms as the shot finder writes them: the cut
 * frame's pts_time printed `%.6g` (the scene pass's `metadata=print` line),
 * then to the microsecond (shots.ts `msOf`). So 1.21666… s is 1216.67 ms here,
 * exactly what an analysis of the file would have stored.
 */

/** A frame's time as the scene pass prints it and shots.ts reads it. */
export function printedMs(seconds: number): number {
  return Math.round(Number(seconds.toPrecision(6)) * 1e6) / 1e3
}

const face = (cx: number, cy = 0.32, size = 0.08): FaceBox => ({
  x: Number((cx - size / 2).toFixed(4)),
  y: Number((cy - 0.07).toFixed(4)),
  width: size,
  height: 0.14,
  score: 0.9
})

export interface TrackPlan {
  /** Each cut's time in source ms (`printedMs`), in order. */
  cutMs: number[]
  durationMs: number
  /** Shot 4 with two faces far apart (a stacked two-up), or one in the middle. */
  twoUp: boolean
  /** The file's size; the render check's 1920×1080 by default. The faces are shares of it. */
  size?: { width: number; height: number }
}

/** The four-shot track: shot 1's face at x 0.25, shot 2's at 0.75 (a jump), shot 3's drifting right from 0.3 to 0.6, shot 4 one face at 0.5 or two at 0.2 and 0.8. */
export const FACES = {
  one: 0.25,
  two: 0.75,
  /** Shot 3's face, by sample, from its first: held, then moving, then held again. */
  drift: [0.3, 0.3, 0.45, 0.6, 0.6, 0.6] as const,
  four: 0.5,
  /** The two-up's faces: x, and the face's vertical centre, so the halves differ on both axes. */
  left: { x: 0.2, y: 0.35 },
  right: { x: 0.8, y: 0.55 }
} as const

export function fourShotTrack(plan: TrackPlan): SubjectTrack {
  const [a, b, c] = plan.cutMs
  const starts = [0, a, b, c]
  const shots: Shot[] = starts.map((startMs, i) => ({ startMs, endMs: starts[i + 1] ?? plan.durationMs, score: i === 0 ? 0 : 1 }))
  const samples: SubjectSample[] = []
  // Two a second (§4.3), from 0.
  for (let ms = 0; ms < plan.durationMs; ms += 500) {
    const shot = shots.findIndex((s) => ms >= s.startMs && ms < s.endMs)
    let faces: FaceBox[]
    if (shot === 0) faces = [face(FACES.one)]
    else if (shot === 1) faces = [face(FACES.two)]
    else if (shot === 2) {
      const k = samples.filter((s) => s.ms >= shots[2].startMs && s.ms < ms).length
      faces = [face(FACES.drift[Math.min(k, FACES.drift.length - 1)])]
    } else if (plan.twoUp) {
      // Largest first: the two the same size, so the order is by side (§4.6 rule 3 puts the LEFT face on top).
      faces = [face(FACES.right.x, FACES.right.y), face(FACES.left.x, FACES.left.y)]
    } else faces = [face(FACES.four)]
    samples.push({ ms, faces })
  }
  return {
    key: 'hand-built:0',
    version: SUBJECT_TRACK_VERSION,
    width: plan.size?.width ?? 1920,
    height: plan.size?.height ?? 1080,
    durationMs: plan.durationMs,
    shots,
    samples,
    perShot: shots.map(() => ({})),
    detector: 'hand-built (no detector)',
    scene: { threshold: 0.3, minShotMs: 0, backend: 'ffmpeg-select-rgb24' },
    at: '2026-10-13T00:00:00.000Z'
  }
}

/**
 * A track of many short shots — one every `every` source frames, one sample
 * each, the face jumping between x 0.25 and 0.75 — so a followed clip has
 * more held keys than a nested `if()` can parse (EFFECTS.md §48: 96 held keys
 * render as the crop's x, 97 are refused).
 */
export function manyCutTrack(frameTimes: readonly number[], every: number, durationMs: number): SubjectTrack {
  const shots: Shot[] = []
  const samples: SubjectSample[] = []
  for (let f = 0, i = 0; f < frameTimes.length; f += every, i++) {
    const startMs = f === 0 ? 0 : printedMs(frameTimes[f])
    const next = f + every < frameTimes.length ? printedMs(frameTimes[f + every]) : durationMs
    shots.push({ startMs, endMs: next, score: f === 0 ? 0 : 1 })
    samples.push({ ms: (startMs + next) / 2, faces: [face(i % 2 === 0 ? 0.25 : 0.75)] })
  }
  return {
    key: 'hand-built:many',
    version: SUBJECT_TRACK_VERSION,
    width: 1920,
    height: 1080,
    durationMs,
    shots,
    samples,
    perShot: shots.map(() => ({})),
    detector: 'hand-built (no detector)',
    scene: { threshold: 0.3, minShotMs: 0, backend: 'ffmpeg-select-rgb24' },
    at: '2026-10-13T00:00:00.000Z'
  }
}
