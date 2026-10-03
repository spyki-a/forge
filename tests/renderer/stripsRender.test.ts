import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Job } from '@shared/types'
import { ExportStrip } from '../../src/renderer/src/components/ExportStrip'
import { OutputStrip } from '../../src/renderer/src/components/OutputStrip'

/*
 * OUTPUT and EXPORT, rendered closed and open (docs/WINDOW.md §3.16, §3.17).
 *
 * The source half is tests/windowStrips.test.ts: App mounts both strips
 * unconditionally and EXPORT holds the File › Export listener. This is what
 * a closed strip actually draws: its whole body is still there, hidden by a
 * class, so nothing in it is unmounted by closing — and the header keeps what
 * has to stay in reach (EXPORT's button and running job, OUTPUT's one line).
 *
 * Rendered to static markup, so effects do not run (no encoder probe, no
 * listener firing) and no bridge is needed. The store is a plain selector
 * over a copy of its real initial state, because on the server zustand
 * answers every selector from the initial state and could never show a strip
 * open (as in tests/renderer/settingsPanelRender.test.ts). The canvas bakers
 * are stubbed: drawing is not what is under test.
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
vi.mock('../../src/renderer/src/exportBakers', () => ({ liveBakers: {} }))
vi.mock('../../src/renderer/src/captionBake', () => ({ bakeCaptions: async () => null }))

const render = (component: () => ReactNode): string => renderToStaticMarkup(createElement(component))

/** A job as the queue reports it; an export's presetId is 'render' (main/ipc.ts). */
function job(status: Job['status'], progress: number, over: Partial<Job> = {}): Job {
  const ended = status === 'done' || status === 'failed' || status === 'cancelled'
  return {
    id: `job-${status}`,
    presetId: 'render',
    input: '',
    inputName: `render ${status}`,
    output: status === 'done' ? `/out/render-${status}.mp4` : '',
    params: {},
    status,
    progress,
    speed: null,
    error: null,
    startedAt: 0,
    finishedAt: ended ? 1000 : null,
    ...over
  }
}

beforeEach(() => {
  fake.state = { ...fake.initial, outputOpen: false, exportOpen: false, jobs: [] }
})

/**
 * The strip's markup split at its body: the header before, the body after.
 * Sound only because the body is the section's LAST child — which is checked:
 * the markup must end by closing the body and then the section.
 */
function parts(html: string, id: string): { header: string; bodyTag: string; body: string } {
  expect(html.startsWith(`<section data-strip="${id}"`), html.slice(0, 80)).toBe(true)
  expect(html.endsWith('</div></section>')).toBe(true)
  const at = html.indexOf('<div id="strip-')
  expect(at, 'the body').toBeGreaterThan(-1)
  expect([...html.matchAll(/data-strip-body/g)]).toHaveLength(1)
  const tagEnd = html.indexOf('>', at) + 1
  return { header: html.slice(0, at), bodyTag: html.slice(at, tagEnd), body: html.slice(tagEnd) }
}

describe('EXPORT, rendered', () => {
  it('closed: the whole body is there, hidden by a class, and the button is in the header', () => {
    const html = render(ExportStrip)
    expect(html).toContain('data-open="false"')
    const { header, bodyTag, body } = parts(html, 'export')
    expect(bodyTag).toMatch(/class="hidden"/)
    // The body's controls are mounted, not dropped: closing hides them.
    for (const inBody of ['Codec', 'Quality', 'Saved settings', '+ Save current', 'Reel / TikTok (9:16)']) {
      expect(body, inBody).toContain(inBody)
      expect(header, inBody).not.toContain(inBody)
    }
    // The Export button is in the header, so it is there with the strip shut.
    expect(header).toMatch(/<button[^>]*>(?:(?!<\/button>)[^])*<span>Export<\/span><\/button>/)
    expect(body).not.toContain('<span>Export</span>')
    expect(header).toContain('aria-expanded="false"')
    expect(header).toContain('title="Show the export settings and the exports"')
    expect(header).toContain('>EXPORT<')
  })

  it('open: the same body, shown', () => {
    fake.state.exportOpen = true
    const html = render(ExportStrip)
    expect(html).toContain('data-open="true"')
    const { header, bodyTag, body } = parts(html, 'export')
    expect(bodyTag).not.toMatch(/\bhidden\b/)
    expect(body).toContain('+ Save current')
    expect(header).toContain('<span>Export</span>')
    expect(header).toContain('aria-expanded="true"')
    expect(header).toContain('title="Hide the export settings"')
  })

  it('carries the running job’s bar in the header, and the list in the body', () => {
    fake.state.jobs = [job('done', 1), job('running', 0.42)]
    const html = render(ExportStrip)
    const { header, body } = parts(html, 'export')
    expect(header).toContain('role="progressbar"')
    expect(header).toContain('aria-valuenow="42"')
    expect(header).toContain('title="Running: render running — 42%"')
    expect(header).toContain('style="width:42%"')
    // The list itself is the body's, both jobs in it.
    expect(header).not.toContain('Exports')
    expect(body).toContain('Exports')
    expect(body).toContain('render done')
    expect(body).toContain('render running')
  })

  it('draws no bar when nothing is running', () => {
    fake.state.jobs = [job('done', 1)]
    expect(parts(render(ExportStrip), 'export').header).not.toContain('progressbar')
  })

  /*
   * How the last export ended, in the header (shared/render/exportHeadline.ts).
   * Both strips start closed and the Exports list is in the hidden body, so
   * before this a finished or failed export showed nowhere until the strip
   * was opened — and "Show in folder" was only in there.
   */
  it('closed, after an export: says Done, and Show in folder is one click', () => {
    fake.state.jobs = [job('done', 1)]
    const { header, bodyTag } = parts(render(ExportStrip), 'export')
    expect(bodyTag).toMatch(/class="hidden"/)
    expect(header).toMatch(/<button[^>]*title="Done: render done — Show in folder"[^>]*>(?:(?!<\/button>)[^])*Done<\/button>/)
    expect(header).not.toContain('progressbar')
  })

  it('closed, after a failed export: says Failed, with why, and opens the list', () => {
    fake.state.jobs = [job('failed', 0.3, { error: 'ffmpeg exited with code 1' })]
    const { header } = parts(render(ExportStrip), 'export')
    expect(header).toMatch(/<button[^>]*title="Failed: render failed — ffmpeg exited with code 1\. Open EXPORT for the details\."[^>]*>(?:(?!<\/button>)[^])*Failed<\/button>/)
    expect(header).not.toContain('Done')
  })

  it('closed, with a job waiting its turn: the waiting one’s bar', () => {
    fake.state.jobs = [job('done', 1), job('queued', 0)]
    const { header } = parts(render(ExportStrip), 'export')
    expect(header).toContain('role="progressbar"')
    expect(header).toContain('title="Waiting: render queued — it starts when the one before it ends"')
    // Something under way says that, not how an older one ended.
    expect(header).not.toMatch(/>Done</)
  })

  it('says nothing about a cancelled last export', () => {
    fake.state.jobs = [job('cancelled', 0.2)]
    const { header } = parts(render(ExportStrip), 'export')
    expect(header).not.toContain('progressbar')
    expect(header).not.toMatch(/>(?:Done|Failed)</)
  })
})

describe('OUTPUT, rendered', () => {
  it('closed: says what the file will be, and keeps its body mounted and hidden', () => {
    const html = render(OutputStrip)
    const { header, bodyTag, body } = parts(html, 'output')
    expect(bodyTag).toMatch(/class="hidden"/)
    expect(header).toContain('30 fps · -14 LUFS · captions on')
    expect(header).toContain('>OUTPUT<')
    for (const inBody of ['Frame rate', 'Loudness', 'Captions', 'Reset edits']) {
      expect(body, inBody).toContain(inBody)
    }
  })

  it('open: the line gives way to the settings themselves', () => {
    fake.state.outputOpen = true
    const { header, bodyTag, body } = parts(render(OutputStrip), 'output')
    expect(bodyTag).not.toMatch(/\bhidden\b/)
    expect(header).not.toContain('captions on')
    expect(header).toContain('title="Hide the output settings"')
    expect(body).toContain('Frame rate')
  })
})
