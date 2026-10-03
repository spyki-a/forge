import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { isLoopback, type LlmProviderChoice } from '@shared/director/provider'
import { useEditor } from '../store'

/**
 * Settings: every outside service the app talks to, in one place under the
 * header's gear (docs/WINDOW.md §3.9 — the user's sheet 28, 2026-10-02: "all
 * the API integrations in the settings panel at the top right").
 *
 *   Model servers       the Director's provider block, moved here whole from
 *                       Director.tsx, which keeps only the line saying who
 *                       would answer (so Direct is never pressed blind) and a
 *                       gear that opens this.
 *   AI helper (Python)  the Python helper's state, which the dot on the gear
 *                       only hints at.
 *   Hosted voice, Pexels  shown and disabled until Narration needs them.
 *
 * THE KEY IS WRITE-ONLY. It lives in the settings file in the main process,
 * and what crosses the bridge is `publicConfig` (shared/director/provider.ts),
 * which puts `hasKey` in its place. So this panel can say THAT there is a key,
 * and can send a new one or an empty one, and nothing more: the field holds
 * only what is being typed, and is emptied the moment it is sent. Never read a
 * key back, render it, log it, or put it in a title or an error message —
 * tests/settingsPanel.test.ts holds this file to it.
 *
 * On screen the Python helper is the "AI helper", never the "sidecar": the
 * user's sidecar is the left panel (the Shelf, WINDOW.md §1).
 */

const input =
  'min-w-0 flex-1 rounded border border-ink-800 bg-ink-950 px-1.5 py-1 text-[11px] text-ink-200 placeholder:text-ink-600 focus:border-accent-500 focus:outline-none'
const small = 'rounded bg-ink-800 px-2 py-1 text-[10.5px] text-ink-400 hover:bg-ink-700 hover:text-ink-200 disabled:opacity-40'
const heading = 'text-[11.5px] font-medium text-ink-200'

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <label className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[10.5px] text-ink-400">{label}</span>
      {children}
    </label>
  )
}

/**
 * The AI helper's state in plain words, and the colour of its dot — the one
 * reading the header's gear and this panel's row both show, so they cannot
 * disagree.
 */
export function helperState(ready: boolean, error: string | null): { word: string; dot: string } {
  if (error) return { word: 'Not running', dot: 'bg-red-500' }
  if (ready) return { word: 'Running', dot: 'bg-emerald-500' }
  return { word: 'Starting', dot: 'bg-ink-600' }
}

/** A service that has a place here and no settings yet. */
function ComingSoon({ name, what }: { name: string; what: string }): ReactNode {
  return (
    <section aria-disabled="true" className="space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11.5px] font-medium text-ink-500">{name}</h3>
        <span className="shrink-0 rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-500">
          coming with Narration
        </span>
      </div>
      <p className="text-[10.5px] leading-snug text-ink-600">{what}</p>
    </section>
  )
}

/** Mounted once by App, and drawn only while the store says it is open. */
export function SettingsPanel(): ReactNode {
  const open = useEditor((s) => s.settingsOpen)
  const setOpen = useEditor((s) => s.setSettingsOpen)
  const close = useCallback(() => setOpen(false), [setOpen])
  if (!open) return null
  return <SettingsCard onClose={close} />
}

function SettingsCard({ onClose }: { onClose: () => void }): ReactNode {
  const card = useRef<HTMLDivElement>(null)
  const status = useEditor((s) => s.directorStatus)
  const config = useEditor((s) => s.directorConfig)
  const refresh = useEditor((s) => s.refreshDirector)
  const setProvider = useEditor((s) => s.setDirectorProvider)
  const sidecarReady = useEditor((s) => s.sidecarReady)
  const sidecarError = useEditor((s) => s.sidecarError)
  const [key, setKey] = useState('')

  // Asked on open, so the servers' lines say what is true now. The Director
  // asks on its own mount too; neither depends on the other being on screen.
  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // Handled: closing settings must not also leave full screen.
        e.preventDefault()
        onClose()
      }
    }
    // A press anywhere else closes it, as the clip menu does. Not on a gear:
    // the header's toggles it, and the Director's opens it.
    const away = (e: PointerEvent): void => {
      const target = e.target
      if (target instanceof Node && card.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-settings-gear]')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', away)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', away)
    }
  }, [onClose])

  const ollama = status?.find((p) => p.id === 'ollama')
  const openai = status?.find((p) => p.id === 'openai')
  const openaiLocal = config ? isLoopback(config.openai.baseUrl) : true
  const helper = helperState(sidecarReady, sidecarError)

  const modelPicker = (
    id: 'ollama' | 'openai',
    models: string[] | undefined,
    current: string
  ): ReactNode => {
    const options = models && models.length > 0 ? models : []
    if (options.length === 0) {
      return (
        <input
          className={input}
          value={current}
          placeholder="model name"
          onChange={(e) =>
            void setProvider({ [id]: { model: e.target.value } } as Parameters<typeof setProvider>[0])
          }
        />
      )
    }
    return (
      <select
        className={input}
        value={options.includes(current) ? current : ''}
        onChange={(e) =>
          void setProvider({ [id]: { model: e.target.value } } as Parameters<typeof setProvider>[0])
        }
      >
        <option value="">choose a model…</option>
        {options.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    )
  }

  /*
   * Anchored under the header's right end, where the gear is. A card and no
   * scrim: nothing covers the header's drag region, and the rest of the
   * window stays visible — a press on it closes this, as Escape does.
   */
  return (
    <div
      ref={card}
      role="dialog"
      aria-label="Settings"
      className="fixed right-2 top-10 z-50 flex max-h-[calc(100vh-3.5rem)] w-80 flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-lg"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-ink-800 px-3 py-2">
        <h2 className="text-[12px] font-semibold text-ink-100">Settings</h2>
        <button
          onClick={onClose}
          title="Close settings"
          className="rounded p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-200"
        >
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <section className="space-y-1.5">
          <h3 className={heading}>Model servers</h3>
          <p className="text-[10.5px] leading-snug text-ink-600">
            The Director plans with one of these. A server on this machine costs nothing per use.
          </p>
          {!config ? (
            <div className="text-[10.5px] text-ink-600">asking the model servers…</div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex gap-1">
                {(['auto', 'ollama', 'openai'] as LlmProviderChoice[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => void setProvider({ provider: p })}
                    className={`flex-1 rounded px-1.5 py-1 text-[10.5px] ${
                      config.provider === p ? 'bg-accent-500 text-ink-950' : 'bg-ink-800 text-ink-400 hover:bg-ink-700'
                    }`}
                  >
                    {p === 'auto' ? 'Auto' : p === 'ollama' ? 'Ollama' : openaiLocal ? 'LM Studio' : 'Hosted'}
                  </button>
                ))}
              </div>

              <div className="text-[10px] uppercase tracking-wide text-ink-600">Ollama</div>
              <Field label="Server">
                <input
                  className={input}
                  value={config.ollama.baseUrl}
                  onChange={(e) => void setProvider({ ollama: { baseUrl: e.target.value } })}
                />
              </Field>
              <Field label="Model">{modelPicker('ollama', ollama?.models, config.ollama.model)}</Field>
              {ollama && !ollama.ready && <div className="text-[10px] text-ink-500">{ollama.reason}</div>}

              <div className="pt-1 text-[10px] uppercase tracking-wide text-ink-600">
                OpenAI-shaped server — LM Studio, llama.cpp, or a hosted API
              </div>
              <Field label="Server">
                <input
                  className={input}
                  value={config.openai.baseUrl}
                  placeholder="http://127.0.0.1:1234/v1"
                  onChange={(e) => void setProvider({ openai: { baseUrl: e.target.value } })}
                />
              </Field>
              <Field label="Model">{modelPicker('openai', openai?.models, config.openai.model)}</Field>
              <Field label="Key">
                <input
                  className={input}
                  type="password"
                  value={key}
                  placeholder={config.openai.hasKey ? '•••••••• (saved)' : openaiLocal ? 'not needed locally' : 'paste your key'}
                  onChange={(e) => setKey(e.target.value)}
                />
                <button
                  className={small}
                  disabled={key.trim().length === 0}
                  onClick={() => {
                    void setProvider({ openai: { apiKey: key.trim() } })
                    setKey('')
                  }}
                >
                  Save
                </button>
                {config.openai.hasKey && (
                  <button className={small} onClick={() => void setProvider({ openai: { apiKey: '' } })}>
                    Clear
                  </button>
                )}
              </Field>
              {openai && !openai.ready && <div className="text-[10px] text-ink-500">{openai.reason}</div>}
              <button onClick={() => void refresh()} className={small}>
                Check again
              </button>
            </div>
          )}
        </section>

        <section className="space-y-1">
          <h3 className={heading}>AI helper (Python)</h3>
          <div className="flex items-center gap-1.5 text-[11px] text-ink-300">
            <span className={`size-1.5 shrink-0 rounded-full ${helper.dot}`} />
            <span>{helper.word}</span>
          </div>
          {sidecarError && <div className="text-[10.5px] leading-snug text-ink-500">{sidecarError}</div>}
          <p className="text-[10.5px] leading-snug text-ink-600">
            On this machine: transcription, beat finding, depth, stem splitting, the local voice and
            the Director&apos;s look at your photos. The editor works without it.
          </p>
        </section>

        <ComingSoon
          name="Hosted voice"
          what="Narration read by a hosted voice: its server, model and voice, and your key for it."
        />
        <ComingSoon name="Pexels" what="Stock photos and clips from Pexels, searched with your own key." />
      </div>
    </div>
  )
}
