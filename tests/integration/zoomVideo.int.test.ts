import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { buildRenderPlan } from '@shared/render/plan'
import { valueAt, type Keyframe } from '@shared/render/keyframes'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { FFMPEG, run, outputDir, writeNote } from './output'

/*
 * Zoom keys on a video clip, rendered — every frame read back.
 *
 * zoompan's `d` is output frames PER INPUT FRAME. `zoomKeyframeFilter` was
 * written for a photograph and gave it `d=<the clip's length>`, so on footage
 * the first frame alone filled the clip: the export held frame 0 while the
 * same clip unkeyed moved (docs/CLIPS.md §3.4, EFFECTS.md §46).
 *
 * `d=1` alone is not the fix. zoompan stamps each frame it writes as its own
 * output count over its `fps` (vf_zoompan.c, read at the Windows build's
 * f22fcd4), so it has to meet exactly one input frame per output frame — and
 * at speed 1 nothing before it resamples the source to the project's rate. A
 * 60 fps source through `d=1` alone plays at half speed, and a 29.97 one is
 * a frame ahead of its sound from frame 500, one more every 1001 after. The
 * fix puts `fps=<rate>` in front of it.
 *
 * So the sources are 60 and 29.97 fps, never only 30: at the project's own
 * rate the half-speed bug would pass. Each frame of a source carries its own
 * index as ten bars across the middle half of the picture, which a 1.5× zoom
 * keeps in view, and each has an AAC track. Every export is held to the SAME
 * clip exported without keys: its length and its streams' start times, the
 * source frame each of its frames shows (read through the zoom), and frames
 * 0, mid and last against the unzoomed frame scaled by the zoom.
 *
 * And a moment's drawn frames, numbered PNGs at the project's rate: the same
 * filter froze them on their first frame too (measured), so the fix is for
 * any input that brings its own frames, not only a video file. That case is
 * at 30 fps, and is never the only one.
 */

const W = 320
const H = 180
const FPS = 30
/** Ten bars, 16 px each, across the middle half (x 80–239, y 45–134). */
const BITS = 10
const BAR = 16
const LEFT = W / 4
const ZOOM_TO = 1.5

interface Source {
  name: string
  /** A video file with sound, or a moment's numbered PNGs (`MediaAsset.frames`). */
  kind: 'video' | 'frames'
  /** lavfi's rate for the fixture. */
  rate: string
  sourceFps: number
  seconds: number
}

/*
 * 60 fps for three seconds: through `d=1` alone it plays at half speed.
 * 29.97 for twenty: a 30 fps output meets 29.97 fps frames one to one for
 * the first 500, then `fps=` repeats one — and from there the source frame
 * on screen is one behind `d=1` alone's, which kept counting and so ran
 * ahead of the sound. Ten seconds would never reach it.
 */
const SOURCES: Source[] = [
  { name: '60fps', kind: 'video', rate: '60', sourceFps: 60, seconds: 3 },
  { name: '29.97fps', kind: 'video', rate: '30000/1001', sourceFps: 30000 / 1001, seconds: 20 },
  { name: 'moment-frames', kind: 'frames', rate: '30', sourceFps: 30, seconds: 2 }
]

/** Each frame's index as ten bars across the middle half, grey round them. */
const BARS =
  `geq=lum='if(between(X,${LEFT},${3 * LEFT - 1})*between(Y,${H / 4},${(3 * H) / 4 - 1}),` +
  `if(mod(floor(N/pow(2,floor((X-${LEFT})/${BAR}))),2),235,16),128)':cb=128:cr=128`

let dir = ''
const files = new Map<string, string>()
const notes: string[] = []

beforeAll(async () => {
  dir = await outputDir('zoom-video')
  for (const source of SOURCES) {
    const picture = `color=c=gray:s=${W}x${H}:rate=${source.rate}:duration=${source.seconds}`
    if (source.kind === 'frames') {
      // As a moment's bake writes them: numbered from zero, one PNG a frame.
      const folder = join(dir, `source-${source.name}`)
      await mkdir(folder, { recursive: true })
      await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', picture,
        '-vf', BARS, '-start_number', '0', join(folder, '%05d.png')])
      files.set(source.name, join(folder, '%05d.png'))
      continue
    }
    const file = join(dir, `source-${source.name}.mp4`)
    await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', picture,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${source.seconds}:sample_rate=48000`,
      '-vf', BARS,
      '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file
    ])
    files.set(source.name, file)
  }
}, 180_000)

afterAll(async () => {
  if (!dir) return
  await writeNote(dir, [
    'Zoom keys (1 -> 1.5 over the clip) on footage, against the same clip exported without keys.',
    'Each source frame shows its own index as ten bars across the middle half; each export frame is read',
    'through its zoom. A row per source: length, stream start times, and the first frame whose index differs.',
    '',
    ...notes
  ])
})

function project(source: Source, keys: Keyframe[] | null): { project: Project; clip: Clip } {
  const duration = Math.round(source.seconds * FPS)
  const path = files.get(source.name)!
  const asset: MediaAsset =
    source.kind === 'frames'
      ? {
          id: 'v', path: path.replace('%05d', '00000'), name: 'Zoom punch', kind: 'image',
          durationFrames: duration, width: W, height: H, fps: null, hasVideo: true, hasAudio: false, size: 0,
          frames: { pattern: path, count: duration }
        }
      : {
          id: 'v', path, name: `${source.name}.mp4`, kind: 'video',
          durationFrames: duration, width: W, height: H, fps: source.sourceFps,
          hasVideo: true, hasAudio: true, size: 0
        }
  const clip: Clip = {
    id: 'c', assetId: 'v', trackId: 'v1', start: 0, duration, inPoint: 0, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    color: { brightness: 0, contrast: 1, saturation: 1 },
    ...(keys ? { keyframes: { zoom: keys } } : {})
  }
  return {
    project: { ...emptyProject(), settings: { width: W, height: H, fps: FPS, sampleRate: 48000 }, assets: [asset], clips: [clip] },
    clip
  }
}

interface Export {
  file: string
  graph: string
  frames: Buffer[]
  streams: { kind: string; start: number; duration: number }[]
}

async function exportOf(source: Source, keys: Keyframe[] | null, name: string): Promise<Export> {
  const file = join(dir, `${source.name}-${name}.mp4`)
  const { project: p } = project(source, keys)
  const plan = buildRenderPlan({ project: p, outputPath: file })
  const graph = plan.args[plan.args.indexOf('-filter_complex') + 1]
  await run(FFMPEG, plan.args, { maxBuffer: 64 * 1024 * 1024 })
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-vsync', 'passthrough',
     '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 }
  )
  const bytes = stdout as unknown as Buffer
  const frames: Buffer[] = []
  for (let at = 0; at + W * H <= bytes.length; at += W * H) frames.push(bytes.subarray(at, at + W * H))
  const probe = await run(ffprobeInstaller.path, [
    '-v', 'error', '-show_entries', 'stream=codec_type,start_time,duration', '-of', 'json', file
  ])
  const streams = (JSON.parse(String(probe.stdout)).streams as { codec_type: string; start_time: string; duration: string }[])
    .map((s) => ({ kind: s.codec_type, start: Number(s.start_time), duration: Number(s.duration) }))
  return { file, graph, frames, streams }
}

/**
 * The source window zoompan scales up at a zoom of `z`, as vf_zoompan.c computes it (read at f22fcd4):
 * `w = in->width * (1.0 / zoom)` truncated, x from the plan's `iw/2-(iw/zoom/2)` clipped and truncated,
 * then rounded DOWN to the chroma grid (`x &= ~((1 << log2_chroma_w) - 1)`), the same for y. On footage
 * (yuv420p) that grid is two pixels, and it moves the window up to a pixel left of centre — two pixels of
 * the export at 1.5×. A moment's PNGs arrive as RGB, and zoompan takes planar RGB with no grid (its format
 * list is the same at f22fcd4 and n4.4; which one a build negotiates is not read, so the frame comparison
 * below takes whichever grid fits, and the note says which).
 */
function windowAt(z: number, chroma: 1 | 2): { x0: number; y0: number; w: number; h: number } {
  const w = Math.trunc(W * (1 / z))
  const h = Math.trunc(H * (1 / z))
  const x0 = Math.trunc(Math.min(Math.max(W / 2 - W / z / 2, 0), Math.max(W - w, 0))) & ~(chroma - 1)
  const y0 = Math.trunc(Math.min(Math.max(H / 2 - H / z / 2, 0), Math.max(H - h, 0))) & ~(chroma - 1)
  return { x0, y0, w, h }
}

/** The source frame an export frame shows: its bars, read where a zoom of `z` puts them. */
function indexOf(frame: Buffer, z: number, chroma: 1 | 2): number {
  const { x0, w } = windowAt(z, chroma)
  const scale = W / w
  let index = 0
  for (let b = 0; b < BITS; b++) {
    const centre = (LEFT + b * BAR + BAR / 2 - x0) * scale
    let sum = 0
    let n = 0
    for (let y = H / 2 - 20; y < H / 2 + 20; y++) {
      for (let x = Math.round(centre - 3 * scale); x <= Math.round(centre + 3 * scale); x++) {
        sum += frame[y * W + x]
        n++
      }
    }
    if (sum / n > 128) index |= 1 << b
  }
  return index
}

/**
 * The unzoomed frame through zoompan's window at `z` (bilinear, where zoompan's scaler is bicubic),
 * against the zoomed one: the mean absolute difference over the middle half, where the bars are.
 */
function scaledDifference(zoomed: Buffer, plain: Buffer, z: number, chroma: 1 | 2): number {
  const { x0, y0, w, h } = windowAt(z, chroma)
  let total = 0
  let n = 0
  for (let y = H / 4; y < (3 * H) / 4; y++) {
    for (let x = W / 4; x < (3 * W) / 4; x++) {
      const sx = x0 + ((x + 0.5) * w) / W - 0.5
      const sy = y0 + ((y + 0.5) * h) / H - 0.5
      const xa = Math.floor(sx)
      const ya = Math.floor(sy)
      const fx = sx - xa
      const fy = sy - ya
      const at = (xx: number, yy: number): number => plain[Math.min(H - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))]
      const v = (1 - fy) * ((1 - fx) * at(xa, ya) + fx * at(xa + 1, ya)) + fy * ((1 - fx) * at(xa, ya + 1) + fx * at(xa + 1, ya + 1))
      total += Math.abs(zoomed[y * W + x] - v)
      n++
    }
  }
  return total / n
}

describe('zoom keys on a video clip export the footage moving, at its own speed', () => {
  for (const source of SOURCES) {
    it(`${source.name}: every frame is the unzoomed clip's frame, zoomed`, async () => {
      const duration = Math.round(source.seconds * FPS)
      const keys: Keyframe[] = [{ frame: 0, value: 1 }, { frame: duration - 1, value: ZOOM_TO }]
      const plain = await exportOf(source, null, 'plain')
      const zoomed = await exportOf(source, keys, 'zoomed')
      expect(zoomed.graph, 'the zoom reached the graph').toContain('zoompan=')
      expect(plain.graph).not.toContain('zoompan=')

      // The reference reads as the source it is: frame k shows the source frame at k/30 s.
      const chroma = source.kind === 'video' ? 2 : 1
      const plainIndex = plain.frames.map((f) => indexOf(f, 1, chroma))
      const expected = plainIndex.map((_, k) => Math.round((k * source.sourceFps) / FPS))
      const offReference = plainIndex.filter((v, k) => Math.abs(v - expected[k]) > 1).length
      expect(offReference, `the unzoomed export reads as its source (${plainIndex.slice(0, 8).join(' ')} …)`).toBe(0)

      const zoomedIndex = zoomed.frames.map((f, k) => indexOf(f, valueAt(keys, k, duration, 1), chroma))
      const firstWrong = zoomedIndex.findIndex((v, k) => v !== plainIndex[k])
      const video = (e: Export): { start: number; duration: number } => e.streams.find((s) => s.kind === 'video')!
      // A moment has no sound of its own; the export's track, if any, is the plan's silence.
      const audio = (e: Export): { start: number; duration: number } =>
        e.streams.find((s) => s.kind === 'audio') ?? { start: NaN, duration: NaN }
      const mid = Math.floor(duration / 2)
      const last = duration - 1
      const fits = [0, mid, last].map((k) => {
        const z = valueAt(keys, k, duration, 1)
        const byGrid = ([1, 2] as const).map((grid) => ({ grid, d: scaledDifference(zoomed.frames[k], plain.frames[k], z, grid) }))
        return byGrid.reduce((a, b) => (b.d < a.d ? b : a))
      })
      const differences = fits.map((f) => f.d)
      notes.push(
        `${source.name}: frames ${zoomed.frames.length} (unzoomed ${plain.frames.length}); ` +
          `video ${video(zoomed).start}+${video(zoomed).duration} s (unzoomed ${video(plain).start}+${video(plain).duration}); ` +
          `audio ${audio(zoomed).start}+${audio(zoomed).duration} s (unzoomed ${audio(plain).start}+${audio(plain).duration}); ` +
          `first frame showing another source frame: ${firstWrong < 0 ? 'none' : `${firstWrong} (${zoomedIndex[firstWrong]} for ${plainIndex[firstWrong]})`}; ` +
          `frames 0/mid/last against the unzoomed scaled: ${fits.map((f) => `${f.d.toFixed(2)} (grid ${f.grid})`).join(' / ')}`
      )
      for (const [k, label] of [[0, 'first'], [mid, 'mid'], [last, 'last']] as const) {
        await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', zoomed.file, '-vf', `select=eq(n\\,${k})`, '-frames:v', '1', join(dir, `${source.name}-zoomed-${label}.png`)])
        await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', plain.file, '-vf', `select=eq(n\\,${k})`, '-frames:v', '1', join(dir, `${source.name}-plain-${label}.png`)])
      }

      // Length, and where each stream starts, as the unzoomed clip.
      expect(zoomed.frames.length).toBe(duration)
      expect(zoomed.frames.length).toBe(plain.frames.length)
      expect(video(zoomed).duration).toBeCloseTo(video(plain).duration, 3)
      if (source.kind === 'video') {
        expect(audio(zoomed).duration).toBeCloseTo(audio(plain).duration, 3)
        expect(audio(zoomed).start - video(zoomed).start).toBeCloseTo(audio(plain).start - video(plain).start, 3)
      }

      // Every frame shows the source frame the unzoomed export shows there.
      expect(firstWrong, `the first frame showing another source frame (${zoomedIndex[firstWrong]} for ${plainIndex[firstWrong]})`).toBe(-1)

      /*
       * And frames 0, mid and last are that frame, zoomed: the unzoomed frame through zoompan's own window
       * matches to within 0.6 of a level on the mean (measured). One bar of another index is 22 levels
       * at 1× and 33 at 1.5×, so 3 is far from both.
       */
      for (const d of differences) expect(d).toBeLessThan(3)
    }, 300_000)
  }
})
