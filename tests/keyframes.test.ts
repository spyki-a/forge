import { describe, it, expect } from 'vitest'
import {
  normaliseKeys,
  valueAt,
  keyframeExpression,
  hasKeys,
  anyKeys,
  PROPERTY_INFO,
  KEYED_PROPERTIES,
  type Keyframe
} from '@shared/render/keyframes'
import { buildRenderPlan } from '@shared/render/plan'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'

const key = (frame: number, value: number, ease?: Keyframe['ease']): Keyframe => ({
  frame,
  value,
  ...(ease ? { ease } : {})
})

describe('normaliseKeys', () => {
  it('sorts by frame', () => {
    expect(normaliseKeys([key(30, 2), key(0, 1)], 60).map((k) => k.frame)).toEqual([0, 30])
  })

  it('keeps keys outside the clip where they are', () => {
    /*
     * This test used to assert the opposite — "clamps into the clip", on the
     * reasoning that a key past the end "would animate towards a value never
     * reached". That is exactly what SHOULD happen after a trim: the curve is
     * still heading for the key when the clip ends. Clamping squashed the key
     * onto the last frame, so a fade trimmed half-way arrived at its bottom
     * early. The test certified the distortion it was meant to prevent.
     */
    expect(normaliseKeys([key(-10, 1), key(999, 2)], 60).map((k) => k.frame)).toEqual([-10, 999])
  })

  it('evaluates the TRUE curve inside a clip whose keys run past its edges', () => {
    // A ramp from 0 at frame 0 to 1 at frame 100, seen through a clip only 50
    // frames long: at its last frame it is half-way, not at the top.
    const ramp = [key(0, 0), key(100, 1)]
    expect(valueAt(ramp, 50, 50, 0)).toBeCloseTo(0.5, 6)
    // And from the other side: keys before the clip still decide where it opens.
    expect(valueAt([key(-50, 0), key(50, 1)], 0, 50, 0)).toBeCloseTo(0.5, 6)
  })

  it('keeps the later of two keys at one frame', () => {
    // Two values at one instant is a contradiction, not an animation.
    const keys = normaliseKeys([key(10, 1), key(10, 5)], 60)
    expect(keys).toHaveLength(1)
    expect(keys[0].value).toBe(5)
  })

  it('does not mutate what it was given', () => {
    const original = [key(30, 2), key(0, 1)]
    normaliseKeys(original, 60)
    expect(original.map((k) => k.frame)).toEqual([30, 0])
  })
})

describe('valueAt', () => {
  const keys = [key(0, 0), key(60, 10)]

  it('interpolates linearly between keys', () => {
    expect(valueAt(keys, 0, 60, 0)).toBe(0)
    expect(valueAt(keys, 30, 60, 0)).toBeCloseTo(5)
    expect(valueAt(keys, 60, 60, 0)).toBe(10)
  })

  it('holds flat outside the keys rather than drifting', () => {
    const late = [key(20, 3), key(40, 7)]
    expect(valueAt(late, 0, 60, 99)).toBe(3)
    expect(valueAt(late, 60, 60, 99)).toBe(7)
  })

  it('falls back when there is nothing keyed', () => {
    expect(valueAt([], 10, 60, 1.5)).toBe(1.5)
  })

  it('treats a single key as a constant', () => {
    expect(valueAt([key(30, 4)], 0, 60, 99)).toBe(4)
    expect(valueAt([key(30, 4)], 60, 60, 99)).toBe(4)
  })

  describe('easing', () => {
    it('eases in and out with smooth, passing through the midpoint', () => {
      const smooth = [key(0, 0, 'smooth'), key(60, 10)]
      expect(valueAt(smooth, 30, 60, 0)).toBeCloseTo(5)
      // Slower at the start than linear.
      expect(valueAt(smooth, 15, 60, 0)).toBeLessThan(2.5)
      expect(valueAt(smooth, 45, 60, 0)).toBeGreaterThan(7.5)
    })

    it('does not move at all until the next key with hold', () => {
      const held = [key(0, 0, 'hold'), key(60, 10)]
      expect(valueAt(held, 30, 60, 0)).toBe(0)
      expect(valueAt(held, 59, 60, 0)).toBe(0)
      expect(valueAt(held, 60, 60, 0)).toBe(10)
    })
  })
})

describe('keyframeExpression', () => {
  const options = { durationFrames: 60, fps: 30, startSeconds: 0, fallback: 1 }

  it('is a plain number when nothing is keyed', () => {
    expect(keyframeExpression([], options)).toBe('1.0000')
  })

  it('is a plain number for a single key', () => {
    expect(keyframeExpression([key(30, 2)], options)).toBe('2.0000')
  })

  /*
   * A held key steps ON its frame, at every rate the app offers.
   *
   * This used to pin the text — `toContain('2.0000)')` for "the last segment
   * ends at t=2" — and that anchor matched the last key's VALUE, 2.0000, as
   * well as the time. The time was also the bug: `(frame/fps).toFixed(4)`
   * rounds frame 5 at 30 fps up to 0.1667, past the frame's own 0.16666…, so
   * the step came a frame late (CLIPS.md §3.2). What is asserted now is where
   * the curve steps, frame by frame; keyframes.int has it on rendered frames.
   * `t` is evaluated as ffmpeg forms it, the frame's pts times the time base.
   */
  it('steps a held key on its own frame, for a key on every frame, at 24, 25, 30, 50 and 60 fps', () => {
    for (const fps of [24, 25, 30, 50, 60]) {
      for (let at = 1; at <= 2 * fps; at++) {
        const expression = keyframeExpression([key(0, 0, 'hold'), key(at, 1)], { ...options, fps })
        expect(evaluate(expression, (at - 1) * (1 / fps)), `${fps} fps, frame ${at - 1}`).toBe(0)
        expect(evaluate(expression, at * (1 / fps)), `${fps} fps, frame ${at}`).toBe(1)
      }
    }
  })

  /*
   * The expression and the preview must agree.
   *
   * They are two implementations of one animation — the renderer evaluates the
   * string, the preview calls valueAt — and a drift between them is invisible
   * until an export comes back different from what was on screen. Every frame,
   * not every third: at 30 fps every third frame from 0 is a frame ≡ 0 (mod 3),
   * and the late step was on frames ≡ 2.
   */
  it('agrees with valueAt at every frame', () => {
    for (const fps of [24, 25, 30, 60]) {
      for (const keys of [
        [key(0, 1), key(60, 3)],
        [key(0, 1, 'smooth'), key(60, 3)],
        [key(0, 1, 'hold'), key(30, 3), key(60, 1)],
        [key(10, 0), key(20, 1), key(50, 0.25)],
        [key(0, 0, 'hold'), key(4, 1, 'hold'), key(5, 0, 'hold'), key(8, 1), key(11, 0, 'smooth'), key(17, 1)]
      ]) {
        const expression = keyframeExpression(keys, { ...options, fps })
        for (let frame = 0; frame <= 60; frame++) {
          const fromExpression = evaluate(expression, frame * (1 / fps))
          const fromPreview = valueAt(keys, frame, 60, 1)
          /*
           * To 0.005, not 0.0005: inside a segment its start and span are
           * still written to four places, so at 60 fps the frame AT the key
           * at 8 (start 0.1333 for 0.13333…) reads 0.99933 for 1 — a
           * fifth of one alpha level. A frame late is a whole step.
           */
          expect(fromExpression, `${fps} fps, frame ${frame}`).toBeCloseTo(fromPreview, 2)
        }
      }
    }
  })

  /*
   * The sound's segments end on the key's own instant.
   *
   * `volume` evaluates once per audio frame at that frame's start, a clock
   * that runs between video frames. Measured (EFFECTS.md §45): on the half
   * frame a held envelope came in up to 10.7 ms BEFORE its key; on the
   * instant it comes in at or after it, as it always has.
   */
  it('ends a segment on the key itself when the clock runs between frames', () => {
    const instant = keyframeExpression([key(0, 0, 'hold'), key(8, 1)], { ...options, boundary: 'instant' })
    expect(evaluate(instant, (8 - 0.25) / 30)).toBe(0)
    expect(evaluate(instant, 8 / 30 + 1e-4)).toBe(1)
    // The picture's default does step before it, on the half frame.
    expect(evaluate(keyframeExpression([key(0, 0, 'hold'), key(8, 1)], options), (8 - 0.25) / 30)).toBe(1)
  })

  it('gives the export’s volume envelope the instant, and its picture keys the half frame', () => {
    const asset: MediaAsset = {
      id: 'a', path: '/tmp/a.mp4', name: 'a.mp4', kind: 'video', durationFrames: 300,
      width: 64, height: 48, fps: 30, hasVideo: true, hasAudio: true, size: 0
    }
    const held = [key(0, 0, 'hold'), key(8, 1)]
    const clip: Clip = {
      id: 'c', assetId: 'a', trackId: 'v1', start: 0, duration: 30, inPoint: 0, volume: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      color: { brightness: 0, contrast: 1, saturation: 1 },
      keyframes: { volume: held, opacity: held }
    }
    const project: Project = { ...emptyProject(), settings: { width: 64, height: 48, fps: 30, sampleRate: 48000 }, assets: [asset], clips: [clip] }
    const args = buildRenderPlan({ project, outputPath: '/tmp/o.mp4' }).args
    const graph = args[args.indexOf('-filter_complex') + 1]
    const volumes = [...graph.matchAll(/volume=volume='([^']*)':eval=frame/g)]
    expect(volumes, 'one envelope').toHaveLength(1)
    // A quarter frame before the key: still held, on the sound's clock.
    expect(evaluate(volumes[0][1], (8 - 0.25) / 30)).toBe(0)
    expect(evaluate(volumes[0][1], 8 / 30 + 1e-4)).toBe(1)
    // The opacity on the same keys is the picture's: lit a quarter frame before.
    const alphas = [...graph.matchAll(/a='alpha\(X,Y\)\*\(([^']*)\)\/255'/g)]
    expect(alphas, 'one keyed opacity').toHaveLength(1)
    expect(evaluate(alphas[0][1].replace(/\bT\b/g, 't'), (8 - 0.25) / 30)).toBe(255)
  })

  it('offsets by where the clip sits on the timeline', () => {
    // `t` is timeline seconds, not clip seconds.
    const shifted = keyframeExpression([key(0, 1), key(60, 2)], { ...options, startSeconds: 5 })
    expect(evaluate(shifted, 5)).toBeCloseTo(1)
    expect(evaluate(shifted, 7)).toBeCloseTo(2)
  })

  it('maps values into the filter units', () => {
    // Alpha is 0..1 to the user and 0..255 to geq.
    const expression = keyframeExpression([key(0, 0), key(60, 1)], {
      ...options,
      transform: (v) => v * 255,
      precision: 1
    })
    expect(evaluate(expression, 2)).toBeCloseTo(255, 0)
  })
})

describe('hasKeys', () => {
  it('needs two keys — one is a value, not an animation', () => {
    expect(hasKeys({ zoom: [key(0, 1)] }, 'zoom')).toBe(false)
    expect(hasKeys({ zoom: [key(0, 1), key(30, 2)] }, 'zoom')).toBe(true)
  })

  it('is false for an absent track', () => {
    expect(hasKeys(undefined, 'opacity')).toBe(false)
    expect(anyKeys(undefined)).toBe(false)
  })

  it('spots any animated property', () => {
    expect(anyKeys({ rotation: [key(0, 0), key(10, 90)] })).toBe(true)
  })
})

describe('PROPERTY_INFO', () => {
  it('describes every property that can be keyed', () => {
    for (const property of KEYED_PROPERTIES) {
      const info = PROPERTY_INFO[property]
      expect(info.label.length).toBeGreaterThan(2)
      expect(info.neutral).toBeGreaterThanOrEqual(info.min)
      expect(info.neutral).toBeLessThanOrEqual(info.max)
    }
  })

  it('does not offer scale, which ffmpeg cannot animate', () => {
    // Measured: scale with eval=frame re-evaluates but does not follow its
    // expression. Offering it would be offering something wrong.
    expect(KEYED_PROPERTIES).not.toContain('scale')
  })
})

/**
 * A tiny evaluator for the subset of ffmpeg expression syntax this module emits:
 * if(), lt(), min(), max(), t, and arithmetic. Enough to check the renderer and
 * the preview compute the same curve.
 */
function evaluate(expression: string, t: number): number {
  const js = expression
    .replace(/\bif\(/g, 'IF(')
    .replace(/\blt\(/g, 'LT(')
    .replace(/\bmin\(/g, 'Math.min(')
    .replace(/\bmax\(/g, 'Math.max(')
    .replace(/\bt\b/g, String(t))
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    'IF',
    'LT',
    `return ${js}`
  ) as (IF: (c: number, a: number, b: number) => number, LT: (a: number, b: number) => number) => number
  return fn(
    (condition, whenTrue, whenFalse) => (condition ? whenTrue : whenFalse),
    (a, b) => (a < b ? 1 : 0)
  )
}
