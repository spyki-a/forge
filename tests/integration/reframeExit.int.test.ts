import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { deserializeProject } from '@shared/project'
import { candidatePaths } from '@shared/project/relink'
import { cropAt } from '@shared/render/crop'
import {
  EXIT_BARS,
  EXIT_COLOURS,
  PULL_BATCH,
  exitBars,
  exitCuts,
  exitFolderName,
  exitPullArgs,
  exitSamples,
  exitSheetArgs,
  exitTable,
  followedClips,
  scoreFollowedClip,
  type ExitRow,
  type ExitSample,
  type SheetPanel
} from '@shared/reframe/exit'
import { followAt, followKeys, type FollowKeys, type FollowShot } from '@shared/reframe/keys'
import { SUBJECT_TRACK_VERSION, type FaceBox, type SubjectSample, type SubjectTrack } from '@shared/reframe/types'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { printedMs } from '../fixtures/reframe/track'
import { FFMPEG, OUTPUT_ROOT, outputDir, run, writeNote } from './output'

/*
 * Step 1's exit reader (docs/CLIPS.md §4.10), run.
 *
 * The scoring is src/shared/reframe/exit.ts, pure; this is its I/O: a saved
 * project read through the app's own `deserializeProject`, every followed
 * clip scored, and for each a folder under the output root holding
 *
 * - `cut-NN-fFFFFF.png` per cut: the clip frames before, on and after it
 *   side by side (`hstack`), and
 * - `shot-NN-fFFFFF.png` per shot: one frame inside it,
 *
 * each the SOURCE frame the export shows on that clip frame — the export's
 * own seek, retime and `fps=…:start_time=0` clock, then `select` on the slot
 * (`exitPullArgs`) — uncropped, with the crop drawn by `drawbox` in red (a
 * stacked two-up's top half red, its bottom half blue) and the faces of the
 * nearest sample in the same shot in green (`exitSheetArgs`); and a
 * README.txt with the table, the two bars marked per clip and an empty
 * rating column, which is the user's.
 *
 * The user's run, on the project their ten clips were reframed and exported
 * in, outside the sandbox:
 *
 *     FORGE_REFRAME_EXIT=/path/to/project.forge npx vitest run tests/integration/reframeExit.int.test.ts
 *
 * which writes tests/output/reframe-real/ (gitignored, never committed). It
 * clears only what its last run wrote there (`clearedRoot`): the folder is
 * where the user's own downloads have been kept (`source/`).
 * Without the variable that suite is skipped, and only the synthetic check
 * below runs: the same `writeExit` on a clip made here, its frames read back
 * off their pixels, into tests/output/reframe-exit/.
 */

const PROJECT_FILE = process.env.FORGE_REFRAME_EXIT ?? ''
const COMMAND = 'FORGE_REFRAME_EXIT=/path/to/project.forge npx vitest run tests/integration/reframeExit.int.test.ts'

const pad = (n: number, width: number): string => String(n).padStart(width, '0')

/** What the runner did for one followed clip. */
interface ClipReport {
  n: number
  name: string
  /** Where the clip starts on the timeline, seconds: two clips of one file share its name. */
  start: number
  folder: string
  row: ExitRow
  /** The sheets written, by file name. */
  files: string[]
  outside: ExitSample[]
  heldFrames: number[]
  /** Why no frames were drawn, when none were. */
  skipped?: string
  /** A line about the file on disk, when it is not the one the track was measured on. */
  stale?: string
  pullMs?: number
  sheetsMs?: number
}

/** The frame inside a shot to show it by: the sample nearest its middle (its faces then drawn on their own frame), else the middle. */
function midFrame(shot: FollowShot, samples: ExitSample[]): number {
  const middle = Math.floor((shot.from + shot.to - 1) / 2)
  const own = samples.filter((s) => s.shot === shot.index)
  if (own.length === 0) return middle
  return own.reduce((a, b) => (Math.abs(b.frame - middle) < Math.abs(a.frame - middle) ? b : a)).frame
}

/** One frame's boxes: the crop the export cuts there (cropAt, the app's one reader), and the faces of the nearest sample in the same shot. */
function panelFor(project: Project, clip: Clip, keys: FollowKeys, samples: ExitSample[], frame: number, file: string): SheetPanel {
  const at = cropAt(project, clip, null, frame)
  const boxes: SheetPanel['boxes'] = at.halves
    ? [{ rect: at.halves.top, colour: EXIT_COLOURS.crop }, { rect: at.halves.bottom, colour: EXIT_COLOURS.bottom }]
    : [{ rect: at.crop, colour: EXIT_COLOURS.crop }]
  const shot = keys.shots.find((s) => frame >= s.from && frame < s.to)
  const own = samples.filter((s) => s.shot === shot?.index)
  if (own.length > 0) {
    const near = own.reduce((a, b) => (Math.abs(b.frame - frame) < Math.abs(a.frame - frame) ? b : a))
    // Within half a second of clip time: a face further off is not this frame's.
    if (Math.abs(near.frame - frame) <= Math.ceil(keys.fps / 2)) {
      for (const t of near.tests) boxes.push({ rect: t.face, colour: EXIT_COLOURS.face })
    }
  }
  return { file, size: keys.source, boxes }
}

/**
 * Score every followed clip of `project` and draw its cuts and shots into
 * `root` (already emptied), then write root/README.txt. `projectDir` finds an
 * asset that moved with its project (relink's `candidatePaths`).
 */
async function writeExit(
  project: Project,
  root: string,
  options: { projectDir?: string | null; projectName?: string; sheetHeight?: number } = {}
): Promise<{ reports: ClipReport[]; readme: string[] }> {
  const fps = project.settings.fps
  const reports: ClipReport[] = []
  for (const [i, clip] of followedClips(project).entries()) {
    const asset = project.assets.find((a) => a.id === clip.assetId)
    const name = asset?.name ?? clip.assetId
    const folder = exitFolderName(i + 1, name)
    const row = scoreFollowedClip(project, clip, fps)!
    const report: ClipReport = { n: i + 1, name, start: clip.start / fps, folder, row, files: [], outside: [], heldFrames: [] }
    reports.push(report)
    const keys = followKeys(project, clip, fps)
    if (!asset || !keys) {
      report.skipped = 'no subject track for this file: nothing drawn'
      continue
    }
    if (clip.hold) {
      report.skipped = 'a held frame: nothing drawn'
      continue
    }
    const file = candidatePaths(asset, options.projectDir ?? null).find((p) => existsSync(p))
    if (!file) {
      report.skipped = `the file is not on this machine (${basename(asset.path)}): nothing drawn`
      continue
    }
    const track = project.subjects?.[clip.assetId]
    const info = await stat(file)
    const key = `${info.size}:${Math.round(info.mtimeMs)}`
    if (track && track.key !== key) report.stale = `the file on disk (${key}) is not the one the track was measured on (${track.key})`

    const samples = exitSamples(project, clip, fps, keys)
    const cuts = exitCuts(project, clip, fps, keys)
    report.outside = samples.filter((s) => !s.inside)
    report.heldFrames = cuts.filter((c) => c.held).map((c) => c.frame)

    const sheets: { name: string; frames: number[] }[] = [
      ...cuts.map((c, k) => ({
        name: `cut-${pad(k + 1, 2)}-f${pad(c.frame, 5)}`,
        frames: [c.frame - 1, c.frame, c.frame + 1].filter((f) => f >= 0 && f < clip.duration)
      })),
      ...keys.shots.map((shot, k) => {
        const f = midFrame(shot, samples)
        return { name: `shot-${pad(k + 1, 2)}-f${pad(f, 5)}`, frames: [f] }
      })
    ]
    const dir = join(root, folder)
    const raw = join(dir, 'raw')
    await mkdir(raw, { recursive: true })
    const wanted = [...new Set(sheets.flatMap((s) => s.frames))].sort((a, b) => a - b)
    const pulled = new Map<number, string>()
    const t0 = Date.now()
    for (let b = 0; b < wanted.length; b += PULL_BATCH) {
      const batch = wanted.slice(b, b + PULL_BATCH)
      const into = join(raw, pad(b / PULL_BATCH, 3))
      await mkdir(into, { recursive: true })
      await run(FFMPEG, exitPullArgs(clip, { path: file }, fps, keys, batch, join(into, '%05d.png')))
      const got = (await readdir(into)).filter((f) => f.endsWith('.png')).sort()
      if (got.length !== batch.length) throw new Error(`${name}: the pull wrote ${got.length} of ${batch.length} frames (${batch[0]}–${batch[batch.length - 1]})`)
      batch.forEach((f, j) => pulled.set(f, join(into, got[j])))
    }
    report.pullMs = Date.now() - t0
    const t1 = Date.now()
    const height = options.sheetHeight ?? Math.min(540, keys.source.height)
    for (const sheet of sheets) {
      const panels = sheet.frames.map((f) => panelFor(project, clip, keys, samples, f, pulled.get(f)!))
      const out = join(dir, `${sheet.name}.png`)
      await run(FFMPEG, exitSheetArgs(panels, out, height))
      report.files.push(basename(out))
    }
    report.sheetsMs = Date.now() - t1
    await rm(raw, { recursive: true, force: true })
  }

  const s = (ms: number | undefined): string => (ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} s`)
  const both = reports.filter((r) => {
    const bars = exitBars(r.row)
    return bars.inside === 'met' && bars.held === 'met'
  }).length
  const readme = [
    `Step 1's exit, read (docs/CLIPS.md §4.10) — ${new Date().toISOString()}`,
    `Project: ${options.projectName ?? project.name}, ${fps} fps, canvas ${project.settings.width}×${project.settings.height}; ${reports.length} followed clip(s).`,
    '',
    `The bars: the face inside its crop on ≥ ${EXIT_BARS.insideShare * 100} % of the samples that hold one (on a stacked two-up, each face inside its own half);`,
    `${EXIT_BARS.heldAcrossCut} crops held across a cut; and your rating ≥ 4 of 5 on ≥ 8 of 10 clips — the rating column is yours to fill in.`,
    '',
    ...exitTable(reports.map((r) => ({ name: r.name, row: r.row }))),
    '',
    `Both measured bars met on ${both} of ${reports.length} clip(s).`,
    '',
    'The frames. Each clip has a folder, numbered as the table is: cut-NN-fFFFFF.png for each cut (clip frames',
    'F−1 | F | F+1, F the cut’s first frame) and shot-NN-fFFFFF.png, one frame inside each shot. Each is the',
    'SOURCE frame the export shows on that clip frame (its own seek, retime and fps clock), uncropped: the crop',
    'in red (a stacked two-up: the top half red, the bottom half blue), and the faces of the nearest sample in',
    'the same shot, within half a second, in green. The share is counted on every sample; the frames are for looking.',
    ''
  ]
  for (const r of reports) {
    readme.push(`${r.n}. ${r.name}, at ${r.start.toFixed(2)} s on the timeline (folder ${r.folder})`)
    if (r.skipped) readme.push(`   ${r.skipped}`)
    if (r.stale) readme.push(`   NOTE: ${r.stale}`)
    for (const note of r.row.notes) readme.push(`   path: ${note}`)
    if (r.heldFrames.length > 0) readme.push(`   held across a cut at clip frame(s) ${r.heldFrames.join(', ')}`)
    if (r.outside.length > 0) {
      const shown = r.outside.slice(0, 20).map((o) => `f${o.frame} (${(o.ms / 1000).toFixed(2)} s, shot ${o.shot + 1}${o.twoUp ? ', two-up' : ''})`)
      readme.push(`   outside (${r.outside.length}): ${shown.join(', ')}${r.outside.length > 20 ? ', …' : ''}`)
    }
    if (!r.skipped) readme.push(`   ${r.files.length} sheet(s); frames pulled in ${s(r.pullMs)}, drawn in ${s(r.sheetsMs)}`)
  }
  await writeNote(root, readme)
  return { reports, readme }
}

/** The last run's sheets, by name; a numbered folder holding anything else is not this reader's. */
const OURS = /^(?:(?:cut|shot)-\d+-f\d+\.png|raw)$/

/**
 * The real run's folder, cleared of the LAST run's output only — not
 * `outputDir`, which empties the whole folder: the user keeps the clips
 * themselves beside it (tests/output/reframe-real/source/ held a 207 MB
 * download when this was written), and a run that read them must not delete
 * them first. So: the numbered clip folders this reader writes, and only
 * when they hold nothing else (otherwise it stops and says which); and the
 * last README.txt, which may hold the user's ratings, kept as
 * README.<its time>.txt rather than removed.
 */
async function clearedRoot(name: string): Promise<string> {
  const root = join(OUTPUT_ROOT, name)
  await mkdir(root, { recursive: true })
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const at = join(root, entry.name)
    if (entry.isFile() && entry.name === 'README.txt') {
      const stamp = new Date((await stat(at)).mtimeMs).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
      await rename(at, join(root, `README.${stamp}.txt`))
    } else if (entry.isDirectory() && /^\d+-/.test(entry.name)) {
      const inside = await readdir(at)
      const foreign = inside.filter((f) => !OURS.test(f))
      if (foreign.length > 0) throw new Error(`tests/output/${name}/${entry.name} holds files this reader did not write (${foreign.slice(0, 3).join(', ')}): move them, then run again`)
      await rm(at, { recursive: true, force: true })
    }
  }
  return root
}

/* ------------------------------------------------ the synthetic check */

const W = 640
const H = 360
const FPS = 30
/**
 * The source is 24 fps on the 30 fps project, as wedding footage often is, so
 * only the export's own clock puts each source frame on its clip frame (a
 * `select` on the source's frame count would read frame 38 of the clip from
 * 1.79 s, past the cut). It cuts from dark to light at 1.5 s — project frame
 * 45 — and the clip starts on project frame 6 (0.2 s), so the cut is clip
 * frame 39.
 */
const SOURCE_FPS = 24
const CUT = 45
const IN = 6
const DARK = '0x202020'
const LIGHT = '0xC0C0C0'

const face = (cx: number, cy = 0.32): FaceBox => ({ x: Number((cx - 0.04).toFixed(4)), y: Number((cy - 0.07).toFixed(4)), width: 0.08, height: 0.14, score: 0.9 })

/** Shot 1 one face at x 0.25; shot 2 two people at 0.2 and 0.8, a stacked two-up on a 9:16 canvas. */
function syntheticTrack(key: string): SubjectTrack {
  const durationMs = 3000
  const cut = printedMs(CUT / FPS)
  const samples: SubjectSample[] = []
  for (let ms = 0; ms < durationMs; ms += 500) samples.push({ ms, faces: ms < cut ? [face(0.25)] : [face(0.8, 0.55), face(0.2)] })
  return {
    key,
    version: SUBJECT_TRACK_VERSION,
    width: W,
    height: H,
    durationMs,
    shots: [
      { startMs: 0, endMs: cut, score: 0 },
      { startMs: cut, endMs: durationMs, score: 0.9 }
    ],
    samples,
    perShot: [{}, {}],
    detector: 'hand-built (no detector)',
    scene: { threshold: 0.3, minShotMs: 500, backend: 'ffmpeg-select-rgb24' },
    at: '2026-10-14T00:00:00.000Z'
  }
}

/** `key` is the made file's own `size:mtime`, as main's fileKey writes it. */
function syntheticProject(path: string, key: string): Project {
  const asset: MediaAsset = { id: 'a', path, name: 'two shots.mp4', kind: 'video', durationFrames: 72, width: W, height: H, fps: SOURCE_FPS, hasVideo: true, hasAudio: false, size: 1 }
  const clip: Clip = {
    id: 'c', assetId: 'a', trackId: 'v1', start: 0, duration: 80, inPoint: IN, volume: 1,
    transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR }, follow: { version: 1 }
  }
  const base = emptyProject('exit check')
  return { ...base, settings: { ...base.settings, width: 1080, height: 1920, fps: FPS }, assets: [asset], clips: [clip], subjects: { a: syntheticTrack(key) } }
}

/** One pixel of a PNG, RGB. */
async function pixel(file: string, x: number, y: number): Promise<[number, number, number]> {
  const { stdout } = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer' })
  const b = stdout as unknown as Buffer
  return [b[0], b[1], b[2]]
}

const isRed = ([r, g, b]: number[]): boolean => r > 200 && g < 60 && b < 60
const isGreen = ([r, g, b]: number[]): boolean => g > 200 && r < 60 && b < 60
const isBlue = ([r, g, b]: number[]): boolean => b > 200 && r < 60 && g > 120 && g < 200

describe('the exit reader’s ffmpeg, on a clip made here', () => {
  it('pulls the frames the export shows and draws the crops, halves and faces on them', async () => {
    const root = await outputDir('reframe-exit')
    const source = join(root, 'two shots.mp4')
    await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=${DARK}:s=${W}x${H}:r=${SOURCE_FPS}:d=1.5`,
      '-f', 'lavfi', '-i', `color=c=${LIGHT}:s=${W}x${H}:r=${SOURCE_FPS}:d=1.5`,
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p', '-c:v', 'libx264', '-g', '30', source
    ])
    const made = await stat(source)
    const project = syntheticProject(source, `${made.size}:${Math.round(made.mtimeMs)}`)
    const clip = project.clips[0]
    const keys = followKeys(project, clip, FPS)!
    expect(keys.shots.map((s) => [s.from, s.why]), 'the premise: one face, then a stacked two-up from clip frame 39').toEqual([[0, 'face'], [CUT - IN, 'two-up']])

    const { reports, readme } = await writeExit(project, root, { projectName: 'the synthetic check', sheetHeight: H })
    expect(reports).toHaveLength(1)
    const [r] = reports
    expect(r.row).toMatchObject({ shots: 2, twoUp: 1, cuts: 1, heldAcrossCut: 0, samplesWithFace: 5, insideShare: 1 })
    expect(r.folder).toBe('1-two shots')
    expect(r.stale, 'the track is the file’s own').toBeUndefined()
    const cutSheet = `cut-01-f${pad(CUT - IN, 5)}.png`
    expect(r.files[0]).toBe(cutSheet)
    expect(r.files.slice(1)).toEqual([expect.stringMatching(/^shot-01-f\d{5}\.png$/), expect.stringMatching(/^shot-02-f\d{5}\.png$/)])
    expect(readme.join('\n')).toContain('| rating (1–5) |')
    expect(readme.join('\n')).toContain('Both measured bars met on 1 of 1 clip(s).')
    const dir = join(root, r.folder)
    expect(await readdir(dir), 'the raw frames are cleared').not.toContain('raw')

    // The cut sheet: clip frames 38 | 39 | 40, each 640 wide. Frame 38 is the dark shot's, 39 and 40 the light one's.
    const sheet = join(dir, cutSheet)
    const background = await Promise.all([0, 1, 2].map((p) => pixel(sheet, p * W + W - 4, H - 4)))
    expect(background.map((c) => c[0] < 64), 'cut − 1 dark, the cut and after light').toEqual([true, false, false])

    // Cut − 1: one crop, red, where followAt puts it; the shot-1 face green.
    const before = followAt(keys, CUT - IN - 1)
    expect(cropAt(project, clip, null, CUT - IN - 1).halves, 'the premise: one crop on cut − 1').toBeUndefined()
    expect(isRed(await pixel(sheet, before.crop.x + 1, H / 2)), 'the crop’s left edge on cut − 1').toBe(true)
    const f1 = face(0.25)
    expect(isGreen(await pixel(sheet, Math.round(f1.x * W) + 1, Math.round((f1.y + f1.height / 2) * H))), 'the face on cut − 1').toBe(true)

    // The cut: the two halves, top red at the left face, bottom blue at the right.
    const on = followAt(keys, CUT - IN).halves!
    expect(on.top.x).toBeLessThan(on.bottom.x)
    expect(isRed(await pixel(sheet, W + on.top.x + 1, on.top.y + on.top.height / 2)), 'the top half’s left edge').toBe(true)
    expect(isBlue(await pixel(sheet, W + on.bottom.x + 1, on.bottom.y + on.bottom.height / 2)), 'the bottom half’s left edge').toBe(true)
    const right = face(0.8, 0.55)
    expect(isGreen(await pixel(sheet, W + Math.round(right.x * W) + 1, Math.round((right.y + right.height / 2) * H))), 'the right face on the cut').toBe(true)
  }, 120_000)
})

describe('the real run’s folder', () => {
  it('clears only what the reader wrote: the user’s clips beside it stay, the last README is kept', async () => {
    const name = 'reframe-exit-clear'
    const root = await outputDir(name)
    await mkdir(join(root, 'source'), { recursive: true })
    await writeFile(join(root, 'source', 'clip.mp4'), 'the user’s download')
    await mkdir(join(root, '1-talk'), { recursive: true })
    await writeFile(join(root, '1-talk', 'cut-01-f00039.png'), '')
    await writeFile(join(root, '1-talk', 'shot-02-f00054.png'), '')
    await writeFile(join(root, 'README.txt'), '| 1 | talk.mp4 | … | 4 |')
    await clearedRoot(name)
    const left = await readdir(root)
    expect(left).toContain('source')
    expect(await readFile(join(root, 'source', 'clip.mp4'), 'utf8')).toBe('the user’s download')
    expect(left).not.toContain('1-talk')
    expect(left).not.toContain('README.txt')
    const kept = left.filter((f) => /^README\.\d{8}T\d{6}Z\.txt$/.test(f))
    expect(kept, 'the last README, ratings and all').toHaveLength(1)
    expect(await readFile(join(root, kept[0]), 'utf8')).toBe('| 1 | talk.mp4 | … | 4 |')
    // A numbered folder holding something else is the user's: the run stops rather than delete it.
    await mkdir(join(root, '2-mine'), { recursive: true })
    await writeFile(join(root, '2-mine', 'notes.txt'), 'mine')
    await expect(clearedRoot(name)).rejects.toThrow(/2-mine holds files this reader did not write \(notes\.txt\)/)
    expect(await readFile(join(root, '2-mine', 'notes.txt'), 'utf8')).toBe('mine')
  })
})

/* -------------------------------------------------- the user's real run */

describe.skipIf(PROJECT_FILE === '')(`step 1's exit on a saved project (${COMMAND})`, () => {
  it('scores every followed clip and draws its cuts and shots into tests/output/reframe-real/', async () => {
    expect(existsSync(PROJECT_FILE), `FORGE_REFRAME_EXIT names no file: ${PROJECT_FILE}`).toBe(true)
    // The app's own read path: the same parse, migration and track check `project:open` runs.
    const file = deserializeProject(JSON.parse(await readFile(PROJECT_FILE, 'utf8')))
    const root = await clearedRoot('reframe-real')
    const { reports, readme } = await writeExit(file.project, root, { projectDir: dirname(PROJECT_FILE), projectName: basename(PROJECT_FILE) })
    console.log(readme.join('\n'))
    expect(reports.length, 'the project follows no clip').toBeGreaterThan(0)
  }, 4 * 60 * 60_000)
})
