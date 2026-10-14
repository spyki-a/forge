/**
 * Sidecar wire protocol — JSON-RPC 2.0 over stdio, newline-delimited.
 *
 * Why stdio rather than a local HTTP server:
 *  - no port allocation, so no conflicts with whatever else the user runs
 *  - no CORS, no auth, no listening socket to secure
 *  - the child dies with the parent automatically
 *  - **no macOS firewall prompt** — binding a socket makes the OS ask the user
 *    to allow incoming connections, which is alarming in a video editor
 *
 * Framing is one JSON object per line. That holds only because large payloads
 * never travel through the pipe: audio, video and model output go via file
 * paths on disk. Keep it that way — piping megabytes through stdio will stall
 * the event loop on both sides.
 */

import type { FaceBox, UnitRect } from '../reframe/types'

export const PROTOCOL_VERSION = 1

export interface RpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

export interface RpcSuccess {
  jsonrpc: '2.0'
  id: number
  result: unknown
}

export interface RpcErrorBody {
  code: number
  message: string
  data?: unknown
}

export interface RpcFailure {
  jsonrpc: '2.0'
  id: number
  error: RpcErrorBody
}

export interface RpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export type RpcMessage = RpcRequest | RpcSuccess | RpcFailure | RpcNotification

/** Server -> client, while a request is still running. */
export interface ProgressParams {
  id: number
  /** 0..1, or null when the work has no measurable total. */
  progress: number | null
  message?: string
}

/** Client -> server, asking a running request to stop. */
export interface CancelParams {
  id: number
}

export const METHOD_PROGRESS = 'progress'
export const METHOD_CANCEL = 'cancel'

/** JSON-RPC reserved codes, plus ours. */
export const RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  /** The request was cancelled by the client. */
  cancelled: -32800,
  /** A capability is unavailable — model missing, dependency not installed. */
  unavailable: -32001
} as const

export function isResponse(message: RpcMessage): message is RpcSuccess | RpcFailure {
  return 'id' in message && typeof message.id === 'number' && !('method' in message)
}

export function isFailure(message: RpcMessage): message is RpcFailure {
  return isResponse(message) && 'error' in message
}

export function isNotification(message: RpcMessage): message is RpcNotification {
  return 'method' in message && !('id' in message)
}

export function encode(message: RpcMessage): string {
  return `${JSON.stringify(message)}\n`
}

/**
 * Accumulates stdout chunks and yields whole messages.
 *
 * A chunk boundary can fall anywhere, including mid-character, so the caller
 * must hand every chunk to the same instance rather than parsing chunks
 * independently — that bug shows up only under load, when messages get large.
 */
export class LineDecoder {
  private buffer = ''

  push(chunk: string): RpcMessage[] {
    this.buffer += chunk
    const messages: RpcMessage[] = []

    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line !== '') {
        try {
          messages.push(JSON.parse(line) as RpcMessage)
        } catch {
          // A non-JSON line is almost always a stray print() or a warning from a
          // Python library. Dropping it is correct; crashing the pipe is not.
        }
      }
      newline = this.buffer.indexOf('\n')
    }
    return messages
  }

  /** Bytes held but not yet terminated by a newline. */
  get pending(): number {
    return this.buffer.length
  }

  reset(): void {
    this.buffer = ''
  }
}

/* ------------------------------------------------------- capability names */

export const SIDECAR_METHODS = {
  /** Handshake: returns protocol version, python version, available capabilities. */
  hello: 'system.hello',
  /** Liveness probe. */
  ping: 'system.ping',
  /** Transcribe audio: { path, language?, model? } -> word-level timestamps. */
  transcribe: 'asr.transcribe',
  /** Beats and musical structure: { path, startMs?, endMs? }. */
  beats: 'audio.beats',
  /** Cut a photo into depth planes for parallax: { path, ffmpeg, ffprobe, layers? }. */
  depthLayers: 'depth.layers',
  /** Sharpness, exposure and a perceptual hash per photo: { paths, ffmpeg, ffprobe }. */
  visionMeasure: 'vision.measure',
  /**
   * Separate a song into a voice and an instrumental: { path, outDir? }.
   *
   * Optional, and degraded on most installs — it needs torch. The app falls
   * back to mid/side in the main process, which gives a real instrumental and
   * only an emphasised voice; the result's `quality` says which one answered.
   */
  stems: 'audio.stems',
  /** Speak text with Kokoro into a wav: { text, voice, speed, out } -> { path, durationMs }. */
  voiceSpeak: 'voice.speak',
  /** The local voices on offer: {} -> { voices: { id, label, language }[] }. */
  voiceVoices: 'voice.voices',
  /**
   * Faces through a clip, for the reframe: FacesParams -> FacesResult, the
   * track itself written to disk (docs/CLIPS.md §4.3). MediaPipe's BlazeFace
   * full-range model, run in a CHILD process (`forge_sidecar.workers.mp_faces`)
   * so a C++ abort ends the child and not the helper. Never downloads: a model
   * not on disk is `unavailable`, and `facesModel` is the question and the fetch.
   */
  faces: 'vision.faces',
  /** The face finder's model, 1,083,786 B from storage.googleapis.com: ModelParams -> ModelStatus. */
  facesModel: 'vision.facesModel',
  /**
   * The subject of a frame with no face: SalientParams -> SalientResult
   * (docs/CLIPS.md §4.4). One decoded frame per item through depth's BiRefNet
   * session (`depth.py`, under its session lock). Never downloads, as `faces`.
   */
  salient: 'vision.salient',
  /** The subject finder's model, BiRefNet_lite fp16, 114,538,221 B from Hugging Face: ModelParams -> ModelStatus. */
  salientModel: 'vision.salientModel'
} as const

/**
 * The methods the helper registers only when their module loads.
 *
 * Every one must answer from `system.hello` as either a capability or
 * degraded with a reason, never be absent: a missing module marks EVERY
 * method it would have registered (sidecar/forge_sidecar/capabilities/
 * __init__.py `OPTIONAL`). `voice.voices` answered "unknown method" until
 * 2026-10-08 because only `voice.speak` was listed there (docs/CLIPS.md §3.6).
 */
export const OPTIONAL_METHODS: readonly string[] = [
  SIDECAR_METHODS.transcribe,
  SIDECAR_METHODS.beats,
  SIDECAR_METHODS.depthLayers,
  SIDECAR_METHODS.visionMeasure,
  SIDECAR_METHODS.stems,
  SIDECAR_METHODS.voiceSpeak,
  SIDECAR_METHODS.voiceVoices,
  SIDECAR_METHODS.faces,
  SIDECAR_METHODS.facesModel,
  SIDECAR_METHODS.salient,
  SIDECAR_METHODS.salientModel
]

export interface HelloResult {
  protocolVersion: number
  python: string
  platform: string
  capabilities: string[]
  /** Capabilities present but not usable, with the reason. */
  degraded: Record<string, string>
}

/* ------------------------------------------------------- model downloads */

/*
 * Every model download is the user's click, on a button that names its size
 * before the press (docs/CLIPS.md §0, §14 "a model not on disk"). So a
 * model-gated capability is two methods in one module: the work, which NEVER
 * downloads and answers `unavailable` ("… is not downloaded yet") when its
 * model is not on disk, as voice.speak does for Kokoro's files
 * (capabilities/voice.py:53-59); and a `…Model` method, which is both the
 * question the button's label needs before any press and the fetch the press
 * starts.
 *
 * Why not a `download: true` flag on the work itself, the way depth.layers
 * fetches inside its own bake (depth.py:120-158, labelled byte progress,
 * "first run only"): a bake is always a press, but an analysis is also
 * started by Clip it's reframe step and Reframe all, and the dock reads
 * "Follow the subject · gets the face finder, 1.1 MB, first time" while the
 * model is absent (§4.8) — a question no analysis call can answer without
 * running. And `unavailable` carries only a message (rpc.py `_fail(…,
 * str(exc))`), so a missing model on the work's own path could be told apart
 * from "the face detector stopped" only by reading prose. The fetch keeps
 * depth's shape: labelled byte progress through `media.progress_class`,
 * cancellable, and main never re-derives the cache layout.
 */

export interface ModelParams {
  /**
   * Fetch the model when it is not on disk, then answer. Set ONLY by the press
   * of the Get button that showed `bytes`; without it nothing is downloaded.
   */
  download?: boolean
}

export interface ModelStatus {
  /** On disk and whole: fetch_url's sha256-named file, or the pinned commit's Hugging Face snapshot. */
  present: boolean
  /** What the button names before the press: 1,083,786 for the face finder. */
  bytes: number
  /** The download's name on screen: 'the face finder', 'the subject finder'. */
  label: string
  /**
   * The host the download is asked of, as the dock names it:
   * 'storage.googleapis.com' (which serves the bytes itself), 'huggingface.co'.
   * NOT the whole of what a restricted network must allow for Hugging Face: a
   * resolve URL there answers 307 to the repo's current name, then 302 to
   * its CDN, `us.aws.cdn.hf.co` (measured by headers, 2026-10-13, with Xet
   * disabled as the client sets it), so the rule is `huggingface.co` and
   * `*.hf.co` (docs/SIDECAR.md).
   */
  host: string
}

/* ------------------------------------------------------------------ faces */

/** `vision.faces` — docs/CLIPS.md §4.3. */
export interface FacesParams {
  path: string
  ffmpeg: string
  ffprobe: string
  /**
   * The UPRIGHT size main believes (R5: asset.width/height, a phone clip's
   * turn already applied); refused with media.SizeMismatch when
   * media.probe_upright disagrees (media.require_upright).
   */
  width: number
  height: number
  /** SOURCE ms; the whole file when absent. */
  startMs?: number
  endMs?: number
  /** Samples a second: default 5, clamped 1–30. */
  fps?: number
  /** The analysis frame's long side in px: default 640. */
  edge?: number
  /** A face scoring under this is not kept: default 0.5. */
  minScore?: number
  /**
   * `${size}:${mtimeMs}` (src/main/assets.ts `fileKey`) — the cache key,
   * stems-style, never a whole-file sha1. It holds a COLON, illegal in a
   * Windows file name (CLAUDE.md), so it never reaches the track's name as it
   * is: hash it, or turn the colon into '-', before building the path.
   */
  key: string
}

/** `vision.faces`' answer. The samples are on disk at `track`, not in here. */
export interface FacesResult {
  /** The upright frame the boxes are normalised against: the params' width and height. */
  width: number
  height: number
  durationMs: number
  /** The rate actually sampled, after the 1–30 clamp. */
  sampleFps: number
  /** Samples in the track. */
  frames: number
  /** Samples holding at least one face. */
  withFace: number
  /** 'mediapipe/blaze_face_full_range@0.10.35' ('yunet/2023mar' only if §4.3's fallback is ever built). */
  detector: string
  /**
   * Absolute path of a FacesTrack: `$FORGE_CACHE_DIR/faces/<key>-<params hash>.json`
   * (media.cache_dir('faces')), the key made file-safe as `key` says. On disk
   * rather than over the pipe: ten minutes at 5 fps is 3,000 samples
   * (this file's header).
   */
  track: string
  /** True when the track for this key and these params was already on disk. */
  cached: boolean
}

/**
 * The face track's version, the helper's `faces.TRACK_VERSION` (and its
 * worker's copy). 2 since 2026-10-14: each sample is the source frame ON
 * SCREEN at its `ms` (media.frame_args' `fps=…:round=up`); version 1's were
 * the frame up to half a sampling slot later — 66.7 ms at 5 a second on 30
 * fps, so a sample just before a cut carried the next shot's face. Main reads
 * only this version, and records it in the subject track it reduces
 * (`SubjectTrack.facesVersion`) so a track cut from another is analysed again.
 */
export const FACES_TRACK_VERSION = 2

/**
 * The track file `FacesResult.track` names. Boxes are normalised 0..1 of the
 * UPRIGHT frame at 4 dp (depth.py `_mask_box`'s convention); `ms` is SOURCE
 * media time with findShots' origin, counted from the file's first timestamp
 * (ffmpeg subtracts `start_time`, EFFECTS.md §55; media.iter_frames' `start_ms
 * + i × 1000 / fps`, each the frame on screen then). Main reduces it to 2
 * samples a second and the two largest faces (§4.6's SubjectSample) — 1f's
 * job, not the helper's.
 */
export interface FacesTrack {
  version: typeof FACES_TRACK_VERSION
  samples: { ms: number; faces: FaceBox[] }[]
}

/* ---------------------------------------------------------------- salient */

/**
 * `vision.salient` — docs/CLIPS.md §4.4: one frame per item, a shot's middle
 * frame. Depth's `_matte_session` DOWNLOADS on a cache miss (media.download),
 * so the presence check `salientModel` makes — try_to_load_from_cache at
 * depth.MATTE_REVISION, as media.download itself asks first — comes before
 * any session is opened.
 */
export interface SalientParams {
  /** SOURCE ms of the frame to decode (media.decode_rgb(at_ms=…)). */
  items: { path: string; ms: number }[]
  ffmpeg: string
  ffprobe: string
  /** The UPRIGHT size main believes, as FacesParams'; refused when the probe disagrees. */
  width: number
  height: number
}

/**
 * One item's answer. `coverage` is the matte's share of the frame (0..1, 4 dp);
 * `box` is `_mask_box` trimmed at 1 %, drawn round the matte once
 * `_clean_mask` has dropped its speckle, present only when the share is
 * within depth.py's MIN_SUBJECT..MAX_SUBJECT (0.01–0.92) — the rule subjectBox
 * follows (depth.py:461-474) — and null otherwise. Decide by `box !== null`,
 * never from `coverage`: the range is tested on the unrounded share, so a
 * coverage reading 0.92 can come with a null box. An item that could not be
 * read carries `error` instead, for that item alone.
 */
export type SalientItem =
  | { ms: number; box: UnitRect | null; coverage: number }
  | { ms: number; error: string }

export interface SalientResult {
  /** Parallel to `items`, in their order (two items may share an `ms`). */
  results: SalientItem[]
}
