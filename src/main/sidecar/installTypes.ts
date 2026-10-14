/**
 * The install job's injected dependencies (docs/CLIPS.md §3a.3): the shapes
 * the job (`install.ts`) calls, the fetcher (`src/main/net/fetchFile.ts`), the
 * unpacker (`unpack.ts`), the pip stage (`pip.ts`) and the check (`check.ts`)
 * implement, and `tests/helperPackJob.test.ts` fakes. Types only: nothing here
 * runs, so the job's tests never touch the network, pip or a helper.
 */

import type { spawn as nodeSpawn } from 'node:child_process'
import type { FetchRetry } from '../ingest/binary'
import type { HelloResult } from '@shared/sidecar/protocol'
import type { HelperPackManifest, PackFile, PackPlatform } from '@shared/sidecar/pack'
import type { HelperLaunch } from '@shared/sidecar/helperPython'
import type { SelftestResult } from '@shared/sidecar/selftest'

export type Spawn = typeof nodeSpawn

/** What `fetchVerified` is given for ONE file: its own retry budget, the job's signal, the app's rename. */
export interface FetchVerifiedDeps {
  fetch: typeof globalThis.fetch
  retry: FetchRetry
  signal: AbortSignal
  now(): number
  /** `renameWithRetry` in the app (EPERM/EACCES/EBUSY retried on win32); a test's may refuse. */
  rename(from: string, to: string): Promise<void>
  /** Every chunk's length as it streams, for the bar and the speed. */
  onBytes(n: number): void
  /** A try begins: what onBytes counts from here is this try's, the file streamed again from its start. */
  onTry?(): void
  /** The retry's own line ("files.pythonhosted.org answered 503, trying again in 8s (2 of 4)"). */
  onMessage?(message: string): void
}

/**
 * Stream one file into `dir` as a `.part` of its own, hashed and counted as it
 * arrives, renamed to `<name>` only when it is the file; resolves with that
 * path. A file already there with its hash is skipped (resume by file). One
 * `Fetching`, one retry budget, per call — never one for the whole install.
 */
export type FetchVerified = (file: PackFile, dir: string, f: FetchVerifiedDeps) => Promise<string>

export interface UnpackResult {
  files: number
  bytes: number
  /** The longest relative file path written, in characters (row 28). */
  longestPath: number
  longestDir: number
}

/**
 * Gunzip and untar `archive` into `into` through the streaming reader: parent
 * folders made (the real archives carry no directory entries), the executable
 * bit restored from the mode, in-root symlinks made, everything else refused.
 */
export type UnpackTarGz = (
  archive: string,
  into: string,
  o: {
    signal: AbortSignal
    onMessage?(message: string): void
    /**
     * The manifest's `longestPath` and `longestDir` for this version folder:
     * the unpacker refuses before its first write when they do not fit
     * Windows' path budget (`checkPathBudget`). Added by the job's lane; the
     * job checks the same budget in stage 0, before anything is fetched.
     */
    budget?: { longestPath: number; longestDir: number }
  }
) => Promise<UnpackResult>

/** `<python> -I -m compileall -q -j 1 <stdlib>`, once, right after the unpack (§3a.3 stage 2). */
export type CompileStdlib = (o: { python: string; stdlib: string; env: NodeJS.ProcessEnv; spawn: Spawn; signal: AbortSignal }) => Promise<void>

export interface PipStageOptions {
  /** The pack's interpreter. */
  python: string
  /** The lock file pip installs from (`-r`). */
  lock: string
  /** `downloads/<n>`: `--find-links`, where every verified wheel is. */
  findLinks: string
  /** The pack's site-packages, polled for `*.dist-info` folders every 500 ms: the bar's measure. */
  sitePackages: string
  /** The lock's line count: the bar's denominator. */
  total: number
  /** The pack rung's environment (`helperLaunch`'s): `-E -s` and no `PIP_*`. */
  env: NodeJS.ProcessEnv
  spawn: Spawn
  signal: AbortSignal
  /** `done` of `total` dist-info folders, and pip's last `Processing …` / `Installing …` line. */
  onProgress(done: number, total: number, line: string | null): void
}

/**
 * pip, offline, with the hashes checked, as one child (`windowsHide: true`);
 * a cancel kills its tree. Rejects with a worded reason: pip's "Failed to
 * write executable" maps to the antivirus sentence (§3a.3 stage 3).
 */
export type RunPip = (o: PipStageOptions) => Promise<void>

export interface PackCheckOptions {
  versionDir: string
  manifest: HelperPackManifest
  platform: PackPlatform
  /** Where the helper's own package is (`sidecarDir()`), the client's cwd. */
  sidecarDir: string
  /** The pack rung's launch, exactly as the service will start it. */
  launch: HelperLaunch
  signal: AbortSignal
  onMessage?(message: string): void
  /**
   * How far the check has got, 0..1, never down: its share for the hello
   * (`CHECK_HELLO_SHARE`), then the self-test group by group. Added by the
   * integrator: the check is the longest stage of a real install (37–39 s
   * on the M1 Pro, §3a.8 row 27), and the bar stood still through it.
   */
  onProgress?(fraction: number): void
}

export interface PackCheck {
  hello: HelloResult
  /** `system.selftest`'s answer, every group. */
  selftest: SelftestResult
  /**
   * What the check holds against the plan and found wrong: a `sys.path` entry
   * outside the pack and `sidecarDir`, an `expects` method missing from hello,
   * the wrong `python` version. Empty when the pack is as it should be.
   */
  problems: string[]
}

/**
 * Stage 4: a client on the new pack with `maxRestarts: 0`, hello within the
 * pack rung's timeout, `executable`/`prefix`/every `path` entry inside the
 * version folder or `sidecarDir` (by `path.relative` on real paths), `python`
 * the manifest's version, `expects` ⊆ capabilities, one ping, then
 * `system.selftest`. The client is stopped before this resolves or rejects.
 * Rejects only when the helper does not start or answer at all; a degraded
 * method or a failed group is a RESULT (the pack is kept, §3a.3 "When the
 * check fails part of the way").
 */
export type CheckPack = (o: PackCheckOptions) => Promise<PackCheck>

/** The file-system calls the job makes that a test wants to refuse or hold. */
export interface PackFs {
  rename(from: string, to: string): Promise<void>
  rm(path: string, options: { recursive: boolean; force: boolean; maxRetries?: number }): Promise<void>
  /** `O_CREAT | O_EXCL | O_WRONLY`: the lock. Rejects with EEXIST when it is held. */
  createExclusive(path: string, text: string): Promise<void>
  /** Free bytes on the volume holding `path`. */
  freeBytes(path: string): Promise<number>
}

/** What the service lends the job: whether helper work is in flight, and the stop and restart it must go through. */
export interface HelperControl {
  busy(): boolean
  whenIdle(signal: AbortSignal): Promise<void>
  /** Resolves on the child's exit and its tree's. */
  stop(): Promise<void>
  /**
   * Keep the helper stopped and every caller refused with `reason` until the
   * release is called: Repair and Remove delete under a path a lazily rebuilt
   * client would otherwise respawn from.
   */
  hold(reason: string): () => void
  /** Resolve the order again and start what it says. */
  restart(signal?: AbortSignal): Promise<void>
}
