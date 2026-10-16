/**
 * Whether the AI helper can do one thing (docs/CLIPS.md §3a.4 "Grey every
 * Python control by its own method").
 *
 * A control asks for its OWN method, never whether a process is up: a bare
 * interpreter on `FORGE_PYTHON` answers hello with no capabilities, a pack on
 * a Windows machine without the Visual C++ runtime registers `audio.beats` and
 * then fails to load soxr at the first call, and a helper that is starting or
 * being installed has nothing to answer with yet. So: true only for a `ready`
 * status whose hello registered the method, did not mark it degraded, and
 * whose install self-test did not fail the method's group.
 *
 * Main already merges the receipt's failed groups into `hello.degraded`
 * (service.ts `readyStatus`); the self-test record is read here too, so a
 * status built without that merge (a test's, the harness's) cannot read as
 * able.
 *
 * Pure: no disk, no electron, no node. Shared, so main's reframe gate, the
 * renderer's controls and the tests decide one way.
 */

import { degradedBySelftest, type SelftestRecord } from './selftest'
import type { SidecarStatus } from './status'

/** A status with or without its `source`: main's own gates pass a bare `{ state: 'ready', hello }`. */
type WithoutSource<T> = T extends unknown ? Omit<T, 'source'> : never
export type HelperStatusLike = SidecarStatus | WithoutSource<SidecarStatus>

export function helperCan(status: HelperStatusLike | null | undefined, method: string): boolean {
  if (!status || status.state !== 'ready') return false
  const hello = status.hello
  if (!hello || !Array.isArray(hello.capabilities) || !hello.capabilities.includes(method)) return false
  if (hello.degraded && Object.prototype.hasOwnProperty.call(hello.degraded, method)) return false
  const record = (status as { selftest?: SelftestRecord }).selftest
  if (record && Object.prototype.hasOwnProperty.call(degradedBySelftest(record), method)) return false
  return true
}
