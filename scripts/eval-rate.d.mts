/** Types for scripts/eval-rate.mjs, so the tests can import it under strict TypeScript. */
export function modelIsA(id: string): boolean
export function graphicLinesOf(windows: unknown, side: 'model' | 'baseline'): string[]
export function graphicsRating(aIsModel: boolean, ratingA: number, ratingB: number): { fit: number; baselineFit: number }
