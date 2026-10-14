import { join } from 'node:path'
import type { spawn as nodeSpawn } from 'node:child_process'
import { CancelledError } from '../ffmpeg/run'
import type { PackPlatform } from '@shared/sidecar/pack'

/**
 * The AI helper's standard library, compiled once, right after the unpack and
 * before pip (docs/CLIPS.md §3a.3 stage 2).
 *
 * Every `.pyc` either pinned archive ships is STALE once unpacked (row 26,
 * EFFECTS §57: 3 on the Mac, 572 on Windows), and the pack's helper runs with
 * `-B`, so without this step every start would compile the standard library in
 * memory and write nothing. The command is the one measured: `<python> -I -m
 * compileall -q -j 1 <stdlib>` (2.22 s on the Mac, 1,059 `.pyc`; 2.03 s for
 * Windows' tree compiled on the Mac). `-j 0` failed in the dev sandbox on
 * `SC_SEM_NSEMS_MAX`, so it is `-j 1`, which also means compileall runs in
 * this one process with no worker pool, and killing the child ends it all.
 */

export interface CompileStdlibOptions {
  /** The pack's interpreter. */
  python: string
  /** `python/lib/python3.14` on the Mac, `python\Lib` on Windows (`stdlibOf`). */
  stdlib: string
  /** The pack's environment. */
  env: NodeJS.ProcessEnv
  spawn: typeof nodeSpawn
  signal: AbortSignal
}

/** The argv after the interpreter, as one shape: `-I -m compileall -q -j 1 <stdlib>`. */
export function compileArgs(stdlib: string): string[] {
  return ['-I', '-m', 'compileall', '-q', '-j', '1', stdlib]
}

/**
 * Where the pack's standard library is, inside its version folder: the tree
 * `install_only` unpacks is `python/…` (§3a.2's layout), with the library at
 * `lib/python<major>.<minor>` on the Mac and `Lib` on Windows (row 26).
 */
export function stdlibOf(versionDir: string, platform: PackPlatform, pythonVersion: string): string {
  if (platform === 'win32-x64') return join(versionDir, 'python', 'Lib')
  const [major, minor] = pythonVersion.split('.')
  return join(versionDir, 'python', 'lib', `python${major}.${minor}`)
}

/** The last non-empty line of what a stream said, kept short. */
function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return (lines[lines.length - 1] ?? '').slice(0, 500)
}

/**
 * Compile the standard library. Resolves on exit 0; a non-zero exit rejects
 * naming the child's last stderr line (compileall's `-q` prints a failed
 * file's error on stdout, so that is the fallback); the signal kills the child
 * and rejects as a cancel.
 */
export function compileStdlib(o: CompileStdlibOptions): Promise<void> {
  if (o.signal.aborted) return Promise.reject(new CancelledError())
  return new Promise<void>((resolve, reject) => {
    const child = o.spawn(o.python, compileArgs(o.stdlib), {
      env: o.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    // The tail only: a broken tree could print a line per file.
    let stderr = ''
    let stdout = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-8192)
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString('utf8')).slice(-8192)
    })
    const cancel = (): void => {
      child.kill('SIGKILL')
    }
    o.signal.addEventListener('abort', cancel, { once: true })
    let settled = false
    const settle = (err: Error | null): void => {
      if (settled) return
      settled = true
      o.signal.removeEventListener('abort', cancel)
      if (err) reject(err)
      else resolve()
    }
    child.on('error', (err) => {
      settle(o.signal.aborted ? new CancelledError() : new Error(`Python could not be started to compile its standard library: ${err.message}`, { cause: err }))
    })
    child.on('close', (code, signal) => {
      if (o.signal.aborted) return settle(new CancelledError())
      if (code === 0) return settle(null)
      const said = lastLine(stderr) || lastLine(stdout)
      const how = code === null ? `was stopped (${signal})` : `exited with ${code}`
      settle(new Error(`Compiling Python's standard library failed: compileall ${how}${said ? `: ${said}` : ''}`))
    })
  })
}
