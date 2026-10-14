import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FETCH_RETRY,
  fetchVerified,
  PACK_FETCH_WAY_OUT,
  renameWithRetry,
  RENAME_RETRY,
  type FetchRetry,
  type FetchVerifiedOptions
} from '../src/main/net/fetchFile'
import type { PackFile } from '@shared/sidecar/pack'

/*
 * The AI helper pack's download (docs/CLIPS.md §3a.3 stage 1, §3a.7): one file
 * at a time, streamed to `<name>.part` through a hash and a byte count, judged
 * against the manifest, renamed into place only when it is the file.
 *
 * The network is a fake `fetch`: a function, scripted per URL, whose bodies are
 * ReadableStreams pulled chunk by chunk (the sandbox cannot listen on a port).
 * Like Node's fetch, it rejects at once on a signal already stopped, errors its
 * body when the signal stops it mid-transfer, and with `redirect: 'follow'`
 * follows a redirect itself. The budget's clock is the test's own.
 */

const WHEEL_URL = 'https://files.pythonhosted.org/packages/ab/cd/ef/numpy-2.3.4-cp314-cp314-macosx_14_0_arm64.whl'
const OTHER_URL = 'https://files.pythonhosted.org/packages/12/34/56/scipy-1.16.2-cp314-cp314-macosx_14_0_arm64.whl'
const GITHUB_URL = 'https://github.com/astral-sh/python-build-standalone/releases/download/20261001/cpython.tar.gz'
const ASSETS_URL = 'https://release-assets.githubusercontent.com/github-production-release-asset/162334160/f66ebd77'

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** Bytes that are not all alike, so a cut or a shift shows in the hash. */
function bytesOf(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n)
  let x = seed
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0
    out[i] = x >>> 24
  }
  return out
}

function packFile(name: string, url: string, body: Uint8Array): PackFile {
  return { name, url, bytes: body.length, sha256: sha256(body) }
}

/** One answer from the fake network. */
type Reply =
  | { status: number }
  | { redirect: string; status?: number }
  | 'silent'
  | {
      body: Uint8Array
      /** The Content-Length header; omitted, none is sent (a chunked body). */
      length?: number
      encoding?: string
      /** Bytes per pull. */
      chunk?: number
      /** A real wait before each pull, in ms. */
      gapMs?: number
    }

interface FakeNet {
  fetch: typeof globalThis.fetch
  /** Calls per URL. */
  calls: Record<string, number>
  /** Every body chunk handed out, across all calls. */
  pulls: number
  /** The `redirect` mode each call was made with. */
  modes: string[]
}

function fakeNet(script: Record<string, Reply[]>): FakeNet {
  const net: FakeNet = { fetch: undefined as never, calls: {}, pulls: 0, modes: [] }
  const answer = (url: string, init?: RequestInit): Promise<Response> => {
    const n = net.calls[url] ?? 0
    net.calls[url] = n + 1
    const replies = script[url]
    if (!replies) throw new Error(`the fake network was asked for ${url}`)
    const reply = replies[Math.min(n, replies.length - 1)]
    const signal = init?.signal ?? undefined
    if (signal?.aborted) return Promise.reject(signal.reason)
    if (reply === 'silent') {
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    if ('redirect' in reply) {
      if (init?.redirect === 'follow') return answer(reply.redirect, init)
      return Promise.resolve(new Response(null, { status: reply.status ?? 302, headers: { location: reply.redirect } }))
    }
    if ('status' in reply) return Promise.resolve(new Response('Service Unavailable', { status: reply.status }))
    const { body, chunk = 1024, gapMs = 0 } = reply
    let at = 0
    let stopped = false
    const headers: Record<string, string> = {}
    if (reply.length !== undefined) headers['content-length'] = String(reply.length)
    if (reply.encoding) headers['content-encoding'] = reply.encoding
    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            signal?.addEventListener(
              'abort',
              () => {
                stopped = true
                controller.error(signal.reason)
              },
              { once: true }
            )
          },
          async pull(controller) {
            if (gapMs) await new Promise((resolve) => setTimeout(resolve, gapMs))
            if (stopped) return
            if (at >= body.length) return controller.close()
            net.pulls++
            controller.enqueue(body.slice(at, at + chunk))
            at += chunk
          }
        }),
        { status: 200, headers }
      )
    )
  }
  net.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    net.modes.push(String(init?.redirect))
    return answer(url, init)
  }) as typeof globalThis.fetch
  return net
}

/** The default policy with the waits a millisecond, so four tries take no time. */
const QUICK: FetchRetry = { ...FETCH_RETRY, firstDelayMs: 1 }

let dir = ''
let clock = 0
let messages: string[] = []
let transferred = 0
let job = new AbortController()

function deps(net: FakeNet, over: Partial<FetchVerifiedOptions> = {}): FetchVerifiedOptions {
  return {
    fetch: net.fetch,
    retry: QUICK,
    signal: job.signal,
    now: () => clock,
    rename: (from, to) => rename(from, to),
    onBytes: (n) => {
      transferred += n
    },
    onMessage: (m) => messages.push(m),
    ...over
  }
}

async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (err) {
    return err as Error
  }
  throw new Error('expected the fetch to fail, and it resolved')
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-fetchfile-'))
  clock = 0
  messages = []
  transferred = 0
  job = new AbortController()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('a file that arrives broken is fetched again', () => {
  it('a body cut at 90 % is dropped and the file fetched again, whole', async () => {
    const body = bytesOf(100_000)
    const file = packFile('numpy.whl', WHEEL_URL, body)
    const net = fakeNet({ [WHEEL_URL]: [{ body: body.slice(0, 90_000) }, { body }] })

    const path = await fetchVerified(file, dir, deps(net))

    expect(path).toBe(join(dir, 'numpy.whl'))
    expect(net.calls[WHEEL_URL]).toBe(2)
    expect(sha256(await readFile(path))).toBe(file.sha256)
    expect(await readdir(dir)).toEqual(['numpy.whl'])
    expect(messages.filter((m) => m.includes('files.pythonhosted.org sent only part of the file, trying again'))).toHaveLength(1)
    // Every byte that crossed the wire is counted, the broken try's too: the speed is the line's.
    expect(transferred).toBe(90_000 + 100_000)
  })

  it('a 503, then a 200: two fetches, and the file', async () => {
    const body = bytesOf(5_000)
    const file = packFile('numpy.whl', WHEEL_URL, body)
    const net = fakeNet({ [WHEEL_URL]: [{ status: 503 }, { body, length: body.length }] })

    await fetchVerified(file, dir, deps(net))

    expect(net.calls[WHEEL_URL]).toBe(2)
    const retries = messages.filter((m) => m.includes('trying again'))
    expect(retries).toHaveLength(1)
    expect(retries[0]).toContain('downloading numpy.whl: files.pythonhosted.org answered 503, trying again in 1s (2 of 4)')
  })

  it('past minute 6 across files, a later file still gets its own budget and its retry', async () => {
    const first = bytesOf(3_000, 1)
    const second = bytesOf(3_000, 2)
    const a = packFile('numpy.whl', WHEEL_URL, first)
    const b = packFile('scipy.whl', OTHER_URL, second)
    const net = fakeNet({ [WHEEL_URL]: [{ body: first }], [OTHER_URL]: [{ status: 503 }, { body: second }] })

    await fetchVerified(a, dir, deps(net))
    // A slow line: the first file took seven minutes.
    clock = 7 * 60_000
    await fetchVerified(b, dir, deps(net))

    expect(net.calls[OTHER_URL]).toBe(2)
    expect(sha256(await readFile(join(dir, 'scipy.whl')))).toBe(b.sha256)
  })
})

describe('what is not the file is never fetched again', () => {
  it('a Content-Length other than the bytes: one fetch, the sentence, nothing on disk', async () => {
    const body = bytesOf(10_000)
    const file = packFile('numpy.whl', WHEEL_URL, body)
    const page = new TextEncoder().encode('<html>Sign in to the hotel wifi</html>')
    const net = fakeNet({ [WHEEL_URL]: [{ body: page, length: page.length }] })

    const err = await failure(fetchVerified(file, dir, deps(net)))

    expect(net.calls[WHEEL_URL]).toBe(1)
    expect(err.message).toContain(
      'something other than the file arrived from files.pythonhosted.org (a sign-in page or a network filter?)'
    )
    expect(err.message).toContain(PACK_FETCH_WAY_OUT)
    expect(await readdir(dir)).toEqual([])
    expect(transferred).toBe(0)
  })

  it('exactly the bytes with another sha256 fails on the first fetch, naming the file and its host', async () => {
    const body = bytesOf(8_000)
    const file = { ...packFile('numpy.whl', WHEEL_URL, body), sha256: sha256(bytesOf(8_000, 9)) }
    const net = fakeNet({ [WHEEL_URL]: [{ body, length: body.length }] })

    const err = await failure(fetchVerified(file, dir, deps(net)))

    expect(net.calls[WHEEL_URL]).toBe(1)
    expect(err.message).toContain('numpy.whl from files.pythonhosted.org did not match its published checksum')
    expect(err.message).not.toContain('gave up')
    expect(await readdir(dir)).toEqual([])
  })

  it('a body that runs past the bytes is stopped at once and dropped, with no retry', async () => {
    const body = bytesOf(4_096)
    const file = packFile('numpy.whl', WHEEL_URL, body)
    // The file and then a great deal more, in 1 KiB pulls, with no Content-Length to give it away.
    const net = fakeNet({ [WHEEL_URL]: [{ body: bytesOf(200 * 1024), chunk: 1024 }] })

    const err = await failure(fetchVerified(file, dir, deps(net)))

    expect(net.calls[WHEEL_URL]).toBe(1)
    expect(err.message).toContain("more than numpy.whl's 4096 B arrived from files.pythonhosted.org")
    // Read up to the chunk that went past, and a pull the stream had already queued; not the 200.
    expect(net.pulls).toBeLessThan(10)
    expect(await readdir(dir)).toEqual([])
  })
})

describe('the job’s cancel stops the transfer itself', () => {
  it('after the abort, the body is read no further and the .part is gone', async () => {
    const body = bytesOf(100 * 1024)
    const file = packFile('numpy.whl', WHEEL_URL, body)
    const net = fakeNet({ [WHEEL_URL]: [{ body, chunk: 1024, gapMs: 5 }] })

    const err = await failure(
      fetchVerified(
        file,
        dir,
        deps(net, {
          onBytes: (n) => {
            transferred += n
            if (transferred >= 3 * 1024) job.abort()
          }
        })
      )
    )
    const pullsAtCancel = net.pulls
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(err.name).toBe('CancelledError')
    expect(pullsAtCancel).toBeLessThan(10)
    expect(net.pulls).toBe(pullsAtCancel)
    expect(await readdir(dir)).toEqual([])
  })
})

describe('a failure names the host that failed', () => {
  it('files.pythonhosted.org, every try and the last, with the way out', async () => {
    const body = bytesOf(1_000)
    const file = packFile('numpy.whl', WHEEL_URL, body)
    const net = fakeNet({ [WHEEL_URL]: [{ status: 503 }] })

    const err = await failure(fetchVerified(file, dir, deps(net)))

    expect(net.calls[WHEEL_URL]).toBe(4)
    expect(messages).toHaveLength(3)
    for (const m of messages) expect(m).toContain('files.pythonhosted.org answered 503, trying again')
    expect(err.message).toContain('numpy.whl could not be downloaded: files.pythonhosted.org answered 503 — gave up after 4 tries')
    expect(err.message).toContain(PACK_FETCH_WAY_OUT)
    expect([err.message, ...messages].join('\n')).not.toContain('GitHub')
  })

  it('a redirect that hands off to a host that never answers names that host, not github.com', async () => {
    const body = bytesOf(1_000)
    const file = packFile('cpython.tar.gz', GITHUB_URL, body)
    const net = fakeNet({ [GITHUB_URL]: [{ redirect: ASSETS_URL }], [ASSETS_URL]: ['silent'] })

    const err = await failure(fetchVerified(file, dir, deps(net, { retry: { ...QUICK, attempts: 2, binaryAnswerMs: 30 } })))

    expect(net.calls[ASSETS_URL]).toBe(2)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('release-assets.githubusercontent.com did not answer, trying again')
    expect(err.message).toContain('release-assets.githubusercontent.com did not answer within 30 ms — gave up after 2 tries')
    // Each hop is asked for by hand, so the hop that failed is the one named.
    expect(new Set(net.modes)).toEqual(new Set(['manual']))
  })

  it('a redirect that lands is followed to the file', async () => {
    const body = bytesOf(2_000)
    const file = packFile('cpython.tar.gz', GITHUB_URL, body)
    const net = fakeNet({ [GITHUB_URL]: [{ redirect: ASSETS_URL }], [ASSETS_URL]: [{ body, length: body.length }] })

    await fetchVerified(file, dir, deps(net))

    expect(net.calls).toEqual({ [GITHUB_URL]: 1, [ASSETS_URL]: 1 })
    expect(sha256(await readFile(join(dir, 'cpython.tar.gz')))).toBe(file.sha256)
  })

  it('a file that lands says which host it came from after its redirects, so the job’s log names it (§3a.5)', async () => {
    const body = bytesOf(2_000)
    const file = packFile('cpython.tar.gz', GITHUB_URL, body)
    const net = fakeNet({ [GITHUB_URL]: [{ redirect: ASSETS_URL }], [ASSETS_URL]: [{ body, length: body.length }] })

    await fetchVerified(file, dir, deps(net))

    const landed = messages.filter((m) => m.startsWith('cpython.tar.gz came from '))
    expect(landed).toEqual(['cpython.tar.gz came from release-assets.githubusercontent.com: 2000 B, its sha256 verified'])
    // A file that was already there was not fetched, and says nothing of a host.
    messages = []
    await fetchVerified(file, dir, deps(net))
    expect(messages).toEqual([])
  })
})

describe('resume by file', () => {
  it('a file already there with its hash is not fetched, and counts nothing', async () => {
    const body = bytesOf(6_000)
    const file = packFile('numpy.whl', WHEEL_URL, body)
    await writeFile(join(dir, 'numpy.whl'), body)
    const net = fakeNet({ [WHEEL_URL]: [{ body }] })

    const path = await fetchVerified(file, dir, deps(net))

    expect(path).toBe(join(dir, 'numpy.whl'))
    expect(net.calls[WHEEL_URL]).toBeUndefined()
    expect(transferred).toBe(0)
  })

  it('across two files, only the one transferred is counted', async () => {
    const present = bytesOf(6_000, 3)
    const missing = bytesOf(7_000, 4)
    const a = packFile('numpy.whl', WHEEL_URL, present)
    const b = packFile('scipy.whl', OTHER_URL, missing)
    await writeFile(join(dir, 'numpy.whl'), present)
    const net = fakeNet({ [WHEEL_URL]: [{ body: present }], [OTHER_URL]: [{ body: missing }] })

    await fetchVerified(a, dir, deps(net))
    await fetchVerified(b, dir, deps(net))

    expect(net.calls).toEqual({ [OTHER_URL]: 1 })
    expect(transferred).toBe(7_000)
  })

  it('a file there with another hash is deleted and fetched again', async () => {
    const body = bytesOf(6_000)
    const file = packFile('numpy.whl', WHEEL_URL, body)
    // The right size, the wrong bytes: a size check alone would keep it.
    await writeFile(join(dir, 'numpy.whl'), bytesOf(6_000, 7))
    const net = fakeNet({ [WHEEL_URL]: [{ body }] })

    await fetchVerified(file, dir, deps(net))

    expect(net.calls[WHEEL_URL]).toBe(1)
    expect(sha256(await readFile(join(dir, 'numpy.whl')))).toBe(file.sha256)
  })
})

describe('the rename into place, on Windows', () => {
  /** A rename refused `times` times with `code`, as a scanner holding the file refuses it. */
  function heldRename(times: number, code: string): { rename: (from: string, to: string) => Promise<void>; tries: () => number } {
    let tries = 0
    return {
      tries: () => tries,
      rename: async (from, to) => {
        tries++
        if (tries <= times) throw Object.assign(new Error(`${code}: operation not permitted, rename '${from}'`), { code })
        await rename(from, to)
      }
    }
  }
  const noWait = async (): Promise<void> => undefined

  it('a rename refused with EPERM twice still lands the file on win32', async () => {
    const body = bytesOf(3_000)
    const file = packFile('numpy.whl', WHEEL_URL, body)
    const net = fakeNet({ [WHEEL_URL]: [{ body }] })
    const held = heldRename(2, 'EPERM')

    const path = await fetchVerified(
      file,
      dir,
      deps(net, { rename: (from, to) => renameWithRetry(from, to, { platform: 'win32', sleep: noWait, rename: held.rename }) })
    )

    expect(held.tries()).toBe(3)
    expect(sha256(await readFile(path))).toBe(file.sha256)
    expect(await readdir(dir)).toEqual(['numpy.whl'])
  })

  it('EACCES and EBUSY are waited out too; another code is not, and neither is any code off win32', async () => {
    for (const code of ['EACCES', 'EBUSY']) {
      const held = heldRename(1, code)
      await writeFile(join(dir, 'a'), 'x')
      await renameWithRetry(join(dir, 'a'), join(dir, 'b'), { platform: 'win32', sleep: noWait, rename: held.rename })
      expect(held.tries()).toBe(2)
    }
    const other = heldRename(1, 'ENOENT')
    await expect(renameWithRetry('x', 'y', { platform: 'win32', sleep: noWait, rename: other.rename })).rejects.toThrow('ENOENT')
    expect(other.tries()).toBe(1)
    const mac = heldRename(1, 'EPERM')
    await expect(renameWithRetry('x', 'y', { platform: 'darwin', sleep: noWait, rename: mac.rename })).rejects.toThrow('EPERM')
    expect(mac.tries()).toBe(1)
  })

  it('is bounded: RENAME_RETRY.attempts tries, waits doubling to their cap, about ten seconds in all', async () => {
    const held = heldRename(1_000, 'EPERM')
    const waits: number[] = []
    await expect(
      renameWithRetry('x', 'y', {
        platform: 'win32',
        sleep: async (ms) => void waits.push(ms),
        rename: held.rename
      })
    ).rejects.toThrow('EPERM')
    expect(held.tries()).toBe(RENAME_RETRY.attempts)
    expect(waits).toEqual([50, 100, 200, 400, 800, 1600, 2000, 2000, 2000])
    const total = waits.reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThanOrEqual(5_000)
    expect(total).toBeLessThanOrEqual(15_000)
  })

  it('a rename refused past its tries fails the file and leaves no .part', async () => {
    const body = bytesOf(3_000)
    const file = packFile('numpy.whl', WHEEL_URL, body)
    const net = fakeNet({ [WHEEL_URL]: [{ body }] })
    const held = heldRename(1_000, 'EPERM')

    const err = await failure(
      fetchVerified(
        file,
        dir,
        deps(net, { rename: (from, to) => renameWithRetry(from, to, { platform: 'win32', sleep: noWait, rename: held.rename }) })
      )
    )

    expect(err.message).toContain('numpy.whl arrived whole but could not be moved into place')
    expect(await readdir(dir)).toEqual([])
  })
})
