import { describe, expect, it, vi } from 'vitest'
import { basename, dirname, join } from 'node:path'

/*
 * The helper is told where its models and its bakes go, both under userData
 * (docs/CLIPS.md §3.5, docs/SIDECAR.md). Parallax bakes went to
 * `~/.cache/forge/parallax` because nothing set `FORGE_CACHE_DIR`: 264 MB
 * there, never evicted. The helper's side — `media.cache_dir(name)` honouring
 * the variable, and depth.py baking there — is tests/sidecar/test_media.py.
 */

const USER_DATA = join('/', 'Users', 'someone', 'Library', 'Application Support', 'forge')

/*
 * What `spawn` is handed, captured: the helper is never started here. The
 * env the CHILD gets is the thing that was wrong — the option existed in
 * main, and the helper never saw FORGE_CACHE_DIR — so it is read at the
 * spawn, not recomputed from the client's options.
 */
const spawned = vi.hoisted(() => [] as { command: string; options: { env?: NodeJS.ProcessEnv } }[])
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (command: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    spawned.push({ command, options })
    throw new Error('not spawned in a test')
  }
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => join('/', 'repo'),
    getPath: (name: string) => (name === 'userData' ? USER_DATA : join('/', 'tmp', name))
  }
}))

const { sidecarEnv } = await import('../src/main/sidecar/client')
const { getSidecar, helperFolders } = await import('../src/main/sidecar/service')

describe('the helper’s environment', () => {
  it('carries both folders when given, and the parent’s environment besides', () => {
    const env = sidecarEnv({ modelsDir: '/m', cacheDir: '/c' }, { PATH: '/bin', HOME: '/home/x' })
    expect(env.FORGE_MODELS_DIR).toBe('/m')
    expect(env.FORGE_CACHE_DIR).toBe('/c')
    expect(env.PATH).toBe('/bin')
    expect(env.HF_HUB_DISABLE_XET).toBe('1')
  })

  it('leaves a folder it was not given to the parent’s environment', () => {
    const env = sidecarEnv({}, { FORGE_CACHE_DIR: '/developer/cache' })
    expect(env.FORGE_CACHE_DIR).toBe('/developer/cache')
    expect(env).not.toHaveProperty('FORGE_MODELS_DIR')
  })
})

describe('the app’s helper', () => {
  it('bakes under userData, in a folder of its own', () => {
    const { modelsDir, cacheDir } = helperFolders(USER_DATA)
    expect(dirname(cacheDir)).toBe(USER_DATA)
    expect(dirname(modelsDir)).toBe(USER_DATA)
    // Not `cache`: on a case-insensitive disk that is Chromium's own `Cache`.
    expect(basename(cacheDir).toLowerCase()).not.toBe('cache')
    expect(cacheDir).not.toBe(modelsDir)
  })

  it('is started with them', async () => {
    const helper = getSidecar()
    try {
      await expect(helper.start()).rejects.toThrow('not spawned in a test')
    } finally {
      helper.stop()
    }
    expect(spawned).toHaveLength(1)
    const env = spawned[0].options.env ?? {}
    expect(env.FORGE_CACHE_DIR, 'the bakes folder the helper is spawned with').toBe(helperFolders(USER_DATA).cacheDir)
    expect(env.FORGE_MODELS_DIR, 'the models folder the helper is spawned with').toBe(helperFolders(USER_DATA).modelsDir)
  })
})
