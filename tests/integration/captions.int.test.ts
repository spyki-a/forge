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
import { DEFAULT_CAPTION_STYLE, resolveStyle } from '@shared/captions/style'
import { segmentIntoSentences, type Word } from '@shared/transcript'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { smartPlacement } from '@shared/captions/smart'
import { SUBJECT_TRACK_VERSION, type SubjectTrack } from '@shared/reframe/types'

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

  /*
   * Smart placement on the libass route (docs/CLIPS.md §5.4), rendered: the
   * alignment override and MarginV that buildAss writes on a moved line are
   * what the bundled libass draws (per-event \\an and MarginV are core ASS,
   * far older than the Windows floor; this runs them on the Windows build in
   * CI). A 360×640 file on a 360×640 canvas, so the subject track's units are
   * the frame's, with a cut at 3 s. The caption's rows are read by luma off a
   * flat dark picture, with placement smart and with it absent — the same
   * file, so the check can see a move.
   *
   * Pop (bottom) with the face in the lower third, then the upper: the first
   * line and the one running over the cut go to the middle third, the line
   * after the cut stays low. Bold centre (middle) with the face in the middle
   * third, then the lower: its first line goes to the lower third at the
   * default style's edge distance (220 of 1080: MarginV 130 here), which only
   * the event's own MarginV gives it — the style's is 0, and libass would
   * draw it on the frame's very edge.
   */
  it('puts Smart placement\'s lines in their third on the bundled libass', async () => {
    const W = 360
    const H = 640
    const tall = join(dir, 'tall.mp4')
    await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=#202830:size=${W}x${H}:rate=30:duration=6`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', tall
    ])
    const spoken = words([
      ['One', 500, 800], ['two', 800, 1100], ['three.', 1100, 1500],
      ['Seven', 2600, 2900], ['eight', 2900, 3200], ['nine.', 3200, 3400],
      ['Four', 3500, 3800], ['five', 3800, 4100], ['six.', 4100, 4500]
    ])
    /** A track whose face's top is at `before` until the cut and `after` from it. */
    const track = (before: number, after: number): SubjectTrack => ({
      key: '123456:1700000000000', version: SUBJECT_TRACK_VERSION, width: W, height: H, durationMs: 6000,
      shots: [{ startMs: 0, endMs: 3000, score: 0 }, { startMs: 3000, endMs: 6000, score: 0.9 }],
      samples: Array.from({ length: 12 }, (_, i) => ({
        ms: i * 500,
        faces: [{ x: 0.4, y: i * 500 < 3000 ? before : after, width: 0.2, height: 0.12, score: 0.9 }]
      })),
      perShot: [{}, {}], detector: 'synthetic',
      scene: { threshold: 0.3, minShotMs: 500, backend: 'ffmpeg-select-rgb24' }, at: '2026-10-16T00:00:00.000Z'
    })
    const base = project({ duration: 180 })
    const canvas = { width: W, height: H }
    const fontsDir = resolve(__dirname, '../../assets/fonts')

    /** The first and last rows with a pixel brighter than the background could be, at each time. */
    const rowsAt = async (file: string, seconds: number[]): Promise<[number, number][]> => {
      const out: [number, number][] = []
      for (const at of seconds) {
        const { stdout } = await run(
          FFMPEG,
          ['-hide_banner', '-loglevel', 'error', '-ss', at.toFixed(3), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
          { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 }
        )
        const luma = stdout as unknown as Buffer
        expect(luma.length).toBe(W * H)
        const lit: number[] = []
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (luma[y * W + x] > 128) {
              lit.push(y)
              break
            }
          }
        }
        expect(lit.length, `text on screen at ${at}s`).toBeGreaterThan(10)
        out.push([lit[0], lit[lit.length - 1]])
      }
      return out
    }
    /*
     * The third a line sits in, by the CENTRE of its text rows. The whole block
     * is not required inside one third: libass picks its font on the machine
     * that renders, and the runners' fallback face is taller than this Mac's,
     * so a bottom-third line that sits whole in the lower third here ran rows
     * 409–498 of 640 on both CI runners, across the 426.7 boundary (run
     * 38986994729). The centre moves by a whole third when the caption does,
     * which is what the cases below assert; the row ranges are printed too.
     */
    const third = ([top, bottom]: [number, number]): string => {
      const mid = (top + bottom) / 2
      return mid < H / 3 ? 'top' : mid < (2 * H) / 3 ? 'middle' : 'bottom'
    }

    const cases = [
      // style, the face's top before and after the cut, when to look, the thirds smart and absent
      { styleId: 'pop', faces: [0.7, 0.1], at: [1.0, 3.25, 4.0], smart: ['middle', 'middle', 'bottom'], style: ['bottom', 'bottom', 'bottom'] },
      { styleId: 'bold-center', faces: [0.4, 0.75], at: [1.0, 4.0], smart: ['bottom', 'middle'], style: ['middle', 'middle'] }
    ]
    const seen: Record<string, [number, number][]> = {}
    for (const c of cases) {
      for (const placement of ['smart', undefined] as const) {
        const p: Project = {
          ...base,
          settings: { ...base.settings, width: W, height: H },
          assets: [{ ...base.assets[0], path: tall, durationFrames: 180, width: W, height: H, hasAudio: false }],
          subjects: { a1: track(c.faces[0], c.faces[1]) },
          transcripts: { a1: { ...base.transcripts.a1, durationMs: 6000, words: spoken, segments: segmentIntoSentences(spoken) } },
          captions: { enabled: true, styleId: c.styleId, ...(placement ? { placement } : {}) }
        }
        const style = resolveStyle(c.styleId)
        const name = `${c.styleId}-${placement ?? 'style'}`
        const assPath = join(dir, `placement-${name}.ass`)
        await writeFile(assPath, buildTimelineCaptions(p, style, canvas, smartPlacement(p, style, canvas))!, 'utf8')
        const out = join(dir, `placement-${name}.mp4`)
        await run(FFMPEG, buildRenderPlan({ project: p, outputPath: out, canvas, subtitlesPath: assPath, fontsDir }).args, {
          maxBuffer: 16 * 1024 * 1024
        })
        seen[name] = await rowsAt(out, c.at)
      }
      expect(seen[`${c.styleId}-smart`].map(third), `${c.styleId}, smart`).toEqual(c.smart)
      expect(seen[`${c.styleId}-style`].map(third), `${c.styleId}, absent`).toEqual(c.style)
    }
    process.stderr.write(`captions.int: Smart placement text rows on ${W}x${H}: ${JSON.stringify(seen)}\n`)

    // Off the face: Pop's shot-1 face, extended by half its height, runs y 0.70–0.88 of the frame.
    for (const [top, bottom] of seen['pop-smart'].slice(0, 2)) expect(bottom < 0.7 * H || top > 0.88 * H).toBe(true)
    // Bold centre moved down keeps the default style's distance from the edge, as Pop's own line does.
    const [, centreBottom] = seen['bold-center-smart'][0]
    const [, popBottom] = seen['pop-style'][0]
    expect(H - 1 - centreBottom, 'the moved centred line is clear of the edge').toBeGreaterThan(100)
    expect(Math.abs(centreBottom - popBottom), 'as far up as Pop sits').toBeLessThan(20)
  }, 240_000)
})
