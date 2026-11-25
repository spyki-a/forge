import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GRAPHICS_PER_MINUTE,
  ON_SCREEN_REASON,
  applyBudget,
  perClipReason,
  perMinuteReason,
  tooCloseReason,
  zoomPunchReason,
  type BudgetCandidate
} from '@shared/graphics/budget'
import { NO_CLIP_NOTE } from '@shared/graphics/place'
import { CLIPS_GRAPHIC_RULE, HERO_RULE, applyGraphics, drawnText, lowerThirdFor, withHeroes } from '@shared/graphics/apply'
import { drawListAt } from '@shared/graphics/drawList'
import { resolveGraphicStyle } from '@shared/graphics/style'
import { graphicBeats, graphicTiming } from '@shared/graphics/beats'
import { baselineGraphics } from '@shared/director/baselineGraphics'
import { runGraphicsPass } from '@shared/director/run'
import { GRAPHIC_TEMPLATES, ROOM_YIELDING_TEMPLATES, roomRank, type KeptGraphic } from '@shared/graphics/template'
import type { Transcript } from '@shared/transcript'
import { GRAPHICS_FIXTURE_DIR, loadGraphicsFixtures } from './eval/graphicsFixtures'
import { COPY_RULE, ENDING_RULE, GRAPHIC_RULE, SPINE_RULE } from '@shared/director/apply'
import type { GraphicData, GraphicSpec, GraphicTemplateId } from '@shared/graphics/template'
import type { Keyframe } from '@shared/render/keyframes'
import { seeded } from '@shared/render/moment'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MomentKind, type Project } from '@shared/timeline'

/*
 * docs/CLIPS.md §6.9's second half, the budget. Every project here is at
 * 30 fps, so a frame is 1/30 s and every time below is worked by hand from
 * frames: a candidate's onset is its start frame ÷ 30 plus its first beat.
 */

const FPS = 30

function clip(id: string, trackId: string, start: number, duration: number, patch: Partial<Clip> = {}): Clip {
  return { id, assetId: `asset-${id}`, trackId, start, duration, inPoint: 0, volume: 1, transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR }, ...patch }
}

/** A project with footage clips on V1 (`[id, startFrame, frames]`) and `extra` clips anywhere. */
function project(footage: [string, number, number][], extra: Clip[] = []): Project {
  const base = emptyProject('budget')
  return {
    ...base,
    settings: { ...base.settings, fps: FPS },
    assets: footage.map(([id]) => ({ id: `asset-${id}`, path: `/m/${id}.mp4`, name: `${id}.mp4`, kind: 'video' as const, durationFrames: 99999, width: 1080, height: 1920, fps: FPS, hasVideo: true, hasAudio: true, size: 1, speaker: 'Asha' })),
    clips: [...footage.map(([id, s, d]) => clip(id, 'v1', s, d)), ...extra]
  }
}

function dataOf(template: GraphicTemplateId): GraphicData {
  switch (template) {
    case 'lower-third':
      return { template, name: 'Asha', role: '' }
    case 'steps':
      return { template, title: 'Step by step', items: [{ label: 'one' }, { label: 'two' }], connector: 'none' }
    case 'screen-card':
      return { template, clipId: 'f', move: 'tilt-in' }
    case 'keyword':
      return { template, words: 'light', lit: 0 }
    case 'ring':
      return { template, value: '40%', label: 'couples' }
    default:
      return { template: 'counter', value: '40%', label: 'more' }
  }
}

interface Cand extends BudgetCandidate {
  name: string
}

/** A candidate starting at `startFrame`, `frames` long, its beats seconds from its start (first 0.5, as LEAD_S puts it). */
function cand(name: string, template: GraphicTemplateId, startFrame: number, frames: number, patch: Partial<Cand> & { beats?: number[] } = {}): Cand {
  const { beats, ...rest } = patch
  return { name, clipId: 'f', rule: CLIPS_GRAPHIC_RULE, start: startFrame, duration: frames, spec: { data: dataOf(template), beats: beats ?? [0.5] }, ...rest }
}

/** A graphic clip already on the timeline. */
function graphicClip(id: string, template: GraphicTemplateId, start: number, duration: number, beats = [0.5]): Clip {
  const spec: GraphicSpec = { data: dataOf(template), seconds: duration / FPS, beats, place: { auto: true, third: 'middle' }, seed: 1, version: 1 }
  return clip(id, 'v3', start, duration, { graphic: spec, generatedBy: { rule: CLIPS_GRAPHIC_RULE, reason: 'test' } })
}

function moment(id: string, kind: MomentKind, start: number, duration: number): Clip {
  return clip(id, 'v2', start, duration, { moment: { kind, to: { clipId: 'f' }, seconds: duration / FPS, intensity: 0.5, seed: 1, version: 1 }, generatedBy: { rule: 'director.moment', reason: 'test' } })
}

const names = (r: { kept: Cand[] }): string[] => r.kept.map((c) => c.name)
const reasons = (r: { dropped: { spec: unknown; reason: string }[] }): string[] => r.dropped.map((d) => d.reason)

describe('applyBudget, rule 1: the spacing (D12)', () => {
  it('keeps onsets exactly 6 s apart and drops one a frame closer; the earlier wins whatever the order given', () => {
    // Clip 60 s (1800 frames): room for 3. Onsets: a 0.5 s; b 0.5 + (179 frames = 5.9667 s) = 6.4667 s; c 6.5 s.
    const p = project([['f', 0, 1800]])
    const a = cand('a', 'counter', 0, 75)
    const b = cand('b', 'counter', 179, 75)
    const c = cand('c', 'counter', 180, 75)
    const r = applyBudget(p, [c, b, a])
    expect(names(r)).toEqual(['a', 'c'])
    expect(r.dropped).toEqual([{ spec: b.spec, reason: 'within 6 s of the counter at 0.5 s, the earlier one stays' }])
  })

  it('the earlier of two too-close candidates wins, even given second', () => {
    const p = project([['f', 0, 1800]])
    const late = cand('late', 'counter', 300, 75) // onset 10.5 s
    const early = cand('early', 'counter', 210, 75) // onset 7.5 s
    const r = applyBudget(p, [late, early])
    expect(names(r)).toEqual(['early'])
    expect(r.dropped.map((d) => d.spec)).toEqual([late.spec])
  })

  it('at most max(1, floor(clip seconds / 20)) over the footage clip: a 30 s clip takes 1, a 40 s clip 2, a 59.9 s clip 2', () => {
    const two = [cand('a', 'counter', 0, 75), cand('b', 'counter', 600, 75)] // onsets 0.5 s and 20.5 s
    const r30 = applyBudget(project([['f', 0, 900]]), two)
    expect(names(r30)).toEqual(['a'])
    expect(reasons(r30)).toEqual(['at most one graphic per 20 s of clip, the earlier ones stay'])
    expect(perClipReason('clip', 'counter')).toBe('at most one graphic per 20 s of clip, the ones on the timeline already and the earlier ones stay')
    expect(names(applyBudget(project([['f', 0, 1200]]), two))).toEqual(['a', 'b'])
    const three = [...two, cand('c', 'counter', 1200, 75)] // onset 40.5 s
    const r599 = applyBudget(project([['f', 0, 1797]]), three)
    expect(names(r599)).toEqual(['a', 'b'])
    expect(reasons(r599)).toEqual(['at most one graphic per 20 s of clip, the earlier ones stay'])
  })

  it("counts over the candidate's own footage clip for Clip it, and over the whole ad for Direct", () => {
    // Three 10 s shots back to back, a 40 s ad (the music clip runs to 1200): one graphic on each shot.
    const music = clip('m', 'a1', 0, 1200)
    const p = project([['f', 0, 300], ['g', 300, 300], ['h', 600, 300]], [music])
    const on = (rule: string): Cand[] => [
      cand('a', 'counter', 0, 75, { rule }), // onset 0.5 s on f
      cand('b', 'counter', 330, 75, { rule, clipId: 'g' }), // onset 11.5 s on g
      cand('c', 'counter', 660, 75, { rule, clipId: 'h' }) // onset 22.5 s on h
    ]
    expect(names(applyBudget(p, on(CLIPS_GRAPHIC_RULE)))).toEqual(['a', 'b', 'c'])
    const direct = applyBudget(p, on(GRAPHIC_RULE))
    expect(names(direct)).toEqual(['a', 'b'])
    expect(reasons(direct)).toEqual(['at most one graphic per 20 s of the ad, the earlier ones stay'])
  })

  it('a graphic already on the timeline holds first, even against an earlier candidate', () => {
    const p = project([['f', 0, 1800]], [graphicClip('g1', 'counter', 600, 75)]) // onset 20.5 s
    const r = applyBudget(p, [cand('a', 'counter', 480, 75)]) // onset 16.5 s
    expect(names(r)).toEqual([])
    expect(reasons(r)).toEqual(['within 6 s of the counter at 20.5 s, which is on the timeline already'])
  })

  it('on a 30 s clip with a Speaker, the lower third and a counter 8 s later are both kept; the lower third keeps the 6 s gap', () => {
    const p = project([['f', 0, 900]])
    expect(p.assets[0].speaker).toBe('Asha')
    const lower = cand('lower', 'lower-third', 0, 105) // onset 0.5 s, 3.5 s long
    const counter = cand('counter', 'counter', 240, 75) // onset 8.5 s
    expect(names(applyBudget(p, [counter, lower]))).toEqual(['lower', 'counter'])
    const close = cand('close', 'counter', 120, 75) // onset 4.5 s, after the lower third's end (3.5 s)
    const r = applyBudget(p, [lower, close])
    expect(names(r)).toEqual(['lower'])
    expect(reasons(r)).toEqual(['within 6 s of the lower third at 0.5 s, the earlier one stays'])
  })

  it('a lower third already on the timeline is outside the count too', () => {
    const p = project([['f', 0, 900]], [graphicClip('l1', 'lower-third', 0, 105)])
    expect(names(applyBudget(p, [cand('counter', 'counter', 240, 75)]))).toEqual(['counter'])
  })

  it("a lower third candidate is kept on a 30 s clip whose one slot a counter already holds", () => {
    // The counter on the timeline: onset 0.5 s. The lower third: onset 300/30 + 0.5 = 10.5 s, 10 s later.
    const p = project([['f', 0, 900]], [graphicClip('g1', 'counter', 0, 75)])
    expect(names(applyBudget(p, [cand('lower', 'lower-third', 300, 105)]))).toEqual(['lower'])
    // A counter there instead takes no second slot.
    expect(reasons(applyBudget(p, [cand('counter', 'counter', 300, 75)]))).toEqual(['at most one graphic per 20 s of clip, the ones on the timeline already stay'])
  })

  it('drops a candidate whose footage clip is gone', () => {
    const r = applyBudget(project([['f', 0, 900]]), [cand('a', 'counter', 0, 75, { clipId: 'nope' })])
    expect(reasons(r)).toEqual([NO_CLIP_NOTE])
  })

  it('an onset is the start plus the FIRST beat, a first beat of 0 included', () => {
    const p = project([['f', 0, 1800]])
    // a: 0/30 + 0 = 0 s. b: 165/30 + 0.5 = 6.0 s. Exactly 6 s apart: both kept.
    expect(names(applyBudget(p, [cand('a', 'counter', 0, 75, { beats: [0] }), cand('b', 'counter', 165, 75)]))).toEqual(['a', 'b'])
    // a: 15/30 + 0.6 = 1.1 s. b: 195/30 + 0 = 6.5 s. 5.4 s apart: b dropped, though their starts are 6 s apart.
    const r = applyBudget(p, [cand('a', 'counter', 15, 75, { beats: [0.6, 1.4] }), cand('b', 'counter', 195, 75, { beats: [0] })])
    expect(names(r)).toEqual(['a'])
    expect(reasons(r)).toEqual([tooCloseReason({ template: 'counter', onset: 1.1, placed: false }, 'earlier')])
    expect(tooCloseReason({ template: 'counter', onset: 1.1, placed: false }, 'earlier')).toBe('within 6 s of the counter at 1.1 s, the earlier one stays')
  })

  it('two onsets 6 s apart that add up to 5.9999999 s in floating point are both kept', () => {
    // 51/30 + 0.5 and 231/30 + 0.5: 180 frames, 6 s, apart, but their difference is computed below 6.
    expect(231 / 30 + 0.5 - (51 / 30 + 0.5)).toBeLessThan(6)
    expect(names(applyBudget(project([['f', 0, 1800]]), [cand('a', 'counter', 51, 75), cand('b', 'counter', 231, 75)]))).toEqual(['a', 'b'])
  })

  it("counts only the graphics whose onset is on the candidate's own clip, not the next shot's, its first frame included", () => {
    // f is 10 s (one slot), g follows it. h1's onset is 285/30 + 0.5 = 10.0 s, g's first frame; h2's is 420/30 + 0.5 = 14.5 s, on g.
    for (const held of [graphicClip('h1', 'counter', 285, 75), graphicClip('h2', 'counter', 420, 75)]) {
      const p = project([['f', 0, 300], ['g', 300, 300]], [held])
      expect(names(applyBudget(p, [cand('a', 'counter', 0, 75)])), held.id).toEqual(['a'])
    }
  })

  it('equal onsets: the one given first wins', () => {
    const p = project([['f', 0, 1800]])
    expect(names(applyBudget(p, [cand('y', 'counter', 300, 75), cand('x', 'counter', 300, 75)]))).toEqual(['y'])
  })
})

describe('applyBudget: room by rank, then time (try-out 1, 2026-11-15)', () => {
  it('roomRank: a keyword yields, every other template ranks first', () => {
    expect(roomRank('keyword')).toBe(1)
    for (const t of ['counter', 'ring', 'bars', 'steps', 'quote', 'callout', 'lower-third'] as const) expect(roomRank(t), t).toBe(0)
    expect(ROOM_YIELDING_TEMPLATES).toContain('keyword')
  })

  it('rank before time: a keyword 3 s BEFORE a counter loses the gap to it, whatever order they are given', () => {
    const p = project([['f', 0, 1800]]) // 60 s: room for 3
    const keyword = cand('keyword', 'keyword', 0, 75) // onset 0.5 s
    const counter = cand('counter', 'counter', 90, 75) // onset 3.5 s
    for (const given of [[keyword, counter], [counter, keyword]]) {
      const r = applyBudget(p, given)
      expect(names(r)).toEqual(['counter'])
      expect(r.dropped).toEqual([{ spec: keyword.spec, reason: 'within 6 s of the counter at 3.5 s; a keyword yields to any other graphic' }])
    }
  })

  it('inside a rank the earlier wins: two keywords 3 s apart, the earlier stays, given in either order', () => {
    const p = project([['f', 0, 1800]])
    const early = cand('early', 'keyword', 0, 75) // 0.5 s
    const late = cand('late', 'keyword', 90, 75) // 3.5 s
    for (const given of [[early, late], [late, early]]) {
      const r = applyBudget(p, given)
      expect(names(r)).toEqual(['early'])
      expect(reasons(r)).toEqual(['within 6 s of the keyword at 0.5 s, the earlier one stays'])
    }
  })

  it('a graphic already on the timeline still holds against a later-found number, even a keyword', () => {
    const p = project([['f', 0, 1800]], [graphicClip('k1', 'keyword', 300, 75)]) // a placed keyword, onset 10.5 s
    const r = applyBudget(p, [cand('counter', 'counter', 390, 75)]) // onset 13.5 s
    expect(names(r)).toEqual([])
    expect(reasons(r)).toEqual(['within 6 s of the keyword at 10.5 s, which is on the timeline already'])
  })

  it('the count cap is filled by non-keywords first: on a 30 s clip a counter 20 s AFTER a keyword takes the one place', () => {
    const p = project([['f', 0, 900]]) // 30 s: room for 1
    const keyword = cand('keyword', 'keyword', 0, 75) // 0.5 s
    const counter = cand('counter', 'counter', 600, 75) // 20.5 s
    const r = applyBudget(p, [keyword, counter])
    expect(names(r)).toEqual(['counter'])
    // Only the counter holds the place: the reason names that, and no "earlier keywords" or timeline graphics that are not there.
    expect(reasons(r)).toEqual(['at most one graphic per 20 s of clip; a keyword yields to any other graphic'])
    expect(perClipReason('clip', 'keyword')).toBe(
      'at most one graphic per 20 s of clip; a keyword yields to any other graphic, and the ones on the timeline already and the earlier keywords stay'
    )
    // With room for two, both: the cap, not the rank, decides.
    expect(names(applyBudget(project([['f', 0, 1200]]), [keyword, counter]))).toEqual(['keyword', 'counter'])
  })

  it('the count reason names only what holds the places: an earlier keyword, a graphic on the timeline, or an earlier number', () => {
    // 30 s clips: room for 1. Onsets 0.5 s and 20.5 s.
    const k1 = cand('k1', 'keyword', 0, 75)
    const k2 = cand('k2', 'keyword', 600, 75)
    expect(reasons(applyBudget(project([['f', 0, 900]]), [k2, k1]))).toEqual(['at most one graphic per 20 s of clip, the earlier keywords stay'])
    const placed = project([['f', 0, 900]], [graphicClip('g', 'counter', 0, 75)])
    expect(reasons(applyBudget(placed, [k2]))).toEqual(['at most one graphic per 20 s of clip, the ones on the timeline already stay'])
    expect(reasons(applyBudget(placed, [cand('c', 'counter', 600, 75)]))).toEqual(['at most one graphic per 20 s of clip, the ones on the timeline already stay'])
    expect(reasons(applyBudget(project([['f', 0, 900]]), [cand('c2', 'counter', 600, 75), cand('c1', 'counter', 0, 75)]))).toEqual([
      'at most one graphic per 20 s of clip, the earlier ones stay'
    ])
  })

  it('the gap reason names the NEAREST held graphic, not the first one held', () => {
    // A ring at 2.0 s and a counter at 8.5 s are both kept (6.5 s apart); a keyword at 7.5 s is within 6 s of both, nearest the counter.
    const p = project([['f', 0, 1800]])
    const ring = cand('ring', 'ring', 45, 75) // 1.5 + 0.5 = 2.0 s
    const counter = cand('counter', 'counter', 240, 75) // 8.0 + 0.5 = 8.5 s
    const keyword = cand('keyword', 'keyword', 210, 75) // 7.0 + 0.5 = 7.5 s
    const r = applyBudget(p, [ring, counter, keyword])
    expect(names(r)).toEqual(['ring', 'counter'])
    expect(reasons(r)).toEqual(['within 6 s of the counter at 8.5 s; a keyword yields to any other graphic'])
  })

  it('the drops come out in onset order too, though the keywords were weighed after the number', () => {
    const p = project([['f', 0, 1800]])
    const k = cand('k', 'keyword', 0, 75) // 0.5 s, within 6 s of the ring
    const ring = cand('ring', 'ring', 90, 75) // 3.5 s
    const late = cand('late', 'counter', 150, 75) // 5.5 s, within 6 s of the ring
    const r = applyBudget(p, [late, ring, k])
    expect(names(r)).toEqual(['ring'])
    expect(r.dropped.map((d) => d.spec)).toEqual([k.spec, late.spec])
  })

  it('what comes out is in onset order, though the counter was weighed first; the lower third is still outside the count', () => {
    const p = project([['f', 0, 1200]]) // 40 s: room for 2
    const lower = cand('lower', 'lower-third', 0, 105) // 0.5 s
    const keyword = cand('keyword', 'keyword', 210, 75) // 7.5 s
    const counter = cand('counter', 'counter', 600, 75) // 20.5 s
    const r = applyBudget(p, [counter, keyword, lower])
    expect(names(r)).toEqual(['lower', 'keyword', 'counter'])
    expect(r.dropped).toEqual([])
  })

  it("the reasons' three gaps, as the dock shows them", () => {
    const other = { template: 'lower-third', onset: 3.66, placed: false }
    expect(tooCloseReason(other, 'outranked')).toBe('within 6 s of the lower third at 3.7 s; a keyword yields to any other graphic')
    expect(tooCloseReason(other, 'earlier')).toBe('within 6 s of the lower third at 3.7 s, the earlier one stays')
    expect(tooCloseReason({ ...other, placed: true }, 'placed')).toBe('within 6 s of the lower third at 3.7 s, which is on the timeline already')
    // No reason still says a keyword lost to "the earlier one" when it lost to a later number.
    const r = applyBudget(project([['f', 0, 1800]]), [cand('k', 'keyword', 0, 75), cand('ring', 'ring', 90, 75)])
    expect(reasons(r)).toEqual(['within 6 s of the ring at 3.5 s; a keyword yields to any other graphic'])
  })
})

describe('applyBudget, rule 2: one on screen', () => {
  it('a steps 8 s long and a counter 6.5 s after it: the counter is dropped although the spacing passes', () => {
    const p = project([['f', 0, 1800]]) // room for 3 by count
    const steps = cand('steps', 'steps', 0, 240) // frames [0, 240), onset 0.5 s
    const counter = cand('counter', 'counter', 195, 75) // onset 6.5 + 0.5 = 7.0 s; frames [195, 270)
    const r = applyBudget(p, [steps, counter])
    expect(names(r)).toEqual(['steps'])
    expect(reasons(r)).toEqual([ON_SCREEN_REASON])
    expect(ON_SCREEN_REASON).toBe('another graphic is on screen then')
    // Starting on the steps' last frame + 1 is no overlap.
    expect(names(applyBudget(p, [steps, cand('after', 'counter', 240, 75)]))).toEqual(['steps', 'after'])
  })

  it('a graphic already on the timeline is on screen for its whole span', () => {
    // The steps on the timeline: frames [0, 240), onset 0.5 s. The counter: onset 7.0 s, frames [195, 270).
    const p = project([['f', 0, 1800]], [graphicClip('s1', 'steps', 0, 240)])
    expect(reasons(applyBudget(p, [cand('counter', 'counter', 195, 75)]))).toEqual([ON_SCREEN_REASON])
  })

  it('a Director card counts as one (COPY_RULE and ENDING_RULE); a shot of the spine does not', () => {
    for (const rule of [COPY_RULE, ENDING_RULE]) {
      const card = clip('card', 'v2', 300, 90, { generatedBy: { rule, reason: 'test' } }) // 10 s to 13 s
      const r = applyBudget(project([['f', 0, 1800]], [card]), [cand('a', 'counter', 330, 75)]) // 11 s to 13.5 s
      expect(reasons(r)).toEqual([ON_SCREEN_REASON])
    }
    const shot = clip('shot', 'v2', 300, 90, { generatedBy: { rule: SPINE_RULE, reason: 'test' } })
    expect(names(applyBudget(project([['f', 0, 1800]], [shot]), [cand('a', 'counter', 330, 75)]))).toEqual(['a'])
  })
})

describe('applyBudget, rule 3: none over a zoom punch', () => {
  it('drops a graphic over a zoom-punch moment, with its time; another moment kind does not count', () => {
    const punch = moment('z', 'zoom-punch', 372, 12) // 12.4 s to 12.8 s
    const r = applyBudget(project([['f', 0, 1800]], [punch]), [cand('a', 'counter', 330, 75)]) // 11 s to 13.5 s
    expect(names(r)).toEqual([])
    expect(reasons(r)).toEqual(['over a zoom punch at 12.4 s'])
    expect(zoomPunchReason(12.4)).toBe('over a zoom punch at 12.4 s')
    const whip = moment('w', 'whip-blur', 372, 12)
    expect(names(applyBudget(project([['f', 0, 1800]], [whip]), [cand('a', 'counter', 330, 75)]))).toEqual(['a'])
  })

  it('drops a graphic over a zoom move on the footage clip beneath; a held zoom, even of 1.2, is allowed', () => {
    // The footage clip starts at frame 60 (2 s); its keys are frames from its own start: 1 → 1.2 over [300, 330), so 12 s to 13 s.
    const keys: Keyframe[] = [{ frame: 0, value: 1 }, { frame: 300, value: 1 }, { frame: 330, value: 1.2 }, { frame: 900, value: 1.2 }]
    const p = project([['f', 60, 1800]])
    p.clips[0] = { ...p.clips[0], keyframes: { zoom: keys } }
    const over = applyBudget(p, [cand('over', 'counter', 330, 75)]) // 11 s to 13.5 s
    expect(reasons(over)).toEqual(['over a zoom punch at 12.0 s'])
    expect(names(applyBudget(p, [cand('held', 'counter', 600, 75)]))).toEqual(['held']) // 20 s to 22.5 s, held at 1.2
    expect(names(applyBudget(p, [cand('before', 'counter', 285, 75)]))).toEqual(['before']) // ends on frame 360, the move's first
  })

  it('names the earliest punch under the graphic', () => {
    // Punches at frames 372 (12.4 s) and 390 (13.0 s), both under the counter's [330, 405).
    const p = project([['f', 0, 1800]], [moment('z1', 'zoom-punch', 372, 6), moment('z2', 'zoom-punch', 390, 6)])
    expect(reasons(applyBudget(p, [cand('a', 'counter', 330, 75)]))).toEqual(['over a zoom punch at 12.4 s'])
  })

  it("a key whose ease is 'hold' keeps its zoom to the next key and jumps on that key's frame: only that frame is a punch", () => {
    // 1 held from frame 0, 1.2 on frame 1500 (50 s): the zoom changes on frame 1500 alone (render/keyframes.ts, eased: hold → 0).
    const p = project([['f', 0, 1800]])
    p.clips[0] = { ...p.clips[0], keyframes: { zoom: [{ frame: 0, value: 1, ease: 'hold' }, { frame: 1500, value: 1.2 }] } }
    expect(names(applyBudget(p, [cand('held', 'counter', 300, 60)]))).toEqual(['held']) // 10 s to 12 s, zoom 1 throughout
    expect(names(applyBudget(p, [cand('ends', 'counter', 1425, 75)]))).toEqual(['ends']) // [1425, 1500): ends before the jump
    expect(reasons(applyBudget(p, [cand('jump', 'counter', 1500, 75)]))).toEqual(['over a zoom punch at 50.0 s'])
  })

  it('a zoom move counts only where its footage clip is on the timeline, and is named from the first frame it is seen', () => {
    // A head trim rebased the keys to before the clip's start: 1 → 1.3 over the clip's own frames [-30, 30).
    // At start 300 the move is seen over [300, 330): 10.0 s, not 9.0 s.
    const trimmed = project([['f', 300, 1500]])
    trimmed.clips[0] = { ...trimmed.clips[0], keyframes: { zoom: [{ frame: -30, value: 1 }, { frame: 30, value: 1.3 }] } }
    expect(reasons(applyBudget(trimmed, [cand('a', 'counter', 300, 75)]))).toEqual(['over a zoom punch at 10.0 s'])
    // At start 0, keys [-60, 30): seen from frame 0, so 0.0 s, never a negative time.
    const atZero = project([['f', 0, 1800]])
    atZero.clips[0] = { ...atZero.clips[0], keyframes: { zoom: [{ frame: -60, value: 1 }, { frame: 30, value: 1.3 }] } }
    expect(reasons(applyBudget(atZero, [cand('a', 'counter', 0, 75)]))).toEqual(['over a zoom punch at 0.0 s'])
    // A tail trim left a move past the clip's end: f is [0, 300), its keys move over its own [300, 330), where g is shown.
    const tail = project([['f', 0, 300], ['g', 300, 300]])
    tail.clips[0] = { ...tail.clips[0], keyframes: { zoom: [{ frame: 300, value: 1 }, { frame: 330, value: 1.3 }] } }
    expect(names(applyBudget(tail, [cand('a', 'counter', 270, 75)]))).toEqual(['a'])
  })
})

describe('applyBudget, rule 4: the per-minute cap', () => {
  it('is null until M17, and when set no 60 s window holds more than it', () => {
    expect(GRAPHICS_PER_MINUTE).toBeNull()
    const p = project([['f', 0, 3600]]) // 120 s: room for 6 by count
    const set = [cand('a', 'counter', 15, 75), cand('b', 'counter', 225, 75), cand('c', 'counter', 435, 75), cand('d', 'counter', 1830, 75)]
    // Onsets 1, 8, 15 and 61.5 s. With 2 a minute: c is the third inside [1, 61); d sits with b alone in [8, 68).
    const capped = applyBudget(p, set, { perMinute: 2 })
    expect(names(capped)).toEqual(['a', 'b', 'd'])
    expect(reasons(capped)).toEqual([perMinuteReason(2)])
    expect(perMinuteReason(2)).toBe('more than 2 graphics in a minute')
    expect(names(applyBudget(p, set))).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('applyBudget: the screen card is outside the budget', () => {
  it('is kept, and counts toward neither the spacing, the count nor one-on-screen', () => {
    const p = project([['f', 0, 900]]) // 30 s: room for 1
    const card = cand('card', 'screen-card', 0, 300) // 0 to 10 s, onset 0.5 s
    const counter = cand('counter', 'counter', 45, 75) // onset 2 s, over the card
    expect(names(applyBudget(p, [card, counter]))).toEqual(['card', 'counter'])
    const onLine = project([['f', 0, 900]], [graphicClip('sc', 'screen-card', 0, 300)])
    expect(names(applyBudget(onLine, [counter]))).toEqual(['counter'])
    // Kept even over a punch (frames 30-42, under the card, not the counter): no rule is read for it.
    const punched = project([['f', 0, 900]], [moment('z', 'zoom-punch', 30, 12)])
    expect(names(applyBudget(punched, [counter, cand('card2', 'screen-card', 0, 300)]))).toEqual(['card2', 'counter'])
  })

  it('is still dropped when its footage clip is gone', () => {
    expect(reasons(applyBudget(project([['f', 0, 900]]), [cand('card', 'screen-card', 0, 300, { clipId: 'gone' })]))).toEqual([NO_CLIP_NOTE])
  })
})

/* ---------------------------------------------------------------- the property */

/** Independent of budget.ts: a candidate's frames, and whether two frame spans overlap. */
const overlap = (a: [number, number], b: [number, number]): boolean => a[0] < b[1] && b[0] < a[1]

/**
 * §6.12's property, written so lane T4 only feeds it: whatever `applyBudget`
 * keeps from `candidates` on `project`, no kept graphic overlaps another (nor
 * a held graphic or a Director card) in time, none sits over a zoom-punch
 * moment or a zoom move on its footage, and onsets are 6 s apart. A screen
 * card is outside it.
 */
function assertBudgetHolds(p: Project, candidates: Cand[]): { kept: number; dropped: number; reasons: string[] } {
  const r = applyBudget(p, candidates)
  const spans: { span: [number, number]; onset: number }[] = []
  for (const c of p.clips) {
    if (c.graphic && c.graphic.data.template !== 'screen-card') spans.push({ span: [c.start, c.start + c.duration], onset: c.start / FPS + Math.min(...c.graphic.beats) })
  }
  const cards = p.clips.filter((c) => c.generatedBy?.rule === COPY_RULE || c.generatedBy?.rule === ENDING_RULE).map((c): [number, number] => [c.start, c.start + c.duration])
  const punches = p.clips.filter((c) => c.moment?.kind === 'zoom-punch').map((c): [number, number] => [c.start, c.start + c.duration])
  for (const k of r.kept) {
    if (k.spec.data.template === 'screen-card') continue
    const span: [number, number] = [k.start, k.start + k.duration]
    const onset = k.start / FPS + Math.min(...k.spec.beats)
    const footage = p.clips.find((c) => c.id === k.clipId)!
    const keys = footage.keyframes?.zoom ?? []
    const moves = keys.slice(1).flatMap((key, i): [number, number][] => (key.value !== keys[i].value ? [[footage.start + keys[i].frame, footage.start + key.frame]] : []))
    for (const s of spans) {
      expect(overlap(span, s.span), `${k.name} overlaps a kept graphic`).toBe(false)
      expect(Math.abs(onset - s.onset) >= 6 - 1e-6, `${k.name} within 6 s`).toBe(true)
    }
    for (const c of cards) expect(overlap(span, c), `${k.name} over a card`).toBe(false)
    for (const q of [...punches, ...moves]) expect(overlap(span, q), `${k.name} over a punch`).toBe(false)
    spans.push({ span, onset })
  }
  expect(r.kept.length + r.dropped.length).toBe(candidates.length)
  return { kept: r.kept.length, dropped: r.dropped.length, reasons: r.dropped.map((d) => d.reason) }
}

const TEMPLATES: GraphicTemplateId[] = ['counter', 'steps', 'lower-third', 'screen-card']

/** A seeded project: one footage clip, maybe zoom keys, punches, cards and graphics already placed. */
function generated(seed: number): { p: Project; candidates: Cand[] } {
  const random = seeded(seed)
  const int = (n: number): number => Math.floor(random() * n)
  const length = 600 + int(2400) // 20 s to 100 s
  const extra: Clip[] = []
  for (let i = int(3); i > 0; i--) extra.push(moment(`z${i}`, random() < 0.6 ? 'zoom-punch' : 'whip-blur', int(length), 9 + int(12)))
  for (let i = int(2); i > 0; i--) extra.push(clip(`k${i}`, 'v2', int(length), 60 + int(60), { generatedBy: { rule: random() < 0.5 ? COPY_RULE : ENDING_RULE, reason: 'g' } }))
  if (random() < 0.4) extra.push(graphicClip('held', 'counter', int(length - 90), 90))
  const p = project([['f', 0, length]], extra)
  if (random() < 0.5) {
    const a = int(length - 30)
    p.clips[0] = { ...p.clips[0], keyframes: { zoom: [{ frame: 0, value: 1 }, { frame: a, value: 1 }, { frame: a + 15, value: random() < 0.5 ? 1 : 1.3 }] } }
  }
  const candidates = Array.from({ length: 2 + int(10) }, (_, i) => {
    const frames = 45 + int(200)
    return cand(`c${i}`, TEMPLATES[int(TEMPLATES.length)], int(Math.max(1, length - frames)), frames, { beats: [random() < 0.3 ? 0 : 0.5, 0.5 + random() * 2] })
  })
  return { p, candidates }
}

interface FixtureSpec {
  id: string
  spec: GraphicSpec
}

/** One case of the property over the fixtures: the project, its candidates, and the fixture files it was made from. */
interface FixtureCase {
  name: string
  files: string[]
  p: Project
  candidates: Cand[]
  /** The run's kept graphics and covered clips as `applyGraphics` takes them (none for specs.json's hand-built candidates). */
  kept: KeptGraphic[]
  covered: string[]
}

/** Every fixture file the property must cover: specs.json, every nested-*.json and every eval-*.json in the folder, read by name here, apart from the readers. */
function fixtureFilesPresent(): string[] {
  return readdirSync(GRAPHICS_FIXTURE_DIR)
    .filter((f) => f === 'specs.json' || /^(nested|eval)-.*\.json$/u.test(f))
    .sort()
}

/** A footage clip of a transcript's file at `start`, `inPoint` and `frames` long, its asset the transcript's own. */
function transcriptClip(t: Transcript, id: string, start: number, inPoint: number, frames: number): Clip {
  return clip(id, 'v1', start, frames, { assetId: t.assetId, inPoint })
}

/** The frames a transcript's words run over at 30 fps, and one second more. */
const spokenFrames = (t: Transcript): number => Math.ceil((Math.max(t.durationMs, ...t.words.map((w) => w.endMs)) / 1000) * FPS) + FPS

/** A project of footage clips on V1 over transcripts (`[transcript, clip]`), each asset with the transcript's id and `speaker`. */
function transcriptProject(shots: [Transcript, Clip][], speaker: string | undefined, extra: Clip[] = []): Project {
  const base = emptyProject('budget fixtures')
  return {
    ...base,
    settings: { ...base.settings, fps: FPS },
    assets: shots.map(([t]) => ({ id: t.assetId, path: `/m/${t.assetId}.mp4`, name: `${t.assetId}.mp4`, kind: 'video' as const, durationFrames: 99999, width: 1080, height: 1920, fps: FPS, hasVideo: true, hasAudio: true, size: 1, ...(speaker ? { speaker } : {}) })),
    clips: [...shots.map(([, c]) => c), ...extra],
    transcripts: Object.fromEntries(shots.map(([t]) => [t.assetId, t]))
  }
}

/**
 * A run with no model over `p`'s footage clips (the baseline of §6.10,
 * through `runGraphicsPass`, as Find graphics runs it), each kept graphic
 * and, with a Speaker, each clip's lower third, timed as `applyGraphics`
 * times them (`graphicBeats`, `graphicTiming`; a proposal set aside, as
 * step 4 sets it aside) into budget candidates.
 */
async function baselineCandidates(p: Project): Promise<{ candidates: Cand[]; kept: KeptGraphic[]; covered: string[] }> {
  const footage = p.clips.filter((c) => c.trackId === 'v1')
  const run = await runGraphicsPass(p, footage, async () => ({ answer: { error: 'no model answered' }, model: null }), { baseline: baselineGraphics })
  const kept = run.pair.kept
  const covered = footage.map((c) => c.id)
  const lower = footage.flatMap((c) => {
    const l = lowerThirdFor(p, c)
    return l ? [l] : []
  })
  const candidates: Cand[] = []
  ;[...lower, ...kept].forEach((k, i) => {
    const c = p.clips.find((x) => x.id === k.clipId)!
    const data = k.candidate.data
    if (k.candidate.proposal) return
    const beats = graphicBeats(p, c, p.transcripts[k.assetId], k.candidate.beatWords, { spread: data.template !== 'quote' })
    if (beats === null) return
    const timing = graphicTiming(c, beats, GRAPHIC_TEMPLATES[data.template]!, drawnText(data), FPS)
    if (!timing.ok) return
    candidates.push({ name: `${data.template} ${i} on ${c.id}`, clipId: c.id, rule: CLIPS_GRAPHIC_RULE, start: timing.start, duration: timing.duration, spec: { data, beats: timing.beats } })
  })
  return { candidates, kept, covered }
}

/** Zoom keys on footage clip `c` that move from 1 to 1.2 over six frames starting three frames into timeline span `at`. */
function zoomOver(c: Clip, at: [number, number]): Clip {
  const a = at[0] - c.start + 3
  return { ...c, keyframes: { zoom: [{ frame: 0, value: 1 }, { frame: a, value: 1 }, { frame: a + 6, value: 1.2 }] } }
}

/**
 * The property's cases over every fixture (§6.12: "no two graphics overlap
 * in time, none sits over a zoom punch", over every fixture):
 *
 * - every transcript fixture (the nested-*.json today, and every eval-*.json
 *   the owner adds, through piece 2's reader) alone, at two cut lengths (the
 *   whole talk; two seconds off its head and one second of speech off its
 *   tail, past `spokenFrames`' second of padding), with no
 *   zoom, and again with a zoom move put under its first candidate; and all
 *   of them back to back on one timeline, each asset with a Speaker, so the
 *   lower thirds and the spacing across clips are read;
 * - specs.json's graphics (27, and step 6's three), which have no transcript, as hand-built
 *   candidates at seeded starts on one footage clip at two cut lengths (120 s
 *   and 60 s), with a zoom punch, and again with a zoom move as well.
 */
async function fixtureCases(): Promise<FixtureCase[]> {
  const fixtures = loadGraphicsFixtures()
  const talks = [...fixtures.nested, ...fixtures.eval].map((f) => ({ file: f.file, t: f.transcript }))
  const out: FixtureCase[] = []
  for (const { file, t } of talks) {
    const whole = spokenFrames(t)
    for (const [cut, inPoint, frames] of [['whole', 0, whole], ['cut', 2 * FPS, whole - 4 * FPS]] as const) {
      const plain = transcriptProject([[t, transcriptClip(t, 'f', 0, inPoint, frames)]], undefined)
      const made = await baselineCandidates(plain)
      out.push({ name: `${file}, ${cut}`, files: [file], p: plain, ...made })
      if (made.candidates.length === 0) continue
      const first = made.candidates[0]
      const zoomed = { ...plain, clips: plain.clips.map((c) => (c.id === 'f' ? zoomOver(c, [first.start, first.start + first.duration]) : c)) }
      out.push({ name: `${file}, ${cut}, zoom under its first graphic`, files: [file], p: zoomed, ...(await baselineCandidates(zoomed)) })
    }
  }
  if (talks.length > 0) {
    let at = 0
    const shots = talks.map(({ t }, i): [Transcript, Clip] => {
      const c = transcriptClip(t, `f${i}`, at, 0, spokenFrames(t))
      at += c.duration
      return [t, c]
    })
    const joined = transcriptProject(shots, 'Asha')
    out.push({ name: 'every transcript fixture back to back, with a Speaker', files: talks.map((x) => x.file), p: joined, ...(await baselineCandidates(joined)) })
  }
  const specs = (JSON.parse(readFileSync(join(GRAPHICS_FIXTURE_DIR, 'specs.json'), 'utf8')) as { specs: FixtureSpec[] }).specs
  for (const length of [3600, 1800]) {
    for (const seed of [1, 2, 3, 4, 5]) {
      const random = seeded(seed * 7919 + length)
      const punch = moment('z', 'zoom-punch', Math.floor(length / 4) + Math.floor(random() * (length / 4)), 12)
      const candidates = specs.map((s) => {
        const frames = Math.round(s.spec.seconds * FPS)
        return { name: s.id, clipId: 'f', rule: CLIPS_GRAPHIC_RULE, start: Math.floor(random() * (length - frames)), duration: frames, spec: s.spec }
      })
      const p = project([['f', 0, length]], [punch])
      out.push({ name: `specs.json, ${length / FPS} s, seed ${seed}`, files: ['specs.json'], p, candidates, kept: [], covered: [] })
      const zoomed = { ...p, clips: p.clips.map((c) => (c.id === 'f' ? zoomOver(c, [candidates[0].start, candidates[0].start + candidates[0].duration]) : c)) }
      out.push({ name: `specs.json, ${length / FPS} s, seed ${seed}, zoom under ${candidates[0].name}`, files: ['specs.json'], p: zoomed, candidates, kept: [], covered: [] })
    }
  }
  return out
}

/**
 * Independent of budget.ts and apply.ts: the graphics landed on a project
 * hold the property — no two overlap in time, onsets 6 s apart, none over a
 * zoom-punch moment or a zoom move on any footage clip (V1) — a screen card
 * apart.
 */
function assertLandedHolds(p: Project, name: string): number {
  const graphics = p.clips.filter((c) => c.graphic && c.graphic.data.template !== 'screen-card')
  const punches = p.clips.filter((c) => c.moment?.kind === 'zoom-punch').map((c): [number, number] => [c.start, c.start + c.duration])
  for (const f of p.clips.filter((c) => c.trackId === 'v1')) {
    const keys = f.keyframes?.zoom ?? []
    keys.slice(1).forEach((key, i) => {
      if (key.value !== keys[i].value) punches.push([Math.max(f.start, f.start + keys[i].frame), Math.min(f.start + f.duration, f.start + key.frame)])
    })
  }
  graphics.forEach((g, i) => {
    const span: [number, number] = [g.start, g.start + g.duration]
    const onset = g.start / FPS + Math.min(...g.graphic!.beats)
    for (const q of punches) expect(overlap(span, q), `${name}: ${g.graphic!.data.template} over a punch`).toBe(false)
    for (const h of graphics.slice(i + 1)) {
      expect(overlap(span, [h.start, h.start + h.duration]), `${name}: two graphics overlap`).toBe(false)
      expect(Math.abs(onset - (h.start / FPS + Math.min(...h.graphic!.beats))) >= 6 - 1e-6, `${name}: two onsets within 6 s`).toBe(true)
    }
  })
  return graphics.length
}

/** `momentSeed(frame, index)` worked apart from apply2.ts, in BigInt: (frame + 1) × 2654435761 + (index + 1) × 40503, mod 2^32. */
const seedByHand = (frame: number, index: number): number => Number((BigInt(frame + 1) * 2654435761n + BigInt(index + 1) * 40503n) % 2n ** 32n)

describe('applyBudget, the property (§6.12)', () => {
  it('over 400 seeded sets: no two kept graphics overlap, none is within 6 s of another, none sits over a punch', () => {
    let kept = 0
    let dropped = 0
    for (let seed = 1; seed <= 400; seed++) {
      const { p, candidates } = generated(seed)
      const n = assertBudgetHolds(p, candidates)
      kept += n.kept
      dropped += n.dropped
    }
    // Floors, so a budget that keeps nothing (or drops nothing) cannot pass by being trivial.
    expect(kept).toBeGreaterThan(400)
    expect(dropped).toBeGreaterThan(400)
  })

  it('over every fixture: each fixture file is a case, every case holds, and the spacing and the zoom rules each drop something', async () => {
    const files = fixtureFilesPresent()
    const cases = await fixtureCases()
    // A silent zero cannot pass as covered: every fixture file in the folder is in some case, and there are at least as many cases.
    expect(files).toContain('specs.json')
    expect(files.filter((f) => f.startsWith('nested-')).length).toBeGreaterThanOrEqual(3)
    // Counted per kind, so specs.json's twenty cases cannot stand in for the transcripts: each transcript file is at
    // least its two cut lengths alone, and specs.json its two lengths.
    const talkFiles = files.filter((f) => f !== 'specs.json')
    const alone = (f: string): number => cases.filter((c) => c.files.length === 1 && c.files[0] === f).length
    expect(cases.filter((c) => !c.files.includes('specs.json')).length, 'transcript cases').toBeGreaterThanOrEqual(2 * talkFiles.length)
    for (const f of files) expect(alone(f), `${f}: cases of its own`).toBeGreaterThanOrEqual(2)
    expect([...new Set(cases.flatMap((c) => c.files))].sort()).toEqual(files)
    // Every spec of specs.json is a candidate of each of its cases: counted from the file (the phase-2 27 and, since step 6, its three), never pinned.
    const specCount = (JSON.parse(readFileSync(join(GRAPHICS_FIXTURE_DIR, 'specs.json'), 'utf8')) as { specs: unknown[] }).specs.length
    expect(specCount).toBeGreaterThanOrEqual(27)
    for (const c of cases.filter((x) => x.files[0] === 'specs.json')) expect(c.candidates, c.name).toHaveLength(specCount)
    let kept = 0
    const reasons: string[] = []
    for (const c of cases) {
      const n = assertBudgetHolds(c.p, c.candidates)
      kept += n.kept
      reasons.push(...n.reasons)
    }
    // Every English transcript fixture gives the budget a graphic to read. Outside English the baseline reads no ordinal and
    // makes no keyword (§6.10's rules), so an owner's Hindi or Telugu nested fixture may rightly give none: counted and printed, not failed.
    const fixtures = loadGraphicsFixtures()
    const language = new Map([...fixtures.nested, ...fixtures.eval].map((x) => [x.file, x.transcript.language]))
    const others: string[] = []
    for (const f of talkFiles) {
      const n = cases.filter((c) => c.files.length === 1 && c.files[0] === f).reduce((s, c) => s + c.candidates.length, 0)
      if (/^en(?:$|[-_])/iu.test(language.get(f) ?? '')) expect(n > 0, `${f}: a candidate`).toBe(true)
      else others.push(`${f} (${language.get(f)}): ${n} candidates`)
    }
    // The zoom rule drops something on the transcripts themselves, not only on specs.json's hand-built candidates.
    const talkReasons = cases.filter((c) => !c.files.includes('specs.json')).flatMap((c) => assertBudgetHolds(c.p, c.candidates).reasons)
    expect(talkReasons.filter((r) => r.startsWith('over a zoom punch at ')).length, 'zoom drops on the transcripts').toBeGreaterThan(0)
    expect(kept).toBeGreaterThan(cases.length)
    expect(reasons.filter((r) => r.startsWith('within 6 s of the ')).length, 'spacing drops').toBeGreaterThan(0)
    expect(reasons.filter((r) => r.startsWith('over a zoom punch at ')).length, 'zoom drops').toBeGreaterThanOrEqual(10)
    const evals = files.filter((f) => f.startsWith('eval-')).length
    process.stderr.write(
      `graphicBudget, the property over the fixtures: ${cases.length} cases over ${files.length} files (${files.join(', ')}); ${kept} kept; ` +
        (evals === 0 ? 'no eval-*.json yet (the ten eval transcripts are the owner’s recordings), so none of them is a case' : `${evals} eval-*.json among them`) +
        (others.length > 0 ? `; outside English, not floored: ${others.join(', ')}\n` : '; no Hindi or Telugu transcript fixture yet\n')
    )
  })

  it.skipIf(loadGraphicsFixtures().eval.length === 0)('over every eval-*.json the owner has added (skipped while there is none: they are the owner’s recordings)', async () => {
    const evals = fixtureFilesPresent().filter((f) => f.startsWith('eval-'))
    const cases = await fixtureCases()
    for (const f of evals) {
      const own = cases.filter((c) => c.files.length === 1 && c.files[0] === f)
      expect(own.length, f).toBeGreaterThanOrEqual(2)
      for (const c of own) assertBudgetHolds(c.p, c.candidates)
    }
  })

  it('applyGraphics on every transcript fixture case lands graphics that hold the property, each seeded from its start and landing index', async () => {
    const cases = (await fixtureCases()).filter((c) => !c.files.includes('specs.json'))
    let landed = 0
    let seeds = 0
    for (const c of cases) {
      let n = 0
      const ids = (prefix: string): string => `${prefix}-${++n}`
      const out = applyGraphics(c.p, c.kept, c.covered, CLIPS_GRAPHIC_RULE, { fps: FPS, newId: ids })
      landed += assertLandedHolds(out.project, c.name)
      out.clipIds.forEach((id, i) => {
        const g = out.project.clips.find((x) => x.id === id)!
        expect(g.graphic!.seed, `${c.name}: ${id}`).toBe(seedByHand(g.start, i))
        seeds += 1
      })
    }
    // Every case with no zoom put under it lands at least one graphic (measured at piece 3: 8 landed over 12 cases, 6 of them zoom-free).
    expect(landed).toBeGreaterThanOrEqual(cases.filter((c) => !c.name.includes('zoom') && c.candidates.length > 0).length)
    expect(seeds).toBe(landed)
    // The seed worked by hand once, so the BigInt rule itself is pinned: frame 15, index 0 → 16 × 2654435761 + 40503 mod 2^32.
    expect(seedByHand(15, 0)).toBe(3816307015)
  })
})

/*
 * Phase 3's hero rule (docs/CLIPS.md §6.16, "Who sets depth"; piece 3):
 * `applyGraphics` makes the first landed counter or ring of each footage
 * clip that clip's hero (`depth: 'tilt'`, `hero`), and under `neon` its
 * drawer asks for a glow on its value or arc. The expectations are worked
 * here from the landed clips themselves (which footage clip's span holds a
 * graphic's first frame, the earliest counter or ring on it), apart from
 * apply.ts's `withHeroes`.
 */
describe('applyGraphics, phase 3: the hero of each footage clip (§6.16)', () => {
  const fake = (t: string, look: { px: number }): { width: number; ascent: number; descent: number } => ({ width: t.length * look.px * 0.55, ascent: look.px * 0.8, descent: look.px * 0.2 })
  const NEON = resolveGraphicStyle('neon')
  const SIZE = { width: 1080, height: 1920 }
  /** The landed graphics over footage clip `f` (its span holds the graphic's first frame), earliest first. */
  const over = (p: Project, f: Clip): Clip[] =>
    p.clips.filter((c) => c.graphic && c.start >= f.start && c.start < f.start + f.duration).sort((a, b) => a.start - b.start)
  const isNumber = (c: Clip): boolean => c.graphic!.data.template === 'counter' || c.graphic!.data.template === 'ring'
  /** The glow requests a graphic's list carries a frame after its last beat, under neon. */
  const glowOf = (c: Clip): unknown[] | undefined => drawListAt(c.graphic!, NEON, Math.round((Math.max(...c.graphic!.beats) + 0.6) * FPS), FPS, SIZE, fake).glow

  /** Every graphic of one run's landing against the rule worked by hand; the heroes made. */
  function assertHeroes(p: Project, name: string): number {
    let heroes = 0
    for (const f of p.clips.filter((c) => c.trackId === 'v1')) {
      const graphics = over(p, f)
      const first = graphics.find(isNumber)
      for (const g of graphics) {
        const where = `${name}: ${g.id} (${g.graphic!.data.template}) over ${f.id}`
        if (g === first) {
          heroes++
          expect(g.graphic!.depth, where).toBe('tilt')
          expect(g.graphic!.hero, where).toBe(true)
          expect(glowOf(g), where).toEqual([expect.objectContaining({ item: g.graphic!.data.template === 'counter' ? 'value' : 'arc', color: NEON.palette.accent })])
        } else {
          expect(g.graphic!.depth, where).toBeUndefined()
          expect(g.graphic!.hero, where).toBeUndefined()
          expect(glowOf(g), where).toBeUndefined()
        }
      }
    }
    return heroes
  }

  it('over the transcript fixtures: no graphic but the first kept counter or ring of a footage clip is a hero (the baseline lands none today)', async () => {
    const cases = (await fixtureCases()).filter((c) => !c.files.includes('specs.json'))
    let heroes = 0
    let footageWithTwo = 0
    for (const c of cases) {
      let n = 0
      const out = applyGraphics(c.p, c.kept, c.covered, CLIPS_GRAPHIC_RULE, { fps: FPS, newId: (prefix) => `${prefix}-${++n}` })
      heroes += assertHeroes(out.project, c.name)
      for (const f of out.project.clips.filter((x) => x.trackId === 'v1')) if (over(out.project, f).filter(isNumber).length >= 2) footageWithTwo++
    }
    // The baseline (no model) lands no counter or ring from today's transcript fixtures (keywords, steps and lower thirds,
    // measured 2026-11-18), so here the rule is read as "no other graphic is a hero"; the hand-built cases below land
    // specs.json's counter and ring through applyGraphics and make heroes.
    expect(heroes).toBe(0)
    process.stderr.write(`graphicBudget, phase 3's heroes over the transcript fixtures: ${heroes} heroes over ${cases.length} cases; ${footageWithTwo} footage clips with two or more counters or rings\n`)
  })

  /** specs.json's English counter and ring (counter-en, ring-en): their data, drawn by the fixtures' own words. */
  const fixtureData = (id: string): GraphicData =>
    (JSON.parse(readFileSync(join(GRAPHICS_FIXTURE_DIR, 'specs.json'), 'utf8')) as { specs: FixtureSpec[] }).specs.find((f) => f.id === id)!.spec.data

  /**
   * Two footage clips of one talk that says specs.json's counter-en and
   * ring-en; on each, those two as kept candidates (a counter at about 2 s of
   * the clip, a ring at about 11 s), beat on each one's value word. The clip
   * is over 40 s, so the budget's per-20 s count (§6.9) lets both stand.
   */
  function twoClips(extra: Clip[] = []): { p: Project; kept: KeptGraphic[] } {
    const counter = fixtureData('counter-en') as Extract<GraphicData, { template: 'counter' }>
    const ring = fixtureData('ring-en') as Extract<GraphicData, { template: 'ring' }>
    const words: string[] = []
    const say = (text: string): number => {
      const at = words.length
      words.push(...text.split(' '))
      return at
    }
    const filler = (n: number): void => {
      for (let i = 0; i < n; i++) words.push('and')
    }
    filler(4)
    const counterAt = say(`${counter.value} ${counter.label}`)
    filler(14)
    const ringAt = say(`${ring.value} ${ring.label}`)
    filler(70)
    const t: Transcript = {
      assetId: 'talk',
      language: 'en',
      model: 'whisper-small',
      durationMs: words.length * 500,
      words: words.map((text, index) => ({ index, text, startMs: index * 500, endMs: index * 500 + 400, confidence: null })),
      segments: [{ id: 's00', startMs: 0, endMs: words.length * 500, text: words.join(' '), wordStart: 0, wordEnd: words.length - 1 }]
    }
    const length = words.length * 15
    const shots: [Transcript, Clip][] = [
      [t, transcriptClip(t, 'fa', 0, 0, length)],
      [t, transcriptClip(t, 'fb', length, 0, length)]
    ]
    const p = transcriptProject(shots, undefined, extra)
    const candidate = (data: GraphicData, at: number): KeptGraphic['candidate'] => ({ sentence: 's00', data, bound: [at], beatWords: [at], why: '', source: 'model' })
    const kept: KeptGraphic[] = ['fa', 'fb'].flatMap((clipId) => [
      { clipId, assetId: 'talk', candidate: candidate(counter, counterAt) },
      { clipId, assetId: 'talk', candidate: candidate(ring, ringAt) }
    ])
    return { p, kept }
  }

  it('two footage clips each with a counter and a ring: each clip has its own hero, its counter; the rings are not', () => {
    const { p, kept } = twoClips()
    let n = 0
    const out = applyGraphics(p, kept, [], CLIPS_GRAPHIC_RULE, { fps: FPS, newId: (prefix) => `${prefix}-${++n}` })
    const landed = out.clipIds.map((id) => out.project.clips.find((c) => c.id === id)!)
    expect(landed.map((c) => c.graphic!.data.template)).toEqual(['counter', 'ring', 'counter', 'ring'])
    expect(assertHeroes(out.project, 'two clips')).toBe(2)
    expect(landed.map((c) => c.graphic!.hero ?? null)).toEqual([true, null, true, null])
  })

  it('a clip that already holds a hero gets none from a later run, even an earlier counter: one hero per clip, never per project', () => {
    const { p, kept } = twoClips()
    let n = 0
    const newId = (prefix: string): string => `${prefix}-${++n}`
    const isRing = (k: KeptGraphic): boolean => k.candidate.data.template === 'ring'
    // First run: fa's ring alone, its hero.
    const once = applyGraphics(p, kept.filter((k) => k.clipId === 'fa' && isRing(k)), [], CLIPS_GRAPHIC_RULE, { fps: FPS, newId })
    const ring = once.project.clips.find((c) => c.id === once.clipIds[0])!
    expect(ring.graphic!.hero).toBe(true)
    // Second run: fa's counter (earlier than the ring) and fb's counter and ring.
    const twice = applyGraphics(once.project, kept.filter((k) => !(k.clipId === 'fa' && isRing(k))), [], CLIPS_GRAPHIC_RULE, { fps: FPS, newId })
    const landed = twice.clipIds.map((id) => twice.project.clips.find((c) => c.id === id)!)
    expect(landed.map((c) => `${c.graphic!.data.template} ${c.start < p.clips.find((f) => f.id === 'fb')!.start ? 'fa' : 'fb'} ${c.graphic!.hero ?? '-'} ${c.graphic!.depth ?? '-'}`)).toEqual([
      'counter fa - -',
      'counter fb true tilt',
      'ring fb - -'
    ])
    expect(twice.project.clips.find((c) => c.id === ring.id)!.graphic).toEqual(ring.graphic)
  })

  it('a graphic whose depth you set keeps yours and is never the hero; Flat is yours too', () => {
    const { p, kept } = twoClips()
    let n = 0
    const newId = (prefix: string): string => `${prefix}-${++n}`
    const once = applyGraphics(p, kept.filter((k) => k.clipId === 'fa'), [], CLIPS_GRAPHIC_RULE, { fps: FPS, newId }).project
    const [counter, ring] = ['counter', 'ring'].map((t) => once.clips.find((c) => c.graphic?.data.template === t)!)
    expect([counter.graphic!.hero, ring.graphic!.hero]).toEqual([true, undefined])
    for (const depth of ['parallax', 'flat'] as const) {
      // You set the hero's depth: the dock clears hero (GraphicPanel's Depth choice).
      const { hero: _hero, ...rest } = counter.graphic!
      const yours = { ...once, clips: once.clips.map((c) => (c.id === counter.id ? { ...c, graphic: { ...rest, depth } } : c)) }
      // Even named as a run's own, yours is never taken.
      expect(withHeroes(yours, [counter.id]), depth).toBe(yours)
      // A later run over fb lands its own hero there; fa's counter keeps yours, its ring stays plain.
      const out = applyGraphics(yours, kept.filter((k) => k.clipId === 'fb'), [], CLIPS_GRAPHIC_RULE, { fps: FPS, newId })
      const heroes = out.project.clips.filter((c) => c.graphic?.hero).map((c) => out.clipIds.indexOf(c.id))
      expect(heroes, depth).toEqual([0])
      expect(out.project.clips.find((c) => c.id === counter.id)!.graphic, depth).toEqual({ ...rest, depth })
      expect(out.project.clips.find((c) => c.id === ring.id)!.graphic, depth).toEqual(ring.graphic)
    }
  })

  it('withHeroes takes only a counter or ring over a footage clip: never a graphic over no footage, never a screen card (threeD, but not a hero template) landed ahead of a counter', () => {
    const { p, kept } = twoClips()
    let n = 0
    const once = applyGraphics(p, kept.filter((k) => k.clipId === 'fa' && k.candidate.data.template === 'counter'), [], CLIPS_GRAPHIC_RULE, { fps: FPS, newId: (prefix) => `${prefix}-${++n}` }).project
    const landed = once.clips.find((c) => c.graphic?.data.template === 'counter')!
    const { hero: _hero, depth: _depth, ...plainSpec } = landed.graphic!
    const fb = p.clips.find((c) => c.id === 'fb')!
    const end = Math.max(...p.clips.map((c) => c.start + c.duration))
    // A counter past every footage clip: footageOf is null.
    const orphan: Clip = { ...landed, id: 'orphan', start: end + 30, graphic: plainSpec }
    // On fb: a screen card first, then a counter.
    const card: Clip = { ...landed, id: 'card', start: fb.start + 10, graphic: { ...plainSpec, data: { template: 'screen-card', clipId: 'fb', move: 'tilt-in' } } }
    const later: Clip = { ...landed, id: 'later', start: fb.start + 40, graphic: plainSpec }
    const q: Project = { ...once, clips: [...once.clips, orphan, card, later] }
    const out = withHeroes(q, ['orphan', 'card', 'later'])
    const spec = (id: string): GraphicSpec => out.clips.find((c) => c.id === id)!.graphic!
    expect(spec('orphan').hero).toBeUndefined()
    expect(spec('orphan').depth).toBeUndefined()
    expect(spec('card').hero).toBeUndefined()
    expect(spec('card').depth).toBeUndefined()
    expect([spec('later').hero, spec('later').depth]).toEqual([true, 'tilt'])
  })

  it('the hero rule is not widened to step 6’s three (3D templates piece 3): a timeline, a before-and-after and a versus landed ahead of a counter on one footage clip get no depth and no hero; the counter does', () => {
    // apply.ts keys the rule by HERO_TEMPLATES AND threeD; the three are threeD, so only HERO_TEMPLATES keeps them out (§9 does not widen it).
    for (const t of ['timeline', 'before-after', 'versus']) expect(GRAPHIC_TEMPLATES[t as GraphicTemplateId]?.threeD, t).toBe(true)
    const { p, kept } = twoClips()
    let n = 0
    const once = applyGraphics(p, kept.filter((k) => k.clipId === 'fa' && k.candidate.data.template === 'counter'), [], CLIPS_GRAPHIC_RULE, { fps: FPS, newId: (prefix) => `${prefix}-${++n}` }).project
    const landed = once.clips.find((c) => c.graphic?.data.template === 'counter')!
    const { hero: _hero, depth: _depth, ...plainSpec } = landed.graphic!
    const fb = p.clips.find((c) => c.id === 'fb')!
    const datas: Record<string, GraphicSpec['data']> = {
      tl: { template: 'timeline', items: [{ when: '2019', label: 'a' }, { when: '2021', label: 'b' }] },
      ba: { template: 'before-after', before: { label: 'a', value: '1' }, after: { label: 'b', value: '2' } },
      vs: { template: 'versus', left: { label: 'a', value: '1' }, right: { label: 'b', value: '2' } }
    }
    const ahead: Clip[] = Object.entries(datas).map(([id, data], i) => ({ ...landed, id, start: fb.start + 5 + i * 5, graphic: { ...plainSpec, data } }))
    const later: Clip = { ...landed, id: 'later', start: fb.start + 40, graphic: plainSpec }
    const q: Project = { ...once, clips: [...once.clips, ...ahead, later] }
    const out = withHeroes(q, [...ahead.map((c) => c.id), 'later'])
    const spec = (id: string): GraphicSpec => out.clips.find((c) => c.id === id)!.graphic!
    for (const id of Object.keys(datas)) expect([spec(id).hero, spec(id).depth], id).toEqual([undefined, undefined])
    expect([spec('later').hero, spec('later').depth]).toEqual([true, 'tilt'])
  })

  it('HERO_RULE is on, the one line that turns the rule off; a footage clip with no counter or ring has no hero', () => {
    expect(HERO_RULE).toBe(true)
    const { p, kept } = twoClips()
    const out = applyGraphics(p, kept.filter((k) => k.candidate.data.template === 'counter' && k.clipId === 'fa'), [], CLIPS_GRAPHIC_RULE, { fps: FPS, newId: (prefix) => `${prefix}-x` })
    expect(out.project.clips.filter((c) => c.graphic?.hero).map((c) => c.id)).toEqual(['graphic-x'])
    // Not over fb, which has no graphic at all.
    expect(withHeroes(p, [])).toBe(p)
  })
})
