import { type ReactNode } from 'react'
import { AlertTriangle, ScanFace } from 'lucide-react'
import { orientationMismatch } from '@shared/edit/orientation'
import { reframeOffer } from '@shared/edit/reframeOffer'
import { followCandidates } from '@shared/reframe/follow'
import { ASPECTS, useEditor, type AspectKey } from '../store'

/**
 * The bar above the picture: the canvas's shape, what the preview shows, and
 * a warning when the photos and the canvas disagree (docs/WINDOW.md §3.15) —
 * or, ahead of it, the offer to follow the subject in landscape video on a
 * portrait canvas (docs/CLIPS.md §4.8, shared/edit/reframeOffer.ts).
 *
 * The shape and the view switch lived in the Inspector's Output column, a
 * panel away from the picture they change, and the orientation warning lived in
 * the Create tab's reel section, where only the reel could see it. All three
 * are about the canvas, so they sit on it.
 *
 * Flat, like the timeline and the preview: the raised look is for the tool
 * tiles and the big buttons only (components/ui/Tile.tsx). Always rendered,
 * whatever the state — the Preview is its sibling in App.tsx, and its rAF loop
 * is the playback clock, so nothing here may make React move or remount it.
 */

/** How much of the preview is the source, left of the divider (store `splitRatio`). */
const VIEWS = [
  ['Source', 1],
  ['Split', 0.5],
  ['Output', 0]
] as const

/** Each shape, drawn: a ratio alone makes someone do the arithmetic to picture it. */
const GLYPH: Record<AspectKey, { width: number; height: number }> = {
  '16:9': { width: 14, height: 8 },
  '9:16': { width: 8, height: 14 },
  '1:1': { width: 9, height: 9 }
}

/**
 * The chip's words, by the shape it offers, and the reason, which is its tooltip.
 *
 * Short, because the bar is shared: at the default window "Most of your photos
 * are portrait" was cut to "Most of your photos …" and at the minimum one to
 * "M…", losing the one word that carries the meaning. The tooltip repeats the
 * words before the reason, so a chip squeezed narrower still (a dragged panel)
 * never hides what it is warning about.
 */
const CHIP = {
  '9:16': {
    text: 'Most photos are portrait',
    why: 'On this canvas they sit in a narrow strip with black either side.'
  },
  '16:9': {
    text: 'Most photos are landscape',
    why: 'On a vertical canvas they sit in a band with black above and below.'
  }
} as const

/**
 * The reframe offer's words (docs/CLIPS.md §4.8, shared/edit/reframeOffer.ts),
 * by the canvas it is on. The offer fires on a portrait canvas only, and the
 * one portrait shape the bar offers is 9:16; a project saved at some other
 * portrait size (aspectOf names the nearest shape, which may be 1:1) gets the
 * plain words rather than a shape it is not.
 *
 * Its button follows the subject in every such clip and NEVER changes the
 * canvas: the canvas already has the shape the reel wants, and it is the
 * clips that have to come to it. That is the whole difference from the photo
 * chip beside it, which is why they are two chips and not one rule.
 */
const OFFER: Partial<Record<AspectKey, { text: string; button: string }>> = {
  '9:16': { text: 'Landscape video on a 9:16 canvas', button: 'Reframe to 9:16' }
}
const OFFER_PLAIN = { text: 'Landscape video on a portrait canvas', button: 'Reframe to fit' }
const OFFER_WHY =
  'It sits in a band with black above and below. Reframing finds the subject in each clip and follows it — the canvas keeps its shape.'

/*
 * When the shape words give way to the chip, by the bar's own width (it is the
 * `@container`, and a container query measures its content box: the bar less
 * its 16 px of padding). Measured in the harness, 2026-10-02: the parts and
 * their gaps need 474 px with the words and no chip, 748 with the words and
 * the landscape chip (the wider one), and 601 with the chip and no words. The
 * content box is 624 at the 1100×680 minimum window, 726 at 1276×706 and 798
 * at 1400×900. The words are also in each button's tooltip, and the glyph
 * draws the shape, so they are the first thing to go — and only when the room
 * needs it: 48rem was 768, 20 px over the 748, and 32rem is 38 over the 474,
 * as slack for another platform's font. Narrower than 601 the chip's words
 * truncate, and its tooltip still says them.
 *
 * The reframe offer is the wider chip (docs/CLIPS.md §4.8), measured in the
 * harness 2026-10-13: 312 px, and 415 with "needs the AI helper" beside its
 * button, against the photo chip's 266. With the shape words that is 794 and
 * 897 of content (words 314, view 152, two 8 px gaps); without them 647 and
 * 750. At 48rem the words stayed in a 843 px bar and the offer's words were
 * cut 53 px short ("Landscape video on a 9:…"), so the words now go below
 * 57rem, 912: 15 px over the 897. The photo chip's words go a little sooner
 * than they need to, which the glyphs and tooltips cover.
 */
const WORDS_GO = { chip: '@max-[57rem]:hidden', plain: '@max-[32rem]:hidden' } as const

export function CanvasBar(): ReactNode {
  const aspect = useEditor((s) => s.aspect)
  const setAspect = useEditor((s) => s.setAspect)
  const splitRatio = useEditor((s) => s.splitRatio)
  const setSplitRatio = useEditor((s) => s.setSplitRatio)
  const assets = useEditor((s) => s.project.assets)
  const settings = useEditor((s) => s.project.settings)
  const clips = useEditor((s) => s.project.clips)
  const tracks = useEditor((s) => s.project.tracks)
  const reframe = useEditor((s) => s.reframe)
  const reframeAll = useEditor((s) => s.reframeAll)
  const notify = useEditor((s) => s.notify)
  /*
   * Two chips, one slot, and the reframe offer first: with landscape video on
   * a portrait canvas the canvas has the shape the reel wants, so the photo
   * chip's "Switch to 16:9" would be the wrong advice beside it (CLIPS.md §4.8).
   * The photo rule itself is unchanged and still photos-only.
   */
  const offer = reframeOffer({ clips, assets, tracks, settings })
  const mismatch = offer === null ? orientationMismatch(assets, settings) : null
  /** Either chip is up: the shape words give way sooner (WORDS_GO). */
  const chip = offer !== null || mismatch !== null
  const offerWords = OFFER[aspect] ?? OFFER_PLAIN
  /*
   * Greyed without the AI helper, as Follow the subject is in the dock: with
   * no face finder the job would find the shots and centre every crop, which
   * is what the clips already have. Starting is said as starting.
   */
  const helperWhy =
    reframe.helper === 'ready' ? null : reframe.helper === 'missing' ? 'needs the AI helper' : 'the AI helper is starting'
  // Every file the offer is about is being analysed already: one job per file, so a second press would only wait.
  const busy =
    offer !== null && followCandidates({ clips, assets, tracks }).every((clip) => reframe.pending[clip.assetId] !== undefined)

  return (
    <div className="@container flex h-8 shrink-0 items-center gap-2 border-b border-ink-800 px-2">
      {/*
        16:9 and 9:16 are the two shapes anyone cuts for; 1:1 is kept, smaller
        (WINDOW.md §4 Decision 1, answered in §7). Every one re-solves every clip's reframe,
        which the tooltip says where the Inspector used to say it in a line.
      */}
      <div role="group" aria-label="Aspect ratio" className="flex shrink-0 items-center gap-1">
        {(Object.keys(ASPECTS) as AspectKey[]).map((key) => {
          const on = aspect === key
          const small = key === '1:1'
          return (
            <button
              key={key}
              onClick={() => setAspect(key)}
              aria-pressed={on}
              title={`${ASPECTS[key].label} — ${ASPECTS[key].width}×${ASPECTS[key].height}. Changing this re-solves every clip's reframe. Followed clips keep following their subject. Drag the rectangle in the preview to correct it.`}
              className={`flex items-center gap-1.5 rounded py-1 transition-colors ${
                small ? 'px-1.5 text-[10px]' : 'px-2 text-[11px]'
              } ${
                on
                  ? 'bg-accent-500 text-ink-950'
                  : 'bg-ink-800 text-ink-400 hover:bg-ink-700 hover:text-ink-200'
              }`}
            >
              <span
                aria-hidden
                className="shrink-0 rounded-[1.5px] border-[1.5px] border-current"
                style={GLYPH[key]}
              />
              <span className="font-medium tabular-nums">{key}</span>
              <span className={chip ? WORDS_GO.chip : WORDS_GO.plain}>{ASPECTS[key].label}</span>
            </button>
          )
        })}
      </div>

      {/*
        Beside the shape switch, because its button IS a shape switch. It
        stands until the shapes agree: as a toast it was gone before the reel
        it warned about was built (shared/edit/orientation.ts).
      */}
      {mismatch && (
        <div
          title={`${CHIP[mismatch].text}. ${CHIP[mismatch].why}`}
          className="flex min-w-0 items-center gap-1.5 rounded border border-amber-700/40 bg-amber-500/10 py-0.5 pl-1.5 pr-0.5"
        >
          <AlertTriangle size={12} className="shrink-0 text-amber-800" />
          <span className="truncate text-[11px] text-amber-800">{CHIP[mismatch].text}</span>
          <button
            onClick={() => setAspect(mismatch)}
            className="shrink-0 rounded bg-amber-500 px-2 py-0.5 text-[11px] font-medium text-ink-200 hover:bg-amber-400"
          >
            Switch to {mismatch}
          </button>
        </div>
      )}

      {/*
        The reframe offer: follow the subject in every unfollowed landscape
        video clip (the store's reframeAll — one job per file, each in EXPORT's
        list as "Finding the subject"). It never calls setAspect.
      */}
      {offer !== null && (
        <div
          data-reframe-offer=""
          title={`${offerWords.text} — ${offer} clip${offer === 1 ? '' : 's'}. ${OFFER_WHY}`}
          className="flex min-w-0 items-center gap-1.5 rounded border border-amber-700/40 bg-amber-500/10 py-0.5 pl-1.5 pr-0.5"
        >
          <ScanFace size={12} className="shrink-0 text-amber-800" />
          <span className="truncate text-[11px] text-amber-800">{offerWords.text}</span>
          <button
            onClick={() =>
              void reframeAll().catch((err) => notify(err instanceof Error ? err.message : String(err)))
            }
            disabled={helperWhy !== null || busy}
            title={
              helperWhy !== null
                ? `Following the subject ${helperWhy}`
                : busy
                  ? 'Finding the subject — the analysis is in EXPORT'
                  : 'Find the subject in each landscape clip and follow it. The canvas keeps its shape.'
            }
            className="shrink-0 rounded bg-amber-500 px-2 py-0.5 text-[11px] font-medium text-ink-200 hover:bg-amber-400 disabled:opacity-50 disabled:hover:bg-amber-500"
          >
            {offerWords.button}
          </button>
          {helperWhy !== null && <span className="shrink-0 pr-1 text-[10px] text-amber-800">{helperWhy}</span>}
        </div>
      )}

      <div
        role="group"
        aria-label="Preview"
        title="Drag the divider in the preview to compare; double-click it for an even split."
        className="ml-auto flex shrink-0 items-center gap-1"
      >
        {VIEWS.map(([label, ratio]) => {
          const on = Math.abs(splitRatio - ratio) < 0.02
          return (
            <button
              key={label}
              onClick={() => setSplitRatio(ratio)}
              aria-pressed={on}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${
                on ? 'bg-ink-700 text-ink-200' : 'bg-ink-800 text-ink-400 hover:bg-ink-700'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
