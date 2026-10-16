import { describe, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
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
export function testMachine(platform: NodeJS.Platform, arch: string): PackPlatform | PlatformUnsupported {
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

/**
 * Whether `helperPack.int` finds, in the userData CI's cache restored, a pack
 * it CHECKS AGAIN instead of installing (docs/CLIPS.md §3a.6 step 2, the
 * cached mode). By the app's own rule, `packUnderTest` → `resolveHelperPython`:
 * the receipt must parse, its platform and both hashes be this build's
 * manifest's, and its interpreter be on disk. A stale receipt (a lock or an
 * interpreter this build no longer pins) is not cached: the run installs, as
 * the app would offer Update. A mutation run always installs its own pack.
 */
export function cachedPackIn(
  userData: string | null,
  o: { mutation: string | null; platform: NodeJS.Platform; arch: string; exists(path: string): boolean; receiptOf(versionDir: string): unknown }
): { cached: PackUnderTest } | { install: string } {
  if (!userData) return { install: 'no FORGE_PACK_USERDATA: a fresh userData of the run’s own' }
  if (o.mutation) return { install: `the mutation ${o.mutation} installs a pack of its own` }
  const pack = packUnderTest({ env: { FORGE_HELPER_PACK: userData }, platform: o.platform, arch: o.arch, exists: o.exists, receiptOf: o.receiptOf })
  if (!pack) return { install: 'no userData named' }
  const missing = packMissing(pack)
  return missing === null ? { cached: pack } : { install: missing }
}

/**
 * Whether helperPack.int runs, skips with why, or fails with why (docs/CLIPS.md
 * §3a.6 step 2). It is opt-in (`FORGE_PACK_REAL=1`) everywhere but CI's pack
 * step, which also sets `FORGE_PACK_USERDATA`: a step that has that and not
 * `FORGE_PACK_REAL=1` beside it FAILS, since it would be green with nothing
 * installed or checked. The ordinary suite (`npm test`, which sets neither)
 * skips, with the variable named in the suite's name.
 */
export function packSuiteGate(o: { real: boolean; askedUserData: string | null }): { run: true } | { skip: string } | { fail: string } {
  if (o.real) return { run: true }
  if (o.askedUserData) {
    return { fail: `FORGE_PACK_USERDATA is set (${o.askedUserData}), which only CI's pack step sets, and FORGE_PACK_REAL is not 1: the step would be green with nothing installed or checked` }
  }
  return { skip: 'FORGE_PACK_REAL is not 1' }
}

/**
 * For a suite that runs the helper's own Python tests on `HELPER_PYTHON`
 * (sidecarMedia.int): `fail` when a pack was asked for (`FORGE_HELPER_PACK`)
 * and does not run here, so its cases never run on a broken pack's
 * interpreter, lenient and green; else whether every case must run, none
 * skipped: on the venv and on the pack, which both have numpy (§3a.6 step 3).
 * Only a bare interpreter may skip the numpy cases.
 */
export function pythonCasesGate(o: { packAsked: boolean; packProblem: string | null; hasVenv: boolean }): { fail: string } | { strict: boolean } {
  if (o.packAsked && o.packProblem) return { fail: o.packProblem }
  return { strict: o.packAsked || o.hasVenv }
}

/**
 * What `pip check` inside the pack may report (§3a.6 step 5), by membership:
 * mediapipe's two requirements the lock leaves out on purpose (matplotlib,
 * opencv-contrib-python), and huggingface-hub's hf-xet once the lock no
 * longer pins hf-xet (§3a.8 row 35). Returns every reported line that is
 * none of those; "No broken requirements found." is not a problem.
 */
export function pipCheckProblems(lines: string[], wheels: readonly { name: string }[]): string[] {
  const allowed = [/^mediapipe \S+ requires (matplotlib|opencv-contrib-python), which is not installed\.$/]
  if (!wheels.some((w) => /^hf_xet-/i.test(w.name))) allowed.push(/^huggingface[-_]hub \S+ requires hf[-_]xet, which is not installed\.$/i)
  return lines
    .map((line) => line.trim())
    .filter((line) => line !== '' && line !== 'No broken requirements found.')
    .filter((line) => !allowed.some((re) => re.test(line)))
}

/**
 * The cache folder a pack under test runs with when its test names none: the
 * app's own place for it, `<userData>/helper-cache` beside `python/<n>`
 * (service.ts `helperFolders`), or one in the OS temp folder when the version
 * folder is not under a userData's `python/` or `python-dev/`. Never '' and
 * never inside the version folder (§16.52): with no cache folder,
 * NUMBA_CACHE_DIR is unset and numba writes each cached function's .nbi and
 * .nbc into the pack's librosa folders — measured, 38 files (1,190,239 B)
 * from one beats.int run — and CI's actions/cache then saves that drifted
 * pack, so every later cached run certified a tree no fresh install has.
 */
export function packCacheDir(versionDir: string, tmp: string): string {
  const parent = dirname(versionDir)
  const root = basename(parent)
  if (root === 'python' || root === 'python-dev') return join(dirname(parent), 'helper-cache')
  return join(tmp, 'forge-helper-cache')
}

/**
 * The pack rung's launch for the pack under test, as the service starts it.
 * Throws why when that pack does not run here. The models folder stays the
 * test's or the parent environment's (asr.int seeds FORGE_MODELS_DIR); the
 * cache folder is `packCacheDir`'s unless the test names one.
 */
export function packLaunch(pack: PackUnderTest, o: { modelsDir?: string; cacheDir?: string } = {}): HelperLaunch {
  const missing = packMissing(pack)
  if (missing) throw new Error(missing)
  const cacheDir = o.cacheDir ?? packCacheDir(pack.versionDir, tmpdir())
  const launch = helperLaunch(pack.choice, { packaged: true, platform: process.platform, base: process.env, modelsDir: o.modelsDir ?? '', cacheDir })
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

/** `pythonCasesGate` for this run: what sidecarMedia.int's Python cases may do here. */
export const PYTHON_CASES = pythonCasesGate({
  packAsked: PACK_UNDER_TEST !== null,
  packProblem: PACK_UNDER_TEST ? packMissing(PACK_UNDER_TEST) : null,
  hasVenv: HAS_VENV
})

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
