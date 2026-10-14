import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { HELPER_PACK } from '@shared/sidecar/packManifest'
import { SELFTEST_GROUP_NAMES, VCRUNTIME_SENTENCE, degradedBySelftest, selftestRecordFrom, type SelftestResult } from '@shared/sidecar/selftest'
import type { HelperLaunch } from '@shared/sidecar/helperPython'
import type { HelloResult } from '@shared/sidecar/protocol'

/*
 * The install job's check (docs/CLIPS.md §3a.3 stage 4) against a REAL child:
 * tests/fixtures/fake-helper.mjs, which speaks the helper's protocol, answers
 * `system.selftest`, and reports whatever executable, prefix and path the test
 * gives it. The client module is wrapped only to record what each client was
 * built with, and to give the pack rung a 1.5 s hello: the check must take its
 * ceiling from `helloTimeoutFor`, or the never-answering hello below waits 90 s.
 */

const made = vi.hoisted(() => ({ options: [] as Record<string, unknown>[], clients: [] as { stopped: boolean }[] }))
vi.mock('../src/main/sidecar/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/sidecar/client')>()
  class Recorded extends real.SidecarClient {
    constructor(options: ConstructorParameters<typeof real.SidecarClient>[0]) {
      super(options)
      made.options.push({ ...options })
      made.clients.push(this)
    }
  }
  return {
    ...real,
    SidecarClient: Recorded,
    helloTimeoutFor: (source: Parameters<typeof real.helloTimeoutFor>[0]) => (source.kind === 'pack' ? 1500 : real.helloTimeoutFor(source))
  }
})

const { CHECK_HELLO_SHARE, checkPack, isInside } = await import('../src/main/sidecar/check')

const FAKE = resolve(__dirname, 'fixtures', 'fake-helper.mjs')
const PLATFORM = 'darwin-arm64' as const
const EXPECTS = HELPER_PACK.platforms[PLATFORM].expects
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * A version folder laid out as an unpacked pack, the helper's folder beside
 * it, and three things a check must not take as inside: a sibling whose name
 * starts the same (`python-evil`), a folder elsewhere, and a link from inside
 * the pack to that folder.
 */
function layout() {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-check-'))
  dirs.push(tmp)
  const versionDir = join(tmp, 'python')
  const sidecarDir = join(tmp, 'sidecar')
  const lib = join(versionDir, 'python', 'lib', 'python3.14')
  for (const dir of [join(versionDir, 'python', 'bin'), join(lib, 'site-packages'), join(lib, 'lib-dynload'), sidecarDir]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(versionDir, 'python', 'bin', 'python3.14'), '')
  const evil = join(tmp, 'python-evil', 'site-packages')
  const elsewhere = join(tmp, 'elsewhere')
  mkdirSync(evil, { recursive: true })
  mkdirSync(elsewhere, { recursive: true })
  // Junctions on Windows (no privilege needed), plain symlinks elsewhere.
  const escape = join(lib, 'escape')
  symlinkSync(elsewhere, escape, 'junction')
  const alias = join(tmp, 'alias-of-stdlib')
  symlinkSync(lib, alias, 'junction')
  const hello: Partial<HelloResult> = {
    python: HELPER_PACK.python.version,
    executable: join(versionDir, 'python', 'bin', 'python3.14'),
    prefix: join(versionDir, 'python'),
    // As `-m forge_sidecar` gives it: the working directory first, the zip that is on no disk, the stdlib, site-packages.
    path: [sidecarDir, join(versionDir, 'python', 'lib', 'python314.zip'), lib, join(lib, 'lib-dynload'), join(lib, 'site-packages'), ''],
    capabilities: ['system.hello', 'system.ping', 'system.selftest', ...EXPECTS],
    degraded: { 'audio.stems': 'stems unavailable: No module named torch' }
  }
  return { tmp, versionDir, sidecarDir, lib, evil, elsewhere, escape, alias, hello }
}

function check(
  l: ReturnType<typeof layout>,
  o: { hello?: Partial<HelloResult>; env?: Record<string, string>; signal?: AbortSignal; onMessage?: (m: string) => void; onProgress?: (f: number) => void } = {}
) {
  const pids = join(l.tmp, 'pids.txt')
  const base = { ...process.env }
  delete base.NODE_OPTIONS
  delete base.NODE_USE_SYSTEM_CA
  const launch: HelperLaunch = {
    command: process.execPath,
    args: [FAKE],
    env: { ...base, FAKE_PIDS: pids, FAKE_HELLO_JSON: JSON.stringify({ ...l.hello, ...(o.hello ?? {}) }), ...(o.env ?? {}) },
    source: { kind: 'pack', pack: HELPER_PACK.pack, root: l.tmp }
  }
  const run = checkPack({
    versionDir: l.versionDir,
    manifest: HELPER_PACK,
    platform: PLATFORM,
    sidecarDir: l.sidecarDir,
    launch,
    signal: o.signal ?? new AbortController().signal,
    onMessage: o.onMessage,
    onProgress: o.onProgress
  })
  const started = (): number[] =>
    existsSync(pids)
      ? readFileSync(pids, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(Number)
      : []
  return { run, launch, started }
}

describe('the check of a freshly installed pack', () => {
  it('passes a pack that is as it should be, and stops its helper', async () => {
    const l = layout()
    const messages: string[] = []
    const before = made.options.length
    const fractions: number[] = []
    const { run, launch, started } = check(l, { onMessage: (m) => messages.push(m), onProgress: (f) => fractions.push(f) })
    const result = await run
    expect(result.problems).toEqual([])
    // The bar through the check (§3a.8 row 27: most of a real install): the hello's share, then each group's start as the helper counts it, then 1.
    const n = SELFTEST_GROUP_NAMES.length
    expect(fractions).toEqual([CHECK_HELLO_SHARE, ...SELFTEST_GROUP_NAMES.map((_, i) => CHECK_HELLO_SHARE + (1 - CHECK_HELLO_SHARE) * (i / n)), 1])
    expect(result.hello.python).toBe(HELPER_PACK.python.version)
    for (const group of SELFTEST_GROUP_NAMES) expect(result.selftest[group], group).toMatchObject({ exit: 0, error: null })
    expect(messages).toEqual(SELFTEST_GROUP_NAMES.map((g, i) => `checking ${g} · ${i + 1} of ${SELFTEST_GROUP_NAMES.length}`))
    // One client, exactly as the service starts the pack: its launch, cwd the helper's folder, no restarts, the rung's own hello ceiling.
    expect(made.options.length).toBe(before + 1)
    expect(made.options.at(-1)).toMatchObject({ cwd: l.sidecarDir, maxRestarts: 0, helloTimeoutMs: 1500 })
    expect(made.options.at(-1)?.launch).toBe(launch)
    expect(made.clients.at(-1)?.stopped).toBe(true)
    const pids = started()
    expect(pids).toHaveLength(1)
    expect(alive(pids[0]), 'the helper is still running after the check').toBe(false)
  })

  it('names an interpreter outside the pack', async () => {
    const l = layout()
    const { problems } = await check(l, { hello: { executable: join(l.elsewhere, 'python3') } }).run
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/^The AI helper's interpreter is outside its folder: /)
  })

  it('names a prefix outside the pack', async () => {
    const l = layout()
    const { problems } = await check(l, { hello: { prefix: l.elsewhere } }).run
    expect(problems).toEqual([`The AI helper's Python prefix is outside its folder: ${l.elsewhere}`])
  })

  it('takes a sibling whose name starts the same as outside (python-evil beside python)', async () => {
    const l = layout()
    expect(l.evil.startsWith(l.versionDir), 'a string prefix check would take it as inside').toBe(true)
    const { problems } = await check(l, { hello: { path: [...(l.hello.path ?? []), l.evil] } }).run
    expect(problems).toEqual([`The AI helper's Python path reaches outside its folder: ${l.evil}`])
  })

  it('follows a link out of the pack, and lets one into it through', async () => {
    const l = layout()
    const { problems } = await check(l, { hello: { path: [...(l.hello.path ?? []), l.escape, l.alias] } }).run
    // The link INSIDE the pack that leads out is outside; the one outside that leads in is inside.
    expect(problems).toEqual([`The AI helper's Python path reaches outside its folder: ${l.escape}`])
  })

  it('reads a relative entry from the helper’s folder: "" is inside, ".." is not', async () => {
    const l = layout()
    const { problems } = await check(l, { hello: { path: ['', '..'] } }).run
    expect(problems).toEqual([`The AI helper's Python path reaches outside its folder: ..`])
  })

  it('names the wrong Python', async () => {
    const l = layout()
    const { problems } = await check(l, { hello: { python: '3.14.6' } }).run
    expect(problems).toEqual([`The AI helper runs Python 3.14.6, not ${HELPER_PACK.python.version}`])
  })

  it('names each expected method that is missing, with the helper’s own reason', async () => {
    const l = layout()
    const capabilities = (l.hello.capabilities ?? []).filter((m) => m !== 'audio.beats' && m !== 'vision.measure')
    const { problems } = await check(l, {
      hello: { capabilities, degraded: { ...l.hello.degraded, 'audio.beats': "beats unavailable: No module named 'librosa'" } }
    }).run
    expect(problems).toHaveLength(2)
    expect(problems).toContain("audio.beats is not available: beats unavailable: No module named 'librosa'")
    expect(problems).toContain('vision.measure is not available: the AI helper did not register it')
  })

  it('names a group the self-test did not answer for', async () => {
    const l = layout()
    const answer = Object.fromEntries(SELFTEST_GROUP_NAMES.filter((g) => g !== 'faces').map((g) => [g, { exit: 0, ms: 1, error: null }]))
    const { problems } = await check(l, { env: { FAKE_SELFTEST: JSON.stringify(answer) } }).run
    expect(problems).toEqual(["The AI helper's self-test did not answer for faces"])
  })
})

describe('when the check fails part of the way', () => {
  it('a failed group is a result, not a rejection', async () => {
    const l = layout()
    const line = 'ImportError: DLL load failed while importing soxr_ext: The specified module could not be found.'
    const answer = Object.fromEntries(SELFTEST_GROUP_NAMES.map((g) => [g, g === 'beats' ? { exit: 1, ms: 40, error: line } : { exit: 0, ms: 1, error: null }]))
    const result = await check(l, { env: { FAKE_SELFTEST: JSON.stringify(answer) } }).run
    expect(result.problems).toEqual([])
    expect(result.selftest.beats).toEqual({ exit: 1, ms: 40, error: line })
    const record = selftestRecordFrom(result.selftest, 'win32')
    expect(record.beats).toBe(`beats ${VCRUNTIME_SENTENCE}`)
    expect(degradedBySelftest(record)).toEqual({ 'audio.beats': `beats ${VCRUNTIME_SENTENCE}` })
  })

  it('a hello that never comes rejects after the rung’s ceiling, with its helper killed', async () => {
    const l = layout()
    const began = performance.now()
    const { run, started } = check(l, { env: { FAKE_HELLO: 'never' } })
    await expect(run).rejects.toThrow(/did not answer within 2 s/)
    expect(performance.now() - began).toBeLessThan(10_000)
    expect(made.clients.at(-1)?.stopped).toBe(true)
    const pids = started()
    expect(pids).toHaveLength(1)
    expect(alive(pids[0])).toBe(false)
  }, 20_000)

  it('a helper that stops during the check rejects, and nothing starts it again', async () => {
    const l = layout()
    const { run, started } = check(l, { env: { FAKE_SELFTEST: 'crash' } })
    await expect(run).rejects.toThrow(/The AI helper stopped \(code 3\)/)
    await new Promise((done) => setTimeout(done, 1000))
    expect(started()).toHaveLength(1)
  })

  it('a cancel during the self-test rejects as cancelled and stops the helper', async () => {
    const l = layout()
    const controller = new AbortController()
    const { run, started } = check(l, {
      env: { FAKE_SELFTEST_MS: '2000' },
      signal: controller.signal,
      onMessage: () => controller.abort()
    })
    const began = performance.now()
    await expect(run).rejects.toMatchObject({ name: 'CancelledError' })
    expect(performance.now() - began).toBeLessThan(2000)
    const pids = started()
    expect(pids).toHaveLength(1)
    expect(alive(pids[0])).toBe(false)
  })

  it('a cancel before the start starts nothing', async () => {
    const l = layout()
    const controller = new AbortController()
    controller.abort()
    const before = made.options.length
    await expect(check(l, { signal: controller.signal }).run).rejects.toMatchObject({ name: 'CancelledError' })
    expect(made.options.length).toBe(before)
  })
})

describe('inside, by path.relative', () => {
  it('is the folder itself or below it, never a sibling that shares its start', () => {
    const root = join('a', 'python')
    expect(isInside(root, root)).toBe(true)
    expect(isInside(root, join(root, 'lib'))).toBe(true)
    expect(isInside(root, join(root, '..dots-in-a-name'))).toBe(true)
    expect(isInside(root, join('a', 'python-evil'))).toBe(false)
    expect(isInside(root, 'a')).toBe(false)
  })
})

describe('the Visual C++ sentence reaches the faces group too', () => {
  const result = (error: string): SelftestResult =>
    Object.fromEntries(SELFTEST_GROUP_NAMES.map((g) => [g, g === 'faces' ? { exit: 69, ms: 90, error } : { exit: 0, ms: 1, error: null }])) as SelftestResult

  it('maps ctypes’ “or one of its dependencies” on Windows, and only there', () => {
    // mediapipe loads libmediapipe.dll through ctypes.CDLL, whose ERROR_MOD_NOT_FOUND reads so (CPython's callproc.c).
    const line =
      "error import FileNotFoundError: Could not find module 'C:\\Users\\Ana\\AppData\\Roaming\\Forge\\python\\1\\python\\Lib\\site-packages\\mediapipe\\tasks\\c\\libmediapipe.dll' (or one of its dependencies). Try using the full path with constructor syntax."
    expect(selftestRecordFrom(result(line), 'win32').faces).toBe(`faces ${VCRUNTIME_SENTENCE}`)
    expect(selftestRecordFrom(result(line), 'darwin').faces).toBe(`faces failed: ${line}`)
    expect(degradedBySelftest(selftestRecordFrom(result(line), 'win32'))).toEqual({
      'vision.faces': `faces ${VCRUNTIME_SENTENCE}`,
      'vision.facesModel': `faces ${VCRUNTIME_SENTENCE}`
    })
  })

  it('leaves an ordinary import failure worded as itself', () => {
    const line = "error import ModuleNotFoundError: No module named 'cv2'"
    expect(selftestRecordFrom(result(line), 'win32').faces).toBe(`faces failed: ${line}`)
  })
})
