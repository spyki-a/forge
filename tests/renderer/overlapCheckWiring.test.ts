import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SHELF_TOOLS } from '../../src/renderer/src/components/shelf/tools'
import { CENSUS_STATES, HOMES, toolHomeOf } from '../../src/renderer/src/harness/census'
import { BY_DESIGN, CONTROL, OVERLAP_STATES } from '../../src/renderer/src/harness/overlapCheck'

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
    expect(has('none', ['output'])).toBe(true)
    expect(has('none', ['export'])).toBe(true)
  })

  it('leaves out only what it names, each with its reason, and counts the controls the design lists', () => {
    for (const entry of BY_DESIGN) expect(entry.why.length, entry.selector).toBeGreaterThan(20)
    for (const part of ['button', 'input', 'select', 'textarea', 'summary', '[role="tab"]', '[role="switch"]', '[role="slider"]', '[role="button"]']) {
      expect(CONTROL.split(', '), part).toContain(part)
    }
  })
})
