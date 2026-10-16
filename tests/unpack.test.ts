import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { gzipSync } from 'node:zlib'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { unpackTarGz } from '../src/main/sidecar/unpack'
import { compileArgs, compileStdlib, stdlibOf } from '../src/main/sidecar/compile'
import { noise, tarOf, type TarSpec } from './fixtures/tarWriter'

/*
 * The AI helper's interpreter, unpacked and compiled (docs/CLIPS.md §3a.3
 * stage 2, §3a.7). Archives built in the test, and — when row 26's download is
 * on this machine — the REAL Mac archive, unpacked by this code and compared
 * file by file with what `tar -xzf` made of it, then run.
 */

const POSIX = process.platform !== 'win32'
const ROW26 =
  process.env.FORGE_ROW26_DIR ?? '/private/tmp/claude-501/-Users-spyker-my-claude/c20fe2df-facd-4bef-a6b9-df41e326182a/scratchpad/row26'
const REAL_ARCHIVE = join(ROW26, 'mac.tar.gz')
const PRISTINE = join(ROW26, 'mac-pristine')
const REAL_WIN_ARCHIVE = join(ROW26, 'win.tar.gz')
const WIN_PRISTINE = join(ROW26, 'win')

let dir = ''
const live = () => new AbortController().signal

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-unpack-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function archive(specs: TarSpec[], name = 'python.tar.gz'): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, gzipSync(tarOf(specs)))
  return path
}

async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (err) {
    return err as Error
  }
  throw new Error('expected a failure, and it resolved')
}

describe('unpacking an archive with no folder entries, as the real ones are', () => {
  const SPECS: TarSpec[] = [
    { name: 'python/bin/python3.14', body: noise(3000, 1), mode: 0o775 },
    { kind: 'symlink', name: 'python/bin/python3', target: 'python3.14' },
    { name: 'python/lib/python3.14/site-packages/pip/_vendor/rich/console.py', body: noise(700, 2), mode: 0o664 },
    { name: 'python/lib/python3.14/os.py', body: noise(512, 3), mode: 0o664 },
    { name: 'python/lib/python3.14/empty.py', body: '', mode: 0o664 }
  ]

  /*
   * The members a real archive for `platform` holds. The Windows archive has no symlink (row 26), and
   * unpackTarGz refuses one there by design (the case below), so on win32 this archive is SPECS without its
   * link. Windows CI ran it with the link and got that refusal (run 38919769393). Run here for both, the
   * win32 case through the `platform` option, so the Mac sees the Windows shape too.
   */
  const membersFor = (platform: NodeJS.Platform): TarSpec[] => (platform === 'win32' ? SPECS.filter((s) => s.kind !== 'symlink') : SPECS)

  for (const platform of [...new Set<NodeJS.Platform>([process.platform, 'win32'])]) {
    it(`writes every member with its folders made, its bytes, and the result’s counts (${platform}’s archive)`, async () => {
      const into = join(dir, 'pack', '1')
      const result = await unpackTarGz(await archive(membersFor(platform)), into, { signal: live(), platform })

      expect(await readFile(join(into, 'python/lib/python3.14/site-packages/pip/_vendor/rich/console.py'))).toEqual(Buffer.from(noise(700, 2)))
      expect(await readFile(join(into, 'python/bin/python3.14'))).toEqual(Buffer.from(noise(3000, 1)))
      expect((await stat(join(into, 'python/lib/python3.14/empty.py'))).size).toBe(0)
      expect(result).toEqual({
        files: 4,
        bytes: 3000 + 700 + 512,
        longestPath: 'python/lib/python3.14/site-packages/pip/_vendor/rich/console.py'.length,
        longestDir: 'python/lib/python3.14/site-packages/pip/_vendor/rich'.length
      })
    })
  }

  it.skipIf(!POSIX)('restores the executable bit from the mode, and only that', async () => {
    const into = join(dir, 'v')
    await unpackTarGz(await archive(SPECS), into, { signal: live() })
    expect((await stat(join(into, 'python/bin/python3.14'))).mode & 0o777).toBe(0o755)
    expect((await stat(join(into, 'python/lib/python3.14/os.py'))).mode & 0o111).toBe(0)
  })

  it.skipIf(!POSIX)('makes the in-root symlink, pointing where the archive says', async () => {
    const into = join(dir, 'v')
    await unpackTarGz(await archive(SPECS), into, { signal: live() })
    expect((await lstat(join(into, 'python/bin/python3'))).isSymbolicLink()).toBe(true)
    expect(await readlink(join(into, 'python/bin/python3'))).toBe('python3.14')
    expect(await readFile(join(into, 'python/bin/python3'))).toEqual(Buffer.from(noise(3000, 1)))
  })

  it('refuses a symlink on Windows by name, rather than making something else', async () => {
    const err = await failure(unpackTarGz(await archive(SPECS), join(dir, 'v'), { signal: live(), platform: 'win32' }))
    expect(err.message).toContain('symbolic link (python/bin/python3 -> python3.14)')
  })

  it('honours a folder entry, should one appear', async () => {
    const into = join(dir, 'v')
    const result = await unpackTarGz(await archive([{ kind: 'directory', name: 'python/include/python3.14/internal' }]), into, { signal: live() })
    expect((await stat(join(into, 'python/include/python3.14/internal'))).isDirectory()).toBe(true)
    expect(result.longestDir).toBe('python/include/python3.14/internal'.length)
    expect(result.files).toBe(0)
  })

  it('never writes over a name already there: a duplicate member fails', async () => {
    const err = await failure(
      unpackTarGz(
        await archive([
          { name: 'python/os.py', body: 'one' },
          { name: 'python/os.py', body: 'two' }
        ]),
        join(dir, 'v'),
        { signal: live() }
      )
    )
    expect(err.message).toContain('EEXIST')
  })

  it('a damaged archive is a worded failure', async () => {
    const whole = gzipSync(tarOf(SPECS))
    const path = join(dir, 'cut.tar.gz')
    await writeFile(path, whole.subarray(0, whole.length - 40))
    const err = await failure(unpackTarGz(path, join(dir, 'v'), { signal: live() }))
    expect(err.message).toMatch(/^Python's archive could not be unpacked: /)
  })
})

describe('nothing lands outside the folder, on a case-insensitive disk too', () => {
  /** `<dir>/root/python/1`, with a sibling `other` beside it for an escape to land in. */
  async function layout(): Promise<{ into: string; parent: string; other: string }> {
    const parent = join(dir, 'root', 'python')
    const other = join(parent, 'other')
    await mkdir(other, { recursive: true })
    return { into: join(parent, '1'), parent, other }
  }

  it('a link one level shallower than its name, then a case variant of it, is refused and writes nothing outside', async () => {
    // On APFS `a/x` is `a/X` = `c`, so `a/x/y/L` sits at `c/y/L` and `../../../other` from there is
    // `<parent>/other`: the escape the verifier wrote a file through (P-B finding V1).
    const { into, parent, other } = await layout()
    const err = await failure(
      unpackTarGz(
        await archive([
          { name: 'c/keep.txt', body: 'x' },
          { kind: 'symlink', name: 'a/X', target: '../c' },
          { kind: 'symlink', name: 'a/x/y/L', target: '../../../other' },
          { name: 'a/x/y/l/evil.txt', body: 'evil' }
        ]),
        into,
        { signal: live() }
      )
    )
    expect(err.message).toMatch(/^Python's archive could not be unpacked: /)
    expect((await readdir(parent)).sort()).toEqual(['1', 'other'])
    expect(await readdir(other)).toEqual([])
  })

  it('a link to the root, then a case variant of it, is refused and writes nothing outside', async () => {
    const { into, parent } = await layout()
    const err = await failure(
      unpackTarGz(
        await archive([
          { kind: 'symlink', name: 'X', target: '.' },
          { kind: 'symlink', name: 'x/y/L', target: '../..' },
          { name: 'x/y/l/evil.txt', body: 'evil' }
        ]),
        into,
        { signal: live() }
      )
    )
    expect(err.message).toMatch(/^Python's archive could not be unpacked: /)
    expect((await readdir(parent)).sort()).toEqual(['1', 'other'])
  })

  it.skipIf(!POSIX)('a link already in the folder before the unpack is not written through: the disk is asked, not the names', async () => {
    const { into, other } = await layout()
    await mkdir(into, { recursive: true })
    await symlink(other, join(into, 'python'))
    const err = await failure(unpackTarGz(await archive([{ name: 'python/os.py', body: 'x' }]), into, { signal: live() }))
    expect(err.message).toContain('Refusing python: on disk it resolves to')
    expect(await readdir(other)).toEqual([])
  })
})

describe('the path budget, before the first write', () => {
  it('a root too deep for Windows is refused, naming it, and nothing is written', async () => {
    const into = join(dir, 'deep', 'python', '1')
    const err = await failure(
      unpackTarGz(await archive([{ name: 'python/os.py', body: 'x' }]), into, {
        signal: live(),
        platform: 'win32',
        budget: { longestPath: 259 - into.length, longestDir: 10 }
      })
    )
    expect(err.message).toContain(`The AI helper does not fit under ${into}`)
    expect(existsSync(join(dir, 'deep'))).toBe(false)
  })

  it('a root that fits is unpacked', async () => {
    const into = join(dir, 'v')
    const result = await unpackTarGz(await archive([{ name: 'python/os.py', body: 'x' }]), into, {
      signal: live(),
      platform: process.platform,
      budget: { longestPath: 20, longestDir: 10 }
    })
    expect(result.files).toBe(1)
  })
})

describe('a cancel between members', () => {
  it('stops the unpack part-way, as a cancel, leaving a partial tree for the job to delete', async () => {
    const specs: TarSpec[] = Array.from({ length: 600 }, (_, i) => ({ name: `python/lib/m${i}.py`, body: noise(600, i) }))
    const path = await archive(specs)
    const job = new AbortController()
    const err = await failure(
      unpackTarGz(path, join(dir, 'v'), {
        signal: job.signal,
        // Said every 250 files: the first is the cancel.
        onMessage: () => job.abort()
      })
    )
    expect(err.name).toBe('CancelledError')
    const written = await readdir(join(dir, 'v', 'python', 'lib'))
    expect(written.length).toBeGreaterThanOrEqual(250)
    expect(written.length).toBeLessThan(600)
  })
})

describe('compiling the standard library', () => {
  const env = { FORGE_TEST_COMPILE: '1', PATH: process.env.PATH }
  /** A spawn that records what it was asked and runs node with `script` instead. */
  function standIn(script: string): { spawn: typeof spawn; calls: { cmd: string; args: readonly string[]; opts: Record<string, unknown> }[]; child: () => ChildProcess } {
    const calls: { cmd: string; args: readonly string[]; opts: Record<string, unknown> }[] = []
    let last: ChildProcess | null = null
    const fake = ((cmd: string, args: readonly string[], opts: Record<string, unknown>) => {
      calls.push({ cmd, args, opts })
      last = spawn(process.execPath, ['-e', script], opts)
      return last
    }) as unknown as typeof spawn
    return { spawn: fake, calls, child: () => last! }
  }

  it('runs `<python> -I -m compileall -q -j 1 <stdlib>`, hidden, with the pack’s environment', async () => {
    const s = standIn('process.exit(0)')
    await compileStdlib({ python: '/pack/python/bin/python3.14', stdlib: '/pack/python/lib/python3.14', env, spawn: s.spawn, signal: live() })
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0].cmd).toBe('/pack/python/bin/python3.14')
    expect(s.calls[0].args).toEqual(['-I', '-m', 'compileall', '-q', '-j', '1', '/pack/python/lib/python3.14'])
    expect(s.calls[0].args).toEqual(compileArgs('/pack/python/lib/python3.14'))
    expect(s.calls[0].opts.windowsHide).toBe(true)
    expect(s.calls[0].opts.env).toBe(env)
  })

  it('a non-zero exit names the last line it printed on stderr', async () => {
    const s = standIn(
      "console.error('Listing stdlib...'); console.error('SyntaxError: invalid syntax (bad.py, line 1)'); console.log('noise'); process.exit(1)"
    )
    const err = await failure(compileStdlib({ python: 'python3.14', stdlib: 'lib', env, spawn: s.spawn, signal: live() }))
    expect(err.message).toBe("Compiling Python's standard library failed: compileall exited with 1: SyntaxError: invalid syntax (bad.py, line 1)")
  })

  it('with nothing on stderr, the last line on stdout, where -q puts a failed file', async () => {
    const s = standIn("console.log(\"*** Error compiling '/x/bad.py'...\"); console.log('  SyntaxError: bad'); process.exit(1)")
    const err = await failure(compileStdlib({ python: 'python3.14', stdlib: 'lib', env, spawn: s.spawn, signal: live() }))
    expect(err.message).toContain('compileall exited with 1: SyntaxError: bad')
  })

  it('the signal kills the child and rejects as a cancel', async () => {
    // Ends itself after 30 s, so a run with the kill broken leaves nothing behind.
    const s = standIn('setTimeout(() => process.exit(0), 30_000)')
    const job = new AbortController()
    const running = compileStdlib({ python: 'python3.14', stdlib: 'lib', env, spawn: s.spawn, signal: job.signal })
    setTimeout(() => job.abort(), 100)
    const outcome = await Promise.race([
      running.then(
        () => 'resolved',
        (err: Error) => err.name
      ),
      new Promise((resolve) => setTimeout(() => resolve('still running after 5 s'), 5_000))
    ])
    expect(outcome).toBe('CancelledError')
    expect(s.child().exitCode !== null || s.child().signalCode !== null).toBe(true)
  })

  it('names the standard library where each archive keeps it', () => {
    expect(stdlibOf(join('v', '1'), 'darwin-arm64', '3.14.8')).toBe(join('v', '1', 'python', 'lib', 'python3.14'))
    expect(stdlibOf(join('v', '1'), 'win32-x64', '3.14.8')).toBe(join('v', '1', 'python', 'Lib'))
  })
})

/** Every path under `root`, relative and '/'-joined, with what a comparison needs of it. */
async function census(root: string): Promise<Map<string, { type: 'file' | 'link' | 'dir'; size: number; exec: number; target?: string }>> {
  const out = new Map<string, { type: 'file' | 'link' | 'dir'; size: number; exec: number; target?: string }>()
  const walk = async (folder: string): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      const rel = relative(root, path).split('\\').join('/')
      const st = await lstat(path)
      if (st.isSymbolicLink()) out.set(rel, { type: 'link', size: 0, exec: 0, target: await readlink(path) })
      else if (st.isDirectory()) {
        out.set(rel, { type: 'dir', size: 0, exec: 0 })
        await walk(path)
      } else out.set(rel, { type: 'file', size: st.size, exec: st.mode & 0o111 })
    }
  }
  await walk(root)
  return out
}

describe.skipIf(!existsSync(REAL_ARCHIVE) || !existsSync(PRISTINE) || process.platform !== 'darwin' || process.arch !== 'arm64')(
  `the real Mac archive (row 26's download at ${ROW26}; skipped when it is not on this machine)`,
  () => {
    let into = ''
    afterAll(async () => {
      if (into) await rm(into, { recursive: true, force: true })
    })

    it('unpacks to what tar -xzf made of it, runs, and compiles its standard library', async () => {
      into = await mkdtemp(join(tmpdir(), 'forge-real-unpack-'))
      const started = performance.now()
      const result = await unpackTarGz(REAL_ARCHIVE, into, { signal: live(), budget: { longestPath: 161, longestDir: 107 } })
      const unpackMs = performance.now() - started

      // EFFECTS §57's census of the archive.
      expect(result).toEqual({ files: 1689, bytes: 68_060_050, longestPath: 106, longestDir: 97 })

      const mine = await census(into)
      const theirs = await census(PRISTINE)
      expect([...mine.keys()].sort()).toEqual([...theirs.keys()].sort())
      for (const [rel, theirsOf] of theirs) {
        const mineOf = mine.get(rel)!
        expect({ rel, type: mineOf.type, size: mineOf.size, target: mineOf.target }).toEqual({
          rel,
          type: theirsOf.type,
          size: theirsOf.size,
          target: theirsOf.target
        })
        if (theirsOf.type === 'file') expect({ rel, exec: mineOf.exec !== 0 }).toEqual({ rel, exec: theirsOf.exec !== 0 })
      }
      const links = [...mine.values()].filter((e) => e.type === 'link')
      const executables = [...mine.values()].filter((e) => e.type === 'file' && e.exec !== 0)
      const folders = [...mine.values()].filter((e) => e.type === 'dir')
      expect(links).toHaveLength(9)
      expect(executables).toHaveLength(19)
      expect(mine.get('python/bin/python3')?.target).toBe('python3.14')

      // The tree runs when this code wrote it.
      const python = join(into, 'python', 'bin', 'python3.14')
      const ran = await promisify(execFile)(python, ['-I', '-c', 'import sys, ssl; print(sys.version)'], { windowsHide: true, timeout: 60_000 })
      expect(ran.stdout).toMatch(/^3\.14\.8 /)

      // And its standard library compiles, once, with the measured command.
      const stdlib = stdlibOf(into, 'darwin-arm64', '3.14.8')
      const compileStarted = performance.now()
      await compileStdlib({ python, stdlib, env: process.env, spawn, signal: live() })
      const compileMs = performance.now() - compileStarted
      const after = await census(into)
      const pyc = [...after.entries()].filter(([rel, e]) => e.type === 'file' && rel.endsWith('.pyc'))
      const pycBytes = pyc.reduce((n, [, e]) => n + e.size, 0)

      console.log(
        `real Mac archive: ${result.files} files, ${result.bytes} B, ${links.length} links, ${folders.length} folders, ` +
          `longestPath ${result.longestPath}, longestDir ${result.longestDir}, unpacked in ${Math.round(unpackMs)} ms; ` +
          `python: ${ran.stdout.trim()}; compileall: ${pyc.length} .pyc, ${pycBytes} B, in ${Math.round(compileMs)} ms`
      )
      expect(pyc.length).toBe(1059)
    })
  }
)

describe.skipIf(!existsSync(REAL_WIN_ARCHIVE) || !existsSync(WIN_PRISTINE))(
  `the real Windows archive, unpacked here as data and never run (row 26's download at ${ROW26}; skipped when it is not on this machine)`,
  () => {
    let into = ''
    afterAll(async () => {
      if (into) await rm(into, { recursive: true, force: true })
    })

    it('unpacks, as on Windows, to what tar -xzf made of it', async () => {
      into = await mkdtemp(join(tmpdir(), 'forge-real-win-unpack-'))
      const started = performance.now()
      // As the Surface would: no executable bits to restore, a symlink refused, the budget checked.
      const result = await unpackTarGz(REAL_WIN_ARCHIVE, into, { signal: live(), platform: 'win32', budget: { longestPath: 150, longestDir: 96 } })
      const unpackMs = performance.now() - started

      expect(result).toEqual({ files: 2190, bytes: 61_643_159, longestPath: 105, longestDir: 86 })
      const mine = await census(into)
      const theirs = await census(WIN_PRISTINE)
      expect([...mine.keys()].sort()).toEqual([...theirs.keys()].sort())
      for (const [rel, theirsOf] of theirs) {
        const mineOf = mine.get(rel)!
        expect({ rel, type: mineOf.type, size: mineOf.size }).toEqual({ rel, type: theirsOf.type, size: theirsOf.size })
      }
      console.log(`real Windows archive: ${result.files} files, ${result.bytes} B, longestPath ${result.longestPath}, longestDir ${result.longestDir}, unpacked in ${Math.round(unpackMs)} ms`)
    })
  }
)
