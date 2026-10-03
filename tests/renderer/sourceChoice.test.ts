import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyProject, type Clip, type MediaAsset } from '@shared/timeline'
import { FILMSTRIP_RULE } from '@shared/automation/filmstrip'
import { GRID_RULE } from '@shared/automation/grid'
import { ONE_PHOTO_RULE } from '@shared/automation/onePhoto'
import { REEL_RULE } from '@shared/automation/reel'
import { STRIP_RULE } from '@shared/automation/strips'
import { useEditor } from '../../src/renderer/src/store'
import {
  NO_MUSIC,
  musicLineOf,
  photoFor,
  photosOf,
  usesOf
} from '../../src/renderer/src/components/tools/SourceLine'

/**
 * Choose from media builds from the photo chosen (docs/WINDOW.md §6 Step 12).
 *
 * One photo's and Grid split's panels keep the photo chosen in their list and
 * pass it to the store: `buildOnePhotoReel(chosen)`, `buildGrid(chosen)`
 * (tools/OnePhoto.tsx, GridSplit.tsx — tests/sourceLine.test.ts pins that
 * wiring). Here, through the store with a fake bridge, the other half: the
 * action builds from the asset it is GIVEN — even when another photo is the
 * selected one, which is the default it would otherwise take. Without that,
 * the list would mark a photo and the build would quietly use a different
 * one, and every piece of the reel would say so only once it was on the
 * timeline.
 *
 * And the "Uses:" line names the photo by the SAME rule (SourceLine.tsx
 * photoFor): chosen, else selected, else first. The line is believed, so it
 * is held to the store's build, case by case — the very string the panel
 * shows (usesOf, which the panel's selector calls; tests/sourceLine.test.ts
 * pins that call), against what the build then made, for every tool with a
 * line: One photo, Grid split, Strip flashes, the card ring, Beat sync and the
 * film strip, and the song the music tools keep time to (musicLineOf).
 *
 * And a still the editor DREW — a text card, a clipping, the ring — is not a
 * photo (shared/edit/photos.ts isPhoto). It used to be: a "+ Text" made the
 * card one of the reel's shots, and the card One photo built from whenever it
 * was selected.
 */

const photo = (id: string): MediaAsset => ({
  id, path: `/p/${id}.jpg`, name: `${id}.jpg`, kind: 'image', durationFrames: 150, width: 1600, height: 1067, fps: null, hasVideo: true, hasAudio: false, size: 10
})

const SONG: MediaAsset = {
  id: 'song', path: '/m/song.wav', name: 'song.wav', kind: 'audio', durationFrames: 30 * 30, width: null, height: null, fps: 30, hasVideo: false, hasAudio: true, size: 10
}

const clip = (id: string, assetId: string, trackId: string, start: number, duration: number): Clip => ({
  id, assetId, trackId, start, duration, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  color: { brightness: 0, contrast: 1, saturation: 1 }
})

/** The harness bridge's beats (harness/bridge.ts fakeBeats): a steady 120 BPM. */
function fakeBeats(durationMs: number): Record<string, unknown> {
  const step = 500
  const beats = Array.from({ length: Math.floor(durationMs / step) }, (_, i) => i * step)
  return {
    bpm: 120,
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    tiers: beats.map((_, i) => (i % 16 >= 12 ? 3 : 2)),
    drops: [{ ms: Math.round(durationMs * 0.5), score: 0.9 }],
    buildups: [],
    sections: [0, Math.round(durationMs * 0.5)],
    durationMs,
    onsets: beats,
    windowStartMs: 0
  }
}

/** The photo every clip a rule made is cut from: one id, or the test says what it found. */
function builtFrom(rule: string): string[] {
  const made = useEditor.getState().project.clips.filter((c) => c.generatedBy?.rule === rule)
  return [...new Set(made.map((c) => c.assetId))]
}

/** The files the builds asked the beat analysis about, in order: which song they heard. */
let analysed: string[] = []

beforeEach(() => {
  analysed = []
  vi.stubGlobal('window', {
    forge: {
      analyseBeats: async (path: string, range?: { startMs?: number; endMs?: number }) => {
        analysed.push(path)
        return fakeBeats((range?.endMs ?? 30_000) - (range?.startMs ?? 0))
      }
    }
  })
  const project = {
    ...emptyProject(),
    assets: [photo('a'), photo('b'), photo('c'), SONG],
    // Photo a is on the timeline and SELECTED: the default both actions fall back to.
    clips: [clip('clip-a', 'a', 'v1', 0, 150), clip('clip-b', 'b', 'v1', 150, 150), clip('clip-song', 'song', 'a1', 0, 30 * 30)]
  }
  useEditor.setState({
    project,
    selectedClipId: 'clip-a',
    selectedClipIds: ['clip-a'],
    playhead: 0,
    past: [],
    future: [],
    reelBuilding: false,
    gridBuilding: false,
    stripsBuilding: false,
    onePhotoCaption: '',
    // No sidecar here: the subject bake answers "nothing found", which the reel handles.
    bakeParallax: async () => null,
    // Nor a canvas for three.js: the ring's spec is what is under test, not its frames.
    rebakeCarousel: async () => undefined
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('buildGrid(assetId) cuts the grid from the photo it is given', () => {
  it('uses b when b is chosen, though a is the selected photo', async () => {
    await useEditor.getState().buildGrid('b')
    expect(useEditor.getState().project.clips.filter((c) => c.generatedBy?.rule === GRID_RULE).length).toBeGreaterThan(1)
    expect(builtFrom(GRID_RULE)).toEqual(['b'])
  })

  it('uses the selected photo when nothing is chosen — so the choice above is what moved it', async () => {
    await useEditor.getState().buildGrid()
    expect(builtFrom(GRID_RULE)).toEqual(['a'])
  })
})

describe('buildOnePhotoReel(assetId) builds the reel from the photo it is given', () => {
  it('uses b when b is chosen, though a is the selected photo', async () => {
    await useEditor.getState().buildOnePhotoReel('b')
    expect(useEditor.getState().project.clips.filter((c) => c.generatedBy?.rule === ONE_PHOTO_RULE).length).toBeGreaterThan(1)
    expect(builtFrom(ONE_PHOTO_RULE)).toEqual(['b'])
  })

  it('uses the selected photo when nothing is chosen', async () => {
    await useEditor.getState().buildOnePhotoReel()
    expect(builtFrom(ONE_PHOTO_RULE)).toEqual(['a'])
  })
})

describe('the "Uses:" line names the photo the store builds from', () => {
  const cases: { name: string; chosen: string | undefined; selected: string | null; expect: string }[] = [
    { name: 'a photo chosen', chosen: 'c', selected: 'clip-a', expect: 'c' },
    { name: 'nothing chosen, a photo selected', chosen: undefined, selected: 'clip-a', expect: 'a' },
    // The selected photo is not the first one: the selection, not the pool's order, decides.
    { name: 'nothing chosen, b selected', chosen: undefined, selected: 'clip-b', expect: 'b' },
    { name: 'nothing chosen, nothing selected: the first', chosen: undefined, selected: null, expect: 'a' },
    { name: 'nothing chosen, the music selected: the first', chosen: undefined, selected: 'clip-song', expect: 'a' },
    // A choice whose photo has since left the pool: both fall back the same way.
    { name: 'a chosen photo that is gone', chosen: 'gone', selected: 'clip-a', expect: 'a' }
  ]

  /** The line's words for a photo, as the panel shows them. */
  const lineFor = (id: string, chosen: boolean): string =>
    `${id}.jpg — ${chosen ? 'chosen below' : 'the selected photo, or the first one'}`

  for (const c of cases) {
    it(`${c.name}: ${c.expect}`, async () => {
      const select = { selectedClipId: c.selected, selectedClipIds: c.selected ? [c.selected] : [] }
      useEditor.setState(select)
      const { project, selectedClipId, playhead } = useEditor.getState()
      const said = photoFor(project, c.selected, c.chosen)
      // Each panel's line, read from the store the way its selector reads it.
      const gridLine = usesOf('grid-split', project, selectedClipId, playhead, c.chosen)
      const oneLine = usesOf('one-photo', project, selectedClipId, playhead, c.chosen)

      await useEditor.getState().buildGrid(c.chosen)
      expect(builtFrom(GRID_RULE), 'the store').toEqual([c.expect])
      expect(said?.photo.id, 'the line').toBe(c.expect)
      expect(said?.chosen, 'the line says it was chosen').toBe(c.chosen === c.expect)
      expect(gridLine, 'Grid split’s line').toBe(lineFor(c.expect, c.chosen === c.expect))

      // One photo, from the same project and selection — not the grid's.
      useEditor.setState({ project, ...select })
      await useEditor.getState().buildOnePhotoReel(c.chosen)
      expect(builtFrom(ONE_PHOTO_RULE), 'the store, One photo').toEqual([c.expect])
      expect(oneLine, 'One photo’s line').toBe(lineFor(c.expect, c.chosen === c.expect))
    })
  }

  it('the first photo when the selected clip is not a photo, with b first in the pool', async () => {
    // Not vacuous about "first": reorder the pool, and the first is b.
    useEditor.setState((s) => ({
      project: { ...s.project, assets: [photo('b'), photo('a'), photo('c'), SONG] },
      selectedClipId: 'clip-song',
      selectedClipIds: ['clip-song']
    }))
    const said = photoFor(useEditor.getState().project, 'clip-song', undefined)
    const line = usesOf('grid-split', useEditor.getState().project, 'clip-song', 0, undefined)
    await useEditor.getState().buildGrid()
    expect(builtFrom(GRID_RULE)).toEqual(['b'])
    expect(said?.photo.id).toBe('b')
    expect(line).toBe(lineFor('b', false))
  })
})

/* ------------------------------------------- the lines of the stating tools */

describe('Strip flashes’ line names the shot buildStrips flashes over', () => {
  // A at 0–100, a gap to 200, then c to 500: c is the longest and NOT the first.
  const placed = (): void =>
    useEditor.setState((s) => ({
      project: {
        ...s.project,
        clips: [clip('clip-a', 'a', 'v1', 0, 100), clip('clip-c', 'c', 'v1', 200, 300), clip('clip-song', 'song', 'a1', 0, 30 * 30)]
      },
      selectedClipId: null,
      selectedClipIds: []
    }))

  const cases: { name: string; playhead: number; expect: string; says: string }[] = [
    { name: 'the playhead over a — the shorter one', playhead: 50, expect: 'a', says: 'a.jpg — the shot under the playhead' },
    { name: 'the playhead in the gap', playhead: 150, expect: 'c', says: 'c.jpg — the longest shot, as none is under the playhead' }
  ]

  for (const c of cases) {
    it(`${c.name}: ${c.expect}`, async () => {
      placed()
      useEditor.setState({ playhead: c.playhead })
      const { project, selectedClipId, playhead } = useEditor.getState()
      expect(playhead, 'the playhead where the case put it').toBe(c.playhead)
      const line = usesOf('strip-flashes', project, selectedClipId, playhead, undefined)

      await useEditor.getState().buildStrips()
      const strips = useEditor.getState().project.clips.filter((x) => x.generatedBy?.rule === STRIP_RULE)
      expect(strips.length, 'some flashes were built').toBeGreaterThan(0)
      expect(builtFrom(STRIP_RULE), 'the store').toEqual([c.expect])
      expect(line, 'the line').toBe(c.says)
    })
  }
})

describe('the card ring’s line says how many of the photos the ring takes', () => {
  const many = (n: number): MediaAsset[] => Array.from({ length: n }, (_, i) => photo(`p${String(i + 1).padStart(2, '0')}`))

  for (const [n, says] of [
    [12, (k: number) => `all ${k} photos in Upload`],
    [13, (k: number) => `the first ${k} of the 13 photos in Upload`]
  ] as const) {
    it(`${n} photos`, async () => {
      useEditor.setState((s) => ({ project: { ...s.project, assets: [...many(n), SONG], clips: [] } }))
      const { project, selectedClipId, playhead } = useEditor.getState()
      const line = usesOf('card-ring', project, selectedClipId, playhead, undefined)

      const ringId = await useEditor.getState().addCarouselClip('v2', 0)
      const ring = useEditor.getState().project.clips.find((x) => x.id === ringId)?.carousel
      expect(ring, 'a ring was made').toBeDefined()
      // The store takes the first twelve, in the pool's order…
      expect(ring!.assetIds).toEqual(many(n).slice(0, 12).map((a) => a.id))
      // …and the line counts what the store took.
      expect(line).toBe(says(ring!.assetIds.length))
    })
  }
})

describe('the music tools’ line names the song the build analyses', () => {
  it('names the song on its track, and the build hears that file', async () => {
    const { project } = useEditor.getState()
    expect(musicLineOf(project)).toBe('song.wav on A1')
    await useEditor.getState().buildGrid()
    expect(analysed).toEqual([SONG.path])
  })

  it('follows the clip to another track', () => {
    useEditor.setState((s) => ({
      project: { ...s.project, clips: s.project.clips.map((x) => (x.id === 'clip-song' ? { ...x, trackId: 'a2' } : x)) }
    }))
    expect(musicLineOf(useEditor.getState().project)).toBe('song.wav on A2')
  })

  it('says there is none when no song is on an audio track — and the build has none to hear', async () => {
    useEditor.setState((s) => ({ project: { ...s.project, clips: s.project.clips.filter((x) => x.id !== 'clip-song') } }))
    expect(musicLineOf(useEditor.getState().project)).toBe(NO_MUSIC)
    await useEditor.getState().buildOnePhotoReel()
    expect(analysed).toEqual([])
    expect(builtFrom(ONE_PHOTO_RULE)).toEqual([])
  })
})

/* ------------------------------------------------- a drawn still is no photo */

describe('a still the editor drew is not a photo — not to the builds, and not to the lines', () => {
  /*
   * A baked text card, as addTextClip leaves one once its bake lands: an image
   * asset with a real PNG at `path`, and `size: 0` (store.ts addTextClip). It
   * is FIRST in the pool and it is the SELECTED clip, so on both of the
   * default's counts — the selection, then the first — it is what a build
   * that took every image would reach for.
   */
  const CARD: MediaAsset = {
    id: 'card', path: '/cache/text-card.png', name: 'YOUR TEXT', kind: 'image', durationFrames: 300, width: 1080, height: 1920, fps: null, hasVideo: true, hasAudio: false, size: 0
  }

  beforeEach(() => {
    useEditor.setState((s) => ({
      project: {
        ...s.project,
        assets: [CARD, ...s.project.assets],
        clips: [...s.project.clips, clip('clip-card', 'card', 'v2', 0, 90)]
      },
      selectedClipId: 'clip-card',
      selectedClipIds: ['clip-card']
    }))
  })

  it('One photo and Grid split build from the first PHOTO, and their lines say so', async () => {
    const { project, selectedClipId, playhead } = useEditor.getState()
    const lines = (['grid-split', 'one-photo'] as const).map((tool) => usesOf(tool, project, selectedClipId, playhead, undefined))
    await useEditor.getState().buildGrid()
    expect(builtFrom(GRID_RULE)).toEqual(['a'])
    useEditor.setState({ project, selectedClipId: 'clip-card', selectedClipIds: ['clip-card'] })
    await useEditor.getState().buildOnePhotoReel()
    expect(builtFrom(ONE_PHOTO_RULE)).toEqual(['a'])
    expect(lines).toEqual(['a.jpg — the selected photo, or the first one', 'a.jpg — the selected photo, or the first one'])
    // And Choose from media lists the photos alone.
    expect(photosOf(project).map((a) => a.id)).toEqual(['a', 'b', 'c'])
  })

  it('Beat sync’s reel cuts in every photo and not the card, and its line counts the same three', async () => {
    const { project, selectedClipId, playhead } = useEditor.getState()
    const line = usesOf('beat-sync', project, selectedClipId, playhead, undefined)
    await useEditor.getState().buildReel()
    const used = builtFrom(REEL_RULE).sort()
    expect(used).toEqual(['a', 'b', 'c'])
    expect(line).toBe(`all ${used.length} photos in Upload`)
  })

  it('the film strip lays every photo and not the card, and its line counts the same three', () => {
    const { project, selectedClipId, playhead } = useEditor.getState()
    const line = usesOf('film-strip', project, selectedClipId, playhead, undefined)
    useEditor.getState().buildFilmstrip()
    const used = builtFrom(FILMSTRIP_RULE).sort()
    expect(used).toEqual(['a', 'b', 'c'])
    expect(line).toBe(`all ${used.length} photos in Upload`)
  })

  it('the card ring is made of the photos, though the card has a file too', async () => {
    const { project, selectedClipId, playhead } = useEditor.getState()
    const line = usesOf('card-ring', project, selectedClipId, playhead, undefined)
    const ringId = await useEditor.getState().addCarouselClip('v2', 200)
    const ring = useEditor.getState().project.clips.find((x) => x.id === ringId)?.carousel
    expect(ring?.assetIds).toEqual(['a', 'b', 'c'])
    expect(line).toBe('all 3 photos in Upload')
  })
})
