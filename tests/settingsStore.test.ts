import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/*
 * userData/settings.json, and who may see which half of it.
 *
 * The file holds the person's settings: the main process's own (output folder,
 * the voice and Director configs — and in those, the hosted API keys) and the
 * window's (export presets, the export choice). Two things went wrong with it,
 * both found in review of step 6 and both older than it:
 *
 *  - `settings:get` returned the file raw, so every launch sent the hosted key
 *    across the IPC into the renderer, which is only ever meant to learn
 *    `hasKey`. `settings:set` answered with the whole file too.
 *  - It had two writers. A Director save went through main/store.ts, whose
 *    sanitiser keeps only `Settings` fields — so every keystroke in the
 *    Settings panel's Server and Model fields rewrote the file without the
 *    export presets, and the next launch had none.
 *
 * Now main/store.ts owns the file and both halves of it, and the window sees
 * and writes only its own.
 */

const KEY = 'sk-proj-SETTINGSFILE-0123456789'
const VOICE_KEY = 'sk-voice-SETTINGSFILE-9876543210'
const PRESETS = [{ id: 'mine', name: 'Mine', crf: 20 }]
const CHOICE = { codec: 'h264', quality: 'high' }

const seed = {
  outputDir: '/somewhere',
  director: {
    provider: 'openai',
    ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:e2b' },
    openai: { baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: KEY }
  },
  voiceHosted: { baseUrl: 'https://voice.example.com/v1', model: 'tts-1', voice: 'alloy', apiKey: VOICE_KEY },
  exportPresets: PRESETS,
  exportChoice: CHOICE
}

let dir = ''
const settingsPath = (): string => join(dir, 'userData', 'settings.json')
const onDisk = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(settingsPath(), 'utf8')) as Record<string, unknown>

/** A fresh main process: a new userData, the file seeded, the store's cache empty. */
async function launch(file: unknown = seed): Promise<typeof import('../src/main/store')> {
  if (!dir) {
    dir = await mkdtemp(join(tmpdir(), 'forge-settings-'))
    process.env.FORGE_TEST_USERDATA = dir
    await mkdir(join(dir, 'userData'), { recursive: true })
    if (file !== null) await writeFile(settingsPath(), JSON.stringify(file))
  }
  vi.resetModules()
  return import('../src/main/store')
}

/** The same userData, the cache dropped — what quitting and opening again does. */
async function relaunch(): Promise<typeof import('../src/main/store')> {
  vi.resetModules()
  return import('../src/main/store')
}

afterEach(async () => {
  delete process.env.FORGE_TEST_USERDATA
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ''
})

describe('the window sees its own half of the settings file, and never a key', () => {
  it('settings:get answers with the export presets and choice — and no hosted key, and no main-process field', async () => {
    const store = await launch()
    const got = store.rendererSettings()
    expect(got.exportPresets).toEqual(PRESETS)
    expect(got.exportChoice).toEqual(CHOICE)
    const text = JSON.stringify(got)
    expect(text).not.toContain(KEY)
    expect(text).not.toContain(VOICE_KEY)
    // Membership: whatever the main process owns now or later is not in it.
    for (const owned of Object.keys(store.getSettings())) expect(got, owned).not.toHaveProperty(owned)
  })

  it('settings:set answers the same way', async () => {
    const store = await launch()
    const answer = store.setRendererSetting('exportChoice', { codec: 'hevc' })
    expect(answer.exportChoice).toEqual({ codec: 'hevc' })
    expect(answer.exportPresets).toEqual(PRESETS)
    expect(JSON.stringify(answer)).not.toContain(KEY)
    expect(JSON.stringify(answer)).not.toContain(VOICE_KEY)
  })

  it('the window cannot write a main-process field — the key goes in only through the Director', async () => {
    const store = await launch()
    for (const owned of Object.keys(store.getSettings())) {
      let message = ''
      try {
        store.setRendererSetting(owned, { openai: { apiKey: 'sk-from-the-window-000' } })
      } catch (err) {
        message = (err as Error).message
      }
      expect(message, owned).toContain(owned)
      // The refusal names the field, never the value.
      expect(message, owned).not.toContain('sk-from-the-window')
    }
    expect(store.getSettings().director?.openai.apiKey).toBe(KEY)
    const disk = await onDisk()
    expect(JSON.stringify(disk)).not.toContain('sk-from-the-window')
    expect((disk.director as { openai: { apiKey: string } }).openai.apiKey).toBe(KEY)
  })
})

describe('one owner, so neither half drops the other', () => {
  it('a Director save keeps the export presets — on disk, and after a relaunch', async () => {
    await launch()
    vi.resetModules()
    const { setDirectorSettings } = await import('../src/main/director')
    setDirectorSettings({ ollama: { baseUrl: 'http://192.168.1.50:11434' } })

    const disk = await onDisk()
    expect(disk.exportPresets).toEqual(PRESETS)
    expect(disk.exportChoice).toEqual(CHOICE)
    expect((disk.director as { ollama: { baseUrl: string } }).ollama.baseUrl).toBe('http://192.168.1.50:11434')

    const again = await relaunch()
    expect(again.rendererSettings().exportPresets).toEqual(PRESETS)
    expect(again.rendererSettings().exportChoice).toEqual(CHOICE)
  })

  it('a preset save keeps the key and every main-process field — on disk, in memory, after a relaunch', async () => {
    const store = await launch()
    const next = [...PRESETS, { id: 'two', name: 'Two', crf: 23 }]
    store.setRendererSetting('exportPresets', next)

    const disk = await onDisk()
    expect(disk.exportPresets).toEqual(next)
    expect(disk.outputDir).toBe('/somewhere')
    expect((disk.director as { openai: { apiKey: string } }).openai.apiKey).toBe(KEY)
    expect((disk.voiceHosted as { apiKey: string }).apiKey).toBe(VOICE_KEY)
    expect(store.getSettings().director?.openai.apiKey).toBe(KEY)

    const again = await relaunch()
    expect(again.getSettings().director?.openai.apiKey).toBe(KEY)
    expect(again.getSettings().outputDir).toBe('/somewhere')
    expect(again.rendererSettings().exportPresets).toEqual(next)
  })

  it('a first run with no file writes both halves, and leaves no temp file behind', async () => {
    const store = await launch(null)
    expect(store.rendererSettings()).toEqual({})
    store.setRendererSetting('exportChoice', CHOICE)
    store.setSettings({ outputDir: '/out' })
    expect(await readdir(join(dir, 'userData'))).toEqual(['settings.json'])
    const disk = await onDisk()
    expect(disk.exportChoice).toEqual(CHOICE)
    expect(disk.outputDir).toBe('/out')
  })
})

describe('the IPC goes through the store', () => {
  const root = resolve(__dirname, '..')
  const ipc = readFileSync(resolve(root, 'src/main/ipc.ts'), 'utf8')
  const count = (text: string, needle: string): number => text.split(needle).length - 1

  it('settings:get and settings:set answer with the window half only', () => {
    expect(count(ipc, "ipcMain.handle('settings:get'")).toBe(1)
    expect(count(ipc, "ipcMain.handle('settings:get', () => rendererSettings())")).toBe(1)
    expect(count(ipc, "ipcMain.handle('settings:set'")).toBe(1)
    const set = ipc.slice(ipc.indexOf("ipcMain.handle('settings:set'"))
    const body = set.slice(0, set.indexOf('\n  })') + 4)
    expect([...body.matchAll(/\breturn\b/g)]).toHaveLength(1)
    expect(count(body, 'return setRendererSetting(key, value)')).toBe(1)
  })

  it('nothing in the main process but the store opens settings.json', () => {
    const walk = (at: string): string[] =>
      readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
        const path = join(at, entry.name)
        if (entry.isDirectory()) return walk(path)
        return entry.name.endsWith('.ts') ? [path] : []
      })
    const files = walk(resolve(root, 'src/main'))
    expect(files.length).toBeGreaterThan(20)
    const naming = files
      .filter((p) => readFileSync(p, 'utf8').includes('settings.json'))
      .map((p) => relative(root, p).split(sep).join('/'))
    expect(naming).toEqual(['src/main/store.ts'])
  })
})
