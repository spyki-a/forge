import type { MediaAsset } from '../timeline'

/**
 * A photograph the user brought in — not a still the editor drew.
 *
 * Text cards, clippings, the card ring and the Director's cards, black and
 * adjustment layers are image assets too, authored at the canvas size, and a
 * baked text card even has a real PNG at its `path`. What marks every one of
 * them is `size: 0`: an imported file is measured on import, a drawn one has no
 * file to measure. The relinker skips them by it (main/imports.ts locateAsset,
 * shared/project/relink.ts), and the Director's slot list leaves them out by
 * it (shared/director/menu.ts buildSlots).
 *
 * The photo tools did not, and a "+ Text" made the text card one of the
 * reel's photos: Beat sync counted it, the reel cut it in as a shot, and One
 * photo and Grid split built from it whenever it was the selected clip or the
 * first image in the pool. This is the one rule for all of them — the store's
 * builds (buildReel, buildOnePhotoReel, addCarouselClip, buildFilmstrip,
 * buildGrid), the tool panels' counts, and the "Uses:" line that says which
 * photos a build will take (components/tools/SourceLine.tsx).
 *
 * Not orientation's rule: shared/edit/orientation.ts counts the drawn stills
 * on purpose, and says so.
 */
export const isPhoto = (asset: Pick<MediaAsset, 'kind' | 'size'>): boolean => asset.kind === 'image' && asset.size > 0
