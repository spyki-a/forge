import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import { buildRenderPlan } from '@shared/render/plan'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { valueAt, type Keyframe, type KeyframeTracks } from '@shared/render/keyframes'
import { outputDir, writeNote } from './output'

/*
 * Keyframes, rendered.
 *
 * Each property goes through a different filter and each one was verified
 * against the binary before being offered — rotate takes an expression of `t`,
 * geq exposes `T` on the alpha plane, zoompan counts `on`. These render real
 * frames and read them back, because an animation that compiles is not the same
 * as an animation that moves.
 */

const run = promisify(execFile)
const FFMPEG = ffmpegInstaller.path
const W = 160
const H = 120
const FPS = 15
const FRAMES = 30

let dir = ''
let still = ''

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-keys-'))
  still = join(dir, 'grid.png')
  // A pattern, not a flat colour: a zoom is only measurable if the picture has
  // detail that changes size.
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=1:duration=1', '-frames:v', '1', still])
}, 180_000)

afterAll(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
})

function keyedProject(keyframes: KeyframeTracks, start = 0): Project {
  const asset: MediaAsset = {
    id: 'img', path: still, name: 'grid.png', kind: 'image', durationFrames: FRAMES,
    width: 320, height: 240, fps: FPS, hasVideo: true, hasAudio: false, size: 0
  }
  const clip: Clip = {
    id: 'c1', assetId: 'img', trackId: 'v1', start, duration: FRAMES, inPoint: 0, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, fit: 'cover' },
    color: { brightness: 0, contrast: 1, saturation: 1 },
    keyframes
  }
  return {
    ...emptyProject(),
    settings: { width: W, height: H, fps: FPS, sampleRate: 48000 },
    assets: [asset],
    clips: [clip]
  }
}

async function render(keyframes: KeyframeTracks, start = 0): Promise<string> {
  const out = join(dir, `out-${Math.random().toString(36).slice(2)}.mp4`)
  const plan = buildRenderPlan({ project: keyedProject(keyframes, start), outputPath: out })
  await run(FFMPEG, plan.args, { maxBuffer: 32 * 1024 * 1024 })
  return out
}

/** One frame as raw grey bytes. */
async function frameAt(file: string, seconds: number): Promise<Buffer> {
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-ss', String(seconds), '-i', file,
     '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 }
  )
  return stdout as unknown as Buffer
}

/** Mean absolute difference, 0 = identical. */
function difference(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let total = 0
  for (let i = 0; i < n; i++) total += Math.abs(a[i] - b[i])
  return total / n
}

function mean(buffer: Buffer): number {
  let total = 0
  for (const v of buffer) total += v
  return total / buffer.length
}

describe('keyframes', () => {
  it('emits nothing extra for a clip with no keys', () => {
    const plan = buildRenderPlan({ project: keyedProject({}), outputPath: '/tmp/x.mp4' })
    const graph = plan.args.join(' ')
    // geq is expensive; it must never appear for a clip that does not animate.
    expect(graph).not.toContain('geq=')
  })

  it('ignores a single key, which is a value and not an animation', () => {
    const plan = buildRenderPlan({
      project: keyedProject({ opacity: [{ frame: 0, value: 0.5 }] }),
      outputPath: '/tmp/x.mp4'
    })
    expect(plan.args.join(' ')).not.toContain('geq=')
  })

  it('fades opacity over the clip', async () => {
    const out = await render({ opacity: [{ frame: 0, value: 0 }, { frame: FRAMES, value: 1 }] })
    const start = mean(await frameAt(out, 0.1))
    const end = mean(await frameAt(out, 1.8))
    // Against a black base, rising alpha is a brightening frame.
    expect(end).toBeGreaterThan(start + 10)
  }, 120_000)

  it('holds opacity flat until the next key when told to', async () => {
    const out = await render({
      opacity: [
        { frame: 0, value: 0, ease: 'hold' },
        { frame: FRAMES - 1, value: 1 }
      ]
    })
    // Nothing should appear until the very end.
    expect(mean(await frameAt(out, 0.1))).toBeLessThan(4)
    expect(mean(await frameAt(out, 1.0))).toBeLessThan(4)
  }, 120_000)

  it('turns the picture over the clip', async () => {
    const out = await render({ rotation: [{ frame: 0, value: 0 }, { frame: FRAMES, value: 45 }] })
    const start = await frameAt(out, 0.1)
    const end = await frameAt(out, 1.8)
    expect(difference(start, end)).toBeGreaterThan(8)
  }, 120_000)

  it('zooms into the picture over the clip', async () => {
    const out = await render({ zoom: [{ frame: 0, value: 1 }, { frame: FRAMES, value: 2 }] })
    const start = await frameAt(out, 0.1)
    const end = await frameAt(out, 1.8)
    expect(difference(start, end)).toBeGreaterThan(8)
  }, 120_000)

  /*
   * The one that would have shipped silently.
   *
   * rotate, geq and zoompan all run BEFORE setpts, so they see source
   * timestamps starting at zero rather than timeline time. Writing the curve
   * against the clip's timeline position worked perfectly for the first clip and
   * froze every clip after it — which nothing but a clip that starts late would
   * ever catch.
   */
  it('animates a clip that does not start at zero', async () => {
    const start = FPS // one second in
    const out = await render(
      { opacity: [{ frame: 0, value: 0 }, { frame: FRAMES, value: 1 }] },
      start
    )
    const early = mean(await frameAt(out, 1.1))
    const late = mean(await frameAt(out, 2.8))
    expect(late).toBeGreaterThan(early + 10)
  }, 120_000)

  it('animates two properties on one clip without either being dropped', async () => {
    // They go through different filters, so it is genuinely possible for one to
    // silently win.
    const out = await render({
      opacity: [{ frame: 0, value: 0.2 }, { frame: FRAMES, value: 1 }],
      rotation: [{ frame: 0, value: 0 }, { frame: FRAMES, value: 30 }]
    })
    const start = await frameAt(out, 0.1)
    const end = await frameAt(out, 1.8)
    expect(mean(end)).toBeGreaterThan(mean(start))
    expect(difference(start, end)).toBeGreaterThan(8)
  }, 120_000)
})

/*
 * A held key steps ON its frame — every frame of the export read back.
 *
 * Each boundary used to be `lt(t, (frame/fps).toFixed(4))`. Frame 5 at 30 fps
 * is t = 0.16666…, still under 0.1667, so the export held the old value
 * through frame 5 and stepped on frame 6, while the preview's `valueAt` steps
 * on frame 5 (docs/CLIPS.md §3.2, EFFECTS.md §45). Rounding up is what makes
 * it late, so which frames it hits depends on the rate: at 30 fps every key on
 * a frame ≡ 2 (mod 3), at 24 and 60 every key on a frame ≡ 1 (mod 3), and at
 * 25 none. The boundary is now the half frame, which no frame time is near.
 *
 * The test above sampled only 0.1 s and 1.0 s of a hold, so it could not see
 * this. These decode the whole export and look at the frame before the key
 * and the frame at it.
 */
describe('a held key steps on its own frame in the export', () => {
  const HW = 64
  const HH = 48
  const LENGTH = 12
  let heldDir = ''
  let white = ''
  const rows: string[] = []

  beforeAll(async () => {
    heldDir = await outputDir('held-keys')
    white = join(heldDir, 'white.png')
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=white:size=${HW}x${HH}:rate=1:duration=1`, '-frames:v', '1', white])
  }, 60_000)

  afterAll(async () => {
    if (!heldDir) return
    await writeNote(heldDir, [
      'Opacity keys on a white still over the black canvas, rendered through buildRenderPlan.',
      'Each row: the frame rate, the key, and the mean grey of every frame of the export, in order.',
      'The frame at a held key must be the first one with the new value.',
      '',
      ...rows
    ])
  })

  function heldProject(fps: number, keys: Keyframe[]): Project {
    const asset: MediaAsset = {
      id: 'w', path: white, name: 'white.png', kind: 'image', durationFrames: LENGTH,
      width: HW, height: HH, fps: null, hasVideo: true, hasAudio: false, size: 0
    }
    const clip: Clip = {
      id: 'c', assetId: 'w', trackId: 'v1', start: 0, duration: LENGTH, inPoint: 0, volume: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, fit: 'cover' },
      color: { brightness: 0, contrast: 1, saturation: 1 },
      keyframes: { opacity: keys }
    }
    return { ...emptyProject(), settings: { width: HW, height: HH, fps, sampleRate: 48000 }, assets: [asset], clips: [clip] }
  }

  /** The mean grey of every frame of an export, decoded whole and in order. */
  async function everyFrame(name: string, fps: number, keys: Keyframe[]): Promise<number[]> {
    const out = join(heldDir, `${name}.mp4`)
    const plan = buildRenderPlan({ project: heldProject(fps, keys), outputPath: out })
    await run(FFMPEG, plan.args, { maxBuffer: 32 * 1024 * 1024 })
    const { stdout } = await run(
      FFMPEG,
      ['-hide_banner', '-loglevel', 'error', '-i', out, '-vsync', 'passthrough',
       '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
    )
    const bytes = stdout as unknown as Buffer
    const size = HW * HH
    const means: number[] = []
    for (let at = 0; at + size <= bytes.length; at += size) means.push(mean(bytes.subarray(at, at + size)))
    rows.push(`${name}: ${means.map((m) => m.toFixed(1)).join(' ')}`)
    return means
  }

  /*
   * 5 and 8 are the plan's rows; at 30 fps both were late. 4 is late at 24
   * fps (0.166666… written 0.1667, as frame 5 at 30). 25 fps was exact all
   * along, and stays so.
   */
  for (const fps of [24, 25, 30]) {
    for (const key of [4, 5, 8]) {
      it(`${fps} fps, opacity held 0 → 1 at frame ${key}: the frame at the key is the first lit`, async () => {
        const means = await everyFrame(`${fps}fps-key${key}`, fps, [
          { frame: 0, value: 0, ease: 'hold' },
          { frame: key, value: 1 }
        ])
        expect(means.length).toBe(LENGTH)
        const lit = means.findIndex((m) => m > 128)
        expect(lit, `the first lit frame (${means.map((m) => m.toFixed(0)).join(' ')})`).toBe(key)
        // The frame before the key is still the held value, and the key's frame is the new one, whole.
        expect(means[key - 1]).toBeLessThan(30)
        expect(means[key]).toBeGreaterThan(200)
      }, 120_000)
    }
  }

  /*
   * And a curve that does not hold is untouched.
   *
   * Where a segment eases or runs linearly, both sides of its boundary give
   * the key's own value AT the key, so moving the boundary half a frame earlier
   * changes nothing a frame can land on. Every frame is held to the preview's
   * `valueAt`, read on the export's own scale (frame 0 at value 0, frame 8 —
   * the key at 1 — at value 1).
   */
  it('a linear rise and a smooth fall land every frame where the preview has it, at 30 fps', async () => {
    const keys: Keyframe[] = [
      { frame: 0, value: 0 },
      { frame: 5, value: 0.5 },
      { frame: 8, value: 1, ease: 'smooth' },
      { frame: 11, value: 0 }
    ]
    const means = await everyFrame('30fps-eased', 30, keys)
    expect(means.length).toBe(LENGTH)
    const lo = means[0]
    const hi = means[8]
    expect(hi - lo).toBeGreaterThan(150)
    for (let frame = 0; frame < LENGTH; frame++) {
      const read = (means[frame] - lo) / (hi - lo)
      expect(read, `frame ${frame}`).toBeCloseTo(valueAt(keys, frame, LENGTH, 1), 1)
    }
  }, 120_000)
})
