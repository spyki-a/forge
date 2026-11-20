import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { OPTIONAL_METHODS, SIDECAR_METHODS, type ModelStatus } from '../src/shared/sidecar/protocol'
import { HELPER_NOT_INSTALLED } from '../src/shared/sidecar/status'
import {
  SPEECH_MODEL_CHANNELS,
  SPEECH_MODEL_HOST,
  SPEECH_MODEL_LABEL,
  SPEECH_MODEL_BUSY,
  SPEECH_MODEL_METHOD,
  SPEECH_MODEL_NOT_DOWNLOADED,
  SPEECH_MODEL_SETTING,
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

/** Small's status, as asr.py answers it (with its model). */
const SMALL = { ...STATUS, model: 'small' }

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
      // As the real client: an aborted signal sends the helper a cancel, and the request rejects "Cancelled".
      const signal = options.signal as AbortSignal | undefined
      await Promise.race([
        gate,
        new Promise<never>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }))
      ])
      const sent = params as { download?: boolean; model?: string }
      return { ...STATUS, present: sent.download === true, model: sent.model }
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

  it("the helper's label, host and method are these, each written once in asr.py", () => {
    const asr = readFileSync(resolve(__dirname, '..', 'sidecar', 'forge_sidecar', 'capabilities', 'asr.py'), 'utf8')
    const one = (pattern: RegExp): string => {
      const hits = [...asr.matchAll(pattern)]
      expect(hits, String(pattern)).toHaveLength(1)
      return hits[0][1]
    }
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
    expect(await call({})).toEqual(SMALL)
    expect(await call()).toEqual(SMALL)
    expect(await call({ download: false })).toEqual(SMALL)
    // No choice in the settings file: each ask names small.
    expect(asked.map((a) => [a.method, a.params])).toEqual([
      [SIDECAR_METHODS.asrModel, { model: 'small' }],
      [SIDECAR_METHODS.asrModel, { model: 'small' }],
      [SIDECAR_METHODS.asrModel, { model: 'small' }]
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
    expect(await call({ download: true })).toEqual({ ...SMALL, present: true })
    expect(asked.map((a) => [a.method, a.params])).toEqual([[SIDECAR_METHODS.asrModel, { model: 'small', download: true }]])
    expect(asked[0].options.timeoutMs).toBeUndefined()
    expect(electron.sent).toEqual([
      { channel: SPEECH_MODEL_CHANNELS.progress, payload: { progress: null, message: 'downloading the speech model (first run only)', model: 'small' } },
      { channel: SPEECH_MODEL_CHANNELS.progress, payload: { progress: 0.25, message: 'downloading the speech model (484 MB, first run only)', model: 'small' } },
      { channel: SPEECH_MODEL_CHANNELS.progress, payload: { progress: 1, model: 'small' } }
    ])
  })

  it('two presses at once are one fetch; a press after it ends is a new one', async () => {
    const { asked, release } = recording({ gated: true })
    const call = await handler()
    const first = call({ download: true })
    const second = call({ download: true })
    release()
    expect(await Promise.all([first, second])).toEqual([{ ...SMALL, present: true }, { ...SMALL, present: true }])
    expect(asked).toHaveLength(1)
    await call({ download: true })
    expect(asked).toHaveLength(2)
  })

  it('the press’s X cancels the fetch every waiting press shares; a press after it is a new fetch; an X with none running does nothing', async () => {
    const { asked } = recording({ gated: true })
    const call = await handler()
    const cancel = electron.handlers.get(SPEECH_MODEL_CHANNELS.cancel)
    expect(cancel, `no handler for ${SPEECH_MODEL_CHANNELS.cancel}`).toBeTruthy()
    // Nothing running: nothing to cancel, nothing asked.
    expect(() => cancel!({})).not.toThrow()
    const first = call({ download: true })
    const second = call({ download: true })
    await Promise.resolve()
    expect(asked).toHaveLength(1)
    const signal = asked[0].options.signal as AbortSignal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
    cancel!({})
    expect(signal.aborted).toBe(true)
    await expect(first).rejects.toThrow('Cancelled')
    await expect(second).rejects.toThrow('Cancelled')
    // The fetch is over: the next press asks the helper again, with a signal of its own.
    const third = call({ download: true })
    await Promise.resolve()
    expect(asked).toHaveLength(2)
    expect((asked[1].options.signal as AbortSignal).aborted).toBe(false)
    cancel!({})
    await expect(third).rejects.toThrow('Cancelled')
    // A status ask is never cancelled by it.
    expect(asked.filter((a) => (a.params as { download?: boolean }).download !== true)).toEqual([])
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

/** registerIpc against the stand-in, and the handler on `channel`. */
async function on(channel: string): Promise<(payload?: unknown) => Promise<unknown>> {
  const { registerIpc } = await import('../src/main/ipc')
  const window = { webContents: { send: (c: string, payload: unknown) => electron.sent.push({ channel: c, payload }) } }
  registerIpc(() => window as never)
  const handle = electron.handlers.get(channel)
  if (!handle) throw new Error(`no handler for ${channel}`)
  return async (payload?: unknown) => handle({}, payload)
}

/** Fake secrets that must never reach the window. */
const KEYS = { openai: 'sk-test-director-0000', voice: 'sk-test-voice-1111' }

/** The app's settings file, as main/store.ts reads it from userData, with the hosted keys in it. */
function settingsFile(extra: Record<string, unknown>): void {
  writeFileSync(
    join(electron.userData, 'settings.json'),
    JSON.stringify({
      voiceHosted: { baseUrl: 'https://voice.invalid', model: 'tts-1', voice: 'alloy', apiKey: KEYS.voice },
      director: { provider: 'openai', ollama: { baseUrl: '', model: '' }, openai: { baseUrl: 'https://llm.invalid', model: 'm', apiKey: KEYS.openai } },
      ...extra
    }),
    'utf8'
  )
}

describe('the choice of three', () => {
  it('main asks after the chosen model when none is named, and after the named one when one is', async () => {
    settingsFile({ [SPEECH_MODEL_SETTING]: 'medium' })
    const { asked } = recording()
    const call = await handler()
    expect(await call({})).toEqual({ ...STATUS, model: 'medium' })
    expect(await call({ model: 'large-v3' })).toEqual({ ...STATUS, model: 'large-v3' })
    expect(await call({ model: 'small' })).toEqual({ ...STATUS, model: 'small' })
    expect(asked.map((a) => a.params)).toEqual([{ model: 'medium' }, { model: 'large-v3' }, { model: 'small' }])
  })

  it('an unknown value in the settings file is read as small', async () => {
    for (const value of ['large', 'tiny', 3, null, { name: 'medium' }]) {
      vi.resetModules()
      electron.handlers.clear()
      settingsFile({ [SPEECH_MODEL_SETTING]: value })
      const { asked } = recording()
      const call = await handler()
      await call({})
      expect(asked.map((a) => a.params), JSON.stringify(value)).toEqual([{ model: 'small' }])
    }
  })

  it('the press for a named model fetches that one, and its progress names it', async () => {
    settingsFile({ [SPEECH_MODEL_SETTING]: 'small' })
    const { asked } = recording({ progress: [[0.5, 'downloading the speech model']] })
    const call = await handler()
    expect(await call({ download: true, model: 'large-v3' })).toEqual({ ...STATUS, present: true, model: 'large-v3' })
    expect(asked.map((a) => a.params)).toEqual([{ model: 'large-v3', download: true }])
    expect(electron.sent).toEqual([{ channel: SPEECH_MODEL_CHANNELS.progress, payload: { progress: 0.5, message: 'downloading the speech model', model: 'large-v3' } }])
  })

  it('one fetch at a time: a press for another model while one runs is refused and asks nothing; the same model shares it', async () => {
    const { asked, release } = recording({ gated: true })
    const call = await handler()
    const first = call({ download: true, model: 'medium' })
    // Settled to words without waiting on the gate, so a press that wrongly
    // joins medium's fetch fails here at once rather than hanging the test.
    const outcome = (p: Promise<unknown>): Promise<string> =>
      p.then(
        (value) => `resolved ${JSON.stringify(value)}`,
        (err: Error) => err.message
      )
    const another = outcome(call({ download: true, model: 'large-v3' }))
    // No model named: the chosen one, small here, is another model too.
    const chosen = outcome(call({ download: true }))
    const same = call({ download: true, model: 'medium' })
    // A status ask is still answered while it runs.
    const status = call({ model: 'large-v3' })
    expect(asked.map((a) => a.params)).toEqual([{ model: 'medium', download: true }, { model: 'large-v3' }])
    release()
    expect(await another).toBe(SPEECH_MODEL_BUSY)
    expect(await chosen).toBe(SPEECH_MODEL_BUSY)
    expect(await first).toEqual({ ...STATUS, present: true, model: 'medium' })
    expect(await same).toEqual({ ...STATUS, present: true, model: 'medium' })
    await status
    // Over: another model's press is a fetch of its own.
    await call({ download: true, model: 'large-v3' })
    expect(asked.map((a) => a.params).at(-1)).toEqual({ model: 'large-v3', download: true })
  })

  it('an unknown model in the payload is refused by its name and asks the helper nothing', async () => {
    const { asked } = recording()
    const call = await handler()
    for (const bad of ['tiny', 'large', 'Large', 3]) {
      await expect(call({ model: bad })).rejects.toThrow(`not ${JSON.stringify(bad)}`)
      await expect(call({ model: bad, download: true })).rejects.toThrow(/Getting the speech model expects one of small, medium, large-v3/)
    }
    expect(asked).toEqual([])
  })

  it('speechModelRequest keeps a named model and leaves an omitted one omitted', () => {
    expect(speechModelRequest({ model: 'medium' })).toEqual({ download: false, model: 'medium' })
    expect(speechModelRequest({ model: 'large-v3', download: true })).toEqual({ download: true, model: 'large-v3' })
    expect(speechModelRequest({ download: true })).toEqual({ download: true })
    expect('model' in speechModelRequest({ download: true })).toBe(false)
  })

  it('asr:transcribe sends the chosen model, small when none is chosen, whatever the window sends', async () => {
    const words = { language: 'en', durationMs: 1000, model: 'faster-whisper/medium/int8', words: [] }
    const asked: Asked[] = []
    STUB.client = {
      request: async (method, params, options = {}) => {
        asked.push({ method, params, options })
        return words
      }
    }
    let transcribe = await on('asr:transcribe')
    await transcribe({ assetId: 'a', path: '/x.wav' })
    await transcribe({ assetId: 'b', path: '/x.wav', model: 'large-v3' })
    vi.resetModules()
    electron.handlers.clear()
    settingsFile({ [SPEECH_MODEL_SETTING]: 'medium' })
    transcribe = await on('asr:transcribe')
    const transcript = (await transcribe({ assetId: 'c', path: '/x.wav', model: 'small' })) as { model: string }
    expect(asked.map((a) => [a.method, (a.params as { model?: string }).model])).toEqual([
      [SIDECAR_METHODS.transcribe, 'small'],
      [SIDECAR_METHODS.transcribe, 'small'],
      [SIDECAR_METHODS.transcribe, 'medium']
    ])
    // The transcript's model string is the helper's, size and all.
    expect(transcript.model).toBe('faster-whisper/medium/int8')
  })

  it('a choice the window writes is the one main uses next; an unknown one is refused and not written', async () => {
    settingsFile({})
    const { asked } = recording()
    const set = await on('settings:set')
    const call = await handler()
    await call({})
    await set({ key: SPEECH_MODEL_SETTING, value: 'large-v3' })
    await call({})
    await expect(set({ key: SPEECH_MODEL_SETTING, value: 'huge' })).rejects.toThrow('There is no speech model "huge"')
    await call({})
    expect(asked.map((a) => a.params)).toEqual([{ model: 'small' }, { model: 'large-v3' }, { model: 'large-v3' }])
    const file = JSON.parse(readFileSync(join(electron.userData, 'settings.json'), 'utf8')) as Record<string, unknown>
    expect(file[SPEECH_MODEL_SETTING]).toBe('large-v3')
  })

  it('the window reads the choice through settings:get, and never a hosted key with it', async () => {
    settingsFile({ [SPEECH_MODEL_SETTING]: 'medium' })
    const get = await on('settings:get')
    const set = await on('settings:set')
    const read = await get()
    expect(read).toMatchObject({ [SPEECH_MODEL_SETTING]: 'medium' })
    const written = await set({ key: SPEECH_MODEL_SETTING, value: 'small' })
    expect(written).toMatchObject({ [SPEECH_MODEL_SETTING]: 'small' })
    for (const answer of [read, written, await get()]) {
      const text = JSON.stringify(answer)
      expect(text).not.toContain(KEYS.openai)
      expect(text).not.toContain(KEYS.voice)
      expect(text).not.toContain('apiKey')
    }
    // And no progress or status the window is sent carries one either.
    recording({ progress: [[0.1, 'downloading the speech model']] })
    const call = await handler()
    const status = await call({ download: true })
    expect(JSON.stringify([status, electron.sent])).not.toMatch(new RegExp(`${KEYS.openai}|${KEYS.voice}|apiKey`))
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
    await api.speechModel({ model: 'medium' })
    await api.cancelSpeechModel()
    expect(electron.invoked).toEqual([
      { channel: SPEECH_MODEL_CHANNELS.model, args: [{}] },
      { channel: SPEECH_MODEL_CHANNELS.model, args: [{ download: true }] },
      { channel: SPEECH_MODEL_CHANNELS.model, args: [{ model: 'medium' }] },
      { channel: SPEECH_MODEL_CHANNELS.cancel, args: [] }
    ])
    const stop = api.onSpeechModelProgress(() => undefined) as () => void
    stop()
    expect(electron.listening).toEqual([
      { channel: SPEECH_MODEL_CHANNELS.progress, on: true },
      { channel: SPEECH_MODEL_CHANNELS.progress, on: false }
    ])
  })
})
