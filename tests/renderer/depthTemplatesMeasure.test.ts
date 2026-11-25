import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ChannelDiff } from '../../src/renderer/src/harness/compositorMeasure'
import {
  DEPTH_TEMPLATES_BAR,
  DEPTH_TEMPLATE_SHAPES,
  FLAT_PARITY_WIDE,
  depthListFailures,
  depthListReading,
  depthTemplatesVerdict,
  isDepthTemplate,
  type DepthTemplateCase,
  type DepthTemplateMoveReading,
  type FlatParityRow
} from '../../src/renderer/src/harness/depthTemplatesMeasure'
import type { Drawer, TextItem, TextMeasure } from '@shared/graphics/items'
import { DRAWERS } from '@shared/graphics/templates/index'
import { GRAPHIC_STYLES, resolveGraphicStyle } from '@shared/graphics/style'
import type { GraphicSpec } from '@shared/graphics/template'
import { DEPTH_MOVES } from '@shared/graphics/templates/depth'

/*
 * The `parity` option's phase-3 half over named templates (docs/CLIPS.md §9,
 * "Measure in the harness"; the 3D templates' piece 3): its node half (the
 * draw lists of every depth of step 6's three against their flat twins) and
 * its verdict, every bar a reading is held to. The pictures are WebGL's, read
 * on the harness page by depthTemplatesCheck.ts.
 */

const STEP_SIX = ['timeline', 'before-after', 'versus'] as const
const fixtures = (JSON.parse(readFileSync(new URL('../fixtures/graphics/specs.json', import.meta.url), 'utf8')) as { specs: { id: string; spec: GraphicSpec }[] }).specs.filter((f) =>
  (STEP_SIX as readonly string[]).includes(f.spec.data.template)
)
const fake: TextMeasure = (t, look) => ({ width: t.length * look.px * 0.55, ascent: look.px * 0.8, descent: look.px * 0.2 })
const FPS = 30
const WEBGL_NOTE = 'drawn flat: 3D needs WebGL, which did not start on this computer'

describe('the parity option’s templates half, node’s side: every depth of the three against its flat twin', () => {
  it('reads every fixture of the three (the English ones at least) at both shapes, each move passing the list bars under every style', () => {
    for (const id of ['timeline-en', 'before-after-en', 'versus-en']) expect(fixtures.map((f) => f.id)).toContain(id)
    for (const f of fixtures) {
      for (const shape of DEPTH_TEMPLATE_SHAPES) {
        for (const st of GRAPHIC_STYLES) {
          for (const move of DEPTH_MOVES) {
            const name = `${f.id} ${move} at ${shape.name} under ${st.id}`
            const r = depthListReading({ ...f.spec, depth: move }, st, FPS, shape, fake)
            expect(depthListFailures(name, r), name).toEqual([])
            expect(r.movingCamera, name).toBeGreaterThan(0)
            expect(r.textsChecked, name).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it('a flat spec fails the list bars as a dead branch would (no camera at all)', () => {
    const f = fixtures.find((x) => x.id === 'timeline-en')!
    const r = depthListReading(f.spec, resolveGraphicStyle('clean'), FPS, DEPTH_TEMPLATE_SHAPES[0], fake)
    expect(r.lastCamera).toBeNull()
    expect(depthListFailures('flat', r).join('; ')).toMatch(/carries no camera.*no frame has a camera off flat/u)
  })

  it('the reading itself: a drawer whose text, look, box or opacity changes with depth is caught, and one whose settled list is reordered', () => {
    const base = fixtures.find((x) => x.id === 'versus-en')!.spec
    const real = DRAWERS.versus!
    const st = resolveGraphicStyle('clean')
    const size = DEPTH_TEMPLATE_SHAPES[0]
    const changing = (edit: (t: TextItem) => TextItem): Drawer => (spec, style, clock, sz, measure, targets) => {
      const out = real(spec, style, clock, sz, measure, targets)
      return spec.depth ? { ...out, items: out.items.map((i) => (i.kind === 'text' && i.id === 'right-value' ? edit(i) : i)) } : out
    }
    for (const [name, edit] of [
      ['text', (t: TextItem) => ({ ...t, text: `${t.text}!` })],
      ['look', (t: TextItem) => ({ ...t, look: { ...t.look, px: t.look.px + 1 } })],
      ['box', (t: TextItem) => ({ ...t, box: { ...t.box, x: t.box.x + 1 } })],
      ['opacity', (t: TextItem) => ({ ...t, opacity: t.opacity * 0.5 })]
    ] as const) {
      const r = depthListReading({ ...base, depth: 'dolly' }, st, FPS, size, fake, changing(edit))
      expect(r.textsDiffer.length, name).toBeGreaterThan(0)
      expect(r.textsDiffer.every((w) => w.endsWith(' right-value')), name).toBe(true)
    }
    const reordered: Drawer = (spec, style, clock, sz, measure, targets) => {
      const out = real(spec, style, clock, sz, measure, targets)
      return spec.depth ? { ...out, items: [...out.items].reverse() } : out
    }
    const r = depthListReading({ ...base, depth: 'dolly' }, st, FPS, size, fake, reordered)
    expect(r.settledListEqual).toBe(false)
    expect(r.textsDiffer).toEqual([])
  })

  it('the shapes and sizes: 540×960 and 960×540 for depth, 1920×1080 for the flat 16:9 parity', () => {
    expect(DEPTH_TEMPLATE_SHAPES.map((s) => `${s.name} ${s.width}x${s.height}`)).toEqual(['9:16 540x960', '16:9 960x540'])
    expect(FLAT_PARITY_WIDE).toEqual({ width: 1920, height: 1080 })
    expect(DEPTH_TEMPLATES_BAR).toEqual({ settledMax: 0, firstMinMax: 8, missingMax: 0 })
  })

  it('isDepthTemplate: the three and counter and ring; never a template with no depth rows, the screen card among them', () => {
    for (const t of [...STEP_SIX, 'counter', 'ring']) expect(isDepthTemplate(t), t).toBe(true)
    for (const t of ['bars', 'steps', 'quote', 'keyword', 'screen-card', 'nope']) expect(isDepthTemplate(t), t).toBe(false)
  })
})

describe('depthTemplatesVerdict', () => {
  const diff = (maxAll = 0, meanAll = 0): ChannelDiff => ({ mean: [meanAll, meanAll, meanAll, meanAll], max: [maxAll, 0, 0, 0], meanAll, maxAll, pixels: 100 })
  const move = (m: (typeof DEPTH_MOVES)[number]): DepthTemplateMoveReading => ({
    move: m,
    moving: 90,
    movingCamera: 11,
    firstOffFlat: 0,
    offFlatAfterLastBeat: 0,
    lastCamera: { tilt: 0, yaw: 0, dolly: 0, focusPx: 0 },
    textsChecked: 400,
    textsDiffer: [],
    settledListEqual: true,
    settled: diff(),
    firstFrame: 5,
    first: diff(120, 3),
    missing: { compositor: 'null', notes: [WEBGL_NOTE], frame: 5, againstPainterA: diff(), settledAgainstTwin: diff() }
  })
  const passing = (): { flat: FlatParityRow[]; cases: DepthTemplateCase[] } => ({
    flat: STEP_SIX.flatMap((t) =>
      DEPTH_TEMPLATE_SHAPES.map((s) => ({ fixture: `${t}-en`, template: t, shape: s.name, width: s.width * 2, height: s.height * 2, pass: true, failed: [], worstMean: 0.2 }))
    ),
    cases: STEP_SIX.flatMap((t) =>
      DEPTH_TEMPLATE_SHAPES.map((s) => ({ fixture: `${t}-en`, template: t, shape: s.name, width: s.width, height: s.height, moves: DEPTH_MOVES.map(move), previewDrawnFlat: true }))
    )
  })
  const asked = { depth: [...STEP_SIX], notDepth: [], noSpec: [], unknown: [] }
  const run = (edit: (p: ReturnType<typeof passing>) => void, a: Parameters<typeof depthTemplatesVerdict>[0] = asked): ReturnType<typeof depthTemplatesVerdict> => {
    const p = passing()
    edit(p)
    return depthTemplatesVerdict(a, p.flat, p.cases, WEBGL_NOTE)
  }

  it('passes the readings of all three at both shapes, flat and with each depth, by template', () => {
    const v = run(() => undefined)
    expect(v.failures).toEqual([])
    expect(v.pass).toBe(true)
    expect(v.byTemplate).toEqual({ timeline: true, 'before-after': true, versus: true })
  })

  it('names every bar that fails, on its own template only', () => {
    const one = (edit: (r: DepthTemplateMoveReading, c: DepthTemplateCase) => void): ReturnType<typeof depthTemplatesVerdict> =>
      run((p) => {
        const c = p.cases.find((x) => x.template === 'versus' && x.shape === '16:9')!
        edit(c.moves.find((r) => r.move === 'parallax')!, c)
      })
    const cases: [string, (r: DepthTemplateMoveReading, c: DepthTemplateCase) => void, RegExp][] = [
      ['settled 1 level off', (r) => (r.settled = diff(1)), /settled frame differs from its flat twin, max 1/u],
      ['a dead branch', (r) => (r.first = diff(7)), /differs from its flat twin by at most 7 < 8/u],
      ['a camera left off flat', (r) => (r.lastCamera = { tilt: 0, yaw: -0.001, dolly: 0, focusPx: 0 }), /last moving frame's yaw -0.001, not exactly 0/u],
      ['−0 is not 0', (r) => (r.lastCamera = { tilt: -0, yaw: 0, dolly: 0, focusPx: 0 }), /tilt 0, not exactly 0/u],
      ['a text changed', (r) => (r.textsDiffer = ['@12 left-label']), /text items changed by depth at @12 left-label/u],
      ['the settled list reordered', (r) => (r.settledListEqual = false), /settled frame's list is not the flat twin's/u],
      ['no frame off flat', (r) => (r.movingCamera = 0), /a dead branch/u],
      ['still moving after the last beat', (r) => (r.offFlatAfterLastBeat = 3), /3 frames from the last beat on are off flat/u],
      ['WebGL started', (r) => (r.missing.compositor = 'a compositor'), /createCompositor gave a compositor/u],
      ['no note', (r) => (r.missing.notes = []), /the notes were \[\], not the one note/u],
      ['not painter A', (r) => (r.missing.againstPainterA = diff(3)), /is not painter A's own picture \(max 3\)/u],
      ['missing settled off', (r) => (r.missing.settledAgainstTwin = diff(2)), /with WebGL missing, the settled frame differs/u],
      ['no Preview mark', (_r, c) => (c.previewDrawnFlat = false), /the Preview did not mark its clip drawn flat/u]
    ]
    for (const [name, edit, line] of cases) {
      const v = one(edit)
      expect(v.pass, name).toBe(false)
      expect(v.failures.join('\n'), name).toMatch(line)
      expect(v.byTemplate, name).toEqual({ timeline: true, 'before-after': true, versus: false })
    }
  })

  it('a move, a shape or a flat reading not read fails; so does a flat reading that failed', () => {
    expect(run((p) => (p.cases[0].moves = p.cases[0].moves.filter((r) => r.move !== 'focus'))).failures.join('\n')).toMatch(/timeline-en focus at 9:16: not read/u)
    expect(run((p) => (p.cases = p.cases.filter((c) => !(c.template === 'before-after' && c.shape === '16:9')))).failures.join('\n')).toMatch(/before-after-en at 16:9: not read/u)
    expect(run((p) => (p.cases = p.cases.filter((c) => c.template !== 'versus'))).failures.join('\n')).toMatch(/versus: no depth case was read/u)
    expect(run((p) => (p.flat = p.flat.filter((r) => !(r.template === 'timeline' && r.shape === '16:9')))).failures.join('\n')).toMatch(/timeline-en flat at 16:9: preview against export not read/u)
    const bad = run((p) => Object.assign(p.flat[1], { pass: false, failed: ['bakeAgainstPreview'], worstMean: 1.4 }))
    expect(bad.failures.join('\n')).toMatch(/timeline-en flat at 16:9 \(1920x1080\): preview against export FAIL \(bakeAgainstPreview; worst mean 1\.400\)/u)
    expect(bad.byTemplate.timeline).toBe(false)
  })

  it('a template asked with no depth, no fixture or no drawer is FAIL and named', () => {
    const v = run(() => undefined, { depth: [...STEP_SIX], notDepth: ['bars'], noSpec: ['ring'], unknown: ['nope'] })
    expect(v.pass).toBe(false)
    expect(v.byTemplate).toMatchObject({ bars: false, ring: false, nope: false, timeline: true })
    expect(v.failures.join('\n')).toMatch(/bars: not read, it has no depth/u)
  })
})
