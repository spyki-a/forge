import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statfsSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FETCH_RETRY, fetchVerified } from '../src/main/net/fetchFile'
import { unpackTarGz } from '../src/main/sidecar/unpack'
import { compileStdlib } from '../src/main/sidecar/compile'
import { runPip } from '../src/main/sidecar/pip'
import { checkPack } from '../src/main/sidecar/check'
import { appPackFs, helperInstallOptions, helperWorkers, packRename } from '../src/main/sidecar/installDeps'

/*
 * The AI helper's install job, given its real dependencies
 * (src/main/sidecar/installDeps.ts, docs/CLIPS.md §3a.3). Until this file's
 * module existed every press failed "not part of this build yet": the job
 * was wired to workers that refuse. Here: the workers are the modules' own,
 * not stand-ins; and the file system the job runs on creates its lock
 * exclusively and renames through the retried rename. The real install
 * through all of it is tests/integration/helperPack.int.test.ts.
 */

const scratch = mkdtempSync(join(tmpdir(), 'forge-install-deps-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe('the real workers', () => {
  it('are the fetcher, the unpacker, the compile, pip and the check that were built, with the shared retry', () => {
    const w = helperWorkers()
    expect(w.fetchVerified).toBe(fetchVerified)
    expect(w.unpack).toBe(unpackTarGz)
    expect(w.compileStdlib).toBe(compileStdlib)
    expect(w.pip).toBe(runPip)
    expect(w.check).toBe(checkPack)
    expect(w.retry).toBe(FETCH_RETRY)
  })

  it('are what the app hands registerIpc, with the retried rename', () => {
    const o = helperInstallOptions()
    expect(o.helperWorkers).toEqual(helperWorkers())
    expect(o.helperRename).toBe(packRename)
    expect(appPackFs().rename).toBe(packRename)
  })
})

describe('the file system the job runs on', () => {
  it('creates the lock only when it is not there, and never writes through one that is', async () => {
    const fs = appPackFs()
    const lock = join(scratch, '.lock')
    await fs.createExclusive(lock, '{"pid":1,"startedAt":1}')
    await expect(fs.createExclusive(lock, '{"pid":2,"startedAt":2}')).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(lock, 'utf8')).toBe('{"pid":1,"startedAt":1}')
  })

  it('renames, and removes a tree with the retries it is asked for', async () => {
    const fs = appPackFs()
    writeFileSync(join(scratch, 'a.part'), 'x')
    await fs.rename(join(scratch, 'a.part'), join(scratch, 'a'))
    expect(readFileSync(join(scratch, 'a'), 'utf8')).toBe('x')
    await fs.rm(join(scratch, 'a'), { recursive: true, force: true, maxRetries: 10 })
    expect(existsSync(join(scratch, 'a'))).toBe(false)
  })

  it('says the bytes this user may write on the volume: statfs’s bavail × bsize', async () => {
    const s = statfsSync(scratch)
    const free = await appPackFs().freeBytes(scratch)
    // Other processes write meanwhile: within 64 MB of a second reading, and never the blocks only root may use.
    expect(Math.abs(free - Number(s.bavail) * Number(s.bsize))).toBeLessThan(64 * 1024 * 1024)
    expect(free).toBeLessThanOrEqual(Number(s.bfree) * Number(s.bsize) + 64 * 1024 * 1024)
  })
})
