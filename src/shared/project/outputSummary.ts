import type { Project } from '../timeline'

/**
 * The OUTPUT strip's one line, shown while it is collapsed: what the file will
 * be, so a closed strip still says it (docs/WINDOW.md §3.16) —
 * "30 fps · -14 LUFS · captions on".
 *
 * Here rather than in the component so tests/windowStrips.test.ts can hold it in
 * plain node. The loudness is written as the Loudness row writes it ("Every
 * export measured to -14 LUFS"), with the ASCII minus, so the summary and the
 * panel it summarises spell the number the same way.
 *
 * Each phrase is a whole literal — 'captions on', not `captions ${state}` — so
 * the census (tests/fixtures/ui-census.json) can find the words in the source.
 */
export function outputSummary(project: Pick<Project, 'settings' | 'captions'>): string {
  const rate = `${project.settings.fps} fps`
  // `?? undefined` as the Loudness row reads it: an older file can carry null for off.
  const lufs = project.settings.loudness ?? undefined
  const loudness = lufs === undefined ? 'loudness off' : `${lufs} LUFS`
  const captions = project.captions.enabled ? 'captions on' : 'captions off'
  return [rate, loudness, captions].join(' · ')
}
