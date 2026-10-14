/**
 * The install job's stage 3, "Installing the libraries" (docs/CLIPS.md §3a.3):
 * pip, offline, with every hash checked, as one child of the pack's own
 * interpreter. `RunPip` in installTypes.ts is the contract; the job
 * (install.ts) calls it, and tests/pipStage.test.ts runs it against
 * tests/fixtures/fake-pip.mjs.
 *
 * - `--isolated` ignores `PIP_*` variables and pip's config files;
 *   `--no-index` with a local `--find-links` folder means pip never touches
 *   the network, so its proxy and certificate handling never come into it;
 *   `--only-binary=:all:` means no build step can run on a user's machine;
 *   `--no-deps --require-hashes` installs exactly the lock, each wheel by its
 *   sha256. `--no-compile` is NOT passed: it would save 99.3 MB and the
 *   compile time at the cost of the first start, and §3a.8 row 27 measures
 *   that before it is chosen.
 * - The bar is the count of `*.dist-info` folders that appear in
 *   site-packages, polled every 500 ms, against the lock's line count. The
 *   folders there before pip starts (pip's own, in a fresh pack) are not
 *   counted. Whether pip writes them one package at a time is row 34.
 * - The stage text is pip's last `Processing …` / `Installing …` /
 *   `Successfully installed …` line.
 * - A cancel kills pip's tree (`taskkill /f /t` on Windows, the shot finder's
 *   precedent; SIGKILL elsewhere, where pip starts no children for a
 *   binary-only install) and rejects with a `CancelledError` once the child
 *   has gone, so the job never deletes a folder pip is still writing.
 * - A failure rejects with a worded reason: pip's last `ERROR:` line, and
 *   distlib's "Failed to write executable" (a console-script launcher that
 *   Windows would not let pip write; antivirus has flagged distlib's
 *   launchers before, pypa/distlib #126) as `PIP_LAUNCHER_SENTENCE`.
 */

import type { ChildProcess } from 'node:child_process'
import { dirname } from 'node:path'
import { readdir } from 'node:fs/promises'
import { CancelledError, lineSplitter } from '../ffmpeg/run'
import type { PipStageOptions, RunPip, Spawn } from './installTypes'

/** How often site-packages is read for new `*.dist-info` folders. */
export const PIP_POLL_MS = 500

/** pip's "Failed to write executable", worded (§3a.3 stage 3). */
export const PIP_LAUNCHER_SENTENCE =
  "Windows would not let pip write a small launcher file; antivirus may have blocked it. Repair, or allow the AI helper's folder."

/** How many of pip's last lines a failure keeps, for the job's log. */
const TAIL_LINES = 40

/** The lines that say what pip is doing: the stage text. */
const STAGE_LINE = /^(Processing |Installing |Successfully installed )/

/** pip's own error lines. A hash mismatch is one `ERROR:` line followed by indented `Expected`/`Got` lines. */
const ERROR_LINE = /^ERROR: /

/** distlib's warning when a launcher cannot be written (scripts.py `_write_script`). */
const LAUNCHER_LINE = /Failed to write executable/

/**
 * pip's whole argv, the interpreter first, as one ordered list: what the
 * child is started with, and what tests/pipStage.test.ts holds as one shape.
 */
export function pipArgs(o: Pick<PipStageOptions, 'python' | 'lock' | 'findLinks'>): string[] {
  return [
    o.python,
    '-E',
    '-s',
    '-m',
    'pip',
    'install',
    '--isolated',
    '--no-index',
    '--find-links',
    o.findLinks,
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
    o.lock
  ]
}

/** A pip run that did not finish: the worded reason, its exit code and its last lines. */
export class PipError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly lines: string[]
  ) {
    super(message)
    this.name = 'PipError'
  }
}

/** Why pip failed, in a sentence: the launcher's, or pip's last `ERROR:` line, or its last line. */
export function pipFailure(code: number | null, signal: NodeJS.Signals | null, lines: readonly string[]): string {
  if (lines.some((line) => LAUNCHER_LINE.test(line))) return PIP_LAUNCHER_SENTENCE
  const errors = lines.filter((line) => ERROR_LINE.test(line))
  const last = errors.at(-1) ?? lines.filter((line) => line.trim() !== '').at(-1)
  const how = signal ? `signal ${signal}` : `exit ${code}`
  return last ? `pip could not install the libraries (${how}): ${last.trim()}` : `pip could not install the libraries (${how})`
}

/** The `*.dist-info` folders in `dir` now; none when it cannot be read (not made yet). */
async function distInfos(dir: string): Promise<Set<string>> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return new Set(entries.filter((e) => e.isDirectory() && e.name.endsWith('.dist-info')).map((e) => e.name))
  } catch {
    return new Set()
  }
}

/** pip and its tree: taskkill /f /t on Windows (through the injected spawn), SIGKILL elsewhere. */
function killTree(child: ChildProcess, spawn: Spawn): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true })
    killer.once('error', () => child.kill('SIGKILL'))
    return
  }
  child.kill('SIGKILL')
}

export const runPip: RunPip = async (o: PipStageOptions): Promise<void> => {
  if (o.signal.aborted) throw new CancelledError()
  const before = await distInfos(o.sitePackages)
  if (o.signal.aborted) throw new CancelledError()

  const argv = pipArgs(o)
  let done = 0
  let line: string | null = null
  const tail: string[] = []
  const keep = (text: string): void => {
    tail.push(text)
    if (tail.length > TAIL_LINES) tail.shift()
  }
  const report = (): void => o.onProgress(done, o.total, line)

  /** Count what is new since the start; never down, never past the total. */
  const count = async (): Promise<boolean> => {
    const now = await distInfos(o.sitePackages)
    let fresh = 0
    for (const name of now) if (!before.has(name)) fresh++
    const next = Math.min(o.total, Math.max(done, fresh))
    if (next === done) return false
    done = next
    return true
  }

  report()

  return new Promise<void>((resolve, reject) => {
    // cwd: the downloads folder, which holds only our verified wheels. `-m`
    // puts the working directory first on sys.path, and main's own (the
    // install folder, or / on the Mac) is nobody's choice.
    const child = o.spawn(argv[0], argv.slice(1), {
      cwd: o.findLinks || dirname(o.lock),
      env: o.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    let cancelled = false
    let startError: Error | null = null
    let polling = false
    const timer = setInterval(() => {
      if (polling) return
      polling = true
      void count()
        .then((changed) => {
          if (changed) report()
        })
        .finally(() => (polling = false))
    }, PIP_POLL_MS)

    const onAbort = (): void => {
      cancelled = true
      killTree(child, o.spawn)
    }
    o.signal.addEventListener('abort', onAbort, { once: true })

    const out = lineSplitter((text) => {
      keep(text)
      const trimmed = text.trim()
      if (STAGE_LINE.test(trimmed) && trimmed !== line) {
        line = trimmed
        report()
      }
    })
    const err = lineSplitter(keep)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => out.push(chunk))
    child.stderr?.on('data', (chunk: string) => err.push(chunk))

    child.once('error', (error) => {
      startError = error
    })

    // 'close', not 'exit': every line read, and (on Windows, after taskkill) the tree gone.
    child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      out.end()
      err.end()
      clearInterval(timer)
      o.signal.removeEventListener('abort', onAbort)
      if (cancelled) {
        reject(new CancelledError())
        return
      }
      if (startError && child.pid === undefined) {
        reject(new PipError(`Could not start the AI helper's Python for pip: ${startError.message}`, null, [...tail]))
        return
      }
      if (code !== 0) {
        reject(new PipError(pipFailure(code, signal, tail), code, [...tail]))
        return
      }
      // A last count, so the bar ends where pip did.
      void count().then(
        () => {
          report()
          resolve()
        },
        () => resolve()
      )
    })
  })
}
