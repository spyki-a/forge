import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PublicDirectorConfig } from '@shared/director/provider'
import { SettingsPanel, helperState } from '../../src/renderer/src/components/SettingsPanel'

/*
 * The settings panel, rendered (docs/WINDOW.md §3.9, step 6).
 *
 * The source half is tests/settingsPanel.test.ts: the panel reads nothing
 * key-shaped but `hasKey`. This is what it actually draws: a key handed to it
 * anyway — the main process strips it in publicConfig, so this is the second
 * wall — never reaches the markup, and the password field holds only what is
 * being typed. Rendered to static markup, so effects (the refresh on open, the
 * Escape and click-away listeners) do not run and no bridge is needed.
 *
 * The store is replaced by a plain selector over a plain object: rendered on
 * the server, zustand answers every selector from its INITIAL state (its
 * getServerSnapshot), so the real store could never show the panel open.
 */

const fake = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('../../src/renderer/src/store', () => ({
  useEditor: (select: (s: Record<string, unknown>) => unknown) => select(fake.state)
}))

/*
 * A config that carries a key where none should be — at the top, where a
 * careless `{config.apiKey}` would read it, and inside openai, as the main
 * process's own DirectorConfig has it. publicConfig strips both; this is the
 * panel's half: even handed one, it must not show it.
 */
const SECRET = 'sk-census-SECRET-0123456789'
const smuggled = (hasKey: boolean): PublicDirectorConfig =>
  ({
    apiKey: SECRET,
    provider: 'auto',
    ollama: { baseUrl: 'http://127.0.0.1:11434', model: '' },
    openai: { baseUrl: 'https://api.example.com/v1', model: 'm', hasKey, apiKey: SECRET }
  }) as unknown as PublicDirectorConfig

const render = (): string => renderToStaticMarkup(createElement(SettingsPanel))

beforeEach(() => {
  fake.state = {
    settingsOpen: true,
    setSettingsOpen: () => undefined,
    directorStatus: [],
    directorConfig: null,
    refreshDirector: async () => undefined,
    setDirectorProvider: async () => undefined,
    sidecarReady: false,
    sidecarError: null
  }
})

describe('the panel, rendered', () => {
  it('draws nothing while closed', () => {
    fake.state.settingsOpen = false
    expect(render()).toBe('')
  })

  it('says a key is saved, offers to clear it, and never shows it', () => {
    fake.state.directorConfig = smuggled(true)
    const html = render()
    expect(html).toContain('•••••••• (saved)')
    expect(html).toContain('>Clear</button>')
    expect(html).not.toContain(SECRET)
    expect(html).not.toContain('sk-census')
    // The field itself is empty: it holds only what is being typed.
    const fields = [...html.matchAll(/<input[^>]*type="password"[^>]*>/g)]
    expect(fields).toHaveLength(1)
    expect(fields[0][0]).toContain('value=""')
  })

  it('asks for a key on a hosted server without one, and has no Clear', () => {
    fake.state.directorConfig = smuggled(false)
    const html = render()
    expect(html).toContain('placeholder="paste your key"')
    expect(html).not.toContain('>Clear</button>')
    expect(html).not.toContain(SECRET)
  })

  it('shows the AI helper in plain words, with the reason when there is one', () => {
    fake.state.sidecarError = 'spawn python3 ENOENT'
    const html = render()
    expect(html).toContain('AI helper (Python)')
    expect(html).toContain('>Not running<')
    expect(html).toContain('spawn python3 ENOENT')
    expect([...html.matchAll(/coming with Narration/g)]).toHaveLength(2)
  })
})

describe('the AI helper state', () => {
  it('names each state, and an error wins over ready', () => {
    expect(helperState(true, null)).toEqual({ word: 'Running', dot: 'bg-emerald-500' })
    expect(helperState(false, null)).toEqual({ word: 'Starting', dot: 'bg-ink-600' })
    expect(helperState(false, 'gone')).toEqual({ word: 'Not running', dot: 'bg-red-500' })
    expect(helperState(true, 'gone').word).toBe('Not running')
  })
})
