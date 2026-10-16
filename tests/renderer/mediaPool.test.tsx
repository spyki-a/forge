import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { emptyProject, type MediaAsset } from '@shared/timeline'
import { NEEDS_SPEECH_MODEL, SPEECH_MODEL_NOT_DOWNLOADED, STOP_SPEECH_MODEL, speechModelLabel } from '@shared/asr/speechModel'
import { SIDECAR_METHODS, type HelloResult, type ModelStatus } from '@shared/sidecar/protocol'
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
const SPEECH: ModelStatus = { present: false, bytes: 486_539_264, label: 'the speech model', host: 'huggingface.co' }

const forge = {
  speechModel: vi.fn(async (_request: { download?: boolean }) => ({ ...SPEECH, present: true })),
  cancelSpeechModel: vi.fn(async () => undefined),
  onSpeechModelProgress: vi.fn((_cb: unknown) => () => undefined)
}

function show(status: SidecarStatus | null, speechModel: ModelStatus | null = null): void {
  useEditor.setState({ ...useEditor.getInitialState(), project: { ...emptyProject(), assets: [TALK] }, helperStatus: status, speechModel })
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
    let land: (m: ModelStatus) => void = () => undefined
    forge.speechModel.mockImplementationOnce(() => new Promise<ModelStatus>((resolve) => (land = resolve)))
    const press = hostsOf(SpeechModelPress()).find((h) => h.type === 'button')
    const pending = (press!.props.onClick as () => Promise<void>)()
    expect(forge.speechModel.mock.calls.map((c) => c[0])).toEqual([{ download: true }])
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
    forge.speechModel.mockImplementationOnce(() => new Promise<ModelStatus>((_resolve, reject) => (fail = reject)))
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
