import type { ReactNode } from 'react'
import { Ear, FileText, Loader2, PanelLeftClose, PanelLeftOpen, Plus, Scissors } from 'lucide-react'
import { foldoutShowsWords } from '@shared/foldout'
import { clipSelected, useEditor, urlSourceFor, wordsShown, type UrlSource } from '../../store'
import { parseLink } from '@shared/ingest/url'
import { formatMark } from '@shared/ingest/section'
import { runOfChapter, runRange } from '@shared/ingest/wordRun'
import type { LinkChapter } from '@shared/ingest/args'
import { TranscriptRows } from './TranscriptRows'
import { NEEDS_SPEECH_MODEL } from '@shared/asr/speechModel'
import { transcribeGate } from '@shared/sidecar/row'
import { HelperPointer } from '../SettingsPanel'

/**
 * A link's transcript (docs/CLIPS.md §3b.1–3b.5, sheets 25 and 26), in two
 * parts since the clip maker's layout (the user's sketch of 2026-11-27: the
 * transcript unfolds beside the picture, "so that when the trim create wont
 * ever collide"):
 *
 * IN THE URL TILE (`LinkTranscript`): **Get transcript** and its short status
 * lines — reading, fetching, the failure, the language to choose, and a video
 * with no captions (its chapter chips set the tile's From and To there) — and,
 * once the words are ready, the **Transcript** toggle that opens and closes
 * the fold-out panel on them. The panel opens on them by itself when they
 * arrive, from Get transcript's own handler (`getTranscript` is left as it
 * was). Nothing long is drawn here: the 240 px column also holds the Trimmer.
 *
 * IN THE PANEL (`LinkWords`, the fold-out's Transcript tab, Foldout.tsx): the
 * chapter chips, rows of `time | text` to pick a run of words from — by click
 * and shift-click, by the Start and End handles, or by a chip — the run's
 * length with its read-only From and To, and Clip it, whose button reads
 * **Clip download** (the user's name, beside Get's **Full download**, sheet
 * 25's "Clip downloads"): it downloads exactly that run's span and lands it
 * with its words and the link's credit. **Add another clip** keeps the rows
 * and clears the run.
 *
 * YouTube's own caption track, fetched by yt-dlp with no media and no model:
 * none of this needs the AI helper. A video with no captions says so, and its
 * From and To fields (IngestPanel's) stay how a range is set; **Listen to it**
 * would transcribe it with the helper, and is greyed until that is built.
 * Its reason is honest (docs/CLIPS.md §3a.4): by `asr.transcribe` and the
 * speech model, "needs the AI helper" (a pointer to Settings), "needs the
 * speech model", or, with both, "soon".
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
/** The toggle that opens and closes the panel beside the picture on the link's words (the Clips toggle's way). */
export const TRANSCRIPT_TOGGLE = 'Transcript'
export const LINK_TRANSCRIPT_TOGGLE_TITLE = 'Show or hide the link’s words, beside the picture'

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
  const helperStatus = useEditor((s) => s.helperStatus)
  const speechModel = useEditor((s) => s.speechModel)
  const gate = transcribeGate(helperStatus, speechModel)
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
        {gate === 'no-helper' ? (
          <HelperPointer className="text-[10px] text-ink-600" />
        ) : (
          <span className="text-[10px] text-ink-600">
            {gate === 'ready' ? 'soon' : gate === 'no-model' ? NEEDS_SPEECH_MODEL : 'the AI helper is starting'}
          </span>
        )}
      </div>
    </>
  )
}

function Languages({ onPick }: { onPick: (language: string) => void }): ReactNode {
  return (
    <div className="mt-2">
      <p className="text-[10.5px] text-ink-500">Choose the language</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {CAPTION_LANGUAGES.map((language) => (
          <button
            key={language.code}
            type="button"
            data-language={language.code}
            onClick={() => onPick(language.code)}
            className="rounded bg-ink-850 px-2 py-0.5 text-[10.5px] text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
          >
            {language.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * The fold-out's Transcript tab on the link's words: everything that was under
 * Get transcript once the words were ready. Nothing while the box's link has
 * none (the tab then shows the other transcript, or its empty line).
 */
export function LinkWords(): ReactNode {
  const ingest = useEditor((s) => s.ingest)
  const urlSource = useEditor((s) => s.urlSource)
  const source = urlSourceFor({ urlSource, ingest })
  if (source?.status !== 'ready') return null
  return <Words source={source} />
}

export function LinkTranscript(): ReactNode {
  const ingest = useEditor((s) => s.ingest)
  const urlSource = useEditor((s) => s.urlSource)
  const getTranscript = useEditor((s) => s.getTranscript)
  const openFoldout = useEditor((s) => s.openFoldout)
  const toggleTranscript = useEditor((s) => s.toggleTranscript)
  const foldout = useEditor((s) => s.foldout)
  const clip = useEditor((s) => clipSelected(s))
  const link = parseLink(ingest.url)
  // Shown only while the box holds the link it belongs to.
  const source = urlSourceFor({ urlSource, ingest })
  const fetching = source?.status === 'meta' || source?.status === 'captions'
  // A language chosen by hand is offered again when it had nothing — unless
  // the video has no caption track in any language.
  const chosen = source !== null && source.meta !== null && source.meta.language === null && source.meta.hasCaptions !== false
  // The same value the store's toggleTranscript and the tab decide on, so pressed and the press cannot drift.
  const ready = useEditor((s) => wordsShown(s))
  // Pressed while the panel shows the link's words, as shown (not merely asked for: shared/foldout.ts).
  const showing = foldoutShowsWords(foldout, 'link', { link: ready, clip })
  const Panel = showing ? PanelLeftClose : PanelLeftOpen

  /** Get transcript, and a language chosen: the words, once they arrive, unfold beside the picture. */
  const fetchWords = async (language?: string): Promise<void> => {
    await getTranscript(language)
    if (wordsShown(useEditor.getState())) openFoldout('transcript', 'link')
  }

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => void fetchWords()}
          disabled={!link || fetching}
          title={GET_TRANSCRIPT_TITLE}
          className="flex items-center gap-1.5 rounded bg-ink-850 px-2.5 py-1 text-[11px] text-ink-300 transition-colors hover:bg-ink-800 hover:text-ink-100 disabled:opacity-40"
        >
          {fetching ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
          Get transcript
        </button>
        {ready && (
          <button
            type="button"
            data-link-transcript-toggle=""
            aria-pressed={showing}
            onClick={() => toggleTranscript('link')}
            title={LINK_TRANSCRIPT_TOGGLE_TITLE}
            className={`ml-auto flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors ${
              showing ? 'bg-accent-900 text-accent-400' : 'bg-ink-850 text-ink-400 hover:text-ink-200'
            }`}
          >
            <Panel size={12} aria-hidden />
            {TRANSCRIPT_TOGGLE}
          </button>
        )}
      </div>

      {source?.status === 'meta' && <p className="mt-1.5 text-[10.5px] text-ink-500">Reading the link…</p>}
      {source?.status === 'captions' && <p className="mt-1.5 text-[10.5px] text-ink-500">Fetching the captions…</p>}
      {source?.status === 'failed' && (
        <div className="mt-1.5 text-[10.5px] leading-snug">
          <p className="text-amber-800">Could not get the transcript.</p>
          <p className="text-ink-500">{source.error}</p>
        </div>
      )}
      {source?.status === 'language' && <Languages onPick={(language) => void fetchWords(language)} />}
      {source?.status === 'none' && (
        <>
          <NoCaptions source={source} />
          {chosen && <Languages onPick={(language) => void fetchWords(language)} />}
        </>
      )}
      {/* Ready: the words are the fold-out's Transcript tab (`LinkWords`), not drawn here. */}
    </div>
  )
}
