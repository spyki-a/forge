import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { FFMPEG, outputDir } from './output'

/*
 * The helper's shared media code, through its own Python tests
 * (tests/sidecar/test_media.py; sidecar/forge_sidecar/media.py,
 * docs/CLIPS.md §3.6).
 *
 * Run with the helper's interpreter when this machine has one — the venv,
 * which has numpy, so every test runs — and otherwise with the one the
 * sidecar tests use, `FORGE_PYTHON` or `python3`: on CI a bare 3.12 with
 * nothing installed. There the six numpy frame tests skip, and ONLY those: a
 * skip for any other reason is a failure here, so a bare interpreter still
 * runs the probe, the decodes and the frame stream read as bytes (the helper's
 * own argv through the bundled ffmpeg — on CI the 2018 Windows build — and
 * `iter_frames` with a stand-in numpy, cancel → kill included), the folders,
 * the downloads' guards and the registration.
 */

const ROOT = resolve(__dirname, '../..')
const SIDECAR = join(ROOT, 'sidecar')
const VENV = join(SIDECAR, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const PYTHON = existsSync(VENV) ? VENV : process.env.FORGE_PYTHON ?? 'python3'

interface Outcome {
  code: number
  text: string
}

function unittest(out: string): Promise<Outcome> {
  return new Promise((done) => {
    execFile(
      PYTHON,
      ['-m', 'unittest', 'discover', '-s', join(ROOT, 'tests', 'sidecar'), '-p', 'test_*.py', '-v'],
      {
        cwd: ROOT,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          PYTHONPATH: SIDECAR,
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONIOENCODING: 'utf-8',
          FORGE_TEST_FFMPEG: FFMPEG,
          FORGE_TEST_FFPROBE: ffprobeInstaller.path,
          FORGE_TEST_OUT: out
        }
      },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0
        done({ code, text: `${stdout}${stderr}` })
      }
    )
  })
}

describe('the helper’s media module', () => {
  it('passes its own tests on this interpreter', async () => {
    const dir = await outputDir('sidecar-media')
    const { code, text } = await unittest(dir)
    await writeFile(join(dir, 'unittest.txt'), `${PYTHON}\n\n${text}`, 'utf8')

    expect(code, text).toBe(0)
    const ran = Number(/Ran (\d+) tests?/.exec(text)?.[1] ?? 0)
    // Thirty-two today; a test file that stopped being found would run none.
    expect(ran, text).toBeGreaterThanOrEqual(32)
    const skipped = [...text.matchAll(/\.\.\. skipped '([^']*)'/g)].map((m) => m[1])
    for (const reason of skipped) expect(reason, 'only numpy may be missing').toBe('numpy is not installed')
    // The venv has numpy: there, nothing may skip.
    if (PYTHON === VENV) expect(skipped, text).toEqual([])
  }, 300_000)
})
