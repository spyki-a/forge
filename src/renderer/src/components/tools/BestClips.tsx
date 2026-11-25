import type { ReactNode } from 'react'
import { Loader2, Scissors, Smartphone, Sparkles } from 'lucide-react'
import { useEditor, urlSourceFor } from '../../store'
import { parseLink } from '@shared/ingest/url'
import { formatMark } from '@shared/ingest/section'
import type { BestClipCard } from '@shared/bestclips/run'
import {
  ADD_KEEPS_SHAPE,
  ADD_PORTRAIT,
  ADD_TO_PROJECT,
  cardClipGone,
  cardClippable,
  cardDownloadsIn,
  cardKey,
  CLIP_IT_CARD,
  CLIP_IT_CARD_TITLE,
  isPortrait,
  MAKE_IT_VERTICAL,
  MAKE_IT_VERTICAL_TITLE,
  NOT_NOW,
  QUESTION_HEAD,
  START_NEW_PROJECT,
  START_NEW_SAVED,
  START_NEW_SAVES,
  START_NEW_WAITS,
  STEP_LABEL,
  unsavedWork,
  type CardClipRecord
} from '@shared/bestclips/cardClip'
import {
  analyseRefusal,
  BEST_CLIPS_LENGTHS,
  BEST_CLIPS_CANNOT_LISTEN,
  BEST_CLIPS_NEEDS_TRANSCRIPT,
  BEST_CLIPS_RUNNING,
  BEST_CLIPS_RUNNING_ELSEWHERE,
  cardRange,
  cardWords,
  runningHere,
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
 * CLIP IT on a card (§7.5 steps 0 to 5) sits at the foot of its text column.
 * When the timeline already has clips and Make it vertical is on, the card
 * asks first, in place: "Start a new 9:16 project for this clip" or "Add it
 * to this project", each with a line saying what it does. Once pressed, the
 * card lists what ran and what was skipped, and why (the store's
 * `bestClipsClipped` record, shared/bestclips/cardClip.ts); the other cards
 * stay pressable: three separate shorts.
 *
 * No hook but the store's, so a test can call it as a function.
 */

export const ANALYSE_TITLE = 'Find the stretches of this video most worth posting, from its captions — nothing is downloaded'

/** What a card shows under its text: Clip it, the question, or what Clip it did. */
interface CardFoot {
  record: CardClipRecord | undefined
  /** The clips on this timeline: a record whose clip is no longer among them is not shown, and the card can be clipped again. */
  clips: readonly { id: string }[]
  asking: boolean
  /** Another card's question is open, or a download is being asked for. */
  blocked: boolean
  /** A download is being asked for: the question's choices wait for it. */
  busy: boolean
  /** Start new would save this project first (`unsavedWork`). */
  unsaved: boolean
  /** A card's clip is still downloading into this project: Start new waits for it. */
  pendingHere: boolean
  portrait: boolean
  clipIt: () => void
  answer: (choice: 'new' | 'add' | null) => void
}

function Steps({ record }: { record: CardClipRecord }): ReactNode {
  return (
    <ul data-card-steps="" aria-live="polite" className="space-y-0.5">
      {record.steps.map((step) => (
        <li key={step.name} data-card-step={step.name} data-step-state={step.state} className="text-[10px] leading-snug [overflow-wrap:anywhere]">
          <span className="text-ink-300">{STEP_LABEL[step.name]}</span>
          {' '}
          <span className={step.state === 'failed' ? 'text-red-800' : 'text-ink-500'}>{step.text}</span>
        </li>
      ))}
    </ul>
  )
}

function Question({ busy, unsaved, pendingHere, portrait, answer }: Pick<CardFoot, 'busy' | 'unsaved' | 'pendingHere' | 'portrait' | 'answer'>): ReactNode {
  const choice = 'w-full rounded bg-ink-850 px-2 py-1 text-left text-[11px] text-ink-100 transition-colors hover:bg-ink-800 disabled:opacity-50'
  return (
    <div data-best-question="" role="group" aria-label={QUESTION_HEAD} className="space-y-1 rounded border border-accent-500/40 bg-accent-500/5 p-1.5">
      <p className="text-[10.5px] leading-snug text-ink-300">{QUESTION_HEAD}</p>
      <button type="button" data-best-choice="new" onClick={() => answer('new')} disabled={busy || pendingHere} className={choice}>
        <span className="block font-medium">{START_NEW_PROJECT}</span>
        <span className="block text-[10px] leading-snug text-ink-500">
          {pendingHere ? START_NEW_WAITS : unsaved ? START_NEW_SAVES : START_NEW_SAVED}
        </span>
      </button>
      <button type="button" data-best-choice="add" onClick={() => answer('add')} disabled={busy} className={choice}>
        <span className="block font-medium">{ADD_TO_PROJECT}</span>
        <span className="block text-[10px] leading-snug text-ink-500">{portrait ? ADD_PORTRAIT : ADD_KEEPS_SHAPE}</span>
      </button>
      <button type="button" data-best-choice="cancel" onClick={() => answer(null)} className="rounded px-2 py-0.5 text-[10.5px] text-ink-500 hover:text-ink-200">
        {NOT_NOW}
      </button>
    </div>
  )
}

function Foot({ record, clips, asking, blocked, busy, unsaved, pendingHere, portrait, clipIt, answer }: CardFoot): ReactNode {
  if (asking) return <Question busy={busy} unsaved={unsaved} pendingHere={pendingHere} portrait={portrait} answer={answer} />
  return (
    <>
      {/* A clip undone, deleted or in another project: what the record says no longer holds here. */}
      {record && !cardClipGone(record, clips) && <Steps record={record} />}
      {cardClippable(record, clips) && (
        <button
          type="button"
          onClick={clipIt}
          disabled={blocked}
          title={CLIP_IT_CARD_TITLE}
          className="mt-1 flex items-center gap-1.5 rounded bg-accent-500 px-2.5 py-1 text-[11px] font-medium text-ink-950 transition-colors hover:bg-accent-400 disabled:opacity-40"
        >
          <Scissors size={12} aria-hidden />
          {CLIP_IT_CARD}
        </button>
      )}
    </>
  )
}

function Card({ card, foot }: { card: BestClipCard; foot: CardFoot }): ReactNode {
  return (
    <li data-best-card={card.windowId} data-scored-by={card.scoredBy} className="flex gap-2 rounded border border-ink-800 bg-ink-950/60 p-1.5">
      {/* The tall face: 9:16, the stretch's length on it; self-start, so a tall text column cannot stretch it. */}
      <div className="flex aspect-[9/16] w-12 shrink-0 self-start flex-col items-center justify-center rounded bg-ink-850 text-ink-400">
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
        <div data-best-clip-it={card.windowId} className="pt-0.5">
          <Foot {...foot} />
        </div>
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
  const vertical = useEditor((s) => s.bestClipsVertical)
  const setVertical = useEditor((s) => s.setBestClipsVertical)
  const question = useEditor((s) => s.bestClipsQuestion)
  const clipped = useEditor((s) => s.bestClipsClipped)
  const clipItFromCard = useEditor((s) => s.clipItFromCard)
  const answer = useEditor((s) => s.answerBestClipsQuestion)
  const dirty = useEditor((s) => s.dirty)
  const projectPath = useEditor((s) => s.projectPath)
  const settings = useEditor((s) => s.project.settings)
  const clips = useEditor((s) => s.project.clips)
  const projectId = useEditor((s) => s.project.id ?? null)

  // On screen whenever the box holds a link; its words are the link's own, or none yet.
  if (!parseLink(ingest.url)) return null
  const source = urlSourceFor({ urlSource, ingest })
  const running = state.running !== null
  const here = runningHere(state, source)
  const refusal = analyseRefusal(state, source)
  // Whether the link on screen has words, whatever runs elsewhere.
  const noWords = analyseRefusal({ ...state, running: null }, source) === 'no-transcript'
  const result = shownBestClips(state, source)
  const fetching = source?.status === 'meta' || source?.status === 'captions'
  const pointer =
    // No captions: Best clips cannot listen yet with the AI helper or without it (Listen to it is not built), so
    // no line sends the user to install the helper for it.
    source?.status === 'none'
      ? BEST_CLIPS_CANNOT_LISTEN
      : noWords && !fetching
        ? BEST_CLIPS_NEEDS_TRANSCRIPT
        : null

  return (
    <section data-best-clips="" className="mt-3 space-y-2 border-t border-ink-850 pt-2.5">
      <h3 className="flex items-center gap-1.5 text-[11.5px] text-ink-200">
        <Sparkles size={12} className="text-accent-400" aria-hidden />
        Best clips
      </h3>

      <div role="group" aria-label="Clip length" className="flex flex-wrap items-center gap-1">
        {BEST_CLIPS_LENGTHS.map((length) => {
          const on = state.targetMs === length.ms
          return (
            <button
              key={length.ms}
              type="button"
              data-best-length={length.ms}
              aria-pressed={on}
              // Greyed while Analyse runs: a length changed mid-run would drop its answer without a word.
              disabled={running}
              onClick={() => setLength(length.ms)}
              className={`rounded px-2 py-1 text-[11px] transition-colors disabled:opacity-60 ${
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
          {here && <Loader2 size={12} className="animate-spin" aria-hidden />}
          Analyse
        </button>
      </div>

      {pointer && (
        <p data-best-pointer="" aria-live="polite" className="text-[10.5px] leading-snug text-ink-500">
          {pointer}
        </p>
      )}
      {running && (
        <p data-best-running={here ? 'here' : 'elsewhere'} aria-live="polite" className="text-[10.5px] text-ink-500">
          {here ? BEST_CLIPS_RUNNING : BEST_CLIPS_RUNNING_ELSEWHERE}
        </p>
      )}

      {result && (
        <div aria-live="polite" className="space-y-2">
          {result.cards.length > 0 && source && (
            <>
              {/* §7.5 step 0's switch: on, a card's clip is a 9:16 short; it never changes an edit's aspect without asking. */}
              <button
                type="button"
                data-best-vertical=""
                aria-pressed={vertical}
                onClick={() => setVertical(!vertical)}
                title={MAKE_IT_VERTICAL_TITLE}
                className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors ${
                  vertical ? 'bg-ink-700 text-ink-100' : 'bg-ink-850 text-ink-500 hover:text-ink-200'
                }`}
              >
                <Smartphone size={12} aria-hidden />
                {MAKE_IT_VERTICAL}
              </button>
              <ul data-best-cards="" className="space-y-1.5">
                {result.cards.map((card) => {
                  const key = cardKey(source.linkKey, card)
                  return (
                    <Card
                      key={card.windowId}
                      card={card}
                      foot={{
                        record: clipped[key],
                        clips,
                        asking: question?.key === key,
                        blocked: question !== null || ingest.busy,
                        busy: ingest.busy,
                        unsaved: unsavedWork({ dirty, projectPath }),
                        pendingHere: cardDownloadsIn(clipped, projectId) > 0,
                        portrait: isPortrait(settings),
                        clipIt: () => void clipItFromCard(card),
                        answer: (choice) => void answer(choice)
                      }}
                    />
                  )
                })}
              </ul>
            </>
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
        </div>
      )}
    </section>
  )
}
