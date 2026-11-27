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
 *   (overflow hidden or clip) on a side that ancestor does not scroll.
 * - SIDEWAYS: an element of the left column or the panel whose scroll width
 *   runs past its width by more than a pixel.
 *
 * "Visible" is a control with a box, some of it on the window, and some of it
 * inside every scrolling or clipping box around it: a row scrolled out of its
 * list is not looked at (its centre would answer with whatever is in view).
 *
 * LEFT OUT, by design (`BY_DESIGN`, each with its reason): the Preview and the
 * timeline are outside the regions read (the picture's own overlays and
 * handles, the timeline's lanes, clips and handles are drawn over one another
 * on purpose); a tile's busy badge; the transcript rows' Start and End
 * handles, which sit over the rows' gutter; anything inside an open
 * full-window picker (position fixed). Pickers and overlays (the clip menu,
 * the settings panel) are not states this check opens.
 *
 * It puts the page back as it was when done (the census's `restore`), unless
 * `keep` is passed, which leaves the last state on screen to look at.
 */

import { HOMES, censusPage, standCensusState, toolHomeOf, windowRegions } from './census'
import { SHELF_TOOLS } from '../components/shelf/tools'
import { boxFrom, collisions, measurable, intersect, pastEdges, sideways, type Box } from './overlapGeometry'

/** One state: a census recipe, then the homes opened in turn. */
export interface OverlapState {
  state: string
  needs: string
  homes: readonly string[]
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
  { state: 'dock', needs: 'video-clip', homes: ['shelf'] },
  { state: 'dock-url', needs: 'video-clip', homes: ['url'] },
  { state: 'dock-transcript', needs: 'video-clip', homes: ['transcript'] },
  { state: 'dock-library', needs: 'video-clip', homes: ['library'] },
  { state: 'dock-director', needs: 'video-clip', homes: ['director'] },
  // The URL tile with a link: its rows, and each fold-down list unfolded.
  { state: 'url-link', needs: 'link-transcript', homes: ['url'] },
  { state: 'url-qualities', needs: 'link-qualities', homes: ['url'] },
  { state: 'url-formats', needs: 'link-formats', homes: ['url'] },
  { state: 'url-lengths', needs: 'link-best-lengths', homes: ['url'] },
  { state: 'url-range', needs: 'ingest-range', homes: ['url'] },
  // The panel beside the picture: the cards, the link's words, the selected clip's words with Find graphics' results.
  { state: 'panel-clips', needs: 'link-best-clips', homes: ['url', 'foldclips'] },
  { state: 'panel-link-words', needs: 'link-run', homes: ['url', 'foldtranscript'] },
  { state: 'panel-clip-words', needs: 'transcript-graphics-asr', homes: ['transcript', 'foldtranscript'] },
  { state: 'panel-both-words', needs: 'foldout-both-words', homes: ['url', 'foldtranscript'] },
  // The strips at the foot of the left column.
  { state: 'output-open', needs: 'none', homes: ['output'] },
  { state: 'export-open', needs: 'none', homes: ['export'] }
]

/**
 * What overlaps on purpose, and is not reported. Each entry is a selector; a
 * control inside (or matching) one is left out of every finding.
 */
export const BY_DESIGN: readonly { selector: string; why: string }[] = [
  { selector: '[data-busy-badge]', why: 'a tile’s busy badge sits on the tile’s corner on purpose (ui/Tile.tsx)' },
  { selector: '[data-transcript-rows] [data-handle]', why: 'the rows’ Start and End handles sit over the rows’ gutter on purpose (tools/TranscriptRows.tsx)' }
]

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
}

const round = (n: number): number => Math.round(n * 10) / 10
const cut = (text: string): string => (text.length > 40 ? `${text.slice(0, 39)}…` : text)

/** An element as a person could find it: its tag, its words or title, its data- attributes, its box. */
export function nameOf(el: Element): Named {
  const r = el.getBoundingClientRect()
  const said = (el.textContent ?? '').replace(/\s+/g, ' ').trim() || el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('placeholder') || ''
  const data: Record<string, string> = {}
  for (const a of el.attributes) if (a.name.startsWith('data-')) data[a.name] = a.value
  return { tag: el.tagName.toLowerCase(), text: cut(said), data, box: { x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height) } }
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
function clipper(el: Element, axis: 'x' | 'y'): Element | null {
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

/** One state read off the page. */
export function readPage(state: string): OverlapStateResult {
  const view: Box = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  const regions = windowRegions()
  const roots = Object.values(regions).flat()
  const seen = new Set<Element>()
  const controls: { el: Element; box: Box }[] = []
  for (const root of roots) {
    for (const el of [root, ...root.querySelectorAll(CONTROL)]) {
      if (seen.has(el) || !el.matches(CONTROL)) continue
      seen.add(el)
      if (!visible(el) || byDesign(el) || inFixed(el)) continue
      if (!measurable(boxFrom(el.getBoundingClientRect()), view)) continue
      const box = seenBox(el, view)
      if (box && measurable(box, view)) controls.push({ el, box })
    }
  }

  const overlaps = collisions(controls, (a, b) => a.el.contains(b.el) || b.el.contains(a.el)).map(({ a, b, how, shared }) => ({
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

  const cutOff: OverlapStateResult['cutOff'] = []
  for (const { el } of controls) {
    const own = boxFrom(el.getBoundingClientRect())
    for (const axis of ['x', 'y'] as const) {
      const at = clipper(el, axis)
      if (!at) continue
      const all = pastEdges(own, boxFrom(at.getBoundingClientRect()))
      const past = axis === 'x' ? { left: all.left, right: all.right } : { top: all.top, bottom: all.bottom }
      const kept = Object.fromEntries(Object.entries(past).filter(([, v]) => v !== undefined))
      if (Object.keys(kept).length > 0) cutOff.push({ control: nameOf(el), clip: nameOf(at), past: kept })
    }
  }

  const side: OverlapStateResult['sideways'] = []
  for (const root of [...regions.left, ...regions.panel]) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (!(el instanceof HTMLElement) || !visible(el) || byDesign(el)) continue
      // A text cut with an ellipsis is cut on purpose (a chapter chip's long title); its own box says so.
      if (getComputedStyle(el).textOverflow === 'ellipsis') continue
      if (sideways(el.scrollWidth, el.clientWidth)) side.push({ element: nameOf(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })
    }
  }

  return { state, overlaps, covered, cutOff, sideways: side }
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
      await page.fresh()
      let close: (() => Promise<void>) | null = null
      try {
        close = (await standCensusState(page.env, s.needs, s.homes)).close
        states.push(readPage(s.state))
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

export function installOverlapCheck(): void {
  ;(window as unknown as { __forgeOverlapCheck: (o?: OverlapOptions) => Promise<OverlapResult> }).__forgeOverlapCheck = (options) => {
    const run = runOverlapCheck(options)
    run.catch((err: unknown) =>
      progress({ running: false, done: 0, of: 0, state: null, error: err instanceof Error ? err.message : String(err) })
    )
    return run
  }
}
