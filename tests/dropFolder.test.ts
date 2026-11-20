import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, posix, win32 } from 'node:path'
import { droppedFolderName, listDropped } from '../src/main/dropFolder'
import {
  DROP_ENTRY_LIMIT,
  DROP_FILE_LIMIT,
  droppedCappedText,
  droppedEmptyText,
  droppedNotices,
  droppedTooBigText,
  droppedUnreadFoldersText,
  droppedUnreadableText
} from '@shared/dropped'

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

/** A folder made unreadable can be tested only where chmod bites: not on Windows, and not as root. */
const canLock = process.platform !== 'win32' && process.getuid?.() !== 0

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

describe('a dropped folder that cannot be read whole', () => {
  it('is unreadable, not empty, when the folder itself cannot be read', async () => {
    if (!canLock) return
    const locked = join(dir, 'Locked')
    await mkdir(locked)
    await touch(join(locked, 'a.jpg'))
    await chmod(locked, 0o000)
    try {
      const { folders } = await listDropped([locked])
      expect(folders).toEqual([{ name: 'Locked', files: [], capped: false, unreadable: true }])
      expect(droppedNotices(folders[0])).toEqual([droppedUnreadableText(folders[0])])
    } finally {
      await chmod(locked, 0o755)
    }
  })

  it('counts each folder inside it that cannot be read, and keeps the rest', async () => {
    if (!canLock) return
    const day = join(dir, 'Day 2')
    await mkdir(join(day, 'Ceremony'), { recursive: true })
    await mkdir(join(day, 'Party'))
    await touch(join(day, 'a.jpg'))
    await touch(join(day, 'Ceremony', 'b.jpg'))
    await touch(join(day, 'Party', 'c.jpg'))
    await chmod(join(day, 'Ceremony'), 0o000)
    try {
      const { folders } = await listDropped([day])
      expect(names(folders[0].files)).toEqual(['a.jpg', 'c.jpg'])
      expect(folders[0].unreadFolders).toBe(1)
      expect(folders[0].unreadable).toBeUndefined()
      expect(droppedNotices(folders[0])).toEqual([droppedUnreadFoldersText({ name: 'Day 2', unreadFolders: 1 })])
    } finally {
      await chmod(join(day, 'Ceremony'), 0o755)
    }
  })

  it('a folder read whole carries neither mark', async () => {
    const { folders } = await listDropped([shoot])
    expect('unreadable' in folders[0]).toBe(false)
    expect('unreadFolders' in folders[0]).toBe(false)
  })

  it('reaching the entry bound before any media is "too many to read", never "no photos"', async () => {
    const home = join(dir, 'Home')
    await mkdir(home)
    for (let i = 0; i < 5; i++) await touch(join(home, `n${i}.txt`))
    await touch(join(home, 'zz.jpg'))
    const { folders } = await listDropped([home], { files: DROP_FILE_LIMIT, entries: 3 })
    expect(folders[0]).toMatchObject({ name: 'Home', files: [], capped: true })
    expect(droppedNotices(folders[0])).toEqual([droppedTooBigText(folders[0])])
    // Read whole, the same folder has its photo.
    expect(names((await listDropped([home])).folders[0].files)).toEqual(['zz.jpg'])
  })
})

describe('what the panel says about a dropped folder', () => {
  const folder = (patch: Partial<Parameters<typeof droppedNotices>[0]>) => ({ name: 'Day 1', files: [] as string[], capped: false, ...patch })
  it('one of unreadable, too big, capped or empty, in that order, and unread folders beside it', () => {
    expect(droppedNotices(folder({ files: ['/a.jpg'] }))).toEqual([])
    expect(droppedNotices(folder({}))).toEqual([droppedEmptyText({ name: 'Day 1' })])
    expect(droppedNotices(folder({ capped: true }))).toEqual([droppedTooBigText({ name: 'Day 1' })])
    expect(droppedNotices(folder({ capped: true, files: ['/a.jpg'] }))).toEqual([droppedCappedText({ name: 'Day 1', files: ['/a.jpg'] })])
    expect(droppedNotices(folder({ unreadable: true }))).toEqual([droppedUnreadableText({ name: 'Day 1' })])
    expect(droppedNotices(folder({ files: ['/a.jpg'], unreadFolders: 2 }))).toEqual([droppedUnreadFoldersText({ name: 'Day 1', unreadFolders: 2 })])
    expect(droppedNotices(folder({ unreadFolders: 1 }))).toEqual([
      droppedEmptyText({ name: 'Day 1' }),
      droppedUnreadFoldersText({ name: 'Day 1', unreadFolders: 1 })
    ])
  })

  it('in plain words, singular right', () => {
    expect(droppedTooBigText({ name: 'Home' })).not.toContain('no photos')
    expect(droppedUnreadableText({ name: 'Locked' })).not.toContain('no photos')
    expect(droppedUnreadFoldersText({ name: 'D', unreadFolders: 1 })).toBe('1 folder inside “D” could not be opened, so its files were not added')
    expect(droppedUnreadFoldersText({ name: 'D', unreadFolders: 3 })).toBe('3 folders inside “D” could not be opened, so their files were not added')
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

  // Every platform's shapes on every runner: the host's own path module never sees the other's.
  it('Windows shapes: a drive, its root, a trailing backslash, a UNC share and a folder in it', () => {
    expect(droppedFolderName('D:\\', win32)).toBe('D:')
    expect(droppedFolderName('D:\\Shoots\\Day 1\\', win32)).toBe('Day 1')
    expect(droppedFolderName('D:\\Shoots\\Bride 5.30pm', win32)).toBe('Bride 5.30pm')
    expect(droppedFolderName('\\\\nas\\photos\\', win32)).toBe('photos')
    expect(droppedFolderName('\\\\nas\\photos\\Day 1', win32)).toBe('Day 1')
  })

  it('macOS and Linux shapes: the disk’s root, a card, a trailing slash', () => {
    expect(droppedFolderName('/', posix)).toBe('/')
    expect(droppedFolderName('/Volumes/EOS_DIGITAL/', posix)).toBe('EOS_DIGITAL')
    expect(droppedFolderName("/Users/a/Priya's day", posix)).toBe("Priya's day")
  })

  it('is the folder a path leads to, not its last written segment', () => {
    expect(droppedFolderName('/Volumes/CARD/DCIM/..', posix)).toBe('CARD')
    expect(droppedFolderName('D:\\Shoots\\Day 1\\..', win32)).toBe('Shoots')
  })
})
