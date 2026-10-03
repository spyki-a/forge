import { type ReactNode } from 'react'

/**
 * A collapsible strip of the left column: OUTPUT and EXPORT (docs/WINDOW.md
 * §2, §3.16, §3.17; the user's sheet 19: "two collapsible strips with a
 * triangle").
 *
 * A header row — the triangle and the name, which open and close it, then
 * whatever the strip keeps in reach while closed (`aside`: EXPORT's button and
 * its running job) — over a body.
 *
 * **Closing hides the body; it never unmounts it.** The export flow and the
 * File › Export listener have to run with EXPORT shut (§3.17), and the surest
 * way to keep that true while the strip changes is that nothing in it ever
 * leaves the tree. It also keeps the launch behaviour the always-mounted
 * Inspector had: ExportSettings asks which encoders work when it mounts, at
 * startup, not on the first open. So the body is always rendered and a class
 * hides it, and `data-open` says which face is showing (the harness census
 * reads it, src/renderer/src/harness/census.ts).
 *
 * Flat: neumorphism is for tiles and big buttons only (§2 "Style"). And no
 * transform, filter or backdrop-filter here or on anything in it that holds
 * an overlay: OUTPUT hosts the caption font picker and the style gallery,
 * which are `fixed inset-0`, and any of those would become their containing
 * block and trap them inside the strip. That is also why the triangle is two
 * drawn shapes rather than one rotated glyph.
 *
 * The header row is 28 px, border included (`h-7`), open or closed: WINDOW.md
 * §2 budgets two closed strips at 56 px, and App.tsx's left column subtracts
 * exactly that from the floor it keeps for the left panel, so both headers
 * always fit. Open, a strip takes an even share of what the left panel leaves
 * (`flex-1`, so two open strips split it rather than the longer one taking
 * nearly all of it), never less than its header, and its body scrolls; closed,
 * it is its header whatever else wants the room.
 */
export function Strip({
  id,
  name,
  open,
  onToggle,
  showTitle,
  hideTitle,
  summary,
  aside,
  children
}: {
  /** The census and the header's aria-controls use it: `data-strip="output"`. */
  id: string
  /** The header's word, as it is shown. */
  name: string
  open: boolean
  onToggle: () => void
  /** The toggle's tooltip while closed, and while open. */
  showTitle: string
  hideTitle: string
  /** One line beside the name, shown while closed: what the strip would show you. */
  summary?: ReactNode
  /** Beside the toggle, open or closed. */
  aside?: ReactNode
  children: ReactNode
}): ReactNode {
  const bodyId = `strip-${id}-body`
  return (
    <section
      data-strip={id}
      data-open={open ? 'true' : 'false'}
      className={`flex flex-col ${open ? 'min-h-7 flex-1' : 'shrink-0'}`}
    >
      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-ink-800 px-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          title={open ? hideTitle : showTitle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded py-0.5 text-left leading-4 text-ink-400 hover:text-ink-200"
        >
          <svg viewBox="0 0 10 10" className="size-2.5 shrink-0" aria-hidden>
            <path d={open ? 'M1 2.5h8L5 8z' : 'M2.5 1v8L8 5z'} fill="currentColor" />
          </svg>
          <span className="shrink-0 text-[11px] font-medium tracking-wide">{name}</span>
          {!open && summary !== undefined && (
            <span className="min-w-0 truncate text-[10.5px] tabular-nums text-ink-600">{summary}</span>
          )}
        </button>
        {aside}
      </div>
      <div id={bodyId} data-strip-body className={open ? 'min-h-0 flex-1 overflow-y-auto' : 'hidden'}>
        {children}
      </div>
    </section>
  )
}
