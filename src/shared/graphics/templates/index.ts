/**
 * The drawers by template id (docs/CLIPS.md §6.3, "The drawer seam"): each
 * template's commit in phase 2 (§6.2) adds its own row, `counter:
 * drawCounter` and so on. Empty in phase 1, when `drawListAt` returned an
 * empty list for every template and phase 1's tests drew through the seam
 * with hand-built drawers; a template with no row here still draws nothing.
 *
 * Frozen and never mutated at run time: there is no `registerDrawer`. The
 * store, the Preview and the export reach a graphic only through its
 * template's row here; no production caller passes a `drawer` of its own.
 * `drawList.ts` is this file's only importer.
 */

import type { GraphicTemplateId } from '../template'
import type { Drawer } from '../items'
import { drawBars } from './bars'
import { drawCallout } from './callout'
import { drawCounter } from './counter'
import { drawKeyword } from './keyword'
import { drawLowerThird } from './lowerThird'
import { drawQuote } from './quote'
import { drawRing } from './ring'
import { drawSteps } from './steps'

export const DRAWERS: Partial<Record<GraphicTemplateId, Drawer>> = Object.freeze({
  counter: drawCounter,
  bars: drawBars,
  steps: drawSteps,
  quote: drawQuote,
  callout: drawCallout,
  ring: drawRing,
  keyword: drawKeyword,
  'lower-third': drawLowerThird
})
