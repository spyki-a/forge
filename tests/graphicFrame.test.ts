import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  BEAT_FRAME_ALLOWANCE,
  EDGE_SWEEP_S,
  EXIT_S,
  SCREEN_CARD_MOVE_S,
  SETTLE_S,
  beatFrame,
  drawnGraphicAsset,
  graphicExitKeys,
  graphicMovingFrames
} from '@shared/graphics/frame'
import { graphicTargetsAt } from '@shared/graphics/targets'
import { drawListAt, graphicFits } from '@shared/graphics/drawList'
import { DRAWERS } from '@shared/graphics/templates/index'
import { itemBounds, type DrawItem, type DrawList, type Drawer, type ShapeItem, type StrokeItem, type TextItem, type TextMeasure } from '@shared/graphics/items'
import { numberOf } from '@shared/graphics/numbers'
import { FIT_MIN, contentRect } from '@shared/graphics/templates/layout'
import { DURATIONS, progress, type MotionEase } from '@shared/graphics/motion'
import { resolveGraphicStyle, type GraphicStyle } from '@shared/graphics/style'
import type { GraphicData, GraphicSpec, GraphicTemplateId } from '@shared/graphics/template'
import { valueAt } from '@shared/render/keyframes'
import { seeded } from '@shared/render/moment'
import { subjectBoxesAt } from '@shared/reframe/frameMap'
import { SUBJECT_TRACK_VERSION, type FaceBox, type SubjectSample, type SubjectTrack, type UnitRect } from '@shared/reframe/types'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'

/*
 * docs/CLIPS.md §6.3, "Moving frames, the beat frame and the exit" and
 * "Targets": phase 1's cases of `graphicFrame` (§6.3's Tests passage, §6.11's
 * index). `graphicMovingFrames` from the beats and past the settle in its
 * three cases only; `beatFrame` at 24, 25, 30 and 60 fps with beats on and
 * between frames; an element's progress 1 on its beat frame and under 1 the
 * frame before; the seed drawn in a fixed order; the exit keys; the drawn
 * asset; and `graphicTargetsAt`'s subject, fixed at onset. Phase 2's cases
 * (§6.2) are at the foot, for the templates drawn so far (counter, ring, bars,
 * keyword, lower-third) over their fixtures; phase 3's (the screen card,
 * §6.16) are not here.
 */

const RATES = [24, 25, 30, 60]
const FPS = 30
const SIZE = { width: 1080, height: 1920 }

const clean = (): GraphicStyle => resolveGraphicStyle('clean')
const energetic = (): GraphicStyle => ({ ...clean(), energy: 'energetic' })
const glowing = (): GraphicStyle => ({ ...clean(), glow: { radius: 0.02, strength: 1 } })

/** Every template id as a Record, so one added to the type without a row here fails typecheck. */
const TEMPLATE_IDS: Record<GraphicTemplateId, true> = {
  counter: true,
  bars: true,
  steps: true,
  quote: true,
  callout: true,
  ring: true,
  keyword: true,
  'lower-third': true,
  'screen-card': true,
  timeline: true,
  'before-after': true,
  versus: true,
  source: true
}

function dataFor(template: GraphicTemplateId, connector: 'none' | 'line' | 'tree' = 'line'): GraphicData {
  if (template === 'steps') return { template, title: 'Steps', items: [{ label: 'one' }, { label: 'two' }, { label: 'three' }], connector }
  if (template === 'callout') return { template, label: 'here', shape: 'arrow' }
  if (template === 'counter') return { template, value: '40', label: 'forty' }
  if (template === 'ring') return { template, value: '40%', label: 'forty' }
  if (template === 'bars') return { template, title: 'Bars', items: [{ label: 'one', value: '10' }, { label: 'two', value: '20' }] }
  if (template === 'keyword') return { template, words: 'light beats gear', lit: 1 }
  if (template === 'lower-third') return { template, name: 'Priya Raman', role: 'Photographer' }
  return { template } as GraphicData
}

function spec(o: { template?: GraphicTemplateId; beats?: number[]; connector?: 'none' | 'line' | 'tree'; anchor?: true; seed?: number; subject?: GraphicSpec['subject'] } = {}): GraphicSpec {
  const s: GraphicSpec = {
    data: dataFor(o.template ?? 'counter', o.connector),
    seconds: 3,
    beats: o.beats ?? [1.0],
    place: { auto: true, third: 'middle' },
    seed: o.seed ?? 1,
    version: 0
  }
  if (o.anchor) s.anchor = { assetId: 'a', event: 'e1' }
  if (o.subject) s.subject = o.subject
  return s
}

/* --------------------------------------------------------------- beatFrame */

describe('beatFrame', () => {
  it('names the frame a beat sits on, that frame when the beat is a hair either side of it, and the next when the beat is between frames, at 24, 25, 30 and 60 fps', () => {
    for (const fps of RATES) {
      for (const frame of [0, 12, 31, 47]) {
        expect(beatFrame(frame / fps, fps), `on frame ${frame} at ${fps}`).toBe(frame)
        if (frame > 0) expect(beatFrame((frame - 1e-9) / fps, fps), `a hair before ${frame} at ${fps}`).toBe(frame)
        expect(beatFrame((frame + 0.9e-6) / fps, fps), `0.9e-6 of a frame after ${frame} at ${fps}`).toBe(frame)
        expect(beatFrame((frame + 0.37) / fps, fps), `a third past ${frame} at ${fps}`).toBe(frame + 1)
        expect(beatFrame((frame + 0.5) / fps, fps), `halfway past ${frame} at ${fps}`).toBe(frame + 1)
        expect(beatFrame((frame + 0.999) / fps, fps), `just short of ${frame + 1} at ${fps}`).toBe(frame + 1)
      }
    }
    expect(beatFrame(1.0, 30)).toBe(30)
    expect(beatFrame(1.5, 30)).toBe(45)
  })

  it('subtracts §6.3’s 1e-6 of a frame, no more: a beat 1.1e-6 of a frame after a frame’s time names the next frame', () => {
    expect(BEAT_FRAME_ALLOWANCE).toBe(1e-6)
    for (const fps of RATES) {
      expect(beatFrame((31 + 1.1e-6) / fps, fps), `at ${fps}`).toBe(32)
      expect(beatFrame((31 + 0.9e-6) / fps, fps), `at ${fps}`).toBe(31)
    }
  })

  it('is never below 0 and never −0: a beat at 0, before the start, not a number, or at no frame rate, names frame 0 exactly', () => {
    for (const fps of RATES) {
      expect(Object.is(beatFrame(0, fps), 0), `beat 0 at ${fps} is +0`).toBe(true)
      expect(Object.is(beatFrame(-0.4, fps), 0), `a beat before the start at ${fps}`).toBe(true)
      expect(Object.is(beatFrame(Number.NaN, fps), 0), `NaN at ${fps}`).toBe(true)
    }
    expect(Object.is(beatFrame(1, 0), 0)).toBe(true)
    expect(Object.is(beatFrame(1, Number.NaN), 0)).toBe(true)
    // `fps > 0` alone admits Infinity and names frame Infinity; the rate is refused as the beat is.
    expect(Object.is(beatFrame(1, Number.POSITIVE_INFINITY), 0)).toBe(true)
    expect(Object.is(beatFrame(Number.POSITIVE_INFINITY, 30), 0)).toBe(true)
  })

  it("an element's progress is 1 on its beat frame and under 1 on the frame before, through the real beatFrame, at every rate, beats on and between frames", () => {
    const eases: MotionEase[] = ['linear', 'out-cubic', 'expo-out', 'spring1', 'decelerate']
    for (const fps of RATES) {
      for (const frame of [12, 31, 47]) {
        for (const beat of [frame / fps, (frame - 1e-9) / fps, (frame + 0.9e-6) / fps, (frame + 0.37) / fps, (frame + 0.5) / fps]) {
          const named = beatFrame(beat, fps)
          for (const ease of eases) {
            const start = beat - DURATIONS.entrance
            const label = `${ease}, beat ${beat} at ${fps} fps names ${named}`
            expect(progress(named / fps, start, DURATIONS.entrance, ease), label).toBe(1)
            expect(progress((named - 1) / fps, start, DURATIONS.entrance, ease), `${label}, the frame before`).toBeLessThan(1)
          }
        }
      }
    }
  })

  it('MEASURED, not pinned: the open window between progress’s 1e-6 s and beatFrame’s 1e-6 of a frame (§6.3, §6.13’s Built note; the user’s)', () => {
    // A beat after frame 31 by 2e-6 of a frame: inside progress's 1e-6 s at every rate here, outside beatFrame's allowance.
    const rows: string[] = []
    for (const fps of RATES) {
      const beat = (31 + 2e-6) / fps
      const named = beatFrame(beat, fps)
      const before = progress((named - 1) / fps, beat - DURATIONS.entrance, DURATIONS.entrance, 'linear')
      rows.push(`${fps} fps: beatFrame ${named}, progress on ${named - 1} = ${before}`)
    }
    process.stderr.write(`graphicFrame: the allowance window, beat 2e-6 of a frame after frame 31: ${rows.join('; ')}\n`)
    expect(rows).toHaveLength(RATES.length)
  })
})

/* ---------------------------------------------------- graphicMovingFrames */

describe('graphicMovingFrames', () => {
  it('a beat at 1.0 s at 30 fps gives 46: the last frame baked is the first settled one (SETTLE_S 0.5, then + 1)', () => {
    expect(SETTLE_S).toBe(0.5)
    expect(graphicMovingFrames(spec({ beats: [1.0] }), clean(), 30, 90)).toBe(46)
    expect(graphicMovingFrames(spec({ beats: [0.5, 1.0] }), clean(), 30, 90)).toBe(46)
    expect(graphicMovingFrames(spec({ beats: [1.0, 0.5] }), clean(), 30, 90)).toBe(46)
    // At the other rates: beatFrame(1.5) + 1.
    expect(graphicMovingFrames(spec({ beats: [1.0] }), clean(), 24, 240)).toBe(37)
    expect(graphicMovingFrames(spec({ beats: [1.0] }), clean(), 25, 250)).toBe(39)
    expect(graphicMovingFrames(spec({ beats: [1.0] }), clean(), 60, 600)).toBe(91)
  })

  it('a last beat between frames settles on the frame after its settle, by ceil, not round', () => {
    // (31.37 / 30 + 0.5) × 30 = 46.37: ceil names 47, so 48 moving frames; round would name 46 and give 47.
    expect(graphicMovingFrames(spec({ beats: [(31 + 0.37) / 30] }), clean(), 30, 90)).toBe(48)
  })

  it('is capped at the clip, and 0 for no frames or no rate; a spec with no beats, or none finite, settles from its start', () => {
    expect(graphicMovingFrames(spec({ beats: [1.0] }), clean(), 30, 30)).toBe(30)
    expect(graphicMovingFrames(spec({ beats: [1.0] }), clean(), 30, 45)).toBe(45)
    expect(graphicMovingFrames(spec({ beats: [1.0] }), clean(), 30, 46)).toBe(46)
    expect(graphicMovingFrames(spec({ beats: [1.0] }), clean(), 30, 47)).toBe(46)
    expect(graphicMovingFrames(spec({ beats: [1.0] }), clean(), 30, 0)).toBe(0)
    expect(graphicMovingFrames(spec({ beats: [1.0] }), clean(), 0, 90)).toBe(0)
    expect(graphicMovingFrames(spec({ beats: [] }), clean(), 30, 90)).toBe(beatFrame(SETTLE_S, 30) + 1)
    // +Infinity is the one beat `> last` alone would take: `last` Infinity, beatFrame refuses it, and the clip gets 1 moving frame.
    expect(graphicMovingFrames(spec({ beats: [Number.NaN, -1, Number.POSITIVE_INFINITY] }), clean(), 30, 90)).toBe(beatFrame(SETTLE_S, 30) + 1)
  })

  it('runs past the settle for a steps with a line connector under the energetic style only: the travelling beam bakes the whole hold', () => {
    expect(graphicMovingFrames(spec({ template: 'steps', connector: 'line', beats: [1, 2] }), energetic(), 30, 240)).toBe(240)
    expect(graphicMovingFrames(spec({ template: 'steps', connector: 'line', beats: [1, 2] }), clean(), 30, 240)).toBe(76)
    expect(graphicMovingFrames(spec({ template: 'steps', connector: 'tree', beats: [1, 2] }), energetic(), 30, 240)).toBe(76)
    expect(graphicMovingFrames(spec({ template: 'steps', connector: 'none', beats: [1, 2] }), energetic(), 30, 240)).toBe(76)
    expect(clean().energy).toBe('restrained')
  })

  it('runs past the settle for a callout with an anchor only: its tip moves on every frame', () => {
    expect(graphicMovingFrames(spec({ template: 'callout', anchor: true }), clean(), 30, 90)).toBe(90)
    expect(graphicMovingFrames(spec({ template: 'callout' }), clean(), 30, 90)).toBe(46)
    expect(graphicMovingFrames(spec({ template: 'counter', anchor: true }), clean(), 30, 90)).toBe(46)
  })

  it('runs past the settle for a screen card under a style with glow: the landing plus one loop of the edge sweep, never the whole hold', () => {
    expect(SCREEN_CARD_MOVE_S).toBe(1.0)
    expect(EDGE_SWEEP_S).toBe(6)
    const card = spec({ template: 'screen-card', beats: [SCREEN_CARD_MOVE_S] })
    // 60 s cards: 211 at 30 fps (§6.16), and L + 1 + round(6 × fps) elsewhere.
    expect(graphicMovingFrames(card, glowing(), 30, 1800)).toBe(211)
    expect(graphicMovingFrames(card, glowing(), 24, 1440)).toBe(169)
    expect(graphicMovingFrames(card, glowing(), 25, 1500)).toBe(176)
    expect(graphicMovingFrames(card, glowing(), 60, 3600)).toBe(421)
    // Capped at a short card.
    expect(graphicMovingFrames(card, glowing(), 30, 100)).toBe(100)
    // Without glow the card settles as every graphic does: L + 1 plus the settle.
    expect(graphicMovingFrames(card, clean(), 30, 1800)).toBe(46)
    expect(clean().glow).toBeUndefined()
  })

  it('every other template, under the energetic style and a glowing one alike, settles from its beats', () => {
    for (const template of Object.keys(TEMPLATE_IDS) as GraphicTemplateId[]) {
      if (template === 'screen-card') continue
      const s = spec({ template, beats: [1.0], connector: 'line' })
      for (const style of [clean(), energetic(), glowing()]) {
        const got = graphicMovingFrames(s, style, 30, 240)
        if (template === 'steps' && style.energy === 'energetic') expect(got, `${template} ${style.energy}`).toBe(240)
        else expect(got, `${template} ${style.energy}${style.glow ? ' glow' : ''}`).toBe(46)
      }
    }
  })
})

/* ---------------------------------------------------------------- the seed */

describe('the seed is drawn in a fixed order', () => {
  const measure: TextMeasure = (text, look) => ({ width: text.length * look.px * 0.55, ascent: look.px * 0.8, descent: look.px * 0.2 })
  const look = { textStyleId: 'clean', font: 'Inter', px: 40, align: 'center' as const }
  /** The drawer's own list of what it jitters, in a fixed order: never `Object.keys(spec.data)`. */
  const JITTERED = ['value', 'label'] as const

  const fixedOrder: Drawer = (s) => {
    const rnd = seeded(s.seed)
    const data = s.data as Record<string, unknown>
    const items: DrawItem[] = JITTERED.map((key) => ({
      kind: 'text',
      id: key,
      opacity: 1,
      text: String(data[key]),
      look,
      box: { x: 100 + rnd() * 20, y: 200 + rnd() * 20, width: 400, height: 48 }
    }))
    return { items }
  }

  /** The mutation §6.3 names, as a drawer: seeded draws in key-insertion order. */
  const insertionOrder: Drawer = (s) => {
    const rnd = seeded(s.seed)
    const items: DrawItem[] = []
    for (const [key, value] of Object.entries(s.data)) {
      if (key === 'template') continue
      items.push({ kind: 'text', id: key, opacity: 1, text: String(value), look, box: { x: 100 + rnd() * 20, y: 200 + rnd() * 20, width: 400, height: 48 } })
    }
    return { items }
  }

  const a = spec({ seed: 7 })
  const b: GraphicSpec = { ...a, data: { label: 'forty', value: '40', template: 'counter' } }

  it('a spec whose object keys were inserted in another order draws the same list', () => {
    expect(Object.keys(a.data)).not.toEqual(Object.keys(b.data))
    expect(a.data).toEqual(b.data)
    const la = drawListAt(a, clean(), 10, FPS, SIZE, measure, undefined, fixedOrder)
    const lb = drawListAt(b, clean(), 10, FPS, SIZE, measure, undefined, fixedOrder)
    expect(lb).toEqual(la)
    expect(la.items.map((i) => i.id)).toEqual([...JITTERED])
  })

  it('and every template that lands in DRAWERS draws the same list for its data in either key order, on each of its frames', () => {
    /*
     * Empty in phase 1, so this runs nothing yet; each template commit of
     * phase 2 adds its row and is covered here by construction. §6.3's M5 is
     * the mutation each such commit must then check against this case: its
     * drawer made to draw `seeded` in key-insertion order (`Object.entries
     * (spec.data)`), as `insertionOrder` below does, must fail it.
     */
    for (const [template, drawer] of Object.entries(DRAWERS) as [GraphicTemplateId, Drawer][]) {
      const one = spec({ template, seed: 7 })
      const other: GraphicSpec = { ...one, data: Object.fromEntries(Object.entries(one.data).reverse()) as GraphicData }
      expect(Object.keys(other.data), template).toEqual(Object.keys(one.data).reverse())
      for (const frame of [0, 10, 45, 89]) {
        expect(drawListAt(other, clean(), frame, FPS, SIZE, measure, undefined, drawer), `${template} at frame ${frame}`).toEqual(
          drawListAt(one, clean(), frame, FPS, SIZE, measure, undefined, drawer)
        )
      }
    }
  })

  it('and the case can tell: the same two specs through a drawer that draws in key-insertion order differ', () => {
    const la = drawListAt(a, clean(), 10, FPS, SIZE, measure, undefined, insertionOrder)
    const lb = drawListAt(b, clean(), 10, FPS, SIZE, measure, undefined, insertionOrder)
    expect(lb).not.toEqual(la)
    const byId = (l: typeof la, id: string): DrawItem | undefined => l.items.find((i) => i.id === id)
    expect(byId(lb, 'value')).not.toEqual(byId(la, 'value'))
  })
})

/* ---------------------------------------------------------------- the exit */

describe('graphicExitKeys', () => {
  it('gives two opacity keys: 1 at durationFrames − round(EXIT_S × fps), leaving smooth, and 0 on the last frame, durationFrames − 1', () => {
    expect(EXIT_S).toBe(0.3)
    // 9 frames at 30 fps: 81..89 inclusive are the clip's last 0.3 s; 7 at 24, 8 at 25 (7.5 rounds up), 18 at 60.
    expect(graphicExitKeys(90, 30)).toEqual({ opacity: [{ frame: 81, value: 1, ease: 'smooth' }, { frame: 89, value: 0 }] })
    expect(graphicExitKeys(90, 24)).toEqual({ opacity: [{ frame: 83, value: 1, ease: 'smooth' }, { frame: 89, value: 0 }] })
    expect(graphicExitKeys(90, 25)).toEqual({ opacity: [{ frame: 82, value: 1, ease: 'smooth' }, { frame: 89, value: 0 }] })
    expect(graphicExitKeys(90, 60)).toEqual({ opacity: [{ frame: 72, value: 1, ease: 'smooth' }, { frame: 89, value: 0 }] })
    expect(graphicExitKeys(300, 30)).toEqual({ opacity: [{ frame: 291, value: 1, ease: 'smooth' }, { frame: 299, value: 0 }] })
  })

  it('read by the render’s own valueAt: whole until the fade starts, falling without a rise, exactly 0 on the last frame and never past the clip', () => {
    for (const fps of RATES) {
      const D = 4 * fps
      const keys = graphicExitKeys(D, fps).opacity!
      const first = keys[0].frame
      let prev = 1
      for (let f = 0; f < D; f++) {
        const v = valueAt(keys, f, D, 1)
        if (f <= first) expect(v, `${fps} fps, frame ${f}`).toBe(1)
        else expect(v, `${fps} fps, frame ${f}`).toBeLessThan(prev)
        prev = v
      }
      expect(valueAt(keys, D - 1, D, 1), `${fps} fps, the last frame`).toBe(0)
      expect(valueAt(keys, D - 2, D, 1), `${fps} fps, the frame before the last`).toBeGreaterThan(0)
      expect(keys[1].frame, `${fps} fps, the 0 key is on the clip`).toBe(D - 1)
      // The fade's frames, the 1 key's to the 0 key's inclusive, are the clip's last round(EXIT_S × fps).
      expect(keys[1].frame - keys[0].frame + 1, `${fps} fps, the span`).toBe(Math.round(EXIT_S * fps))
    }
  })

  it('a clip shorter than the exit fades from its first frame; a clip of one frame is shown whole', () => {
    expect(graphicExitKeys(5, 30)).toEqual({ opacity: [{ frame: 0, value: 1, ease: 'smooth' }, { frame: 4, value: 0 }] })
    expect(graphicExitKeys(2, 30)).toEqual({ opacity: [{ frame: 0, value: 1, ease: 'smooth' }, { frame: 1, value: 0 }] })
    expect(graphicExitKeys(1, 30)).toEqual({ opacity: [{ frame: 0, value: 1 }] })
    expect(graphicExitKeys(0, 30)).toEqual({ opacity: [{ frame: 0, value: 1 }] })
  })

  it('a duration or a rate that is not a positive number gets that same one key, never a key at frame NaN', () => {
    const whole = { opacity: [{ frame: 0, value: 1 }] }
    // Math.max(0, NaN) is NaN: a duration guarded that way gave two keys at frame NaN (measured 2026-10-30).
    expect(graphicExitKeys(Number.NaN, 30)).toEqual(whole)
    expect(graphicExitKeys(-5, 30)).toEqual(whole)
    expect(graphicExitKeys(Number.NEGATIVE_INFINITY, 30)).toEqual(whole)
    // And a rate of NaN, without its guard, put the 1 key at frame NaN and the 0 key on the last frame.
    expect(graphicExitKeys(90, Number.NaN)).toEqual(whole)
    expect(graphicExitKeys(90, 0)).toEqual(whole)
    expect(graphicExitKeys(90, -30)).toEqual(whole)
  })
})

/* --------------------------------------------------------------- the asset */

describe('drawnGraphicAsset', () => {
  it('is §6.3’s shape: graphic-asset-<clipId>, an empty path, an image of size 0 with no rate, video and no audio, the name and frames as given', () => {
    const asset: MediaAsset = drawnGraphicAsset('graphic-abc-12345', 1080, 1920, 300, 'counter — graphic')
    expect(asset).toEqual({
      id: 'graphic-asset-graphic-abc-12345',
      path: '',
      name: 'counter — graphic',
      kind: 'image',
      durationFrames: 300,
      size: 0,
      width: 1080,
      height: 1920,
      fps: null,
      hasVideo: true,
      hasAudio: false
    })
    expect(asset.id.startsWith('graphic-asset-')).toBe(true)
    expect(drawnGraphicAsset('x', 640, 360, 10, 'ring — graphic')).toMatchObject({ id: 'graphic-asset-x', width: 640, height: 360, durationFrames: 10, name: 'ring — graphic' })
  })
})

/* ------------------------------------------------------------- the targets */

interface Build {
  /** The file's upright size; the canvas is the same unless `canvas` says otherwise, so the mapping is the identity. */
  width: number
  height: number
  frames: number
  /** A sample's faces at `ms`, in units of the file; absent, no subject track. */
  faces?: (ms: number) => UnitRect[]
  clip?: Partial<Clip>
  tracksHidden?: boolean
  /** The project's own canvas when it is not the file's size. */
  canvas?: { width: number; height: number }
}

function track(b: Build, faces: (ms: number) => UnitRect[]): SubjectTrack {
  const endMs = Math.round((b.frames / FPS) * 1000)
  const samples: SubjectSample[] = []
  for (let ms = 0; ms < endMs; ms += 500) {
    const fs: FaceBox[] = faces(ms).map((f) => ({ ...f, score: 0.9 }))
    samples.push({ ms, faces: fs })
  }
  return {
    key: '123456:1700000000000',
    version: SUBJECT_TRACK_VERSION,
    width: b.width,
    height: b.height,
    durationMs: endMs,
    shots: [{ startMs: 0, endMs, score: 0 }],
    samples,
    perShot: [{}],
    detector: 'synthetic',
    scene: { threshold: 0.3, minShotMs: 500, backend: 'ffmpeg-select-rgb24' },
    at: '2026-10-30T00:00:00.000Z'
  }
}

/** A footage clip on V1 from frame 30, and the project at the file's own size. */
function setup(b: Build): { project: Project; footage: Clip; asset: MediaAsset } {
  const asset: MediaAsset = {
    id: 'a',
    path: '/media/talk.mp4',
    name: 'talk.mp4',
    kind: 'video',
    durationFrames: b.frames,
    width: b.width,
    height: b.height,
    fps: FPS,
    hasVideo: true,
    hasAudio: true,
    size: 123456
  }
  const footage: Clip = {
    id: 'c',
    assetId: 'a',
    trackId: 'v1',
    start: 30,
    duration: b.frames,
    inPoint: 0,
    volume: 1,
    transform: { ...DEFAULT_TRANSFORM },
    color: { ...DEFAULT_COLOR },
    ...b.clip
  }
  const base = emptyProject('targets')
  const project: Project = {
    ...base,
    settings: { ...base.settings, width: b.canvas?.width ?? b.width, height: b.canvas?.height ?? b.height, fps: FPS },
    tracks: b.tracksHidden ? base.tracks.map((t) => ({ ...t, hidden: true })) : base.tracks,
    assets: [asset],
    clips: [footage],
    subjects: b.faces ? { a: track(b, b.faces) } : {}
  }
  return { project, footage, asset }
}

const PORTRAIT: Build = { width: 1080, height: 1920, frames: 90 }

function expectRect(got: { x: number; y: number; width: number; height: number } | null | undefined, want: { x: number; y: number; width: number; height: number }): void {
  expect(got).not.toBeNull()
  expect(got).toBeDefined()
  expect(got!.x).toBeCloseTo(want.x, 6)
  expect(got!.y).toBeCloseTo(want.y, 6)
  expect(got!.width).toBeCloseTo(want.width, 6)
  expect(got!.height).toBeCloseTo(want.height, 6)
}

describe('graphicTargetsAt', () => {
  it("with spec.subject: the source box through the footage clip's mapping at the onset, in pixels of size, and scaled with size", () => {
    const { project } = setup(PORTRAIT)
    const s = spec({ subject: { clipId: 'c', box: { x: 0.25, y: 0.25, width: 0.5, height: 0.25 }, ms: 0 } })
    const got = graphicTargetsAt(project, { start: 40 }, s, 40, SIZE)
    expectRect(got.subject, { x: 270, y: 480, width: 540, height: 480 })
    const half = graphicTargetsAt(project, { start: 40 }, s, 40, { width: 540, height: 960 })
    expectRect(half.subject, { x: 135, y: 240, width: 270, height: 240 })
  })

  it('with spec.subject: null when the clip is gone, when the onset is not on it, or when the box is off screen', () => {
    const { project } = setup(PORTRAIT)
    const box = { x: 0.25, y: 0.25, width: 0.5, height: 0.25 }
    expect(graphicTargetsAt(project, { start: 40 }, spec({ subject: { clipId: 'nope', box, ms: 0 } }), 40, SIZE).subject).toBeNull()
    expect(graphicTargetsAt(project, { start: 10 }, spec({ subject: { clipId: 'c', box, ms: 0 } }), 10, SIZE).subject).toBeNull()
    expect(graphicTargetsAt(project, { start: 120 }, spec({ subject: { clipId: 'c', box, ms: 0 } }), 120, SIZE).subject).toBeNull()
    expect(graphicTargetsAt(project, { start: 119 }, spec({ subject: { clipId: 'c', box, ms: 0 } }), 119, SIZE).subject).not.toBeNull()
    expect(graphicTargetsAt(project, { start: 40 }, spec({ subject: { clipId: 'c', box: { x: 1.5, y: 0.2, width: 0.2, height: 0.2 }, ms: 0 } }), 40, SIZE).subject).toBeNull()
    expect(graphicTargetsAt(project, { start: 40 }, spec({ subject: { clipId: 'c', box, ms: 0 } }), 40, { width: 0, height: 1920 }).subject).toBeNull()
  })

  it('with spec.subject: null when the clip is not on a visible video track, as the export draws no such clip and the other route already answers', () => {
    const s = spec({ subject: { clipId: 'c', box: { x: 0.25, y: 0.25, width: 0.5, height: 0.25 }, ms: 0 } })
    // The same project, clip and onset give a box when the track shows.
    expect(graphicTargetsAt(setup(PORTRAIT).project, { start: 40 }, s, 40, SIZE).subject).not.toBeNull()
    // Measured before the guard (2026-10-30): both gave {108, 192, 216×384} for a 0.1/0.2 box.
    expect(graphicTargetsAt(setup({ ...PORTRAIT, tracksHidden: true }).project, { start: 40 }, s, 40, SIZE).subject).toBeNull()
    expect(graphicTargetsAt(setup({ ...PORTRAIT, clip: { trackId: 'nope' } }).project, { start: 40 }, s, 40, SIZE).subject).toBeNull()
    expect(graphicTargetsAt(setup({ ...PORTRAIT, clip: { trackId: 'a1' } }).project, { start: 40 }, s, 40, SIZE).subject).toBeNull()
  })

  it('both routes read the mapping through size, the frame being drawn, not the project’s own canvas', () => {
    // A landscape project holding the portrait file, drawn at a portrait size: through `size` the file fills the
    // frame and the mapping is the identity; through the project's 1920×1080 the file is pillarboxed and the
    // box would land at x 403 (measured 2026-10-30), a third of the way across.
    const face = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }
    const landscape: Build = { ...PORTRAIT, canvas: { width: 1920, height: 1080 }, faces: () => [face] }
    const { project } = setup(landscape)
    expect(project.settings.width).toBe(1920)
    const taken = graphicTargetsAt(project, { start: 40 }, spec({ subject: { clipId: 'c', box: face, ms: 0 } }), 40, SIZE)
    expectRect(taken.subject, { x: 108, y: 192, width: 216, height: 384 })
    const found = graphicTargetsAt(project, { start: 40 }, spec(), 40, SIZE)
    expectRect(found.subject, { x: 108, y: 192, width: 216, height: 576 })
  })

  it("without spec.subject: the union of the caption track's subject boxes under the onset, chin-extended, in pixels", () => {
    const { project } = setup({ ...PORTRAIT, faces: () => [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, { x: 0.5, y: 0.2, width: 0.2, height: 0.2 }] })
    const got = graphicTargetsAt(project, { start: 40 }, spec(), 40, SIZE)
    // Each face is extended downward by half its height (frameMap's CHIN_EXTENSION): 0.2 → 0.3 tall.
    // First: 108, 192, 216×576; second: 540, 384, 216×576; the union 108..756 by 192..960.
    expectRect(got.subject, { x: 108, y: 192, width: 648, height: 768 })
    const one = graphicTargetsAt(project, { start: 40 }, spec(), 40, { width: 540, height: 960 })
    expectRect(one.subject, { x: 54, y: 96, width: 324, height: 384 })
  })

  it('without spec.subject: fixed at onset, the clip’s first frame, whatever frame is asked, while the face itself moves', () => {
    const { project, footage, asset } = setup({ ...PORTRAIT, faces: (ms) => [{ x: 0.1 + ms / 10000, y: 0.1, width: 0.2, height: 0.2 }] })
    const onset = 40
    const at = graphicTargetsAt(project, { start: onset }, spec(), onset, SIZE)
    // Clip frame 10 shows source 350 ms (the frame's middle), whose nearest sample is 500 ms: x = 0.15, so 162 px.
    expectRect(at.subject, { x: 162, y: 192, width: 216, height: 576 })
    for (const f of [onset + 1, onset + 15, onset + 45, onset + 79]) {
      expect(graphicTargetsAt(project, { start: onset }, spec(), f, SIZE), `frame ${f}`).toEqual(at)
    }
    // The face did move: the track's own reader sees it elsewhere on a later frame.
    const later = subjectBoxesAt(project, footage, asset, SIZE, onset + 45)
    expect(later).toHaveLength(1)
    expect(later[0].x * SIZE.width).toBeGreaterThan(at.subject!.x + 100)
    // And a graphic whose onset is later takes that later face.
    const laterOnset = graphicTargetsAt(project, { start: onset + 45 }, spec(), onset + 45, SIZE)
    expect(laterOnset.subject!.x).toBeCloseTo(later[0].x * SIZE.width, 6)
  })

  it('without spec.subject: null with no track, no face near the onset, no clip under it, every track hidden, or an empty project', () => {
    expect(graphicTargetsAt(setup(PORTRAIT).project, { start: 40 }, spec(), 40, SIZE).subject).toBeNull()
    expect(graphicTargetsAt(setup({ ...PORTRAIT, faces: () => [] }).project, { start: 40 }, spec(), 40, SIZE).subject).toBeNull()
    expect(graphicTargetsAt(setup({ ...PORTRAIT, faces: () => [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }] }).project, { start: 10 }, spec(), 10, SIZE).subject).toBeNull()
    expect(graphicTargetsAt(setup({ ...PORTRAIT, faces: () => [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }], tracksHidden: true }).project, { start: 40 }, spec(), 40, SIZE).subject).toBeNull()
    expect(graphicTargetsAt(emptyProject('empty'), { start: 0 }, spec(), 0, SIZE).subject).toBeNull()
  })

  it('fills subject only: tip (§6.18) and screen (§6.16) are not phase 1’s', () => {
    const { project } = setup({ ...PORTRAIT, faces: () => [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }] })
    const got = graphicTargetsAt(project, { start: 40 }, spec(), 40, SIZE)
    expect(got.subject).not.toBeNull()
    expect(got.tip).toBeUndefined()
    expect(got.screen).toBeUndefined()
  })
})

/* ------------------------------------------------- phase 2: the templates */

/*
 * §6.2's Tests passage, `graphicFrame`'s phase-2 cases, for the five
 * templates drawn so far, over their fixtures in tests/fixtures/graphics/
 * specs.json (English, Hindi, Telugu each): at the settled frame the text
 * items are every `data` string verbatim and nothing else but the listed
 * fixed glyphs; each element arrives on its beat frame; the counting strings
 * are ≤ the value and in its own format; the ring's `%` only when the value
 * lacks one; keyword's words as said, `lit` a colour and an underline
 * reaching 1 on the beat frame; lower-third's name and role as typed; the
 * list at the last moving frame deep-equals the list at the clip's last
 * frame. The fake measure is phase 1's (a width per UTF-16 unit).
 */

interface Fixture {
  id: string
  shape: string
  language: 'en' | 'hi' | 'te'
  spec: GraphicSpec
}

const FIXTURES = (
  JSON.parse(readFileSync(new URL('./fixtures/graphics/specs.json', import.meta.url), 'utf8')) as { specs: Fixture[] }
).specs
const DRAWN = ['counter', 'ring', 'bars', 'keyword', 'lower-third']
const DRAWN_FIXTURES = FIXTURES.filter((f) => DRAWN.includes(f.shape))

const fakeMeasure: TextMeasure = (text, look) => ({ width: text.length * look.px * 0.55, ascent: look.px * 0.8, descent: look.px * 0.2 })

const totalOf = (s: GraphicSpec, fps: number): number => Math.max(1, Math.round(s.seconds * fps))
const listAt = (s: GraphicSpec, frame: number, fps = FPS, size = SIZE, style = clean()): DrawList =>
  drawListAt(s, style, frame, fps, size, fakeMeasure)
/** The settled frame: the last the bake draws, `graphicMovingFrames` − 1. */
const settledFrame = (s: GraphicSpec, fps = FPS): number => graphicMovingFrames(s, clean(), fps, totalOf(s, fps)) - 1

function flat(items: readonly DrawItem[]): DrawItem[] {
  return items.flatMap((item) => (item.kind === 'group' ? flat(item.children) : [item]))
}
const textsOf = (list: DrawList): TextItem[] => flat(list.items).filter((i): i is TextItem => i.kind === 'text')
const byId = <T extends DrawItem>(list: DrawList, id: string): T => {
  const found = flat(list.items).filter((i) => i.id === id)
  expect(found, `one item ${id}`).toHaveLength(1)
  return found[0] as T
}
/** A field's drawn string: its pieces in reading order, joined by single spaces (a wrapped line or a word per piece). */
function fieldText(list: DrawList, path: string): string | null {
  const pieces = textsOf(list)
    .filter((t) => t.source?.path === path)
    .sort((a, b) => a.source!.piece - b.source!.piece)
  return pieces.length === 0 ? null : pieces.map((t) => t.text).join(' ')
}
const normalised = (s: string): string => s.split(/\s+/).filter((w) => w.length > 0).join(' ')

/** Every drawn `data` field of a fixture, by its source path, as the painter must draw it at the settled frame. */
function expectedFields(data: GraphicData): Record<string, string> {
  switch (data.template) {
    case 'counter':
      return { 'data.value': data.value, 'data.label': data.label }
    case 'ring':
      // §6.2's one added glyph: `%`, only when the value carries neither `%` nor a percent word.
      return { 'data.value': /%|\bper\s?cent\b/i.test(data.value) ? data.value : `${data.value}%`, 'data.label': data.label }
    case 'bars': {
      const out: Record<string, string> = { 'data.title': data.title }
      data.items.forEach((item, i) => {
        out[`data.items.${i}.label`] = item.label
        out[`data.items.${i}.value`] = item.value
      })
      return out
    }
    case 'keyword':
      return { 'data.words': normalised(data.words) }
    case 'lower-third':
      return data.role === '' ? { 'data.name': data.name } : { 'data.name': data.name, 'data.role': data.role }
    default:
      throw new Error(`not drawn yet: ${data.template}`)
  }
}

/* The value's own format, read independently of numbers.ts: its digit block, its grouping, its prefix and suffix. */
const ZEROS = [0x30, 0x966, 0xc66]
const zeroOf = (ch: string): number | null => {
  const c = ch.codePointAt(0)!
  for (const z of ZEROS) if (c >= z && c <= z + 9) return z
  return null
}
function shapeOf(value: string): { prefix: string; body: string; suffix: string; zero: number | null } {
  const chars = Array.from(value)
  const first = chars.findIndex((c) => zeroOf(c) !== null)
  if (first < 0) return { prefix: value, body: '', suffix: '', zero: null }
  let end = chars.length
  while (end > first && zeroOf(chars[end - 1]) === null) end--
  return { prefix: chars.slice(0, first).join(''), body: chars.slice(first, end).join(''), suffix: chars.slice(end).join(''), zero: zeroOf(chars[first]) }
}
const toAscii = (body: string, zero: number): string => Array.from(body).map((c) => (zeroOf(c) === zero ? String(c.codePointAt(0)! - zero) : c)).join('')
const INDIAN = /^\d{1,2}(,\d{2})*,\d{3}$|^\d{1,3}$/
const WESTERN = /^\d{1,3}(,\d{3})*$/
/** Whether `drawn` is written in `value`'s own format: the same prefix, suffix and digit block, and the value's grouping (Indian, western or none). */
function inOwnFormat(drawn: string, value: string): boolean {
  const v = shapeOf(value)
  const d = shapeOf(drawn)
  if (v.zero === null) return drawn === value
  if (d.prefix !== v.prefix || d.suffix !== v.suffix || d.zero !== v.zero) return false
  if (Array.from(d.body).some((c) => c !== ',' && c !== '.' && zeroOf(c) !== v.zero)) return false
  const vi = toAscii(v.body, v.zero).split('.')
  const di = toAscii(d.body, v.zero).split('.')
  if ((vi[1] ?? '').length !== (di[1] ?? '').length) return false
  const grouped = vi[0].includes(',')
  const indian = grouped && /^\d{1,2}(,\d{2})+,\d{3}$/.test(vi[0])
  if (!grouped) return !di[0].includes(',')
  return indian ? INDIAN.test(di[0]) : WESTERN.test(di[0])
}

/** The counting fields of a fixture: the value text item's id and the value it counts to. */
function countingOf(data: GraphicData): { id: string; value: string; beat: number }[] {
  if (data.template === 'counter' || data.template === 'ring') return [{ id: 'value', value: data.value, beat: 0 }]
  if (data.template === 'bars') return data.items.map((item, i) => ({ id: `value-${i}`, value: item.value, beat: i }))
  return []
}

describe('graphicFrame, phase 2: the five templates drawn so far, over their fixtures (§6.2)', () => {
  it('has the fifteen fixtures of the five templates, each drawn by its own DRAWERS row', () => {
    expect(DRAWN_FIXTURES).toHaveLength(15)
    for (const f of DRAWN_FIXTURES) {
      expect(DRAWERS[f.spec.data.template], f.id).toBeDefined()
      expect(listAt(f.spec, 0).items.length, f.id).toBeGreaterThan(0)
    }
  })

  it('at the settled frame, the text items are every data string verbatim (a per-word or wrapped field’s pieces joined) and nothing else but the ring’s % glyph', () => {
    for (const f of DRAWN_FIXTURES) {
      const list = listAt(f.spec, settledFrame(f.spec))
      const want = expectedFields(f.spec.data)
      for (const [path, text] of Object.entries(want)) expect(fieldText(list, path), `${f.id} ${path}`).toBe(text)
      // Nothing else: every text item belongs to one of those fields.
      for (const t of textsOf(list)) expect(Object.keys(want), `${f.id}: ${t.id} "${t.text}"`).toContain(t.source?.path)
      // And every text item is fully shown, untransformed, at the settled frame.
      for (const t of textsOf(list)) {
        expect(t.opacity, `${f.id} ${t.id}`).toBe(1)
        expect(t.transform, `${f.id} ${t.id}`).toBeUndefined()
      }
    }
  })

  it('the settled list lies inside the content rect, at 9:16 and at 16:9', () => {
    for (const size of [SIZE, { width: 1920, height: 1080 }]) {
      for (const f of DRAWN_FIXTURES) {
        const list = listAt(f.spec, settledFrame(f.spec), FPS, size)
        const rect = contentRect(f.spec.place, size)
        expect(list.items.length, `${f.id} at ${size.width}×${size.height}: drawn`).toBeGreaterThan(0)
        for (const item of list.items) {
          if (item.kind === 'dim') continue
          // A shape's or text's own box (the text's ink reach is the style's, not the layout's).
          const box = item.kind === 'stroke' ? itemBounds(item, size)! : (item as ShapeItem | TextItem).box
          const label = `${f.id} ${item.id} at ${size.width}×${size.height}`
          expect(box.x, label).toBeGreaterThanOrEqual(rect.x - 1e-6)
          expect(box.y, label).toBeGreaterThanOrEqual(rect.y - 1e-6)
          expect(box.x + box.width, label).toBeLessThanOrEqual(rect.x + rect.width + 1e-6)
          expect(box.y + box.height, label).toBeLessThanOrEqual(rect.y + rect.height + 1e-6)
        }
      }
    }
  })

  it('each element arrives on its beat frame and not the frame before, at 24, 25, 30 and 60 fps', () => {
    for (const fps of RATES) {
      for (const f of DRAWN_FIXTURES) {
        const s = f.spec
        const data = s.data
        const at = (frame: number): DrawList => listAt(s, frame, fps)
        const arrives = (beat: number, read: (l: DrawList) => number, settled: number, what: string): void => {
          const bf = beatFrame(beat, fps)
          expect(read(at(bf)), `${f.id} ${what} on its beat frame ${bf} at ${fps}`).toBe(settled)
          expect(read(at(bf - 1)), `${f.id} ${what} the frame before, ${bf - 1}, at ${fps}`).toBeLessThan(settled)
        }
        if (data.template === 'counter') {
          const bf = beatFrame(s.beats[0], fps)
          for (let frame = bf; frame < totalOf(s, fps); frame++) expect(byId<TextItem>(at(frame), 'value').text, `${f.id} frame ${frame} at ${fps}`).toBe(data.value)
        }
        if (data.template === 'ring') {
          const share = numberOf(data.value)! / 100
          arrives(s.beats[0], (l) => byId<ShapeItem>(l, 'arc').sweep!, share, 'arc')
          expect(byId<TextItem>(at(beatFrame(s.beats[0], fps)), 'value').text, `${f.id} value at ${fps}`).toBe(data.value)
        }
        if (data.template === 'bars') {
          const largest = Math.max(...data.items.map((i) => numberOf(i.value)!))
          data.items.forEach((item, i) => {
            const full = byId<ShapeItem>(at(0), `track-${i}`).box.width * (numberOf(item.value)! / largest)
            arrives(s.beats[i], (l) => byId<ShapeItem>(l, `bar-${i}`).box.width, full, `bar-${i}`)
            arrives(s.beats[i], (l) => byId<TextItem>(l, `label-${i}`).opacity, 1, `label-${i}`)
            expect(byId<TextItem>(at(beatFrame(s.beats[i], fps)), `value-${i}`).text, `${f.id} value-${i} at ${fps}`).toBe(item.value)
          })
        }
        if (data.template === 'keyword') {
          const words = normalised(data.words).split(' ')
          arrives(s.beats[0], (l) => byId<StrokeItem>(l, 'underline').to, 1, 'underline')
          arrives(s.beats[0], (l) => byId<TextItem>(l, `word-${words.length - 1}`).opacity, 1, 'the last word')
          arrives(s.beats[0], (l) => byId<ShapeItem>(l, 'panel').opacity, clean().palette.panelOpacity, 'the card')
        }
        if (data.template === 'lower-third') {
          const full = byId<ShapeItem>(at(settledFrame(s, fps)), 'bar').box.width
          arrives(s.beats[0], (l) => byId<ShapeItem>(l, 'bar').box.width, full, 'bar')
          arrives(s.beats[0], (l) => byId<TextItem>(l, 'name').opacity, 1, 'name')
          // The role follows 0.1 s later (§6.2's proposal).
          if (data.role !== '') arrives(s.beats[0] + 0.1, (l) => byId<TextItem>(l, 'role').opacity, 1, 'role')
        }
      }
    }
  })

  it('a counter whose in-between strings differ from the value lands on its beat frame, not a frame later', () => {
    // 10,00,000 has an in-between string on the frame before its beat at every rate; a short value may round to itself earlier (measured).
    const f = DRAWN_FIXTURES.find((x) => x.id === 'counter-en')!
    for (const fps of RATES) {
      const bf = beatFrame(f.spec.beats[0], fps)
      expect(byId<TextItem>(listAt(f.spec, bf - 1, fps), 'value').text, `at ${fps}`).not.toBe('10,00,000')
      expect(byId<TextItem>(listAt(f.spec, bf, fps), 'value').text, `at ${fps}`).toBe('10,00,000')
    }
  })

  it("the counting strings before the beat are ≤ the value and in the value's own format: 10,00,000 through Indian groups, ₹ kept, Devanagari and Telugu digits kept", () => {
    const seen = new Set<string>()
    for (const fps of RATES) {
      for (const f of DRAWN_FIXTURES) {
        for (const c of countingOf(f.spec.data)) {
          const bf = beatFrame(f.spec.beats[c.beat], fps)
          const target = numberOf(c.value)!
          for (let frame = 0; frame < bf; frame++) {
            let text = byId<TextItem>(listAt(f.spec, frame, fps), c.id).text
            if (f.spec.data.template === 'ring' && !/%|\bper\s?cent\b/i.test(c.value)) text = text.slice(0, -1)
            expect(numberOf(text), `${f.id} ${c.id} frame ${frame} at ${fps}: "${text}"`).not.toBeNull()
            expect(numberOf(text)!, `${f.id} ${c.id} frame ${frame} at ${fps}: "${text}"`).toBeLessThanOrEqual(target)
            expect(inOwnFormat(text, c.value), `${f.id} ${c.id} frame ${frame} at ${fps}: "${text}" in the format of "${c.value}"`).toBe(true)
            seen.add(text)
          }
        }
      }
    }
    // The cases the plan names were actually drawn: an Indian group of six digits or more, ₹ under 500, Devanagari digits.
    expect([...seen].some((t) => /^\d,\d\d,\d{3}$/.test(t)), 'an Indian-grouped in-between').toBe(true)
    expect([...seen].some((t) => /^₹[1-4]\d\d$/.test(t)), '₹ through the hundreds').toBe(true)
    expect([...seen].some((t) => /^[०-९]+%$/.test(t) && t !== '४०%'), 'Devanagari in-between').toBe(true)
    expect([...seen].some((t) => /^[౦-౯]+$/.test(t) && t !== '౩౦౦'), 'Telugu in-between').toBe(true)
  })

  it('the ring draws % only when its value lacks one: never on a value with % or "percent", always on a bare number', () => {
    for (const f of DRAWN_FIXTURES.filter((x) => x.shape === 'ring')) {
      for (let frame = 0; frame < totalOf(f.spec, FPS); frame++) {
        const text = byId<TextItem>(listAt(f.spec, frame), 'value').text
        expect(text.endsWith('%%'), `${f.id} frame ${frame}: "${text}"`).toBe(false)
        if (/percent/.test((f.spec.data as { value: string }).value)) expect(text.includes('%'), `${f.id} frame ${frame}: "${text}"`).toBe(false)
      }
      expect(byId<TextItem>(listAt(f.spec, settledFrame(f.spec)), 'value').text, f.id).toBe((f.spec.data as { value: string }).value)
    }
    const bare: GraphicSpec = { ...DRAWN_FIXTURES.find((x) => x.id === 'ring-te')!.spec, data: { template: 'ring', value: '75', label: 'bare' } }
    expect(byId<TextItem>(listAt(bare, settledFrame(bare)), 'value').text).toBe('75%')
    // And a counter never takes one, whatever its value.
    const counter: GraphicSpec = { ...bare, data: { template: 'counter', value: '40', label: 'bare' } }
    expect(byId<TextItem>(listAt(counter, settledFrame(counter)), 'value').text).toBe('40')
  })

  it('keyword draws its words as said; lit changes the lit word’s colour and no text, and its underline spans the lit word', () => {
    for (const f of DRAWN_FIXTURES.filter((x) => x.shape === 'keyword')) {
      const data = f.spec.data as Extract<GraphicData, { template: 'keyword' }>
      const words = normalised(data.words).split(' ')
      const texts: string[][] = []
      for (let lit = 0; lit < words.length; lit++) {
        const s: GraphicSpec = { ...f.spec, data: { ...data, lit } }
        const list = listAt(s, settledFrame(s))
        const drawn = textsOf(list)
        texts.push(drawn.map((t) => t.text))
        expect(drawn.map((t) => t.text), `${f.id} lit ${lit}`).toEqual(words)
        drawn.forEach((t, i) => {
          expect(t.id, `${f.id}`).toBe(`word-${i}`)
          expect(t.source, `${f.id} word-${i}`).toEqual({ path: 'data.words', piece: i })
          expect(t.look.accent, `${f.id} lit ${lit} word-${i}`).toBe(i === lit ? clean().palette.accent : undefined)
        })
        const underline = byId<StrokeItem>(list, 'underline')
        const box = drawn[lit].box
        const xs = [...underline.d.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[1]))
        expect(xs, `${f.id} lit ${lit}: the underline's two points`).toHaveLength(2)
        expect(Math.min(...xs), `${f.id} lit ${lit}`).toBeCloseTo(box.x, 6)
        expect(Math.max(...xs), `${f.id} lit ${lit}`).toBeCloseTo(box.x + box.width, 6)
        expect(underline.color).toBe(clean().palette.accent)
        expect(underline.heads).toBeUndefined()
        expect(underline.cap).toBe('round')
      }
      // The words themselves never change with lit.
      for (const t of texts) expect(t).toEqual(texts[0])
    }
  })

  it('lower-third draws the name exactly as the speaker holds it and the role as typed, with no glyph, and no role item when the role is empty', () => {
    for (const f of DRAWN_FIXTURES.filter((x) => x.shape === 'lower-third')) {
      const data = f.spec.data as Extract<GraphicData, { template: 'lower-third' }>
      const list = listAt(f.spec, settledFrame(f.spec))
      expect(textsOf(list).map((t) => t.text), f.id).toEqual([data.name, data.role])
      const none: GraphicSpec = { ...f.spec, data: { ...data, role: '' } }
      const without = listAt(none, settledFrame(none))
      expect(textsOf(without).map((t) => t.text), f.id).toEqual([data.name])
      expect(flat(without.items).some((i) => i.id === 'role'), f.id).toBe(false)
    }
  })

  it('per fixture, the list at the last moving frame deep-equals the list at the clip’s last frame, at every rate', () => {
    for (const fps of RATES) {
      for (const f of DRAWN_FIXTURES) {
        const total = totalOf(f.spec, fps)
        const last = settledFrame(f.spec, fps)
        expect(last, `${f.id} at ${fps}`).toBeLessThan(total)
        expect(listAt(f.spec, last, fps), `${f.id} at ${fps}`).toEqual(listAt(f.spec, total - 1, fps))
      }
    }
  })

  it('item ids are stable: every frame of a fixture draws the same ids in the same order', () => {
    for (const f of DRAWN_FIXTURES) {
      const ids = flat(listAt(f.spec, settledFrame(f.spec)).items).map((i) => i.id)
      expect(new Set(ids).size, `${f.id}: unique`).toBe(ids.length)
      for (let frame = 0; frame < totalOf(f.spec, FPS); frame++) expect(flat(listAt(f.spec, frame).items).map((i) => i.id), `${f.id} frame ${frame}`).toEqual(ids)
    }
  })

  it('with style.dim, every list opens with the dim, its hole round the onset subject and none without one; it fades in over DURATIONS.dim', () => {
    const dimmed: GraphicStyle = { ...clean(), dim: true }
    const subject = { x: 300, y: 500, width: 400, height: 500 }
    for (const f of DRAWN_FIXTURES) {
      const withHole = drawListAt(f.spec, dimmed, 0, FPS, SIZE, fakeMeasure, { subject })
      expect(withHole.items[0].kind, f.id).toBe('dim')
      expect(withHole.items[0].opacity, f.id).toBeLessThan(0.01)
      expect((withHole.items[0] as Extract<DrawItem, { kind: 'dim' }>).hole?.box, f.id).toEqual(subject)
      const settled = drawListAt(f.spec, dimmed, beatFrame(DURATIONS.dim, FPS), FPS, SIZE, fakeMeasure, { subject: null })
      expect(settled.items[0].kind, f.id).toBe('dim')
      expect(settled.items[0].opacity, f.id).toBe(1)
      expect((settled.items[0] as Extract<DrawItem, { kind: 'dim' }>).hole, f.id).toBeUndefined()
      expect(listAt(f.spec, 0).items.some((i) => i.kind === 'dim'), `${f.id}: clean does not dim`).toBe(false)
    }
  })

  it('too big: a field that cannot fit at FIT_MIN drops the graphic (an empty list, graphicFits false); one that fits only smaller is scaled, never below FIT_MIN', () => {
    expect(FIT_MIN).toBe(0.6)
    const base = DRAWN_FIXTURES.find((x) => x.id === 'counter-en')!.spec
    const long: GraphicSpec = { ...base, data: { template: 'counter', value: '1,23,45,67,89,01,23,45,678', label: 'views' } }
    expect(listAt(long, 0).items).toEqual([])
    expect(graphicFits(long, clean(), SIZE, fakeMeasure)).toBe(false)
    expect(graphicFits(base, clean(), SIZE, fakeMeasure)).toBe(true)
    // A value wider than the wrap at the table's 0.11 but not at 0.6 of it: drawn smaller.
    const wide: GraphicSpec = { ...base, data: { template: 'counter', value: '1,23,45,67,890', label: 'views' } }
    const value = byId<TextItem>(listAt(wide, settledFrame(wide)), 'value')
    expect(value.look.px).toBeLessThan(Math.round(0.11 * 1080))
    expect(value.look.px).toBeGreaterThanOrEqual(Math.round(0.11 * 1080 * FIT_MIN) - 1)
  })
})
