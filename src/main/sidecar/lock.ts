import { mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises'
import { readFileSync, statSync, unlinkSync } from 'node:fs'
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
 * A takeover re-reads (§16.53 (b)). Two instances that find the same STALE
 * lock at the same moment can each unlink it and create their own: the
 * slower one's unlink removes the lock the faster one has just written. So a
 * taker that unlinked a stale lock waits `settle` after its create and reads
 * the file again; when it is not the one it wrote (another pid's, or none),
 * it yields with `HELPER_IN_USE_ELSEWHERE` and touches nothing, and the one
 * whose lock is there holds it. Still open: a taker paused for longer than
 * the settle between its read of the stale lock and its unlink, and a plain
 * create (no takeover) clobbered by such a laggard: three instances at once.
 *
 * Every helper start from a pack asks `lockedElsewhere` first (service.ts,
 * §16.53 (a)): while another live instance holds the lock, the start is
 * refused, so nothing runs from a folder its Repair or Remove may delete.
 */

export interface LockHolder {
  pid: number
  startedAt: number
}

export interface LockOptions {
  pid: number
  now(): number
  isAlive(pid: number): boolean
  /**
   * How long a takeover waits after its create before it reads the file
   * again (`TAKEOVER_SETTLE_MS`); a test passes a promise that resolves when
   * the other taker has written.
   */
  settle?(): Promise<void>
}

/**
 * A takeover's wait before its re-read: longer than another taker's unlink
 * and create, two file calls that take well under a millisecond on the Mac
 * and can take tens on Windows with a scanner in the way. Only a takeover
 * pays it, and a takeover means an instance died holding the lock.
 */
export const TAKEOVER_SETTLE_MS = 100

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
  /** This call unlinked a stale lock: its create may race another taker's unlink. */
  let tookOver = false
  for (let attempt = 0; attempt < 3; attempt++) {
    const holder: LockHolder = { pid: o.pid, startedAt: o.now() }
    let created = false
    try {
      await fs.createExclusive(file, JSON.stringify(holder))
      created = true
    } catch (err) {
      if (codeOf(err) !== 'EEXIST') throw err
    }
    if (created) {
      if (tookOver && !(await stillOurs(file, holder, o))) {
        // Another taker unlinked this lock after it was written and wrote its own: it holds it, and this
        // one leaves the file alone (a release here could only find someone else's).
        throw new LockRefused(HELPER_IN_USE_ELSEWHERE)
      }
      return made(file, key, holder)
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
    await fs.rm(file, { recursive: false, force: true })
    tookOver = true
  }
  throw new LockRefused(HELPER_IN_USE_ELSEWHERE)
}

/** After a takeover's create: the settle, then whether the file is still the lock this call wrote. */
async function stillOurs(file: string, holder: LockHolder, o: LockOptions): Promise<boolean> {
  await (o.settle ? o.settle() : new Promise<void>((resolve) => setTimeout(resolve, TAKEOVER_SETTLE_MS)))
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return false
  }
  const now = holderFrom(text)
  return now !== null && now.pid === holder.pid && now.startedAt === holder.startedAt
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

/**
 * Whether another live instance holds `<root>/.lock` now (§16.53 (a)), read
 * synchronously: `getSidecar()` must refuse before it returns. This
 * process's own lock (its job, Remove, Check again or sweep, by `pid`) is
 * not another's. An empty or torn lock younger than the grace is someone's
 * create still writing: another's, unless this process is taking the lock
 * itself. An unreadable one (EACCES, EBUSY) is held, the safe side.
 */
export function lockedElsewhere(root: string, o: Pick<LockOptions, 'pid' | 'isAlive'>): boolean {
  const file = lockPath(root)
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    return codeOf(err) !== 'ENOENT' && codeOf(err) !== 'ENOTDIR'
  }
  const holder = holderFrom(text)
  if (holder) return holder.pid !== o.pid && o.isAlive(holder.pid)
  if (heldHere.has(`${file}\0${o.pid}`)) return false
  try {
    return Date.now() - statSync(file).mtimeMs < TORN_LOCK_GRACE_MS
  } catch {
    return false
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
