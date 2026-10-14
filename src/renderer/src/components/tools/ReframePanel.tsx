import { useEffect, type ReactNode } from 'react'
import { ScanFace } from 'lucide-react'
import { followKeys } from '@shared/reframe/keys'
import type { ModelStatus, ReframeHelper } from '@shared/reframe/job'
import { useEditor } from '../../store'

/**
 * Follow the subject — the Trimmer dock's reframe section for a selected
 * VIDEO clip (docs/CLIPS.md §4.8; home `dock`, WINDOW.md §3.18). Mounted in
 * Inspector.tsx under Steady, for a video clip only.
 *
 * Top to bottom:
 * - **Follow the subject** — or, on a clip that follows, **Unfollow**. While
 *   the face finder is not on disk it reads "Follow the subject · gets the
 *   face finder, 1.1 MB, first time": the press is what fetches it (the
 *   store's `reframeClip` fetches first, then analyses), so the size is said
 *   before the press, never after. Greyed with "needs the AI helper" when
 *   there is no helper to find a face: without one the job would only find
 *   the shots and centre every crop, which is what the clip already has.
 * - On a clip that follows: its shots ("3 shots · 1 stacked", from the same
 *   compiled keys the export cuts with), **Stack two people** (on by default;
 *   off frames the larger face in a shot whose two people are too far apart
 *   for one crop), and followKeys' notes — "shot 3: two people too far apart,
 *   stacked", a canvas of the file's own shape, a held frame.
 * - **Follow:** with its phrase field, greyed: following something named
 *   ("the cake") is Florence-2's grounding, step 1g, which is not built.
 *
 * NOT "Get the subject model" or "Find subjects without faces": the analysis
 * never calls the salient finder, on any machine (decided 2026-10-13, §16.35).
 *
 * The section itself (`FollowSection`) reads nothing but the store, so a test
 * can render it and press it as a function; this wrapper asks the face finder's
 * status once the helper is up, which is the label's only input from main.
 */
export interface ReframePanelProps {
  clipId: string
}

export function ReframePanel({ clipId }: ReframePanelProps): ReactNode {
  const helper = useEditor((s) => s.reframe.helper)
  const model = useEditor((s) => s.reframe.model)
  const setReframeModel = useEditor((s) => s.setReframeModel)

  /*
   * Is the face finder on disk? Asked once the AI helper is up and nobody has
   * asked yet — `faceModel({})` never downloads (only the press's
   * `{ download: true }` does). A failed ask leaves it unknown and the button
   * plain; the press finds out.
   */
  useEffect(() => {
    if (helper !== 'ready' || model !== null) return
    let live = true
    window.forge
      .faceModel({})
      .then((status) => {
        if (live) setReframeModel(status)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [helper, model, setReframeModel])

  return <FollowSection clipId={clipId} />
}

/** The size the press will fetch, as the plan writes it: decimal MB, one place — 1,083,786 bytes is "1.1". */
export function modelMegabytes(model: Pick<ModelStatus, 'bytes'>): string {
  return (model.bytes / 1_000_000).toFixed(1)
}

/** Why the button is greyed, or null when it is not: the helper's state, said as a person would. */
export function helperReason(helper: ReframeHelper): string | null {
  if (helper === 'ready') return null
  return helper === 'missing' ? 'needs the AI helper' : 'the AI helper is starting'
}

/**
 * Why the Follow: field is greyed, in the user's words: the same sentence the
 * job refuses a phrase with (job.ts REFRAME_FAILURES['phrase-needs-ground']).
 * Not "the subject model, step 1g": a step number means nothing on screen,
 * and "the subject model" was the salient finder's name (§4.8), which §16.35
 * dropped — the field would have named a model nobody can get.
 */
export const PHRASE_REASON = 'following something named is not built yet'

export function FollowSection({ clipId }: ReframePanelProps): ReactNode {
  const project = useEditor((s) => s.project)
  const reframe = useEditor((s) => s.reframe)
  const jobs = useEditor((s) => s.jobs)
  const reframeClip = useEditor((s) => s.reframeClip)
  const unfollow = useEditor((s) => s.unfollow)
  const setFollowTwoUp = useEditor((s) => s.setFollowTwoUp)
  const notify = useEditor((s) => s.notify)

  const clip = project.clips.find((c) => c.id === clipId)
  const asset = clip ? project.assets.find((a) => a.id === clip.assetId) : undefined
  if (!clip || !asset || asset.kind !== 'video') return null

  // The same compiled keys the export cuts with and the preview draws from: never re-derived here.
  const keys = clip.follow ? followKeys(project, clip, project.settings.fps) : null
  const following = Boolean(clip.follow && keys)
  const why = helperReason(reframe.helper)
  const jobId = reframe.pending[asset.id]
  const job = jobId ? jobs.find((j) => j.id === jobId) : undefined
  const fetching = reframe.fetching
  const busy = jobId !== undefined || fetching !== null
  const firstTime = reframe.model !== null && !reframe.model.present
  const stacked = keys ? keys.shots.filter((shot) => shot.why === 'two-up').length : 0
  const twoUp = clip.follow?.twoUp !== false

  const follow = (): void => {
    void reframeClip(clip.id).catch((err) => notify(err instanceof Error ? err.message : String(err)))
  }

  const percent = (p: number | null | undefined): string => (typeof p === 'number' ? ` ${Math.round(p * 100)}%` : '')

  return (
    <div data-reframe-panel="" className="space-y-1.5 border-t border-ink-850 pt-2">
      {/*
        Follow the subject, or — while the clip follows — Unfollow. A clip that
        says it follows but whose file's track is gone or out of date (a
        re-encoded file, an older version) gets both: Follow analyses it again.
      */}
      {!following && (
        <button
          type="button"
          onClick={follow}
          disabled={why !== null || busy}
          title={
            why !== null
              ? `Following the subject ${why}`
              : firstTime && reframe.model
                ? `Find the faces in this clip’s file and keep the crop on them, shot by shot. The first time, the face finder (${modelMegabytes(reframe.model)} MB) is downloaded from ${reframe.model.host}.`
                : 'Find the faces in this clip’s file and keep the crop on them, shot by shot.'
          }
          className="flex w-full items-center gap-1.5 rounded bg-ink-800 px-1.5 py-1 text-left text-[10px] text-ink-200 transition-colors hover:bg-ink-700 hover:text-ink-100 disabled:opacity-50 disabled:hover:bg-ink-800"
        >
          <ScanFace size={12} className="shrink-0 text-ink-400" aria-hidden />
          {jobId !== undefined ? (
            <span>Finding the subject…{percent(job?.progress)}</span>
          ) : fetching !== null ? (
            <span>Getting the face finder…{percent(fetching.progress)}</span>
          ) : (
            <span className="min-w-0">
              <span>Follow the subject</span>
              {firstTime && reframe.model && (
                <span className="text-ink-500">{` · gets the face finder, ${modelMegabytes(reframe.model)} MB, first time`}</span>
              )}
            </span>
          )}
        </button>
      )}
      {/*
        Why Follow is greyed, under it — and only with it. A clip that already
        follows keeps following without the helper (its track is the
        project's), so the reason beside Unfollow read as if the follow broke.
      */}
      {!following && why !== null && <p className="text-[9.5px] leading-snug text-ink-600">{why}</p>}

      {clip.follow && (
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[10px] text-ink-300">
            {following && keys ? (
              <>
                {`${keys.shots.length} shot${keys.shots.length === 1 ? '' : 's'}`}
                {stacked > 0 && <span className="text-ink-500">{` · ${stacked} stacked`}</span>}
              </>
            ) : (
              'No subject track for this file'
            )}
          </span>
          <button
            type="button"
            onClick={() => unfollow(clip.id)}
            title="Stop following: the crop stays where it is at the playhead"
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
          >
            Unfollow
          </button>
        </div>
      )}

      {following && (
        <button
          type="button"
          aria-pressed={twoUp}
          onClick={() => setFollowTwoUp(clip.id, !twoUp)}
          title={
            twoUp
              ? 'Two people too far apart for one crop each get half the frame, stacked. Off: the larger face is framed.'
              : 'Off: the larger face is framed. On: two people too far apart for one crop each get half the frame, stacked.'
          }
          className={`w-full rounded px-1.5 py-1 text-left text-[10px] transition-colors ${
            twoUp ? 'bg-ink-800 text-ink-100' : 'text-ink-500 hover:bg-ink-850 hover:text-ink-300'
          }`}
        >
          Stack two people
        </button>
      )}

      {following && keys && keys.notes.length > 0 && (
        <ul className="space-y-0.5">
          {keys.notes.map((note, i) => (
            <li key={i} className="text-[9.5px] leading-snug text-ink-500">
              {note}
            </li>
          ))}
        </ul>
      )}

      {/*
        Follow: a phrase, for a shot no face leads ("the cake"). That is
        Florence-2's grounding (§4.5, step 1g), not built: the field is here,
        greyed, so where it will be is not a surprise, and says why.
      */}
      <div className="flex items-center gap-2" title={`Follow something named instead of a face, such as “the cake” — ${PHRASE_REASON}`}>
        <span className="shrink-0 text-[10px] text-ink-500">Follow:</span>
        <input
          type="text"
          disabled
          readOnly
          value=""
          placeholder="a face"
          aria-label="What to follow"
          className="min-w-0 flex-1 rounded border border-ink-800 bg-ink-900 px-1.5 py-0.5 text-[10px] text-ink-400 disabled:opacity-50"
        />
      </div>
      <p className="text-[9.5px] leading-snug text-ink-600">{PHRASE_REASON}</p>
    </div>
  )
}
