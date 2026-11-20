/**
 * What main makes of a drop onto the Upload panel (main/dropFolder.ts, the
 * bridge's `listDropped`): the loose files as they came, and each dropped
 * folder as its own name and the media files in it.
 */
export interface DroppedFolder {
  /** The dropped directory's own last segment, taken in main. A name, never joined into a path. */
  name: string
  /** The media files in it and in its subfolders, all at this one level, in name order. */
  files: string[]
  /** True when the folder holds more than one drop reads (DROP_FILE_LIMIT, DROP_ENTRY_LIMIT): `files` is the first part. */
  capped: boolean
  /** True when the dropped folder itself could not be read (permissions, privacy protection, a card pulled out): `files` is then empty, and that is not "no media". */
  unreadable?: boolean
  /** How many folders inside it could not be read; their files are not in `files`. Absent when none. */
  unreadFolders?: number
}

export interface DroppedMedia {
  /** What was dropped that is not a folder, unchanged and in order: imported as a drop always was. */
  loose: string[]
  folders: DroppedFolder[]
}

/**
 * The most media files one dropped folder adds. A wedding day is a few
 * hundred to a couple of thousand pictures; each file is probed on import,
 * so a folder that is someone's whole photo library must stop somewhere.
 */
export const DROP_FILE_LIMIT = 2000

/**
 * The most entries (files and folders, media or not) read under one dropped
 * folder: the bound on a drop of a home folder or a disk, where the media
 * would never reach DROP_FILE_LIMIT and the walk would take minutes.
 */
export const DROP_ENTRY_LIMIT = 20000

/*
 * What the panel says about a dropped folder (the store's `importDropped`),
 * at most one of the first four, in this order, and the last beside it. Files
 * passed over on purpose (hidden ones, non-media, links out) are not announced.
 */

/** The dropped folder could not be read at all. */
export function droppedUnreadableText(folder: Pick<DroppedFolder, 'name'>): string {
  return `“${folder.name}” could not be opened, so nothing in it was added`
}

/** The bound was reached before any media file was found: there may well be media past it. */
export function droppedTooBigText(folder: Pick<DroppedFolder, 'name'>): string {
  return `“${folder.name}” has too many files to read in one drop: drop the folders inside it one at a time`
}

/** The bound was reached after some media: `files` is the first part of it (known files among them are not added twice). */
export function droppedCappedText(folder: Pick<DroppedFolder, 'name' | 'files'>): string {
  return `“${folder.name}” has more files than one drop can add: only the first ${folder.files.length} were looked at`
}

/** The whole folder was read and holds no photo, video or sound. */
export function droppedEmptyText(folder: Pick<DroppedFolder, 'name'>): string {
  return `“${folder.name}” has no photos, videos or sounds in it`
}

/** Folders inside it that could not be read; said beside whatever else is said. */
export function droppedUnreadFoldersText(folder: Pick<DroppedFolder, 'name'> & { unreadFolders: number }): string {
  const n = folder.unreadFolders
  return n === 1
    ? `1 folder inside “${folder.name}” could not be opened, so its files were not added`
    : `${n} folders inside “${folder.name}” could not be opened, so their files were not added`
}

/** Every notice for one dropped folder, in order: none when it was read whole and holds media. */
export function droppedNotices(folder: DroppedFolder): string[] {
  const said: string[] = []
  if (folder.unreadable) said.push(droppedUnreadableText(folder))
  else if (folder.capped && folder.files.length === 0) said.push(droppedTooBigText(folder))
  else if (folder.capped) said.push(droppedCappedText(folder))
  else if (folder.files.length === 0) said.push(droppedEmptyText(folder))
  if (!folder.unreadable && (folder.unreadFolders ?? 0) > 0) said.push(droppedUnreadFoldersText({ name: folder.name, unreadFolders: folder.unreadFolders! }))
  return said
}
