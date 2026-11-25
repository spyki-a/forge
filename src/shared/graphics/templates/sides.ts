/**
 * The layout `before-after` and `versus` share (docs/CLIPS.md §9): two
 * halves side by side, each a label above a value, centred in its half, at
 * one layout for every shape (as bars and steps lay out). Beyond §6.2's
 * words, this piece's: each half as wide as the wider side's text needs plus
 * its padding (never wider than half the content width less the middle gap),
 * so a short pair is a compact card and not a band across a 16:9 frame; the
 * block centred in the content rect; the too-big rule over both halves
 * together. Text goes through `lineItems`, so a long label wraps in its half
 * and any script the others draw these draw.
 *
 * A side whose data is missing or not a `{ label, value }` of strings is
 * drawn as two empty strings: no text for it. Pure.
 */

import type { GraphicData } from '../template'
import type { Rect, TextItem, TextMeasure } from '../items'
import type { GraphicStyle } from '../style'
import { contentRect, fitScale, fitsIn, lineHeightOf, lineItems, lookOf, shortSide, widestOf, wrapWidth } from './layout'

/** One side of a two-sided template's data, its strings as said ('' for one that is not a string). */
export interface Side {
  label: string
  value: string
}

/** A side of the data, read leniently: a missing side, or a field that is not a string, is ''. */
export function sideOf(data: GraphicData, side: string): Side {
  const v = (data as unknown as Record<string, unknown>)[side]
  const o = v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return { label: typeof o.label === 'string' ? o.label : '', value: typeof o.value === 'string' ? o.value : '' }
}

/** One half laid out: its box, and its label's and value's line items in frame pixels. */
export interface HalfLaid {
  box: Rect
  label: TextItem[]
  value: TextItem[]
}

/** Both halves laid out, the block they sit in, the gap between them, and the label's px. */
export interface SidesLaid {
  block: Rect
  halves: [HalfLaid, HalfLaid]
  labelPx: number
  middle: number
}

/**
 * The two halves (`names` the item ids' heads, `left` then `right`, and the
 * data paths' heads), or null when they do not fit at `FIT_MIN`.
 */
export function layoutSides(
  sides: readonly [Side, Side],
  names: readonly [string, string],
  sizes: { label: number; value: number; gap: number; pad: number; middle?: number },
  place: Parameters<typeof contentRect>[0],
  style: GraphicStyle,
  size: { width: number; height: number },
  measure: TextMeasure
): SidesLaid | null {
  const s = shortSide(size)
  const rect = contentRect(place, size)
  const wrap = wrapWidth(rect, size)

  const layout = (k: number, origin: { x: number; y: number }) => {
    const labelLook = lookOf(style, sizes.label * s * k, 'center')
    const valueLook = lookOf(style, sizes.value * s * k, 'center')
    const labelPx = sizes.label * s * k
    const pad = sizes.pad * labelPx
    const gap = sizes.gap * labelPx
    const middle = (sizes.middle ?? 0) * labelPx
    const most = (wrap - middle) / 2
    const inner = Math.max(0, most - 2 * pad)
    const lay = (side: Side, name: string, x: number, width: number) => {
      const label = lineItems(`${name}-label`, side.label, labelLook, { x, y: 0, width }, measure, `data.${name}.label`)
      const value = lineItems(`${name}-value`, side.value, valueLook, { x, y: 0, width }, measure, `data.${name}.value`)
      const labelHeight = label.length * lineHeightOf(labelLook)
      const valueHeight = value.length * lineHeightOf(valueLook)
      return { label, value, labelHeight, valueHeight, widest: Math.max(widestOf(label), widestOf(value)) }
    }
    // First at the widest a half may be, to find how wide each side's text is.
    const probe = [lay(sides[0], names[0], 0, inner), lay(sides[1], names[1], 0, inner)]
    const fits = inner > 0 && probe.every((p) => [...p.label, ...p.value].every((item) => item.box.width <= inner + 1e-6))
    const half = Math.min(most, Math.max(probe[0].widest, probe[1].widest) + 2 * pad)
    const textWidth = Math.max(0, half - 2 * pad)
    const height = Math.max(...probe.map((p) => pad + p.labelHeight + (p.labelHeight > 0 && p.valueHeight > 0 ? gap : 0) + p.valueHeight + pad))
    const width = 2 * half + middle
    const halves = names.map((name, j) => {
      const x = origin.x + j * (half + middle)
      const laid = lay(sides[j], name, x + pad, textWidth)
      const own = pad + laid.labelHeight + (laid.labelHeight > 0 && laid.valueHeight > 0 ? gap : 0) + laid.valueHeight + pad
      // Each half's text centred down its half.
      const top = origin.y + (height - own) / 2 + pad
      const shift = <T extends { box: Rect }>(item: T, dy: number): T => ({ ...item, box: { ...item.box, y: item.box.y + dy } })
      const valueTop = top + laid.labelHeight + (laid.labelHeight > 0 && laid.valueHeight > 0 ? gap : 0)
      return {
        box: { x, y: origin.y, width: half, height },
        label: laid.label.map((item) => shift(item, top)),
        value: laid.value.map((item) => shift(item, valueTop))
      } as HalfLaid
    }) as [HalfLaid, HalfLaid]
    return { fits, width, height, halves, labelPx, middle }
  }
  const k = fitScale((scale) => {
    const l = layout(scale, { x: 0, y: 0 })
    return l.fits && l.width <= wrap + 1e-6 && fitsIn(l, rect)
  })
  if (k === null) return null
  const sized = layout(k, { x: 0, y: 0 })
  const origin = { x: rect.x + (rect.width - sized.width) / 2, y: rect.y + (rect.height - sized.height) / 2 }
  const l = layout(k, origin)
  return { block: { x: origin.x, y: origin.y, width: l.width, height: l.height }, halves: l.halves, labelPx: l.labelPx, middle: l.middle }
}
