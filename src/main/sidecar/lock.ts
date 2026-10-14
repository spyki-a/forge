import { mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises'
import { readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { HELPER_BUSY, HELPER_IN_USE_ELSEWHERE } from '@shared/sidecar/install'
import type { PackFs } from './installTypes'

/**
 * The AI helper's lock across app instances (docs/CLIPS.md §3a.3 "Across app
 * instances", §16.50 (a)).
 *
 * Nothing makes Forge single-instance, so a double-clicked shortcut opens a
 * second app on the same userData. Install, Repair, Remove, Update, Check
 * again and the launch sweep each hold `<root>/.lock` while they run: created
 * with `O_EXCL`, holding `{pid, startedAt}`. A lock whose pid is not alive is
 * stale and is taken over. Each instance whose helper runs from a pack keeps
 * `<root>/in-use/<pid>` (service.ts writes it); `readInUse` is its reader.
 *
 * Inside one process the same file would name this process's own pid, which
 * is alive, so a lock held here is tracked here too: a second taker in this
 * process is refused with `HELPER_BUSY`, and a lock file that names this
 * pid without being held here is a previous process's that had the same pid
 * (pid reuse after a crash), and is stale.
 *
 * Not closed: two instances that both find the same STALE lock at the same
 * moment can each unlink it and create their own. That needs a dead holder
 * and two launches within a few milliseconds of each other.
 */

export interface LockHolder {
  pid: number
  startedAt: number
}

export interface LockOptions {
  pid: number
  now(): number
  isAlive(pid: number): boolean
}

export interface PackLock {
  readonly holder: LockHolder
  /** Unlinks the lock only if it is still the one this call wrote. */
  release(): Promise<void>
  /** The same, synchronously: for a quit, which may not wait. */
  releaseSync(): void
}

/** A refusal, with the sentence the job or the row shows. */
export class LockRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LockRefused'
  }
}

/** An empty or torn lock younger than this is someone's create-then-write in progress, not a dead holder's. */
const TORN_LOCK_GRACE_MS = 10_000

/** Locks this process holds, by lock file and pid (a test plays two instances with two pids in one process). */
const heldHere = new Set<string>()

export function lockPath(root: string): string {
  return join(root, '.lock')
}

/** Whether a process is alive: signal 0 tests for it on every platform Node runs on. EPERM is alive and someone else's. */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function holderFrom(text: string): LockHolder | null {
  try {
    const value = JSON.parse(text) as Partial<LockHolder>
    if (typeof value?.pid === 'number' && Number.isInteger(value.pid) && typeof value.startedAt === 'number') {
      return { pid: value.pid, startedAt: value.startedAt }
    }
  } catch {
    // torn
  }
  return null
}

const codeOf = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | null)?.code

/**
 * Take `<root>/.lock`, or refuse with the reason: `HELPER_IN_USE_ELSEWHERE`
 * while another live instance holds it, `HELPER_BUSY` while this process does.
 */
export async function acquireLock(root: string, fs: PackFs, o: LockOptions): Promise<PackLock> {
  const file = lockPath(root)
  const key = `${file}\0${o.pid}`
  if (heldHere.has(key)) throw new LockRefused(HELPER_BUSY)
  // Reserved before the first await: two takers in this process in the same tick would otherwise both
  // reach the file, and the second would read the first's lock (this pid) as a dead process's and take it over.
  heldHere.add(key)
  try {
    return await take(root, file, key, fs, o)
  } catch (err) {
    heldHere.delete(key)
    throw err
  }
}

async function take(root: string, file: string, key: string, fs: PackFs, o: LockOptions): Promise<PackLock> {
  await mkdir(root, { recursive: true })
  for (let attempt = 0; attempt < 3; attempt++) {
    const holder: LockHolder = { pid: o.pid, startedAt: o.now() }
    try {
      await fs.createExclusive(file, JSON.stringify(holder))
      return made(file, key, holder)
    } catch (err) {
      if (codeOf(err) !== 'EEXIST') throw err
    }
    // Held: by whom?
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (err) {
      if (codeOf(err) === 'ENOENT') continue // released between the two calls: try again
      throw err
    }
    const other = holderFrom(text)
    if (!other) {
      // Empty or torn: a create whose write has not landed yet, or a holder that died between the two.
      // Its age by the wall clock, which is what wrote its mtime (`o.now` may be a test's).
      const age = await stat(file).then(
        (s) => Date.now() - s.mtimeMs,
        () => Infinity
      )
      if (age < TORN_LOCK_GRACE_MS) throw new LockRefused(HELPER_IN_USE_ELSEWHERE)
    } else if (other.pid !== o.pid && o.isAlive(other.pid)) {
      throw new LockRefused(HELPER_IN_USE_ELSEWHERE)
    }
    // Stale: a dead holder, a previous process that had this pid, or a torn file nobody finished. Taken over.
    await unlink(file).catch((err: unknown) => {
      if (codeOf(err) !== 'ENOENT') throw err
    })
  }
  throw new LockRefused(HELPER_IN_USE_ELSEWHERE)
}

function made(file: string, key: string, holder: LockHolder): PackLock {
  let released = false
  const ours = (text: string): boolean => {
    const now = holderFrom(text)
    return now !== null && now.pid === holder.pid && now.startedAt === holder.startedAt
  }
  return {
    holder,
    async release(): Promise<void> {
      if (released) return
      released = true
      heldHere.delete(key)
      try {
        if (ours(await readFile(file, 'utf8'))) await unlink(file)
      } catch (err) {
        if (codeOf(err) !== 'ENOENT') console.warn('[helper] could not release the lock', err)
      }
    },
    releaseSync(): void {
      if (released) return
      released = true
      heldHere.delete(key)
      try {
        if (ours(readFileSync(file, 'utf8'))) unlinkSync(file)
      } catch (err) {
        if (codeOf(err) !== 'ENOENT') console.warn('[helper] could not release the lock', err)
      }
    }
  }
}

export interface InUse {
  pid: number
  /** The pack number its helper runs from; null when the record names none (unreadable): treat it as any. */
  pack: number | null
}

/**
 * The packs live instances have in use: `<root>/in-use/<pid>` files whose pid
 * is alive. A record of a dead pid (an instance that crashed with its helper
 * running) is removed, and is not counted.
 */
export async function readInUse(root: string, isAlive: (pid: number) => boolean): Promise<InUse[]> {
  const dir = join(root, 'in-use')
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const live: InUse[] = []
  for (const name of names) {
    if (!/^[1-9]\d*$/.test(name)) continue
    const pid = Number(name)
    if (!isAlive(pid)) {
      await unlink(join(dir, name)).catch(() => undefined)
      continue
    }
    let pack: number | null = null
    try {
      const value = JSON.parse(await readFile(join(dir, name), 'utf8')) as { pack?: unknown }
      if (typeof value?.pack === 'number' && Number.isInteger(value.pack)) pack = value.pack
    } catch {
      // unreadable: named as any pack
    }
    live.push({ pid, pack })
  }
  return live
}
