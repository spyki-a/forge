import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { startRequest } from '../src/main/ingest/start'
import type { LinkClip } from '@shared/ingest/linkClip'

/*
 * Main's half of a Clip it job surviving a reload (docs/CLIPS.md §3b.4): the
 * clip `ingest:start` keeps beside the job, `ingest:collect` hands back, and
 * the `ingest:captionTrack` channel the words are read again through.
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

  it('ingest:collect hands the kept clip back as `link`', () => {
    const body = handler('ingest:collect')
    expect(count(body, 'const entry = ingests.get(jobId)')).toBe(1)
    expect([...body.matchAll(/\blink:/g)]).toHaveLength(1)
    expect(count(body, 'link: entry.clip\n')).toBe(1)
  })

  it('ingest:captionTrack is registered once, on the handler that builds the path from urlCacheDir', () => {
    expect(count(ipc, "'ingest:captionTrack'")).toBe(1)
    expect(count(ipc, "ipcMain.handle('ingest:captionTrack', (_e, payload: unknown) => captionTrack(payload))")).toBe(1)
    // No directory handed in: the default, urlCacheDir, is the app's.
    expect(count(ipc, 'const captionTrack = captionTrackHandler()')).toBe(1)
    expect(count(ipc, 'captionTrackHandler(')).toBe(1)
  })
})
