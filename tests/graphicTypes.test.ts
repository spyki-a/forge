/**
 * Step 3's types (docs/CLIPS.md §6.1, with §6.6's KeptGraphic and §6.7's
 * GraphicCandidate): every field exists with its type, every template id has
 * a data shape, and a project saved before any of them still is a Project.
 *
 * Most of this file is checked by the COMPILER, not by vitest: expectTypeOf
 * does nothing at run time, and the fixtures are typed declarations. Its guard
 * is `npm run typecheck` (tsconfig.node.json takes tests/), which CI runs;
 * a broken field fails there, not in `npm test`.
 *
 * Lists that later steps will grow (the template ids, the field modes, the
 * connectors, a proposal's reasons) are checked by MEMBERSHIP, never as a
 * whole, so adding the next one does not fail a test that was right.
 */
import { describe, it, expect, expectTypeOf } from 'vitest'
import type {
  FieldMode,
  GraphicCandidate,
  GraphicData,
  GraphicSpec,
  GraphicTemplateId,
  KeptGraphic,
  TemplateDef
} from '@shared/graphics/template'
import type { UnitRect } from '@shared/reframe/types'
import {
  DEFAULT_COLOR,
  DEFAULT_TRANSFORM,
  type Clip,
  type GraphicProposal,
  type GraphicsSettings,
  type MediaAsset,
  type Project
} from '@shared/timeline'
import { deserializeProject } from '@shared/project'

/**
 * Whether `K` may be left out of a `T`, key by key: `true` when every key in
 * `K` may, `false` when none may, and `boolean` when they differ, so a loop
 * over several keys checks each one rather than the set as a whole.
 */
type IsOptional<T, K extends keyof T> = K extends keyof T ? ({} extends Pick<T, K> ? true : false) : never
/** The data member a template id draws from. */
type Data<T extends GraphicTemplateId> = Extract<GraphicData, { template: T }>

/*
 * A project as every file saved before step 3 holds it: none of the new
 * fields on the project, the clip or the asset. Typed as Project, so making
 * any of them required fails typecheck here.
 */
const savedAsset: MediaAsset = {
  id: 'a1',
  path: '/footage/talk.mp4',
  name: 'talk.mp4',
  kind: 'video',
  durationFrames: 300,
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  size: 1000,
  frames: { pattern: '/cache/a1.seq/%05d.png', count: 12 }
}
const savedClip: Clip = {
  id: 'c1',
  assetId: 'a1',
  trackId: 'v1',
  start: 0,
  duration: 90,
  inPoint: 0,
  volume: 1,
  transform: { ...DEFAULT_TRANSFORM },
  color: { ...DEFAULT_COLOR }
}
const savedProject: Project = {
  id: 'p1',
  name: 'Saved before step 3',
  settings: { width: 1080, height: 1920, fps: 30, sampleRate: 48000 },
  assets: [savedAsset],
  tracks: [{ id: 'v1', kind: 'video', name: 'V1', muted: false, hidden: false, locked: false }],
  clips: [savedClip],
  transcripts: {},
  captions: { enabled: true, styleId: 'pop' }
}

describe('the template ids (§6.1)', () => {
  it('holds every id §6.1 lists, phases 2 and 3 and steps 5/6 included', () => {
    expectTypeOf<'counter'>().toExtend<GraphicTemplateId>()
    expectTypeOf<'bars'>().toExtend<GraphicTemplateId>()
    expectTypeOf<'steps'>().toExtend<GraphicTemplateId>()
    expectTypeOf<'quote'>().toExtend<GraphicTemplateId>()
    expectTypeOf<'callout'>().toExtend<GraphicTemplateId>()
    expectTypeOf<'ring'>().toExtend<GraphicTemplateId>()
    expectTypeOf<'keyword'>().toExtend<GraphicTemplateId>()
    expectTypeOf<'lower-third'>().toExtend<GraphicTemplateId>()
    expectTypeOf<'screen-card'>().toExtend<GraphicTemplateId>()
    expectTypeOf<'timeline'>().toExtend<GraphicTemplateId>()
    expectTypeOf<'before-after'>().toExtend<GraphicTemplateId>()
    expectTypeOf<'versus'>().toExtend<GraphicTemplateId>()
    expectTypeOf<'source'>().toExtend<GraphicTemplateId>()
    // No ninth id (chosen 2026-10-21): the tree is steps with a connector.
    expectTypeOf<'tree'>().not.toExtend<GraphicTemplateId>()
  })

  it('gives every id a data shape, and every data shape an id', () => {
    // §6.1 gives data to all thirteen ids, so none is left out here: the
    // discriminant and the id union are the same set, whichever grows.
    expectTypeOf<GraphicData['template']>().toEqualTypeOf<GraphicTemplateId>()
  })
})

describe('the data (§6.1)', () => {
  it('types each member as §6.1 writes it', () => {
    expectTypeOf<Data<'counter'>>().toMatchObjectType<{ template: 'counter'; value: string; label: string }>()
    expectTypeOf<Data<'bars'>>().toMatchObjectType<{ template: 'bars'; title: string; items: { label: string; value: string }[] }>()
    expectTypeOf<Data<'callout'>>().toMatchObjectType<{ template: 'callout'; label: string }>()
    expectTypeOf<Data<'ring'>>().toMatchObjectType<{ template: 'ring'; value: string; label: string }>()
    expectTypeOf<Data<'timeline'>>().toMatchObjectType<{ template: 'timeline'; items: { when: string; label: string }[] }>()
    expectTypeOf<Data<'before-after'>>().toMatchObjectType<{
      template: 'before-after'
      before: { label: string; value: string }
      after: { label: string; value: string }
    }>()
    expectTypeOf<Data<'versus'>>().toMatchObjectType<{
      template: 'versus'
      left: { label: string; value: string }
      right: { label: string; value: string }
    }>()
    expectTypeOf<Data<'source'>>().toMatchObjectType<{ template: 'source'; title: string; excerpt: string; outlet: string; date: string }>()
    expectTypeOf<'arrow'>().toExtend<Data<'callout'>['shape']>()
    expectTypeOf<'circle'>().toExtend<Data<'callout'>['shape']>()
    for (const kind of ['wiki', 'page', 'headline', 'answer'] as const) {
      expectTypeOf(kind).toExtend<Data<'source'>['kind']>()
    }
  })

  it('has both quote kinds: said, whose kind may be left out, and social', () => {
    type Said = Extract<Data<'quote'>, { speaker: string }>
    type Social = Extract<Data<'quote'>, { kind: 'social' }>
    expectTypeOf<Said>().toMatchObjectType<{ template: 'quote'; kind?: 'said'; text: string; speaker: string }>()
    expectTypeOf<IsOptional<Said, 'kind'>>().toEqualTypeOf<true>()
    expectTypeOf<Social>().toMatchObjectType<{
      template: 'quote'
      kind: 'social'
      text: string
      name: string
      handle: string
      date: string
      link: string
    }>()
  })

  it('types the amended members: steps with its parent and connector, keyword, lower-third, screen-card', () => {
    type Steps = Data<'steps'>
    expectTypeOf<Steps['title']>().toEqualTypeOf<string>()
    expectTypeOf<Steps['items'][number]['label']>().toEqualTypeOf<string>()
    expectTypeOf<Steps['items'][number]['parent']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<IsOptional<Steps['items'][number], 'parent'>>().toEqualTypeOf<true>()
    expectTypeOf<IsOptional<Steps, 'connector'>>().toEqualTypeOf<false>()
    expectTypeOf<'none'>().toExtend<Steps['connector']>()
    expectTypeOf<'line'>().toExtend<Steps['connector']>()
    expectTypeOf<'tree'>().toExtend<Steps['connector']>()

    expectTypeOf<Data<'keyword'>>().toMatchObjectType<{ template: 'keyword'; words: string; lit: number }>()
    expectTypeOf<Data<'lower-third'>>().toMatchObjectType<{ template: 'lower-third'; name: string; role: string }>()
    expectTypeOf<Data<'screen-card'>>().toMatchObjectType<{ template: 'screen-card'; clipId: string }>()
    expectTypeOf<'tilt-in'>().toExtend<Data<'screen-card'>['move']>()
    expectTypeOf<'pull-back'>().toExtend<Data<'screen-card'>['move']>()
  })
})

describe('the field modes and the template definition (§6.1)', () => {
  it('has every field mode, index included', () => {
    for (const mode of ['verbatim', 'grounded', 'fixed', 'speaker', 'user', 'index'] as const) {
      expectTypeOf(mode).toExtend<FieldMode>()
    }
  })

  it('types TemplateDef as §6.1 writes it, with appFields added', () => {
    expectTypeOf<TemplateDef['id']>().toEqualTypeOf<GraphicTemplateId>()
    expectTypeOf<TemplateDef['seconds']>().toEqualTypeOf<{ min: number; default: number; max: number }>()
    expectTypeOf<TemplateDef['fields']>().toEqualTypeOf<Record<string, FieldMode>>()
    expectTypeOf<TemplateDef['threeD']>().toEqualTypeOf<boolean>()
    expectTypeOf<IsOptional<TemplateDef, 'threeD'>>().toEqualTypeOf<false>()
    expectTypeOf<TemplateDef['kindFields']>().toEqualTypeOf<Record<string, Record<string, FieldMode>> | undefined>()
    expectTypeOf<TemplateDef['appFields']>().toEqualTypeOf<string[] | undefined>()
    expectTypeOf<TemplateDef['fixedTitles']>().toEqualTypeOf<string[] | undefined>()
    expectTypeOf<TemplateDef['pairs']>().toEqualTypeOf<[label: string, value: string][] | undefined>()
    expectTypeOf<TemplateDef['maxItems']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<TemplateDef['needsSubject']>().toEqualTypeOf<boolean | undefined>()
    for (const k of ['kindFields', 'appFields', 'fixedTitles', 'pairs', 'maxItems', 'needsSubject'] as const) {
      expectTypeOf<IsOptional<TemplateDef, typeof k>>().toEqualTypeOf<true>()
    }
  })
})

describe('the spec (§6.1)', () => {
  it('types every field of §6.1’s table, the required ones required', () => {
    expectTypeOf<GraphicSpec['data']>().toEqualTypeOf<GraphicData>()
    expectTypeOf<GraphicSpec['seconds']>().toEqualTypeOf<number>()
    expectTypeOf<GraphicSpec['beats']>().toEqualTypeOf<number[]>()
    expectTypeOf<GraphicSpec['place']>().toEqualTypeOf<
      { auto: true; third: 'top' | 'middle' | 'bottom' } | { auto: false; box: UnitRect }
    >()
    expectTypeOf<GraphicSpec['seed']>().toEqualTypeOf<number>()
    expectTypeOf<GraphicSpec['version']>().toEqualTypeOf<number>()
    for (const k of ['data', 'seconds', 'beats', 'place', 'seed', 'version'] as const) {
      expectTypeOf<IsOptional<GraphicSpec, typeof k>>().toEqualTypeOf<false>()
    }

    expectTypeOf<GraphicSpec['grounding']>().toEqualTypeOf<{ assetId: string; sentence: string; words: number[] } | undefined>()
    expectTypeOf<GraphicSpec['subject']>().toEqualTypeOf<{ clipId: string; box: UnitRect; ms: number } | undefined>()
    expectTypeOf<GraphicSpec['sources']>().toEqualTypeOf<
      { title: string; url: string; outlet: string; date: string; licence: string }[] | undefined
    >()
    expectTypeOf<GraphicSpec['style']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<GraphicSpec['hero']>().toEqualTypeOf<true | undefined>()
    expectTypeOf<GraphicSpec['anchor']>().toEqualTypeOf<{ assetId: string; event: string } | undefined>()
    for (const k of ['grounding', 'subject', 'sources', 'proposal', 'style', 'depth', 'hero', 'anchor'] as const) {
      expectTypeOf<IsOptional<GraphicSpec, typeof k>>().toEqualTypeOf<true>()
    }
  })

  it('widens the proposal (pointed, wordSource optional) and types the depth', () => {
    type Proposal = NonNullable<GraphicSpec['proposal']>
    expectTypeOf<'check-the-number'>().toExtend<Proposal['reason']>()
    expectTypeOf<'pointed'>().toExtend<Proposal['reason']>()
    expectTypeOf<IsOptional<Proposal, 'wordSource'>>().toEqualTypeOf<true>()
    for (const w of ['youtube-asr', 'youtube-lines', 'whisper-unsure'] as const) {
      expectTypeOf(w).toExtend<NonNullable<Proposal['wordSource']>>()
    }
    for (const d of ['tilt', 'parallax', 'dolly', 'focus'] as const) {
      expectTypeOf(d).toExtend<NonNullable<GraphicSpec['depth']>>()
    }
  })
})

describe('the seam between the validator and applyGraphics (§6.6, §6.7)', () => {
  it('types GraphicCandidate and KeptGraphic', () => {
    expectTypeOf<GraphicCandidate['sentence']>().toEqualTypeOf<string>()
    expectTypeOf<GraphicCandidate['bound']>().toEqualTypeOf<number[]>()
    expectTypeOf<GraphicCandidate['beatWords']>().toEqualTypeOf<number[]>()
    expectTypeOf<GraphicCandidate['why']>().toEqualTypeOf<string>()
    expectTypeOf<GraphicCandidate['data']>().toEqualTypeOf<GraphicData>()
    expectTypeOf<'model'>().toExtend<GraphicCandidate['source']>()
    expectTypeOf<'baseline'>().toExtend<GraphicCandidate['source']>()
    expectTypeOf<GraphicCandidate['proposal']>().toEqualTypeOf<GraphicSpec['proposal']>()
    expectTypeOf<IsOptional<GraphicCandidate, 'proposal'>>().toEqualTypeOf<true>()
    expectTypeOf<KeptGraphic['clipId']>().toEqualTypeOf<string>()
    expectTypeOf<KeptGraphic['assetId']>().toEqualTypeOf<string>()
    expectTypeOf<KeptGraphic['candidate']>().toEqualTypeOf<GraphicCandidate>()
  })
})

describe('the project, the clip and the asset (§6.1)', () => {
  it('gives the clip its graphic and a sound clip its graphic clip id, both optional', () => {
    expectTypeOf<Clip['graphic']>().toEqualTypeOf<GraphicSpec | undefined>()
    expectTypeOf<IsOptional<Clip, 'graphic'>>().toEqualTypeOf<true>()
    expectTypeOf<Clip['forGraphic']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<IsOptional<Clip, 'forGraphic'>>().toEqualTypeOf<true>()
  })

  it('gives the project its graphics settings and proposals, both optional', () => {
    expectTypeOf<Project['graphics']>().toEqualTypeOf<GraphicsSettings | undefined>()
    expectTypeOf<IsOptional<Project, 'graphics'>>().toEqualTypeOf<true>()
    expectTypeOf<GraphicsSettings>().toMatchObjectType<{ styleId: string; overrides?: Record<string, unknown>; sound: boolean }>()
    expectTypeOf<IsOptional<GraphicsSettings, 'overrides'>>().toEqualTypeOf<true>()
    expectTypeOf<IsOptional<GraphicsSettings, 'sound'>>().toEqualTypeOf<false>()

    expectTypeOf<Project['graphicProposals']>().toEqualTypeOf<GraphicProposal[] | undefined>()
    expectTypeOf<IsOptional<Project, 'graphicProposals'>>().toEqualTypeOf<true>()
    for (const k of ['id', 'clipId', 'rule', 'note'] as const) {
      expectTypeOf<GraphicProposal[typeof k]>().toEqualTypeOf<string>()
    }
    expectTypeOf<GraphicProposal['spec']>().toEqualTypeOf<GraphicSpec>()
  })

  it('gives the asset its speaker and its frames their box, both optional', () => {
    expectTypeOf<MediaAsset['speaker']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<IsOptional<MediaAsset, 'speaker'>>().toEqualTypeOf<true>()
    type Frames = NonNullable<MediaAsset['frames']>
    expectTypeOf<Frames['box']>().toEqualTypeOf<{ x: number; y: number; width: number; height: number } | undefined>()
    expectTypeOf<IsOptional<Frames, 'box'>>().toEqualTypeOf<true>()
  })

  it('opens a project saved before any of them, unchanged', () => {
    // The typed fixtures above are the compile-time half; this is the file.
    const file = JSON.parse(JSON.stringify({ schemaVersion: 1, app: { name: 'Forge', version: '0.1.0' }, project: savedProject }))
    const opened = deserializeProject(file).project
    expect(opened.clips).toEqual(savedProject.clips)
    expect(opened.assets).toEqual(savedProject.assets)
    expect(opened.clips[0].graphic).toBeUndefined()
    expect(opened.assets[0].frames?.box).toBeUndefined()
  })
})
