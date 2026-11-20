import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { kindForPath } from '@shared/media'
import { DROP_ENTRY_LIMIT, DROP_FILE_LIMIT, type DroppedFolder, type DroppedMedia } from '@shared/dropped'

/**
 * A drop onto the Upload panel, read (the bridge's `listDropped`, channel
 * 'media:listDropped'). The renderer has no file system and no `node:path`,
 * so it cannot tell a folder from a file, and the folder's name is taken here,
 * by the same `basename` that names every file.
 *
 * - A dropped path that is not a directory (a file, or nothing at all) is
 *   handed back in `loose`, unchanged and in order: the drop imports it as it
 *   always did, failures and all.
 * - A dropped directory becomes one `DroppedFolder`: its own name, and every
 *   media file in it and in its subfolders (one level in the panel), by the
 *   extensions the Upload dialog accepts (shared/media.ts `kindForPath`), the
 *   folder's own files first and then each subfolder's, each in name order
 *   ("IMG_2" before "IMG_10").
 * - Hidden entries (a name starting with ".") are passed over: the "._IMG.jpg"
 *   that macOS leaves beside every picture on a card would each be an import
 *   that fails.
 * - No symbolic link leads out of the folder: a link whose target is outside
 *   it is passed over. A link to a FILE inside it is listed (by the link's
 *   own path); a link to a folder is never walked, so no link can loop the walk.
 * - Bounded: at most `files` media files and `entries` entries read per
 *   folder (DROP_FILE_LIMIT, DROP_ENTRY_LIMIT); a folder that holds more says
 *   so with `capped`, and the panel tells the user.
 *
 * Reads only; nothing is written, moved or deleted.
 */
export async function listDropped(
  paths: readonly string[],
  limits: { files: number; entries: number } = { files: DROP_FILE_LIMIT, entries: DROP_ENTRY_LIMIT }
): Promise<DroppedMedia> {
  const loose: string[] = []
  const folders: DroppedFolder[] = []
  for (const path of paths) {
    const info = await stat(path).catch(() => null)
    if (info?.isDirectory()) folders.push(await readFolder(path, limits))
    else loose.push(path)
  }
  return { loose, folders }
}

/** A folder's own name: its last segment ("D:" for a drive's root, where there is none). */
export function droppedFolderName(path: string): string {
  return basename(resolve(path)) || path.replace(/[\\/]+$/, '') || path
}

/** `child` is strictly inside `root` (both real paths). */
function inside(root: string, child: string): boolean {
  const rel = relative(root, child)
  return rel !== '' && !isAbsolute(rel) && rel.split(sep)[0] !== '..'
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

async function readFolder(path: string, limits: { files: number; entries: number }): Promise<DroppedFolder> {
  const root = await realpath(path).catch(() => resolve(path))
  const files: string[] = []
  let entries = 0
  let capped = false

  const walk = async (dir: string): Promise<void> => {
    const found = await readdir(dir, { withFileTypes: true }).catch(() => [])
    found.sort((a, b) => byName.compare(a.name, b.name))
    const subfolders: string[] = []
    for (const entry of found) {
      if (capped) return
      if (++entries > limits.entries) {
        capped = true
        return
      }
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        subfolders.push(full)
        continue
      }
      let file = entry.isFile()
      if (entry.isSymbolicLink()) {
        const target = await realpath(full).catch(() => null)
        file = target !== null && inside(root, target) && ((await stat(target).catch(() => null))?.isFile() ?? false)
      }
      if (!file || kindForPath(entry.name) === null) continue
      if (files.length >= limits.files) {
        capped = true
        return
      }
      files.push(full)
    }
    for (const sub of subfolders) {
      if (capped) return
      await walk(sub)
    }
  }

  await walk(path)
  return { name: droppedFolderName(path), files, capped }
}
