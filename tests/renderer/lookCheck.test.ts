import { beforeAll, describe, expect, it, vi } from 'vitest'
import { LOOKS_SETTING } from '@shared/look'

/*
 * `window.__forgeLookCheck()` (src/renderer/src/harness/lookCheck.ts;
 * creator style, piece 2), in node: the same cases against the same harness
 * bridge (its in-memory settings and look file) and the real store, so CI
 * holds what the session reads on the page. Only the on-screen reading of
 * the chosen row is the page's: here `chosenOnScreen` is absent, and each
 * case says so in its detail.
 */

let run: typeof import('../../src/renderer/src/harness/lookCheck')
let store: typeof import('../../src/renderer/src/store')

beforeAll(async () => {
  vi.stubGlobal('window', {})
  const { installHarnessBridge } = await import('../../src/renderer/src/harness/bridge')
  installHarnessBridge()
  store = await import('../../src/renderer/src/store')
  run = await import('../../src/renderer/src/harness/lookCheck')
})

const file = () => (window as unknown as { __forgeLookFile: import('../../src/renderer/src/harness/lookCheck').LookCheckFile }).__forgeLookFile

describe('the look check (harness lookCheck.ts), in node on the harness bridge', () => {
  it('runs every case, in order, and each passes', async () => {
    const result = await run.runLookCheck({ file: file() })
    const failed = result.cases.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`)
    expect(failed).toEqual([])
    expect(result.cases.map((c) => c.name)).toEqual([...run.LOOK_CHECK_CASES])
    expect(result.ok).toBe(true)
    expect(result.summary).toBe(`${run.LOOK_CHECK_CASES.length} of ${run.LOOK_CHECK_CASES.length} cases pass`)
    expect(run.LOOK_CHECK_CASES).toHaveLength(14)
  })

  it('puts the page back: the project, the saved looks, the setting and the file as they were', async () => {
    const page = store.useEditor.getState()
    const project = page.project
    const looks = page.savedLooks
    file().put('the page’s own file')
    await window.forge.setSetting(LOOKS_SETTING, ['the page’s own value'])
    await run.runLookCheck({ file: file() })
    expect(store.useEditor.getState().project).toBe(project)
    expect(store.useEditor.getState().savedLooks).toBe(looks)
    expect((await window.forge.getSettings())[LOOKS_SETTING]).toEqual(['the page’s own value'])
    expect(file().text).toBe('the page’s own file')
  })

  it('fails the three refusal cases when an import touches the list though the file was refused', async () => {
    const real = store.useEditor.getState().importLookFile
    // A store that answers the refusal but still writes the list (a new array of the same looks).
    store.useEditor.setState({
      importLookFile: async () => {
        await real()
        store.useEditor.setState((s) => ({ savedLooks: [...s.savedLooks] }))
      }
    })
    try {
      const result = await run.runLookCheck({ file: file() })
      const refusals = result.cases.filter((c) => c.name.startsWith('refuses '))
      expect(refusals.map((c) => [c.name, c.pass])).toEqual([
        ['refuses a damaged file', false],
        ['refuses a newer file', false],
        ['refuses a file too large', false]
      ])
      expect(refusals[0].detail).toContain('list CHANGED')
      expect(result.ok).toBe(false)
    } finally {
      store.useEditor.setState({ importLookFile: real })
    }
  })

  it('reports a case as failed when the screen disagrees with the rule, and says what it saw', async () => {
    const result = await run.runLookCheck({ file: file(), chosenOnScreen: async () => ['Not a look on this page'] })
    expect(result.ok).toBe(false)
    expect(result.cases.find((c) => c.name === 'save')!.detail).toContain('marked on screen ["Not a look on this page"]')
  })
})
