import { describe } from 'vitest'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { helperLaunch, resolveHelperPython, type HelperLaunch } from '../../src/shared/sidecar/helperPython'
import { HELPER_PACK } from '../../src/shared/sidecar/packManifest'

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

/** The helper's venv interpreter, as `python -m venv` lays it out on this platform. */
export const VENV_PYTHON = join(SIDECAR_DIR, '.venv', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']))

/** Whether this machine has the venv. CI never does: it runs a bare 3.12 with nothing installed. */
export const HAS_VENV = existsSync(VENV_PYTHON)

/**
 * For a test that runs on ANY interpreter (sidecarMedia, the floor scan): the
 * venv when there is one, else `FORGE_PYTHON`, else `python3` — the fallback
 * these Python-only tests have always used. The helper itself is started in
 * the app's own development order instead (`devHelperLaunch`).
 */
export const HELPER_PYTHON = HAS_VENV ? VENV_PYTHON : process.env.FORGE_PYTHON ?? 'python3'

/**
 * The AI helper's launch in the app's own DEVELOPMENT order
 * (src/shared/sidecar/helperPython.ts `resolveHelperPython`, `packaged:
 * false`): `FORGE_PYTHON`, then this venv, then `python` on win32 and
 * `python3` elsewhere — started as `helperLaunch` starts that rung, so a
 * test runs the helper exactly as `npm run dev` does.
 *
 * The dev pack rung is not reached here: a test reaches the pack explicitly
 * (docs/CLIPS.md §3a.6, `FORGE_HELPER_PACK`, a later slice), so `pack` is
 * null and the machine's pack platform is never asked.
 */
export function devHelperLaunch(o: { modelsDir?: string; cacheDir?: string } = {}): HelperLaunch {
  const choice = resolveHelperPython({
    packaged: false,
    env: process.env,
    platform: process.platform,
    venvPython: HAS_VENV ? VENV_PYTHON : null,
    pack: null,
    manifest: HELPER_PACK,
    packPlatform: { unsupported: 'the tests reach the pack explicitly (CLIPS §3a.6)' }
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
 * window.
 */
export function launchFor(python: string, o: { modelsDir?: string; cacheDir?: string } = {}): HelperLaunch {
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
  const missing = [
    ...(HAS_VENV ? [] : [`no helper venv at ${VENV_PYTHON}`]),
    ...Object.entries(needs)
      .filter(([, met]) => !met)
      .map(([what]) => `no ${what}`)
  ]
  if (missing.length === 0) describe(name, body)
  else describe.skip(`${name} — skipped: ${missing.join('; ')}`, body)
}
