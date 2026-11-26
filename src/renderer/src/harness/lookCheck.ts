/**
 * "My look" (docs/CLIPS.md §10, step 7's first bullet), pressed through the
 * store on the page's own bridge (creator style, piece 2):
 *
 *   await window.__forgeLookCheck()   → { ok, cases: [{ name, pass, detail }], summary }
 *
 * Every case runs against the page's real store, its in-memory settings (the
 * harness bridge's `getSettings` / `setSetting`) and its in-memory look file
 * (`window.__forgeLookFile`), in a project of its own (`emptyProject('look
 * check')`, no clips, so no graphic clip is rebaked behind the page's back).
 * On the page it also reads the OUTPUT strip's "My look" rows: which one is
 * marked as chosen (`aria-pressed`), so the mark is seen, not inferred. When
 * it is done it puts back the page's project, its undo history, its saved
 * looks and notes, the save form, the strip's open state, the settings entry
 * and the look file, and its last case says whether it did.
 *
 * tests/renderer/lookCheck.test.ts runs the same cases in node against the
 * same harness bridge, so CI holds them; only the on-screen reading is the
 * page's alone.
 */

import { resolveStyle, type StyleOverrides } from '@shared/captions/style'
import { resolveGraphicStyle } from '@shared/graphics/style'
import { emptyProject, type Project } from '@shared/timeline'
import {
  LOOKS_SETTING,
  LOOK_FILE_MAX_BYTES,
  LOOK_LIST_FULL,
  LOOK_NAME_NEEDED,
  LOOK_NEWER,
  LOOK_NOTE_RENAMED,
  LOOK_TOO_LARGE,
  LOOK_UNREADABLE,
  SAVED_LOOKS_MAX,
  lookExportedNote,
  lookIsApplied,
  serializeLook,
  type Look
} from '@shared/look'
import { useEditor } from '../store'

export interface LookCheckCase {
  name: string
  pass: boolean
  detail: string
}

export interface LookCheckResult {
  ok: boolean
  cases: LookCheckCase[]
  summary: string
}

/** The cases, in the order they run: what the session reads back when all is well, every one passing. */
export const LOOK_CHECK_CASES = [
  'save',
  'change both styles',
  'apply',
  'one undo restores both',
  'the chosen mark follows the project',
  'export then import round trip',
  'import under a taken name',
  'refuses a damaged file',
  'refuses a newer file',
  'refuses a file too large',
  'an empty name says why',
  'remove',
  'the cap',
  'restores the page'
] as const

/** The look file the harness bridge keeps (bridge.ts `harnessLookFile`), as far as the check uses it. */
export interface LookCheckFile {
  text: string | null
  name: string
  writes: number
  cancel: boolean
  put: (text: string) => void
}

export interface LookCheckEnv {
  file: LookCheckFile
  /**
   * The names of the "My look" rows marked as chosen on screen, after React
   * has drawn the store's state; null where there is no page (node).
   */
  chosenOnScreen?: () => Promise<string[] | null>
}

/** The look the check saves: a name with a colon in it, as wedding names have. */
export const CHECK_LOOK_NAME = 'Bride 5:30pm'
/** Its file's name, Windows-safe. */
export const CHECK_LOOK_FILE = 'Bride 530pm.forgelook'

const state = () => useEditor.getState()

/** The two styles the project draws, as text, so two equal ones compare equal. */
function drawn(project: Pick<Project, 'captions' | 'graphics'>): { caption: string; graphic: string } {
  return {
    caption: JSON.stringify(resolveStyle(project.captions.styleId, project.captions.overrides as StyleOverrides | undefined)),
    graphic: JSON.stringify(resolveGraphicStyle(project.graphics?.styleId ?? 'clean', project.graphics?.overrides))
  }
}

async function savedSetting(): Promise<unknown> {
  const settings = await window.forge.getSettings()
  return (settings as Record<string, unknown>)[LOOKS_SETTING]
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** The marked rows, read from the store's own rule: what the screen must show. */
const chosenByRule = (): string[] => state().savedLooks.filter((l) => lookIsApplied(state().project, l)).map((l) => l.name)

export async function runLookCheck(env: LookCheckEnv): Promise<LookCheckResult> {
  const cases: LookCheckCase[] = []
  const record = (name: (typeof LOOK_CHECK_CASES)[number], pass: boolean, detail: string): void => {
    cases.push({ name, pass, detail })
  }
  const attempt = async (name: (typeof LOOK_CHECK_CASES)[number], body: () => Promise<{ pass: boolean; detail: string }>): Promise<void> => {
    try {
      const { pass, detail } = await body()
      record(name, pass, detail)
    } catch (err) {
      record(name, false, `threw: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // The page's state, put back at the end.
  const page = state()
  const before = {
    project: page.project,
    past: page.past,
    future: page.future,
    dirty: page.dirty,
    savedLooks: page.savedLooks,
    lookNotes: page.lookNotes,
    lookDraft: page.lookDraft,
    outputOpen: page.outputOpen
  }
  const settingBefore = await savedSetting()
  const fileBefore = { text: env.file.text, name: env.file.name, writes: env.file.writes, cancel: env.file.cancel }

  const base = emptyProject('look check')
  // Captions on, the graphics' sounds OFF: applying a look must leave both as they are.
  const start: Project = { ...base, captions: { ...base.captions, enabled: true }, graphics: { styleId: 'clean', sound: false } }
  useEditor.setState({ project: start, past: [], future: [], savedLooks: [], lookNotes: [], lookDraft: null, outputOpen: true })
  await window.forge.setSetting(LOOKS_SETTING, [])
  env.file.cancel = false
  env.file.text = null

  /** The screen's chosen rows against the rule's, where there is a screen. */
  const onScreen = async (): Promise<{ pass: boolean; detail: string }> => {
    const seen = env.chosenOnScreen ? await env.chosenOnScreen() : null
    const want = chosenByRule()
    if (seen === null) return { pass: true, detail: `marked by the rule: ${JSON.stringify(want)} (screen not read: no page)` }
    return { pass: same(seen, want), detail: `marked on screen ${JSON.stringify(seen)}, by the rule ${JSON.stringify(want)}` }
  }

  let styleA = drawn(start)
  let styleB = drawn(start)
  const at = (): Look | undefined => state().savedLooks.find((l) => l.name === CHECK_LOOK_NAME)

  try {
    await attempt('save', async () => {
      state().setCaptionStyle('bold-center')
      state().setCaptionOverride('primaryColor', '#ff40c0')
      state().setCaptionOverride('position', 'top')
      state().setGraphicsStyle('neon')
      state().setGraphicsOverride('palette.accent', '#40e0ff')
      styleA = drawn(state().project)
      const saved = await state().saveLook({ name: CHECK_LOOK_NAME, author: 'Check', licence: 'Check licence line' })
      const look = at()
      const setting = await savedSetting()
      const screen = await onScreen()
      const pass =
        saved &&
        state().savedLooks.length === 1 &&
        look !== undefined &&
        look.version === 1 &&
        look.author === 'Check' &&
        look.licence === 'Check licence line' &&
        Array.isArray(setting) &&
        setting.length === 1 &&
        lookIsApplied(state().project, look) &&
        screen.pass
      return { pass, detail: `saved ${saved}; ${state().savedLooks.length} saved, version ${look?.version}; settings holds ${Array.isArray(setting) ? setting.length : 'no list'}; ${screen.detail}` }
    })

    await attempt('change both styles', async () => {
      state().setCaptionStyle('clean')
      state().setGraphicsStyle('mono')
      styleB = drawn(state().project)
      const look = at()!
      const screen = await onScreen()
      const pass = styleB.caption !== styleA.caption && styleB.graphic !== styleA.graphic && !lookIsApplied(state().project, look) && screen.pass
      return { pass, detail: `captions ${state().project.captions.styleId}, graphics ${state().project.graphics?.styleId}; ${screen.detail}` }
    })

    await attempt('apply', async () => {
      const steps = state().past.length
      state().applySavedLook(CHECK_LOOK_NAME)
      const now = drawn(state().project)
      const p = state().project
      const screen = await onScreen()
      const pass =
        now.caption === styleA.caption &&
        now.graphic === styleA.graphic &&
        state().past.length === steps + 1 &&
        p.captions.enabled === true &&
        p.graphics?.sound === false &&
        screen.pass
      return {
        pass,
        detail: `caption style ${now.caption === styleA.caption ? 'equal' : 'DIFFERS'}, graphic style ${now.graphic === styleA.graphic ? 'equal' : 'DIFFERS'}; undo steps +${state().past.length - steps}; captions on ${p.captions.enabled}, sounds ${p.graphics?.sound}; ${screen.detail}`
      }
    })

    await attempt('one undo restores both', async () => {
      state().undo()
      const now = drawn(state().project)
      const pass = now.caption === styleB.caption && now.graphic === styleB.graphic
      return { pass, detail: `after one undo: caption ${now.caption === styleB.caption ? 'as before' : 'NOT as before'}, graphic ${now.graphic === styleB.graphic ? 'as before' : 'NOT as before'}` }
    })

    await attempt('the chosen mark follows the project', async () => {
      const readings: string[] = []
      let pass = true
      const step = async (label: string, want: boolean): Promise<void> => {
        const is = lookIsApplied(state().project, at()!)
        const screen = await onScreen()
        readings.push(`${label}: ${is ? 'marked' : 'not marked'} (${screen.detail})`)
        if (is !== want || !screen.pass) pass = false
      }
      await step('undone', false)
      state().applySavedLook(CHECK_LOOK_NAME)
      await step('applied', true)
      // bold-center sets 2 words a line: 5 is a change.
      state().setCaptionOverride('wordsPerLine', 5)
      await step('one caption setting changed', false)
      state().undo()
      await step('that undone', true)
      state().setGraphicsOverride('palette.accent', '#123456')
      await step('the accent changed', false)
      state().undo()
      await step('that undone', true)
      return { pass, detail: readings.join('; ') }
    })

    await attempt('export then import round trip', async () => {
      const original = at()!
      await state().exportSavedLook(CHECK_LOOK_NAME)
      const name = env.file.name
      const text = env.file.text ?? ''
      const exportedNote = same(state().lookNotes, [lookExportedNote(CHECK_LOOK_FILE)])
      await state().removeSavedLook(CHECK_LOOK_NAME)
      const gone = state().savedLooks.length === 0
      await state().importLookFile()
      const back = at()
      const pass = name === CHECK_LOOK_FILE && text.endsWith('}\n') && exportedNote && gone && back !== undefined && same(back, original) && same(state().lookNotes, [])
      return { pass, detail: `file ${JSON.stringify(name)}, ends with a newline ${text.endsWith('}\n')}; note ${JSON.stringify(state().lookNotes)}; read back ${back && same(back, original) ? 'equal' : 'NOT equal'}` }
    })

    await attempt('import under a taken name', async () => {
      const original = at()!
      await state().importLookFile()
      const names = state().savedLooks.map((l) => l.name)
      const second = state().savedLooks.find((l) => l.name === `${CHECK_LOOK_NAME} 2`)
      const pass =
        same(names, [CHECK_LOOK_NAME, `${CHECK_LOOK_NAME} 2`]) &&
        same(at(), original) &&
        second !== undefined &&
        same({ ...second, name: CHECK_LOOK_NAME }, original) &&
        same(state().lookNotes, [LOOK_NOTE_RENAMED])
      return { pass, detail: `names ${JSON.stringify(names)}; notes ${JSON.stringify(state().lookNotes)}` }
    })

    const refused = async (text: string, reason: string): Promise<{ pass: boolean; detail: string }> => {
      const project = state().project
      const looks = state().savedLooks
      const steps = state().past.length
      env.file.put(text)
      await state().importLookFile()
      const pass = same(state().lookNotes, [reason]) && state().project === project && state().savedLooks === looks && state().past.length === steps
      return { pass, detail: `notes ${JSON.stringify(state().lookNotes)}; project ${state().project === project ? 'unchanged' : 'CHANGED'}; list ${state().savedLooks === looks ? 'unchanged' : 'CHANGED'}` }
    }
    const good = serializeLook(at()!)

    await attempt('refuses a damaged file', () => refused('not a look', LOOK_UNREADABLE))
    await attempt('refuses a newer file', () => refused(good.replace('"schema": 1', '"schema": 2'), LOOK_NEWER))
    await attempt('refuses a file too large', () => refused(`{"pad":"${'z'.repeat(LOOK_FILE_MAX_BYTES)}"}`, LOOK_TOO_LARGE))

    await attempt('an empty name says why', async () => {
      const looks = state().savedLooks
      state().startLookSave()
      state().setLookDraft({ name: '   ', author: 'Someone' })
      const saved = await state().commitLookDraft()
      const pass = !saved && same(state().lookNotes, [LOOK_NAME_NEEDED]) && state().lookDraft !== null && state().savedLooks === looks
      state().cancelLookSave()
      return { pass, detail: `saved ${saved}; notes ${JSON.stringify(state().lookNotes)}; the form ${pass ? 'stayed open' : 'state wrong'}` }
    })

    await attempt('remove', async () => {
      const project = state().project
      await state().removeSavedLook(`${CHECK_LOOK_NAME} 2`)
      const setting = await savedSetting()
      const names = state().savedLooks.map((l) => l.name)
      const pass = same(names, [CHECK_LOOK_NAME]) && same(setting, state().savedLooks) && state().project === project
      return { pass, detail: `left ${JSON.stringify(names)}; settings ${same(setting, state().savedLooks) ? 'match' : 'DIFFER'}` }
    })

    await attempt('the cap', async () => {
      for (let n = state().savedLooks.length + 1; state().savedLooks.length < SAVED_LOOKS_MAX; n++) {
        await state().saveLook({ name: `Check look ${n}` })
      }
      const full = state().savedLooks.length
      const extra = await state().saveLook({ name: 'One too many' })
      const saidSave = same(state().lookNotes, [LOOK_LIST_FULL])
      env.file.put(good)
      await state().importLookFile()
      const saidImport = same(state().lookNotes, [LOOK_LIST_FULL])
      const over = await state().saveLook({ name: CHECK_LOOK_NAME.toUpperCase() })
      const replaced = state().savedLooks.find((l) => l.name === CHECK_LOOK_NAME.toUpperCase())
      const pass = full === SAVED_LOOKS_MAX && !extra && saidSave && saidImport && over && replaced?.version === 2 && state().savedLooks.length === SAVED_LOOKS_MAX
      return { pass, detail: `${full} saved; one more refused ${!extra} with ${saidSave ? 'the full note' : JSON.stringify(state().lookNotes)}; an import refused ${saidImport}; saving over a name ${over}, version ${replaced?.version}` }
    })
  } finally {
    useEditor.setState(before)
    await window.forge.setSetting(LOOKS_SETTING, settingBefore)
    Object.assign(env.file, fileBefore)
  }

  await attempt('restores the page', async () => {
    const now = state()
    const setting = await savedSetting()
    // Every piece the check set aside, each by identity (or value, for the file's
    // plain fields), and each named in the detail so a miss says which.
    const parts: Array<[string, boolean]> = [
      ['project', now.project === before.project],
      ['undo', now.past === before.past],
      ['redo', now.future === before.future],
      ['unsaved mark', now.dirty === before.dirty],
      ['saved looks', now.savedLooks === before.savedLooks],
      ['notes', now.lookNotes === before.lookNotes],
      ['form', now.lookDraft === before.lookDraft],
      ['OUTPUT open', now.outputOpen === before.outputOpen],
      ['settings', same(setting, settingBefore)],
      ['file text', env.file.text === fileBefore.text],
      ['file name', env.file.name === fileBefore.name],
      ['file writes', env.file.writes === fileBefore.writes],
      ['file cancel', env.file.cancel === fileBefore.cancel]
    ]
    const pass = parts.every(([, back]) => back)
    return { pass, detail: parts.map(([what, back]) => `${what} ${back ? 'back' : 'NOT back'}`).join('; ') }
  })

  const failed = cases.filter((c) => !c.pass)
  return {
    ok: failed.length === 0 && cases.length === LOOK_CHECK_CASES.length,
    cases,
    summary: failed.length === 0 ? `${cases.length} of ${LOOK_CHECK_CASES.length} cases pass` : `${failed.length} of ${cases.length} failed: ${failed.map((c) => c.name).join(', ')}`
  }
}

/** Two animation frames: React has drawn what the store holds. */
const frames = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))

/** The "My look" rows marked as chosen on the page, by their full names (the row's title). */
async function chosenOnPage(): Promise<string[] | null> {
  await frames()
  const section = document.querySelector('[data-look-section]')
  if (!section) return null
  return [...section.querySelectorAll<HTMLElement>('[data-look-row][aria-pressed="true"]')].map((row) => row.getAttribute('data-look-row') ?? '')
}

export function installLookCheck(): void {
  ;(window as unknown as { __forgeLookCheck: () => Promise<LookCheckResult> }).__forgeLookCheck = () =>
    runLookCheck({
      file: (window as unknown as { __forgeLookFile: LookCheckFile }).__forgeLookFile,
      chosenOnScreen: async () => {
        const seen = await chosenOnPage()
        // The strip is opened by the check; a page with no section is a failure to read, said as such.
        if (seen === null) throw new Error('the OUTPUT strip has no "My look" section on screen')
        return seen
      }
    })
}
