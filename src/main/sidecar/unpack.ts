import { createReadStream } from 'node:fs'
import { chmod, mkdir, open, symlink, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream'
import { createGunzip } from 'node:zlib'
import { CancelledError } from '../ffmpeg/run'
import { safeMemberPath } from '@shared/assets/pack'
import { TarStream, type TarMember } from '@shared/assets/tar'
import { checkPathBudget } from '@shared/sidecar/pathBudget'

/**
 * The AI helper's interpreter, unpacked (docs/CLIPS.md §3a.3 stage 2).
 *
 * `zlib.createGunzip` streamed into `TarStream`, each member written as it
 * arrives, so the 69 MB tar stream inside the 27 MB archive is never held in
 * memory (the library packs' `gunzipSync` + `readTar` would hold both).
 *
 * What the real archives need, read off them in row 26 (EFFECTS §57): no
 * directory entries, so each member's parent folders are made here; the
 * executable bit from the mode (0775 on the Mac's 19 executables, 0777 on
 * Windows' 14); and on the Mac nine relative symlinks inside `python/`. The
 * Windows archive has none, and a symlink on Windows needs Developer Mode or
 * an elevated process, so one there is refused by name rather than copied.
 *
 * Files are opened with `wx`: a name that already exists — a duplicate member,
 * or a link the archive made — is an error, never a write through it. The job
 * unpacks into a fresh version folder (it deletes a receipt-less one first), so
 * nothing legitimate is ever there.
 */

export interface UnpackOptions {
  signal: AbortSignal
  onMessage?(message: string): void
  /**
   * The manifest's `longestPath` and `longestDir` for this version folder:
   * checked against Windows' path budget BEFORE the first write
   * (`checkPathBudget`). Omitted, the unpack does not check it (stage 0 has).
   */
  budget?: { longestPath: number; longestDir: number }
  /** `process.platform`, for a test to be Windows. */
  platform?: NodeJS.Platform
}

export interface UnpackResult {
  files: number
  bytes: number
  /** The longest relative path written (a file's or a link's), in characters. */
  longestPath: number
  /** The longest relative folder made or written into, in characters. */
  longestDir: number
}

/** Every byte of `bytes` into the file: a write may take fewer than it was given. */
async function writeAll(fh: FileHandle, bytes: Uint8Array): Promise<void> {
  let at = 0
  while (at < bytes.length) {
    const { bytesWritten } = await fh.write(bytes, at, bytes.length - at)
    at += bytesWritten
  }
}

/**
 * Gunzip and untar `archive` into `into`. Resolves with what was written; on a
 * cancel (the signal is read between members and stops the read) or any
 * failure, rejects and leaves a partial tree, which the job deletes.
 */
export async function unpackTarGz(archive: string, into: string, o: UnpackOptions): Promise<UnpackResult> {
  const platform = o.platform ?? process.platform
  if (o.budget) {
    const refusal = checkPathBudget({ root: into, ...o.budget, platform })
    if (refusal) throw new Error(refusal)
  }
  if (o.signal.aborted) throw new CancelledError()

  await mkdir(into, { recursive: true })
  const made = new Set<string>([''])
  const result: UnpackResult = { files: 0, bytes: 0, longestPath: 0, longestDir: 0 }

  /** A relative folder, made with its parents once; its length counted. */
  const folder = async (rel: string): Promise<void> => {
    if (made.has(rel)) return
    await mkdir(join(into, rel), { recursive: true })
    for (let at = rel; at && !made.has(at); at = at.includes('/') ? at.slice(0, at.lastIndexOf('/')) : '') made.add(at)
    result.longestDir = Math.max(result.longestDir, rel.length)
  }
  const parentOf = (name: string): string => (name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '')

  const tar = new TarStream(safeMemberPath)
  // The read stops on the cancel too, so a cancel during a long member is not a wait for its end.
  const gunzip = pipeline(createReadStream(archive, { signal: o.signal }), createGunzip(), () => undefined)
  let open_: { fh: FileHandle; member: TarMember } | null = null

  const close = async (): Promise<void> => {
    if (!open_) return
    const { fh, member } = open_
    open_ = null
    await fh.close()
    // Only the executable bit, and only where it was set (packs.ts's rule): restoring the mode
    // wholesale would be a way to smuggle one in.
    if (platform !== 'win32' && (member.mode & 0o111) !== 0) await chmod(join(into, member.name), 0o755)
  }

  try {
    for await (const chunk of gunzip as AsyncIterable<Buffer>) {
      for (const event of tar.push(chunk)) {
        if (event.kind === 'data') {
          await writeAll(open_!.fh, event.bytes)
          continue
        }
        if (event.kind === 'end') {
          await close()
          continue
        }
        if (o.signal.aborted) throw new CancelledError()
        const member = event.member
        const target = join(into, member.name)
        if (member.type === 'directory') {
          await folder(member.name)
          continue
        }
        await folder(parentOf(member.name))
        result.longestPath = Math.max(result.longestPath, member.name.length)
        if (member.type === 'symlink') {
          if (platform === 'win32') {
            throw new Error(
              `The AI helper's archive holds a symbolic link (${member.name} -> ${member.linkname}), which is not made on Windows; the Windows archive is not meant to have one`
            )
          }
          await symlink(member.linkname!, target)
          continue
        }
        open_ = { fh: await open(target, 'wx', 0o644), member }
        result.files++
        result.bytes += member.size
        if (result.files % 250 === 0) o.onMessage?.(`unpacking Python · ${result.files} files`)
      }
    }
    tar.end()
  } catch (err) {
    await open_?.fh.close().catch(() => undefined)
    gunzip.destroy()
    if (o.signal.aborted) throw new CancelledError()
    throw new Error(`Python's archive could not be unpacked: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }
  return result
}
