import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HELPER_CHANNELS } from '../src/shared/sidecar/install'

/*
 * The AI helper's presses across the bridge (docs/CLIPS.md §3a.3, §3a.4):
 * the preload's three calls on the channels main registers, and the app's
 * wiring that no unit reaches — before-quit cancelling the job and releasing
 * its lock, and the launch sweep running before the helper starts. The
 * handlers themselves are tests/sidecarService.test.ts's ("the IPC"); the job
 * is tests/helperPackJob.test.ts's.
 */

const electronMock = vi.hoisted(() => ({ exposed: null as Record<string, (...args: unknown[]) => unknown> | null, invoked: [] as { channel: string; args: unknown[] }[] }))
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: Record<string, (...args: unknown[]) => unknown>) => {
      electronMock.exposed = api
    }
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      electronMock.invoked.push({ channel, args })
      return Promise.resolve(undefined)
    },
    on: () => undefined,
    send: () => undefined,
    removeListener: () => undefined
  },
  webUtils: { getPathForFile: () => '' }
}))

describe('the preload', () => {
  it('invokes the channels HELPER_CHANNELS names, with the payload main validates', async () => {
    await import('../src/preload/index')
    const api = electronMock.exposed!
    expect(api).toBeTruthy()
    await api.installHelper()
    await api.installHelper({ repair: true })
    await api.removeHelper({ models: false })
    await api.checkHelperAgain()
    expect(electronMock.invoked).toEqual([
      { channel: HELPER_CHANNELS.install, args: [{}] },
      { channel: HELPER_CHANNELS.install, args: [{ repair: true }] },
      { channel: HELPER_CHANNELS.remove, args: [{ models: false }] },
      { channel: HELPER_CHANNELS.checkAgain, args: [] }
    ])
  })
})

describe('the app’s wiring (src/main/index.ts, ipc.ts)', () => {
  const source = (file: string): string => readFileSync(join(__dirname, '..', file), 'utf8')
  /** The `{…}` block after `anchor`, which must occur exactly once (CLAUDE.md: count the anchor's matches). */
  function blockAfter(text: string, anchor: string): string {
    expect(text.split(anchor).length - 1, `anchor "${anchor}"`).toBe(1)
    const from = text.indexOf(anchor)
    let depth = 0
    for (let i = text.indexOf('{', from); i < text.length; i++) {
      if (text[i] === '{') depth++
      if (text[i] === '}' && --depth === 0) return text.slice(from, i + 1)
    }
    throw new Error(`unbalanced block after "${anchor}"`)
  }

  it('a quit cancels the helper’s job and releases its lock, after the close guard’s return', () => {
    const quit = blockAfter(source('src/main/index.ts'), "app.on('before-quit', (event) =>")
    expect([...quit.matchAll(/quitHelperJobs\(\)/g)]).toHaveLength(1)
    expect(quit.indexOf('quitHelperJobs()')).toBeGreaterThan(quit.indexOf('return'))
    const ipc = source('src/main/ipc.ts')
    expect(blockAfter(ipc, 'export function quitHelperJobs(): void')).toContain('helperJobs?.quit()')
    expect([...ipc.matchAll(/^\s*helperJobs = helper$/gm)]).toHaveLength(1)
  })

  it('registerIpc is handed the real workers once, so a press installs instead of saying "not part of this build yet"', () => {
    const ready = blockAfter(source('src/main/index.ts'), 'app.whenReady().then(() =>')
    const calls = [...ready.matchAll(/registerIpc\(([^\n]*)\)\n/g)].map((m) => m[1])
    expect(calls).toEqual(['() => mainWindow, helperInstallOptions()'])
    expect([...source('src/main/index.ts').matchAll(/import \{ helperInstallOptions \} from '\.\/sidecar\/installDeps'/g)]).toHaveLength(1)
  })

  it('the launch sweep runs once at startup, before the helper starts', () => {
    const ready = blockAfter(source('src/main/index.ts'), 'app.whenReady().then(() =>')
    expect([...ready.matchAll(/runLaunchSweep\(\)/g)]).toHaveLength(1)
    expect([...ready.matchAll(/startSidecar\(/g)]).toHaveLength(1)
    expect(ready.indexOf('runLaunchSweep()')).toBeLessThan(ready.indexOf('startSidecar('))
  })
})
