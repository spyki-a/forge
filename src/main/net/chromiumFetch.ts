/**
 * A `fetch` on Chromium's network stack, for the AI helper pack's files
 * (docs/CLIPS.md §3a.5, §15 row 19), shaped as `fetchVerified` needs it.
 *
 * Why not Electron's `net.fetch` itself. Measured on Electron 44.3.0 against
 * the pinned interpreter's URL (scripts/probe-netfetch.mjs, 2026-10-16):
 *
 *   - `redirect: 'manual'` REJECTS on github.com's 302 with "Redirect was
 *     cancelled": no 3xx, no Location, not even the spec's opaque redirect;
 *   - after `redirect: 'follow'`, `response.url` is "" and `redirected` is
 *     false, so the host the file came from cannot be read off the answer.
 *
 * Either way the fetcher could no longer name the host after the redirect
 * (release-assets.githubusercontent.com), which is the point of following
 * redirects by hand (fetchFile.ts `redirects: 'by hand'`). `net.request`,
 * the ClientRequest under net.fetch, can: in its `'manual'` mode it emits
 * `'redirect'` with the 302 and the next URL (measured), and this hands that
 * back as Node's fetch does with `redirect: 'manual'` (a 3xx Response with
 * its Location), so fetchFile follows each hop itself, unchanged. With
 * `'follow'` it calls `followRedirect()` and sets the Response's `url`.
 *
 * What else was measured there: a range to the hop answers 206 with its
 * Content-Range and Content-Length; the body streams (83 chunks over 4 MiB);
 * the system proxy resolves per URL (`session.resolveProxy`, "DIRECT" on the
 * dev Mac); and every network failure is a plain `Error` whose message is
 * Chromium's code (`net::ERR_NAME_NOT_RESOLVED`, `net::ERR_CONNECTION_REFUSED`,
 * `net::ERR_PROXY_CONNECTION_FAILED` for a dead proxy and for a proxy whose
 * name does not resolve), with no `code` and no cause. fetchFile.ts reads
 * those messages as network codes, and a proxy's failure is given the proxy
 * this resolves (`proxy` on the error), so its sentence names the proxy.
 *
 * Every request is `cache: 'no-store'`: 205 MB of wheels must not land in
 * Chromium's disk cache under userData as well as in the pack.
 *
 * Electron-free: `request` and `resolveProxy` are handed in (installDeps.ts
 * passes `net.request` and the default session's `resolveProxy`), so
 * tests/fetchFile.test.ts drives this with a fake ClientRequest.
 */

/** What this asks `request` for. */
export interface NetRequestOptions {
  url: string
  method: string
  redirect: 'manual'
  cache: 'no-store'
}

/** The part of Electron's IncomingMessage this reads (it is a Readable: pause and resume are there). */
export interface NetResponseLike {
  statusCode: number
  statusMessage: string
  headers: Record<string, string | string[]>
  on(event: 'data' | 'end' | 'error' | 'aborted', listener: (...args: never[]) => void): unknown
  pause?(): unknown
  resume?(): unknown
}

/** The part of Electron's ClientRequest this drives. */
export interface NetRequestLike {
  on(event: 'redirect' | 'response' | 'error', listener: (...args: never[]) => void): unknown
  setHeader(name: string, value: string): void
  followRedirect(): void
  abort(): void
  end(): void
}

export interface ChromiumFetchDeps {
  request(options: NetRequestOptions): NetRequestLike
  /** `session.resolveProxy`: "DIRECT", or "PROXY host:port" (several, `;`-separated). Asked only when a proxy failed. */
  resolveProxy?(url: string): Promise<string>
}

/** Chromium's errors that mean the PROXY failed, not the host behind it. */
export const CHROMIUM_PROXY_ERRORS: ReadonlySet<string> = new Set([
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_TUNNEL_CONNECTION_FAILED',
  'ERR_PROXY_AUTH_UNSUPPORTED',
  'ERR_PROXY_AUTH_REQUESTED',
  'ERR_PROXY_CERTIFICATE_INVALID',
  'ERR_MANDATORY_PROXY_CONFIGURATION_FAILED'
])

/** `ERR_NAME_NOT_RESOLVED` from Chromium's `net::ERR_NAME_NOT_RESOLVED`; null for any other message. */
export function chromiumCode(message: unknown): string | null {
  const m = typeof message === 'string' ? /^net::(ERR_[A-Z0-9_]+)$/.exec(message.trim()) : null
  return m ? m[1] : null
}

/** The first proxy in `resolveProxy`'s answer ("PROXY a:1; DIRECT" → "a:1"); null for DIRECT or nothing. */
export function firstProxy(resolved: string): string | null {
  for (const part of resolved.split(';')) {
    const m = /^\s*(PROXY|HTTPS|SOCKS|SOCKS4|SOCKS5|QUIC)\s+(\S+)\s*$/i.exec(part)
    if (m) return m[2]
  }
  return null
}

/** Where a proxy setting comes from, for the sentence: the system's settings, which Chromium reads. */
export const SYSTEM_PROXY_SOURCE = "this computer's proxy settings"

const NULL_BODY = new Set([101, 103, 204, 205, 304])

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('This operation was aborted', 'AbortError')
}

function headerPairs(headers: Record<string, string | string[]>): [string, string][] {
  return Object.entries(headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value])
}

/** The Response, with the URL it came from after any redirect followed (a constructed Response has none). */
function at(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', { value: url })
  return response
}

/** Redirects followed in `'follow'` mode before giving up: Chromium's own limit. */
export const CHROMIUM_MAX_REDIRECTS = 20

export function chromiumFetch(deps: ChromiumFetchDeps): typeof globalThis.fetch {
  return ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const mode = init?.redirect ?? 'follow'
    const signal = init?.signal ?? undefined
    return new Promise<Response>((resolve, reject) => {
      if (signal?.aborted) return reject(abortReason(signal))
      let current = url
      let hops = 0
      /** The answer is out (resolved or rejected): from here only the body can fail. */
      let settled = false
      let body: { error(e: unknown): void } | null = null

      const request = deps.request({ url, method: init?.method ?? 'GET', redirect: 'manual', cache: 'no-store' })
      const onAbort = (): void => {
        request.abort()
        const reason = abortReason(signal!)
        if (!settled) {
          settled = true
          reject(reason)
        }
        body?.error(reason)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const done = (): void => signal?.removeEventListener('abort', onAbort)
      const fail = (err: unknown): void => {
        if (settled) return
        settled = true
        done()
        reject(err)
      }

      new Headers(init?.headers).forEach((value, name) => request.setHeader(name, value))

      request.on('redirect', ((statusCode: number, _method: string, redirectUrl: string) => {
        if (settled) return
        if (mode === 'follow') {
          if (++hops > CHROMIUM_MAX_REDIRECTS) {
            request.abort()
            fail(new TypeError(`redirected more than ${CHROMIUM_MAX_REDIRECTS} times`))
            return
          }
          current = redirectUrl
          request.followRedirect()
          return
        }
        request.abort()
        if (mode === 'error') {
          fail(new TypeError(`the answer was a redirect (${statusCode}), and redirects were refused`))
          return
        }
        // 'manual': the 3xx itself, with its Location, as Node's fetch hands it back.
        settled = true
        done()
        resolve(at(new Response(null, { status: statusCode, headers: { location: redirectUrl } }), current))
      }) as (...args: never[]) => void)

      request.on('response', ((response: NetResponseLike) => {
        if (settled) return
        settled = true
        let stream: ReadableStream<Uint8Array> | null = null
        if (!NULL_BODY.has(response.statusCode)) {
          let ended = false
          let paused = false
          stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const error = (e: unknown): void => {
                if (ended) return
                ended = true
                done()
                controller.error(e)
              }
              body = { error }
              response.on('data', ((chunk: Uint8Array) => {
                if (ended) return
                controller.enqueue(new Uint8Array(chunk))
                if ((controller.desiredSize ?? 1) <= 0 && response.pause) {
                  paused = true
                  response.pause()
                }
              }) as (...args: never[]) => void)
              response.on('end', () => {
                if (ended) return
                ended = true
                done()
                controller.close()
              })
              response.on('error', ((e: Error) => error(e)) as (...args: never[]) => void)
              response.on('aborted', () => error(signal?.aborted ? abortReason(signal) : new Error('net::ERR_ABORTED')))
            },
            pull() {
              if (paused && response.resume) {
                paused = false
                response.resume()
              }
            },
            cancel() {
              ended = true
              done()
              request.abort()
            }
          })
        } else done()
        resolve(at(new Response(stream, { status: response.statusCode, statusText: response.statusMessage, headers: headerPairs(response.headers) }), current))
      }) as (...args: never[]) => void)

      request.on('error', ((err: Error) => {
        if (settled) {
          body?.error(err)
          return
        }
        const code = chromiumCode(err?.message)
        if (code && CHROMIUM_PROXY_ERRORS.has(code) && deps.resolveProxy) {
          // Which proxy, so the sentence can name it rather than the host behind it.
          deps
            .resolveProxy(current)
            .then((resolved) => Object.assign(err, { proxy: { address: firstProxy(resolved), source: SYSTEM_PROXY_SOURCE } }))
            .catch(() => Object.assign(err, { proxy: { address: null, source: SYSTEM_PROXY_SOURCE } }))
            .finally(() => fail(err))
          return
        }
        fail(err)
      }) as (...args: never[]) => void)

      request.end()
    })
  }) as typeof globalThis.fetch
}
