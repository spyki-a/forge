import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '@shared/types'
import type { MediaAsset } from '@shared/timeline'
import { deserializeProject, serializeProject } from '@shared/project'
import { linkCacheKey, parseLink } from '@shared/ingest/url'
import { json3Kind } from '@shared/ingest/captions'
import type { LinkClip } from '@shared/ingest/linkClip'
import type { IngestRequest } from '@shared/ingest/args'
import { collectDownload, type IngestEntry } from '@shared/ingest/collect'

/*
 * A reload must not land a collected download a second time (docs/INGEST.md,
 * "The renderer half"; found by a reviewer of CLIPS.md §3b, 2026-10-06).
 *
 * The reviewer's recipe, exactly: collect a done job, a fresh store (the
 * module evaluated again — what Cmd+R does to `collecting`), the same project
 * restored from its saved file, and `setJobs([job])` — main still lists the
 * finished job. On the code before the fix the clip count went 1 → 2, for a
 * plain Get and for Clip it alike.
 *
 * The bridge is not a fake of main's rule: it calls `collectDownload`
 * (shared/ingest/collect.ts) — `ingest:collect`'s whole body — over the entry
 * main keeps, with only the probe stood in. So this fails if main forgets to
 * mark the entry, and if the renderer ignores what main answers — and, for
 * Clip it, if the first window lands the clip without its words.
 */

const URL = 'https://www.youtube.com/watch?v=MadeUpTalk1'
const LINK = parseLink(URL)!
const LINK_KEY = linkCacheKey(LINK)
const PROJECT_PATH = '/projects/wedding.forge'
const FILE = '/downloads/MadeUpTalk1.video-1080p.mp4'

/** The job row as main's `jobs:list` gives it, finished. */
const job: Job = {
  id: 'job-1',
  presetId: 'ingest',
  input: LINK.url,
  inputName: 'YouTube · MadeUpTalk1',
  output: '/downloads',
  params: {},
  status: 'done',
  progress: 1,
  speed: null,
  error: null,
  startedAt: 1,
  finishedAt: 2
}

/** One ASR line, three words, in the measured json3 shape (EFFECTS.md §40). */
const json3 = {
  wireMagic: 'pb3',
  events: [
    { tStartMs: 0, dDurationMs: 60_000, id: 1 },
    {
      tStartMs: 0,
      dDurationMs: 3000,
      wWinId: 1,
      segs: [
        { utf8: 'alpha', acAsrConf: 0 },
        { utf8: ' bravo', tOffsetMs: 400, acAsrConf: 0 },
        { utf8: ' charlie.', tOffsetMs: 800, acAsrConf: 0 }
      ]
    }
  ]
}

const clipIt: LinkClip = {
  transcriptFrom: {
    linkKey: LINK_KEY,
    keys: ['en'],
    range: { startMs: 0, endMs: 3000 },
    run: { from: 0, to: 1 },
    headOffsetMs: 0,
    words: { count: 3, first: 'alpha', last: 'bravo' }
  },
  credit: {
    source: 'link',
    title: 'A made-up talk',
    author: 'Made-up channel',
    pageUrl: LINK.url,
    line: `A made-up talk — Made-up channel, ${LINK.url}`,
    attributionRequired: false,
    fetchedAt: '2026-10-06T00:00:00.000Z'
  }
}

let entries: Map<string, IngestEntry>
/** Main's probes: each makes a new asset id, as `toAsset` does. */
let reads = 0
let calls: Promise<unknown>[] = []

async function readAsset(path: string, name: string, fps: number): Promise<MediaAsset> {
  reads++
  return { id: `asset-${reads}`, path, name, kind: 'video', durationFrames: 3 * fps, width: 1920, height: 1080, fps, hasVideo: true, hasAudio: true, size: 1 }
}

/** What `ingest:start` keeps (`startRequest`'s request, as tests/ingestStart.test.ts pins it), and the job then finishing. */
function started(clip: LinkClip | null): void {
  const request: IngestRequest = { url: LINK.url, kind: 'video', quality: '1080p', audioFormat: 'm4a', range: null, exact: false }
  const entry: IngestEntry = { request, outcome: null, clip }
  entry.outcome = { path: FILE, title: 'A made-up talk', cached: false, approximateRange: false, requestedRange: null, stems: null }
  entries = new Map([[job.id, entry]])
}

beforeEach(() => {
  reads = 0
  calls = []
  vi.stubGlobal('window', {
    forge: {
      collectIngest: (jobId: string, fps: number) => {
        const call = collectDownload(entries, { jobId, fps }, readAsset)
        calls.push(call)
        return call
      },
      ingestCaptionTrack: async (_linkKey: string, key: string) => ({ key, kind: json3Kind(json3)!, json: json3 })
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A fresh renderer: the store module evaluated again, its module-level `collecting` empty — what Cmd+R does. */
async function freshStore() {
  vi.resetModules()
  return (await import('../../src/renderer/src/store')).useEditor
}

/** Every collect the bridge was asked for, answered and landed. */
async function settled(): Promise<void> {
  await Promise.allSettled(calls)
  await new Promise((r) => setTimeout(r, 0))
}

describe.each([
  ['a plain Get', null],
  ['a Clip it', clipIt]
] as const)('a reload after %s was collected', (_name, clip) => {
  it('lands the clip once: the second window is told alreadyCollected and touches nothing', async () => {
    started(clip)

    // The first window: the job reads done, the clip lands, the project is saved.
    let editor = await freshStore()
    editor.getState().loadProject(editor.getState().project, PROJECT_PATH, [])
    editor.getState().setJobs([job])
    await settled()
    const first = editor.getState().project
    expect(first.clips.filter((c) => c.assetId === 'asset-1')).toHaveLength(1)
    if (clip) expect(first.assets[0].credit?.line).toBe(clipIt.credit!.line)
    // Clip it's words landed with it — read again through `transcriptFrom`, as
    // main handed it back — so this row is not a plain Get with a credit on.
    if (clip) expect(Object.keys(first.transcripts)).toContain('asset-1')
    if (clip) expect(first.transcripts['asset-1']?.words.map((w) => w.text)).toContain('alpha')
    expect(editor.getState().notices.some((n) => n.text.includes('without its words'))).toBe(false)
    const saved = JSON.parse(JSON.stringify(serializeProject(first, { appVersion: '0.1.0' })))

    // Cmd+R: a fresh store, the same project restored, and main's job list read again.
    editor = await freshStore()
    editor.getState().loadProject(deserializeProject(saved).project, PROJECT_PATH, [])
    const before = editor.getState()
    calls = []
    editor.getState().setJobs([job])
    await settled()

    // One clip, the project and its undo stack as the file left them, and nothing
    // said. The guards against a second landing are the clip count, the
    // project's and `past`'s identity, and `reads` below. The asset id and the
    // asset count cannot fail on it: the store's samePath guard gives a second
    // landing of the same file asset-1 again (measured with main's mark and the
    // clip count both removed: these two passed, project identity failed first).
    const after = editor.getState()
    expect(after.project.clips).toHaveLength(1)
    expect(after.project.clips[0].assetId).toBe('asset-1')
    expect(after.project.assets).toHaveLength(1)
    expect(after.project).toBe(before.project)
    expect(after.past).toBe(before.past)
    expect(after.notices.map((n) => n.text)).toEqual([])
    expect(after.dirty).toBe(false)
    expect(after.pendingIngests).toBe(before.pendingIngests)

    // Main was asked, and answered without probing the file again.
    expect(calls).toHaveLength(1)
    expect(await calls[0]).toMatchObject({ alreadyCollected: true })
    expect(reads).toBe(1)

    // No transaction left open: the next edit is its own undo step.
    editor.getState().update((p) => ({ ...p, name: 'Renamed' }))
    expect(editor.getState().past).toHaveLength(before.past.length + 1)

    // The claim is kept: the next broadcasts do not ask main again.
    editor.getState().setJobs([job])
    editor.getState().setJobs([job])
    await settled()
    expect(calls).toHaveLength(1)
  })
})
