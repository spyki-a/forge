import { describe, it, expect, afterEach } from 'vitest'
import { resolve } from 'node:path'
import { SidecarClient, SidecarError } from '../../src/main/sidecar/client'
import { OPTIONAL_METHODS, SIDECAR_METHODS, RPC_ERRORS, type HelloResult } from '@shared/sidecar/protocol'

const SIDECAR_DIR = resolve(__dirname, '../../sidecar')

let client: SidecarClient | null = null

function makeClient(options: Partial<{ maxRestarts: number }> = {}): SidecarClient {
  client = new SidecarClient({ cwd: SIDECAR_DIR, maxRestarts: options.maxRestarts ?? 0 })
  return client
}

afterEach(() => {
  client?.stop()
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
    c.stop()
    await expect(promise).rejects.toBeInstanceOf(SidecarError)
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
