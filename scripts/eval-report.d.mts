/** Types for scripts/eval-report.mjs, so the tests can import it under strict TypeScript. */

export interface RunSummary {
  briefs: number
  used: number
  repaired: number
  rejected: number
  error: number
  landed: number
  medianMs: number | null
  medianPrompt: number | null
  medianOutput: number | null
  headlines: number
  headlinesFit: number
  copy: number | null
  baselineCopy: number | null
  rated: number
  preferred: number
  preferredOf: number
  reasons: Record<string, number>
}

export const GRAPHICS_PASS: 'graphics@1'
export function isGraphicsRun(run: unknown): boolean
export function summarise(run: unknown, options?: { pass?: string }): RunSummary
export function meetsBar(summary: RunSummary): boolean | null
export function buildReport(runs: unknown[], findings?: string): string

/** A graphics run's blind template-fit ratings (`npm run eval:rate`). */
export interface GraphicsRatingSummary {
  fixtures: number
  evalFixtures: number
  rated: number
  fit: number | null
  baselineFit: number | null
  fitAtLeast3: number
}

export function summariseGraphics(run: unknown): GraphicsRatingSummary
export function graphicsReport(runs: unknown[]): string[]
export function loadRuns(dir?: string): unknown[]
