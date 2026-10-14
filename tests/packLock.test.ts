import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PackPlatform } from '../src/shared/sidecar/pack'
import { HELPER_PACK } from '../src/shared/sidecar/packManifest'

/*
 * The AI helper's lock is complete (docs/CLIPS.md §3a.1 "The base pack",
 * §3a.7). The pack installs in ONE pip run with --no-deps, so a transitive
 * package missing from a target's lock (most likely one behind a Windows-only
 * marker, as tqdm's colorama is) would never fail the install: it would show
 * up only as a degraded capability on a user's machine.
 *
 * scripts/pack_lock.py runs this check with `packaging` before it writes
 * anything; this one runs on every push, in TypeScript, over the committed
 * resolved.json, where each lock line's Requires-Dist is already evaluated
 * per target (the target's markers, no extras, from the wheel's own
 * METADATA), because CI's bare Python has no `packaging`.
 */

const ROOT = resolve(__dirname, '..')
const SIDECAR = join(ROOT, 'sidecar')
const TARGETS: PackPlatform[] = ['darwin-arm64', 'win32-x64']

/**
 * The ONE allowlist (CLIPS §3a.1): what mediapipe asks for and the stub route
 * stands in for (§4.3, SIDECAR.md). Written here, not read from resolved.json,
 * so the generator cannot widen it unseen. hf-xet joins it as
 * huggingface-hub's only when it leaves the lock (§3a.8 row 35).
 */
const ALLOWLIST: Record<string, readonly string[]> = {
  mediapipe: ['matplotlib', 'opencv-contrib-python']
}

interface ResolvedFile {
  name: string
  size: number
  url: string
  sha256: string
}

interface Resolved {
  pack: number
  allowlist: Record<string, string[]>
  targets: Record<PackPlatform, { lock: { file: string; sha256: string }; packBytes: number }>
  distributions: Record<
    string,
    {
      version: string
      targets: Partial<Record<PackPlatform, { file: ResolvedFile; requires: string[] }>>
    }
  >
}

const RESOLVED = JSON.parse(readFileSync(join(SIDECAR, 'pack', 'resolved.json'), 'utf8')) as Resolved

/** PEP 503's normal form, which resolved.json's keys and `requires` are in. */
const canonical = (name: string): string => name.toLowerCase().replace(/[-_.]+/g, '-')

/** One lock line: `name==version --hash=sha256:<64 hex>`, pip's format. */
const LOCK_LINES = /^([A-Za-z0-9][A-Za-z0-9._-]*)==(\S+) --hash=sha256:([0-9a-f]{64})$/gm

interface LockLine {
  name: string
  version: string
  sha256: string
}

function lockText(target: PackPlatform): string {
  return readFileSync(join(SIDECAR, HELPER_PACK.platforms[target].lock.file), 'utf8')
}

/**
 * Every line of the lock read with matchAll, and every line that is neither a
 * comment, blank nor a lock line returned as a stray, so a line in another
 * shape can never be skipped silently.
 */
function parseLock(text: string): { lines: LockLine[]; strays: string[] } {
  const lines = [...text.matchAll(LOCK_LINES)].map((m) => ({
    name: canonical(m[1]),
    version: m[2],
    sha256: m[3]
  }))
  const strays = text.split('\n').filter((l) => {
    if (l.trim() === '' || l.startsWith('#')) return false
    return [...l.matchAll(LOCK_LINES)].length !== 1
  })
  return { lines, strays }
}

/**
 * What the completeness check finds wrong with one target's lock: every
 * requirement of every lock line must be a line of the same lock or on the
 * allowlist, and every line must be the file resolved.json records.
 */
function unmet(
  target: PackPlatform,
  text: string,
  allowlist: Record<string, readonly string[]> = ALLOWLIST
): string[] {
  const { lines } = parseLock(text)
  const names = new Set(lines.map((l) => l.name))
  const problems: string[] = []
  for (const line of lines) {
    const dist = RESOLVED.distributions[line.name]
    const entry = dist?.targets[target]
    if (!dist || !entry) {
      problems.push(`${line.name} has no ${target} entry in resolved.json`)
      continue
    }
    if (dist.version !== line.version) problems.push(`${line.name}: lock ${line.version}, resolved ${dist.version}`)
    if (entry.file.sha256 !== line.sha256) problems.push(`${line.name}: lock hash is not resolved.json's file`)
    for (const dep of entry.requires) {
      if (allowlist[line.name]?.includes(dep)) continue
      if (!names.has(dep)) problems.push(`${line.name} -> ${dep} is not in the ${target} lock`)
    }
  }
  return problems
}

describe('the AI helper pack lock is complete', () => {
  it.each(TARGETS)('%s: every lock line parses, and every requirement of every line is in the lock or allowlisted', (target) => {
    const text = lockText(target)
    const { lines, strays } = parseLock(text)
    expect(strays).toEqual([])
    // The completeness check first, so a missing package fails here with its name.
    expect(unmet(target, text)).toEqual([])
    expect(lines.length).toBe(HELPER_PACK.platforms[target].wheels.length)
    expect(lines.length).toBeGreaterThan(40)
  })

  it('is not vacuous: tqdm needs colorama on Windows only, and the Windows lock has it', () => {
    // resolved.json evaluated the marker per target; both halves are what the
    // check stands on.
    expect(RESOLVED.distributions.tqdm.targets['win32-x64']?.requires).toContain('colorama')
    expect(RESOLVED.distributions.tqdm.targets['darwin-arm64']?.requires).not.toContain('colorama')
    const win = parseLock(lockText('win32-x64')).lines
    const mac = parseLock(lockText('darwin-arm64')).lines
    expect(win.filter((l) => l.name === 'colorama')).toHaveLength(1)
    expect(mac.filter((l) => l.name === 'colorama')).toHaveLength(0)
  })

  it('fails with colorama dropped from the Windows lock (a scratch copy)', () => {
    const text = lockText('win32-x64')
    // Count the anchor before cutting on it: exactly one colorama line.
    const hits = [...text.matchAll(/^colorama==.*\n/gm)]
    expect(hits).toHaveLength(1)
    const scratch = text.replace(/^colorama==.*\n/m, '')
    expect(scratch).not.toBe(text)
    expect(unmet('win32-x64', scratch)).toContain('tqdm -> colorama is not in the win32-x64 lock')
  })

  it("mediapipe's two are required and pass only through the allowlist", () => {
    for (const target of TARGETS) {
      const requires = RESOLVED.distributions.mediapipe.targets[target]?.requires ?? []
      for (const dep of ALLOWLIST.mediapipe) expect(requires).toContain(dep)
      const withoutAllowlist = unmet(target, lockText(target), {})
      expect(withoutAllowlist).toContain(`mediapipe -> matplotlib is not in the ${target} lock`)
      expect(withoutAllowlist).toContain(`mediapipe -> opencv-contrib-python is not in the ${target} lock`)
    }
  })

  it("resolved.json's allowlist is this test's, entry for entry", () => {
    const theirs = Object.entries(RESOLVED.allowlist).flatMap(([name, deps]) => deps.map((d) => `${name} -> ${d}`))
    const ours = Object.entries(ALLOWLIST).flatMap(([name, deps]) => deps.map((d) => `${name} -> ${d}`))
    for (const entry of theirs) expect(ours).toContain(entry)
    for (const entry of ours) expect(theirs).toContain(entry)
  })

  it.each(TARGETS)('%s: resolved.json describes the committed lock and the manifest’s files', (target) => {
    const pack = HELPER_PACK.platforms[target]
    expect(RESOLVED.pack).toBe(HELPER_PACK.pack)
    expect(RESOLVED.targets[target].lock).toEqual(pack.lock)
    const byHash = new Map(pack.wheels.map((w) => [w.sha256, w]))
    for (const line of parseLock(lockText(target)).lines) {
      const file = RESOLVED.distributions[line.name]?.targets[target]?.file
      expect(file, line.name).toBeDefined()
      const wheel = byHash.get(line.sha256)
      expect(wheel, line.name).toBeDefined()
      expect({ name: wheel?.name, url: wheel?.url, bytes: wheel?.bytes }).toEqual({
        name: file?.name,
        url: file?.url,
        bytes: file?.size
      })
    }
  })
})
