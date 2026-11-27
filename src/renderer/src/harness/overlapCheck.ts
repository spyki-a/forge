/**
 * The overlap check (the clip maker's layout, piece 4): controls that sit on
 * one another, or are cut off, read off the page state by state. The user,
 * 2026-11-27: "in some spots when i click on the current clip or any element
 * its own custom setting is overlapping in the menu bar option … as we are
 * building we should see the tiny spots too".
 *
 *   void window.__forgeOverlapCheck()                    → starts a full run
 *   window.__forgeOverlapLast                            → { running, done, of, result? }
 *   await window.__forgeOverlapCheck({ states: ['url-link'] })   → one state, read at once
 *
 * For each state it stands up (the census's own recipes and homes, through
 * census.ts `standCensusState`), it reads the header's row, the whole left
 * column, the fold-out panel, the canvas bar, the tool strip and the transport,
 * and reports:
 *
 * - OVERLAPS: two visible controls whose boxes share more than one pixel each
 *   way (`overlap`), or one wholly inside the other (`inside`), neither holding
 *   the other in the DOM.
 * - COVERED: a visible control whose centre `elementFromPoint` answers with an
 *   element that is neither it, inside it, nor around it.
 * - CUT OFF: a visible control running past its nearest clipping ancestor
 *   (overflow hidden or clip) on a side that ancestor does not scroll — and,
 *   the same rule, a SCROLL BOX running past its own nearest clipper (a list
 *   with no `min-h-0` grown taller than the Panel that clips it: the controls
 *   at its foot can never be scrolled to, though each sits inside a box that
 *   scrolls). The control inside a scroll box is never measured past it: rows
 *   scrolled out of view are how a list is.
 * - SIDEWAYS: an element of the left column or the panel whose scroll width
 *   runs past its width by more than a pixel.
 *
 * "Visible" is a control with a box, some of it on the window, and some of it
 * inside every scrolling or clipping box around it: a row scrolled out of its
 * list is not looked at (its centre would answer with whatever is in view).
 *
 * LEFT OUT: the Preview, the timeline and the Curve tray are outside the
 * regions read (the picture's own overlays and handles, the timeline's lanes,
 * clips and handles are drawn over one another on purpose); anything inside
 * an open full-window picker (position fixed). Pickers and overlays (the clip
 * menu, the settings panel) are not states this check opens. `BY_DESIGN` is
 * for a deliberate overlap the first runs on the page find, each with its
 * reason, and it excuses only the overlap PAIRING: a control it names is
 * still reported covered, cut off or sideways. It is empty: the two the
 * design expected are not overlaps (a tile's busy badge is a span inside the
 * tile's button, never a control; the transcript rows' Start and End handles
 * sit in their own w-3.5 gutter column beside the row's buttons).
 *
 * `{ plant: true }` proves the check on the page itself, where jsdom cannot:
 * it puts seven made-up layouts at the top of the left column (four faults,
 * three clean), reads the page once, takes them out, and says whether each
 * fault was found and nothing clean was (`judgePlant`).
 *
 * Two states (`left: 'widest'`) drag the left column to its 45 % limit
 * through the Panel's handle (leftColumn.ts) before reading and put it back
 * after: the right column at its narrowest, where the transport row and the
 * canvas bar have the least room. Otherwise only the window's size varies.
 *
 * It puts the page back as it was when done (the census's `restore`), unless
 * `keep` is passed, which leaves the last state on screen to look at.
 */

import { HOMES, censusPage, frames, standCensusState, toolHomeOf, windowRegions } from './census'
import { SHELF_TOOLS } from '../components/shelf/tools'
import { LEFT_MAX, leftColumn } from '../leftColumn'
import { boxFrom, collisions, measurable, intersect, pastEdges, sideways, type Box } from './overlapGeometry'

/** One state: a census recipe, then the homes opened in turn, then what must be on screen before it is read. */
export interface OverlapState {
  state: string
  needs: string
  homes: readonly string[]
  /** The Trimmer dock must be on screen (a clip selected). */
  dock?: boolean
  /** The fold-out panel must show this face. */
  foldout?: 'clips' | 'transcript'
  /**
   * Read with the left column dragged to its limit (LEFT_MAX), put back after:
   * the right column at its narrowest, where the transport row and the canvas
   * bar have the least room. Only window SIZE varied otherwise.
   */
  left?: 'widest'
}

/** The Shelf tools' homes, as the census names them. */
const TOOLS = SHELF_TOOLS.map((tool) => ({ id: tool.id, home: toolHomeOf(tool.id) }))

/**
 * The states, in order. Each is a census recipe (so it is the same state the
 * census counts in) and the homes to open over it.
 */
export const OVERLAP_STATES: readonly OverlapState[] = [
  { state: 'shelf-home', needs: 'none', homes: ['shelf'] },
  ...TOOLS.map(({ id, home }) => ({ state: `tool-${id}`, needs: 'none', homes: [home] })),
  // A clip selected: the Trimmer dock under the Shelf, alone and under the tiles that share its column.
  { state: 'dock', needs: 'video-clip', dock: true, homes: ['shelf'] },
  { state: 'dock-url', needs: 'video-clip', dock: true, homes: ['url'] },
  { state: 'dock-transcript', needs: 'video-clip', dock: true, homes: ['transcript'] },
  { state: 'dock-library', needs: 'video-clip', dock: true, homes: ['library'] },
  { state: 'dock-director', needs: 'video-clip', dock: true, homes: ['director'] },
  // The URL tile with a link: its rows, and each fold-down list unfolded.
  { state: 'url-link', needs: 'link-transcript', homes: ['url'] },
  { state: 'url-qualities', needs: 'link-qualities', homes: ['url'] },
  { state: 'url-formats', needs: 'link-formats', homes: ['url'] },
  { state: 'url-lengths', needs: 'link-best-lengths', homes: ['url'] },
  { state: 'url-range', needs: 'ingest-range', homes: ['url'] },
  // The panel beside the picture: the cards, the link's words, the selected clip's words with Find graphics' results.
  { state: 'panel-clips', needs: 'link-best-clips', foldout: 'clips', homes: ['url', 'foldclips'] },
  { state: 'panel-link-words', needs: 'link-run', foldout: 'transcript', homes: ['url', 'foldtranscript'] },
  // A clip is selected in these two, so the Trimmer dock is on screen too: panel-both-words is the full URL tile beside the dock.
  { state: 'panel-clip-words', needs: 'transcript-graphics-asr', dock: true, foldout: 'transcript', homes: ['transcript', 'foldtranscript'] },
  { state: 'panel-both-words', needs: 'foldout-both-words', dock: true, foldout: 'transcript', homes: ['url', 'foldtranscript'] },
  // The long things of each journey (the whole-lane review, 2026-11-27): a card's question and its steps, the
  // link's words after Clip download, the short blocks the URL tile keeps (no captions, the language choice),
  // Edit's words and Find graphics' dropped list in the clip's transcript.
  { state: 'panel-card-question', needs: 'link-best-clips-question', foldout: 'clips', homes: ['url', 'foldclips'] },
  { state: 'panel-card-steps', needs: 'link-best-clips-clipped', foldout: 'clips', homes: ['url', 'foldclips'] },
  { state: 'panel-link-clipped', needs: 'link-clipped', foldout: 'transcript', homes: ['url', 'foldtranscript'] },
  { state: 'url-no-captions', needs: 'link-no-captions', homes: ['url'] },
  { state: 'url-no-language', needs: 'link-no-language', homes: ['url'] },
  { state: 'panel-clip-editing', needs: 'transcript-editing', dock: true, foldout: 'transcript', homes: ['transcript', 'foldtranscript'] },
  { state: 'panel-clip-drops', needs: 'transcript-graphics-drops', dock: true, foldout: 'transcript', homes: ['transcript', 'foldtranscript'] },
  // The user's own complaint ("when i click on the current clip … its own custom setting is overlapping … find
  // graphics"): a graphic selected, its settings in the dock, the Transcript tile open and the panel on its words.
  { state: 'dock-graphic', needs: 'graphic-lower-third', dock: true, foldout: 'transcript', homes: ['transcript', 'foldtranscript'] },
  // The left column dragged to its 45 % limit: the right column at its narrowest (the transport row, the canvas bar).
  { state: 'wide-left-url', needs: 'link-transcript', left: 'widest', homes: ['url'] },
  { state: 'wide-left-dock', needs: 'video-clip', dock: true, left: 'widest', homes: ['transcript'] },
  // The strips at the foot of the left column.
  { state: 'output-open', needs: 'none', homes: ['output'] },
  { state: 'export-open', needs: 'none', homes: ['export'] }
]

/**
 * What overlaps on purpose. Each entry is a selector and its reason; an
 * overlap PAIR one of whose controls matches it (or sits inside a match) is
 * not reported. Nothing else is excused: a control named here is still
 * reported covered, cut off or sideways. Empty until a run on the page shows
 * a deliberate overlap (the head comment says why the badge and the handles
 * are not one); tests/renderer/overlapCheckWiring.test.ts holds every entry
 * to a reason and to a selector some component still draws.
 */
export const BY_DESIGN: readonly { selector: string; why: string }[] = []

/** Things that can be pressed or typed in, by tag or by role. A tabindex of -1 is focusable by script only, and left out. */
export const CONTROL = [
  'button',
  'input',
  'select',
  'textarea',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="slider"]',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

export interface Named {
  tag: string
  text: string
  data: Record<string, string>
  box: { x: number; y: number; w: number; h: number }
  /** The data- attributes of the nearest element around it that has any: where to look for an icon-only button or a plain div. */
  within: Record<string, string> | null
}

export interface OverlapStateResult {
  state: string
  overlaps: { how: 'overlap' | 'inside'; a: Named; b: Named; shared: Named['box'] }[]
  covered: { control: Named; by: Named }[]
  cutOff: { control: Named; clip: Named; past: Partial<Record<'left' | 'right' | 'top' | 'bottom', number>> }[]
  sideways: { element: Named; scrollWidth: number; clientWidth: number }[]
}

export interface OverlapResult {
  ok: boolean
  width: number
  height: number
  states: OverlapStateResult[]
  skipped: { state: string; why: string }[]
  summary: string
  ms: number
}

export interface OverlapOptions {
  /** Only these states, by name (OVERLAP_STATES). */
  states?: readonly string[]
  /** Leave the last state on screen. */
  keep?: boolean
  /** Read the made-up faults instead of any state (see the head comment); returns a PlantResult. */
  plant?: boolean
}

const round = (n: number): number => Math.round(n * 10) / 10
const cut = (text: string): string => (text.length > 40 ? `${text.slice(0, 39)}…` : text)

const dataOf = (el: Element): Record<string, string> => {
  const data: Record<string, string> = {}
  for (const a of el.attributes) if (a.name.startsWith('data-')) data[a.name] = a.value
  return data
}

/** An element as a person could find it: its tag, its words or title, its data- attributes, its box, and what it is inside. */
export function nameOf(el: Element): Named {
  const r = el.getBoundingClientRect()
  const said = (el.textContent ?? '').replace(/\s+/g, ' ').trim() || el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('placeholder') || ''
  let within: Record<string, string> | null = null
  for (let at = el.parentElement; at && !within; at = at.parentElement) {
    const data = dataOf(at)
    if (Object.keys(data).length > 0) within = data
  }
  return { tag: el.tagName.toLowerCase(), text: cut(said), data: dataOf(el), box: { x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height) }, within }
}

const fromBox = (b: Box): Named['box'] => ({ x: round(b.left), y: round(b.top), w: round(b.right - b.left), h: round(b.bottom - b.top) })

const byDesign = (el: Element): boolean => BY_DESIGN.some(({ selector }) => el.matches(selector) || el.closest(selector) !== null)

/** Inside something drawn over the whole window (a picker): position fixed on it or above it. */
function inFixed(el: Element): boolean {
  for (let at: Element | null = el; at && at !== document.body; at = at.parentElement) {
    if (getComputedStyle(at).position === 'fixed') return true
  }
  return false
}

const clips = (value: string): boolean => value === 'hidden' || value === 'clip'
const scrolls = (value: string): boolean => value === 'auto' || value === 'scroll'

/** The part of an element's box a person can see: cut by the window and by every box around it that clips or scrolls. */
function seenBox(el: Element, view: Box): Box | null {
  let box: Box | null = intersect(boxFrom(el.getBoundingClientRect()), view)
  for (let at = el.parentElement; at && box; at = at.parentElement) {
    const style = getComputedStyle(at)
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
    box = intersect(box, boxFrom(at.getBoundingClientRect()))
  }
  return box
}

/** The nearest ancestor that clips `el` on an axis without scrolling there, or null (one scrolls first, or none clips). */
export function clipper(el: Element, axis: 'x' | 'y'): Element | null {
  for (let at = el.parentElement; at; at = at.parentElement) {
    const style = getComputedStyle(at)
    const value = axis === 'x' ? style.overflowX : style.overflowY
    if (scrolls(value)) return null
    if (clips(value)) return at
  }
  return null
}

function visible(el: Element): boolean {
  if (el.getClientRects().length === 0) return false
  const check = (el as Element & { checkVisibility?: (o?: { visibilityProperty?: boolean }) => boolean }).checkVisibility
  return check ? check.call(el, { visibilityProperty: true }) : true
}

/** How far `el` runs past its nearest clipper, on each axis that clipper does not scroll; null when it does not. */
function cutOffOf(el: Element): OverlapStateResult['cutOff'] {
  const out: OverlapStateResult['cutOff'] = []
  const own = boxFrom(el.getBoundingClientRect())
  for (const axis of ['x', 'y'] as const) {
    const at = clipper(el, axis)
    if (!at) continue
    const all = pastEdges(own, boxFrom(at.getBoundingClientRect()))
    const past = axis === 'x' ? { left: all.left, right: all.right } : { top: all.top, bottom: all.bottom }
    const kept = Object.fromEntries(Object.entries(past).filter(([, v]) => v !== undefined))
    if (Object.keys(kept).length > 0) out.push({ control: nameOf(el), clip: nameOf(at), past: kept })
  }
  return out
}

const sized = (el: Element): boolean => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

/**
 * One state read off the page. `regions` defaults to the window's own
 * (census.ts `windowRegions`); the planted run passes the ones it found
 * before it planted, since the plant is one more child than the finders allow.
 */
export function readPage(state: string, regions: Record<string, Element[]> = windowRegions()): OverlapStateResult {
  const view: Box = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  const roots = Object.values(regions).flat()
  const seen = new Set<Element>()
  /** Every control on screen: drawn, not in a picker, with a size. */
  const all: Element[] = []
  /** Those with some part a person can see, and that part. */
  const controls: { el: Element; box: Box }[] = []
  for (const root of roots) {
    for (const el of [root, ...root.querySelectorAll(CONTROL)]) {
      if (seen.has(el) || !el.matches(CONTROL)) continue
      seen.add(el)
      if (!visible(el) || inFixed(el) || !sized(el)) continue
      all.push(el)
      if (!measurable(boxFrom(el.getBoundingClientRect()), view)) continue
      const box = seenBox(el, view)
      if (box && measurable(box, view)) controls.push({ el, box })
    }
  }

  const overlaps = collisions(controls, (a, b) => a.el.contains(b.el) || b.el.contains(a.el))
    .filter(({ a, b }) => !byDesign(a.el) && !byDesign(b.el))
    .map(({ a, b, how, shared }) => ({
      how,
      a: nameOf(a.el),
      b: nameOf(b.el),
      shared: fromBox(shared)
    }))

  const covered: OverlapStateResult['covered'] = []
  for (const { el, box } of controls) {
    const x = (box.left + box.right) / 2
    const y = (box.top + box.bottom) / 2
    const hit = document.elementFromPoint(x, y)
    if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue
    covered.push({ control: nameOf(el), by: nameOf(hit) })
  }

  /*
   * Cut off: every control, seen or not (one wholly past a clipper that does
   * not scroll is the worst case, and has no part to see), and every scroll
   * box in the regions — a scroll box grown past the Panel that clips it hides
   * its foot for good, while each control in it is "inside a box that scrolls".
   */
  const cutOff: OverlapStateResult['cutOff'] = []
  for (const el of all) cutOff.push(...cutOffOf(el))
  const scrollBoxes = new Set<Element>()
  for (const root of roots) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (scrollBoxes.has(el) || seen.has(el)) continue
      const style = getComputedStyle(el)
      if (!scrolls(style.overflowX) && !scrolls(style.overflowY)) continue
      scrollBoxes.add(el)
      if (!visible(el) || inFixed(el) || !sized(el)) continue
      cutOff.push(...cutOffOf(el))
    }
  }

  const side: OverlapStateResult['sideways'] = []
  for (const root of [...(regions.left ?? []), ...(regions.panel ?? [])]) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (!(el instanceof HTMLElement) || !visible(el)) continue
      // A text cut with an ellipsis is cut on purpose (a chapter chip's long title); its own box says so.
      if (getComputedStyle(el).textOverflow === 'ellipsis') continue
      if (sideways(el.scrollWidth, el.clientWidth)) side.push({ element: nameOf(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })
    }
  }

  return { state, overlaps, covered, cutOff, sideways: side }
}

/* ------------------------------------------------------------ the plant */

/** The made-up faults the planted run must find, and the clean layouts it must not name, by `data-plant`. */
export const PLANT_FAULTS = { overlap: ['overlap-a', 'overlap-b'], covered: ['covered'], cut: ['cut'], grown: ['grown'] } as const
export const PLANT_CLEAN = { touch: ['touch-a', 'touch-b'], scrolled: ['scrolled'], icon: ['icon'] } as const

export interface PlantResult {
  ok: boolean
  found: Record<keyof typeof PLANT_FAULTS, boolean>
  clean: Record<keyof typeof PLANT_CLEAN, boolean>
  state: OverlapStateResult
}

/** Whether a read of the plant found each fault where it should, and named nothing clean. Pure: tested on plain findings. */
export function judgePlant(state: OverlapStateResult): PlantResult {
  const planted = (n: Named | undefined): string | undefined => n?.data['data-plant']
  const names = {
    overlap: state.overlaps.flatMap((o) => [planted(o.a), planted(o.b)]),
    covered: state.covered.map((c) => planted(c.control)),
    cut: state.cutOff.map((c) => planted(c.control)),
    sideways: state.sideways.map((s) => planted(s.element))
  }
  const anywhere = [...names.overlap, ...names.covered, ...names.cut, ...names.sideways, ...state.covered.map((c) => planted(c.by))]
  const found = {
    overlap: PLANT_FAULTS.overlap.every((n) => state.overlaps.some((o) => [planted(o.a), planted(o.b)].includes(n) && o.how === 'overlap')),
    covered: PLANT_FAULTS.covered.every((n) => names.covered.includes(n)),
    cut: PLANT_FAULTS.cut.every((n) => names.cut.includes(n)),
    grown: PLANT_FAULTS.grown.every((n) => names.cut.includes(n))
  }
  const clean = Object.fromEntries(
    (Object.entries(PLANT_CLEAN) as [keyof typeof PLANT_CLEAN, readonly string[]][]).map(([k, list]) => [k, !list.some((n) => anywhere.includes(n))])
  ) as PlantResult['clean']
  return { ok: Object.values(found).every(Boolean) && Object.values(clean).every(Boolean), found, clean, state }
}

/** The plant's markup: absolutely placed in a 160 px box, so it is the same at any column width over 200 px. */
const PLANT_HTML = `
  <button data-plant="overlap-a" style="position:absolute;left:0;top:0;width:60px;height:24px">a</button>
  <button data-plant="overlap-b" style="position:absolute;left:50px;top:6px;width:60px;height:24px">b</button>
  <button data-plant="covered" style="position:absolute;left:120px;top:0;width:60px;height:24px">c</button>
  <div style="position:absolute;left:112px;top:0;width:76px;height:24px;background:#888"></div>
  <div style="position:absolute;left:0;top:40px;width:100px;height:24px;overflow:hidden"><button data-plant="cut" style="display:block;width:120px;height:24px">cut</button></div>
  <button data-plant="touch-a" style="position:absolute;left:110px;top:40px;width:40px;height:24px">t</button>
  <button data-plant="touch-b" style="position:absolute;left:150px;top:40px;width:40px;height:24px">u</button>
  <div style="position:absolute;left:0;top:80px;width:100px;height:40px;overflow:auto"><div style="height:200px"></div><button data-plant="scrolled" style="display:block;height:20px">s</button></div>
  <button data-plant="icon" style="position:absolute;left:110px;top:80px;width:40px;height:24px"><svg width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16"></rect></svg></button>
  <div style="position:absolute;left:0;top:124px;width:100px;height:30px;overflow:hidden"><div data-plant="grown" style="height:60px;overflow:auto"><div style="height:40px"></div><button data-plant="grown-foot" style="display:block;height:20px">g</button></div></div>
`

/** Plant, read once, take out: whatever happens, the page is left as it was. */
export async function runPlant(): Promise<PlantResult> {
  const regions = windowRegions()
  const left = regions.left[0]
  if (!left) throw new Error('overlap check: no left column to plant in')
  const plant = document.createElement('div')
  plant.setAttribute('data-overlap-plant', '')
  plant.setAttribute('style', 'position:relative;flex:none;height:160px;overflow:visible')
  plant.innerHTML = PLANT_HTML
  left.insertBefore(plant, left.firstChild)
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return judgePlant(readPage('planted', regions))
  } finally {
    plant.remove()
  }
}

/** Where a run is: read it while the run goes on, and its result once it is done. */
export interface OverlapProgress {
  running: boolean
  done: number
  of: number
  state: string | null
  result?: OverlapResult
  error?: string
}

const progress = (p: OverlapProgress): void => {
  ;(window as unknown as { __forgeOverlapLast: OverlapProgress }).__forgeOverlapLast = p
}

/** What a state needed on screen and does not have, or null: a state read without it would be clean for the wrong reason. */
function unmet(s: OverlapState): string | null {
  const regions = windowRegions()
  if (s.dock && !regions.left.some((left) => left.querySelector('[data-dock]'))) return `${s.state}: the Trimmer dock is not on screen after its recipe and homes`
  if (s.foldout) {
    const face = document.querySelector('[data-foldout]')?.getAttribute('data-foldout') ?? null
    if (face !== s.foldout) return `${s.state}: the fold-out panel shows ${JSON.stringify(face)}, not ${JSON.stringify(s.foldout)}`
  }
  return null
}

export async function runOverlapCheck(options: OverlapOptions = {}): Promise<OverlapResult> {
  const started = performance.now()
  for (const name of options.states ?? []) {
    if (!OVERLAP_STATES.some((s) => s.state === name)) throw new Error(`overlap check: no state ${JSON.stringify(name)}; the states are ${OVERLAP_STATES.map((s) => s.state).join(', ')}`)
  }
  const chosen = OVERLAP_STATES.filter((s) => !options.states || options.states.includes(s.state))
  for (const s of chosen) for (const home of s.homes) if (!HOMES.includes(home)) throw new Error(`overlap check: ${s.state} names no home ${home}`)

  progress({ running: true, done: 0, of: chosen.length, state: null })
  const page = await censusPage()
  const states: OverlapStateResult[] = []
  const skipped: OverlapResult['skipped'] = []
  try {
    for (const [i, s] of chosen.entries()) {
      progress({ running: true, done: i, of: chosen.length, state: s.state })
      let close: (() => Promise<void>) | null = null
      try {
        await page.fresh()
        close = (await standCensusState(page.env, s.needs, s.homes)).close
        const missed = unmet(s)
        if (missed) throw new Error(missed)
        if (s.left) {
          const column = leftColumn.current
          if (!column) throw new Error(`${s.state}: the left column's Panel has no handle (App.tsx panelRef)`)
          const was = column.getSize().asPercentage
          column.resize(LEFT_MAX)
          try {
            await frames()
            const at = column.getSize().asPercentage
            if (Math.abs(at - parseFloat(LEFT_MAX)) > 0.5) throw new Error(`${s.state}: the left column went to ${at.toFixed(1)} %, not ${LEFT_MAX}`)
            states.push(readPage(s.state))
          } finally {
            column.resize(`${was}%`)
            await frames()
          }
        } else states.push(readPage(s.state))
      } catch (err) {
        skipped.push({ state: s.state, why: err instanceof Error ? err.message : String(err) })
      }
      if (close && !(options.keep && i === chosen.length - 1)) await close().catch(() => undefined)
    }
  } finally {
    if (!options.keep) await page.restore()
  }

  const count = (k: 'overlaps' | 'covered' | 'cutOff' | 'sideways'): number => states.reduce((n, s) => n + s[k].length, 0)
  const found = { overlaps: count('overlaps'), covered: count('covered'), cutOff: count('cutOff'), sideways: count('sideways') }
  const dirty = states.filter((s) => s.overlaps.length + s.covered.length + s.cutOff.length + s.sideways.length > 0).map((s) => s.state)
  const result: OverlapResult = {
    ok: skipped.length === 0 && dirty.length === 0,
    width: window.innerWidth,
    height: window.innerHeight,
    states,
    skipped,
    summary:
      `${states.length} states read at ${window.innerWidth}×${window.innerHeight}, ${skipped.length} skipped: ` +
      `${found.overlaps} overlaps, ${found.covered} covered, ${found.cutOff} cut off, ${found.sideways} sideways` +
      (dirty.length ? ` — in ${dirty.join(', ')}` : ''),
    ms: Math.round(performance.now() - started)
  }
  progress({ running: false, done: chosen.length, of: chosen.length, state: null, result })
  return result
}

type Last = { __forgeOverlapLast?: OverlapProgress }

/**
 * `window.__forgeOverlapCheck(options?)`. One run at a time: a second call
 * while one runs is refused, never started — its `censusPage()` would take
 * the first run's half-built state for the page's own and "restore" it.
 */
export function installOverlapCheck(): void {
  ;(window as unknown as { __forgeOverlapCheck: (o?: OverlapOptions) => Promise<OverlapResult | PlantResult> }).__forgeOverlapCheck = (options) => {
    const last = (window as unknown as Last).__forgeOverlapLast
    if (last?.running) {
      return Promise.reject(new Error(`an overlap check is already running (state ${last.done + 1} of ${last.of}${last.state ? `, ${last.state}` : ''}); read window.__forgeOverlapLast`))
    }
    if (options?.plant) return runPlant()
    const run = runOverlapCheck(options)
    run.catch((err: unknown) =>
      progress({ running: false, done: 0, of: 0, state: null, error: err instanceof Error ? err.message : String(err) })
    )
    return run
  }
}
