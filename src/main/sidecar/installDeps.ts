import { app, net, session } from 'electron'
import { FETCH_RETRY, fetchVerified, renameWithRetry } from '../net/fetchFile'
import { chromiumFetch, type NetRequestLike } from '../net/chromiumFetch'
import { unpackTarGz } from './unpack'
import { compileStdlib } from './compile'
import { runPip } from './pip'
import { checkPack } from './check'
import { nodePackFs, type HelperPackWorkers } from './install'
import type { FetchVerifiedDeps, PackFs } from './installTypes'

/**
 * The AI helper's install job, given its real dependencies (docs/CLIPS.md
 * §3a.3): the workers lanes F and S built, and the file system the job runs
 * on. `tests/integration/helperPack.int.test.ts` runs the app's own job on
 * these, from the real hosts, exactly as the app does; the app's half (where,
 * which helper, its status) is service.ts' `helperPackDeps`, and
 * `src/main/index.ts` hands both to `registerIpc` through
 * `helperInstallOptions`.
 *
 * - `fetchVerified` (src/main/net/fetchFile.ts), one retry budget per file
 *   (`FETCH_RETRY`), on the network stack `packFetch` picks: inside Electron,
 *   Chromium's (chromiumFetch.ts over `net.request`), which uses the
 *   system's proxy settings as every other app on the machine does; under
 *   vitest and CI, where there is no Electron, Node's `globalThis.fetch`
 *   (which reads `HTTPS_PROXY` only with `NODE_USE_ENV_PROXY=1`, §3a.5,
 *   measured). §15 row 19, measured on Electron 44.3.0 (2026-10-16): not
 *   `net.fetch` itself, which cannot hand back a redirect to follow by hand
 *   (chromiumFetch.ts says what it does instead);
 * - `unpackTarGz`, `compileStdlib`, `runPip`, `checkPack`, as built;
 * - the `.part` renames and the receipt's through `renameWithRetry` (win32's
 *   EPERM, EACCES and EBUSY tried again, bounded; one try elsewhere).
 */

/**
 * The pack's fetch: Chromium's inside a ready Electron, Node's elsewhere.
 * `process.versions.electron` alone is not enough: `net.request` throws
 * before the app is ready.
 */
export function packFetch(o: { electron?: string; ready?: () => boolean } = {}): typeof globalThis.fetch {
  const electron = o.electron ?? process.versions.electron
  const ready = o.ready ?? (() => typeof app?.isReady === 'function' && app.isReady())
  if (!electron || !ready()) return globalThis.fetch
  return chromiumFetch({
    request: (options) => net.request(options) as unknown as NetRequestLike,
    resolveProxy: (url) => session.defaultSession.resolveProxy(url)
  })
}

/**
 * `fetchVerified` on the pack's fetch. The job hands in `deps.fetch`, which
 * service.ts sets to `globalThis.fetch`, the platform's own: that one is
 * swapped for `packFetch()`, so inside Electron it is Chromium's. A fetch
 * anything else hands in (a test's fake) is used as it is.
 */
export function packFetchVerified(pick: () => typeof globalThis.fetch = packFetch): HelperPackWorkers['fetchVerified'] {
  return (file, dir, f: FetchVerifiedDeps) => fetchVerified(file, dir, f.fetch === globalThis.fetch ? { ...f, fetch: pick() } : f)
}

/** The workers, each the module's own export: what the job calls at each stage. */
export function helperWorkers(): HelperPackWorkers {
  return {
    fetchVerified: packFetchVerified(),
    unpack: unpackTarGz,
    compileStdlib,
    pip: runPip,
    check: checkPack,
    retry: FETCH_RETRY
  }
}

/** The app's rename for the pack: two arguments only, so nothing a caller passes reaches `renameWithRetry`'s options. */
export function packRename(from: string, to: string): Promise<void> {
  return renameWithRetry(from, to)
}

/**
 * The job's file system on `node:fs/promises` (install.ts `nodePackFs`), with
 * the retried rename: `rename` is `packRename`; `rm` passes the caller's
 * `maxRetries` to `fs.rm`; `createExclusive` opens with `O_CREAT | O_EXCL |
 * O_WRONLY`; `freeBytes` is `statfs`'s `bavail × bsize`, `df`'s "Avail"
 * (measured on the dev Mac, tests/integration/helperPack.int.test.ts).
 */
export function appPackFs(): PackFs {
  return nodePackFs(packRename)
}

/** What `src/main/index.ts` passes `registerIpc`: the real workers and the retried rename. */
export function helperInstallOptions(): { helperWorkers: HelperPackWorkers; helperRename: (from: string, to: string) => Promise<void> } {
  return { helperWorkers: helperWorkers(), helperRename: packRename }
}
