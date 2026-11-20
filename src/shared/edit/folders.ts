import type { MediaAsset, Project } from '../timeline'

/**
 * Folders in the Upload panel (MediaPool.tsx): ONE level, in the project, and
 * never on disk. A folder is a name; a file is in one folder or in none.
 *
 * The project's shape is the smallest that holds that:
 *
 * - `MediaAsset.folder`: the name of the folder the file is in, absent for none.
 * - `Project.folders`: the folders, in the order the panel shows them, so a
 *   folder with nothing in it still exists. Absent when there are none.
 *
 * Both are optional, so a project without them opens exactly as before, and a
 * project with them opens in a build that knows nothing of folders: that
 * build's `deserializeProject` keeps unknown fields (the project and each
 * asset are spread), so its files simply show in one grid.
 *
 * A name is project data. It is shown and compared, and never joined into a
 * path or made into a filename, so it may hold any character ("Bride 5:30pm"
 * is an ordinary name for a folder of a shoot).
 *
 * Every function here is pure and returns the same project when nothing
 * changes, so the store's `update` adds no undo step for a no-op.
 */

/** The longest name a folder may have, in UTF-16 units: what an `<input maxLength>` counts. */
export const FOLDER_NAME_MAX = 40

export const FOLDER_NEEDS_NAME = 'A folder needs a name'
export const FOLDER_NAME_TOO_LONG = `A folder name can be at most ${FOLDER_NAME_MAX} characters`
/** The start of the sentence that refuses a taken name; the folder that has it follows, in quotes. */
export const FOLDER_NAME_TAKEN = 'There is already a folder called'

/**
 * A name as it is kept: trimmed, and in NFC. macOS hands a dropped folder's
 * name over in whatever form its disk stored, which can be decomposed (an "é"
 * as "e" and an accent), while a typed name is composed. Without this, two
 * folders would read "Café" alike and still be two.
 */
export function cleanFolderName(raw: string): string {
  return raw.normalize('NFC').trim()
}

/** Two names are the same folder when they differ only in case. */
export function sameFolderName(a: string, b: string): boolean {
  return cleanFolderName(a).toLowerCase() === cleanFolderName(b).toLowerCase()
}

/** The project's folders, in order. */
export function folderList(project: Pick<Project, 'folders'>): string[] {
  return project.folders ?? []
}

/** The folder of that name (any case), as the project spells it, or null. */
export function findFolder(project: Pick<Project, 'folders'>, name: string): string | null {
  return folderList(project).find((f) => sameFolderName(f, name)) ?? null
}

/**
 * Why `raw` cannot name a folder, in a plain sentence, or null when it can.
 * `except` is the folder being renamed: it may keep its own name, or change
 * only its case.
 */
export function folderNameProblem(project: Pick<Project, 'folders'>, raw: string, except: string | null = null): string | null {
  const name = cleanFolderName(raw)
  if (name === '') return FOLDER_NEEDS_NAME
  if (name.length > FOLDER_NAME_MAX) return FOLDER_NAME_TOO_LONG
  const taken = folderList(project).find((f) => f !== except && sameFolderName(f, name))
  return taken === undefined ? null : `${FOLDER_NAME_TAKEN} “${taken}”`
}

export type FolderResult = { ok: true; project: Project; name: string } | { ok: false; problem: string }

/** A new folder at the end of the list, with nothing in it. */
export function makeFolder(project: Project, raw: string): FolderResult {
  const problem = folderNameProblem(project, raw)
  if (problem) return { ok: false, problem }
  const name = cleanFolderName(raw)
  return { ok: true, name, project: { ...project, folders: [...folderList(project), name] } }
}

/** A folder renamed where it stands in the list; every file in it follows. */
export function renameFolder(project: Project, from: string, raw: string): FolderResult {
  if (!folderList(project).includes(from)) return { ok: false, problem: `There is no folder called “${from}”` }
  const problem = folderNameProblem(project, raw, from)
  if (problem) return { ok: false, problem }
  const name = cleanFolderName(raw)
  if (name === from) return { ok: true, name, project }
  return {
    ok: true,
    name,
    project: {
      ...project,
      folders: folderList(project).map((f) => (f === from ? name : f)),
      assets: project.assets.map((a) => (a.folder === from ? { ...a, folder: name } : a))
    }
  }
}

/** The asset with no folder: the key gone, not set to undefined, so a saved file carries nothing for it. */
export function withoutFolder(asset: MediaAsset): MediaAsset {
  if (!('folder' in asset)) return asset
  const { folder: _none, ...rest } = asset
  return rest
}

/**
 * Files moved into `folder`, or out to none (null). A folder the project does
 * not have moves nothing: a stale menu or drop must not invent one.
 */
export function moveToFolder(project: Project, ids: readonly string[], folder: string | null): Project {
  if (folder !== null && !folderList(project).includes(folder)) return project
  const moving = new Set(ids)
  let changed = false
  const assets = project.assets.map((a) => {
    if (!moving.has(a.id) || (a.folder ?? null) === folder) return a
    changed = true
    return folder === null ? withoutFolder(a) : { ...a, folder }
  })
  return changed ? { ...project, assets } : project
}

/**
 * A folder taken away. Its files are NEVER removed: they go back to no folder.
 * The last folder going takes the list's key with it, so a project that had
 * folders and has none again is shaped as one that never had any.
 */
export function removeFolder(project: Project, name: string): Project {
  if (!folderList(project).includes(name)) return project
  const folders = folderList(project).filter((f) => f !== name)
  const next: Project = {
    ...project,
    assets: project.assets.map((a) => (a.folder === name ? withoutFolder(a) : a))
  }
  if (folders.length > 0) next.folders = folders
  else delete next.folders
  return next
}

/**
 * A name taken from something the user did not type (a dropped directory's
 * own name, a hand-edited file): kept, and cut to the longest name allowed.
 * Null when nothing is left.
 */
export function folderNameFrom(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let cut = cleanFolderName(raw).slice(0, FOLDER_NAME_MAX)
  // A cut through an emoji (two UTF-16 units) would leave half of it: the half goes.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1)
  const name = cleanFolderName(cut)
  return name === '' ? null : name
}

/**
 * A dropped folder's files, and the files dropped loose, added in ONE step
 * (the Upload panel's drop, the store's `importDropped`).
 *
 * - `fresh`: the assets the probe made, in its order. Each found in a
 *   dropped folder's list (by the file the user has, `source ?? path`) is put
 *   in that folder; the rest go in none, as today.
 * - `dropped`: each dropped folder, by the name main took from the
 *   directory itself. An existing folder of that name (any case) receives its
 *   files, rather than a second one being made; otherwise the folder is added
 *   at the end of the list, even when every file in it failed to read, so the
 *   panel matches the disk.
 * - A file of a dropped folder that is ALREADY in the project, in no folder,
 *   goes into it; one the user already put in a folder stays where they put it.
 *
 * The same project back when nothing changes.
 */
export function addDroppedMedia(project: Project, fresh: readonly MediaAsset[], dropped: readonly { name: string; files: readonly string[] }[]): Project {
  const before = folderList(project)
  let folders = before
  const into = new Map<string, string>()
  for (const drop of dropped) {
    const name = folderNameFrom(drop.name)
    if (name === null) continue
    let folder = folders.find((f) => sameFolderName(f, name))
    if (folder === undefined) {
      folder = name
      folders = [...folders, name]
    }
    for (const file of drop.files) if (!into.has(file)) into.set(file, folder)
  }
  const fileOf = (a: MediaAsset): string => a.source ?? a.path
  let movedKnown = false
  const assets = project.assets.map((a) => {
    const folder = into.get(fileOf(a))
    if (folder === undefined || a.folder !== undefined) return a
    movedKnown = true
    return { ...a, folder }
  })
  const added = fresh.map((a) => {
    const folder = into.get(fileOf(a))
    return folder === undefined ? withoutFolder(a) : { ...a, folder }
  })
  if (added.length === 0 && !movedKnown && folders === before) return project
  const next: Project = { ...project, assets: added.length > 0 ? [...assets, ...added] : assets }
  if (folders.length > 0) next.folders = folders
  return next
}

/**
 * Folder data read from a file, made sound rather than refused (shared/project.ts):
 *
 * - `folders`: a non-array goes; each entry that is not a string, or is
 *   empty once trimmed, goes; a name longer than allowed is cut; a second
 *   entry of the same name (any case) goes.
 * - An asset's `folder` that is not a string, or empty once trimmed, goes
 *   (the file is in no folder). One naming a folder the list lacks adds it to
 *   the end of the list (the file says it is in a folder, so the folder
 *   exists); one naming a listed folder in another case is given the list's
 *   spelling.
 *
 * A project with no folder data anywhere comes back as the same object, so
 * an older project opens exactly as it did before folders existed.
 */
export function repairFolders(project: Project): Project {
  const hasList = 'folders' in project
  const hasAny = project.assets.some((a) => 'folder' in a)
  if (!hasList && !hasAny) return project

  const folders: string[] = []
  const raw: unknown = (project as { folders?: unknown }).folders
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const name = folderNameFrom(entry)
      if (name !== null && !folders.some((f) => sameFolderName(f, name))) folders.push(name)
    }
  }
  const assets = project.assets.map((a) => {
    if (!('folder' in a)) return a
    const name = folderNameFrom((a as { folder?: unknown }).folder)
    if (name === null) return withoutFolder(a)
    let folder = folders.find((f) => sameFolderName(f, name))
    if (folder === undefined) {
      folder = name
      folders.push(name)
    }
    return a.folder === folder ? a : { ...a, folder }
  })
  const next: Project = { ...project, assets }
  if (folders.length > 0) next.folders = folders
  else delete next.folders
  return next
}
