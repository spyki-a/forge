import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Job } from '@shared/types'
import { HELPER_PRESET, WAITING_FOR_THE_HELPER, downloadingText } from '@shared/sidecar/install'

/*
 * The AI helper's job in EXPORT's list (docs/CLIPS.md §3a.4 "The EXPORT
 * row"): "Installing the AI helper" (or Repairing, Updating) with the stage in
 * the speed column, cancellable while queued too, and no Show in folder.
 * Rendered to static markup over the real store's state, as
 * tests/renderer/reframePanel.test.tsx renders the reframe's row.
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
const { ExportStrip, jobName } = await import('../../src/renderer/src/components/ExportStrip')

const words = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')

const MIB = 1024 * 1024

function job(status: Job['status'], kind: string, over: Partial<Job> = {}): Job {
  return {
    id: `helper-${status}-${kind}`,
    presetId: HELPER_PRESET,
    input: '/userData/python',
    inputName: 'the AI helper',
    output: '',
    params: { kind },
    status,
    progress: 0.3,
    speed: downloadingText(31 * MIB, 205 * MIB, 4.2 * MIB),
    error: null,
    startedAt: Date.now() - 4000,
    finishedAt: null,
    ...over
  }
}

function render(jobs: Job[]): string {
  useEditor.setState({ ...useEditor.getInitialState(), jobs, exportOpen: true })
  return renderToStaticMarkup(createElement(ExportStrip))
}

describe('the AI helper’s job in EXPORT', () => {
  it('is named by its kind, never by its inputName', () => {
    expect(jobName(job('running', 'install'))).toBe('Installing the AI helper')
    expect(jobName(job('running', 'repair'))).toBe('Repairing the AI helper')
    expect(jobName(job('running', 'update'))).toBe('Updating the AI helper')
  })

  it('reads "Installing the AI helper" with the stage in the speed column, its bar and one X', () => {
    const html = render([job('running', 'install')])
    expect(words(html)).toContain('Installing the AI helper')
    expect(words(html)).toContain('downloading · 31 of 205 MB · 4.2 MB/s')
    expect(html).toContain('width:30%')
    expect([...html.matchAll(/title="Cancel"/g)]).toHaveLength(1)
    expect(words(render([job('running', 'repair', { speed: WAITING_FOR_THE_HELPER })]))).toContain("waiting for the AI helper's work to finish")
  })

  it('can be cancelled while it waits its turn, and has no folder to show when done', () => {
    expect([...render([job('queued', 'install', { progress: 0, speed: null })]).matchAll(/title="Cancel"/g)]).toHaveLength(1)
    const done = render([job('done', 'install', { progress: 1, speed: null, finishedAt: Date.now() })])
    expect(words(done)).toContain('Installing the AI helper')
    expect(done).not.toContain('title="Show in folder"')
  })
})
