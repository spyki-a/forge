import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type CaptionSettings, type Clip, type MediaAsset } from '@shared/timeline'
import { segmentIntoSentences, type Word } from '@shared/transcript'

/*
 * The OUTPUT strip's note on drawn captions (docs/CLIPS.md §6.20, "The OUTPUT
 * strip's note"), rendered open as tests/renderer/smartPlacement.test.tsx
 * renders it: the store mocked to a plain selector over the real store's state.
 *
 * It shows when the captions' route is the canvas (`captionRoute`): a look
 * libass cannot draw, or a plain style on a Hindi or Telugu track, which is
 * why its cost is against burning them in rather than against a plain style;
 * and for a Hindi or Telugu track a third sentence says why they are drawn.
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
const { OutputStrip } = await import('../../src/renderer/src/components/OutputStrip')

const FIRST = 'These captions are drawn rather than burned in.'
const COST = 'so it costs a little more than burning them in — not a second render.'
const JOIN = 'Their letters join, which burned-in captions cannot do on Windows, so they are drawn on every computer.'

const TALK: MediaAsset = {
  id: 'talk', path: '/media/talk.mp4', name: 'talk.mp4', kind: 'video', durationFrames: 180,
  width: 1080, height: 1920, fps: 30, hasVideo: true, hasAudio: true, size: 1
}

function words(list: string[]): Word[] {
  return list.map((text, index) => ({ index, text, startMs: index * 500, endMs: index * 500 + 450, confidence: 1 }))
}

/** The talk on the bottom video track, its transcript these words, the captions as given; OUTPUT open. */
function scene(said: string[], captions: Partial<CaptionSettings>): string {
  const base = emptyProject()
  const trackId = base.tracks.find((t) => t.kind === 'video')!.id
  const clip: Clip = {
    id: 'c-talk', assetId: TALK.id, trackId, start: 0, duration: 180, inPoint: 0, volume: 1,
    transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR }
  }
  const list = words(said)
  useEditor.setState({
    ...useEditor.getInitialState(),
    outputOpen: true,
    project: {
      ...base,
      assets: [TALK],
      clips: [clip],
      transcripts: {
        [TALK.id]: { assetId: TALK.id, language: 'hi', model: 'test', durationMs: 6000, words: list, segments: segmentIntoSentences(list) }
      },
      captions: { ...base.captions, enabled: true, ...captions }
    }
  })
  // One space between words, whatever the markup's line breaks.
  return renderToStaticMarkup(createElement(OutputStrip)).replace(/\s+/g, ' ')
}

beforeEach(() => {
  useEditor.setState(useEditor.getInitialState())
})

describe('the OUTPUT strip’s note on drawn captions', () => {
  it('shows for a plain style on a Hindi track, its cost against burning them in, and says why it is drawn', () => {
    const html = scene(['यह', 'किताब', 'है।'], { styleId: 'pop' })
    expect(html).toContain(FIRST)
    expect(html).toContain(COST)
    expect(html).toContain(JOIN)
  })

  it('says the same for a Telugu track', () => {
    const html = scene(['ఇది', 'పుస్తకం.'], { styleId: 'pop' })
    expect(html).toContain(COST)
    expect(html).toContain(JOIN)
  })

  it('shows for a look libass cannot draw on a Latin track, without the third sentence', () => {
    const html = scene(['Shop', 'the', 'sale.'], { styleId: 'kinetic' })
    expect(html).toContain(FIRST)
    expect(html).toContain(COST)
    expect(html).not.toContain(JOIN)
  })

  it('is not there for a plain style on a Latin track, which libass burns in', () => {
    const html = scene(['Shop', 'the', 'sale.'], { styleId: 'pop' })
    expect(html).not.toContain(FIRST)
  })
})
