import type { Job } from '../types'

/**
 * What EXPORT's header says about the jobs, with the strip open or closed
 * (docs/WINDOW.md §3.17).
 *
 * Both strips start closed, and the Exports list — the only place a finished
 * export's state, its error and "Show in folder" are — is in the hidden body.
 * Before step 7 that list was always on screen, in the Inspector. So the
 * header carries one line of it:
 *
 * - something under way: the running job, else the first one waiting. Any job:
 *   a download shares the queue, and the list shows it (Decision 7);
 * - otherwise how the last EXPORT ended — done or failed. Only a render: a
 *   download's ending already shows (the file lands in the media pool, and a
 *   failure is a toast, store.ts), an export's nowhere else. Failures are not
 *   reported anywhere else at all (main/queue.ts only sets the status).
 *
 * A last export that was cancelled says nothing: the person did that, and an
 * older export's mark under it would be news about the wrong file.
 */
export type ExportHeadline =
  | { kind: 'running' | 'waiting'; job: Job }
  | { kind: 'done' | 'failed'; job: Job }
  | null

export function exportHeadline(jobs: readonly Job[]): ExportHeadline {
  const running = jobs.find((job) => job.status === 'running')
  if (running) return { kind: 'running', job: running }
  const waiting = jobs.find((job) => job.status === 'queued')
  if (waiting) return { kind: 'waiting', job: waiting }

  let last: Job | null = null
  for (const job of jobs) {
    if (job.presetId !== 'render') continue
    if (job.status !== 'done' && job.status !== 'failed' && job.status !== 'cancelled') continue
    // The latest to finish, whatever order the list is in; ties go to the later entry.
    if (last === null || (job.finishedAt ?? 0) >= (last.finishedAt ?? 0)) last = job
  }
  if (last === null) return null
  if (last.status === 'done') return { kind: 'done', job: last }
  if (last.status === 'failed') return { kind: 'failed', job: last }
  return null
}
