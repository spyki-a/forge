import type { PanelImperativeHandle } from 'react-resizable-panels'

/**
 * The left column's Panel, for the harness only: the overlap check
 * (harness/overlapCheck.ts) widens the column to its limit to read the
 * window as a person who dragged it there sees it — the right column at its
 * narrowest, where the transport row and the canvas bar have the least room.
 * The app itself never resizes it; App.tsx hands this to the Panel as its
 * `panelRef`, a plain object so App keeps no extra hook.
 */
export const leftColumn: { current: PanelImperativeHandle | null } = { current: null }

/**
 * The left column's limit, as App.tsx writes it on the Panel (a string is a
 * percent in react-resizable-panels 4.x). It was 30 % until the clip maker's
 * layout (the user, 2026-11-27: "now there is a boundry just extend it a
 * little bit"); tests/trimmerDock.test.ts holds the Panel to this value.
 */
export const LEFT_MAX = '45%'
