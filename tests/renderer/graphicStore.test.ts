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
  forgotten: [] as string[]
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
  graphicPreviewCanvas: () => null
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
    const named = await added({ subject: { clipId: 'b', box: { x: 0.1, y: 0.2, width: 0.2, height: 0.3 }, ms: 1000 } })
    const under = await added()
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
