import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { emptyProject, type MediaAsset, type Project } from '@shared/timeline'
import { DRAG_MIME, canvasDropRoute, trackDropRoute } from '@shared/dragPayload'
import { FOLDER_NAME_TAKEN } from '@shared/edit/folders'
import { droppedCappedText, droppedEmptyText, type DroppedMedia } from '@shared/dropped'

/*
 * The Upload panel's folders, in the store and on the panel (MediaPool.tsx;
 * shared/edit/folders.ts holds the pure acts, tests/folders.test.ts their rules).
 *
 * The store is the real one, mocked to a plain selector as
 * tests/renderer/poolRemove.test.tsx does, so a menu can be called as a
 * function and its items pressed, and the panel rendered to markup. The
 * DOM's drag and drop is the harness page's to show; the rule a drop inside
 * the list follows (`tileDropped`) is held here.
 */

vi.mock('../../src/renderer/src/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/src/store')>()
  const store = real.useEditor
  const useEditor = Object.assign((select: (s: unknown) => unknown) => select(store.getState()), {
    getState: store.getState,
    setState: store.setState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe
  })
  return { ...real, useEditor }
})
vi.mock('../../src/renderer/src/components/ui/Menu', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/src/components/ui/Menu')>()
  return { ...real, useMenuDismiss: () => undefined }
})

const { useEditor } = await import('../../src/renderer/src/store')
const pool = await import('../../src/renderer/src/components/MediaPool')
const { MediaPool, PoolMenu, FolderMenu, poolPayload, tileDropped } = pool
const { MenuItem } = await import('../../src/renderer/src/components/ui/Menu')
const { setDragPayload } = await import('../../src/renderer/src/dragPayload')

const state = () => useEditor.getState()

function asset(id: string, patch: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id, path: `/shoot/${id}.jpg`, name: `${id}.jpg`, kind: 'image', durationFrames: 150,
    width: 1600, height: 1067, fps: null, hasVideo: true, hasAudio: false, size: 2048, ...patch
  }
}

/** "Ceremony" (a, b), "Empty" (nothing), c in none. */
function shoot(): Project {
  return {
    ...emptyProject('Shoot'),
    folders: ['Ceremony', 'Empty'],
    assets: [asset('a', { folder: 'Ceremony' }), asset('b', { folder: 'Ceremony' }), asset('c')]
  }
}

function open(project: Project = shoot()): Project {
  useEditor.setState({ ...useEditor.getInitialState(), project, past: [], future: [] })
  return project
}

/** Every bridge call, by name, answered from `answers` (else undefined). */
let calls: { name: string; args: unknown[] }[] = []
let answers: Record<string, (...args: unknown[]) => unknown> = {}
const bridge = new Proxy({} as Record<string, unknown>, {
  get: (_target, name: string) => (...args: unknown[]) => {
    calls.push({ name, args })
    return Promise.resolve(answers[name]?.(...args))
  }
})

beforeEach(() => {
  calls = []
  answers = {}
  vi.stubGlobal('window', Object.assign(new EventTarget(), { forge: bridge, innerWidth: 1280, innerHeight: 800 }))
  vi.stubGlobal('navigator', { platform: 'MacIntel' })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/** Each act, from a copy taken before it: one undo step, the project back exactly, redo the act again. */
function oneStep(act: () => void): Project {
  const copy = structuredClone(state().project)
  const steps = state().past.length
  act()
  expect(state().past).toHaveLength(steps + 1)
  const after = state().project
  state().undo()
  expect(state().project).toEqual(copy)
  state().redo()
  expect(state().project).toBe(after)
  return after
}

const folderOf = (p: Project): Record<string, string | null> => Object.fromEntries(p.assets.map((a) => [a.id, a.folder ?? null]))

/* ------------------------------------------------------------------ the store */

describe('the folder acts in the store, each one undo step', () => {
  it('makes a folder, and refuses a taken name with the sentence and no step', () => {
    open()
    const after = oneStep(() => expect(state().makeFolder('  Reception ')).toBeNull())
    expect(after.folders).toEqual(['Ceremony', 'Empty', 'Reception'])
    const steps = state().past.length
    expect(state().makeFolder('ceremony')).toBe(`${FOLDER_NAME_TAKEN} “Ceremony”`)
    expect(state().past).toHaveLength(steps)
  })

  it('makes a folder with files in it (a tile’s "New folder…"): ONE step for both', () => {
    open()
    const after = oneStep(() => state().makeFolder('Portraits', ['c']))
    expect(after.folders).toContain('Portraits')
    expect(folderOf(after).c).toBe('Portraits')
  })

  it('renames a folder; its files follow, and folded follows the name', () => {
    open()
    state().toggleFolder('Ceremony')
    const after = oneStep(() => expect(state().renameFolder('Ceremony', 'Vows')).toBeNull())
    expect(folderOf(after)).toEqual({ a: 'Vows', b: 'Vows', c: null })
    expect(state().foldedFolders).toEqual(['Vows'])
  })

  it('moves files into a folder and out to none; a move to where they are is no step', () => {
    open()
    oneStep(() => state().moveAssetsToFolder(['c'], 'Empty'))
    oneStep(() => state().moveAssetsToFolder(['a'], null))
    const steps = state().past.length
    state().moveAssetsToFolder(['b'], 'Ceremony')
    expect(state().past).toHaveLength(steps)
  })

  it('removes a folder and keeps every file of it in the project', () => {
    open()
    const after = oneStep(() => state().removeFolder('Ceremony'))
    expect(after.assets.map((a) => a.id)).toEqual(['a', 'b', 'c'])
    expect(folderOf(after)).toEqual({ a: null, b: null, c: null })
    expect(after.folders).toEqual(['Empty'])
  })

  it('removing a file (piece 1) leaves its folder standing', () => {
    open()
    state().removeAsset('a')
    state().removeAsset('b')
    expect(state().project.folders).toEqual(['Ceremony', 'Empty'])
  })
})

describe('a name typed in place', () => {
  it('New folder: Enter on a taken name keeps the field and says why; a free name makes it and closes', () => {
    open()
    state().startNewFolder()
    state().setFolderDraft('CEREMONY')
    expect(state().commitFolderEdit()).toBe(`${FOLDER_NAME_TAKEN} “Ceremony”`)
    expect(state().folderEdit).not.toBeNull()
    const html = renderToStaticMarkup(createElement(MediaPool))
    expect(html).toContain(`>${FOLDER_NAME_TAKEN} “Ceremony”<`)
    state().setFolderDraft('Getting ready')
    expect(state().commitFolderEdit()).toBeNull()
    expect(state().folderEdit).toBeNull()
    expect(state().project.folders).toEqual(['Ceremony', 'Empty', 'Getting ready'])
    expect(state().past).toHaveLength(1)
  })

  it('nothing typed makes nothing; a rename to its own name is no step', () => {
    open()
    state().startNewFolder()
    expect(state().commitFolderEdit()).toBeNull()
    state().startRenameFolder('Ceremony')
    expect(state().folderEdit).toEqual({ from: 'Ceremony', draft: 'Ceremony' })
    expect(state().commitFolderEdit()).toBeNull()
    expect(state().past).toHaveLength(0)
    expect(state().project.folders).toEqual(['Ceremony', 'Empty'])
  })

  it('a tile’s "New folder…" makes the folder with that file in it', () => {
    open()
    state().startNewFolder(['c'])
    state().setFolderDraft('Detail shots')
    state().commitFolderEdit()
    expect(folderOf(state().project).c).toBe('Detail shots')
    expect(state().past).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ a dropped folder */

describe('a folder dropped from Finder or Explorer', () => {
  const probe = (paths: unknown) => ({
    assets: (paths as string[]).map((p) => asset(p.split('/').pop()!.replace(/\.\w+$/, ''), { path: p })),
    failed: []
  })

  it('becomes a folder of its name with its files, loose files in none, all in ONE step', async () => {
    open({ ...emptyProject('x'), assets: [] })
    answers.listDropped = (): DroppedMedia => ({
      loose: ['/disk/loose.jpg'],
      folders: [{ name: 'Day 1', files: ['/disk/Day 1/x.jpg', '/disk/Day 1/sub/y.jpg'], capped: false }]
    })
    answers.probe = probe
    await state().importDropped(['/disk/loose.jpg', '/disk/Day 1'])
    expect(calls.map((c) => c.name)).toEqual(['listDropped', 'probe'])
    expect(calls[0].args[0]).toEqual(['/disk/loose.jpg', '/disk/Day 1'])
    expect(state().project.folders).toEqual(['Day 1'])
    expect(folderOf(state().project)).toEqual({ loose: null, x: 'Day 1', y: 'Day 1' })
    expect(state().past).toHaveLength(1)
    state().undo()
    expect(state().project.assets).toEqual([])
    expect('folders' in state().project).toBe(false)
  })

  it('an existing folder of that name receives the files; nothing is said when nothing was passed over', async () => {
    open()
    answers.listDropped = (): DroppedMedia => ({ loose: [], folders: [{ name: 'ceremony', files: ['/disk/z.jpg'], capped: false }] })
    answers.probe = probe
    await state().importDropped(['/disk/ceremony'])
    expect(state().project.folders).toEqual(['Ceremony', 'Empty'])
    expect(folderOf(state().project).z).toBe('Ceremony')
    expect(state().notices).toEqual([])
  })

  it('says so when a folder held more than one drop reads, or nothing to add', async () => {
    open()
    const big = { name: 'Whole card', files: ['/card/1.jpg'], capped: true }
    const none = { name: 'Paperwork', files: [], capped: false }
    answers.listDropped = (): DroppedMedia => ({ loose: [], folders: [big, none] })
    answers.probe = probe
    await state().importDropped(['/card', '/paperwork'])
    expect(state().notices.map((n) => n.text)).toEqual([droppedCappedText(big), droppedEmptyText(none)])
    expect(state().project.folders).toEqual(['Ceremony', 'Empty', 'Whole card'])
  })

  it('loose files alone are imported as before: the same assets, no folder data', async () => {
    open({ ...emptyProject('x'), assets: [] })
    answers.listDropped = (paths: unknown): DroppedMedia => ({ loose: paths as string[], folders: [] })
    answers.probe = probe
    await state().importDropped(['/disk/a.jpg', '/disk/b.jpg'])
    expect(state().project.assets.map((a) => a.id)).toEqual(['a', 'b'])
    expect('folders' in state().project).toBe(false)
    expect(state().project.assets.some((a) => 'folder' in a)).toBe(false)
  })
})

/* ------------------------------------------------------------------ the panel */

const html = (): string => renderToStaticMarkup(createElement(MediaPool))

describe('the panel', () => {
  it('with no folders is today’s panel: one grid of every tile, no folder sections', () => {
    open({ ...shoot(), folders: undefined, assets: [asset('a'), asset('b'), asset('c')] })
    const page = html()
    expect(page).not.toContain('data-pool-folder=')
    const grid = /data-pool-loose=""[^>]*>([\s\S]*)$/.exec(page)
    expect(grid).not.toBeNull()
    expect([...page.matchAll(/data-pool-tile="([^"]*)"/g)].map((m) => m[1])).toEqual(['a', 'b', 'c'])
  })

  it('has "New folder" beside the Media heading', () => {
    open({ ...emptyProject('x'), assets: [] })
    expect(html()).toMatch(/>Media<\/div><button[^>]*data-pool-new-folder=""[^>]*>.*New folder<\/button>/)
  })

  it('shows the files in no folder first, then each folder with its name, its count and its files', () => {
    open()
    const page = html()
    const at = (s: string): number => page.indexOf(s)
    expect(at('data-pool-loose')).toBeGreaterThan(-1)
    expect(at('data-pool-tile="c"')).toBeLessThan(at('data-pool-folder="Ceremony"'))
    expect(at('data-pool-folder="Ceremony"')).toBeLessThan(at('data-pool-tile="a"'))
    expect(at('data-pool-tile="b"')).toBeLessThan(at('data-pool-folder="Empty"'))
    expect(page).toContain('>Ceremony</span><span class="shrink-0 text-[10px] tabular-nums text-ink-500">2</span>')
    expect(page).toContain('>Empty</span><span class="shrink-0 text-[10px] tabular-nums text-ink-500">0</span>')
  })

  it('an empty folder says files can be dragged in; a folded one hides its files', () => {
    open()
    expect(html().match(new RegExp(pool.FOLDER_EMPTY, 'g'))).toHaveLength(1)
    expect(html().match(new RegExp(`title="${pool.FOLD_FOLDER}"`, 'g'))).toHaveLength(2)
    state().toggleFolder('Ceremony')
    const page = html()
    expect(page).not.toContain('data-pool-tile="a"')
    expect(page).not.toContain('data-pool-tile="b"')
    expect(page).toContain('data-pool-tile="c"')
    expect(page.match(new RegExp(`title="${pool.OPEN_FOLDER}"`, 'g'))).toHaveLength(1)
    // Folded is the window's, not the project's: no undo step, nothing saved.
    expect(state().past).toHaveLength(0)
  })

  it('a folder being renamed shows its field in its header', () => {
    open()
    state().startRenameFolder('Empty')
    const page = html()
    const section = page.slice(page.indexOf('data-pool-folder="Empty"'))
    expect(section).toContain('data-pool-folder-input=""')
    expect(section).toContain('value="Empty"')
    expect(section).toContain(`placeholder="${pool.FOLDER_NAME_PLACEHOLDER}"`)
  })

  it('an empty project with no folder shows its words; New folder pressed shows the field instead', () => {
    open({ ...emptyProject('x'), assets: [] })
    expect(html()).toContain('Drop your photos and clips here')
    state().startNewFolder()
    expect(html()).not.toContain('Drop your photos and clips here')
    expect(html()).toContain('data-pool-folder-input=""')
  })
})

/* ------------------------------------------------------------------ the menus */

interface Item {
  label: string
  onClick: () => void
  ticked?: boolean
  title?: string
}

function items(node: ReactNode): Item[] {
  if (!isValidElement(node)) return []
  const props = node.props as Record<string, unknown> & { children?: ReactNode }
  const own = node.type === MenuItem ? [props as unknown as Item] : []
  const kids = Array.isArray(props.children) ? props.children.flat() : [props.children]
  return [...own, ...kids.flatMap((k) => items(k as ReactNode))]
}

const tileMenu = (assetId: string): Item[] => {
  state().openPoolMenu({ assetId, x: 40, y: 40 })
  return items(PoolMenu({ target: { assetId, x: 40, y: 40 }, why: null }) as ReactNode)
}
const headerMenu = (folder: string): Item[] => {
  state().openFolderMenu({ folder, x: 40, y: 40 })
  return items(FolderMenu({ target: { folder, x: 40, y: 40 } }) as ReactNode)
}

describe('a tile’s Move to', () => {
  it('lists every folder (its own ticked), New folder…, and No folder only for a file in one', () => {
    open()
    const inside = tileMenu('a')
    expect(inside.map((i) => i.label)).toEqual(expect.arrayContaining(['Ceremony', 'Empty', pool.NEW_FOLDER_ITEM, pool.NO_FOLDER]))
    expect(inside.find((i) => i.label === 'Ceremony')?.ticked).toBe(true)
    expect(inside.find((i) => i.label === 'Empty')?.ticked).toBe(false)
    expect(tileMenu('c').map((i) => i.label)).not.toContain(pool.NO_FOLDER)
  })

  it('moves the file, out to none too, and closes the menu', () => {
    open()
    tileMenu('c').find((i) => i.label === 'Empty')!.onClick()
    expect(folderOf(state().project).c).toBe('Empty')
    expect(state().poolMenu).toBeNull()
    tileMenu('c').find((i) => i.label === pool.NO_FOLDER)!.onClick()
    expect(folderOf(state().project).c).toBeNull()
    expect(state().past).toHaveLength(2)
  })

  it('"New folder…" opens the name in place for that file', () => {
    open()
    tileMenu('c').find((i) => i.label === pool.NEW_FOLDER_ITEM)!.onClick()
    expect(state().folderEdit).toEqual({ from: null, draft: '', moving: ['c'] })
    expect(state().poolMenu).toBeNull()
  })
})

describe('a folder header’s menu', () => {
  it('Rename opens the name in place; Remove folder keeps the files, says so in its title, and closes', () => {
    open()
    const menu = headerMenu('Ceremony')
    expect(menu.map((i) => i.label)).toEqual([pool.RENAME_FOLDER, pool.REMOVE_FOLDER])
    expect(menu[1].title).toBe(pool.REMOVE_FOLDER_NOTE)
    menu[0].onClick()
    expect(state().folderEdit).toEqual({ from: 'Ceremony', draft: 'Ceremony' })
    expect(state().folderMenu).toBeNull()
    headerMenu('Ceremony')[1].onClick()
    expect(state().project.assets.map((a) => a.id)).toEqual(['a', 'b', 'c'])
    expect(state().project.folders).toEqual(['Empty'])
    expect(state().folderMenu).toBeNull()
  })

  it('only one menu is open at a time', () => {
    open()
    state().openPoolMenu({ assetId: 'a', x: 1, y: 1 })
    state().openFolderMenu({ folder: 'Empty', x: 1, y: 1 })
    expect(state().poolMenu).toBeNull()
    state().openPoolMenu({ assetId: 'a', x: 1, y: 1 })
    expect(state().folderMenu).toBeNull()
  })
})

/* ------------------------------------------------------------------ dragging */

describe('dragging a tile', () => {
  it('carries to the timeline and the picture exactly the payload it always did, folder or not', () => {
    const inFolder = asset('a', { folder: 'Ceremony', kind: 'video', path: '/shoot/a.mp4', name: 'a.mp4' })
    const data: Record<string, string> = {}
    const event = { dataTransfer: { setData: (k: string, v: string) => (data[k] = v), effectAllowed: '' } }
    setDragPayload(event as never, poolPayload(inFolder))
    expect(data[DRAG_MIME]).toBe('{"kind":"media","file":"/shoot/a.mp4","name":"a.mp4","assetId":"a","mediaKind":"video"}')
    expect(data['text/plain']).toBe('a.mp4')
    const read = JSON.parse(data[DRAG_MIME])
    expect(trackDropRoute(read, 'video')).toBe('pool')
    expect(canvasDropRoute(read)).toBe('pool')
  })

  it('the tile still starts its drag with that payload, at its one site', () => {
    const source = readFileSync(resolve(__dirname, '../../src/renderer/src/components/MediaPool.tsx'), 'utf8')
    expect([...source.matchAll(/setDragPayload\(/g)]).toHaveLength(1)
    expect([...source.matchAll(/setDragPayload\(e, poolPayload\(asset\)\)/g)]).toHaveLength(1)
  })

  it('a drop inside the list moves a pool tile’s file, and nothing else', () => {
    const p = shoot()
    expect(tileDropped(poolPayload(p.assets[2]), p)).toBe('c')
    expect(tileDropped({ kind: 'sfx', file: 'whoosh.wav', name: 'whoosh' }, p)).toBeNull()
    expect(tileDropped({ kind: 'media', file: '/x.jpg', name: 'x', assetId: 'gone' }, p)).toBeNull()
    expect(tileDropped(null, p)).toBeNull()
    // Into a folder, through the store, as the drop does.
    open(p)
    state().moveAssetsToFolder([tileDropped(poolPayload(p.assets[2]), p)!], 'Empty')
    expect(folderOf(state().project).c).toBe('Empty')
  })
})
