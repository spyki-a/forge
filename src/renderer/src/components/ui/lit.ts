/**
 * How a choice looks when it is ON, and when it is not — one look for every
 * toggle and chosen option of the clip maker's rows, so what is selected is
 * told from what is not at a glance.
 *
 * The user, 2026-11-27: "make each glow when its selected for easy
 * identification of what has been selected and which is not … like a check
 * listing kind of so every toggele selected get highlight".
 *
 * ON is the palest accent tint with the deepest accent ink, an accent ring and
 * a glow (`shadow-lit`, styles.css). It is deliberately NOT the solid accent
 * fill: that is what a button that DOES something wears (Download, Analyse,
 * Clip it), and a row of lit choices ending in Analyse must not read as a row
 * of Analyse buttons.
 *
 * A box-shadow only: no box changes size, so nothing in a row moves when a
 * choice is lit, and the overlap check measures the same boxes.
 */
export const LIT = 'bg-accent-900 text-accent-300 shadow-lit'

/** Not chosen: a quiet chip that darkens its ink under the pointer. */
export const UNLIT = 'bg-ink-850 text-ink-400 hover:text-ink-200'

export const lit = (on: boolean): string => (on ? LIT : UNLIT)
