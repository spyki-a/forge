import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureYtDlp, FETCH_RETRY } from '../src/main/ingest/binary'
import { CHECKSUMS_ASSET, installedName, releaseAsset, releaseUrl } from '@shared/ingest/release'

/*
 * The yt-dlp fetch when GitHub has a bad minute (docs/INGEST.md, "When GitHub
 * has a bad minute").
 *
 * Windows CI run 37655072539 went red where the same code, re-run as
 * 37655616322, was green, in an hour GitHub was answering "Internal Server
 * Error". The fetch tried once. It now tries each network step — the checksums,
 * then the binary — again on a network failure, a 5xx/429/408, no answer, or a
 * body gone silent, and never on a 404 or a checksum mismatch, which are real.
 * Its budget is for trying: a body still arriving is never cut off by it.
 *
 * GitHub here is a fake `fetch`, counting its calls per URL; everything else is
 * `ensureYtDlp` as the app runs it, into a temp userData — `refresh`, so a
 * yt-dlp already on this machine's PATH cannot answer instead, except in the
 * one test that empties PATH to be a job's ordinary call. The policy's times
 * are injected in milliseconds; one test runs the defaults, and one holds them
 * to ranges.
 *
 * A network failure is faked in the shape fetch gives it: `TypeError: fetch
 * failed` with the socket's error, and its code, as the cause. That shape was
 * measured for ENOTFOUND (binary.ts, NETWORK_CODES); a reset could not be, as
 * the sandbox will not listen on a socket, and undici wraps it the same way.
 */

const WINDOWS = process.platform === 'win32'
const ASSET = releaseAsset(process.platform, process.arch)!
const SUMS_URL = releaseUrl(CHECKSUMS_ASSET)
const BINARY_URL = releaseUrl(ASSET)

/**
 * What the "release" installs: something that answers `--version`. The managed
 * copy is run with no shell, so on Windows it has to be a real exe — node's own,
 * which answers with node's version. Elsewhere a two-line script.
 */
let standIn: Buffer
let standInVersion: string

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/**
 * A reply from the fake GitHub: a success, a reset, an HTTP status, no answer at all (`silent`), a
 * body that starts and then sends nothing (`stall`), or the binary arriving slowly but steadily
 * (`trickle`).
 */
type Reply = 'ok' | 'reset' | number | 'silent' | 'stall' | 'trickle'

/** `trickle`: the binary in this many pieces, this far apart — about a second in all. */
const TRICKLE = { pieces: 12, gapMs: 80 }

interface Fake {
  calls: { sums: number; binary: number }
}

/**
 * GitHub, scripted: the n-th call to each URL gets the n-th reply, and every
 * call past the script gets a success. `publishedSha` is what the checksum file
 * says the binary hashes to.
 */
function fakeGitHub(script: { sums?: Reply[]; binary?: Reply[] }, publishedSha = sha256(standIn)): Fake {
  const fake: Fake = { calls: { sums: 0, binary: 0 } }
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit): Promise<Response> => {
    const which = input === SUMS_URL ? 'sums' : input === BINARY_URL ? 'binary' : null
    if (!which) throw new Error(`the fake GitHub was asked for ${input}`)
    const reply = script[which]?.[fake.calls[which]] ?? 'ok'
    fake.calls[which]++
    // As fetch does: a signal already stopped stops the request before it starts.
    if (init?.signal?.aborted) throw init.signal.reason
    if (reply === 'reset') {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('read ECONNRESET'), { errno: -54, code: 'ECONNRESET', syscall: 'read' })
      })
    }
    if (typeof reply === 'number') return new Response('Internal Server Error', { status: reply })
    if (reply === 'silent') {
      // No answer until the signal stops the request; fetch then rejects with the signal's reason.
      const signal = init?.signal
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    if (reply === 'trickle') {
      // Slow, never quiet: a piece every TRICKLE.gapMs, stopped only by the signal, as fetch's body is.
      const signal = init?.signal
      const bytes = new Uint8Array(standIn)
      // Exactly TRICKLE.pieces, none empty, whatever the stand-in's size (26 bytes here, ~90 MB on Windows).
      const cut = (i: number): number => Math.floor((i * bytes.length) / TRICKLE.pieces)
      let piece = 0
      let stopped = false
      return new Response(
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
            await new Promise((resolve) => setTimeout(resolve, TRICKLE.gapMs))
            if (stopped) return
            if (piece >= TRICKLE.pieces) return controller.close()
            controller.enqueue(bytes.subarray(cut(piece), cut(piece + 1)))
            piece++
          }
        })
      )
    }
    if (reply === 'stall') {
      // The answer arrives; the body sends a little and then nothing, until the signal stops it — as
      // fetch's own body does when its signal aborts.
      const signal = init?.signal
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(16))
            signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true })
          }
        })
      )
    }
    return which === 'sums'
      ? new Response(`${publishedSha}  ${ASSET}\n${'0'.repeat(64)}  some-other-asset\n`)
      : new Response(new Uint8Array(standIn))
  })
  return fake
}

/** The fetch, rejected, as its error. Fails if it resolved. */
async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (err) {
    return err as Error
  }
  throw new Error('expected the fetch to fail, and it returned a tool')
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  )
}

/** The default four tries, a millisecond apart, within a minute; the answer and idle waits are the defaults. */
const QUICK = { attempts: 4, firstDelayMs: 1, budgetMs: 60_000 }

let dir = ''
let managed = ''
const saved = { userData: process.env.FORGE_TEST_USERDATA, ytdlp: process.env.FORGE_YTDLP, path: process.env.PATH }

beforeAll(async () => {
  if (WINDOWS) {
    standIn = await readFile(process.execPath)
    standInVersion = process.version
  } else {
    standIn = Buffer.from('#!/bin/sh\necho 2026.10.07\n')
    standInVersion = '2026.10.07'
  }
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-ytdlp-fetch-'))
  process.env.FORGE_TEST_USERDATA = dir
  delete process.env.FORGE_YTDLP
  // The stub's userData is `<FORGE_TEST_USERDATA>/userData`; binary.ts puts its copy in `tools/`.
  managed = join(dir, 'userData', 'tools', installedName(process.platform))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  if (saved.userData === undefined) delete process.env.FORGE_TEST_USERDATA
  else process.env.FORGE_TEST_USERDATA = saved.userData
  if (saved.ytdlp === undefined) delete process.env.FORGE_YTDLP
  else process.env.FORGE_YTDLP = saved.ytdlp
  if (saved.path === undefined) delete process.env.PATH
  else process.env.PATH = saved.path
  // Retried, and not fatal: on Windows a scanner can hold a just-run exe for a moment.
  await rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined)
})

describe('the yt-dlp fetch tries again when the network fails', () => {
  it('a connection reset twice on the checksums, then an answer: three tries, and the tool', async () => {
    const gh = fakeGitHub({ sums: ['reset', 'reset'] })
    const messages: string[] = []
    const tool = await ensureYtDlp((m) => messages.push(m), { refresh: true, retry: QUICK })

    expect(gh.calls).toEqual({ sums: 3, binary: 1 })
    expect(tool.source).toBe('managed')
    expect(tool.version).toBe(standInVersion)
    expect(basename(tool.path)).toBe(installedName(process.platform))
    expect(await exists(managed)).toBe(true)
    // Each wait is said on screen, with what failed.
    const waits = messages.filter((m) => m.includes('trying again'))
    expect(waits).toHaveLength(2)
    expect(waits[0]).toContain('ECONNRESET')
    expect(waits[0]).toContain('2 of 4')
  })

  it('503 twice on the binary, then 200: three tries, and the tool', async () => {
    const gh = fakeGitHub({ binary: [503, 503] })
    const messages: string[] = []
    const tool = await ensureYtDlp((m) => messages.push(m), { refresh: true, retry: QUICK })

    expect(gh.calls).toEqual({ sums: 1, binary: 3 })
    expect(tool.source).toBe('managed')
    expect(tool.version).toBe(standInVersion)
    expect(await exists(managed)).toBe(true)
    expect(messages.filter((m) => m.includes('trying again') && m.includes('answered 503'))).toHaveLength(2)
  })

  it('a 429, a 408 and a 500 are tried again too', async () => {
    const gh = fakeGitHub({ sums: [429, 408], binary: [500] })
    const tool = await ensureYtDlp(undefined, { refresh: true, retry: QUICK })
    expect(gh.calls).toEqual({ sums: 3, binary: 2 })
    expect(tool.version).toBe(standInVersion)
  })

  it('no answer within the try’s wait is a stall, and tried again', async () => {
    const gh = fakeGitHub({ sums: ['silent', 'silent'] })
    const messages: string[] = []
    const tool = await ensureYtDlp((m) => messages.push(m), {
      refresh: true,
      retry: { ...QUICK, checksumsAnswerMs: 30 }
    })

    expect(gh.calls).toEqual({ sums: 3, binary: 1 })
    expect(tool.version).toBe(standInVersion)
    expect(messages.filter((m) => m.includes('GitHub did not answer, trying again'))).toHaveLength(2)
  })

  it('a body that stops arriving is a stall, and tried again', async () => {
    const gh = fakeGitHub({ binary: ['stall'] })
    const messages: string[] = []
    const tool = await ensureYtDlp((m) => messages.push(m), { refresh: true, retry: { ...QUICK, idleMs: 100 } })

    expect(gh.calls).toEqual({ sums: 1, binary: 2 })
    expect(tool.version).toBe(standInVersion)
    expect(messages.filter((m) => m.includes('the transfer stopped, trying again'))).toHaveLength(1)
  }, 10_000)
})

describe('the policy the app runs', () => {
  it('the defaults, with only the first wait shortened: four tries, merged field by field', async () => {
    // Every other test passes a whole policy; this one is FETCH_RETRY's own attempts, budget,
    // answer waits and idle timer, through ensureYtDlp's merge of a partial override.
    const gh = fakeGitHub({ sums: ['reset', 'reset', 'reset'] })
    const messages: string[] = []
    const tool = await ensureYtDlp((m) => messages.push(m), { refresh: true, retry: { firstDelayMs: 1 } })

    expect(gh.calls).toEqual({ sums: 4, binary: 1 })
    expect(tool.version).toBe(standInVersion)
    const waits = messages.filter((m) => m.includes('trying again'))
    expect(waits).toHaveLength(3)
    expect(waits[2]).toContain('(4 of 4)')
  })

  it('tries enough, over about a minute, inside what the integration hooks allow', () => {
    const p = FETCH_RETRY
    // Ranges, not the numbers: any policy inside them does the job.
    expect(p.attempts).toBeGreaterThanOrEqual(3)
    const waits = p.firstDelayMs * (2 ** (p.attempts - 1) - 1)
    expect(waits).toBeGreaterThanOrEqual(30_000)
    expect(waits).toBeLessThanOrEqual(90_000)
    // Each step gets its whole wait for an answer at least once, and neither wait is a hair trigger.
    expect(p.budgetMs).toBeGreaterThanOrEqual(p.checksumsAnswerMs + p.binaryAnswerMs)
    expect(Math.min(p.checksumsAnswerMs, p.binaryAnswerMs)).toBeGreaterThanOrEqual(30_000)
    // Silence, not slowness: a link that pauses for seconds is not cut off.
    expect(p.idleMs).toBeGreaterThanOrEqual(30_000)
    // exactCut's and ytdlpFormat's 600 s hooks: three 15 s `--version` checks locating, the budget,
    // one body gone quiet at the end of it, and 15 s to run what arrived.
    expect(45_000 + p.budgetMs + p.idleMs + 15_000).toBeLessThanOrEqual(600_000)
  })
})

describe('what is real is not tried again', () => {
  it('a checksum mismatch: one download, the mismatch, nothing installed', async () => {
    // The release says the binary hashes to something it does not.
    const gh = fakeGitHub({}, sha256(Buffer.from('a different binary')))
    const err = await failure(ensureYtDlp(undefined, { refresh: true, retry: QUICK }))

    expect(gh.calls).toEqual({ sums: 1, binary: 1 })
    expect(err.message).toMatch(/^Downloads need yt-dlp, and it could not be fetched: /)
    expect(err.message).toContain('the download did not match its published checksum')
    expect(err.message).not.toContain('gave up')
    expect(await exists(managed)).toBe(false)
  })

  it('a 404: one try, and the 404', async () => {
    const gh = fakeGitHub({ binary: [404] })
    const err = await failure(ensureYtDlp(undefined, { refresh: true, retry: QUICK }))

    expect(gh.calls).toEqual({ sums: 1, binary: 1 })
    expect(err.message).toContain(`${BINARY_URL} answered 404`)
    expect(err.message).not.toContain('gave up')
    expect(await exists(managed)).toBe(false)
  })
})

describe('when it never works', () => {
  it('fails every time: exactly the tries allowed, and the LAST try’s own reason', async () => {
    // Three reasons, each different, so the message can only name the last by naming the last.
    const gh = fakeGitHub({ sums: [500, 'reset', 503, 502, 502] })
    const err = await failure(ensureYtDlp(undefined, { refresh: true, retry: { ...QUICK, attempts: 3 } }))

    expect(gh.calls).toEqual({ sums: 3, binary: 0 })
    expect(err.message).toMatch(/^Downloads need yt-dlp, and it could not be fetched: /)
    expect(err.message).toContain(`${SUMS_URL} answered 503 — gave up after 3 tries`)
    expect(err.message).not.toContain('answered 500')
    expect(err.message).not.toContain('ECONNRESET')
    // The way out is still spelled out.
    expect(err.message).toContain('FORGE_YTDLP')
  })

  it('a network failure names its cause, not just "fetch failed"', async () => {
    const gh = fakeGitHub({ sums: ['reset', 'reset'] })
    const err = await failure(ensureYtDlp(undefined, { refresh: true, retry: { ...QUICK, attempts: 2 } }))

    expect(gh.calls.sums).toBe(2)
    expect(err.message).toContain(`${SUMS_URL} could not be reached: fetch failed (read ECONNRESET) — gave up after 2 tries`)
  })

  it('waits the injected delays, each double the last', async () => {
    const gh = fakeGitHub({ sums: [503, 503, 503] })
    const started = performance.now()
    await failure(ensureYtDlp(undefined, { refresh: true, retry: { attempts: 3, firstDelayMs: 50, budgetMs: 60_000 } }))
    const elapsed = performance.now() - started

    expect(gh.calls.sums).toBe(3)
    // 50 + 100. Not doubling would be 100; the default's first wait alone is 8 s.
    expect(elapsed).toBeGreaterThanOrEqual(145)
    expect(elapsed).toBeLessThan(FETCH_RETRY.firstDelayMs / 2)
  })

  it('stops at the budget: no wait starts that would end past it', async () => {
    // Try 1 near 0, a 200 ms wait, try 2 near 200; the next wait, 400 ms, would end past 500. Wide
    // margins, so a slow runner's first try (anywhere under 300 ms) still gets exactly its second.
    const gh = fakeGitHub({ sums: [503, 503, 503, 503] })
    const err = await failure(ensureYtDlp(undefined, { refresh: true, retry: { attempts: 4, firstDelayMs: 200, budgetMs: 500 } }))

    expect(gh.calls.sums).toBe(2)
    expect(err.message).toContain('answered 503 — gave up after 2 tries')
    expect(err.message).toContain('with no time left')
  })

  it('a body silent every time: the tries allowed, and what stopped them', async () => {
    const gh = fakeGitHub({ binary: ['stall', 'stall'] })
    const err = await failure(ensureYtDlp(undefined, { refresh: true, retry: { ...QUICK, attempts: 2, idleMs: 100 } }))

    expect(gh.calls).toEqual({ sums: 1, binary: 2 })
    expect(err.message).toContain(`${BINARY_URL} sent nothing for 100 ms — gave up after 2 tries`)
    expect(await exists(managed)).toBe(false)
  }, 10_000)

  it('a cancel during the wait between tries ends the fetch at once, as a cancel', async () => {
    const gh = fakeGitHub({ sums: [503, 503] })
    const cancel = new AbortController()
    const started = performance.now()
    const err = await failure(
      ensureYtDlp(
        (m) => {
          // Once the wait has begun — a cancel already made before it is caught on the way in.
          if (m.includes('trying again')) setTimeout(() => cancel.abort(), 20)
        },
        { refresh: true, signal: cancel.signal, retry: { ...QUICK, firstDelayMs: 10_000 } }
      )
    )

    expect(err.name).toBe('CancelledError')
    expect(performance.now() - started).toBeLessThan(2_000)
    expect(gh.calls.sums).toBe(1)
  })
})

describe('the budget is for trying, not for a transfer', () => {
  it('a body that is slow but still moving finishes, however far past the budget', async () => {
    // The budget is for trying; a slow first download on a home link must not be cut off by it.
    // Each gap (80 ms) is far inside idleMs, and the whole transfer (~1 s) is past both idleMs and
    // the budget — so cutting the body at the budget, or never restarting the idle timer, fails here.
    const gh = fakeGitHub({ binary: ['trickle'] })
    const policy = { ...QUICK, budgetMs: 400, idleMs: 500 }
    const started = performance.now()
    const tool = await ensureYtDlp(undefined, { refresh: true, retry: policy })

    // Not vacuous: the transfer (13 pulls of 80 ms, ~1 s) really did outlast the budget and the idle
    // window. The margin is for timers, which can fire a millisecond early each.
    expect(performance.now() - started).toBeGreaterThan(Math.max(policy.budgetMs, policy.idleMs) + 200)
    expect(gh.calls).toEqual({ sums: 1, binary: 1 })
    expect(tool.version).toBe(standInVersion)
    expect(await exists(managed)).toBe(true)
  }, 10_000)
})

describe('a job that is not refreshing, as the app’s downloads call it', () => {
  it('stops waiting on its own cancel, while the shared fetch goes on for whoever else waits', async () => {
    // Not a refresh, so ensureYtDlp looks first: nothing in this userData, and a PATH with nothing
    // on it — this machine's own yt-dlp would otherwise answer and nothing would be fetched.
    process.env.PATH = dir
    const gh = fakeGitHub({ sums: [503, 503] })
    const cancel = new AbortController()
    const heard: string[] = []
    const err = await failure(
      ensureYtDlp(
        (m) => {
          heard.push(m)
          if (m.includes('trying again')) setTimeout(() => cancel.abort(), 20)
        },
        { signal: cancel.signal, retry: { ...QUICK, firstDelayMs: 300 } }
      )
    )

    // Out at once, as a cancel: the shared fetch is still in its first 300 ms wait.
    expect(err.name).toBe('CancelledError')
    expect(gh.calls).toEqual({ sums: 1, binary: 0 })

    // The fetch goes on. A second job joins it rather than starting its own, and gets the tool.
    const tool = await ensureYtDlp()
    expect(tool.source).toBe('managed')
    expect(tool.version).toBe(standInVersion)
    expect(gh.calls).toEqual({ sums: 3, binary: 1 })

    // And the cancelled job heard nothing after its cancel: its row is not written to again.
    expect(heard.filter((m) => m.includes('trying again'))).toHaveLength(1)
    expect(heard.some((m) => m.startsWith('downloading yt-dlp'))).toBe(false)
  }, 10_000)

  it('a job that JOINED the fetch stops waiting on its own cancel too, and the fetch goes on', async () => {
    process.env.PATH = dir
    const gh = fakeGitHub({ sums: [503] })
    let fetching!: () => void
    const inFlight = new Promise<void>((resolve) => (fetching = resolve))
    const first = ensureYtDlp(
      (m) => {
        if (m === 'checking the yt-dlp release') fetching()
      },
      { retry: { ...QUICK, firstDelayMs: 300 } }
    )
    await inFlight

    const cancel = new AbortController()
    const joined: string[] = []
    const err = await failure(
      ensureYtDlp(
        (m) => {
          joined.push(m)
          setTimeout(() => cancel.abort(), 20)
        },
        { signal: cancel.signal }
      )
    )

    // It joined (it did not start a fetch of its own), and left on its cancel, mid-wait.
    expect(joined).toEqual(['waiting for yt-dlp to finish downloading'])
    expect(err.name).toBe('CancelledError')
    expect(gh.calls).toEqual({ sums: 1, binary: 0 })
    // The job that started the fetch still gets the tool.
    const tool = await first
    expect(tool.version).toBe(standInVersion)
    expect(gh.calls).toEqual({ sums: 2, binary: 1 })
  }, 10_000)
})
