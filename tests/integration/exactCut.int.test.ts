import { describe, it, expect, beforeAll, afterAll, type TestContext } from 'vitest'
import { createReadStream, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { downloadMedia } from '../../src/main/ingest/download'
import { ensureYtDlp, type YtDlpTool } from '../../src/main/ingest/binary'
import type { IngestRequest } from '@shared/ingest/args'
import { offsetIntoDownload, trimToRequestedRange, type Range } from '@shared/ingest/section'
import { FFMPEG, outputDir, run, writeNote } from './output'

/*
 * The exact cut, through the REAL yt-dlp and OUR ffmpeg (docs/CLIPS.md §7.7,
 * §16.13; the measurement on YouTube is docs/EFFECTS.md §41).
 *
 * Clip it downloads a run of words with `--download-sections` and
 * `--force-keyframes-at-cuts` (section.ts), which yt-dlp hands to the ffmpeg
 * named by `--ffmpeg-location` — the bundled one, so on Windows the 2018
 * master build, which nothing else has ever run under a section cut. Every
 * other Clip it test uses the fake yt-dlp and so never cuts anything.
 *
 * The clip is made here, lossless, and every frame names itself: twelve bars,
 * bar b white when bit b of the frame's index is set. A re-encode cannot blur
 * a bar from black to white, so the index reads back off any cut. Its sound is
 * a two-kilohertz chirp whose phase starts again every second, from a base of
 * 200, 300, 400, 500 or 600 Hz by the second (a five-second cycle), so 150 ms
 * of it says where in the source it came from, to the sample, within ±2.5 s.
 * A chirp that was the same every second could not see a whole second's slip:
 * that version passed the "one second late" mutation on its sound.
 *
 * The download is `downloadMedia` itself — the app's argv, built by
 * `buildYtDlpArgs`, with `--ffmpeg-location` the bundled binary — with one
 * prefix: `--load-info-json`, a format table in YouTube's shape (a video-only
 * and an audio-only stream, so FFmpegFD runs the two-input `-ss … -i … -ss …
 * -i …` it runs for YouTube). Not the generic extractor on a plain link:
 * measured with yt-dlp 2026.08.19, a direct link to an mp4 comes back with no
 * vcodec, and the app's `-f` filter `[vcodec!*=av01]` drops a format whose
 * codec is unknown, so the app's own argv answers "Requested format is not
 * available" (an html5 page does the same; EFFECTS.md §41). The link in the
 * argv is still there; yt-dlp ignores it with a warning.
 *
 * Two legs, the same four checks each:
 *   file  the streams as `file:` URLs. Runs wherever yt-dlp runs, the dev
 *         sandbox included, so the checks are mutation-checked there.
 *   http  the same streams served over node:http on 127.0.0.1, port 0, with
 *         Range — how ffmpeg reads YouTube's streams. The dev sandbox refuses
 *         to bind a port (listen EPERM); CI does not.
 *
 * How it decides to run: yt-dlp is `ensureYtDlp()` (FORGE_YTDLP, a managed copy,
 * PATH, or fetched from GitHub and checked against its published checksums,
 * into a temp userData — under CI one in FORGE_TEST_YTDLP_CACHE, where
 * actions/cache keeps the managed copy from this week's last green run, so CI
 * usually runs that and fetches only on a miss: ci.yml, docs/INGEST.md), and
 * the http leg needs the port. Without either the
 * leg is SKIPPED with the reason printed — except under CI (`CI` set, as
 * GitHub Actions sets it), where a leg that cannot run FAILS with that reason:
 * this file is the 2018 build's only measurement, and a quiet skip there would
 * leave §16.13 open with a green tick on it.
 *
 * Which binary does what. The bundled ffmpeg (`FFMPEG`, the 2018 build on
 * Windows) makes the fixture, makes every cut (yt-dlp runs it), and reads back
 * the frame indices, the first frame's time and the sound — as the app's
 * renders read a cut, edit lists and all. Only `firstVideoPacket` goes through
 * @ffprobe-installer's ffprobe, which is another build on every platform
 * (5.1.0 on win32-x64), so "the first packet is a keyframe at t >= 0" is that
 * demuxer's reading of the file, not the 2018 one's.
 */

const W = 384
const H = 64
const BAR = 32
const BITS = W / BAR
const SECONDS = 30
const RATE = 48000
/**
 * The sound's start, against the source: one millisecond is 48 samples. Measured on YouTube it is
 * 0.00 ms on every cut (§41); an AAC encoder delay left in would be 21 ms, a frame-sized slip 33.
 */
const AUDIO_TOLERANCE_MS = 1

const inCi = !!process.env.CI && process.env.CI !== 'false'

let dir = ''
let media = ''
let tool: YtDlpTool | null = null
let toolReason: string | null = null
let server: Server | null = null
let port = 0
let portReason: string | null = null
const requests: { name: string; range: string | null }[] = []
const lines: string[] = []
let sourceAudio: Float32Array = new Float32Array(0)
const savedUserData = process.env.FORGE_TEST_USERDATA

/** Each frame's index, read off its bars, in the order ffmpeg presents them (edit lists honoured). */
async function indices(file: string): Promise<number[]> {
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-vsync', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }
  )
  const buf = stdout as unknown as Buffer
  const out: number[] = []
  for (let f = 0; (f + 1) * W * H <= buf.length; f++) {
    let index = 0
    for (let b = 0; b < BITS; b++) {
      // The bar's middle: away from its edges, where a lossy encode rings.
      let sum = 0
      let n = 0
      for (let y = H / 4; y < (3 * H) / 4; y++) {
        for (let x = b * BAR + BAR / 4; x < (b + 1) * BAR - BAR / 4; x++) {
          sum += buf[f * W * H + y * W + x]
          n++
        }
      }
      if (sum / n > 128) index |= 1 << b
    }
    out.push(index)
  }
  return out
}

/**
 * The first video packet's pts and whether it is a keyframe — negative is pre-roll an edit list hides.
 * Read by @ffprobe-installer's ffprobe, NOT the bundled ffmpeg: a newer demuxer than the 2018 build's.
 */
async function firstVideoPacket(file: string): Promise<{ pts: number; key: boolean }> {
  const { stdout } = await run(ffprobeInstaller.path, [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', file
  ])
  const packets = String(stdout)
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const [pts, flags] = l.split(',')
      return { pts: Number(pts), key: (flags ?? '').includes('K') }
    })
    .filter((p) => Number.isFinite(p.pts))
  return packets.reduce((a, b) => (b.pts < a.pts ? b : a))
}

/**
 * The first video frame's presentation time as the BUNDLED ffmpeg presents it: `showinfo`'s pts_time
 * for the first decoded frame (presentation order), timestamps kept as the demuxer gives them
 * (`-copyts`). An exact cut that starts between frames places its first frame with an EMPTY EDIT
 * (§41), so this is the bundled demuxer's reading of the edit list — on Windows, the 2018 build's,
 * which is what the app's renders use. Measured on the Mac: the same 0.033008 s ffprobe reports.
 */
async function firstFramePts(file: string): Promise<number> {
  const { stderr } = await run(FFMPEG, [
    '-hide_banner', '-nostats', '-loglevel', 'info', '-copyts', '-i', file,
    '-map', '0:v:0', '-vf', 'showinfo', '-frames:v', '1', '-f', 'null', '-'
  ])
  const m = /pts_time:\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)/.exec(String(stderr))
  if (!m) throw new Error(`showinfo gave no pts_time for ${file}: ${String(stderr).slice(-400)}`)
  return Number(m[1])
}

/** A binary's own first `-version` line, for the note. */
async function versionLine(bin: string): Promise<string> {
  try {
    const { stdout } = await run(bin, ['-version'])
    return String(stdout).split(/\r?\n/)[0]
  } catch (err) {
    return `? (${err instanceof Error ? err.message : String(err)})`
  }
}

/** Mono f32 at 48 kHz, as ffmpeg decodes it (priming trimmed by the edit list). */
async function pcm(file: string): Promise<Float32Array> {
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
  )
  const buf = stdout as unknown as Buffer
  // Copied, not viewed: the Buffer's offset into its pool need not be four-aligned.
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4)))
}

/** In-place radix-2 FFT (n a power of two); `inverse` scales by 1/n. */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const step = ((inverse ? 2 : -2) * Math.PI) / size
    for (let k = 0; k < half; k++) {
      const wr = Math.cos(step * k)
      const wi = Math.sin(step * k)
      for (let i = k; i < n; i += size) {
        const j = i + half
        const br = re[j] * wr - im[j] * wi
        const bi = re[j] * wi + im[j] * wr
        re[j] = re[i] - br
        im[j] = im[i] - bi
        re[i] += br
        im[i] += bi
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n)
}

/**
 * Where in the SOURCE 150 ms of a cut's sound came from: the lag of best
 * normalised correlation within ±2.45 s of `expectS` — under half the chirp's
 * five-second cycle, so the answer is unique — at every sample, by FFT.
 */
function whereInSource(cut: Float32Array, atS: number, expectS: number): { sourceS: number; corr: number } {
  const len = Math.round(0.15 * RATE)
  const from = Math.round(atS * RATE)
  const seg = cut.subarray(from, from + len)
  const mean = seg.reduce((a, b) => a + b, 0) / len
  const lo = Math.max(0, Math.round((expectS - 2.45) * RATE))
  const hi = Math.min(sourceAudio.length - len, Math.round((expectS + 2.45) * RATE))
  const ref = sourceAudio.subarray(lo, hi + len)
  let n = 1
  while (n < ref.length + len) n <<= 1
  const [ar, ai, br, bi] = [new Float64Array(n), new Float64Array(n), new Float64Array(n), new Float64Array(n)]
  ar.set(ref)
  let sNorm = 0
  for (let i = 0; i < len; i++) {
    br[i] = seg[i] - mean
    sNorm += br[i] * br[i]
  }
  sNorm = Math.sqrt(sNorm)
  fft(ar, ai, false)
  fft(br, bi, false)
  // ref ⋆ seg = IFFT(REF · conj(SEG))
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] + ai[i] * bi[i]
    const m = ai[i] * br[i] - ar[i] * bi[i]
    ar[i] = r
    ai[i] = m
  }
  fft(ar, ai, true)
  let sum = 0
  let sq = 0
  for (let i = 0; i < len; i++) (sum += ref[i]), (sq += ref[i] * ref[i])
  let best = { lag: 0, corr: -2 }
  for (let lag = 0; lag + len <= ref.length; lag++) {
    if (lag > 0) {
      const out = ref[lag - 1]
      const inn = ref[lag + len - 1]
      sum += inn - out
      sq += inn * inn - out * out
    }
    const corr = ar[lag] / (sNorm * Math.sqrt(Math.max(1e-12, sq - (sum * sum) / len)))
    if (corr > best.corr) best = { lag, corr }
  }
  return { sourceS: (lo + best.lag) / RATE, corr: best.corr }
}

type Leg = 'file' | 'http'

/** yt-dlp's format table for one fixture, its streams reachable over `leg`. */
async function infoJson(leg: Leg, video: string, fps: number): Promise<string> {
  const url = (name: string): string =>
    leg === 'http'
      ? `http://127.0.0.1:${port}/${name}`
      : // `file:` + the path, not a file:// URL. yt-dlp hands a format's URL to ffmpeg as it is,
        // and ffmpeg strips `file:` and opens the rest as a path (yt-dlp's own note, external.py),
        // so a space stays a space — measured here with this checkout's; a file:// URL's %20 made
        // ffmpeg exit 1. A bare path is refused (yt-dlp asks urllib for its cookies: "unknown url
        // type"). The Windows form,
        // `file:D:/a/…`, is by that reading and unmeasured until CI runs it.
        `file:${join(media, name).replace(/\\/g, '/')}`
  const path = join(dir, `info-${leg}-${fps}.json`)
  await writeFile(
    path,
    JSON.stringify({
      id: `exact-cut-${fps}`,
      title: `exact cut fixture ${fps} fps`,
      extractor: 'generic',
      extractor_key: 'Generic',
      webpage_url: `http://127.0.0.1/exact-cut/${fps}`,
      _type: 'video',
      formats: [
        // What YouTube's extractor gives: codecs known, video and audio apart.
        { format_id: `v${fps}`, ext: 'mp4', vcodec: 'avc1.f4001e', acodec: 'none', width: W, height: H, fps, url: url(video), protocol: 'http' },
        { format_id: 'a', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', url: url('audio.m4a'), protocol: 'http' }
      ]
    })
  )
  return path
}

interface Cut {
  file: string
  frames: number[]
  audio: Float32Array
}

/** One Clip it download, exactly as the app runs it, plus the format table. */
async function cut(leg: Leg, fps: number, range: Range, exact: boolean): Promise<Cut> {
  if (!tool) throw new Error('no yt-dlp')
  const video = `video${fps}.mp4`
  const request: IngestRequest = { url: `http://127.0.0.1:${port || 9}/exact-cut/${fps}`, kind: 'video', quality: '1080p', range, exact }
  const dest = join(dir, leg, `${fps}fps-${exact ? 'exact' : 'fast'}-${range.startMs}`)
  const handle = downloadMedia(request, { command: tool.path, prefixArgs: ['--load-info-json', await infoJson(leg, video, fps)] }, () => undefined, {
    destDir: dest
  })
  const outcome = await handle.promise
  return { file: outcome.path, frames: await indices(outcome.path), audio: await pcm(outcome.path) }
}

const told = new Set<Leg>()

/** Run, or say why not: skipped with the reason, or failed with it under CI. */
function need(leg: Leg, ctx: TestContext): void {
  const reason = toolReason ?? (leg === 'http' ? portReason : null)
  if (!reason) return
  const text = `exactCut (${leg}): ${reason}`
  if (inCi) throw new Error(`${text} — under CI this leg must run (see the note at the top of exactCut.int.test.ts)`)
  if (!told.has(leg)) {
    told.add(leg)
    // Written, not console.log: the default reporter shows a raw write and hides a skipped test's log.
    process.stderr.write(`exactCut.int: the ${leg} leg is SKIPPED — ${reason}\n`)
    lines.push(`- ${leg}: skipped — ${reason}`)
  }
  ctx.skip(text)
}

/** The fixture: lossless, keyframes every two seconds, each frame's index in its bars. */
async function makeVideo(fps: number): Promise<void> {
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:rate=${fps}:duration=${SECONDS}`,
    '-vf', `geq=lum='if(mod(floor(N/pow(2,floor(X/${BAR}))),2),235,16)':cb=128:cr=128`,
    // Keyframes every two seconds and nowhere else: every frame differs from the last, so x264's
    // scene-cut detection would otherwise put one wherever it liked — the cut at 12.4 s included.
    '-c:v', 'libx264', '-qp', '0', '-g', String(2 * fps), '-keyint_min', String(2 * fps), '-sc_threshold', '0',
    '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart',
    join(media, `video${fps}.mp4`)
  ])
}

beforeAll(async () => {
  dir = await outputDir('exact-cut')
  media = join(dir, 'media')
  await mkdir(media, { recursive: true })
  await makeVideo(30)
  await makeVideo(60)
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    // Phase 2π((200 + 100·k)·τ + 1000·τ²), τ the time within the second, k the second mod 5: a sweep
    // of 2 kHz a second from a base that names the second.
    '-f', 'lavfi', '-i', `aevalsrc=exprs='0.5*sin(2*PI*((200+100*mod(floor(t),5))*mod(t,1)+1000*mod(t,1)*mod(t,1)))':s=${RATE}:d=${SECONDS}`,
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    join(media, 'audio.m4a')
  ])
  sourceAudio = await pcm(join(media, 'audio.m4a'))

  // A managed copy, if one has to be fetched, lands in a temp userData — never the real one. Under CI
  // the folder is FORGE_TEST_YTDLP_CACHE, which ci.yml keeps between runs (docs/INGEST.md).
  process.env.FORGE_TEST_USERDATA = join(process.env.FORGE_TEST_YTDLP_CACHE || tmpdir(), 'forge-exactcut-userdata')
  try {
    tool = await ensureYtDlp()
    lines.push(`yt-dlp ${tool.version ?? '?'} (${tool.source}), ffmpeg ${FFMPEG}`)
  } catch (err) {
    toolReason = `no yt-dlp: ${err instanceof Error ? err.message : String(err)}`
  }
  lines.push(
    `- cuts, frame indices, first-frame times and sound: the bundled ffmpeg, "${await versionLine(FFMPEG)}"`,
    `- first video packet only: @ffprobe-installer's ffprobe, "${await versionLine(ffprobeInstaller.path)}" — another build`
  )

  const srv = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '/').split('?')[0].slice(1))
    const file = /^[A-Za-z0-9.]+$/.test(name) ? join(media, name) : null
    let size = 0
    try {
      size = file ? statSync(file).size : 0
    } catch {
      size = 0
    }
    if (!file || size === 0) {
      res.writeHead(404).end()
      return
    }
    const type = name.endsWith('.m4a') ? 'audio/mp4' : 'video/mp4'
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    requests.push({ name, range: req.headers.range ?? null })
    let start = 0
    let end = size - 1
    if (m) {
      start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
      end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
      if (start >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
        return
      }
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size })
    }
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    const stream = createReadStream(file, { start, end })
    res.on('close', () => stream.destroy())
    stream.pipe(res)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      srv.once('error', reject)
      srv.listen(0, '127.0.0.1', () => resolve())
    })
    server = srv
    const address = srv.address()
    port = typeof address === 'object' && address ? address.port : 0
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    portReason = `this machine will not bind a local port (listen ${code ?? String(err)}) — the dev sandbox refuses it; CI does not`
  }
  // Longer than ensureYtDlp takes at its worst on a runner's link (binary.ts, FETCH_RETRY): three 15 s
  // `--version` checks while locating, the fetch's 360 s for trying (every try, wait and wait for an
  // answer), at most 60 s of a body gone silent, and 15 s to run it — 480 s, held to this hook by
  // ytdlpBinary.test.ts. A body still arriving is not cut off at any total time, and on a runner's
  // link it is quick. A shorter hook would time out first and print a bare "Hook timed out" on every
  // test instead of the reason need() gives.
}, 600_000)

afterAll(async () => {
  if (savedUserData === undefined) delete process.env.FORGE_TEST_USERDATA
  else process.env.FORGE_TEST_USERDATA = savedUserData
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  if (dir) {
    const ranged = requests.filter((r) => r.range && r.range !== 'bytes=0-').length
    await writeNote(dir, [
      '# exact-cut',
      '',
      `Clip it's download through the real yt-dlp and the bundled ffmpeg (${process.platform}). The fixture (media/) is lossless,`,
      'each frame\'s index in twelve bars, keyframes every 2 s; its sound a chirp restarting every second from a base that names the second. Each cut\'s first',
      'frame is read off its bars and compared with the frame asked for; its sound is found in the source by correlation.',
      '',
      ...lines,
      ...(server ? [`- http: ${requests.length} requests served, ${ranged} of them ranged past byte 0`] : [])
    ])
  }
})

for (const leg of ['file', 'http'] as const) {
  describe(`Clip it's cut, its streams over ${leg}`, () => {
    it('exact, 12.4 s (not a keyframe, not a whole second): the first frame IS frame 372, and the sound starts at 12.4 s', async (ctx) => {
      need(leg, ctx)
      const range = { startMs: 12_400, endMs: 14_400 }
      const c = await cut(leg, 30, range, true)
      const at0 = whereInSource(c.audio, 0, range.startMs / 1000)
      const packet = await firstVideoPacket(c.file)
      lines.push(`- ${leg}, 30 fps, exact 12.4–14.4: first frame ${c.frames[0]}, ${c.frames.length} frames; sound at file 0 = source ${at0.sourceS.toFixed(5)} s (corr ${at0.corr.toFixed(4)}); first video packet ${packet.pts} s${packet.key ? ', key' : ''}`)
      expect.soft(c.frames[0], 'the first frame').toBe(372)
      // Frame for frame from there: nothing dropped, nothing doubled at the cut.
      expect.soft(c.frames.slice(0, 60)).toEqual(Array.from({ length: 60 }, (_, i) => 372 + i))
      expect.soft(Math.abs(at0.sourceS * 1000 - range.startMs), `sound at file 0 is source ${at0.sourceS} s`).toBeLessThan(AUDIO_TOLERANCE_MS)
      expect.soft(at0.corr).toBeGreaterThan(0.9)
      // What --force-keyframes-at-cuts buys: the first packet is a keyframe at t = 0, with no seconds
      // of pre-roll for an edit list to hide (without it: a copy from the keyframe before, §41). Small
      // edit lists remain even so — x264's two-frame composition delay, AAC's 1024-sample priming.
      expect.soft(packet.pts, 'the first video packet').toBeGreaterThanOrEqual(0)
      expect.soft(packet.key).toBe(true)
    })

    it('fast, 12.4 s: the file begins PAD_MS early, and the clip’s in-point lands on frame 372', async (ctx) => {
      need(leg, ctx)
      const range = { startMs: 12_400, endMs: 14_400 }
      const c = await cut(leg, 30, range, false)
      // What the app does with a fast cut: the in-point is offsetIntoDownload, in frames.
      const { inPoint } = trimToRequestedRange(range, c.frames.length, 30)
      const head = Math.round((offsetIntoDownload(range) / 1000) * 30)
      const atHead = whereInSource(c.audio, offsetIntoDownload(range) / 1000, range.startMs / 1000)
      lines.push(`- ${leg}, 30 fps, fast 12.4–14.4: first frame ${c.frames[0]}, in-point ${inPoint} shows frame ${c.frames[inPoint]}; sound at file ${offsetIntoDownload(range) / 1000} s = source ${atHead.sourceS.toFixed(5)} s (corr ${atHead.corr.toFixed(4)}); first video packet ${(await firstVideoPacket(c.file)).pts} s`)
      expect.soft(c.frames[0], 'the first frame').toBe(372 - head)
      expect.soft(c.frames[inPoint], 'the frame at the clip’s in-point').toBe(372)
      expect.soft(Math.abs(atHead.sourceS * 1000 - range.startMs), `sound at the in-point is source ${atHead.sourceS} s`).toBeLessThan(AUDIO_TOLERANCE_MS)
    })

    it('exact, 12.41 s (between frames): the first frame is the next one, 373, and the sound starts at 12.41 s', async (ctx) => {
      need(leg, ctx)
      const range = { startMs: 12_410, endMs: 14_410 }
      const c = await cut(leg, 30, range, true)
      const at0 = whereInSource(c.audio, 0, range.startMs / 1000)
      const pts = await firstFramePts(c.file)
      lines.push(`- ${leg}, 30 fps, exact 12.41–14.41: first frame ${c.frames[0]} at file ${pts} s (true place ${(373 / 30 - 12.41).toFixed(4)} s); sound at file 0 = source ${at0.sourceS.toFixed(5)} s`)
      expect.soft(c.frames[0], 'the first frame').toBe(373)
      expect.soft(Math.abs(at0.sourceS * 1000 - range.startMs), `sound at file 0 is source ${at0.sourceS} s`).toBeLessThan(AUDIO_TOLERANCE_MS)
      // Placed within half a frame of where it belongs against the sound. §41: the encoder rounds the
      // frame to its own tick, and the muxer writes that offset as an EMPTY EDIT in whole milliseconds
      // (33 ms here, so 0.033008 s, not 1/30). A reader that ignores edit lists shows it at 0.0667 s,
      // the composition delay, and the sound 1024 samples late (Mac ffmpeg, `-ignore_editlist 1`).
      expect.soft(Math.abs(pts - (373 / 30 - 12.41)), `first frame at ${pts} s`).toBeLessThanOrEqual(0.5 / 30 + 0.001)
    })

    it('exact at 60 fps, 12.4 s: the first frame IS frame 744', async (ctx) => {
      need(leg, ctx)
      const range = { startMs: 12_400, endMs: 13_400 }
      const c = await cut(leg, 60, range, true)
      const at0 = whereInSource(c.audio, 0, range.startMs / 1000)
      lines.push(`- ${leg}, 60 fps, exact 12.4–13.4: first frame ${c.frames[0]}, ${c.frames.length} frames; sound at file 0 = source ${at0.sourceS.toFixed(5)} s`)
      expect.soft(c.frames[0], 'the first frame').toBe(744)
      expect.soft(c.frames.slice(0, 60)).toEqual(Array.from({ length: 60 }, (_, i) => 744 + i))
      expect.soft(Math.abs(at0.sourceS * 1000 - range.startMs), `sound at file 0 is source ${at0.sourceS} s`).toBeLessThan(AUDIO_TOLERANCE_MS)
    })
  })
}

describe('the fixture reads back', () => {
  // Both sources: the cut checks pass whether or not 12.4 s is a keyframe, so only this sees
  // scene-cut keyframes let back into either encode (measured: all four cut checks still passed).
  for (const fps of [30, 60]) {
    it(`every frame of the ${fps} fps source names itself, and its keyframes are every two seconds — so 12.4 s is not one`, async () => {
      const frames = await indices(join(media, `video${fps}.mp4`))
      expect(frames).toEqual(Array.from({ length: SECONDS * fps }, (_, i) => i))
      const { stdout } = await run(ffprobeInstaller.path, [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', join(media, `video${fps}.mp4`)
      ])
      const keys = String(stdout)
        .split(/\r?\n/)
        .filter((l) => l.includes('K'))
        .map((l) => Math.round(Number(l.split(',')[0]) * fps))
        .sort((a, b) => a - b)
      expect(keys).toEqual(Array.from({ length: SECONDS / 2 }, (_, i) => i * 2 * fps))
    })
  }
})
