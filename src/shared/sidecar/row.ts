/**
 * The AI helper's row in Settings (docs/CLIPS.md §3a.4), and the header's dot,
 * which is the same reading: what the status, the job list and the manifest
 * say, in the row's words, with the presses it offers and each press's size.
 *
 * One function so the gear's dot and the row cannot disagree, and so a bare
 * interpreter is never green: the dot comes from hello's capabilities, the
 * install's self-test and its integrity check, never from a process being up.
 *
 * Every size here goes through `formatBytes` from what the status's offer or
 * the manifest says, never a number written down: the pack's bytes change
 * whenever its lock does.
 *
 * Pure: no disk, no electron, no node. On screen the process is "the AI
 * helper"; the code's name for it never reaches a sentence here.
 */

import { formatBytes } from '../assets/pack'
import type { Job } from '../types'
import { SIDECAR_METHODS, type ModelStatus } from './protocol'
import { helperCan } from './helperCan'
import { helperSourceLabel, type HelperSource } from './helperPython'
import { HELPER_PRESET, HELPER_REPAIRED_ELSEWHERE, helperJobKind, helperJobLabel, type HelperJobKind } from './install'
import { packBytes, packHosts, type HelperPackManifest, type PackPlatform } from './pack'
import { degradedBySelftest, helperFeatureCount, VCRUNTIME_SENTENCE } from './selftest'
import type { PackOffer, SidecarStatus } from './status'
import { SPEECH_MODEL_LABEL, speechModelLabel, type SpeechModelProgress } from '../asr/speechModel'

export type HelperDot = 'grey' | 'green' | 'red'

export type HelperActionKind = 'install' | 'repair' | 'update' | 'remove' | 'checkAgain'

export interface HelperAction {
  kind: HelperActionKind
  /** The button's words, its size on it: "Install the AI helper · 170 MB", "Repair · 205 MB". */
  label: string
  /** Why it cannot be pressed now, said on its title: a helper job is running. */
  disabled?: string
}

export interface HelperRow {
  /** The state, first on the row: "Running", "Not installed", "Not running"… */
  word: string
  dot: HelperDot
  /** What follows the word after " · ": "Python 3.14.8 · pack 1 · 644 MB", "6 of 8 helper features · …". */
  line?: string
  /** The sentences under it, each its own line: the hosts, the Visual C++ runtime's, each integrity problem. */
  detail?: string[]
  actions: HelperAction[]
  /** The hosts a restricted network must allow, under an Install, Update or Repair that downloads (§16.40). */
  hosts?: string[]
}

/** This machine's pack in the manifest: what the ready and failed rows name, whose statuses carry no offer. */
export interface PackFacts {
  /** Every name the self-test must see registered (`expects`): "N of <its length> helper features". */
  expects: readonly string[]
  /** Every byte a press fetches (`packBytes`). */
  bytes: number
  /** The pack on disk once installed. */
  bytesOnDisk: number
  hosts: string[]
}

/** A helper job in the job list, as the row names it. */
export interface HelperJob {
  kind: HelperJobKind
  /** The speed column's words as main sends them, or the queue's. */
  stage: string
}

export interface HelperRowInput {
  /** null until main has answered. */
  status: SidecarStatus | null
  pack: PackFacts
  job: HelperJob | null
}

/* ----------------------------------------------------------- the words */

/** The row's words by state. Whole literals, so the census can find each on screen. */
export const ROW_WORDS = {
  starting: 'Starting',
  installing: 'Installing',
  repairing: 'Repairing',
  updating: 'Updating',
  running: 'Running',
  notInstalled: 'Not installed',
  needsUpdate: 'Needs an update',
  notRunning: 'Not running',
  unavailable: 'Not available on this computer'
} as const

/** Under a running job's row: its bar and its X are not here (§3a.4: no second cancel). */
export const JOB_IN_EXPORT = 'Its bar and its X are in EXPORT.'

/** Under the env rung's Install (§16.42 (b)): in an installed app the pack comes before FORGE_PYTHON. */
export const INSTEAD_OF_FORGE_PYTHON = 'used instead of FORGE_PYTHON once installed'

/** Under Update (§16.46 (a)). */
export const OLD_PACK_UNUSED = 'The AI helper on this computer is from an older version of the app, and is not used until it is updated.'

/**
 * Under a running helper's model list (§16.40 (d), answered "for the beta",
 * §3a.5 "Three network stacks"): the models come through the helper's own
 * fetchers, not main's, and huggingface_hub reads a proxy only from the
 * environment, so behind a system-set proxy the pack can install and a model
 * press still fail. Until those fetches move to main's network stack, the row
 * says so.
 */
export const MODEL_PRESSES_NETWORK =
  'Each model downloads on its own press, from huggingface.co and *.hf.co, or storage.googleapis.com for the face finder. Those presses need a direct connection, or a proxy set in HTTPS_PROXY.'

/** The queue's words for a helper job not yet started. */
export const JOB_WAITING = 'waiting to start'

/** A running job's stage before its first speed report. */
export const JOB_STARTING = 'starting'

/** The redirect host GitHub answers a release URL with (measured, §3a.1); `packHosts` adds it. */
const REDIRECT_HOST = 'release-assets.githubusercontent.com'

/**
 * "Uses about 644 MB on disk. Downloads from github.com (and the host it
 * redirects to, today release-assets.githubusercontent.com) and
 * files.pythonhosted.org. Its own Python; any Python on this machine is left
 * alone." From the offer's (or the manifest's) numbers and hosts.
 */
export function hostsSentence(bytesOnDisk: number, hosts: readonly string[]): string {
  const redirects = hosts.includes(REDIRECT_HOST)
  const named = hosts
    .filter((h) => !(redirects && h === REDIRECT_HOST && hosts.includes('github.com')))
    .sort((a, b) => (a === 'github.com' ? -1 : b === 'github.com' ? 1 : a.localeCompare(b)))
    .map((h) => (h === 'github.com' && redirects ? `github.com (and the host it redirects to, today ${REDIRECT_HOST})` : h))
  const list = named.length <= 1 ? (named[0] ?? '') : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
  return `Uses about ${formatBytes(bytesOnDisk)} on disk. Downloads from ${list}. Its own Python; any Python on this machine is left alone.`
}

/* ------------------------------------------------------------ the sizes */

/** What a press of this offer fetches: what is left when the service read `downloads/`, else every byte. */
function offerFetch(offer: Extract<PackOffer, { supported: true }>): { bytes: number; partial: boolean } {
  const left = offer.bytesLeft
  if (typeof left === 'number' && Number.isFinite(left) && left >= 0 && left < offer.bytes) return { bytes: left, partial: true }
  return { bytes: offer.bytes, partial: false }
}

function installLabel(fetch: { bytes: number; partial: boolean }): string {
  return fetch.partial ? `Install the AI helper · ${formatBytes(fetch.bytes)} left` : `Install the AI helper · ${formatBytes(fetch.bytes)}`
}

function updateLabel(bytes: number): string {
  return `Update the AI helper · ${formatBytes(bytes)}`
}

function repairLabel(bytes: number): string {
  return `Repair · ${formatBytes(bytes)}`
}

/**
 * Repair's number beside a pack that has no offer (ready, or failed): the
 * manifest's bytes, less the verified files a cancelled or failed Repair
 * left in `downloads/` when the status says so (`bytesLeft`, §3a.4 "Repair's
 * number", §16.47).
 */
function packRepairBytes(pack: PackFacts, left: number | undefined): number {
  return typeof left === 'number' && Number.isFinite(left) && left >= 0 && left < pack.bytes ? left : pack.bytes
}

const REMOVE: HelperAction = { kind: 'remove', label: 'Remove' }
const CHECK_AGAIN: HelperAction = { kind: 'checkAgain', label: 'Check again' }

/* --------------------------------------------------------- the reasons */

/** The Visual C++ reason's head for the row's line ("beats needs Microsoft's Visual C++ runtime"); the whole sentence, with its link, goes under. */
function headOf(reason: string): string {
  const at = reason.indexOf(VCRUNTIME_SENTENCE)
  if (at === -1) return reason
  const dash = VCRUNTIME_SENTENCE.indexOf(' — ')
  return reason.slice(0, at + (dash === -1 ? VCRUNTIME_SENTENCE.length : dash)).trim()
}

/**
 * Why a ready helper is short of its features, in order: each `expects`
 * method not registered, degraded, or failed by its self-test group, then a
 * failed group no method stands for (sklearn, run for what it would mask).
 * Each sentence once.
 */
function shortfall(status: Extract<SidecarStatus, { state: 'ready' }>, expects: readonly string[]): string[] {
  const reasons: string[] = []
  const add = (reason: string): void => {
    if (!reasons.includes(reason)) reasons.push(reason)
  }
  const failed = status.selftest ? degradedBySelftest(status.selftest) : {}
  for (const method of expects) {
    const degraded = status.hello.degraded?.[method]
    if (degraded !== undefined) add(degraded)
    else if (failed[method] !== undefined) add(failed[method])
    else if (!status.hello.capabilities.includes(method)) add(`the AI helper has no ${method}`)
  }
  for (const reason of Object.values(status.selftest ?? {})) if (reason !== 'ok') add(reason)
  return reasons
}

/* -------------------------------------------------------------- the row */

/**
 * §3a.4's table, row by row. A helper job in the list comes first: its stage
 * is the row's line, and every press waits for it, with its reason.
 */
export function helperRow(input: HelperRowInput): HelperRow {
  const row = statusRow(input.status, input.pack)
  if (!input.job) return row
  const busy = `${helperJobLabel(input.job.kind)} — its bar and its X are in EXPORT`
  const word = input.job.kind === 'repair' ? ROW_WORDS.repairing : input.job.kind === 'update' ? ROW_WORDS.updating : ROW_WORDS.installing
  return {
    word,
    dot: 'grey',
    line: input.job.stage,
    detail: [JOB_IN_EXPORT],
    actions: row.actions.map((action) => ({ ...action, disabled: busy })),
    ...(row.hosts ? { hosts: row.hosts } : {})
  }
}

function statusRow(status: SidecarStatus | null, pack: PackFacts): HelperRow {
  if (status === null) return { word: ROW_WORDS.starting, dot: 'grey', actions: [] }
  switch (status.state) {
    case 'starting':
      return { word: ROW_WORDS.starting, dot: 'grey', ...(status.source ? { line: helperSourceLabel(status.source) } : {}), actions: [] }
    case 'installing':
      return { word: ROW_WORDS.installing, dot: 'grey', line: status.stage, detail: [JOB_IN_EXPORT], actions: [] }
    case 'absent':
      return absentRow(status.offer)
    case 'damaged':
      return damagedRow(status.reason, status.offer)
    case 'failed':
      return failedRow(status.error, status.source, pack, status.bytesLeft)
    case 'ready':
      return readyRow(status, pack)
    default: {
      const unknown: never = status
      return unknown
    }
  }
}

/** No pack to run: Install, or Update over an older one; never red, it is every tester's first state. */
function absentRow(offer: PackOffer): HelperRow {
  if (!offer.supported) return { word: ROW_WORDS.unavailable, dot: 'grey', line: offer.reason, actions: [] }
  const fetch = offerFetch(offer)
  const hosts = hostsSentence(offer.bytesOnDisk, offer.hosts)
  if (offer.kind === 'update') {
    return {
      word: ROW_WORDS.needsUpdate,
      dot: 'grey',
      detail: [OLD_PACK_UNUSED, hosts],
      actions: [{ kind: 'update', label: updateLabel(fetch.bytes) }],
      hosts: offer.hosts
    }
  }
  if (offer.kind === 'repair') {
    return {
      word: ROW_WORDS.notInstalled,
      dot: 'grey',
      detail: [hosts],
      actions: [{ kind: 'repair', label: repairLabel(fetch.bytes) }],
      hosts: offer.hosts
    }
  }
  return {
    word: ROW_WORDS.notInstalled,
    dot: 'grey',
    detail: [hosts],
    actions: [{ kind: 'install', label: installLabel(fetch) }],
    hosts: offer.hosts
  }
}

/** A receipt that does not parse, or a pack whose Python is gone: red, and Repair, never Install over 0.7 GB on disk. */
function damagedRow(reason: string, offer: PackOffer): HelperRow {
  if (!offer.supported) return { word: ROW_WORDS.notRunning, dot: 'red', line: reason, actions: [] }
  const fetch = offerFetch(offer)
  return {
    word: ROW_WORDS.notRunning,
    dot: 'red',
    line: reason,
    detail: [hostsSentence(offer.bytesOnDisk, offer.hosts)],
    actions: [{ kind: 'repair', label: repairLabel(fetch.bytes) }, REMOVE],
    hosts: offer.hosts
  }
}

/**
 * A helper that will not start, or keeps crashing: red, with main's sentence
 * (a spawn Windows' policy refused is `HELPER_BLOCKED_BY_POLICY`). A pack
 * another window is repairing is grey and offers nothing. A pack's is Repair
 * first; someone's own FORGE_PYTHON gets the Install that replaces it; a
 * development rung, nothing.
 */
function failedRow(error: string, source: HelperSource | undefined, pack: PackFacts, left?: number): HelperRow {
  // Another Forge window holds the pack's lock (§16.53 (a)): nothing is wrong with this one, and every press would be refused.
  if (error === HELPER_REPAIRED_ELSEWHERE) return { word: ROW_WORDS.notRunning, dot: 'grey', line: error, actions: [] }
  const base = { word: ROW_WORDS.notRunning, dot: 'red' as const, line: error }
  // A status with no source (the harness bridge's) names no rung: nothing to press.
  if (source?.kind === 'pack') {
    // Repair is the way out here, and it downloads: its hosts under it (§16.40 (a)), as under a damaged pack's.
    return {
      ...base,
      detail: [hostsSentence(pack.bytesOnDisk, pack.hosts)],
      actions: [{ kind: 'repair', label: repairLabel(packRepairBytes(pack, left)) }, REMOVE],
      hosts: pack.hosts
    }
  }
  if (source?.kind === 'env') {
    return {
      ...base,
      detail: [INSTEAD_OF_FORGE_PYTHON, hostsSentence(pack.bytesOnDisk, pack.hosts)],
      actions: [{ kind: 'install', label: installLabel({ bytes: pack.bytes, partial: false }) }],
      hosts: pack.hosts
    }
  }
  return { ...base, actions: [] }
}

function readyRow(status: Extract<SidecarStatus, { state: 'ready' }>, pack: PackFacts): HelperRow {
  const count = helperFeatureCount(pack.expects, status.hello, status.selftest)
  const features = `${count.ok} of ${count.total} helper features`
  const integrity = (status.integrity ?? []).filter((p) => typeof p === 'string' && p.trim() !== '')
  const reasons = shortfall(status, pack.expects)
  const groupsOk = Object.values(status.selftest ?? {}).every((reason) => reason === 'ok')
  // Green only with every expected method registered and usable, every group ok and nothing outside the pack.
  const whole = count.total > 0 && count.ok === count.total && groupsOk && integrity.length === 0
  const source = status.source

  if (source.kind === 'pack') {
    const repair: HelperAction = { kind: 'repair', label: repairLabel(packRepairBytes(pack, status.bytesLeft)) }
    if (integrity.length > 0) {
      // Repair is what the warning offers, and it downloads: its hosts under it (§16.40 (a)).
      return {
        word: ROW_WORDS.running,
        dot: 'grey',
        line: `${features} · ${integrity[0]}`,
        detail: [...integrity, ...reasons, hostsSentence(pack.bytesOnDisk, pack.hosts)],
        actions: [repair, REMOVE],
        hosts: pack.hosts
      }
    }
    if (!whole) {
      return {
        word: ROW_WORDS.running,
        dot: 'grey',
        line: reasons.length > 0 ? `${features} · ${headOf(reasons[0])}` : features,
        ...(reasons.length > 0 ? { detail: reasons } : {}),
        actions: [CHECK_AGAIN, repair, REMOVE],
        hosts: pack.hosts
      }
    }
    return {
      word: ROW_WORDS.running,
      dot: 'green',
      line: `Python ${status.hello.python} · pack ${source.pack} · ${formatBytes(pack.bytesOnDisk)}`,
      actions: [repair, REMOVE],
      hosts: pack.hosts
    }
  }

  const dot: HelperDot = whole ? 'green' : 'grey'
  const detail = [...integrity, ...reasons]
  if (source.kind === 'env') {
    // In an installed app the pack comes before FORGE_PYTHON (§16.42 (b)): Install stays.
    return {
      word: ROW_WORDS.running,
      dot,
      line: `${helperSourceLabel(source)} · ${features}`,
      detail: [...detail, INSTEAD_OF_FORGE_PYTHON, hostsSentence(pack.bytesOnDisk, pack.hosts)],
      actions: [{ kind: 'install', label: installLabel({ bytes: pack.bytes, partial: false }) }],
      hosts: pack.hosts
    }
  }
  // The venv and PATH rungs are development's only: no presses.
  return {
    word: ROW_WORDS.running,
    dot,
    line: whole ? helperSourceLabel(source) : `${helperSourceLabel(source)} · ${features}`,
    ...(detail.length > 0 ? { detail } : {}),
    actions: []
  }
}

/* ------------------------------------------------------------ the inputs */

/**
 * The helper job the row names: the first queued or running job with
 * presetId 'helper'. Read from the job list because `installing` is
 * broadcast only while no helper is up, and a Repair runs beside one.
 */
export function helperJobFrom(jobs: readonly Pick<Job, 'presetId' | 'status' | 'speed' | 'params'>[]): HelperJob | null {
  const job = jobs.find((j) => j.presetId === HELPER_PRESET && j.status === 'running') ?? jobs.find((j) => j.presetId === HELPER_PRESET && j.status === 'queued')
  if (!job) return null
  const stage = job.status === 'queued' ? JOB_WAITING : job.speed && job.speed.trim() !== '' ? job.speed : JOB_STARTING
  return { kind: helperJobKind(job.params), stage }
}

/**
 * This window's pack in the manifest, by the renderer's `navigator.platform`
 * ('MacIntel' on every Mac Chromium runs on, 'Win32' on Windows): the app
 * ships an arm64 Mac build and an x64 Windows build, and a machine with no
 * pack has an unsupported offer, so the guess is never what decides a row.
 */
export function packFactsFor(manifest: HelperPackManifest, navigatorPlatform: string): PackFacts {
  const platform: PackPlatform = /^win/i.test(navigatorPlatform) ? 'win32-x64' : 'darwin-arm64'
  const pack = manifest.platforms[platform]
  return { expects: pack.expects, bytes: packBytes(pack), bytesOnDisk: pack.bytesOnDisk, hosts: packHosts(pack) }
}

/* ------------------------------------------------------- the speech model */

/** The speech model's line in the row's model list: on this machine with its size, being fetched, or the sized press. */
export type SpeechRow = { text: string; get?: undefined } | { text: string; get: string }

/** "Speech model · 464 MB · on this machine", "Getting the speech model… 42%", or the press "Get the speech model · 464 MB". null while it cannot be asked or has not answered. */
export function speechModelRow(speech: ModelStatus | null, canTranscribe: boolean, fetching: SpeechModelProgress | null): SpeechRow | null {
  if (!canTranscribe) return null
  if (fetching) return { text: `Getting ${SPEECH_MODEL_LABEL}…${typeof fetching.progress === 'number' ? ` ${Math.round(fetching.progress * 100)}%` : ''}` }
  if (!speech) return null
  if (speech.present) return { text: `Speech model · ${formatBytes(speech.bytes)} · on this machine` }
  return { text: 'Speech model', get: speechModelLabel(speech) }
}

/* ---------------------------------------------------------- the refusals */

/**
 * A rejected press's sentence as main wrote it. Electron's `invoke` rejects
 * with "Error invoking remote method '<channel>': Error: <message>"; the row
 * shows the message (HELPER_WORKING, HELPER_BUSY, HELPER_IN_USE_ELSEWHERE…),
 * and anything else unchanged.
 */
export function helperErrorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/, '')
}

/* ---------------------------------------------------------- Transcribe */

/**
 * Where Transcribe stands (docs/CLIPS.md §3a.4, §16.49): `ready` only when the
 * helper can `asr.transcribe` AND the speech model is on disk, so a press
 * never fetches 464 MB unnamed; `no-model` when only the model is missing
 * (the sized press stands beside it); `starting` before main has answered or
 * while a helper starts; `no-helper` for everything else, an install running
 * included (as the reframe's `missing`).
 */
export type TranscribeGate = 'ready' | 'no-model' | 'starting' | 'no-helper'

export function transcribeGate(status: SidecarStatus | null, speech: Pick<ModelStatus, 'present'> | null): TranscribeGate {
  if (helperCan(status, SIDECAR_METHODS.transcribe)) return speech?.present === true ? 'ready' : 'no-model'
  if (status === null || status.state === 'starting') return 'starting'
  return 'no-helper'
}
