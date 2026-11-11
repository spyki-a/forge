/**
 * `keyword` (docs/CLIPS.md §6.2): one to four of the speaker's own words on a
 * card, one of them lit.
 *
 * Items, in order: the dim when the style dims; `panel` (rounded, only when
 * `palette.panelOpacity` > 0, padded 0.5 × the words' px); one `word-i` text
 * item per word (`textItems` at unit `word`, `source: { path: 'data.words',
 * piece: i }`), so the pieces joined by single spaces are `data.words` with
 * its whitespace normalised; `underline`, a stroke under the lit word (round
 * caps, no head, `palette.accent`, 0.08 of the words' px thick, its baseline
 * plus 0.12 of that px below it). `lit` changes the lit word's colour
 * (`look.accent` = `palette.accent`) and draws the underline, and nothing
 * else: never its text, case or order. A `lit` outside the words lights none
 * and draws no underline.
 *
 * Motion: the card (the panel, the words, the underline) enters with
 * `style.motion.entrance` over `DURATIONS.entrance`, arriving on the beat,
 * and scales from 0.92 whatever the entrance (`pop`'s scale, motion.ts);
 * the words stagger 0.05 s each, the last arriving on the beat, each with the
 * same entrance over the same duration, inside the card's; the underline
 * draws on left to right (`from` 0, `to` p) over `DURATIONS.stroke`, ending
 * on the beat.
 */

import { ASCENT } from '../../render/textLayout'
import { textItems, type DrawItem, type DrawOut, type Drawer, type Rect, type StrokeItem } from '../items'
import { DURATIONS, entrance, progress } from '../motion'
import {
  LAYOUT_SIZES,
  beatOf,
  boxOf,
  centreOf,
  contentRect,
  dimFor,
  drawOnEase,
  fitScale,
  fitsIn,
  lookOf,
  moved,
  panelFor,
  shortSide,
  withDim,
  wrapWidth
} from './layout'

/** The words' stagger, seconds (§6.2, a proposal; the research's §1.2 row 1). */
export const KEYWORD_STAGGER_S = 0.05
/** The underline's thickness and its drop below the baseline, × the words' px (§6.2, proposals). */
export const UNDERLINE_WIDTH = 0.08
export const UNDERLINE_DROP = 0.12

export const drawKeyword: Drawer = (spec, style, clock, size, measure, targets): DrawOut => {
  const data = spec.data
  if (data.template !== 'keyword') return { items: [] }
  const sizes = LAYOUT_SIZES.keyword
  const s = shortSide(size)
  const rect = contentRect(spec.place, size)
  const wrap = wrapWidth(rect, size)
  const column = { x: rect.x + (rect.width - wrap) / 2, width: wrap }

  const layout = (k: number) => {
    const look = lookOf(style, sizes.words * s * k, 'center')
    const pad = sizes.pad * look.px
    const words = textItems({ id: 'word', text: data.words, look, at: { ...column, y: 0 }, unit: 'word', source: 'data.words' }, measure)
    const box = boxOf(words) ?? { x: column.x + wrap / 2, y: 0, width: 0, height: 0 }
    return { look, pad, words, box, width: box.width + 2 * pad, height: box.height + 2 * pad }
  }
  const k = fitScale((scale) => fitsIn(layout(scale), rect))
  if (k === null) return { items: [] }
  const l = layout(k)

  // The card centred in the content rect; the words laid out at y 0 moved down into it.
  const panelBox: Rect = { x: l.box.x - l.pad, y: rect.y + (rect.height - l.height) / 2, width: l.width, height: l.height }
  const dy = panelBox.y + l.pad - l.box.y
  const lit = Number.isInteger(data.lit) && data.lit >= 0 && data.lit < l.words.length ? data.lit : -1
  const words = l.words.map((w, i) => {
    const box = { ...w.box, y: w.box.y + dy }
    return i === lit ? { ...w, box, look: { ...w.look, accent: style.palette.accent } } : { ...w, box }
  })

  const t = clock.t
  const beat = beatOf(spec, 0)
  const E = DURATIONS.entrance
  const px = l.look.px
  const pc = progress(t, beat - E, E, style.motion.ease)
  const card = entrance(style.motion.entrance, pc)
  // §6.2: "the card scales from 0.92 (proposal) with a rise and fade". `rise`
  // (and the entrances that resolve to it) scales nothing, so the card takes
  // `pop`'s scale from motion.ts beside the style's own rise and fade; under
  // `pop` itself the entrance's own scale (with `out-back`'s overshoot in
  // energetic) is used as it is.
  const cardScale = style.motion.entrance === 'pop' ? card.scale : entrance('pop', pc).scale
  const cardMove = { dy: card.dy * px, scale: cardScale, opacity: card.opacity }
  const cardCentre = centreOf(panelBox)

  const items: DrawItem[] = []
  const panel = panelFor('panel', panelBox, style, size)
  if (panel) items.push(moved(panel, cardMove, cardCentre, size))
  words.forEach((word, i) => {
    const arrive = beat - (words.length - 1 - i) * KEYWORD_STAGGER_S
    const own = entrance(style.motion.entrance, progress(t, arrive - E, E, style.motion.ease))
    const inCard = moved(word, { dy: own.dy * px, scale: own.scale, opacity: own.opacity }, centreOf(word.box), size)
    items.push(moved(inCard, cardMove, cardCentre, size))
  })
  if (lit >= 0) {
    const b = words[lit].box
    const y = b.y + Math.round(px * ASCENT) + UNDERLINE_DROP * px
    const underline: StrokeItem = {
      kind: 'stroke',
      id: 'underline',
      opacity: 1,
      d: `M ${b.x} ${y} L ${b.x + b.width} ${y}`,
      from: 0,
      to: progress(t, beat - DURATIONS.stroke, DURATIONS.stroke, drawOnEase(style)),
      width: UNDERLINE_WIDTH * px,
      color: style.palette.accent,
      cap: 'round',
      join: 'round',
      look: style.strokeLook
    }
    items.push(moved(underline, cardMove, cardCentre, size))
  }
  return { items: withDim(dimFor(style, t, targets, size), items) }
}
