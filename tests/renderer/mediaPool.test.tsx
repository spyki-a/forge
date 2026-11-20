import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { emptyProject, type MediaAsset } from '@shared/timeline'
import { NEEDS_SPEECH_MODEL, SPEECH_MODEL_BUSY, SPEECH_MODEL_NOT_DOWNLOADED, STOP_SPEECH_MODEL, speechModelLabel, speechModelPin, type SpeechModelName, type SpeechModelStatus } from '@shared/asr/speechModel'
import { SIDECAR_METHODS, type HelloResult } from '@shared/sidecar/protocol'
import type { SidecarStatus } from '@shared/sidecar/status'

/*
 * The Media pool's Transcribe, greyed by its OWN method (docs/CLIPS.md §3a.4,
 * §3a.7): enabled only when the AI helper registered `asr.transcribe` AND the
 * speech model is on disk (§16.49 (a): a press must never fetch 464 MB
 * unnamed). Without the method its title says where the Install is; with the
 * method and no model, "needs the speech model", and the sized press stands
 * over the pool.
 *
 * Rendered to static markup over the REAL store's state (the store mocked to
 * a plain selector, as tests/renderer/ingestPanel.test.tsx does), and the
 * press, which has no hook but the store's, called as a function.
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
const { MediaPool, SpeechModelPress, TRANSCRIBE_NEEDS_HELPER } = await import('../../src/renderer/src/components/MediaPool')

const state = () => useEditor.getState()

const TALK: MediaAsset = {
  id: 'talk',
  path: '/media/talk.mp4',
  name: 'talk.mp4',
  kind: 'video',
  durationFrames: 300,
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  size: 1024
}

const hello = (capabilities: string[]): HelloResult => ({
  protocolVersion: 1,
  python: '3.12.10',
  platform: 'Windows-AMD64',
  capabilities,
  degraded: {},
  executable: 'C:\\Python312\\python.exe',
  prefix: 'C:\\Python312',
  path: []
})
const env = { kind: 'env', python: 'C:\\Python312\\python.exe' } as const
const ready = (capabilities: string[]): SidecarStatus => ({ state: 'ready', hello: hello(capabilities), source: env })
const SPEECH: SpeechModelStatus = { present: false, bytes: 486_539_264, label: 'the speech model', host: 'huggingface.co', model: 'small' }
const statusOf = (model: SpeechModelName, present: boolean): SpeechModelStatus => ({ ...SPEECH, present, bytes: speechModelPin(model).bytes, model })

const forge = {
  speechModel: vi.fn(async (_request: { download?: boolean }) => ({ ...SPEECH, present: true })),
  cancelSpeechModel: vi.fn(async () => undefined),
  onSpeechModelProgress: vi.fn((_cb: unknown) => () => undefined)
}

function show(status: SidecarStatus | null, speechModel: SpeechModelStatus | null = null): void {
  useEditor.setState({ ...useEditor.getInitialState(), project: { ...emptyProject(), assets: [TALK] }, helperStatus: status, speechModel, speechChoice: speechModel?.model ?? null })
}

/** The tile's Transcribe button: the one whose title is about transcribing. */
function transcribe(html: string): string {
  const all = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0])
  const found = all.filter((b) => /title="(?:Transcribe|Transcribed|needs the|the AI helper is starting)/.test(b))
  expect(found, 'one Transcribe button on the tile').toHaveLength(1)
  return found[0]
}

const render = (): string => renderToStaticMarkup(createElement(MediaPool))

beforeEach(() => {
  forge.speechModel.mockClear()
  vi.stubGlobal('window', { forge })
})
// A window stubbed by one case must not leak into the next.
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Transcribe in the Media pool', () => {
  it('is greyed for a ready helper without asr.transcribe, its title pointing at Settings', () => {
    show(ready([SIDECAR_METHODS.beats, SIDECAR_METHODS.faces]), { ...SPEECH, present: true })
    const button = transcribe(render())
    expect(button).toContain('disabled=""')
    expect(button).toContain(`title="${TRANSCRIBE_NEEDS_HELPER}"`)
  })

  it('is greyed for a bare interpreter, which is up and can do nothing', () => {
    show(ready([]), { ...SPEECH, present: true })
    expect(transcribe(render())).toContain('disabled=""')
  })

  it('is greyed "needs the speech model" with the method and no model, and the sized press stands over the pool', () => {
    show(ready([SIDECAR_METHODS.transcribe]), { ...SPEECH })
    const html = render()
    const button = transcribe(html)
    expect(button).toContain('disabled=""')
    expect(button).toContain(`title="${NEEDS_SPEECH_MODEL}"`)
    expect(html).toContain(`>${speechModelLabel(SPEECH)}</button>`)
  })

  it('is pressable once the helper can transcribe and the model is on disk, with no press over the pool', () => {
    show(ready([SIDECAR_METHODS.transcribe]), { ...SPEECH, present: true })
    const html = render()
    const button = transcribe(html)
    expect(button).not.toContain('disabled=""')
    expect(button).toContain('title="Transcribe"')
    expect(html).not.toContain('Get the speech model')
  })

  it('says the helper is starting before it has answered, and offers nothing to fetch', () => {
    show(null)
    const html = render()
    expect(transcribe(html)).toContain('title="the AI helper is starting"')
    expect(html).not.toContain('Get the speech model')
  })
})

describe('the speech model’s press', () => {
  const hostsOf = (node: ReactNode): { type: string; props: Record<string, unknown> }[] => {
    if (!isValidElement(node)) return []
    const props = node.props as Record<string, unknown> & { children?: ReactNode }
    const own = typeof node.type === 'string' ? [{ type: node.type, props }] : []
    const kids = Array.isArray(props.children) ? props.children : [props.children]
    return [...own, ...kids.flatMap((k) => hostsOf(k as ReactNode))]
  }

  it('fetches with download: true, the progress on the button while it runs', async () => {
    show(ready([SIDECAR_METHODS.transcribe]), { ...SPEECH })
    let progress: (u: { progress: number | null }) => void = () => undefined
    forge.onSpeechModelProgress.mockImplementationOnce((cb: unknown) => {
      progress = cb as typeof progress
      return () => undefined
    })
    let land: (m: SpeechModelStatus) => void = () => undefined
    forge.speechModel.mockImplementationOnce(() => new Promise<SpeechModelStatus>((resolve) => (land = resolve)))
    const press = hostsOf(SpeechModelPress()).find((h) => h.type === 'button')
    const pending = (press!.props.onClick as () => Promise<void>)()
    expect(forge.speechModel.mock.calls.map((c) => c[0])).toEqual([{ download: true, model: 'small' }])
    progress({ progress: 0.42 })
    expect(renderToStaticMarkup(createElement(SpeechModelPress))).toContain('Getting the speech model… 42%')
    land({ ...SPEECH, present: true })
    await pending
    expect(state().speechModel?.present).toBe(true)
    expect(state().speechFetch).toBeNull()
    expect(renderToStaticMarkup(createElement(SpeechModelPress))).toBe('')
  })

  it('has an X while it fetches: pressed, main cancels, and the press ends with no notice and the model still not on disk', async () => {
    show(ready([SIDECAR_METHODS.transcribe]), { ...SPEECH })
    forge.cancelSpeechModel.mockClear()
    const xs = (): { type: string; props: Record<string, unknown> }[] => hostsOf(SpeechModelPress()).filter((h) => h.type === 'button' && h.props.title === STOP_SPEECH_MODEL)
    expect(xs(), 'no X before the press').toEqual([])
    let fail: (err: Error) => void = () => undefined
    forge.speechModel.mockImplementationOnce(() => new Promise<SpeechModelStatus>((_resolve, reject) => (fail = reject)))
    const pending = state().getSpeechModel()
    expect(xs()).toHaveLength(1)
    ;(xs()[0].props.onClick as () => void)()
    expect(forge.cancelSpeechModel).toHaveBeenCalledTimes(1)
    fail(new Error("Error invoking remote method 'asr:model': SidecarError: Cancelled"))
    await pending
    expect(state().speechFetch).toBeNull()
    expect(state().notices).toEqual([])
    expect(state().speechModel?.present).toBe(false)
    expect(xs(), 'no X once it has ended').toEqual([])
    // Any other failure is still told.
    forge.speechModel.mockImplementationOnce(async () => {
      throw new Error("Error invoking remote method 'asr:model': Error: The AI helper stopped (code 1)")
    })
    await state().getSpeechModel()
    expect(state().notices.map((n) => n.text)).toEqual(['The AI helper stopped (code 1)'])
  })

  it('is asked about again when a Transcribe finds the model gone, so the press comes back', async () => {
    show(ready([SIDECAR_METHODS.transcribe]), { ...SPEECH, present: true })
    vi.stubGlobal('window', {
      forge: {
        ...forge,
        transcribe: async () => {
          // The helper's own Unavailable, as main passes it through and Electron wraps it.
          throw new Error(`Error invoking remote method 'asr:transcribe': SidecarError: ${SPEECH_MODEL_NOT_DOWNLOADED}`)
        }
      }
    })
    await state().transcribeAsset(TALK.id)
    expect(state().speechModel).toBeNull()
    // A failure of another kind leaves what is known alone.
    useEditor.setState({ speechModel: { ...SPEECH, present: true } })
    vi.stubGlobal('window', { forge: { ...forge, transcribe: async () => { throw new Error('The AI helper stopped (code 1)') } } })
    await state().transcribeAsset(TALK.id)
    expect(state().speechModel?.present).toBe(true)
  })

  it('is not offered before main has said how big the model is', () => {
    show(ready([SIDECAR_METHODS.transcribe]), null)
    expect(renderToStaticMarkup(createElement(SpeechModelPress))).toBe('')
  })
})

describe('Transcribe on the CHOSEN speech model (since 2026-11-20, a choice of three)', () => {
  /** Main as the store sees it: the settings file's choice, and each model on disk as `onDisk` says. */
  function mainWith(onDisk: Partial<Record<SpeechModelName, boolean>>, transcribe?: (request: unknown) => Promise<unknown>): { chosen: () => SpeechModelName } {
    let chosen: SpeechModelName = 'small'
    vi.stubGlobal('window', {
      forge: {
        ...forge,
        setSetting: async (_key: string, value: unknown) => {
          chosen = value as SpeechModelName
          return {}
        },
        speechModel: vi.fn(async (request: { download?: boolean; model?: SpeechModelName }) => statusOf(request.model ?? chosen, onDisk[request.model ?? chosen] === true)),
        transcribe: transcribe ?? (async () => ({ segments: [] }))
      }
    })
    return { chosen: () => chosen }
  }
  const speechCalls = (): unknown[] => (window.forge.speechModel as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c[0])

  it('with Medium chosen and not here, Transcribe is greyed though Small is here, and the press over the pool is Medium’s', async () => {
    show(ready([SIDECAR_METHODS.transcribe]), statusOf('small', true))
    // Small known as Settings knows it, after asking all three.
    useEditor.setState({ speechModels: { small: statusOf('small', true) } })
    mainWith({ small: true })
    expect(transcribe(render())).not.toContain('disabled=""')
    await state().chooseSpeechModel('medium')
    const html = render()
    expect(transcribe(html)).toContain('disabled=""')
    expect(transcribe(html)).toContain(`title="${NEEDS_SPEECH_MODEL}"`)
    expect(html).toContain(`>${speechModelLabel({ bytes: 1_530_571_735 })}</button>`)
    expect(html).not.toContain(speechModelLabel({ bytes: 486_212_372 }))
    // Its press fetches Medium.
    const press = SpeechModelPress() as ReactNode
    const button = (function find(node: ReactNode): { props: Record<string, unknown> } | undefined {
      if (!isValidElement(node)) return undefined
      const props = node.props as Record<string, unknown> & { children?: ReactNode }
      if (node.type === 'button') return { props }
      const kids = Array.isArray(props.children) ? props.children : [props.children]
      for (const k of kids) {
        const hit = find(k as ReactNode)
        if (hit) return hit
      }
      return undefined
    })(press)
    await (button!.props.onClick as () => Promise<void>)()
    expect(speechCalls().filter((r) => (r as { download?: boolean }).download)).toEqual([{ download: true, model: 'medium' }])
    // Large chosen: its 2.9 GB.
    await state().chooseSpeechModel('large-v3')
    expect(render()).toContain(`>${speechModelLabel({ bytes: 3_090_835_702 })}</button>`)
  })

  it('choosing a model that is here makes Transcribe pressable at once, and choosing downloads nothing', async () => {
    show(ready([SIDECAR_METHODS.transcribe]), statusOf('small', false))
    mainWith({ medium: true })
    await state().chooseSpeechModel('medium')
    expect(transcribe(render())).not.toContain('disabled=""')
    expect(speechCalls()).toEqual([{ model: 'medium' }])
  })

  it('transcribing a clip again (the tile’s "Transcribed — click to redo") is gated on the chosen model and sends no model: main sends the chosen one', async () => {
    const asked: unknown[] = []
    show(ready([SIDECAR_METHODS.transcribe]), statusOf('small', true))
    useEditor.setState({ project: { ...state().project, transcripts: { [TALK.id]: { language: 'en', model: 'faster-whisper-small', segments: [] } as never } } })
    mainWith({ small: true, 'large-v3': true }, async (request) => {
      asked.push(request)
      return { language: 'en', model: 'faster-whisper-large-v3', segments: [] }
    })
    await state().chooseSpeechModel('medium')
    const redo = (): string => {
      const all = [...render().matchAll(/<button[^>]*>/g)].map((m) => m[0]).filter((b) => /title="(?:Transcribed — click to redo|needs the speech model)"/.test(b))
      expect(all).toHaveLength(1)
      return all[0]
    }
    expect(redo()).toContain(`title="${NEEDS_SPEECH_MODEL}"`)
    expect(redo()).toContain('disabled=""')
    await state().chooseSpeechModel('large-v3')
    expect(redo()).toContain('title="Transcribed — click to redo"')
    expect(redo()).not.toContain('disabled=""')
    await state().transcribeAsset(TALK.id)
    expect(asked).toHaveLength(1)
    expect(Object.keys(asked[0] as object)).not.toContain('model')
  })

  it('while another model is fetched from Settings, the pool’s press for the chosen one waits, saying why, with no X', () => {
    show(ready([SIDECAR_METHODS.transcribe]), statusOf('medium', false))
    useEditor.setState({ speechFetch: { progress: 0.42, model: 'large-v3' } })
    const html = renderToStaticMarkup(createElement(SpeechModelPress))
    expect(html).toContain(`>${speechModelLabel({ bytes: 1_530_571_735 })}</button>`)
    expect(html).toContain(`title="${SPEECH_MODEL_BUSY}"`)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Get the speech model/)
    expect(html).not.toContain(STOP_SPEECH_MODEL)
    expect(html).not.toContain('Getting the speech model')
    // The chosen one here: nothing over the pool, whatever is fetched in Settings.
    show(ready([SIDECAR_METHODS.transcribe]), statusOf('small', true))
    useEditor.setState({ speechFetch: { progress: 0.42, model: 'large-v3' } })
    expect(renderToStaticMarkup(createElement(SpeechModelPress))).toBe('')
    // The fetch IS the chosen one's: its progress and X, as before.
    show(ready([SIDECAR_METHODS.transcribe]), statusOf('large-v3', false))
    useEditor.setState({ speechFetch: { progress: 0.42, model: 'large-v3' } })
    const mine = renderToStaticMarkup(createElement(SpeechModelPress))
    expect(mine).toContain('Getting the speech model… 42%')
    expect(mine).toContain(STOP_SPEECH_MODEL)
  })

  it('a chosen model whose status is not known yet never takes another model’s fetch as its own', () => {
    // Medium just chosen, its ask not answered (or failed): Large fetched from Settings is not the pool's.
    show(ready([SIDECAR_METHODS.transcribe]), null)
    useEditor.setState({ speechChoice: 'medium', speechFetch: { progress: 0.42, model: 'large-v3' } })
    const other = renderToStaticMarkup(createElement(SpeechModelPress))
    expect(other).not.toContain('Getting the speech model')
    expect(other).not.toContain(STOP_SPEECH_MODEL)
    // Medium's own fetch, its status not yet known: its progress and X.
    useEditor.setState({ speechFetch: { progress: 0.42, model: 'medium' } })
    const own = renderToStaticMarkup(createElement(SpeechModelPress))
    expect(own).toContain('Getting the speech model… 42%')
    expect(own).toContain(STOP_SPEECH_MODEL)
  })

  it('a Transcribe that finds the chosen model gone forgets that model’s status only', async () => {
    show(ready([SIDECAR_METHODS.transcribe]), statusOf('medium', true))
    useEditor.setState({ speechModels: { small: statusOf('small', true), medium: statusOf('medium', true) } })
    mainWith({}, async () => {
      throw new Error(`Error invoking remote method 'asr:transcribe': SidecarError: ${SPEECH_MODEL_NOT_DOWNLOADED}`)
    })
    await state().transcribeAsset(TALK.id)
    expect(state().speechModel).toBeNull()
    expect(state().speechModels.medium).toBeUndefined()
    expect(state().speechModels.small?.present).toBe(true)
    expect(state().speechChoice).toBe('medium')
  })
})
