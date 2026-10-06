/**
 * What a Clip it job carries from the URL tile to the clip it lands as: the
 * run's words and the link's credit (docs/CLIPS.md §3b.4).
 *
 * Main keeps it beside the job's request and hands it back at collect, so a
 * reload mid-download (Cmd+R, which the app allows) loses neither: the
 * renderer's own copy, in `pendingIngests`, goes with the reload. The words
 * are then read again from the caption files main kept — by the link key and
 * the tracks' keys, which main checks and turns into a path itself; a path is
 * never taken from the renderer (INGEST.md, "Metadata and captions").
 */

import type { AssetCredit } from '../timeline'
import type { Transcript } from '../transcript'
import { isCaptionKey, isLinkKey, type LinkMeta } from './args'
import type { WordRun } from './captions'
import type { Range } from './section'

/** `pendingIngests[jobId].transcriptFrom`: where the clip's words come from. */
export interface TranscriptFrom {
  /** `linkCacheKey` of the link: the folder its caption files are in. */
  linkKey: string
  /**
   * The caption tracks the transcript was made from, by yt-dlp's key (`en`,
   * `en-orig`) — never a path. Two when the uploader's words were laid on the
   * ASR's timing (§16.12): the re-read must merge the same two, or the run's
   * word indices would point at other words.
   */
  keys: string[]
  /** What was downloaded, in the video's clock. */
  range: Range
  /** The words picked, by index into the link's transcript. */
  run: WordRun
  /** Where the range starts in the file: 0 for an exact cut, `offsetIntoDownload` for a fast one. */
  headOffsetMs: number
  /**
   * The transcript the run was picked from, told apart from a later fetch of
   * the same link: how many words it had, and the run's first and last. A
   * re-read that differs is not the same transcript, and its indices are not
   * the run's.
   */
  words: { count: number; first: string; last: string }
}

/** What `ingest:start` keeps beside a Clip it job, and `ingest:collect` hands back. */
export interface LinkClip {
  transcriptFrom: TranscriptFrom
  credit: AssetCredit | null
}

/** The `words` check of a run in its transcript. */
export function runWords(t: Transcript, run: WordRun): TranscriptFrom['words'] {
  return { count: t.words.length, first: t.words[run.from]?.text ?? '', last: t.words[run.to]?.text ?? '' }
}

/** Is `t` the transcript `from`'s run was picked in? */
export function transcriptFits(t: Transcript, from: TranscriptFrom): boolean {
  const now = runWords(t, from.run)
  return (
    from.run.from >= 0 &&
    from.run.to < t.words.length &&
    now.count === from.words.count &&
    now.first === from.words.first &&
    now.last === from.words.last
  )
}

/**
 * The run's words in `t`: the run itself when `t` is the transcript it was
 * picked in (`transcriptFits`), or — a later fetch renumbered the words — the
 * same run found again: as many words, the same first and last, starting
 * inside the range, the one starting nearest the range's start. Null when it
 * cannot be found, and only then do the range's words stand in for it; a
 * one-word run is fetched a second long, and every word in that second is not
 * what was picked.
 */
export function runIn(t: Transcript, from: TranscriptFrom): WordRun | null {
  if (transcriptFits(t, from)) return from.run
  const length = from.run.to - from.run.from + 1
  let best: WordRun | null = null
  let distance = Infinity
  for (let i = 0; i + length - 1 < t.words.length; i++) {
    const first = t.words[i]
    if (first.startMs < from.range.startMs || first.startMs >= from.range.endMs) continue
    if (first.text !== from.words.first || t.words[i + length - 1].text !== from.words.last) continue
    const off = Math.abs(first.startMs - from.range.startMs)
    if (off < distance) {
      distance = off
      best = { from: i, to: i + length - 1 }
    }
  }
  return best
}

/** The language a set of track keys was fetched in, as `runCaptions` names it: `en-orig` → `en`. */
export function languageOfKeys(keys: readonly string[]): string {
  return (keys[0] ?? 'und').split('-')[0].toLowerCase()
}

/**
 * The link's credit (§8.5): `<title> — <channel>, <url>`.
 *
 * The channel, else the uploader (yt-dlp printed both on all eight videos
 * measured, EFFECTS.md §40, but either may be absent on another site); the
 * page is `webpage_url`, else the canonical link. With no title the line is
 * the author and the page, or the page alone — never the link twice.
 */
export function linkCredit(meta: LinkMeta | null, url: string, fetchedAt: string): AssetCredit {
  const named = meta?.title ?? null
  const title = named ?? url
  const author = meta?.channel ?? meta?.uploader ?? null
  const pageUrl = meta?.webpage_url ?? url
  const head = named ? (author ? `${named} — ${author}` : named) : author
  return {
    source: 'link',
    title,
    author,
    pageUrl,
    line: head ? `${head}, ${pageUrl}` : pageUrl,
    attributionRequired: false,
    fetchedAt
  }
}

/* --------------------------------------------- checked in main, at start */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isWhole = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
const DAY_MS = 86_400_000

function bad(what: string): never {
  throw new Error(`That clip's ${what} could not be read`)
}

/**
 * `ingest:start`'s `clip`, checked: null when there is none, a LinkClip when
 * every field is the shape the renderer makes, and an error otherwise — a
 * malformed one is a bug to see, not a clip to land without its words.
 */
export function checkLinkClip(raw: unknown): LinkClip | null {
  if (raw === undefined || raw === null) return null
  if (!isObject(raw) || !isObject(raw.transcriptFrom)) bad('words')
  const f = raw.transcriptFrom
  if (!isLinkKey(f.linkKey)) bad('link')
  if (!Array.isArray(f.keys) || f.keys.length === 0 || f.keys.length > 4 || !f.keys.every((k) => typeof k === 'string' && isCaptionKey(k))) {
    bad('caption tracks')
  }
  const range = f.range
  if (
    !isObject(range) ||
    !Number.isFinite(range.startMs) ||
    !Number.isFinite(range.endMs) ||
    (range.startMs as number) < 0 ||
    (range.endMs as number) <= (range.startMs as number) ||
    (range.endMs as number) > 30 * DAY_MS
  ) {
    bad('range')
  }
  const run = f.run
  if (!isObject(run) || !isWhole(run.from, 10_000_000) || !isWhole(run.to, 10_000_000) || run.from > run.to) bad('words')
  if (!Number.isFinite(f.headOffsetMs) || (f.headOffsetMs as number) < 0 || (f.headOffsetMs as number) > DAY_MS) bad('range')
  const words = f.words
  if (!isObject(words) || !isWhole(words.count, 10_000_000) || !isText(words.first, 500) || !isText(words.last, 500)) bad('words')

  let credit: AssetCredit | null = null
  if (raw.credit !== undefined && raw.credit !== null) {
    const c = raw.credit
    if (
      !isObject(c) ||
      c.source !== 'link' ||
      !isText(c.title, 2000) ||
      !(c.author === null || isText(c.author, 2000)) ||
      !isText(c.pageUrl, 4096) ||
      !isText(c.line, 8192) ||
      typeof c.attributionRequired !== 'boolean' ||
      !isText(c.fetchedAt, 64)
    ) {
      bad('credit')
    }
    credit = {
      source: 'link',
      title: c.title,
      author: c.author,
      pageUrl: c.pageUrl,
      line: c.line,
      attributionRequired: c.attributionRequired,
      fetchedAt: c.fetchedAt
    }
  }

  return {
    transcriptFrom: {
      linkKey: f.linkKey,
      keys: [...(f.keys as string[])],
      range: { startMs: range.startMs as number, endMs: range.endMs as number },
      run: { from: run.from, to: run.to },
      headOffsetMs: f.headOffsetMs as number,
      words: { count: words.count, first: words.first, last: words.last }
    },
    credit
  }
}
