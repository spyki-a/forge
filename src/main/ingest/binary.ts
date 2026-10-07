import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { app } from 'electron'
import { CancelledError } from '../ffmpeg/run'
import {
  CHECKSUMS_ASSET,
  fetchFailureMessage,
  installedName,
  parseChecksums,
  releaseAsset,
  releaseUrl
} from '@shared/ingest/release'

/**
 * Finding, or fetching, yt-dlp.
 *
 * Three places it can come from, in this order:
 *
 *   1. `FORGE_YTDLP`   an explicit path — for development, and for anyone whose
 *                      machine cannot reach GitHub
 *   2. our own copy    `<userData>/tools/yt-dlp`, fetched on first use
 *   3. PATH            a copy the user already has, if we have none yet
 *
 * The managed copy sits above PATH because it is the one we can replace when
 * yt-dlp goes stale, which it does every few weeks. PATH is the fallback that
 * saves a download, not the preferred source.
 *
 * Every fetch is verified against the checksums yt-dlp publishes beside each
 * release. This is an executable being downloaded and run; nothing about that
 * is acceptable on trust. A transfer that meets a GitHub hiccup is tried again
 * (`FETCH_RETRY`); the verification never is.
 */

export type YtDlpSource = 'env' | 'managed' | 'path'

export interface YtDlpTool {
  path: string
  source: YtDlpSource
  /** As reported by `--version`, e.g. `2026.08.19`. Null if it would not say. */
  version: string | null
}

export interface YtDlpStatus {
  ready: boolean
  tool: YtDlpTool | null
  /** Why not, when not — written for the screen. */
  reason: string | null
}

const VERSION_TIMEOUT_MS = 15_000

/**
 * How the fetch waits, and tries again (docs/INGEST.md, "When GitHub has a bad minute").
 *
 * GitHub has bad minutes: on 2026-10-07 it answered "Internal Server Error" to
 * pushes, and the Windows CI run of that hour (37655072539) went red where the
 * same code re-run (37655616322) was green — most likely this fetch; the red
 * run's log could not be read. One try meant one 500 was a failed first
 * download for a user, and a red build for us.
 *
 * So each network step — the checksums, then the binary — is tried again when
 * the failure is the NETWORK's: a dropped, refused, unresolved or stalled
 * connection, or a 5xx, 429 or 408. Never when it is the ANSWER's: a 404 is a
 * release without that asset, and a checksum mismatch is a binary that must not
 * run, however many times it is downloaded. Those fail on the first try, as
 * they always did.
 */
export interface FetchRetry {
  /** Tries per network step, the first included. */
  attempts: number
  /** The wait before the second try; each later wait is double the one before. */
  firstDelayMs: number
  /**
   * The fetch's time for TRYING, from its start: no wait starts that would end
   * past it, and no try waits for GitHub's answer past it. It does NOT stop a
   * body that is still arriving. A slow link that is moving finishes, however
   * long it takes, as it did before there was a retry; a body that stops
   * moving is `idleMs`'s. So a first download on a slow home connection is not
   * cut off at a total time — the cost is that a body still moving has no
   * ceiling, which on a runner's link never matters.
   *
   * The default is the two answer waits added up, the 60 s and 300 s the
   * fetch was always planned around.
   */
  budgetMs: number
  /** How long one try at the checksums waits for GitHub to answer. */
  checksumsAnswerMs: number
  /** How long one try at the binary waits for GitHub to answer. */
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
const NETWORK_CODES = new Set([
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

/** An answer that was not a success. Its status decides whether another try can help. */
class HttpStatusError extends Error {
  constructor(
    url: string,
    readonly status: number
  ) {
    super(`${url} answered ${status}`)
    this.name = 'HttpStatusError'
  }
}

/** No answer within one try's wait for it — a stall, which another try can cure. */
class NoAnswerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoAnswerError'
  }
}

/** A body that stopped arriving for `idleMs` — the same stall, mid-transfer. */
class WentQuietError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WentQuietError'
  }
}

/** Whether another try could cure this. */
function transient(err: unknown): boolean {
  if (err instanceof HttpStatusError) {
    return err.status >= 500 || err.status === 429 || err.status === 408
  }
  if (err instanceof NoAnswerError) return true
  if (err instanceof WentQuietError) return true
  return networkCode(err) !== null
}

/** A duration for a message: the app's are whole seconds; a test's, or a wait cut by the budget, may not be. */
function secs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${Math.round(ms / 1000)}s`
}

function networkCode(err: unknown): string | null {
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
function reasonOf(err: unknown): string {
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
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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

function toolsDir(): string {
  return join(app.getPath('userData'), 'tools')
}

function managedPath(): string {
  return join(toolsDir(), installedName(process.platform))
}

function manifestPath(): string {
  return join(toolsDir(), 'yt-dlp.json')
}

async function runnable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * `--version`, or null if the binary will not run.
 *
 * Doubles as the health check: a truncated download, a wrong-architecture
 * binary and a missing runtime library all fail here, before a user has typed
 * a URL. On Windows this is also where a missing Visual C++ runtime would show,
 * which is exactly the sort of first-run fault a clean machine exists to find.
 */
export function ytDlpVersion(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      path,
      ['--version'],
      { windowsHide: true, timeout: VERSION_TIMEOUT_MS, encoding: 'utf8' },
      (err, stdout) => {
        if (err) return resolve(null)
        const version = String(stdout).trim().split(/\r?\n/)[0]
        resolve(version || null)
      }
    )
  })
}

async function onPath(): Promise<string | null> {
  const name = installedName(process.platform)
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (await runnable(candidate)) return candidate
  }
  return null
}

/** Where yt-dlp is right now, without fetching anything. */
export async function locateYtDlp(): Promise<YtDlpTool | null> {
  const explicit = process.env.FORGE_YTDLP
  if (explicit && (await runnable(explicit))) {
    return { path: explicit, source: 'env', version: await ytDlpVersion(explicit) }
  }

  const managed = managedPath()
  if (await runnable(managed)) {
    const version = await ytDlpVersion(managed)
    // A managed copy that will not run is a broken download, not a tool. Fall
    // through so it is re-fetched rather than reported as ready.
    if (version) return { path: managed, source: 'managed', version }
  }

  const found = await onPath()
  if (found) {
    // Same rule as the managed copy: a binary that will not run is not a tool.
    // Reporting it ready meant a broken PATH copy shadowed the fetch forever,
    // and every download failed with whatever yt-dlp said on its way out.
    const version = await ytDlpVersion(found)
    if (version) return { path: found, source: 'path', version }
  }

  return null
}

export async function ytDlpStatus(): Promise<YtDlpStatus> {
  const tool = await locateYtDlp()
  if (tool) return { ready: true, tool, reason: null }
  return {
    ready: false,
    tool: null,
    reason: 'yt-dlp is not on this machine yet. It downloads the first time a link is pasted.'
  }
}

/** One fetch's limits, shared by its two network steps. */
interface Fetching {
  retry: FetchRetry
  /** When the budget for trying is spent, as a `Date.now()`. */
  endsAt: number
  /** The caller's cancel. */
  signal?: AbortSignal
  onMessage?: (message: string) => void
}

/**
 * One try at one URL: the whole body, or why not.
 *
 * Three stops, kept apart because they mean different things. The caller's
 * cancel reports nothing. No answer within `answerMs` — this try's wait, which
 * `withRetry` cuts to what is left of the budget — is a stall. A body that
 * sends nothing for `idleMs` is a stall too. Another try may follow either.
 *
 * Time on its own is NOT a stop. A body still arriving runs to its end, as it
 * did before the retry: the answer's timer is cleared when the headers come,
 * and the idle timer starts again at every chunk. (For one version the budget
 * stayed on through the body, and a first download on a link under ~0.85
 * Mbit/s — 37 MB in what was left of 360 s — could never finish.)
 */
async function tryOnce(url: string, answerMs: number, f: Fetching): Promise<Buffer> {
  if (f.signal?.aborted) throw new CancelledError()

  const answer = new AbortController()
  const quiet = new AbortController()
  const signals = [answer.signal, quiet.signal]
  if (f.signal) signals.push(f.signal)
  const combined = AbortSignal.any(signals)
  const stop = (): Error | null => {
    if (f.signal?.aborted) return new CancelledError()
    if (answer.signal.aborted) return new NoAnswerError(`${url} did not answer within ${secs(answerMs)}`)
    if (quiet.signal.aborted) return new WentQuietError(`${url} sent nothing for ${secs(f.retry.idleMs)}`)
    return null
  }

  let response: Response
  const answerTimer = setTimeout(() => answer.abort(), answerMs)
  try {
    response = await fetch(url, { signal: combined, redirect: 'follow' })
  } catch (err) {
    throw stop() ?? new Error(`${url} could not be reached: ${reasonOf(err)}`, { cause: err })
  } finally {
    clearTimeout(answerTimer)
  }
  if (!response.ok) {
    // Let the connection go before another try opens a new one.
    await response.body?.cancel().catch(() => undefined)
    throw new HttpStatusError(url, response.status)
  }

  // The body, for as long as it keeps coming.
  const chunks: Uint8Array[] = []
  const idleTimer = setTimeout(() => quiet.abort(), f.retry.idleMs)
  try {
    const reader = response.body?.getReader()
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      idleTimer.refresh()
    }
  } catch (err) {
    throw stop() ?? new Error(`${url} broke off: ${reasonOf(err)}`, { cause: err })
  } finally {
    clearTimeout(idleTimer)
  }
  return Buffer.concat(chunks)
}

/** The failure, short, for the line on screen while the next try waits. */
function shortReason(err: unknown): string {
  if (err instanceof HttpStatusError) return `GitHub answered ${err.status}`
  if (err instanceof NoAnswerError) return 'GitHub did not answer'
  if (err instanceof WentQuietError) return 'the transfer stopped'
  return `the connection failed (${networkCode(err) ?? 'network error'})`
}

/**
 * One network step, tried again while the failure is the network's.
 *
 * Anything else — a 404, a cancel — goes straight out, on the try it happened.
 * When the tries or the budget run out, the error is the LAST try's own reason,
 * with how many tries it took: "fetch failed" or "answered 503" alone could not
 * tell a hiccup from an outage. The budget gates only what starts here — a wait,
 * and how long the next try waits for its answer — never a body in progress.
 */
async function withRetry<T>(
  step: string,
  once: (answerMs: number) => Promise<T>,
  answerMs: number,
  f: Fetching
): Promise<T> {
  const started = Date.now()
  let delay = f.retry.firstDelayMs
  for (let tried = 1; ; tried++) {
    try {
      return await once(Math.max(1, Math.min(answerMs, f.endsAt - Date.now())))
    } catch (err) {
      if (!transient(err)) throw err
      const outOfTries = tried >= f.retry.attempts
      const outOfTime = Date.now() + delay >= f.endsAt
      if (outOfTries || outOfTime) {
        if (tried === 1 && outOfTries) throw err
        const tries = tried === 1 ? '1 try' : `${tried} tries`
        const seconds = Math.round((Date.now() - started) / 1000)
        const why = outOfTries ? '' : `, with no time left in the fetch's ${secs(f.retry.budgetMs)} for another`
        throw new Error(`${reasonOf(err)} — gave up after ${tries} over ${seconds}s${why}`, { cause: err })
      }
      f.onMessage?.(
        `${step}: ${shortReason(err)}, trying again in ${Math.ceil(delay / 1000)}s (${tried + 1} of ${f.retry.attempts})`
      )
      await sleep(delay, f.signal)
      delay *= 2
    }
  }
}

/**
 * Fetch the current release into our directory, verified.
 *
 * Written to a temporary name and renamed into place, so a half-finished
 * download is never mistaken for a binary. The checksum file is fetched FIRST:
 * if it is unreachable or does not list our asset, nothing is downloaded at all.
 *
 * Only the two transfers are tried again (`withRetry`). Everything that judges
 * what arrived — the checksum's presence, the size, the hash — runs once, on the
 * bytes the last try brought, outside the retry: a wrong answer is not a
 * hiccup, and asking again until it comes out right is exactly what a checksum
 * exists to prevent.
 */
async function fetchYtDlp(
  onMessage?: (message: string) => void,
  signal?: AbortSignal,
  retry: FetchRetry = FETCH_RETRY
): Promise<YtDlpTool> {
  const asset = releaseAsset(process.platform, process.arch)
  if (!asset) {
    throw new Error(`There is no yt-dlp build for ${process.platform}/${process.arch}`)
  }

  const f: Fetching = { retry, endsAt: Date.now() + retry.budgetMs, signal, onMessage }

  try {
    await mkdir(toolsDir(), { recursive: true })

    onMessage?.('checking the yt-dlp release')
    const sums = parseChecksums(
      // As `Response.text()` decodes: UTF-8, a byte-order mark dropped.
      new TextDecoder().decode(
        await withRetry(
          'checking the yt-dlp release',
          (answerMs) => tryOnce(releaseUrl(CHECKSUMS_ASSET), answerMs, f),
          retry.checksumsAnswerMs,
          f
        )
      )
    )
    const expected = sums.get(asset)
    if (!expected) throw new Error(`the release does not publish a checksum for ${asset}`)

    onMessage?.('downloading yt-dlp (~30MB, first time only)')
    const bytes = await withRetry(
      'downloading yt-dlp',
      (answerMs) => tryOnce(releaseUrl(asset), answerMs, f),
      retry.binaryAnswerMs,
      f
    )
    if (bytes.byteLength === 0) throw new Error('the download was empty')

    const actual = createHash('sha256').update(bytes).digest('hex')
    // Never tried again (above). One way this fires with nothing malicious: each
    // request resolves `releases/latest` afresh, so a release published between
    // the checksums and the binary pairs release N's sums with N+1's binary. It
    // fails closed, here, and the next fetch gets a matching pair; retries that
    // span a minute widen that window a little, never past this check.
    if (actual !== expected) {
      throw new Error(`the download did not match its published checksum (${actual.slice(0, 12)}… vs ${expected.slice(0, 12)}…)`)
    }

    const final = managedPath()
    // Unique: two first-run jobs sharing one temp name meant the second's
    // rename hit a file the first had already moved, and that job reported
    // "could not be fetched" for a binary that was sitting there working.
    const temp = `${final}.${process.pid}.${randomUUID().slice(0, 8)}.download`
    try {
      await writeFile(temp, bytes)
      if (process.platform !== 'win32') await chmod(temp, 0o755)
      await rename(temp, final)
    } catch (err) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw err
    }

    const version = await ytDlpVersion(final)
    if (!version) {
      throw new Error(
        process.platform === 'win32'
          ? 'yt-dlp downloaded but would not start. On Windows this usually means the Visual C++ runtime is missing.'
          : 'yt-dlp downloaded but would not start'
      )
    }

    await writeFile(
      manifestPath(),
      JSON.stringify({ version, asset, fetchedAt: new Date().toISOString() }, null, 2)
    )
    return { path: final, source: 'managed', version }
  } catch (err) {
    // A cancelled fetch is not a failure to explain a way around.
    if (err instanceof Error && err.name === 'CancelledError') throw err
    if (signal?.aborted) throw new CancelledError()
    throw new Error(fetchFailureMessage(err instanceof Error ? err.message : String(err)))
  }
}

/**
 * The tool, fetching it if this machine has none.
 *
 * `refresh` forces a fresh fetch of the current release over whatever is there,
 * which is the whole answer to "YouTube changed and downloads broke".
 */
/**
 * The one fetch in flight, shared by everyone who asks while it runs.
 *
 * Two downloads started together on a fresh machine both found no yt-dlp and
 * both fetched 30MB of it. Single-flighting removes the duplicate transfer as
 * well as the race over the install.
 */
let inflight: Promise<YtDlpTool> | null = null

/**
 * The shared fetch, for one caller who can stop WAITING on it without stopping
 * it: the caller's cancel rejects this caller at once, as a CancelledError, and
 * `stopped` runs; the fetch carries on for anyone else waiting on it.
 *
 * Before this the cancel was only dropped, and a job cancelled during the
 * first-run fetch sat at "running" until the fetch ended (ipc.ts's comment
 * said the signal fixed that; for this path it did not). That mattered more
 * once the fetch tried again: offline, about a minute of waits instead of a
 * failure in under a second.
 */
function untilCancelled<T>(shared: Promise<T>, signal: AbortSignal | undefined, stopped?: () => void): Promise<T> {
  if (!signal) return shared
  return new Promise<T>((resolve, reject) => {
    const cancel = (): void => {
      stopped?.()
      reject(new CancelledError())
    }
    if (signal.aborted) return cancel()
    signal.addEventListener('abort', cancel, { once: true })
    // Handled either way, so the fetch failing after this caller left is not an unhandled rejection.
    shared.then(
      (value) => {
        signal.removeEventListener('abort', cancel)
        resolve(value)
      },
      (err: unknown) => {
        signal.removeEventListener('abort', cancel)
        reject(err)
      }
    )
  })
}

export async function ensureYtDlp(
  onMessage?: (message: string) => void,
  options: {
    refresh?: boolean
    signal?: AbortSignal
    /** Over FETCH_RETRY, field by field. The app never passes it; tests pass milliseconds. */
    retry?: Partial<FetchRetry>
  } = {}
): Promise<YtDlpTool> {
  if (options.signal?.aborted) throw new CancelledError()

  if (!options.refresh) {
    const found = await locateYtDlp()
    if (found) return found
    if (inflight) {
      // Someone else is already fetching. Say so rather than showing nothing,
      // and let their cancel be theirs — this caller only stops waiting.
      onMessage?.('waiting for yt-dlp to finish downloading')
      return untilCancelled(inflight, options.signal)
    }
  }

  // The shared promise deliberately carries NO caller signal unless this is a
  // refresh: one job cancelling must not abort a download another job is
  // waiting on. That job stops waiting instead (untilCancelled), and stops
  // hearing the fetch's lines, which would otherwise land on a cancelled row.
  let listening = true
  const tell =
    onMessage &&
    ((message: string): void => {
      if (listening) onMessage(message)
    })
  const retry = { ...FETCH_RETRY, ...options.retry }
  const run = fetchYtDlp(tell, options.refresh ? options.signal : undefined, retry).finally(() => {
    if (inflight === run) inflight = null
  })
  inflight = run
  if (options.refresh) return run
  return untilCancelled(run, options.signal, () => {
    listening = false
  })
}

/** What the last fetch recorded, for a settings screen. Null if never fetched. */
export async function ytDlpManifest(): Promise<{ version: string; asset: string; fetchedAt: string } | null> {
  try {
    return JSON.parse(await readFile(manifestPath(), 'utf8'))
  } catch {
    return null
  }
}
