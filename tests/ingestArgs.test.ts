import { describe, it, expect } from 'vitest'
import {
  buildCaptionArgs,
  buildMetaArgs,
  buildYtDlpArgs,
  captionKeys,
  downloadKind,
  FILE_MARK,
  humanError,
  isCaptionKey,
  META_FIELDS,
  META_MARK,
  needsStems,
  outputStem,
  parseMeta,
  parseRequestedSubtitles,
  readMarkedLine,
  SUBS_MARK,
  TITLE_MARK,
  type IngestRequest
} from '@shared/ingest/args'
import { linkCacheKey, parseLink } from '@shared/ingest/url'
import { PROGRESS_TEMPLATE } from '@shared/ingest/progress'

const URL = 'https://youtu.be/dQw4w9WgXcQ?si=tracking&t=42'
const CONTEXT = { ffmpegPath: '/app/bin/ffmpeg', destDir: '/data/downloads', stem: 'dQw4w9WgXcQ.video-1080p' }

/** The argv, and a helper to read the value after a flag. */
function build(over: Partial<IngestRequest> = {}) {
  const request: IngestRequest = { url: URL, kind: 'video', quality: '1080p', ...over }
  const built = buildYtDlpArgs(request, CONTEXT)
  const after = (flag: string): string | undefined => {
    const at = built.args.indexOf(flag)
    return at === -1 ? undefined : built.args[at + 1]
  }
  const every = (flag: string): string[] =>
    built.args.flatMap((a, i) => (a === flag ? [built.args[i + 1]] : []))
  return { ...built, after, every }
}

describe('the yt-dlp command line', () => {
  it('hands over the canonical URL, not what was pasted', () => {
    // Tracking parameters and the timestamp are gone; the playlist would be.
    // Position is not asserted — yt-dlp takes flags either side of the URL.
    expect(build().args).toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(build().args).toContain('--no-playlist')
  })

  it('ignores the user\u2019s own yt-dlp config', () => {
    /*
     * Every flag here is chosen for a reason — AV1 is excluded because the
     * Windows ffmpeg cannot decode it, the title is kept out of the filename
     * because Windows forbids its characters. A stranger's config file can
     * override any of them, so it is not read at all.
     */
    expect(build().args).toContain('--ignore-config')
  })

  it('asks for UTF-8, because Windows pipes the ANSI code page otherwise', () => {
    /*
     * Not cosmetic. We decode stdout as UTF-8, so without this a non-ASCII
     * userData path came back mangled, failed to stat, and the finished
     * download was deleted as "missing".
     */
    expect(build().after('--encoding')).toBe('utf-8')
  })

  it('takes one item, whatever a strange site calls its collection', () => {
    // --no-playlist is not enough on its own: yt-dlp ignores it when the URL
    // carries no video id. parseLink refuses the shapes it recognises; this is
    // the belt for the thousand sites it cannot.
    expect(build().after('--playlist-items')).toBe('1')
  })

  it('uses OUR ffmpeg, never one found on PATH', () => {
    // One media pipeline in the product. yt-dlp merges with this binary, so
    // every feature-floor argument in EFFECTS.md section 25 applies to it.
    expect(build().after('--ffmpeg-location')).toBe('/app/bin/ffmpeg')
  })

  it('keeps --progress, because --print implies --quiet and would silence it', () => {
    /*
     * The trap in this file. `--print` turns on quiet mode, and quiet mode
     * drops the progress lines the bar is drawn from. `--progress` overrides
     * that. Remove it and every download sits at 0% until it is done.
     */
    const { args } = build()
    expect(args).toContain('--print')
    expect(args).toContain('--progress')
    expect(args).toContain('--newline')
  })

  it('keeps --no-simulate, because --print can imply --simulate', () => {
    // A download that quietly simulates is the worst kind of success.
    expect(build().args).toContain('--no-simulate')
  })

  it('asks for exactly our progress line', () => {
    expect(build().after('--progress-template')).toBe(PROGRESS_TEMPLATE)
    expect(build().after('--progress-delta')).toBe('0.2')
  })

  it('asks for the title and the FINAL path, each marked', () => {
    const prints = build().every('--print')
    expect(prints).toContain(`${TITLE_MARK}%(title)s`)
    // after_move: the path once every postprocessor has run. Anything earlier
    // names a file that is about to be renamed or merged away.
    expect(prints).toContain(`after_move:${FILE_MARK}%(filepath)s`)
  })

  it('keeps the directory out of the filename template', () => {
    // A `%` in the directory would otherwise be read as a template field.
    const b = build()
    expect(b.after('-P')).toBe('/data/downloads')
    expect(b.after('-o')).toBe('dQw4w9WgXcQ.video-1080p.%(ext)s')
    expect(b.after('-o')).not.toContain('/')
  })

  it('never puts the title in the filename', () => {
    // The whole point of the stem. Titles contain | ? " and :, and Windows
    // refuses every one of them.
    expect(build().after('-o')).not.toContain('title')
  })

  it('passes the format selector with AV1 excluded and merges to mp4', () => {
    const b = build()
    expect(b.after('-f')).toContain('vcodec!*=av01')
    expect(b.after('--merge-output-format')).toBe('mp4')
  })

  it('passes the size preference as a sort, so vertical video works', () => {
    /*
     * `-f` is what is PERMITTED, `-S` is which of those is BEST. Size has to
     * ride in the sort: as a filter it read `height<=N`, which is false for
     * every vertical video and refused every Short and every reel.
     */
    const b = build()
    expect(b.after('-S')).toContain('res:')
    expect(b.after('-f')).not.toContain('height')
  })

  it('sends no sort for an audio-only download, which has no resolution', () => {
    expect(build({ kind: 'audio' }).args).not.toContain('-S')
  })

  it('extracts audio as m4a by default, copying the stream out', () => {
    const b = build({ kind: 'audio' })
    expect(b.args).toContain('-x')
    expect(b.after('--audio-format')).toBe('m4a')
    expect(b.args).not.toContain('--merge-output-format')
  })

  it('re-encodes to mp3 at the best VBR setting when asked', () => {
    const b = build({ kind: 'audio', audioFormat: 'mp3' })
    expect(b.after('--audio-format')).toBe('mp3')
    expect(b.after('--audio-quality')).toBe('0')
  })

  it('adds the padded section on the fast range path', () => {
    const b = build({ range: { startMs: 60_000, endMs: 90_000 } })
    expect(b.after('--download-sections')).toBe('*50.000-100.000')
    expect(b.args).not.toContain('--force-keyframes-at-cuts')
    expect(b.approximateRange).toBe(true)
    expect(b.requestedRange).toEqual({ startMs: 60_000, endMs: 90_000 })
  })

  it('adds the exact section and the re-encode flag when asked', () => {
    const b = build({ range: { startMs: 60_000, endMs: 90_000 }, exact: true })
    expect(b.after('--download-sections')).toBe('*60.000-90.000')
    expect(b.args).toContain('--force-keyframes-at-cuts')
    expect(b.approximateRange).toBe(false)
  })

  it('retries, because a flaky connection is the common case', () => {
    expect(build().after('--retries')).toBe('5')
    expect(build().after('--socket-timeout')).toBe('30')
  })

  it('refuses something that is not a link', () => {
    expect(() => buildYtDlpArgs({ url: 'not a url', kind: 'video', quality: '720p' }, CONTEXT)).toThrow(
      /not a link/
    )
  })
})

describe('the stem — what makes two asks the same file', () => {
  const link = parseLink(URL)!

  it('differs by kind, quality and format', () => {
    expect(outputStem(link, { url: URL, kind: 'video', quality: '1080p' })).toBe('dQw4w9WgXcQ.video-1080p')
    expect(outputStem(link, { url: URL, kind: 'video', quality: '480p' })).toBe('dQw4w9WgXcQ.video-480p')
    expect(outputStem(link, { url: URL, kind: 'audio', quality: '1080p' })).toBe('dQw4w9WgXcQ.audio-m4a')
    expect(outputStem(link, { url: URL, kind: 'audio', quality: '1080p', audioFormat: 'mp3' })).toBe(
      'dQw4w9WgXcQ.audio-mp3'
    )
  })

  it('differs by range, and normalises a backwards one', () => {
    const a = outputStem(link, { url: URL, kind: 'video', quality: '1080p', range: { startMs: 60_000, endMs: 90_000 } })
    const b = outputStem(link, { url: URL, kind: 'video', quality: '1080p', range: { startMs: 90_000, endMs: 60_000 } })
    // `.fast` because neither asked for an exact cut — see the next test.
    expect(a).toBe('dQw4w9WgXcQ.video-1080p.r60000-90000.fast')
    expect(b).toBe(a)
  })

  it('tells an exact cut from a fast one, which are different files', () => {
    /*
     * An exact cut re-encodes at the marks; a fast cut copies streams and pads
     * outward by ten seconds. Sharing a name meant ticking "exact" after a fast
     * download returned the fast file from cache, instantly and wrongly.
     */
    const range = { startMs: 60_000, endMs: 90_000 }
    const exact = outputStem(link, { url: URL, kind: 'video', quality: '1080p', range, exact: true })
    const fast = outputStem(link, { url: URL, kind: 'video', quality: '1080p', range, exact: false })
    expect(exact).not.toBe(fast)
    expect(exact).toBe('dQw4w9WgXcQ.video-1080p.r60000-90000')
    expect(fast).toBe('dQw4w9WgXcQ.video-1080p.r60000-90000.fast')
  })

  it('is legal on Windows and safe in a filtergraph', () => {
    for (const stem of [
      outputStem(link, { url: URL, kind: 'video', quality: '2160p', range: { startMs: 1500.7, endMs: 9999.2 } }),
      outputStem(parseLink('https://vimeo.com/123?x=a|b')!, { url: '', kind: 'audio', quality: '720p' })
    ]) {
      expect(stem, stem).toMatch(/^[A-Za-z0-9._-]+$/)
    }
  })
})

describe('reading yt-dlp back', () => {
  it('reads the two marked lines and nothing else', () => {
    expect(readMarkedLine(`${FILE_MARK}/data/downloads/x.mp4`)).toEqual({ kind: 'file', value: '/data/downloads/x.mp4' })
    expect(readMarkedLine(`  ${TITLE_MARK}Some | Title: "quoted"?  `)).toEqual({
      kind: 'title',
      value: 'Some | Title: "quoted"?'
    })
    expect(readMarkedLine('@forge@downloading|1|2|NA|NA|NA')).toBeNull()
    expect(readMarkedLine('[download] Destination: x.f137.mp4')).toBeNull()
  })

  it('keeps a Windows path intact', () => {
    expect(readMarkedLine(`${FILE_MARK}C:\\Users\\me\\AppData\\forge\\downloads\\x.mp4`)?.value).toBe(
      'C:\\Users\\me\\AppData\\forge\\downloads\\x.mp4'
    )
  })

  it('turns the last ERROR line into the reason a person can act on', () => {
    expect(
      humanError(['[youtube] Extracting URL', 'ERROR: [youtube] dQw4w9WgXcQ: Video unavailable'], 1)
    ).toBe('Video unavailable')
    expect(humanError(['WARNING: something', 'ERROR: Unsupported URL: https://x'], 1)).toBe(
      'Unsupported URL: https://x'
    )
  })

  it('falls back to the last line, then to the exit code', () => {
    expect(humanError(['something odd happened'], 2)).toBe('something odd happened')
    expect(humanError([], 3)).toBe('yt-dlp exited with code 3')
  })
})

describe('instrumental and vocal — an audio download with a split inside the job', () => {
  const link = parseLink(URL)!

  it('is an audio download as far as yt-dlp is concerned', () => {
    for (const kind of ['instrumental', 'vocal'] as const) {
      expect(downloadKind(kind)).toBe('audio')
      const b = build({ kind })
      expect(b.args, kind).toContain('-x')
      expect(b.after('--audio-format'), kind).toBe('m4a')
      expect(b.args, kind).not.toContain('--merge-output-format')
    }
    expect(downloadKind('audio')).toBe('audio')
    expect(downloadKind('video')).toBe('video')
  })

  it('shares the download with plain audio, so the song is fetched once', () => {
    // The split is a second, separately cached step. Asking for the song and
    // then its instrumental must not download it twice.
    const audio = outputStem(link, { url: URL, kind: 'audio', quality: '1080p' })
    expect(outputStem(link, { url: URL, kind: 'instrumental', quality: '1080p' })).toBe(audio)
    expect(outputStem(link, { url: URL, kind: 'vocal', quality: '1080p' })).toBe(audio)
  })

  it('knows which choices need the stems step', () => {
    expect(needsStems('instrumental')).toBe(true)
    expect(needsStems('vocal')).toBe(true)
    expect(needsStems('audio')).toBe(false)
    expect(needsStems('video')).toBe(false)
  })
})

/* ------------------------------------------- metadata and captions only */

/**
 * Where `shape` occurs as a consecutive run in `args` — asserting it occurs
 * EXACTLY once, so a shape cannot pass by matching a second, unrelated copy.
 */
function runOf(args: string[], shape: string[]): number {
  const hits: number[] = []
  for (let i = 0; i + shape.length <= args.length; i++) {
    if (shape.every((s, k) => args[i + k] === s)) hits.push(i)
  }
  expect(hits, JSON.stringify(shape)).toHaveLength(1)
  return hits[0]
}

const CANONICAL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const GUARDS = [
  '--ignore-config',
  CANONICAL,
  '--no-playlist',
  '--playlist-items',
  '1',
  '--encoding',
  'utf-8'
]

describe('metadata without a download', () => {
  const args = buildMetaArgs(URL)

  it('simulates and prints the marked subset as one JSON object', () => {
    const at = runOf(args, ['--ignore-no-formats-error', '--simulate', '--print'])
    // The template's shape, and the fields it MUST hold — not the whole list,
    // so a field added correctly does not break this.
    const template = args[at + 3]
    const shape = new RegExp(`^${META_MARK}%\\(\\.\\{([a-z_,]+)\\}\\)j$`)
    expect(template).toMatch(shape)
    const fields = shape.exec(template)![1].split(',')
    for (const field of ['id', 'title', 'duration', 'language', 'chapters', 'heatmap', 'channel', 'uploader', 'webpage_url']) {
      expect(fields, field).toContain(field)
    }
    // A metadata run must never fetch the media or the captions.
    expect(args).not.toContain('--no-simulate')
    expect(args).not.toContain('--write-subs')
  })

  it('asks for the quote’s speaker and the credit’s fields (measured to print)', () => {
    for (const field of ['channel', 'uploader', 'webpage_url', 'chapters', 'heatmap', 'language']) {
      expect(META_FIELDS, field).toContain(field)
    }
  })

  it('carries the download’s guards first, in order: no config, one video, UTF-8', () => {
    expect(runOf(args, GUARDS)).toBe(0)
  })

  it('refuses something that is not a link', () => {
    expect(() => buildMetaArgs('-o /etc/passwd')).toThrow(/not a link/)
  })
})

describe('captions without the media', () => {
  // A Windows folder on purpose: it rides in -P, never in the template.
  const dir = 'C:\\Users\\me\\AppData\\Roaming\\forge\\url\\dQw4w9WgXcQ-0a1b2c3d'
  const key = 'dQw4w9WgXcQ-0a1b2c3d'
  const args = buildCaptionArgs(URL, ['en', 'en-orig'], dir, key)

  it('skips the media but does NOT simulate — a lone print would write nothing', () => {
    runOf(args, ['--skip-download', '--no-simulate'])
    expect(args).not.toContain('--simulate')
  })

  it('asks for the uploader’s and the ASR track by explicit key, in json3', () => {
    runOf(args, ['--write-subs', '--write-auto-subs', '--sub-langs', 'en,en-orig', '--sub-format', 'json3'])
  })

  it('names the files from the link key, with the folder kept apart', () => {
    runOf(args, ['-P', dir, '-o', `${key}.captions.%(ext)s`])
  })

  it('prints the WHOLE requested_subtitles dict after the video, marked', () => {
    // after_move never fires with --skip-download, and a hyphenated key in a
    // template is subtraction (both measured): the dict is parsed in TS.
    runOf(args, ['--print', `after_video:${SUBS_MARK}%(requested_subtitles)j`])
    expect(args.join(' ')).not.toContain('requested_subtitles.')
  })

  it('carries the download’s guards first, in order', () => {
    expect(runOf(args, GUARDS)).toBe(0)
  })

  it('never hands --sub-langs a regex', () => {
    expect(args.filter((a) => a === '--sub-langs')).toHaveLength(1)
    const langs = args[args.indexOf('--sub-langs') + 1]
    expect(langs).not.toMatch(/[.*+?^$|\\[\]()]/)
    for (const k of langs.split(',')) expect(isCaptionKey(k), k).toBe(true)
    // `en.*` pulled auto-TRANSLATED tracks (measured); `all` is everything.
    for (const bad of ['en.*', '.*', 'all', 'ALL', 'en$', '-en', 'en,fr', '', 'e', 'en-']) {
      expect(() => buildCaptionArgs(URL, [bad], dir, key), bad).toThrow()
    }
    expect(() => buildCaptionArgs(URL, [], dir, key)).toThrow()
  })

  it('refuses a link key that is not a plain filename stem', () => {
    for (const bad of ['a.b', 'a/b', 'a\\b', 'a:b', '', 'x%(id)s', 'a b']) {
      expect(() => buildCaptionArgs(URL, ['en'], dir, bad), bad).toThrow()
    }
  })
})

describe('which caption keys to ask for', () => {
  it('asks for the primary subtag as the uploader’s track and its -orig ASR', () => {
    // en-US measured: that video's ASR track was keyed en-orig.
    expect(captionKeys('en-US')).toEqual(['en', 'en-orig'])
    expect(captionKeys('hi')).toEqual(['hi', 'hi-orig'])
    expect(captionKeys('te')).toEqual(['te', 'te-orig'])
    expect(captionKeys('pt_BR')).toEqual(['pt', 'pt-orig'])
  })

  it('has nothing to ask for when the language is missing or unreadable', () => {
    for (const language of [null, undefined, '', 'all', 'en.*', '1x', 'english', '-en']) {
      expect(captionKeys(language), String(language)).toBeNull()
    }
  })
})

describe('reading the metadata and caption marks back', () => {
  it('reads all four marks, each as its own kind', () => {
    expect(readMarkedLine(`${META_MARK}{"id":"x"}`)).toEqual({ kind: 'meta', value: '{"id":"x"}' })
    expect(readMarkedLine(`${SUBS_MARK}NA`)).toEqual({ kind: 'subs', value: 'NA' })
    expect(readMarkedLine(`${FILE_MARK}/x.mp4`)?.kind).toBe('file')
    expect(readMarkedLine(`${TITLE_MARK}t`)?.kind).toBe('title')
    const marks = [FILE_MARK, TITLE_MARK, META_MARK, SUBS_MARK]
    for (const a of marks) for (const b of marks) if (a !== b) expect(b.startsWith(a), `${a} ${b}`).toBe(false)
    // The progress line's own prefix is not a mark.
    expect(readMarkedLine('@forge@downloading|1|2|NA|NA|NA')).toBeNull()
  })

  it('makes absent metadata explicit — yt-dlp omits the key, it does not print null', () => {
    const meta = parseMeta(
      JSON.stringify({ id: 'abc', title: 'A title', duration: 213, language: 'en', channel: 'C', uploader: 'U', webpage_url: CANONICAL })
    )
    expect(meta).toMatchObject({ id: 'abc', duration: 213, language: 'en', channel: 'C', uploader: 'U', webpage_url: CANONICAL })
    expect(meta.chapters).toEqual([])
    expect(meta.heatmap).toBeNull()
  })

  it('keeps well-formed chapters and heat, and drops the rest', () => {
    const meta = parseMeta(
      JSON.stringify({
        chapters: [
          { start_time: 0, end_time: 60, title: 'One' },
          { start_time: 60, end_time: 50, title: 'Backwards' },
          { start_time: 'x', end_time: 70 }
        ],
        heatmap: [{ start_time: 0, end_time: 2.14, value: 1 }, { start_time: 2.14 }]
      })
    )
    expect(meta.chapters).toEqual([{ start_time: 0, end_time: 60, title: 'One' }])
    expect(meta.heatmap).toEqual([{ start_time: 0, end_time: 2.14, value: 1 }])
    expect(() => parseMeta('not json')).toThrow()
    expect(() => parseMeta('[1,2]')).toThrow()
  })

  it('reads the written tracks from the dict, hyphenated keys included', () => {
    expect(parseRequestedSubtitles('NA')).toEqual([])
    const written = parseRequestedSubtitles(
      JSON.stringify({
        en: { ext: 'json3', name: 'English', filepath: 'C:\\u\\url\\k\\k.captions.en.json3' },
        'en-orig': { ext: 'json3', name: 'English (Original)', filepath: '/u/url/k/k.captions.en-orig.json3' },
        // Requested and not written: no filepath.
        fr: { ext: 'json3', name: 'French' }
      })
    )
    const keys = written.map((w) => w.key)
    expect(keys).toContain('en-orig')
    expect(keys).toContain('en')
    expect(keys).not.toContain('fr')
    expect(written.find((w) => w.key === 'en-orig')?.path).toBe('/u/url/k/k.captions.en-orig.json3')
  })
})

describe('a link’s caption folder name', () => {
  it('is a legal Windows filename whatever the link', () => {
    for (const url of [URL, 'https://vimeo.com/123?x=a|b', 'https://example.com/CON', 'https://example.com/nul.', 'https://youtu.be/-_-_-_-_-_-']) {
      const key = linkCacheKey(parseLink(url)!)
      expect(key, url).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(key, url).not.toMatch(/^(con|prn|aux|nul|com\d|lpt\d)$/i)
      expect(key, url).not.toMatch(/[. ]$/)
      expect(key.length, url).toBeLessThanOrEqual(64)
    }
  })

  it('tells apart two videos whose ids differ only in case — the disk does not', () => {
    const a = linkCacheKey(parseLink('https://youtu.be/abcDEF12345')!)
    const b = linkCacheKey(parseLink('https://youtu.be/ABCdef12345')!)
    expect(a.toLowerCase()).not.toBe(b.toLowerCase())
    // And one video pasted two ways is one folder.
    expect(linkCacheKey(parseLink('https://youtu.be/abcDEF12345?t=4')!)).toBe(a)
  })
})
