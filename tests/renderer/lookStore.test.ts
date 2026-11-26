import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveStyle, type StyleOverrides } from '@shared/captions/style'
import { resolveGraphicStyle } from '@shared/graphics/style'
import { emptyProject, type Project } from '@shared/timeline'
import {
  LOOKS_SETTING,
  LOOK_EXPORT_FAILED,
  LOOK_LIST_FULL,
  LOOK_NAME_NEEDED,
  LOOK_NOTE_RENAMED,
  LOOK_NOT_A_LOOK,
  LOOK_UNREADABLE,
  SAVED_LOOKS_MAX,
  lookExportedNote,
  lookFromProject,
  serializeLook,
  type Look,
  type LookRead
} from '@shared/look'
import { useEditor } from '../../src/renderer/src/store'

/*
 * The store's side of "my look" (docs/CLIPS.md §10, shared/look.ts): the
 * saved list in settings under one key, save, apply as ONE undo step with
 * one rebake, remove, export, import. Here, as tests/renderer/
 * graphicStyleStore.test.ts is, because the store is renderer code; the
 * bridge is a recording stand-in on a bare `window`.
 */

const bridge = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  writes: [] as { key: string; value: unknown }[],
  imported: null as LookRead | null | Error,
  exported: [] as Look[],
  exportAnswer: 'C:\\Users\\me\\Looks\\Studio.forgelook' as string | null
}))

vi.stubGlobal('window', {
  forge: {
    getSettings: async () => ({ ...bridge.settings }),
    setSetting: async (key: string, value: unknown) => {
      bridge.writes.push({ key, value })
      bridge.settings[key] = value
      return { ...bridge.settings }
    },
    importLook: async () => {
      if (bridge.imported instanceof Error) throw bridge.imported
      return bridge.imported
    },
    exportLook: async (look: Look) => {
      bridge.exported.push(look)
      return bridge.exportAnswer
    }
  }
})

const state = () => useEditor.getState()

function projectWith(captions: Partial<Project['captions']>, graphics?: Project['graphics'], clips: Project['clips'] = []): Project {
  const p = emptyProject()
  return { ...p, captions: { ...p.captions, ...captions }, ...(graphics ? { graphics } : {}), clips }
}

function start(project: Project, looks: Look[] = []): void {
  useEditor.setState({ project, past: [], future: [], savedLooks: looks, lookNotes: [] })
}

const look = (name: string, captions: Partial<Project['captions']> = { styleId: 'clean' }, graphics: Project['graphics'] = { styleId: 'neon', sound: true }): Look =>
  lookFromProject(projectWith(captions, graphics), { name })

beforeEach(() => {
  bridge.settings = {}
  bridge.writes.length = 0
  bridge.imported = null
  bridge.exported.length = 0
  bridge.exportAnswer = 'C:\\Users\\me\\Looks\\Studio.forgelook'
})

describe('saving a look', () => {
  it('saves the project’s two styles under the name, in settings under one key', async () => {
    start(projectWith({ styleId: 'kinetic', overrides: { fontSize: 70 } }, { styleId: 'bold', overrides: { radius: 0.05 }, sound: false }))
    expect(await state().saveLook({ name: 'Studio', author: 'Ana', licence: 'Own videos only' })).toBe(true)
    expect(state().savedLooks).toHaveLength(1)
    const saved = state().savedLooks[0]
    expect(saved).toMatchObject({ name: 'Studio', author: 'Ana', licence: 'Own videos only', version: 1 })
    expect(saved.captions).toStrictEqual({ styleId: 'kinetic', overrides: { fontSize: 70 } })
    expect(saved.graphics).toStrictEqual({ styleId: 'bold', overrides: { radius: 0.05 } })
    expect(bridge.writes.map((w) => w.key)).toEqual([LOOKS_SETTING])
    expect(bridge.writes[0].value).toStrictEqual(state().savedLooks)
  })

  it('saving over a name (any case) replaces it and adds 1 to its version', async () => {
    start(projectWith({ styleId: 'pop' }, { styleId: 'clean', sound: true }))
    await state().saveLook({ name: 'Studio' })
    await state().saveLook({ name: 'Other' })
    state().update((p) => ({ ...p, captions: { ...p.captions, styleId: 'clean' } }))
    await state().saveLook({ name: ' studio ' })
    expect(state().savedLooks.map((l) => [l.name, l.version, l.captions.styleId])).toEqual([
      ['studio', 2, 'clean'],
      ['Other', 1, 'pop']
    ])
    await state().saveLook({ name: 'STUDIO' })
    expect(state().savedLooks[0].version).toBe(3)
  })

  it('refuses no name, and a new name with the list full (saving over one still works)', async () => {
    start(projectWith({ styleId: 'pop' }))
    expect(await state().saveLook({ name: '   ' })).toBe(false)
    expect(state().lookNotes).toEqual([LOOK_NAME_NEEDED])
    expect(state().savedLooks).toEqual([])

    const full = Array.from({ length: SAVED_LOOKS_MAX }, (_, i) => look(`Look ${i}`))
    start(projectWith({ styleId: 'pop' }), full)
    expect(await state().saveLook({ name: 'One more' })).toBe(false)
    expect(state().lookNotes).toEqual([LOOK_LIST_FULL])
    expect(state().savedLooks).toHaveLength(SAVED_LOOKS_MAX)
    expect(bridge.writes).toEqual([])
    expect(await state().saveLook({ name: 'Look 3' })).toBe(true)
    expect(state().savedLooks).toHaveLength(SAVED_LOOKS_MAX)
    expect(state().savedLooks[3].version).toBe(2)
  })
})

describe('applying a look', () => {
  const trackId = 'v1'
  const clip = (id: string, graphic: boolean): Project['clips'][number] =>
    ({
      id, assetId: `a-${id}`, trackId, start: 0, duration: 30, inPoint: 0, volume: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      color: { brightness: 0, contrast: 1, saturation: 1 },
      ...(graphic
        ? { graphic: { data: { template: 'counter' as const, value: '5', label: 'x' }, seconds: 1, beats: [0.5], place: { auto: true as const, third: 'bottom' as const }, seed: 1, version: 1 } }
        : {})
    }) as Project['clips'][number]

  it('is ONE undo step for both styles, and undo restores both', () => {
    const source = projectWith({ styleId: 'pop', overrides: { fontSize: 99 }, enabled: false }, { styleId: 'clean', overrides: { radius: 0.03 }, sound: false })
    const target = look('Neon', { styleId: 'kinetic', overrides: { wordsPerLine: 2 }, placement: 'smart' }, { styleId: 'neon', overrides: { 'palette.accent': '#E11D48' }, sound: true })
    start(source, [target])
    state().applySavedLook('neon')
    const after = state().project
    expect(state().past).toHaveLength(1)
    expect(after.captions).toStrictEqual({ enabled: false, styleId: 'kinetic', overrides: { wordsPerLine: 2 }, placement: 'smart' })
    expect(after.graphics).toStrictEqual({ sound: false, styleId: 'neon', overrides: { 'palette.accent': '#E11D48' } })
    state().undo()
    expect(state().project.captions).toStrictEqual(source.captions)
    expect(state().project.graphics).toStrictEqual(source.graphics)
    // What each resolves to is the source's again.
    expect(resolveStyle(state().project.captions.styleId, state().project.captions.overrides as StyleOverrides)).toStrictEqual(resolveStyle('pop', { fontSize: 99 }))
    expect(resolveGraphicStyle(state().project.graphics!.styleId, state().project.graphics!.overrides).radius).toBe(0.03)
 
    // Redo brings the look back, a second undo the source again; the apply marked the project changed.
    state().redo()
    expect(state().project.captions).toStrictEqual(after.captions)
    expect(state().project.graphics).toStrictEqual(after.graphics)
    expect(state().dirty).toBe(true)
    state().undo()
    expect(state().project.captions).toStrictEqual(source.captions)
    expect(state().project.graphics).toStrictEqual(source.graphics)
  })

  it('rebakes when only the graphic OVERRIDES change, the preset the same', async () => {
    const rebaked: string[] = []
    const rebakeGraphic = async (clipId: string): Promise<void> => {
      rebaked.push(clipId)
    }
    const source = projectWith({ styleId: 'pop' }, { styleId: 'neon', overrides: { radius: 0.03 }, sound: true }, [clip('g1', true), clip('g2', true)])
    useEditor.setState({ project: source, past: [], future: [], rebakeGraphic, lookNotes: [], savedLooks: [
      look('Rounder', { styleId: 'pop' }, { styleId: 'neon', overrides: { radius: 0.05 }, sound: true })
    ] })
    state().applySavedLook('Rounder')
    expect(state().past).toHaveLength(1)
    await vi.waitFor(() => expect(rebaked).toHaveLength(2))
    await new Promise((r) => setTimeout(r, 10))
    expect(rebaked).toEqual(['g1', 'g2'])
  })

  it('rebakes each graphic clip once, and no other clip; none when the graphic style did not change', async () => {
    const rebaked: string[] = []
    const rebakeGraphic = async (clipId: string): Promise<void> => {
      rebaked.push(clipId)
    }
    const clips = [clip('g1', true), clip('v1', false), clip('g2', true)]
    const source = projectWith({ styleId: 'pop' }, { styleId: 'clean', sound: true }, clips)
    useEditor.setState({ project: source, past: [], future: [], rebakeGraphic, lookNotes: [], savedLooks: [
      look('Bold graphics', { styleId: 'pop' }, { styleId: 'bold', sound: true }),
      look('Captions only', { styleId: 'clean' }, { styleId: 'bold', sound: true })
    ] })
    state().applySavedLook('Bold graphics')
    await vi.waitFor(() => expect(rebaked).toHaveLength(2))
    await new Promise((r) => setTimeout(r, 10))
    expect(rebaked).toEqual(['g1', 'g2'])

    // Only the captions change: no rebake, still one undo step.
    rebaked.length = 0
    state().applySavedLook('Captions only')
    expect(state().past).toHaveLength(2)
    await new Promise((r) => setTimeout(r, 10))
    expect(rebaked).toEqual([])

    // The look already on: no change, no undo step, no rebake.
    state().applySavedLook('Captions only')
    expect(state().past).toHaveLength(2)
    await new Promise((r) => setTimeout(r, 10))
    expect(rebaked).toEqual([])
    // The clips themselves are the same objects.
    expect(state().project.clips).toBe(clips)
  })

  it('an unknown name changes nothing', () => {
    const source = projectWith({ styleId: 'pop' })
    start(source, [look('A')])
    state().applySavedLook('B')
    expect(state().project).toBe(source)
    expect(state().past).toEqual([])
  })
})

describe('removing a look', () => {
  it('takes it out of the list and settings', async () => {
    start(projectWith({ styleId: 'pop' }), [look('A'), look('B')])
    await state().removeSavedLook('a')
    expect(state().savedLooks.map((l) => l.name)).toEqual(['B'])
    expect(bridge.writes).toEqual([{ key: LOOKS_SETTING, value: state().savedLooks }])
  })
})

describe('exporting a look', () => {
  it('hands the bridge the look and says the file’s name, never its folder', async () => {
    start(projectWith({ styleId: 'pop' }), [look('Studio')])
    await state().exportSavedLook('Studio')
    expect(bridge.exported.map((l) => l.name)).toEqual(['Studio'])
    expect(state().lookNotes).toEqual([lookExportedNote('Studio.forgelook')])
    expect(state().lookNotes.join(' ')).not.toMatch(/Users|Looks\\|\\/)
  })

  it('a cancelled dialog says nothing; a failed write says its reason', async () => {
    start(projectWith({ styleId: 'pop' }), [look('Studio')])
    bridge.exportAnswer = null
    await state().exportSavedLook('Studio')
    expect(state().lookNotes).toEqual([])
    const forge = (window as unknown as { forge: { exportLook: unknown } }).forge
    const was = forge.exportLook
    forge.exportLook = async () => {
      throw new Error(LOOK_EXPORT_FAILED)
    }
    try {
      await state().exportSavedLook('Studio')
      expect(state().lookNotes).toEqual([LOOK_EXPORT_FAILED])
    } finally {
      forge.exportLook = was
    }
  })

  it('says main’s sentence without Electron’s wrapping of a rejected call', async () => {
    start(projectWith({ styleId: 'pop' }), [look('Studio')])
    const forge = (window as unknown as { forge: { exportLook: unknown; importLook: unknown } }).forge
    const was = { exportLook: forge.exportLook, importLook: forge.importLook }
    // What ipcRenderer.invoke rejects with in the app when main throws.
    forge.exportLook = async () => {
      throw new Error(`Error invoking remote method 'look:export': Error: ${LOOK_EXPORT_FAILED}`)
    }
    forge.importLook = async () => {
      throw new Error(`Error invoking remote method 'look:import': Error: ${LOOK_UNREADABLE}`)
    }
    try {
      await state().exportSavedLook('Studio')
      expect(state().lookNotes).toEqual([LOOK_EXPORT_FAILED])
      await state().importLookFile()
      expect(state().lookNotes).toEqual([LOOK_UNREADABLE])
    } finally {
      Object.assign(forge, was)
    }
  })
})

describe('importing a look', () => {
  const file = (name: string): LookRead => ({ ok: true, look: look(name), notes: ['A note from the reading.'] })

  it('adds the look with its notes, and a taken name gets a number, never an overwrite', async () => {
    start(projectWith({ styleId: 'pop' }), [look('Studio')])
    bridge.imported = file('studio')
    await state().importLookFile()
    expect(state().savedLooks.map((l) => l.name)).toEqual(['Studio', 'studio 2'])
    expect(state().lookNotes).toEqual(['A note from the reading.', LOOK_NOTE_RENAMED])
    expect(bridge.writes.at(-1)).toStrictEqual({ key: LOOKS_SETTING, value: state().savedLooks })
    // The first is untouched.
    expect(state().savedLooks[0].version).toBe(1)
    bridge.imported = file('Fresh')
    await state().importLookFile()
    expect(state().savedLooks.map((l) => l.name)).toEqual(['Studio', 'studio 2', 'Fresh'])
    expect(state().lookNotes).toEqual(['A note from the reading.'])
  })

  it('does not apply what it imports', async () => {
    const source = projectWith({ styleId: 'pop' })
    start(source)
    bridge.imported = file('Studio')
    await state().importLookFile()
    expect(state().project).toBe(source)
    expect(state().past).toEqual([])
  })

  it('a refused file adds nothing, writes nothing, leaves the project as it was, and says the reason', async () => {
    const source = projectWith({ styleId: 'pop' })
    start(source, [look('A')])
    bridge.imported = { ok: false, reason: LOOK_NOT_A_LOOK }
    await state().importLookFile()
    expect(state().savedLooks.map((l) => l.name)).toEqual(['A'])
    expect(bridge.writes).toEqual([])
    expect(state().project).toBe(source)
    expect(state().lookNotes).toEqual([LOOK_NOT_A_LOOK])
    // A bridge that throws (the fallback's) is said too, with nothing added.
    bridge.imported = new Error('The app bridge did not load — restart Forge')
    await state().importLookFile()
    expect(state().lookNotes).toEqual(['The app bridge did not load — restart Forge'])
    bridge.imported = new Error('')
    await state().importLookFile()
    expect(state().lookNotes).toEqual([LOOK_UNREADABLE])
    expect(state().savedLooks).toHaveLength(1)
  })

  it('a cancelled dialog changes and says nothing', async () => {
    start(projectWith({ styleId: 'pop' }), [look('A')])
    useEditor.setState({ lookNotes: ['earlier'] })
    bridge.imported = null
    await state().importLookFile()
    expect(state().savedLooks).toHaveLength(1)
    expect(state().lookNotes).toEqual(['earlier'])
  })

  it('with the list full: refused before the Open dialog, nothing added', async () => {
    start(projectWith({ styleId: 'pop' }), Array.from({ length: SAVED_LOOKS_MAX }, (_, i) => look(`Look ${i}`)))
    bridge.imported = file('New')
    const opened = vi.spyOn(window.forge, 'importLook')
    try {
      await state().importLookFile()
      expect(opened).not.toHaveBeenCalled()
    } finally {
      opened.mockRestore()
    }
    expect(state().savedLooks).toHaveLength(SAVED_LOOKS_MAX)
    expect(state().lookNotes).toEqual([LOOK_LIST_FULL])
    expect(bridge.writes).toEqual([])
  })
})

describe('loading the saved looks', () => {
  it('reads them back sane after a bad value was put in settings', async () => {
    const good = look('Good', { styleId: 'clean', overrides: { fontSize: 70 } })
    bridge.settings[LOOKS_SETTING] = [
      good,
      { kind: 'forge-look', schema: 1, name: 'Bad preset', captions: { styleId: 'nope' }, graphics: { styleId: 'clean' } },
      'junk',
      { ...JSON.parse(serializeLook(look('Hostile'))), captions: { styleId: 'pop', overrides: { fontSize: 'huge', __proto__x: 1 } } },
      good
    ]
    start(projectWith({ styleId: 'pop' }))
    await state().loadSavedLooks()
    expect(state().savedLooks.map((l) => l.name)).toEqual(['Good', 'Hostile'])
    expect(state().savedLooks[1].captions.overrides).toBeUndefined()

    for (const bad of [42, 'x', { a: 1 }, null]) {
      bridge.settings[LOOKS_SETTING] = bad
      await state().loadSavedLooks()
      expect(state().savedLooks, String(bad)).toEqual([])
    }
  })

  it('a look saved from a project holding presets this app lacks keeps the presets it draws, loads back and exports', async () => {
    start(projectWith({ styleId: 'from-newer-app', overrides: { fontSize: 70 } }, { styleId: 'also-newer', sound: true }))
    expect(await state().saveLook({ name: 'Studio' })).toBe(true)
    // What the resolvers draw for an unknown id: their defaults.
    expect(state().savedLooks[0].captions.styleId).toBe(resolveStyle('from-newer-app').id)
    expect(state().savedLooks[0].graphics.styleId).toBe(resolveGraphicStyle('also-newer').id)
    useEditor.setState({ savedLooks: [] })
    await state().loadSavedLooks()
    expect(state().savedLooks.map((l) => l.name)).toEqual(['Studio'])
    await state().exportSavedLook('Studio')
    expect(bridge.exported.map((l) => l.name)).toEqual(['Studio'])
    expect(state().lookNotes).toEqual([lookExportedNote('Studio.forgelook')])
  })

  it('a round trip through settings: what is saved loads back the same', async () => {
    start(projectWith({ styleId: 'kinetic', overrides: { fontSize: 70 }, placement: 'smart' }, { styleId: 'neon', overrides: { radius: 0.05 }, sound: true }))
    await state().saveLook({ name: 'Studio', author: 'Ana' })
    const saved = state().savedLooks
    useEditor.setState({ savedLooks: [] })
    await state().loadSavedLooks()
    expect(state().savedLooks).toStrictEqual(saved)
  })
})
