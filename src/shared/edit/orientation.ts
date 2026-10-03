import type { MediaAsset, ProjectSettings } from '../timeline'

/**
 * Is the canvas the wrong way round for the photos in the pool?
 *
 * The answer is the shape to switch to — '9:16' when most photos stand up and
 * the canvas does not, '16:9' when most lie down and the canvas stands up — or
 * null when the two agree, or when there are no photos to judge by.
 *
 * Why it exists at all: a portrait photo on a landscape canvas sits in a narrow
 * strip with black either side, and the reverse in a band with black above and
 * below. This was a toast once, and a toast is gone in a few seconds — two
 * rendered reels came back using a third of the frame because the warning had
 * vanished before the reel was built. Then it was a standing banner in the
 * Create tab's reel section, which only the reel could see. Now it is a chip on
 * the canvas bar (components/CanvasBar.tsx), above the picture every photo tool
 * draws on, and this function is the rule, lifted unchanged so it can be tested.
 *
 * The rule, exactly as the banner had it (tests/orientation.test.ts pins each
 * edge):
 * - Only `kind === 'image'` assets count. Video does not — and the generated
 *   stills (text, cards, clippings), which are image assets authored at the
 *   canvas size, do count, as they always did.
 * - A photo is portrait when its height is greater than its width. A square
 *   photo is not portrait, and neither is one with no size (`null` height reads
 *   as 0, `null` width as 1).
 * - The canvas is portrait when its height is greater than its width, so a
 *   square canvas counts as landscape: a portrait majority on 1:1 suggests
 *   9:16, and a landscape majority on 1:1 suggests nothing.
 * - "Most" is strictly more than half for portrait, strictly fewer than half
 *   for landscape. Exactly half — one of each — is not a mismatch either way.
 */
export function orientationMismatch(
  assets: readonly Pick<MediaAsset, 'kind' | 'width' | 'height'>[],
  settings: Pick<ProjectSettings, 'width' | 'height'>
): '9:16' | '16:9' | null {
  const photos = assets.filter((a) => a.kind === 'image')
  if (photos.length === 0) return null
  const portrait = photos.filter((a) => (a.height ?? 0) > (a.width ?? 1)).length
  const canvasPortrait = settings.height > settings.width
  if (portrait > photos.length / 2 && !canvasPortrait) return '9:16'
  if (portrait < photos.length / 2 && canvasPortrait) return '16:9'
  return null
}
