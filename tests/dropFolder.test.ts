import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { droppedFolderName, listDropped } from '../src/main/dropFolder'
import { DROP_ENTRY_LIMIT, DROP_FILE_LIMIT } from '@shared/dropped'

/*
 * A drop onto the Upload panel, read in main (src/main/dropFolder.ts): a temp
 * tree made here, with media and non-media files, a subfolder, hidden files,
 * awkward names and links. Every assertion about a name is on the name (or
 * the basename), never on a path: a drive letter's colon is not content.
 */

let dir: string
let outside: string
/** The tree's folder, named with spaces, an apostrophe and (where the platform keeps it) a trailing dot. */
let shoot: string
const trailingDot = process.platform !== 'win32'
const SHOOT = trailingDot ? "Day 1 - Priya's wedding." : "Day 1 - Priya's wedding"
let linked = { toFileInside: false, toOutside: false, toFolderInside: false }

async function touch(path: string, bytes = 'x'): Promise<void> {
  await writeFile(path, bytes)
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-drop-'))
  shoot = join(dir, SHOOT)
  outside = join(dir, 'elsewhere')
  await mkdir(join(shoot, 'Ceremony', 'Rings'), { recursive: true })
  await mkdir(outside)
  await touch(join(shoot, 'IMG_10.JPG'))
  await touch(join(shoot, 'IMG_2.jpg'))
  await touch(join(shoot, 'notes.txt'))
  await touch(join(shoot, 'contract.pdf'))
  await touch(join(shoot, '._IMG_2.jpg')) // what macOS leaves beside a picture on a card
  await touch(join(shoot, '.DS_Store'))
  await touch(join(shoot, 'first dance.mov'))
  await touch(join(shoot, 'Ceremony', 'vows.m4a'))
  await touch(join(shoot, 'Ceremony', 'Rings', 'ring.heic'))
  await touch(join(outside, 'secret.jpg'))
  await mkdir(join(shoot, '.hidden'))
  await touch(join(shoot, '.hidden', 'thumb.jpg'))
  // Links, where the platform lets a test make them (Windows needs a privilege for a file link).
  const link = async (target: string, path: string, type?: 'dir' | 'file'): Promise<boolean> =>
    symlink(target, path, type).then(
      () => true,
      () => false
    )
  linked = {
    toOutside: await link(join(outside, 'secret.jpg'), join(shoot, 'out.jpg'), 'file'),
    toFileInside: await link(join(shoot, 'Ceremony', 'vows.m4a'), join(shoot, 'vows link.m4a'), 'file'),
    toFolderInside: await link(join(shoot, 'Ceremony'), join(shoot, 'zz loop'), 'dir')
  }
  await link(outside, join(shoot, 'Ceremony', 'away'), 'dir')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
})

const names = (files: string[]): string[] => files.map((f) => basename(f))

describe('a dropped folder', () => {
  it('is its own name and the media files in it and its subfolders, its own first, each in name order', async () => {
    const { loose, folders } = await listDropped([shoot])
    expect(loose).toEqual([])
    expect(folders).toHaveLength(1)
    expect(folders[0].name).toBe(SHOOT)
    expect(folders[0].capped).toBe(false)
    const listed = names(folders[0].files)
    // Media by the Upload dialog's extensions, any case; the rest passed over.
    expect(listed).toEqual(expect.arrayContaining(['IMG_2.jpg', 'IMG_10.JPG', 'first dance.mov', 'vows.m4a', 'ring.heic']))
    expect(listed).not.toContain('notes.txt')
    expect(listed).not.toContain('contract.pdf')
    // Hidden entries, files and folders, are passed over.
    expect(listed).not.toContain('._IMG_2.jpg')
    expect(listed).not.toContain('thumb.jpg')
    // Name order with numbers read as numbers, and the folder's own files before its subfolders'.
    expect(listed.indexOf('IMG_2.jpg')).toBeLessThan(listed.indexOf('IMG_10.JPG'))
    expect(listed.indexOf('first dance.mov')).toBeLessThan(listed.indexOf('vows.m4a'))
    expect(listed.indexOf('vows.m4a')).toBeLessThan(listed.indexOf('ring.heic'))
    // Each file is listed once, inside the dropped folder.
    expect(new Set(folders[0].files).size).toBe(folders[0].files.length)
    for (const file of folders[0].files) expect(file.startsWith(shoot)).toBe(true)
  })

  it('follows no link out of the folder, walks no linked folder, and lists a link to a file inside it', async () => {
    const listed = names((await listDropped([shoot])).folders[0].files)
    expect(listed).not.toContain('secret.jpg')
    if (linked.toOutside) expect(listed).not.toContain('out.jpg')
    // A linked folder is never walked: vows.m4a once (its own), not again through "zz loop".
    expect(listed.filter((n) => n === 'vows.m4a')).toHaveLength(1)
    if (linked.toFileInside) expect(listed).toContain('vows link.m4a')
    // Off Windows every link was made, so none of the checks above was skipped.
    if (process.platform !== 'win32') expect(linked).toEqual({ toFileInside: true, toOutside: true, toFolderInside: true })
  })

  it('stops at the bound and says so', async () => {
    const few = await listDropped([shoot], { files: 2, entries: DROP_ENTRY_LIMIT })
    expect(few.folders[0].files).toHaveLength(2)
    expect(few.folders[0].capped).toBe(true)
    const exact = await listDropped([shoot])
    const all = exact.folders[0].files.length
    // Exactly as many as the folder holds is not more than one drop reads.
    const fits = await listDropped([shoot], { files: all, entries: DROP_ENTRY_LIMIT })
    expect(fits.folders[0].capped).toBe(false)
    const entries = await listDropped([shoot], { files: DROP_FILE_LIMIT, entries: 3 })
    expect(entries.folders[0].capped).toBe(true)
    expect(entries.folders[0].files.length).toBeLessThan(all)
  })

  it('the bounds are the documented ones', () => {
    expect(DROP_FILE_LIMIT).toBe(2000)
    expect(DROP_ENTRY_LIMIT).toBe(20000)
  })
})

describe('a drop of several things', () => {
  it('hands back what is not a folder unchanged and in order, a folder beside them', async () => {
    const file = join(shoot, 'IMG_2.jpg')
    const missing = join(dir, 'gone.jpg')
    const { loose, folders } = await listDropped([file, join(shoot, 'Ceremony'), missing, join(shoot, 'notes.txt')])
    expect(loose).toEqual([file, missing, join(shoot, 'notes.txt')])
    expect(folders.map((f) => f.name)).toEqual(['Ceremony'])
    expect(names(folders[0].files)).toEqual(['vows.m4a', 'ring.heic'])
  })

  it('an empty folder is a folder with no files', async () => {
    const empty = join(dir, 'Empty one')
    await mkdir(empty)
    const { folders } = await listDropped([empty])
    expect(folders).toEqual([{ name: 'Empty one', files: [], capped: false }])
  })
})

describe('a folder’s name', () => {
  it('is its last segment, with a trailing separator or not', () => {
    expect(droppedFolderName(shoot)).toBe(SHOOT)
    expect(droppedFolderName(`${shoot}/`)).toBe(SHOOT)
    expect(droppedFolderName(join(shoot, 'Ceremony'))).toBe('Ceremony')
  })
})
