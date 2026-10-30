import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TEXT, emptyProject, type Clip, type MediaAsset, type Project, type TextSpec } from '@shared/timeline'
import { segmentIntoSentences, type Segment, type Word } from '@shared/transcript'
import { captionWords } from '@shared/graphics/fromTimeline'
import { indicFontsFor, textClipFaceKey } from '@shared/render/textPaint'
import { useCatalog } from '../../src/renderer/src/catalog'
import { bakeTextSequence, renderTextPng, textPreviewCanvas } from '../../src/renderer/src/textCanvas'
import { bakeCaptions } from '../../src/renderer/src/captionBake'
import { activeCaptionStyle, captionFaces } from '../../src/renderer/src/captionPreview'

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
 * Preview.tsx's two font effects do not run under a node render; what they
 * ensure is `captionFaces` and `textClipFaceKey` (below), and that the effects
 * call them is read from the source. Their dependency on the catalogue landing
 * is the harness's to check (§6.11's `indic`).
 */

const DEVANAGARI = 'Noto Sans Devanagari'
const TELUGU = 'Noto Sans Telugu'
const HINDI = 'प्रिय मित्र किताब'

let asked: string[] = []
const real = (({ ensureFont, loadedFonts, failedFonts }) => ({ ensureFont, loadedFonts, failedFonts }))(
  useCatalog.getState()
)

beforeEach(() => {
  asked = []
  useCatalog.setState({
    ensureFont: async (family: string) => {
      asked.push(family)
      return true
    },
    loadedFonts: new Set(),
    failedFonts: new Map()
  })
})

afterEach(() => {
  useCatalog.setState(real)
  vi.unstubAllGlobals()
})

/** A document whose canvases have no 2d context, and whose fonts are all ready. */
function noContextDocument(): { created: () => number } {
  let created = 0
  vi.stubGlobal('document', {
    createElement: () => {
      created++
      return { width: 0, height: 0, dataset: {}, getContext: () => null }
    },
    fonts: { check: () => true }
  })
  return { created: () => created }
}

const text = (over: Partial<TextSpec>): TextSpec => ({ ...DEFAULT_TEXT, font: 'Anton', version: 1, ...over })

/** Let every queued microtask and timer of the site run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

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

  /*
   * Asked for is not waited for. Each bake draws only once the Noto face has
   * landed: the recorder here holds Devanagari's answer back, and no canvas
   * may be made until it is given.
   */
  function heldDevanagari(): () => void {
    let release: () => void = () => undefined
    const held = new Promise<boolean>((resolve) => {
      release = () => resolve(true)
    })
    useCatalog.setState({
      ensureFont: (family: string) => {
        asked.push(family)
        return family === DEVANAGARI ? held : Promise.resolve(true)
      }
    })
    return release
  }

  it('renderTextPng draws nothing until the Devanagari face has landed', async () => {
    const { created } = noContextDocument()
    const release = heldDevanagari()
    const done = renderTextPng(text({ content: HINDI }), 1080, 1920).catch((err: Error) => err.message)
    await settle()
    expect(asked).toContain(DEVANAGARI)
    expect(created(), 'a canvas made while the Noto face was still loading').toBe(0)
    release()
    expect(await done).toBe('Could not get a canvas to draw text on')
    expect(created()).toBe(1)
  })

  it('bakeTextSequence draws nothing until the Devanagari face has landed', async () => {
    const { created } = noContextDocument()
    const release = heldDevanagari()
    const done = bakeTextSequence(text({ content: HINDI, animationId: 'bounce' }), 'c2', 1080, 1920, 30, 60)
    await settle()
    expect(asked).toContain(DEVANAGARI)
    expect(created(), 'a canvas made while the Noto face was still loading').toBe(0)
    release()
    expect(await done).toBeNull()
    expect(created()).toBe(1)
  })
})

describe('the text clip’s preview', () => {
  /**
   * A canvas whose context draws nothing and counts how often it was cleared
   * for a redraw, in a document whose `fonts.check` says every family is
   * ready: Chromium's answer for a family no FontFace names (measured in
   * Chromium 152, 2026-10-29: `check('16px "Noto Sans Devanagari"')` and a
   * made-up family both true). Readiness is the catalogue's, not this.
   */
  function countingDocument(): { redraws: () => number } {
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
      fonts: { check: () => true }
    })
    return { redraws: () => clears }
  }

  it('a Hindi clip whose own face has landed but whose Noto face has not is warmed and not cached, though fonts.check says ready', () => {
    const { redraws } = countingDocument()
    useCatalog.setState({ loadedFonts: new Set(['Anton']) })
    const spec = text({ content: HINDI })
    textPreviewCanvas('indic-preview-1', spec, 1080, 1920)
    expect(asked).toContain(DEVANAGARI)
    expect(asked).not.toContain('Anton')
    // Not cached: the same spec is drawn again rather than handed back.
    textPreviewCanvas('indic-preview-1', spec, 1080, 1920)
    expect(redraws()).toBe(2)
  })

  it('with neither face landed, both are warmed, not only the first', () => {
    const { redraws } = countingDocument()
    const spec = text({ content: HINDI })
    textPreviewCanvas('indic-preview-3', spec, 1080, 1920)
    expect(asked).toContain('Anton')
    expect(asked).toContain(DEVANAGARI)
    textPreviewCanvas('indic-preview-3', spec, 1080, 1920)
    expect(redraws()).toBe(2)
  })

  it('once every face has landed, or failed for good, the canvas is cached and nothing is asked for', () => {
    const { redraws } = countingDocument()
    useCatalog.setState({ loadedFonts: new Set(['Anton']), failedFonts: new Map([[DEVANAGARI, 'not in the catalog']]) })
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

const ASSET = (id: string): MediaAsset => ({
  id, path: `/m/${id}.mp4`, name: `${id}.mp4`, kind: 'video', durationFrames: 900,
  width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: true, size: 0
})

const CLIP = (over: Partial<Clip>): Clip => ({
  id: 'c1', assetId: 'a1', trackId: 'v1', start: 0, duration: 120, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  color: { brightness: 0, contrast: 1, saturation: 1 },
  ...over
})

/** A caption track of one clip, frames 0-120 of a 30 fps source, with these words. */
function captioned(list: Word[], clipOver: Partial<Clip> = {}, segments?: Segment[]): Project {
  return {
    ...emptyProject(),
    assets: [ASSET('a1')],
    clips: [CLIP(clipOver)],
    transcripts: {
      a1: { assetId: 'a1', language: 'hi', model: 'test', durationMs: 30000, words: list, segments: segments ?? segmentIntoSentences(list) }
    },
    captions: { enabled: true, styleId: 'kinetic' }
  }
}

const HINDI_WORDS = words([['Shop', 0, 400], ['now', 400, 800], ['किताब', 800, 1400], ['मित्र', 1400, 2000]])
/** The kinetic style's three words a line put the Hindi in the second line alone. */
const LATE_HINDI = words([
  ['Shop', 0, 300], ['now', 300, 600], ['today', 600, 900], ['किताब', 900, 1400], ['मित्र', 1400, 2000]
])

describe('the caption bake', () => {
  it('bakeCaptions loads the Devanagari face for a track whose words hold Hindi, with the caption face', async () => {
    noContextDocument()
    const result = await bakeCaptions(captioned(HINDI_WORDS), { width: 1080, height: 1920 })
    expect(result).toBeNull()
    expect(asked).toContain(DEVANAGARI)
    expect(asked).not.toContain(TELUGU)
    expect(asked.some((face) => face !== DEVANAGARI), 'the caption face too').toBe(true)
  })

  it('bakeCaptions loads the Devanagari face when only a line after the first holds Hindi', async () => {
    expect(activeCaptionStyle(captioned(LATE_HINDI)).wordsPerLine, 'the first line is Latin').toBe(3)
    noContextDocument()
    await bakeCaptions(captioned(LATE_HINDI), { width: 1080, height: 1920 })
    expect(asked).toContain(DEVANAGARI)
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
  const split = (s: string): string[] => s.split(' ')

  it('holds the words inside the clip’s window', () => {
    expect(indicFontsFor(captionWords(captioned(HINDI_WORDS)))).toContain(DEVANAGARI)
  })

  it('leaves out a Hindi word the clip trims away', () => {
    // 20 frames at 30 fps: the clip shows 0-667 ms, before किताब starts.
    const trimmed = captioned(HINDI_WORDS, { duration: 20 })
    expect(captionWords(trimmed)).toContain('Shop')
    expect(indicFontsFor(captionWords(trimmed))).not.toContain(DEVANAGARI)
  })

  it('takes the window from the clip’s in-point, not from where it sits on the timeline', () => {
    // inPoint 24 at 30 fps: the clip shows source 800-4800 ms, wherever it sits (frame 300).
    const later = captioned(
      words([['Shop', 0, 400], ['किताब', 1000, 1400], ['बाद', 9000, 9400]]),
      { start: 300, inPoint: 24 }
    )
    expect(split(captionWords(later))).toContain('किताब')
    expect(split(captionWords(later))).not.toContain('Shop')
    expect(split(captionWords(later))).not.toContain('बाद')
  })

  it('reads every clip on the caption track, a Hindi word on the second one too', () => {
    const latin = words([['Shop', 0, 400], ['now', 400, 800]])
    const hindi = words([['किताब', 0, 600], ['मित्र', 600, 1200]])
    const project: Project = {
      ...emptyProject(),
      assets: [ASSET('a1'), ASSET('a2')],
      clips: [CLIP({ id: 'c1', assetId: 'a1', start: 0 }), CLIP({ id: 'c2', assetId: 'a2', start: 120 })],
      transcripts: {
        a1: { assetId: 'a1', language: 'en', model: 'test', durationMs: 30000, words: latin, segments: segmentIntoSentences(latin) },
        a2: { assetId: 'a2', language: 'hi', model: 'test', durationMs: 30000, words: hindi, segments: segmentIntoSentences(hindi) }
      },
      captions: { enabled: true, styleId: 'kinetic' }
    }
    expect(split(captionWords(project))).toContain('Shop')
    expect(indicFontsFor(captionWords(project))).toContain(DEVANAGARI)
  })

  it('leaves out a word no segment holds, as the caption lines do', () => {
    const list = words([['Shop', 0, 400], ['now', 400, 800], ['किताब', 800, 1400]])
    const segments: Segment[] = [{ id: 's0', startMs: 0, endMs: 800, text: 'Shop now', wordStart: 0, wordEnd: 1 }]
    const project = captioned(list, {}, segments)
    expect(split(captionWords(project))).toContain('now')
    expect(indicFontsFor(captionWords(project))).not.toContain(DEVANAGARI)
  })

  it('is empty with no transcript on the caption track', () => {
    expect(captionWords({ ...captioned(HINDI_WORDS), transcripts: {} })).toBe('')
  })
})

describe('the faces the Preview’s font effects ensure', () => {
  it('captionFaces: the caption face and the Devanagari face of a Hindi track, none with captions off', () => {
    const project = captioned(LATE_HINDI)
    const faces = captionFaces(project)
    expect(faces).toContain(activeCaptionStyle(project).fontFamily)
    expect(faces).toContain(DEVANAGARI)
    expect(faces).not.toContain(TELUGU)
    expect(captionFaces({ ...project, captions: { ...project.captions, enabled: false } })).toEqual([])
  })

  it('textClipFaceKey: each text clip’s face and its script’s, moved by a script and not by typing', () => {
    const clips = [
      CLIP({ id: 't1', text: text({ content: HINDI }) }),
      CLIP({ id: 't2', text: text({ font: 'Bebas Neue', content: 'Shop now' }) }),
      CLIP({ id: 'v1' })
    ]
    const key = textClipFaceKey(clips)
    expect(key.split('|')).toContain('Anton')
    expect(key.split('|')).toContain('Bebas Neue')
    expect(key.split('|')).toContain(DEVANAGARI)
    expect(key.split('|')).not.toContain(TELUGU)
    const typed = [CLIP({ id: 't1', text: text({ content: `${HINDI} और` }) }), ...clips.slice(1)]
    expect(textClipFaceKey(typed)).toBe(key)
    const telugu = [CLIP({ id: 't1', text: text({ content: 'నమస్కారం' }) }), ...clips.slice(1)]
    expect(textClipFaceKey(telugu).split('|')).toContain(TELUGU)
  })

  it('Preview.tsx’s two font effects ensure exactly these', () => {
    const source = readFileSync(join(__dirname, '../../src/renderer/src/components/Preview.tsx'), 'utf8')
    const calls = (s: string): number => [...source.matchAll(new RegExp(s.replace(/[()[\].|]/g, '\\$&'), 'g'))].length
    expect(calls('for (const face of captionFaces(project)) void ensureFont(face)')).toBe(1)
    expect(calls('const textFonts = textClipFaceKey(project.clips)')).toBe(1)
  })
})
