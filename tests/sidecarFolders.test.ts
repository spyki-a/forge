import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { plainHelperEnv } from '../src/shared/sidecar/helperPython'
import { HELPER_PACK } from '../src/shared/sidecar/packManifest'
import type { PackPlatform } from '../src/shared/sidecar/pack'

/*
 * The helper is told where its models and its bakes go, both under userData
 * (docs/CLIPS.md §3.5, docs/SIDECAR.md). Parallax bakes went to
 * `~/.cache/forge/parallax` because nothing set `FORGE_CACHE_DIR`: 264 MB
 * there, never evicted. The helper's side — `media.cache_dir(name)` honouring
 * the variable, and depth.py baking there — is tests/sidecar/test_media.py.
 *
 * Since Step P (§3a.2) the environment comes from the launch of the rung that
 * runs (helperPython.ts): the dev rungs' `plainHelperEnv`, and the pack's
 * cleaned one. Both are held here AT THE SPAWN.
 */

/*
 * What `spawn` is handed, captured: the helper is never started here. The
 * env the CHILD gets is the thing that was wrong — the option existed in
 * main, and the helper never saw FORGE_CACHE_DIR — so it is read at the
 * spawn, not recomputed from the client's options.
 */
const spawned = vi.hoisted(() => [] as { command: string; args: string[]; options: { env?: NodeJS.ProcessEnv } }[])
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    spawned.push({ command, args, options })
    throw new Error('not spawned in a test')
  }
}))

const electron = vi.hoisted(() => ({ packaged: false, userData: '' }))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electron.packaged
    },
    getAppPath: () => join('/', 'repo'),
    getPath: (name: string) => (name === 'userData' ? electron.userData : join('/', 'tmp', name))
  }
}))

const USER_DATA = join('/', 'Users', 'someone', 'Library', 'Application Support', 'forge')
const scratch: string[] = []

beforeEach(() => {
  vi.resetModules()
  spawned.length = 0
  electron.packaged = false
  electron.userData = USER_DATA
})

afterEach(async () => {
  const { stopSidecar } = await import('../src/main/sidecar/service')
  await stopSidecar()
})

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

describe('the helper’s environment', () => {
  it('carries both folders when given, and the parent’s environment besides', () => {
    const env = plainHelperEnv({ PATH: '/bin', HOME: '/home/x' }, { modelsDir: '/m', cacheDir: '/c' })
    expect(env.FORGE_MODELS_DIR).toBe('/m')
    expect(env.FORGE_CACHE_DIR).toBe('/c')
    expect(env.PATH).toBe('/bin')
    expect(env.HF_HUB_DISABLE_XET).toBe('1')
  })

  it('leaves a folder it was not given to the parent’s environment', () => {
    const env = plainHelperEnv({ FORGE_CACHE_DIR: '/developer/cache' }, {})
    expect(env.FORGE_CACHE_DIR).toBe('/developer/cache')
    expect(env).not.toHaveProperty('FORGE_MODELS_DIR')
  })
})

describe('the app’s helper', () => {
  it('bakes under userData, in a folder of its own', async () => {
    const { helperFolders } = await import('../src/main/sidecar/service')
    const { modelsDir, cacheDir } = helperFolders(USER_DATA)
    expect(dirname(cacheDir)).toBe(USER_DATA)
    expect(dirname(modelsDir)).toBe(USER_DATA)
    // Not `cache`: on a case-insensitive disk that is Chromium's own `Cache`.
    expect(basename(cacheDir).toLowerCase()).not.toBe('cache')
    expect(cacheDir).not.toBe(modelsDir)
  })

  it('is started with them in development', async () => {
    const { getSidecar, helperFolders } = await import('../src/main/sidecar/service')
    const helper = getSidecar()
    await expect(helper.start()).rejects.toThrow('not spawned in a test')
    expect(spawned).toHaveLength(1)
    const env = spawned[0].options.env ?? {}
    expect(env.FORGE_CACHE_DIR, 'the bakes folder the helper is spawned with').toBe(helperFolders(USER_DATA).cacheDir)
    expect(env.FORGE_MODELS_DIR, 'the models folder the helper is spawned with').toBe(helperFolders(USER_DATA).modelsDir)
  })

  const platform: PackPlatform | null =
    process.platform === 'darwin' && process.arch === 'arm64' ? 'darwin-arm64' : process.platform === 'win32' && process.arch === 'x64' ? 'win32-x64' : null

  it.skipIf(!platform)('is started with them from the pack, in a packaged app', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'forge-folders-'))
    scratch.push(userData)
    const pack = HELPER_PACK.platforms[platform!]
    const version = join(userData, 'python', String(HELPER_PACK.pack))
    mkdirSync(dirname(join(version, pack.python)), { recursive: true })
    writeFileSync(join(version, pack.python), '')
    writeFileSync(
      join(version, 'pack.json'),
      JSON.stringify({
        pack: HELPER_PACK.pack,
        python: HELPER_PACK.python.version,
        build: HELPER_PACK.python.build,
        platform,
        interpreterSha256: pack.interpreter.sha256,
        lockSha256: pack.lock.sha256
      })
    )
    electron.packaged = true
    electron.userData = userData
    const restore = stubElectronProcess()
    try {
      const { getSidecar, helperFolders } = await import('../src/main/sidecar/service')
      const helper = getSidecar()
      expect(helper.source).toMatchObject({ kind: 'pack', pack: HELPER_PACK.pack })
      await expect(helper.start()).rejects.toThrow('not spawned in a test')
      expect(spawned).toHaveLength(1)
      expect(spawned[0].command).toBe(join(version, pack.python))
      const env = spawned[0].options.env ?? {}
      expect(env.FORGE_CACHE_DIR, 'the bakes folder the pack is spawned with').toBe(helperFolders(userData).cacheDir)
      expect(env.FORGE_MODELS_DIR, 'the models folder the pack is spawned with').toBe(helperFolders(userData).modelsDir)
    } finally {
      restore()
    }
  })
})

/** What Electron adds to `process` and plain Node lacks: the OS's marketing version and the resources folder. */
function stubElectronProcess(): () => void {
  const p = process as unknown as { getSystemVersion?: () => string; resourcesPath?: string }
  const saved = { getSystemVersion: p.getSystemVersion, resourcesPath: p.resourcesPath }
  p.getSystemVersion = () => (process.platform === 'darwin' ? '15.0' : '10.0.22631')
  p.resourcesPath = join('/', 'app', 'resources')
  return () => {
    p.getSystemVersion = saved.getSystemVersion
    p.resourcesPath = saved.resourcesPath
  }
}
