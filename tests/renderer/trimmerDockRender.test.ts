import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { TrimmerDock } from '../../src/renderer/src/components/TrimmerDock'

/*
 * The Trimmer dock, rendered (docs/WINDOW.md §3.18). The source half is
 * tests/trimmerDock.test.ts: App draws the dock's panel only while
 * `dockSubject` says so. This is what the dock itself draws in each state —
 * nothing at all with nothing to trim; for a Library sound, the waveform and
 * no clip editor; for a clip, the waveform over the editor — so the dock never
 * stands open over an empty editor, and the "No clip selected" face it
 * replaced has nowhere to come back.
 *
 * Static markup, so no effects run (no peaks are asked for) and no bridge is
 * needed. The store is a plain selector over a copy of its real initial state,
 * as in tests/renderer/stripsRender.test.ts: on the server zustand answers
 * every selector from the initial state and could never show a selection.
 */

const fake = vi.hoisted(() => ({
  initial: {} as Record<string, unknown>,
  state: {} as Record<string, unknown>
}))

vi.mock('../../src/renderer/src/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/src/store')>()
  fake.initial = { ...(real.useEditor.getState() as unknown as Record<string, unknown>) }
  const useEditor = Object.assign((select: (s: Record<string, unknown>) => unknown) => select(fake.state), {
    getState: () => fake.state
  })
  return { ...real, useEditor }
})

const render = (component: () => ReactNode): string => renderToStaticMarkup(createElement(component))

function withPhoto(): Project {
  const project = emptyProject()
  const asset: MediaAsset = {
    id: 'a1',
    path: '/media/beach.jpg',
    name: 'beach.jpg',
    kind: 'image',
    durationFrames: 150,
    width: 1600,
    height: 1067,
    fps: null,
    hasVideo: true,
    hasAudio: false,
    size: 1
  }
  const video = project.tracks.find((t) => t.kind === 'video')!
  const clip: Clip = {
    id: 'c1',
    assetId: 'a1',
    trackId: video.id,
    start: 0,
    duration: 150,
    inPoint: 0,
    volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    color: { brightness: 0, contrast: 1, saturation: 1 }
  }
  return { ...project, assets: [asset], clips: [clip] }
}

const sound = { path: '/library/sfx/whoosh.wav', name: 'whoosh', inMs: 0, outMs: 0 }

beforeEach(() => {
  fake.state = { ...fake.initial, project: emptyProject(), selectedClipId: null, selectedClipIds: [], audition: null }
})

describe('the Trimmer dock, rendered', () => {
  it('draws nothing at all with nothing to trim', () => {
    expect(render(TrimmerDock)).toBe('')
    // A selection that outlived its clip is nothing to trim either.
    fake.state.selectedClipId = 'gone'
    expect(render(TrimmerDock)).toBe('')
  })

  it('for a Library sound: its name, the waveform, and no clip editor', () => {
    fake.state.audition = sound
    const html = render(TrimmerDock)
    expect(html.startsWith('<div data-dock="true"')).toBe(true)
    expect(html).toContain('>Trimmer<')
    expect(html).toContain('title="whoosh — a Library sound, not on the timeline yet"')
    expect(html).toMatch(/<button[^>]*title="Close the trimmer"[^>]*aria-label="Close the trimmer"/)
    // The waveform's own audition header carries the name too.
    expect([...html.matchAll(/>whoosh</g)].length).toBeGreaterThanOrEqual(2)
    // No clip, so no editor: neither its header nor the Transition in block.
    expect(html).not.toContain('>Clip<')
    expect(html).not.toContain('Transition in')
  })

  it('for a selected clip: its name, the waveform, then the clip editor', () => {
    fake.state.project = withPhoto()
    fake.state.selectedClipId = 'c1'
    fake.state.selectedClipIds = ['c1']
    const html = render(TrimmerDock)
    expect(html.startsWith('<div data-dock="true"')).toBe(true)
    expect(html).toContain('title="beach.jpg — the selected clip"')
    const wave = html.indexOf('has no audio track')
    const editor = html.indexOf('>Clip<')
    expect(wave, 'the waveform').toBeGreaterThan(-1)
    expect(editor, 'the clip editor').toBeGreaterThan(wave)
    expect(html).toContain('Transition in')
    for (const gone of ['No clip selected', 'Select a clip']) expect(html).not.toContain(gone)
  })

  it('shows the clip over an audition, as the waveform always has', () => {
    fake.state.project = withPhoto()
    fake.state.selectedClipId = 'c1'
    fake.state.audition = sound
    const html = render(TrimmerDock)
    expect(html).toContain('title="beach.jpg — the selected clip"')
    expect(html).not.toContain('whoosh')
  })
})
