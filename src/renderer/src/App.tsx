import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { tinykeys } from 'tinykeys'
import { AlertCircle, Info, Minimize2, Settings, X } from 'lucide-react'
import { escapeLeavesFullScreen } from '@shared/fullScreen'
import { projectDuration } from '@shared/timeline'
import { AUTOSAVE_INTERVAL_MS } from '@shared/project/recovery'
import { useEditor } from './store'
import { useCatalog } from './catalog'
import { activeCaptionStyle } from './captionPreview'
import { stopVoiceOver } from './recorder'
import { DOCK_FLOOR, TABS_FLOOR, dockSubject, holderFloor } from './dock'
import { LeftPanel } from './components/LeftPanel'
import { Preview } from './components/Preview'
import { Timeline } from './components/Timeline'
import { Transport } from './components/Transport'
import { TrimmerDock } from './components/TrimmerDock'
import { Toolbox } from './components/Toolbox'
import { CanvasBar } from './components/CanvasBar'
import { Shortcuts } from './components/Shortcuts'
import { NewProject } from './components/NewProject'
import { SourceBar } from './components/SourceBar'
import { CurveTray, useTrayPanel } from './components/CurveTray'
import { SettingsPanel, helperState } from './components/SettingsPanel'
import { OutputStrip } from './components/OutputStrip'
import { ExportStrip } from './components/ExportStrip'

function Divider({ vertical = false }: { vertical?: boolean }): ReactNode {
  return (
    <Separator
      className={
        vertical
          ? 'h-px bg-ink-800 transition-colors hover:bg-accent-500 active:bg-accent-500'
          : 'w-px bg-ink-800 transition-colors hover:bg-accent-500 active:bg-accent-500'
      }
    />
  )
}

function Notices(): ReactNode {
  const notices = useEditor((s) => s.notices)
  const dismiss = useEditor((s) => s.dismissNotice)
  if (notices.length === 0) return null

  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-1.5">
      {notices.slice(-4).map((notice) => (
        <div
          key={notice.id}
          className={`pointer-events-auto flex max-w-lg items-start gap-2 rounded-md border px-3 py-2 text-[11.5px] shadow-lg ${
            notice.tone === 'error'
              ? 'border-red-900 bg-red-950/95 text-red-200'
              : 'border-ink-700 bg-ink-850/95 text-ink-200'
          }`}
        >
          {notice.tone === 'error' ? (
            <AlertCircle size={13} className="mt-px shrink-0" />
          ) : (
            <Info size={13} className="mt-px shrink-0" />
          )}
          <span className="flex-1 leading-snug">{notice.text}</span>
          <button onClick={() => dismiss(notice.id)} className="shrink-0 opacity-60 hover:opacity-100">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

function Header(): ReactNode {
  const project = useEditor((s) => s.project)
  const dirty = useEditor((s) => s.dirty)
  const projectPath = useEditor((s) => s.projectPath)
  const sidecarReady = useEditor((s) => s.sidecarReady)
  const sidecarError = useEditor((s) => s.sidecarError)
  const settingsOpen = useEditor((s) => s.settingsOpen)
  const setSettingsOpen = useEditor((s) => s.setSettingsOpen)
  const helper = helperState(sidecarReady, sidecarError)

  return (
    <div className="drag-region flex h-9 shrink-0 items-center justify-center border-b border-ink-800">
      <span className="text-[11.5px] text-ink-400">
        <span className="font-medium text-ink-200">{project.name || 'Untitled'}</span>
        {dirty && <span className="ml-1 text-accent-500">•</span>}
        {projectPath && <span className="ml-2 text-ink-600">{projectPath}</span>}
      </span>
      <span
        className="no-drag absolute right-16 font-mono text-[9px] text-ink-600"
        title={`Build ${BUILD_STAMP} — if this timestamp is old, the running app is stale`}
      >
        {BUILD_STAMP.slice(11, 19)}
      </span>
      {/*
        Settings: the model servers, the AI helper, and later the hosted keys
        (SettingsPanel.tsx). The dot is the AI helper's, as the "AI" dot that
        stood here was. The header is a drag region, so without no-drag the
        gear would move the window instead of being pressed.
      */}
      <button
        data-settings-gear
        onClick={() => setSettingsOpen(!settingsOpen)}
        title="Settings"
        aria-pressed={settingsOpen}
        className={`no-drag absolute right-2 flex items-center gap-1 rounded px-1.5 py-1 transition-colors ${
          settingsOpen ? 'bg-ink-800 text-ink-100' : 'text-ink-500 hover:bg-ink-800 hover:text-ink-200'
        }`}
      >
        <Settings size={13} />
        <span className={`size-1.5 rounded-full ${helper.dot}`} />
      </button>
    </div>
  )
}

/**
 * The top of the left column: the tabs, and under them the Trimmer dock while
 * there is something to trim (WINDOW.md §3.18) — two panels of one vertical
 * Group, so the split between them can be dragged.
 *
 * A component of its own so that selecting a first clip, or letting go of the
 * last, re-renders this and not the whole window: App renders the Preview, and
 * the Curve tray keeps App out of its toggles for the same reason. The dock's
 * panel is in the Group only while `dockSubject` says there is something to
 * show (a selected clip that exists, or a Library sound being auditioned).
 * Both panels carry an id because the library remembers a layout per SET of
 * panel ids: the split dragged with the dock open comes back when it reopens,
 * and with it shut the tabs have the whole height, never a split left over.
 *
 * Clipped, with a min-height that keeps the tabs — and the dock, when it is
 * there — their floors against an open OUTPUT or EXPORT strip, as long as the
 * strips' two headers still fit (dock.ts; tests/windowStrips.test.ts).
 */
function LeftSplit(): ReactNode {
  const subject = useEditor((s) => dockSubject(s.project, s.selectedClipId, s.audition))
  return (
    <div className="flex-1 overflow-hidden" style={{ minHeight: holderFloor(subject !== null) }}>
      <Group orientation="vertical">
        <Panel id="left-tabs" defaultSize="45%" minSize={TABS_FLOOR}>
          <LeftPanel />
        </Panel>
        {subject && (
          <>
            <Divider vertical />
            <Panel id="left-dock" defaultSize="55%" minSize={DOCK_FLOOR}>
              <TrimmerDock />
            </Panel>
          </>
        )}
      </Group>
    </div>
  )
}

declare const __BUILD_STAMP__: string
/** Falls back when running outside the Vite build (tests, type-checking). */
const BUILD_STAMP = typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : 'dev'

export default function App(): ReactNode {
  const setJobs = useEditor((s) => s.setJobs)
  const notify = useEditor((s) => s.notify)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  /** The window is full screen — so the way out has to be on screen too. */
  const [fullScreen, setFullScreen] = useState(false)
  /** The Curve tray's Panel, opened and closed by the store's `trayOpen` (CurveTray.tsx). */
  const tray = useTrayPanel()

  /*
   * Out of full screen, by Escape or by the button below.
   *
   * Escape is decided after the event has finished travelling: a menu, a
   * picker, the shortcuts sheet or a text edit that used the key either stops
   * it or marks it handled, and only an Escape nobody wanted leaves full
   * screen. See src/shared/fullScreen.ts.
   */
  useEffect(() => window.forge.onFullScreen(setFullScreen), [])
  useEffect(() => {
    if (!fullScreen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setTimeout(() => {
        if (escapeLeavesFullScreen(e, true)) window.forge.exitFullScreen()
      }, 0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullScreen])
  /**
   * The New Project screen.
   *
   * Opened by File > New, and once at first launch on a project that has
   * nothing in it — which is exactly the moment the aspect decision is free.
   * Asking later, over work, would be asking someone to throw it away.
   */
  const [newOpen, setNewOpen] = useState(false)
  /** An autosave holding work the saved file does not, offered once at launch. */
  const [recovery, setRecovery] = useState<{ file: string; name: string; savedAt: number } | null>(
    null
  )

  useEffect(() => window.forge.onJobsChanged(setJobs), [setJobs])

  useEffect(
    () =>
      window.forge.onTranscribeProgress(({ assetId, progress, message }) =>
        useEditor.getState().setTranscribeProgress(assetId, progress, message)
      ),
    []
  )

  useEffect(
    () =>
      window.forge.onParallaxProgress(({ assetId, progress, message }) =>
        useEditor.getState().setBakeProgress(assetId, progress, message)
      ),
    []
  )

  useEffect(
    () =>
      window.forge.onSidecarStatus((status) => {
        const state = useEditor.getState()
        if (status.state === 'ready') state.setSidecar(true, null)
        else if (status.state === 'failed') state.setSidecar(false, status.error)
        else state.setSidecar(false, null)
      }),
    []
  )

  // The sidecar may already be up before the window finished loading, in which
  // case its status broadcast was missed.
  useEffect(() => {
    void window.forge
      .sidecarStatus()
      .then((status) => {
        const state = useEditor.getState()
        if (status.state === 'ready') state.setSidecar(true, null)
        else if (status.state === 'failed') state.setSidecar(false, status.error)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    void window.forge.listJobs().then(setJobs).catch(() => undefined)
  }, [setJobs])

  // Saved export settings, read once at startup.
  useEffect(() => {
    void useEditor.getState().loadPresets()
  }, [])

  /*
   * The libraries the whole window draws from, loaded by the shell.
   *
   * These lived in the Inspector, and ran at startup only because the
   * Inspector was always on screen. The window does not depend on that any
   * more (docs/WINDOW.md §3.20): the Preview's wipes and the Timeline's labels
   * read the transition table, `ensureFont` needs the catalog to find a face,
   * and the live captions need their font whether or not a panel is open.
   */
  const catalogLoaded = useCatalog((s) => s.catalog !== null)
  /**
   * The caption face, resolved exactly as the Preview draws it — the style's
   * preset with the project's overrides on top. Selected as a string so the
   * shell re-renders when the family changes, not on every edit.
   */
  const captionFont = useEditor((s) => activeCaptionStyle(s.project).fontFamily)

  useEffect(() => {
    void useCatalog.getState().loadTransitions()
  }, [])

  useEffect(() => {
    if (!catalogLoaded) void useCatalog.getState().load()
  }, [catalogLoaded])

  useEffect(() => {
    void useCatalog.getState().loadLooks()
  }, [])

  // Once the catalog has landed: before it, there is nothing to find the face in.
  useEffect(() => {
    if (catalogLoaded) void useCatalog.getState().ensureFont(captionFont)
  }, [captionFont, catalogLoaded])

  /*
   * Save, from wherever the request came from.
   *
   * One function so the hotkey, the menu, the header button and the close
   * guard cannot drift — and so the close guard gets a truthful answer about
   * whether the write happened. A cancelled Save dialog returns null, which is
   * "not saved", which is a reason to stay open rather than to close and hope.
   */
  const saveNow = useCallback(
    async (forceDialog = false): Promise<boolean> => {
      const { project, projectPath, decisions, markSaved } = useEditor.getState()
      try {
        const path = await window.forge.saveProject(project, projectPath, decisions, forceDialog)
        if (!path) return false
        markSaved(path)
        window.forge.rememberRecent(path)
        // The autosave has nothing left to offer once its work is in the file.
        if (project.id) void window.forge.clearAutosave(project.id).catch(() => undefined)
        return true
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err))
        return false
      }
    },
    [notify]
  )

  const openNow = useCallback(
    async (path?: string): Promise<void> => {
      try {
        const opened = await window.forge.openProject(path)
        if (!opened) return
        useEditor.getState().loadProject(opened.project, opened.path, opened.decisions)
        if (opened.path) window.forge.rememberRecent(opened.path)
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err))
      }
    },
    [notify]
  )

  /*
   * Autosave, every minute, only while there is something to save.
   *
   * Written beside the project rather than over it: an autosave is a copy to
   * recover FROM, and overwriting the file the user has not chosen to save
   * would be the crash doing the saving. The clock is an interval rather than
   * a debounce on every edit — on a busy timeline a debounce never fires.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      const { project, projectPath, decisions, dirty } = useEditor.getState()
      if (!dirty) return
      void window.forge.autosaveProject(project, projectPath, decisions).catch(() => undefined)
    }, AUTOSAVE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [])

  /*
   * What the menu needs to know, whenever it changes.
   *
   * Subscribed to the store rather than read on a timer: the items have to be
   * right the instant the menu is opened, and a menu that enables Undo a
   * second after you could have used it is worse than one that never does.
   */
  useEffect(() => {
    const report = (): void => {
      const s = useEditor.getState()
      window.forge.reportMenuState({
        canUndo: s.past.length > 0,
        canRedo: s.future.length > 0,
        hasSelection: s.selectedClipIds.length > 0,
        dirty: s.dirty,
        // Closing mid-take asks first; see mustAskBeforeClosing in main/menu.ts.
        recording: s.recording !== null
      })
    }
    report()
    return useEditor.subscribe(report)
  }, [])

  /** The menu is a remote control; the store is where the editor lives. */
  useEffect(() => {
    const offCommand = window.forge.onMenuCommand((command) => {
      const s = useEditor.getState()
      switch (command) {
        case 'new': setNewOpen(true); break
        case 'open': void openNow(); break
        // The close guard is waiting on this answer, so it is always sent.
        case 'save': void saveNow().then((ok) => window.forge.reportSaved(ok)); break
        case 'saveAs': void saveNow(true); break
        case 'export': s.requestExport(); break
        case 'undo': s.undo(); break
        case 'redo': s.redo(); break
        case 'cut': s.cutSelection(); break
        case 'copy': s.copySelection(); break
        case 'paste': void s.pasteClipboard(); break
        case 'duplicate': void s.duplicateSelection(); break
        case 'delete': s.deleteSelection(); break
        case 'selectAll': s.selectAll(); break
        case 'zoomIn': s.setZoom(s.zoom * 1.4); break
        case 'zoomOut': s.setZoom(s.zoom / 1.4); break
        case 'zoomFit': window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', shiftKey: true })); break
        case 'shortcuts': setShortcutsOpen(true); break
        // The close guard waits for `recording` to clear in the state report.
        case 'stopRecording': void stopVoiceOver(); break
        default: break
      }
    })
    const offOpen = window.forge.onMenuOpen((path) => void openNow(path))
    return () => {
      offCommand()
      offOpen()
    }
  }, [openNow, saveNow])

  /*
   * Anything to recover, asked once at launch.
   *
   * Only autosaves NEWER than their saved file reach here — see
   * project/recovery.ts — so this prompt appears when something was actually
   * lost and stays quiet otherwise. A prompt that appears every launch is one
   * nobody reads.
   */
  useEffect(() => {
    void window.forge
      .recoveries()
      .then((found) => setRecovery(found[0] ?? null))
      .catch(() => undefined)
  }, [])

  // Keyboard is how an NLE is actually driven.
  useEffect(() => {
    const state = useEditor.getState
    return tinykeys(window, {
      Space: (e) => {
        e.preventDefault()
        state().setPlaying(!state().playing)
      },
      KeyS: () => state().splitAtPlayhead(),
      ArrowLeft: () => state().setPlayhead(state().playhead - 1),
      ArrowRight: () => state().setPlayhead(state().playhead + 1),
      '$mod+ArrowLeft': () => state().setPlayhead(state().playhead - state().project.settings.fps),
      '$mod+ArrowRight': () => state().setPlayhead(state().playhead + state().project.settings.fps),
      Home: () => state().setPlayhead(0),
      End: () => state().setPlayhead(projectDuration(state().project)),
      '$mod+z': (e) => {
        e.preventDefault()
        state().undo()
      },
      '$mod+Shift+z': (e) => {
        e.preventDefault()
        state().redo()
      },
      /*
       * Delete leaves the gap; SHIFT-Delete closes it.
       *
       * Premiere's split, and the right way round for this app: everything the
       * automations place sits on a beat, so rippling by default would drag the
       * rest of a reel off the music. Rippling is the deliberate gesture.
       */
      Delete: () => state().deleteSelection(),
      Backspace: () => state().deleteSelection(),
      'Shift+Delete': () => state().rippleDeleteSelection(),
      'Shift+Backspace': () => state().rippleDeleteSelection(),

      // I and O: Premiere's, Resolve's, and every NLE's since.
      i: () => state().setRangeIn(state().playhead),
      o: () => state().setRangeOut(state().playhead),
      'Alt+x': () => state().clearRange(),

      '$mod+a': (e) => {
        e.preventDefault()
        state().selectAll()
      },
      '$mod+c': () => state().copySelection(),
      '$mod+x': () => state().cutSelection(),
      '$mod+v': () => void state().pasteClipboard(),
      '$mod+d': (e) => {
        e.preventDefault()
        void state().duplicateSelection()
      },

      /*
       * Nudge on ALT-arrow, not on the bare arrows.
       *
       * FIX.md asked for the bare arrows, and they were already taken: they
       * step the PLAYHEAD one frame, which is the more fundamental gesture and
       * has been there since the beginning. Alt-arrow is what Premiere nudges
       * with, so this is the convention rather than a compromise. One frame,
       * ten with shift, the whole selection, one undo entry.
       */
      'Alt+ArrowLeft': (e) => {
        e.preventDefault()
        state().nudgeSelection(-1)
      },
      'Alt+ArrowRight': (e) => {
        e.preventDefault()
        state().nudgeSelection(1)
      },
      'Alt+Shift+ArrowLeft': (e) => {
        e.preventDefault()
        state().nudgeSelection(-10)
      },
      'Alt+Shift+ArrowRight': (e) => {
        e.preventDefault()
        state().nudgeSelection(10)
      },
      // Save and Open go through the same functions the menu uses, so the
      // hotkey and the menu item cannot drift apart.
      '$mod+s': (e) => {
        e.preventDefault()
        void saveNow()
      },
      '$mod+Shift+s': (e) => {
        e.preventDefault()
        void saveNow(true)
      },
      '$mod+o': (e) => {
        e.preventDefault()
        void openNow()
      },
      '$mod+/': (e) => {
        e.preventDefault()
        setShortcutsOpen(true)
      }
    })
  }, [notify, saveNow, openNow])

  return (
    <div className="relative flex h-full flex-col overflow-hidden text-ink-200">
      {/*
        Work the app saved for you while you were not looking.
        
        Shown only when an autosave is genuinely newer than its file — which
        means something was lost — and dismissed for good either way, so a
        prompt that appeared once does not appear again at the next launch.
      */}
      {recovery && (
        <div className="flex items-center gap-3 border-b border-accent-500/40 bg-accent-500/10 px-4 py-2 text-[12px]">
          <span className="text-ink-200">
            Forge has unsaved work from <strong>{recovery.name}</strong>, autosaved{' '}
            {new Date(recovery.savedAt).toLocaleString()}.
          </span>
          <button
            onClick={() => {
              const file = recovery.file
              setRecovery(null)
              void window.forge
                .recoverProject(file)
                .then((opened) => {
                  if (opened) {
                    useEditor.getState().loadProject(opened.project, opened.path, opened.decisions)
                  }
                })
                .catch((err: unknown) =>
                  notify(err instanceof Error ? err.message : String(err))
                )
            }}
            className="rounded bg-accent-500 px-2 py-1 font-medium text-ink-950 hover:bg-accent-400"
          >
            Recover
          </button>
          <button
            onClick={() => setRecovery(null)}
            className="rounded px-2 py-1 text-ink-400 hover:bg-ink-800 hover:text-ink-200"
          >
            Discard
          </button>
        </div>
      )}

      {shortcutsOpen && <Shortcuts onClose={() => setShortcutsOpen(false)} />}

      {/* Under the header's gear; draws nothing while closed (store `settingsOpen`). */}
      <SettingsPanel />

      {/*
        The way out of full screen, where anyone looks for it. On Windows full
        screen hides the menu bar, so without this the toggle that went in was
        the only thing that could come out — and it was hidden.
      */}
      {fullScreen && (
        <button
          onClick={() => window.forge.exitFullScreen()}
          title="Leave full screen (Esc)"
          className="absolute left-1/2 top-2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-ink-700 bg-ink-900/90 px-3 py-1 text-[11px] text-ink-200 shadow-lg backdrop-blur hover:bg-ink-800"
        >
          <Minimize2 size={12} />
          Exit full screen
          <span className="text-ink-600">Esc</span>
        </button>
      )}

      {newOpen && (
        <NewProject
          onStart={(choice) => {
            useEditor.getState().newProject(choice)
            setNewOpen(false)
          }}
          onCancel={() => setNewOpen(false)}
        />
      )}

      <Header />

      {/*
        Sizes: a NUMBER is pixels and a STRING is percent in
        react-resizable-panels 4.x — and every string here says its unit. The
        library writes `defaultSize` straight into the panel's flex-basis for
        the first frame, so a bare "17" is invalid CSS there: the panels take
        their content's width, the library measures the group as the sum of
        those, converts a pixel minSize against that short sum, and keeps the
        percentage it got when the real width arrives. That opened the left
        column at 30 % (420 px at 1400 px) instead of 17 % (tests/trimmerDock.test.ts).
      */}
      <Group orientation="horizontal" className="flex-1">
        {/*
          The left column, full height (the user's answers to WINDOW.md §7.1
          and §7.2), and the only side panel: the Inspector column on the right
          is gone, its clip editor now the Trimmer dock in here, so the picture
          has the room. About 240 px at the 1400 px default — 17 %, and never
          under 240 px, the width a Slider row's fixed chrome and the Camera
          rows need.
        */}
        <Panel defaultSize="17%" minSize={240} maxSize="30%">
          {/*
            Where material comes from (SourceBar) heads the column it fills:
            over the left column only, so the picture and the timeline have
            the window's whole height under the header.
          */}
          <div className="flex h-full flex-col">
            <SourceBar />
            {/*
              The tabs with the Trimmer dock under them (LeftSplit), then the
              OUTPUT and EXPORT strips (WINDOW.md §3.16-3.17), at the foot of
              the column. Both strips are rendered unconditionally — closing
              one hides its body by class — because EXPORT holds the export
              flow and the File › Export listener, which must run with the
              strip shut (tests/windowStrips.test.ts). An open strip takes what
              the tabs and the dock leave, and its body scrolls; they do not
              give way to it (dock.ts holderFloor).
            */}
            <div className="flex min-h-0 flex-1 flex-col">
              <LeftSplit />
              <OutputStrip />
              <ExportStrip />
            </div>
          </div>
        </Panel>
        <Divider />
        <Panel defaultSize="83%" minSize="30%">
          {/*
            The right column: the picture over the timeline, which runs under
            the picture only. The picture's share is 64 % — not the 62 % it had
            when a source row ran across the whole window above it — so a 9:16
            frame is taller than it was before the step (tests/trimmerDock.test.ts),
            and the timeline keeps the height it had.
          */}
          <Group orientation="vertical">
            <Panel defaultSize="64%" minSize="30%">
              {/*
                The canvas bar sits over the picture it shapes, and is always
                rendered: the Preview below it must never move or remount (its
                rAF loop is the playback clock, WINDOW.md §5).
              */}
              <div className="flex h-full flex-col">
                <CanvasBar />
                {/* The tool strip belongs to the picture, so it travels with it. */}
                <div className="flex min-h-0 flex-1">
                  <Toolbox />
                  <div className="min-w-0 flex-1">
                    <Preview />
                  </div>
                </div>
              </div>
            </Panel>

            <Divider vertical />

            <Panel defaultSize="36%" minSize="18%">
              {/*
                The curve sits beside the timeline, on the same horizontal axis, so
                the shape of a move and the clip it belongs to line up.

                In the Curve tray (WINDOW.md §3.19): closed to a 28 px rail by
                default, and opened only by a person. The timeline takes
                whatever the tray leaves, so it has no default of its own; and the
                tray keeps its width in pixels when the window is resized, so the
                rail stays a rail. Always rendered, open or closed: CurveTray
                draws the rail itself.
              */}
              <Group orientation="horizontal">
                <Panel minSize="40%">
                  <div className="flex h-full flex-col">
                    <Transport />
                    <div className="min-h-0 flex-1">
                      <Timeline />
                    </div>
                  </div>
                </Panel>
                <Divider />
                <Panel
                  collapsible
                  collapsedSize={28}
                  minSize={240}
                  defaultSize={28}
                  maxSize="45%"
                  groupResizeBehavior="preserve-pixel-size"
                  panelRef={tray.panelRef}
                  onResize={tray.onResize}
                >
                  <CurveTray />
                </Panel>
              </Group>
            </Panel>
          </Group>
        </Panel>
      </Group>

      <Notices />
    </div>
  )
}
