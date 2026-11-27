import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, DownloadCloud, Loader2, Scissors } from 'lucide-react'
import { useEditor, wordsShown } from '../store'
import { QUALITIES, type Quality } from '@shared/ingest/format'
import { linkProblem, LINK_PROBLEM_TEXT, parseLink } from '@shared/ingest/url'
import { formatMark, MIN_RANGE_MS, parseMark } from '@shared/ingest/section'
import type { IngestWant } from '@shared/ingest/args'
import { GetTranscriptButton, LinkTranscriptStatus, LinkTranscriptToggle } from './tools/LinkTranscript'
import { AnalyseButton, BestClips, BestClipsPointer, ClipsToggle } from './tools/BestClips'
import { foldDownChoices, foldDownKeyDown, type FoldDownChoice } from './ui/FoldDown'

/**
 * Sheets ⑥ and ⑫: paste a link, choose what to take, get a clip.
 *
 * The sketch drew mp4 / mp3 / instrumental as siblings of the YouTube entry.
 * They are not alternatives to pasting a link — they are what you choose
 * afterwards, so they live here as one row, inside the Shelf's URL tile.
 *
 * The count that matters is clicks from paste to clip. With the defaults it is
 * two: paste, Download. Everything else on this panel is optional and stays out of
 * the way until it is wanted.
 *
 * The rows, in the order of the user's sketch of 2026-11-27 (the clip
 * maker's layout): the link box and **Download**; the kinds as one row, the
 * chosen kind's quality (Video) or format (Audio, Instrumental, Vocal) a
 * fold-down list under it, in the flow (`KindsRow`); Get transcript and
 * Analyse; their status lines; Just a part of it, with the Transcript and
 * Clips toggles; Best clips' options; the download lines. Nothing in it
 * floats: a floating menu is one more thing that can cover another.
 *
 * Get transcript (sheets 25–26, docs/CLIPS.md §3b) was `LinkTranscript`'s: rows
 * of the link's words, a run picked from them, and Clip it — its button
 * **Clip download**. Since the clip maker's layout (2026-11-27) those rows are
 * the fold-out panel's Transcript tab beside the picture (`LinkWords`), and
 * this tile keeps Get transcript, its status lines and a Transcript toggle (`GetTranscriptButton`, `LinkTranscriptStatus`, `LinkTranscriptToggle`).
 * While the link has those words (store `wordsShown`, wherever they are
 * drawn) the From and To fields below give way to the run's own, read-only,
 * beside the rows (§3b.5); with no captions, or none fetched, they are typed
 * as before.
 *
 * The link's button reads **Download**, the sketch's word (2026-11-27; it
 * was "Get"). And while the link has words, it says what it does — **Full
 * download**, no longer the accent button — because the run's range is shown
 * with the rows and the button does not take it: Clip download does. The two
 * names are the user's (2026-10-06: "let's specify the complete full download,
 * clip download, so that way it will be clear"). Enter in the link box, which
 * would press it unseen, does nothing then. (Measured in the 240 px panel:
 * "Get the whole video" took 145 px and left the link box 63; "Whole video"
 * took 106 and left it 102, against 147 beside "Get"; "Full download" takes
 * 113.5 and leaves it 94, on one line — and "Clip download", alone on its
 * row, 117, on one. "Download" is "Full download" less "Full ": about 91 px
 * by its classes, leaving the box about 117 — reasoned, not measured. Should
 * a narrower column or a larger font leave the box under 5.5rem (88 px, a
 * little under the 94 it has beside Full download), the row wraps and the button goes under the box rather than squeezing it.)
 */

const GET_TITLE = 'Download and put it on the timeline'
/** The link's button with no words shown: the sketch's word (2026-11-27), where it read "Get". */
export const DOWNLOAD = 'Download'
export const FULL_DOWNLOAD = 'Full download'
export const FULL_DOWNLOAD_TITLE = 'Download the whole video and put it on the timeline'

const WANTS: { id: IngestWant; label: string; hint: string }[] = [
  { id: 'video', label: 'Video', hint: 'The picture and its sound' },
  { id: 'audio', label: 'Audio', hint: 'Just the sound, as it was stored' },
  { id: 'instrumental', label: 'Instrumental', hint: 'The song with the centred voice removed' },
  { id: 'vocal', label: 'Vocal', hint: 'The voice, for cutting to the words' }
]

/** The kinds row's fold-down lists (the store's `foldDownOpen`): Video's quality, and the sound's format. */
export const QUALITY_LIST = 'link-quality'
export const FORMAT_LIST = 'link-format'
/** The unfolded choices' names, for a screen reader. */
export const QUALITY_LABEL = 'Quality'
export const FORMAT_LABEL = 'Format'

const QUALITY_CHOICES: readonly FoldDownChoice<Quality>[] = QUALITIES.map((quality: Quality) => ({
  value: quality,
  label: quality === '2160p' ? '4K' : quality
}))

const FORMAT_CHOICES: readonly FoldDownChoice<'m4a' | 'mp3'>[] = [
  { value: 'm4a', label: 'm4a', title: 'What the site already stores — copied out, no re-encode' },
  { value: 'mp3', label: 'mp3', title: 'Re-encoded to mp3, for somewhere that insists on it' }
]

/**
 * The kinds as one row — Video, Audio, Instrumental, Vocal — and under it, in
 * the flow, the chosen kind's quality or format as a fold-down list: the
 * sketch's "collapsable" (2026-11-27). The chosen kind's chip says its choice
 * ("Video · 1080p") and is the list's button.
 *
 * A press on another kind chooses it (and folds any list open); a press on the
 * chosen kind opens or folds its list; a choice folds it, and so does Escape.
 * The row itself is the `[data-fold-down]` root, so `foldDownChoices` finds
 * the chosen chip as the button to put the keyboard back on. Same store values
 * as the buttons it replaced: `kind`, `quality`, `audioFormat`.
 *
 * No hook but the store's, so a test can call it as a function.
 */
export function KindsRow(): ReactNode {
  const ingest = useEditor((s) => s.ingest)
  const setIngest = useEditor((s) => s.setIngest)
  const foldDownOpen = useEditor((s) => s.foldDownOpen)
  const setFoldDownOpen = useEditor((s) => s.setFoldDownOpen)
  const video = ingest.kind === 'video'
  const list = video ? QUALITY_LIST : FORMAT_LIST
  const open = foldDownOpen === list
  const fold = (next: boolean): void => setFoldDownOpen(next ? list : null)
  const Chevron = open ? ChevronUp : ChevronDown

  return (
    <div data-fold-down={list} data-open={open} onKeyDown={foldDownKeyDown(open, fold)} className="mt-2.5 flex flex-wrap items-center gap-1">
      {WANTS.map((want) => {
        const on = ingest.kind === want.id
        return (
          <button
            key={want.id}
            type="button"
            data-want={want.id}
            aria-pressed={on}
            {...(on ? { 'aria-expanded': open, 'aria-controls': `fold-down-${list}` } : {})}
            onClick={() => {
              if (on) return fold(!open)
              if (foldDownOpen === QUALITY_LIST || foldDownOpen === FORMAT_LIST) setFoldDownOpen(null)
              setIngest({ kind: want.id })
            }}
            title={want.hint}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors ${
              on ? 'bg-accent-500 text-ink-950' : 'bg-ink-850 text-ink-400 hover:text-ink-200'
            }`}
          >
            <span>{want.label}</span>
            {on && (
              <>
                <span aria-hidden>·</span>
                {video ? (
                  <span>{QUALITY_CHOICES.find((c) => c.value === ingest.quality)?.label ?? ingest.quality}</span>
                ) : (
                  <span className="uppercase">{ingest.audioFormat}</span>
                )}
                <Chevron size={11} className="shrink-0" aria-hidden />
              </>
            )}
          </button>
        )
      })}

      {open &&
        (video
          ? foldDownChoices({
              id: list,
              label: QUALITY_LABEL,
              value: ingest.quality,
              choices: QUALITY_CHOICES,
              onOpenChange: fold,
              onChoose: (quality) => setIngest({ quality }),
              choiceData: 'data-quality',
              className: 'basis-full'
            })
          : foldDownChoices({
              id: list,
              label: FORMAT_LABEL,
              value: ingest.audioFormat,
              choices: FORMAT_CHOICES,
              onOpenChange: fold,
              onChoose: (audioFormat) => setIngest({ audioFormat }),
              choiceData: 'data-format',
              className: 'basis-full',
              choiceClassName: 'uppercase'
            }))}

      {ingest.kind === 'instrumental' || ingest.kind === 'vocal' ? (
        <span className="basis-full text-[10px] text-ink-600">split after downloading</span>
      ) : null}
    </div>
  )
}

/**
 * One end of the range, typed.
 *
 * Sliders were the obvious control and the wrong one. The video's length is
 * unknown until it has been fetched, so a slider has no scale to be drawn
 * against — the first version derived its `max` from its own value, which made
 * the track rescale under the pointer on every move: a seven-pixel drag added
 * four and a half minutes. Measured, in the browser, by someone dragging it.
 *
 * A typed mark has no scale to get wrong and can reach an hour in as many
 * keystrokes as a minute. Held as text while it is being edited so a half-typed
 * `1:` is not read as nonsense, and committed on blur or Enter.
 */
function MarkField({
  label,
  value,
  onCommit
}: {
  label: string
  value: number
  onCommit: (ms: number) => void
}): ReactNode {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? formatMark(value)
  const bad = text !== null && text.trim() !== '' && parseMark(text) === null

  const commit = (): void => {
    if (text === null) return
    const ms = parseMark(text)
    if (ms !== null) onCommit(ms)
    setText(null)
  }

  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10.5px] text-ink-500">{label}</span>
      <input
        value={shown}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setText(null)
          // The panel's own Enter would otherwise submit the download while a
          // half-typed mark is still in the box.
          e.stopPropagation()
        }}
        placeholder="0:00.0"
        spellCheck={false}
        inputMode="numeric"
        aria-label={`${label} — minutes and seconds`}
        aria-invalid={bad}
        className={`w-[72px] rounded border bg-ink-950 px-1.5 py-1 text-center text-[11px] tabular-nums outline-none ${
          bad ? 'border-amber-500/70 text-amber-800' : 'border-ink-750 text-ink-200 focus:border-accent-500'
        }`}
      />
    </label>
  )
}

/**
 * The link box and Download. No hook but the store's, so a test can call it as a
 * function and press what it returns (tests/renderer/ingestPanel.test.tsx).
 */
export function LinkBox(): ReactNode {
  const ingest = useEditor((s) => s.ingest)
  const setIngest = useEditor((s) => s.setIngest)
  const startIngest = useEditor((s) => s.startIngest)
  // The link's words are on screen: the button takes the whole video, and says so — "Full download".
  const words = useEditor((s) => wordsShown(s))
  const link = parseLink(ingest.url)
  const problem = linkProblem(ingest.url)

  const submit = (): void => {
    // Guarded here as well as on the button: Enter had no check at all, so a
    // link the panel was already refusing inline could still be submitted.
    if (!ingest.busy && link) void startIngest()
  }

  return (
    // Wraps only when the box would be squeezed under 5.5rem: the button then goes under it.
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={ingest.url}
        onChange={(e) => setIngest({ url: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !words) submit()
        }}
        placeholder="Paste a video link"
        spellCheck={false}
        autoComplete="off"
        className="min-w-[5.5rem] flex-1 basis-[5.5rem] rounded border border-ink-750 bg-ink-950 px-2 py-1.5 text-[11.5px] text-ink-200 outline-none placeholder:text-ink-600 focus:border-accent-500"
      />
      <button
        onClick={submit}
        disabled={ingest.busy || !link}
        title={link ? (words ? FULL_DOWNLOAD_TITLE : GET_TITLE) : LINK_PROBLEM_TEXT[problem ?? 'not-a-link']}
        data-get={words ? 'full' : 'plain'}
        className={`flex shrink-0 items-center gap-1.5 rounded px-3 py-1.5 text-[11px] transition-colors disabled:opacity-40 ${
          words
            ? 'bg-ink-850 text-ink-300 hover:bg-ink-800 hover:text-ink-100'
            : 'bg-accent-500 font-medium text-ink-950 hover:bg-accent-400'
        }`}
      >
        {ingest.busy ? <Loader2 size={12} className="animate-spin" /> : <DownloadCloud size={12} />}
        {words ? FULL_DOWNLOAD : DOWNLOAD}
      </button>
    </div>
  )
}

export function IngestPanel(): ReactNode {
  const ingest = useEditor((s) => s.ingest)
  const setIngest = useEditor((s) => s.setIngest)
  const jobs = useEditor((s) => s.jobs)
  const pending = useEditor((s) => s.pendingIngests)
  // The link's words are on screen: the run sets the range, not the fields.
  const words = useEditor((s) => wordsShown(s))

  const [tool, setTool] = useState<{ ready: boolean; reason: string | null } | null>(null)

  useEffect(() => {
    // Asked once, and never fetches — the answer is only used to warn before
    // the first download, which is where the ~30MB wait would surprise someone.
    void window.forge
      .ingestStatus()
      .then((s) => setTool({ ready: s.ready, reason: s.reason }))
      .catch(() => setTool(null))
  }, [])

  // One diagnosis, shared with the store, so the inline hint and any message
  // can never disagree about the same text.
  const problem = linkProblem(ingest.url)
  const running = jobs.filter((j) => pending[j.id] && (j.status === 'running' || j.status === 'queued'))

  return (
    <div data-url-tile="" className="px-3 py-2.5">
      {/* ------------------------------------------------------------ link */}
      <LinkBox />

      {/*
       * What is wrong with the link, while it is being typed.
       *
       * A collection URL is the one worth naming: `--no-playlist` does not stop
       * yt-dlp downloading a whole channel, so these are refused outright, and
       * "nothing happened" would be a terrible way to learn that.
       */}
      {problem && problem !== 'empty' && (
        <p className="mt-1.5 text-[10.5px] leading-snug text-amber-800">
          {LINK_PROBLEM_TEXT[problem]}
        </p>
      )}

      {/* ------------------------------------------------------------ what */}
      <KindsRow />

      {/* ---------------------------------- Get transcript and Analyse (the sketch's row) */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        <GetTranscriptButton />
        <AnalyseButton />
      </div>
      <LinkTranscriptStatus />
      <BestClipsPointer />

      {/* ----------------------------------- Just a part of it, and the two toggles */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        {!words && (
          <button
            type="button"
            onClick={() => setIngest({ useRange: !ingest.useRange })}
            aria-pressed={ingest.useRange}
            className={`flex items-center gap-1.5 text-[11px] transition-colors ${
              ingest.useRange ? 'text-ink-200' : 'text-ink-500 hover:text-ink-300'
            }`}
          >
            <Scissors size={11} strokeWidth={1.8} />
            Just a part of it
          </button>
        )}
        <div data-url-toggles="" className="ml-auto flex flex-wrap items-center justify-end gap-1">
          <LinkTranscriptToggle />
          <ClipsToggle />
        </div>
      </div>

      {/* ----------------------------------------------------------- range */}
      {!words && ingest.useRange && (
        <div className="mt-2 rounded border border-ink-800 bg-ink-950/60 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <MarkField
              label="From"
              value={ingest.startMs}
              onCommit={(startMs) =>
                setIngest({
                  startMs,
                  // Keep a second between the marks however they are typed:
                  // sectionPlan reads a zero-length range as "no range" and
                  // would fetch the WHOLE video.
                  endMs: Math.max(startMs + MIN_RANGE_MS, ingest.endMs)
                })
              }
            />
            <MarkField
              label="To"
              value={ingest.endMs}
              onCommit={(typed) => {
                const endMs = Math.max(MIN_RANGE_MS, typed)
                setIngest({ endMs, startMs: Math.min(ingest.startMs, endMs - MIN_RANGE_MS) })
              }}
            />
            <span className="text-[10.5px] text-ink-600">
              {formatMark(Math.max(0, ingest.endMs - ingest.startMs))} long
            </span>
          </div>

          <div className="mt-2 flex gap-1">
            {([false, true] as const).map((exact) => (
              <button
                key={String(exact)}
                onClick={() => setIngest({ exact })}
                aria-pressed={ingest.exact === exact}
                title={
                  exact
                    ? 'Re-encodes at the marks. Slow on a 4K video.'
                    : 'Copies the streams and fetches a little either side; the clip is trimmed to your marks on the timeline.'
                }
                className={`rounded px-2 py-1 text-[10.5px] transition-colors ${
                  ingest.exact === exact
                    ? 'bg-ink-700 text-ink-100'
                    : 'bg-ink-850 text-ink-500 hover:text-ink-200'
                }`}
              >
                {exact ? 'Exact cut — slower' : 'Fast cut'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------ best clips' options */}
      <BestClips />

      {/* ---------------------------------------------------------- status */}
      {running.length > 0 && (
        <p className="mt-2 text-[10.5px] text-ink-500">
          {running.length === 1 ? '1 download' : `${running.length} downloads`} running — progress is
          under EXPORT, bottom left.
        </p>
      )}

      {tool && !tool.ready && (
        <p className="mt-2 text-[10.5px] leading-snug text-ink-600">
          The first download fetches yt-dlp (about 30MB). After that it is instant.
        </p>
      )}
    </div>
  )
}
