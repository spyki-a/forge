import { useState, type ReactNode } from 'react'
import { Check, Loader2, Upload } from 'lucide-react'
import type { Clip, MediaAsset, Project } from '@shared/timeline'
import { isPhoto } from '@shared/edit/photos'
import { useEditor } from '../../store'
import { Thumbnail } from '../MediaPool'
import { musicOf } from './shared'

/**
 * Where a tool's material comes from: the top of every Shelf tool that takes
 * media (docs/WINDOW.md §3.10–3.14, §6 Step 12).
 *
 * The user's rule for those tools (sheet 20, 2026-10-02): each one starts with
 * "upload a file, or choose from the media" — "that way we can differentiate
 * user needs while choosing some options like music sync or the Director's,
 * all of them the same". So every one of them opens on the same small block,
 * under its own header:
 *
 * - UPLOAD A FILE — the Upload tile's own pair, `pickMedia` then
 *   `importAssets`, busy while the dialog and the import run (MediaPool.tsx).
 *   A big import is seconds of probing, and an idle-looking button meanwhile
 *   gets pressed again.
 * - USES: — what the tool will take, read from the project by the SAME rule
 *   its store action applies (store.ts, named on each rule below). A line that
 *   disagreed with the build would be worse than none: it would be believed.
 *   The tools that keep time to music say which song as well.
 * - CHOOSE FROM MEDIA — only where the store already takes an asset id,
 *   `buildOnePhotoReel(assetId?)` and `buildGrid(assetId?)`: the pool's photos,
 *   the one the build will use marked. The choice is the PANEL's own state,
 *   passed to its build, so nothing else in the app changes under it.
 *
 * Phase 2, and deliberately not here (WINDOW.md §7, answer 7): placing a
 * chosen song, several chosen photos for the reel and the film strip (an
 * `assetIds` the store does not take yet), and choosing from a selection made
 * in the Upload tile itself. Until then every other tool states its rule and
 * takes no choice — and the types below keep it that way: only the two
 * choosing tools can be given `choose`, and they must be.
 */

/** The two tools whose store action already takes the photo to build from. */
export type ChoosingTool = 'one-photo' | 'grid-split'
/** The tools that state what they will take and take no choice (phase 2). */
export type StatingTool = 'beat-sync' | 'film-strip' | 'card-ring' | 'strip-flashes' | 'director'
export type SourceTool = ChoosingTool | StatingTool

/** The tools that keep time to the music, and so say which song they will hear. */
export const TIMED_TO_MUSIC: readonly SourceTool[] = ['beat-sync', 'one-photo', 'grid-split']

/** A panel's choice of photo: its own state, and the setter Choose from media calls. */
export interface PhotoChoice {
  /** The asset chosen in the list; undefined for the default (the selected photo, or the first one). */
  chosen: string | undefined
  onChoose: (assetId: string | undefined) => void
}

type SourceLineProps = { tool: ChoosingTool; choose: PhotoChoice } | { tool: StatingTool; choose?: never }

/* --------------------------------------------------------------- the rules */

/** How many photos the card ring takes, at most (store.ts addCarouselClip: `images.slice(0, 12)`). */
export const RING_CARDS = 12

export const NO_PHOTOS = 'no photos yet — upload some'
export const NO_PHOTO = 'no photos yet — upload one'
export const NO_SHOT = 'no shot on the timeline yet — put one there first'
export const DIRECTOR_USES = 'your pictures below, in order'
export const NO_MUSIC = 'no music yet — upload a song, then drag it onto an audio track'
/** The tooltip on the song's name: which clip is "the music", by the store's rule. */
export const MUSIC_TITLE = 'The first song on an audio track — the one this tool keeps time to'
/** The tooltip on the mark beside the photo the build will use. */
export const USED_TITLE = 'The photo it builds from'

/**
 * The photos the reel, the film strip, One photo and the grid draw on, and
 * what Choose from media offers: the user's own photos, not the text cards,
 * clippings and rings the editor drew (shared/edit/photos.ts isPhoto — the
 * filter store.ts buildReel, buildFilmstrip, buildOnePhotoReel and buildGrid
 * apply).
 */
export const photosOf = (project: Project): MediaAsset[] => project.assets.filter(isPhoto)

/** The card ring's: photos with a file (store.ts addCarouselClip), of which it takes the first twelve. */
export const ringPhotosOf = (project: Project): MediaAsset[] =>
  project.assets.filter((a) => isPhoto(a) && Boolean(a.path))

/**
 * The photo One photo and Grid split will build from: the one chosen, else the
 * selected clip's, else the first — the rule buildOnePhotoReel and buildGrid
 * apply (store.ts), in the same order and over the same photos. `chosen` says
 * whether the choice won, rather than the default. Null when there is no
 * photo at all.
 */
export function photoFor(
  project: Project,
  selectedClipId: string | null,
  chosen: string | undefined
): { photo: MediaAsset; chosen: boolean } | null {
  const images = photosOf(project)
  const selected = project.clips.find((c) => c.id === selectedClipId)?.assetId
  const picked = images.find((a) => a.id === chosen)
  const photo = picked ?? images.find((a) => a.id === selected) ?? images[0]
  return photo ? { photo, chosen: picked !== undefined } : null
}

/**
 * The shot Strip flashes will flash over: the one under the playhead, else the
 * longest — over the clips buildStrips considers (store.ts): on a video track,
 * made by no rule, and not text, a colour card or a grade.
 */
export function stripShotOf(project: Project, playhead: number): { clip: Clip; under: boolean } | null {
  const videoTracks = project.tracks.filter((t) => t.kind === 'video')
  const candidates = project.clips.filter(
    (c) => videoTracks.some((t) => t.id === c.trackId) && !c.generatedBy && !c.text && !c.solid && !c.adjustment
  )
  const under = candidates.find((c) => playhead >= c.start && playhead < c.start + c.duration)
  if (under) return { clip: under, under: true }
  // A copy: the store's sort is in place, on an array of its own.
  const longest = [...candidates].sort((a, b) => b.duration - a.duration)[0]
  return longest ? { clip: longest, under: false } : null
}

/** "all N photos in Upload", for the tools that take every photo. */
function everyPhoto(n: number): string {
  if (n === 0) return NO_PHOTOS
  if (n === 1) return 'the one photo in Upload'
  return `all ${n} photos in Upload`
}

/** What a tool's "Uses:" line says, from the project and the store's selection and playhead. */
export function usesOf(
  tool: SourceTool,
  project: Project,
  selectedClipId: string | null,
  playhead: number,
  chosen: string | undefined
): string {
  switch (tool) {
    case 'beat-sync':
    case 'film-strip':
      return everyPhoto(photosOf(project).length)
    case 'card-ring': {
      const n = ringPhotosOf(project).length
      return n > RING_CARDS ? `the first ${RING_CARDS} of the ${n} photos in Upload` : everyPhoto(n)
    }
    case 'one-photo':
    case 'grid-split': {
      const found = photoFor(project, selectedClipId, chosen)
      if (!found) return NO_PHOTO
      return found.chosen
        ? `${found.photo.name} — chosen below`
        : `${found.photo.name} — the selected photo, or the first one`
    }
    case 'strip-flashes': {
      const shot = stripShotOf(project, playhead)
      if (!shot) return NO_SHOT
      const name = project.assets.find((a) => a.id === shot.clip.assetId)?.name ?? 'a clip'
      return shot.under ? `${name} — the shot under the playhead` : `${name} — the longest shot, as none is under the playhead`
    }
    case 'director':
      return DIRECTOR_USES
  }
}

/**
 * The song a music tool will hear, and where it is: the first clip with sound
 * on an audio track (tools/shared.ts musicOf — buildReel's, buildOnePhotoReel's
 * and buildGrid's rule).
 */
export function musicLineOf(project: Project): string {
  const { musicClip, musicAsset } = musicOf(project)
  if (!musicClip || !musicAsset) return NO_MUSIC
  const track = project.tracks.find((t) => t.id === musicClip.trackId)?.name ?? 'an audio track'
  return `${musicAsset.name} on ${track}`
}

/* ------------------------------------------------------------- the block */

export function SourceLine({ tool, choose }: SourceLineProps): ReactNode {
  const importAssets = useEditor((s) => s.importAssets)
  /*
   * The line, as a string: a selector that returns text re-renders this only
   * when the text changes — Strip flashes reads the playhead, which moves on
   * every frame of playback, and its line changes only when the shot does.
   */
  const uses = useEditor((s) => usesOf(tool, s.project, s.selectedClipId, s.playhead, choose?.chosen))
  const music = useEditor((s) => (TIMED_TO_MUSIC.includes(tool) ? musicLineOf(s.project) : null))

  const [picking, setPicking] = useState(false)
  const upload = async (): Promise<void> => {
    setPicking(true)
    try {
      const paths = await window.forge.pickMedia()
      if (paths.length > 0) await importAssets(paths)
    } finally {
      setPicking(false)
    }
  }

  return (
    <div data-source-line={tool} className="space-y-1.5 rounded border border-ink-800 p-2">
      <button
        onClick={() => void upload()}
        disabled={picking}
        aria-busy={picking}
        className="flex w-full items-center justify-center gap-1.5 rounded bg-ink-800 px-2 py-1 text-[10.5px] text-ink-400 hover:bg-ink-700 hover:text-ink-200 disabled:opacity-40"
      >
        {picking ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
        Upload a file
      </button>

      <div className="flex items-baseline gap-1.5">
        <span className="w-10 shrink-0 text-[10.5px] text-ink-500">Uses:</span>
        <span className="min-w-0 flex-1 break-words text-[10.5px] leading-snug text-ink-300">{uses}</span>
      </div>

      {music !== null && (
        <div className="flex items-baseline gap-1.5">
          <span className="w-10 shrink-0 text-[10.5px] text-ink-500">Music:</span>
          <span
            title={music === NO_MUSIC ? undefined : MUSIC_TITLE}
            className="min-w-0 flex-1 break-words text-[10.5px] leading-snug text-ink-300"
          >
            {music}
          </span>
        </div>
      )}

      {choose && <ChooseFromMedia choice={choose} />}
    </div>
  )
}

/**
 * The pool's photos, to build from one of them: a thumbnail and the name each,
 * the photo the build will use marked — the chosen one, or, with nothing
 * chosen, the selected photo or the first (photoFor). Pressing the chosen one
 * again goes back to that default. Nothing to show without a photo of the
 * user's own; the "Uses:" line says so.
 */
function ChooseFromMedia({ choice }: { choice: PhotoChoice }): ReactNode {
  const project = useEditor((s) => s.project)
  const used = useEditor((s) => photoFor(s.project, s.selectedClipId, choice.chosen)?.photo.id ?? null)
  const photos = photosOf(project)
  if (photos.length === 0) return null

  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-ink-500">Choose from media</div>
      <div className="max-h-36 space-y-0.5 overflow-y-auto">
        {photos.map((asset) => {
          const chosen = choice.chosen === asset.id
          return (
            <button
              key={asset.id}
              data-source-choice={asset.id}
              aria-pressed={chosen}
              onClick={() => choice.onChoose(chosen ? undefined : asset.id)}
              title={chosen ? `${asset.name} — press again for the selected photo, or the first one` : asset.name}
              className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[10.5px] ${
                chosen ? 'bg-accent-900 text-ink-200' : 'text-ink-400 hover:bg-ink-850 hover:text-ink-200'
              }`}
            >
              <span className="size-7 shrink-0 overflow-hidden rounded-sm bg-ink-800">
                <Thumbnail asset={asset} />
              </span>
              <span className="min-w-0 flex-1 truncate">{asset.name}</span>
              {asset.id === used && (
                <span title={USED_TITLE} className="shrink-0 text-accent-400">
                  <Check size={12} />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
