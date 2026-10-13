import { afterAll, beforeAll, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join, resolve, sep } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { SidecarClient } from '../../src/main/sidecar/client'
import {
  RPC_ERRORS,
  SIDECAR_METHODS,
  type FacesParams,
  type FacesResult,
  type FacesTrack,
  type HelloResult,
  type ModelStatus
} from '@shared/sidecar/protocol'
import type { FaceBox } from '@shared/reframe/types'
import { FFMPEG, OUTPUT_ROOT, outputDir, run, writeNote } from './output'
import { HAS_VENV, SIDECAR_DIR, VENV_PYTHON, describeWithVenv } from './venv'

/*
 * The face finder through the real AI helper and its real worker
 * (docs/CLIPS.md §4.3, §4.9): sidecar/forge_sidecar/capabilities/faces.py
 * and workers/mp_faces.py.
 *
 * The sandbox this was built in has no Metal device, and MediaPipe's macOS
 * wheel aborts the process there even on the CPU delegate (docs/EFFECTS.md
 * §37). So the first suite proves everything BUT the detection: the install
 * (mediapipe imports in the worker with the stubs and not without them), the
 * helper's own path kept clean of the stubs, the real detector's death
 * reported as the code it died with while the helper keeps answering, the
 * model gate, the cache, the cancel — and the pass itself, the track's
 * shape, the two largest faces first, source ms, the upright frame of a
 * turned clip, through the worker's stand-in detector
 * (FORGE_FACES_WORKER_FAKE=colour: each saturated colour's bounding box).
 *
 * The second suite is the detection, on the user's own face fixture
 * (decision §16.5; gitignored, never committed), and runs only when asked:
 *
 *     FORGE_FACES_REAL=1 npx vitest run tests/integration/faces.int.test.ts
 *
 * Both need the helper's venv with requirements-faces.txt and
 * requirements-faces-nodeps.txt installed.
 */

const FFPROBE: string = ffprobeInstaller.path
const STUBS = join(SIDECAR_DIR, 'forge_sidecar', 'stubs')
/** The model the user's Mac detected with (EFFECTS §37); seeds a models folder so no test downloads. */
const SEED = join(SIDECAR_DIR, '.venv-faces', 'models', 'blaze_face_full_range.tflite')
const FIXTURE = resolve(__dirname, '../../references/recordings/face-fixture-2026-10-05.mov')
const USER_COMMAND = 'FORGE_FACES_REAL=1 npx vitest run tests/integration/faces.int.test.ts'
const HAS_MEDIAPIPE =
  HAS_VENV &&
  spawnSync(VENV_PYTHON, ['-c', 'import importlib.util, sys; sys.exit(0 if importlib.util.find_spec("mediapipe") else 1)'], {
    windowsHide: true
  }).status === 0
const NEEDS = { 'mediapipe in the helper venv (sidecar/requirements-faces*.txt)': HAS_MEDIAPIPE }

/* ----------------------------------------------------------------- helpers */

/** Run Python on the helper's interpreter with the package importable, and parse what it prints. */
async function python<T>(code: string, env: Record<string, string> = {}): Promise<T> {
  const { stdout } = await run(VENV_PYTHON, ['-c', code], {
    cwd: SIDECAR_DIR,
    env: { ...process.env, ...env },
    windowsHide: true,
    maxBuffer: 8 << 20
  })
  return JSON.parse(stdout) as T
}

const clients: SidecarClient[] = []
const logs = new Map<SidecarClient, string[]>()

/**
 * A helper with its own folders and, for this one process, extra environment
 * (the worker inherits the helper's). SidecarClient spawns synchronously
 * inside start(), before its first await, so the variables are back as they
 * were before any other helper starts.
 */
async function helper(o: { models: string; cache: string; env?: Record<string, string>; python?: string }): Promise<SidecarClient> {
  const saved: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(o.env ?? {})) {
    saved[name] = process.env[name]
    process.env[name] = value
  }
  const client = new SidecarClient({ cwd: SIDECAR_DIR, python: o.python ?? VENV_PYTHON, modelsDir: o.models, cacheDir: o.cache, maxRestarts: 0 })
  clients.push(client)
  const lines: string[] = []
  logs.set(client, lines)
  client.on('log', (text: string) => lines.push(...text.split('\n')))
  let started: Promise<HelloResult>
  try {
    started = client.start()
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
  await started
  return client
}

/** Whether a process is still there: signal 0 asks without sending anything (`ps` is not allowed in the sandbox). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Poll `test` every 50 ms for up to `ms`; its last answer. */
async function until(test: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await test()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return test()
}

/** The pids faces.py logged for its workers ("faces: worker <pid> started"). */
function workerPids(client: SidecarClient): number[] {
  return (logs.get(client) ?? []).flatMap((line) => {
    const found = /faces: worker (\d+) started/.exec(line)
    return found ? [Number(found[1])] : []
  })
}

function expectRejection(promise: Promise<unknown>, code: number, message: RegExp): Promise<void> {
  return expect(promise).rejects.toMatchObject({ code, message: expect.stringMatching(message) })
}

const ff = (...args: string[]): Promise<unknown> => run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args])

/** Box drawn at (x, y, w, h) px on a 640×360 frame; the stand-in scores blue 0.7, green 0.8, red 0.9, yellow 0.3. */
type Px = [number, number, number, number]
const SCENES: { blue: Px; green: Px; red: Px; yellow: Px }[] = [
  { blue: [40, 40, 200, 160], green: [300, 60, 120, 100], red: [480, 220, 40, 40], yellow: [560, 40, 60, 60] },
  { blue: [360, 180, 200, 160], green: [40, 200, 120, 100], red: [300, 40, 40, 40], yellow: [100, 40, 60, 60] }
]
const HEX = { blue: '0x0000FF', green: '0x00FF00', red: '0xFF0000', yellow: '0xFFFF00' } as const

function drawn(scene: (typeof SCENES)[number]): string {
  return (Object.keys(HEX) as (keyof typeof HEX)[])
    .map((c) => `drawbox=x=${scene[c][0]}:y=${scene[c][1]}:w=${scene[c][2]}:h=${scene[c][3]}:color=${HEX[c]}:t=fill`)
    .join(',')
}

/** A px box as the track holds it, on a 640×360 frame. */
function unit([x, y, w, h]: Px): { x: number; y: number; width: number; height: number } {
  return { x: x / 640, y: y / 360, width: w / 640, height: h / 360 }
}

/**
 * The same box after the decoder turns the picture a quarter COUNTER-clockwise,
 * which is what a `rotate=90` remux gets (np.rot90's direction, measured in
 * tests/sidecar/test_media.py).
 */
function turned(b: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
  return { x: b.y, y: 1 - b.x - b.width, width: b.height, height: b.width }
}

function near(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height))
}

async function readTrack(path: string): Promise<FacesTrack> {
  return JSON.parse(await readFile(path, 'utf8')) as FacesTrack
}

/* ------------------------------------------------- the sandbox's suite */

let dir = ''
let models = ''
let modelPath = ''
const clips: Record<string, string> = {}
const notes: string[] = []

function params(path: string, extra: Partial<FacesParams> = {}): FacesParams {
  return { path, ffmpeg: FFMPEG, ffprobe: FFPROBE, width: 640, height: 360, key: '4000:1728912345678.5', ...extra }
}

afterAll(async () => {
  for (const client of clients) client.stop()
  if (dir) {
    await writeNote(dir, [
      '# vision.faces — the AI helper and its worker (docs/CLIPS.md §4.3)',
      '',
      'The detection itself needs a Mac with Metal (or the Surface); the sandbox aborts.',
      'Run it on your own machine with:',
      '',
      `    ${USER_COMMAND}`,
      '',
      'It writes what it found into tests/output/faces/real/README.txt.',
      '',
      ...notes
    ])
  }
})

describeWithVenv(
  'vision.faces — the helper, the worker and the stand-in detector',
  () => {
    beforeAll(async () => {
      dir = await outputDir('faces')
      models = join(dir, 'models')
      await mkdir(models, { recursive: true })
      modelPath = await python<string>('import json; from forge_sidecar.capabilities import faces; print(json.dumps(faces.model_path()))', {
        FORGE_MODELS_DIR: models
      })
      await mkdir(dirname(modelPath), { recursive: true })
      // The real model when this Mac has it (the abort test needs the detector to get that far); a
      // placeholder otherwise, which the stand-in never reads.
      if (existsSync(SEED)) await copyFile(SEED, modelPath)
      else await writeFile(modelPath, 'placeholder: the stand-in detector never reads the model')

      // Two scenes of four coloured boxes, 2 s each, lossless 4:4:4 so the colours survive exactly.
      clips.boxes = join(dir, 'boxes.mp4')
      await ff(
        '-f', 'lavfi', '-i', `color=c=black:s=640x360:r=30:d=2,${drawn(SCENES[0])}`,
        '-f', 'lavfi', '-i', `color=c=black:s=640x360:r=30:d=2,${drawn(SCENES[1])}`,
        '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv444p', clips.boxes
      )
      // The plan's turned copy: coded 640×360, decoded 360×640 — the picture on its side.
      clips.turned = join(dir, 'turned.mp4')
      await ff('-i', clips.boxes, '-c', 'copy', '-metadata:s:v:0', 'rotate=90', clips.turned)
      // A phone clip's shape: the picture stored on its side, coded 360×640, and the matrix turning it back upright.
      const sideways = join(dir, 'phone-coded.mp4')
      await ff('-i', clips.boxes, '-vf', 'transpose=clock', '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv444p', sideways)
      clips.phone = join(dir, 'phone.mp4')
      await ff('-i', sideways, '-c', 'copy', '-metadata:s:v:0', 'rotate=90', clips.phone)
      // Long enough to cancel in the middle of.
      clips.long = join(dir, 'long.mp4')
      await ff('-f', 'lavfi', '-i', `color=c=black:s=640x360:r=30:d=20,${drawn(SCENES[0])}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clips.long)
    }, 120_000)

    it('lists both methods as capabilities on the venv, and degrades both where mediapipe is absent', async () => {
      const hello = (await helper({ models, cache: join(dir, 'cache', 'hello') })).info!
      expect(hello.capabilities).toContain(SIDECAR_METHODS.faces)
      expect(hello.capabilities).toContain(SIDECAR_METHODS.facesModel)

      // An interpreter of the same Python with nothing installed: a venv made without pip.
      const bareDir = join(dir, 'bare-venv')
      await run(VENV_PYTHON, ['-m', 'venv', '--without-pip', bareDir], { windowsHide: true })
      const bare = join(bareDir, ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']))
      const client = await helper({ models, cache: join(dir, 'cache', 'bare'), python: bare })
      const without = client.info!
      for (const method of [SIDECAR_METHODS.faces, SIDECAR_METHODS.facesModel]) {
        expect(without.capabilities, method).not.toContain(method)
        expect(without.degraded[method], method).toMatch(/^faces unavailable: mediapipe is not installed/)
      }
      await expectRejection(client.request(SIDECAR_METHODS.faces, params(clips.boxes)), RPC_ERRORS.unavailable, /mediapipe is not installed/)
      notes.push(`- hello: a capability on ${VENV_PYTHON}; degraded on a bare venv: "${without.degraded[SIDECAR_METHODS.faces]}"`)
    }, 120_000)

    it('the worker imports mediapipe with the stubs first on ITS path, and fails on cv2 without them', async () => {
      const command = await python<{ argv: string[]; cwd: string; env: Record<string, string> }>(
        'import json; from forge_sidecar.capabilities import faces; print(json.dumps(faces.worker_command()))'
      )
      const start = (env: Record<string, string>): Promise<{ code: number | null; out: string; ms: number }> =>
        new Promise((done) => {
          const began = performance.now()
          const child = spawn(command.argv[0], command.argv.slice(1), { cwd: command.cwd, env, windowsHide: true })
          let out = ''
          child.stdout.on('data', (d: Buffer) => (out += d.toString()))
          child.stderr.on('data', (d: Buffer) => (out += d.toString()))
          child.on('exit', (code) => done({ code, out, ms: performance.now() - began }))
          child.stdin.end('{"mode": "import"}\n')
        })

      // The behaviour first, so a worker without its stubs fails here on the import's own words.
      const withStubs = await start(command.env)
      expect(withStubs.out).toMatch(/^ready 0\.10\.35 \d+\.\d{3}$/m)
      expect(withStubs.code, withStubs.out).toBe(0)
      expect(command.env.PYTHONPATH.split(delimiter)[0]).toBe(STUBS)

      // The same command with the stubs taken off its path: what the stubs are for.
      const parts = command.env.PYTHONPATH.split(delimiter).filter((p) => resolve(p) !== resolve(STUBS))
      const withoutStubs = await start({ ...command.env, PYTHONPATH: parts.join(delimiter) })
      expect(withoutStubs.out).toMatch(/error import ModuleNotFoundError: No module named 'cv2'/)
      expect(withoutStubs.code).toBe(69)
      notes.push(
        `- the worker, started and mediapipe imported: ${Math.round(withStubs.ms)} ms wall (${withStubs.out.trim()}); without the stubs: exit ${withoutStubs.code}, ${withoutStubs.out.trim()}`
      )
    }, 60_000)

    it("keeps the stubs off the helper's own path, and the worker's environment out of the helper's", async () => {
      // The helper's start, as __main__.py makes it: a Server, every capability registered.
      const seen = await python<{ path: string[]; pythonpath: string | null; cv2: string | null; capabilities: string[]; env: boolean }>(
        [
          'import importlib.util, json, os, sys',
          'from forge_sidecar.rpc import Server',
          'from forge_sidecar.capabilities import register_all, faces',
          'before = dict(os.environ)',
          'server = Server(); register_all(server)',
          'faces.worker_command()',
          'spec = importlib.util.find_spec("cv2")',
          'print(json.dumps({"path": sys.path, "pythonpath": os.environ.get("PYTHONPATH"), "cv2": spec.origin if spec else None,',
          '  "capabilities": server.capabilities, "env": dict(os.environ) == before}))'
        ].join('\n')
      )
      expect(seen.capabilities).toContain(SIDECAR_METHODS.faces)
      const stubs = resolve(STUBS)
      for (const entry of seen.path) expect(resolve(SIDECAR_DIR, entry || '.').startsWith(stubs), entry).toBe(false)
      expect(seen.pythonpath ?? '').not.toContain(stubs)
      // No real cv2 is installed; if one ever is, it must be that one the helper finds, not a stub.
      if (seen.cv2 !== null) expect(resolve(seen.cv2).startsWith(stubs + sep), seen.cv2).toBe(false)
      expect(seen.env).toBe(true)
    }, 60_000)

    it('the stand-in pass: the track on disk, two largest first, source ms, progress relayed', async () => {
      const client = await helper({ models, cache: join(dir, 'cache', 'pass'), env: { FORGE_FACES_WORKER_FAKE: 'colour' } })
      const progress: [number | null, string | undefined][] = []
      const result = await client.request<FacesResult>(SIDECAR_METHODS.faces, params(clips.boxes), {
        onProgress: (p, m) => progress.push([p, m])
      })
      expect(result).toMatchObject({ width: 640, height: 360, durationMs: 4000, sampleFps: 5, frames: 20, withFace: 20, cached: false })
      expect(result.detector).toBe('test-stand-in/colour')
      expect(result.track.startsWith(join(dir, 'cache', 'pass', 'faces') + sep)).toBe(true)
      expect(result.track.split(sep).pop()).not.toContain(':')

      const track = await readTrack(result.track)
      expect(track.version).toBe(1)
      expect(track.samples.map((s) => s.ms)).toEqual(Array.from({ length: 20 }, (_, i) => i * 200))
      for (const sample of track.samples) {
        const scene = SCENES[sample.ms < 2000 ? 0 : 1]
        // Two kept of the three over the floor: blue then green, by AREA (their scores are 0.7 and 0.8; red, 0.9, is smallest).
        expect(sample.faces.map((f) => f.score), String(sample.ms)).toEqual([0.7, 0.8])
        expect(near(sample.faces[0], unit(scene.blue)), `${sample.ms} blue`).toBeLessThan(0.01)
        expect(near(sample.faces[1], unit(scene.green)), `${sample.ms} green`).toBeLessThan(0.01)
      }
      // The worker's lines, relayed: fractions strictly inside the pass, in order, all "finding faces".
      const inside = progress.filter(([p]) => p !== null && p > 0 && p < 1)
      expect(inside.length, JSON.stringify(progress)).toBeGreaterThanOrEqual(2)
      expect(progress.every(([, m]) => m === 'finding faces')).toBe(true)
      const values = progress.map(([p]) => p ?? 0)
      expect(values).toEqual([...values].sort((a, b) => a - b))
      const size = (await stat(result.track)).size
      notes.push(`- the stand-in pass: ${result.frames} samples, ${size} B of track; progress ${JSON.stringify(values)}`)
    }, 60_000)

    it('a window: its samples carry SOURCE ms from startMs, and each box is the scene at that source time', async () => {
      /*
       * 1f analyses a clip's in/out window. Window-relative ms would put every
       * box at the wrong source time and still look plausible, so the boxes
       * are checked against the scene at each sample's ms — the second window
       * straddles the cut at 2 s.
       */
      const client = await helper({ models, cache: join(dir, 'cache', 'window'), env: { FORGE_FACES_WORKER_FAKE: 'colour' } })
      for (const [startMs, endMs] of [
        [1000, 3000],
        [1900, 2900]
      ]) {
        const result = await client.request<FacesResult>(SIDECAR_METHODS.faces, params(clips.boxes, { startMs, endMs }))
        const expected = Array.from({ length: (endMs - startMs) / 200 }, (_, i) => startMs + i * 200)
        expect(result.frames, `${startMs}–${endMs}`).toBe(expected.length)
        const track = await readTrack(result.track)
        expect(track.samples.map((s) => s.ms)).toEqual(expected)
        expect(new Set(track.samples.map((s) => (s.ms < 2000 ? 0 : 1))).size, 'both scenes are in the window').toBe(2)
        for (const sample of track.samples) {
          const scene = SCENES[sample.ms < 2000 ? 0 : 1]
          expect(near(sample.faces[0], unit(scene.blue)), `${startMs}–${endMs} at ${sample.ms}`).toBeLessThan(0.01)
        }
        notes.push(`- the window ${startMs}–${endMs}: ms ${JSON.stringify(track.samples.map((s) => s.ms))}, each box its scene's`)
      }
    }, 60_000)

    it('a turned clip is answered in its UPRIGHT frame, and the wrong size is refused with both', async () => {
      const client = await helper({ models, cache: join(dir, 'cache', 'turned'), env: { FORGE_FACES_WORKER_FAKE: 'colour' } })
      // Each clip its own key, as each file has its own size and mtime: one key would be one track.
      const plain = await readTrack((await client.request<FacesResult>(SIDECAR_METHODS.faces, params(clips.boxes, { key: 'plain' }))).track)

      // The plan's remux: the decoder delivers the picture on its side, 360×640, and the boxes go with it.
      const onSide = await client.request<FacesResult>(SIDECAR_METHODS.faces, params(clips.turned, { width: 360, height: 640, key: 'turned' }))
      expect([onSide.width, onSide.height]).toEqual([360, 640])
      const side = await readTrack(onSide.track)
      // A phone clip: stored on its side, turned back upright by its matrix — the same boxes as the plain clip.
      const upright = await client.request<FacesResult>(SIDECAR_METHODS.faces, params(clips.phone, { width: 640, height: 360, key: 'phone' }))
      expect(new Set([onSide.track, upright.track]).size).toBe(2)
      expect([onSide.cached, upright.cached]).toEqual([false, false])
      const phone = await readTrack(upright.track)
      expect(side.samples.length).toBe(plain.samples.length)
      expect(phone.samples.length).toBe(plain.samples.length)
      let worst = 0
      plain.samples.forEach((sample, i) => {
        expect(side.samples[i].faces.length).toBe(2)
        expect(phone.samples[i].faces.length).toBe(2)
        sample.faces.forEach((face, k) => {
          worst = Math.max(worst, near(side.samples[i].faces[k], turned(face)), near(phone.samples[i].faces[k], face))
        })
      })
      expect(worst).toBeLessThan(0.01)

      await expectRejection(
        client.request(SIDECAR_METHODS.faces, params(clips.turned, { width: 640, height: 360, key: 'turned' })),
        RPC_ERRORS.internalError,
        /is 360×640 upright \(turned 270°\), but 640×360 was sent/
      )
      notes.push(`- turned and phone-shaped copies: every box within ${worst.toFixed(4)} of the plain clip's (turned, or as is)`)
    }, 60_000)

    it('a worker that aborts mid-pass is Unavailable with its code, its half-track removed, and the helper answers', async () => {
      const cache = join(dir, 'cache', 'abort')
      const client = await helper({ models, cache, env: { FORGE_FACES_WORKER_FAKE: 'colour', FORGE_FACES_WORKER_ABORT: '1' } })
      const code = process.platform === 'win32' ? 3 : -6
      await expectRejection(
        client.request(SIDECAR_METHODS.faces, params(clips.boxes)),
        RPC_ERRORS.unavailable,
        new RegExp(`^the face detector stopped \\(code ${code}\\)`)
      )
      expect(await readdir(join(cache, 'faces'))).toEqual([])
      expect((await client.request<{ pong: string }>(SIDECAR_METHODS.ping, { echo: 'after the abort' })).pong).toBe('after the abort')
    }, 60_000)

    it('the real detector on this machine: it runs, or it dies with its code after a clean import — and the helper answers', async () => {
      if (!existsSync(SEED)) {
        notes.push(`- the real detector: not run, no model at ${SEED}`)
        return
      }
      const client = await helper({ models, cache: join(dir, 'cache', 'real-abort') })
      const began = performance.now()
      let outcome: string
      try {
        const result = await client.request<FacesResult>(SIDECAR_METHODS.faces, params(clips.boxes))
        expect(result.detector).toBe('mediapipe/blaze_face_full_range@0.10.35')
        outcome = `ran: ${result.frames} samples, ${result.withFace} with a face`
      } catch (err) {
        const { code, message } = err as { code: number; message: string }
        // Never "could not start": that is the import failing, which the stubs exist to prevent.
        expect(message).toMatch(/^the face detector stopped \(code -?\d+\)/)
        expect(code).toBe(RPC_ERRORS.unavailable)
        outcome = message
      }
      expect((await client.request<{ pong: string }>(SIDECAR_METHODS.ping, { echo: 'after' })).pong).toBe('after')
      notes.push(`- the real detector here, ${Math.round(performance.now() - began)} ms: ${outcome}`)
    }, 120_000)

    it('a cancel mid-pass leaves no worker, no ffmpeg and no half-track', async () => {
      // An ffmpeg that writes down its own pid before becoming the real one (exec keeps the pid).
      let decoder = FFMPEG
      const pids = join(dir, 'ffmpeg-pids.txt')
      if (process.platform !== 'win32') {
        decoder = join(dir, 'ffmpeg-recording-its-pid.sh')
        await writeFile(decoder, `#!/bin/sh\necho $$ >> '${pids}'\nexec '${FFMPEG}' "$@"\n`)
        await chmod(decoder, 0o755)
      }
      const cache = join(dir, 'cache', 'cancel')
      const client = await helper({ models, cache, env: { FORGE_FACES_WORKER_FAKE: 'colour:80' } })
      const controller = new AbortController()
      const seen: number[] = []
      const request = client.request(SIDECAR_METHODS.faces, params(clips.long, { ffmpeg: decoder }), {
        signal: controller.signal,
        onProgress: (p) => {
          if (p !== null && p > 0 && p < 1) {
            seen.push(p)
            controller.abort()
          }
        }
      })
      await expectRejection(request, RPC_ERRORS.cancelled, /Cancelled/)
      expect(seen.length).toBeGreaterThan(0)
      expect(seen[0]).toBeLessThan(0.5)

      const workers = workerPids(client)
      expect(workers.length).toBe(1)
      /*
       * The client rejects a cancelled request at once; the helper stops its
       * worker after (stdin closed, then a kill past STOP_GRACE_S, 3 s). Left
       * running, the stand-in's pass is 100 frames at 80 ms, about 8 s: still
       * alive when this gives up.
       */
      expect(await until(() => !alive(workers[0]), 4000), `worker ${workers[0]}`).toBe(true)
      if (process.platform !== 'win32') {
        const decoders = (await readFile(pids, 'utf8')).trim().split('\n').map(Number)
        expect(decoders.length).toBe(1)
        expect(await until(() => !alive(decoders[0]), 2000), `ffmpeg ${decoders[0]}`).toBe(true)
      }
      // The half-track goes once the worker has (faces.py removes it after the wait).
      await until(async () => (await readdir(join(cache, 'faces'))).length === 0, 2000)
      expect(await readdir(join(cache, 'faces'))).toEqual([])
      expect((await client.request<{ pong: string }>(SIDECAR_METHODS.ping, { echo: 'after the cancel' })).pong).toBe('after the cancel')
      notes.push(`- cancel at ${seen[0]}: worker ${workers[0]} gone, its ffmpeg gone, the faces cache empty`)
    }, 60_000)

    it('a helper killed mid-pass leaves no worker, no ffmpeg and no half-track', async () => {
      /*
       * The helper's death reaches the worker only as the end of its stdin, and
       * then nobody else is left to remove the partial: before the worker
       * removed its own, `<track>.<pid>-<id>.part` stayed in the cache for
       * good (an app quit or a helper crash during any analysis), its name
       * carrying a pid no later helper has.
       */
      let decoder = FFMPEG
      const pids = join(dir, 'ffmpeg-pids-killed.txt')
      if (process.platform !== 'win32') {
        decoder = join(dir, 'ffmpeg-recording-its-pid-killed.sh')
        await writeFile(decoder, `#!/bin/sh\necho $$ >> '${pids}'\nexec '${FFMPEG}' "$@"\n`)
        await chmod(decoder, 0o755)
      }
      const cache = join(dir, 'cache', 'killed')
      const client = await helper({ models, cache, env: { FORGE_FACES_WORKER_FAKE: 'colour:80' } })
      const exited = new Promise<{ code: number | null; signal: string | null }>((done) => client.once('exit', done))
      let partial: string[] = []
      const request = client.request(SIDECAR_METHODS.faces, params(clips.long, { ffmpeg: decoder }), {
        onProgress: (p) => {
          if (p === null || p <= 0 || p >= 1 || partial.length) return
          partial = readdirSync(join(cache, 'faces'))
          ;(client as unknown as { child: { kill: (signal: string) => void } | null }).child?.kill('SIGKILL')
        }
      })
      await expectRejection(request, RPC_ERRORS.internalError, /The AI helper stopped \(signal SIGKILL\)/)
      expect((await exited).signal).toBe('SIGKILL')
      // The half-track was there when the helper died: what is checked below is its removal.
      expect(partial.length, JSON.stringify(partial)).toBe(1)
      expect(partial[0]).toMatch(/\.json\.\d+-\d+\.part$/)

      const workers = workerPids(client)
      expect(workers.length).toBe(1)
      expect(await until(() => !alive(workers[0]), 4000), `worker ${workers[0]}`).toBe(true)
      if (process.platform !== 'win32') {
        const decoders = (await readFile(pids, 'utf8')).trim().split('\n').map(Number)
        expect(decoders.length).toBe(1)
        expect(await until(() => !alive(decoders[0]), 2000), `ffmpeg ${decoders[0]}`).toBe(true)
      }
      await until(async () => (await readdir(join(cache, 'faces'))).length === 0, 2000)
      expect(await readdir(join(cache, 'faces'))).toEqual([])
      notes.push(`- the helper SIGKILLed mid-pass: worker ${workers[0]} gone, its ffmpeg gone, ${partial[0]} removed by the worker`)
    }, 60_000)

    it('a stop mid-pass (an app quit) cancels the pass, and the helper exits by itself with no worker left', async () => {
      const cache = join(dir, 'cache', 'stopped')
      const client = await helper({ models, cache, env: { FORGE_FACES_WORKER_FAKE: 'colour:80' } })
      const exited = new Promise<{ code: number | null; signal: string | null }>((done) => client.once('exit', done))
      let began = 0
      const request = client.request(SIDECAR_METHODS.faces, params(clips.long), {
        onProgress: (p) => {
          if (p === null || p <= 0 || p >= 1 || began) return
          began = performance.now()
          client.stop()
        }
      })
      await expectRejection(request, RPC_ERRORS.internalError, /shutting down/)
      // Not the SIGKILL client.stop() sends at 1.5 s: the cancel reached the pass, which stopped.
      expect(await exited).toEqual({ code: 0, signal: null })
      const took = performance.now() - began
      expect(took).toBeLessThan(1500)
      const workers = workerPids(client)
      expect(workers.length).toBe(1)
      expect(alive(workers[0]), `worker ${workers[0]}`).toBe(false)
      expect(await readdir(join(cache, 'faces'))).toEqual([])
      notes.push(`- a stop mid-pass: the helper exited by itself (code 0) ${Math.round(took)} ms after it, worker ${workers[0]} gone, the cache empty`)
    }, 60_000)

    it('without its model the work says so and the question answers, neither touching the network', async () => {
      const empty = join(dir, 'models-empty')
      await mkdir(empty, { recursive: true })
      // A dead proxy for every scheme: a fetch would fail loudly rather than quietly succeed.
      const dead = 'http://127.0.0.1:9'
      const client = await helper({
        models: empty,
        cache: join(dir, 'cache', 'no-model'),
        env: { HTTPS_PROXY: dead, https_proxy: dead, HTTP_PROXY: dead, http_proxy: dead, ALL_PROXY: dead, all_proxy: dead }
      })
      for (const ask of [{}, { download: false }]) {
        const status = await client.request<ModelStatus>(SIDECAR_METHODS.facesModel, ask)
        expect(status).toEqual({ present: false, bytes: 1_083_786, label: 'the face finder', host: 'storage.googleapis.com' })
      }
      await expectRejection(client.request(SIDECAR_METHODS.faces, params(clips.boxes)), RPC_ERRORS.unavailable, /^the face finder is not downloaded yet \(1,083,786 bytes from storage\.googleapis\.com\)/)
      expect(await readdir(empty)).toEqual([])
      expect(workerPids(client)).toEqual([])

      // And the models folder the other tests use answers present, by fetch_url's own name for the file.
      const seeded = await helper({ models, cache: join(dir, 'cache', 'no-model-2') })
      expect((await seeded.request<ModelStatus>(SIDECAR_METHODS.facesModel, {})).present).toBe(true)
      expect(modelPath.startsWith(join(models, 'files') + sep)).toBe(true)
    }, 60_000)

    it('the cache: the same key and settings answer from disk with no worker; any change runs one', async () => {
      const cache = join(dir, 'cache', 'cache')
      const first = await helper({ models, cache, env: { FORGE_FACES_WORKER_FAKE: 'colour' } })
      const made = await first.request<FacesResult>(SIDECAR_METHODS.faces, params(clips.boxes))
      expect(made.cached).toBe(false)
      const again = await first.request<FacesResult>(SIDECAR_METHODS.faces, params(clips.boxes))
      expect(again).toEqual({ ...made, cached: true })

      // A helper whose every worker would abort: the same request still answers, so no worker ran…
      const aborting = await helper({ models, cache, env: { FORGE_FACES_WORKER_FAKE: 'colour', FORGE_FACES_WORKER_ABORT: '1' } })
      expect(await aborting.request<FacesResult>(SIDECAR_METHODS.faces, params(clips.boxes))).toEqual({ ...made, cached: true })
      expect(workerPids(aborting)).toEqual([])
      // …and each change to what the samples depend on misses the cache and runs one (which aborts).
      for (const change of [{ fps: 10 }, { edge: 480 }, { minScore: 0.75 }, { endMs: 3000 }, { key: '4000:1728912345679.5' }]) {
        await expectRejection(aborting.request(SIDECAR_METHODS.faces, params(clips.boxes, change)), RPC_ERRORS.unavailable, /the face detector stopped/)
      }
      expect(workerPids(aborting).length).toBe(5)
    }, 120_000)
  },
  NEEDS
)

/* ---------------------------------------------------- the user's suite */

describeWithVenv(
  'vision.faces on the user’s face fixture — the real detection',
  () => {
    let realDir = ''
    let client: SidecarClient
    const lines: string[] = []

    beforeAll(async () => {
      realDir = join(OUTPUT_ROOT, 'faces', 'real')
      await mkdir(realDir, { recursive: true })
      const realModels = join(realDir, 'models')
      await mkdir(realModels, { recursive: true })
      client = await helper({ models: realModels, cache: join(realDir, 'cache') })
      // The model: the measured copy when this Mac has it, else the product's own fetch (the Get press).
      const path = await python<string>('import json; from forge_sidecar.capabilities import faces; print(json.dumps(faces.model_path()))', {
        FORGE_MODELS_DIR: realModels
      })
      if (existsSync(SEED) && !existsSync(path)) {
        await mkdir(dirname(path), { recursive: true })
        await copyFile(SEED, path)
      }
      const status = await client.request<ModelStatus>(SIDECAR_METHODS.facesModel, { download: true })
      expect(status.present).toBe(true)
    }, 300_000)

    afterAll(async () => {
      if (realDir) await writeNote(realDir, ['# vision.faces on the face fixture', '', `    ${USER_COMMAND}`, '', ...lines])
    })

    function check(track: FacesTrack, minScore: number): void {
      let previous = -1
      for (const sample of track.samples) {
        expect(sample.ms).toBeGreaterThan(previous)
        previous = sample.ms
        expect(sample.faces.length).toBeLessThanOrEqual(2)
        sample.faces.forEach((f: FaceBox, k) => {
          for (const v of [f.x, f.y, f.width, f.height]) {
            expect(v).toBeGreaterThanOrEqual(0)
            expect(v).toBeLessThanOrEqual(1)
          }
          expect(f.x + f.width).toBeLessThanOrEqual(1 + 1e-9)
          expect(f.y + f.height).toBeLessThanOrEqual(1 + 1e-9)
          expect(f.score).toBeGreaterThanOrEqual(minScore)
          if (k === 1) expect(f.width * f.height).toBeLessThanOrEqual(sample.faces[0].width * sample.faces[0].height)
        })
      }
    }

    it('finds the face on at least half the frames of the 4K original, at 5 fps and a 640 edge', async () => {
      const probe = JSON.parse(
        (await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', FIXTURE])).stdout
      ) as { streams: { width: number; height: number }[] }
      const { width, height } = probe.streams[0]
      const began = performance.now()
      const result = await client.request<FacesResult>(SIDECAR_METHODS.faces, {
        path: FIXTURE, ffmpeg: FFMPEG, ffprobe: FFPROBE, width, height, fps: 5, edge: 640, key: 'fixture:2026-10-05'
      })
      const seconds = (performance.now() - began) / 1000
      const track = await readTrack(result.track)
      check(track, 0.5)
      const size = (await stat(result.track)).size
      lines.push(
        `- the original (${width}×${height}): ${result.withFace} of ${result.frames} samples with a face, in ${seconds.toFixed(1)} s; track ${size} B at ${result.track}`
      )
      expect(result.detector).toBe('mediapipe/blaze_face_full_range@0.10.35')
      expect(result.withFace / result.frames).toBeGreaterThanOrEqual(0.5)
    }, 300_000)

    it('a phone-shaped copy, stored on its side and turned upright by its matrix, gives the same boxes', async () => {
      // Ten seconds at 640×360, then the same picture stored sideways (coded 360×640) with a matrix that turns it back.
      const small = join(realDir, 'small.mp4')
      await ff('-t', '10', '-i', FIXTURE, '-an', '-vf', 'scale=640:360', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', small)
      const sideways = join(realDir, 'sideways-coded.mp4')
      await ff('-i', small, '-vf', 'transpose=clock', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', sideways)
      const phone = join(realDir, 'phone.mp4')
      await ff('-i', sideways, '-c', 'copy', '-metadata:s:v:0', 'rotate=90', phone)

      const ask = (path: string, key: string): Promise<FacesResult> =>
        client.request<FacesResult>(SIDECAR_METHODS.faces, { path, ffmpeg: FFMPEG, ffprobe: FFPROBE, width: 640, height: 360, fps: 5, edge: 640, key })
      const plain = await readTrack((await ask(small, 'small')).track)
      const turned = await readTrack((await ask(phone, 'phone')).track)
      check(plain, 0.5)
      check(turned, 0.5)
      expect(turned.samples.length).toBe(plain.samples.length)
      const pairs = plain.samples
        .map((s, i) => [s.faces[0], turned.samples[i].faces[0]] as const)
        .filter(([a, b]) => a !== undefined && b !== undefined)
      const off = pairs.map(([a, b]) => near(a, b))
      const worst = off.length ? Math.max(...off) : NaN
      lines.push(
        `- the phone-shaped copy: ${pairs.length} of ${plain.samples.length} samples with a face in both; the first faces differ by at most ${worst.toFixed(4)}`
      )
      expect(pairs.length).toBeGreaterThanOrEqual(plain.samples.length / 2)
      expect(worst).toBeLessThanOrEqual(0.02)
    }, 300_000)
  },
  {
    ...NEEDS,
    [`FORGE_FACES_REAL=1 (the run is: ${USER_COMMAND})`]: process.env.FORGE_FACES_REAL === '1',
    [`face fixture at ${FIXTURE}`]: existsSync(FIXTURE)
  }
)
