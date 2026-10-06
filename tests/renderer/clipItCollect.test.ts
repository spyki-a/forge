import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditor } from '../../src/renderer/src/store'
import { linkCacheKey, parseLink } from '@shared/ingest/url'
import { json3Kind, transcriptFromTracks } from '@shared/ingest/captions'
import type { IngestRequest, LinkMeta } from '@shared/ingest/args'
import type { LinkClip } from '@shared/ingest/linkClip'
import { buildTimelineCaptions } from '@shared/captions/timeline'
import { resolveStyle, type StyleOverrides } from '@shared/captions/style'
import { toAssTime } from '@shared/captions/ass'
import type { MediaAsset } from '@shared/timeline'
import { deserializeProject, serializeProject } from '@shared/project'
import { applyRelink } from '@shared/project/relink'

/*
 * Clip it, collected (docs/CLIPS.md §3b.4, §3b.5, §3b.8), through the store
 * with a fake bridge: a link's transcript fetched, one word picked, Clip it,
 * and the finished job collected — the asset, its clip, the run's words on
 * the clip's clock and the link's credit, all in ONE undo step.
 *
 * The caption track is built here from made-up words in the measured json3
 * shape (EFFECTS.md §40), and turned into a transcript exactly as main does
 * (`transcriptFromTracks`), so the reload case — the renderer's transcript
 * gone, the tracks read again by key — reads the same words.
 */

const URL = 'https://www.youtube.com/watch?v=MadeUpTalk1'
const LINK = parseLink(URL)!
const LINK_KEY = linkCacheKey(LINK)
const ASSET_ID = 'asset-clip'
const FPS = 30

type Seg = { utf8: string; tOffsetMs?: number; acAsrConf?: number }
type Ev = { tStartMs: number; dDurationMs?: number; segs?: Seg[]; wWinId?: number; aAppend?: number }

/** One ASR line: words at offsets from the event's start, the first without tOffsetMs, as measured. */
function line(tStartMs: number, words: [string, number][]): Ev {
  return {
    tStartMs,
    dDurationMs: 3000,
    wWinId: 1,
    segs: words.map(([w, off], k) => (k === 0 ? { utf8: w, acAsrConf: 0 } : { utf8: ` ${w}`, tOffsetMs: off, acAsrConf: 0 }))
  }
}

/**
 * Three lines. "lima" (word 3) is the one-word run; "mike" starts 350 ms after
 * it, and "november." 900 ms — both inside the second a one-word run is
 * fetched as, and neither picked.
 */
function json3(extraFirst = false): unknown {
  const first: [string, number][] = [
    ['alpha', 0],
    ['bravo', 400],
    ['charlie.', 800]
  ]
  if (extraFirst) first.unshift(['zulu', 0], ['yankee', 200])
  if (extraFirst) for (let i = 2; i < first.length; i++) first[i] = [first[i][0], 400 + (i - 2) * 400]
  return {
    wireMagic: 'pb3',
    events: [
      { tStartMs: 0, dDurationMs: 60_000, id: 1 },
      line(10_000, first),
      { tStartMs: 12_500, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      line(20_000, [
        ['lima', 0],
        ['mike', 350],
        ['november.', 900]
      ]),
      line(30_000, [
        ['oscar', 0],
        ['papa.', 400]
      ])
    ]
  }
}

/** Both keys, as YouTube writes them for a video with no uploader track: `<l>` a byte copy of `<l>-orig`. */
const KEYS = ['en', 'en-orig']

const meta: LinkMeta = {
  id: 'MadeUpTalk1',
  title: 'A made-up talk',
  duration: 60,
  language: 'en',
  chapters: [],
  heatmap: null,
  channel: 'Made-up channel',
  uploader: 'Made-up uploader',
  webpage_url: LINK.url
}

let started: { request: IngestRequest; clip: LinkClip | null }[] = []
/** Jobs main has handed back: a second collect of one answers `alreadyCollected`, as `collectDownload` does. */
let collected = new Set<string>()
let trackReads: unknown[][] = []
let reread: () => unknown = () => json3()

function asset(range: { startMs: number; endMs: number } | null): MediaAsset {
  const ms = range ? range.endMs - range.startMs : 60_000
  return {
    id: ASSET_ID,
    path: '/downloads/MadeUpTalk1.video-1080p.r20000-21000.mp4',
    name: 'A made-up talk',
    kind: 'video',
    durationFrames: Math.round((ms / 1000) * FPS),
    width: 1920,
    height: 1080,
    fps: FPS,
    hasVideo: true,
    hasAudio: true,
    size: 1
  }
}

beforeEach(() => {
  started = []
  collected = new Set()
  trackReads = []
  reread = () => json3()
  vi.stubGlobal('window', {
    forge: {
      ingestMeta: async () => meta,
      ingestCaptions: async (_url: string, language: string) => {
        const read = KEYS.map((key) => ({ key, kind: json3Kind(json3())!, json: json3() }))
        return {
          linkKey: LINK_KEY,
          keys: KEYS,
          tracks: read.map(({ key, kind }) => ({ key, kind, path: `/userData/url/${LINK_KEY}/${LINK_KEY}.captions.${key}.json3` })),
          transcript: transcriptFromTracks(read, `url:${LINK_KEY}`, language)
        }
      },
      startIngest: async (request: IngestRequest, clip?: LinkClip | null) => {
        started.push({ request, clip: clip ?? null })
        return { id: `job-${started.length}`, presetId: 'ingest', status: 'queued' }
      },
      // Main hands back what it kept beside the job: the request's range, and the clip's words and credit — once.
      collectIngest: async (jobId: string) => {
        const job = started[Number(jobId.split('-')[1]) - 1]
        if (collected.has(jobId)) return { alreadyCollected: true }
        collected.add(jobId)
        return {
          path: '/downloads/clip.mp4',
          asset: asset(job.request.range ?? null),
          cached: false,
          approximateRange: false,
          requestedRange: job.request.range ?? null,
          stems: null,
          link: job.clip
        }
      },
      ingestCaptionTrack: async (linkKey: string, key: string) => {
        trackReads.push([linkKey, key])
        const json = reread()
        return { key, kind: json3Kind(json)!, json }
      }
    }
  })
  useEditor.setState(useEditor.getInitialState())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const state = () => useEditor.getState()

/** Get transcript, pick "lima" alone, Clip it: the job's id. */
async function clipLima(): Promise<string> {
  state().setIngest({ url: URL })
  await state().getTranscript()
  expect(state().urlSource?.status).toBe('ready')
  expect(state().urlSource?.transcript?.words[3].text).toBe('lima')
  state().setUrlRun({ from: 3, to: 3 })
  await state().clipItFromLink()
  expect(started).toHaveLength(1)
  return 'job-1'
}

describe('collecting a Clip it', () => {
  it('lands the asset, its clip, the run’s words and the credit in ONE undo step — one undo takes all four', async () => {
    const job = await clipLima()
    const depth = state().past.length
    await state().collectIngest(job)

    const project = state().project
    expect(project.assets.map((a) => a.id)).toContain(ASSET_ID)
    expect(project.clips.map((c) => c.assetId)).toContain(ASSET_ID)
    expect(Object.keys(project.transcripts)).toContain(ASSET_ID)
    expect(project.assets.find((a) => a.id === ASSET_ID)?.credit).toBeTruthy()
    expect(state().past.length).toBe(depth + 1)

    state().undo()
    const undone = state().project
    expect(undone.assets.map((a) => a.id)).not.toContain(ASSET_ID)
    expect(undone.clips.map((c) => c.assetId)).not.toContain(ASSET_ID)
    expect(Object.keys(undone.transcripts)).not.toContain(ASSET_ID)
  })

  it('shifts the words onto the clip: an exact cut’s first word at 0, and the neighbour 350 ms on left out', async () => {
    const job = await clipLima()
    // Exact, and a second long: the run is one 320 ms word.
    expect(started[0].request.exact).toBe(true)
    expect(started[0].request.range).toEqual({ startMs: 20_000, endMs: 21_000 })
    await state().collectIngest(job)
    const words = state().project.transcripts[ASSET_ID].words
    expect(words.map((w) => w.text)).toEqual(['lima'])
    expect(words[0].startMs).toBe(0)
    expect(words[0].endMs).toBe(320)
    expect(state().project.transcripts[ASSET_ID].assetId).toBe(ASSET_ID)
  })

  it('credits the link: source "link", the title, the channel and webpage_url', async () => {
    const job = await clipLima()
    await state().collectIngest(job)
    const credit = state().project.assets.find((a) => a.id === ASSET_ID)?.credit
    expect(credit).toMatchObject({
      source: 'link',
      title: 'A made-up talk',
      author: 'Made-up channel',
      pageUrl: LINK.url,
      attributionRequired: false
    })
    expect(credit?.line).toBe(`A made-up talk — Made-up channel, ${LINK.url}`)
    expect(Number.isNaN(Date.parse(credit?.fetchedAt ?? ''))).toBe(false)
  })

  it('after a reload, reads the tracks again by their keys — never a path — and lands the same words', async () => {
    const job = await clipLima()
    // Cmd+R: the renderer's transcript and its record of the job are gone; main's copy is not.
    useEditor.setState({ urlSource: null, pendingIngests: {} })
    await state().collectIngest(job)
    expect(trackReads.map(([, key]) => key).sort()).toEqual([...KEYS].sort())
    for (const args of trackReads) {
      expect(args).toHaveLength(2)
      expect(args[0]).toBe(LINK_KEY)
      for (const arg of args) expect(String(arg)).not.toMatch(/[\\/]/)
    }
    expect(state().project.transcripts[ASSET_ID].words.map((w) => w.text)).toEqual(['lima'])
    expect(state().project.assets.find((a) => a.id === ASSET_ID)?.credit?.author).toBe('Made-up channel')
  })

  it('does not read the tracks again while the words are on screen', async () => {
    const job = await clipLima()
    await state().collectIngest(job)
    expect(trackReads).toEqual([])
  })

  it('keeps the range’s words, not stale indices, when a later fetch changed the transcript', async () => {
    const job = await clipLima()
    useEditor.setState({ urlSource: null, pendingIngests: {} })
    // Two words more at the top: index 3 is no longer "lima".
    reread = () => json3(true)
    await state().collectIngest(job)
    const words = state().project.transcripts[ASSET_ID].words.map((w) => w.text)
    expect(words[0]).toBe('lima')
    expect(words).not.toContain('charlie.')
    // The run found again in the new numbering: "lima" alone — not every word in the second it was fetched as.
    expect(words).not.toContain('mike')
    expect(words).toEqual(['lima'])
  })

  it('reads the tracks again when the words on screen came from other tracks, however alike they look', async () => {
    const job = await clipLima()
    // The same words, fetched from another track set since (a language chosen by hand): not the transcript the run was picked in.
    const source = state().urlSource!
    useEditor.setState({ urlSource: { ...source, tracks: [{ key: 'en-GB', kind: 'asr' }] } })
    await state().collectIngest(job)
    expect(trackReads.map(([, key]) => key).sort()).toEqual([...KEYS].sort())
    expect(state().project.transcripts[ASSET_ID].words.map((w) => w.text)).toEqual(['lima'])
  })

  it('credits an asset the pool already has — a second Clip it of the same span — in the same one undo step', async () => {
    const job = await clipLima()
    // Already in the pool, from an earlier download of the same file, with no credit.
    const earlier = { ...asset({ startMs: 20_000, endMs: 21_000 }), id: 'asset-earlier' }
    state().update((p) => ({ ...p, assets: [...p.assets, earlier] }))
    const depth = state().past.length
    await state().collectIngest(job)
    const pool = state().project.assets
    expect(pool.filter((a) => a.path === earlier.path)).toHaveLength(1)
    expect(pool.find((a) => a.id === 'asset-earlier')?.credit?.line).toBe(`A made-up talk — Made-up channel, ${LINK.url}`)
    expect(Object.keys(state().project.transcripts)).toContain('asset-earlier')
    expect(state().past.length).toBe(depth + 1)
    state().undo()
    expect(state().project.assets.find((a) => a.id === 'asset-earlier')?.credit).toBeUndefined()
    expect(Object.keys(state().project.transcripts)).not.toContain('asset-earlier')
  })

  it('says the words were lost only once the clip has landed — not for a download that lands nowhere', async () => {
    const texts = (): string[] => state().notices.map((n) => n.text)
    // The re-read fails, and the job belongs to another project: nothing lands, so nothing landed "without its words".
    const job = await clipLima()
    useEditor.setState({ urlSource: null, pendingIngests: { [job]: { ...state().pendingIngests[job], projectPath: '/elsewhere.forge' } } })
    reread = () => {
      throw new Error('gone')
    }
    await state().collectIngest(job)
    expect(state().project.assets.map((a) => a.id)).not.toContain(ASSET_ID)
    expect(texts().some((t) => t.includes('finished under a different project'))).toBe(true)
    expect(texts().some((t) => t.includes('without its words'))).toBe(false)

    // The same, landing here: it lands, and then says so. A job main has not
    // handed back — the first answer above was, and a repeat lands nothing.
    collected.delete(job)
    useEditor.setState({ notices: [] })
    const pending = state().pendingIngests
    useEditor.setState({ pendingIngests: { ...pending, [job]: { projectPath: state().projectPath } } })
    await state().collectIngest(job)
    expect(state().project.assets.map((a) => a.id)).toContain(ASSET_ID)
    expect(Object.keys(state().project.transcripts)).not.toContain(ASSET_ID)
    expect(texts().filter((t) => t.includes('without its words'))).toEqual(['That clip landed without its words: gone'])
  })

  it('keeps the credit through a save, a load and a relink', async () => {
    const job = await clipLima()
    await state().collectIngest(job)
    const credit = state().project.assets.find((a) => a.id === ASSET_ID)!.credit
    expect(credit).toBeTruthy()
    const file = JSON.parse(JSON.stringify(serializeProject(state().project, { appVersion: '0.1.0' })))
    const loaded = deserializeProject(file).project
    expect(loaded.assets.find((a) => a.id === ASSET_ID)?.credit).toEqual(credit)
    const moved = applyRelink(loaded, { [ASSET_ID]: '/moved/MadeUpTalk1.video-1080p.r20000-21000.mp4' })
    expect(moved.assets.find((a) => a.id === ASSET_ID)?.credit).toEqual(credit)
  })

  it('switches captions on over the collected words as over any transcript: the first line at the clip’s start', async () => {
    const job = await clipLima()
    await state().collectIngest(job)
    state().setCaptionsEnabled(true)
    const project = state().project
    const style = resolveStyle(project.captions.styleId, project.captions.overrides as StyleOverrides | undefined)
    const ass = buildTimelineCaptions(project, style, { width: 1920, height: 1080 })
    expect(ass).not.toBeNull()
    const starts = ass!
      .split('\n')
      .filter((l) => l.startsWith('Dialogue:'))
      .map((l) => l.split(',')[1])
    expect(starts.length).toBeGreaterThan(0)
    expect(starts).toContain(toAssTime(0))
  })
})
