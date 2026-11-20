import { useEffect, useState, type ReactNode } from 'react'
import { ChevronRight, Check } from 'lucide-react'

/**
 * The app's right-click menu, as pieces: the shell that sits at the pointer
 * and closes itself, an item, a submenu and a divider. The clip's menu
 * (ClipMenu.tsx) was the only one and these were its own; the Upload panel's
 * tile menu (PoolMenu in MediaPool.tsx) is the second, so they live here and both use them.
 */

/** A menu's width; a submenu's, opened to its right. */
export const MENU_WIDTH = 196
export const SUBMENU_WIDTH = 210

export function MenuItem({
  label,
  keys,
  onClick,
  danger,
  ticked,
  disabled,
  title,
  data
}: {
  label: string
  keys?: string
  onClick: () => void
  danger?: boolean
  ticked?: boolean
  /** Greyed, with `title` saying why. */
  disabled?: boolean
  title?: string
  /** A `data-*` attribute for the harness to find the item by (name without the `data-` prefix, and its value). */
  data?: [string, string]
}): ReactNode {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      {...(data ? { [`data-${data[0]}`]: data[1] } : {})}
      className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-ink-700 disabled:opacity-40 disabled:hover:bg-transparent ${
        danger ? 'text-red-800 hover:text-red-900' : 'text-ink-200'
      }`}
    >
      <span className="flex items-center gap-1.5">
        {ticked !== undefined && (
          <Check size={11} className={ticked ? 'text-accent-400' : 'opacity-0'} />
        )}
        {label}
      </span>
      {keys && <span className="text-[10px] tabular-nums text-ink-500">{keys}</span>}
    </button>
  )
}

export function MenuDivider(): ReactNode {
  return <div className="my-1 h-px bg-ink-700" />
}

/**
 * A submenu that opens on hover and stays open while the pointer is inside it.
 *
 * Opened on hover rather than on click because these are lists to browse —
 * speeds, voices, looks — and clicking to open a list you are about to click
 * again is one press too many for something used this often.
 */
export function Submenu({
  label,
  detail,
  data,
  children
}: {
  label: string
  detail?: string
  /** A `data-*` attribute on its button, for the harness (name without the prefix, and its value). */
  data?: [string, string]
  children: ReactNode
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="relative"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      <button
        {...(data ? { [`data-${data[0]}`]: data[1] } : {})}
        className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[12px] text-ink-200 transition-colors hover:bg-ink-700"
      >
        <span>{label}</span>
        <span className="flex items-center gap-1 text-[10px] text-ink-500">
          {detail}
          <ChevronRight size={12} />
        </span>
      </button>
      {open && (
        <div
          style={{ width: SUBMENU_WIDTH }}
          className="absolute -top-1 left-full z-10 max-h-[320px] overflow-y-auto rounded-md border border-ink-700 bg-ink-800 py-1 shadow-xl shadow-black/40"
        >
          {children}
        </div>
      )}
    </div>
  )
}

/**
 * Where a menu opened at (x, y) goes so that `room` of it stays inside the
 * window: flipped back from the right and bottom edges, never past the top or
 * the left. `room` is what the menu may need — its width plus a submenu's,
 * and its tallest face — rather than what it measures, so a submenu opened
 * later is not pushed off the window either.
 */
export function menuPosition(
  x: number,
  y: number,
  room: { width: number; height: number },
  view: { width: number; height: number }
): { left: number; top: number } {
  return {
    left: Math.max(8, Math.min(x, view.width - room.width - 12)),
    top: Math.min(y, Math.max(8, view.height - room.height))
  }
}

/**
 * A menu closes on Escape or on a pointerdown anywhere outside it. On
 * `pointerdown` rather than `click` so the menu is gone before the thing
 * underneath reacts. Called by the menu itself, before anything it returns
 * early on, so a menu whose subject has gone still closes.
 */
export function useMenuDismiss(onClose: () => void): void {
  useEffect(() => {
    const away = (): void => onClose()
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // Handled: closing the menu must not also leave full screen.
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])
}

/** How long after a menu's item is pressed the second press of a double-click is still swallowed. */
export const SECOND_CLICK_MS = 1000

/**
 * A double-click on a menu item must stop at the item. Its first click runs
 * the item and the menu closes (or turns into a question) at once, so the
 * second press lands on whatever is now under the pointer: a pool tile, whose
 * double-click adds a clip, or the question's own "Remove it and its N
 * clips". Chromium counts that press as the double-click's second (its click
 * carries `detail` 2, then a `dblclick` follows), so for a moment after an
 * item is pressed, a window listener in the CAPTURE phase stops exactly those
 * two before any element sees them. A fresh single click (`detail` 1) passes.
 */
export function swallowSecondClick(ms = SECOND_CLICK_MS): void {
  const stop = (e: Event): void => {
    if (e.type !== 'dblclick' && ((e as MouseEvent).detail ?? 0) < 2) return
    e.preventDefault()
    e.stopImmediatePropagation()
    e.stopPropagation()
    if (e.type === 'dblclick') done()
  }
  const done = (): void => {
    clearTimeout(timer)
    window.removeEventListener('click', stop, true)
    window.removeEventListener('dblclick', stop, true)
  }
  const timer = setTimeout(done, ms)
  window.addEventListener('click', stop, true)
  window.addEventListener('dblclick', stop, true)
}

/**
 * The shell: fixed at the pointer and inside the window. Its own pointerdown
 * stops there, so `useMenuDismiss` does not close it under its own items.
 */
export function MenuShell({
  x,
  y,
  room,
  width = MENU_WIDTH,
  data,
  children
}: {
  x: number
  y: number
  room: { width: number; height: number }
  width?: number
  /** A `data-*` attribute for the harness (name without the prefix, and its value). */
  data?: [string, string]
  children: ReactNode
}): ReactNode {
  const { left, top } = menuPosition(x, y, room, { width: window.innerWidth, height: window.innerHeight })
  return (
    <div
      style={{ left, top, width }}
      {...(data ? { [`data-${data[0]}`]: data[1] } : {})}
      // Its own pointerdown must not reach `useMenuDismiss`'s window listener,
      // or the menu would close before any item could be chosen.
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed z-50 rounded-md border border-ink-700 bg-ink-800 py-1 shadow-xl shadow-black/40"
    >
      {children}
    </div>
  )
}
