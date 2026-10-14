import { afterAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import type { Job } from '../src/shared/types'
import type { HelloResult } from '../src/shared/sidecar/protocol'
import { packBytes, type HelperPackManifest, type PackFile, type PackPlatform, type PackReceipt } from '../src/shared/sidecar/pack'
import { resolveHelperPython, receiptFromText } from '../src/shared/sidecar/helperPython'
import { SELFTEST_GROUP_NAMES, VCRUNTIME_SENTENCE, degradedBySelftest, type SelftestResult } from '../src/shared/sidecar/selftest'
import type { SidecarStatus } from '../src/shared/sidecar/status'
import {
  HELPER_BEING_REPAIRED,
  HELPER_BUSY,
  HELPER_IN_USE_ELSEWHERE,
  HELPER_PRESET,
  HELPER_WORKING,
  INSTALL_STAGES,
  CHECKING_THE_HELPER,
  installProgress,
  WAITING_FOR_THE_HELPER,
  bytesLeft,
  spaceNeeded,
  spaceSentence
} from '../src/shared/sidecar/install'
import { createHelperPackJobs, lockLineCount, nodePackFs, type HelperPackJobs } from '../src/main/sidecar/install'
import { downloadedFiles } from '../src/main/sidecar/sweep'
import { checkPathBudget } from '../src/shared/sidecar/pathBudget'
import { lockPath } from '../src/main/sidecar/lock'
import type { CheckPack, FetchVerified, HelperControl, PackCheck, PackFs, RunPip, UnpackTarGz } from '../src/main/sidecar/installTypes'

/*
 * The AI helper's install job (docs/CLIPS.md §3a.3, §3a.7's helperPackJob
 * list), with every worker faked over a temp userData:
 *
 * - fetchVerified streams each file's bytes into `<name>.part` in random chunk
 *   sizes, counting them through onBytes, and renames it into place only when
 *   its sha256 is the manifest's; a file already there with its hash is
 *   skipped, as the real one's contract says. A "tampered" file is not the
 *   file. On a cancel it throws and LEAVES its .part, so the job's own
 *   clean-up is what is tested. The job re-hashes nothing: it trusts the path
 *   fetchVerified resolves with, so the hash check exercised here is the
 *   fake's, standing in for the real one's (tests/fetchFile.test.ts).
 * - unpack writes a tiny tree with a fake interpreter file; compileStdlib
 *   records its call; pip makes one dist-info folder per lock line and
 *   reports each; the check returns a hello and a self-test the test chooses.
 * - the HelperControl records every call in one ordered list, and can have a
 *   request in flight that its stop or restart rejects, as the real client's
 *   do.
 *
 * The manifest is a small one made here, with real sha256s of the fake
 * files, never the real HELPER_PACK.
 */

const scratch: string[] = []
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

/* ------------------------------------------------------------- helpers */

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: Error): void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function abortError(): Error {
  const err = new Error('This operation was aborted')
  err.name = 'AbortError'
  return err
}

const EXPECTS = ['asr.transcribe', 'audio.beats', 'depth.layers', 'vision.measure', 'vision.faces', 'vision.facesModel', 'vision.salient', 'vision.salientModel']

function hello(degraded: Record<string, string> = {}): HelloResult {
  return { protocolVersion: 1, python: '3.14.8', platform: 'test', capabilities: ['system.hello', ...EXPECTS], degraded, executable: '/x/python', prefix: '/x', path: [] }
}

function allOk(): SelftestResult {
  return Object.fromEntries(SELFTEST_GROUP_NAMES.map((g) => [g, { exit: 0, ms: 10, error: null }])) as SelftestResult
}

/* --------------------------------------------------------- the harness */

interface Hooks {
  /** Called after each chunk is written; may await (a gate) or cancel. */
  onChunk?(file: PackFile, at: number, signal: AbortSignal): Promise<void> | void
  onPip?(done: number, signal: AbortSignal): Promise<void> | void
  onCheck?(): void
}

interface Harness {
  userData: string
  root: string
  sidecarDir: string
  manifest: HelperPackManifest
  platform: PackPlatform
  files: PackFile[]
  contents: Map<string, Buffer>
  events: string[]
  /** Names actually streamed (not skipped as already verified). */
  fetched: string[]
  progress: { p: number; text: string | null }[]
  statuses: SidecarStatus[]
  logs: string[]
  hooks: Hooks
  tamper: Set<string>
  /** Files whose first try drops at 60 % and is streamed again, counting its bytes twice. */
  retryOnce: Set<string>
  pipFails: string | null
  checkRejects: string | null
  checkResult: PackCheck
  free: number
  renameRefused: (to: string) => boolean
  alive: Set<number>
  helper: FakeHelper
  jobs: HelperPackJobs
  /** The lock line count the bar uses. */
  lockLines: number
  versionDir: string
  dlDir: string
}

class FakeHelper implements HelperControl {
  inFlight: Deferred<string> | null = null
  /** Holds in force: a request asked during one is refused, as the service's getSidecar() refuses it. */
  private holds = 0
  constructor(private readonly events: string[]) {}

  /** A request out on the helper: finished by the test, or rejected by a stop or restart that did not wait. */
  startWork(): { promise: Promise<string>; finish(value: string): void } {
    if (this.holds > 0) {
      const refused = Promise.reject(new Error('refused by the hold'))
      refused.catch(() => undefined)
      return { promise: refused, finish: () => undefined }
    }
    const d = deferred<string>()
    this.inFlight = d
    const promise = d.promise.finally(() => {
      if (this.inFlight === d) this.inFlight = null
    })
    promise.catch(() => undefined)
    return { promise, finish: (value) => d.resolve(value) }
  }

  busy(): boolean {
    return this.inFlight !== null
  }

  whenIdle(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(abortError())
      const work = this.inFlight
      if (!work) {
        this.events.push('idle')
        return resolve()
      }
      signal.addEventListener('abort', () => reject(abortError()), { once: true })
      void work.promise.then(
        () => {
          this.events.push('idle')
          resolve()
        },
        () => resolve()
      )
    })
  }

  private cut(): void {
    this.inFlight?.reject(new Error('The AI helper is shutting down'))
    this.inFlight = null
  }

  async stop(): Promise<void> {
    this.events.push('stop')
    this.cut()
  }

  hold(_reason: string): () => void {
    this.events.push('hold')
    this.holds++
    let done = false
    return () => {
      if (done) return
      done = true
      this.holds--
      this.events.push('release')
    }
  }

  async restart(): Promise<void> {
    this.events.push('restart')
    this.cut()
  }
}

let seedCounter = 1

function makeHarness(o: { pack?: number; platform?: PackPlatform; seed?: number; maxChunk?: number } = {}): Harness {
  const seed = o.seed ?? seedCounter++
  const r = rng(seed)
  const userData = mkdtempSync(join(tmpdir(), 'forge-pack-'))
  scratch.push(userData)
  const root = join(userData, 'python')
  const sidecarDir = join(userData, 'app-sidecar')
  const platform = o.platform ?? 'darwin-arm64'
  const contents = new Map<string, Buffer>()
  const file = (name: string, size: number): PackFile => {
    const bytes = Buffer.alloc(size)
    for (let i = 0; i < size; i++) bytes[i] = Math.floor(r() * 256)
    contents.set(name, bytes)
    return { name, url: `https://files.pythonhosted.org/packages/xx/${name}`, bytes: size, sha256: sha(bytes) }
  }
  const interpreter = file('cpython-3.14.8+20261001-test-install_only_stripped.tar.gz', 30_000 + Math.floor(r() * 20_000))
  const wheels = ['alpha', 'beta', 'gamma'].map((n) => file(`${n}-1.0-py3-none-any.whl`, 6_000 + Math.floor(r() * 24_000)))
  const lockText = (p: PackPlatform): string =>
    [`# test lock for ${p}`, '# generated here', '', ...wheels.map((w) => `${w.name.split('-')[0]}==1.0 --hash=sha256:${w.sha256}`), ''].join('\n')
  mkdirSync(join(sidecarDir, 'pack'), { recursive: true })
  const platforms = {} as HelperPackManifest['platforms']
  for (const p of ['darwin-arm64', 'win32-x64'] as PackPlatform[]) {
    writeFileSync(join(sidecarDir, 'pack', `lock-${p}.txt`), lockText(p))
    platforms[p] = {
      interpreter,
      wheels,
      lock: { file: `pack/lock-${p}.txt`, sha256: sha(Buffer.from(lockText(p))) },
      python: p === 'win32-x64' ? 'python/python.exe' : 'python/bin/python3.14',
      expects: EXPECTS,
      bytesOnDisk: 400_000,
      longestPath: 80,
      longestDir: 60
    }
  }
  const manifest: HelperPackManifest = { pack: o.pack ?? 1, python: { version: '3.14.8', build: '20261001' }, platforms }
  const events: string[] = []
  const helper = new FakeHelper(events)
  const maxChunk = o.maxChunk ?? 4096

  const h = {
    userData,
    root,
    sidecarDir,
    manifest,
    platform,
    files: [interpreter, ...wheels],
    contents,
    events,
    fetched: [] as string[],
    progress: [] as { p: number; text: string | null }[],
    statuses: [] as SidecarStatus[],
    logs: [] as string[],
    hooks: {} as Hooks,
    tamper: new Set<string>(),
    retryOnce: new Set<string>(),
    pipFails: null as string | null,
    checkRejects: null as string | null,
    checkResult: { hello: hello(), selftest: allOk(), problems: [] } as PackCheck,
    free: 10 * 1024 ** 3,
    renameRefused: (_to: string) => false,
    alive: new Set<number>([100]),
    helper,
    lockLines: lockLineCount(lockText(platform)),
    versionDir: join(root, String(manifest.pack)),
    dlDir: join(root, 'downloads', String(manifest.pack))
  } as Omit<Harness, 'jobs'> as Harness

  const rel = (path: string): string => relative(root, path).split('\\').join('/')
  const real = nodePackFs()
  const fs: PackFs = {
    async rename(from, to) {
      if (h.renameRefused(to)) {
        const err = new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`) as NodeJS.ErrnoException
        err.code = 'EPERM'
        throw err
      }
      await real.rename(from, to)
      if (basename(to) === 'pack.json') events.push(`receipt:${rel(join(to, '..'))}`)
    },
    async rm(path, options) {
      events.push(basename(path) === 'pack.json' ? `unlink receipt:${rel(join(path, '..'))}` : `rm:${rel(path) || '.'}`)
      await real.rm(path, options)
    },
    createExclusive: (path, text) => real.createExclusive(path, text),
    freeBytes: async () => h.free
  }

  const fetchVerified: FetchVerified = async (f, dir, d) => {
    events.push(`verify:${f.name}`)
    const target = join(dir, f.name)
    if (existsSync(target) && sha(readFileSync(target)) === f.sha256) return target
    if (d.signal.aborted) throw abortError()
    h.fetched.push(f.name)
    const original = contents.get(f.name)!
    const body = h.tamper.has(f.name) ? Buffer.from(original.map((b) => b ^ 0xff)) : original
    const part = `${target}.part`
    const stream = async (upTo: number): Promise<void> => {
      writeFileSync(part, '')
      let at = 0
      while (at < upTo) {
        if (d.signal.aborted) throw abortError() // the .part is left behind: the job removes it
        const n = 1 + Math.floor(r() * maxChunk)
        const chunk = body.subarray(at, Math.min(upTo, at + n))
        appendFileSync(part, chunk)
        at += chunk.length
        d.onBytes(chunk.length)
        await h.hooks.onChunk?.(f, at, d.signal)
        await tick()
      }
    }
    if (h.retryOnce.has(f.name)) {
      h.retryOnce.delete(f.name)
      await stream(Math.floor(body.length * 0.6))
      d.onMessage?.(`files.pythonhosted.org dropped the connection, trying again (2 of 4)`)
    }
    await stream(body.length)
    if (sha(readFileSync(part)) !== f.sha256) {
      rmSync(part, { force: true })
      throw new Error(`something other than the file arrived from files.pythonhosted.org (${f.name}): its sha256 is not the one this build expects`)
    }
    await d.rename(part, target)
    // As the real one says where a file came from after its redirects (§3a.5).
    d.onMessage?.(`${f.name} came from ${new URL(f.url).hostname}: ${f.bytes} B, its sha256 verified`)
    return target
  }

  const unpack: UnpackTarGz = async (archive, into, u) => {
    events.push('unpack')
    ;(h as unknown as { unpackBudgets: unknown[] }).unpackBudgets.push(u.budget)
    if (!existsSync(archive)) throw new Error(`no archive at ${archive}`)
    if (u.signal.aborted) throw abortError()
    const python = join(into, platforms[platform].python)
    mkdirSync(join(python, '..'), { recursive: true })
    writeFileSync(python, '#!fake python\n')
    const stdlib = platform === 'win32-x64' ? join(into, 'python', 'Lib') : join(into, 'python', 'lib', 'python3.14')
    mkdirSync(stdlib, { recursive: true })
    writeFileSync(join(stdlib, 'os.py'), '# os\n')
    return { files: 2, bytes: 20, longestPath: 30, longestDir: 20 }
  }

  const compiled: { python: string; stdlib: string }[] = []
  const pip: RunPip = async (p) => {
    events.push('pip')
    mkdirSync(p.sitePackages, { recursive: true })
    for (let i = 1; i <= p.total; i++) {
      if (p.signal.aborted) throw abortError()
      if (h.pipFails && i === 2) throw new Error(h.pipFails)
      mkdirSync(join(p.sitePackages, `pkg${i}-1.0.dist-info`))
      p.onProgress(i, p.total, `Installing collected packages: pkg${i}`)
      await h.hooks.onPip?.(i, p.signal)
      await tick()
    }
  }

  const check: CheckPack = async (c) => {
    events.push('check')
    h.hooks.onCheck?.()
    if (c.signal.aborted) throw abortError()
    if (h.checkRejects) throw new Error(h.checkRejects)
    // As the real check reports it: the hello's share, then the self-test's groups, then 1.
    for (const f of [0.35, 0.7, 1]) c.onProgress?.(f)
    return h.checkResult
  }

  h.jobs = createHelperPackJobs({
    userData,
    root,
    manifest,
    platform,
    sidecarDir,
    appVersion: '0.1.0-test',
    fetch: (() => {
      throw new Error('the job must fetch only through fetchVerified')
    }) as unknown as typeof globalThis.fetch,
    retry: { attempts: 4, firstDelayMs: 1, budgetMs: 1000, checksumsAnswerMs: 100, binaryAnswerMs: 100, idleMs: 100 },
    spawn: (() => {
      throw new Error('the job must spawn only through its workers')
    }) as unknown as HarnessSpawn,
    fs,
    now: Date.now,
    isAlive: (pid) => h.alive.has(pid),
    pid: 100,
    fetchVerified,
    unpack,
    compileStdlib: async (c) => {
      events.push('compile')
      compiled.push({ python: c.python, stdlib: c.stdlib })
    },
    pip,
    check,
    helper,
    launchFor: (versionDir) => ({
      command: join(versionDir, platforms[platform].python),
      args: ['-E', '-s', '-u', '-B', '-m', 'forge_sidecar'],
      env: { FORGE_TEST: '1' },
      source: { kind: 'pack', pack: manifest.pack, root: versionDir }
    }),
    onStatus: (status) => h.statuses.push(status),
    onProgress: (p, text) => h.progress.push({ p, text }),
    log: (line) => h.logs.push(line)
  })
  ;(h as unknown as { compiled: typeof compiled }).compiled = compiled
  ;(h as unknown as { unpackBudgets: unknown[] }).unpackBudgets = []
  return h
}

type HarnessSpawn = Parameters<typeof createHelperPackJobs>[0]['spawn']

async function settled(h: Harness, id: string): Promise<Job> {
  for (;;) {
    const job = h.jobs.queue.list().find((j) => j.id === id)
    if (job && (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled')) return job
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

async function until(test: () => boolean): Promise<void> {
  while (!test()) await new Promise((resolve) => setTimeout(resolve, 2))
}

async function installed(h: Harness, options?: { repair?: boolean; update?: boolean }): Promise<Job> {
  const job = h.jobs.install(options)
  return settled(h, job.id)
}

const receiptOf = (dir: string): PackReceipt & { problems?: string[] } => JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'))

function plantReceipt(h: Harness, n: number, o: { matching: boolean; text?: string }): string {
  const dir = join(h.root, String(n))
  mkdirSync(join(dir, 'python'), { recursive: true })
  writeFileSync(join(dir, 'python', 'tree.txt'), 'old tree')
  const pack = h.manifest.platforms[h.platform]
  writeFileSync(
    join(dir, 'pack.json'),
    o.text ??
      JSON.stringify({
        pack: n,
        python: '3.14.8',
        build: '20261001',
        platform: h.platform,
        interpreterSha256: o.matching ? pack.interpreter.sha256 : 'a'.repeat(64),
        lockSha256: o.matching ? pack.lock.sha256 : 'b'.repeat(64)
      })
  )
  return dir
}

/** What the order would run from this root, in a packaged app with nothing else (§3a.2). */
function orderPicks(h: Harness): string {
  const python = join(h.versionDir, h.manifest.platforms[h.platform].python)
  const receiptFile = join(h.versionDir, 'pack.json')
  return resolveHelperPython({
    packaged: true,
    env: {},
    platform: process.platform,
    venvPython: null,
    pack: existsSync(receiptFile) ? { receipt: receiptFromText(readFileSync(receiptFile, 'utf8')), interpreterExists: existsSync(python), python, root: h.versionDir } : null,
    manifest: h.manifest,
    packPlatform: h.platform
  }).kind
}

const partsIn = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.part')) : [])

/* -------------------------------------------------------------- the job */

describe('a fresh install', () => {
  it('runs the stages in order, writes the receipt last with hello and the self-test, and removes the downloads', async () => {
    const h = makeHarness()
    const job = await installed(h)
    expect(job).toMatchObject({ status: 'done', presetId: HELPER_PRESET, inputName: 'the AI helper', params: { kind: 'install' }, error: null })
    const receipt = receiptOf(h.versionDir)
    const pack = h.manifest.platforms[h.platform]
    expect(receipt).toMatchObject({
      pack: 1,
      python: '3.14.8',
      build: '20261001',
      platform: h.platform,
      interpreterSha256: pack.interpreter.sha256,
      lockSha256: pack.lock.sha256,
      appVersion: '0.1.0-test',
      hello: { capabilities: hello().capabilities, degraded: {} }
    })
    expect(Object.values(receipt.selftest).every((v) => v === 'ok')).toBe(true)
    // Measured from the folder, not the manifest's placeholder.
    expect(receipt.bytesOnDisk).toBeGreaterThan(0)
    expect(receipt.bytesOnDisk).not.toBe(pack.bytesOnDisk)
    expect(existsSync(join(h.root, 'downloads')), '§16.47: the downloads go after a success').toBe(false)
    expect(existsSync(lockPath(h.root)), 'the lock is released').toBe(false)
    expect(orderPicks(h)).toBe('pack')
    // The stages, told to the service in order.
    expect(h.statuses.map((s) => (s.state === 'installing' ? s.stage : s.state))).toEqual(INSTALL_STAGES.map((s) => s.label))
    // pip got the pack's environment, its lock, the downloads and the bar's denominator.
    expect(h.lockLines).toBe(3)
    const order = h.events.filter((e) => ['unpack', 'compile', 'pip', 'check', 'restart'].includes(e) || e.startsWith('receipt:'))
    expect(order).toEqual(['unpack', 'compile', 'pip', 'check', 'receipt:1', 'restart'])
    const compiled = (h as unknown as { compiled: { python: string; stdlib: string }[] }).compiled
    expect(compiled).toEqual([{ python: join(h.versionDir, 'python', 'bin', 'python3.14'), stdlib: join(h.versionDir, 'python', 'lib', 'python3.14') }])
  })

  it('logs the host each file came from, in the fetcher’s own words (§3a.5)', async () => {
    const h = makeHarness()
    expect((await installed(h)).status).toBe('done')
    for (const f of h.files) expect(h.logs).toContain(`${f.name} came from files.pythonhosted.org: ${f.bytes} B, its sha256 verified`)
  })

  it('moves the bar through the check as the check reports it, the longest stage of a real install', async () => {
    const h = makeHarness()
    const job = await installed(h)
    expect(job.status, job.error ?? '').toBe('done')
    const checking = h.progress.filter((x) => x.text === CHECKING_THE_HELPER).map((x) => x.p)
    const four = (f: number): number => installProgress(4, f)
    // One ordered shape: the stage's start, the check's three reports at 0.9 of the stage, then the receipt.
    expect(checking).toEqual([four(0), four(0.9 * 0.35), four(0.9 * 0.7), four(0.9), four(0.9), four(0.95)])
  })

  it('never lets the bar go down across the stages: a property over random chunk sizes, a retried file and a resumed one', async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const h = makeHarness({ seed: 1000 + seed, maxChunk: 200 + (seed % 4) * 3000 })
      // A file already verified from an earlier press, and one whose first try drops part-way.
      const [interpreter, alpha, beta] = h.files
      mkdirSync(h.dlDir, { recursive: true })
      writeFileSync(join(h.dlDir, (seed % 2 ? alpha : interpreter).name), h.contents.get((seed % 2 ? alpha : interpreter).name)!)
      h.retryOnce.add(beta.name)
      const job = await installed(h)
      expect(job.status, `seed ${seed}: ${job.error}`).toBe('done')
      const ps = h.progress.map((x) => x.p)
      expect(ps.length).toBeGreaterThan(10)
      for (let i = 1; i < ps.length; i++) expect(ps[i], `seed ${seed}, report ${i}: ${h.progress[i].text}`).toBeGreaterThanOrEqual(ps[i - 1])
      expect(ps[ps.length - 1]).toBe(1)
      // The download stage's texts count bytes over every file.
      expect(h.progress.some((x) => x.text?.startsWith('downloading · '))).toBe(true)
    }
  })

  it('a file that is not the file fails the job, with no version folder and no receipt', async () => {
    const h = makeHarness()
    h.tamper.add(h.files[2].name)
    const job = await installed(h)
    expect(job.status).toBe('failed')
    expect(job.error).toContain('something other than the file arrived from files.pythonhosted.org')
    expect(existsSync(h.versionDir), 'no version folder').toBe(false)
    expect(h.events.some((e) => e.startsWith('receipt:'))).toBe(false)
    expect(h.events).not.toContain('unpack')
    // The files verified before it stay for the next press; no .part is left.
    expect(existsSync(join(h.dlDir, h.files[0].name))).toBe(true)
    expect(partsIn(h.dlDir)).toEqual([])
    expect(existsSync(lockPath(h.root))).toBe(false)
  })

  it('an install into a number whose folder exists without a receipt deletes it first', async () => {
    const h = makeHarness()
    mkdirSync(join(h.versionDir, 'python'), { recursive: true })
    writeFileSync(join(h.versionDir, 'python', 'left-over.txt'), 'a partial from a crash')
    const job = await installed(h)
    expect(job.status).toBe('done')
    expect(existsSync(join(h.versionDir, 'python', 'left-over.txt'))).toBe(false)
    expect(h.events.indexOf('rm:1')).toBeGreaterThan(-1)
    expect(h.events.indexOf('rm:1')).toBeLessThan(h.events.findIndex((e) => e.startsWith('verify:')))
  })

  it('refuses a version folder past Windows’ path budget before anything is fetched, and hands the budget to the unpacker', async () => {
    const h = makeHarness({ platform: 'win32-x64' })
    const pack = h.manifest.platforms['win32-x64']
    pack.longestPath = 400
    const job = await installed(h)
    expect(job.status).toBe('failed')
    expect(job.error).toBe(checkPathBudget({ root: h.versionDir, longestPath: 400, longestDir: pack.longestDir, platform: 'win32' }))
    expect(h.fetched).toEqual([])
    // Within the budget, the unpacker is given it too.
    pack.longestPath = 80
    expect((await installed(h)).status).toBe('done')
    expect((h as unknown as { unpackBudgets: unknown[] }).unpackBudgets).toEqual([{ longestPath: 80, longestDir: pack.longestDir }])
  })

  it('two presses are one job', async () => {
    const h = makeHarness()
    const first = h.jobs.install()
    const second = h.jobs.install()
    expect(second.id).toBe(first.id)
    expect(h.jobs.queue.list()).toHaveLength(1)
    expect(h.jobs.busy()).toBe(true)
    await settled(h, first.id)
    expect(h.jobs.busy()).toBe(false)
  })

  it('fails with the free-space sentence when the disk cannot hold what is left to fetch, the pack and 10 %', async () => {
    const h = makeHarness()
    h.free = 1000
    const job = await installed(h)
    const pack = h.manifest.platforms[h.platform]
    expect(job.status).toBe('failed')
    expect(job.error).toBe(spaceSentence(spaceNeeded(packBytes(pack), pack.bytesOnDisk), 1000, 'this disk'))
    expect(h.fetched).toEqual([])
  })

  it('takes over a stale lock: its pid is not alive', async () => {
    const h = makeHarness()
    mkdirSync(h.root, { recursive: true })
    writeFileSync(lockPath(h.root), JSON.stringify({ pid: 4242, startedAt: 1 }))
    const job = await installed(h)
    expect(job.status, job.error ?? '').toBe('done')
  })

  it('refuses while another live instance holds the lock, and touches nothing', async () => {
    const h = makeHarness()
    mkdirSync(h.root, { recursive: true })
    writeFileSync(lockPath(h.root), JSON.stringify({ pid: 4242, startedAt: 1 }))
    h.alive.add(4242)
    const job = await installed(h)
    expect(job.status).toBe('failed')
    expect(job.error).toBe(HELPER_IN_USE_ELSEWHERE)
    expect(h.fetched).toEqual([])
    expect(JSON.parse(readFileSync(lockPath(h.root), 'utf8')).pid).toBe(4242)
  })
})

describe('a cancel', () => {
  it('mid-download keeps the verified files and no .part; the next press fetches only the missing ones', async () => {
    const h = makeHarness()
    const [interpreter, alpha, beta] = h.files
    let id = ''
    h.hooks.onChunk = (file, at) => {
      if (file.name === beta.name && at > file.bytes / 2 && id) h.jobs.cancel(id)
    }
    id = h.jobs.install().id
    const job = await settled(h, id)
    expect(job.status).toBe('cancelled')
    expect(readdirSync(h.dlDir).sort()).toEqual([interpreter.name, alpha.name].sort())
    expect(partsIn(h.dlDir)).toEqual([])
    expect(existsSync(h.versionDir)).toBe(false)
    expect(existsSync(lockPath(h.root))).toBe(false)
    // The offer's "· N MB left": the manifest's bytes less the files present.
    const pack = h.manifest.platforms[h.platform]
    expect(bytesLeft(h.manifest, h.platform, downloadedFiles(h.dlDir, pack))).toBe(packBytes(pack) - interpreter.bytes - alpha.bytes)
    // The next press.
    h.hooks.onChunk = undefined
    h.fetched.length = 0
    const again = await installed(h)
    expect(again.status).toBe('done')
    expect(h.fetched, 'only what was missing is fetched').toEqual(h.files.slice(2).map((f) => f.name))
  })

  it('after the download removes the version folder and keeps the downloads', async () => {
    const h = makeHarness()
    let id = ''
    h.hooks.onPip = (done) => {
      if (done === 2) h.jobs.cancel(id)
    }
    id = h.jobs.install().id
    const job = await settled(h, id)
    expect(job.status).toBe('cancelled')
    expect(existsSync(h.versionDir)).toBe(false)
    expect(readdirSync(h.dlDir).sort()).toEqual(h.files.map((f) => f.name).sort())
    expect(orderPicks(h)).toBe('absent')
  })

  it('a quit cancels the job and releases the lock at once', async () => {
    const h = makeHarness()
    const gate = deferred<void>()
    h.hooks.onChunk = (_file, _at, signal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true })
        void gate.promise.then(resolve)
      })
    const id = h.jobs.install().id
    await until(() => h.fetched.length > 0)
    expect(existsSync(lockPath(h.root))).toBe(true)
    h.jobs.quit()
    expect(existsSync(lockPath(h.root)), 'released synchronously, before the job’s own clean-up').toBe(false)
    expect((await settled(h, id)).status).toBe('cancelled')
  })
})

describe('when a later stage fails', () => {
  it('pip failing leaves no receipt, the order does not pick the folder, and the downloads stay for an offline retry', async () => {
    const h = makeHarness()
    h.pipFails = 'pip failed: Failed to build nothing'
    const job = await installed(h)
    expect(job.status).toBe('failed')
    expect(job.error).toBe('pip failed: Failed to build nothing')
    expect(existsSync(join(h.versionDir, 'pack.json'))).toBe(false)
    expect(orderPicks(h)).toBe('absent')
    expect(readdirSync(h.dlDir).sort()).toEqual(h.files.map((f) => f.name).sort())
  })

  it('the receipt’s rename refused past its retries fails the job and leaves no pack.json', async () => {
    const h = makeHarness()
    h.renameRefused = (to) => basename(to) === 'pack.json'
    const job = await installed(h)
    expect(job.status).toBe('failed')
    expect(job.error).toContain("The AI helper's install record could not be written")
    expect(existsSync(join(h.versionDir, 'pack.json'))).toBe(false)
    expect(existsSync(join(h.versionDir, 'pack.json.part'))).toBe(false)
    expect(orderPicks(h)).toBe('absent')
  })

  it('a helper that does not start from the new folder removes it and fails with the reason', async () => {
    const h = makeHarness()
    h.checkRejects = 'The AI helper did not answer within 90 s'
    const job = await installed(h)
    expect(job.status).toBe('failed')
    expect(job.error).toContain('The AI helper did not answer within 90 s')
    expect(existsSync(h.versionDir)).toBe(false)
    expect(existsSync(h.dlDir)).toBe(true)
  })

  it('a degraded expects method or a failed self-test group keeps the pack, with the reason; DLL load failed reads as the Visual C++ sentence', async () => {
    const h = makeHarness({ platform: 'win32-x64' })
    h.checkResult = {
      hello: hello({ 'depth.layers': 'onnxruntime could not be imported' }),
      selftest: { ...allOk(), beats: { exit: 1, ms: 300, error: 'ImportError: DLL load failed while importing soxr_ext: The specified module could not be found.' } },
      problems: ['vision.salient is not registered']
    }
    const job = await installed(h)
    expect(job.status, job.error ?? '').toBe('done')
    const receipt = receiptOf(h.versionDir)
    expect(receipt.hello.degraded).toEqual({ 'depth.layers': 'onnxruntime could not be imported' })
    expect(receipt.selftest.beats).toBe(`beats ${VCRUNTIME_SENTENCE}`)
    expect(receipt.selftest.asr).toBe('ok')
    expect(receipt.problems).toEqual(['vision.salient is not registered'])
    // What the service merges into the next ready: beats' method greyed, with the sentence.
    expect(degradedBySelftest(receipt.selftest)).toEqual({ 'audio.beats': `beats ${VCRUNTIME_SENTENCE}` })
    expect(orderPicks(h)).toBe('pack')
  })
})

describe('the switch', () => {
  it('waits for the helper’s work in flight and never cuts it off', async () => {
    const h = makeHarness()
    const work = h.helper.startWork()
    const id = h.jobs.install().id
    await until(() => h.events.includes('receipt:1'))
    await until(() => h.progress.some((x) => x.text === WAITING_FOR_THE_HELPER))
    expect(h.events).not.toContain('restart')
    expect(h.jobs.queue.list().find((j) => j.id === id)?.status).toBe('running')
    work.finish('transcribed')
    expect(await work.promise).toBe('transcribed')
    expect((await settled(h, id)).status).toBe('done')
    expect(h.events.indexOf('restart')).toBeGreaterThan(h.events.lastIndexOf('idle'))
  })
})

describe('Repair', () => {
  /** The events Repair's order is asserted over, the downloads' verifies folded into one. */
  function shape(h: Harness): string[] {
    const out: string[] = []
    const verified = new Set<string>()
    for (const e of h.events) {
      if (e.startsWith('verify:')) {
        verified.add(e.slice('verify:'.length))
        if (out[out.length - 1] !== 'verifying') out.push('verifying')
        continue
      }
      const name =
        e === 'unlink receipt:1' ? 'unlink receipt' : e === 'rm:1' ? 'rm tree' : e === 'receipt:1' ? 'receipt' : e
      if (['idle', 'hold', 'stop', 'unlink receipt', 'rm tree', 'unpack', 'compile', 'pip', 'check', 'receipt', 'release', 'restart'].includes(name)) out.push(name)
    }
    const all = h.files.every((f) => verified.has(f.name))
    return out.map((e) => (e === 'verifying' && all ? 'all files verified' : e))
  }

  it('fetches every file first while the helper runs, then: idle, hold, stop, receipt off, tree off, unpack, compile, pip, check, receipt, release, restart', async () => {
    const h = makeHarness()
    expect((await installed(h)).status).toBe('done')
    h.events.length = 0
    const job = await installed(h, { repair: true })
    expect(job).toMatchObject({ status: 'done', params: { kind: 'repair' } })
    expect(shape(h)).toEqual(['all files verified', 'idle', 'hold', 'stop', 'unlink receipt', 'rm tree', 'unpack', 'compile', 'pip', 'check', 'receipt', 'release', 'restart'])
    expect(orderPicks(h)).toBe('pack')
  })

  it('with a fetch that fails, leaves the old receipt and folder untouched and the helper running', async () => {
    const h = makeHarness()
    expect((await installed(h)).status).toBe('done')
    const before = readFileSync(join(h.versionDir, 'pack.json'), 'utf8')
    h.events.length = 0
    h.tamper.add(h.files[3].name)
    const job = await installed(h, { repair: true })
    expect(job.status).toBe('failed')
    expect(readFileSync(join(h.versionDir, 'pack.json'), 'utf8')).toBe(before)
    expect(existsSync(join(h.versionDir, h.manifest.platforms[h.platform].python))).toBe(true)
    for (const e of ['hold', 'stop', 'restart', 'unlink receipt:1', 'rm:1']) expect(h.events).not.toContain(e)
  })

  it('a press over a pack that is there is a Repair, whatever it was called', async () => {
    const h = makeHarness()
    expect((await installed(h)).status).toBe('done')
    const job = h.jobs.install()
    expect(job.params).toEqual({ kind: 'repair' })
    expect((await settled(h, job.id)).status).toBe('done')
  })

  it('refuses while another live instance has the pack in use, and leaves it as it was', async () => {
    const h = makeHarness()
    expect((await installed(h)).status).toBe('done')
    mkdirSync(join(h.root, 'in-use'), { recursive: true })
    writeFileSync(join(h.root, 'in-use', '4242'), JSON.stringify({ pack: 1 }))
    h.alive.add(4242)
    h.events.length = 0
    h.fetched.length = 0
    const job = await installed(h, { repair: true })
    expect(job.status).toBe('failed')
    expect(job.error).toBe(HELPER_IN_USE_ELSEWHERE)
    expect(h.fetched).toEqual([])
    expect(orderPicks(h)).toBe('pack')
  })

  it('a request sent between the idle and the stop is waited for too, never cut off (P-B finding V2)', async () => {
    // A caller that sends one request after another gets its next one out in the microtasks between
    // the idle and Repair's continuation; a stop there would cut it off.
    const h = makeHarness()
    expect((await installed(h)).status).toBe('done')
    h.events.length = 0
    const first = h.helper.startWork()
    let second: { promise: Promise<string>; finish(value: string): void } | null = null
    // On the request itself, before the job's own wait is registered: the caller's next request goes
    // out in the microtask before Repair's continuation, as the real service's callers' do.
    void h.helper.inFlight!.promise.then(() => {
      second = h.helper.startWork()
    })
    const id = h.jobs.install({ repair: true }).id
    await until(() => h.progress.some((x) => x.text === WAITING_FOR_THE_HELPER))
    first.finish('one')
    await until(() => second !== null)
    const outcome = second!.promise.then(
      (value) => value,
      (err: Error) => err.message
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    second!.finish('two')
    // Answered (Repair waited for it), or refused by the hold before it went out: never cut off.
    expect(['two', 'refused by the hold']).toContain(await outcome)
    expect((await settled(h, id)).status).toBe('done')
    expect(h.events.indexOf('stop')).toBeGreaterThan(h.events.lastIndexOf('idle'))
  })

  it('a window that starts its helper from the pack during the download stops the Repair before its hold, and the pack stays (P-B finding V2)', async () => {
    const h = makeHarness()
    expect((await installed(h)).status).toBe('done')
    const before = readFileSync(join(h.versionDir, 'pack.json'), 'utf8')
    h.events.length = 0
    h.fetched.length = 0
    rmSync(h.dlDir, { recursive: true, force: true })
    const gate = deferred<void>()
    h.hooks.onChunk = () => gate.promise
    const id = h.jobs.install({ repair: true }).id
    await until(() => h.fetched.length > 0)
    // Stage 0 read no in-use record; now another window's helper starts from pack 1.
    mkdirSync(join(h.root, 'in-use'), { recursive: true })
    writeFileSync(join(h.root, 'in-use', '4242'), JSON.stringify({ pack: 1 }))
    h.alive.add(4242)
    h.hooks.onChunk = undefined
    gate.resolve()
    const job = await settled(h, id)
    expect(job.status).toBe('failed')
    expect(job.error).toBe(HELPER_IN_USE_ELSEWHERE)
    // Refused after the download, not by stage 0's read: every file was fetched.
    expect([...h.fetched].sort()).toEqual(h.files.map((f) => f.name).sort())
    // The other window's helper is never stopped under it, and its pack never touched.
    for (const e of ['stop', 'unlink receipt:1', 'rm:1']) expect(h.events).not.toContain(e)
    expect(readFileSync(join(h.versionDir, 'pack.json'), 'utf8')).toBe(before)
    expect(orderPicks(h)).toBe('pack')
    // The verified downloads stay, so the next press is offline.
    expect(Object.keys(downloadedFiles(h.dlDir, h.manifest.platforms[h.platform])).sort()).toEqual(h.files.map((f) => f.name).sort())
  })

  it('holds the helper with the Repair sentence', async () => {
    const h = makeHarness()
    expect((await installed(h)).status).toBe('done')
    const reasons: string[] = []
    const hold = h.helper.hold.bind(h.helper)
    h.helper.hold = (reason: string) => {
      reasons.push(reason)
      return hold(reason)
    }
    expect((await installed(h, { repair: true })).status).toBe('done')
    expect(reasons).toEqual([HELPER_BEING_REPAIRED])
  })
})

describe('Update', () => {
  it('installs the new number beside the old folder, and removes the old one only after the new receipt', async () => {
    const h = makeHarness({ pack: 2 })
    const old = plantReceipt(h, 1, { matching: false })
    h.hooks.onCheck = () => {
      expect(existsSync(join(old, 'pack.json')), 'the old pack is still there while the new one is checked').toBe(true)
    }
    const job = h.jobs.install()
    expect(job.params).toEqual({ kind: 'update' })
    expect((await settled(h, job.id)).status).toBe('done')
    expect(existsSync(join(h.root, '2', 'pack.json'))).toBe(true)
    expect(existsSync(old)).toBe(false)
    const receipt = h.events.indexOf('receipt:2')
    expect(receipt).toBeGreaterThan(-1)
    expect(h.events.indexOf('unlink receipt:1')).toBeGreaterThan(receipt)
    expect(h.events.indexOf('rm:1')).toBeGreaterThan(h.events.indexOf('unlink receipt:1'))
    // Nothing ran from the old folder, so nothing was stopped or held.
    expect(h.events).not.toContain('stop')
    expect(h.events).not.toContain('hold')
  })

  it('refuses while another live instance runs a pack from this root', async () => {
    const h = makeHarness({ pack: 2 })
    plantReceipt(h, 1, { matching: false })
    mkdirSync(join(h.root, 'in-use'), { recursive: true })
    writeFileSync(join(h.root, 'in-use', '4242'), JSON.stringify({ pack: 1 }))
    h.alive.add(4242)
    const job = await installed(h)
    expect(job.status).toBe('failed')
    expect(job.error).toBe(HELPER_IN_USE_ELSEWHERE)
  })
})

describe('Remove', () => {
  it('refuses while a helper job runs', async () => {
    const h = makeHarness()
    const gate = deferred<void>()
    h.hooks.onChunk = () => gate.promise
    const id = h.jobs.install().id
    await until(() => h.fetched.length > 0)
    await expect(h.jobs.remove({ models: false })).rejects.toThrow(HELPER_BUSY)
    gate.resolve()
    h.hooks.onChunk = undefined
    expect((await settled(h, id)).status).toBe('done')
    expect(orderPicks(h)).toBe('pack')
  })

  it('stops the helper, takes every receipt first and then the root, keeps models/ unless asked, and resolves the order again', async () => {
    const h = makeHarness()
    expect((await installed(h)).status).toBe('done')
    mkdirSync(join(h.userData, 'models'), { recursive: true })
    writeFileSync(join(h.userData, 'models', 'blaze_face.tflite'), 'model')
    h.events.length = 0
    await h.jobs.remove({ models: false })
    expect(existsSync(h.root)).toBe(false)
    expect(existsSync(join(h.userData, 'models', 'blaze_face.tflite'))).toBe(true)
    const order = h.events.filter((e) => ['hold', 'idle', 'stop', 'unlink receipt:1', 'rm:.', 'release', 'restart'].includes(e))
    // No wait: Remove refuses while work is out (below), so from its check to the stop nothing awaits.
    expect(order).toEqual(['hold', 'stop', 'unlink receipt:1', 'rm:.', 'release', 'restart'])
    // Asked: the models go too.
    expect((await installed(h)).status).toBe('done')
    await h.jobs.remove({ models: true })
    expect(existsSync(join(h.userData, 'models'))).toBe(false)
  })

  it('refuses while another live instance has the pack in use', async () => {
    const h = makeHarness()
    expect((await installed(h)).status).toBe('done')
    mkdirSync(join(h.root, 'in-use'), { recursive: true })
    writeFileSync(join(h.root, 'in-use', '4242'), JSON.stringify({ pack: 1 }))
    h.alive.add(4242)
    await expect(h.jobs.remove({ models: false })).rejects.toThrow(HELPER_IN_USE_ELSEWHERE)
    expect(orderPicks(h)).toBe('pack')
    expect(existsSync(lockPath(h.root))).toBe(false)
  })

  it('refuses while helper work is running, with the reason, and neither holds nor stops nor waits (§3a.3)', async () => {
    const h = makeHarness()
    expect((await installed(h)).status).toBe('done')
    h.events.length = 0
    const work = h.helper.startWork()
    await expect(h.jobs.remove({ models: false })).rejects.toThrow(HELPER_WORKING)
    for (const e of ['hold', 'idle', 'stop', 'restart', 'unlink receipt:1']) expect(h.events).not.toContain(e)
    expect(orderPicks(h)).toBe('pack')
    expect(existsSync(lockPath(h.root))).toBe(false)
    work.finish('transcribed')
    expect(await work.promise).toBe('transcribed')
    // Pressed again once the work is done, it removes.
    await h.jobs.remove({ models: false })
    expect(existsSync(h.root)).toBe(false)
  })
})

describe('Check again', () => {
  it('reruns the self-test alone, rewrites the receipt’s record by rename, and restarts the helper', async () => {
    const h = makeHarness()
    h.checkResult = { hello: hello(), selftest: { ...allOk(), beats: { exit: 1, ms: 5, error: 'OSError: cannot load library' } }, problems: [] }
    expect((await installed(h)).status).toBe('done')
    const first = receiptOf(h.versionDir)
    expect(first.selftest.beats).toContain('beats failed')
    h.checkResult = { hello: hello(), selftest: allOk(), problems: [] }
    h.events.length = 0
    h.fetched.length = 0
    await h.jobs.checkAgain()
    const second = receiptOf(h.versionDir)
    expect(second.selftest.beats).toBe('ok')
    expect(second.installedAt).toBe(first.installedAt)
    expect(h.fetched).toEqual([])
    expect(h.events.filter((e) => e === 'check' || e === 'receipt:1' || e === 'restart')).toEqual(['check', 'receipt:1', 'restart'])
  })
})

describe('the launch sweep', () => {
  function plantRoot(h: Harness, o: { currentComplete: boolean }): void {
    plantReceipt(h, 1, { matching: false })
    if (o.currentComplete) plantReceipt(h, 2, { matching: true })
    else {
      mkdirSync(join(h.root, '2', 'python'), { recursive: true })
      writeFileSync(join(h.root, '2', 'python', 'half.txt'), 'x')
    }
    mkdirSync(join(h.root, '3', 'python'), { recursive: true })
    writeFileSync(join(h.root, '3', 'python', 'partial.txt'), 'x')
    plantReceipt(h, 4, { matching: true, text: '{"pack": 4, "torn' })
    mkdirSync(join(h.root, 'downloads', '1'), { recursive: true })
    writeFileSync(join(h.root, 'downloads', '1', 'old.whl'), 'x')
    mkdirSync(join(h.root, 'downloads', '2'), { recursive: true })
    writeFileSync(join(h.root, 'downloads', '2', 'this.whl'), 'x')
  }
  const there = (h: Harness): string[] =>
    ['1', '2', '3', '4', 'downloads/1', 'downloads/2'].filter((p) => existsSync(join(h.root, ...p.split('/'))))

  it('removes a receipt-less folder, an old number beside a complete pack, and another pack’s downloads; keeps the pack and a torn receipt', async () => {
    const h = makeHarness({ pack: 2 })
    plantRoot(h, { currentComplete: true })
    const removed = await h.jobs.sweep()
    expect(removed.map((p) => relative(h.root, p).split('\\').join('/')).sort()).toEqual(['1', '3', 'downloads/1'])
    expect(there(h)).toEqual(['2', '4', 'downloads/2'])
    // The old pack's receipt went before its tree.
    expect(h.events.indexOf('unlink receipt:1')).toBeLessThan(h.events.indexOf('rm:1'))
    expect(existsSync(lockPath(h.root))).toBe(false)
  })

  it('keeps a torn receipt below the manifest’s number beside a complete pack, where the older-pack rule would otherwise reach it', async () => {
    const h = makeHarness({ pack: 3 })
    plantReceipt(h, 1, { matching: false, text: '{"pack": 1, "torn' })
    plantReceipt(h, 2, { matching: false })
    plantReceipt(h, 3, { matching: true })
    const removed = await h.jobs.sweep()
    expect(removed.map((p) => relative(h.root, p).split('\\').join('/'))).toEqual(['2'])
    expect(readFileSync(join(h.root, '1', 'pack.json'), 'utf8')).toBe('{"pack": 1, "torn')
    expect(existsSync(join(h.root, '1', 'python', 'tree.txt'))).toBe(true)
  })

  it('keeps an old number while there is no complete pack of the manifest’s', async () => {
    const h = makeHarness({ pack: 2 })
    plantRoot(h, { currentComplete: false })
    await h.jobs.sweep()
    expect(there(h)).toEqual(['1', '4', 'downloads/2'])
  })

  it('keeps an old number a live instance still runs', async () => {
    const h = makeHarness({ pack: 2 })
    plantRoot(h, { currentComplete: true })
    mkdirSync(join(h.root, 'in-use'), { recursive: true })
    writeFileSync(join(h.root, 'in-use', '4242'), JSON.stringify({ pack: 1 }))
    h.alive.add(4242)
    await h.jobs.sweep()
    expect(there(h)).toContain('1')
  })

  it('removes nothing while another live instance holds the lock', async () => {
    const h = makeHarness({ pack: 2 })
    plantRoot(h, { currentComplete: true })
    writeFileSync(lockPath(h.root), JSON.stringify({ pid: 4242, startedAt: 1 }))
    h.alive.add(4242)
    expect(await h.jobs.sweep()).toEqual([])
    expect(there(h)).toEqual(['1', '2', '3', '4', 'downloads/1', 'downloads/2'])
  })

  it('does nothing while this window’s own job runs', async () => {
    const h = makeHarness({ pack: 2 })
    plantRoot(h, { currentComplete: true })
    const gate = deferred<void>()
    h.hooks.onChunk = () => gate.promise
    const id = h.jobs.install().id
    expect(await h.jobs.sweep()).toEqual([])
    gate.resolve()
    h.hooks.onChunk = undefined
    await settled(h, id)
  })
})
