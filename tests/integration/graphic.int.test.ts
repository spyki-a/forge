import { beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { buildRenderPlan } from '@shared/render/plan'
import { DEFAULT_CAPTION_STYLE } from '@shared/captions/style'
import { REFERENCE_HEIGHT, toAssTime } from '@shared/captions/ass'
import { FFMPEG, makeColour, outputDir, run, saveFrame, writeNote } from './output'
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
