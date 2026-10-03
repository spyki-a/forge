import { useMemo as useMemoLocal, useState as useLocalState, type ReactNode } from 'react'
import {
  NEUTRAL_COLOR_PATCH,
  clipEnd,
  formatTimecode,
  isNeutralGrade
} from '@shared/timeline'
import { useEditor } from '../store'
import { FontPicker } from './FontPicker'
import { useCatalog } from '../catalog'
import { transitionsByFamily } from '../catalog'
import { availableTags, transitionsWithTag } from '@shared/transitions/registry'
import { TAG_LABELS, type MaskTag } from '@shared/transitions/classify'
import { TEXT_PRESETS, matchingPreset } from '@shared/render/textPresets'
import { SANDWICH_RULE } from '@shared/automation/sandwich'
import { maxTransitionFrames, transitionBase } from '@shared/timeline'
import { LayoutPanel } from './LayoutPanel'
import { MaskPanel } from './MaskPanel'
import { KeyPanel } from './KeyPanel'
import { CameraPanel } from './CameraPanel'
import { SteadyToggle } from './SteadyToggle'
import { canSteady } from '@shared/render/steady'
import { canMoveCamera } from '@shared/edit/camera'
import { isKeyable } from '@shared/render/chromaKey'
import { CarouselPanel } from './CarouselPanel'
import { PaperPanel } from './PaperPanel'
import { SpeedPanel } from './SpeedPanel'
import { TextStylePicker } from './TextStylePicker'
import { TextAnimationPicker } from './TextAnimationPicker'
import { Slider } from './Slider'
import { faderPosition, formatDb, gainAtPosition } from '@shared/render/audibility'

function Field({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className="text-[11px] text-ink-400">{label}</span>
      <span className="font-mono text-[11px] tabular-nums text-ink-200">{value}</span>
    </div>
  )
}

export function Inspector(): ReactNode {
  const project = useEditor((s) => s.project)
  const selectedClipId = useEditor((s) => s.selectedClipId)
  const setTransform = useEditor((s) => s.setTransform)
  const setColor = useEditor((s) => s.setColor)
  const setClipVolume = useEditor((s) => s.setClipVolume)
  const crossfadeWithPrevious = useEditor((s) => s.crossfadeWithPrevious)
  const chooseLut = useEditor((s) => s.chooseLut)
  const setTrayOpen = useEditor((s) => s.setTrayOpen)
  const setTrayTab = useEditor((s) => s.setTrayTab)
  const putBehindSubject = useEditor((s) => s.putBehindSubject)
  const fillWithClipBelow = useEditor((s) => s.fillWithClipBelow)
  const releaseMatte = useEditor((s) => s.releaseMatte)
  const removeSandwich = useEditor((s) => s.removeSandwich)
  const setText = useEditor((s) => s.setText)
  const setSolid = useEditor((s) => s.setSolid)
  const setClipDuration = useEditor((s) => s.setClipDuration)
  const [pickingTextFont, setPickingTextFont] = useLocalState(false)
  /**
   * The looks that ship with the app, written to disk on first use — asked for
   * once by the app shell (App.tsx), not by this panel, which will not always
   * be on screen.
   */
  const looks = useCatalog((s) => s.looks)
  /*
   * The "check graphics engine" button used to live here.
   *
   * It probed whether the offscreen browser's `capturePage()` returned real
   * alpha, because styled captions depended on that. They no longer go near it —
   * they are painted on a canvas in this window — so the button was testing a
   * subsystem the feature beside it had stopped using. `graphicsSelfTest` is
   * still there on the API for whenever something needs the frame server again.
   */
  const setTransition = useEditor((s) => s.setTransition)
  const clearTransition = useEditor((s) => s.clearTransition)
  const setTitleText = useEditor((s) => s.setTitleText)
  const allTransitions = useCatalog((s) => s.transitions)
  const transitionsError = useCatalog((s) => s.transitionsError)
  const families = useMemoLocal(() => transitionsByFamily(allTransitions), [allTransitions])
  const tags = useMemoLocal(() => availableTags(allTransitions), [allTransitions])
  const [tagFilter, setTagFilter] = useLocalState<MaskTag | null>(null)

  // The transition table, the catalog and the looks are loaded by the app
  // shell (App.tsx); this panel only reads them.

  const clip = project.clips.find((c) => c.id === selectedClipId) ?? null
  /*
   * What a transition would blend in from: the clip before it on the same track,
   * or the layer underneath it. The panel used to require the former, so a
   * photograph dropped on V2 over another one — the whole grid-reveal edit —
   * had no transition UI at all.
   */
  const base = clip ? transitionBase(project, clip) : null
  const previousClip = base?.kind === 'cut' ? base.clip : null
  const asset = clip ? project.assets.find((a) => a.id === clip.assetId) ?? null : null
  const fps = project.settings.fps

  return (
    <div className="flex h-full flex-col">
      {/*
        The panel body scrolls.

        Without this the column simply overflowed its height and everything past
        the fold was off-screen and could not be reached.

        Frame rate, loudness, captions and the export are not here any more: they
        are the OUTPUT and EXPORT strips under the left panel (OutputStrip.tsx,
        ExportStrip.tsx, WINDOW.md §3.16-3.17), and the export flow and the
        File › Export listener went with them.
      */}
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-ink-800 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-ink-400">
        Clip
      </div>
      <div className="px-3 py-2">
        {clip && asset ? (
          <>
            <div className="mb-1 truncate text-[12px] text-ink-200">{asset.name}</div>
            <Field label="Start" value={formatTimecode(clip.start, fps)} />
            <Field label="End" value={formatTimecode(clipEnd(clip), fps)} />
            {/* Editable, not just reported: how long a title holds is the most
                common thing to change about one. */}
            <div className="flex items-center gap-2 py-1">
              <span className="w-14 shrink-0 text-[11px] text-ink-400">Duration</span>
              <input
                type="range"
                min={Math.max(1, Math.round(fps * 0.2))}
                max={Math.round(fps * 15)}
                step={1}
                value={clip.duration}
                onChange={(e) => setClipDuration(clip.id, Number(e.target.value))}
                className="min-w-0 flex-1"
              />
              <span className="w-14 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-ink-200">
                {(clip.duration / fps).toFixed(1)}s
              </span>
            </div>
            <Field label="Source in" value={formatTimecode(clip.inPoint, fps)} />
            {clip.crop && (
              <Field label="Reframe" value={`${clip.crop.width}×${clip.crop.height} @ ${clip.crop.x},${clip.crop.y}`} />
            )}

            {/*
              Size, position and opacity.

              These were on every clip from the start and drawn by nothing, so a
              prop landed at full frame with no way to shrink it. 100% means the
              clip fills the frame, which is what every existing clip already does.
            */}
            <div className="mt-2 space-y-1.5 border-t border-ink-850 pt-2">
              <Slider
                label="Size"
                value={Math.round((clip.transform?.scale ?? 1) * 100)}
                min={5}
                max={200}
                suffix="%"
                onChange={(v) => setTransform(clip.id, { scale: v / 100 })}
              />
              <Slider
                label="Opacity"
                value={Math.round((clip.transform?.opacity ?? 1) * 100)}
                min={0}
                max={100}
                suffix="%"
                onChange={(v) => setTransform(clip.id, { opacity: v / 100 })}
              />
              <Slider
                label="X"
                value={Math.round((clip.transform?.x ?? 0) * 100)}
                min={-100}
                max={100}
                suffix=""
                onChange={(v) => setTransform(clip.id, { x: v / 100 })}
              />
              <Slider
                label="Y"
                value={Math.round((clip.transform?.y ?? 0) * 100)}
                min={-100}
                max={100}
                suffix=""
                onChange={(v) => setTransform(clip.id, { y: v / 100 })}
              />
              <Slider
                label="Rotate"
                value={Math.round(clip.transform?.rotation ?? 0)}
                min={-180}
                max={180}
                suffix="°"
                onChange={(v) => setTransform(clip.id, { rotation: v })}
              />

              {/*
                Colour.

                The three sliders are ffmpeg's `eq` parameters directly, so what
                is on screen and what is exported run the same numbers. The LUT
                goes on top of them, which is the order Resolve and CapCut both
                use: correct the picture, then put the look on it.
              */}
              {/* Speed belongs next to duration: it is the other way to change one. */}
              <SpeedPanel clip={clip} asset={asset} />

              {/* Footage's steadiness, under its speed. */}
              {canSteady(clip, asset ?? undefined) && <SteadyToggle clip={clip} />}

              {/* A photo's camera move — where Speed would be, which a still has none of. */}
              {canMoveCamera(clip, asset ?? undefined) && <CameraPanel clip={clip} />}

              {/* A run of clippings, for the clips that are one. */}
              {clip.paper && <PaperPanel clip={clip} />}

              {/* A ring of photographs, for the clips that are one. */}
              {clip.carousel && <CarouselPanel clip={clip} />}

              {/*
                Sound, for anything that has some.

                The render has always honoured `clip.volume` and nothing could
                set it, so every clip played its source at full volume with no
                way to say otherwise. Clip stickers made that unbearable: they
                carry loud speech and land muted, and without this there would
                be no way to hear them at all.
              */}
              {asset?.hasAudio && (
                <div className="space-y-1.5 border-t border-ink-850 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] text-ink-400">Sound</span>
                    <button
                      onClick={() => setClipVolume(clip.id, (clip.volume ?? 1) > 0 ? 0 : 1)}
                      title={(clip.volume ?? 1) > 0 ? 'Mute this clip' : 'Unmute this clip'}
                      className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                        (clip.volume ?? 1) > 0
                          ? 'bg-ink-800 text-ink-400 hover:bg-ink-700 hover:text-ink-200'
                          : 'bg-accent-500 font-medium text-ink-950 hover:bg-accent-400'
                      }`}
                    >
                      {(clip.volume ?? 1) > 0 ? 'Mute' : 'Muted'}
                    </button>
                  </div>
                  {/*
                    A fader, read in dB and moving in a dB curve — to +6 dB,
                    because quiet footage is the commonest audio problem there
                    is and a fader that stopped at 100 % had no answer for it.
                    The position is `faderPosition` x 1000; the same curve the
                    envelope on the clip is drawn in.
                  */}
                  <Slider
                    label="Level"
                    value={Math.round(faderPosition(clip.volume ?? 1) * 1000)}
                    min={0}
                    max={1000}
                    suffix=""
                    display={formatDb(clip.volume ?? 1)}
                    onChange={(v) => setClipVolume(clip.id, gainAtPosition(v / 1000))}
                  />
                  {/*
                    A drawn envelope REPLACES this fader, in the export and now
                    the preview too (audibility.ts clipLevelAt). That was true of
                    the export all along and nothing said so — a fader that moved
                    and changed nothing, with no hint why.
                  */}
                  {(clip.keyframes?.volume?.length ?? 0) > 0 && (
                    <div className="mt-0.5 text-[10px] leading-snug text-amber-800">
                      The drawn envelope sets this clip's level — clear it to use the fader.
                    </div>
                  )}

                  {/*
                    Crossfade needs a button because it cannot be a drag.

                    Every other fade control is on the clip, which is where
                    they belong — but this one has to CREATE the overlap it
                    fades across, and the drag that would do it is already
                    taken: dragging a clip onto its neighbour sequences it
                    clear, and that behaviour is load-bearing for stacked
                    layers like grids and filmstrips. So the button makes the
                    overlap, and the grips on the clip shape it afterwards.
                  */}
                  <button
                    onClick={() => crossfadeWithPrevious(clip.id)}
                    title="Overlap this clip with the one before it on its track and cross the sound over"
                    className="w-full rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-300 transition-colors hover:bg-ink-700 hover:text-ink-100"
                  >
                    Crossfade with the clip before
                  </button>
                </div>
              )}

              {/*
               * The mask sits above the colour controls on purpose: in grade
               * mode those sliders apply only inside the shape, and reading
               * "colour only inside" after moving them is the wrong order.
               */}
              <MaskPanel clip={clip} />

              {/* Keyed before it is graded, so the key sits above the colour. */}
              {isKeyable(clip, asset ?? undefined) && <KeyPanel clip={clip} />}

              <div className="space-y-1.5 border-t border-ink-850 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] text-ink-400">
                    Colour
                    {clip.mask?.mode === 'grade' && (
                      <span className="ml-1 text-accent-400">· inside the mask only</span>
                    )}
                  </span>
                  {!isNeutralGrade(clip.color) && (
                    <button
                      onClick={() => setColor(clip.id, NEUTRAL_COLOR_PATCH)}
                      className="rounded px-1.5 py-0.5 text-[10px] text-ink-600 hover:bg-ink-800 hover:text-ink-200"
                    >
                      Reset
                    </button>
                  )}
                </div>
                {/*
                  White balance first, as it is applied: correct the light,
                  then grade. Warm fixes a blue cloudy ceremony; cool fixes an
                  orange tungsten reception (render/whiteBalance.ts).
                */}
                <Slider
                  label="Temp"
                  value={Math.round((clip.color?.temperature ?? 0) * 100)}
                  min={-100}
                  max={100}
                  suffix=""
                  onChange={(v) => setColor(clip.id, { temperature: v / 100 })}
                />
                <Slider
                  label="Tint"
                  value={Math.round((clip.color?.tint ?? 0) * 100)}
                  min={-100}
                  max={100}
                  suffix=""
                  onChange={(v) => setColor(clip.id, { tint: v / 100 })}
                />
                <Slider
                  label="Bright"
                  value={Math.round((clip.color?.brightness ?? 0) * 100)}
                  min={-100}
                  max={100}
                  suffix=""
                  onChange={(v) => setColor(clip.id, { brightness: v / 100 })}
                />
                <Slider
                  label="Contrast"
                  value={Math.round((clip.color?.contrast ?? 1) * 100)}
                  min={0}
                  max={300}
                  suffix="%"
                  onChange={(v) => setColor(clip.id, { contrast: v / 100 })}
                />
                <Slider
                  label="Saturate"
                  value={Math.round((clip.color?.saturation ?? 1) * 100)}
                  min={0}
                  max={300}
                  suffix="%"
                  onChange={(v) => setColor(clip.id, { saturation: v / 100 })}
                />

                {clip.color?.lut ? (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[10.5px] text-accent-400" title={clip.color.lut.file}>
                        {clip.color.lut.name ?? 'LUT'}
                      </span>
                      <button
                        onClick={() => setColor(clip.id, { lut: undefined })}
                        title="Remove this look"
                        className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] text-ink-600 hover:bg-ink-800 hover:text-ink-200"
                      >
                        Remove
                      </button>
                    </div>
                    <Slider
                      label="Intensity"
                      value={Math.round(clip.color.lut.intensity * 100)}
                      min={0}
                      max={100}
                      suffix="%"
                      onChange={(v) =>
                        setColor(clip.id, { lut: { ...clip.color!.lut!, intensity: v / 100 } })
                      }
                    />
                  </>
                ) : (
                  <div className="space-y-1">
                    <div className="text-[10px] text-ink-500">Looks</div>
                    <div className="grid grid-cols-2 gap-1">
                      {looks.map((look) => (
                        <button
                          key={look.id}
                          onClick={() =>
                            setColor(clip.id, {
                              lut: { file: look.file, name: look.name, intensity: 0.8 }
                            })
                          }
                          title={look.description}
                          className="truncate rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-300 hover:bg-ink-700 hover:text-ink-100"
                        >
                          {look.name}
                        </button>
                      ))}
                    </div>
                    {/*
                      Still offered, because a photographer who already owns
                      LUTs should not have to use ours — but no longer the only
                      way in, which made the panel unusable to everyone else.
                    */}
                    <button
                      onClick={() => void chooseLut(clip.id)}
                      title="Load a .cube LUT you already own, as exported by any grading tool"
                      className="w-full rounded px-2 py-1 text-[10px] text-ink-600 hover:bg-ink-800 hover:text-ink-300"
                    >
                      or load your own .cube…
                    </button>
                  </div>
                )}
              </div>
              {clip.text && (
                <div className="space-y-1.5 border-t border-ink-850 pt-2">
                  {/* The other half of the pair — see the note in the Captions
                      block. These two share a painter and a style library, so
                      the only thing that distinguishes them is said out loud. */}
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-ink-400">Text card</span>
                    <span className="text-[10px] text-ink-600">one line, placed by you</span>
                  </div>
                  <textarea
                    value={clip.text.content}
                    onChange={(e) => void setText(clip.id, { content: e.target.value })}
                    rows={2}
                    placeholder="Type your text"
                    className="w-full resize-none rounded bg-ink-800 px-2 py-1.5 text-[11px] text-ink-200 outline-none placeholder:text-ink-600"
                  />

                  {/*
                    Looks, before sliders.

                    Ten sliders with no starting point is the slowest way to a
                    decent title: each one is a decision and most only read well
                    in combination. A preset is that combination, already made.
                  */}
                  <div className="grid grid-cols-3 gap-1">
                    {TEXT_PRESETS.map((preset) => {
                      const on = matchingPreset(clip.text!)?.id === preset.id
                      return (
                        <button
                          key={preset.id}
                          onClick={() => void setText(clip.id, preset.spec)}
                          title={preset.description}
                          className={`truncate rounded px-1.5 py-1 text-[10px] transition-colors ${
                            on
                              ? 'bg-accent-500 text-ink-950'
                              : 'bg-ink-800 text-ink-300 hover:bg-ink-700 hover:text-ink-100'
                          }`}
                        >
                          {preset.name}
                        </button>
                      )
                    })}
                  </div>

                  {/*
                    The style library, under the layout presets.

                    The presets above set the TYPOGRAPHY — size, weight,
                    tracking, where it sits. These set the LOOK — the fill, the
                    glow, the outline. Two axes, deliberately: any style works
                    with any preset and with any font, which is what keeps two
                    dozen recipes from having to become hundreds of variants.
                  */}
                  <TextStylePicker
                    spec={clip.text}
                    onPick={(styleId) => void setText(clip.id, { styleId })}
                  />

                  {/*
                    How the words arrive — the third axis.

                    Preset, style and animation are independent on purpose: the
                    preset says how the type is set, the style how it is painted,
                    and this how it moves. Any combination works, so nine
                    animations multiply the library rather than adding to it.
                  */}
                  <TextAnimationPicker
                    spec={clip.text}
                    onPick={(animationId) => void setText(clip.id, { animationId })}
                  />

                  {/*
                    The catalogue's fonts, on text cards.

                    They were only ever wired to captions, so a text card was
                    stuck on whatever the rasteriser happened to use.
                  */}
                  <button
                    onClick={() => setPickingTextFont(true)}
                    className="flex w-full items-center justify-between rounded bg-ink-800 px-2 py-1 text-[10.5px] text-ink-200 hover:bg-ink-700"
                  >
                    <span className="truncate" style={{ fontFamily: clip.text.font }}>
                      {clip.text.font}
                    </span>
                    <span className="shrink-0 text-[10px] text-ink-500">Change</span>
                  </button>

                  {pickingTextFont && (
                    // m-0: this sits in a space-y-1.5 column, whose margin reaches
                    // a fixed child too and left the window's bottom 6px uncovered.
                    <div className="fixed inset-0 z-50 m-0 flex items-center justify-center bg-ink-950/70 p-10">
                      <div
                        className="flex h-full max-h-[680px] w-full max-w-md flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <FontPicker
                          value={clip.text.font}
                          onChange={(family) => {
                            void setText(clip.id, { font: family })
                            setPickingTextFont(false)
                          }}
                          onClose={() => setPickingTextFont(false)}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex gap-1">
                    {(['top', 'center', 'lower'] as const).map((where) => (
                      <button
                        key={where}
                        onClick={() => void setText(clip.id, { position: where })}
                        title={where === 'lower' ? 'Lower third' : where}
                        className={`flex-1 rounded px-1.5 py-0.5 text-[10px] capitalize ${
                          clip.text!.position === where
                            ? 'bg-ink-700 text-ink-200'
                            : 'bg-ink-800 text-ink-500 hover:bg-ink-700'
                        }`}
                      >
                        {where === 'lower' ? 'Lower 3rd' : where}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    {(['left', 'center', 'right'] as const).map((where) => (
                      <button
                        key={where}
                        onClick={() => void setText(clip.id, { align: where })}
                        className={`flex-1 rounded px-1.5 py-0.5 text-[10px] capitalize ${
                          clip.text!.align === where
                            ? 'bg-ink-700 text-ink-200'
                            : 'bg-ink-800 text-ink-500 hover:bg-ink-700'
                        }`}
                      >
                        {where}
                      </button>
                    ))}
                  </div>
                  <Slider
                    label="Size"
                    value={Math.round(clip.text.size * 100)}
                    min={2}
                    max={30}
                    suffix="%"
                    onChange={(v) => void setText(clip.id, { size: v / 100 })}
                  />
                  {/* Tracking is the single biggest lever on whether type reads
                      as a film title or a caption. */}
                  <Slider
                    label="Tracking"
                    value={Math.round(clip.text.tracking * 100)}
                    min={-10}
                    max={50}
                    suffix=""
                    onChange={(v) => void setText(clip.id, { tracking: v / 100 })}
                  />
                  <Slider
                    label="Weight"
                    value={clip.text.weight}
                    min={100}
                    max={900}
                    suffix=""
                    onChange={(v) => void setText(clip.id, { weight: Math.round(v / 100) * 100 })}
                  />
                  <Slider
                    label="Shadow"
                    value={Math.round(clip.text.shadow * 100)}
                    min={0}
                    max={100}
                    suffix="%"
                    onChange={(v) => void setText(clip.id, { shadow: v / 100 })}
                  />
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-[10.5px] text-ink-400">Colour</span>
                    <input
                      type="color"
                      value={clip.text.color}
                      onChange={(e) => void setText(clip.id, { color: e.target.value })}
                      className="h-6 w-10 cursor-pointer rounded border border-ink-700 bg-ink-800"
                    />
                    <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-ink-400">
                      <input
                        type="checkbox"
                        checked={clip.text.uppercase}
                        onChange={(e) => void setText(clip.id, { uppercase: e.target.checked })}
                        className="accent-accent-500"
                      />
                      CAPS
                    </label>
                  </div>

                  {/*
                    Outline.

                    `stroke` and `strokeColor` have been in the spec and drawn by
                    both the SVG and the canvas from the start, and reachable
                    from nowhere — which is most of what "the text options are
                    very limited" meant. An outline is what makes type survive a
                    busy frame.
                  */}
                  <Slider
                    label="Outline"
                    value={Math.round((clip.text.stroke ?? 0) * 100)}
                    min={0}
                    max={20}
                    suffix="%"
                    onChange={(v) => void setText(clip.id, { stroke: v / 100 })}
                  />
                  {(clip.text.stroke ?? 0) > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="w-14 shrink-0 text-[10.5px] text-ink-400">Edge</span>
                      <input
                        type="color"
                        value={clip.text.strokeColor}
                        onChange={(e) => void setText(clip.id, { strokeColor: e.target.value })}
                        className="h-6 w-10 cursor-pointer rounded border border-ink-700 bg-ink-800"
                      />
                      <span className="font-mono text-[10px] text-ink-600">
                        {clip.text.strokeColor}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {clip.solid && (
                <div className="space-y-1.5 border-t border-ink-850 pt-2">
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-[10.5px] text-ink-400">Colour</span>
                    <input
                      type="color"
                      value={clip.solid.color}
                      onChange={(e) => void setSolid(clip.id, { color: e.target.value })}
                      className="h-6 w-10 cursor-pointer rounded border border-ink-700 bg-ink-800"
                    />
                    <span className="font-mono text-[10px] text-ink-600">{clip.solid.color}</span>
                  </div>
                  <Slider
                    label="Opacity"
                    value={Math.round(clip.solid.opacity * 100)}
                    min={0}
                    max={100}
                    suffix="%"
                    onChange={(v) => void setSolid(clip.id, { opacity: v / 100 })}
                  />
                </div>
              )}

              {/*
                Text behind the subject.

                Offered on any clip, because the useful case is a title but a
                sticker or prop behind someone is the same operation.
              */}
              {/*
                Text as a window onto the picture below — the trailer look.

                Offered on any clip, because a sticker or a shape cut out of
                footage is the same operation as a word cut out of it.
              */}
              {clip.matteOnly ? (
                <button
                  onClick={() => releaseMatte(clip.id)}
                  className="w-full rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-400 hover:bg-ink-700 hover:text-ink-200"
                >
                  The picture below shows through this — put it back
                </button>
              ) : (
                <button
                  onClick={() => fillWithClipBelow(clip.id)}
                  title="The clip on the track below is shown only inside this shape"
                  className="w-full rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-300 hover:bg-ink-700 hover:text-ink-100"
                >
                  Fill with the picture below
                </button>
              )}

              {clip.generatedBy?.rule === SANDWICH_RULE ? (
                <button
                  onClick={() => removeSandwich(clip.id)}
                  className="w-full rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-400 hover:bg-ink-700 hover:text-ink-200"
                >
                  This is a subject cutout — put the photo back together
                </button>
              ) : (
                <button
                  onClick={() => putBehindSubject(clip.id)}
                  title="Splits the photo beneath into background and subject, with this clip between"
                  className="w-full rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-300 hover:bg-ink-700 hover:text-ink-100"
                >
                  Put behind the subject
                </button>
              )}

              {/*
                Split screen and picture in picture.

                Both are layouts, not modes: each one writes a box into the
                clip's transform and nothing else. That is why they sit beside
                the matte and the sandwich rather than in a panel of their own —
                same family, same escape hatch, which is to drag the clip back.
              */}
              <LayoutPanel clip={clip} />

              {/*
                Keys and the motion path live in the Curve tray beside the
                timeline (CurveTray.tsx, WINDOW.md §3.19), which stays closed
                until someone opens it. So the way there from the clip is here,
                one click, and opens it on Keys.
              */}
              <div className="flex items-center gap-2 border-t border-ink-850 pt-2">
                <span className="min-w-0 flex-1 text-[10.5px] leading-snug text-ink-500">
                  Keys and curves are in the tray beside the timeline
                </span>
                <button
                  onClick={() => {
                    setTrayTab('keys')
                    setTrayOpen(true)
                  }}
                  title="Open the tray beside the timeline on Keys: this clip's keyframes and motion path"
                  className="shrink-0 rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-300 hover:bg-ink-700 hover:text-ink-100"
                >
                  Open keys
                </button>
              </div>

              {(clip.transform?.scale !== 1 ||
                clip.transform?.opacity !== 1 ||
                clip.transform?.x !== 0 ||
                clip.transform?.y !== 0 ||
                clip.transform?.rotation !== 0) && (
                <button
                  onClick={() =>
                    setTransform(clip.id, { scale: 1, opacity: 1, x: 0, y: 0, rotation: 0 })
                  }
                  className="w-full rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-400 hover:bg-ink-700 hover:text-ink-200"
                >
                  Reset to full frame
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="py-2 text-[11px] text-ink-600">No clip selected</div>
        )}
      </div>

      {clip?.title && (
        <>
          <div className="border-y border-ink-800 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-ink-400">
            Title text
          </div>
          <div className="space-y-1.5 px-3 py-2">
            {clip.title.texts.map((text, index) => (
              <input
                key={index}
                value={text}
                onChange={(e) => void setTitleText(clip.id, index, e.target.value)}
                placeholder={`Line ${index + 1}`}
                className="w-full rounded bg-ink-800 px-2 py-1.5 text-[11.5px] text-ink-200 outline-none placeholder:text-ink-600 focus:bg-ink-700"
              />
            ))}
            <div className="text-[10.5px] leading-snug text-ink-600">
              The template keeps its own typography — editing the copy re-renders it.
            </div>
          </div>
        </>
      )}

      <div className="border-y border-ink-800 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-ink-400">
        Transition in
      </div>
      {!clip && (
        <div className="px-3 py-2 text-[11px] text-ink-600">Select a clip</div>
      )}
      {clip && (
        <>
          {/*
            What the transition blends in FROM, said plainly.

            None of these is an error — blending in from black on the first clip
            is a fade-in, and one of the commonest edits there is. This used to
            hide the whole panel in that case.
          */}
          <div className="px-3 pt-2 text-[10px] leading-snug text-ink-500">
            {!base
              ? 'Nothing is underneath, so this blends in from black — a fade-in.'
              : base.kind === 'layer'
                ? 'Revealing over the layer below. A grid mask brings this clip in square by square, showing the one underneath through the gaps.'
                : 'Blending in from the clip before it.'}
          </div>
          <div className="space-y-1.5 px-3 py-2">
            {/*
              How many there are, and why there are not more.

              The library is 400-odd mask wipes on top of eight built-ins, and
              when it failed to load the picker quietly showed the eight — four
              families instead of seven, with nothing anywhere saying so.
              Reported as the transitions having disappeared, which is exactly
              what it looks like from the outside.
            */}
            <div className="flex items-baseline justify-between text-[10px] text-ink-600">
              <span>
                {allTransitions.length} transition{allTransitions.length === 1 ? '' : 's'}
              </span>
              {transitionsError && (
                <span className="truncate pl-2 text-accent-400" title={transitionsError}>
                  library did not load
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => clearTransition(clip.id)}
                className={`rounded px-2 py-1.5 text-[11px] transition-colors ${
                  !clip.transitionIn
                    ? 'bg-ink-700 text-ink-200'
                    : 'bg-ink-800 text-ink-400 hover:bg-ink-700'
                }`}
              >
                Cut
              </button>
              {families.map(({ family, members }) => {
                const active = members.some((m) => m.id === clip.transitionIn?.id)
                return (
                  <button
                    key={family}
                    onClick={() => setTransition(clip.id, members[0].id)}
                    title={`${members.length} in this family`}
                    className={`flex items-center justify-between rounded px-2 py-1.5 text-[11px] capitalize transition-colors ${
                      active ? 'bg-accent-500 text-ink-950' : 'bg-ink-800 text-ink-400 hover:bg-ink-700'
                    }`}
                  >
                    <span>{family}</span>
                    <span className={active ? 'text-ink-950' : 'text-ink-600'}>
                      {members.length}
                    </span>
                  </button>
                )
              })}
            </div>

            {/*
              Filter by what a mask DOES, not what it is called.

              The library has 120 grid reveals and 122 blinds, and until they
              were measured the only way to find one was to already know it was
              called `luminous_boxes_17`. Tags come from the mask's own pixels.
            */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => {
                  const members = transitionsWithTag(allTransitions, tag)
                  const on = tagFilter === tag
                  return (
                    <button
                      key={tag}
                      onClick={() => {
                        setTagFilter(on ? null : tag)
                        if (!on && members.length > 0) setTransition(clip.id, members[0].id)
                      }}
                      title={`${members.length} masks`}
                      className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                        on ? 'bg-accent-500 text-ink-950' : 'bg-ink-800 text-ink-400 hover:bg-ink-700'
                      }`}
                    >
                      {TAG_LABELS[tag]} <span className="opacity-60">{members.length}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {clip.transitionIn && (
              <>
                <select
                  value={clip.transitionIn.id}
                  onChange={(e) => setTransition(clip.id, e.target.value, clip.transitionIn?.durationFrames)}
                  className="w-full rounded bg-ink-800 px-2 py-1.5 text-[11px] text-ink-200 outline-none"
                >
                  {tagFilter
                    ? transitionsWithTag(allTransitions, tagFilter).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))
                    : families.map(({ family, members }) => (
                        <optgroup key={family} label={family}>
                          {members.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                </select>

                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-[10.5px] text-ink-400">Length</span>
                  <input
                    type="range"
                    min={1}
                    max={Math.max(2, maxTransitionFrames(previousClip, clip))}
                    step={1}
                    value={clip.transitionIn.durationFrames}
                    onChange={(e) => setTransition(clip.id, clip.transitionIn!.id, Number(e.target.value))}
                    className="min-w-0 flex-1"
                  />
                  <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-600">
                    {(clip.transitionIn.durationFrames / fps).toFixed(2)}s
                  </span>
                </div>
              </>
            )}

            <div className="text-[10.5px] leading-snug text-ink-600">
              {base?.kind === 'cut'
                ? 'A transition consumes time from both clips rather than adding any, so the timeline shortens.'
                : 'Nothing moves: there is no clip before this one to overlap, so this costs no time.'}
            </div>
          </div>
        </>
      )}

      </div>
    </div>
  )
}

