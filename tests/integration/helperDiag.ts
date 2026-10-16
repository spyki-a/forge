import { afterAll } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SidecarClient } from '../../src/main/sidecar/client'
import { OUTPUT_ROOT } from './output'

/*
 * What a helper suite says when it fails or is slow, through the one channel
 * this project can read without signing in to GitHub: the run's annotations.
 *
 * The job log needs a sign-in and the artifacts need auth, so a red Windows
 * run used to say only "Test timed out in 60000ms" — nothing about where the
 * helper or its worker was. And the channel is narrow, measured from the
 * runner's own source (actions/runner, src/Runner.Worker/ExecutionContext.cs,
 * read 2026-10-16): a step keeps the FIRST 10 errors, 10 warnings and 10
 * notices (`_maxCountPerIssueType = 10`; later ones reach the log only) and
 * cuts each message to its first 4,096 characters (`_maxIssueMessageLength`).
 * Run 38972858204's pack step had exactly 10 error annotations: whatever
 * failed after them was never seen.
 *
 * So: a deadline inside each long wait, whose message is the diagnosis
 * (`withDeadline`), the helper's own stderr kept for it (`attachHelperLog`),
 * one notice per file with its timings and one warning per file listing every
 * failure (`reportFileToCi`), each well under 4,096 characters. The full logs
 * go to tests/output/helper-diag/, which CI uploads for whoever can sign in.
 */

/** Text on one line — newlines as ' ⏎ ' — at most `limit` characters, the start and the END kept (a log's newest lines are last). */
export function oneLine(text: string, limit = 3000): string {
  const flat = text.replace(/\r?\n/g, ' ⏎ ')
  if (flat.length <= limit) return flat
  const head = Math.floor(limit * 0.3)
  return `${flat.slice(0, head)} … ${flat.slice(flat.length - (limit - head - 3))}`
}

const DUMP_LINE = /^(Timeout \(|Thread 0x|Current thread 0x|<no Python frame>|\.\.\.)|^File ".*", line \d+ in /

/**
 * A Python child's stderr on one line, in faces.py `stderr_summary`'s shape:
 * the face worker's own notes (`mp_faces: …`), faces.py's lines
 * (`faces: …`), anything else, and faulthandler's LAST stall dump as each
 * thread's newest four frames, file names only — a raw dump is fifty lines of
 * threading.py that would push everything else out of a 4,096-character
 * annotation.
 */
export function pythonStderr(text: string, limit = 1500): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const last = (found: string[], n: number): string => found.slice(-n).join(' ⏎ ')
  const notes = lines.filter((line) => line.startsWith('mp_faces: '))
  const helper = lines.filter((line) => line.startsWith('faces: '))
  const other = lines.filter((line) => !DUMP_LINE.test(line) && !line.startsWith('mp_faces: ') && !line.startsWith('faces: '))
  const start = lines.map((line, i) => (line.startsWith('Timeout (') ? i : -1)).filter((i) => i >= 0).pop()
  const threads: { name: string; frames: string[] }[] = []
  if (start !== undefined) {
    for (const line of lines.slice(start + 1)) {
      const thread = /^(?:Current thread|Thread) (0x[0-9a-fA-F]+)(?: \[(.*)\])? \(most recent call first\):$/.exec(line)
      if (thread) threads.push({ name: thread[2] ?? thread[1], frames: [] })
      const frame = /^File "(.*)", line (\d+) in (.*)$/.exec(line)
      if (frame && threads.length) threads[threads.length - 1].frames.push(`${frame[1].split(/[\\/]/).pop()}:${frame[2]} ${frame[3]}`)
    }
  }
  const stacks = threads
    .map((t) => `${t.frames.some((f) => f.endsWith(' <module>')) ? 'main' : t.name}: ${t.frames.slice(0, 4).join(' < ') || '(no Python frame)'}`)
    .join(' | ')
  const parts = [
    notes.length ? `notes: ${last(notes, 6)}` : '',
    helper.length ? `faces.py: ${last(helper, 4)}` : '',
    other.length ? `other: ${last(other, 3)}` : '',
    stacks ? `stacks: ${stacks}` : ''
  ].filter(Boolean)
  return oneLine(parts.join('; '), limit)
}

/** Whether a process is there: signal 0 asks without sending anything (libuv answers it on Windows too). */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/* ----------------------------------------------------------- the helper's log */

const KEPT_LINES = 4000

export interface HelperLog {
  readonly label: string
  /** Every stderr line, `+<s>s` from the attach, newest last (the last 4,000). */
  readonly lines: string[]
  pid: number | null
  exit: { code: number | null; signal: string | null } | null
  /** ms from the attach to the first hello; null until one answers. */
  helloMs: number | null
  /** The last `n` lines. */
  tail(n?: number): string[]
  /** pid, alive or how it ended, the hello's time, and the last `n` lines — for a failure's message. */
  describe(n?: number): string
}

const attached: HelperLog[] = []

/**
 * Keep a client's stderr (its 'log' events, the helper's log channel), its
 * pid and its exit. Attach before `start()`, so the spawn and the first lines
 * are seen.
 */
export function attachHelperLog(client: SidecarClient, label: string): HelperLog {
  const began = performance.now()
  const stamp = (): string => `+${((performance.now() - began) / 1000).toFixed(1)}s`
  const lines: string[] = []
  const log: HelperLog = {
    label,
    lines,
    pid: client.pid,
    exit: null,
    helloMs: null,
    tail: (n = 40) => (n > 0 ? lines.slice(-n) : []),
    describe(n = 40) {
      const state = log.exit
        ? `exited (${log.exit.signal ? `signal ${log.exit.signal}` : `code ${log.exit.code}`})`
        : log.pid === null
          ? 'never spawned'
          : alive(log.pid)
            ? 'running'
            : 'gone (no exit event)'
      const hello = log.helloMs === null ? 'no hello' : `hello in ${(log.helloMs / 1000).toFixed(1)} s`
      const shown = log.tail(n)
      return `helper ${label} pid ${log.pid ?? '-'} ${state}, ${hello}; its log (last ${shown.length} of ${lines.length} lines): ${shown.join('\n') || '(nothing)'}`
    }
  }
  client.on('log', (text: string) => {
    for (const line of text.split(/\r?\n/)) if (line.trim()) lines.push(`${stamp()} ${line}`)
    if (lines.length > KEPT_LINES) lines.splice(0, lines.length - KEPT_LINES)
  })
  client.on('spawn', ({ pid }: { pid: number }) => (log.pid = pid))
  client.on('ready', () => {
    if (log.helloMs === null) log.helloMs = performance.now() - began
  })
  client.on('exit', (exit: { code: number | null; signal: string | null }) => (log.exit = { code: exit.code, signal: exit.signal }))
  attached.push(log)
  return log
}

/* ---------------------------------------------------------------- deadlines */

/** A wait that ran out: its message is the diagnosis, on one line. */
export class DeadlineError extends Error {
  override name = 'DeadlineError'
}

const missed: string[] = []

/**
 * `promise`, or after `ms` a `DeadlineError` whose one-line message says what
 * was waited for, for how long, and `context()` — read at that moment, so it
 * carries the helper's log as it stands (bounded to 3,000 characters, the
 * newest kept). Set it under the test's own timeout, or vitest's "Test timed
 * out" wins and says nothing.
 */
export function withDeadline<T>(promise: Promise<T>, ms: number, what: string, context: () => string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      let detail: string
      try {
        detail = context()
      } catch (err) {
        detail = `(reading the context failed: ${String(err)})`
      }
      const message = oneLine(`${what}: nothing within ${(ms / 1000).toFixed(1)} s. ${detail}`)
      missed.push(message)
      reject(new DeadlineError(message))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/** A test's own deadline, `ms` from now, shared by its waits: `left()` is what remains of it, never under a second. */
export function deadlineIn(ms: number): { left(): number } {
  const end = performance.now() + ms
  return { left: () => Math.max(1000, Math.round(end - performance.now())) }
}

/* ------------------------------------------------------------- annotations */

/** GitHub's own escaping (actions/toolkit `escapeData`, `escapeProperty`). */
const escapeData = (s: string): string => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
const escapeProperty = (s: string): string => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C')

/** The longest message a step keeps whole (the runner cuts at 4,096), with room for its title. */
const MESSAGE_LIMIT = 3900

function annotate(kind: 'notice' | 'warning', title: string, message: string): void {
  const body = message.length > MESSAGE_LIMIT ? `${message.slice(0, MESSAGE_LIMIT - 2)} …` : message
  // On its own line: the runner reads a command only at a line's start, and vitest pipes each worker's stdout through as it comes.
  if (process.env.GITHUB_ACTIONS) process.stdout.write(`\n::${kind} title=${escapeProperty(title)}::${escapeData(body)}\n`)
  else console.log(`[${kind}] ${title}: ${body}`)
}

/** A notice annotation on CI (10 a step: one per file, `reportFileToCi`), the console elsewhere. */
export function ciNotice(title: string, message: string): void {
  annotate('notice', title, message)
}

/** A warning annotation on CI (10 a step), the console elsewhere. */
export function ciWarning(title: string, message: string): void {
  annotate('warning', title, message)
}

interface Task {
  name: string
  type: string
  mode?: string
  tasks?: Task[]
  suite?: Task
  result?: { state?: string; errors?: { message?: string }[] }
}

function testsOf(task: Task): Task[] {
  return task.type === 'test' ? [task] : (task.tasks ?? []).flatMap(testsOf)
}

/** The test's name under its describes; the file itself (the one task with no suite) is the label's already. */
function nameOf(test: Task): string {
  const names: string[] = []
  for (let t: Task | undefined = test; t?.suite; t = t.suite) names.unshift(t.name)
  return names.join(' > ')
}

/**
 * At the file's end: ONE notice with `timings()` when it has any, ONE
 * warning naming every failed test with its first error (so the failures
 * past the step's tenth error annotation are still read), and the whole of
 * it — every message in full and every attached helper's log — in
 * tests/output/helper-diag/<label>.txt. Call once, at the file's top level.
 */
export function reportFileToCi(label: string, timings: () => string[] = () => []): void {
  // Vitest 4 hands a hook its fixtures first (destructured, or it refuses) and the suite second: here, the file.
  // eslint-disable-next-line no-empty-pattern
  afterAll(({}, file) => {
    const tests = testsOf(file as unknown as Task)
    const failed = tests.filter((t) => t.result?.state === 'fail')
    const ran = tests.filter((t) => t.result?.state === 'pass' || t.result?.state === 'fail').length
    const said = timings()
    if (said.length) ciNotice(`${label}: timings`, said.join('\n'))
    if (failed.length) {
      const each = Math.max(200, Math.floor(MESSAGE_LIMIT / failed.length) - 40)
      ciWarning(
        `${label}: ${failed.length} of ${ran} failed`,
        failed.map((t) => `${nameOf(t)}: ${oneLine(t.result?.errors?.[0]?.message ?? '(no message)', each)}`).join('\n')
      )
    }
    try {
      const dir = join(OUTPUT_ROOT, 'helper-diag')
      mkdirSync(dir, { recursive: true })
      const text = [
        `# ${label}: ${ran} ran, ${failed.length} failed`,
        '',
        '## timings',
        ...said,
        '',
        '## failures',
        ...failed.flatMap((t) => [`### ${nameOf(t)}`, ...(t.result?.errors ?? []).map((e) => e.message ?? ''), '']),
        '## deadlines missed',
        ...missed,
        '',
        ...attached.flatMap((log) => [`## ${log.describe(0)}`, ...log.lines, ''])
      ]
      writeFileSync(join(dir, `${label}.txt`), `${text.join('\n')}\n`, 'utf8')
    } catch (err) {
      console.log(`helper-diag: could not write ${label}.txt: ${String(err)}`)
    }
  })
}
