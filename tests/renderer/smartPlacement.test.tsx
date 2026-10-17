import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset } from '@shared/timeline'
import { SUBJECT_TRACK_VERSION, type SubjectTrack } from '@shared/reframe/types'
import { SIDECAR_METHODS } from '@shared/sidecar/protocol'
import type { SidecarStatus } from '@shared/sidecar/status'

/*
 * The Smart placement toggle in OUTPUT's caption block (docs/CLIPS.md §5.4),
 * in each of its states, rendered and pressed.
 *
 * As tests/renderer/reframePanel.test.tsx does it: the store mocked to a plain
 * selector over the REAL store's state, so the toggle — a component with no
 * state of its own — can be called as a function and its presses reach the
 * real actions; and the open strip rendered to static markup for where it sits.
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
vi.mock('../../src/renderer/src/exportBakers', () => ({ liveBakers: {} }))
vi.mock('../../src/renderer/src/captionBake', () => ({ bakeCaptions: async () => null }))

const { useEditor } = await import('../../src/renderer/src/store')
const { OutputStrip, SmartPlacementToggle, SMART_PLACEMENT_TIP, SMART_PLACEMENT_NO_TRACK } = await import(
  '../../src/renderer/src/components/OutputStrip'
)

const state = () => useEditor.getState()

/* ------------------------------------------------------------ the walk */

interface Host {
  type: string
  props: Record<string, unknown>
}

/** Every host element a tree comes to, with its props (reframePanel.test.tsx's walk). */
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
  if (Array.isArray(node)) return node.map((n) => textOf(n as ReactNode)).join(' ')
  if (isValidElement(node)) {
    const type = node.type as unknown
    const props = node.props as Record<string, unknown> & { children?: ReactNode }
    if (typeof type === 'function') return textOf((type as (p: unknown) => ReactNode)(props))
    // Each element's words apart from the next element's, as a screen shows them.
    return ` ${textOf(props.children)} `
  }
  return ''
}

/** The toggle as it stands now: its switch, its pointer (if any) and every word it shows. */
function toggle(): { switch: Host; pointers: Host[]; words: string } {
  const tree = SmartPlacementToggle()
  const all = hosts(tree)
  const switches = all.filter((h) => h.type === 'button' && 'data-smart-placement' in h.props)
  expect(switches).toHaveLength(1)
  return {
    switch: switches[0],
    pointers: all.filter((h) => h.type === 'button' && 'data-helper-pointer' in h.props),
    words: textOf(tree).replace(/\s+/g, ' ').trim()
  }
}

/* ------------------------------------------------------------ the scene */

const W = 1080
const H = 1920

const TALK: MediaAsset = {
  id: 'talk', path: '/media/talk.mp4', name: 'talk.mp4', kind: 'video', durationFrames: 180,
  width: W, height: H, fps: 30, hasVideo: true, hasAudio: true, size: 1
}

const TRACK: SubjectTrack = {
  key: '123456:1700000000000', version: SUBJECT_TRACK_VERSION, width: W, height: H, durationMs: 6000,
  shots: [{ startMs: 0, endMs: 6000, score: 0 }],
  samples: [{ ms: 0, faces: [{ x: 0.4, y: 0.7, width: 0.2, height: 0.12, score: 0.9 }] }],
  perShot: [{}], detector: 'synthetic',
  scene: { threshold: 0.3, minShotMs: 500, backend: 'ffmpeg-select-rgb24' }, at: '2026-10-16T00:00:00.000Z'
}

const READY = {
  state: 'ready', source: 'pack',
  hello: { protocol: 1, version: 'test', python: '3.12', capabilities: [SIDECAR_METHODS.faces, SIDECAR_METHODS.facesModel] }
} as unknown as SidecarStatus
const FAILED = { state: 'failed', source: 'pack', error: 'not running' } as unknown as SidecarStatus

/** A project with the talk on the bottom video track, its subject track or not, and the AI helper as given. */
function scene(options: { track: boolean; helper: SidecarStatus | null; placement?: 'smart' }): void {
  const base = emptyProject()
  const trackId = base.tracks.find((t) => t.kind === 'video')!.id
  const clip: Clip = {
    id: 'c-talk', assetId: TALK.id, trackId, start: 0, duration: 180, inPoint: 0, volume: 1,
    transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR }
  }
  useEditor.setState({
    ...useEditor.getInitialState(),
    helperStatus: options.helper,
    project: {
      ...base,
      assets: [TALK],
      clips: [clip],
      ...(options.track ? { subjects: { [TALK.id]: TRACK } } : {}),
      captions: { ...base.captions, ...(options.placement ? { placement: options.placement } : {}) }
    }
  })
}

beforeEach(() => {
  useEditor.setState(useEditor.getInitialState())
})

/* ---------------------------------------------------------------- tests */

describe('Smart placement in OUTPUT', () => {
  it('sits in the open caption block, after Place, and says what it does', () => {
    scene({ track: true, helper: READY })
    useEditor.setState({ outputOpen: true })
    const html = renderToStaticMarkup(createElement(OutputStrip))
    const place = html.indexOf('>Place<')
    const smart = [...html.matchAll(/>Smart placement</g)]
    expect(place).toBeGreaterThan(-1)
    expect(smart).toHaveLength(1)
    expect(smart[0].index!).toBeGreaterThan(place)
    expect(html).toContain(`title="${SMART_PLACEMENT_TIP}"`)
    expect(html).toContain('role="switch"')
  })

  it('with a subject track: enabled whatever the helper, its tooltip the plain one, and it flips placement both ways', () => {
    for (const helper of [READY, FAILED, null]) {
      scene({ track: true, helper })
      const t = toggle()
      expect(t.switch.props.disabled).toBe(false)
      expect(t.switch.props.title).toBe(SMART_PLACEMENT_TIP)
      expect(t.switch.props['aria-checked']).toBe(false)
      expect(t.pointers).toHaveLength(0)
      expect(t.words).toBe('Smart placement')
    }
    ;(toggle().switch.props.onClick as () => void)()
    expect(state().project.captions.placement).toBe('smart')
    expect(toggle().switch.props['aria-checked']).toBe(true)
    ;(toggle().switch.props.onClick as () => void)()
    // Off is no field at all: the project reads as one saved before the toggle existed.
    expect('placement' in state().project.captions).toBe(false)
  })

  it('with the helper but no track yet: enabled, and its tooltip says "reframe a clip first"', () => {
    scene({ track: false, helper: READY })
    const t = toggle()
    expect(t.switch.props.disabled).toBe(false)
    expect(t.switch.props.title).toBe(`${SMART_PLACEMENT_TIP} — ${SMART_PLACEMENT_NO_TRACK}`)
    expect(SMART_PLACEMENT_NO_TRACK).toBe('reframe a clip first')
    expect(t.pointers).toHaveLength(0)
    ;(t.switch.props.onClick as () => void)()
    expect(state().project.captions.placement).toBe('smart')
  })

  it('with neither: greyed, with "needs the AI helper" as a pointer that opens Settings at the AI helper row', () => {
    scene({ track: false, helper: FAILED })
    const t = toggle()
    expect(t.switch.props.disabled).toBe(true)
    expect(t.words).toBe('Smart placement needs the AI helper')
    expect(t.pointers).toHaveLength(1)
    expect(textOf(t.pointers[0].props.children as ReactNode).trim()).toBe('needs the AI helper')
    expect(t.pointers[0].props.title).toBe('install it in Settings')
    expect(state().settingsOpen).toBe(false)
    ;(t.pointers[0].props.onClick as () => void)()
    expect(state().settingsOpen).toBe(true)
    expect(state().settingsFocus).toBe('helper')
    // The pointer is not a second switch: placement is untouched.
    expect('placement' in state().project.captions).toBe(false)
  })

  it('while the helper has not answered: greyed and said as starting, no pointer', () => {
    scene({ track: false, helper: null })
    const t = toggle()
    expect(t.switch.props.disabled).toBe(true)
    expect(t.words).toBe('Smart placement the AI helper is starting')
    expect(t.pointers).toHaveLength(0)
  })

  it('greyed but on (saved that way), it can still be turned off', () => {
    scene({ track: false, helper: FAILED, placement: 'smart' })
    const t = toggle()
    expect(t.switch.props['aria-checked']).toBe(true)
    expect(t.switch.props.disabled).toBe(false)
    expect(t.pointers).toHaveLength(1)
    ;(t.switch.props.onClick as () => void)()
    expect('placement' in state().project.captions).toBe(false)
    expect(toggle().switch.props.disabled).toBe(true)
  })
})
