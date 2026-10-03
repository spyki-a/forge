import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'

/**
 * The tool tile and the big button — the only raised things in the window.
 *
 * Neumorphism, kept to these two (docs/WINDOW.md §2 "Style"): a tile is the
 * colour of the cream it sits on and is lifted off it by a soft white highlight
 * top left and a warm shade bottom right (the shadow tokens in styles.css). The
 * timeline, the waveform and the preview stay flat.
 *
 * PRESSED changes three things together, never the shadow alone — an inset
 * shadow by itself is a state you have to squint for, and on cream the shade is
 * 1.5:1 at its darkest:
 *   1. colour: a pale blue body, darker label, blue icon;
 *   2. the icon itself: `pressedIcon` when given, otherwise the same glyph drawn
 *      heavier with a blue dot in the corner;
 *   3. the shadow: raised becomes pressed (inset).
 * A momentary press (:active) changes only the colour, and a disabled tile goes
 * flat, which is how "unavailable" reads on a raised surface.
 *
 * No transform, filter or backdrop-filter, here or on anything that holds a
 * tile: any of them makes a containing block for the app's `fixed inset-0`
 * overlays (the font picker, the text style sheet) and traps them in a strip.
 * So nothing scales or nudges on press; the light does the moving.
 *
 * The shadows reach 14 px (4 offset + 10 blur): a grid of tiles inside anything
 * overflow-hidden needs at least that much padding, and gaps of 12 px or more.
 * The icon-only `xs` tile throws the same light at its own scale
 * (`shadow-raised-xs`, about 6 px), or its neighbours two pixels away would be
 * lost in its shade.
 */

/**
 * The class sets for each state, exported so a test can hold them apart. The
 * raised shadow is the size's (`TILE_SIZE`), the same light at each scale; the
 * pressed one is the same inset at every size.
 */
export const TILE_LOOK = {
  idle: {
    surface: 'bg-ink-950 active:bg-ink-850',
    label: 'text-ink-300 group-hover:text-ink-100',
    icon: 'text-ink-400'
  },
  pressed: {
    surface: 'bg-accent-900 shadow-pressed',
    label: 'text-ink-200 group-hover:text-ink-100',
    icon: 'text-accent-400'
  }
} as const

export const BIG_BUTTON_LOOK = {
  primary: {
    idle: 'bg-accent-500 text-ink-950 shadow-raised-sm hover:bg-accent-400',
    pressed: 'bg-accent-300 text-ink-950 shadow-pressed'
  },
  secondary: {
    idle: 'bg-ink-950 text-ink-200 shadow-raised-sm hover:text-ink-100 active:bg-ink-850',
    pressed: 'bg-accent-900 text-ink-200 shadow-pressed'
  }
} as const

/** Drawn heavier when pressed without a glyph of its own. */
const PRESSED_STROKE = 2.25

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-pressed'>

/**
 * The glyph for a state. With no `pressedIcon`, pressed is the same glyph at a
 * heavier stroke with a dot badge — still a different picture, not just a
 * different shadow.
 */
function Glyph({
  icon: Icon,
  pressedIcon: PressedIcon,
  pressed,
  size,
  className,
  badge = 'bg-accent-500',
  dot = 'right-1.5 top-1.5 size-1.5'
}: {
  icon: LucideIcon
  pressedIcon?: LucideIcon
  pressed: boolean
  size: number
  className: string
  /** The dot's colour: blue on the pale pressed body, cream on a blue one. */
  badge?: string
  /** Where the dot sits and how big it is: tucked into the corner on the icon-only tile. */
  dot?: string
}): ReactNode {
  if (!pressed) return <Icon size={size} className={className} aria-hidden />
  if (PressedIcon) return <PressedIcon size={size} className={className} aria-hidden />
  return (
    <>
      <Icon size={size} strokeWidth={PRESSED_STROKE} className={className} aria-hidden />
      <span data-pressed-badge className={`absolute ${dot} rounded-full ${badge}`} aria-hidden />
    </>
  )
}

/** The tooltip of a tile's busy badge (`busy`). */
export const BUSY_TITLE = 'Working on it'

/**
 * A tile's sizes. `sm` is the Shelf's home grid (shelf/Shelf.tsx): three
 * tiles to a row in the 240 px column are about 62 px square, and at the
 * default size the sketch's longer names — "Beat sync / Cut to words",
 * "Newspaper clipping" — would be cut off, so the small one has less padding,
 * a smaller label and room for a third line.
 *
 * `xs` is the strip an open tool folds the home grid into (step 11): ten to a
 * row, about 20 px square in the 240 px column and never more than 24 px
 * (`max-w-6`), the ICON ONLY — its label is its accessible name and its
 * tooltip, never drawn — with its own smaller shadow, rounding, pressed dot and
 * busy badge, each scaled to a box a third the size of `sm`'s.
 *
 * A size rather than classes passed in, for BigButton's reason: two paddings
 * (or two shadows) on one element are settled by the stylesheet's order, not
 * the class string's.
 */
const TILE_SIZE = {
  md: {
    box: 'aspect-square w-full flex-col gap-1 rounded-xl p-1.5',
    raised: 'shadow-raised',
    icon: 18,
    iconHover: '',
    label: 'line-clamp-2 text-[10.5px] leading-tight',
    dot: undefined,
    busy: { at: 'left-1 top-1', size: 10 }
  },
  sm: {
    box: 'aspect-square w-full flex-col gap-0.5 rounded-xl p-1',
    raised: 'shadow-raised',
    icon: 16,
    iconHover: '',
    label: 'line-clamp-3 text-[9.5px] leading-[1.15]',
    dot: undefined,
    busy: { at: 'left-1 top-1', size: 10 }
  },
  xs: {
    box: 'aspect-square w-full max-w-6 rounded-md',
    raised: 'shadow-raised-xs',
    icon: 12,
    // With no label to darken on hover, the glyph does it.
    iconHover: 'group-hover:text-ink-200',
    label: null,
    dot: 'right-[3px] top-[3px] size-1',
    busy: { at: '-left-0.5 -top-0.5 rounded-full bg-ink-950', size: 9 }
  }
} as const

export interface TileProps extends ButtonProps {
  icon: LucideIcon
  /** The glyph to show while pressed. Without it, the icon is drawn heavier with a dot. */
  pressedIcon?: LucideIcon
  /** Drawn under the icon — or, on the icon-only `xs` tile, the button's accessible name. */
  label: string
  /**
   * For a tile that toggles — the strip's tiles, one per tool, the open one
   * pressed — and then it always says which (`aria-pressed`). Leave it out on
   * a tile that only goes somewhere, like the home grid's: a plain button,
   * which says nothing about being pressed.
   */
  pressed?: boolean
  /** A second, smaller line under the label: "soon" on a tool that is not built yet. Not drawn at `xs`. */
  note?: string
  /**
   * Something is under way in this tool — a build, a download, a transcription:
   * a small spinning badge in the top-left corner, with its own tooltip, so a
   * run started inside a tool stays visible from the grid.
   */
  busy?: boolean
  size?: 'md' | 'sm' | 'xs'
}

export function Tile({
  icon,
  pressedIcon,
  label,
  pressed,
  note,
  busy = false,
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: TileProps): ReactNode {
  const down = pressed === true
  const look = down ? TILE_LOOK.pressed : TILE_LOOK.idle
  const measure = TILE_SIZE[size]
  // The icon-only tile: the label is what a screen reader says and, unless the
  // caller gives one, what the tooltip says.
  const named = measure.label === null ? { 'aria-label': label, title: rest.title ?? label } : {}
  return (
    <button
      {...rest}
      {...named}
      type={type}
      aria-pressed={pressed}
      className={`group relative flex items-center justify-center ${measure.box} disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ${look.surface} ${down ? '' : measure.raised} ${className}`}
    >
      <Glyph
        icon={icon}
        pressedIcon={pressedIcon}
        pressed={down}
        size={measure.icon}
        className={down ? look.icon : `${look.icon} ${measure.iconHover}`}
        dot={measure.dot}
      />
      {measure.label !== null && <span className={`text-center font-medium ${measure.label} ${look.label}`}>{label}</span>}
      {note && measure.label !== null && <span className="text-[9px] leading-none text-ink-600">{note}</span>}
      {busy && (
        <span data-busy-badge title={BUSY_TITLE} className={`absolute ${measure.busy.at} text-accent-400`}>
          <Loader2 size={measure.busy.size} strokeWidth={2.25} className="animate-spin" aria-hidden />
        </span>
      )}
    </button>
  )
}

export interface BigButtonProps extends ButtonProps {
  /** Required: a pressed button changes its glyph, so it needs one. */
  icon: LucideIcon
  pressedIcon?: LucideIcon
  children: ReactNode
  variant?: 'primary' | 'secondary'
  /** Only for a button that toggles; leave it out and the button says nothing about being pressed. */
  pressed?: boolean
  /** Working: shown as pressed, and announced as busy. */
  busy?: boolean
  /**
   * `sm` fits a 28 px header row — EXPORT's, which WINDOW.md §2 budgets at
   * 28 px closed. A size here rather than padding passed in `className`: two
   * Tailwind paddings on one element are settled by the stylesheet's order,
   * not the class string's.
   */
  size?: 'md' | 'sm'
}

const BIG_BUTTON_SIZE = {
  md: { box: 'gap-1.5 px-3 py-2 text-[12px]', icon: 14 },
  sm: { box: 'gap-1 px-2.5 py-0.5 text-[11px] leading-4', icon: 12 }
} as const

export function BigButton({
  icon,
  pressedIcon,
  children,
  variant = 'primary',
  pressed,
  busy = false,
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: BigButtonProps): ReactNode {
  const down = pressed === true || busy
  const look = BIG_BUTTON_LOOK[variant]
  const measure = BIG_BUTTON_SIZE[size]
  const iconClass = down && variant === 'secondary' ? 'text-accent-400' : ''
  return (
    <button
      {...rest}
      type={type}
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      className={`relative flex items-center justify-center rounded-lg ${measure.box} font-medium disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ${
        down ? look.pressed : look.idle
      } ${className}`}
    >
      <Glyph
        icon={icon}
        pressedIcon={pressedIcon}
        pressed={down}
        size={measure.icon}
        className={iconClass}
        badge={variant === 'primary' ? 'bg-ink-950' : 'bg-accent-500'}
      />
      <span>{children}</span>
    </button>
  )
}
