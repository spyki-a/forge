import type { ReactNode } from 'react'
import { timelineFrameAt, type Clip, type GraphicProposal, type MediaAsset } from '@shared/timeline'
import { CHECK_THE_NUMBER, CLEAR_GRAPHICS_NOTE, CLIPS_GRAPHIC_RULE, drawnStrings } from '@shared/graphics/apply'
import { footageOf } from '@shared/graphics/sound'
import type { GraphicData } from '@shared/graphics/template'
import { GRAPHICS_BUSY_NOTE, useEditor } from '../store'
import { rowStamp } from './tools/TranscriptRows'

/**
 * The Transcript tile's **Graphics** section (docs/CLIPS.md §6.6, "By hand"),
 * mounted in TranscriptPanel between the rows and Listen for:
 *
 * - **Find graphics in this clip** (`findGraphics`), greyed with its reason
 *   when the clip has no transcript, and reading "Finding graphics…" while the
 *   ask is out, as Transcribe reads "Transcribing…";
 * - every graphic over the clip, WHICHEVER rule made it (Find's, Direct's,
 *   your own): its template, the words it draws (`drawnStrings`) and where it
 *   starts on the timeline, with **Drop** on each; and each pending proposal of
 *   the clip with **Keep** and **Drop**, and **check the number** beside the
 *   words it heard (the proposal's note, `check the number: heard "…"`);
 * - the notes of the clip's last Find, each drop with its reason;
 * - **Clear graphics**, with its note that Direct's graphics stay;
 * - the **Speaker** field, `MediaAsset.speaker` (§16.31). For a link's asset it
 *   starts empty with the channel (`credit.author`) as its PLACEHOLDER, never
 *   its value: a quote takes the channel while it is empty, but a lower third
 *   waits until a name is typed or **Use the channel name** is pressed.
 *
 * No hook but the store's, so a test can call it as a function and press what
 * it returns (tests/renderer/transcriptGraphics.test.tsx). The Speaker field is
 * uncontrolled for that reason: saved on leaving it (one undo step, as Listen
 * for is), and keyed on the stored name so a change made elsewhere shows.
 */

export const GRAPHICS_HEADING = 'Graphics'
export const FIND_GRAPHICS = 'Find graphics in this clip'
/** The button while the ask is out (not the plan's words; Transcribe's "Transcribing…" pattern). */
export const FINDING_GRAPHICS = 'Finding graphics…'
/** Why Find is greyed on a clip with no transcript (not the plan's words). */
export const FIND_NEEDS_TRANSCRIPT = 'Transcribe this clip first — graphics are found in its words'
export const KEEP = 'Keep'
export const DROP = 'Drop'
export const CLEAR_GRAPHICS = 'Clear graphics'
/** Clear graphics' title (not the plan's words): it is the whole project's, not this clip's. */
export const CLEAR_GRAPHICS_TITLE = 'Removes every graphic Find graphics placed, in every clip, with its sounds and the numbers waiting to be checked'
export const SPEAKER = 'Speaker'
/** The press beside an empty Speaker on a link's asset (not the plan's words: §6.6 says "press to use the channel's"). */
export const USE_CHANNEL_NAME = 'Use the channel name'
/** Its title (not the plan's words): why the channel is not taken on its own. */
export const USE_CHANNEL_TITLE = 'A lower third shows the Speaker; a channel may be a brand rather than the person speaking'
/** The notes' line when no model's answer was used (record model 'baseline'; not the plan's words, true before and after lane T4's baseline). */
export const NO_MODEL_LINE = 'No model’s answer was used in this run'

/** A template as the list names it: "lower third", not "lower-third". */
const templateName = (d: GraphicData): string => d.template.replace(/-/g, ' ')

/** The words a graphic draws, as one line. */
const wordsOf = (d: GraphicData): string =>
  drawnStrings(d)
    .filter((s) => s.trim() !== '')
    .join(' · ')

/** A link's channel, the Speaker's placeholder (§16.31); null for any other asset. */
function channelOf(asset: MediaAsset | undefined): string | null {
  const author = asset?.credit?.source === 'link' ? (asset.credit.author ?? '').trim() : ''
  return author === '' ? null : author
}

export function TranscriptGraphics({ clip, hasTranscript }: { clip: Clip; hasTranscript: boolean }): ReactNode {
  const project = useEditor((s) => s.project)
  const findingGraphics = useEditor((s) => s.findingGraphics)
  const lastGraphics = useEditor((s) => s.lastGraphics)
  const findGraphics = useEditor((s) => s.findGraphics)
  const keepGraphic = useEditor((s) => s.keepGraphic)
  const dropGraphic = useEditor((s) => s.dropGraphic)
  const clearGraphics = useEditor((s) => s.clearGraphics)
  const setSpeaker = useEditor((s) => s.setSpeaker)
  const fps = project.settings.fps

  // Every graphic whose footage clip is this one, whichever rule made it (§6.6).
  const graphics = project.clips
    .filter((c) => c.graphic !== undefined && footageOf(project, c, c.graphic) === clip.id)
    .sort((a, b) => a.start - b.start)
  const proposals = (project.graphicProposals ?? []).filter((g) => g.clipId === clip.id)
  const clearable =
    project.clips.some((c) => c.graphic !== undefined && c.generatedBy?.rule === CLIPS_GRAPHIC_RULE) ||
    (project.graphicProposals ?? []).some((g) => g.rule === CLIPS_GRAPHIC_RULE)
  const notes = lastGraphics !== null && lastGraphics.clipId === clip.id ? lastGraphics : null
  const running = findingGraphics === clip.id
  const busy = findingGraphics !== null
  const asset = project.assets.find((a) => a.id === clip.assetId)
  const speaker = asset?.speaker ?? ''
  const channel = channelOf(asset)

  /** Where a proposal would start, from its first grounding word through this clip; null when it has none. */
  const proposalStamp = (g: GraphicProposal): string | null => {
    const first = g.spec.grounding?.words[0]
    const word = first === undefined ? undefined : project.transcripts[g.spec.grounding!.assetId]?.words.find((w) => w.index === first)
    const frame = word ? timelineFrameAt(clip, word.startMs, fps) : null
    return frame === null || frame === undefined ? null : rowStamp((frame / fps) * 1000)
  }
  const checkPrefix = `${CHECK_THE_NUMBER}: `

  return (
    <div data-transcript-graphics="" className="shrink-0 space-y-1.5 border-t border-ink-800 px-3 py-2">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-ink-400">{GRAPHICS_HEADING}</span>

      <button
        type="button"
        data-find-graphics=""
        onClick={() => void findGraphics(clip.id)}
        disabled={!hasTranscript || busy}
        title={!hasTranscript ? FIND_NEEDS_TRANSCRIPT : busy && !running ? GRAPHICS_BUSY_NOTE : undefined}
        className="w-full rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-300 transition-colors hover:bg-ink-700 hover:text-ink-100 disabled:opacity-40"
      >
        {running ? FINDING_GRAPHICS : FIND_GRAPHICS}
      </button>

      {(graphics.length > 0 || proposals.length > 0) && (
        <ul data-graphic-list="" className="max-h-40 space-y-1 overflow-y-auto">
          {graphics.map((g) => (
            <li key={g.id} data-graphic={g.id} className="flex items-center gap-2 text-[10.5px] text-ink-300">
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-600">{rowStamp((g.start / fps) * 1000)}</span>
              <span className="shrink-0 text-ink-500">{templateName(g.graphic!.data)}</span>
              <span className="min-w-0 flex-1 truncate">{wordsOf(g.graphic!.data)}</span>
              <button
                type="button"
                onClick={() => dropGraphic(g.id)}
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-ink-500 hover:bg-ink-800 hover:text-ink-200"
              >
                {DROP}
              </button>
            </li>
          ))}
          {proposals.map((g) => {
            const stamp = proposalStamp(g)
            const checked = g.note.startsWith(checkPrefix)
            return (
              <li key={g.id} data-graphic-proposal={g.id} className="space-y-0.5 text-[10.5px] text-ink-300">
                <div className="flex items-center gap-2">
                  {stamp !== null && <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-600">{stamp}</span>}
                  <span className="shrink-0 text-ink-500">{templateName(g.spec.data)}</span>
                  <span className="min-w-0 flex-1 truncate">{wordsOf(g.spec.data)}</span>
                  <button
                    type="button"
                    onClick={() => keepGraphic(g.id)}
                    className="shrink-0 rounded bg-accent-500 px-1.5 py-0.5 text-[10px] font-medium text-ink-950 hover:bg-accent-400"
                  >
                    {KEEP}
                  </button>
                  <button
                    type="button"
                    onClick={() => dropGraphic(g.id)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-ink-500 hover:bg-ink-800 hover:text-ink-200"
                  >
                    {DROP}
                  </button>
                </div>
                {checked ? (
                  <p className="flex gap-1.5 text-[10px] text-ink-500">
                    <span className="font-medium text-accent-400">{CHECK_THE_NUMBER}</span>
                    <span data-heard="">{g.note.slice(checkPrefix.length)}</span>
                  </p>
                ) : (
                  <p className="text-[10px] text-ink-500">{g.note}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {notes && (
        <ul data-graphic-notes="" className="max-h-24 space-y-0.5 overflow-y-auto text-[10px] leading-snug text-ink-500">
          {notes.model === 'baseline' && <li>{NO_MODEL_LINE}</li>}
          {notes.notes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      )}

      {clearable && (
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => clearGraphics()}
            title={CLEAR_GRAPHICS_TITLE}
            className="rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-300 transition-colors hover:bg-ink-700 hover:text-ink-100"
          >
            {CLEAR_GRAPHICS}
          </button>
          <p className="text-[10px] text-ink-600">{CLEAR_GRAPHICS_NOTE}</p>
        </div>
      )}

      {asset && (
        <div className="flex items-center gap-2">
          <label className="shrink-0 text-[10px] text-ink-500" htmlFor="forge-speaker">
            {SPEAKER}
          </label>
          <input
            id="forge-speaker"
            key={`${asset.id}:${speaker}`}
            defaultValue={speaker}
            placeholder={channel ?? undefined}
            onBlur={(e) => {
              if (e.target.value.trim() !== speaker.trim()) setSpeaker(asset.id, e.target.value)
            }}
            onKeyDown={(e) => {
              // Kept from the shortcut layer: these keys belong to the text box now.
              e.stopPropagation()
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            className="min-w-0 flex-1 rounded bg-ink-850 px-2 py-1 text-[11px] text-ink-200 outline-none placeholder:text-ink-600 focus:ring-1 focus:ring-ink-600"
          />
          {speaker.trim() === '' && channel !== null && (
            <button
              type="button"
              onClick={() => setSpeaker(asset.id, channel)}
              title={USE_CHANNEL_TITLE}
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-ink-500 hover:bg-ink-800 hover:text-ink-200"
            >
              {USE_CHANNEL_NAME}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
