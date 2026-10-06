import { describe, it, expect, beforeAll } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { buildRenderPlan } from '@shared/render/plan'
import { emptyProject, framesToSeconds, splitClip, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { FFMPEG, run, outputDir, makeColour, writeNote } from './output'

/*
 * A split does not click — heard sample by sample, not assumed.
 *
 * Each clip's sound is put on the timeline by `adelay`. It used to be told
 * whole milliseconds, `Math.round(start × 1000)`, and a frame is not a whole
 * number of milliseconds: at 30 fps frame 47 is 1566.667 ms, which rounded to
 * 1567 is 16 samples late at 48 kHz. The left half ends at sample 75200 and
 * the right half began at 75216, so every split put 16 samples of silence in
 * the middle of the sound — a click, at every cut a user makes
 * (docs/CLIPS.md §3.3, EFFECTS.md §39).
 *
 * The click is measured as the largest SECOND DIFFERENCE of the samples near
 * each cut, x[n+1] − 2x[n] + x[n−1]. A 440 Hz sine's second difference is
 * tiny everywhere (0.0013 measured through the render, unsplit); a step
 * anywhere in the waveform is as large as the step. The same tone unsplit is
 * the control.
 *
 * And the placement is measured on its own: the samples after each cut are
 * lined up against the unsplit render, and the offset that matches best must
 * be zero. That is "the right half's first sample lands on frame/fps × rate".
 *
 * The source is a WAV, so decoding it is exact and nothing but the plan moves
 * a sample. The output is the plan's own (AAC in mp4), decoded to floats.
 *
 * Three cuts, each where a different wrong delay shows (EFFECTS.md §39 has
 * every number):
 *
 *   47  1566.667 ms. Whole ms put the next half 16 samples late: spike 0.172.
 *   62  99200.00000000001 samples in floating point, so `Math.ceil` puts the
 *       next half one sample late: 0.322, shift +1.
 *   73  116799.99999999999, so `Math.floor` (or `| 0`) puts it one early:
 *       0.319, shift −1. Not 69, the first such frame: 2.3 s is a zero
 *       crossing of the tone, and floor's overlap there measured only 0.0106.
 *
 * At 30 fps only. Every rate the app offers is a whole number of samples per
 * frame at 48 kHz, and only then is the delay exact: it, the input's `-ss`
 * and its `-t` all fall on whole samples. 29.97 is not offered and is NOT
 * exact — split there at frames 47 and 96, the middle half is one sample
 * short of the third (spike 0.21, measured with this fix in). This check
 * used to run 29.97 at frames 47 and 95, where the three roundings happen to
 * agree, and so it said more than was true. `tests/render.test.ts` fails if
 * an offered rate stops being a whole number of samples.
 */

const W = 160
const H = 120
const RATE = 48000
const FPS = 30
const SECONDS = 5
const CUTS = [47, 62, 73]
/** ±50 ms around each cut, where the click would be. */
const NEAR = Math.round(0.05 * RATE)
/** The plan's bar for a click (docs/CLIPS.md §3.3). */
const CLICK = 0.01
const FRAMES = Math.floor(SECONDS * FPS)

let dir = ''
let tonePath = ''
let picturePath = ''

beforeAll(async () => {
  dir = await outputDir('audio-split')
  tonePath = join(dir, 'source-tone.wav')
  /*
   * At half scale, not lavfi's own 1/8. A click's size is the size of the
   * step, so at 1/8 the 30 fps frame-47 gap measured 0.043 and a 29.97
   * overlap only 0.007 — under the 0.01 bar, though 22× the unsplit tone.
   * Four times louder puts every one of those clicks well over it.
   */
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${SECONDS}:sample_rate=${RATE}`,
    '-af', 'volume=4', '-c:a', 'pcm_s16le', tonePath])
  picturePath = await makeColour(join(dir, 'source-picture.mp4'), 'gray', { width: W, height: H }, SECONDS, FPS)
  await writeNote(dir, [
    `A 440 Hz tone split at frames ${CUTS.join(', ')} (30 fps), against the same tone unsplit.`,
    '',
    'whole.mp4      the tone as one clip on A1',
    'split.mp4      the same clip split three times through splitClip',
    '*.graph.txt    the filter graph each render ran (the adelay entries)',
    'measured.txt   the second-difference spike at each cut, per channel, and',
    '               the offset of each half against the whole render, in samples',
    '',
    'Before the fix (adelay in whole milliseconds) the split had 16 samples of',
    'silence at frame 47 — open split.mp4 in an editor and zoom in there.'
  ])
}, 300_000)

function project(sound: Clip[]): Project {
  const picture: MediaAsset = {
    id: 'pic', path: picturePath, name: 'pic', kind: 'video', durationFrames: FRAMES,
    width: W, height: H, fps: FPS, hasVideo: true, hasAudio: false, size: 1
  }
  const tone: MediaAsset = {
    id: 'tone', path: tonePath, name: 'tone', kind: 'audio', durationFrames: FRAMES,
    width: null, height: null, fps: null, hasVideo: false, hasAudio: true, size: 1
  }
  return {
    ...emptyProject(),
    settings: { width: W, height: H, fps: FPS, sampleRate: RATE },
    assets: [picture, tone],
    clips: [
      {
        id: 'bg', assetId: 'pic', trackId: 'v1', start: 0, duration: FRAMES, inPoint: 0, volume: 1,
        transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
        color: { brightness: 0, contrast: 1, saturation: 1 }
      },
      ...sound
    ]
  }
}

function toneClip(): Clip {
  return {
    id: 'tone', assetId: 'tone', trackId: 'a1', start: 0, duration: FRAMES, inPoint: 0, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    color: { brightness: 0, contrast: 1, saturation: 1 }
  }
}

/** The clip cut at each frame in turn, through the editor's own split. */
function splitAt(clip: Clip, frames: number[]): Clip[] {
  const out: Clip[] = []
  let rest = clip
  for (const frame of frames) {
    const pair = splitClip(rest, frame)
    if (!pair) throw new Error(`splitClip refused frame ${frame}`)
    out.push(pair[0])
    rest = pair[1]
  }
  return [...out, rest]
}

async function render(p: Project, name: string): Promise<string> {
  const file = join(dir, name)
  const { args } = buildRenderPlan({ project: p, outputPath: file })
  // The graph beside the render, so a failure shows what the delays were.
  const graph = args.indexOf('-filter_complex')
  if (graph > -1) await writeFile(`${file}.graph.txt`, `${args[graph + 1].split(';').join(';\n')}\n`, 'utf8')
  await run(FFMPEG, args, { maxBuffer: 32 * 1024 * 1024 })
  return file
}

/** The output's sound as floats, one array per channel. */
async function channels(file: string): Promise<[Float32Array, Float32Array]> {
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0', '-f', 'f32le', '-c:a', 'pcm_f32le', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }
  )
  const buf = stdout as unknown as Buffer
  const n = Math.floor(buf.length / 8)
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    left[i] = buf.readFloatLE(i * 8)
    right[i] = buf.readFloatLE(i * 8 + 4)
  }
  return [left, right]
}

/** The largest |x[n+1] − 2x[n] + x[n−1]| within `NEAR` of `centre`. */
function spike(x: Float32Array, centre: number): number {
  let max = 0
  const from = Math.max(1, centre - NEAR)
  const to = Math.min(x.length - 1, centre + NEAR)
  for (let n = from; n < to; n++) max = Math.max(max, Math.abs(x[n + 1] - 2 * x[n] + x[n - 1]))
  return max
}

/**
 * How many samples `x` sits behind `reference` over [from, to): the shift L
 * that minimises Σ (x[n] − reference[n − L])². Searched over ±40 samples,
 * under half the tone's 109-sample period, so the best match is unambiguous.
 */
function offset(x: Float32Array, reference: Float32Array, from: number, to: number): number {
  let best = 0
  let bestError = Number.POSITIVE_INFINITY
  for (let shift = -40; shift <= 40; shift++) {
    let error = 0
    for (let n = from; n < to; n++) {
      const d = x[n] - reference[n - shift]
      error += d * d
    }
    if (error < bestError) {
      bestError = error
      best = shift
    }
  }
  return best
}

interface Measured {
  /** The sample each cut should land on, frame/fps × rate. */
  at: number[]
  /** Per channel, per cut: the split's spike and the whole clip's. */
  split: number[][]
  whole: number[][]
  /** Per channel, per cut: the samples just after the cut, against the whole render. */
  after: number[][]
  /** Per channel: the samples before the first cut — the control, always 0. */
  before: number[]
  length: number
}

let measured: Promise<Measured> | null = null

function measure(): Promise<Measured> {
  measured ??= (async () => {
    const clips = splitAt(toneClip(), CUTS)
    // Four clips back to back, exactly where the one was.
    expect(clips.map((c) => c.start)).toEqual([0, ...CUTS])
    const whole = await channels(await render(project([toneClip()]), 'whole.mp4'))
    const split = await channels(await render(project(clips), 'split.mp4'))
    const at = CUTS.map((frame) => Math.round(framesToSeconds(frame, FPS) * RATE))
    const result: Measured = {
      at,
      split: split.map((ch) => at.map((c) => spike(ch, c))),
      whole: whole.map((ch) => at.map((c) => spike(ch, c))),
      after: split.map((ch, i) => at.map((c) => offset(ch, whole[i], c + 480, c + 2880))),
      before: split.map((ch, i) => offset(ch, whole[i], at[0] - 2880, at[0] - 480)),
      length: Math.min(whole[0].length, split[0].length)
    }
    await writeFile(
      join(dir, 'measured.txt'),
      `${JSON.stringify({ fps: FPS, cutsAtFrames: CUTS, ...result }, null, 2)}\n`,
      'utf8'
    )
    return result
  })()
  return measured
}

describe('a split tone does not click at the cut', () => {
  it('cuts where the delay rounds up, where it rounds down, and off a whole millisecond', () => {
    /*
     * The precondition the cuts were chosen for, computed as the plan computes
     * it. If the arithmetic ever stops landing a hair either side of these
     * samples, the check below would no longer tell round from floor or ceil,
     * and passing would mean less — so that fails here, by name.
     */
    expect((framesToSeconds(47, FPS) * 1000) % 1).not.toBe(0)
    expect(framesToSeconds(62, FPS) * RATE).toBeGreaterThan(99200)
    expect(framesToSeconds(73, FPS) * RATE).toBeLessThan(116800)
  })

  it(`has no second-difference spike above ${CLICK} at any cut`, async () => {
    const m = await measure()
    // The timeline's length of 48 kHz stereo came back, or the windows below
    // read the wrong samples. AAC rounds it up to whole 1024-sample frames
    // (measured +640 at 30 fps), hence the slack.
    expect(Math.abs(m.length - (FRAMES / FPS) * RATE)).toBeLessThan(4096)
    for (const ch of [0, 1]) {
      CUTS.forEach((frame, i) => {
        const where = `channel ${ch}, cut at frame ${frame} (sample ${m.at[i]})`
        // The control: the same tone unsplit is smooth here.
        expect(m.whole[ch][i], `${where}, unsplit`).toBeLessThan(CLICK)
        // The split is as smooth as the control, within the AAC's own noise.
        expect(m.split[ch][i], `${where}, split`).toBeLessThan(CLICK)
        expect(m.split[ch][i], `${where}, split against unsplit`).toBeLessThan(m.whole[ch][i] * 2 + 0.001)
      })
    }
  }, 300_000)

  it("starts each half on its frame's sample, in both channels", async () => {
    const m = await measure()
    for (const ch of [0, 1]) {
      // The control: before any cut both renders are the same clip.
      expect(m.before[ch], `channel ${ch}, before the first cut`).toBe(0)
      CUTS.forEach((frame, i) => {
        expect(m.after[ch][i], `channel ${ch}, after the cut at frame ${frame}`).toBe(0)
      })
    }
  }, 300_000)
})
