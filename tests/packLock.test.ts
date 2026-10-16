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
 *
 * Names AND versions: each requirement's specifier is read from the
 * distribution's raw `requiresDist` (the one line naming that dependency with
 * no `extra` marker) and must admit the version the lock has, as the script's
 * `req.specifier.contains` does. The comparison is PEP 440's for the shapes
 * these METADATA files use (`==`, `!=`, `<`, `<=`, `>`, `>=`, `~=`, `==N.*`,
 * a/b/rc, .post and .dev); a specifier in any other shape is a problem named
 * here, never passed. Where a dependency has several marker-split lines, one
 * admitting the version is enough: choosing between them by marker is the
 * script's.
 */

const ROOT = resolve(__dirname, '..')
const SIDECAR = join(ROOT, 'sidecar')
const TARGETS: PackPlatform[] = ['darwin-arm64', 'win32-x64']

/**
 * The ONE allowlist (CLIPS §3a.1): what mediapipe asks for and the stub route
 * stands in for (§4.3, SIDECAR.md), and huggingface-hub's hf-xet, which the
 * pack leaves out since pack 2 (§3a.8 row 35: depth's and the speech model's
 * downloads pass without it). Written here, not read from resolved.json, so
 * the generator cannot widen it unseen.
 */
const ALLOWLIST: Record<string, readonly string[]> = {
  mediapipe: ['matplotlib', 'opencv-contrib-python'],
  'huggingface-hub': ['hf-xet']
}

/** What the pack leaves out though the dev venv has it (pack_lock.py EXCLUDE): never a lock line. */
const EXCLUDED: readonly string[] = ['hf-xet']

interface ResolvedFile {
  name: string
  size: number
  url: string
  sha256: string
}

interface Resolved {
  pack: number
  allowlist: Record<string, string[]>
  excluded: string[]
  targets: Record<PackPlatform, { lock: { file: string; sha256: string }; packBytes: number }>
  distributions: Record<
    string,
    {
      version: string
      /** The wheel's own Requires-Dist lines, raw: name, specifier, marker. */
      requiresDist: string[]
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

/* ------------------------------------------------- PEP 440, the subset used */

interface Pep440 {
  release: number[]
  /** [phase, n]: a = 0, b = 1, rc = 2. */
  pre: [number, number] | null
  post: number | null
  dev: number | null
}

const VERSION_SHAPE = /^v?(\d+(?:\.\d+)*)(?:[-_.]?(a|b|rc)(\d*))?(?:[-_.]?post(\d*))?(?:[-_.]?dev(\d*))?$/

function parseVersion(text: string): Pep440 | null {
  const m = VERSION_SHAPE.exec(text.trim().toLowerCase())
  if (!m) return null
  return {
    release: m[1].split('.').map(Number),
    pre: m[2] ? [{ a: 0, b: 1, rc: 2 }[m[2] as 'a' | 'b' | 'rc'], Number(m[3] || 0)] : null,
    post: m[4] !== undefined ? Number(m[4] || 0) : null,
    dev: m[5] !== undefined ? Number(m[5] || 0) : null
  }
}

/** PEP 440's sort key, compared field by field: a .devN with no pre or post sorts before any pre-release of its release. */
function versionKey(v: Pep440): number[] {
  const pre = v.pre === null && v.post === null && v.dev !== null ? [-Infinity, 0] : v.pre === null ? [Infinity, 0] : v.pre
  return [...pre, v.post ?? -Infinity, v.dev ?? Infinity]
}

function compareVersions(a: Pep440, b: Pep440): number {
  const n = Math.max(a.release.length, b.release.length)
  for (let i = 0; i < n; i++) {
    const d = (a.release[i] ?? 0) - (b.release[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  const [ka, kb] = [versionKey(a), versionKey(b)]
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1
  return 0
}

/** `1.*` against a release: its leading numbers, zero-padded, are the prefix's. */
const releasePrefix = (v: Pep440, prefix: number[]): boolean => prefix.every((p, i) => (v.release[i] ?? 0) === p)

/** Whether a specifier (`<4,>=2`, `~=2.3`, `==1.*`, or none) admits a version; null when either is not in a shape read here. */
function admits(specifier: string, version: string): boolean | null {
  const v = parseVersion(version)
  if (!v) return null
  for (const raw of specifier.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(~=|==|!=|<=|>=|<|>)\s*(\S+)$/.exec(raw)
    if (!m) return null
    const [, op, target] = m
    if (target.endsWith('.*')) {
      if (op !== '==' && op !== '!=') return null
      const prefix = target.slice(0, -2).split('.').map(Number)
      if (prefix.some((p) => !Number.isInteger(p))) return null
      if (releasePrefix(v, prefix) !== (op === '==')) return false
      continue
    }
    const t = parseVersion(target)
    if (!t) return null
    const c = compareVersions(v, t)
    const ok =
      op === '==' ? c === 0
      : op === '!=' ? c !== 0
      : op === '<' ? c < 0
      : op === '<=' ? c <= 0
      : op === '>' ? c > 0
      : op === '>=' ? c >= 0
      : // ~=X.Y(.Z): at least it, and the same release but its last number
        t.release.length >= 2 && c >= 0 && releasePrefix(v, t.release.slice(0, -1))
    if (!ok) return false
  }
  return true
}

/** A Requires-Dist line: its name (PEP 503), its specifier, and whether its marker asks for an extra. */
function requirementOf(line: string): { name: string; specifier: string; extra: boolean } | null {
  const [head, marker = ''] = line.split(';', 2)
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*\(?([^)]*)\)?\s*$/.exec(head)
  if (!m) return null
  return { name: canonical(m[1]), specifier: m[2].trim(), extra: /\bextra\b/.test(marker) }
}

/**
 * Whether the version the lock has for `dep` is one `owner`'s Requires-Dist
 * admits; a problem when it is not, or when its line cannot be read here.
 */
function admissionProblem(owner: string, dist: Resolved['distributions'][string], dep: string, locked: string): string | null {
  const lines = dist.requiresDist.map((raw) => ({ raw, req: requirementOf(raw) })).filter(({ req }) => req?.name === dep && !req.extra)
  if (lines.length === 0) return `${owner} -> ${dep}: no Requires-Dist line names it`
  const verdicts = lines.map(({ req }) => admits(req!.specifier, locked))
  if (verdicts.includes(true)) return null
  if (verdicts.includes(null)) return `${owner} -> ${lines.map((l) => l.raw).join(' | ')}: a specifier this check cannot read`
  return `${owner} -> ${lines.map((l) => l.raw.split(';')[0].trim()).join(' | ')}, but the lock has ${dep}==${locked}`
}

/**
 * What the completeness check finds wrong with one target's lock: every
 * requirement of every lock line must be a line of the same lock, at a version
 * its specifier admits, or on the allowlist, and every line must be the file
 * resolved.json records.
 */
function unmet(
  target: PackPlatform,
  text: string,
  allowlist: Record<string, readonly string[]> = ALLOWLIST,
  resolved: Resolved = RESOLVED
): string[] {
  const { lines } = parseLock(text)
  const locked = new Map(lines.map((l) => [l.name, l.version]))
  const problems: string[] = []
  for (const line of lines) {
    const dist = resolved.distributions[line.name]
    const entry = dist?.targets[target]
    if (!dist || !entry) {
      problems.push(`${line.name} has no ${target} entry in resolved.json`)
      continue
    }
    if (dist.version !== line.version) problems.push(`${line.name}: lock ${line.version}, resolved ${dist.version}`)
    if (entry.file.sha256 !== line.sha256) problems.push(`${line.name}: lock hash is not resolved.json's file`)
    for (const dep of entry.requires) {
      if (allowlist[line.name]?.includes(dep)) continue
      const version = locked.get(dep)
      if (version === undefined) {
        problems.push(`${line.name} -> ${dep} is not in the ${target} lock`)
        continue
      }
      const problem = admissionProblem(line.name, dist, dep, version)
      if (problem) problems.push(problem)
    }
  }
  return problems
}

/** The excluded packages a lock has a line for: none, ever (pack_lock.py's walk refuses them). */
function excludedIn(text: string): string[] {
  const names = new Set(parseLock(text).lines.map((l) => l.name))
  return EXCLUDED.filter((left) => names.has(left))
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

  it.each(TARGETS)('fails a lock version a dependent does not admit, naming both (a scratch copy, %s)', (target) => {
    // numpy at 1.0.0 in the lock and in resolved.json alike, so only the specifiers can see it.
    const text = lockText(target)
    const hits = [...text.matchAll(/^numpy==(\S+) /gm)]
    expect(hits).toHaveLength(1)
    const scratchText = text.replace(hits[0][0], 'numpy==1.0.0 ')
    const scratchResolved = JSON.parse(JSON.stringify(RESOLVED)) as Resolved
    scratchResolved.distributions.numpy.version = '1.0.0'
    const problems = unmet(target, scratchText, ALLOWLIST, scratchResolved)
    expect(problems.filter((p) => p.endsWith('but the lock has numpy==1.0.0')).length).toBeGreaterThan(0)
    // e.g. librosa's numpy>=2.1.0 (resolved.json's own line)
    expect(problems).toContain('librosa -> numpy>=2.1.0, but the lock has numpy==1.0.0')
  })

  it('reads the specifier shapes these METADATA files use, as PEP 440 does', () => {
    const cases: Array<[string, string, boolean | null]> = [
      ['', '1.0', true],
      ['>=2023.5.7', '2026.7.22', true],
      ['<4,>=2', '3.4.3', true],
      ['<4,>=2', '4.0', false],
      ['<9.0.0,>=8.4.2', '8.4.1', false],
      ['~=2.3', '2.5.0', true],
      ['~=2.3', '3.0', false],
      ['~=2.3', '2.2.9', false],
      ['~=25.9', '25.12.19', true],
      ['~=0.5', '0.5.6', true],
      ['==1.*', '1.0.9', true],
      ['==1.*', '2.0', false],
      ['!=1.2', '1.2.0', false],
      ['!=1.2', '1.2.1', true],
      ['==3.0', '3', true],
      ['<0.50,>=0.49.0dev0', '0.49.0', true],
      ['<0.50,>=0.49.0dev0', '0.50.0', false],
      ['>=0.49.0', '0.49.0rc1', false],
      ['>=0.49.0dev0', '0.49.0a1', true],
      ['<0.49.0a1', '0.49.0dev0', true],
      ['>1.0', '1.0.post1', true],
      ['===1.0', '1.0', null],
      ['>=1.0,@ https://example.org/x.whl', '1.0', null],
      ['>=1.0', 'not-a-version', null]
    ]
    for (const [specifier, version, want] of cases) expect(admits(specifier, version), `${version} against "${specifier}"`).toBe(want)
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

  it("huggingface-hub's hf-xet is required on both targets, passes only through the allowlist, and no lock has it", () => {
    for (const target of TARGETS) {
      // huggingface-hub asks for it on arm64 and x86_64 alike (its marker, evaluated by the generator).
      expect(RESOLVED.distributions['huggingface-hub'].targets[target]?.requires).toContain('hf-xet')
      expect(parseLock(lockText(target)).lines.map((l) => l.name)).toContain('huggingface-hub')
      expect(excludedIn(lockText(target)), target).toEqual([])
      const withoutIt = unmet(target, lockText(target), { mediapipe: ALLOWLIST.mediapipe })
      expect(withoutIt).toContain(`huggingface-hub -> hf-xet is not in the ${target} lock`)
    }
  })

  it('an excluded package back in a lock is named (a scratch copy)', () => {
    for (const target of TARGETS) expect(excludedIn(lockText(target)), target).toEqual([])
    // pack 1's own line, as the Mac lock had it.
    const scratch = `${lockText('darwin-arm64')}hf-xet==1.6.0 --hash=sha256:f0906082d9932ae0c0057fa194041c22b4e2cdb46b2592ef3b91f020d62a081a\n`
    expect(excludedIn(scratch)).toEqual(['hf-xet'])
  })

  it("resolved.json's excluded list is this test's", () => {
    expect([...RESOLVED.excluded].sort()).toEqual([...EXCLUDED].sort())
    for (const left of EXCLUDED) expect(RESOLVED.distributions[left], left).toBeUndefined()
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
