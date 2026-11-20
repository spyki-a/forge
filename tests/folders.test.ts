import { describe, expect, it } from 'vitest'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import {
  FOLDER_NAME_MAX,
  FOLDER_NAME_TAKEN,
  FOLDER_NAME_TOO_LONG,
  FOLDER_NEEDS_NAME,
  addDroppedMedia,
  folderNameProblem,
  makeFolder,
  moveToFolder,
  removeFolder,
  renameFolder,
  repairFolders
} from '@shared/edit/folders'
import { deserializeProject, serializeProject } from '@shared/project'
import { removeAssets } from '@shared/edit/removeAssets'
import { applyRelink } from '@shared/project/relink'
import { convertFrameRate } from '@shared/project/frameRate'

/*
 * The Upload panel's folders (shared/edit/folders.ts): one level, in the
 * project, never on disk. Each act is pure; the store's undo is held in
 * tests/renderer/poolFolders.test.tsx.
 */

function asset(id: string, patch: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id,
    path: `/shoot/${id}.jpg`,
    name: `${id}.jpg`,
    kind: 'image',
    durationFrames: 150,
    width: 1600,
    height: 1067,
    fps: null,
    hasVideo: true,
    hasAudio: false,
    size: 2048,
    ...patch
  }
}

function clip(id: string, assetId: string): Clip {
  return {
    id, assetId, trackId: 'v1', start: 0, duration: 60, inPoint: 0, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    color: { brightness: 0, contrast: 1, saturation: 1 }
  }
}

/** Two folders ("Ceremony" with a and b, "Bride 5:30pm" with c), d in none. */
function shoot(): Project {
  return {
    ...emptyProject('Shoot'),
    folders: ['Ceremony', 'Bride 5:30pm'],
    assets: [
      asset('a', { folder: 'Ceremony' }),
      asset('b', { folder: 'Ceremony' }),
      asset('c', { folder: 'Bride 5:30pm' }),
      asset('d')
    ]
  }
}

const folderOf = (p: Project): Record<string, string | null> => Object.fromEntries(p.assets.map((a) => [a.id, a.folder ?? null]))

describe('a folder’s name', () => {
  it('is trimmed, not empty, at most 40 characters, and unique without regard to case', () => {
    const p = shoot()
    expect(folderNameProblem(p, '')).toBe(FOLDER_NEEDS_NAME)
    expect(folderNameProblem(p, '   ')).toBe(FOLDER_NEEDS_NAME)
    expect(folderNameProblem(p, 'x'.repeat(FOLDER_NAME_MAX))).toBeNull()
    expect(folderNameProblem(p, 'x'.repeat(FOLDER_NAME_MAX + 1))).toBe(FOLDER_NAME_TOO_LONG)
    // The trimmed name is what is measured: 40 characters with spaces around them fit.
    expect(folderNameProblem(p, `  ${'x'.repeat(FOLDER_NAME_MAX)}  `)).toBeNull()
    expect(folderNameProblem(p, 'ceremony')).toBe(`${FOLDER_NAME_TAKEN} “Ceremony”`)
    expect(folderNameProblem(p, '  CEREMONY ')).toBe(`${FOLDER_NAME_TAKEN} “Ceremony”`)
    expect(folderNameProblem(p, 'Reception')).toBeNull()
  })

  it('may hold any character: it is never a filename', () => {
    const p = shoot()
    for (const name of ['Bride 5:30pm?', 'a/b\\c', 'CON', 'trailing.', '<"|*>']) {
      expect(folderNameProblem(p, name), name).toBeNull()
    }
  })

  it('is the same name composed or decomposed', () => {
    const p = makeFolder(shoot(), 'Café')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(folderNameProblem(p.project, 'Café')).toBe(`${FOLDER_NAME_TAKEN} “Café”`)
  })

  it('is made trimmed, at the end of the list, and a taken one is refused with the sentence', () => {
    const made = makeFolder(shoot(), '  Reception  ')
    expect(made.ok && made.project.folders).toEqual(['Ceremony', 'Bride 5:30pm', 'Reception'])
    const twice = makeFolder(shoot(), 'bride 5:30PM')
    expect(twice).toEqual({ ok: false, problem: `${FOLDER_NAME_TAKEN} “Bride 5:30pm”` })
  })
})

describe('renaming a folder', () => {
  it('keeps its files in it and its place in the list; nothing else moves', () => {
    const before = shoot()
    const copy = structuredClone(before)
    const renamed = renameFolder(before, 'Ceremony', 'Vows')
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(renamed.project.folders).toEqual(['Vows', 'Bride 5:30pm'])
    expect(folderOf(renamed.project)).toEqual({ a: 'Vows', b: 'Vows', c: 'Bride 5:30pm', d: null })
    // Pure: the project it was given is as it was.
    expect(before).toEqual(copy)
  })

  it('may change only the case of its own name, and may not take another folder’s', () => {
    const own = renameFolder(shoot(), 'Ceremony', 'CEREMONY')
    expect(own.ok && own.project.folders).toEqual(['CEREMONY', 'Bride 5:30pm'])
    expect(renameFolder(shoot(), 'Ceremony', 'bride 5:30pm')).toEqual({ ok: false, problem: `${FOLDER_NAME_TAKEN} “Bride 5:30pm”` })
    const same = renameFolder(shoot(), 'Ceremony', ' Ceremony ')
    expect(same.ok).toBe(true)
  })
})

describe('moving files', () => {
  it('into a folder, out to none (the key gone), and never into a folder the project lacks', () => {
    const p = shoot()
    const into = moveToFolder(p, ['d', 'c'], 'Ceremony')
    expect(folderOf(into)).toEqual({ a: 'Ceremony', b: 'Ceremony', c: 'Ceremony', d: 'Ceremony' })
    const out = moveToFolder(p, ['a'], null)
    expect('folder' in out.assets.find((a) => a.id === 'a')!).toBe(false)
    expect(folderOf(out)).toEqual({ a: null, b: 'Ceremony', c: 'Bride 5:30pm', d: null })
    expect(moveToFolder(p, ['d'], 'Nowhere')).toBe(p)
    // Already there: the same project, so the store adds no undo step.
    expect(moveToFolder(p, ['a', 'b'], 'Ceremony')).toBe(p)
  })
})

describe('removing a folder', () => {
  it('keeps every file in the project, back in no folder, and leaves the other folders alone', () => {
    const p = shoot()
    const gone = removeFolder(p, 'Ceremony')
    expect(gone.assets.map((a) => a.id)).toEqual(p.assets.map((a) => a.id))
    expect(gone.folders).toEqual(['Bride 5:30pm'])
    expect(folderOf(gone)).toEqual({ a: null, b: null, c: 'Bride 5:30pm', d: null })
    // Every other field of each file is as it was.
    expect(gone.assets.map((a) => ({ ...a, folder: undefined }))).toEqual(p.assets.map((a) => ({ ...a, folder: undefined })))
  })

  it('the last one takes the list with it, so the project is shaped as one that never had folders', () => {
    const none = removeFolder(removeFolder(shoot(), 'Ceremony'), 'Bride 5:30pm')
    expect('folders' in none).toBe(false)
    expect(none.assets.some((a) => 'folder' in a)).toBe(false)
  })
})

describe('removing a FILE (Remove from project)', () => {
  it('leaves its folder standing, even when it was the folder’s last file', () => {
    const p = { ...shoot(), clips: [clip('c1', 'c')] }
    const next = removeAssets(p, ['c'])
    expect(next.assets.map((a) => a.id)).not.toContain('c')
    expect(next.folders).toEqual(['Ceremony', 'Bride 5:30pm'])
  })
})

describe('a dropped folder', () => {
  const probed = (path: string, id: string, patch: Partial<MediaAsset> = {}): MediaAsset => asset(id, { path, ...patch })

  it('becomes a folder of its name holding its files; loose files go to none; an existing folder (any case) receives rather than a second being made', () => {
    const p = shoot()
    const fresh = [
      probed('/disk/Day 1/x.jpg', 'x'),
      probed('/disk/loose.jpg', 'loose'),
      probed('/cache/y.png', 'y', { source: '/disk/ceremony/y.heic' })
    ]
    const next = addDroppedMedia(p, fresh, [
      { name: 'Day 1', files: ['/disk/Day 1/x.jpg'] },
      { name: 'ceremony', files: ['/disk/ceremony/y.heic'] }
    ])
    expect(next.folders).toEqual(['Ceremony', 'Bride 5:30pm', 'Day 1'])
    expect(folderOf(next)).toMatchObject({ x: 'Day 1', y: 'Ceremony', loose: null })
    expect('folder' in next.assets.find((a) => a.id === 'loose')!).toBe(false)
  })

  it('takes in a file of it already in the project in no folder, and leaves one the user already put in a folder', () => {
    const p = shoot()
    const next = addDroppedMedia(p, [], [{ name: 'Day 1', files: ['/shoot/d.jpg', '/shoot/c.jpg'] }])
    expect(folderOf(next)).toMatchObject({ d: 'Day 1', c: 'Bride 5:30pm' })
  })

  it('a folder whose files all failed to read still appears, as on disk; nothing at all is the same project', () => {
    const p = shoot()
    expect(addDroppedMedia(p, [], [{ name: 'Broken', files: ['/disk/Broken/z.jpg'] }]).folders).toContain('Broken')
    const plain = { ...emptyProject('x'), assets: [asset('q')] }
    expect(addDroppedMedia(plain, [], [])).toBe(plain)
    // Loose files only: added as an import always added them, and still no folder data at all.
    const loose = addDroppedMedia(plain, [asset('r')], [])
    expect('folders' in loose).toBe(false)
    expect(loose.assets.map((a) => a.id)).toEqual(['q', 'r'])
  })

  it('a name longer than allowed is cut to 40 characters', () => {
    const long = 'A very long folder name from a camera card 2026'
    const next = addDroppedMedia(emptyProject('x'), [], [{ name: long, files: ['/a.jpg'] }])
    expect(next.folders).toEqual([long.slice(0, FOLDER_NAME_MAX).trim()])
  })
})

/* ------------------------------------------------------------- the file */

describe('the project file', () => {
  it('an older project opens and saves back byte for byte: no folder data appears', () => {
    const older = { ...emptyProject('Old'), id: 'p-old', assets: [asset('a'), asset('b')], clips: [clip('c1', 'a')] }
    const now = new Date('2026-01-02T03:04:05.000Z')
    const text = JSON.stringify(serializeProject(older, { appVersion: '0.1.0', now }))
    expect(text).not.toContain('"folder')
    const opened = deserializeProject(JSON.parse(text)).project
    expect('folders' in opened).toBe(false)
    expect(opened.assets.some((a) => 'folder' in a)).toBe(false)
    expect(JSON.stringify(serializeProject(opened, { appVersion: '0.1.0', now }))).toBe(text)
  })

  it('a project with no folder data is not even copied by the repair', () => {
    const p = { ...emptyProject('x'), assets: [asset('a')] }
    expect(repairFolders(p)).toBe(p)
  })

  it('a project with folders round-trips exactly', () => {
    const p = { ...shoot(), id: 'p1', folders: ['Ceremony', 'Bride 5:30pm', 'Empty'] }
    const opened = deserializeProject(JSON.parse(JSON.stringify(serializeProject(p, { appVersion: '1' })))).project
    expect(opened).toEqual(p)
  })

  it('broken folder data is repaired, not refused', () => {
    const p = shoot()
    const raw = JSON.parse(JSON.stringify(serializeProject({ ...p, id: 'p2' }, { appVersion: '1' })))
    raw.project.folders = ['Ceremony', 'ceremony', 7, '   ', null, `  ${'z'.repeat(50)} `, 'Bride 5:30pm']
    raw.project.assets[0].folder = 'CEREMONY' // another case of a listed folder
    raw.project.assets[1].folder = 42 // not a string
    raw.project.assets[2].folder = 'Lost' // a folder the list lacks
    raw.project.assets[3].folder = '  ' // empty
    const opened = deserializeProject(raw).project
    expect(opened.folders).toEqual(['Ceremony', 'z'.repeat(FOLDER_NAME_MAX), 'Bride 5:30pm', 'Lost'])
    expect(folderOf(opened)).toEqual({ a: 'Ceremony', b: null, c: 'Lost', d: null })
    expect('folder' in opened.assets[1]).toBe(false)
    expect('folder' in opened.assets[3]).toBe(false)

    const notAList = JSON.parse(JSON.stringify(raw))
    notAList.project.folders = 'Ceremony'
    notAList.project.assets[2].folder = 'Ceremony'
    // No list to read: the files' own folders make it, the first spelling met kept for both.
    const rebuilt = deserializeProject(notAList).project
    expect(rebuilt.folders).toEqual(['CEREMONY'])
    expect(folderOf(rebuilt)).toEqual({ a: 'CEREMONY', b: null, c: 'CEREMONY', d: null })
  })
})

describe('the places that rebuild an asset keep its folder', () => {
  it('a relink, to a file or to a converted copy', () => {
    const p = shoot()
    expect(applyRelink(p, { a: '/new/a.jpg' }).assets[0].folder).toBe('Ceremony')
    expect(applyRelink(p, { c: { path: '/cache/c.png', source: '/new/c.heic' } }).assets[2].folder).toBe('Bride 5:30pm')
  })

  it('a change of frame rate', () => {
    const converted = convertFrameRate(shoot(), 25)
    expect(folderOf(converted)).toEqual(folderOf(shoot()))
    expect(converted.folders).toEqual(shoot().folders)
  })
})
