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

/** The notice when a folder held more than one drop reads; nothing else that is passed over is announced. */
export function droppedCappedText(folder: Pick<DroppedFolder, 'name' | 'files'>): string {
  return `“${folder.name}” holds more than one drop reads: the first ${folder.files.length} files were added`
}

/** The notice for a dropped folder with no photo, video or sound anywhere in it. */
export function droppedEmptyText(folder: Pick<DroppedFolder, 'name'>): string {
  return `“${folder.name}” has no photos, videos or sounds in it`
}
