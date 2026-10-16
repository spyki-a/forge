#!/usr/bin/env node
/**
 * Every file the AI helper's pack pins, asked for once (docs/CLIPS.md §3a.6
 * step 1, §16.48): both platforms' interpreters and wheels, each with a
 * one-byte range GET (`Range: bytes=0-0`) that follows its redirects, judged
 * on what came back:
 *
 *   - 200 or 206, and nothing else (a 404 is a pin deleted from PyPI or a
 *     release asset gone from GitHub);
 *   - the length the manifest pins: a 206's Content-Range total, or a 200's
 *     Content-Length when a host ignores the range (its body is never read);
 *   - landing on a host the row and the guide name (§16.40 (a), pack.ts
 *     `packHosts`): the URL's own, and release-assets.githubusercontent.com
 *     behind github.com. A redirect that moves to another host would still
 *     install, and would break every tester whose network allows only the
 *     named hosts, so it fails here first.
 *
 * Run on EVERY push, cache or not: the cached pack would keep CI green
 * through a pin that is gone, while every tester's Install failed.
 *
 *     node scripts/probe-pack-urls.mjs
 *
 * One line per file; exit 1 on any failure, listing them (and as GitHub
 * annotations under Actions, readable without a sign-in). Exit 2 when the
 * manifest itself cannot be read. A failure that could be the network's (no
 * answer, a 5xx, 429 or 408) is asked again, twice, before it counts.
 *
 * Node 24, no dependencies. The manifest is imported as it is
 * (src/shared/sidecar/packManifest.ts, whose only import is a type: Node's
 * own type stripping runs it) and, where that cannot run, read from the
 * generated file's literals (`manifestFromText`, which tests/probePackUrls
 * holds equal to the import). Behind a proxy, Node's fetch needs
 * NODE_USE_ENV_PROXY=1 (docs/CLIPS.md §3a.5); a runner has none.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
export const MANIFEST_PATH = join(REPO, 'src', 'shared', 'sidecar', 'packManifest.ts')

/** Tries per file; the waits between them double from `firstDelayMs`. */
export const PROBE_RETRY = { tries: 3, firstDelayMs: 2_000, answerMs: 30_000 }

/** The host a URL names; the URL itself when it will not parse. */
export function hostOf(url) {
  try {
    return new URL(url).hostname || url
  } catch {
    return url
  }
}

/**
 * The hosts a file may land on after its redirects: its URL's own, and for
 * github.com the release-assets host it hands off to (measured 2026-10-14).
 * The same rule as `packHosts` in src/shared/sidecar/pack.ts, which names
 * them on the row and in the guide; tests/probePackUrls.test.ts holds the
 * two equal over the real manifest.
 */
export function expectedHosts(url) {
  const host = hostOf(url)
  return host === 'github.com' ? [host, 'release-assets.githubusercontent.com'] : [host]
}

/** A failure, in words, from fetch's error and its cause (fetch says only "fetch failed"). */
function reasonOf(err) {
  if (!(err instanceof Error)) return String(err)
  const cause = err.cause
  const detail = cause && typeof cause === 'object' ? (typeof cause.message === 'string' && cause.message) || (typeof cause.code === 'string' && cause.code) || '' : ''
  return detail && !err.message.includes(detail) ? `${err.message} (${detail})` : err.message
}

/**
 * The manifest's files from its generated text: each is a `{ name, url,
 * bytes, sha256 }` literal, in order, under a `'<platform>': {` key, the
 * interpreter first. Only what the probe needs.
 */
export function manifestFromText(text) {
  const keys = [...text.matchAll(/^ {4}'([a-z0-9]+-[a-z0-9_]+)': \{$/gm)]
  if (keys.length === 0) throw new Error('no platform in the manifest text')
  const platforms = {}
  keys.forEach((key, i) => {
    const slice = text.slice(key.index, i + 1 < keys.length ? keys[i + 1].index : text.length)
    const files = [...slice.matchAll(/name: '([^']+)',\s*url: '([^']+)',\s*bytes: ([\d_]+),\s*sha256: '([0-9a-f]{64})'/g)].map((m) => ({
      name: m[1],
      url: m[2],
      bytes: Number(m[3].replace(/_/g, '')),
      sha256: m[4]
    }))
    const interpreterAt = slice.indexOf('interpreter:')
    const wheelsAt = slice.indexOf('wheels:')
    if (files.length === 0 || interpreterAt < 0 || wheelsAt < interpreterAt) throw new Error(`${key[1]}: no interpreter and wheels in the manifest text`)
    platforms[key[1]] = { interpreter: files[0], wheels: files.slice(1) }
  })
  return { platforms }
}

/** The manifest: imported as it is, else read from its literals. Says which. */
export async function loadManifest(path = MANIFEST_PATH) {
  try {
    const module = await import(pathToFileURL(path).href)
    if (module.HELPER_PACK?.platforms) return { manifest: module.HELPER_PACK, how: 'imported' }
    throw new Error('no HELPER_PACK in it')
  } catch (err) {
    return { manifest: manifestFromText(readFileSync(path, 'utf8')), how: `read from its literals (the import failed: ${reasonOf(err)})` }
  }
}

/**
 * Every pinned file once per URL, with the platforms that pin it. A URL two
 * platforms pin (a py3-none-any wheel) is asked for once; pinned with two
 * different lengths or hashes, it is a manifest fault and reported as one.
 */
export function filesOf(manifest) {
  const byUrl = new Map()
  const faults = []
  for (const [platform, pack] of Object.entries(manifest.platforms)) {
    for (const file of [pack.interpreter, ...pack.wheels]) {
      const seen = byUrl.get(file.url)
      if (!seen) byUrl.set(file.url, { ...file, platforms: [platform] })
      else if (seen.bytes !== file.bytes || seen.sha256 !== file.sha256) faults.push(`${file.name}: ${platform} pins ${file.bytes} B, ${seen.platforms.join(', ')} ${seen.bytes} B, for one URL`)
      else seen.platforms.push(platform)
    }
  }
  return { files: [...byUrl.values()], faults }
}

/**
 * One answer, judged. `transient` says whether asking again could change it:
 * a 5xx, 429 or 408 can; a 404, a wrong length or a host off the list cannot.
 */
export function judge(file, response) {
  const host = hostOf(response.url || file.url)
  const status = response.status
  if (status !== 200 && status !== 206) {
    return { ok: false, transient: status >= 500 || status === 429 || status === 408, status, host, reason: `${host} answered ${status}` }
  }
  const allowed = expectedHosts(file.url)
  if (!allowed.includes(host)) {
    return { ok: false, transient: false, status, host, reason: `landed on ${host}, which is not a host the row and the guide name (${allowed.join(', ')})` }
  }
  let total
  if (status === 206) {
    const range = response.headers.get('content-range')
    const m = range === null ? null : /^bytes\s+\d+-\d+\/(\d+)$/i.exec(range.trim())
    if (!m) return { ok: false, transient: false, status, host, reason: `${host} answered 206 with no total in its Content-Range (${range ?? 'none'})` }
    total = Number(m[1])
  } else {
    const encoding = response.headers.get('content-encoding')
    if (encoding && encoding.toLowerCase() !== 'identity') {
      return { ok: false, transient: false, status, host, reason: `${host} ignored the range and sent the file ${encoding}-encoded, so its length cannot be compared` }
    }
    const length = response.headers.get('content-length')
    if (length === null) return { ok: false, transient: false, status, host, reason: `${host} ignored the range and sent no Content-Length` }
    total = Number(length)
  }
  if (total !== file.bytes) {
    return { ok: false, transient: false, status, host, reason: `${host} says the file is ${total} B; the manifest pins ${file.bytes} B` }
  }
  return { ok: true, transient: false, status, host, reason: null }
}

/** One file: asked for, judged, and asked again while the failure could be the network's. */
export async function probeFile(file, o) {
  const tries = o.tries ?? PROBE_RETRY.tries
  const sleep = o.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  let delay = o.firstDelayMs ?? PROBE_RETRY.firstDelayMs
  for (let tried = 1; ; tried++) {
    let result
    try {
      const response = await o.fetch(file.url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(o.answerMs ?? PROBE_RETRY.answerMs)
      })
      // The byte (or, from a host that ignores the range, the file) is never read.
      await response.body?.cancel().catch(() => undefined)
      result = judge(file, response)
    } catch (err) {
      result = { ok: false, transient: true, status: null, host: hostOf(file.url), reason: `${hostOf(file.url)} could not be reached: ${reasonOf(err)}` }
    }
    if (result.ok || !result.transient || tried >= tries) return { ...result, tries: tried }
    await sleep(delay)
    delay *= 2
  }
}

/** Each of `items` through `work`, `width` at a time, in order. */
async function pool(items, width, work) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await work(items[i])
      }
    })
  )
  return results
}

/**
 * The whole probe. Returns the exit code; writes one line per file to `out`
 * and, under GitHub Actions, one `::error` annotation per failure to `out`.
 */
export async function main(o = {}) {
  const out = o.out ?? ((line) => console.log(line))
  const env = o.env ?? process.env
  let manifest = o.manifest
  if (!manifest) {
    try {
      const loaded = await loadManifest()
      manifest = loaded.manifest
      out(`the manifest, ${loaded.how}: ${MANIFEST_PATH}`)
    } catch (err) {
      out(`the manifest could not be read: ${reasonOf(err)}`)
      return 2
    }
  }
  const started = Date.now()
  const { files, faults } = filesOf(manifest)
  const results = await pool(files, o.width ?? 6, (file) => probeFile(file, { fetch: o.fetch ?? globalThis.fetch, sleep: o.sleep, tries: o.tries, firstDelayMs: o.firstDelayMs }))
  const failures = [...faults]
  files.forEach((file, i) => {
    const r = results[i]
    const where = `[${file.platforms.join(', ')}]`
    const again = r.tries > 1 ? ` (${r.tries} tries)` : ''
    if (r.ok) out(`ok   ${r.status}  ${r.host}  ${file.bytes} B  ${file.name} ${where}${again}`)
    else {
      out(`FAIL ${r.status ?? '---'}  ${file.name} ${where}: ${r.reason}${again}`)
      failures.push(`${file.name} ${where}: ${r.reason}`)
    }
  })
  const pinned = Object.values(manifest.platforms).reduce((n, p) => n + 1 + p.wheels.length, 0)
  const hosts = [...new Set(results.filter((r) => r.ok).map((r) => r.host))].sort()
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  if (failures.length === 0) {
    out(`all ${files.length} URLs (${pinned} pinned files over ${Object.keys(manifest.platforms).length} platforms) answered with their pinned lengths in ${seconds} s, from ${hosts.join(', ')}`)
    return 0
  }
  out(`${failures.length} of ${files.length} URLs failed (in ${seconds} s):`)
  for (const failure of failures) {
    out(`  ${failure}`)
    if (env.GITHUB_ACTIONS === 'true') out(`::error title=The AI helper pack's URL probe::${failure.replace(/\r?\n/g, ' ')}`)
  }
  return 1
}

/** Run as `node scripts/probe-pack-urls.mjs`, not imported by a test (paths compared without case on win32). */
function invokedDirectly() {
  if (!process.argv[1]) return false
  const self = fileURLToPath(import.meta.url)
  const argv = resolve(process.argv[1])
  return process.platform === 'win32' ? self.toLowerCase() === argv.toLowerCase() : self === argv
}

if (invokedDirectly()) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err)
      process.exit(2)
    }
  )
}
