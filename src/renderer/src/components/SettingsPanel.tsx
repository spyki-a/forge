import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { isLoopback, type LlmProviderChoice } from '@shared/director/provider'
import { formatBytes } from '@shared/assets/pack'
import { STOP_SPEECH_MODEL } from '@shared/asr/speechModel'
import { SIDECAR_METHODS } from '@shared/sidecar/protocol'
import { HELPER_PACK } from '@shared/sidecar/packManifest'
import { helperCan } from '@shared/sidecar/helperCan'
import {
  MODEL_PRESSES_NETWORK,
  helperRow,
  packFactsFor,
  speechModelRow,
  type HelperActionKind,
  type HelperDot,
  type HelperRow,
  type PackFacts
} from '@shared/sidecar/row'
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
 *   AI helper (Python)  the Python helper's row (docs/CLIPS.md §3a.4): its
 *                       state, the presses with their sizes (Install, Repair,
 *                       Update, Remove, Check again) and the speech model.
 *                       The ONLY Install in the app (§16.41): every other
 *                       "needs the AI helper" is a `HelperPointer` to here.
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
 * This window's pack in the manifest: the sizes the ready and failed rows
 * name, whose statuses carry no offer, and the `expects` the feature count is
 * out of. By the renderer's platform ('MacIntel', 'Win32'): the app ships one
 * build per platform (row.ts `packFactsFor`).
 */
export const THIS_PACK: PackFacts = packFactsFor(HELPER_PACK, typeof navigator === 'undefined' ? '' : navigator.platform)

/**
 * The AI helper's row from the store: the one reading the header's gear and
 * this panel both show, so they cannot disagree (shared/sidecar/row.ts).
 */
export function useHelperRow(): HelperRow {
  const status = useEditor((s) => s.helperStatus)
  const job = useEditor((s) => s.helperJob)
  return helperRow({ status, pack: THIS_PACK, job })
}

const DOT_CLASS: Record<HelperDot, string> = {
  grey: 'bg-ink-600',
  green: 'bg-emerald-500',
  red: 'bg-red-500'
}

/** The dot's colour class: grey, green or red. */
export function dotClass(dot: HelperDot): string {
  return DOT_CLASS[dot]
}

/** Every pointer's words: the census rows match them, so they stay as they were. */
export const NEEDS_THE_HELPER = 'needs the AI helper'
/** A pointer's title: where the one Install is. */
export const POINTER_TITLE = 'install it in Settings'

/**
 * "needs the AI helper", as a small button that opens Settings with the AI
 * helper row in view (docs/CLIPS.md §3a.4 "Everywhere else is a pointer, not
 * a second Install", §16.41), as the Director's gear opens the same card.
 * `data-settings-gear`, so a press on it while the card is open does not
 * count as a press away from it.
 */
export function HelperPointer({ className = '' }: { className?: string }): ReactNode {
  const openSettingsAt = useEditor((s) => s.openSettingsAt)
  return (
    <button
      type="button"
      data-settings-gear=""
      data-helper-pointer=""
      onClick={() => openSettingsAt('helper')}
      title={POINTER_TITLE}
      className={`underline decoration-dotted underline-offset-2 hover:text-ink-200 ${className}`}
    >
      {NEEDS_THE_HELPER}
    </button>
  )
}

/** What each press does, on its title. */
const ACTION_TITLE: Record<HelperActionKind, string> = {
  install: 'Download the AI helper’s own Python and libraries, install them for this app, and check them',
  repair: 'Download the AI helper again and replace the one on this computer',
  update: 'Install the AI helper this version of the app needs, in place of the older one',
  remove: 'Delete the AI helper from this computer',
  checkAgain: 'Check the installed AI helper again, downloading nothing: after installing the Visual C++ runtime, say'
}

/** Each press while it runs: what its button says, and what every other button's title says. */
const ACTION_BUSY: Record<HelperActionKind, string> = {
  install: 'Starting the install…',
  repair: 'Starting the repair…',
  update: 'Starting the update…',
  remove: 'Removing…',
  checkAgain: 'Checking…'
}

/** A sentence with its links pressable: they open in the browser (main's window-open handler, shell.openExternal). */
function linked(sentence: string): ReactNode {
  const parts = sentence.split(/(https:\/\/[^\s,]+)/)
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" className="text-accent-400 underline">
        {part}
      </a>
    ) : (
      part
    )
  )
}

/**
 * The AI helper's row (docs/CLIPS.md §3a.4): the dot, the state, what is on
 * this machine or why not, the presses with their sizes in the Key row's
 * small style, Remove's confirm, the last refusal, and the speech model.
 *
 * No hook but the store's, so a test can call it as a function and press
 * what it returns. Every press goes through the store, which calls the
 * bridge; the EXPORT strip carries a helper job's bar and X, so there is no
 * second bar here.
 */
export function HelperSection(): ReactNode {
  const row = useHelperRow()
  const status = useEditor((s) => s.helperStatus)
  const ui = useEditor((s) => s.helperUi)
  const press = useEditor((s) => s.pressHelper)
  const setRemoveModels = useEditor((s) => s.setRemoveModels)
  const cancelRemove = useEditor((s) => s.cancelRemove)
  const confirmRemove = useEditor((s) => s.confirmRemove)
  const speechModel = useEditor((s) => s.speechModel)
  const speechFetch = useEditor((s) => s.speechFetch)
  const getSpeechModel = useEditor((s) => s.getSpeechModel)
  const cancelSpeechModel = useEditor((s) => s.cancelSpeechModel)
  const speech = speechModelRow(speechModel, helperCan(status, SIDECAR_METHODS.transcribe), speechFetch)
  const waiting = ui.busy !== null ? ACTION_BUSY[ui.busy] : null
  // A helper job running: every press here waits for it, with its reason (row.ts).
  const jobReason = row.actions.find((a) => a.disabled !== undefined)?.disabled

  return (
    <section data-helper-row="" className="space-y-1">
      <h3 className={heading}>AI helper (Python)</h3>
      <div className="flex items-start gap-1.5 text-[11px] text-ink-300">
        <span className={`mt-[5px] size-1.5 shrink-0 rounded-full ${dotClass(row.dot)}`} />
        <span className="min-w-0 leading-snug">
          <span>{row.word}</span>
          {row.line && <span className="text-ink-500"> · {row.line}</span>}
        </span>
      </div>
      {row.actions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {row.actions.map((action) => (
            <button
              key={action.kind}
              type="button"
              data-helper-action={action.kind}
              className={small}
              disabled={action.disabled !== undefined || ui.busy !== null || (action.kind === 'remove' && ui.removing !== null)}
              title={action.disabled ?? waiting ?? ACTION_TITLE[action.kind]}
              onClick={() => void press(action.kind)}
            >
              {ui.busy === action.kind ? ACTION_BUSY[action.kind] : action.label}
            </button>
          ))}
        </div>
      )}
      {/* Under the presses: the hosts under Install (§16.40 (a)), the Visual C++ runtime's sentence, each integrity problem. */}
      {row.detail?.map((sentence, i) => (
        <p key={i} className="break-words text-[10.5px] leading-snug text-ink-500">
          {linked(sentence)}
        </p>
      ))}
      {ui.removing && (
        <div data-helper-remove="" className="space-y-1 rounded border border-ink-800 p-2">
          <p className="text-[10.5px] leading-snug text-ink-300">
            Remove the AI helper? It frees about {formatBytes(THIS_PACK.bytesOnDisk)}.
          </p>
          <label className="flex items-center gap-1.5 text-[10.5px] text-ink-400">
            <input
              type="checkbox"
              checked={ui.removing.models}
              onChange={(e) => setRemoveModels(e.target.checked)}
            />
            also remove the downloaded models
            {typeof ui.removing.modelsBytes === 'number' && ui.removing.modelsBytes > 0 && (
              <span data-models-bytes="" className="text-ink-500">
                {' · '}
                {formatBytes(ui.removing.modelsBytes)}
              </span>
            )}
          </label>
          <div className="flex gap-1">
            <button type="button" className={small} disabled={ui.busy !== null} onClick={() => void confirmRemove()}>
              {ui.busy === 'remove' ? ACTION_BUSY.remove : 'Remove it'}
            </button>
            <button type="button" className={small} disabled={ui.busy !== null} onClick={cancelRemove}>
              Keep it
            </button>
          </div>
        </div>
      )}
      {ui.error && <p className="text-[10.5px] leading-snug text-red-800">{ui.error}</p>}
      {speech && (
        <div data-speech-model="" className="flex items-center justify-between gap-2 text-[10.5px] text-ink-400">
          <span className="min-w-0">{speech.text}</span>
          {speech.get !== undefined && (
            <button
              type="button"
              className={small}
              disabled={jobReason !== undefined}
              title={jobReason ?? (speechModel ? `Fetched once from ${speechModel.host}, then kept on this computer: Transcribe needs it` : undefined)}
              onClick={() => void getSpeechModel()}
            >
              {speech.get}
            </button>
          )}
          {speechFetch && (
            <button type="button" data-speech-cancel="" className={small} title={STOP_SPEECH_MODEL} aria-label={STOP_SPEECH_MODEL} onClick={cancelSpeechModel}>
              <X size={10} />
            </button>
          )}
        </div>
      )}
      {/* Model presses go through the helper's own fetchers (§16.40 (d)): said wherever one can be pressed. */}
      {status?.state === 'ready' && (
        <p data-model-network="" className="break-words text-[10.5px] leading-snug text-ink-500">
          {MODEL_PRESSES_NETWORK}
        </p>
      )}
      <p className="text-[10.5px] leading-snug text-ink-600">
        On this machine: transcription, beat finding, depth, stem splitting, the local voice and
        the Director&apos;s look at your photos. The editor works without it.
      </p>
    </section>
  )
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
  const focus = useEditor((s) => s.settingsFocus)
  const setFocus = useEditor((s) => s.setSettingsFocus)
  const helperStatus = useEditor((s) => s.helperStatus)
  const speechModel = useEditor((s) => s.speechModel)
  const refreshSpeechModel = useEditor((s) => s.refreshSpeechModel)
  const helperBox = useRef<HTMLDivElement>(null)
  const [key, setKey] = useState('')
  const canTranscribe = helperCan(helperStatus, SIDECAR_METHODS.transcribe)

  // Asked on open, so the servers' lines say what is true now. The Director
  // asks on its own mount too; neither depends on the other being on screen.
  useEffect(() => {
    void refresh()
  }, [refresh])

  // The speech model's line: asked once the helper can transcribe and nobody has asked. Never downloads.
  useEffect(() => {
    if (canTranscribe && speechModel === null) void refreshSpeechModel()
  }, [canTranscribe, speechModel, refreshSpeechModel])

  // A pointer's press ("needs the AI helper"): the row in view, once.
  useEffect(() => {
    if (focus !== 'helper') return
    helperBox.current?.scrollIntoView({ block: 'nearest' })
    setFocus(null)
  }, [focus, setFocus])

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

        <div ref={helperBox}>
          <HelperSection />
        </div>

        <ComingSoon
          name="Hosted voice"
          what="Narration read by a hosted voice: its server, model and voice, and your key for it."
        />
        <ComingSoon name="Pexels" what="Stock photos and clips from Pexels, searched with your own key." />
      </div>
    </div>
  )
}
