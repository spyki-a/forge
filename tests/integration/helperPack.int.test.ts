import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { HELPER_PACK } from '../../src/shared/sidecar/packManifest'
import { isUnsupported, packBytes, packPlatform, parseReceipt, receiptMatches, type HelperPackManifest, type PackPlatform, type PackReceipt } from '../../src/shared/sidecar/pack'
import { helperLaunch, receiptFromText, type HelperLaunch } from '../../src/shared/sidecar/helperPython'
import { SELFTEST_GROUP_NAMES } from '../../src/shared/sidecar/selftest'
import { SIDECAR_METHODS, type HelloResult } from '../../src/shared/sidecar/protocol'
import type { SidecarStatus } from '../../src/shared/sidecar/status'
import { CHECKING_SPACE, CHECKING_STARTING, CHECKING_THE_HELPER, INSTALL_STAGES, UNPACKING_PYTHON, bytesLeft, checkingGroupText, spaceNeeded } from '../../src/shared/sidecar/install'
import { createHelperPackJobs, lockLineCount, sitePackagesOf, type HelperPackDeps } from '../../src/main/sidecar/install'
import { appPackFs, helperWorkers } from '../../src/main/sidecar/installDeps'
import { checkPack } from '../../src/main/sidecar/check'
import { runPip } from '../../src/main/sidecar/pip'
import { lockPath, pidAlive } from '../../src/main/sidecar/lock'
import { helperFolders, packRoot } from '../../src/main/sidecar/service'
import { SidecarClient } from '../../src/main/sidecar/client'
import type { HelperControl, PackCheck, PackFs } from '../../src/main/sidecar/installTypes'
import { ciNotice } from './helperDiag'
import type { Job } from '../../src/shared/types'
import { outputDir } from './output'
import { cachedPackIn, packSuiteGate, pipCheckProblems, SIDECAR_DIR } from './venv'

/*
 * The AI helper's pack, installed for real (docs/CLIPS.md §3a.7
 * "Integration"): the app's own job module (`createHelperPackJobs`) with its
 * real workers (installDeps.ts: `fetchVerified` through Node's fetch, the
 * streaming unpack, the stdlib compile, pip, the check), the real manifest,
 * and the real hosts, into a userData path holding a space and a non-ASCII
 * character, as a user's profile name can.
 *
 * Opt-in: `FORGE_PACK_REAL=1` (about 0.9 GB of disk and 178 MB fetched on
 * the Mac). Without it the suite skips, with the reason in its name, as
 * venv.ts' describeWithVenv does. CI's pack step runs it on both push
 * runners (.github/workflows/ci.yml, §3a.6 step 2). Behind an HTTP(S) proxy
 * Node's fetch needs `NODE_USE_ENV_PROXY=1` (§3a.5, measured).
 *
 * - `FORGE_PACK_USERDATA=<dir>`: the userData to install into, and to leave
 *   the pack in, instead of a scratch one (CI's: `<runner.temp>/forge pack
 *   é/userData`, a space and a non-ASCII character, which its cache keeps
 *   and its later steps run the suites from). Set, the suite never skips:
 *   only CI's pack step sets it, so without `FORGE_PACK_REAL=1` beside it
 *   the run FAILS rather than going green on nothing.
 *   **The cached mode**: when that userData already holds a pack this build
 *   accepts (the app's own rule, venv.ts `cachedPackIn`: the receipt parses
 *   and both hashes are the manifest's, and the interpreter is there), as
 *   CI's restored cache does, the run does not install: it runs the job's
 *   Check again (the self-test, the receipt rewritten) and every assertion
 *   that is not about a download. A stale receipt installs.
 *
 * - `FORGE_PACK_DOWNLOADS=<dir>`: a folder the verified downloads are kept in
 *   (hard links) before the job removes `downloads/`, and that a later run's
 *   `downloads/<n>` is seeded from, so it resumes file by file and fetches
 *   nothing. Unset, nothing is kept and everything is fetched.
 * - `FORGE_PACK_KEEP=1`: leave the installed pack where it is (its path is
 *   in tests/output/helper-pack/README.txt), for the suites to run through
 *   (`FORGE_HELPER_PACK`, venv.ts).
 * - `FORGE_PACK_MUTATION=<package>|user-site`: install a pack this test must
 *   FAIL on, to prove its assertions bite (§3a.7's three mutations, and one
 *   for pip check): the lock and the manifest without that package's line
 *   and wheel (`librosa`: audio.beats degraded; `mediapipe`: vision.faces
 *   degraded; `idna`: pip check reports what requires it); or `user-site`,
 *   the launch without `-s` and with a user site planted in its own HOME and
 *   APPDATA.
 */

const REAL = process.env.FORGE_PACK_REAL === '1'
const MUTATION = process.env.FORGE_PACK_MUTATION || null
const KEEP = process.env.FORGE_PACK_KEEP === '1'
const DOWNLOADS_KEPT = process.env.FORGE_PACK_DOWNLOADS || null
/** CI's pack step's userData (never for a mutation, which installs a pack this run must fail on into its own scratch). */
const ASKED_USERDATA = process.env.FORGE_PACK_USERDATA || null
const USERDATA = MUTATION ? null : ASKED_USERDATA

/** This machine's pack, by the app's rule (pack.ts `packPlatform`), with the marketing version the app reads from Electron. */
function thisMachine(): PackPlatform {
  const osVersion = process.platform === 'darwin' ? execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim() : ''
  const machine = packPlatform({ platform: process.platform, arch: process.arch, osVersion, translated: false })
  if (isUnsupported(machine)) throw new Error(machine.unsupported)
  return machine
}

/** `p` is `root` or under it: by `path.relative` on real paths, never a string prefix. */
function inside(root: string, p: string): boolean {
  const rel = relative(root, p)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

/** The real path of `p` through its longest part that exists (python314.zip is on sys.path and on no disk). */
function real(p: string): string {
  try {
    return realpathSync.native(p)
  } catch {
    const parent = resolve(p, '..')
    return parent === p ? p : join(real(parent), p.slice(parent.length).replace(/^[\\/]+/, ''))
  }
}

/** Every file and folder under `dir`, as relative paths with '/', links not followed. */
function walk(dir: string): { files: string[]; dirs: string[] } {
  const files: string[] = []
  const dirs: string[] = []
  const go = (rel: string): void => {
    for (const name of readdirSync(join(dir, rel))) {
      const r = rel ? `${rel}/${name}` : name
      const st = lstatSync(join(dir, r))
      if (st.isDirectory()) {
        dirs.push(r)
        go(r)
      } else files.push(r)
    }
  }
  go('')
  return { files, dirs }
}

const distInfoCount = (sitePackages: string): number => {
  try {
    return readdirSync(sitePackages).filter((n) => n.endsWith('.dist-info')).length
  } catch {
    return 0
  }
}

interface Run {
  /** `install`: the job ran; `cached`: a pack this build accepts was already there (CI's restored cache), and Check again ran. */
  mode: 'install' | 'cached'
  /** Why this run installed, or which pack it found. */
  why: string
  scratch: string
  userData: string
  root: string
  versionDir: string
  sidecarDir: string
  manifest: HelperPackManifest
  platform: PackPlatform
  /** The install job, as the queue ended it; null in the cached mode. */
  job: Job | null
  /** Check again's failure, in the cached mode; null when it passed (and always in the install mode). */
  checkError: string | null
  started: number
  progress: { t: number; p: number; text: string | null }[]
  statuses: { t: number; stage: string }[]
  logs: { t: number; line: string }[]
  helperEvents: string[]
  check: PackCheck | null
  firstHelloMs: number | null
  pipTicks: { t: number; count: number }[]
  pipReports: { t: number; done: number; total: number; line: string | null }[]
  launch: HelperLaunch
  free: { bavail: number; bfree: number; bsize: number }
  /** `df -k`'s Avail on userData, in bytes, read right after statfs (not on win32). */
  dfAvail: number | null
  needed: number
  /** The files the run found already verified in a kept downloads folder: not fetched, so no host to name. All of them in the cached mode. */
  seeded: string[]
  /** When the run ended: the job's finish, or Check again's. */
  endedAt: number
}

function inputsFor(platform: PackPlatform, scratch: string): { manifest: HelperPackManifest; sidecarDir: string } {
  const drop = MUTATION && MUTATION !== 'user-site' ? MUTATION : null
  if (!drop) return { manifest: HELPER_PACK, sidecarDir: SIDECAR_DIR }
  // A scratch copy of the helper's folder (its package, no bytecode) and of the lock, without the package's line.
  const sidecarDir = join(scratch, 'sidecar')
  cpSync(join(SIDECAR_DIR, 'forge_sidecar'), join(sidecarDir, 'forge_sidecar'), { recursive: true, filter: (src) => !src.includes('__pycache__') })
  const pack = HELPER_PACK.platforms[platform]
  const lockText = readFileSync(join(SIDECAR_DIR, ...pack.lock.file.split('/')), 'utf8')
  const lines = lockText.split('\n')
  const gone = lines.filter((line) => line.startsWith(`${drop}==`))
  expect(gone, `the lock's ${drop} line`).toHaveLength(1)
  mkdirSync(join(sidecarDir, 'pack'), { recursive: true })
  writeFileSync(join(sidecarDir, ...pack.lock.file.split('/')), lines.filter((line) => !line.startsWith(`${drop}==`)).join('\n'))
  // A wheel's name spells the project with underscores (scikit_learn-…), the lock with hyphens.
  const wheels = pack.wheels.filter((w) => !w.name.startsWith(`${drop.replace(/-/g, '_')}-`))
  expect(pack.wheels.length - wheels.length, `the manifest's ${drop} wheel`).toBe(1)
  return { manifest: { ...HELPER_PACK, platforms: { ...HELPER_PACK.platforms, [platform]: { ...pack, wheels } } }, sidecarDir }
}

/** The pack rung's launch for a version folder, as service.ts `launchForPack` builds it (and, for the user-site mutation, without `-s`). */
function launchOf(versionDir: string, manifest: HelperPackManifest, platform: PackPlatform, userData: string, home: string | null): HelperLaunch {
  const launch = helperLaunch(
    { kind: 'pack', python: join(versionDir, manifest.platforms[platform].python), pack: manifest.pack, root: versionDir },
    { packaged: true, platform: process.platform, base: process.env, ...helperFolders(userData) }
  )
  if (!launch) throw new Error('the pack rung has no launch')
  if (!home) return launch
  return { ...launch, args: launch.args.filter((a) => a !== '-s'), env: { ...launch.env, HOME: home, APPDATA: join(home, 'AppData', 'Roaming') } }
}

/** A user site in `home`, where this Python looks for one on each platform. */
function plantUserSite(home: string, version: string): string[] {
  const [major, minor] = version.split('.')
  const sites = [join(home, '.local', 'lib', `python${major}.${minor}`, 'site-packages'), join(home, 'AppData', 'Roaming', 'Python', `Python${major}${minor}`, 'site-packages')]
  for (const site of sites) {
    mkdirSync(site, { recursive: true })
    writeFileSync(join(site, 'planted_by_forge_test.py'), 'PLANTED = True\n')
  }
  return sites
}

/** The PackFs the job runs on, with the downloads kept (hard links) before `downloads/` goes, when asked. */
function keepingFs(fs: PackFs, downloads: string, keepIn: string | null): PackFs {
  if (!keepIn) return fs
  return {
    ...fs,
    rm: async (path, options) => {
      if (resolve(path) === resolve(downloads) && existsSync(path)) {
        for (const n of readdirSync(downloads)) {
          for (const name of readdirSync(join(downloads, n))) {
            if (name.endsWith('.part')) continue
            mkdirSync(join(keepIn, n), { recursive: true })
            if (!existsSync(join(keepIn, n, name))) linkSync(join(downloads, n, name), join(keepIn, n, name))
          }
        }
      }
      return fs.rm(path, options)
    }
  }
}


/** A pack.json, parsed as the app reads it (venv.ts reads FORGE_HELPER_PACK's the same way). */
function receiptOf(versionDir: string): unknown {
  try {
    return receiptFromText(readFileSync(join(versionDir, 'pack.json'), 'utf8'))
  } catch {
    return null
  }
}

/** Install the pack with the app's own job, or, over a pack this build accepts (CI's cache), run the job's Check again. */
async function begin(): Promise<Run> {
  const platform = thisMachine()
  const scratch = mkdtempSync(join(tmpdir(), 'forge-pack-'))
  // A space and a non-ASCII character, as a user's profile name can have (CI's FORGE_PACK_USERDATA has both too).
  const userData = USERDATA ?? join(scratch, 'Forge Bräutigam', 'userData')
  mkdirSync(userData, { recursive: true })
  const cached = cachedPackIn(USERDATA, { mutation: MUTATION, platform: process.platform, arch: process.arch, exists: existsSync, receiptOf })
  const mode: Run['mode'] = 'cached' in cached ? 'cached' : 'install'
  const why = 'cached' in cached ? `a pack this build accepts is already at ${cached.cached.versionDir}` : cached.install
  const { manifest, sidecarDir } = inputsFor(platform, scratch)
  const root = packRoot(userData, true)
  const versionDir = join(root, String(manifest.pack))
  const downloads = join(root, 'downloads')
  const pack = manifest.platforms[platform]
  // A pack this build does not accept in the named userData (a stale receipt, a partial): this run is a FRESH
  // install, as CI's is from an empty cache, never the app's Update over it (whose helper calls differ).
  if (mode === 'install' && USERDATA && existsSync(root)) rmSync(root, { recursive: true, force: true })

  // Seeded from a kept folder: the job finds each file verified and fetches nothing.
  const seeded: string[] = mode === 'cached' ? [pack.interpreter, ...pack.wheels].map((f) => f.name) : []
  if (mode === 'install' && DOWNLOADS_KEPT && existsSync(join(DOWNLOADS_KEPT, String(manifest.pack)))) {
    const into = join(downloads, String(manifest.pack))
    mkdirSync(into, { recursive: true })
    for (const file of [pack.interpreter, ...pack.wheels]) {
      const from = join(DOWNLOADS_KEPT, String(manifest.pack), file.name)
      if (existsSync(from)) {
        linkSync(from, join(into, file.name))
        seeded.push(file.name)
      }
    }
  }

  const home = MUTATION === 'user-site' ? join(scratch, 'home') : null
  if (home) plantUserSite(home, manifest.python.version)

  const s = statfsSync(userData)
  const free = { bavail: Number(s.bavail), bfree: Number(s.bfree), bsize: Number(s.bsize) }
  const dfAvail = process.platform === 'win32' ? null : Number(execFileSync('df', ['-k', userData], { encoding: 'utf8' }).trim().split('\n').at(-1)!.split(/\s+/)[3]) * 1024
  const needed = spaceNeeded(bytesLeft(manifest, platform, {}), pack.bytesOnDisk)

  const started = Date.now()
  const t = (): number => Date.now() - started
  const progress: Run['progress'] = []
  const statuses: Run['statuses'] = []
  const logs: Run['logs'] = []
  const helperEvents: string[] = []
  const pipTicks: Run['pipTicks'] = []
  const pipReports: Run['pipReports'] = []
  let captured: PackCheck | null = null
  let firstHelloMs: number | null = null

  const helper: HelperControl = {
    busy: () => false,
    whenIdle: async () => {
      helperEvents.push('idle')
    },
    stop: async () => {
      helperEvents.push('stop')
    },
    hold: () => {
      helperEvents.push('hold')
      return () => helperEvents.push('release')
    },
    restart: async () => {
      helperEvents.push('restart')
    }
  }

  const workers = helperWorkers()
  const deps: HelperPackDeps = {
    ...workers,
    pip: async (o) => {
      // The bar's measure (row 34): what a 500 ms poll sees, beside what runPip reports.
      const before = distInfoCount(o.sitePackages)
      const tick = setInterval(() => pipTicks.push({ t: t(), count: distInfoCount(o.sitePackages) - before }), 500)
      try {
        await runPip({ ...o, onProgress: (done, total, line) => (pipReports.push({ t: t(), done, total, line }), o.onProgress(done, total, line)) })
      } finally {
        clearInterval(tick)
        pipTicks.push({ t: t(), count: distInfoCount(o.sitePackages) - before })
      }
    },
    check: async (o) => {
      // The first start of the pack (row 29's shape: after an install, or here the first of this run): timed alone, then the real check.
      const first = new SidecarClient({ cwd: o.sidecarDir, launch: o.launch, maxRestarts: 0 })
      const at = Date.now()
      try {
        await first.start()
        firstHelloMs = Date.now() - at
      } finally {
        await first.stop()
      }
      captured = await checkPack(o)
      return captured
    },
    userData,
    root,
    manifest,
    platform,
    sidecarDir,
    appVersion: 'helperPack.int',
    fetch: globalThis.fetch,
    spawn,
    fs: keepingFs(appPackFs(), downloads, DOWNLOADS_KEPT),
    now: Date.now,
    isAlive: pidAlive,
    pid: process.pid,
    helper,
    launchFor: (dir) => launchOf(dir, manifest, platform, userData, home),
    onStatus: (status: SidecarStatus) => {
      if (status.state === 'installing') statuses.push({ t: t(), stage: status.stage })
    },
    onProgress: (p, text) => progress.push({ t: t(), p, text }),
    log: (line) => logs.push({ t: t(), line })
  }
  expect(workers.fetchVerified).toBeTypeOf('function')

  const jobs = createHelperPackJobs(deps)
  let job: Job | null = null
  let checkError: string | null = null
  if (mode === 'cached') {
    try {
      await jobs.checkAgain()
    } catch (err) {
      checkError = err instanceof Error ? err.message : String(err)
    }
  } else {
    const queued = jobs.install()
    job = await new Promise<Job>((done) => {
      const look = (): void => {
        const now = jobs.queue.list().find((j) => j.id === queued.id)
        if (now && (now.status === 'done' || now.status === 'failed' || now.status === 'cancelled')) {
          clearInterval(timer)
          done(now)
        }
      }
      const timer = setInterval(look, 250)
    })
  }
  return {
    mode,
    why,
    scratch,
    userData,
    root,
    versionDir,
    sidecarDir,
    manifest,
    platform,
    job,
    checkError,
    started,
    progress,
    statuses,
    logs,
    helperEvents,
    check: captured,
    firstHelloMs,
    pipTicks,
    pipReports,
    launch: launchOf(versionDir, manifest, platform, userData, home),
    free,
    dfAvail,
    needed,
    seeded,
    endedAt: job?.finishedAt ?? Date.now()
  }
}

const title = 'the AI helper pack, installed from the real hosts by the app’s own job (CLIPS §3a.7)'

const gate = packSuiteGate({ real: REAL, askedUserData: ASKED_USERDATA })

if ('skip' in gate) describe.skip(`${title} — skipped: ${gate.skip}`, () => it('installs the pack', () => undefined))
else if ('fail' in gate)
  describe(title, () => {
    it('runs, since CI’s pack step asked for it', () => {
      throw new Error(gate.fail)
    })
  })
else
  describe(`${title}${MUTATION ? ` — MUTATION ${MUTATION}: this run must fail` : ''}`, () => {
    let run: Run
    let hello: HelloResult
    let receipt: PackReceipt & { problems?: string[]; integrity?: string[] }
    /** What the tests found along the way, for the README. */
    const found: string[] = []
    let out: string
    const cachedMode = (): boolean => run.mode === 'cached'

    beforeAll(async () => {
      out = await outputDir(MUTATION ? `helper-pack-${MUTATION}` : 'helper-pack')
      run = await begin()
      found.push(`mode: ${run.mode} (${run.why})`)
      if (run.mode === 'cached' ? run.checkError === null : run.job!.status === 'done') {
        receipt = JSON.parse(readFileSync(join(run.versionDir, 'pack.json'), 'utf8')) as typeof receipt
        // A start of the installed pack of the test's own, as the service would make it: hello's own words.
        const client = new SidecarClient({ cwd: run.sidecarDir, launch: run.launch, maxRestarts: 0 })
        try {
          hello = await client.start()
        } finally {
          await client.stop()
        }
      }
    }, 45 * 60_000)

    afterAll(() => {
      if (!run) return
      const stageAt = (label: string): number | undefined => run.statuses.find((s) => s.stage === label)?.t
      const end = run.endedAt - run.started
      const stages = INSTALL_STAGES.map((s, i) => {
        const from = stageAt(s.label)
        const next = INSTALL_STAGES.slice(i + 1).map((n) => stageAt(n.label)).find((x) => x !== undefined) ?? end
        return { label: s.label, from, ms: from === undefined ? undefined : next - from }
      })
      const pack = run.manifest.platforms[run.platform]
      const fetched = packBytes(pack)
      const dl = stages[1].ms
      const tree = existsSync(run.versionDir) ? walk(run.versionDir) : { files: [], dirs: [] }
      const longestPath = Math.max(0, ...tree.files.map((f) => f.length))
      const longestDir = Math.max(0, ...tree.dirs.map((d) => d.length))
      // `du` is not on a Windows runner's PATH; the receipt's bytesOnDisk is the job's own count there.
      const du = existsSync(run.versionDir) && process.platform !== 'win32' ? Number(execFileSync('du', ['-sk', run.versionDir], { encoding: 'utf8' }).split(/\s/)[0]) * 1024 : null
      const unpacked = run.logs.find((l) => l.line.startsWith('[helper] unpacked'))
      const unpackFrom = stageAt(INSTALL_STAGES[2].label)
      const pipFrom = stageAt(INSTALL_STAGES[3].label)
      const outcome = run.mode === 'cached' ? `check again: ${run.checkError ?? 'passed'}` : `job: ${run.job!.status}${run.job!.error ? ` — ${run.job!.error}` : ''}`
      const notes = [
        outcome,
        `userData: ${run.userData}`,
        `version folder: ${run.versionDir}`,
        `platform: ${run.platform}; python ${run.manifest.python.version}; pack ${run.manifest.pack}${MUTATION ? `; MUTATION ${MUTATION}` : ''}`,
        `free (statfs on userData): bavail ${run.free.bavail} × ${run.free.bsize} = ${run.free.bavail * run.free.bsize} B; bfree ${run.free.bfree} × ${run.free.bsize} = ${run.free.bfree * run.free.bsize} B`,
        `df -k "Avail" on userData, read right after: ${run.dfAvail ?? '-'} B`,
        `space needed for a fresh install (spaceNeeded): ${run.needed} B`,
        '',
        'stages (ms from the press):',
        ...stages.map((s) => `  ${s.label}: from ${s.from ?? '-'} for ${s.ms ?? '-'} ms`),
        `  whole ${run.mode === 'cached' ? 'check again' : 'job'}: ${end} ms`,
        `download: ${run.mode === 'cached' ? 0 : fetched} B in ${dl ?? '-'} ms = ${dl ? ((fetched / 1048576) / (dl / 1000)).toFixed(2) : '-'} MiB/s`,
        `unpack: ${unpacked && unpackFrom !== undefined ? unpacked.t - unpackFrom : '-'} ms (${unpacked?.line ?? '-'}); the stdlib compile: ${unpacked && pipFrom !== undefined ? pipFrom - unpacked.t : '-'} ms`,
        `first start's hello (before the check's own): ${run.firstHelloMs ?? '-'} ms`,
        `self-test (the check's): ${run.check ? SELFTEST_GROUP_NAMES.map((g) => `${g} ${run.check!.selftest[g]?.ms} ms exit ${run.check!.selftest[g]?.exit}`).join(', ') : '-'}`,
        `check problems: ${run.check ? JSON.stringify(run.check.problems) : '-'}`,
        `receipt bytesOnDisk (apparent): ${receipt?.bytesOnDisk ?? '-'} B; du -sk of the version folder: ${du ?? '-'} B`,
        `longest relative path: ${longestPath}; longest directory: ${longestDir}; files ${tree.files.length}, folders ${tree.dirs.length}`,
        `helper calls: ${run.helperEvents.join(' → ')}`,
        ...found,
        '',
        'pip (row 34): what runPip reported, then what a 500 ms poll saw',
        ...run.pipReports.map((r) => `  ${r.t} ms: ${r.done} of ${r.total}${r.line ? ` · ${r.line}` : ''}`),
        `  ticks: ${run.pipTicks.map((k) => `${k.t}:${k.count}`).join(' ')}`,
        '',
        'statuses:',
        ...run.statuses.map((s) => `  ${s.t} ms: ${s.stage}`),
        '',
        'log:',
        ...run.logs.map((l) => `  ${l.t} ms: ${l.line}`),
        '',
        'progress (each change of text kind, and every 1 %):',
        ...run.progress
          .filter((p, i, all) => i === 0 || kindOf(p.text) !== kindOf(all[i - 1].text) || Math.floor(p.p * 100) !== Math.floor(all[i - 1].p * 100))
          .map((p) => `  ${p.t} ms: ${(p.p * 100).toFixed(2)} % ${p.text ?? ''}`)
      ]
      writeFileSync(join(out, 'README.txt'), `${notes.join('\n')}\n`, 'utf8')
      console.log(notes.slice(0, 23 + found.length).join('\n'))
      // The stage times, the first hello and the self-test (§3a.8 rows 27, 29, 37), readable without signing in: one notice (helperDiag.ts).
      const at = notes.indexOf('stages (ms from the press):')
      ciNotice(
        `helperPack.int: ${run.mode === 'cached' ? 'the cached pack checked again' : 'the install'} on ${run.platform}`,
        [notes[0], notes[3], ...notes.slice(at, at + 1 + stages.length + 9)].join('\n')
      )
      // CI's userData is the cache's and the later steps': never removed. A scratch one goes unless kept.
      if (!KEEP) rmSync(run.scratch, { recursive: true, force: true })
    })

    it('reaches done (or, over the cached pack, passes Check again), and asks the helper to switch only after', () => {
      if (cachedMode()) {
        expect(run.checkError, run.logs.map((l) => l.line).join('\n')).toBeNull()
        // Check again stops nothing and holds nothing: it rewrites the receipt and restarts the helper.
        expect(run.helperEvents).toEqual(['restart'])
        return
      }
      expect(run.job!.error, run.logs.map((l) => l.line).join('\n')).toBeNull()
      expect(run.job!.status).toBe('done')
      // A fresh install stops nothing and holds nothing: it waits for idle and restarts.
      expect(run.helperEvents).toEqual(['idle', 'restart'])
    })

    it('logs the host each fetched file came from after its redirects: the interpreter from GitHub’s release assets, the wheels from PyPI’s files (§3a.5)', () => {
      const pack = run.manifest.platforms[run.platform]
      const fetched = [pack.interpreter, ...pack.wheels].filter((f) => !run.seeded.includes(f.name))
      found.push(`fetched from the network: ${fetched.length} of ${pack.wheels.length + 1} files (the rest seeded${cachedMode() ? ': the cached pack' : ''})`)
      // Over the cached pack nothing is fetched, and nothing says it was.
      if (cachedMode()) expect(run.logs.filter((l) => / came from /.test(l.line)).map((l) => l.line)).toEqual([])
      for (const file of fetched) {
        const host = file === pack.interpreter ? 'release-assets.githubusercontent.com' : 'files.pythonhosted.org'
        const line = run.logs.find((l) => l.line.startsWith(`${file.name} came from `))?.line
        expect(line, file.name).toBe(`${file.name} came from ${host}: ${file.bytes} B, its sha256 verified`)
        if (file === pack.interpreter) found.push(`interpreter: ${line}`)
      }
    })

    it('writes a receipt that parses and matches the manifest, with no problems recorded', () => {
      expect(parseReceipt(receipt)).not.toBeNull()
      expect(receiptMatches(receipt, run.manifest, run.platform)).toBe(true)
      expect(receipt.problems, JSON.stringify(receipt.problems)).toBeUndefined()
      // §16.51's integrity problems (a Python path outside the pack, another Python), once the receipt carries them: none.
      expect(receipt.integrity ?? [], JSON.stringify(receipt.integrity)).toEqual([])
      expect(receipt.bytesOnDisk).toBeGreaterThan(0)
    })

    it('runs from inside its own folder: executable, prefix and EVERY sys.path entry, by path.relative on real paths', () => {
      // From the test's own start and from the job's check: both are the pack rung's launch.
      const roots = [real(run.versionDir), real(run.sidecarDir)]
      for (const h of [hello, run.check?.hello]) {
        expect(h).toBeTruthy()
        const outside = [h!.executable, h!.prefix, ...h!.path].filter((p) => !roots.some((root) => inside(root, real(resolve(run.sidecarDir, p)))))
        expect(outside, `outside ${roots.join(' and ')}`).toEqual([])
        expect(inside(real(run.versionDir), real(h!.executable))).toBe(true)
      }
    })

    it('is the manifest’s Python, with every method the platform expects', () => {
      expect(hello.python).toBe(run.manifest.python.version)
      const expects = run.manifest.platforms[run.platform].expects
      const missing = expects.filter((m) => !hello.capabilities.includes(m)).map((m) => `${m}: ${hello.degraded[m] ?? 'not registered'}`)
      expect(missing).toEqual([])
    })

    it('passes every self-test group, in a fresh process each', () => {
      const failed = SELFTEST_GROUP_NAMES.filter((g) => run.check!.selftest[g]?.exit !== 0).map((g) => `${g}: ${run.check!.selftest[g]?.exit} ${run.check!.selftest[g]?.error}`)
      expect(failed).toEqual([])
      expect(Object.values(receipt.selftest).every((v) => v === 'ok'), JSON.stringify(receipt.selftest)).toBe(true)
      expect(Object.keys(receipt.selftest)).toEqual([...SELFTEST_GROUP_NAMES])
    })

    it('degrades stems and the local voice, each with its reason', () => {
      for (const method of [SIDECAR_METHODS.stems, SIDECAR_METHODS.voiceSpeak, SIDECAR_METHODS.voiceVoices]) {
        expect(hello.capabilities, method).not.toContain(method)
        expect(typeof hello.degraded[method], method).toBe('string')
        expect(hello.degraded[method].length, method).toBeGreaterThan(0)
      }
    })

    it('pip check inside the pack reports nothing but mediapipe’s two (and hf-xet once the lock leaves it out)', () => {
      const python = join(run.versionDir, run.manifest.platforms[run.platform].python)
      const checked = spawnSync(python, ['-E', '-s', '-m', 'pip', 'check', '--disable-pip-version-check'], { cwd: run.scratch, env: run.launch.env, encoding: 'utf8', windowsHide: true })
      const lines = `${checked.stdout}`.split(/\r?\n/).filter((line) => line.trim() !== '')
      found.push(`pip check (exit ${checked.status}): ${JSON.stringify(lines)}`)
      // Membership, not a count: none at all ("No broken requirements found.", exit 0) is right too.
      const reported = lines.filter((line) => line.trim() !== 'No broken requirements found.')
      expect(checked.status, `${checked.stderr}${lines.join('\n')}`).toBe(reported.length === 0 ? 0 : 1)
      expect(pipCheckProblems(lines, run.manifest.platforms[run.platform].wheels)).toEqual([])
    })

    it('reports progress that never goes down, through the stages in order (over the cached pack: no install stage at all)', () => {
      if (cachedMode()) {
        expect(run.statuses).toEqual([])
        expect(run.progress).toEqual([])
        return
      }
      const values = run.progress.map((p) => p.p)
      const down = values.findIndex((v, i) => i > 0 && v < values[i - 1])
      expect(down, down >= 0 ? `${values[down - 1]} then ${values[down]} at ${run.progress[down].t} ms` : '').toBe(-1)
      expect(values.at(-1)).toBe(1)
      const kinds = run.progress.map((p) => kindOf(p.text)).filter((k): k is string => k !== null)
      expect(kinds.filter((k, i) => i === 0 || k !== kinds[i - 1])).toEqual([CHECKING_SPACE, 'downloading', UNPACKING_PYTHON, 'installing libraries', CHECKING_THE_HELPER])
      expect(run.statuses.map((s) => s.stage)).toEqual(INSTALL_STAGES.map((s) => s.label))
      // The check's column names its slow first start, then each self-test group as it runs, in the self-test's order.
      const texts = run.progress.map((p) => p.text)
      expect(texts).toContain(CHECKING_STARTING)
      const groups = SELFTEST_GROUP_NAMES.map((g) => texts.indexOf(checkingGroupText(g)))
      expect(groups.every((at) => at >= 0), JSON.stringify(Object.fromEntries(SELFTEST_GROUP_NAMES.map((g, i) => [g, groups[i]])))).toBe(true)
      expect([...groups].sort((a, b) => a - b)).toEqual(groups)
    })

    it('leaves no downloads and no lock behind', () => {
      expect(existsSync(join(run.root, 'downloads'))).toBe(false)
      expect(existsSync(lockPath(run.root))).toBe(false)
      expect(readdirSync(run.root).sort()).toEqual([String(run.manifest.pack)])
    })

    it('holds no numba cache of its own: no .nbi or .nbc anywhere in the version folder (§16.52)', () => {
      /*
       * numba's cache belongs under helper-cache (NUMBA_CACHE_DIR, helperLaunch).
       * Over CI's restored pack this is what catches a suite run from the pack
       * with no cache folder (venv.ts packLaunch): numba wrote its cache into
       * the pack's librosa folders, and actions/cache saved the drifted tree.
       */
      const found: string[] = []
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name)
          if (entry.isDirectory()) walk(path)
          else if (/\.nb[ic]$/.test(entry.name)) found.push(path)
        }
      }
      walk(run.versionDir)
      expect(found.length, found.slice(0, 5).join('\n')).toBe(0)
    })

    it('installs one dist-info per lock line, as the bar counts them', () => {
      const pack = run.manifest.platforms[run.platform]
      const lines = lockLineCount(readFileSync(join(run.sidecarDir, ...pack.lock.file.split('/')), 'utf8'))
      expect(lines).toBe(pack.wheels.length)
      if (!cachedMode()) expect(run.pipReports.at(-1)).toMatchObject({ done: lines, total: lines })
      expect(distInfoCount(sitePackagesOf(run.versionDir, run.manifest, run.platform))).toBeGreaterThanOrEqual(lines)
    })
  })

/**
 * What a progress text is, without its numbers or its part: the check's
 * texts ("checking the AI helper · starting (the first start is slow)",
 * "checking the AI helper · beats", src/shared/sidecar/install.ts) are one
 * kind, the stage's, as the downloads' and pip's are.
 */
function kindOf(text: string | null): string | null {
  if (text === null) return null
  if (text.startsWith('downloading')) return 'downloading'
  if (text.startsWith('installing libraries')) return 'installing libraries'
  if (text.startsWith(CHECKING_THE_HELPER)) return CHECKING_THE_HELPER
  return text
}
