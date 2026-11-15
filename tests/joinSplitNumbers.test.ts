import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { joinSplitNumbers, segmentIntoSentences, type Transcript, type Word } from '@shared/transcript'
import { baselineGraphics } from '@shared/director/baselineGraphics'
import type { GraphicsMenu } from '@shared/director/run'
import { buildAss } from '@shared/captions/ass'
import { DEFAULT_CAPTION_STYLE } from '@shared/captions/style'

/*
 * Try-out 1 (2026-11-15), piece 1: faster-whisper gives a grouped number as
 * two words and a percent sign as its own word ("$2" ",500.", "40" "%"), and
 * the counter drew "$2". Every transcript here is built in the test from
 * English lines written for it; the shapes are the ones the try-out's
 * transcript held.
 */

/** Words from [text, confidence] pairs, 400 ms apart, indexed 0..n-1. */
function words(spec: (string | [string, number | null])[]): Word[] {
  return spec.map((s, index) => {
    const [text, confidence] = typeof s === 'string' ? [s, 0.9] : s
    return { index, text, startMs: index * 400, endMs: index * 400 + 350, confidence }
  })
}

const texts = (ws: readonly Word[]): string[] => ws.map((w) => w.text)

describe('joinSplitNumbers', () => {
  it('joins each split shape the try-out showed into one word', () => {
    const cases: [string[], string][] = [
      [['cost', '$2', ',500.'], '$2,500.'],
      [['is', '$1', ',200', 'and'], '$1,200'],
      [['charge', '$10', ',000,', 'nobody'], '$10,000,'],
      [['Forty', '40', '%', 'of'], '40%'],
      [['only', '18', '%.'], '18%.'],
      [['about', '15', '%,', 'then'], '15%,']
    ]
    for (const [input, joined] of cases) {
      const out = joinSplitNumbers(words(input))
      expect(texts(out), input.join(' ')).toContain(joined)
      expect(out.length, input.join(' ')).toBe(input.length - 1)
    }
  })

  it('joins only what the number reader takes as one number', () => {
    // Indian lakh grouping is read as one number (graphics/numbers.ts groupingOf), so it joins.
    expect(texts(joinSplitNumbers(words(['₹1', ',50,000', 'only'])))).toEqual(['₹1,50,000', 'only'])
    // A run split three ways joins whole.
    expect(texts(joinSplitNumbers(words(['$1', ',000', ',000', 'a', 'day'])))).toEqual(['$1,000,000', 'a', 'day'])
    // Neither western nor Indian: left as two words.
    expect(texts(joinSplitNumbers(words(['2', ',50', 'cards'])))).toEqual(['2', ',50', 'cards'])
    expect(texts(joinSplitNumbers(words(['in', '2019', ',000', 'people'])))).toEqual(['in', '2019', ',000', 'people'])
  })

  it('keeps the first start, the last end, the lower confidence, and renumbers 0..n-1', () => {
    const input = words(['A', 'full', 'wedding', 'cost', ['$2', 0.8053], [',500.', 0.9925], 'and', ['40', 0.9435], ['%', 0.9098]])
    const out = joinSplitNumbers(input)
    expect(out.map((w) => w.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
    const money = out[4]
    expect(money).toEqual({ index: 4, text: '$2,500.', startMs: input[4].startMs, endMs: input[5].endMs, confidence: 0.8053 })
    expect(out[5]).toEqual({ ...input[6], index: 5 })
    expect(out[6]).toEqual({ index: 6, text: '40%', startMs: input[7].startMs, endMs: input[8].endMs, confidence: 0.9098 })
  })

  it('a joined word with an unknown confidence on either side is unknown', () => {
    expect(joinSplitNumbers(words([['$2', null], [',500', 0.9]]))[0].confidence).toBeNull()
    expect(joinSplitNumbers(words([['40', 0.9], ['%', null]]))[0].confidence).toBeNull()
  })

  it('leaves "$2, 500 people": the comma closes the first word', () => {
    expect(texts(joinSplitNumbers(words(['about', '$2,', '500', 'people'])))).toEqual(['about', '$2,', '500', 'people'])
    expect(texts(joinSplitNumbers(words(['about', '$2,', ',500'])))).toEqual(['about', '$2,', ',500'])
  })

  it('leaves a percent sign after a word that is not a number', () => {
    expect(texts(joinSplitNumbers(words(['forty', '%', 'of'])))).toEqual(['forty', '%', 'of'])
    expect(texts(joinSplitNumbers(words(['%', 'first'])))).toEqual(['%', 'first'])
    expect(texts(joinSplitNumbers(words(['40.', '%'])))).toEqual(['40.', '%'])
  })

  it('an empty list is an empty list', () => {
    expect(joinSplitNumbers([])).toEqual([])
  })

  it('joining twice changes nothing', () => {
    const input = words(['If', 'I', 'charge', '$10', ',000,', 'nobody', 'would', 'book.', '40', '%', '$1', ',000', ',000'])
    const once = joinSplitNumbers(input)
    expect(joinSplitNumbers(once)).toEqual(once)
  })
})

describe('joinSplitNumbers end to end', () => {
  const split = words(['A', 'full', 'wedding', 'cost', '$2', ',500.'])

  function transcriptOf(ws: Word[]): Transcript {
    return { assetId: 'talk', language: 'en', model: 'whisper-small', durationMs: 3000, words: ws, segments: segmentIntoSentences(ws) }
  }
  function menuOf(t: Transcript): GraphicsMenu {
    return {
      assetId: t.assetId,
      clipId: 'shot',
      language: t.language,
      sentences: t.segments.map((s) => ({ id: s.id, startMs: s.startMs, text: s.text, wordStart: s.wordStart, wordEnd: s.wordEnd })),
      templates: ['counter', 'bars', 'steps', 'quote', 'ring', 'keyword'],
      wordSource: 'whisper'
    }
  }

  it('the baseline counter reads $2,500, not $2', () => {
    const t = transcriptOf(joinSplitNumbers(split))
    const counters = baselineGraphics(t, menuOf(t)).filter((g) => g.data.template === 'counter')
    expect(counters).toHaveLength(1)
    expect(counters[0].data).toMatchObject({ template: 'counter', value: '$2,500' })
  })

  it('the captions draw "$2,500." with no space before the comma', () => {
    const t = transcriptOf(joinSplitNumbers(split))
    const ass = buildAss(t.segments, t.words, { width: 1080, height: 1920, style: DEFAULT_CAPTION_STYLE })
    const dialogue = ass
      .split('\n')
      .filter((l) => l.startsWith('Dialogue:'))
      .map((l) => l.replace(/\{[^}]*\}/g, ''))
      .join('\n')
    expect(dialogue).toContain('$2,500.')
    expect(dialogue).not.toMatch(/ ,500/)
  })
})

describe("the AI helper's transcript joins split numbers before it is segmented", () => {
  it("asr:transcribe joins result.words, and segments and stores the joined words", () => {
    const src = readFileSync(join(__dirname, '../src/main/ipc.ts'), 'utf8')
    const start = src.indexOf("ipcMain.handle('asr:transcribe'")
    expect(start).toBeGreaterThan(-1)
    expect(src.indexOf("ipcMain.handle('asr:transcribe'", start + 1)).toBe(-1)
    const handler = src.slice(start, src.indexOf("ipcMain.handle('asr:cancel'", start))
    expect([...handler.matchAll(/joinSplitNumbers\(result\.words\)/g)]).toHaveLength(1)
    expect([...handler.matchAll(/segmentIntoSentences\(([^)]*)\)/g)].map((m) => m[1])).toEqual(['words'])
    expect(handler).toMatch(/const words = joinSplitNumbers\(result\.words\)[\s\S]*\n\s*words,\n\s*segments: segmentIntoSentences\(words\)/)
    expect(handler).not.toMatch(/words: result\.words/)
  })
})
