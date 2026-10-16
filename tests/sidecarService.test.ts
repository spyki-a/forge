import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { HELPER_PACK } from '../src/shared/sidecar/packManifest'
import { packBytes, packHosts, type PackPlatform } from '../src/shared/sidecar/pack'
import { HELPER_PYTHON_MISSING, UNPARSEABLE_RECEIPT } from '../src/shared/sidecar/helperPython'
import { HELPER_NEEDS_UPDATE, HELPER_NOT_INSTALLED, helperRowFrom, helperStatusReason, packOffer, type SidecarStatus } from '../src/shared/sidecar/status'
import { REFRAME_CHANNELS, REFRAME_FAILURES } from '../src/shared/reframe/job'
import { HELPER_BEING_REPAIRED, HELPER_CHANNELS, HELPER_PRESET, HELPER_REPAIRED_ELSEWHERE } from '../src/shared/sidecar/install'
import type { Job } from '../src/shared/types'
import type { HelperPackWorkers } from '../src/main/sidecar/install'

/*
 * `absent` at every caller, the status ask, and the service's broadcasts
 * (docs/CLIPS.md §3a.2, §3a.7).
 *
 * Every spawn is recorded. Two names stand in for interpreters and run
 * tests/fixtures/fake-helper.mjs instead (a Node script that speaks the
 * helper's protocol): FAKE_PYTHON, set as FORGE_PYTHON, and a pack's own
 * interpreter path. Anything else THROWS, so a caller that spawns where it
 * must not fails loudly as well as being counted.
 *
 * The four IPC handlers are the real ones: ipc.ts's registerIpc, run against
 * an electron stand-in whose ipcMain keeps each handler by channel.
 */

const FAKE = vi.hoisted(() => ({ python: 'forge-fake-python', packPython: '' as string, script: '' as string }))
const spawned = vi.hoisted(() => [] as { command: string; args: string[]; options: Record<string, unknown> }[])
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>()
  const { tmpdir: tmp } = await import('node:os')
  return {
    ...real,
    spawn: (command: string, args: string[], options: Record<string, unknown>) => {
      spawned.push({ command, args: [...args], options })
      if (command === FAKE.python || (FAKE.packPython && command === FAKE.packPython)) {
        return real.spawn(process.execPath, [FAKE.script], { ...options, cwd: tmp() })
      }
      throw new Error(`spawn is not allowed in this test: ${command}`)
    }
  }
})

const electron = vi.hoisted(() => ({
  packaged: true,
  userData: '',
  appPath: '',
  handlers: new Map<string, (event: unknown, payload?: unknown) => unknown>()
}))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electron.packaged
    },
    getAppPath: () => electron.appPath,
    getPath: (name: string) => (name === 'userData' ? electron.userData : join(electron.userData, name)),
    getVersion: () => '0.1.0',
    runningUnderARM64Translation: false
  },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload?: unknown) => unknown) => electron.handlers.set(channel, handler),
    on: () => undefined,
    removeHandler: () => undefined
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: {},
  systemPreferences: {}
}))

/*
 * A release that bumps the pack number: while `bumped` is set, HELPER_PACK
 * reads one number up with new lock hashes, as `pack_lock.py --bump` writes
 * it. A getter, read at each use, so the switch reaches the service's imports
 * whichever test loaded them; the tests that do not set it see the real one.
 */
const MANIFEST = vi.hoisted(() => ({ bumped: false }))
vi.mock('../src/shared/sidecar/packManifest', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/shared/sidecar/packManifest')>()
  const next = JSON.parse(JSON.stringify(real.HELPER_PACK)) as typeof real.HELPER_PACK
  next.pack = real.HELPER_PACK.pack + 1
  for (const p of Object.values(next.platforms)) p.lock.sha256 = 'f'.repeat(64)
  return {
    ...real,
    get HELPER_PACK() {
      return MANIFEST.bumped ? next : real.HELPER_PACK
    }
  }
})

// The cheap split, without ffmpeg: what separateStems falls back to.
vi.mock('../src/main/stems', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/stems')>()),
  splitStems: async (path: string) => ({ instrumental: `${path}.instrumental.wav`, voice: `${path}.voice.wav`, backend: 'midside', quality: 'emphasised' as const })
}))

FAKE.script = resolve(__dirname, 'fixtures', 'fake-helper.mjs')

const MACHINE: PackPlatform | null =
  process.platform === 'darwin' && process.arch === 'arm64' ? 'darwin-arm64' : process.platform === 'win32' && process.arch === 'x64' ? 'win32-x64' : null

const scratch: string[] = []
const savedEnv = { FORGE_PYTHON: process.env.FORGE_PYTHON, FAKE_PIDS: process.env.FAKE_PIDS }
let restoreProcess: () => void = () => undefined

type Service = typeof import('../src/main/sidecar/service')

async function service(): Promise<Service> {
  return import('../src/main/sidecar/service')
}

beforeEach(() => {
  vi.resetModules()
  spawned.length = 0
  electron.handlers.clear()
  electron.packaged = true
  electron.userData = mkdtempSync(join(tmpdir(), 'forge-service-'))
  electron.appPath = mkdtempSync(join(tmpdir(), 'forge-app-'))
  scratch.push(electron.userData, electron.appPath)
  FAKE.packPython = ''
  MANIFEST.bumped = false
  delete process.env.FORGE_PYTHON
  delete process.env.FAKE_PIDS
  restoreProcess = stubElectronProcess()
})

afterEach(async () => {
  await (await service()).stopSidecar()
  restoreProcess()
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

/** What Electron adds to `process` and plain Node lacks. */
function stubElectronProcess(): () => void {
  const p = process as unknown as { getSystemVersion?: () => string; resourcesPath?: string }
  const saved = { getSystemVersion: p.getSystemVersion, resourcesPath: p.resourcesPath }
  p.getSystemVersion = () => (process.platform === 'darwin' ? '15.0' : '10.0.22631')
  p.resourcesPath = join(electron.appPath, 'resources')
  return () => {
    p.getSystemVersion = saved.getSystemVersion
    p.resourcesPath = saved.resourcesPath
  }
}

/** A pack in userData: its receipt (matching this build unless told otherwise) and, unless told not to, its interpreter file. */
function installPack(o: { interpreter?: boolean; receipt?: string; root?: string; selftest?: Record<string, string>; integrity?: string[] } = {}): { version: string; python: string } {
  const platform = MACHINE!
  const pack = HELPER_PACK.platforms[platform]
  const version = join(electron.userData, o.root ?? 'python', String(HELPER_PACK.pack))
  const python = join(version, pack.python)
  mkdirSync(dirname(python), { recursive: true })
  if (o.interpreter !== false) writeFileSync(python, '')
  writeFileSync(
    join(version, 'pack.json'),
    o.receipt ??
      JSON.stringify({
        pack: HELPER_PACK.pack,
        python: HELPER_PACK.python.version,
        build: HELPER_PACK.python.build,
        platform,
        interpreterSha256: pack.interpreter.sha256,
        lockSha256: pack.lock.sha256,
        ...(o.selftest ? { selftest: o.selftest } : {}),
        ...(o.integrity ? { integrity: o.integrity } : {})
      })
  )
  return { version, python }
}

async function until(test: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (test()) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return test()
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Development with FORGE_PYTHON pointing at the fake helper: a launch that runs. */
function devWithFake(): string {
  electron.packaged = false
  process.env.FORGE_PYTHON = FAKE.python
  const pids = join(electron.userData, 'pids.txt')
  process.env.FAKE_PIDS = pids
  return pids
}

const pidsIn = (file: string): number[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(Number)
    : []

describe.skipIf(!MACHINE)('a packaged app with no pack: absent at every caller', () => {
  it('answers the status ask with absent and an install offer, and spawns nothing', async () => {
    const { sidecarStatus, startSidecar } = await service()
    const pack = HELPER_PACK.platforms[MACHINE!]
    const asked = sidecarStatus()
    expect(asked).toMatchObject({ state: 'absent', offer: { supported: true, kind: 'install', bytes: packBytes(pack), bytesOnDisk: pack.bytesOnDisk } })
    const offer = (asked as Extract<SidecarStatus, { state: 'absent' }>).offer
    expect(offer.supported && offer.hosts).toEqual(packHosts(pack))
    const told: SidecarStatus[] = []
    startSidecar((s) => told.push(s))
    expect(told).toEqual([asked])
    expect(sidecarStatus()).toEqual(asked)
    expect(spawned).toEqual([])
  })

  it('getSidecar throws the sentence at once, before anything is built or spawned', async () => {
    const { getSidecar } = await service()
    expect(() => getSidecar()).toThrow(HELPER_NOT_INSTALLED)
    expect(spawned).toEqual([])
  })

  it('every caller rejects or degrades with spawn never called: beats, depth, measure, transcribe, stems, the voice, the reframe', async () => {
    const { registerIpc } = await import('../src/main/ipc')
    const { voiceStatus } = await import('../src/main/voice')
    const { separateStems } = await import('../src/main/separate')
    registerIpc(() => null)
    const call = (channel: string, payload?: unknown): unknown => {
      const handler = electron.handlers.get(channel)
      if (!handler) throw new Error(`no handler for ${channel}`)
      return handler({}, payload)
    }
    const wav = join(electron.userData, 'song.wav')

    await expect(call('audio:beats', { path: wav })).rejects.toThrow(HELPER_NOT_INSTALLED)
    await expect(call('depth:layers', { assetId: 'a1', path: join(electron.userData, 'photo.jpg') })).rejects.toThrow(HELPER_NOT_INSTALLED)
    await expect(call('asr:transcribe', { assetId: 'a1', path: wav })).rejects.toThrow(HELPER_NOT_INSTALLED)
    // Measuring degrades: the gate lets every photo through, and says why.
    expect(await call('vision:measure', { paths: [join(electron.userData, 'photo.jpg')] })).toMatchObject({ measures: [], unavailable: HELPER_NOT_INSTALLED })
    // Stems take mid/side, as for any helper failure.
    const stems = { instrumental: `${wav}.instrumental.wav`, voice: `${wav}.voice.wav`, backend: 'midside', quality: 'emphasised' }
    expect(await call('audio:stems', { path: wav, quality: 'separated' })).toEqual(stems)
    expect(await separateStems(wav, 'separated')).toEqual(stems)
    // The local voice reports the reason; the hosted one is still listed.
    const voices = await voiceStatus()
    expect(voices.find((v) => v.id === 'kokoro')).toMatchObject({ ready: false, reason: HELPER_NOT_INSTALLED })
    expect(await call('voice:status')).toEqual(voices)
    // The reframe's question answers no-helper, in words.
    await expect(call(REFRAME_CHANNELS.faceModel, {})).rejects.toThrow(REFRAME_FAILURES['no-helper'])
    // The status ask, through its handler.
    expect(await call('sidecar:status')).toMatchObject({ state: 'absent' })

    expect(spawned, 'no caller spawns anything').toEqual([])
  })
})

describe.skipIf(!MACHINE)('a damaged pack', () => {
  it('a matching receipt whose interpreter is gone is damaged, offers Repair, and spawns nothing', async () => {
    installPack({ interpreter: false })
    const { sidecarStatus, startSidecar, getSidecar } = await service()
    const told: SidecarStatus[] = []
    startSidecar((s) => told.push(s))
    expect(told).toHaveLength(1)
    expect(told[0]).toMatchObject({ state: 'damaged', reason: HELPER_PYTHON_MISSING, offer: { supported: true, kind: 'repair' } })
    expect(sidecarStatus()).toEqual(told[0])
    expect(() => getSidecar()).toThrow(HELPER_PYTHON_MISSING)
    expect(spawned).toEqual([])
  })

  it('a pack.json that is there and cannot be read is damaged, never absent', async () => {
    const { version } = installPack()
    rmSync(join(version, 'pack.json'))
    // A folder where the file should be: reading it fails with EISDIR, not ENOENT.
    mkdirSync(join(version, 'pack.json'))
    const { sidecarStatus, getSidecar } = await service()
    expect(sidecarStatus()).toMatchObject({ state: 'damaged', offer: { kind: 'repair' } })
    expect(() => getSidecar()).toThrow()
    expect(spawned).toEqual([])
  })

  it('beats FORGE_PYTHON in a packaged app: the receipt is never ignored silently', async () => {
    installPack({ receipt: '{"pack": 1, "torn' })
    process.env.FORGE_PYTHON = FAKE.python
    const { sidecarStatus, getSidecar } = await service()
    expect(sidecarStatus()).toMatchObject({ state: 'damaged', offer: { kind: 'repair' } })
    expect(() => getSidecar()).toThrow()
    expect(spawned).toEqual([])
  })
})

describe.skipIf(!MACHINE)('a release that bumps the pack number (§3a.3 "Update", §16.46 (a))', () => {
  it('the pack in the older number’s folder is offered as Update, never as a fresh Install, and is not run', async () => {
    const { python } = installPack()
    // A spawn of the old pack would run (and be counted), not throw.
    FAKE.packPython = python
    MANIFEST.bumped = true
    const { sidecarStatus, startSidecar, getSidecar } = await service()
    const asked = sidecarStatus()
    expect(asked).toMatchObject({ state: 'absent', offer: { supported: true, kind: 'update', bytes: packBytes(HELPER_PACK.platforms[MACHINE!]) } })
    const told: SidecarStatus[] = []
    startSidecar((s) => told.push(s))
    expect(told).toEqual([asked])
    expect(helperStatusReason(asked)).toBe(HELPER_NEEDS_UPDATE)
    expect(() => getSidecar()).toThrow(HELPER_NEEDS_UPDATE)
    expect(spawned, 'the old pack is unused until Update is pressed').toEqual([])
  })

  it('olderReceipt reads the highest number below the manifest’s whose receipt parses, and nothing else', async () => {
    const { olderReceipt } = await service()
    const root = join(electron.userData, 'python')
    const put = (folder: string, text: string): void => {
      mkdirSync(join(root, folder), { recursive: true })
      writeFileSync(join(root, folder, 'pack.json'), text)
    }
    const receipt = (pack: number): string =>
      JSON.stringify({ pack, python: '3.14.8', build: '20261001', platform: MACHINE, interpreterSha256: 'a'.repeat(64), lockSha256: 'b'.repeat(64) })
    expect(olderReceipt(root, 4), 'no root at all').toBeNull()
    put('1', receipt(1))
    put('2', receipt(2))
    put('3', '{"pack": 3, "torn')
    put('4', receipt(4))
    put('5', receipt(5))
    mkdirSync(join(root, 'in-use'), { recursive: true })
    mkdirSync(join(root, 'downloads', '3'), { recursive: true })
    // 4 is the manifest's own, 5 is newer, 3 is torn: 2 it is.
    expect(olderReceipt(root, 4)).toMatchObject({ pack: 2 })
    expect(olderReceipt(root, 2)).toMatchObject({ pack: 1 })
    expect(olderReceipt(root, 1)).toBeNull()
  })

  it('an older folder whose receipt is torn is no pack to update: Install', async () => {
    installPack({ receipt: '{"pack": 1, "torn' })
    MANIFEST.bumped = true
    const { sidecarStatus } = await service()
    expect(sidecarStatus()).toMatchObject({ state: 'absent', offer: { supported: true, kind: 'install' } })
    expect(spawned).toEqual([])
  })
})

describe('the status ask never starts anything', () => {
  it('in development with a helper to run, the ask before any start says starting, and spawns nothing', async () => {
    devWithFake()
    const { sidecarStatus } = await service()
    expect(sidecarStatus()).toEqual({ state: 'starting', source: { kind: 'env', python: FAKE.python } })
    await new Promise((r) => setTimeout(r, 50))
    expect(spawned).toEqual([])
  })

  it('through its handler too, after the window’s mount and before startSidecar', async () => {
    devWithFake()
    const { registerIpc } = await import('../src/main/ipc')
    registerIpc(() => null)
    const answer = await electron.handlers.get('sidecar:status')!({})
    expect(answer).toMatchObject({ state: 'starting' })
    await new Promise((r) => setTimeout(r, 50))
    expect(spawned).toEqual([])
  })
})

describe('the broadcasts', () => {
  it('a restart that comes back reaches onStatus: starting, ready, failed, ready', async () => {
    const pids = devWithFake()
    const { startSidecar, getSidecar } = await service()
    const told: SidecarStatus[] = []
    startSidecar((s) => told.push(s))
    expect(await until(() => told.some((s) => s.state === 'ready'), 10_000)).toBe(true)
    await getSidecar()
      .request('fake.crash')
      .catch(() => undefined)
    expect(await until(() => told.filter((s) => s.state === 'ready').length === 2, 10_000), JSON.stringify(told.map((s) => s.state))).toBe(true)
    expect(told.map((s) => s.state)).toEqual(['starting', 'ready', 'failed', 'ready'])
    expect(told[2]).toMatchObject({ state: 'failed', error: 'The AI helper stopped (code 3)', source: { kind: 'env' } })
    expect(told[3]).toMatchObject({ source: { kind: 'env', python: FAKE.python } })
    expect(pidsIn(pids)).toHaveLength(2)
  })

  it('a start that fails is told in its own words', async () => {
    electron.packaged = false
    process.env.FORGE_PYTHON = join(electron.appPath, 'no-such-python')
    const { startSidecar } = await service()
    const told: SidecarStatus[] = []
    startSidecar((s) => told.push(s))
    expect(await until(() => told.length === 2, 5000)).toBe(true)
    expect(told[0]).toMatchObject({ state: 'starting' })
    expect(told[1]).toMatchObject({ state: 'failed', error: expect.stringContaining('spawn is not allowed') })
    expect(helperStatusReason(told[1])).toBe((told[1] as { error: string }).error)
  })
})

describe('development with nothing configured', () => {
  it('runs python3 (python on win32) on PATH with -m forge_sidecar: CI’s bare interpreter keeps working', async () => {
    electron.packaged = false
    const { getSidecar } = await service()
    await expect(getSidecar().start()).rejects.toThrow('spawn is not allowed')
    expect(spawned).toHaveLength(1)
    expect(spawned[0].command).toBe(process.platform === 'win32' ? 'python' : 'python3')
    expect(spawned[0].args).toEqual(['-m', 'forge_sidecar'])
    expect(spawned[0].options).toMatchObject({ cwd: join(electron.appPath, 'sidecar'), windowsHide: true })
  })
})

describe('the switch to a new rung', () => {
  it('waits for the work in flight, stops the old helper and waits for its exit, then starts again', async () => {
    const pids = devWithFake()
    const { startSidecar, getSidecar, restartSidecar } = await service()
    const told: SidecarStatus[] = []
    startSidecar((s) => told.push(s))
    expect(await until(() => told.some((s) => s.state === 'ready'), 10_000)).toBe(true)
    const work = getSidecar().request<{ waited: number }>('fake.wait', { ms: 400 })
    const switched = restartSidecar()
    // During the switch no caller gets a client.
    expect(() => getSidecar()).toThrow('The AI helper is restarting')
    expect(await work, 'the work in flight finished, not cut off').toEqual({ waited: 400 })
    expect(await switched).toMatchObject({ state: 'starting' })
    const [first] = pidsIn(pids)
    expect(alive(first), `the old helper ${first}`).toBe(false)
    expect(await until(() => told.filter((s) => s.state === 'ready').length === 2, 10_000)).toBe(true)
    expect(pidsIn(pids)).toHaveLength(2)
  })

  it('a cancel while it waits leaves the helper as it was', async () => {
    devWithFake()
    const { startSidecar, getSidecar, restartSidecar } = await service()
    startSidecar(() => undefined)
    await getSidecar().start()
    const work = getSidecar().request('fake.wait', { ms: 300 })
    const controller = new AbortController()
    const switched = restartSidecar(controller.signal)
    controller.abort()
    await expect(switched).rejects.toThrow('Cancelled')
    await work
    expect(await getSidecar().request<{ pong: number }>('system.ping', { echo: 7 })).toEqual({ pong: 7 })
  })
})

describe.skipIf(!MACHINE)('the in-use record', () => {
  it('a helper running from the pack is recorded as <root>/in-use/<pid> = {pack}, and the record goes with the stop', async () => {
    const { python } = installPack()
    FAKE.packPython = python
    const { startSidecar, stopSidecar, getSidecar } = await service()
    startSidecar(() => undefined)
    await getSidecar().start()
    const record = join(electron.userData, 'python', 'in-use', String(process.pid))
    expect(existsSync(record)).toBe(true)
    expect(JSON.parse(readFileSync(record, 'utf8'))).toEqual({ pack: HELPER_PACK.pack })
    // Started as the pack is: its flags, never a dev rung's launch.
    expect(spawned[0].command).toBe(python)
    expect(spawned[0].args).toEqual(['-E', '-s', '-u', '-B', '-m', 'forge_sidecar'])
    await stopSidecar()
    expect(existsSync(record)).toBe(false)
  })

  it('the record goes with the helper’s own exit, before any stop, and the restart’s spawn writes it again', async () => {
    const { python } = installPack()
    FAKE.packPython = python
    const pids = join(electron.userData, 'pids.txt')
    process.env.FAKE_PIDS = pids
    const { startSidecar, getSidecar } = await service()
    startSidecar(() => undefined)
    const helper = getSidecar()
    await helper.start()
    const record = join(electron.userData, 'python', 'in-use', String(process.pid))
    expect(existsSync(record)).toBe(true)
    // The service's own 'exit' listener was added first, when it built the
    // client: by the time this one runs, the record must already be gone.
    const atExit: boolean[] = []
    helper.on('exit', () => atExit.push(existsSync(record)))
    await helper.request('fake.crash').catch(() => undefined)
    expect(await until(() => atExit.length === 1, 5000), 'the crash was seen').toBe(true)
    expect(atExit, 'the record when the helper exited, before any stop').toEqual([false])
    expect(helper.stopped).toBe(false)
    // The restart (400 ms later) runs from the pack again, and is recorded again.
    expect(await until(() => pidsIn(pids).length === 2 && existsSync(record), 10_000), 'the restart’s record').toBe(true)
    expect(JSON.parse(readFileSync(record, 'utf8'))).toEqual({ pack: HELPER_PACK.pack })
  })

  it('development keeps a root of its own: python-dev, never the installed app’s', async () => {
    const { packRoot } = await service()
    expect(packRoot('/u', true)).toBe(join('/u', 'python'))
    expect(packRoot('/u', false)).toBe(join('/u', 'python-dev'))
  })
})

describe('packOffer', () => {
  const platform: PackPlatform = 'win32-x64'
  const pack = HELPER_PACK.platforms[platform]
  const receipt = {
    pack: HELPER_PACK.pack,
    python: HELPER_PACK.python.version,
    build: HELPER_PACK.python.build,
    platform,
    interpreterSha256: pack.interpreter.sha256,
    lockSha256: pack.lock.sha256
  }

  it('is Install with no receipt, sized by every file the press fetches', () => {
    expect(packOffer(HELPER_PACK, platform, null, false)).toEqual({
      supported: true,
      kind: 'install',
      bytes: packBytes(pack),
      bytesOnDisk: pack.bytesOnDisk,
      hosts: packHosts(pack)
    })
  })

  it('is Update for a receipt that parses and does not match, and Repair for a damaged one', () => {
    expect(packOffer(HELPER_PACK, platform, { ...receipt, lockSha256: 'f'.repeat(64) }, false)).toMatchObject({ kind: 'update' })
    expect(packOffer(HELPER_PACK, platform, { ...receipt, platform: 'darwin-arm64' }, false)).toMatchObject({ kind: 'update' })
    expect(packOffer(HELPER_PACK, platform, receipt, true)).toMatchObject({ kind: 'repair' })
    expect(packOffer(HELPER_PACK, platform, UNPARSEABLE_RECEIPT, true)).toMatchObject({ kind: 'repair' })
    // A receipt nobody can read is never offered as a fresh Install over what is on disk.
    expect(packOffer(HELPER_PACK, platform, UNPARSEABLE_RECEIPT, false)).toMatchObject({ kind: 'repair' })
  })

  it('is Update for an older number’s receipt when the manifest’s folder has none, and Install for a torn one', () => {
    const older = { ...receipt, pack: HELPER_PACK.pack, lockSha256: 'e'.repeat(64) }
    expect(packOffer(HELPER_PACK, platform, null, false, older)).toMatchObject({ kind: 'update', bytes: packBytes(pack) })
    expect(packOffer(HELPER_PACK, platform, null, false, UNPARSEABLE_RECEIPT)).toMatchObject({ kind: 'install' })
    expect(packOffer(HELPER_PACK, platform, null, false, null)).toMatchObject({ kind: 'install' })
    // The manifest's own folder decides when it has a receipt.
    expect(packOffer(HELPER_PACK, platform, receipt, true, older)).toMatchObject({ kind: 'repair' })
  })

  it('offers nothing on a machine that cannot have a pack, and says why', () => {
    expect(packOffer(HELPER_PACK, { unsupported: 'The AI helper needs macOS 14 or later' }, null, false)).toEqual({
      supported: false,
      reason: 'The AI helper needs macOS 14 or later'
    })
  })

  it('names the hosts a restricted network must allow', () => {
    const offer = packOffer(HELPER_PACK, platform, null, false)
    expect(offer.supported && offer.hosts).toEqual(expect.arrayContaining(['files.pythonhosted.org', 'github.com']))
  })

  it('the window’s sentence for each status without a helper', () => {
    const offer = packOffer(HELPER_PACK, platform, null, false)
    expect(helperStatusReason({ state: 'absent', offer })).toBe(HELPER_NOT_INSTALLED)
    expect(helperStatusReason({ state: 'absent', offer: { ...offer, kind: 'update' } as typeof offer })).toBe(HELPER_NEEDS_UPDATE)
    expect(helperStatusReason({ state: 'absent', offer: { supported: false, reason: 'not here' } })).toBe('not here')
    expect(helperStatusReason({ state: 'damaged', reason: HELPER_PYTHON_MISSING, offer })).toBe(HELPER_PYTHON_MISSING)
    expect(helperStatusReason({ state: 'starting', source: { kind: 'path', python: 'python3' } })).toBeNull()
    expect(helperStatusReason({ state: 'installing', stage: 'Fetching' })).toBeNull()
  })
})

describe('helperRowFrom: what the header dot and the row take from a status', () => {
  const offer = packOffer(HELPER_PACK, 'win32-x64', null, false)
  const source = { kind: 'pack', pack: 1, root: '/u/python/1' } as const
  const hello = { protocolVersion: 1, python: '3.14.8', platform: 'win32', capabilities: [], degraded: {}, executable: 'python.exe', prefix: '/p', path: [] }

  it('is running only when ready', () => {
    expect(helperRowFrom({ state: 'ready', hello, source })).toEqual({ running: true, reason: null })
  })

  it('is not running, with its sentence, with no pack, an older one, a damaged one, or a failed start', () => {
    expect(helperRowFrom({ state: 'absent', offer })).toEqual({ running: false, reason: HELPER_NOT_INSTALLED })
    expect(helperRowFrom({ state: 'absent', offer: { ...offer, kind: 'update' } as typeof offer })).toEqual({ running: false, reason: HELPER_NEEDS_UPDATE })
    expect(helperRowFrom({ state: 'absent', offer: { supported: false, reason: 'The AI helper needs macOS 14 or later' } })).toEqual({
      running: false,
      reason: 'The AI helper needs macOS 14 or later'
    })
    expect(helperRowFrom({ state: 'damaged', reason: HELPER_PYTHON_MISSING, offer })).toEqual({ running: false, reason: HELPER_PYTHON_MISSING })
    expect(helperRowFrom({ state: 'failed', error: 'The AI helper stopped (code 3)', source })).toEqual({
      running: false,
      reason: 'The AI helper stopped (code 3)'
    })
  })

  it('is not running and names no fault while one starts or installs', () => {
    expect(helperRowFrom({ state: 'starting', source })).toEqual({ running: false, reason: null })
    expect(helperRowFrom({ state: 'installing', stage: 'Fetching' })).toEqual({ running: false, reason: null })
  })
})

/* ------------------------------------------------- the install job's side */

describe('the install job’s hold (§3a.3 Repair, Remove)', () => {
  it('while held, getSidecar throws the hold’s reason, a start says installing, and nothing is spawned', async () => {
    devWithFake()
    const { helperControl, getSidecar, startSidecar, sidecarStatus } = await service()
    const release = helperControl.hold(HELPER_BEING_REPAIRED)
    expect(() => getSidecar()).toThrow(HELPER_BEING_REPAIRED)
    const told: SidecarStatus[] = []
    startSidecar((s) => told.push(s))
    expect(told).toEqual([{ state: 'installing', stage: HELPER_BEING_REPAIRED }])
    expect(sidecarStatus()).toEqual(told[0])
    await new Promise((r) => setTimeout(r, 50))
    expect(spawned, 'a held service builds no client').toEqual([])
    release()
    // Released: the order runs again.
    await getSidecar().start()
    expect(spawned).toHaveLength(1)
  })

  it('busy while a request is out, and whenIdle waits for it without cutting it off', async () => {
    devWithFake()
    const { helperControl, startSidecar, getSidecar } = await service()
    startSidecar(() => undefined)
    await getSidecar().start()
    expect(helperControl.busy()).toBe(false)
    const work = getSidecar().request<{ waited: number }>('fake.wait', { ms: 300 })
    expect(helperControl.busy()).toBe(true)
    await helperControl.whenIdle(new AbortController().signal)
    expect(helperControl.busy()).toBe(false)
    expect(await work).toEqual({ waited: 300 })
    // A cancel ends the wait, not the work.
    const more = getSidecar().request<{ waited: number }>('fake.wait', { ms: 300 })
    const controller = new AbortController()
    const waiting = helperControl.whenIdle(controller.signal)
    controller.abort()
    await expect(waiting).rejects.toThrow('Cancelled')
    expect(await more).toEqual({ waited: 300 })
  })
})

describe.skipIf(!MACHINE)('Repair on the real service, under a caller that sends one request after another (P-B finding V2)', () => {
  it('every request is answered or refused with the hold’s reason; none is sent and then cut off by the stop', async () => {
    const { python } = installPack()
    FAKE.packPython = python
    const svc = await service()
    const { createHelperPackJobs } = await import('../src/main/sidecar/install')
    svc.startSidecar(() => undefined)
    await svc.getSidecar().start()

    // As voice.ts, ipc.ts and separate.ts ask: getSidecar() per call, one after another.
    const outcomes: string[] = []
    const caller = (async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await svc.getSidecar().request('fake.wait', { ms: 150 })
          outcomes.push(`ok${i}`)
        } catch (err) {
          outcomes.push(`err${i}: ${(err as Error).message}`)
        }
      }
    })()

    const events: string[] = []
    const refuse = (): Promise<never> => Promise.reject(new Error('the test ends the Repair here'))
    const jobs = createHelperPackJobs({
      ...svc.helperPackDeps(),
      fetchVerified: async (file, dir) => join(dir, file.name),
      unpack: refuse,
      compileStdlib: refuse,
      pip: refuse,
      check: refuse,
      retry: { attempts: 1, firstDelayMs: 0, budgetMs: 0, checksumsAnswerMs: 0, binaryAnswerMs: 0, idleMs: 0 },
      helper: {
        ...svc.helperControl,
        stop: async () => {
          events.push(`stop after ${outcomes.length} answered`)
          await svc.helperControl.stop()
        }
      },
      log: () => undefined
    })
    const job = jobs.install({ repair: true })
    expect(job.params).toEqual({ kind: 'repair' })
    expect(await until(() => jobs.queue.list().some((j) => j.id === job.id && (j.status === 'failed' || j.status === 'done')), 10_000)).toBe(true)
    await caller

    expect(jobs.queue.list().find((j) => j.id === job.id)?.error).toBe('the test ends the Repair here')
    expect(events).toHaveLength(1)
    expect(outcomes).toHaveLength(3)
    for (const outcome of outcomes) expect(outcome).toMatch(new RegExp(`^(ok\\d|err\\d: ${HELPER_BEING_REPAIRED})$`))
  })
})

describe('the install job’s status', () => {
  it('keeps saying ready while a helper runs: its controls still work, and the job’s bar is in EXPORT', async () => {
    devWithFake()
    const { startSidecar, getSidecar, reportHelperInstall, sidecarStatus } = await service()
    const told: SidecarStatus[] = []
    startSidecar((s) => told.push(s))
    await getSidecar().start()
    expect(await until(() => told.some((s) => s.state === 'ready'), 10_000)).toBe(true)
    reportHelperInstall({ state: 'installing', stage: 'Downloading' })
    expect(sidecarStatus().state, 'a running helper is still ready: its controls still work').toBe('ready')
    expect(told.some((s) => s.state === 'installing')).toBe(false)
  })
})

describe.skipIf(!MACHINE)('the install job’s status with no helper', () => {
  it('broadcasts each stage, and the offer’s bytes left counts the verified downloads', async () => {
    const pack = HELPER_PACK.platforms[MACHINE!]
    // The interpreter already verified in downloads/<n>: its size is what counts (a sparse file, no bytes written).
    const dl = join(electron.userData, 'python', 'downloads', String(HELPER_PACK.pack))
    mkdirSync(dl, { recursive: true })
    const fd = openSync(join(dl, pack.interpreter.name), 'w')
    ftruncateSync(fd, pack.interpreter.bytes)
    closeSync(fd)
    const { startSidecar, reportHelperInstall, settleHelperStatus, sidecarStatus } = await service()
    const told: SidecarStatus[] = []
    startSidecar((s) => told.push(s))
    expect(told[0]).toMatchObject({ state: 'absent', offer: { kind: 'install', bytes: packBytes(pack), bytesLeft: packBytes(pack) - pack.interpreter.bytes } })
    reportHelperInstall({ state: 'installing', stage: 'Downloading' })
    expect(sidecarStatus()).toEqual({ state: 'installing', stage: 'Downloading' })
    settleHelperStatus()
    expect(sidecarStatus()).toMatchObject({ state: 'absent' })
    expect(spawned).toEqual([])
  })

  it('a ready from a pack carries its receipt’s failed self-test groups in degraded, with the reason', async () => {
    const reason = "beats needs Microsoft's Visual C++ runtime"
    const { python } = installPack({ selftest: { asr: 'ok', beats: reason, onnx: 'ok', vision: 'ok', sklearn: 'ok', faces: 'ok' } })
    FAKE.packPython = python
    const { startSidecar } = await service()
    const told: SidecarStatus[] = []
    startSidecar((s) => told.push(s))
    expect(await until(() => told.some((s) => s.state === 'ready'), 10_000)).toBe(true)
    const ready = told.find((s) => s.state === 'ready') as Extract<SidecarStatus, { state: 'ready' }>
    expect(ready.hello.degraded).toEqual({ 'audio.beats': reason })
    expect(ready.selftest).toMatchObject({ beats: reason, asr: 'ok' })
    expect(ready, 'a receipt with no integrity problem puts none on the status').not.toHaveProperty('integrity')
  })

  it('a ready from a pack carries its receipt’s integrity problems, for the row’s warning and its Repair (§16.51)', async () => {
    const leak = "The AI helper's Python path reaches outside its folder: /Users/someone/.local/lib/python3.14/site-packages"
    const version = 'The AI helper runs Python 3.14.6, not 3.14.8'
    const { python } = installPack({ integrity: [leak, version] })
    FAKE.packPython = python
    const { startSidecar, sidecarStatus } = await service()
    const told: SidecarStatus[] = []
    startSidecar((s) => told.push(s))
    expect(await until(() => told.some((s) => s.state === 'ready'), 10_000)).toBe(true)
    // The pack runs, and says what is wrong with it.
    expect(told.find((s) => s.state === 'ready')).toMatchObject({ state: 'ready', source: { kind: 'pack' }, integrity: [leak, version] })
    expect(sidecarStatus()).toMatchObject({ state: 'ready', integrity: [leak, version] })
    expect(helperRowFrom(sidecarStatus())).toEqual({ running: true, reason: null })
  })
})

describe.skipIf(!MACHINE)('a pack another Forge window holds the lock of (§16.53 (a))', () => {
  /** The other window: a live process that is not this one (this test's parent), holding the root's lock as its Repair would. */
  async function otherWindowLock(pid = process.ppid): Promise<{ release(): Promise<void> }> {
    const { acquireLock, pidAlive } = await import('../src/main/sidecar/lock')
    const { nodePackFs } = await import('../src/main/sidecar/install')
    expect(pidAlive(pid), `pid ${pid} stands in for a live window`).toBe(true)
    return acquireLock(join(electron.userData, 'python'), nodePackFs(), { pid, now: Date.now, isAlive: pidAlive })
  }
  const packSource = (): { kind: 'pack'; pack: number; root: string } => ({ kind: 'pack', pack: HELPER_PACK.pack, root: join(electron.userData, 'python', String(HELPER_PACK.pack)) })

  it('while the first window holds the lock, the second’s getSidecar throws the sentence and spawns nothing; the ask after the release starts it', async () => {
    const { python } = installPack()
    FAKE.packPython = python
    const first = await otherWindowLock()
    const { startSidecar, getSidecar, sidecarStatus } = await service()
    const told: SidecarStatus[] = []
    startSidecar((s) => told.push(s))
    const refused: SidecarStatus = { state: 'failed', error: HELPER_REPAIRED_ELSEWHERE, source: packSource() }
    expect(told).toEqual([refused])
    expect(() => getSidecar()).toThrow(HELPER_REPAIRED_ELSEWHERE)
    expect(() => getSidecar()).toThrow(HELPER_REPAIRED_ELSEWHERE)
    // The row reads it as not running, with the sentence, never as Install.
    expect(sidecarStatus()).toEqual(refused)
    expect(helperRowFrom(refused)).toEqual({ running: false, reason: HELPER_REPAIRED_ELSEWHERE })
    expect(told, 'said once while it stands').toEqual([refused])
    expect(spawned, 'nothing starts from a pack another window may be deleting').toEqual([])
    await first.release()
    // Asked again once the lock is gone: the order is resolved again and the pack started.
    expect(sidecarStatus()).toEqual({ state: 'starting', source: packSource() })
    expect(await until(() => told.some((s) => s.state === 'ready'), 10_000)).toBe(true)
    expect(spawned).toHaveLength(1)
    expect(getSidecar()).toBeTruthy()
  })

  it('this window’s own lock (its own job, by its pid) refuses nothing', async () => {
    const { python } = installPack()
    FAKE.packPython = python
    const own = await otherWindowLock(process.pid)
    const { getSidecar } = await service()
    await getSidecar().start()
    expect(spawned).toHaveLength(1)
    await own.release()
  })

  it('a helper from the pack that crashes while another window holds the lock is not restarted from it, and the status says why', async () => {
    const { python } = installPack()
    FAKE.packPython = python
    const pids = join(electron.userData, 'pids.txt')
    process.env.FAKE_PIDS = pids
    const { startSidecar, getSidecar } = await service()
    const told: SidecarStatus[] = []
    startSidecar((s) => told.push(s))
    const helper = getSidecar()
    await helper.start()
    const first = await otherWindowLock()
    await helper.request('fake.crash').catch(() => undefined)
    // The restart comes 400 ms after the crash; it asks the lock first, and is refused.
    expect(await until(() => told.some((s) => s.state === 'failed' && s.error === HELPER_REPAIRED_ELSEWHERE), 5000), JSON.stringify(told)).toBe(true)
    await new Promise((r) => setTimeout(r, 600))
    expect(pidsIn(pids), 'no restart from the locked pack').toHaveLength(1)
    // A request meanwhile is refused with the sentence, and spawns nothing.
    await expect(getSidecar().request('system.ping', { echo: 1 })).rejects.toThrow(HELPER_REPAIRED_ELSEWHERE)
    expect(pidsIn(pids)).toHaveLength(1)
    await first.release()
    expect(await getSidecar().request('system.ping', { echo: 2 })).toEqual({ pong: 2 })
    expect(pidsIn(pids)).toHaveLength(2)
  })
})

describe('readyStatus', () => {
  const hello = { protocolVersion: 1, python: '3.14.8', platform: 'darwin', capabilities: [], degraded: {}, executable: '/p', prefix: '/p', path: [] }
  const source = { kind: 'pack', pack: 1, root: '/u/python/1' } as const

  it('carries the receipt’s integrity when there is any, with or without a self-test record', async () => {
    const { readyStatus } = await service()
    expect(readyStatus(hello, source, null, ['x'])).toEqual({ state: 'ready', hello, source, integrity: ['x'] })
    expect(readyStatus(hello, source, { beats: 'ok' }, ['x'])).toMatchObject({ integrity: ['x'], selftest: { beats: 'ok' } })
    expect(readyStatus(hello, source, null, [])).toEqual({ state: 'ready', hello, source })
    expect(readyStatus(hello, source, null)).toEqual({ state: 'ready', hello, source })
  })
})

describe('the launch sweep at startup', () => {
  it('sweeps this build’s own root: python-dev in development, never the installed app’s python/', async () => {
    electron.packaged = false
    for (const root of ['python-dev', 'python']) {
      mkdirSync(join(electron.userData, root, '1', 'python'), { recursive: true })
      writeFileSync(join(electron.userData, root, '1', 'python', 'partial.txt'), 'no receipt')
    }
    const { runLaunchSweep } = await service()
    const removed = await runLaunchSweep()
    expect(removed).toEqual([join(electron.userData, 'python-dev', '1')])
    expect(existsSync(join(electron.userData, 'python-dev', '1'))).toBe(false)
    expect(existsSync(join(electron.userData, 'python', '1', 'python', 'partial.txt'))).toBe(true)
    expect(existsSync(join(electron.userData, 'python-dev', '.lock')), 'the sweep’s lock released').toBe(false)
  })
})

describe.skipIf(!MACHINE)('the IPC', () => {
  it('helper:install queues one job in the list, render:cancel stops it, and the status says what is on disk again', async () => {
    const started: string[] = []
    const refuse = (): Promise<never> => Promise.reject(new Error('not reached'))
    const workers: HelperPackWorkers = {
      fetchVerified: (file, _dir, f) => {
        started.push(file.name)
        return new Promise((_resolve, reject) => {
          const abort = (): void => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))
          if (f.signal.aborted) abort()
          f.signal.addEventListener('abort', abort, { once: true })
        })
      },
      unpack: refuse,
      compileStdlib: refuse,
      pip: refuse,
      check: refuse,
      retry: { attempts: 1, firstDelayMs: 0, budgetMs: 0, checksumsAnswerMs: 0, binaryAnswerMs: 0, idleMs: 0 }
    }
    const { registerIpc } = await import('../src/main/ipc')
    const { startSidecar } = await service()
    const told: SidecarStatus[] = []
    startSidecar((s) => told.push(s))
    registerIpc(() => null, { helperWorkers: workers })
    const call = (channel: string, payload?: unknown): unknown => electron.handlers.get(channel)!({}, payload)

    expect(() => call(HELPER_CHANNELS.install, { repair: 'yes' })).toThrow()
    expect(() => call(HELPER_CHANNELS.remove, {})).toThrow()
    const job = call(HELPER_CHANNELS.install, {}) as Job
    expect(job).toMatchObject({ presetId: HELPER_PRESET, inputName: 'the AI helper', params: { kind: 'install' } })
    expect((call(HELPER_CHANNELS.install, {}) as Job).id, 'a second press joins the first').toBe(job.id)
    expect(await until(() => started.length === 1, 5000)).toBe(true)
    expect(started).toEqual([HELPER_PACK.platforms[MACHINE!].interpreter.name])
    expect((call('jobs:list') as Job[]).filter((j) => j.presetId === HELPER_PRESET).map((j) => j.id)).toEqual([job.id])
    await call('render:cancel', job.id)
    const status = (): string | undefined => (call('jobs:list') as Job[]).find((j) => j.id === job.id)?.status
    expect(await until(() => status() === 'cancelled', 5000), String(status())).toBe(true)
    expect(told.map((s) => (s.state === 'installing' ? s.stage : s.state))).toEqual(['absent', 'Checking', 'Downloading', 'absent'])
    expect(existsSync(join(electron.userData, 'python', '.lock'))).toBe(false)
    expect(spawned).toEqual([])
    call('jobs:clearFinished')
    expect((call('jobs:list') as Job[]).some((j) => j.presetId === HELPER_PRESET)).toBe(false)
  })

  it('helper:modelsBytes answers what userData/models takes, for Remove’s box, and 0 with none (§16.47)', async () => {
    const { registerIpc } = await import('../src/main/ipc')
    registerIpc(() => null)
    const ask = (): Promise<number | null> => electron.handlers.get(HELPER_CHANNELS.modelsBytes)!({}) as Promise<number | null>
    expect(await ask()).toBe(0)
    mkdirSync(join(electron.userData, 'models'), { recursive: true })
    writeFileSync(join(electron.userData, 'models', 'blaze_face.tflite'), Buffer.alloc(229_746))
    expect(await ask()).toBeGreaterThanOrEqual(229_746)
    expect(spawned).toEqual([])
  })
})
