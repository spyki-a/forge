import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { buildRenderPlan } from '@shared/render/plan'
import { solveCrop } from '@shared/render/crop'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { probeFile } from '../../src/main/ffmpeg/probe'
import { toAsset } from '../../src/main/assets'
import { locateAsset, probeImports, relinkable } from '../../src/main/imports'
import { FFMPEG, outputDir, run, writeNote } from './output'

/*
 * Portrait phone media is upright everywhere (docs/CLIPS.md §3.1, BETA.md R5,
 * EFFECTS.md §49).
 *
 * A phone clip is stored landscape with a display matrix, and both bundled
 * ffmpegs turn it as they DECODE it: a 640×360 clip with a 90° matrix probed
 * 640×360 and decoded 360×640. The asset carried the coded size, so the
 * reframe (`solveCrop`, what every dropped clip and every Director shot gets)
 * cut a 9:16 sliver out of what it thought was a landscape picture — out of a
 * frame that was already 9:16 — and the export showed a zoomed-in band of it.
 * A phone JPEG is the other way round: ffmpeg ignores its EXIF orientation, so
 * it rendered on its side while the preview's <img> showed it upright.
 *
 * Here: the probe's size IS the decoded frame's size, for an untagged clip, a
 * 90° remux, a 4K phone-shaped clip tagged 270 and the stills; tagged JPEGs
 * import as turned copies; and a 9:16 export of each, reframed the way a
 * dropped clip is, is the upright picture filling the frame. Run on both
 * ffmpegs — CI's is the 2018 Windows build, whose autorotate reads the same
 * matrix (fftools/ffmpeg_filter.c:801-819 at f22fcd4, read).
 */

const FFPROBE: string = ffprobeInstaller.path
const canvas = { width: 540, height: 960 }
let dir = ''
let source = ''
const files: Record<string, string> = {}
const lines: string[] = []

/**
 * One frame as luma, scaled by `filter` (if any), the whole buffer. No `-ss`
 * for the first frame: any `-ss` before a JPEG, even 0, decodes nothing
 * (measured, EFFECTS.md §49).
 */
async function grey(file: string, seconds: number, filter?: string): Promise<Buffer> {
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', ...(seconds > 0 ? ['-ss', String(seconds)] : []), '-i', file, '-frames:v', '1',
     ...(filter ? ['-vf', filter] : []), '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
  )
  return stdout as unknown as Buffer
}

/** The size of the first frame ffmpeg decodes — what a render or a detector is handed. */
async function decodedSize(file: string): Promise<{ width: number; height: number }> {
  const png = join(dir, `decoded-${basename(file)}.png`)
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-frames:v', '1', png])
  const meta = await sharp(png).metadata()
  return { width: meta.width ?? 0, height: meta.height ?? 0 }
}

function meanDifference(a: Buffer, b: Buffer): number {
  expect(a.length, 'two frames of one size').toBe(b.length)
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

function project(asset: MediaAsset): Project {
  // Reframed as a dropped clip is (store.ts `addClip` → shared `solveCrop`).
  const clip: Clip = {
    id: 'c', assetId: asset.id, trackId: 'v1', start: 0, duration: Math.min(30, asset.durationFrames), inPoint: 0, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    color: { brightness: 0, contrast: 1, saturation: 1 },
    crop: solveCrop(asset, canvas)
  }
  const empty = emptyProject()
  return { ...empty, settings: { ...empty.settings, ...canvas, fps: 30 }, assets: [asset], clips: [clip] }
}

/** The 9:16 export of one asset, and how far its frame at `at` seconds is from `expected`. */
async function exportDifference(name: string, asset: MediaAsset, expected: Buffer, at: number): Promise<number> {
  const out = join(dir, `export-${name}.mp4`)
  await run(FFMPEG, buildRenderPlan({ project: project(asset), outputPath: out, canvas }).args, { maxBuffer: 32 * 1024 * 1024 })
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(at), '-i', out, '-frames:v', '1', join(dir, `export-${name}.png`)])
  const difference = meanDifference(await grey(out, at), expected)
  lines.push(`export-${name}: crop ${JSON.stringify(project(asset).clips[0].crop ?? null)}, mean |difference| from the upright picture ${difference.toFixed(2)}`)
  return difference
}

/** Mean luma difference under which an export is the upright picture (measured: see the README). */
const SAME = 6

beforeAll(async () => {
  dir = await outputDir('rotation')
  // An asymmetric still, so a turn the wrong way, a squash or a crop all show.
  source = join(dir, 'source.png')
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=1', '-frames:v', '1', source])
  const encode = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']
  files.plain = join(dir, 'plain.mp4')
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-framerate', '30', '-i', source, '-t', '1', ...encode, files.plain])
  // A phone's way of storing portrait: the landscape stream, and a matrix that says turn it.
  files.rot90 = join(dir, 'rot90.mp4')
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', files.plain, '-c', 'copy', '-metadata:s:v:0', 'rotate=90', files.rot90])
  const big = join(dir, 'phone-4k-coded.mp4')
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-framerate', '30', '-i', source, '-t', '0.2',
    '-vf', 'scale=3840:2160', ...encode, big])
  files.phone4k = join(dir, 'phone-4k-rot270.mp4')
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', big, '-c', 'copy', '-metadata:s:v:0', 'rotate=270', files.phone4k])
  for (const orientation of [1, 3, 6, 8]) {
    files[`exif${orientation}`] = join(dir, `photo exif-${orientation}.jpg`)
    await sharp(source).jpeg({ quality: 95 }).withMetadata({ orientation }).toFile(files[`exif${orientation}`])
  }
  lines.push(
    '# rotation',
    '',
    'Portrait phone media, probed, imported and exported at 9:16 (540x960), reframed as a dropped clip is.',
    `ffmpeg ${FFMPEG}`,
    `ffprobe ${FFPROBE}`,
    '',
    'source.png            the picture (testsrc, 640x360)',
    'plain.mp4             it as a 1 s clip, no matrix',
    'rot90.mp4             the same stream remuxed with rotate=90: decodes 360x640',
    'phone-4k-rot270.mp4   3840x2160 remuxed with rotate=270: decodes 2160x3840',
    'photo exif-N.jpg      the picture as a JPEG tagged with EXIF orientation N',
    'converted/            the turned copies the import made',
    'export-*.mp4/png      each 9:16 export; its middle frame against the upright picture',
    ''
  )
}, 120_000)

afterAll(async () => {
  await writeNote(dir, lines)
})

describe('the probe reads the size the frames arrive at', () => {
  it('leaves an untagged clip as it was', async () => {
    const info = await probeFile(files.plain)
    expect({ width: info.width, height: info.height, rotation: info.rotation }).toEqual({ width: 640, height: 360, rotation: 0 })
    expect(await decodedSize(files.plain)).toEqual({ width: 640, height: 360 })
    // An upright file's asset is unchanged: no rotation field at all.
    expect(toAsset(info, 30)).not.toHaveProperty('rotation')
  })

  it('swaps the sides of a 90° remux, as the decoder does', async () => {
    const info = await probeFile(files.rot90)
    const decoded = await decodedSize(files.rot90)
    lines.push(`rot90.mp4 probed ${info.width}x${info.height} turned ${info.rotation}, decoded ${decoded.width}x${decoded.height}`)
    expect(decoded).toEqual({ width: 360, height: 640 })
    expect({ width: info.width, height: info.height }).toEqual(decoded)
    expect([90, 270]).toContain(info.rotation)
    expect(toAsset(info, 30).rotation).toBe(info.rotation)
  })

  it('swaps a 4K phone-shaped clip tagged 270', async () => {
    const info = await probeFile(files.phone4k)
    const decoded = await decodedSize(files.phone4k)
    lines.push(`phone-4k-rot270.mp4 probed ${info.width}x${info.height} turned ${info.rotation}, decoded ${decoded.width}x${decoded.height}`)
    expect(decoded).toEqual({ width: 2160, height: 3840 })
    expect({ width: info.width, height: info.height }).toEqual(decoded)
    expect([90, 270]).toContain(info.rotation)
  })
})

describe('a still tagged with an EXIF orientation imports turned', () => {
  // EXIF orientation → the turn that shows it upright, as an ffmpeg filter on the stored pixels.
  const turns: Record<number, { filter: string; width: number; height: number }> = {
    3: { filter: 'hflip,vflip', width: 640, height: 360 },
    6: { filter: 'transpose=clock', width: 360, height: 640 },
    8: { filter: 'transpose=cclock', width: 360, height: 640 }
  }

  it('turns orientations 3, 6 and 8 into upright copies, and leaves 1 alone', async () => {
    const paths = [1, 3, 6, 8].map((o) => files[`exif${o}`])
    const { assets, failed } = await probeImports(paths, 30, join(dir, 'converted'))
    expect(failed).toEqual([])
    expect(assets).toHaveLength(4)

    const plain = assets.find((a) => a.name === basename(files.exif1))!
    expect(plain.path, 'an upright JPEG is read where it is').toBe(files.exif1)
    expect(plain).not.toHaveProperty('source')
    expect({ width: plain.width, height: plain.height }).toEqual({ width: 640, height: 360 })

    for (const [orientation, turn] of Object.entries(turns)) {
      const original = files[`exif${orientation}`]
      const asset = assets.find((a) => a.name === basename(original))!
      lines.push(`exif-${orientation}: asset ${asset.width}x${asset.height}, reads ${basename(asset.path)}`)
      expect(asset.source, `exif-${orientation} stands for the file imported`).toBe(original)
      expect(asset.path).not.toBe(original)
      expect({ width: asset.width, height: asset.height }, `exif-${orientation}`).toEqual({ width: turn.width, height: turn.height })
      expect(await decodedSize(asset.path), `exif-${orientation}: what ffmpeg decodes`).toEqual({ width: turn.width, height: turn.height })
      // The copy's pixels are the stored ones turned the way EXIF says — not merely the right shape.
      const difference = meanDifference(await grey(asset.path, 0), await grey(source, 0, turn.filter))
      lines.push(`exif-${orientation}: copy against source.png through ${turn.filter}: ${difference.toFixed(2)}`)
      expect(difference, `exif-${orientation} turned by ${turn.filter}`).toBeLessThan(SAME)
    }
  })

  it('turns one a relink finds the same way, and remakes a lost copy when the project opens', async () => {
    // The relink dialog and "point me at the folder" go through `relinkable`, not the import.
    const cache = join(dir, 'converted-relink')
    await rm(cache, { recursive: true, force: true })
    const relinked = await relinkable({ turned: files.exif6, upright: files.exif1 }, cache)
    expect(relinked.upright, 'an upright JPEG is relinked as itself').toBe(files.exif1)
    expect(relinked.turned, 'an orientation-6 JPEG is relinked through a turned copy').toEqual({
      path: expect.any(String),
      source: files.exif6
    })
    const copy = (relinked.turned as { path: string }).path
    expect(await decodedSize(copy), 'what ffmpeg decodes of the relinked copy').toEqual({ width: 360, height: 640 })
    const difference = meanDifference(await grey(copy, 0), await grey(source, 0, 'transpose=clock'))
    lines.push(`relinked exif-6: reads ${basename(copy)}, against source.png through transpose=clock: ${difference.toFixed(2)}`)
    expect(difference).toBeLessThan(SAME)

    // The cache emptied and the project opened: `locateAsset` makes the turned copy again from the photo.
    const { assets } = await probeImports([files.exif6], 30, cache)
    await rm(cache, { recursive: true, force: true })
    const located = await locateAsset(assets[0], dir, [], cache)
    expect(located.offline).toBeUndefined()
    expect(located.source).toBe(files.exif6)
    expect(await decodedSize(located.path), 'what ffmpeg decodes of the remade copy').toEqual({ width: 360, height: 640 })
  })
})

describe('a 9:16 export of portrait phone media is the upright picture, filling the frame', () => {
  it('a 90° clip', async () => {
    const asset = toAsset(await probeFile(files.rot90), 30)
    const expected = await grey(files.rot90, 0.5, `scale=${canvas.width}:${canvas.height}`)
    const difference = await exportDifference('rot90', asset, expected, 0.5)
    // The reframe sees the upright size: a 9:16 picture in a 9:16 frame needs no crop.
    expect(solveCrop(asset, canvas)).toBeUndefined()
    expect(difference).toBeLessThan(SAME)
  })

  it('a 4K clip tagged 270', async () => {
    const asset = toAsset(await probeFile(files.phone4k), 30)
    const expected = await grey(files.phone4k, 0.1, `scale=${canvas.width}:${canvas.height}`)
    const difference = await exportDifference('phone4k', asset, expected, 0.1)
    expect(solveCrop(asset, canvas)).toBeUndefined()
    expect(difference).toBeLessThan(SAME)
  })

  it('an EXIF-6 photo', async () => {
    const { assets } = await probeImports([files.exif6], 30, join(dir, 'converted'))
    const expected = await grey(source, 0, `transpose=clock,scale=${canvas.width}:${canvas.height}`)
    const difference = await exportDifference('exif6', assets[0], expected, 0.5)
    expect(solveCrop(assets[0], canvas)).toBeUndefined()
    expect(difference).toBeLessThan(SAME)
  })
})
