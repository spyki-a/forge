/**
 * The reframe's facts about a file (docs/CLIPS.md §4.6).
 *
 * Everything here is measured once per FILE, not per clip: where the shots
 * change, where the faces are, and what the subject is when there is no face.
 * The crop a clip actually gets is derived from these every time it is read
 * (`path.ts`, then 1f's keys), so an ordinary edit can never leave it stale.
 *
 * Boxes are normalised 0..1 against the UPRIGHT frame (R5: a phone clip's
 * rotation is already applied), rounded to 4 dp — depth.py's subjectBox
 * convention. Times are milliseconds of the SOURCE media.
 */

/** Bumped when the track's meaning changes, so a stored track is re-analysed rather than misread. */
export const SUBJECT_TRACK_VERSION = 1

/** Normalised 0..1 against the UPRIGHT frame (R5), 4 dp — depth.py's subjectBox convention. */
export interface UnitRect {
  x: number
  y: number
  width: number
  height: number
}

export interface FaceBox extends UnitRect {
  score: number
}

/** [start, end) in SOURCE ms; `score` is the scene score of the cut that opens it (0 for the first shot). */
export interface Shot {
  startMs: number
  endMs: number
  score: number
  /**
   * The cut frame's own integer pts, in the video stream's time base
   * (`SubjectTrack.timeBase`), counted from the file's first timestamp
   * (`start_time` subtracted, as the export's input `-ss` counts) as the
   * scene pass's `metadata=print` line prints it (`pts:92160`) — exact where
   * `startMs` is `pts_time` printed `%.6g`. 0 for the first shot. Absent on a
   * track from before 1b kept it, or a window's (not in file terms). keys.ts
   * puts the cut's held key on the export's frame from this when the track
   * has a time base: required at 25 and 50 fps (docs/EFFECTS.md §55).
   */
  startPts?: number
}

/** The two largest faces, largest first. An empty list is a sample where no face was found. */
export interface SubjectSample {
  ms: number
  faces: FaceBox[]
}

/** Project.subjects[assetId] — a fact about the file, like Project.looks: Clear leaves it alone. */
export interface SubjectTrack {
  /** `${size}:${mtimeMs}` */
  key: string
  /** SUBJECT_TRACK_VERSION */
  version: number
  /** Must equal asset.width/height, or the track is refused. */
  width: number
  height: number
  durationMs: number
  shots: Shot[]
  /** 2 a second (§4.3). */
  samples: SubjectSample[]
  /** Parallel to `shots`. */
  perShot: {
    salient?: { box: UnitRect; ms: number }
    ground?: { box: UnitRect; ms: number; phrase: string }
  }[]
  detector: string
  scene: { threshold: number; minShotMs: number; backend: 'ffmpeg-select-rgb24' }
  /** ISO */
  at: string
  /**
   * The video stream's time base (ffprobe's `time_base`, e.g. 1/15360), which
   * each shot's `startPts` counts in. Absent on a track from before 1b kept
   * it: keys.ts then keys each cut from its printed ms.
   */
  timeBase?: { num: number; den: number }
  /**
   * The helper's face-track version these samples were reduced from
   * (protocol.ts `FACES_TRACK_VERSION`). Main's cache analyses a file again
   * when it is not today's: the helper's sampling changed under version 2
   * (each sample the frame on screen at its ms). Absent on a track from
   * before it was kept.
   */
  facesVersion?: number
}
