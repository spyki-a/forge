import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTimelineCaptions } from '@shared/captions/timeline'
import { buildGraphicsSpec } from '@shared/graphics/fromTimeline'
import { captionSpec } from '@shared/captions/line'
import { groupWords } from '@shared/captions/ass'
import { captionLineFrame, firstShownWord, lineThird, type Third, type ThirdLookup } from '@shared/captions/placement'
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

      it('the preview: each line\'s third as Preview.tsx asks it', () => {
        expect(GROUPS.map((g) => lineThird(lookup(), clip, FPS, g))).toEqual(expected)
      })

      it('all three ask at the frame the line appears on: the layer\'s startFrame', () => {
        const asked: number[] = []
        const inner = lookup()
        buildTimelineCaptions(p, STYLE, CANVAS, (frame) => (asked.push(frame), inner(frame)))
        expect(asked).toEqual(layers().map((l) => l.startFrame))
        expect(GROUPS.map((g) => captionLineFrame(clip, FPS, firstShownWord(g, clip, FPS)!.startMs))).toEqual(asked)
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
      expect(GROUPS.map((g) => lineThird(lookup, clip, FPS, g))).toEqual([null, null, null])
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
    expect(draws[0][1]).toBe('ctx, frame, style, caption, fps, lineThird(captionPlacement, source, fps, caption.words)')
    expect([...preview.matchAll(/smartPlacement\(project, activeCaptionStyle\(project\), ASPECTS\[aspect\]\)/g)]).toHaveLength(1)
    // In draw's dependencies: a memoised draw would otherwise keep the first edit's thirds.
    expect([...preview.matchAll(/\n {4}captionPlacement,\n/g)]).toHaveLength(1)
  })
})
