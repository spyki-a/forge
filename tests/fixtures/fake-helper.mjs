/**
 * A stand-in AI helper for tests/sidecarClient.test.ts: Node, speaking the
 * helper's JSON-RPC over stdio, so the client's process handling (one spawn,
 * a hello that times out, a stop, a restart, the tree kill) is tested against
 * a real child without a Python in the loop.
 *
 * Run as `node fake-helper.mjs`. Told what to do by its environment:
 *
 * - FAKE_PIDS: a file each start appends its pid to, one line per process —
 *   what the test counts spawns by, rather than by the client's own report;
 * - FAKE_HELLO_MS: answer `system.hello` after this many ms (0 by default);
 *   FAKE_HELLO=never never answers it;
 * - FAKE_IGNORE_STDIN_END=1: keep running after stdin ends, so the client's
 *   kill is what ends it;
 * - FAKE_GRANDCHILD=1: start a child of its own that sleeps 60 s with its
 *   stdio ignored (a face worker's ffmpeg, in miniature), and name its pid in
 *   the hello as `grandchild` — only a tree kill ends it with this process.
 *
 * Methods: `system.hello` (with `pid`), `system.ping` (echoes), `fake.wait`
 * (answers after `params.ms`), `fake.crash` (exits with code 3).
 */
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const env = process.env
if (env.FAKE_PIDS) appendFileSync(env.FAKE_PIDS, `${process.pid}\n`)

let grandchild = null
if (env.FAKE_GRANDCHILD === '1') {
  grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', windowsHide: true })
}

const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)

const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.id === undefined) return // a cancel notification: nothing here runs long enough to stop
  const { id, method, params = {} } = message
  switch (method) {
    case 'system.hello': {
      if (env.FAKE_HELLO === 'never') return
      const answer = () =>
        write({
          id,
          result: {
            protocolVersion: 1,
            python: 'fake',
            platform: process.platform,
            capabilities: ['system.hello', 'system.ping'],
            degraded: {},
            executable: process.execPath,
            prefix: '',
            path: [],
            pid: process.pid,
            ...(grandchild?.pid ? { grandchild: grandchild.pid } : {})
          }
        })
      setTimeout(answer, Number(env.FAKE_HELLO_MS ?? 0))
      return
    }
    case 'system.ping':
      write({ id, result: { pong: params.echo ?? null } })
      return
    case 'fake.wait':
      setTimeout(() => write({ id, result: { waited: params.ms } }), Number(params.ms ?? 0))
      return
    case 'fake.crash':
      process.exit(3)
      return
    default:
      write({ id, error: { code: -32601, message: `Unknown method: ${method}` } })
  }
})

lines.on('close', () => {
  if (env.FAKE_IGNORE_STDIN_END === '1') {
    // Stay up until killed.
    setInterval(() => {}, 60_000)
    return
  }
  process.exit(0)
})
