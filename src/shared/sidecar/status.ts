/**
 * The AI helper's status, as main broadcasts it on `sidecar:status` and
 * answers the window's ask with (docs/CLIPS.md §3a.2 "absent at every
 * caller"). Shared, so main, the preload and the renderer name one type.
 *
 * Pure: no disk, no electron. On screen the process is "the AI helper"; the
 * code's name for it never reaches a sentence here.
 */

import type { HelperSource } from './helperPython'
import { isUnsupported, packBytes, packHosts, parseReceipt, receiptMatches, type HelperPackManifest, type PackPlatform, type PlatformUnsupported } from './pack'
import type { HelloResult } from './protocol'

/**
 * What the Settings row can offer when no helper runs: the press and its size
 * (§0's click rule: the size is on the button before the press), the bytes it
 * will take on disk, and the hosts a restricted network must allow — or why
 * this computer cannot have one.
 */
export type PackOffer =
  | {
      supported: true
      /**
       * `install`: no receipt; `update`: a receipt for another lock or
       * interpreter, in the manifest's folder or an older number's; `repair`:
       * a damaged one.
       */
      kind: 'install' | 'update' | 'repair'
      /** Every byte the press fetches: the interpreter and the wheels (`packBytes`). */
      bytes: number
      /**
       * What is still to fetch: `bytes` less the verified files already in
       * `downloads/<n>/` (install.ts `bytesLeft`): "Install the AI helper · 120
       * MB left" after a cancel, and Repair's number (§3a.4, §16.47). Set by
       * the service, which reads the folder; absent when nobody looked.
       */
      bytesLeft?: number
      /** The pack on disk once installed (the manifest's, measured by CI's install). */
      bytesOnDisk: number
      hosts: string[]
    }
  | { supported: false; reason: string }

export type SidecarStatus =
  /** A packaged app with nothing to run: nothing was spawned. */
  | { state: 'absent'; offer: PackOffer }
  /** A receipt that does not parse, or one whose interpreter is gone: nothing was spawned. */
  | { state: 'damaged'; reason: string; offer: PackOffer }
  /**
   * The install job's stage (`INSTALL_STAGES`' label), while no helper runs:
   * the job reports it (src/main/sidecar/install.ts), and the service
   * broadcasts it only when there is no client to say otherwise.
   */
  | { state: 'installing'; stage: string }
  | { state: 'starting'; source: HelperSource }
  | {
      state: 'ready'
      hello: HelloResult
      source: HelperSource
      selftest?: Record<string, string>
      /**
       * The install check's integrity problems, from the receipt (§16.51): a
       * `sys.path` entry outside the pack, or a Python other than the
       * manifest's. The pack is kept and runs; the row shows each sentence
       * and offers Repair. Absent or empty when the pack is as it should be.
       */
      integrity?: string[]
      /**
       * What a Repair would still fetch, for a pack's ready: the manifest's
       * bytes less the verified files a cancelled or failed Repair left in
       * `downloads/<n>/` (§3a.4 "Repair's number", §16.47). Set by the service
       * only while some are kept; absent means the whole pack.
       */
      bytesLeft?: number
    }
  | {
      state: 'failed'
      error: string
      source: HelperSource
      /** As `ready`'s: what a Repair of this pack would still fetch, while a Repair's verified downloads are kept. */
      bytesLeft?: number
    }

/** What every helper call rejects with when there is no helper to run, and what the window says. */
export const HELPER_NOT_INSTALLED = 'The AI helper is not installed'

/**
 * A pack Windows refuses to start (§3a.4 "Group Policy"): some managed
 * machines block programs under the user's folder, where the pack lives.
 * The `failed` status carries it, so the row reads "Not running" with it,
 * never "The AI helper keeps crashing". client.ts `startFailure` words it.
 */
export const HELPER_BLOCKED_BY_POLICY =
  "Windows' policy on this computer blocks programs in your user folder; ask whoever manages it, or point FORGE_PYTHON at an allowed Python"

/**
 * What they reject with when the pack on disk is an older one this build no
 * longer runs (§16.46 (a)): it is there, and unused until Update is pressed.
 */
export const HELPER_NEEDS_UPDATE = 'The AI helper needs an update'

/**
 * The offer for a machine with no running pack.
 *
 * - `receipt`: the manifest's own folder's `pack.json`: `null` when there is
 *   none; otherwise what was read (the parsed JSON, or `UNPARSEABLE_RECEIPT`).
 * - `damaged`: `resolveHelperPython` chose `damaged` (a receipt that does not
 *   parse, or one that matches with its interpreter gone): Repair.
 * - `older`: when the manifest's folder has no receipt, the receipt of the
 *   highest older pack number's folder (`null` when there is none). Once a
 *   release bumps the number (1 → 2), the installed pack sits in `1/` and the
 *   manifest's `2/` is empty: without this, a 0.7 GB pack on disk was offered
 *   as a fresh Install.
 *
 * A receipt that parses and does not match is an Update (§16.46 (a)), and so
 * is an older number's that parses. One that matches is a pack, whose only
 * offer is a Repair. An unsupported machine is offered nothing, with its
 * reason.
 */
export function packOffer(
  manifest: HelperPackManifest,
  platform: PackPlatform | PlatformUnsupported,
  receipt: unknown,
  damaged: boolean,
  older: unknown = null,
  /** What is left to fetch (install.ts `bytesLeft`), when the caller read `downloads/<n>/`. */
  left?: number
): PackOffer {
  if (isUnsupported(platform)) return { supported: false, reason: platform.unsupported }
  const pack = manifest.platforms[platform]
  const kind: 'install' | 'update' | 'repair' = damaged
    ? 'repair'
    : receipt === null
      ? parseReceipt(older)
        ? 'update'
        : 'install'
      : !parseReceipt(receipt)
        ? 'repair'
        : receiptMatches(receipt, manifest, platform)
          ? 'repair'
          : 'update'
  return {
    supported: true,
    kind,
    bytes: packBytes(pack),
    ...(left === undefined ? {} : { bytesLeft: left }),
    bytesOnDisk: pack.bytesOnDisk,
    hosts: packHosts(pack)
  }
}

/**
 * The sentence for a status with no running helper: the damaged reason, the
 * failure, "not installed", "needs an update" (an older pack on disk), or why
 * this computer cannot have one. null for a helper that is starting,
 * installing or ready.
 */
export function helperStatusReason(status: SidecarStatus): string | null {
  switch (status.state) {
    case 'absent':
      if (!status.offer.supported) return status.offer.reason
      return status.offer.kind === 'update' ? HELPER_NEEDS_UPDATE : HELPER_NOT_INSTALLED
    case 'damaged':
      return status.reason
    case 'failed':
      return status.error
    case 'installing':
    case 'starting':
    case 'ready':
      return null
    default: {
      const unknown: never = status
      return unknown
    }
  }
}
