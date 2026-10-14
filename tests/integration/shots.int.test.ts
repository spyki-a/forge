import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCENE_DEFAULTS } from '@shared/reframe/shots'
import { findShots } from '../../src/main/ffmpeg/shots'
import { probeWithClock } from '../../src/main/ffmpeg/probe'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { FFMPEG, makeColour, outputDir, run, writeNote } from './output'

/*
 * The shot finder on the bundled ffmpeg (docs/CLIPS.md §4.2, §4.9), THROUGH
 * src/main/ffmpeg/shots.ts — the runner a user's analysis takes, on
 * runFfmpeg — never sceneArgs with an execFile of its own, which would pass
 * with runFfmpeg's `-loglevel error` in place (every clip one shot, no error).
 *
 * The media is made here: five colours two seconds each, cut at 2/4/6/8 s,
 * lossless. Red→blue saturates on rgb24 (1.000) and scores 0.40 on the Mac's
 * Y-only path, so T = 0.5 finds it only on rgb24. The two grey cuts do not
 * saturate (|ΔA|/100: 0.400 and 0.200), and they are what tell the RGB
 * formula from the Y one, so their scores are held to a committed table on
 * both builds: a formula difference fails CI rather than landing in a README.
 *
 * Artefacts and the measured numbers: tests/output/shots/.
 */

// Every child the runner spawns, so the cancel can see whether ffmpeg is gone.
const spawned = vi.hoisted(() => ({ children: [] as ChildProcess[] }))
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>()
  const spawn = ((...args: Parameters<typeof real.spawn>) => {
    const child = real.spawn(...args)
    spawned.children.push(child)
    return child
  }) as typeof real.spawn
  return { ...real, spawn }
})

interface Table {
  size: { width: number; height: number }
  fps: number
  secondsEach: number
  sources: string[]
  tolerance: number
  cuts: { frame: number; what: string; score: number }[]
}
const TABLE: Table = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'reframe', 'scene-scores.json'), 'utf8'))
const DURATION_MS = TABLE.sources.length * TABLE.secondsEach * 1000
const frameOf = (ms: number): number => Math.round((ms * TABLE.fps) / 1000)

let dir = ''
let CUTS = ''
const notes: string[] = []

/** The table's clip: its sources joined, lossless H.264 (qp 0), as a phone's footage is H.264 4:2:0. */
async function makeCuts(file: string): Promise<string> {
  const { width, height } = TABLE.size
  const inputs = TABLE.sources.flatMap((c) => [
    '-f', 'lavfi', '-i', `color=c=${c}:size=${width}x${height}:rate=${TABLE.fps}:duration=${TABLE.secondsEach}`
  ])
  const joined = `${TABLE.sources.map((_, i) => `[${i}:v]`).join('')}concat=n=${TABLE.sources.length}:v=1:a=0[v]`
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y', ...inputs,
    '-filter_complex', joined, '-map', '[v]', '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', file
  ])
  return file
}

/** One pixel of the frame at `seconds`, through the pass's own scale and conversion: what select scored. */
async function scoredPixel(file: string, seconds: number): Promise<number[]> {
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1',
     '-vf', `scale=${SCENE_DEFAULTS.edge}:-2,format=rgb24`, '-f', 'rawvideo', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 }
  )
  return [...(stdout as unknown as Buffer).subarray(0, 3)]
}

beforeAll(async () => {
  dir = await outputDir('shots')
  CUTS = await makeCuts(join(dir, 'five-cuts.mp4'))
  for (const [i, source] of TABLE.sources.entries()) {
    notes.push(`source ${i} ${source}: scored as rgb ${(await scoredPixel(CUTS, i * TABLE.secondsEach + 1)).join(',')}`)
  }
})

describe('the shot finder, through src/main/ffmpeg/shots.ts', () => {
  it('finds every cut above its threshold on its exact frame, and nothing else', async () => {
    // T 0.3 named here, not the default, which is 1a's to tune: this case is
    // about the frames, and needs a T between the table's 0.2 and 0.4.
    const found = await findShots({ path: CUTS, durationMs: DURATION_MS, fps: TABLE.fps, threshold: 0.3 })
    const expected = TABLE.cuts.filter((c) => c.score > 0.3).map((c) => c.frame)
    expect(expected, 'the table has a cut under 0.3, and cuts over it').toHaveLength(TABLE.cuts.length - 1)
    expect(found.cuts.map((c) => frameOf(c.ms))).toEqual(expected)
    // The 0.200 grey cut is the one left out.
    expect(found.cuts.map((c) => frameOf(c.ms))).not.toContain(TABLE.cuts.find((c) => c.score === 0.2)!.frame)
    expect(found.shots.map((s) => frameOf(s.startMs))).toEqual([0, ...expected])
    expect(found.shots[found.shots.length - 1].endMs).toBe(DURATION_MS)
    expect(found.scene).toMatchObject({ threshold: 0.3, backend: 'ffmpeg-select-rgb24' })
    notes.push(`T 0.3: cuts at frames ${found.cuts.map((c) => frameOf(c.ms)).join(', ')}`)
  })

  it('runs at SCENE_DEFAULTS’ threshold when given none, and records it', async () => {
    const T = SCENE_DEFAULTS.threshold
    const found = await findShots({ path: CUTS, durationMs: DURATION_MS, fps: TABLE.fps })
    expect(found.scene).toMatchObject({ threshold: T, minShotMs: SCENE_DEFAULTS.minShotMs, backend: 'ffmpeg-select-rgb24' })
    // The table's cuts over T, wherever 1a puts it. A row within the table's
    // tolerance of T may land either side, so it is left out of both lists.
    const near = (score: number): boolean => Math.abs(score - T) <= TABLE.tolerance
    const nearFrames = TABLE.cuts.filter((c) => near(c.score)).map((c) => c.frame)
    expect(found.cuts.map((c) => frameOf(c.ms)).filter((f) => !nearFrames.includes(f))).toEqual(
      TABLE.cuts.filter((c) => c.score > T && !near(c.score)).map((c) => c.frame)
    )
    notes.push(`T ${T} (the default): cuts at frames ${found.cuts.map((c) => frameOf(c.ms)).join(', ')}`)
  })

  it('finds the red→blue cut at T = 0.5, which only the rgb24 score puts over it', async () => {
    const found = await findShots({ path: CUTS, durationMs: DURATION_MS, fps: TABLE.fps, threshold: 0.5 })
    const redBlue = TABLE.cuts.find((c) => c.what === 'red to blue')!
    expect(found.cuts.map((c) => frameOf(c.ms))).toContain(redBlue.frame)
    expect(found.cuts.map((c) => frameOf(c.ms))).toEqual(TABLE.cuts.filter((c) => c.score > 0.5).map((c) => c.frame))
  })

  it('scores every cut as the committed table says, within its tolerance', async () => {
    // T = 0.1, so the 0.200 grey cut prints too.
    const found = await findShots({ path: CUTS, durationMs: DURATION_MS, fps: TABLE.fps, threshold: 0.1 })
    notes.push(`T 0.1: ${found.cuts.map((c) => `frame ${frameOf(c.ms)} scored ${c.score.toFixed(6)}`).join('; ')}`)
    expect(found.cuts.map((c) => frameOf(c.ms)), 'every cut, and nothing else').toEqual(TABLE.cuts.map((c) => c.frame))
    // Every row's difference at once, so a formula change names the grey cuts too, not only the first row.
    const off = TABLE.cuts.flatMap((row) => {
      const cut = found.cuts.find((c) => frameOf(c.ms) === row.frame)!
      return Math.abs(cut.score - row.score) <= TABLE.tolerance + 1e-9 ? [] : [`${row.what}: ${cut.score}, the table ${row.score}`]
    })
    expect(off).toEqual([])
  })

  it('reads only its window, and gives its cuts and shots in the file’s own time', async () => {
    // 3 s to 7 s holds the cuts at 4 and 6 s; the one at 8 s is a second past it.
    const found = await findShots({ path: CUTS, durationMs: DURATION_MS, fps: TABLE.fps, threshold: 0.1, startMs: 3000, endMs: 7000 })
    expect(found.cuts.map((c) => c.ms)).toEqual([4000, 6000])
    expect(found.shots.map((s) => [s.startMs, s.endMs])).toEqual([[3000, 4000], [4000, 6000], [6000, 7000]])
    // Past a seek the printed pts count from the window, not the file: none is passed on (findShots' note).
    expect(found.shots.filter((s) => 'startPts' in s)).toEqual([])
    expect(found.cuts.filter((c) => 'pts' in c)).toEqual([])
  })

  it('carries each cut’s exact pts from the whole-file pass: the frame’s own pts, as ffprobe reads the file', async () => {
    // T = 0.1: all four cuts. The file's own frame times and its time base. The bundled ffprobe prints
    // frame=pts empty, so best_effort_timestamp (EFFECTS.md §55's probe); its blank lines are skipped,
    // and the count is held to the clip's frames.
    const found = await findShots({ path: CUTS, durationMs: DURATION_MS, fps: TABLE.fps, threshold: 0.1 })
    const { stdout } = await run(ffprobeInstaller.path, [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp', '-of', 'csv=p=0', CUTS
    ], { maxBuffer: 8 << 20 })
    const framePts = stdout.split(/\r?\n/).filter((l) => /^\d+$/.test(l.trim())).map(Number)
    expect(framePts.length, 'every frame of the clip').toBe(DURATION_MS * TABLE.fps / 1000)
    const { timeBase } = await probeWithClock(CUTS)
    expect(timeBase).toEqual({ num: 1, den: 15360 })

    expect(found.shots.map((s) => s.startPts)).toEqual([0, ...TABLE.cuts.map((c) => framePts[c.frame])])
    expect(found.cuts.map((c) => c.pts)).toEqual(TABLE.cuts.map((c) => framePts[c.frame]))
    // And each is its frame exactly: pts × fps / den, where the printed ms is only %.6g.
    expect(found.shots.map((s) => ((s.startPts as number) * TABLE.fps * timeBase!.num) / timeBase!.den)).toEqual([0, ...TABLE.cuts.map((c) => c.frame)])
    notes.push(`the whole-file pass's pts (time base ${timeBase!.num}/${timeBase!.den}): ${found.shots.map((s) => s.startPts).join(', ')}`)
  })

  it('reports progress to the end of the clip, not to its last cut', async () => {
    // -progress reports the output's time. At T = 0.5 the last cut is at 4 s:
    // with select on the output path, ffmpeg's last report was 0.4.
    const reports: number[] = []
    await findShots({ path: CUTS, durationMs: DURATION_MS, fps: TABLE.fps, threshold: 0.5, onProgress: (p) => reports.push(p) })
    expect(reports.length, 'ffmpeg’s reports, then the runner’s closing 1').toBeGreaterThanOrEqual(2)
    expect(reports[reports.length - 1]).toBe(1)
    expect(reports[reports.length - 2], 'ffmpeg’s own last report').toBeGreaterThanOrEqual(0.99)
  })

  it('reports a window’s progress against the window, to its end', async () => {
    // ffmpeg's out_time counts from the window's start: against the whole
    // file's 10 s, the 4 s window's own last report would read 0.4.
    const reports: number[] = []
    await findShots({
      path: CUTS, durationMs: DURATION_MS, fps: TABLE.fps, threshold: 0.1, startMs: 3000, endMs: 7000,
      onProgress: (p) => reports.push(p)
    })
    expect(reports.length, 'ffmpeg’s reports, then the runner’s closing 1').toBeGreaterThanOrEqual(2)
    expect(reports[reports.length - 1]).toBe(1)
    expect(reports[reports.length - 2], 'ffmpeg’s own last report').toBeGreaterThanOrEqual(0.99)
  })

  it('makes one shot of a clip with no cut', async () => {
    const still = await makeColour(join(dir, 'one-shot.mp4'), '0x336699', TABLE.size, 3, TABLE.fps)
    const found = await findShots({ path: still, durationMs: 3000, fps: TABLE.fps })
    expect(found.cuts).toEqual([])
    expect(found.shots).toEqual([{ startMs: 0, endMs: 3000, score: 0, startPts: 0 }])
  })

  it('cancels mid-run, and settles only once ffmpeg is gone', async () => {
    // A flat 4K clip: a tiny file that takes seconds to scale down.
    const long = join(dir, 'long-4k.mp4')
    await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x404040:size=3840x2160:rate=30:duration=20',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', long
    ])
    const before = spawned.children.length
    const control = new AbortController()
    let abortedAt = -1
    const started = Date.now()
    const promise = findShots({
      path: long, durationMs: 20_000, fps: 30, signal: control.signal,
      onProgress: (p) => {
        if (abortedAt < 0 && p > 0 && p < 1) {
          abortedAt = p
          control.abort()
        }
      }
    })
    await expect(promise).rejects.toMatchObject({ name: 'CancelledError' })
    notes.push(`cancelled at ${abortedAt.toFixed(3)} of a 20 s 4K clip, settled after ${Date.now() - started} ms`)
    expect(abortedAt, 'a report mid-run, so the cancel came mid-run').toBeGreaterThan(0)
    expect(abortedAt).toBeLessThan(1)
    // On Windows the kill is a taskkill, spawned too.
    const ffmpegs = spawned.children.slice(before).filter((c) => !/taskkill/i.test(c.spawnfile))
    expect(ffmpegs).toHaveLength(1)
    const child = ffmpegs[0]
    expect(child.exitCode !== null || child.signalCode !== null, 'ffmpeg has exited').toBe(true)
    expect(() => process.kill(child.pid!, 0), 'and no process has its pid').toThrow()
    // ... because the cancel stopped it. A cancel that only set its flag still
    // rejects, but only once ffmpeg has read the whole clip (2.3 s and 8 s in
    // two measured runs), and the analysis queue runs one job at a time.
    // Killed, the exit code is null on POSIX (SIGKILL) and 1 on Windows
    // (taskkill /f); run to the end, it is 0.
    expect(child.exitCode, 'ffmpeg was stopped, not left to run to the end').not.toBe(0)
  })

  it('spawns nothing when the signal is already aborted', async () => {
    const before = spawned.children.length
    const control = new AbortController()
    control.abort()
    await expect(findShots({ path: CUTS, durationMs: DURATION_MS, fps: TABLE.fps, signal: control.signal })).rejects.toMatchObject({
      name: 'CancelledError'
    })
    expect(spawned.children.length).toBe(before)
  })
})

// After every test, failed ones included: a score off the table on one build is what this note is for.
afterAll(async () => {
  if (!dir) return
  await writeNote(dir, [
    'The shot finder (src/main/ffmpeg/shots.ts) on the bundled ffmpeg — docs/CLIPS.md §4.2, §4.9.',
    'five-cuts.mp4: the table’s five sources (tests/fixtures/reframe/scene-scores.json), two seconds each, lossless.',
    ...notes
  ])
})
