import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { HELPER_PACK } from '../../src/shared/sidecar/packManifest'
import { isUnsupported, packBytes, packPlatform, parseReceipt, receiptMatches, type HelperPackManifest, type PackPlatform, type PackReceipt } from '../../src/shared/sidecar/pack'
import { helperLaunch, type HelperLaunch } from '../../src/shared/sidecar/helperPython'
import { SELFTEST_GROUP_NAMES } from '../../src/shared/sidecar/selftest'
import { SIDECAR_METHODS, type HelloResult } from '../../src/shared/sidecar/protocol'
import type { SidecarStatus } from '../../src/shared/sidecar/status'
import { CHECKING_SPACE, CHECKING_THE_HELPER, INSTALL_STAGES, UNPACKING_PYTHON, bytesLeft, spaceNeeded } from '../../src/shared/sidecar/install'
import { createHelperPackJobs, lockLineCount, sitePackagesOf, type HelperPackDeps } from '../../src/main/sidecar/install'
import { appPackFs, helperWorkers } from '../../src/main/sidecar/installDeps'
import { checkPack } from '../../src/main/sidecar/check'
import { runPip } from '../../src/main/sidecar/pip'
import { lockPath, pidAlive } from '../../src/main/sidecar/lock'
import { helperFolders, packRoot } from '../../src/main/sidecar/service'
import { SidecarClient } from '../../src/main/sidecar/client'
import type { HelperControl, PackCheck, PackFs } from '../../src/main/sidecar/installTypes'
import type { Job } from '../../src/shared/types'
import { outputDir } from './output'
import { SIDECAR_DIR } from './venv'

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
 * venv.ts' describeWithVenv does; CI runs it once §3a.6 lands. Behind an
 * HTTP(S) proxy Node's fetch needs `NODE_USE_ENV_PROXY=1` (§3a.5, measured).
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
  scratch: string
  userData: string
  root: string
  versionDir: string
  sidecarDir: string
  manifest: HelperPackManifest
  platform: PackPlatform
  job: Job
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
}

/** The manifest, and the folder the lock is read from, for this run (a mutation drops a package from both). */
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

async function install(): Promise<Run> {
  const platform = thisMachine()
  const scratch = mkdtempSync(join(tmpdir(), 'forge-pack-'))
  // A space and a non-ASCII character, as a user's profile name can have.
  const userData = join(scratch, 'Forge Bräutigam', 'userData')
  mkdirSync(userData, { recursive: true })
  const { manifest, sidecarDir } = inputsFor(platform, scratch)
  const root = packRoot(userData, true)
  const versionDir = join(root, String(manifest.pack))
  const downloads = join(root, 'downloads')
  const pack = manifest.platforms[platform]

  // Seeded from a kept folder: the job finds each file verified and fetches nothing.
  if (DOWNLOADS_KEPT && existsSync(join(DOWNLOADS_KEPT, String(manifest.pack)))) {
    const into = join(downloads, String(manifest.pack))
    mkdirSync(into, { recursive: true })
    for (const file of [pack.interpreter, ...pack.wheels]) {
      const from = join(DOWNLOADS_KEPT, String(manifest.pack), file.name)
      if (existsSync(from)) linkSync(from, join(into, file.name))
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
      // The first start of the new pack (row 29's shape, on this Mac): timed alone, then the real check.
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
  const queued = jobs.install()
  const job = await new Promise<Job>((done) => {
    const look = (): void => {
      const now = jobs.queue.list().find((j) => j.id === queued.id)
      if (now && (now.status === 'done' || now.status === 'failed' || now.status === 'cancelled')) {
        clearInterval(timer)
        done(now)
      }
    }
    const timer = setInterval(look, 250)
  })
  return {
    scratch,
    userData,
    root,
    versionDir,
    sidecarDir,
    manifest,
    platform,
    job,
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
    needed
  }
}

const describeReal = REAL ? describe : describe.skip
const title = 'the AI helper pack, installed from the real hosts by the app’s own job (CLIPS §3a.7)'

describeReal(REAL ? `${title}${MUTATION ? ` — MUTATION ${MUTATION}: this run must fail` : ''}` : `${title} — skipped: FORGE_PACK_REAL is not 1`, () => {
  let run: Run
  let hello: HelloResult
  let receipt: PackReceipt & { problems?: string[] }
  /** What the tests found along the way, for the README. */
  const found: string[] = []
  let out: string

  beforeAll(async () => {
    out = await outputDir(MUTATION ? `helper-pack-${MUTATION}` : 'helper-pack')
    run = await install()
    if (run.job.status === 'done') {
      receipt = JSON.parse(readFileSync(join(run.versionDir, 'pack.json'), 'utf8')) as PackReceipt & { problems?: string[] }
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
    const end = (run.job.finishedAt ?? Date.now()) - run.started
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
    const du = existsSync(run.versionDir) ? Number(execFileSync('du', ['-sk', run.versionDir], { encoding: 'utf8' }).split(/\s/)[0]) * 1024 : 0
    const unpacked = run.logs.find((l) => l.line.startsWith('[helper] unpacked'))
    const unpackFrom = stageAt(INSTALL_STAGES[2].label)
    const pipFrom = stageAt(INSTALL_STAGES[3].label)
    const notes = [
      `job: ${run.job.status}${run.job.error ? ` — ${run.job.error}` : ''}`,
      `userData: ${run.userData}`,
      `version folder: ${run.versionDir}`,
      `platform: ${run.platform}; python ${run.manifest.python.version}; pack ${run.manifest.pack}${MUTATION ? `; MUTATION ${MUTATION}` : ''}`,
      `free (statfs on userData): bavail ${run.free.bavail} × ${run.free.bsize} = ${run.free.bavail * run.free.bsize} B; bfree ${run.free.bfree} × ${run.free.bsize} = ${run.free.bfree * run.free.bsize} B`,
      `df -k "Avail" on userData, read right after: ${run.dfAvail ?? '-'} B`,
      `space needed for a fresh install (spaceNeeded): ${run.needed} B`,
      '',
      'stages (ms from the press):',
      ...stages.map((s) => `  ${s.label}: from ${s.from ?? '-'} for ${s.ms ?? '-'} ms`),
      `  whole job: ${end} ms`,
      `download: ${fetched} B in ${dl ?? '-'} ms = ${dl ? ((fetched / 1048576) / (dl / 1000)).toFixed(2) : '-'} MiB/s`,
      `unpack: ${unpacked && unpackFrom !== undefined ? unpacked.t - unpackFrom : '-'} ms (${unpacked?.line ?? '-'}); the stdlib compile: ${unpacked && pipFrom !== undefined ? pipFrom - unpacked.t : '-'} ms`,
      `first start's hello (before the check's own): ${run.firstHelloMs ?? '-'} ms`,
      `self-test (the check's): ${run.check ? SELFTEST_GROUP_NAMES.map((g) => `${g} ${run.check!.selftest[g]?.ms} ms exit ${run.check!.selftest[g]?.exit}`).join(', ') : '-'}`,
      `check problems: ${run.check ? JSON.stringify(run.check.problems) : '-'}`,
      `receipt bytesOnDisk (apparent): ${receipt?.bytesOnDisk ?? '-'} B; du -sk of the version folder: ${du} B`,
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
    if (!KEEP) rmSync(run.scratch, { recursive: true, force: true })
  })

  it('reaches done, and asks the helper to switch only after', () => {
    expect(run.job.error, run.logs.map((l) => l.line).join('\n')).toBeNull()
    expect(run.job.status).toBe('done')
    // A fresh install stops nothing and holds nothing: it waits for idle and restarts.
    expect(run.helperEvents).toEqual(['idle', 'restart'])
  })

  it('writes a receipt that parses and matches the manifest, with no problems recorded', () => {
    expect(parseReceipt(receipt)).not.toBeNull()
    expect(receiptMatches(receipt, run.manifest, run.platform)).toBe(true)
    expect(receipt.problems, JSON.stringify(receipt.problems)).toBeUndefined()
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
    expect(hello.python).toBe('3.14.8')
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

  it('pip check inside the pack reports nothing but mediapipe’s two', () => {
    const python = join(run.versionDir, run.manifest.platforms[run.platform].python)
    const checked = spawnSync(python, ['-E', '-s', '-m', 'pip', 'check', '--disable-pip-version-check'], { cwd: run.scratch, env: run.launch.env, encoding: 'utf8', windowsHide: true })
    const lines = `${checked.stdout}`.split(/\r?\n/).filter((line) => line.trim() !== '')
    found.push(`pip check (exit ${checked.status}): ${JSON.stringify(lines)}`)
    // Membership, not a count: none at all ("No broken requirements found.", exit 0) is right too.
    const problems = lines.filter((line) => line !== 'No broken requirements found.')
    expect(checked.status, `${checked.stderr}${lines.join('\n')}`).toBe(problems.length === 0 ? 0 : 1)
    for (const line of problems) expect(line).toMatch(/^mediapipe \S+ requires (matplotlib|opencv-contrib-python), which is not installed\.$/)
  })

  it('reports progress that never goes down, through the stages in order', () => {
    const values = run.progress.map((p) => p.p)
    const down = values.findIndex((v, i) => i > 0 && v < values[i - 1])
    expect(down, down >= 0 ? `${values[down - 1]} then ${values[down]} at ${run.progress[down].t} ms` : '').toBe(-1)
    expect(values.at(-1)).toBe(1)
    const kinds = run.progress.map((p) => kindOf(p.text)).filter((k): k is string => k !== null)
    expect(kinds.filter((k, i) => i === 0 || k !== kinds[i - 1])).toEqual([CHECKING_SPACE, 'downloading', UNPACKING_PYTHON, 'installing libraries', CHECKING_THE_HELPER])
    expect(run.statuses.map((s) => s.stage)).toEqual(INSTALL_STAGES.map((s) => s.label))
  })

  it('leaves no downloads and no lock behind', () => {
    expect(existsSync(join(run.root, 'downloads'))).toBe(false)
    expect(existsSync(lockPath(run.root))).toBe(false)
    expect(readdirSync(run.root).sort()).toEqual([String(run.manifest.pack)])
  })

  it('installs one dist-info per lock line, as the bar counts them', () => {
    const pack = run.manifest.platforms[run.platform]
    const lines = lockLineCount(readFileSync(join(run.sidecarDir, ...pack.lock.file.split('/')), 'utf8'))
    expect(lines).toBe(pack.wheels.length)
    expect(run.pipReports.at(-1)).toMatchObject({ done: lines, total: lines })
    expect(distInfoCount(sitePackagesOf(run.versionDir, run.manifest, run.platform))).toBeGreaterThanOrEqual(lines)
  })
})

/** What a progress text is, without its numbers. */
function kindOf(text: string | null): string | null {
  if (text === null) return null
  if (text.startsWith('downloading')) return 'downloading'
  if (text.startsWith('installing libraries')) return 'installing libraries'
  return text
}
