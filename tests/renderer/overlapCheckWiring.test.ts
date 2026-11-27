import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SHELF_TOOLS } from '../../src/renderer/src/components/shelf/tools'
import { CENSUS_STATES, HOMES, toolHomeOf } from '../../src/renderer/src/harness/census'
import { BY_DESIGN, CONTROL, OVERLAP_STATES, installOverlapCheck } from '../../src/renderer/src/harness/overlapCheck'

/*
 * The overlap check (harness/overlapCheck.ts, the clip maker's layout, piece
 * 4): where it runs, and what it stands up.
 *
 * It rides on the harness page only, as the census and the layout checks it
 * sits beside do: harness/main.tsx installs it, the app's own main.tsx never
 * names it, and the product build has no harness entry. Its states are the
 * census's own recipes and homes, so a recipe renamed or a home gone fails
 * here rather than as a "skipped" on the page. And it covers what the design
 * asked for by name — membership, not the list: a state added must not fail
 * this.
 */

const root = join(__dirname, '..', '..')
const read = (...parts: string[]): string => readFileSync(join(root, ...parts), 'utf8')

describe('where the overlap check runs', () => {
  it('is installed by the harness page, once, and named nowhere in the app’s own entry', () => {
    const harness = read('src', 'renderer', 'src', 'harness', 'main.tsx')
    expect([...harness.matchAll(/import \{ installOverlapCheck \} from '\.\/overlapCheck'/g)]).toHaveLength(1)
    expect([...harness.matchAll(/^installOverlapCheck\(\)$/gm)]).toHaveLength(1)
    expect(read('src', 'renderer', 'src', 'main.tsx')).not.toMatch(/overlapCheck/)
  })

  it('is not in the product build: the renderer’s inputs are the app’s pages, and no harness page', () => {
    const config = read('electron.vite.config.ts')
    const renderer = config.slice(config.indexOf('renderer: {'))
    const inputs = [...renderer.matchAll(/resolve\(__dirname, '([^']+)'\)/g)].map((m) => m[1]).filter((p) => p.endsWith('.html'))
    expect(inputs).toContain('src/renderer/index.html')
    for (const input of inputs) expect(input).not.toMatch(/harness/)
  })
})

describe('what it stands up', () => {
  it('uses only the census’s recipes and homes, and no overlay', () => {
    const overlays = ['clipmenu', 'poolmenu', 'newproject', 'shortcuts', 'settings']
    for (const s of OVERLAP_STATES) {
      expect(CENSUS_STATES, s.state).toContain(s.needs)
      for (const home of s.homes) {
        expect(HOMES, `${s.state} → ${home}`).toContain(home)
        expect(overlays).not.toContain(home)
      }
    }
    expect(new Set(OVERLAP_STATES.map((s) => s.state)).size).toBe(OVERLAP_STATES.length)
  })

  it('covers the Shelf home, every tool, the dock alone and under four tiles, the panel’s three faces and both strips', () => {
    const has = (needs: string | null, homes: string[]): boolean =>
      OVERLAP_STATES.some((s) => (needs === null || s.needs === needs) && homes.every((h) => s.homes.includes(h)))
    expect(has(null, ['shelf'])).toBe(true)
    for (const tool of SHELF_TOOLS) expect(has('none', [toolHomeOf(tool.id)]), tool.id).toBe(true)
    // A clip selected: the dock is on screen in every one of these.
    for (const homes of [['shelf'], ['url'], ['transcript'], ['library'], ['director']]) expect(has('video-clip', homes), homes[0]).toBe(true)
    expect(has('link-best-clips', ['foldclips'])).toBe(true)
    expect(OVERLAP_STATES.some((s) => s.needs.startsWith('link-') && s.homes.includes('foldtranscript'))).toBe(true)
    expect(has('transcript-graphics-asr', ['transcript', 'foldtranscript'])).toBe(true)
    // The whole-lane review's journeys: a card's question and steps, the link's words after Clip download, the
    // short blocks the URL tile keeps, Edit's words and Find's drops, a graphic selected with its words open.
    for (const [needs, homes] of [
      ['link-best-clips-question', ['foldclips']],
      ['link-best-clips-clipped', ['foldclips']],
      ['link-clipped', ['foldtranscript']],
      ['link-no-captions', ['url']],
      ['link-no-language', ['url']],
      ['transcript-editing', ['foldtranscript']],
      ['transcript-graphics-drops', ['foldtranscript']],
      ['graphic-lower-third', ['transcript', 'foldtranscript']]
    ] as const) expect(has(needs, [...homes]), needs).toBe(true)
    // The left column at its limit, with the URL tile and with the dock: only window size was varied before.
    const wide = OVERLAP_STATES.filter((s) => s.left === 'widest')
    expect(wide.some((s) => s.homes.includes('url')), 'wide with the URL tile').toBe(true)
    expect(wide.some((s) => s.dock === true), 'wide with the dock').toBe(true)
    expect(has('none', ['output'])).toBe(true)
    expect(has('none', ['export'])).toBe(true)
  })

  it('reads a dock state only with the dock on screen, and a panel state only on its face', () => {
    // A selected clip puts the dock on screen, so a state whose recipe selects one says so (and is skipped, not
    // counted clean, if the dock fails to appear). The panel's clip states and the graphic's are among them.
    for (const name of ['dock', 'dock-url', 'dock-transcript', 'dock-library', 'dock-director', 'panel-clip-words', 'panel-both-words', 'panel-clip-editing', 'panel-clip-drops', 'dock-graphic', 'wide-left-dock']) {
      expect(OVERLAP_STATES.find((s) => s.state === name)?.dock, name).toBe(true)
    }
    for (const s of OVERLAP_STATES.filter((s) => s.homes.includes('foldclips'))) expect(s.foldout, s.state).toBe('clips')
    for (const s of OVERLAP_STATES.filter((s) => s.homes.includes('foldtranscript'))) expect(s.foldout, s.state).toBe('transcript')
  })

  it('leaves out only what it names, each with its reason, and counts the controls the design lists', () => {
    // Every entry names something a component still draws: a selector for a thing gone excuses nothing, silently.
    const components = join(root, 'src', 'renderer', 'src', 'components')
    const sources = (readdirSync(components, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => readFileSync(join(components, f), 'utf8'))
      .join('\n')
    for (const entry of BY_DESIGN) {
      expect(entry.why.length, entry.selector).toBeGreaterThan(20)
      for (const [, attr] of entry.selector.matchAll(/\[(data-[a-z-]+)/g)) expect(sources, `${entry.selector}: ${attr}`).toContain(attr)
    }
    for (const part of ['button', 'input', 'select', 'textarea', 'summary', '[role="tab"]', '[role="switch"]', '[role="slider"]', '[role="button"]']) {
      expect(CONTROL.split(', '), part).toContain(part)
    }
  })
})

describe('one run at a time', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses a second call while a run is going, and leaves that run’s progress alone', async () => {
    const running = { running: true, done: 3, of: 36, state: 'dock-url' }
    const page: Record<string, unknown> = { __forgeOverlapLast: running }
    vi.stubGlobal('window', page)
    installOverlapCheck()
    const call = page.__forgeOverlapCheck as (o?: unknown) => Promise<unknown>
    await expect(call()).rejects.toThrow(/already running \(state 4 of 36, dock-url\)/)
    await expect(call({ plant: true })).rejects.toThrow(/already running/)
    expect(page.__forgeOverlapLast).toBe(running)
    expect(running).toEqual({ running: true, done: 3, of: 36, state: 'dock-url' })
  })
})
