import type { ReactNode } from 'react'
import { ChevronDown, ChevronUp, Loader2, PanelLeftClose, PanelLeftOpen, Scissors, Smartphone, Sparkles } from 'lucide-react'
import { foldoutShowing } from '@shared/foldout'
import { useEditor, urlSourceFor } from '../../store'
import { foldDownChoices, foldDownKeyDown } from '../ui/FoldDown'
import { LIT, lit } from '../ui/lit'
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
 * Best clips (docs/CLIPS.md §7.5's first half, sheet 27), in two parts since
 * the clip maker's layout (the user's sketch of 2026-11-27): what you choose
 * stays in the URL tile, and what Analyse finds unfolds beside the picture.
 *
 * IN THE URL TILE, four parts IngestPanel places in the sketch's order
 * (2026-11-27), each on screen whenever the box holds a link, so it can be
 * found before there are words: **Analyse** (`AnalyseButton`) in a row with
 * Get transcript — it downloads nothing, folds the length list and opens the
 * panel on Clips; the pointer under that row (`BestClipsPointer`: what to
 * press first, or that Analyse waits for another video's run, so a greyed
 * Analyse always says why here); the "Clips" toggle (`ClipsToggle`), beside
 * Transcript, that opens and closes the panel on its Clips tab, saying how
 * many clips were found; and the options (`BestClips`): the heading, the
 * length as one fold-down list, "Duration" (1 to 4 min), and Make it
 * vertical, a choice made before Analyse as well as after. Nothing long: no
 * card and no note is drawn here, because the 240 px column also holds the
 * Trimmer dock.
 *
 * IN THE PANEL (`BestClipsCards`, the fold-out's Clips tab, Foldout.tsx): the
 * running line, the cards and the notes under them, or one plain line saying
 * what to press when there is nothing yet. The cards sit one to a row in a
 * narrow panel and two or more in a wide one (a grid that fills, each card at
 * least 15rem): a 9:16 face with the stretch's length (no thumbnail in v1,
 * §7.5: unmeasured), and beside it the title, the why, the range, the word
 * count and who picked it. A title may be in any script: it wraps anywhere a
 * line must break, is never cut or clamped, and nothing here assumes Latin
 * widths.
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
 * No hook but the store's, so a test can call each part as a function.
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

/** The length list's id: one fold-down open at a time (the store's `foldDownOpen`). */
export const BEST_CLIPS_LENGTH_LIST = 'best-length'
/** The length list's name, the sketch's word. */
export const BEST_CLIPS_DURATION = 'Duration'
export const BEST_CLIPS_DURATION_TITLE = 'How long each clip should be'
/** The toggle that opens and closes the panel on its Clips tab. */
export const CLIPS_TOGGLE = 'Clips'
export const CLIPS_TOGGLE_TITLE = 'Show or hide the clips Analyse found, beside the picture'

/** The Clips tab with no link in the box. */
export const FOLDOUT_CLIPS_NO_LINK = 'No clips yet. Paste a video link in the URL tile to find its best clips.'
/** The Clips tab with a link that has no words yet (a video with no captions says so instead). */
export const FOLDOUT_CLIPS_NO_WORDS = 'No clips yet. Press Get transcript in the URL tile, then Analyse.'
/** The Clips tab with the link's words, nothing analysed yet. */
export const FOLDOUT_CLIPS_EMPTY = 'No clips yet. Press Analyse in the URL tile, at the end of Best clips’ row.'

/** What the URL tile's Best clips parts read: the link's source, and whether Analyse can run on it. */
function useBestClipsHere(): {
  link: boolean
  source: ReturnType<typeof urlSourceFor>
  running: boolean
  here: boolean
  refusal: ReturnType<typeof analyseRefusal>
  found: number
} {
  const ingest = useEditor((s) => s.ingest)
  const urlSource = useEditor((s) => s.urlSource)
  const state = useEditor((s) => s.bestClips)
  const source = urlSourceFor({ urlSource, ingest })
  return {
    link: parseLink(ingest.url) !== null,
    source,
    running: state.running !== null,
    here: runningHere(state, source),
    refusal: analyseRefusal(state, source),
    found: shownBestClips(state, source)?.cards.length ?? 0
  }
}

/**
 * Analyse, the LAST thing in Best clips' row of choices (`BestClips`), pushed
 * to the row's end: the choices are made along the row and Analyse acts on
 * them — the user, 2026-11-27: "put the analyse button after all the toggeles
 * like a check listing". (It sat beside Get transcript, as the sketch of that
 * morning drew it, until then.) On screen whenever the box holds a link;
 * greyed until there are words, and while one runs. It downloads nothing,
 * folds the length list and opens the panel on Clips. The solid accent fill
 * is an ACTION's; a chosen choice is lit instead (ui/lit.ts).
 */
export function AnalyseButton(): ReactNode {
  const analyse = useEditor((s) => s.analyseBestClips)
  const openFoldout = useEditor((s) => s.openFoldout)
  const foldDownOpen = useEditor((s) => s.foldDownOpen)
  const setFoldDownOpen = useEditor((s) => s.setFoldDownOpen)
  const { link, here, refusal } = useBestClipsHere()
  if (!link) return null
  return (
    <button
      type="button"
      data-best-analyse=""
      onClick={() => {
        // What it finds unfolds beside the picture; the store's Analyse is left as it was. The length
        // list folds for good: left open, it would unfold again by itself when the run ends.
        if (foldDownOpen === BEST_CLIPS_LENGTH_LIST) setFoldDownOpen(null)
        openFoldout('clips')
        void analyse()
      }}
      disabled={refusal !== null}
      title={ANALYSE_TITLE}
      className="ml-auto flex items-center gap-1.5 rounded bg-accent-500 px-2.5 py-1 text-[11px] font-medium text-ink-950 transition-colors hover:bg-accent-400 disabled:opacity-40"
    >
      {here && <Loader2 size={12} className="animate-spin" aria-hidden />}
      Analyse
    </button>
  )
}

/**
 * The pointer under Best clips' row of choices: what to press first, that Best clips
 * cannot listen to a video with no captions, or that Analyse waits for
 * another video's run — so a greyed Analyse always says why, whether the
 * panel is open or not.
 */
export function BestClipsPointer(): ReactNode {
  const { link, source, running, here } = useBestClipsHere()
  const state = useEditor((s) => s.bestClips)
  if (!link) return null
  // Whether the link on screen has words, whatever runs elsewhere.
  const noWords = analyseRefusal({ ...state, running: null }, source) === 'no-transcript'
  const fetching = source?.status === 'meta' || source?.status === 'captions'
  const pointer =
    // No captions: Best clips cannot listen yet with the AI helper or without it (Listen to it is not built), so
    // no line sends the user to install the helper for it.
    source?.status === 'none'
      ? BEST_CLIPS_CANNOT_LISTEN
      : noWords && !fetching
        ? BEST_CLIPS_NEEDS_TRANSCRIPT
        : // Analyse greyed by another link's run: the tile says why, whether the panel is open or not.
          running && !here
          ? BEST_CLIPS_RUNNING_ELSEWHERE
          : null
  if (!pointer) return null
  return (
    <p data-best-pointer="" aria-live="polite" className="mt-1.5 text-[10.5px] leading-snug text-ink-500">
      {pointer}
    </p>
  )
}

/**
 * The Clips toggle: opens and closes the panel on its Clips tab, pressed while
 * it shows (lit then, ui/lit.ts), with the number of clips found. At the end
 * of Best clips' heading row; on screen whenever the box holds a link.
 */
export function ClipsToggle(): ReactNode {
  const foldout = useEditor((s) => s.foldout)
  const toggleFoldout = useEditor((s) => s.toggleFoldout)
  const { link, found } = useBestClipsHere()
  if (!link) return null
  const showing = foldoutShowing(foldout, 'clips')
  const Panel = showing ? PanelLeftClose : PanelLeftOpen
  return (
    <button
      type="button"
      data-best-toggle=""
      aria-pressed={showing}
      onClick={() => toggleFoldout('clips')}
      title={CLIPS_TOGGLE_TITLE}
      className={`ml-auto flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors ${lit(showing)}`}
    >
      <Panel size={12} aria-hidden />
      {CLIPS_TOGGLE}
      {found > 0 && (
        <span data-best-count="" className="rounded bg-ink-800 px-1 text-[10px] tabular-nums text-ink-200">
          {found}
        </span>
      )}
    </button>
  )
}

/**
 * Best clips in the URL tile: its heading with the Clips toggle at the row's
 * end, then ONE row of choices that wraps, read left to right like a check
 * list and ending in Analyse, then the pointer line. The cards are
 * `BestClipsCards`, beside the picture.
 *
 * The user, 2026-11-27 (after the layout landed with Analyse above these
 * choices, as that morning's sketch drew it): "it goes like a row of
 * selection and in the end anallyse … in the same row our next toggles will
 * add to right ( captions ; smart1,2 , graphics toggle on/ off , bgm,
 * transcions with sync, broll coming soon... ) so put the analyse button
 * after all the toggeles like a check listing kind of so every toggele
 * selected get highlight".
 *
 * So the row is: **Duration** (a chip that says the length chosen and is its
 * fold-down list's button; the list unfolds on a line of its own under the
 * row, in the flow), **Make it vertical**, — the clip maker's later choices
 * go HERE, before Analyse — and **Analyse** last, at the row's end. A choice
 * that is on is lit (ui/lit.ts): Duration always is, a length being always
 * chosen; Make it vertical while it is on. Analyse is the one solid button.
 *
 * The row itself is the `[data-fold-down]` root, with the Duration chip as
 * its direct-child `button[aria-expanded]`, as the kinds row is
 * (IngestPanel.tsx `KindsRow`): that is where a choice or Escape puts the
 * keyboard back.
 */
export function BestClips(): ReactNode {
  const state = useEditor((s) => s.bestClips)
  const setLength = useEditor((s) => s.setBestClipsLength)
  const vertical = useEditor((s) => s.bestClipsVertical)
  const setVertical = useEditor((s) => s.setBestClipsVertical)
  const foldDownOpen = useEditor((s) => s.foldDownOpen)
  const setFoldDownOpen = useEditor((s) => s.setFoldDownOpen)
  const { link, running } = useBestClipsHere()

  // On screen whenever the box holds a link; its words are the link's own, or none yet.
  if (!link) return null

  const lengths = BEST_CLIPS_LENGTHS.map((length) => ({ value: length.ms, label: length.label }))
  const chosen = lengths.find((length) => length.value === state.targetMs)
  // Greyed, and folded, while Analyse runs: a length changed mid-run would drop its answer without a word.
  const open = foldDownOpen === BEST_CLIPS_LENGTH_LIST && !running
  const fold = (next: boolean): void => setFoldDownOpen(next ? BEST_CLIPS_LENGTH_LIST : null)
  const Chevron = open ? ChevronUp : ChevronDown

  return (
    <section data-best-clips="" className="mt-3 border-t border-ink-850 pt-2.5">
      <div className="flex flex-wrap items-center gap-1">
        <h3 className="flex items-center gap-1.5 text-[11.5px] text-ink-200">
          <Sparkles size={12} className="text-accent-400" aria-hidden />
          Best clips
        </h3>
        <ClipsToggle />
      </div>

      <div
        data-best-row=""
        data-fold-down={BEST_CLIPS_LENGTH_LIST}
        data-open={open}
        onKeyDown={foldDownKeyDown(open, fold)}
        className="mt-2 flex flex-wrap items-center gap-1.5"
      >
        <button
          type="button"
          data-best-duration=""
          aria-expanded={open}
          // Only while the list is in the page: folded, its id names nothing.
          aria-controls={open ? `fold-down-${BEST_CLIPS_LENGTH_LIST}` : undefined}
          title={BEST_CLIPS_DURATION_TITLE}
          disabled={running}
          onClick={() => fold(!open)}
          className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors disabled:opacity-40 ${LIT}`}
        >
          <span>{BEST_CLIPS_DURATION}</span>
          {chosen && (
            <>
              <span aria-hidden>·</span>
              <span>{chosen.label}</span>
            </>
          )}
          <Chevron size={11} className="shrink-0" aria-hidden />
        </button>

        {/* §7.5 step 0's switch, chosen before Analyse as well: on, a card's clip is a 9:16 short; it never changes an edit's aspect without asking. */}
        <button
          type="button"
          data-best-vertical=""
          aria-pressed={vertical}
          onClick={() => setVertical(!vertical)}
          title={MAKE_IT_VERTICAL_TITLE}
          className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors ${lit(vertical)}`}
        >
          <Smartphone size={12} aria-hidden />
          {MAKE_IT_VERTICAL}
        </button>

        {/* The clip maker's later choices (the count, the size, captions, graphics, music, transitions) go here, before Analyse. */}

        <AnalyseButton />

        {open &&
          foldDownChoices({
            id: BEST_CLIPS_LENGTH_LIST,
            label: BEST_CLIPS_DURATION,
            value: state.targetMs,
            choices: lengths,
            onOpenChange: fold,
            onChoose: setLength,
            choiceData: 'data-best-length',
            className: 'basis-full'
          })}
      </div>

      <BestClipsPointer />
    </section>
  )
}

/**
 * The fold-out's Clips tab: the running line, the cards and the notes under
 * them, or one line saying what to press first.
 */
export function BestClipsCards(): ReactNode {
  const ingest = useEditor((s) => s.ingest)
  const urlSource = useEditor((s) => s.urlSource)
  const state = useEditor((s) => s.bestClips)
  const question = useEditor((s) => s.bestClipsQuestion)
  const clipped = useEditor((s) => s.bestClipsClipped)
  const clipItFromCard = useEditor((s) => s.clipItFromCard)
  const answer = useEditor((s) => s.answerBestClipsQuestion)
  const dirty = useEditor((s) => s.dirty)
  const projectPath = useEditor((s) => s.projectPath)
  const settings = useEditor((s) => s.project.settings)
  const clips = useEditor((s) => s.project.clips)
  const projectId = useEditor((s) => s.project.id ?? null)

  const link = parseLink(ingest.url)
  const source = link ? urlSourceFor({ urlSource, ingest }) : null
  const running = state.running !== null
  const here = runningHere(state, source)
  const result = shownBestClips(state, source)
  const noWords = analyseRefusal({ ...state, running: null }, source) === 'no-transcript'
  // Nothing to show and nothing running: one line saying what to press.
  const empty =
    running || result
      ? null
      : !link
        ? FOLDOUT_CLIPS_NO_LINK
        : source?.status === 'none'
          ? BEST_CLIPS_CANNOT_LISTEN
          : noWords
            ? FOLDOUT_CLIPS_NO_WORDS
            : FOLDOUT_CLIPS_EMPTY

  return (
    <div data-best-clips-tab="" className="space-y-2">
      {running && (
        <p data-best-running={here ? 'here' : 'elsewhere'} aria-live="polite" className="text-[10.5px] text-ink-500">
          {here ? BEST_CLIPS_RUNNING : BEST_CLIPS_RUNNING_ELSEWHERE}
        </p>
      )}
      {empty && (
        <p data-best-empty="" className="text-[11px] leading-snug text-ink-500">
          {empty}
        </p>
      )}

      {result && (
        <div aria-live="polite" className="space-y-2">
          {result.cards.length > 0 && source && (
            // One card to a row in a narrow panel, more in a wide one; a card is never under 15rem, or the panel's width if less.
            <ul data-best-cards="" className="grid items-start gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(min(15rem,100%),1fr))]">
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
    </div>
  )
}
