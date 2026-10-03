import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

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
 */

/** The class sets for each state, exported so a test can hold them apart. */
export const TILE_LOOK = {
  idle: {
    surface: 'bg-ink-950 shadow-raised active:bg-ink-850',
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
  badge = 'bg-accent-500'
}: {
  icon: LucideIcon
  pressedIcon?: LucideIcon
  pressed: boolean
  size: number
  className: string
  /** The dot's colour: blue on the pale pressed body, cream on a blue one. */
  badge?: string
}): ReactNode {
  if (!pressed) return <Icon size={size} className={className} aria-hidden />
  if (PressedIcon) return <PressedIcon size={size} className={className} aria-hidden />
  return (
    <>
      <Icon size={size} strokeWidth={PRESSED_STROKE} className={className} aria-hidden />
      <span data-pressed-badge className={`absolute right-1.5 top-1.5 size-1.5 rounded-full ${badge}`} aria-hidden />
    </>
  )
}

export interface TileProps extends ButtonProps {
  icon: LucideIcon
  /** The glyph to show while pressed. Without it, the icon is drawn heavier with a dot. */
  pressedIcon?: LucideIcon
  label: string
  /** A tile is a toggle (its tool open or not), so it always says which. */
  pressed?: boolean
}

export function Tile({
  icon,
  pressedIcon,
  label,
  pressed = false,
  className = '',
  type = 'button',
  ...rest
}: TileProps): ReactNode {
  const look = pressed ? TILE_LOOK.pressed : TILE_LOOK.idle
  return (
    <button
      {...rest}
      type={type}
      aria-pressed={pressed}
      className={`group relative flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl p-1.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ${look.surface} ${className}`}
    >
      <Glyph icon={icon} pressedIcon={pressedIcon} pressed={pressed} size={18} className={look.icon} />
      <span className={`line-clamp-2 text-center text-[10.5px] font-medium leading-tight ${look.label}`}>{label}</span>
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
}

export function BigButton({
  icon,
  pressedIcon,
  children,
  variant = 'primary',
  pressed,
  busy = false,
  className = '',
  type = 'button',
  ...rest
}: BigButtonProps): ReactNode {
  const down = pressed === true || busy
  const look = BIG_BUTTON_LOOK[variant]
  const iconClass = down && variant === 'secondary' ? 'text-accent-400' : ''
  return (
    <button
      {...rest}
      type={type}
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      className={`relative flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ${
        down ? look.pressed : look.idle
      } ${className}`}
    >
      <Glyph
        icon={icon}
        pressedIcon={pressedIcon}
        pressed={down}
        size={14}
        className={iconClass}
        badge={variant === 'primary' ? 'bg-ink-950' : 'bg-accent-500'}
      />
      <span>{children}</span>
    </button>
  )
}
