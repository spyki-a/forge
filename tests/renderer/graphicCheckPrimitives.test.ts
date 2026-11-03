import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { graphemesOf, type DrawItem, type DrawList, type TextMeasure } from '@shared/graphics/items'
import { drawListAt } from '@shared/graphics/drawList'
import { beatFrame, graphicMovingFrames } from '@shared/graphics/frame'
import { resolveGraphicStyle } from '@shared/graphics/style'
import { INDIC_FONTS } from '@shared/render/textPaint'
import {
  GRAPHIC_CHECK_OPTIONS,
  INDIC_CLUSTERS,
  PRIMITIVES_FPS,
  PRIMITIVES_SIZE,
  PRIMITIVES_SPEC,
  PRIMITIVE_CASES,
  PRIMITIVE_HOLE,
  PRIMITIVE_PROGRESS,
  PRIMITIVE_STROKE_D,
  askedOptions,
  primitiveFrames,
  primitivesDrawer,
  primitivesProgress,
  siteReading,
  type GraphicCheckOptions,
  type PrimitiveCase
} from '../../src/renderer/src/harness/graphicCheck'
import {
  PRIMITIVES_BAR,
  alphaOutside,
  cropRgba,
  diffOverInk,
  diffRgba,
  framePath,
  primitivesVerdict,
  siblingPath,
  type PixelDiff,
  type PrimitivesReading
} from '../../src/renderer/src/harness/graphicMeasure'

/*
 * The pure half of the graphics check's phase-1 options (docs/CLIPS.md §6.11's
 * `primitives` and `indic` rows, §6.12's phase 1 bar): the spec, the hand-built
 * drawer's lists at each progress, the frames read, and the arithmetic the
 * verdicts are made of. What they are drawn and baked into is measured in a
 * browser (the harness page, and the development app, which is the user's);
 * a wrong verdict here would be certified in a console where no test runs.
 */

const STYLE = resolveGraphicStyle('clean')
const FPS = PRIMITIVES_FPS
const SIZE = { width: PRIMITIVES_SIZE.width, height: PRIMITIVES_SIZE.height }

/** 0.55 em a grapheme, as tests/renderer/graphicCanvas.test.ts's fake measures. */
const measure: TextMeasure = (text, look) => {
  const count = graphemesOf(text)?.length ?? Array.from(text).length
  return { width: count * look.px * 0.55, ascent: look.px * 0.8, descent: look.px * 0.2 }
}

const listAt = (name: PrimitiveCase, frame: number): DrawList =>
  drawListAt(PRIMITIVES_SPEC, STYLE, frame, FPS, SIZE, measure, {}, primitivesDrawer(name))

/** The frame each progress of §6.11 lands on: beatFrame of its share of the last beat. */
const frameOf = (p: number): number => beatFrame(p * 1.0, FPS)

/* ---------------------------------------------------------------- the spec */

describe('PRIMITIVES_SPEC (§6.3, "The drawer seam")', () => {
  it('is a counter spec with beats at 0.5 and 1.0 s, seconds 2, seed 1', () => {
    expect(PRIMITIVES_SPEC.data.template).toBe('counter')
    expect(PRIMITIVES_SPEC.beats).toEqual([0.5, 1.0])
    expect(PRIMITIVES_SPEC.seconds).toBe(2)
    expect(PRIMITIVES_SPEC.seed).toBe(1)
  })

  it('is frozen through its data, beats and place, so no drawer or caller moves it under the next run', () => {
    expect(Object.isFrozen(PRIMITIVES_SPEC)).toBe(true)
    expect(Object.isFrozen(PRIMITIVES_SPEC.data)).toBe(true)
    expect(Object.isFrozen(PRIMITIVES_SPEC.beats)).toBe(true)
    expect(Object.isFrozen(PRIMITIVES_SPEC.place)).toBe(true)
  })

  it('names every case §6.11 lists, and the three progress values', () => {
    for (const name of ['stroke', 'text-latin', 'text-indic', 'dim-hard', 'dim-feather', 'group'] as const) expect(PRIMITIVE_CASES).toContain(name)
    expect([...PRIMITIVE_PROGRESS]).toEqual([0, 0.5, 1])
  })
})

/* ------------------------------------------------------------ the progress */

describe('primitivesProgress', () => {
  it('is exactly 0, 0.5 and 1 on the frames beatFrame names for the progress values, at 30 fps', () => {
    expect(primitivesProgress(PRIMITIVES_SPEC, frameOf(0) / FPS)).toBe(0)
    expect(primitivesProgress(PRIMITIVES_SPEC, frameOf(0.5) / FPS)).toBe(0.5)
    expect(primitivesProgress(PRIMITIVES_SPEC, frameOf(1) / FPS)).toBe(1)
  })

  it('holds 1 after the last beat and reads 0 before the start', () => {
    for (const t of [1.0, 1.5, 2, 59 / FPS]) expect(primitivesProgress(PRIMITIVES_SPEC, t)).toBe(1)
    expect(primitivesProgress(PRIMITIVES_SPEC, -0.2)).toBe(0)
  })

  it('is linear between, and settled from the start for a spec with no beat past 0', () => {
    expect(primitivesProgress(PRIMITIVES_SPEC, 0.25)).toBeCloseTo(0.25, 12)
    expect(primitivesProgress({ ...PRIMITIVES_SPEC, beats: [] }, 0)).toBe(1)
  })
})

describe('primitiveFrames', () => {
  const layout = primitiveFrames(PRIMITIVES_SPEC, STYLE, FPS)

  it('reads the clip of 60 frames, its 46 moving frames, and the progress frames 0, 15 and 30', () => {
    expect(layout.total).toBe(60)
    expect(layout.moving).toBe(graphicMovingFrames(PRIMITIVES_SPEC, STYLE, FPS, 60))
    expect(layout.moving).toBe(46)
    expect(layout.progress).toEqual([
      { p: 0, frame: 0 },
      { p: 0.5, frame: 15 },
      { p: 1, frame: 30 }
    ])
  })

  it('reads the last moving frame and the held end, each once, in order', () => {
    expect(layout.lastMoving).toBe(layout.moving - 1)
    expect(layout.heldEnd).toBe(layout.total - 1)
    for (const frame of [0, 15, 30, layout.lastMoving, layout.heldEnd]) expect(layout.read).toContain(frame)
    expect(new Set(layout.read).size).toBe(layout.read.length)
    expect([...layout.read].sort((a, b) => a - b)).toEqual(layout.read)
  })

  it('reads a held end the bake never draws: the export holds the last moving frame there', () => {
    expect(layout.heldEnd).toBeGreaterThanOrEqual(layout.moving)
    expect(layout.read.filter((frame) => frame >= layout.moving)).toEqual([layout.heldEnd])
  })
})

/* ---------------------------------------------------------- the drawer */

const only = <T extends DrawItem['kind']>(list: DrawList, kind: T): Extract<DrawItem, { kind: T }> => {
  expect(list.items).toHaveLength(1)
  expect(list.items[0].kind).toBe(kind)
  return list.items[0] as Extract<DrawItem, { kind: T }>
}

describe('primitivesDrawer, through the drawer seam', () => {
  it('stroke: the cubic drawn on to 0, 0.5 and 1, with an end head that rides it, grown after 0.1 s', () => {
    expect(PRIMITIVE_STROKE_D).toMatch(/ C /)
    for (const p of PRIMITIVE_PROGRESS) {
      const stroke = only(listAt('stroke', frameOf(p)), 'stroke')
      expect(stroke.d).toBe(PRIMITIVE_STROKE_D)
      expect(stroke.from).toBe(0)
      expect(stroke.to).toBe(p)
      expect(stroke.heads?.end).toBeDefined()
      expect(stroke.heads?.start).toBeUndefined()
    }
    // headGrowAt is motion.ts's progress, with its 1e-6 s allowance: 1e-5 at t = 0, on a span of no length, so no head is drawn.
    expect(only(listAt('stroke', 0), 'stroke').heads?.end?.grow).toBeLessThan(1e-4)
    expect(only(listAt('stroke', frameOf(0.5)), 'stroke').heads?.end?.grow).toBe(1)
  })

  it('text-latin: one item per word, entering by rise: opacity p, up from half the size to its place', () => {
    for (const p of PRIMITIVE_PROGRESS) {
      const list = listAt('text-latin', frameOf(p))
      expect(list.items.map((item) => (item.kind === 'text' ? item.text : null))).toEqual(['Measured,', 'not', 'assumed'])
      for (const item of list.items) {
        expect(item.opacity).toBe(p)
        expect(item.transform?.y).toBeCloseTo(0.5 * (1 - p) * 96, 10)
        expect(item.transform?.scale).toBe(1)
      }
    }
  })

  it('text-indic: one item per §51 cluster of its two words (one per script), each in its script\'s INDIC_FONTS face, entering as the Latin does', () => {
    for (const p of PRIMITIVE_PROGRESS) {
      const list = listAt('text-indic', frameOf(p))
      const texts = list.items.map((item) => (item.kind === 'text' ? item.text : ''))
      expect(texts).toEqual([...INDIC_CLUSTERS])
      for (const item of list.items) {
        if (item.kind !== 'text') throw new Error('a text item')
        const face = /\p{Script=Devanagari}/u.test(item.text) ? INDIC_FONTS[0] : INDIC_FONTS[1]
        expect(item.look.font).toBe(face)
        expect(item.opacity).toBe(p)
      }
    }
  })

  it('dim-hard and dim-feather: one dim at 0.6 fading in by p, its hole fixed, hard and 24 px feathered', () => {
    for (const [name, feather] of [['dim-hard', 0], ['dim-feather', 24]] as const) {
      for (const p of PRIMITIVE_PROGRESS) {
        const dim = only(listAt(name, frameOf(p)), 'dim')
        expect(dim.opacity).toBe(p)
        expect(dim.alpha).toBe(0.6)
        expect(dim.hole?.feather).toBe(feather)
        expect(dim.hole?.box).toEqual(PRIMITIVE_HOLE)
      }
    }
  })

  it('group: a panel and its word as one group, scaled 0.8 to 1.2 and turned to −12° by p', () => {
    for (const p of PRIMITIVE_PROGRESS) {
      const group = only(listAt('group', frameOf(p)), 'group')
      expect(group.opacity).toBe(1)
      expect(group.transform?.scale).toBeCloseTo(0.8 + 0.4 * p, 12)
      expect(group.transform?.rotate).toBeCloseTo(-12 * p, 12)
      expect(group.children.map((child) => child.kind)).toEqual(['shape', 'text'])
    }
  })

  it('is pure: every case\'s list at every frame read is the same when asked twice', () => {
    const { read } = primitiveFrames(PRIMITIVES_SPEC, STYLE, FPS)
    for (const name of PRIMITIVE_CASES) for (const frame of read) expect(listAt(name, frame)).toEqual(listAt(name, frame))
  })

  it('is settled by the last moving frame: its list equals the held end\'s, in every case', () => {
    const { lastMoving, heldEnd } = primitiveFrames(PRIMITIVES_SPEC, STYLE, FPS)
    for (const name of PRIMITIVE_CASES) expect(listAt(name, lastMoving)).toEqual(listAt(name, heldEnd))
  })
})

/* ------------------------------------------------------------ the arithmetic */

/** A `width`×`height` RGBA picture, transparent, with `paint` applied. */
function picture(width: number, height: number, paint: (set: (x: number, y: number, rgba: number[]) => void) => void = () => undefined): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  paint((x, y, rgba) => data.set(rgba, (y * width + x) * 4))
  return data
}

describe('cropRgba', () => {
  it('cuts the box out of a frame, row by row, as the box route draws it', () => {
    const frame = picture(4, 3, (set) => {
      set(1, 1, [10, 20, 30, 40])
      set(2, 2, [50, 60, 70, 80])
    })
    const cut = cropRgba(frame, 4, { x: 1, y: 1, width: 2, height: 2 })
    expect(Array.from(cut)).toEqual([10, 20, 30, 40, 0, 0, 0, 0, 0, 0, 0, 0, 50, 60, 70, 80])
  })
})

describe('alphaOutside', () => {
  it('counts the alpha outside the box and none inside it', () => {
    const frame = picture(4, 4, (set) => {
      set(1, 1, [255, 255, 255, 255])
      set(3, 0, [255, 255, 255, 7])
      set(0, 3, [255, 255, 255, 9])
    })
    expect(alphaOutside(frame, 4, 4, { x: 1, y: 1, width: 2, height: 2 })).toEqual({ max: 9, pixels: 2 })
    expect(alphaOutside(frame, 4, 4, { x: 0, y: 0, width: 4, height: 4 })).toEqual({ max: 0, pixels: 0 })
  })

  it('reads colour without alpha as nothing, and every pixel as outside a null box', () => {
    const frame = picture(2, 2, (set) => {
      set(0, 0, [255, 0, 0, 0])
      set(1, 1, [0, 0, 0, 3])
    })
    expect(alphaOutside(frame, 2, 2, null)).toEqual({ max: 3, pixels: 1 })
  })

  it('takes the box\'s far edges as outside it, across and down', () => {
    const frame = picture(3, 3, (set) => {
      set(2, 0, [0, 0, 0, 1])
      set(0, 2, [0, 0, 0, 1])
    })
    expect(alphaOutside(frame, 3, 3, { x: 0, y: 0, width: 2, height: 2 }).pixels).toBe(2)
    expect(alphaOutside(frame, 3, 3, { x: 0, y: 0, width: 3, height: 3 }).pixels).toBe(0)
  })
})

describe('diffOverInk', () => {
  it('takes the mean over the two pictures\' ink, padded, where a whole picture would dilute it', () => {
    const a = picture(100, 100, (set) => set(50, 50, [255, 255, 255, 255]))
    const b = picture(100, 100, (set) => set(51, 50, [255, 255, 255, 255]))
    const whole = diffRgba(a, b, 100)
    const ink = diffOverInk(a, b, 100, 100, 2)
    expect(whole.mean).toBeLessThan(PRIMITIVES_BAR.bakeMeanLevels)
    expect(ink.pixels).toBe(6 * 5)
    expect(ink.differing).toBe(2)
    expect(ink.mean).toBeGreaterThan(PRIMITIVES_BAR.bakeMeanLevels)
  })

  it('compares the whole picture when neither has ink, and is 0 for equal pictures', () => {
    const empty = picture(5, 4)
    expect(diffOverInk(empty, picture(5, 4), 5, 4)).toEqual({ mean: 0, max: 0, differing: 0, pixels: 20 })
  })

  it('keeps the padded box inside the picture', () => {
    const a = picture(4, 4, (set) => set(0, 0, [9, 9, 9, 9]))
    expect(diffOverInk(a, picture(4, 4), 4, 4, 2).pixels).toBe(3 * 3)
  })
})

describe('framePath and siblingPath', () => {
  it('numbers a frame in writeTitleFrame\'s pattern, on either separator', () => {
    expect(framePath('/tmp/forge/clip.seq/%05d.png', 7)).toBe('/tmp/forge/clip.seq/00007.png')
    expect(framePath('C:\\Users\\a\\clip.seq\\%05d.png', 12345)).toBe('C:\\Users\\a\\clip.seq\\12345.png')
    expect(framePath('harness://x.seq/%05d.png', 0)).toBe('harness://x.seq/00000.png')
    expect(framePath('/no/pattern.png', 3)).toBe('/no/pattern.png')
  })

  it('names a file beside another, whichever separator the main process joined it with', () => {
    expect(siblingPath('/a/b/captions.txt', '00001.png')).toBe('/a/b/00001.png')
    expect(siblingPath('C:\\a\\b\\captions.txt', '00001.png')).toBe('C:\\a\\b\\00001.png')
  })
})

const same = (pixels = 100): PixelDiff => ({ mean: 0, max: 0, differing: 0, pixels })
const off = (mean: number, pixels = 100): PixelDiff => ({ mean, max: 255, differing: 1, pixels })

function reading(patch: Partial<PrimitivesReading> = {}): PrimitivesReading {
  return {
    bakeAgainstPreview: [same(), same()],
    canvasAgainstPreview: [same(), same()],
    heldAgainstLast: same(),
    outside: [{ max: 0, pixels: 0 }],
    drawnTwice: [same()],
    bakedTwice: { equal: 46, of: 46 },
    ...patch
  }
}

describe('primitivesVerdict (§6.12\'s phase 1 bar)', () => {
  it('passes readings that meet every part', () => {
    expect(primitivesVerdict(reading())).toEqual({ bake: true, held: true, outside: true, twice: true, pass: true })
  })

  it('allows the bake within 1/255 mean on BOTH routes, and not past it on either', () => {
    expect(primitivesVerdict(reading({ bakeAgainstPreview: [same(), off(1)] })).bake).toBe(true)
    expect(primitivesVerdict(reading({ bakeAgainstPreview: [same(), off(1.01)] })).bake).toBe(false)
    expect(primitivesVerdict(reading({ canvasAgainstPreview: [off(1.01), same()] })).bake).toBe(false)
    expect(primitivesVerdict(reading({ canvasAgainstPreview: [off(1.01), same()] })).pass).toBe(false)
  })

  it('wants the held end exactly the last moving frame', () => {
    expect(primitivesVerdict(reading({ heldAgainstLast: off(0.001) })).held).toBe(false)
  })

  it('wants no alpha at all outside the box', () => {
    expect(primitivesVerdict(reading({ outside: [{ max: 0, pixels: 0 }, { max: 1, pixels: 1 }] })).outside).toBe(false)
  })

  it('wants the spec drawn twice equal and every PNG of the two bakes byte-equal', () => {
    expect(primitivesVerdict(reading({ drawnTwice: [same(), { mean: 0, max: 1, differing: 1, pixels: 100 }] })).twice).toBe(false)
    expect(primitivesVerdict(reading({ bakedTwice: { equal: 45, of: 46 } })).twice).toBe(false)
  })

  it('passes nothing it did not read: no frame, no PNG, an empty held reading', () => {
    expect(primitivesVerdict(reading({ bakeAgainstPreview: [] })).bake).toBe(false)
    expect(primitivesVerdict(reading({ canvasAgainstPreview: [] })).bake).toBe(false)
    expect(primitivesVerdict(reading({ heldAgainstLast: same(0) })).held).toBe(false)
    expect(primitivesVerdict(reading({ outside: [] })).outside).toBe(false)
    expect(primitivesVerdict(reading({ drawnTwice: [] })).twice).toBe(false)
    expect(primitivesVerdict(reading({ bakedTwice: { equal: 0, of: 0 } })).twice).toBe(false)
  })
})

/* --------------------------------------------------- the Indic sites' reading */

describe('siteReading (the Indic render check\'s site half, §6.20)', () => {
  const base = { site: 'text clip' as const, call: 'renderTextPng', font: 'Montserrat', face: 'Noto Sans Devanagari' }
  const before = picture(4, 1, (set) => set(0, 0, [255, 255, 255, 255]))
  const after = picture(4, 1, (set) => set(1, 0, [255, 255, 255, 255]))

  it('sees the face loaded at the site when the frame equals the drawing after and differs from the one before', () => {
    const row = siteReading({ ...base, before: 'not loaded', after: 'loaded' }, after, before, after, 4, true)
    expect(row.seen).toBe(true)
  })

  it('does not see it when the frame is the drawing before, or when nothing changed', () => {
    expect(siteReading({ ...base, before: 'not loaded', after: 'loaded' }, before, before, after, 4, true).seen).toBe(false)
    expect(siteReading({ ...base, before: 'not loaded', after: 'loaded' }, before, before, before, 4, true).seen).toBe(false)
  })

  it('reads a face neither loaded nor failed after the site, with a catalogue there, as never asked for', () => {
    expect(siteReading({ ...base, before: 'not loaded', after: 'not loaded' }, before, before, before, 4, true).seen).toBe(false)
  })

  it('cannot tell without a catalogue, with the face loaded before, with the face failed, or with no frame', () => {
    expect(siteReading({ ...base, before: 'not loaded', after: 'not loaded' }, before, before, before, 4, false).seen).toBeNull()
    expect(siteReading({ ...base, before: 'loaded', after: 'loaded' }, after, before, after, 4, true).seen).toBeNull()
    expect(siteReading({ ...base, before: 'not loaded', after: 'failed (not in the catalog)' }, before, before, before, 4, true).seen).toBeNull()
    expect(siteReading({ ...base, before: 'not loaded', after: 'loaded' }, null, before, after, 4, true).seen).toBeNull()
  })
})

/* -------------------------------------------------------------- the options */

describe('the options are independent', () => {
  it('askedOptions names exactly the options passed, in run order', () => {
    expect(askedOptions({})).toEqual([])
    for (const name of GRAPHIC_CHECK_OPTIONS) {
      const options = { [name]: name === 'encode' ? { frames: 1 } : name === 'blur' ? { words: 1 } : true } as GraphicCheckOptions
      expect(askedOptions(options)).toEqual([name])
    }
    expect(askedOptions({ primitives: true, indic: true })).toEqual(['indic', 'primitives'])
    expect(askedOptions({ primitives: false, indic: undefined })).toEqual([])
  })

  /*
   * runGraphicCheck draws on a DOM canvas, so it is read as source: every
   * check it calls sits under the `if` of its own option, and nothing else.
   * Each call site is asserted, not the first (CLAUDE.md, "check what your
   * anchor matched").
   */
  it('runGraphicCheck runs each check only under its own option', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'src', 'harness', 'graphicCheck.ts'), 'utf8')
    const start = source.indexOf('export async function runGraphicCheck(')
    expect(start).toBeGreaterThan(0)
    const body = source.slice(start, source.indexOf('\n}\n', start))
    const owner: Record<string, string> = {
      checkEncode: 'encode',
      checkSegments: 'segments',
      checkBlur: 'blur',
      checkParity: 'parity',
      checkIndic: 'indic',
      checkIndicPhase1: 'indic',
      checkPrimitives: 'primitives'
    }
    const calls = [...body.matchAll(/\b(check[A-Z]\w*)\(/g)]
    expect(calls.map((c) => c[1]).sort()).toEqual(Object.keys(owner).sort())
    for (const call of calls) {
      const before = body.slice(0, call.index)
      const guard = [...before.matchAll(/if \(options\.(\w+)\)/g)].pop()
      expect(guard, `${call[1]} has no option guard`).toBeDefined()
      expect(guard![1], `${call[1]} runs under options.${guard![1]}`).toBe(owner[call[1]])
      // No other statement between the guard and the call: an `if` with a block ends at its `}`.
      const between = before.slice(guard!.index! + guard![0].length)
      expect(between.includes('\n  }\n') || between.includes('\n  if ('), `${call[1]} is outside its guard`).toBe(false)
    }
    for (const name of GRAPHIC_CHECK_OPTIONS) expect([...body.matchAll(new RegExp(`if \\(options\\.${name}\\)`, 'g'))], name).toHaveLength(1)
  })
})
