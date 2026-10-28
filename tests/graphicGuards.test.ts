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

/*
 * Every guard a self-drawn kind joins reads one constant (docs/CLIPS.md §6.4,
 * §16.9): `SELF_DRAWN_FIELDS` in edit/recipes.ts, or the preview's
 * `LIVE_DRAWN_FIELDS`. This is the head lane's half of the test: the
 * behaviour of each list site over the constant, and the regex that no site
 * spells out a list of its own again. The wiring of the per-kind arms (the
 * store's rebakes, the preview's branch and sweep, the export's bake) is lane
 * C's half and comes with those arms.
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
 * `receiver.field` members of self-drawn fields joined by `??` or `||`. An
 * optional chain is not a match, so the preview's version keys
 * (`c.title?.version ?? …`) are never seen.
 */
const RECEIVER = '(?:layer\\.clip|clip|c)'
const FIELD = `(?:${SELF_DRAWN_FIELDS.join('|')})`
const SPELLED = new RegExp(`\\b${RECEIVER}\\.${FIELD} *(?:\\?\\?|\\|\\|) *${RECEIVER}\\.${FIELD}\\b`, 'g')

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
  'src/shared/director/apply.ts'
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
      'removed.filter((c) => c.text || c.solid || c.adjustment || c.moment || brought.has(c.assetId)).map((c) => c.assetId)'
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
