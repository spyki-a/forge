import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatBytes } from '@shared/assets/pack'
import {
  SPEECH_MODEL_BUSY,
  SPEECH_MODEL_SETTING,
  STOP_SPEECH_MODEL,
  speechModelLabel,
  speechModelPin,
  type SpeechModelName,
  type SpeechModelProgress,
  type SpeechModelStatus
} from '@shared/asr/speechModel'
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
/** What main answers for a model: its pinned bytes, on disk as `disk` says. */
const disk: Record<SpeechModelName, boolean> = { small: false, medium: false, 'large-v3': false }
const statusOf = (model: SpeechModelName, present = disk[model]): SpeechModelStatus => ({ ...SPEECH, present, bytes: speechModelPin(model).bytes, model })
/** The settings file's choice, as main keeps it. */
let chosen: SpeechModelName = 'small'

const forge = {
  installHelper: vi.fn(async (_options: { repair?: boolean; update?: boolean }) => ({ id: 'h1', presetId: HELPER_PRESET }) as unknown as Job),
  removeHelper: vi.fn(async (_options: { models: boolean }) => undefined),
  checkHelperAgain: vi.fn(async () => undefined),
  helperModelsBytes: vi.fn(async (): Promise<number | null> => 0),
  speechModel: vi.fn(async (request: { download?: boolean; model?: SpeechModelName }) => statusOf(request.model ?? chosen)),
  cancelSpeechModel: vi.fn(async () => undefined),
  onSpeechModelProgress: vi.fn((_cb: (update: SpeechModelProgress) => void) => () => undefined),
  setSetting: vi.fn(async (key: string, value: unknown) => {
    if (key === SPEECH_MODEL_SETTING) chosen = value as SpeechModelName
    return {}
  })
}

function show(status: SidecarStatus | null, over: Partial<ReturnType<typeof state>> = {}): void {
  useEditor.setState({ ...useEditor.getInitialState(), helperStatus: status, ...over })
}

beforeEach(() => {
  for (const spy of Object.values(forge)) spy.mockClear()
  Object.assign(disk, { small: false, medium: false, 'large-v3': false })
  chosen = 'small'
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

  it('Remove with the box ticked forgets every speech model’s status, so Settings asks again; unticked it forgets none', async () => {
    const known = (): Partial<ReturnType<typeof state>> => {
      const speechModels = { small: statusOf('small', true), medium: statusOf('medium', true), 'large-v3': statusOf('large-v3') }
      return { speechModels, speechChoice: 'medium', speechModel: speechModels.medium }
    }
    show(readyPack(), known())
    await press(button('Remove'), 'Remove')
    await press(button('Remove it'), 'Remove it')
    expect(forge.removeHelper.mock.calls.map((c) => c[0])).toEqual([{ models: false }])
    expect(Object.keys(state().speechModels).sort()).toEqual(['large-v3', 'medium', 'small'])
    expect(state().speechModel?.model).toBe('medium')
    show(readyPack(), known())
    await press(button('Remove'), 'Remove')
    const box = section().find((h) => h.type === 'input' && h.props.type === 'checkbox')
    ;(box!.props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: true } })
    await press(button('Remove it'), 'Remove it')
    expect(forge.removeHelper.mock.calls.at(-1)?.[0]).toEqual({ models: true })
    expect(state().speechModels).toEqual({})
    expect(state().speechModel).toBeNull()
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

describe('the speech model in the row: a choice of three', () => {
  /** Small on this machine and chosen, Medium and Large not: every model known, as the row shows it once asked. */
  const three = (choice: SpeechModelName = 'small', fetching: SpeechModelProgress & { model: SpeechModelName } | null = null) => {
    disk.small = true
    chosen = choice
    const speechModels = { small: statusOf('small'), medium: statusOf('medium'), 'large-v3': statusOf('large-v3') }
    show(readyPack(), { speechModels, speechChoice: choice, speechModel: speechModels[choice], speechFetch: fetching })
  }
  const lineOf = (model: SpeechModelName): Host[] => {
    const all = section()
    const at = all.findIndex((h) => h.props['data-speech-line'] === model)
    expect(at, `the ${model} line`).toBeGreaterThanOrEqual(0)
    const html = renderToStaticMarkup(createElement('div', null, all[at].props.children as ReactNode))
    return [{ type: 'line', props: { words: words(html) } }, ...hosts(all[at].props.children as ReactNode)]
  }
  const wordsOf = (model: SpeechModelName): string => String(lineOf(model)[0].props.words)
  const getOf = (model: SpeechModelName): Host | undefined => section().find((h) => h.type === 'button' && h.props['data-speech-get'] === model)
  const radioOf = (model: SpeechModelName): Host | undefined => section().find((h) => h.type === 'input' && h.props.type === 'radio' && h.props.value === model)
  /** A radio's onChange starts the choice and returns nothing: let its asks land. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
  const downloads = (): unknown[] => forge.speechModel.mock.calls.map((c) => c[0]).filter((r) => (r as { download?: boolean }).download === true)

  it('reads, line by line: label, size, hint, on this machine or its own sized press, and which one Transcribe uses', () => {
    three()
    expect(wordsOf('small')).toBe(`Small · ${formatBytes(486_212_372)} · fastest · on this machine · used by Transcribe`)
    expect(wordsOf('medium')).toBe(`Medium · ${formatBytes(1_530_571_735)} · more accurate, slower ${speechModelLabel({ bytes: 1_530_571_735 })}`)
    expect(wordsOf('large-v3')).toBe(`Large · ${formatBytes(3_090_835_702)} · most accurate, slowest ${speechModelLabel({ bytes: 3_090_835_702 })}`)
    expect(getOf('small'), 'no press for a model on this machine').toBeUndefined()
    expect(getOf('medium')?.props.disabled).toBe(false)
    // Large chosen and not on this machine: marked, with its press; Small still says it is here.
    three('large-v3')
    expect(wordsOf('large-v3')).toContain('most accurate, slowest · used by Transcribe')
    expect(wordsOf('small')).toBe(`Small · ${formatBytes(486_212_372)} · fastest · on this machine`)
    expect(getOf('large-v3')?.props.disabled).toBe(false)
  })

  it('is one radio group under the legend "Speech model", each choice in its own label, the chosen one checked', () => {
    three('medium')
    const html = markup()
    expect(html).toMatch(/<fieldset data-speech-model=""[^>]*><legend[^>]*>Speech model<\/legend>/)
    const radios = section().filter((h) => h.type === 'input' && h.props.type === 'radio')
    expect(radios.map((r) => r.props.value)).toEqual(['small', 'medium', 'large-v3'])
    expect(new Set(radios.map((r) => r.props.name)).size).toBe(1)
    expect(radios.filter((r) => r.props.checked).map((r) => r.props.value)).toEqual(['medium'])
    for (const model of ['small', 'medium', 'large-v3'] as const) expect(lineOf(model).some((h) => h.type === 'label'), `${model} in a label`).toBe(true)
  })

  it('choosing writes the setting and asks that model, and NEVER downloads', async () => {
    three()
    await (radioOf('medium')!.props.onChange as () => void)()
    await settle()
    expect(forge.setSetting.mock.calls).toEqual([[SPEECH_MODEL_SETTING, 'medium']])
    expect(forge.speechModel.mock.calls.map((c) => c[0])).toEqual([{ model: 'medium' }])
    expect(downloads()).toEqual([])
    expect(state().speechChoice).toBe('medium')
    // Transcribe's gate is the chosen model's: Medium is not here, though Small is.
    expect(state().speechModel).toMatchObject({ model: 'medium', present: false })
    expect(wordsOf('medium')).toContain('· used by Transcribe')
    expect(wordsOf('small')).not.toContain('used by Transcribe')
    // Large too, then back to Small: never a download.
    await (radioOf('large-v3')!.props.onChange as () => void)()
    await settle()
    await (radioOf('small')!.props.onChange as () => void)()
    await settle()
    expect(downloads()).toEqual([])
    expect(state().speechModel).toMatchObject({ model: 'small', present: true })
  })

  it('a choice moves Transcribe’s gate at once, to what is known of that model, even when its own ask then fails', async () => {
    three('small')
    forge.speechModel.mockImplementationOnce(async () => {
      throw new Error('The AI helper stopped (code 1)')
    })
    await state().chooseSpeechModel('medium')
    expect(state().speechChoice).toBe('medium')
    expect(state().speechModel).toMatchObject({ model: 'medium', present: false })
    // Nothing known of it: no status, so every Transcribe stays greyed and the panels ask again.
    show(readyPack(), { speechModels: { small: statusOf('small', true) }, speechChoice: 'small', speechModel: statusOf('small', true) })
    forge.speechModel.mockImplementationOnce(async () => {
      throw new Error('The AI helper stopped (code 1)')
    })
    await state().chooseSpeechModel('large-v3')
    expect(state().speechModel).toBeNull()
    expect(downloads()).toEqual([])
  })

  it('a choice main refuses leaves the choice as it was, and says so', async () => {
    three()
    forge.setSetting.mockImplementationOnce(async () => {
      throw new Error(`Error invoking remote method 'settings:set': Error: There is no speech model "medium"`)
    })
    await (radioOf('medium')!.props.onChange as () => void)()
    await settle()
    expect(state().speechChoice).toBe('small')
    expect(state().speechModel?.model).toBe('small')
    expect(state().notices.map((n) => n.text)).toEqual(['There is no speech model "medium"'])
    expect(forge.speechModel).not.toHaveBeenCalled()
  })

  it('a press fetches the model of ITS line, not the chosen one', async () => {
    three('small')
    forge.speechModel.mockImplementationOnce(async () => statusOf('large-v3', true))
    await press(getOf('large-v3'), 'Large’s press')
    expect(forge.speechModel.mock.calls.map((c) => c[0])).toEqual([{ download: true, model: 'large-v3' }])
    expect(state().speechModels['large-v3']?.present).toBe(true)
    // The choice and its gate are untouched: Small stays the one Transcribe uses.
    expect(state().speechChoice).toBe('small')
    expect(state().speechModel?.model).toBe('small')
    expect(wordsOf('large-v3')).toBe(`Large · ${formatBytes(3_090_835_702)} · most accurate, slowest · on this machine`)
  })

  it('while one model is fetched: its progress and X on its own line, the other presses waiting and the reason said', () => {
    three('small', { progress: 0.42, model: 'medium' })
    expect(wordsOf('medium')).toBe(`Medium · ${formatBytes(1_530_571_735)} · more accurate, slower Getting the speech model… 42%`)
    const xs = section().filter((h) => h.type === 'button' && h.props.title === STOP_SPEECH_MODEL)
    expect(xs).toHaveLength(1)
    expect(lineOf('medium').some((h) => h.type === 'button' && h.props.title === STOP_SPEECH_MODEL)).toBe(true)
    expect(xs[0].props['aria-label']).toBe(STOP_SPEECH_MODEL)
    press(xs[0], 'the X')
    expect(forge.cancelSpeechModel).toHaveBeenCalledTimes(1)
    const large = getOf('large-v3')
    expect(large?.props.disabled).toBe(true)
    expect(large?.props.title).toBe(SPEECH_MODEL_BUSY)
    expect(words(markup())).toContain(SPEECH_MODEL_BUSY)
    // No fetch: no reason under the list, no X.
    three('small')
    expect(words(markup())).not.toContain(SPEECH_MODEL_BUSY)
    expect(section().filter((h) => h.type === 'button' && h.props.title === STOP_SPEECH_MODEL)).toEqual([])
  })

  it('a choice made while another model is fetched: the fetch stays that model’s, and lands on its own line only', async () => {
    three('small')
    let land: (s: SpeechModelStatus) => void = () => undefined
    let progress: (u: SpeechModelProgress) => void = () => undefined
    forge.onSpeechModelProgress.mockImplementationOnce((cb) => {
      progress = cb
      return () => undefined
    })
    forge.speechModel.mockImplementationOnce(() => new Promise<SpeechModelStatus>((resolve) => (land = resolve)))
    const pending = press(getOf('medium'), 'Medium’s press') as Promise<void>
    await (radioOf('large-v3')!.props.onChange as () => void)()
    await settle()
    // Another model's progress (none should come, but main names each) is not this fetch's.
    progress({ progress: 0.42, model: 'medium' })
    progress({ progress: 0.9, model: 'large-v3' })
    expect(state().speechFetch).toEqual({ progress: 0.42, model: 'medium' })
    expect(wordsOf('medium')).toContain('Getting the speech model… 42%')
    expect(wordsOf('large-v3')).toContain('· used by Transcribe')
    expect(getOf('large-v3')?.props.disabled).toBe(true)
    land(statusOf('medium', true))
    await pending
    expect(state().speechModels.medium?.present).toBe(true)
    expect(state().speechChoice).toBe('large-v3')
    expect(state().speechModel).toMatchObject({ model: 'large-v3', present: false })
    expect(downloads()).toEqual([{ download: true, model: 'medium' }])
  })

  it('one fetch at a time in the window too: a second press while one runs asks nothing and leaves the running fetch on its line', async () => {
    three('small')
    let land: (s: SpeechModelStatus) => void = () => undefined
    forge.speechModel.mockImplementationOnce(() => new Promise<SpeechModelStatus>((resolve) => (land = resolve)))
    const pending = state().getSpeechModel('medium')
    await state().getSpeechModel('large-v3')
    expect(downloads()).toEqual([{ download: true, model: 'medium' }])
    expect(forge.onSpeechModelProgress).toHaveBeenCalledTimes(1)
    expect(state().speechFetch?.model).toBe('medium')
    expect(wordsOf('medium')).toContain('Getting the speech model…')
    land(statusOf('medium', true))
    await pending
    expect(state().speechFetch).toBeNull()
    expect(state().notices).toEqual([])
  })

  it('a press that names no model fetches the CHOSEN one; with nothing known it fetches nothing', async () => {
    three('large-v3')
    forge.speechModel.mockImplementationOnce(async () => statusOf('large-v3', true))
    await state().getSpeechModel()
    expect(downloads()).toEqual([{ download: true, model: 'large-v3' }])
    show(readyPack())
    forge.speechModel.mockClear()
    await state().getSpeechModel()
    expect(forge.speechModel).not.toHaveBeenCalled()
  })

  it('a failed fetch leaves the choice, and says so', async () => {
    three('medium')
    forge.speechModel.mockImplementationOnce(async () => statusOf('medium', false))
    await press(getOf('medium'), 'Medium’s press')
    expect(state().notices.map((n) => n.text)).toEqual(['The speech model could not be downloaded'])
    expect(state().speechChoice).toBe('medium')
    expect(state().speechFetch).toBeNull()
    expect(getOf('medium')?.props.disabled).toBe(false)
    forge.speechModel.mockImplementationOnce(async () => {
      throw new Error("Error invoking remote method 'asr:model': SidecarError: huggingface.co could not be reached")
    })
    await press(getOf('medium'), 'Medium’s press')
    expect(state().notices.map((n) => n.text)).toContain('huggingface.co could not be reached')
    expect(state().speechChoice).toBe('medium')
    expect(state().speechModel).toMatchObject({ model: 'medium', present: false })
  })

  it('asks after all three and the choice for the row, never downloading; a choice made meanwhile is not set back', async () => {
    chosen = 'large-v3'
    show(readyPack())
    await state().refreshSpeechModels()
    const asked = forge.speechModel.mock.calls.map((c) => c[0])
    expect(asked).toHaveLength(4)
    for (const ask of [{}, { model: 'small' }, { model: 'medium' }, { model: 'large-v3' }]) expect(asked).toContainEqual(ask)
    expect(downloads()).toEqual([])
    expect(state().speechChoice).toBe('large-v3')
    expect(Object.keys(state().speechModels).sort()).toEqual(['large-v3', 'medium', 'small'])
    expect(state().speechModel?.model).toBe('large-v3')
    // A status ask of the old choice, answered after a new choice: the new choice stands.
    let answer: (s: SpeechModelStatus) => void = () => undefined
    forge.speechModel.mockImplementationOnce(() => new Promise<SpeechModelStatus>((resolve) => (answer = resolve)))
    const asking = state().refreshSpeechModel()
    await state().chooseSpeechModel('small')
    answer(statusOf('large-v3'))
    await asking
    expect(state().speechChoice).toBe('small')
    expect(state().speechModel?.model).toBe('small')
  })

  it('says, beside a running helper, what the model presses need from the network; not before there is one (§16.40 (d))', async () => {
    const { MODEL_PRESSES_NETWORK } = await import('@shared/sidecar/row')
    for (const host of ['huggingface.co', '*.hf.co', 'storage.googleapis.com', 'HTTPS_PROXY']) expect(MODEL_PRESSES_NETWORK).toContain(host)
    show(readyPack(), { speechModel: statusOf('small') })
    expect(words(markup())).toContain(MODEL_PRESSES_NETWORK)
    show({ state: 'ready', hello: hello([]), source: { kind: 'env', python: 'C:\\Python312\\python.exe' } })
    expect(words(markup())).toContain(MODEL_PRESSES_NETWORK)
    for (const status of [{ state: 'absent', offer: offer() } as SidecarStatus, null]) {
      show(status)
      expect(words(markup())).not.toContain(MODEL_PRESSES_NETWORK)
    }
  })

  it('is not offered while the helper cannot transcribe', () => {
    show(readyPack({ hello: hello(THIS_PACK.expects.filter((m) => m !== SIDECAR_METHODS.transcribe)) }), {
      speechModels: { small: statusOf('small'), medium: statusOf('medium'), 'large-v3': statusOf('large-v3') },
      speechChoice: 'small'
    })
    expect(words(markup())).not.toContain('Get the speech model')
    expect(markup()).not.toContain('data-speech-model')
  })
})
