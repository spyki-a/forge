import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'

/*
 * A graph past Windows' 32,767-character command line (docs/CLIPS.md §3.7, EFFECTS.md §47).
 *
 * The plan's case was one followed clip with 360 held cuts as keys. That cannot render at all, on
 * either build: one `keyframeExpression` nests an `if` per key, and ffmpeg's expression parser stops
 * at 100 levels (libavutil/eval.c, `stack_index`), so a track of about 93 keys or more is refused —
 * measured, EFFECTS.md §48. The graph that DOES reach the limit today is a timeline of cuts: one
 * source cut into pieces, which is what transcript cutting and Clip it make. Each piece is an input
 * and a chain, about 510 characters of graph, so some 55 pieces of one talk were already past it.
 */

export function cutTimeline(
  asset: MediaAsset,
  { cuts, length, stride, fps, width, height }: { cuts: number; length: number; stride: number; fps: number; width: number; height: number }
): Project {
  /** Piece i: `length` frames from source frame i × stride, back to back on V1. */
  const clips: Clip[] = Array.from({ length: cuts }, (_, i) => ({
    id: `cut${i}`, assetId: asset.id, trackId: 'v1', start: i * length, duration: length, inPoint: i * stride, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    color: { brightness: 0, contrast: 1, saturation: 1 }
  }))
  return { ...emptyProject(), settings: { width, height, fps, sampleRate: 48000 }, assets: [asset], clips }
}

/**
 * About how long a command line Windows builds from an argv: every argument, a space between, quotes
 * round any with a space or a quote in it (libuv's quoting, roughly), and the program's own path.
 */
export function commandLineLength(binary: string, args: readonly string[]): number {
  return [binary, ...args].reduce((n, arg) => n + arg.length + 1 + (/[\s"]/.test(arg) ? 2 : 0), 0)
}
