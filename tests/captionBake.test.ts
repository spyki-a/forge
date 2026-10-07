import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { activeWordOf, concatList, planBakeOf, planCaptionBake } from '@shared/captions/bake'
import { captionSpec } from '@shared/captions/line'
import { styleById } from '@shared/captions/style'
import { animationBounds, TEXT_ANIMATIONS, textAnimationById } from '@shared/render/textAnimation'
import type { CaptionLayer, GraphicsSpec } from '@shared/graphics/spec'
import type { Word } from '@shared/transcript'

/*
 * Planning a caption bake.
 *
 * Styled captions have to be drawn rather than burned in, so the only question
 * that matters is how little can be drawn. Two facts do the work: a caption is
 * mostly STILL between one word lighting and the next, and it occupies a band
 * rather than a frame. This is where the first of those is turned into numbers,
 * so the saving can be asserted instead of assumed.
 */

const POP = styleById('pop')
const FPS = 30

function words(list: [string, number, number][]): Word[] {
  return list.map(([text, startMs, endMs], index) => ({
    index,
    text,
    startMs,
    endMs,
    confidence: 1
  }))
}

function layer(
  id: string,
  startFrame: number,
  endFrame: number,
  wordFrames: number[],
  animationId?: string
): CaptionLayer {
  const w = words(wordFrames.map((_, i) => [`w${i}`, i * 400, i * 400 + 400]))
  return {
    id,
    kind: 'caption',
    startFrame,
    endFrame,
    spec: captionSpec({ ...POP, animationId }, w, -1),
    wordFrames,
    highlight: { color: POP.highlightColor, scale: POP.highlightScale }
  }
}

describe('activeWordOf', () => {
  const line = layer('a', 0, 90, [0, 30, 60])

  it('lights the word whose turn it is', () => {
    expect(activeWordOf(line, 0)).toBe(0)
    expect(activeWordOf(line, 29)).toBe(0)
    expect(activeWordOf(line, 30)).toBe(1)
    expect(activeWordOf(line, 75)).toBe(2)
  })

  it('lights nothing before the first word', () => {
    expect(activeWordOf(layer('a', 10, 90, [10, 40]), 5)).toBe(-1)
  })
})

/** Which layer is on screen at a frame, by walking the run-length back out. */
function layerAt(plan: NonNullable<ReturnType<typeof planCaptionBake>>, frame: number): number {
  let at = 0
  for (const run of plan.runs) {
    if (frame < at + run.frames) return plan.pictures[run.picture].layer
    at += run.frames
  }
  return -1
}

describe('planCaptionBake', () => {
  it('draws one picture per word, not one per frame', () => {
    /*
     * The whole reason this is affordable. A three-word line on screen for three
     * seconds is 90 frames and three pictures — the rest of the frames are the
     * same picture again, and the concat demuxer holds them.
     */
    const plan = planCaptionBake([layer('a', 0, 90, [0, 30, 60])], FPS, 90)!
    // Three words, plus the blank that every gap reuses.
    expect(plan.pictures).toHaveLength(4)
    expect(plan.totalFrames).toBe(90)
  })

  it('covers every frame of the timeline exactly once', () => {
    // A run-length that did not add up would shift every caption after the gap.
    const plan = planCaptionBake([layer('a', 10, 70, [10, 40])], FPS, 120)!
    expect(plan.runs.reduce((sum, r) => sum + r.frames, 0)).toBe(120)
  })

  it('reuses one blank for every gap', () => {
    const plan = planCaptionBake(
      [layer('a', 0, 20, [0]), layer('b', 60, 80, [60])],
      FPS,
      120
    )!
    const blanks = plan.pictures.filter((p) => p.layer === -1)
    expect(blanks).toHaveLength(1)
    // Before the first line, between the two, and after the second.
    const blankRuns = plan.runs.filter((r) => plan.pictures[r.picture].layer === -1)
    expect(blankRuns.length).toBeGreaterThanOrEqual(2)
  })

  it('never emits two identical runs back to back', () => {
    // Adjacent identical runs would be two entries where one would do, and would
    // mean the run-length merge is not working at all.
    const plan = planCaptionBake([layer('a', 0, 60, [0, 30])], FPS, 90)!
    for (let i = 1; i < plan.runs.length; i++) {
      expect(plan.runs[i].picture).not.toBe(plan.runs[i - 1].picture)
    }
  })

  it('bakes the moving frames of an animation and then holds', () => {
    const still = planCaptionBake([layer('a', 0, 90, [0, 30, 60])], FPS, 90)!
    const moving = planCaptionBake([layer('a', 0, 90, [0, 30, 60], 'pop')], FPS, 90)!
    // An animation costs more pictures — that is what an animation IS — but far
    // fewer than one per frame.
    expect(moving.pictures.length).toBeGreaterThan(still.pictures.length)
    expect(moving.pictures.length).toBeLessThan(90 / 2)
  })

  it('stops making new pictures once the movement settles', () => {
    const plan = planCaptionBake([layer('a', 0, 300, [0], 'pop')], FPS, 300)!
    // One word, one animation, ten seconds on screen: the pictures are bounded
    // by the length of the move, not by the length of the caption.
    expect(plan.pictures.length).toBeLessThan(30)
  })

  it('has nothing to do for an empty timeline', () => {
    expect(planCaptionBake([], FPS, 90)).toBeNull()
    expect(planCaptionBake([layer('a', 0, 10, [0])], FPS, 0)).toBeNull()
  })

  it('lets a later line win where two overlap', () => {
    // Two lines live at once would be two captions drawn on top of each other.
    const plan = planCaptionBake(
      [layer('a', 0, 60, [0]), layer('b', 30, 90, [30])],
      FPS,
      90
    )!
    expect(layerAt(plan, 10)).toBe(0)
    // From frame 30 both are live, and the one that just arrived is the one to
    // show — the other has been read already.
    expect(layerAt(plan, 40)).toBe(1)
    expect(layerAt(plan, 80)).toBe(1)
  })
})

describe('planBakeOf', () => {
  /*
   * The step between the spec and the pictures, shared by the renderer's
   * bakeCaptions and the render checks that stand in for its painting. Its
   * length is the export's length: the bake is overlaid `shortest=1`, so a
   * plan that stopped at the last line stopped the export there (EFFECTS.md
   * §42, §43; the render check is tests/integration/captionBakeLength).
   */
  const spec = (durationFrames: number, layers: GraphicsSpec['layers']): GraphicsSpec => ({
    width: 1080, height: 1920, fps: FPS, durationFrames, layers
  })

  it('plans over the whole spec, not to the last line', () => {
    // Two lines that end at frame 60, in an edit that runs to 120.
    const lines = [layer('a', 0, 20, [0]), layer('b', 40, 60, [40])]
    const baked = planBakeOf(spec(120, lines))!
    expect(Math.max(...lines.map((l) => l.endFrame))).toBeLessThan(120)
    expect(baked.plan.totalFrames).toBe(120)
    expect(baked.plan.runs.reduce((sum, r) => sum + r.frames, 0)).toBe(120)
    // The frames after the last line are the blank, which is already a picture.
    expect(baked.plan.pictures[baked.plan.runs[baked.plan.runs.length - 1].picture].layer).toBe(-1)
  })

  it('hands back the caption lines the plan indexes, and only those', () => {
    const lines = [layer('a', 0, 20, [0]), layer('b', 40, 60, [40])]
    // A picture layer between them is not the bake's to draw.
    const picture: GraphicsSpec['layers'][number] = {
      id: 'logo', kind: 'image', src: 'forge-media://logo.png', startFrame: 10, endFrame: 50,
      anchorX: 0.5, anchorY: 0.5, width: 100, height: 100,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }
    }
    const baked = planBakeOf(spec(120, [lines[0], picture, lines[1]]))!
    expect(baked.layers).toEqual(lines)
    for (const picture of baked.plan.pictures) {
      if (picture.layer >= 0) expect(baked.layers[picture.layer]).toBeDefined()
    }
  })

  it('has nothing to bake without a caption line', () => {
    expect(planBakeOf(spec(120, []))).toBeNull()
  })
})

describe('bakeCaptions plans through planBakeOf', () => {
  /*
   * bakeCaptions needs a DOM canvas, so no test can run it, and the render
   * checks stand in for it by calling planBakeOf. That guards the export's
   * length only while the renderer gets its plan the same way, from the spec
   * as buildGraphicsSpec built it. A bake planned to the last line in here
   * would bring §43's truncation back with every render check green.
   */
  const source = readFileSync(resolve(__dirname, '../src/renderer/src/captionBake.ts'), 'utf8')

  it('takes its plan from planBakeOf over the built spec, and plans nothing itself', () => {
    expect([...source.matchAll(/const spec = buildGraphicsSpec\(project, canvas\)/g)]).toHaveLength(1)
    const calls = [...source.matchAll(/\bplanBakeOf\(([^)]*)\)/g)].map((m) => m[1].trim())
    expect(calls, 'planBakeOf calls in captionBake.ts, by argument').toEqual(['spec'])
    expect([...source.matchAll(/\bplanCaptionBake\(/g)], 'planCaptionBake called directly').toHaveLength(0)
  })
})

describe('concatList', () => {
  const plan = planCaptionBake([layer('a', 0, 60, [0, 30])], FPS, 90)!
  const text = concatList(plan, FPS, (p) => `/tmp/${p}.png`)

  it('gives every run a file and a duration', () => {
    const files = text.split('\n').filter((l) => l.startsWith('file '))
    const durations = text.split('\n').filter((l) => l.startsWith('duration '))
    // One file per run, plus the repeat of the last.
    expect(files).toHaveLength(plan.runs.length + 1)
    expect(durations).toHaveLength(plan.runs.length)
  })

  it('repeats the final entry, because concat drops the last duration', () => {
    // A documented quirk of the demuxer. Without the repeat the closing run —
    // often the longest — is simply not shown.
    const files = text.split('\n').filter((l) => l.startsWith('file '))
    expect(files[files.length - 1]).toBe(files[files.length - 2])
  })

  it('adds up to the length of the timeline', () => {
    const total = text
      .split('\n')
      .filter((l) => l.startsWith('duration '))
      .reduce((sum, l) => sum + Number(l.slice(9)), 0)
    expect(total).toBeCloseTo(90 / FPS, 4)
  })
})

describe('animationBounds', () => {
  it('catches an overshoot that the endpoints hide', () => {
    /*
     * Pop settles at scale 1 and starts at 0.4, but passes ~1.07 on the way — so
     * reading only at(0) and at(1) would under-measure it, and the baked band
     * would clip the words at their largest.
     */
    const pop = textAnimationById('pop')!
    expect(animationBounds(pop).scale).toBeGreaterThan(1)
    expect(pop.at(1).scale).toBeCloseTo(1, 2)
  })

  it('reports how far every animation throws a piece', () => {
    for (const animation of TEXT_ANIMATIONS) {
      const bounds = animationBounds(animation)
      expect(bounds.dx, animation.id).toBeGreaterThanOrEqual(0)
      expect(bounds.dy, animation.id).toBeGreaterThanOrEqual(0)
      expect(bounds.scale, animation.id).toBeGreaterThanOrEqual(1)
      // A band is only worth baking if the travel is bounded.
      expect(bounds.dy, animation.id).toBeLessThan(3)
      expect(bounds.scale, animation.id).toBeLessThan(3)
    }
  })

  it('finds no travel in an animation that only fades', () => {
    const fade = textAnimationById('fade')!
    const bounds = animationBounds(fade)
    expect(bounds.dx).toBe(0)
    expect(bounds.dy).toBe(0)
    expect(bounds.scale).toBe(1)
  })
})
