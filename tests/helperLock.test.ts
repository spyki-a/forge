import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HELPER_BUSY, HELPER_IN_USE_ELSEWHERE } from '../src/shared/sidecar/install'
import { LockRefused, acquireLock, lockPath, lockedElsewhere, pidAlive, readInUse } from '../src/main/sidecar/lock'
import { rename, rm, writeFile } from 'node:fs/promises'
import type { PackFs } from '../src/main/sidecar/installTypes'

/*
 * The lock across app instances (docs/CLIPS.md §3a.3 "Across app instances",
 * §16.50 (a)): `<root>/.lock` created with O_EXCL holding {pid, startedAt},
 * a dead holder taken over, a live one refused with the sentence, a release
 * that only unlinks the lock this call wrote, and the in-use records' reader.
 *
 * Two instances are two pids in this one process; whether a pid is alive is
 * the test's to say.
 */

const scratch: string[] = []
let root = ''
/** Node's own calls, as the app's PackFs makes them (install.ts `nodePackFs`): the lock is O_EXCL through `wx`. */
const fs: PackFs = {
  rename,
  rm: (path, options) => rm(path, options),
  createExclusive: (path, text) => writeFile(path, text, { flag: 'wx' }),
  freeBytes: async () => Number.MAX_SAFE_INTEGER
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-lock-'))
  scratch.push(dir)
  root = join(dir, 'python')
})

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

const options = (pid: number, alive: number[]) => ({ pid, now: Date.now, isAlive: (p: number) => alive.includes(p) })

function plantLock(pid: number, startedAt = 1_700_000_000_000): void {
  mkdirSync(root, { recursive: true })
  writeFileSync(lockPath(root), JSON.stringify({ pid, startedAt }))
}

const holder = (): { pid: number; startedAt: number } => JSON.parse(readFileSync(lockPath(root), 'utf8'))

describe('acquireLock', () => {
  it('creates <root>/.lock with this pid and when it started', async () => {
    const lock = await acquireLock(root, fs, { pid: 100, now: () => 1234, isAlive: () => true })
    expect(holder()).toEqual({ pid: 100, startedAt: 1234 })
    expect(lock.holder).toEqual({ pid: 100, startedAt: 1234 })
    await lock.release()
    expect(existsSync(lockPath(root))).toBe(false)
  })

  it('refuses while another live instance holds it, with the sentence, and leaves its lock alone', async () => {
    plantLock(200)
    const refused = await acquireLock(root, fs, options(100, [100, 200])).catch((err: unknown) => err)
    expect(refused).toBeInstanceOf(LockRefused)
    expect((refused as Error).message).toBe(HELPER_IN_USE_ELSEWHERE)
    expect(holder().pid).toBe(200)
  })

  it('takes over a lock whose pid is not alive', async () => {
    plantLock(200)
    const lock = await acquireLock(root, fs, options(100, [100]))
    expect(holder().pid).toBe(100)
    await lock.release()
  })

  it('takes over a lock that names this pid but is not held here: a previous process that had this pid', async () => {
    plantLock(100)
    const lock = await acquireLock(root, fs, options(100, [100]))
    expect(holder()).toEqual(lock.holder)
    expect(lock.holder.startedAt).not.toBe(1_700_000_000_000)
    await lock.release()
  })

  it('refuses a second taker in this process with its own sentence, until the first releases', async () => {
    const first = await acquireLock(root, fs, options(100, [100]))
    await expect(acquireLock(root, fs, options(100, [100]))).rejects.toThrow(HELPER_BUSY)
    await first.release()
    const second = await acquireLock(root, fs, options(100, [100]))
    await second.release()
  })

  it('two takers in this process in the same tick: one gets it, the other is refused, and the lock stays the first’s', async () => {
    const [a, b] = await Promise.allSettled([acquireLock(root, fs, options(100, [100])), acquireLock(root, fs, options(100, [100]))])
    const won = [a, b].filter((r) => r.status === 'fulfilled')
    const lost = [a, b].filter((r) => r.status === 'rejected')
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(1)
    expect(((lost[0] as PromiseRejectedResult).reason as Error).message).toBe(HELPER_BUSY)
    const lock = (won[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof acquireLock>>>).value
    expect(holder()).toEqual(lock.holder)
    await lock.release()
  })

  it('treats a torn lock as a create still writing while it is young, and as stale once it is old', async () => {
    mkdirSync(root, { recursive: true })
    writeFileSync(lockPath(root), '')
    await expect(acquireLock(root, fs, options(100, [100]))).rejects.toThrow(HELPER_IN_USE_ELSEWHERE)
    const old = new Date(Date.now() - 60_000)
    utimesSync(lockPath(root), old, old)
    const lock = await acquireLock(root, fs, options(100, [100]))
    expect(holder().pid).toBe(100)
    await lock.release()
  })
})

describe('two takeovers of one stale lock (§16.53 (b))', () => {
  function gate(): { promise: Promise<void>; open(): void } {
    let open!: () => void
    const promise = new Promise<void>((resolve) => (open = resolve))
    return { promise, open }
  }

  it('exactly one wins: the slower taker’s unlink removes the faster one’s new lock, and the faster one’s re-read sees it and yields', async () => {
    plantLock(300)
    // The interleaving the race needs, made certain: B has read the stale lock and decided to take it over
    // before A unlinks it, and B's unlink lands after A has written its own lock.
    const bAtUnlink = gate()
    const aCreated = gate()
    const bCreated = gate()
    const fsA: PackFs = {
      ...fs,
      rm: async (path, o) => {
        await bAtUnlink.promise
        await fs.rm(path, o)
      },
      createExclusive: async (path, text) => {
        await fs.createExclusive(path, text)
        aCreated.open()
      }
    }
    const fsB: PackFs = {
      ...fs,
      rm: async (path, o) => {
        bAtUnlink.open()
        await aCreated.promise
        await fs.rm(path, o)
      },
      createExclusive: async (path, text) => {
        await fs.createExclusive(path, text)
        bCreated.open()
      }
    }
    const alive = [100, 200]
    const [a, b] = await Promise.allSettled([
      // A re-reads once B has written: the moment the race is lost or won.
      acquireLock(root, fsA, { ...options(100, alive), settle: () => bCreated.promise }),
      acquireLock(root, fsB, { ...options(200, alive), settle: async () => undefined })
    ])
    const won = [a, b].filter((r) => r.status === 'fulfilled')
    expect(won, 'exactly one holds the lock').toHaveLength(1)
    expect(a.status, 'A, whose lock B removed, yields').toBe('rejected')
    expect(((a as PromiseRejectedResult).reason as Error).message).toBe(HELPER_IN_USE_ELSEWHERE)
    const lock = (b as PromiseFulfilledResult<Awaited<ReturnType<typeof acquireLock>>>).value
    // The file is the winner's, and the loser left it alone.
    expect(holder()).toEqual(lock.holder)
    expect(holder().pid).toBe(200)
    await lock.release()
    expect(existsSync(lockPath(root))).toBe(false)
  })

  it('a takeover nobody races keeps the lock it wrote, after the settle', async () => {
    plantLock(300)
    let settled = 0
    const lock = await acquireLock(root, fs, { ...options(100, [100]), settle: async () => void settled++ })
    expect(settled, 'the takeover waits once before its re-read').toBe(1)
    expect(holder()).toEqual(lock.holder)
    await lock.release()
    // A plain create, no takeover, does not wait.
    const plain = await acquireLock(root, fs, { ...options(100, [100]), settle: async () => void settled++ })
    expect(settled).toBe(1)
    await plain.release()
  })
})

describe('lockedElsewhere: what a helper start from a pack asks first (§16.53 (a))', () => {
  it('is true only for another live instance’s lock, or a torn one still being written', () => {
    const o = { pid: 100, isAlive: (p: number) => p === 100 || p === 200 }
    expect(lockedElsewhere(root, o), 'no root at all').toBe(false)
    plantLock(200)
    expect(lockedElsewhere(root, o), 'another live window').toBe(true)
    plantLock(300)
    expect(lockedElsewhere(root, o), 'a dead holder: stale, nobody is deleting anything').toBe(false)
    plantLock(100)
    expect(lockedElsewhere(root, o), 'this window’s own job').toBe(false)
    writeFileSync(lockPath(root), '')
    expect(lockedElsewhere(root, o), 'a create still writing').toBe(true)
    const old = new Date(Date.now() - 60_000)
    utimesSync(lockPath(root), old, old)
    expect(lockedElsewhere(root, o), 'a torn lock nobody finished').toBe(false)
  })
})

describe('release', () => {
  it('leaves another instance’s lock alone: one that took over after this one was thought dead', async () => {
    const mine = await acquireLock(root, fs, options(100, [100]))
    // Another instance found 100 dead and took the lock over.
    plantLock(200, 99)
    await mine.release()
    expect(existsSync(lockPath(root))).toBe(true)
    expect(holder()).toEqual({ pid: 200, startedAt: 99 })
  })

  it('releaseSync does the same, at once, for a quit', async () => {
    const mine = await acquireLock(root, fs, options(100, [100]))
    mine.releaseSync()
    expect(existsSync(lockPath(root))).toBe(false)
    const again = await acquireLock(root, fs, options(100, [100]))
    plantLock(300, 5)
    again.releaseSync()
    expect(holder().pid).toBe(300)
  })
})

describe('readInUse', () => {
  function plantInUse(pid: number, text: string): void {
    mkdirSync(join(root, 'in-use'), { recursive: true })
    writeFileSync(join(root, 'in-use', String(pid)), text)
  }

  it('names the packs live instances run, ignores a dead pid’s record and removes it', async () => {
    plantInUse(100, JSON.stringify({ pack: 1 }))
    plantInUse(200, JSON.stringify({ pack: 1 }))
    plantInUse(300, 'not json')
    writeFileSync(join(root, 'in-use', 'notes.txt'), 'x')
    const live = await readInUse(root, (pid) => pid === 100 || pid === 300)
    expect(live.sort((a, b) => a.pid - b.pid)).toEqual([
      { pid: 100, pack: 1 },
      // A live record that names no pack is any pack.
      { pid: 300, pack: null }
    ])
    expect(existsSync(join(root, 'in-use', '200')), 'the dead instance’s record').toBe(false)
    expect(existsSync(join(root, 'in-use', '100'))).toBe(true)
  })

  it('is empty with no in-use folder', async () => {
    expect(await readInUse(root, () => true)).toEqual([])
  })
})

describe('pidAlive', () => {
  it('is true for this process and false for a pid that cannot be', () => {
    expect(pidAlive(process.pid)).toBe(true)
    expect(pidAlive(0)).toBe(false)
    expect(pidAlive(-1)).toBe(false)
    expect(pidAlive(2 ** 22 + 12345)).toBe(false)
  })
})
