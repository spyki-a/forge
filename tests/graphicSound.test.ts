import { describe, expect, it } from 'vitest'
import {
  GRAPHIC_SOUND_CAP,
  GRAPHIC_SOUND_DB,
  GRAPHIC_SOUND_FILES,
  GRAPHIC_SOUND_LANE_NAME,
  NO_SOUND_LIBRARY_NOTE,
  graphicSoundCues,
  noSoundFileNote,
  graphicSounds
} from '@shared/graphics/sound'
import { CLIPS_GRAPHIC_RULE } from '@shared/graphics/apply'
import { GRAPHIC_RULE, SOUND_RULE } from '@shared/director/apply'
import { SOUND_LANE_NAME } from '@shared/director/sound'
import { SOUND_ROLES, type SoundFile, type SoundPack } from '@shared/director/soundRoles'
import { MAX_SOUND_GAIN } from '@shared/render/soundLevels'
import type { GraphicData, GraphicSpec } from '@shared/graphics/template'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project, type Track } from '@shared/timeline'

/*
 * docs/CLIPS.md §6.14, the placement half of the sound test. Packs are data:
 * each SoundFile is a SOUND_ROLES entry with a made-up path, never an audio
 * file. Every frame below is worked by hand from the project's rate: a tick's
 * peak goes on the beat's frame, ceil(beat × fps), less round(peakSeconds ×
 * fps); a whoosh's on the first whole frame of its move, where a curve that
 * starts steep (expo-out, out-back) changes most.
 */

const LIB = '/lib/sfx'

function fileOf(name: string, patch: Partial<SoundFile> = {}): SoundFile {
  return { ...SOUND_ROLES[name], id: name, name, file: `${LIB}/${name}`, ...patch }
}

const ALL: SoundPack = [
  'clock_tick.wav',
  'heartbeat_pulse.wav',
  'fast_whoosh.wav',
  'whoosh_fast.wav',
  'sword_swish.wav',
  'swoosh_heavy.wav',
  'riser_climax.wav'
].map((n) => fileOf(n))

function ids(): (prefix: string) => string {
  let n = 0
  return (prefix) => `${prefix}-${++n}`
}

function footage(id: string, start: number, duration: number): Clip {
  return { id, assetId: `asset-${id}`, trackId: 'v1', start, duration, inPoint: 0, volume: 1, transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR } }
}

function spec(data: GraphicData, beats: number[], patch: Partial<GraphicSpec> = {}): GraphicSpec {
  return { data, seconds: 3, beats, place: { auto: true, third: 'top' }, seed: 1, version: 1, grounding: { assetId: 'asset-f1', sentence: 's', words: [] }, ...patch }
}

function graphic(id: string, start: number, duration: number, s: GraphicSpec): Clip {
  return { id, assetId: `graphic-asset-${id}`, trackId: 'v2', start, duration, inPoint: 0, volume: 1, transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR }, graphic: s, generatedBy: { rule: CLIPS_GRAPHIC_RULE, reason: 'r' } }
}

function project(fps: number, clips: Clip[], patch: Partial<Project> = {}): Project {
  const base = emptyProject('sound')
  return { ...base, settings: { ...base.settings, fps }, clips: [footage('f1', 0, 3000), ...clips], ...patch }
}

/** Places every graphic clip in `order`, merging each result in, as applyGraphics will. */
function placeAll(p: Project, order: string[], rule: string, pack: SoundPack): { project: Project; byGraphic: Record<string, Clip[]>; notes: string[] } {
  let next = p
  const byGraphic: Record<string, Clip[]> = {}
  const notes: string[] = []
  const newId = ids()
  for (const id of order) {
    const g = next.clips.find((c) => c.id === id)!
    const out = graphicSounds(next, g, g.graphic!, rule, pack, { newId })
    byGraphic[id] = out.clips
    notes.push(...out.notes)
    next = { ...next, tracks: [...next.tracks, ...out.tracks], assets: [...next.assets, ...out.assets], clips: [...next.clips, ...out.clips] }
  }
  return { project: next, byGraphic, notes }
}

const counter = (value = '40%'): GraphicData => ({ template: 'counter', value, label: 'more' })
const keyword = (words = 'never again'): GraphicData => ({ template: 'keyword', words, lit: 0 })
const callout = (label = 'the dial'): GraphicData => ({ template: 'callout', label, shape: 'circle' })

describe('graphicSounds: the files (§6.14)', () => {
  it('every name in GRAPHIC_SOUND_FILES is a SOUND_ROLES entry with the figures §6.14 quotes, and the heartbeat and the boom are not used', () => {
    expect(GRAPHIC_SOUND_FILES.tick).toEqual(['clock_tick.wav'])
    expect(GRAPHIC_SOUND_FILES.whoosh).toEqual(['fast_whoosh.wav', 'whoosh_fast.wav', 'sword_swish.wav', 'swoosh_heavy.wav'])
    expect(SOUND_ROLES['clock_tick.wav']).toMatchObject({ role: 'tick', seconds: 0.08, peakSeconds: 0.005 })
    for (const name of GRAPHIC_SOUND_FILES.whoosh) {
      const e = SOUND_ROLES[name]
      expect(e.role).toBe('whoosh')
      expect(e.seconds).toBeGreaterThanOrEqual(0.26)
      expect(e.seconds).toBeLessThanOrEqual(0.65)
      // "peaks mid-file": within the middle third.
      expect(e.peakSeconds / e.seconds).toBeGreaterThan(1 / 3)
      expect(e.peakSeconds / e.seconds).toBeLessThan(2 / 3)
    }
    const used = [...GRAPHIC_SOUND_FILES.tick, ...GRAPHIC_SOUND_FILES.whoosh]
    expect(used).not.toContain('heartbeat_pulse.wav')
    expect(used).not.toContain('riser_climax.wav')
    expect(GRAPHIC_SOUND_CAP).toBe(3)
    expect(GRAPHIC_SOUND_DB).toEqual({ tick: -24, whoosh: -26 })
  })
})

describe('graphicSounds: placement (§6.14)', () => {
  it("each sound clip carries its graphic's rule and forGraphic, the brought file carries the rule, and the tick's peak is on the beat frame", () => {
    // A counter at frame 60, beat 0.6 s: the beat frame is 60 + ceil(18) = 78; clock_tick peaks round(0.005 × 30) = 0 frames in.
    const p = project(30, [graphic('g1', 60, 90, spec(counter(), [0.6]))])
    const out = graphicSounds(p, p.clips[1], p.clips[1].graphic!, CLIPS_GRAPHIC_RULE, ALL, { newId: ids() })
    expect(out.notes).toEqual([])
    expect(out.clips).toHaveLength(1)
    const c = out.clips[0]
    expect(c.forGraphic).toBe('g1')
    expect(c.generatedBy).toEqual({ rule: CLIPS_GRAPHIC_RULE, reason: 'tick on "40%" · clock_tick.wav' })
    expect(c.start).toBe(78)
    expect(c.inPoint).toBe(0)
    // 0.08 s at 30 fps is round(2.4) = 2 frames, the whole file.
    expect(c.duration).toBe(2)
    expect(out.assets).toHaveLength(1)
    expect(out.assets[0]).toMatchObject({ id: c.assetId, path: `${LIB}/clock_tick.wav`, kind: 'audio', broughtBy: CLIPS_GRAPHIC_RULE })
    // −24 − (−10.3) = −13.7 dB: 10^(−0.685).
    expect(c.volume).toBeCloseTo(0.20654, 4)

    // Direct's: the same, under GRAPHIC_RULE; never SOUND_RULE.
    const direct = graphicSounds(p, p.clips[1], p.clips[1].graphic!, GRAPHIC_RULE, ALL, { newId: ids() })
    expect(direct.clips[0].generatedBy?.rule).toBe(GRAPHIC_RULE)
    expect(direct.assets[0].broughtBy).toBe(GRAPHIC_RULE)
    for (const x of [...out.clips, ...direct.clips]) expect(x.generatedBy?.rule).not.toBe(SOUND_RULE)
    for (const a of [...out.assets, ...direct.assets]) expect(a.broughtBy).not.toBe(SOUND_RULE)
  })

  it('the peak is subtracted: at 120 fps a tick starts round(0.6) = 1 frame before its beat frame', () => {
    // Beat 0.6 s from frame 60: 60 + ceil(72) = 132; clock_tick's peak is round(0.005 × 120) = 1 frame in, so it starts on 131.
    const p = project(120, [graphic('g1', 60, 360, spec(counter(), [0.6]))])
    const out = graphicSounds(p, p.clips[1], p.clips[1].graphic!, CLIPS_GRAPHIC_RULE, ALL, { newId: ids() })
    expect(out.clips.map((c) => [c.start, c.duration])).toEqual([[131, 10]])
  })

  it("a whoosh's peak is on the fastest frame of its move: a callout's stroke", () => {
    // Beat 0.55 s, so the stroke (0.45 s, expo-out) starts at 0.10 s, local frame 3, and its first whole step,
    // frame 3 to 4, is its largest. fast_whoosh peaks round(0.13 × 30) = 4 frames in: from 60, it starts on 60 + 4 − 4 = 60.
    const p = project(30, [graphic('g1', 60, 75, spec(callout(), [0.55]))])
    const out = graphicSounds(p, p.clips[1], p.clips[1].graphic!, CLIPS_GRAPHIC_RULE, ALL, { newId: ids() })
    expect(out.clips).toHaveLength(1)
    expect(out.clips[0]).toMatchObject({ start: 60, duration: 8, inPoint: 0, generatedBy: { rule: CLIPS_GRAPHIC_RULE, reason: 'whoosh on "the dial" · fast_whoosh.wav' } })
    // −26 − (−8.8) = −17.2 dB.
    expect(out.clips[0].volume).toBeCloseTo(Math.pow(10, -17.2 / 20), 6)
  })

  describe('restrained against energetic, per template', () => {
    const at = (fps: number, data: GraphicData, beats: number[], style?: string) => {
      const s = spec(data, beats, style ? { style } : {})
      const p = project(fps, [graphic('g', 300, 180, s)])
      return graphicSoundCues(p, p.clips[1], s).map((c) => `${c.key}@${c.frame}`)
    }
    const bars: GraphicData = { template: 'bars', title: 'By the numbers', items: [{ label: 'a', value: '1' }, { label: 'b', value: '2' }, { label: 'c', value: '3' }] }
    const steps = (connector: 'none' | 'line' | 'tree'): GraphicData => ({ template: 'steps', title: 'Step by step', items: [{ label: 'one' }, { label: 'two' }], connector })

    it('restrained: at most one sound, as the table says', () => {
      // A beat at 0.6 s from frame 300 lands on 318.
      expect(at(30, counter(), [0.6])).toEqual(['tick@318'])
      expect(at(30, { template: 'ring', value: '40%', label: 'more' }, [0.6])).toEqual(['tick@318'])
      expect(at(30, bars, [0.6, 1.0, 1.4])).toEqual(['tick@318'])
      expect(at(30, steps('none'), [0.6, 1.0])).toEqual(['tick@318'])
      expect(at(30, steps('line'), [0.6, 1.0])).toEqual(['tick@318'])
      expect(at(30, steps('tree'), [0.6, 1.0])).toEqual(['tick@318'])
      expect(at(30, keyword(), [0.6])).toEqual(['tick@318'])
      expect(at(30, callout(), [0.55])).toEqual(['whoosh@304'])
      expect(at(30, { template: 'quote', text: 'never again', speaker: 'Asha' }, [0.6, 0.8])).toEqual([])
      expect(at(30, { template: 'lower-third', name: 'Asha', role: 'Chef' }, [0.6])).toEqual([])
      expect(at(30, { template: 'screen-card', clipId: 'f1', move: 'tilt-in' }, [])).toEqual([])
      // Every preset but energetic is restrained.
      for (const style of ['bold', 'editorial', 'neon', 'mono', 'accent']) expect(at(30, counter(), [0.6], style)).toEqual(['tick@318'])
    })

    it('energetic: a tick on every beat and a whoosh on each stroke and entrance', () => {
      // An entrance from t = 0 (0.35 s, out-back) is fastest on local frame 1.
      expect(at(30, counter(), [0.6], 'energetic')).toEqual(['whoosh@301', 'tick@318'])
      // Beats 0.65, 1.05, 1.45: ticks on ceil(19.5, 31.5, 43.5) = 20, 32, 44; each row enters from 0.30, 0.70,
      // 1.10 s = frames 9, 21, 33 and is fastest on the next; the title enters from 0.
      expect(at(30, bars, [0.65, 1.05, 1.45], 'energetic')).toEqual(['whoosh@301', 'whoosh@310', 'tick@320', 'whoosh@322', 'tick@332', 'whoosh@334', 'tick@344'])
      // A line's edge into row 2 strokes from 1.05 − 0.45 = 0.60 s (frame 18), fastest on 19.
      expect(at(30, steps('line'), [0.65, 1.05], 'energetic')).toEqual(['whoosh@301', 'whoosh@310', 'whoosh@319', 'tick@320', 'whoosh@322', 'tick@332'])
      // A tree strokes into every row: row 1's from 0.20 s (frame 6), fastest on 7.
      expect(at(30, steps('tree'), [0.65, 1.05], 'energetic')).toEqual(['whoosh@301', 'whoosh@307', 'whoosh@310', 'whoosh@319', 'tick@320', 'whoosh@322', 'tick@332'])
      // The keyword's underline strokes from 0.20 s (fastest 7), its card enters from 0.30 s (fastest 10).
      expect(at(30, keyword(), [0.65], 'energetic')).toEqual(['whoosh@307', 'whoosh@310', 'tick@320'])
      // At 60 fps, beat 0.6 s = frame 36: the stroke from 0.15 s (frame 9) is fastest on 10, the label enters from the beat, fastest on 37.
      expect(at(60, callout(), [0.6], 'energetic')).toEqual(['whoosh@310', 'tick@336', 'whoosh@337'])
      expect(at(30, { template: 'quote', text: 'never again', speaker: 'Asha' }, [0.6, 0.8], 'energetic')).toEqual([])
      expect(at(30, { template: 'lower-third', name: 'Asha', role: 'Chef' }, [0.6], 'energetic')).toEqual([])
    })
  })

  it('the cap: a footage clip keeps its first three sounds in onset order, and a second footage clip its own three, whatever order they are placed in', () => {
    const f2 = footage('f2', 3000, 3000)
    const g = (id: string, start: number, assetId: string) => graphic(id, start, 75, spec(keyword(id), [0.65], { grounding: { assetId, sentence: 's', words: [] } }))
    const clips = [f2, g('g1', 300, 'asset-f1'), g('g2', 600, 'asset-f1'), g('g3', 900, 'asset-f1'), g('g4', 1200, 'asset-f1'), g('h1', 3300, 'asset-f2'), g('h2', 3600, 'asset-f2'), g('h3', 3900, 'asset-f2'), g('h4', 4200, 'asset-f2')]
    const p = project(30, clips)
    // Placed latest first: the cap is in onset order, not call order.
    const { byGraphic, project: after } = placeAll(p, ['h4', 'g4', 'h3', 'g3', 'h2', 'g2', 'h1', 'g1'], CLIPS_GRAPHIC_RULE, ALL)
    const starts = (id: string) => byGraphic[id].map((c) => c.start)
    expect(starts('g1')).toEqual([320])
    expect(starts('g2')).toEqual([620])
    expect(starts('g3')).toEqual([920])
    expect(starts('g4')).toEqual([])
    expect(starts('h1')).toEqual([3320])
    expect(starts('h2')).toEqual([3620])
    expect(starts('h3')).toEqual([3920])
    expect(starts('h4')).toEqual([])
    // One file brought, reused by every later call.
    expect(after.assets.filter((a) => a.path === `${LIB}/clock_tick.wav`)).toHaveLength(1)
  })

  it('the cap counts sounds, not graphics: two energetic counters on one clip keep three of their four', () => {
    const e = (id: string, start: number) => graphic(id, start, 90, spec(counter(), [0.6], { style: 'energetic' }))
    const p = project(30, [e('g1', 300), e('g2', 600)])
    const { byGraphic } = placeAll(p, ['g2', 'g1'], CLIPS_GRAPHIC_RULE, ALL)
    // g1: the entrance's whoosh peaks on 301 (fast_whoosh starts 4 frames before it), the tick on 318; g2: its whoosh only.
    expect(byGraphic.g1.map((c) => c.generatedBy!.reason)).toEqual(['whoosh on "40%" · fast_whoosh.wav', 'tick on "40%" · clock_tick.wav'])
    expect(byGraphic.g1.map((c) => c.start)).toEqual([297, 318])
    expect(byGraphic.g2.map((c) => c.generatedBy!.reason)).toEqual(['whoosh on "40%" · whoosh_fast.wav'])
    // whoosh_fast peaks round(0.18 × 30) = 5 frames in: 601 − 5.
    expect(byGraphic.g2.map((c) => c.start)).toEqual([596])
  })

  it('picks by file name: a pack holding both tick files never lands the heartbeat', () => {
    const p = project(30, [300, 600, 900].map((s, i) => graphic(`g${i + 1}`, s, 75, spec(keyword(), [0.65]))))
    const { byGraphic } = placeAll(p, ['g1', 'g2', 'g3'], CLIPS_GRAPHIC_RULE, ALL)
    for (const id of ['g1', 'g2', 'g3']) {
      expect(byGraphic[id]).toHaveLength(1)
      expect(byGraphic[id][0].generatedBy!.reason).toBe('tick on "never again" · clock_tick.wav')
    }
  })

  it('no repeats: whooshes walk the list in its own order', () => {
    const p = project(30, [300, 600, 900].map((s, i) => graphic(`g${i + 1}`, s, 75, spec(callout(), [0.55]))))
    const { byGraphic, project: after } = placeAll(p, ['g3', 'g1', 'g2'], CLIPS_GRAPHIC_RULE, ALL)
    const fileOfClip = (c: Clip) => after.assets.find((a) => a.id === c.assetId)!.name
    expect(['g1', 'g2', 'g3'].map((id) => fileOfClip(byGraphic[id][0]))).toEqual(['fast_whoosh.wav', 'whoosh_fast.wav', 'sword_swish.wav'])
  })

  it('the gain is capped at the fader ceiling', () => {
    // A quieter replacement file: −24 − (−40) = +16 dB is 6.31×, written as MAX_SOUND_GAIN (2).
    const quiet = [fileOf('clock_tick.wav', { peakDb: -40 })]
    const p = project(30, [graphic('g1', 60, 90, spec(counter(), [0.6]))])
    const out = graphicSounds(p, p.clips[1], p.clips[1].graphic!, CLIPS_GRAPHIC_RULE, quiet, { newId: ids() })
    expect(MAX_SOUND_GAIN).toBe(2)
    expect(out.clips[0].volume).toBe(2)
  })

  it('a file already in the pool under the same path is reused: no second asset, no broughtBy', () => {
    const mine: MediaAsset = { id: 'mine', path: `${LIB}/clock_tick.wav`, name: 'clock_tick.wav', kind: 'audio', durationFrames: 2, width: null, height: null, fps: null, hasVideo: false, hasAudio: true, size: 1 }
    const p = project(30, [graphic('g1', 60, 90, spec(counter(), [0.6]))], { assets: [mine] })
    const out = graphicSounds(p, p.clips[1], p.clips[1].graphic!, CLIPS_GRAPHIC_RULE, ALL, { newId: ids() })
    expect(out.assets).toEqual([])
    expect(out.clips[0].assetId).toBe('mine')
  })

  describe('the lanes', () => {
    const one = (p: Project, rule: string) => {
      const g = p.clips.find((c) => c.graphic)!
      return graphicSounds(p, g, g.graphic!, rule, ALL, { newId: ids() })
    }
    const lane = (id: string, name: string, director = false): Track => ({ id, kind: 'audio', name, muted: false, hidden: false, locked: false, ...(director ? { director: true as const } : {}) })
    const g1 = () => graphic('g1', 60, 90, spec(counter(), [0.6]))

    it('a Clip-it graphic sound goes on an ordinary audio track named "Graphic sounds", added when there is none, and never on the Director\'s lane', () => {
      const base = project(30, [g1()])
      const withSd = { ...base, tracks: [...base.tracks, lane('sd', SOUND_LANE_NAME, true)] }
      const out = one(withSd, CLIPS_GRAPHIC_RULE)
      expect(out.tracks).toHaveLength(1)
      expect(out.tracks[0]).toMatchObject({ kind: 'audio', name: GRAPHIC_SOUND_LANE_NAME })
      expect(out.tracks[0].director).toBeUndefined()
      expect(out.clips[0].trackId).toBe(out.tracks[0].id)
      expect(out.clips[0].trackId).not.toBe('sd')
    })

    it('a free "Graphic sounds" track is reused; a busy one is not', () => {
      const base = project(30, [g1()])
      const free = { ...base, tracks: [...base.tracks, lane('gs', GRAPHIC_SOUND_LANE_NAME)] }
      const reused = one(free, CLIPS_GRAPHIC_RULE)
      expect(reused.tracks).toEqual([])
      expect(reused.clips[0].trackId).toBe('gs')
      const busy = { ...free, clips: [...free.clips, { ...footage('x', 70, 30), trackId: 'gs' }] }
      const added = one(busy, CLIPS_GRAPHIC_RULE)
      expect(added.tracks).toHaveLength(1)
      expect(added.clips[0].trackId).toBe(added.tracks[0].id)
    })

    it('a Direct graphic sound goes on the Sound design lane: a free director track, else a new one so named and marked', () => {
      const base = project(30, [g1()])
      const withBoth = { ...base, tracks: [...base.tracks, lane('gs', GRAPHIC_SOUND_LANE_NAME), lane('sd', SOUND_LANE_NAME, true)] }
      const onSd = one(withBoth, GRAPHIC_RULE)
      expect(onSd.tracks).toEqual([])
      expect(onSd.clips[0].trackId).toBe('sd')
      const fresh = one(base, GRAPHIC_RULE)
      expect(fresh.tracks).toHaveLength(1)
      expect(fresh.tracks[0]).toMatchObject({ kind: 'audio', name: SOUND_LANE_NAME, director: true })
      expect(fresh.clips[0].trackId).toBe(fresh.tracks[0].id)
    })
  })

  it('with Project.graphics.sound false, nothing is placed and nothing is said', () => {
    const p = project(30, [graphic('g1', 60, 90, spec(counter(), [0.6]))], { graphics: { styleId: 'clean', sound: false } })
    expect(graphicSounds(p, p.clips[1], p.clips[1].graphic!, CLIPS_GRAPHIC_RULE, ALL, { newId: ids() })).toEqual({ clips: [], assets: [], tracks: [], notes: [] })
  })

  it('with no library, or none of its files, the graphic lands silent with the one note', () => {
    const p = project(30, [graphic('g1', 60, 90, spec(counter(), [0.6]))])
    for (const pack of [[], [fileOf('heartbeat_pulse.wav'), fileOf('riser_climax.wav')]]) {
      expect(graphicSounds(p, p.clips[1], p.clips[1].graphic!, CLIPS_GRAPHIC_RULE, pack, { newId: ids() })).toEqual({ clips: [], assets: [], tracks: [], notes: [NO_SOUND_LIBRARY_NOTE] })
    }
    expect(NO_SOUND_LIBRARY_NOTE).toBe('no sound library is installed — graphics land silent')
  })

  it('a library with ticks but no whoosh: a callout lands silent with its own note, a counter still ticks', () => {
    const ticksOnly = [fileOf('clock_tick.wav')]
    const p = project(30, [graphic('g1', 60, 75, spec(callout(), [0.55])), graphic('g2', 300, 90, spec(counter(), [0.6]))])
    const silent = graphicSounds(p, p.clips[1], p.clips[1].graphic!, CLIPS_GRAPHIC_RULE, ticksOnly, { newId: ids() })
    expect(silent).toEqual({ clips: [], assets: [], tracks: [], notes: [noSoundFileNote('whoosh')] })
    expect(noSoundFileNote('whoosh')).toBe('no whoosh in the sound library — that sound is not placed')
    const ticks = graphicSounds(p, p.clips[2], p.clips[2].graphic!, CLIPS_GRAPHIC_RULE, ticksOnly, { newId: ids() })
    expect(ticks.notes).toEqual([])
    expect(ticks.clips.map((c) => c.start)).toEqual([318])
  })
})
