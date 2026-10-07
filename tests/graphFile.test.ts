import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { buildRenderPlan } from '@shared/render/plan'
import { commandLine, filterGraphOf, withGraphFile } from '@shared/render/graphFile'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { commandLineLength, cutTimeline } from './fixtures/longGraph'

/*
 * The graph goes in a file (docs/CLIPS.md §3.7, EFFECTS.md §47).
 *
 * Windows' CreateProcess takes a command line of at most 32,767 characters,
 * and the plan put the whole filtergraph in one argument. `withGraphFile`
 * swaps that pair for `-filter_complex_script <file>` where the export
 * spawns; `buildRenderPlan` itself is unchanged, so every test that reads the
 * graph from its argv still can.
 */

const count = (args: readonly string[], value: string): number => args.filter((a) => a === value).length

function ordinary(): string[] {
  const asset: MediaAsset = {
    id: 'v', path: '/media/Bride 5.30pm.mp4', name: 'Bride 5.30pm.mp4', kind: 'video',
    durationFrames: 300, width: 640, height: 360, fps: 30, hasVideo: true, hasAudio: true, size: 0
  }
  const clip = (id: string, start: number): Clip => ({
    id, assetId: 'v', trackId: 'v1', start, duration: 60, inPoint: start, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    color: { brightness: 0, contrast: 1, saturation: 1 }
  })
  const project: Project = { ...emptyProject(), assets: [asset], clips: [clip('a', 0), clip('b', 60)] }
  return buildRenderPlan({ project, outputPath: '/out/x.mp4' }).args
}

describe('withGraphFile', () => {
  it('replaces the one -filter_complex pair, and keeps every other argument in order', () => {
    const args = ordinary()
    expect(count(args, '-filter_complex'), 'the plan has one graph').toBe(1)
    const graph = filterGraphOf(args)
    const after = withGraphFile(args, '/tmp/graph-1.txt')

    expect(count(after, '-filter_complex'), 'no graph left on the line').toBe(0)
    expect(count(after, '-filter_complex_script'), 'one script').toBe(1)
    expect(after[after.indexOf('-filter_complex_script') + 1]).toBe('/tmp/graph-1.txt')
    expect(after, 'the graph itself is not on the line').not.toContain(graph)
    expect(after).toHaveLength(args.length)
    // Everything but the pair, in the same order, on both sides.
    const without = (list: readonly string[], option: string): string[] => {
      const at = list.indexOf(option)
      return [...list.slice(0, at), ...list.slice(at + 2)]
    }
    expect(without(after, '-filter_complex_script')).toEqual(without(args, '-filter_complex'))
    // And the pair sits where the graph sat: the inputs before it, the maps and output after.
    expect(after.indexOf('-filter_complex_script')).toBe(args.indexOf('-filter_complex'))
    // Pure: what it was given is untouched.
    expect(count(args, '-filter_complex')).toBe(1)
  })

  it('refuses an argv with no graph, or with two', () => {
    expect(() => withGraphFile(['-i', 'a.mp4', 'out.mp4'], '/tmp/g.txt')).toThrow(/0 -filter_complex/)
    expect(() => withGraphFile(['-filter_complex', 'a', '-filter_complex', 'b', 'o.mp4'], '/tmp/g.txt')).toThrow(/2 -filter_complex/)
    expect(() => filterGraphOf(['-i', 'a.mp4', '-filter_complex'])).toThrow(/no graph after it/)
  })

  /*
   * The case that needs it: a talk cut into 72 pieces, as transcript cutting
   * makes, at 30 fps for a vertical export. Each piece is an input and a chain
   * of graph, and with the graph on the line its argv is past Windows' limit
   * (about 55 pieces of this file were enough, EFFECTS.md §47); with the
   * graph in a file only the inputs are left. The render of the same shape is
   * longGraph.int, in Windows CI.
   */
  it('takes a 72-cut export from past 32,767 characters to under 30,000', () => {
    const asset: MediaAsset = {
      id: 'talk', path: 'C:\\Users\\someone\\Videos\\Podcast episode 41 (full).mp4', name: 'Podcast episode 41 (full).mp4',
      kind: 'video', durationFrames: 54_000, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: true, size: 0
    }
    const project = cutTimeline(asset, { cuts: 72, length: 75, stride: 750, fps: 30, width: 1080, height: 1920 })
    const args = buildRenderPlan({ project, outputPath: 'C:\\Users\\someone\\Videos\\Podcast 41 vertical.mp4' }).args
    const ffmpeg = 'C:\\Program Files\\3dit\\resources\\app.asar.unpacked\\node_modules\\@ffmpeg-installer\\win32-x64\\ffmpeg.exe'

    const before = commandLineLength(ffmpeg, args)
    expect(before, 'the graph on the line is past the limit (the reason for all this)').toBeGreaterThan(32_767)
    const after = commandLineLength(ffmpeg, withGraphFile(args, 'C:\\Users\\someone\\AppData\\Roaming\\3dit\\tmp\\graph-0b5c.txt'))
    expect(after).toBeLessThan(30_000)
  })
})

describe('commandLine', () => {
  const args = ['-y', '-i', "/Users/me/Bride's day.mp4", '-filter_complex_script', '/Users/me/tmp/graph-1.txt', 'out.mp4']

  it('prints the script path where the graph was, quoted for the shell it is pasted into', () => {
    const posix = commandLine('/Users/me/my claude/ffmpeg', args, 'darwin')
    expect(posix).toContain(' -filter_complex_script /Users/me/tmp/graph-1.txt ')
    expect(posix.startsWith("'/Users/me/my claude/ffmpeg' ")).toBe(true)
    // A single quote inside single quotes is closed, escaped and reopened.
    expect(posix).toContain(`'/Users/me/Bride'\\''s day.mp4'`)
    const windows = commandLine('C:\\Program Files\\ffmpeg.exe', ['-filter_complex_script', 'C:\\Users\\me\\tmp\\graph 1.txt'], 'win32')
    expect(windows).toBe('"C:\\Program Files\\ffmpeg.exe" -filter_complex_script "C:\\Users\\me\\tmp\\graph 1.txt"')
  })
})

/* ------------------------------------------------------- where the export spawns */

const spawned = vi.hoisted(() => ({
  args: [] as string[][],
  scripts: [] as { path: string; text: string | null }[],
  outcome: 'ok' as 'ok' | 'fail' | 'cancel'
}))

vi.mock('../src/main/ffmpeg/run', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/ffmpeg/run')>()
  const { existsSync: exists, readFileSync: read } = await import('node:fs')
  return {
    ...real,
    runFfmpeg: (options: { args: string[] }) => {
      spawned.args.push(options.args)
      // What is on disk at the moment ffmpeg would start.
      const at = options.args.indexOf('-filter_complex_script')
      const path = at >= 0 ? options.args[at + 1] : ''
      spawned.scripts.push({ path, text: path && exists(path) ? read(path, 'utf8') : null })
      const promise =
        spawned.outcome === 'ok'
          ? Promise.resolve()
          : Promise.reject(spawned.outcome === 'cancel' ? new real.CancelledError() : new Error('ffmpeg exited with code 1'))
      return { promise, cancel: () => undefined }
    }
  }
})

describe('the export spawns with its graph in a file', () => {
  const temp = mkdtempSync(join(tmpdir(), 'forge-graph-'))
  afterAll(() => rmSync(temp, { recursive: true, force: true }))
  beforeEach(() => {
    spawned.args.length = 0
    spawned.scripts.length = 0
  })

  function project(): Project {
    const asset: MediaAsset = {
      id: 'v', path: '/media/a.mp4', name: 'a.mp4', kind: 'video',
      durationFrames: 300, width: 640, height: 360, fps: 30, hasVideo: true, hasAudio: true, size: 0
    }
    const clip: Clip = {
      id: 'a', assetId: 'v', trackId: 'v1', start: 0, duration: 60, inPoint: 0, volume: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      color: { brightness: 0, contrast: 1, saturation: 1 }
    }
    return { ...emptyProject(), assets: [asset], clips: [clip] }
  }

  async function exportOnce(outcome: 'ok' | 'fail' | 'cancel'): Promise<unknown> {
    spawned.outcome = outcome
    const { startRender } = await import('../src/main/render/renderJob')
    const handle = startRender({ project: project(), outputPath: join(temp, 'out.mp4'), tempDir: temp }, () => undefined)
    return handle.promise.then(() => null, (err: unknown) => err)
  }

  it('hands ffmpeg the script, written before the spawn, holding the plan’s own graph — and removes it after', async () => {
    expect(await exportOnce('ok')).toBeNull()
    expect(spawned.args).toHaveLength(1)
    const args = spawned.args[0]
    expect(count(args, '-filter_complex'), 'no graph on the command line').toBe(0)
    expect(count(args, '-filter_complex_script')).toBe(1)
    const [{ path, text }] = spawned.scripts
    expect(basename(path)).toMatch(/^graph-[0-9a-f-]{36}\.txt$/)
    expect(join(path, '..')).toBe(temp)
    // The file ffmpeg reads is the graph the plan built, byte for byte.
    const plan = buildRenderPlan({ project: project(), outputPath: join(temp, 'out.mp4') }).args
    expect(text).toBe(filterGraphOf(plan))
    expect(existsSync(path), 'removed once the export is done').toBe(false)
  })

  it('keeps the script when the export fails, so the reported command can be run again, and says where', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const err = await exportOnce('fail')
      expect(err).toBeInstanceOf(Error)
      const [{ path }] = spawned.scripts
      expect(existsSync(path), 'kept after a failure').toBe(true)
      expect(readFileSync(path, 'utf8').length).toBeGreaterThan(0)
      const report = said.mock.calls.map((c) => c.join(' ')).join('\n')
      expect(report).toContain('-filter_complex_script')
      expect(report).toContain(path)
    } finally {
      said.mockRestore()
    }
  })

  it('removes the script when the export is cancelled', async () => {
    const err = await exportOnce('cancel')
    expect((err as Error).name).toBe('CancelledError')
    const [{ path, text }] = spawned.scripts
    expect(text, 'there was a script at the spawn').not.toBeNull()
    expect(existsSync(path)).toBe(false)
  })
})

/* ------------------------------------------------- what a failed export keeps */

describe('a failed export keeps its temporaries, and a week later they go', () => {
  /*
   * The command a failed export logs runs its graph's script, and that graph
   * names the captions' .ass in `subtitles=`. The queue listener in ipc.ts
   * used to remove the .ass on every finish, failed included, so the command
   * failed on a file that was gone. It asks `releasesTemporaries` now.
   */
  it('releases them when the export is done or cancelled, and keeps them when it failed', async () => {
    const { releasesTemporaries } = await import('../src/main/render/renderJob')
    expect(releasesTemporaries('done')).toBe(true)
    expect(releasesTemporaries('cancelled')).toBe(true)
    expect(releasesTemporaries('failed'), 'a failed export keeps its captions for its command').toBe(false)
  })

  it('sweeps the scripts and captions older than its age, and nothing else in the folder', async () => {
    const { sweepTemporaries } = await import('../src/main/render/renderJob')
    const dir = mkdtempSync(join(tmpdir(), 'forge-sweep-'))
    try {
      const DAY = 24 * 60 * 60 * 1000
      const now = Date.now()
      const uuid = (n: number): string => `0b5c${n}000-1111-4222-8333-444455556666`
      const files = {
        oldScript: `graph-${uuid(1)}.txt`,
        oldCaptions: `captions-${uuid(2)}.ass`,
        newScript: `graph-${uuid(3)}.txt`,
        newCaptions: `captions-${uuid(4)}.ass`,
        // The folder is shared: tier2's base pass, and anything else of another name.
        oldBase: `base-${uuid(5)}.mp4`,
        oldNotes: 'graph-notes.txt'
      }
      for (const name of Object.values(files)) writeFileSync(join(dir, name), 'x')
      const age = (name: string, days: number): void => {
        const when = new Date(now - days * DAY)
        utimesSync(join(dir, name), when, when)
      }
      age(files.oldScript, 8)
      age(files.oldCaptions, 30)
      age(files.newScript, 6)
      age(files.oldBase, 30)
      age(files.oldNotes, 30)

      const removed = await sweepTemporaries(dir, 7 * DAY, now)
      expect([...removed].sort()).toEqual([files.oldCaptions, files.oldScript].sort())
      expect(readdirSync(dir).sort()).toEqual([files.newCaptions, files.newScript, files.oldBase, files.oldNotes].sort())
      // A folder that is not there yet is not an error.
      expect(await sweepTemporaries(join(dir, 'missing'), 7 * DAY, now)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
