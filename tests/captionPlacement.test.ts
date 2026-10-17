import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTimelineCaptions } from '@shared/captions/timeline'
import { buildGraphicsSpec } from '@shared/graphics/fromTimeline'
import { captionSpec } from '@shared/captions/line'
import { groupWords, toAssTime } from '@shared/captions/ass'
import { assTimeMs, captionLineFrame, firstShownWord, libassLineFrame, lineThird, type Third, type ThirdLookup } from '@shared/captions/placement'
import { captionsHaveSubjects, smartPlacement, smartPlacementState } from '@shared/captions/smart'
import { resolveStyle } from '@shared/captions/style'
import { SUBJECT_TRACK_VERSION, type SubjectTrack, type UnitRect } from '@shared/reframe/types'
import { SIDECAR_METHODS } from '@shared/sidecar/protocol'
import type { SidecarStatus } from '@shared/sidecar/status'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { segmentIntoSentences, type Word } from '@shared/transcript'

/*
 * Smart placement on every caption route (docs/CLIPS.md §5.4): one lookup
 * (captions/smart.ts), asked at the frame each route shows a line on, so the
 * libass cues, the canvas bake's layers and the preview put each line in the
 * same third — and with placement absent or 'style', nothing moves anywhere.
 *
 * The file is the canvas's own shape (1080×1920 on 1080×1920) with nothing
 * cropped, so a face's source units are its frame units. Shot 1 (0–3 s) has a
 * face in the lower third — extended to y 0.70–0.88, it covers 0.108 of it,
 * past the 0.05 the style's own third may carry — so its lines go to the
 * middle (nothing there; middle before top on a tie). Shot 2 (3–6 s) has it in
 * the upper third, so its lines stay at the bottom.
 */

const FPS = 30
const CANVAS = { width: 1080, height: 1920 }
const STYLE = resolveStyle('pop', {})
const LOW: UnitRect = { x: 0.4, y: 0.7, width: 0.2, height: 0.12 }
const HIGH: UnitRect = { x: 0.4, y: 0.1, width: 0.2, height: 0.12 }

function words(list: [string, number, number][]): Word[] {
  return list.map(([text, startMs, endMs], index) => ({ index, text, startMs, endMs, confidence: 1 }))
}

/** Three lines: one in shot 1, one that starts in shot 1 and runs over the cut, one in shot 2. */
const WORDS = words([
  ['One', 500, 800], ['two', 800, 1100], ['three.', 1100, 1500],
  ['Seven', 2600, 2900], ['eight', 2900, 3200], ['nine.', 3200, 3400],
  ['Four', 3500, 3800], ['five', 3800, 4100], ['six.', 4100, 4500]
])

function subjectTrack(): SubjectTrack {
  const samples = []
  for (let ms = 0; ms < 6000; ms += 500) samples.push({ ms, faces: [{ ...(ms < 3000 ? LOW : HIGH), score: 0.9 }] })
  return {
    key: '123456:1700000000000',
    version: SUBJECT_TRACK_VERSION,
    width: 1080,
    height: 1920,
    durationMs: 6000,
    shots: [
      { startMs: 0, endMs: 3000, score: 0 },
      { startMs: 3000, endMs: 6000, score: 0.9 }
    ],
    samples,
    perShot: [{}, {}],
    detector: 'synthetic',
    scene: { threshold: 0.3, minShotMs: 500, backend: 'ffmpeg-select-rgb24' },
    at: '2026-10-16T00:00:00.000Z'
  }
}

function project(
  placement: 'style' | 'smart' | undefined,
  patch: Partial<Clip> = {},
  options: { track?: boolean; size?: { width: number; height: number } } = {}
): { project: Project; clip: Clip } {
  const size = options.size ?? { width: 1080, height: 1920 }
  const asset: MediaAsset = {
    id: 'a', path: '/media/a.mp4', name: 'a.mp4', kind: 'video', durationFrames: 180,
    width: size.width, height: size.height, fps: FPS, hasVideo: true, hasAudio: true, size: 1
  }
  const base = emptyProject('placement')
  const trackId = base.tracks.find((t) => t.kind === 'video')!.id
  const clip: Clip = {
    id: 'c', assetId: 'a', trackId, start: 30, duration: 180, inPoint: 0, volume: 1,
    transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR }, ...patch
  }
  return {
    clip,
    project: {
      ...base,
      settings: { ...base.settings, ...CANVAS, fps: FPS },
      assets: [asset],
      clips: [clip],
      subjects: options.track === false ? {} : { a: subjectTrack() },
      transcripts: {
        a: { assetId: 'a', language: 'en', model: 'test', durationMs: 6000, words: WORDS, segments: segmentIntoSentences(WORDS) }
      },
      captions: { enabled: true, styleId: 'pop', overrides: {}, ...(placement ? { placement } : {}) }
    }
  }
}

const GROUPS = groupWords(segmentIntoSentences(WORDS), WORDS, STYLE.wordsPerLine)

/** Each line's alignment tag on the libass route, or '' for none: the head of its events' text, one per line (all its events agree). */
function assThirds(ass: string): string[] {
  const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'))
  const heads = events.map((l) => /,,(\{\\an\d\})?\{\\c&H/.exec(l)?.[1] ?? '')
  // Three words a line, one event a word.
  expect(heads).toHaveLength(9)
  const lines = [heads.slice(0, 3), heads.slice(3, 6), heads.slice(6, 9)]
  for (const line of lines) expect(new Set(line).size, 'every event of a line sits where the line does').toBe(1)
  return lines.map((line) => line[0])
}

const TAG: Record<Third, string> = { top: '{\\an8}', middle: '{\\an5}', bottom: '' }
const POSITION: Record<Third, string> = { top: 'top', middle: 'center', bottom: 'lower' }

describe('smartPlacement', () => {
  it('is null unless the project asks for smart: absent, style, and anything else', () => {
    expect(smartPlacement(project(undefined).project, STYLE, CANVAS)).toBeNull()
    expect(smartPlacement(project('style').project, STYLE, CANVAS)).toBeNull()
    const odd = project('smart').project
    expect(smartPlacement({ ...odd, captions: { ...odd.captions, placement: 'Smart' as 'smart' } }, STYLE, CANVAS)).toBeNull()
    expect(smartPlacement(odd, STYLE, CANVAS)).toBeTypeOf('function')
  })

  it('answers by shot, in project frames: the cut at 3 s is frame 30 + 90', () => {
    const lookup = smartPlacement(project('smart').project, STYLE, CANVAS)!
    expect([lookup(30), lookup(119), lookup(120), lookup(209)]).toEqual(['middle', 'middle', 'bottom', 'bottom'])
    // Outside the clip nothing covers the frame: the style's.
    expect([lookup(29), lookup(210)]).toEqual([null, null])
  })
})

describe('the three routes put each line in the same third', () => {
  const expected: Third[] = ['middle', 'middle', 'bottom']

  for (const [name, patch] of [
    ['a clip at frame 30 from its first frame', {}],
    ['a clip trimmed to start half a second in', { inPoint: 15, duration: 150 }]
  ] as [string, Partial<Clip>][]) {
    // One `it` per route, so a route that drops the placement fails alone while the others pass.
    describe(name, () => {
      const { project: p, clip } = project('smart', patch)
      const lookup = (): ThirdLookup => smartPlacement(p, STYLE, CANVAS)!
      const layers = () => buildGraphicsSpec(p, CANVAS)!.layers.filter((l) => l.kind === 'caption')

      it('libass, as main/captions.ts builds it: shot 1\'s lines and the one over the cut \\an5, shot 2\'s untagged', () => {
        expect(assThirds(buildTimelineCaptions(p, STYLE, CANVAS, lookup())!)).toEqual(expected.map((t) => TAG[t]))
      })

      it('the canvas bake: the same lines centred, the last one in the lower third', () => {
        expect(layers().map((l) => (l.kind === 'caption' ? l.spec.position : ''))).toEqual(expected.map((t) => POSITION[t]))
      })

      it('the preview: each line\'s third as Preview.tsx asks it, for either export route', () => {
        expect(GROUPS.map((g) => lineThird(lookup(), clip, FPS, g, 'libass'))).toEqual(expected)
        expect(GROUPS.map((g) => lineThird(lookup(), clip, FPS, g, 'canvas'))).toEqual(expected)
      })

      it('on whole frames all three ask at the same frame, the one the line appears on: the layer\'s startFrame', () => {
        const asked: number[] = []
        const inner = lookup()
        buildTimelineCaptions(p, STYLE, CANVAS, (frame) => (asked.push(frame), inner(frame)))
        expect(asked).toEqual(layers().map((l) => l.startFrame))
        expect(GROUPS.map((g) => captionLineFrame(clip, FPS, firstShownWord(g, clip, FPS)!.startMs))).toEqual(asked)
        expect(GROUPS.map((g) => libassLineFrame(clip, FPS, firstShownWord(g, clip, FPS)!.startMs))).toEqual(asked)
      })
    })
  }

  it('moves nothing on any route with placement absent or the style\'s', () => {
    for (const placement of [undefined, 'style'] as const) {
      const { project: p, clip } = project(placement)
      const lookup = smartPlacement(p, STYLE, CANVAS)
      expect(lookup).toBeNull()
      expect(buildTimelineCaptions(p, STYLE, CANVAS, lookup)).toBe(buildTimelineCaptions(p, STYLE, CANVAS))
      expect(assThirds(buildTimelineCaptions(p, STYLE, CANVAS)!)).toEqual(['', '', ''])
      const layers = buildGraphicsSpec(p, CANVAS)!.layers.filter((l) => l.kind === 'caption')
      layers.forEach((layer, i) => {
        if (layer.kind !== 'caption') throw new Error('not a caption layer')
        expect(layer.spec).toEqual(captionSpec(STYLE, GROUPS[i], -1))
      })
      for (const route of ['libass', 'canvas'] as const) expect(GROUPS.map((g) => lineThird(lookup, clip, FPS, g, route))).toEqual([null, null, null])
    }
  })

  it('moves nothing with smart on but no track to read: every line keeps the style\'s third', () => {
    const { project: p } = project('smart', {}, { track: false })
    const lookup = smartPlacement(p, STYLE, CANVAS)!
    expect(assThirds(buildTimelineCaptions(p, STYLE, CANVAS, lookup)!)).toEqual(['', '', ''])
    const layers = buildGraphicsSpec(p, CANVAS)!.layers
    expect(layers.map((l) => (l.kind === 'caption' ? l.spec.position : ''))).toEqual(['lower', 'lower', 'lower'])
  })
})

/**
 * Where the bundled ffmpeg's `ass` burn first drew a cue starting at each ms
 * on the timeline, by frame rate — measured 2026-10-16 through buildRenderPlan
 * (a black 640×360 timeline, one filled box per cue, every frame decoded in
 * order; macOS 4.1.5 build). Every cue first shows on its centisecond time
 * rounded UP to a frame; the canvas bake rounds to the nearest.
 */
const LIBASS_FIRST_FRAME: Record<number, [number, number][]> = {
  24: [[2950, 71], [2960, 72], [2970, 72], [2980, 72], [2990, 72], [3000, 72], [3010, 73], [3020, 73], [3030, 73], [3040, 73], [3050, 74], [3060, 74], [3330, 80], [3340, 81], [3350, 81], [4000, 96], [4010, 97], [4160, 100], [4170, 101]],
  25: [[2950, 74], [2960, 74], [2970, 75], [2980, 75], [2990, 75], [3000, 75], [3010, 76], [3020, 76], [3030, 76], [3040, 76], [3050, 77], [3060, 77], [3330, 84], [3340, 84], [3350, 84], [4000, 100], [4010, 101], [4160, 104], [4170, 105]],
  30: [[2950, 89], [2960, 89], [2966, 89], [2967, 89], [2970, 90], [2980, 90], [2990, 90], [3000, 90], [3010, 91], [3030, 91], [3033, 91], [3034, 91], [3040, 92], [3060, 92], [3066, 92], [3067, 92], [3070, 93], [3330, 100], [3333, 100], [3334, 100], [3340, 101], [4000, 120], [4010, 121]],
  60: [[2950, 177], [2960, 178], [2970, 179], [2980, 179], [2990, 180], [3000, 180], [3010, 181], [3020, 182], [3030, 182], [3040, 183], [3050, 183], [3060, 184], [3330, 200], [3340, 201], [3350, 201], [4000, 240], [4010, 241], [4160, 250], [4170, 251]]
}

describe('a line that starts part-way through the frame before a cut (§5.2 rule 4, per route)', () => {
  it('libassLineFrame is the frame the bundled libass first draws a cue on, at every measured rate', () => {
    for (const [fps, rows] of Object.entries(LIBASS_FIRST_FRAME)) {
      // A clip from frame 0 at in-point 0: the source ms is the timeline's.
      const clip = { start: 0, inPoint: 0, duration: 10_000 }
      expect(rows.map(([ms]) => libassLineFrame(clip, Number(fps), ms)), `${fps} fps`).toEqual(rows.map(([, frame]) => frame))
      // Through a clip at frame 30 that plays from in-point 24, the same source ms is 6 frames later on the timeline
      // (6 frames is whole centiseconds at each of these rates — 250, 240, 200 and 100 ms — so the cue keeps its place in its frame).
      const moved = { start: 30, inPoint: 24, duration: 10_000 }
      expect(rows.map(([ms]) => libassLineFrame(moved, Number(fps), ms)), `${fps} fps, moved`).toEqual(rows.map(([, frame]) => frame + 6))
    }
    // The bake's rounding differs on these: 2970 and 2980 ms at 30 fps are frame 89 there, 90 on libass.
    expect([2970, 2980].map((ms) => captionLineFrame({ start: 0, inPoint: 0, duration: 10_000 }, 30, ms))).toEqual([89, 89])
  })

  it('assTimeMs is the time toAssTime writes', () => {
    const parse = (t: string): number => {
      const [h, m, s] = t.split(':')
      return (Number(h) * 3600 + Number(m) * 60) * 1000 + Math.round(Number(s) * 1000)
    }
    for (let ms = -20; ms < 4_000_000; ms += ms < 20_000 ? 0.25 : 997.3) expect(parse(toAssTime(ms)), `${ms}`).toBe(assTimeMs(ms))
  })

  /** The fixture's project with one line, "Late start.", whose first word is at 2975 ms: 0.75 of a frame before the cut. */
  const late = (patch: Partial<Clip>): { project: Project; clip: Clip } => {
    const { project: p, clip } = project('smart', patch)
    const spoken = words([['Late', 2975, 3300], ['start.', 3300, 3600]])
    return { clip, project: { ...p, transcripts: { a: { ...p.transcripts.a, words: spoken, segments: segmentIntoSentences(spoken) } } } }
  }

  for (const [name, patch, cut] of [
    ['a clip at frame 30 from its first frame', {}, 120],
    ['a clip trimmed to start half a second in', { inPoint: 15, duration: 150 }, 105]
  ] as [string, Partial<Clip>, number][]) {
    it(`${name}: libass first draws it on the cut's frame and takes shot 2's third; the bake shows it a frame before and takes shot 1's`, () => {
      const { project: p, clip } = late(patch)
      const lookup = smartPlacement(p, STYLE, CANVAS)!
      expect([lookup(cut - 1), lookup(cut)], 'the cut').toEqual(['middle', 'bottom'])
      const asked: number[] = []
      const ass = buildTimelineCaptions(p, STYLE, CANVAS, (frame) => (asked.push(frame), lookup(frame)))!
      expect(asked, 'libass asks at the frame it first draws the cue on').toEqual([cut])
      // Shot 2's face is high: the line stays at Pop's own bottom, untagged — not \an5 over the new shot.
      const heads = ass.split('\n').filter((l) => l.startsWith('Dialogue:')).map((l) => /,,(\{\\an\d\})?\{\\c&H/.exec(l)?.[1] ?? '')
      expect(heads).toEqual(['', ''])
      const layers = buildGraphicsSpec(p, CANVAS)!.layers
      expect(layers.map((l) => [l.startFrame, l.kind === 'caption' ? l.spec.position : '']), 'the bake shows it from the frame before').toEqual([[cut - 1, 'center']])
      const group = groupWords(p.transcripts.a.segments, p.transcripts.a.words, STYLE.wordsPerLine)[0]
      expect([lineThird(lookup, clip, FPS, group, 'libass'), lineThird(lookup, clip, FPS, group, 'canvas')], 'the preview, as each route').toEqual(['bottom', 'middle'])
    })
  }
})

describe('the Smart placement toggle\'s state', () => {
  const ready = (methods: string[]): SidecarStatus =>
    ({ state: 'ready', source: 'pack', hello: { protocol: 1, version: 'test', python: '3.12', capabilities: methods } }) as unknown as SidecarStatus
  const failed = { state: 'failed', source: 'pack', message: 'no' } as unknown as SidecarStatus

  it('has a track when a clip the captions come from has one the placement can read', () => {
    expect(captionsHaveSubjects(project('smart').project)).toBe(true)
    expect(captionsHaveSubjects(project('smart', {}, { track: false }).project)).toBe(false)
    // A track for another size of file is not this file's (frameMap's subjectTrackOf).
    expect(captionsHaveSubjects(project('smart', {}, { size: { width: 720, height: 1280 } }).project)).toBe(false)
  })

  it('is ready with a track whatever the helper, no-track with a helper that finds faces, else greyed', () => {
    const withTrack = project('style').project
    const without = project('style', {}, { track: false }).project
    expect(smartPlacementState(withTrack, null)).toBe('ready')
    expect(smartPlacementState(withTrack, failed)).toBe('ready')
    expect(smartPlacementState(without, ready([SIDECAR_METHODS.faces]))).toBe('no-track')
    // A helper without the face finder cannot make a track.
    expect(smartPlacementState(without, ready(['audio.beats']))).toBe('needs-helper')
    expect(smartPlacementState(without, failed)).toBe('needs-helper')
    expect(smartPlacementState(without, { state: 'starting' } as unknown as SidecarStatus)).toBe('helper-starting')
    expect(smartPlacementState(without, null)).toBe('helper-starting')
  })
})

describe('each route is handed the lookup', () => {
  const source = (path: string): string => readFileSync(resolve(__dirname, '..', path), 'utf8')

  it('the export\'s libass step passes smartPlacement to its one buildTimelineCaptions', () => {
    const main = source('src/main/captions.ts')
    const calls = [...main.matchAll(/buildTimelineCaptions\(([^\n]*)\)\n/g)]
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toBe('project, style, canvas, smartPlacement(project, style, canvas)')
  })

  it('the preview asks for the line on screen with its memoised lookup, and repaints when it changes', () => {
    const preview = source('src/renderer/src/components/Preview.tsx')
    const draws = [...preview.matchAll(/drawCaptions\(([^\n]*)\)\n/g)]
    expect(draws).toHaveLength(1)
    expect(draws[0][1]).toBe('ctx, frame, style, caption, fps, lineThird(captionPlacement, source, fps, caption.words, route)')
    // As the export's route for this style draws the line (a line starting part-way through a frame is first shown on different frames).
    expect([...preview.matchAll(/const route = captionNeedsCanvas\(style\) \? 'canvas' : 'libass'\n/g)]).toHaveLength(1)
    expect([...preview.matchAll(/smartPlacement\(project, activeCaptionStyle\(project\), ASPECTS\[aspect\]\)/g)]).toHaveLength(1)
    // In draw's dependencies: a memoised draw would otherwise keep the first edit's thirds.
    expect([...preview.matchAll(/\n {4}captionPlacement,\n/g)]).toHaveLength(1)
  })
})
