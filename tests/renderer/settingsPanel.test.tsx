import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatBytes } from '@shared/assets/pack'
import { STOP_SPEECH_MODEL, speechModelLabel } from '@shared/asr/speechModel'
import { HELPER_PYTHON_MISSING } from '@shared/sidecar/helperPython'
import { HELPER_IN_USE_ELSEWHERE, HELPER_PRESET, HELPER_WORKING } from '@shared/sidecar/install'
import { packHosts } from '@shared/sidecar/pack'
import { HELPER_PACK } from '@shared/sidecar/packManifest'
import { SIDECAR_METHODS, type HelloResult, type ModelStatus } from '@shared/sidecar/protocol'
import { SELFTEST_GROUP_NAMES, VCRUNTIME_SENTENCE } from '@shared/sidecar/selftest'
import type { PackOffer, SidecarStatus } from '@shared/sidecar/status'
import type { Job } from '@shared/types'

/*
 * The AI helper's row in Settings, rendered and pressed (docs/CLIPS.md §3a.4,
 * §3a.7's component tests): every state with its words, the presses with the
 * OFFER's size on them, Remove's confirm with its box off, Check again's busy
 * state and main's refusal, and the speech model's sized press.
 *
 * As tests/renderer/ingestPanel.test.tsx does it: the store mocked to a plain
 * selector over the REAL store's state, so every press runs the real action,
 * and `window.forge` stubbed with spies, so what is checked is what reaches
 * the bridge. `HelperSection` has no hook but the store's for exactly this.
 */

vi.mock('../../src/renderer/src/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/src/store')>()
  const store = real.useEditor
  const useEditor = Object.assign((select: (s: unknown) => unknown) => select(store.getState()), {
    getState: store.getState,
    setState: store.setState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe
  })
  return { ...real, useEditor }
})

const { useEditor } = await import('../../src/renderer/src/store')
const { HelperSection, THIS_PACK, dotClass } = await import('../../src/renderer/src/components/SettingsPanel')

const state = () => useEditor.getState()

/* ------------------------------------------------------------ the walk */

interface Host {
  type: string
  props: Record<string, unknown>
}

function hosts(node: ReactNode, out: Host[] = []): Host[] {
  if (Array.isArray(node)) {
    for (const child of node) hosts(child as ReactNode, out)
    return out
  }
  if (!isValidElement(node)) return out
  const props = node.props as Record<string, unknown> & { children?: ReactNode }
  const type = node.type as unknown
  if (typeof type === 'string') {
    out.push({ type, props })
    return hosts(props.children, out)
  }
  if (typeof type === 'function') return hosts((type as (p: unknown) => ReactNode)(props), out)
  return hosts(props.children, out)
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((n) => textOf(n as ReactNode)).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

const section = (): Host[] => hosts(createElement(HelperSection))
const button = (label: string): Host | undefined =>
  section().find((h) => h.type === 'button' && textOf(h.props.children as ReactNode).trim() === label)
const buttonStarting = (prefix: string): Host | undefined =>
  section().find((h) => h.type === 'button' && textOf(h.props.children as ReactNode).trim().startsWith(prefix))
const press = (host: Host | undefined, what: string): unknown => {
  expect(host, what).toBeTruthy()
  return (host!.props.onClick as () => unknown)()
}
const markup = (): string => renderToStaticMarkup(createElement(HelperSection))
const words = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

/* ------------------------------------------------------------ fixtures */

const offer = (over: Partial<Extract<PackOffer, { supported: true }>> = {}): Extract<PackOffer, { supported: true }> => ({
  supported: true,
  kind: 'install',
  bytes: 213_456_789,
  bytesOnDisk: 731_234_567,
  hosts: packHosts(HELPER_PACK.platforms['win32-x64']),
  ...over
})

const hello = (capabilities: readonly string[], degraded: Record<string, string> = {}): HelloResult => ({
  protocolVersion: 1,
  python: '3.14.8',
  platform: 'Darwin-arm64',
  capabilities: [...capabilities],
  degraded,
  executable: '/Users/a/Library/Application Support/Forge/python/1/python/bin/python3.14',
  prefix: '/Users/a/Library/Application Support/Forge/python/1/python',
  path: []
})

const allOk = (): Record<string, string> => Object.fromEntries(SELFTEST_GROUP_NAMES.map((g) => [g, 'ok']))
const packSource = { kind: 'pack', pack: 1, root: '/Users/a/Library/Application Support/Forge/python/1' } as const
const readyPack = (over: Partial<Extract<SidecarStatus, { state: 'ready' }>> = {}): SidecarStatus => ({
  state: 'ready',
  hello: hello(THIS_PACK.expects),
  source: packSource,
  selftest: allOk(),
  ...over
})

const SPEECH: ModelStatus = { present: false, bytes: 486_539_264, label: 'the speech model', host: 'huggingface.co' }

const forge = {
  installHelper: vi.fn(async (_options: { repair?: boolean; update?: boolean }) => ({ id: 'h1', presetId: HELPER_PRESET }) as unknown as Job),
  removeHelper: vi.fn(async (_options: { models: boolean }) => undefined),
  checkHelperAgain: vi.fn(async () => undefined),
  helperModelsBytes: vi.fn(async (): Promise<number | null> => 0),
  speechModel: vi.fn(async (_request: { download?: boolean }) => ({ ...SPEECH })),
  cancelSpeechModel: vi.fn(async () => undefined),
  onSpeechModelProgress: vi.fn((_cb: unknown) => () => undefined)
}

function show(status: SidecarStatus | null, over: Partial<ReturnType<typeof state>> = {}): void {
  useEditor.setState({ ...useEditor.getInitialState(), helperStatus: status, ...over })
}

beforeEach(() => {
  for (const spy of Object.values(forge)) spy.mockClear()
  vi.stubGlobal('window', { forge })
})

/* --------------------------------------------------------------- states */

describe('the AI helper row, state by state', () => {
  it('Not installed: grey, the Install with the offer’s size, the hosts under it', () => {
    show({ state: 'absent', offer: offer() })
    const html = markup()
    const shown = words(html)
    expect(shown).toContain('Not installed')
    expect(shown).toContain(`Install the AI helper · ${formatBytes(213_456_789)}`)
    expect(shown).toContain(`Uses about ${formatBytes(731_234_567)} on disk. Downloads from github.com (and the host it redirects to, today release-assets.githubusercontent.com) and files.pythonhosted.org.`)
    expect(html).toContain(dotClass('grey'))
    expect(html).not.toContain(dotClass('red'))
    expect(shown).not.toContain('Not running')
  })

  it('Not installed after a cancel: what is left on the button', () => {
    show({ state: 'absent', offer: offer({ bytesLeft: 125_829_120 }) })
    expect(words(markup())).toContain(`Install the AI helper · ${formatBytes(125_829_120)} left`)
  })

  it('Installing: the job’s stage, and every press waiting for it with the reason on its title', () => {
    const job: Job = {
      id: 'h1',
      presetId: HELPER_PRESET,
      input: '',
      inputName: 'the AI helper',
      output: '',
      params: { kind: 'install' },
      status: 'running',
      progress: 0.2,
      speed: 'downloading · 31 of 205 MB · 4.2 MB/s',
      error: null,
      startedAt: 1,
      finishedAt: null
    }
    show({ state: 'absent', offer: offer() })
    state().setJobs([job])
    const shown = words(markup())
    expect(shown).toContain('Installing')
    expect(shown).toContain('downloading · 31 of 205 MB · 4.2 MB/s')
    const install = buttonStarting('Install the AI helper')
    expect(install?.props.disabled).toBe(true)
    expect(String(install?.props.title)).toContain('EXPORT')
  })

  it('Running from the pack, green: Python, pack, size, and Repair with the manifest’s size, and Remove', () => {
    show(readyPack())
    const html = markup()
    const shown = words(html)
    expect(shown).toContain(`Running · Python 3.14.8 · pack 1 · ${formatBytes(THIS_PACK.bytesOnDisk)}`)
    expect(button(`Repair · ${formatBytes(THIS_PACK.bytes)}`), 'Repair').toBeTruthy()
    expect(button('Remove'), 'Remove').toBeTruthy()
    expect(html).toContain(dotClass('green'))
  })

  it('Running short of a feature for the Visual C++ runtime: the count, the sentence with its link pressable, Check again', () => {
    const reason = `beats ${VCRUNTIME_SENTENCE}`
    show(readyPack({ hello: hello(THIS_PACK.expects, { [SIDECAR_METHODS.beats]: reason }), selftest: { ...allOk(), beats: reason } }))
    const html = markup()
    expect(words(html)).toContain(`${THIS_PACK.expects.length - 1} of ${THIS_PACK.expects.length} helper features`)
    expect(html).toMatch(/<a href="https:\/\/aka\.ms\/vs\/17\/release\/vc_redist\.x64\.exe" target="_blank" rel="noreferrer"/)
    expect(button('Check again'), 'Check again').toBeTruthy()
    expect(html).not.toContain(dotClass('green'))
  })

  it('a bare hello on FORGE_PYTHON is not green, and Install stays beside it', () => {
    show({ state: 'ready', hello: hello([]), source: { kind: 'env', python: 'C:\\Python312\\python.exe' } })
    const html = markup()
    expect(html).not.toContain(dotClass('green'))
    expect(words(html)).toContain('used instead of FORGE_PYTHON once installed')
    expect(buttonStarting('Install the AI helper ·'), 'Install').toBeTruthy()
  })

  it('a damaged pack is red and offers Repair with the offer’s size, never Install', () => {
    show({ state: 'damaged', reason: HELPER_PYTHON_MISSING, offer: offer({ kind: 'repair' }) })
    const html = markup()
    expect(words(html)).toContain("Python is missing from the AI helper's folder")
    expect(html).toContain(dotClass('red'))
    expect(button(`Repair · ${formatBytes(213_456_789)}`), 'Repair').toBeTruthy()
    expect(words(html)).not.toContain('Install the AI helper')
  })

  it('an older pack reads Update with its size; a machine with no pack, its reason and no button', () => {
    show({ state: 'absent', offer: offer({ kind: 'update' }) })
    expect(button(`Update the AI helper · ${formatBytes(213_456_789)}`), 'Update').toBeTruthy()
    show({ state: 'absent', offer: { supported: false, reason: 'The AI helper is not available on Windows on Arm yet' } })
    expect(words(markup())).toContain('Not available on this computer · The AI helper is not available on Windows on Arm yet')
    expect(section().filter((h) => h.type === 'button')).toHaveLength(0)
  })
})

/* -------------------------------------------------------------- presses */

describe('the presses reach the bridge', () => {
  it('Install, Repair and Update each start the job they name', async () => {
    show({ state: 'absent', offer: offer() })
    await press(buttonStarting('Install the AI helper'), 'Install')
    show(readyPack())
    await press(buttonStarting('Repair ·'), 'Repair')
    show({ state: 'absent', offer: offer({ kind: 'update' }) })
    await press(buttonStarting('Update the AI helper'), 'Update')
    expect(forge.installHelper.mock.calls.map((c) => c[0])).toEqual([{}, { repair: true }, { update: true }])
  })

  it('Check again is busy while it runs, and shows main’s refusal as main worded it', async () => {
    let refuse: (err: Error) => void = () => undefined
    forge.checkHelperAgain.mockImplementationOnce(() => new Promise<undefined>((_resolve, reject) => (refuse = reject)))
    show(readyPack({ selftest: { ...allOk(), sklearn: 'sklearn failed: x' } }))
    const pending = press(button('Check again'), 'Check again') as Promise<void>
    expect(forge.checkHelperAgain).toHaveBeenCalledTimes(1)
    expect(button('Checking…')?.props.disabled).toBe(true)
    // Every other press waits for it.
    expect(buttonStarting('Repair ·')?.props.disabled).toBe(true)
    refuse(new Error(`Error invoking remote method 'helper:checkAgain': Error: ${HELPER_IN_USE_ELSEWHERE}`))
    await pending
    expect(words(markup())).toContain(HELPER_IN_USE_ELSEWHERE)
    expect(words(markup())).not.toContain('Error invoking remote method')
    expect(button('Check again')?.props.disabled).toBe(false)
  })

  it('Remove asks first, its box off by default: the press removes the pack only', async () => {
    show(readyPack())
    await press(button('Remove'), 'Remove')
    expect(forge.removeHelper).not.toHaveBeenCalled()
    const box = section().find((h) => h.type === 'input' && h.props.type === 'checkbox')
    expect(box?.props.checked).toBe(false)
    expect(words(markup())).toContain(`It frees about ${formatBytes(THIS_PACK.bytesOnDisk)}`)
    expect(words(markup())).toContain('also remove the downloaded models')
    await press(button('Remove it'), 'Remove it')
    expect(forge.removeHelper.mock.calls.map((c) => c[0])).toEqual([{ models: false }])
  })

  it('Remove names both sizes: the pack’s in its question, the downloaded models’ beside its box (§16.47)', async () => {
    forge.helperModelsBytes.mockResolvedValueOnce(486_539_271)
    show(readyPack())
    await press(button('Remove'), 'Remove')
    expect(forge.helperModelsBytes).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(state().helperUi.removing?.modelsBytes).toBe(486_539_271))
    const shown = words(markup())
    expect(shown).toContain(`It frees about ${formatBytes(THIS_PACK.bytesOnDisk)}`)
    expect(shown).toContain(`also remove the downloaded models · ${formatBytes(486_539_271)}`)
    // Ticked before main answered: the box stays as it was left, and the size still lands beside it.
    state().cancelRemove()
    let answer: (bytes: number) => void = () => undefined
    forge.helperModelsBytes.mockImplementationOnce(() => new Promise<number>((resolve) => (answer = resolve)))
    await press(button('Remove'), 'Remove')
    state().setRemoveModels(true)
    answer(52_428_800)
    await vi.waitFor(() => expect(state().helperUi.removing).toEqual({ models: true, modelsBytes: 52_428_800 }))
    await press(button('Remove it'), 'Remove it')
    expect(forge.removeHelper.mock.calls.map((c) => c[0])).toEqual([{ models: true }])
  })

  it('Remove’s box shows no size when no model is downloaded, or main could not say', async () => {
    for (const bytes of [0, null]) {
      forge.helperModelsBytes.mockResolvedValueOnce(bytes)
      show(readyPack())
      await press(button('Remove'), 'Remove')
      await vi.waitFor(() => expect(state().helperUi.removing?.modelsBytes).toBe(bytes))
      expect(markup()).not.toContain('data-models-bytes')
      expect(words(markup())).toContain('also remove the downloaded models Remove it')
    }
  })

  it('Remove with the box ticked takes the models too, and Keep it closes the confirm', async () => {
    show(readyPack())
    await press(button('Remove'), 'Remove')
    const box = section().find((h) => h.type === 'input' && h.props.type === 'checkbox')
    ;(box!.props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: true } })
    await press(button('Remove it'), 'Remove it')
    expect(forge.removeHelper.mock.calls.map((c) => c[0])).toEqual([{ models: true }])
    await press(button('Remove'), 'Remove')
    press(button('Keep it'), 'Keep it')
    expect(state().helperUi.removing).toBeNull()
  })

  it('a refused Remove keeps its confirm and says why', async () => {
    forge.removeHelper.mockImplementationOnce(async () => {
      throw new Error(`Error invoking remote method 'helper:remove': Error: ${HELPER_WORKING}`)
    })
    show(readyPack())
    await press(button('Remove'), 'Remove')
    await press(button('Remove it'), 'Remove it')
    expect(state().helperUi.removing).not.toBeNull()
    expect(words(markup())).toContain(HELPER_WORKING)
  })
})

describe('the speech model in the row', () => {
  it('is the sized press while it is not on disk, and the press fetches it', async () => {
    show(readyPack(), { speechModel: { ...SPEECH } })
    const get = button(speechModelLabel(SPEECH))
    expect(get, 'Get the speech model').toBeTruthy()
    forge.speechModel.mockImplementationOnce(async () => ({ ...SPEECH, present: true }))
    await press(get, 'Get the speech model')
    expect(forge.speechModel.mock.calls.map((c) => c[0])).toEqual([{ download: true }])
    expect(words(markup())).toContain(`Speech model · ${formatBytes(SPEECH.bytes)} · on this machine`)
  })

  it('has an X while it is being fetched, which asks main to cancel; none before or after', async () => {
    show(readyPack(), { speechModel: { ...SPEECH } })
    const xOf = (): Host[] => section().filter((h) => h.type === 'button' && h.props.title === STOP_SPEECH_MODEL)
    expect(xOf()).toEqual([])
    useEditor.setState({ speechFetch: { progress: 0.42 } })
    expect(words(markup())).toContain('Getting the speech model… 42%')
    expect(xOf()).toHaveLength(1)
    expect(xOf()[0].props['aria-label']).toBe(STOP_SPEECH_MODEL)
    press(xOf()[0], 'the X')
    expect(forge.cancelSpeechModel).toHaveBeenCalledTimes(1)
    useEditor.setState({ speechFetch: null, speechModel: { ...SPEECH, present: true } })
    expect(xOf()).toEqual([])
  })

  it('is not offered while the helper cannot transcribe', () => {
    show(readyPack({ hello: hello(THIS_PACK.expects.filter((m) => m !== SIDECAR_METHODS.transcribe)) }), { speechModel: { ...SPEECH } })
    expect(words(markup())).not.toContain('Get the speech model')
  })
})
