import { describe, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { helperLaunch, receiptFromText, resolveHelperPython, type HelperChoice, type HelperLaunch } from '../../src/shared/sidecar/helperPython'
import { HELPER_PACK } from '../../src/shared/sidecar/packManifest'
import type { PackPlatform, PlatformUnsupported } from '../../src/shared/sidecar/pack'

/**
 * The one gate for tests that need the AI helper's own interpreter
 * (docs/CLIPS.md §4.9).
 *
 * Every capability test used to build `sidecar/.venv/bin/python` itself, so on
 * Windows — where a venv's interpreter is `.venv\Scripts\python.exe` — each of
 * them skipped even with a venv in place (vision.int.test.ts:22-24 as it was).
 * The path is decided here, once, for both layouts.
 */

export const SIDECAR_DIR = resolve(__dirname, '../../sidecar')

/*
 * The AI helper's suites from inside an INSTALLED PACK (docs/CLIPS.md §3a.6
 * step 3): `FORGE_HELPER_PACK` names a version folder (`<userData>/python/1`,
 * which holds `pack.json`) or a userData holding one (`python/<n>`, then
 * `python-dev/<n>`). Then `VENV_PYTHON`, `HAS_VENV` and `HELPER_PYTHON` are
 * the pack's, and `devHelperLaunch` and `launchFor(VENV_PYTHON)` start it
 * through the pack rung's own launch (`helperLaunch` of the app's choice:
 * `-E -s -u -B`, the cleaned environment) — never through the env rung, or
 * CI would certify an environment no installed user gets. A pack that is
 * asked for and does not run here FAILS every suite that needs the helper
 * rather than skipping it (`venvGate`): a skip there is green.
 */

/** The pack this machine takes, as the tests read it (no Electron here to ask for the OS version: the pack that is there was installed on it). */
function testMachine(platform: NodeJS.Platform, arch: string): PackPlatform | PlatformUnsupported {
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'win32' && arch === 'x64') return 'win32-x64'
  return { unsupported: `no AI helper pack is built for ${platform}-${arch}` }
}

export interface PackUnderTest {
  /** What FORGE_HELPER_PACK says. */
  asked: string
  /** The version folder it resolves to. */
  versionDir: string
  /** The pack's interpreter in it. */
  python: string
  /** The app's choice for it (packaged order, no FORGE_PYTHON): `pack` when it runs, else `damaged` or `absent`. */
  choice: HelperChoice
}

/**
 * The pack `FORGE_HELPER_PACK` names, through the app's own rule
 * (`resolveHelperPython`: the receipt must parse and match this build's
 * manifest, and its interpreter be there). null when the variable is unset
 * or empty: then nothing here changes.
 */
export function packUnderTest(o: {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  arch: string
  exists(path: string): boolean
  receiptOf(versionDir: string): unknown
}): PackUnderTest | null {
  const asked = o.env.FORGE_HELPER_PACK
  if (!asked) return null
  const machine = testMachine(o.platform, o.arch)
  const n = String(HELPER_PACK.pack)
  const candidates = [asked, join(asked, 'python', n), join(asked, 'python-dev', n)]
  const versionDir = candidates.find((dir) => o.exists(join(dir, 'pack.json'))) ?? asked
  const python = join(versionDir, typeof machine === 'string' ? HELPER_PACK.platforms[machine].python : 'python')
  const hasReceipt = o.exists(join(versionDir, 'pack.json'))
  const choice = resolveHelperPython({
    packaged: true,
    env: {},
    platform: o.platform,
    venvPython: null,
    pack: hasReceipt ? { receipt: o.receiptOf(versionDir), interpreterExists: o.exists(python), python, root: versionDir } : null,
    manifest: HELPER_PACK,
    packPlatform: machine
  })
  return { asked, versionDir, python, choice }
}

/** Why the asked-for pack does not run here, in a sentence; null when it does. */
export function packMissing(pack: PackUnderTest): string | null {
  if (pack.choice.kind === 'pack') return null
  const why = pack.choice.kind === 'damaged' ? pack.choice.reason : 'no pack.json this build accepts (its hashes must be the manifest’s)'
  return `FORGE_HELPER_PACK=${pack.asked} names no AI helper pack that runs here: ${why}`
}

export const PACK_UNDER_TEST = packUnderTest({
  env: process.env,
  platform: process.platform,
  arch: process.arch,
  exists: existsSync,
  receiptOf: (dir) => {
    try {
      return receiptFromText(readFileSync(join(dir, 'pack.json'), 'utf8'))
    } catch {
      return null
    }
  }
})

/** The pack rung's launch for the pack under test, as the service starts it. Throws why when that pack does not run here. */
export function packLaunch(pack: PackUnderTest, o: { modelsDir?: string; cacheDir?: string } = {}): HelperLaunch {
  const missing = packMissing(pack)
  if (missing) throw new Error(missing)
  const launch = helperLaunch(pack.choice, { packaged: true, platform: process.platform, base: process.env, modelsDir: o.modelsDir ?? '', cacheDir: o.cacheDir ?? '' })
  if (!launch) throw new Error(`no launch for ${pack.choice.kind}`)
  return launch
}

/** The helper's venv interpreter, as `python -m venv` lays it out on this platform — or, under FORGE_HELPER_PACK, the pack's. */
export const VENV_PYTHON = PACK_UNDER_TEST
  ? PACK_UNDER_TEST.python
  : join(SIDECAR_DIR, '.venv', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']))

/**
 * Whether this machine has the helper's full interpreter: the venv, or the
 * pack FORGE_HELPER_PACK names when it runs here. CI never has the venv: its
 * first job runs a bare 3.12 with nothing installed.
 */
export const HAS_VENV = PACK_UNDER_TEST ? packMissing(PACK_UNDER_TEST) === null : existsSync(VENV_PYTHON)

/** The tests reach the pack explicitly (docs/CLIPS.md §3a.6), so the development order here never asks for it. */
const NO_PACK = { unsupported: 'the tests reach the pack explicitly (CLIPS §3a.6)' }

/**
 * For a test that runs on ANY interpreter (sidecarMedia, the floor scan): the
 * venv when there is one; otherwise what the app's development order falls
 * back to without one, `FORGE_PYTHON` (when set and not empty, read in any
 * case on win32), else `python` on win32 and `python3` elsewhere. That last
 * rung is `resolveHelperPython`'s own, so these tests and the helper started
 * by `devHelperLaunch` never disagree: a Windows machine with python.org's
 * Python (a python.exe, no python3.exe) and no FORGE_PYTHON runs both.
 */
export function helperPythonFor(o: { venvPython: string | null; env: NodeJS.ProcessEnv; platform: NodeJS.Platform }): string {
  if (o.venvPython) return o.venvPython
  const choice = resolveHelperPython({
    packaged: false,
    env: o.env,
    platform: o.platform,
    venvPython: null,
    pack: null,
    manifest: HELPER_PACK,
    packPlatform: NO_PACK
  })
  if (choice.kind !== 'env' && choice.kind !== 'path') throw new Error(`development without a venv never resolves to ${choice.kind}`)
  return choice.python
}

export const HELPER_PYTHON = PACK_UNDER_TEST ? PACK_UNDER_TEST.python : helperPythonFor({ venvPython: HAS_VENV ? VENV_PYTHON : null, env: process.env, platform: process.platform })

/**
 * The AI helper's launch in the app's own DEVELOPMENT order
 * (src/shared/sidecar/helperPython.ts `resolveHelperPython`, `packaged:
 * false`): `FORGE_PYTHON`, then this venv, then `python` on win32 and
 * `python3` elsewhere — started as `helperLaunch` starts that rung, so a
 * test runs the helper exactly as `npm run dev` does.
 *
 * The dev pack rung is not reached through this order: a test reaches the
 * pack explicitly, with `FORGE_HELPER_PACK` (docs/CLIPS.md §3a.6), and then
 * this is that pack's own launch (`packLaunch`) whatever else is here.
 */
export function devHelperLaunch(o: { modelsDir?: string; cacheDir?: string } = {}): HelperLaunch {
  if (PACK_UNDER_TEST) return packLaunch(PACK_UNDER_TEST, o)
  const choice = resolveHelperPython({
    packaged: false,
    env: process.env,
    platform: process.platform,
    venvPython: HAS_VENV ? VENV_PYTHON : null,
    pack: null,
    manifest: HELPER_PACK,
    packPlatform: NO_PACK
  })
  const launch = helperLaunch(choice, { packaged: false, platform: process.platform, base: process.env, modelsDir: o.modelsDir ?? '', cacheDir: o.cacheDir ?? '' })
  if (!launch) throw new Error(`development never resolves to ${choice.kind}`)
  return launch
}

/**
 * A given interpreter (the venv, a bare one, one that is not there), started
 * as the app's development rungs start one: `-m forge_sidecar` with the
 * environment `plainHelperEnv` builds from `process.env` as it is NOW — so a
 * test that sets a variable for one helper builds its launch inside that
 * window. `VENV_PYTHON` under `FORGE_HELPER_PACK` is the pack, started
 * through the pack rung's launch.
 */
export function launchFor(python: string, o: { modelsDir?: string; cacheDir?: string } = {}): HelperLaunch {
  if (PACK_UNDER_TEST && python === VENV_PYTHON) return packLaunch(PACK_UNDER_TEST, o)
  const choice = python === VENV_PYTHON ? ({ kind: 'venv', python } as const) : ({ kind: 'env', python } as const)
  const launch = helperLaunch(choice, { packaged: false, platform: process.platform, base: process.env, modelsDir: o.modelsDir ?? '', cacheDir: o.cacheDir ?? '' })
  if (!launch) throw new Error(`no launch for ${python}`)
  return launch
}

/**
 * `describe` when the venv is here and every extra need is met, otherwise
 * `describe.skip` with the reason in the suite's name, so a skipped run says
 * what was missing rather than only that something was.
 *
 * `needs` names anything else the suite cannot run without, e.g.
 * `{ 'the jfk.flac fixture': existsSync(FIXTURE) }`.
 */
export function describeWithVenv(name: string, body: () => void, needs: Record<string, boolean> = {}): void {
  const helper = PACK_UNDER_TEST ? packMissing(PACK_UNDER_TEST) : HAS_VENV ? null : `no helper venv at ${VENV_PYTHON}`
  const gate = venvGate({ helper, packAsked: PACK_UNDER_TEST !== null, needs })
  if ('run' in gate) describe(name, body)
  else if ('skip' in gate) describe.skip(`${name} — skipped: ${gate.skip}`, body)
  else
    describe(name, () => {
      it('runs from the AI helper pack FORGE_HELPER_PACK names', () => {
        throw new Error(gate.fail)
      })
    })
}

/**
 * Whether a suite that needs the helper runs, skips (with why), or fails.
 * `helper` is why the helper's interpreter is missing (null when it is
 * there). When a pack was asked for (`FORGE_HELPER_PACK`, as CI's pack job
 * sets it) and is not there, the suite FAILS: skipping would turn a pack
 * that did not install into a green run of nothing (docs/CLIPS.md §3a.7).
 * Any other need (a fixture, a model) still skips.
 */
export function venvGate(o: { helper: string | null; packAsked: boolean; needs: Record<string, boolean> }): { run: true } | { skip: string } | { fail: string } {
  if (o.helper && o.packAsked) return { fail: o.helper }
  const missing = [
    ...(o.helper ? [o.helper] : []),
    ...Object.entries(o.needs)
      .filter(([, met]) => !met)
      .map(([what]) => `no ${what}`)
  ]
  return missing.length === 0 ? { run: true } : { skip: missing.join('; ') }
}
