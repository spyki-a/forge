/**
 * The speech model's own press (docs/CLIPS.md §3a.4, §16.49 answered (a)).
 *
 * Transcribe must never fetch 464 MB unnamed and unpinned: faster-whisper's
 * `WhisperModel('small')` would call `snapshot_download` at `main` on the
 * first press (asr.py as it was). So the model is a press of its own, "Get the
 * speech model · 464 MB", on the button's own label before anything is
 * fetched (§0's click rule), pinned to one commit of the repository, and
 * `asr.transcribe` answers `unavailable` with `NEEDS_SPEECH_MODEL` while it is
 * not on disk. Shared, so the Python side's label, the Settings row, the
 * MediaPool's Transcribe and the census name one thing.
 *
 * Pure: no disk, no electron, no node.
 */

import { formatBytes } from '../assets/pack'
import type { ModelStatus } from '../sidecar/protocol'

/** The repository the helper pins, by commit, in `asr.py`. */
export const SPEECH_MODEL_REPO = 'Systran/faster-whisper-small'

/** The download's name on screen (`ModelStatus.label`). */
export const SPEECH_MODEL_LABEL = 'the speech model'

/** The host the press asks (`ModelStatus.host`); the rule for a restricted network is huggingface.co and *.hf.co (docs/SIDECAR.md). */
export const SPEECH_MODEL_HOST = 'huggingface.co'

/** The greyed Transcribe's reason while the model is not on disk, and the census row's text. */
export const NEEDS_SPEECH_MODEL = 'needs the speech model'

/** The helper's method for the status and the fetch (ModelParams → ModelStatus), registered beside `asr.transcribe`. */
export const SPEECH_MODEL_METHOD = 'asr.model'

/** The IPC channels between the window and main. */
export const SPEECH_MODEL_CHANNELS = {
  /** `{ download?: boolean }` → ModelStatus; `download: true` only from the press that showed the size. */
  model: 'asr:model',
  /** SpeechModelProgress while a fetch runs. */
  progress: 'asr:modelProgress'
} as const

export interface SpeechModelProgress {
  /** 0–1, or null while the size is not yet known. */
  progress: number | null
  message?: string
}

/** The press's label: "Get the speech model · 464 MB", from the status's bytes. */
export function speechModelLabel(status: Pick<ModelStatus, 'bytes'>): string {
  return `Get ${SPEECH_MODEL_LABEL} · ${formatBytes(status.bytes)}`
}

/**
 * `asr:model`'s payload, checked where the renderer's data crosses into main:
 * `{ download?: boolean }` or nothing. `download` is true only when the
 * renderer sent exactly `true` (the press); anything else in its place is
 * refused rather than read as a status ask, so a mistyped press says so.
 */
export function speechModelRequest(payload: unknown): { download: boolean } {
  if (payload === undefined || payload === null) return { download: false }
  if (typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Getting the speech model expects {download?}')
  const { download } = payload as Record<string, unknown>
  if (download !== undefined && typeof download !== 'boolean') throw new Error('Getting the speech model expects download to be true or false')
  return { download: download === true }
}
