import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { buildRenderPlan, type RenderRequest } from '@shared/render/plan'
import { buildGraphicsSpec, captionNeedsCanvas } from '@shared/graphics/fromTimeline'
import type { CaptionLayer } from '@shared/graphics/spec'
import { concatList, planBakeOf } from '@shared/captions/bake'
import { resolveStyle, type StyleOverrides } from '@shared/captions/style'
import { layoutText } from '@shared/render/textLayout'
import { animationBounds, textAnimationById } from '@shared/render/textAnimation'
import { followKeys } from '@shared/reframe/keys'
import { sourceToFrame } from '@shared/reframe/frameMap'
import { captionThirds, type Third } from '@shared/reframe/freeSpace'
import { SUBJECT_TRACK_VERSION, type SubjectTrack, type UnitRect } from '@shared/reframe/types'
import { emptyProject, type Clip, type MediaAsset, type Project, type TextSpec } from '@shared/timeline'
import { segmentIntoSentences, type Word } from '@shared/transcript'
import { clearCaptionFrames, prepareCaptions, writeCaptionFrame, writeCaptionList } from '../../src/main/captions'
import { ciNotice, oneLine } from './helperDiag'
import { FFMPEG, outputDir, run, saveFrame, writeNote } from './output'

/*
 * THE RENDER CHECK for Smart placement (docs/CLIPS.md §5.5), on BOTH caption
 * routes: the subject's face is in the lower third for shot 1 and the upper
 * third for shot 2, a white box is drawn into the source exactly where the
 * track says the face is, and every exported frame is read back — the
 * caption's yellow rows against the box's white rows.
 *
 * The media (made here): 1280×720, 30 fps, 6 s, lossless (x264 at qp 0), a
 * hard cut at 3 s (source frame 90) between two dark backgrounds, and in each
 * shot a white box filled where the face is (FACES, source px). The subject
 * track is written by hand, as a reframe would have stored it: two shots,
 * twelve samples (two a second), the one face of each shot in every sample.
 *
 * The projects, each through the app's own route:
 *
 *   9:16 (360×640)  the clip FOLLOWS its subject (§4.7: `clip.follow`, the
 *                   track in `Project.subjects`, the stored crop setAspect
 *                   writes): the export crops 404×720 around each shot's face,
 *                   stepping on the cut's frame, and fills the frame, so a
 *                   face's y is its own;
 *   16:9 (640×360)  a plain static crop (STATIC_CROP, 16:9, so it fills):
 *                   the box maps through the crop and `fitFor`.
 *
 *   libass          Pop with yellow text: main's `prepareCaptions`, which hands
 *                   buildTimelineCaptions the Smart placement lookup, writes
 *                   the .ass; the export burns it (`subtitlesPath`);
 *   canvas bake     the same plus a gradient look (`gradient-sunset`), so
 *                   `captionNeedsCanvas` sends it to the bake: buildGraphicsSpec
 *                   → planBakeOf → the pictures → main's writeCaptionFrame /
 *                   writeCaptionList → `captionOverlay`. The painting is the
 *                   one thing stood in (the renderer's canvas does not exist in
 *                   node): each picture is the block `layoutText` gives the
 *                   line — the placement rule drawTextOnto paints by — filled
 *                   yellow, and the band is measureBand's arithmetic over those
 *                   blocks. So the spec's third, its position and offset, the
 *                   band and the overlay are the app's; the glyphs are not.
 *
 * Each with Pop at the bottom (its own) and Pop moved to the top, each with
 * placement 'smart' and with it absent (the CONTROL: the captions sit at the
 * style's position, and on the box in the face's shot — so the check can tell
 * a caption that moved from one that never had to). And one bare render per
 * aspect (captions off): the box's rows on each frame, read off the export,
 * which is what every captioned frame is compared against.
 *
 * Seven lines (LINES), about one every 0.8 s, four in shot 1 and three in
 * shot 2, two of them a few frames from the cut and none across it (a line
 * that spans it takes the shot where it starts, §5.2 rule 4, which lane B's
 * captions.int checks: here every frame of a line is on its own shot). The
 * clip sits at timeline frame 12 and plays from in-point 6, so the caption
 * clock and the picture's are both offset.
 *
 * What is asserted, on every exported frame of every smart render: no yellow
 * row inside the box's rows; each line's centre in the third worked out by
 * hand below (EXPECTED) — never the face's own; every line on screen. Artefacts, the .ass
 * files and README.txt in tests/output/captions-free/.
 *
 * On the Windows build (CI) nothing here is new to the 2018-12-17 floor:
 * per-event \an and MarginV are core ASS, and drawbox, concat, the ass filter
 * and the overlay all run in other checks there. That folder is not among
 * CI's artifacts, so a failure's message carries what it needs on one line
 * (the rows of every line, the box's, the .ass events or the bake's band:
 * `why`), and one notice per run publishes the measured rows (`ciNotice`).
 */

const FPS = 30
const SRC = { width: 1280, height: 720 }
/** The cut: source frame 90, 3.000 s. */
const CUT_MS = 3000
const SOURCE_MS = 6000
const START = 12
const IN = 6
const DURATION = 174
/** The clip's in-point in source ms. */
const IN_MS = (IN * 1000) / FPS
/** Timeline frames of each shot: [from, to). */
const SHOT_FRAMES: [number, number][] = [
  [START, START + Math.round(((CUT_MS - IN_MS) * FPS) / 1000)],
  [START + Math.round(((CUT_MS - IN_MS) * FPS) / 1000), START + DURATION]
]

/**
 * Each shot's face, in source px — where the box is drawn and what the track
 * says (to 4 dp of the frame, as a track stores it). Shot 1's sits in the
 * lower third, shot 2's in the upper; different x, so the followed crop jumps
 * at the cut. Each box's edge is at least 2 % of the OUTPUT frame clear of a
 * third's boundary at both aspects (9:16 rows 444–569 and 57–196 of 640,
 * against 426.7 and 213.3; 16:9 rows 258–336 and 16–102 of 360, against 240
 * and 120), so neither a scaler's rounding nor the type moves which third the
 * box is in.
 */
const FACES = [
  { x: 384, y: 500, width: 192, height: 140 },
  { x: 704, y: 64, width: 192, height: 156 }
] as const
const BACKGROUNDS = ['0x203040', '0x402818'] as const
const ASPECTS = { '9x16': { width: 360, height: 640 }, '16x9': { width: 640, height: 360 } } as const
type Aspect = keyof typeof ASPECTS
/** The 16:9 clip's static crop: 16:9 itself, so it fills the frame; y maps as (y − 36) / 648. */
const STATIC_CROP = { x: 64, y: 36, width: 1152, height: 648 }
const YELLOW = '#FFFF00'
const GRADIENT_LOOK = 'gradient-sunset'

/**
 * The lines: two short words or one, 200 ms a word, sentences so each is one
 * line. Two words, not three, so that no face libass may fall back to wraps
 * one at 360 wide: the bundled fonts (assets/fonts) are not in the
 * repository — `/assets` is gitignored — so on CI libass never sees Anton
 * and draws Pop in a system face, and a three-word line of lane B's wrapped
 * into two there (captions.int, run 38986994729: rows 409–498 for 469–498
 * here). The fourth and fifth sit a few frames either side of the
 * cut (timeline 89–95 and 98–110, the cut on 96): a line asked about on the
 * wrong clock — the source's own ms, say, not the clip's — lands in the other
 * shot. Every time is a whole frame or 0.8 of the way to the next (after the
 * in-point's 200 ms), never half of one, so no rounding tie decides a line's
 * frames.
 */
const LINES = [
  { start: 300, words: ['We', 'go.'] },
  { start: 1100, words: ['It', 'is.'] },
  { start: 1900, words: ['So', 'do.'] },
  { start: 2760, words: ['Yes.'] },
  { start: 3060, words: ['Up', 'to.'] },
  { start: 4000, words: ['Do', 'it.'] },
  { start: 4800, words: ['Go', 'on.'] }
] as const
const WORD_MS = 200
const WORDS: Word[] = LINES.flatMap((line) => line.words.map((text, i) => ({ text, startMs: line.start + i * WORD_MS, endMs: line.start + (i + 1) * WORD_MS }))).map(
  (w, index) => ({ ...w, index, confidence: 0.9 })
)
/** A line's shot: 0 before the cut, 1 after. */
const shotOfLine = (l: number): 0 | 1 => (LINES[l].start < CUT_MS ? 0 : 1)
/** Timeline frame of source ms on the caption clock (no speed here: the picture's clock too). */
const frameOfMs = (ms: number): number => START + Math.round(((ms - IN_MS) * FPS) / 1000)
/** Each line's frames on the timeline, [from, to). */
const LINE_FRAMES: [number, number][] = LINES.map((line) => [frameOfMs(line.start), frameOfMs(line.start + line.words.length * WORD_MS)])

type Position = 'bottom' | 'top'
/** The face's own third, per shot — where no caption may be. */
const FACE_THIRD: [Third, Third] = ['bottom', 'top']
/**
 * Where each shot's lines go under Smart placement, worked out by hand from
 * §5.2's rules (not from freeSpace.ts) — the face extended down by half its
 * height, the share of each third it covers, at both aspects:
 *
 * - shot 1, face y 500–640 px, extended to 710: wholly in the lower third
 *   (9:16 0.69–0.99 of the frame, 47 % of its width: 0.42 of the third;
 *   16:9 0.72–1.0, 17 % wide: 0.14). Pop at the bottom exceeds 0.05 and moves;
 *   the middle and the top are both 0, and the tie goes to the nearer, the
 *   middle. Pop at the top covers nothing and stays.
 * - shot 2, face y 64–220, extended to 298: 9:16 0.089–0.41 (top 0.35, middle
 *   0.11, bottom 0); 16:9 0.043–0.40 (top 0.15, middle 0.04, bottom 0). Pop at
 *   the top exceeds 0.05 and moves to the least covered, the bottom (0 is
 *   within half of the top's). Pop at the bottom covers nothing and stays.
 */
const EXPECTED: Record<Position, [Third, Third]> = { bottom: ['middle', 'bottom'], top: ['top', 'bottom'] }

type Route = 'libass' | 'canvas'
interface Case {
  aspect: Aspect
  route: Route
  position: Position
  smart: boolean
}
const caseName = (c: Case): string => `${c.aspect}-${c.route}-${c.position}-${c.smart ? 'smart' : 'control'}`

let dir = ''
let source = ''
const savedUserData = process.env.FORGE_TEST_USERDATA
const savedFontsDir = process.env.FORGE_FONTS_DIR
const notes: string[] = []
const summary: string[] = []

/* ------------------------------------------------------------------ media */

/** A face box as the track stores it: shares of the upright frame, 4 dp. */
function unit(face: { x: number; y: number; width: number; height: number }): UnitRect {
  const dp = (v: number): number => Number(v.toFixed(4))
  return { x: dp(face.x / SRC.width), y: dp(face.y / SRC.height), width: dp(face.width / SRC.width), height: dp(face.height / SRC.height) }
}

function track(): SubjectTrack {
  return {
    key: 'hand-built:captions-free',
    version: SUBJECT_TRACK_VERSION,
    width: SRC.width,
    height: SRC.height,
    durationMs: SOURCE_MS,
    shots: [
      { startMs: 0, endMs: CUT_MS, score: 0 },
      { startMs: CUT_MS, endMs: SOURCE_MS, score: 0.9 }
    ],
    samples: Array.from({ length: SOURCE_MS / 500 }, (_, i) => ({
      ms: i * 500,
      faces: [{ ...unit(FACES[i * 500 < CUT_MS ? 0 : 1]), score: 0.9 }]
    })),
    perShot: [{}, {}],
    detector: 'hand-built (no detector)',
    scene: { threshold: 0.3, minShotMs: 500, backend: 'ffmpeg-select-rgb24' },
    at: '2026-10-16T00:00:00.000Z'
  }
}

/* --------------------------------------------------------------- projects */

function projectFor(aspect: Aspect, captions: Project['captions']): { project: Project; clip: Clip } {
  const canvas = ASPECTS[aspect]
  const asset: MediaAsset = {
    id: 'v', path: source, name: 'faces.mp4', kind: 'video', durationFrames: (SOURCE_MS * FPS) / 1000,
    width: SRC.width, height: SRC.height, fps: FPS, hasVideo: true, hasAudio: false, size: 0
  }
  const clip: Clip = {
    id: 'c', assetId: 'v', trackId: 'v1', start: START, duration: DURATION, inPoint: IN, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 }
  }
  const base: Project = {
    ...emptyProject(),
    settings: { width: canvas.width, height: canvas.height, fps: FPS, sampleRate: 48000 },
    tracks: [{ id: 'v1', kind: 'video', name: 'V1', muted: false, hidden: false, locked: false }],
    assets: [asset],
    clips: [clip],
    subjects: { v: track() },
    transcripts: { v: { assetId: 'v', language: 'en', model: 'test', durationMs: SOURCE_MS, words: WORDS, segments: segmentIntoSentences(WORDS) } },
    captions
  }
  if (aspect === '16x9') {
    const cropped: Clip = { ...clip, crop: STATIC_CROP }
    return { project: { ...base, clips: [cropped] }, clip: cropped }
  }
  // What setAspect stores on a followed clip: `follow`, and the size at its first frame's place (§4.7).
  const followed: Clip = { ...clip, follow: { version: 1 } }
  const keys = followKeys({ ...base, clips: [followed] }, followed, FPS)
  if (!keys) throw new Error('the 9:16 clip compiles no followed crop')
  const stored: Clip = { ...followed, crop: keys.crop }
  return { project: { ...base, clips: [stored] }, clip: stored }
}

function overridesFor(route: Route, position: Position): StyleOverrides {
  return {
    primaryColor: YELLOW,
    highlightColor: YELLOW,
    ...(position === 'top' ? { position: 'top' as const } : {}),
    ...(route === 'canvas' ? { textStyleId: GRADIENT_LOOK } : {})
  }
}

function caseProject(c: Case): { project: Project; clip: Clip } {
  return projectFor(c.aspect, {
    enabled: true,
    styleId: 'pop',
    overrides: overridesFor(c.route, c.position) as Record<string, unknown>,
    ...(c.smart ? { placement: 'smart' as const } : {})
  })
}

/* ------------------------------------------------- the canvas bake, stood in */

/** The rows and columns `layoutText` gives a line: its block, where drawTextOnto paints one row of type. */
function blockOf(spec: TextSpec, canvas: { width: number; height: number }): { top: number; bottom: number; left: number; right: number } {
  const layout = layoutText(spec, canvas.width, canvas.height)
  return {
    top: Math.round(layout.top),
    bottom: Math.round(layout.top + layout.blockHeight),
    left: layout.marginX,
    right: canvas.width - layout.marginX
  }
}

/**
 * How far above the block the REAL painter's ink reaches, as a share of the
 * font size. Measured in the harness 2026-10-16 (not in node: drawTextOnto
 * needs a canvas): each spec here painted by drawTextOnto onto a canvas with
 * Anton loaded from assets/fonts, word 0 lit as measureBand paints it, ink
 * where alpha > 4. At 360×640 (fontPx 50) the ink began 15 rows (plain Pop)
 * and 16 (gradient-sunset) above the block's top, in every third; at 640×360
 * (fontPx 28) 8 and 9. Its bottom was 3–11 rows inside the block's. So a real
 * paint covers the stand-in's rows and up to 0.32 of the font size above
 * them. README's "closest" figures take it into account for the canvas
 * cases: how near a real paint of each line would come to the box.
 */
const INK_OVERHANG = 0.33

/** renderer/captionBake.ts measureBand's arithmetic, over the stand-in's ink (the blocks). */
function bandOf(layers: CaptionLayer[], canvas: { width: number; height: number }): { y: number; height: number } {
  let top = canvas.height
  let bottom = 0
  for (const layer of layers) {
    const ink = blockOf(layer.spec, canvas)
    const fontPx = layoutText(layer.spec, canvas.width, canvas.height).fontPx
    const animation = textAnimationById(layer.spec.animationId)
    const bounds = animation ? animationBounds(animation) : { dx: 0, dy: 0, scale: 1 }
    const room = Math.ceil(fontPx * (bounds.dy + (bounds.scale - 1) * 0.6))
    top = Math.min(top, ink.top - room)
    bottom = Math.max(bottom, ink.bottom - 1 + room)
  }
  const y = Math.max(0, Math.floor(Math.max(0, top) / 2) * 2)
  const end = Math.min(canvas.height, Math.ceil(Math.min(canvas.height, bottom + 1) / 2) * 2)
  return { y, height: Math.max(2, end - y) }
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(bytes: Buffer): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
/** A band-sized RGBA PNG, transparent but for an opaque yellow block (band rows). */
function bandPicture(width: number, height: number, block: { top: number; bottom: number; left: number; right: number } | null): Buffer {
  const row = 1 + width * 4
  const raw = Buffer.alloc(row * height)
  if (block) {
    for (let y = Math.max(0, block.top); y < Math.min(height, block.bottom); y++) {
      for (let x = block.left; x < block.right; x++) raw.set([255, 255, 0, 255], y * row + 1 + x * 4)
    }
  }
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
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

interface Bake {
  listPath: string
  y: number
  height: number
  /** The lines' font size in px (one style, one size). */
  fontPx: number
  /** Each layer's frames and the block it was painted as, for the README. */
  layers: { startFrame: number; endFrame: number; position: TextSpec['position']; block: { top: number; bottom: number } }[]
}

/** The renderer's bakeCaptions, its painting stood in: the app's spec, plan, files and list. */
async function bake(project: Project, canvas: { width: number; height: number }, name: string): Promise<Bake> {
  const spec = buildGraphicsSpec(project, canvas)
  const baked = spec ? planBakeOf(spec) : null
  if (!baked) throw new Error(`${name}: nothing to bake`)
  const band = bandOf(baked.layers, canvas)
  const blocks = baked.layers.map((l) => blockOf(l.spec, canvas))
  await clearCaptionFrames()
  const files: string[] = []
  for (const [i, picture] of baked.plan.pictures.entries()) {
    const b = picture.layer < 0 ? null : blocks[picture.layer]
    files.push(await writeCaptionFrame(i, bandPicture(canvas.width, band.height, b && { ...b, top: b.top - band.y, bottom: b.bottom - band.y })))
  }
  const listPath = await writeCaptionList(concatList(baked.plan, (q) => files[q]))
  await copyFile(listPath, join(dir, `${name}-list.txt`))
  return {
    listPath,
    y: band.y,
    height: band.height,
    fontPx: layoutText(baked.layers[0].spec, canvas.width, canvas.height).fontPx,
    layers: baked.layers.map((l, i) => ({ startFrame: l.startFrame, endFrame: l.endFrame, position: l.spec.position, block: { top: blocks[i].top, bottom: blocks[i].bottom - 1 } }))
  }
}

/* ------------------------------------------------------------- reading */

/** Per frame and row: how many pixels are the caption's yellow, and how many the box's white. */
interface FrameRows {
  yellow: Uint16Array
  white: Uint16Array
}
/** A row is the caption's with this many yellow pixels, the box's with this many white ones. */
const YELLOW_MIN = 3
const WHITE_MIN = 20

/**
 * Every frame of the export, in order (`-vsync passthrough`: the n-th frame
 * out is timeline frame n), as yuv420p, each pixel read with its chroma
 * sample: yellow is bright with almost no blue-difference (Y > 150, U < 80:
 * yellow is Y 210–219, U 16), white bright and neutral (Y > 200, U and V
 * within 18 of 128). The backgrounds are dark (Y ≈ 55), the outline black.
 */
async function readRows(file: string, size: { width: number; height: number }): Promise<FrameRows[]> {
  const { width, height } = size
  const ys = width * height
  const frameBytes = ys + 2 * (width / 2) * (height / 2)
  const frames: FrameRows[] = []
  const reduce = (buf: Buffer): FrameRows => {
    const yellow = new Uint16Array(height)
    const white = new Uint16Array(height)
    const cw = width / 2
    for (let y = 0; y < height; y++) {
      const crow = (y >> 1) * cw
      for (let x = 0; x < width; x++) {
        const Y = buf[y * width + x]
        const U = buf[ys + crow + (x >> 1)]
        const V = buf[ys + cw * (height / 2) + crow + (x >> 1)]
        if (Y > 150 && U < 80) yellow[y]++
        else if (Y > 200 && Math.abs(U - 128) < 18 && Math.abs(V - 128) < 18) white[y]++
      }
    }
    return { yellow, white }
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      FFMPEG,
      ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-vsync', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    )
    let stderr = ''
    let pending = Buffer.alloc(0)
    child.stderr.on('data', (d) => (stderr += String(d)))
    child.stdout.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk])
      let at = 0
      while (pending.length - at >= frameBytes) {
        frames.push(reduce(pending.subarray(at, at + frameBytes)))
        at += frameBytes
      }
      pending = Buffer.from(pending.subarray(at))
    })
    child.on('close', (code) => (code === 0 ? resolvePromise(frames) : reject(new Error(`decoding ${file} failed (${code}): ${stderr}`))))
  })
}

interface Span {
  top: number
  bottom: number
}
const spanOf = (counts: Uint16Array, min: number): Span | null => {
  let top = -1
  let bottom = -1
  counts.forEach((n, y) => {
    if (n >= min) {
      if (top < 0) top = y
      bottom = y
    }
  })
  return top < 0 ? null : { top, bottom }
}
/**
 * The third a caption's rows are in, by their CENTRE: a moved caption moves
 * its centre a whole third, while its height is the font's — and on CI the
 * font is a fallback (LINES' note), taller than Anton, whose rows may cross a
 * boundary a centre never does. Whether a caption touches the box is read
 * row by row (`onBox`), not from this.
 */
const thirdOf = (s: Span, height: number): Third => {
  const mid = (s.top + s.bottom) / 2
  return mid < height / 3 ? 'top' : mid < (2 * height) / 3 ? 'middle' : 'bottom'
}
/** The box is media, not type: it lies wholly inside one third, or this says so. */
const boxThird = (s: Span, height: number): Third | 'across' =>
  s.bottom < height / 3 ? 'top' : s.top >= height / 3 && s.bottom < (2 * height) / 3 ? 'middle' : s.top >= (2 * height) / 3 ? 'bottom' : 'across'
/** The caption's yellow rows that fall inside the box's rows on one frame. */
const onBox = (f: FrameRows, box: Span | null): number[] => {
  if (!box) return []
  const hit: number[] = []
  for (let y = box.top; y <= box.bottom; y++) if (f.yellow[y] >= YELLOW_MIN) hit.push(y)
  return hit
}
/** A line's frames to judge: its own, less one at each end (a cue's centisecond edge, the bake's frame). */
const inside = (l: number): number[] => {
  const [from, to] = LINE_FRAMES[l]
  return Array.from({ length: to - from - 2 }, (_, i) => from + 1 + i)
}

/** An .ass file's events, one line: each cue's time, MarginV and override tag. */
function assEvents(text: string): string {
  return text
    .split('\n')
    .filter((l) => l.startsWith('Dialogue:'))
    .map((l) => {
      const f = l.slice('Dialogue: '.length).split(',')
      const body = f.slice(9).join(',')
      const tag = /^\{\\an\d\}/.exec(body)?.[0] ?? '-'
      return `${f[1]}-${f[2]} mv${f[7]} ${tag}`
    })
    .join(' | ')
}

/* ----------------------------------------------------------- rendering */

interface Rendered {
  name: string
  file: string
  frames: FrameRows[]
  /** The .ass the libass route burned (its events, one line), or the bake's band and blocks. */
  ass?: string
  bake?: Bake
  /** Per line: the caption's rows over its frames (min top, max bottom), and the third of each frame. */
  lines: { span: Span | null; thirds: (Third | 'none')[] }[]
  seconds: number
}

const bare = new Map<Aspect, FrameRows[]>()
const rendered = new Map<string, Promise<Rendered>>()
/** The renders that finished, by name, for README's table. */
const done = new Map<string, Rendered>()
const fontsDir = resolve(__dirname, '../../assets/fonts')
/** Whether libass can find Pop's own face here: assets/ is not in the repository, so not on CI. */
const anton = existsSync(join(fontsDir, 'Anton-Regular.ttf'))

async function renderCase(c: Case): Promise<Rendered> {
  const name = caseName(c)
  const canvas = ASPECTS[c.aspect]
  const { project } = caseProject(c)
  const style = resolveStyle('pop', overridesFor(c.route, c.position))
  // The route the app takes (ExportStrip: captionNeedsCanvas → the bake; otherwise main's prepareCaptions).
  expect(captionNeedsCanvas(style), `${name}: the route`).toBe(c.route === 'canvas')
  const out = join(dir, `${name}.mp4`)
  const began = performance.now()
  // Each case's own userData (main's .ass, the bake's pictures and list): nothing a case reads is another's, and each is kept to look at.
  process.env.FORGE_TEST_USERDATA = join(dir, 'userData', name)
  let request: Partial<RenderRequest> = {}
  let ass: string | undefined
  let baked: Bake | undefined
  let cleanup = async (): Promise<void> => undefined
  if (c.route === 'libass') {
    const prepared = await prepareCaptions(project, canvas)
    if (!prepared) throw new Error(`${name}: prepareCaptions burned nothing`)
    cleanup = prepared.cleanup
    await copyFile(prepared.subtitlesPath, join(dir, `${name}.ass`))
    ass = assEvents(await readFile(prepared.subtitlesPath, 'utf8'))
    request = { subtitlesPath: prepared.subtitlesPath, fontsDir: prepared.fontsDir }
  } else {
    baked = await bake(project, canvas, name)
    request = { captionOverlay: { listPath: baked.listPath, y: baked.y, height: baked.height } }
  }
  const plan = buildRenderPlan({ project, outputPath: out, canvas, ...request })
  await writeFile(join(dir, `${name}-args.txt`), `${plan.args.join('\n')}\n`)
  await run(FFMPEG, plan.args, { maxBuffer: 64 * 1024 * 1024 })
  await cleanup()
  const frames = await readRows(out, canvas)
  const seconds = (performance.now() - began) / 1000
  const lines = LINES.map((_, l) => {
    let span: Span | null = null
    const thirds = inside(l).map((f) => {
      const s = frames[f] ? spanOf(frames[f].yellow, YELLOW_MIN) : null
      if (!s) return 'none' as const
      span = span ? { top: Math.min(span.top, s.top), bottom: Math.max(span.bottom, s.bottom) } : s
      return thirdOf(s, canvas.height)
    })
    return { span: span as Span | null, thirds }
  })
  // A frame of each line beside the render, to look at.
  for (const [l, [from, to]] of LINE_FRAMES.entries()) await saveFrame(out, (Math.floor((from + to) / 2) + 0.5) / FPS, join(dir, `${name}-line${l + 1}.png`))
  const r: Rendered = { name, file: out, frames, ass, bake: baked, lines, seconds }
  const box = bare.get(c.aspect)!
  const fmt = (s: Span | null): string => (s ? `${s.top}–${s.bottom}` : 'none')
  /** The fewest rows between a caption and the box on any frame (0 when they meet), its top raised by `above` rows. */
  const closest = (above: number): number =>
    Math.min(
      ...frames.flatMap((f, i) => {
        const s = spanOf(f.yellow, YELLOW_MIN)
        const b = box[i] ? spanOf(box[i].white, WHITE_MIN) : null
        return s && b ? [Math.max(0, s.top - above - b.bottom - 1, b.top - s.bottom - 1)] : []
      })
    )
  const real = baked ? Math.ceil(INK_OVERHANG * baked.fontPx) : 0
  notes.push(
    `- ${name}: ${frames.length} frames read in ${seconds.toFixed(1)} s; lines ${lines.map((x, l) => `L${l + 1} ${fmt(x.span)} ${[...new Set(x.thirds)].join('/')}`).join(', ')}` +
      `; on the box: ${frames.filter((f, i) => onBox(f, box[i] ? spanOf(box[i].white, WHITE_MIN) : null).length > 0).length} frames` +
      `, closest ${closest(0)} rows${baked ? ` (a real paint, ${real} rows higher: ${closest(real)})` : ''}` +
      (baked ? `; band y ${baked.y} h ${baked.height}, blocks ${baked.layers.map((x) => `${x.startFrame}-${x.endFrame} ${x.position} ${x.block.top}–${x.block.bottom}`).join(', ')}` : '')
  )
  summary.push(`${name}: ${lines.map((x) => fmt(x.span)).join(' ')}`)
  done.set(name, r)
  return r
}

function renderedCase(c: Case): Promise<Rendered> {
  const name = caseName(c)
  let p = rendered.get(name)
  if (!p) {
    p = renderCase(c)
    rendered.set(name, p)
  }
  return p
}

/** One line of what a failure needs: the rows of every line, the box's, and the .ass events or the bake's band. */
function why(r: Rendered, aspect: Aspect, extra = ''): string {
  const box = bare.get(aspect)!
  const fmt = (s: Span | null): string => (s ? `${s.top}-${s.bottom}` : 'none')
  const boxes = SHOT_FRAMES.map(([from, to]) => fmt(box[Math.floor((from + to) / 2)] ? spanOf(box[Math.floor((from + to) / 2)].white, WHITE_MIN) : null))
  return oneLine(
    `${r.name} (${process.platform}, Anton ${anton ? 'present' : 'absent'}): lines ${r.lines.map((x, l) => `L${l + 1} ${fmt(x.span)} [${[...new Set(x.thirds)].join('/')}]`).join(', ')}; ` +
      `box shot1 ${boxes[0]} shot2 ${boxes[1]}; ${extra}` +
      (r.ass ? ` ASS events: ${r.ass}` : '') +
      (r.bake ? ` bake band y ${r.bake.y} h ${r.bake.height}, layers ${r.bake.layers.map((x) => `${x.startFrame}-${x.endFrame} ${x.position} ${x.block.top}-${x.block.bottom}`).join(', ')}` : ''),
    1800
  )
}

/* ---------------------------------------------------------------- setup */

beforeAll(async () => {
  dir = await outputDir('captions-free')
  // main's caption files (the .ass, the bake's pictures and list) land in <dir>/userData/<case>; libass's fonts are the bundled ones.
  process.env.FORGE_TEST_USERDATA = join(dir, 'userData')
  process.env.FORGE_FONTS_DIR = fontsDir
  const media = join(dir, 'media')
  await mkdir(media, { recursive: true })
  source = join(media, 'faces.mp4')
  const shot = (i: 0 | 1): string => {
    const f = FACES[i]
    return `color=c=${BACKGROUNDS[i]}:s=${SRC.width}x${SRC.height}:r=${FPS}:d=${CUT_MS / 1000},drawbox=x=${f.x}:y=${f.y}:w=${f.width}:h=${f.height}:color=white:t=fill[s${i}]`
  }
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-filter_complex', `${shot(0)};${shot(1)};[s0][s1]concat=n=2:v=1:a=0[v]`,
    '-map', '[v]', '-c:v', 'libx264', '-qp', '0', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source
  ])
  // The bare renders: the box's rows on every frame, the yardstick every captioned frame is read against.
  for (const aspect of Object.keys(ASPECTS) as Aspect[]) {
    const { project } = projectFor(aspect, { enabled: false, styleId: 'pop' })
    const out = join(dir, `${aspect}-bare.mp4`)
    await run(FFMPEG, buildRenderPlan({ project, outputPath: out, canvas: ASPECTS[aspect] }).args, { maxBuffer: 64 * 1024 * 1024 })
    bare.set(aspect, await readRows(out, ASPECTS[aspect]))
  }
}, 300_000)

afterAll(async () => {
  if (savedUserData === undefined) delete process.env.FORGE_TEST_USERDATA
  else process.env.FORGE_TEST_USERDATA = savedUserData
  if (savedFontsDir === undefined) delete process.env.FORGE_FONTS_DIR
  else process.env.FORGE_FONTS_DIR = savedFontsDir
  if (!dir) return
  const fmt = (s: Span | null): string => (s ? `${s.top}–${s.bottom}` : 'none')
  const boxLines = (Object.keys(ASPECTS) as Aspect[]).map((aspect) => {
    const rows = bare.get(aspect)
    if (!rows) return `- ${aspect}: not rendered`
    return `- ${aspect} (${ASPECTS[aspect].width}×${ASPECTS[aspect].height}): box rows ${SHOT_FRAMES.map(([from, to], s) => `shot ${s + 1} ${fmt(rows[Math.floor((from + to) / 2)] ? spanOf(rows[Math.floor((from + to) / 2)].white, WHITE_MIN) : null)}`).join(', ')}`
  })
  const span = (name: string, lines: number[]): string => {
    const spans = lines.map((l) => done.get(name)?.lines[l].span).filter((x): x is Span => !!x)
    return spans.length ? `${Math.min(...spans.map((x) => x.top))}–${Math.max(...spans.map((x) => x.bottom))}` : 'not rendered'
  }
  const shot1 = LINES.flatMap((_, l) => (shotOfLine(l) === 0 ? [l] : []))
  const shot2 = LINES.flatMap((_, l) => (shotOfLine(l) === 1 ? [l] : []))
  const perThird = (Object.keys(ASPECTS) as Aspect[]).flatMap((aspect) =>
    (['libass', 'canvas'] as const).map(
      (route) =>
        `- ${aspect} (${ASPECTS[aspect].width}×${ASPECTS[aspect].height}) ${route === 'libass' ? 'libass' : 'canvas stand-in'}: top ${span(`${aspect}-${route}-top-smart`, shot1)}, ` +
        `middle ${span(`${aspect}-${route}-bottom-smart`, shot1)}, bottom ${span(`${aspect}-${route}-bottom-smart`, shot2)}`
    )
  )
  /*
   * The plan's table beside Pop's 16:9 libass rows: the middle centred on
   * PlayResY/2 = 180, the top's first row so far below MarginV, the bottom's
   * last so far above it — the glyphs' own padding, the face's (Anton here,
   * a fallback where assets/ is absent).
   */
  const rowsOf = (name: string, lines: number[]): Span | null => {
    const spans = lines.map((l) => done.get(name)?.lines[l].span).filter((x): x is Span => !!x)
    return spans.length ? { top: Math.min(...spans.map((x) => x.top)), bottom: Math.max(...spans.map((x) => x.bottom)) } : null
  }
  const H16 = ASPECTS['16x9'].height
  const MARGIN_16 = Math.round((220 * H16) / 1080)
  const top16 = rowsOf('16x9-libass-top-smart', shot1)
  const mid16 = rowsOf('16x9-libass-bottom-smart', shot1)
  const low16 = rowsOf('16x9-libass-bottom-smart', shot2)
  const againstPlan =
    top16 && mid16 && low16
      ? [
          `Here Pop is Fontsize ${Math.round((84 * H16) / 1080)} at ${H16} tall, MarginV ${MARGIN_16} (220 of 1080), in ${anton ? 'Anton' : 'a fallback face'}. \\an5 centres on`,
          `PlayResY/2 = ${H16 / 2}: the plan's 167–191 on 179, Pop's ${mid16.top}–${mid16.bottom} on ${(mid16.top + mid16.bottom) / 2}. Under \\an8 the plan's first row is 6 below`,
          `its MarginV 20, Pop's ${top16.top - MARGIN_16} below ${MARGIN_16} (${top16.top}–${top16.bottom}); at the bottom the plan's last row is 8 above MarginV 20 from the edge`,
          `(332 = 360 − 20 − 8), Pop's ${H16 - MARGIN_16 - low16.bottom} above ${MARGIN_16} (${low16.top}–${low16.bottom}).`
        ]
      : ['(the 16:9 libass renders did not all finish)']
  await writeNote(dir, [
    '# captions-free — Smart placement, rendered on both caption routes (docs/CLIPS.md §5.5)',
    '',
    `ffmpeg ${FFMPEG} (${process.platform}).`,
    `Media: media/faces.mp4, ${SRC.width}×${SRC.height} ${FPS} fps ${SOURCE_MS / 1000} s, x264 qp 0, cut at ${CUT_MS / 1000} s; shot 1 on ${BACKGROUNDS[0]} with a white box at`,
    `${JSON.stringify(FACES[0])} (lower third), shot 2 on ${BACKGROUNDS[1]} with it at ${JSON.stringify(FACES[1])} (upper third) — the track's faces exactly.`,
    `Clip at timeline frame ${START}, in-point ${IN}, ${DURATION} frames: shot 1 is timeline ${SHOT_FRAMES[0].join('–')}, shot 2 ${SHOT_FRAMES[1].join('–')} ([from, to)).`,
    `Lines (Pop, ${LINES.length} sentences of two words or one, yellow ${YELLOW}): timeline frames ${LINE_FRAMES.map(([a, b]) => `${a}–${b}`).join(', ')}.`,
    '9x16: 360×640, the clip follows its subject (a 405×720 crop on each face). 16x9: 640×360, static crop 1152×648 at (64, 36).',
    'libass: main prepareCaptions → the .ass (copied here as <case>.ass) → subtitlesPath. canvas: Pop + gradient-sunset → buildGraphicsSpec →',
    'planBakeOf → stand-in pictures (each line the yellow block layoutText gives it) in measureBand\'s band → captionOverlay.',
    'Read: every frame of each export in order; a row is the caption\'s with ≥ 3 yellow pixels (Y > 150, U < 80), the box\'s with ≥ 20',
    'white ones (Y > 200, U and V within 18 of 128), taken from the bare render (captions off) of the same aspect. Lines judged on their',
    'frames less one at each end; a span is the min top and max bottom over them, its third read by its centre.',
    `Fonts: ${fontsDir} ${anton ? 'holds Anton' : 'has no Anton (as on CI: /assets is gitignored), so libass drew a fallback face'}.`,
    '',
    '## The box, from the bare renders',
    ...boxLines,
    '',
    '## Each render (rows are the caption\'s yellow rows over each line\'s frames)',
    ...notes,
    '',
    '## The caption\'s rows in each third, on this machine (Pop; the union over the lines that third holds)',
    ...perThird,
    '',
    '## Against the plan\'s table (§5.4: 640×360, PlayResY 360, a style with MarginV 20, measured by the plan)',
    'Plan: bottom (MarginV 20) 306–332; \\an8 26–52; \\an5 167–191; per-event MarginV 90 236–262.',
    ...againstPlan,
    '',
    '## The stand-in against the real painter (harness, 2026-10-16; not re-run by this test)',
    'drawTextOnto on a canvas, Anton from assets/fonts, word 0 lit (as measureBand paints), ink where alpha > 4, the same specs:',
    '- 360×640 (fontPx 50): plain top 115–177, middle 276–338, bottom 436–498; gradient-sunset 114–183, 275–344, 435–504;',
    '  layoutText blocks 130–188, 291–349, 451–509.',
    '- 640×360 (fontPx 28): plain 65–99, 155–189, 246–280; gradient-sunset 64–102, 154–192, 245–283; blocks 73–105, 163–195, 254–286.',
    `So the real ink begins up to 0.32 of the font size above the block and ends inside it: each canvas case's "closest" above also`,
    `says how near a real paint would come, its top raised by ${INK_OVERHANG} of the font size.`
  ])
  if (summary.length) ciNotice('captionsFree: caption rows', oneLine(`${process.platform}, Anton ${anton ? 'present' : 'absent'}; ${boxLines.join('; ')}; ${summary.join('; ')}`, 3800))
})

/* ---------------------------------------------------------------- checks */

describe('the fixture: the box is where the track says, on the output frame', () => {
  for (const aspect of Object.keys(ASPECTS) as Aspect[]) {
    it(`${aspect}: the box's rows read off the bare render are where frameMap maps the face`, () => {
      const rows = bare.get(aspect)!
      const { project, clip } = projectFor(aspect, { enabled: false, styleId: 'pop' })
      const canvas = ASPECTS[aspect]
      expect(rows.length, 'every frame of the timeline').toBe(START + DURATION)
      for (const [s, [from, to]] of SHOT_FRAMES.entries()) {
        for (const f of [from + 2, Math.floor((from + to) / 2), to - 2]) {
          const read = spanOf(rows[f].white, WHITE_MIN)
          const mapped = sourceToFrame(project, clip, project.assets[0], canvas, f, unit(FACES[s]))
          expect(read, `${aspect} frame ${f}: the box is on screen`).not.toBeNull()
          expect(mapped, `${aspect} frame ${f}: frameMap puts the face on screen`).not.toBeNull()
          const want = { top: mapped!.y * canvas.height, bottom: (mapped!.y + mapped!.height) * canvas.height - 1 }
          const where = `${aspect} shot ${s + 1} frame ${f}: read ${read!.top}–${read!.bottom}, mapped ${want.top.toFixed(1)}–${want.bottom.toFixed(1)}`
          expect(Math.abs(read!.top - want.top), where).toBeLessThanOrEqual(2)
          expect(Math.abs(read!.bottom - want.bottom), where).toBeLessThanOrEqual(2)
          // In the face's own third, so a caption at the style's position there has to move.
          expect(boxThird(read!, canvas.height), where).toBe(FACE_THIRD[s])
        }
      }
      // No caption here: nothing yellow anywhere.
      expect(rows.filter((f) => spanOf(f.yellow, YELLOW_MIN)).length, `${aspect}: yellow in the bare render`).toBe(0)
    })
  }

  it('the thirds freeSpace.ts works out are the ones worked out by hand', () => {
    for (const aspect of Object.keys(ASPECTS) as Aspect[]) {
      for (const position of ['bottom', 'top'] as const) {
        const { project } = caseProject({ aspect, route: 'libass', position, smart: true })
        const thirds = captionThirds(project, { position }, ASPECTS[aspect])
        expect(thirds, `${aspect}, Pop at the ${position}`).toEqual([
          { startFrame: SHOT_FRAMES[0][0], endFrame: SHOT_FRAMES[0][1], third: EXPECTED[position][0] },
          { startFrame: SHOT_FRAMES[1][0], endFrame: SHOT_FRAMES[1][1], third: EXPECTED[position][1] }
        ])
      }
    }
  })
})

const CASES: Omit<Case, 'smart'>[] = (['9x16', '16x9'] as const).flatMap((aspect) =>
  (['libass', 'canvas'] as const).flatMap((route) => (['bottom', 'top'] as const).map((position) => ({ aspect, route, position })))
)

describe('Smart placement keeps every caption line off the face, on both routes', () => {
  for (const base of CASES) {
    const c: Case = { ...base, smart: true }
    const label = `${c.aspect} ${c.aspect === '9x16' ? 'followed' : 'static crop'}, ${c.route === 'libass' ? 'libass (Pop)' : 'the canvas bake (Pop + gradient)'}, Pop at the ${c.position}`
    it(`${label}: each shot's lines in their third, none on the box on any frame`, async () => {
      const r = await renderedCase(c)
      const box = bare.get(c.aspect)!
      expect(r.frames.length, `${r.name}: frames out`).toBe(START + DURATION)
      // Every line is on screen — or "never on the box" would hold of an export with no captions at all.
      const missing = LINES.flatMap((_, l) => inside(l).filter((f) => !spanOf(r.frames[f].yellow, YELLOW_MIN)).map((f) => `L${l + 1}@${f}`))
      expect(missing, `every line on screen: ${why(r, c.aspect)}`).toEqual([])
      // Nothing yellow away from the lines (one frame of slack at each end).
      const stray = r.frames.flatMap((f, i) => (spanOf(f.yellow, YELLOW_MIN) && !LINE_FRAMES.some(([a, b]) => i >= a - 1 && i <= b) ? [i] : []))
      expect(stray, `no caption between the lines: ${why(r, c.aspect)}`).toEqual([])
      // No caption row inside the box's rows, on any frame.
      const hits = r.frames.flatMap((f, i) => {
        const rows = onBox(f, box[i] ? spanOf(box[i].white, WHITE_MIN) : null)
        return rows.length ? [`${i} (rows ${rows[0]}–${rows[rows.length - 1]})`] : []
      })
      expect(hits, `frames with caption rows on the box: ${why(r, c.aspect)}`).toEqual([])
      // Each line in its shot's third — never the face's own.
      for (const [l, line] of r.lines.entries()) {
        const s = shotOfLine(l)
        expect(line.thirds.every((t) => t !== FACE_THIRD[s]), `L${l + 1} (shot ${s + 1}) out of the face's third: ${why(r, c.aspect)}`).toBe(true)
        expect([...new Set(line.thirds)], `L${l + 1} (shot ${s + 1}) in the ${EXPECTED[c.position][s]} third: ${why(r, c.aspect)}`).toEqual([EXPECTED[c.position][s]])
      }
    }, 120_000)
  }
})

describe('the controls: placement absent, the captions sit at the style\'s position — on the box in the face\'s shot', () => {
  for (const base of CASES) {
    const c: Case = { ...base, smart: false }
    it(`${c.aspect}, ${c.route}, Pop at the ${c.position}: every line at the ${c.position}, and the face's shot's lines on the box`, async () => {
      const r = await renderedCase(c)
      const box = bare.get(c.aspect)!
      const own: Third = c.position
      for (const [l, line] of r.lines.entries()) {
        expect([...new Set(line.thirds)], `L${l + 1} at the style's ${own}: ${why(r, c.aspect)}`).toEqual([own])
      }
      // The shot whose face is in the style's third: every frame of its lines has caption rows on the box.
      const faced = FACE_THIRD.indexOf(own)
      const off = LINES.flatMap((_, l) =>
        shotOfLine(l) === faced ? inside(l).filter((f) => onBox(r.frames[f], spanOf(box[f].white, WHITE_MIN)).length === 0).map((f) => `L${l + 1}@${f}`) : []
      )
      expect(off, `the control's lines in shot ${faced + 1} sit on the box: ${why(r, c.aspect)}`).toEqual([])
    }, 120_000)
  }
})
