import { describe, expect, it } from 'vitest'
import { EMPTY_MENU_STATE, editSubmenu, textContextMenu, type MenuCommand } from '../src/main/menu'
import { isTextEntry } from '../src/shared/textEntry'

/*
 * Cut, Copy, Paste and Select All in a text box (2026-11-25).
 *
 * The owner could not paste a link into the URL box: the Edit menu sent every
 * Cmd+V to the timeline's clipboard, whatever had the keyboard, and there was
 * no right-click menu for text at all. These hold the three parts of the fix:
 * what counts as a text box, the Edit menu's two meanings, and the right-click
 * menu.
 */

/** A `send` that records what a click would send, so a role (which sends nothing) can be told from an item. */
function spy(): { send: (command: MenuCommand) => () => void; sent: MenuCommand[] } {
  const sent: MenuCommand[] = []
  return { send: (command) => () => void sent.push(command), sent }
}

type Item = { role?: string; label?: string; accelerator?: string; enabled?: boolean; click?: () => void; type?: string }

/** Every way an item could claim a key: its own accelerator, or a role's built-in one. */
const claims = (items: Item[], accelerator: string): Item[] => items.filter((i) => i.accelerator === accelerator)

describe('what counts as a text box', () => {
  it('counts the boxes text is typed into', () => {
    expect(isTextEntry({ tagName: 'INPUT', type: 'text' })).toBe(true)
    expect(isTextEntry({ tagName: 'INPUT', type: 'url' })).toBe(true)
    expect(isTextEntry({ tagName: 'INPUT', type: 'search' })).toBe(true)
    expect(isTextEntry({ tagName: 'INPUT', type: 'number' })).toBe(true)
    // An <input> with no type attribute is a text box: its `type` reads 'text', and a bare object's is absent.
    expect(isTextEntry({ tagName: 'INPUT' })).toBe(true)
    expect(isTextEntry({ tagName: 'input', type: 'TEXT' })).toBe(true)
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    // Read-only still has text to copy and select.
    expect(isTextEntry({ tagName: 'INPUT', type: 'text', readOnly: true })).toBe(true)
  })

  it('does not count the inputs that take no text, so Copy on a focused slider still copies the clip', () => {
    for (const type of ['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit']) {
      expect(isTextEntry({ tagName: 'INPUT', type }), type).toBe(false)
    }
    expect(isTextEntry({ tagName: 'SELECT' })).toBe(false)
    expect(isTextEntry({ tagName: 'BUTTON' })).toBe(false)
    expect(isTextEntry({ tagName: 'DIV' })).toBe(false)
    expect(isTextEntry({ tagName: 'BODY' })).toBe(false)
  })

  it('does not count a disabled box, and takes anything without throwing', () => {
    expect(isTextEntry({ tagName: 'INPUT', type: 'text', disabled: true })).toBe(false)
    expect(isTextEntry({ tagName: 'TEXTAREA', disabled: true })).toBe(false)
    expect(isTextEntry(null)).toBe(false)
    expect(isTextEntry(undefined)).toBe(false)
    expect(isTextEntry('INPUT')).toBe(false)
    expect(isTextEntry({})).toBe(false)
  })
})

describe('the Edit menu, with the keyboard in a text box', () => {
  it('gives Cut, Copy, Paste, Delete and Select All to the text, by role, and sends the timeline nothing', () => {
    const { send, sent } = spy()
    const items = editSubmenu({ ...EMPTY_MENU_STATE, textFocus: true, hasSelection: true }, send) as Item[]
    for (const role of ['cut', 'copy', 'paste', 'delete', 'selectAll']) {
      const mine = items.filter((i) => i.role === role)
      expect(mine, role).toHaveLength(1)
      // A role with a click of its own would send the timeline its command as well.
      expect(mine[0].click, role).toBeUndefined()
    }
    // No plain item is left holding one of the text's keys: it would take the key before the role.
    for (const key of ['CmdOrCtrl+X', 'CmdOrCtrl+C', 'CmdOrCtrl+V', 'CmdOrCtrl+A', 'Delete']) {
      expect(claims(items, key), key).toEqual([])
    }
    // Whatever is clicked, no clip is cut, copied, pasted, deleted or selected.
    for (const i of items) if (i.label !== 'Undo' && i.label !== 'Redo' && i.label !== 'Duplicate') i.click?.()
    expect(sent).toEqual([])
  })

  it('leaves Undo and Redo the project’s: a number box keeps the keyboard after a drag', () => {
    const { send, sent } = spy()
    const items = editSubmenu({ ...EMPTY_MENU_STATE, textFocus: true, canUndo: true, canRedo: true }, send) as Item[]
    const undo = claims(items, 'CmdOrCtrl+Z')
    const redo = claims(items, 'CmdOrCtrl+Shift+Z')
    expect(undo).toHaveLength(1)
    expect(redo).toHaveLength(1)
    undo[0].click?.()
    redo[0].click?.()
    expect(sent).toEqual(['undo', 'redo'])
    expect(items.some((i) => i.role === 'undo' || i.role === 'redo')).toBe(false)
  })
})

describe('the Edit menu, with the keyboard on the timeline', () => {
  it('sends Cut, Copy, Paste, Delete and Select All to the store, and uses no text role', () => {
    const { send, sent } = spy()
    const items = editSubmenu({ ...EMPTY_MENU_STATE, hasSelection: true }, send) as Item[]
    expect(items.some((i) => i.role !== undefined)).toBe(false)
    const press = (key: string): void => {
      const mine = claims(items, key)
      expect(mine, key).toHaveLength(1)
      mine[0].click?.()
    }
    press('CmdOrCtrl+X')
    press('CmdOrCtrl+C')
    press('CmdOrCtrl+V')
    press('Delete')
    press('CmdOrCtrl+A')
    expect(sent).toEqual(['cut', 'copy', 'paste', 'delete', 'selectAll'])
  })

  it('greys Cut, Copy and Delete with nothing selected, and never Paste or Select All', () => {
    const items = editSubmenu(EMPTY_MENU_STATE, spy().send) as Item[]
    expect(claims(items, 'CmdOrCtrl+X')[0].enabled).toBe(false)
    expect(claims(items, 'CmdOrCtrl+C')[0].enabled).toBe(false)
    expect(claims(items, 'Delete')[0].enabled).toBe(false)
    expect(claims(items, 'CmdOrCtrl+V')[0].enabled).toBeUndefined()
    expect(claims(items, 'CmdOrCtrl+A')[0].enabled).toBeUndefined()
  })
})

describe('the right-click menu for text', () => {
  const flags = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true }

  it('offers Cut, Copy, Paste and Select All in a text box, each enabled as the box says', () => {
    const items = textContextMenu({ isEditable: true, selectionText: '', editFlags: { ...flags, canCut: false, canCopy: false } }) as Item[]
    const roles = items.filter((i) => i.role).map((i) => [i.role, i.enabled])
    expect(roles).toEqual([
      ['cut', false],
      ['copy', false],
      ['paste', true],
      ['selectAll', true]
    ])
  })

  it('offers Copy alone on selected text that is not in a box', () => {
    const items = textContextMenu({ isEditable: false, selectionText: 'a line of a note', editFlags: flags }) as Item[]
    expect(items.map((i) => i.role)).toEqual(['copy'])
  })

  it('shows nothing anywhere else, so the page’s own menus are the only ones there', () => {
    expect(textContextMenu({ isEditable: false, selectionText: '', editFlags: flags })).toBeNull()
    expect(textContextMenu({ isEditable: false, selectionText: '  \n ', editFlags: flags })).toBeNull()
  })
})
