import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '@shared/types'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { deserializeProject, serializeProject } from '@shared/project'
import { cropAt } from '@shared/render/crop'
import { followKeys } from '@shared/reframe/keys'
import { followShotAt } from '@shared/reframe/playback'
import { STRIP_RULE } from '@shared/automation/strips'
import { REFRAME_FAILURES, type ReframeAnalyseRequest } from '@shared/reframe/job'
import { SUBJECT_TRACK_VERSION, type SubjectTrack } from '@shared/reframe/types'
import { harnessSubjectTrack } from '../../src/renderer/src/harness/reframeStub'

/*
 * The reframe's store actions through their real code (docs/CLIPS.md §4.7,
 * slice B): `reframeClip`, `reframeAll`, `unfollow`, `setFollowTwoUp`,
 * `dragFollowOffset`, `setAspect` and the keyframe actions, with the HARNESS
 * BRIDGE as `window.forge` — the stub that keeps the job contract (broadcast
 * through `onJobsChanged`, collected once, then `already`; a failure typed)
 * and answers `fileKeys` as `harness:<path>`, so the skip is exercised on the
 * key main would give. The window's `jobs:changed` wiring is App.tsx's:
 * `onJobsChanged(setJobs)`.
 *
 * Assertions are membership, not snapshots: the three facts one undo writes
 * and takes back, the key a drag lands under, the clips a press touches.
 */

const FPS = 30
const PATH = '/media/talk.mp4'
const KEY = `harness:${PATH}`
const PROJECT_PATH = '/projects/talk.forge'

type Bridge = Record<string, (...args: never[]) => unknown> & {
  analyseSubjects: (request: ReframeAnalyseRequest) => Promise<Job>
  onJobsChanged: (cb: (jobs: Job[]) => void) => () => void
  listJobs: () => Promise<Job[]>
}
type Harness = { modelPresent: boolean; stageMs: number; jobs: unknown[] }
type Editor = (typeof import('../../src/renderer/src/store'))['useEditor']

let editor: Editor
let bridge: Bridge
let harness: Harness

const video = (id: string, width: number, height: number, over: Partial<MediaAsset> = {}): MediaAsset => ({
  id, path: id === 'v' ? PATH : `/media/${id}.mp4`, name: `${id}.mp4`, kind: 'video', durationFrames: 360, width, height, fps: FPS,
  hasVideo: true, hasAudio: true, size: 1, ...over
})

const clipOf = (id: string, assetId: string, over: Partial<Clip> = {}): Clip => ({
  id, assetId, trackId: 'v1', start: 0, duration: 300, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 },
  crop: { x: 656, y: 0, width: 608, height: 1080 },
  ...over
})

/** A 9:16 edit of one 1920×1080 talk, clip `c` on V1. */
function talk(over: Partial<Project> = {}, clip: Partial<Clip> = {}): Project {
  const empty = emptyProject()
  return {
    ...empty,
    settings: { ...empty.settings, width: 1080, height: 1920, fps: FPS },
    tracks: [{ id: 'v1', kind: 'video', name: 'V1', muted: false, hidden: false, locked: false }],
    assets: [video('v', 1920, 1080)],
    clips: [clipOf('c', 'v', clip)],
    ...over
  }
}

/** The track the harness stub "finds" in the talk: 0–2 / 2–4 / 4–12 s; a face at 0.25, then 0.75, then two (a two-up). */
const stubTrack = (key = KEY): SubjectTrack => harnessSubjectTrack({ key, width: 1920, height: 1080, durationMs: 12_000 })

async function until(what: string, ok: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 2))
  }
}

/** The window that is listening now; a reload takes it away. */
let listening: (() => void) | null = null
/**
 * `followKeys` as the STORE's module graph has it. `vi.resetModules()` gives
 * the store a fresh copy of keys.ts — and of its memo — so an identity check
 * against the test file's own import compares two memos and passes whatever
 * the store stored (found by the mutation run: the stored crop made the memo's
 * object itself survived). Identity is asked of this one.
 */
let storeFollowKeys: typeof followKeys

/** A fresh store — the module evaluated again, its module-level guards empty: what Cmd+R does — wired as App.tsx wires it. */
async function freshStore(): Promise<Editor> {
  listening?.()
  vi.resetModules()
  const store = (await import('../../src/renderer/src/store')).useEditor
  listening = bridge.onJobsChanged((jobs) => store.getState().setJobs(jobs))
  store.getState().setReframeHelper('ready')
  storeFollowKeys = (await import('@shared/reframe/keys')).followKeys
  return store
}

const state = () => editor.getState()
const clipNow = (id = 'c'): Clip => state().project.clips.find((c) => c.id === id)!
const landed = (): boolean => !!state().project.subjects?.v && Object.keys(state().reframe.pending).length === 0

beforeEach(async () => {
  listening = null
  vi.resetModules()
  vi.stubGlobal('window', {})
  const mod = await import('../../src/renderer/src/harness/bridge')
  mod.installHarnessBridge()
  bridge = (window as unknown as { forge: Bridge }).forge
  harness = mod.harnessReframe
  harness.stageMs = 0
  harness.modelPresent = true
  editor = await freshStore()
  state().loadProject(talk(), PROJECT_PATH, [])
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('reframeClip', () => {
  it('writes the track, the follow and the stored crop in ONE undo step, and one undo takes all three back', async () => {
    const before = state().project
    const crop = clipNow().crop
    await state().reframeClip('c')
    await until('the track to land', landed)

    const p = state().project
    const clip = clipNow()
    expect(p.subjects?.v?.key).toBe(KEY)
    expect(clip.follow).toMatchObject({ version: 1 })
    expect(clip.follow).not.toHaveProperty('twoUp')
    const keys = storeFollowKeys(p, clip, FPS)!
    // The followed crop's first frame (shot 1's face at 0.25 → x 176), as a COPY: never followKeys' own shared object.
    expect(clip.crop).toEqual(keys.crop)
    expect(clip.crop).not.toBe(keys.crop)
    expect(clip.crop!.x).toBe(176)
    // One step on the history for the three.
    expect(state().past).toHaveLength(1)
    expect(state().past[0]).toBe(before)

    state().undo()
    expect(state().project.subjects?.v).toBeUndefined()
    expect(clipNow().follow).toBeUndefined()
    expect(clipNow().crop).toEqual(crop)
  })

  it('an edit to the stored crop never reaches the followed keys other readers share', async () => {
    await state().reframeClip('c')
    await until('the track to land', landed)
    const clip = clipNow()
    const keys = storeFollowKeys(state().project, clip, FPS)!
    const x = keys.crop.x
    clip.crop!.x = 999
    expect(storeFollowKeys(state().project, clip, FPS)!.crop.x).toBe(x)
  })

  it('skips the job when the project already has this file’s track at this key and version', async () => {
    state().loadProject(talk({ subjects: { v: stubTrack() } }), PROJECT_PATH, [])
    const analyse = vi.spyOn(bridge, 'analyseSubjects')
    await state().reframeClip('c')
    expect(analyse).not.toHaveBeenCalled()
    expect(clipNow().follow).toMatchObject({ version: 1 })
    expect(state().past).toHaveLength(1)
    // A track of another key — the file changed since — is analysed again.
    state().loadProject(talk({ subjects: { v: stubTrack('1:2') } }), PROJECT_PATH, [])
    await state().reframeClip('c')
    expect(analyse).toHaveBeenCalledTimes(1)
  })

  it('without the AI helper, says so in its words and asks main for nothing', async () => {
    state().setReframeHelper('missing')
    const analyse = vi.spyOn(bridge, 'analyseSubjects')
    const model = vi.spyOn(bridge, 'faceModel')
    await state().reframeClip('c')
    expect(state().notices.map((n) => n.text)).toContain(REFRAME_FAILURES['no-helper'])
    expect(REFRAME_FAILURES['no-helper']).toContain('needs the AI helper')
    expect(analyse).not.toHaveBeenCalled()
    expect(model).not.toHaveBeenCalled()
    expect(clipNow().follow).toBeUndefined()
  })

  it('fetches the face finder first when it is not on disk, then analyses', async () => {
    harness.modelPresent = false
    const model = vi.spyOn(bridge, 'faceModel')
    await state().reframeClip('c')
    expect(model.mock.calls.map((c) => c[0])).toEqual([{}, { download: true }])
    expect(state().reframe.model?.present).toBe(true)
    expect(state().reframe.fetching).toBeNull()
    await until('the track to land', landed)
    expect(clipNow().follow).toBeDefined()
  })

  it('a fetch that leaves the face finder missing says so and starts no job', async () => {
    harness.modelPresent = false
    vi.spyOn(bridge, 'faceModel').mockImplementation((async () => ({ present: false, bytes: 1_083_786, label: 'the face finder', host: 'x' })) as never)
    const analyse = vi.spyOn(bridge, 'analyseSubjects')
    await state().reframeClip('c')
    expect(analyse).not.toHaveBeenCalled()
    expect(state().notices.map((n) => n.text)).toContain(REFRAME_FAILURES['model-missing'])
  })

  it('a job that fails is said once in §4.8’s words, from its TYPED reason, and the dock forgets the face finder', async () => {
    // The store believes the face finder is there; main finds it is not.
    state().setReframeModel({ present: true, bytes: 1_083_786, label: 'the face finder', host: 'x' })
    harness.modelPresent = false
    await state().reframeClip('c')
    await until('the failure to be said', () => state().notices.some((n) => n.text === REFRAME_FAILURES['model-missing']))
    expect(state().reframe.model?.present).toBe(false)
    expect(state().reframe.pending).toEqual({})
    expect(clipNow().follow).toBeUndefined()
    // Said once, however many broadcasts follow.
    state().setJobs(await bridge.listJobs())
    await new Promise((r) => setTimeout(r, 10))
    expect(state().notices.filter((n) => n.text === REFRAME_FAILURES['model-missing'])).toHaveLength(1)
  })

  it('a phrase is refused before any job, with 1g’s reason', async () => {
    const analyse = vi.spyOn(bridge, 'analyseSubjects')
    await state().reframeClip('c', { phrase: 'the cake' })
    expect(analyse).not.toHaveBeenCalled()
    expect(state().notices.map((n) => n.text)).toContain(REFRAME_FAILURES['phrase-needs-ground'])
  })
})

describe('a project saved or swapped while its analysis runs', () => {
  it('a save mid-job — the first Cmd+S of an untitled project, or Save As — still lands the track: the work is the same', async () => {
    harness.stageMs = 30
    // Untitled: never saved, no path.
    editor.setState({ projectPath: null })
    const id = state().project.id
    await state().reframeClip('c')
    expect(Object.keys(state().reframe.pending)).toEqual(['v'])
    // Saved for the first time, then saved under another name, while the file is being analysed.
    state().markSaved('/projects/first-save.forge')
    state().markSaved('/projects/save-as.forge')
    expect(state().project.id).toBe(id)
    await until('the track to land', landed)
    expect(clipNow().follow).toBeDefined()
    expect(state().notices.map((n) => n.text).join(' | ')).not.toContain('after another project was opened')
  })

  it('another project opened mid-job is not followed in, even holding a file of the same asset id', async () => {
    harness.stageMs = 30
    const collect = vi.spyOn(bridge, 'collectSubjects')
    await state().reframeClip('c')
    // A different project — its own id — with an asset of the same id.
    state().loadProject(talk(), '/projects/other.forge', [])
    const other = state().project
    await until('the collect', () => collect.mock.calls.length === 1)
    await collect.mock.results[0].value
    await until('the refusal to be said', () => state().notices.some((n) => n.text.includes('after another project was opened')))
    expect(state().project).toBe(other)
    expect(clipNow().follow).toBeUndefined()
  })
})

describe('reframeAll', () => {
  it('follows every unfollowed landscape VIDEO clip on the timeline, one job per file — and touches nothing else', async () => {
    const followedTrack = harnessSubjectTrack({ key: 'harness:/media/w.mp4', width: 1280, height: 720, durationMs: 12_000 })
    const p = talk({
      assets: [
        video('v', 1920, 1080),
        video('w', 1280, 720),
        video('portrait', 1080, 1920),
        { ...video('photo', 1920, 1080), kind: 'image', path: '/media/photo.jpg', fps: null },
        // In the pool only: no clip of it.
        video('pool', 1920, 1080)
      ],
      clips: [
        clipOf('c', 'v'),
        clipOf('c2', 'v', { start: 300 }),
        clipOf('d', 'w', { start: 600, follow: { version: 1 }, crop: { x: 436, y: 0, width: 406, height: 720 } }),
        clipOf('e', 'portrait', { start: 900, crop: undefined }),
        clipOf('f', 'photo', { start: 1200 })
      ],
      subjects: { w: followedTrack }
    })
    state().loadProject(p, PROJECT_PATH, [])
    const analyse = vi.spyOn(bridge, 'analyseSubjects')
    const d = clipNow('d')
    await state().reframeAll()
    await until('the track to land', landed)

    expect(analyse).toHaveBeenCalledTimes(1)
    expect(analyse.mock.calls[0][0]).toMatchObject({ assetId: 'v', clipIds: ['c', 'c2'], width: 1920, height: 1080, name: 'v.mp4' })
    expect(clipNow('c').follow).toBeDefined()
    expect(clipNow('c2').follow).toBeDefined()
    // Already following: the same clip, untouched.
    expect(clipNow('d')).toBe(d)
    expect(clipNow('e').follow).toBeUndefined()
    expect(clipNow('f').follow).toBeUndefined()
    expect(Object.keys(state().project.subjects ?? {}).sort()).toEqual(['v', 'w'])
  })
})

describe('setAspect', () => {
  it('keeps follow, stores the followed crop’s size at the new shape, and a 9:16 → 16:9 → 1:1 → 9:16 round trip gives the crop back', async () => {
    await state().reframeClip('c')
    await until('the track to land', landed)
    const at916 = { ...clipNow().crop! }
    const follow = clipNow().follow

    state().setAspect('16:9')
    expect(clipNow().follow).toBe(follow)
    // The source's own shape: the whole frame, nothing to follow.
    expect(clipNow().crop).toEqual(followKeys(state().project, clipNow(), FPS)!.crop)
    expect(clipNow().crop).toMatchObject({ width: 1920, height: 1080 })

    state().setAspect('1:1')
    expect(clipNow().follow).toBe(follow)
    const square = storeFollowKeys(state().project, clipNow(), FPS)!
    expect(clipNow().crop).toEqual(square.crop)
    expect(clipNow().crop).not.toBe(square.crop)
    expect(clipNow().crop).toMatchObject({ width: 1080, height: 1080 })

    state().setAspect('9:16')
    expect(clipNow().follow).toBe(follow)
    expect(clipNow().crop).toEqual(at916)
  })
})

describe('unfollow', () => {
  it('takes follow away and leaves the crop where it is at the playhead, static — one undo', async () => {
    await state().reframeClip('c')
    await until('the track to land', landed)
    // 2.5 s: shot 2, the face at 0.75.
    state().setPlayhead(75)
    const there = cropAt(state().project, clipNow(), null, 75).crop
    expect(there.x).not.toBe(clipNow().crop!.x)
    const steps = state().past.length
    state().unfollow('c')
    expect(clipNow().follow).toBeUndefined()
    expect(clipNow().crop).toEqual(there)
    expect(state().past).toHaveLength(steps + 1)
  })

  it('on a stacked two-up frame, the crop it keeps is the top half’s position at the full size', async () => {
    await state().reframeClip('c')
    await until('the track to land', landed)
    state().setPlayhead(150)
    const keys = followKeys(state().project, clipNow(), FPS)!
    const cut = cropAt(state().project, clipNow(), null, 150)
    expect(cut.halves).toBeDefined()
    state().unfollow('c')
    expect(clipNow().crop).toEqual({ ...cut.crop })
    expect(clipNow().crop).toMatchObject({ x: cut.halves!.top.x, width: keys.size.width, height: keys.size.height })
  })
})

describe('Stack two people', () => {
  it('off writes twoUp: false and the shot frames one face; on takes it away again', async () => {
    await state().reframeClip('c')
    await until('the track to land', landed)
    const stacked = followKeys(state().project, clipNow(), FPS)!
    expect(stacked.shots.map((s) => s.why)).toContain('two-up')
    state().setFollowTwoUp('c', false)
    expect(clipNow().follow?.twoUp).toBe(false)
    const one = followKeys(state().project, clipNow(), FPS)!
    expect(one.shots.map((s) => s.why)).not.toContain('two-up')
    expect(cropAt(state().project, clipNow(), null, 150).halves).toBeUndefined()
    state().setFollowTwoUp('c', true)
    expect(clipNow().follow).not.toHaveProperty('twoUp')
  })
})

describe('dragFollowOffset', () => {
  /**
   * Cuts on odd 60 fps frames, so every shot's start is fractional ms — 1016.67,
   * 2033.33, 5516.67 — as the shot finder prints them; a face at 0.25, 0.75,
   * 0.5, then one at 0.5 or two far apart (a two-up).
   */
  function fractional(twoUp = false): Project {
    const starts = [0, 1016.67, 2033.33, 5516.67]
    const shots = starts.map((startMs, i) => ({ startMs, endMs: starts[i + 1] ?? 7500, score: i ? 1 : 0 }))
    const centres = [[0.25], [0.75], [0.5], twoUp ? [0.8, 0.2] : [0.5]]
    const samples: SubjectTrack['samples'] = []
    for (let ms = 0; ms < 7500; ms += 500) {
      const shot = shots.findIndex((s) => ms >= s.startMs && ms < s.endMs)
      samples.push({ ms, faces: centres[shot].map((cx) => ({ x: cx - 0.04, y: 0.25, width: 0.08, height: 0.14, score: 0.9 })) })
    }
    const track: SubjectTrack = {
      key: KEY, version: SUBJECT_TRACK_VERSION, width: 1920, height: 1080, durationMs: 7500, shots, samples,
      perShot: shots.map(() => ({})), detector: 'test', scene: { threshold: 0.3, minShotMs: 500, backend: 'ffmpeg-select-rgb24' }, at: '2026-10-13T00:00:00.000Z'
    }
    return talk({ subjects: { v: track } }, { follow: { version: 1 }, duration: 225 })
  }

  it('SETS the drag’s total under the shot’s EXACT startMs — one undo for the gesture', () => {
    state().loadProject(fractional(), PROJECT_PATH, [])
    const keys = followKeys(state().project, clipNow(), FPS)!
    const shot = keys.shots[1]
    expect(shot.startMs % 1).not.toBe(0)
    const before = cropAt(state().project, clipNow(), null, shot.from).crop.x

    state().begin()
    state().dragFollowOffset('c', shot.index, 0.1)
    state().dragFollowOffset('c', shot.index, -0.25)
    state().commit()

    const offsets = clipNow().follow!.offsets!
    expect(Object.keys(offsets)).toEqual([String(shot.startMs)])
    expect(offsets[shot.startMs]).toBe(-0.25)
    expect(state().past).toHaveLength(1)
    // The path reads it there: the shot's crop moved by a quarter of the crop, the other shots did not.
    const after = cropAt(state().project, clipNow(), null, shot.from).crop.x
    expect(after - before).toBeCloseTo(-0.25 * keys.size.width, -1)
    expect(cropAt(state().project, clipNow(), null, 0).crop.x).toBe(clipNow().crop!.x)
  })

  it('on a two-up shot moves only the half dragged; a single crop’s share there changes nothing', () => {
    state().loadProject(fractional(true), PROJECT_PATH, [])
    const keys = followKeys(state().project, clipNow(), FPS)!
    const shot = keys.shots[3]
    expect(shot.why).toBe('two-up')
    const frame = shot.from + 5
    const before = cropAt(state().project, clipNow(), null, frame).halves!

    const unchanged = state().project
    state().dragFollowOffset('c', shot.index, 0.2)
    expect(state().project).toBe(unchanged)

    state().dragFollowOffset('c', shot.index, { half: 'bottom', x: -0.1, y: 0.05 })
    const after = cropAt(state().project, clipNow(), null, frame).halves!
    expect(after.top).toEqual(before.top)
    expect(after.bottom.x).not.toBe(before.bottom.x)
    expect(after.bottom.y).not.toBe(before.bottom.y)
    expect(clipNow().follow!.halfOffsets).toEqual({ [shot.startMs]: { bottom: { x: -0.1, y: 0.05 } } })
  })
})

describe('a re-analysis', () => {
  it('moves the drags onto the new shots — nearest start, else the same index — and drops the rest with a note', async () => {
    // The old analysis: cuts at 1, 2.1 and 4.5 s. The new one (the stub's): 2 and 4 s.
    const old = stubTrack('an-older-file')
    const oldShots = [0, 1000, 2100, 4500].map((startMs, i, all) => ({ startMs, endMs: all[i + 1] ?? 12_000, score: i ? 1 : 0 }))
    const p = talk(
      { subjects: { v: { ...old, shots: oldShots, perShot: oldShots.map(() => ({})) } } },
      {
        follow: {
          version: 3,
          // 2100 → 2000 by time (100 ms), though index 2 is 4000 in the new track; 4500 has neither a near start nor an index.
          offsets: { 2100: 0.2, 4500: -0.1 },
          // 1000 is near no new start: by index (1) it goes to 2000.
          halfOffsets: { 1000: { bottom: { x: 0.1, y: 0 } } }
        }
      }
    )
    state().loadProject(p, PROJECT_PATH, [])
    await state().reframeClip('c')
    await until('the new track to land', () => state().project.subjects?.v?.key === KEY && Object.keys(state().reframe.pending).length === 0)

    const follow = clipNow().follow!
    expect(follow.offsets).toEqual({ 2000: 0.2 })
    expect(follow.halfOffsets).toEqual({ 2000: { bottom: { x: 0.1, y: 0 } } })
    expect(follow.version).toBeGreaterThan(3)
    expect(state().notices.some((n) => /^1 framing adjustment .*dropped$/.test(n.text))).toBe(true)
  })
})

describe('the strips over a followed clip', () => {
  it('cut each flash from the crop on ITS OWN frame — the followed crop moves shot by shot', async () => {
    const tracks: Project['tracks'] = [
      { id: 'v1', kind: 'video', name: 'V1', muted: false, hidden: false, locked: false },
      { id: 'v2', kind: 'video', name: 'V2', muted: false, hidden: false, locked: false }
    ]
    state().loadProject(talk({ tracks, subjects: { v: stubTrack() } }, { follow: { version: 1 } }), PROJECT_PATH, [])
    state().setPlayhead(0)
    await state().buildStrips()
    const base = clipNow()
    const keys = followKeys(state().project, base, FPS)!
    const strips = state().project.clips.filter((c) => c.generatedBy?.rule === STRIP_RULE)
    expect(strips.length).toBeGreaterThan(0)
    const shotsHit = new Set<number>()
    for (const strip of strips) {
      const shown = cropAt(state().project, base, null, strip.start - base.start).crop
      expect(strip.crop!.x, `the strip at ${strip.start}`).toBeGreaterThanOrEqual(shown.x)
      expect(strip.crop!.x + strip.crop!.width).toBeLessThanOrEqual(shown.x + shown.width + 1)
      shotsHit.add(followShotAt(keys, strip.start - base.start)!.index)
    }
    // Flashes in more than one shot, where the crop is in different places: otherwise this could not tell.
    expect(shotsHit.size).toBeGreaterThan(1)
  })
})

describe('keyframes', () => {
  it('no action writes a followed crop’s x or y: they are compiled, never stored', () => {
    const before = state().project
    state().setKeyframes('c', 'cropX', [{ frame: 0, value: 100 }, { frame: 30, value: 900 }])
    state().setKeyframe('c', 'cropY', 0, 5)
    expect(state().project).toBe(before)
    expect(clipNow().keyframes?.cropX).toBeUndefined()
    expect(clipNow().keyframes?.cropY).toBeUndefined()
    // The ordinary ones still write.
    state().setKeyframes('c', 'zoom', [{ frame: 0, value: 1.2 }])
    expect(clipNow().keyframes?.zoom).toHaveLength(1)
  })
})

describe('a reload (Cmd+R)', () => {
  it('after the track landed: main answers `already` and the second window touches nothing', async () => {
    await state().reframeClip('c')
    await until('the track to land', landed)
    const saved = JSON.parse(JSON.stringify(serializeProject(state().project, { appVersion: '0.1.0' })))

    editor = await freshStore()
    state().loadProject(deserializeProject(saved).project, PROJECT_PATH, [])
    const before = state()
    const collect = vi.spyOn(bridge, 'collectSubjects')
    state().setJobs(await bridge.listJobs())
    await until('the collect', () => collect.mock.calls.length === 1)
    await collect.mock.results[0].value
    await new Promise((r) => setTimeout(r, 5))

    const after = state()
    expect(await collect.mock.results[0].value).toEqual({ kind: 'already' })
    expect(after.project).toBe(before.project)
    expect(after.past).toBe(before.past)
    expect(after.notices).toEqual([])
    expect(after.project.subjects?.v?.key).toBe(KEY)
    expect(clipNow().follow).toBeDefined()
    // The claim is kept: later broadcasts do not ask again.
    state().setJobs(await bridge.listJobs())
    expect(collect).toHaveBeenCalledTimes(1)
  })

  it('mid-job: the busy file is known again from main’s list, and the track lands on the clips the request named', async () => {
    harness.stageMs = 40
    await state().reframeClip('c')
    expect(Object.values(state().reframe.pending)).toHaveLength(1)

    // Cmd+R before the job is done: this window's own notes are gone.
    editor = await freshStore()
    state().loadProject(talk(), PROJECT_PATH, [])
    expect(state().reframe.pending).toEqual({})
    state().setJobs(await bridge.listJobs())
    expect(Object.keys(state().reframe.pending)).toEqual(['v'])

    await until('the track to land', landed)
    expect(clipNow().follow).toBeDefined()
    expect(state().past).toHaveLength(1)
  })
})

describe('the migration', () => {
  it('opens a project with no subjects, and drops a track the follow path cannot walk', () => {
    const file = JSON.parse(JSON.stringify(serializeProject(talk({}, { follow: { version: 1 } }), { appVersion: '0.1.0' })))
    const plain = deserializeProject(file).project
    expect(plain.subjects).toBeUndefined()
    // A followed clip with no track reads its stored crop.
    expect(cropAt(plain, plain.clips[0], null, 0).crop).toEqual({ x: 656, y: 0, width: 608, height: 1080 })

    file.project.subjects = { v: { key: KEY, version: 1, width: 1920, height: 1080, shots: 'not a list', samples: [], perShot: [] } }
    const broken = deserializeProject(file).project
    expect(broken.subjects).toBeUndefined()
    expect(() => cropAt(broken, broken.clips[0], null, 0)).not.toThrow()

    // Whole-looking, with one shot null: the first draw read its startMs and threw. Held to checkSubjectTrack, dropped.
    const good = stubTrack()
    file.project.subjects = { v: { ...good, shots: [null, ...good.shots.slice(1)] } }
    const nullShot = deserializeProject(file).project
    expect(nullShot.subjects).toBeUndefined()
    expect(() => cropAt(nullShot, nullShot.clips[0], null, 0)).not.toThrow()
    // A box past the frame, or shots that stop short of the file: what main's own read-back refuses, refused here too.
    file.project.subjects = { v: { ...good, samples: [{ ms: 0, faces: [{ x: 0.95, y: 0.1, width: 0.1, height: 0.1, score: 0.9 }] }] } }
    expect(deserializeProject(file).project.subjects).toBeUndefined()
    file.project.subjects = { v: { ...good, durationMs: good.durationMs + 1000 } }
    expect(deserializeProject(file).project.subjects).toBeUndefined()
    // One good track beside a bad one: the good one is kept.
    file.project.subjects = { v: good, w: { ...good, shots: [null] } }
    expect(Object.keys(deserializeProject(file).project.subjects ?? {})).toEqual(['v'])

    file.project.subjects = null
    expect(deserializeProject(file).project.subjects).toBeUndefined()

    file.project.subjects = { v: stubTrack() }
    expect(deserializeProject(file).project.subjects?.v?.key).toBe(KEY)
  })
})
