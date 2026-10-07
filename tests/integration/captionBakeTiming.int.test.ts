import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { copyFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { buildRenderPlan } from '@shared/render/plan'
import { buildGraphicsSpec, captionsNeedBaking } from '@shared/graphics/fromTimeline'
import type { CaptionLayer, GraphicsSpec } from '@shared/graphics/spec'
import { concatList, planBakeOf } from '@shared/captions/bake'
import { emptyProject, projectDuration, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { segmentIntoSentences, type Word } from '@shared/transcript'
import { clearCaptionFrames, writeCaptionFrame, writeCaptionList } from '../../src/main/captions'
import { FFMPEG, makeColour, outputDir, run, writeNote } from './output'

/*
 * Every baked caption picture starts on the frame the plan gave it.
 *
 * The canvas bake replays its pictures through the concat demuxer, and the
 * concat input's stream is the first PNG's: image2 reads a picture at its
 * default 25 fps, so the stream's time base is 1/25 s, and the demuxer
 * rescales each entry's start into it — to the NEAREST 1/25 s, whatever
 * `duration` the list says (EFFECTS.md §42). At 30 fps six frames share five
 * ticks: thirty one-frame pictures came out with frames 2, 8, 14, 20 and 26
 * showing the next frame's picture and that frame's own never shown. An
 * animated look (the kinetic preset's per-frame pictures) played resampled to
 * 25 pictures a second. The fix and its measurements are §44.
 *
 * Each case is the app's path around one stand-in: buildGraphicsSpec (a
 * "kinetic" project, so the canvas bake's, not libass's) → planBakeOf (the step
 * bakeCaptions takes) → concatList, written by main's writeCaptionFrame /
 * writeCaptionList, overlaid as `captionOverlay` through buildRenderPlan and
 * the bundled ffmpeg. Two things stand in. The spec's caption lines: the one
 * real line buildGraphicsSpec builds, copied onto the frames each fixture
 * needs (one-frame lines for pictures that change every frame, as an
 * animation's do; longer ones for held pictures). And the painting: each
 * picture is a band-sized PNG, transparent but for opaque white blocks that
 * spell its line's number in eight bits — so every frame of the export says
 * WHICH picture it shows, and a frame that shows its neighbour's picture, or a
 * picture that never shows, cannot hide in a count. Bit 0 alternates frame by
 * frame in the one-frame fixture: two pictures that differ, every frame.
 *
 * What each frame should show is worked out here from the lines alone, not
 * from the plan under test. Read whole, frame by frame (`-vsync passthrough`):
 * the export's frame count must be the plan's, and every frame must show its
 * own picture — no slack. At 24, 25, 29.97, 30, 50 and 60 fps: 24 and 25 were
 * right before the fix (a 1/25 s tick is at most a frame there), the others
 * were not, and 24 is where the 2018 Windows build's `setpts` hands the `fps`
 * filter an end-of-stream time before the last picture (§44: harmless, by its
 * source; this runs it there). Artefacts in tests/output/captionBakeTiming/.
 */

const W = 320
const H = 240
const CANVAS = { width: W, height: H }
/** The band the bake is overlaid in. */
const BAND_Y = 160
const BAND_H = 60
/** Eight blocks across the band: bit k of a picture's number lights block k. */
const SLOTS = 8
const SLOT_W = W / SLOTS
/** The block's rows in the band, and the rows read inside them. */
const BLOCK_ROWS = { from: 16, to: 48 }
const READ_ROWS = { from: 24, to: 40 }

/** Every rate a project can choose (FRAME_RATES), and 29.97, which a hand-edited project still loads. */
const RATES = [24, 25, 29.97, 30, 50, 60] as const

interface Fixture {
  name: string
  /** The caption lines, as [start, end) timeline frames, and the edit's length in frames. */
  lines: (fps: number) => { spans: [number, number][]; frames: number }
  /**
   * Whether the lines keep kinetic's animation. A moving line is a new picture
   * on every frame until it settles (0.3–0.5 s), so short animated lines are
   * all one-frame runs; a still one is one picture held for the whole line.
   */
  animated: boolean
}

const FIXTURES: Fixture[] = [
  {
    // One second of one-frame pictures, each a line of its own, to the edit's last frame.
    name: 'one-frame',
    animated: true,
    lines: (fps) => {
      const n = Math.round(fps)
      return { spans: Array.from({ length: n }, (_, i): [number, number] => [i, i + 1]), frames: n }
    }
  },
  {
    // Two seconds of still lines held 1 to 7 frames, some abutting, some with blank gaps — then a blank tail.
    name: 'held',
    animated: false,
    lines: (fps) => {
      const lengths = [1, 2, 1, 3, 1, 1, 5, 2, 1, 4, 7, 1, 2, 3]
      const gaps = [0, 0, 1, 0, 2, 0, 0, 1, 0, 0, 3, 0, 1, 0]
      const end = Math.round(2 * fps)
      const spans: [number, number][] = []
      for (let i = 0, at = 0; at < end; i++) {
        const stop = Math.min(end, at + lengths[i % lengths.length])
        spans.push([at, stop])
        at = stop + gaps[i % gaps.length]
      }
      return { spans, frames: end + 7 }
    }
  }
]

let dir = ''
const sources = new Map<number, string>()
const savedUserData = process.env.FORGE_TEST_USERDATA
const notes: string[] = []

function project(fps: number, frames: number): Project {
  const asset: MediaAsset = {
    id: 'a1', path: sources.get(fps) ?? '', name: 'grey', kind: 'video', durationFrames: Math.round(3 * fps),
    width: W, height: H, fps, hasVideo: true, hasAudio: false, size: 0
  }
  const clip: Clip = {
    id: 'c1', assetId: 'a1', trackId: 'v1', start: 0, duration: frames, inPoint: 0, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, fit: 'cover' },
    color: { brightness: 0, contrast: 1, saturation: 1 }
  }
  const words: Word[] = [{ index: 0, text: 'one', startMs: 0, endMs: 250, confidence: 1 }]
  return {
    ...emptyProject(),
    settings: { width: W, height: H, fps, sampleRate: 48000 },
    assets: [asset],
    clips: [clip],
    transcripts: { a1: { assetId: 'a1', language: 'en', model: 'test', durationMs: 3000, words, segments: segmentIntoSentences(words) } },
    // Animated: the canvas bake's, not libass's (ExportStrip routes on captionNeedsCanvas).
    captions: { enabled: true, styleId: 'kinetic' }
  }
}

/** The spec buildGraphicsSpec builds, its one real caption line copied onto each span — still, unless `animated`. */
function specWith(p: Project, spans: [number, number][], animated: boolean): GraphicsSpec {
  const spec = buildGraphicsSpec(p, CANVAS)
  if (!spec) throw new Error('no spec for a captioned project')
  const line = spec.layers.find((l): l is CaptionLayer => l.kind === 'caption')
  if (!line) throw new Error('the spec has no caption line to copy')
  if (!line.spec.animationId) throw new Error('kinetic\'s line has no animation to keep or take away')
  const text = animated ? line.spec : { ...line.spec, animationId: undefined }
  return {
    ...spec,
    layers: spans.map(([start, end], i) => ({ ...line, spec: text, id: `line${i}`, startFrame: start, endFrame: end, wordFrames: [start] }))
  }
}

/** The picture a frame should show: its line's number (1-based), or 0 for none. Lines do not overlap here. */
const expectedAt = (spans: [number, number][], frame: number): number => {
  const i = spans.findIndex(([start, end]) => frame >= start && frame < end)
  return i + 1
}

/* PNG by hand: one stand-in per picture, nothing else deciding what is in it. */
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
/** A band-sized RGBA PNG, transparent but for an opaque white block at each set bit of `code`. */
function standIn(code: number): Buffer {
  const row = 1 + W * 4
  const raw = Buffer.alloc(row * BAND_H)
  for (let y = BLOCK_ROWS.from; y < BLOCK_ROWS.to; y++) {
    for (let k = 0; k < SLOTS; k++) {
      if (!(code & (1 << k))) continue
      raw.fill(255, y * row + 1 + k * SLOT_W * 4, y * row + 1 + (k + 1) * SLOT_W * 4)
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
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(BAND_H, 4)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8 bits, RGBA, deflate, no filter method, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/**
 * The export decoded whole: per frame, the number its blocks spell — null when
 * a block reads as neither white (the caption) nor the grey picture under it.
 */
async function readCodes(file: string): Promise<(number | null)[]> {
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-vsync', 'passthrough',
     '-vf', `crop=${W}:${BAND_H}:0:${BAND_Y}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }
  )
  const bytes = stdout as unknown as Buffer
  const size = W * BAND_H
  const codes: (number | null)[] = []
  for (let f = 0; (f + 1) * size <= bytes.length; f++) {
    let code: number | null = 0
    for (let k = 0; k < SLOTS; k++) {
      let sum = 0
      let n = 0
      for (let y = READ_ROWS.from; y < READ_ROWS.to; y++) {
        for (let x = k * SLOT_W + 10; x < (k + 1) * SLOT_W - 10; x++) {
          sum += bytes[f * size + y * W + x]
          n++
        }
      }
      const level = sum / n
      if (level > 200) code = code === null ? null : code | (1 << k)
      else if (level < 100 || level > 160) code = null
    }
    codes.push(code)
  }
  return codes
}

interface Result {
  /** The plan's export length, and the bake plan's. */
  plan: number
  bake: number
  codes: (number | null)[]
  expected: number[]
}
const results = new Map<string, Result>()
const key = (fixture: string, fps: number): string => `${fixture}@${fps}`

beforeAll(async () => {
  dir = await outputDir('captionBakeTiming')
  // The stub's userData is `<this>/userData`: the bake's pictures and list land there, as main writes them.
  process.env.FORGE_TEST_USERDATA = dir
  for (const fps of RATES) sources.set(fps, await makeColour(join(dir, `grey-${fps}.mp4`), '0x808080', CANVAS, 3, fps))

  for (const fps of RATES) {
    for (const fixture of FIXTURES) {
      const name = `${fixture.name}-${fps}`
      const { spans, frames } = fixture.lines(fps)
      const p = project(fps, frames)
      const baked = planBakeOf(specWith(p, spans, fixture.animated))
      if (!baked) throw new Error(`${name}: nothing to bake`)
      const { plan } = baked
      await clearCaptionFrames()
      const files: string[] = []
      for (const [i, picture] of plan.pictures.entries()) {
        // The line's number, as the painter would draw that line: 0 (no blocks) for the blank.
        files.push(await writeCaptionFrame(i, standIn(picture.layer < 0 ? 0 : picture.layer + 1)))
      }
      const listPath = await writeCaptionList(concatList(plan, (q) => files[q]))
      await copyFile(listPath, join(dir, `${name}-list.txt`))
      const file = join(dir, `${name}.mp4`)
      const render = buildRenderPlan({ project: p, outputPath: file, canvas: CANVAS, captionOverlay: { listPath, y: BAND_Y, height: BAND_H } })
      await writeFile(join(dir, `${name}-args.txt`), `${render.args.join('\n')}\n`)
      await run(FFMPEG, render.args, { maxBuffer: 64 * 1024 * 1024 })
      const codes = await readCodes(file)
      const expected = Array.from({ length: render.durationFrames }, (_, f) => expectedAt(spans, f))
      results.set(key(fixture.name, fps), { plan: render.durationFrames, bake: plan.totalFrames, codes, expected })
      await writeFile(
        join(dir, `${name}-frames.csv`),
        `frame,expected,shown\n${codes.map((c, f) => `${f},${expected[f] ?? ''},${c ?? '?'}`).join('\n')}\n`
      )
      const wrong = codes.flatMap((c, f) => (c === expected[f] ? [] : [`${f} (${c ?? '?'} for ${expected[f] ?? 'none'})`]))
      notes.push(
        `- ${name}: ${spans.length} lines, plan ${render.durationFrames} frames, bake ${plan.totalFrames} frames in ${plan.runs.length} runs, ` +
          `export ${codes.length} frames; wrong ${wrong.length ? wrong.join(', ') : 'none'}`
      )
    }
  }
}, 300_000)

afterAll(async () => {
  if (savedUserData === undefined) delete process.env.FORGE_TEST_USERDATA
  else process.env.FORGE_TEST_USERDATA = savedUserData
  if (!dir) return
  await writeNote(dir, [
    '# captionBakeTiming — every baked caption picture starts on its own frame',
    '',
    `ffmpeg ${FFMPEG}. Flat grey clips (0x808080, 320×240) at ${RATES.join(', ')} fps, captioned in "kinetic" (the canvas bake).`,
    'The bake as bakeCaptions makes it (buildGraphicsSpec → planBakeOf → concatList, written by main), its one real caption',
    'line copied onto each fixture\'s frames; each picture a stand-in whose white blocks (band rows 16–48, eight 40 px slots)',
    'spell its line\'s number in bits. one-frame: a kinetic line per frame for a second, to the edit\'s last frame. held:',
    'two seconds of still lines (the copy without its animation) held 1–7 frames with blank gaps, then 7 blank frames.',
    '',
    'Files: <fixture>-<fps>.mp4 (the export), -list.txt (the concat list), -args.txt (the argv), -frames.csv (per frame:',
    'the picture it should show, and the one it shows; ? where unreadable), userData/ (main\'s bake folder, the last case\'s).',
    '',
    ...notes
  ])
})

describe('every baked caption picture starts on the frame the plan gave it', () => {
  it('the fixture: kinetic is baked, the copied lines are what the plan draws, and the edit is the clip', () => {
    for (const fps of RATES) {
      for (const fixture of FIXTURES) {
        const { spans, frames } = fixture.lines(fps)
        const p = project(fps, frames)
        expect(captionsNeedBaking(p)).toBe(true)
        expect(projectDuration(p)).toBe(frames)
        const baked = planBakeOf(specWith(p, spans, fixture.animated))!
        // One picture per line: a one-frame line is one frame of its animation, a still line one picture held.
        expect(baked.plan.pictures.filter((q) => q.layer >= 0), `${fixture.name} at ${fps}`).toHaveLength(spans.length)
        expect(baked.plan.totalFrames).toBe(frames)
        const longest = Math.max(...baked.plan.runs.map((r) => r.frames))
        if (fixture.name === 'one-frame') expect(longest, 'one-frame: every run one frame').toBe(1)
        else expect(longest, 'held: runs that hold for several frames').toBeGreaterThanOrEqual(5)
      }
    }
    // The one-frame fixture changes picture on every frame at every rate; at 30 fps that is six pictures in five 1/25 s ticks.
    expect(FIXTURES[0].lines(30).spans.every(([s, e]) => e - s === 1)).toBe(true)
  })

  for (const fps of RATES) {
    for (const fixture of FIXTURES) {
      it(`${fixture.name} at ${fps} fps: the plan's frame count, every frame its own picture`, () => {
        const r = results.get(key(fixture.name, fps))!
        expect(r.bake, 'the bake covers the edit').toBe(r.plan)
        expect(r.codes.length, 'frames exported').toBe(r.plan)
        const wrong = r.codes.flatMap((c, f) => (c === r.expected[f] ? [] : [`frame ${f} shows ${c ?? 'nothing readable'}, not ${r.expected[f]}`]))
        expect(wrong, 'frames showing another frame\'s picture').toEqual([])
        const shown = new Set(r.codes)
        const never = [...new Set(r.expected)].filter((e) => !shown.has(e))
        expect(never, 'pictures that never reach the export').toEqual([])
      })
    }
  }
})
