import { type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

/**
 * A fold-down list: one button saying what it chooses and what is chosen,
 * with a chevron, and under it — IN THE FLOW, pushing what is below down —
 * the choices as a row of buttons that wraps.
 *
 * The user's sketch calls it "collapsable" (2026-11-27): the URL tile's
 * quality and format under the chosen kind, and Best clips' "Duration". Never
 * a floating menu: a floating menu is one more thing that can cover another,
 * and covering was the complaint ("its own custom setting is overlapping").
 *
 * Choosing folds it, and so does Escape anywhere inside it; the button opens
 * and folds it too. A choice or Escape puts the keyboard back on the button. Every part is a real button, so it is reached and pressed
 * from the keyboard. `aria-expanded` on the button says whether the choices
 * are showing, and `aria-pressed` on each choice which one is chosen.
 *
 * Its open state is passed in (`open`, `onOpenChange`), as the strips' is
 * (ui/Strip.tsx): no hook of its own, so a test calls it as a function and
 * presses its buttons by their handlers, and its owner decides whether it
 * survives a re-render. Flat, and no transform, filter or backdrop-filter —
 * the chevron is two glyphs, not one rotated (Strip.tsx says why).
 */
/**
 * Puts the keyboard back on the list's own button before the list goes: a
 * choice or Escape unmounts the button that has focus, and focus would fall to
 * the page, so the next Tab would start again at the top of the window. Read
 * from the event, not a ref, so the list still has no hook of its own.
 */
function refocus(event: { currentTarget?: unknown }): void {
  const at = event.currentTarget as HTMLElement | null | undefined
  at?.closest?.('[data-fold-down]')?.querySelector<HTMLButtonElement>(':scope > button[aria-expanded]')?.focus()
}

export interface FoldDownChoice<T extends string | number> {
  value: T
  /** As it is shown, on the choice and on the folded button. */
  label: string
  title?: string
}

export function FoldDown<T extends string | number>({
  id,
  label,
  value,
  choices,
  open,
  onOpenChange,
  onChoose,
  title,
  disabled,
  choiceData
}: {
  /** Names it for the harness (`data-fold-down`) and ties the button to its list (`aria-controls`). */
  id: string
  /** What it chooses, as shown on the button: "Duration". */
  label: string
  /** The chosen value; its choice's label is shown beside `label`. */
  value: T
  choices: readonly FoldDownChoice<T>[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onChoose: (value: T) => void
  /** The button's tooltip. */
  title?: string
  disabled?: boolean
  /**
   * A data attribute every choice carries with its own value, for the owner's
   * tests and the harness: Best clips' lengths keep the `data-best-length`
   * their four buttons carried before they folded into this list.
   */
  choiceData?: `data-${string}`
}): ReactNode {
  const chosen = choices.find((choice) => choice.value === value)
  const list = `fold-down-${id}`
  const Chevron = open ? ChevronUp : ChevronDown

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!open || event.key !== 'Escape') return
    // Folds this list only: the window's own Escape (leaving full screen) is not also run.
    event.stopPropagation()
    refocus(event)
    onOpenChange(false)
  }

  return (
    <div data-fold-down={id} data-open={open} onKeyDown={onKeyDown} className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={list}
        title={title}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        className="flex w-full min-w-0 items-center gap-1.5 rounded border border-ink-800 px-2 py-1 text-left text-[11px] transition-colors hover:bg-ink-850 disabled:opacity-40"
      >
        <span className="shrink-0 text-ink-500">{label}</span>
        {chosen && <span className="min-w-0 flex-1 break-words text-ink-200">{chosen.label}</span>}
        <Chevron size={12} className="ml-auto shrink-0 text-ink-500" />
      </button>
      {open && (
        <div id={list} role="group" aria-label={label} className="mt-1 flex flex-wrap gap-1">
          {choices.map((choice) => (
            <button
              key={String(choice.value)}
              {...(choiceData ? { [choiceData]: String(choice.value) } : {})}
              type="button"
              aria-pressed={choice.value === value}
              title={choice.title}
              onClick={(event) => {
                onChoose(choice.value)
                refocus(event)
                onOpenChange(false)
              }}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                choice.value === value
                  ? 'bg-accent-900 text-accent-400'
                  : 'text-ink-400 hover:bg-ink-850 hover:text-ink-200'
              }`}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
