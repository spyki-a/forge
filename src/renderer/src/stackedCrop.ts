import type { CropRect } from '@shared/timeline'

/**
 * A stacked two-up frame, drawn the way the export makes it (docs/CLIPS.md
 * §4.7): the top half's rectangle of the picture over the bottom half's, into
 * one canvas the followed crop's full size. The preview then draws THAT
 * through the path a single crop takes — the camera move, the punch-in, the
 * fit, the mask — exactly as the export's chain takes the `vstack`'s output.
 *
 * One canvas per key (a clip, and its plain copy for a grade mask), reused
 * frame to frame; `forgetStacks` lets them go with their clips.
 */
const stacks = new Map<string, HTMLCanvasElement>()

export function stackedCrop(
  key: string,
  picture: CanvasImageSource,
  halves: { top: CropRect; bottom: CropRect }
): HTMLCanvasElement {
  const { top, bottom } = halves
  const width = top.width
  const height = top.height + bottom.height
  let canvas = stacks.get(key)
  if (!canvas) {
    canvas = document.createElement('canvas')
    stacks.set(key, canvas)
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(picture, top.x, top.y, top.width, top.height, 0, 0, width, top.height)
  ctx.drawImage(picture, bottom.x, bottom.y, bottom.width, bottom.height, 0, top.height, width, bottom.height)
  return canvas
}

/** Drop the canvases of clips that are gone (keys are `<clip id>#…`). */
export function forgetStacks(live: ReadonlySet<string>): void {
  for (const key of stacks.keys()) if (!live.has(key.split('#')[0])) stacks.delete(key)
}
