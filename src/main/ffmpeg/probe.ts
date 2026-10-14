import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { stat } from 'node:fs/promises'
import type { MediaInfo } from '@shared/types'
import { extOf, kindForExt, uprightSize, type ProbedPicture } from '@shared/media'
import { FFPROBE_PATH } from './paths'

interface FfprobeStream extends ProbedPicture {
  codec_type?: string
  codec_name?: string
  avg_frame_rate?: string
  duration?: string
  /** `-show_streams` prints it: "1/15360" for ffmpeg's own mp4s, "1/90000" for MPEG-TS, "1/1000" for webm. */
  time_base?: string
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: { duration?: string }
}

function parseFps(rate: string | undefined): number | null {
  if (!rate) return null
  const [num, den] = rate.split('/').map(Number)
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null
  const fps = num / den
  return fps > 0 ? Math.round(fps * 100) / 100 : null
}

function runProbe(path: string): Promise<FfprobeOutput> {
  return new Promise((resolve, reject) => {
    execFile(
      FFPROBE_PATH,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
      { maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr.trim() || err.message))
        try {
          resolve(JSON.parse(stdout) as FfprobeOutput)
        } catch {
          reject(new Error('ffprobe returned output that could not be parsed'))
        }
      }
    )
  })
}

/**
 * A stream's `time_base` as a fraction of positive whole numbers, or null when
 * it is missing or anything else. The unit the scene pass's `pts:` counts in
 * (shared/reframe/shots.ts), which keys.ts needs to put a cut on the export's
 * own frame (docs/EFFECTS.md §55).
 */
export function parseTimeBase(text: string | undefined): { num: number; den: number } | null {
  const m = /^(\d+)\/(\d+)$/.exec(text ?? '')
  if (!m) return null
  const num = Number(m[1])
  const den = Number(m[2])
  return Number.isSafeInteger(num) && Number.isSafeInteger(den) && num > 0 && den > 0 ? { num, den } : null
}

export async function probeFile(path: string): Promise<MediaInfo> {
  return (await probeWithClock(path)).info
}

/**
 * `probeFile`, and the video stream's time base beside it — what the reframe's
 * analysis records as `SubjectTrack.timeBase` (main/reframe/analyse.ts). One
 * ffprobe run: `-show_streams` already prints `time_base`.
 */
export async function probeWithClock(path: string): Promise<{ info: MediaInfo; timeBase: { num: number; den: number } | null }> {
  const ext = extOf(path)
  const kindFromExt = kindForExt(ext)
  if (!kindFromExt) throw new Error(`Unsupported file type: .${ext || '(none)'}`)

  const [fileStat, probe] = await Promise.all([stat(path), runProbe(path)])

  const streams = probe.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')

  const durationSeconds = Number(probe.format?.duration ?? video?.duration ?? audio?.duration)
  const durationMs =
    Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds * 1000) : null

  /*
   * The size the frames ARRIVE at, not the coded size: a phone clip's display
   * matrix turns it on decode, so a 640×360 stream with a 90° matrix is
   * 360×640 to the render, the preview and every layout decision
   * (`uprightSize`, docs/CLIPS.md §3.1). A JPEG's EXIF orientation is not
   * here — ffmpeg ignores it — and is turned at import instead (imports.ts).
   */
  const upright = uprightSize(video)

  // A still image probes as a single video stream; trust the extension for kind.
  const info: MediaInfo = {
    path,
    name: basename(path),
    size: fileStat.size,
    kind: kindFromExt,
    durationMs: kindFromExt === 'image' ? null : durationMs,
    width: upright.width,
    height: upright.height,
    rotation: upright.rotation,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    fps: kindFromExt === 'image' ? null : parseFps(video?.avg_frame_rate)
  }
  return { info, timeBase: parseTimeBase(video?.time_base) }
}

export async function probeMany(
  paths: string[]
): Promise<{ ok: MediaInfo[]; failed: { path: string; error: string }[] }> {
  const results = await Promise.allSettled(paths.map(probeFile))
  const ok: MediaInfo[] = []
  const failed: { path: string; error: string }[] = []
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') ok.push(result.value)
    else failed.push({ path: paths[i], error: String(result.reason?.message ?? result.reason) })
  })
  return { ok, failed }
}
