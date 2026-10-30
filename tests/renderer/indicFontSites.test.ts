import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TEXT, emptyProject, type Clip, type MediaAsset, type Project, type TextSpec } from '@shared/timeline'
import { segmentIntoSentences, type Word } from '@shared/transcript'
import { captionWords } from '@shared/graphics/fromTimeline'
import { indicFontsFor } from '@shared/render/textPaint'
import { useCatalog } from '../../src/renderer/src/catalog'
import { bakeTextSequence, renderTextPng, textPreviewCanvas } from '../../src/renderer/src/textCanvas'
import { bakeCaptions } from '../../src/renderer/src/captionBake'

/*
 * The sites that load a text face load the Hindi or Telugu one its words need
 * (docs/CLIPS.md §6.20, D10). The painter's chain names Noto Sans Devanagari
 * and Noto Sans Telugu (tests/textPaint.test.ts), but a family in a chain
 * resolves only once its FontFace is registered, which `ensureFont` does, and
 * neither is installed on macOS or Windows by default. A site that loads only
 * the clip's face draws Hindi in the system's letters, and the bake keeps them
 * in the export.
 *
 * Driven, not read: each site runs here with the catalogue's `ensureFont`
 * replaced by a recorder and the document stood in for, and the faces it asked
 * for are what is checked. The suite has no DOM, so the stand-in's canvas has
 * no 2d context where the site's work after the fonts is not under test: the
 * bakes then stop with their own "no canvas" answer, after the fonts.
 *
 * Not reached from here: Preview.tsx's two font effects (effects do not run
 * under a node render), whose words come from `captionWords` (below) and
 * `facesFor`; the harness's Indic frames are their check (§6.11's `indic`).
 */

const DEVANAGARI = 'Noto Sans Devanagari'
const TELUGU = 'Noto Sans Telugu'
const HINDI = 'प्रिय मित्र किताब'

let asked: string[] = []
const realEnsure = useCatalog.getState().ensureFont

beforeEach(() => {
  asked = []
  useCatalog.setState({
    ensureFont: async (family: string) => {
      asked.push(family)
      return true
    }
  })
})

afterEach(() => {
  useCatalog.setState({ ensureFont: realEnsure })
  vi.unstubAllGlobals()
})

/** A document whose canvases have no 2d context, and whose fonts are all ready. */
function noContextDocument(): void {
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, dataset: {}, getContext: () => null }),
    fonts: { check: () => true }
  })
}

const text = (over: Partial<TextSpec>): TextSpec => ({ ...DEFAULT_TEXT, font: 'Anton', version: 1, ...over })

describe('the text clip’s bake', () => {
  it('renderTextPng loads the Devanagari face for a Hindi clip, with the clip’s own', async () => {
    noContextDocument()
    await expect(renderTextPng(text({ content: HINDI }), 1080, 1920)).rejects.toThrow(
      'Could not get a canvas to draw text on'
    )
    expect(asked).toContain('Anton')
    expect(asked).toContain(DEVANAGARI)
  })

  it('renderTextPng loads the Telugu face for a Telugu clip, and neither for a Latin one', async () => {
    noContextDocument()
    await expect(renderTextPng(text({ content: 'నమస్కారం' }), 1080, 1920)).rejects.toThrow()
    expect(asked).toContain(TELUGU)
    asked = []
    await expect(renderTextPng(text({ content: 'Shop now' }), 1080, 1920)).rejects.toThrow()
    expect(asked).toContain('Anton')
    expect(asked).not.toContain(DEVANAGARI)
    expect(asked).not.toContain(TELUGU)
  })

  it('bakeTextSequence loads the Devanagari face for an animated Hindi clip', async () => {
    noContextDocument()
    const result = await bakeTextSequence(text({ content: HINDI, animationId: 'bounce' }), 'c1', 1080, 1920, 30, 60)
    expect(result).toBeNull()
    expect(asked).toContain('Anton')
    expect(asked).toContain(DEVANAGARI)
  })
})

describe('the text clip’s preview', () => {
  /** A canvas whose context draws nothing and counts how often it was cleared for a redraw. */
  function countingDocument(ready: (face: string) => boolean): { redraws: () => number } {
    let clears = 0
    const stub: unknown = new Proxy(function stub() {}, { get: () => stub, apply: () => stub })
    const state: Record<string | symbol, unknown> = { font: '10px sans-serif' }
    const ctx = new Proxy(
      {},
      {
        get(_target, key) {
          if (key === 'measureText') return (s: string) => ({ width: s.length * 6 })
          if (key === 'clearRect') return () => void clears++
          if (key in state) return state[key]
          return () => stub
        },
        set(_target, key, value) {
          state[key] = value
          return true
        }
      }
    )
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, dataset: {}, getContext: () => ctx }),
      fonts: { check: (font: string) => ready(/"([^"]+)"/.exec(font)?.[1] ?? '') }
    })
    return { redraws: () => clears }
  }

  it('a Hindi clip whose own face is ready but whose Noto face is not is warmed and not cached', () => {
    const { redraws } = countingDocument((face) => face !== DEVANAGARI)
    const spec = text({ content: HINDI })
    textPreviewCanvas('indic-preview-1', spec, 1080, 1920)
    expect(asked).toContain(DEVANAGARI)
    expect(asked).not.toContain('Anton')
    // Not cached: the same spec is drawn again rather than handed back.
    textPreviewCanvas('indic-preview-1', spec, 1080, 1920)
    expect(redraws()).toBe(2)
  })

  it('once every face is ready the canvas is cached and nothing is asked for', () => {
    const { redraws } = countingDocument(() => true)
    const spec = text({ content: HINDI })
    textPreviewCanvas('indic-preview-2', spec, 1080, 1920)
    textPreviewCanvas('indic-preview-2', spec, 1080, 1920)
    expect(redraws()).toBe(1)
    expect(asked).not.toContain(DEVANAGARI)
  })
})

function words(spec: [string, number, number][]): Word[] {
  return spec.map(([t, startMs, endMs], index) => ({ index, text: t, startMs, endMs, confidence: 0.9 }))
}

/** A caption track of one clip, frames 0-120 of a 30 fps source, with these words. */
function captioned(list: Word[], clipOver: Partial<Clip> = {}): Project {
  const asset: MediaAsset = {
    id: 'a1', path: '/m/a.mp4', name: 'a.mp4', kind: 'video', durationFrames: 300,
    width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: true, size: 0
  }
  const clip: Clip = {
    id: 'c1', assetId: 'a1', trackId: 'v1', start: 0, duration: 120, inPoint: 0, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    color: { brightness: 0, contrast: 1, saturation: 1 },
    ...clipOver
  }
  return {
    ...emptyProject(),
    assets: [asset],
    clips: [clip],
    transcripts: {
      a1: { assetId: 'a1', language: 'hi', model: 'test', durationMs: 10000, words: list, segments: segmentIntoSentences(list) }
    },
    captions: { enabled: true, styleId: 'kinetic' }
  }
}

const HINDI_WORDS = words([['Shop', 0, 400], ['now', 400, 800], ['किताब', 800, 1400], ['मित्र', 1400, 2000]])

describe('the caption bake', () => {
  it('bakeCaptions loads the Devanagari face for a track whose words hold Hindi, with the caption face', async () => {
    noContextDocument()
    const result = await bakeCaptions(captioned(HINDI_WORDS), { width: 1080, height: 1920 })
    expect(result).toBeNull()
    expect(asked).toContain(DEVANAGARI)
    expect(asked).not.toContain(TELUGU)
    expect(asked.some((face) => face !== DEVANAGARI), 'the caption face too').toBe(true)
  })

  it('bakeCaptions loads no Indic face for a Latin track', async () => {
    noContextDocument()
    await bakeCaptions(captioned(words([['Shop', 0, 400], ['now', 400, 800]])), { width: 1080, height: 1920 })
    expect(asked.length).toBeGreaterThan(0)
    expect(asked).not.toContain(DEVANAGARI)
    expect(asked).not.toContain(TELUGU)
  })
})

describe('the words the preview’s caption font effect reads', () => {
  it('holds the words inside the clip’s window', () => {
    expect(indicFontsFor(captionWords(captioned(HINDI_WORDS)))).toContain(DEVANAGARI)
  })

  it('leaves out a Hindi word the clip trims away', () => {
    // 20 frames at 30 fps: the clip shows 0-667 ms, before किताब starts.
    const trimmed = captioned(HINDI_WORDS, { duration: 20 })
    expect(captionWords(trimmed)).toContain('Shop')
    expect(indicFontsFor(captionWords(trimmed))).not.toContain(DEVANAGARI)
  })

  it('is empty with no transcript on the caption track', () => {
    expect(captionWords({ ...captioned(HINDI_WORDS), transcripts: {} })).toBe('')
  })
})
