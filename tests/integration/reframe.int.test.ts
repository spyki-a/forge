import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { rampRate } from '@shared/render/speed'
import { buildRenderPlan } from '@shared/render/plan'
import { filterGraphOf, withGraphFile } from '@shared/render/graphFile'
import { cropAt } from '@shared/render/crop'
import { FOOTAGE_MAX_EDGE, followedFootage } from '@shared/render/momentFrames'
import type { FootageRequest } from '@shared/render/moment'
import { cropPath, type CropPath } from '@shared/reframe/path'
import { followKeys } from '@shared/reframe/keys'
import { isHeld } from '@shared/reframe/expression'
import type { SubjectTrack } from '@shared/reframe/types'
import { extractMomentFrames } from '../../src/main/render/momentFrames'
import {
  decodeFrames,
  frameOf,
  makeSource,
  meanDifference,
  meanLuma,
  readRegion,
  type Drawn,
  type Frame,
  type Reading
} from '../fixtures/reframe/media'
import { fourShotTrack, manyCutTrack, printedMs } from '../fixtures/reframe/track'
import { FFMPEG, outputDir, run, writeNote } from './output'

/*
 * THE RENDER CHECK for a followed crop (docs/CLIPS.md §4.9): a hand-built
 * subject track → `followKeys` → `buildRenderPlan` → the graph in a file
 * (`withGraphFile`, §3.7) → the bundled ffmpeg, and every frame of the clip
 * read back off its own pixels.
 *
 * The media (tests/fixtures/reframe/media.ts) is made here: a 1920×1080
 * picture whose every crop says where it was cut from — each source column's
 * 16 px band in a 7-bit Gray code in strips every 270 rows, each source row's
 * the same way in strips every 256 columns — and whose chroma says which shot
 * of the source it is. So every exported frame gives three readings: its x,
 * its y and its shot. Hard cuts near 1, 2 and 5.5 s (shot 3 is long enough
 * for its subject to drift and the crop to pan: the head, the trigger and a
 * 948 ms pan); a 440 Hz tone as AAC in MP4.
 *
 * Four sources, because at speed 1 the crop's frames ARE the source's, and
 * each rate puts its cuts somewhere else against the project's 30 fps grid:
 * 30, 29.97, 60 (odd cuts: exact ties at 30), and VFR — `setpts` jitter on a
 * 1/120 clock, stored with `-vsync vfr`, its first cut on a frame stamped
 * exactly half-way between two output frames whose neighbour is too (the
 * case where a crop that ran on the source's own clock took the old shot's
 * position on the new shot's frame: the plain chain's one late cut, measured).
 *
 * The clip starts at timeline frame 15 (so a key compiled from the clip's
 * START, not its first frame, lands half a second late) and plays from
 * in-point 6 (so the crop's `t` is measured after the input seek).
 *
 * Frames are read by decoding the whole render in order (the n-th frame out is
 * timeline frame n, counted), so no seek decides which frame is read — the
 * `-ss` lesson of moment.int, taken further. Every reading is in README.txt.
 */

const FPS = 30
const START = 15
const IN = 6
const DURATION = 210
/*
 * How far a reading may be from what it is checked against, in source px. On the Mac every row reads within
 * 1 px of the model (README's "worst |read − model|"): the reader's own fit, since the export's x is always even.
 * ±2 there lets nothing through that a ¼-frame shift of the pan (8 px at its 32 px/frame peak) would be. Elsewhere
 * ±8, §4.9's bar: the 2018 build's scaler on this media is not measured, and the coarse bands are the fallback.
 */
const TOLERANCE = process.platform === 'darwin' ? 2 : 8
const PORTRAIT = { width: 1080, height: 1920 }
const SQUARE = { width: 1080, height: 1080 }

type SourceName = '30' | '29.97' | '60' | 'vfr'

interface Source {
  name: SourceName
  rate: string
  frames: number
  setpts?: string
  cuts: number[]
  file: string
  /** Each frame's pts and the stream's time base, probed from the file. */
  pts: number[]
  timeBase: { num: number; den: number }
  /** The rate the asset says it has (2 dp, as the probe stores it). */
  assetFps: number
}

const VFR_SETPTS = '4*N+if(N,floor(1.5+1.49*sin(1.7*N)),0)'
const SOURCES: Omit<Source, 'file' | 'pts' | 'timeBase'>[] = [
  // Cut frames ≡ 2, 1, 0 (mod 3) once the in-point is off: §3.2's half-frame boundary matters on the first.
  { name: '30', rate: '30', frames: 225, cuts: [29, 61, 165], assetFps: 30 },
  { name: '29.97', rate: '30000/1001', frames: 225, cuts: [30, 60, 165], assetFps: 29.97 },
  // 61 and 331 are odd: each is exactly half-way between two 30 fps slots, and fps= rounds the tie up.
  { name: '60', rate: '60', frames: 450, cuts: [61, 120, 331], assetFps: 60 },
  /*
   * 30: stamped on a half output frame, its next frame too, at t·30 = 24.5 after the seek — so the
   * output's slot 25 shows THIS frame, and a 6-dp half-frame boundary rounds above its time. 62 and
   * 169 are on no half frame, nor are their neighbours.
   */
  { name: 'vfr', rate: '120', frames: 225, setpts: VFR_SETPTS, cuts: [30, 62, 169], assetFps: 30 }
]

let dir = ''
const sources = new Map<SourceName, Source>()
const lines: string[] = []
const say = (line: string): void => {
  lines.push(line)
}

/* ------------------------------------------------------------- helpers */

async function probe(file: string): Promise<{ pts: number[]; timeBase: { num: number; den: number }; audioStart: number; videoStart: number }> {
  const { stdout } = await run(
    ffprobeInstaller.path,
    ['-v', 'error', '-show_entries', 'stream=codec_type,time_base,start_time:frame=best_effort_timestamp', '-select_streams', 'v:0', '-of', 'json', file],
    { maxBuffer: 64 * 1024 * 1024 }
  )
  const json = JSON.parse(String(stdout)) as { frames: { best_effort_timestamp?: number }[]; streams: { time_base: string; start_time?: string }[] }
  const [num, den] = json.streams[0].time_base.split('/').map(Number)
  const pts = json.frames.map((f) => Number(f.best_effort_timestamp))
  const a = await run(ffprobeInstaller.path, ['-v', 'error', '-show_entries', 'stream=codec_type,start_time', '-of', 'json', file])
  const streams = (JSON.parse(String(a.stdout)) as { streams: { codec_type: string; start_time?: string }[] }).streams
  return {
    pts,
    timeBase: { num, den },
    audioStart: Number(streams.find((s) => s.codec_type === 'audio')?.start_time ?? NaN),
    videoStart: Number(streams.find((s) => s.codec_type === 'video')?.start_time ?? NaN)
  }
}

const seconds = (s: Source, n: number): number => (s.pts[n] * s.timeBase.num) / s.timeBase.den

/**
 * The timeline frame a source frame is SHOWN on, by the rule the export's
 * `fps=` follows (measured, vf_fps.c:81 at f22fcd4): its time after the
 * in-point's seek, through a speed's truncating `setpts`, rounded to the
 * nearest output slot with ties up — and the slot shows the LAST frame that
 * rounds to it. Independent of reframe/keys.ts: this is what the identity
 * colour is checked against.
 */
function slotOf(s: Source, n: number, speed: Retime, inPoint = IN): number {
  const { num, den } = s.timeBase
  const rel = s.pts[n] - seekOf(s, inPoint)
  const q = typeof speed === 'number' ? (speed === 1 ? rel : Math.trunc(rel / speed)) : speed(rel, s, inPoint)
  return Math.floor((2 * q * num * FPS + den) / (2 * den))
}

/** `-ss` is written to 6 dp (plan.ts `seconds`), held in µs, and rescaled into the stream's time base, rounding. */
function seekOf(s: Source, inPoint: number): number {
  const { num, den } = s.timeBase
  return Math.round((Math.round(Number((inPoint / FPS).toFixed(6)) * 1e6) * den) / (num * 1e6))
}

/** How a clip re-times its source: a constant speed, or a map from a frame's ticks after the seek to its ticks after `setpts`. */
type Retime = number | ((rel: number, s: Source, inPoint: number) => number)

/**
 * A ramp's `setpts` as the render WROTE it — read back from the clip's chain
 * in the graph, so this oracle is the graph's, not reframe/keys.ts's — and
 * evaluated as setpts does: T the frame's time after the seek (STARTT, if
 * the graph subtracts it, the first kept frame's), the value over TB
 * truncated (setpts.c:144).
 */
function rampRetime(graph: string, form?: 'T' | 'T-STARTT'): Retime {
  const m = /\[0:v\]setpts='\((-?[\d.]+)\)\*log\(\((-?[\d.]+)\+\((-?[\d.]+)\)\*(T|\(T-STARTT\))\/(-?[\d.]+)\)\/(-?[\d.]+)\)\/TB'/.exec(graph)
  if (!m) throw new Error('no ramp at the head of the clip’s chain')
  const [scale, from, k, , D, by] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i]))
  const written = m[4] === 'T' ? 'T' : 'T-STARTT'
  return (rel, s, inPoint) => {
    const { num, den } = s.timeBase
    const tb = num / den
    const firstKept = s.pts.find((p) => p >= seekOf(s, inPoint))! - seekOf(s, inPoint)
    // As setpts forms them: T = pts·TB, STARTT the first frame's the same way.
    const T = (form ?? written) === 'T' ? rel * tb : rel * tb - firstKept * tb
    return Math.trunc((scale * Math.log((from + (k * T) / D) / by)) / tb)
  }
}

/**
 * The first timeline frame (clip-relative) that shows the shot opening at
 * source frame `cut`. Clip frame k IS slot k: a followed clip's clock
 * (plan.ts `followClock`, `fps=…:start_time=0`) starts its grid at slot 0
 * whatever slot the first frame after the seek rounds to — the p0 rows below
 * are the ones where that is slot 1.
 */
function cutFrame(s: Source, cut: number, speed: Retime, inPoint = IN): number {
  // The last source frame on slot k is what slot k shows: the cut shows on the first slot whose last frame is at or past it.
  const last = new Map<number, number>()
  for (let n = 0; n < s.pts.length; n++) last.set(slotOf(s, n, speed, inPoint), n)
  const slots = [...last.keys()].filter((k) => k >= 0).sort((a, b) => a - b)
  return slots.find((k) => last.get(k)! >= cut)!
}

/** The slot the first frame at or after the in-point's seek rounds to: 0, or 1 when it is half a slot or more past the seek. */
function firstSlot(s: Source, speed: Retime, inPoint: number): number {
  const slots = s.pts.map((_, n) => slotOf(s, n, speed, inPoint))
  const first = s.pts.findIndex((p) => p >= seekOf(s, inPoint))
  return slots[first]
}

function trackFor(s: Source, twoUp: boolean): SubjectTrack {
  const durationMs = printedMs(seconds(s, s.pts.length - 1) + (s.name === '60' ? 1 / 60 : 1 / 30))
  return fourShotTrack({ cutMs: s.cuts.map((c) => printedMs(seconds(s, c))), durationMs, twoUp })
}

function projectFor(
  s: Source,
  o: { canvas?: { width: number; height: number }; speed?: number; ramp?: { from: number; to: number }; twoUp?: boolean; follow?: boolean; track?: SubjectTrack; inPoint?: number; start?: number; duration?: number }
): { project: Project; clip: Clip } {
  const canvas = o.canvas ?? PORTRAIT
  // A ramp's length is its footage over its log-mean rate (speed.ts withClipRamp), as a speed's is over the speed.
  const speed = o.ramp ? rampRate(o.ramp.from, o.ramp.to) : (o.speed ?? 1)
  const asset: MediaAsset = {
    id: 'v', path: s.file, name: `${s.name}.mp4`, kind: 'video', durationFrames: Math.floor(seconds(s, s.pts.length - 1) * FPS),
    width: 1920, height: 1080, fps: s.assetFps, hasVideo: true, hasAudio: true, size: 0
  }
  const track = o.track ?? trackFor(s, o.twoUp ?? false)
  const clip: Clip = {
    id: 'c', assetId: 'v', trackId: 'v1', start: o.start ?? START, duration: o.duration ?? Math.floor(DURATION / speed), inPoint: o.inPoint ?? IN, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 },
    ...(o.ramp ? { ramp: o.ramp } : speed !== 1 ? { speed } : {})
  }
  const empty = emptyProject()
  const base: Project = {
    ...empty,
    settings: { width: canvas.width, height: canvas.height, fps: FPS, sampleRate: 48000 },
    tracks: [{ id: 'v1', kind: 'video', name: 'V1', muted: false, hidden: false, locked: false }],
    assets: [asset],
    clips: [clip],
    subjects: { v: track }
  }
  if (o.follow === false) {
    // The unreframed export: the same clip with the crop a followed clip stores (its first frame's), static.
    const keys = followKeys(base, { ...clip, follow: { version: 1 } }, FPS)!
    const still = { ...clip, crop: keys.crop }
    return { project: { ...base, clips: [still], subjects: {} }, clip: still }
  }
  const followed: Clip = { ...clip, follow: { version: 1 } }
  // What setAspect stores on a followed clip: the size, at its first frame's place (§4.7).
  const keys = followKeys({ ...base, clips: [followed] }, followed, FPS)!
  const stored: Clip = { ...followed, crop: keys.crop }
  return { project: { ...base, clips: [stored] }, clip: stored }
}

interface Rendered {
  file: string
  graph: string
  frames: Map<number, Frame>
  count: number
  width: number
  height: number
}

async function render(name: string, project: Project, want: (n: number) => boolean = () => true): Promise<Rendered> {
  const out = join(dir, `${name}.mp4`)
  const plan = buildRenderPlan({ project, outputPath: out })
  const graph = filterGraphOf(plan.args)
  const graphFile = join(dir, `${name}.graph.txt`)
  await writeFile(graphFile, graph)
  await run(FFMPEG, withGraphFile(plan.args, graphFile), { maxBuffer: 64 * 1024 * 1024 })
  const { width, height } = project.settings
  const { frames, count } = await decodeFrames(FFMPEG, out, width, height, want)
  return { file: out, graph, frames, count, width, height }
}

/** How a crop of `crop` is drawn into `box` (plan.ts fitFilter, cover; scale's own rounding, then a centred crop). */
function drawnInto(crop: { width: number; height: number }, box: { width: number; height: number }): Drawn {
  if (crop.width * box.height === box.width * crop.height && crop.width === box.width) return { sx: 1, sy: 1, offX: 0, offY: 0 }
  const tw = Math.round((box.height * crop.width) / crop.height)
  const th = Math.round((box.width * crop.height) / crop.width)
  const sw = Math.max(tw, box.width)
  const sh = Math.max(th, box.height)
  return { sx: sw / crop.width, sy: sh / crop.height, offX: Math.floor((sw - box.width) / 2), offY: Math.floor((sh - box.height) / 2) }
}

/** One frame's readings: the single crop, or each half of a stacked frame. */
function readFrame(f: Frame, path: CropPath, stacked: boolean): { one: Reading; top?: Reading; bottom?: Reading } {
  const box = { width: f.width, height: f.height }
  if (!stacked) return { one: readRegion(f, { top: 0, height: f.height }, drawnInto(path.size, box), path.size) }
  const halfBox = { width: f.width, height: f.height / 2 }
  const d = drawnInto(path.half, halfBox)
  const top = readRegion(f, { top: 0, height: f.height / 2 }, d, path.half)
  const bottom = readRegion(f, { top: f.height / 2, height: f.height / 2 }, d, path.half)
  return { one: top, top, bottom }
}

/** Decode one PNG (or any picture) to yuv420p at its own size. */
async function decodePicture(file: string, width: number, height: number, vf?: string): Promise<Frame> {
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-i', file, ...(vf ? ['-vf', vf] : []), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
  )
  return frameOf(stdout as unknown as Buffer, width, height)
}

/** Mono f32 at 48 kHz, as ffmpeg decodes it. */
async function pcm(file: string): Promise<Float32Array> {
  const { stdout } = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], {
    encoding: 'buffer',
    maxBuffer: 256 * 1024 * 1024
  })
  const buf = stdout as unknown as Buffer
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4)))
}

/** The largest second difference over [from, to) samples. */
function worstSecondDifference(a: Float32Array, from: number, to: number): { value: number; at: number } {
  let worst = { value: 0, at: -1 }
  for (let i = Math.max(1, from); i < Math.min(a.length - 1, to); i++) {
    const d = Math.abs(a[i + 1] - 2 * a[i] + a[i - 1])
    if (d > worst.value) worst = { value: d, at: i }
  }
  return worst
}

/* ------------------------------------------------------------- setup */

beforeAll(async () => {
  dir = await outputDir('reframe')
  const media = join(dir, 'media')
  await mkdir(media, { recursive: true })
  for (const spec of SOURCES) {
    const file = join(media, `${spec.name}.mp4`)
    await makeSource(FFMPEG, file, { rate: spec.rate, frames: spec.frames, cuts: spec.cuts, ...(spec.setpts ? { setpts: spec.setpts } : {}) })
    const { pts, timeBase } = await probe(file)
    sources.set(spec.name, { ...spec, file, pts, timeBase })
    say(`- source ${spec.name}: ${pts.length} frames, time base ${timeBase.num}/${timeBase.den}, cuts at frames ${spec.cuts.join(', ')} = ${spec.cuts.map((c) => `${((pts[c] * timeBase.num) / timeBase.den).toFixed(6)} s`).join(', ')}`)
  }
}, 300_000)

afterAll(async () => {
  if (!dir) return
  await writeNote(dir, [
    '# reframe — the followed crop, rendered (docs/CLIPS.md §4.9)',
    '',
    'Media: 1920×1080, column code in strips every 270 rows and row code in strips every 256 columns (16 px bands, 7-bit Gray),',
    'each shot its own chroma (U,V) = (112,112) / (144,112) / (112,144) / (144,144); a 440 Hz tone, AAC. In-point 6, clip at timeline 15.',
    'Hand-built track: shot 1 face x 0.25, shot 2 x 0.75, shot 3 drifting 0.3 → 0.6 (a pan), shot 4 one face at 0.5 — or, for the two-up,',
    'two faces at x 0.2 (y 0.35) and 0.8 (y 0.55).',
    `Every frame of each render is read: x (and y) fitted to the codes, the shot from its chroma. Tolerance ±${TOLERANCE} px.`,
    '',
    ...lines
  ])
})

/* ------------------------------------------------------------- checks */

interface RowResult {
  readings: Map<number, { one: Reading; top?: Reading; bottom?: Reading }>
  rendered: Rendered
  path: CropPath
  clip: Clip
  project: Project
}

/**
 * Render a followed clip and read every frame of it, checking each against
 * two oracles: the model (`cropAt`, the export's own keys at the export's own
 * rounding) and, independently of the keys, the crop path's position for the
 * shot the frame's chroma says it shows. Returns everything read.
 */
async function followedRow(
  s: Source,
  label: string,
  o: { canvas?: { width: number; height: number }; speed?: number; ramp?: { from: number; to: number }; twoUp?: boolean; track?: SubjectTrack; inPoint?: number; start?: number; duration?: number }
): Promise<RowResult> {
  const { project, clip } = projectFor(s, o)
  const canvas = o.canvas ?? PORTRAIT
  const path = cropPath(project.subjects!.v, canvas, { twoUp: true })
  const rendered = await render(`${s.name}-${label}`, project, (n) => n >= clip.start && n < clip.start + clip.duration)
  expect(rendered.count, `${label}: frames out`).toBe(clip.start + clip.duration)
  const stackedClip = path.shots.some((p) => p.halves)
  const readings = new Map<number, { one: Reading; top?: Reading; bottom?: Reading }>()
  const misses: string[] = []
  // The largest distance read from the model on any frame, on either axis, for README (and the tolerance).
  let worst = 0
  for (let k = 0; k < clip.duration; k++) {
    const f = rendered.frames.get(clip.start + k)!
    const model = cropAt(project, clip, { width: 1920, height: 1080 }, k)
    let r: ReturnType<typeof readFrame>
    try {
      r = readFrame(f, path, stackedClip)
    } catch (err) {
      // A frame with no codes on it is not the picture: the black canvas showing through, say.
      misses.push(`frame ${k}: unreadable (${err instanceof Error ? err.message : String(err)}), mean luma ${meanLuma(f, { top: 0, height: f.height }).toFixed(1)}`)
      continue
    }
    readings.set(k, r)
    const shot = path.shots[r.one.shot]
    if (model.halves) {
      const { top, bottom } = model.halves
      if (!r.top || !r.bottom) throw new Error('a stacked frame read as one')
      for (const [name, read, want] of [['top', r.top, top], ['bottom', r.bottom, bottom]] as const) {
        worst = Math.max(worst, Math.abs(read.x - want.x), Math.abs(read.y - want.y))
        if (Math.abs(read.x - want.x) > TOLERANCE || Math.abs(read.y - want.y) > TOLERANCE) misses.push(`frame ${k} ${name}: read (${read.x}, ${read.y}), model (${want.x}, ${want.y})`)
        // Independently of the keys: the half shows the face the path gives this shot.
        const half = shot.halves?.[name]
        if (!half || Math.abs(read.x - half.x) > TOLERANCE || Math.abs(read.y - half.y) > TOLERANCE) misses.push(`frame ${k} ${name}: shot ${r.one.shot + 1} shown, read (${read.x}, ${read.y}), its path (${half?.x}, ${half?.y})`)
        if (read.shot !== r.one.shot) misses.push(`frame ${k}: the halves show shots ${r.top.shot + 1} and ${r.bottom.shot + 1}`)
      }
    } else {
      worst = Math.max(worst, Math.abs(r.one.x - model.crop.x))
      if (Math.abs(r.one.x - model.crop.x) > TOLERANCE) misses.push(`frame ${k}: read x ${r.one.x}, model ${model.crop.x}`)
      if (stackedClip && r.bottom && (Math.abs(r.bottom.x - r.one.x) > TOLERANCE || Math.abs(r.bottom.y - (r.one.y + path.half.height)) > TOLERANCE)) {
        misses.push(`frame ${k}: a single shot's halves read (${r.one.x}, ${r.one.y}) and (${r.bottom.x}, ${r.bottom.y}) — not one crop`)
      }
      // Independently of the keys: a shot that holds is where the path holds it; one that pans is between its places.
      const places = [shot.at, ...shot.pans.map((p) => p.to)]
      if (r.one.x < Math.min(...places) - TOLERANCE || r.one.x > Math.max(...places) + TOLERANCE) {
        misses.push(`frame ${k}: shot ${r.one.shot + 1} shown at x ${r.one.x}, its path is ${places.join(' → ')}`)
      }
    }
  }
  say(`- ${s.name} ${label}: ${readings.size} of ${clip.duration} frames read, the worst |read − model| ${worst} px`)
  const row = { readings, rendered, path, clip, project }
  rows.set(`${s.name}/${label}`, row)
  expect(misses, `${s.name} ${label}: frames off the crop they should have`).toEqual([])
  return row
}

const rows = new Map<string, RowResult>()
function rowOf(s: Source, label: string): RowResult {
  const row = rows.get(`${s.name}/${label}`)
  if (!row) throw new Error(`${s.name} ${label} was not rendered — its own test failed first`)
  return row
}

/** The cut frames, each read at cut − 1, cut and cut + 1, as README lines and as checks of the shot shown. */
function checkCuts(s: Source, row: RowResult, label: string, speed: Retime = 1): void {
  for (const [i, cut] of s.cuts.entries()) {
    const k = cutFrame(s, cut, speed, row.clip.inPoint)
    const before = row.readings.get(k - 1)
    const on = row.readings.get(k)
    const after = row.readings.get(k + 1)
    if (!before || !on || !after) throw new Error(`${label}: cut ${i + 1} at clip frame ${k} is outside the clip`)
    const fmt = (r: { one: Reading; top?: Reading; bottom?: Reading }): string =>
      r.top && r.bottom && (Math.abs(r.top.x - r.bottom.x) > TOLERANCE || Math.abs(r.bottom.y - r.top.y - 540) > TOLERANCE)
        ? `shot ${r.top.shot + 1} top (${r.top.x}, ${r.top.y}) bottom (${r.bottom.x}, ${r.bottom.y})`
        : `shot ${r.one.shot + 1} x ${r.one.x}`
    say(`- ${s.name} ${label}, cut ${i + 1} (source frame ${cut}) on clip frame ${k} (timeline ${row.clip.start + k}): −1 ${fmt(before)} | cut ${fmt(on)} | +1 ${fmt(after)}`)
    // Frame-exact: the frame before the cut is the old shot, the cut's own frame the new (and the crop with it, checked on every frame above).
    expect(before.one.shot, `${s.name} ${label}: frame before cut ${i + 1}`).toBe(i)
    expect(on.one.shot, `${s.name} ${label}: cut ${i + 1}'s frame`).toBe(i + 1)
    expect(after.one.shot).toBe(i + 1)
    // …and on each of the three the crop the path puts that shot at: the old shot where it ENDS (after any
    // pan), the new one where it opens — so a crop held across the cut, either way, is caught here.
    const ends = (at: number, pans: { to: number }[]): number => (pans.length ? pans[pans.length - 1].to : at)
    for (const [dk, r] of [[-1, before], [0, on], [1, after]] as const) {
      const shot = row.path.shots[r.one.shot]
      const where = `${s.name} ${label}: cut ${i + 1}${dk ? ` ${dk > 0 ? '+' : ''}${dk}` : ''}`
      if (shot.halves && r.top && r.bottom) {
        const top = { x: dk < 0 ? ends(shot.halves.top.x, shot.halves.top.pans) : shot.halves.top.x, y: shot.halves.top.y }
        const bottom = { x: dk < 0 ? ends(shot.halves.bottom.x, shot.halves.bottom.pans) : shot.halves.bottom.x, y: shot.halves.bottom.y }
        expect(Math.abs(r.top.x - top.x), `${where}, top x ${r.top.x} against ${top.x}`).toBeLessThanOrEqual(TOLERANCE)
        expect(Math.abs(r.top.y - top.y), `${where}, top y ${r.top.y} against ${top.y}`).toBeLessThanOrEqual(TOLERANCE)
        expect(Math.abs(r.bottom.x - bottom.x), `${where}, bottom x ${r.bottom.x} against ${bottom.x}`).toBeLessThanOrEqual(TOLERANCE)
        expect(Math.abs(r.bottom.y - bottom.y), `${where}, bottom y ${r.bottom.y} against ${bottom.y}`).toBeLessThanOrEqual(TOLERANCE)
      } else {
        const want = dk < 0 ? ends(shot.at, shot.pans) : shot.at
        expect(Math.abs(r.one.x - want), `${where} shows shot ${r.one.shot + 1} at x ${r.one.x}, its path ${want}`).toBeLessThanOrEqual(TOLERANCE)
      }
    }
  }
}

/** Shot 3's pan, read: band by band never backwards, from the held place to the subject's. */
function checkPan(s: Source, row: RowResult, label: string): void {
  const shot = row.path.shots[2]
  expect(shot.pans.length, 'shot 3 pans (the fixture is meant to)').toBeGreaterThan(0)
  const xs = [...row.readings.entries()].filter(([, r]) => r.one.shot === 2).map(([k, r]) => ({ k, x: r.one.x }))
  for (let i = 1; i < xs.length; i++) expect(xs[i].x, `${s.name} ${label}: shot 3 at clip frame ${xs[i].k}`).toBeGreaterThanOrEqual(xs[i - 1].x - 2)
  const moving = xs.filter((p, i) => i > 0 && p.x !== xs[i - 1].x)
  const from = (moving[0]?.k ?? 0) - 1
  const to = (moving[moving.length - 1]?.k ?? 0) + 1
  say(`- ${s.name} ${label}, the pan: ${xs[0].x} → ${xs[xs.length - 1].x}, clip frames ${from}–${to}: ${xs.filter((p) => p.k >= from && p.k <= to).map((p) => p.x).join(', ')}`)
  expect(Math.abs(xs[0].x - shot.at)).toBeLessThanOrEqual(TOLERANCE)
  expect(Math.abs(xs[xs.length - 1].x - shot.pans[shot.pans.length - 1].to)).toBeLessThanOrEqual(TOLERANCE)
  expect(moving.length, 'frames on which the crop moved').toBeGreaterThan(5)
}

/**
 * A moment over the followed clip, its window across `cut`: pulled through
 * the footage pre-pass exactly as the app pulls it (main's
 * `extractMomentFrames`, the request `followedFootage` fills), each pulled
 * frame read off its own pixels and compared with the render's frame beneath.
 */
async function checkMoment(s: Source, row: RowResult, label: string, cut: number, stacked: boolean, retime: Retime = 1): Promise<void> {
  const k0 = cutFrame(s, cut, retime, row.clip.inPoint)
  const first = k0 - 5
  const count = 10
  const req: FootageRequest = {
    path: s.file, inPoint: row.clip.inPoint, duration: row.clip.duration, first, count, fps: FPS,
    ...(row.clip.speed !== undefined ? { speed: row.clip.speed } : {}),
    ...(row.clip.ramp ? { ramp: row.clip.ramp } : {}),
    size: { width: 1920, height: 1080 }, maxEdge: FOOTAGE_MAX_EDGE,
    ...followedFootage(row.project, row.clip, FPS)
  }
  expect(req.cropX ?? req.halves, 'the request carries the followed crop').toBeDefined()
  const pulled = await extractMomentFrames(req, join(dir, 'moments'))
  expect(pulled.files).toHaveLength(count)
  const box = { width: row.rendered.width, height: row.rendered.height }
  const read: string[] = []
  const diffs: number[] = []
  for (const [i, file] of pulled.files.entries()) {
    const own = await decodePicture(file, pulled.width, pulled.height)
    const beneath = row.readings.get(first + i)!
    if (stacked) {
      const half = { width: pulled.width, height: pulled.height / 2 }
      const one = { sx: 1, sy: 1, offX: 0, offY: 0 }
      const top = readRegion(own, { top: 0, height: half.height }, one, half)
      const bottom = readRegion(own, { top: half.height, height: half.height }, one, half)
      read.push(`${first + i}: shot ${top.shot + 1} (${top.x}, ${top.y}) / (${bottom.x}, ${bottom.y}) vs (${beneath.top!.x}, ${beneath.top!.y}) / (${beneath.bottom!.x}, ${beneath.bottom!.y})`)
      expect(top.shot, `${label} moment frame ${i}: shot`).toBe(beneath.one.shot)
      for (const [a, b] of [[top, beneath.top!], [bottom, beneath.bottom!]] as const) {
        expect(Math.abs(a.x - b.x), `${label} moment frame ${i}: x ${a.x} pulled, ${b.x} rendered`).toBeLessThanOrEqual(4)
        expect(Math.abs(a.y - b.y), `${label} moment frame ${i}: y ${a.y} pulled, ${b.y} rendered`).toBeLessThanOrEqual(4)
      }
    } else {
      const r = readRegion(own, { top: 0, height: pulled.height }, { sx: 1, sy: 1, offX: 0, offY: 0 }, { width: pulled.width, height: pulled.height })
      read.push(`${first + i}: shot ${r.shot + 1} x ${r.x} vs ${beneath.one.x}`)
      expect(r.shot, `${label} moment frame ${i}: shot`).toBe(beneath.one.shot)
      expect(Math.abs(r.x - beneath.one.x), `${label} moment frame ${i}: x ${r.x} pulled, ${beneath.one.x} rendered`).toBeLessThanOrEqual(4)
    }
    // The picture: the pulled frame drawn as the render draws the crop, against the render's own frame.
    const drawn = await decodePicture(file, box.width, box.height, `scale=${box.width}:${box.height}:force_original_aspect_ratio=increase,crop=${box.width}:${box.height}`)
    diffs.push(meanDifference(drawn, row.rendered.frames.get(row.clip.start + first + i)!))
  }
  say(`- ${s.name} ${label}, a moment over clip frames ${first}–${first + count - 1} (cut on ${k0}), pulled ${pulled.width}×${pulled.height}: ${read.join('; ')}`)
  say(`  mean difference from the render's frame beneath, levels: ${diffs.map((d) => d.toFixed(2)).join(', ')}`)
  for (const d of diffs) expect(d, `${label} moment: mean difference ${d.toFixed(2)} levels`).toBeLessThanOrEqual(2)
}

/** Is source frame `n` exactly half-way between two output slots after the in-point's seek (t·30 = m + ½)? From its probed pts, in integers. */
function onTie(s: Source, n: number, speed = 1, inPoint = IN): boolean {
  const { num, den } = s.timeBase
  const rel = s.pts[n] - seekOf(s, inPoint)
  const q = speed === 1 ? rel : Math.trunc(rel / speed)
  return (2 * q * FPS * num) % (2 * den) === den
}

describe('the media is what the rows assume', () => {
  it('the ties the fps=-first rows are meant to meet are in the files as probed, not only in their comments', () => {
    /*
     * These are what made the rows bite (a crop on the source's own clock was late on the VFR tie, and
     * rounding the printed time put the 60 fps ties a frame early). On Windows CI the 2018 build writes
     * this media: if its muxer stamps it otherwise, the rows would still pass and no longer test the case.
     */
    const vfr = sources.get('vfr')!
    const s60 = sources.get('60')!
    const ties = {
      'vfr cut 30': onTie(vfr, 30),
      'vfr frame 31, after it': onTie(vfr, 31),
      '60 cut 61': onTie(s60, 61),
      '60 cut 331': onTie(s60, 331),
      // The 30 fps source's cuts are on the grid; its first cut is the §3.2 case (≡ 2 mod 3 once the in-point is off).
      '30 cut 29 is not': !onTie(sources.get('30')!, 29)
    }
    say(`- ties as probed: ${Object.entries(ties).map(([k, v]) => `${k} ${v ? 'yes' : 'NO'}`).join('; ')}`)
    expect(ties).toEqual({ 'vfr cut 30': true, 'vfr frame 31, after it': true, '60 cut 61': true, '60 cut 331': true, '30 cut 29 is not': true })
    // And the p0 rows' precondition: VFR frame 1 half a slot past in-point 1's seek, so fps= starts on slot 1.
    expect(onTie(vfr, 1, 1, 1), 'vfr frame 1 after in-point 1').toBe(true)
  })
})

describe('a followed crop, rendered: frame-exact at every cut, on four sources', () => {
  for (const name of ['30', '29.97', '60', 'vfr'] as const) {
    describe(name, () => {
      it('16:9 → 9:16: every frame on its shot’s crop, every cut on its frame, the pan through the grid', async () => {
        const s = sources.get(name)!
        const row = await followedRow(s, '9x16', {})
        checkCuts(s, row, '9:16')
        checkPan(s, row, '9:16')
      })

      it('the sound is untouched: no click anywhere, and the same A/V start as the unreframed export', async () => {
        const s = sources.get(name)!
        const row = rowOf(s, '9x16')
        const { project } = projectFor(s, { follow: false })
        const plain = await render(`${s.name}-unreframed`, project, () => false)
        const [followed, unreframed] = await Promise.all([pcm(row.rendered.file), pcm(plain.file)])
        // Throughout: the whole file, the silence before the clip and its edges included.
        const a = worstSecondDifference(followed, 0, followed.length)
        const b = worstSecondDifference(unreframed, 0, unreframed.length)
        const [pa, pb] = await Promise.all([probe(row.rendered.file), probe(plain.file)])
        const offset = pa.audioStart - pa.videoStart
        const offsetPlain = pb.audioStart - pb.videoStart
        say(`- ${s.name} sound: ${followed.length} samples, worst second difference ${a.value.toFixed(5)} (sample ${a.at}), unreframed ${b.value.toFixed(5)} (${unreframed.length} samples); A/V start ${(offset * 1000).toFixed(2)} ms, unreframed ${(offsetPlain * 1000).toFixed(2)} ms`)
        expect(a.value).toBeLessThan(0.01)
        expect(followed.length, 'the same length of sound').toBe(unreframed.length)
        expect(Math.abs(offset - offsetPlain), 'A/V start against the unreframed export').toBeLessThanOrEqual(1024 / 48000)
      })

      it('a moment across a cut, pulled through the pre-pass, is the render’s frame beneath', async () => {
        const s = sources.get(name)!
        await checkMoment(s, rowOf(s, '9x16'), '9:16', s.cuts[1], false)
      })

      it('16:9 → 1:1: the same', async () => {
        const s = sources.get(name)!
        const row = await followedRow(s, '1x1', { canvas: SQUARE })
        checkCuts(s, row, '1:1')
        checkPan(s, row, '1:1')
      })

      it('at speed 2: the cuts on the frames the retime shows them, the crop with them, the pan through the grid', async () => {
        const s = sources.get(name)!
        const row = await followedRow(s, 'speed2', { speed: 2 })
        checkCuts(s, row, '9:16 at 2×', 2)
        checkPan(s, row, '9:16 at 2×')
      })

      it('THE TWO-UP: shot 4 stacked, each half on its own face, frame-exact at its cut, the single shots unchanged, the last frame kept', async () => {
        const s = sources.get(name)!
        const row = await followedRow(s, 'two-up', { twoUp: true })
        checkCuts(s, row, 'two-up')
        // Shot 4: the top half on the LEFT face, the bottom on the right, each on both axes, both in shot 4.
        const k = cutFrame(s, s.cuts[2], 1, row.clip.inPoint)
        const on = row.readings.get(k)!
        const halves = row.path.shots[3].halves!
        expect(on.top!.shot).toBe(3)
        expect(on.bottom!.shot).toBe(3)
        expect(Math.abs(on.top!.x - halves.top.x)).toBeLessThanOrEqual(TOLERANCE)
        expect(Math.abs(on.bottom!.x - halves.bottom.x), `the bottom half reads x ${on.bottom!.x}: the right face's crop is ${halves.bottom.x}`).toBeLessThanOrEqual(TOLERANCE)
        expect(halves.top.x).toBeLessThan(halves.bottom.x)
        // A single shot inside the two-up clip is the same picture as the clip with no two-up.
        const plain = rowOf(s, '9x16')
        const diffs: number[] = []
        for (let f = 30; f < 50; f++) diffs.push(meanDifference(row.rendered.frames.get(row.clip.start + f)!, plain.rendered.frames.get(plain.clip.start + f)!))
        say(`- ${s.name} two-up: shot 2 (clip frames 30–49) against the clip with no two-up, mean difference ${Math.min(...diffs).toFixed(3)}–${Math.max(...diffs).toFixed(3)} levels`)
        // Bit-identical on the Mac (§38; 0.000 on all four sources here); ≤ 1 level where the 2018 build encodes it, unmeasured.
        for (const d of diffs) expect(d, `a single shot in the two-up clip, ${d.toFixed(3)} levels from the clip with none`).toBeLessThanOrEqual(process.platform === 'darwin' ? 0 : 1)
        // The clip's last frame is the stack, not the black canvas (vstack's EOF loses it without the tpad).
        const lastK = row.clip.duration - 1
        const last = row.rendered.frames.get(row.clip.start + lastK)!
        const luma = [meanLuma(last, { top: 0, height: 960 }), meanLuma(last, { top: 960, height: 960 })]
        say(`- ${s.name} two-up: the clip's last frame (${lastK}): mean luma ${luma.map((l) => l.toFixed(1)).join(' / ')}, shot ${row.readings.get(lastK)!.one.shot + 1}`)
        for (const l of luma) expect(l, 'the last frame is a picture, not the canvas').toBeGreaterThan(60)
        expect(row.readings.get(lastK)!.one.shot).toBe(3)
      })

      it('a moment across the two-up’s first cut, through the one stacked pull, is the render’s frame beneath', async () => {
        const s = sources.get(name)!
        await checkMoment(s, rowOf(s, 'two-up'), 'two-up', s.cuts[2], true)
      })
    })
  }
})

/*
 * The followed clock's slot 0 (plan.ts `followClock`). After the seek, `fps=`
 * starts at the slot the FIRST frame rounds to, and on this VFR file at
 * in-point 1 that is slot 1 (frame 1 at 6/120 s, t·30 = 0.5 past the 1/30 s
 * seek); the clip's `setpts=PTS-STARTPTS` then made clip frame k slot k + 1,
 * its crop at t = (k+1)/30, while the keys' cut frames, `cropAt` and the
 * preview read frame k at k/30 — one frame late at every cut, measured. The
 * clock's `start_time=0` starts the grid at slot 0. The other rows (in-point
 * 6) all start on slot 0, so none of them could tell.
 */
describe('the followed clock starts at slot 0, when the first frame after the seek rounds to slot 1', () => {
  it('VFR at in-point 1: every frame on the model and on its shot’s crop, every cut on its frame, the pan, a moment across a cut', async () => {
    const s = sources.get('vfr')!
    expect(firstSlot(s, 1, 1), 'the first frame after in-point 1’s seek rounds to slot 1').toBe(1)
    expect(firstSlot(s, 1, IN), 'the four-source rows start on slot 0').toBe(0)
    const row = await followedRow(s, 'p0', { inPoint: 1 })
    checkCuts(s, row, 'p0 at 1×')
    checkPan(s, row, 'p0 at 1×')
    await checkMoment(s, row, 'p0 at 1×', s.cuts[1], false)
  })

  it('VFR at in-point 1 at half speed: the retime’s own fps= starts on slot 1 too, and the clock after it starts the grid at 0', async () => {
    const s = sources.get('vfr')!
    expect(firstSlot(s, 0.5, 1), 'the first frame after the retime rounds to slot 1').toBe(1)
    const row = await followedRow(s, 'p0-half', { inPoint: 1, speed: 0.5 })
    checkCuts(s, row, 'p0 at 0.5×', 0.5)
  })
})

/*
 * A ramp on a followed clip (plan.ts `followedRetime`). `rampVideoFilter`
 * measures source time from STARTT, the first frame kept after the seek;
 * the keys put each cut where the ramp maps its time from the in-point. On
 * this VFR file at in-point 1 the first kept frame is 1/60 s past the seek,
 * so the two disagree — the precondition below — and a crop keyed on one
 * clock and a picture cut on the other hold the old crop across a cut. The
 * oracle is the setpts the graph wrote, evaluated as setpts evaluates it.
 */
describe('a followed ramp runs on the seek’s clock', () => {
  it('VFR at in-point 1, ramp 1 → 0.5: every frame on the model and its shot’s crop, every cut on its frame, the pan, a moment across a cut', async () => {
    const s = sources.get('vfr')!
    const ramp = { from: 1, to: 0.5 }
    const { project } = projectFor(s, { inPoint: 1, ramp })
    const graph = filterGraphOf(buildRenderPlan({ project, outputPath: join(dir, 'probe.mp4') }).args)
    const onT = rampRetime(graph, 'T')
    const onStartt = rampRetime(graph, 'T-STARTT')
    const moved = s.cuts.filter((c) => cutFrame(s, c, onT, 1) !== cutFrame(s, c, onStartt, 1))
    say(`- vfr ramp 1→0.5 at in-point 1: the first kept frame ${s.pts.find((p) => p >= seekOf(s, 1))! - seekOf(s, 1)} ticks past the seek; cut frames on T ${s.cuts.map((c) => cutFrame(s, c, onT, 1)).join('/')}, on T−STARTT ${s.cuts.map((c) => cutFrame(s, c, onStartt, 1)).join('/')}`)
    expect(moved.length, 'cuts whose frame the two clocks disagree on (the row bites only if some do)').toBeGreaterThan(0)
    const row = await followedRow(s, 'ramp', { inPoint: 1, ramp })
    const retime = rampRetime(row.rendered.graph)
    checkCuts(s, row, 'ramp 1→0.5', retime)
    checkPan(s, row, 'ramp 1→0.5')
    await checkMoment(s, row, 'ramp 1→0.5', s.cuts[1], false, retime)
  })
})

describe('more cuts than a nested if() can hold', () => {
  it('110 held keys on one clip render, every frame on its crop — the flat sum, where keyframeExpression refuses past 96', async () => {
    const s = sources.get('30')!
    const times = s.pts.map((_, n) => seconds(s, n))
    const track = manyCutTrack(times, 2, printedMs(times[times.length - 1] + 1 / 30))
    const { project, clip } = projectFor(s, { track, inPoint: 0, start: 0, duration: 220 })
    const keys = followKeys(project, clip, FPS)!
    const held = (keys.cropX?.terms ?? []).filter(isHeld).length
    expect(held, 'held keys (past §48’s 96)').toBeGreaterThan(100)
    const rendered = await render('30-many-cuts', project)
    const path = cropPath(track, PORTRAIT, { twoUp: true })
    const misses: string[] = []
    let changes = 0
    let previous = -1
    for (let k = 0; k < clip.duration; k++) {
      const r = readFrame(rendered.frames.get(k)!, path, false)
      const model = cropAt(project, clip, { width: 1920, height: 1080 }, k)
      if (Math.abs(r.one.x - model.crop.x) > TOLERANCE) misses.push(`frame ${k}: read ${r.one.x}, model ${model.crop.x}`)
      if (previous >= 0 && Math.abs(r.one.x - previous) > 400) changes++
      previous = r.one.x
    }
    say(`- 30 fps, ${track.shots.length} shots of 2 frames, ${held} held keys, the graph ${rendered.graph.length} chars through its file: ${changes} jumps read, ${misses.length} frames off`)
    expect(misses).toEqual([])
    expect(changes).toBeGreaterThan(100)
  })
})
