import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { emptyProject, type Clip, type MediaAsset } from '@shared/timeline'
import { linkCacheKey, parseLink } from '@shared/ingest/url'
import { FOLDOUT_START } from '@shared/foldout'
import type { Transcript } from '@shared/transcript'

/*
 * The fold-out panel (components/Foldout.tsx), called as a function in each
 * state, the store mocked to a plain selector over the REAL store's state
 * (ingestPanel.test.tsx's way):
 *
 * - shut: an empty root, nothing a person could read or press;
 * - open on Clips: the bar (its two tabs, Clips selected, the close button)
 *   and the Clips tab's line for no link (no link in these tests), in a body
 *   that scrolls inside the panel;
 * - open on Transcript: the empty line of whichever transcript the rule picks
 *   (the link's, or the selected clip's), or nothing yet when it has words;
 * - and each body in its own error boundary, keyed by the tab.
 *
 * Every transcript is made up.
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
const {
  Foldout,
  FoldoutTranscript,
  FOLDOUT_CLIPS_TAB,
  FOLDOUT_CLIP_EMPTY,
  FOLDOUT_CLOSE_TITLE,
  FOLDOUT_LINK_EMPTY,
  FOLDOUT_TABS_LABEL,
  FOLDOUT_TRANSCRIPT_TAB
} = await import('../../src/renderer/src/components/Foldout')
const { ErrorBoundary } = await import('../../src/renderer/src/components/ErrorBoundary')
// The Clips tab's lines for nothing yet live with Best clips' other words since piece 2.
const { FOLDOUT_CLIPS_NO_LINK } = await import('../../src/renderer/src/components/tools/BestClips')

const URL = 'https://www.youtube.com/watch?v=MadeUpFold1'

const photo: MediaAsset = {
  id: 'p', path: '/p/p.jpg', name: 'p.jpg', kind: 'image', durationFrames: 150,
  width: 1600, height: 1067, fps: null, hasVideo: true, hasAudio: false, size: 10
}
const clip: Clip = {
  id: 'a', assetId: 'p', trackId: 'v1', start: 0, duration: 60, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  color: { brightness: 0, contrast: 1, saturation: 1 }
}
const words: Transcript = {
  assetId: 'url:test', language: 'en', model: 'test', durationMs: 1000,
  words: [{ index: 0, text: 'zorplim', startMs: 0, endMs: 400, confidence: null }],
  segments: [{ id: 's0', startMs: 0, endMs: 400, text: 'zorplim', wordStart: 0, wordEnd: 0 }]
}

const html = (): string => renderToStaticMarkup(createElement(Foldout))
const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/'/g, '&#x27;')

function linkWords(ready: boolean): void {
  useEditor.setState((s) => ({
    ingest: { ...s.ingest, url: ready ? URL : '' },
    urlSource: ready
      ? {
          linkKey: linkCacheKey(parseLink(URL)!),
          url: parseLink(URL)!.url,
          meta: null,
          fetchedAt: null,
          transcript: words,
          tracks: [{ key: 'en-orig', kind: 'asr' }],
          language: 'en',
          status: 'ready',
          error: null,
          run: null,
          anchorRow: null,
          clipped: false
        }
      : null
  }))
}

function selected(on: boolean): void {
  useEditor.setState({ selectedClipId: on ? 'a' : null })
}

beforeEach(() => {
  useEditor.getState().loadProject({ ...emptyProject(), assets: [photo], clips: [clip] }, '', [])
  useEditor.setState({ foldout: FOLDOUT_START })
  linkWords(false)
  selected(false)
})

describe('the fold-out panel, shut', () => {
  it('draws an empty root and nothing else', () => {
    expect(html()).toBe('<div data-foldout="shut" class="h-full"></div>')
  })
})

describe('the fold-out panel, open', () => {
  it('on Clips: the bar with both tabs, Clips selected, the close button, and the Clips empty line', () => {
    useEditor.getState().openFoldout('clips')
    const page = html()
    expect(page).toContain('data-foldout="clips"')
    expect(page).toContain(`role="tablist" aria-label="${FOLDOUT_TABS_LABEL}"`)
    expect(page).toMatch(new RegExp(`role="tab" aria-selected="true"[^>]*data-foldout-tab="clips"[^>]*>${FOLDOUT_CLIPS_TAB}<`))
    expect(page).toMatch(new RegExp(`role="tab" aria-selected="false"[^>]*data-foldout-tab="transcript"[^>]*>${FOLDOUT_TRANSCRIPT_TAB}<`))
    expect(page).toContain(`title="${FOLDOUT_CLOSE_TITLE}"`)
    expect(page).toContain('data-foldout-close')
    expect(page).toContain(escapeHtml(FOLDOUT_CLIPS_NO_LINK))
    // The tabs and the panel name each other, and only the open tab points at a panel in the page.
    expect(page).toMatch(/data-foldout-tab="clips" id="foldout-tab-clips"/)
    expect(page).toMatch(/data-foldout-tab="transcript" id="foldout-tab-transcript"/)
    expect([...page.matchAll(/aria-controls="([^"]*)"/g)].map((m) => m[1])).toEqual(['foldout-clips'])
    expect(page).toContain('id="foldout-clips" role="tabpanel" aria-labelledby="foldout-tab-clips"')
    // Its body scrolls inside the panel, and nothing in it runs out sideways.
    expect(page).toMatch(/data-foldout-body="clips" class="[^"]*\boverflow-y-auto\b[^"]*\boverflow-x-hidden\b/)
  })

  it('on Transcript, the link’s words asked, none ready and no clip: the link’s empty line', () => {
    useEditor.getState().openFoldout('transcript', 'link')
    const page = html()
    expect(page).toContain('data-foldout="transcript"')
    expect(page).toMatch(/role="tab" aria-selected="true"[^>]*data-foldout-tab="transcript"/)
    expect(page).toContain(escapeHtml(FOLDOUT_LINK_EMPTY))
    expect(page).not.toContain(escapeHtml(FOLDOUT_CLIP_EMPTY))
    expect(page).not.toContain(escapeHtml(FOLDOUT_CLIPS_NO_LINK))
  })

  it('on Transcript, the clip’s words asked, no clip and no link words: the clip’s empty line', () => {
    useEditor.getState().openFoldout('transcript', 'clip')
    const page = html()
    expect(page).toContain(escapeHtml(FOLDOUT_CLIP_EMPTY))
    expect(page).not.toContain(escapeHtml(FOLDOUT_LINK_EMPTY))
  })

  it('on Transcript, follows the rule: the other transcript when only it exists, and no empty line then', () => {
    // The clip's asked, only the link has words: the link's, ready.
    useEditor.getState().openFoldout('transcript', 'clip')
    linkWords(true)
    let page = renderToStaticMarkup(createElement(FoldoutTranscript))
    expect(page).toBe('<div data-foldout-words="link"></div>')
    // The link's asked, only a clip is selected: the clip's, ready.
    linkWords(false)
    selected(true)
    useEditor.getState().openFoldout('transcript', 'link')
    page = renderToStaticMarkup(createElement(FoldoutTranscript))
    expect(page).toBe('<div data-foldout-words="clip"></div>')
    // Both exist: the one asked.
    linkWords(true)
    expect(renderToStaticMarkup(createElement(FoldoutTranscript))).toBe('<div data-foldout-words="link"></div>')
  })

  it('a selection that outlived its clip is no clip', () => {
    useEditor.setState({ selectedClipId: 'gone' })
    useEditor.getState().openFoldout('transcript', 'clip')
    expect(html()).toContain(escapeHtml(FOLDOUT_CLIP_EMPTY))
  })

  it('puts each body in its own error boundary, keyed by the tab', () => {
    for (const tab of ['clips', 'transcript'] as const) {
      useEditor.getState().openFoldout(tab)
      const found: ReactElement[] = []
      const visit = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(visit)
        if (!isValidElement(node)) return
        if (node.type === ErrorBoundary) found.push(node)
        visit((node.props as { children?: unknown }).children)
      }
      visit(Foldout())
      expect(found, tab).toHaveLength(1)
      expect(found[0].key, tab).toBe(tab)
    }
  })

  it('its tabs open the panel on themselves, and its close button shuts it', () => {
    useEditor.getState().openFoldout('clips')
    const buttons: ReactElement<{ onClick?: () => void; 'data-foldout-tab'?: string; 'data-foldout-close'?: boolean }>[] = []
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(visit)
      if (!isValidElement(node)) return
      if (node.type === 'button') buttons.push(node as (typeof buttons)[number])
      visit((node.props as { children?: unknown }).children)
    }
    visit(Foldout())
    // The tab already open, pressed, keeps the panel open on it: a tab is not a toggle.
    buttons.find((b) => b.props['data-foldout-tab'] === 'clips')!.props.onClick!()
    expect(useEditor.getState().foldout).toMatchObject({ open: true, tab: 'clips' })
    buttons.find((b) => b.props['data-foldout-tab'] === 'transcript')!.props.onClick!()
    expect(useEditor.getState().foldout).toMatchObject({ open: true, tab: 'transcript' })
    buttons.find((b) => b.props['data-foldout-close'])!.props.onClick!()
    expect(useEditor.getState().foldout).toMatchObject({ open: false, tab: 'transcript' })
  })

  it('wears no transform, filter or backdrop-filter on any face', () => {
    const TRAPS = /(?:^|\s)(?:[a-z-]+:)*-?(?:transform|filter|backdrop-[\w-]+|scale-[\w./-]+|translate-[\w./-]+|rotate-[\w./-]+|blur(?:-[\w-]+)?)(?=\s|$)/
    for (const tab of ['clips', 'transcript'] as const) {
      useEditor.getState().openFoldout(tab)
      for (const [, cls] of html().matchAll(/class="([^"]*)"/g)) expect(cls, tab).not.toMatch(TRAPS)
    }
  })
})
