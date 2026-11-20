import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Captions, ChevronRight, FileWarning, Film, FolderPlus, Image as ImageIcon, Link2, Loader2, MoreHorizontal, Music, Upload, X } from 'lucide-react'
import type { MediaAsset } from '@shared/timeline'
import { formatDuration, formatBytes } from '@shared/time'
import { framesToSeconds } from '@shared/timeline'
import { removeWaits, useEditor, type FolderMenuTarget, type PoolMenuTarget } from '../store'
import { mediaUrl } from '../media'
import { DRAG_MIME, readDragPayload, setDragPayload } from '../dragPayload'
import type { DragPayload } from '@shared/dragPayload'
import { BigButton } from './ui/Tile'
import { NEEDS_SPEECH_MODEL, SPEECH_MODEL_BUSY, STOP_SPEECH_MODEL, speechModelLabel } from '@shared/asr/speechModel'
import { SIDECAR_METHODS } from '@shared/sidecar/protocol'
import { helperCan } from '@shared/sidecar/helperCan'
import { speechFetchText, transcribeGate, type TranscribeGate } from '@shared/sidecar/row'
import { assetClipCount, assetClipsGoing } from '@shared/edit/removeAssets'
import { MENU_WIDTH, MenuDivider, MenuItem, MenuShell, SUBMENU_WIDTH, Submenu, swallowSecondClick, useMenuDismiss } from './ui/Menu'
import { FOLDER_NAME_MAX, cleanFolderName, folderList, folderNameProblem } from '@shared/edit/folders'

const ICON = { video: Film, audio: Music, image: ImageIcon }

/**
 * What a pool tile carries while being dragged.
 *
 * `assetId` is what separates this from a library drag: the file is already
 * imported and probed, so the drop reuses it rather than reading it again.
 * `mediaKind` rides along because a sound belongs on an audio track and a
 * picture does not, and the payload is all the drop target gets to look at.
 */
export function poolPayload(asset: MediaAsset): DragPayload {
  return {
    kind: 'media',
    file: asset.path,
    name: asset.name,
    assetId: asset.id,
    mediaKind: asset.kind
  }
}

/**
 * A frame of the thing, rather than its filename.
 *
 * Video gets a `<video>` seeked a little way in — `#t=0.5` rather than 0,
 * because the first frame of a clip is very often black and a grid of black
 * squares identifies nothing. Audio has no picture to show, so it keeps an
 * icon and leans on its name.
 *
 * Exported for Choose from media (tools/SourceLine.tsx), which shows the same
 * picture smaller beside each photo's name.
 */
export function Thumbnail({ asset }: { asset: MediaAsset }): ReactNode {
  /*
   * A file that is not there says so, rather than showing a broken thumbnail.
   *
   * An `<img>` pointing at a missing file renders as a grey box with a torn
   * icon in it, which reads as the app failing to load a picture — not as the
   * picture having moved.
   */
  if (asset.offline) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-1 bg-red-500/10">
        <FileWarning size={18} className="text-red-800" />
        <span className="text-[9px] font-medium uppercase tracking-wide text-red-800">Offline</span>
      </div>
    )
  }
  if (!asset.path || asset.kind === 'audio') {
    const Icon = ICON[asset.kind]
    return (
      <div className="flex size-full items-center justify-center bg-ink-800">
        <Icon size={20} className="text-ink-600" />
      </div>
    )
  }
  const url = mediaUrl(asset.path)
  if (asset.kind === 'video') {
    return (
      <video
        src={`${url}#t=0.5`}
        preload="metadata"
        muted
        playsInline
        className="size-full object-cover"
      />
    )
  }
  return <img src={url} alt="" loading="lazy" className="size-full object-cover" />
}

/**
 * A greyed Transcribe's title (docs/CLIPS.md §3a.4). The tile's button has no
 * room for a pointer, so its title says where the Install is.
 */
export const TRANSCRIBE_NEEDS_HELPER = 'needs the AI helper — install it in Settings'

/** Why Transcribe is greyed, or null when it can be pressed: by `asr.transcribe` and the speech model, never by a process being up. */
export function transcribeWhy(gate: TranscribeGate): string | null {
  switch (gate) {
    case 'ready':
      return null
    case 'no-model':
      return NEEDS_SPEECH_MODEL
    case 'starting':
      return 'the AI helper is starting'
    case 'no-helper':
      return TRANSCRIBE_NEEDS_HELPER
  }
}

/**
 * The speech model's sized press, over the pool while Transcribe needs it
 * (§16.49 (a)): "Get the speech model · 464 MB" from the model's own status,
 * the fetch's progress while it runs. Only once main has said how big it is:
 * the size goes on the button before the press. No hook but the store's.
 * `inline` drops the bar's own border and padding, for a tile that already
 * has them (the Transcript tile, under its Transcribe).
 */
export function SpeechModelPress({ inline = false }: { inline?: boolean } = {}): ReactNode {
  const status = useEditor((s) => s.helperStatus)
  const model = useEditor((s) => s.speechModel)
  const choice = useEditor((s) => s.speechChoice)
  const fetching = useEditor((s) => s.speechFetch)
  const getSpeechModel = useEditor((s) => s.getSpeechModel)
  const cancelSpeechModel = useEditor((s) => s.cancelSpeechModel)
  if (!helperCan(status, SIDECAR_METHODS.transcribe)) return null
  // The CHOSEN model's press. A fetch of another model (pressed in Settings) is not this one: while it runs,
  // this press waits, its title saying why, and its X stays in Settings with that model's line. Compared by the
  // chosen model's NAME, so a chosen model whose status is not known yet never takes another model's fetch.
  const mine = fetching !== null && fetching.model === (model?.model ?? choice)
  const waiting = fetching !== null && !mine
  if (!mine && (!model || model.present)) return null
  return (
    <div data-speech-press="" className={`flex items-center gap-2 ${inline ? '' : 'border-b border-ink-800 px-3 py-1.5'}`}>
      <Captions size={12} className="shrink-0 text-ink-500" />
      <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-400">
        Transcribe <span>{NEEDS_SPEECH_MODEL}</span>
      </span>
      <button
        type="button"
        onClick={() => void getSpeechModel(model?.model)}
        disabled={fetching !== null}
        title={waiting ? SPEECH_MODEL_BUSY : model ? `Fetched once from ${model.host}, then kept on this computer` : undefined}
        className="shrink-0 rounded bg-ink-800 px-1.5 py-0.5 text-[10.5px] text-ink-300 hover:bg-ink-700 hover:text-ink-100 disabled:opacity-60"
      >
        {mine ? speechFetchText(fetching) : model ? speechModelLabel(model) : null}
      </button>
      {mine && (
        <button
          type="button"
          data-speech-cancel=""
          onClick={cancelSpeechModel}
          title={STOP_SPEECH_MODEL}
          aria-label={STOP_SPEECH_MODEL}
          className="shrink-0 rounded bg-ink-800 p-1 text-ink-400 hover:bg-ink-700 hover:text-ink-100"
        >
          <X size={10} />
        </button>
      )}
    </div>
  )
}

export type { PoolMenuTarget }

/** The menu's last item. It takes the file out of the PROJECT; the file on disk is never touched. */
export const REMOVE_FROM_PROJECT = 'Remove from project'

/** The platform's own words for showing a file where it sits ('MacIntel', 'Win32', anything else). */
export function revealLabel(platform: string): string {
  const name = platform.toLowerCase()
  if (name.includes('mac')) return 'Show in Finder'
  if (name.startsWith('win')) return 'Show in Explorer'
  return 'Show in folder'
}

/** The question's words, for a file `n` clips play (n ≥ 1). */
export function usedByText(n: number): string {
  return n === 1 ? 'Used by 1 clip on the timeline' : `Used by ${n} clips on the timeline`
}
export function removeWithClipsText(n: number): string {
  return n === 1 ? 'Remove it and its clip' : `Remove it and its ${n} clips`
}
/** The question's remove for a photo only card rings show among others: no clip goes, the photo leaves each ring. */
export const REMOVE_IT = 'Remove it'

/*
 * The room the menu keeps inside the window: itself, a submenu beside it, and
 * its tallest face — "Move to"'s list of folders, which opens beside its row
 * (the fourth at most, about 100 px down) and scrolls past 320 px.
 */
export const POOL_MENU_ROOM = { width: MENU_WIDTH + SUBMENU_WIDTH, height: 430 }

/* The Upload panel's folders (shared/edit/folders.ts): one level, in the project, never on disk. */
export const NEW_FOLDER = 'New folder'
export const MOVE_TO = 'Move to'
export const NEW_FOLDER_ITEM = 'New folder…'
export const NO_FOLDER = 'No folder'
export const FOLD_FOLDER = 'Fold this folder'
export const OPEN_FOLDER = 'Open this folder'
export const FOLDER_MENU_TITLE = 'Rename or remove this folder'
export const FOLDER_EMPTY = 'Drag files here to put them in this folder'
export const FOLDER_NAME_PLACEHOLDER = 'Folder name'
export const RENAME_FOLDER = 'Rename'
export const REMOVE_FOLDER = 'Remove folder'
export const REMOVE_FOLDER_NOTE = 'Its files stay in the project, in no folder'
// A folder header's menu: two items and a divider.
export const FOLDER_MENU_ROOM = { width: MENU_WIDTH, height: 90 }

/**
 * The right-click menu on a pool tile: ClipMenu's look and manner, from the
 * same pieces (ui/Menu.tsx). Each item is there only when it applies, and
 * does what an existing control does through the same store action:
 *
 * - Add to timeline: the tile's double-click (`addAssetToTimeline`).
 * - Transcribe, or Transcribe again once there is a transcript, for a file
 *   with sound: the tile's own Transcribe (`transcribeAsset`), greyed by the
 *   same gate with the same reason (`why`, computed once by the pool for
 *   both). Not offered while the file is being transcribed: the tile's own
 *   button is then its cancel.
 * - Relink…, for a missing file: `relinkMedia` with the file's id, which
 *   asks for that one file (the bar over the pool asks for a folder).
 * - Show in Finder / Explorer / folder, for a file that is there: the bridge's
 *   `revealPath` (main's `shell.showItemInFolder`), on the file the user
 *   imported (`source`, when `path` is the app's converted copy).
 * - Move to: every folder (the file's own ticked), "New folder…" (named in
 *   place, then made with the file in it, one undo step) and, for a file in
 *   a folder, "No folder" (`moveAssetsToFolder`).
 * - Remove from project, last and apart. A file no clip plays goes at once;
 *   for one that clips play the menu turns into the question, in place:
 *   "Used by 3 clips on the timeline", "Remove it and its 3 clips", "Keep it".
 *   A card ring that shows the photo among others is one of the clips asked
 *   about; only the photo leaves it ("Remove it" when no clip goes). Greyed,
 *   and refused by the store, while a reel, the grid or the Director is being
 *   built (`removeWaits`): those place clips of the files they read.
 *
 * Rendered by the pool OUTSIDE the tiles, so nothing done in it can start a
 * tile's drag. Its state is the store's (`poolMenu`, `closePoolMenu`), so any
 * close ends the question. Pressing an item swallows the second press of a
 * double-click (`swallowSecondClick`), which would otherwise land on the tile
 * or the question now under the pointer.
 */
export function PoolMenu({
  target,
  why
}: {
  target: PoolMenuTarget
  /** The pool's own Transcribe gate (`transcribeWhy`): null when it can be pressed, else the greyed button's reason. */
  why: string | null
}): ReactNode {
  const project = useEditor((s) => s.project)
  const transcribing = useEditor((s) => s.transcribing)
  const removingAsset = useEditor((s) => s.removingAsset)
  const waits = useEditor(removeWaits)
  // The store's close: it ends the question too, so Escape or a click elsewhere means "Keep it".
  const close = useEditor((s) => s.closePoolMenu)
  useMenuDismiss(close)

  const asset = project.assets.find((a) => a.id === target.assetId)
  if (!asset) return null
  const store = useEditor.getState
  const run = (fn: () => void) => (): void => {
    fn()
    swallowSecondClick()
    close()
  }

  const clips = assetClipCount(project, asset.id)
  if (removingAsset === asset.id && clips > 0) {
    const going = assetClipsGoing(project, asset.id)
    return (
      <MenuShell x={target.x} y={target.y} room={POOL_MENU_ROOM} data={['pool-menu', asset.id]}>
        <div data-pool-ask="" className="px-3 py-1.5 text-[12px] leading-snug text-ink-200">
          {usedByText(clips)}
        </div>
        <MenuDivider />
        <MenuItem
          label={going > 0 ? removeWithClipsText(going) : REMOVE_IT}
          danger
          disabled={waits !== null}
          title={waits ?? undefined}
          data={['pool-menu-item', 'remove-confirm']}
          onClick={run(() => store().confirmRemoveAsset())}
        />
        <MenuItem label="Keep it" data={['pool-menu-item', 'keep']} onClick={run(() => store().keepAsset())} />
      </MenuShell>
    )
  }

  const file = asset.source ?? asset.path
  const withSound = asset.kind !== 'image' && asset.hasAudio
  const folders = folderList(project)
  return (
    <MenuShell x={target.x} y={target.y} room={POOL_MENU_ROOM} data={['pool-menu', asset.id]}>
      <MenuItem
        label="Add to timeline"
        data={['pool-menu-item', 'add']}
        onClick={run(() => store().addAssetToTimeline(asset.id))}
      />
      {withSound && !transcribing[asset.id] && (
        <MenuItem
          label={project.transcripts[asset.id] ? 'Transcribe again' : 'Transcribe'}
          disabled={why !== null}
          title={why ?? undefined}
          data={['pool-menu-item', 'transcribe']}
          onClick={run(() => void store().transcribeAsset(asset.id))}
        />
      )}
      {asset.offline && (
        <MenuItem
          label="Relink…"
          data={['pool-menu-item', 'relink']}
          onClick={run(() => void store().relinkMedia(asset.id))}
        />
      )}
      {!asset.offline && file && (
        <MenuItem
          label={revealLabel(typeof navigator === 'undefined' ? '' : navigator.platform)}
          data={['pool-menu-item', 'reveal']}
          onClick={run(() => void window.forge.revealPath(file))}
        />
      )}
      <Submenu label={MOVE_TO} data={['pool-menu-item', 'move-to']}>
        {folders.map((folder) => (
          <MenuItem
            key={folder}
            label={folder}
            ticked={asset.folder === folder}
            data={['pool-move-to', folder]}
            onClick={run(() => store().moveAssetsToFolder([asset.id], folder))}
          />
        ))}
        {folders.length > 0 && <MenuDivider />}
        <MenuItem
          label={NEW_FOLDER_ITEM}
          data={['pool-menu-item', 'new-folder']}
          onClick={run(() => store().startNewFolder([asset.id]))}
        />
        {asset.folder !== undefined && (
          <MenuItem
            label={NO_FOLDER}
            data={['pool-menu-item', 'no-folder']}
            onClick={run(() => store().moveAssetsToFolder([asset.id], null))}
          />
        )}
      </Submenu>
      <MenuDivider />
      <MenuItem
        label={REMOVE_FROM_PROJECT}
        danger
        disabled={waits !== null}
        title={waits ?? undefined}
        data={['pool-menu-item', 'remove']}
        onClick={() => {
          store().removeAsset(asset.id)
          swallowSecondClick()
          // A file clips play asks first, here in the menu; one nobody plays is gone, and so is the menu.
          if (store().removingAsset !== asset.id) close()
        }}
      />
    </MenuShell>
  )
}

/**
 * A folder header's menu (right-click on the header, or its "…" button):
 * Rename, which puts the name in place for typing, and Remove folder, which
 * takes the folder away and leaves every file of it in the project, in no
 * folder (one undo step). The tile menu's pieces and manner; its state is the
 * store's `folderMenu`, so only one of the two menus is ever open.
 */
export function FolderMenu({ target }: { target: FolderMenuTarget }): ReactNode {
  const project = useEditor((s) => s.project)
  const close = useEditor((s) => s.closeFolderMenu)
  useMenuDismiss(close)
  if (!folderList(project).includes(target.folder)) return null
  const store = useEditor.getState
  const run = (fn: () => void) => (): void => {
    fn()
    swallowSecondClick()
    close()
  }
  return (
    <MenuShell x={target.x} y={target.y} room={FOLDER_MENU_ROOM} data={['folder-menu', target.folder]}>
      <MenuItem
        label={RENAME_FOLDER}
        data={['folder-menu-item', 'rename']}
        onClick={run(() => store().startRenameFolder(target.folder))}
      />
      <MenuDivider />
      <MenuItem
        label={REMOVE_FOLDER}
        danger
        title={REMOVE_FOLDER_NOTE}
        data={['folder-menu-item', 'remove']}
        onClick={run(() => store().removeFolder(target.folder))}
      />
    </MenuShell>
  )
}

/**
 * A folder's name, typed in place: a new folder's (under the last folder) or
 * a rename's (in its header). Enter makes it; a name that cannot be used says
 * why under the field and the field stays. Escape leaves it, and so does
 * clicking away from a name that cannot be used; clicking away from one that
 * can makes it, as Finder does.
 */
function FolderNameInput(): ReactNode {
  const edit = useEditor((s) => s.folderEdit)
  const project = useEditor((s) => s.project)
  const setFolderDraft = useEditor((s) => s.setFolderDraft)
  const commitFolderEdit = useEditor((s) => s.commitFolderEdit)
  const cancelFolderEdit = useEditor((s) => s.cancelFolderEdit)
  if (!edit) return null
  // Nothing typed is not yet a mistake: it says nothing.
  const problem = cleanFolderName(edit.draft) === '' ? null : folderNameProblem(project, edit.draft, edit.from)
  return (
    <div className="min-w-0 flex-1">
      <input
        data-pool-folder-input=""
        autoFocus
        value={edit.draft}
        maxLength={FOLDER_NAME_MAX}
        placeholder={FOLDER_NAME_PLACEHOLDER}
        onChange={(e) => setFolderDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitFolderEdit()
          } else if (e.key === 'Escape') {
            // Handled: leaving the name must not also leave full screen.
            e.preventDefault()
            e.stopPropagation()
            cancelFolderEdit()
          }
        }}
        onBlur={() => {
          if (commitFolderEdit() !== null) cancelFolderEdit()
        }}
        className="w-full rounded border border-ink-600 bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-100 outline-none focus:border-accent-500"
      />
      {problem !== null && (
        <div data-pool-folder-problem="" className="pt-0.5 text-[10px] leading-snug text-red-800">
          {problem}
        </div>
      )}
    </div>
  )
}

/**
 * The file a drop inside the panel's list moves into a folder (or out to
 * none): a pool tile's, read from the very payload the timeline and the
 * picture read (`poolPayload`), and only while the file is in the project.
 * Null for anything else, which then bubbles on to the panel's own drop.
 */
export function tileDropped(payload: DragPayload | null, project: { assets: readonly MediaAsset[] }): string | null {
  if (payload?.kind !== 'media' || !payload.assetId) return null
  const id = payload.assetId
  return project.assets.some((a) => a.id === id) ? id : null
}

/** True while a drag carries the app's own payload (a pool tile, a Library item), not files from the disk. */
function appDrag(e: DragEvent): boolean {
  return Boolean(e.dataTransfer?.types?.includes(DRAG_MIME))
}

export function MediaPool(): ReactNode {
  const project = useEditor((s) => s.project)
  const importAssets = useEditor((s) => s.importAssets)
  const relinkMedia = useEditor((s) => s.relinkMedia)
  const addAssetToTimeline = useEditor((s) => s.addAssetToTimeline)
  const transcribeAsset = useEditor((s) => s.transcribeAsset)
  const cancelTranscribe = useEditor((s) => s.cancelTranscribe)
  const transcribing = useEditor((s) => s.transcribing)
  const helperStatus = useEditor((s) => s.helperStatus)
  const speechModel = useEditor((s) => s.speechModel)
  const refreshSpeechModel = useEditor((s) => s.refreshSpeechModel)
  // Transcribe by its own method and the model on disk (docs/CLIPS.md §3a.4), never by the process being up.
  const why = transcribeWhy(transcribeGate(helperStatus, speechModel))
  const canTranscribe = helperCan(helperStatus, SIDECAR_METHODS.transcribe)
  // Is the speech model on disk? Asked once the helper can transcribe and nobody has asked; never downloads.
  useEffect(() => {
    if (canTranscribe && speechModel === null) void refreshSpeechModel()
  }, [canTranscribe, speechModel, refreshSpeechModel])
  const offline = project.assets.filter((a) => a.offline)
  const notify = useEditor((s) => s.notify)
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  // The tile menu is the store's (`poolMenu`), so its close ends its question wherever it comes from.
  const menu = useEditor((s) => s.poolMenu)
  const openPoolMenu = useEditor((s) => s.openPoolMenu)
  const closePoolMenu = useEditor((s) => s.closePoolMenu)
  // A menu whose file left the project by another route (an undo of its import) closes, so a redo does not bring it back.
  const menuLost = menu !== null && !project.assets.some((a) => a.id === menu.assetId)
  useEffect(() => {
    if (menuLost) closePoolMenu()
  }, [menuLost, closePoolMenu])
  // The panel going (another Shelf tool) takes its menu with it.
  useEffect(() => closePoolMenu, [closePoolMenu])

  // The folders (shared/edit/folders.ts): their menu, a name being typed, and which are folded, all the store's.
  const folders = folderList(project)
  const folderMenu = useEditor((s) => s.folderMenu)
  const folderEdit = useEditor((s) => s.folderEdit)
  const folded = useEditor((s) => s.foldedFolders)
  const openFolderMenu = useEditor((s) => s.openFolderMenu)
  const closeFolderMenu = useEditor((s) => s.closeFolderMenu)
  const cancelFolderEdit = useEditor((s) => s.cancelFolderEdit)
  const startNewFolder = useEditor((s) => s.startNewFolder)
  const startRenameFolder = useEditor((s) => s.startRenameFolder)
  const toggleFolder = useEditor((s) => s.toggleFolder)
  const moveAssetsToFolder = useEditor((s) => s.moveAssetsToFolder)
  const importDropped = useEditor((s) => s.importDropped)
  // A folder that left by another route (an undo of its making) takes its menu and its rename with it.
  const folderMenuLost = folderMenu !== null && !folders.includes(folderMenu.folder)
  const renameLost = folderEdit !== null && folderEdit.from !== null && !folders.includes(folderEdit.from)
  useEffect(() => {
    if (folderMenuLost) closeFolderMenu()
  }, [folderMenuLost, closeFolderMenu])
  useEffect(() => {
    if (renameLost) cancelFolderEdit()
  }, [renameLost, cancelFolderEdit])
  useEffect(
    () => () => {
      closeFolderMenu()
      cancelFolderEdit()
    },
    [closeFolderMenu, cancelFolderEdit]
  )
  /** Which folder a dragged tile is over ('' for none: the top grid), for the highlight. */
  const [dropOn, setDropOn] = useState<string | null>(null)
  /** The tile being dragged, from its dragstart to its dragend: a ref, so starting a drag re-renders nothing. */
  const moving = useRef<string | null>(null)

  /*
   * A tile dragged inside the panel moves it: onto a folder's header or its
   * files, into that folder; anywhere else in the list (the top grid, the
   * space under the folders), out to none. Only while one of this panel's
   * tiles is being dragged, and only by its payload — the same one a drop on
   * the timeline or the picture reads (`poolPayload`), unchanged. Anything
   * else (files from the disk, a Library item) bubbles on to the panel's own
   * drop, as before.
   */
  const overInto = (key: string) => (e: DragEvent) => {
    if (moving.current === null) return
    e.preventDefault()
    e.stopPropagation()
    if (dropOn !== key) setDropOn(key)
  }
  const dropInto = (folder: string | null) => (e: DragEvent) => {
    if (moving.current === null) return
    const id = tileDropped(readDragPayload(e), project)
    if (id === null) return
    e.preventDefault()
    e.stopPropagation()
    setDropOn(null)
    moveAssetsToFolder([id], folder)
  }

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      depth.current = 0
      setOver(false)
      setDropOn(null)
      // A pool tile let go outside the list (on the Upload button, the heading): nothing to do, and nothing to say.
      if (appDrag(event) && readDragPayload(event)?.kind === 'media') return

      const paths: string[] = []
      for (const file of Array.from(event.dataTransfer.files)) {
        // File.path was removed in Electron 32; webUtils via preload is the
        // supported replacement and returns '' for non-disk items.
        const path = window.forge.getPathForFile(file)
        if (path) paths.push(path)
      }
      if (paths.length === 0) {
        notify('Those items have no file on disk — use Upload instead', 'info')
        return
      }
      // A dropped folder becomes a folder of the same name (main reads it); loose files go to none, as always.
      void importDropped(paths)
    },
    [importDropped, notify]
  )

  /*
   * Upload: the one way in from a file dialog.
   *
   * There were two — the source row's "Add files" and this panel's "+ Import"
   * — and both called pickMedia then importAssets (the user: "Upload and
   * Import are same"). One button now, at the top of the Upload tile, and it
   * says it is working while the dialog and the import run: a large import is
   * seconds of probing, and a button that looks idle meanwhile gets pressed
   * again.
   */
  const [picking, setPicking] = useState(false)
  const pick = useCallback(async () => {
    setPicking(true)
    try {
      const paths = await window.forge.pickMedia()
      if (paths.length > 0) await importAssets(paths)
    } finally {
      setPicking(false)
    }
  }, [importAssets])

  const details = (asset: MediaAsset): string => {
    const bits = [formatBytes(asset.size)]
    if (asset.kind !== 'image') {
      bits.push(formatDuration(framesToSeconds(asset.durationFrames, project.settings.fps)))
    }
    if (asset.width && asset.height) bits.push(`${asset.width}×${asset.height}`)
    return bits.join(' · ')
  }

  // A file whose folder the list lacks (never, once a file is opened: project.ts repairs it) shows here rather than nowhere.
  const loose = project.assets.filter((a) => a.folder === undefined || !folders.includes(a.folder))

  /** One tile: the same in the top grid and in a folder. */
  const tile = (asset: MediaAsset): ReactNode => {
    const Icon = ICON[asset.kind]
    const job = transcribing[asset.id]
    const hasTranscript = Boolean(project.transcripts[asset.id])
    return (
      <div
        key={asset.id}
        data-pool-tile={asset.id}
        draggable
        onDragStart={(e) => {
          setDragPayload(e, poolPayload(asset))
          moving.current = asset.id
        }}
        onDragEnd={() => {
          moving.current = null
          setDropOn(null)
        }}
        onDoubleClick={() => addAssetToTimeline(asset.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          openPoolMenu({ assetId: asset.id, x: e.clientX, y: e.clientY })
        }}
        // A clip from a link carries its credit (CLIPS.md §3b.4); until step 5's
        // Credits block, its line is shown here.
        title={`${asset.name}\n${details(asset)}${asset.credit ? `\n${asset.credit.line}` : ''}\n\nDrag onto the timeline, or double-click`}
        className="group relative aspect-square cursor-grab overflow-hidden rounded-md border border-ink-700 bg-ink-850 hover:border-accent-500 active:cursor-grabbing"
      >
        <Thumbnail asset={asset} />

        {/*
          The name, over the picture rather than beside it.

          A list of filenames is unreadable when the files are
          IMG_4821 and DSC_0037, which is what a camera gives you —
          the picture is the only thing that identifies a shot, so it
          gets the tile and the name gets a caption.
        */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-950/95 to-transparent px-1 pb-0.5 pt-3">
          <div className="truncate text-[9px] leading-tight text-ink-200">{asset.name}</div>
        </div>

        <div className="pointer-events-none absolute left-1 top-1 rounded bg-ink-950/75 p-0.5">
          <Icon size={10} className="text-ink-300" />
        </div>

        {asset.kind !== 'image' && (
          <span className="pointer-events-none absolute right-1 top-1 rounded bg-ink-950/75 px-1 text-[9px] tabular-nums text-ink-300">
            {formatDuration(framesToSeconds(asset.durationFrames, project.settings.fps))}
          </span>
        )}

        {job ? (
          <button
            onClick={() => cancelTranscribe(asset.id)}
            title={job.message ?? 'Transcribing — click to cancel'}
            className="absolute inset-x-1 bottom-4 flex items-center justify-center gap-1 rounded bg-accent-500/90 px-1 py-0.5 text-[9px] font-medium text-ink-950"
          >
            <Loader2 size={9} className="animate-spin" />
            {job.progress === null ? 'analysing' : `${Math.round(job.progress * 100)}%`}
            <X size={8} />
          </button>
        ) : (
          asset.kind !== 'image' && (
            <button
              onClick={() => void transcribeAsset(asset.id)}
              disabled={why !== null}
              title={
                why !== null
                  ? why
                  : hasTranscript
                    ? 'Transcribed — click to redo'
                    : 'Transcribe'
              }
              className={`absolute bottom-4 right-1 rounded p-1 transition-opacity disabled:opacity-30 ${
                hasTranscript
                  ? 'bg-emerald-500/20 text-emerald-800 ring-1 ring-emerald-500/50'
                  : 'bg-ink-950/75 text-ink-300 opacity-0 group-hover:opacity-100 hover:text-ink-100'
              }`}
            >
              <Captions size={11} />
            </button>
          )
        )}
      </div>
    )
  }

  return (
    <div
      className="relative flex h-full flex-col"
      onDragEnter={(e) => {
        e.preventDefault()
        // "Drop to upload" is for files from the disk; a tile moved between folders is not an upload.
        if (moving.current !== null) return
        depth.current++
        setOver(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault()
        if (moving.current !== null) return
        depth.current--
        if (depth.current <= 0) setOver(false)
      }}
      onDrop={onDrop}
    >
      <div className="shrink-0 border-b border-ink-800 px-3 pb-2 pt-3">
        <BigButton
          icon={Upload}
          pressedIcon={Loader2}
          busy={picking}
          disabled={picking}
          onClick={() => void pick()}
          className="w-full"
        >
          Upload
        </BigButton>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-400">Media</div>
          {/* A folder is a name in the project, never one on disk: typed in place, under the last folder. */}
          <button
            type="button"
            data-pool-new-folder=""
            onClick={() => startNewFolder()}
            className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10.5px] text-ink-400 hover:bg-ink-800 hover:text-ink-100"
          >
            <FolderPlus size={11} />
            {NEW_FOLDER}
          </button>
        </div>
      </div>

      {project.assets.some((a) => a.kind !== 'image') && <SpeechModelPress />}

      {/*
        One bar for everything that is missing, with one button that fixes all
        of it. A project arrives from another machine with a hundred clips
        offline, and relinking them one at a time is not a feature anyone would
        use — so the folder case is the one the header offers.
      */}
      {offline.length > 0 && (
        <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-3 py-1.5">
          <FileWarning size={13} className="shrink-0 text-red-800" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-red-800">
            {offline.length} file{offline.length === 1 ? '' : 's'} missing
          </span>
          <button
            onClick={() => void relinkMedia()}
            className="flex shrink-0 items-center gap-1 rounded bg-red-500/20 px-1.5 py-0.5 text-[11px] text-red-800 hover:bg-red-500/30"
          >
            <Link2 size={11} /> Relink…
          </button>
        </div>
      )}

      <div
        data-pool-list=""
        onDragOver={overInto('')}
        onDrop={dropInto(null)}
        className={`flex-1 overflow-y-auto ${dropOn === '' && folders.length > 0 ? 'bg-accent-500/5' : ''}`}
      >
        {project.assets.length === 0 && folders.length === 0 && folderEdit === null ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
            <div className="text-xs text-ink-400">Drop your photos and clips here</div>
            <div className="text-[11px] leading-relaxed text-ink-600">
              or drop them straight onto the picture or a track
            </div>
          </div>
        ) : (
          <>
            {/* The files in no folder first, as the panel always showed them. */}
            {loose.length > 0 && (
              <div data-pool-loose="" className="grid grid-cols-3 gap-1.5 p-2">
                {loose.map(tile)}
              </div>
            )}
            {folders.map((folder) => {
              const files = project.assets.filter((a) => a.folder === folder)
              const shut = folded.includes(folder)
              const renaming = folderEdit !== null && folderEdit.from === folder
              return (
                <div
                  key={folder}
                  data-pool-folder={folder}
                  onDragOver={overInto(folder)}
                  onDrop={dropInto(folder)}
                  className={`border-t border-ink-800 ${dropOn === folder ? 'bg-accent-500/10' : ''}`}
                >
                  <div
                    data-pool-folder-header=""
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      openFolderMenu({ folder, x: e.clientX, y: e.clientY })
                    }}
                    className="flex items-center gap-1 px-1.5 pt-1.5"
                  >
                    <button
                      type="button"
                      data-pool-folder-fold=""
                      onClick={() => toggleFolder(folder)}
                      title={shut ? OPEN_FOLDER : FOLD_FOLDER}
                      className="shrink-0 rounded p-0.5 text-ink-500 hover:bg-ink-800 hover:text-ink-200"
                    >
                      <ChevronRight size={12} className={shut ? '' : 'rotate-90'} />
                    </button>
                    {renaming ? (
                      <FolderNameInput />
                    ) : (
                      <span
                        data-pool-folder-name=""
                        onDoubleClick={() => startRenameFolder(folder)}
                        className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink-300"
                      >
                        {folder}
                      </span>
                    )}
                    <span className="shrink-0 text-[10px] tabular-nums text-ink-500">{files.length}</span>
                    <button
                      type="button"
                      data-pool-folder-more=""
                      onClick={(e) => {
                        const box = e.currentTarget.getBoundingClientRect()
                        openFolderMenu({ folder, x: box.left, y: box.bottom })
                      }}
                      title={FOLDER_MENU_TITLE}
                      className="shrink-0 rounded p-0.5 text-ink-500 hover:bg-ink-800 hover:text-ink-200"
                    >
                      <MoreHorizontal size={12} />
                    </button>
                  </div>
                  {!shut &&
                    (files.length > 0 ? (
                      <div className="grid grid-cols-3 gap-1.5 p-2">{files.map(tile)}</div>
                    ) : (
                      <div data-pool-folder-empty="" className="px-3 pb-2 pt-1 text-[10.5px] leading-snug text-ink-600">
                        {FOLDER_EMPTY}
                      </div>
                    ))}
                </div>
              )
            })}
            {folderEdit !== null && folderEdit.from === null && (
              <div data-pool-folder-new="" className="flex items-start gap-1 border-t border-ink-800 px-2 py-1.5">
                <FolderPlus size={12} className="mt-1 shrink-0 text-ink-500" />
                <FolderNameInput />
              </div>
            )}
          </>
        )}
      </div>

      {menu && <PoolMenu target={menu} why={why} />}
      {folderMenu && <FolderMenu target={folderMenu} />}

      {over && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-ink-950/85">
          <div className="rounded-lg border-2 border-dashed border-accent-500 px-6 py-4 text-xs text-accent-400">
            Drop to upload
          </div>
        </div>
      )}
    </div>
  )
}
