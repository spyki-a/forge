import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pencil, Scissors } from 'lucide-react'
import { clipCoversFrame, formatTimecode, sourceFrameFor, timelineFrameAt, type Clip } from '@shared/timeline'
import type { Segment, Transcript, Word } from '@shared/transcript'
import {
  clipEditWords,
  clipSourceWindow,
  clipWords,
  cutFrames,
  DETACHED_NOTE,
  HOLD_NOTE,
  type ClipWords as ClipWordsOf
} from '@shared/edit/clipIt'
import { clampRun, rowsOf, type WordRun } from '@shared/ingest/wordRun'
import { formatMark } from '@shared/ingest/section'
import { useEditor } from '../store'
import { rowStamp, TranscriptRows } from './tools/TranscriptRows'

/**
 * Transcript for the selected clip — the words it plays — with click-to-seek,
 * a run of them picked to cut the clip to (docs/CLIPS.md §3b.6, sheet 26),
 * and, in Edit, click-to-correct (FIX.md B3).
 *
 * Word times are milliseconds into the SOURCE, so mapping one to the timeline
 * goes through the clip: its in-point, and its speed — at 2× a second of
 * source is half a second of timeline, and along a ramp neither is constant.
 * Every mapping here is `sourceFrameFor` or its inverse `timelineFrameAt`
 * (timeline.ts); the first version added the in-point and ignored speed, so a
 * row of a 2× clip jumped twice as far as its word.
 *
 * The rows are the words the clip PLAYS (`clipWords`): a trimmed clip of a long
 * talk lists its own part, so every row can be jumped to and cut to, and a cut
 * — **Cut to these words**, `clipToRange` — is a trim of in-point and length,
 * one undo. A hold shows one frame for its whole length, so it has no words of
 * its own to cut to and says so; so does a picture whose sound was lifted onto
 * a track of its own, which a cut would put out of sync with it. Edit still
 * works on both (`clipEditWords`): it lists every word the clip's captions
 * burn, or a hold's whole transcript, and is not offered when there are none.
 *
 * A corrected word keeps its timing and the captions read the transcript live,
 * so a misheard name is fixed once, here, and is right in every caption of the
 * preview and the export. The vocabulary below is what stops it being misheard
 * next time: names spelled for the model before it listens.
 */

export const CUT_TITLE = 'Trims this clip to the words you picked'
export const CLIP_ROWS_HINT = 'Click a row to jump there and pick its words; shift-click another row, or a word, to extend. Or drag Start and End.'
export const NO_WORDS_TEXT = 'No words are spoken in this clip'

export function TranscriptPanel(): ReactNode {
  const project = useEditor((s) => s.project)
  const selectedClipId = useEditor((s) => s.selectedClipId)
  const [editing, setEditing] = useState(false)

  const clip = project.clips.find((c) => c.id === selectedClipId) ?? null
  const transcript = clip ? project.transcripts[clip.assetId] ?? null : null
  const fps = project.settings.fps

  if (!clip) {
    return <Empty>Select a clip to see its transcript</Empty>
  }

  // Edit is offered while there is something of this clip's to correct.
  const editable = transcript ? clipEditWords(clip, transcript, fps) !== null : false

  /*
   * The root is the tile's height, and the rows' block takes what is left — but
   * never less than its own hint, line and button under the rows' least
   * (`ClipWords`): in a short column the tile scrolls instead, rather than the
   * button being drawn over Listen for (the review's 240 px column, the dock
   * open: the block was given 137.5 px of the 176 it needs).
   */
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-400">
          Transcript
        </span>
        {transcript && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-ink-600">
              {transcript.language} · {transcript.words.length} words
            </span>
            {editable && (
              <button
                onClick={() => setEditing((on) => !on)}
                title={editing ? 'Stop correcting' : 'Correct a misheard word: click it, type, Enter'}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                  editing ? 'bg-accent-500 font-medium text-ink-950' : 'text-ink-500 hover:bg-ink-800 hover:text-ink-200'
                }`}
              >
                <Pencil size={10} />
                {editing ? 'Done' : 'Edit'}
              </button>
            )}
          </div>
        )}
      </div>

      <TranscriptBody clip={clip} transcript={transcript} editing={editing} />

      <Vocabulary assetId={clip.assetId} hasTranscript={Boolean(transcript)} />
    </div>
  )
}

/**
 * What sits between the header and Listen for: Edit's words while correcting,
 * else the rows — or the line saying why there are none (no transcript, a
 * hold, a lifted sound, nothing said). No hook but the store's, so a test can
 * draw it with Edit on (tests/renderer/transcriptPanel.test.tsx).
 */
export function TranscriptBody({ clip, transcript, editing }: { clip: Clip; transcript: Transcript | null; editing: boolean }): ReactNode {
  const fps = useEditor((s) => s.project.settings.fps)
  if (!transcript) return <Empty>No transcript yet — transcribe it below, or with the caption button in Upload</Empty>
  const editWords = editing ? clipEditWords(clip, transcript, fps) : null
  if (editWords) return <EditClipWords clip={clip} transcript={transcript} words={editWords} />
  if (clip.hold) return <Note>{HOLD_NOTE}</Note>
  if (clip.audioDetached) return <Note>{DETACHED_NOTE}</Note>
  // The words this clip plays, numbered from 0.
  const words = clipWords(transcript, clipSourceWindow(clip, fps))
  if (!words) return <Note>{NO_WORDS_TEXT}</Note>
  return <ClipWords clip={clip} words={words.transcript} />
}

/**
 * The rows of the words a clip plays, a run picked from them, and **Cut to
 * these words** (§3b.6) — `TranscriptRows`, the URL tile's own, with the same
 * click and shift-click and the same Start and End handles.
 *
 * A row's time is where it is on the TIMELINE, through the clip's speed, and
 * picking moves the playhead to where the cut would open — so a click on a row
 * still jumps there, as the panel always did, and the picture shows the cut's
 * first frame while Start is dragged. The line under the rows says how long
 * the clip will be, on the timeline. The pick is the store's (`clipRun`), and
 * shown only while it was made over these same words.
 *
 * No hook but the store's, so a test can call it as a function and press what
 * it returns (tests/renderer/transcriptPanel.test.tsx).
 */
export function ClipWords({ clip, words: t }: { clip: Clip; words: Transcript }): ReactNode {
  const fps = useEditor((s) => s.project.settings.fps)
  const playhead = useEditor((s) => s.playhead)
  const clipRun = useEditor((s) => s.clipRun)
  const setClipRun = useEditor((s) => s.setClipRun)
  const setPlayhead = useEditor((s) => s.setPlayhead)
  const cutToWords = useEditor((s) => s.cutToWords)

  const pick = clipRun && clipRun.clipId === clip.id && clipRun.words === t ? clipRun : null
  const run = pick?.run ?? null
  const cutOf = (r: WordRun): { from: number; to: number } | null => {
    const at = clampRun(t, r)
    return cutFrames(clip, t.words[at.from].startMs, t.words[at.to].endMs, fps)
  }
  const cut = run ? cutOf(run) : null
  // A source time as the rows show it: the timeline's m:ss of the frame it is shown on.
  const stampOf = (ms: number): string => rowStamp(((timelineFrameAt(clip, ms, fps) ?? clip.start) / fps) * 1000)
  // The row under the playhead, while it is over this clip.
  const sourceMs = clipCoversFrame(clip, playhead) ? (sourceFrameFor(clip, playhead) * 1000) / fps : null
  const activeRow = sourceMs === null ? -1 : rowsOf(t).findIndex((row) => sourceMs >= row.startMs && sourceMs < row.endMs)

  return (
    /*
     * The rows scroll; the line and the cut under them stay put. Not `min-h-0`:
     * the block's least is its own — the rows' 4.5 rem (their basis is 0 px, so
     * their words do not count), the line and the button — so a short tile
     * scrolls as a whole instead of drawing the button over Listen for.
     */
    <div className="flex flex-1 flex-col px-3 py-2">
      <TranscriptRows
        transcript={t}
        run={run}
        anchorRow={pick?.anchorRow ?? null}
        stampOf={stampOf}
        activeRow={activeRow}
        fill
        onChange={(next, anchor) => {
          setClipRun(clip.id, t, next, anchor)
          const at = cutOf(next)
          if (at) setPlayhead(at.from)
        }}
      />
      {cut ? (
        <p className="mt-2 shrink-0 text-[10.5px] text-ink-300">
          <span className="tabular-nums">{formatMark(((cut.to - cut.from) / fps) * 1000)}</span> selected
        </p>
      ) : (
        <p className="mt-2 shrink-0 text-[10.5px] leading-snug text-ink-500">{CLIP_ROWS_HINT}</p>
      )}
      <button
        type="button"
        onClick={() => cutToWords()}
        disabled={!cut}
        title={CUT_TITLE}
        className="mt-2 flex shrink-0 items-center gap-1.5 self-start rounded bg-accent-500 px-3 py-1.5 text-[11px] font-medium text-ink-950 transition-colors hover:bg-accent-400 disabled:opacity-40"
      >
        <Scissors size={12} />
        Cut to these words
      </button>
    </div>
  )
}

/**
 * Edit: the clip's words sentence by sentence, each clickable to correct — its
 * timecode where it is on the timeline. Every word the clip plays ANY part of
 * (`clipEditWords`), which is a little more than the rows' (a word the clip's
 * edge cuts through is still burned into its captions, so it must be
 * correctable from it); for a hold, the whole transcript. They are numbered by
 * position here (`clipWords`), so a correction goes back to the store by the
 * WHOLE transcript's own index, which can differ: an emptied word leaves a gap
 * there and nothing is renumbered.
 *
 * No hook but the store's (tests/renderer/transcriptPanel.test.tsx).
 */
export function EditClipWords({ clip, transcript, words }: { clip: Clip; transcript: Transcript; words: ClipWordsOf }): ReactNode {
  const fps = useEditor((s) => s.project.settings.fps)
  const editTranscriptWord = useEditor((s) => s.editTranscriptWord)
  const t = words.transcript
  return (
    <div className="flex-1 overflow-y-auto">
      <p className="border-b border-ink-850 px-3 py-1.5 text-[10px] leading-snug text-ink-600">
        Click a word to correct it — Enter keeps it, Esc leaves it, and an empty word is taken
        out. Its timing stays, and the captions follow.
      </p>
      {t.segments.map((segment) => (
        <EditableSegment
          key={segment.id}
          transcript={t}
          segment={segment}
          timecode={formatTimecode(timelineFrameAt(clip, segment.startMs, fps) ?? clip.start, fps)}
          onEdit={(index, text) => editTranscriptWord(clip.assetId, transcript.words[words.first + index].index, text)}
        />
      ))}
    </div>
  )
}

/** One segment, its words each clickable to correct. */
function EditableSegment({
  transcript,
  segment,
  timecode,
  onEdit
}: {
  transcript: Transcript
  segment: Segment
  timecode: string
  onEdit: (index: number, text: string) => void
}): ReactNode {
  const words = transcript.words.filter((w) => w.index >= segment.wordStart && w.index <= segment.wordEnd)
  return (
    <div className="flex gap-2 border-b border-ink-850 px-3 py-1.5">
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-600">{timecode}</span>
      <span className="flex flex-wrap gap-x-1 gap-y-0.5 text-[11.5px] leading-snug text-ink-300">
        {words.map((word) => (
          <EditableWord key={word.index} word={word} onEdit={(text) => onEdit(word.index, text)} />
        ))}
      </span>
    </div>
  )
}

function EditableWord({ word, onEdit }: { word: Word; onEdit: (text: string) => void }): ReactNode {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(word.text)
  const input = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (open) input.current?.select()
  }, [open])

  if (!open) {
    // A word the model was unsure of says so: it is the likeliest to be wrong.
    const unsure = word.confidence !== null && word.confidence < 0.5
    return (
      <button
        onClick={() => {
          setDraft(word.text)
          setOpen(true)
        }}
        title={unsure ? 'The transcriber was unsure of this word' : 'Click to correct'}
        className={`rounded px-0.5 hover:bg-ink-800 hover:text-ink-100 ${unsure ? 'underline decoration-accent-500/60 decoration-dotted underline-offset-2' : ''}`}
      >
        {word.text}
      </button>
    )
  }
  const commit = (): void => {
    setOpen(false)
    if (draft !== word.text) onEdit(draft)
  }
  return (
    <input
      ref={input}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // Kept from the shortcut layer: these keys belong to the text box now.
        e.stopPropagation()
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setOpen(false)
      }}
      size={Math.max(3, draft.length + 1)}
      className="rounded bg-ink-800 px-1 text-[11.5px] text-ink-100 outline-none ring-1 ring-accent-500/60"
    />
  )
}

/**
 * The names and words the transcriber listens for.
 *
 * Saved on leaving the field rather than on every keystroke, so typing a list
 * of names is one undo step, not forty. Transcribing again replaces the words,
 * corrections included — the button says so.
 */
function Vocabulary({ assetId, hasTranscript }: { assetId: string; hasTranscript: boolean }): ReactNode {
  const vocabulary = useEditor((s) => s.project.vocabulary ?? '')
  const setVocabulary = useEditor((s) => s.setVocabulary)
  const transcribeAsset = useEditor((s) => s.transcribeAsset)
  const busy = useEditor((s) => Boolean(s.transcribing[assetId]))
  const [draft, setDraft] = useState(vocabulary)
  useEffect(() => setDraft(vocabulary), [vocabulary])

  return (
    <div className="space-y-1 border-t border-ink-800 px-3 py-2">
      <label className="block text-[10px] text-ink-500" htmlFor="forge-vocabulary">
        Listen for — names and words, separated by commas
      </label>
      <textarea
        id="forge-vocabulary"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setVocabulary(draft)}
        onKeyDown={(e) => e.stopPropagation()}
        rows={2}
        placeholder="Priya, Arjun, Taj Falaknuma, Syncpod"
        className="w-full resize-none rounded bg-ink-850 px-2 py-1 text-[11px] text-ink-200 outline-none placeholder:text-ink-600 focus:ring-1 focus:ring-ink-600"
      />
      <button
        onClick={() => {
          setVocabulary(draft)
          void transcribeAsset(assetId)
        }}
        disabled={busy}
        title={hasTranscript ? 'Transcribe this clip again with these words — corrections made here are replaced' : 'Transcribe this clip, listening for these words'}
        className="w-full rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-300 transition-colors hover:bg-ink-700 hover:text-ink-100 disabled:opacity-40"
      >
        {busy ? 'Transcribing…' : hasTranscript ? 'Transcribe again with these words' : 'Transcribe'}
      </button>
    </div>
  )
}

/** A line where the rows would be, saying why there are none. */
function Note({ children }: { children: ReactNode }): ReactNode {
  return <p className="flex-1 px-3 py-3 text-[11px] leading-snug text-ink-500">{children}</p>
}

function Empty({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center text-[11px] text-ink-600">
      {children}
    </div>
  )
}
