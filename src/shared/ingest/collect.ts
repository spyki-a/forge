/**
 * Collecting a finished download, ONCE (docs/INGEST.md, "The renderer half").
 *
 * Main keeps a finished download beside its job until the list is cleared, and
 * the renderer pulls it when the job reads `done`. Pulling survives a reload;
 * it also meant a reload pulled the SAME job again, and the clip landed twice
 * — the renderer's record of what it had collected went with the reload. So
 * main remembers instead: the first collect hands the file back, every later
 * one for that job answers `{ alreadyCollected: true }`, and the renderer
 * leaves the project alone.
 *
 * In shared rather than main, free of Electron and of `node:path`, so the
 * renderer's store test can run main's own rule behind its fake bridge
 * (tests/renderer/ingestReload.test.ts) as well as main's test calling it
 * (tests/ingestStart.test.ts).
 */

import type { MediaAsset } from '../timeline'
import type { IngestRequest } from './args'
import type { LinkClip } from './linkClip'
import type { Range } from './section'

/** What a finished download job leaves for collect (main/ingest/download.ts, then the stem split). */
export interface IngestOutcome {
  path: string
  /** The video's title, for the asset's display name. Null if not learned. */
  title: string | null
  /** True when an earlier download of the same thing was reused. */
  cached: boolean
  /** True when the fast range path was taken and the ends want trimming. */
  approximateRange: boolean
  requestedRange: Range | null
  /**
   * Set by the job, not by download.ts, when the choice was instrumental or
   * vocal: which backend answered and how honest the word "stem" is for it.
   */
  stems?: { backend: string; quality: 'separated' | 'emphasised' } | null
}

/**
 * What main keeps beside a download job (ipc.ts, `ingests`), from
 * `ingest:start` until `jobs:clearFinished` drops the job.
 */
export interface IngestEntry {
  request: IngestRequest
  /** Set by the job when the file the user asked for exists. */
  outcome: IngestOutcome | null
  /** A Clip it job's words and credit (CLIPS.md §3b.4), checked by `startRequest`. */
  clip: LinkClip | null
  /**
   * The file has been handed back once (`collectDownload`). Set only AFTER it
   * was read and named — a failed read leaves the job collectable — and never
   * cleared: every later collect answers `{ alreadyCollected: true }`.
   */
  collected?: boolean
}

/** A finished download, handed back for the first time. */
export interface CollectedDownload {
  /** Where the file actually is — not always inside the downloads folder. */
  path: string
  asset: MediaAsset
  cached: boolean
  /** The fast range path was taken: the ends are loose and want trimming. */
  approximateRange: boolean
  requestedRange: Range | null
  /**
   * For instrumental/vocal: which backend answered. `emphasised` is mid/side
   * and is an emphasis, not a stem — the name already says so, and a UI that
   * shows this should not promise more.
   */
  stems: { backend: string; quality: 'separated' | 'emphasised' } | null
  /**
   * A Clip it job's words and credit, as `startIngest` handed them to main —
   * here so a reload mid-download does not land the clip without them.
   */
  link: LinkClip | null
}

/** This job was handed back before — to this window before a reload, or to another. */
export interface AlreadyCollected {
  alreadyCollected: true
}

export type CollectResult = CollectedDownload | AlreadyCollected

/**
 * Was this answer a repeat? Read loosely, so an answer without the flag — a
 * main from before it existed, a test's bridge — is a fresh outcome as it
 * always was.
 */
export function wasCollected(result: unknown): result is AlreadyCollected {
  return typeof result === 'object' && result !== null && (result as { alreadyCollected?: unknown }).alreadyCollected === true
}

/**
 * `ingest:collect`'s body: the finished download as an asset, named after the
 * video rather than the file — the same split assets:place makes, so nothing
 * downstream learns the clip came from a link.
 *
 * Handed back once. The entry is marked once the file has been read and the
 * answer built, and every later collect answers `{ alreadyCollected: true }`
 * without reading anything. Marked AFTER the read, never before: a probe that
 * fails leaves the job collectable, as it always was. An unknown job, an
 * unfinished one and a missing id fail as they did.
 *
 * `read` probes the file and makes the asset — `probeMany` and `toAsset` in
 * ipc.ts, anything in a test.
 */
export async function collectDownload(
  entries: ReadonlyMap<string, IngestEntry>,
  payload: unknown,
  read: (path: string, name: string, fps: number) => Promise<MediaAsset>
): Promise<CollectResult> {
  const { jobId, fps } = (payload ?? {}) as { jobId?: unknown; fps?: unknown }
  if (typeof jobId !== 'string') throw new Error('Collecting a download needs its job id')
  const entry = entries.get(jobId)
  // Three different situations that all used to say "has not finished".
  if (!entry) throw new Error('That download was cleared from the list')
  const outcome = entry.outcome
  if (!outcome) throw new Error('That download has not finished')
  if (entry.collected) return { alreadyCollected: true }

  // The media pool must tell the song from its instrumental at a glance, and
  // "emphasised" must not be allowed to read as a clean stem.
  const suffix =
    entry.request.kind === 'instrumental'
      ? outcome.stems?.quality === 'separated' ? ' (instrumental)' : ' (instrumental, mid/side)'
      : entry.request.kind === 'vocal'
        ? outcome.stems?.quality === 'separated' ? ' (vocals)' : ' (voice, emphasised)'
        : ''
  // Either separator: shared code has no `node:path`, and main runs on Windows.
  const base = outcome.title ?? outcome.path.split(/[\\/]/).pop() ?? outcome.path
  const projectFps = typeof fps === 'number' && fps > 0 ? fps : 30
  const asset = await read(outcome.path, `${base}${suffix}`, projectFps)

  const collected: CollectedDownload = {
    path: outcome.path,
    asset,
    cached: outcome.cached,
    approximateRange: outcome.approximateRange,
    requestedRange: outcome.requestedRange,
    stems: outcome.stems ?? null,
    link: entry.clip
  }
  entry.collected = true
  return collected
}
