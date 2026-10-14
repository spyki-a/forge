import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyProject, sourceFrameFor, type Clip, type Project } from '@shared/timeline'
import { cropAt } from '@shared/render/crop'
import { followKeys } from '@shared/reframe/keys'
import {
  clipFrameAtPlayhead,
  clipFrameForMediaTime,
  dragHalfShare,
  dragShare,
  followShotAt,
  halfAtOutput,
  halfUnderPointer,
  outputDragScale,
  previewClipFrame
} from '@shared/reframe/playback'
import { fourShotTrack, printedMs } from './fixtures/reframe/track'

/*
 * Which frame of a followed clip the preview reads its crop at
 * (shared/reframe/playback.ts; docs/CLIPS.md §4.7, slice B). The Preview's
 * canvas cannot run here, so the mapping it calls is pinned on its own:
 * paused, the playhead's frame of the clip; playing, the export's frame for
 * the source moment the element presents — never `sourceFrameFor`, whose
 * half-up rounding at 0.5× puts the new shot's picture a frame before the
 * export's key.
 */

const FPS = 30
/** The cuts on source frames 29, 61 and 165 (the render check's), as the shot finder prints them. */
const CUTS = [29, 61, 165]
/** Shot 1's face at 0.25 of 1920 → x 176 at 9:16 (608 wide); shot 2's at 0.75 → 1136. */
const SHOT_1_X = 176
const SHOT_2_X = 1136

function project(clip: Partial<Clip> = {}): { project: Project; clip: Clip } {
  const track = fourShotTrack({ cutMs: CUTS.map((f) => printedMs(f / FPS)), durationMs: 7500, twoUp: true })
  const c: Clip = {
    id: 'c', assetId: 'v', trackId: 'v1', start: 40, duration: 420, inPoint: 0, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 },
    follow: { version: 1 }, crop: { x: 176, y: 0, width: 608, height: 1080 },
    ...clip
  }
  const p: Project = {
    ...emptyProject(),
    settings: { ...emptyProject().settings, width: 1080, height: 1920, fps: FPS },
    tracks: [{ id: 'v1', kind: 'video', name: 'V1', muted: false, hidden: false, locked: false }],
    assets: [{ id: 'v', path: '/media/talk.mp4', name: 'talk.mp4', kind: 'video', durationFrames: 225, width: 1920, height: 1080, fps: FPS, hasVideo: true, hasAudio: true, size: 0 }],
    clips: [c],
    subjects: { v: track }
  }
  return { project: p, clip: c }
}

/** The crop the preview draws at a playhead, paused — what Preview.tsx's `cutOf` computes. */
const pausedX = (p: Project, c: Clip, playhead: number): number => cropAt(p, c, null, previewClipFrame(c, FPS, playhead, null)).crop.x
/** The crop the preview draws while the element presents source frame `n` (its media time, seconds). */
const playingX = (p: Project, c: Clip, n: number): number => cropAt(p, c, null, previewClipFrame(c, FPS, 0, n / FPS)).crop.x

describe('the frame the preview reads a followed crop at', () => {
  it('paused: the playhead’s frame of the clip, clamped into it', () => {
    const { clip } = project()
    expect(clipFrameAtPlayhead(clip, 40)).toBe(0)
    expect(clipFrameAtPlayhead(clip, 97)).toBe(57)
    expect(clipFrameAtPlayhead(clip, 0)).toBe(0)
    expect(clipFrameAtPlayhead(clip, 10_000)).toBe(419)
    expect(previewClipFrame(clip, FPS, 97, null)).toBe(57)
  })

  it('playing at speed 1: the export’s frame for the presented source frame, wherever the playhead is', () => {
    const { project: p, clip } = project({ inPoint: 6 })
    // Source frame n shows on clip frame n − 6 — whatever the playhead says.
    expect(clipFrameForMediaTime(clip, FPS, 35 / FPS)).toBe(29)
    expect(previewClipFrame(clip, FPS, 500, 35 / FPS)).toBe(29)
    // The cut lands on the element's frame: the new shot's first frame gets the new crop, the one before keeps the old.
    expect(playingX(p, clip, 28)).toBe(SHOT_1_X)
    expect(playingX(p, clip, 29)).toBe(SHOT_2_X)
    // A media time between frames (a browser's millisecond rounding) still finds its frame.
    expect(clipFrameForMediaTime(clip, FPS, 0.967)).toBe(23)
  })

  describe('at 0.5× (the case `sourceFrameFor` gets a frame early)', () => {
    const { project: p, clip } = project({ speed: 0.5 })
    const keys = followKeys(p, clip, FPS)!
    const cut = keys.shots[1].from

    it('the cut’s held key is on the export’s frame, 2 × 29', () => {
      expect(cut).toBe(58)
    })

    it('paused on the frame before the cut: the OLD crop, as the export shows there', () => {
      const before = clip.start + cut - 1
      expect(previewClipFrame(clip, FPS, before, null)).toBe(cut - 1)
      expect(pausedX(p, clip, before)).toBe(SHOT_1_X)
      expect(pausedX(p, clip, clip.start + cut)).toBe(SHOT_2_X)
      // The preview's own seek for that playhead rounds half up into the new shot — the mapping must not go through it.
      expect(sourceFrameFor(clip, before)).toBe(29)
    })

    it('playing: the element showing source frame 28 keeps the old crop, 29 takes the new, on the export’s frames for them', () => {
      expect(clipFrameForMediaTime(clip, FPS, 28 / FPS)).toBe(56)
      expect(clipFrameForMediaTime(clip, FPS, 29 / FPS)).toBe(58)
      expect(playingX(p, clip, 28)).toBe(SHOT_1_X)
      expect(playingX(p, clip, 29)).toBe(SHOT_2_X)
    })
  })

  it('a hold has no map: the playhead’s frame', () => {
    const { clip } = project({ hold: true })
    expect(clipFrameForMediaTime(clip, FPS, 1)).toBeNull()
    expect(previewClipFrame(clip, FPS, 50, 1)).toBe(10)
  })
})

describe('what a drag on the preview moves', () => {
  const { project: p, clip } = project()
  const keys = followKeys(p, clip, FPS)!

  it('the shot under the frame, by its frames on the clip', () => {
    expect(followShotAt(keys, 0)?.index).toBe(0)
    expect(followShotAt(keys, 28)?.index).toBe(0)
    expect(followShotAt(keys, 29)?.index).toBe(1)
    expect(followShotAt(keys, 165)?.index).toBe(3)
    expect(followShotAt(keys, 10_000)?.index).toBe(3)
  })

  it('on a two-up frame: the rectangle under the pointer, the nearer centre where they overlap', () => {
    const halves = { top: { x: 100, y: 50, width: 200, height: 180 }, bottom: { x: 290, y: 50, width: 200, height: 180 } }
    expect(halfUnderPointer(halves, 150, 100)).toBe('top')
    expect(halfUnderPointer(halves, 400, 100)).toBe('bottom')
    // 290–300 is in both: the centres are at 200 and 390, so the midpoint, 295, decides (a tie goes to the top).
    expect(halfUnderPointer(halves, 296, 100)).toBe('bottom')
    expect(halfUnderPointer(halves, 294, 100)).toBe('top')
    expect(halfUnderPointer(halves, 10, 10)).toBeNull()
    // On the Output view, the stack's upper half is the top.
    expect(halfAtOutput(0.2)).toBe('top')
    expect(halfAtOutput(0.7)).toBe('bottom')
  })

  it('on the Output the picture follows the pointer: a drag right moves the crop LEFT, by the crop’s width over the frame’s', () => {
    // A 202 px half drawn 404 px wide: 0.5 source px per screen px, turned.
    const scale = outputDragScale(202, 404)
    expect(scale).toBe(-0.5)
    // +40 screen px → the crop 20 source px to the left → the picture inside it 40 px to the right, with the pointer.
    const dx = 40 * scale
    expect(dx).toBe(-20)
    expect(dragHalfShare(keys, { x: 0, y: 0 }, dx, 0).x).toBeLessThan(0)
    expect(dragShare({ axis: 'x', size: { width: 202, height: 360 } }, 0, dx, 0)).toBeCloseTo(-20 / 202, 10)
    // No frame on screen: still against the pointer, never a crop that runs with it.
    expect(outputDragScale(202, 0)).toBeLessThan(0)
  })

  it('is the scale the Output’s followed drag hands its gesture — and the Source outline’s stays the view’s own, unturned', () => {
    const overlay = readFileSync(resolve(__dirname, '../src/renderer/src/components/CropOverlay.tsx'), 'utf8')
    const at = overlay.indexOf('export function FollowedOutputDrag(')
    expect(at).toBeGreaterThan(-1)
    const output = overlay.slice(at, overlay.indexOf('\n}\n', at))
    expect([...output.matchAll(/outputDragScale\(width, frame\.width\)/g)]).toHaveLength(1)
    expect(output).toContain('onPointerDown(event, cut.halves ? halfAtOutput(share) : null, perPixel)')
    const from = overlay.indexOf('function FollowedCrop(')
    const source = overlay.slice(from, overlay.indexOf('\n}\n', from))
    expect([...source.matchAll(/onPointerDown\(event, half, 1 \/ transform\.scale\)/g)]).toHaveLength(1)
    expect(source).not.toContain('outputDragScale')
  })

  it('a drag’s total, as a share of the crop (one crop) or of the half (each axis), from where it started', () => {
    expect(dragShare(keys, 0, 60.8, 999)).toBeCloseTo(0.1, 10)
    expect(dragShare(keys, 0.25, -60.8, 0)).toBeCloseTo(0.15, 10)
    expect(dragHalfShare(keys, { x: 0, y: 0.1 }, keys.half.width / 2, keys.half.height / 4)).toEqual({ x: 0.5, y: 0.35 })
  })
})
