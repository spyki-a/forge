import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { momentFrameArgs, momentFramesKey } from '@shared/render/momentFrames'
import type { FootageRequest } from '@shared/render/moment'
import { FFMPEG_PATH } from '../ffmpeg/paths'

/**
 * A moment's footage frames, pulled once and kept (docs/PLAN.md §7.2).
 *
 * The folder is named for the file, its size and mtime, the clip's in-point
 * and retime, the frames wanted, the crop and the cap — so the preview and
 * the bake, and a second export, read the same frames without decoding
 * again; a changed file or a moved cut is a new folder. Pulled into a
 * temporary folder and renamed into place, so a pull that dies half-way
 * leaves nothing that looks finished; two callers asking for the same frames
 * at once (the store's bake and the preview, right after Direct) share one
 * pull rather than deleting each other's folders; and the cache is kept to a
 * budget, oldest first.
 */
export interface PulledFrames {
  dir: string
  files: string[]
  width: number
  height: number
}

/** The cache's size, all roots together — a bridge over 4K footage is about 100 MB of frames. */
export const MOMENTS_CACHE_BYTES = 2 * 1024 * 1024 * 1024

const inFlight = new Map<string, Promise<PulledFrames>>()
const swept = new Set<string>()

export async function extractMomentFrames(req: FootageRequest, root: string): Promise<PulledFrames> {
  const file = await stat(req.path)
  const key = createHash('sha1').update(momentFramesKey(req, file)).digest('hex').slice(0, 24)
  const dir = join(root, key)
  const wanted = req.hold ? 1 : Math.max(1, req.count)
  const existing = await pulled(dir, wanted)
  if (existing) {
    // A hit is recent: the prune goes oldest first.
    await utimes(dir, new Date(), new Date()).catch(() => undefined)
    return existing
  }
  const running = inFlight.get(dir)
  if (running) return running
  const pull = (async (): Promise<PulledFrames> => {
    try {
      if (!swept.has(root)) {
        swept.add(root)
        await sweepStalePulls(root)
      }
      const done = await pullInto(req, dir, wanted)
      await pruneMomentsCache(root, MOMENTS_CACHE_BYTES, dir)
      return done
    } finally {
      inFlight.delete(dir)
    }
  })()
  inFlight.set(dir, pull)
  return pull
}

async function pullInto(req: FootageRequest, dir: string, wanted: number): Promise<PulledFrames> {
  const tmp = `${dir}.pulling-${randomUUID()}`
  try {
    await mkdir(tmp, { recursive: true })
    const pattern = join(tmp, '%05d.png')
    await new Promise<void>((resolve, reject) => {
      execFile(
        FFMPEG_PATH,
        ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...momentFrameArgs(req, pattern)],
        { windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
        (err, _stdout, stderr) => (err ? reject(new Error(`The moment's frames could not be pulled: ${String(stderr || err.message).trim()}`)) : resolve())
      )
    })
    const fresh = await pulled(tmp, wanted)
    if (!fresh) throw new Error(`The moment's frames could not be pulled: ${wanted} wanted, fewer written`)
    // Another pull of the same key may have landed meanwhile: its folder is as good as ours, and someone may be reading it.
    const landed = await pulled(dir, wanted)
    if (landed) return landed
    await rm(dir, { recursive: true, force: true })
    await rename(tmp, dir)
    return { ...fresh, dir, files: fresh.files.map((f) => join(dir, f.slice(tmp.length + 1))) }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** The folder's frames, when it holds all of them, with their size read from the first. */
async function pulled(dir: string, wanted: number): Promise<PulledFrames | null> {
  const names = await readdir(dir).catch(() => null)
  if (!names) return null
  const files = names.filter((n) => /^\d{5}\.png$/.test(n)).sort().map((n) => join(dir, n))
  // A short pull is as good as none: the last frame would be held mid-move.
  if (files.length < wanted) return null
  const meta = await sharp(files[0]).metadata().catch(() => null)
  if (!meta?.width || !meta.height) return null
  return { dir, files: files.slice(0, wanted), width: meta.width, height: meta.height }
}

/** Folders a pull left behind when it died — an older app, a killed process — once per root per process. */
async function sweepStalePulls(root: string): Promise<void> {
  const names = await readdir(root).catch(() => null)
  if (!names) return
  const stale = Date.now() - 60 * 60 * 1000
  for (const name of names) {
    if (!name.includes('.pulling-')) continue
    const full = join(root, name)
    const info = await stat(full).catch(() => null)
    if (info && info.mtimeMs < stale) await rm(full, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Keep the cache under `budget` bytes, dropping the folders least recently used — never `keep`, which was just pulled. */
export async function pruneMomentsCache(root: string, budget: number, keep?: string): Promise<void> {
  const names = await readdir(root).catch(() => null)
  if (!names) return
  const folders: { dir: string; bytes: number; used: number }[] = []
  for (const name of names) {
    const dir = join(root, name)
    if (name.includes('.pulling-') || dir === keep) continue
    const info = await stat(dir).catch(() => null)
    if (!info?.isDirectory()) continue
    let bytes = 0
    for (const f of await readdir(dir).catch(() => [] as string[])) bytes += (await stat(join(dir, f)).catch(() => null))?.size ?? 0
    folders.push({ dir, bytes, used: info.mtimeMs })
  }
  let total = folders.reduce((s, f) => s + f.bytes, 0)
  if (keep) {
    for (const f of await readdir(keep).catch(() => [] as string[])) total += (await stat(join(keep, f)).catch(() => null))?.size ?? 0
  }
  for (const f of folders.sort((a, b) => a.used - b.used)) {
    if (total <= budget) break
    await rm(f.dir, { recursive: true, force: true }).catch(() => undefined)
    total -= f.bytes
  }
}
