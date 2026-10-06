import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { startRequest } from '../src/main/ingest/start'
import { collectDownload, wasCollected, type IngestEntry } from '@shared/ingest/collect'
import type { LinkClip } from '@shared/ingest/linkClip'
import type { MediaAsset } from '@shared/timeline'

/*
 * Main's half of a Clip it job surviving a reload (docs/CLIPS.md §3b.4): the
 * clip `ingest:start` keeps beside the job, `ingest:collect` hands back, and
 * the `ingest:captionTrack` channel the words are read again through. And
 * `ingest:collect` handing a job back ONCE, so a reload does not land it
 * again (`collectDownload`, docs/INGEST.md "The renderer half").
 *
 * The renderer's tests fake the bridge — clipItCollect.test.ts has
 * `collectIngest` return `link: job.clip` — so they pass whatever main does.
 * This is main: `startRequest` run as it is, the preload loaded with a fake
 * `ipcRenderer` to see what it sends, and the handlers' wiring in ipc.ts read
 * as source — each anchor counted, because a string that occurs twice can
 * match the wrong one and look like it worked.
 */

const URL = 'https://www.youtube.com/watch?v=MadeUpTalk1'

const clip = (): LinkClip => ({
  transcriptFrom: {
    linkKey: 'MadeUpTalk1-0a1b2c3d',
    keys: ['en', 'en-orig'],
    range: { startMs: 20_000, endMs: 21_000 },
    run: { from: 3, to: 3 },
    headOffsetMs: 0,
    words: { count: 8, first: 'lima', last: 'lima' }
  },
  credit: {
    source: 'link',
    title: 'A made-up talk',
    author: 'Made-up channel',
    pageUrl: URL,
    line: `A made-up talk — Made-up channel, ${URL}`,
    attributionRequired: false,
    fetchedAt: '2026-10-06T00:00:00.000Z'
  }
})

describe('ingest:start’s payload, as main keeps it', () => {
  it('keeps a Clip it job’s clip, field for field — a stray path in it is not kept', () => {
    const raw = { url: URL, kind: 'video', quality: '720p', audioFormat: 'm4a', range: { startMs: 20_000, endMs: 21_000 }, exact: true }
    const sent = { ...raw, clip: { ...clip(), transcriptFrom: { ...clip().transcriptFrom, path: '/etc/passwd' } } }
    const { request, clip: kept } = startRequest(sent)
    expect(kept).toEqual(clip())
    expect(JSON.stringify(kept)).not.toContain('passwd')
    expect(request).toEqual({ ...raw, url: URL })
  })

  it('refuses a malformed clip rather than keeping it', () => {
    const bad = { ...clip(), transcriptFrom: { ...clip().transcriptFrom, linkKey: '../url' } }
    expect(() => startRequest({ url: URL, clip: bad })).toThrow(/could not be read/)
    const noKeys = { ...clip(), transcriptFrom: { ...clip().transcriptFrom, keys: ['en/../x'] } }
    expect(() => startRequest({ url: URL, clip: noKeys })).toThrow(/could not be read/)
  })

  it('a plain Get has no clip, and the request is clamped as before', () => {
    const { request, clip: none } = startRequest({ url: URL, kind: 'karaoke', quality: '8K', audioFormat: 'flac', range: { startMs: 0, endMs: Number.NaN }, exact: 'yes' })
    expect(none).toBeNull()
    expect(request).toEqual({ url: URL, kind: 'video', quality: '1080p', audioFormat: 'm4a', range: null, exact: false })
    expect(() => startRequest({})).toThrow('A download needs a link')
    expect(() => startRequest({ url: 'not a link' })).toThrow('That is not a link yt-dlp can read')
  })
})

describe('the preload sends what main reads', () => {
  it('startIngest carries the clip beside the request, and ingestCaptionTrack sends the two keys and nothing else', async () => {
    const invoke = vi.fn(async () => undefined)
    let api: Record<string, (...args: unknown[]) => unknown> = {}
    vi.resetModules()
    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld: (_name: string, exposed: typeof api) => (api = exposed) },
      ipcRenderer: { invoke, on: vi.fn(), send: vi.fn(), removeListener: vi.fn() },
      webUtils: { getPathForFile: () => '' }
    }))
    await import('../src/preload/index')
    vi.doUnmock('electron')

    const request = { url: URL, kind: 'video', quality: '1080p', audioFormat: 'm4a', range: { startMs: 20_000, endMs: 21_000 }, exact: true }
    await api.startIngest(request, clip())
    await api.startIngest(request, null)
    await api.ingestCaptionTrack('MadeUpTalk1-0a1b2c3d', 'en-orig')
    expect(invoke.mock.calls).toEqual([
      ['ingest:start', { ...request, clip: clip() }],
      ['ingest:start', request],
      ['ingest:captionTrack', { linkKey: 'MadeUpTalk1-0a1b2c3d', key: 'en-orig' }]
    ])
  })
})

describe('main’s handlers are wired to keep and hand back the clip', () => {
  const ipc = readFileSync(resolve(__dirname, '../src/main/ipc.ts'), 'utf8')
  const count = (text: string, needle: string): number => text.split(needle).length - 1
  /** One handler's body: from its `ipcMain.handle(` to the first line closing it at the handler's indent. */
  const handler = (channel: string): string => {
    const open = `ipcMain.handle('${channel}'`
    expect(count(ipc, open), open).toBe(1)
    const from = ipc.indexOf(open)
    const end = ipc.indexOf('\n  })', from)
    expect(end).toBeGreaterThan(from)
    return ipc.slice(from, end)
  }

  it('ingest:start keeps the clip startRequest checked, beside the job', () => {
    const body = handler('ingest:start')
    expect(count(body, 'const { link, request, clip } = startRequest(payload)')).toBe(1)
    expect(count(body, '(id) => ingests.set(id, { request, outcome: null, clip })')).toBe(1)
    // Nothing else in the file keeps an ingest entry.
    expect(count(ipc, 'ingests.set(')).toBe(1)
  })

  it('ingest:collect is collectDownload over the same map ingest:start fills — what it hands back is tested below', () => {
    const body = handler('ingest:collect')
    expect(count(body, 'return collectDownload(ingests, payload, readDownload)')).toBe(1)
    // The one call in the file, and the one map: nothing else collects, or keeps, an entry.
    expect(count(ipc, 'collectDownload(')).toBe(1)
    expect(count(ipc, 'const ingests = new Map<string, IngestEntry>()')).toBe(1)
    // The probe it reads with is the real one.
    expect(count(ipc, 'const readDownload = async (path: string, name: string, fps: number): Promise<MediaAsset> => {')).toBe(1)
    expect(count(ipc, 'const { ok, failed } = await probeMany([path])')).toBe(1)
    expect(count(ipc, 'return toAsset({ ...ok[0], name }, fps)')).toBe(1)
  })

  it('ingest:captionTrack is registered once, on the handler that builds the path from urlCacheDir', () => {
    expect(count(ipc, "'ingest:captionTrack'")).toBe(1)
    expect(count(ipc, "ipcMain.handle('ingest:captionTrack', (_e, payload: unknown) => captionTrack(payload))")).toBe(1)
    // No directory handed in: the default, urlCacheDir, is the app's.
    expect(count(ipc, 'const captionTrack = captionTrackHandler()')).toBe(1)
    expect(count(ipc, 'captionTrackHandler(')).toBe(1)
  })
})

describe('ingest:collect hands a job back once (collectDownload)', () => {
  const FILE = '/downloads/MadeUpTalk1.video-1080p.r20000-21000.mp4'

  /** What `ingest:start` keeps, and the job then finishing. */
  function finished(clipped: LinkClip | null): Map<string, IngestEntry> {
    const { request, clip: kept } = startRequest({ url: URL, range: { startMs: 20_000, endMs: 21_000 }, exact: true, clip: clipped ?? undefined })
    const entry: IngestEntry = { request, outcome: null, clip: kept }
    entry.outcome = {
      path: FILE,
      title: 'A made-up talk',
      cached: true,
      approximateRange: false,
      requestedRange: { startMs: 20_000, endMs: 21_000 },
      stems: null
    }
    return new Map([['job-1', entry]])
  }

  const asset = (path: string, name: string, fps: number): MediaAsset => ({
    id: 'asset-1', path, name, kind: 'video', durationFrames: fps, width: 1920, height: 1080, fps, hasVideo: true, hasAudio: true, size: 1
  })

  it('the first collect hands the file back — named, at the project fps, with the kept clip as `link`', async () => {
    const entries = finished(clip())
    const read = vi.fn(async (path: string, name: string, fps: number) => asset(path, name, fps))
    const got = await collectDownload(entries, { jobId: 'job-1', fps: 25 }, read)
    expect(read.mock.calls).toEqual([[FILE, 'A made-up talk', 25]])
    // What this test names, not the whole answer: a field added to it later is not a bug here.
    expect(got).toMatchObject({
      path: FILE,
      asset: { path: FILE, name: 'A made-up talk', fps: 25 },
      cached: true,
      approximateRange: false,
      requestedRange: { startMs: 20_000, endMs: 21_000 },
      stems: null,
      link: clip()
    })
    expect(entries.get('job-1')?.collected).toBe(true)
  })

  it('a second collect of the same job answers alreadyCollected, and reads nothing', async () => {
    const entries = finished(null)
    const read = vi.fn(async (path: string, name: string, fps: number) => asset(path, name, fps))
    const first = await collectDownload(entries, { jobId: 'job-1', fps: 30 }, read)
    expect(first).toMatchObject({ path: FILE, link: null })
    // The flag, not the whole shape: a repeat that later also says where the file is, is still a repeat.
    expect(await collectDownload(entries, { jobId: 'job-1', fps: 30 }, read)).toMatchObject({ alreadyCollected: true })
    expect(await collectDownload(entries, { jobId: 'job-1', fps: 30 }, read)).toMatchObject({ alreadyCollected: true })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('marks the entry only after a successful read: a failed probe leaves the job collectable', async () => {
    const entries = finished(clip())
    let fail = true
    const read = vi.fn(async (path: string, name: string, fps: number) => {
      // While the probe runs the entry is not yet collected: a crash here must not lose the clip.
      expect(entries.get('job-1')?.collected).toBeFalsy()
      if (fail) throw new Error('Invalid data found when processing input')
      return asset(path, name, fps)
    })
    await expect(collectDownload(entries, { jobId: 'job-1', fps: 30 }, read)).rejects.toThrow('Invalid data found')
    expect(entries.get('job-1')?.collected).toBeFalsy()
    fail = false
    const again = await collectDownload(entries, { jobId: 'job-1', fps: 30 }, read)
    expect(again).toMatchObject({ path: FILE, link: clip() })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('an unknown job, an unfinished one and a missing id still fail as before — and mark nothing', async () => {
    const entries = finished(null)
    const read = vi.fn(async (path: string, name: string, fps: number) => asset(path, name, fps))
    await expect(collectDownload(entries, { jobId: 'job-2', fps: 30 }, read)).rejects.toThrow('That download was cleared from the list')
    await expect(collectDownload(entries, { fps: 30 }, read)).rejects.toThrow('Collecting a download needs its job id')
    await expect(collectDownload(entries, undefined, read)).rejects.toThrow('Collecting a download needs its job id')
    entries.get('job-1')!.outcome = null
    await expect(collectDownload(entries, { jobId: 'job-1', fps: 30 }, read)).rejects.toThrow('That download has not finished')
    expect(entries.get('job-1')?.collected).toBeFalsy()
    expect(read).not.toHaveBeenCalled()
  })

  it('the renderer reads a repeat only from alreadyCollected: true — a fresh answer, either shape, is a fresh answer', async () => {
    const entries = finished(null)
    const read = vi.fn(async (path: string, name: string, fps: number) => asset(path, name, fps))
    const fresh = await collectDownload(entries, { jobId: 'job-1', fps: 30 }, read)
    const repeat = await collectDownload(entries, { jobId: 'job-1', fps: 30 }, read)
    expect(wasCollected(fresh)).toBe(false)
    expect(wasCollected(repeat)).toBe(true)
    // Tolerant of shapes main does not send: none of these is a repeat.
    for (const other of [{ ...fresh, alreadyCollected: false }, { alreadyCollected: 'yes' }, { alreadyCollected: undefined }, null, undefined, 'alreadyCollected']) {
      expect(wasCollected(other), JSON.stringify(other)).toBe(false)
    }
  })

  it('names a stem by what answered, as before', async () => {
    const entries = finished(null)
    const entry = entries.get('job-1')!
    entry.request = { ...entry.request, kind: 'instrumental' }
    entry.outcome = { ...entry.outcome!, stems: { backend: 'midside', quality: 'emphasised' } }
    const read = vi.fn(async (path: string, name: string, fps: number) => asset(path, name, fps))
    const got = await collectDownload(entries, { jobId: 'job-1', fps: 0 }, read)
    expect(read.mock.calls).toEqual([[FILE, 'A made-up talk (instrumental, mid/side)', 30]])
    expect(got).toMatchObject({ stems: { backend: 'midside', quality: 'emphasised' } })
  })
})
