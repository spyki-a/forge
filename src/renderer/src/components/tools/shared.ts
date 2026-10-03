import type { Clip, MediaAsset, Project } from '@shared/timeline'
import { useEditor } from '../../store'

/**
 * What the Shelf's automation tools share (docs/WINDOW.md §3.10–3.14, §6 Step 10).
 *
 * They were one panel, Automation.tsx, which worked these out once for every
 * section; each tool is a panel of its own now, so the ones several need are
 * here rather than copied into each.
 */

/**
 * The music clip on the timeline, and its asset.
 *
 * The music clip on the timeline is the range the reel is built from, so a
 * panel shows that clip rather than keeping a second idea of "the music". The
 * first clip on an audio track whose asset has sound: the rule the Automation
 * panel used, and the one buildReel and buildOnePhotoReel apply (store.ts).
 */
export function musicOf(project: Project): { musicClip: Clip | undefined; musicAsset: MediaAsset | null } {
  const musicClip = project.clips.find((clip) => {
    const track = project.tracks.find((t) => t.id === clip.trackId)
    const asset = project.assets.find((a) => a.id === clip.assetId)
    return track?.kind === 'audio' && asset?.hasAudio
  })
  const musicAsset = musicClip
    ? project.assets.find((a) => a.id === musicClip.assetId) ?? null
    : null
  return { musicClip, musicAsset }
}

/** `musicOf` the open project. Subscribes to the project, never to a derived object. */
export function useMusicClip(): { musicClip: Clip | undefined; musicAsset: MediaAsset | null } {
  return musicOf(useEditor((s) => s.project))
}

/**
 * What the AI helper is baking right now, if anything.
 *
 * A long bake with no message on screen is indistinguishable from a hung app —
 * which is exactly how it read. The first bake under way speaks for all of
 * them, as it did in the Automation panel.
 */
export function bakeStatusOf(baking: Record<string, { progress: number | null; message?: string }>): {
  bakeMessage: string | null
  bakeProgress: number | null
} {
  const first = Object.values(baking)[0]
  return { bakeMessage: first?.message ?? null, bakeProgress: first?.progress ?? null }
}

/** `bakeStatusOf` the store's bakes. */
export function useBakeStatus(): { bakeMessage: string | null; bakeProgress: number | null } {
  return bakeStatusOf(useEditor((s) => s.baking))
}
