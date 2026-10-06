import { parseLink, type ParsedLink } from '@shared/ingest/url'
import { QUALITIES } from '@shared/ingest/format'
import type { IngestRequest } from '@shared/ingest/args'
import { checkLinkClip, type LinkClip } from '@shared/ingest/linkClip'

/**
 * `ingest:start`'s payload, re-validated: the renderer proposes, main decides
 * what is actually spawned. The link parsed again, every field of the request
 * clamped to what it can be, and a Clip it job's words and credit
 * (`clip`, docs/CLIPS.md §3b.4) checked field by field — a malformed one
 * throws, and a path in it is never kept. Main keeps the clip beside the job
 * and `ingest:collect` hands it back, so a reload mid-download loses neither.
 *
 * Its own module, free of Electron, so the shape main keeps is tested as it is
 * (tests/ingestStart.test.ts) rather than through a fake bridge that would
 * pass whatever main did.
 */
export function startRequest(payload: unknown): { link: ParsedLink; request: IngestRequest; clip: LinkClip | null } {
  const raw = (payload ?? {}) as Partial<IngestRequest> & { range?: unknown; clip?: unknown }
  if (typeof raw.url !== 'string') throw new Error('A download needs a link')
  const link = parseLink(raw.url)
  if (!link) throw new Error('That is not a link yt-dlp can read')

  const range =
    raw.range &&
    typeof raw.range === 'object' &&
    Number.isFinite((raw.range as { startMs?: unknown }).startMs) &&
    Number.isFinite((raw.range as { endMs?: unknown }).endMs)
      ? {
          startMs: (raw.range as { startMs: number }).startMs,
          endMs: (raw.range as { endMs: number }).endMs
        }
      : null
  const request: IngestRequest = {
    url: link.url,
    kind: raw.kind === 'audio' || raw.kind === 'instrumental' || raw.kind === 'vocal' ? raw.kind : 'video',
    quality: QUALITIES.includes(raw.quality as never) ? (raw.quality as IngestRequest['quality']) : '1080p',
    audioFormat: raw.audioFormat === 'mp3' ? 'mp3' : 'm4a',
    range,
    exact: raw.exact === true
  }
  // A Clip it job's words and credit: every field checked, never a path.
  const clip = checkLinkClip(raw.clip)
  return { link, request, clip }
}
