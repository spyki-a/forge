import { beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { buildRenderPlan } from '@shared/render/plan'
import { DEFAULT_CAPTION_STYLE } from '@shared/captions/style'
import { REFERENCE_HEIGHT, toAssTime } from '@shared/captions/ass'
import { EXIT_S, graphicExitKeys } from '@shared/graphics/frame'
import { M19_BAR, chromaAlong, strokeLines, type ChromaReading, type StrokeLine } from '../../src/renderer/src/harness/graphicMeasure'
import { FFMPEG, OUTPUT_ROOT, makeColour, outputDir, run, saveFrame, writeNote } from './output'
import { ciNotice } from './helperDiag'

/*
 * The graphics engine's render check (docs/CLIPS.md §6.11, "The render
 * check"), into tests/output/graphic/. Phase 0 is its first case: the libass
 * reference for M22 (§6.11 "Phase 0's cases", §6.15's M22 row). Phases 1-4
 * add theirs below it, on moment.int's pattern.
 *
 * M22 asks whether the canvas painter (`drawTextOnto`) shapes Hindi and
 * Telugu. That is measured in the app's renderer (the harness's `indic`
 * option); what node can give it is the thing the eye compares those frames
 * against: the EFFECTS §51 clusters burnt by libass through the plan's own
 * caption filter, `ass=…:shaping=complex`, and again at `shaping=simple`,
 * kept on disk. captions.int's Indic case cannot be that reference: it
 * carries four of each script's five clusters (no ज्ञ, no స్త) and renders into
 * a temp folder it deletes.
 *
 * Nothing here asserts on a face. `/assets` is gitignored, so on CI libass
 * draws whatever fallback it finds (EFFECTS §60), and on the Mac CoreText's
 * Kohinoor (EFFECTS §51). What is asserted is the shape of the reference:
 * every event is on screen at each level, and each sheet is made of its own
 * level's frames. Whether complex and simple differ is printed, per cluster,
 * in one notice: GitHub keeps ten notices a step (helperDiag.ts `ciNotice`),
 * so ten notices from this file alone would crowd out every other file's.
 */

const FPS = 30

/**
 * M19's folder (docs/CLIPS.md §6.15): a graphic's PNGs, as the harness's
 * `strokes` option bakes them into the app's title-frame folder and names it.
 * Unset, M19's read skips, with why.
 */
const STROKE_FRAMES = process.env.FORGE_GRAPHIC_FRAMES ?? ''

/** Whether `child` is `parent` or inside it. */
const within = (parent: string, child: string): boolean => {
  const r = relative(parent, child)
  return r === '' || (!r.startsWith('..') && !isAbsolute(r))
}

// This file empties tests/output/graphic first (outputDir): a folder of PNGs inside it would be gone before it is read.
if (STROKE_FRAMES !== '' && within(join(OUTPUT_ROOT, 'graphic'), resolve(STROKE_FRAMES))) {
  throw new Error(`FORGE_GRAPHIC_FRAMES=${STROKE_FRAMES} is inside ${join(OUTPUT_ROOT, 'graphic')}, which this file empties before it runs: copy the PNGs elsewhere first`)
}

let root = ''

beforeAll(async () => {
  root = await outputDir('graphic')
})

/* ------------------------------------------------- phase 0: the libass reference */

/**
 * The EFFECTS §51 clusters (क्ष त्र ज्ञ श्र कि, క్ష త్ర శ్రీ కి స్త): in each script
 * conjuncts that the simple shaper draws as their consonants with a visible
 * virama, and a consonant with its i-matra, which the simple shaper puts
 * after the consonant (a pre-base vowel sign in Devanagari).
 */
const CLUSTERS: readonly { text: string; script: 'Devanagari' | 'Telugu'; reads: string }[] = [
  { text: 'क्ष', script: 'Devanagari', reads: 'ksha' },
  { text: 'त्र', script: 'Devanagari', reads: 'tra' },
  { text: 'ज्ञ', script: 'Devanagari', reads: 'jnya' },
  { text: 'श्र', script: 'Devanagari', reads: 'shra' },
  { text: 'कि', script: 'Devanagari', reads: 'ki' },
  { text: 'క్ష', script: 'Telugu', reads: 'ksha' },
  { text: 'త్ర', script: 'Telugu', reads: 'tra' },
  { text: 'శ్రీ', script: 'Telugu', reads: 'shri' },
  { text: 'కి', script: 'Telugu', reads: 'ki' },
  { text: 'స్త', script: 'Telugu', reads: 'sta' }
]

const LEVELS = ['complex', 'simple'] as const
type Level = (typeof LEVELS)[number]

/** 1080 wide, as the canvas half of M22 draws (§6.11, "The Indic render check"); a band, since a cluster is all there is. */
const W = 1080
const H = 360
/** The sheet: one row per script. */
const COLUMNS = 5
const ROWS = Math.ceil(CLUSTERS.length / COLUMNS)

/**
 * Event k is on screen from LEAD + k·STEP for EVENT ms, then a gap: 12 frames
 * drawn and 3 blank at 30 fps, so every event is a run of its own frames and
 * a dropped one leaves a hole, never a longer run.
 */
const LEAD_MS = 100
const STEP_MS = 500
const EVENT_MS = 400
const SECONDS = (LEAD_MS + CLUSTERS.length * STEP_MS + 100) / 1000

/**
 * The default caption style's face at its own size on a 1080×1920 export
 * (Pop: 84 at 1080 tall, so 149), with no outline or shadow, so the sheet
 * shows the glyphs bare. Anton has neither script, so every cluster comes
 * from the fallback the app's own burn would reach.
 */
const FONT = DEFAULT_CAPTION_STYLE.fontFamily
const FONT_SIZE = Math.round((DEFAULT_CAPTION_STYLE.fontSize * 1920) / REFERENCE_HEIGHT)

/** The hand-written .ass: one Dialogue per cluster, centred (\an5 by the style), white on the dark base. */
function clustersAss(): string {
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Indic,${FONT},${FONT_SIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...CLUSTERS.map((c, k) => {
      const start = LEAD_MS + k * STEP_MS
      return `Dialogue: 0,${toAssTime(start)},${toAssTime(start + EVENT_MS)},Indic,,0,0,0,,${c.text}`
    }),
    ''
  ].join('\n')
}

/** A pixel is ink when its luma is above this: the base (#202830) reads about 40, the white glyphs above 200. */
const INK_LUMA = 128
/** A frame shows an event when this many of its pixels are ink (a cluster at 149 px is thousands; H.264 noise on the flat base is none). */
const INK_PIXELS = 200
/** A pixel of two frames differs when a channel moves more than this (EFFECTS §51's rule for a caption's own pixels). */
const DIFFER_LEVELS = 40

/** The end of the plan's caption step, where the shaping level is swapped. */
const SHAPING_ANCHOR = ':shaping=complex[vsub]'

const pad = (n: number): string => String(n).padStart(2, '0')
const codePoints = (s: string): string => Array.from(s, (c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ')

/** Every frame of the file, in order (`-vsync passthrough`, so frame n is the plan's frame n), as luma. */
async function lumaFrames(file: string): Promise<Buffer[]> {
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-vsync', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }
  )
  const all = stdout as unknown as Buffer
  const size = W * H
  if (all.length === 0 || all.length % size !== 0) throw new Error(`${file}: ${all.length} bytes of luma is not a whole number of ${W}×${H} frames`)
  return Array.from({ length: all.length / size }, (_, i) => all.subarray(i * size, (i + 1) * size))
}

/** An image file's pixels, as RGB, and its size as ffmpeg decodes it. */
async function rgbOf(file: string, width: number, height: number): Promise<Buffer> {
  const { stdout } = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024
  })
  const rgb = stdout as unknown as Buffer
  if (rgb.length !== width * height * 3) throw new Error(`${file}: ${rgb.length} bytes, not ${width}×${height} RGB`)
  return rgb
}

const inkOf = (luma: Buffer): number => {
  let n = 0
  for (let i = 0; i < luma.length; i++) if (luma[i] > INK_LUMA) n++
  return n
}

/** The runs of consecutive frames that show an event: one per event on screen. */
function inkRuns(frames: Buffer[]): { first: number; last: number }[] {
  const runs: { first: number; last: number }[] = []
  frames.forEach((frame, n) => {
    if (inkOf(frame) < INK_PIXELS) return
    const open = runs.at(-1)
    if (open && open.last === n - 1) open.last = n
    else runs.push({ first: n, last: n })
  })
  return runs
}

/** Mean absolute difference over the frame (RGB, levels), and the pixels where a channel moves more than DIFFER_LEVELS. */
function difference(a: Buffer, b: Buffer): { mean: number; pixels: number } {
  let sum = 0
  let pixels = 0
  for (let p = 0; p < a.length; p += 3) {
    let moved = false
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[p + c] - b[p + c])
      sum += d
      if (d > DIFFER_LEVELS) moved = true
    }
    if (moved) pixels++
  }
  return { mean: sum / a.length, pixels }
}

/** Tile `index` of a sheet COLUMNS wide, cut out as its own W×H RGB frame. */
function tileOf(sheet: Buffer, index: number): Buffer {
  const col = index % COLUMNS
  const row = Math.floor(index / COLUMNS)
  const tile = Buffer.alloc(W * H * 3)
  for (let y = 0; y < H; y++) {
    const from = ((row * H + y) * COLUMNS * W + col * W) * 3
    sheet.copy(tile, y * W * 3, from, from + W * 3)
  }
  return tile
}

interface LevelResult {
  video: string
  /** Each run of frames showing an event, and the frame of it that was written. */
  runs: { first: number; last: number; frame: number }[]
  /** The per-event frames written, in order, and their pixels. */
  pngs: string[]
  rgb: Buffer[]
  sheet: string
}

describe('phase 0: the libass reference for M22 (docs/CLIPS.md §6.11, §6.15)', () => {
  let ref = ''
  let assPath = ''
  let fontsDir = ''
  const results = {} as Record<Level, LevelResult>

  beforeAll(async () => {
    ref = join(root, 'indic-libass')
    await mkdir(ref, { recursive: true })
    assPath = join(ref, 'clusters.ass')
    await writeFile(assPath, clustersAss(), 'utf8')
    // The fonts folder the app hands libass, as captions.int passes it: on CI it holds only the two committed Noto faces (D10).
    fontsDir = resolve(__dirname, '../../assets/fonts')

    const base = await makeColour(join(ref, 'base.mp4'), '0x202830', { width: W, height: H }, SECONDS, FPS)
    const frames = Math.round(SECONDS * FPS)
    const asset: MediaAsset = {
      id: 'base', path: base, name: 'base.mp4', kind: 'video', durationFrames: frames, width: W, height: H, fps: FPS, hasVideo: true, hasAudio: false, size: 1
    }
    const clip: Clip = {
      id: 'base', assetId: 'base', trackId: 'v1', start: 0, duration: frames, inPoint: 0, volume: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 }
    }
    const empty = emptyProject()
    const project: Project = { ...empty, settings: { ...empty.settings, width: W, height: H, fps: FPS }, assets: [asset], clips: [clip] }
    const canvas = { width: W, height: H }

    for (const level of LEVELS) {
      const video = join(ref, `${level}.mp4`)
      // The plan's own caption step (render/plan.ts: `[vmix]ass=filename=…:fontsdir=…:shaping=complex[vsub]`)…
      const plan = buildRenderPlan({ project, outputPath: video, canvas, subtitlesPath: assPath, fontsDir })
      const graphAt = plan.args.indexOf('-filter_complex') + 1
      if (graphAt === 0) throw new Error('the plan has no -filter_complex')
      const graph = plan.args[graphAt]
      // Counted, not trusted: one libass burn in the graph, and the anchor the swap replaces occurs once, in it.
      const burns = [...graph.matchAll(/\bass=filename=/g)].length
      const anchors = graph.split(SHAPING_ANCHOR).length - 1
      if (burns !== 1 || anchors !== 1) throw new Error(`the plan has ${burns} ass burns and ${anchors} "${SHAPING_ANCHOR}", not one each: ${graph}`)
      // …and the same step at the simple shaper, which `subtitles=` ran before EFFECTS §51.
      const args = level === 'complex' ? plan.args : plan.args.map((a, i) => (i === graphAt ? a.replace(SHAPING_ANCHOR, ':shaping=simple[vsub]') : a))
      if (plan.args.at(-1) !== video) throw new Error(`the plan's last argument is ${plan.args.at(-1)}, not its output`)
      await writeFile(join(ref, `${level}.graph.txt`), args.join(' ').replace(/;/g, ';\n'), 'utf8')
      await run(FFMPEG, args, { maxBuffer: 64 * 1024 * 1024 })

      // Every frame in order; each run of frames showing an event gives one frame, its middle, sampled at (f − 0.25)/fps.
      const runs = inkRuns(await lumaFrames(video)).map((r) => ({ ...r, frame: Math.floor((r.first + r.last) / 2) }))
      const dir = join(ref, level)
      await mkdir(dir, { recursive: true })
      const pngs: string[] = []
      for (const [i, r] of runs.entries()) {
        const png = join(dir, `${pad(i)}.png`)
        await saveFrame(video, (r.frame - 0.25) / FPS, png)
        pngs.push(png)
      }
      const rgb = await Promise.all(pngs.map((png) => rgbOf(png, W, H)))

      // The contact sheet, from this level's own frames: Devanagari on the first row, Telugu on the second.
      const sheet = join(ref, `${level}.png`)
      await run(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-y', '-framerate', '1', '-start_number', '0',
        '-i', join(dir, '%02d.png'), '-vf', `tile=${COLUMNS}x${ROWS}`, '-frames:v', '1', sheet
      ])
      results[level] = { video, runs, pngs, rgb, sheet }
    }
  }, 300_000)

  it('shows every event at each level, one run of frames each, and writes one frame per event', () => {
    for (const level of LEVELS) {
      const { runs, pngs } = results[level]
      expect(runs.length, `${level}: runs of frames showing an event (${JSON.stringify(runs)})`).toBe(CLUSTERS.length)
      expect(pngs.length, `${level}: frames written`).toBe(CLUSTERS.length)
    }
  })

  it('writes one contact sheet per level, made of that level’s own frames', async () => {
    for (const level of LEVELS) {
      const { sheet, rgb, pngs } = results[level]
      expect(existsSync(sheet), `${level}: ${sheet}`).toBe(true)
      expect((await readdir(join(ref, level))).filter((f) => f.endsWith('.png'))).toHaveLength(pngs.length)
      const pixels = await rgbOf(sheet, COLUMNS * W, ROWS * H)
      rgb.forEach((frame, i) => {
        const tile = difference(tileOf(pixels, i), frame)
        expect(tile, `${level}: tile ${i} of ${sheet} is not frame ${pngs[i]}`).toEqual({ mean: 0, pixels: 0 })
      })
    }
  })

  it('says per cluster whether complex and simple differ, and writes the README', async () => {
    const { complex, simple } = results
    const both = Math.min(complex.rgb.length, simple.rgb.length)
    const rows = CLUSTERS.map((c, i) => {
      const d = i < both ? difference(complex.rgb[i], simple.rgb[i]) : null
      const said = d === null ? 'no frame' : `${d.pixels > 0 ? 'DIFFER' : 'same'} (mean ${d.mean.toFixed(3)} levels over the frame, ${d.pixels} px past ${DIFFER_LEVELS})`
      return { c, i, said }
    })
    // Whether the named face is IN the folder, not only whether the folder is there: since D10 CI's
    // assets/fonts holds the two Noto faces alone, so "present" there says nothing of the face (as captionsFree.int's anton).
    const face = `${FONT.replace(/\s+/g, '')}-Regular.ttf`
    const where = `${process.platform}-${process.arch}, fonts dir ${existsSync(fontsDir) ? `present, ${face} ${existsSync(join(fontsDir, face)) ? 'in it' : 'NOT in it'}` : 'absent'}, face named ${FONT} at ${FONT_SIZE}`
    ciNotice(
      'graphic.int: libass Indic reference (M22)',
      [
        `${where}; events on screen: complex ${complex.runs.length}, simple ${simple.runs.length} of ${CLUSTERS.length}`,
        ...rows.map(({ c, i, said }) => `${pad(i)} ${c.text} (${c.script} ${c.reads}): complex against simple ${said}`)
      ].join('\n')
    )
    await writeNote(ref, [
      '# graphic: the libass reference for M22 (docs/CLIPS.md §6.11, §6.15)',
      '',
      'What the eye sets the canvas painter’s Indic frames beside (the harness’s `indic` option, run in the app’s renderer).',
      'The EFFECTS §51 clusters, one Dialogue each (clusters.ass, hand-written), burnt over a flat #202830 base through the',
      'render plan’s own caption step, `ass=filename=…:fontsdir=…:shaping=complex`, and again with only `shaping=simple` swapped in.',
      `${W}×${H} at ${FPS} fps; the default caption style’s face (${FONT}) at ${FONT_SIZE}, its size on a 1080×1920 export, white, no outline or shadow.`,
      `${FONT} has neither script, so every cluster is drawn by whatever fallback libass reaches here: ${where}.`,
      '',
      'complex.png — the contact sheet at shaping=complex: what an export of a Hindi or Telugu caption burns today.',
      '              Conjuncts joined, the i-matra before its consonant, when the libass here has HarfBuzz and a font for the script.',
      'simple.png  — the same at shaping=simple, the shaper `subtitles=` ran before EFFECTS §51: each conjunct as its consonants',
      '              with a visible virama, the i-matra after its consonant. Where it equals complex.png the check cannot see shaping here.',
      `Each sheet is ${COLUMNS} wide and ${ROWS} tall: Devanagari on the first row, Telugu on the second, in the order below.`,
      'complex/NN.png, simple/NN.png — the per-event frames each sheet was made from (the middle frame of the event’s run, taken at (f − 0.25)/fps).',
      'complex.mp4, simple.mp4 — the renders; *.graph.txt their filter graphs; base.mp4 the base.',
      '',
      'NN  cluster  script and reading  code points  frames shown (complex | simple)  complex against simple',
      ...rows.map(({ c, i, said }) => {
        const shown = (r: LevelResult): string => (r.runs[i] ? `${r.runs[i].first}-${r.runs[i].last}` : 'none')
        return `${pad(i)}  ${c.text}  ${c.script} ${c.reads}  ${codePoints(c.text)}  ${shown(complex)} | ${shown(simple)}  ${said}`
      })
    ])
  })
})

/* ------------------------------------------------- phase 1: M19's read */

/*
 * M19 (docs/CLIPS.md §6.15): how much of a thin stroke's colour survives the
 * plan's 4:2:0 overlay. The PNGs are the app's (the harness's `strokes`
 * option bakes them through `bakeGraphicSequence` and prints the folder); the
 * overlay and the read are here, through the bundled ffmpeg.
 *
 * The overlay is the render plan's own: `buildRenderPlan` over a flat colour
 * clip on V1 and the folder's sequence on V2 as the export's bake leaves a
 * graphic's asset (`frames: { pattern, count }`, the opacity exit's keys from
 * `graphicExitKeys`), its filter graph run as it is, only its outputs swapped
 * for the raw 4:2:0 frames: `format=yuva420p` on the sequence, the exit's
 * `geq` (a round trip through RGB), `overlay=…:format=yuv420`, then
 * `format=yuv420p`. The reference is the same PNG over the same frame with no
 * subsampling: `format=yuva444p`, `overlay=…:format=yuv444`, one swscale matrix
 * on both sides, so what differs is the 4:2:0 alone.
 *
 * Read along each line's centre line (`strokeLines`: per scan line across it,
 * the pixels nearest its alpha-weighted middle, 4 px clear of each end): the overlay's U
 * and V at each pixel (the 4:2:0 sample it is stored with) against the
 * reference's. The bar (M19, proposal) is 8 levels; this measures and prints,
 * it sets nothing: STROKE_MIN_PX is the user's to set from it. What is
 * asserted is that the read measured something: every PNG has lines, every
 * line a centre, and away from the lines the two sides agree, so the frames
 * compared are the same frame.
 */

/** The flat colours under the strokes: the render check's dark base, and the app's cream (#f2efe7). */
const M19_COLOURS: readonly { name: string; hex: string }[] = [
  { name: 'dark', hex: '0x202830' },
  { name: 'cream', hex: '0xf2efe7' }
]

/** Away from the lines, the two sides' U and V may differ by this much (rounding of one conversion against another); more, and they are not one frame. */
const BACKGROUND_LEVELS = 1
/** A 4:2:0 sample is background when no inked pixel lies within this many pixels of its 2×2 block (swscale's chroma filters reach a few pixels). */
const BACKGROUND_CLEAR = 8

/** A PNG's width and height, from its IHDR. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 24 || bytes.toString('latin1', 12, 16) !== 'IHDR') throw new Error('not a PNG')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/** An image's pixels as straight RGBA, as ffmpeg decodes them. */
async function rgbaOf(file: string, width: number, height: number): Promise<Buffer> {
  const { stdout } = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024
  })
  const rgba = stdout as unknown as Buffer
  if (rgba.length !== width * height * 4) throw new Error(`${file}: ${rgba.length} bytes, not ${width}×${height} RGBA`)
  return rgba
}

/** The flat colour as a lossless 4:2:0 clip (x264 at qp 0), so the base is exactly the colour on both sides. */
async function flatClip(file: string, hex: string, size: { width: number; height: number }, frames: number): Promise<void> {
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', `color=c=${hex}:size=${size.width}x${size.height}:rate=${FPS}:duration=${frames / FPS}`,
    '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', file
  ])
}

/** A project as the export hands the plan a baked graphic: the flat clip on V1, the sequence on V2 at the identity, with its exit's keys. */
function m19Project(base: string, pattern: string, count: number, size: { width: number; height: number }, duration: number): Project {
  const empty = emptyProject('m19')
  const flat: MediaAsset = { id: 'flat', path: base, name: 'flat.mp4', kind: 'video', durationFrames: duration, ...size, fps: FPS, hasVideo: true, hasAudio: false, size: 1 }
  const strokes: MediaAsset = {
    id: 'strokes', path: pattern.replace('%05d', '00000'), name: 'strokes — graphic', kind: 'image', durationFrames: duration, ...size,
    fps: null, hasVideo: true, hasAudio: false, size: 0, frames: { pattern, count }
  }
  const clip = (id: string, trackId: string, keyframes?: Clip['keyframes']): Clip => ({
    id, assetId: id, trackId, start: 0, duration, inPoint: 0, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 },
    ...(keyframes ? { keyframes } : {})
  })
  return {
    ...empty,
    settings: { ...empty.settings, ...size, fps: FPS },
    assets: [flat, strokes],
    clips: [clip('flat', 'v1'), clip('strokes', 'v2', graphicExitKeys(duration, FPS))]
  }
}

/**
 * The plan's arguments up to its filter graph, and the graph without its
 * audio source, its video's three steps each found once on the sequence's
 * input (`[1:v]`, the second input): the plan's own, not a copy that could
 * drift from it.
 */
function m19Graph(project: Project, size: { width: number; height: number }): { inputs: string[]; graph: string; steps: string[] } {
  const plan = buildRenderPlan({ project, outputPath: join(root, 'm19-unused.mp4'), canvas: size })
  const at = plan.args.indexOf('-filter_complex')
  if (at < 0) throw new Error('the plan has no -filter_complex')
  const segments = plan.args[at + 1].split(';')
  const audio = segments.filter((s) => s.startsWith('anullsrc'))
  const sequence = segments.filter((s) => s.startsWith('[1:v]'))
  const overlays = segments.filter((s) => /\[v1\]overlay=/.test(s))
  const out = segments.filter((s) => s === '[vmix]format=yuv420p[vout]')
  if (audio.length !== 1 || sequence.length !== 1 || overlays.length !== 1 || out.length !== 1) {
    throw new Error(`the plan's graph is not the shape M19 reads (audio ${audio.length}, sequence ${sequence.length}, overlay ${overlays.length}, out ${out.length}): ${plan.args[at + 1]}`)
  }
  const steps = [
    ...[...sequence[0].matchAll(/format=yuva420p/g)].map((m) => m[0]),
    ...[...sequence[0].matchAll(/geq=r=/g)].map((m) => m[0]),
    ...[...overlays[0].matchAll(/:format=yuv420:/g)].map((m) => m[0]),
    out[0]
  ]
  return { inputs: plan.args.slice(0, at), graph: segments.filter((s) => !s.startsWith('anullsrc')).join(';'), steps }
}

interface M19Line {
  png: string
  colour: string
  line: StrokeLine
  chroma: ChromaReading
}

describe('phase 1: the plan’s overlay of a graphic’s PNGs, as M19 reads it (docs/CLIPS.md §6.15)', () => {
  // Always: the read below runs the plan's own graph, so a plan that stops emitting these steps fails here, not silently there.
  it('emits format=yuva420p and the exit’s geq on the sequence, overlay format=yuv420, then format=yuv420p, once each', () => {
    const size = { width: 1080, height: 1920 }
    const { steps, inputs } = m19Graph(m19Project('/media/flat.mp4', '/cache/strokes.seq/%05d.png', 16, size, 40), size)
    expect(steps).toEqual(['format=yuva420p', 'geq=r=', ':format=yuv420:', '[vmix]format=yuv420p[vout]'])
    expect(inputs.join(' ')).toContain('-start_number 0 -framerate 30 -i /cache/strokes.seq/%05d.png')
  })
})

const m19Body = (): void => {
  const lines: M19Line[] = []
  const background: { colour: string; png: string; maxU: number; maxV: number; blocks: number }[] = []
  let pngs: string[] = []
  let distinct: { file: string; frame: number }[] = []
  let dir = ''
  let graphNote = ''

  beforeAll(async () => {
    dir = join(root, 'm19')
    await mkdir(dir, { recursive: true })
    pngs = (await readdir(STROKE_FRAMES)).filter((f) => /^\d{5}\.png$/.test(f)).sort()
    if (pngs.length === 0) return
    if (pngs[0] !== '00000.png' || pngs.at(-1) !== `${String(pngs.length - 1).padStart(5, '0')}.png`) {
      throw new Error(`${STROKE_FRAMES}: the PNGs are not one sequence numbered from 00000 (${pngs[0]} to ${pngs.at(-1)} of ${pngs.length})`)
    }
    const bytes = await Promise.all(pngs.map((f) => readFile(join(STROKE_FRAMES, f))))
    const size = pngSize(bytes[0])
    // The moving frames are often one picture (the strokes option's are): each picture is read once, at its first frame.
    distinct = []
    bytes.forEach((b, frame) => {
      if (!bytes.slice(0, frame).some((earlier) => earlier.equals(b))) distinct.push({ file: pngs[frame], frame })
    })
    const pattern = join(STROKE_FRAMES, '%05d.png')
    // The moving frames, half a second held, then the exit: every frame read is before the exit's first key.
    const duration = pngs.length + Math.round(FPS / 2) + Math.round(EXIT_S * FPS)

    for (const colour of M19_COLOURS) {
      const base = join(dir, `${colour.name}.mp4`)
      await flatClip(base, colour.hex, size, duration)
      const { inputs, graph } = m19Graph(m19Project(base, pattern, pngs.length, size, duration), size)
      graphNote = graph.replace(base, '<flat clip>').replace(/;/g, ';\n')
      const { stdout } = await run(FFMPEG, [...inputs, '-filter_complex', graph, '-map', '[vout]', '-frames:v', String(pngs.length), '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'], {
        encoding: 'buffer',
        maxBuffer: 512 * 1024 * 1024
      })
      const all = stdout as unknown as Buffer
      const luma = size.width * size.height
      const half = Math.ceil(size.width / 2) * Math.ceil(size.height / 2)
      const frameBytes = luma + 2 * half
      if (all.length !== frameBytes * pngs.length) throw new Error(`${colour.name}: ${all.length} bytes of 4:2:0 is not ${pngs.length} frames of ${size.width}×${size.height}`)

      for (const { file, frame } of distinct) {
        const png = join(STROKE_FRAMES, file)
        const at = frame * frameBytes
        const measured = { u: all.subarray(at + luma, at + luma + half), v: all.subarray(at + luma + half, at + frameBytes) }
        const { stdout: ref } = await run(FFMPEG, [
          '-hide_banner', '-loglevel', 'error', '-i', base, '-i', png, '-filter_complex',
          "[0:v]format=yuv444p[b];[1:v]format=yuva444p[g];[b][g]overlay=x='0':y='0':format=yuv444,format=yuv444p[out]",
          '-map', '[out]', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'yuv444p', 'pipe:1'
        ], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })
        const full = ref as unknown as Buffer
        if (full.length !== luma * 3) throw new Error(`${colour.name} reference: ${full.length} bytes, not ${size.width}×${size.height} 4:4:4`)
        const reference = { u: full.subarray(luma, 2 * luma), v: full.subarray(2 * luma, 3 * luma) }

        const rgba = await rgbaOf(png, size.width, size.height)
        for (const line of strokeLines(rgba, size.width, size.height)) {
          lines.push({ png: file, colour: colour.name, line, chroma: chromaAlong(line.centre, reference, measured, size.width) })
        }

        // Background: every 4:2:0 sample with no ink within BACKGROUND_CLEAR px of its block, by a summed-area table of the ink.
        const W = size.width
        const H = size.height
        const sat = new Int32Array((W + 1) * (H + 1))
        for (let y = 0; y < H; y++) {
          let row = 0
          for (let x = 0; x < W; x++) {
            row += rgba[(y * W + x) * 4 + 3] > 0 ? 1 : 0
            sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + row
          }
        }
        const inkIn = (x0: number, y0: number, x1: number, y1: number): number => {
          const a = Math.max(0, x0)
          const b = Math.max(0, y0)
          const c = Math.min(W, x1)
          const d = Math.min(H, y1)
          return sat[d * (W + 1) + c] - sat[b * (W + 1) + c] - sat[d * (W + 1) + a] + sat[b * (W + 1) + a]
        }
        let maxU = 0
        let maxV = 0
        let blocks = 0
        const cw = Math.ceil(W / 2)
        for (let by = 0; by < Math.ceil(H / 2); by++) {
          for (let bx = 0; bx < cw; bx++) {
            const x = 2 * bx
            const y = 2 * by
            if (inkIn(x - BACKGROUND_CLEAR, y - BACKGROUND_CLEAR, x + 2 + BACKGROUND_CLEAR, y + 2 + BACKGROUND_CLEAR) > 0) continue
            blocks++
            for (const [px, py] of [[x, y], [Math.min(W - 1, x + 1), Math.min(H - 1, y + 1)]]) {
              maxU = Math.max(maxU, Math.abs(reference.u[py * W + px] - measured.u[by * cw + bx]))
              maxV = Math.max(maxV, Math.abs(reference.v[py * W + px] - measured.v[by * cw + bx]))
            }
          }
        }
        background.push({ colour: colour.name, png: file, maxU, maxV, blocks })

        // The overlay's frame, to look at.
        const raw = join(dir, `${colour.name}-${file}.yuv`)
        await writeFile(raw, all.subarray(at, at + frameBytes))
        await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${size.width}x${size.height}`, '-i', raw, join(dir, `${colour.name}-${file}`)])
      }
    }
  }, 600_000)

  it('reads every line of every picture over each colour, with a centre line, the two sides agreeing away from the lines', async () => {
    expect(pngs.length, `no 00000.png… sequence in FORGE_GRAPHIC_FRAMES=${STROKE_FRAMES}`).toBeGreaterThan(0)
    for (const colour of M19_COLOURS) {
      for (const { file } of distinct) {
        const here = lines.filter((l) => l.colour === colour.name && l.png === file)
        expect(here.length, `${colour.name} ${file}: lines found`).toBeGreaterThan(0)
        for (const l of here) expect(l.chroma.pixels, `${colour.name} ${file}: a line at ${JSON.stringify(l.line.box)} has no centre`).toBeGreaterThan(0)
      }
    }
    for (const b of background) {
      expect(b.blocks, `${b.colour} ${b.png}: no background sample`).toBeGreaterThan(0)
      expect(Math.max(b.maxU, b.maxV), `${b.colour} ${b.png}: U and V away from the lines`).toBeLessThanOrEqual(BACKGROUND_LEVELS)
    }

    // Per width, read from the picture: lines whose widths round to one tenth are one width.
    const key = (l: M19Line): string => l.line.width.toFixed(1)
    const widths = [...new Set(lines.map(key))].sort((a, b) => Number(a) - Number(b))
    const verdicts = widths.map((w) => {
      const of = lines.filter((l) => key(l) === w)
      const maxU = Math.max(...of.map((l) => l.chroma.maxU))
      const maxV = Math.max(...of.map((l) => l.chroma.maxV))
      return { w, of, maxU, maxV, within: of.every((l) => l.chroma.within) }
    })
    const smallest = verdicts.find((v) => v.within)?.w ?? 'none'
    const rows = lines.map((l) => {
      const orientation = Math.abs(l.line.slope) < 0.01 ? 'horizontal' : `slope ${l.line.slope.toFixed(3)}`
      return (
        `${l.png}  ${l.colour}  ${l.line.width.toFixed(3)} px  ${orientation}  at ${l.line.box.x},${l.line.box.y} ${l.line.box.width}x${l.line.box.height}  ` +
        `${l.chroma.pixels} centre px  U max ${l.chroma.maxU} mean ${l.chroma.meanU.toFixed(2)}  V max ${l.chroma.maxV} mean ${l.chroma.meanV.toFixed(2)}  ${l.chroma.within ? 'within' : 'OVER'} ${M19_BAR.chromaLevels}`
      )
    })
    const said = verdicts.map((v) => `${v.w} px: U max ${v.maxU}, V max ${v.maxV} over ${v.of.length} lines, ${v.within ? 'within' : 'OVER'} ${M19_BAR.chromaLevels}`).join('; ')
    process.stderr.write(
      `graphic.int M19 (${process.platform}-${process.arch}, ${FFMPEG}): ${pngs.length} PNGs, ${distinct.length} distinct, from ${STROKE_FRAMES}; ${said}; ` +
        `the smallest width within the bar: ${smallest}; background U/V ${background.map((b) => `${b.colour} ${Math.max(b.maxU, b.maxV)}`).join(', ')}\n`
    )
    await writeFile(join(dir, 'graph.txt'), `${graphNote}\n`, 'utf8')
    await writeNote(dir, [
      '# graphic: M19, a stroke\'s chroma through the plan\'s 4:2:0 overlay (docs/CLIPS.md §6.15)',
      '',
      `${pngs.length} PNGs from FORGE_GRAPHIC_FRAMES=${STROKE_FRAMES} (${distinct.length} distinct, each read at its first frame), ${process.platform}-${process.arch}, ${new Date().toISOString()}.`,
      'Each overlaid by the render plan\'s own graph (graph.txt: format=yuva420p, the exit\'s geq, overlay format=yuv420, format=yuv420p) on a lossless',
      'flat clip, and again with no subsampling (format=yuva444p, overlay format=yuv444) as the reference. Along each line\'s centre line, the overlay\'s',
      `U and V (the 4:2:0 sample each pixel is stored with) against the reference's; the bar is ${M19_BAR.chromaLevels} levels (M19, proposal). STROKE_MIN_PX is yours to set.`,
      '',
      `Per width: ${said}.`,
      `The smallest width within the bar: ${smallest}.`,
      `Away from the lines (no ink within ${BACKGROUND_CLEAR} px of a sample): ${background.map((b) => `${b.colour} ${b.png} U ${b.maxU} V ${b.maxV} over ${b.blocks} samples`).join('; ')}.`,
      '',
      '<colour>-<png> — the overlay\'s frame, to look at; <colour>.mp4 the flat clip.',
      '',
      'png  colour  width  slope  box  centre  U  V',
      ...rows
    ])
  })
}

if (STROKE_FRAMES === '') {
  process.stderr.write('graphic.int M19: skipped, FORGE_GRAPHIC_FRAMES is not set (the folder the harness\'s strokes option prints; docs/CLIPS.md §6.15)\n')
  describe.skip('phase 1: M19, a stroke’s chroma through the plan’s overlay — skipped: FORGE_GRAPHIC_FRAMES is not set (a folder of a graphic’s PNGs)', m19Body)
} else {
  describe('phase 1: M19, a stroke’s chroma through the plan’s overlay (docs/CLIPS.md §6.15)', m19Body)
}
