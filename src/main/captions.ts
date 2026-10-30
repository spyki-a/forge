import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import type { Project } from '@shared/timeline'
import { buildTimelineCaptions } from '@shared/captions/timeline'
import { smartPlacement } from '@shared/captions/smart'
import { resolveStyle, type StyleOverrides } from '@shared/captions/style'
import { fontsDir } from './fontsDir'

export interface PreparedCaptions {
  subtitlesPath: string
  fontsDir: string | undefined
  /**
   * Remove the temp file once the render is done or cancelled. A failed render
   * keeps it with its graph's script, for the command it logged, until the
   * launch sweep (render/renderJob.ts, `releasesTemporaries`).
   */
  cleanup: () => Promise<void>
}

/**
 * Write the timeline's captions to a temporary .ass file for the render.
 * Returns null when there is nothing to burn, which leaves the render plan
 * without a subtitles filter at all.
 */
/**
 * Where a bake's pictures and its concat list live.
 *
 * One folder, emptied before each bake, so a shorter edit cannot leave a longer
 * edit's frames behind for ffmpeg to find.
 */
function bakeDir(): string {
  return join(app.getPath('userData'), 'caption-bake')
}

/** One distinct caption picture. Returns the path the concat list will name. */
export async function writeCaptionFrame(index: number, bytes: Buffer): Promise<string> {
  const dir = bakeDir()
  await mkdir(dir, { recursive: true })
  const target = join(dir, `${String(index).padStart(5, '0')}.png`)
  await writeFile(target, bytes)
  return target
}

/**
 * The concat list ffmpeg reads.
 *
 * Written last, after every picture it names exists, so a cancelled bake leaves
 * no list pointing at files that were never finished.
 */
export async function writeCaptionList(text: string): Promise<string> {
  const dir = bakeDir()
  await mkdir(dir, { recursive: true })
  const target = join(dir, 'captions.txt')
  await writeFile(target, text, 'utf8')
  return target
}

export async function clearCaptionFrames(): Promise<void> {
  await rm(bakeDir(), { recursive: true, force: true }).catch(() => undefined)
}

export async function prepareCaptions(
  project: Project,
  canvas: { width: number; height: number }
): Promise<PreparedCaptions | null> {
  if (!project.captions?.enabled) return null

  const style = resolveStyle(
    project.captions.styleId,
    project.captions.overrides as StyleOverrides | undefined
  )
  // Smart placement's lookup, the same one the canvas bake and the preview ask (docs/CLIPS.md §5.4).
  const ass = buildTimelineCaptions(project, style, canvas, smartPlacement(project, style, canvas))
  if (!ass) return null

  const dir = join(app.getPath('userData'), 'tmp')
  await mkdir(dir, { recursive: true })
  const subtitlesPath = join(dir, `captions-${randomUUID()}.ass`)
  await writeFile(subtitlesPath, ass, 'utf8')

  return {
    subtitlesPath,
    fontsDir: fontsDir(),
    cleanup: () => rm(subtitlesPath, { force: true }).catch(() => undefined)
  }
}
