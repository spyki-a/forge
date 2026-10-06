import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  LinkRuns,
  STAGING_PREFIX,
  captionStem,
  captionTrackHandler,
  captionTrackRequest,
  captionsHandler,
  captionsRequest,
  metaHandler,
  runCaptions,
  urlCacheDir
} from '../../src/main/ingest/meta'
import type { IngestTool } from '../../src/main/ingest/download'
import { linkCacheKey, parseLink } from '@shared/ingest/url'
import { transcriptFromTracks } from '@shared/ingest/captions'

/*
 * `ingest:meta` and `ingest:captions`, end to end, against the fake yt-dlp.
 *
 * The handlers are the very functions ipc.ts registers (`metaHandler`,
 * `captionsHandler`) with the fake as the tool, so this runs the argument
 * check, the one-run-per-link rule, the real spawn and the real parser. The
 * fake speaks the measured lines (CLIPS.md §7.1): the metadata subset with
 * absent keys omitted, the `after_video` dict with each `filepath`, `NA` for
 * none, tracks written through a `.part` — made-up words, nobody's speech.
 *
 * The real yt-dlp is measured in docs/EFFECTS.md §40; CI cannot fetch it.
 */

const FAKE = resolve(__dirname, '../fixtures/fake-yt-dlp.mjs')
const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const LINK_KEY = linkCacheKey(parseLink(URL)!)

let dir = ''
let savedUserData: string | undefined

function tool(env: Record<string, string> = {}): IngestTool {
  const assignments = Object.entries(env).map(([k, v]) => `process.env.${k}=${JSON.stringify(v)};`)
  return {
    command: process.execPath,
    // A file URL: Node's ESM loader rejects an absolute Windows path as a specifier.
    prefixArgs: ['--input-type=module', '-e', `${assignments.join('')}await import(${JSON.stringify(pathToFileURL(FAKE).href)});`, '--']
  }
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A track of THIS link in one language, anchored at both ends. */
const anchored = (lang: string): RegExp => new RegExp(`^${escape(captionStem(LINK_KEY))}\\.${escape(lang)}\\.json3$`)

/**
 * Every file's NAME under `folder`, at any depth — yt-dlp writes into a
 * staging folder inside it, and a name is what the patterns are about.
 */
async function allNames(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries.filter((e) => e.isFile()).map((e) => e.name)
}

async function until(check: () => Promise<boolean>, ms: number): Promise<void> {
  const stop = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > stop) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 20))
  }
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-captions-'))
  // The electron stub's userData, so the handler's default folder is real and ours.
  savedUserData = process.env.FORGE_TEST_USERDATA
  process.env.FORGE_TEST_USERDATA = join(dir, 'userData')
})

afterAll(async () => {
  if (savedUserData === undefined) delete process.env.FORGE_TEST_USERDATA
  else process.env.FORGE_TEST_USERDATA = savedUserData
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
})

describe('ingest:meta through the fake yt-dlp', () => {
  it('parses the subset, the credit fields included, and makes an absent heatmap explicit', async () => {
    const meta = await metaHandler(new LinkRuns(), async () => tool())({ url: 'https://youtu.be/dQw4w9WgXcQ?si=x' })
    expect(meta).toMatchObject({
      id: 'dQw4w9WgXcQ',
      title: 'Fake | Title: "quoted"? *starred*',
      duration: 213,
      language: 'en-US',
      channel: 'Fake channel',
      uploader: 'Fake uploader',
      // The canonical URL reached the tool, not what was pasted.
      webpage_url: URL
    })
    expect(meta.chapters.map((c) => c.title)).toEqual(['Opening', 'The rest'])
    expect(meta.heatmap).toBeNull()
  }, 60_000)

  it('reports yt-dlp’s reason', async () => {
    await expect(metaHandler(new LinkRuns(), async () => tool({ FAKE_FAIL: '1' }))({ url: URL })).rejects.toThrow(
      /Video unavailable\. This video is private/
    )
  }, 60_000)
})

describe('ingest:captions through the fake yt-dlp', () => {
  it('lands both tracks under userData/url/<linkKey>/ and hands back one transcript', async () => {
    const got = await captionsHandler(new LinkRuns(), async () => tool())({ url: URL, language: 'en-US' })

    expect(got.linkKey).toBe(LINK_KEY)
    expect(got.keys).toEqual(['en', 'en-orig'])
    // Names, never paths: a drive-letter colon is not content.
    expect(basename(urlCacheDir(LINK_KEY))).toMatch(/^[A-Za-z0-9_-]+$/)
    const byKey = Object.fromEntries(got.tracks.map((t) => [t.key, t]))
    expect(basename(byKey['en'].path)).toMatch(anchored('en'))
    expect(basename(byKey['en-orig'].path)).toMatch(anchored('en-orig'))
    for (const t of got.tracks) {
      expect(basename(dirname(t.path)), t.key).toBe(LINK_KEY)
      expect(basename(dirname(dirname(t.path))), t.key).toBe('url')
    }
    // Told apart by their contents: the uploader's lines and the ASR.
    expect(byKey['en'].kind).toBe('lines')
    expect(byKey['en-orig'].kind).toBe('asr')

    // -orig timing with the uploader's text (§16.12).
    const t = got.transcript!
    expect(t.model).toBe('youtube-asr+lines')
    expect(t.assetId).toBe(`url:${LINK_KEY}`)
    expect(t.language).toBe('en')
    expect(t.words).toHaveLength(36)
    expect(t.words.filter((w) => w.text.endsWith('.'))).toHaveLength(6)
    for (const w of t.words) expect(w.confidence, w.text).toBeNull()
    expect(t.segments).toHaveLength(6)

    // On disk: the two tracks, beside each other in the cache, no partial,
    // and the run's staging folder gone.
    const names = await readdir(urlCacheDir(LINK_KEY))
    expect(names.filter((n) => anchored('en').test(n))).toHaveLength(1)
    expect(names.filter((n) => anchored('en-orig').test(n))).toHaveLength(1)
    expect(names.filter((n) => n.endsWith('.part'))).toEqual([])
    expect(names.filter((n) => n.startsWith(STAGING_PREFIX))).toEqual([])
  }, 60_000)

  it('says "no captions" for a language the video does not have, and writes nothing', async () => {
    const dest = join(dir, 'none')
    const got = await runCaptions(URL, ['fr', 'fr-orig'], tool(), { dir: dest })
    expect(got.tracks).toEqual([])
    expect(got.transcript).toBeNull()
    expect(await readdir(dest)).toEqual([])
  }, 60_000)

  it('leaves no caption file of any language when cancelled — not .en.json3, not .fr.json3', async () => {
    const dest = join(dir, 'cancel')
    const controller = new AbortController()
    const promise = runCaptions(
      URL,
      ['en', 'en-orig', 'fr'],
      tool({ FAKE_SUBS: 'en,en-orig,fr', FAKE_DELAY_MS: '10', FAKE_HOLD_MS: '30000' }),
      { dir: dest, signal: controller.signal }
    )
    // Cancel only once every track is on disk, each matched exactly once — so
    // an empty match afterwards means removed, not never written.
    const langs = ['en', 'en-orig', 'fr']
    await until(async () => {
      const names = await allNames(dest)
      return langs.every((l) => names.filter((n) => anchored(l).test(n)).length === 1)
    }, 30_000)
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'CancelledError' })
    const left = await allNames(dest)
    for (const lang of langs) expect(left.filter((n) => anchored(lang).test(n)), lang).toEqual([])
    expect(await readdir(dest)).toEqual([])
  }, 60_000)

  it('reports yt-dlp’s reason on failure and leaves nothing', async () => {
    const dest = join(dir, 'fail')
    await expect(runCaptions(URL, ['en', 'en-orig'], tool({ FAKE_FAIL: '1' }), { dir: dest })).rejects.toThrow(/HTTP Error 429/)
    expect(await readdir(dest)).toEqual([])
  }, 60_000)

  it('keeps an earlier fetch’s tracks — the reload cache — when a later one fails or is cancelled', async () => {
    // A placed clip's transcriptFrom points at these (CLIPS.md §3b.4).
    const dest = join(dir, 'cache')
    await mkdir(dest, { recursive: true })
    const cached = { en: join(dest, `${captionStem(LINK_KEY)}.en.json3`), orig: join(dest, `${captionStem(LINK_KEY)}.en-orig.json3`) }
    const bytes = { en: '{"events":[],"cached":"en"}', orig: '{"events":[],"cached":"en-orig"}' }
    await writeFile(cached.en, bytes.en)
    await writeFile(cached.orig, bytes.orig)
    expect(basename(cached.en)).toMatch(anchored('en'))
    expect(basename(cached.orig)).toMatch(anchored('en-orig'))

    // Failure, after yt-dlp has written both tracks again.
    await expect(runCaptions(URL, ['en', 'en-orig'], tool({ FAKE_FAIL: '1' }), { dir: dest })).rejects.toThrow(/HTTP Error 429/)
    expect(await readFile(cached.en, 'utf8')).toBe(bytes.en)
    expect(await readFile(cached.orig, 'utf8')).toBe(bytes.orig)

    // Cancel, with this run's own copies of both on disk.
    const controller = new AbortController()
    const promise = runCaptions(URL, ['en', 'en-orig'], tool({ FAKE_HOLD_MS: '30000' }), { dir: dest, signal: controller.signal })
    await until(async () => (await allNames(dest)).filter((n) => anchored('en-orig').test(n)).length === 2, 30_000)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'CancelledError' })
    expect(await readFile(cached.en, 'utf8')).toBe(bytes.en)
    expect(await readFile(cached.orig, 'utf8')).toBe(bytes.orig)
    // Nothing of either run is left: only the two cached tracks.
    expect((await readdir(dest)).sort()).toEqual([basename(cached.en), basename(cached.orig)].sort())
  }, 60_000)

  it('keeps nothing of a format it cannot read', async () => {
    const dest = join(dir, 'vtt')
    const got = await runCaptions(URL, ['en', 'en-orig'], tool({ FAKE_SUB_EXT: 'vtt' }), { dir: dest })
    expect(got.tracks).toEqual([])
    expect(got.transcript).toBeNull()
    expect(await readdir(dest)).toEqual([])
  }, 60_000)

  it('sweeps a staging folder a quit left behind, and not a live one', async () => {
    const dest = join(dir, 'sweep')
    const stale = join(dest, `${STAGING_PREFIX}stale1`)
    const fresh = join(dest, `${STAGING_PREFIX}fresh1`)
    await mkdir(stale, { recursive: true })
    await mkdir(fresh, { recursive: true })
    const hourAgo = new Date(Date.now() - 60 * 60_000)
    await utimes(stale, hourAgo, hourAgo)
    await runCaptions(URL, ['en', 'en-orig'], tool(), { dir: dest })
    const names = await readdir(dest)
    expect(names).not.toContain(basename(stale))
    expect(names).toContain(basename(fresh))
  }, 60_000)

  it('lets a second ask for the same link supersede the first, and keeps the second’s files', async () => {
    const runs = new LinkRuns()
    let calls = 0
    const order: string[] = []
    const handler = captionsHandler(runs, async () => {
      calls++
      if (calls === 2) order.push('second starts')
      return calls === 1 ? tool({ FAKE_HOLD_MS: '30000' }) : tool()
    })
    const folder = urlCacheDir(LINK_KEY)
    await rm(folder, { recursive: true, force: true })

    const first = handler({ url: URL, language: 'en' })
    const firstSettled = first.catch((err: Error) => {
      order.push('first settled')
      return err
    })
    await until(async () => (await allNames(folder)).some((n) => anchored('en-orig').test(n)), 30_000)
    const second = handler({ url: URL, language: 'en' })

    expect(await firstSettled).toMatchObject({ name: 'CancelledError' })
    const got = await second
    expect(calls).toBe(2)
    // The second does not even look for yt-dlp until the first has closed and
    // cleaned up — otherwise that cleanup can delete what the second writes.
    expect(order).toEqual(['first settled', 'second starts'])
    expect(got.tracks.map((t) => t.key).sort()).toEqual(['en', 'en-orig'])
    // The first one's cleanup ran BEFORE the second wrote, and each wrote in a
    // staging folder of its own, so the second's tracks are there.
    const names = await readdir(folder)
    expect(names.filter((n) => anchored('en').test(n))).toHaveLength(1)
    expect(names.filter((n) => anchored('en-orig').test(n))).toHaveLength(1)
  }, 60_000)
})

describe('a time bound, and a quit', () => {
  it('gives up on a stalled metadata read with a timeout, not a cancel', async () => {
    const started = Date.now()
    await expect(
      metaHandler(new LinkRuns(), async () => tool({ FAKE_HOLD_MS: '20000' }), { timeoutMs: 400 })({ url: URL })
    ).rejects.toMatchObject({ name: 'LinkTimeoutError', message: expect.stringMatching(/longer than/) })
    expect(Date.now() - started).toBeLessThan(15_000)
  }, 60_000)

  it('gives up on a stalled caption fetch with a timeout, and cleans up as a cancel does', async () => {
    const folder = urlCacheDir(LINK_KEY)
    const before = (await allNames(folder)).sort()
    await expect(
      captionsHandler(new LinkRuns(), async () => tool({ FAKE_HOLD_MS: '20000' }), { timeoutMs: 400 })({ url: URL, language: 'en' })
    ).rejects.toMatchObject({ name: 'LinkTimeoutError' })
    expect((await allNames(folder)).sort()).toEqual(before)
    expect((await readdir(folder)).filter((n) => n.startsWith(STAGING_PREFIX))).toEqual([])
  }, 60_000)

  it('aborts every run on a quit, as a cancel', async () => {
    const runs = new LinkRuns()
    const dest = urlCacheDir(LINK_KEY)
    const fetch = captionsHandler(runs, async () => tool({ FAKE_HOLD_MS: '20000' }))({ url: URL, language: 'en' })
    // Abort once this run's tracks are on disk: a staging folder with both in it.
    await until(async () => {
      const staged = (await readdir(dest)).filter((n) => n.startsWith(STAGING_PREFIX))
      return staged.length === 1 && (await allNames(join(dest, staged[0]))).some((n) => anchored('en-orig').test(n))
    }, 30_000)
    const started = Date.now()
    runs.abortAll()
    await expect(fetch).rejects.toMatchObject({ name: 'CancelledError' })
    expect(Date.now() - started).toBeLessThan(15_000)
    expect((await readdir(dest)).filter((n) => n.startsWith(STAGING_PREFIX))).toEqual([])
  }, 60_000)
})

describe('what the renderer may ask for', () => {
  it('refuses anything but a link and a readable language, and makes the keys itself', () => {
    expect(() => captionsRequest(null)).toThrow()
    expect(() => captionsRequest({ url: 'not a link', language: 'en' })).toThrow(/not a link/)
    expect(() => captionsRequest({ url: URL })).toThrow(/language/)
    expect(() => captionsRequest({ url: URL, language: 'en.*' })).toThrow(/language/)
    expect(() => captionsRequest({ url: URL, language: 42 })).toThrow(/language/)
    expect(captionsRequest({ url: URL, language: 'en-US' }).keys).toEqual(['en', 'en-orig'])
  })
})

describe('ingest:captionTrack — a kept track read again, by its keys', () => {
  it('reads back what a fetch kept, and the same tracks make the same transcript', async () => {
    const got = await captionsHandler(new LinkRuns(), async () => tool())({ url: URL, language: 'en' })
    const read = captionTrackHandler()
    const tracks = await Promise.all(got.tracks.map((t) => read({ linkKey: got.linkKey, key: t.key })))
    expect(tracks.map((t) => [t.key, t.kind]).sort()).toEqual([
      ['en', 'lines'],
      ['en-orig', 'asr']
    ])
    // The re-read merges exactly as the fetch did, so a run's indices mean the same words.
    const again = transcriptFromTracks(tracks, `url:${got.linkKey}`, 'en')
    expect(again?.words.map((w) => [w.text, w.startMs, w.endMs])).toEqual(got.transcript?.words.map((w) => [w.text, w.startMs, w.endMs]))
  }, 60_000)

  it('builds the path itself, under the link’s own folder, from the two keys', async () => {
    const seen: string[] = []
    const read = captionTrackHandler((linkKey) => {
      seen.push(linkKey)
      return join(dir, 'kept', linkKey)
    })
    const folder = join(dir, 'kept', LINK_KEY)
    await mkdir(folder, { recursive: true })
    const json = { events: [{ tStartMs: 0, dDurationMs: 900, segs: [{ utf8: 'kilo', acAsrConf: 0 }, { utf8: ' lima', tOffsetMs: 400, acAsrConf: 0 }] }] }
    await writeFile(join(folder, `${captionStem(LINK_KEY)}.en-orig.json3`), JSON.stringify(json))
    const back = await read({ linkKey: LINK_KEY, key: 'en-orig' })
    expect(back).toEqual({ key: 'en-orig', kind: 'asr', json })
    expect(seen).toEqual([LINK_KEY])
    // A track that is not there says so.
    await expect(read({ linkKey: LINK_KEY, key: 'fr' })).rejects.toThrow(/no longer on this machine/)
  })

  it('refuses a key that could name anything but a kept track, before reading anything', async () => {
    const asked: string[] = []
    const read = captionTrackHandler((linkKey) => {
      asked.push(linkKey)
      return join(dir, 'kept', linkKey)
    })
    const refused: unknown[] = [
      null,
      {},
      { linkKey: LINK_KEY },
      { key: 'en' },
      { linkKey: '../url', key: 'en' },
      { linkKey: `${LINK_KEY}/..`, key: 'en' },
      { linkKey: 'C:', key: 'en' },
      { linkKey: `${LINK_KEY}.captions`, key: 'en' },
      { linkKey: '', key: 'en' },
      { linkKey: 42, key: 'en' },
      { linkKey: LINK_KEY, key: '../../etc' },
      { linkKey: LINK_KEY, key: 'en/../x' },
      { linkKey: LINK_KEY, key: 'en.json3' },
      { linkKey: LINK_KEY, key: 'all' },
      { linkKey: LINK_KEY, key: 'en.*' },
      { linkKey: LINK_KEY, key: '' }
    ]
    for (const payload of refused) {
      expect(() => captionTrackRequest(payload), JSON.stringify(payload)).toThrow(/not a link this app read|not a caption track/)
      await expect(read(payload), JSON.stringify(payload)).rejects.toThrow(/not a link this app read|not a caption track/)
    }
    // Nothing was looked up for any of them.
    expect(asked).toEqual([])
    expect(captionTrackRequest({ linkKey: LINK_KEY, key: 'pt-BR' })).toEqual({ linkKey: LINK_KEY, key: 'pt-BR' })
  })
})
