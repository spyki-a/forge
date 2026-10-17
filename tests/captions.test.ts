import { describe, it, expect } from 'vitest'
import { buildAss, toAssColor, toAssTime, groupWords, REFERENCE_HEIGHT } from '@shared/captions/ass'
import { CAPTION_STYLES, styleById, resolveStyle, DEFAULT_CAPTION_STYLE, type CaptionStyle } from '@shared/captions/style'
import type { Third } from '@shared/captions/placement'
import { segmentIntoSentences, type Word } from '@shared/transcript'

function words(spec: [string, number, number][]): Word[] {
  return spec.map(([text, startMs, endMs], index) => ({ index, text, startMs, endMs, confidence: 0.9 }))
}

const SAMPLE = words([
  ['And', 0, 400], ['so', 400, 800], ['my', 800, 1200], ['fellow', 1200, 1600],
  ['Americans.', 1600, 2000], ['Ask', 2800, 3200], ['not.', 3200, 3600]
])
const SEGMENTS = segmentIntoSentences(SAMPLE)

const opts = { width: 1080, height: 1920, style: DEFAULT_CAPTION_STYLE }

describe('toAssColor', () => {
  it('byte-reverses hex into ASS BGR order', () => {
    // #FFD400 -> BB=00 GG=D4 RR=FF
    expect(toAssColor('#FFD400')).toBe('&H0000D4FF')
    expect(toAssColor('#FFFFFF')).toBe('&H00FFFFFF')
    expect(toAssColor('#000000')).toBe('&H00000000')
  })

  it('treats alpha as inverted, 00 being opaque', () => {
    expect(toAssColor('#000000', 0x80)).toBe('&H80000000')
  })

  it('tolerates a missing hash', () => {
    expect(toAssColor('FF0000')).toBe('&H000000FF')
  })
})

describe('toAssTime', () => {
  it('formats H:MM:SS.cc with centiseconds', () => {
    expect(toAssTime(0)).toBe('0:00:00.00')
    expect(toAssTime(1500)).toBe('0:00:01.50')
    expect(toAssTime(61_230)).toBe('0:01:01.23')
    expect(toAssTime(3_661_000)).toBe('1:01:01.00')
  })

  it('clamps negatives rather than emitting an invalid timestamp', () => {
    expect(toAssTime(-500)).toBe('0:00:00.00')
  })
})

describe('groupWords', () => {
  it('chunks by words-per-line', () => {
    const groups = groupWords(SEGMENTS, SAMPLE, 2)
    expect(groups[0].map((w) => w.text)).toEqual(['And', 'so'])
    expect(groups[1].map((w) => w.text)).toEqual(['my', 'fellow'])
  })

  it('never lets a group straddle a segment boundary', () => {
    const groups = groupWords(SEGMENTS, SAMPLE, 4)
    for (const group of groups) {
      const owning = SEGMENTS.filter(
        (s) => group[0].index >= s.wordStart && group[0].index <= s.wordEnd
      )
      expect(owning).toHaveLength(1)
      for (const word of group) {
        expect(word.index).toBeGreaterThanOrEqual(owning[0].wordStart)
        expect(word.index).toBeLessThanOrEqual(owning[0].wordEnd)
      }
    }
  })
})

describe('buildAss', () => {
  it('emits a valid script header with the real canvas size', () => {
    const ass = buildAss(SEGMENTS, SAMPLE, opts)
    expect(ass).toContain('[Script Info]')
    expect(ass).toContain('ScriptType: v4.00+')
    expect(ass).toContain('PlayResX: 1080')
    expect(ass).toContain('PlayResY: 1920')
    expect(ass).toContain('[V4+ Styles]')
    expect(ass).toContain('[Events]')
  })

  it('scales type against the 1080p reference so styles hold across aspects', () => {
    const tall = buildAss(SEGMENTS, SAMPLE, { ...opts, width: 1080, height: 1920 })
    const wide = buildAss(SEGMENTS, SAMPLE, { ...opts, width: 1920, height: 1080 })

    const sizeOf = (ass: string): number =>
      Number(ass.split('\n').find((l) => l.startsWith('Style: Default'))!.split(',')[2])

    expect(sizeOf(wide)).toBe(DEFAULT_CAPTION_STYLE.fontSize)
    // 1920 tall is 1.777x the reference, so type scales with it.
    expect(sizeOf(tall)).toBe(Math.round(DEFAULT_CAPTION_STYLE.fontSize * (1920 / REFERENCE_HEIGHT)))
  })

  it('emits one event per word so the active word can be recoloured and scaled', () => {
    const ass = buildAss(SEGMENTS, SAMPLE, opts)
    const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'))
    expect(events).toHaveLength(SAMPLE.length)
  })

  it('highlights exactly one word per event', () => {
    const ass = buildAss(SEGMENTS, SAMPLE, opts)
    const highlight = toAssColor(DEFAULT_CAPTION_STYLE.highlightColor)
    for (const line of ass.split('\n').filter((l) => l.startsWith('Dialogue:'))) {
      expect(line.split(highlight).length - 1).toBe(1)
    }
  })

  it('holds a word until the next begins, so the line does not flicker', () => {
    const ass = buildAss(SEGMENTS, SAMPLE, opts)
    const first = ass.split('\n').find((l) => l.startsWith('Dialogue:'))!
    // "And" ends at 400 but "so" starts at 400, so the cue runs to 0:00:00.40.
    expect(first).toContain('0:00:00.00,0:00:00.40')
  })

  it('uppercases when the style asks for it', () => {
    const ass = buildAss(SEGMENTS, SAMPLE, opts)
    expect(ass).toContain('FELLOW')
    expect(ass).not.toMatch(/}fellow /)
  })

  it('shifts cues by the offset for a trimmed clip', () => {
    const ass = buildAss(SEGMENTS, SAMPLE, { ...opts, offsetMs: 800 })
    // "my" starts at 800ms of source, which is 0 once the clip starts there.
    expect(ass).toContain('0:00:00.00')
    // Words fully before the offset must not produce negative-time cues.
    for (const line of ass.split('\n').filter((l) => l.startsWith('Dialogue:'))) {
      expect(line).not.toContain('-')
    }
  })

  it('drops cues outside the clip range', () => {
    const ass = buildAss(SEGMENTS, SAMPLE, { ...opts, rangeMs: { startMs: 0, endMs: 1200 } })
    const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'))
    expect(events.length).toBeLessThan(SAMPLE.length)
    expect(ass).not.toContain('AMERICANS')
  })

  it('escapes braces so literal text cannot inject override tags', () => {
    const tricky = words([['{\\an8}hack', 0, 500]])
    const ass = buildAss(segmentIntoSentences(tricky), tricky, opts)
    const event = ass.split('\n').find((l) => l.startsWith('Dialogue:'))!
    expect(event).toContain('\\{')
    expect(event).not.toMatch(/\{\\an8\}/)
  })

  it('produces no events for an empty transcript', () => {
    const ass = buildAss([], [], opts)
    expect(ass.split('\n').filter((l) => l.startsWith('Dialogue:'))).toHaveLength(0)
  })
})

/*
 * Smart placement on the libass route (docs/CLIPS.md §5.4). A line in another
 * third than the style's gets that third's alignment as an override at the
 * head of its text, and the MarginV libass reads for that alignment in its
 * own field; measured on the bundled libass (640×360, Pop at MarginV 73):
 * bottom rows 264–280, {\an8} 83–99, {\an5} 174–189.
 */
describe('buildAss with a third per line', () => {
  const events = (ass: string): string[] => ass.split('\n').filter((l) => l.startsWith('Dialogue:'))
  /** Each event's MarginV field and the head of its text: `Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text`. */
  const heads = (ass: string): { marginV: string; text: string }[] =>
    events(ass).map((line) => {
      const fields = line.slice('Dialogue: '.length).split(',')
      return { marginV: fields[7], text: fields.slice(9).join(',') }
    })
  const always = (third: Third | null) => () => third
  const POP_TOP = resolveStyle('pop', { position: 'top' })
  const CENTRE = styleById('bold-center')
  // 220 reference px on a 1920-tall frame.
  const EDGE = String(Math.round((220 * 1920) / REFERENCE_HEIGHT))

  it('is today\'s file with no lookup, or one that answers null or the style\'s own third', () => {
    const today = buildAss(SEGMENTS, SAMPLE, opts)
    expect(buildAss(SEGMENTS, SAMPLE, { ...opts, thirdAt: always(null) })).toBe(today)
    expect(buildAss(SEGMENTS, SAMPLE, { ...opts, thirdAt: always('bottom') })).toBe(today)
    const top = buildAss(SEGMENTS, SAMPLE, { ...opts, style: POP_TOP })
    expect(buildAss(SEGMENTS, SAMPLE, { ...opts, style: POP_TOP, thirdAt: always('top') })).toBe(top)
    // Today's events: no alignment tag, MarginV 0 (the style's).
    for (const head of heads(today)) {
      expect(head.marginV).toBe('0')
      expect(head.text).toMatch(/^\{\\c&H/)
    }
  })

  it('tags a moved line with its third\'s alignment and writes the MarginV libass reads for it', () => {
    expect(EDGE).toBe('391')
    const cases: [CaptionStyle, Third, string, string][] = [
      // style, third, MarginV, tag
      [DEFAULT_CAPTION_STYLE, 'top', EDGE, '{\\an8}'],
      [DEFAULT_CAPTION_STYLE, 'middle', '0', '{\\an5}'],
      [POP_TOP, 'bottom', EDGE, '{\\an2}'],
      [POP_TOP, 'middle', '0', '{\\an5}'],
      // A centred style has no edge distance; moved, it takes the default style's 220.
      [CENTRE, 'top', EDGE, '{\\an8}'],
      [CENTRE, 'bottom', EDGE, '{\\an2}']
    ]
    for (const [style, third, marginV, tag] of cases) {
      const ass = buildAss(SEGMENTS, SAMPLE, { ...opts, style, thirdAt: always(third) })
      const all = heads(ass)
      expect(all.length, `${style.id} → ${third}`).toBe(SAMPLE.length)
      for (const head of all) {
        expect(head.marginV, `${style.id} → ${third}`).toBe(marginV)
        expect(head.text.startsWith(`${tag}{\\c&H`), `${style.id} → ${third}: ${head.text}`).toBe(true)
      }
      // The style line is the style's own: only the events move.
      expect(ass.split('\n').find((l) => l.startsWith('Style: Default'))).toBe(
        buildAss(SEGMENTS, SAMPLE, { ...opts, style }).split('\n').find((l) => l.startsWith('Style: Default'))
      )
    }
    // Scaled to PlayResY: on a 1080-tall frame the edge is 220.
    const wide = heads(buildAss(SEGMENTS, SAMPLE, { width: 1920, height: 1080, style: DEFAULT_CAPTION_STYLE, thirdAt: always('top') }))
    expect(wide.every((h) => h.marginV === '220')).toBe(true)
  })

  it('asks once per line, with the source ms of its first word the range shows', () => {
    const asked: number[] = []
    buildAss(SEGMENTS, SAMPLE, { ...opts, thirdAt: (ms) => (asked.push(ms), null) })
    // [And so my] [fellow Americans.] [Ask not.]
    expect(asked).toEqual([0, 1200, 2800])
    asked.length = 0
    // "And" (0–400) is before the range; "so" (400–800) is the first word it shows.
    buildAss(SEGMENTS, SAMPLE, { ...opts, rangeMs: { startMs: 500, endMs: 4000 }, thirdAt: (ms) => (asked.push(ms), null) })
    expect(asked).toEqual([400, 1200, 2800])
  })

  it('keeps every event of a line where the line starts, though later words are past a change', () => {
    // A cut at 400 ms: "so" and "my" are after it, but their line starts at 0.
    const ass = buildAss(SEGMENTS, SAMPLE, { ...opts, thirdAt: (ms) => (ms >= 400 ? 'top' : null) })
    const tagged = heads(ass).map((h) => h.text.startsWith('{\\an8}'))
    expect(tagged).toEqual([false, false, false, true, true, true, true])
  })
})

describe('caption styles', () => {
  it('resolves by id and falls back to the default', () => {
    expect(styleById('clean').id).toBe('clean')
    expect(styleById('nope').id).toBe(DEFAULT_CAPTION_STYLE.id)
  })

  it('every style names a font the asset catalog can supply', () => {
    for (const style of CAPTION_STYLES) {
      expect(style.fontFamily.length).toBeGreaterThan(0)
      expect(style.wordsPerLine).toBeGreaterThan(0)
    }
  })
})

describe('style overrides', () => {
  it('layers overrides onto the preset', () => {
    const style = resolveStyle('pop', { fontFamily: 'Bangers', fontSize: 120 })
    expect(style.fontFamily).toBe('Bangers')
    expect(style.fontSize).toBe(120)
    // Untouched fields keep the preset's values, so improving a preset still
    // reaches projects that only changed the font.
    expect(style.highlightColor).toBe(DEFAULT_CAPTION_STYLE.highlightColor)
  })

  it('returns the preset unchanged when there are no overrides', () => {
    expect(resolveStyle('clean')).toEqual(styleById('clean'))
    expect(resolveStyle('clean', {})).toEqual(styleById('clean'))
  })

  it('guards values the renderer divides or scales by', () => {
    const style = resolveStyle('pop', {
      fontSize: -10,
      wordsPerLine: 0,
      highlightScale: 0,
      outlineWidth: -5
    })
    expect(style.fontSize).toBeGreaterThan(0)
    expect(style.wordsPerLine).toBeGreaterThanOrEqual(1)
    expect(style.highlightScale).toBeGreaterThan(0)
    expect(style.outlineWidth).toBeGreaterThanOrEqual(0)
  })

  it('produces a usable ASS file from an overridden style', () => {
    const style = resolveStyle('pop', { fontFamily: 'Bangers', uppercase: false })
    const ass = buildAss(SEGMENTS, SAMPLE, { width: 1080, height: 1920, style })
    expect(ass).toContain('Style: Default,Bangers,')
    expect(ass).toContain('fellow')
  })
})
