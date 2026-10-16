import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { HELPER_PACK } from '../src/shared/sidecar/packManifest'
import { cachedPackIn, packSuiteGate, pipCheckProblems, pythonCasesGate } from './integration/venv'

/*
 * The decisions CI's pack steps rest on (.github/workflows/ci.yml, docs/CLIPS.md
 * §3a.6), each a pure function in tests/integration/venv.ts so a wrong one
 * fails here, on every machine, rather than only on a runner with a cache:
 *
 *   - `cachedPackIn`: whether helperPack.int checks a restored pack again or
 *     installs (a stale receipt must install);
 *   - `packSuiteGate`: helperPack.int runs, skips, or FAILS (CI's step without
 *     FORGE_PACK_REAL);
 *   - `pythonCasesGate`: sidecarMedia.int's Python cases on a pack that was
 *     asked for and does not run;
 *   - `pipCheckProblems`: pip check's allowed lines, by membership.
 */

const MAC = HELPER_PACK.platforms['darwin-arm64']
const USERDATA = '/runner/temp/forge pack é/userData'
const VERSION_DIR = join(USERDATA, 'python', String(HELPER_PACK.pack))
const PYTHON = join(VERSION_DIR, MAC.python)

/** A receipt as the job writes it, for this build's darwin-arm64 pack. */
const RECEIPT = {
  pack: HELPER_PACK.pack,
  python: HELPER_PACK.python.version,
  build: HELPER_PACK.python.build,
  platform: 'darwin-arm64',
  interpreterSha256: MAC.interpreter.sha256,
  lockSha256: MAC.lock.sha256,
  bytesOnDisk: 675_763_387,
  installedAt: '2026-10-16T00:00:00.000Z',
  appVersion: 'helperPack.int',
  hello: { capabilities: [], degraded: {} },
  selftest: {}
}

function onDisk(receipt: unknown, files: string[]): { exists(path: string): boolean; receiptOf(dir: string): unknown } {
  return {
    exists: (path) => files.includes(path),
    receiptOf: (dir) => (dir === VERSION_DIR ? receipt : null)
  }
}

describe('helperPack.int’s cached mode (cachedPackIn)', () => {
  const both = [join(VERSION_DIR, 'pack.json'), PYTHON]

  it('checks again a pack this build accepts: the receipt’s platform and both hashes the manifest’s, its interpreter there', () => {
    const r = cachedPackIn(USERDATA, { mutation: null, platform: 'darwin', arch: 'arm64', ...onDisk(RECEIPT, both) })
    expect('cached' in r && r.cached.versionDir).toBe(VERSION_DIR)
  })

  it('installs over a stale receipt: a lock this build no longer pins', () => {
    const stale = { ...RECEIPT, lockSha256: '0'.repeat(64) }
    const r = cachedPackIn(USERDATA, { mutation: null, platform: 'darwin', arch: 'arm64', ...onDisk(stale, both) })
    expect(r).toEqual({ install: `FORGE_HELPER_PACK=${USERDATA} names no AI helper pack that runs here: no pack.json this build accepts (its hashes must be the manifest’s)` })
  })

  it('installs over a stale interpreter, a receipt for another platform, and a matching receipt whose interpreter is gone', () => {
    for (const receipt of [{ ...RECEIPT, interpreterSha256: 'f'.repeat(64) }, { ...RECEIPT, platform: 'win32-x64' }]) {
      expect('install' in cachedPackIn(USERDATA, { mutation: null, platform: 'darwin', arch: 'arm64', ...onDisk(receipt, both) })).toBe(true)
    }
    const gone = cachedPackIn(USERDATA, { mutation: null, platform: 'darwin', arch: 'arm64', ...onDisk(RECEIPT, [join(VERSION_DIR, 'pack.json')]) })
    expect('install' in gone).toBe(true)
  })

  it('installs with no userData named, and for a mutation, whatever is on disk', () => {
    expect(cachedPackIn(null, { mutation: null, platform: 'darwin', arch: 'arm64', ...onDisk(RECEIPT, both) })).toEqual({ install: 'no FORGE_PACK_USERDATA: a fresh userData of the run’s own' })
    expect(cachedPackIn(USERDATA, { mutation: 'librosa', platform: 'darwin', arch: 'arm64', ...onDisk(RECEIPT, both) })).toEqual({ install: 'the mutation librosa installs a pack of its own' })
  })
})

describe('helperPack.int runs, skips, or fails (packSuiteGate)', () => {
  it('runs with FORGE_PACK_REAL=1, skips naming the variable without it, and FAILS for CI’s step without it', () => {
    expect(packSuiteGate({ real: true, askedUserData: USERDATA })).toEqual({ run: true })
    expect(packSuiteGate({ real: true, askedUserData: null })).toEqual({ run: true })
    expect(packSuiteGate({ real: false, askedUserData: null })).toEqual({ skip: 'FORGE_PACK_REAL is not 1' })
    const failed = packSuiteGate({ real: false, askedUserData: USERDATA })
    expect('fail' in failed && failed.fail).toContain('FORGE_PACK_USERDATA is set')
  })
})

describe('sidecarMedia.int’s Python cases (pythonCasesGate)', () => {
  it('fails on a pack that was asked for and does not run, never running its cases lenient', () => {
    expect(pythonCasesGate({ packAsked: true, packProblem: 'no pack.json', hasVenv: false })).toEqual({ fail: 'no pack.json' })
  })

  it('lets nothing skip on the pack or the venv, and only a bare interpreter skip the numpy cases', () => {
    expect(pythonCasesGate({ packAsked: true, packProblem: null, hasVenv: true })).toEqual({ strict: true })
    expect(pythonCasesGate({ packAsked: false, packProblem: null, hasVenv: true })).toEqual({ strict: true })
    expect(pythonCasesGate({ packAsked: false, packProblem: null, hasVenv: false })).toEqual({ strict: false })
  })
})

describe('pip check inside the pack (pipCheckProblems)', () => {
  const MEDIAPIPE = ['mediapipe 0.10.35 requires matplotlib, which is not installed.', 'mediapipe 0.10.35 requires opencv-contrib-python, which is not installed.']
  const HF_XET = 'huggingface-hub 1.31.0 requires hf-xet, which is not installed.'
  const withXet = [{ name: 'hf_xet-1.6.0-cp38-abi3-win_amd64.whl' }, { name: 'numpy-2.3.4-cp314-cp314-win_amd64.whl' }]
  const withoutXet = [{ name: 'numpy-2.3.4-cp314-cp314-win_amd64.whl' }]

  it('allows mediapipe’s two and "No broken requirements found.", by membership', () => {
    expect(pipCheckProblems(MEDIAPIPE, withXet)).toEqual([])
    expect(pipCheckProblems([MEDIAPIPE[1]], withXet)).toEqual([])
    expect(pipCheckProblems(['No broken requirements found.'], withXet)).toEqual([])
  })

  it('allows huggingface-hub’s hf-xet only once the lock leaves hf-xet out', () => {
    expect(pipCheckProblems([...MEDIAPIPE, HF_XET], withXet)).toEqual([HF_XET])
    expect(pipCheckProblems([...MEDIAPIPE, HF_XET], withoutXet)).toEqual([])
  })

  it('reports anything else, a version conflict of mediapipe’s included', () => {
    const conflict = 'mediapipe 0.10.35 has requirement numpy<2, but you have numpy 2.3.4.'
    const missing = 'librosa 1.0.0 requires numba, which is not installed.'
    expect(pipCheckProblems([...MEDIAPIPE, conflict, missing], withoutXet)).toEqual([conflict, missing])
  })

  it('reads the real manifests: hf-xet is either pinned on a platform or allowed missing there', () => {
    for (const pack of Object.values(HELPER_PACK.platforms)) {
      const pinned = pack.wheels.some((w) => w.name.startsWith('hf_xet-'))
      expect(pipCheckProblems([HF_XET], pack.wheels)).toEqual(pinned ? [HF_XET] : [])
    }
  })
})
