import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { app } from 'electron'
import { CancelledError } from '../ffmpeg/run'
import { beginFetching, FETCH_RETRY, tryOnce, withRetry, type FetchRetry } from '../net/fetchFile'
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
 *
 * The retry itself — `FETCH_RETRY`, the answer wait, the idle timer and which
 * failures are tried again — lives in `src/main/net/fetchFile.ts`, which the
 * AI helper's pack shares (docs/CLIPS.md §3a.3). It is re-exported here, where
 * its callers and tests have always found it.
 */

export { FETCH_RETRY, type FetchRetry } from '../net/fetchFile'

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

  // One budget for both steps, on the wall clock, through the global fetch as it is when each try
  // starts; redirects left to fetch, and the lines on screen as they always read ("GitHub answered
  // 503", errors naming the URL asked for).
  const f = beginFetching(retry, {
    signal,
    onMessage,
    now: Date.now,
    fetch: (input, init) => fetch(input, init),
    redirects: 'follow',
    naming: { who: 'GitHub' }
  })

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
