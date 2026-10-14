import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  LineDecoder,
  METHOD_CANCEL,
  RPC_ERRORS,
  SIDECAR_METHODS,
  encode,
  isFailure,
  isNotification,
  isResponse,
  type HelloResult,
  type ProgressParams,
  type RpcMessage
} from '@shared/sidecar/protocol'
import type { HelperLaunch, HelperSource } from '@shared/sidecar/helperPython'

export interface SidecarOptions {
  /** Directory containing the forge_sidecar package: the child's cwd, which `-m forge_sidecar` imports from. */
  cwd: string
  /**
   * How to start it: `helperLaunch`'s answer for the rung `resolveHelperPython`
   * chose (src/shared/sidecar/helperPython.ts), its command, flags and
   * environment. There is no default: a client that guessed `python3` was how
   * a packaged app with no pack ran a PATH Python, or Windows' 9009 stub, at
   * every caller (docs/CLIPS.md §3a "What is wrong").
   */
  launch: HelperLaunch
  /** How many times to restart after an unexpected exit before giving up. */
  maxRestarts?: number
  /** How long the first hello may take before the child is killed. By the launch's rung when unset (`helloTimeoutFor`). */
  helloTimeoutMs?: number
  /**
   * Whose kill `stop()` and a timed-out hello use: `process.platform` when
   * unset. A test sets 'win32' to see the tree kill's argv on any machine.
   */
  platform?: NodeJS.Platform
}

/** A dev rung's hello (FORGE_PYTHON, the venv, PATH): the 30 s the client always had. */
export const HELLO_TIMEOUT_MS = 30_000

/**
 * The pack's hello. Its registration imports a whole site-packages (numpy,
 * onnxruntime, librosa, ctranslate2…) through Defender on a cold Surface, so
 * 30 s is not assumed to be enough. 90 s is a placeholder until docs/CLIPS.md
 * §3a.8 row 29 measures the cold hello from the pack on the Surface (the first
 * start after an install and the first after a reboot); that number, plus a
 * margin, replaces this one.
 */
export const PACK_HELLO_TIMEOUT_MS = 90_000

/** The hello's ceiling for a rung: the pack's own, or the dev rungs' 30 s. */
export function helloTimeoutFor(source: HelperSource): number {
  return source.kind === 'pack' ? PACK_HELLO_TIMEOUT_MS : HELLO_TIMEOUT_MS
}

/** How long `stop()` waits for the helper to exit by itself (stdin closed, work cancelled) before it kills it. */
export const STOP_GRACE_MS = 1500

/** The `'exit'` event's payload: how the child ended, and which rung it was. */
export interface HelperExit {
  code: number | null
  signal: NodeJS.Signals | null
  source: HelperSource
  /** undefined when the process never started (ENOENT, EACCES). */
  pid?: number
}

export interface RequestOptions {
  onProgress?: (progress: number | null, message?: string) => void
  /** Aborting sends a cancel notification; the handler stops cooperatively. */
  signal?: AbortSignal
  timeoutMs?: number
}

export class SidecarError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown
  ) {
    super(message)
    this.name = 'SidecarError'
  }
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  onProgress?: (progress: number | null, message?: string) => void
  timer?: NodeJS.Timeout
}

const cancelled = (): SidecarError => new SidecarError('Cancelled', RPC_ERRORS.cancelled)

/**
 * Supervises the Python helper and speaks JSON-RPC to it over stdio.
 *
 * The process is treated as disposable: it can crash, be killed, or be restarted
 * and the app keeps working with those capabilities unavailable. Nothing in the
 * editor may depend on it being alive.
 *
 * **One process** (docs/CLIPS.md §3a.2 "One helper process"). `start()` is
 * single flight: it keeps the in-flight promise, a second call before the
 * hello joins it, and it spawns only when there is no child. A `request()`
 * with no helper ready joins that same start. A hello that does not come back
 * kills its child before it rejects. `stop()` resolves on the child's exit, and
 * a stopped client never spawns again: the service builds a new one.
 *
 * Events: `'log'` (a stderr chunk), `'spawn'` ({pid, source}), `'ready'`
 * (the hello, on every start that answers, a restart's included), `'exit'`
 * (`HelperExit`), `'gaveUp'` (the restarts are spent).
 */
export class SidecarClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  /** Resolves on each child's end ('exit', or 'close' for one that never started). */
  private readonly gone = new WeakMap<ChildProcess, Promise<void>>()
  private decoder = new LineDecoder()
  private pending = new Map<number, Pending>()
  /** Requests waiting for the start they joined; counted by `idle()`. */
  private queued = 0
  private idleWaiters: (() => void)[] = []
  private nextId = 1
  private restarts = 0
  private restartTimer: NodeJS.Timeout | null = null
  private stopping = false
  private hello: HelloResult | null = null
  private starting: Promise<HelloResult> | null = null

  constructor(private readonly options: SidecarOptions) {
    super()
  }

  /** The rung this client runs (what the Settings row names). */
  get source(): HelperSource {
    return this.options.launch.source
  }

  get running(): boolean {
    return this.child !== null && !this.child.killed
  }

  get info(): HelloResult | null {
    return this.hello
  }

  /** The child's pid, while there is one. */
  get pid(): number | null {
    return this.child?.pid ?? null
  }

  /** True once `stop()` was called: this client never spawns again. */
  get stopped(): boolean {
    return this.stopping
  }

  start(): Promise<HelloResult> {
    if (this.child && this.hello) return Promise.resolve(this.hello)
    // A second ask while the hello is out joins it. Today's `running && hello`
    // check let it through to a second spawn: two helpers, measured (two pids).
    if (this.starting) return this.starting
    if (this.stopping) return Promise.reject(new SidecarError('The AI helper is shutting down', RPC_ERRORS.internalError))
    const attempt = this.handshake()
    this.starting = attempt
    const clear = (): void => {
      if (this.starting === attempt) this.starting = null
    }
    attempt.then(clear, clear)
    return attempt
  }

  private async handshake(): Promise<HelloResult> {
    // Spawned before the first await, so `this.starting` is set before any other caller can look.
    const child = this.spawnChild()
    const timeoutMs = this.options.helloTimeoutMs ?? helloTimeoutFor(this.source)
    try {
      const hello = await this.send<HelloResult>(child, SIDECAR_METHODS.hello, {}, { timeoutMs }, `The AI helper did not answer within ${Math.ceil(timeoutMs / 1000)} s`)
      if (this.child !== child) throw new SidecarError('The AI helper stopped before it was ready', RPC_ERRORS.internalError)
      this.hello = hello
      this.emit('ready', hello)
      return hello
    } catch (err) {
      // A hello that did not come back (timed out, or its write failed) kills
      // its child before the rejection, so the next ask never finds a second
      // helper beside one still loading. Its exit restarts it like any crash.
      if (this.child === child) await this.kill(child)
      throw err
    }
  }

  private spawnChild(): ChildProcessWithoutNullStreams {
    const { command, args, env } = this.options.launch
    const child = spawn(command, args, {
      cwd: this.options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env
    }) as ChildProcessWithoutNullStreams

    this.child = child
    this.decoder.reset()

    let ended = false
    let markGone!: () => void
    this.gone.set(child, new Promise<void>((resolve) => (markGone = resolve)))
    const onGone = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (ended) return
      ended = true
      markGone()
      this.childGone(child, code, signal)
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return
      for (const message of this.decoder.push(chunk)) this.dispatch(message)
    })

    // stderr is the helper's log channel: stdout is reserved for protocol.
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const text = chunk.trimEnd()
      if (text) this.emit('log', text)
    })

    // A write to a child that is gone fails in its callback; an 'error' event
    // on the pipe itself must not reach main as an uncaught exception.
    child.stdin.on('error', () => undefined)

    /*
     * These messages reach the screen — the Settings panel's AI helper row
     * shows a failed start word for word — so they say "AI helper". On screen
     * "sidecar" is the user's left panel; here it is only the code's name.
     */
    child.on('error', (err) => {
      if (this.child === child) {
        this.failAll(new SidecarError(`Could not start the AI helper: ${err.message}`, RPC_ERRORS.internalError))
      }
    })

    // 'exit' for a process that ran; 'close' as well, because one that never
    // started (ENOENT) emits 'error' then 'close' and no 'exit' (measured, Node 24).
    child.once('exit', onGone)
    child.once('close', onGone)

    if (child.pid !== undefined) this.emit('spawn', { pid: child.pid, source: this.source })
    return child
  }

  private childGone(child: ChildProcessWithoutNullStreams, code: number | null, signal: NodeJS.Signals | null): void {
    const current = this.child === child
    if (current) {
      this.child = null
      this.hello = null
      const reason = signal ? `signal ${signal}` : `code ${code}`
      this.failAll(new SidecarError(`The AI helper stopped (${reason})`, RPC_ERRORS.internalError))
    }
    const exit: HelperExit = { code, signal, source: this.source, ...(child.pid !== undefined ? { pid: child.pid } : {}) }
    this.emit('exit', exit)

    if (this.stopping || !current) return
    // An interpreter that is not there will not be there in 400 ms either:
    // the start's own rejection says why ("Could not start the AI helper: …").
    if (child.pid === undefined) return
    const limit = this.options.maxRestarts ?? 3
    if (this.restarts < limit) {
      this.restarts++
      // Back off so a helper that crashes on startup cannot spin. Through
      // start(), single flight: a request that came first is joined, not doubled.
      const delay = Math.min(8000, 400 * 2 ** (this.restarts - 1))
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null
        if (!this.stopping) void this.start().catch(() => undefined)
      }, delay)
    } else {
      this.emit('gaveUp')
    }
  }

  private dispatch(message: RpcMessage): void {
    if (isNotification(message)) {
      if (message.method === 'progress') {
        const params = message.params as ProgressParams
        this.pending.get(params.id)?.onProgress?.(params.progress, params.message)
      }
      return
    }
    if (!isResponse(message)) return

    const entry = this.pending.get(message.id)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    this.forget(message.id)

    if (isFailure(message)) {
      entry.reject(new SidecarError(message.error.message, message.error.code, message.error.data))
    } else {
      entry.resolve(message.result)
    }
  }

  private failAll(error: Error): void {
    const entries = [...this.pending.values()]
    this.pending.clear()
    for (const entry of entries) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.checkIdle()
  }

  private forget(id: number): void {
    this.pending.delete(id)
    this.checkIdle()
  }

  private checkIdle(): void {
    if (this.pending.size > 0 || this.queued > 0 || this.idleWaiters.length === 0) return
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const resolve of waiters) resolve()
  }

  /**
   * Resolves once no request is pending or waiting for the start it joined
   * (`restartSidecar` waits on it before it stops the helper).
   */
  idle(): Promise<void> {
    if (this.pending.size === 0 && this.queued === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  request<T>(method: string, params: unknown = {}, options: RequestOptions = {}): Promise<T> {
    if (options.signal?.aborted) return Promise.reject(cancelled())
    const child = this.child
    if (child && this.hello) return this.send<T>(child, method, params, options)

    /*
     * No helper yet (or it crashed), or its hello is still out: join the one
     * start and ask once it has answered. This used to spawn on its own
     * (`if (!this.child) spawnChild()`), which made every caller a launcher —
     * and with a start in flight, a second helper.
     */
    this.queued++
    let counted = true
    const settle = (): void => {
      if (!counted) return
      counted = false
      this.queued--
      this.checkIdle()
    }
    return this.whenStarted(options.signal).then(
      () => {
        const ready = this.child
        if (!ready || options.signal?.aborted) {
          settle()
          throw ready ? cancelled() : new SidecarError('The AI helper is not running', RPC_ERRORS.internalError)
        }
        // Pending first, then no longer queued: `idle()` must never see a gap between the two.
        const sent = this.send<T>(ready, method, params, options)
        settle()
        return sent
      },
      (err: unknown) => {
        settle()
        throw err
      }
    )
  }

  /** `start()`, or a cancel if the caller's signal aborts first. */
  private whenStarted(signal?: AbortSignal): Promise<HelloResult> {
    const started = this.start()
    if (!signal) return started
    return new Promise<HelloResult>((resolve, reject) => {
      const onAbort = (): void => reject(cancelled())
      signal.addEventListener('abort', onAbort, { once: true })
      started.then(
        (hello) => {
          signal.removeEventListener('abort', onAbort)
          resolve(hello)
        },
        (err: unknown) => {
          signal.removeEventListener('abort', onAbort)
          reject(err)
        }
      )
    })
  }

  private send<T>(
    child: ChildProcessWithoutNullStreams,
    method: string,
    params: unknown,
    options: RequestOptions,
    timeoutMessage = `${method} timed out`
  ): Promise<T> {
    const id = this.nextId++

    return new Promise<T>((resolve, reject) => {
      const entry: Pending = {
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress: options.onProgress
      }

      if (options.timeoutMs) {
        entry.timer = setTimeout(() => {
          if (!this.pending.has(id)) return
          this.forget(id)
          this.cancel(id)
          reject(new SidecarError(timeoutMessage, RPC_ERRORS.internalError))
        }, options.timeoutMs)
      }

      this.pending.set(id, entry)

      options.signal?.addEventListener(
        'abort',
        () => {
          if (!this.pending.has(id)) return
          if (entry.timer) clearTimeout(entry.timer)
          this.forget(id)
          this.cancel(id)
          reject(cancelled())
        },
        { once: true }
      )

      child.stdin.write(encode({ jsonrpc: '2.0', id, method, params }), (err) => {
        if (!err || !this.pending.has(id)) return
        if (entry.timer) clearTimeout(entry.timer)
        this.forget(id)
        reject(new SidecarError(`Could not send ${method}: ${err.message}`, RPC_ERRORS.internalError))
      })
    })
  }

  /** Fire-and-forget cancel; the handler stops at its next checkpoint. */
  private cancel(id: number): void {
    if (!this.child) return
    this.child.stdin.write(encode({ jsonrpc: '2.0', method: METHOD_CANCEL, params: { id } }))
  }

  /**
   * Kill a child and everything it started. On Windows `taskkill /f /t`, the
   * shape src/main/ffmpeg/run.ts `killProcess` uses: a kill of python.exe
   * alone leaves a face worker and its ffmpeg running (§3a "What is wrong").
   * Elsewhere SIGKILL: the helper's own cancel already stops the worker there,
   * and a worker whose stdin ends with the helper stops by itself (§15 row 1).
   */
  private killTree(child: ChildProcess): void {
    const platform = this.options.platform ?? process.platform
    if (platform === 'win32' && child.pid !== undefined) {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true })
      killer.on('error', () => child.kill('SIGKILL'))
      return
    }
    child.kill('SIGKILL')
  }

  /** Kill a child (its tree on Windows) and wait for it to be gone. */
  private kill(child: ChildProcessWithoutNullStreams): Promise<void> {
    this.killTree(child)
    return this.gone.get(child) ?? Promise.resolve()
  }

  /**
   * Stop the helper; resolves once it has exited (at once when there is no
   * child). The client is spent: a later start or request rejects without
   * spawning, and the service builds a new client.
   */
  stop(): Promise<void> {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const inFlight = [...this.pending.keys()]
    this.failAll(new SidecarError('The AI helper is shutting down', RPC_ERRORS.internalError))
    const child = this.child
    if (!child) return Promise.resolve()
    this.child = null
    this.hello = null
    const gone = this.gone.get(child) ?? Promise.resolve()
    /*
     * Cancel what is still running first. On stdin's end the helper drains
     * its in-flight handlers for up to 300 s before it exits (rpc.py
     * serve_forever), so without a cancel a quit during an analysis always
     * ended in the kill below, and no handler's cleanup ran (measured:
     * vision.faces' helper still alive at 1.5 s). Cancelled, each handler
     * stops at its next check — vision.faces stops its worker and removes
     * its half-track in about 0.22 s — and the helper exits by itself.
     */
    for (const id of inFlight) child.stdin.write(encode({ jsonrpc: '2.0', method: METHOD_CANCEL, params: { id } }))
    // Closing stdin ends the read loop cleanly; kill only if it ignores that.
    child.stdin.end()
    const timer = setTimeout(() => this.killTree(child), STOP_GRACE_MS)
    return gone.then(() => clearTimeout(timer))
  }
}
