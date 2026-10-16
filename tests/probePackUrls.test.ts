import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { expectedHosts, filesOf, judge, main, MANIFEST_PATH, manifestFromText, probeFile, type ProbeManifest, type ProbedFile } from '../scripts/probe-pack-urls.mjs'
import { HELPER_PACK } from '../src/shared/sidecar/packManifest'
import { packHosts } from '../src/shared/sidecar/pack'

/*
 * The URL probe CI runs on every push (scripts/probe-pack-urls.mjs,
 * docs/CLIPS.md §3a.6 step 1): each pinned file asked for with a one-byte
 * range, and judged on its status, its length and the host it landed on. The
 * network here is a fake fetch, scripted per URL; the real run's result is in
 * the commit that added this (every URL answered, 2026-10-16).
 */

const WHEEL: ProbedFile = {
  name: 'absl_py-2.5.0-py3-none-any.whl',
  url: 'https://files.pythonhosted.org/packages/58/0a/absl_py-2.5.0-py3-none-any.whl',
  bytes: 137_410,
  sha256: 'a'.repeat(64)
}
const INTERPRETER: ProbedFile = {
  name: 'cpython-3.14.8+20261001-aarch64-apple-darwin-install_only_stripped.tar.gz',
  url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20261001/cpython.tar.gz',
  bytes: 26_680_498,
  sha256: 'b'.repeat(64)
}

/** An answer as fetch hands it back after following redirects: `url` is where it landed. */
function answer(status: number, headers: Record<string, string>, landedAt: string): Response {
  const response = new Response(status === 204 ? null : 'x', { status, headers })
  Object.defineProperty(response, 'url', { value: landedAt })
  return response
}

type Script = Record<string, (Response | 'unreachable')[]>

function fakeFetch(script: Script): { fetch: typeof globalThis.fetch; calls: Record<string, number>; ranges: (string | null)[] } {
  const calls: Record<string, number> = {}
  const ranges: (string | null)[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const n = calls[url] ?? 0
    calls[url] = n + 1
    ranges.push(new Headers(init?.headers).get('range'))
    const replies = script[url]
    if (!replies) throw new Error(`the fake network was asked for ${url}`)
    const reply = replies[Math.min(n, replies.length - 1)]
    if (reply === 'unreachable') throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) })
    return reply
  }) as typeof globalThis.fetch
  return { fetch, calls, ranges }
}

const noWait = async (): Promise<void> => undefined

describe('one answer, judged', () => {
  it('takes a 206 whose Content-Range total is the pinned length', () => {
    const r = judge(WHEEL, answer(206, { 'content-range': 'bytes 0-0/137410', 'content-length': '1' }, WHEEL.url))
    expect(r).toMatchObject({ ok: true, status: 206, host: 'files.pythonhosted.org' })
  })

  it('refuses a 206 whose total is not the pinned length, naming both', () => {
    const r = judge(WHEEL, answer(206, { 'content-range': 'bytes 0-0/137409', 'content-length': '1' }, WHEEL.url))
    expect(r.ok).toBe(false)
    expect(r.transient).toBe(false)
    expect(r.reason).toBe('files.pythonhosted.org says the file is 137409 B; the manifest pins 137410 B')
  })

  it('takes a 200 from a host that ignores the range when its Content-Length is the pinned length, and refuses one that is not', () => {
    expect(judge(WHEEL, answer(200, { 'content-length': '137410' }, WHEEL.url)).ok).toBe(true)
    const r = judge(WHEEL, answer(200, { 'content-length': '512' }, WHEEL.url))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('says the file is 512 B; the manifest pins 137410 B')
  })

  it('refuses a 404 for good, and a 503 as something asking again could change', () => {
    const gone = judge(WHEEL, answer(404, {}, WHEEL.url))
    expect(gone).toMatchObject({ ok: false, transient: false, status: 404, reason: 'files.pythonhosted.org answered 404' })
    expect(judge(WHEEL, answer(503, {}, WHEEL.url))).toMatchObject({ ok: false, transient: true, status: 503 })
  })

  it('takes github.com’s hand-off to release-assets, and refuses a landing on any other host', () => {
    const range = { 'content-range': 'bytes 0-0/26680498' }
    expect(judge(INTERPRETER, answer(206, range, 'https://release-assets.githubusercontent.com/github-production-release-asset/1/2')).ok).toBe(true)
    const moved = judge(INTERPRETER, answer(206, range, 'https://objects.githubusercontent.com/github-production-release-asset/1/2'))
    expect(moved.ok).toBe(false)
    expect(moved.reason).toContain('landed on objects.githubusercontent.com, which is not a host the row and the guide name (github.com, release-assets.githubusercontent.com)')
  })

  it('refuses a 206 with no total to compare', () => {
    expect(judge(WHEEL, answer(206, { 'content-range': 'bytes 0-0/*' }, WHEEL.url)).ok).toBe(false)
    expect(judge(WHEEL, answer(206, {}, WHEEL.url)).ok).toBe(false)
  })
})

describe('one file, asked for', () => {
  it('asks for one byte, following redirects, and asks again after a 503', async () => {
    const net = fakeFetch({ [WHEEL.url]: [answer(503, {}, WHEEL.url), answer(206, { 'content-range': 'bytes 0-0/137410' }, WHEEL.url)] })
    const r = await probeFile(WHEEL, { fetch: net.fetch, sleep: noWait })
    expect(r).toMatchObject({ ok: true, tries: 2 })
    expect(net.ranges).toEqual(['bytes=0-0', 'bytes=0-0'])
  })

  it('does not ask again after a 404 or a wrong length', async () => {
    const net = fakeFetch({ [WHEEL.url]: [answer(404, {}, WHEEL.url)] })
    expect(await probeFile(WHEEL, { fetch: net.fetch, sleep: noWait })).toMatchObject({ ok: false, tries: 1 })
    expect(net.calls[WHEEL.url]).toBe(1)
  })

  it('names the host a connection failed to reach, with the cause, after its tries', async () => {
    const net = fakeFetch({ [WHEEL.url]: ['unreachable'] })
    const r = await probeFile(WHEEL, { fetch: net.fetch, sleep: noWait, tries: 3 })
    expect(r).toMatchObject({ ok: false, tries: 3 })
    expect(r.reason).toBe('files.pythonhosted.org could not be reached: fetch failed (getaddrinfo ENOTFOUND)')
  })
})

describe('the whole probe', () => {
  const manifest: ProbeManifest = {
    platforms: {
      'darwin-arm64': { interpreter: INTERPRETER, wheels: [WHEEL] },
      'win32-x64': { interpreter: { ...INTERPRETER, url: `${INTERPRETER.url}?win`, bytes: 23_227_899 }, wheels: [WHEEL] }
    }
  }

  it('asks once per URL, a wheel both platforms pin included, and exits 0 when every one answers', async () => {
    const net = fakeFetch({
      [INTERPRETER.url]: [answer(206, { 'content-range': 'bytes 0-0/26680498' }, 'https://release-assets.githubusercontent.com/a')],
      [`${INTERPRETER.url}?win`]: [answer(206, { 'content-range': 'bytes 0-0/23227899' }, 'https://release-assets.githubusercontent.com/b')],
      [WHEEL.url]: [answer(206, { 'content-range': 'bytes 0-0/137410' }, WHEEL.url)]
    })
    const lines: string[] = []
    expect(await main({ manifest, fetch: net.fetch, out: (l) => lines.push(l), env: {}, sleep: noWait })).toBe(0)
    expect(net.calls).toEqual({ [INTERPRETER.url]: 1, [`${INTERPRETER.url}?win`]: 1, [WHEEL.url]: 1 })
    expect(lines.filter((l) => l.startsWith('ok '))).toHaveLength(3)
    expect(lines).toContain(`ok   206  files.pythonhosted.org  137410 B  ${WHEEL.name} [darwin-arm64, win32-x64]`)
  })

  it('exits 1 on one failure, listing it, and annotates it under GitHub Actions', async () => {
    const net = fakeFetch({
      [INTERPRETER.url]: [answer(206, { 'content-range': 'bytes 0-0/26680498' }, 'https://release-assets.githubusercontent.com/a')],
      [`${INTERPRETER.url}?win`]: [answer(206, { 'content-range': 'bytes 0-0/23227899' }, 'https://release-assets.githubusercontent.com/b')],
      [WHEEL.url]: [answer(404, {}, WHEEL.url)]
    })
    const lines: string[] = []
    expect(await main({ manifest, fetch: net.fetch, out: (l) => lines.push(l), env: { GITHUB_ACTIONS: 'true' }, sleep: noWait })).toBe(1)
    expect(lines).toContain(`FAIL 404  ${WHEEL.name} [darwin-arm64, win32-x64]: files.pythonhosted.org answered 404`)
    expect(lines.filter((l) => /^1 of 3 URLs failed \(in [\d.]+ s\):$/.test(l))).toHaveLength(1)
    expect(lines).toContain(`::error title=The AI helper pack's URL probe::${WHEEL.name} [darwin-arm64, win32-x64]: files.pythonhosted.org answered 404`)
  })

  it('reports one URL pinned twice with two lengths as a manifest fault', () => {
    const { faults } = filesOf({ platforms: { a: { interpreter: INTERPRETER, wheels: [WHEEL] }, b: { interpreter: INTERPRETER, wheels: [{ ...WHEEL, bytes: 1 }] } } })
    expect(faults).toEqual([`${WHEEL.name}: b pins 1 B, a 137410 B, for one URL`])
  })
})

describe('the probe reads the real manifest, and names the hosts the row names', () => {
  it('reads from the generated literals exactly the files the module exports (its fallback when the import cannot run)', () => {
    const fromText = manifestFromText(readFileSync(MANIFEST_PATH, 'utf8'))
    const pick = ({ name, url, bytes, sha256 }: ProbedFile): ProbedFile => ({ name, url, bytes, sha256 })
    expect(Object.keys(fromText.platforms)).toEqual(Object.keys(HELPER_PACK.platforms))
    for (const [platform, pack] of Object.entries(HELPER_PACK.platforms)) {
      expect(fromText.platforms[platform].interpreter, platform).toEqual(pick(pack.interpreter))
      expect(fromText.platforms[platform].wheels, platform).toEqual(pack.wheels.map(pick))
    }
  })

  it('accepts, over every pinned URL, exactly the hosts pack.ts `packHosts` puts on the row and in the guide', () => {
    for (const [platform, pack] of Object.entries(HELPER_PACK.platforms)) {
      const probed = new Set([pack.interpreter, ...pack.wheels].flatMap((f) => expectedHosts(f.url)))
      expect([...probed].sort(), platform).toEqual(packHosts(pack))
    }
  })
})
