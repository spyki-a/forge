import { describe, expect, it } from 'vitest'
import type { MusicAnalysis } from '@shared/automation/cutPlan'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { buildSlots } from '@shared/director/menu'
import { PRODUCT_REVEAL } from '@shared/director/recipes'
import { rhythmGrid } from '@shared/director/rhythm'
import type { Menu2 } from '@shared/director/schema2'
import { validateSpine2 } from '@shared/director/validate2'
import { baselineSpine2 } from '@shared/director/baseline2'
import { composeAd } from '@shared/director/compose'
import { applyRecipe } from '@shared/director/apply2'
import { BACKDROP_RULE, SPINE_RULE, clearDirector } from '@shared/director/apply'
import { followKeys } from '@shared/reframe/keys'
import { cropAt } from '@shared/render/crop'
import { TRANSITIONS } from '@shared/transitions/registry'
import type { Brief } from '@shared/director/schema'
import { fourShotTrack, printedMs } from './fixtures/reframe/track'
import { segmentIntoSentences } from '@shared/transcript'

/*
 * The Director's hook for a followed crop (docs/CLIPS.md §4.7, apply2.ts):
 * a FOOTAGE slot whose file has a subject track the follow path reads takes
 * the followed crop — `follow` and a copy of its first frame's crop — instead
 * of BACKDROP_KEEP's whole frame over a blurred copy. A photo, and footage
 * with no track or a track of another size, keep the rule they had.
 */

const fps = 30
const brief: Brief = { product: 'Aura serum', benefit: 'glow', audience: '', tone: 'premium', cta: 'Shop now', seconds: 20, language: 'English' }

function song(bpm: number, seconds: number): MusicAnalysis {
  const beatMs = 60_000 / bpm
  const beats: number[] = []
  for (let t = 0; t <= seconds * 1000; t += beatMs) beats.push(Math.round(t))
  return { bpm, beats, downbeats: beats.filter((_, i) => i % 4 === 0), tiers: beats.map(() => 2), drops: [], buildups: [], sections: [], durationMs: seconds * 1000 }
}

const asset = (id: string, width: number, height: number, over: Partial<MediaAsset> = {}): MediaAsset => ({
  id, path: `/media/${id}`, name: `${id}.jpg`, kind: 'image', durationFrames: 150, width, height, fps: null, hasVideo: true, hasAudio: false, size: 100, ...over
})

const SET: MediaAsset[] = [
  asset('square', 2000, 2000),
  asset('wide', 1920, 1080, { name: 'wide.mp4', kind: 'video', durationFrames: 4 * fps, fps }),
  asset('tall', 1080, 1350)
]

/** The wide clip's track: cuts at 1, 2 and 3 s (on its frames 30, 60, 90), a face moving shot to shot. */
const track = (size = { width: 1920, height: 1080 }) =>
  fourShotTrack({ cutMs: [30, 60, 90].map((f) => printedMs(f / fps)), durationMs: 4000, twoUp: false, size })

function edit(subjects?: Project['subjects']): Project {
  const music: Clip = {
    id: 'music', assetId: 'song', trackId: 'a1', start: 0, duration: 20 * fps, inPoint: 0, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 }
  }
  const empty = emptyProject()
  return {
    ...empty,
    settings: { ...empty.settings, width: 1080, height: 1920, fps },
    assets: [...SET, asset('song', 0, 0, { name: 'song.m4a', kind: 'audio', durationFrames: 20 * fps, width: null, height: null, hasVideo: false, hasAudio: true })],
    clips: [music],
    ...(subjects ? { subjects } : {})
  }
}

function direct(p: Project): Project {
  const slots = buildSlots(p)
  const menu: Menu2 = { slots, recipes: [PRODUCT_REVEAL], fallback: PRODUCT_REVEAL, heroCandidates: slots.map((s) => s.id), fps, seconds: 20, bpm: 100, holds: { min: 4, max: 8 }, drops: [] }
  const checked = validateSpine2(baselineSpine2(brief, menu, PRODUCT_REVEAL), menu)
  if ('rejected' in checked) throw new Error(checked.rejected)
  const grid = rhythmGrid(song(100, 20), { fps, seconds: 20, tempo: PRODUCT_REVEAL.tempo })
  const composed = composeAd(checked.plan, checked.recipe, menu, grid)
  let n = 0
  return applyRecipe(p, composed, menu, {
    fps, videoTrackId: 'v1', brief, model: 'baseline', catalogue: TRANSITIONS.map((t) => ({ id: t.id, family: t.family })), musicClipId: 'music',
    newId: (x) => `${x}-${++n}`
  }).project
}

const shotsOf = (p: Project, assetId: string): Clip[] => p.clips.filter((c) => c.generatedBy?.rule === SPINE_RULE && c.assetId === assetId)
const backdropsOf = (p: Project, assetId: string): Clip[] => p.clips.filter((c) => c.generatedBy?.rule === BACKDROP_RULE && c.assetId === assetId)

describe('a footage slot whose file has a subject track', () => {
  const p = direct(edit({ wide: track() }))
  const shots = shotsOf(p, 'wide')

  it('follows its subject — `follow` and the followed crop’s first frame, a copy — and gets no blurred backdrop', () => {
    expect(shots.length).toBeGreaterThan(0)
    for (const shot of shots) {
      expect(shot.follow).toMatchObject({ version: 1 })
      const keys = followKeys(p, shot, fps)!
      expect(keys).not.toBeNull()
      expect(shot.crop).toEqual(keys.crop)
      expect(shot.crop).not.toBe(keys.crop)
      // The 9:16 crop of a 1920×1080 file, on the face — not the centred 656.
      expect(shot.crop).toMatchObject({ width: 608, height: 1080 })
    }
    expect(backdropsOf(p, 'wide')).toEqual([])
  })

  it('reads as the followed crop on its frames: the face moves from shot to shot', () => {
    const shot = shots[0]
    const xs = new Set(Array.from({ length: shot.duration }, (_, f) => cropAt(p, shot, null, f).crop.x))
    expect(xs.size).toBeGreaterThan(1)
  })

  it('a photo keeps its rule: the square still has its backdrop, the 4:5 its crop, and neither follows', () => {
    expect(backdropsOf(p, 'square').length).toBeGreaterThan(0)
    expect(shotsOf(p, 'square').every((s) => !s.follow)).toBe(true)
    expect(shotsOf(p, 'tall').every((s) => !s.follow && s.crop)).toBe(true)
  })

  it('Clear takes the ad away and leaves the track: a fact about the file', () => {
    const cleared = clearDirector(p)
    expect(cleared.subjects?.wide).toBe(p.subjects?.wide)
    expect(shotsOf(cleared, 'wide')).toEqual([])
  })
})

describe('a footage slot with no track the follow path reads', () => {
  it('keeps BACKDROP_KEEP’s blurred copy — with no track, and with a track of another size', () => {
    for (const subjects of [undefined, { wide: track({ width: 1280, height: 720 }) }]) {
      const p = direct(edit(subjects))
      expect(backdropsOf(p, 'wide').length).toBeGreaterThan(0)
      expect(shotsOf(p, 'wide').every((s) => !s.follow && s.crop === undefined)).toBe(true)
    }
  })
})

describe('a followed footage slot that is J-cut', () => {
  it('stores the followed crop of its MOVED first frame: the J-cut skips into the next shot, and the crop goes with it', () => {
    /*
     * The wide clip speaks (a word at 0.3 s) after a still, so its picture
     * skips J_CUT_SECONDS (6 frames) and its sound leads. Its track cuts at
     * frame 3: in-point 0 is shot 1 (the face at 0.25), the moved in-point 6
     * is shot 2 (0.75), so a crop left from before the J-cut is the wrong shot's.
     */
    const cutEarly = fourShotTrack({ cutMs: [3, 60, 90].map((f) => printedMs(f / fps)), durationMs: 4000, twoUp: false })
    const words = [{ index: 0, text: 'Glow.', startMs: 300, endMs: 700, confidence: 1 }]
    const base = edit({ wide: cutEarly })
    // With a sound of its own, which the J-cut lifts onto a dialogue lane.
    const p: Project = { ...base, assets: base.assets.map((a) => (a.id === 'wide' ? { ...a, hasAudio: true } : a)) }
    p.transcripts = { wide: { assetId: 'wide', language: 'en', model: 'm', durationMs: 4000, words, segments: segmentIntoSentences(words) } }
    const directed = direct(p)
    const jCut = shotsOf(directed, 'wide').filter((s) => s.audioDetached)
    expect(jCut.length, 'a J-cut shot of the wide clip').toBeGreaterThan(0)
    for (const shot of jCut) {
      expect(shot.inPoint).toBe(6)
      expect(shot.follow).toMatchObject({ version: 1 })
      const keys = followKeys(directed, shot, fps)!
      expect(shot.crop, 'the followed crop at the moved in-point').toEqual(keys.crop)
      expect(shot.crop).not.toBe(keys.crop)
      // And not the first frame's from before the move: that is shot 1's face.
      const unmoved = followKeys(directed, { ...shot, inPoint: 0 }, fps)!
      expect(unmoved.crop.x).not.toBe(keys.crop.x)
    }
  })
})
