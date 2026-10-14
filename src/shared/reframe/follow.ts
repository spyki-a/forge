import { followKeys, type FollowKeys } from './keys'
import { SCENE_DEFAULTS } from './shots'
import type { Shot, SubjectTrack } from './types'
import type { HalfOffsets } from './path'
import { cropAt, solveCrop } from '../render/crop'
import type { Clip, ClipFollow, CropRect, Project } from '../timeline'
import { BACKDROP_RULE } from '../director/apply'
import { STRIP_RULE } from '../automation/strips'

/**
 * Following the subject, as edits to the project — what the store's reframe
 * actions write (docs/CLIPS.md §4.7, slice B). Pure: each takes a project and
 * returns the next one, or the same object when nothing changes, so the store
 * wraps each in ONE `update()` (one undo) and a test can hold it without a
 * window.
 *
 * What is written is facts, never keys: `Project.subjects[assetId]` (the
 * file's track), `clip.follow` (what the user asked of it) and the clip's
 * stored `crop` — a COPY of `followKeys(…).crop`, the followed crop's one size
 * at its first frame's place, for every consumer that knows nothing of
 * following. Never the memoised object itself: `followKeys` shares its answer
 * between callers, and a stored reference is one in-place edit away from
 * changing every other reader's keys.
 */

/** A new follow, or an old one moved on: every change bumps `version`, so whatever is keyed on it re-reads. */
function nextFollow(prev: ClipFollow | undefined, patch: Partial<Omit<ClipFollow, 'version'>> = {}): ClipFollow {
  return { ...(prev ?? {}), ...patch, version: (prev?.version ?? 0) + 1 }
}

/**
 * The crop a followed clip stores: a copy of the followed crop's rectangle on
 * its first frame, or — no usable track (none yet, another version, a size
 * that is not the asset's) — the centred `solveCrop` every clip gets.
 */
export function storedFollowCrop(project: Project, clip: Clip, fps: number): CropRect | undefined {
  const keys = followKeys(project, clip, fps)
  if (keys) return { ...keys.crop }
  const asset = project.assets.find((a) => a.id === clip.assetId)
  return asset ? solveCrop(asset, { width: project.settings.width, height: project.settings.height }) : clip.crop
}

const sameCrop = (a: CropRect | undefined, b: CropRect | undefined): boolean =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)

/* ------------------------------------------------------------ candidates */

/**
 * The clips Reframe to 9:16 follows (`reframeAll`) — and what the canvas
 * chip's rule (`reframeOffer`, shared/edit/reframeOffer.ts) should count, so
 * the chip never offers a press that does nothing: every clip ON THE TIMELINE
 * (a file only in the pool has none) of a landscape VIDEO, on a video lane,
 * not already following. Not a Director backdrop (a blurred copy that fills
 * the frame under its shot) and not a strip (a slice of the shot by design):
 * following either would undo what it is for.
 */
export function followCandidates(project: Pick<Project, 'clips' | 'assets' | 'tracks'>): Clip[] {
  return project.clips.filter((clip) => {
    if (clip.follow) return false
    const rule = clip.generatedBy?.rule
    if (rule === BACKDROP_RULE || rule === STRIP_RULE) return false
    const track = project.tracks.find((t) => t.id === clip.trackId)
    if (track && track.kind !== 'video') return false
    const asset = project.assets.find((a) => a.id === clip.assetId)
    return !!asset && asset.kind === 'video' && asset.hasVideo !== false && (asset.width ?? 0) > (asset.height ?? 0)
  })
}

/* ----------------------------------------------------------------- remap */

/**
 * How near a new shot's start must be to an old one's for a drag to move onto
 * it by time: half the shortest shot the finder keeps, so no two old shots
 * can claim one new shot by time alone.
 */
export const REMAP_TOLERANCE_MS = SCENE_DEFAULTS.minShotMs / 2

/**
 * A drag table keyed by an old track's shot starts, moved onto a new track's
 * (a re-analysis: the file changed, or the track's version did). Each entry
 * goes to the new shot whose start is NEAREST its own, within
 * `REMAP_TOLERANCE_MS`; failing that, to the new shot at the old shot's index
 * (when the old shots are known); failing both, or when the new shot is
 * already taken, it is dropped and counted. Nearest matches are placed first,
 * nearest of all first, so an index match never takes a shot a time match
 * would have had.
 */
export function remapByShot<T>(
  table: Record<number, T> | undefined,
  from: Shot[] | null,
  to: Shot[]
): { table: Record<number, T> | undefined; dropped: number } {
  if (!table) return { table, dropped: 0 }
  const entries = Object.entries(table).map(([key, value]) => ({ ms: Number(key), value }))
  if (entries.length === 0) return { table, dropped: 0 }
  const out: Record<number, T> = {}
  const taken = new Set<number>()
  const left: typeof entries = []
  const near = entries
    .map((e) => {
      let best: Shot | null = null
      for (const s of to) if (!best || Math.abs(s.startMs - e.ms) < Math.abs(best.startMs - e.ms)) best = s
      return { e, best, d: best ? Math.abs(best.startMs - e.ms) : Infinity }
    })
    .sort((a, b) => a.d - b.d)
  for (const { e, best, d } of near) {
    if (best && Number.isFinite(e.ms) && d <= REMAP_TOLERANCE_MS && !taken.has(best.startMs)) {
      out[best.startMs] = e.value
      taken.add(best.startMs)
    } else left.push(e)
  }
  let dropped = 0
  for (const e of left) {
    const i = from ? from.findIndex((s) => s.startMs === e.ms) : -1
    const target = i >= 0 ? to[i] : undefined
    if (target && !taken.has(target.startMs)) {
      out[target.startMs] = e.value
      taken.add(target.startMs)
    } else dropped++
  }
  return { table: Object.keys(out).length > 0 ? out : undefined, dropped }
}

/** A clip's follow moved onto a new track's shots: its drags and its halves' drags. Unchanged when the shots are the same list. */
export function remapFollow(follow: ClipFollow, from: Shot[] | null, to: Shot[]): { follow: ClipFollow; dropped: number } {
  if (from === to || (!follow.offsets && !follow.halfOffsets)) return { follow, dropped: 0 }
  const offsets = remapByShot(follow.offsets, from, to)
  const halves = remapByShot<HalfOffsets>(follow.halfOffsets, from, to)
  const { offsets: _o, halfOffsets: _h, ...rest } = follow
  const next: ClipFollow = {
    ...rest,
    ...(offsets.table ? { offsets: offsets.table } : {}),
    ...(halves.table ? { halfOffsets: halves.table } : {}),
    version: follow.version + 1
  }
  return { follow: next, dropped: offsets.dropped + halves.dropped }
}

/* ----------------------------------------------------------------- edits */

/**
 * A track landing: ONE edit writes `Project.subjects[assetId]`, `follow` on
 * each named clip of that file still on the timeline, and every followed
 * clip's stored crop. Clips of the file that already follow keep their
 * follow, their drags moved onto the new shots (`remapFollow`); `dropped`
 * counts the drags that could not be. The same project back when nothing
 * would change — the track already there and every clip already following
 * where it is.
 */
export function followWithTrack(
  project: Project,
  assetId: string,
  track: SubjectTrack,
  clipIds: readonly string[],
  fps: number
): { project: Project; followed: string[]; dropped: number } {
  const old = project.subjects?.[assetId] ?? null
  const withTrack: Project = old === track ? project : { ...project, subjects: { ...(project.subjects ?? {}), [assetId]: track } }
  const asked = new Set(clipIds)
  const followed: string[] = []
  let dropped = 0
  let changed = withTrack !== project
  const clips = withTrack.clips.map((clip) => {
    if (clip.assetId !== assetId) return clip
    if (!clip.follow && !asked.has(clip.id)) return clip
    let follow: ClipFollow
    if (clip.follow) {
      // The same track is the same shots: nothing moves. No old track (a file saved without one): by time only.
      const moved = remapFollow(clip.follow, old ? old.shots : null, track.shots)
      follow = moved.follow
      dropped += moved.dropped
    } else follow = nextFollow(undefined)
    const draft: Clip = follow === clip.follow ? clip : { ...clip, follow }
    const crop = storedFollowCrop(withTrack, draft, fps)
    followed.push(clip.id)
    if (draft === clip && sameCrop(crop, clip.crop)) return clip
    changed = true
    return { ...draft, crop }
  })
  return { project: changed ? { ...withTrack, clips } : project, followed, dropped }
}

/**
 * Stop following: `follow` goes and the crop stays where it is on `frame`
 * (clip-relative) — static from then on. On a stacked two-up frame that is
 * the top half's position at the clip's full size (`cropAt`'s one-rectangle
 * answer), which is the left-hand person's crop.
 */
export function unfollowClip(project: Project, clipId: string, frame: number): Project {
  const clip = project.clips.find((c) => c.id === clipId)
  if (!clip || !clip.follow) return project
  const { crop } = cropAt(project, clip, null, frame)
  const { follow: _gone, ...rest } = clip
  const still: Clip = { ...rest, crop: { ...crop } }
  return { ...project, clips: project.clips.map((c) => (c.id === clipId ? still : c)) }
}

/** Stack two people on or off: off writes `twoUp: false`, on takes it away (absent means on). The stored crop follows the size. */
export function withFollowTwoUp(project: Project, clipId: string, on: boolean, fps: number): Project {
  const clip = project.clips.find((c) => c.id === clipId)
  if (!clip || !clip.follow) return project
  if ((clip.follow.twoUp !== false) === on) return project
  const { twoUp: _was, ...kept } = clip.follow
  const follow: ClipFollow = on ? { ...kept, version: clip.follow.version + 1 } : nextFollow(clip.follow, { twoUp: false })
  const draft: Clip = { ...clip, follow }
  return { ...project, clips: project.clips.map((c) => (c.id === clipId ? { ...draft, crop: storedFollowCrop(project, draft, fps) } : c)) }
}

/**
 * A drag's total on one shot of a followed clip, SET under the shot's
 * `startMs` exactly as `followKeys` returns it (path.ts matches it by that
 * exact number: a fractional 2035.37 is its own key, never 2035). A number is
 * a share of the crop's free-axis length (`offsets`), read on a shot that is
 * not a two-up; `{ half, x, y }` is one half's, shares of `half` on each axis
 * (`halfOffsets`), read on a two-up shot only. A share the shot would not read
 * — or that is not a number — changes nothing.
 */
export function withFollowOffset(
  project: Project,
  clipId: string,
  shotIndex: number,
  share: number | { half: 'top' | 'bottom'; x: number; y: number },
  fps: number
): Project {
  const clip = project.clips.find((c) => c.id === clipId)
  if (!clip || !clip.follow) return project
  const keys = followKeys(project, clip, fps)
  const shot = keys?.shots.find((s) => s.index === shotIndex)
  if (!keys || !shot) return project
  const key = shot.startMs
  let follow: ClipFollow
  if (typeof share === 'number') {
    if (!Number.isFinite(share) || shot.why === 'two-up') return project
    if (clip.follow.offsets?.[key] === share) return project
    follow = nextFollow(clip.follow, { offsets: { ...(clip.follow.offsets ?? {}), [key]: share } })
  } else {
    if (!Number.isFinite(share.x) || !Number.isFinite(share.y) || shot.why !== 'two-up') return project
    const was = clip.follow.halfOffsets?.[key]
    if (was?.[share.half]?.x === share.x && was?.[share.half]?.y === share.y) return project
    const halves: HalfOffsets = { ...(was ?? {}), [share.half]: { x: share.x, y: share.y } }
    follow = nextFollow(clip.follow, { halfOffsets: { ...(clip.follow.halfOffsets ?? {}), [key]: halves } })
  }
  const draft: Clip = { ...clip, follow }
  return { ...project, clips: project.clips.map((c) => (c.id === clipId ? { ...draft, crop: storedFollowCrop(project, draft, fps) } : c)) }
}

/** The dock's and the Inspector's line: "Follows the subject · N shots", and "· M stacked" when two-ups are among them. */
export function followSummary(keys: Pick<FollowKeys, 'shots'>): string {
  const n = keys.shots.length
  const stacked = keys.shots.filter((s) => s.why === 'two-up').length
  return `Follows the subject · ${n} shot${n === 1 ? '' : 's'}${stacked > 0 ? ` · ${stacked} stacked` : ''}`
}
