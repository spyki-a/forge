/**
 * Clip it from a link's transcript, and a timeline clip cut to its words,
 * clicked through in the running page (docs/CLIPS.md §3b.8: the URL tile's
 * half, then the Transcript tile's, §3b.6).
 *
 *   await window.__forgeClipItCheck()   → the report, or throws with every failure
 *
 * Against the bridge's stubs: the twelve-row talk with three chapters, a link
 * with no captions, and a download that only records its request and the argv
 * main would spawn (bridge.ts `harnessIngests`). Everything is pressed on the
 * screen — the panel is the thing under examination — and read back from the
 * store and the bridge:
 *
 *   1. Get transcript on the talk → twelve rows.
 *   2. Rows 3–6 by a click and a shift-click → the run is those rows' words,
 *      and the line under the rows says its range's length.
 *   2b. The arrow keys on the focused Start and End, across a row's edge each
 *      way → a word a press, the handle still focused after it moved rows, and
 *      the window's own arrows (the playhead) not reached.
 *   3. Cleared, then the Start and End handles dragged onto the same words → the
 *      same run, so the same range.
 *   3b. Rows 3–6, Start dragged into row 2's middle, then row 7 shift-clicked →
 *      the dragged start kept, not the clicked row's.
 *   4. The second chapter's chip → `runOfChapter`'s run.
 *   4b. With the words on screen, Get reads "Full download", is not the
 *      accent button, and Enter in the link box starts nothing — and both
 *      buttons' labels are measured: one line each, and their widths.
 *   5. Rows 3–6 again, Clip download → one job, exact, with exactly the run's
 *      range, its argv holding one `--download-sections` (counted with `filter`).
 *   6. Add another clip → the rows kept, the run cleared, no job started.
 *   7. Rows 8–9, Clip download → a second job, its argv holding one
 *      `--download-sections`, and that one is rows 8–9's, not the first's.
 *   8. The no-caption link → "This video has no captions", Listen to it greyed
 *      with "needs the AI helper", and a chapter chip setting From and To,
 *      which are typed fields again.
 *   9. The Transcript tile: a clip of the same talk's words on the timeline at
 *      2× (an offline asset — the tile reads only its transcript), selected →
 *      twelve rows, each row's time where it is on the TIMELINE (half its
 *      source time); rows 3–6 by a click and a shift-click → the run, the
 *      playhead on the cut's first frame and the cut's length under the rows;
 *      Cut to these words → the clip's in-point and length exactly
 *      `clipToRange`'s, its start unmoved, every kept frame showing the source
 *      it showed before, one undo step more; one undo → the clip as it was.
 *      And measured, with the dock open, as the tile opens and with the run
 *      picked: Cut to these words is never drawn over Listen for.
 *
 * Run it in the FRONTED tab on a freshly loaded page: React's updates are
 * waited for with animation frames, which a background tab never runs. The
 * store and the Shelf are put back afterwards; the bridge's record of the two
 * jobs stays, and says what was asked.
 */

import type { Transcript } from '@shared/transcript'
import { formatMark, type Range } from '@shared/ingest/section'
import { rowOfWord, rowsOf, runFromRows, runOfChapter, runRange, type WordRun } from '@shared/ingest/wordRun'
import { clipSourceWindow, clipToRange, clipWords, cutFrames } from '@shared/edit/clipIt'
import { sourceFrameFor, timelineFrameAt, type Clip, type MediaAsset } from '@shared/timeline'
import { useEditor } from '../store'
import { rowStamp } from '../components/tools/TranscriptRows'
import { HARNESS_LINKS, harnessIngests, type HarnessIngest } from './bridge'

export interface ClipItJobSeen {
  range: Range | null
  exact: boolean
  /** How many `--download-sections` its argv holds. */
  sections: number
  /** The section's value, `*<start>-<end>` in seconds. */
  section: string | null
  /** The words it will land with: the run, and the range they shift by. */
  run: WordRun | null
}

/** What each step saw; a step a failure stopped short of stays null. */
export interface ClipItReport {
  rows: number | null
  picked: { run: WordRun | null; expected: WordRun; line: string; lineExpected: string } | null
  /** Each key press: the key, the handle, the run after it, and whether that handle still had the focus. */
  keys: { presses: { key: string; which: string; run: WordRun | null; focused: boolean }[]; playheadCalls: number } | null
  handles: { run: WordRun | null; range: Range | null; sameAsPicked: boolean } | null
  anchor: { dragged: WordRun | null; extended: WordRun | null; expected: WordRun | null } | null
  chapter: { title: string; run: WordRun | null; expected: WordRun | null } | null
  /** Get while the words are shown, and its label measured beside the link box; and Clip download's. */
  fullDownload: {
    label: string
    accent: boolean
    enterStarted: number
    /** The URL tile's column, the button, and the link box beside it — px. */
    column: number
    width: number
    box: number
    lines: number
    clip: { label: string; width: number; lines: number }
  } | null
  first: ClipItJobSeen | null
  another: { rows: number; run: WordRun | null; jobsStarted: number } | null
  second: ClipItJobSeen | null
  noCaptions: { notice: boolean; listenDisabled: boolean; reason: string | null; fieldsEditable: boolean } | null
  /** The Transcript tile's half (§3b.6). */
  tile: {
    rows: number
    /** Row 3's time on screen, and what it should be at 2×. */
    stamp: string
    stampExpected: string
    run: WordRun | null
    expected: WordRun
    playhead: number
    line: string
    before: Edges
    after: Edges
    expectedAfter: Edges
    undoSteps: number
    undone: Edges
    /** Cut to these words against Listen for, as the tile opens and with a run picked. */
    layout: { idle: CutLayout; picked: CutLayout }
  } | null
  failures: string[]
  ms: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const editor = (): ReturnType<typeof useEditor.getState> => useEditor.getState()

async function frames(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('clip-it check: requestAnimationFrame did not fire in 3 s — bring the harness tab to the front')),
        3000
      )
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  } finally {
    clearTimeout(timer)
  }
}

/** Wait for `test` to hold, a frame at a time, up to `ms`. */
async function until<T>(test: () => T | null | undefined | false, ms: number, what: string): Promise<T> {
  const stop = performance.now() + ms
  for (;;) {
    const value = test()
    if (value) return value
    if (performance.now() > stop) throw new Error(`clip-it check: ${what} did not happen in ${ms / 1000} s`)
    await frames()
  }
}

/** The tile the steps are in: the URL tile for 1–8, the Transcript tile for 9. */
let tool: 'url' | 'transcript' = 'url'

function panel(): Element {
  const found = document.querySelectorAll(`[data-shelf-tool="${tool}"] [data-shelf-panel]`)
  if (found.length !== 1) throw new Error(`clip-it check: expected the ${tool} tile's panel, found ${found.length}`)
  return found[0]
}

function button(text: string): HTMLButtonElement | null {
  return [...panel().querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === text) ?? null
}

function press(text: string): HTMLButtonElement {
  const b = button(text)
  if (!b) throw new Error(`clip-it check: no "${text}" button in the ${tool} tile`)
  b.click()
  return b
}

/** How many lines a button's label takes: the distinct tops of its TEXT's boxes (the icon beside it is not a line). */
function labelLines(b: Element | null): number {
  if (!b) return 0
  const tops = new Set<number>()
  const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node.nodeValue ?? '').trim()) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) tops.add(Math.round(r.top))
  }
  return tops.size
}

const px = (el: Element | null): number => (el ? Math.round(el.getBoundingClientRect().width * 10) / 10 : 0)

const rowsBox = (): Element | null => panel().querySelector('[data-transcript-rows]')
const rowCount = (): number => rowsBox()?.querySelectorAll('[data-row]').length ?? 0

function rowTime(index: number): HTMLElement {
  const el = rowsBox()?.querySelector<HTMLElement>(`[data-row-time="${index}"]`)
  if (!el) throw new Error(`clip-it check: row ${index + 1} has no time to click`)
  return el
}

/** A click and a shift-click on two rows' times — 0-based. */
async function pickRows(a: number, b: number): Promise<void> {
  rowTime(a).click()
  await frames()
  rowTime(b).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }))
  await frames()
}

/** A handle dragged on the rows' box to `y`, as the pointer would. */
async function drag(which: 'start' | 'end', y: () => number): Promise<void> {
  const box = rowsBox()
  const handle = box?.querySelector<HTMLElement>(`[data-handle="${which}"]`)
  if (!box || !handle) throw new Error(`clip-it check: no ${which} handle on the rows`)
  const at = handle.getBoundingClientRect()
  const init = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }
  handle.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: at.left + 2, clientY: at.top + 2 }))
  await frames()
  box.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: at.left + 2, clientY: y() }))
  await frames()
  box.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0, clientX: at.left + 2, clientY: y() }))
  await frames()
}

function rowBox(index: number): DOMRect {
  const el = rowsBox()?.querySelector(`[data-row="${index}"]`)
  if (!el) throw new Error(`clip-it check: no row ${index + 1}`)
  return el.getBoundingClientRect()
}

const same = (a: WordRun | null | undefined, b: WordRun | null | undefined): boolean =>
  Boolean(a && b && a.from === b.from && a.to === b.to)

function seen(job: HarnessIngest | undefined): ClipItJobSeen | null {
  if (!job) return null
  const at = job.args.indexOf('--download-sections')
  return {
    range: job.request.range ?? null,
    exact: job.request.exact === true,
    sections: job.args.filter((arg) => arg === '--download-sections').length,
    section: at >= 0 ? (job.args[at + 1] ?? null) : null,
    run: job.clip?.transcriptFrom.run ?? null
  }
}

const sectionOf = (range: Range): string => `*${(range.startMs / 1000).toFixed(3)}-${(range.endMs / 1000).toFixed(3)}`

export async function runClipItCheck(): Promise<ClipItReport> {
  const started = performance.now()
  const failures: string[] = []
  const expect = (ok: boolean, what: string): void => {
    if (!ok) failures.push(what)
  }
  const report: ClipItReport = {
    rows: null,
    picked: null,
    keys: null,
    handles: null,
    anchor: null,
    chapter: null,
    fullDownload: null,
    first: null,
    another: null,
    second: null,
    noCaptions: null,
    tile: null,
    failures,
    ms: 0
  }

  const before = editor()
  const kept = {
    urlSource: before.urlSource,
    ingest: before.ingest,
    pendingIngests: before.pendingIngests,
    shelfTool: before.shelfTool,
    sidecarReady: before.sidecarReady,
    sidecarError: before.sidecarError,
    // The Transcript tile's half adds an asset and a clip, and undoes: all put back.
    project: before.project,
    past: before.past,
    future: before.future,
    dirty: before.dirty,
    playhead: before.playhead,
    selectedClipIds: before.selectedClipIds,
    selectedClipId: before.selectedClipId,
    clipRun: before.clipRun
  }
  const jobsBefore = harnessIngests.length

  try {
    tool = 'url'
    editor().setShelfTool('url')
    editor().setSidecar(false, null)
    editor().setIngest({ url: HARNESS_LINKS.talk, useRange: false, busy: false })
    useEditor.setState({ urlSource: null })
    await frames()

    /* 1. Get transcript → rows */
    press('Get transcript')
    await until(() => rowCount() > 0 && editor().urlSource?.status === 'ready', 3000, 'Get transcript showing rows')
    const t: Transcript = editor().urlSource!.transcript!
    const rows = rowCount()
    report.rows = rows
    expect(rows === 12, `Get transcript showed ${rows} rows, not 12`)
    expect(rows === rowsOf(t).length, `${rows} rows on screen for ${rowsOf(t).length} in the transcript`)

    /* 2. rows 3–6 by click and shift-click */
    await pickRows(2, 5)
    const expected = runFromRows(t, 2, 5)
    const pickedRun = editor().urlSource?.run ?? null
    const line = [...panel().querySelectorAll('p')].find((p) => (p.textContent ?? '').endsWith('selected'))?.textContent ?? ''
    const expectedRange = runRange(t, expected)
    const lineExpected = `${formatMark(expectedRange.endMs - expectedRange.startMs)} selected`
    report.picked = { run: pickedRun, expected, line: line.trim(), lineExpected }
    expect(same(pickedRun, expected), `rows 3–6 picked ${JSON.stringify(pickedRun)}, not ${JSON.stringify(expected)}`)
    expect(line.trim() === lineExpected, `the run's length line reads "${line.trim()}", not "${lineExpected}"`)

    /* 2b. the arrow keys on a focused handle, across a row's edge each way */
    {
      const rowsOfT = rowsOf(t)
      const presses: { key: string; which: string; run: WordRun | null; focused: boolean }[] = []
      // The window's arrows step the playhead (App.tsx's tinykeys): counted, not run, while the keys are pressed.
      let playheadCalls = 0
      const realPlayhead = editor().setPlayhead
      useEditor.setState({ setPlayhead: () => void playheadCalls++ })
      try {
        const press = async (which: 'start' | 'end', key: string): Promise<void> => {
          const target = document.activeElement
          if (!(target instanceof HTMLElement) || target.getAttribute('data-handle') !== which) {
            throw new Error(`the ${which} handle does not have the focus before ${key}`)
          }
          target.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }))
          await frames()
          await frames()
          const now = document.activeElement
          presses.push({
            key,
            which,
            run: editor().urlSource?.run ?? null,
            focused: now instanceof HTMLElement && now.getAttribute('data-handle') === which
          })
        }
        // Start sits on row 3's first word (18): up into row 2's last, up again, then down twice back into row 3.
        rowsBox()?.querySelector<HTMLElement>('[data-handle="start"]')?.focus()
        await press('start', 'ArrowUp')
        await press('start', 'ArrowUp')
        await press('start', 'ArrowDown')
        await press('start', 'ArrowDown')
        // End sits on row 6's last word (53): right into row 7, then left back.
        rowsBox()?.querySelector<HTMLElement>('[data-handle="end"]')?.focus()
        await press('end', 'ArrowRight')
        await press('end', 'ArrowLeft')
      } catch (err) {
        failures.push(`keys: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        useEditor.setState({ setPlayhead: realPlayhead })
      }
      report.keys = { presses, playheadCalls }
      const want = [
        { from: expected.from - 1, to: expected.to },
        { from: expected.from - 2, to: expected.to },
        { from: expected.from - 1, to: expected.to },
        expected,
        { from: expected.from, to: expected.to + 1 },
        expected
      ]
      expect(presses.length === want.length, `${presses.length} of ${want.length} key presses were made`)
      presses.forEach((p, i) => {
        expect(same(p.run, want[i]), `${p.key} on ${p.which} gave ${JSON.stringify(p.run)}, not ${JSON.stringify(want[i])}`)
        expect(p.focused, `${p.key} on ${p.which} (to word ${p.which === 'start' ? want[i]?.from : want[i]?.to}) left the focus on ${document.activeElement?.tagName ?? 'nothing'}`)
      })
      // The presses that crossed a row's edge are the ones a lost focus would show at.
      expect(rowOfWord(rowsOfT, expected.from - 1) !== rowOfWord(rowsOfT, expected.from), 'the Start presses did not cross a row')
      expect(rowOfWord(rowsOfT, expected.to + 1) !== rowOfWord(rowsOfT, expected.to), 'the End presses did not cross a row')
      expect(playheadCalls === 0, `a handle's arrow keys also moved the playhead ${playheadCalls} times`)
    }

    /* 3. cleared, then the handles dragged onto the same words */
    editor().setUrlRun(null)
    await frames()
    await drag('start', () => rowBox(2).top + 1)
    await drag('end', () => rowBox(5).bottom - 1)
    const dragged = editor().urlSource?.run ?? null
    expect(same(dragged, expected), `the handles dragged to rows 3–6 picked ${JSON.stringify(dragged)}, not ${JSON.stringify(expected)}`)
    const draggedRange = dragged ? runRange(t, dragged) : null
    const pickedRange = runRange(t, expected)
    const sameRange = Boolean(draggedRange && draggedRange.startMs === pickedRange.startMs && draggedRange.endMs === pickedRange.endMs)
    report.handles = { run: dragged, range: draggedRange, sameAsPicked: sameRange }
    expect(sameRange, 'the handles’ range differs from the click’s')

    /* 3b. rows 3–6 clicked, Start dragged into row 2's middle, row 7 shift-clicked: the dragged start stays */
    await pickRows(2, 5)
    await drag('start', () => {
      const box = rowBox(1)
      return box.top + 0.5 * (box.bottom - box.top)
    })
    const anchorDragged = editor().urlSource?.run ?? null
    rowTime(6).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }))
    await frames()
    const anchorExtended = editor().urlSource?.run ?? null
    const anchorExpected = anchorDragged ? { from: anchorDragged.from, to: rowsOf(t)[6].words[1] } : null
    report.anchor = { dragged: anchorDragged, extended: anchorExtended, expected: anchorExpected }
    expect(
      Boolean(anchorDragged && rowOfWord(rowsOf(t), anchorDragged.from) === 1 && anchorDragged.from > rowsOf(t)[1].words[0]),
      `Start dragged into row 2's middle landed on ${JSON.stringify(anchorDragged)}`
    )
    expect(same(anchorExtended, anchorExpected), `row 7 shift-clicked after the drag gave ${JSON.stringify(anchorExtended)}, not ${JSON.stringify(anchorExpected)}`)

    /* 4. the second chapter's chip */
    const chapter = editor().urlSource?.meta?.chapters[1] ?? null
    const chip = panel().querySelector<HTMLElement>('[data-chapter="1"]')
    if (!chapter || !chip) failures.push('no second chapter chip')
    else {
      chip.click()
      await frames()
    }
    const chapterRun = editor().urlSource?.run ?? null
    const chapterExpected = chapter ? runOfChapter(t, chapter) : null
    report.chapter = { title: chapter?.title ?? '', run: chapterRun, expected: chapterExpected }
    expect(same(chapterRun, chapterExpected), `the chapter chip picked ${JSON.stringify(chapterRun)}, not ${JSON.stringify(chapterExpected)}`)

    /* 4b. with the words on screen, Get reads Full download, and Enter does not press it; both labels measured */
    {
      const get = panel().querySelector<HTMLButtonElement>('button[data-get]')
      const box = panel().querySelector<HTMLInputElement>('input[placeholder="Paste a video link"]')
      const before = harnessIngests.length
      box?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
      await frames()
      const clip = button('Clip download')
      const fullDownload = {
        label: (get?.textContent ?? '').trim(),
        accent: Boolean(get?.className.includes('bg-accent-500')),
        enterStarted: harnessIngests.length - before,
        column: px(panel()),
        width: px(get),
        box: px(box),
        lines: labelLines(get),
        clip: { label: (clip?.textContent ?? '').trim(), width: px(clip), lines: labelLines(clip) }
      }
      report.fullDownload = fullDownload
      expect(Boolean(box), 'no link box in the URL tile')
      expect(fullDownload.label === 'Full download', `Get reads "${fullDownload.label}" while the words are shown`)
      expect(!fullDownload.accent, 'Get is still the accent button while the words are shown')
      expect(fullDownload.enterStarted === 0, `Enter in the link box started ${fullDownload.enterStarted} downloads while the words are shown`)
      expect(fullDownload.lines === 1, `"Full download" takes ${fullDownload.lines} lines`)
      expect(fullDownload.clip.label === 'Clip download', `Clip it's button reads "${fullDownload.clip.label}"`)
      expect(fullDownload.clip.lines === 1, `"Clip download" takes ${fullDownload.clip.lines} lines`)
    }

    /* 5. rows 3–6, Clip download → one job with exactly that range */
    await pickRows(2, 5)
    press('Clip download')
    await until(() => harnessIngests.length > jobsBefore && editor().urlSource?.clipped, 3000, 'Clip it starting a job')
    const first = seen(harnessIngests[jobsBefore])
    report.first = first
    expect(harnessIngests.length === jobsBefore + 1, `Clip it started ${harnessIngests.length - jobsBefore} jobs, not 1`)
    expect(first?.exact === true, 'Clip it’s job is not an exact cut')
    expect(
      first?.range?.startMs === pickedRange.startMs && first?.range?.endMs === pickedRange.endMs,
      `Clip it asked for ${JSON.stringify(first?.range)}, not the run's ${JSON.stringify(pickedRange)}`
    )
    expect(first?.sections === 1, `Clip it's argv holds ${first?.sections} --download-sections, not 1`)
    expect(first?.section === sectionOf(pickedRange), `Clip it's section is ${first?.section}, not ${sectionOf(pickedRange)}`)
    expect(same(first?.run, expected), 'Clip it’s job does not carry the run’s words')

    /* 6. Add another clip → rows kept, run cleared, nothing started */
    press('Add another clip')
    await frames()
    const another = { rows: rowCount(), run: editor().urlSource?.run ?? null, jobsStarted: harnessIngests.length - jobsBefore - 1 }
    report.another = another
    expect(another.rows === rows, `Add another clip left ${another.rows} rows`)
    expect(another.run === null, 'Add another clip kept the run')
    expect(another.jobsStarted === 0, `Add another clip started ${another.jobsStarted} jobs`)
    expect(button('Clip download') !== null, 'Clip download is not offered again after Add another clip')

    /* 7. rows 8–9, Clip download → a second job, one section, its own */
    await pickRows(7, 8)
    const secondRange = runRange(t, runFromRows(t, 7, 8))
    press('Clip download')
    await until(() => harnessIngests.length > jobsBefore + 1, 3000, 'the second Clip it starting a job')
    const second = seen(harnessIngests[jobsBefore + 1])
    report.second = second
    expect(harnessIngests.length === jobsBefore + 2, `the second Clip it left ${harnessIngests.length - jobsBefore} jobs, not 2`)
    expect(second?.sections === 1, `the second job's argv holds ${second?.sections} --download-sections, not 1`)
    expect(second?.section === sectionOf(secondRange), `the second job's section is ${second?.section}, not rows 8–9's ${sectionOf(secondRange)}`)
    expect(second?.section !== first?.section, 'the second job asked for the first one’s section')

    /* 8. the no-caption link */
    editor().setIngest({ url: HARNESS_LINKS.noCaptions })
    await frames()
    press('Get transcript')
    await until(() => editor().urlSource?.status === 'none', 3000, 'the no-caption link reading as no captions')
    await frames()
    const texts = [...panel().querySelectorAll('p, span')].map((el) => (el.textContent ?? '').trim())
    const listen = button('Listen to it')
    const reason = texts.find((text) => text === 'needs the AI helper') ?? null
    panel().querySelector<HTMLElement>('[data-chapter="0"]')?.click()
    await frames()
    const from = panel().querySelector<HTMLInputElement>('input[aria-label^="From"]')
    const noCaptions = {
      notice: texts.includes('This video has no captions'),
      listenDisabled: listen?.disabled === true,
      reason,
      fieldsEditable: Boolean(from && !from.readOnly && editor().ingest.useRange)
    }
    report.noCaptions = noCaptions
    expect(noCaptions.notice, 'the no-caption link does not say "This video has no captions"')
    expect(noCaptions.listenDisabled, 'Listen to it is not greyed')
    expect(reason !== null, 'Listen to it does not say it needs the AI helper')
    expect(noCaptions.fieldsEditable, 'From and To are not typed fields for the no-caption link')
    expect(rowsBox() === null, 'the no-caption link shows rows')

    /* 9. the Transcript tile: a clip of the talk's words at 2×, rows picked, Cut to these words, one undo */
    report.tile = await transcriptTile(t, expect)
  } catch (err) {
    // A step that could not go on: said after what had already failed, which is usually why.
    failures.push(`stopped: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    tool = 'url'
    useEditor.setState({
      urlSource: kept.urlSource,
      ingest: kept.ingest,
      pendingIngests: kept.pendingIngests,
      project: kept.project,
      past: kept.past,
      future: kept.future,
      dirty: kept.dirty,
      playhead: kept.playhead,
      selectedClipIds: kept.selectedClipIds,
      selectedClipId: kept.selectedClipId,
      clipRun: kept.clipRun
    })
    editor().setSidecar(kept.sidecarReady, kept.sidecarError)
    editor().setShelfTool(kept.shelfTool)
    await sleep(0)
  }

  report.ms = Math.round(performance.now() - started)
  if (failures.length > 0) {
    throw Object.assign(new Error(`clip-it check: ${failures.length} failed — ${failures.join('; ')}`), { report })
  }
  return report
}

/** Where Cut to these words sits against Listen for, px: the button's bottom never below the block's top. */
export interface CutLayout {
  /** The Transcript tile's column, and its scroll box's height and content height. */
  column: number
  height: number
  scrollHeight: number
  /** Whether the dock is on screen under the tile. */
  dock: boolean
  buttonBottom: number
  listenTop: number
  /** The tile's visible bottom, with its scroll at the top. */
  tileBottom: number
  clear: boolean
  /** The button on screen in the tile as it is, unscrolled — not below every row. */
  visible: boolean
}

/**
 * The review's geometry (2026-10-07): in the 240 px column with the dock open,
 * the rows' block was given 137.5 px of the 176 it needs, and the button was
 * drawn over Listen for — in the state the tile OPENS in, the hint three lines
 * long. `.click()` cannot see that; this measures it.
 */
function cutLayout(): CutLayout {
  const cut = button('Cut to these words')
  const listen = panel().querySelector('label[for="forge-vocabulary"]')?.parentElement ?? null
  // The tile's own scroll box: the panel is the `data-shelf-panel`.
  const box = panel()
  box.scrollTop = 0
  const b = cut?.getBoundingClientRect()
  const l = listen?.getBoundingClientRect()
  const t = box.getBoundingClientRect()
  const round = (n: number | undefined): number => (n === undefined ? -1 : Math.round(n * 10) / 10)
  return {
    column: px(panel()),
    height: box.clientHeight,
    scrollHeight: box.scrollHeight,
    dock: document.querySelector('[data-dock]') !== null,
    buttonBottom: round(b?.bottom),
    listenTop: round(l?.top),
    tileBottom: round(t.top + box.clientHeight),
    clear: Boolean(b && l && b.height > 0 && b.bottom <= l.top + 0.5),
    visible: Boolean(b && b.height > 0 && b.bottom <= t.top + box.clientHeight + 0.5)
  }
}

type Edges = { start: number; inPoint: number; duration: number }
const edges = (c: Clip): Edges => ({ start: c.start, inPoint: c.inPoint, duration: c.duration })
const sameEdges = (a: Edges | null | undefined, b: Edges | null | undefined): boolean =>
  Boolean(a && b && a.start === b.start && a.inPoint === b.inPoint && a.duration === b.duration)

/**
 * Step 9 (§3b.6): the talk's words on a clip of the timeline, at 2×, cut to
 * rows 3–6 from the Transcript tile. The asset is made here and marked
 * offline — the preview draws "Media offline" and loads nothing — because the
 * tile reads only the clip and its transcript; the transcript is the bridge's
 * own stub, given the asset's id.
 */
async function transcriptTile(talk: Transcript, expect: (ok: boolean, what: string) => void): Promise<ClipItReport['tile']> {
  const fps = editor().project.settings.fps
  const asset: MediaAsset = {
    id: `harness-talk-${Date.now().toString(36)}`,
    path: 'harness://clip-it/talk.webm',
    name: 'harness talk',
    kind: 'video',
    durationFrames: 150 * fps,
    width: 1280,
    height: 720,
    fps,
    hasVideo: true,
    hasAudio: true,
    size: 1,
    offline: true
  }
  editor().update((p) => ({
    ...p,
    assets: [...p.assets, asset],
    transcripts: { ...p.transcripts, [asset.id]: { ...talk, assetId: asset.id } }
  }))
  const placed = new Set(editor().project.clips.map((c) => c.id))
  editor().addAssetToTimeline(asset.id)
  const V = editor().project.clips.find((c) => !placed.has(c.id))?.id
  if (!V) throw new Error('the talk did not land on the timeline')
  editor().setClipSpeed(V, 2)
  editor().select(V)
  tool = 'transcript'
  editor().setShelfTool('transcript')
  await until(
    () => document.querySelectorAll('[data-shelf-tool="transcript"] [data-shelf-panel]').length === 1 && rowCount() > 0,
    3000,
    'the Transcript tile showing rows'
  )

  const clip = (): Clip => {
    const found = editor().project.clips.find((c) => c.id === V)
    if (!found) throw new Error('the talk’s clip is gone')
    return found
  }
  const before = clip()
  const transcript = editor().project.transcripts[asset.id]
  const words = transcript ? clipWords(transcript, clipSourceWindow(before, fps)) : null
  if (!words) throw new Error('the talk’s clip plays none of its words')
  const w = words.transcript
  const rows = rowCount()
  expect(rows === 12 && rows === rowsOf(w).length, `the Transcript tile shows ${rows} rows, not 12`)

  // Row 3's time is where it is on the TIMELINE: at 2× its words come at half their source time.
  const row3 = rowsOf(w)[2]
  const stampExpected = rowStamp((before.start * 1000) / fps + row3.startMs / 2)
  const stamp = (rowTime(2).textContent ?? '').trim()
  expect(stamp === stampExpected, `row 3 shows ${stamp}, not its time on the timeline at 2×, ${stampExpected} (its source time is ${rowStamp(row3.startMs)})`)
  const mapped = rowStamp(((timelineFrameAt(before, row3.startMs, fps) ?? -1) / fps) * 1000)
  expect(mapped === stampExpected, `timelineFrameAt puts row 3 at ${mapped}, not ${stampExpected}`)

  // The tile as it opens, nothing picked (the hint at its longest): the cut never drawn over Listen for.
  const idle = cutLayout()
  expect(idle.dock, 'the dock is not open under the Transcript tile, so the layout was not measured with it')
  expect(idle.clear, `with nothing picked, Cut to these words (bottom ${idle.buttonBottom}) is drawn over Listen for (top ${idle.listenTop}) in the ${idle.column} px column`)
  // …and on screen without scrolling: the rows scroll, not the tile (a rows' basis of 0 % made the block every row tall — measured).
  expect(idle.visible, `with nothing picked, Cut to these words (bottom ${idle.buttonBottom}) is below the tile's visible bottom (${idle.tileBottom})`)

  await pickRows(2, 5)
  const picked = cutLayout()
  expect(picked.clear, `with a run picked, Cut to these words (bottom ${picked.buttonBottom}) is drawn over Listen for (top ${picked.listenTop}) in the ${picked.column} px column`)
  expect(picked.visible, `with a run picked, Cut to these words (bottom ${picked.buttonBottom}) is below the tile's visible bottom (${picked.tileBottom})`)
  const expected = runFromRows(w, 2, 5)
  const pick = editor().clipRun
  const run = pick && pick.clipId === V && pick.words === w ? pick.run : null
  expect(same(run, expected), `rows 3–6 in the Transcript tile picked ${JSON.stringify(run)}, not ${JSON.stringify(expected)}`)
  const startMs = w.words[expected.from].startMs
  const endMs = w.words[expected.to].endMs
  const cut = cutFrames(before, startMs, endMs, fps)
  const playhead = editor().playhead
  expect(cut !== null && playhead === cut.from, `the playhead is on ${playhead}, not the cut's first frame ${cut?.from}`)
  const line = ([...panel().querySelectorAll('p')].find((p) => (p.textContent ?? '').endsWith('selected'))?.textContent ?? '').trim()
  const lineExpected = cut ? `${formatMark(((cut.to - cut.from) / fps) * 1000)} selected` : '?'
  expect(line === lineExpected, `the cut's length line reads "${line}", not "${lineExpected}"`)

  const predicted = clipToRange(editor().project, V, startMs, endMs).project.clips.find((c) => c.id === V) ?? null
  const steps = editor().past.length
  press('Cut to these words')
  await frames()
  const after = clip()
  const undoSteps = editor().past.length - steps
  expect(
    sameEdges(edges(after), predicted ? edges(predicted) : null),
    `the cut clip is ${JSON.stringify(edges(after))}, not clipToRange's ${JSON.stringify(predicted ? edges(predicted) : null)}`
  )
  expect(after.start === before.start, `the cut moved the clip from ${before.start} to ${after.start}`)
  expect(after.speed === 2, `the cut clip plays at ${after.speed}, not 2×`)
  // Every kept frame shows the footage it showed before the cut.
  const shift = (cut?.from ?? before.start) - before.start
  const moved: number[] = []
  for (let f = after.start; f < after.start + after.duration; f++) {
    if (sourceFrameFor(after, f) !== sourceFrameFor(before, f + shift)) moved.push(f)
  }
  expect(moved.length === 0, `${moved.length} kept frames show other footage than before the cut, first ${moved[0]}`)
  // The words whole: it opens on the first word's frame (or the one before, at 2×) and ends on the last's.
  const startFrame = Math.floor((startMs * fps) / 1000)
  const endFrame = Math.ceil((endMs * fps) / 1000)
  const firstShown = sourceFrameFor(after, after.start)
  const lastShown = sourceFrameFor(after, after.start + after.duration - 1)
  expect(firstShown <= startFrame && firstShown > startFrame - 2, `the cut opens on source frame ${firstShown}, not the first word's ${startFrame}`)
  expect(lastShown < endFrame && lastShown >= endFrame - 2, `the cut ends on source frame ${lastShown}, not the last word's (before ${endFrame})`)
  expect(undoSteps === 1, `Cut to these words added ${undoSteps} undo steps, not 1`)

  editor().undo()
  await frames()
  const undone = clip()
  expect(sameEdges(edges(undone), edges(before)), `one undo left ${JSON.stringify(edges(undone))}, not ${JSON.stringify(edges(before))}`)

  return {
    rows,
    stamp,
    stampExpected,
    run,
    expected,
    playhead,
    line,
    before: edges(before),
    after: edges(after),
    expectedAfter: predicted ? edges(predicted) : { start: -1, inPoint: -1, duration: -1 },
    undoSteps,
    undone: edges(undone),
    layout: { idle, picked }
  }
}

export function installClipItCheck(): void {
  ;(window as unknown as { __forgeClipItCheck: typeof runClipItCheck }).__forgeClipItCheck = runClipItCheck
}
