import { FETCH_RETRY, fetchVerified, renameWithRetry } from '../net/fetchFile'
import { unpackTarGz } from './unpack'
import { compileStdlib } from './compile'
import { runPip } from './pip'
import { checkPack } from './check'
import { nodePackFs, type HelperPackWorkers } from './install'
import type { PackFs } from './installTypes'

/**
 * The AI helper's install job, given its real dependencies (docs/CLIPS.md
 * §3a.3): the workers lanes F and S built, and the file system the job runs
 * on. Node only — no electron — so `tests/integration/helperPack.int.test.ts`
 * runs the app's own job on these, from the real hosts, exactly as the app
 * does; the app's half (where, which helper, its status) is service.ts'
 * `helperPackDeps`, and `src/main/index.ts` hands both to `registerIpc`
 * through `helperInstallOptions`.
 *
 * - `fetchVerified` (src/main/net/fetchFile.ts), one retry budget per file
 *   (`FETCH_RETRY`), through Node's `globalThis.fetch` (service.ts): Electron's
 *   `net.fetch` waits for §15 row 19 — behind a proxy Node's fetch reads
 *   `HTTPS_PROXY` only with `NODE_USE_ENV_PROXY=1` (§3a.5, measured);
 * - `unpackTarGz`, `compileStdlib`, `runPip`, `checkPack`, as built;
 * - the `.part` renames and the receipt's through `renameWithRetry` (win32's
 *   EPERM, EACCES and EBUSY tried again, bounded; one try elsewhere).
 */

/** The workers, each the module's own export: what the job calls at each stage. */
export function helperWorkers(): HelperPackWorkers {
  return {
    fetchVerified,
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
