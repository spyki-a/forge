/**
 * The AI helper's self-test (docs/CLIPS.md §3a.3 stage 4, §16.45): what the
 * install job asks the freshly installed pack, and how its answer becomes the
 * receipt's `selftest` record and the greyed methods.
 *
 * Pure: no disk, no electron, no node. Shared, so the job (main), the Settings
 * row (renderer) and the tests name one set of groups and one wording.
 *
 * Why groups in fresh processes, not one import list in the helper: a native
 * library that is missing a runtime fails only when it is LOADED, and in one
 * process whatever loaded first serves the rest. scikit-learn's Windows wheel
 * preloads its own msvcp140.dll on import, after which soxr's and numba's
 * imports of MSVCP140 resolve to that copy and pass, on a machine where a
 * fresh helper would fail. So each group runs in its own
 * `sys.executable -E -s -B -c` child and does the smallest real call that
 * loads its native code (the Python side: sidecar/forge_sidecar/selftest.py).
 */

import { SIDECAR_METHODS } from './protocol'

/**
 * Each group, and the helper methods it stands for. A group with no methods
 * (sklearn) is run for what it would MASK, not for a feature of its own.
 */
export const SELFTEST_GROUPS = {
  // Both of asr's methods stand on the same import (capabilities/__init__.py): a failed group takes both.
  asr: [SIDECAR_METHODS.transcribe, SIDECAR_METHODS.asrModel],
  beats: [SIDECAR_METHODS.beats],
  onnx: [SIDECAR_METHODS.depthLayers, SIDECAR_METHODS.salient, SIDECAR_METHODS.salientModel],
  vision: [SIDECAR_METHODS.visionMeasure],
  sklearn: [],
  faces: [SIDECAR_METHODS.faces, SIDECAR_METHODS.facesModel]
} as const satisfies Record<string, readonly string[]>

export type SelftestGroup = keyof typeof SELFTEST_GROUPS

export const SELFTEST_GROUP_NAMES = Object.keys(SELFTEST_GROUPS) as SelftestGroup[]

/** What the helper's `system.selftest` answers for one group. */
export interface SelftestGroupResult {
  /** The child's exit code: 0 passed. */
  exit: number
  /** Wall time of the child, in milliseconds. */
  ms: number
  /** The child's last stderr line (the error, or the "error import …" line the faces worker prints), null when it passed. */
  error: string | null
}

/** `system.selftest`'s whole answer: every group, every time. */
export type SelftestResult = Record<SelftestGroup, SelftestGroupResult>

/** The receipt's record (`PackReceipt.selftest`): 'ok', or the worded reason the row shows. */
export type SelftestRecord = Record<string, 'ok' | string>

/**
 * The sentence for a native library that cannot load on Windows because the
 * Visual C++ runtime is missing (§16.45 (a)). The same sentence yt-dlp's
 * check uses in spirit (src/main/ingest/binary.ts), with Microsoft's link.
 */
export const VCRUNTIME_SENTENCE =
  "needs Microsoft's Visual C++ runtime — install it from https://aka.ms/vs/17/release/vc_redist.x64.exe, then press Check again"

/**
 * The patterns Python prints when a Windows DLL or its dependency cannot be
 * loaded. The last is `ctypes.CDLL`'s own (CPython's callproc.c, for
 * ERROR_MOD_NOT_FOUND): mediapipe loads `libmediapipe.dll` through ctypes, so
 * the faces group's line on a machine without the runtime is "error import
 * FileNotFoundError: Could not find module '…\libmediapipe.dll' (or one of
 * its dependencies). Try using the full path with constructor syntax.", which
 * names neither "DLL load failed" nor a WinError.
 *
 * Only the loader's own words: an ImportError that merely names a `.pyd` —
 * "cannot import name 'resample' from 'soxr.soxr_ext' (…soxr_ext.cp314-win_amd64.pyd)",
 * a version mismatch — is no missing runtime, and installing one would not help.
 */
const DLL_LOAD_FAILED =
  /DLL load failed|The specified module could not be found|WinError 126|WinError 193|Could not find module .*\(or one of its dependencies\)/i

/**
 * One group's reason: 'ok' on exit 0; on win32, a DLL load failure is the
 * Visual C++ sentence; anything else names the group and its last error line.
 */
export function selftestReason(group: SelftestGroup, result: SelftestGroupResult, platform: NodeJS.Platform): 'ok' | string {
  if (result.exit === 0) return 'ok'
  const line = (result.error ?? '').trim()
  if (platform === 'win32' && DLL_LOAD_FAILED.test(line)) return `${group} ${VCRUNTIME_SENTENCE}`
  return line ? `${group} failed: ${line}` : `${group} failed (exit ${result.exit})`
}

/** The whole answer as the receipt records it. */
export function selftestRecordFrom(result: SelftestResult, platform: NodeJS.Platform): SelftestRecord {
  const record: SelftestRecord = {}
  for (const group of SELFTEST_GROUP_NAMES) {
    const one = result[group]
    record[group] = one ? selftestReason(group, one, platform) : `${group} was not run`
  }
  return record
}

/**
 * The methods a failed group takes with it, each with its reason: what the
 * service adds to hello's `degraded` so `helperCan` greys their controls, and
 * what the row names.
 */
export function degradedBySelftest(record: SelftestRecord): Record<string, string> {
  const degraded: Record<string, string> = {}
  for (const group of SELFTEST_GROUP_NAMES) {
    const reason = record[group]
    if (reason === undefined || reason === 'ok') continue
    for (const method of SELFTEST_GROUPS[group]) degraded[method] = reason
  }
  return degraded
}

/**
 * "N of <expects> helper features": how many of the pack's expected methods
 * are both registered by hello and not failed by the self-test.
 */
export function helperFeatureCount(
  expects: readonly string[],
  hello: { capabilities: readonly string[]; degraded: Record<string, string> },
  record: SelftestRecord | undefined
): { ok: number; total: number } {
  const failed = record ? degradedBySelftest(record) : {}
  let ok = 0
  for (const method of expects) {
    if (hello.capabilities.includes(method) && !(method in hello.degraded) && !(method in failed)) ok++
  }
  return { ok, total: expects.length }
}
