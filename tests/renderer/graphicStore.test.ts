import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { basename } from 'node:path'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import type { GraphicSpec } from '@shared/graphics/template'
import type { GraphicTargets } from '@shared/graphics/items'
import { drawnGraphicAsset, graphicExitKeys } from '@shared/graphics/frame'
import { graphicTargetsAt } from '@shared/graphics/targets'
import { copySelection } from '@shared/edit/recipes'
import { GRAPHIC_TRIM_REBAKE_MS, useEditor } from '../../src/renderer/src/store'
import { useCatalog } from '../../src/renderer/src/catalog'
import { CLIPS_GRAPHIC_RULE, placeAgain } from '@shared/graphics/apply'
import { NO_SOUND_LIBRARY_NOTE } from '@shared/graphics/sound'
import { SCREEN_CARD_REASONS, screenCardKeys, screenCardRefusal } from '@shared/graphics/screenCard'

/*
 * The store's graphic actions (docs/CLIPS.md §6.3, "The store"; §6.4's three
 * arms), phase 1's cases of tests/renderer/graphicStore.test.ts. The bake is
 * canvas code (graphicCanvas.ts, tests/renderer/graphicCanvas.test.ts); here
 * it is a recorder answering a pattern, because what is under test is what
 * the store ASKS and what it writes back, and through which door: a bake is
 * a file, not an edit, so it lands history-less. Here, as
 * graphicStyleStore.test.ts is, because the store is renderer code.
 */

const bake = vi.hoisted(() => ({
  asks: [] as { clipId: string; width: number; height: number; frames: number; fps: number; boxAllowed: boolean; styleId: string; accent: string; subject: GraphicTargets['subject'] }[],
  /** The next answer; null is a superseded or empty bake. */
  answer: null as { pattern: string; frames: number } | null,
  forgotten: [] as string[],
  pulls: [] as { path: string; first: number; count: number }[]
}))

vi.mock('../../src/renderer/src/graphicCanvas', () => ({
  bakeGraphicSequence: async (
    _spec: GraphicSpec,
    style: { id: string; palette: { accent: string } },
    clipId: string,
    width: number,
    height: number,
    frames: number,
    fps: number,
    targetsAt: (frame: number) => GraphicTargets,
    boxAllowed: boolean
  ) => {
    bake.asks.push({ clipId, width, height, frames, fps, boxAllowed, styleId: style.id, accent: style.palette.accent, subject: targetsAt(0).subject })
    return bake.answer ? { pattern: bake.answer.pattern.replace('<clip>', clipId), frames: bake.answer.frames } : null
  },
  forgetGraphicPreview: (clipId: string) => bake.forgotten.push(clipId),
  graphicPreviewCanvas: () => null,
  // A screen card's pull (§6.16): recorded, and the targets handed back as they came (the files are graphicCanvas.test's).
  screenTargetsAt: async (footage: { path: string; first: number; count: number }, targetsAt: (frame: number) => GraphicTargets) => {
    bake.pulls.push({ path: footage.path, first: footage.first, count: footage.count })
    return targetsAt
  }
}))

const FPS = 30
const spec = (over: Partial<GraphicSpec> = {}): GraphicSpec => ({
  data: { template: 'counter', value: '40', label: 'forty' },
  seconds: 3,
  beats: [0.5, 1.0],
  place: { auto: true, third: 'bottom' },
  seed: 7,
  version: 1,
  ...over
})
const footage: MediaAsset = { id: 'talk', path: '/media/talk.mp4', name: 'talk', kind: 'video', durationFrames: 600, width: 1080, height: 1920, fps: FPS, hasVideo: true, hasAudio: true, size: 1 }
const shot: Clip = {
  id: 'shot', assetId: 'talk', trackId: 'v1', start: 0, duration: 600, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 }
}

/** The project's one style with an override only the project carries: what tells the project's style from the `clean` default. */
const GRAPHICS = { styleId: 'clean', overrides: { 'palette.accent': '#2563EB' }, sound: true }

function start(over: Partial<Project> = {}): void {
  const base = emptyProject('graphics')
  useEditor.setState({
    ...useEditor.getInitialState(),
    project: { ...base, settings: { ...base.settings, width: 1080, height: 1920, fps: FPS }, graphics: GRAPHICS, assets: [footage], clips: [shot], ...over },
    playhead: 0,
    past: [],
    future: [],
    notices: []
  })
}

const state = () => useEditor.getState()
const project = (): Project => state().project
const clipOf = (id: string): Clip => project().clips.find((c) => c.id === id)!
const assetOf = (clip: Clip): MediaAsset => project().assets.find((a) => a.id === clip.assetId)!
const history = (): number => state().past.length
const notices = (): string[] => state().notices.map((n) => n.text)
/** Let a background bake land: a tick, under the fake clock when the trims' cases run one. */
const settle = (): Promise<void> => (vi.isFakeTimers() ? vi.advanceTimersByTimeAsync(0).then(() => undefined) : new Promise((resolve) => setTimeout(resolve, 0)))
/** Let a trim's edge rest: the store's one bake fires `GRAPHIC_TRIM_REBAKE_MS` after the last trim. */
const rested = (): Promise<void> => vi.advanceTimersByTimeAsync(GRAPHIC_TRIM_REBAKE_MS).then(() => undefined)

/** Add a graphic at frame 30 on V1 (it climbs to V2 over the shot) and let its bake land. */
async function added(over: Partial<GraphicSpec> = {}): Promise<string> {
  const id = await state().addGraphicClip('v1', 30, spec(over))
  expect(id).not.toBeNull()
  await settle()
  return id!
}

beforeEach(() => {
  bake.asks = []
  bake.answer = { pattern: '/cache/<clip>.seq/%05d.png', frames: 46 }
  bake.forgotten = []
  bake.pulls = []
  start()
})

describe('addGraphicClip', () => {
  it('refuses an audio or a locked track, with the note, and makes nothing', async () => {
    expect(await state().addGraphicClip('a1', 0, spec())).toBeNull()
    expect(notices()).toEqual(['A graphic goes on a video track'])
    start({ tracks: project().tracks.map((t) => (t.id === 'v1' ? { ...t, locked: true } : t)) })
    expect(await state().addGraphicClip('v1', 0, spec())).toBeNull()
    expect(notices()).toEqual(['A graphic goes on a video track'])
    expect(project().clips).toHaveLength(1)
    expect(bake.asks).toEqual([])
  })

  it('refuses a length that is not a positive number (a cleared field reads NaN), with the note, and makes nothing', async () => {
    for (const seconds of [NaN, 0, -1, Infinity]) {
      expect(await state().addGraphicClip('v1', 0, spec({ seconds })), String(seconds)).toBeNull()
    }
    expect(notices()).toEqual(Array(4).fill('A graphic needs a length in seconds'))
    expect(project().clips).toHaveLength(1)
    expect(project().assets).toHaveLength(1)
    expect(bake.asks).toEqual([])
    expect(history()).toBe(0)
  })

  it('mints graphic-<base36>-<5 base36>, a legal Windows basename, never a string from the spec', async () => {
    const id = await added({ data: { template: 'counter', value: 'Bride 5:30pm', label: 'CON' } })
    expect(id).toMatch(/^graphic-[0-9a-z]+-[0-9a-z]{5}$/)
    // The id becomes a frame-cache folder name (main/titles.ts): illegal characters, trailing dots and spaces, reserved names.
    expect(basename(id)).not.toMatch(/[<>:"|?*]/)
    expect(basename(id)).not.toMatch(/[. ]$/)
    expect(id).not.toContain('Bride')
    expect(id).not.toContain('CON')
    const twice = await added()
    expect(twice).not.toBe(id)
  })

  it('adds the drawn asset and the clip over the shot in one undo step, the exit keys on its last 0.3 s, then bakes in the background through fillAssetPath', async () => {
    const id = await added()
    const clip = clipOf(id)
    // 3 s at 30 fps; stacked over the shot on the next video track, at the frame asked.
    expect(clip).toMatchObject({ start: 30, duration: 90, inPoint: 0, trackId: 'v2', graphic: spec() })
    expect(clip.transform).toEqual({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 })
    expect(clip.keyframes).toEqual(graphicExitKeys(90, FPS))
    expect(clip.keyframes?.opacity?.map((k) => k.frame)).toEqual([81, 89])
    // The asset is `drawnGraphicAsset`'s exactly, long enough for a trim to lengthen the clip.
    const asset = assetOf(clip)
    expect(asset).toMatchObject({ ...drawnGraphicAsset(id, 1080, 1920, 300, 'counter — graphic'), path: '/cache/' + id + '.seq/00000.png' })
    expect(asset).toMatchObject({ kind: 'image', size: 0, fps: null, hasAudio: false, name: 'counter — graphic' })
    expect(asset.frames).toEqual({ pattern: `/cache/${id}.seq/%05d.png`, count: 46 })
    // One undo entry for the add; the bake landing added none.
    expect(history()).toBe(1)
    // The project's style with its override, as `graphicStyleOf` resolves it: not the `clean` default, which phase 1's one preset would not tell apart.
    expect(bake.asks).toEqual([{ clipId: id, width: 1080, height: 1920, frames: 90, fps: FPS, boxAllowed: false, styleId: 'clean', accent: '#2563EB', subject: null }])
    expect(state().selectedClipId).toBe(id)
    // The undo takes the clip and its asset off together.
    state().undo()
    expect(project().clips.map((c) => c.id)).toEqual(['shot'])
    expect(project().assets.map((a) => a.id)).toEqual(['talk'])
  })

  it('the clip before its bake lands has an empty path and no frames, and still draws: the asset is drawnGraphicAsset’s', async () => {
    bake.answer = null
    const id = await added()
    const asset = assetOf(clipOf(id))
    expect(asset).toEqual(drawnGraphicAsset(id, 1080, 1920, 300, 'counter — graphic'))
    expect(asset.path).toBe('')
    expect(asset.frames).toBeUndefined()
  })
})

describe('rebakeGraphic', () => {
  it('bakes the canvas region at the project’s size, the targets on the project as it is with the subject at the clip’s first frame, and lands history-less', async () => {
    const id = await added({ subject: { clipId: 'shot', box: { x: 0.1, y: 0.2, width: 0.2, height: 0.3 }, ms: 1000 } })
    expect(bake.asks[0]).toMatchObject({ width: 1080, height: 1920, boxAllowed: false, subject: { x: 108, y: 384, width: 216, height: 576 } })
    bake.asks = []
    bake.answer = { pattern: '/cache/<clip>.seq/%05d.png', frames: 40 }
    const before = history()
    await state().rebakeGraphic(id)
    expect(bake.asks).toHaveLength(1)
    expect(assetOf(clipOf(id)).frames).toEqual({ pattern: `/cache/${id}.seq/%05d.png`, count: 40 })
    expect(history()).toBe(before)
    expect(state().dirty).toBe(true)
  })

  it('a superseded or empty bake (null) leaves the asset as it was; a clip that is not a graphic bakes nothing', async () => {
    const id = await added()
    const was = assetOf(clipOf(id))
    bake.answer = null
    bake.asks = []
    await state().rebakeGraphic(id)
    expect(assetOf(clipOf(id))).toEqual(was)
    await state().rebakeGraphic('shot')
    expect(bake.asks.map((a) => a.clipId)).toEqual([id])
  })

  it('redraws at the new canvas after an aspect change, through rebakeGenerated’s arm, at the project’s new size with the targets at that size', async () => {
    const id = await added({ subject: { clipId: 'shot', box: { x: 0.1, y: 0.2, width: 0.2, height: 0.3 }, ms: 1000 } })
    const portrait = bake.asks[0].subject
    expect(portrait).toMatchObject({ x: 108, y: 384, width: 216, height: 576 })
    bake.asks = []
    useEditor.setState((s) => ({ project: { ...s.project, settings: { ...s.project.settings, width: 1920, height: 1080 } } }))
    await state().rebakeGenerated()
    expect(bake.asks).toEqual([expect.objectContaining({ clipId: id, width: 1920, height: 1080, boxAllowed: false, accent: '#2563EB' })])
    expect(assetOf(clipOf(id))).toMatchObject({ width: 1920, height: 1080 })
    // The subject in the NEW canvas's pixels (graphics/targets.ts on the 1920×1080 project), not the portrait answer again.
    const landscape = graphicTargetsAt(project(), clipOf(id), clipOf(id).graphic!, 30, { width: 1920, height: 1080 }).subject
    expect(landscape).not.toBeNull()
    expect(bake.asks[0].subject).toEqual(landscape)
    expect(bake.asks[0].subject).not.toEqual(portrait)
  })
})

describe('setGraphic', () => {
  it('is update() then a rebake: one undo, the version bumped, the length and the exit keys kept when seconds is not changed', async () => {
    const id = await added()
    bake.asks = []
    const before = history()
    await state().setGraphic(id, { data: { template: 'counter', value: '41', label: 'forty-one' }, beats: [0.25, 0.75] })
    const clip = clipOf(id)
    expect(clip.graphic).toEqual(spec({ data: { template: 'counter', value: '41', label: 'forty-one' }, beats: [0.25, 0.75], version: 2 }))
    expect(clip.duration).toBe(90)
    expect(clip.keyframes).toEqual(graphicExitKeys(90, FPS))
    expect(history()).toBe(before + 1)
    expect(bake.asks.map((a) => a.clipId)).toEqual([id])
    state().undo()
    expect(clipOf(id).graphic?.version).toBe(1)
  })

  it('a new seconds moves the clip’s length with it and rewrites the exit keys onto its last 0.3 s', async () => {
    const id = await added()
    await state().setGraphic(id, { seconds: 2 })
    const clip = clipOf(id)
    expect(clip.graphic?.seconds).toBe(2)
    expect(clip.duration).toBe(60)
    expect(clip.keyframes).toEqual(graphicExitKeys(60, FPS))
    expect(clip.keyframes?.opacity?.map((k) => k.frame)).toEqual([51, 59])
    // Another keyframe track the user keyed stays.
    useEditor.setState((s) => ({ project: { ...s.project, clips: s.project.clips.map((c) => (c.id === id ? { ...c, keyframes: { ...c.keyframes, zoom: [{ frame: 0, value: 1 }] } } : c)) } }))
    await state().setGraphic(id, { seconds: 1 })
    expect(clipOf(id).keyframes).toEqual({ zoom: [{ frame: 0, value: 1 }], ...graphicExitKeys(30, FPS) })
  })

  it('a seconds that is not a positive number (a cleared field reads NaN) is no length: alone it is no edit, beside other fields they still land', async () => {
    const id = await added()
    bake.asks = []
    const before = history()
    for (const seconds of [NaN, 0, -2, Infinity]) await state().setGraphic(id, { seconds })
    expect(clipOf(id)).toMatchObject({ duration: 90, graphic: spec() })
    expect(history()).toBe(before)
    expect(bake.asks).toEqual([])
    await state().setGraphic(id, { seconds: NaN, beats: [0.1] })
    expect(clipOf(id)).toMatchObject({ duration: 90, graphic: spec({ beats: [0.1], version: 2 }) })
    expect(clipOf(id).keyframes).toEqual(graphicExitKeys(90, FPS))
    expect(history()).toBe(before + 1)
    expect(bake.asks.map((a) => a.clipId)).toEqual([id])
  })
})

describe('trims and splits', () => {
  // The trims' rebake waits for the edge to rest, on a clock the cases advance.
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('a tail trim keeps spec.seconds equal to the clip’s length and the exit keys on its last 0.3 s, bumps the version, and rebakes once the edge rests', async () => {
    const id = await added()
    bake.asks = []
    state().trimClipEnd(id, 90)
    const clip = clipOf(id)
    expect(clip).toMatchObject({ start: 30, duration: 60, inPoint: 0 })
    expect(clip.graphic).toEqual(spec({ seconds: 2, version: 2 }))
    expect(clip.keyframes).toEqual(graphicExitKeys(60, FPS))
    // Not yet: the bake fires GRAPHIC_TRIM_REBAKE_MS after the last trim.
    await settle()
    expect(bake.asks).toEqual([])
    await rested()
    expect(bake.asks.map((a) => a.clipId)).toEqual([id])
    expect(bake.asks[0].frames).toBe(60)
    // A tail trim can lengthen the clip up to the asset's ten seconds.
    state().trimClipEnd(id, 30 + 300)
    expect(clipOf(id)).toMatchObject({ duration: 300, graphic: expect.objectContaining({ seconds: 10 }) })
  })

  it('a drag’s many trims cost one bake, GRAPHIC_TRIM_REBAKE_MS after the last of them, at the last length; each move still rewrites the spec and the keys', async () => {
    const id = await added()
    bake.asks = []
    const before = history()
    for (const end of [110, 100, 95, 92, 88]) state().trimClipEnd(id, end)
    // Every move was an edit the live preview follows.
    expect(clipOf(id)).toMatchObject({ duration: 58, graphic: expect.objectContaining({ seconds: 58 / FPS, version: 6 }) })
    expect(clipOf(id).keyframes).toEqual(graphicExitKeys(58, FPS))
    expect(history()).toBe(before + 5)
    await vi.advanceTimersByTimeAsync(GRAPHIC_TRIM_REBAKE_MS - 1)
    expect(bake.asks).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(bake.asks.map((a) => a.clipId)).toEqual([id])
    expect(bake.asks[0].frames).toBe(58)
    // A head trim resets the wait: one bake for the pair, at the length the pair left.
    bake.asks = []
    state().trimClipStart(id, 40)
    await vi.advanceTimersByTimeAsync(GRAPHIC_TRIM_REBAKE_MS - 1)
    state().trimClipEnd(id, 80)
    await vi.advanceTimersByTimeAsync(GRAPHIC_TRIM_REBAKE_MS - 1)
    expect(bake.asks).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(bake.asks.map((a) => a.frames)).toEqual([40])
  })

  it('an edge that did not move is no edit: no history entry, no version, no bake', async () => {
    const id = await added()
    bake.asks = []
    const before = history()
    state().trimClipEnd(id, 120)
    state().trimClipStart(id, 30)
    expect(clipOf(id)).toMatchObject({ start: 30, duration: 90, graphic: expect.objectContaining({ version: 1 }) })
    expect(history()).toBe(before)
    await rested()
    expect(bake.asks).toEqual([])
    // Beyond the asset's room the end clamps to where it was, which is also no move: one edit and one bake for the pair.
    state().trimClipEnd(id, 30 + 300)
    state().trimClipEnd(id, 30 + 400)
    expect(clipOf(id)).toMatchObject({ start: 30, duration: 300, graphic: expect.objectContaining({ version: 2 }) })
    expect(history()).toBe(before + 1)
    await rested()
    expect(bake.asks).toHaveLength(1)
    // And the same for footage: a no-op trim pushes nothing to undo.
    const was = history()
    state().trimClipEnd('shot', 600)
    state().trimClipStart('shot', 0)
    expect(history()).toBe(was)
    expect(clipOf('shot')).toBe(project().clips.find((c) => c.id === 'shot'))
  })

  it('a head trim takes the trimmed seconds off every beat, a beat before 0 becoming 0, and leaves inPoint at 0', async () => {
    const id = await added({ beats: [0.25, 1.0] })
    bake.asks = []
    state().trimClipStart(id, 45)
    await rested()
    const clip = clipOf(id)
    // `trimStart` alone would put the in-point at 15; a graphic's frames start at its own first frame.
    expect(clip).toMatchObject({ start: 45, duration: 75, inPoint: 0 })
    // 0.5 s off each: the 0.25 beat would be at -0.25 and becomes 0.
    expect(clip.graphic).toEqual(spec({ seconds: 2.5, beats: [0, 0.5], version: 2 }))
    expect(clip.keyframes).toEqual(graphicExitKeys(75, FPS))
    expect(clip.keyframes?.opacity?.map((k) => k.frame)).toEqual([66, 74])
    expect(bake.asks.map((a) => a.clipId)).toEqual([id])
  })

  it('a head trim leaves a user’s other keyframe tracks where rebaseAnimation puts them, on the picture, while the exit keys are rewritten', async () => {
    const id = await added()
    useEditor.setState((s) => ({ project: { ...s.project, clips: s.project.clips.map((c) => (c.id === id ? { ...c, keyframes: { ...c.keyframes, zoom: [{ frame: 0, value: 1 }, { frame: 60, value: 1.2 }] } } : c)) } }))
    state().trimClipStart(id, 45)
    // The beats shift by the cut, so the picture at the new frame 0 is the old frame 15's: a zoom key shifts with it, as every clip's does.
    expect(clipOf(id).keyframes).toEqual({ zoom: [{ frame: -15, value: 1 }, { frame: 45, value: 1.2 }], ...graphicExitKeys(75, FPS) })
  })

  it('a trim of a footage clip is as it was: no spec, no keys written, no bake', async () => {
    bake.asks = []
    state().trimClipEnd('shot', 300)
    state().trimClipStart('shot', 10)
    await rested()
    expect(clipOf('shot')).toMatchObject({ start: 10, duration: 290, inPoint: 10 })
    expect(clipOf('shot').keyframes).toBeUndefined()
    expect(bake.asks).toEqual([])
  })

  it('a split leaves a graphic whole, with its note; a footage clip under the same playhead still splits', async () => {
    const id = await added()
    const before = history()
    useEditor.setState({ playhead: 60, selectedClipId: id, selectedClipIds: [id] })
    state().splitAtPlayhead()
    expect(project().clips.filter((c) => c.graphic)).toHaveLength(1)
    expect(clipOf(id)).toMatchObject({ start: 30, duration: 90 })
    expect(notices()).toEqual(['A graphic is trimmed, not split'])
    expect(history()).toBe(before)
    // With nothing selected, both are under the playhead: the shot splits, the graphic stays whole and is said again.
    useEditor.setState({ selectedClipId: null, selectedClipIds: [], notices: [] })
    state().splitAtPlayhead()
    expect(project().clips.filter((c) => c.assetId === 'talk')).toHaveLength(2)
    expect(project().clips.filter((c) => c.graphic)).toHaveLength(1)
    expect(clipOf(id)).toMatchObject({ start: 30, duration: 90 })
    expect(notices()).toEqual(['A graphic is trimmed, not split'])
  })
})

describe('the arms', () => {
  it('a pasted graphic gets an asset of its own and is rebaked there by placeCopies', async () => {
    const id = await added()
    bake.asks = []
    const board = copySelection(project(), [id])!
    await state().placeCopies(board, 200)
    const copy = project().clips.find((c) => c.graphic && c.id !== id)!
    expect(copy).toBeDefined()
    expect(copy.assetId).not.toBe(clipOf(id).assetId)
    expect(bake.asks.map((a) => a.clipId)).toEqual([copy.id])
    expect(assetOf(copy).frames).toEqual({ pattern: `/cache/${copy.id}.seq/%05d.png`, count: 46 })
    // The source's frames are its own still.
    expect(assetOf(clipOf(id)).frames).toEqual({ pattern: `/cache/${id}.seq/%05d.png`, count: 46 })
  })

  it('rebakeFollowed redraws a graphic whose onset target sits on a re-followed clip: spec.subject’s, or the caption track’s clip under it, and no other', async () => {
    // A second shot with a path of its own, on v2 past the graphics, so `rebakeFollowed(['broll'])` reaches the arm.
    const broll: MediaAsset = { ...footage, id: 'broll', path: '/media/broll.mp4', name: 'broll' }
    start({ assets: [footage, broll], clips: [shot, { ...shot, id: 'b', assetId: 'broll', trackId: 'v2', start: 300, duration: 300 }] })
    // In the third §6.9 would choose over the talk shot (a counter, no captions, no track: the middle), so the
    // reframe's place.auto recompute (lane T2b) moves none of them and only the onset target decides the redraw.
    const middle = { auto: true as const, third: 'middle' as const }
    const named = await added({ place: middle, subject: { clipId: 'b', box: { x: 0.1, y: 0.2, width: 0.2, height: 0.3 }, ms: 1000 } })
    const under = await added({ place: middle })
    // §6.9's "not taken" (subject: null): no target, so nothing beneath to re-follow, the caption track's clip not read.
    const none = await added({ place: middle, subject: null })
    expect(bake.asks.find((a) => a.clipId === none)!.subject).toBeNull()
    expect(clipOf(named).trackId).toBe('v2')
    bake.asks = []
    await state().rebakeFollowed(['other'])
    expect(bake.asks).toEqual([])
    // The named subject's clip is on broll; the caption track's clip under frame 30 is the talk shot.
    await state().rebakeFollowed(['broll'])
    expect(bake.asks.map((a) => a.clipId)).toEqual([named])
    bake.asks = []
    await state().rebakeFollowed(['talk'])
    expect(bake.asks.map((a) => a.clipId)).toEqual([under])
  })

  it('removing a graphic reaches forgetGraphicPreview in the preview’s sweep', () => {
    const preview = readFileSync(resolve(__dirname, '../../src/renderer/src/components/Preview.tsx'), 'utf8')
    const sweeps = [...preview.matchAll(/forgetMomentPreview\(clipId\)\s*\n[^\n]*\n\s*forgetGraphicPreview\(clipId\)/g)]
    expect(sweeps).toHaveLength(1)
  })
})

/*
 * Phase 2's cases (docs/CLIPS.md §6.14, "A graphic's sounds follow it" and
 * "Off per project"): each edit takes or shifts a graphic's sounds in its
 * own update, so one undo puts all of it back. The fixture is written by
 * hand, so no frame below comes from the code under test: over the talk shot,
 * a Clip-it counter g1 on V2 at 60 (its beat 0.6 s: 60 + ceil(18) = 78) with
 * its tick s1 on frame 78, and g2 at 300 with its tick s2 on 318, both on the
 * one tick file the rule brought; and a sound of yours on frame 78, on your
 * own file, that follows nothing.
 */
describe('phase 2: a graphic’s sounds follow it (§6.14)', () => {
  const rule = { rule: CLIPS_GRAPHIC_RULE, reason: 'r' }
  const drawn = (id: string): MediaAsset => ({ id: `drawn-${id}`, path: '', name: 'counter — graphic', kind: 'image', durationFrames: 300, size: 0, width: 1080, height: 1920, fps: null, hasVideo: true, hasAudio: false })
  const tickFile: MediaAsset = { id: 'tick-file', path: '/lib/sfx/clock_tick.wav', name: 'clock_tick.wav', kind: 'audio', durationFrames: 2, width: null, height: null, fps: null, hasVideo: false, hasAudio: true, size: 1, broughtBy: CLIPS_GRAPHIC_RULE }
  const mineFile: MediaAsset = { id: 'mine', path: '/media/mine.wav', name: 'mine.wav', kind: 'audio', durationFrames: 30, width: null, height: null, fps: null, hasVideo: false, hasAudio: true, size: 4000 }
  const g = (id: string, at: number): Clip => ({ ...shot, id, assetId: `drawn-${id}`, trackId: 'v2', start: at, duration: 90, graphic: spec({ beats: [0.6] }), generatedBy: rule })
  const tick = (id: string, graphicId: string, at: number): Clip => ({ ...shot, id, assetId: 'tick-file', trackId: 'a1', start: at, duration: 2, forGraphic: graphicId, generatedBy: rule })
  const mine: Clip = { ...shot, id: 'mine-clip', assetId: 'mine', trackId: 'a2', start: 78, duration: 30 }

  function fixture(clips: Clip[] = [g('g1', 60), tick('s1', 'g1', 78), g('g2', 300), tick('s2', 'g2', 318), mine]): Project {
    start({ assets: [footage, drawn('g1'), drawn('g2'), tickFile, mineFile], clips: [shot, ...clips] })
    return project()
  }
  const ids = (): string[] => project().clips.map((c) => c.id)
  const at = (id: string): Clip | undefined => project().clips.find((c) => c.id === id)
  /** One undo: the project exactly as before the edit, and the history one shorter. */
  function undoesTo(before: Project, past: number): void {
    expect(history()).toBe(past + 1)
    state().undo()
    expect(project()).toEqual(before)
    expect(history()).toBe(past)
  }

  afterEach(() => useCatalog.setState(useCatalog.getInitialState()))

  it('removeClip on a graphic takes its forGraphic sounds and nothing else; one undo restores it', () => {
    const before = fixture()
    state().removeClip('g1')
    expect(ids()).toEqual(['shot', 'g2', 's2', 'mine-clip'])
    // s2 still stands on the tick file, so it stays; the drawn asset stays, as removeClip leaves a clip's asset.
    expect(project().assets.map((a) => a.id)).toEqual(['talk', 'drawn-g1', 'drawn-g2', 'tick-file', 'mine'])
    undoesTo(before, 0)
  })

  it('removeClip on the last graphic on a brought file takes the file too', () => {
    const before = fixture([g('g1', 60), tick('s1', 'g1', 78), mine])
    state().removeClip('g1')
    expect(ids()).toEqual(['shot', 'mine-clip'])
    expect(project().assets.map((a) => a.id)).toEqual(['talk', 'drawn-g1', 'drawn-g2', 'mine'])
    undoesTo(before, 0)
  })

  it('moveClip shifts its sounds by the graphic’s own shift; others stay', () => {
    const before = fixture()
    state().moveClip('g1', 120)
    expect(at('g1')!.start).toBe(120)
    // 78 + (120 − 60), by hand.
    expect(at('s1')!.start).toBe(138)
    expect(at('s2')!.start).toBe(318)
    expect(at('mine-clip')!.start).toBe(78)
    undoesTo(before, 0)
  })

  it('moveSelectionTo shifts the sounds not in the move by the graphic’s own shift, and a sound in the move only once', () => {
    const before = fixture()
    state().moveSelectionTo(new Map([['g1', 60]]), 40)
    expect(at('g1')!.start).toBe(100)
    expect(at('s1')!.start).toBe(118)
    expect(at('mine-clip')!.start).toBe(78)
    undoesTo(before, 0)
    // The sound selected with it: from its origin, 78 + 40, not shifted again.
    state().moveSelectionTo(new Map([['g1', 60], ['s1', 78]]), 40)
    expect(at('s1')!.start).toBe(118)
    undoesTo(before, 0)
  })

  it('beyond the plan words: Delete and the arrow nudge carry the sounds too', () => {
    const before = fixture()
    state().selectMany(['g1'])
    state().nudgeSelection(10)
    expect(at('s1')!.start).toBe(88)
    undoesTo(before, 0)
    state().selectMany(['g1'])
    state().deleteSelection()
    expect(ids()).toEqual(['shot', 'g2', 's2', 'mine-clip'])
    undoesTo(before, 0)
    state().selectMany(['g1'])
    state().cutSelection()
    expect(ids()).toEqual(['shot', 'g2', 's2', 'mine-clip'])
    undoesTo(before, 0)
  })

  it('a graphic deleted together with its own sound (a marquee) takes the file the sound brought', () => {
    const before = fixture([g('g1', 60), tick('s1', 'g1', 78), mine])
    state().selectMany(['g1', 's1'])
    state().deleteSelection()
    expect(ids()).toEqual(['shot', 'mine-clip'])
    expect(project().assets.map((a) => a.id)).not.toContain('tick-file')
    expect(project().assets.map((a) => a.id)).toContain('mine')
    undoesTo(before, 0)
  })

  it('setGraphic with no library installed takes the graphic’s sound off its old beat; the other graphic’s stays', async () => {
    const before = fixture()
    await state().setGraphic('g1', { beats: [1.0] })
    expect(project().clips.filter((c) => c.forGraphic === 'g1')).toEqual([])
    expect(at('s2')!.start).toBe(318)
    // s2 still stands on the tick file.
    expect(project().assets.map((a) => a.id)).toContain('tick-file')
    undoesTo(before, 0)
  })

  it('a pasted copy of a graphic’s sound has no forGraphic, so removing the graphic leaves it', async () => {
    fixture()
    await state().placeCopies(copySelection(project(), ['s1'])!, 1000)
    const copy = project().clips.find((c) => c.start === 1000)!
    expect(copy.assetId).toBe('tick-file')
    expect(copy.forGraphic).toBeUndefined()
    state().removeClip('g1')
    expect(at(copy.id)).toEqual(copy)
    expect(project().assets.map((a) => a.id)).toContain('tick-file')
  })

  it('setGraphicSounds(false) takes every graphic sound and its brought file in one undo; (true) places them again from the library', () => {
    const before = fixture()
    state().setGraphicSounds(false)
    expect(ids()).toEqual(['shot', 'g1', 'g2', 'mine-clip'])
    expect(project().assets.map((a) => a.id)).toEqual(['talk', 'drawn-g1', 'drawn-g2', 'mine'])
    expect(project().graphics?.sound).toBe(false)
    undoesTo(before, 0)

    state().setGraphicSounds(false)
    const off = project()
    // With no library installed: the setting on, nothing placed, the one note.
    state().setGraphicSounds(true)
    expect(project().graphics?.sound).toBe(true)
    expect(project().clips.filter((c) => c.forGraphic !== undefined)).toEqual([])
    expect(notices()).toContain(NO_SOUND_LIBRARY_NOTE)
    undoesTo(off, 1)

    // With the library: the library's tick on each graphic's beat, by hand 78 and 318, under its rule.
    useCatalog.setState({
      catalog: { version: 3, generatedAt: '', scannedFrom: '/lib', entries: [{ id: 'clock', kind: 'sfx', name: 'clock tick', file: 'sfx/clock_tick.wav', tags: [], meta: {} }] },
      root: '/lib'
    })
    state().setGraphicSounds(true)
    const sounds = project().clips.filter((c) => c.forGraphic !== undefined).sort((a, b) => a.start - b.start)
    expect(sounds.map((c) => [c.forGraphic, c.start, c.duration, c.generatedBy?.rule])).toEqual([
      ['g1', 78, 2, CLIPS_GRAPHIC_RULE],
      ['g2', 318, 2, CLIPS_GRAPHIC_RULE]
    ])
    const file = project().assets.find((a) => a.id === sounds[0].assetId)!
    expect(file).toMatchObject({ path: '/lib/sfx/clock_tick.wav', kind: 'audio', broughtBy: CLIPS_GRAPHIC_RULE })
    undoesTo(off, 1)
  })

  it('setGraphic re-places its sounds on the new beats, in the same undo step', async () => {
    useCatalog.setState({
      catalog: { version: 3, generatedAt: '', scannedFrom: '/lib', entries: [{ id: 'clock', kind: 'sfx', name: 'clock tick', file: 'sfx/clock_tick.wav', tags: [], meta: {} }] },
      root: '/lib'
    })
    const before = fixture()
    await state().setGraphic('g1', { beats: [1.0] })
    // 60 + ceil(1.0 × 30) = 90, by hand; s1 gone, the new tick on the file already in the pool.
    const ticks = project().clips.filter((c) => c.forGraphic === 'g1')
    expect(ticks.map((c) => [c.start, c.assetId])).toEqual([[90, 'tick-file']])
    expect(at('s1')).toBeUndefined()
    // g2 is on the same shot, so its tick is re-placed with it (the cap and the index are the shot's): still on 318.
    expect(project().clips.filter((c) => c.forGraphic === 'g2').map((c) => [c.start, c.assetId])).toEqual([[318, 'tick-file']])
    undoesTo(before, 0)
  })
})

/*
 * Phase 3's piece 4 (docs/CLIPS.md §6.16, "The store" and "Refused"): the
 * dock's Screen card through the store. `addScreenCard` lands the card
 * spanning its recording and the recording's two keys in one step; Drop and
 * Delete take exactly those keys; neither Clear takes the card; a moved,
 * trimmed, retimed or re-rated recording realigns card and keys; a split
 * keeps the card with the left half; each refusal says its reason.
 */
describe('the screen card (§6.16)', () => {
  const opacity = (id: string) => clipOf(id).keyframes?.opacity
  const cardOn = (id: string): Clip | undefined => project().clips.find((c) => c.graphic?.data.template === 'screen-card' && c.graphic.data.clipId === id)

  it('addScreenCard lands the card spanning the clip exactly, no exit fade, no rule, and writes exactly screenCardKeys’ two keys, in one undo step', async () => {
    const id = await state().addScreenCard('shot', 'tilt-in')
    expect(id).not.toBeNull()
    await settle()
    const card = clipOf(id!)
    expect(card).toMatchObject({ start: 0, duration: 600 })
    expect(card.trackId).not.toBe('v1')
    expect(card.keyframes).toBeUndefined()
    expect(card.generatedBy).toBeUndefined()
    expect(card.graphic).toMatchObject({ data: { template: 'screen-card', clipId: 'shot', move: 'tilt-in' }, seconds: 20, beats: [1] })
    // Its place is held (the whole frame, never read): §6.9's recompute never looks for a third for it.
    expect(card.graphic!.place).toEqual({ auto: false, box: { x: 0, y: 0, width: 1, height: 1 } })
    expect(placeAgain(project(), id!)).toEqual({ project: project(), note: null })
    expect(opacity('shot')).toEqual(screenCardKeys(card, clipOf('shot'), FPS))
    expect(opacity('shot')).toEqual([
      { frame: 0, value: 0, ease: 'hold' },
      { frame: 31, value: 1 }
    ])
    expect(history()).toBe(1)
    // Its bake asked for the recording's moving frames, L + 1 of them from the clip's first.
    expect(bake.pulls).toEqual([{ path: '/media/talk.mp4', first: 0, count: 31 }])
    state().undo()
    expect(project().clips.map((c) => c.id)).toEqual(['shot'])
    expect(clipOf('shot').keyframes).toBeUndefined()
  })

  it('refuses, with its reason and nothing changed: steadied, turned, keyed zoom or turn, opacity keys of its own, a colour change, under a look, too short, an image clip, a card on it already', async () => {
    const R = SCREEN_CARD_REASONS
    const shotWith = (over: Partial<Clip>): Clip => ({ ...shot, ...over })
    const look: Clip = { ...shot, id: 'adj', assetId: 'card', trackId: 'v2', adjustment: true, color: { brightness: 0.2, contrast: 1, saturation: 1 } }
    const cases: [string, Partial<Project>, string][] = [
      ['steadied', { clips: [shotWith({ steady: true })] }, R.steadied],
      ['turned', { clips: [shotWith({ transform: { ...shot.transform, rotation: 90 } })] }, R.turned],
      ['keyed zoom', { clips: [shotWith({ keyframes: { zoom: [{ frame: 0, value: 1 }, { frame: 30, value: 1.2 }] } })] }, R.turned],
      ['keyed turn', { clips: [shotWith({ keyframes: { rotation: [{ frame: 0, value: 0 }] } })] }, R.turned],
      ['a motion path', { clips: [shotWith({ path: [{ frame: 0, x: 0, y: 0 }, { frame: 30, x: 0.1, y: 0 }] })] }, R.moving],
      ['a camera move', { clips: [shotWith({ motion: { kind: 'kenburns', direction: 'in', amount: 0.1 } })] }, R.moving],
      ['opacity keys', { clips: [shotWith({ keyframes: { opacity: [{ frame: 0, value: 1 }] } })] }, R.opacityKeys],
      ['a colour change', { clips: [shotWith({ color: { brightness: 0.1, contrast: 1, saturation: 1 } })] }, R.colour],
      ['a LUT', { clips: [shotWith({ color: { brightness: 0, contrast: 1, saturation: 1, lut: { file: '/l.cube', name: 'l', intensity: 1 } } })] }, R.colour],
      ['under a look', { assets: [footage, { ...footage, id: 'card', kind: 'image', path: '/c.png' }], clips: [shot, look] }, R.underLook],
      ['too short', { clips: [shotWith({ duration: 31 })] }, R.short],
      ['an image clip', { assets: [{ ...footage, kind: 'image', path: '/p.jpg' }], clips: [shot] }, R.notVideo]
    ]
    for (const [name, over, reason] of cases) {
      start(over)
      const before = project()
      expect(await state().addScreenCard('shot', 'pull-back'), name).toBeNull()
      expect(notices(), name).toEqual([reason])
      expect(project(), name).toBe(before)
      expect(history(), name).toBe(0)
      // The dock's words come from the same function.
      expect(screenCardRefusal(project(), 'shot'), name).toBe(reason)
    }
    // A look on a track BELOW the clip does not grade it: not refused.
    start({ assets: [footage, { ...footage, id: 'card', kind: 'image', path: '/c.png' }], clips: [{ ...shot, trackId: 'v2' }, { ...look, trackId: 'v1' }] })
    expect(screenCardRefusal(project(), 'shot')).toBeNull()
    // One card per recording clip.
    start()
    expect(await state().addScreenCard('shot', 'tilt-in')).not.toBeNull()
    await settle()
    state().notices.length = 0
    expect(await state().addScreenCard('shot', 'pull-back')).toBeNull()
    expect(notices()).toEqual([R.hasCard])
    expect(project().clips.filter((c) => c.graphic)).toHaveLength(1)
    expect(screenCardRefusal(project(), 'nope')).toBe(R.notVideo)
    expect(screenCardRefusal(project(), cardOn('shot')!.id)).toBe(R.notVideo)
  })

  it('Drop removes the card and exactly its two keys; a key of your own on the clip stays; Delete of the card does the same', async () => {
    for (const remove of [(id: string) => state().dropGraphic(id), (id: string) => state().removeClip(id)]) {
      start()
      const id = (await state().addScreenCard('shot', 'tilt-in'))!
      await settle()
      state().setKeyframe('shot', 'opacity', 300, 0.5)
      expect(opacity('shot')).toEqual([{ frame: 0, value: 0, ease: 'hold' }, { frame: 31, value: 1 }, { frame: 300, value: 0.5 }])
      remove(id)
      expect(project().clips.some((c) => c.id === id)).toBe(false)
      expect(opacity('shot')).toEqual([{ frame: 300, value: 0.5 }])
      // Without a key of your own, the track and the keys are gone whole.
      start()
      const again = (await state().addScreenCard('shot', 'tilt-in'))!
      await settle()
      remove(again)
      expect(clipOf('shot').keyframes).toBeUndefined()
    }
  })

  it('neither Clear graphics nor Direct’s Clear takes the card or its keys', async () => {
    const id = (await state().addScreenCard('shot', 'pull-back'))!
    await settle()
    const keys = opacity('shot')
    state().clearGraphics()
    expect(clipOf(id).graphic?.data.template).toBe('screen-card')
    expect(opacity('shot')).toEqual(keys)
    state().clearDirectorOutput()
    expect(clipOf(id).graphic?.data.template).toBe('screen-card')
    expect(opacity('shot')).toEqual(keys)
  })

  it('a moved, trimmed, retimed or re-rated recording realigns the card and its two keys, in the edit’s own step', async () => {
    vi.useFakeTimers()
    try {
      const id = (await state().addScreenCard('shot', 'tilt-in'))!
      await settle()
      const steps = history()
      const aligned = (): void => {
        const card = clipOf(id)
        const rec = clipOf('shot')
        expect([card.start, card.duration]).toEqual([rec.start, rec.duration])
        expect(card.graphic!.seconds).toBeCloseTo(rec.duration / project().settings.fps, 9)
        expect(card.keyframes).toBeUndefined()
        expect(opacity('shot')).toEqual(screenCardKeys(card, rec, project().settings.fps))
      }
      state().moveClip('shot', 120)
      expect(clipOf('shot').start).toBe(120)
      aligned()
      expect(history()).toBe(steps + 1)
      state().trimClipStart('shot', 180)
      expect(clipOf('shot').start).toBe(180)
      aligned()
      // The head trim rebased every key of the clip by −60; the card's are rewritten on its own first frame.
      expect(opacity('shot')).toEqual([{ frame: 0, value: 0, ease: 'hold' }, { frame: 31, value: 1 }])
      state().trimClipEnd('shot', 500)
      expect(clipOf('shot').duration).toBe(320)
      aligned()
      state().setClipSpeed('shot', 2)
      aligned()
      expect(history()).toBe(steps + 4)
      const versions = clipOf(id).graphic!.version
      // The realigned card is drawn again once the edit rests.
      bake.asks = []
      await rested()
      expect(bake.asks.map((a) => a.clipId)).toContain(id)
      state().setFrameRate(25)
      aligned()
      expect(opacity('shot')).toEqual([{ frame: 0, value: 0, ease: 'hold' }, { frame: 26, value: 1 }])
      expect(clipOf(id).graphic!.version).toBeGreaterThan(versions)
      // An undo puts card and keys back together.
      state().undo()
      aligned()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a realigned card stays alone on a lane above its recording: one that would land over another clip on its track, or under its recording, climbs to a free lane (a new one at the top if need be) (the critics’ fix)', async () => {
    const other: Clip = { ...shot, id: 'other', assetId: 'still', trackId: 'v2', start: 700, duration: 90 }
    start({ assets: [footage, { ...footage, id: 'still', kind: 'image', path: '/s.png' }], clips: [shot, other] })
    const id = (await state().addScreenCard('shot', 'tilt-in'))!
    await settle()
    expect(clipOf(id).trackId).toBe('v2')
    const order = (trackId: string): number => project().tracks.findIndex((t) => t.id === trackId)
    const alone = (): void => {
      const card = clipOf(id)
      const rec = clipOf('shot')
      expect([card.start, card.duration]).toEqual([rec.start, rec.duration])
      expect(project().tracks.find((t) => t.id === card.trackId)?.kind).toBe('video')
      expect(order(card.trackId)).toBeGreaterThan(order(rec.trackId))
      const over = project().clips.filter((c) => c.id !== id && c.trackId === card.trackId && c.start < card.start + card.duration && c.start + c.duration > card.start)
      expect(over.map((c) => c.id)).toEqual([])
    }
    // Moved under the other clip's frames: v2 is busy there, so the card climbs to a new top lane, in the move's own step.
    const steps = history()
    state().moveClip('shot', 650)
    expect(clipOf('shot').start).toBe(650)
    alone()
    expect(clipOf(id).trackId).not.toBe('v2')
    expect(clipOf('other').trackId).toBe('v2')
    expect(history()).toBe(steps + 1)
    state().undo()
    expect(clipOf(id).trackId).toBe('v2')
    // The recording moved onto a lane above its card: the card climbs over it again.
    state().addTrack('video')
    const top = project().tracks.filter((t) => t.kind === 'video').at(-1)!.id
    state().moveClip('shot', 0, top)
    expect(clipOf('shot').trackId).toBe(top)
    alone()
  })

  it('an edit of either of the card’s two keys does not stand: the pair is rewritten whole, never two keys on one frame, and Drop then leaves none (the critics’ fix)', async () => {
    for (const [frame, value] of [[0, 0.3], [31, 0.7]] as const) {
      start()
      const id = (await state().addScreenCard('shot', 'tilt-in'))!
      await settle()
      state().setKeyframe('shot', 'opacity', frame, value)
      expect(opacity('shot'), `${frame}`).toEqual([{ frame: 0, value: 0, ease: 'hold' }, { frame: 31, value: 1 }])
      state().dropGraphic(id)
      expect(clipOf('shot').keyframes, `${frame}`).toBeUndefined()
    }
  })

  it('a copy of a recording carries no copy of its card’s keys unless its card came with it: duplicate, paste alone, and paste with the card (the critics’ fix)', async () => {
    const id = (await state().addScreenCard('shot', 'tilt-in'))!
    await settle()
    const copies = (): Clip[] => project().clips.filter((c) => c.assetId === 'talk' && c.id !== 'shot')
    // Duplicate: the copy lands at the recording's end, on its track.
    useEditor.setState({ selectedClipIds: ['shot'], selectedClipId: 'shot' })
    await state().duplicateSelection()
    expect(copies()).toHaveLength(1)
    expect(copies()[0].start).toBe(600)
    expect(copies()[0].keyframes?.opacity).toBeUndefined()
    expect(opacity('shot')).toEqual([{ frame: 0, value: 0, ease: 'hold' }, { frame: 31, value: 1 }])
    state().undo()
    // Paste alone, elsewhere.
    useEditor.setState({ clipboard: copySelection(project(), ['shot']), playhead: 2000 })
    await state().pasteClipboard()
    expect(copies()).toHaveLength(1)
    expect(copies()[0].keyframes?.opacity).toBeUndefined()
    expect(project().clips.filter((c) => c.graphic)).toHaveLength(1)
    state().undo()
    // Paste with its card: the pasted card frames the pasted recording, which keeps its two keys.
    useEditor.setState({ clipboard: copySelection(project(), ['shot', id]), playhead: 2000 })
    await state().pasteClipboard()
    await settle()
    const copy = copies()[0]
    const cards = project().clips.filter((c) => c.graphic?.data.template === 'screen-card')
    expect(cards).toHaveLength(2)
    const pasted = cardOn(copy.id)!
    expect(pasted).toBeDefined()
    expect([pasted.start, pasted.duration]).toEqual([copy.start, copy.duration])
    expect(copy.keyframes?.opacity).toEqual(screenCardKeys(pasted, copy, FPS))
    expect(cardOn('shot')!.id).toBe(id)
    expect(opacity('shot')).toEqual([{ frame: 0, value: 0, ease: 'hold' }, { frame: 31, value: 1 }])
  })

  it('a card pasted on its own, onto a recording that has its card, is removed: one card per recording (the critics’ fix)', async () => {
    const id = (await state().addScreenCard('shot', 'tilt-in'))!
    await settle()
    useEditor.setState({ clipboard: copySelection(project(), [id]), playhead: 0 })
    await state().pasteClipboard()
    await settle()
    expect(project().clips.filter((c) => c.graphic).map((c) => c.id)).toEqual([id])
    expect(opacity('shot')).toEqual([{ frame: 0, value: 0, ease: 'hold' }, { frame: 31, value: 1 }])
  })

  it('deleting the recording deletes its card', async () => {
    const id = (await state().addScreenCard('shot', 'tilt-in'))!
    await settle()
    state().removeClip('shot')
    expect(project().clips.some((c) => c.id === id)).toBe(false)
    expect(project().clips).toEqual([])
  })

  it('a split keeps the card with the left half, which keeps the id, and the right half carries no copy of its keys (a key of yours rides on)', async () => {
    const id = (await state().addScreenCard('shot', 'tilt-in'))!
    await settle()
    state().setKeyframe('shot', 'opacity', 400, 0.5)
    useEditor.setState({ playhead: 300, selectedClipId: 'shot' })
    state().splitAtPlayhead()
    const halves = project().clips.filter((c) => c.assetId === 'talk')
    expect(halves).toHaveLength(2)
    const right = halves.find((c) => c.id !== 'shot')!
    expect(clipOf('shot')).toMatchObject({ start: 0, duration: 300 })
    expect(clipOf(id)).toMatchObject({ start: 0, duration: 300 })
    expect(project().clips.filter((c) => c.graphic)).toHaveLength(1)
    expect(opacity('shot')).toEqual([{ frame: 0, value: 0, ease: 'hold' }, { frame: 31, value: 1 }, { frame: 400, value: 0.5 }])
    expect(right.keyframes?.opacity).toEqual([{ frame: 100, value: 0.5 }])
  })
})
