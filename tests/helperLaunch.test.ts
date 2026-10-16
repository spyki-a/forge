import { describe, expect, it } from 'vitest'
import {
  cleanHelperEnv,
  helperLaunch,
  helperSourceLabel,
  numbaCacheDir,
  type HelperChoice,
  type HelperLaunch,
  type HelperLaunchOptions
} from '../src/shared/sidecar/helperPython'

/*
 * How the AI helper is started, rung by rung (docs/CLIPS.md §3a.2, "The
 * launch: flags and a clean environment").
 *
 * The pack starts `<python> -E -s -u -B -m forge_sidecar` with every PYTHON*
 * and HF_* variable dropped (case-insensitively on win32) and the app's own
 * four set. FORGE_PYTHON in a packaged app gets -B and the HF_* clean-up and
 * keeps the rest. Everything in development, and the venv and PATH rungs
 * anywhere, start exactly as client.ts always started them.
 */

const MODELS = '/Users/someone/Library/Application Support/Forge/models'
const CACHE = '/Users/someone/Library/Application Support/Forge/helper-cache'
/** numba's cache (§16.52): under the app's cache folder, never beside librosa's sources in the pack. */
const NUMBA = '/Users/someone/Library/Application Support/Forge/helper-cache/numba'

const PACK: Extract<HelperChoice, { kind: 'pack' }> = {
  kind: 'pack',
  python: '/Users/someone/Library/Application Support/Forge/python/1/python/bin/python3.14',
  pack: 1,
  root: '/Users/someone/Library/Application Support/Forge/python/1'
}
const OWN_PYTHON = '/opt/someone/bin/python3.12'

/** A user's environment with everything the pack must not pass on, and what it must. */
const BASE: NodeJS.ProcessEnv = {
  PATH: '/usr/bin:/bin',
  HOME: '/Users/someone',
  FORGE_FACES_WORKER_FAKE: 'colour',
  PYTHONPATH: '/somewhere/else',
  PYTHONHOME: '/opt/python',
  PYTHONSAFEPATH: '1',
  PYTHONUNBUFFERED: '0',
  PYTHONIOENCODING: 'latin-1',
  HF_ENDPOINT: 'https://mirror.example',
  HF_HUB_OFFLINE: '1',
  HF_TOKEN: 'not-a-real-token',
  HF_HOME: '/Volumes/elsewhere/hf',
  HF_HUB_DISABLE_XET: '0'
}

function options(over: Partial<HelperLaunchOptions> = {}): HelperLaunchOptions {
  return { packaged: true, platform: 'darwin', base: BASE, modelsDir: MODELS, cacheDir: CACHE, ...over }
}

function launch(choice: HelperChoice, over: Partial<HelperLaunchOptions> = {}): HelperLaunch {
  const result = helperLaunch(choice, options(over))
  if (!result) throw new Error(`no launch for ${choice.kind}`)
  return result
}

/**
 * The single-letter flags in front of the module, and the module last.
 *
 * There is exactly one `-m`, `-m forge_sidecar` is the tail (anything after it
 * would be the module's own argv), and every argument before it is a flag.
 * Letters are read out of clusters, so `-Es` counts as -E and -s; `-X`/`-W`
 * take a value (`-X utf8`, `-Xutf8`) and add no letter. So the assertions are
 * on the letters present, not on one exact list a correct addition (row 38's
 * `-X utf8`) would break.
 */
function flagsBeforeModule(args: string[]): Set<string> {
  const ms = [...args.entries()].filter(([, a]) => a === '-m').map(([i]) => i)
  expect(ms).toHaveLength(1)
  const m = ms[0]
  expect(args.slice(m)).toEqual(['-m', 'forge_sidecar'])
  const letters = new Set<string>()
  const before = args.slice(0, m)
  for (let i = 0; i < before.length; i++) {
    const arg = before[i]
    if (/^-[XW]/.test(arg)) {
      if (arg.length === 2) i++
      continue
    }
    expect(arg).toMatch(/^-[A-Za-z]+$/)
    for (const letter of arg.slice(1)) letters.add(letter)
  }
  return letters
}

/** The PYTHON* and HF_* names in an environment, in any case. */
const pythonOrHf = (env: NodeJS.ProcessEnv): string[] => Object.keys(env).filter((k) => /^(PYTHON|HF_)/i.test(k))

/** What the app writes itself; nothing else of either family may reach the pack. */
const APP_WRITES = new Set(['HF_HUB_DISABLE_XET', 'HF_HUB_DISABLE_TELEMETRY'])

describe('the pack’s launch', () => {
  for (const packaged of [true, false]) {
    const mode = packaged ? 'packaged' : 'development'
    it(`holds -E, -s, -u and -B before -m forge_sidecar, and never -I or -P (${mode})`, () => {
      // In development too: a test that reaches the pack (§3a.6's
      // FORGE_HELPER_PACK) must start it as an installed user gets it.
      const l = launch(PACK, { packaged })
      expect(l.command).toBe(PACK.python)
      const flags = flagsBeforeModule(l.args)
      for (const f of ['E', 's', 'u', 'B']) expect(flags).toContain(f)
      // -I implies -P, which drops the cwd from sys.path: forge_sidecar would not import.
      expect(flags).not.toContain('I')
      expect(flags).not.toContain('P')
      expect(l.source).toEqual({ kind: 'pack', pack: 1, root: PACK.root })
    })
  }

  for (const platform of ['darwin', 'win32'] as const) {
    it(`passes on no PYTHON* or HF_* variable but the app’s own (${platform})`, () => {
      const { env } = launch(PACK, { platform })
      for (const key of pythonOrHf(env)) expect(APP_WRITES).toContain(key)
      for (const gone of ['HF_ENDPOINT', 'HF_HUB_OFFLINE', 'HF_TOKEN', 'HF_HOME', 'PYTHONSAFEPATH', 'PYTHONPATH']) {
        expect(env).not.toHaveProperty(gone)
      }
      // -E ignores both, and -u and the helper's own reconfigure replace them.
      expect(env).not.toHaveProperty('PYTHONUNBUFFERED')
      expect(env).not.toHaveProperty('PYTHONIOENCODING')
      expect(env.FORGE_MODELS_DIR).toBe(MODELS)
      expect(env.FORGE_CACHE_DIR).toBe(CACHE)
      expect(env.HF_HUB_DISABLE_XET).toBe('1')
      expect(env.HF_HUB_DISABLE_TELEMETRY).toBe('1')
      // Everything else is the user's and stays.
      expect(env.PATH).toBe(BASE.PATH)
      expect(env.HOME).toBe(BASE.HOME)
      expect(env.FORGE_FACES_WORKER_FAKE).toBe('colour')
    })
  }

  for (const platform of ['darwin', 'win32'] as const) {
    it(`keeps numba's cache under the app's cache folder, not in the pack, over a user's own (${platform}, §16.52)`, () => {
      const cacheDir = platform === 'win32' ? 'C:\\Users\\Ana\\AppData\\Roaming\\Forge\\helper-cache' : CACHE
      const want = platform === 'win32' ? 'C:\\Users\\Ana\\AppData\\Roaming\\Forge\\helper-cache\\numba' : NUMBA
      expect(numbaCacheDir(cacheDir)).toBe(want)
      const base = { ...BASE, NUMBA_CACHE_DIR: '/Volumes/elsewhere/numba', ...(platform === 'win32' ? { Numba_Cache_Dir: 'D:\\numba' } : {}) }
      const { env } = launch(PACK, { platform, base, cacheDir })
      expect(env.NUMBA_CACHE_DIR).toBe(want)
      // One spelling on win32, the app's: the user's other one would be the same variable to Windows.
      if (platform === 'win32') expect(Object.keys(env).filter((k) => /^numba_cache_dir$/i.test(k))).toEqual(['NUMBA_CACHE_DIR'])
    })
  }

  it('cleanHelperEnv leaves numba’s variable alone: it drops PYTHON* and HF_* only', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      expect(cleanHelperEnv({ NUMBA_CACHE_DIR: '/n', PYTHONPATH: '/p', HF_HOME: '/h' }, platform)).toEqual({ NUMBA_CACHE_DIR: '/n' })
    }
  })

  it('a pack given no cache folder leaves numba to the parent’s environment, as it leaves FORGE_CACHE_DIR', () => {
    const { env } = launch(PACK, { cacheDir: '', base: { PATH: '/bin' } })
    expect(env).not.toHaveProperty('NUMBA_CACHE_DIR')
    expect(env).not.toHaveProperty('FORGE_CACHE_DIR')
  })

  it('drops PythonPath and pythonhome on win32, where their case does not matter', () => {
    const base = { PythonPath: 'x', pythonhome: 'y', hf_token: 'z', Path: 'C:\\Windows', SystemRoot: 'C:\\Windows' }
    for (const env of [cleanHelperEnv(base, 'win32'), launch(PACK, { platform: 'win32', base }).env]) {
      const left = pythonOrHf(env)
      expect(left).not.toContain('PythonPath')
      expect(left).not.toContain('pythonhome')
      expect(left).not.toContain('hf_token')
      expect(env.Path).toBe('C:\\Windows')
      expect(env.SystemRoot).toBe('C:\\Windows')
    }
  })

  it('leaves one spelling of each name it sets on win32: the app’s', () => {
    const base = { forge_models_dir: 'C:\\elsewhere', Forge_Cache_Dir: 'C:\\else', Path: 'C:\\Windows' }
    const { env } = launch(PACK, { platform: 'win32', base })
    expect(Object.keys(env).filter((k) => /^forge_models_dir$/i.test(k))).toEqual(['FORGE_MODELS_DIR'])
    expect(Object.keys(env).filter((k) => /^forge_cache_dir$/i.test(k))).toEqual(['FORGE_CACHE_DIR'])
  })
})

describe('FORGE_PYTHON in a packaged app', () => {
  const choice: HelperChoice = { kind: 'env', python: OWN_PYTHON }

  it('starts with -B, keeps its own PYTHON* variables and drops HF_*', () => {
    const l = launch(choice, { packaged: true })
    expect(l.command).toBe(OWN_PYTHON)
    const flags = flagsBeforeModule(l.args)
    expect(flags).toContain('B')
    // Someone's own interpreter: its environment is theirs.
    expect(flags).not.toContain('E')
    expect(flags).not.toContain('I')
    expect(l.env.PYTHONPATH).toBe(BASE.PYTHONPATH)
    expect(l.env.PYTHONHOME).toBe(BASE.PYTHONHOME)
    for (const gone of ['HF_ENDPOINT', 'HF_HUB_OFFLINE', 'HF_TOKEN', 'HF_HOME']) expect(l.env).not.toHaveProperty(gone)
    expect(l.env.PYTHONUNBUFFERED).toBe('1')
    expect(l.env.PYTHONIOENCODING).toBe('utf-8')
    expect(l.env.FORGE_MODELS_DIR).toBe(MODELS)
    expect(l.env.FORGE_CACHE_DIR).toBe(CACHE)
    expect(l.env.NUMBA_CACHE_DIR).toBe(NUMBA)
    expect(l.env.HF_HUB_DISABLE_XET).toBe('1')
    expect(l.env.HF_HUB_DISABLE_TELEMETRY).toBe('1')
    expect(l.source).toEqual({ kind: 'env', python: OWN_PYTHON })
  })
})

describe('development, and the venv and PATH rungs anywhere', () => {
  /** client.ts's sidecarEnv, key for key: the parent's environment and these six, and numba's cache since §16.52. */
  const TODAY = {
    ...BASE,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    FORGE_MODELS_DIR: MODELS,
    FORGE_CACHE_DIR: CACHE,
    NUMBA_CACHE_DIR: NUMBA,
    HF_HUB_DISABLE_XET: '1',
    HF_HUB_DISABLE_TELEMETRY: '1'
  }

  const cases: [string, Extract<HelperChoice, { python: string }>, boolean][] = [
    ['FORGE_PYTHON in development', { kind: 'env', python: OWN_PYTHON }, false],
    ['the venv in development', { kind: 'venv', python: '/repo/sidecar/.venv/bin/python' }, false],
    ['python3 on PATH in development', { kind: 'path', python: 'python3' }, false],
    ['the venv, packaged', { kind: 'venv', python: '/repo/sidecar/.venv/bin/python' }, true],
    ['python on PATH, packaged', { kind: 'path', python: 'python' }, true]
  ]

  for (const [what, choice, packaged] of cases) {
    it(`starts ${what} as before: -m forge_sidecar and the app's seven keys`, () => {
      const l = launch(choice, { packaged })
      expect(l.command).toBe(choice.python)
      expect(l.args).toEqual(['-m', 'forge_sidecar'])
      // The user's PYTHONPATH and HF_ENDPOINT reach a development helper, as they always have.
      expect(l.env).toEqual(TODAY)
    })
  }

  it('leaves a folder it was not given to the parent’s environment, as before', () => {
    const l = launch(
      { kind: 'venv', python: '/v' },
      { packaged: false, base: { FORGE_CACHE_DIR: '/dev/cache' }, cacheDir: '', modelsDir: '' }
    )
    expect(l.env.FORGE_CACHE_DIR).toBe('/dev/cache')
    expect(l.env).not.toHaveProperty('FORGE_MODELS_DIR')
    expect(l.env).not.toHaveProperty('NUMBA_CACHE_DIR')
  })
})

describe('nothing to start', () => {
  it('gives no launch for absent or damaged', () => {
    expect(helperLaunch({ kind: 'absent' }, options())).toBeNull()
    expect(helperLaunch({ kind: 'damaged', reason: 'gone' }, options())).toBeNull()
    expect(helperLaunch({ kind: 'damaged', reason: 'gone' }, options({ packaged: false }))).toBeNull()
  })
})

describe('the row’s words for the rung', () => {
  it('names each source', () => {
    expect(helperSourceLabel(launch(PACK).source)).toBe('installed by the app · pack 1')
    expect(helperSourceLabel(launch({ kind: 'env', python: OWN_PYTHON }).source)).toBe(
      `from FORGE_PYTHON ${OWN_PYTHON}`
    )
    expect(helperSourceLabel({ kind: 'venv', python: '/v' })).toBe('development venv')
    expect(helperSourceLabel({ kind: 'path', python: 'python3' })).toBe('python3 on PATH')
    expect(helperSourceLabel({ kind: 'path', python: 'python' })).toBe('python on PATH')
  })

  it('never says the code’s word for the process', () => {
    const sources = [
      launch(PACK).source,
      { kind: 'venv', python: '/v' } as const,
      { kind: 'path', python: 'python3' } as const
    ]
    for (const source of sources) expect(helperSourceLabel(source)).not.toMatch(/sidecar/i)
  })
})
