import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Download, FolderOpen, Loader2, X } from 'lucide-react'
import { projectDuration } from '@shared/timeline'
import { ASPECTS, useEditor, type AspectKey } from '../store'
import { resolveStyle, type StyleOverrides } from '@shared/captions/style'
import { captionNeedsCanvas } from '@shared/graphics/fromTimeline'
import { bakeCaptions } from '../captionBake'
import {
  encodeSpecOf,
  isBuiltIn,
  newPresetId,
  pathForPreset,
  saneChoice,
  type ExportPreset
} from '@shared/render/presets'
import { encoderInfo, usableEncoder } from '@shared/render/encode'
import {
  exportCanvas,
  exportRange,
  formatRemaining,
  timeRemainingMs,
  withContainerExtension
} from '@shared/render/exportShape'
import { exportHeadline } from '@shared/render/exportHeadline'
import { ExportSettings } from './ExportSettings'
import { bakeForExport } from '@shared/render/exportBake'
import { liveBakers } from '../exportBakers'
import { offlineAssets } from '@shared/project/relink'
import { BigButton } from './ui/Tile'
import { Strip } from './ui/Strip'

/**
 * EXPORT: how the file is made, the button that makes it, and the exports
 * running and done (docs/WINDOW.md §3.17).
 *
 * A collapsible strip under OUTPUT. The Export button sits in the header, so
 * it is there with the strip closed, beside the running job's progress or,
 * once nothing runs, how the last export ended (done, or failed); the
 * body is the Inspector's export block moved here unchanged — ExportSettings
 * with "Only between the marks", the saved settings, and the Exports list,
 * which shows downloads too (Decision 7: the URL panel points here).
 *
 * The export flow and the File › Export listener moved with it, verbatim.
 * App.tsx renders this ALWAYS, and closing the strip hides its body by class
 * (ui/Strip.tsx), so the menu's export runs whether or not anyone has opened
 * the strip — tests/windowStrips.test.ts holds both.
 */
export function ExportStrip(): ReactNode {
  const project = useEditor((s) => s.project)
  const aspect = useEditor((s) => s.aspect)
  const jobs = useEditor((s) => s.jobs)
  const notify = useEditor((s) => s.notify)
  const open = useEditor((s) => s.exportOpen)
  const setExportOpen = useEditor((s) => s.setExportOpen)

  /*
   * The caption style, resolved as the OUTPUT strip resolves it: the export
   * needs to know whether the captions are a look libass can burn in or one
   * that has to be drawn first (captionNeedsCanvas, below).
   */
  const style = resolveStyle(
    project.captions.styleId,
    project.captions.overrides as StyleOverrides | undefined
  )

  const [exporting, setExporting] = useState(false)
  /** Export only between the in and out marks, when there are any. */
  const [useRange, setUseRange] = useState(true)
  const exportChoice = useEditor((s) => s.exportChoice)
  const exportPresets = useEditor((s) => s.exportPresets)
  const savePreset = useEditor((s) => s.savePreset)
  const removePreset = useEditor((s) => s.removePreset)

  /**
   * Export, optionally through a saved preset.
   *
   * A preset carries the canvas, the quality, the loudness target and the
   * caption decision, so exporting the same edit as a reel and as a YouTube
   * cut is two clicks rather than six settings changed from memory twice. Its
   * suffix goes in the filename, because without one the second export would
   * silently overwrite the first — they are both named after the project.
   */
  const onExport = useCallback(async (preset?: ExportPreset) => {
    // Read at the moment of the click, not from the closure: the export is of
    // the edit as it is NOW, and the in/out marks are not project state.
    const state = useEditor.getState()
    const current = state.project
    if (current.clips.length === 0) {
      notify('Add something to the timeline first', 'info')
      return
    }
    /*
     * Refuse before queueing, and NAME what is missing.
     *
     * An export with offline media does not fail cleanly — ffmpeg dies partway
     * with "No such file or directory" against a path, which reads as the
     * export being broken rather than as a file having moved. Only assets a
     * clip actually uses count: a stale pool entry nothing references does not
     * affect the render.
     */
    const missing = offlineAssets(current)
    if (missing.length > 0) {
      notify(
        `Cannot export — ${missing.length} file${missing.length === 1 ? ' is' : 's are'} missing: ` +
          `${missing.slice(0, 3).map((a) => a.name).join(', ')}` +
          `${missing.length > 3 ? '…' : ''}. Use Relink in the media pool.`
      )
      return
    }
    // Only the marks, when that was asked for. Marks that enclose nothing are
    // refused rather than quietly exporting all ten minutes instead.
    const marked = useRange ? exportRange(state.rangeIn, state.rangeOut, projectDuration(current)) : null
    if (marked === 'empty') {
      notify('The in and out points mark nothing — move them apart, or untick “Only between the marks”', 'info')
      return
    }
    setExporting(true)
    try {
      /*
       * The delivery: the preset's when exporting through one, otherwise the
       * panel's. An encoder this machine cannot run falls back to software
       * with a note, as Premiere does — a preset saved on the Mac naming
       * VideoToolbox still has to export on the Surface.
       */
      const choice = preset ? saneChoice(preset) : state.exportChoice
      await state.loadEncoders()
      const { encoder, note } = usableEncoder(choice.encoder, useEditor.getState().encoders)
      if (note) notify(note, 'info')
      const spec = encodeSpecOf({ ...choice, encoder })

      const wanted: AspectKey = preset?.aspect ?? aspect
      const canvas = exportCanvas(wanted, choice.resolution)
      const suggested =
        `${current.name || 'Untitled'}-${wanted.replace(':', 'x')}${marked ? '-range' : ''}.${spec.container}`
      const chosen = await window.forge.chooseExportPath(suggested)
      if (!chosen) return
      // The container's extension, whatever the name was typed with.
      const outputPath = withContainerExtension(preset ? pathForPreset(chosen, preset) : chosen, spec.container)

      /*
       * Draw the generated cards to disk, here, once — for THIS export.
       *
       * Text, colour cards and titles are drawn live in the preview from their
       * spec, so editing them never touches a file — which is what made typing
       * instant. The PNGs still have to exist for ffmpeg, and this is the one
       * moment they genuinely matter. They are drawn at the export's own
       * canvas and shape, into files of the export's own, and come back as a
       * copy of the project: the edit is not written to, so exporting adds no
       * undo steps, does not mark the project unsaved, and does not leave a
       * portrait paper run playing in a landscape preview. See exportBake.ts.
       */
      const baked = await bakeForExport(useEditor.getState().project, canvas, liveBakers, (clip, err) =>
        notify(
          `A card could not be redrawn, so its last picture is used: ${err instanceof Error ? err.message : String(err)}`,
          'info'
        )
      )

      /*
       * A preset's loudness and captions, for THIS export only.
       *
       * Presets always stored both and the export never applied either, so
       * "Reel (-14 LUFS, captions)" exported at whatever the project happened
       * to be set to. Applied to the copy that is rendered, not to the edit:
       * exporting a wide cut without captions must not switch them off for
       * the reel.
       */
      const exported = preset
        ? {
            ...baked,
            settings: { ...baked.settings, loudness: preset.loudness ?? undefined },
            captions: { ...baked.captions, enabled: preset.captions }
          }
        : baked

      /*
       * Styled captions, drawn here rather than by a second render pass.
       *
       * Only the looks libass cannot burn in come through here, and only the
       * pictures that actually differ get drawn — a still caption is one file
       * held for as long as it is on screen. Everything else about the export is
       * unchanged, which is the point: one pass, one encode.
       */
      const captionOverlay =
        exported.captions.enabled && captionNeedsCanvas(style)
          ? (await bakeCaptions(exported, canvas).catch((err) => {
              // A bake that fails must not lose the export. Falling back means
              // captions come out flat rather than styled, which is visible and
              // recoverable; a failed export is neither.
              notify(
                `Captions could not be drawn, so they will be burned in plain: ${
                  err instanceof Error ? err.message : String(err)
                }`,
                'info'
              )
              return null
            })) ?? undefined
          : undefined

      await window.forge.startRender({
        // The copy pointing at the export's freshly drawn cards.
        project: exported,
        outputPath,
        canvas,
        encode: spec,
        range: marked ?? undefined,
        captionOverlay: captionOverlay
          ? {
              listPath: captionOverlay.listPath,
              y: captionOverlay.y,
              height: captionOverlay.height
            }
          : undefined
      })
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
    // `useRange` has to be here: a callback that closes over a stale toggle
    // exports with whatever it was when the edit last changed.
  }, [aspect, notify, useRange, style])

  /*
   * The File > Export… menu item, which cannot call this directly.
   *
   * The export flow lives here, in the panel that owns it, and the menu is in
   * the main process. A counter in the store is the join: the menu increments
   * it, this reacts to the change. Skipping the first value matters — without
   * it, mounting the strip would start an export nobody asked for.
   *
   * This component is always mounted (App.tsx renders it unconditionally, and
   * closing the strip only hides its body), so File › Export works with EXPORT
   * shut. Keep the listener here, in the component itself: moved into anything
   * that renders only while the strip is open, the menu item would do nothing.
   */
  const exportRequests = useEditor((s) => s.exportRequests)
  const seenExportRequest = useRef(exportRequests)
  useEffect(() => {
    if (exportRequests === seenExportRequest.current) return
    seenExportRequest.current = exportRequests
    void onExport()
  }, [exportRequests, onExport])

  /*
   * What the header says about the jobs, closed or open: one under way, as a
   * bar; otherwise how the last export ended. The list with the details is in
   * the body, which is hidden while the strip is shut — and both strips start
   * shut — so without this an export's result showed nowhere (exportHeadline).
   */
  const headline = exportHeadline(jobs)
  const active = headline?.kind === 'running' || headline?.kind === 'waiting' ? headline.job : null
  const percent = active ? Math.round(active.progress * 100) : 0

  return (
    <Strip
      id="export"
      name="EXPORT"
      open={open}
      onToggle={() => setExportOpen(!open)}
      showTitle="Show the export settings and the exports"
      hideTitle="Hide the export settings"
      aside={
        <>
          {active && (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              title={
                headline?.kind === 'running'
                  ? `Running: ${active.inputName} — ${percent}%`
                  : `Waiting: ${active.inputName} — it starts when the one before it ends`
              }
              className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-ink-800"
            >
              <div className="h-full bg-accent-500 transition-[width]" style={{ width: `${percent}%` }} />
            </div>
          )}
          {headline?.kind === 'done' && (
            <button
              type="button"
              onClick={() => void window.forge.revealPath(headline.job.output)}
              title={`Done: ${headline.job.inputName} — Show in folder`}
              className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10.5px] text-accent-400 hover:bg-ink-850"
            >
              <CheckCircle2 size={12} aria-hidden />
              Done
            </button>
          )}
          {headline?.kind === 'failed' && (
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              title={`Failed: ${headline.job.inputName}${headline.job.error ? ` — ${headline.job.error}` : ''}. Open EXPORT for the details.`}
              className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10.5px] font-medium text-red-800 hover:bg-ink-850"
            >
              <AlertTriangle size={12} aria-hidden />
              Failed
            </button>
          )}
          {/*
            A big button, raised: the one action of the strip (WINDOW.md §2
            "Style" — neumorphism for tiles and big buttons only). Busy while
            the export is being prepared, which shows it pressed. Small, so
            the header keeps the 28 px the closed strip is budgeted.
          */}
          <BigButton
            icon={Download}
            pressedIcon={Loader2}
            busy={exporting}
            disabled={exporting}
            onClick={() => void onExport()}
            size="sm"
            className="shrink-0"
          >
            Export
          </BigButton>
        </>
      }
    >
      <div className="p-3">
        <div className="mb-3">
          <ExportSettings aspect={aspect} useRange={useRange} setUseRange={setUseRange} />
        </div>

        {/*
          Saved settings, one click each.
          
          The same ad goes out as a reel, a square and a wide cut, and each of
          those is six decisions made again from memory. A preset carries all
          six and puts its own suffix in the filename, because otherwise the
          second export silently overwrites the first — both are named after
          the project.
        */}
        <div className="mt-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-ink-600">
              Saved settings
            </span>
            <button
              onClick={() => {
                const name = window.prompt(
                  'Name these settings',
                  `${ASPECTS[aspect].label} ${exportChoice.resolution} ${encoderInfo(exportChoice.encoder).label}`
                )
                if (!name) return
                // Everything the panel shows, as it shows it — a preset that
                // saved less than was on screen would export something else.
                void savePreset({
                  id: newPresetId(),
                  name,
                  aspect,
                  ...exportChoice,
                  loudness: project.settings.loudness ?? null,
                  captions: project.captions.enabled,
                  suffix: `-${aspect.replace(':', 'x')}-${exportChoice.resolution}`
                })
              }}
              className="rounded px-1.5 py-0.5 text-[10px] text-ink-400 hover:bg-ink-800 hover:text-ink-200"
            >
              + Save current
            </button>
          </div>
          <div className="space-y-1">
            {exportPresets.map((item) => (
              <div key={item.id} className="group/preset flex items-center gap-1">
                <button
                  onClick={() => void onExport(item)}
                  disabled={exporting}
                  title={`${item.aspect} · ${item.resolution} · ${encoderInfo(item.encoder).label} · ${
                    item.bitrateKbps === null ? `CRF ${item.crf}` : `${item.bitrateKbps / 1000} Mbps`
                  } · .${item.container}${item.loudness === null ? '' : ` · ${item.loudness} LUFS`}${
                    item.captions ? ' · captions' : ''
                  }`}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded bg-ink-850 px-2 py-1 text-left text-[11px] text-ink-300 transition-colors hover:bg-ink-800 hover:text-ink-100 disabled:opacity-50"
                >
                  <Download size={11} className="shrink-0 text-ink-500" />
                  <span className="truncate">{item.name}</span>
                </button>
                {!isBuiltIn(item) && (
                  <button
                    onClick={() => void removePreset(item.id)}
                    title="Forget these settings"
                    className="rounded p-1 text-ink-600 opacity-0 transition-opacity hover:text-red-800 group-hover/preset:opacity-100"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/*
        The Exports list, under the settings. It scrolled on its own in the
        Inspector, pinned under the panel's scroller so a running export could
        not fall off-screen; here the strip's body scrolls and the header
        carries the running job's bar, so it is plain.
      */}
      {jobs.length > 0 && (
        <div className="border-t border-ink-700 bg-ink-900">
          <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-400">Exports</span>
            <button
              onClick={() => void window.forge.clearFinished()}
              className="text-[10px] text-ink-600 hover:text-ink-200"
            >
              Clear
            </button>
          </div>
          <div>
            {jobs.map((job) => (
              <div key={job.id} className="border-b border-ink-850 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-ink-200">{job.inputName}</span>
                  {job.status === 'running' && (
                    <button
                      onClick={() => void window.forge.cancelRender(job.id)}
                      title="Cancel"
                      className="shrink-0 rounded p-0.5 text-ink-600 hover:bg-ink-800 hover:text-ink-200"
                    >
                      <X size={11} />
                    </button>
                  )}
                  {job.status === 'done' && (
                    <button
                      onClick={() => void window.forge.revealPath(job.output)}
                      title="Show in folder"
                      className="shrink-0 rounded p-0.5 text-ink-600 hover:bg-ink-800 hover:text-ink-200"
                    >
                      <FolderOpen size={11} />
                    </button>
                  )}
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-800">
                  <div
                    className={`h-full transition-[width] ${
                      job.status === 'failed'
                        ? 'bg-red-500'
                        : job.status === 'cancelled'
                          ? 'bg-ink-600'
                          : 'bg-accent-500'
                    }`}
                    style={{ width: `${Math.round(job.progress * 100)}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-ink-600">
                  <span className="capitalize">{job.status}</span>
                  <span className="tabular-nums">
                    {job.speed ?? `${Math.round(job.progress * 100)}%`}
                    {/*
                      Time left, from the rate so far. Recomputed on every
                      progress report, which is what re-renders this row.
                    */}
                    {job.status === 'running' &&
                      (() => {
                        const left = timeRemainingMs(job.progress, job.startedAt, Date.now())
                        return left === null ? null : ` · ${formatRemaining(left)}`
                      })()}
                  </span>
                </div>
                {job.error && (
                  <div className="mt-1 line-clamp-3 text-[10px] leading-snug text-red-800">{job.error}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Strip>
  )
}
