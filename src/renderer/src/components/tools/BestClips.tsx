import type { ReactNode } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { useEditor, urlSourceFor } from '../../store'
import { parseLink } from '@shared/ingest/url'
import { formatMark } from '@shared/ingest/section'
import { transcribeGate } from '@shared/sidecar/row'
import type { BestClipCard } from '@shared/bestclips/run'
import {
  analyseRefusal,
  BEST_CLIPS_LENGTHS,
  BEST_CLIPS_LISTEN_FIRST,
  BEST_CLIPS_NEEDS_TRANSCRIPT,
  BEST_CLIPS_NO_CAPTIONS,
  BEST_CLIPS_RUNNING,
  cardRange,
  cardWords,
  SCORED_BY_LABEL,
  shownBestClips
} from '@shared/bestclips/session'

/**
 * Best clips in the URL tile (docs/CLIPS.md §7.5's first half, sheet 27):
 * **1 min · 2 min · 3 min · 4 min** as one choice, **Analyse**, then up to
 * three cards, each a stretch of the video worth posting on its own.
 *
 * WHERE. In IngestPanel, right under LinkTranscript (the link's rows and Clip
 * download) and above the From and To fields: Best clips reads the transcript
 * Get transcript fetched, so it comes after it, and it is on screen whenever
 * the box holds a link, so it can be found before there are words (it then
 * points at Get transcript). Analyse downloads nothing.
 *
 * THE CARDS are tall (a 9:16 face) and stacked, not side by side as sheet 27
 * drew them: three side by side in the 240 px column leave each about 68 px,
 * too narrow for a title of up to 60 graphemes and a why of 120. The face
 * holds the stretch's length (no thumbnail in v1, §7.5: unmeasured); the
 * title, the why, the range, the word count and who picked it sit beside it.
 * A title may be in any script: it wraps anywhere a line must break, is never
 * cut or clamped, and nothing here assumes Latin widths.
 *
 * NEVER ON SCREEN: the result's `problems` and `askNotes`, or any error's
 * text. They can quote the model or name a server; only the fixed notes are
 * shown (`note`, `modelNote`, a card's `note`).
 *
 * Clip it on a card is piece 4's (§7.5 step 0 onwards): this piece renders no
 * Clip it control. It goes at the foot of each card's text column.
 *
 * No hook but the store's, so a test can call it as a function.
 */

export const ANALYSE_TITLE = 'Find the stretches of this video most worth posting, from its captions — nothing is downloaded'

function Card({ card }: { card: BestClipCard }): ReactNode {
  return (
    <li data-best-card={card.windowId} data-scored-by={card.scoredBy} className="flex gap-2 rounded border border-ink-800 bg-ink-950/60 p-1.5">
      {/* The tall face: 9:16, the stretch's length on it. */}
      <div className="flex aspect-[9/16] w-12 shrink-0 flex-col items-center justify-center rounded bg-ink-850 text-ink-400">
        <span data-card-length="" className="text-[10px] tabular-nums">
          {formatMark(card.endMs - card.startMs)}
        </span>
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p data-card-title="" className="whitespace-normal text-[11px] font-medium leading-snug text-ink-100 [overflow-wrap:anywhere]">
          {card.title}
        </p>
        <p data-card-why="" className="whitespace-normal text-[10.5px] leading-snug text-ink-400 [overflow-wrap:anywhere]">
          {card.why}
        </p>
        <p className="text-[10px] text-ink-500">
          <span data-card-range="" className="tabular-nums">
            {cardRange(card)}
          </span>
          {' · '}
          <span data-card-words="">{cardWords(card)}</span>
        </p>
        <p data-card-by="" className="text-[10px] text-ink-500">
          {SCORED_BY_LABEL[card.scoredBy]}
        </p>
        {card.note && (
          <p data-card-note="" className="text-[9.5px] leading-snug text-ink-600">
            {card.note}
          </p>
        )}
      </div>
    </li>
  )
}

export function BestClips(): ReactNode {
  const ingest = useEditor((s) => s.ingest)
  const urlSource = useEditor((s) => s.urlSource)
  const state = useEditor((s) => s.bestClips)
  const setLength = useEditor((s) => s.setBestClipsLength)
  const analyse = useEditor((s) => s.analyseBestClips)
  const helperStatus = useEditor((s) => s.helperStatus)
  const speechModel = useEditor((s) => s.speechModel)

  // On screen whenever the box holds a link; its words are the link's own, or none yet.
  if (!parseLink(ingest.url)) return null
  const source = urlSourceFor({ urlSource, ingest })
  const running = state.running !== null
  const refusal = analyseRefusal(state, source)
  const result = shownBestClips(state, source)
  const fetching = source?.status === 'meta' || source?.status === 'captions'
  const pointer =
    source?.status === 'none'
      ? transcribeGate(helperStatus, speechModel) === 'no-helper'
        ? BEST_CLIPS_NO_CAPTIONS
        : BEST_CLIPS_LISTEN_FIRST
      : refusal === 'no-transcript' && !fetching
        ? BEST_CLIPS_NEEDS_TRANSCRIPT
        : null

  return (
    <section data-best-clips="" className="mt-3 space-y-2 border-t border-ink-850 pt-2.5">
      <h3 className="flex items-center gap-1.5 text-[11.5px] text-ink-200">
        <Sparkles size={12} className="text-accent-400" aria-hidden />
        Best clips
      </h3>

      <div className="flex flex-wrap items-center gap-1">
        {BEST_CLIPS_LENGTHS.map((length) => {
          const on = state.targetMs === length.ms
          return (
            <button
              key={length.ms}
              type="button"
              data-best-length={length.ms}
              aria-pressed={on}
              onClick={() => setLength(length.ms)}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${
                on ? 'bg-ink-700 text-ink-100' : 'bg-ink-850 text-ink-500 hover:text-ink-200'
              }`}
            >
              {length.label}
            </button>
          )
        })}
        <button
          type="button"
          data-best-analyse=""
          onClick={() => void analyse()}
          disabled={refusal !== null}
          title={ANALYSE_TITLE}
          className="ml-auto flex items-center gap-1.5 rounded bg-accent-500 px-2.5 py-1 text-[11px] font-medium text-ink-950 transition-colors hover:bg-accent-400 disabled:opacity-40"
        >
          {running && <Loader2 size={12} className="animate-spin" aria-hidden />}
          Analyse
        </button>
      </div>

      {pointer && (
        <p data-best-pointer="" className="text-[10.5px] leading-snug text-ink-500">
          {pointer}
        </p>
      )}
      {running && (
        <p data-best-running="" className="text-[10.5px] text-ink-500">
          {BEST_CLIPS_RUNNING}
        </p>
      )}

      {result && (
        <>
          {result.cards.length > 0 && (
            <ul data-best-cards="" className="space-y-1.5">
              {result.cards.map((card) => (
                <Card key={card.windowId} card={card} />
              ))}
            </ul>
          )}
          {result.note && (
            <p data-best-note="" className="text-[10.5px] leading-snug text-ink-400">
              {result.note}
            </p>
          )}
          {result.modelNote && (
            <p data-best-model-note="" className="text-[10px] leading-snug text-ink-500">
              {result.modelNote}
            </p>
          )}
        </>
      )}
    </section>
  )
}
