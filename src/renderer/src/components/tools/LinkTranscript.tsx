import type { ReactNode } from 'react'
import { Ear, FileText, Loader2, Plus, Scissors } from 'lucide-react'
import { useEditor, urlSourceFor, type UrlSource } from '../../store'
import { parseLink } from '@shared/ingest/url'
import { formatMark } from '@shared/ingest/section'
import { runOfChapter, runRange } from '@shared/ingest/wordRun'
import type { LinkChapter } from '@shared/ingest/args'
import { TranscriptRows } from './TranscriptRows'

/**
 * The URL tile's transcript of a link (docs/CLIPS.md §3b.1–3b.5, sheets 25
 * and 26): **Get transcript**, then rows of `time | text` to pick a run of
 * words from — by click and shift-click, by the Start and End handles, or by
 * a chapter chip — and Clip it, whose button reads **Clip download** (the
 * user's name, beside Get's **Full download**, sheet 25's "Clip downloads"):
 * it downloads exactly that run's span and lands it with its words and the
 * link's credit. **Add another clip** keeps the rows and clears the run.
 *
 * YouTube's own caption track, fetched by yt-dlp with no media and no model:
 * none of this needs the AI helper. A video with no captions says so, and its
 * From and To fields (IngestPanel's) stay how a range is set; **Listen to it**
 * would transcribe it with the helper, and is greyed until that is built
 * (Step P).
 *
 * No hook but the store's, so a test can call it as a function and press what
 * it returns.
 */

export const GET_TRANSCRIPT_TITLE = 'Fetch the video’s captions as words to pick a clip from — nothing else is downloaded'
export const CLIP_DOWNLOAD_TITLE = 'Download only the words you picked and put them on the timeline'
export const ADD_ANOTHER_TITLE = 'Keep the transcript and pick another run'
export const LISTEN_TITLE = 'Transcribe the sound with the AI helper — downloads the audio and the speech model'
export const PICK_CHAPTER_TITLE = 'Pick this chapter’s words'
export const RANGE_CHAPTER_TITLE = 'Set From and To to this chapter'

/** The languages offered when the video's details name none (§7.1, "the user's pick from a list"). */
export const CAPTION_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'te', label: 'Telugu' },
  { code: 'ta', label: 'Tamil' },
  { code: 'es', label: 'Spanish' }
]

function Chapters({ chapters, onPick, title }: { chapters: LinkChapter[]; onPick: (c: LinkChapter) => void; title: string }): ReactNode {
  if (chapters.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {chapters.map((chapter, i) => (
        <button
          key={i}
          type="button"
          data-chapter={i}
          onClick={() => onPick(chapter)}
          title={title}
          className="max-w-full truncate rounded-full bg-ink-850 px-2 py-0.5 text-[10.5px] text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
        >
          {chapter.title || formatMark(chapter.start_time * 1000)}
        </button>
      ))}
    </div>
  )
}

function Words({ source }: { source: UrlSource }): ReactNode {
  const setUrlRun = useEditor((s) => s.setUrlRun)
  const clipItFromLink = useEditor((s) => s.clipItFromLink)
  const addAnotherClip = useEditor((s) => s.addAnotherClip)
  const busy = useEditor((s) => s.ingest.busy)
  const t = source.transcript
  if (!t) return null
  const run = source.run
  const range = run ? runRange(t, run) : null

  return (
    <>
      <Chapters
        chapters={source.meta?.chapters ?? []}
        title={PICK_CHAPTER_TITLE}
        onPick={(chapter) => {
          const picked = runOfChapter(t, chapter)
          if (picked) setUrlRun(picked)
        }}
      />

      <div className="mt-2">
        <TranscriptRows transcript={t} run={run} anchorRow={source.anchorRow} onChange={(next, anchor) => setUrlRun(next, anchor)} />
      </div>

      {range ? (
        <div className="mt-2 space-y-1">
          <p className="text-[10.5px] text-ink-300">
            <span className="tabular-nums">{formatMark(range.endMs - range.startMs)}</span> selected
          </p>
          {/* sheet 12's fields, kept: here they mirror the run, read-only (§3b.5) */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <label className="flex items-center gap-1.5">
              <span className="text-[10.5px] text-ink-500">From</span>
              <input
                readOnly
                value={formatMark(range.startMs)}
                data-mirror="from"
                className="w-[72px] rounded border border-ink-800 bg-ink-900 px-1.5 py-1 text-center text-[11px] tabular-nums text-ink-400 outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-[10.5px] text-ink-500">To</span>
              <input
                readOnly
                value={formatMark(range.endMs)}
                data-mirror="to"
                className="w-[72px] rounded border border-ink-800 bg-ink-900 px-1.5 py-1 text-center text-[11px] tabular-nums text-ink-400 outline-none"
              />
            </label>
          </div>
          <p className="text-[10px] text-ink-600">set by the words you picked</p>
        </div>
      ) : (
        <p className="mt-2 text-[10.5px] leading-snug text-ink-500">
          Click a row to pick its words; shift-click another row, or a word, to extend. Or drag Start and End.
        </p>
      )}

      {source.clipped ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-[10.5px] leading-snug text-ink-500">
            Clipping — it lands on the timeline when the download is done.
          </p>
          <button
            type="button"
            onClick={() => addAnotherClip()}
            title={ADD_ANOTHER_TITLE}
            className="flex items-center gap-1.5 rounded bg-ink-850 px-2.5 py-1 text-[11px] text-ink-300 transition-colors hover:bg-ink-800 hover:text-ink-100"
          >
            <Plus size={12} />
            Add another clip
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void clipItFromLink()}
          disabled={!run || busy}
          title={CLIP_DOWNLOAD_TITLE}
          className="mt-2 flex items-center gap-1.5 rounded bg-accent-500 px-3 py-1.5 text-[11px] font-medium text-ink-950 transition-colors hover:bg-accent-400 disabled:opacity-40"
        >
          <Scissors size={12} />
          Clip download
        </button>
      )}
    </>
  )
}

function NoCaptions({ source }: { source: UrlSource }): ReactNode {
  const setIngest = useEditor((s) => s.setIngest)
  const helper = useEditor((s) => s.sidecarReady)
  return (
    <>
      {/* With no words, a chapter sets the From and To fields instead (§3b.3). */}
      <Chapters
        chapters={source.meta?.chapters ?? []}
        title={RANGE_CHAPTER_TITLE}
        onPick={(chapter) =>
          setIngest({ useRange: true, startMs: Math.round(chapter.start_time * 1000), endMs: Math.round(chapter.end_time * 1000) })
        }
      />
      <p className="mt-2 text-[11px] text-ink-300">This video has no captions</p>
      <div className="mt-1.5 flex items-center gap-2">
        {/*
          Whisper on the downloaded sound, through the AI helper (§3b.5, §3a).
          Not built in M0: greyed, and it never downloads anything.
        */}
        <button
          type="button"
          disabled
          title={LISTEN_TITLE}
          className="flex items-center gap-1.5 rounded bg-ink-850 px-2.5 py-1 text-[11px] text-ink-400 disabled:opacity-50"
        >
          <Ear size={12} />
          Listen to it
        </button>
        <span className="text-[10px] text-ink-600">{helper ? 'soon' : 'needs the AI helper'}</span>
      </div>
    </>
  )
}

function Languages(): ReactNode {
  const getTranscript = useEditor((s) => s.getTranscript)
  return (
    <div className="mt-2">
      <p className="text-[10.5px] text-ink-500">Choose the language</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {CAPTION_LANGUAGES.map((language) => (
          <button
            key={language.code}
            type="button"
            data-language={language.code}
            onClick={() => void getTranscript(language.code)}
            className="rounded bg-ink-850 px-2 py-0.5 text-[10.5px] text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
          >
            {language.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function LinkTranscript(): ReactNode {
  const ingest = useEditor((s) => s.ingest)
  const urlSource = useEditor((s) => s.urlSource)
  const getTranscript = useEditor((s) => s.getTranscript)
  const link = parseLink(ingest.url)
  // Shown only while the box holds the link it belongs to.
  const source = urlSourceFor({ urlSource, ingest })
  const fetching = source?.status === 'meta' || source?.status === 'captions'
  // A language chosen by hand is offered again when it had nothing.
  const chosen = source !== null && source.meta !== null && source.meta.language === null

  return (
    <div className="mt-2.5">
      <button
        type="button"
        onClick={() => void getTranscript()}
        disabled={!link || fetching}
        title={GET_TRANSCRIPT_TITLE}
        className="flex items-center gap-1.5 rounded bg-ink-850 px-2.5 py-1 text-[11px] text-ink-300 transition-colors hover:bg-ink-800 hover:text-ink-100 disabled:opacity-40"
      >
        {fetching ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
        Get transcript
      </button>

      {source?.status === 'meta' && <p className="mt-1.5 text-[10.5px] text-ink-500">Reading the link…</p>}
      {source?.status === 'captions' && <p className="mt-1.5 text-[10.5px] text-ink-500">Fetching the captions…</p>}
      {source?.status === 'failed' && (
        <div className="mt-1.5 text-[10.5px] leading-snug">
          <p className="text-amber-800">Could not get the transcript.</p>
          <p className="text-ink-500">{source.error}</p>
        </div>
      )}
      {source?.status === 'language' && <Languages />}
      {source?.status === 'none' && (
        <>
          <NoCaptions source={source} />
          {chosen && <Languages />}
        </>
      )}
      {source?.status === 'ready' && <Words source={source} />}
    </div>
  )
}
