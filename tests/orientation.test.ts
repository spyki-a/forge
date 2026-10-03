import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { orientationMismatch } from '@shared/edit/orientation'

/*
 * The orientation chip on the canvas bar, and the move that put it there
 * (docs/WINDOW.md §6 Step 4).
 *
 * The rule is the one the reel's banner in Automation.tsx used, lifted into a
 * pure function unchanged — so these pin what it DID, edges included, rather
 * than what a fresh reading of "most photos" might suggest. If one of them
 * reads oddly (a square photo is "landscape"), that is the old behaviour, and
 * changing it is a decision, not a refactor.
 */

type Asset = { kind: 'image' | 'video' | 'audio'; width: number | null; height: number | null }

const LANDSCAPE = { width: 1920, height: 1080 }
const PORTRAIT = { width: 1080, height: 1920 }
const SQUARE = { width: 1080, height: 1080 }

const photo = (width: number | null, height: number | null): Asset => ({ kind: 'image', width, height })
const standing = (): Asset => photo(3000, 4000)
const lying = (): Asset => photo(4000, 3000)

describe('orientationMismatch', () => {
  it('offers 9:16 when most photos stand up on a landscape canvas', () => {
    expect(orientationMismatch([standing(), standing(), standing()], LANDSCAPE)).toBe('9:16')
    // A majority is enough; it need not be all of them.
    expect(orientationMismatch([standing(), standing(), lying()], LANDSCAPE)).toBe('9:16')
  })

  it('offers 16:9 when most photos lie down on a portrait canvas', () => {
    expect(orientationMismatch([lying(), lying(), lying()], PORTRAIT)).toBe('16:9')
    expect(orientationMismatch([lying(), lying(), standing()], PORTRAIT)).toBe('16:9')
  })

  it('says nothing when the photos and the canvas agree', () => {
    expect(orientationMismatch([standing(), standing()], PORTRAIT)).toBeNull()
    expect(orientationMismatch([lying(), lying()], LANDSCAPE)).toBeNull()
  })

  it('says nothing with no photos — video and sound are not photos', () => {
    expect(orientationMismatch([], LANDSCAPE)).toBeNull()
    expect(orientationMismatch([], PORTRAIT)).toBeNull()
    const tallVideo: Asset = { kind: 'video', width: 1080, height: 1920 }
    const sound: Asset = { kind: 'audio', width: null, height: null }
    expect(orientationMismatch([tallVideo, tallVideo, tallVideo, sound], LANDSCAPE)).toBeNull()
    // And they do not dilute the photos' vote either.
    expect(orientationMismatch([tallVideo, tallVideo, tallVideo, standing()], LANDSCAPE)).toBe('9:16')
  })

  it('calls a tie nothing, on either canvas', () => {
    expect(orientationMismatch([standing(), lying()], LANDSCAPE)).toBeNull()
    expect(orientationMismatch([standing(), lying()], PORTRAIT)).toBeNull()
    expect(orientationMismatch([standing(), standing(), lying(), lying()], LANDSCAPE)).toBeNull()
    expect(orientationMismatch([standing(), standing(), lying(), lying()], PORTRAIT)).toBeNull()
  })

  it('counts a square canvas as landscape', () => {
    expect(orientationMismatch([standing(), standing()], SQUARE)).toBe('9:16')
    expect(orientationMismatch([lying(), lying()], SQUARE)).toBeNull()
  })

  it('counts a square photo, and one with no size, as not portrait', () => {
    expect(orientationMismatch([photo(2000, 2000), photo(2000, 2000)], PORTRAIT)).toBe('16:9')
    expect(orientationMismatch([photo(2000, 2000), photo(2000, 2000)], LANDSCAPE)).toBeNull()
    expect(orientationMismatch([photo(null, null), photo(null, null)], PORTRAIT)).toBe('16:9')
    expect(orientationMismatch([photo(null, null), photo(null, null)], LANDSCAPE)).toBeNull()
  })
})

/* ------------------------------------------------- the move, in the source */

const source = (path: string): string => readFileSync(resolve(__dirname, '..', path), 'utf8')
const count = (text: string, needle: string): number =>
  [...text.matchAll(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].length

describe('the shape and view switches live on the canvas bar', () => {
  const bar = source('src/renderer/src/components/CanvasBar.tsx')
  const inspector = source('src/renderer/src/components/Inspector.tsx')
  const automation = source('src/renderer/src/components/Automation.tsx')

  it('the Inspector no longer switches the shape or the view', () => {
    expect(count(inspector, 'setAspect(')).toBe(0)
    expect(count(inspector, 'setSplitRatio(')).toBe(0)
  })

  it('the canvas bar does, once each — the shape buttons, the chip and the view buttons', () => {
    expect(count(bar, 'onClick={() => setAspect(key)}')).toBe(1)
    expect(count(bar, 'onClick={() => setAspect(mismatch)}')).toBe(1)
    // And nothing else in the bar changes the shape.
    expect(count(bar, 'setAspect(')).toBe(2)
    expect(count(bar, 'onClick={() => setSplitRatio(ratio)}')).toBe(1)
    expect(count(bar, 'setSplitRatio(')).toBe(1)
  })

  it('the chip asks the shared rule, and the reel panel no longer keeps its own', () => {
    expect(count(bar, 'orientationMismatch(assets, settings)')).toBe(1)
    expect(count(automation, 'setAspect(')).toBe(0)
    expect(count(automation, 'canvasPortrait')).toBe(0)
    expect(count(automation, 'orientationMismatch')).toBe(0)
  })
})

/*
 * The chip has to keep its meaning in a bar it shares.
 *
 * Measured in the harness: at the default window the chip read "Most of your
 * photos …" and at the 1100×680 minimum "M…" — the cut took the one word that
 * says what is wrong, and the sentence was nowhere else on screen. The fix is
 * three parts, and the two that are not wording are pinned here: the tooltip
 * carries the chip's own words, and the shape words — also in each shape
 * button's tooltip — give way by the bar's width, earlier when the chip needs
 * the room. Whether it fits is the harness's to measure, not this file's.
 */
describe('the chip keeps its meaning when the bar is narrow', () => {
  const bar = source('src/renderer/src/components/CanvasBar.tsx')

  it('says its own words again in its tooltip, before the reason', () => {
    const titles = [...bar.matchAll(/title=\{([^\n]*)\}\n/g)].map((m) => m[1]).filter((t) => t.includes('CHIP['))
    expect(titles).toHaveLength(1)
    const [title] = titles
    expect(title).toContain('CHIP[mismatch].text')
    expect(title).toContain('CHIP[mismatch].why')
    expect(title.indexOf('CHIP[mismatch].text')).toBeLessThan(title.indexOf('CHIP[mismatch].why'))
  })

  it('lets the shape words go by the bar’s own width, and sooner when the chip is up', () => {
    // The bar is the container; without it no `@max-` query matches and the words never go.
    expect([...bar.matchAll(/className="@container [^"]*"/g)]).toHaveLength(1)
    const go = /const WORDS_GO = \{ chip: '@max-\[(\d+(?:\.\d+)?)rem\]:hidden', plain: '@max-\[(\d+(?:\.\d+)?)rem\]:hidden' \}/.exec(bar)
    expect(go).not.toBeNull()
    expect(Number(go![1])).toBeGreaterThan(Number(go![2]))
    // Each shape's word, and only it, takes the pair — never a word hidden outright.
    expect(count(bar, 'className={mismatch ? WORDS_GO.chip : WORDS_GO.plain}>{ASPECTS[key].label}</span>')).toBe(1)
    expect(count(bar, 'WORDS_GO.')).toBe(2)
  })
})

describe('the canvas bar sits over the picture without moving the Preview', () => {
  const app = source('src/renderer/src/App.tsx')

  it('is rendered once, above the tool strip and the Preview, inside the centre panel', () => {
    for (const tag of ['<CanvasBar />', '<Toolbox />', '<Preview />']) expect(count(app, tag), tag).toBe(1)
    // The centre panel: since step 8 the picture's share of the right column,
    // over the timeline row (the left column runs the full height beside them).
    const open = '<Panel defaultSize="64%" minSize="30%">'
    expect(count(app, open)).toBe(1)
    const start = app.indexOf(open)
    const end = app.indexOf('</Panel>', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const centre = app.slice(start, end)
    const at = (tag: string): number => centre.indexOf(tag)
    expect(at('<CanvasBar />')).toBeGreaterThan(-1)
    expect(at('<CanvasBar />')).toBeLessThan(at('<Toolbox />'))
    expect(at('<Toolbox />')).toBeLessThan(at('<Preview />'))
  })

  it('is never conditional — a bar that comes and goes would shift the Preview in the tree', () => {
    // The chip inside the bar comes and goes; the bar itself is always there.
    expect(app).not.toMatch(/(?:&&|\?|:)\s*\(?\s*<CanvasBar\b/)
    expect(app).toMatch(/\n\s*<CanvasBar \/>\n/)
  })
})
