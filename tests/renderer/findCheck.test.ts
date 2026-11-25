import { describe, expect, it } from 'vitest'
import type { TextMeasure } from '@shared/graphics/items'
import { SOUND_ROLES, type SoundPack } from '@shared/director/soundRoles'
import { STEP_SIX_TEMPLATES } from '@shared/director/menuGraphics'
import { checkFind, checkFindCase, findProject } from '../../src/renderer/src/harness/findCheck'
import { HARNESS_STEP_SIX, harnessStepSixRun, harnessStepSixTranscript } from '../../src/renderer/src/harness/graphicsStub'
import { GRAPHIC_CHECK_OPTIONS } from '../../src/renderer/src/harness/graphicCheck'

/*
 * 3D templates piece 2: the harness's stubbed Find for step 6's three
 * (graphicsStub.ts `harnessStepSixRun`) and the graphic check's `find` option
 * that reads it (findCheck.ts), in node with a fake text measure: what the
 * session's `await window.__forgeGraphicCheck({ find: [...] })` returns when
 * all is well, worked out here.
 */

const fakeMeasure: TextMeasure = (text, look) => ({ width: text.length * look.px * 0.55, ascent: look.px * 0.8, descent: look.px * 0.2 })
const PACK: SoundPack = ['clock_tick.wav', 'fast_whoosh.wav'].map((name) => ({ ...SOUND_ROLES[name], id: name, name, file: `/lib/sfx/${name}` }))

describe('the stubbed Find for step 6’s three (graphicsStub.ts)', () => {
  it('each talk offers its own template and neither other, and ends inside the bridge’s 6 s video', () => {
    expect([...HARNESS_STEP_SIX]).toEqual([...STEP_SIX_TEMPLATES])
    const { project, clipId } = findProject()
    for (const template of HARNESS_STEP_SIX) {
      const t = harnessStepSixTranscript('find-video', template)
      expect(t.durationMs).toBeLessThanOrEqual(6000)
      const run = harnessStepSixRun(project, clipId, template)
      expect(run.offered.filter((id) => (HARNESS_STEP_SIX as readonly string[]).includes(id))).toEqual([template])
      expect(run.placed).toHaveLength(1)
      // No library on node: the landing's own note, never a drop.
      expect(run.problems).toEqual(['no sound library is installed — graphics land silent'])
    }
  })

  it('throws, naming why, when the clip is not on the timeline', () => {
    const { project } = findProject()
    expect(() => harnessStepSixRun(project, 'nope', 'versus')).toThrow('find: clip nope is not on the timeline')
  })
})

describe('the graphic check’s find option (findCheck.ts)', () => {
  it('each case passes: one placed, one beat an element, every string drawn at the settled frame, one tick', () => {
    // MUTATION (harnessStepSixRun's answer for versus written right-first): fails versus' pass (dropped for order, so the run throws).
    const cases = HARNESS_STEP_SIX.map((t) => checkFindCase(t, fakeMeasure, PACK))
    for (const c of cases) {
      expect(c.error, c.template).toBeNull()
      expect(c.notes, c.template).toEqual([])
      expect(c.dropped, c.template).toEqual([])
      expect([c.template, c.pass, c.placed, c.missing, c.sounds]).toEqual([c.template, true, 1, [], 1])
    }
    expect(cases.map((c) => c.beats.length)).toEqual([3, 2, 2])
    expect(cases.map((c) => c.strings)).toEqual([
      ['2015', 'shot our first wedding', '2018', 'hired an editor', '2021', 'opened a studio'],
      ['Before the course', '$1,500', 'After the course', '$4,000'],
      ['Instagram', '600', 'referrals', '350']
    ])
    // Words every 300 ms: the clip starts 0.5 s before the first value's word, so each beat is (word × 0.3 − start).
    // timeline: 2015 is word 1 (0.3 s), so the clip starts at 0; 2018 word 8 (2.4 s), 2021 word 14 (4.2 s).
    expect(cases[0].beats.map((b) => Math.round(b * 100) / 100)).toEqual([0.3, 2.4, 4.2])
    // versus: 600 is word 2 (0.6 s), so the clip starts at 0.1 s (frame 3); 350 is word 7 (2.1 s): 0.5 and 2.0.
    expect(cases[2].beats.map((b) => Math.round(b * 100) / 100)).toEqual([0.5, 2])
    // With no sound library, no sound and still a pass.
    expect(checkFindCase('versus', fakeMeasure, [])).toMatchObject({ pass: true, sounds: 0 })
  })

  it('names what it cannot read, and is listed among the options', () => {
    const summary: string[] = []
    const notes: string[] = []
    const r = checkFind(['versus', 'counter'], fakeMeasure, summary, notes)
    expect(r.unknown).toEqual(['counter'])
    expect(r.cases.map((c) => c.template)).toEqual(['versus'])
    expect(notes).toEqual(['find: NOT READ, "counter": the find option takes timeline, before-after, versus.'])
    expect(summary).toHaveLength(1)
    expect(summary[0]).toMatch(/^find versus: PASS; offered versus; placed 1, 2 beats \(0\.50, 2\.00 s\), [\d.]+ s on screen, 4 of 4 strings drawn, 0 sounds/u)
    expect(GRAPHIC_CHECK_OPTIONS).toContain('find')
  })
})
