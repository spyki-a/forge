import { describe, expect, it } from 'vitest'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { COPY_RULE, GRAPHIC_RULE, clearDirector } from '@shared/director/apply'
import type { Segment, Transcript, Word } from '@shared/transcript'
import { CLIPS_GRAPHIC_RULE, LIBRARY_GRAPHIC_RULE, applyGraphics, clearGraphics, clearClipGraphics, drawnStrings, drawnText, withSpeaker } from '@shared/graphics/apply'
import { LEAD_S, BEAT_GAP_S, graphicSeconds } from '@shared/graphics/beats'
import { ON_SCREEN_REASON, tooCloseReason, zoomPunchReason } from '@shared/graphics/budget'
import { drawListAt, drawnTemplates, graphicFits } from '@shared/graphics/drawList'
import type { DrawItem, TextMeasure } from '@shared/graphics/items'
import { thirdPreference } from '@shared/graphics/place'
import { GRAPHIC_STYLES, CLEAN_GRAPHIC_STYLE } from '@shared/graphics/style'
import { graphicTargetsAt } from '@shared/graphics/targets'
import { GRAPHIC_TEMPLATES, SPEAKER_PLACEHOLDER, type GraphicSpec, type GraphicTemplateId, type KeptGraphic } from '@shared/graphics/template'
import {
  CALLOUT_LEFT_OUT,
  LIBRARY_GRAPHICS,
  LIBRARY_LEFT_OUT,
  NOT_IN_LIBRARY_NOTE,
  SCREEN_CARD_LEFT_OUT,
  libraryCandidates,
  libraryDragPayload,
  libraryElements,
  libraryGraphic,
  libraryGraphicAt,
  libraryGraphicSpec,
  librarySampleFace,
  librarySampleList,
  tileFit,
  TILE_FRAME,
  TILE_PAD,
  searchLibraryGraphics
} from '@shared/graphics/library'
import { acceptsKind, canvasDropChip, canvasDropRoute, trackDropRoute, type DragPayload } from '@shared/dragPayload'

/*
 * Try-out 1 (2026-11-15), piece 6: the graphics engine's templates in the
 * Library (src/shared/graphics/library.ts), the pure half. The list is
 * derived from what is drawn; each entry's spec is whole, fits every look at
 * both shapes, times every element in turn and carries no grounding; where a
 * tile lands and when it is refused; whose it is (no Clear sweeps it, the
 * budget holds it); the lower third's placeholder name and the Speaker; the
 * drop routes. The store, the drawer and the render have files of their own
 * (tests/renderer/libraryGraphics.test.tsx, tests/integration/graphic.int.test.ts).
 */

const FPS = 30

/** node's stand-in for the canvas's measure, as the drawers' own tests use (0.55 em a character), and a wider one. */
const measureAt = (em: number): TextMeasure => (text, look) => ({ width: text.length * look.px * em, ascent: look.px * 0.8, descent: look.px * 0.2 })
const MEASURE = measureAt(0.55)
const MEASURES: readonly [string, TextMeasure][] = [
  ['0.55 em', MEASURE],
  ['0.7 em', measureAt(0.7)]
]
const SIZES = [
  { width: 1080, height: 1920 },
  { width: 1920, height: 1080 }
] as const

const footage = (id: string, extra: Partial<MediaAsset> = {}): MediaAsset => ({
  id, path: `/media/${id}.mp4`, name: id, kind: 'video', durationFrames: FPS * 60, width: 1080, height: 1920, fps: FPS, hasVideo: true, hasAudio: true, size: 1, ...extra
})
const shot = (id: string, assetId: string, start: number, duration = FPS * 30): Clip => ({
  id, assetId, trackId: 'v1', start, duration, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 }
})
const graphicClip = (id: string, start: number, spec: GraphicSpec, extra: Partial<Clip> = {}): Clip => ({
  ...shot(id, `drawn-${id}`, start, Math.round(spec.seconds * FPS)), trackId: 'v2', graphic: spec, ...extra
})

function project(over: Partial<Project> = {}): Project {
  const base = emptyProject('library graphics')
  return {
    ...base,
    settings: { ...base.settings, width: 1080, height: 1920, fps: FPS },
    // Captions off unless a case wants them: the third is then the subject's and the preference's alone.
    captions: { enabled: false, styleId: 'pop' },
    assets: [footage('talk')],
    clips: [shot('shot', 'talk', 0)],
    ...over
  }
}

const entry = (id: GraphicTemplateId) => {
  const e = libraryGraphic(id)
  if (!e) throw new Error(`the Library does not list ${id}`)
  return e
}

describe('the list is derived from what is drawn', () => {
  it('lists every template the engine knows, or leaves it out by a named reason, never both', () => {
    const listed = new Set<string>(LIBRARY_GRAPHICS.map((e) => e.id))
    const known = libraryCandidates()
    // Every drawer and every row of GRAPHIC_TEMPLATES is among what is weighed.
    for (const id of drawnTemplates()) expect(known, `drawn ${id}`).toContain(id)
    for (const id of Object.keys(GRAPHIC_TEMPLATES)) expect(known, `row ${id}`).toContain(id)
    const neither = known.filter((id) => !listed.has(id) && LIBRARY_LEFT_OUT[id] === undefined)
    const both = known.filter((id) => listed.has(id) && LIBRARY_LEFT_OUT[id] !== undefined)
    expect(neither, 'templates neither listed nor left out by a reason').toEqual([])
    expect(both, 'templates listed and left out at once').toEqual([])
  })

  it('leaves out the callout and the screen card by their reasons, and lists the seven others with their names', () => {
    expect(LIBRARY_LEFT_OUT.callout).toBe(CALLOUT_LEFT_OUT)
    expect(LIBRARY_LEFT_OUT['screen-card']).toBe(SCREEN_CARD_LEFT_OUT)
    const byId = Object.fromEntries(LIBRARY_GRAPHICS.map((e) => [e.id, e.name]))
    expect(byId).toMatchObject({ counter: 'Counter', bars: 'Bars', steps: 'Steps', quote: 'Quote', ring: 'Ring', keyword: 'Keyword', 'lower-third': 'Lower third' })
    // Exactly the weighed templates not left out, in the drawers' order: no pinned count to break when a ninth is rightly listed.
    expect(LIBRARY_GRAPHICS.map((e) => e.id)).toEqual(libraryCandidates().filter((id) => LIBRARY_LEFT_OUT[id] === undefined))
    // Every entry draws: it has a drawer and a template row.
    for (const e of LIBRARY_GRAPHICS) {
      expect(drawnTemplates(), e.id).toContain(e.id)
      expect(GRAPHIC_TEMPLATES[e.id], e.id).toBeDefined()
    }
  })

  it('offers only the said quote, never the social card', () => {
    const quote = entry('quote').data
    expect(quote.template === 'quote' && quote.kind !== 'social').toBe(true)
  })

  it('samples only placeholder words: no number-free headline, the lower third named by the placeholder', () => {
    const lower = entry('lower-third').data
    expect(lower.template === 'lower-third' && lower.name).toBe(SPEAKER_PLACEHOLDER)
    // Titles are the templates' own fixed titles, never a headline of the app's.
    for (const e of LIBRARY_GRAPHICS) {
      const d = e.data
      if ((d.template === 'bars' || d.template === 'steps') && GRAPHIC_TEMPLATES[d.template]!.fixedTitles) {
        expect(GRAPHIC_TEMPLATES[d.template]!.fixedTitles, e.id).toContain(d.title)
      }
    }
  })
})

describe('each entry makes a whole spec', () => {
  it('within the template’s seconds, at least its default, with no grounding, no proposal and no style', () => {
    for (const e of LIBRARY_GRAPHICS) {
      const def = GRAPHIC_TEMPLATES[e.id]!
      const spec = libraryGraphicSpec(e)
      expect(spec.data.template, e.id).toBe(e.id)
      expect(spec.seconds, `${e.id} seconds`).toBeGreaterThanOrEqual(def.seconds.default)
      expect(spec.seconds, `${e.id} seconds`).toBeLessThanOrEqual(def.seconds.max)
      // §6.2's reading hold over its own beats and words is met: graphicSeconds asks no more.
      const need = graphicSeconds(def, spec.beats, drawnText(spec.data))
      expect(need, `${e.id}: graphicSeconds`).not.toBeNull()
      expect(spec.seconds + 1e-9, `${e.id}: seconds against the hold`).toBeGreaterThanOrEqual(need!)
      expect(spec).not.toHaveProperty('grounding')
      expect(spec).not.toHaveProperty('proposal')
      expect(spec).not.toHaveProperty('style')
      expect(spec.place, e.id).toEqual({ auto: true, third: thirdPreference(e.id)[0] })
      expect(spec.version, e.id).toBe(1)
    }
  })

  it('times every element in turn: the first at LEAD_S, each 160 ms after the one before, all inside the seconds', () => {
    for (const e of LIBRARY_GRAPHICS) {
      const spec = libraryGraphicSpec(e)
      expect(spec.beats.length, `${e.id}: a beat per element`).toBe(libraryElements(spec.data))
      expect(spec.beats[0], e.id).toBeCloseTo(LEAD_S, 9)
      for (let i = 1; i < spec.beats.length; i++) expect(spec.beats[i] - spec.beats[i - 1], `${e.id} beat ${i}`).toBeCloseTo(BEAT_GAP_S, 9)
      for (const b of spec.beats) expect(b, e.id).toBeLessThan(spec.seconds)
    }
    expect(libraryGraphicSpec(entry('bars')).beats).toHaveLength(3)
    expect(libraryGraphicSpec(entry('steps')).beats).toHaveLength(3)
  })

  it('gives a said quote a beat for each word its drawer draws', () => {
    const spec = libraryGraphicSpec(entry('quote'), { place: { auto: true, third: 'middle' } })
    const list = drawListAt(spec, CLEAN_GRAPHIC_STYLE, Math.round(spec.seconds * FPS) - 1, FPS, SIZES[0], MEASURE)
    const words = list.items.filter((i) => /^word(-\d+)?$/.test(i.id))
    expect(words.length).toBeGreaterThan(0)
    expect(spec.beats).toHaveLength(words.length)
  })

  it('fits every look at 1080×1920 and 1920×1080, at both widths of type, and draws at its settled frame', () => {
    const misses: string[] = []
    for (const e of LIBRARY_GRAPHICS) {
      for (const third of ['top', 'middle', 'bottom'] as const) {
        const spec = libraryGraphicSpec(e, { place: { auto: true, third } })
        for (const style of GRAPHIC_STYLES) {
          for (const size of SIZES) {
            for (const [em, measure] of MEASURES) {
              const at = `${e.id} ${third} ${style.id} ${size.width}x${size.height} ${em}`
              if (!graphicFits(spec, style, size, measure)) misses.push(`${at}: does not fit`)
              else if (drawListAt(spec, style, Math.round(spec.seconds * FPS) - 1, FPS, size, measure).items.length === 0) misses.push(`${at}: draws nothing settled`)
            }
          }
        }
      }
    }
    expect(misses).toEqual([])
  })

  /*
   * Read on the harness page, 2026-11-15: laid out at the tile's own size (95
   * by 53 px) the Bars face drew NO item and the other faces set their lines
   * on top of each other, while this test asked at 320 by 180, a size no tile
   * ever used, and passed. The face has ONE size now (`TILE_FRAME`, a real
   * frame) and the tile shows it scaled down, so what is checked here is what
   * the tile paints.
   */
  it('draws every tile’s face in every look at the one frame the tile lays out at, with something to show', () => {
    expect(TILE_FRAME.width / TILE_FRAME.height).toBeCloseTo(16 / 9, 6)
    // A real frame, not a thumbnail: the smallest side a template is fit-tested at is 1080; half of that is the floor here.
    expect(Math.min(TILE_FRAME.width, TILE_FRAME.height)).toBeGreaterThanOrEqual(540)
    for (const e of LIBRARY_GRAPHICS) {
      for (const style of GRAPHIC_STYLES) {
        const at = `${e.id} ${style.id}`
        const face = librarySampleFace(e, style, MEASURE)
        expect(face.list.items.length, at).toBeGreaterThan(0)
        expect(face.list.width, at).toBe(TILE_FRAME.width)
        expect(face.list.height, at).toBe(TILE_FRAME.height)
        expect(librarySampleList(e, style, MEASURE).items.length, at).toBe(face.list.items.length)
        const b = face.bounds
        expect(b, at).not.toBeNull()
        // Inside the frame, and large enough to be a picture once scaled into a tile.
        expect(b!.x, at).toBeGreaterThanOrEqual(0)
        expect(b!.y, at).toBeGreaterThanOrEqual(0)
        expect(b!.x + b!.width, at).toBeLessThanOrEqual(TILE_FRAME.width)
        expect(b!.y + b!.height, at).toBeLessThanOrEqual(TILE_FRAME.height)
        expect(b!.width, at).toBeGreaterThan(TILE_FRAME.width * 0.1)
        expect(b!.height, at).toBeGreaterThan(TILE_FRAME.height * 0.08)
      }
    }
  })

  it('step 6’s three (docs/CLIPS.md §9) are tiles by their names, a beat per row or side, and every word of their sample on the face', () => {
    const names = Object.fromEntries(LIBRARY_GRAPHICS.map((e) => [e.id, e.name]))
    expect(names).toMatchObject({ timeline: 'Timeline', 'before-after': 'Before and after', versus: 'Versus' })
    for (const id of ['timeline', 'before-after', 'versus'] as const) expect(LIBRARY_LEFT_OUT[id], id).toBeUndefined()
    const timeline = entry('timeline')
    expect(libraryGraphicSpec(timeline).beats).toHaveLength((timeline.data as { items: unknown[] }).items.length)
    expect(libraryGraphicSpec(entry('before-after')).beats).toHaveLength(2)
    expect(libraryGraphicSpec(entry('versus')).beats).toHaveLength(2)
    const texts = (items: readonly DrawItem[]): string[] => items.flatMap((i) => (i.kind === 'text' ? [i.text] : i.kind === 'group' ? texts(i.children) : []))
    for (const id of ['timeline', 'before-after', 'versus'] as const) {
      const e = entry(id)
      const drawn = texts(librarySampleFace(e, CLEAN_GRAPHIC_STYLE, MEASURE).list.items).join(' ')
      for (const word of drawnStrings(e.data).join(' ').split(/\s+/u).filter(Boolean)) expect(drawn.split(' '), `${id}: ${word} on the face`).toContain(word)
      // No title: the app writes no headline (§9).
      expect(e.data, id).not.toHaveProperty('title')
    }
  })

  it('every row of bars and steps is on the face: one label per row', () => {
    for (const id of ['bars', 'steps'] as const) {
      const e = libraryGraphic(id)!
      const rows = (e.data as { items: { label: string }[] }).items.map((i) => i.label)
      const texts = (items: readonly DrawItem[]): string[] => items.flatMap((i) => (i.kind === 'text' ? [i.text] : i.kind === 'group' ? texts(i.children) : []))
      const drawn = texts(librarySampleFace(e, CLEAN_GRAPHIC_STYLE, MEASURE).list.items)
      for (const label of rows) expect(drawn.some((t) => t.includes(label)), `${id}: ${label} in ${JSON.stringify(drawn)}`).toBe(true)
    }
  })

  it('tileFit keeps the face’s shape, leaves the pad clear and centres it, for a wide face and a tall one', () => {
    const tile = { width: 95, height: 53 }
    for (const bounds of [
      { x: 119, y: 258, width: 942, height: 205 },
      { x: 518, y: 235, width: 244, height: 259 }
    ]) {
      const at = tileFit(bounds, tile)
      expect(at.width / at.height).toBeCloseTo(bounds.width / bounds.height, 6)
      expect(at.x).toBeGreaterThanOrEqual(tile.width * TILE_PAD - 1e-9)
      expect(at.y).toBeGreaterThanOrEqual(tile.height * TILE_PAD - 1e-9)
      expect(at.x + at.width).toBeLessThanOrEqual(tile.width * (1 - TILE_PAD) + 1e-9)
      expect(at.y + at.height).toBeLessThanOrEqual(tile.height * (1 - TILE_PAD) + 1e-9)
      expect(at.x + at.width / 2).toBeCloseTo(tile.width / 2, 6)
      expect(at.y + at.height / 2).toBeCloseTo(tile.height / 2, 6)
      // As large as fits: one side reaches the pad.
      const touches = Math.abs(at.width - tile.width * (1 - 2 * TILE_PAD)) < 1e-6 || Math.abs(at.height - tile.height * (1 - 2 * TILE_PAD)) < 1e-6
      expect(touches).toBe(true)
    }
  })
})

describe('the callout, measured: why it is left out', () => {
  const spec: GraphicSpec = { data: { template: 'callout', label: 'Look here', shape: 'arrow' }, seconds: 2.5, beats: [0.5], place: { auto: true, third: 'middle' }, seed: 1, version: 1 }
  const draw = (subject: { x: number; y: number; width: number; height: number } | null | undefined): number =>
    drawListAt(spec, CLEAN_GRAPHIC_STYLE, 74, FPS, SIZES[0], MEASURE, subject === undefined ? {} : { subject }).items.length

  it('draws over a subject, and nothing with none', () => {
    expect(draw({ x: 400, y: 800, width: 300, height: 300 }), 'over a subject').toBeGreaterThan(0)
    expect(draw(null), 'subject null').toBe(0)
    expect(draw(undefined), 'no subject resolved').toBe(0)
  })

  it('finds no subject by hand over footage with no subject track, nor over no footage', () => {
    const p = project()
    const over = graphicTargetsAt(p, { start: 30 }, {}, 30, SIZES[0])
    expect(over.subject, 'over footage with no subject track').toBeNull()
    const none = graphicTargetsAt(project({ clips: [] }), { start: 30 }, {}, 30, SIZES[0])
    expect(none.subject, 'over no footage').toBeNull()
  })
})

describe('where a tile lands (libraryGraphicAt)', () => {
  it('over footage takes the third placement gives; with the captions at the bottom a counter still takes the middle', () => {
    const p = project({ captions: { enabled: true, styleId: 'pop' } })
    const got = libraryGraphicAt(p, 'counter', 60)
    expect('spec' in got && got.spec.place).toEqual({ auto: true, third: 'middle' })
    expect('spec' in got && got.footageId).toBe('shot')
  })

  it('moves a lower third off the captions’ third: the top when they take the bottom', () => {
    const p = project({ captions: { enabled: true, styleId: 'pop' } })
    const got = libraryGraphicAt(p, 'lower-third', 60)
    expect('spec' in got && got.spec.place).toEqual({ auto: true, third: 'top' })
  })

  it('over no footage takes the template’s first preferred third', () => {
    const got = libraryGraphicAt(project({ clips: [] }), 'lower-third', 60)
    expect('spec' in got && got.spec.place).toEqual({ auto: true, third: 'bottom' })
    expect('spec' in got && got.footageId).toBeNull()
  })

  it('refuses where another graphic is on screen then, with the budget’s words', () => {
    const other = libraryGraphicSpec(entry('ring'))
    const p = project({ clips: [shot('shot', 'talk', 0), graphicClip('g1', 30, other)] })
    expect(libraryGraphicAt(p, 'counter', 60)).toEqual({ refused: ON_SCREEN_REASON })
    // A Director card counts too.
    const card: Clip = { ...shot('card', 'card-asset', 50, 30), trackId: 'v2', generatedBy: { rule: COPY_RULE, reason: 'r' } }
    const withCard = libraryGraphicAt(project({ clips: [shot('shot', 'talk', 0), card] }), 'counter', 40)
    expect(withCard).toEqual({ refused: ON_SCREEN_REASON })
  })

  it('refuses over a zoom move on the footage beneath, with the punch’s time; lands where the zoom only holds', () => {
    // The footage's zoom goes 1 → 1.2 over its frames [330, 360): 11 s to 12 s. A counter (3 s) at frame 300 covers [300, 390).
    const zoomed: Clip = { ...shot('shot', 'talk', 0), keyframes: { zoom: [{ frame: 0, value: 1 }, { frame: 330, value: 1 }, { frame: 360, value: 1.2 }, { frame: 900, value: 1.2 }] } }
    const p = project({ clips: [zoomed] })
    expect(libraryGraphicAt(p, 'counter', 300)).toEqual({ refused: zoomPunchReason(11) })
    expect(zoomPunchReason(11)).toBe('over a zoom punch at 11.0 s')
    expect('spec' in libraryGraphicAt(p, 'counter', 450)).toBe(true) // [450, 540): held at 1.2
  })

  it('refuses over a zoom-punch moment, with its time; another moment kind does not count', () => {
    const momentClip = (id: string, kind: 'zoom-punch' | 'whip-blur'): Clip => ({
      ...shot(id, `m-${id}`, 345, 12), trackId: 'v2',
      moment: { kind, to: { clipId: 'shot' }, seconds: 0.4, intensity: 0.5, seed: 1, version: 1 },
      generatedBy: { rule: 'director.moment', reason: 'test' }
    })
    expect(libraryGraphicAt(project({ clips: [shot('shot', 'talk', 0), momentClip('z', 'zoom-punch')] }), 'counter', 300)).toEqual({ refused: zoomPunchReason(11.5) })
    expect('spec' in libraryGraphicAt(project({ clips: [shot('shot', 'talk', 0), momentClip('w', 'whip-blur')] }), 'counter', 300)).toBe(true)
  })

  it('reads no rule of taste: lands 3 s after another graphic’s end, well inside the 6 s gap', () => {
    const other = libraryGraphicSpec(entry('ring'))
    const otherEnd = 30 + Math.round(other.seconds * FPS)
    const p = project({ clips: [shot('shot', 'talk', 0), graphicClip('g1', 30, other)] })
    const got = libraryGraphicAt(p, 'counter', otherEnd + 1)
    expect('spec' in got).toBe(true)
  })

  it('names the lower third by the footage’s Speaker, or by the placeholder, and carries the last Role', () => {
    const named = libraryGraphicAt(project({ assets: [footage('talk', { speaker: '  Asha Rao ' })] }), 'lower-third', 60)
    expect('spec' in named && named.spec.data).toEqual({ template: 'lower-third', name: 'Asha Rao', role: 'Their role' })
    const unnamed = libraryGraphicAt(project(), 'lower-third', 60)
    expect('spec' in unnamed && unnamed.spec.data).toEqual({ template: 'lower-third', name: SPEAKER_PLACEHOLDER, role: 'Their role' })
    const earlier = graphicClip('lt0', 600, libraryGraphicSpec(entry('lower-third'), { role: 'Photographer' }))
    const withRole = libraryGraphicAt(project({ clips: [shot('shot', 'talk', 0), earlier] }), 'lower-third', 60)
    expect('spec' in withRole && withRole.spec.data).toMatchObject({ role: 'Photographer' })
  })

  it('gives a said quote the footage’s Speaker as its speaker, and none over no footage', () => {
    const named = libraryGraphicAt(project({ assets: [footage('talk', { speaker: 'Asha Rao' })] }), 'quote', 60)
    expect('spec' in named && named.spec.data).toMatchObject({ template: 'quote', speaker: 'Asha Rao', text: 'Your quote here' })
    const none = libraryGraphicAt(project({ clips: [] }), 'quote', 60)
    expect('spec' in none && none.spec.data).toMatchObject({ speaker: '' })
  })

  it('refuses a template the Library does not offer', () => {
    expect(libraryGraphicAt(project(), 'callout', 60)).toEqual({ refused: NOT_IN_LIBRARY_NOTE })
    expect(libraryGraphicAt(project(), 'screen-card', 60)).toEqual({ refused: NOT_IN_LIBRARY_NOTE })
  })
})

/* ------------------------------------------------- whose it is */

/** One sentence with "40" at word 2 (0.8 s), then filler to 30 s, one word every 400 ms. */
function talk(assetId: string): Transcript {
  const said = ['We signed 40 clients this year.', ...Array.from({ length: 12 }, () => 'The light was soft that day.')]
  const words: Word[] = []
  const segments: Segment[] = []
  let index = 0
  said.forEach((text, k) => {
    const start = index
    for (const w of text.split(/\s+/u)) {
      words.push({ index, text: w, startMs: index * 400, endMs: index * 400 + 350, confidence: null })
      index += 1
    }
    segments.push({ id: `s${String(k).padStart(2, '0')}`, startMs: start * 400, endMs: (index - 1) * 400 + 350, text, wordStart: start, wordEnd: index - 1 })
  })
  return { assetId, language: 'en', model: 'test', durationMs: index * 400, words, segments }
}
const COUNTER_40: KeptGraphic = {
  clipId: 'shot',
  assetId: 'talk',
  candidate: { sentence: 's00', data: { template: 'counter', value: '40', label: 'clients' }, bound: [2, 3], beatWords: [2], why: 'a number said', source: 'baseline' }
}

describe('whose it is: the owner’s, by hand', () => {
  const library = graphicClip('lib', 300, libraryGraphicSpec(entry('ring')), { generatedBy: { rule: LIBRARY_GRAPHIC_RULE, reason: 'placed from the Library' } })
  const found = graphicClip('find', 30, libraryGraphicSpec(entry('counter')), { trackId: 'v3', generatedBy: { rule: CLIPS_GRAPHIC_RULE, reason: 'r' } })
  const direct = graphicClip('direct', 600, libraryGraphicSpec(entry('keyword')), { trackId: 'v3', generatedBy: { rule: GRAPHIC_RULE, reason: 'r' } })
  const sound = (graphic: Clip): Clip => ({ ...shot(`s-${graphic.id}`, 'tick', graphic.start + 15, 3), trackId: 'a1', forGraphic: graphic.id, generatedBy: { rule: graphic.generatedBy!.rule, reason: 'r' } })
  const p = project({ clips: [shot('shot', 'talk', 0), library, found, direct, sound(library), sound(found)] })
  const ids = (q: Project): string[] => q.clips.map((c) => c.id)

  it('survives Clear graphics with its sound, while the Find graphic beside it and its sound go', () => {
    const after = clearGraphics(p)
    expect(ids(after)).toContain('lib')
    expect(ids(after)).toContain('s-lib')
    expect(ids(after)).not.toContain('find')
    expect(ids(after)).not.toContain('s-find')
  })

  it('survives Find again’s clear of its footage clip', () => {
    const after = clearClipGraphics(p, 'shot')
    expect(ids(after)).toContain('lib')
    expect(ids(after)).not.toContain('find')
  })

  it('survives Direct’s Clear, which takes Direct’s graphic', () => {
    const after = clearDirector(p)
    expect(ids(after)).toContain('lib')
    expect(ids(after)).toContain('s-lib')
    expect(ids(after)).not.toContain('direct')
  })

  it('holds its room for Find: a counter said within 6 s of it is dropped as one on the timeline already', () => {
    // The Library ring at frame 30 (1.0 s, its beat at 1.5 s); the counter's word at 0.8 s.
    const ring = graphicClip('lib', 30, libraryGraphicSpec(entry('ring')), { generatedBy: { rule: LIBRARY_GRAPHIC_RULE, reason: 'r' } })
    const q = project({ clips: [shot('shot', 'talk', 0), ring], transcripts: { talk: talk('talk') } })
    const applied = applyGraphics(q, [COUNTER_40], [], CLIPS_GRAPHIC_RULE, { fps: FPS, newId: (x) => `${x}-1` })
    expect(applied.clipIds).toEqual([])
    const onset = 1 + LEAD_S
    expect(applied.problems.map((x) => x.message).join('\n')).toContain(tooCloseReason({ template: 'ring', onset, placed: true }, 'placed'))
  })
})

describe('the Speaker typed afterwards', () => {
  it('replaces the placeholder of a lower third from the Library over footage with no Speaker', () => {
    const lower = graphicClip('lt', 60, libraryGraphicSpec(entry('lower-third')))
    const p = project({ clips: [shot('shot', 'talk', 0), lower] })
    const out = withSpeaker(p, 'talk', 'Asha Rao')
    expect(out.changed).toEqual(['lt'])
    expect(out.project.clips.find((c) => c.id === 'lt')!.graphic!.data).toMatchObject({ name: 'Asha Rao' })
  })

  it('leaves a name that is not the placeholder as it is, and a grounded lower third’s too', () => {
    const typed = graphicClip('lt', 60, { ...libraryGraphicSpec(entry('lower-third')), data: { template: 'lower-third', name: 'Typed by hand', role: '' } })
    expect(withSpeaker(project({ clips: [shot('shot', 'talk', 0), typed] }), 'talk', 'Asha Rao').changed).toEqual([])
    const grounded = graphicClip('lt', 60, { ...libraryGraphicSpec(entry('lower-third')), grounding: { assetId: 'talk', sentence: 's00', words: [0] } })
    expect(withSpeaker(project({ clips: [shot('shot', 'talk', 0), grounded] }), 'talk', 'Asha Rao').changed).toEqual([])
  })
})

describe('the tile’s drag and the drop routes', () => {
  const payload = libraryDragPayload(entry('counter'))

  it('carries the template and no file', () => {
    expect(payload).toEqual({ kind: 'graphic', file: '', name: 'Counter', template: 'counter' })
  })

  it('goes to a video track, and an audio track refuses it', () => {
    expect(acceptsKind(payload, 'video')).toBe(true)
    expect(acceptsKind(payload, 'audio')).toBe(false)
    expect(trackDropRoute(payload, 'video')).toBe('graphic')
    expect(trackDropRoute(payload, 'audio')).toBe('refuse')
  })

  it('on the picture is placed without the fill chip, which every picture still gets', () => {
    expect(canvasDropRoute(payload)).toBe('graphic')
    expect(canvasDropChip(canvasDropRoute(payload))).toBe(false)
    const of = (kind: DragPayload['kind'], extra: Partial<DragPayload> = {}): DragPayload => ({ kind, file: 'f', name: 'n', ...extra })
    expect(canvasDropRoute(of('sticker'))).toBe('asset')
    expect(canvasDropRoute(of('title'))).toBe('title')
    expect(canvasDropRoute(of('media', { assetId: 'a', mediaKind: 'image' }))).toBe('pool')
    expect(canvasDropRoute(of('sfx'))).toBe('refuse-sound')
    expect(canvasDropRoute(of('transition'))).toBe('refuse-transition')
    for (const route of ['asset', 'title', 'pool'] as const) expect(canvasDropChip(route), route).toBe(true)
    expect(trackDropRoute(of('sticker'), 'video')).toBe('asset')
    expect(trackDropRoute(of('transition'), 'video')).toBe('transition')
    expect(trackDropRoute(of('media', { assetId: 'a', mediaKind: 'image' }), 'video')).toBe('pool')
    expect(trackDropRoute(of('title'), 'video')).toBe('title')
  })

  it('is searched by name, ignoring case', () => {
    expect(searchLibraryGraphics('').map((e) => e.id)).toEqual(LIBRARY_GRAPHICS.map((e) => e.id))
    expect(searchLibraryGraphics('RING').map((e) => e.id)).toEqual(['ring'])
    expect(searchLibraryGraphics(' lower ').map((e) => e.id)).toEqual(['lower-third'])
    expect(searchLibraryGraphics('zzz')).toEqual([])
  })
})
