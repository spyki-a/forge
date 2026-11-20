import type { Clip, Project } from '../timeline'
import { removeWithFollowers } from '../graphics/apply'
import { removeMany } from './recipes'

/**
 * Remove from project: a file taken OUT of the project, never off the disk
 * (the Upload panel's right-click menu, MediaPool.tsx).
 *
 * Nothing here touches a file. What goes is the project's knowledge of it:
 *
 * - The asset.
 * - Every clip that plays it, removed as the timeline's Delete removes clips
 *   (`removeWithFollowers` over `removeMany`), so what follows a removed clip
 *   follows it here: a graphic's sounds, and the files those sounds brought
 *   that nothing else uses. A card ring made of NOTHING but removed photos
 *   plays only them, so it is one of their clips and goes too, with its own
 *   drawn 'card ring' asset when no clip left uses that; a ring with
 *   other photos keeps them and loses the removed one from its list (its
 *   preview and its export read the list, so the photo leaves the ring at
 *   once; the ring's cached still is redrawn by its next bake).
 * - Every record the project keeps by the asset's id: its transcript
 *   (`transcripts`), its depth planes (`parallax`), what the Director's eyes
 *   saw in it (`vision`), its subject track (`subjects`).
 * - Every graphic proposal on a removed clip (`clipId`), or grounded in the
 *   removed file's words or anchored on it (`spec.grounding.assetId`,
 *   `spec.anchor.assetId`): a proposal is waiting for a Keep that could only
 *   place it over footage that is gone.
 *
 * Left as the timeline's Delete leaves them, because they are fields of
 * clips that stay and every reader already tolerates the clip or file being
 * absent: another clip's `matte.clipId`, a moment's `from`/`to`, a kept
 * graphic's `subject.clipId`, `grounding.assetId` and `anchor.assetId`, and
 * a transition into a clip that followed a removed one.
 *
 * Pure; the same project comes back when none of `ids` is in it.
 */
export function removeAssets(project: Project, ids: readonly string[]): Project {
  const going = new Set(ids.filter((id) => project.assets.some((a) => a.id === id)))
  if (going.size === 0) return project

  const users = clipsPlaying(project, going).map((c) => c.id)
  const cut = removeWithFollowers(project, users, removeMany)
  const kept = new Set(cut.clips.map((c) => c.id))
  const goneClips = new Set(project.clips.filter((c) => !kept.has(c.id)).map((c) => c.id))
  // A ring that went takes its own drawn asset (the 'card ring' tile, never a user's file) when no clip left uses it.
  for (const c of project.clips) {
    if (c.carousel !== undefined && goneClips.has(c.id) && !cut.clips.some((k) => k.assetId === c.assetId)) going.add(c.assetId)
  }

  const inRing = (c: Clip): boolean => c.carousel !== undefined && c.carousel.assetIds.some((id) => going.has(id))
  const clips = cut.clips.some(inRing)
    ? cut.clips.map((c) => (inRing(c) ? { ...c, carousel: { ...c.carousel!, assetIds: c.carousel!.assetIds.filter((id) => !going.has(id)) } } : c))
    : cut.clips

  const next: Project = {
    ...cut,
    clips,
    assets: cut.assets.filter((a) => !going.has(a.id)),
    transcripts: without(cut.transcripts, going)
  }
  if (cut.parallax) next.parallax = without(cut.parallax, going)
  if (cut.vision) next.vision = without(cut.vision, going)
  if (cut.subjects) next.subjects = without(cut.subjects, going)
  if (cut.graphicProposals) {
    next.graphicProposals = cut.graphicProposals.filter(
      (g) =>
        !goneClips.has(g.clipId) &&
        !(g.spec.grounding !== undefined && going.has(g.spec.grounding.assetId)) &&
        !(g.spec.anchor !== undefined && going.has(g.spec.anchor.assetId))
    )
  }
  return next
}

/**
 * The clips that play the assets `ids`: those standing on one of them, and
 * a card ring whose photos are all among them (it shows nothing else).
 */
function clipsPlaying(project: Pick<Project, 'clips'>, ids: ReadonlySet<string>): Clip[] {
  return project.clips.filter(
    (c) =>
      ids.has(c.assetId) ||
      (c.carousel !== undefined && c.carousel.assetIds.length > 0 && c.carousel.assetIds.every((id) => ids.has(id)))
  )
}

/**
 * How many clips on the timeline show this asset: what Remove from project
 * asks about before it changes any of them. A card ring that shows the photo
 * among others counts, though only the photo leaves it (`assetClipsGoing`).
 */
export function assetClipCount(project: Pick<Project, 'clips'>, assetId: string): number {
  return project.clips.filter((c) => c.assetId === assetId || (c.carousel?.assetIds.includes(assetId) ?? false)).length
}

/** How many of those clips Remove from project takes: the question's "Remove it and its N clips". */
export function assetClipsGoing(project: Pick<Project, 'clips'>, assetId: string): number {
  return clipsPlaying(project, new Set([assetId])).length
}

function without<T>(table: Record<string, T>, ids: ReadonlySet<string>): Record<string, T> {
  if (!Object.keys(table).some((id) => ids.has(id))) return table
  return Object.fromEntries(Object.entries(table).filter(([id]) => !ids.has(id)))
}
