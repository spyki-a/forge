import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { HelloResult } from '@shared/sidecar/protocol'
import type { HelperLaunch } from '@shared/sidecar/helperPython'

/*
 * One helper process (docs/CLIPS.md §3a.2, §3a.7): the client against a REAL
 * child, tests/fixtures/fake-helper.mjs, a Node script that speaks the
 * helper's protocol — so spawns are counted by the processes that ran (each
 * appends its pid to a file), and "dead" is asked of the OS.
 *
 * Every spawn is recorded and passed through, except `taskkill` on a machine
 * that has none: there the stand-in does what `/f` does to the one pid, so a
 * stop can finish, and the argv is the assertion. On Windows the real
 * taskkill runs, and its `/t` is held by a grandchild that only a tree kill
 * ends.
 */

const spawned = vi.hoisted(
  () => [] as { command: string; args: string[]; options: Record<string, unknown>; exited?: boolean }[]
)
/**
 * The stand-in taskkill: `lagMs` is how long it takes to exit after it has
 * killed the pid (its tree's end, in miniature); `missing` makes it a
 * taskkill that cannot start, which kills nothing and emits 'error'.
 */
const taskkill = vi.hoisted(() => ({ lagMs: 0, missing: false }))
/**
 * A spawn the OS refuses, as Node reports one: the child's 'error' (code,
 * errno, `syscall: 'spawn <file>'`), then 'close', no pid. Keyed by command.
 */
const refusedSpawns = vi.hoisted(() => new Map<string, { code: string; errno: number }>())
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>()
  const { EventEmitter } = await import('node:events')
  const { PassThrough } = await import('node:stream')
  return {
    ...real,
    spawn: (command: string, args: string[], options: Record<string, unknown>) => {
      const record: (typeof spawned)[number] = { command, args: [...args], options, exited: false }
      spawned.push(record)
      const refusal = refusedSpawns.get(command)
      if (refusal) {
        const child = Object.assign(new EventEmitter(), {
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          stdin: new PassThrough(),
          pid: undefined,
          killed: false,
          kill: () => true
        })
        setTimeout(() => {
          const err = Object.assign(new Error(`spawn ${command} ${refusal.code}`), { ...refusal, syscall: `spawn ${command}`, path: command, spawnargs: args })
          child.emit('error', err)
          child.emit('close', refusal.errno, null)
        }, 0)
        return child
      }
      if (command === 'taskkill') {
        let killer: InstanceType<typeof EventEmitter>
        if (taskkill.missing) {
          killer = new EventEmitter()
          setTimeout(() => killer.emit('error', Object.assign(new Error('spawn taskkill ENOENT'), { code: 'ENOENT' })), 0)
        } else if (process.platform !== 'win32') {
          const pid = Number(args[args.indexOf('/pid') + 1])
          try {
            process.kill(pid, 'SIGKILL')
          } catch {
            // already gone
          }
          killer = new EventEmitter()
          setTimeout(() => killer.emit('exit', 0, null), taskkill.lagMs)
        } else {
          killer = real.spawn(command, args, options)
        }
        // First listener: set before the client's own 'exit' listener runs.
        killer.once('exit', () => (record.exited = true))
        return killer
      }
      return real.spawn(command, args, options)
    }
  }
})

const { SidecarClient, SidecarError, STOP_GRACE_MS, helloTimeoutFor, HELLO_TIMEOUT_MS, PACK_HELLO_TIMEOUT_MS, startFailure } = await import(
  '../src/main/sidecar/client'
)
const { HELPER_BLOCKED_BY_POLICY } = await import('../src/shared/sidecar/status')
type Client = InstanceType<typeof SidecarClient>
type FakeHello = HelloResult & { pid: number; grandchild?: number }

const FAKE = resolve(__dirname, 'fixtures', 'fake-helper.mjs')
const clients: Client[] = []
const dirs: string[] = []
const strays: number[] = []

function launchOf(env: Record<string, string>, command = process.execPath): HelperLaunch {
  const base = { ...process.env }
  delete base.NODE_OPTIONS
  return { command, args: [FAKE], env: { ...base, ...env }, source: { kind: 'env', python: command } }
}

function fake(o: { env?: Record<string, string>; maxRestarts?: number; helloTimeoutMs?: number; platform?: NodeJS.Platform; command?: string } = {}): {
  client: Client
  launch: HelperLaunch
  cwd: string
  pids: () => number[]
} {
  const cwd = mkdtempSync(join(tmpdir(), 'forge-client-'))
  dirs.push(cwd)
  const file = join(cwd, 'pids.txt')
  const launch = launchOf({ FAKE_PIDS: file, ...(o.env ?? {}) }, o.command)
  const client = new SidecarClient({
    cwd,
    launch,
    maxRestarts: o.maxRestarts ?? 0,
    ...(o.helloTimeoutMs !== undefined ? { helloTimeoutMs: o.helloTimeoutMs } : {}),
    ...(o.platform ? { platform: o.platform } : {})
  })
  clients.push(client)
  const pids = (): number[] =>
    existsSync(file)
      ? readFileSync(file, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(Number)
      : []
  return { client, launch, cwd, pids }
}

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
    await new Promise((r) => setTimeout(r, 25))
  }
  return test()
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const helperSpawns = (): number => spawned.filter((s) => s.args[0] === FAKE).length

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.stop()))
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // gone
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  spawned.length = 0
  taskkill.lagMs = 0
  taskkill.missing = false
  refusedSpawns.clear()
})

describe('one helper process', () => {
  it('two start() calls before the hello spawn one helper, and both get its hello', async () => {
    const { client, pids } = fake({ env: { FAKE_HELLO_MS: '600' } })
    const first = client.start()
    await sleep(150)
    const second = client.start()
    const [a, b] = await Promise.all([first, second])
    expect(pids(), 'processes that ran').toHaveLength(1)
    expect(helperSpawns()).toBe(1)
    expect((a as FakeHello).pid).toBe(pids()[0])
    expect(b).toBe(a)
  })

  it('a request before the start, or during its hello, joins it rather than spawning a second', async () => {
    const { client, pids } = fake({ env: { FAKE_HELLO_MS: '400' } })
    // The request first: it starts the helper. Then a start while that hello is out.
    const asked = client.request<{ pong: string }>('system.ping', { echo: 'Bräutigam 5:30pm ಕನ್ನಡ' })
    const started = client.start()
    expect((await asked).pong).toBe('Bräutigam 5:30pm ಕನ್ನಡ')
    await started
    // And the other way round: a start, then a request while its hello is out.
    const other = fake({ env: { FAKE_HELLO_MS: '400' } })
    const begun = other.client.start()
    const late = other.client.request<{ pong: number }>('system.ping', { echo: 2 })
    expect((await late).pong).toBe(2)
    await begun
    expect(pids(), 'the first client').toHaveLength(1)
    expect(other.pids(), 'the second client').toHaveLength(1)
    expect(helperSpawns()).toBe(2)
  })

  it('a hello that times out kills its child before it rejects', async () => {
    const { client, pids } = fake({ env: { FAKE_HELLO: 'never' }, helloTimeoutMs: 300 })
    const exits: unknown[] = []
    client.on('exit', (e) => exits.push(e))
    await expect(client.start()).rejects.toThrow("The AI helper did not answer within 1 s")
    expect(pids()).toHaveLength(1)
    expect(alive(pids()[0]), `helper ${pids()[0]} after the timeout`).toBe(false)
    expect(exits).toHaveLength(1)
  })

  it('stop() resolves once the helper has exited, and leaves no pid alive (its tree too, on Windows)', async () => {
    // A helper that ignores stdin's end, so the kill after the grace is what ends it.
    const { client } = fake({ env: { FAKE_IGNORE_STDIN_END: '1', FAKE_GRANDCHILD: '1' } })
    const hello = (await client.start()) as FakeHello
    expect(hello.grandchild).toBeGreaterThan(0)
    strays.push(hello.grandchild!)
    const began = performance.now()
    await client.stop()
    const took = performance.now() - began
    expect(alive(hello.pid), `helper ${hello.pid} when stop() resolved`).toBe(false)
    expect(took, 'it ignored stdin, so the kill after the grace ended it').toBeGreaterThanOrEqual(STOP_GRACE_MS - 50)
    // taskkill /t takes the grandchild with it; elsewhere the helper's own cancel stops its worker (§15 row 1).
    if (process.platform === 'win32') expect(await until(() => !alive(hello.grandchild!), 3000), `grandchild ${hello.grandchild}`).toBe(true)
    // And with no child at all it resolves at once.
    await expect(client.stop()).resolves.toBeUndefined()
    await expect(fake().client.stop()).resolves.toBeUndefined()
  })

  it('on Windows the kill is a tree kill: taskkill /pid <pid> /f /t, hidden, and it is waited for', async () => {
    // The stand-in kills the pid at once and exits 300 ms later, as a taskkill
    // whose /t is still ending the tree after python.exe is gone.
    taskkill.lagMs = 300
    const { client } = fake({ env: { FAKE_IGNORE_STDIN_END: '1' }, platform: 'win32' })
    const hello = (await client.start()) as FakeHello
    await client.stop()
    const kills = spawned.filter((s) => s.command === 'taskkill')
    expect(kills).toHaveLength(1)
    expect(kills[0].args).toEqual(['/pid', String(hello.pid), '/f', '/t'])
    expect(kills[0].options).toMatchObject({ windowsHide: true })
    expect(kills[0].exited, 'taskkill had exited when stop() resolved').toBe(true)
    expect(alive(hello.pid)).toBe(false)

    // A timed-out hello is killed the same way, and its rejection waits for the kill too.
    const slow = fake({ env: { FAKE_HELLO: 'never' }, helloTimeoutMs: 300, platform: 'win32' })
    await expect(slow.client.start()).rejects.toThrow(/did not answer/)
    const second = spawned.filter((s) => s.command === 'taskkill')
    expect(second).toHaveLength(2)
    expect(second[1].args).toEqual(['/pid', String(slow.pids()[0]), '/f', '/t'])
    expect(second[1].exited, 'taskkill had exited when the start rejected').toBe(true)
  })

  it('a taskkill that cannot start falls back to killing the helper, and the stop still finishes', async () => {
    taskkill.missing = true
    const { client } = fake({ env: { FAKE_IGNORE_STDIN_END: '1' }, platform: 'win32' })
    const hello = (await client.start()) as FakeHello
    const began = performance.now()
    await client.stop()
    expect(spawned.filter((s) => s.command === 'taskkill')).toHaveLength(1)
    expect(alive(hello.pid), `helper ${hello.pid} when stop() resolved`).toBe(false)
    expect(performance.now() - began, 'not held until the tree kill’s ceiling').toBeLessThan(STOP_GRACE_MS + 1500)
  })

  it('a restart that comes back is told: exit with its code and source, then ready again', async () => {
    const { client, pids, launch } = fake({ maxRestarts: 1 })
    const readies: HelloResult[] = []
    const exits: { code: number | null; signal: string | null; source: unknown }[] = []
    client.on('ready', (hello: HelloResult) => readies.push(hello))
    client.on('exit', (exit: { code: number | null; signal: string | null; source: unknown }) => exits.push(exit))
    await client.start()
    const crashed = client.request('fake.crash').catch((err: unknown) => err)
    expect(await crashed).toBeInstanceOf(SidecarError)
    expect(await until(() => readies.length === 2, 5000), 'the restart’s ready').toBe(true)
    expect(exits).toHaveLength(1)
    expect(exits[0]).toMatchObject({ code: 3, signal: null })
    expect(exits[0].source).toEqual(launch.source)
    expect(pids()).toHaveLength(2)
    expect((readies[1] as FakeHello).pid).toBe(pids()[1])
  })

  it('a stopped client never spawns again', async () => {
    const { client, pids } = fake()
    await client.start()
    await client.stop()
    await expect(client.request('system.ping', { echo: 1 })).rejects.toThrow(/shutting down/)
    await expect(client.start()).rejects.toThrow(/shutting down/)
    expect(pids()).toHaveLength(1)
  })

  it('an interpreter that is not there rejects with why, restarts nothing, and stops at once', async () => {
    const missing = join(tmpdir(), 'no-such-python-for-forge')
    const { client } = fake({ command: missing, maxRestarts: 2 })
    const exits: unknown[] = []
    client.on('exit', (e) => exits.push(e))
    await expect(client.start()).rejects.toThrow(/Could not start the AI helper/)
    await sleep(600)
    expect(spawned.filter((s) => s.command === missing)).toHaveLength(1)
    expect(exits).toHaveLength(1)
    await expect(client.stop()).resolves.toBeUndefined()
  })

  it('idle() waits for the work in flight, and for a request still waiting on the hello', async () => {
    // Hello at ~200 ms; the request waiting on it is sent then, and answers ~500 ms later.
    const { client } = fake({ env: { FAKE_HELLO_MS: '200' } })
    let idle = false
    const waiting = client.request<{ waited: number }>('fake.wait', { ms: 500 })
    void client.idle().then(() => (idle = true))
    await sleep(100)
    expect(idle, 'a request waiting for the hello').toBe(false)
    await sleep(350)
    expect(client.info, 'the hello has answered by now').not.toBeNull()
    expect(idle, 'the hello answered, and the request it held is in flight').toBe(false)
    await waiting
    await sleep(0)
    expect(idle).toBe(true)

    const work = client.request<{ waited: number }>('fake.wait', { ms: 300 })
    let done = false
    void client.idle().then(() => (done = true))
    await sleep(100)
    expect(done, 'a request in flight').toBe(false)
    await work
    await sleep(0)
    expect(done).toBe(true)
  })

  it('is started exactly as its launch says: command, flags, environment and folder', async () => {
    const { client, launch, cwd } = fake()
    await client.start()
    const [only] = spawned.filter((s) => s.args[0] === FAKE)
    expect(only.command).toBe(launch.command)
    expect(only.args).toEqual(launch.args)
    expect(only.options.env).toBe(launch.env)
    expect(only.options).toMatchObject({ cwd, windowsHide: true })
  })
})

describe('a start the machine refuses (§3a.4 "Group Policy")', () => {
  const PACK_PYTHON = 'C:\\Users\\Ana\\AppData\\Roaming\\Forge\\python\\1\\python\\python.exe'
  const pack = { kind: 'pack', pack: 1, root: 'C:\\Users\\Ana\\AppData\\Roaming\\Forge\\python\\1' } as const

  function refusedStart(o: { code: string; errno: number; platform: NodeJS.Platform; source?: HelperLaunch['source'] }): Promise<unknown> {
    const command = `${PACK_PYTHON}-${o.code}-${o.platform}-${o.source?.kind ?? 'pack'}`
    refusedSpawns.set(command, { code: o.code, errno: o.errno })
    const client = new SidecarClient({
      cwd: tmpdir(),
      launch: { command, args: ['-E', '-s', '-u', '-B', '-m', 'forge_sidecar'], env: {}, source: o.source ?? pack },
      maxRestarts: 2,
      platform: o.platform
    })
    clients.push(client)
    return client.start().then(
      () => 'started',
      (err: Error) => err.message
    )
  }

  // libuv 1.52.1 (Electron 44.3.0's): ERROR_ACCESS_DISABLED_BY_POLICY (1260) has no mapping and reaches Node
  // as UNKNOWN; ERROR_ACCESS_DENIED as EPERM; ERROR_ELEVATION_REQUIRED as EACCES. Windows' errnos for those.
  for (const [code, errno] of [
    ['UNKNOWN', -4094],
    ['EPERM', -4048],
    ['EACCES', -4092]
  ] as const) {
    it(`a pack Windows refuses (${code}) reads as the policy sentence, not the spawn's code, and restarts nothing`, async () => {
      expect(await refusedStart({ code, errno, platform: 'win32' })).toBe(HELPER_BLOCKED_BY_POLICY)
      await sleep(500)
      expect(spawned.filter((s) => s.command.startsWith(PACK_PYTHON))).toHaveLength(1)
    })
  }

  it('on the Mac the plain sentence stays, with the reason', async () => {
    expect(await refusedStart({ code: 'EACCES', errno: -13, platform: 'darwin' })).toBe(`Could not start the AI helper: spawn ${PACK_PYTHON}-EACCES-darwin-pack EACCES`)
  })

  it('FORGE_PYTHON refused, or a pack that is not there, keeps the plain sentence', async () => {
    expect(await refusedStart({ code: 'EPERM', errno: -4048, platform: 'win32', source: { kind: 'env', python: 'C:\\Python312\\python.exe' } })).toMatch(/^Could not start the AI helper: spawn .* EPERM$/)
    expect(await refusedStart({ code: 'ENOENT', errno: -4058, platform: 'win32' })).toMatch(/^Could not start the AI helper: spawn .* ENOENT$/)
  })

  it('startFailure words only a refused spawn of the pack on Windows', () => {
    const err = (code: string, syscall = 'spawn C:\\p\\python.exe'): NodeJS.ErrnoException =>
      Object.assign(new Error(`${syscall} ${code}`), { code, syscall })
    expect(startFailure(err('EPERM'), pack, 'win32')).toBe(HELPER_BLOCKED_BY_POLICY)
    expect(startFailure(Object.assign(new Error('spawn x'), { syscall: 'spawn x', errno: 1260 }), pack, 'win32')).toBe(HELPER_BLOCKED_BY_POLICY)
    expect(startFailure(err('EPERM', 'kill'), pack, 'win32'), 'a kill that failed is not a start').toBe('Could not start the AI helper: kill EPERM')
    expect(startFailure(err('EPERM'), pack, 'darwin')).toBe('Could not start the AI helper: spawn C:\\p\\python.exe EPERM')
    expect(startFailure(err('ENOENT'), pack, 'win32')).toBe('Could not start the AI helper: spawn C:\\p\\python.exe ENOENT')
    expect(HELPER_BLOCKED_BY_POLICY).not.toMatch(/sidecar|keeps crashing/i)
  })
})

describe('a start the service refuses (mayStart, §16.53 (a))', () => {
  it('rejects with the sentence, spawns nothing and says so; once allowed, starts', async () => {
    let refusal: string | null = 'The AI helper is being repaired by another Forge window'
    const cwd = mkdtempSync(join(tmpdir(), 'forge-client-'))
    dirs.push(cwd)
    const client = new SidecarClient({ cwd, launch: launchOf({ FAKE_PIDS: join(cwd, 'pids.txt') }), maxRestarts: 0, mayStart: () => refusal })
    clients.push(client)
    const told: string[] = []
    client.on('refused', (why: string) => told.push(why))
    const refused = await client.start().catch((err: unknown) => err)
    expect(refused).toBeInstanceOf(SidecarError)
    expect((refused as Error).message).toBe(refusal)
    await expect(client.request('system.ping', { echo: 1 })).rejects.toThrow(refusal)
    expect(told).toEqual([refusal, refusal])
    expect(helperSpawns(), 'nothing spawned while refused').toBe(0)
    refusal = null
    await client.start()
    expect(await client.request<{ pong: number }>('system.ping', { echo: 2 })).toEqual({ pong: 2 })
    expect(helperSpawns()).toBe(1)
  })
})

describe('the hello’s ceiling', () => {
  it('is the pack’s own on the pack rung and 30 s on every dev rung', () => {
    expect(HELLO_TIMEOUT_MS).toBe(30_000)
    expect(PACK_HELLO_TIMEOUT_MS).toBeGreaterThan(HELLO_TIMEOUT_MS)
    expect(helloTimeoutFor({ kind: 'pack', pack: 1, root: '/p/1' })).toBe(PACK_HELLO_TIMEOUT_MS)
    for (const source of [
      { kind: 'env', python: '/x' },
      { kind: 'venv', python: '/v' },
      { kind: 'path', python: 'python3' }
    ] as const) {
      expect(helloTimeoutFor(source), source.kind).toBe(HELLO_TIMEOUT_MS)
    }
  })
})
