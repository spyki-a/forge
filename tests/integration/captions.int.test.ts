import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { buildRenderPlan } from '@shared/render/plan'
import { buildTimelineCaptions, escapeFilterPath } from '@shared/captions/timeline'
import { DEFAULT_CAPTION_STYLE } from '@shared/captions/style'
import { segmentIntoSentences, type Word } from '@shared/transcript'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'

const run = promisify(execFile)
/** A libass burn in a plan: the `ass` filter, or the `subtitles` one it replaced. */
const LIBASS_FILTER = /\b(?:ass|subtitles)=filename=/
const FFMPEG = ffmpegInstaller.path
const FFPROBE = ffprobeInstaller.path

let dir = ''
let source = ''

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-caps-'))
  source = join(dir, 'src.mp4')
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=#202830:size=1280x720:rate=30:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source
  ])
}, 180_000)

afterAll(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
})

function words(spec: [string, number, number][]): Word[] {
  return spec.map(([text, startMs, endMs], index) => ({ index, text, startMs, endMs, confidence: 0.9 }))
}

const SAMPLE = words([
  ['Forge', 0, 600], ['burns', 600, 1200], ['captions.', 1200, 1800],
  ['Word', 2000, 2500], ['by', 2500, 2800], ['word.', 2800, 3400]
])

function project(over: Partial<Clip> = {}): Project {
  const asset: MediaAsset = {
    id: 'a1', path: source, name: 'src.mp4', kind: 'video',
    durationFrames: 120, width: 1280, height: 720, fps: 30,
    hasVideo: true, hasAudio: true, size: 0
  }
  const clip: Clip = {
    id: 'c1', assetId: 'a1', trackId: 'v1', start: 0, duration: 120, inPoint: 0, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    color: { brightness: 0, contrast: 1, saturation: 1 },
    ...over
  }
  return {
    ...emptyProject(),
    assets: [asset],
    clips: [clip],
    transcripts: {
      a1: {
        assetId: 'a1',
        language: 'en',
        model: 'test',
        durationMs: 4000,
        words: SAMPLE,
        segments: segmentIntoSentences(SAMPLE)
      }
    }
  }
}

/** Mean luma — a proxy for "is anything drawn on this frame". */
async function meanLuma(file: string, atSeconds: number): Promise<number> {
  const frame = join(dir, `probe-${Math.random().toString(36).slice(2)}.png`)
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(atSeconds), '-i', file, '-frames:v', '1', frame
  ])
  const { stdout } = await run(FFPROBE, [
    '-v', 'error', '-f', 'lavfi',
    // `escapeFilterPath`, not a hand-rolled colon escape. This helper had its
    // own one-backslash version — the same bug the real code had — which on
    // Windows fed ffprobe a backslash path and a half-eaten drive letter:
    // "Failed to avformat_open_input 'C'".
    `-i`, `movie=${escapeFilterPath(frame)},signalstats`,
    '-show_entries', 'frame_tags=lavfi.signalstats.YAVG',
    '-of', 'default=nw=1:nk=1'
  ])
  return Number(stdout.trim().split('\n')[0])
}

describe('caption burn-in', () => {
  it('escapes filter paths so colons and spaces survive', () => {
    /*
     * This asserted a single backslash on the colon and on the apostrophe, and
     * passed for months — because the form it encoded is the one every example
     * shows, and because the damage it does is invisible on a Mac. A path in a
     * filtergraph crosses two parsers: one backslash on a colon is consumed by
     * the first, and everything before the colon is lost. On macOS that is
     * nothing; on Windows it is `C`, and the export dies looking for a path on
     * a drive that was never named.
     *
     * The counts are measured, not reasoned — see
     * tests/integration/filterPath.int.test.ts, which renders a real file at a
     * path containing each character and checks ffmpeg actually opens it.
     */
    expect(escapeFilterPath('/Users/me/my project/a.ass')).toBe('/Users/me/my project/a.ass')
    expect(escapeFilterPath('C:\\Users\\me\\a.ass')).toBe('C\\\\:/Users/me/a.ass')
    expect(escapeFilterPath("/tmp/it's.ass")).toBe("/tmp/it\\\\\\'s.ass")
  })

  it('maps source time to timeline time for a trimmed clip', () => {
    /*
     * This asserted 0:00:00.00 and described the setup, correctly, as "lands at
     * 1s of timeline" — a test that contradicted itself and passed, because the
     * builder walked a cursor of accumulated durations instead of reading
     * `clip.start`. The two are the same number only while every clip is packed
     * from zero; leave a gap and every caption after it drifts by its size.
     */
    const p = project({ inPoint: 60, start: 30, duration: 60 })
    const ass = buildTimelineCaptions(p, DEFAULT_CAPTION_STYLE, { width: 1080, height: 1920 })!

    expect(ass).toBeTruthy()
    // "Word" at 2000ms of source, read from 2000ms in, on a clip that sits at
    // frame 30 — one second in at 30fps.
    expect(ass).toContain('Dialogue: 0,0:00:01.00')
    // Words before the in-point must not appear at all.
    expect(ass).not.toContain('FORGE')
  })

  it('follows a clip that has been dragged later', () => {
    // The case the cursor could never get right: the same clip, moved.
    const near = buildTimelineCaptions(
      project({ inPoint: 60, start: 30, duration: 60 }),
      DEFAULT_CAPTION_STYLE,
      { width: 1080, height: 1920 }
    )!
    const far = buildTimelineCaptions(
      project({ inPoint: 60, start: 150, duration: 60 }),
      DEFAULT_CAPTION_STYLE,
      { width: 1080, height: 1920 }
    )!
    expect(near).toContain('Dialogue: 0,0:00:01.00')
    // 150 frames at 30fps = 5 seconds.
    expect(far).toContain('Dialogue: 0,0:00:05.00')
  })

  it('burns captions that visibly change the frame', async () => {
    const p = project()
    const canvas = { width: 720, height: 1280 }
    const ass = buildTimelineCaptions(p, DEFAULT_CAPTION_STYLE, canvas)!
    const assPath = join(dir, 'captions.ass')
    await writeFile(assPath, ass, 'utf8')
    expect((await stat(assPath)).size).toBeGreaterThan(200)

    const plain = join(dir, 'plain.mp4')
    const captioned = join(dir, 'captioned.mp4')

    await run(FFMPEG, buildRenderPlan({ project: p, outputPath: plain, canvas }).args, {
      maxBuffer: 16 * 1024 * 1024
    })
    await run(
      FFMPEG,
      buildRenderPlan({ project: p, outputPath: captioned, canvas, subtitlesPath: assPath }).args,
      { maxBuffer: 16 * 1024 * 1024 }
    )

    // The source is a flat colour, so any luma change is drawn text.
    const before = await meanLuma(plain, 0.8)
    const after = await meanLuma(captioned, 0.8)

    expect(Number.isFinite(before)).toBe(true)
    expect(Number.isFinite(after)).toBe(true)
    expect(after).toBeGreaterThan(before)
  }, 180_000)

  it('produces no subtitle filter when nothing is transcribed', () => {
    const bare = { ...project(), transcripts: {} }
    expect(buildTimelineCaptions(bare, DEFAULT_CAPTION_STYLE, { width: 1080, height: 1920 })).toBeNull()

    const args = buildRenderPlan({ project: bare, outputPath: '/o.mp4' }).args.join(' ')
    // Either libass filter: `ass` burns them now, `subtitles` did (EFFECTS.md §51).
    expect(args).not.toMatch(LIBASS_FILTER)
    expect(args).toContain('-map [vout]')
    // The pattern does find the filter a captioned plan has, once.
    const captioned = buildRenderPlan({ project: project(), outputPath: '/o.mp4', subtitlesPath: '/c.ass' }).args.join(' ')
    expect(captioned.match(new RegExp(LIBASS_FILTER, 'g'))).toHaveLength(1)
  })

  /*
   * Hindi and Telugu, shaped (EFFECTS.md §51). The `subtitles` filter ran
   * libass's SIMPLE shaper: a conjunct drawn as its consonants with a visible
   * virama, the i-matra after its consonant — Telugu and Devanagari words
   * misspelt on screen. The app's own plan is rendered, then the same plan
   * with its caption filter swapped for `ass` at each shaping level: the
   * app's frames must be the complex shaper's, bit for bit.
   *
   * The words are letter clusters made up for this, nobody's speech: in each
   * script three conjuncts and a consonant with its i-matra. No font for
   * either script is bundled (assets/fonts), so libass falls back to the
   * system's; on macOS CoreText finds Kohinoor, and complex and simple must
   * then differ — which is what proves the comparison can see shaping at
   * all. Elsewhere that is only recorded: a libass without HarfBuzz, or no
   * font for the script, draws the two alike, and the check cannot tell.
   */
  it('shapes Devanagari and Telugu as libass’s complex shaper does', async () => {
    const indic = words([
      ['क्ष', 0, 450], ['त्र', 450, 900], ['श्र', 900, 1350], ['कि', 1350, 1800],
      ['క్ష', 2000, 2450], ['త్ర', 2450, 2900], ['శ్రీ', 2900, 3350], ['కి', 3350, 3800]
    ])
    const base = project()
    const p: Project = {
      ...base,
      transcripts: { a1: { ...base.transcripts.a1, language: 'hi', words: indic, segments: segmentIntoSentences(indic) } }
    }
    const canvas = { width: 640, height: 360 }
    const assPath = join(dir, 'indic.ass')
    await writeFile(assPath, buildTimelineCaptions(p, DEFAULT_CAPTION_STYLE, canvas)!, 'utf8')
    const fontsDir = resolve(__dirname, '../../assets/fonts')
    const plan = buildRenderPlan({ project: p, outputPath: join(dir, 'indic-app.mp4'), canvas, subtitlesPath: assPath, fontsDir })

    // The plan's caption step — the one from [vmix] to [vsub] — and the plan with it swapped.
    const graphAt = plan.args.indexOf('-filter_complex') + 1
    const steps = plan.args[graphAt].split(';')
    const at = steps.flatMap((step, i) => (step.startsWith('[vmix]') && step.endsWith('[vsub]') ? [i] : []))
    expect(at).toHaveLength(1)
    const swapped = (shaping: 'simple' | 'complex', out: string): string[] => {
      const graph = [...steps]
      graph[at[0]] = `[vmix]ass=filename=${escapeFilterPath(assPath)}:fontsdir=${escapeFilterPath(fontsDir)}:shaping=${shaping}[vsub]`
      return plan.args.map((a, i) => (i === graphAt ? graph.join(';') : i === plan.args.length - 1 ? out : a))
    }
    expect(plan.args.at(-1)).toBe(join(dir, 'indic-app.mp4'))

    const frames = async (file: string): Promise<string[]> => {
      const { stdout } = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-f', 'framemd5', '-'], {
        maxBuffer: 16 * 1024 * 1024
      })
      return stdout.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').at(-1)!.trim())
    }
    await run(FFMPEG, plan.args, { maxBuffer: 16 * 1024 * 1024 })
    const outs = { simple: join(dir, 'indic-simple.mp4'), complex: join(dir, 'indic-complex.mp4') }
    for (const shaping of ['simple', 'complex'] as const) {
      await run(FFMPEG, swapped(shaping, outs[shaping]), { maxBuffer: 16 * 1024 * 1024 })
    }
    const app = await frames(join(dir, 'indic-app.mp4'))
    const simple = await frames(outs.simple)
    const complex = await frames(outs.complex)
    expect(app.length).toBe(120)
    // Frames 0–53 carry the Devanagari, 60–113 the Telugu (30 fps).
    const differ = (from: number, to: number): number => complex.slice(from, to).filter((h, i) => h !== simple[from + i]).length
    const seen = { devanagari: differ(0, 54), telugu: differ(60, 114) }
    process.stderr.write(`captions.int: complex and simple shaping differ on ${JSON.stringify(seen)} of 54 frames each (${process.platform})\n`)
    expect(app, 'the app’s captions are the complex shaper’s').toEqual(complex)
    if (process.platform === 'darwin') expect(seen, 'shaping is visible here: Kohinoor through CoreText').toEqual({ devanagari: 54, telugu: 54 })
  }, 180_000)
})
