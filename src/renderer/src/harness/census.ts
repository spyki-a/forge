import rowsText from '../../../../tests/fixtures/ui-census.json?raw'
import { DEFAULT_KEY } from '@shared/render/chromaKey'
import { defaultMask } from '@shared/render/mask'
import { DRAG_MIME } from '@shared/dragPayload'
import { transitionsFromMasks } from '@shared/transitions/registry'
import type { CatalogEntry } from '@shared/assets/catalog'
import type { PackListing } from '@shared/assets/pack'
import type { Clip, MediaAsset } from '@shared/timeline'
import type { Job } from '@shared/types'
import { REEL_RULE } from '@shared/automation/reel'
import { ONE_PHOTO_RULE } from '@shared/automation/onePhoto'
import { GRID_RULE } from '@shared/automation/grid'
import { STRIP_RULE } from '@shared/automation/strips'
import { FILMSTRIP_RULE } from '@shared/automation/filmstrip'
import { PROP_RULE } from '@shared/automation/apply'
import { SANDWICH_RULE } from '@shared/automation/sandwich'
import { SPINE_RULE } from '@shared/director/apply'
import { TRAY_MIN, TRAY_RAIL } from '@shared/curveTray'
import { useEditor, type ShelfToolId } from '../store'
import { useCatalog } from '../catalog'
import { usePacks } from '../packs'
import { SHELF_TOOLS } from '../components/shelf/tools'

/**
 * The UI census: is every control still on screen, in its own place?
 *
 * docs/WINDOW.md rebuilds the whole window over thirteen steps, and the rule it
 * is written against is WHERE-THINGS-ARE's: a feature that exists but cannot be
 * found is the same as one that does not exist. A test can say a component
 * still RENDERS a label; only the running page can say the label is somewhere a
 * person can get to. So each row of tests/fixtures/ui-census.json names a label,
 * the place it lives (`home`) and the state it needs (`needs`), and this walks
 * them: for every `needs` it starts from a fresh project, builds that state
 * through the store — never through the panels, which are the thing under
 * examination — opens the home, and counts.
 *
 * COUNTS, inside the home, and the count has to come out exact. The first
 * version searched `document.body.innerText` for a substring, and a verifier
 * hid some fifty controls one at a time without it noticing: "Key" was found
 * in "Keyframes", Director's "Direct" in "Director", the strip "Diagonal" in
 * the grid's "Diagonal sweep", a Props "Off" in the Inspector's Loudness Off,
 * the clip menu's "Cut" in the Inspector the right-click had just filled. So:
 *
 * - A row is looked for only inside its home's own elements (`homeRoots`), and
 *   an overlay's only inside the overlay that opened.
 * - A text row matches a rendered TEXT NODE whose whole text is the label —
 *   the source spelling, so CSS upper-case does not matter — and an attribute
 *   row an attribute whose whole value is. A row marked `part` (the static
 *   half of "3 words", "Get · 81 MB") may sit inside a longer text, but only
 *   at word boundaries.
 * - What is counted is how many carriers the row's state ADDS to the home over
 *   a fresh, empty project — and that must equal the controls the row stands
 *   for (`count`, default 1). Fewer is a missing control. More is reported too,
 *   as ambiguous: something else carries the label, so this control could go
 *   and the count would not notice.
 *
 * `(await __forgeCensus()).missing` is the rows that did not come out exact,
 * and an empty list has to be earned: a scenario that cannot be built THROWS,
 * with the reason, and so does a layout the home finders do not recognise,
 * because a census that cannot see the screen must not report a clean one.
 * Rows the harness cannot show at all carry `harnessOnly: false` and are
 * counted in `skipped`, never in `checked`; tests/uiCensus.test.ts pins those
 * to their file instead.
 *
 * Run it in the FRONTED tab. The bridge's synthetic video is recorded with
 * requestAnimationFrame, which a background tab never runs — so the media
 * import hangs there, and this says so instead of waiting forever.
 *
 * Not rowed, because they have no stable text to count (WINDOW.md §3): the
 * project path and unsaved dot; toasts (their words are the event's); the
 * panel dividers; Escape, the keyboard map and the menu router (no UI); a pool
 * tile's thumbnail, name and duration (its tooltip is rowed); a font tile
 * (its sample appears only once a font file loads, which the harness cannot
 * serve, and its title is the family's name); the Library's scroll sentinel
 * and PackList's progress bar; a transcript segment (timecode and spoken
 * words) and an editable word (its tooltip is rowed); MusicRange's name and
 * seconds (its handles are rowed); dropping onto the picture, and the reframe
 * rectangle; the waveform, tone-curve and keyframe-graph canvases and the
 * Waveform clip header (name, timecodes); the Trimmer dock's name in its
 * header (its tooltip's words are rowed; the name is the clip's, data, not
 * the interface's); on the timeline the ruler, clip
 * bodies, trim handles and ClipWaveform; and the app-shell loads (§3.20).
 */

/* ---------------------------------------------------------------- rows */

const MATCHES = ['text', 'title', 'aria-label', 'placeholder'] as const
type Match = (typeof MATCHES)[number]

/**
 * The Shelf's tools (step 9), each a home: the panel its tile opens, found as
 * the open tool's `data-shelf-panel` — never its header, which names the tool
 * in words some panels also use ("Grid split", "Director"). `openHome` opens
 * it through the store, from the home grid. The step-8 homes they replace:
 * `source` (the Upload / YouTube / Narration row), and the left panel's tabs
 * `media`, `library`, `transcript` and `create`.
 *
 * A home's name is letters only (the fixture's rule, tests/uiCensus.test.ts),
 * so a tool's home is its id's words run together, less any word that starts
 * with a digit: `beat-sync` is `beatsync`, `props-3d` is `props`.
 *
 * DERIVED from the registry, never written out. The table was hand-written
 * once, and a verifier swapped two of its pairs — director with beat-sync,
 * text with grade — and every test passed: each home was still there, only
 * opening the wrong tool. Between the eight automation tiles, which all
 * opened the same panel until step 10 split it, nothing on screen would have
 * said so either; now each opens its own (components/tools/), and a row filed
 * under the wrong one is missing. tests/renderer/censusHomes.test.ts holds the rule.
 */
type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
type HomeWord<Word extends string> = Word extends `${Digit}${string}` ? '' : Word
/** The same rule as `toolHomeOf`, for the compiler: `'props-3d'` gives `'props'`. */
type ToolHomeOf<Id extends string> = Id extends `${infer Word}-${infer Rest}`
  ? `${HomeWord<Word>}${ToolHomeOf<Rest>}`
  : HomeWord<Id>
type ToolHome = ToolHomeOf<ShelfToolId>

/** A tool's home: its id's words run together, less any that starts with a digit. */
export function toolHomeOf(id: ShelfToolId): ToolHome {
  return id
    .split('-')
    .filter((word) => !/^\d/.test(word))
    .join('') as ToolHome
}

/** Each tool home, and the tool whose panel it is. */
export const TOOL_HOMES = Object.fromEntries(SHELF_TOOLS.map((tool) => [toolHomeOf(tool.id), tool.id])) as Readonly<
  Record<ToolHome, ShelfToolId>
>
/**
 * The Shelf itself: its home grid of tiles, and an open tool's header (the
 * way back) — the whole Shelf, in whatever face the scenario put it.
 * `openHome` puts it on the home grid.
 */
const SHELF_HOME = 'shelf'
/**
 * The Curve tray's three faces, each a home of its own: closed to its rail,
 * open on Keys, open on Curves. One element, but three places a person looks —
 * and they cannot share a home, because a home's empty-project count is taken
 * once per home: on Curves an empty project already shows the property tabs
 * Zoom … Volume, which the Keys rows would then never be able to add to.
 */
const TRAY_FACES = { rail: 'rail', keys: 'keys', curve: 'curves' } as const
type TrayFace = (typeof TRAY_FACES)[keyof typeof TRAY_FACES]
/**
 * The OUTPUT and EXPORT strips under the Shelf (step 7), each a home in
 * two faces, as the tray is: open (`output`, `export`) — the body, the settings
 * themselves — and closed (`outputbar`, `exportbar`) — the header row, and what
 * a strip keeps in reach while shut: OUTPUT's one line, EXPORT's button and its
 * running job. Each face is a home of its own for the tray's reason: a home's
 * empty-project count is taken once, in one face.
 */
const STRIP_FACES = {
  output: { strip: 'output', open: true },
  outputbar: { strip: 'output', open: false },
  export: { strip: 'export', open: true },
  exportbar: { strip: 'export', open: false }
} as const
type StripFace = keyof typeof STRIP_FACES
/**
 * Homes that are on screen whatever the Shelf shows (the tray's and the
 * strips' once put in that face). `dock` is the Trimmer dock (step 8: the
 * waveform and the clip editor that were the `waveform` and `inspector` homes),
 * which is on screen only while a clip is selected or a Library sound is being
 * auditioned — the scenario's own state shows it, so it needs no opening; with
 * neither it is not there at all, and `fresh()` checks that it is not.
 */
const FIXED_HOMES = ['header', 'canvasbar', 'preview', 'toolbox', 'dock', 'rail', 'keys', 'curve', 'output', 'outputbar', 'export', 'exportbar', 'transport', 'timeline'] as const
/**
 * Overlays: counted only inside the one element that appeared when the scenario
 * opened it. `settings` is the panel under the header's gear (step 6), opened
 * through the store as the gear opens it.
 */
const OVERLAY_HOMES = ['clipmenu', 'newproject', 'shortcuts', 'settings'] as const

type Home = ToolHome | typeof SHELF_HOME | (typeof FIXED_HOMES)[number] | (typeof OVERLAY_HOMES)[number]
/** Every home a row may name. Exported for tests/renderer/censusHomes.test.ts. */
export const HOMES: readonly string[] = [...Object.keys(TOOL_HOMES), SHELF_HOME, ...FIXED_HOMES, ...OVERLAY_HOMES]
const isOverlay = (home: string): boolean => (OVERLAY_HOMES as readonly string[]).includes(home)

export interface CensusRow {
  label: string
  match: Match
  home: Home
  needs: string
  file: string
  line: number
  newHome: string
  /** The label is part of a longer text (a static half beside a number or a name). Matched at word boundaries. */
  part?: true
  /** How many controls with this label the row stands for, in its home and state (default 1). */
  count?: number
  /** False for a control the harness cannot show; the source-membership test pins it to its file. */
  harnessOnly?: false
  note?: string
}

export interface CensusMiss extends CensusRow {
  /** absent · not rendered (in the DOM but with no box) · ambiguous (more carriers than the row accounts for) */
  why: string
  /** What carries the label in the home now, whole or at a word boundary, each with how often: for following the miss up. */
  seen: string[]
}

/** One row's count, for following a miss up or for checking a new row before it goes in the fixture. */
export interface CensusTally {
  row: string
  expected: number
  /** Carriers in the row's state, and in an empty project, by the row's own rule. */
  count: number
  base: number
  /** In the DOM but with no box. */
  hidden: number
  /** The same two counts with the other rule (whole ⇄ part), to see whether flipping `part` would help or hurt. */
  other: [number, number]
}

export interface CensusResult {
  missing: CensusMiss[]
  checked: number
  /** Rows marked harnessOnly: false, not looked for here. */
  skipped: number
  /** The clip and asset ids each scenario built, for following a miss up by hand. */
  scenario: Record<string, Record<string, string>>
  /** With `trace`: every checked row's count. */
  trace?: CensusTally[]
  ms: number
}

export interface CensusOptions {
  /** Only these `needs` (for working on one scenario). The result then says nothing about the rest. */
  needs?: string[]
  /** Leave the last scenario on screen instead of putting the page back. */
  keep?: boolean
  /** Return every checked row's count, not only the misses. */
  trace?: boolean
}

/**
 * Every tool on the Shelf has a home of its own. The homes are derived from
 * the registry, so none can be missing or stray; what a new tool's id can
 * still do is run together into a home another tool already has (`beat-sync`
 * beside a `beatsync`), into one that is not letters only (`3d-props` gives
 * `props` — fine — but `3d` gives nothing), or into the name of a home that is
 * not a tool's (`output`, `settings`) — and then its rows would be counted in
 * the wrong place.
 */
function checkToolHomes(): void {
  const homes = SHELF_TOOLS.map((tool) => toolHomeOf(tool.id))
  const others: readonly string[] = [SHELF_HOME, ...FIXED_HOMES, ...OVERLAY_HOMES]
  const shared = homes.filter((home, i) => homes.indexOf(home) !== i || others.includes(home))
  const unlettered = homes.filter((home) => !/^[a-z]+$/.test(home))
  if (shared.length > 0 || unlettered.length > 0 || Object.keys(TOOL_HOMES).length !== SHELF_TOOLS.length) {
    throw new Error(
      `census: the Shelf's tools do not each make a home of their own — shared [${shared.join(', ')}], not letters only [${unlettered.join(', ')}]; change the id or toolHomeOf`
    )
  }
}

function parseRows(): CensusRow[] {
  checkToolHomes()
  let parsed: unknown
  try {
    parsed = JSON.parse(rowsText)
  } catch (err) {
    throw new Error(`census: tests/fixtures/ui-census.json does not parse — ${String(err)}`)
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('census: the fixture holds no rows')
  }
  return parsed.map((row: CensusRow, i) => {
    const where = `row ${i} (${JSON.stringify(row?.label)})`
    if (typeof row?.label !== 'string' || row.label.trim() === '') throw new Error(`census: ${where} has no label`)
    if (!MATCHES.includes(row.match)) throw new Error(`census: ${where} has match ${JSON.stringify(row.match)}`)
    if (!HOMES.includes(row.home)) throw new Error(`census: ${where} has an unknown home ${JSON.stringify(row.home)}`)
    if (!(row.needs in RECIPES)) {
      throw new Error(`census: ${where} needs ${JSON.stringify(row.needs)}, which no recipe here builds`)
    }
    if (row.count !== undefined && !(Number.isInteger(row.count) && row.count >= 2)) {
      throw new Error(`census: ${where} has count ${JSON.stringify(row.count)} — leave it out for one, or give a whole number from 2`)
    }
    return row
  })
}

const expected = (row: CensusRow): number => row.count ?? 1
const rowName = (row: CensusRow): string => `${row.label} [${row.home}/${row.needs}]`

/* ------------------------------------------------------------- waiting */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Two animation frames: React has committed and the browser has laid it out.
 *
 * A background tab never runs them, and a census that waited on one forever
 * would look exactly like a hang in the app. So it gives up, and says why.
 */
async function frames(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              'census: requestAnimationFrame did not fire in 3 s — the harness tab is in the background. Bring it to the front and run again.'
            )
          ),
        3000
      )
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  } finally {
    clearTimeout(timer)
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`census: ${what} did not finish in ${ms / 1000} s`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------ matching */

/*
 * The same two functions are in tests/uiCensus.test.ts, which applies the same
 * rule to the source. Change both or neither.
 */

/** Whitespace as the screen shows it: runs collapsed, ends trimmed. */
const norm = (text: string): string => text.replace(/\s+/g, ' ').trim()

const WORD = /[\p{L}\p{N}]/u

/** `label` inside `text`, but not inside a longer word: "Key" is not in "Keyframes", nor "Split" in "Splits". */
function bounded(text: string, label: string): boolean {
  const first = WORD.test(label[0])
  const last = WORD.test(label[label.length - 1])
  for (let at = text.indexOf(label); at !== -1; at = text.indexOf(label, at + 1)) {
    const before = at > 0 ? text[at - 1] : ''
    const after = text[at + label.length] ?? ''
    if ((!first || !WORD.test(before)) && (!last || !WORD.test(after))) return true
  }
  return false
}

const fits = (text: string, label: string, part: boolean): boolean => text === label || (part && bounded(text, label))

/* ------------------------------------------------------------- homes */

const only = <T extends Element>(found: ArrayLike<T>, what: string): T => {
  if (found.length !== 1) throw new Error(`census: expected one ${what}, found ${found.length} — the layout changed; update homeRoots`)
  return found[0]
}

const childrenOf = (el: Element | null | undefined, n: number, what: string): Element[] => {
  const kids = el ? [...el.children] : []
  if (kids.length !== n) throw new Error(`census: expected ${what} to have ${n} parts, found ${kids.length} — the layout changed; update homeRoots`)
  return kids
}

/** A react-resizable-panels Group's own panels, each as the element its content is in. */
function panels(group: Element | null, n: number, what: string): Element[] {
  if (!group) throw new Error(`census: no panel group for ${what}`)
  const found = [...group.querySelectorAll(':scope > [data-panel]')]
  if (found.length !== n) throw new Error(`census: expected ${n} panels in ${what}, found ${found.length} — the layout changed; update homeRoots`)
  // <div data-panel><div>{children}</div></div>: the content's own root is two down.
  return found.map((panel, i) => {
    const content = panel.firstElementChild?.firstElementChild
    if (!content) throw new Error(`census: panel ${i} of ${what} is empty`)
    return content
  })
}

const positioned = (el: Element): string => getComputedStyle(el).position

/**
 * The left column's holder (step 8): one vertical Group of the Shelf (the left
 * panel's tabs until step 9) and, only while there is something to trim, the
 * Trimmer dock under it.
 *
 * Told apart by `data-dock` on the dock's root, never by its words. Anything
 * else throws: no Group, no panel or three, the dock first, a second panel
 * that is not the dock, or a `data-dock` anywhere but here — a dock drawn
 * outside its home would be counted in none.
 */
function leftSplit(holder: Element): { shelf: Element; dock: Element | null } {
  const [group] = childrenOf(holder, 1, 'the left column’s holder')
  if (!group.matches('[data-group]')) {
    throw new Error('census: the left column’s holder holds no panel group — the layout changed; update homeRoots')
  }
  const n = group.querySelectorAll(':scope > [data-panel]').length
  if (n !== 1 && n !== 2) {
    throw new Error(`census: expected the Shelf, and the dock under it at most, in the left column; found ${n} panels — the layout changed; update homeRoots`)
  }
  const [shelf, dock = null] = panels(group, n, 'the left column’s split')
  if (shelf.matches('[data-dock]')) {
    throw new Error('census: the left column’s first panel is the Trimmer dock, not the Shelf — the layout changed; update homeRoots')
  }
  if (dock && !dock.matches('[data-dock]')) {
    throw new Error('census: the left column’s second panel is not the Trimmer dock — the layout changed; update homeRoots')
  }
  const docks = document.querySelectorAll('[data-dock]').length
  if (docks !== (dock ? 1 : 0)) {
    throw new Error(`census: ${docks} [data-dock] on the page and ${dock ? 'one' : 'none'} in the left column — the layout changed; update homeRoots`)
  }
  return { shelf, dock }
}

/**
 * What the Shelf is showing, by what it says: `data-shelf-tool` on its root is
 * "home" (the grid, one child) or the open tool's id (two children: the
 * header, then the panel, which carries `data-shelf-panel`). Never by its
 * words — the tiles' labels and the panels' controls are what is counted.
 * Anything else throws, and so does a second Shelf or a panel outside this
 * one: either would be counted in no home.
 */
function shelfFace(shelf: Element): { showing: string; panel: Element | null } {
  const showing = shelf.getAttribute('data-shelf-tool')
  if (!showing) {
    throw new Error('census: the left column’s first panel is not the Shelf (no data-shelf-tool on it) — the layout changed; update homeRoots')
  }
  if (document.querySelectorAll('[data-shelf-tool]').length !== 1) {
    throw new Error(`census: ${document.querySelectorAll('[data-shelf-tool]').length} [data-shelf-tool] on the page — expected the one Shelf; update homeRoots`)
  }
  const panelsOnPage = document.querySelectorAll('[data-shelf-panel]').length
  if (showing === 'home') {
    const [grid] = childrenOf(shelf, 1, 'the Shelf’s home grid')
    if (panelsOnPage !== 0 || grid.matches('[data-shelf-panel]')) {
      throw new Error('census: the Shelf says it shows its home grid and a tool’s panel is on the page — the layout changed; update homeRoots')
    }
    return { showing, panel: null }
  }
  if (!SHELF_TOOLS.some((tool) => tool.id === showing)) {
    throw new Error(`census: the Shelf says it shows ${JSON.stringify(showing)}, which is no tool in shelf/tools.ts`)
  }
  const [head, panel] = childrenOf(shelf, 2, `the Shelf open on ${showing}`)
  if (head.matches('[data-shelf-panel]') || !panel.matches('[data-shelf-panel]') || panelsOnPage !== 1) {
    throw new Error(`census: the Shelf open on ${showing} is not [header, panel] — the layout changed; update homeRoots`)
  }
  return { showing, panel }
}

/**
 * Today's window, found by its structure rather than by any label — the labels
 * are what is under examination. Every step that moves a panel has to update
 * this, and a finder that no longer recognises the layout throws.
 *
 *   header · [ left column | right column ], both the full height under the header
 *   left = holder [ Shelf panel | Trimmer dock panel ] / OUTPUT strip / EXPORT strip
 *     (step 7: the two strips under the holder, each told apart by its
 *     `data-strip`; `openHome` puts a strip in the face asked for. Step 8:
 *     the Inspector's column is gone; the holder is a vertical Group of the
 *     left panel and, only while there is something to trim, the dock, told
 *     apart by its `data-dock`; the left column runs full height. Step 9: the
 *     left panel is the Shelf — its home grid, or an open tool's header over
 *     its panel (`shelfFace`) — and the source row that headed the column is
 *     three of its tiles, so nothing sits above the holder)
 *   right = centre / [ transport + timeline | curve tray ]
 *   centre = canvas bar / [ toolbox + preview ]   (step 4: the bar over the picture row)
 *   curve tray = the lower row's second panel, whatever its width: a 28 px
 *     rail when closed, a few hundred px open (step 5). The rail, Keys and
 *     Curves homes are all its root; `openHome` puts it in the right face.
 */
function layout(): Record<Exclude<Home, (typeof OVERLAY_HOMES)[number]>, Element[]> {
  const header = only(document.querySelectorAll('#root .drag-region'), 'header (.drag-region)')
  const app = header.parentElement
  if (!app) throw new Error('census: the header has no parent')
  const group = only(app.querySelectorAll(':scope > [data-group]'), 'panel group under the header')
  if (group.previousElementSibling !== header) {
    throw new Error('census: something sits between the header and the panels — nothing has since step 8; update homeRoots')
  }

  // The header's home: the bar, and what sits above it in the app's own flow — the
  // recovery banner, the Exit full screen pill. Not the full-window overlays.
  const kids = [...app.children]
  const chrome = kids.slice(0, kids.indexOf(group)).filter((el) => positioned(el) !== 'fixed')

  // The two columns. The right one is a Group itself, directly inside its
  // panel, of the centre over the lower row — which is a Group again.
  const [left, right] = panels(group, 2, 'the window')
  if (left.matches('[data-group]')) throw new Error('census: the left column is a panel group — the layout changed; update homeRoots')
  const [middle, lower] = panels(right.matches('[data-group]') ? right : null, 2, 'the right column')
  if (middle.matches('[data-group]')) throw new Error('census: the centre is a panel group — the layout changed; update homeRoots')
  const [timelineColumn, tray] = panels(lower.matches('[data-group]') ? lower : null, 2, 'the lower row')
  // By what the tray says it is showing, never by its words. A second panel
  // that does not say is something else in the tray's place.
  if (!(Object.values(TRAY_FACES) as string[]).includes(tray.getAttribute('data-curve-tray') ?? '')) {
    throw new Error('census: the lower row’s second panel is not the Curve tray — the layout changed; update homeRoots')
  }
  // The left column: the Shelf's and the dock's holder, then OUTPUT, then
  // EXPORT, and nothing above them. By what each strip says it is, never by
  // its words — those are being counted.
  const [holder, output, exporting] = childrenOf(left, 3, 'the left column')
  for (const [strip, id] of [[output, 'output'], [exporting, 'export']] as const) {
    if (strip.getAttribute('data-strip') !== id) {
      throw new Error(`census: the left column has no ${id.toUpperCase()} strip where it should be — the layout changed; update homeRoots`)
    }
  }
  const { shelf, dock } = leftSplit(holder)
  const face = shelfFace(shelf)
  // A tool's home is its panel while that tool is the one open, and nowhere
  // otherwise: a row counted in a tool that is not open is absent.
  const tools = Object.fromEntries(
    (Object.entries(TOOL_HOMES) as [ToolHome, ShelfToolId][]).map(([home, id]) => [
      home,
      face.showing === id && face.panel ? [face.panel] : []
    ])
  ) as Record<ToolHome, Element[]>
  // The centre column: the canvas bar, then the picture row under it. By
  // position, never by the bar's words — those are what is being counted.
  const [canvasbar, pictureRow] = childrenOf(middle, 2, 'the centre column')
  const [toolbox, preview] = childrenOf(pictureRow, 2, 'the picture row')
  // The bar has two or three parts of its own, so a bar moved BELOW the picture
  // would still split as "two children" here; the preview canvas says which is which.
  only(preview.querySelectorAll('canvas[data-forge-preview="1"]'), 'preview canvas under the canvas bar')
  const [transport, timeline] = childrenOf(timelineColumn, 2, 'the timeline column')

  return {
    header: chrome,
    shelf: [shelf],
    ...tools,
    // Not on screen: no roots, so a row counted here is "absent — its home is not on screen".
    dock: dock ? [dock] : [],
    canvasbar: [canvasbar],
    toolbox: [toolbox],
    preview: [preview],
    transport: [transport],
    timeline: [timeline],
    rail: [tray],
    keys: [tray],
    curve: [tray],
    output: [output],
    outputbar: [output],
    export: [exporting],
    exportbar: [exporting]
  }
}

function homeRoots(home: Home): Element[] {
  if (isOverlay(home)) throw new Error(`census: ${home} is an overlay; its root is whatever opened`)
  return layout()[home as Exclude<Home, (typeof OVERLAY_HOMES)[number]>]
}

/** Every fixed-position element: an overlay is the one that was not there before it opened. */
function fixedElements(): Set<Element> {
  return new Set([...document.body.querySelectorAll('*')].filter((el) => positioned(el) === 'fixed'))
}

/** The overlay that opened: the new fixed elements, outermost only. More than one is a scenario that opened too much. */
function overlayRoots(before: Set<Element>, home: string): Element[] {
  const added = [...fixedElements()].filter((el) => !before.has(el))
  const outer = added.filter((el) => !added.some((other) => other !== el && other.contains(el)))
  if (outer.length > 1) {
    throw new Error(`census: opening ${home} put ${outer.length} new overlays on screen; expected one`)
  }
  return outer
}

/* ------------------------------------------------------------- looking */

const SVG = 'http://www.w3.org/2000/svg'

/** It has a box, and CSS does not hide it. Opacity is not hiding: a hover-revealed button is still there to find. */
function rendered(el: Element): boolean {
  if (el.getClientRects().length === 0) return false
  const check = (el as Element & { checkVisibility?: (options?: { visibilityProperty?: boolean }) => boolean })
    .checkVisibility
  return check ? check.call(el, { visibilityProperty: true }) : true
}

interface Carrier {
  value: string
  shown: () => boolean
}

/**
 * What a person could read in a set of roots, collected once per look.
 *
 * Text is taken from text NODES, not innerText: a node is the unit React
 * renders a literal as, so "3 words" from `{n} words` is the nodes "3" and
 * " words", and a label is matched against the whole of one. It is also the
 * source spelling — innerText would read a `uppercase` header as EXPORTS.
 */
function screen(roots: Element[]): ((row: CensusRow, part: boolean) => { shown: number; hidden: number }) & {
  seen: (row: CensusRow) => string[]
} {
  const memo = new Map<string, Carrier[]>()

  const texts = (): Carrier[] => {
    const out: Carrier[] = []
    const seen = new Set<Node>()
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (seen.has(node)) continue
        seen.add(node)
        const parent = node.parentElement
        // An SVG <title> is a tooltip, matched as one; the rest are not text on screen.
        if (!parent || parent.closest('title, style, script, template, textarea')) continue
        const value = norm(node.nodeValue ?? '')
        if (!value) continue
        const text = node
        out.push({
          value,
          shown: () => {
            // An option is on screen when its select is: a person opens it to read the rest.
            const select = parent.closest('select')
            if (select) return rendered(select)
            if (!rendered(parent)) return false
            const range = document.createRange()
            range.selectNodeContents(text)
            return range.getClientRects().length > 0
          }
        })
      }
    }
    return out
  }

  const attributes = (attr: string): Carrier[] => {
    const out: Carrier[] = []
    const seen = new Set<Element>()
    for (const root of roots) {
      for (const el of [root, ...root.querySelectorAll(`[${attr}]`)]) {
        if (seen.has(el) || !el.hasAttribute(attr)) continue
        seen.add(el)
        out.push({ value: norm(el.getAttribute(attr) ?? ''), shown: () => rendered(el) })
      }
      // An SVG shape's tooltip is a <title> child, not an attribute: the volume envelope's is.
      if (attr === 'title') {
        for (const el of root.querySelectorAll('title')) {
          if (el.namespaceURI !== SVG || !el.parentElement || seen.has(el)) continue
          seen.add(el)
          const shape = el.parentElement
          out.push({ value: norm(el.textContent ?? ''), shown: () => rendered(shape) })
        }
      }
    }
    return out
  }

  const pool = (match: Match): Carrier[] => {
    let found = memo.get(match)
    if (!found) {
      found = match === 'text' ? texts() : attributes(match)
      memo.set(match, found)
    }
    return found
  }

  const count = (row: CensusRow, part: boolean): { shown: number; hidden: number } => {
    let shown = 0
    let hidden = 0
    for (const carrier of pool(row.match)) {
      if (!fits(carrier.value, row.label, part)) continue
      if (carrier.shown()) shown++
      else hidden++
    }
    return { shown, hidden }
  }

  const seen = (row: CensusRow): string[] => {
    const times = new Map<string, number>()
    for (const carrier of pool(row.match)) {
      if (!fits(carrier.value, row.label, true)) continue
      const key = `${carrier.value.slice(0, 80)}${carrier.shown() ? '' : ' (hidden)'}`
      times.set(key, (times.get(key) ?? 0) + 1)
    }
    return [...times].map(([value, n]) => (n > 1 ? `${value} ×${n}` : value))
  }

  return Object.assign(count, { seen })
}

type Counter = ReturnType<typeof screen>

interface Base {
  /** By the row's own rule, and by the other one (for the trace). */
  own: number
  other: number
}

/**
 * The rows of one home that do not come out exact.
 *
 * Most rows are there at once; some wait on a load (peaks, a rasterised card),
 * so a miss is asked again for `patience` ms before it counts.
 */
async function look(
  rows: CensusRow[],
  roots: () => Element[],
  base: Map<CensusRow, Base>,
  patience = 2000
): Promise<{ misses: { row: CensusRow; why: string; seen: string[] }[]; tallies: CensusTally[] }> {
  const final = new Map<CensusRow, CensusTally>()
  const tally = (row: CensusRow, count: Counter): CensusTally => {
    const own = count(row, Boolean(row.part))
    const other = count(row, !row.part)
    const b = base.get(row) ?? { own: 0, other: 0 }
    return { row: rowName(row), expected: expected(row), count: own.shown, base: b.own, hidden: own.hidden, other: [other.shown, b.other] }
  }
  const exact = (t: CensusTally): boolean => t.count - t.base === t.expected

  let pending = rows
  let empty = false
  let last: Counter | null = null
  const deadline = performance.now() + patience
  for (;;) {
    const found = roots()
    empty = found.length === 0
    const count = screen(found)
    last = count
    for (const row of pending) final.set(row, tally(row, count))
    pending = pending.filter((row) => !exact(final.get(row)!))
    if (pending.length === 0 || performance.now() > deadline) break
    await sleep(100)
  }

  const misses = pending.map((row) => {
    const t = final.get(row)!
    const added = t.count - t.base
    const why = empty
      ? 'absent — its home is not on screen'
      : added > t.expected
        ? `ambiguous — ${t.count} on screen here, ${t.base} of them in an empty project; the row accounts for ${t.expected}`
        : t.hidden > 0
          ? 'not rendered'
          : 'absent'
    return { row, why, seen: last ? last.seen(row) : [] }
  })
  return { misses, tallies: rows.map((row) => final.get(row)!) }
}

/* ------------------------------------------------------------ clicking */

const editor = (): ReturnType<typeof useEditor.getState> => useEditor.getState()

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')]
}

function buttonByText(test: (text: string) => boolean, what: string): HTMLButtonElement {
  const found = buttons().find((b) => test((b.textContent ?? '').trim()))
  if (!found) throw new Error(`census: no button for ${what}`)
  return found
}

async function click(button: HTMLElement): Promise<void> {
  button.click()
  await frames()
}

/**
 * Put the Shelf on its home grid (null) or open one tool, through the store as
 * a tile and the ← button do, and wait for the Shelf to say it shows it.
 */
async function shelfShows(tool: ShelfToolId | null): Promise<void> {
  editor().setShelfTool(tool)
  const want = tool ?? 'home'
  const deadline = performance.now() + 2000
  for (;;) {
    await frames()
    const says = layout().shelf[0].getAttribute('data-shelf-tool')
    if (says === want) return
    if (performance.now() > deadline) throw new Error(`census: the Shelf was asked for ${want} and shows ${says}`)
  }
}

async function escape(): Promise<void> {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
  await frames()
}

/**
 * Open a home. A Shelf tool is opened from the home grid, never straight from
 * another tool or from itself.
 *
 * Going home unmounts the open panel, which is the only way to reset its local
 * state (the Library's drawer, Director's More) — so a tool is never left open
 * from one scenario to the next to keep whatever the last one did.
 */
async function openHome(home: Home): Promise<void> {
  if (home in TRAY_FACES) return trayShows(TRAY_FACES[home as keyof typeof TRAY_FACES])
  if (home in STRIP_FACES) return stripShows(home as StripFace)
  if (home === SHELF_HOME) return shelfShows(null)
  if (!(home in TOOL_HOMES)) return
  await shelfShows(null)
  await shelfShows(TOOL_HOMES[home as ToolHome])
}

/**
 * Put the Curve tray in one face, through the store as its own buttons do, and
 * wait for the page to show it.
 *
 * The width is measured as well as the face: an open tray left inside the
 * 28 px rail — the Panel not following the store — would still give every
 * text node in it a box, and every row would be counted as found.
 */
async function trayShows(face: TrayFace): Promise<void> {
  if (face === 'rail') {
    editor().setTrayOpen(false)
  } else {
    editor().setTrayTab(face)
    editor().setTrayOpen(true)
  }
  const deadline = performance.now() + 2000
  for (;;) {
    await frames()
    const tray = layout().curve[0]
    const shows = tray.getAttribute('data-curve-tray')
    const width = tray.closest('[data-panel]')?.getBoundingClientRect().width ?? 0
    const right = face === 'rail' ? width <= TRAY_RAIL + 2 : width >= TRAY_MIN - 2
    if (shows === face && right) return
    if (performance.now() > deadline) {
      throw new Error(`census: the Curve tray was asked for ${face} and shows ${shows} in ${Math.round(width)} px`)
    }
  }
}

/**
 * Put a strip in one face, through the store as its triangle does, and wait
 * for the page to show it.
 *
 * Read two ways, as the tray's width is: `data-open` is what the strip says it
 * is showing, and the body's own box is what is on screen. A body left showing
 * under a header that says closed would put every one of its rows on screen in
 * the closed face, and they would be counted there.
 */
async function stripShows(face: StripFace): Promise<void> {
  const { strip, open } = STRIP_FACES[face]
  if (strip === 'output') editor().setOutputOpen(open)
  else editor().setExportOpen(open)
  const deadline = performance.now() + 2000
  for (;;) {
    await frames()
    const root = layout()[strip][0]
    const says = root.getAttribute('data-open')
    const body = root.querySelector('[data-strip-body]')
    const shown = body !== null && rendered(body)
    if (says === String(open) && shown === open) return
    if (performance.now() > deadline) {
      throw new Error(
        `census: the ${strip.toUpperCase()} strip was asked to be ${open ? 'open' : 'closed'} and says data-open=${says}, its body ${body ? (shown ? 'shown' : 'hidden') : 'missing'}`
      )
    }
  }
}

/**
 * No Trimmer dock: nothing selected, nothing auditioned, and none on screen.
 *
 * Every scenario starts here (`fresh`), and the Library's audition ends here
 * too. It stands for the rows that said "nothing to trim" in words — the
 * Inspector's "No clip selected" and "Select a clip", the waveform's "Select a
 * clip, or pick a sound in the Library…" — which the dock, hidden then, no
 * longer has anywhere to say (step 8). And a dock left on screen would put its
 * carriers into every home's empty-project count. So it throws, as a layout the
 * finders do not recognise does, rather than count over it.
 */
async function noDock(): Promise<void> {
  const deadline = performance.now() + 2000
  for (;;) {
    const { selectedClipId, audition } = editor()
    const shown = layout().dock.length > 0
    if (selectedClipId === null && !audition && !shown) return
    if (performance.now() > deadline) {
      throw new Error(
        selectedClipId !== null
          ? `census: clip ${selectedClipId} is still selected in a fresh project`
          : audition
            ? `census: the Library is closed and "${audition.name}" is still being auditioned — Library.tsx ends the audition when it unmounts, or the Trimmer dock never closes on its own`
            : 'census: the Trimmer dock is on screen with nothing selected and nothing auditioned — it should not be drawn at all then (WINDOW.md §3.18)'
      )
    }
    await frames()
  }
}

/** The curve panel keeps its Motion / Colour tab in local state; put it back on Motion. */
async function curveOnMotion(): Promise<void> {
  const tab = buttons().find((b) => (b.textContent ?? '').trim() === 'motion')
  if (tab) await click(tab)
}

const menu = (command: string): void =>
  (window as unknown as { forgeMenu: (command: string) => void }).forgeMenu(command)
const fullScreen = (on: boolean): void =>
  (window as unknown as { forgeFullScreen: (on: boolean) => void }).forgeFullScreen(on)

/* ------------------------------------------------------------ building */

interface Env {
  /** What the bridge's pickMedia made: three stills and one recorded video. */
  paths: string[]
}

interface Built {
  /** Something to do after the home is open: open an overlay, a picker, a drawer. */
  show?: () => Promise<void>
  /** Undo `show`, where leaving it would spill into the next scenario. */
  close?: () => Promise<void>
  ids?: Record<string, string>
}

interface Media {
  photos: MediaAsset[]
  video: MediaAsset
}

/**
 * The synthetic media, imported into the fresh project.
 *
 * The harness records its video without sound (bridge `asset()` sets hasAudio
 * only for audio), and half the clip editor — Sound, fades, Voice, Detach —
 * exists only for a clip that has some. So the video is marked as having it:
 * this is "a video with sound", which WINDOW.md §6 Step 0 asks for by name.
 */
async function media(env: Env): Promise<Media> {
  await editor().importAssets(env.paths)
  const assets = editor().project.assets
  const photos = assets.filter((a) => a.kind === 'image')
  const video = assets.find((a) => a.kind === 'video')
  if (photos.length < 3 || !video) {
    throw new Error(
      `census: the import made ${photos.length} photos and ${video ? 'a' : 'no'} video — expected three and one`
    )
  }
  editor().update((p) => ({
    ...p,
    assets: p.assets.map((a) => (a.id === video.id ? { ...a, hasAudio: true, name: 'census video' } : a))
  }))
  return { photos, video: { ...video, hasAudio: true, name: 'census video' } }
}

const clipById = (id: string): Clip => {
  const found = editor().project.clips.find((c) => c.id === id)
  if (!found) throw new Error(`census: clip ${id} is not on the timeline`)
  return found
}

/** The clips the last action added. */
function addedSince(before: Set<string>, what: string): string {
  const made = editor().project.clips.filter((c) => !before.has(c.id))
  if (made.length === 0) throw new Error(`census: ${what} added no clip`)
  return made[made.length - 1].id
}

/** Onto the first video (or audio) track with room, after what is there. */
function place(assetId: string): string {
  const before = new Set(editor().project.clips.map((c) => c.id))
  editor().addAssetToTimeline(assetId)
  return addedSince(before, `placing asset ${assetId}`)
}

function topVideoTrack(): string {
  const video = editor().project.tracks.filter((t) => t.kind === 'video' && !t.locked)
  const top = video[video.length - 1]
  if (!top) throw new Error('census: the project has no video track')
  return top.id
}

async function made(promise: Promise<string | null>, what: string): Promise<string> {
  const id = await promise
  if (!id) throw new Error(`census: ${what} returned no clip`)
  return id
}

function focus(clipId: string, offset = 5): void {
  editor().select(clipId)
  editor().setPlayhead(clipById(clipId).start + offset)
}

function patchClip(clipId: string, patch: Partial<Clip>): void {
  editor().update((p) => ({ ...p, clips: p.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) }))
}

async function photoClip(env: Env): Promise<{ m: Media; P: string }> {
  const m = await media(env)
  const P = place(m.photos[0].id)
  editor().select(P)
  editor().setPlayhead(10)
  return { m, P }
}

async function videoClip(env: Env): Promise<{ m: Media; V: string }> {
  const m = await media(env)
  const V = place(m.video.id)
  focus(V, 0)
  return { m, V }
}

/** A depth bake as the sidecar would leave it; `subject` makes the front plane a person. */
function bakeDepth(assetId: string, subject: boolean): void {
  editor().update((p) => ({
    ...p,
    parallax: {
      ...p.parallax,
      [assetId]: {
        width: 1600,
        height: 1067,
        separated: true,
        spread: 0.5,
        subject,
        layers: [
          { file: 'census-far.png', index: 0, depth: 0, coverage: 1 },
          { file: 'census-near.png', index: 1, depth: 1, coverage: 0.3 }
        ]
      }
    }
  }))
}

const SHAKE = { kind: 'shake' as const, amount: 0.15, hz: 12, decay: 0.5 }
const MOVE = { kind: 'kenburns' as const, direction: 'in' as const, amount: 0.15 }

function job(id: string, presetId: string, status: Job['status'], progress: number): Job {
  const now = Date.now()
  return {
    id,
    presetId,
    input: '',
    inputName: `census ${id}`,
    output: status === 'done' ? `/census/${id}.mp4` : '',
    params: {},
    status,
    progress,
    speed: null,
    error: null,
    startedAt: now - 8000,
    finishedAt: status === 'done' ? now - 1000 : null
  }
}

let silence: string | null = null

/** One second of silence as a WAV blob, for a song the preview's audio element can actually open. */
function silentWav(seconds = 1, rate = 8000): string {
  if (silence) return silence
  const samples = seconds * rate
  const view = new DataView(new ArrayBuffer(44 + samples * 2))
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples * 2, true)
  silence = URL.createObjectURL(new Blob([view.buffer], { type: 'audio/wav' }))
  return silence
}

/** Put entries into the catalog, as an installed pack would. Root '' so no tile asks the server for a file. */
function catalogWith(entries: CatalogEntry[]): void {
  useCatalog.setState({
    catalog: { version: 2, generatedAt: '', scannedFrom: '', entries } as unknown as NonNullable<
      ReturnType<typeof useCatalog.getState>['catalog']
    >,
    root: '',
    exists: true
  })
}

function stickers(n: number): CatalogEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `census-sticker-${i}`,
    kind: 'sticker' as const,
    name: `census sticker ${i}`,
    file: `stickers/census-${i}.mp4`,
    tags: [],
    meta: {
      form: 'clip',
      matte: '',
      category: i % 2 === 0 ? '01_Census_Faces' : '02_Census_Reactions',
      width: 100,
      height: 100,
      durationMs: 1000,
      loops: false,
      hasAudio: false
    } as unknown as CatalogEntry['meta']
  }))
}

function transitions(n: number): CatalogEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `census-transition-${i}`,
    kind: 'transition' as const,
    name: `census transition ${i}`,
    file: `transitions/census-${i}.png`,
    tags: [],
    meta: { maskType: 'image', group: 'census' } as CatalogEntry['meta']
  }))
}

function sfx(n: number): CatalogEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `census-sfx-${i}`,
    kind: 'sfx' as const,
    name: `census sfx ${i}`,
    file: `sfx/census-${i}.wav`,
    tags: [],
    meta: { durationMs: 800 } as unknown as CatalogEntry['meta']
  }))
}

/** A pack as the list from main describes one. Nothing here is fetched: the list is set, never loaded. */
function pack(id: string, state: PackListing['state']): PackListing {
  return {
    id: `census-${id}`,
    name: `Census ${id}`,
    summary: `census pack, ${id}`,
    group: 'stickers',
    version: 2,
    url: '',
    sha256: '',
    bytes: 1_000_000,
    state
  } as PackListing
}

function packsAre(patch: Partial<ReturnType<typeof usePacks.getState>>): void {
  usePacks.setState({ loaded: true, loading: false, error: null, inFlight: new Map(), failed: new Map(), ...patch })
}

/** The URL tile's form, as the store holds it; opening the `url` home shows it. */
async function youtube(patch: Parameters<ReturnType<typeof useEditor.getState>['setIngest']>[0]): Promise<void> {
  editor().setIngest(patch)
}

/**
 * The settings panel, opened through the store as the header's gear opens it —
 * after `prepare` has put the state it should show, and with `config` changing
 * what the model servers offer.
 *
 * The panel asks the model servers again when it opens. Its answer is let land
 * first and then asked for once more, in order, so neither can arrive after
 * `config` and overwrite it. Closed by Escape, which is the panel's own way out.
 */
function settingsPanel(
  options: {
    prepare?: () => void
    config?: (c: NonNullable<ReturnType<typeof useEditor.getState>['directorConfig']>) => void
  } = {}
): Built {
  return {
    show: async () => {
      options.prepare?.()
      editor().setSettingsOpen(true)
      await frames()
      await editor().refreshDirector()
      const current = editor().directorConfig
      if (!current) throw new Error('census: the settings panel has no model config')
      if (options.config) {
        const next = { ...current, ollama: { ...current.ollama }, openai: { ...current.openai } }
        options.config(next)
        useEditor.setState({ directorConfig: next })
      }
    },
    close: escape
  }
}

/**
 * One recipe per `needs` value: the state a row's control appears in.
 *
 * Every recipe starts from `fresh()` — a new project, nothing imported or
 * selected, the store and catalog as the page had them — because several rows
 * are only on screen when something is ABSENT (the empty pool, "No music on
 * the timeline", "Nothing transcribed yet"), and building one big scenario
 * makes them vanish.
 */
const RECIPES: Record<string, (env: Env) => Promise<Built>> = {
  /* nothing at all: a new, empty project */
  none: async () => ({}),

  /*
   * Two states the harness cannot reach; their rows are marked harnessOnly:
   * false and skipped. The recipes refuse rather than build nothing, so a row
   * that loses its flag fails loudly instead of being "found" in an empty project.
   */
  'recovery-offered': async () => {
    throw new Error('the recovery banner needs an autosave newer than its file, and the harness has no disk')
  },
  'render-crash': async () => {
    throw new Error('the crash screen needs a component to throw while rendering')
  },
  'canvas-drawn': async () => {
    throw new Error('this text is painted on the preview canvas, where no DOM query can read it')
  },

  /*
   * The settings panel, as the harness has it: the bridge's AI helper has
   * failed by design (bridge.ts sidecarStatus), so it says "Not running"; and
   * in the two states the harness never reaches on its own.
   */
  'settings-open': async () => settingsPanel(),
  /* the AI helper has not reported yet */
  'sidecar-starting': async () => settingsPanel({ prepare: () => editor().setSidecar(false, null) }),
  /* the AI helper is up */
  'sidecar-running': async () => settingsPanel({ prepare: () => editor().setSidecar(true, null) }),
  fullscreen: async () => ({ show: async () => fullScreen(true), close: async () => fullScreen(false) }),
  'newproject-open': async () => ({
    show: async () => menu('new'),
    close: async () => {
      const dialog = buttons().filter((b) => (b.textContent ?? '').trim() === 'Cancel')
      if (dialog.length === 0) throw new Error('census: the New Project dialog has no Cancel')
      await click(dialog[dialog.length - 1])
    }
  }),
  'shortcuts-open': async () => ({ show: async () => menu('shortcuts'), close: escape }),

  /* ---- clips, one kind each */
  'photo-clip': async (env) => ({ ids: { P: (await photoClip(env)).P } }),
  'photo-move': async (env) => {
    const { P } = await photoClip(env)
    editor().setMotion(P, MOVE)
    return { ids: { P } }
  },
  'photo-shake': async (env) => {
    const { P } = await photoClip(env)
    editor().setMotion(P, SHAKE)
    return { ids: { P } }
  },
  'photo-depth': async (env) => {
    const { m, P } = await photoClip(env)
    bakeDepth(m.photos[0].id, false)
    return { ids: { P } }
  },
  'photo-depth-shake': async (env) => {
    const { m, P } = await photoClip(env)
    bakeDepth(m.photos[0].id, true)
    editor().setMotion(P, SHAKE)
    return { ids: { P } }
  },
  /* a move split across two clips: setMotion drops `window`, so it is written directly */
  'photo-split-move': async (env) => {
    const { P } = await photoClip(env)
    editor().setMotion(P, MOVE)
    patchClip(P, { motion: { ...MOVE, window: { from: 30, length: 300 } } })
    return { ids: { P } }
  },
  /* the front half of a text-behind-subject sandwich (putBehindSubject needs the sidecar) */
  'subject-cutout': async (env) => {
    const { P } = await photoClip(env)
    patchClip(P, { generatedBy: { rule: SANDWICH_RULE, reason: 'census' } })
    return { ids: { P } }
  },
  'playhead-off-clip': async (env) => {
    const { m, P } = await photoClip(env)
    place(m.photos[1].id)
    editor().select(P)
    const p = clipById(P)
    editor().setPlayhead(p.start + p.duration + 30)
    return { ids: { P } }
  },
  'playhead-at-end': async (env) => {
    const { m, P } = await photoClip(env)
    place(m.photos[1].id)
    editor().select(P)
    editor().setPlayhead(1e9)
    return { ids: { P } }
  },
  'transitions-error': async (env) => {
    const { P } = await photoClip(env)
    useCatalog.setState({ transitionsError: 'census: the mask library did not load' })
    return { ids: { P } }
  },
  'transition-tags': async (env) => {
    const { P } = await photoClip(env)
    // One mask wipe, made the way the library makes them, so the tag chips have a tag.
    const masks = transitionsFromMasks([{ id: 'mask:census', name: 'census grid', file: 'masks/census.png', tags: ['grid'] }])
    useCatalog.setState({ transitions: [...useCatalog.getState().transitions, ...masks] })
    return { ids: { P } }
  },
  'two-clips': async (env) => {
    const m = await media(env)
    const A = place(m.photos[0].id)
    const B = place(m.photos[1].id)
    const dissolve = useCatalog.getState().transitions.find((t) => t.family === 'dissolve')
    if (!dissolve) throw new Error('census: the transition registry has no dissolve')
    editor().setTransition(B, dissolve.id)
    focus(B)
    return { ids: { A, B } }
  },
  'split-view': async (env) => {
    const { P } = await photoClip(env)
    editor().setSplitRatio(0.5)
    return { ids: { P } }
  },
  'colour-curve': async (env) => {
    const { P } = await photoClip(env)
    editor().setColor(P, { curves: { master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.62 }, { x: 1, y: 1 }] } })
    return {
      ids: { P },
      show: async () => click(buttonByText((t) => t === 'colour', 'the curve panel Colour tab')),
      close: curveOnMotion
    }
  },
  'drop-chip': async (env) => {
    const m = await media(env)
    place(m.photos[0].id)
    editor().setPlayhead(10)
    const asset = m.photos[1]
    return {
      show: async () => {
        const canvas = document.querySelector('canvas[data-forge-preview="1"]')
        if (!canvas?.parentElement) throw new Error('census: no preview canvas to drop onto')
        const dataTransfer = new DataTransfer()
        dataTransfer.setData(
          DRAG_MIME,
          JSON.stringify({ kind: 'media', file: asset.path, name: asset.name, assetId: asset.id, mediaKind: 'image' })
        )
        canvas.parentElement.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
        await frames()
      },
      close: async () => {
        const keep = document.querySelector<HTMLElement>('[title="Keep it as it is"]')
        if (keep) await click(keep)
      }
    }
  },

  'video-clip': async (env) => ({ ids: { V: (await videoClip(env)).V } }),
  'video-slow': async (env) => {
    const { V } = await videoClip(env)
    editor().setClipSpeed(V, 0.5)
    focus(V, 0)
    return { ids: { V } }
  },
  'video-steady': async (env) => {
    const { V } = await videoClip(env)
    editor().setSteady(V, true)
    return { ids: { V } }
  },
  'video-keyed': async (env) => {
    const { V } = await videoClip(env)
    editor().setKey(V, DEFAULT_KEY)
    return { ids: { V } }
  },
  'key-pick': async (env) => {
    const { V } = await videoClip(env)
    editor().setKey(V, DEFAULT_KEY)
    editor().setPreviewTool('key')
    return { ids: { V } }
  },
  /* a look applied, as the Looks grid applies one: the bridge's built-in looks are real .cube blobs */
  'video-look': async (env) => {
    const { V } = await videoClip(env)
    const [look] = await window.forge.builtInLooks()
    if (!look) throw new Error('census: the bridge offers no built-in looks')
    editor().setColor(V, { brightness: 0.2, lut: { file: look.file, name: look.name, intensity: 0.8 } })
    return { ids: { V } }
  },
  'video-envelope': async (env) => {
    const { V } = await videoClip(env)
    editor().setKeyframe(V, 'volume', 0, 1)
    editor().setKeyframe(V, 'volume', 30, 0.5)
    return { ids: { V } }
  },
  'video-pip': async (env) => {
    const { V } = await videoClip(env)
    editor().setTransform(V, { scale: 0.5 })
    return { ids: { V } }
  },
  'video-path': async (env) => {
    const { V } = await videoClip(env)
    editor().addWaypoint(V)
    return { ids: { V } }
  },
  transcribing: async (env) => {
    const { m, V } = await videoClip(env)
    useEditor.setState({ transcribing: { [m.video.id]: { progress: null } } })
    return { ids: { V } }
  },
  transcript: async (env) => {
    const { m, V } = await videoClip(env)
    const assetId = m.video.id
    editor().update((p) => ({
      ...p,
      transcripts: {
        ...p.transcripts,
        [assetId]: {
          assetId,
          language: 'en',
          model: 'census',
          durationMs: 2000,
          words: [{ index: 0, text: 'hello', startMs: 0, endMs: 500, confidence: 0.9 }],
          segments: [{ id: 's0', startMs: 0, endMs: 500, text: 'hello', wordStart: 0, wordEnd: 0 }]
        }
      }
    }))
    return { ids: { V } }
  },
  'transcript-editing': async (env) => {
    const built = await RECIPES.transcript(env)
    return {
      ...built,
      show: async () => {
        const edit = document.querySelector<HTMLElement>('[title*="Correct a misheard word"]')
        if (!edit) throw new Error('census: the transcript has no Edit button')
        await click(edit)
      }
    }
  },
  'clipmenu-open': async (env) => clipMenu(env, false),
  'clipmenu-detached': async (env) => clipMenu(env, true),

  'text-clip': async (env) => textClip(env, false),
  'text-fill': async (env) => textClip(env, true),
  'text-fontpicker': async (env) => ({
    ...(await textClip(env, false)),
    show: async () => click(buttonByText((t) => t.endsWith('Change'), 'the text card font Change')),
    close: escape
  }),
  'colour-clip': async () => {
    const C = await made(editor().addSolidClip(topVideoTrack(), 0), 'addSolidClip')
    // A colour card is NAMED "Colour", and the clip header shows the name: one more "Colour" that is not a control.
    const assetId = clipById(C).assetId
    editor().update((p) => ({ ...p, assets: p.assets.map((a) => (a.id === assetId ? { ...a, name: 'census card' } : a)) }))
    focus(C)
    return { ids: { C } }
  },
  'adjustment-clip': async () => {
    const A = await made(editor().addAdjustmentLayer(topVideoTrack(), 0), 'addAdjustmentLayer')
    focus(A)
    return { ids: { A } }
  },
  'paper-clip': async () => {
    const N = await made(editor().addPaperClip(topVideoTrack(), 0), 'addPaperClip')
    focus(N)
    return { ids: { N } }
  },
  'paper-customise': async (env) => ({
    ...(await RECIPES['paper-clip'](env)),
    show: async () => click(buttonByText((t) => t === 'Customise', 'the paper Customise')),
    close: async () => {
      const hide = buttons().find((b) => (b.textContent ?? '').trim() === 'Hide')
      if (hide) await click(hide)
    }
  }),
  'ring-clip': async (env) => {
    await media(env)
    const R = await made(editor().addCarouselClip(topVideoTrack(), 0), 'addCarouselClip')
    focus(R)
    return { ids: { R } }
  },
  'title-clip': async (env) => {
    const { m, P } = await photoClip(env)
    const base = clipById(P)
    const T = 'census-title'
    editor().update((p) => ({
      ...p,
      assets: [
        ...p.assets,
        { ...m.photos[2], id: 'census-title-asset', name: 'census title', durationFrames: 300 }
      ],
      clips: [
        ...p.clips,
        {
          ...base,
          id: T,
          assetId: 'census-title-asset',
          trackId: topVideoTrack(),
          start: 0,
          duration: 60,
          crop: undefined,
          title: { template: 'census', texts: ['First', 'Second'], version: 1 }
        } as Clip
      ]
    }))
    focus(T)
    return { ids: { T } }
  },

  mask: async (env) => maskClip(env, 'blur', true),
  'mask-still': async (env) => maskClip(env, 'blur', false),
  'mask-grade': async (env) => maskClip(env, 'grade', true),
  keyframes: async (env) => {
    const m = await media(env)
    const P = place(m.photos[0].id)
    editor().select(P)
    editor().setKeyframe(P, 'zoom', 0, 1.2)
    editor().setKeyframe(P, 'zoom', 60, 1.5)
    const start = clipById(P).start
    // Two points on the motion path, so it has something to clear.
    editor().setPlayhead(start + 10)
    editor().addWaypoint(P)
    editor().setPlayhead(start + 40)
    editor().addWaypoint(P)
    editor().setPlayhead(start)
    return { ids: { P } }
  },

  /* ---- the Output and Export settings */
  'timeline-marks': async (env) => {
    await photoClip(env)
    editor().select(null)
    editor().setRangeIn(0)
    editor().setRangeOut(30)
    return {}
  },
  'export-jobs': async () => {
    editor().setJobs([job('running', 'export', 'running', 0.4), job('done', 'export', 'done', 1)])
    return {}
  },
  /*
   * How the last export ended, in EXPORT's header (shared/render/exportHeadline.ts):
   * nothing under way, and the last RENDER — a job the export queued, whose
   * presetId is 'render' (main/ipc.ts) — done, failed, or one waiting its turn.
   */
  'export-done': async () => {
    editor().setJobs([job('census-render', 'render', 'done', 1)])
    return {}
  },
  'export-failed': async () => {
    editor().setJobs([
      { ...job('census-render', 'render', 'failed', 0.3), finishedAt: Date.now() - 1000, error: 'census: a failed render' }
    ])
    return {}
  },
  'export-waiting': async () => {
    editor().setJobs([job('census-render', 'render', 'queued', 0)])
    return {}
  },
  'saved-preset': async () => {
    await editor().savePreset({
      ...editor().exportChoice,
      id: 'census-preset',
      name: 'Census preset',
      aspect: '9:16',
      crf: 20,
      preset: 'medium',
      loudness: -14,
      captions: true,
      suffix: '-census'
    } as Parameters<ReturnType<typeof useEditor.getState>['savePreset']>[0])
    return { close: async () => editor().removePreset('census-preset') }
  },
  /* a caption style the burn-in cannot draw, so the preview's canvas does */
  'captions-drawn': async () => {
    editor().setCaptionStyle('kinetic')
    return {}
  },
  /* the captions switch reads the other way */
  'captions-flipped': async () => {
    editor().setCaptionsEnabled(!editor().project.captions.enabled)
    return {}
  },
  'export-bitrate': async () => {
    editor().setExportChoice({ bitrateKbps: 8000 })
    return {}
  },
  'loudness-off': async () => {
    editor().setLoudness(undefined)
    return {}
  },
  'encoders-unknown': async () => {
    useEditor.setState({ encoders: null })
    return {}
  },
  'encoder-prores': async () => {
    useEditor.setState({ encoders: [{ id: 'libx264', ok: true }, { id: 'prores_ks', ok: true }] })
    editor().setExportChoice({ encoder: 'prores_ks', container: 'mov' })
    return {}
  },
  'encoder-broken': async () => {
    editor().setExportChoice({ encoder: 'libx265' })
    return {}
  },
  'encoder-hardware': async () => {
    useEditor.setState({ encoders: [{ id: 'libx264', ok: true }, { id: 'h264_videotoolbox', ok: true }] })
    editor().setExportChoice({ encoder: 'h264_videotoolbox', bitrateKbps: null })
    return {}
  },
  'caption-fontpicker': async () => ({
    show: async () => click(buttonByText((t) => t.startsWith('Font'), 'the caption Font button')),
    close: escape
  }),
  'style-gallery': async () => ({
    show: async () => click(buttonByText((t) => t.startsWith('Browse all'), 'the caption Browse all')),
    close: escape
  }),

  /* ---- the Shelf's tools */
  'offline-asset': async (env) => {
    const m = await media(env)
    editor().update((p) => ({
      ...p,
      assets: p.assets.map((a) => (a.id === m.photos[0].id ? { ...a, offline: true } : a))
    }))
    return {}
  },
  /*
   * Something dragged over the Upload tile. The drop zone is the pool's own
   * root (MediaPool.tsx), found by structure — the first element in the open
   * tool's panel — never by the Upload button's words, which are counted.
   */
  'pool-dragover': async () => {
    const pool = (): Element => {
      const [panel] = homeRoots('upload')
      const root = panel?.firstElementChild
      if (!root) throw new Error('census: the Upload tile shows no pool to drag over')
      return root
    }
    return {
      show: async () => {
        pool().dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true }))
        await frames()
      },
      close: async () => {
        pool().dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true }))
        await frames()
      }
    }
  },
  /*
   * More than one page (Library PAGE = 120) and two categories, for the chips
   * and "Loading more". Nothing is clicked: the Library opens on Stickers by
   * itself (the user, WINDOW.md §7.6), and these rows are how that is checked —
   * on any other drawer they are not there.
   */
  'library-stickers': async () => {
    catalogWith(stickers(130))
    return {}
  },
  'library-sfx': async () => {
    catalogWith(sfx(3))
    return { show: async () => click(buttonByText((t) => t.startsWith('SFX'), 'the SFX chip')) }
  },
  /* a library with sounds in it, open on Stickers: an empty DRAWER, which has its own way to get more */
  'library-empty-drawer': async () => {
    catalogWith(sfx(3))
    return {}
  },
  /*
   * One transition in the library: the Transitions tile opens the Library on
   * its Transitions drawer, where it shows — the Library tile, on Stickers,
   * would show "Nothing here." instead.
   */
  'library-transitions': async () => {
    catalogWith(transitions(1))
    return {}
  },
  /* one pack in each state the list can show a button for */
  'packs-states': async () => {
    const busy = pack('busy', { kind: 'available' })
    const failed = pack('failed', { kind: 'available' })
    packsAre({
      packs: [busy, failed, pack('stale', { kind: 'stale', installed: 1 }), pack('installed', { kind: 'installed', version: 2 })],
      inFlight: new Map([[busy.id, { progress: 0.4, message: 'census: downloading' }]]),
      failed: new Map([[failed.id, 'census: the download failed']])
    })
    return {}
  },
  'packs-error': async () => {
    packsAre({ packs: [], error: 'census: the list could not be fetched' })
    return {}
  },
  'packs-none': async () => {
    packsAre({ packs: [] })
    return {}
  },
  'packs-unreleased': async () => {
    packsAre({ packs: [pack('unreleased', { kind: 'unpublished' })] })
    return {}
  },
  /*
   * A sound picked in the Library, in the Trimmer dock before it is placed —
   * the dock shows for it with nothing selected. Its rows are all in `dock`,
   * so `close` runs once: leaving the Library has to end the audition and take
   * the dock away (Library.tsx), which `fresh` alone would never see, because
   * it puts the store back first.
   */
  audition: async () => {
    catalogWith(sfx(1))
    await openHome('library')
    await click(buttonByText((t) => t.startsWith('SFX'), 'the SFX chip'))
    const row = document.querySelector<HTMLElement>('[title="Play and show in the trimmer"]')
    if (!row) throw new Error('census: the Library shows no sound to audition')
    await click(row)
    if (!editor().audition) throw new Error('census: clicking a Library sound did not audition it')
    return {
      close: async () => {
        await shelfShows(null)
        await noDock()
      }
    }
  },
  'ingest-range': async () => {
    await youtube({ useRange: true })
    return {}
  },
  'ingest-instrumental': async () => {
    await youtube({ kind: 'instrumental' })
    return {}
  },
  'ingest-bad-link': async () => {
    await youtube({ url: 'not a link' })
    return {}
  },
  'ingest-running': async () => {
    useEditor.setState({
      jobs: [job('census-dl', 'ingest', 'running', 0.2)],
      pendingIngests: { 'census-dl': { projectPath: null } }
    })
    return {}
  },
  /* a tool open on the Shelf, for its header: the way back to the tiles */
  'shelf-tool-open': async () => ({
    show: async () => shelfShows('upload'),
    close: async () => shelfShows(null)
  }),
  'director-more': async () => ({
    show: async () =>
      click(buttonByText((t) => t.toLowerCase().startsWith('more'), 'the Director More button'))
  }),
  /*
   * The model servers in the settings panel (step 6; they were under Director's
   * gear). As the harness bridge answers they are a local server with no key —
   * 'settings-open' — and these two change that.
   */
  /* the OpenAI-shaped server pointed somewhere that is not this machine, with no key yet */
  'director-hosted': async () =>
    settingsPanel({
      config: (c) => {
        c.openai.baseUrl = 'https://census.invalid/v1'
      }
    }),
  /* a key saved: the field says so, and offers to clear it */
  'director-key': async () =>
    settingsPanel({
      config: (c) => {
        c.openai.hasKey = true
      }
    }),
  'music-clip': async () => {
    // A song and no photos: "Upload some photos" only shows without them.
    const fps = editor().project.settings.fps
    editor().update((p) => ({
      ...p,
      assets: [
        ...p.assets,
        {
          id: 'census-song',
          // A real (silent) file, so the preview's mixer has something it can load.
          path: silentWav(),
          name: 'census song',
          kind: 'audio',
          durationFrames: 30 * fps,
          width: null,
          height: null,
          fps,
          hasVideo: false,
          hasAudio: true,
          size: 1
        }
      ]
    }))
    const S = place('census-song')
    // Trimmed, so the range is a part of the song and "Use all" has something to undo.
    editor().setSourceRange(S, 0, 15 * fps)
    return { ids: { S } }
  },
  'props-on': async () => {
    editor().setPropsEnabled(true)
    return {}
  },
  /* a reel under way: Beat sync's progress and Stop, and One photo's mirrors of them */
  'reel-building': async () => {
    useEditor.setState({ reelBuilding: true, reelStage: null })
    return {}
  },
  /*
   * A depth bake under way, with no message yet: the Depth / Parallax tile's
   * panel says so (tools/DepthParallax.tsx). Only the store's flag — the
   * harness bridge cannot bake (bridge.ts bakeParallax), and nothing here
   * needs it to.
   */
  'depth-baking': async () => {
    useEditor.setState({ baking: { 'census-photo': { progress: null } } })
    return {}
  },
  /* landscape photos on a portrait canvas: the canvas bar's chip offers 16:9 */
  'orientation-mismatch': async (env) => {
    await media(env)
    editor().setAspect('9:16')
    return {}
  },
  /*
   * Three portrait photos on a landscape canvas: the chip offers 9:16.
   *
   * The bridge only paints landscape stills (1600×1067), so the pool's records
   * are turned on their side through the store. Only the records: the pixels
   * stay landscape, which nothing counted here looks at — the chip reads each
   * asset's width and height (shared/edit/orientation.ts), never the picture.
   */
  'orientation-portrait': async (env) => {
    const m = await media(env)
    const turned = new Set(m.photos.map((a) => a.id))
    editor().update((p) => ({
      ...p,
      assets: p.assets.map((a) =>
        turned.has(a.id) && a.width !== null && a.height !== null ? { ...a, width: a.height, height: a.width } : a
      )
    }))
    const standing = editor().project.assets.filter((a) => turned.has(a.id) && (a.height ?? 0) > (a.width ?? 0))
    if (standing.length !== 3) throw new Error(`census: ${standing.length} of the three photos stand up after turning them`)
    if (editor().aspect !== '16:9') throw new Error(`census: a fresh project is ${editor().aspect}, not 16:9`)
    return {}
  },
  /* one clip from every automation and the Director, and a Director result */
  generated: async (env) => {
    const { P } = await photoClip(env)
    const base = clipById(P)
    const rules = [REEL_RULE, ONE_PHOTO_RULE, GRID_RULE, STRIP_RULE, FILMSTRIP_RULE, PROP_RULE, SPINE_RULE]
    editor().update((p) => ({
      ...p,
      clips: [
        ...p.clips,
        ...rules.map((rule, i) => ({
          ...base,
          id: `census-generated-${i}`,
          start: base.start + base.duration * (i + 1),
          generatedBy: { rule, reason: 'census' }
        }))
      ]
    }))
    editor().setPropsEnabled(true)
    useEditor.setState({ lastDirection: { model: '', reasoning: '', problems: [], baseline: true } })
    return { ids: { P } }
  }
}

async function clipMenu(env: Env, detached: boolean): Promise<Built> {
  const { V } = await videoClip(env)
  if (detached) editor().detachAudio(V)
  editor().select(null)
  return {
    ids: { V },
    show: async () => {
      const element = [...document.querySelectorAll<HTMLElement>('div[class*="group/clip"]')].find((d) =>
        (d.textContent ?? '').includes('census video')
      )
      if (!element) throw new Error('census: the video clip is not on the timeline to right-click')
      const box = element.getBoundingClientRect()
      element.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: box.left + Math.min(20, box.width / 2),
          clientY: box.top + box.height / 2
        })
      )
      await frames()
    },
    close: escape
  }
}

async function textClip(env: Env, filled: boolean): Promise<Built> {
  const { P } = await photoClip(env)
  const T = await made(editor().addTextClip(topVideoTrack(), 0), 'addTextClip')
  await editor().setText(T, { styleId: 'white-glow', stroke: 0.05 })
  if (filled) editor().fillWithClipBelow(T)
  focus(T, 10)
  return { ids: { P, T } }
}

async function maskClip(env: Env, mode: 'blur' | 'grade', animated: boolean): Promise<Built> {
  const m = await media(env)
  const P = place(m.photos[0].id)
  editor().setMask(P, defaultMask(mode))
  if (animated) editor().animateMask(P, true)
  focus(P, 0)
  return { ids: { P } }
}

/* ------------------------------------------------------------- running */

/** Every plain (non-function) field of a zustand state, to put back later. */
function snapshot<T extends object>(state: T): Partial<T> {
  return Object.fromEntries(Object.entries(state).filter(([, value]) => typeof value !== 'function')) as Partial<T>
}

let mediaPaths: string[] | null = null

async function syntheticMedia(): Promise<string[]> {
  if (mediaPaths) return mediaPaths
  if (document.visibilityState !== 'visible') {
    throw new Error(
      'census: the harness tab is hidden, and the bridge records its video with requestAnimationFrame — bring the tab to the front'
    )
  }
  const paths = await withTimeout(window.forge.pickMedia(), 30_000, "the bridge's pickMedia")
  if (paths.length < 4) throw new Error(`census: pickMedia gave ${paths.length} files, expected four`)
  mediaPaths = paths
  return paths
}

export async function runCensus(options: CensusOptions = {}): Promise<CensusResult> {
  const started = performance.now()
  for (const hook of ['forgeMenu', 'forgeFullScreen'] as const) {
    if (typeof (window as unknown as Record<string, unknown>)[hook] !== 'function') {
      throw new Error(`census: window.${hook} is missing — the harness bridge did not install it`)
    }
  }
  const all = parseRows()
  for (const need of options.needs ?? []) {
    if (!(need in RECIPES)) throw new Error(`census: no recipe for ${JSON.stringify(need)}`)
  }
  const wanted = all.filter((row) => !options.needs || options.needs.includes(row.needs))
  const rows = wanted.filter((row) => row.harnessOnly !== false)

  const editorBefore = snapshot(useEditor.getState())
  const catalogBefore = snapshot(useCatalog.getState())
  const packsBefore = snapshot(usePacks.getState())
  const exportChoiceBefore = useEditor.getState().exportChoice
  const env: Env = { paths: await syntheticMedia() }

  const fresh = async (): Promise<void> => {
    useEditor.setState(editorBefore)
    useCatalog.setState(catalogBefore)
    usePacks.setState(packsBefore)
    // Closed for every scenario, whatever the page had: the panel is an overlay
    // home, found as the thing opening it ADDS, and one already open adds nothing.
    editor().setSettingsOpen(false)
    editor().newProject()
    await frames()
    // The Shelf on its tiles: whatever tool the last scenario opened is shut,
    // the Library among them, which ends any audition (Library.tsx).
    await shelfShows(null)
    await curveOnMotion()
    // Nothing selected and the Library shut: no dock (the successor of "No clip selected").
    await noDock()
  }

  const missing: CensusMiss[] = []
  const trace: CensusTally[] = []
  const scenario: CensusResult['scenario'] = {}
  let checked = 0

  try {
    /*
     * The empty project's count of every label in its home, which a row's own
     * state has to ADD to. Taken twice, a moment apart, keeping the larger: a
     * carrier still loading the first time would otherwise make a row look
     * ambiguous later.
     */
    const base = new Map<CensusRow, Base>()
    const needBase = rows.filter((row) => row.needs !== 'none' && !isOverlay(row.home))
    if (needBase.length > 0) {
      await fresh()
      for (const home of [...new Set(needBase.map((row) => row.home))]) {
        await openHome(home)
        await frames()
        for (let pass = 0; pass < 2; pass++) {
          if (pass > 0) await sleep(250)
          const count = screen(homeRoots(home))
          for (const row of needBase.filter((r) => r.home === home)) {
            const was = base.get(row) ?? { own: 0, other: 0 }
            base.set(row, {
              own: Math.max(was.own, count(row, Boolean(row.part)).shown),
              other: Math.max(was.other, count(row, !row.part).shown)
            })
          }
        }
      }
    }

    for (const need of Object.keys(RECIPES)) {
      const mine = rows.filter((row) => row.needs === need)
      if (mine.length === 0) continue
      await fresh()

      let built: Built
      try {
        built = await RECIPES[need](env)
      } catch (err) {
        throw new Error(`census: could not build '${need}': ${err instanceof Error ? err.message : String(err)}`)
      }
      if (built.ids) scenario[need] = built.ids
      await frames()

      const homes = [...new Set(mine.map((row) => row.home))]
      for (const home of homes) {
        const here = mine.filter((row) => row.home === home)
        await openHome(home)
        const before = isOverlay(home) ? fixedElements() : null
        if (built.show) {
          try {
            await built.show()
          } catch (err) {
            throw new Error(`census: could not open '${need}' in ${home}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
        await frames()

        const roots = before ? () => overlayRoots(before, home) : () => homeRoots(home)
        const { misses, tallies } = await look(here, roots, base)
        for (const { row, why, seen } of misses) missing.push({ ...row, why, seen })
        if (options.trace) trace.push(...tallies)
        checked += here.length
        if (built.close) await built.close()
        await frames()
      }
    }
  } finally {
    if (!options.keep) {
      await fresh().catch(() => undefined)
      useEditor.setState(editorBefore)
      // The bridge keeps the export choice in its settings too; put that back.
      editor().setExportChoice(exportChoiceBefore)
    }
  }

  return {
    missing,
    checked,
    skipped: wanted.length - rows.length,
    scenario,
    ...(options.trace ? { trace } : {}),
    ms: Math.round(performance.now() - started)
  }
}

export function installCensus(): void {
  ;(window as unknown as { __forgeCensus: typeof runCensus }).__forgeCensus = runCensus
}
