import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { DEFAULT_COLOR, DEFAULT_TEXT, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project, type Track } from '@shared/timeline'
import type { GraphicSpec } from '@shared/graphics/template'
import { DEFAULT_PAPER } from '@shared/render/paper'
import { DEFAULT_CAROUSEL } from '@shared/render/carousel'
import { LIVE_DRAWN_FIELDS, SELF_DRAWN_FIELDS, drawsItself, type SelfDrawnField } from '@shared/edit/recipes'
import { clipKind } from '@shared/edit/clipKind'
import { canMoveCamera } from '@shared/edit/camera'
import { isKeyable } from '@shared/render/chromaKey'
import { canSteady } from '@shared/render/steady'
import { COPY_RULE, DIRECTOR_RULES, SPINE_RULE, clearDirector } from '@shared/director/apply'
import { bakeForExport, type Bakers } from '@shared/render/exportBake'

/*
 * Every guard a self-drawn kind joins reads one constant (docs/CLIPS.md §6.4,
 * §16.9): `SELF_DRAWN_FIELDS` in edit/recipes.ts, or the preview's
 * `LIVE_DRAWN_FIELDS`. The head lane's half of the test: the behaviour of
 * each list site over the constant, and the regex that no site spells out a
 * list of its own again. Lane C's half, at the end: the wiring of the
 * per-kind arms (the store's three arms, the preview's branch and sweep, the
 * export's bakers and its branch), each anchored on unique text with its
 * arguments and counted before it is trusted, and the export's drop of a
 * graphic that will not draw. And the strips' shot rule, the two negated
 * lists (`!c.text && !c.solid`) §6.4's Built note recorded as unseen by the
 * regex: `buildStrips` in the store and `stripShotOf` on the panel's "Uses:"
 * line now read `drawsItself`, and the regex sees that form too; their
 * behaviour over the constant is tests/renderer/sourceChoice.test.ts's, where
 * a `.tsx` import typechecks (tsconfig.web.json).
 *
 * Membership throughout, never the whole list: the next self-drawn kind is
 * one line in the constant, and nothing here should need to change for it
 * beyond a sample clip carrying it.
 */

/** One sample of each self-drawn field. A `Record` over the type, so a new kind without a sample fails typecheck. */
const graphic: GraphicSpec = {
  data: { template: 'counter', value: '3x', label: 'faster' },
  seconds: 2.5,
  beats: [0.4],
  place: { auto: true, third: 'bottom' },
  seed: 7,
  version: 1
}
const CARRYING: Record<SelfDrawnField, Partial<Clip>> = {
  text: { text: { ...DEFAULT_TEXT, version: 1 } },
  paper: { paper: { ...DEFAULT_PAPER, keyword: 'glow' } },
  carousel: { carousel: { ...DEFAULT_CAROUSEL, assetIds: ['photo'] } },
  solid: { solid: { color: '#000000', opacity: 1, version: 1 } },
  title: { title: { template: 'lower-third', texts: ['Asha'], version: 1 } },
  moment: { moment: { kind: 'zoom-punch', from: { clipId: 'a' }, to: { clipId: 'b' }, seconds: 0.4, intensity: 0.5, seed: 7, version: 1 } },
  graphic: { graphic }
}
/* The samples' keys, not the constant: a field dropped from the constant is still tried here, and fails each site. */
const SAMPLED = Object.keys(CARRYING) as SelfDrawnField[]

const fps = 30
const video: Track = { id: 'v1', kind: 'video', name: 'V1', muted: false, hidden: false, locked: false }
const asset = (id: string, over: Partial<MediaAsset> = {}): MediaAsset => ({
  id, path: `/media/${id}.mp4`, name: id, kind: 'video', durationFrames: 300, width: 1080, height: 1920, fps: 30, hasVideo: true, hasAudio: false, size: 100, ...over
})
const clip = (over: Partial<Clip> & { id: string; assetId: string }): Clip => ({
  trackId: 'v1', start: 0, duration: 60, inPoint: 0, volume: 1, transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR }, ...over
})
/** A clip carrying only that one field, over a baked image. */
const carrying = (field: SelfDrawnField): Clip => clip({ id: `drawn-${field}`, assetId: 'baked', ...CARRYING[field] })

const FOOTAGE = { kind: 'video', hasVideo: true } as const
const PHOTO = { kind: 'image', hasVideo: true } as const

describe('the constant', () => {
  it('has a sample for every field, and graphic in both lists, solid and title only in the whole one', () => {
    for (const field of SELF_DRAWN_FIELDS) expect(SAMPLED, field).toContain(field)
    expect(SELF_DRAWN_FIELDS).toContain('graphic')
    expect(LIVE_DRAWN_FIELDS).toContain('graphic')
    expect(LIVE_DRAWN_FIELDS).not.toContain('solid')
    expect(LIVE_DRAWN_FIELDS).not.toContain('title')
    /*
     * The live list is a part of the whole one and holds every kind drawn live
     * today. Membership, not the set: a later kind the preview shows from its
     * baked file, as it does solid and title, is rightly left out of it.
     */
    for (const field of LIVE_DRAWN_FIELDS) expect(SELF_DRAWN_FIELDS).toContain(field)
    for (const field of ['text', 'paper', 'carousel', 'moment'] as const) expect(LIVE_DRAWN_FIELDS, field).toContain(field)
  })
})

describe('each list site, over the constant', () => {
  it('drawsItself (edit/recipes.ts) is true for a clip carrying any one field, and false for footage', () => {
    expect(drawsItself(clip({ id: 'shot', assetId: 'f' }))).toBe(false)
    expect(SAMPLED.filter((field) => !drawsItself(carrying(field)))).toEqual([])
  })

  it('isKeyable (render/chromaKey.ts) takes none of them', () => {
    expect(isKeyable({}, FOOTAGE)).toBe(true)
    expect(SAMPLED.filter((field) => isKeyable(carrying(field), FOOTAGE))).toEqual([])
  })

  it('canSteady (render/steady.ts) takes none of them', () => {
    expect(canSteady({}, FOOTAGE)).toBe(true)
    expect(SAMPLED.filter((field) => canSteady(carrying(field), FOOTAGE))).toEqual([])
  })

  it('canMoveCamera (edit/camera.ts) takes none of them, though each one’s asset is an image', () => {
    expect(canMoveCamera({}, PHOTO)).toBe(true)
    expect(SAMPLED.filter((field) => canMoveCamera(carrying(field), PHOTO))).toEqual([])
  })

  it('clipKind (edit/clipKind.ts) calls text and title text, and every other one a graphic', () => {
    const baked = asset('baked', { kind: 'image', path: '/cache/baked.png', fps: null })
    expect(clipKind(clip({ id: 'shot', assetId: 'f' }), asset('f'), video, fps)).toBe('video')
    const wrong = SAMPLED.filter((field) => {
      const want = field === 'text' || field === 'title' ? 'text' : 'graphic'
      return clipKind(carrying(field), baked, video, fps) !== want
    })
    expect(wrong).toEqual([])
  })

  it('clearDirector (director/apply.ts) takes the unused asset a Director-ruled clip drew, and never the footage', () => {
    expect(DIRECTOR_RULES).toContain(COPY_RULE)
    expect(DIRECTOR_RULES).toContain(SPINE_RULE)
    const kept = SAMPLED.filter((field) => {
      const project: Project = {
        ...emptyProject('guards'),
        assets: [asset('f'), asset('baked', { kind: 'image', path: '/cache/baked.png', fps: null })],
        clips: [
          clip({ id: 'shot', assetId: 'f', generatedBy: { rule: SPINE_RULE, reason: 'the shot' } }),
          { ...carrying(field), trackId: 'v2', generatedBy: { rule: COPY_RULE, reason: 'drawn' } }
        ]
      }
      const cleared = clearDirector(project)
      expect(cleared.clips, field).toEqual([])
      expect(cleared.assets.map((a) => a.id), field).toContain('f')
      return cleared.assets.some((a) => a.id === 'baked')
    })
    expect(kept).toEqual([])
  })
})

/* ------------------------------------------------------------ no list again */

const ROOT = resolve(__dirname, '..')
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : []
  })
/** Every `.ts` and `.tsx` under `src/`, by its repo-relative path with `/`, so the names compare the same on Windows. */
const SOURCES = new Map(walk(join(ROOT, 'src')).map((path) => [relative(ROOT, path).split(sep).join('/'), readFileSync(path, 'utf8')]))

/*
 * §6.4's regex, its alternation built from the constant itself: two direct
 * `receiver.field` members of self-drawn fields joined by `??` or `||`, or
 * two negated ones joined by `&&` (`!c.text && !c.solid`, the strips' shot
 * rule's form, which spans lines in the store, so that joint takes `\s`). An
 * optional chain is not a match, so the preview's version keys
 * (`c.title?.version ?? …`) are never seen.
 */
const RECEIVER = '(?:layer\\.clip|clip|c)'
const FIELD = `(?:${SELF_DRAWN_FIELDS.join('|')})`
const JOINED = `\\b${RECEIVER}\\.${FIELD} *(?:\\?\\?|\\|\\|) *${RECEIVER}\\.${FIELD}\\b`
const NEGATED = `!${RECEIVER}\\.${FIELD}\\s*&&\\s*!${RECEIVER}\\.${FIELD}\\b`
const SPELLED = new RegExp(`${JOINED}|${NEGATED}`, 'g')

/** The one allowed line: a classification into `'text'`, not a guard. */
const ALLOWED = { file: 'src/shared/edit/clipKind.ts', line: "if (clip.text ?? clip.title) return 'text'" }

/** Each line with a match, as its file and the line's whole text, less the one allowed. */
const spelledIn = (file: string, text: string): string[] => {
  const starts = new Set([...text.matchAll(SPELLED)].map((m) => text.lastIndexOf('\n', m.index) + 1))
  return [...starts]
    .map((start) => {
      const end = text.indexOf('\n', start)
      return text.slice(start, end === -1 ? undefined : end).trim()
    })
    .filter((line) => !(file === ALLOWED.file && line === ALLOWED.line))
    .map((line) => `${file}: ${line}`)
}

/** The preview's readiness gate and `ready`, each body whole and nothing between them. */
const GATE =
  /const drawsItself = \(layer: Layer\): boolean =>\s*LIVE_DRAWN_FIELDS\.some\(\(field\) => Boolean\(layer\.clip\[field\]\)\)\s+const ready = \(layer: Layer\): boolean =>\s*drawsItself\(layer\) \? true : elementReady\(layer\.element\)\r?\n/g

const SITES = [
  'src/shared/edit/recipes.ts',
  'src/renderer/src/components/Preview.tsx',
  'src/shared/edit/clipKind.ts',
  'src/shared/render/chromaKey.ts',
  'src/shared/render/steady.ts',
  'src/shared/edit/camera.ts',
  'src/shared/director/apply.ts',
  // The strips' shot rule, in the store and on the panel's line (their negated lists, as they stood at fa4ddc3).
  'src/renderer/src/store.ts',
  'src/renderer/src/components/tools/SourceLine.tsx'
]

describe('no list of self-drawn fields is spelled out again', () => {
  it('the regex sees each list the sites spelled out before the constant', () => {
    // The seven list sites' lines as they stood at 4e59965, and the allowed one.
    const before = [
      'return Boolean(clip.text ?? clip.paper ?? clip.carousel ?? clip.solid ?? clip.title ?? clip.moment)',
      'Boolean(layer.clip.text ?? layer.clip.paper ?? layer.clip.carousel ?? layer.clip.moment)',
      "if (clip.text ?? clip.title) return 'text'",
      "if (clip.paper ?? clip.carousel ?? clip.solid ?? clip.moment) return 'graphic'",
      'if (clip.adjustment || clip.text || clip.title || clip.paper || clip.carousel || clip.solid || clip.moment) return false',
      'removed.filter((c) => c.text || c.solid || c.adjustment || c.moment || brought.has(c.assetId)).map((c) => c.assetId)',
      // The strips' two negated lists as they stood at fa4ddc3: the panel's on one line, the store's across four.
      // The four-line one is what holds NEGATED's joint to `\s*`: folded onto one line it would guard nothing of the kind.
      '(c) => videoTracks.some((t) => t.id === c.trackId) && !c.generatedBy && !c.text && !c.solid && !c.adjustment',
      '        videoTracks.some((t) => t.id === c.trackId) &&\n        !c.generatedBy &&\n        !c.text &&\n        !c.solid &&\n        !c.adjustment'
    ]
    expect(before.filter((line) => [...line.matchAll(SPELLED)].length === 0)).toEqual([])
    // An optional chain is a key, not a guard.
    expect([...'c.title?.version ?? c.text?.version ?? c.solid?.version'.matchAll(SPELLED)]).toHaveLength(0)
  })

  it.each(SITES)('%s spells out none', (file) => {
    const text = SOURCES.get(file)
    expect(text, file).toBeDefined()
    expect(spelledIn(file, text!)).toEqual([])
  })

  it('nor does any other file under src/', () => {
    const others = [...SOURCES].filter(([file]) => !SITES.includes(file))
    expect(others.length).toBeGreaterThan(100)
    expect(others.flatMap(([file, text]) => spelledIn(file, text))).toEqual([])
  })

  it('the constant is declared once under src/', () => {
    const declared = [...SOURCES].flatMap(([file, text]) => [...text.matchAll(/export const SELF_DRAWN_FIELDS\b/g)].map(() => file))
    expect(declared).toEqual(['src/shared/edit/recipes.ts'])
  })

  it('the preview’s readiness gate reads the live list, once, and no other', () => {
    const preview = SOURCES.get('src/renderer/src/components/Preview.tsx')!
    // The bare name also occurs in the import, so the use expression is what is counted.
    expect([...preview.matchAll(/LIVE_DRAWN_FIELDS\.some\(/g)]).toHaveLength(1)
    expect([...preview.matchAll(/const drawsItself = \(layer: Layer\): boolean =>/g)]).toHaveLength(1)
    expect([...preview.matchAll(/drawsItself\(layer\) \? true : elementReady\(layer\.element\)/g)]).toHaveLength(1)
    /*
     * Both bodies whole, from the gate's declaration to the end of `ready`'s
     * line. Preview has no behaviour test, so this is the gate's only guard,
     * and a prefix is not one: `… || Boolean(layer.clip.solid)` shows solid
     * before its file, `… || SELF_DRAWN_FIELDS.some(…)` solid and title
     * before theirs, and `… && !layer.clip.graphic` holds a graphic at the
     * gate for good, each after a prefix that still matches.
     */
    expect([...preview.matchAll(GATE)]).toHaveLength(1)
  })
})

/* ------------------------------------------------------- lane C's wiring */

/**
 * A store action's body: from its own anchor (counted once) to the next
 * action's anchor, not a fixed slice length (docs/CLIPS.md §6.4, "The wiring").
 */
function body(text: string, from: string, to: string): string {
  const starts = [...text.matchAll(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))]
  expect(starts, from).toHaveLength(1)
  const start = starts[0].index!
  const end = text.indexOf(to, start)
  expect(end, to).toBeGreaterThan(start)
  return text.slice(start, end)
}

describe('lane C’s wiring: every per-kind arm has its graphic arm', () => {
  const store = SOURCES.get('src/renderer/src/store.ts')!
  const preview = SOURCES.get('src/renderer/src/components/Preview.tsx')!

  it('the store’s three arms: rebakeGenerated, placeCopies and rebakeFollowed each reach rebakeGraphic', () => {
    const rebake = body(store, 'rebakeGenerated: async () => {', 'rebakeFollowed: async (assetIds) => {')
    expect(rebake).toContain('project.clips.filter(drawsItself)')
    expect(rebake).toContain('if (clip.graphic) {')
    expect(rebake).toContain('await get().rebakeGraphic(clip.id)')
    const followed = body(store, 'rebakeFollowed: async (assetIds) => {', 'audition: null,')
    // The clip the targets read: `spec.subject`'s, or the caption track's under the graphic's first frame.
    expect(followed).toContain("subject ? (project.clips.find((c) => c.id === subject.clipId) ?? null) : captionSourceClip(project, clip.start)")
    // Lane T2b: or when the reframe's place.auto recompute moved it (placeAgainQuietly).
    expect(followed).toContain('if ((under && assetIds.includes(under.assetId)) || moved) await get().rebakeGraphic(clip.id)')
    const paste = body(store, 'placeCopies: async (board, frame) => {', 'revealClip: (clipId) => {')
    expect(paste).toContain('else if (from.graphic) await get().rebakeGraphic(clipId)')
  })

  it('the preview’s branch draws a graphic live through graphicPreviewCanvas with its clock and the onset targets, shows nothing rather than a stale file, and its sweep forgets it', () => {
    expect([...preview.matchAll(/LIVE_DRAWN_FIELDS\.some\(/g)]).toHaveLength(1)
    const branches = [...preview.matchAll(/if \(layer\.clip\.graphic\) \{/g)]
    expect(branches).toHaveLength(1)
    const start = branches[0].index!
    const next = preview.indexOf('if (layer.clip.', start + 1)
    const branch = preview.slice(start, next)
    expect(branch).toContain('graphicPreviewCanvas(')
    expect(branch).toContain('graphicStyleOf(project, layer.clip.graphic)')
    expect(branch).toContain('{ frame: playhead - layer.clip.start, total: layer.clip.duration, fps }')
    expect(branch).toContain('graphicTargetsAt(project, layer.clip, layer.clip.graphic, playhead,')
    expect(branch).toContain('return live ?? nothing()')
    expect([...preview.matchAll(/forgetGraphicPreview\(clipId\)/g)]).toHaveLength(1)
  })

  it('the export’s bakers hand a graphic to the store’s own bake, its arguments in order, and the export drops a failed one on a line of its own', () => {
    const bakers = SOURCES.get('src/renderer/src/exportBakers.ts')!
    expect(bakers).toMatch(
      /graphic: \(spec, style, key, width, height, frames, fps, targetsAt, boxAllowed\) =>\s*bakeGraphicSequence\(spec, style, key, width, height, frames, fps, targetsAt, boxAllowed\)/
    )
    const exportBake = SOURCES.get('src/shared/render/exportBake.ts')!
    // The catch's two lines, each its own (§6.4's regex refuses `clip.moment || clip.graphic`).
    expect([...exportBake.matchAll(/\n *if \(clip\.moment\) dropped\.add\(clip\.id\)\n/g)]).toHaveLength(1)
    expect([...exportBake.matchAll(/\n *if \(clip\.graphic\) dropped\.add\(clip\.id\)\n/g)]).toHaveLength(1)
    expect([...exportBake.matchAll(/identityPlaced\(clip\)/g)]).toHaveLength(1)
  })
})

describe('lane C’s export: a graphic that will not draw is dropped, and said', () => {
  const unused = async (): Promise<never> => { throw new Error('not this one') }
  const bakers = (graphic: Bakers['graphic']): Bakers => ({
    text: unused, textSequence: async () => null, solid: unused, title: unused, paper: unused, carousel: unused, moment: unused, graphic
  })
  const edit = (): Project => ({
    ...emptyProject('guards'),
    assets: [asset('f'), asset('g', { kind: 'image', path: '', fps: null, size: 0 })],
    clips: [clip({ id: 'shot', assetId: 'f' }), { ...carrying('graphic'), id: 'g', assetId: 'g', trackId: 'v2' }]
  })

  it('a null bake and a bake that throws each leave the graphic out of the export, onError heard, the shot kept', async () => {
    const errors: string[] = []
    const nulled = await bakeForExport(edit(), { width: 1080, height: 1920 }, bakers(async () => null), (c, err) => errors.push(`${c.id}: ${String(err)}`))
    expect(nulled.clips.map((c) => c.id)).toEqual(['shot'])
    expect(errors).toEqual(['g: Error: the graphic could not be drawn'])
    // Never an asset with an empty path in the export: the shot's stays as it was.
    expect(nulled.assets.find((a) => a.id === 'f')).toEqual(asset('f'))

    const threw = await bakeForExport(edit(), { width: 1080, height: 1920 }, bakers(async () => { throw new Error('no canvas') }), (c, err) => errors.push(`${c.id}: ${String(err)}`))
    expect(threw.clips.map((c) => c.id)).toEqual(['shot'])
    expect(errors[1]).toBe('g: Error: no canvas')
  })

  it('a drawn one stays', async () => {
    const drawn = await bakeForExport(edit(), { width: 1080, height: 1920 }, bakers(async () => ({ pattern: '/cache/g-export.seq/%05d.png', frames: 12 })))
    expect(drawn.clips.map((c) => c.id)).toEqual(['shot', 'g'])
    expect(drawn.assets.find((a) => a.id === 'g')!.frames).toEqual({ pattern: '/cache/g-export.seq/%05d.png', count: 12 })
  })
})
