import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { emptyProject } from '../src/shared/timeline'
import {
  LOOK_CHANNELS,
  LOOK_EXPORT_FAILED,
  LOOK_FILE_MAX_BYTES,
  LOOK_NOT_A_LOOK,
  LOOK_TOO_LARGE,
  LOOK_UNREADABLE,
  lookFromProject,
  serializeLook,
  type LookRead
} from '../src/shared/look'

/*
 * Main's two look handlers (docs/CLIPS.md §10; src/main/ipc.ts), run through
 * registerIpc against an electron stand-in whose ipcMain keeps each handler
 * by channel and whose dialogs answer what each case sets, as
 * tests/speechModelIpc.test.ts runs main. The files are real, in a scratch
 * folder; `node:fs/promises` is the real one with its reads RECORDED, so the
 * size cap can be shown to come before any read.
 */

const electron = vi.hoisted(() => ({
  userData: '',
  handlers: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
  save: null as null | { canceled: boolean; filePath?: string },
  open: null as null | { canceled: boolean; filePaths: string[] },
  saveOptions: [] as { defaultPath?: string; filters?: unknown }[]
}))

const reads = vi.hoisted(() => [] as string[])
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    readFile: ((path: unknown, ...rest: unknown[]) => {
      reads.push(String(path))
      return (real.readFile as (...a: unknown[]) => unknown)(path, ...rest)
    }) as typeof real.readFile
  }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => electron.userData,
    getPath: (name: string) => (name === 'userData' ? electron.userData : join(electron.userData, name)),
    getVersion: () => '0.1.0',
    addRecentDocument: () => undefined
  },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload?: unknown) => unknown) => electron.handlers.set(channel, handler),
    on: () => undefined,
    removeHandler: () => undefined
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {
    showSaveDialog: async (_w: unknown, options: { defaultPath?: string; filters?: unknown }) => {
      electron.saveOptions.push(options)
      return electron.save
    },
    showOpenDialog: async () => electron.open
  },
  shell: {},
  systemPreferences: {}
}))

const scratch: string[] = []
let dir = ''

beforeEach(() => {
  vi.resetModules()
  electron.handlers.clear()
  electron.saveOptions.length = 0
  electron.save = null
  electron.open = null
  reads.length = 0
  electron.userData = mkdtempSync(join(tmpdir(), 'forge-look-ipc-'))
  dir = electron.userData
  scratch.push(dir)
})

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true })
})

async function handler(channel: string): Promise<(payload?: unknown) => Promise<unknown>> {
  const { registerIpc } = await import('../src/main/ipc')
  registerIpc(() => ({ webContents: { send: () => undefined } }) as never)
  const handle = electron.handlers.get(channel)
  if (!handle) throw new Error(`no handler for ${channel}`)
  return async (payload?: unknown) => handle({}, payload)
}

const LOOK = lookFromProject(
  { ...emptyProject(), captions: { enabled: true, styleId: 'clean', overrides: { fontSize: 70 } }, graphics: { styleId: 'neon', sound: true } },
  { name: 'Bride 5:30pm', author: 'Ana' }
)

describe('look:export', () => {
  it('offers a Windows-safe default name with its own extension, and writes the look’s text with a final newline', async () => {
    const target = join(dir, 'Studio.forgelook')
    electron.save = { canceled: false, filePath: target }
    const answer = await (await handler(LOOK_CHANNELS.export))(LOOK)
    // The file's name back, never its folder.
    expect(answer).toBe('Studio.forgelook')
    const offered = electron.saveOptions[0].defaultPath!
    expect(basename(offered)).toBe('Bride 530pm.forgelook')
    expect(basename(offered)).not.toMatch(/[<>:"|?*]/)
    expect(electron.saveOptions[0].filters).toEqual([{ name: 'Look', extensions: ['forgelook'] }])
    expect(readFileSync(target, 'utf8')).toBe(serializeLook(LOOK))
  })

  it('writes only a look’s own fields, whatever the window sent', async () => {
    const target = join(dir, 'Carrying.forgelook')
    electron.save = { canceled: false, filePath: target }
    await (await handler(LOOK_CHANNELS.export))({
      ...LOOK,
      path: '/Users/me/project.forge',
      apiKey: 'sk-live-1',
      // Inside the overrides too, where a look's own writer copies what it is given: main reads it as a stranger's first.
      captions: { ...LOOK.captions, overrides: { ...LOOK.captions.overrides, token: 'sk-live-2', wordsPerLine: 'huge' } }
    })
    const text = readFileSync(target, 'utf8')
    expect(text).toBe(serializeLook(LOOK))
    expect(text).not.toMatch(/sk-live|project\.forge|huge/)
  })

  it('a cancelled dialog is null and writes nothing', async () => {
    electron.save = { canceled: true }
    expect(await (await handler(LOOK_CHANNELS.export))(LOOK)).toBeNull()
  })

  it('refuses a payload that is not a look, before any dialog', async () => {
    await expect((await handler(LOOK_CHANNELS.export))({ kind: 'nope' })).rejects.toThrow(LOOK_NOT_A_LOOK)
    expect(electron.saveOptions).toEqual([])
  })

  it('a write that fails says the plain reason', async () => {
    electron.save = { canceled: false, filePath: join(dir, 'no-such-folder', 'x.forgelook') }
    await expect((await handler(LOOK_CHANNELS.export))(LOOK)).rejects.toThrow(LOOK_EXPORT_FAILED)
  })
})

describe('look:import', () => {
  const choose = (path: string): void => {
    electron.open = { canceled: false, filePaths: [path] }
  }

  it('reads a look file back as the look it was written from', async () => {
    const path = join(dir, 'Studio.forgelook')
    writeFileSync(path, serializeLook(LOOK))
    choose(path)
    const read = (await (await handler(LOOK_CHANNELS.import))()) as LookRead
    expect(read).toStrictEqual({ ok: true, look: LOOK, notes: [] })
  })

  it('a cancelled dialog is null, never an error', async () => {
    electron.open = { canceled: true, filePaths: [] }
    expect(await (await handler(LOOK_CHANNELS.import))()).toBeNull()
    electron.open = { canceled: false, filePaths: [] }
    expect(await (await handler(LOOK_CHANNELS.import))()).toBeNull()
    expect(reads).toEqual([])
  })

  it('refuses a file past the cap by its size, BEFORE reading it', async () => {
    const path = join(dir, 'Huge.forgelook')
    writeFileSync(path, `{"kind":"forge-look","pad":"${'z'.repeat(LOOK_FILE_MAX_BYTES)}"}`)
    choose(path)
    expect(await (await handler(LOOK_CHANNELS.import))()).toStrictEqual({ ok: false, reason: LOOK_TOO_LARGE })
    expect(reads.filter((r) => r === path)).toEqual([])
  })

  it('a file that is not a look’s text gives the plain reason and none of its content or its path', async () => {
    const path = join(dir, 'Bride 5,30pm notes.forgelook')
    writeFileSync(path, 'SECRET-TOKEN this is not a look {')
    choose(path)
    const read = (await (await handler(LOOK_CHANNELS.import))()) as LookRead
    expect(read).toStrictEqual({ ok: false, reason: LOOK_UNREADABLE })
    expect(JSON.stringify(read)).not.toMatch(/SECRET|Bride|forge-look-ipc/)
    // It was read: the refusal is the parse's, not the size's.
    expect(reads).toContain(path)
  })

  it('a file that is gone gives the plain reason', async () => {
    choose(join(dir, 'gone.forgelook'))
    expect(await (await handler(LOOK_CHANNELS.import))()).toStrictEqual({ ok: false, reason: LOOK_UNREADABLE })
  })

  it('a stranger’s look is read as one: a wrong kind refused', async () => {
    const path = join(dir, 'Project.forgelook')
    writeFileSync(path, JSON.stringify({ kind: 'forge-project', captions: {}, graphics: {} }))
    choose(path)
    expect(await (await handler(LOOK_CHANNELS.import))()).toStrictEqual({ ok: false, reason: LOOK_NOT_A_LOOK })
  })
})
