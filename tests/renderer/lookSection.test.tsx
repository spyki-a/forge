import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveStyle, type StyleOverrides } from '@shared/captions/style'
import { resolveGraphicStyle } from '@shared/graphics/style'
import { emptyProject, type Project } from '@shared/timeline'
import {
  LOOKS_SETTING,
  LOOK_NAME_NEEDED,
  LOOK_SECTION_LABEL,
  LOOK_UNREADABLE,
  lookExportedNote,
  lookFileBase,
  lookFromProject,
  lookIsApplied,
  readLookText,
  serializeLook,
  type Look,
  type LookRead
} from '@shared/look'

/*
 * OUTPUT's "My look" section (creator style, piece 2; docs/CLIPS.md §10),
 * rendered and pressed as tests/renderer/graphicsSection.test.tsx does the
 * Graphics section: the store mocked to a plain selector over the REAL
 * store's state, so the section, which has no state of its own (the form's
 * is the store's `lookDraft`), is called as a function and its presses reach
 * the real actions. The bridge is a recording stand-in, as
 * tests/renderer/lookStore.test.ts has it.
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
vi.mock('../../src/renderer/src/exportBakers', () => ({ liveBakers: {} }))
vi.mock('../../src/renderer/src/captionBake', () => ({ bakeCaptions: async () => null }))

const bridge = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  imported: null as LookRead | null,
  exported: [] as Look[]
}))

vi.stubGlobal('window', {
  forge: {
    getSettings: async () => ({ ...bridge.settings }),
    setSetting: async (key: string, value: unknown) => {
      bridge.settings[key] = value
      return { ...bridge.settings }
    },
    importLook: async () => bridge.imported,
    exportLook: async (look: Look) => {
      bridge.exported.push(look)
      return `C:\\Users\\me\\Looks\\${lookFileBase(look.name)}.forgelook`
    }
  }
})

const { useEditor } = await import('../../src/renderer/src/store')
const strip = await import('../../src/renderer/src/components/OutputStrip')
const {
  OutputStrip,
  LookSection,
  LOOK_EMPTY,
  LOOK_HINT,
  LOOK_SAVE_OPEN,
  LOOK_IMPORT,
  LOOK_NAME_PLACEHOLDER,
  LOOK_AUTHOR_PLACEHOLDER,
  LOOK_LICENCE_PLACEHOLDER,
  LOOK_SAVE,
  LOOK_CANCEL,
  LOOK_EXPORT_TITLE,
  LOOK_REMOVE_TITLE
} = strip

const state = () => useEditor.getState()

/* ------------------------------------------------------------ the walk */

interface Host {
  type: string
  props: Record<string, unknown>
}

/** Every host element the section comes to, in order; lucide's icons are components, walked through. */
function walk(node: ReactNode, out: Host[] = []): Host[] {
  if (Array.isArray(node)) {
    for (const child of node) walk(child as ReactNode, out)
    return out
  }
  if (!isValidElement(node)) return out
  const props = node.props as Record<string, unknown> & { children?: ReactNode }
  if (typeof node.type === 'string') {
    out.push({ type: node.type, props })
    return walk(props.children, out)
  }
  // An icon (a forwardRef object) draws nothing the section's tests read.
  if (typeof node.type === 'function') return walk((node.type as (p: unknown) => ReactNode)(props), out)
  return walk(props.children, out)
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((n) => textOf(n as ReactNode)).join(' ')
  if (isValidElement(node)) return ` ${textOf((node.props as { children?: ReactNode }).children)} `
  return ''
}
const norm = (text: string): string => text.replace(/\s+/g, ' ').trim()

function section() {
  const hosts = walk(LookSection())
  const by = (attr: string): Host[] => hosts.filter((h) => attr in h.props)
  return {
    hosts,
    rows: by('data-look-row'),
    exports: by('data-look-export'),
    removes: by('data-look-remove'),
    form: by('data-look-form'),
    inputs: { name: by('data-look-name'), author: by('data-look-author'), licence: by('data-look-licence') },
    save: by('data-look-save'),
    cancel: by('data-look-cancel'),
    saveOpen: by('data-look-save-open'),
    importing: by('data-look-import'),
    // The notes are the last thing in the section: every paragraph after their box.
    notes: (() => {
      const at = hosts.findIndex((h) => 'data-look-notes' in h.props)
      return at === -1 ? [] : hosts.slice(at + 1).filter((h) => h.type === 'p')
    })(),
    text: norm(textOf(LookSection()))
  }
}

const press = (h: Host): unknown => (h.props.onClick as () => unknown)()
const key = (h: Host, k: string) => {
  const e = { key: k, prevented: false, stopped: false, preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true } }
  ;(h.props.onKeyDown as (e: unknown) => void)(e)
  return e
}
const type = (h: Host, value: string): void => (h.props.onChange as (e: { target: { value: string } }) => void)({ target: { value } })
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

function projectWith(captions: Partial<Project['captions']>, graphics?: Project['graphics']): Project {
  const p = emptyProject()
  return { ...p, captions: { ...p.captions, ...captions }, ...(graphics ? { graphics } : {}) }
}

/** 59 code points: under the name's cap (60), far over what the 240 px column shows. */
const LONG = 'A long look name for a wedding studio, goes past the column'
const ONE = lookFromProject(projectWith({ styleId: 'clean' }, { styleId: 'neon', sound: true }), { name: 'Neon clean' })
const TWO = lookFromProject(projectWith({ styleId: 'bold-center', overrides: { primaryColor: '#FF40C0' } }, { styleId: 'mono', sound: true }), { name: LONG })

function start(project: Project = emptyProject(), looks: Look[] = []): void {
  useEditor.setState({ ...useEditor.getInitialState(), outputOpen: true, project, past: [], future: [], savedLooks: looks, lookNotes: [], lookDraft: null })
}

beforeEach(() => {
  bridge.settings = {}
  bridge.imported = null
  bridge.exported.length = 0
  start()
})

/* ---------------------------------------------------------------- tests */

describe('OUTPUT’s "My look" section', () => {
  it('renders in the open strip after the Graphics section, under its heading', () => {
    const html = renderToStaticMarkup(createElement(OutputStrip)).replace(/\s+/g, ' ')
    expect(html).toContain(`>${LOOK_SECTION_LABEL}<`)
    const graphics = html.indexOf('data-graphics-section')
    const look = html.indexOf('data-look-section')
    expect(graphics).toBeGreaterThan(-1)
    expect(look).toBeGreaterThan(graphics)
    // The last thing in the strip: nothing of the Graphics section after it.
    expect(html.indexOf('data-graphic-style', look)).toBe(-1)
  })

  it('with no saved look: one plain line of what a look is, Save this look and Import a look, no rows, no notes', () => {
    const s = section()
    expect(s.text).toContain(LOOK_EMPTY)
    expect(s.text).not.toContain(LOOK_HINT)
    expect(s.rows).toHaveLength(0)
    expect(s.form).toHaveLength(0)
    expect(s.saveOpen.map((b) => norm(textOf(b.props.children as ReactNode)))).toEqual([LOOK_SAVE_OPEN])
    expect(s.importing.map((b) => norm(textOf(b.props.children as ReactNode)))).toEqual([LOOK_IMPORT])
    expect(s.notes).toHaveLength(0)
  })

  it('two saved, the second applied: a row each in order, the applied one marked and lit, each with Export and Remove titled', () => {
    start(projectWith({ styleId: 'bold-center', overrides: { primaryColor: '#FF40C0' } }, { styleId: 'mono', sound: true }), [ONE, TWO])
    const s = section()
    expect(s.text).toContain(LOOK_HINT)
    expect(s.text).not.toContain(LOOK_EMPTY)
    expect(s.rows.map((r) => r.props['data-look-row'])).toEqual([ONE.name, LONG])
    // The mark is the comparison, and only the applied row has it.
    expect(s.rows.map((r) => r.props['aria-pressed'])).toEqual([false, true])
    expect(lookIsApplied(state().project, TWO)).toBe(true)
    expect(String(s.rows[1].props.className)).toContain('bg-ink-700 text-ink-200')
    expect(String(s.rows[0].props.className)).toContain('bg-ink-800 text-ink-400')
    expect(s.exports.map((b) => b.props.title)).toEqual([LOOK_EXPORT_TITLE, LOOK_EXPORT_TITLE])
    expect(s.removes.map((b) => b.props.title)).toEqual([LOOK_REMOVE_TITLE, LOOK_REMOVE_TITLE])
  })

  it('LONG is under the cap', () => expect(Array.from(LONG)).toHaveLength(59))

  it('a long name is cut in its row and whole in the title; the row can shrink, the two buttons cannot', () => {
    start(emptyProject(), [TWO])
    const s = section()
    const row = s.rows[0]
    expect(row.props.title).toBe(LONG)
    expect(String(row.props.className)).toContain('min-w-0')
    expect(String(row.props.className)).toContain('flex-1')
    const label = walk(row.props.children as ReactNode).find((h) => h.type === 'span')!
    expect(String(label.props.className)).toContain('truncate')
    expect(norm(textOf(label.props.children as ReactNode))).toBe(LONG)
    for (const b of [...s.exports, ...s.removes]) expect(String(b.props.className)).toContain('shrink-0')
    // The section itself can shrink inside the 240 px column.
    const outer = s.hosts.find((h) => 'data-look-section' in h.props)!
    expect(String(outer.props.className)).toContain('min-w-0')
  })

  it('a row click applies the look: both styles in ONE undo step, captions on and the sounds switch untouched', () => {
    start(projectWith({ styleId: 'pop', enabled: false }, { styleId: 'clean', sound: false }), [ONE, TWO])
    press(section().rows[1])
    const p = state().project
    expect(JSON.stringify(resolveStyle(p.captions.styleId, p.captions.overrides as StyleOverrides))).toBe(
      JSON.stringify(resolveStyle('bold-center', { primaryColor: '#FF40C0' }))
    )
    expect(JSON.stringify(resolveGraphicStyle(p.graphics!.styleId, p.graphics!.overrides))).toBe(JSON.stringify(resolveGraphicStyle('mono', {})))
    expect(state().past).toHaveLength(1)
    expect(p.captions.enabled).toBe(false)
    expect(p.graphics?.sound).toBe(false)
    expect(section().rows.map((r) => r.props['aria-pressed'])).toEqual([false, true])
    state().undo()
    expect(section().rows.map((r) => r.props['aria-pressed'])).toEqual([false, false])
  })

  it('Export writes the look through the bridge and the note names the file, never its folder', async () => {
    start(emptyProject(), [ONE])
    await press(section().exports[0])
    expect(bridge.exported).toEqual([ONE])
    const s = section()
    expect(s.notes.map((p) => norm(textOf(p.props.children as ReactNode)))).toEqual([lookExportedNote('Neon clean.forgelook')])
    expect(s.text).not.toContain('C:\\Users')
  })

  it('Remove takes the look off the list and out of settings, asking nothing, and the project is untouched', async () => {
    start(emptyProject(), [ONE, TWO])
    const project = state().project
    await press(section().removes[0])
    expect(section().rows.map((r) => r.props['data-look-row'])).toEqual([LONG])
    expect((bridge.settings[LOOKS_SETTING] as Look[]).map((l) => l.name)).toEqual([LONG])
    expect(state().project).toBe(project)
    expect(state().past).toHaveLength(0)
  })

  it('Save this look opens three boxes with their placeholders, Save and Cancel; Import stays', () => {
    press(section().saveOpen[0])
    const s = section()
    expect(s.form).toHaveLength(1)
    expect(s.saveOpen).toHaveLength(0)
    expect(s.importing).toHaveLength(1)
    expect(s.inputs.name.map((i) => i.props.placeholder)).toEqual([LOOK_NAME_PLACEHOLDER])
    expect(s.inputs.author.map((i) => i.props.placeholder)).toEqual([LOOK_AUTHOR_PLACEHOLDER])
    expect(s.inputs.licence.map((i) => i.props.placeholder)).toEqual([LOOK_LICENCE_PLACEHOLDER])
    expect(s.inputs.name[0].props.autoFocus).toBe(true)
    expect(s.save.map((b) => norm(textOf(b.props.children as ReactNode)))).toEqual([LOOK_SAVE])
    expect(s.cancel.map((b) => norm(textOf(b.props.children as ReactNode)))).toEqual([LOOK_CANCEL])
  })

  it('Enter in any box saves the name and the header lines; the form closes and the new row is the marked one', async () => {
    start(projectWith({ styleId: 'kinetic' }, { styleId: 'editorial', sound: true }))
    state().startLookSave()
    type(section().inputs.name[0], 'Bride 5:30pm')
    type(section().inputs.author[0], 'Ana')
    type(section().inputs.licence[0], 'Use it on your own videos')
    const e = key(section().inputs.licence[0], 'Enter')
    expect(e.prevented).toBe(true)
    await settle()
    expect(state().lookDraft).toBeNull()
    const saved = state().savedLooks
    expect(saved.map((l) => [l.name, l.author, l.licence, l.version])).toEqual([['Bride 5:30pm', 'Ana', 'Use it on your own videos', 1]])
    expect(section().rows.map((r) => r.props['aria-pressed'])).toEqual([true])
  })

  it('an empty name is not saved: the form stays and the note says why', async () => {
    state().startLookSave()
    type(section().inputs.author[0], 'Ana')
    await press(section().save[0])
    expect(state().savedLooks).toHaveLength(0)
    expect(state().lookDraft).not.toBeNull()
    expect(section().notes.map((p) => norm(textOf(p.props.children as ReactNode)))).toEqual([LOOK_NAME_NEEDED])
    key(section().inputs.name[0], 'Enter')
    await settle()
    expect(state().savedLooks).toHaveLength(0)
  })

  it('opening the form clears the last notes; typing with no form open changes nothing', () => {
    useEditor.setState({ lookNotes: [LOOK_UNREADABLE] })
    state().setLookDraft({ name: 'nowhere' })
    expect(state().lookDraft).toBeNull()
    press(section().saveOpen[0])
    expect(state().lookNotes).toEqual([])
    expect(state().lookDraft).toEqual({ name: '', author: '', licence: '' })
  })

  it('Escape and Cancel leave the form, saving nothing; Escape goes no further than the form', () => {
    state().startLookSave()
    type(section().inputs.name[0], 'Not kept')
    const e = key(section().inputs.name[0], 'Escape')
    expect(e.stopped).toBe(true)
    expect(state().lookDraft).toBeNull()
    state().startLookSave()
    press(section().cancel[0])
    expect(state().lookDraft).toBeNull()
    expect(state().savedLooks).toHaveLength(0)
  })

  it('Import adds the look (not applied); a refused file says its reason inline and changes nothing', async () => {
    bridge.imported = readLookText(serializeLook(ONE))
    const project = state().project
    await press(section().importing[0])
    expect(section().rows.map((r) => r.props['data-look-row'])).toEqual([ONE.name])
    expect(state().project).toBe(project)
    bridge.imported = { ok: false, reason: LOOK_UNREADABLE }
    await press(section().importing[0])
    expect(section().notes.map((p) => norm(textOf(p.props.children as ReactNode)))).toEqual([LOOK_UNREADABLE])
    expect(section().rows).toHaveLength(1)
    const html = renderToStaticMarkup(createElement(LookSection))
    expect(html).toContain(`>${LOOK_UNREADABLE}<`)
  })

  it('a name in another script survives the round trip and makes a Windows-safe file name', async () => {
    // Made-up words in Cyrillic letters, with a colon and a slash as a wedding name might have.
    const name = 'Зорпа плим: вечер/ноч'
    start(projectWith({ styleId: 'clean' }))
    state().startLookSave()
    type(section().inputs.name[0], name)
    await press(section().save[0])
    expect(state().savedLooks.map((l) => l.name)).toEqual([name])
    const read = readLookText(serializeLook(state().savedLooks[0]))
    expect(read.ok && read.look.name).toBe(name)
    await press(section().exports[0])
    const file = `${lookFileBase(name)}.forgelook`
    expect(file).toBe('Зорпа плим вечер-ноч.forgelook')
    expect(file).not.toMatch(/[<>:"/\\|?*]/)
    expect(state().lookNotes).toEqual([lookExportedNote(file)])
  })
})
