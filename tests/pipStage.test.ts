import { afterEach, describe, expect, it } from 'vitest'
import { spawn as realSpawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PIP_LAUNCHER_SENTENCE, pipArgs, runPip } from '../src/main/sidecar/pip'
import type { Spawn } from '../src/main/sidecar/installTypes'

/*
 * The install job's pip stage (docs/CLIPS.md §3a.3 stage 3, §3a.8 row 34)
 * against a REAL child: tests/fixtures/fake-pip.mjs, a Node script that reads
 * pip's argv, prints pip's kind of lines and writes `<name>.dist-info`
 * folders into the site-packages it is given. The stage's spawn is injected,
 * so the pack's interpreter name is turned into `node fake-pip.mjs` there and
 * everything else (taskkill on Windows) is the real spawn.
 */

const FAKE_PIP = resolve(__dirname, 'fixtures', 'fake-pip.mjs')
const PYTHON = join('pack', 'python', 'bin', 'python3.14')
const dirs: string[] = []
/** Every fake pip a stage started: each runs with its cwd in the stage's temp dir (runPip's `cwd`, the downloads folder). */
const pips: ChildProcess[] = []

const running = (child: ChildProcess): boolean => child.exitCode === null && child.signalCode === null

/**
 * A pip ended as its parent sees it: killed if it still runs, then its 'exit'.
 * On Windows that is the process object signalled, its handles closed, and
 * its cwd with them. Not `process.kill(pid, 0)` failing: that reads the exit
 * code, which TerminateProcess sets first. Then a temp dir that was the cwd
 * of a pip just killed by pid could not be removed: `rmSync` EPERM in this
 * afterEach, Windows CI run 38919769393, "a cancel whose kill did not take".
 */
async function ended(child: ChildProcess, ms = 5000): Promise<boolean> {
  if (!running(child)) return true
  const exited = new Promise<boolean>((done) => child.once('exit', () => done(true)))
  child.kill('SIGKILL')
  return Promise.race([exited, new Promise<boolean>((done) => setTimeout(() => done(!running(child)), ms))])
}

afterEach(async () => {
  // A test ends its own pips. One left running is ended here before its dir goes, and the test fails, naming it:
  // on the Mac a live process's cwd can be removed, on Windows it cannot.
  const left = pips.filter(running).map((c) => c.pid)
  await Promise.all(pips.splice(0).map((c) => ended(c)))
  // Node retries EPERM and EBUSY on Windows: a virus scanner's moment on a fresh file is not a failure.
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  expect(left, 'pips still running when the test ended').toEqual([])
})

/** Whether a process is still there: signal 0 asks without sending anything. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function until(test: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (test()) return true
    await new Promise((done) => setTimeout(done, 20))
  }
  return test()
}

interface Seen {
  done: number
  total: number
  line: string | null
}

function stage(o: { mode?: string; count?: number; total?: number; ms?: number; stderr?: string; signal?: AbortSignal; python?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-pip-'))
  dirs.push(dir)
  const site = join(dir, 'python', 'lib', 'python3.14', 'site-packages')
  mkdirSync(site, { recursive: true })
  // A fresh pack's site-packages already holds pip's own (and here one more): never counted.
  mkdirSync(join(site, 'pip-26.2.1.dist-info'))
  mkdirSync(join(site, 'setuptools-80.9.0.dist-info'))
  const findLinks = join(dir, 'downloads', '1')
  mkdirSync(findLinks, { recursive: true })
  const lock = join(dir, 'lock-darwin-arm64.txt')
  const argvFile = join(dir, 'argv.json')
  const pidsFile = join(dir, 'pids.txt')
  const count = o.count ?? 4
  const base = { ...process.env }
  delete base.NODE_OPTIONS
  // In the dev sandbox this makes every node child print "ERROR: failed to copy trust settings…": not pip's lines.
  delete base.NODE_USE_SYSTEM_CA
  const env: NodeJS.ProcessEnv = {
    ...base,
    FAKE_PIP_ARGV: argvFile,
    FAKE_PIP_PIDS: pidsFile,
    FAKE_PIP_SITE: site,
    FAKE_PIP_COUNT: String(count),
    FAKE_PIP_MS: String(o.ms ?? 1000),
    FAKE_PIP_MODE: o.mode ?? 'ok',
    ...(o.stderr !== undefined ? { FAKE_PIP_STDERR: o.stderr } : {})
  }
  const calls: { command: string; args: string[]; options: Record<string, unknown> }[] = []
  const python = o.python ?? PYTHON
  const spawn = ((command: string, args: string[], options: Record<string, unknown>) => {
    calls.push({ command, args: [...args], options })
    if (command !== PYTHON) return realSpawn(command, args, options)
    const child = realSpawn(process.execPath, [FAKE_PIP, ...args], options)
    pips.push(child)
    return child
  }) as unknown as Spawn
  const seen: Seen[] = []
  const controller = new AbortController()
  const options = {
    python,
    lock,
    findLinks,
    sitePackages: site,
    total: o.total ?? count,
    env,
    spawn,
    signal: o.signal ?? controller.signal,
    onProgress: (done: number, total: number, line: string | null) => seen.push({ done, total, line })
  }
  const pids = (): number[] =>
    existsSync(pidsFile)
      ? readFileSync(pidsFile, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(Number)
      : []
  return { options, calls, seen, controller, pids, argv: () => JSON.parse(readFileSync(argvFile, 'utf8')) as string[], site, lock, findLinks }
}

describe('pip runs offline, with every hash checked', () => {
  it('starts the pack’s interpreter with the plan’s argv, as one ordered shape', async () => {
    const s = stage({ count: 2, ms: 100 })
    const expected = [
      PYTHON,
      '-E',
      '-s',
      '-m',
      'pip',
      'install',
      '--isolated',
      '--no-index',
      '--find-links',
      s.findLinks,
      '--no-deps',
      '--require-hashes',
      '--only-binary=:all:',
      '--no-cache-dir',
      '--disable-pip-version-check',
      '--no-input',
      '--progress-bar',
      'off',
      '--no-warn-script-location',
      '-r',
      s.lock
    ]
    expect(pipArgs(s.options)).toEqual(expected)
    // What each flag is for, by membership: offline, hashed, binary only; and not --no-compile until row 27 says so.
    for (const flag of ['--no-index', '--require-hashes', '--only-binary=:all:', '--isolated', '--no-deps']) {
      expect(expected.filter((a) => a === flag), flag).toHaveLength(1)
    }
    expect(expected).not.toContain('--no-compile')

    await runPip(s.options)
    expect(s.calls).toHaveLength(1)
    expect([s.calls[0].command, ...s.calls[0].args]).toEqual(expected)
    expect(s.calls[0].options.windowsHide).toBe(true)
    expect(s.calls[0].options.env).toBe(s.options.env)
    // And that is what the child was handed.
    expect(s.argv()).toEqual(expected.slice(1))
  })

  it('counts the dist-info folders pip adds: from 0, never down, up to the total', async () => {
    const s = stage({ count: 5, ms: 1500 })
    await runPip(s.options)
    const dones = s.seen.map((p) => p.done)
    expect(dones[0]).toBe(0)
    for (let i = 1; i < dones.length; i++) expect(dones[i], `step ${i}: ${dones.join(',')}`).toBeGreaterThanOrEqual(dones[i - 1])
    expect(dones.at(-1)).toBe(5)
    // Polled as it went, not only counted at the end.
    expect(new Set(dones.filter((d) => d > 0 && d < 5)).size, dones.join(',')).toBeGreaterThan(0)
    for (const p of s.seen) expect(p.total).toBe(5)
  })

  it('counts only what pip added, never the folders already there', async () => {
    // Two dist-info folders before the start (pip's own and one more); pip
    // adds 3 of a lock of 6. Counted with the two, the bar would read 5.
    const s = stage({ count: 3, total: 6, ms: 600 })
    await runPip(s.options)
    expect(s.seen.map((p) => p.done).at(-1)).toBe(3)
    expect(Math.max(...s.seen.map((p) => p.done))).toBe(3)
  })

  it('names pip’s last Processing / Installing / Successfully line as the stage text', async () => {
    const s = stage({ count: 3, ms: 300 })
    await runPip(s.options)
    const lines = s.seen.map((p) => p.line)
    expect(lines.at(-1)).toBe('Successfully installed pkg0-1.0 pkg1-1.0 pkg2-1.0')
    expect(lines).toContain(`Processing ${join(s.findLinks, 'pkg2-1.0-py3-none-any.whl')}`)
    expect(lines).toContain('Installing collected packages: pkg0, pkg1, pkg2')
    // "Looking in links" is not what pip is doing.
    expect(lines.some((l) => l?.startsWith('Looking in links'))).toBe(false)
  })
})

describe('a cancel', () => {
  it('kills pip and rejects only once it has gone', async () => {
    const s = stage({ mode: 'hang' })
    const run = runPip(s.options)
    expect(await until(() => s.pids().length === 1 && s.seen.some((p) => p.line?.startsWith('Processing')), 10_000)).toBe(true)
    const [pid] = s.pids()
    expect(alive(pid)).toBe(true)
    s.controller.abort()
    const outcome = await Promise.race([
      run.then(
        () => 'resolved',
        (err: unknown) => err
      ),
      new Promise((done) => setTimeout(() => done('still running after 5 s'), 5000))
    ])
    expect(outcome).toMatchObject({ name: 'CancelledError' })
    expect(alive(pid), 'pip is still running after the cancel').toBe(false)
  })

  /** The stage's spawn, with `taskkill` answered by a stand-in that exits `code` and kills nothing. */
  function withTaskkill(s: ReturnType<typeof stage>, code: number): { spawn: Spawn; taskkills: string[][] } {
    const taskkills: string[][] = []
    const spawn = ((command: string, args: string[], options: Record<string, unknown>) => {
      if (command !== 'taskkill') return s.options.spawn(command, args, options as never)
      taskkills.push([...args])
      return realSpawn(process.execPath, ['-e', `process.exit(${code})`], options)
    }) as unknown as Spawn
    return { spawn, taskkills }
  }

  const settledWithin = (run: Promise<void>, ms: number): Promise<unknown> =>
    Promise.race([
      run.then(
        () => 'resolved',
        (err: unknown) => err
      ),
      new Promise((done) => setTimeout(() => done(`still running after ${ms} ms`), ms))
    ])

  it('on Windows, a taskkill that runs and fails falls back to killing pip itself (P-B finding V1)', async () => {
    const s = stage({ mode: 'hang' })
    const t = withTaskkill(s, 1)
    const run = runPip({ ...s.options, spawn: t.spawn }, { platform: 'win32' })
    expect(await until(() => s.pids().length === 1 && s.seen.some((p) => p.line?.startsWith('Processing')), 10_000)).toBe(true)
    const [pid] = s.pids()
    s.controller.abort()
    // Well inside the 10 s grace: the fallback, not the grace, ends it.
    expect(await settledWithin(run, 5000)).toMatchObject({ name: 'CancelledError' })
    expect(t.taskkills).toEqual([['/pid', String(pid), '/f', '/t']])
    expect(alive(pid), 'pip is still running after the cancel').toBe(false)
  })

  it('a cancel whose kill did not take still settles, after its grace, as a cancel (P-B finding V1)', async () => {
    const s = stage({ mode: 'hang' })
    // taskkill "succeeds" and kills nothing: only the grace can end the wait.
    const t = withTaskkill(s, 0)
    const run = runPip({ ...s.options, spawn: t.spawn }, { platform: 'win32', cancelGraceMs: 300 })
    expect(await until(() => s.pids().length === 1, 10_000)).toBe(true)
    const [pid] = s.pids()
    s.controller.abort()
    expect(await settledWithin(run, 5000)).toMatchObject({ name: 'CancelledError' })
    expect(alive(pid), 'the stand-in taskkill killed nothing').toBe(true)
    // Ended here, and waited for, so nothing is left behind and its cwd can go.
    const pip = pips.find((c) => c.pid === pid)!
    expect(await ended(pip)).toBe(true)
    expect(alive(pid)).toBe(false)
  })

  it('starts nothing when the job is already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const s = stage({ signal: controller.signal })
    await expect(runPip(s.options)).rejects.toMatchObject({ name: 'CancelledError' })
    expect(s.calls).toHaveLength(0)
  })
})

describe('a failure says why', () => {
  it('maps distlib’s “Failed to write executable” to the antivirus sentence', async () => {
    const s = stage({ mode: 'launcher' })
    await expect(runPip(s.options)).rejects.toMatchObject({ name: 'PipError', message: PIP_LAUNCHER_SENTENCE, code: 1 })
  })

  it('gives pip’s last ERROR line, not the lines under it', async () => {
    const s = stage({
      mode: 'fail',
      stderr: [
        'ERROR: THESE PACKAGES DO NOT MATCH THE HASHES FROM THE REQUIREMENTS FILE. If you have updated the package versions, please update the hashes.',
        '    numpy==2.5.3 from file:///downloads/1/numpy-2.5.3-cp314-cp314-macosx_14_0_arm64.whl:',
        '        Expected sha256 0000000000000000000000000000000000000000000000000000000000000000',
        '             Got        1111111111111111111111111111111111111111111111111111111111111111',
        ''
      ].join('\n')
    })
    const err = await runPip(s.options).then(
      () => null,
      (e: unknown) => e as Error & { code: number; lines: string[] }
    )
    expect(err?.name).toBe('PipError')
    expect(err?.message).toBe(
      'pip could not install the libraries (exit 1): ERROR: THESE PACKAGES DO NOT MATCH THE HASHES FROM THE REQUIREMENTS FILE. If you have updated the package versions, please update the hashes.'
    )
    expect(err?.code).toBe(1)
    expect(err?.lines.at(-1)).toMatch(/Got +1111/)
  })

  it('gives an ordinary failure’s last ERROR line', async () => {
    const s = stage({
      mode: 'fail',
      stderr: 'ERROR: Could not find a version that satisfies the requirement numpy==2.5.3 (from versions: none)\nERROR: No matching distribution found for numpy==2.5.3\n'
    })
    await expect(runPip(s.options)).rejects.toThrow(/\(exit 1\): ERROR: No matching distribution found for numpy==2\.5\.3$/)
  })

  it('says so when the interpreter cannot start', async () => {
    const s = stage()
    const missing = join(s.findLinks, 'no-such-python')
    await expect(runPip({ ...s.options, python: missing, spawn: realSpawn as unknown as Spawn })).rejects.toThrow(/^Could not start the AI helper's Python for pip: /)
  })
})
