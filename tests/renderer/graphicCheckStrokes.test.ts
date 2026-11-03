import { describe, expect, it } from 'vitest'
import { itemOrigin, type DrawItem } from '@shared/graphics/items'
import { STROKE_TOLERANCE, flattenPath, strokeWidth } from '@shared/graphics/stroke'
import { resolveGraphicStyle } from '@shared/graphics/style'
import {
  GRAPHIC_CHECK_OPTIONS,
  M8_OPEN_BELOW,
  M8_PATHS,
  M8_RADII,
  M8_TOLERANCES,
  STROKES_SIZE,
  STROKES_SPEC,
  STROKES_WIDTHS,
  m8Circle,
  oursAlong,
  pathFractions,
  strokesDrawer,
  strokesScale
} from '../../src/renderer/src/harness/graphicCheck'
import {
  M19_BAR,
  M8_BAR,
  STROKE_BANDS,
  alphaAgainst,
  chromaAlong,
  folderOf,
  largestGap,
  lengthPct,
  pathLengthReadings,
  pathLengthVerdict,
  strokeBand,
  strokeBandIndex,
  strokeLines,
  strokeWidthsError,
  type PathLengthRow
} from '../../src/renderer/src/harness/graphicMeasure'

/*
 * The pure half of the graphics check's `pathLength` (M8) and `strokes`
 * (M19) options (docs/CLIPS.md §6.11, §6.15): the paths and their sampling,
 * the verdict M8's table is read through, the strokes' layout and drawer,
 * and the line and chroma readers graphic.int's M19 read runs on. The
 * browser's lengths and the bake are measured on a page; a wrong verdict or
 * reader here would be certified where no test runs.
 */

const SIZE = { width: STROKES_SIZE.width, height: STROKES_SIZE.height }

/* ------------------------------------------------------------------ M8 */

describe('M8: the paths and their sampling', () => {
  it('reads the circle under r = 40 that the stroke note left open, at 20 and 30, beside a line, an S-curve and the arrow paths', () => {
    const names = M8_PATHS.map((p) => p.name)
    for (const r of [20, 30, 40, 50]) expect(M8_RADII).toContain(r)
    for (const name of ['circle r=20', 'circle r=30', 'line', 'S-curve', 'arrow corner', 'arrow head']) expect(names).toContain(name)
    // Every path is one subpath flattenPath takes, at every tolerance read.
    for (const p of M8_PATHS) for (const t of M8_TOLERANCES) expect(() => flattenPath(p.d, t), p.name).not.toThrow()
    expect(M8_TOLERANCES).toContain(STROKE_TOLERANCE)
  })

  it('draws the four-cubic circle: at STROKE_TOLERANCE its length reads the stroke note’s −0.1468 % at r = 20 and −0.0262 % at r = 100 against 2πr', () => {
    const at = (r: number): number => lengthPct(flattenPath(m8Circle(540, 960, r), STROKE_TOLERANCE).total, 2 * Math.PI * r)
    expect(at(20)).toBeCloseTo(-0.1468, 4)
    expect(at(100)).toBeCloseTo(-0.0262, 4)
    for (const p of M8_PATHS.filter((q) => q.name.startsWith('circle'))) expect(p.exact).toBeCloseTo(2 * Math.PI * Number(p.name.slice('circle r='.length)), 9)
  })

  it('gives each straight path’s exact length, which flattening reproduces', () => {
    for (const p of M8_PATHS.filter((q) => q.exact !== undefined && !q.name.startsWith('circle'))) {
      expect(flattenPath(p.d, STROKE_TOLERANCE).total, p.name).toBeCloseTo(p.exact!, 9)
    }
  })

  it('samples both ends: k / n for k = 0 to n', () => {
    expect(pathFractions(4)).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(pathFractions(0)).toEqual([0, 1])
  })

  it('takes our point where a draw-on’s tip sits, and the path’s start at 0, where the span has no tip', () => {
    const line = flattenPath('M100 200 L500 200', STROKE_TOLERANCE)
    expect(oursAlong(line, [0, 0.25, 1])).toEqual([{ x: 100, y: 200 }, { x: 200, y: 200 }, { x: 500, y: 200 }])
    const corner = flattenPath('M0 0 L100 0 L100 100', STROKE_TOLERANCE)
    expect(oursAlong(corner, [0.75])[0]).toEqual({ x: 100, y: 50 })
    expect(oursAlong(flattenPath('', STROKE_TOLERANCE), [0, 0.5])).toEqual([null, null])
  })
})

describe('M8: the arithmetic', () => {
  it('signs the length against the browser’s, and names an empty side', () => {
    expect(lengthPct(101, 100)).toBeCloseTo(1, 12)
    expect(lengthPct(99.8, 100)).toBeCloseTo(-0.2, 12)
    expect(lengthPct(0, 0)).toBe(0)
    expect(lengthPct(5, 0)).toBe(Infinity)
  })

  it('takes the largest pairwise gap, Infinity for a missing point or a different count', () => {
    expect(largestGap([{ x: 0, y: 0 }, { x: 3, y: 4 }], [{ x: 0, y: 0 }, { x: 0, y: 0 }])).toBe(5)
    expect(largestGap([{ x: 0, y: 0 }], [null])).toBe(Infinity)
    expect(largestGap([{ x: 0, y: 0 }], [])).toBe(Infinity)
    // A point that is not a number is not a small gap: the verdict's `<=` then fails it.
    expect(largestGap([{ x: NaN, y: 0 }], [{ x: 0, y: 0 }])).toBeNaN()
  })

  const row = (path: string, tolerance: number, pct: number, px: number): PathLengthRow => ({ path, tolerance, ours: 100 + pct, theirs: 100, lengthPct: pct, pointPx: px })

  it('reads the coarsest tolerance within 0.1 % and 0.5 px, the bar inclusive, a short length as bad as a long one', () => {
    expect(M8_BAR).toEqual({ lengthPct: 0.1, pointPx: 0.5 })
    const v = pathLengthVerdict([
      row('circle', 1, -0.64, 0.2), row('S', 1, 0.01, 0.74),
      row('circle', 0.5, -0.1, 0.5), row('S', 0.5, 0.02, 0.1),
      row('circle', 0.25, -0.05, 0.2), row('S', 0.25, 0.0, 0.05)
    ])
    expect(v.tolerances.map((t) => t.tolerance)).toEqual([1, 0.5, 0.25])
    expect(v.tolerances.map((t) => t.pass)).toEqual([false, true, true])
    expect(v.coarsest).toBe(0.5)
    expect(v.finerAllPass).toBe(true)
    // The worst is the largest in size, signed as read, and the path it came from.
    expect(v.tolerances[0]).toMatchObject({ worstLengthPct: -0.64, worstLengthPath: 'circle', worstPointPx: 0.74, worstPointPath: 'S' })
    // −0.15 % is outside the bar as +0.15 % is.
    expect(pathLengthVerdict([row('circle', 0.25, -0.15, 0)]).coarsest).toBeNull()
    expect(pathLengthVerdict([row('circle', 0.25, 0.1000001, 0)]).coarsest).toBeNull()
    expect(pathLengthVerdict([row('circle', 0.25, 0, 0.5000001)]).coarsest).toBeNull()
  })

  it('says when a finer tolerance fails below the coarsest that passes, and passes nothing a browser could not measure', () => {
    const v = pathLengthVerdict([row('a', 1, 0.0, 0.1), row('a', 0.5, 0.3, 0.1), row('a', 0.25, 0.0, 0.1)])
    expect(v.coarsest).toBe(1)
    expect(v.finerAllPass).toBe(false)
    expect(pathLengthVerdict([row('a', 0.25, NaN, 0)]).tolerances[0].pass).toBe(false)
    expect(pathLengthVerdict([row('a', 0.25, 0, Infinity)]).tolerances[0].pass).toBe(false)
    expect(pathLengthVerdict([])).toEqual({ tolerances: [], coarsest: null, finerAllPass: false })
  })

  it('marks the circles under r = 40 open, §6.3’s question for the owner, and nothing else', () => {
    expect(M8_OPEN_BELOW).toBe(40)
    const open = M8_PATHS.filter((p) => p.open).map((p) => p.name)
    for (const name of ['circle r=20', 'circle r=30', 'circle r=38', 'circle r=39']) expect(open).toContain(name)
    for (const name of ['circle r=40', 'circle r=45', 'line', 'S-curve', 'arrow head']) expect(open).not.toContain(name)
    for (const name of open) expect(Number(name.replace(/^circle r=/, '')), name).toBeLessThan(40)
  })

  it('gives the verdict twice, over every path and without the open ones, so the readout answers neither way', () => {
    const rows = [
      row('circle r=20', 0.5, -0.39, 0.37), row('circle r=40', 0.5, -0.2, 0.2), row('line', 0.5, 0, 0),
      row('circle r=20', 0.25, -0.16, 0.18), row('circle r=40', 0.25, -0.07, 0.18), row('line', 0.25, 0, 0),
      row('circle r=20', 0.125, -0.07, 0.09), row('circle r=40', 0.125, -0.03, 0.09), row('line', 0.125, 0, 0)
    ]
    const { all, withoutOpen } = pathLengthReadings(rows, new Set(['circle r=20']))
    expect(all).toEqual(pathLengthVerdict(rows))
    expect(all.coarsest).toBe(0.125)
    expect(withoutOpen.coarsest).toBe(0.25)
    for (const t of withoutOpen.tolerances) {
      expect(t.paths).toBe(2)
      expect(t.worstLengthPath).not.toBe('circle r=20')
      expect(t.worstPointPath).not.toBe('circle r=20')
    }
    // Nothing open: the two are one.
    expect(pathLengthReadings(rows, new Set()).withoutOpen).toEqual(all)
  })
})

/* ----------------------------------------------------------------- M19 */

describe('M19: the strokes’ layout and drawer', () => {
  it('puts each band’s horizontal top edge on an even row and every line inside its band, the bands apart and on the frame', () => {
    for (let i = 0; i < STROKE_BANDS.max; i++) {
      for (const w of [1, 2, 3, 4]) {
        const band = strokeBand(i, w)
        const top = band.horizontal[0].y - w / 2
        expect(top % 2, `band ${i} width ${w}: top edge ${top}`).toBe(0)
        for (const p of [...band.horizontal, ...band.diagonal]) {
          expect(p.y - w).toBeGreaterThan(band.box.y)
          expect(p.y + w).toBeLessThan(band.box.y + band.box.height)
        }
      }
      if (i > 0) expect(strokeBand(i, 1).box.y).toBe(strokeBand(i - 1, 1).box.y + strokeBand(i - 1, 1).box.height)
    }
    const last = strokeBand(STROKE_BANDS.max - 1, 1).box
    expect(last.y + last.height).toBeLessThanOrEqual(SIZE.height)
    const [a, b] = strokeBand(0, 1).diagonal
    expect((b.y - a.y) / (b.x - a.x)).toBeCloseTo(191 / 320, 12)
  })

  it('takes 1 to 6 widths, each over 0 and at most the 20 px a band holds apart, and names what it got otherwise', () => {
    expect(STROKE_BANDS.maxWidth).toBe(20)
    for (const ok of [[1, 2, 3], [20], [0.5, 1, 2, 3, 4, 20]]) expect(strokeWidthsError(ok), JSON.stringify(ok)).toBeNull()
    for (const bad of [[], [1, 2, 3, 4, 5, 6, 7], [0], [-1], [NaN], [Infinity], [20.5], [1, 40]]) {
      expect(strokeWidthsError(bad), JSON.stringify(bad)).toContain(`got ${JSON.stringify(bad)}`)
    }
  })

  it('keeps a band’s two lines apart up to the widest it takes: a disc raster of each reads as two lines, not one', () => {
    const w = STROKE_BANDS.maxWidth
    const band = strokeBand(0, w)
    const H = band.box.height
    const W = SIZE.width
    // Each line as the set of pixel centres within w/2 of the segment (a butt cap would be shorter; a disc is the larger ink).
    const near = (px: number, py: number, [a, b]: readonly { x: number; y: number }[]): boolean => {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy)))
      return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy)) <= w / 2 + 1
    }
    const data = picture(W, H, (x, y) => (near(x + 0.5, band.box.y + y + 0.5, band.horizontal) || near(x + 0.5, band.box.y + y + 0.5, band.diagonal) ? 255 : 0))
    const lines = strokeLines(data, W, H)
    expect(lines).toHaveLength(2)
    // And neither touches the band's edge.
    for (const l of lines) {
      expect(l.box.y).toBeGreaterThan(0)
      expect(l.box.y + l.box.height).toBeLessThan(H)
    }
  })

  it('names the band a read line lies in by its top edge, so M19 groups lines as drawn, not by a rounded width; none outside the bands', () => {
    const at = (y: number): number | null => strokeBandIndex({ x: 0, y, width: 10, height: 1 })
    expect(at(60)).toBe(0)
    expect(at(359)).toBe(0)
    expect(at(360)).toBe(1)
    expect(at(60 + 5 * 300)).toBe(5)
    expect(at(59)).toBeNull()
    expect(at(60 + 6 * 300)).toBeNull()
    // Each band's own lines, as strokeBand lays them, at every width it takes.
    for (let i = 0; i < STROKE_BANDS.max; i++) {
      for (const w of [1, 3, STROKE_BANDS.maxWidth]) {
        const band = strokeBand(i, w)
        for (const [a] of [band.horizontal, band.diagonal]) expect(strokeBandIndex({ x: a.x, y: Math.floor(a.y - w), width: 1, height: 1 }), `band ${i} width ${w}`).toBe(i)
      }
    }
  })

  it('scales by the narrowest width over the painter’s floor, and not at all when none is under it', () => {
    expect(strokeWidth(0, SIZE)).toBe(2)
    expect(strokesScale(STROKES_WIDTHS, SIZE)).toBe(0.5)
    expect(strokesScale([2, 3], SIZE)).toBe(1)
    expect(strokesScale([0.5, 3], SIZE)).toBe(0.25)
    expect(strokesScale([1], { width: 540, height: 960 })).toBe(1)
    // The narrowest over the floor, not on it: no scale.
    expect(strokesScale([3, 4], SIZE)).toBe(1)
  })

  it('draws each width at that width on the frame, along its band’s lines, through the painter’s own floor', () => {
    const style = resolveGraphicStyle('clean')
    for (const widths of [[...STROKES_WIDTHS], [0.5, 2], [2, 3]]) {
      const scale = strokesScale(widths, SIZE)
      const { items } = strokesDrawer(widths)(STROKES_SPEC, style, { t: 0, fps: 30 }, SIZE, () => ({ width: 0, ascent: 0, descent: 0 }), {})
      expect(items).toHaveLength(widths.length * 2)
      items.forEach((item: DrawItem, k) => {
        if (item.kind !== 'stroke') throw new Error(`item ${k} is a ${item.kind}`)
        const w = widths[Math.floor(k / 2)]
        const band = strokeBand(Math.floor(k / 2), w)
        const [a, b] = k % 2 === 0 ? band.horizontal : band.diagonal
        // The painter's width (the floor applied to the item's), under the item's scale: the width asked for.
        expect(strokeWidth(item.width, SIZE) * (item.transform?.scale ?? 1), `${widths} item ${k}`).toBeCloseTo(w, 12)
        // The path's ends, under the item's transform about itemOrigin, are the band's.
        const o = itemOrigin(item, SIZE)
        const s = item.transform?.scale ?? 1
        const [, x0, y0, x1, y1] = item.d.split(/[ ML]+/).map(Number)
        const map = (x: number, y: number): { x: number; y: number } => ({ x: o.x + (x - o.x) * s, y: o.y + (y - o.y) * s })
        for (const [p, q] of [[map(x0, y0), a], [map(x1, y1), b]]) {
          expect(p.x).toBeCloseTo(q.x, 9)
          expect(p.y).toBeCloseTo(q.y, 9)
        }
        expect(item.transform === undefined).toBe(scale === 1)
        expect(item).toMatchObject({ from: 0, to: 1, cap: 'butt', opacity: 1 })
      })
    }
  })

  it('stands still, so every moving frame the bake writes is one picture', () => {
    const style = resolveGraphicStyle('clean')
    const draw = strokesDrawer(STROKES_WIDTHS)
    const measure = () => ({ width: 0, ascent: 0, descent: 0 })
    expect(draw(STROKES_SPEC, style, { t: 0.4, fps: 30 }, SIZE, measure, {})).toEqual(draw(STROKES_SPEC, style, { t: 0, fps: 30 }, SIZE, measure, {}))
    expect(STROKES_SPEC.beats).toEqual([])
  })
})

/** A W×H straight-RGBA picture, ink set by `alpha(x, y)`. */
function picture(w: number, h: number, alpha: (x: number, y: number) => number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[(y * w + x) * 4 + 3] = alpha(x, y)
  return data
}

describe('M19: reading the lines back', () => {
  const W = 120
  const H = 160

  it('reads a crisp line’s width and centre: the middle row of an odd width, both middle rows of an even one', () => {
    const data = picture(W, H, (x, y) => (x >= 10 && x < 110 && ((y >= 20 && y < 22) || (y >= 40 && y < 43)) ? 255 : 0))
    const [two, three] = strokeLines(data, W, H)
    expect(two.width).toBe(2)
    expect(two.slope).toBe(0)
    expect(two.box).toEqual({ x: 10, y: 20, width: 100, height: 2 })
    // 100 columns, 4 clear of each end: 92 scans.
    expect(new Set(two.centre.map((p) => p.y))).toEqual(new Set([20, 21]))
    expect(two.centre).toHaveLength(184)
    expect(three.width).toBe(3)
    expect(new Set(three.centre.map((p) => p.y))).toEqual(new Set([41]))
    expect(three.centre).toHaveLength(92)
  })

  it('reads a sloped line’s width across it, not down a column, and a steep one by rows', () => {
    // Two rows a column, stepping down one row every two columns: slope 1/2, 2 px down a column, 2 / √1.25 across.
    const data = picture(W, H, (x, y) => (x >= 10 && x < 110 && y - (60 + Math.floor((x - 10) / 2)) >= 0 && y - (60 + Math.floor((x - 10) / 2)) < 2 ? 255 : 0))
    const [line] = strokeLines(data, W, H)
    expect(line.slope).toBeCloseTo(0.5, 2)
    expect(line.width).toBeCloseTo(2 / Math.sqrt(1.25), 2)
    const steep = picture(W, H, (x, y) => (y >= 10 && y < 150 && x >= 50 && x < 53 ? 255 : 0))
    const [v] = strokeLines(steep, W, H)
    expect(v.slope).toBe(Infinity)
    expect(v.width).toBe(3)
    expect(new Set(v.centre.map((p) => p.x))).toEqual(new Set([51]))
  })

  it('weighs a soft edge by its alpha and leaves specks out', () => {
    const data = picture(W, H, (x, y) => {
      if (x >= 10 && x < 110 && y === 30) return 255
      if (x >= 10 && x < 110 && y === 31) return 51
      return x === 5 && y >= 100 && y < 103 ? 255 : 0
    })
    const lines = strokeLines(data, W, H)
    expect(lines).toHaveLength(1)
    expect(lines[0].width).toBeCloseTo(1.2, 9)
    expect(new Set(lines[0].centre.map((p) => p.y))).toEqual(new Set([30]))
  })

  const planes = (w: number, h: number, value: number): Uint8Array => new Uint8Array(w * h).fill(value)

  it('compares each centre pixel with the 4:2:0 sample it is stored with, the bar inclusive', () => {
    expect(M19_BAR.chromaLevels).toBe(8)
    const w = 9
    const h = 6
    const half = Math.ceil(w / 2)
    const reference = { u: planes(w, h, 100), v: planes(w, h, 150) }
    const measured = { u: planes(half, h / 2, 100), v: planes(half, h / 2, 150) }
    // Pixel (7, 3) is stored at sample (3, 1) of a plane ceil(9 / 2) = 5 wide.
    measured.u[1 * half + 3] = 108
    measured.v[1 * half + 3] = 141
    const at = chromaAlong([{ x: 7, y: 3 }, { x: 1, y: 1 }], reference, measured, w)
    expect(at).toMatchObject({ pixels: 2, maxU: 8, maxV: 9, meanU: 4, meanV: 4.5, within: false })
    measured.v[1 * half + 3] = 142
    expect(chromaAlong([{ x: 6, y: 2 }], reference, measured, w)).toMatchObject({ maxU: 8, maxV: 8, within: true })
    expect(chromaAlong([], reference, measured, w).within).toBe(false)
  })

  it('compares alpha alone over a box, with each side’s coverage', () => {
    const a = picture(4, 4, (x) => (x === 1 ? 255 : 0))
    const b = picture(4, 4, (x) => (x === 1 ? 250 : 0))
    a[0] = 255 // a colour channel, never read
    expect(alphaAgainst(a, b, 4, { x: 0, y: 0, width: 4, height: 2 })).toEqual({ max: 5, coverage: [2, 500 / 255] })
  })

  it('names the bake’s folder without a trailing separator, on either platform, and none for the harness bridge', () => {
    expect(folderOf('/Users/me/cache/graphic-check-strokes-1.seq/%05d.png')).toBe('/Users/me/cache/graphic-check-strokes-1.seq')
    expect(folderOf('C:\\Users\\me\\cache\\g.seq\\%05d.png')).toBe('C:\\Users\\me\\cache\\g.seq')
    expect(folderOf('harness://graphic-check-strokes-1.seq/%05d.png')).toBeNull()
    expect(folderOf('%05d.png')).toBeNull()
  })
})

describe('the options', () => {
  it('has pathLength and strokes among the options, after primitives', () => {
    expect(GRAPHIC_CHECK_OPTIONS).toContain('pathLength')
    expect(GRAPHIC_CHECK_OPTIONS).toContain('strokes')
    expect(GRAPHIC_CHECK_OPTIONS.indexOf('primitives')).toBeLessThan(GRAPHIC_CHECK_OPTIONS.indexOf('pathLength'))
  })
})
