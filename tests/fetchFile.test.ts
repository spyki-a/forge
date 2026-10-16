import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FETCH_RETRY,
  fetchVerified,
  PACK_FETCH_WAY_OUT,
  proxyFailure,
  renameWithRetry,
  RENAME_RETRY,
  type FetchRetry,
  type FetchVerifiedOptions
} from '../src/main/net/fetchFile'
import { chromiumFetch, firstProxy, SYSTEM_PROXY_SOURCE, type NetRequestLike, type NetRequestOptions } from '../src/main/net/chromiumFetch'
import { packFetch, packFetchVerified } from '../src/main/sidecar/installDeps'
import type { PackFile } from '@shared/sidecar/pack'

/*
 * The AI helper pack's download (docs/CLIPS.md §3a.3 stage 1, §3a.7): one file
 * at a time, streamed to `<name>.<pid>.<id>.part` through a hash and a byte count, judged
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
      /** The Content-Type header; omitted, none is sent. */
      type?: string
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
    if (reply.type) headers['content-type'] = reply.type
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
    // Each try says it begins, so the job's bar can count a retried file's best try rather than every byte.
    const tries: number[] = []
    let before = 0

    const path = await fetchVerified(file, dir, deps(net, { onTry: () => (tries.push(transferred - before), (before = transferred)) }))

    expect(path).toBe(join(dir, 'numpy.whl'))
    expect(net.calls[WHEEL_URL]).toBe(2)
    expect(tries, 'onTry before each try, the first try’s 90,000 B counted before the second').toEqual([0, 90_000])
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

  it('a filter’s page sent gzip-encoded, whose Content-Length is not compared, is still not the file: one fetch, the sentence (P-B finding V1)', async () => {
    const body = bytesOf(10_000)
    const file = packFile('numpy.whl', WHEEL_URL, body)
    const page = new TextEncoder().encode('<html>Sign in to the hotel wifi</html>')
    const net = fakeNet({ [WHEEL_URL]: [{ body: page, length: 25, encoding: 'gzip', type: 'text/html; charset=utf-8' }] })

    const err = await failure(fetchVerified(file, dir, deps(net)))

    expect(net.calls[WHEEL_URL]).toBe(1)
    expect(err.message).toContain(
      'something other than the file arrived from files.pythonhosted.org (a sign-in page or a network filter?): numpy.whl came back as a web page (text/html; charset=utf-8)'
    )
    expect(err.message).toContain(PACK_FETCH_WAY_OUT)
    expect(await readdir(dir)).toEqual([])
    expect(transferred).toBe(0)
    // The file itself, as both hosts serve it, is taken.
    const ok = fakeNet({ [WHEEL_URL]: [{ body, length: body.length, type: 'application/octet-stream' }] })
    await fetchVerified(file, dir, deps(ok))
    expect(sha256(await readFile(join(dir, 'numpy.whl')))).toBe(file.sha256)
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

describe('a temporary name of its own', () => {
  it('two fetches of one file into one folder at once each land it, and leave no .part (P-B finding V1)', async () => {
    const body = bytesOf(20_000)
    const file = packFile('numpy.whl', WHEEL_URL, body)
    const net = fakeNet({ [WHEEL_URL]: [{ body, length: body.length, chunk: 1_000, gapMs: 1 }] })

    const both = await Promise.allSettled([fetchVerified(file, dir, deps(net)), fetchVerified(file, dir, deps(net))])

    expect(both.map((r) => (r.status === 'fulfilled' ? r.value : String(r.reason)))).toEqual([join(dir, 'numpy.whl'), join(dir, 'numpy.whl')])
    expect(net.calls[WHEEL_URL]).toBe(2)
    expect(sha256(await readFile(join(dir, 'numpy.whl')))).toBe(file.sha256)
    expect(await readdir(dir)).toEqual(['numpy.whl'])
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

/* ------------------------------------------------- Chromium's stack, and proxies */

/** A fetch that fails every call with `make()`'s error, counting the calls. */
function failingFetch(make: () => unknown): { fetch: typeof globalThis.fetch; calls: () => number } {
  let calls = 0
  return {
    calls: () => calls,
    fetch: (async () => {
      calls++
      throw make()
    }) as typeof globalThis.fetch
  }
}

describe('Chromium’s errors are the network’s, and are tried again (§15 row 19)', () => {
  it('a plain Error whose message is net::ERR_CONNECTION_RESET is retried, and its retry line names the host and the code', async () => {
    // As Electron 44.3.0 reports every network failure: no code, no cause, the code in the message (probe-netfetch.mjs).
    const body = bytesOf(2_000)
    const file = packFile('numpy.whl', WHEEL_URL, body)
    const ok = fakeNet({ [WHEEL_URL]: [{ body, length: body.length }] })
    let n = 0
    const fetch = ((input: string, init?: RequestInit) => (++n <= 2 ? Promise.reject(new Error('net::ERR_CONNECTION_RESET')) : ok.fetch(input, init))) as typeof globalThis.fetch

    await fetchVerified(file, dir, deps(ok, { fetch }))

    expect(n).toBe(3)
    expect(messages.filter((m) => m.includes('trying again'))).toEqual([
      'downloading numpy.whl: the connection to files.pythonhosted.org failed (ERR_CONNECTION_RESET), trying again in 1s (2 of 4)',
      'downloading numpy.whl: the connection to files.pythonhosted.org failed (ERR_CONNECTION_RESET), trying again in 1s (3 of 4)'
    ])
  })

  it('a name that does not resolve is retried and named; a certificate Chromium refuses is not retried', async () => {
    const file = packFile('numpy.whl', WHEEL_URL, bytesOf(10))
    const nx = failingFetch(() => new Error('net::ERR_NAME_NOT_RESOLVED'))
    const err = await failure(fetchVerified(file, dir, deps(fakeNet({}), { fetch: nx.fetch })))
    expect(nx.calls()).toBe(4)
    expect(err.message).toContain('numpy.whl could not be downloaded: files.pythonhosted.org could not be reached: net::ERR_NAME_NOT_RESOLVED — gave up after 4 tries')
    expect(err.message).toContain(PACK_FETCH_WAY_OUT)

    const cert = failingFetch(() => new Error('net::ERR_CERT_AUTHORITY_INVALID'))
    await failure(fetchVerified(file, dir, deps(fakeNet({}), { fetch: cert.fetch })))
    expect(cert.calls()).toBe(1)
  })
})

describe('a proxy that fails is named as the proxy, never as the host behind it (§3a.5)', () => {
  it('Chromium’s dead proxy: the proxy chromiumFetch resolved, from this computer’s settings', async () => {
    const file = packFile('cpython.tar.gz', GITHUB_URL, bytesOf(10))
    const dead = failingFetch(() => Object.assign(new Error('net::ERR_PROXY_CONNECTION_FAILED'), { proxy: { address: '10.0.0.5:3128', source: SYSTEM_PROXY_SOURCE } }))

    const err = await failure(fetchVerified(file, dir, deps(fakeNet({}), { fetch: dead.fetch })))

    expect(err.message).toContain("cpython.tar.gz could not be downloaded: the proxy 10.0.0.5:3128 (this computer's proxy settings) could not be reached: net::ERR_PROXY_CONNECTION_FAILED")
    expect(err.message).toContain(PACK_FETCH_WAY_OUT)
    expect(messages[0]).toBe("downloading cpython.tar.gz: the proxy 10.0.0.5:3128 (this computer's proxy settings) could not be reached (ERR_PROXY_CONNECTION_FAILED), trying again in 1s (2 of 4)")
    // github.com is never the one blamed: not in the sentence, not in a retry line.
    for (const line of [err.message, ...messages]) {
      expect(line).not.toContain('github.com could not be reached')
      expect(line).not.toContain('the connection to github.com')
    }
  })

  it('Chromium’s proxy failure with no address read back still names a proxy', () => {
    expect(proxyFailure(new Error('net::ERR_TUNNEL_CONNECTION_FAILED'), GITHUB_URL, {})).toEqual({ address: null, source: SYSTEM_PROXY_SOURCE })
  })

  it('Node’s fetch under NODE_USE_ENV_PROXY=1: a connect error to HTTPS_PROXY’s address names that proxy, and the sandbox’s EPERM is not retried', async () => {
    const file = packFile('cpython.tar.gz', GITHUB_URL, bytesOf(10))
    // As Node 24.18.1 reported it in the dev sandbox (EFFECTS §58, run C).
    const eperm = (): Error =>
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect EPERM 127.0.0.1:9 - Local (0.0.0.0:0)'), { code: 'EPERM', errno: -1, syscall: 'connect', address: '127.0.0.1', port: 9 })
      })
    const env = { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: 'http://127.0.0.1:9' }
    const dead = failingFetch(eperm)

    const err = await failure(fetchVerified(file, dir, deps(fakeNet({}), { fetch: dead.fetch, env })))

    expect(dead.calls()).toBe(1)
    expect(err.message).toBe(
      `cpython.tar.gz could not be downloaded: the proxy 127.0.0.1:9 (HTTPS_PROXY) could not be reached: fetch failed (connect EPERM 127.0.0.1:9 - Local (0.0.0.0:0)). ${PACK_FETCH_WAY_OUT}`
    )

    // Without NODE_USE_ENV_PROXY Node's fetch does not use the proxy at all, so the failure is the host's (EFFECTS §58, runs A and B).
    const direct = failingFetch(eperm)
    const host = await failure(fetchVerified(file, dir, deps(fakeNet({}), { fetch: direct.fetch, env: { HTTPS_PROXY: 'http://127.0.0.1:9' } })))
    expect(host.message).toContain('github.com could not be reached')
  })

  it('Node’s fetch: a refused proxy is retried and named; a proxy named by host name whose name does not resolve is named; NO_PROXY’s hosts are not', () => {
    const refused = new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:8080'), { code: 'ECONNREFUSED', address: '10.1.2.3', port: 8080 }) })
    expect(proxyFailure(refused, GITHUB_URL, { NODE_USE_ENV_PROXY: '1', https_proxy: 'http://10.1.2.3:8080' })).toEqual({ address: '10.1.2.3:8080', source: 'https_proxy' })
    // A proxy given by name connects to its address: the port is the proxy's, and no pack host listens on 8080.
    expect(proxyFailure(refused, GITHUB_URL, { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: 'http://proxy.corp:8080' })).toEqual({ address: 'proxy.corp:8080', source: 'HTTPS_PROXY' })
    const nx = new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND proxy.corp'), { code: 'ENOTFOUND', hostname: 'proxy.corp' }) })
    expect(proxyFailure(nx, GITHUB_URL, { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: 'http://proxy.corp:8080' })).toEqual({ address: 'proxy.corp:8080', source: 'HTTPS_PROXY' })
    // The host's own failure is not the proxy's, and a host NO_PROXY exempts never goes through it.
    const github = new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 140.82.121.4:443'), { code: 'ECONNREFUSED', address: '140.82.121.4', port: 443 }) })
    expect(proxyFailure(github, GITHUB_URL, { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: 'http://10.1.2.3:8080' })).toBeNull()
    expect(proxyFailure(refused, GITHUB_URL, { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: 'http://10.1.2.3:8080', NO_PROXY: 'localhost,.github.com' })).toBeNull()
  })
})

/* ------------------------------------------------- chromiumFetch over a fake net.request */

type NetReply =
  | { redirect: string; status?: number }
  | { status: number; headers?: Record<string, string>; body?: Uint8Array; chunk?: number }
  | { error: string }
  | 'silent'

class FakeResponse extends EventEmitter {
  statusMessage = ''
  constructor(
    readonly statusCode: number,
    readonly headers: Record<string, string | string[]>
  ) {
    super()
  }
  pause(): void {}
  resume(): void {}
}

/** Electron's ClientRequest as the probe saw it: a 'redirect' event in manual mode, then 'response' and its 'data'/'end', or 'error'. */
function fakeNetRequest(script: Record<string, NetReply[]>): {
  request: (options: NetRequestOptions) => NetRequestLike
  options: NetRequestOptions[]
  headers: Record<string, string>[]
  calls: Record<string, number>
  aborted: () => number
  followed: () => number
  chunksSent: () => number
} {
  const options: NetRequestOptions[] = []
  const headers: Record<string, string>[] = []
  const calls: Record<string, number> = {}
  let aborted = 0
  let followed = 0
  let chunksSent = 0
  const request = (o: NetRequestOptions): NetRequestLike => {
    options.push(o)
    const req = new EventEmitter()
    const sent: Record<string, string> = {}
    let url = o.url
    let stopped = false
    let pendingHop: string | null = null
    const answer = (): void => {
      const n = calls[url] ?? 0
      calls[url] = n + 1
      const replies = script[url]
      if (!replies) throw new Error(`the fake net.request was asked for ${url}`)
      const reply = replies[Math.min(n, replies.length - 1)]
      setImmediate(() => {
        if (stopped || reply === 'silent') return
        if ('redirect' in reply) {
          pendingHop = reply.redirect
          req.emit('redirect', reply.status ?? 302, 'GET', reply.redirect, { location: [reply.redirect] })
          return
        }
        if ('error' in reply) {
          req.emit('error', new Error(reply.error))
          return
        }
        const res = new FakeResponse(reply.status, reply.headers ?? {})
        req.emit('response', res)
        const body = reply.body ?? new Uint8Array(0)
        const chunk = reply.chunk ?? 1024
        let at = 0
        const pump = (): void => {
          if (stopped) return
          if (at >= body.length) return void res.emit('end')
          chunksSent++
          res.emit('data', Buffer.from(body.slice(at, at + chunk)))
          at += chunk
          setTimeout(pump, 1)
        }
        setImmediate(pump)
      })
    }
    return Object.assign(req, {
      setHeader: (name: string, value: string) => void (sent[name.toLowerCase()] = value),
      abort: () => {
        stopped = true
        aborted++
      },
      followRedirect: () => {
        followed++
        url = pendingHop!
        answer()
      },
      end: () => {
        headers.push(sent)
        answer()
      }
    }) as unknown as NetRequestLike
  }
  return { request, options, headers, calls, aborted: () => aborted, followed: () => followed, chunksSent: () => chunksSent }
}

describe('chromiumFetch: Chromium’s stack, handing back what fetchVerified follows by hand', () => {
  it('in manual mode hands back the 302 with its Location, stops the request, and asks with no-store', async () => {
    const net = fakeNetRequest({ [GITHUB_URL]: [{ redirect: ASSETS_URL }] })
    const response = await chromiumFetch({ request: net.request })(GITHUB_URL, { redirect: 'manual', headers: { Range: 'bytes=0-0' } })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(ASSETS_URL)
    expect(net.aborted()).toBe(1)
    expect(net.followed()).toBe(0)
    expect(net.options).toEqual([{ url: GITHUB_URL, method: 'GET', redirect: 'manual', cache: 'no-store' }])
    expect(net.headers).toEqual([{ range: 'bytes=0-0' }])
  })

  it('in follow mode follows the hop itself and says where it landed', async () => {
    const body = bytesOf(3_000)
    const net = fakeNetRequest({ [GITHUB_URL]: [{ redirect: ASSETS_URL }], [ASSETS_URL]: [{ status: 206, headers: { 'content-range': 'bytes 0-2999/3000' }, body }] })
    const response = await chromiumFetch({ request: net.request })(GITHUB_URL)
    expect(response.status).toBe(206)
    expect(response.url).toBe(ASSETS_URL)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(body)
    expect(net.followed()).toBe(1)
  })

  it('carries fetchVerified through github.com’s hand-off, and the log names release-assets as the host the file came from', async () => {
    const body = bytesOf(5_000)
    const file = packFile('cpython.tar.gz', GITHUB_URL, body)
    const net = fakeNetRequest({ [GITHUB_URL]: [{ redirect: ASSETS_URL }], [ASSETS_URL]: [{ status: 200, headers: { 'content-length': String(body.length), 'content-type': 'application/octet-stream' }, body }] })

    await fetchVerified(file, dir, deps(fakeNet({}), { fetch: chromiumFetch({ request: net.request }) }))

    expect(sha256(await readFile(join(dir, 'cpython.tar.gz')))).toBe(file.sha256)
    expect(messages).toContain('cpython.tar.gz came from release-assets.githubusercontent.com: 5000 B, its sha256 verified')
    expect(net.calls).toEqual({ [GITHUB_URL]: 1, [ASSETS_URL]: 1 })
  })

  it('a hop that never answers is named by its own host, and its request is stopped', async () => {
    const file = packFile('cpython.tar.gz', GITHUB_URL, bytesOf(10))
    const net = fakeNetRequest({ [GITHUB_URL]: [{ redirect: ASSETS_URL }], [ASSETS_URL]: ['silent'] })

    const err = await failure(fetchVerified(file, dir, deps(fakeNet({}), { fetch: chromiumFetch({ request: net.request }), retry: { ...QUICK, attempts: 2, binaryAnswerMs: 30 } })))

    expect(err.message).toContain('release-assets.githubusercontent.com did not answer within 30 ms — gave up after 2 tries')
    // Each try: the 302's request stopped at its redirect, the silent hop's stopped by the answer's timer.
    expect(net.aborted()).toBe(4)
  })

  it('a dead proxy is resolved and named, the host behind it never blamed', async () => {
    const file = packFile('cpython.tar.gz', GITHUB_URL, bytesOf(10))
    const net = fakeNetRequest({ [GITHUB_URL]: [{ error: 'net::ERR_PROXY_CONNECTION_FAILED' }] })
    const asked: string[] = []
    const fetch = chromiumFetch({ request: net.request, resolveProxy: async (url) => (asked.push(url), 'PROXY 127.0.0.1:59998') })

    const err = await failure(fetchVerified(file, dir, deps(fakeNet({}), { fetch, retry: { ...QUICK, attempts: 1 } })))

    expect(asked).toEqual([GITHUB_URL])
    expect(err.message).toContain("the proxy 127.0.0.1:59998 (this computer's proxy settings) could not be reached: net::ERR_PROXY_CONNECTION_FAILED")
    expect(err.message).not.toContain('github.com could not be reached')
  })

  it('the job’s cancel mid-body stops the request and the stream', async () => {
    const body = bytesOf(200 * 1024)
    const file = packFile('numpy.whl', WHEEL_URL, body)
    const net = fakeNetRequest({ [WHEEL_URL]: [{ status: 200, headers: { 'content-length': String(body.length) }, body, chunk: 1024 }] })

    const err = await failure(
      fetchVerified(
        file,
        dir,
        deps(fakeNet({}), {
          fetch: chromiumFetch({ request: net.request }),
          onBytes: (n) => {
            transferred += n
            if (transferred >= 3 * 1024) job.abort()
          }
        })
      )
    )
    const sentAtCancel = net.chunksSent()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(err.name).toBe('CancelledError')
    expect(net.aborted()).toBeGreaterThanOrEqual(1)
    expect(net.chunksSent()).toBe(sentAtCancel)
    expect(await readdir(dir)).toEqual([])
  })

  it('reads the first proxy from resolveProxy’s answer, and none from DIRECT', () => {
    expect(firstProxy('PROXY 10.0.0.5:3128; DIRECT')).toBe('10.0.0.5:3128')
    expect(firstProxy('HTTPS proxy.corp:443')).toBe('proxy.corp:443')
    expect(firstProxy('DIRECT')).toBeNull()
  })
})

describe('installDeps picks the stack: Chromium’s inside a ready Electron, Node’s elsewhere', () => {
  it('keeps Node’s fetch without Electron, and before the app is ready', () => {
    expect(packFetch()).toBe(globalThis.fetch)
    expect(packFetch({ electron: '44.3.0', ready: () => false })).toBe(globalThis.fetch)
    expect(packFetch({ electron: '44.3.0', ready: () => true })).not.toBe(globalThis.fetch)
  })

  it('swaps the platform’s fetch for the pack’s, and leaves a fetch a caller handed in alone', async () => {
    const body = bytesOf(1_000)
    const file = packFile('numpy.whl', WHEEL_URL, body)
    const net = fakeNet({ [WHEEL_URL]: [{ body, length: body.length }] })
    let picked = 0
    const verified = packFetchVerified(() => (picked++, net.fetch))

    await verified(file, dir, deps(net, { fetch: globalThis.fetch }))
    expect(picked).toBe(1)
    expect(net.calls[WHEEL_URL]).toBe(1)

    await rm(join(dir, 'numpy.whl'))
    await verified(file, dir, deps(net))
    expect(picked).toBe(1)
    expect(net.calls[WHEEL_URL]).toBe(2)
  })
})
