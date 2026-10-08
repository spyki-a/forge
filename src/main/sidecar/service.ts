import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { SidecarClient } from './client'
import type { HelloResult } from '@shared/sidecar/protocol'

let client: SidecarClient | null = null

/**
 * Where the sidecar package lives. In development it sits in the repo; once
 * packaged it is unpacked beside the app, because Python cannot import from
 * inside an asar archive any more than ffmpeg can execute from one.
 */
function sidecarDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'sidecar')
    : join(app.getAppPath(), 'sidecar')
}

/**
 * Prefer the project's virtualenv, which is the only interpreter guaranteed to
 * have the dependencies. Falling back to a bare `python3` is what makes the
 * sidecar start at all on a machine that has not run the setup step — it will
 * report its capabilities as degraded rather than failing to launch.
 */
function pythonPath(): string {
  if (process.env.FORGE_PYTHON) return process.env.FORGE_PYTHON

  const venv = join(
    sidecarDir(),
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
  )
  return existsSync(venv) ? venv : process.platform === 'win32' ? 'python' : 'python3'
}

/**
 * The helper's two folders under userData: models it downloads, and what it
 * bakes.
 *
 * The cache is `helper-cache`, not `cache`: userData already holds Chromium's
 * own `Cache` (its HTTP disk cache, `Cache/Cache_Data`), and on the default
 * case-insensitive APFS and on NTFS `cache` IS that folder — measured, `ls -d
 * …/forge/cache` resolved to it. Bakes do not belong inside a browser cache
 * Chromium manages. Bakes made before 2026-10-08 stay in `~/.cache/forge`,
 * untouched (docs/CLIPS.md §3.5, §16.24).
 */
export function helperFolders(userData: string): { modelsDir: string; cacheDir: string } {
  return { modelsDir: join(userData, 'models'), cacheDir: join(userData, 'helper-cache') }
}

export function getSidecar(): SidecarClient {
  if (client) return client
  client = new SidecarClient({
    cwd: sidecarDir(),
    python: pythonPath(),
    ...helperFolders(app.getPath('userData')),
    maxRestarts: 3
  })
  return client
}

/**
 * Start in the background. The editor must be fully usable before — and if —
 * the sidecar comes up, so nothing here is awaited on the critical path.
 */
export function startSidecar(onStatus: (status: SidecarStatus) => void): void {
  const sidecar = getSidecar()

  sidecar.on('log', (line: string) => console.log('[sidecar]', line))
  sidecar.on('gaveUp', () =>
    onStatus({ state: 'failed', error: 'The AI helper keeps crashing and has been stopped' })
  )

  onStatus({ state: 'starting' })
  sidecar
    .start()
    .then((hello) => onStatus({ state: 'ready', hello }))
    .catch((err: unknown) =>
      onStatus({ state: 'failed', error: err instanceof Error ? err.message : String(err) })
    )
}

export function stopSidecar(): void {
  client?.stop()
  client = null
}

export type SidecarStatus =
  | { state: 'starting' }
  | { state: 'ready'; hello: HelloResult }
  | { state: 'failed'; error: string }
