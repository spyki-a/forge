import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { speechModelLabel, speechModelPin, type SpeechModelName, type SpeechModelStatus } from '@shared/asr/speechModel'
import { SIDECAR_METHODS, type HelloResult } from '@shared/sidecar/protocol'
import { SELFTEST_GROUP_NAMES } from '@shared/sidecar/selftest'
import type { SidecarStatus } from '@shared/sidecar/status'

/*
 * The Settings card's OWN ask for the speech models (the speech model choice,
 * piece 2's fixes): opened with the AI helper able to transcribe and any of the
 * three models (or the choice) not known, the card asks after all of them,
 * never with `download`. In the real app nothing else fills Medium's and
 * Large's lines (the Media pool asks only the chosen one), so without this ask
 * those lines have no sized press and the owner has nothing to press.
 *
 * Static markup runs no effects, so `useEffect` is replaced here by one that
 * records each effect; the test runs them as React would after the first
 * render, lets the asks land, and renders again. The store is the real one
 * behind a plain selector (as tests/renderer/settingsPanel.test.tsx does it),
 * so the asks are the real actions and what is checked is what reaches the
 * bridge.
 */

const effects = vi.hoisted(() => ({ list: [] as Array<() => unknown> }))
vi.mock('react', async (importOriginal) => {
  const real = await importOriginal<typeof import('react')>()
  const useEffect = (fn: () => unknown): void => {
    effects.list.push(fn)
  }
  return { ...real, default: { ...real, useEffect }, useEffect }
})

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
const { SettingsPanel, THIS_PACK } = await import('../../src/renderer/src/components/SettingsPanel')

const hello = (capabilities: readonly string[]): HelloResult => ({
  protocolVersion: 1,
  python: '3.14.8',
  platform: 'Darwin-arm64',
  capabilities: [...capabilities],
  degraded: {},
  executable: '/Users/a/Library/Application Support/Forge/python/1/python/bin/python3.14',
  prefix: '/Users/a/Library/Application Support/Forge/python/1/python',
  path: []
})
const ready = (capabilities: readonly string[] = THIS_PACK.expects): SidecarStatus => ({
  state: 'ready',
  hello: hello(capabilities),
  source: { kind: 'pack', pack: 1, root: '/Users/a/Library/Application Support/Forge/python/1' },
  selftest: Object.fromEntries(SELFTEST_GROUP_NAMES.map((g) => [g, 'ok']))
})

const disk: Record<SpeechModelName, boolean> = { small: true, medium: false, 'large-v3': false }
const statusOf = (model: SpeechModelName): SpeechModelStatus => ({
  present: disk[model],
  bytes: speechModelPin(model).bytes,
  label: 'the speech model',
  host: 'huggingface.co',
  model
})
const forge = {
  directorStatus: vi.fn(async () => []),
  directorSettings: vi.fn(async () => ({ provider: 'auto', ollama: { baseUrl: 'http://127.0.0.1:11434', model: '' }, openai: { baseUrl: 'http://127.0.0.1:1234/v1', model: '', hasKey: false } })),
  speechModel: vi.fn(async (request: { download?: boolean; model?: SpeechModelName }) => statusOf(request.model ?? 'small'))
}

/** Render the card, run the effects its render registered (as React does after a commit), and let their asks land. */
async function openSettings(): Promise<string> {
  effects.list = []
  renderToStaticMarkup(createElement(SettingsPanel))
  for (const effect of effects.list) effect()
  await new Promise((resolve) => setTimeout(resolve, 0))
  return renderToStaticMarkup(createElement(SettingsPanel))
}
const asks = (): unknown[] => forge.speechModel.mock.calls.map((c) => c[0])

beforeEach(() => {
  for (const spy of Object.values(forge)) spy.mockClear()
  vi.stubGlobal('window', { forge, addEventListener: () => undefined, removeEventListener: () => undefined })
  useEditor.setState({ ...useEditor.getInitialState(), settingsOpen: true })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Settings asks after the speech models itself when it opens', () => {
  it('nothing asked yet: all three and the choice are asked, none downloads, and Medium’s and Large’s sized presses are drawn', async () => {
    useEditor.setState({ helperStatus: ready() })
    const html = await openSettings()
    const asked = asks()
    for (const ask of [{}, { model: 'small' }, { model: 'medium' }, { model: 'large-v3' }]) expect(asked).toContainEqual(ask)
    expect(asked.filter((a) => (a as { download?: boolean }).download === true)).toEqual([])
    expect(useEditor.getState().speechChoice).toBe('small')
    for (const model of ['medium', 'large-v3'] as const) {
      expect(html).toContain(`data-speech-get="${model}"`)
      expect(html).toContain(speechModelLabel({ bytes: speechModelPin(model).bytes }))
    }
    expect(html).not.toContain('data-speech-get="small"')
  })

  it('every model known but the choice not: it asks again (the choice is part of what it must know)', async () => {
    useEditor.setState({
      helperStatus: ready(),
      speechModels: { small: statusOf('small'), medium: statusOf('medium'), 'large-v3': statusOf('large-v3') },
      speechChoice: null
    })
    await openSettings()
    expect(asks()).toContainEqual({})
    expect(useEditor.getState().speechChoice).toBe('small')
  })

  it('one model gone (a Transcribe found it missing): it asks again', async () => {
    useEditor.setState({
      helperStatus: ready(),
      speechModels: { small: statusOf('small'), medium: statusOf('medium') },
      speechChoice: 'small',
      speechModel: statusOf('small')
    })
    await openSettings()
    expect(asks()).toContainEqual({ model: 'large-v3' })
  })

  it('all three and the choice known: it asks nothing; a helper that cannot transcribe: it asks nothing', async () => {
    useEditor.setState({
      helperStatus: ready(),
      speechModels: { small: statusOf('small'), medium: statusOf('medium'), 'large-v3': statusOf('large-v3') },
      speechChoice: 'small',
      speechModel: statusOf('small')
    })
    await openSettings()
    expect(asks()).toEqual([])
    useEditor.setState({ ...useEditor.getInitialState(), settingsOpen: true, helperStatus: ready(THIS_PACK.expects.filter((m) => m !== SIDECAR_METHODS.transcribe)) })
    await openSettings()
    expect(asks()).toEqual([])
  })
})
