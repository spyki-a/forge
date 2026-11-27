import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The overlap check's page-reading half (harness/overlapCheck.ts `readPage`,
 * the clip maker's layout, piece 4), over a small made-up page. The box
 * arithmetic has its own tests (overlapGeometry.test.ts); this is what reads
 * the page and hands boxes to it: which controls are looked at, what answers
 * at a control's centre, which ancestor clips it — the part a geometry test
 * cannot see, and where a mutation (`elementFromPoint` never asked, no
 * clipper ever found, a scroll box grown past its Panel let through) passed
 * every test before this one.
 *
 * No jsdom here, and none needed: a page is a few elements with fixed boxes,
 * a computed style each, and `elementFromPoint` answering with the LAST
 * element in document order whose box holds the point — paint order for
 * these layouts, where later siblings and children are drawn over earlier
 * ones. On the page itself the same faults are planted for real
 * (`__forgeOverlapCheck({ plant: true })`, `judgePlant`), tested at the foot.
 */

interface Style {
  overflowX: string
  overflowY: string
  position: string
  textOverflow: string
}

class FakeEl {
  parentElement: FakeEl | null = null
  children: FakeEl[] = []
  scrollWidth: number
  clientWidth: number
  constructor(
    readonly tagName: string,
    readonly attrs: Record<string, string>,
    readonly box: { left: number; top: number; right: number; bottom: number },
    readonly style: Partial<Style> = {},
    readonly text = ''
  ) {
    this.clientWidth = box.right - box.left
    this.scrollWidth = this.clientWidth
  }
  add(...kids: FakeEl[]): this {
    for (const kid of kids) {
      kid.parentElement = this
      this.children.push(kid)
    }
    return this
  }
  getBoundingClientRect(): DOMRect {
    const { left, top, right, bottom } = this.box
    return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top } as DOMRect
  }
  getClientRects(): unknown[] {
    return this.box.right > this.box.left && this.box.bottom > this.box.top ? [this.box] : []
  }
  get attributes(): { name: string; value: string }[] {
    return Object.entries(this.attrs).map(([name, value]) => ({ name, value }))
  }
  getAttribute(name: string): string | null {
    return name in this.attrs ? this.attrs[name] : null
  }
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('')
  }
  contains(other: FakeEl): boolean {
    for (let at: FakeEl | null = other; at; at = at.parentElement) if (at === this) return true
    return false
  }
  /** Every descendant, in document order. */
  descendants(): FakeEl[] {
    return this.children.flatMap((c) => [c, ...c.descendants()])
  }
  querySelectorAll(selector: string): FakeEl[] {
    return this.descendants().filter((el) => el.matches(selector))
  }
  /** The selectors the check uses: a list of `tag`, `tag[attr]`, `[attr]`, `[attr="v"]`, `*`, each with an optional `:not(...)`. */
  matches(selector: string): boolean {
    return selector.split(/,\s*/).some((part) => {
      const not = /:not\((.+)\)$/.exec(part)
      const base = not ? part.slice(0, not.index) : part
      if (not && this.matches(not[1])) return false
      const m = /^([a-z*]*)((?:\[[^\]]+\])*)$/.exec(base)
      if (!m) throw new Error(`fake page: selector ${part} not understood`)
      if (m[1] && m[1] !== '*' && m[1] !== this.tagName.toLowerCase()) return false
      return [...m[2].matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([, name, value]) => name in this.attrs && (value === undefined || this.attrs[name] === value))
    })
  }
  closest(selector: string): FakeEl | null {
    for (let at: FakeEl | null = this; at; at = at.parentElement) if (at.matches(selector)) return at
    return null
  }
}

let body: FakeEl

const el = (tag: string, box: [number, number, number, number], attrs: Record<string, string> = {}, style: Partial<Style> = {}, text = ''): FakeEl =>
  new FakeEl(tag.toUpperCase(), attrs, { left: box[0], top: box[1], right: box[2], bottom: box[3] }, style, text)

beforeEach(() => {
  body = el('body', [0, 0, 800, 600])
  vi.stubGlobal('HTMLElement', FakeEl)
  vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 })
  vi.stubGlobal('getComputedStyle', (e: FakeEl) => ({ overflowX: 'visible', overflowY: 'visible', position: 'static', textOverflow: 'clip', ...e.style }))
  vi.stubGlobal('document', {
    body,
    elementFromPoint: (x: number, y: number) => {
      const under = [body, ...body.descendants()].filter((e) => e.box.left <= x && x < e.box.right && e.box.top <= y && y < e.box.bottom)
      return under.at(-1) ?? null
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const { readPage, judgePlant, PLANT_FAULTS, PLANT_CLEAN } = await import('../../src/renderer/src/harness/overlapCheck')

/** The left column: a Panel that clips, as react-resizable-panels draws one, holding the layout under test. */
function page(...kids: FakeEl[]): ReturnType<typeof readPage> {
  const left = el('div', [0, 0, 300, 300], { 'data-panel': '' }, { overflowX: 'hidden', overflowY: 'hidden' }).add(...kids)
  body.add(left)
  return readPage('made-up', { left: [left as unknown as Element], panel: [] })
}

const count = (r: ReturnType<typeof readPage>): number[] => [r.overlaps.length, r.covered.length, r.cutOff.length, r.sideways.length]
const plantOf = (n: { data: Record<string, string> }): string | undefined => n.data['data-plant']

describe('the page read: each fault found', () => {
  it('two buttons sharing 10 px each way are one overlap, both named', () => {
    const r = page(el('button', [0, 0, 60, 24], { 'data-plant': 'a' }), el('button', [50, 6, 110, 30], { 'data-plant': 'b' }))
    expect(r.overlaps).toHaveLength(1)
    expect(r.overlaps[0].how).toBe('overlap')
    expect([plantOf(r.overlaps[0].a), plantOf(r.overlaps[0].b)]).toEqual(['a', 'b'])
    expect(r.overlaps[0].shared).toEqual({ x: 50, y: 6, w: 10, h: 18 })
  })

  it('a button whose centre a later sibling is drawn over is covered, by that sibling', () => {
    const r = page(el('button', [120, 0, 180, 24], { 'data-plant': 'covered' }), el('div', [112, 0, 188, 24], { 'data-cover': '' }))
    expect(r.covered).toHaveLength(1)
    expect(plantOf(r.covered[0].control)).toBe('covered')
    expect(r.covered[0].by.data).toEqual({ 'data-cover': '' })
    // Where to look: the element around it that has data- attributes.
    expect(r.covered[0].control.within).toEqual({ 'data-panel': '' })
  })

  it('a button 20 px wider than a box that clips without scrolling is cut off on the right, by that box', () => {
    const r = page(
      el('div', [0, 40, 100, 64], { 'data-clip': '' }, { overflowX: 'hidden', overflowY: 'hidden' }).add(el('button', [0, 40, 120, 64], { 'data-plant': 'cut' }))
    )
    expect(r.cutOff).toHaveLength(1)
    expect(plantOf(r.cutOff[0].control)).toBe('cut')
    expect(r.cutOff[0].clip.data).toEqual({ 'data-clip': '' })
    expect(r.cutOff[0].past).toEqual({ right: 20 })
  })

  it('a button wholly past a box that clips without scrolling is cut off, though no part of it can be seen', () => {
    const r = page(
      el('div', [0, 0, 200, 40], {}, { overflowX: 'hidden', overflowY: 'hidden' }).add(el('button', [0, 60, 100, 84], { 'data-plant': 'gone' }))
    )
    expect(r.cutOff.map((c) => plantOf(c.control))).toEqual(['gone'])
    expect(r.cutOff[0].past).toEqual({ bottom: 44 })
  })

  it('a scroll box grown taller than the Panel that clips it is cut off at its foot — the button there can never be scrolled to', () => {
    const scroller = el('div', [0, 0, 300, 400], { 'data-plant': 'grown' }, { overflowX: 'auto', overflowY: 'auto' }).add(
      el('button', [0, 290, 100, 320], { 'data-plant': 'foot' })
    )
    const r = page(scroller)
    expect(r.cutOff.map((c) => plantOf(c.control))).toEqual(['grown'])
    expect(r.cutOff[0].clip.data).toEqual({ 'data-panel': '' })
    expect(r.cutOff[0].past).toEqual({ bottom: 100 })
    // The button itself is inside a box that scrolls: never measured past it.
    expect(r.overlaps).toEqual([])
    expect(r.covered).toEqual([])
  })

  it('an element of the left column wider inside than out scrolls sideways', () => {
    const wide = el('div', [0, 0, 200, 20], { 'data-row': '' })
    wide.scrollWidth = 240
    const r = page(wide)
    expect(r.sideways.map((s) => [s.element.data, s.scrollWidth, s.clientWidth])).toEqual([[{ 'data-row': '' }, 240, 200]])
  })
})

describe('the page read: nothing found where nothing is wrong', () => {
  it('two buttons that touch along an edge', () => {
    expect(count(page(el('button', [110, 40, 150, 64]), el('button', [150, 40, 190, 64])))).toEqual([0, 0, 0, 0])
  })

  it('a button scrolled out of a box that scrolls: not looked at, not cut off', () => {
    const r = page(
      el('div', [0, 80, 100, 120], {}, { overflowX: 'auto', overflowY: 'auto' }).add(el('div', [0, 80, 100, 280]), el('button', [0, 280, 100, 300], { 'data-plant': 'scrolled' }))
    )
    expect(count(r)).toEqual([0, 0, 0, 0])
  })

  it('a button holding an icon: the icon answers at its centre, and is part of it', () => {
    const button = el('button', [110, 80, 150, 104]).add(el('svg', [122, 84, 138, 100]))
    expect(count(page(button))).toEqual([0, 0, 0, 0])
  })

  it('a control inside another in the DOM (a tab in a tab list that is a control too)', () => {
    const list = el('div', [0, 0, 200, 30], { tabindex: '0' }).add(el('button', [4, 4, 60, 26]))
    expect(count(page(list))).toEqual([0, 0, 0, 0])
  })

  it('a control in a full-window picker, and one focusable by script only', () => {
    const picker = el('div', [0, 0, 300, 300], {}, { position: 'fixed' }).add(el('button', [0, 0, 100, 30]))
    const r = page(el('button', [0, 0, 100, 30]), picker, el('span', [150, 0, 250, 30], { tabindex: '-1' }))
    expect(r.overlaps).toEqual([])
  })
})

describe('the planted run’s verdict (judgePlant)', () => {
  const named = (plant: string): { tag: string; text: string; data: Record<string, string>; box: { x: number; y: number; w: number; h: number }; within: null } => ({
    tag: 'button',
    text: plant,
    data: { 'data-plant': plant },
    box: { x: 0, y: 0, w: 1, h: 1 },
    within: null
  })
  const all = () => ({
    state: 'planted',
    overlaps: [{ how: 'overlap' as const, a: named('overlap-a'), b: named('overlap-b'), shared: { x: 0, y: 0, w: 1, h: 1 } }],
    covered: [{ control: named('covered'), by: named('cover') }],
    cutOff: [
      { control: named('cut'), clip: named('clip'), past: { right: 20 } },
      { control: named('grown'), clip: named('clip'), past: { bottom: 30 } }
    ],
    sideways: []
  })

  it('is ok when every fault is found and nothing clean is named', () => {
    const verdict = judgePlant(all())
    expect(verdict.ok).toBe(true)
    expect(Object.keys(verdict.found).sort()).toEqual(Object.keys(PLANT_FAULTS).sort())
    expect(Object.keys(verdict.clean).sort()).toEqual(Object.keys(PLANT_CLEAN).sort())
  })

  it('is not ok when a fault goes unfound — each one', () => {
    for (const drop of ['overlaps', 'covered', 'cut', 'grown'] as const) {
      const r = all()
      if (drop === 'overlaps') r.overlaps = []
      else if (drop === 'covered') r.covered = []
      else r.cutOff = r.cutOff.filter((c) => c.control.data['data-plant'] !== drop)
      expect(judgePlant(r).ok, drop).toBe(false)
    }
  })

  it('is not ok when a clean layout is named — touching, scrolled away or an icon', () => {
    for (const plant of ['touch-a', 'scrolled', 'icon']) {
      const r = all()
      r.covered.push({ control: named(plant), by: named('x') })
      expect(judgePlant(r).ok, plant).toBe(false)
    }
  })
})
