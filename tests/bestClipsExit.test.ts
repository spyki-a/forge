import { describe, expect, it } from 'vitest'
import { basename } from 'node:path'
import { escapeHtml, exitFileName, exitPage, parseExitLinks, sideOf, timeLink, type ExitRecord } from './fixtures/bestClipsExit'
import { linkCacheKey, parseLink } from '@shared/ingest/url'
import type { BestClipCard } from '@shared/bestclips/run'
import { SCORED_BY_LABEL } from '@shared/bestclips/session'

/*
 * The ten-links recorder's pure parts (docs/CLIPS.md §7.8;
 * tests/integration/bestClipsExit.int.test.ts runs them on the owner's
 * machine). Every name here is made up; no title is anyone's.
 */

const A = 'https://www.youtube.com/watch?v=AAAAAAAAAAA'
const B = 'https://youtu.be/BBBBBBBBBBB'

describe('the owner’s links file', () => {
  it('reads one link a line with its length, and a language when given', () => {
    const { links, problems } = parseExitLinks(
      ['\uFEFF# ten links', '', `${A} 2`, `  ${B}   1 min   hi  `, `${A} 4min`, `https://www.youtube.com/shorts/CCCCCCCCCCC 3 te`].join('\r\n')
    )
    expect(problems).toEqual([])
    expect(links.map((l) => [l.line, l.targetMs, l.language])).toEqual([
      [3, 120_000, null],
      [4, 60_000, 'hi'],
      [5, 240_000, null],
      [6, 180_000, 'te']
    ])
    // The canonical URL and the app's own key, so the recorder's caches are the app's.
    expect(links[1].url).toBe(parseLink(B)!.url)
    expect(links[1].key).toBe(linkCacheKey(parseLink(B)!))
  })

  it('names every problem with its line, so nothing is fetched until the file is right', () => {
    const { links, problems } = parseExitLinks(
      [`not-a-link 2`, `${A}`, `${A} 5`, `${A} 0`, `${A} 2 Hindi!`, `${A} 2 hi extra`, `${B} 1`, `${B} 1`, `${B} 2`].join('\n')
    )
    expect(problems).toContain('line 1: "not-a-link" is not a link yt-dlp can read')
    expect(problems).toContain('line 2: no length after the link (1, 2, 3 or 4, in minutes)')
    expect(problems).toContain('line 3: 5 min is not a length Best clips offers (1, 2, 3 or 4)')
    expect(problems).toContain('line 4: 0 min is not a length Best clips offers (1, 2, 3 or 4)')
    expect(problems).toContain('line 5: "Hindi!" is not a language code (like en, hi, te)')
    expect(problems).toContain('line 6: more than a link, a length and a language')
    // The same link at the same length twice would count twice towards "7 of 10"; at another length it is another question.
    expect(problems).toContain('line 8: the same link at the same length as line 7')
    expect(links.map((l) => l.line)).toEqual([7, 9])
    expect(problems).toHaveLength(7)
  })

  it('an empty file is a problem, not ten links that pass', () => {
    expect(parseExitLinks('# nothing yet\n\n').problems).toEqual(['the file names no link'])
  })
})

describe('a Windows-safe file name from a title', () => {
  it('every character Windows refuses becomes a dash; the drive-letter rule does not apply to a name', () => {
    expect(exitFileName('Bride 5:30pm.jpg', 'x')).toBe('Bride 5-30pm.jpg')
    for (const c of ['<', '>', ':', '"', '/', '\\', '|', '?', '*', '\u0001', '\u001f']) {
      const name = exitFileName(`a${c}b`, 'x')
      expect(name, JSON.stringify(c)).toBe('a-b')
    }
    // A name, so asserted as one (basename, CLAUDE.md): nothing Windows refuses is left in it.
    const name = exitFileName('Q&A: "why?" <live> | part 1/2 *new*', 'x')
    expect(basename(name)).toBe(name)
    expect(name).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/u)
  })

  it('no trailing dot or space, no leading dot; space runs become one', () => {
    expect(exitFileName('  the end...  ', 'x')).toBe('the end')
    expect(exitFileName('.hidden talk', 'x')).toBe('hidden talk')
    expect(exitFileName('two\t\tspaces\nhere', 'x')).toBe('two spaces here')
    // Cut first, then trimmed again: a cut that ends on a space or a dot does not keep it.
    expect(exitFileName('abcd. efgh', 'x', 5)).toBe('abcd')
  })

  it('a reserved device name gets an underscore, with an extension or without; a longer word does not', () => {
    for (const reserved of ['CON', 'con', 'NUL', 'Aux', 'PRN', 'COM1', 'lpt9', 'con.txt', 'NUL.tar.gz']) {
      expect(exitFileName(reserved, 'x'), reserved).toBe(`_${reserved}`)
    }
    for (const fine of ['Console', 'COM10', 'nullable', 'auxiliary']) expect(exitFileName(fine, 'x'), fine).toBe(fine)
  })

  it('nothing left is the fallback', () => {
    expect(exitFileName('', 'link-03')).toBe('link-03')
    expect(exitFileName(' ... ', 'link-03')).toBe('link-03')
  })

  it('cut between graphemes, never inside one: combining marks, an emoji family and a caseless script stay whole', () => {
    // A Latin letter with a combining acute that has no precomposed form (two code points after NFC, one grapheme).
    const accented = 'x\u0301'.repeat(10)
    expect(exitFileName(accented, 'x', 4)).toBe('x\u0301'.repeat(4))
    // A family emoji: five code points joined by U+200D, one grapheme.
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'
    expect(exitFileName(`${family}${family}${family}`, 'x', 2)).toBe(`${family}${family}`)
    // Made-up Mkhedruli runs (code points, not anyone's words).
    const caseless = String.fromCharCode(0x10d0, 0x10d1, 0x10d2, 0x10d3, 0x10d4)
    expect(exitFileName(caseless, 'x', 3)).toBe(caseless.slice(0, 3))
  })
})

describe('a link to a moment of the video', () => {
  it('YouTube: the watch URL with &t= in whole seconds, floored', () => {
    expect(timeLink(A, 83_999)).toBe('https://www.youtube.com/watch?v=AAAAAAAAAAA&t=83s')
    expect(timeLink(B, 0)).toBe('https://www.youtube.com/watch?v=BBBBBBBBBBB&t=0s')
    expect(timeLink(B, -5)).toBe('https://www.youtube.com/watch?v=BBBBBBBBBBB&t=0s')
  })

  it('any other link: a #t= fragment, replacing one it had', () => {
    const other = 'https://vimeo.com/123456789'
    expect(timeLink(other, 61_500)).toBe(`${parseLink(other)!.url}#t=61`)
  })
})

describe('the page the owner rates', () => {
  const card = (over: Partial<BestClipCard>): BestClipCard => ({
    windowId: 'w3',
    startMs: 61_000,
    endMs: 121_000,
    words: 150,
    title: 'plim tavek mubo',
    why: 'the most replayed part',
    scoredBy: 'signals',
    ...over
  })
  const record = (over: Partial<ExitRecord>): ExitRecord => ({
    n: 1,
    url: parseLink(A)!.url,
    key: linkCacheKey(parseLink(A)!),
    targetMs: 60_000,
    title: 'A made-up talk',
    language: null,
    status: 'cards',
    problem: null,
    signals: sideOf({ cards: [card({})], note: null, modelNote: 'Picked without a model, from the talk’s own signals.' }),
    model: null,
    ...over
  })

  it('escapes everything fetched: a title or a why can never become markup', () => {
    const hostile = '<script>alert(1)</script> "quoted" & \'single\''
    const html = exitPage([record({ title: hostile, signals: sideOf({ cards: [card({ title: hostile, why: hostile })], note: null, modelNote: null }) })], {
      ranAt: '2026-11-25T00:00:00.000Z',
      ytdlp: '2026.08.19',
      model: null
    })
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain(escapeHtml(hostile))
    expect(escapeHtml(hostile)).toBe('&lt;script&gt;alert(1)&lt;/script&gt; &quot;quoted&quot; &amp; &#39;single&#39;')
    // The page's own script is the only one.
    expect(html.match(/<script>/gu)).toHaveLength(1)
  })

  it('each card: title, why, its range as a link to that moment, its word count, who picked it, and yes / no', () => {
    const html = exitPage([record({})], { ranAt: 'now', ytdlp: 'v', model: null })
    expect(html).toContain('<p class="title">plim tavek mubo</p>')
    expect(html).toContain('<p class="why">the most replayed part</p>')
    expect(html).toContain('href="https://www.youtube.com/watch?v=AAAAAAAAAAA&amp;t=61s"')
    expect(html).toContain('150 words')
    expect(html).toContain(escapeHtml(SCORED_BY_LABEL.signals))
    expect(html).toContain('<input type="radio" name="signals-1-1" value="yes">')
    expect(html).toContain('<input type="radio" name="signals-1-1" value="no">')
    // Before the second pass there is no model side at all.
    expect(html).not.toContain('data-side="model"')
    expect(html).toContain('The model’s cards are not here yet')
  })

  it('after the second pass the model’s cards sit beside the signals’, rated under their own names', () => {
    const html = exitPage([record({ model: sideOf({ cards: [card({ scoredBy: 'model', title: 'tavek mubo' })], note: null, modelNote: null }) })], {
      ranAt: 'now',
      ytdlp: 'v',
      model: 'gemma'
    })
    expect(html).toContain('<input type="radio" name="model-1-1" value="yes">')
    expect(html).toContain('<input type="radio" name="signals-1-1" value="yes">')
    expect(html).toContain('With the model (gemma)')
    expect(html).toContain(escapeHtml(SCORED_BY_LABEL.model))
  })

  it('a link with no captions says so and offers nothing to rate; a link that is not http gets no href', () => {
    const html = exitPage([record({ status: 'no-captions', signals: null, url: 'javascript:alert(1)' })], { ranAt: 'now', ytdlp: 'v', model: null })
    expect(html).toContain('data-status="no-captions"')
    expect(html).toContain('This video has no captions in that language.')
    expect(html).not.toContain('type="radio"')
    expect(html).not.toContain('href="javascript')
  })
})
