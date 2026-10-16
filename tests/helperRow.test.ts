import { describe, expect, it } from 'vitest'
import { formatBytes } from '@shared/assets/pack'
import { speechModelLabel } from '@shared/asr/speechModel'
import { HELPER_PACK } from '@shared/sidecar/packManifest'
import { packBytes, packHosts } from '@shared/sidecar/pack'
import { HELPER_PYTHON_MISSING, HELPER_RECEIPT_UNREADABLE } from '@shared/sidecar/helperPython'
import { SIDECAR_METHODS, type HelloResult, type ModelStatus } from '@shared/sidecar/protocol'
import { SELFTEST_GROUP_NAMES, VCRUNTIME_SENTENCE } from '@shared/sidecar/selftest'
import { HELPER_PRESET, HELPER_REPAIRED_ELSEWHERE } from '@shared/sidecar/install'
import { HELPER_BLOCKED_BY_POLICY, type PackOffer, type SidecarStatus } from '@shared/sidecar/status'
import type { Job } from '@shared/types'
import {
  INSTEAD_OF_FORGE_PYTHON,
  JOB_IN_EXPORT,
  JOB_STARTING,
  JOB_WAITING,
  OLD_PACK_UNUSED,
  ROW_WORDS,
  helperErrorText,
  helperJobFrom,
  helperRow,
  hostsSentence,
  packFactsFor,
  speechModelRow,
  transcribeGate,
  type HelperJob,
  type HelperRow,
  type PackFacts
} from '@shared/sidecar/row'

/*
 * The AI helper's Settings row, state by state (docs/CLIPS.md §3a.4's table,
 * §16.41/42/46/47/51), and the header's dot, which is the same reading.
 *
 * Every size is computed here from the fixture's own offer or the manifest,
 * never written down: the pack's bytes change whenever its lock does. The
 * offers use odd byte counts so a size written into the row by hand cannot
 * pass by coincidence.
 */

const WIN = HELPER_PACK.platforms['win32-x64']
const PACK: PackFacts = packFactsFor(HELPER_PACK, 'Win32')
const HOSTS = packHosts(WIN)

const offer = (over: Partial<Extract<PackOffer, { supported: true }>> = {}): Extract<PackOffer, { supported: true }> => ({
  supported: true,
  kind: 'install',
  bytes: 213_456_789,
  bytesOnDisk: 731_234_567,
  hosts: HOSTS,
  ...over
})

const hello = (capabilities: readonly string[], degraded: Record<string, string> = {}): HelloResult => ({
  protocolVersion: 1,
  python: '3.14.8',
  platform: 'Windows-AMD64',
  capabilities: [...capabilities],
  degraded,
  executable: 'C:\\Users\\a\\AppData\\Roaming\\Forge\\python\\1\\python\\python.exe',
  prefix: 'C:\\Users\\a\\AppData\\Roaming\\Forge\\python\\1\\python',
  path: []
})

const allOk = (): Record<string, string> => Object.fromEntries(SELFTEST_GROUP_NAMES.map((g) => [g, 'ok']))
const packSource = { kind: 'pack', pack: 1, root: 'C:\\Users\\a\\AppData\\Roaming\\Forge\\python\\1' } as const
const envSource = { kind: 'env', python: 'C:\\Python312\\python.exe' } as const
const venvSource = { kind: 'venv', python: '/repo/sidecar/.venv/bin/python' } as const

const readyPack = (over: Partial<Extract<SidecarStatus, { state: 'ready' }>> = {}): SidecarStatus => ({
  state: 'ready',
  hello: hello(PACK.expects),
  source: packSource,
  selftest: allOk(),
  ...over
})

const row = (status: SidecarStatus | null, job: HelperJob | null = null, pack: PackFacts = PACK): HelperRow => helperRow({ status, pack, job })
const kinds = (r: HelperRow): string[] => r.actions.map((a) => a.kind)
const labelOf = (r: HelperRow, kind: string): string | undefined => r.actions.find((a) => a.kind === kind)?.label

/** The words a row puts on screen, every one of them. */
const wordsOf = (r: HelperRow): string[] => [r.word, r.line ?? '', ...(r.detail ?? []), ...r.actions.map((a) => a.label), ...r.actions.map((a) => a.disabled ?? '')]

/** The plan's hosts sentence for the real manifest (§3a.4's table, §16.40 (a)), the size the offer's. */
const PLAN_HOSTS = (bytesOnDisk: number): string =>
  `Uses about ${formatBytes(bytesOnDisk)} on disk. Downloads from github.com (and the host it redirects to, today release-assets.githubusercontent.com) and files.pythonhosted.org. Its own Python; any Python on this machine is left alone.`

describe('Not installed', () => {
  const r = row({ state: 'absent', offer: offer() })

  it('is grey, never red: every tester’s first state, not a fault', () => {
    expect(r.word).toBe(ROW_WORDS.notInstalled)
    expect(r.dot).toBe('grey')
  })

  it('offers Install with the offer’s size on the button, through formatBytes', () => {
    expect(r.actions).toEqual([{ kind: 'install', label: `Install the AI helper · ${formatBytes(213_456_789)}` }])
    // Another offer, another size: nothing on the button is fixed.
    expect(labelOf(row({ state: 'absent', offer: offer({ bytes: 178_190_592 }) }), 'install')).toBe(`Install the AI helper · ${formatBytes(178_190_592)}`)
  })

  it('names, under the button, the size on disk and every host a restricted network must allow', () => {
    expect(r.detail).toContain(PLAN_HOSTS(731_234_567))
    expect(r.hosts).toEqual(HOSTS)
    for (const host of HOSTS) expect(r.detail!.join(' ')).toContain(host)
  })

  it('says what is left after a cancel, and the whole size when nothing is', () => {
    const part = row({ state: 'absent', offer: offer({ bytesLeft: 125_829_120 }) })
    expect(labelOf(part, 'install')).toBe(`Install the AI helper · ${formatBytes(125_829_120)} left`)
    expect(part.dot).toBe('grey')
    expect(labelOf(row({ state: 'absent', offer: offer({ bytesLeft: 213_456_789 }) }), 'install')).toBe(`Install the AI helper · ${formatBytes(213_456_789)}`)
    // After a pack that did not start, everything is verified on disk (§3a.3's built note).
    expect(labelOf(row({ state: 'absent', offer: offer({ bytesLeft: 0 }) }), 'install')).toBe(`Install the AI helper · ${formatBytes(0)} left`)
  })
})

describe('Installing', () => {
  it('reads the job list’s stage, grey, every press waiting for it with its reason, and no second cancel', () => {
    const job: HelperJob = { kind: 'install', stage: 'downloading · 31 of 205 MB · 4.2 MB/s' }
    const r = row({ state: 'absent', offer: offer() }, job)
    expect(r.word).toBe(ROW_WORDS.installing)
    expect(r.line).toBe('downloading · 31 of 205 MB · 4.2 MB/s')
    expect(r.dot).toBe('grey')
    expect(r.detail).toEqual([JOB_IN_EXPORT])
    expect(r.actions.length).toBeGreaterThan(0)
    for (const action of r.actions) expect(action.disabled).toContain('Installing the AI helper')
  })

  it('names a Repair and an Update as themselves, over a running helper too', () => {
    const repairing = row(readyPack(), { kind: 'repair', stage: 'checking space' })
    expect(repairing.word).toBe(ROW_WORDS.repairing)
    expect(repairing.dot).toBe('grey')
    expect(kinds(repairing)).toEqual(['repair', 'remove'])
    for (const action of repairing.actions) expect(action.disabled).toContain('Repairing the AI helper')
    expect(row({ state: 'absent', offer: offer({ kind: 'update' }) }, { kind: 'update', stage: JOB_WAITING }).word).toBe(ROW_WORDS.updating)
  })

  it('reads the installing status itself when no job is listed', () => {
    const r = row({ state: 'installing', stage: 'Installing the libraries' })
    expect([r.word, r.line, r.dot]).toEqual([ROW_WORDS.installing, 'Installing the libraries', 'grey'])
    expect(r.actions).toEqual([])
  })

  it('takes the job from the list: presetId helper, running before queued, its kind from params', () => {
    const job = (over: Partial<Job>): Pick<Job, 'presetId' | 'status' | 'speed' | 'params'> => ({ presetId: HELPER_PRESET, status: 'running', speed: null, params: {}, ...over })
    expect(helperJobFrom([])).toBeNull()
    expect(helperJobFrom([job({ presetId: 'render', status: 'running', speed: '2.1x' })])).toBeNull()
    expect(helperJobFrom([job({ status: 'done' }), job({ status: 'failed' }), job({ status: 'cancelled' })])).toBeNull()
    expect(helperJobFrom([job({ status: 'queued', params: { kind: 'update' } }), job({ status: 'running', speed: 'unpacking Python', params: { kind: 'repair' } })])).toEqual({ kind: 'repair', stage: 'unpacking Python' })
    expect(helperJobFrom([job({ status: 'queued' })])).toEqual({ kind: 'install', stage: JOB_WAITING })
    expect(helperJobFrom([job({ status: 'running', speed: null })])).toEqual({ kind: 'install', stage: JOB_STARTING })
  })
})

describe('Running, from the pack', () => {
  it('is green with every expected method, every group ok and nothing outside the pack: Python, pack, size, Repair and Remove', () => {
    const r = row(readyPack())
    expect(r.word).toBe(ROW_WORDS.running)
    expect(r.dot).toBe('green')
    expect(r.line).toBe(`Python 3.14.8 · pack 1 · ${formatBytes(PACK.bytesOnDisk)}`)
    expect(r.actions).toEqual([
      { kind: 'repair', label: `Repair · ${formatBytes(packBytes(WIN))}` },
      { kind: 'remove', label: 'Remove' }
    ])
  })

  it('takes Repair’s size and the size on disk from the facts it is given, never a number of its own', () => {
    const facts: PackFacts = { ...PACK, bytes: 99_999_999, bytesOnDisk: 1_234_567_890 }
    const r = row(readyPack(), null, facts)
    expect(labelOf(r, 'repair')).toBe(`Repair · ${formatBytes(99_999_999)}`)
    expect(r.line).toBe(`Python 3.14.8 · pack 1 · ${formatBytes(1_234_567_890)}`)
  })

  it('is grey with a degraded expected method: "N of <expects> helper features", the reason, Check again and Repair', () => {
    const r = row(readyPack({ hello: hello(PACK.expects, { [SIDECAR_METHODS.faces]: 'No module named mediapipe' }) }))
    expect(r.dot).toBe('grey')
    expect(r.line).toBe(`${PACK.expects.length - 1} of ${PACK.expects.length} helper features · No module named mediapipe`)
    expect(kinds(r)).toEqual(['checkAgain', 'repair', 'remove'])
    expect(labelOf(r, 'repair')).toBe(`Repair · ${formatBytes(PACK.bytes)}`)
  })

  it('counts out of the manifest’s expects, never a number of its own', () => {
    const three: PackFacts = { ...PACK, expects: [SIDECAR_METHODS.transcribe, SIDECAR_METHODS.beats, SIDECAR_METHODS.faces] }
    const r = row(readyPack({ hello: hello([SIDECAR_METHODS.transcribe, SIDECAR_METHODS.beats]) }), null, three)
    expect(r.line).toBe(`2 of 3 helper features · the AI helper has no ${SIDECAR_METHODS.faces}`)
  })

  it('names the Visual C++ runtime when a group failed for it: its head on the line, the sentence with Microsoft’s link under it', () => {
    const reason = `beats ${VCRUNTIME_SENTENCE}`
    // As main merges it (service.ts readyStatus): the group's methods degraded, the record carried.
    const r = row(readyPack({ hello: hello(PACK.expects, { [SIDECAR_METHODS.beats]: reason }), selftest: { ...allOk(), beats: reason } }))
    expect(r.dot).toBe('grey')
    expect(r.line).toBe(`${PACK.expects.length - 1} of ${PACK.expects.length} helper features · beats needs Microsoft's Visual C++ runtime`)
    expect(r.detail).toEqual([reason])
    expect(r.detail![0]).toContain('https://aka.ms/vs/17/release/vc_redist.x64.exe')
    expect(kinds(r)).toContain('checkAgain')
    expect(kinds(r)).toContain('repair')
  })

  it('is grey when a group with no method of its own failed, though every method counts', () => {
    const r = row(readyPack({ selftest: { ...allOk(), sklearn: 'sklearn failed: DLL load failed' } }))
    expect(r.line).toBe(`${PACK.expects.length} of ${PACK.expects.length} helper features · sklearn failed: DLL load failed`)
    expect(r.dot).toBe('grey')
    expect(kinds(r)).toContain('checkAgain')
  })

  it('reads integrity problems as not green: the first on the line, each one under it, and Repair (§16.51)', () => {
    const integrity = [
      "the AI helper's Python path reaches outside its folder: C:\\Users\\a\\AppData\\Roaming\\Python\\Python314\\site-packages",
      'the AI helper runs Python 3.14.7, not 3.14.8'
    ]
    const r = row(readyPack({ integrity }))
    expect(r.word).toBe(ROW_WORDS.running)
    expect(r.dot).toBe('grey')
    expect(r.line).toBe(`${PACK.expects.length} of ${PACK.expects.length} helper features · ${integrity[0]}`)
    for (const problem of integrity) expect(r.detail).toContain(problem)
    expect(kinds(r)).toContain('repair')
    // An empty list is a pack as it should be.
    expect(row(readyPack({ integrity: [] })).dot).toBe('green')
  })
})

describe('Running, from somewhere else', () => {
  it('a bare hello on FORGE_PYTHON is never green: the process is up and can do nothing', () => {
    const r = row({ state: 'ready', hello: hello([]), source: envSource })
    expect(r.dot).toBe('grey')
    expect(r.line).toBe(`from FORGE_PYTHON C:\\Python312\\python.exe · 0 of ${PACK.expects.length} helper features`)
    // Install stays (§16.42 (b)): in an installed app the pack comes first.
    expect(r.actions).toEqual([{ kind: 'install', label: `Install the AI helper · ${formatBytes(PACK.bytes)}` }])
    expect(r.detail).toContain(INSTEAD_OF_FORGE_PYTHON)
  })

  it('FORGE_PYTHON with every expected method is green, and still offers the Install that replaces it', () => {
    const r = row({ state: 'ready', hello: hello(PACK.expects), source: envSource })
    expect(r.dot).toBe('green')
    expect(r.line).toBe(`from FORGE_PYTHON C:\\Python312\\python.exe · ${PACK.expects.length} of ${PACK.expects.length} helper features`)
    expect(kinds(r)).toEqual(['install'])
    expect(r.detail).toContain(PLAN_HOSTS(PACK.bytesOnDisk))
  })

  it('the development venv has no presses, and is green only with every method', () => {
    const full = row({ state: 'ready', hello: hello(PACK.expects), source: venvSource })
    expect([full.word, full.line, full.dot]).toEqual([ROW_WORDS.running, 'development venv', 'green'])
    expect(full.actions).toEqual([])
    const short = row({ state: 'ready', hello: hello(PACK.expects.slice(1)), source: venvSource })
    expect(short.dot).toBe('grey')
    expect(short.line).toBe(`development venv · ${PACK.expects.length - 1} of ${PACK.expects.length} helper features`)
    expect(short.actions).toEqual([])
  })
})

describe('Update, Not running, Not available', () => {
  it('an older pack on disk reads Update with its size, grey, the old pack unused', () => {
    const r = row({ state: 'absent', offer: offer({ kind: 'update', bytesLeft: 52_428_800 }) })
    expect(r.word).toBe(ROW_WORDS.needsUpdate)
    expect(r.dot).toBe('grey')
    expect(r.actions).toEqual([{ kind: 'update', label: `Update the AI helper · ${formatBytes(52_428_800)}` }])
    expect(r.detail).toContain(OLD_PACK_UNUSED)
    expect(r.detail).toContain(PLAN_HOSTS(731_234_567))
  })

  it('a damaged pack is red and offers Repair with its size, never an Install over it', () => {
    for (const reason of [HELPER_PYTHON_MISSING, HELPER_RECEIPT_UNREADABLE]) {
      const r = row({ state: 'damaged', reason, offer: offer({ kind: 'repair' }) })
      expect([r.word, r.dot, r.line]).toEqual([ROW_WORDS.notRunning, 'red', reason])
      expect(r.actions[0]).toEqual({ kind: 'repair', label: `Repair · ${formatBytes(213_456_789)}` })
      expect(kinds(r)).not.toContain('install')
    }
  })

  it('a pack that will not start is red with main’s sentence, Repair first; FORGE_PYTHON’s gets Install; a dev rung, nothing', () => {
    const pack = row({ state: 'failed', error: HELPER_BLOCKED_BY_POLICY, source: packSource })
    expect([pack.word, pack.dot, pack.line]).toEqual([ROW_WORDS.notRunning, 'red', HELPER_BLOCKED_BY_POLICY])
    expect(pack.actions[0]).toEqual({ kind: 'repair', label: `Repair · ${formatBytes(PACK.bytes)}` })
    const env = row({ state: 'failed', error: 'The AI helper stopped (code 9009)', source: envSource })
    expect(env.dot).toBe('red')
    expect(kinds(env)).toEqual(['install'])
    expect(row({ state: 'failed', error: 'x', source: venvSource }).actions).toEqual([])
    // A status that names no rung (the harness bridge's) still reads, with nothing to press.
    const bare = row({ state: 'failed', error: 'harness: no helper' } as unknown as SidecarStatus)
    expect([bare.word, bare.dot, bare.line, bare.actions]).toEqual([ROW_WORDS.notRunning, 'red', 'harness: no helper', []])
  })

  it('a pack another Forge window holds is grey and offers nothing: every press would be refused (§16.53)', () => {
    const r = row({ state: 'failed', error: HELPER_REPAIRED_ELSEWHERE, source: packSource })
    expect([r.word, r.dot, r.line, r.actions]).toEqual([ROW_WORDS.notRunning, 'grey', HELPER_REPAIRED_ELSEWHERE, []])
  })

  it('a machine with no pack says why, grey, with no button', () => {
    const r = row({ state: 'absent', offer: { supported: false, reason: 'The AI helper needs macOS 14 or later' } })
    expect([r.word, r.line, r.dot]).toEqual([ROW_WORDS.unavailable, 'The AI helper needs macOS 14 or later', 'grey'])
    expect(r.actions).toEqual([])
  })

  it('reads Starting, grey, before main answers and while a helper starts', () => {
    expect([row(null).word, row(null).dot]).toEqual([ROW_WORDS.starting, 'grey'])
    const starting = row({ state: 'starting', source: packSource })
    expect([starting.word, starting.dot, starting.line]).toEqual([ROW_WORDS.starting, 'grey', 'installed by the app · pack 1'])
  })
})

describe('the words', () => {
  it('say "AI helper", never the code’s name for it, in every state', () => {
    const all: (SidecarStatus | null)[] = [
      null,
      { state: 'absent', offer: offer() },
      { state: 'absent', offer: offer({ kind: 'update' }) },
      { state: 'absent', offer: { supported: false, reason: 'The AI helper is not available on Windows on Arm yet' } },
      { state: 'damaged', reason: HELPER_PYTHON_MISSING, offer: offer({ kind: 'repair' }) },
      { state: 'installing', stage: 'Downloading' },
      { state: 'starting', source: packSource },
      readyPack(),
      readyPack({ selftest: { ...allOk(), beats: `beats ${VCRUNTIME_SENTENCE}` } }),
      { state: 'ready', hello: hello([]), source: envSource },
      { state: 'failed', error: 'The AI helper keeps crashing and has been stopped', source: packSource }
    ]
    for (const status of all) {
      for (const job of [null, { kind: 'repair' as const, stage: 'checking the AI helper' }]) {
        for (const text of wordsOf(row(status, job))) expect(text.toLowerCase()).not.toContain('sidecar')
      }
    }
  })

  it('build the hosts sentence from the hosts, the redirect named beside github.com', () => {
    expect(hostsSentence(1024 * 1024 * 700, HOSTS)).toBe(PLAN_HOSTS(1024 * 1024 * 700))
    expect(hostsSentence(1, ['files.pythonhosted.org'])).toBe(
      `Uses about ${formatBytes(1)} on disk. Downloads from files.pythonhosted.org. Its own Python; any Python on this machine is left alone.`
    )
  })

  it('pick this window’s pack by its platform', () => {
    expect(packFactsFor(HELPER_PACK, 'Win32').bytes).toBe(packBytes(WIN))
    expect(packFactsFor(HELPER_PACK, 'MacIntel').bytes).toBe(packBytes(HELPER_PACK.platforms['darwin-arm64']))
    expect(packFactsFor(HELPER_PACK, 'MacIntel').expects).toEqual(HELPER_PACK.platforms['darwin-arm64'].expects)
  })

  it('show a refusal as main worded it, without Electron’s wrapper', () => {
    expect(helperErrorText(new Error("Error invoking remote method 'helper:remove': Error: The AI helper is working; remove it once that work has finished"))).toBe(
      'The AI helper is working; remove it once that work has finished'
    )
    expect(helperErrorText(new Error('The AI helper is in use by another Forge window'))).toBe('The AI helper is in use by another Forge window')
    expect(helperErrorText('plain')).toBe('plain')
  })
})

describe('the speech model', () => {
  const SPEECH: ModelStatus = { present: false, bytes: 486_539_264, label: 'the speech model', host: 'huggingface.co' }

  it('is on this machine with its size, or the sized press, or its progress; nothing while the helper cannot transcribe', () => {
    expect(speechModelRow({ ...SPEECH, present: true }, true, null)).toEqual({ text: `Speech model · ${formatBytes(486_539_264)} · on this machine` })
    expect(speechModelRow(SPEECH, true, null)).toEqual({ text: 'Speech model', get: speechModelLabel(SPEECH) })
    expect(speechModelRow(SPEECH, true, { progress: 0.42 })).toEqual({ text: 'Getting the speech model… 42%' })
    expect(speechModelRow(SPEECH, false, null)).toBeNull()
    expect(speechModelRow(null, true, null)).toBeNull()
  })

  it('gates Transcribe by asr.transcribe and the model on disk', () => {
    const can: SidecarStatus = { state: 'ready', hello: hello([SIDECAR_METHODS.transcribe]), source: envSource }
    expect(transcribeGate(can, { present: true })).toBe('ready')
    expect(transcribeGate(can, { present: false })).toBe('no-model')
    expect(transcribeGate(can, null)).toBe('no-model')
    expect(transcribeGate({ state: 'ready', hello: hello([SIDECAR_METHODS.beats]), source: envSource }, { present: true })).toBe('no-helper')
    expect(transcribeGate({ state: 'absent', offer: offer() }, { present: true })).toBe('no-helper')
    expect(transcribeGate({ state: 'installing', stage: 'Downloading' }, null)).toBe('no-helper')
    expect(transcribeGate(null, null)).toBe('starting')
    expect(transcribeGate({ state: 'starting', source: packSource }, null)).toBe('starting')
  })
})
