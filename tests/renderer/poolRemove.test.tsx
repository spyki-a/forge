import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { emptyProject, type Project } from '@shared/timeline'
import { SPEECH_MODEL_LABEL, type SpeechModelStatus } from '@shared/asr/speechModel'
import { SIDECAR_METHODS, type HelloResult } from '@shared/sidecar/protocol'
import type { SidecarStatus } from '@shared/sidecar/status'
import { dockSubject } from '../../src/renderer/src/dock'
import { poolProject } from './poolFixture'

/*
 * Remove from project and the right-click menu on a pool tile (MediaPool.tsx
 * PoolMenu, the store's removeAsset / confirmRemoveAsset / keepAsset).
 *
 * The store is the real one, mocked to a plain selector as
 * tests/renderer/mediaPool.test.tsx does, so a component can be called as a
 * function and its items' handlers pressed; the menu's window listeners
 * (`useMenuDismiss`) are the only thing left out of that call, since they
 * need a window that can listen (the harness counts them, and
 * tests/fullScreen.test.ts holds their Escape).
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
vi.mock('../../src/renderer/src/components/ui/Menu', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/src/components/ui/Menu')>()
  return { ...real, useMenuDismiss: () => undefined }
})

const { useEditor } = await import('../../src/renderer/src/store')
const { MediaPool, PoolMenu, REMOVE_FROM_PROJECT, TRANSCRIBE_NEEDS_HELPER, revealLabel, transcribeWhy } = await import(
  '../../src/renderer/src/components/MediaPool'
)
const { MenuItem, menuPosition } = await import('../../src/renderer/src/components/ui/Menu')
const { transcribeGate } = await import('@shared/sidecar/row')

const state = () => useEditor.getState()

/** Every bridge call, by name: a Proxy, so a call to ANY method is recorded, whatever it is called. */
let calls: { name: string; args: unknown[] }[] = []
const bridge = new Proxy({} as Record<string, unknown>, {
  get: (_target, name: string) => (...args: unknown[]) => {
    calls.push({ name, args })
    return Promise.resolve(undefined)
  }
})

function open(project: Project = poolProject()): Project {
  useEditor.setState({ ...useEditor.getInitialState(), project, past: [], future: [] })
  return project
}

beforeEach(() => {
  calls = []
  vi.stubGlobal('window', { forge: bridge, innerWidth: 1280, innerHeight: 800 })
  vi.stubGlobal('navigator', { platform: 'MacIntel' })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ the store */

describe('Remove from project, in the store', () => {
  it('takes a file no clip plays at once, with no question; undo brings the project back exactly, redo takes it again', () => {
    const before = open()
    // A copy taken now: an undo that hands back an object the removal changed in place would equal itself.
    const copy = structuredClone(before)
    state().removeAsset('unused')
    expect(state().removingAsset).toBeNull()
    expect(state().project.assets.map((a) => a.id)).not.toContain('unused')
    expect(state().past).toHaveLength(1)
    const after = state().project
    state().undo()
    expect(state().project).toEqual(copy)
    state().redo()
    expect(state().project).toEqual(after)
    expect(state().project.assets.map((a) => a.id)).not.toContain('unused')
  })

  it('asks before taking a file clips play; "Keep it" changes nothing, not even the history', () => {
    const before = open()
    state().removeAsset('talk')
    expect(state().removingAsset).toBe('talk')
    expect(state().project).toBe(before)
    state().keepAsset()
    expect(state().removingAsset).toBeNull()
    expect(state().project).toBe(before)
    expect(state().past).toHaveLength(0)
  })

  it('"Remove it and its clips" takes the file, its clips, their followers and its records in ONE undo step, and undo brings each back', () => {
    const before = open()
    // A copy taken now: an undo that hands back an object the removal changed in place would equal itself.
    const copy = structuredClone(before)
    state().removeAsset('drawn')
    state().confirmRemoveAsset()
    expect(state().removingAsset).toBeNull()
    expect(state().past).toHaveLength(1)
    const gone = state().project
    for (const id of ['graphic-1', 'sound-1']) expect(gone.clips.map((c) => c.id)).not.toContain(id)
    expect(gone.assets.map((a) => a.id)).not.toContain('whoosh')
    state().undo()
    expect(state().project).toEqual(copy)

    state().removeAsset('talk')
    state().confirmRemoveAsset()
    expect(state().past).toHaveLength(1)
    const p = state().project
    expect(p.clips.map((c) => c.id).filter((id) => id.startsWith('talk-'))).toEqual([])
    for (const table of [p.transcripts, p.parallax!, p.vision!, p.subjects!]) expect(Object.keys(table)).not.toContain('talk')
    expect(p.graphicProposals!.map((g) => g.id)).toEqual(['on-keep'])
    // Another file's records are untouched.
    expect(p.transcripts.keep).toBe(before.transcripts.keep)
    expect(p.vision!.keep).toBe(before.vision!.keep)
    expect(p.subjects!.keep).toBe(before.subjects!.keep)
    state().undo()
    expect(state().project).toEqual(copy)
    for (const id of ['talk-1', 'talk-2', 'talk-3']) expect(state().project.clips.map((c) => c.id)).toContain(id)
    expect(state().project.transcripts.talk).toEqual(before.transcripts.talk)
    expect(state().project.graphicProposals!.map((g) => g.id)).toContain('on-talk-clip')
    state().redo()
    expect(state().project).toEqual(p)
  })

  it('lets go of every selected clip that went, and the Trimmer dock with it; a clip of another file stays selected', () => {
    open()
    useEditor.setState({ selectedClipId: 'talk-2', selectedClipIds: ['talk-2', 'keep-1'] })
    state().removeAsset('talk')
    state().confirmRemoveAsset()
    expect(state().selectedClipId).toBeNull()
    expect(state().selectedClipIds).toEqual(['keep-1'])
    expect(dockSubject(state().project, state().selectedClipId, state().audition)).toBeNull()
  })

  it('touches nothing on disk: no bridge call at all for a file nobody is working on', () => {
    open()
    state().removeAsset('unused')
    state().removeAsset('talk')
    state().confirmRemoveAsset()
    expect(calls).toEqual([])
  })

  it('cancels a transcription of the file in flight, and a result that lands after it writes nothing', async () => {
    open()
    let land: (t: unknown) => void = () => undefined
    vi.stubGlobal('window', {
      forge: new Proxy({} as Record<string, unknown>, {
        get: (_t, name: string) => (...args: unknown[]) => {
          calls.push({ name, args })
          return name === 'transcribe' ? new Promise((resolve) => (land = resolve)) : Promise.resolve(undefined)
        }
      }),
      innerWidth: 1280,
      innerHeight: 800
    })
    const running = state().transcribeAsset('keep')
    expect(state().transcribing.keep).toBeDefined()
    state().removeAsset('keep')
    state().confirmRemoveAsset()
    expect(calls.filter((c) => c.name !== 'transcribe')).toEqual([{ name: 'cancelTranscribe', args: ['keep'] }])
    const steps = state().past.length
    land({ language: 'en', model: 'm', segments: [] })
    await running
    expect(Object.keys(state().project.transcripts)).not.toContain('keep')
    expect(state().past).toHaveLength(steps)
    expect(state().notices.map((n) => n.text).filter((t) => t.startsWith('Transcribed'))).toEqual([])
  })
})

/** A bridge whose `method` waits for the test to answer, every other call answered at once (each recorded). */
function bridgeWaitingOn(method: string, other: (name: string) => unknown = () => undefined): { answer: (value: unknown) => void } {
  let answer: (value: unknown) => void = () => undefined
  vi.stubGlobal('window', {
    forge: new Proxy({} as Record<string, unknown>, {
      get: (_t, name: string) => (...args: unknown[]) => {
        calls.push({ name, args })
        if (name === method) return new Promise((resolve) => (answer = resolve))
        const value = other(name)
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
      }
    }),
    innerWidth: 1280,
    innerHeight: 800
  })
  return { answer: (value) => answer(value) }
}
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('Remove from project while the file is being worked on', () => {
  it('cancels a depth bake of the file in flight, and planes that land after it write nothing', async () => {
    const p = open()
    open({ ...p, parallax: {} })
    const bake = bridgeWaitingOn('bakeParallax')
    const running = state().bakeParallax('photo-a')
    expect(state().baking['photo-a']).toBeDefined()
    state().removeAsset('photo-a')
    state().confirmRemoveAsset()
    expect(calls.filter((c) => c.name !== 'bakeParallax')).toEqual([{ name: 'cancelParallax', args: ['photo-a'] }])
    const steps = state().past.length
    bake.answer({ width: 10, height: 10, separated: true, spread: 0.5, layers: [] })
    await running
    expect(Object.keys(state().project.parallax ?? {})).not.toContain('photo-a')
    expect(state().past).toHaveLength(steps)
  })

  it('a look at the photo by the Director’s eyes that lands after it writes nothing', async () => {
    const p = open()
    open({ ...p, vision: {} })
    const measured = bridgeWaitingOn('measurePhotos', (name) =>
      name === 'fileKeys' ? { '/media/photo-a.jpg': 'k1' } : new Error('no model here')
    )
    const seeing = state().seeSlots([{ id: 's1', kind: 'image', assetId: 'photo-a' }] as never, { product: '', language: 'en' } as never)
    await settle()
    expect(calls.map((c) => c.name)).toContain('measurePhotos')
    state().removeAsset('photo-a')
    state().confirmRemoveAsset()
    measured.answer({ measures: [{ path: '/media/photo-a.jpg', sharpness: 3 }], keys: { '/media/photo-a.jpg': 'k1' } })
    await seeing
    expect(Object.keys(state().project.vision ?? {})).not.toContain('photo-a')
  })
})

/* ------------------------------------------------------------------ the menu */

interface Item {
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
  danger?: boolean
}

/** The menu's items, in order, as the elements it returns (its MenuItem children). */
function items(node: ReactNode): Item[] {
  if (!isValidElement(node)) return []
  const props = node.props as Record<string, unknown> & { children?: ReactNode }
  const own = node.type === MenuItem ? [props as unknown as Item] : []
  const kids = Array.isArray(props.children) ? props.children : [props.children]
  return [...own, ...kids.flatMap((k) => items(k as ReactNode))]
}

const menuOf = (assetId: string, why: string | null = null, onClose: () => void = () => undefined): Item[] =>
  items(PoolMenu({ target: { assetId, x: 40, y: 40 }, why, onClose }) as ReactNode)
const labels = (assetId: string, why: string | null = null): string[] => menuOf(assetId, why).map((i) => i.label)
const press = (assetId: string, label: string, onClose: () => void = () => undefined): void => {
  const item = menuOf(assetId, null, onClose).find((i) => i.label === label)
  expect(item, label).toBeDefined()
  item!.onClick()
}

const hello = (capabilities: string[]): HelloResult => ({
  protocolVersion: 1, python: '3.12.10', platform: 'Darwin', capabilities, degraded: {}, executable: '/py', prefix: '/py', path: []
})
const ready: SidecarStatus = { state: 'ready', hello: hello([SIDECAR_METHODS.transcribe]), source: { kind: 'env', python: '/py' } }
const SPEECH: SpeechModelStatus = { present: true, bytes: 486_539_264, label: SPEECH_MODEL_LABEL, host: 'huggingface.co', model: 'small' }

describe('the right-click menu on a pool tile', () => {
  it('offers a photo Add, the platform’s reveal and Remove, last', () => {
    open()
    expect(labels('photo-a')).toEqual(['Add to timeline', 'Show in Finder', REMOVE_FROM_PROJECT])
  })

  it('offers a video with sound Transcribe, and Transcribe again once it has a transcript', () => {
    const p = open()
    open({ ...p, transcripts: {} })
    expect(labels('talk')).toEqual(['Add to timeline', 'Transcribe', 'Show in Finder', REMOVE_FROM_PROJECT])
    open()
    expect(labels('talk')).toEqual(['Add to timeline', 'Transcribe again', 'Show in Finder', REMOVE_FROM_PROJECT])
    // A video with no sound has nothing to transcribe.
    open({ ...p, assets: p.assets.map((a) => (a.id === 'talk' ? { ...a, hasAudio: false } : a)) })
    expect(labels('talk')).not.toContain('Transcribe again')
    // Not while it is being transcribed: the tile's own button is then its cancel.
    open()
    useEditor.setState({ transcribing: { talk: { progress: null } } })
    expect(labels('talk')).not.toContain('Transcribe again')
  })

  it('greys Transcribe with the very reason the tile’s own button gives', () => {
    for (const [status, model] of [[null, null], [ready, null], [ready, SPEECH]] as const) {
      const p = open()
      open({ ...p, transcripts: {} })
      useEditor.setState({ helperStatus: status, speechModel: model })
      const why = transcribeWhy(transcribeGate(status, model))
      const item = menuOf('talk', why).find((i) => i.label === 'Transcribe')!
      // The tile's title, read from the pool as it renders.
      const tile = [...renderToStaticMarkup(createElement(MediaPool)).matchAll(/<button[^>]*title="([^"]*)"[^>]*>/g)]
        .map((m) => m[1])
        .filter((t) => t === 'Transcribe' || t === TRANSCRIBE_NEEDS_HELPER || t === 'the AI helper is starting' || t.startsWith('needs the'))
      // One Transcribe per file with time (talk, keep, the sound): the same reason on each.
      expect(tile.length).toBeGreaterThan(0)
      expect(new Set(tile).size).toBe(1)
      if (why === null) {
        expect(item.disabled).toBeFalsy()
        expect(tile[0]).toBe('Transcribe')
      } else {
        expect(item.disabled).toBe(true)
        expect(item.title).toBe(tile[0])
      }
    }
  })

  it('offers a missing file Relink…, which asks for that one file, and no reveal', async () => {
    const p = open()
    open({ ...p, assets: p.assets.map((a) => (a.id === 'photo-a' ? { ...a, offline: true } : a)) })
    expect(labels('photo-a')).toEqual(['Add to timeline', 'Relink…', REMOVE_FROM_PROJECT])
    press('photo-a', 'Relink…')
    await Promise.resolve()
    expect(calls.map((c) => c.name)).toEqual(['relinkAssets'])
    expect(calls[0].args[1]).toBe('photo-a')
  })

  it('reveals the file the user imported, not the app’s converted copy', () => {
    open()
    press('photo-b', 'Show in Finder')
    expect(calls).toEqual([{ name: 'revealPath', args: ['/media/Bride 5:30pm.heic'] }])
  })

  it('names the reveal as the platform does', () => {
    expect(revealLabel('MacIntel')).toBe('Show in Finder')
    expect(revealLabel('Win32')).toBe('Show in Explorer')
    expect(revealLabel('Linux x86_64')).toBe('Show in folder')
  })

  it('adds as the double-click adds, and closes', () => {
    open()
    let closed = 0
    press('unused', 'Add to timeline', () => closed++)
    expect(state().project.clips.filter((c) => c.assetId === 'unused')).toHaveLength(1)
    expect(closed).toBe(1)
  })

  it('removes an unused file at once and closes; for a used one it stays open and asks, with the number', () => {
    open()
    let closed = 0
    press('unused', REMOVE_FROM_PROJECT, () => closed++)
    expect(state().project.assets.map((a) => a.id)).not.toContain('unused')
    expect(closed).toBe(1)

    press('talk', REMOVE_FROM_PROJECT, () => closed++)
    expect(closed).toBe(1)
    expect(state().removingAsset).toBe('talk')
    const html = renderToStaticMarkup(createElement(PoolMenu, { target: { assetId: 'talk', x: 40, y: 40 }, why: null, onClose: () => undefined }))
    expect(html).toContain('>Used by 3 clips on the timeline<')
    expect(labels('talk')).toEqual(['Remove it and its 3 clips', 'Keep it'])
    expect(html).not.toContain(REMOVE_FROM_PROJECT)
  })

  it('says one clip in the singular', () => {
    open()
    state().removeAsset('keep')
    const html = renderToStaticMarkup(createElement(PoolMenu, { target: { assetId: 'keep', x: 40, y: 40 }, why: null, onClose: () => undefined }))
    expect(html).toContain('>Used by 1 clip on the timeline<')
    expect(labels('keep')).toEqual(['Remove it and its clip', 'Keep it'])
  })

  it('"Keep it" closes and changes nothing; "Remove it and its 3 clips" removes them in one step and closes', () => {
    const before = open()
    let closed = 0
    state().removeAsset('talk')
    press('talk', 'Keep it', () => closed++)
    expect(closed).toBe(1)
    expect(state().removingAsset).toBeNull()
    expect(state().project).toBe(before)
    state().removeAsset('talk')
    press('talk', 'Remove it and its 3 clips', () => closed++)
    expect(closed).toBe(2)
    expect(state().project.assets.map((a) => a.id)).not.toContain('talk')
    expect(state().past).toHaveLength(1)
  })

  it('is drawn by the pool outside its tiles, each tile marked for the harness', () => {
    open()
    const html = renderToStaticMarkup(createElement(MediaPool))
    expect(html).toContain('data-pool-tile="talk"')
    expect(html).not.toContain('data-pool-menu')
  })

  it('stays inside the window, at the pointer when there is room', () => {
    const room = { width: 406, height: 220 }
    const view = { width: 1280, height: 800 }
    expect(menuPosition(40, 50, room, view)).toEqual({ left: 40, top: 50 })
    const corner = menuPosition(1270, 790, room, view)
    expect(corner.left + room.width).toBeLessThanOrEqual(view.width)
    expect(corner.top + room.height).toBeLessThanOrEqual(view.height)
    expect(menuPosition(-5, -5, room, { width: 300, height: 100 }).left).toBeGreaterThanOrEqual(0)
  })
})

it('an empty project shows no tile and no menu', () => {
  open({ ...emptyProject() })
  expect(renderToStaticMarkup(createElement(MediaPool))).not.toContain('data-pool-tile')
})
