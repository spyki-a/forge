/**
 * The yt-dlp command line, built from what the user chose.
 *
 * Pure, so the whole argv can be asserted in a test without a network, a
 * binary or electron — and mutation-checked, which matters because several of
 * these flags are load-bearing in ways that are invisible until they are
 * missing:
 *
 *   `--print` implies `--quiet`, and `--quiet` would silence the progress lines
 *   we parse. `--progress` overrides that. Drop it and the bar sits at 0%.
 *
 *   `--print` also implies `--simulate` unless a later stage is printed. We do
 *   print a later stage, but `--no-simulate` is passed anyway, because a
 *   download that quietly simulates is the worst kind of success.
 *
 *   `-P` and `-o` are separate on purpose. Putting the directory into the `-o`
 *   template means every `%` in the path is read as a template field.
 */

import { parseLink, type ParsedLink } from './url'
import { formatFor, type IngestKind, type Quality } from './format'
import { sectionPlan, type Range } from './section'
import { PROGRESS_TEMPLATE } from './progress'

export type AudioFormat = 'm4a' | 'mp3'

/**
 * What the user asked for. The sketch's four buttons, exactly.
 *
 * `instrumental` and `vocal` are an audio download followed by a stem split,
 * and both stay INSIDE the job: the queue says done when the file the user
 * asked for exists, not when the download half of it does. A job that reads
 * "done" while the app is still separating is the kind of seam that makes a
 * stack of features feel like a pile of them.
 */
export type IngestWant = 'video' | 'audio' | 'instrumental' | 'vocal'

/** The half of the choice yt-dlp sees. Everything that is not video is audio. */
export function downloadKind(want: IngestWant): IngestKind {
  return want === 'video' ? 'video' : 'audio'
}

/** Does this choice need the stems step after the download? */
export function needsStems(want: IngestWant): boolean {
  return want === 'instrumental' || want === 'vocal'
}

export interface IngestRequest {
  url: string
  kind: IngestWant
  /** Ignored for anything but video. */
  quality: Quality
  /** Audio only. m4a copies the stream out; mp3 re-encodes through libmp3lame. */
  audioFormat?: AudioFormat
  range?: Range | null
  /** Re-encode at the marks for an exact cut. Slow; see section.ts. */
  exact?: boolean
}

/** Marks the line carrying the finished file's path. */
export const FILE_MARK = '@forgefile@'
/** Marks the line carrying the video's title, for the asset's display name. */
export const TITLE_MARK = '@forgetitle@'
/** Marks the metadata subset printed by `buildMetaArgs`. */
export const META_MARK = '@forgemeta@'
/** Marks the `requested_subtitles` dict printed by `buildCaptionArgs`. */
export const SUBS_MARK = '@forgesubs@'

/**
 * What names the file on disk — and what makes two requests the same download.
 *
 * The link's key (a YouTube id, or a slug for anything else) plus everything
 * that changes the bytes: video or audio, which quality, which format, and the
 * range if there is one. Two asks that produce this same stem are one file, so
 * a second paste of the same link at the same quality costs nothing. Every
 * character is from `[A-Za-z0-9._-]`, so it is legal on Windows and needs no
 * escaping in a filtergraph.
 */
export function outputStem(link: ParsedLink, request: IngestRequest): string {
  // instrumental and vocal share the plain audio download: the split is a
  // second, separately cached step, so asking for the song and then its
  // instrumental fetches it once.
  const what =
    downloadKind(request.kind) === 'audio'
      ? `audio-${request.audioFormat ?? 'm4a'}`
      : `video-${request.quality}`
  /*
   * The cut KIND is part of the identity, not just the bounds.
   *
   * An exact cut re-encodes at the marks; a fast cut copies streams and pads
   * outward by ten seconds. They are different files. Without this, asking for
   * the fast version and then the exact one returned the fast file from cache
   * without spawning anything — the user ticks "exact", waits no time at all,
   * and gets the loose cut back.
   */
  const range = request.range
    ? `.r${Math.round(Math.min(request.range.startMs, request.range.endMs))}-` +
      `${Math.round(Math.max(request.range.startMs, request.range.endMs))}` +
      (request.exact ? '' : '.fast')
    : ''
  return `${link.key}.${what}${range}`
}

export interface ArgContext {
  /** Our bundled ffmpeg — never one found on PATH, so there is one media pipeline. */
  ffmpegPath: string
  /** Where the file lands. */
  destDir: string
  stem: string
}

export interface BuiltArgs {
  args: string[]
  link: ParsedLink
  stem: string
  /** True when the fast range path was taken and the ends want trimming. */
  approximateRange: boolean
  requestedRange: Range | null
}

export function buildYtDlpArgs(request: IngestRequest, context: ArgContext): BuiltArgs {
  const link = parseLink(request.url)
  if (!link) throw new Error('That is not a link yt-dlp can read')

  const kind = downloadKind(request.kind)
  const format = formatFor(kind, request.quality)
  const section = sectionPlan(request.range ?? null, request.exact ?? false)

  const args: string[] = [
    /*
     * `--ignore-config` first, and it is load-bearing.
     *
     * Without it yt-dlp merges the user's own config file into this command
     * line. Every flag below is chosen for a reason — the format selector keeps
     * AV1 out because the Windows ffmpeg cannot decode it, `-o` keeps the title
     * out of the filename because Windows forbids its characters — and a
     * stranger's `~/.config/yt-dlp/config` can override any of them. Their
     * config is for their yt-dlp, not for ours.
     */
    '--ignore-config',

    // The canonical URL, not what was pasted — playlist ids and timestamps are
    // already gone. `--no-playlist` and `--playlist-items 1` are belt and
    // braces for the thousand sites `parseLink` cannot recognise the shape of;
    // for YouTube, collection URLs are refused before they reach here.
    link.url,
    '--no-playlist',
    '--playlist-items',
    '1',

    /*
     * Windows pipes yt-dlp's stdout in the ANSI code page unless told
     * otherwise, and we decode it as UTF-8. That mangles every non-ASCII title,
     * and — worse — mangles the printed FILE PATH, so a user whose name is not
     * ASCII gets a path that does not stat, and the finished download is then
     * deleted as "missing".
     */
    '--encoding',
    'utf-8',
    '--ffmpeg-location',
    context.ffmpegPath,

    // Machine-readable progress on stdout. See progress.ts for why this shape.
    '--newline',
    '--progress',
    '--progress-template',
    PROGRESS_TEMPLATE,
    '--progress-delta',
    '0.2',

    // The two facts we need back, marked so they cannot be confused with
    // anything else on stdout. after_move is the path AFTER every postprocessor
    // has run — merge, extraction, rename — so it is the file that exists.
    '--print',
    `${TITLE_MARK}%(title)s`,
    '--print',
    `after_move:${FILE_MARK}%(filepath)s`,
    '--no-simulate',

    // Directory and filename kept apart: a `%` in the directory would otherwise
    // be read as a template field.
    '-P',
    context.destDir,
    '-o',
    `${context.stem}.%(ext)s`,

    '-f',
    format.selector,

    // A flaky connection is the common case, not the edge case.
    '--retries',
    '5',
    '--socket-timeout',
    '30'
  ]

  /*
   * `-S` decides among what `-f` allowed.
   *
   * Separate from the selector because they answer different questions: `-f`
   * is what is PERMITTED (never AV1, which the Windows ffmpeg cannot decode),
   * `-S` is which of the permitted is BEST. Expressing the size preference as
   * a sort rather than a filter is what makes vertical video work at all —
   * see the note in format.ts.
   */
  if (format.sort) args.push('-S', format.sort)

  if (format.mergeFormat) args.push('--merge-output-format', format.mergeFormat)

  if (kind === 'audio') {
    if ((request.audioFormat ?? 'm4a') === 'mp3') {
      // Re-encode. Our ffmpeg has libmp3lame (checked, not assumed); `0` is
      // the best VBR setting, which for a music bed is the right default.
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0')
    } else {
      // m4a is what YouTube stores, so this copies the stream out untouched.
      args.push('-x', '--audio-format', 'm4a')
    }
  }

  args.push(...section.args)

  return {
    args,
    link,
    stem: context.stem,
    approximateRange: section.approximate,
    requestedRange: section.requested
  }
}

export type MarkKind = 'file' | 'title' | 'meta' | 'subs'

const MARKS: [string, MarkKind][] = [
  [FILE_MARK, 'file'],
  [TITLE_MARK, 'title'],
  [META_MARK, 'meta'],
  [SUBS_MARK, 'subs']
]

/** Read one of the marked lines back, or null for anything else. */
export function readMarkedLine(line: string): { kind: MarkKind; value: string } | null {
  const trimmed = line.trim()
  for (const [mark, kind] of MARKS) {
    if (trimmed.startsWith(mark)) return { kind, value: trimmed.slice(mark.length) }
  }
  return null
}

/* ------------------------------------------- metadata and captions only */

/**
 * The flags every metadata or captions run shares with a download, for the
 * same reasons (see `buildYtDlpArgs`): a stranger's config file must not
 * reach this command line, a collection must not be walked, Windows must pipe
 * UTF-8 or a non-ASCII userData path comes back unreadable, and a flaky
 * connection is the common case.
 */
function commonHead(url: string): string[] {
  return ['--ignore-config', url, '--no-playlist', '--playlist-items', '1', '--encoding', 'utf-8']
}
const RETRIES = ['--retries', '5', '--socket-timeout', '30']

/**
 * The metadata subset, measured with yt-dlp 2026.08.19 (docs/EFFECTS.md §40).
 *
 * The full `-J` was 908 KB (162 caption languages × 7 URLs), so a subset is
 * printed. `channel`, `uploader` and `webpage_url` printed on all eight
 * videos tried. A field the video lacks is OMITTED from the dict, not null:
 * no chapters means no `chapters` key (3 of 8), no heatmap no `heatmap`
 * key (4 of 8).
 */
export const META_FIELDS = [
  'id',
  'title',
  'duration',
  'language',
  'chapters',
  'heatmap',
  'channel',
  'uploader',
  'webpage_url'
] as const

/**
 * The video's metadata, nothing downloaded: 1.68 s live (CLIPS.md §7.1).
 *
 * `--ignore-no-formats-error` because the metadata is wanted even when no
 * format is downloadable (an upcoming premiere, a members-only video): the
 * flag exists for exactly that, and was measured to parse and to change
 * nothing on a downloadable video.
 */
export function buildMetaArgs(url: string): string[] {
  const link = parseLink(url)
  if (!link) throw new Error('That is not a link yt-dlp can read')
  return [
    ...commonHead(link.url),
    '--ignore-no-formats-error',
    '--simulate',
    '--print',
    `${META_MARK}%(.{${META_FIELDS.join(',')}})j`,
    ...RETRIES
  ]
}

/**
 * A caption language key we will hand to `--sub-langs`.
 *
 * yt-dlp reads each comma-separated item as a REGEX (anchored by `match` and a
 * `$`), and `all` as everything; `en.*` was measured pulling auto-TRANSLATED
 * tracks ('English from German'). A key here is letters, then
 * hyphen-separated letters and digits — `en`, `en-orig`, `pt-BR`, `es-419`,
 * `zh-Hans` — so it can only ever match itself, and it is also a legal piece
 * of a Windows filename, which it becomes (`<key>.captions.<lang>.json3`).
 */
const LANGUAGE_KEY = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/

export function isCaptionKey(key: string): boolean {
  return LANGUAGE_KEY.test(key) && key.toLowerCase() !== 'all'
}

/**
 * Which caption tracks to ask for: the primary subtag of the video's language
 * (`en-US` → `en`, measured: that video's ASR track was `en-orig`), as the
 * uploader's track `<l>` and the ASR `<l>-orig`. Null when the language is
 * missing or unreadable; the user then picks one.
 */
export function captionKeys(language: string | null | undefined): string[] | null {
  if (typeof language !== 'string') return null
  const primary = language.trim().split(/[-_]/)[0].toLowerCase()
  if (!/^[a-z]{2,3}$/.test(primary) || primary === 'all') return null
  return [primary, `${primary}-orig`]
}

/** A link key fit to start a filename: `[A-Za-z0-9_-]`, no dot, so `<key>.captions.<lang>.<ext>` reads back unambiguously. */
const FILE_KEY = /^[A-Za-z0-9_-]{1,64}$/

/**
 * The caption tracks only — keyless, no media, no model (CLIPS.md §7.1, measured).
 *
 *   `--skip-download` with `--no-simulate`: a `--print` with no later-stage
 *       print simulates and writes nothing.
 *   `after_video`: with `--skip-download` the `after_move` and `post_process`
 *       prints never fire; `after_video` does, and each entry carries its
 *       `filepath` (measured).
 *   the WHOLE `requested_subtitles` dict, parsed in TS: in a template a
 *       hyphenated key is subtraction, so `%(requested_subtitles.en-orig.filepath)s`
 *       printed `NA` with the track on disk. With no track it prints `NA`.
 *   explicit keys, never a regex.
 *
 * Files land as `<key>.captions.<lang>.json3` in `dir`; a second fetch
 * re-downloads and overwrites them (measured).
 */
export function buildCaptionArgs(url: string, keys: string[], dir: string, key: string): string[] {
  const link = parseLink(url)
  if (!link) throw new Error('That is not a link yt-dlp can read')
  if (keys.length === 0) throw new Error('Captions need at least one language')
  for (const k of keys) {
    if (!isCaptionKey(k)) throw new Error(`"${k}" is not a caption language`)
  }
  if (!FILE_KEY.test(key)) throw new Error('A caption file needs a plain link key')
  if (!dir) throw new Error('Captions need a folder to land in')
  return [
    ...commonHead(link.url),
    '--ignore-no-formats-error',
    '--skip-download',
    '--no-simulate',
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs',
    keys.join(','),
    '--sub-format',
    'json3',
    '-P',
    dir,
    '-o',
    `${key}.captions.%(ext)s`,
    '--print',
    `after_video:${SUBS_MARK}%(requested_subtitles)j`,
    ...RETRIES
  ]
}

/** One chapter, in seconds, as yt-dlp prints it. */
export interface LinkChapter {
  start_time: number
  end_time: number
  title: string
}

/** One "most replayed" bucket: seconds, and a value from 0 to 1. */
export interface LinkHeat {
  start_time: number
  end_time: number
  value: number
}

/** What `ingest:meta` hands the renderer — yt-dlp's names, absent fields made explicit. */
export interface LinkMeta {
  id: string | null
  title: string | null
  /** Seconds. */
  duration: number | null
  language: string | null
  /** Empty when the video has none. */
  chapters: LinkChapter[]
  /** Null when the video has none (common: 4 of 8 measured). */
  heatmap: LinkHeat[] | null
  channel: string | null
  uploader: string | null
  webpage_url: string | null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

/** The META_MARK line's value. Throws on anything that is not a JSON object. */
export function parseMeta(value: string): LinkMeta {
  let raw: unknown
  try {
    raw = JSON.parse(value)
  } catch {
    throw new Error('yt-dlp printed metadata that could not be read')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('yt-dlp printed metadata that could not be read')
  }
  const r = raw as Record<string, unknown>
  const chapters = Array.isArray(r.chapters)
    ? r.chapters.flatMap((c): LinkChapter[] => {
        const start = num((c as Record<string, unknown>)?.start_time)
        const end = num((c as Record<string, unknown>)?.end_time)
        if (start === null || end === null || end <= start) return []
        return [{ start_time: start, end_time: end, title: str((c as Record<string, unknown>).title) ?? '' }]
      })
    : []
  const heatmap = Array.isArray(r.heatmap)
    ? r.heatmap.flatMap((h): LinkHeat[] => {
        const start = num((h as Record<string, unknown>)?.start_time)
        const end = num((h as Record<string, unknown>)?.end_time)
        const v = num((h as Record<string, unknown>)?.value)
        return start === null || end === null || v === null ? [] : [{ start_time: start, end_time: end, value: v }]
      })
    : null
  return {
    id: str(r.id),
    title: str(r.title),
    duration: num(r.duration),
    language: str(r.language),
    chapters,
    heatmap: heatmap && heatmap.length > 0 ? heatmap : null,
    channel: str(r.channel),
    uploader: str(r.uploader),
    webpage_url: str(r.webpage_url)
  }
}

/** One written caption track, as the SUBS_MARK dict names it. */
export interface WrittenSubtitle {
  key: string
  ext: string
  path: string
}

/**
 * The SUBS_MARK line's value: `NA` when no requested language existed
 * (measured), otherwise yt-dlp's `requested_subtitles` dict. Only entries with
 * a `filepath` were written.
 */
export function parseRequestedSubtitles(value: string): WrittenSubtitle[] {
  const text = value.trim()
  if (text === 'NA' || text === 'null' || text === '') return []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('yt-dlp printed a caption list that could not be read')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
  const out: WrittenSubtitle[] = []
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    const e = entry as Record<string, unknown> | null
    const path = str(e?.filepath)
    if (path) out.push({ key, ext: str(e?.ext) ?? '', path })
  }
  return out
}

/**
 * Turn yt-dlp's last words into something a person can act on.
 *
 * Its errors arrive as `ERROR: [youtube] abc123: Video unavailable`. The prefix
 * and the extractor tag are noise to a user; the id is already in the job's
 * name. What is left is the actual reason.
 */
export function humanError(stderrTail: string[], exitCode: number | null): string {
  const lines = stderrTail.map((l) => l.trim()).filter(Boolean)
  const error = [...lines].reverse().find((l) => /^ERROR:/i.test(l)) ?? lines.at(-1)
  if (!error) return `yt-dlp exited with code ${exitCode ?? 'unknown'}`
  return error
    .replace(/^ERROR:\s*/i, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^[A-Za-z0-9_-]{11}:\s*/, '')
    .trim()
}
