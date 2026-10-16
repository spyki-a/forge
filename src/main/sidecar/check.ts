/**
 * The install job's stage 4, "Checking the AI helper" (docs/CLIPS.md §3a.3):
 * the freshly installed pack started exactly as the service will start it,
 * and asked what it is. `CheckPack` in installTypes.ts is the contract; the
 * job (install.ts) calls it, and tests/packCheck.test.ts runs it against
 * tests/fixtures/fake-helper.mjs.
 *
 * A `SidecarClient` on the pack's launch, cwd `sidecarDir()`, `maxRestarts:
 * 0` (a pack that crashes is the answer, not something to retry), and the
 * client's own hello ceiling for that rung (`helloTimeoutFor`: the pack's 90
 * s until §3a.8 row 29) — read, never carried here, so the check and the
 * service never disagree on it. Then:
 *
 * - `executable`, `prefix` and EVERY `sys.path` entry inside the version
 *   folder or `sidecarDir`, by `path.relative` on real paths
 *   (`fs.realpathSync.native`, through the longest part that exists:
 *   `python314.zip` is on every `sys.path` and on no disk), never by a string
 *   prefix, which would take `…/python-evil` as inside `…/python`. A relative
 *   entry is the helper's working directory's: `''` (a `-c` child's marker)
 *   resolves to `sidecarDir` and passes; `..` resolves outside and does not.
 *   On Windows `path.relative` compares without case, and `.native` gives
 *   long names for 8.3 short ones, so `C:\\Users\\RUNNER~1` and its long name
 *   are one folder;
 * - `python` the manifest's version;
 * - each of the platform's `expects` among hello's capabilities, a missing
 *   one named with hello's own reason for it;
 * - one `system.ping`;
 * - `system.selftest`, each group's start passed on as a message and, by its
 *   name, as `onGroup` (the job's speed column: "checking the AI helper ·
 *   beats"), and every group answered for.
 *
 * Its progress (`onProgress`, 0..1): `CHECK_HELLO_SHARE` once the hello and
 * the ping are back, then the self-test's own count of groups, then 1.
 *
 * What it finds is collected, never thrown, in two lists (§16.51):
 * `integrity`, the first two above (an interpreter, prefix or path entry
 * outside the pack, or another Python: the app's launch or the archive, which
 * nothing the user does can mend), and `problems`, an `expects` method hello
 * did not register and a group the self-test left out. Both keep the pack
 * (§3a.3 "When the check fails part of the way"); the row names them apart.
 * It rejects only when the helper does not start or answer at all (the job
 * then removes the pack and offers Repair), or with a `CancelledError` on
 * the job's cancel. The client is stopped, and its exit awaited, before it
 * resolves or rejects.
 */

import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { SIDECAR_METHODS, type HelloResult } from '@shared/sidecar/protocol'
import { SELFTEST_GROUP_NAMES, type SelftestResult } from '@shared/sidecar/selftest'
import { CancelledError } from '../ffmpeg/run'
import { SidecarClient, helloTimeoutFor } from './client'
import type { CheckPack, PackCheck, PackCheckOptions } from './installTypes'

/** One group's ceiling inside the helper: sidecar/forge_sidecar/selftest.py `GROUP_TIMEOUT_S`. */
const GROUP_TIMEOUT_MS = 60_000

/**
 * The longest `system.selftest` may take at the transport: every group at
 * its own ceiling (the helper kills a group at 60 s and says so) and half a
 * minute more. The helper answers long before this unless it has stopped
 * answering at all.
 */
export const SELFTEST_TIMEOUT_MS = SELFTEST_GROUP_NAMES.length * GROUP_TIMEOUT_MS + 30_000

/**
 * The hello's share of the check's progress (`onProgress`): the first
 * start of a freshly written pack took 11.3–14.4 s of a 37–39 s check on
 * the M1 Pro (§3a.8 row 27), the self-test the rest, which moves the bar
 * group by group.
 */
export const CHECK_HELLO_SHARE = 0.35

/** The real path of `p` through its longest part that exists; the rest is joined on as it is. */
export function realPathLoose(p: string): string {
  try {
    return realpathSync.native(p)
  } catch {
    const parent = dirname(p)
    if (parent === p) return p
    return join(realPathLoose(parent), basename(p))
  }
}

/** Whether `p` is `root` or inside it: by `path.relative`, never by a string prefix. */
export function isInside(root: string, p: string): boolean {
  const rel = relative(root, p)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

type HelloCheck = Pick<PackCheckOptions, 'versionDir' | 'sidecarDir' | 'manifest' | 'platform'>

/**
 * The integrity problems in hello (§16.51): the interpreter, its prefix or a
 * `sys.path` entry outside the pack and the helper's folder, or a Python
 * other than the manifest's. The pack is kept and runs; the receipt records
 * them and the ready status carries them, so the row warns and offers Repair.
 */
export function integrityProblems(hello: HelloResult, o: HelloCheck): string[] {
  const problems: string[] = []
  const roots = [realPathLoose(o.versionDir), realPathLoose(o.sidecarDir)]
  const outside = (p: string): boolean => {
    const real = realPathLoose(resolve(o.sidecarDir, p))
    return !roots.some((root) => isInside(root, real))
  }
  if (outside(hello.executable)) problems.push(`The AI helper's interpreter is outside its folder: ${hello.executable}`)
  if (outside(hello.prefix)) problems.push(`The AI helper's Python prefix is outside its folder: ${hello.prefix}`)
  for (const entry of hello.path) {
    if (outside(entry)) problems.push(`The AI helper's Python path reaches outside its folder: ${entry === '' ? "'' (the working directory)" : entry}`)
  }
  const version = o.manifest.python.version
  if (hello.python !== version) problems.push(`The AI helper runs Python ${hello.python}, not ${version}`)
  return problems
}

/** Each of the platform's `expects` that hello did not register, with hello's own reason for it: a degraded method, not an integrity problem. */
export function expectsProblems(hello: HelloResult, o: Pick<HelloCheck, 'manifest' | 'platform'>): string[] {
  const problems: string[] = []
  for (const method of o.manifest.platforms[o.platform].expects) {
    if (hello.capabilities.includes(method)) continue
    const reason = hello.degraded[method]
    problems.push(reason ? `${method} is not available: ${reason}` : `${method} is not available: the AI helper did not register it`)
  }
  return problems
}

/**
 * The self-test group a progress line names ("checking beats · 2 of 6",
 * selftest.py's words), or null: one of `SELFTEST_GROUP_NAMES`, never a word
 * read out of the line on trust.
 */
export function selftestGroupOf(message: string): string | null {
  return SELFTEST_GROUP_NAMES.find((group) => message.startsWith(`checking ${group} · `)) ?? null
}

/** A self-test answer that leaves a group out is not this build's helper. */
export function selftestProblems(result: SelftestResult): string[] {
  const problems: string[] = []
  for (const group of SELFTEST_GROUP_NAMES) {
    const one = (result as Partial<SelftestResult>)[group]
    if (!one || typeof one.exit !== 'number') problems.push(`The AI helper's self-test did not answer for ${group}`)
  }
  return problems
}

export const checkPack: CheckPack = async (o: PackCheckOptions): Promise<PackCheck> => {
  if (o.signal.aborted) throw new CancelledError()
  const client = new SidecarClient({
    cwd: o.sidecarDir,
    launch: o.launch,
    maxRestarts: 0,
    helloTimeoutMs: helloTimeoutFor(o.launch.source)
  })
  /*
   * One stop, shared: a cancel stops the client at once (which rejects a
   * start or a request in flight), and the `finally` below awaits that same
   * stop. A second `client.stop()` resolves at once once the first has taken
   * the child, so awaiting a fresh one would not wait for the exit.
   */
  let stopped: Promise<void> | null = null
  const stop = (): Promise<void> => (stopped ??= client.stop())
  const onAbort = (): void => void stop()
  o.signal.addEventListener('abort', onAbort, { once: true })
  try {
    const hello = await client.start()
    const integrity = integrityProblems(hello, o)
    const problems = expectsProblems(hello, o)
    await client.request(SIDECAR_METHODS.ping, { echo: 'check' }, { signal: o.signal })
    let reached = CHECK_HELLO_SHARE
    o.onProgress?.(reached)
    const selftest = await client.request<SelftestResult>(
      SIDECAR_METHODS.selftest,
      {},
      {
        signal: o.signal,
        timeoutMs: SELFTEST_TIMEOUT_MS,
        onProgress: (progress, message) => {
          if (message) {
            o.onMessage?.(message)
            // Before the fraction, so the job's report for this group's start carries its name.
            const group = selftestGroupOf(message)
            if (group) o.onGroup?.(group)
          }
          if (typeof progress !== 'number' || !Number.isFinite(progress)) return
          // Each group's start, as the helper counts them; never down.
          reached = Math.max(reached, CHECK_HELLO_SHARE + (1 - CHECK_HELLO_SHARE) * Math.min(1, Math.max(0, progress)))
          o.onProgress?.(reached)
        }
      }
    )
    problems.push(...selftestProblems(selftest))
    o.onProgress?.(1)
    return { hello, selftest, problems, integrity }
  } catch (err) {
    if (o.signal.aborted) throw new CancelledError()
    throw err
  } finally {
    o.signal.removeEventListener('abort', onAbort)
    await stop()
  }
}
