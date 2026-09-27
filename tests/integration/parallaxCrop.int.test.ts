import { beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { emptyProject, type Clip, type MediaAsset, type ParallaxBake, type Project } from '@shared/timeline'
import { buildRenderPlan } from '@shared/render/plan'
import { shotPicture, texturePlanFor } from '@shared/render/moment'
import { FFMPEG, outputDir, pixelAt, run, saveFrame, writeNote } from './output'

/*
 * A parallax shot's crop is in the PHOTOGRAPH's pixels; its planes are the
 * bake's size, which is smaller. The render used to hand the photo-pixel
 * crop to the plane composite as it was — so a 9:16 Director crop of a big
 * photo asked the 600-wide bake for 600 pixels from x = 300, got the whole
 * bake slid to x = 0, and the export showed the shot letterboxed at the
 * photo's own shape while the preview (which scales the crop into plane
 * space) filled the frame. Found by the C4 review: the moments engine follows
 * the preview, so the moment over such a shot disagreed with the export too.
 *
 * The photo here is 1200×900 and its bake 600×450: the back plane is red,
 * then blue, then green across, so where the composite's edges land is a
 * colour, and the near plane carries a white subject at the bake's centre.
 * The crop is the photo's middle 600×900 — the blue band of the bake — for a
 * 2:3 canvas HALF that size, so each plane's move pre-scales. Right, the frame is
 * blue to its edges with the subject dead centre; wrong, red at the left and
 * black bars above — or, with the planes scaled to sizes of their own, the
 * subject off its ground.
 */

const fps = 30
const canvas = { width: 150, height: 225 }
const PHOTO = { width: 1200, height: 900 }
const BAKE = { width: 600, height: 450 }
let dir = ''
let out = ''
let clip: Clip
let asset: MediaAsset
let bake: ParallaxBake
const lines: string[] = []

beforeAll(async () => {
  dir = await outputDir('parallaxCrop')
  const media = join(dir, 'media')
  await mkdir(media, { recursive: true })
  // The photo itself, never drawn when the planes are (the plan draws the composite), but probed for its size.
  const photo = join(media, 'photo.png')
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=gray:s=${PHOTO.width}x${PHOTO.height}`, '-frames:v', '1', photo])
  // The back plane at the bake's size: red to x = 150, blue to 450 (the crop, in bake pixels), green beyond.
  const back = join(media, 'back.png')
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=blue:s=${BAKE.width}x${BAKE.height}`,
    '-vf', `drawbox=x=0:y=0:w=150:h=${BAKE.height}:c=red:t=fill,drawbox=x=450:y=0:w=150:h=${BAKE.height}:c=green:t=fill`,
    '-frames:v', '1', back
  ])
  // The near plane: clear, with a small white subject in the blue third.
  const front = join(media, 'front.png')
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black@0:s=${BAKE.width}x${BAKE.height},format=rgba`,
    '-f', 'lavfi', '-i', 'color=c=white:s=40x40',
    '-filter_complex', '[0:v][1:v]overlay=280:205:format=auto', '-frames:v', '1', front
  ])
  asset = { id: 'img', path: photo, name: 'photo.png', kind: 'image', durationFrames: 90, ...PHOTO, fps: null, hasVideo: true, hasAudio: false, size: 0 }
  bake = {
    ...BAKE,
    separated: true,
    spread: 0.8,
    layers: [{ file: back, index: 0, depth: 0.05, coverage: 0.9 }, { file: front, index: 1, depth: 0.95, coverage: 0.05 }]
  }
  clip = {
    id: 'c1', assetId: 'img', trackId: 'v1', start: 0, duration: 30, inPoint: 0, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    color: { brightness: 0, contrast: 1, saturation: 1 },
    // The Director's reframe of a 4:3 photo for a 2:3 frame: the middle 600×900, in the PHOTO's pixels.
    crop: { x: 300, y: 0, width: 600, height: 900 },
    motion: { kind: 'parallax', direction: 'in', amount: 0.1 }
  }
  const project: Project = {
    ...emptyProject(),
    settings: { ...canvas, fps, sampleRate: 48000 },
    assets: [asset],
    clips: [clip],
    parallax: { img: bake }
  }
  out = join(dir, 'parallaxCrop.mp4')
  const plan = buildRenderPlan({ project, outputPath: out, canvas })
  await writeFile(join(dir, 'graph.txt'), plan.args.join(' ').replace(/;/g, ';\n'))
  await run(FFMPEG, plan.args, { maxBuffer: 64 * 1024 * 1024 })
}, 300_000)

/** Where the white subject is, in frame pixels. */
async function subjectCentre(file: string, seconds: number): Promise<{ x: number; y: number; pixels: number }> {
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }
  )
  const frame = stdout as unknown as Buffer
  let n = 0
  let sx = 0
  let sy = 0
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 3
      if (frame[i] > 200 && frame[i + 1] > 200 && frame[i + 2] > 200) {
        n++
        sx += x
        sy += y
      }
    }
  }
  return { x: n ? sx / n : Number.NaN, y: n ? sy / n : Number.NaN, pixels: n }
}

describe('a parallax shot with a crop in the photograph’s pixels', () => {
  it('is cropped where the photo says, scaled into the planes’ space: the blue third fills the frame to its edges, the subject on its ground', async () => {
    const t = 0.05
    await saveFrame(out, t, join(dir, 'first.png'))
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const leftQuarter = await pixelAt(out, t, Math.round(cx / 2), Math.round(cy), canvas)
    const rightQuarter = await pixelAt(out, t, Math.round(cx * 1.5), Math.round(cy), canvas)
    const left = await pixelAt(out, t, 4, Math.round(cy), canvas)
    const right = await pixelAt(out, t, canvas.width - 5, Math.round(cy), canvas)
    const top = await pixelAt(out, t, Math.round(cx), 4, canvas)
    const subject = await subjectCentre(out, t)
    lines.push(
      '# parallaxCrop', '',
      `A 1200×900 photo baked to 600×450 planes (back plane red to x 150, blue to 450, green beyond; a white subject at the bake's centre on the near plane),`,
      `cropped to the photo's middle 600×900 for a ${canvas.width}×${canvas.height} frame, with a parallax push-in.`, '',
      `- first frame: quarter points rgb(${leftQuarter.join(', ')}) and rgb(${rightQuarter.join(', ')}), left edge rgb(${left.join(', ')}), right edge rgb(${right.join(', ')}), top edge rgb(${top.join(', ')})`,
      `- the subject's centre at (${subject.x.toFixed(1)}, ${subject.y.toFixed(1)}) of ${subject.pixels} px; the frame's centre is (${cx}, ${cy})`,
      '  (the photo-pixel crop applied to the bake unscaled showed the whole bake: red at the left, green at the right, black above;',
      '   planes pre-scaled to sizes of their own put the subject off centre)'
    )
    await writeNote(dir, lines)
    for (const px of [leftQuarter, rightQuarter, left, right, top]) {
      expect(px[2], `blue in rgb(${px.join(', ')})`).toBeGreaterThan(180)
      expect(px[0], `no red in rgb(${px.join(', ')})`).toBeLessThan(60)
      expect(px[1], `no green in rgb(${px.join(', ')})`).toBeLessThan(60)
    }
    // The subject sits at the bake's centre, which is the crop's centre: on the frame's centre, to within a pixel or two of scaling.
    expect(subject.pixels).toBeGreaterThan(20)
    expect(Math.abs(subject.x - cx)).toBeLessThan(2.5)
    expect(Math.abs(subject.y - cy)).toBeLessThan(2.5)
  })

  it('shows the same rectangle the moments engine composes for that shot', () => {
    const plan = texturePlanFor(clip, asset, 0, bake.layers.map((l) => ({ file: l.file, depth: l.depth })))
    const picture = shotPicture(plan, 0, canvas, fps)
    // The blue third, in 0..1 of the picture — the same for the photo and for planes at any size.
    expect(picture.box).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(picture.layers.map((l) => l.plane)).toEqual([0, 1])
    for (const layer of picture.layers) {
      expect(layer.src.x).toBeGreaterThanOrEqual(0.25)
      expect(layer.src.x + layer.src.width).toBeLessThanOrEqual(0.75 + 1e-9)
      expect(layer.src.width).toBeGreaterThan(0.4)
    }
  })
})
