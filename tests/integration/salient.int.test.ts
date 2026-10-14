import { afterAll, beforeAll, expect, it } from 'vitest'
import { constants as fsConstants, existsSync } from 'node:fs'
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { SidecarClient } from '../../src/main/sidecar/client'
import {
  RPC_ERRORS,
  SIDECAR_METHODS,
  type ModelStatus,
  type SalientItem,
  type SalientParams,
  type SalientResult
} from '@shared/sidecar/protocol'
import type { UnitRect } from '@shared/reframe/types'
import { FFMPEG, outputDir, run, writeNote } from './output'
import { SIDECAR_DIR, VENV_PYTHON, describeWithVenv, launchFor } from './venv'

/*
 * vision.salient through the real helper and the real BiRefNet_lite
 * (docs/CLIPS.md §4.4, §4.9): the subject of a frame with no face.
 *
 * The media is made here — a bright disc moving over a dark field, a flat
 * grey card, and the disc clip remuxed with a quarter turn — so the right
 * answer is known by construction and nothing third-party is involved. The
 * model is NOT downloaded: it is copied from this machine's own store (the
 * app's userData/models, or FORGE_TEST_MODELS) into a folder of the test's,
 * and the suite skips, saying so, where there is none. The gated case needs
 * no model at all, only the venv.
 *
 * Each matte is about 8 s on the dev Mac (measured 2026-10-13, 7.9–9.3 s, fp16
 * on the CPU provider at 1024²), so the whole file is a minute or so.
 */

const PROBE = ffprobeInstaller.path

/** depth.py MATTE_REVISION: the commit the helper loads, and the one the store must hold. */
const MATTE_REVISION = 'de15b22ba131738a16dff04aab8bdf8dc32e3ac1'
const REPO_FOLDER = 'models--onnx-community--BiRefNet_lite'

/** Where the app keeps its models: userData/models (src/main/sidecar/service.ts helperFolders). */
function appModels(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'forge', 'models')
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'forge', 'models')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'forge', 'models')
}
const STORE = process.env.FORGE_TEST_MODELS ?? appModels()
const HAS_MODEL = existsSync(join(STORE, REPO_FOLDER, 'snapshots', MATTE_REVISION, 'onnx', 'model_fp16.onnx'))

const MODEL: ModelStatus = { present: true, bytes: 114_538_221, label: 'the subject finder', host: 'huggingface.co' }

/* The disc: radius 60 px, its centre at y 150 and x 120 + 160 px a second, on a 640×360 frame. */
const R = 60
const CY = 150
const centreX = (ms: number): number => 120 + (160 * ms) / 1000
const DISC = `color=c=black:s=640x360:r=30:d=3,format=yuv420p,geq=lum='if(lte(hypot(X-(120+160*T)\\,Y-${CY})\\,${R})\\,235\\,16)':cb=128:cr=128`

/** Where the disc was drawn, normalised to the 640×360 frame. */
function drawn(ms: number): UnitRect {
  return { x: (centreX(ms) - R) / 640, y: (CY - R) / 360, width: (2 * R) / 640, height: (2 * R) / 360 }
}

/**
 * The same disc in the turned clip's UPRIGHT 360×640 frame. The decoder turns
 * a `rotate=90` remux counter-clockwise — np.rot90's way, measured in
 * tests/sidecar/test_media.py on both builds — so a coded (x, y) lands at
 * (y, 640 − x).
 */
function drawnUpright(ms: number): UnitRect {
  return { x: (CY - R) / 360, y: (640 - centreX(ms) - R) / 640, width: (2 * R) / 360, height: (2 * R) / 640 }
}

function near(item: SalientItem | undefined, want: UnitRect, label: string): void {
  expect(item && 'box' in item, `${label}: ${JSON.stringify(item)}`).toBe(true)
  const box = (item as { box: UnitRect | null }).box
  expect(box, `${label}: no box`).not.toBeNull()
  for (const side of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(box![side] - want[side]), `${label} ${side}: ${box![side]} against ${want[side].toFixed(4)}`).toBeLessThanOrEqual(0.05)
  }
}

async function lavfi(out: string, source: string): Promise<void> {
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', source, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', out])
}

/**
 * The names of a process's children — to see that no ffmpeg outlives a
 * cancelled call. `ps` and `pgrep` cannot list processes inside the dev
 * sandbox, but libproc can, through the helper's own interpreter; /proc on
 * Linux; CIM on Windows (unmeasured there).
 */
async function childrenOf(pid: number): Promise<string[]> {
  if (process.platform === 'win32') {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | ForEach-Object { $_.Name }`], { windowsHide: true })
    return stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  }
  if (process.platform === 'linux') {
    const names: string[] = []
    for (const entry of await readdir('/proc')) {
      if (!/^\d+$/.test(entry)) continue
      const stat = await readFile(join('/proc', entry, 'stat'), 'utf8').catch(() => '')
      const close = stat.lastIndexOf(')')
      if (close < 0) continue
      if (Number(stat.slice(close + 2).split(' ')[1]) === pid) names.push(stat.slice(stat.indexOf('(') + 1, close))
    }
    return names
  }
  const script = [
    'import ctypes, sys',
    "lib = ctypes.CDLL('/usr/lib/libproc.dylib')",
    'buf = (ctypes.c_int * 4096)()',
    'lib.proc_listchildpids(int(sys.argv[1]), buf, ctypes.sizeof(buf))',
    'for child in [p for p in buf if p > 0]:',
    '    name = ctypes.create_string_buffer(256)',
    '    lib.proc_name(child, name, 256)',
    '    print(name.value.decode())'
  ].join('\n')
  const { stdout } = await run(VENV_PYTHON, ['-c', script, String(pid)])
  return stdout.split('\n').map((s) => s.trim()).filter(Boolean)
}

/** The helper's own process: the client keeps it private, and these checks need its pid and its raw answers. */
function helperOf(client: SidecarClient): { pid?: number; stdout: NodeJS.ReadableStream } {
  const child = (client as unknown as { child: { pid?: number; stdout: NodeJS.ReadableStream } | null }).child
  if (!child) throw new Error('the AI helper is not running')
  return child
}

async function until(test: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms
  while (!test()) {
    if (Date.now() > deadline) throw new Error(`gave up waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 100))
  }
}

describeWithVenv(
  'vision.salient',
  () => {
    let dir = ''
    let models = ''
    let client: SidecarClient
    const media: Record<'disc' | 'flat' | 'turned' | 'missing', string> = { disc: '', flat: '', turned: '', missing: '' }
    let status: ModelStatus
    let answers: SalientItem[] = []
    let upright: SalientItem[] = []
    const seen: { at: number; progress: number | null; message?: string }[] = []

    beforeAll(async () => {
      dir = await outputDir('salient')
      media.disc = join(dir, 'disc.mp4')
      media.flat = join(dir, 'flat.mp4')
      media.turned = join(dir, 'disc-rotate90.mp4')
      media.missing = join(dir, 'missing.mp4')
      await lavfi(media.disc, DISC)
      await lavfi(media.flat, 'color=c=0x808080:s=640x360:r=30:d=1')
      await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', media.disc, '-c', 'copy', '-metadata:s:v:0', 'rotate=90', media.turned])

      // A copy of this machine's model, so nothing the helper does can touch the app's own store.
      models = await mkdtemp(join(tmpdir(), 'forge-salient-models-'))
      await cp(join(STORE, REPO_FOLDER), join(models, REPO_FOLDER), {
        recursive: true,
        verbatimSymlinks: true,
        mode: fsConstants.COPYFILE_FICLONE
      })

      client = new SidecarClient({ cwd: SIDECAR_DIR, launch: launchFor(VENV_PYTHON, { modelsDir: models, cacheDir: join(models, 'cache') }), maxRestarts: 0 })
      await client.start()
      status = await client.request<ModelStatus>(SIDECAR_METHODS.salientModel, {})

      const started = Date.now()
      const params: SalientParams = {
        items: [
          { path: media.disc, ms: 500 },
          { path: media.disc, ms: 1500 },
          { path: media.disc, ms: 2500 },
          { path: media.flat, ms: 500 },
          { path: media.turned, ms: 500 },
          { path: media.missing, ms: 0 }
        ],
        ffmpeg: FFMPEG,
        ffprobe: PROBE,
        width: 640,
        height: 360
      }
      answers = (
        await client.request<SalientResult>(SIDECAR_METHODS.salient, params, {
          onProgress: (progress, message) => seen.push({ at: Date.now() - started, progress, message })
        })
      ).results
      const wide = Date.now() - started

      const turnedAt = Date.now()
      upright = (
        await client.request<SalientResult>(SIDECAR_METHODS.salient, {
          items: [
            { path: media.turned, ms: 500 },
            { path: media.turned, ms: 1500 }
          ],
          ffmpeg: FFMPEG,
          ffprobe: PROBE,
          width: 360,
          height: 640
        } satisfies SalientParams)
      ).results
      const turned = Date.now() - turnedAt

      await writeNote(dir, [
        '# vision.salient',
        '',
        `model status: ${JSON.stringify(status)}`,
        `the 640×360 call, ${params.items.length} items, the session's first build included: ${wide} ms`,
        ...answers.map((a, i) => `- ${params.items[i].path.split(/[\\/]/).pop()} @ ${a.ms} ms: ${JSON.stringify(a)}`),
        `progress: ${seen.map((s) => `${s.at} ms ${s.progress}`).join(', ')}`,
        '',
        `the turned clip as 360×640, 2 items: ${turned} ms`,
        ...upright.map((a) => `- disc-rotate90.mp4 @ ${a.ms} ms: ${JSON.stringify(a)}`),
        '',
        'drawn:',
        ...[500, 1500, 2500].map((ms) => `- ${ms} ms: ${JSON.stringify(drawn(ms))}; upright ${JSON.stringify(drawnUpright(ms))}`)
      ])
    }, 300_000)

    afterAll(async () => {
      client?.stop()
      if (models) await rm(models, { recursive: true, force: true })
    })

    it('says the model is on disk, with what the Get button names', () => {
      expect(status).toEqual(MODEL)
    })

    it('finds the disc where it was drawn, at each of three times', () => {
      for (const [at, ms] of [[0, 500], [1, 1500], [2, 2500]]) {
        expect(answers[at].ms).toBe(ms)
        near(answers[at], drawn(ms), `disc @ ${ms}`)
        // About 4.9 % of the frame: π·60² of 640×360.
        expect((answers[at] as { coverage: number }).coverage).toBeGreaterThan(0.03)
        expect((answers[at] as { coverage: number }).coverage).toBeLessThan(0.07)
      }
    })

    it('gives a flat frame no box, and says how much of it the matte covered', () => {
      const flat = answers[3]
      expect(flat).toMatchObject({ ms: 500, box: null })
      const coverage = (flat as { coverage: number }).coverage
      expect(typeof coverage).toBe('number')
      // Null only because the coverage is outside 1–92 %.
      expect(coverage < 0.01 || coverage > 0.92, `coverage ${coverage}`).toBe(true)
    })

    it('answers a file that is not the size sent with that item’s error, and the rest of the call', () => {
      expect(answers).toHaveLength(6)
      expect(answers[4]).toEqual({ ms: 500, error: expect.stringMatching(/360×640 upright.*640×360 was sent/) })
      expect(answers[5]).toEqual({ ms: 0, error: expect.stringMatching(/No such file/) })
      for (const at of [0, 1, 2, 3]) expect(answers[at], `item ${at}`).not.toHaveProperty('error')
    })

    it('reports each item as it goes, from nothing to whole', () => {
      const fractions = seen.map((s) => s.progress)
      expect(fractions).toEqual([0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1].map((f) => expect.closeTo(f, 6)))
      expect(new Set(seen.map((s) => s.message))).toEqual(new Set(['finding the subject']))
    })

    it('answers in the UPRIGHT frame of a turned clip', () => {
      expect(upright).toHaveLength(2)
      near(upright[0], drawnUpright(500), 'turned @ 500')
      near(upright[1], drawnUpright(1500), 'turned @ 1500')
    })

    it('stops between items when cancelled, and leaves no ffmpeg child', async () => {
      const helper = helperOf(client)
      let raw = ''
      const listen = (chunk: string | Buffer): void => {
        raw += chunk.toString()
      }
      helper.stdout.on('data', listen)
      type Line = { id?: number; method?: string; params?: { id: number; progress: number | null }; error?: { code: number } }
      // Whole lines only: the last piece may be a message still arriving.
      const lines = (): Line[] => raw.split('\n').slice(0, -1).map((l) => JSON.parse(l) as Line)

      const controller = new AbortController()
      const items = Array.from({ length: 8 }, (_, i) => ({ path: media.disc, ms: 100 + i * 300 }))
      const call = client.request(SIDECAR_METHODS.salient, { items, ffmpeg: FFMPEG, ffprobe: PROBE, width: 640, height: 360 } satisfies SalientParams, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress !== null && progress > 0) controller.abort()
        }
      })
      await expect(call).rejects.toMatchObject({ code: RPC_ERRORS.cancelled })

      // The helper's own answer: the item in hand finishes, then the check before the next one ends the call.
      await until(() => lines().some((l) => l.error?.code === RPC_ERRORS.cancelled), 60_000, 'the helper to answer the cancel')
      helper.stdout.off('data', listen)
      const id = lines().find((l) => l.error?.code === RPC_ERRORS.cancelled)!.id
      const done = lines().filter((l) => l.method === 'progress' && l.params?.id === id && (l.params?.progress ?? 0) > 0)
      expect(done.length, 'items finished before the call ended').toBeLessThanOrEqual(2)

      const children = await childrenOf(helper.pid!)
      expect(children.filter((name) => /ffmpeg/i.test(name)), `the helper's children: ${children.join(', ')}`).toEqual([])
      // And it still answers.
      const status = await client.request<ModelStatus>(SIDECAR_METHODS.salientModel, {})
      expect(status.present).toBe(true)
    }, 120_000)
  },
  { [`BiRefNet_lite at ${MATTE_REVISION.slice(0, 7)} in ${STORE} (set FORGE_TEST_MODELS)`]: HAS_MODEL }
)

describeWithVenv('vision.salient without its model', () => {
  let models = ''
  let client: SidecarClient

  beforeAll(async () => {
    models = await mkdtemp(join(tmpdir(), 'forge-salient-empty-'))
    /*
     * Any request the helper made would have nowhere to go: Hugging Face's
     * endpoint and every proxy point at a port nothing listens on. A fetch
     * would then fail with a connection error and leave its .locks and repo
     * folders behind, not answer "not downloaded yet" from an empty folder.
     */
    const unreachable = 'http://127.0.0.1:9'
    const saved = { HF_ENDPOINT: process.env.HF_ENDPOINT, HTTPS_PROXY: process.env.HTTPS_PROXY, HTTP_PROXY: process.env.HTTP_PROXY, NO_PROXY: process.env.NO_PROXY }
    Object.assign(process.env, { HF_ENDPOINT: unreachable, HTTPS_PROXY: unreachable, HTTP_PROXY: unreachable, NO_PROXY: '' })
    // Its launch copies the environment above as it is built, before the restore below.
    client = new SidecarClient({ cwd: SIDECAR_DIR, launch: launchFor(VENV_PYTHON, { modelsDir: models }), maxRestarts: 0 })
    const started = client.start()
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    const hello = await started
    expect(hello.capabilities).toEqual(expect.arrayContaining([SIDECAR_METHODS.salient, SIDECAR_METHODS.salientModel]))
  }, 60_000)

  afterAll(async () => {
    client?.stop()
    if (models) await rm(models, { recursive: true, force: true })
  })

  it('says the model is absent, with what the Get button names, and fetches nothing', async () => {
    expect(await client.request<ModelStatus>(SIDECAR_METHODS.salientModel, {})).toEqual({ ...MODEL, present: false })
    expect(await readdir(models)).toEqual([])
  })

  it('refuses the work as unavailable, before any session, with nothing written and no request made', async () => {
    const out = await outputDir('salient-absent')
    const clip = join(out, 'flat.mp4')
    await lavfi(clip, 'color=c=0x808080:s=640x360:r=30:d=1')
    await expect(
      client.request(SIDECAR_METHODS.salient, { items: [{ path: clip, ms: 0 }], ffmpeg: FFMPEG, ffprobe: PROBE, width: 640, height: 360 } satisfies SalientParams)
    ).rejects.toMatchObject({ code: RPC_ERRORS.unavailable, message: 'the subject finder is not downloaded yet (115 MB from huggingface.co)' })
    expect(await readdir(models)).toEqual([])
  })
})
