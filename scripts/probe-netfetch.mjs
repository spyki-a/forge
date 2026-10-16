/**
 * Electron's `net.fetch` against the AI helper pack's real hosts (docs/CLIPS.md
 * §15 row 19, §3a.5 "Waits for row 19"): what the install job's fetcher would
 * meet if it ran on Chromium's network stack instead of Node's.
 *
 *     npx electron scripts/probe-netfetch.mjs [out.json]
 *
 * An Electron MAIN-process script: it needs Electron's binary, so it runs on a
 * real machine, not in a sandbox that cannot start one. It fetches a few bytes
 * of the pinned interpreter and one small wheel, and records, as JSON (to
 * out.json, default `tests/output/probe-netfetch.json`) and on stdout:
 *
 *   - `redirect: 'manual'` on github.com's URL: a 302 with its Location, as
 *     Node's fetch gives (undici, "not compliant on purpose"), or the spec's
 *     opaque redirect (status 0, no headers), or a followed answer;
 *   - `redirect: 'follow'` with `Range: bytes=0-1023`: the status (206?),
 *     `response.url` after the hop, Content-Range, Content-Length,
 *     Content-Encoding and Content-Type as Chromium exposes them;
 *   - whether the body streams: chunk sizes and times over the first 4 MiB
 *     of the interpreter, and a whole wheel against its pinned sha256;
 *   - the system proxy Chromium resolves for each host, and the proxy
 *     variables in the environment (names, and host:port only);
 *   - the errors' shapes, which the fetcher's retry and its sentences read:
 *     a name that does not resolve, a refused port, a dead proxy, a proxy
 *     whose name does not resolve, a cancel before the answer and one in the
 *     body. Each through `session.fetch` on a session of its own, so nothing
 *     here touches the default session's proxy.
 *
 * Nothing is written but out.json. The app quits when done.
 */

import { app, net, session } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { manifestFromText, MANIFEST_PATH } from './probe-pack-urls.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(process.argv.slice(2).find((a) => a.endsWith('.json')) ?? join(REPO, 'tests', 'output', 'probe-netfetch.json'))

const manifest = manifestFromText(readFileSync(MANIFEST_PATH, 'utf8'))
const INTERPRETER = manifest.platforms['darwin-arm64'].interpreter
const WHEEL = manifest.platforms['darwin-arm64'].wheels.reduce((a, b) => (b.bytes < a.bytes ? b : a))

/** Every header, as Chromium hands them back. */
const headersOf = (response) => Object.fromEntries([...response.headers.entries()])

/** An error's whole shape: what the fetcher's `networkCode` and `reasonOf` would read. */
function shapeOf(err, depth = 0) {
  if (!err || typeof err !== 'object' || depth > 4) return err === undefined ? null : String(err)
  return {
    constructor: err.constructor?.name ?? null,
    name: err.name ?? null,
    message: err.message ?? null,
    code: err.code ?? null,
    errno: err.errno ?? null,
    keys: Object.keys(err),
    string: String(err),
    cause: err.cause === undefined ? null : shapeOf(err.cause, depth + 1)
  }
}

/** A proxy URL with no user or password in it. */
function bare(value) {
  try {
    const u = new URL(value)
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}`
  } catch {
    return '(not a URL)'
  }
}

async function step(name, body) {
  const at = Date.now()
  try {
    const result = await body()
    return { name, ok: true, ms: Date.now() - at, ...result }
  } catch (err) {
    return { name, ok: false, ms: Date.now() - at, error: shapeOf(err) }
  }
}

/** Read a body chunk by chunk, up to `limit` bytes, timing each chunk; cancel the rest. */
async function readChunks(response, limit, hash) {
  const reader = response.body.getReader()
  const started = Date.now()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    hash?.update(value)
    if (chunks.length < 400) chunks.push({ at: Date.now() - started, bytes: value.length })
    if (total >= limit) {
      await reader.cancel()
      break
    }
  }
  return { total, chunkCount: chunks.length, firstChunkMs: chunks[0]?.at ?? null, lastChunkMs: chunks.at(-1)?.at ?? null, sizes: [...new Set(chunks.map((c) => c.bytes))].slice(0, 12), chunks: chunks.slice(0, 40) }
}

async function main() {
  await app.whenReady()
  const report = {
    when: new Date().toISOString(),
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    platform: `${process.platform}-${process.arch}`,
    online: net.isOnline(),
    files: { interpreter: { name: INTERPRETER.name, url: INTERPRETER.url, bytes: INTERPRETER.bytes }, wheel: { name: WHEEL.name, url: WHEEL.url, bytes: WHEEL.bytes } },
    environmentProxies: Object.fromEntries(
      ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY']
        .filter((k) => process.env[k] !== undefined)
        .map((k) => [k, /no_proxy|NODE_USE/i.test(k) ? process.env[k] : bare(process.env[k])])
    ),
    systemProxy: {},
    steps: []
  }
  for (const url of [INTERPRETER.url, 'https://release-assets.githubusercontent.com/', WHEEL.url]) {
    report.systemProxy[new URL(url).hostname] = await session.defaultSession.resolveProxy(url)
  }

  report.steps.push(
    await step("redirect 'manual' on github.com", async () => {
      const r = await net.fetch(INTERPRETER.url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })
      const out = { status: r.status, statusText: r.statusText, type: r.type, ok: r.ok, redirected: r.redirected, url: r.url, headers: headersOf(r), hasBody: r.body !== null }
      await r.body?.cancel().catch(() => undefined)
      return out
    })
  )

  report.steps.push(
    await step("redirect 'follow' with Range: bytes=0-1023", async () => {
      const r = await net.fetch(INTERPRETER.url, { redirect: 'follow', headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(30_000) })
      const out = { status: r.status, type: r.type, redirected: r.redirected, url: r.url, headers: headersOf(r) }
      const body = await readChunks(r, 1 << 20)
      return { ...out, bodyBytes: body.total }
    })
  )

  report.steps.push(
    await step('the interpreter, streamed: the first 4 MiB', async () => {
      const r = await net.fetch(INTERPRETER.url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) })
      const out = { status: r.status, url: r.url, contentLength: r.headers.get('content-length'), contentEncoding: r.headers.get('content-encoding'), contentType: r.headers.get('content-type') }
      return { ...out, body: await readChunks(r, 4 << 20) }
    })
  )

  report.steps.push(
    await step(`the smallest wheel, whole, against its pin (${WHEEL.bytes} B)`, async () => {
      const r = await net.fetch(WHEEL.url, { redirect: 'manual', signal: AbortSignal.timeout(60_000) })
      const hash = createHash('sha256')
      const out = { status: r.status, type: r.type, url: r.url, headers: headersOf(r) }
      const body = await readChunks(r, Number.MAX_SAFE_INTEGER, hash)
      return { ...out, body: { total: body.total, chunkCount: body.chunkCount }, sha256Matches: hash.digest('hex') === WHEEL.sha256 }
    })
  )

  // The errors, each on a session of its own (no cache, nothing shared with the default session's proxy).
  const own = async (name, proxyRules) => {
    const s = session.fromPartition(`probe-netfetch-${name}`, { cache: false })
    if (proxyRules) await s.setProxy({ proxyRules })
    return s
  }
  report.steps.push(await step('a host whose name does not resolve', async () => {
    const s = await own('nxdomain')
    await s.fetch('https://forge-probe.invalid/x', { signal: AbortSignal.timeout(30_000) })
    return { unexpected: 'it answered' }
  }))
  report.steps.push(await step('a refused port (127.0.0.1:9)', async () => {
    const s = await own('refused')
    await s.fetch('https://127.0.0.1:9/x', { signal: AbortSignal.timeout(30_000) })
    return { unexpected: 'it answered' }
  }))
  report.steps.push(await step('a dead proxy (http://127.0.0.1:9) before github.com', async () => {
    const s = await own('deadproxy', 'http://127.0.0.1:9')
    const proxy = await s.resolveProxy(INTERPRETER.url)
    try {
      await s.fetch(INTERPRETER.url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    } catch (err) {
      return { resolved: proxy, error: shapeOf(err) }
    }
    return { resolved: proxy, unexpected: 'it answered' }
  }))
  report.steps.push(await step('a proxy whose name does not resolve, before github.com', async () => {
    const s = await own('nxproxy', 'http://forge-probe-proxy.invalid:3128')
    const proxy = await s.resolveProxy(INTERPRETER.url)
    try {
      await s.fetch(INTERPRETER.url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    } catch (err) {
      return { resolved: proxy, error: shapeOf(err) }
    }
    return { resolved: proxy, unexpected: 'it answered' }
  }))
  report.steps.push(await step('a cancel before the answer', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 1)
    await net.fetch(INTERPRETER.url, { redirect: 'follow', signal: controller.signal })
    return { unexpected: 'it answered before a 1 ms cancel' }
  }))
  report.steps.push(await step('a cancel in the body', async () => {
    const controller = new AbortController()
    const r = await net.fetch(INTERPRETER.url, { redirect: 'follow', signal: controller.signal })
    const reader = r.body.getReader()
    const first = await reader.read()
    controller.abort()
    try {
      for (;;) {
        const { done } = await reader.read()
        if (done) return { firstChunk: first.value?.length ?? 0, unexpected: 'the body ended normally after the abort' }
      }
    } catch (err) {
      return { firstChunk: first.value?.length ?? 0, readError: shapeOf(err) }
    }
  }))

  // net.request, the ClientRequest net.fetch is built on: its own manual redirect ('redirect' event, then followRedirect or not).
  const request = (options, o = {}) =>
    new Promise((done) => {
      const events = []
      const at = Date.now()
      const req = net.request(options)
      for (const [k, v] of Object.entries(o.headers ?? {})) req.setHeader(k, v)
      const timer = setTimeout(() => (events.push({ at: Date.now() - at, event: 'timeout' }), req.abort(), done({ events })), 30_000)
      const finish = (extra) => {
        clearTimeout(timer)
        done({ events, ...extra })
      }
      req.on('redirect', (statusCode, method, redirectUrl, responseHeaders) => {
        events.push({ at: Date.now() - at, event: 'redirect', statusCode, method, redirectUrl, headerNames: Object.keys(responseHeaders ?? {}) })
        if (o.follow) req.followRedirect()
        else {
          req.abort()
          finish({ stoppedAtRedirect: true })
        }
      })
      req.on('response', (response) => {
        const chunks = []
        events.push({ at: Date.now() - at, event: 'response', statusCode: response.statusCode, headers: response.headers })
        response.on('data', (chunk) => {
          if (chunks.length < 200) chunks.push(chunk.length)
          if (o.limit && chunks.reduce((a, b) => a + b, 0) >= o.limit) {
            req.abort()
            finish({ chunks: chunks.length, bytes: chunks.reduce((a, b) => a + b, 0), aborted: true })
          }
        })
        response.on('end', () => finish({ chunks: chunks.length, bytes: chunks.reduce((a, b) => a + b, 0) }))
        response.on('error', (err) => finish({ responseError: shapeOf(err) }))
      })
      req.on('abort', () => events.push({ at: Date.now() - at, event: 'abort' }))
      req.on('error', (err) => finish({ error: shapeOf(err) }))
      req.end()
    })

  report.steps.push(await step("net.request redirect 'manual': the 302's event, then stop", async () => request({ url: INTERPRETER.url, redirect: 'manual' })))
  const hop = report.steps.at(-1).events?.find((e) => e.event === 'redirect')?.redirectUrl
  if (hop) {
    report.steps.push(await step('net.request to the hop’s URL with Range: bytes=0-1023', async () => request({ url: hop, redirect: 'manual' }, { headers: { Range: 'bytes=0-1023' } })))
    report.steps.push(await step('net.request to the hop’s URL, streamed: the first 4 MiB', async () => request({ url: hop, redirect: 'manual' }, { limit: 4 << 20 })))
  }
  report.steps.push(await step("net.request redirect 'manual', followed by hand with followRedirect", async () => request({ url: INTERPRETER.url, redirect: 'manual' }, { follow: true, headers: { Range: 'bytes=0-15' } })))
  report.steps.push(await step('net.request to a name that does not resolve', async () => request({ url: 'https://forge-probe.invalid/x' })))
  report.steps.push(await step('net.request to a closed port (127.0.0.1:59999)', async () => request({ url: 'https://127.0.0.1:59999/x' })))
  {
    const s = await own('deadproxy-request', 'http://127.0.0.1:59998')
    report.steps.push(await step('net.request through a dead proxy (127.0.0.1:59998)', async () => ({ resolved: await s.resolveProxy(INTERPRETER.url), ...(await request({ url: INTERPRETER.url, redirect: 'manual', session: s })) })))
    report.steps.push(await step('session.fetch through that dead proxy', async () => {
      try {
        await s.fetch(INTERPRETER.url, { signal: AbortSignal.timeout(30_000) })
      } catch (err) {
        return { error: shapeOf(err) }
      }
      return { unexpected: 'it answered' }
    }))
  }
  report.steps.push(await step('session.fetch to a closed port (127.0.0.1:59999)', async () => {
    const s = await own('closed')
    try {
      await s.fetch('https://127.0.0.1:59999/x', { signal: AbortSignal.timeout(30_000) })
    } catch (err) {
      return { error: shapeOf(err) }
    }
    return { unexpected: 'it answered' }
  }))
  // Whether a session's webRequest sees net.fetch's redirect (the other way to learn the host after it).
  {
    const s = await own('webrequest')
    const seen = []
    s.webRequest.onBeforeRedirect((details) => seen.push({ event: 'beforeRedirect', url: details.url, redirectURL: details.redirectURL, statusCode: details.statusCode }))
    s.webRequest.onCompleted((details) => seen.push({ event: 'completed', url: details.url, statusCode: details.statusCode }))
    s.webRequest.onErrorOccurred((details) => seen.push({ event: 'error', url: details.url, error: details.error }))
    report.steps.push(await step("webRequest events for session.fetch 'follow'", async () => {
      const r = await s.fetch(INTERPRETER.url, { headers: { Range: 'bytes=0-15' }, signal: AbortSignal.timeout(30_000) })
      await r.arrayBuffer()
      await new Promise((resolve) => setTimeout(resolve, 200))
      return { status: r.status, url: r.url, seen }
    }))
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  for (const s of report.steps) console.log(`${s.ok ? 'ok  ' : 'ERR '} ${s.name} (${s.ms} ms)${s.status !== undefined ? ` status ${s.status}` : ''}${s.error ? `: ${s.error.message}` : ''}`)
  console.log(`system proxy: ${JSON.stringify(report.systemProxy)}`)
  console.log(`written: ${OUT}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => app.quit())
