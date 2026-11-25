import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

/**
 * The application menu.
 *
 * There was none — not a stub, not a default: no `Menu` anywhere in the main
 * process, so on Windows the app had no menu bar at all and on macOS it had
 * Electron's placeholder. Save and Open were bare hotkeys in the renderer, so
 * the only way to learn that either existed was to be told.
 *
 * A menu is the cheapest documentation an app has. Every item here already
 * worked; what was missing was any way to find it.
 *
 * **Everything routes through one channel.** Items send `menu:command` with a
 * name and the renderer dispatches to the store, rather than each item reaching
 * into the main process for a different piece of the editor. The renderer is
 * where the project lives; the menu is a remote control, and a remote control
 * with its own copy of the state is a remote control that disagrees with the
 * screen.
 */

export type MenuCommand =
  | 'new'
  | 'open'
  | 'save'
  | 'saveAs'
  | 'export'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'delete'
  | 'selectAll'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomFit'
  | 'shortcuts'
  /** Not a menu item: the close guard sends it to keep a take in progress. */
  | 'stopRecording'

/** What the renderer tells us, so items can enable and disable correctly. */
export interface MenuState {
  canUndo: boolean
  canRedo: boolean
  hasSelection: boolean
  dirty: boolean
  /** A voice-over is counting in, recording, or being saved. */
  recording: boolean
  /** The keyboard is in a text box (`shared/textEntry.ts`): Cut, Copy, Paste and Select All are the text's. */
  textFocus: boolean
}

export const EMPTY_MENU_STATE: MenuState = {
  canUndo: false,
  canRedo: false,
  hasSelection: false,
  dirty: false,
  recording: false,
  textFocus: false
}

/**
 * Whether closing the window has to ask anything first.
 *
 * Unsaved changes, and a take in progress. The guard used to ask only about
 * the first, so closing the window — or Cmd+Q — mid-take tore the renderer
 * down with the microphone open and the take went with it: never saved, never
 * placed, not even a file in the voice-over folder. And a take in progress is
 * the one time the project is often NOT dirty yet, because the take lands on
 * the timeline only when it stops. Found by the B1 review.
 *
 * The take is asked about FIRST, because stopping it is what makes the project
 * dirty; asked the other way round, "Save" would save an edit without the take.
 */
export function mustAskBeforeClosing(state: MenuState): boolean {
  return state.recording || state.dirty
}

/**
 * The Edit menu's items.
 *
 * Cut, Copy, Paste, Delete and Select All have TWO meanings, and the keyboard's
 * owner decides which:
 *
 * - the timeline (`textFocus` false): the store's. Pressing Copy with a clip
 *   selected has to copy the CLIP, and only the store knows what is selected,
 *   so these are plain items that send a command.
 * - a text box (`textFocus` true): the text's, by Electron's ROLES, which act
 *   on the focused field and enable themselves from it.
 *
 * They used to be the first kind always, on the reasoning that "the store
 * decides which is meant". The store never did: it has no idea a text box
 * exists. So Cmd+V in the URL box asked the timeline to paste its clips, and
 * the link on the clipboard went nowhere; on macOS that was every paste,
 * because an editing key reaches a text box only through this menu. The same
 * for Cmd+A (it selected every clip while a link was half typed) and for the
 * forward Delete key (it deleted the selected clips from inside a text box).
 *
 * Undo and Redo stay the project's in both cases: a number box in the Trimmer
 * keeps the keyboard after a drag, and Cmd+Z there has to undo the edit.
 *
 * Pure (no `Menu`), so a test can read it.
 */
export function editSubmenu(
  state: MenuState,
  send: (command: MenuCommand) => () => void
): MenuItemConstructorOptions[] {
  const text = state.textFocus
  return [
    {
      label: 'Undo',
      accelerator: 'CmdOrCtrl+Z',
      enabled: state.canUndo,
      click: send('undo')
    },
    {
      label: 'Redo',
      accelerator: 'CmdOrCtrl+Shift+Z',
      enabled: state.canRedo,
      click: send('redo')
    },
    { type: 'separator' },
    text
      ? { role: 'cut' }
      : {
          label: 'Cut',
          accelerator: 'CmdOrCtrl+X',
          enabled: state.hasSelection,
          click: send('cut')
        },
    text
      ? { role: 'copy' }
      : {
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          enabled: state.hasSelection,
          click: send('copy')
        },
    text ? { role: 'paste' } : { label: 'Paste', accelerator: 'CmdOrCtrl+V', click: send('paste') },
    {
      label: 'Duplicate',
      accelerator: 'CmdOrCtrl+D',
      enabled: state.hasSelection,
      click: send('duplicate')
    },
    // No accelerator on the text's: the key itself already deletes in a text box.
    text
      ? { role: 'delete' }
      : {
          label: 'Delete',
          accelerator: 'Delete',
          enabled: state.hasSelection,
          click: send('delete')
        },
    { type: 'separator' },
    text ? { role: 'selectAll' } : { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: send('selectAll') }
  ]
}

/** What a right-click told us about the spot (Electron's `context-menu` params, the part read here). */
export interface TextContextParams {
  isEditable: boolean
  selectionText: string
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean }
}

/**
 * The right-click menu for text: Cut, Copy, Paste and Select All in a text
 * box, Copy alone on selected text elsewhere, and null (no menu) anywhere
 * else. There was none at all: Electron shows no menu of its own, so a
 * right-click in the URL box did nothing and a link could not be pasted with
 * the mouse.
 *
 * The app's own right-click menus (a tile in the Upload tile, a clip on the
 * timeline) are drawn by the page and cancel the event, so this is never
 * asked about them.
 *
 * Pure, so a test can read it.
 */
export function textContextMenu(params: TextContextParams): MenuItemConstructorOptions[] | null {
  const flags = params.editFlags
  if (params.isEditable) {
    return [
      { role: 'cut', enabled: flags.canCut },
      { role: 'copy', enabled: flags.canCopy },
      { role: 'paste', enabled: flags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: flags.canSelectAll }
    ]
  }
  if (params.selectionText.trim().length > 0) return [{ role: 'copy', enabled: flags.canCopy }]
  return null
}

/** Show `textContextMenu` on a right-click in `window`. */
export function installTextContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, params) => {
    const items = textContextMenu(params)
    if (items) Menu.buildFromTemplate(items).popup({ window })
  })
}

export function buildMenu(
  window: BrowserWindow | null,
  state: MenuState,
  recents: string[] = []
): Menu {
  const send = (command: MenuCommand) => (): void => {
    window?.webContents.send('menu:command', command)
  }

  const isMac = process.platform === 'darwin'

  /*
   * Recent projects, from our own list rather than the OS's.
   *
   * macOS has a native recent-documents menu and Windows has a jump list;
   * neither is readable back as a list to build a submenu from, so the app
   * keeps its own. `app.addRecentDocument` is still called on save and open, so
   * the OS lists work too.
   */
  const recentItems: MenuItemConstructorOptions[] =
    recents.length === 0
      ? [{ label: 'Nothing yet', enabled: false }]
      : recents.slice(0, 10).map((path) => ({
          label: path.split(/[\\/]/).pop() ?? path,
          toolTip: path,
          click: () => window?.webContents.send('menu:open', path)
        }))

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.getName(),
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project…', accelerator: 'CmdOrCtrl+N', click: send('new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { label: 'Open Recent', submenu: recentItems },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('saveAs') },
        { type: 'separator' },
        { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: send('export') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { label: 'Edit', submenu: editSubmenu(state, send) },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: send('zoomIn') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: send('zoomOut') },
        { label: 'Zoom to Fit', accelerator: 'Shift+Z', click: send('zoomFit') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        // Kept because this app's hardest bugs are in the renderer and the
        // console is where they are read.
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: send('shortcuts') },
        {
          label: 'Report an Issue',
          click: () => void shell.openExternal('https://github.com/spyki-a/forge/issues')
        }
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}

export function applyMenu(
  window: BrowserWindow | null,
  state: MenuState,
  recents: string[] = []
): void {
  Menu.setApplicationMenu(buildMenu(window, state, recents))
}
