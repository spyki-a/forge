import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import { PACK_FLAGS, cleanHelperEnv } from '../../src/shared/sidecar/helperPython'
import { SidecarClient, SidecarError } from '../../src/main/sidecar/client'
import { OPTIONAL_METHODS, SIDECAR_METHODS, RPC_ERRORS, type HelloResult } from '@shared/sidecar/protocol'
import { SELFTEST_GROUPS, SELFTEST_GROUP_NAMES, type SelftestResult } from '@shared/sidecar/selftest'
import { HAS_VENV, PACK_UNDER_TEST, SIDECAR_DIR, VENV_PYTHON, devHelperLaunch, launchFor } from './venv'

let client: SidecarClient | null = null

/*
 * The helper as `npm run dev` starts it: the development order
 * (FORGE_PYTHON, then sidecar/.venv, then python on win32 and python3
 * elsewhere) and that rung's launch (src/shared/sidecar/helperPython.ts). On
 * CI that is the bare interpreter setup-python puts on PATH.
 */
function makeClient(options: Partial<{ maxRestarts: number }> = {}): SidecarClient {
  client = new SidecarClient({ cwd: SIDECAR_DIR, launch: devHelperLaunch(), maxRestarts: options.maxRestarts ?? 0 })
  return client
}

afterEach(async () => {
  await client?.stop()
  client = null
})

describe('sidecar handshake', () => {
  it('starts and reports its capabilities', async () => {
    const hello = await makeClient().start()
    expect(hello.protocolVersion).toBe(1)
    expect(hello.python).toMatch(/^3\./)
    expect(hello.capabilities).toContain(SIDECAR_METHODS.hello)
    expect(hello.capabilities).toContain(SIDECAR_METHODS.ping)
  }, 60_000)

  it('says which interpreter answered: its executable, prefix and path', async () => {
    const hello = await makeClient().start()
    expect(typeof hello.executable).toBe('string')
    expect(isAbsolute(hello.executable), hello.executable).toBe(true)
    expect(typeof hello.prefix).toBe('string')
    expect(hello.prefix.length).toBeGreaterThan(0)
    expect(Array.isArray(hello.path)).toBe(true)
    expect(hello.path.length).toBeGreaterThan(0)
    for (const entry of hello.path) expect(typeof entry, JSON.stringify(entry)).toBe('string')
  }, 60_000)

  it('starts through the rung asked for: under FORGE_HELPER_PACK, the pack rung’s own launch (CLIPS §3a.6)', async () => {
    // Read from the environment here, not from venv.ts: a venv.ts that ignored the variable would start the venv or a bare Python, green.
    const asked = process.env.FORGE_HELPER_PACK
    const launch = devHelperLaunch()
    if (!asked) {
      expect(launch.source.kind).not.toBe('pack')
      expect(launch.args).toEqual(['-m', 'forge_sidecar'])
      return
    }
    expect(launch.source).toMatchObject({ kind: 'pack' })
    expect(launch.args).toEqual([...PACK_FLAGS, '-m', 'forge_sidecar'])
    expect(launch.command).toBe(PACK_UNDER_TEST?.python)
    // The capability suites' own launch (vision, beats, faces, reframeJob, salient, asr) is the same one.
    const suites = launchFor(VENV_PYTHON)
    expect([suites.command, suites.args, suites.source]).toEqual([launch.command, launch.args, launch.source])
    // And the interpreter that answers is the pack's own, inside its version folder.
    const hello = await makeClient().start()
    const rel = relative(realpathSync.native(PACK_UNDER_TEST!.versionDir), realpathSync.native(hello.executable))
    expect(rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)), `${hello.executable} outside ${PACK_UNDER_TEST!.versionDir}`).toBe(true)
  }, 120_000)

  it('round-trips a ping', async () => {
    const c = makeClient()
    await c.start()
    const result = await c.request<{ pong: string }>(SIDECAR_METHODS.ping, { echo: 'forge' })
    expect(result.pong).toBe('forge')
  }, 60_000)

  it('reports a missing capability as degraded rather than crashing', async () => {
    const hello: HelloResult = await makeClient().start()
    // asr.transcribe is not installed in this environment; the sidecar must
    // still start and explain why the capability is absent.
    if (!hello.capabilities.includes(SIDECAR_METHODS.transcribe)) {
      expect(Object.keys(hello.degraded)).toContain(SIDECAR_METHODS.transcribe)
      expect(hello.degraded[SIDECAR_METHODS.transcribe]).toBeTruthy()
    }
  }, 60_000)

  it('answers for every optional method — a capability or degraded, never absent', async () => {
    /*
     * On CI's bare interpreter every one of these is degraded; in a full venv
     * most are capabilities. Either is an answer. Absent is not: the app
     * then gets "unknown method", which reads as a bug rather than as a
     * missing install (docs/CLIPS.md §3.6).
     */
    const hello = await makeClient().start()
    for (const method of OPTIONAL_METHODS) {
      const answered = hello.capabilities.includes(method) || Object.keys(hello.degraded).includes(method)
      expect(answered, `${method} is neither a capability nor degraded`).toBe(true)
    }
    /*
     * And the other way: every method the helper answers for, beyond its own
     * system.*, is on the list. A method added to a module's OPTIONAL tuple
     * but not to OPTIONAL_METHODS would otherwise go unguarded; the tuple
     * against the module's own `server.register` calls is
     * tests/sidecar/test_media.py, which runs on a bare interpreter.
     */
    const answers = [...hello.capabilities, ...Object.keys(hello.degraded)].filter((m) => !m.startsWith('system.'))
    for (const method of answers) expect(OPTIONAL_METHODS, `${method} is answered for but not in OPTIONAL_METHODS`).toContain(method)
  }, 60_000)

  it('degrades every method of a module that cannot load, not only the first', async () => {
    const c = makeClient()
    const hello = await c.start()
    // Where kokoro IS installed both are capabilities, and there is nothing to degrade.
    if (hello.capabilities.includes(SIDECAR_METHODS.voiceSpeak)) {
      expect(hello.capabilities).toContain(SIDECAR_METHODS.voiceVoices)
      return
    }
    for (const method of [SIDECAR_METHODS.voiceSpeak, SIDECAR_METHODS.voiceVoices]) {
      expect(Object.keys(hello.degraded), method).toContain(method)
      expect(hello.degraded[method], method).toMatch(/^voice unavailable: /)
    }
    // Asked anyway, the second says why it cannot run, not that it does not exist.
    await expect(c.request(SIDECAR_METHODS.voiceVoices)).rejects.toMatchObject({ code: RPC_ERRORS.unavailable })
  }, 60_000)
})

describe('errors', () => {
  it('returns method-not-found for an unknown method', async () => {
    const c = makeClient()
    await c.start()
    await expect(c.request('does.not.exist')).rejects.toMatchObject({
      code: RPC_ERRORS.methodNotFound
    })
  }, 60_000)

  it('rejects non-object params', async () => {
    const c = makeClient()
    await c.start()
    await expect(c.request(SIDECAR_METHODS.ping, 'not-an-object')).rejects.toMatchObject({
      code: RPC_ERRORS.invalidParams
    })
  }, 60_000)
})

describe('the self-test (docs/CLIPS.md §3a.3 stage 4)', () => {
  it('answers for every group, in the order main names them, each with its exit, time and reason', async () => {
    /*
     * Each group runs in a fresh child of this interpreter
     * (sidecar/forge_sidecar/selftest.py). On CI's bare interpreter every
     * group fails, and that is an answer; the keys, in order, hold the
     * helper's GROUPS and src/shared/sidecar/selftest.ts' SELFTEST_GROUPS
     * equal. On the venv, a group whose methods hello registered must also
     * load its native code in a fresh process: that is the whole point of it.
     */
    const c = makeClient()
    const hello = await c.start()
    expect(hello.capabilities).toContain(SIDECAR_METHODS.selftest)
    const messages: string[] = []
    const result = await c.request<SelftestResult>(SIDECAR_METHODS.selftest, {}, {
      timeoutMs: 400_000,
      onProgress: (_p, message) => {
        if (message) messages.push(message)
      }
    })
    expect(Object.keys(result)).toEqual([...SELFTEST_GROUP_NAMES])
    expect(messages).toEqual(SELFTEST_GROUP_NAMES.map((g, i) => `checking ${g} · ${i + 1} of ${SELFTEST_GROUP_NAMES.length}`))
    for (const group of SELFTEST_GROUP_NAMES) {
      const one = result[group]
      expect(Object.keys(one).sort(), group).toEqual(['error', 'exit', 'ms'])
      expect(Number.isInteger(one.exit), group).toBe(true)
      expect(Number.isInteger(one.ms) && one.ms >= 0, group).toBe(true)
      if (one.exit === 0) expect(one.error, group).toBeNull()
      else expect(one.error === null || typeof one.error === 'string', group).toBe(true)
      const methods: readonly string[] = SELFTEST_GROUPS[group]
      if (HAS_VENV && methods.length > 0 && methods.every((m) => hello.capabilities.includes(m))) {
        expect(one, `${group}: hello registered ${methods.join(', ')}, and a fresh process could not load it`).toMatchObject({ exit: 0, error: null })
      }
    }
    // Asked for some, it runs those alone.
    const some = await c.request<Partial<SelftestResult>>(SIDECAR_METHODS.selftest, { groups: ['sklearn', 'vision'] }, { timeoutMs: 200_000 })
    expect(Object.keys(some)).toEqual(['sklearn', 'vision'])
    await expect(c.request(SIDECAR_METHODS.selftest, { groups: ['stems'] })).rejects.toThrow(/unknown self-test group: 'stems'/)
  }, 600_000)
})

describe('progress and cancellation', () => {
  it('streams progress while a request runs', async () => {
    const c = makeClient()
    await c.start()
    const seen: (number | null)[] = []

    await c.request('system.sleep', { seconds: 0.6 }, { onProgress: (p) => seen.push(p) })

    expect(seen.length).toBeGreaterThan(2)
    expect(seen.at(-1)).toBeCloseTo(1, 5)
    // Progress must be monotonic — a bar that goes backwards reads as a bug.
    const numeric = seen.filter((p): p is number => p !== null)
    expect(numeric).toEqual([...numeric].sort((a, b) => a - b))
  }, 60_000)

  it('cancels a running request via AbortSignal', async () => {
    const c = makeClient()
    await c.start()
    const controller = new AbortController()

    const promise = c.request('system.sleep', { seconds: 10 }, { signal: controller.signal })
    setTimeout(() => controller.abort(), 250)

    await expect(promise).rejects.toMatchObject({ code: RPC_ERRORS.cancelled })
  }, 60_000)

  it('stays usable after a cancellation', async () => {
    const c = makeClient()
    await c.start()
    const controller = new AbortController()
    const promise = c.request('system.sleep', { seconds: 10 }, { signal: controller.signal })
    setTimeout(() => controller.abort(), 200)
    await expect(promise).rejects.toThrow()

    // The read loop must survive a cancelled request.
    const result = await c.request<{ pong: string }>(SIDECAR_METHODS.ping, { echo: 'still here' })
    expect(result.pong).toBe('still here')
  }, 60_000)

  it('times out and cancels the underlying work', async () => {
    const c = makeClient()
    await c.start()
    await expect(
      c.request('system.sleep', { seconds: 10 }, { timeoutMs: 300 })
    ).rejects.toThrow(/timed out/)

    const result = await c.request<{ pong: number }>(SIDECAR_METHODS.ping, { echo: 1 })
    expect(result.pong).toBe(1)
  }, 60_000)

  it('runs concurrent requests without interleaving their responses', async () => {
    const c = makeClient()
    await c.start()
    const results = await Promise.all([
      c.request<{ pong: string }>(SIDECAR_METHODS.ping, { echo: 'a' }),
      c.request<{ slept: number }>('system.sleep', { seconds: 0.3 }),
      c.request<{ pong: string }>(SIDECAR_METHODS.ping, { echo: 'c' })
    ])
    expect(results[0].pong).toBe('a')
    expect(results[1].slept).toBeCloseTo(0.3, 5)
    expect(results[2].pong).toBe('c')
  }, 60_000)
})

describe('lifecycle', () => {
  it('rejects in-flight requests when stopped', async () => {
    const c = makeClient()
    await c.start()
    const promise = c.request('system.sleep', { seconds: 10 })
    void c.stop()
    await expect(promise).rejects.toBeInstanceOf(SidecarError)
  }, 60_000)

  it('a stop cancels the work in flight, so the helper exits by itself rather than being killed', async () => {
    /*
     * On stdin's end the helper drains in-flight handlers for up to 300 s, so
     * a stop that only closed stdin ended in the SIGKILL 1.5 s later, and no
     * handler's cleanup ran — an analysis' worker and half-track included.
     */
    const c = makeClient()
    await c.start()
    let running!: () => void
    const started = new Promise<void>((done) => (running = done))
    const promise = c.request('system.sleep', { seconds: 30 }, { onProgress: () => running() })
    await started
    const exited = new Promise<{ code: number | null; signal: string | null }>((done) => c.once('exit', done))
    const began = performance.now()
    void c.stop()
    await expect(promise).rejects.toBeInstanceOf(SidecarError)
    expect(await exited).toMatchObject({ code: 0, signal: null })
    expect(performance.now() - began).toBeLessThan(1500)
  }, 60_000)

  it('restarts after an unexpected exit when configured to', async () => {
    const c = makeClient({ maxRestarts: 2 })
    await c.start()

    const exited = new Promise<void>((r) => c.once('exit', () => r()))
    // Ask the sidecar to take its own process down.
    void c.request('system.ping', { echo: 'x' }).catch(() => undefined)
    ;(c as unknown as { child: { kill: (s: string) => void } | null }).child?.kill('SIGKILL')
    await exited

    // A later request must bring it back rather than failing forever.
    const result = await c.request<{ pong: string }>(SIDECAR_METHODS.ping, { echo: 'back' })
    expect(result.pong).toBe('back')
  }, 60_000)
})

describe('the protocol is UTF-8 under the pack’s -E (docs/CLIPS.md §3a.8 row 38)', () => {
  /*
   * `-E` ignores PYTHONIOENCODING, and a pipe then gets the locale's
   * encoding: Latin-1 here, the ANSI code page (cp1252) on Windows. Measured
   * on the Mac before __main__ set its own streams: the path below was read
   * as mojibake, and a reply holding it failed with "'latin-1' codec can't
   * encode characters". (LC_ALL=C cannot show it: Python turns UTF-8 mode on
   * by itself there.) Both directions are held, each on its own: a raw UTF-8
   * request whose reply is forced to ASCII escapes, so what the helper READ
   * is visible exactly; and an ASCII-only request, so only what it WROTE is
   * tested.
   */
  const NAME = 'Bräutigam 5:30pm ಕನ್ನಡ.mp4'
  const LATIN1 = 'en_US.ISO8859-1'
  const latin1 = process.platform === 'darwin' && existsSync(`/usr/share/locale/${LATIN1}`)
  const env = { ...cleanHelperEnv(process.env, process.platform), ...(latin1 ? { LC_ALL: LATIN1, LANG: LATIN1 } : {}) }

  function exchange(args: string[], request: string): { pong: unknown; error: unknown; stdout: Buffer; stderr: string } {
    const launch = devHelperLaunch()
    const run = spawnSync(launch.command, [...PACK_FLAGS, ...args], {
      cwd: SIDECAR_DIR,
      env,
      input: Buffer.from(`${request}\n`, 'utf8'),
      timeout: 60_000,
      windowsHide: true
    })
    const replies = run.stdout
      .toString('utf8')
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as { id?: number; result?: { pong?: unknown }; error?: unknown })
    const reply = replies.find((m) => m.id === 1)
    return { pong: reply?.result?.pong, error: reply?.error, stdout: run.stdout, stderr: run.stderr.toString('utf8') }
  }

  it('reads a non-ASCII path in a request as the path it is', () => {
    // The helper's own __main__, through runpy as `-m` runs it, with every reply written as ASCII escapes.
    const asciiReplies = [
      'import json, runpy',
      '_dumps = json.dumps',
      'json.dumps = lambda o, **k: _dumps(o, **{**k, "ensure_ascii": True})',
      'runpy.run_module("forge_sidecar", run_name="__main__", alter_sys=True)'
    ].join('\n')
    const { pong, error, stdout, stderr } = exchange(['-c', asciiReplies], JSON.stringify({ jsonrpc: '2.0', id: 1, method: SIDECAR_METHODS.ping, params: { echo: NAME } }))
    expect(error, stderr).toBeUndefined()
    expect([...stdout].every((b) => b < 0x80), 'the replies are ASCII escapes').toBe(true)
    expect(pong, stderr).toBe(NAME)
  }, 60_000)

  it('writes a non-ASCII path in a reply as UTF-8', () => {
    // A request in ASCII alone (JSON escapes), so only the reply's encoding is under test.
    const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: SIDECAR_METHODS.ping, params: { echo: NAME } }).replace(
      /[\u0080-\uffff]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
    )
    expect([...Buffer.from(request, 'utf8')].every((b) => b < 0x80)).toBe(true)
    const { pong, error, stdout, stderr } = exchange(['-m', 'forge_sidecar'], request)
    expect(error, stderr).toBeUndefined()
    expect(pong, stderr).toBe(NAME)
    expect(stdout.includes(Buffer.from(NAME, 'utf8')), 'the path as UTF-8 bytes').toBe(true)
  }, 60_000)
})
