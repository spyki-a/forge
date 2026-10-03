import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { app } from 'electron'
import type { Settings } from '@shared/types'
import { DEFAULT_DIRECTOR } from '@shared/director/provider'
import { defaultConcurrency } from './queue'

/**
 * A tiny JSON settings file. electron-store would do this too, but it is
 * ESM-only now and fights the CJS main bundle for no gain at this size.
 *
 * ONE owner for the file, holding two halves of it:
 *
 *  - `cache`, the main process's own fields (`Settings`): output folder,
 *    concurrency, the voice and Director configs — and with those, the hosted
 *    API keys. Sanitised on the way in.
 *  - `rest`, every other key: the renderer's (export presets, the export
 *    choice), kept as written and handed back through `settings:get`.
 *
 * Both are written together, so neither side's save drops the other's keys.
 * They used to be two writers — this module and a raw read-modify-write in
 * ipc.ts — and a Director save rewrote the file through `sanitize`, which kept
 * only `Settings` and silently deleted every saved export preset. The raw one
 * also returned the whole file to the renderer, keys included.
 *
 * The renderer only ever sees `rest`. A hosted key lives in `cache`, so it
 * cannot reach the renderer through here, and the renderer cannot write a
 * main-process field (a key among them) by naming it either: those go through
 * their own IPC, which sanitises and never answers with the key.
 */
let cache: Settings | null = null
let rest: Record<string, unknown> = {}

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function defaults(): Settings {
  return {
    outputDir: null,
    concurrency: defaultConcurrency(),
    overwrite: false,
    lastPresetId: null,
    voiceProvider: 'auto',
    voiceHosted: { baseUrl: '', model: 'tts-1', voice: 'alloy', apiKey: '' },
    director: {
      provider: DEFAULT_DIRECTOR.provider,
      ollama: { ...DEFAULT_DIRECTOR.ollama },
      openai: { ...DEFAULT_DIRECTOR.openai }
    }
  }
}

function sanitize(raw: unknown): Settings {
  const base = defaults()
  if (typeof raw !== 'object' || raw === null) return base
  const input = raw as Record<string, unknown>
  return {
    outputDir: typeof input.outputDir === 'string' ? input.outputDir : base.outputDir,
    concurrency:
      typeof input.concurrency === 'number' && input.concurrency >= 1 && input.concurrency <= 8
        ? Math.floor(input.concurrency)
        : base.concurrency,
    overwrite: typeof input.overwrite === 'boolean' ? input.overwrite : base.overwrite,
    lastPresetId: typeof input.lastPresetId === 'string' ? input.lastPresetId : base.lastPresetId,
    voiceProvider:
      input.voiceProvider === 'kokoro' || input.voiceProvider === 'hosted'
        ? input.voiceProvider
        : 'auto',
    voiceHosted: voiceHosted(input.voiceHosted, base.voiceHosted!),
    director: director(input.director, base.director!)
  }
}

/**
 * Same discipline as the voice config: strings only, an enum for the choice,
 * and never a partial object. A settings file written before the director
 * existed has no `director` key at all and must load as the defaults.
 */
function director(raw: unknown, base: NonNullable<Settings['director']>): NonNullable<Settings['director']> {
  if (typeof raw !== 'object' || raw === null) return base
  const input = raw as Record<string, unknown>
  const str = (value: unknown, fallback: string): string =>
    typeof value === 'string' ? value : fallback
  const ollama = typeof input.ollama === 'object' && input.ollama !== null ? (input.ollama as Record<string, unknown>) : {}
  const openai = typeof input.openai === 'object' && input.openai !== null ? (input.openai as Record<string, unknown>) : {}
  return {
    provider:
      input.provider === 'ollama' || input.provider === 'openai' || input.provider === 'auto'
        ? input.provider
        : base.provider,
    ollama: {
      baseUrl: str(ollama.baseUrl, base.ollama.baseUrl),
      model: str(ollama.model, base.ollama.model)
    },
    openai: {
      baseUrl: str(openai.baseUrl, base.openai.baseUrl),
      model: str(openai.model, base.openai.model),
      apiKey: str(openai.apiKey, base.openai.apiKey)
    }
  }
}

/** Strings only, and never a partial object — every field has a usable default. */
function voiceHosted(
  raw: unknown,
  base: NonNullable<Settings['voiceHosted']>
): NonNullable<Settings['voiceHosted']> {
  if (typeof raw !== 'object' || raw === null) return base
  const input = raw as Record<string, unknown>
  const str = (value: unknown, fallback: string): string =>
    typeof value === 'string' ? value : fallback
  return {
    baseUrl: str(input.baseUrl, base.baseUrl),
    model: str(input.model, base.model),
    voice: str(input.voice, base.voice),
    apiKey: str(input.apiKey, base.apiKey)
  }
}

/**
 * The keys this module owns — every field of `Settings`, read off the defaults
 * so a field added there is covered here without a second list to forget.
 */
function mainKeys(): Set<string> {
  return new Set(Object.keys(defaults()))
}

/** Everything in a parsed file that is not the main process's. */
function rendererKeys(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const owned = mainKeys()
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !owned.has(key)))
}

function load(): Settings {
  if (cache) return cache
  try {
    const raw: unknown = JSON.parse(readFileSync(file(), 'utf8'))
    cache = sanitize(raw)
    rest = rendererKeys(raw)
  } catch {
    // Missing is the normal first run, and a corrupt file must not stop the
    // app — defaults are a better answer than a dialog nobody can act on.
    cache = defaults()
    rest = {}
  }
  return cache
}

/**
 * Both halves, atomically.
 *
 * A truncated settings file would lose every preset rather than the one being
 * written, so it goes to a temp name and is renamed into place — atomic within
 * one directory on both platforms. The pid keeps two app instances off each
 * other's temp file.
 *
 * If the rename itself is refused (on Windows a scanner holding the old file
 * open can do that), the file is written in place, as it always was before:
 * a save that is not atomic beats a save that silently did not happen.
 */
function write(): void {
  const target = file()
  const temp = `${target}.${process.pid}.tmp`
  const text = JSON.stringify({ ...rest, ...cache }, null, 2)
  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(temp, text, 'utf8')
    renameSync(temp, target)
    return
  } catch {
    try {
      unlinkSync(temp)
    } catch {
      // Never written, or already gone.
    }
  }
  try {
    writeFileSync(target, text, 'utf8')
  } catch {
    // A read-only home directory should not take the app down; the in-memory
    // value still applies for this session.
  }
}

export function getSettings(): Settings {
  return load()
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = sanitize({ ...load(), ...patch })
  cache = next
  write()
  return next
}

/**
 * The renderer's half of the file — what `settings:get` answers with.
 *
 * Never a `Settings` field: those hold the hosted keys, and the renderer learns
 * about a key only as `hasKey`, through the Director's own IPC.
 */
export function rendererSettings(): Record<string, unknown> {
  load()
  return { ...rest }
}

/**
 * Write one renderer key — what `settings:set` does.
 *
 * A main-process field is refused rather than written: it would land in `rest`
 * beside the real one, and either be ignored or, worse, shadow it. The message
 * names the key, which is a field name, never a value.
 */
export function setRendererSetting(key: string, value: unknown): Record<string, unknown> {
  if (!key) throw new Error('Expected a settings key')
  if (mainKeys().has(key)) throw new Error(`"${key}" is not a setting the window can write`)
  load()
  rest = { ...rest, [key]: value }
  write()
  return { ...rest }
}
