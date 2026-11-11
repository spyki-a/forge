import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GRAPHICS_PER_MINUTE,
  ON_SCREEN_REASON,
  TOO_CLOSE_REASON,
  applyBudget,
  perClipReason,
  perMinuteReason,
  zoomPunchReason,
  type BudgetCandidate
} from '@shared/graphics/budget'
import { NO_CLIP_NOTE } from '@shared/graphics/place'
import { CLIPS_GRAPHIC_RULE } from '@shared/graphics/apply'
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
    expect(r.dropped).toEqual([{ spec: b.spec, reason: TOO_CLOSE_REASON }])
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
    expect(reasons(r30)).toEqual([perClipReason('clip')])
    expect(perClipReason('clip')).toBe('at most one graphic per 20 s of clip, the earlier ones stay')
    expect(names(applyBudget(project([['f', 0, 1200]]), two))).toEqual(['a', 'b'])
    const three = [...two, cand('c', 'counter', 1200, 75)] // onset 40.5 s
    const r599 = applyBudget(project([['f', 0, 1797]]), three)
    expect(names(r599)).toEqual(['a', 'b'])
    expect(reasons(r599)).toEqual([perClipReason('clip')])
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
    expect(reasons(direct)).toEqual([perClipReason('ad')])
  })

  it('a graphic already on the timeline holds first, even against an earlier candidate', () => {
    const p = project([['f', 0, 1800]], [graphicClip('g1', 'counter', 600, 75)]) // onset 20.5 s
    const r = applyBudget(p, [cand('a', 'counter', 480, 75)]) // onset 16.5 s
    expect(names(r)).toEqual([])
    expect(reasons(r)).toEqual([TOO_CLOSE_REASON])
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
    expect(reasons(r)).toEqual([TOO_CLOSE_REASON])
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
    expect(reasons(applyBudget(p, [cand('counter', 'counter', 300, 75)]))).toEqual([perClipReason('clip')])
  })

  it('drops a candidate whose footage clip is gone', () => {
    const r = applyBudget(project([['f', 0, 900]]), [cand('a', 'counter', 0, 75, { clipId: 'nope' })])
    expect(reasons(r)).toEqual([NO_CLIP_NOTE])
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
function assertBudgetHolds(p: Project, candidates: Cand[]): { kept: number; dropped: number } {
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
  return { kept: r.kept.length, dropped: r.dropped.length }
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
    return cand(`c${i}`, TEMPLATES[int(TEMPLATES.length)], int(Math.max(1, length - frames)), frames, { beats: [0.5, 0.5 + random() * 2] })
  })
  return { p, candidates }
}

interface FixtureSpec {
  id: string
  spec: GraphicSpec
}

/**
 * The graphics of tests/fixtures/graphics/specs.json as candidates, each at a
 * seeded start on one long footage clip. Lane T4 adds its eval fixtures'
 * settled graphics here: each fixture's project and its settled, timed
 * candidates (`settleGraphics`, then the beats and the seconds) are a case
 * of `assertBudgetHolds`.
 */
function fixtureCases(): { p: Project; candidates: Cand[] }[] {
  const file = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'graphics', 'specs.json'), 'utf8')) as { specs: FixtureSpec[] }
  return [1, 2, 3, 4, 5].map((seed) => {
    const random = seeded(seed * 7919)
    const p = project([['f', 0, 3600]], [moment('z', 'zoom-punch', 900 + Math.floor(random() * 900), 12)])
    const candidates = file.specs.map((s) => {
      const frames = Math.round(s.spec.seconds * FPS)
      return { name: s.id, clipId: 'f', rule: CLIPS_GRAPHIC_RULE, start: Math.floor(random() * (3600 - frames)), duration: frames, spec: s.spec }
    })
    return { p, candidates }
  })
}

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

  it('over the 27 fixture specs, five seeded layouts', () => {
    const cases = fixtureCases()
    expect(cases).toHaveLength(5)
    let kept = 0
    for (const { p, candidates } of cases) {
      expect(candidates).toHaveLength(27)
      kept += assertBudgetHolds(p, candidates).kept
    }
    expect(kept).toBeGreaterThan(5)
  })
})
