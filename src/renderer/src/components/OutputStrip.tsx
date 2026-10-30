import { useMemo, useState, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import type { TextSpec } from '@shared/timeline'
import { CAPTION_STYLES, resolveStyle, type StyleOverrides } from '@shared/captions/style'
import { REFERENCE_HEIGHT } from '@shared/captions/ass'
import { captionSpec } from '@shared/captions/line'
import { captionRoute } from '@shared/graphics/fromTimeline'
import { LOUDNESS_TARGETS } from '@shared/render/loudness'
import { FRAME_RATES } from '@shared/project/frameRate'
import { outputSummary } from '@shared/project/outputSummary'
import { smartPlacementState } from '@shared/captions/smart'
import { useEditor } from '../store'
import { HelperPointer } from './SettingsPanel'
import { useCatalog } from '../catalog'
import { FontPicker } from './FontPicker'
import { TextStylePicker } from './TextStylePicker'
import { TextAnimationPicker } from './TextAnimationPicker'
import { Slider } from './Slider'
import { Strip } from './ui/Strip'

/**
 * OUTPUT: what the file will be — its frame rate, its loudness, and the
 * burned-in captions (docs/WINDOW.md §3.16; the user's sheet 19 and §7 answer
 * 8: "burned-in captions stay in OUTPUT").
 *
 * A collapsible strip under the left panel. Closed, its header still says what
 * the file will be in one line ("30 fps · -14 LUFS · captions on",
 * shared/project/outputSummary.ts); open, it is the Inspector's Output block,
 * moved here unchanged — the same store reads and writes, the same caption
 * sample, the same caption font picker.
 *
 * The font picker and the style gallery inside it are `fixed inset-0`
 * overlays: nothing between them and the window may carry a transform, a
 * filter or a backdrop-filter (ui/Strip.tsx), or the overlay would be trapped
 * inside the strip.
 */
/** The toggle's words (docs/CLIPS.md §5.4); the census rows match them, so they stay as they are. */
export const SMART_PLACEMENT = 'Smart placement'
export const SMART_PLACEMENT_TIP = 'keeps captions off faces, one position per shot'
export const SMART_PLACEMENT_NO_TRACK = 'reframe a clip first'
export const HELPER_STARTING = 'the AI helper is starting'

/**
 * Smart placement (docs/CLIPS.md §5.4, the user's sheet 13 "dead space"):
 * the captions take, per shot, the third the subject's face is not in.
 *
 * It reads the clips' subject tracks, so it is greyed when there is none and
 * nothing on this machine can make one — "needs the AI helper", a pointer to
 * the one Install in Settings (§3a.4, §16.41), as Follow the subject's is —
 * rather than a switch that changes nothing. With the helper but no track
 * yet it works and says "reframe a clip first": the thirds are the style's
 * until a clip is reframed. While the helper has not answered, it says so.
 * Greyed, it can still be turned OFF, so a project saved with it on is never
 * stuck that way.
 *
 * Its own component, with no state of its own, so a test can call it.
 */
export function SmartPlacementToggle(): ReactNode {
  const project = useEditor((s) => s.project)
  const helper = useEditor((s) => s.helperStatus)
  const setCaptionPlacement = useEditor((s) => s.setCaptionPlacement)
  const state = smartPlacementState(project, helper)
  const on = project.captions.placement === 'smart'
  const greyed = state === 'needs-helper' || state === 'helper-starting'
  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        data-smart-placement=""
        onClick={() => setCaptionPlacement(on ? 'style' : 'smart')}
        disabled={greyed && !on}
        title={state === 'no-track' ? `${SMART_PLACEMENT_TIP} — ${SMART_PLACEMENT_NO_TRACK}` : SMART_PLACEMENT_TIP}
        className="flex w-full items-center justify-between rounded bg-ink-800 px-2 py-1.5 text-[11px] text-ink-300 transition-colors hover:bg-ink-700 hover:text-ink-100 disabled:opacity-40 disabled:hover:bg-ink-800 disabled:hover:text-ink-300"
      >
        <span>{SMART_PLACEMENT}</span>
        <span
          aria-hidden
          className={`relative h-3 w-6 shrink-0 rounded-full transition-colors ${on ? 'bg-accent-500' : 'bg-ink-600'}`}
        >
          <span
            className={`absolute top-0.5 h-2 w-2 rounded-full bg-ink-950 transition-all ${on ? 'left-3.5' : 'left-0.5'}`}
          />
        </span>
      </button>
      {greyed && (
        <p className="mt-0.5 text-[9.5px] leading-snug text-ink-600">
          {/* No helper: a pointer to the one Install, in Settings (§3a.4, §16.41). Starting is said as starting. */}
          {state === 'needs-helper' ? <HelperPointer /> : HELPER_STARTING}
        </p>
      )}
    </div>
  )
}

export function OutputStrip(): ReactNode {
  const project = useEditor((s) => s.project)
  const open = useEditor((s) => s.outputOpen)
  const setOutputOpen = useEditor((s) => s.setOutputOpen)
  const setFrameRate = useEditor((s) => s.setFrameRate)
  const setLoudness = useEditor((s) => s.setLoudness)
  const setCaptionStyle = useEditor((s) => s.setCaptionStyle)
  const setCaptionsEnabled = useEditor((s) => s.setCaptionsEnabled)
  const transcriptCount = Object.keys(project.transcripts).length
  const setCaptionOverride = useEditor((s) => s.setCaptionOverride)
  const clearCaptionOverrides = useEditor((s) => s.clearCaptionOverrides)
  const [pickingFont, setPickingFont] = useState(false)
  const loadedFonts = useCatalog((s) => s.loadedFonts)

  const style = resolveStyle(
    project.captions.styleId,
    project.captions.overrides as StyleOverrides | undefined
  )
  const hasOverrides = Object.keys(project.captions.overrides ?? {}).length > 0
  /*
   * The route the export will take for these captions (`captionRoute`, the
   * one the export and the preview ask), once per edit: a transcript's words
   * are not joined on every render of the strip.
   */
  const captionRouting = useMemo(() => captionRoute(project), [project])
  const fontReady = loadedFonts.has(style.fontFamily)

  /*
   * A caption the style pickers can draw.
   *
   * Both pickers preview a TextSpec, so a caption becomes one — built by the
   * same function the export uses, with a word lit, so what a tile shows is
   * genuinely this style with this highlight rather than an impression of it.
   * Centred and enlarged only because a tile is not a frame: at a caption's real
   * size and position it would be four pixels tall in the corner of the tile.
   *
   * Two short words, and no more. A tile is 38 pixels tall and the picker draws
   * into it at nearly half that in type, so a line long enough to wrap fills the
   * tile edge to edge — measured: "YOUR WORDS HERE" came out clipped top and
   * bottom, and "YOUR WORDS" still touched both. Two words is the minimum that
   * shows a highlight against a base, and short ones stay on one row.
   */
  const captionSample = useMemo<TextSpec>(() => {
    const words = 'GO BIG'.split(' ').map((text, index) => ({
      index,
      text,
      startMs: index * 300,
      endMs: index * 300 + 300,
      confidence: 1
    }))
    return {
      ...captionSpec(style, words, 1),
      position: 'center',
      offsetY: 0,
      size: 0.2
    }
  }, [style])

  return (
    <Strip
      id="output"
      name="OUTPUT"
      open={open}
      onToggle={() => setOutputOpen(!open)}
      showTitle="Show the output settings: frame rate, loudness, captions"
      hideTitle="Hide the output settings"
      summary={outputSummary(project)}
    >
      <div className="space-y-3 p-3">
        {/*
          The project's frame rate, changeable with work in it: frames are the
          model's unit, so every clip is converted by the ratio and no cut
          moves by more than half a frame (shared/project/frameRate.ts).
        */}
        <div>
          <div className="mb-1.5 text-[11px] text-ink-400">Frame rate</div>
          <div className="grid grid-cols-5 gap-1">
            {FRAME_RATES.map((rate) => (
              <button
                key={rate}
                onClick={() => setFrameRate(rate)}
                title={
                  rate === 25 || rate === 50
                    ? `${rate} fps — PAL, what cameras set up for Europe and India shoot`
                    : `${rate} fps`
                }
                className={`rounded px-1 py-1.5 text-[11px] tabular-nums transition-colors ${
                  project.settings.fps === rate
                    ? 'bg-accent-500 text-ink-950'
                    : 'bg-ink-800 text-ink-400 hover:bg-ink-700 hover:text-ink-200'
                }`}
              >
                {rate}
              </button>
            ))}
          </div>
          <div className="mt-1.5 text-[10.5px] leading-snug text-ink-600">
            Match the camera: footage at 25 in a 30 project repeats a frame in every five.
          </div>
        </div>

        {/*
          Loudness sits with the other things that describe the FILE, not with
          the clip's own Sound row. It is a property of the export: every clip,
          every track and the music all measured together after the mix.
        */}
        <div>
          <div className="mb-1.5 text-[11px] text-ink-400">Loudness</div>
          {/*
            Two columns, not four. The panel is narrow enough at its default
            width that four turned "Broadcast" into "Broad" — and a row of
            clipped words is worse than a row half as wide, because the one
            thing a preset button has to do is say what it is.
          */}
          <div className="grid grid-cols-2 gap-1">
            {([['Off', undefined] as const] as readonly (readonly [string, number | undefined])[])
              .concat(LOUDNESS_TARGETS.map((t) => [t.label, t.lufs] as const))
              .map(([label, lufs]) => {
                const active = (project.settings.loudness ?? undefined) === lufs
                return (
                  <button
                    key={label}
                    onClick={() => setLoudness(lufs)}
                    title={
                      lufs === undefined
                        ? 'Export at whatever level the sources happen to be'
                        : `${lufs} LUFS — ${LOUDNESS_TARGETS.find((t) => t.lufs === lufs)?.hint}`
                    }
                    className={`flex items-baseline justify-center gap-1 rounded px-2 py-1.5 text-[11px] transition-colors ${
                      active
                        ? 'bg-accent-500 text-ink-950'
                        : 'bg-ink-800 text-ink-400 hover:bg-ink-700 hover:text-ink-200'
                    }`}
                  >
                    {label}
                    {lufs !== undefined && (
                      <span className={`text-[9px] tabular-nums ${active ? 'text-ink-950' : 'text-ink-600'}`}>
                        {lufs}
                      </span>
                    )}
                  </button>
                )
              })}
          </div>
          <div className="mt-1.5 text-[10.5px] leading-snug text-ink-600">
            {project.settings.loudness === undefined
              ? 'Two exports can land at noticeably different levels.'
              : `Every export measured to ${project.settings.loudness} LUFS, so one is as loud as the next.`}
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] text-ink-400">Captions</span>
            <div className="flex items-center gap-1">
              {/*
                Reset lived inside the Highlight colour row, pushed right with
                ml-auto — so a button that wipes the font, the size, the words
                per line, the style and the animation read as if it belonged to
                the colour beside it.
              */}
              <button
                onClick={clearCaptionOverrides}
                disabled={!hasOverrides}
                className="rounded px-1.5 py-0.5 text-[10px] text-ink-600 hover:bg-ink-800 hover:text-ink-200 disabled:opacity-30"
              >
                Reset edits
              </button>
              <button
                onClick={() => setCaptionsEnabled(!project.captions.enabled)}
                className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                  project.captions.enabled
                    ? 'bg-accent-500 text-ink-950'
                    : 'bg-ink-800 text-ink-400 hover:bg-ink-700'
                }`}
              >
                {project.captions.enabled ? 'On' : 'Off'}
              </button>
            </div>
          </div>

          {/*
            What this is, in one line.

            Captions and text cards share a painter, a style library and an
            animation library, so on screen they can look identical — and the
            panels gave no clue which to reach for. The difference is where the
            words come from and how many there are: captions are spoken words,
            timed automatically, for the whole project; a text card is one line
            you type and place yourself.
          */}
          <p className="mb-1.5 text-[10px] leading-snug text-ink-600">
            Spoken words from the transcript, timed automatically across the whole project.
            To type one line yourself, use <span className="text-ink-400">+ Text</span>.
          </p>
          <div className="grid gap-1">
            {CAPTION_STYLES.map((preset) => (
              <button
                key={preset.id}
                onClick={() => setCaptionStyle(preset.id)}
                disabled={!project.captions.enabled}
                className={`flex items-center justify-between rounded px-2 py-1.5 text-[11px] transition-colors disabled:opacity-40 ${
                  project.captions.styleId === preset.id
                    ? 'bg-ink-700 text-ink-200'
                    : 'bg-ink-800 text-ink-400 hover:bg-ink-700'
                }`}
              >
                <span className="flex items-center gap-1">
                  {preset.label}
                  {preset.animated && (
                    <Sparkles
                      size={9}
                      className="text-accent-400"
                    />
                  )}
                </span>
                <span className="text-[10px] text-ink-600">{preset.fontFamily}</span>
              </button>
            ))}
          </div>
          {project.captions.enabled && (
            <div className="mt-1.5">
              {/*
                The same two libraries the text clips use.

                Captions were the one place that could not reach them, which is
                backwards: a caption is the most-seen type in a short video, and
                the looks the reference packs are built from are all here. A
                style or an animation moves the captions onto the drawn path —
                libass can burn in a flat caption for free, but it has no
                gradient, no glow and no per-word easing to give.
              */}
              <TextStylePicker
                spec={captionSample}
                onPick={(id) => setCaptionOverride('textStyleId', id)}
              />
              <div className="mt-1.5">
                <TextAnimationPicker
                  spec={captionSample}
                  onPick={(id) => setCaptionOverride('animationId', id)}
                />
              </div>

              <button
                onClick={() => setPickingFont((v) => !v)}
                className="mt-1.5 flex w-full items-center justify-between rounded bg-ink-800 px-2 py-1.5 text-[11px] text-ink-400 hover:bg-ink-700 hover:text-ink-200"
              >
                <span>Font</span>
                <span
                  className="max-w-[60%] truncate text-ink-200"
                  style={fontReady ? { fontFamily: `"${style.fontFamily}", sans-serif` } : undefined}
                >
                  {style.fontFamily}
                </span>
              </button>

              {pickingFont && (
                // A full-height overlay rather than an inline box: 81 families in
                // a 224px scroller reads as "there are only four fonts".
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-10">
                  <div
                    className="flex h-full max-h-[680px] w-full max-w-md flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <FontPicker
                      value={style.fontFamily}
                      onChange={(family) => {
                        setCaptionOverride('fontFamily', family)
                        setPickingFont(false)
                      }}
                      onClose={() => setPickingFont(false)}
                    />
                  </div>
                </div>
              )}

              {/*
                The same control, in the same units, as the text card's.

                This was a hand-rolled range in POINTS against a 1080-tall
                reference while the text card's Size was the shared Slider in
                PER CENT — two sliders with the same label, different widgets
                and different numbers for the same idea. Captions are authored
                against the reference frame, so the conversion happens here and
                the panel reads the way its neighbour does.
              */}
              <div className="mt-1.5 space-y-1.5">
                <Slider
                  label="Size"
                  value={Math.round((style.fontSize / REFERENCE_HEIGHT) * 100)}
                  min={2}
                  max={30}
                  suffix="%"
                  onChange={(v) =>
                    setCaptionOverride('fontSize', Math.round((v / 100) * REFERENCE_HEIGHT))
                  }
                />
                <Slider
                  label="Words"
                  value={style.wordsPerLine}
                  min={1}
                  max={8}
                  suffix=""
                  onChange={(v) => setCaptionOverride('wordsPerLine', v)}
                />

                {/*
                  Position, which captions always supported and never exposed.

                  `CaptionStyle.position` and `marginV` were both honoured all
                  the way through resolve, layout and render — there was simply
                  no control, so the only way to move a caption was to give up
                  and use a text card instead. That is a large part of why text
                  cards looked like the better captions.
                */}
                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-[10.5px] text-ink-400">Place</span>
                  <div className="grid flex-1 grid-cols-3 gap-1">
                    {(['top', 'center', 'bottom'] as const).map((place) => (
                      <button
                        key={place}
                        onClick={() => setCaptionOverride('position', place)}
                        className={`rounded px-1.5 py-1 text-[10px] capitalize transition-colors ${
                          style.position === place
                            ? 'bg-accent-500 text-ink-950'
                            : 'bg-ink-800 text-ink-300 hover:bg-ink-700 hover:text-ink-100'
                        }`}
                      >
                        {place === 'center' ? 'Middle' : place}
                      </button>
                    ))}
                  </div>
                </div>

                {style.position !== 'center' && (
                  <Slider
                    label="Margin"
                    value={Math.round((style.marginV / REFERENCE_HEIGHT) * 100)}
                    min={0}
                    max={40}
                    suffix="%"
                    onChange={(v) =>
                      setCaptionOverride('marginV', Math.round((v / 100) * REFERENCE_HEIGHT))
                    }
                  />
                )}

                <SmartPlacementToggle />

                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-[10.5px] text-ink-400">Colour</span>
                  <input
                    type="color"
                    value={style.primaryColor}
                    onChange={(e) => setCaptionOverride('primaryColor', e.target.value)}
                    title="The words"
                    className="h-5 w-8 shrink-0 cursor-pointer rounded border border-ink-700 bg-transparent"
                  />
                  <input
                    type="color"
                    value={style.highlightColor}
                    onChange={(e) => setCaptionOverride('highlightColor', e.target.value)}
                    title="The word being spoken"
                    className="h-5 w-8 shrink-0 cursor-pointer rounded border border-ink-700 bg-transparent"
                  />
                  <span className="text-[10px] text-ink-600">words · spoken</span>
                </div>
              </div>
            </div>
          )}

          {captionRouting.route === 'canvas' && project.captions.enabled && (
            <div className="mt-1.5 rounded border border-accent-500/40 bg-accent-500/10 px-2 py-1.5">
              <div className="text-[10.5px] leading-snug text-accent-300">
                {/*
                  Which path these captions take, said plainly and accurately.

                  This used to warn that the export ran a second pass, which it
                  did — and which cost about five times the render. It does not
                  any more: the captions are drawn to a few pictures first and
                  composited by the ordinary graph.

                  It shows for a plain style on a Hindi or Telugu track too
                  (docs/CLIPS.md §16.66 (a)), so the cost is against burning
                  them in, not against a plain style, and the third sentence
                  says why such a track is drawn.
                */}
                These captions are drawn rather than burned in. They are painted once
                before the export and composited in the same pass, so it costs a little
                more than burning them in — not a second render.
                {captionRouting.indic &&
                  ' Their letters join, which burned-in captions cannot do on Windows, so they are drawn on every computer.'}
              </div>
            </div>
          )}

          {transcriptCount === 0 && project.captions.enabled && (
            <div className="mt-1.5 text-[10.5px] leading-snug text-ink-600">
              Nothing transcribed yet — captions will be skipped on export.
            </div>
          )}
        </div>
      </div>
    </Strip>
  )
}
