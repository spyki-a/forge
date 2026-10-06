import { useEffect, useState, type ReactNode } from 'react'
import { DownloadCloud, Loader2, Scissors } from 'lucide-react'
import { useEditor, wordsShown } from '../store'
import { QUALITIES, type Quality } from '@shared/ingest/format'
import { linkProblem, LINK_PROBLEM_TEXT, parseLink } from '@shared/ingest/url'
import { formatMark, MIN_RANGE_MS, parseMark } from '@shared/ingest/section'
import type { IngestWant } from '@shared/ingest/args'
import { LinkTranscript } from './tools/LinkTranscript'

/**
 * Sheets ⑥ and ⑫: paste a link, choose what to take, get a clip.
 *
 * The sketch drew mp4 / mp3 / instrumental as siblings of the YouTube entry.
 * They are not alternatives to pasting a link — they are what you choose
 * afterwards, so they live here as one row, inside the Shelf's URL tile.
 *
 * The count that matters is clicks from paste to clip. With the defaults it is
 * two: paste, Get. Everything else on this panel is optional and stays out of
 * the way until it is wanted.
 *
 * Get transcript (sheets 25–26, docs/CLIPS.md §3b) is `LinkTranscript`: rows
 * of the link's words, a run picked from them, and Clip it. While those words
 * are on screen the From and To fields below give way to the run's own,
 * read-only (§3b.5); with no captions, or none fetched, they are typed as
 * before.
 *
 * And while they are on screen, Get says what it does — **Whole video**, no
 * longer the accent button — because the run's range is shown right under it
 * and Get does not take it: Clip it does. Enter in the link box, which would
 * press Get unseen, does nothing then. (Measured in the 240 px panel: "Get the
 * whole video" took 145 px and left the link box 63; "Whole video" takes 106
 * and leaves it 102, against 147 beside "Get".)
 */

const GET_TITLE = 'Download and put it on the timeline'
export const GET_WHOLE_TITLE = 'Download the whole video and put it on the timeline — Clip it takes just the words you picked'

const WANTS: { id: IngestWant; label: string; hint: string }[] = [
  { id: 'video', label: 'Video', hint: 'The picture and its sound' },
  { id: 'audio', label: 'Audio', hint: 'Just the sound, as it was stored' },
  { id: 'instrumental', label: 'Instrumental', hint: 'The song with the centred voice removed' },
  { id: 'vocal', label: 'Vocal', hint: 'The voice, for cutting to the words' }
]

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
 * The link box and Get. No hook but the store's, so a test can call it as a
 * function and press what it returns (tests/renderer/ingestPanel.test.tsx).
 */
export function LinkBox(): ReactNode {
  const ingest = useEditor((s) => s.ingest)
  const setIngest = useEditor((s) => s.setIngest)
  const startIngest = useEditor((s) => s.startIngest)
  // The link's words are on screen: Get takes the whole video, and says so.
  const words = useEditor((s) => wordsShown(s))
  const link = parseLink(ingest.url)
  const problem = linkProblem(ingest.url)

  const submit = (): void => {
    // Guarded here as well as on the button: Enter had no check at all, so a
    // link the panel was already refusing inline could still be submitted.
    if (!ingest.busy && link) void startIngest()
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={ingest.url}
        onChange={(e) => setIngest({ url: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !words) submit()
        }}
        placeholder="Paste a video link"
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 rounded border border-ink-750 bg-ink-950 px-2 py-1.5 text-[11.5px] text-ink-200 outline-none placeholder:text-ink-600 focus:border-accent-500"
      />
      <button
        onClick={submit}
        disabled={ingest.busy || !link}
        title={link ? (words ? GET_WHOLE_TITLE : GET_TITLE) : LINK_PROBLEM_TEXT[problem ?? 'not-a-link']}
        data-get={words ? 'whole' : 'plain'}
        className={`flex shrink-0 items-center gap-1.5 rounded px-3 py-1.5 text-[11px] transition-colors disabled:opacity-40 ${
          words
            ? 'bg-ink-850 text-ink-300 hover:bg-ink-800 hover:text-ink-100'
            : 'bg-accent-500 font-medium text-ink-950 hover:bg-accent-400'
        }`}
      >
        {ingest.busy ? <Loader2 size={12} className="animate-spin" /> : <DownloadCloud size={12} />}
        {words ? 'Whole video' : 'Get'}
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
    <div className="px-3 py-2.5">
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
      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        {WANTS.map((want) => {
          const on = ingest.kind === want.id
          return (
            <button
              key={want.id}
              onClick={() => setIngest({ kind: want.id })}
              title={want.hint}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${
                on ? 'bg-accent-500 text-ink-950' : 'bg-ink-850 text-ink-400 hover:text-ink-200'
              }`}
            >
              {want.label}
            </button>
          )
        })}

        <span className="mx-1 h-4 w-px bg-ink-800" />

        {ingest.kind === 'video' ? (
          QUALITIES.map((quality: Quality) => {
            const on = ingest.quality === quality
            return (
              <button
                key={quality}
                onClick={() => setIngest({ quality })}
                className={`rounded px-2 py-1 text-[11px] transition-colors ${
                  on ? 'bg-ink-700 text-ink-100' : 'bg-ink-850 text-ink-500 hover:text-ink-200'
                }`}
              >
                {quality === '2160p' ? '4K' : quality}
              </button>
            )
          })
        ) : (
          <>
            {(['m4a', 'mp3'] as const).map((format) => {
              const on = ingest.audioFormat === format
              return (
                <button
                  key={format}
                  onClick={() => setIngest({ audioFormat: format })}
                  title={
                    format === 'm4a'
                      ? 'What the site already stores — copied out, no re-encode'
                      : 'Re-encoded to mp3, for somewhere that insists on it'
                  }
                  className={`rounded px-2 py-1 text-[11px] uppercase transition-colors ${
                    on ? 'bg-ink-700 text-ink-100' : 'bg-ink-850 text-ink-500 hover:text-ink-200'
                  }`}
                >
                  {format}
                </button>
              )
            })}
            {ingest.kind !== 'audio' && (
              <span className="ml-1 text-[10px] text-ink-600">split after downloading</span>
            )}
          </>
        )}
      </div>

      {/* ------------------------------------------------------ transcript */}
      <LinkTranscript />

      {/* ----------------------------------------------------------- range */}
      {!words && (
        <div className="mt-2.5">
          <button
            onClick={() => setIngest({ useRange: !ingest.useRange })}
            aria-pressed={ingest.useRange}
            className={`flex items-center gap-1.5 text-[11px] transition-colors ${
              ingest.useRange ? 'text-ink-200' : 'text-ink-500 hover:text-ink-300'
            }`}
          >
            <Scissors size={11} strokeWidth={1.8} />
            Just a part of it
          </button>

          {ingest.useRange && (
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
        </div>
      )}

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
