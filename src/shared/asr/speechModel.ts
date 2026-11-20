/**
 * The speech model's own press (docs/CLIPS.md §3a.4, §16.49 answered (a)),
 * and since 2026-11-20 the choice of three.
 *
 * Transcribe must never fetch a model unnamed and unpinned: faster-whisper's
 * `WhisperModel('small')` would call `snapshot_download` at `main` on the
 * first press (asr.py as it was). So each model is a press of its own, "Get
 * the speech model · 464 MB", on the button's own label before anything is
 * fetched (§0's click rule), pinned to one commit of its repository, and
 * `asr.transcribe` answers `unavailable` with `SPEECH_MODEL_NOT_DOWNLOADED`
 * while the chosen model is not on disk; the greyed Transcribe's title says
 * `NEEDS_SPEECH_MODEL`. Choosing a model never downloads it.
 *
 * `SPEECH_MODELS` is asr.py's `MODELS` for the window: the same names,
 * repositories, commits, files and sizes, which tests/speechModelTable.test.ts
 * holds equal, plus what only the window shows (the label and the hint).
 *
 * Pure: no disk, no electron, no node.
 */

import { formatBytes } from '../assets/pack'
import type { ModelStatus } from '../sidecar/protocol'

/** The three, by the protocol's names (`params.model`, asr.py `MODELS`). */
export const SPEECH_MODEL_NAMES = ['small', 'medium', 'large-v3'] as const
export type SpeechModelName = (typeof SPEECH_MODEL_NAMES)[number]

/** The model when none is named or the setting holds no model's name: the one there was before the choice. */
export const DEFAULT_SPEECH_MODEL: SpeechModelName = 'small'

export interface SpeechModelPin {
  name: SpeechModelName
  /** On screen: "Small", "Medium", "Large". */
  label: string
  /** One honest hint in plain words; no claim about any one language. */
  hint: string
  repo: string
  /** A commit, never `main`. */
  revision: string
  /** Each file asr.py fetches, in its order, with its size at `revision`. */
  files: readonly (readonly [string, number])[]
  /** The files' sum: what the press names through formatBytes. */
  bytes: number
}

function pin(p: Omit<SpeechModelPin, 'bytes'>): SpeechModelPin {
  return { ...p, bytes: p.files.reduce((sum, [, size]) => sum + size, 0) }
}

/** asr.py `MODELS`, read from huggingface.co's API (small 2026-10-16; medium and large-v3 2026-11-20). */
export const SPEECH_MODELS: readonly SpeechModelPin[] = [
  pin({
    name: 'small',
    label: 'Small',
    hint: 'fastest',
    repo: 'Systran/faster-whisper-small',
    revision: '536b0662742c02347bc0e980a01041f333bce120',
    files: [
      ['config.json', 2_370],
      ['vocabulary.txt', 459_861],
      ['tokenizer.json', 2_203_239],
      ['model.bin', 483_546_902]
    ]
  }),
  pin({
    name: 'medium',
    label: 'Medium',
    hint: 'more accurate, slower',
    repo: 'Systran/faster-whisper-medium',
    revision: '08e178d48790749d25932bbc082711ddcfdfbc4f',
    files: [
      ['config.json', 2_257],
      ['vocabulary.txt', 459_861],
      ['tokenizer.json', 2_203_239],
      ['model.bin', 1_527_906_378]
    ]
  }),
  pin({
    name: 'large-v3',
    label: 'Large',
    hint: 'most accurate, slowest',
    repo: 'Systran/faster-whisper-large-v3',
    revision: 'edaa852ec7e145841d8ffdb056a99866b5f0a478',
    files: [
      // large-v3 takes 128 mel bins: without this file the feature extractor's 80 would be used.
      ['preprocessor_config.json', 340],
      ['config.json', 2_394],
      ['vocabulary.json', 1_068_114],
      ['tokenizer.json', 2_480_617],
      ['model.bin', 3_087_284_237]
    ]
  })
]

/** Whether `value` is one of the three names, exactly. */
export function isSpeechModelName(value: unknown): value is SpeechModelName {
  return typeof value === 'string' && (SPEECH_MODEL_NAMES as readonly string[]).includes(value)
}

/** The setting's guard: one of the three names, and anything else (missing, mistyped, an old file) read as 'small'. */
export function speechModelName(value: unknown): SpeechModelName {
  return isSpeechModelName(value) ? value : DEFAULT_SPEECH_MODEL
}

/** The pin of a model by its name. */
export function speechModelPin(name: SpeechModelName): SpeechModelPin {
  const found = SPEECH_MODELS.find((m) => m.name === name)
  if (!found) throw new Error(`There is no speech model "${name}"`)
  return found
}

/**
 * The key of the choice in the settings file's window half (main/store.ts
 * `rest`, written by `setSetting`, read by `getSettings`): one app-wide
 * setting, default 'small'. Main reads it through `speechModelName` for
 * `asr.model` and `asr.transcribe`; `settings:set` refuses any other value
 * for it.
 */
export const SPEECH_MODEL_SETTING = 'speechModel'

/** The download's name on screen (`ModelStatus.label`), the same for all three. */
export const SPEECH_MODEL_LABEL = 'the speech model'

/** The host the press asks (`ModelStatus.host`); the rule for a restricted network is huggingface.co and *.hf.co (docs/SIDECAR.md). */
export const SPEECH_MODEL_HOST = 'huggingface.co'

/** The greyed Transcribe's reason while the model is not on disk, and the census row's text. */
export const NEEDS_SPEECH_MODEL = 'needs the speech model'

/**
 * What the helper itself answers `asr.transcribe` with while the model is not
 * on disk (asr.py `NOT_DOWNLOADED`, its `Unavailable`; main passes it through
 * unchanged): a press that finds the model gone since it was asked rejects
 * with it, and the store asks again on hearing it, so the sized press comes
 * back. tests/speechModelIpc.test.ts holds it equal to asr.py's.
 */
export const SPEECH_MODEL_NOT_DOWNLOADED = 'The speech model is not downloaded yet'

/** A press for one model while another's fetch is in flight: main fetches one model at a time. */
export const SPEECH_MODEL_BUSY = 'Another speech model is downloading. Stop it first, or wait for it to finish'

/** The helper's method for the status and the fetch (ModelParams → ModelStatus), registered beside `asr.transcribe`. */
export const SPEECH_MODEL_METHOD = 'asr.model'

/** The IPC channels between the window and main. */
export const SPEECH_MODEL_CHANNELS = {
  /** `{ download?: boolean, model?: SpeechModelName }` → SpeechModelStatus; `download: true` only from the press that showed the size; no model = the chosen one. */
  model: 'asr:model',
  /** SpeechModelProgress while a fetch runs. */
  progress: 'asr:modelProgress',
  /** The press's X: cancels the fetch in flight (the helper stops at its next chunk); nothing when none runs. */
  cancel: 'asr:modelCancel'
} as const

/** The X beside "Getting the speech model… N%": its title. */
export const STOP_SPEECH_MODEL = 'Stop getting the speech model'

/** `asr.model`'s answer: a ModelStatus, and which model it is about. */
export interface SpeechModelStatus extends ModelStatus {
  model: SpeechModelName
}

export interface SpeechModelProgress {
  /** 0–1, or null while the size is not yet known. */
  progress: number | null
  message?: string
  /** The model being fetched; main always sends it. */
  model?: SpeechModelName
}

/** The press's label: "Get the speech model · 464 MB", from the status's bytes. */
export function speechModelLabel(status: Pick<ModelStatus, 'bytes'>): string {
  return `Get ${SPEECH_MODEL_LABEL} · ${formatBytes(status.bytes)}`
}

/**
 * `asr:model`'s payload, checked where the renderer's data crosses into main:
 * `{ download?: boolean, model?: SpeechModelName }` or nothing. `download` is
 * true only when the renderer sent exactly `true` (the press); anything else
 * in its place is refused rather than read as a status ask, so a mistyped
 * press says so. `model`, when sent, must be one of the three, else refused by
 * its name; omitted, it stays omitted (main reads the choice).
 */
export function speechModelRequest(payload: unknown): { download: boolean; model?: SpeechModelName } {
  if (payload === undefined || payload === null) return { download: false }
  if (typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Getting the speech model expects {download?, model?}')
  const { download, model } = payload as Record<string, unknown>
  if (download !== undefined && typeof download !== 'boolean') throw new Error('Getting the speech model expects download to be true or false')
  if (model !== undefined && !isSpeechModelName(model)) {
    throw new Error(`Getting the speech model expects one of ${SPEECH_MODEL_NAMES.join(', ')}, not ${JSON.stringify(model)}`)
  }
  return model === undefined ? { download: download === true } : { download: download === true, model }
}
