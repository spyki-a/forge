import { existsSync, readdirSync, statSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { UNPARSEABLE_RECEIPT, receiptFromText } from '@shared/sidecar/helperPython'
import { isUnsupported, parseReceipt, receiptMatches, type HelperPackManifest, type PlatformPack, type PackPlatform, type PlatformUnsupported } from '@shared/sidecar/pack'
import { sweepPlan, type ReceiptState, type SweepInput } from '@shared/sidecar/install'
import type { PackFs } from './installTypes'
import { LockRefused, acquireLock, readInUse } from './lock'

/**
 * The disk half of the launch sweep and of the job's clean-up (docs/CLIPS.md
 * §3a.3 "Cancel, quit and the sweep"): read a pack root into `SweepInput`,
 * plan it with the pure `sweepPlan`, and remove what the plan names — every
 * version folder's receipt before its tree, every tree with `fs.rm`'s
 * retries, for a scanner.
 */

/** `fs.rm`'s retries for a tree a scanner may hold (EBUSY, EPERM on Windows); Node waits 100 ms more each time. */
export const RM_RETRIES = 10

/** A version folder's `pack.json`, as the order reads it (service.ts `readReceipt`): its state, and the value when there is one. */
export async function receiptAt(versionDir: string): Promise<{ state: ReceiptState; receipt: unknown }> {
  let text: string
  try {
    text = await readFile(join(versionDir, 'pack.json'), 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'none', receipt: null }
    return { state: 'unparseable', receipt: UNPARSEABLE_RECEIPT }
  }
  const receipt = receiptFromText(text)
  return { state: parseReceipt(receipt) ? 'parses' : 'unparseable', receipt }
}

const isNumber = (name: string): boolean => /^[1-9]\d*$/.test(name)

async function numberedDirs(dir: string): Promise<number[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory() && isNumber(e.name)).map((e) => Number(e.name))
  } catch {
    return []
  }
}

/** A pack root as the sweep's rules read it. */
export async function describeRoot(
  root: string,
  o: { manifest: HelperPackManifest; platform: PackPlatform | PlatformUnsupported; isAlive(pid: number): boolean; lockedElsewhere: boolean }
): Promise<SweepInput> {
  const versions: SweepInput['versions'] = []
  let currentComplete = false
  for (const n of await numberedDirs(root)) {
    const { state, receipt } = await receiptAt(join(root, String(n)))
    versions.push({ n, receipt: state })
    if (n === o.manifest.pack && state === 'parses' && !isUnsupported(o.platform)) {
      currentComplete = receiptMatches(receipt, o.manifest, o.platform)
    }
  }
  return {
    current: o.manifest.pack,
    versions,
    downloads: await numberedDirs(join(root, 'downloads')),
    lockedElsewhere: o.lockedElsewhere,
    inUse: (await readInUse(root, o.isAlive)).map((r) => r.pack),
    currentComplete
  }
}

/** Remove one version folder: its receipt first, then the tree (§3a.2 "Layout"). */
export async function removeVersion(dir: string, fs: PackFs): Promise<void> {
  await fs.rm(join(dir, 'pack.json'), { recursive: false, force: true, maxRetries: RM_RETRIES })
  await fs.rm(dir, { recursive: true, force: true, maxRetries: RM_RETRIES })
}

/** Carry out a plan; a step that fails is logged and left for the next sweep. Returns what went. */
export async function applySweep(root: string, steps: ReturnType<typeof sweepPlan>, fs: PackFs, log: (line: string) => void): Promise<string[]> {
  const removed: string[] = []
  for (const step of steps) {
    const path = join(root, ...step.path.split('/'))
    try {
      if (step.receiptFirst) await removeVersion(path, fs)
      else await fs.rm(path, { recursive: true, force: true, maxRetries: RM_RETRIES })
      removed.push(path)
      log(`[helper] swept ${step.path}: ${step.why}`)
    } catch (err) {
      log(`[helper] could not sweep ${step.path} (${step.why}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return removed
}

export interface SweepOptions {
  fs: PackFs
  manifest: HelperPackManifest
  platform: PackPlatform | PlatformUnsupported
  pid: number
  now(): number
  isAlive(pid: number): boolean
  log?(line: string): void
}

/**
 * The launch sweep of one root: taken under the lock, so it never runs under
 * another instance's install (or this one's). While the lock is held
 * elsewhere the plan is empty, by `sweepPlan`'s own first rule. Returns the
 * paths it removed.
 */
export async function sweepRoot(root: string, o: SweepOptions): Promise<string[]> {
  if (!existsSync(root)) return []
  const log = o.log ?? ((line: string) => console.log(line))
  let lock: Awaited<ReturnType<typeof acquireLock>> | null = null
  let lockedElsewhere = false
  try {
    lock = await acquireLock(root, o.fs, o)
  } catch (err) {
    if (!(err instanceof LockRefused)) throw err
    lockedElsewhere = true
  }
  try {
    const input = await describeRoot(root, { manifest: o.manifest, platform: o.platform, isAlive: o.isAlive, lockedElsewhere })
    return await applySweep(root, sweepPlan(input), o.fs, log)
  } finally {
    await lock?.release()
  }
}

/**
 * The pack's files already in `downloads/<n>/`, name to size, read
 * synchronously (49 stats) for the offer's "· N MB left" (`bytesLeft`).
 * `.part` files and anything not in the pack are not counted.
 */
export function downloadedFiles(dir: string, pack: PlatformPack): Record<string, number> {
  const present: Record<string, number> = {}
  let names: Set<string>
  try {
    names = new Set(readdirSync(dir))
  } catch {
    return present
  }
  for (const file of [pack.interpreter, ...pack.wheels]) {
    if (!names.has(file.name)) continue
    try {
      const s = statSync(join(dir, file.name))
      if (s.isFile()) present[file.name] = s.size
    } catch {
      // gone between the two reads
    }
  }
  return present
}
