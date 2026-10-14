import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { SidecarClient, SidecarError, type HelperExit } from './client'
import { RPC_ERRORS, type HelloResult } from '@shared/sidecar/protocol'
import { HELPER_PACK } from '@shared/sidecar/packManifest'
import { isUnsupported, packPlatform, type HelperPackManifest, type PackPlatform, type PlatformUnsupported } from '@shared/sidecar/pack'
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

let client: SidecarClient | null = null
/** A switch in progress (`restartSidecar`): no caller gets a client until it is done. */
let switching: Promise<SidecarStatus> | null = null
let last: SidecarStatus | null = null
let listener: ((status: SidecarStatus) => void) | null = null

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
  manifest: HelperPackManifest
}

/** Which Python runs, from what is on disk now, and how it is started. Reads; never spawns. */
function resolveHelper(manifest: HelperPackManifest = HELPER_PACK): Resolved {
  const packaged = app.isPackaged
  const userData = app.getPath('userData')
  const platform = process.platform
  const machine = packPlatform({
    platform,
    arch: process.arch,
    osVersion: systemVersion(),
    translated: app.runningUnderARM64Translation === true
  })
  const versionDir = join(packRoot(userData, packaged), String(manifest.pack))
  const receipt = readReceipt(versionDir)
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
  return { choice, launch, machine, receipt, manifest }
}

/** The status of a choice that spawns nothing: absent or damaged, with what the row can offer. null for a launch. */
function statusWithoutHelper(r: Resolved): SidecarStatus | null {
  if (r.choice.kind === 'absent') return { state: 'absent', offer: packOffer(r.manifest, r.machine, r.receipt, false) }
  if (r.choice.kind === 'damaged') {
    return { state: 'damaged', reason: r.choice.reason, offer: packOffer(r.manifest, r.machine, r.receipt, true) }
  }
  return null
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
 * gone. Nothing reads it yet: the install job (a later slice) does, so that
 * Repair and Remove refuse while another live instance runs the pack.
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

function makeClient(launch: HelperLaunch): SidecarClient {
  const helper = new SidecarClient({ cwd: sidecarDir(), launch, maxRestarts: 3 })
  const source = launch.source
  helper.on('log', (line: string) => console.log('[sidecar]', line))
  helper.on('spawn', () => {
    if (source.kind === 'pack') markInUse(source)
  })
  helper.on('ready', (hello: HelloResult) => {
    // Every ready, a restart's included: the window was never told a restart had worked.
    if (client === helper) broadcast({ state: 'ready', hello, source })
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

/**
 * The helper's client, for a call. Throws a `SidecarError` — synchronously,
 * so it lands in each caller's own catch — when there is nothing to run:
 * "The AI helper is not installed", the damaged reason, or why this computer
 * cannot have one; and while a switch to another rung is under way.
 */
export function getSidecar(): SidecarClient {
  if (switching) throw new SidecarError('The AI helper is restarting', RPC_ERRORS.unavailable)
  if (client) return client
  const resolved = resolveHelper()
  const without = statusWithoutHelper(resolved)
  if (without || !resolved.launch) {
    throw new SidecarError((without && helperStatusReason(without)) ?? HELPER_NOT_INSTALLED, RPC_ERRORS.unavailable)
  }
  client = makeClient(resolved.launch)
  return client
}

/** Start the current rung's helper, or broadcast why there is none. Spawns nothing for absent or damaged. */
function startCurrent(): SidecarStatus {
  let helper = client
  if (!helper) {
    const resolved = resolveHelper()
    const without = statusWithoutHelper(resolved)
    if (without || !resolved.launch) {
      const status = without ?? { state: 'absent', offer: packOffer(resolved.manifest, resolved.machine, resolved.receipt, false) }
      broadcast(status)
      return status
    }
    helper = client = makeClient(resolved.launch)
  }
  const started = helper
  const hello = started.info
  if (hello) {
    const status: SidecarStatus = { state: 'ready', hello, source: started.source }
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
 * broadcast. Never starts anything; before the first broadcast, what is on
 * disk says absent or damaged, and anything else is about to start.
 */
export function sidecarStatus(): SidecarStatus {
  if (last) return last
  const resolved = resolveHelper()
  const without = statusWithoutHelper(resolved)
  if (without) return without
  return resolved.launch
    ? { state: 'starting', source: resolved.launch.source }
    : { state: 'absent', offer: packOffer(resolved.manifest, resolved.machine, resolved.receipt, false) }
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
