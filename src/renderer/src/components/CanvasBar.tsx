import { type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { orientationMismatch } from '@shared/edit/orientation'
import { ASPECTS, useEditor, type AspectKey } from '../store'

/**
 * The bar above the picture: the canvas's shape, what the preview shows, and
 * a warning when the photos and the canvas disagree (docs/WINDOW.md §3.15).
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

/*
 * When the shape words give way to the chip, by the bar's own width (it is the
 * `@container`, and a container query measures its content box: the bar less
 * its 16 px of padding). Measured in the harness, 2026-10-02: the parts and
 * their gaps need 474 px with the words and no chip, 748 with the words and
 * the landscape chip (the wider one), and 601 with the chip and no words. The
 * content box is 624 at the 1100×680 minimum window, 726 at 1276×706 and 798
 * at 1400×900. The words are also in each button's tooltip, and the glyph
 * draws the shape, so they are the first thing to go — and only when the room
 * needs it: 48rem is 768, 20 px over the 748, and 32rem 38 over the 474, as
 * slack for another platform's font. Narrower than 601 the chip's words
 * truncate, and its tooltip still says them.
 */
const WORDS_GO = { chip: '@max-[48rem]:hidden', plain: '@max-[32rem]:hidden' } as const

export function CanvasBar(): ReactNode {
  const aspect = useEditor((s) => s.aspect)
  const setAspect = useEditor((s) => s.setAspect)
  const splitRatio = useEditor((s) => s.splitRatio)
  const setSplitRatio = useEditor((s) => s.setSplitRatio)
  const assets = useEditor((s) => s.project.assets)
  const settings = useEditor((s) => s.project.settings)
  const mismatch = orientationMismatch(assets, settings)

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
              title={`${ASPECTS[key].label} — ${ASPECTS[key].width}×${ASPECTS[key].height}. Changing this re-solves every clip's reframe. Drag the rectangle in the preview to correct it.`}
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
              <span className={mismatch ? WORDS_GO.chip : WORDS_GO.plain}>{ASPECTS[key].label}</span>
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
