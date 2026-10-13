import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSceneLog, sceneArgs, sceneLogReader, shotsFrom, type SceneCut } from '@shared/reframe/shots'
import type { Shot } from '@shared/reframe/types'
import { lineSplitter, runFfmpeg } from '../src/main/ffmpeg/run'

/*
 * The shot finder's pure half (src/shared/reframe/shots.ts, docs/CLIPS.md
 * §4.2) and what it needs of runFfmpeg (src/main/ffmpeg/run.ts): the
 * arguments, ffmpeg's own stderr read back, cuts into shots, and stderr
 * handed over a whole line at a time. The run against the bundled ffmpeg is
 * tests/integration/shots.int.test.ts.
 */

// runFfmpeg's child, faked where a test sets one; the real spawn otherwise.
const fake = vi.hoisted(() => ({ child: null as unknown, unlinked: [] as string[] }))
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>()
  const spawn = ((...args: Parameters<typeof real.spawn>) => (fake.child ?? real.spawn(...args)) as ReturnType<typeof real.spawn>) as typeof real.spawn
  return { ...real, spawn }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return { ...real, unlink: async (path: unknown) => void fake.unlinked.push(String(path)) }
})

const FIXTURES = join(__dirname, 'fixtures', 'reframe')
// LF, as .gitattributes checks it out; the CRLF case is made from it below.
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8').replace(/\r\n/g, '\n')

describe('the scene pass’s arguments', () => {
  const vfOf = (args: string[]): string => {
    expect(args.filter((a) => a === '-vf'), 'one -vf').toHaveLength(1)
    return args[args.indexOf('-vf') + 1]
  }

  it('scores on rgb24, converted after the scale and before select, and prints select’s score', () => {
    const vf = vfOf(sceneArgs('/media/clip.mp4', { threshold: 0.3, edge: 320 }))
    // Each anchor once, so the ordered shape below is about THE conversion and THE select.
    expect([...vf.matchAll(/format=rgb24/g)], vf).toHaveLength(1)
    expect([...vf.matchAll(/select=/g)], vf).toHaveLength(1)
    // The scale first (the conversion is of a 320-wide frame), rgb24 next, then select, and the print straight after it.
    expect(vf).toMatch(/^scale=320:-2,format=rgb24,.*\bselect='gt\(scene,0\.3\)',metadata=print\b/)
  })

  it('sends every frame on to the output and prints from a branch of its own', () => {
    // -progress reports the OUTPUT's time: with select on the output path it
    // sat at the last cut found, and said nothing before the first (measured).
    const vf = vfOf(sceneArgs('/media/clip.mp4', { threshold: 0.3, edge: 320 }))
    const chains = vf.split(';')
    const scored = chains.filter((c) => c.includes('select='))
    expect(scored, vf).toHaveLength(1)
    expect(scored[0].split(','), 'the scored branch ends in nullsink').toEqual(expect.arrayContaining(['metadata=print']))
    expect(scored[0].endsWith(',nullsink'), scored[0]).toBe(true)
    const output = chains.filter((c) => !c.endsWith('nullsink'))
    expect(output, 'one chain leads to the output').toHaveLength(1)
    expect(output[0], 'and nothing on it drops a frame').not.toMatch(/select=/)
    expect(output[0]).toMatch(/\bsplit\[(\w+)\]$/)
    expect(scored[0].startsWith(`[${/\bsplit\[(\w+)\]$/.exec(output[0])![1]}]`), 'the split feeds the scored branch').toBe(true)
  })

  it('drops the audio and writes nothing: -an, then -f null -', () => {
    const args = sceneArgs('/media/clip.mp4', { threshold: 0.3, edge: 320 })
    expect(args).toContain('-an')
    expect(args.indexOf('-an')).toBeGreaterThan(args.indexOf('-i'))
    expect(args.slice(-3)).toEqual(['-f', 'null', '-'])
  })

  it('puts no path in the graph: the file is one argument, after -i, as it came', () => {
    const path = 'C:\\Weddings\\Bride 5:30pm, take [2].mp4'
    const args = sceneArgs(path, { threshold: 0.3, edge: 320 })
    expect(args[args.indexOf('-i') + 1]).toBe(path)
    expect(vfOf(args)).not.toContain('Bride')
    expect(vfOf(args)).not.toContain('file=')
  })

  it('reads a window with -ss and -t BEFORE -i, so the graph never sees past it', () => {
    // After -i, -t trims the output at the end of the graph, and the scored
    // branch never reaches that trim: a 4 s window printed a cut a second
    // past its end (measured). The integration test runs it.
    const args = sceneArgs('/media/clip.mp4', { threshold: 0.3, edge: 320, startMs: 3500, endMs: 8034 })
    const input = args.indexOf('-i')
    expect(args.indexOf('-ss')).toBeGreaterThanOrEqual(0)
    expect(args.indexOf('-ss')).toBeLessThan(input)
    expect(args.indexOf('-t')).toBeGreaterThanOrEqual(0)
    expect(args.indexOf('-t')).toBeLessThan(input)
    expect(args[args.indexOf('-ss') + 1]).toBe('3.5')
    expect(args[args.indexOf('-t') + 1]).toBe('4.534')
    // The whole file: neither.
    const whole = sceneArgs('/media/clip.mp4', { threshold: 0.3, edge: 320 })
    expect(whole).not.toContain('-ss')
    expect(whole).not.toContain('-t')
    // From 0 to a point: only the length.
    const head = sceneArgs('/media/clip.mp4', { threshold: 0.3, edge: 320, endMs: 2000 })
    expect(head).not.toContain('-ss')
    expect(head.slice(head.indexOf('-t'), head.indexOf('-t') + 2)).toEqual(['-t', '2'])
  })

  it('refuses a threshold that is not a score, and a window that ends before it starts', () => {
    expect(() => sceneArgs('/m.mp4', { threshold: 0, edge: 320 })).toThrow()
    expect(() => sceneArgs('/m.mp4', { threshold: 1, edge: 320 })).toThrow()
    expect(() => sceneArgs('/m.mp4', { threshold: Number.NaN, edge: 320 })).toThrow()
    expect(() => sceneArgs('/m.mp4', { threshold: 0.3, edge: 320, startMs: 2000, endMs: 2000 })).toThrow()
  })
})

describe('parseSceneLog over ffmpeg’s own stderr', () => {
  // Each fixture is the bundled Mac ffmpeg's whole stderr for sceneArgs on a
  // synthetic clip (tests/integration/shots.int.test.ts's, and a 29.97 fps one
  // cut at frames 61 and 107), run at the runner's -loglevel info.
  it('reads each picked frame’s time and score — the five-source clip at T = 0.1', () => {
    expect(parseSceneLog(fixture('five-cuts-t0.1.stderr.txt'))).toEqual([
      { ms: 2000, score: 1 },
      { ms: 4000, score: 1 },
      { ms: 6000, score: 0.4 },
      { ms: 8000, score: 0.2 }
    ])
  })

  it('counts from where the pass began reading — the window 3.5 s to 8.034 s', () => {
    expect(parseSceneLog(fixture('five-cuts-window.stderr.txt'))).toEqual([
      { ms: 500, score: 1 },
      { ms: 2500, score: 0.4 },
      { ms: 4500, score: 0.2 }
    ])
  })

  it('names the frame at 29.97 fps from six significant digits', () => {
    const cuts = parseSceneLog(fixture('odd-frames.stderr.txt'))
    expect(cuts.map((c) => c.ms)).toEqual([2035.37, 3570.23])
    expect(cuts.map((c) => Math.round((c.ms * 30000) / 1001 / 1000))).toEqual([61, 107])
  })

  it('reads a long timestamp, which the %-7s padding no longer separates by three spaces', () => {
    // Measured: past 10,000,000 in the time base the pts column overflows its
    // width and one space is left — 'pts:18993151 pts_time:1236.53' at 20 min
    // 36 s on a 15,360/s time base. The frame line is read by its words, not
    // its columns.
    const text = [
      '[Parsed_metadata_4 @ 0x1] frame:7    pts:18993151 pts_time:1236.53',
      '[Parsed_metadata_4 @ 0x1] lavfi.scene_score=0.731000',
      '[Parsed_metadata_4 @ 0x1] frame:8    pts:189657600 pts_time:12347.5',
      '[Parsed_metadata_4 @ 0x1] lavfi.scene_score=1.000000'
    ].join('\n')
    expect(parseSceneLog(text)).toEqual([
      { ms: 1236530, score: 0.731 },
      { ms: 12347500, score: 1 }
    ])
  })

  it('pairs a time with its score by the filter’s prefix, whatever lands between them', () => {
    const lines = fixture('five-cuts-t0.1.stderr.txt').split('\n')
    const between = lines.flatMap((line) =>
      line.includes('] frame:')
        ? [line, '[h264 @ 0x7f8] co located POCs unavailable', '[Parsed_metadata_9 @ 0x1] frame:0    pts:1       pts_time:9.5']
        : [line]
    )
    expect(parseSceneLog(between.join('\n'))).toEqual(parseSceneLog(lines.join('\n')))
    expect(parseSceneLog(between.join('\n'))).toHaveLength(4)
  })

  it('reads Windows line endings, and skips a frame with no timestamp', () => {
    const text = fixture('five-cuts-t0.1.stderr.txt')
    expect(parseSceneLog(text.replace(/\n/g, '\r\n'))).toEqual(parseSceneLog(text))
    const nopts = text.replace('pts:61440   pts_time:4', 'pts:NOPTS   pts_time:NOPTS')
    expect(nopts).not.toBe(text)
    expect(parseSceneLog(nopts).map((c) => c.ms)).toEqual([2000, 6000, 8000])
  })

  it('reads the same a line at a time, as the runner feeds it', () => {
    const reader = sceneLogReader()
    for (const line of fixture('five-cuts-window.stderr.txt').split('\n')) reader.line(line)
    expect(reader.cuts()).toEqual(parseSceneLog(fixture('five-cuts-window.stderr.txt')))
  })
})

describe('shotsFrom', () => {
  const at = (ms: number, score = 1): SceneCut => ({ ms, score })
  const bounds = (shots: Shot[]): number[] => [...shots.map((s) => s.startMs), shots[shots.length - 1].endMs]
  const o = { minShotMs: 500, skipHeadFrames: 3 }

  /** The shape every result must have: from 0 to the end, in order, no gap, nothing empty. */
  const expectTiles = (shots: Shot[], durationMs: number): void => {
    expect(shots.length).toBeGreaterThan(0)
    expect(shots[0].startMs).toBe(0)
    expect(shots[shots.length - 1].endMs).toBe(durationMs)
    for (let i = 0; i < shots.length; i++) {
      expect(shots[i].endMs).toBeGreaterThan(shots[i].startMs)
      if (i > 0) expect(shots[i].startMs).toBe(shots[i - 1].endMs)
    }
  }

  it('makes one shot of the whole from no cuts', () => {
    expect(shotsFrom([], 10_000, 30, o)).toEqual([{ startMs: 0, endMs: 10_000, score: 0 }])
  })

  it('opens each shot with its cut’s score, the first with 0', () => {
    const shots = shotsFrom([at(2000, 1), at(4000, 0.4)], 10_000, 30, o)
    expect(shots).toEqual([
      { startMs: 0, endMs: 2000, score: 0 },
      { startMs: 2000, endMs: 4000, score: 1 },
      { startMs: 4000, endMs: 10_000, score: 0.4 }
    ])
  })

  it('drops a cut within skipHeadFrames of 0 — a recording’s first frames — and keeps the next', () => {
    // minShot 0, so only the head-skip can drop them. 30 fps: frames 0, 1, 3 and 4.
    const cuts = [at(0), at(1000 / 30), at(100), at(400 / 3)]
    const shots = shotsFrom(cuts, 2000, 30, { minShotMs: 0, skipHeadFrames: 3 })
    expect(bounds(shots)).toEqual([0, 400 / 3, 2000])
  })

  it('merges a short shot into its LONGER neighbour, the next', () => {
    // 2000 | 200 | 7800: the 200 joins the 7800, which now opens at 2000 with its cut.
    const shots = shotsFrom([at(2000, 0.9), at(2200, 0.5)], 10_000, 30, o)
    expect(shots).toEqual([
      { startMs: 0, endMs: 2000, score: 0 },
      { startMs: 2000, endMs: 10_000, score: 0.9 }
    ])
  })

  it('merges a short shot into its LONGER neighbour, the previous', () => {
    // 7800 | 200 | 2000: the 200 joins the 7800, and the cut at 8000 stays.
    const shots = shotsFrom([at(7800, 0.9), at(8000, 0.5)], 10_000, 30, o)
    expect(shots).toEqual([
      { startMs: 0, endMs: 8000, score: 0 },
      { startMs: 8000, endMs: 10_000, score: 0.5 }
    ])
  })

  it('joins a chain of short shots to the long shots either side, the shortest first', () => {
    // 2000 | 100 | 100 | 100 | 3000
    const shots = shotsFrom([at(2000), at(2100), at(2200), at(2300)], 5300, 30, o)
    expect(bounds(shots)).toEqual([0, 2200, 5300])
  })

  it('on neighbours of one length, removes the weaker cut', () => {
    // 1000 | 200 | 1000: the cut at 1000 is weaker, so the short shot joins the first.
    expect(bounds(shotsFrom([at(1000, 0.35), at(1200, 0.9)], 2200, 30, o))).toEqual([0, 1200, 2200])
    expect(bounds(shotsFrom([at(1000, 0.9), at(1200, 0.35)], 2200, 30, o))).toEqual([0, 1000, 2200])
  })

  it('on neighbours of one length and cuts of one score, removes the earlier cut', () => {
    // 1000 | 200 | 1000, both cuts 1: the short shot joins the first, so the cut at 1000 goes.
    expect(shotsFrom([at(1000, 1), at(1200, 1)], 2200, 30, o)).toEqual([
      { startMs: 0, endMs: 1200, score: 0 },
      { startMs: 1200, endMs: 2200, score: 1 }
    ])
  })

  it('keeps one cut per frame, the higher score; ignores order and a cut at or past the end', () => {
    // 2000 and 2000.01 are both frame 60 at 30 fps.
    const shots = shotsFrom([at(6000, 0.4), at(2000, 0.5), at(2000.01, 0.8), at(10_000), at(12_000)], 10_000, 30, o)
    expect(shots).toEqual([
      { startMs: 0, endMs: 2000.01, score: 0 },
      { startMs: 2000.01, endMs: 6000, score: 0.8 },
      { startMs: 6000, endMs: 10_000, score: 0.4 }
    ])
  })

  it('tiles the duration whatever it is given — and a clip shorter than minShot is one shot', () => {
    let seed = 7
    const next = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    for (let round = 0; round < 200; round++) {
      const durationMs = 1000 + Math.floor(next() * 60_000)
      const cuts = Array.from({ length: Math.floor(next() * 40) }, () => at(next() * durationMs * 1.1 - 50, next()))
      const minShotMs = [0, 100, 500, 2000][round % 4]
      const shots = shotsFrom(cuts, durationMs, [24, 30, 60][round % 3], { minShotMs, skipHeadFrames: 3 })
      expectTiles(shots, durationMs)
      if (shots.length > 1) for (const s of shots) expect(s.endMs - s.startMs).toBeGreaterThanOrEqual(minShotMs)
    }
    expect(shotsFrom([at(100), at(200)], 400, 30, o)).toEqual([{ startMs: 0, endMs: 400, score: 0 }])
  })

  it('merges a strobe — a cut on every frame of ten minutes — into shots of at least minShot', () => {
    const cuts = Array.from({ length: 18_000 }, (_, f) => at((f * 1000) / 30, 0.3 + (f % 7) / 10))
    const shots = shotsFrom(cuts, 600_000, 30, o)
    expectTiles(shots, 600_000)
    for (const s of shots) expect(s.endMs - s.startMs).toBeGreaterThanOrEqual(500)
  })
})

describe('runFfmpeg, for an analysis', () => {
  type Child = EventEmitter & { pid: undefined; killed: boolean; stdout: EventEmitter; stderr: EventEmitter }
  const child = (): Child => {
    const stream = (): EventEmitter => Object.assign(new EventEmitter(), { setEncoding: () => undefined })
    // No pid: killProcess returns before signalling anything real.
    const c = Object.assign(new EventEmitter(), { pid: undefined, killed: false, stdout: stream(), stderr: stream(), kill: () => true })
    fake.child = c
    return c
  }
  afterEach(() => {
    fake.child = null
    fake.unlinked = []
  })

  /** Run with stderr handed over in `size`-character pieces, then closed with `code`. */
  const runWith = (text: string, size: number, code: number, outputPath: string | null = null) => {
    const c = child()
    const lines: string[] = []
    const handle = runFfmpeg({ args: [], complete: true, durationMs: null, outputPath, onProgress: () => undefined, onStderrLine: (l) => lines.push(l) })
    for (let i = 0; i < text.length; i += size) c.stderr.emit('data', text.slice(i, i + size))
    c.emit('close', code)
    return { lines, promise: handle.promise }
  }

  it('hands every stderr line over whole, however the pipe chunks it', async () => {
    const text = fixture('five-cuts-t0.1.stderr.txt')
    const whole = text.split('\n').slice(0, -1)
    for (const crlf of [false, true]) {
      for (const size of [1, 2, 3, 5, 7, 64, text.length]) {
        const { lines, promise } = runWith(crlf ? text.replace(/\n/g, '\r\n') : text, size, 0)
        await promise
        expect(lines, `${size}-character chunks${crlf ? ', CRLF' : ''}`).toEqual(whole)
        expect(parseSceneLog(lines.join('\n'))).toHaveLength(4)
      }
    }
  })

  it('splits at every offset as one read would, and keeps a last line with no ending', () => {
    const text = 'a\r\nbb\rccc\n\ndddd'
    const expected = ['a', 'bb', 'ccc', '', 'dddd']
    for (let k = 0; k <= text.length; k++) {
      const got: string[] = []
      const split = lineSplitter((l) => got.push(l))
      split.push(text.slice(0, k))
      split.push(text.slice(k))
      split.end()
      expect(got, `split at ${k}`).toEqual(expected)
    }
  })

  it('fails with the last 12 lines, each whole', async () => {
    const text = Array.from({ length: 20 }, (_, i) => `[ffmpeg] line ${i} of the error`).join('\n') + '\n'
    const { promise } = runWith(text, 3, 1)
    const err = await promise.catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message.split('\n')).toEqual(Array.from({ length: 12 }, (_, i) => `[ffmpeg] line ${i + 8} of the error`))
  })

  it('hands over a last line with no ending when ffmpeg exits, and fails with it', async () => {
    // ffmpeg dying mid-line leaves its real error unterminated; only the
    // splitter's end() at 'close' delivers it, to the parser and to the tail.
    const { lines, promise } = runWith('[x] first\n[x] the real error, unterminated', 5, 1)
    const err = await promise.catch((e: Error) => e)
    expect(lines).toEqual(['[x] first', '[x] the real error, unterminated'])
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message.split('\n')).toEqual(['[x] first', '[x] the real error, unterminated'])
  })

  it('unlinks nothing for an analysis (outputPath null), and still the file a render was writing', async () => {
    await expect(runWith('[x] no\n', 4, 1, null).promise).rejects.toThrow('no')
    expect(fake.unlinked).toEqual([])
    await expect(runWith('[x] no\n', 4, 1, '/renders/out.mp4').promise).rejects.toThrow('no')
    expect(fake.unlinked).toEqual(['/renders/out.mp4'])
  })

  it('fails the run with the error a line callback threw', async () => {
    const c = child()
    const handle = runFfmpeg({
      args: [], complete: true, durationMs: null, outputPath: null, onProgress: () => undefined,
      onStderrLine: () => {
        throw new Error('the parser broke')
      }
    })
    c.stderr.emit('data', 'one line\n')
    c.emit('close', 0)
    await expect(handle.promise).rejects.toThrow('the parser broke')
  })
})
