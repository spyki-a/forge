import { describe } from 'vitest'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

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
 * venv when there is one, else `FORGE_PYTHON`, else `python3` — the same
 * fallback order as the app's own `SidecarClient` (src/main/sidecar/client.ts).
 */
export const HELPER_PYTHON = HAS_VENV ? VENV_PYTHON : process.env.FORGE_PYTHON ?? 'python3'

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
