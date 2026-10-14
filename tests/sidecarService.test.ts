import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { HELPER_PACK } from '../src/shared/sidecar/packManifest'
import { packBytes, packHosts, type PackPlatform } from '../src/shared/sidecar/pack'
import { HELPER_PYTHON_MISSING, UNPARSEABLE_RECEIPT } from '../src/shared/sidecar/helperPython'
import { HELPER_NEEDS_UPDATE, HELPER_NOT_INSTALLED, helperRowFrom, helperStatusReason, packOffer, type SidecarStatus } from '../src/shared/sidecar/status'
import { REFRAME_CHANNELS, REFRAME_FAILURES } from '../src/shared/reframe/job'

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
function installPack(o: { interpreter?: boolean; receipt?: string; root?: string } = {}): { version: string; python: string } {
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
        lockSha256: pack.lock.sha256
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
