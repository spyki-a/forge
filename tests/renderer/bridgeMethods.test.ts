import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { REFRAME_CHANNELS, REFRAME_PRESET, type ReframeAnalyseRequest, type ReframeCollectResult } from '@shared/reframe/job'
import { cropPath } from '@shared/reframe/path'
import type { Job } from '@shared/types'

/*
 * The harness bridge carries every method the preload exposes (docs/CLIPS.md
 * §4.7: "the bridge is cast `as unknown as Window['forge']`, so typecheck
 * will not catch a missing one").
 *
 * Both objects are the REAL ones, not a text scan of either file: the preload
 * is evaluated with `electron` stood in, and what it hands `exposeInMainWorld`
 * is the api; the bridge is installed on a bare `window`. A method the preload
 * gains and the bridge lacks is a harness page that throws "not a function"
 * at whatever first calls it — on 2026-10-13 that was `relinkAssets`.
 *
 * In tests/renderer because the bridge is renderer code: the node tsconfig
 * excludes this folder, the web one includes it (and already reaches the
 * preload through index.d.ts).
 */

const ipc = vi.hoisted(() => ({
  exposed: null as Record<string, unknown> | null,
  invoked: [] as { channel: string; args: unknown[] }[],
  on: [] as string[]
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: Record<string, unknown>) => {
      ipc.exposed = api
    }
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      ipc.invoked.push({ channel, args })
      return Promise.resolve(undefined)
    },
    send: () => undefined,
    on: (channel: string) => {
      ipc.on.push(channel)
    },
    removeListener: () => undefined
  },
  webUtils: { getPathForFile: () => '' }
}))

type Bridge = Record<string, unknown> & {
  analyseSubjects: (request: ReframeAnalyseRequest) => Promise<Job>
  collectSubjects: (jobId: string) => Promise<ReframeCollectResult>
  onJobsChanged: (cb: (jobs: Job[]) => void) => () => void
}

let preload: Record<string, unknown>
let bridge: Bridge
let harness: { modelPresent: boolean; stageMs: number; jobs: unknown[] }

beforeAll(async () => {
  await import('../../src/preload/index')
  if (!ipc.exposed) throw new Error('the preload exposed nothing')
  preload = ipc.exposed

  vi.stubGlobal('window', {})
  const { installHarnessBridge, harnessReframe } = await import('../../src/renderer/src/harness/bridge')
  installHarnessBridge()
  bridge = (window as unknown as { forge: Bridge }).forge
  harness = harnessReframe
})

afterEach(() => {
  ipc.invoked.length = 0
})

describe('the harness bridge', () => {
  it('has every method the preload exposes', () => {
    const names = Object.keys(preload)
    // The api really was read: it holds the methods every page calls first.
    expect(names).toEqual(expect.arrayContaining(['probe', 'listJobs', 'onJobsChanged', 'analyseSubjects']))
    const missing = names.filter((name) => typeof bridge[name] !== 'function')
    expect(missing).toEqual([])
  })
})

describe("the preload's reframe methods", () => {
  const request: ReframeAnalyseRequest = {
    assetId: 'a1',
    path: '/media/Bride 5:30pm.mp4',
    width: 1920,
    height: 1080,
    name: 'Bride 5:30pm',
    clipIds: ['c1']
  }

  it('invoke the channels shared/reframe/job.ts names, with the payload main validates', async () => {
    const api = preload as unknown as Bridge & { faceModel: (r?: { download?: boolean }) => Promise<unknown> }
    await api.analyseSubjects(request)
    await api.collectSubjects('job-7')
    await api.faceModel()
    await api.faceModel({ download: true })
    expect(ipc.invoked).toEqual([
      { channel: REFRAME_CHANNELS.analyse, args: [request] },
      { channel: REFRAME_CHANNELS.collect, args: [{ jobId: 'job-7' }] },
      { channel: REFRAME_CHANNELS.faceModel, args: [{}] },
      { channel: REFRAME_CHANNELS.faceModel, args: [{ download: true }] }
    ])
  })

  it('listens for the face finder’s download on its channel', () => {
    const api = preload as unknown as { onFaceModelProgress: (cb: () => void) => () => void }
    api.onFaceModelProgress(() => undefined)
    expect(ipc.on).toContain(REFRAME_CHANNELS.faceModelProgress)
  })
})

describe("the bridge's reframe stub (§4.9)", () => {
  const PATH = 'blob:harness/clip'
  const ask = (clipIds = ['c1']): ReframeAnalyseRequest => ({
    assetId: 'a1',
    path: PATH,
    width: 640,
    height: 360,
    name: 'clip 4.webm',
    clipIds
  })

  /** Resolves with the job's last broadcast once it is no longer queued or running. */
  function settled(id: string): Promise<Job> {
    return new Promise((resolve) => {
      const stop = bridge.onJobsChanged((jobs) => {
        const job = jobs.find((j) => j.id === id)
        if (job && job.status !== 'queued' && job.status !== 'running') {
          stop()
          resolve(job)
        }
      })
    })
  }

  it('fails a job asked before the face finder is on disk, with the typed reason', async () => {
    harness.stageMs = 0
    harness.modelPresent = false
    const job = await bridge.analyseSubjects(ask())
    expect(job).toMatchObject({ presetId: REFRAME_PRESET, status: 'queued', params: { assetId: 'a1' } })
    expect((await settled(job.id)).status).toBe('failed')
    expect(await bridge.collectSubjects(job.id)).toMatchObject({ kind: 'failed', reason: 'model-missing' })
  })

  it('hands the track back once, echoing the clips, keyed as the harness keys the file', async () => {
    harness.stageMs = 0
    harness.modelPresent = true
    const job = await bridge.analyseSubjects(ask(['c1', 'c2']))
    expect((await settled(job.id)).status).toBe('done')
    const first = await bridge.collectSubjects(job.id)
    if (first.kind !== 'track') throw new Error(`expected a track, got ${first.kind}`)
    expect(first.clipIds).toEqual(['c1', 'c2'])
    expect(first.track.key).toBe(`harness:${PATH}`)
    expect(first.track.shots.map((s) => s.startMs)).toEqual([0, 2000, 4000])
    expect(await bridge.collectSubjects(job.id)).toEqual({ kind: 'already' })
  })

  it("gives a 9:16 canvas one face per shot, then a two-up — the check's three shots", async () => {
    const { harnessSubjectTrack } = await import('../../src/renderer/src/harness/reframeStub')
    const track = harnessSubjectTrack({ key: 'harness:x', width: 640, height: 360, durationMs: 6000 })
    const path = cropPath(track, { width: 1080, height: 1920 })
    expect(path.size.width).toBeLessThanOrEqual(204)
    expect(path.shots.map((s) => s.why)).toEqual(['face', 'face', 'two-up'])
    // The single crops sit on their faces: centres 160 and 480 px of 640.
    const centre = (at: number): number => at + path.size.width / 2
    expect(Math.abs(centre(path.shots[0].at) - 160)).toBeLessThanOrEqual(2)
    expect(Math.abs(centre(path.shots[1].at) - 480)).toBeLessThanOrEqual(2)
    // The stack: the left face on top.
    const halves = path.shots[2].halves!
    expect(halves.top.x).toBeLessThan(halves.bottom.x)
  })
})
