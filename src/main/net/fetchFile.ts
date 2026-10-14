import { createHash } from 'node:crypto'
import { open, rename as fsRename, rm, stat, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { CancelledError } from '../ffmpeg/run'
import type { PackFile } from '@shared/sidecar/pack'

/**
 * Fetching a file over the network, tried again when the network fails and
 * never when the answer is wrong.
 *
 * Lifted out of `src/main/ingest/binary.ts` (docs/CLIPS.md §3a.3, "The
 * download"), which imports it back for yt-dlp. Two callers, two shapes:
 *
 *   - yt-dlp's fetch (`tryOnce`): a 30MB body into memory, then judged. Its
 *     lines on screen are kept word for word: the retry's line says "GitHub",
 *     and its errors name the URL it asked for (`naming: { who: 'GitHub' }`).
 *   - the AI helper's pack (`fetchVerified`): 49 files, each streamed to disk
 *     through a hash and a byte count, with its own retry budget, the job's
 *     signal in every request, and every failure naming the HOST that failed,
 *     after its redirects, so a files.pythonhosted.org failure does not read
 *     as GitHub's.
 */

/**
 * How the fetch waits, and tries again (docs/INGEST.md, "When GitHub has a bad minute").
 *
 * GitHub has bad minutes: on 2026-10-07 it answered "Internal Server Error" to
 * pushes, and the Windows CI run of that hour (37655072539) went red where the
 * same code re-run (37655616322) was green — most likely this fetch; the red
 * run's log could not be read. One try meant one 500 was a failed first
 * download for a user, and a red build for us.
 *
 * So each network step is tried again when the failure is the NETWORK's: a
 * dropped, refused, unresolved or stalled connection, a 5xx, 429 or 408, or a
 * body that ended short. Never when it is the ANSWER's: a 404 is a release
 * without that asset, and a checksum mismatch is a file that must not be used,
 * however many times it is downloaded. Those fail on the first try.
 */
export interface FetchRetry {
  /** Tries per network step, the first included. */
  attempts: number
  /** The wait before the second try; each later wait is double the one before. */
  firstDelayMs: number
  /**
   * The fetch's time for TRYING, from its start: no wait starts that would end
   * past it, and no try waits for an answer past it. It does NOT stop a body
   * that is still arriving. A slow link that is moving finishes, however long
   * it takes, as it did before there was a retry; a body that stops moving is
   * `idleMs`'s. So a first download on a slow home connection is not cut off
   * at a total time — the cost is that a body still moving has no ceiling,
   * which on a runner's link never matters.
   *
   * The default is the two answer waits added up, the 60 s and 300 s the
   * yt-dlp fetch was always planned around. The pack's files each get their
   * own (`fetchVerified`: one `Fetching` per call).
   */
  budgetMs: number
  /** How long one try at yt-dlp's checksums waits for an answer. */
  checksumsAnswerMs: number
  /** How long one try at a binary (yt-dlp, or one of the pack's files) waits for an answer. */
  binaryAnswerMs: number
  /**
   * How long a body may send nothing at all before the try is a stall, and is
   * tried again. Timed from the answer, then from each chunk.
   */
  idleMs: number
}

/**
 * Four tries over about a minute: waits of 8, 16 and 32 s.
 *
 * `idleMs` is a minute of NOTHING, not a minute of slowness: at 10 kbit/s a
 * link still delivers a packet every second or two. Before the retry the only
 * body limit was undici's own 300 s idle timeout, which would leave a stall no
 * time inside the budget for the try it should buy — and the integration
 * hooks' arithmetic (tests/integration/exactCut, ytdlpFormat: 600 s) is 45 s
 * locating + 360 s + 60 s + 15 s to run it = 480 s, where 300 s would be 720 s.
 */
export const FETCH_RETRY: Readonly<FetchRetry> = {
  attempts: 4,
  firstDelayMs: 8_000,
  budgetMs: 60_000 + 5 * 60_000,
  checksumsAnswerMs: 60_000,
  // Sized once for the ~30MB arriving, but only ever a wait for the answer: the
  // old timer was cleared when the headers came, as this one is.
  binaryAnswerMs: 5 * 60_000,
  idleMs: 60_000
}

/**
 * The codes a dropped, refused, unresolved or stalled connection carries.
 *
 * Read off the error's `cause` chain, because fetch reports every one of them
 * as a bare `TypeError: fetch failed` — or `terminated`, when it breaks off
 * mid-body — with the real reason underneath. Measured for ENOTFOUND (node
 * 24.18, the sandbox's unreachable DNS): `fetch failed`, then an Error with
 * `code: 'ENOTFOUND'`. A reset could not be measured here (the sandbox refuses
 * to listen on any socket); undici's lib/web/fetch/index.js wraps it the same
 * way. The UND_ERR_ ones are undici's own: its connect, header and body
 * timeouts and a socket closed under it.
 */
export const NETWORK_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT'
])

/** The host a URL names, for a sentence: `files.pythonhosted.org`. The URL itself when it will not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url
  } catch {
    return url
  }
}

/** An answer that was not a success. Its status decides whether another try can help. */
export class HttpStatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The host that answered, after the redirects. */
    readonly host: string
  ) {
    super(message)
    this.name = 'HttpStatusError'
  }
}

/** No answer within one try's wait for it — a stall, which another try can cure. */
export class NoAnswerError extends Error {
  constructor(
    message: string,
    readonly host: string
  ) {
    super(message)
    this.name = 'NoAnswerError'
  }
}

/** A body that stopped arriving for `idleMs` — the same stall, mid-transfer. */
export class WentQuietError extends Error {
  constructor(
    message: string,
    readonly host: string
  ) {
    super(message)
    this.name = 'WentQuietError'
  }
}

/**
 * The connection failed before an answer, or broke off in the body. Another try
 * helps only when its cause carries a network code (`networkCode`).
 */
export class ConnectionError extends Error {
  constructor(
    message: string,
    readonly host: string,
    options: { cause: unknown }
  ) {
    super(message, options)
    this.name = 'ConnectionError'
  }
}

/**
 * A body that ended before the bytes the manifest says the file has: a broken
 * transfer (a proxy closing a chunked body, a CDN hiccup). Tried again.
 */
export class ShortBodyError extends Error {
  constructor(
    message: string,
    readonly host: string
  ) {
    super(message)
    this.name = 'ShortBodyError'
  }
}

/**
 * What arrived is not the file: a Content-Length other than its bytes, a body
 * that ran past them, or exactly its bytes with another sha256. Never tried
 * again — asking again until it comes out right is what a checksum exists to
 * prevent.
 */
export class NotTheFileError extends Error {
  constructor(
    message: string,
    readonly host: string,
    readonly kind: 'length' | 'overrun' | 'checksum'
  ) {
    super(message)
    this.name = 'NotTheFileError'
  }
}

/** Whether another try could cure this. */
export function transient(err: unknown): boolean {
  if (err instanceof HttpStatusError) {
    return err.status >= 500 || err.status === 429 || err.status === 408
  }
  if (err instanceof NoAnswerError) return true
  if (err instanceof WentQuietError) return true
  if (err instanceof ShortBodyError) return true
  if (err instanceof NotTheFileError) return false
  return networkCode(err) !== null
}

/** A duration for a message: the app's are whole seconds; a test's, or a wait cut by the budget, may not be. */
export function secs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${Math.round(ms / 1000)}s`
}

export function networkCode(err: unknown): string | null {
  let e: unknown = err
  for (let depth = 0; e && typeof e === 'object' && depth < 8; depth++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string' && NETWORK_CODES.has(code)) return code
    e = (e as { cause?: unknown }).cause
  }
  return null
}

/**
 * What went wrong, in words. `fetch failed` on its own names nothing — it was
 * the whole of the reason a network failure gave — so the cause comes with it.
 */
export function reasonOf(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = err.cause as { message?: unknown; code?: unknown } | undefined
  const detail =
    cause && typeof cause === 'object'
      ? typeof cause.message === 'string' && cause.message
        ? cause.message
        : typeof cause.code === 'string'
          ? cause.code
          : ''
      : ''
  return detail && !err.message.includes(detail) ? `${err.message} (${detail})` : err.message
}

/** A wait the caller's cancel cuts short. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError())
    const done = (): void => {
      signal?.removeEventListener('abort', cancel)
      resolve()
    }
    const cancel = (): void => {
      clearTimeout(timer)
      reject(new CancelledError())
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

/**
 * How a failure is named.
 *
 * `'host'` (the pack's files): the retry's line and every error name the host
 * that failed, after its redirects: "files.pythonhosted.org answered 503",
 * "release-assets.githubusercontent.com did not answer".
 *
 * `{ who }` (yt-dlp's fetch, `who: 'GitHub'`): its lines as they were before
 * this module existed — the retry's line says `who`, its errors name the URL it
 * asked for. Kept so nothing a yt-dlp user reads changed in the lift.
 */
export type FetchNaming = 'host' | { who: string }

/** One fetch's limits: a budget, a signal, a clock and a fetch. */
export interface Fetching {
  retry: FetchRetry
  /** When the budget for trying is spent, on `now`'s clock. */
  endsAt: number
  /** The caller's cancel. It goes into every request, so it stops the transfer itself. */
  signal?: AbortSignal
  onMessage?: (message: string) => void
  /** The budget's clock: `Date.now` in the app, a test's own to pass minute 6. */
  now: () => number
  fetch: typeof globalThis.fetch
  /**
   * `'follow'` leaves redirects to fetch, as yt-dlp's always did. `'by hand'`
   * follows each hop here (at most `MAX_REDIRECTS`), so a hop that never
   * answers is named by its own host — the interpreter's github.com hands off
   * to release-assets.githubusercontent.com, and a filter that blocks only the
   * second must not read as github.com's silence. Node's fetch hands a
   * `redirect: 'manual'` answer back with its status and Location (undici's
   * lib/web/fetch/index.js, "Not compliant on purpose", nodejs/undici#1193).
   */
  redirects: 'follow' | 'by hand'
  naming: FetchNaming
}

/** Redirects followed by hand before the fetch gives up: fetch's own limit is 20; GitHub uses one. */
export const MAX_REDIRECTS = 10

/** A `Fetching` whose budget starts now. */
export function beginFetching(
  retry: FetchRetry,
  o: Omit<Fetching, 'retry' | 'endsAt'>
): Fetching {
  return { retry, endsAt: o.now() + retry.budgetMs, ...o }
}

/** What one try does with the answer and its body. Each may throw to refuse what arrived. */
interface BodySink {
  /** The answer's headers, before any of the body: a Content-Length that is not the file stops it here. */
  answered?(response: Response, host: string): void
  /** Every chunk, in order, as it arrives. */
  chunk(bytes: Uint8Array, host: string): void | Promise<void>
  /** The body ended. */
  ended?(host: string): void | Promise<void>
}

/** A refusal from the sink: kept apart from the transfer's own failures, so it is never mistaken for one. */
class Refused {
  constructor(readonly error: unknown) {}
}

/**
 * One try at one URL: the answer, then the whole body into `sink`, or why not.
 *
 * Three stops, kept apart because they mean different things. The caller's
 * cancel reports nothing (a `CancelledError`). No answer within `answerMs` —
 * this try's wait, which `withRetry` cuts to what is left of the budget — is a
 * stall. A body that sends nothing for `idleMs` is a stall too. Another try may
 * follow either. And a sink that refuses what arrived aborts the request at
 * once: the rest of a body that is not the file is never read.
 *
 * Time on its own is NOT a stop. A body still arriving runs to its end, as it
 * did before the retry: the answer's timer is cleared when the headers come,
 * and the idle timer starts again at every chunk. (For one version the budget
 * stayed on through the body, and a first download on a link under ~0.85
 * Mbit/s — 37 MB in what was left of 360 s — could never finish.)
 */
export async function tryInto(url: string, answerMs: number, f: Fetching, sink: BodySink): Promise<void> {
  if (f.signal?.aborted) throw new CancelledError()

  const answer = new AbortController()
  const quiet = new AbortController()
  const refuse = new AbortController()
  const signals = [answer.signal, quiet.signal, refuse.signal]
  if (f.signal) signals.push(f.signal)
  const combined = AbortSignal.any(signals)
  const legacy = f.naming !== 'host'
  // Where the try is: the URL asked for, then each hop of a redirect followed by hand.
  let at = url
  const label = (): string => (legacy ? url : hostOf(at))
  const stop = (): Error | null => {
    if (f.signal?.aborted) return new CancelledError()
    if (answer.signal.aborted) return new NoAnswerError(`${label()} did not answer within ${secs(answerMs)}`, hostOf(at))
    if (quiet.signal.aborted) return new WentQuietError(`${label()} sent nothing for ${secs(f.retry.idleMs)}`, hostOf(at))
    return null
  }

  let response: Response
  const answerTimer = setTimeout(() => answer.abort(), answerMs)
  try {
    for (let hop = 0; ; hop++) {
      try {
        response = await f.fetch(at, { signal: combined, redirect: f.redirects === 'follow' ? 'follow' : 'manual' })
      } catch (err) {
        throw stop() ?? new ConnectionError(`${label()} could not be reached: ${reasonOf(err)}`, hostOf(at), { cause: err })
      }
      const location = response.headers.get('location')
      if (f.redirects === 'follow' || response.status < 300 || response.status > 399 || !location) break
      await response.body?.cancel().catch(() => undefined)
      if (hop >= MAX_REDIRECTS) throw new Error(`${hostOf(at)} redirected more than ${MAX_REDIRECTS} times`)
      const next = new URL(location, at)
      // The manifest's URLs are https, and so is every hop GitHub makes; a hop down to http is not followed.
      if (next.protocol !== 'https:') throw new Error(`${hostOf(at)} redirected to ${next.protocol}//${next.hostname}, which is not https`)
      at = next.toString()
    }
  } finally {
    clearTimeout(answerTimer)
  }
  // With 'follow', where fetch ended up (an empty `url` is a constructed Response, as in a test).
  if (f.redirects === 'follow' && response.url) at = response.url
  const host = hostOf(at)
  if (!response.ok) {
    // Let the connection go before another try opens a new one.
    await response.body?.cancel().catch(() => undefined)
    throw new HttpStatusError(`${label()} answered ${response.status}`, response.status, host)
  }

  // The body, for as long as it keeps coming.
  const reader = response.body?.getReader()
  const idleTimer = setTimeout(() => quiet.abort(), f.retry.idleMs)
  // A cancel releases a read that is waiting, whatever the fetch does with its signal.
  const onCancel = (): void => {
    reader?.cancel().catch(() => undefined)
  }
  f.signal?.addEventListener('abort', onCancel, { once: true })
  try {
    try {
      sink.answered?.(response, host)
    } catch (err) {
      throw new Refused(err)
    }
    while (reader) {
      const { done, value } = await reader.read()
      if (f.signal?.aborted) throw new CancelledError()
      if (done) break
      idleTimer.refresh()
      try {
        await sink.chunk(value, host)
      } catch (err) {
        throw new Refused(err)
      }
    }
    if (f.signal?.aborted) throw new CancelledError()
    try {
      await sink.ended?.(host)
    } catch (err) {
      throw new Refused(err)
    }
  } catch (err) {
    if (err instanceof Refused) {
      // Not the file: stop the transfer now, rather than read what is left of it.
      refuse.abort()
      await reader?.cancel().catch(() => undefined)
      throw err.error
    }
    if (err instanceof CancelledError) throw err
    throw stop() ?? new ConnectionError(`${label()} broke off: ${reasonOf(err)}`, host, { cause: err })
  } finally {
    clearTimeout(idleTimer)
    f.signal?.removeEventListener('abort', onCancel)
  }
}

/** One try, the whole body in memory: yt-dlp's checksums and its binary. */
export async function tryOnce(url: string, answerMs: number, f: Fetching): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  await tryInto(url, answerMs, f, { chunk: (bytes) => void chunks.push(bytes) })
  return Buffer.concat(chunks)
}

/** The failure, short, for the line on screen while the next try waits. */
export function shortReason(err: unknown, naming: FetchNaming): string {
  const host = (err as { host?: unknown }).host
  const who = naming === 'host' ? (typeof host === 'string' ? host : 'the server') : naming.who
  if (err instanceof HttpStatusError) return `${who} answered ${err.status}`
  if (err instanceof NoAnswerError) return `${who} did not answer`
  if (naming !== 'host') {
    // yt-dlp's lines, as they were.
    if (err instanceof WentQuietError) return 'the transfer stopped'
    return `the connection failed (${networkCode(err) ?? 'network error'})`
  }
  if (err instanceof WentQuietError) return `${who} stopped sending`
  if (err instanceof ShortBodyError) return `${who} sent only part of the file`
  return `the connection to ${who} failed (${networkCode(err) ?? 'network error'})`
}

/**
 * One network step, tried again while the failure is the network's.
 *
 * Anything else — a 404, a file that is not the file, a cancel — goes straight
 * out, on the try it happened. When the tries or the budget run out, the error
 * is the LAST try's own reason, with how many tries it took: "fetch failed" or
 * "answered 503" alone could not tell a hiccup from an outage. The budget gates
 * only what starts here — a wait, and how long the next try waits for its
 * answer — never a body in progress.
 */
export async function withRetry<T>(
  step: string,
  once: (answerMs: number) => Promise<T>,
  answerMs: number,
  f: Fetching
): Promise<T> {
  const started = f.now()
  let delay = f.retry.firstDelayMs
  for (let tried = 1; ; tried++) {
    try {
      return await once(Math.max(1, Math.min(answerMs, f.endsAt - f.now())))
    } catch (err) {
      if (!transient(err)) throw err
      const outOfTries = tried >= f.retry.attempts
      const outOfTime = f.now() + delay >= f.endsAt
      if (outOfTries || outOfTime) {
        if (tried === 1 && outOfTries) throw err
        const tries = tried === 1 ? '1 try' : `${tried} tries`
        const seconds = Math.round((f.now() - started) / 1000)
        const why = outOfTries ? '' : `, with no time left in the fetch's ${secs(f.retry.budgetMs)} for another`
        throw new Error(`${reasonOf(err)} — gave up after ${tries} over ${seconds}s${why}`, { cause: err })
      }
      f.onMessage?.(
        `${step}: ${shortReason(err, f.naming)}, trying again in ${Math.ceil(delay / 1000)}s (${tried + 1} of ${f.retry.attempts})`
      )
      await sleep(delay, f.signal)
      delay *= 2
    }
  }
}

/* ------------------------------------------------------------ the pack's files */

/**
 * The way out, when the pack's hosts cannot be reached (§3a.5, "Offline").
 * `FORGE_PYTHON` is the escape hatch `resolveHelperPython` keeps in a packaged app.
 */
export const PACK_FETCH_WAY_OUT =
  "If this machine cannot reach github.com and files.pythonhosted.org, point FORGE_PYTHON at a Python with the helper's requirements."

/** What `fetchVerified` is given for ONE file (`FetchVerifiedDeps` in src/main/sidecar/installTypes.ts). */
export interface FetchVerifiedOptions {
  fetch: typeof globalThis.fetch
  retry: FetchRetry
  signal: AbortSignal
  now(): number
  /** `renameWithRetry` in the app; a test's may refuse. */
  rename(from: string, to: string): Promise<void>
  /** Every chunk's length as it streams, for the bar and the speed. */
  onBytes(n: number): void
  onMessage?(message: string): void
}

/** The sha256 of a file on disk, streamed: a 43 MB wheel is never held whole. */
async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256')
  const fh = await open(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(1 << 20)
    for (;;) {
      const { bytesRead } = await fh.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    await fh.close()
  }
  return hash.digest('hex')
}

/** Whether `<dir>/<name>` is already the file: its size, then its hash. */
async function alreadyThere(path: string, file: PackFile): Promise<boolean> {
  try {
    const st = await stat(path)
    if (!st.isFile() || st.size !== file.bytes) return false
  } catch {
    return false
  }
  return (await sha256Of(path)) === file.sha256
}

/** Every byte of `bytes` into the file: a write may take fewer than it was given. */
async function writeAll(fh: FileHandle, bytes: Uint8Array): Promise<void> {
  let at = 0
  while (at < bytes.length) {
    const { bytesWritten } = await fh.write(bytes, at, bytes.length - at)
    at += bytesWritten
  }
}

/**
 * One try at one of the pack's files: streamed into `part`, hashed and counted
 * as it arrives, and judged against the manifest (§3a.3 stage 1's table):
 *
 * | what arrived                      | what happens                             |
 * |-----------------------------------|------------------------------------------|
 * | a Content-Length other than bytes | not the file: no retry                   |
 * | a body short of bytes             | a broken transfer: dropped, tried again  |
 * | a body past bytes                 | not the file: aborted at once, no retry  |
 * | exactly bytes, another sha256     | the checksum failure: no retry           |
 * | exactly bytes, the sha256         | the file                                 |
 */
async function tryToFile(
  file: PackFile,
  part: string,
  answerMs: number,
  f: Fetching,
  onBytes: (n: number) => void
): Promise<string> {
  const fh = await open(part, 'w')
  const hash = createHash('sha256')
  let received = 0
  /** The host that sent the file, after its redirects: what the job's log names (§3a.5). */
  let from = ''
  try {
    await tryInto(file.url, answerMs, f, {
      answered(response, host) {
        const length = response.headers.get('content-length')
        const encoding = response.headers.get('content-encoding')
        // A Content-Length under a Content-Encoding counts the encoded bytes, not the file's; the
        // count and the hash below still judge what is decoded.
        const plain = !encoding || encoding.toLowerCase() === 'identity'
        if (length !== null && plain && Number(length) !== file.bytes) {
          throw new NotTheFileError(
            `something other than the file arrived from ${host} (a sign-in page or a network filter?): ${file.name} is ${file.bytes} B and the answer said ${length}`,
            host,
            'length'
          )
        }
      },
      async chunk(bytes, host) {
        received += bytes.length
        if (received > file.bytes) {
          throw new NotTheFileError(
            `more than ${file.name}'s ${file.bytes} B arrived from ${host}, so it is not the file`,
            host,
            'overrun'
          )
        }
        hash.update(bytes)
        await writeAll(fh, bytes)
        onBytes(bytes.length)
      },
      ended(host) {
        if (received < file.bytes) {
          throw new ShortBodyError(`${host} sent ${received} of ${file.name}'s ${file.bytes} B`, host)
        }
        const actual = hash.digest('hex')
        if (actual !== file.sha256) {
          throw new NotTheFileError(
            `${file.name} from ${host} did not match its published checksum (${actual.slice(0, 12)}… vs ${file.sha256.slice(0, 12)}…)`,
            host,
            'checksum'
          )
        }
        from = host
      }
    })
  } catch (err) {
    await fh.close().catch(() => undefined)
    // The try's bytes go with it: the next try starts the file again.
    await rm(part, { force: true }).catch(() => undefined)
    throw err
  }
  await fh.close()
  return from
}

/**
 * The worded failure for one of the pack's files. The way out comes with every
 * failure that could be this machine's network — a host that would not answer,
 * a filter's page — and not with a checksum mismatch, which names the file and
 * its host and nothing else.
 */
function packFailure(file: PackFile, err: unknown): Error {
  const reason = reasonOf(err)
  const checksum = err instanceof NotTheFileError && err.kind === 'checksum'
  const message = checksum
    ? `${reason}. Nothing was installed from it.`
    : `${file.name} could not be downloaded: ${reason}. ${PACK_FETCH_WAY_OUT}`
  return new Error(message, { cause: err })
}

/**
 * Stream one of the pack's files into `dir` as `<name>.part`, hashed and
 * counted as it arrives, renamed to `<name>` (pip reads a wheel's tags from its
 * filename) only when it is the file; resolves with that path.
 *
 * A file already at `<dir>/<name>` with its hash is not fetched at all, so a
 * cancelled or failed install resumes file by file; one there with another hash
 * is deleted and fetched again. One `Fetching` — one retry budget — per call: a
 * 205 MB install on a slow line passes minute 6 part-way, and a budget shared
 * across files would leave every later file a 1 ms answer wait and no retry.
 *
 * The job's signal goes into every request and stops the transfer itself, not
 * only the waiting: `ensureYtDlp`'s shared fetch, which carries no caller's
 * signal, is not this. A cancel removes the `.part` and keeps what is verified.
 */
export async function fetchVerified(file: PackFile, dir: string, f: FetchVerifiedOptions): Promise<string> {
  if (f.signal.aborted) throw new CancelledError()
  const final = join(dir, file.name)
  if (await alreadyThere(final, file)) return final
  // Whatever is there is not the file.
  await rm(final, { force: true })

  const part = `${final}.part`
  const fetching = beginFetching(f.retry, {
    signal: f.signal,
    onMessage: f.onMessage,
    now: f.now,
    fetch: f.fetch,
    redirects: 'by hand',
    naming: 'host'
  })
  let host: string
  try {
    host = await withRetry(
      `downloading ${file.name}`,
      (answerMs) => tryToFile(file, part, answerMs, fetching, f.onBytes),
      f.retry.binaryAnswerMs,
      fetching
    )
  } catch (err) {
    await rm(part, { force: true }).catch(() => undefined)
    if (f.signal.aborted || (err instanceof Error && err.name === 'CancelledError')) throw new CancelledError()
    throw packFailure(file, err)
  }

  try {
    await f.rename(part, final)
  } catch (err) {
    await rm(part, { force: true }).catch(() => undefined)
    throw new Error(`${file.name} arrived whole but could not be moved into place: ${reasonOf(err)}`, { cause: err })
  }
  // Where it came from after its redirects, so a tester's report names the host a network let through (§3a.5).
  f.onMessage?.(`${file.name} came from ${host}: ${file.bytes} B, its sha256 verified`)
  return final
}

/* ------------------------------------------------------------ renames on Windows */

/** The codes a scanner holding a just-closed file gives a rename on Windows. */
const RENAME_BUSY = new Set(['EPERM', 'EACCES', 'EBUSY'])

/**
 * The rename's tries on win32: 10, with waits of 50 ms doubling to a 2 s cap —
 * 50, 100, 200, 400, 800, 1,600, 2,000, 2,000 and 2,000 ms, 9.15 s in all.
 *
 * graceful-fs 4.2.11 (`polyfills.js:96-123`) retries the same three codes for
 * up to 60 s, for "Parity bit9, [which] may lock files for up to a minute"
 * during an npm install nobody is watching. This one runs under a bar a person
 * is watching, 49 times in one install plus the receipt: the holder it is for
 * is Defender's on-access scan of a file that was just closed, which the
 * largest of them (llvmlite's 42,986,588 B wheel) should not hold for seconds
 * on end. Ten seconds outlasts that by a wide margin and still fails a file
 * held for good while the person is looking at the bar, not a minute later.
 * Unmeasured: §3a.8 row 27 on the Surface sets it.
 */
export const RENAME_RETRY = { attempts: 10, firstDelayMs: 50, maxDelayMs: 2_000 } as const

/**
 * `fs.rename`, tried again on win32 when a scanner holds the file (`EPERM`,
 * `EACCES`, `EBUSY`), bounded, with backoff (`RENAME_RETRY`). Elsewhere one
 * try: no scanner on the Mac holds a file against a rename.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  o: {
    platform?: NodeJS.Platform
    attempts?: number
    sleep?: (ms: number) => Promise<void>
    /** The rename itself, for a test to refuse. */
    rename?: (from: string, to: string) => Promise<void>
  } = {}
): Promise<void> {
  const platform = o.platform ?? process.platform
  const attempts = platform === 'win32' ? (o.attempts ?? RENAME_RETRY.attempts) : 1
  const wait = o.sleep ?? ((ms: number) => sleep(ms))
  const move = o.rename ?? fsRename
  let delay: number = RENAME_RETRY.firstDelayMs
  for (let tried = 1; ; tried++) {
    try {
      return await move(from, to)
    } catch (err) {
      const code = (err as { code?: unknown }).code
      if (tried >= attempts || typeof code !== 'string' || !RENAME_BUSY.has(code)) throw err
      await wait(delay)
      delay = Math.min(delay * 2, RENAME_RETRY.maxDelayMs)
    }
  }
}
