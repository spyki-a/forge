import { describe, expect, it } from 'vitest'
import {
  fastestFrame,
  GRAPHIC_SOUND_CAP,
  GRAPHIC_SOUND_DB,
  GRAPHIC_SOUND_FILES,
  GRAPHIC_SOUND_LANE_NAME,
  NO_SOUND_LIBRARY_NOTE,
  graphicSoundCues,
  noSoundFileNote,
  graphicSounds
} from '@shared/graphics/sound'
import {
  CLIPS_GRAPHIC_RULE,
  clearGraphics,
  followGraphicMoves,
  graphicFollowers,
  removeWithFollowers,
  resoundGraphic,
  silenceGraphics,
  soundAllGraphics
} from '@shared/graphics/apply'
import { copySelection, pasteClipboard } from '@shared/edit/recipes'
import { GRAPHIC_RULE, SOUND_RULE, clearDirector } from '@shared/director/apply'
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

/** Merges one call's result in, as applyGraphics will: the re-placed sounds off, the new tracks, assets and sounds on. */
function merge(p: Project, out: ReturnType<typeof graphicSounds>): Project {
  const gone = new Set(out.removed)
  return { ...p, tracks: [...p.tracks, ...out.tracks], assets: [...p.assets, ...out.assets], clips: [...p.clips.filter((c) => !gone.has(c.id)), ...out.clips] }
}

/** Places every graphic clip in `order`, merging each result in; `byGraphic` is read from the project after the last call. */
function placeAll(p: Project, order: string[], rule: string, pack: SoundPack, newId = ids()): { project: Project; byGraphic: Record<string, Clip[]>; notes: string[] } {
  let next = p
  const notes: string[] = []
  for (const id of order) {
    const g = next.clips.find((c) => c.id === id)!
    const out = graphicSounds(next, g, g.graphic!, rule, pack, { newId })
    notes.push(...out.notes)
    next = merge(next, out)
  }
  const byGraphic: Record<string, Clip[]> = {}
  for (const c of next.clips) if (c.forGraphic) (byGraphic[c.forGraphic] ??= []).push(c)
  for (const id of order) byGraphic[id] ??= []
  for (const list of Object.values(byGraphic)) list.sort((a, b) => a.start - b.start)
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
    expect(graphicSounds(p, p.clips[1], p.clips[1].graphic!, CLIPS_GRAPHIC_RULE, ALL, { newId: ids() })).toEqual({ clips: [], assets: [], tracks: [], notes: [], removed: [] })
  })

  it('with no library, or none of its files, the graphic lands silent with the one note', () => {
    const p = project(30, [graphic('g1', 60, 90, spec(counter(), [0.6]))])
    for (const pack of [[], [fileOf('heartbeat_pulse.wav'), fileOf('riser_climax.wav')]]) {
      expect(graphicSounds(p, p.clips[1], p.clips[1].graphic!, CLIPS_GRAPHIC_RULE, pack, { newId: ids() })).toEqual({ clips: [], assets: [], tracks: [], notes: [NO_SOUND_LIBRARY_NOTE], removed: [] })
    }
    expect(NO_SOUND_LIBRARY_NOTE).toBe('no sound library is installed — graphics land silent')
  })

  it('a library with ticks but no whoosh: a callout lands silent with its own note, a counter still ticks', () => {
    const ticksOnly = [fileOf('clock_tick.wav')]
    // The counter on a second footage clip, so each call re-places one graphic's sounds.
    const p = project(30, [graphic('g1', 60, 75, spec(callout(), [0.55])), footage('f2', 3000, 3000), graphic('g2', 3300, 90, spec(counter(), [0.6], { grounding: { assetId: 'asset-f2', sentence: 's', words: [] } }))])
    const silent = graphicSounds(p, p.clips[1], p.clips[1].graphic!, CLIPS_GRAPHIC_RULE, ticksOnly, { newId: ids() })
    expect(silent).toEqual({ clips: [], assets: [], tracks: [], notes: [noSoundFileNote('whoosh')], removed: [] })
    expect(noSoundFileNote('whoosh')).toBe('no whoosh in the sound library — that sound is not placed')
    const ticks = graphicSounds(p, p.clips[3], p.clips[3].graphic!, CLIPS_GRAPHIC_RULE, ticksOnly, { newId: ids() })
    expect(ticks.notes).toEqual([])
    expect(ticks.clips.map((c) => c.start)).toEqual([3318])
  })
})

describe('graphicSounds: after the critics (§6.14)', () => {
  /** What a sound is, without the ids a run makes up: its graphic, its span, its file and its fader. */
  const shape = (p: Project) =>
    p.clips
      .filter((c) => c.forGraphic)
      .map((c) => `${c.forGraphic} ${c.start}+${c.duration}@${c.inPoint} ${p.assets.find((a) => a.id === c.assetId)!.name} ${c.volume.toFixed(5)} ${c.generatedBy!.rule}`)
      .sort()

  it("the cap holds on Find again: Clip-it graphics before Direct's push its sound out, as placing every graphic afresh does", () => {
    // Direct's keyword at 900 sounds first; three Clip-it keywords at 300, 600, 700 then come in. Each keyword ticks on
    // its start + ceil(0.65 × 30) = start + 20; clock_tick peaks 0 frames in, so a tick starts on its beat frame.
    const d = { ...graphic('d', 900, 75, spec(keyword('d'), [0.65])), generatedBy: { rule: GRAPHIC_RULE, reason: 'r' } }
    const cs = [graphic('c1', 300, 75, spec(keyword('c1'), [0.65])), graphic('c2', 600, 75, spec(keyword('c2'), [0.65])), graphic('c3', 700, 75, spec(keyword('c3'), [0.65]))]
    const direct = placeAll(project(30, [d]), ['d'], GRAPHIC_RULE, ALL)
    expect(direct.byGraphic.d.map((c) => c.start)).toEqual([920])
    const withCs = { ...direct.project, clips: [...direct.project.clips, ...cs] }
    const findAgain = placeAll(withCs, ['c1', 'c2', 'c3'], CLIPS_GRAPHIC_RULE, ALL, ids())
    expect(findAgain.project.clips.filter((c) => c.forGraphic).map((c) => [c.forGraphic, c.start]).sort()).toEqual([['c1', 320], ['c2', 620], ['c3', 720]])
    // Afresh: every sound off, every graphic placed again in another order.
    const bare = { ...withCs, clips: withCs.clips.filter((c) => !c.forGraphic) }
    const afresh = placeAll(bare, ['d', 'c3', 'c1', 'c2'], CLIPS_GRAPHIC_RULE, ALL, ids())
    expect(shape(findAgain.project)).toEqual(shape(afresh.project))
    // Placing one graphic twice leaves one set of sounds, not two.
    const twice = placeAll(project(30, [graphic('g1', 60, 90, spec(counter(), [0.6]))]), ['g1', 'g1'], CLIPS_GRAPHIC_RULE, ALL)
    expect(twice.project.clips.filter((c) => c.forGraphic).map((c) => c.start)).toEqual([78])
  })

  it('under a linear ease a whoosh lands on the first whole step of the move, not where float noise puts it', () => {
    // A stroke from 0.10 s = frame 3 over 0.45 s: every whole step from frame 3 to 16 is the same 1/13.5; the first ends on 4.
    expect(fastestFrame({ start: 0.1, seconds: 0.45, ease: 'linear' }, 30, 75)).toBe(4)
    // From 0.37 s (frame 11.1): the step into 12 is part of one, into 13 the first whole one.
    expect(fastestFrame({ start: 0.37, seconds: 0.45, ease: 'linear' }, 30, 75)).toBe(13)
    // The same through a restrained callout whose style's ease is set linear: beat 0.55 s, the stroke from frame 3.
    const s = spec(callout(), [0.55])
    const p = project(30, [graphic('g1', 300, 75, s)], { graphics: { styleId: 'clean', sound: true, overrides: { 'motion.ease': 'linear' } } })
    expect(graphicSoundCues(p, p.clips[1], s).map((c) => `${c.key}@${c.frame}`)).toEqual(['whoosh@304'])
  })

  it('a move held over the whole clip has no fastest frame, so no whoosh', () => {
    // A callout 10 frames long whose stroke starts at 2.0 − 0.45 = 1.55 s, after the clip has ended.
    expect(fastestFrame({ start: 1.55, seconds: 0.45, ease: 'expo-out' }, 30, 10)).toBeNull()
    const s = spec(callout(), [2.0])
    const p = project(30, [graphic('g1', 300, 10, s)])
    expect(graphicSoundCues(p, p.clips[1], s)).toEqual([])
    expect(graphicSounds(p, p.clips[1], s, CLIPS_GRAPHIC_RULE, ALL, { newId: ids() }).clips).toEqual([])
  })

  it('three whooshes of one call that overlap go on two lanes, never stacked on one', () => {
    // An energetic tree of two rows at 300, beats 0.65 and 1.05: the title enters (fastest 301), row 1's edge strokes from
    // 0.20 s (fastest 307), row 1 enters from 0.30 s (fastest 310); the cap keeps those three. fast_whoosh peaks
    // round(3.9) = 4 in, 8 frames long: 297+8. whoosh_fast round(5.4) = 5 in: 302, 0.35 × 30 measured 11 frames. sword_swish
    // round(4.5) = 5 in, 9 frames: 305+9, free again on the first lane from 305.
    const steps: GraphicData = { template: 'steps', title: 'Step by step', items: [{ label: 'one' }, { label: 'two' }], connector: 'tree' }
    const p = project(30, [graphic('g1', 300, 90, spec(steps, [0.65, 1.05], { style: 'energetic' }))])
    const out = graphicSounds(p, p.clips[1], p.clips[1].graphic!, CLIPS_GRAPHIC_RULE, ALL, { newId: ids() })
    expect(out.clips.map((c) => [c.start, c.duration])).toEqual([[297, 8], [302, 11], [305, 9]])
    expect(out.tracks).toHaveLength(2)
    for (const a of out.clips)
      for (const b of out.clips) if (a !== b && a.trackId === b.trackId) expect(a.start + a.duration <= b.start || b.start + b.duration <= a.start).toBe(true)
  })

  it('a sound whose start falls before frame 0 starts on 0, part-way into its file', () => {
    // An energetic counter at frame 0: the entrance is fastest on frame 1, fast_whoosh peaks 4 in: start −3, so 3 frames in, 8 − 3 long.
    const p = project(30, [graphic('g1', 0, 90, spec(counter(), [0.6], { style: 'energetic' }))])
    const out = graphicSounds(p, p.clips[1], p.clips[1].graphic!, CLIPS_GRAPHIC_RULE, ALL, { newId: ids() })
    expect(out.clips.map((c) => [c.start, c.duration, c.inPoint])).toEqual([[0, 5, 3], [18, 2, 0]])
  })

  it("a sound never runs past its graphic's end, and one whose peak falls at or after the end is dropped with its note", () => {
    // A counter at 60, beat 0.6 s: its tick (2 frames, peak 0 in) starts on 78. 19 frames long, the graphic ends on 79: one frame.
    const clamped = project(30, [graphic('g1', 60, 19, spec(counter(), [0.6]))])
    const kept = graphicSounds(clamped, clamped.clips[1], clamped.clips[1].graphic!, CLIPS_GRAPHIC_RULE, ALL, { newId: ids() })
    expect(kept.clips.map((c) => [c.start, c.duration])).toEqual([[78, 1]])
    expect(kept.notes).toEqual([])
    // 18 frames long, it ends on 78, the peak's own frame.
    const late = project(30, [graphic('g1', 60, 18, spec(counter(), [0.6]))])
    const dropped = graphicSounds(late, late.clips[1], late.clips[1].graphic!, CLIPS_GRAPHIC_RULE, ALL, { newId: ids() })
    expect(dropped.clips).toEqual([])
    expect(dropped.assets).toEqual([])
    expect(dropped.notes).toEqual(['the tick on "40%" falls after the graphic ends — not placed'])
  })

  it('at the track limit with no free lane, the sound is dropped with its note', () => {
    const base = project(30, [graphic('g1', 60, 90, spec(counter(), [0.6]))])
    const extra: Track[] = Array.from({ length: 8 }, (_, i) => ({ id: `ax${i}`, kind: 'audio', name: `AX${i}`, muted: false, hidden: false, locked: false }))
    const full = { ...base, tracks: [...base.tracks, ...extra] }
    expect(full.tracks).toHaveLength(12)
    const out = graphicSounds(full, full.clips[1], full.clips[1].graphic!, CLIPS_GRAPHIC_RULE, ALL, { newId: ids() })
    expect(out.clips).toEqual([])
    expect(out.tracks).toEqual([])
    expect(out.assets).toEqual([])
    expect(out.notes).toEqual(['no free audio track for the tick on "40%" — not placed'])
  })

  it('a locked "Graphic sounds" track or Sound design lane is never filled', () => {
    const g1 = graphic('g1', 60, 90, spec(counter(), [0.6]))
    const base = project(30, [g1])
    const locked = (id: string, name: string, director: boolean): Track => ({ id, kind: 'audio', name, muted: false, hidden: false, locked: true, ...(director ? { director: true as const } : {}) })
    const p = { ...base, tracks: [...base.tracks, locked('gs', GRAPHIC_SOUND_LANE_NAME, false), locked('sd', SOUND_LANE_NAME, true)] }
    for (const rule of [CLIPS_GRAPHIC_RULE, GRAPHIC_RULE]) {
      const out = graphicSounds(p, p.clips[1], g1.graphic!, rule, ALL, { newId: ids() })
      expect(out.tracks).toHaveLength(1)
      expect(out.clips[0].trackId).toBe(out.tracks[0].id)
    }
  })

  describe('the cues', () => {
    const at = (data: GraphicData, beats: number[], style: string, overrides?: Record<string, unknown>) => {
      const s = spec(data, beats, { style })
      const p = project(30, [graphic('g', 300, 180, s)], overrides ? { graphics: { styleId: 'clean', sound: true, overrides } } : {})
      return graphicSoundCues(p, p.clips[1], s).map((c) => `${c.key}@${c.frame}`)
    }
    const ring = (value = '40%'): GraphicData => ({ template: 'ring', value, label: 'more' })

    it("an energetic ring's arc is a stroke: under an accelerating ease it is fastest on its last step, its beat's frame", () => {
      // The arc draws from 0 to the beat, 0.6 s = 18 frames; an accelerating curve's steepest whole step is the last, 17 to 18.
      expect(at(ring(), [0.6], 'energetic', { 'motion.ease': 'accelerate' })).toContain('whoosh@318')
      // A counter has no arc.
      expect(at(counter(), [0.6], 'energetic', { 'motion.ease': 'accelerate' })).not.toContain('whoosh@318')
      // A value that is not a number draws no arc.
      expect(at(ring('many'), [0.6], 'energetic', { 'motion.ease': 'accelerate' })).not.toContain('whoosh@318')
    })

    it('two cues of one key on one frame are one: the default ring\'s entrance and arc are both fastest on frame 1', () => {
      expect(at(ring(), [0.6], 'energetic')).toEqual(['whoosh@301', 'tick@318'])
    })

    it('a tick goes before a whoosh on one frame', () => {
      // Beat 0.02 s is frame ceil(0.6) = 1, the frame the entrance is fastest on.
      expect(at(counter(), [0.02], 'energetic')).toEqual(['tick@301', 'whoosh@301'])
    })
  })
})

/* ------------------------------------------------------------------ the Clears */

describe('the sound Clear test (§6.14): each Clear takes exactly its own graphics’ sounds and files', () => {
  /** A drawn graphic asset, as graphicClipAsset makes one. */
  const drawn = (clipId: string): MediaAsset => ({ id: `graphic-asset-${clipId}`, path: '', name: 'graphic', kind: 'image', durationFrames: 300, size: 0, width: 1920, height: 1080, fps: null, hasVideo: true, hasAudio: false })

  /**
   * Over footage f1: a Clip-it counter g1 (its restrained tick, clock_tick.wav) and a Direct callout d1 on V2
   * (its stroke's whoosh, fast_whoosh.wav), each graphic's sounds placed by graphicSounds under its own rule.
   */
  function landed(extraAssets: MediaAsset[] = [], extraClips: Clip[] = []): Project {
    const g1 = graphic('g1', 60, 90, spec(counter(), [0.6]))
    const d1: Clip = { ...graphic('d1', 600, 75, spec(callout(), [0.55])), generatedBy: { rule: GRAPHIC_RULE, reason: 'r' } }
    let p = project(30, [g1, d1, ...extraClips], { assets: [drawn('g1'), drawn('d1'), ...extraAssets] })
    const newId = ids()
    p = merge(p, graphicSounds(p, g1, g1.graphic!, CLIPS_GRAPHIC_RULE, ALL, { newId }))
    p = merge(p, graphicSounds(p, d1, d1.graphic!, GRAPHIC_RULE, ALL, { newId }))
    return p
  }
  const soundOf = (p: Project, graphicId: string): Clip | undefined => p.clips.find((c) => c.forGraphic === graphicId)
  const fileAt = (p: Project, name: string): MediaAsset | undefined => p.assets.find((a) => a.path === `${LIB}/${name}`)
  /** Every file an app rule brought has a clip on it: no orphan in the pool. */
  const orphans = (p: Project): string[] => p.assets.filter((a) => a.broughtBy !== undefined && !p.clips.some((c) => c.assetId === a.id)).map((a) => a.id)

  it('the fixture: each graphic has its sound under its own rule, each file brought by that rule', () => {
    const p = landed()
    expect(soundOf(p, 'g1')!.generatedBy!.rule).toBe(CLIPS_GRAPHIC_RULE)
    expect(soundOf(p, 'd1')!.generatedBy!.rule).toBe(GRAPHIC_RULE)
    expect(fileAt(p, 'clock_tick.wav')!.broughtBy).toBe(CLIPS_GRAPHIC_RULE)
    expect(fileAt(p, 'fast_whoosh.wav')!.broughtBy).toBe(GRAPHIC_RULE)
  })

  it("(1) Direct's Clear leaves a Clip-it graphic's sound clip and its file", () => {
    const p = landed()
    const cleared = clearDirector(p)
    expect(cleared.clips.map((c) => c.id)).toContain('g1')
    expect(soundOf(cleared, 'g1')).toEqual(soundOf(p, 'g1'))
    expect(fileAt(cleared, 'clock_tick.wav')).toBeDefined()
    expect(cleared.assets.map((a) => a.id)).toContain('graphic-asset-g1')
  })

  it('(2) Clear graphics removes them: the graphic, its drawn asset, its sound and its file', () => {
    const p = landed()
    const cleared = clearGraphics(p)
    expect(cleared.clips.map((c) => c.id)).not.toContain('g1')
    expect(soundOf(cleared, 'g1')).toBeUndefined()
    expect(fileAt(cleared, 'clock_tick.wav')).toBeUndefined()
    expect(cleared.assets.map((a) => a.id)).not.toContain('graphic-asset-g1')
    // Direct's graphic stays, with its sound and its file.
    expect(cleared.clips.map((c) => c.id)).toContain('d1')
    expect(soundOf(cleared, 'd1')).toBeDefined()
    expect(fileAt(cleared, 'fast_whoosh.wav')).toBeDefined()
    expect(orphans(cleared)).toEqual([])
  })

  it("(3) Direct's Clear removes a Direct graphic's sound and its file", () => {
    const p = landed()
    const cleared = clearDirector(p)
    expect(cleared.clips.map((c) => c.id)).not.toContain('d1')
    expect(soundOf(cleared, 'd1')).toBeUndefined()
    expect(fileAt(cleared, 'fast_whoosh.wav')).toBeUndefined()
    expect(cleared.assets.map((a) => a.id)).not.toContain('graphic-asset-d1')
    expect(orphans(cleared)).toEqual([])
  })

  it("(4) the reused file: a Director sound on the file a Clip-it graphic brought; Clear graphics, then Direct's Clear, leaves no orphan in the pool", () => {
    const p0 = landed()
    const tick = fileAt(p0, 'clock_tick.wav')!
    const directorSound: Clip = { ...footage('ds', 900, 2), trackId: 'a1', assetId: tick.id, generatedBy: { rule: SOUND_RULE, reason: 'tick on the cut' } }
    const p = { ...p0, clips: [...p0.clips, directorSound] }
    const afterGraphics = clearGraphics(p)
    // The Director's sound still stands on it, so Clear graphics keeps the file.
    expect(fileAt(afterGraphics, 'clock_tick.wav')).toBeDefined()
    const afterBoth = clearDirector(afterGraphics)
    expect(fileAt(afterBoth, 'clock_tick.wav')).toBeUndefined()
    expect(orphans(afterBoth)).toEqual([])
  })

  it("(4), the other way: a Clip-it graphic's sound on the file a Direct graphic brought; Direct's Clear, then Clear graphics, leaves no orphan in the pool", () => {
    const p0 = landed()
    const whoosh = fileAt(p0, 'fast_whoosh.wav')!
    expect(whoosh.broughtBy).toBe(GRAPHIC_RULE)
    const clipsSound: Clip = { ...footage('cs', 100, 2), trackId: 'a1', assetId: whoosh.id, forGraphic: 'g1', generatedBy: { rule: CLIPS_GRAPHIC_RULE, reason: 'whoosh' } }
    const p = { ...p0, clips: [...p0.clips, clipsSound] }
    const afterDirect = clearDirector(p)
    // The Clip-it sound still stands on it, so Direct's Clear keeps the file.
    expect(fileAt(afterDirect, 'fast_whoosh.wav')).toBeDefined()
    const afterBoth = clearGraphics(afterDirect)
    expect(fileAt(afterBoth, 'fast_whoosh.wav')).toBeUndefined()
    expect(orphans(afterBoth)).toEqual([])
  })

  it('(5) a sound you imported, reused, survives both Clears', () => {
    const mine: MediaAsset = { id: 'mine', path: `${LIB}/clock_tick.wav`, name: 'clock_tick.wav', kind: 'audio', durationFrames: 2, width: null, height: null, fps: null, hasVideo: false, hasAudio: true, size: 4000 }
    // A Director sound stands on it too, so Direct's Clear removes a clip on your import and must still keep the file.
    const ds: Clip = { ...footage('ds', 900, 2), trackId: 'a1', assetId: 'mine', generatedBy: { rule: SOUND_RULE, reason: 'tick on the cut' } }
    const p = landed([mine], [ds])
    // Reused, not brought again.
    expect(soundOf(p, 'g1')!.assetId).toBe('mine')
    expect(p.assets.filter((a) => a.path === mine.path)).toHaveLength(1)
    for (const cleared of [clearDirector(clearGraphics(p)), clearGraphics(clearDirector(p))]) {
      expect(cleared.assets.find((a) => a.id === 'mine')).toEqual(mine)
      expect(soundOf(cleared, 'g1')).toBeUndefined()
    }
  })

  it("(6) Drop takes exactly its graphic's sounds: matched by forGraphic, never by time, with the file it brought", () => {
    // A Director sound on your own file, on the very frame of g1's tick and inside g1's span.
    const yours: MediaAsset = { id: 'yours', path: '/media/hit.wav', name: 'hit.wav', kind: 'audio', durationFrames: 2, width: null, height: null, fps: null, hasVideo: false, hasAudio: true, size: 4000 }
    const ds: Clip = { ...footage('ds', 78, 2), trackId: 'a1', assetId: 'yours', generatedBy: { rule: SOUND_RULE, reason: 'tick on the cut' } }
    const p = landed([yours], [ds])
    const tick = soundOf(p, 'g1')!
    // Worked by hand: g1 starts on 60, its beat 0.6 s is ceil(18) = 18 frames in; clock_tick peaks 0 frames in.
    expect(tick.start).toBe(78)
    expect(graphicFollowers(p, ['g1']).map((c) => c.id)).toEqual([tick.id])

    const dropped = removeWithFollowers(p, ['g1'])
    // Every clip but g1 and its tick, each as it was.
    expect(dropped.clips).toEqual(p.clips.filter((c) => c.id !== 'g1' && c.id !== tick.id))
    expect(dropped.clips.map((c) => c.id)).toContain('ds')
    expect(soundOf(dropped, 'd1')).toEqual(soundOf(p, 'd1'))
    // The file g1's tick brought goes with it; your file and Direct's whoosh file stay.
    expect(fileAt(dropped, 'clock_tick.wav')).toBeUndefined()
    expect(fileAt(dropped, 'fast_whoosh.wav')).toBeDefined()
    expect(dropped.assets.find((a) => a.id === 'yours')).toEqual(yours)
    expect(orphans(dropped)).toEqual([])
    // Nothing follows a clip that is not a graphic: the same project.
    expect(removeWithFollowers(dropped, [])).toBe(dropped)
  })

  it('(7) a pasted sound loses forGraphic: an ordinary sound, which Drop on the original never takes', () => {
    const p = landed()
    const tick = soundOf(p, 'g1')!
    const pasted = pasteClipboard(p, copySelection(p, [tick.id])!, 1200)
    const copy = pasted.project.clips.find((c) => c.id === pasted.ids[0])!
    expect(copy.forGraphic).toBeUndefined()
    expect(copy.assetId).toBe(tick.assetId)
    expect(copy.start).toBe(1200)
    const dropped = removeWithFollowers(pasted.project, ['g1'])
    expect(soundOf(dropped, 'g1')).toBeUndefined()
    expect(dropped.clips.find((c) => c.id === copy.id)).toEqual(copy)
    // The pasted sound still stands on the file, so it stays.
    expect(fileAt(dropped, 'clock_tick.wav')).toBeDefined()
  })
})

describe("a graphic's sounds follow it (§6.14): the store's pure half", () => {
  const counterAt = (id: string, start: number, assetId = 'asset-f1'): Clip => graphic(id, start, 90, spec(counter(), [0.6], { grounding: { assetId, sentence: 's', words: [] } }))
  /** A tick by hand: a CLIPS_GRAPHIC_RULE sound for `graphicId` on the brought file `fileId`. */
  const tickFor = (id: string, graphicId: string, start: number, fileId = 'tick-file'): Clip => ({
    ...footage(id, start, 2), trackId: 'a1', assetId: fileId, forGraphic: graphicId, generatedBy: { rule: CLIPS_GRAPHIC_RULE, reason: 'tick' }
  })
  const tickFile: MediaAsset = { id: 'tick-file', path: `${LIB}/clock_tick.wav`, name: 'clock_tick.wav', kind: 'audio', durationFrames: 2, width: null, height: null, fps: null, hasVideo: false, hasAudio: true, size: 1, broughtBy: CLIPS_GRAPHIC_RULE }
  const mineFile: MediaAsset = { id: 'mine', path: '/media/mine.wav', name: 'mine.wav', kind: 'audio', durationFrames: 30, width: null, height: null, fps: null, hasVideo: false, hasAudio: true, size: 4000 }
  const mine: Clip = { ...footage('mine-clip', 78, 30), trackId: 'a2', assetId: 'mine' }
  const at = (p: Project, id: string): Clip | undefined => p.clips.find((c) => c.id === id)

  it('followGraphicMoves shifts the sounds of a moved graphic by its own shift, and nothing else', () => {
    const before = project(30, [counterAt('g1', 60), counterAt('g2', 300), tickFor('s1', 'g1', 78), tickFor('s2', 'g2', 318), mine], { assets: [tickFile, mineFile] })
    const after = { ...before, clips: before.clips.map((c) => (c.id === 'g1' ? { ...c, start: 100 } : c)) }
    const moved = followGraphicMoves(before, after, ['g1'])
    // 78 + (100 − 60), by hand.
    expect(at(moved, 's1')!.start).toBe(118)
    expect(at(moved, 's1')!.inPoint).toBe(0)
    expect(at(moved, 's2')).toEqual(at(before, 's2'))
    expect(at(moved, 'mine-clip')).toEqual(mine)
    // A sound in the move itself already moved: it is not shifted a second time.
    const both = { ...after, clips: after.clips.map((c) => (c.id === 's1' ? { ...c, start: 118 } : c)) }
    expect(at(followGraphicMoves(before, both, ['g1', 's1']), 's1')!.start).toBe(118)
    // No graphic moved: the same project.
    expect(followGraphicMoves(before, before, [])).toBe(before)
  })

  it('a sound shifted before frame 0 starts on 0, part-way into its file, so its peak stays on its frame', () => {
    // A whoosh of 15 frames starting 5 frames before g1 (its peak 8 frames in), and g1 moved from 10 to 0.
    const whoosh: Clip = { ...tickFor('w1', 'g1', 5), duration: 15 }
    const before = project(30, [counterAt('g1', 10), whoosh], { assets: [tickFile] })
    const after = { ...before, clips: before.clips.map((c) => (c.id === 'g1' ? { ...c, start: 0 } : c)) }
    const w = at(followGraphicMoves(before, after, ['g1']), 'w1')!
    // Shifted to −5: start 0, 5 frames in, 10 left; its peak, at 13 before, is at 0 + (8 − 5) = 3 = 13 − 10.
    expect(w).toMatchObject({ start: 0, inPoint: 5, duration: 10 })
  })

  it('silenceGraphics takes every graphic sound and the files they brought; yours stay; the setting is false', () => {
    const p = project(30, [counterAt('g1', 60), tickFor('s1', 'g1', 78), mine], { assets: [tickFile, mineFile] })
    const off = silenceGraphics(p)
    expect(off.clips.map((c) => c.id)).toEqual(['f1', 'g1', 'mine-clip'])
    expect(off.assets.map((a) => a.id)).toEqual(['mine'])
    expect(off.graphics).toEqual({ styleId: 'clean', sound: false })
    expect(silenceGraphics(off)).toBe(off)
    // Its lanes stay, so placing again finds them.
    expect(off.tracks).toEqual(p.tracks)
  })

  it('soundAllGraphics places every graphic again: its own rule, the cap afresh per footage clip in onset order, none for a footage clip of only yours', () => {
    const f2 = { ...footage('f2', 3000, 1000), assetId: 'asset-f2' }
    const f3 = { ...footage('f3', 4000, 1000), assetId: 'asset-f3' }
    const yoursOnly: Clip = { ...counterAt('y1', 4100, 'asset-f3'), generatedBy: undefined }
    const direct: Clip = { ...counterAt('d2', 3100, 'asset-f2'), generatedBy: { rule: GRAPHIC_RULE, reason: 'r' } }
    // Placed out of onset order on purpose.
    const p = project(30, [f2, f3, counterAt('g4', 1200), counterAt('g2', 400), counterAt('g1', 60), counterAt('g3', 800), direct, yoursOnly], {
      graphics: { styleId: 'clean', sound: false }
    })
    const out = soundAllGraphics(p, ALL, { newId: ids() })
    expect(out.notes).toEqual([])
    expect(out.project.graphics?.sound).toBe(true)
    const starts = (g: string): number[] => out.project.clips.filter((c) => c.forGraphic === g).map((c) => c.start)
    // Each start by hand: the graphic's start + ceil(0.6 × 30) = + 18. f1's first three in onset order; g4 past the cap.
    expect(starts('g1')).toEqual([78])
    expect(starts('g2')).toEqual([418])
    expect(starts('g3')).toEqual([818])
    expect(starts('g4')).toEqual([])
    // f2's own three: Direct's graphic, under its own rule and on the Sound design lane.
    const d = out.project.clips.find((c) => c.forGraphic === 'd2')!
    expect(d.start).toBe(3118)
    expect(d.generatedBy?.rule).toBe(GRAPHIC_RULE)
    expect(out.project.tracks.find((t) => t.id === d.trackId)).toMatchObject({ name: SOUND_LANE_NAME, director: true })
    const g1 = out.project.clips.find((c) => c.forGraphic === 'g1')!
    expect(g1.generatedBy?.rule).toBe(CLIPS_GRAPHIC_RULE)
    expect(out.project.tracks.find((t) => t.id === g1.trackId)?.name).toBe(GRAPHIC_SOUND_LANE_NAME)
    // f3 holds only a graphic of yours: no run sounded it, so none comes back.
    expect(starts('y1')).toEqual([])
    // Already on: nothing.
    expect(soundAllGraphics(out.project, ALL).project).toBe(out.project)
    // No library: the one note, the setting on, nothing placed.
    const silent = soundAllGraphics(p, [])
    expect(silent.notes).toEqual([NO_SOUND_LIBRARY_NOTE])
    expect(silent.project.clips.filter((c) => c.forGraphic !== undefined)).toEqual([])
  })

  it('resoundGraphic re-places a graphic’s sounds on its new beats; a graphic of yours alone on its footage has none to re-place', () => {
    const base = project(30, [counterAt('g1', 60)])
    const placed = soundAllGraphics({ ...base, graphics: { styleId: 'clean', sound: false } }, ALL, { newId: ids() }).project
    expect(placed.clips.filter((c) => c.forGraphic === 'g1').map((c) => c.start)).toEqual([78])
    const edited = { ...placed, clips: placed.clips.map((c) => (c.id === 'g1' ? { ...c, graphic: { ...c.graphic!, beats: [1.0] } } : c)) }
    const out = resoundGraphic(edited, 'g1', ALL, { newId: ids() }).project
    // 60 + ceil(1.0 × 30) = 90, by hand; the old tick is gone, the file reused.
    expect(out.clips.filter((c) => c.forGraphic === 'g1').map((c) => c.start)).toEqual([90])
    expect(out.assets.filter((a) => a.path === `${LIB}/clock_tick.wav`)).toHaveLength(1)
    const yours = project(30, [{ ...counterAt('y1', 60), generatedBy: undefined }])
    expect(resoundGraphic(yours, 'y1', ALL).project).toBe(yours)
  })

  /*
   * The fixer's cases (after the two critics of piece 6). The fixture: g1 at
   * 60 with two ticks, s1 on 78 on the tick file the rule brought and s3 on
   * 100 on a clock tick you imported (no broughtBy, nothing else on it); an
   * orphaned whoosh file Direct brought, that no clip uses and no graphic
   * stood on; your own sound.
   */
  const importedFile: MediaAsset = { ...mineFile, id: 'imported', path: '/media/clock_tick.wav', name: 'clock_tick.wav', durationFrames: 2 }
  const staleFile: MediaAsset = { ...tickFile, id: 'stale', path: `${LIB}/fast_whoosh.wav`, name: 'fast_whoosh.wav', durationFrames: 8, broughtBy: GRAPHIC_RULE }
  const fixer = (): Project =>
    project(30, [counterAt('g1', 60), tickFor('s1', 'g1', 78), tickFor('s3', 'g1', 100, 'imported'), mine], { assets: [tickFile, importedFile, staleFile, mineFile] })
  const assetIds = (p: Project): string[] => p.assets.map((a) => a.id)

  it("(6) Drop sweeps only its sounds' brought files: a file you imported and another rule's orphan stay", () => {
    for (const out of [removeWithFollowers(fixer(), ['g1']), silenceGraphics(fixer())]) {
      expect(out.clips.filter((c) => c.forGraphic !== undefined)).toEqual([])
      expect(assetIds(out)).not.toContain('tick-file')
      // Your file, though a sound of g1's stood on it and nothing uses it now.
      expect(assetIds(out)).toContain('imported')
      // Not a file any removed clip stood on.
      expect(assetIds(out)).toContain('stale')
      expect(assetIds(out)).toContain('mine')
    }
  })

  it('(6) a graphic dropped together with its own sound (a marquee) still takes the file the sound brought', () => {
    const out = removeWithFollowers(fixer(), ['g1', 's1'])
    expect(out.clips.map((c) => c.id)).toEqual(['f1', 'mine-clip'])
    expect(assetIds(out)).toEqual(['imported', 'stale', 'mine'])
  })

  it('a sound shifted wholly before frame 0 is taken, with the file it brought', () => {
    // g1 from 60 to −20 (a shift of −80): s1, 2 frames on 78, would start on −2 and end on 0, nothing after 0.
    const before = project(30, [counterAt('g1', 60), tickFor('s1', 'g1', 78), mine], { assets: [tickFile, mineFile] })
    const after = { ...before, clips: before.clips.map((c) => (c.id === 'g1' ? { ...c, start: -20 } : c)) }
    const moved = followGraphicMoves(before, after, ['g1'])
    expect(at(moved, 's1')).toBeUndefined()
    expect(assetIds(moved)).toEqual(['mine'])
  })

  it('a drag left to 0 and back gives the whoosh its head back: the sound a fresh placement gives', () => {
    // Energetic: the counter's entrance whoosh. fast_whoosh is round(0.26 × 30) = 8 frames, its peak round(0.13 × 30) = 4 in;
    // placed on g1 at 30 its peak is on 31 (the entrance's), so it starts on 27, by hand.
    const off = project(30, [counterAt('g1', 30)], { graphics: { styleId: 'energetic', sound: false } })
    const placed = soundAllGraphics(off, ALL, { newId: ids() }).project
    const whooshOf = (p: Project): Clip => p.clips.find((c) => c.forGraphic === 'g1' && c.duration > 2)!
    expect(whooshOf(placed)).toMatchObject({ start: 27, inPoint: 0, duration: 8 })
    const step = (p: Project, to: number): Project => followGraphicMoves(p, { ...p, clips: p.clips.map((c) => (c.id === 'g1' ? { ...c, start: to } : c)) }, ['g1'])
    // To 0: starts on −3, so 0, 3 frames in, 5 left.
    const left = step(placed, 0)
    expect(whooshOf(left)).toMatchObject({ start: 0, inPoint: 3, duration: 5 })
    // Back to 30: 27, from the head, all 8.
    expect(whooshOf(step(left, 30))).toMatchObject({ start: 27, inPoint: 0, duration: 8 })
    // Part of the way back (to 2): 3 − 2 = 1 frame still cut.
    expect(whooshOf(step(left, 2))).toMatchObject({ start: 0, inPoint: 1, duration: 7 })
  })

  it('resoundGraphic on a graphic of yours re-places it under the earliest app graphic on its footage clip', () => {
    const d1: Clip = { ...counterAt('d1', 60), generatedBy: { rule: GRAPHIC_RULE, reason: 'r' } }
    const y1: Clip = { ...counterAt('y1', 300), generatedBy: undefined }
    const placed = soundAllGraphics(project(30, [d1, y1], { graphics: { styleId: 'clean', sound: false } }), ALL, { newId: ids() }).project
    // 300 + ceil(0.6 × 30) = 318, by hand, under Direct's rule.
    expect(placed.clips.filter((c) => c.forGraphic === 'y1').map((c) => [c.start, c.generatedBy?.rule])).toEqual([[318, GRAPHIC_RULE]])
    const edited = { ...placed, clips: placed.clips.map((c) => (c.id === 'y1' ? { ...c, graphic: { ...c.graphic!, beats: [1.0] } } : c)) }
    const out = resoundGraphic(edited, 'y1', ALL, { newId: ids() }).project
    // 300 + ceil(1.0 × 30) = 330, by hand.
    expect(out.clips.filter((c) => c.forGraphic === 'y1').map((c) => [c.start, c.generatedBy?.rule])).toEqual([[330, GRAPHIC_RULE]])
    expect(out.clips.filter((c) => c.forGraphic === 'd1').map((c) => c.start)).toEqual([78])
  })

  it('resoundGraphic with no library takes the edited graphic’s sounds off its old beats; the others stay', () => {
    const placed = soundAllGraphics(project(30, [counterAt('g1', 60), counterAt('g2', 300)], { graphics: { styleId: 'clean', sound: false } }), ALL, { newId: ids() }).project
    expect(placed.clips.filter((c) => c.forGraphic !== undefined).map((c) => c.start)).toEqual([78, 318])
    const edited = { ...placed, clips: placed.clips.map((c) => (c.id === 'g1' ? { ...c, graphic: { ...c.graphic!, beats: [1.0] } } : c)) }
    const out = resoundGraphic(edited, 'g1', [])
    expect(out.notes).toEqual([NO_SOUND_LIBRARY_NOTE])
    expect(out.project.clips.filter((c) => c.forGraphic === 'g1')).toEqual([])
    expect(out.project.clips.filter((c) => c.forGraphic === 'g2').map((c) => c.start)).toEqual([318])
    // g2's tick still stands on the tick file, so it stays.
    expect(out.project.assets.filter((a) => a.path === `${LIB}/clock_tick.wav`)).toHaveLength(1)
    // Alone: the file goes with it.
    const lone = soundAllGraphics(project(30, [counterAt('g1', 60)], { graphics: { styleId: 'clean', sound: false } }), ALL, { newId: ids() }).project
    const loneOut = resoundGraphic(lone, 'g1', []).project
    expect(loneOut.clips.filter((c) => c.forGraphic !== undefined)).toEqual([])
    expect(loneOut.assets.filter((a) => a.broughtBy !== undefined)).toEqual([])
  })
})
