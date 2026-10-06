import { memo, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpToLine } from 'lucide-react'
import type { Transcript } from '@shared/transcript'
import {
  extendRun,
  msAtY,
  rowOfWord,
  rowsOf,
  runFromRows,
  snapHandle,
  stepHandle,
  type TranscriptRow,
  type WordRun
} from '@shared/ingest/wordRun'

/**
 * A transcript as rows of `time | text`, and the two ways to pick a run of
 * its words (docs/CLIPS.md §3b.2) — one component for both tiles: the URL
 * tile's transcript of a link, and (slice 3) a timeline clip's in the
 * Transcript tile.
 *
 *   click a row's time or a word     that row's words
 *   shift-click another row's time   every row between it and the row last clicked — or, when the
 *                                    run was last set another way, the run on screen extended to it
 *   shift-click a word               the run's end moves to that word (its start, for a word before it)
 *   drag Start or End along the rows Start snaps to a word's start, End to a word's end,
 *                                    and neither passes the other; the arrow keys move either a word
 *
 * The anchor a row shift-click extends from is the row last CLICKED, and only
 * while nothing else has moved the run since: a drag, an arrow key or a word
 * shift-click sets it to null, so the next row shift-click keeps the start (or
 * end) those put on screen instead of reaching back to a row the run no
 * longer starts at.
 *
 * A handle the arrow keys move into another row is a new element there (each
 * row draws the handles standing in it), so focus is put back on it once the
 * row has been drawn — or a keyboard user would drop to the page at every
 * row. The keys a handle takes stop at it: the window's own arrows move the
 * playhead.
 *
 * Every handler sits on the rows' box and reads what was pressed from the
 * element under it (`data-word`, `data-row-time`, `data-handle`), so the rows
 * themselves are plain markup and only a row whose picked words changed is
 * drawn again — a talk is ten thousand words, and a handle drag redraws on
 * every pointer move. A drag captures the pointer on the box, which stays put
 * while the handle itself moves from row to row.
 *
 * Rows are `capSegments(t, 30, 15000)` (wordRun.ts `rowsOf`), never written
 * back into the transcript.
 */

export const ROW_TIME_TITLE = 'Click to pick this row’s words; shift-click to extend the pick to this row'
export const START_TITLE = 'Start — drag along the rows; it snaps to the start of a word'
export const END_TITLE = 'End — drag along the rows; it snaps to the end of a word'

/** A row's start as `m:ss`, or `h:mm:ss` an hour in. */
export function rowStamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export interface TranscriptRowsProps {
  transcript: Transcript
  /** The words picked, or null for none: the handles then rest at the first and last word. */
  run: WordRun | null
  /** The row a shift-click on another row extends from: the row last clicked, or null when the run was set another way since. */
  anchorRow: number | null
  onChange: (run: WordRun, anchorRow: number | null) => void
}

/** Where a handle stands in a row, for the row to draw it. */
interface HandleAt {
  which: 'start' | 'end'
  word: number
  last: number
  stamp: string
}

const ROW_TIME = 'data-row-time'
const WORD = 'data-word'
const HANDLE = 'data-handle'
const DRAGGING = 'data-dragging'
/** The handles of a row with none — one array, so an unchanged row stays unchanged for `memo`. */
const NO_HANDLES: HandleAt[] = []

/** After React has drawn the next frame: requestAnimationFrame, or a timer where there is none. */
const afterDraw = (f: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => f())
  else setTimeout(f, 0)
}

/** The number in a data attribute of the nearest element carrying it, or null. */
function attrOf(target: EventTarget | null, attr: string): string | null {
  const el = target as { closest?: (selector: string) => Element | null } | null
  return el?.closest?.(`[${attr}]`)?.getAttribute(attr) ?? null
}

/**
 * One row: markup only. Its picked words are `lo..hi` (-1 for none), and the
 * handles that stand in it are drawn in its gutter.
 */
const Row = memo(function Row({
  t,
  index,
  row,
  lo,
  hi,
  handles
}: {
  t: Transcript
  index: number
  row: TranscriptRow
  lo: number
  hi: number
  handles: HandleAt[]
}): ReactNode {
  const words: ReactNode[] = []
  for (let w = row.words[0]; w <= row.words[1]; w++) {
    const picked = w >= lo && w <= hi && lo >= 0
    words.push(
      <span
        key={w}
        data-word={w}
        className={`cursor-pointer rounded-sm px-[1px] ${picked ? 'bg-accent-900 text-ink-200' : 'hover:bg-ink-800'}`}
      >
        {t.words[w].text}
      </span>,
      ' '
    )
  }
  return (
    <div data-row={index} className="flex items-start gap-1 border-b border-ink-850 py-1 pr-2">
      <div className="flex w-3.5 shrink-0 flex-col items-center gap-0.5 pt-0.5">
        {handles.map((h) => (
          <span
            key={h.which}
            role="slider"
            tabIndex={0}
            data-handle={h.which}
            aria-label={h.which === 'start' ? 'Start' : 'End'}
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={h.last}
            aria-valuenow={h.word}
            aria-valuetext={h.stamp}
            title={h.which === 'start' ? START_TITLE : END_TITLE}
            className="flex h-3.5 w-3.5 cursor-ns-resize touch-none items-center justify-center rounded-sm bg-accent-500 text-ink-950 outline-none focus-visible:ring-2 focus-visible:ring-accent-300"
          >
            {h.which === 'start' ? <ArrowDownToLine size={9} strokeWidth={2.4} /> : <ArrowUpToLine size={9} strokeWidth={2.4} />}
          </span>
        ))}
      </div>
      <button
        type="button"
        data-row-time={index}
        title={ROW_TIME_TITLE}
        className={`w-9 shrink-0 pt-px text-left font-mono text-[10px] tabular-nums transition-colors ${
          lo >= 0 ? 'text-accent-400' : 'text-ink-600 hover:text-ink-300'
        }`}
      >
        {rowStamp(row.startMs)}
      </button>
      <span className="min-w-0 flex-1 text-[11px] leading-snug text-ink-300">{words}</span>
    </div>
  )
})

export function TranscriptRows({ transcript: t, run, anchorRow, onChange }: TranscriptRowsProps): ReactNode {
  const rows = rowsOf(t)
  const last = t.words.length - 1
  // With nothing picked the handles rest at the ends, as a trimmer's do.
  const current: WordRun = run ?? { from: 0, to: last }
  const startRow = rowOfWord(rows, current.from)
  const endRow = rowOfWord(rows, current.to)

  const pickRow = (r: number, shift: boolean): void => {
    if (!shift || !run) {
      onChange(runFromRows(t, r, r), r)
    } else if (anchorRow !== null) {
      // From the row last clicked, either way.
      onChange(runFromRows(t, anchorRow, r), anchorRow)
    } else {
      // The run on screen, extended to the row as a word shift-click extends it to a word.
      const wider = r >= rowOfWord(rows, run.from) ? { from: run.from, to: rows[r].words[1] } : { from: rows[r].words[0], to: run.to }
      onChange(wider, null)
    }
  }

  const onClick = (e: MouseEvent<HTMLDivElement>): void => {
    const word = attrOf(e.target, WORD)
    if (word !== null) {
      const w = Number(word)
      if (e.shiftKey) onChange(extendRun(run, w), null)
      else pickRow(rowOfWord(rows, w), false)
      return
    }
    const time = attrOf(e.target, ROW_TIME)
    if (time !== null) pickRow(Number(time), e.shiftKey)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const which = attrOf(e.target, HANDLE)
    if (which !== 'start' && which !== 'end') return
    const delta = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0
    if (delta === 0) return
    e.preventDefault()
    e.stopPropagation()
    onChange(stepHandle(t, which, delta, current), null)
    const box = e.currentTarget
    afterDraw(() => box.querySelector<HTMLElement>(`[${HANDLE}="${which}"]`)?.focus())
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    const which = attrOf(e.target, HANDLE)
    if (which !== 'start' && which !== 'end') return
    e.preventDefault()
    e.currentTarget.setAttribute(DRAGGING, which)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // A synthetic pointer (the harness check) has nothing to capture; the drag still follows the box.
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const which = e.currentTarget.getAttribute(DRAGGING)
    if (which !== 'start' && which !== 'end') return
    const boxes = [...e.currentTarget.querySelectorAll('[data-row]')].map((el) => {
      const box = el.getBoundingClientRect()
      const row = rows[Number(el.getAttribute('data-row'))]
      return { top: box.top, bottom: box.bottom, startMs: row.startMs, endMs: row.endMs }
    })
    const ms = msAtY(boxes, e.clientY)
    if (ms === null) return
    const next = snapHandle(t, which, ms, current)
    if (!run || next.from !== run.from || next.to !== run.to) onChange(next, null)
  }

  const endDrag = (e: PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.removeAttribute(DRAGGING)
  }

  const handlesIn = (r: number): HandleAt[] => {
    if (r !== startRow && r !== endRow) return NO_HANDLES
    const out: HandleAt[] = []
    if (r === startRow) out.push({ which: 'start', word: current.from, last, stamp: rowStamp(t.words[current.from].startMs) })
    if (r === endRow) out.push({ which: 'end', word: current.to, last, stamp: rowStamp(t.words[current.to].endMs) })
    return out
  }

  return (
    <div
      data-transcript-rows
      onClick={onClick}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      className="max-h-72 overflow-y-auto rounded border border-ink-800 bg-ink-950/60 select-none"
    >
      {rows.map((row, r) => {
        const inRun = run !== null && row.words[1] >= run.from && row.words[0] <= run.to
        return (
          <Row
            key={r}
            t={t}
            index={r}
            row={row}
            lo={inRun ? Math.max(run.from, row.words[0]) : -1}
            hi={inRun ? Math.min(run.to, row.words[1]) : -1}
            handles={handlesIn(r)}
          />
        )
      })}
    </div>
  )
}
