import { describe, expect, it } from 'vitest'
import { checkLinkClip, languageOfKeys, linkCredit, runIn, runWords, transcriptFits, type LinkClip } from '@shared/ingest/linkClip'
import type { LinkMeta } from '@shared/ingest/args'
import type { Transcript } from '@shared/transcript'

/*
 * What a Clip it job carries to main and back (docs/CLIPS.md §3b.4): checked
 * field by field in main before it is kept beside the job, the link's credit
 * line, and the check that a transcript read again is the one the run was
 * picked in.
 */

const good = (): LinkClip => ({
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
    pageUrl: 'https://www.youtube.com/watch?v=MadeUpTalk1',
    line: 'A made-up talk — Made-up channel, https://www.youtube.com/watch?v=MadeUpTalk1',
    attributionRequired: false,
    fetchedAt: '2026-10-06T00:00:00.000Z'
  }
})

describe('the clip a job carries, checked in main', () => {
  it('keeps a well-formed one, field for field, and nothing else', () => {
    const raw = { ...good(), extra: 'ignored', transcriptFrom: { ...good().transcriptFrom, path: '/etc/passwd' } }
    expect(checkLinkClip(raw)).toEqual(good())
    expect(checkLinkClip(undefined)).toBeNull()
    expect(checkLinkClip(null)).toBeNull()
    expect(checkLinkClip({ ...good(), credit: null })?.credit).toBeNull()
  })

  it('refuses a link key or a track key that could reach outside the link’s folder, and any malformed field', () => {
    const bad = (patch: Record<string, unknown>, credit?: Record<string, unknown>): unknown => ({
      transcriptFrom: { ...good().transcriptFrom, ...patch },
      credit: credit ? { ...good().credit, ...credit } : good().credit
    })
    const refused = [
      'nothing',
      {},
      bad({ linkKey: '../url' }),
      bad({ linkKey: 'C:' }),
      bad({ linkKey: 'key.captions' }),
      bad({ keys: [] }),
      bad({ keys: ['en/../x'] }),
      bad({ keys: ['all'] }),
      bad({ keys: ['en', 'en', 'en', 'en', 'en'] }),
      bad({ range: { startMs: 5, endMs: 5 } }),
      bad({ range: { startMs: -1, endMs: 5 } }),
      bad({ range: { startMs: 0, endMs: Number.NaN } }),
      bad({ run: { from: 4, to: 3 } }),
      bad({ run: { from: 1.5, to: 3 } }),
      bad({ headOffsetMs: -1 }),
      bad({ words: { count: 8, first: 1, last: 'x' } }),
      bad({}, { source: 'pexels' }),
      bad({}, { title: 7 }),
      bad({}, { attributionRequired: 'no' })
    ]
    for (const raw of refused) expect(() => checkLinkClip(raw), JSON.stringify(raw)).toThrow(/could not be read/)
  })
})

describe('the link’s credit', () => {
  const meta = (patch: Partial<LinkMeta>): LinkMeta => ({
    id: 'x',
    title: 'A made-up talk',
    duration: 60,
    language: 'en',
    chapters: [],
    heatmap: null,
    channel: 'Made-up channel',
    uploader: 'Made-up uploader',
    webpage_url: 'https://www.youtube.com/watch?v=MadeUpTalk1',
    ...patch
  })

  it('reads "<title> — <channel>, <url>", source link, attribution by courtesy', () => {
    expect(linkCredit(meta({}), 'https://fallback.example/v', 'T')).toEqual({
      source: 'link',
      title: 'A made-up talk',
      author: 'Made-up channel',
      pageUrl: 'https://www.youtube.com/watch?v=MadeUpTalk1',
      line: 'A made-up talk — Made-up channel, https://www.youtube.com/watch?v=MadeUpTalk1',
      attributionRequired: false,
      fetchedAt: 'T'
    })
  })

  it('falls back to the uploader, then to no author; to the link for a missing page or title', () => {
    expect(linkCredit(meta({ channel: null }), 'u', 'T').author).toBe('Made-up uploader')
    const page = 'https://fallback.example/v'
    const bare = linkCredit(meta({ channel: null, uploader: null, webpage_url: null, title: null }), page, 'T')
    expect(bare.author).toBeNull()
    expect(bare.pageUrl).toBe(page)
    // The link once — not standing in for the title as well.
    expect(bare.line.split(page)).toHaveLength(2)
    expect(bare.line).toContain(page)
    const untitled = linkCredit(meta({ title: null, webpage_url: null }), page, 'T')
    expect(untitled.line.split(page)).toHaveLength(2)
    expect(untitled.line).toContain('Made-up channel')
  })
})

describe('the transcript a run was picked in', () => {
  const words = (texts: string[]): Transcript => ({
    assetId: 'url:x',
    language: 'en',
    model: 'youtube-asr',
    durationMs: texts.length * 400,
    words: texts.map((text, i) => ({ index: i, text, startMs: i * 400, endMs: i * 400 + 300, confidence: null })),
    segments: []
  })

  it('is told apart from a later fetch by its word count and the run’s first and last words', () => {
    const t = words(['kilo', 'lima', 'mike', 'november'])
    const from = { ...good().transcriptFrom, run: { from: 1, to: 2 }, words: runWords(t, { from: 1, to: 2 }) }
    expect(transcriptFits(t, from)).toBe(true)
    expect(transcriptFits(words(['zulu', 'kilo', 'lima', 'mike', 'november']), from)).toBe(false)
    expect(transcriptFits(words(['kilo', 'lima', 'mike']), from)).toBe(false)
    expect(transcriptFits(words(['kilo', 'oscar', 'mike', 'november']), from)).toBe(false)
  })

  it('finds the run again in a later fetch: the same words, starting inside the range — and nothing when they are not there', () => {
    // Picked: "lima" alone, at 20 s, fetched as the second 20–21 s.
    const at = (texts: [string, number][]): Transcript => ({
      ...words(texts.map(([text]) => text)),
      words: texts.map(([text, ms], i) => ({ index: i, text, startMs: ms, endMs: ms + 300, confidence: null }))
    })
    const picked = at([['kilo', 18_000], ['lima', 20_000], ['mike', 20_350], ['november.', 20_900]])
    const from = { ...good().transcriptFrom, run: { from: 1, to: 1 }, range: { startMs: 20_000, endMs: 21_000 }, words: runWords(picked, { from: 1, to: 1 }) }
    expect(runIn(picked, from)).toEqual({ from: 1, to: 1 })
    // Two words more at the top: index 1 is "zulu" now, and "lima" is index 3.
    const later = at([['zulu', 1_000], ['yankee', 1_200], ['kilo', 18_000], ['lima', 20_000], ['mike', 20_350], ['november.', 20_900]])
    expect(transcriptFits(later, from)).toBe(false)
    expect(runIn(later, from)).toEqual({ from: 3, to: 3 })
    // A "lima" outside the range is not the one picked.
    expect(runIn(at([['lima', 5_000], ['kilo', 18_000], ['oscar', 20_000]]), from)).toBeNull()
    // A longer run keeps its length: first and last both have to match.
    const two = { ...from, run: { from: 1, to: 2 }, words: runWords(picked, { from: 1, to: 2 }) }
    expect(runIn(later, two)).toEqual({ from: 3, to: 4 })
    expect(runIn(at([['zulu', 1_000], ['lima', 20_000], ['papa', 20_350]]), two)).toBeNull()
  })

  it('names the language its tracks were fetched in as main does', () => {
    expect(languageOfKeys(['en', 'en-orig'])).toBe('en')
    expect(languageOfKeys(['pt-BR'])).toBe('pt')
  })
})
