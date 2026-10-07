import { describe, it, expect, beforeAll, afterAll, type TestContext } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatFor } from '@shared/ingest/format'
import { ensureYtDlp, type YtDlpTool } from '../../src/main/ingest/binary'

/**
 * What the REAL yt-dlp picks, given our selector.
 *
 * Asserting the selector string only proves it is the string we wrote. The two
 * bugs this file exists for were both cases where the string looked entirely
 * reasonable and chose the wrong format — or no format at all:
 *
 *   1. A 4K request satisfied by a 1080p stream, because `/` is fallback-only.
 *   2. EVERY VERTICAL VIDEO refused, because `height<=1080` is false for a
 *      1080p reel, which is 1080 wide and 1920 tall.
 *
 * Neither is visible in the string. Both are obvious the moment yt-dlp is asked
 * to choose. `--load-info-json` runs its real format selection against a format
 * table we write, so this needs no network and no actual video.
 *
 * Which yt-dlp: the app's own way of finding one, `ensureYtDlp()` —
 * FORGE_YTDLP, a managed copy, PATH, or fetched from GitHub and checked against
 * its published checksums — with userData pointed at a temp folder, so a fetch
 * never lands in the real one (as exactCut.int.test.ts). CI installs no yt-dlp
 * (ci.yml sets up Python with no pip install), so there it is fetched.
 */

const run = promisify(execFile)

let dir = ''
let tool: YtDlpTool | null = null
let toolReason: string | null = null
const savedUserData = process.env.FORGE_TEST_USERDATA
const inCi = !!process.env.CI && process.env.CI !== 'false'

/** One format table, in yt-dlp's own shape. */
async function infoFile(
  name: string,
  formats: {
    format_id: string
    width: number | null
    height: number | null
    vcodec: string
    acodec: string
    ext?: string
  }[]
): Promise<string> {
  const path = join(dir, `${name}.json`)
  await writeFile(
    path,
    JSON.stringify({
      id: name,
      title: name,
      extractor: 'test',
      extractor_key: 'Test',
      webpage_url: `https://example.invalid/${name}`,
      _type: 'video',
      formats: formats.map((f) => ({
        ext: 'mp4',
        protocol: 'https',
        url: `https://example.invalid/${f.format_id}`,
        ...f
      }))
    })
  )
  return path
}

/** Which format id yt-dlp actually settles on, or the error it gives. */
async function chosen(info: string, quality: Parameters<typeof formatFor>[1]): Promise<string> {
  const format = formatFor('video', quality)
  const args = ['--load-info-json', info, '-f', format.selector]
  if (format.sort) args.push('-S', format.sort)
  args.push('--simulate', '--print', '%(format_id)s %(width)sx%(height)s')
  try {
    const { stdout } = await run(tool!.path, args)
    return stdout.trim().split('\n').pop() ?? ''
  } catch (err) {
    return `ERROR ${(err as { stderr?: string }).stderr?.trim().split('\n').pop() ?? err}`
  }
}

const AUDIO = { format_id: 'aac', width: null, height: null, vcodec: 'none', acodec: 'mp4a.40.2' }

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-ytdlp-'))
  // A managed copy, if one has to be fetched, lands in this temp userData — never the real one.
  process.env.FORGE_TEST_USERDATA = join(dir, 'userData')
  try {
    tool = await ensureYtDlp()
  } catch (err) {
    toolReason = `no yt-dlp: ${err instanceof Error ? err.message : String(err)}`
  }
  // Longer than ensureYtDlp can take at its worst (binary.ts: three 15 s `--version` checks, then 60 s
  // for the checksums, 300 s for the binary and 15 s to run it), so a slow fetch reaches need()'s reason
  // rather than a bare "Hook timed out".
}, 600_000)

afterAll(async () => {
  if (savedUserData === undefined) delete process.env.FORGE_TEST_USERDATA
  else process.env.FORGE_TEST_USERDATA = savedUserData
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
})

let told = false

/*
 * Run, or say why not. Without a yt-dlp the case is SKIPPED, with the reason —
 * not returned from, which counted as a pass and so certified a selector
 * nothing had checked. Under CI (`CI` set, as GitHub Actions sets it) it
 * FAILS with that reason instead: there the tool is fetched, and a fetch that
 * fails must not leave this file green.
 */
function need(ctx: TestContext): void {
  if (tool) return
  const text = `ytdlpFormat: ${toolReason ?? 'no yt-dlp'}`
  if (inCi) throw new Error(`${text} — under CI these cases must run (see the note at the top of ytdlpFormat.int.test.ts)`)
  if (!told) {
    told = true
    // Written, not console.log: the default reporter shows a raw write and hides a skipped test's log.
    process.stderr.write(`ytdlpFormat.int: SKIPPED — ${toolReason ?? 'no yt-dlp'}\n`)
  }
  ctx.skip(text)
}

const withYtDlp = (name: string, body: () => Promise<void>): void => {
  it(name, async (ctx) => {
    need(ctx)
    await body()
  }, 60_000)
}

describe('what yt-dlp actually chooses', () => {
  withYtDlp('gets a vertical video at the rung that was asked for', async () => {
    /*
     * The bug that made this file. `res` in a yt-dlp sort is the LOWER of
     * height and width, which is what "1080p" means for a reel. A height
     * filter is not: a 1080p reel is 1920 tall and fails it.
     */
    const vertical = await infoFile('vertical', [
      { format_id: 'v360', width: 360, height: 640, vcodec: 'avc1.4d401e', acodec: 'none' },
      { format_id: 'v720', width: 720, height: 1280, vcodec: 'avc1.4d401f', acodec: 'none' },
      { format_id: 'v1080', width: 1080, height: 1920, vcodec: 'avc1.640028', acodec: 'none' },
      AUDIO
    ])
    expect(await chosen(vertical, '1080p')).toBe('v1080+aac 1080x1920')
    expect(await chosen(vertical, '720p')).toBe('v720+aac 720x1280')
    expect(await chosen(vertical, '480p')).toBe('v360+aac 360x640')
  })

  withYtDlp('downloads a single pre-muxed stream, which is what most sites serve', async () => {
    // An Instagram reel: one already-merged file, vertical. Under the old
    // selector this was "Requested format is not available".
    const reel = await infoFile('reel', [
      { format_id: 'muxed', width: 720, height: 1280, vcodec: 'avc1.4d401f', acodec: 'mp4a.40.2' }
    ])
    expect(await chosen(reel, '1080p')).toBe('muxed 720x1280')
  })

  withYtDlp('still returns 4K for a 4K request, rather than the 1080p beneath it', async () => {
    /*
     * The FIRST bug. `/` is fallback-only, so an H.264-first chain was
     * satisfied by the 1080p avc1 stream and never looked at the 2160p vp9 one.
     * A sort cannot fall into that, and this is what proves the new shape did
     * not reintroduce it.
     */
    const ladder = await infoFile('ladder', [
      { format_id: 'h1080', width: 1920, height: 1080, vcodec: 'avc1.640028', acodec: 'none' },
      { format_id: 'v2160', width: 3840, height: 2160, vcodec: 'vp09.00.50.08', acodec: 'none' },
      AUDIO
    ])
    expect(await chosen(ladder, '2160p')).toBe('v2160+aac 3840x2160')
    expect(await chosen(ladder, '1080p')).toBe('h1080+aac 1920x1080')
  })

  withYtDlp('prefers H.264 over VP9 at the same size, without demanding it', async () => {
    // A preference, not a filter: ranked first where it exists, and a site
    // with nothing but VP9 still downloads.
    const both = await infoFile('both', [
      { format_id: 'vp9', width: 1920, height: 1080, vcodec: 'vp09.00.50.08', acodec: 'none' },
      { format_id: 'avc', width: 1920, height: 1080, vcodec: 'avc1.640028', acodec: 'none' },
      AUDIO
    ])
    expect(await chosen(both, '1080p')).toBe('avc+aac 1920x1080')

    const vp9Only = await infoFile('vp9only', [
      { format_id: 'vp9', width: 1920, height: 1080, vcodec: 'vp09.00.50.08', acodec: 'none' },
      AUDIO
    ])
    expect(await chosen(vp9Only, '1080p')).toBe('vp9+aac 1920x1080')
  })

  withYtDlp('refuses an AV1-only video rather than importing something unplayable', async () => {
    /*
     * The one case that should still fail. The Windows ffmpeg is a 2018
     * snapshot with no AV1 decoder, so an AV1 download would succeed and then
     * be unplayable and unexportable — a worse failure, and a much later one.
     */
    const av1 = await infoFile('av1', [
      { format_id: 'av01', width: 1920, height: 1080, vcodec: 'av01.0.12M.08', acodec: 'none' },
      AUDIO
    ])
    expect(await chosen(av1, '1080p')).toMatch(/ERROR/)
  })
})
