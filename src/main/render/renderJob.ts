import { mkdirSync, writeFileSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { Project } from '@shared/timeline'
import type { JobStatus } from '@shared/types'
import { framesToSeconds } from '@shared/timeline'
import { buildRenderPlan, type RenderRequest } from '@shared/render/plan'
import { commandLine, filterGraphOf, withGraphFile } from '@shared/render/graphFile'
import { CancelledError, runFfmpeg, type RunHandle } from '../ffmpeg/run'
import { FFMPEG_PATH } from '../ffmpeg/paths'
import { analyseSteady } from './steady'
import type { ExecutionHandle } from '../queue'
import type { TransitionDef } from '@shared/transitions/registry'
import type { EncodeSpec } from '@shared/render/encode'
import type { FrameRange } from '@shared/render/exportShape'

export interface RenderOptions {
  project: Project
  outputPath: string
  canvas?: { width: number; height: number }
  crf?: number
  preset?: string
  encode?: EncodeSpec
  range?: FrameRange
  /** The running ffmpeg's chroma-key distance scale (render/keyScale.ts). */
  keyScale?: number
  /** Where steady clips' motion analysis is kept between exports (render/steady.ts). */
  steadyDir?: string
  subtitlesPath?: string
  fontsDir?: string
  captionOverlay?: { listPath: string; y: number; height: number }
  resolveAsset?: (relativePath: string) => string
  extraTransitions?: TransitionDef[]
  /**
   * Where the render's filtergraph is written for `-filter_complex_script`:
   * the export's temporaries folder (userData/tmp, beside the captions' .ass).
   * The system's temp folder when not given.
   */
  tempDir?: string
}

/**
 * The plan's filtergraph, written to a file for `-filter_complex_script`.
 *
 * The whole graph used to be one argument, and Windows caps a command line at
 * 32,767 characters: a talk cut into 55 pieces was past that, and ffmpeg
 * would not start — on Windows only (docs/CLIPS.md §3.7, EFFECTS.md §47).
 * Written synchronously because the queue needs its handle at once; it is
 * one small text file, UTF-8, which is what ffmpeg makes of its own argv on
 * Windows anyway.
 */
function writeGraph(args: readonly string[], dir: string): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `graph-${randomUUID()}.txt`)
  writeFileSync(file, filterGraphOf(args), 'utf8')
  return file
}

/**
 * Whether a finished export's temporaries go with it: when it is done or
 * cancelled, yes; when it failed, no.
 *
 * A failed export logs the command to run it again by hand, with its graph's
 * script where the graph was (below), and that graph names the captions'
 * `.ass` in its `subtitles=` (captions.ts). ipc.ts used to remove the `.ass`
 * on any finish, so the logged command failed on a file that was gone. Both
 * stay now, and `sweepTemporaries` removes them once they are old.
 */
export function releasesTemporaries(status: JobStatus): boolean {
  return status === 'done' || status === 'cancelled'
}

/** What an export leaves in its temporaries folder: its graph's script, and its captions. */
const TEMPORARY = /^(graph-[0-9a-f-]{36}\.txt|captions-[0-9a-f-]{36}\.ass)$/

/**
 * Remove the scripts and captions failed exports kept, once they are older
 * than `maxAgeMs`; returns the names removed.
 *
 * Only those two names: the folder is shared (graphics/tier2.ts renders its
 * base pass there), and a file of another kind is not this sweep's to judge.
 * By age, so a launch while another instance is exporting cannot take a file
 * from under it.
 */
export async function sweepTemporaries(dir: string, maxAgeMs: number, now = Date.now()): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[])
  const removed: string[] = []
  for (const name of names) {
    if (!TEMPORARY.test(name)) continue
    const file = join(dir, name)
    const info = await stat(file).catch(() => null)
    if (!info?.isFile() || now - info.mtimeMs < maxAgeMs) continue
    await rm(file, { force: true }).catch(() => undefined)
    removed.push(name)
  }
  return removed
}

/**
 * Turns a timeline into a running ffmpeg render with progress and cancellation.
 *
 * This is the whole reason the job queue was worth keeping from the converter
 * era: an NLE's export is a queued ffmpeg job with progress and cancel.
 */
export function startRender(
  options: RenderOptions,
  onProgress: (progress: number, speed: string | null) => void
): ExecutionHandle {
  const fps = options.project.settings.fps
  const run = (request: RenderRequest, progress: typeof onProgress): RunHandle => {
    const plan = buildRenderPlan(request)
    // The plan keeps `-filter_complex <graph>`; the spawn takes the file instead.
    const script = writeGraph(plan.args, options.tempDir ?? tmpdir())
    const args = withGraphFile(plan.args, script)
    const handle = runFfmpeg({
      args,
      complete: true,
      durationMs: Math.round(framesToSeconds(plan.durationFrames, fps) * 1000),
      outputPath: options.outputPath,
      onProgress: progress
    })
    const removeScript = (): Promise<void> => rm(script, { force: true }).catch(() => undefined)
    return {
      cancel: handle.cancel,
      promise: handle.promise.then(removeScript, async (err: unknown) => {
        /*
         * A failure keeps its script and says how to run it again: the command,
         * pasteable, with the script's path where the graph used to be. ipc.ts
         * keeps its captions too (`releasesTemporaries`). A cancel is not a
         * failure, and leaves nothing behind.
         */
        if (err instanceof CancelledError) await removeScript()
        else console.error(`[forge] export failed — its graph is in ${script}; the command:\n${commandLine(FFMPEG_PATH, args, process.platform)}`)
        throw err
      })
    }
  }

  const steadying = options.steadyDir !== undefined && options.project.clips.some((c) => c.steady)
  if (!steadying) return run(options as RenderRequest, onProgress)

  /*
   * A steady clip needs its motion analysed before the render can use it, so
   * the job runs in two parts: the analysis (the first quarter of the bar) and
   * the render (the rest). One cancel stops whichever is running.
   */
  const ANALYSIS_SHARE = 0.25
  let cancelled = false
  let current: { cancel: () => void } | null = null
  const promise = (async (): Promise<void> => {
    const analysis = analyseSteady(options.project, options.steadyDir!, (f) => onProgress(f * ANALYSIS_SHARE, null))
    current = analysis
    const steady = await analysis.promise
    if (cancelled) throw new CancelledError()
    const render = run({ ...options, steady } as RenderRequest, (p, speed) =>
      onProgress(ANALYSIS_SHARE + p * (1 - ANALYSIS_SHARE), speed)
    )
    current = render
    await render.promise
  })()
  return {
    promise,
    cancel: () => {
      cancelled = true
      current?.cancel()
    }
  }
}

/** A short human label for the queue UI. */
export function describeRender(options: RenderOptions): string {
  const canvas = options.canvas ?? {
    width: options.project.settings.width,
    height: options.project.settings.height
  }
  return `${basename(options.outputPath)} · ${canvas.width}×${canvas.height}`
}
