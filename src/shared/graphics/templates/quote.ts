/**
 * `quote` (docs/CLIPS.md §6.2): the said line in quotation marks, each word
 * lit as it is spoken, the speaker beneath.
 *
 * Items, in order: the dim when the style dims; `open`, the opening mark (a
 * fixed glyph); one `word-i` text item per word (`textItems` at unit `word`,
 * `source: { path: 'data.text', piece: i }`), laid out in lines by
 * `measure`; `close`, the closing mark; `dash`, the "— " glyph, and
 * `speaker` (further lines `speaker-1` …), right-aligned beneath, both absent
 * when `speaker` is ''.
 *
 * Motion: everything enters together with `style.motion.entrance` over
 * `DURATIONS.entrance`, ending on the first beat. The lit word is the one
 * whose beat is the latest at or before t, held until the next: the
 * captions' own rule, `activeWordAt` (`captions/line.ts`), imported, not
 * copied, over one word per beat (`startMs` its beat, `endMs` the next beat,
 * the last held to the clip's end). It draws in `palette.accent` through its
 * `look.accent`; every other word in the text style's own fill. No word is
 * lit before the first beat. Read at t + 1e-6 s, `progress`'s own allowance
 * (motion.ts), so a word lights on its beat's frame.
 *
 * The `social` kind (step 5, §8.4): every field the user's, drawn verbatim,
 * never fetched and not shaped as a post: `text` word by word as the said
 * kind's, the marks, then `name` after the "— " glyph where the said kind
 * draws `speaker`, and `handle` and `date` each a line beneath it,
 * right-aligned, in the speaker's size; any of the three absent when ''.
 * `link` is stored and not drawn. That much is beyond §6.2's words.
 *
 * Layout (§6.2's table): words 0.055, marks 0.09, speaker 0.035 of `s`; the
 * words wrapped at the content rect's wrap width less the two marks; the
 * speaker right-aligned beneath, 0.5 × its px below. Beyond its words: the
 * words are centred; the opening mark hangs left of the first line's first
 * word and the closing mark follows the last word, each 0.1 × the words' px
 * away and top-aligned with its line; the speaker's right edge is the words'
 * right edge; the whole block is centred in the content rect. The marks are
 * “ and ” in every language (the style has no marks of its own yet).
 */

import { activeWordAt } from '../../captions/line'
import type { Word } from '../../transcript'
import type { DrawItem, DrawOut, Drawer, Rect, TextItem, TextLook, TextMeasure } from '../items'
import { textItems } from '../items'
import { DURATIONS, progress } from '../motion'
import {
  LAYOUT_SIZES,
  beatOf,
  boxOf,
  centreOf,
  contentRect,
  dimFor,
  enterMove,
  fitScale,
  fitsIn,
  lineHeightOf,
  lineItems,
  lookOf,
  moved,
  shortSide,
  withDim,
  wrapWidth
} from './layout'

/** The style's opening and closing marks and the dash before the speaker: §6.2's fixed glyphs for `quote`. */
export const QUOTE_OPEN = '“'
export const QUOTE_CLOSE = '”'
export const QUOTE_DASH = '— '

/** A mark's gap from its word, × the words' px (beyond §6.2's words). */
const MARK_GAP = 0.1

/** `progress`'s own allowance, seconds (motion.ts), so a word lights on its beat's frame. */
const LIT_ALLOWANCE_S = 1e-6

/** The lit word at `t`: `activeWordAt` over one word per beat, the last held on; -1 before the first beat. */
export function litWordAt(beats: readonly number[], words: number, t: number): number {
  const n = Math.min(words, beats.length)
  if (n === 0) return -1
  const group: Word[] = []
  for (let i = 0; i < n; i++) {
    const next = i + 1 < n ? beats[i + 1] * 1000 : Infinity
    group.push({ index: i, text: '', startMs: beats[i] * 1000, endMs: next, confidence: null })
  }
  return activeWordAt(group, (t + LIT_ALLOWANCE_S) * 1000)
}

/** A one-line fixed glyph at `x, y`. */
function glyph(id: string, text: string, look: TextLook, x: number, y: number, measure: TextMeasure): TextItem {
  return { kind: 'text', id, opacity: 1, text, look, box: { x, y, width: measure(text, look).width, height: lineHeightOf(look) } }
}

const shift = <T extends { box: Rect }>(item: T, dx: number, dy: number): T => ({ ...item, box: { ...item.box, x: item.box.x + dx, y: item.box.y + dy } })

export const drawQuote: Drawer = (spec, style, clock, size, measure, targets): DrawOut => {
  const data = spec.data
  if (data.template !== 'quote') return { items: [] }
  const sizes = LAYOUT_SIZES.quote
  const s = shortSide(size)
  const rect = contentRect(spec.place, size)
  const wrap = wrapWidth(rect, size)
  const social = data.kind === 'social'
  // The attribution's lines: the speaker, or the social kind's name, handle and date.
  const by: { id: string; text: string; path: string }[] = social
    ? [
        { id: 'name', text: data.name, path: 'data.name' },
        { id: 'handle', text: data.handle, path: 'data.handle' },
        { id: 'date', text: data.date, path: 'data.date' }
      ]
    : [{ id: 'speaker', text: data.speaker, path: 'data.speaker' }]

  const layout = (k: number) => {
    const wordLook = lookOf(style, sizes.words * s * k, 'center')
    const markLook = lookOf(style, sizes.marks * s * k, 'left')
    const byLook = lookOf(style, sizes.speaker * s * k, 'right')
    const gap = MARK_GAP * wordLook.px
    const markWidth = Math.max(measure(QUOTE_OPEN, markLook).width, measure(QUOTE_CLOSE, markLook).width)
    const inner = wrap - 2 * (markWidth + gap)
    const words = inner > 0 ? textItems({ id: 'word', text: data.text, look: wordLook, at: { x: markWidth + gap, y: 0, width: inner }, unit: 'word', source: 'data.text' }, measure) : []
    const wordsBox = boxOf(words) ?? { x: markWidth + gap + inner / 2, y: 0, width: 0, height: 0 }
    const first = words[0]
    const last = words[words.length - 1]
    const open = glyph('open', QUOTE_OPEN, markLook, (first ? first.box.x : wordsBox.x) - gap - measure(QUOTE_OPEN, markLook).width, wordsBox.y, measure)
    const close = glyph('close', QUOTE_CLOSE, markLook, (last ? last.box.x + last.box.width : wordsBox.x) + gap, last ? last.box.y : wordsBox.y, measure)
    const right = Math.max(wordsBox.x + wordsBox.width, close.box.x + close.box.width)
    let y = wordsBox.y + wordsBox.height
    const attribution: TextItem[] = []
    let firstBy = true
    for (const line of by) {
      if (line.text.trim() === '') continue
      if (firstBy) y += sizes.speakerGap * byLook.px
      const lines = lineItems(line.id, line.text, byLook, { x: right - inner, y, width: inner }, measure, line.path)
      if (firstBy && lines.length > 0) attribution.push(glyph('dash', QUOTE_DASH, byLook, lines[0].box.x - measure(QUOTE_DASH, byLook).width, lines[0].box.y, measure))
      attribution.push(...lines)
      y += lines.length * lineHeightOf(byLook)
      firstBy = false
    }
    const block = boxOf([open, ...words, close, ...attribution])!
    return { wordLook, open, words, close, attribution, block, inner }
  }
  const k = fitScale((scale) => {
    const l = layout(scale)
    return l.inner > 0 && l.block.width <= wrap + 1e-6 && fitsIn(l.block, rect)
  })
  if (k === null) return { items: [] }
  const l = layout(k)

  // The block centred in the content rect.
  const dx = rect.x + rect.width / 2 - (l.block.x + l.block.width / 2)
  const dy = rect.y + rect.height / 2 - (l.block.y + l.block.height / 2)
  const block = shift({ box: l.block }, dx, dy).box
  const t = clock.t
  const lit = litWordAt(spec.beats, l.words.length, t)
  const words = l.words.map((w, i) => {
    const placed = shift(w, dx, dy)
    return i === lit ? { ...placed, look: { ...placed.look, accent: style.palette.accent } } : placed
  })

  const E = DURATIONS.entrance
  const move = enterMove(style, progress(t, beatOf(spec, 0) - E, E, style.motion.ease), l.wordLook.px)
  const about = centreOf(block)
  const items: DrawItem[] = [shift(l.open, dx, dy), ...words, shift(l.close, dx, dy), ...l.attribution.map((a) => shift(a, dx, dy))]
  return { items: withDim(dimFor(style, t, targets, size), items.map((item) => moved(item, move, about, size))) }
}
