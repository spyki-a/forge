import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { SidecarClient, SidecarError, type HelperExit, type RequestOptions, type SidecarOptions } from './client'
import { RPC_ERRORS, type HelloResult } from '@shared/sidecar/protocol'
import { HELPER_PACK } from '@shared/sidecar/packManifest'
import { isUnsupported, packPlatform, parseReceipt, receiptIntegrity, type HelperPackManifest, type PackPlatform, type PlatformUnsupported } from '@shared/sidecar/pack'
import {
  UNPARSEABLE_RECEIPT,
  helperLaunch,
  receiptFromText,
  resolveHelperPython,
  type HelperChoice,
  type HelperLaunch,
  type HelperSource
} from '@shared/sidecar/helperPython'
import { HELPER_NOT_INSTALLED, helperStatusReason, packOffer, type SidecarStatus } from '@shared/sidecar/status'
import { degradedBySelftest, type SelftestRecord } from '@shared/sidecar/selftest'
import { bytesLeft } from '@shared/sidecar/install'
import type { HelperControl } from './installTypes'
import { nodePackFs, type HelperPackDeps, type HelperPackWorkers } from './install'
import { pidAlive } from './lock'
import { downloadedFiles, sweepRoot } from './sweep'

export type { SidecarStatus } from '@shared/sidecar/status'

/**
 * The AI helper's one client, and which Python it runs (docs/CLIPS.md §3a.2).
 *
 * The order is `resolveHelperPython`'s, from what is found here on disk; the
 * launch is `helperLaunch`'s. **Nothing is spawned for `absent` or
 * `damaged`, at any caller**: `getSidecar()` throws instead, so every caller's
 * own failure path takes over (the local voice reports the reason, stems take
 * mid/side, beats, depth, measure and transcribe reject before any request,
 * the reframe answers no-helper), and the status ask answers from the last
 * broadcast without ever starting anything.
 */

/**
 * The service's client: the protocol client, counting the requests it has
 * out (what `helperControl.busy()` answers synchronously; `idle()` is the
 * same count as a promise), and carrying the self-test record and the
 * integrity problems of the pack it runs from, which every `ready` it
 * broadcasts merges in.
 */
class HelperClient extends SidecarClient {
  private out = 0

  constructor(
    options: SidecarOptions,
    readonly selftest: SelftestRecord | null,
    readonly integrity: string[] = []
  ) {
    super(options)
  }

  /** A request asked and not yet answered, failed or cancelled. */
  get inFlight(): number {
    return this.out
  }

  override request<T>(method: string, params: unknown = {}, options: RequestOptions = {}): Promise<T> {
    this.out++
    const asked = super.request<T>(method, params, options)
    const done = (): void => {
      this.out--
    }
    asked.then(done, done)
    return asked
  }
}

let client: HelperClient | null = null
/** A switch in progress (`restartSidecar`): no caller gets a client until it is done. */
let switching: Promise<SidecarStatus> | null = null
let last: SidecarStatus | null = null
let listener: ((status: SidecarStatus) => void) | null = null
/**
 * Holds (`helperControl.hold`): while any is held, the helper stays stopped,
 * every caller is refused with the newest hold's reason, and nothing builds a
 * client. Repair and Remove delete under a path a lazily rebuilt client
 * would otherwise respawn from.
 */
const holds: string[] = []
/** The install job's stage while it runs: what `startCurrent` says while a hold keeps the helper down. */
let installing: string | null = null

/**
 * Where the sidecar package lives. In development it sits in the repo; once
 * packaged it is unpacked beside the app, because Python cannot import from
 * inside an asar archive any more than ffmpeg can execute from one.
 */
function sidecarDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'sidecar') : join(app.getAppPath(), 'sidecar')
}

/**
 * The helper's two folders under userData: models it downloads, and what it
 * bakes.
 *
 * The cache is `helper-cache`, not `cache`: userData already holds Chromium's
 * own `Cache` (its HTTP disk cache, `Cache/Cache_Data`), and on the default
 * case-insensitive APFS and on NTFS `cache` IS that folder — measured, `ls -d
 * …/forge/cache` resolved to it. Bakes do not belong inside a browser cache
 * Chromium manages. Bakes made before 2026-10-08 stay in `~/.cache/forge`,
 * untouched (docs/CLIPS.md §3.5, §16.24).
 */
export function helperFolders(userData: string): { modelsDir: string; cacheDir: string } {
  return { modelsDir: join(userData, 'models'), cacheDir: join(userData, 'helper-cache') }
}

/**
 * Where the packs live: `userData/python/` in a packaged app, and
 * `userData/python-dev/` in development, a root of its own (§3a.2 "Layout"):
 * the dev app and the installed one share a userData folder, and a dev build
 * with a newer manifest must never sweep or replace the installed app's pack.
 */
export function packRoot(userData: string, packaged: boolean): string {
  return join(userData, packaged ? 'python' : 'python-dev')
}

/** The venv's interpreter, as `python -m venv` lays it out on this platform. */
function venvPythonOf(dir: string, platform: NodeJS.Platform): string {
  return join(dir, '.venv', ...(platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']))
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * The version folder's `pack.json`, as `resolveHelperPython` takes it: `null`
 * when there is none, `UNPARSEABLE_RECEIPT` when it is there and cannot be
 * read (EACCES, a scanner's EBUSY: it is there, and nobody can read it), else
 * its text parsed (`receiptFromText`).
 */
export function readReceipt(versionDir: string): unknown {
  let text: string
  try {
    text = readFileSync(join(versionDir, 'pack.json'), 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'ENOTDIR' ? null : UNPARSEABLE_RECEIPT
  }
  return receiptFromText(text)
}

/**
 * The receipt of the highest pack number below `current` whose `pack.json`
 * parses, or null. After a release bumps the number, the installed pack sits
 * in an older folder (`python/1/`) and the manifest's (`python/2/`) is empty;
 * the row must offer Update over it, never a fresh Install (§3a.3 "Update",
 * §16.46 (a)). Only the OFFER reads it: the old pack is never run. A folder
 * whose receipt is missing or does not parse is not a pack to update (the
 * sweep's business, §3a.3), and `in-use/`, `downloads/` and `.lock` are not
 * numbers.
 */
export function olderReceipt(root: string, current: number): unknown {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return null
  }
  const older = names
    .filter((name) => /^[1-9]\d*$/.test(name) && Number(name) < current)
    .map(Number)
    .sort((a, b) => b - a)
  for (const n of older) {
    const receipt = readReceipt(join(root, String(n)))
    if (parseReceipt(receipt)) return receipt
  }
  return null
}

/**
 * `process.getSystemVersion()`: the marketing version ('14.6.1'), never
 * `os.release()`'s Darwin number (pack.ts `packPlatform`). Electron's; outside
 * Electron (a test that does not set it) there is none, and the Mac reads as
 * too old rather than as some other version.
 */
function systemVersion(): string {
  return typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : ''
}

interface Resolved {
  choice: HelperChoice
  launch: HelperLaunch | null
  machine: PackPlatform | PlatformUnsupported
  /** `pack.json` as read: null when there is none. */
  receipt: unknown
  /** When there is none, an older pack number's receipt (`olderReceipt`): what makes the offer an Update. */
  older: unknown
  manifest: HelperPackManifest
  /** The pack root (`packRoot`). */
  root: string
}

/** This machine's pack, or why it has none (`packPlatform` with Electron's own facts). */
function machineNow(): PackPlatform | PlatformUnsupported {
  return packPlatform({
    platform: process.platform,
    arch: process.arch,
    osVersion: systemVersion(),
    translated: app.runningUnderARM64Translation === true
  })
}

/** Which Python runs, from what is on disk now, and how it is started. Reads; never spawns. */
function resolveHelper(manifest: HelperPackManifest = HELPER_PACK): Resolved {
  const packaged = app.isPackaged
  const userData = app.getPath('userData')
  const platform = process.platform
  const machine = machineNow()
  const root = packRoot(userData, packaged)
  const versionDir = join(root, String(manifest.pack))
  const receipt = readReceipt(versionDir)
  const older = receipt === null ? olderReceipt(root, manifest.pack) : null
  const python = isUnsupported(machine) ? null : join(versionDir, manifest.platforms[machine].python)
  const venv = packaged ? null : venvPythonOf(sidecarDir(), platform)
  const choice = resolveHelperPython({
    packaged,
    env: process.env,
    platform,
    venvPython: venv && isFile(venv) ? venv : null,
    pack: receipt === null || python === null ? null : { receipt, interpreterExists: isFile(python), python, root: versionDir },
    manifest,
    packPlatform: machine
  })
  const launch = helperLaunch(choice, { packaged, platform, base: process.env, ...helperFolders(userData) })
  return { choice, launch, machine, receipt, older, manifest, root }
}

/**
 * What a press still fetches: the pack's bytes less the verified files already
 * in `downloads/<n>/` (§3a.4 "· N MB left", §16.47). undefined on a machine
 * with no pack.
 */
function leftToFetch(r: Resolved): number | undefined {
  if (isUnsupported(r.machine)) return undefined
  const dir = join(r.root, 'downloads', String(r.manifest.pack))
  return bytesLeft(r.manifest, r.machine, downloadedFiles(dir, r.manifest.platforms[r.machine]))
}

/** The Install, Update or Repair offer for what was resolved. */
function offerOf(r: Resolved, damaged: boolean): ReturnType<typeof packOffer> {
  return packOffer(r.manifest, r.machine, r.receipt, damaged, damaged ? null : r.older, leftToFetch(r))
}

/** The status of a choice that spawns nothing: absent or damaged, with what the row can offer. null for a launch. */
function statusWithoutHelper(r: Resolved): SidecarStatus | null {
  if (r.choice.kind === 'absent') return { state: 'absent', offer: offerOf(r, false) }
  if (r.choice.kind === 'damaged') return { state: 'damaged', reason: r.choice.reason, offer: offerOf(r, true) }
  return null
}

/** The pack's self-test record, when the choice runs a pack whose receipt carries one (§3a.3 "When the check fails part of the way"). */
function selftestOf(r: Resolved): SelftestRecord | null {
  if (r.choice.kind !== 'pack') return null
  const receipt = parseReceipt(r.receipt)
  const record = receipt?.selftest
  return record && typeof record === 'object' ? record : null
}

/** The receipt's integrity problems (§16.51), when the choice runs a pack whose receipt has any. */
function integrityOf(r: Resolved): string[] {
  return r.choice.kind === 'pack' ? receiptIntegrity(r.receipt) : []
}

/**
 * `ready`, with the receipt's failed self-test groups merged in: each failed
 * group's methods join hello's `degraded` with the group's reason, so
 * `helperCan` greys their controls, and the record rides along for the row.
 * The receipt's integrity problems ride along too (§16.51): the pack runs,
 * and the row shows each sentence with Repair.
 */
export function readyStatus(hello: HelloResult, source: HelperSource, selftest: SelftestRecord | null, integrity: readonly string[] = []): SidecarStatus {
  const warned = integrity.length > 0 ? { integrity: [...integrity] } : {}
  if (!selftest) return { state: 'ready', hello, source, ...warned }
  return { state: 'ready', hello: { ...hello, degraded: { ...hello.degraded, ...degradedBySelftest(selftest) } }, source, selftest, ...warned }
}

function broadcast(status: SidecarStatus): void {
  last = status
  listener?.(status)
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/*
 * The in-use record (§3a.2 "Layout"): `<root>/in-use/<pid>`, one per app
 * instance whose helper runs from a pack, holding `{pack}`; written when the
 * helper spawns, removed on its exit and on a stop. <pid> is this app's
 * process, so a record left by an instance that died names a pid that is
 * gone. lock.ts `readInUse` reads it (and removes a dead pid's): Repair,
 * Update and Remove refuse while another live instance runs a pack, and the
 * launch sweep keeps an older pack someone still runs (install.ts, sweep.ts).
 */
function inUseFile(source: Extract<HelperSource, { kind: 'pack' }>): string {
  return join(dirname(source.root), 'in-use', String(process.pid))
}

function markInUse(source: Extract<HelperSource, { kind: 'pack' }>): void {
  try {
    const file = inUseFile(source)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ pack: source.pack }))
  } catch (err) {
    console.warn('[sidecar] could not write the in-use record', err)
  }
}

function clearInUse(source: HelperSource): void {
  if (source.kind !== 'pack') return
  try {
    rmSync(inUseFile(source), { force: true })
  } catch (err) {
    console.warn('[sidecar] could not remove the in-use record', err)
  }
}

function makeClient(launch: HelperLaunch, selftest: SelftestRecord | null, integrity: string[] = []): HelperClient {
  const helper = new HelperClient({ cwd: sidecarDir(), launch, maxRestarts: 3 }, selftest, integrity)
  const source = launch.source
  helper.on('log', (line: string) => console.log('[sidecar]', line))
  helper.on('spawn', () => {
    if (source.kind === 'pack') markInUse(source)
  })
  helper.on('ready', (hello: HelloResult) => {
    // Every ready, a restart's included: the window was never told a restart had worked.
    if (client === helper) broadcast(readyStatus(hello, source, helper.selftest, helper.integrity))
  })
  helper.on('exit', (exit: HelperExit) => {
    clearInUse(source)
    // A crash after ready is told now, not only once the restarts give up.
    // One before the hello is told by that start's own rejection.
    if (client === helper && !helper.stopped && last?.state === 'ready') {
      broadcast({ state: 'failed', error: `The AI helper stopped (${exit.signal ? `signal ${exit.signal}` : `code ${exit.code}`})`, source })
    }
  })
  helper.on('gaveUp', () => {
    if (client === helper) broadcast({ state: 'failed', error: 'The AI helper keeps crashing and has been stopped', source })
  })
  return helper
}

/** The newest hold's reason, while the install job holds the helper stopped; null otherwise. */
function heldReason(): string | null {
  return holds.length > 0 ? holds[holds.length - 1] : null
}

/**
 * The helper's client, for a call. Throws a `SidecarError` — synchronously,
 * so it lands in each caller's own catch — when there is nothing to run:
 * "The AI helper is not installed", the damaged reason, or why this computer
 * cannot have one; while a switch to another rung is under way; and while
 * the install job holds the helper stopped ("The AI helper is being
 * repaired"), so nothing respawns from a folder being deleted.
 */
export function getSidecar(): SidecarClient {
  const hold = heldReason()
  if (hold) throw new SidecarError(hold, RPC_ERRORS.unavailable)
  if (switching) throw new SidecarError('The AI helper is restarting', RPC_ERRORS.unavailable)
  if (client) return client
  const resolved = resolveHelper()
  const without = statusWithoutHelper(resolved)
  if (without || !resolved.launch) {
    throw new SidecarError((without && helperStatusReason(without)) ?? HELPER_NOT_INSTALLED, RPC_ERRORS.unavailable)
  }
  client = makeClient(resolved.launch, selftestOf(resolved), integrityOf(resolved))
  return client
}

/**
 * Start the current rung's helper, or broadcast why there is none. Spawns
 * nothing for absent or damaged, nor while a hold keeps the helper down
 * (then it says the job's stage).
 */
function startCurrent(): SidecarStatus {
  let helper = client
  if (!helper) {
    const hold = heldReason()
    if (hold) {
      const status: SidecarStatus = { state: 'installing', stage: installing ?? hold }
      broadcast(status)
      return status
    }
    const resolved = resolveHelper()
    const without = statusWithoutHelper(resolved)
    if (without || !resolved.launch) {
      const status = without ?? { state: 'absent', offer: offerOf(resolved, false) }
      broadcast(status)
      return status
    }
    helper = client = makeClient(resolved.launch, selftestOf(resolved), integrityOf(resolved))
  }
  const started = helper
  const hello = started.info
  if (hello) {
    const status = readyStatus(hello, started.source, started.selftest, started.integrity)
    broadcast(status)
    return status
  }
  const starting: SidecarStatus = { state: 'starting', source: started.source }
  broadcast(starting)
  started.start().catch((err: unknown) => {
    // Told in its own words, unless a later status (the restarts' end) already said more.
    if (client === started && !started.stopped && last?.state === 'starting') {
      broadcast({ state: 'failed', error: messageOf(err), source: started.source })
    }
  })
  return starting
}

/**
 * Start in the background. The editor must be fully usable before — and if —
 * the helper comes up, so nothing here is awaited on the critical path.
 */
export function startSidecar(onStatus: (status: SidecarStatus) => void): void {
  listener = onStatus
  startCurrent()
}

/**
 * What the window's ask (`sidecar:status`) is answered with: the last
 * broadcast (the install job's stage while it runs with no helper up). Never
 * starts anything; before the first broadcast, what is on disk says absent or
 * damaged, and anything else is about to start.
 */
export function sidecarStatus(): SidecarStatus {
  if (last) return last
  const resolved = resolveHelper()
  const without = statusWithoutHelper(resolved)
  if (without) return without
  return resolved.launch ? { state: 'starting', source: resolved.launch.source } : { state: 'absent', offer: offerOf(resolved, false) }
}

function untilIdle(helper: SidecarClient, signal?: AbortSignal): Promise<void> {
  if (!signal) return helper.idle()
  if (signal.aborted) return Promise.reject(new SidecarError('Cancelled', RPC_ERRORS.cancelled))
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(new SidecarError('Cancelled', RPC_ERRORS.cancelled))
    signal.addEventListener('abort', onAbort, { once: true })
    void helper.idle().then(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    })
  })
}

/**
 * The switch to a new rung (§3a.2): wait until no helper work is in flight
 * (or the caller cancels, which leaves the helper as it was), stop the client
 * and wait for its exit — on Windows a running python.exe holds
 * python314.dll and the .pyd files open, so Repair and Remove need the wait —
 * then resolve the order again and start what it says. While it runs no caller
 * gets a client. Single flight: a second call joins the first.
 */
export function restartSidecar(signal?: AbortSignal): Promise<SidecarStatus> {
  if (switching) return switching
  const run = (async (): Promise<SidecarStatus> => {
    const old = client
    if (old) {
      await untilIdle(old, signal)
      client = null
      clearInUse(old.source)
      await old.stop()
    }
    return startCurrent()
  })()
  switching = run
  const clear = (): void => {
    if (switching === run) switching = null
  }
  run.then(clear, clear)
  return run
}

/** Stop the helper; resolves once it has exited. The in-use record goes at once: a quit may not wait for the exit. */
export async function stopSidecar(): Promise<void> {
  const helper = client
  client = null
  if (!helper) return
  clearInUse(helper.source)
  await helper.stop()
}

/* ------------------------------------------------- the install job's side */

/**
 * What the service lends the install job (docs/CLIPS.md §3a.3,
 * `HelperControl` in installTypes.ts):
 *
 * - `busy()`: a request out on the client, or a switch running;
 * - `whenIdle(signal)`: until nothing is out, or the job's cancel (which
 *   leaves the work running: it is never killed);
 * - `stop()`: `stopSidecar`, resolved on the helper's exit (and its tree's on
 *   Windows);
 * - `hold(reason)`: while held, `getSidecar()` throws `reason` synchronously
 *   and nothing builds a client, so a lazily rebuilt helper never respawns
 *   from a folder Repair or Remove is deleting; the returned function ends it;
 * - `restart(signal)`: `restartSidecar`, resolving the order again.
 */
export const helperControl: HelperControl = {
  busy(): boolean {
    return switching !== null || (client !== null && client.inFlight > 0)
  },
  whenIdle(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new SidecarError('Cancelled', RPC_ERRORS.cancelled))
    return client ? untilIdle(client, signal) : Promise.resolve()
  },
  stop(): Promise<void> {
    return stopSidecar()
  },
  hold(reason: string): () => void {
    holds.push(reason)
    let ended = false
    return () => {
      if (ended) return
      ended = true
      const at = holds.lastIndexOf(reason)
      if (at >= 0) holds.splice(at, 1)
    }
  },
  async restart(signal?: AbortSignal): Promise<void> {
    await restartSidecar(signal)
  }
}

/**
 * The install job's `onStatus`: its stage, broadcast as `installing` only
 * while no client is up. A helper that is running (Repair before its stop, or
 * `FORGE_PYTHON` while a pack installs beside it) keeps saying `ready`: its
 * controls still work, and the job's bar is in EXPORT.
 */
export function reportHelperInstall(status: SidecarStatus): void {
  if (status.state === 'installing') installing = status.stage
  if (status.state !== 'installing' || !client) broadcast(status)
}

/**
 * After a helper job has ended, however it ended: with no client up and
 * nothing switching or held, what is on disk is said again — `absent` with
 * its "· N MB left", or whatever the order now runs. A successful job has
 * already restarted through `helperControl.restart`.
 */
export function settleHelperStatus(): void {
  installing = null
  if (client || switching || heldReason()) return
  startCurrent()
}

/** The pack rung's launch for a version folder, exactly as `getSidecar` would start it: the check's and the job's. */
export function launchForPack(versionDir: string, manifest: HelperPackManifest = HELPER_PACK): HelperLaunch {
  const machine = machineNow()
  const platformPack = isUnsupported(machine) ? null : manifest.platforms[machine]
  const python = join(versionDir, platformPack ? platformPack.python : 'python')
  const userData = app.getPath('userData')
  const launch = helperLaunch(
    { kind: 'pack', python, pack: manifest.pack, root: versionDir },
    { packaged: app.isPackaged, platform: process.platform, base: process.env, ...helperFolders(userData) }
  )
  if (!launch) throw new Error('The AI helper pack has no launch')
  return launch
}

/**
 * The install job's dependencies the app owns: where, what, this machine, the
 * clock, the processes, the helper and its status. The workers (the fetcher,
 * the unpacker, pip, the check) come from the app's `installDeps.ts`.
 */
export function helperPackDeps(rename?: (from: string, to: string) => Promise<void>): Omit<HelperPackDeps, keyof HelperPackWorkers> {
  const userData = app.getPath('userData')
  return {
    userData,
    root: packRoot(userData, app.isPackaged),
    manifest: HELPER_PACK,
    platform: machineNow(),
    sidecarDir: sidecarDir(),
    appVersion: app.getVersion(),
    fetch: globalThis.fetch,
    spawn,
    fs: nodePackFs(rename),
    now: Date.now,
    isAlive: pidAlive,
    pid: process.pid,
    helper: helperControl,
    launchFor: (versionDir: string) => launchForPack(versionDir),
    onStatus: reportHelperInstall
  }
}

/**
 * The launch sweep (§3a.3), once at startup: this build's root only —
 * `python-dev/` in development, so the dev app never sweeps the installed
 * app's packs — under the lock, and nothing while another live instance
 * holds it. Never throws: a sweep that cannot run is tried at the next launch.
 */
export async function runLaunchSweep(): Promise<string[]> {
  try {
    return await sweepRoot(packRoot(app.getPath('userData'), app.isPackaged), {
      fs: nodePackFs(),
      manifest: HELPER_PACK,
      platform: machineNow(),
      pid: process.pid,
      now: Date.now,
      isAlive: pidAlive
    })
  } catch (err) {
    console.warn('[helper] the launch sweep did not run', err)
    return []
  }
}
