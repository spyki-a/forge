import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { buildRenderPlan } from '@shared/render/plan'
import { bakeForExport, type Bakers } from '@shared/render/exportBake'
import { CAPTION_STYLES } from '@shared/captions/style'
import { captionsNeedBaking } from '@shared/graphics/fromTimeline'
import { EXIT_S, drawnGraphicAsset, graphicExitKeys, graphicMovingFrames } from '@shared/graphics/frame'
import { drawListAt, graphicBox } from '@shared/graphics/drawList'
import { itemBounds, type DrawItem, type TextMeasure } from '@shared/graphics/items'
import { GRAPHIC_STYLES, graphicStyleOf } from '@shared/graphics/style'
import { LIBRARY_GRAPHIC_RULE } from '@shared/graphics/apply'
import { libraryGraphicAt } from '@shared/graphics/library'
import { segmentIntoSentences, type Word } from '@shared/transcript'
import { applyLook, lookFromProject, readLookText, serializeLook, type Look } from '@shared/look'
import { prepareCaptions } from '../../src/main/captions'
import { FFMPEG, makeColour, outputDir, run, saveFrame, writeNote } from './output'

/*
 * The render check for "my look" (docs/CLIPS.md §10, step 7's first bullet;
 * creator style, piece 2), into tests/output/look/.
 *
 * A grey shot with a transcript (captions on, burned by libass through main's
 * own `prepareCaptions`) and a Library lower third over it (its bar is drawn
 * in the graphic style's `palette.accent`), exported through the app's own
 * path: `bakeForExport` → `buildRenderPlan` → the bundled ffmpeg. Twice: once
 * with a look applied whose caption colour and graphic accent are two
 * colours no preset has (the look made from another project, written to its
 * file's text and read back, as an import reads it), and once WITHOUT it.
 * Then READ off the picture: on a held frame, the pixels near each of the
 * two colours. With the look, both colours are on screen (the caption's in
 * the top half, where the look puts the captions; the accent's in the bottom
 * third, the lower third's); without it, neither is anywhere.
 *
 * The graphic's frames are painted by a stand-in `Bakers.graphic`, as
 * graphic.int's are (the real painter is the renderer's canvas): each item of
 * the REAL drawer's list at that frame, in the style the export hands the
 * baker (`graphicStyleOf` of the exported project), a shape in its own fill
 * and opacity, a word as a white box of its bounds. So the accent reaches the
 * picture only if the look reached the export's graphic style.
 *
 * Nothing new reaches ffmpeg: the graph is the plan's, the source is made
 * with `color` (EFFECTS.md §25's 2018 floor holds); every path goes by argv
 * except what the plan writes (its own escaping).
 */

const FPS = 30
/** Portrait at full size: the accent bar is about 0.008 of the short side, so 8 px here, wider than a 4:2:0 chroma pair. */
const W = 1080
const H = 1920
const SECONDS = 5
const GREY = '#606060'

/** Two colours no preset writes, far from the grey, from white, from black and from each other. */
const CAPTION_COLOUR = '#FF40C0'
const ACCENT_COLOUR = '#40E0FF'
/** A pixel is a colour's when every channel is within this of it. */
const NEAR = 40
/** Pixels of each colour the look's frame must show. */
const ENOUGH = 300

const MEASURE: TextMeasure = (text, look) => ({ width: text.length * look.px * 0.55, ascent: look.px * 0.8, descent: look.px * 0.2 })

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

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

/** What the stand-in baker was handed: the accent of the style the export resolved. */
const accents: string[] = []

function bakers(dir: string): Bakers {
  const none = (what: string) => async (): Promise<never> => {
    throw new Error(`the look project has no ${what}`)
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
      accents.push(style.palette.accent)
      const size = { width, height }
      const moving = graphicMovingFrames(spec, style, fps, frames)
      const box = boxAllowed ? graphicBox(spec, style, fps, frames, size, MEASURE, targetsAt) : null
      if (boxAllowed && !box) return null
      const region = box ?? { x: 0, y: 0, width, height }
      const seq = join(dir, `${key}.seq`)
      await mkdir(seq, { recursive: true })
      const paint = (rgba: Buffer, item: DrawItem, colour: [number, number, number], alpha: number): void => {
        const r = itemBounds(item, size, MEASURE)
        if (!r) return
        for (let y = Math.max(Math.floor(r.y), region.y); y < Math.min(Math.ceil(r.y + r.height), region.y + region.height); y++) {
          for (let x = Math.max(Math.floor(r.x), region.x); x < Math.min(Math.ceil(r.x + r.width), region.x + region.width); x++) {
            const at = ((y - region.y) * region.width + (x - region.x)) * 4
            rgba[at] = colour[0]
            rgba[at + 1] = colour[1]
            rgba[at + 2] = colour[2]
            rgba[at + 3] = Math.round(alpha * 255)
          }
        }
      }
      const flat = (items: readonly DrawItem[]): DrawItem[] => items.flatMap((i) => (i.kind === 'group' ? flat(i.children) : [i]))
      for (let i = 0; i < moving; i++) {
        const rgba = Buffer.alloc(region.width * region.height * 4)
        const items = flat(drawListAt(spec, style, i, fps, size, MEASURE, targetsAt(i)).items)
        // Words first, shapes over them: the accent bar is the thing read.
        for (const item of items) if (item.kind === 'text' && item.opacity > 0) paint(rgba, item, [255, 255, 255], 1)
        for (const item of items) if (item.kind === 'shape' && item.fill && item.opacity > 0) paint(rgba, item, rgb(item.fill), item.opacity)
        await writeFile(join(seq, `${String(i).padStart(5, '0')}.png`), rgbaPng(region.width, region.height, rgba))
      }
      const pattern = join(seq, '%05d.png')
      return box ? { pattern, frames: moving, box } : { pattern, frames: moving }
    }
  }
}

/** Words every 400 ms over the whole shot, made up, so a caption line is on screen at any frame. */
function words(): Word[] {
  const vocab = ['zor', 'plim', 'tavek', 'mubo', 'senra', 'kilo', 'drav', 'oppen']
  const out: Word[] = []
  for (let i = 0; i * 400 < SECONDS * 1000; i++) {
    out.push({ index: i, text: vocab[i % vocab.length] + (i % 5 === 4 ? '.' : ''), startMs: i * 400, endMs: i * 400 + 380, confidence: 0.9 })
  }
  return out
}

/** The grey shot on V1 with its transcript, captions on in a new project's style, and the Library's lower third on V2 at frame 0. */
function baseProject(shot: string): { project: Project; held: number } {
  const empty = emptyProject('look-render')
  const grey: MediaAsset = { id: 'grey', path: shot, name: 'grey.mp4', kind: 'video', durationFrames: SECONDS * FPS, width: W, height: H, fps: FPS, hasVideo: true, hasAudio: false, size: 1 }
  const clip = (over: Partial<Clip> & Pick<Clip, 'id' | 'assetId' | 'trackId' | 'start' | 'duration'>): Clip => ({
    inPoint: 0, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 }, ...over
  })
  const said = words()
  // Placed with captions off, so the lower third takes its own first third (the bottom) whatever the captions do later.
  const placing: Project = {
    ...empty,
    settings: { ...empty.settings, width: W, height: H, fps: FPS },
    captions: { ...empty.captions, enabled: false },
    assets: [grey],
    clips: [clip({ id: 'grey', assetId: 'grey', trackId: 'v1', start: 0, duration: SECONDS * FPS })],
    transcripts: { grey: { assetId: 'grey', language: 'en', model: 'test', durationMs: SECONDS * 1000, words: said, segments: segmentIntoSentences(said) } }
  }
  const ready = libraryGraphicAt(placing, 'lower-third', 0)
  if ('refused' in ready) throw new Error(`lower-third refused: ${ready.refused}`)
  const duration = Math.min(ready.duration, SECONDS * FPS)
  const drawn = drawnGraphicAsset('g', W, H, Math.max(duration, FPS * 10), 'lower third — graphic')
  const g = clip({
    id: 'g', assetId: drawn.id, trackId: 'v2', start: 0, duration,
    keyframes: graphicExitKeys(duration, FPS), graphic: ready.spec, generatedBy: { rule: LIBRARY_GRAPHIC_RULE, reason: 'placed from the Library' }
  })
  const moving = graphicMovingFrames(ready.spec, graphicStyleOf(placing, ready.spec), FPS, duration)
  const exit = duration - Math.round(EXIT_S * FPS)
  const held = Math.min(moving + 2, exit - 1)
  return {
    project: { ...placing, captions: { ...placing.captions, enabled: true }, assets: [grey, drawn], clips: [...placing.clips, g] },
    held
  }
}

/** The look a creator made elsewhere: bold-center captions in CAPTION_COLOUR at the top, neon graphics with ACCENT_COLOUR; then written and read back as a file is. */
function theLook(): Look {
  const made = lookFromProject(
    {
      captions: { enabled: true, styleId: 'bold-center', overrides: { primaryColor: CAPTION_COLOUR, highlightColor: CAPTION_COLOUR, position: 'top' } },
      graphics: { styleId: 'neon', overrides: { 'palette.accent': ACCENT_COLOUR }, sound: true }
    },
    { name: 'Pink and cyan', author: 'Someone' }
  )
  const read = readLookText(serializeLook(made))
  if (!read.ok) throw new Error(`the look did not read back: ${read.reason}`)
  return read.look
}

interface Reading {
  file: string
  /** Pixels near each colour, over the whole frame, and in the half or third each belongs to. */
  caption: { all: number; top: number }
  accent: { all: number; bottomThird: number }
  notes: string[]
}

async function exportAndRead(dir: string, name: string, project: Project, held: number): Promise<Reading> {
  const out = join(dir, name)
  await mkdir(out, { recursive: true })
  const canvas = { width: W, height: H }
  const notes: string[] = []
  expect(captionsNeedBaking(project), `${name}: the captions are libass's (a flat style on Latin words)`).toBe(false)
  const baked = await bakeForExport(project, canvas, bakers(out), (clip, err) => {
    notes.push(`${clip.id}: ${err instanceof Error ? err.message : String(err)}`)
  })
  const prepared = await prepareCaptions(project, canvas)
  if (!prepared) throw new Error(`${name}: no captions to burn`)
  const file = join(out, 'export.mp4')
  const plan = buildRenderPlan({
    project: baked,
    outputPath: file,
    canvas,
    subtitlesPath: prepared.subtitlesPath,
    fontsDir: prepared.fontsDir && existsSync(prepared.fontsDir) ? prepared.fontsDir : undefined
  })
  await writeFile(join(out, 'graph.txt'), plan.args.join(' ').replace(/;/g, ';\n'), 'utf8')
  await run(FFMPEG, plan.args, { maxBuffer: 64 * 1024 * 1024 })
  await prepared.cleanup()
  const seconds = (held + 0.5) / FPS
  await saveFrame(file, seconds, join(out, `held-f${String(held).padStart(3, '0')}.png`))
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
  )
  const frame = stdout as unknown as Buffer
  expect(frame.length, `${name}: one ${W}×${H} frame`).toBe(W * H * 3)
  const near = (at: number, c: [number, number, number]): boolean =>
    Math.abs(frame[at] - c[0]) <= NEAR && Math.abs(frame[at + 1] - c[1]) <= NEAR && Math.abs(frame[at + 2] - c[2]) <= NEAR
  const pink = rgb(CAPTION_COLOUR)
  const cyan = rgb(ACCENT_COLOUR)
  const reading: Reading = { file, caption: { all: 0, top: 0 }, accent: { all: 0, bottomThird: 0 }, notes }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const at = (y * W + x) * 3
      if (near(at, pink)) {
        reading.caption.all++
        if (y < H / 2) reading.caption.top++
      }
      if (near(at, cyan)) {
        reading.accent.all++
        if (y >= (2 * H) / 3) reading.accent.bottomThird++
      }
    }
  }
  return reading
}

let root = ''
const savedEnv = { userData: process.env.FORGE_TEST_USERDATA, fonts: process.env.FORGE_FONTS_DIR }

beforeAll(async () => {
  root = await outputDir('look')
  // prepareCaptions writes its .ass under userData/tmp: here, inside the output folder.
  process.env.FORGE_TEST_USERDATA = root
  // The app's own faces, as bestClipsCard.int points libass at them (gitignored: on CI libass draws its fallback).
  process.env.FORGE_FONTS_DIR = resolve(__dirname, '../../assets/fonts')
})

afterAll(() => {
  if (savedEnv.userData === undefined) delete process.env.FORGE_TEST_USERDATA
  else process.env.FORGE_TEST_USERDATA = savedEnv.userData
  if (savedEnv.fonts === undefined) delete process.env.FORGE_FONTS_DIR
  else process.env.FORGE_FONTS_DIR = savedEnv.fonts
})

describe('a look applied reaches the export: its caption colour and its graphic accent, on the picture (docs/CLIPS.md §10)', () => {
  const runs = {} as Record<'with' | 'without', Reading>
  let held = 0
  let look: Look

  beforeAll(async () => {
    const shot = await makeColour(join(root, 'grey.mp4'), GREY, { width: W, height: H }, SECONDS, FPS)
    const built = baseProject(shot)
    held = built.held
    look = theLook()
    accents.length = 0
    runs.without = await exportAndRead(root, 'without-look', built.project, held)
    runs.with = await exportAndRead(root, 'with-look', applyLook(built.project, look), held)
  }, 600_000)

  it('the two colours are no preset’s', () => {
    const presetColours = new Set([
      ...CAPTION_STYLES.flatMap((s) => [s.primaryColor, s.highlightColor, s.outlineColor].map((c) => String(c).toUpperCase())),
      ...GRAPHIC_STYLES.flatMap((s) => Object.values(s.palette).map((c) => String(c).toUpperCase()))
    ])
    expect(presetColours.has(CAPTION_COLOUR)).toBe(false)
    expect(presetColours.has(ACCENT_COLOUR)).toBe(false)
    // The look carries both, after its file's round trip.
    expect(look.captions.overrides?.primaryColor).toBe(CAPTION_COLOUR)
    expect(look.graphics.overrides?.['palette.accent']).toBe(ACCENT_COLOUR)
  })

  it('with the look: the caption colour in the top half, the accent in the bottom third, and the baker was handed the accent', () => {
    expect(runs.with.notes, 'the export’s onError').toEqual([])
    expect(accents, 'the accent each export’s graphic was baked in (without, then with)').toEqual([expect.not.stringMatching(new RegExp(`^${ACCENT_COLOUR}$`, 'i')), ACCENT_COLOUR])
    expect(runs.with.caption.top, `frame ${held}: pixels near ${CAPTION_COLOUR} in the top half (the look puts the captions at the top)`).toBeGreaterThan(ENOUGH)
    expect(runs.with.accent.bottomThird, `frame ${held}: pixels near ${ACCENT_COLOUR} in the bottom third (the lower third's bar)`).toBeGreaterThan(ENOUGH)
  })

  it('without the look: neither colour anywhere on the frame', () => {
    expect(runs.without.notes, 'the export’s onError').toEqual([])
    expect(runs.without.caption.all, `frame ${held}: pixels near ${CAPTION_COLOUR} with no look`).toBe(0)
    expect(runs.without.accent.all, `frame ${held}: pixels near ${ACCENT_COLOUR} with no look`).toBe(0)
  })

  it('writes the README', async () => {
    await writeNote(root, [
      '# look: a look applied, through the export',
      '',
      `A ${GREY} ${W}×${H} shot (grey.mp4, ${SECONDS} s at ${FPS} fps) with made-up words every 400 ms, captions on (a new project's style),`,
      'and the Library\'s lower third over it from frame 0, exported through bakeForExport, buildRenderPlan and the bundled ffmpeg,',
      'the captions burned by libass from main\'s prepareCaptions; the stand-in Bakers.graphic paints the real drawer\'s list (a shape in its fill, a word as a white box).',
      `The look: bold-center captions in ${CAPTION_COLOUR} at the top, neon graphics with the accent ${ACCENT_COLOUR}; written to its file's text and read back.`,
      '',
      'without-look/, with-look/: export.mp4, graph.txt, the PNG sequence, held-fNNN.png (the frame read)',
      '',
      `- frame ${held}, with the look: ${runs.with.caption.top} pixels near ${CAPTION_COLOUR} in the top half (${runs.with.caption.all} in all); ${runs.with.accent.bottomThird} near ${ACCENT_COLOUR} in the bottom third (${runs.with.accent.all} in all)`,
      `- frame ${held}, without: ${runs.without.caption.all} near ${CAPTION_COLOUR}, ${runs.without.accent.all} near ${ACCENT_COLOUR}`,
      `- the accents the baker was handed: ${JSON.stringify(accents)}`
    ])
  })
})
