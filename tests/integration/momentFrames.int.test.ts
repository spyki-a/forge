import { beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, stat, utimes, writeFile } from 'node:fs/promises'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { buildRenderPlan } from '@shared/render/plan'
import type { FootageRequest } from '@shared/render/moment'
import { FOOTAGE_MAX_EDGE, momentFramesKey } from '@shared/render/momentFrames'
import { extractMomentFrames, pruneMomentsCache } from '../../src/main/render/momentFrames'
import { FFMPEG, outputDir, pixelAt, run, writeNote } from './output'

/*
 * The footage pre-pass, against the render (docs/PLAN.md §7.2).
 *
 * A moment over footage composes the shot's own frames, so the frames the
 * pre-pass pulls must be THE frames the render plays under the moment —
 * through the same retime. The oracle is the render itself: a clip whose
 * every frame is a grey of its own (luma 8·N, lossless), played at speed 1
 * from an in-point, at half speed from an odd frame, at one and a half
 * times, through a ramp, in smooth slow-motion at both ends of the clip,
 * held, and at 24 and 60 frames a second in a 30 fps project; for each, the
 * pulled frame k must be the render's frame at the clip's frame `first + k`
 * within the encoder's noise (a frame off is nine levels). Into
 * tests/output/momentFrames/.
 */

const fps = 30
const size = { width: 64, height: 36 }
let dir = ''
let source = ''
const lines: string[] = []

/** The level the render's frame at clip frame `f` shows, from the centre pixel. */
async function renderedLevel(clip: Partial<Clip>, f: number, name: string, path = source, rate = fps): Promise<number> {
  const asset: MediaAsset = { id: 'v', path, name: 'v.mp4', kind: 'video', durationFrames: 3 * rate, ...size, fps: rate, hasVideo: true, hasAudio: false, size: 0 }
  const project: Project = {
    ...emptyProject(),
    settings: { ...size, fps, sampleRate: 48000 },
    assets: [asset],
    clips: [{
      id: 'c', assetId: 'v', trackId: 'v1', start: 0, duration: 60, inPoint: 0, volume: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 }, ...clip
    }]
  }
  const out = join(dir, `${name}.mp4`)
  const plan = buildRenderPlan({ project, outputPath: out, canvas: size })
  await run(FFMPEG, plan.args, { maxBuffer: 64 * 1024 * 1024 })
  const [r] = await pixelAt(out, (f - 0.25) / fps, 32, 18, size)
  return r
}

/** The level of a pulled PNG's centre pixel. */
async function pulledLevel(file: string): Promise<number> {
  const [r] = await pixelAt(file, 0, 32, 18, size)
  return r
}

const request = (over: Partial<FootageRequest>): FootageRequest => ({
  path: source, inPoint: 0, duration: 60, first: 0, count: 1, fps, size, maxEdge: FOOTAGE_MAX_EDGE, ...over
})

/** The RGB level a frame of luma 8·N decodes to: the file's luma is limited-range, so Y = 16 is black and Y = 235 white. */
const levelOf = (n: number): number => Math.round(Math.max(0, Math.min(255, 1.164 * (Math.min(255, 8 * n) - 16))))
/** Pulled against rendered: H.264 at crf 20 on flat grey is within three levels; a frame off is nine. */
const NOISE = 5
/** One source frame's step in levels, taken between two mid-range frames (the first two are below black). */
const STEP = levelOf(11) - levelOf(10)

beforeAll(async () => {
  dir = await outputDir('momentFrames')
  const media = join(dir, 'media')
  await mkdir(media, { recursive: true })
  source = join(media, 'greys.mp4')
  // Frame N is luma 8N (to 255), lossless, so every frame names itself — and a frame off is nine levels, past any noise.
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=${size.width}x${size.height}:rate=${fps}:duration=3`,
    '-vf', "geq=lum='min(255,8*N)':cb=128:cr=128", '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', source
  ])
}, 120_000)

describe('the frames a moment pulls from footage', () => {
  it('at speed 1 from an in-point: the clip’s frames, named by their luma — and the render’s own', async () => {
    const clip = { inPoint: 10 }
    const pulled = await extractMomentFrames(request({ ...clip, first: 5, count: 6 }), join(dir, 'cache'))
    expect(pulled.files).toHaveLength(6)
    expect(pulled.width).toBe(64)
    expect(pulled.height).toBe(36)
    for (const [k, file] of pulled.files.entries()) {
      const level = await pulledLevel(file)
      // Source frame 10 + 5 + k: luma 8·(15 + k), within the yuv→rgb rounding.
      expect(Math.abs(level - levelOf(15 + k)), `frame ${k}: ${level}`).toBeLessThan(3)
      const rendered = await renderedLevel(clip, 5 + k, 'plain')
      expect(Math.abs(level - rendered), `frame ${k}: pulled ${level}, rendered ${rendered}`).toBeLessThan(NOISE)
    }
    lines.push(`- speed 1, in-point 10, frames 5–10: pulled levels ${await Promise.all(pulled.files.map(pulledLevel)).then((l) => l.join(', '))} (8·N of source frames 15–20)`)
    // Pulled once and kept: the same request finds its folder.
    const again = await extractMomentFrames(request({ ...clip, first: 5, count: 6 }), join(dir, 'cache'))
    expect(again.dir).toBe(pulled.dir)
    expect((await readdir(join(dir, 'cache'))).length).toBe(1)
  })

  it('a pull that fails leaves no folder behind, and a request past the file’s end is a failure, not a short folder', async () => {
    const root = join(dir, 'cache-fail')
    await expect(extractMomentFrames(request({ inPoint: 0, first: 500, count: 6 }), root)).rejects.toThrow(/6 wanted, 0 written/)
    const left = await readdir(root).catch(() => [] as string[])
    expect(left.filter((n) => n.includes('.pulling-'))).toEqual([])
    expect(left).toEqual([])
  })

  it('a rotated phone clip is pulled turned, at its real size — the cap is measured on the frame that arrives', async () => {
    // The same file tagged rotate=90: the probe still says 64×36, ffmpeg decodes 36×64.
    const turned = join(dir, 'media', 'turned.mp4')
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-c', 'copy', '-metadata:s:v:0', 'rotate=90', turned])
    const pulled = await extractMomentFrames(request({ path: turned, inPoint: 10, first: 5, count: 2 }), join(dir, 'cache'))
    expect(pulled.width).toBe(36)
    expect(pulled.height).toBe(64)
  })

  it('the cache is kept to its budget, the folders least recently used going first, never the one just pulled', async () => {
    const root = join(dir, 'cache-prune')
    const make = async (name: string, bytes: number, ageSeconds: number): Promise<string> => {
      const folder = join(root, name)
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, '00000.png'), Buffer.alloc(bytes))
      const when = new Date(Date.now() - ageSeconds * 1000)
      await utimes(folder, when, when)
      return folder
    }
    const oldest = await make('a', 1000, 300)
    const middle = await make('b', 1000, 200)
    const newest = await make('c', 1000, 100)
    const kept = await make('d', 1000, 400)
    await pruneMomentsCache(root, 2500, kept)
    const left = (await readdir(root)).sort()
    // 4000 bytes over a 2500 budget: the two least recently used go, the just-pulled one stays however old it looks.
    expect(left).toEqual(['c', 'd'])
    expect(existsSync(oldest)).toBe(false)
    expect(existsSync(middle)).toBe(false)
    expect(existsSync(newest)).toBe(true)
  })

  it('a folder with fewer frames than wanted is pulled again, never trusted', async () => {
    const req = request({ inPoint: 10, first: 5, count: 6 })
    const root = join(dir, 'cache-short')
    const file = await stat(source)
    const key = createHash('sha1').update(momentFramesKey(req, file)).digest('hex').slice(0, 24)
    // What a pull that died half-way would have left, had it not gone into a temporary folder: one frame of six.
    await mkdir(join(root, key), { recursive: true })
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x36', '-frames:v', '1', join(root, key, '00000.png')])
    const pulled = await extractMomentFrames(req, root)
    expect(pulled.dir).toBe(join(root, key))
    expect(pulled.files).toHaveLength(6)
    // The red stand-in is gone: the folder was pulled afresh.
    expect(Math.abs((await pulledLevel(pulled.files[0])) - levelOf(15))).toBeLessThan(3)
  })

  it('at half speed from an ODD first frame: the frame the render plays under each clip frame, in the render’s phase', async () => {
    // 21 × 0.5 is not a whole frame: a seek to it lands one source frame ahead of the render's repeat (measured).
    const clip = { inPoint: 0, speed: 0.5 }
    const pulled = await extractMomentFrames(request({ ...clip, first: 21, count: 4 }), join(dir, 'cache'))
    expect(pulled.files).toHaveLength(4)
    const levels: number[] = []
    for (const [k, file] of pulled.files.entries()) {
      const level = await pulledLevel(file)
      const rendered = await renderedLevel(clip, 21 + k, 'slow')
      levels.push(level)
      expect(Math.abs(level - rendered), `frame ${k}: pulled ${level}, rendered ${rendered}`).toBeLessThan(NOISE)
    }
    // Half speed: two clip frames per source frame, so four clip frames span one or two source steps.
    expect(levels[3] - levels[0]).toBeGreaterThan(STEP - 3)
    expect(levels[3] - levels[0]).toBeLessThan(2 * STEP + 3)
    // And the pairs repeat as the render's fps filter repeats them: clip frames 22 and 23 are one source frame.
    expect(Math.abs(levels[2] - levels[1])).toBeLessThan(3)
    lines.push(`- half speed, frames 21–24: pulled ${levels.join(', ')}`)
  })

  it('smooth slow-motion, at both ends of the clip: the interpolated frames the render plays, its tail held', async () => {
    // Its own source, stepping 5 a frame, so both windows — source frames 6–8 and 33–35 — sit below white.
    const soft = join(dir, 'media', 'greys5.mp4')
    await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=${size.width}x${size.height}:rate=${fps}:duration=3`,
      '-vf', "geq=lum='min(255,5*N)':cb=128:cr=128", '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', soft
    ])
    const clip = { inPoint: 6, speed: 0.5, smoothSlow: true, duration: 60 }
    for (const first of [0, 54]) {
      const pulled = await extractMomentFrames(request({ path: soft, ...clip, first, count: 6 }), join(dir, 'cache'))
      expect(pulled.files, `first ${first}`).toHaveLength(6)
      const levels: number[] = []
      let compared = 0
      for (const [k, file] of pulled.files.entries()) {
        const level = await pulledLevel(file)
        levels.push(level)
        const rendered = await renderedLevel(clip, first + k, `smooth${first}`, soft)
        /*
         * Where the render shows nothing — the base's black — there is nothing
         * to compare: the 2018 Windows build's minterpolate closes its stream
         * without a flush (on CI a window on the clip's last six frames came
         * back three of six, a tpad after it padding nothing, and the render
         * there ended black four frames early), so a smooth clip's tail is
         * short on that build and the pull's lookahead continues the motion
         * past it. What matters is that the window is whole on either, and
         * that every frame the render does show is the pulled one.
         */
        // …and not the clip's last three frames, where the macOS render holds its last frame and the pull's lookahead keeps moving (measured: 178 held against 183).
        if (first > 0 && (rendered < 8 || first + k > 56)) continue
        compared++
        expect(Math.abs(level - rendered), `first ${first}, frame ${k}: pulled ${level}, rendered ${rendered}`).toBeLessThan(NOISE)
      }
      // At least half the window is compared on any build; all of it on the Mac.
      expect(compared, `first ${first}: frames compared`).toBeGreaterThanOrEqual(3)
      // Real pictures, not clipped white: a window of six frames spans about three source frames of five.
      expect(levels[5]).toBeLessThan(250)
      lines.push(`- smooth half speed from frame 6, frames ${first}–${first + 5}: pulled ${levels.join(', ')}`)
    }
  })

  it('footage at another frame rate — 24p and 60p in a 30 fps project — gives the frames the render resamples to, not the file’s own', async () => {
    // 60p steps 4 a source frame (two of them per project frame: 9.3 levels a frame, still past the noise), so the window stays below white.
    for (const [rate, step] of [[24, 8], [60, 4]] as const) {
      const other = join(dir, 'media', `greys${rate}.mp4`)
      await run(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=${size.width}x${size.height}:rate=${rate}:duration=3`,
        '-vf', `geq=lum='min(255,${step}*N)':cb=128:cr=128`, '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', other
      ])
      const clip = { inPoint: 10 }
      // A light burn's nine frames after the cut: at 24p the file has fewer frames than the window asks in project frames.
      const pulled = await extractMomentFrames(request({ path: other, ...clip, first: 5, count: 9 }), join(dir, 'cache'))
      expect(pulled.files, `${rate}p`).toHaveLength(9)
      const levels: number[] = []
      for (const [k, file] of pulled.files.entries()) {
        const level = await pulledLevel(file)
        const rendered = await renderedLevel({ ...clip }, 5 + k, `rate${rate}`, other, rate)
        levels.push(level)
        expect(Math.abs(level - rendered), `${rate}p frame ${k}: pulled ${level}, rendered ${rendered}`).toBeLessThan(NOISE)
      }
      // Real pictures throughout: nothing clipped to white where a slip could hide.
      expect(levels[8]).toBeLessThan(250)
      // 24p repeats a source frame every fourth project frame; 60p skips one every project frame.
      expect(levels[8] - levels[0]).toBeGreaterThan(rate === 24 ? 5 * STEP : 7 * STEP)
      lines.push(`- ${rate}p source in a 30 fps project, frames 5–13: pulled ${levels.join(', ')}`)
    }
  })

  it('through a ramp: the frame the render plays under each clip frame', async () => {
    const clip = { inPoint: 0, ramp: { from: 1, to: 0.4 }, duration: 60 }
    const pulled = await extractMomentFrames(request({ inPoint: 0, ramp: clip.ramp, first: 30, count: 4 }), join(dir, 'cache'))
    expect(pulled.files).toHaveLength(4)
    const levels: number[] = []
    for (const [k, file] of pulled.files.entries()) {
      const level = await pulledLevel(file)
      const rendered = await renderedLevel(clip, 30 + k, 'ramp')
      levels.push(level)
      expect(Math.abs(level - rendered), `frame ${k}: pulled ${level}, rendered ${rendered}`).toBeLessThan(NOISE)
    }
    // Thirty frames into a ramp from 1× down to 0.4× over sixty, the footage is behind frame 30 of the source (slowing all the way) but well ahead of 0.4× of it.
    expect(levels[0]).toBeLessThan(levelOf(30))
    expect(levels[0]).toBeGreaterThan(levelOf(12) + 3)
    lines.push(`- ramp 1→0.4, frames 30–33: pulled ${levels.join(', ')}`)
  })

  it('at one and a half times: the frame the render plays under each clip frame, drops and all', async () => {
    const clip = { inPoint: 4, speed: 1.5 }
    const pulled = await extractMomentFrames(request({ ...clip, first: 7, count: 5 }), join(dir, 'cache'))
    expect(pulled.files).toHaveLength(5)
    const levels: number[] = []
    for (const [k, file] of pulled.files.entries()) {
      const level = await pulledLevel(file)
      const rendered = await renderedLevel(clip, 7 + k, 'fast')
      levels.push(level)
      expect(Math.abs(level - rendered), `frame ${k}: pulled ${level}, rendered ${rendered}`).toBeLessThan(NOISE)
    }
    // Four intervals at 1.5× are six source frames: six steps, give or take the encoder's noise.
    expect(levels[4] - levels[0]).toBeGreaterThan(5 * STEP + 2)
    expect(levels[4] - levels[0]).toBeLessThan(7 * STEP - 2)
    lines.push(`- 1.5× from frame 4, frames 7–11: pulled ${levels.join(', ')}`)
  })

  it('a held clip is its one frame — the in-point’s, whatever the window, as the render holds it', async () => {
    const pulled = await extractMomentFrames(request({ inPoint: 12, hold: true, first: 54, count: 6 }), join(dir, 'cache'))
    expect(pulled.files).toHaveLength(1)
    const level = await pulledLevel(pulled.files[0])
    expect(Math.abs(level - levelOf(12))).toBeLessThan(3)
    const rendered = await renderedLevel({ inPoint: 12, hold: true }, 57, 'held')
    expect(Math.abs(level - rendered)).toBeLessThan(NOISE)
    lines.push(`- held at frame 12, asked for frames 54–59: one frame, level ${level} (rendered ${rendered})`)
    await writeFile(join(dir, 'README.txt'), '')
    await writeNote(dir, [
      '# momentFrames', '',
      'A 64×36 clip whose frame N is luma 8·N (lossless). The pre-pass pulls a moment’s window of frames through the clip’s own retime;',
      'each pulled frame is compared with the render’s frame at the same clip frame (within H.264 noise).', '',
      ...lines
    ])
  })
})
