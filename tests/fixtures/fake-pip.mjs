/**
 * A stand-in for `<pack python> -E -s -m pip install …`, for
 * tests/pipStage.test.ts: Node, run as `node fake-pip.mjs <pip's argv after
 * the interpreter>` by the test's injected spawn, so src/main/sidecar/pip.ts
 * is tested against a real child (its lines, its exit, its kill) without a
 * Python or a wheel in the loop.
 *
 * Told what to do by its environment:
 *
 * - FAKE_PIP_ARGV: a file it writes the argv it was given to, as JSON;
 * - FAKE_PIP_PIDS: a file it appends its pid to;
 * - FAKE_PIP_SITE: the site-packages folder it writes `<name>.dist-info`
 *   folders into (pip's argv does not name it; the test does);
 * - FAKE_PIP_COUNT: how many packages (3 by default), FAKE_PIP_MS: over how
 *   long the dist-info folders appear (1000 by default), one at a time;
 * - FAKE_PIP_MODE: `ok` (the default), `fail` (some lines, then
 *   FAKE_PIP_STDERR on stderr and exit 1), `launcher` (distlib's "Failed to
 *   write executable" and a traceback, exit 1) or `hang` (a first line, then
 *   nothing until it is killed).
 *
 * It refuses (exit 2) an argv that does not start `-E -s -m pip install`.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const env = process.env
const argv = process.argv.slice(2)
if (env.FAKE_PIP_ARGV) writeFileSync(env.FAKE_PIP_ARGV, JSON.stringify(argv))
if (env.FAKE_PIP_PIDS) appendFileSync(env.FAKE_PIP_PIDS, `${process.pid}\n`)

if (argv.slice(0, 5).join(' ') !== '-E -s -m pip install') {
  process.stderr.write(`fake-pip: not a pip install: ${argv.slice(0, 5).join(' ')}\n`)
  process.exit(2)
}

const findLinks = argv[argv.indexOf('--find-links') + 1] ?? '.'
const count = Number(env.FAKE_PIP_COUNT ?? 3)
const totalMs = Number(env.FAKE_PIP_MS ?? 1000)
const mode = env.FAKE_PIP_MODE ?? 'ok'
const names = Array.from({ length: count }, (_, i) => `pkg${i}`)
const say = (line) => process.stdout.write(`${line}\n`)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

say(`Looking in links: ${findLinks}`)

if (mode === 'hang') {
  say(`Processing ${join(findLinks, 'pkg0-1.0-py3-none-any.whl')}`)
  setInterval(() => {}, 60_000)
} else {
  for (const name of names) say(`Processing ${join(findLinks, `${name}-1.0-py3-none-any.whl`)}`)
  if (mode === 'fail') {
    process.stderr.write(env.FAKE_PIP_STDERR ?? 'ERROR: something went wrong\n')
    process.exit(1)
  }
  say(`Installing collected packages: ${names.join(', ')}`)
  if (mode === 'launcher') {
    process.stderr.write(
      [
        'WARNING: Failed to write executable - trying to use .deleteme logic',
        'ERROR: Exception:',
        'Traceback (most recent call last):',
        "PermissionError: [WinError 5] Access is denied: 'C:\\\\Users\\\\x\\\\python\\\\Scripts\\\\ct2-transformers-converter.exe'",
        ''
      ].join('\n')
    )
    process.exit(1)
  }
  for (const name of names) {
    await sleep(totalMs / Math.max(1, count))
    mkdirSync(join(env.FAKE_PIP_SITE ?? '.', `${name}-1.0.dist-info`), { recursive: true })
  }
  say(`Successfully installed ${names.map((n) => `${n}-1.0`).join(' ')}`)
  process.exit(0)
}
