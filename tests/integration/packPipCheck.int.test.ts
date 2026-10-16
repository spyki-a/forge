import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { HELPER_PACK } from '../../src/shared/sidecar/packManifest'
import { isUnsupported } from '../../src/shared/sidecar/pack'
import { PACK_UNDER_TEST, packLaunch, pipCheckProblems, testMachine } from './venv'

/*
 * `pip check` from inside the AI helper's pack (docs/CLIPS.md §3a.6 step 5):
 * CI's own step, after the pack is installed (or its cache checked) and the
 * suites have run from it. `<pack python> -E -s -m pip check`, through the
 * pack rung's environment; every problem it reports must be one the lock
 * leaves out on purpose (venv.ts `pipCheckProblems`, by membership:
 * mediapipe's matplotlib and opencv-contrib-python, and huggingface-hub's
 * hf-xet once the lock no longer pins it).
 *
 * Runs only under FORGE_HELPER_PACK, and there FAILS on a pack that does not
 * run here (packLaunch throws why). helperPack.int asserts the same over the
 * pack it has just installed.
 */

const title = 'pip check inside the AI helper pack FORGE_HELPER_PACK names'

if (!PACK_UNDER_TEST) describe.skip(`${title} — skipped: FORGE_HELPER_PACK is not set`, () => it('runs pip check', () => undefined))
else
  describe(title, () => {
    const pack = PACK_UNDER_TEST!

    it('reports nothing but what the lock leaves out on purpose', () => {
      const launch = packLaunch(pack)
      const machine = testMachine(process.platform, process.arch)
      if (isUnsupported(machine)) throw new Error(machine.unsupported)
      const checked = spawnSync(pack.python, ['-E', '-s', '-m', 'pip', 'check', '--disable-pip-version-check'], {
        cwd: tmpdir(),
        env: launch.env,
        encoding: 'utf8',
        windowsHide: true
      })
      if (checked.error) throw checked.error
      const lines = `${checked.stdout}`.split(/\r?\n/).filter((line) => line.trim() !== '')
      console.log(`pip check in ${pack.versionDir} (exit ${checked.status}):\n${lines.join('\n')}`)
      const reported = lines.filter((line) => line.trim() !== 'No broken requirements found.')
      expect(checked.status, `${checked.stderr}${lines.join('\n')}`).toBe(reported.length === 0 ? 0 : 1)
      expect(pipCheckProblems(lines, HELPER_PACK.platforms[machine].wheels)).toEqual([])
    })
  })
