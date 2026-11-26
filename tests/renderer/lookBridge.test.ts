import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyProject } from '@shared/timeline'
import {
  LOOK_CHANNELS,
  LOOK_EXPORT_FAILED,
  LOOK_FILE_MAX_BYTES,
  LOOK_NEWER,
  LOOK_TOO_LARGE,
  LOOK_UNREADABLE,
  lookFromProject,
  serializeLook,
  type Look,
  type LookRead
} from '@shared/look'

/*
 * A look's file across the three bridges (docs/CLIPS.md §10): the preload's
 * two calls on the channels main registers (tests/lookIpc.test.ts is main's
 * side); the harness bridge's in-memory file, which reads whatever text a
 * driving script puts there through main's own checks; and the fallback
 * bridge, whose two calls refuse with its one sentence. The objects are the
 * real ones, as tests/renderer/bridgeMethods.test.ts reads them.
 */

const ipc = vi.hoisted(() => ({
  exposed: null as Record<string, unknown> | null,
  invoked: [] as { channel: string; args: unknown[] }[]
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
      return Promise.resolve(null)
    },
    send: () => undefined,
    on: () => undefined,
    removeListener: () => undefined
  },
  webUtils: { getPathForFile: () => '' }
}))

interface LookCalls {
  exportLook: (look: Look) => Promise<string | null>
  importLook: () => Promise<LookRead | null>
}

interface HarnessFile {
  text: string | null
  name: string
  writes: number
  cancel: boolean
  failWrite: boolean
  put: (text: string) => void
  reset: () => void
}

let preload: LookCalls
let harness: LookCalls
let file: HarnessFile

const LOOK = lookFromProject(
  { ...emptyProject(), captions: { enabled: true, styleId: 'kinetic', overrides: { fontSize: 70 } }, graphics: { styleId: 'neon', sound: true } },
  { name: 'Bride 5:30pm', author: 'Ana' }
)

beforeAll(async () => {
  await import('../../src/preload/index')
  if (!ipc.exposed) throw new Error('the preload exposed nothing')
  preload = ipc.exposed as unknown as LookCalls

  vi.stubGlobal('window', {})
  const { installHarnessBridge } = await import('../../src/renderer/src/harness/bridge')
  installHarnessBridge()
  harness = (window as unknown as { forge: LookCalls }).forge
  file = (window as unknown as { __forgeLookFile: HarnessFile }).__forgeLookFile
})

beforeEach(() => {
  ipc.invoked.length = 0
  file.reset()
})

describe('the preload’s look calls', () => {
  it('invoke the two channels main registers, export with the look and import with nothing', async () => {
    await preload.exportLook(LOOK)
    await preload.importLook()
    expect(ipc.invoked).toEqual([
      { channel: LOOK_CHANNELS.export, args: [LOOK] },
      { channel: LOOK_CHANNELS.import, args: [] }
    ])
  })
})

describe('the harness bridge’s look file', () => {
  it('an export writes the look’s text and a Windows-safe name; an import reads it back', async () => {
    expect(await harness.exportLook(LOOK)).toBe('Bride 530pm.forgelook')
    expect(file.text).toBe(serializeLook(LOOK))
    expect(file.writes).toBe(1)
    expect(await harness.importLook()).toStrictEqual({ ok: true, look: LOOK, notes: [] })
  })

  it('no file, or Cancel, is null', async () => {
    expect(await harness.importLook()).toBeNull()
    file.cancel = true
    expect(await harness.exportLook(LOOK)).toBeNull()
    expect(file.writes).toBe(0)
    file.put(serializeLook(LOOK))
    expect(await harness.importLook()).toBeNull()
  })

  it('failWrite plays main’s failed write: the export throws main’s sentence and writes nothing; reset clears it', async () => {
    file.failWrite = true
    await expect(harness.exportLook(LOOK)).rejects.toThrow(LOOK_EXPORT_FAILED)
    expect(file.writes).toBe(0)
    expect(file.text).toBeNull()
    file.reset()
    expect(file.failWrite).toBe(false)
    expect(await harness.exportLook(LOOK)).toBe('Bride 530pm.forgelook')
  })

  it('any text put there is tried as main tries a file: too large, not a look’s, newer', async () => {
    file.put(`{"pad":"${'z'.repeat(LOOK_FILE_MAX_BYTES)}"}`)
    expect(await harness.importLook()).toStrictEqual({ ok: false, reason: LOOK_TOO_LARGE })
    file.put('SECRET not a look')
    expect(await harness.importLook()).toStrictEqual({ ok: false, reason: LOOK_UNREADABLE })
    file.put(serializeLook(LOOK).replace('"schema": 1', '"schema": 2'))
    expect(await harness.importLook()).toStrictEqual({ ok: false, reason: LOOK_NEWER })
  })
})

describe('the fallback bridge’s look calls', () => {
  it('exist, and refuse with the bridge’s one sentence', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('queueMicrotask', () => undefined)
    const { installFallbackBridge, BRIDGE_DID_NOT_LOAD } = await import('../../src/renderer/src/fallbackBridge')
    installFallbackBridge()
    const fallback = (window as unknown as { forge: Record<string, unknown> }).forge
    for (const name of ['exportLook', 'importLook']) {
      expect(typeof fallback[name], name).toBe('function')
      expect(() => (fallback[name] as () => unknown)(), name).toThrow(BRIDGE_DID_NOT_LOAD)
    }
  })
})
