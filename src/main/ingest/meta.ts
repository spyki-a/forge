import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, join, relative, isAbsolute } from 'node:path'
import { app } from 'electron'
import { CancelledError, killProcess } from '../ffmpeg/run'
import {
  buildCaptionArgs,
  buildMetaArgs,
  captionKeys,
  humanError,
  parseMeta,
  parseRequestedSubtitles,
  readMarkedLine,
  type LinkMeta,
  type MarkKind
} from '@shared/ingest/args'
import { linkCacheKey, parseLink, type ParsedLink } from '@shared/ingest/url'
import { json3Kind, transcriptFromTracks, type CaptionFetch, type CaptionTrack } from '@shared/ingest/captions'
import type { IngestTool } from './download'

/**
 * A link's metadata and its caption tracks, without the media (docs/CLIPS.md
 * §7.1, §3b.1).
 *
 * Its own spawn, NOT `downloadMedia`: that one's success path assumes a media
 * file and falls back to `findCached`, so it could resolve "done" with an
 * unrelated media file of the same stem. The spawn is the same in every way
 * that matters, for the same reasons (download.ts): `windowsHide`, a process
 * group of its own so a cancel takes yt-dlp's children with it, and a cancel
 * that does not settle until what it left behind is gone.
 *
 * Neither goes through the downloads queue: a job there with presetId
 * `'ingest'` is collected by the renderer and placed as media.
 */

/** Where a link's caption files live: the renderer's reload cache (CLIPS.md §7.2). */
export function urlCacheDir(linkKey: string): string {
  return join(app.getPath('userData'), 'url', linkKey)
}

/** The stem every caption file of a link starts with: `<linkKey>.captions.<lang>.json3`. */
export function captionStem(linkKey: string): string {
  return `${linkKey}.captions`
}

const MAX_STDERR_LINES = 12

interface ToolRun {
  code: number | null
  marks: { kind: MarkKind; value: string }[]
  stderr: string[]
}

/**
 * Run yt-dlp once, collecting the marked lines. Rejects with CancelledError
 * once the process has CLOSED after an abort — never before, so the caller's
 * cleanup runs against files nothing is still writing.
 */
function runTool(tool: IngestTool, args: string[], signal?: AbortSignal): Promise<ToolRun> {
  return new Promise<ToolRun>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError())
      return
    }
    let settled = false
    let cancelled = false
    const child: ChildProcess = spawn(tool.command, [...(tool.prefixArgs ?? []), ...args], {
      windowsHide: true,
      // A group of its own, so killProcess can signal the whole tree (download.ts).
      detached: process.platform !== 'win32'
    })
    const onAbort = (): void => {
      cancelled = true
      killProcess(child)
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const marks: ToolRun['marks'] = []
    const stderr: string[] = []
    let pending = ''
    const take = (line: string): void => {
      const marked = readMarkedLine(line)
      if (marked) marks.push(marked)
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      pending += chunk
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) take(line)
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.trim() === '') continue
        stderr.push(line.trim())
        if (stderr.length > MAX_STDERR_LINES) stderr.shift()
      }
    })

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    child.on('error', (err) => finish(() => reject(new Error(`Could not start yt-dlp: ${err.message}`))))
    child.on('close', (code) => {
      if (pending.trim()) take(pending)
      finish(() => (cancelled ? reject(new CancelledError()) : resolve({ code, marks, stderr })))
    })
  })
}

const lastMark = (run: ToolRun, kind: MarkKind): string | null =>
  [...run.marks].reverse().find((m) => m.kind === kind)?.value ?? null

/** The metadata subset (args.ts `buildMetaArgs`), nothing downloaded. */
export async function runMeta(url: string, tool: IngestTool, options: { signal?: AbortSignal } = {}): Promise<LinkMeta> {
  const run = await runTool(tool, buildMetaArgs(url), options.signal)
  if (run.code !== 0) throw new Error(humanError(run.stderr, run.code))
  const value = lastMark(run, 'meta')
  if (value === null) throw new Error('yt-dlp did not print the video’s details')
  return parseMeta(value)
}

/** Is `path` inside `dir`? yt-dlp writes where `-P` says; this is not taken on trust. */
function inside(dir: string, path: string): boolean {
  const rel = relative(dir, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Each caption fetch writes into a folder of its own under the link's, named so. */
export const STAGING_PREFIX = '.fetch-'
/** A staging folder this old is a run's that never cleaned up — the app quit under it. */
const STALE_STAGING_MS = 10 * 60_000

/** Remove staging folders a quit or a crash left behind; a live run's is younger. */
async function sweepStaging(dir: string): Promise<void> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  const now = Date.now()
  await Promise.all(
    names
      .filter((name) => name.startsWith(STAGING_PREFIX))
      .map(async (name) => {
        const path = join(dir, name)
        try {
          if (now - (await stat(path)).mtimeMs > STALE_STAGING_MS) await rm(path, { recursive: true, force: true })
        } catch {
          // Gone already, or not ours to judge.
        }
      })
  )
}

/**
 * The caption tracks for `keys`, fetched into `dir` (by default
 * `userData/url/<linkKey>/`), read, and made into a transcript.
 *
 * `dir` is the reload cache (CLIPS.md §3b.4): a clip collected later re-reads
 * a track there. So yt-dlp never writes into it. Each run gets a staging
 * folder of its own inside it (`.fetch-XXXXXX`) and `-P` points there; on
 * success the json3 tracks are renamed into `dir`, replacing an earlier
 * fetch's copy of the same track, and the staging folder goes with anything
 * else yt-dlp wrote (a fallback format this parser does not read). A cancel or
 * a failure removes the staging folder and nothing else — so it leaves no
 * caption file of THIS run behind, of any language, and never touches a track
 * an earlier fetch left for a placed clip. Before, a failed second fetch ran
 * `removePartials` on the link's stem and deleted the cache too.
 *
 * A video with none of the languages is not an error: `tracks` is empty and
 * `transcript` null.
 */
export async function runCaptions(
  url: string,
  keys: string[],
  tool: IngestTool,
  options: { signal?: AbortSignal; dir?: string } = {}
): Promise<CaptionFetch> {
  const link = parseLink(url)
  if (!link) throw new Error('That is not a link yt-dlp can read')
  const linkKey = linkCacheKey(link)
  const dir = options.dir ?? urlCacheDir(linkKey)
  const stem = captionStem(linkKey)

  await mkdir(dir, { recursive: true })
  await sweepStaging(dir)
  const staging = await mkdtemp(join(dir, STAGING_PREFIX))
  const dropStaging = (): Promise<void> => rm(staging, { recursive: true, force: true }).catch(() => undefined)
  const discard = async (error: unknown): Promise<never> => {
    await dropStaging()
    throw error
  }

  let run: ToolRun
  try {
    run = await runTool(tool, buildCaptionArgs(link.url, keys, staging, linkKey), options.signal)
  } catch (err) {
    return discard(err)
  }
  if (run.code !== 0) return discard(new Error(humanError(run.stderr, run.code)))

  const printed = lastMark(run, 'subs')
  if (printed === null) return discard(new Error('yt-dlp did not say which captions it wrote'))

  const read: { key: string; kind: 'asr' | 'lines'; json: unknown; from: string; path: string }[] = []
  for (const written of parseRequestedSubtitles(printed)) {
    // json3 was asked for; a site that cannot give it falls back to another
    // format, which this parser does not read — it goes with the staging folder.
    if (written.ext !== 'json3' || !inside(staging, written.path)) continue
    const name = basename(written.path)
    if (!name.startsWith(`${stem}.`)) continue
    try {
      if ((await stat(written.path)).size === 0) continue
      const json: unknown = JSON.parse(await readFile(written.path, 'utf8'))
      const kind = json3Kind(json)
      if (kind) read.push({ key: written.key, kind, json, from: written.path, path: join(dir, name) })
    } catch {
      // Unreadable or not JSON: not a track.
    }
  }
  if (options.signal?.aborted) return discard(new CancelledError())

  try {
    for (const track of read) await rename(track.from, track.path)
  } catch (err) {
    return discard(err)
  }
  await dropStaging()

  const language = keys[0].split('-')[0].toLowerCase()
  const tracks: CaptionTrack[] = read.map(({ key, kind, path }) => ({ key, kind, path }))
  return {
    linkKey,
    keys,
    tracks,
    transcript: transcriptFromTracks(read, `url:${linkKey}`, language)
  }
}

/* -------------------------------------------- what the renderer may ask */

/** `ingest:meta`'s payload, checked: a link yt-dlp can read. */
export function metaRequest(payload: unknown): { link: ParsedLink } {
  const { url } = (payload ?? {}) as { url?: unknown }
  if (typeof url !== 'string') throw new Error('Reading a link needs the link')
  const link = parseLink(url)
  if (!link) throw new Error('That is not a link yt-dlp can read')
  return { link }
}

/**
 * `ingest:captions`'s payload, checked: a link, and a language the keys are
 * made from here — the renderer never names a `--sub-langs` value itself.
 */
export function captionsRequest(payload: unknown): { link: ParsedLink; keys: string[] } {
  const { link } = metaRequest(payload)
  const { language } = (payload ?? {}) as { language?: unknown }
  const keys = captionKeys(typeof language === 'string' ? language : null)
  if (!keys) throw new Error('Choose the video’s language to fetch its captions')
  return { link, keys }
}

/**
 * One run per link key and kind: a second ask supersedes the first, which is
 * aborted and waited for before the second starts.
 *
 * Two caption fetches for one link write the same files, and one's cleanup
 * would delete the other's — the race INGEST.md records for two downloads of
 * one stem. The new entry is registered BEFORE waiting, so a third ask
 * supersedes the second rather than racing it.
 */
export class LinkRuns {
  private readonly runs = new Map<string, { controller: AbortController; done: Promise<unknown> }>()

  run<T>(slot: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const previous = this.runs.get(slot)
    const controller = new AbortController()
    const done = (async (): Promise<T> => {
      if (previous) {
        previous.controller.abort()
        await previous.done.catch(() => undefined)
      }
      if (controller.signal.aborted) throw new CancelledError()
      return work(controller.signal)
    })()
    const entry = { controller, done }
    this.runs.set(slot, entry)
    const clear = (): void => {
      if (this.runs.get(slot) === entry) this.runs.delete(slot)
    }
    done.then(clear, clear)
    return done
  }

  /**
   * Abort every run, for a quit. yt-dlp runs in a process group of its own,
   * so without this a fetch running at Cmd+Q carries on after the app is gone.
   */
  abortAll(): void {
    for (const { controller } of this.runs.values()) controller.abort()
  }
}

/** How a handler finds yt-dlp: `ensureYtDlp` in the app, the fake in a test. */
export type FindTool = (signal: AbortSignal) => Promise<IngestTool>

/*
 * How long yt-dlp may take before the ask gives up. Measured (EFFECTS.md §40):
 * a metadata read 1.5–1.8 s (6.9 s cold), a caption fetch 1.3–3.5 s. Without
 * a bound, a stalled extractor or challenge solver left the invoke unsettled
 * for good; `--socket-timeout` bounds one read, not the run. Finding or
 * fetching yt-dlp itself is outside the bound: a first run downloads ~30MB.
 */
export const META_TIMEOUT_MS = 60_000
export const CAPTIONS_TIMEOUT_MS = 120_000

/** yt-dlp outran its bound. Not a CancelledError: nobody cancelled. */
export class LinkTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`yt-dlp took longer than ${Math.round(ms / 1000)} s ${what}`)
    this.name = 'LinkTimeoutError'
  }
}

/** Run `work` under `signal` and a timeout; a timeout rejects as LinkTimeoutError, after the same cleanup. */
async function bounded<T>(
  signal: AbortSignal,
  ms: number,
  what: string,
  work: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const timeout = AbortSignal.timeout(ms)
  try {
    return await work(AbortSignal.any([signal, timeout]))
  } catch (err) {
    if (timeout.aborted && !signal.aborted && err instanceof CancelledError) throw new LinkTimeoutError(what, ms)
    throw err
  }
}

/**
 * The body of `ingest:meta`: validate, one run per link, find the tool, run.
 * ipc.ts registers exactly this, so the integration test runs what the app runs.
 */
export function metaHandler(
  runs: LinkRuns,
  findTool: FindTool,
  options: { timeoutMs?: number } = {}
): (payload: unknown) => Promise<LinkMeta> {
  const ms = options.timeoutMs ?? META_TIMEOUT_MS
  return (payload) => {
    const { link } = metaRequest(payload)
    return runs.run(`meta:${linkCacheKey(link)}`, async (signal) => {
      const tool = await findTool(signal)
      return bounded(signal, ms, 'reading the link', (both) => runMeta(link.url, tool, { signal: both }))
    })
  }
}

/** The body of `ingest:captions`; the files land in `userData/url/<linkKey>/`. */
export function captionsHandler(
  runs: LinkRuns,
  findTool: FindTool,
  options: { timeoutMs?: number } = {}
): (payload: unknown) => Promise<CaptionFetch> {
  const ms = options.timeoutMs ?? CAPTIONS_TIMEOUT_MS
  return (payload) => {
    const { link, keys } = captionsRequest(payload)
    const linkKey = linkCacheKey(link)
    return runs.run(`captions:${linkKey}`, async (signal) => {
      const tool = await findTool(signal)
      return bounded(signal, ms, 'fetching the captions', (both) =>
        runCaptions(link.url, keys, tool, { signal: both, dir: urlCacheDir(linkKey) })
      )
    })
  }
}
