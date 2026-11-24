import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '@shared/types'
import type { IngestRequest } from '@shared/ingest/args'
import type { LinkClip } from '@shared/ingest/linkClip'
import { runFromRows } from '@shared/ingest/wordRun'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import type { BestClipCard } from '@shared/bestclips/run'
import { clipSegments } from '@shared/bestclips/windows'
import { NOT_SAVED_NOTE, STEP_TEXT, stepOf, type CardClipRecord } from '@shared/bestclips/cardClip'

/** The moments' and graphics' bakes, as recorders: there is no WebGL or canvas here, and what is under test is the order. */
vi.mock('../../src/renderer/src/momentCanvas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/src/momentCanvas')>()),
  bakeMomentSequence: async (_spec: unknown, clipId: string) => ({ pattern: `/frames/${clipId}/%05d.png`, frames: 12 })
}))
vi.mock('../../src/renderer/src/graphicCanvas', () => ({
  bakeGraphicSequence: async () => null,
  forgetGraphicPreview: () => undefined,
  graphicPreviewCanvas: () => null
}))

/*
 * Clip it from a Best clips card through the store (docs/CLIPS.md §7.5 steps
 * 0 to 5), with the HARNESS BRIDGE as window.forge — its twelve-row talk, its
 * director status (no model, so the signals pick), its stubbed reframe job,
 * broadcast through onJobsChanged as main's is — and a download that lands
 * when the test collects it. Every word is the harness's made-up talk.
 *
 *   - step 0: a 16:9 edit is asked about, and no answer re-crops it (the
 *     plan's mutation: setAspect called directly);
 *   - the run is the card's window, word for word;
 *   - Start a new project saves first, and a closed Save dialog drops nothing;
 *   - steps 3-5 after the clip lands, each its own undo step, graphics only
 *     once the reframe job has ended (§12.1);
 *   - M0's Clip it from picked rows is as it was: no question, no step.
 */

const FPS = 30
type Bridge = Record<string, (...args: never[]) => unknown> & {
  onJobsChanged: (cb: (jobs: Job[]) => void) => () => void
  analyseSubjects: (...args: never[]) => Promise<Job>
}
type Editor = (typeof import('../../src/renderer/src/store'))['useEditor']

let editor: Editor
let bridge: Bridge
let listening: (() => void) | null = null
let talkUrl: string
let started: { request: IngestRequest; clip: LinkClip | null; id: string }[] = []
let saves: Project[] = []
let saveAnswer: string | null = null
let analyses = 0
let completes = 0
/** Downloads that land as a portrait file (nothing to follow in it). */
let portrait = new Set<string>()

const state = () => editor.getState()

/** A project open, as loadProject leaves it, at `path` (null: never saved). */
function open(project: Project, path: string | null): void {
  if (path !== null) state().loadProject(project, path, [])
  else {
    state().loadProject(project, '/projects/unsaved.forge', [])
    editor.setState({ projectPath: null })
  }
}

async function until(what: string, ok: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 2))
  }
}

const video = (id: string, path: string, ms: number): MediaAsset => ({
  id, path, name: id, kind: 'video', durationFrames: Math.round((ms / 1000) * FPS), width: 1920, height: 1080, fps: FPS, hasVideo: true, hasAudio: true, size: 1
})

const clipOf = (id: string, start: number, crop: Clip['crop']): Clip => ({
  id, assetId: 'edit', trackId: 'v1', start, duration: 300, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 }, crop
})

/** A 16:9 edit: two clips of one landscape file, each with a crop of its own; captions off. */
function edit16x9(): Project {
  const base = emptyProject()
  return {
    ...base,
    settings: { ...base.settings, width: 1920, height: 1080, fps: FPS },
    captions: { ...base.captions, enabled: false },
    assets: [video('edit', '/media/edit.mp4', 30_000)],
    clips: [clipOf('e1', 0, { x: 12, y: 0, width: 1800, height: 1012 }), clipOf('e2', 300, { x: 40, y: 8, width: 1700, height: 956 })]
  }
}

/** An empty 16:9 project with captions off. */
function empty16x9(): Project {
  const base = emptyProject()
  return { ...base, settings: { ...base.settings, fps: FPS }, captions: { ...base.captions, enabled: false } }
}

beforeEach(async () => {
  listening = null
  started = []
  saves = []
  saveAnswer = null
  analyses = 0
  completes = 0
  portrait = new Set()
  vi.resetModules()
  vi.stubGlobal('window', {})
  const mod = await import('../../src/renderer/src/harness/bridge')
  mod.installHarnessBridge()
  talkUrl = mod.HARNESS_LINKS.talk
  mod.harnessReframe.stageMs = 15
  mod.harnessReframe.modelPresent = true
  bridge = (window as unknown as { forge: Bridge }).forge
  const analyse = bridge.analyseSubjects
  Object.assign(bridge, {
    // The download: recorded, queued, and landed when the test collects it.
    startIngest: async (request: IngestRequest, clip?: LinkClip | null) => {
      const id = `dl-${started.length + 1}`
      started.push({ request, clip: clip ?? null, id })
      return { id, presetId: 'ingest', status: 'queued' }
    },
    collectIngest: async (jobId: string) => {
      const job = started.find((s) => s.id === jobId)!
      const range = job.request.range!
      return {
        path: `/downloads/${jobId}.mp4`,
        asset: {
          ...video(`asset-${jobId}`, `/downloads/${jobId}.mp4`, range.endMs - range.startMs),
          ...(portrait.has(jobId) ? { width: 1080, height: 1920 } : {})
        },
        cached: false,
        approximateRange: false,
        requestedRange: range,
        stems: null,
        link: job.clip
      }
    },
    saveProject: async (project: Project) => {
      saves.push(project)
      return saveAnswer
    },
    rememberRecent: () => undefined,
    clearAutosave: async () => undefined,
    analyseSubjects: async (...args: never[]) => {
      analyses++
      return analyse(...args)
    },
    directorComplete: async () => {
      completes++
      throw new Error('no model here')
    }
  })
  editor = (await import('../../src/renderer/src/store')).useEditor
  listening = bridge.onJobsChanged((jobs) => state().setJobs(jobs))
})

afterEach(() => {
  listening?.()
  vi.unstubAllGlobals()
})

/** Get transcript on the harness talk, Analyse at 1 min: the three cards. */
async function cards(): Promise<BestClipCard[]> {
  state().setIngest({ url: talkUrl })
  await state().getTranscript()
  await state().analyseBestClips()
  const shown = state().bestClips.last?.result.cards ?? []
  expect(shown).toHaveLength(3)
  return shown
}

const recordOf = (card: BestClipCard): CardClipRecord | undefined => Object.values(state().bestClipsClipped).find((r) => r.windowId === card.windowId)

describe('step 0 — where the clip goes', () => {
  it('into a 16:9 edit, ASKS, and neither asking nor "Add it to this project" changes the aspect or any existing clip’s crop', async () => {
    const shown = await cards()
    open(edit16x9(), '/projects/edit.forge')
    const before = state().project
    const crops = before.clips.map((c) => ({ id: c.id, crop: { ...c.crop! } }))

    await state().clipItFromCard(shown[0])
    // Asked, nothing sent, nothing changed.
    expect(state().bestClipsQuestion?.card.windowId).toBe(shown[0].windowId)
    expect(started).toHaveLength(0)
    for (const { id, crop } of crops) expect(state().project.clips.find((c) => c.id === id)?.crop, id).toEqual(crop)
    expect(state().project.settings).toMatchObject({ width: 1920, height: 1080 })
    expect(state().aspect).toBe('16:9')

    await state().answerBestClipsQuestion('add')
    expect(state().bestClipsQuestion).toBeNull()
    expect(started).toHaveLength(1)
    for (const { id, crop } of crops) expect(state().project.clips.find((c) => c.id === id)?.crop, id).toEqual(crop)
    expect(state().project.settings).toMatchObject({ width: 1920, height: 1080 })
    expect(state().aspect).toBe('16:9')
    // The project's shape is said on the card, and on a landscape canvas nothing will be followed.
    expect(stepOf(recordOf(shown[0])!, 'shape')?.text).toBe(STEP_TEXT.shapeKept)
    expect(recordOf(shown[0])?.reframe).toBe(false)
  })

  it('"Not now" closes the question and sends nothing', async () => {
    const shown = await cards()
    open(edit16x9(), '/projects/edit.forge')
    await state().clipItFromCard(shown[1])
    await state().answerBestClipsQuestion(null)
    expect(state().bestClipsQuestion).toBeNull()
    expect(started).toHaveLength(0)
    expect(state().bestClipsClipped).toEqual({})
  })

  it('on an empty timeline, sets this project to 9:16 and sends exactly the card’s window as the run, exact', async () => {
    const shown = await cards()
    open(empty16x9(), null)
    const card = shown[1]
    await state().clipItFromCard(card)
    expect(state().bestClipsQuestion).toBeNull()
    expect(state().project.settings).toMatchObject({ width: 1080, height: 1920 })
    expect(state().aspect).toBe('9:16')
    expect(started).toHaveLength(1)

    const t = state().urlSource!.transcript!
    const w = state().bestClips.last!.result.candidates.windows.find((x) => x.id === card.windowId)!
    const segs = clipSegments(t)
    const from = started[0].clip!.transcriptFrom
    // The run's first word is the window's first segment's first word; its last, the last segment's last.
    expect(t.words[from.run.from].index).toBe(segs.find((s) => s.id === w.segFrom)!.wordStart)
    expect(t.words[from.run.to].index).toBe(segs.find((s) => s.id === w.segTo)!.wordEnd)
    expect(from.words).toEqual({ count: t.words.length, first: t.words[from.run.from].text, last: t.words[from.run.to].text })
    expect(started[0].request.exact).toBe(true)
    expect(started[0].request.range).toEqual({ startMs: card.startMs, endMs: card.endMs })
    expect(stepOf(recordOf(card)!, 'shape')?.text).toBe(STEP_TEXT.shapeSet)
  })

  it('a card clipped shows it and is not sent twice; another card is still pressable', async () => {
    const shown = await cards()
    open(empty16x9(), null)
    await state().clipItFromCard(shown[0])
    await state().clipItFromCard(shown[0])
    expect(started).toHaveLength(1)
    // The timeline is still empty (the download has not landed): the second card goes straight in too.
    await state().clipItFromCard(shown[2])
    expect(started).toHaveLength(2)
    expect(started.map((s) => s.request.range)).toEqual([
      { startMs: shown[0].startMs, endMs: shown[0].endMs },
      { startMs: shown[2].startMs, endMs: shown[2].endMs }
    ])
  })
})

describe('"Start a new 9:16 project for this clip" — the work is saved first, never dropped', () => {
  it('with unsaved changes, saves; a closed Save dialog starts nothing and keeps the question', async () => {
    const shown = await cards()
    open(edit16x9(), null)
    state().update((p) => ({ ...p, clips: p.clips.map((c) => (c.id === 'e2' ? { ...c, start: 400 } : c)) }))
    expect(state().dirty).toBe(true)
    const work = state().project

    await state().clipItFromCard(shown[0])
    saveAnswer = null
    await state().answerBestClipsQuestion('new')
    expect(saves).toEqual([work])
    expect(state().project).toBe(work)
    expect(state().dirty).toBe(true)
    expect(state().bestClipsQuestion).not.toBeNull()
    expect(started).toHaveLength(0)
    expect(state().notices.map((n) => n.text)).toContain(NOT_SAVED_NOTE)

    saveAnswer = '/projects/work.forge'
    await state().answerBestClipsQuestion('new')
    expect(saves).toEqual([work, work])
    // A new 9:16 project, empty but for what lands; the cards and the link stay (session state).
    expect(state().project).not.toBe(work)
    expect(state().project.clips).toEqual([])
    expect(state().project.settings).toMatchObject({ width: 1080, height: 1920, fps: FPS })
    expect(state().aspect).toBe('9:16')
    expect(state().bestClips.last?.result.cards).toHaveLength(3)
    expect(started).toHaveLength(1)
    expect(stepOf(recordOf(shown[0])!, 'shape')?.text).toBe(STEP_TEXT.shapeNew)
  })

  it('with nothing unsaved, asks no Save of anyone', async () => {
    const shown = await cards()
    open(edit16x9(), '/projects/edit.forge')
    await state().clipItFromCard(shown[0])
    await state().answerBestClipsQuestion('new')
    expect(saves).toEqual([])
    expect(state().project.clips).toEqual([])
    expect(started).toHaveLength(1)
  })
})

describe('steps 3 to 5 after a card’s clip lands (§7.5, §12.1)', () => {
  it('follow the subject, then captions, then graphics — each its own undo step, graphics only once the reframe job has ended', async () => {
    const shown = await cards()
    open(empty16x9(), null)
    state().setReframeHelper('ready')
    // Every moment Find graphics runs, whether a reframe analysis was still running.
    const overlaps: boolean[] = []
    const stop = editor.subscribe((s, prev) => {
      if (s.findingGraphics !== null && prev.findingGraphics === null) overlaps.push(Object.keys(s.reframe.pending).length > 0)
    })

    const card = shown[0]
    await state().clipItFromCard(card)
    const depth = state().past.length
    await state().collectIngest(started[0].id)
    const record = (): CardClipRecord => recordOf(card)!
    expect(stepOf(record(), 'download')).toMatchObject({ state: 'done', text: STEP_TEXT.landed })

    // The analysis is out: graphics waits, and nothing has asked the model.
    await until('the reframe to start', () => Object.keys(state().reframe.pending).length > 0)
    expect(stepOf(record(), 'graphics')?.state).toBe('waiting')
    expect(state().findingGraphics).toBeNull()
    expect(completes).toBe(0)

    await until('the graphics step to end', () => ['done', 'skipped', 'failed'].includes(stepOf(record(), 'graphics')!.state))
    stop()
    expect(analyses).toBe(1)
    expect(overlaps).toEqual([false])
    expect(stepOf(record(), 'reframe')).toMatchObject({ state: 'done', text: STEP_TEXT.reframeDone })
    expect(stepOf(record(), 'captions')).toMatchObject({ state: 'done', text: STEP_TEXT.captionsSmart })
    expect(stepOf(record(), 'graphics')).toMatchObject({ state: 'done', text: STEP_TEXT.graphicsDone })
    const clip = state().project.clips.find((c) => c.id === record().clipId)!
    expect(clip.follow).toBeTruthy()
    expect(state().project.captions).toMatchObject({ enabled: true, placement: 'smart' })
    // The run is the clip's (the baseline's, with no model); on the harness talk it places nothing, so it writes no step.
    expect(state().lastGraphics).toMatchObject({ clipId: clip.id, model: 'baseline' })
    // The landing, the track and the captions: three steps on the history, each its own.
    expect(state().past.length - depth).toBe(3)
    // One undo takes the captions back alone; the next the follow alone; the clip stays through both.
    state().undo()
    expect(state().project.captions.enabled).toBe(false)
    expect(state().project.clips.find((c) => c.id === clip.id)?.follow).toBeTruthy()
    state().undo()
    expect(state().project.clips.find((c) => c.id === clip.id)?.follow).toBeUndefined()
    expect(state().project.clips.map((c) => c.id)).toContain(clip.id)
  })

  it('a second card’s graphics waits while the FIRST card’s reframe analysis runs (never resident together)', async () => {
    const shown = await cards()
    open(empty16x9(), null)
    state().setReframeHelper('ready')
    const overlaps: boolean[] = []
    const stop = editor.subscribe((s, prev) => {
      if (s.findingGraphics !== null && prev.findingGraphics === null) overlaps.push(Object.keys(s.reframe.pending).length > 0)
    })
    await state().clipItFromCard(shown[0])
    await state().clipItFromCard(shown[2])
    // The second lands as a portrait file: its own follow is skipped at once, and its graphics is next.
    portrait.add(started[1].id)
    await state().collectIngest(started[0].id)
    await until('the first card’s reframe to start', () => Object.keys(state().reframe.pending).length > 0)
    await state().collectIngest(started[1].id)
    const second = (): CardClipRecord => recordOf(shown[2])!
    expect(stepOf(second(), 'reframe')).toMatchObject({ state: 'skipped', text: STEP_TEXT.reframeNothing })
    await new Promise((r) => setTimeout(r, 5))
    expect(stepOf(second(), 'graphics')?.state).toBe('waiting')
    await until('both graphics steps to end', () =>
      [shown[0], shown[2]].every((c) => ['done', 'skipped', 'failed'].includes(stepOf(recordOf(c)!, 'graphics')!.state))
    )
    stop()
    expect(overlaps).toEqual([false, false])
    expect(stepOf(second(), 'graphics')?.state).toBe('done')
  })

  it('without the AI helper, the crop stays centred, said; captions and graphics still run', async () => {
    const shown = await cards()
    open(empty16x9(), null)
    state().setReframeHelper('missing')
    await state().clipItFromCard(shown[2])
    await state().collectIngest(started[0].id)
    const record = (): CardClipRecord => recordOf(shown[2])!
    await until('the graphics step to end', () => ['done', 'skipped', 'failed'].includes(stepOf(record(), 'graphics')!.state))
    expect(analyses).toBe(0)
    expect(stepOf(record(), 'reframe')).toMatchObject({ state: 'skipped', text: STEP_TEXT.reframeNoHelper })
    expect(stepOf(record(), 'captions')).toMatchObject({ state: 'done', text: STEP_TEXT.captionsOn })
    expect(stepOf(record(), 'graphics')?.state).toBe('done')
  })

  it('a face finder not on disk is named, never fetched: the crop stays centred', async () => {
    const mod = await import('../../src/renderer/src/harness/bridge')
    mod.harnessReframe.modelPresent = false
    const shown = await cards()
    open(empty16x9(), null)
    state().setReframeHelper('ready')
    await state().clipItFromCard(shown[0])
    await state().collectIngest(started[0].id)
    const record = (): CardClipRecord => recordOf(shown[0])!
    await until('the graphics step to end', () => ['done', 'skipped', 'failed'].includes(stepOf(record(), 'graphics')!.state))
    expect(mod.harnessReframe.modelPresent).toBe(false)
    expect(analyses).toBe(0)
    expect(stepOf(record(), 'reframe')).toMatchObject({ state: 'skipped', text: STEP_TEXT.reframeNoModel })
  })

  it('a download that finishes under another project lands nowhere, and every step says it was skipped', async () => {
    const shown = await cards()
    open(empty16x9(), '/projects/a.forge')
    await state().clipItFromCard(shown[0])
    open(empty16x9(), '/projects/b.forge')
    await state().collectIngest(started[0].id)
    const record = recordOf(shown[0])!
    expect(stepOf(record, 'download')).toMatchObject({ state: 'failed', text: STEP_TEXT.otherProject })
    for (const name of ['reframe', 'captions', 'graphics'] as const) expect(stepOf(record, name)).toMatchObject({ state: 'skipped', text: STEP_TEXT.notLanded })
    expect(state().project.clips).toEqual([])
  })
})

describe('M0’s Clip it from picked rows is as it was', () => {
  it('into a 16:9 edit: no question, no aspect change, and on landing ONE undo step and no step after it', async () => {
    await cards()
    open(edit16x9(), '/projects/edit.forge')
    state().setReframeHelper('ready')
    const crops = state().project.clips.map((c) => ({ id: c.id, crop: { ...c.crop! } }))
    state().setUrlRun(runFromRows(state().urlSource!.transcript!, 2, 5))
    await state().clipItFromLink()
    expect(state().bestClipsQuestion).toBeNull()
    expect(started).toHaveLength(1)
    expect(state().aspect).toBe('16:9')

    const depth = state().past.length
    await state().collectIngest(started[0].id)
    // Let anything chained run, were anything chained.
    await new Promise((r) => setTimeout(r, 120))
    expect(state().past.length - depth).toBe(1)
    expect(state().project.captions.enabled).toBe(false)
    expect(analyses).toBe(0)
    expect(completes).toBe(0)
    expect(state().lastGraphics).toBeNull()
    expect(state().bestClipsClipped).toEqual({})
    for (const { id, crop } of crops) expect(state().project.clips.find((c) => c.id === id)?.crop, id).toEqual(crop)
  })
})
