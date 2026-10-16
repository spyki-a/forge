import { constants as fsConstants, existsSync, readdirSync, readFileSync } from 'node:fs'
import { lstat, mkdir, readdir, readFile, rename as fsRename, rm as fsRm, statfs, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Job } from '@shared/types'
import type { FetchRetry } from '../ingest/binary'
import { JobQueue } from '../queue'
import { CancelledError } from '../ffmpeg/run'
import type { HelperLaunch } from '@shared/sidecar/helperPython'
import { isUnsupported, packBytes, parseReceipt, receiptMatches, type HelperPackManifest, type PackPlatform, type PackReceipt, type PlatformPack, type PlatformUnsupported } from '@shared/sidecar/pack'
import { selftestRecordFrom } from '@shared/sidecar/selftest'
import { checkPathBudget } from '@shared/sidecar/pathBudget'
import type { SidecarStatus } from '@shared/sidecar/status'
import {
  CHECKING_SPACE,
  CHECKING_THE_HELPER,
  HELPER_BEING_REMOVED,
  HELPER_BEING_REPAIRED,
  HELPER_BEING_UPDATED,
  HELPER_IN_USE_ELSEWHERE,
  HELPER_JOB_INPUT,
  HELPER_PRESET,
  HELPER_WORKING,
  INSTALL_STAGES,
  UNPACKING_PYTHON,
  WAITING_FOR_THE_HELPER,
  bytesLeft,
  downloadingText,
  driveLabel,
  installProgress,
  installingText,
  keptWithWarningText,
  spaceNeeded,
  spaceSentence,
  sweepPlan,
  type HelperInstallRequest,
  type HelperJobKind,
  type InstallStage
} from '@shared/sidecar/install'
import type { CheckPack, CompileStdlib, FetchVerified, HelperControl, PackCheck, PackFs, RunPip, Spawn, UnpackTarGz } from './installTypes'
import { acquireLock, readInUse, type PackLock } from './lock'
import { RM_RETRIES, applySweep, describeRoot, downloadedFiles, receiptAt, removeVersion, sweepRoot } from './sweep'
import { stdlibOf } from './compile'

/**
 * The AI helper's install job (docs/CLIPS.md §3a.3), in the shape of
 * `createReframeJobs`: a factory over its dependencies, its own queue at one
 * at a time, an entry per job id, a cancel through the job's own
 * AbortController whose signal goes into every dependency, and
 * `CancelledError` for a cancel. Everything that touches the network, pip or
 * a helper is injected, so the whole job runs in vitest outside Electron
 * (`tests/helperPackJob.test.ts`).
 *
 * The stages, in order, each with its share of the bar (`INSTALL_STAGES`):
 *
 * 0. **Checking**: the platform, the lock, the other instances' in-use
 *    records (Repair and Update), Windows' path budget (`checkPathBudget`,
 *    which the unpacker checks again), free space, and a receipt-less folder
 *    of this number deleted (a partial).
 * 1. **Downloading** into `downloads/<n>/`, every file through
 *    `fetchVerified`, one at a time, the interpreter first. A file that is
 *    not the file fails the job before any version folder exists. The job
 *    trusts `fetchVerified`'s resolved path and re-hashes nothing: the
 *    fetcher renames a `.part` into place only once its bytes and sha256 are
 *    the file's, and skips a file already there with its hash.
 *    **Repair** (a version folder that has a receipt) only now waits for the
 *    helper's work, reads the other windows' in-use records again (one may
 *    have started from the pack during the download), holds it, stops it,
 *    and deletes the old pack, receipt first: if the fetch fails, the old
 *    receipt and folder are untouched. The wait is asked again until nothing
 *    is out, so the stop follows the last check with no await between.
 * 2. **Unpacking** the interpreter, then its standard library compiled once.
 * 3. **Installing the libraries**: pip, offline, from `downloads/<n>/`.
 * 4. **Checking** the AI helper: hello and the self-test from the new pack.
 *    Integrity problems (§16.51: a path outside the pack, another Python)
 *    keep the pack: the receipt records them, and the log and the last speed
 *    text name the first.
 *
 * Then the receipt, written LAST as `pack.json.part` and renamed (never in
 * place: a rename refused past its retries fails the job); older numbers
 * swept beside the now-complete pack (receipt first); `downloads/` removed
 * (§16.47); the lock released; and the switch, which waits for the helper's
 * work in flight and never kills it.
 */

/** The workers lanes F and S build, which the app's `installDeps.ts` hands in. */
export interface HelperPackWorkers {
  fetchVerified: FetchVerified
  unpack: UnpackTarGz
  compileStdlib: CompileStdlib
  pip: RunPip
  check: CheckPack
  /** `fetchVerified`'s retry budget, one per file (`FETCH_RETRY`). */
  retry: FetchRetry
}

export interface HelperPackDeps extends HelperPackWorkers {
  userData: string
  /** `userData/python`, or `userData/python-dev` in development (service.ts `packRoot`). */
  root: string
  manifest: HelperPackManifest
  /** This machine's pack, or why it has none (stage 0 refuses with the reason). */
  platform: PackPlatform | PlatformUnsupported
  /** Where the helper's own package is: the lock files are under it, and the check's client runs from it. */
  sidecarDir: string
  appVersion: string
  fetch: typeof globalThis.fetch
  spawn: Spawn
  fs: PackFs
  now(): number
  isAlive(pid: number): boolean
  /** This app instance's process. */
  pid: number
  helper: HelperControl
  /** The pack rung's launch for a version folder, exactly as the service will start it. */
  launchFor(versionDir: string): HelperLaunch
  /** The job's stage, as `{state: 'installing', stage}`; the service decides whether it is broadcast. */
  onStatus(status: SidecarStatus): void
  /** Every progress the job reports, before the queue's throttle: for the tests and a log. */
  onProgress?(progress: number, speed: string | null): void
  log?(line: string): void
}

export interface HelperPackJobs {
  queue: JobQueue
  /** Single flight in this process: a second press while one is queued or running gets the same job. */
  install(options?: HelperInstallRequest): Job
  remove(options: { models: boolean }): Promise<void>
  /** The self-test alone, on the pack that is there: no download (§3a.4 "Check again"). */
  checkAgain(): Promise<void>
  /** The launch sweep of this root, under the lock. Returns what it removed. */
  sweep(): Promise<string[]>
  cancel(id: string): void
  clearFinished(): void
  /** A job queued or running, or a Remove, Check again or sweep under way. */
  busy(): boolean
  /** For before-quit: cancel every job and release the lock now, synchronously. */
  quit(): void
}

interface Entry {
  /** What the row says: decided at the press, from what was on disk then. */
  kind: HelperJobKind
}

/** What every helper caller is told while the job holds the helper stopped to replace its folder. */
const HOLD_REASON: Record<HelperJobKind, string> = {
  install: HELPER_BEING_REPAIRED,
  repair: HELPER_BEING_REPAIRED,
  update: HELPER_BEING_UPDATED
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/*
 * Where each step leaves the bar inside its stage, from the first measured
 * install (§3a.8 row 27, the M1 Pro): the unpack 0.45–0.53 s of the
 * stage's 2.6–2.8 s, the compile the rest; the check 37–39 s of stage 4,
 * the receipt (a walk of 15k paths), the sweep and the switch well under a
 * second together.
 */
const UNPACKED = 0.2
const CHECKED = 0.9
const RECEIPT_WRITTEN = 0.95
const SWITCHING = 0.97

const nodePlatformOf = (platform: PackPlatform): NodeJS.Platform => (platform === 'win32-x64' ? 'win32' : 'darwin')

/** The tree's own site-packages, beside its standard library (compile.ts `stdlibOf`): where pip installs and the bar counts `*.dist-info`. */
export function sitePackagesOf(versionDir: string, manifest: HelperPackManifest, platform: PackPlatform): string {
  return join(stdlibOf(versionDir, platform, manifest.python.version), 'site-packages')
}

/** The lock's package lines: the bar's denominator. Comments and blank lines are not packages. */
export function lockLineCount(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#')).length
}

/** Apparent bytes under a folder (lstat sizes, a symlink as itself), as the manifest's figures are counted. */
async function duBytes(dir: string): Promise<number> {
  let total = 0
  const walk = async (path: string): Promise<void> => {
    const s = await lstat(path)
    total += s.size
    if (!s.isDirectory()) return
    for (const name of await readdir(path)) await walk(join(path, name))
  }
  await walk(dir)
  return total
}

/** The speed over the last few seconds of bytes, by the injected clock. */
function speedMeter(now: () => number): { add(n: number): void; rate(): number | null } {
  const samples: { t: number; n: number }[] = []
  const WINDOW_MS = 3000
  return {
    add(n: number): void {
      const t = now()
      samples.push({ t, n })
      while (samples.length > 1 && t - samples[0].t > WINDOW_MS) samples.shift()
    },
    rate(): number | null {
      if (samples.length < 2) return null
      const span = samples[samples.length - 1].t - samples[0].t
      if (span <= 0) return null
      const bytes = samples.slice(1).reduce((sum, s) => sum + s.n, 0)
      return (bytes * 1000) / span
    }
  }
}

/** Every `.part` in a folder: a cancelled or failed transfer's leftover, never a file pip may read. */
async function removeParts(dir: string): Promise<void> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  for (const name of names) if (name.endsWith('.part')) await unlink(join(dir, name)).catch(() => undefined)
}

/**
 * The receipt, written beside itself and renamed into place with the app's
 * retried rename. NO in-place fallback (unlike settings, store.ts): a
 * receipt written in place could be torn, and a torn receipt reads as a
 * damaged pack. A rename refused past its retries fails the caller.
 */
async function writeReceipt(versionDir: string, receipt: PackReceipt, fs: PackFs): Promise<void> {
  const final = join(versionDir, 'pack.json')
  const part = `${final}.part`
  await writeFile(part, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
  try {
    await fs.rename(part, final)
  } catch (err) {
    await unlink(part).catch(() => undefined)
    throw new Error(`The AI helper's install record could not be written (${messageOf(err)})`)
  }
}

export function createHelperPackJobs(deps: HelperPackDeps): HelperPackJobs {
  const { root, manifest, fs, helper } = deps
  const log = deps.log ?? ((line: string) => console.log(line))
  const entries = new Map<string, Entry>()
  const n = manifest.pack
  const versionDir = join(root, String(n))
  const downloadsDir = join(root, 'downloads')
  const dlDir = join(downloadsDir, String(n))
  const lockOptions = { pid: deps.pid, now: deps.now, isAlive: deps.isAlive }

  /** The lock this process holds for the job, Remove or Check again, so a quit can release it at once. */
  let held: PackLock | null = null
  /** Remove, Check again and sweep in progress. */
  let operations = 0
  /** Aborted by a quit: Remove's and Check again's waits. */
  let operationsAbort = new AbortController()

  /** The other live instances whose helper runs from a pack in this root. */
  const others = async (): Promise<{ pid: number; pack: number | null }[]> => (await readInUse(root, deps.isAlive)).filter((r) => r.pid !== deps.pid)

  async function takeLock(): Promise<PackLock> {
    const lock = await acquireLock(root, fs, lockOptions)
    held = lock
    return lock
  }

  async function dropLock(lock: PackLock | null): Promise<void> {
    if (!lock) return
    if (held === lock) held = null
    await lock.release()
  }

  /** What the row calls the press, from the disk at the press: Repair over a receipt, Update over another pack's. */
  function kindAtPress(options: HelperInstallRequest): HelperJobKind {
    if (options.repair) return 'repair'
    if (options.update) return 'update'
    if (existsSync(join(versionDir, 'pack.json'))) {
      // A receipt that parses and does not match is an Update into the same folder (§3a.2); anything else, a Repair.
      let receipt: unknown = null
      try {
        receipt = JSON.parse(readFileSync(join(versionDir, 'pack.json'), 'utf8'))
      } catch {
        // unparseable: Repair
      }
      const update = parseReceipt(receipt) !== null && !isUnsupported(deps.platform) && !receiptMatches(receipt, manifest, deps.platform)
      return update ? 'update' : 'repair'
    }
    return olderPackThere() ? 'update' : 'install'
  }

  /** A folder below the manifest's number whose receipt parses: what makes a fresh press an Update. */
  function olderPackThere(): boolean {
    let names: string[] = []
    try {
      names = readdirSync(root)
    } catch {
      return false
    }
    return names.some((name) => {
      if (!/^[1-9]\d*$/.test(name) || Number(name) >= n) return false
      try {
        return parseReceipt(JSON.parse(readFileSync(join(root, name, 'pack.json'), 'utf8'))) !== null
      } catch {
        return false
      }
    })
  }

  /** One job, start to end. */
  async function run(entry: Entry, onProgress: (progress: number, speed: string | null) => void, signal: AbortSignal): Promise<void> {
    let stage: InstallStage | null = null
    const report = (s: InstallStage, fraction: number, text: string | null): void => {
      if (s !== stage) {
        stage = s
        deps.onStatus({ state: 'installing', stage: INSTALL_STAGES[s].label })
      }
      const progress = installProgress(s, fraction)
      deps.onProgress?.(progress, text)
      onProgress(progress, text)
    }
    const check = (): void => {
      if (signal.aborted) throw new CancelledError()
    }

    let lock: PackLock | null = null
    let releaseHold: (() => void) | null = null
    let stopped = false
    let restarted = false
    /** The version folder holds this job's partial work: removed on any failure before the receipt. */
    let touched = false
    let receiptWritten = false

    try {
      // 0. Checking
      report(0, 0, CHECKING_SPACE)
      if (isUnsupported(deps.platform)) throw new Error(deps.platform.unsupported)
      const platform = deps.platform
      const pack = manifest.platforms[platform]
      lock = await takeLock()
      check()
      // Read under the lock: a version folder with a receipt is replaced in Repair's order, fetching first.
      const replace = existsSync(join(versionDir, 'pack.json'))
      if (replace || entry.kind === 'update') {
        // Repair deletes the pack another window may be running; Update deletes the older one after.
        if ((await others()).length > 0) throw new Error(HELPER_IN_USE_ELSEWHERE)
      }
      // Windows' path budget, before anything is fetched: Node could write past MAX_PATH, pip and Python cannot.
      const budget = { longestPath: pack.longestPath, longestDir: pack.longestDir }
      const tooLong = checkPathBudget({ root: versionDir, ...budget, platform: nodePlatformOf(platform) })
      if (tooLong) throw new Error(tooLong)
      const left = bytesLeft(manifest, platform, downloadedFiles(dlDir, pack))
      const needed = spaceNeeded(left, pack.bytesOnDisk)
      const free = await fs.freeBytes(deps.userData)
      if (free < needed) throw new Error(spaceSentence(needed, free, driveLabel(deps.userData, nodePlatformOf(platform))))
      check()
      if (!replace && existsSync(versionDir)) {
        // A folder of this number with no receipt is a partial: deleted first (receipt-first is moot, there is none).
        await fs.rm(versionDir, { recursive: true, force: true, maxRetries: RM_RETRIES })
      }

      // 1. Downloading
      await download(pack, report, signal)
      check()

      if (replace) {
        // Repair: only now, with every file verified, does the old pack go. The download took minutes:
        // another window may have started its helper from this pack meanwhile, so the in-use records
        // are read again. And a caller that sends one request after another gets its next one out
        // between the idle and this continuation, so the idle is asked again until nothing is out:
        // the last check is synchronous with the hold and the stop, and no request is ever cut off.
        for (;;) {
          if (helper.busy()) report(1, 1, WAITING_FOR_THE_HELPER)
          await helper.whenIdle(signal)
          check()
          if ((await others()).length > 0) throw new Error(HELPER_IN_USE_ELSEWHERE)
          check()
          if (!helper.busy()) break
        }
        releaseHold = helper.hold(HOLD_REASON[entry.kind])
        await helper.stop()
        stopped = true
        touched = true
        // The helper is down from here: the row says so.
        report(2, 0, UNPACKING_PYTHON)
        await removeVersion(versionDir, fs)
        check()
      }

      // 2. Unpacking
      report(2, 0, UNPACKING_PYTHON)
      await mkdir(versionDir, { recursive: true })
      touched = true
      const launch = deps.launchFor(versionDir)
      const python = join(versionDir, pack.python)
      const unpacked = await deps.unpack(join(dlDir, pack.interpreter.name), versionDir, { signal, onMessage: log, budget })
      log(`[helper] unpacked ${unpacked.files} files, ${unpacked.bytes} B; longest path ${unpacked.longestPath}, longest directory ${unpacked.longestDir}`)
      check()
      report(2, UNPACKED, UNPACKING_PYTHON)
      await deps.compileStdlib({ python, stdlib: stdlibOf(versionDir, platform, manifest.python.version), env: launch.env, spawn: deps.spawn, signal })
      check()

      // 3. Installing the libraries
      const lockFile = join(deps.sidecarDir, ...pack.lock.file.split('/'))
      const total = lockLineCount(await readFile(lockFile, 'utf8'))
      report(3, 0, installingText(0, total))
      let high = 0
      await deps.pip({
        python,
        lock: lockFile,
        findLinks: dlDir,
        sitePackages: sitePackagesOf(versionDir, manifest, platform),
        total,
        env: launch.env,
        spawn: deps.spawn,
        signal,
        onProgress: (done, of, line) => {
          high = Math.max(high, done)
          report(3, of > 0 ? high / of : 0, installingText(high, of))
          if (line) log(`[helper] pip: ${line}`)
        }
      })
      check()

      // 4. Checking the AI helper
      report(4, 0, CHECKING_THE_HELPER)
      let result: PackCheck
      try {
        result = await deps.check({
          versionDir,
          manifest,
          platform,
          sidecarDir: deps.sidecarDir,
          launch,
          signal,
          onMessage: log,
          // The check is most of a real install's time (§3a.8 row 27): the bar moves through it.
          onProgress: (f) => report(4, CHECKED * f, CHECKING_THE_HELPER)
        })
      } catch (err) {
        if (signal.aborted) throw new CancelledError()
        throw new Error(`The AI helper did not start from its new folder: ${messageOf(err)}`)
      }
      check()
      for (const problem of result.integrity) log(`[helper] check: ${problem}`)
      for (const problem of result.problems) log(`[helper] check: ${problem}`)
      // §16.51: a path outside the pack or another Python keeps the pack, which runs; the receipt records
      // it, the row warns with Repair, and the log and the last speed text name the first problem.
      const warning = keptWithWarningText(result.integrity)
      if (warning) log(`[helper] ${entry.kind}: the pack is kept with a warning: ${result.integrity[0]}`)
      report(4, CHECKED, warning ?? CHECKING_THE_HELPER)

      // The receipt, last.
      let onDisk = pack.bytesOnDisk
      try {
        onDisk = await duBytes(versionDir)
      } catch (err) {
        log(`[helper] could not measure the pack on disk, recording the manifest's ${onDisk} B: ${messageOf(err)}`)
      }
      const receipt: PackReceipt = {
        pack: n,
        python: manifest.python.version,
        build: manifest.python.build,
        platform,
        interpreterSha256: pack.interpreter.sha256,
        lockSha256: pack.lock.sha256,
        bytesOnDisk: onDisk,
        installedAt: new Date(deps.now()).toISOString(),
        appVersion: deps.appVersion,
        hello: { capabilities: [...result.hello.capabilities], degraded: { ...result.hello.degraded } },
        selftest: selftestRecordFrom(result.selftest, nodePlatformOf(platform)),
        ...(result.problems.length > 0 ? { problems: [...result.problems] } : {}),
        ...(result.integrity.length > 0 ? { integrity: [...result.integrity] } : {})
      }
      await writeReceipt(versionDir, receipt, fs)
      receiptWritten = true
      report(4, RECEIPT_WRITTEN, warning ?? CHECKING_THE_HELPER)

      // Older numbers beside the now-complete pack (receipt first), other packs' downloads, then this one's (§16.47).
      const plan = sweepPlan(await describeRoot(root, { manifest, platform, isAlive: deps.isAlive, lockedElsewhere: false }))
      await applySweep(root, plan, fs, log)
      await fs.rm(downloadsDir, { recursive: true, force: true, maxRetries: RM_RETRIES }).catch((err: unknown) => log(`[helper] could not remove the downloads: ${messageOf(err)}`))
      await dropLock(lock)
      lock = null
      releaseHold?.()
      releaseHold = null

      if (stopped) {
        // Repair stopped the helper: nothing is in flight, and nothing to wait for.
        restarted = true
        await helper.restart()
      } else {
        // The switch: waits for the work in flight, and can be cancelled; it never kills that work.
        if (helper.busy()) report(4, SWITCHING, WAITING_FOR_THE_HELPER)
        await helper.whenIdle(signal)
        check()
        restarted = true
        await helper.restart(signal)
      }
      report(4, 1, warning)
    } catch (err) {
      const cancelled = signal.aborted || err instanceof CancelledError
      if (touched && !receiptWritten) {
        // A partial: the version folder goes (receipt first), the downloads stay so the next press resumes.
        await removeVersion(versionDir, fs).catch((e: unknown) => log(`[helper] could not remove the partial pack: ${messageOf(e)}`))
      }
      // The verified files stay for the next press; a transfer cut off leaves no .part behind.
      await removeParts(dlDir)
      if (cancelled) throw new CancelledError()
      log(`[helper] ${entry.kind} failed: ${messageOf(err)}`)
      throw err instanceof Error ? err : new Error(String(err))
    } finally {
      await dropLock(lock)
      releaseHold?.()
      // A helper this job stopped is started again from whatever the order now says (FORGE_PYTHON, or absent).
      if (stopped && !restarted) await helper.restart().catch((e: unknown) => log(`[helper] could not restart the AI helper: ${messageOf(e)}`))
    }
  }

  /** Stage 1: every file of the pack, one at a time, the interpreter first; the bar by bytes over all of them. */
  async function download(pack: PlatformPack, report: (s: InstallStage, fraction: number, text: string | null) => void, signal: AbortSignal): Promise<void> {
    await mkdir(dlDir, { recursive: true })
    const files = [pack.interpreter, ...pack.wheels]
    const total = packBytes(pack)
    const speed = speedMeter(deps.now)
    let done = 0
    report(1, 0, downloadingText(0, total, null))
    // A failure or a cancel here leaves the verified files where they are; run's catch removes any .part.
    for (const file of files) {
      // A retried file streams again from its start: it counts what its best try has brought, so the
      // bar neither goes back with the new try nor runs ahead of it (the speed takes every byte).
      let thisTry = 0
      let best = 0
      const so = (): number => done + Math.min(best, file.bytes)
      const path = await deps.fetchVerified(file, dlDir, {
        fetch: deps.fetch,
        retry: deps.retry,
        signal,
        now: deps.now,
        rename: fs.rename,
        onTry: () => {
          thisTry = 0
        },
        onBytes: (bytes) => {
          thisTry += bytes
          best = Math.max(best, thisTry)
          speed.add(bytes)
          report(1, so() / total, downloadingText(so(), total, speed.rate()))
        },
        onMessage: log
      })
      done += file.bytes
      log(`[helper] verified ${path}`)
      report(1, done / total, downloadingText(done, total, speed.rate()))
      if (signal.aborted) throw new CancelledError()
    }
  }

  const queue = new JobQueue((job, onProgress) => {
    const entry = entries.get(job.id)
    if (!entry) throw new Error('This install is missing its request')
    const controller = new AbortController()
    const promise = run(entry, onProgress, controller.signal)
    return { promise, cancel: () => controller.abort() }
  }, 1)

  const active = (): Job | undefined => queue.list().find((j) => j.status === 'queued' || j.status === 'running')

  async function operation<T>(body: (signal: AbortSignal) => Promise<T>): Promise<T> {
    operations++
    try {
      return await body(operationsAbort.signal)
    } finally {
      operations--
    }
  }

  return {
    queue,

    install(options: HelperInstallRequest = {}): Job {
      const running = active()
      if (running) return running
      const kind = kindAtPress(options)
      return queue.add({ presetId: HELPER_PRESET, input: root, inputName: HELPER_JOB_INPUT, output: '', params: { kind } }, (id) => entries.set(id, { kind }))
    },

    async remove({ models }: { models: boolean }): Promise<void> {
      await operation(async () => {
        // The lock is the one guard against the jobs: this window's own job holds it too, so Remove refuses
        // with HELPER_BUSY while that runs, and with HELPER_IN_USE_ELSEWHERE while another window's does.
        const lock = await takeLock()
        let stopped = false
        try {
          const packs = (await readdir(root).catch(() => [] as string[])).filter((name) => /^[1-9]\d*$/.test(name))
          if (packs.length === 0) {
            // No pack here (the lock made the folder): nothing runs from it, so the helper is left alone.
            await fs.rm(root, { recursive: true, force: true, maxRetries: RM_RETRIES })
            if (models) await fs.rm(join(deps.userData, 'models'), { recursive: true, force: true, maxRetries: RM_RETRIES })
            return
          }
          // Read last, after every other await, so a window that started its helper from the pack meanwhile is seen.
          if ((await others()).length > 0) throw new Error(HELPER_IN_USE_ELSEWHERE)
          // Remove refuses while helper work is running (§3a.3), rather than waiting under a hold that would
          // refuse every other caller for as long as a transcription takes, with no X to end it. From this
          // check to the stop nothing awaits, so no request can be sent in between and cut off.
          if (helper.busy()) throw new Error(HELPER_WORKING)
          const release = helper.hold(HELPER_BEING_REMOVED)
          try {
            await helper.stop()
            stopped = true
            // Every receipt first, so a delete that stops part-way leaves partials the order ignores.
            for (const name of packs) await fs.rm(join(root, name, 'pack.json'), { recursive: false, force: true, maxRetries: RM_RETRIES })
            await fs.rm(root, { recursive: true, force: true, maxRetries: RM_RETRIES })
            if (models) await fs.rm(join(deps.userData, 'models'), { recursive: true, force: true, maxRetries: RM_RETRIES })
          } finally {
            release()
          }
        } finally {
          // The lock went with the root; release only unlinks one this process still owns.
          await dropLock(lock)
          // The order resolves again: FORGE_PYTHON, or absent. A Remove refused before its stop leaves the helper as it was.
          if (stopped) await helper.restart()
        }
      })
    },

    async checkAgain(): Promise<void> {
      await operation(async (signal) => {
        if (isUnsupported(deps.platform)) throw new Error(deps.platform.unsupported)
        const platform = deps.platform
        const lock = await takeLock()
        try {
          const { state, receipt } = await receiptAt(versionDir)
          if (state !== 'parses' || !receiptMatches(receipt, manifest, platform)) throw new Error('The AI helper is not installed, so there is nothing to check')
          const result = await deps.check({ versionDir, manifest, platform, sidecarDir: deps.sidecarDir, launch: deps.launchFor(versionDir), signal, onMessage: log })
          for (const problem of result.integrity) log(`[helper] check: ${problem}`)
          for (const problem of result.problems) log(`[helper] check: ${problem}`)
          // This check's findings replace the last one's, both lists: one that is mended reads clean again.
          const { problems: _problems, integrity: _integrity, ...rest } = receipt as PackReceipt
          void _problems
          void _integrity
          await writeReceipt(
            versionDir,
            {
              ...rest,
              hello: { capabilities: [...result.hello.capabilities], degraded: { ...result.hello.degraded } },
              selftest: selftestRecordFrom(result.selftest, nodePlatformOf(platform)),
              ...(result.problems.length > 0 ? { problems: [...result.problems] } : {}),
              ...(result.integrity.length > 0 ? { integrity: [...result.integrity] } : {})
            },
            fs
          )
        } finally {
          await dropLock(lock)
        }
        // The new record reaches the ready status through a fresh helper, which also loads what Check again was for.
        await helper.restart()
      })
    },

    sweep(): Promise<string[]> {
      // Under the lock: nothing while this window's job, Remove or Check again holds it, or another window does.
      return operation(() => sweepRoot(root, { fs, manifest, platform: deps.platform, pid: deps.pid, now: deps.now, isAlive: deps.isAlive, log }))
    },

    cancel(id: string): void {
      queue.cancel(id)
    },

    clearFinished(): void {
      queue.clearFinished()
      for (const id of [...entries.keys()]) if (!queue.list().some((j) => j.id === id)) entries.delete(id)
    },

    busy(): boolean {
      return active() !== undefined || operations > 0
    },

    quit(): void {
      queue.cancelAll()
      operationsAbort.abort()
      operationsAbort = new AbortController()
      held?.releaseSync()
      held = null
    }
  }
}

/** What a press says in a build whose workers are not wired in (`installDeps.ts` hands the real ones to `registerIpc`). */
export const INSTALL_NOT_BUILT = 'Installing the AI helper is not part of this build yet'

/**
 * Workers that refuse, for a build that has not wired lanes F's and S's in:
 * every press fails at its first worker with `INSTALL_NOT_BUILT`, after
 * stage 0's checks, and nothing is fetched or run.
 */
export function unbuiltWorkers(): HelperPackWorkers {
  const refuse = (): Promise<never> => Promise.reject(new Error(INSTALL_NOT_BUILT))
  return {
    fetchVerified: refuse,
    unpack: refuse,
    compileStdlib: refuse,
    pip: refuse,
    check: refuse,
    retry: { attempts: 1, firstDelayMs: 0, budgetMs: 0, checksumsAnswerMs: 0, binaryAnswerMs: 0, idleMs: 0 }
  }
}

/* ------------------------------------------------------- the app's fs */

/** The lock's create: `O_CREAT | O_EXCL | O_WRONLY`, refused with EEXIST when the file is there, never truncating it. */
export const EXCLUSIVE_CREATE = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY

/**
 * The file-system calls the job makes, on Node's `fs`. `rename` is the app's
 * retried rename (`renameWithRetry`, installDeps.ts `packRename`) once the
 * app's deps pass it; plain `fs.rename` otherwise. `freeBytes` is `statfs`'s
 * blocks available to this user (`bavail`, `df`'s "Avail"; `bfree` also
 * counts blocks only root may write).
 */
export function nodePackFs(rename: (from: string, to: string) => Promise<void> = fsRename): PackFs {
  return {
    rename,
    rm: (path, options) => fsRm(path, options),
    createExclusive: (path, text) => writeFile(path, text, { flag: EXCLUSIVE_CREATE }),
    freeBytes: async (path) => {
      const s = await statfs(path)
      return Number(s.bavail) * Number(s.bsize)
    }
  }
}
