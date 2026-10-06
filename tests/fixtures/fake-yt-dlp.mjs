/**
 * A stand-in for yt-dlp that speaks the same lines.
 *
 * The real thing needs a network and a binary we cannot fetch in CI. What can
 * be tested without either is everything around it: the argv we build, the
 * progress lines we parse, the marked lines we read back, the kill on cancel,
 * and the partial files that have to be gone before the promise settles.
 *
 * So this reads the arguments the way yt-dlp would — `-P`, `-o`, the progress
 * template, the two `--print`s — and plays the part: prints the title, writes a
 * `.part` file, emits progress through the caller's OWN template (substituting
 * the same fields yt-dlp would), renames into place, prints the final path.
 *
 * Knobs, via environment:
 *   FAKE_STEPS      progress lines to emit (default 5)
 *   FAKE_DELAY_MS   pause between them (default 20) — raise it to test cancel
 *   FAKE_EXT        extension of the finished file (default mp4)
 *   FAKE_FAIL       exit 1 with an ERROR line instead of finishing
 *   FAKE_NO_PRINT   finish without printing the path, to test the fallback
 *   FAKE_TITLE      the title to print (default has every Windows-illegal char)
 *
 * Two more shapes, chosen by the flags the way yt-dlp's own behaviour is
 * (docs/CLIPS.md §7.1, measured with 2026.08.19):
 *
 *   `--simulate` with a `%(.{…})j` print — the metadata subset. Prints the
 *       asked-for keys of a made-up video and writes nothing; a key the video
 *       lacks is OMITTED, as yt-dlp does (no heatmap here).
 *   `--skip-download` with `--write-subs` — captions only. For each key in
 *       `--sub-langs` the video "has", writes `<-o stem>.<lang>.json3` through
 *       a `.part`, then prints `after_video:` with the whole
 *       `requested_subtitles` dict (with each `filepath`), or `NA` for none.
 *       A `-orig` key is an ASR-shaped track, any other an uploader's
 *       line-timed one — both built here from a made-up word list, never
 *       anyone's speech.
 *
 *   FAKE_META       JSON merged over the made-up video's metadata
 *   FAKE_SUBS       the caption keys the video has (default `en,en-orig`)
 *   FAKE_SUB_EXT    the format written instead of json3 (default json3) — a
 *                   site with no json3, whose fallback the runner must not keep
 *   FAKE_HOLD_MS    wait this long before printing: after writing captions
 *                   (to cancel with the files on disk), or before the
 *                   metadata (a stalled extractor, for the time bound)
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * slice(1), not slice(2).
 *
 * Under `node -e` there is no script path, so argv is [execPath, ...args] and
 * slice(2) silently dropped the first argument — the URL. The fake never read
 * it, so nothing failed; it just meant the integration test did not actually
 * prove the URL reaches the tool. It does now, and the check below fails loudly
 * if it ever stops.
 */
const argv = process.argv.slice(1)
const after = (flag) => {
  const at = argv.indexOf(flag)
  return at === -1 ? null : argv[at + 1]
}
const every = (flag) => argv.flatMap((a, i) => (a === flag ? [argv[i + 1]] : []))

const destDir = after('-P')
const template = after('-o') ?? '%(id)s.%(ext)s'
const progressTemplate = after('--progress-template') ?? ''
const prints = every('--print')

const steps = Number(process.env.FAKE_STEPS ?? 5)
const delay = Number(process.env.FAKE_DELAY_MS ?? 20)
const ext = process.env.FAKE_EXT ?? 'mp4'
const title = process.env.FAKE_TITLE ?? 'Fake | Title: "quoted"? *starred*'
const url = argv.find((a) => a.startsWith('http')) ?? ''

if (!destDir && !argv.includes('--simulate')) {
  process.stderr.write('ERROR: fake needs -P\n')
  process.exit(2)
}

/*
 * The URL has to be in there SOMEWHERE — but not necessarily first.
 *
 * yt-dlp's option parser takes flags before or after the positional argument,
 * so the fake must not invent an ordering the real tool does not have. What it
 * does assert is that a URL arrives at all: under `node -e` argv starts at the
 * first real argument, and an off-by-one here would silently mean the
 * integration tests never proved the link reaches the tool.
 */
if (!argv.some((a) => a.startsWith('http'))) {
  process.stderr.write(`ERROR: fake got no URL in ${JSON.stringify(argv.slice(0, 4))}\n`)
  process.exit(2)
}

const fill = (tpl, fields) =>
  tpl.replace(/%\(([a-z_.]+)\)s/g, (_, key) => (key in fields ? String(fields[key]) : 'NA'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------ metadata, no download */

if (argv.includes('--simulate')) {
  const meta = {
    id: 'dQw4w9WgXcQ',
    title,
    duration: 213,
    language: 'en-US',
    chapters: [
      { start_time: 0, end_time: 60, title: 'Opening' },
      { start_time: 60, end_time: 213, title: 'The rest' }
    ],
    channel: 'Fake channel',
    uploader: 'Fake uploader',
    webpage_url: url,
    ...JSON.parse(process.env.FAKE_META ?? '{}')
  }
  if (process.env.FAKE_FAIL) {
    process.stderr.write('ERROR: [youtube] fake: Video unavailable. This video is private\n')
    process.exit(1)
  }
  await sleep(Number(process.env.FAKE_HOLD_MS ?? 0))
  for (const p of prints) {
    // `%(.{a,b,c})j` — the subset, absent keys omitted, as yt-dlp prints it.
    const out = p.replace(/%\(\.\{([a-z_,]+)\}\)j/g, (_, keys) =>
      JSON.stringify(Object.fromEntries(keys.split(',').filter((k) => meta[k] !== undefined).map((k) => [k, meta[k]])))
    )
    process.stdout.write(fill(out, { title }) + '\n')
  }
  process.exit(0)
}

/* ------------------------------------------------- captions, no media */

const FAKE_WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima']

/** Six lines of six made-up words; the ASR track unpunctuated, the uploader's with full stops. */
function json3For(lang) {
  const lines = Array.from({ length: 6 }, (_, l) => Array.from({ length: 6 }, (_, w) => FAKE_WORDS[(l + w) % FAKE_WORDS.length]))
  if (lang.endsWith('-orig')) {
    const events = [{ tStartMs: 0, dDurationMs: 40_000, id: 1, wpWinPosId: 1, wsWinStyleId: 1 }]
    lines.forEach((words, l) => {
      const start = 1_000 + l * 5_000
      events.push({
        tStartMs: start,
        dDurationMs: 6_000,
        wWinId: 1,
        segs: words.map((w, k) => (k === 0 ? { utf8: w, acAsrConf: 0 } : { utf8: ` ${w}`, tOffsetMs: k * 300, acAsrConf: 0 }))
      })
      events.push({ tStartMs: start + 1_990, dDurationMs: 3_000, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] })
    })
    return { wireMagic: 'pb3', events }
  }
  return {
    wireMagic: 'pb3',
    events: lines.map((words, l) => ({
      tStartMs: 1_000 + l * 5_000,
      dDurationMs: 2_000,
      segs: [{ utf8: `${words.join(' ')}.` }]
    }))
  }
}

if (argv.includes('--skip-download')) {
  const wanted = (after('--sub-langs') ?? '').split(',').filter(Boolean)
  const have = new Set((process.env.FAKE_SUBS ?? 'en,en-orig').split(',').filter(Boolean))
  mkdirSync(destDir, { recursive: true })
  // yt-dlp names a track by swapping the media extension for `<lang>.<subext>`.
  const media = fill(template, { ext: 'webm', id: 'fake' })
  const subExt = process.env.FAKE_SUB_EXT ?? 'json3'
  const written = {}
  for (const lang of wanted) {
    if (!have.has(lang)) continue // a missing language is skipped silently
    const finalPath = join(destDir, media.replace(/\.[^.]+$/, `.${lang}.${subExt}`))
    writeFileSync(`${finalPath}.part`, subExt === 'json3' ? JSON.stringify(json3For(lang)) : 'WEBVTT\n\n')
    await sleep(delay)
    renameSync(`${finalPath}.part`, finalPath)
    written[lang] = { ext: subExt, url: 'https://example.invalid/timedtext', name: lang, filepath: finalPath }
  }
  await sleep(Number(process.env.FAKE_HOLD_MS ?? 0))
  if (process.env.FAKE_FAIL) {
    process.stderr.write('ERROR: [youtube] fake: Unable to download video subtitles: HTTP Error 429\n')
    process.exit(1)
  }
  for (const p of prints) {
    if (!p.startsWith('after_video:')) continue
    const dict = Object.keys(written).length > 0 ? JSON.stringify(written) : 'NA'
    process.stdout.write(p.slice('after_video:'.length).replace('%(requested_subtitles)j', dict) + '\n')
  }
  process.exit(0)
}

// yt-dlp prints the default-stage prints before downloading.
for (const p of prints) {
  if (!p.includes(':') || p.startsWith('@')) process.stdout.write(fill(p, { title }) + '\n')
}

mkdirSync(destDir, { recursive: true })
const finalName = fill(template, { ext, id: 'fake' })
const finalPath = join(destDir, finalName)
const partPath = join(destDir, finalName.replace(/\.[^.]+$/, `.f1.${ext}.part`))
writeFileSync(partPath, '')

const total = 100_000

const progressBody = progressTemplate.replace(/^download:/, '')

for (let i = 1; i <= steps; i++) {
  await sleep(delay)
  const downloaded = Math.round((total * i) / steps)
  writeFileSync(partPath, Buffer.alloc(downloaded))
  process.stdout.write(
    fill(progressBody, {
      'progress.status': 'downloading',
      'progress.downloaded_bytes': downloaded,
      'progress.total_bytes': total,
      'progress.total_bytes_estimate': 'NA',
      'progress.speed': 2048.5,
      'progress.eta': steps - i
    }) + '\n'
  )
}

if (process.env.FAKE_FAIL) {
  process.stderr.write('[youtube] fake: Downloading webpage\n')
  process.stderr.write('ERROR: [youtube] fake: Video unavailable. This video is private\n')
  process.exit(1)
}

process.stdout.write(
  fill(progressBody, {
    'progress.status': 'finished',
    'progress.downloaded_bytes': total,
    'progress.total_bytes': total,
    'progress.total_bytes_estimate': 'NA',
    'progress.speed': 'NA',
    'progress.eta': 'NA'
  }) + '\n'
)

renameSync(partPath, finalPath)

if (!process.env.FAKE_NO_PRINT) {
  for (const p of prints) {
    if (p.startsWith('after_move:')) {
      process.stdout.write(fill(p.slice('after_move:'.length), { filepath: finalPath }) + '\n')
    }
  }
}
process.exit(0)
