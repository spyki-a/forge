/**
 * Clip it from a link's transcript, clicked through in the running page
 * (docs/CLIPS.md §3b.8, M0's half; slice 3 adds the Transcript tile's).
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
 *   4b. With the words on screen, Get reads "Whole video", is not the
 *      accent button, and Enter in the link box starts nothing.
 *   5. Rows 3–6 again, Clip it → one job, exact, with exactly the run's range,
 *      its argv holding one `--download-sections` (counted with `filter`).
 *   6. Add another clip → the rows kept, the run cleared, no job started.
 *   7. Rows 8–9, Clip it → a second job, its argv holding one
 *      `--download-sections`, and that one is rows 8–9's, not the first's.
 *   8. The no-caption link → "This video has no captions", Listen to it greyed
 *      with "needs the AI helper", and a chapter chip setting From and To,
 *      which are typed fields again.
 *
 * Run it in the FRONTED tab on a freshly loaded page: React's updates are
 * waited for with animation frames, which a background tab never runs. The
 * store and the Shelf are put back afterwards; the bridge's record of the two
 * jobs stays, and says what was asked.
 */

import type { Transcript } from '@shared/transcript'
import { formatMark, type Range } from '@shared/ingest/section'
import { rowOfWord, rowsOf, runFromRows, runOfChapter, runRange, type WordRun } from '@shared/ingest/wordRun'
import { useEditor } from '../store'
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
  getWhole: { label: string; accent: boolean; enterStarted: number } | null
  first: ClipItJobSeen | null
  another: { rows: number; run: WordRun | null; jobsStarted: number } | null
  second: ClipItJobSeen | null
  noCaptions: { notice: boolean; listenDisabled: boolean; reason: string | null; fieldsEditable: boolean } | null
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

function panel(): Element {
  const found = document.querySelectorAll('[data-shelf-tool="url"] [data-shelf-panel]')
  if (found.length !== 1) throw new Error(`clip-it check: expected the URL tile's panel, found ${found.length}`)
  return found[0]
}

function button(text: string): HTMLButtonElement | null {
  return [...panel().querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === text) ?? null
}

function press(text: string): HTMLButtonElement {
  const b = button(text)
  if (!b) throw new Error(`clip-it check: no "${text}" button in the URL tile`)
  b.click()
  return b
}

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
    getWhole: null,
    first: null,
    another: null,
    second: null,
    noCaptions: null,
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
    sidecarError: before.sidecarError
  }
  const jobsBefore = harnessIngests.length

  try {
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

    /* 4b. with the words on screen, Get says it takes the whole video, and Enter does not press it */
    {
      const get = panel().querySelector<HTMLButtonElement>('button[data-get]')
      const box = panel().querySelector<HTMLInputElement>('input[placeholder="Paste a video link"]')
      const before = harnessIngests.length
      box?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
      await frames()
      const getWhole = {
        label: (get?.textContent ?? '').trim(),
        accent: Boolean(get?.className.includes('bg-accent-500')),
        enterStarted: harnessIngests.length - before
      }
      report.getWhole = getWhole
      expect(Boolean(box), 'no link box in the URL tile')
      expect(getWhole.label === 'Whole video', `Get reads "${getWhole.label}" while the words are shown`)
      expect(!getWhole.accent, 'Get is still the accent button while the words are shown')
      expect(getWhole.enterStarted === 0, `Enter in the link box started ${getWhole.enterStarted} downloads while the words are shown`)
    }

    /* 5. rows 3–6, Clip it → one job with exactly that range */
    await pickRows(2, 5)
    press('Clip it')
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
    expect(button('Clip it') !== null, 'Clip it is not offered again after Add another clip')

    /* 7. rows 8–9, Clip it → a second job, one section, its own */
    await pickRows(7, 8)
    const secondRange = runRange(t, runFromRows(t, 7, 8))
    press('Clip it')
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

  } catch (err) {
    // A step that could not go on: said after what had already failed, which is usually why.
    failures.push(`stopped: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    useEditor.setState({
      urlSource: kept.urlSource,
      ingest: kept.ingest,
      pendingIngests: kept.pendingIngests
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

export function installClipItCheck(): void {
  ;(window as unknown as { __forgeClipItCheck: typeof runClipItCheck }).__forgeClipItCheck = runClipItCheck
}
