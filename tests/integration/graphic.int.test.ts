import { beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { buildRenderPlan } from '@shared/render/plan'
import { bakeForExport, exportKey, type Bakers } from '@shared/render/exportBake'
import { DEFAULT_CAPTION_STYLE } from '@shared/captions/style'
import { REFERENCE_HEIGHT, toAssTime } from '@shared/captions/ass'
import { EXIT_S, beatFrame, drawnGraphicAsset, graphicExitKeys, graphicMovingFrames } from '@shared/graphics/frame'
import { graphicBox } from '@shared/graphics/drawList'
import { CLEAN_GRAPHIC_STYLE } from '@shared/graphics/style'
import type { Drawer, Rect, TextMeasure } from '@shared/graphics/items'
import type { GraphicSpec } from '@shared/graphics/template'
import { M19_BAR, chromaAlong, strokeBandIndex, strokeLines, type ChromaReading, type StrokeLine } from '../../src/renderer/src/harness/graphicMeasure'
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

/** Whether `child` is `parent` or inside it; ignoring case on macOS and Windows, whose file systems do, so `Tests/Output/graphic` is caught too. */
const within = (parent: string, child: string): boolean => {
  const fold = process.platform === 'darwin' || process.platform === 'win32' ? (p: string): string => p.toLowerCase() : (p: string): string => p
  const r = relative(fold(parent), fold(child))
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

/** Every frame of the file, in order (`-vsync passthrough`, so frame n is the plan's frame n), as luma (`gray`) or RGB (`rgb24`); phase 0's band unless a size is given. */
async function lumaFrames(file: string, size: { width: number; height: number } = { width: W, height: H }, pixFmt: 'gray' | 'rgb24' = 'gray'): Promise<Buffer[]> {
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-vsync', 'passthrough', '-f', 'rawvideo', '-pix_fmt', pixFmt, 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 }
  )
  const all = stdout as unknown as Buffer
  const bytes = size.width * size.height * (pixFmt === 'gray' ? 1 : 3)
  if (all.length === 0 || all.length % bytes !== 0) throw new Error(`${file}: ${all.length} bytes of ${pixFmt} is not a whole number of ${size.width}×${size.height} frames`)
  return Array.from({ length: all.length / bytes }, (_, i) => all.subarray(i * bytes, (i + 1) * bytes))
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

/* ------------------------------------------------- phase 1: the render check */

/*
 * Phase 1's render check (docs/CLIPS.md §6.11, "The render check", phase 1;
 * §6.3): a graphic clip through the export's own path, `bakeForExport` →
 * `buildRenderPlan` → the bundled ffmpeg, with a fake `Bakers.graphic` in the
 * app's place, as moment.int fakes the moment's drawer (moment.int.test.ts
 * :52-72). The fake keeps the bake's contract and draws nothing of a
 * template's: for moving frame i (`graphicMovingFrames`, so the hold is the
 * render's `tpad`, never baked) it fills the spec's place rect, scaled to the
 * export's size, with grey 20 + 15·(i mod 12), white on an arrival frame
 * (`beatFrame` of a beat), transparent outside. Greys 15 apart, so a frame
 * off by one reads as another grey; mod 12, so a frame names itself.
 *
 * Its box route is the app's (graphicCanvas.ts `bakeGraphicSequence`, with
 * `GRAPHIC_BAKE_REGION` 'box' since M1, 2026-10-27): when the export allows
 * it (`boxAllowed`, `identityPlaced`) the frames are cut to the box
 * `graphicBox` gives a list whose one item is the place rect, and the box is
 * returned for the asset's `frames.box`. The plan's §6.11 says the fake needs
 * no `graphicBox`; it is called here all the same, for its box only (the fake
 * paints no list), so the box the plan overlays is the production one and
 * "(box) an odd x" is a mutation of production code, not of this file. Its
 * canvas route is the same frames at the canvas, no box: the region the
 * app's bake takes when `GRAPHIC_BAKE_REGION` is 'canvas', chosen here by the
 * fake rather than by un-placing the clip (a transition or a mask), which
 * would change the plan's graph for reasons of its own and could not be
 * framemd5-equal for this one's.
 *
 * The spec's box has every edge on an odd pixel at both shapes, so
 * `graphicBox` snaps each side outward and the box route's PNGs carry a
 * transparent margin on all four (one pixel on the left and top, three on
 * the right and at the bottom, where the box keeps two more for the exit
 * geq's copy): the case where the box and the frame's 4:2:0 blocks do not
 * coincide with the ink.
 */

const P1_SHOT = { width: 360, height: 640 }
const P1_SHAPES = { portrait: { width: 360, height: 640 }, landscape: { width: 640, height: 360 } } as const
type P1Shape = keyof typeof P1_SHAPES
const P1_SHAPE_NAMES = Object.keys(P1_SHAPES) as P1Shape[]
/** The red shot, 3.5 s; the graphic from half a second in, for its two seconds: a second of red after it. */
const P1_SHOT_FRAMES = 105
const P1_START = 15
/** In units of the frame. Every edge lands on an odd pixel at 360×640 and at 640×360 (P1_PLACE_PX). */
const P1_PLACE = { x: 0.1985, y: 0.3015, width: 0.5, height: 0.25 }
const P1_SPEC: GraphicSpec = {
  data: { template: 'counter', value: '3', label: 'render check' },
  seconds: 2,
  beats: [0.5, 1.0],
  place: { auto: false, box: P1_PLACE },
  seed: 1,
  version: 1
}
const P1_FRAMES = Math.round(P1_SPEC.seconds * FPS)

/* Hand-derived, so a change to the code they come from fails against them rather than moving the test with it. */
/** The place rect in pixels: round(unit × side) for each edge. */
const P1_PLACE_PX: Record<P1Shape, Rect> = {
  portrait: { x: 71, y: 193, width: 180, height: 160 },
  landscape: { x: 127, y: 109, width: 320, height: 90 }
}
/** `graphicBox` of it: snapped outward to even on every side, then two more columns on the right and rows at the bottom (the exit geq's w − 2 / h − 2). */
const P1_BOX_PX: Record<P1Shape, Rect> = {
  portrait: { x: 70, y: 192, width: 184, height: 164 },
  landscape: { x: 126, y: 108, width: 324, height: 94 }
}
/** `beatFrame(1.0 + SETTLE_S) + 1` at 30 fps: frames 0..45 drawn, 45 the first settled one. */
const P1_MOVING = 46
/** The beats' frames: 0.5 s and 1.0 s at 30 fps. */
const P1_ARRIVALS = [15, 30]
/** The exit's first key (opacity 1), `P1_FRAMES − round(EXIT_S × 30)`; its last (0) on the clip's last frame. */
const P1_EXIT = 51

/** A pixel matches within 5 levels per channel (`toBeLessThan(6)`), as moment.int reads H.264. */
const P1_LEVELS = 6
/**
 * Pixels within this many of an edge (the place rect's, or the shot's where
 * 16:9 pillarboxes it) are left out of the inside and outside readings: H.264
 * at the plan's CRF 20 smears a sharp edge across its transform blocks.
 * Measured on the Mac's 4.4 build (2026-11-03), the worst inside reading of
 * the 9:16 box export against each frame's grey, by margin: 8 levels at 8 px,
 * 5 from 9 to 14, 3 at 16, 2 at 18; at 16:9, 2 from 9. Outside, against the
 * shot's own export, 14 at 7 px and 3 at 8. 10 left the 9:16 reading at 5 of
 * the 5 allowed, and a change that leaves the box's inside alone but moves
 * x264's choices (the boxAllowed-false and geq-interpolation probes) read 6
 * and failed. So 16: 3 levels of headroom on the 5. The edges themselves are
 * read in luma (P1_EDGE_PX), so the wider margin loses no placement check.
 */
const P1_MARGIN = 16
/**
 * Where the red shot shows in the export: the whole 9:16 frame; at 16:9 the
 * plan's contain fit, 202 wide (360 × 360/640, even) from x 218, black
 * either side (read off the base export, 2026-11-03).
 */
const P1_SHOT_RECT: Record<P1Shape, Rect> = {
  portrait: { x: 0, y: 0, width: 360, height: 640 },
  landscape: { x: 218, y: 0, width: 202, height: 360 }
}
/** The grey's first and last columns and rows within this many pixels of the place rect's edges, in luma. */
const P1_EDGE_PX = 1
/** An edge is read on a frame only where the two sides' luma differ by this much (a grey near the base's luma has no edge to find). */
const P1_EDGE_CONTRAST = 40

const p1Grey = (i: number): number => 20 + 15 * (i % 12)

/** The spec's place rect in pixels of `size`. Phase 1's spec is placed by hand; `auto` is phase 2's layout. */
function placeRect(spec: GraphicSpec, size: { width: number; height: number }): Rect {
  if (spec.place.auto) throw new Error('the phase 1 fake draws a placed box only')
  const b = spec.place.box
  const x0 = Math.round(b.x * size.width)
  const y0 = Math.round(b.y * size.height)
  return { x: x0, y: y0, width: Math.round((b.x + b.width) * size.width) - x0, height: Math.round((b.y + b.height) * size.height) - y0 }
}

/** The place rect as one shape item: what `graphicBox` reads for the box route's box (its bounds only; nothing paints it). */
const placeDrawer: Drawer = (spec, _style, _clock, size) => ({
  items: [{ kind: 'shape', id: 'place', opacity: 1, shape: 'rect', box: placeRect(spec, size), fill: '#ffffff' }]
})
const NO_TEXT: TextMeasure = () => ({ width: 0, ascent: 0, descent: 0 })

/** An RGBA PNG by hand, filter 0 on every row: nothing between the fake and the file decides what is in it. */
function rgbaPng(width: number, height: number, rgba: Buffer): Buffer {
  const row = 1 + width * 4
  const raw = Buffer.alloc(row * height)
  for (let y = 0; y < height; y++) rgba.copy(raw, y * row + 1, y * width * 4, (y + 1) * width * 4)
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

type P1Route = 'box' | 'canvas' | 'null'

/** What the export asked the fake for, and what it wrote. */
interface P1Ask {
  key: string
  width: number
  height: number
  frames: number
  fps: number
  boxAllowed: boolean
  box: Rect | null
  seq: string
}

function p1Bakers(route: P1Route, dir: string, asks: P1Ask[]): Bakers {
  const none = (what: string) => async (): Promise<never> => {
    throw new Error(`the phase 1 project has no ${what}`)
  }
  return {
    moment: none('moment'),
    text: none('text'),
    textSequence: async () => null,
    solid: none('colour card'),
    title: none('title'),
    paper: none('paper'),
    carousel: none('carousel'),
    graphic: async (spec, style, key, width, height, frames, fps, targetsAt, boxAllowed) => {
      const ask: P1Ask = { key, width, height, frames, fps, boxAllowed, box: null, seq: '' }
      asks.push(ask)
      // A bake that could not draw: the export must drop the clip, never read the edit's empty asset.
      if (route === 'null') return null
      const size = { width, height }
      const moving = graphicMovingFrames(spec, style, fps, frames)
      const box = route === 'box' && boxAllowed ? graphicBox(spec, style, fps, frames, size, NO_TEXT, targetsAt, placeDrawer) : null
      if (route === 'box' && boxAllowed && !box) return null
      const region = box ?? { x: 0, y: 0, width, height }
      const place = placeRect(spec, size)
      const arrivals = new Set(spec.beats.map((b) => beatFrame(b, fps)))
      const seq = join(dir, `${key}.seq`)
      await mkdir(seq, { recursive: true })
      for (let i = 0; i < moving; i++) {
        const level = arrivals.has(i) ? 255 : p1Grey(i)
        const rgba = Buffer.alloc(region.width * region.height * 4)
        for (let y = Math.max(place.y, region.y); y < Math.min(place.y + place.height, region.y + region.height); y++) {
          for (let x = Math.max(place.x, region.x); x < Math.min(place.x + place.width, region.x + region.width); x++) {
            const at = ((y - region.y) * region.width + (x - region.x)) * 4
            rgba[at] = level
            rgba[at + 1] = level
            rgba[at + 2] = level
            rgba[at + 3] = 255
          }
        }
        await writeFile(join(seq, `${String(i).padStart(5, '0')}.png`), rgbaPng(region.width, region.height, rgba))
      }
      ask.box = box
      ask.seq = seq
      const pattern = join(seq, '%05d.png')
      return box ? { pattern, frames: moving, box } : { pattern, frames: moving }
    }
  }
}

/** The red shot on V1; with `graphic`, the graphic clip on V2 as the store adds one (the drawn asset, empty; the exit's keys). */
function p1Project(shot: string, graphic: boolean): Project {
  const empty = emptyProject('graphic-phase-1')
  const red: MediaAsset = {
    id: 'red', path: shot, name: 'red.mp4', kind: 'video', durationFrames: P1_SHOT_FRAMES, ...P1_SHOT, fps: FPS, hasVideo: true, hasAudio: false, size: 1
  }
  const drawn = drawnGraphicAsset('g', P1_SHOT.width, P1_SHOT.height, Math.max(P1_FRAMES, FPS * 10), 'counter — graphic')
  const clip = (over: Partial<Clip> & Pick<Clip, 'id' | 'assetId' | 'trackId' | 'start' | 'duration'>): Clip => ({
    inPoint: 0, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 }, ...over
  })
  return {
    ...empty,
    settings: { ...empty.settings, ...P1_SHOT, fps: FPS },
    captions: { enabled: false, styleId: empty.captions.styleId },
    assets: graphic ? [red, drawn] : [red],
    clips: [
      clip({ id: 'red', assetId: 'red', trackId: 'v1', start: 0, duration: P1_SHOT_FRAMES }),
      ...(graphic
        ? [clip({ id: 'g', assetId: drawn.id, trackId: 'v2', start: P1_START, duration: P1_FRAMES, graphic: P1_SPEC, keyframes: graphicExitKeys(P1_FRAMES, FPS) })]
        : [])
    ]
  }
}

interface P1Export {
  file: string
  /** The plan's argv, as the export ran it. */
  args: string[]
  asks: P1Ask[]
  /** What `onError` heard, as "<clip>: <message>". */
  notes: string[]
  baked: Project
  /** PNGs in the fake's sequence folder. */
  pngs: number
}

/** One export of `project` at `shape`, the fake on `route`, into `<dir>/<name>/`. */
async function p1Export(dir: string, name: string, project: Project, shape: P1Shape, route: P1Route): Promise<P1Export> {
  const out = join(dir, name)
  await mkdir(out, { recursive: true })
  const asks: P1Ask[] = []
  const notes: string[] = []
  const canvas = P1_SHAPES[shape]
  const baked = await bakeForExport(project, canvas, p1Bakers(route, out, asks), (clip, err) => {
    notes.push(`${clip.id}: ${err instanceof Error ? err.message : String(err)}`)
  })
  const file = join(out, 'export.mp4')
  const plan = buildRenderPlan({ project: baked, outputPath: file, canvas })
  await writeFile(join(out, 'graph.txt'), plan.args.join(' ').replace(/;/g, ';\n'), 'utf8')
  await run(FFMPEG, plan.args, { maxBuffer: 64 * 1024 * 1024 })
  const pngs = asks[0]?.seq ? (await readdir(asks[0].seq)).filter((f) => /^\d{5}\.png$/.test(f)).length : 0
  return { file, args: plan.args, asks, notes, baked, pngs }
}

/**
 * The plan's own filtered frames, before the encoder, as yuv420p: its argv up
 * to the outputs, then `[vout]` to raw video and `[aout]` to nowhere (the
 * graph's anullsrc must be consumed, and bounded). The encoder is left out
 * because one frame's difference moves x264's decisions on its neighbours:
 * two routes that differ by a column differ in the export's framemd5 frames
 * before it (measured: frame 14, the frame before the clip).
 */
async function planFrames(args: string[], size: { width: number; height: number }): Promise<Buffer[]> {
  const maps = args.flatMap((a, i) => (a === '-map' ? [i] : []))
  if (maps.length !== 2 || args[maps[0] + 1] !== '[vout]' || args[maps[1] + 1] !== '[aout]') throw new Error(`the plan's outputs are not [vout] and [aout]: ${args.join(' ')}`)
  const { stdout } = await run(
    FFMPEG,
    [
      ...args.slice(0, maps[0]),
      '-map', '[vout]', '-vsync', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1',
      '-map', '[aout]', '-t', String(P1_SHOT_FRAMES / FPS), '-f', 'null', '-'
    ],
    { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 }
  )
  const all = stdout as unknown as Buffer
  const bytes = size.width * size.height * 1.5
  if (all.length === 0 || all.length % bytes !== 0) throw new Error(`${all.length} bytes of yuv420p is not a whole number of ${size.width}×${size.height} frames`)
  return Array.from({ length: all.length / bytes }, (_, i) => all.subarray(i * bytes, (i + 1) * bytes))
}

/** Where two yuv420p frames differ: each differing sample as frame pixels (a chroma sample as the 2×2 it covers), by plane. */
function differingPixels(a: Buffer, b: Buffer, size: { width: number; height: number }): { plane: 'Y' | 'U' | 'V'; x: number; y: number }[] {
  const out: { plane: 'Y' | 'U' | 'V'; x: number; y: number }[] = []
  const luma = size.width * size.height
  const cw = size.width / 2
  for (let k = 0; k < a.length; k++) {
    if (a[k] === b[k]) continue
    if (k < luma) out.push({ plane: 'Y', x: k % size.width, y: Math.floor(k / size.width) })
    else {
      const c = (k - luma) % (luma / 4)
      out.push({ plane: k < luma * 1.25 ? 'U' : 'V', x: 2 * (c % cw), y: 2 * Math.floor(c / cw) })
    }
  }
  return out
}

/** The file's video as framemd5 lines, the header's comments left out. */
async function framemd5(file: string): Promise<string[]> {
  const { stdout } = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-vsync', 'passthrough', '-f', 'framemd5', 'pipe:1'], {
    maxBuffer: 64 * 1024 * 1024
  })
  return String(stdout).split(/\r?\n/).filter((l) => l !== '' && !l.startsWith('#'))
}

const pixelOf = (frame: Buffer, width: number, x: number, y: number): [number, number, number] => {
  const at = (y * width + x) * 3
  return [frame[at], frame[at + 1], frame[at + 2]]
}
const furthest = (px: readonly number[], want: readonly number[]): number => Math.max(...px.map((c, k) => Math.abs(c - want[k])))
const RED = [255, 0, 0] as const

const BLACK = [0, 0, 0] as const

/** Whether (x, y) is at least `m` pixels inside `r` (m 0: inside it). */
const deepIn = (r: Rect, x: number, y: number, m: number): boolean => x >= r.x + m && x < r.x + r.width - m && y >= r.y + m && y < r.y + r.height - m
/** Whether (x, y) is at least `m` pixels clear of `r`. */
const clearOf = (r: Rect, x: number, y: number, m: number): boolean => x < r.x - m || x >= r.x + r.width + m || y < r.y - m || y >= r.y + r.height + m

/**
 * Per pixel of a shape's frame, what the readings make of it: `inside` the
 * place rect by P1_MARGIN or `outside` it by P1_MARGIN (else neither), and
 * what the base shows there, red or black, when it is P1_MARGIN from the
 * shot's edge (else null: the pillarbox's edge is H.264's to smear).
 */
interface PixelZones {
  inside: Uint8Array
  outside: Uint8Array
  under: (typeof RED | typeof BLACK | null)[]
}
function zonesOf(shape: P1Shape): PixelZones {
  const size = P1_SHAPES[shape]
  const place = P1_PLACE_PX[shape]
  const shot = P1_SHOT_RECT[shape]
  const n = size.width * size.height
  const zones: PixelZones = { inside: new Uint8Array(n), outside: new Uint8Array(n), under: new Array(n).fill(null) }
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const k = y * size.width + x
      zones.inside[k] = deepIn(place, x, y, P1_MARGIN) ? 1 : 0
      zones.outside[k] = clearOf(place, x, y, P1_MARGIN) ? 1 : 0
      zones.under[k] = deepIn(shot, x, y, P1_MARGIN) ? RED : clearOf(shot, x, y, P1_MARGIN) ? BLACK : null
    }
  }
  return zones
}

/**
 * One frame's reading: the largest channel distance from `want` over the
 * inside pixels (from the base's colour when `want` is null), and from the
 * base's colour over the outside ones; and the mean distance from the base's
 * colour over the inside, which the exit's fall drives to 0.
 */
function regionReading(frame: Buffer, zones: PixelZones, want: number | null): { inside: number; outside: number; insideMean: number } {
  let worstIn = 0
  let worstOut = 0
  let sumIn = 0
  let nIn = 0
  for (let k = 0; k < zones.inside.length; k++) {
    const under = zones.under[k]
    const at = k * 3
    if (zones.inside[k]) {
      for (let c = 0; c < 3; c++) {
        if (want !== null) worstIn = Math.max(worstIn, Math.abs(frame[at + c] - want))
        else if (under) worstIn = Math.max(worstIn, Math.abs(frame[at + c] - under[c]))
        if (under) {
          sumIn += Math.abs(frame[at + c] - under[c])
          nIn++
        }
      }
    } else if (zones.outside[k] && under) {
      for (let c = 0; c < 3; c++) worstOut = Math.max(worstOut, Math.abs(frame[at + c] - under[c]))
    }
  }
  return { inside: worstIn, outside: worstOut, insideMean: sumIn / Math.max(1, nIn) }
}

type EdgeName = 'left' | 'right' | 'top' | 'bottom'
/**
 * The grey's edges on one frame, in luma, along the place rect's middle row
 * and middle column: each the first pixel, coming from outside, past the
 * midpoint of the two sides' luma (read P1_MARGIN + 2 px either side of the
 * edge). An edge whose two sides differ by less than P1_EDGE_CONTRAST is not
 * read (null).
 */
function edgesOf(luma: Buffer, size: { width: number; height: number }, place: Rect): Record<EdgeName, number | null> {
  const at = (x: number, y: number): number => luma[y * size.width + x]
  const off = P1_MARGIN + 2
  const row = place.y + Math.floor(place.height / 2)
  const col = place.x + Math.floor(place.width / 2)
  /** Walking `from` towards `to` (inside), the first index whose luma is on the inside's side of the midpoint. */
  const cross = (read: (k: number) => number, from: number, to: number): number | null => {
    const outside = read(from)
    const inside = read(to)
    if (Math.abs(inside - outside) < P1_EDGE_CONTRAST) return null
    const mid = (inside + outside) / 2
    const step = to > from ? 1 : -1
    for (let k = from; k !== to + step; k += step) if ((read(k) - mid) * (inside - outside) > 0) return k
    return null
  }
  return {
    left: cross((x) => at(x, row), place.x - off, place.x + off),
    right: cross((x) => at(x, row), place.x + place.width - 1 + off, place.x + place.width - 1 - off),
    top: cross((y) => at(col, y), place.y - off, place.y + off),
    bottom: cross((y) => at(col, y), place.y + place.height - 1 + off, place.y + place.height - 1 - off)
  }
}

/** Where each edge should be read: the place rect's first and last column and row. */
const edgeWant = (place: Rect): Record<EdgeName, number> => ({
  left: place.x,
  right: place.x + place.width - 1,
  top: place.y,
  bottom: place.y + place.height - 1
})

/** The frames saved to look at, each taken at (f − 0.25)/fps: before, the first, each arrival and the frame before it, the last moving, a held one, mid-exit, the clip's last, and after. */
const P1_SAVED = [P1_START - 1, P1_START, ...P1_ARRIVALS.flatMap((a) => [P1_START + a - 1, P1_START + a]), P1_START + P1_MOVING - 1, P1_START + P1_MOVING + 2, P1_START + 55, P1_START + P1_FRAMES - 1, P1_START + P1_FRAMES]

describe('phase 1: a graphic through bakeForExport, the plan and the bundled ffmpeg (docs/CLIPS.md §6.11, §6.3)', () => {
  let dir = ''
  const base = {} as Record<P1Shape, P1Export>
  const boxed = {} as Record<P1Shape, P1Export>
  const canvased = {} as Record<P1Shape, P1Export>
  const zones = {} as Record<P1Shape, PixelZones>
  const rgb = {} as Record<P1Shape, Buffer[]>
  const canvasRgb = {} as Record<P1Shape, Buffer[]>
  const baseRgb = {} as Record<P1Shape, Buffer[]>
  const luma = {} as Record<P1Shape, { box: Buffer[]; canvas: Buffer[] }>
  const md5 = {} as Record<P1Shape, { base: string[]; box: string[]; canvas: string[] }>
  const lines: string[] = []

  beforeAll(async () => {
    dir = join(root, 'phase1')
    await mkdir(dir, { recursive: true })
    const shot = await makeColour(join(dir, 'red.mp4'), 'red', P1_SHOT, P1_SHOT_FRAMES / FPS, FPS)
    for (const shape of P1_SHAPE_NAMES) {
      const size = P1_SHAPES[shape]
      zones[shape] = zonesOf(shape)
      base[shape] = await p1Export(dir, `${shape}-base`, p1Project(shot, false), shape, 'box')
      boxed[shape] = await p1Export(dir, `${shape}-box`, p1Project(shot, true), shape, 'box')
      canvased[shape] = await p1Export(dir, `${shape}-canvas`, p1Project(shot, true), shape, 'canvas')
      rgb[shape] = await lumaFrames(boxed[shape].file, size, 'rgb24')
      canvasRgb[shape] = await lumaFrames(canvased[shape].file, size, 'rgb24')
      baseRgb[shape] = await lumaFrames(base[shape].file, size, 'rgb24')
      luma[shape] = { box: await lumaFrames(boxed[shape].file, size, 'gray'), canvas: await lumaFrames(canvased[shape].file, size, 'gray') }
      md5[shape] = { base: await framemd5(base[shape].file), box: await framemd5(boxed[shape].file), canvas: await framemd5(canvased[shape].file) }
      const saved = join(dir, `${shape}-box`, 'frames')
      await mkdir(saved, { recursive: true })
      for (const f of P1_SAVED) await saveFrame(boxed[shape].file, (f - 0.25) / FPS, join(saved, `f${String(f).padStart(3, '0')}.png`))
    }
  }, 600_000)

  it('moves for the frames the code says, hand-derived: 46 moving, arrivals on 15 and 30, the exit from 51', () => {
    expect(graphicMovingFrames(P1_SPEC, CLEAN_GRAPHIC_STYLE, FPS, P1_FRAMES)).toBe(P1_MOVING)
    expect(P1_SPEC.beats.map((b) => beatFrame(b, FPS))).toEqual(P1_ARRIVALS)
    expect(graphicExitKeys(P1_FRAMES, FPS).opacity).toEqual([
      { frame: P1_EXIT, value: 1, ease: 'smooth' },
      { frame: P1_FRAMES - 1, value: 0 }
    ])
    expect(P1_EXIT).toBe(P1_FRAMES - Math.round(EXIT_S * FPS))
    for (const shape of P1_SHAPE_NAMES) expect(placeRect(P1_SPEC, P1_SHAPES[shape]), shape).toEqual(P1_PLACE_PX[shape])
  })

  it('bakes at the export’s shape, the moving frames only, and the box route’s asset carries the box', () => {
    for (const shape of P1_SHAPE_NAMES) {
      const size = P1_SHAPES[shape]
      for (const [route, e] of [['box', boxed[shape]], ['canvas', canvased[shape]]] as const) {
        expect(e.notes, `${shape} ${route}: onError`).toEqual([])
        expect(e.asks.map(({ key, width, height, frames, fps, boxAllowed }) => ({ key, width, height, frames, fps, boxAllowed })), `${shape} ${route}: what the export asked for`).toEqual([
          { key: exportKey('g'), ...size, frames: P1_FRAMES, fps: FPS, boxAllowed: true }
        ])
        expect(e.pngs, `${shape} ${route}: PNGs written, against graphicMovingFrames`).toBe(graphicMovingFrames(P1_SPEC, CLEAN_GRAPHIC_STYLE, FPS, P1_FRAMES))
        expect(e.pngs, `${shape} ${route}: PNGs written, hand-derived`).toBe(P1_MOVING)
      }
      const asset = boxed[shape].baked.assets.find((a) => a.id === 'graphic-asset-g')!
      expect(boxed[shape].asks[0].box, `${shape}: graphicBox`).toEqual(P1_BOX_PX[shape])
      expect(asset.frames, `${shape}: the box route's asset`).toEqual({ pattern: join(boxed[shape].asks[0].seq, '%05d.png'), count: P1_MOVING, box: P1_BOX_PX[shape] })
      expect({ width: asset.width, height: asset.height }, `${shape}: the box route's asset is the box's size`).toEqual({ width: P1_BOX_PX[shape].width, height: P1_BOX_PX[shape].height })
      const whole = canvased[shape].baked.assets.find((a) => a.id === 'graphic-asset-g')!
      expect(whole.frames?.box, `${shape}: the canvas route's asset has no box`).toBeUndefined()
      expect({ width: whole.width, height: whole.height }, `${shape}: the canvas route's asset is the canvas's size`).toEqual(size)
      lines.push(`- ${shape}: ${boxed[shape].pngs} PNGs written by each route (graphicMovingFrames ${P1_MOVING}); the box route's box ${JSON.stringify(boxed[shape].asks[0].box)} for the spec's ${JSON.stringify(P1_PLACE_PX[shape])}`)
    }
  })

  it('reads the base: the red shot where the plan fits it, black beside it at 16:9, on every frame', () => {
    for (const shape of P1_SHAPE_NAMES) {
      expect(baseRgb[shape].length, `${shape}: base frames`).toBe(P1_SHOT_FRAMES)
      let worst = 0
      for (const [f, frame] of baseRgb[shape].entries()) {
        // Against the base's colour everywhere it has one, the box's place included: nothing is drawn there.
        const r = regionReading(frame, zones[shape], null)
        worst = Math.max(worst, r.inside, r.outside)
        expect(Math.max(r.inside, r.outside), `${shape} base frame ${f}`).toBeLessThan(P1_LEVELS)
      }
      lines.push(`- ${shape} base (the shot alone): within ${worst} levels of red in the shot and black beside it, ${P1_MARGIN} px clear of its edges, on all ${P1_SHOT_FRAMES} frames`)
    }
  })

  it('reads every frame by both routes: red before, grey(i) on each moving frame, white arrivals, the hold, the fall to red, red after, the base outside the box', () => {
    for (const [shape, route] of P1_SHAPE_NAMES.flatMap((n) => [[n, 'box'], [n, 'canvas']] as const)) {
      const size = P1_SHAPES[shape]
      const place = P1_PLACE_PX[shape]
      const frames = route === 'box' ? rgb[shape] : canvasRgb[shape]
      const at = `${shape} ${route}`
      expect(frames.length, `${at}: frames`).toBe(P1_SHOT_FRAMES)
      const cx = place.x + Math.floor(place.width / 2)
      const cy = place.y + Math.floor(place.height / 2)

      const readings: { f: number; want: string; inside: number; outside: number; insideMean: number }[] = []
      for (let f = 0; f < P1_SHOT_FRAMES; f++) {
        const i = f - P1_START
        const level = i < 0 || i >= P1_FRAMES ? null : i < P1_MOVING ? (P1_ARRIVALS.includes(i) ? 255 : p1Grey(i)) : i <= P1_EXIT ? p1Grey(P1_MOVING - 1) : null
        const exiting = i > P1_EXIT && i < P1_FRAMES
        const r = regionReading(frames[f], zones[shape], level)
        readings.push({ f, want: exiting ? 'exit' : level === null ? 'base' : String(level), ...r })
        // Outside the box the base shows on every frame.
        expect(r.outside, `${at} frame ${f}: outside the box against the base`).toBeLessThan(P1_LEVELS)
        // Before and after the clip the base inside the box too; each moving frame its grey or white; the hold the last moving frame's grey.
        if (!exiting) expect(r.inside, `${at} frame ${f} (clip frame ${i}): inside the box, want ${level ?? 'the base'}`).toBeLessThan(P1_LEVELS)
      }
      // Red in the box's middle the frame before the clip and the frame after it.
      expect(furthest(pixelOf(frames[P1_START - 1], size.width, cx, cy), RED), `${at}: the frame before the clip`).toBeLessThan(P1_LEVELS)
      expect(furthest(pixelOf(frames[P1_START + P1_FRAMES], size.width, cx, cy), RED), `${at}: the frame after the clip`).toBeLessThan(P1_LEVELS)
      // Each arrival white over the whole inside (the loop above read it against 255), and the frame before it not, read over the inside too.
      for (const a of P1_ARRIVALS) {
        expect(regionReading(frames[P1_START + a], zones[shape], 255).inside, `${at}: arrival ${a} white`).toBeLessThan(P1_LEVELS)
        expect(furthest(pixelOf(frames[P1_START + a], size.width, cx, cy), [255, 255, 255]), `${at}: arrival ${a} white in the middle`).toBeLessThan(P1_LEVELS)
        const before = regionReading(frames[P1_START + a - 1], zones[shape], 255)
        expect(before.inside, `${at}: the frame before arrival ${a} is not white`).toBeGreaterThanOrEqual(P1_LEVELS)
        expect(regionReading(frames[P1_START + a - 1], zones[shape], p1Grey(a - 1)).inside, `${at}: the frame before arrival ${a} is grey(${a - 1})`).toBeLessThan(P1_LEVELS)
      }
      // The exit: from the held grey at its first key, the box falls to the base every frame, and is the base on the clip's last frame (opacity 0).
      const exit = readings.slice(P1_START + P1_EXIT, P1_START + P1_FRAMES)
      expect(exit).toHaveLength(P1_FRAMES - P1_EXIT)
      expect(exit[0].insideMean, `${at}: the exit starts from the held grey, not the base`).toBeGreaterThan(20)
      exit.slice(1).forEach((r, k) => {
        expect(r.insideMean, `${at} exit frame ${r.f}: mean distance from the base ${r.insideMean.toFixed(2)} after ${exit[k].insideMean.toFixed(2)}`).toBeLessThan(exit[k].insideMean)
      })
      const last = regionReading(frames[P1_START + P1_FRAMES - 1], zones[shape], null)
      expect(last.inside, `${at}: the clip's last frame, opacity 0, against the base`).toBeLessThan(P1_LEVELS)
      lines.push(
        `- ${shape} ${size.width}×${size.height}, ${route} route: inside the box within ${Math.max(...readings.filter((r) => r.want !== 'exit').map((r) => r.inside))} levels of what each frame wants ` +
          `(the base before and after, grey(i) or white while moving, grey(${P1_MOVING - 1}) held to clip frame ${P1_EXIT}), outside it within ${Math.max(...readings.map((r) => r.outside))} of the base on all ${P1_SHOT_FRAMES} frames; ` +
          `the exit's mean distance from the base, frames ${P1_START + P1_EXIT}–${P1_START + P1_FRAMES - 1}: ${exit.map((r) => r.insideMean.toFixed(1)).join(', ')}`
      )
    }
  })

  it('samples a frame at (f − 0.25)/fps as decoding every frame in order gives it', async () => {
    for (const shape of P1_SHAPE_NAMES) {
      const size = P1_SHAPES[shape]
      for (const f of P1_SAVED) {
        const png = join(dir, `${shape}-box`, 'frames', `f${String(f).padStart(3, '0')}.png`)
        expect(difference(await rgbOf(png, size.width, size.height), rgb[shape][f]), `${shape}: ${png} against decoded frame ${f}`).toEqual({ mean: 0, pixels: 0 })
      }
    }
  })

  it('(box) puts the grey’s first and last columns and rows within 1 px of the box the spec gave, at both shapes and by both routes, in luma', () => {
    for (const shape of P1_SHAPE_NAMES) {
      const size = P1_SHAPES[shape]
      const place = P1_PLACE_PX[shape]
      const want = edgeWant(place)
      for (const route of ['box', 'canvas'] as const) {
        const read = {} as Record<EdgeName, { frames: number; offsets: Set<number> }>
        for (const name of Object.keys(want) as EdgeName[]) read[name] = { frames: 0, offsets: new Set() }
        // Every frame the graphic is whole: moving and held, to the exit's first key.
        for (let i = 0; i <= P1_EXIT; i++) {
          const edges = edgesOf(luma[shape][route][P1_START + i], size, place)
          for (const name of Object.keys(edges) as EdgeName[]) {
            const at = edges[name]
            if (at === null) continue
            read[name].frames++
            read[name].offsets.add(at - want[name])
            expect(Math.abs(at - want[name]), `${shape} ${route} clip frame ${i}: the ${name} edge at ${at}, the spec's at ${want[name]}`).toBeLessThanOrEqual(P1_EDGE_PX)
          }
        }
        // Read, not skipped: every edge on both arrivals at least, where white meets the base.
        for (const name of Object.keys(read) as EdgeName[]) expect(read[name].frames, `${shape} ${route}: frames the ${name} edge was read on`).toBeGreaterThanOrEqual(P1_ARRIVALS.length)
        const said = (Object.keys(read) as EdgeName[]).map((n) => `${n} on ${read[n].frames} frames, offset ${[...read[n].offsets].sort((a, b) => a - b).join('/')} px`).join('; ')
        lines.push(`- ${shape} ${route} route, the grey's edges in luma against the spec's ${JSON.stringify(place)}: ${said}`)
      }
    }
  })

  /*
   * The plan's claim: the box route and the canvas route are framemd5-equal.
   * f8d74ee measured them NOT equal, by the exit's `geq` (plan.ts, the opacity
   * keys' `geq=r='r(X,Y)'…:a='alpha(X,Y)*…'`): its `getpix` samples bilinearly
   * with x clamped to w − 2 and y to h − 2 (libavfilter/vf_geq.c:91-92 at
   * f22fcd4, the Windows build's 2018 master, which has no `interpolation`
   * option; the Mac's 4.4 build the same, an 8×6 RGBA probe), so the
   * stream's last column is a copy of the one before it and its last row of
   * the row above. With the box ending one past the ink's odd edge, that drew
   * the grey a pixel wider and taller on the box route: 39,893 plan-frame
   * samples at 9:16 and 36,066 at 16:9, all in the box's last column and row,
   * and the exports' framemd5 apart on 60 and 105 of 105 frames (one column
   * moves x264's choices on other frames: frame 14, before the clip,
   * differed). `graphicBox` now keeps two transparent columns and rows past
   * the ink on the far sides, so what geq copies is transparent. Read on the
   * plan's own frames before the encoder (where a difference is) and on the
   * exports' framemd5 (the plan's bar).
   */
  it('(box) exports the same frames by the box route and by the canvas route: the plan’s frames equal before the encoder, the exports framemd5-equal', async () => {
    for (const shape of P1_SHAPE_NAMES) {
      const size = P1_SHAPES[shape]
      const [byBox, byCanvas] = [await planFrames(boxed[shape].args, size), await planFrames(canvased[shape].args, size)]
      expect(byBox.length, `${shape}: the plan's frames`).toBe(P1_SHOT_FRAMES)
      expect(byCanvas.length, `${shape}: the plan's frames, canvas route`).toBe(P1_SHOT_FRAMES)
      let differing = 0
      let frames = 0
      const planes = new Set<string>()
      for (let f = 0; f < P1_SHOT_FRAMES; f++) {
        const where = differingPixels(byBox[f], byCanvas[f], size)
        if (where.length > 0) frames++
        differing += where.length
        for (const p of where) planes.add(p.plane)
      }
      const md5Differ = md5[shape].box.filter((l, f) => l !== md5[shape].canvas[f]).length
      lines.push(
        `- ${shape}: box route against canvas route, the plan's frames before the encoder: ${differing === 0 ? 'equal on every frame' : `${differing} samples differ over ${frames} frames (planes ${[...planes].join(', ')})`}; ` +
          `the exports' framemd5 ${md5Differ === 0 ? 'equal' : `differ on ${md5Differ} of ${md5[shape].box.length} frames`}`
      )
      for (let f = 0; f < P1_SHOT_FRAMES; f++) {
        const where = differingPixels(byBox[f], byCanvas[f], size)
        expect(where.slice(0, 8), `${shape} frame ${f}: the routes' plan frames differ (${where.length} samples)`).toEqual([])
      }
      expect(md5[shape].box.length, `${shape}: framemd5 lines`).toBe(P1_SHOT_FRAMES)
      expect(md5[shape].canvas, `${shape}: the exports' framemd5`).toEqual(md5[shape].box)
    }
  })

  it('drops a graphic whose bake answers null, with a note, and the export is the base’s frame for frame', async () => {
    for (const shape of P1_SHAPE_NAMES) {
      const e = await p1Export(dir, `${shape}-null`, p1Project(join(dir, 'red.mp4'), true), shape, 'null')
      expect(e.notes, `${shape}: onError`).toEqual(['g: the graphic could not be drawn'])
      expect(e.asks.map((a) => a.key), `${shape}: asked once`).toEqual([exportKey('g')])
      expect(e.baked.clips.map((c) => c.id), `${shape}: the clip is dropped`).toEqual(['red'])
      const nulled = await framemd5(e.file)
      expect(nulled, `${shape}: the null bake's export against the base's`).toEqual(md5[shape].base)
      lines.push(`- ${shape}: a null bake — note "${e.notes.join('; ')}", clips exported: ${e.baked.clips.map((c) => c.id).join(', ')}; framemd5-equal to the base over ${nulled.length} frames`)
    }
  }, 300_000)

  it('writes the README', async () => {
    await writeNote(dir, [
      '# graphic, phase 1: a graphic through the export (docs/CLIPS.md §6.11 "The render check", §6.3)',
      '',
      `A red ${P1_SHOT.width}×${P1_SHOT.height} shot (red.mp4, ${P1_SHOT_FRAMES} frames at ${FPS} fps) on V1; a graphic clip on V2 from frame ${P1_START} for ${P1_FRAMES} frames,`,
      `its spec placed by hand at ${JSON.stringify(P1_PLACE)} with beats at ${P1_SPEC.beats.join(' and ')} s, its exit the opacity keys of graphicExitKeys.`,
      'Exported through bakeForExport, buildRenderPlan and the bundled ffmpeg at 9:16 (360×640) and 16:9 (640×360), with a fake Bakers.graphic:',
      `moving frame i (${P1_MOVING} of them, graphicMovingFrames) fills the place rect with grey 20 + 15·(i mod 12), white on an arrival frame`,
      `(${P1_ARRIVALS.join(' and ')}), transparent outside; the render holds the last with tpad and fades it from clip frame ${P1_EXIT}.`,
      'The box route cuts the frames to graphicBox\'s box (snapped outward to even, two more columns and rows on the far sides for the exit geq) and hands the box to the plan; the canvas route writes them at the canvas.',
      `Readings ${P1_MARGIN} px clear of every edge, within ${P1_LEVELS - 1} levels; the edges themselves in luma, within ${P1_EDGE_PX} px.`,
      '',
      '<shape>-box/     the box route: export.mp4, graph.txt, g-export.seq/ (the PNGs), frames/fNNN.png (frame NNN, taken at (f − 0.25)/fps)',
      '<shape>-canvas/  the canvas route, read against the box route',
      '<shape>-base/    the shot alone, no graphic: what "the base" means below',
      '<shape>-null/    the graphic\'s bake answering null: dropped with a note, framemd5-equal to the base',
      '',
      ...lines
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
 * subsampling and no `geq`: `format=yuva444p`, `overlay=…:format=yuv444`, one
 * swscale matrix on both sides. So what differs is the plan's whole chain: the
 * 4:2:0, and the exit `geq`'s RGB round trip, which is a second chroma
 * subsample (0954b3d's probe without it: 58/51/22 levels of U against
 * 63/54/29 with it, on node-made PNGs).
 *
 * Read along each line's centre line (`strokeLines`: per scan line across it,
 * the pixels nearest its alpha-weighted middle, 4 px clear of each end): the overlay's U
 * and V at each pixel (the 4:2:0 sample it is stored with) against the
 * reference's. The bar (M19, proposal) is 8 levels; this measures and prints,
 * it sets nothing: STROKE_MIN_PX is the user's to set from it. What is
 * asserted is that the read measured something, and measured it on the right
 * frame: every PNG has lines, every line a centre; away from the lines the two
 * sides' U and V agree; on every inked pixel their Y agrees (luma is full
 * resolution on both sides, so a graphic a frame late or a pixel off shows
 * there, where a flat background cannot); and the reference's U and V on the
 * crisp pixels (alpha 255) are the PNG's own, converted alone, so the
 * reference is not subsampled itself.
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
/** On every inked pixel the two sides' Y may differ by this much; more, and the overlay's frame is not the PNG's, or not where it is (measured 0 on the Mac, 2026-11-03). */
const INK_LUMA_LEVELS = 2
/** On a crisp pixel (alpha 255) the reference's U and V may differ from the PNG converted alone by this much; more, and the reference is subsampled (measured 0 on the Mac, 2026-11-03). */
const REFERENCE_LEVELS = 1

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

/** The largest |a − b| over the pixels `which` picks (by index into one plane), and how many it picked. */
function largestOver(a: ArrayLike<number>, b: ArrayLike<number>, n: number, which: (i: number) => boolean): { max: number; pixels: number } {
  let max = 0
  let pixels = 0
  for (let i = 0; i < n; i++) {
    if (!which(i)) continue
    pixels++
    const d = Math.abs(a[i] - b[i])
    if (d > max) max = d
  }
  return { max, pixels }
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
  const ink: { colour: string; png: string; maxY: number; pixels: number }[] = []
  const crisp: { colour: string; png: string; maxU: number; maxV: number; pixels: number }[] = []
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
      // `-vsync passthrough`, as lumaFrames reads: frame n out is the plan's frame n.
      const { stdout } = await run(FFMPEG, [...inputs, '-filter_complex', graph, '-map', '[vout]', '-frames:v', String(pngs.length), '-vsync', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'], {
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
        // The right frame, in the right place: Y over every inked pixel.
        const y = largestOver(all.subarray(at, at + luma), full.subarray(0, luma), luma, (i) => rgba[i * 4 + 3] > 0)
        ink.push({ colour: colour.name, png: file, maxY: y.max, pixels: y.pixels })
        // The reference unsubsampled: its U and V on the crisp pixels are the PNG's, converted alone through the same swscale.
        const { stdout: alone } = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', png, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'yuv444p', 'pipe:1'], {
          encoding: 'buffer',
          maxBuffer: 256 * 1024 * 1024
        })
        const own = alone as unknown as Buffer
        if (own.length !== luma * 3) throw new Error(`${file} alone: ${own.length} bytes, not ${size.width}×${size.height} 4:4:4`)
        const opaque = (i: number): boolean => rgba[i * 4 + 3] === 255
        const u = largestOver(reference.u, own.subarray(luma, 2 * luma), luma, opaque)
        const v = largestOver(reference.v, own.subarray(2 * luma, 3 * luma), luma, opaque)
        crisp.push({ colour: colour.name, png: file, maxU: u.max, maxV: v.max, pixels: u.pixels })
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
        await unlink(raw)
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
    expect(ink.length).toBe(M19_COLOURS.length * distinct.length)
    for (const k of ink) {
      expect(k.pixels, `${k.colour} ${k.png}: no inked pixel`).toBeGreaterThan(0)
      expect(k.maxY, `${k.colour} ${k.png}: Y on the inked pixels, the overlay's frame against the PNG's (a frame late, or a pixel off?)`).toBeLessThanOrEqual(INK_LUMA_LEVELS)
    }
    expect(crisp.length).toBe(M19_COLOURS.length * distinct.length)
    for (const c of crisp) {
      expect(c.pixels, `${c.colour} ${c.png}: no crisp pixel`).toBeGreaterThan(0)
      expect(Math.max(c.maxU, c.maxV), `${c.colour} ${c.png}: the reference's U and V on the crisp pixels against the PNG's own (is the reference subsampled?)`).toBeLessThanOrEqual(REFERENCE_LEVELS)
    }

    // Per band, as drawn (strokeBandIndex): a band is one width, labelled by its horizontal's read width, whatever its diagonal reads; narrowest first.
    const bands = [...new Set(lines.map((l) => strokeBandIndex(l.line.box)))]
    const verdicts = bands.map((band) => {
      const of = lines.filter((l) => strokeBandIndex(l.line.box) === band)
      const flat = of.filter((l) => Math.abs(l.line.slope) < 0.01)
      const width = (flat.length ? flat : of)[0].line.width
      const w = `${band === null ? 'outside the bands, ' : ''}${width.toFixed(1)}`
      const maxU = Math.max(...of.map((l) => l.chroma.maxU))
      const maxV = Math.max(...of.map((l) => l.chroma.maxV))
      return { w, width, of, maxU, maxV, within: band !== null && of.every((l) => l.chroma.within) }
    }).sort((a, b) => a.width - b.width)
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
        `the smallest width within the bar: ${smallest}; background U/V ${background.map((b) => `${b.colour} ${Math.max(b.maxU, b.maxV)}`).join(', ')}; ` +
        `ink Y ${ink.map((k) => `${k.colour} ${k.maxY}`).join(', ')}; reference U/V on crisp pixels ${crisp.map((c) => `${c.colour} ${Math.max(c.maxU, c.maxV)}`).join(', ')}\n`
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
      `Y on every inked pixel, the overlay against the reference (bar ${INK_LUMA_LEVELS}: the same frame, in the same place): ${ink.map((k) => `${k.colour} ${k.png} ${k.maxY} over ${k.pixels} px`).join('; ')}.`,
      `The reference's U and V on the crisp pixels against the PNG converted alone (bar ${REFERENCE_LEVELS}: not subsampled): ${crisp.map((c) => `${c.colour} ${c.png} U ${c.maxU} V ${c.maxV} over ${c.pixels} px`).join('; ')}.`,
      'The measured side is the plan\'s whole chain, the exit geq\'s RGB round trip included (a second chroma subsample: up to 7 levels of U in 0954b3d\'s probe without it);',
      'the reference has neither the 4:2:0 nor the geq.',
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
