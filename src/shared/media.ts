import type { MediaKind } from './types'

export const VIDEO_EXT = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', '3gp']
export const AUDIO_EXT = ['mp3', 'wav', 'aac', 'flac', 'm4a', 'ogg', 'opus', 'wma', 'aiff']
export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'tif', 'gif', 'bmp', 'heic']

export const SUPPORTED_EXTENSIONS = { video: VIDEO_EXT, audio: AUDIO_EXT, image: IMAGE_EXT }
export const ALL_EXTENSIONS = [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT]

/** Extension without the dot, lowercased. */
export function extOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase()
}

export function kindForExt(ext: string): MediaKind | null {
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  if (IMAGE_EXT.includes(ext)) return 'image'
  return null
}

export function kindForPath(path: string): MediaKind | null {
  return kindForExt(extOf(path))
}

/**
 * One stream as ffprobe prints it (`-show_streams -of json`), the fields the
 * upright size reads.
 */
export interface ProbedPicture {
  width?: number
  height?: number
  side_data_list?: { side_data_type?: string; rotation?: number | string }[]
}

/**
 * Clockwise degrees the decoder turns a stream's coded picture.
 *
 * Both bundled ffmpegs turn a phone clip upright as they decode it
 * ("autorotate"), from the display matrix in the stream's side data — and
 * from nothing else: the 2018 Windows build's `get_rotation` reads only the
 * matrix (fftools/cmdutils.c:2175-2192 at f22fcd4), so the legacy `rotate`
 * tag is never read here; a file with the tag and no matrix is not turned.
 * The arithmetic is ffmpeg's: the matrix's counter-clockwise angle negated,
 * folded into [0, 360). A right angle comes back exact (within a degree, as
 * ffmpeg decides it — `transpose` for 90 and 270, `hflip,vflip` for 180); any
 * other angle is rounded, and ffmpeg turns those in place with `rotate`, the
 * size unchanged. The Python helper's `media.display_rotation` is the same
 * function (docs/CLIPS.md §3.1, §3.6; EFFECTS.md §49).
 */
export function displayRotation(stream: ProbedPicture | undefined): number {
  for (const entry of stream?.side_data_list ?? []) {
    const angle = typeof entry?.rotation === 'string' ? Number(entry.rotation) : entry?.rotation
    if (typeof angle !== 'number' || !Number.isFinite(angle)) continue
    let theta = -angle
    theta -= 360 * Math.floor(theta / 360 + 0.9 / 360)
    for (const right of [0, 90, 180, 270, 360]) {
      if (Math.abs(theta - right) < 1) return right % 360
    }
    return ((Math.round(theta) % 360) + 360) % 360
  }
  return 0
}

/**
 * The size a stream's frames ARRIVE at: the coded size with the sides swapped
 * when the decoder turns the picture a quarter.
 *
 * Measured with the bundled ffmpeg: a 640×360 clip remuxed with a 90° matrix
 * probes `width=640, height=360` and decodes 360×640 (`scale=320:-2` gave
 * 320×568). Everything that lays a picture out — the pool, the reframe's
 * `solveCrop`, the crop handles, the preview's draw — takes the asset's size
 * for the frames' size, so the asset carries this one.
 */
export function uprightSize(stream: ProbedPicture | undefined): {
  width: number | null
  height: number | null
  rotation: number
} {
  const width = stream?.width ?? null
  const height = stream?.height ?? null
  const rotation = displayRotation(stream)
  const quarter = rotation === 90 || rotation === 270
  return quarter ? { width: height, height: width, rotation } : { width, height, rotation }
}
