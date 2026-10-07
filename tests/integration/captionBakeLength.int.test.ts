import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { copyFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildRenderPlan, type RenderRequest } from '@shared/render/plan'
import { buildGraphicsSpec, captionsNeedBaking } from '@shared/graphics/fromTimeline'
import type { CaptionLayer } from '@shared/graphics/spec'
import { concatList, planBakeOf } from '@shared/captions/bake'
import { emptyProject, projectDuration, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { segmentIntoSentences, type Word } from '@shared/transcript'
import { clearCaptionFrames, writeCaptionFrame, writeCaptionList } from '../../src/main/captions'
import { FFMPEG, makeColour, outputDir, run, saveFrame, writeNote } from './output'

/*
 * A baked caption must not decide how long the export is.
 *
 * Styled captions (a look libass cannot draw — 'kinetic' here) are painted to
 * pictures and replayed through the concat demuxer as one more overlay, with
 * `shortest=1`. The bake used to be planned only up to the last caption's end
 * (buildGraphicsSpec's durationFrames, as bakeCaptions passes it), so the
 * overlay's shortest input was the CAPTIONS and the whole export stopped where
 * the speech did: a 30-frame clip whose one caption covers frames 0–7 came out
 * 10 frames long (the caption's 8, plus the 2 the concat list's repeated last
 * entry holds), and a marked range starting after the last caption came out
 * with no video stream at all. Found while writing clipIt.int (EFFECTS.md §42); the fix is §43.
 *
 * Each case is the app's path around one stand-in: buildGraphicsSpec →
 * planBakeOf (the step bakeCaptions takes, shared so this runs it rather than
 * a copy; captionBake.test pins that the renderer calls it) → concatList,
 * written by main's writeCaptionFrame / writeCaptionList, overlaid as
 * `captionOverlay` through buildRenderPlan and the bundled ffmpeg. The pictures are the renderer's to
 * paint (a canvas), so each is a stand-in: the band, transparent but for one
 * opaque white block where a caption would be. The picture under it is a flat
 * mid grey, so every frame of the export says one of three things at the block:
 * the caption (white), the picture (grey), or nothing (black — the base canvas
 * showing where the clip should be).
 *
 * Read whole, frame by frame (`-vsync 0`): the export's frame count must be the
 * plan's durationFrames, frames inside the caption must show the block, and
 * frames after it must show the picture and no block. One frame of slack at
 * each edge of the caption, none in the count: the concat demuxer times its
 * pictures in the PNG's own 1/25 s ticks (measured, §42), so a change can land
 * a frame off at 30 fps — it lands exact here, on this build. Artefacts in
 * tests/output/captionBakeLength/.
 *
 * Every 30 fps case here ends on a 1/25 s tick (30 frames is 1.000 s), and so
 * does captionOverlay.int. One case does not: 61 frames at 60 fps is 1.0167 s,
 * which the list's repeated last entry rounds DOWN to the 1.00 s tick, so the
 * bake reaches the video's end only by that entry's own 40 ms. That is the
 * case §43 could only date for the 2018 Windows build; this runs it there.
 */

const W = 320
const H = 240
const FPS = 30
const CANVAS = { width: W, height: H }
/** The clip: a second of grey, from a two-second source. */
const CLIP_FRAMES = 30
/** The band the bake is overlaid in, and the block inside it a caption draws. */
const BAND_Y = 160
const BAND_H = 60
const BLOCK = { x: 40, y: 10, w: 240, h: 40 }
/** Where the block is read (inside it) — frame coordinates. */
const READ = { x: 150, y: BAND_Y + 20 }

/** One word, 0–250 ms: the caption covers timeline frames [0, 8) at 30 fps. */
const ONE: Word[] = [{ index: 0, text: 'one', startMs: 0, endMs: 250, confidence: 1 }]
const CAPTION = { start: 0, end: 8 }
/**
 * The off-tick edit: 61 frames at 60 fps, 1.0167 s — not a multiple of the
 * concat input's 1/25 s. The same word covers frames [0, 15) there.
 */
const FPS_60 = 60
const CLIP_FRAMES_60 = 61
const CAPTION_60 = { start: 0, end: 15 }

let dir = ''
/** The grey source at each frame rate a case uses, made in beforeAll. */
const sources = new Map<number, string>()
const savedUserData = process.env.FORGE_TEST_USERDATA
const notes: string[] = []

function project(words: Word[] | null, fps = FPS, frames = CLIP_FRAMES): Project {
  const asset: MediaAsset = {
    id: 'a1', path: sources.get(fps) ?? '', name: 'grey', kind: 'video', durationFrames: 2 * fps,
    width: W, height: H, fps, hasVideo: true, hasAudio: false, size: 0
  }
  const clip: Clip = {
    id: 'c1', assetId: 'a1', trackId: 'v1', start: 0, duration: frames, inPoint: 0, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, fit: 'cover' },
    color: { brightness: 0, contrast: 1, saturation: 1 }
  }
  return {
    ...emptyProject(),
    settings: { width: W, height: H, fps, sampleRate: 48000 },
    assets: [asset],
    clips: [clip],
    transcripts: words
      ? { a1: { assetId: 'a1', language: 'en', model: 'test', durationMs: 2000, words, segments: segmentIntoSentences(words) } }
      : {},
    // Animated: the canvas bake's, not libass's (ExportStrip routes on captionNeedsCanvas).
    captions: { enabled: true, styleId: 'kinetic' }
  }
}

/** A band-sized picture: transparent, with or without the opaque block. */
const standIns = new Map<boolean, Buffer>()
async function standIn(lit: boolean): Promise<Buffer> {
  const known = standIns.get(lit)
  if (known) return known
  const file = join(dir, `standin-${lit ? 'caption' : 'blank'}.png`)
  // An opaque block overlaid on a transparent canvas, not drawbox: drawbox leaves alpha 0 (captionOverlay.int).
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=black@0:size=${W}x${BAND_H},format=rgba`,
    ...(lit
      ? ['-f', 'lavfi', '-i', `color=white:size=${BLOCK.w}x${BLOCK.h},format=rgba`, '-filter_complex', `[0][1]overlay=${BLOCK.x}:${BLOCK.y}:format=auto`]
      : []),
    '-frames:v', '1', file
  ])
  const bytes = await readFile(file)
  standIns.set(lit, bytes)
  return bytes
}

/**
 * The bake as bakeCaptions makes it, around the painting: the spec, its plan
 * from planBakeOf, a picture per distinct picture, the list. Null when there
 * is nothing to draw — and then the export goes without an overlay. `frames`
 * stands in a longer spec, for the one case of a bake longer than the video.
 */
async function bake(name: string, p: Project, frames?: number): Promise<{ listPath: string; totalFrames: number } | null> {
  const spec = buildGraphicsSpec(p, CANVAS)
  if (!spec) return null
  const baked = planBakeOf(frames === undefined ? spec : { ...spec, durationFrames: frames })
  if (!baked) return null
  const { plan } = baked
  await clearCaptionFrames()
  const files: string[] = []
  for (const [i, picture] of plan.pictures.entries()) {
    files.push(await writeCaptionFrame(i, await standIn(picture.layer >= 0)))
  }
  const listPath = await writeCaptionList(concatList(plan, spec.fps, (q) => files[q]))
  await copyFile(listPath, join(dir, `${name}-list.txt`))
  return { listPath, totalFrames: plan.totalFrames }
}

interface Reading {
  /** Frames in the export's video stream (0 when it has none). */
  count: number
  /** Per frame: the mean level at the block. */
  level: number[]
}

/** The export decoded whole: how many frames, and what each shows at the block. */
async function read(file: string): Promise<Reading> {
  let bytes: Buffer
  try {
    const { stdout } = await run(
      FFMPEG,
      ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-vsync', '0',
       '-vf', `crop=16:16:${READ.x}:${READ.y}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
    )
    bytes = stdout as unknown as Buffer
  } catch (err) {
    // An export with no video stream at all is a reading of zero frames, not a crash of the check.
    if (/matches no streams|does not contain any stream/.test(String(err))) return { count: 0, level: [] }
    throw err
  }
  const size = 16 * 16
  const level: number[] = []
  for (let f = 0; f * size < bytes.length; f++) {
    let total = 0
    for (let i = 0; i < size; i++) total += bytes[f * size + i]
    level.push(total / size)
  }
  return { count: level.length, level }
}

/** White: the caption's block. */
const isBlock = (v: number): boolean => v > 200
/** Mid grey: the picture, neither the block nor the black canvas under a missing clip. */
const isPicture = (v: number): boolean => v > 100 && v < 160

interface Case {
  name: string
  /** Built when rendered: the source path exists only once beforeAll has made it. */
  p: () => Project
  range?: { start: number; end: number }
  /** A bake planned to this many frames instead of spec.durationFrames. */
  bakeFrames?: number
  /** The caption's timeline frames, at this case's rate. */
  caption?: { start: number; end: number }
}

const CASES: Case[] = [
  { name: 'short', p: () => project(ONE), caption: CAPTION },
  { name: 'longer-bake', p: () => project(ONE), bakeFrames: 2 * CLIP_FRAMES, caption: CAPTION },
  { name: 'range-before', p: () => project(ONE), range: { start: 2, end: 6 }, caption: CAPTION },
  { name: 'range-after', p: () => project(ONE), range: { start: 4, end: 20 }, caption: CAPTION },
  { name: 'range-past', p: () => project(ONE), range: { start: 10, end: 30 }, caption: CAPTION },
  { name: 'off-tick-60', p: () => project(ONE, FPS_60, CLIP_FRAMES_60), caption: CAPTION_60 },
  { name: 'no-captions', p: () => project(null) }
]

const results = new Map<string, {
  plan: number; bake: number | null; reading: Reading; start: number; caption?: { start: number; end: number }
}>()

beforeAll(async () => {
  dir = await outputDir('captionBakeLength')
  // The stub's userData is `<this>/userData`: the bake's pictures and list land there, as main writes them.
  process.env.FORGE_TEST_USERDATA = dir
  sources.set(FPS, await makeColour(join(dir, 'grey.mp4'), '0x808080', CANVAS, 2, FPS))
  sources.set(FPS_60, await makeColour(join(dir, 'grey60.mp4'), '0x808080', CANVAS, 2, FPS_60))

  for (const c of CASES) {
    const file = join(dir, `${c.name}.mp4`)
    const p = c.p()
    const baked = await bake(c.name, p, c.bakeFrames)
    const request: RenderRequest = {
      project: p,
      outputPath: file,
      canvas: CANVAS,
      range: c.range,
      captionOverlay: baked ? { listPath: baked.listPath, y: BAND_Y, height: BAND_H } : undefined
    }
    const plan = buildRenderPlan(request)
    await run(FFMPEG, plan.args, { maxBuffer: 64 * 1024 * 1024 })
    const reading = await read(file)
    results.set(c.name, {
      plan: plan.durationFrames, bake: baked?.totalFrames ?? null, reading, start: c.range?.start ?? 0, caption: c.caption
    })
    const lit = reading.level.flatMap((v, i) => (isBlock(v) ? [i] : []))
    const fps = p.settings.fps
    notes.push(
      `- ${c.name}${c.range ? ` (range ${c.range.start}–${c.range.end})` : ''}${fps === FPS ? '' : ` at ${fps} fps`}: ` +
        `plan ${plan.durationFrames} frames, ` +
        `bake ${baked ? `${baked.totalFrames} frames` : 'none'}, export ${reading.count} frames; ` +
        `block on export frames ${lit.length ? `${lit[0]}–${lit[lit.length - 1]} (${lit.length})` : 'none'}`
    )
    if (reading.count > 0) await saveFrame(file, (reading.count - 1) / fps, join(dir, `${c.name}-last.png`))
  }
}, 300_000)

afterAll(async () => {
  if (savedUserData === undefined) delete process.env.FORGE_TEST_USERDATA
  else process.env.FORGE_TEST_USERDATA = savedUserData
  if (!dir) return
  await writeNote(dir, [
    '# captionBakeLength — a baked caption must not decide how long the export is',
    '',
    `ffmpeg ${FFMPEG}. A 30-frame clip of flat grey (0x808080, 320×240, 30 fps), captioned in "kinetic" (the canvas bake),`,
    'one word 0–250 ms: the caption covers timeline frames 0–7. The bake as bakeCaptions plans it (buildGraphicsSpec →',
    'planBakeOf → concatList, written by main), with stand-in pictures: the band transparent but for',
    'a white block at x 40–280, y 170–210 of the frame. Read at (150, 180), 16×16: white = the caption, grey = the picture,',
    'black = the base canvas where the clip went missing.',
    '',
    'off-tick-60 is the same word over a 61-frame clip at 60 fps (1.0167 s, off the concat input\'s 1/25 s ticks):',
    'the caption covers timeline frames 0–14.',
    '',
    'Files: <case>.mp4 (the export), <case>-list.txt (the concat list), <case>-last.png (its last frame), userData/ (main\'s bake folder).',
    '',
    ...notes
  ])
})

/** The timeline frame an export frame shows: the range's front comes off. */
const timeline = (name: string, exportFrame: number): number => results.get(name)!.start + exportFrame

/**
 * Every frame inside the caption shows the block, every frame after it shows
 * the picture; one frame of slack at each of the caption's edges.
 */
function expectCaptionWhereItIs(name: string): void {
  const { reading, caption } = results.get(name)!
  expect(caption, `${name} has a caption`).toBeDefined()
  const { start, end } = caption!
  for (const [i, v] of reading.level.entries()) {
    const t = timeline(name, i)
    if (t > start && t < end - 1) expect.soft(isBlock(v), `${name}: export frame ${i} (timeline ${t}) is inside the caption, level ${v}`).toBe(true)
    if (t > end) expect.soft(isPicture(v), `${name}: export frame ${i} (timeline ${t}) is after the caption, level ${v}`).toBe(true)
  }
}

describe('a baked caption does not decide how long the export is', () => {
  it('the fixture: kinetic is baked, and its one caption ends well before the clip does', () => {
    const p = project(ONE)
    expect(captionsNeedBaking(p)).toBe(true)
    const spec = buildGraphicsSpec(p, CANVAS)!
    const layers = spec.layers.filter((l): l is CaptionLayer => l.kind === 'caption')
    expect(layers.map((l) => [l.startFrame, l.endFrame])).toEqual([[CAPTION.start, CAPTION.end]])
    expect(projectDuration(p)).toBe(CLIP_FRAMES)

    // The off-tick edit: the same word at 60 fps, over an edit that is not a whole number of 1/25 s ticks.
    const p60 = project(ONE, FPS_60, CLIP_FRAMES_60)
    const layers60 = buildGraphicsSpec(p60, CANVAS)!.layers.filter((l): l is CaptionLayer => l.kind === 'caption')
    expect(layers60.map((l) => [l.startFrame, l.endFrame])).toEqual([[CAPTION_60.start, CAPTION_60.end]])
    expect(projectDuration(p60)).toBe(CLIP_FRAMES_60)
    expect(Number.isInteger((CLIP_FRAMES_60 / FPS_60) * 25), 'the edit ends off a 1/25 s tick').toBe(false)
  })

  it('captions shorter than the video: the export keeps every frame, and the tail is the picture without a caption', () => {
    const r = results.get('short')!
    expect(r.plan).toBe(CLIP_FRAMES)
    expect(r.reading.count, 'frames exported').toBe(r.plan)
    expectCaptionWhereItIs('short')
    // The tail exists and is bare: a caption held past its end would show here.
    const tail = r.reading.level.slice(CAPTION.end + 1)
    expect(tail.length).toBeGreaterThan(0)
    expect(tail.filter(isBlock), 'block frames after the caption').toEqual([])
  })

  it('a bake longer than the video does not extend it', () => {
    const r = results.get('longer-bake')!
    expect(r.bake).toBeGreaterThan(r.plan)
    expect(r.reading.count, 'frames exported').toBe(r.plan)
    expectCaptionWhereItIs('longer-bake')
  })

  it('a marked range that ends BEFORE the last caption: the range, every frame of it captioned', () => {
    const r = results.get('range-before')!
    expect(r.plan).toBe(4)
    expect(r.reading.count, 'frames exported').toBe(r.plan)
    expectCaptionWhereItIs('range-before')
  })

  it('a marked range that ends AFTER the last caption: the whole range, the caption at its own frames', () => {
    const r = results.get('range-after')!
    expect(r.plan).toBe(16)
    expect(r.reading.count, 'frames exported').toBe(r.plan)
    expectCaptionWhereItIs('range-after')
    // The bake and the video agree on where the export STARTS: timeline 4–7 are export frames 0–3.
    expect(r.reading.level.slice(0, 3).every(isBlock), 'the caption opens the range').toBe(true)
  })

  it('a marked range that starts after the last caption: the range, all picture', () => {
    const r = results.get('range-past')!
    expect(r.plan).toBe(20)
    expect(r.reading.count, 'frames exported').toBe(r.plan)
    expect(r.reading.level.every(isPicture), 'every frame the picture, none the block').toBe(true)
  })

  it('an edit that ends off a 1/25 s tick (61 frames at 60 fps): every frame, the tail bare', () => {
    /*
     * The list's repeated last entry starts on the tick BEFORE the edit's end
     * here (1.00 s for 1.0167 s), so only its own tick carries the bake to the
     * last frame. Ends on a tick everywhere else in this check and in
     * captionOverlay.int; this is the one Windows CI can disagree on.
     */
    const r = results.get('off-tick-60')!
    expect(r.plan).toBe(CLIP_FRAMES_60)
    expect(r.reading.count, 'frames exported').toBe(r.plan)
    expectCaptionWhereItIs('off-tick-60')
    const tail = r.reading.level.slice(CAPTION_60.end + 1)
    expect(tail.length).toBeGreaterThan(0)
    expect(tail.filter(isBlock), 'block frames after the caption').toEqual([])
  })

  it('no captions at all: no overlay, and the export is the plan', () => {
    const r = results.get('no-captions')!
    expect(r.bake).toBeNull()
    expect(r.reading.count, 'frames exported').toBe(r.plan)
    expect(r.plan).toBe(CLIP_FRAMES)
    expect(r.reading.level.every(isPicture)).toBe(true)
  })
})
