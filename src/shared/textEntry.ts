/**
 * Whether the focused element is somewhere text is typed: a text box, a number
 * box, a multi-line box, or anything editable in place.
 *
 * The Edit menu asks. Cut, Copy, Paste and Select All mean the CLIPS when the
 * timeline has the keyboard, and the TEXT when a box does; main cannot see
 * which, so the renderer reports this with the rest of the menu's state
 * (`App.tsx`, `main/menu.ts` `editSubmenu`). Before it did, Cmd+V in the URL
 * box went to the timeline's clipboard and pasted nothing, on macOS every
 * time: there, an editing key reaches a text box only through the menu.
 *
 * A checkbox, a slider, a colour well, a file picker and a button are inputs
 * and not text: Cmd+C on a focused slider still copies the selected clip.
 * A disabled box takes no text. A read-only one still gives Copy and Select
 * All something to act on, so it counts.
 *
 * Takes anything, as `fullScreen.ts`'s check does: `document.activeElement`
 * may be null, the body, or an element from another realm.
 */

const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(['', 'text', 'search', 'url', 'email', 'tel', 'password', 'number'])

export function isTextEntry(target: unknown): boolean {
  const el = (target ?? {}) as { tagName?: unknown; type?: unknown; isContentEditable?: unknown; disabled?: unknown }
  if (el.isContentEditable === true) return true
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : ''
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false
  if (el.disabled === true) return false
  if (tag === 'TEXTAREA') return true
  const type = typeof el.type === 'string' ? el.type.toLowerCase() : ''
  return TEXT_INPUT_TYPES.has(type)
}
