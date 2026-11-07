import { describe, expect, it } from 'vitest'
import { emptyProject } from '@shared/timeline'
import { CLIPS_GRAPHIC_RULE, applyGraphics } from '@shared/graphics/apply'

/*
 * docs/CLIPS.md §6.6 and §6.19's "T3, first": applyGraphics is committed as
 * a typed stub before T2's wiring starts. Until T3 fills it in, it must land
 * nothing and say so.
 */
describe('applyGraphics (the typed stub)', () => {
  it('returns the same project object, no clip ids, and exactly one problem', () => {
    const project = emptyProject('stub')
    // The stub changes nothing: the same object comes back AND its contents
    // are untouched (toBe alone passes an in-place edit).
    const before = structuredClone(project)
    const out = applyGraphics(project, [], ['clip-1'], CLIPS_GRAPHIC_RULE, { fps: 30, newId: (p) => `${p}-1` })
    expect(out.project).toBe(project)
    expect(project).toEqual(before)
    expect(out.clipIds).toEqual([])
    expect(out.problems).toHaveLength(1)
    expect(out.problems[0].message).toMatch(/not built yet/)
  })

  it("the clips flow's rule is 'clips.graphic'", () => {
    expect(CLIPS_GRAPHIC_RULE).toBe('clips.graphic')
  })
})
