import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { buildRenderPlan } from '@shared/render/plan'
import { filterGraphOf } from '@shared/render/graphFile'
import type { MediaAsset, Project } from '@shared/timeline'
import { startRender } from '../../src/main/render/renderJob'
import { FFMPEG, run, outputDir, writeNote } from './output'
import { commandLineLength, cutTimeline } from '../fixtures/longGraph'

/*
 * A long export, through the route a user's export takes — measured on the
 * 2018 build by Windows CI.
 *
 * The plan put the whole filtergraph in one argument, and Windows'
 * CreateProcess takes a command line of at most 32,767 characters. A talk cut
 * into 72 pieces is a graph of about 37 KB, so that export could not start on
 * Windows, while the Mac (ARG_MAX about a megabyte) ran it: a check here that
 * only recorded a length would pass (docs/CLIPS.md §3.7, EFFECTS.md §47). The
 * export now writes the graph to a file and passes `-filter_complex_script`.
 *
 * Why 72 pieces and not the plan's one clip with 360 keyed cuts: that clip
 * cannot render on either build, whatever its route — ffmpeg's expression
 * parser stops at 100 levels of nesting, and a keyed track nests one per key
 * (measured: about 93 keys is the most one track can hold; EFFECTS.md §48).
 * A timeline of cuts is the graph that reaches the limit today.
 *
 * This renders with `startRender` itself, the export job: the plan, the
 * script written beside the job's temporaries, the swap, the bundled ffmpeg.
 * Each source frame shows its own index as ten bars, and every frame of the
 * export is held to the source frame its piece should show.
 *
 * And the same plan with the graph on the command line: on the Mac it must
 * render the same frames, so the script is read exactly as the argument was;
 * on Windows it must NOT start, which is the bug this is for.
 */

const W = 160
const H = 90
const FPS = 30
const BAR = W / 10
const CUTS = 72
const LENGTH = 3
const STRIDE = 12
const SECONDS = 30
const onWindows = process.platform === 'win32'

let dir = ''
let source = ''
const notes: string[] = []

beforeAll(async () => {
  dir = await outputDir('long-graph')
  source = join(dir, 'source.mp4')
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:rate=${FPS}:duration=${SECONDS}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${SECONDS}:sample_rate=48000`,
    '-vf', `geq=lum='if(mod(floor(N/pow(2,floor(X/${BAR}))),2),235,16)':cb=128:cr=128`,
    '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source
  ])
}, 120_000)

afterAll(async () => {
  if (!dir) return
  await writeNote(dir, [
    `A ${SECONDS} s source (each frame's index as ten bars) cut into ${CUTS} pieces of ${LENGTH} frames, ${STRIDE} frames apart in the source.`,
    'script.mp4 is the export job (startRender, -filter_complex_script); inline.mp4 the same plan with the graph on the line.',
    '',
    ...notes
  ])
})

function project(): Project {
  const asset: MediaAsset = {
    id: 'talk', path: source, name: 'source.mp4', kind: 'video', durationFrames: SECONDS * FPS,
    width: W, height: H, fps: FPS, hasVideo: true, hasAudio: true, size: 0
  }
  return cutTimeline(asset, { cuts: CUTS, length: LENGTH, stride: STRIDE, fps: FPS, width: W, height: H })
}

/** Each frame's source index, read off its bars, in order. */
async function indices(file: string): Promise<{ index: number[]; md5: string[] }> {
  const { stdout } = await run(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-vsync', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }
  )
  const bytes = stdout as unknown as Buffer
  const index: number[] = []
  const md5: string[] = []
  for (let at = 0; at + W * H <= bytes.length; at += W * H) {
    const frame = bytes.subarray(at, at + W * H)
    md5.push(createHash('md5').update(frame).digest('hex'))
    let value = 0
    for (let b = 0; b < 10; b++) {
      let sum = 0
      let n = 0
      // Whole rows: H/4 is 22.5 here, and a half row is half a picture across.
      for (let y = Math.ceil(H / 4); y < Math.floor((3 * H) / 4); y++) {
        for (let x = b * BAR + BAR / 4; x < (b + 1) * BAR - BAR / 4; x++) {
          sum += frame[y * W + x]
          n++
        }
      }
      if (sum / n > 128) value |= 1 << b
    }
    index.push(value)
  }
  return { index, md5 }
}

describe(`a ${CUTS}-cut export through the graph script`, () => {
  it('renders every piece on its own source frames, from a graph longer than Windows takes on a command line', async () => {
    const p = project()
    const out = join(dir, 'script.mp4')
    const plan = buildRenderPlan({ project: p, outputPath: out })
    const line = commandLineLength(FFMPEG, plan.args)
    notes.push(`graph ${filterGraphOf(plan.args).length} characters; the plan's argv as a command line ${line}`)
    expect(line, 'the plan with its graph on the line is past the Windows limit').toBeGreaterThan(32_767)

    // The export job, as the app runs it, its temporaries in this check's folder.
    const job = startRender({ project: p, outputPath: out, tempDir: dir }, () => undefined)
    /*
     * The script is written synchronously, before the spawn, so it is on disk
     * the moment the job is handed back — read before anything is awaited.
     * Without this a Mac run could not tell an export that wrote no script
     * from one that removed it: the check below it would pass for both.
     */
    const written = readdirSync(dir).filter((f) => /^graph-[0-9a-f-]{36}\.txt$/.test(f))
    expect(written, 'the export job wrote its graph to one file').toHaveLength(1)
    expect(readFileSync(join(dir, written[0]), 'utf8'), 'the file holds the plan’s graph').toBe(filterGraphOf(plan.args))
    await job.promise
    const left = (await readdir(dir)).filter((f) => f.startsWith('graph-'))
    expect(left, 'the script is removed after a finished export').toEqual([])

    const { index } = await indices(out)
    expect(index.length).toBe(CUTS * LENGTH)
    const wrong = index.flatMap((v, k) => {
      const want = Math.floor(k / LENGTH) * STRIDE + (k % LENGTH)
      return v === want ? [] : [`${k}: ${v} for ${want}`]
    })
    notes.push(`script route: ${index.length} frames, ${wrong.length} on another source frame${wrong.length ? ` (${wrong.slice(0, 5).join('; ')})` : ''}`)
    expect(wrong, 'frames showing another source frame').toEqual([])
  }, 300_000)

  it(onWindows ? 'cannot start with the same graph on the command line (Windows)' : 'renders the same frames with the same graph on the command line', async () => {
    const inline = join(dir, 'inline.mp4')
    const plan = buildRenderPlan({ project: project(), outputPath: inline })
    /*
     * On Windows the refusal is thrown by `spawn` itself, synchronously, before
     * any promise exists — `spawn ENAMETOOLONG`, errno -4064 — so a
     * `.then(null, onError)` on the promise never sees it: CI run 37668502747
     * failed on exactly that, which is also the measurement the test is for.
     * A try/catch takes both the synchronous throw and a rejection.
     */
    let attempt: NodeJS.ErrnoException | null = null
    try {
      await run(FFMPEG, plan.args, { maxBuffer: 64 * 1024 * 1024 })
    } catch (err) {
      attempt = err as NodeJS.ErrnoException
    }
    notes.push(`inline route on ${process.platform}: ${attempt ? `refused (${attempt.code ?? ''} ${attempt.message.split('\n')[0].slice(0, 160)})` : 'rendered'}`)
    if (onWindows) {
      expect(attempt, 'Windows started a command line past 32,767 characters').not.toBeNull()
      // CreateProcess's limit surfaces as ENAMETOOLONG (measured, run 37668502747); E2BIG is the POSIX spelling.
      expect(['ENAMETOOLONG', 'E2BIG'], 'the refusal is the command-line length').toContain(attempt?.code)
      return
    }
    expect(attempt).toBeNull()
    const viaScript = (await indices(join(dir, 'script.mp4'))).md5
    const viaLine = (await indices(inline)).md5
    expect(viaLine.length).toBe(viaScript.length)
    const differ = viaLine.filter((h, i) => h !== viaScript[i]).length
    notes.push(`inline against script: ${differ} of ${viaLine.length} frames differ`)
    expect(differ).toBe(0)
  }, 300_000)
})
