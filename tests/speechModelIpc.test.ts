import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { OPTIONAL_METHODS, SIDECAR_METHODS, type ModelStatus } from '../src/shared/sidecar/protocol'
import { HELPER_NOT_INSTALLED } from '../src/shared/sidecar/status'
import {
  SPEECH_MODEL_CHANNELS,
  SPEECH_MODEL_HOST,
  SPEECH_MODEL_LABEL,
  SPEECH_MODEL_METHOD,
  SPEECH_MODEL_REPO,
  SPEECH_MODEL_NOT_DOWNLOADED,
  speechModelLabel,
  speechModelRequest
} from '../src/shared/asr/speechModel'

/*
 * The speech model's press across the bridge (docs/CLIPS.md §3a.4, §16.49):
 * the preload's two calls on the channels main registers, and main's
 * `asr:model` handler — ipc.ts's registerIpc, run against an electron
 * stand-in whose ipcMain keeps each handler by channel, as
 * tests/sidecarService.test.ts runs it.
 *
 * The forwarding cases hand the handler a recording client in place of the
 * helper's (getSidecar, and only it, is stood in). The absent case is the
 * real service in a packaged app with no pack, where every spawn is recorded
 * and any spawn at all THROWS. The helper's own side of the press is
 * tests/sidecar/test_asr.py.
 */

const spawned = vi.hoisted(() => [] as string[])
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>()
  return {
    ...real,
    spawn: (command: string) => {
      spawned.push(command)
      throw new Error(`spawn is not allowed in this test: ${command}`)
    }
  }
})

const electron = vi.hoisted(() => ({
  userData: '',
  appPath: '',
  handlers: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
  sent: [] as { channel: string; payload: unknown }[],
  exposed: null as Record<string, (...args: unknown[]) => unknown> | null,
  invoked: [] as { channel: string; args: unknown[] }[],
  listening: [] as { channel: string; on: boolean }[]
}))
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getAppPath: () => electron.appPath,
    getPath: (name: string) => (name === 'userData' ? electron.userData : join(electron.userData, name)),
    getVersion: () => '0.1.0',
    runningUnderARM64Translation: false
  },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload?: unknown) => unknown) => electron.handlers.set(channel, handler),
    on: () => undefined,
    removeHandler: () => undefined
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: {},
  systemPreferences: {},
  contextBridge: {
    exposeInMainWorld: (_name: string, api: Record<string, (...args: unknown[]) => unknown>) => {
      electron.exposed = api
    }
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      electron.invoked.push({ channel, args })
      return Promise.resolve(undefined)
    },
    on: (channel: string) => electron.listening.push({ channel, on: true }),
    send: () => undefined,
    removeListener: (channel: string) => electron.listening.push({ channel, on: false })
  },
  webUtils: { getPathForFile: () => '' }
}))

/** The client getSidecar hands out while set; the real service's answer while null. */
const STUB = vi.hoisted(() => ({ client: null as null | { request: (method: string, params: unknown, options?: Record<string, unknown>) => Promise<unknown> } }))
vi.mock('../src/main/sidecar/service', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/sidecar/service')>()
  return { ...real, getSidecar: () => (STUB.client ?? real.getSidecar()) as ReturnType<typeof real.getSidecar> }
})

/** A machine the pack is built for; elsewhere the absent case reads "Not available on this computer" instead. */
const MACHINE = (process.platform === 'darwin' && process.arch === 'arm64') || (process.platform === 'win32' && process.arch === 'x64')

const STATUS: ModelStatus = { present: false, bytes: 486_212_372, label: SPEECH_MODEL_LABEL, host: SPEECH_MODEL_HOST }

interface Asked {
  method: string
  params: unknown
  options: Record<string, unknown>
}

/**
 * A client that records each request and answers it, reporting `progress`
 * first; `gated`, it answers only once `release` is called, so two presses
 * can be in flight together. Never gated by default: a request that should
 * not have been made then fails its assertion at once, not by timing out.
 */
function recording(o: { progress?: [number | null, string | undefined][]; gated?: boolean } = {}): { asked: Asked[]; release: () => void } {
  const asked: Asked[] = []
  let release: () => void = () => undefined
  const gate = o.gated ? new Promise<void>((r) => (release = r)) : Promise.resolve()
  STUB.client = {
    request: async (method, params, options = {}) => {
      asked.push({ method, params, options })
      const onProgress = options.onProgress as ((p: number | null, m?: string) => void) | undefined
      for (const [p, m] of o.progress ?? []) onProgress?.(p, m)
      await gate
      return { ...STATUS, present: (params as { download?: boolean }).download === true }
    }
  }
  return { asked, release }
}

const scratch: string[] = []
let restoreProcess: () => void = () => undefined

beforeEach(() => {
  vi.resetModules()
  spawned.length = 0
  electron.handlers.clear()
  electron.sent.length = 0
  electron.userData = mkdtempSync(join(tmpdir(), 'forge-speech-'))
  electron.appPath = mkdtempSync(join(tmpdir(), 'forge-speech-app-'))
  scratch.push(electron.userData, electron.appPath)
  STUB.client = null
  delete process.env.FORGE_PYTHON
  const p = process as unknown as { getSystemVersion?: () => string; resourcesPath?: string }
  const saved = { getSystemVersion: p.getSystemVersion, resourcesPath: p.resourcesPath }
  p.getSystemVersion = () => (process.platform === 'darwin' ? '15.0' : '10.0.22631')
  p.resourcesPath = join(electron.appPath, 'resources')
  restoreProcess = () => {
    p.getSystemVersion = saved.getSystemVersion
    p.resourcesPath = saved.resourcesPath
  }
})

afterEach(async () => {
  STUB.client = null
  await (await import('../src/main/sidecar/service')).stopSidecar()
  restoreProcess()
})

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

async function handler(): Promise<(payload?: unknown) => Promise<unknown>> {
  const { registerIpc } = await import('../src/main/ipc')
  const window = { webContents: { send: (channel: string, payload: unknown) => electron.sent.push({ channel, payload }) } }
  registerIpc(() => window as never)
  const handle = electron.handlers.get(SPEECH_MODEL_CHANNELS.model)
  if (!handle) throw new Error(`no handler for ${SPEECH_MODEL_CHANNELS.model}`)
  return async (payload?: unknown) => handle({}, payload)
}

describe('one name for one method', () => {
  it('SIDECAR_METHODS.asrModel is SPEECH_MODEL_METHOD, and an optional method', () => {
    expect(SIDECAR_METHODS.asrModel).toBe(SPEECH_MODEL_METHOD)
    expect(OPTIONAL_METHODS).toContain(SPEECH_MODEL_METHOD)
    expect(OPTIONAL_METHODS.filter((m) => m === SPEECH_MODEL_METHOD)).toHaveLength(1)
  })

  it("the helper's repo, label, host and method are these, each written once in asr.py", () => {
    const asr = readFileSync(resolve(__dirname, '..', 'sidecar', 'forge_sidecar', 'capabilities', 'asr.py'), 'utf8')
    const one = (pattern: RegExp): string => {
      const hits = [...asr.matchAll(pattern)]
      expect(hits, String(pattern)).toHaveLength(1)
      return hits[0][1]
    }
    expect(one(/^MODEL_REPO = "([^"]+)"$/gm)).toBe(SPEECH_MODEL_REPO)
    expect(one(/^MODEL_LABEL = "([^"]+)"$/gm)).toBe(SPEECH_MODEL_LABEL)
    expect(one(/^MODEL_HOST = "([^"]+)"$/gm)).toBe(SPEECH_MODEL_HOST)
    // The sentence a Transcribe without the model rejects with, which the store listens for: written once, raised once.
    expect(one(/^NOT_DOWNLOADED = "([^"]+)"$/gm)).toBe(SPEECH_MODEL_NOT_DOWNLOADED)
    expect([...asr.matchAll(/raise Unavailable\(NOT_DOWNLOADED\)/g)]).toHaveLength(1)
    // Every register site in the file, not the first: the model's is one of two.
    const registered = [...asr.matchAll(/server\.register\("([^"]+)"/g)].map((m) => m[1])
    expect(registered).toContain(SPEECH_MODEL_METHOD)
    expect(registered).toContain(SIDECAR_METHODS.transcribe)
  })

  it("the press's label is the status's bytes through formatBytes", () => {
    expect(speechModelLabel(STATUS)).toBe('Get the speech model · 464 MB')
    expect(speechModelLabel({ bytes: 1_048_576 * 10 })).toBe('Get the speech model · 10 MB')
  })
})

describe('the payload main accepts', () => {
  it('nothing or {download?: boolean}; download only when exactly true', () => {
    expect(speechModelRequest(undefined)).toEqual({ download: false })
    expect(speechModelRequest(null)).toEqual({ download: false })
    expect(speechModelRequest({})).toEqual({ download: false })
    expect(speechModelRequest({ download: false })).toEqual({ download: false })
    expect(speechModelRequest({ download: true })).toEqual({ download: true })
  })

  it('refuses anything else rather than reading it as a status ask', () => {
    for (const bad of ['yes', 1, true, [], { download: 'true' }, { download: 1 }]) {
      expect(() => speechModelRequest(bad), JSON.stringify(bad)).toThrow(/Getting the speech model expects/)
    }
  })
})

describe('asr:model in main', () => {
  it('a status ask forwards no download, and answers the helper’s status', async () => {
    const { asked } = recording()
    const call = await handler()
    expect(await call({})).toEqual(STATUS)
    expect(await call()).toEqual(STATUS)
    expect(await call({ download: false })).toEqual(STATUS)
    expect(asked.map((a) => [a.method, a.params])).toEqual([
      [SIDECAR_METHODS.asrModel, {}],
      [SIDECAR_METHODS.asrModel, {}],
      [SIDECAR_METHODS.asrModel, {}]
    ])
    expect(asked.every((a) => a.options.onProgress === undefined)).toBe(true)
  })

  it('the press forwards download: true, and its progress reaches the window on the progress channel', async () => {
    const { asked } = recording({
      progress: [
        [null, 'downloading the speech model (first run only)'],
        [0.25, 'downloading the speech model (484 MB, first run only)'],
        [1, undefined]
      ]
    })
    const call = await handler()
    expect(await call({ download: true })).toEqual({ ...STATUS, present: true })
    expect(asked.map((a) => [a.method, a.params])).toEqual([[SIDECAR_METHODS.asrModel, { download: true }]])
    expect(asked[0].options.timeoutMs).toBeUndefined()
    expect(electron.sent).toEqual([
      { channel: SPEECH_MODEL_CHANNELS.progress, payload: { progress: null, message: 'downloading the speech model (first run only)' } },
      { channel: SPEECH_MODEL_CHANNELS.progress, payload: { progress: 0.25, message: 'downloading the speech model (484 MB, first run only)' } },
      { channel: SPEECH_MODEL_CHANNELS.progress, payload: { progress: 1 } }
    ])
  })

  it('two presses at once are one fetch; a press after it ends is a new one', async () => {
    const { asked, release } = recording({ gated: true })
    const call = await handler()
    const first = call({ download: true })
    const second = call({ download: true })
    release()
    expect(await Promise.all([first, second])).toEqual([{ ...STATUS, present: true }, { ...STATUS, present: true }])
    expect(asked).toHaveLength(1)
    await call({ download: true })
    expect(asked).toHaveLength(2)
  })

  it('a payload it refuses asks the helper nothing', async () => {
    const { asked } = recording()
    const call = await handler()
    await expect(call({ download: 'true' })).rejects.toThrow(/Getting the speech model expects/)
    expect(asked).toEqual([])
  })

  it.skipIf(!MACHINE)('with no helper (a packaged app, no pack) it rejects with the sentence, and nothing is spawned', async () => {
    STUB.client = null
    const call = await handler()
    await expect(call({})).rejects.toThrow(HELPER_NOT_INSTALLED)
    await expect(call({ download: true })).rejects.toThrow(HELPER_NOT_INSTALLED)
    expect(spawned).toEqual([])
  })
})

describe('the preload', () => {
  it('invokes asr:model with the payload, {} by default, and listens on the progress channel', async () => {
    electron.invoked.length = 0
    electron.listening.length = 0
    await import('../src/preload/index')
    const api = electron.exposed!
    expect(api).toBeTruthy()
    await api.speechModel()
    await api.speechModel({ download: true })
    expect(electron.invoked).toEqual([
      { channel: SPEECH_MODEL_CHANNELS.model, args: [{}] },
      { channel: SPEECH_MODEL_CHANNELS.model, args: [{ download: true }] }
    ])
    const stop = api.onSpeechModelProgress(() => undefined) as () => void
    stop()
    expect(electron.listening).toEqual([
      { channel: SPEECH_MODEL_CHANNELS.progress, on: true },
      { channel: SPEECH_MODEL_CHANNELS.progress, on: false }
    ])
  })
})
