/**
 * The AI helper's install job — the pure half (docs/CLIPS.md §3a.3): the
 * stage table and its bar, the speed column's words, the job row's label, the
 * free-space rule, what is left to fetch, the IPC payloads, and the launch
 * sweep's rules. The job itself is `src/main/sidecar/install.ts`.
 *
 * Pure: no disk, no electron, no node. Shared, so main, the preload, the
 * EXPORT strip and the tests name one set of stages and one wording. On
 * screen the process is "the AI helper"; the code's name for it never
 * reaches a sentence here.
 */

import { packBytes, type HelperPackManifest, type PackPlatform } from './pack'

/* ------------------------------------------------------------- the job row */

/** The job list's presetId for an install, a Repair or an Update (§3a.4 "The EXPORT row"). */
export const HELPER_PRESET = 'helper'

/** The job's `inputName`: what it works on. The row's words are `helperJobLabel`'s. */
export const HELPER_JOB_INPUT = 'the AI helper'

export type HelperJobKind = 'install' | 'repair' | 'update'

/** The EXPORT row's words for a helper job. */
export function helperJobLabel(kind: HelperJobKind): string {
  switch (kind) {
    case 'install':
      return 'Installing the AI helper'
    case 'repair':
      return 'Repairing the AI helper'
    case 'update':
      return 'Updating the AI helper'
    default: {
      const unknown: never = kind
      return unknown
    }
  }
}

/** The kind a helper job's `params.kind` names; an install when it names none. */
export function helperJobKind(params: Record<string, unknown> | undefined): HelperJobKind {
  const kind = params?.kind
  return kind === 'repair' || kind === 'update' ? kind : 'install'
}

/* -------------------------------------------------------------- the stages */

/**
 * The stages and their share of the bar (§3a.3 "The stages"), set from the
 * first measured install (§3a.8 row 27, the M1 Pro, 2026-10-14,
 * tests/integration/helperPack.int.test.ts): the download 6.0 s at
 * 28 MiB/s, the unpack and the stdlib compile 2.8 s, pip 11.4 s, and the
 * check 37–39 s (a cold first hello of 11–14 s, then a cold self-test of
 * about 25 s, beats alone 20–21 s). The placeholders (70 / 5 / 20 / 5) left
 * the bar at 95–100 % for 37 of the install's 57 s. At the plan's example
 * line of 4.2 MB/s the download is 40 s of about 92 s, so: 45 / 5 / 15 / 35.
 * The Surface's row 27 may move them again. Checking takes no share: it is
 * a statfs, a lock and a few stats.
 */
export const INSTALL_STAGES = [
  { label: 'Checking', from: 0, to: 0 },
  { label: 'Downloading', from: 0, to: 0.45 },
  { label: 'Unpacking', from: 0.45, to: 0.5 },
  { label: 'Installing the libraries', from: 0.5, to: 0.65 },
  { label: 'Checking the AI helper', from: 0.65, to: 1 }
] as const

export type InstallStage = 0 | 1 | 2 | 3 | 4

/**
 * The bar for `fraction` (0..1, clamped) of `stage`. Each stage starts where
 * the one before it ends, so the bar never goes down as the job moves on.
 */
export function installProgress(stage: InstallStage, fraction: number): number {
  const { from, to } = INSTALL_STAGES[stage]
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  return from + (to - from) * f
}

/* ------------------------------------------------------ the speed column */

export const CHECKING_SPACE = 'checking space'
export const UNPACKING_PYTHON = 'unpacking Python'
export const CHECKING_THE_HELPER = 'checking the AI helper'
/**
 * Stage 4 until the new pack's first hello is back: the longest stand of a
 * real install after beats (11.3–14.4 s cold on the M1 Pro, §3a.8 row 27),
 * so the column says why the bar is still.
 */
export const CHECKING_STARTING = 'checking the AI helper · starting (the first start is slow)'
export const WAITING_FOR_THE_HELPER = "waiting for the AI helper's work to finish"

/** Stage 4 while a self-test group runs: "checking the AI helper · beats" (`PackCheckOptions.onGroup`). */
export function checkingGroupText(group: string): string {
  return `${CHECKING_THE_HELPER} · ${group}`
}

/**
 * The job's last speed text when the check found integrity problems
 * (§16.51): the pack is kept and runs, and the first problem is named. The
 * queue clears the column once the job is done; the lasting record is the
 * receipt's `integrity`, which the ready status carries to the row.
 */
export function keptWithWarningText(integrity: readonly string[]): string | null {
  return integrity.length > 0 ? `installed with a warning · ${integrity[0]}` : null
}

const MIB = 1024 * 1024

/** The unit `formatBytes` (shared/assets/pack.ts) would write `total` in, so "31 of 205 MB" never mixes two. */
function unitOf(total: number): { div: number; unit: string; digits: number } {
  if (total < 1024) return { div: 1, unit: 'B', digits: 0 }
  if (total < MIB) return { div: 1024, unit: 'KB', digits: 0 }
  if (total < 1024 * MIB) return { div: MIB, unit: 'MB', digits: 0 }
  return { div: 1024 * MIB, unit: 'GB', digits: 1 }
}

/**
 * "downloading · 31 of 205 MB · 4.2 MB/s": bytes over every file of the
 * pack, in `formatBytes`' unit (MiB, written MB, as the button writes the
 * size); the speed only once there is one.
 */
export function downloadingText(done: number, total: number, bytesPerSecond: number | null): string {
  const { div, unit, digits } = unitOf(total)
  const of = `${(Math.min(done, total) / div).toFixed(digits)} of ${(total / div).toFixed(digits)} ${unit}`
  const speed = bytesPerSecond !== null && Number.isFinite(bytesPerSecond) && bytesPerSecond > 0 ? ` · ${(bytesPerSecond / MIB).toFixed(1)} MB/s` : ''
  return `downloading · ${of}${speed}`
}

/** "installing libraries · 12 of 48": pip's dist-info folders against the lock's lines. */
export function installingText(done: number, total: number): string {
  return `installing libraries · ${Math.min(done, total)} of ${total}`
}

/* --------------------------------------------------------- the refusals */

/**
 * Install, Repair, Remove and Update refuse with this while another live
 * app instance holds `<root>/.lock` or has the pack in use (§3a.3 "Across
 * app instances", §16.50 (a)).
 */
export const HELPER_IN_USE_ELSEWHERE = 'The AI helper is in use by another Forge window'

/**
 * What a helper start from a pack is refused with while another live Forge
 * window holds `<root>/.lock` (§16.53 (a)): its Repair or Remove may be about
 * to delete the folder this start would run from. Broadcast as `failed`, so
 * the row offers no Install meanwhile, and asked again at the next start.
 */
export const HELPER_REPAIRED_ELSEWHERE = 'The AI helper is being repaired by another Forge window'

/** A second install, Repair or Remove in this window while one is running. */
export const HELPER_BUSY = 'The AI helper is already being installed, repaired or removed'

/** Remove pressed while the helper has work out (§3a.3 "All three refuse while helper work is running"): nothing is cut off. */
export const HELPER_WORKING = 'The AI helper is working; remove it once that work has finished'

/** What every helper caller is told while Repair holds the helper stopped (`HelperControl.hold`). */
export const HELPER_BEING_REPAIRED = 'The AI helper is being repaired'

/** Likewise while an Update replaces the pack in its own folder (a lock changed without a new number, §3a.2). */
export const HELPER_BEING_UPDATED = 'The AI helper is being updated'

/** Likewise while Remove deletes it. */
export const HELPER_BEING_REMOVED = 'The AI helper is being removed'

/* ----------------------------------------------------------- free space */

/** What the install needs free: what is left to fetch, the pack on disk, and 10 % (§3a.3 stage 0). */
export function spaceNeeded(bytesLeftToFetch: number, bytesOnDisk: number): number {
  return Math.ceil((Math.max(0, bytesLeftToFetch) + Math.max(0, bytesOnDisk)) * 1.1)
}

/** Gigabytes with one decimal, as `formatBytes` writes them (1024³). */
function gb(bytes: number): string {
  return `${(Math.max(0, bytes) / (1024 * MIB)).toFixed(1)} GB`
}

/**
 * The volume a path is on, as the sentence names it: `C:` (or a UNC share)
 * on Windows; elsewhere, where there are no drive letters, "this disk".
 */
export function driveLabel(path: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    const letter = /^([A-Za-z]:)/.exec(path)
    if (letter) return letter[1].toUpperCase()
    const share = /^[\\/]{2}([^\\/]+)[\\/]([^\\/]+)/.exec(path)
    if (share) return `\\\\${share[1]}\\${share[2]}`
  }
  return 'this disk'
}

/** "The AI helper needs 0.8 GB free on C: (0.3 GB is free)". */
export function spaceSentence(needed: number, free: number, drive: string): string {
  return `The AI helper needs ${gb(needed)} free on ${drive} (${gb(free)} is free)`
}

/* ------------------------------------------------------- what is left */

/**
 * What a press still has to fetch: every file of the platform's pack, less
 * the ones already in `downloads/<n>/` (§3a.4 "· N MB left", §16.47).
 *
 * `present` is each file's name there and its size on disk. A file is counted
 * only when its size is the manifest's: the fetcher renames a `.part` to the
 * file's own name only once its bytes and sha256 are the file's, so a file
 * under its own name with its own size is a verified one, and anything else
 * is fetched again.
 */
export function bytesLeft(manifest: HelperPackManifest, platform: PackPlatform, present: Readonly<Record<string, number>>): number {
  const pack = manifest.platforms[platform]
  let left = packBytes(pack)
  for (const file of [pack.interpreter, ...pack.wheels]) {
    if (present[file.name] === file.bytes) left -= file.bytes
  }
  return left
}

/* -------------------------------------------------------------- the IPC */

export const HELPER_CHANNELS = {
  install: 'helper:install',
  remove: 'helper:remove',
  checkAgain: 'helper:checkAgain'
} as const

export interface HelperInstallRequest {
  repair?: boolean
  update?: boolean
}

/** `helper:install`'s payload, re-validated in main: nothing, or `{repair?, update?}` booleans, never both. */
export function helperInstallRequest(payload: unknown): HelperInstallRequest {
  if (payload === undefined || payload === null) return {}
  if (typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Installing the AI helper expects {repair?, update?}')
  const { repair, update } = payload as Record<string, unknown>
  if (repair !== undefined && typeof repair !== 'boolean') throw new Error('Installing the AI helper expects repair to be true or false')
  if (update !== undefined && typeof update !== 'boolean') throw new Error('Installing the AI helper expects update to be true or false')
  if (repair && update) throw new Error('Installing the AI helper is a Repair or an Update, not both')
  return { ...(repair ? { repair: true } : {}), ...(update ? { update: true } : {}) }
}

/** `helper:remove`'s payload: `{models}`, a boolean the confirm's box sets (off by default, §16.47). */
export function helperRemoveRequest(payload: unknown): { models: boolean } {
  const models = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>).models : undefined
  if (typeof models !== 'boolean') throw new Error('Removing the AI helper expects {models: true or false}')
  return { models }
}

/* ------------------------------------------------------- the launch sweep */

/** What `pack.json` in a version folder is: none, there and not a receipt, or a receipt that parses. */
export type ReceiptState = 'none' | 'unparseable' | 'parses'

/** A description of a pack root, read from disk by `src/main/sidecar/sweep.ts`. */
export interface SweepInput {
  /** The manifest's pack number. */
  current: number
  /** Every numbered folder in the root (`in-use/`, `downloads/` and `.lock` are not numbers). */
  versions: { n: number; receipt: ReceiptState }[]
  /** Every numbered folder in `downloads/`. */
  downloads: number[]
  /** Another live app instance holds `<root>/.lock`. */
  lockedElsewhere: boolean
  /** The pack numbers live instances have in use (`in-use/<pid>`); null for a record that names none. */
  inUse: (number | null)[]
  /** A complete pack of the manifest's number: its receipt parses and matches the manifest. */
  currentComplete: boolean
}

export interface SweepStep {
  /** Relative to the root, '/'-separated: '2', 'downloads/3'. */
  path: string
  kind: 'version' | 'downloads'
  n: number
  /** A version folder with a receipt loses its `pack.json` before its tree (§3a.2 "Layout"). */
  receiptFirst: boolean
  why: string
}

/**
 * What the launch sweep removes (§3a.3 "Cancel, quit and the sweep"):
 *
 * - nothing at all while another live instance holds the lock;
 * - a version folder with NO `pack.json`: a partial, whatever else is in it;
 * - NEVER a folder whose `pack.json` does not parse: it reads "Not running ·
 *   Repair", so a torn receipt cannot delete 0.7 GB;
 * - a folder with a parseable receipt and a number below the manifest's, only
 *   when a complete pack of the manifest's number exists and no live instance
 *   has the old one in use (an Update interrupted after its new receipt);
 * - any `downloads/<n>` of another pack number.
 *
 * A number above the manifest's with a receipt is a newer build's, and stays.
 */
export function sweepPlan(input: SweepInput): SweepStep[] {
  if (input.lockedElsewhere) return []
  const steps: SweepStep[] = []
  const anyInUse = input.inUse.includes(null)
  for (const v of [...input.versions].sort((a, b) => a.n - b.n)) {
    if (v.receipt === 'none') {
      steps.push({ path: String(v.n), kind: 'version', n: v.n, receiptFirst: false, why: 'no pack.json: a partial install' })
      continue
    }
    if (v.receipt === 'unparseable') continue
    if (v.n < input.current && input.currentComplete && !anyInUse && !input.inUse.includes(v.n)) {
      steps.push({ path: String(v.n), kind: 'version', n: v.n, receiptFirst: true, why: `an older pack beside a complete pack ${input.current}` })
    }
  }
  for (const n of [...input.downloads].sort((a, b) => a - b)) {
    if (n !== input.current) steps.push({ path: `downloads/${n}`, kind: 'downloads', n, receiptFirst: false, why: `the downloads of pack ${n}, not this build's` })
  }
  return steps
}
