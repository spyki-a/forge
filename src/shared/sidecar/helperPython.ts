/**
 * Which Python runs the AI helper, and how it is started (docs/CLIPS.md §3a.2,
 * "Which interpreter runs" and "The launch: flags and a clean environment";
 * §16.42 answered (b)).
 *
 * Two pure functions. `resolveHelperPython` chooses a rung from what the
 * caller found on disk (it is given paths and booleans and reads nothing);
 * `helperLaunch` says how to start that choice, so every caller (the service,
 * the install's self-test, the tests) starts it the same way.
 *
 * The order:
 *
 * - **Development and tests** (`packaged: false`): `FORGE_PYTHON`, then
 *   `sidecar/.venv`, then the dev pack (`userData/python-dev/`), then
 *   `python` on win32 / `python3` elsewhere. The pack comes AFTER the venv so
 *   `npm run dev` never quietly runs a pack; tests reach the pack rung
 *   explicitly (§3a.6).
 * - **A packaged app**: the pack, then `FORGE_PYTHON` (the escape hatch for a
 *   machine that cannot download the pack, as `FORGE_YTDLP` is for yt-dlp),
 *   then `absent`. **Never a PATH Python**: that is what made a packaged app
 *   run a bare `python3` (the Command Line Tools prompt on the Mac) or the
 *   Store stub (9009 on Windows) for every tester before they installed
 *   anything.
 *
 * **A receipt is never ignored silently.** Where the pack rung stands, a
 * `pack.json` that does not parse, or one that matches this build but whose
 * interpreter file is gone (Defender quarantined `python.exe`, or a delete
 * stopped part-way), is `damaged`, and it wins over every LATER rung: nothing
 * is spawned, and the row offers Repair rather than a 205 MB Install over
 * 0.7 GB already on disk. So in a packaged app a damaged pack beats
 * `FORGE_PYTHON` too: someone who set `FORGE_PYTHON` and also installed a
 * pack is told the pack is broken, not handed their own interpreter while it
 * rots. In development the venv and `FORGE_PYTHON` come before the pack
 * rung, so a damaged dev pack never blocks them; it does block the PATH
 * fallback after it.
 *
 * A receipt that parses but does NOT match (another platform, or another
 * pair of hashes: a release changed the lock) is not a pack and not damaged:
 * the order falls through, and the row reads it as Update (§16.46 (a)).
 *
 * On a machine `packPlatform` calls unsupported the pack rung is skipped
 * whole, the damaged check with it: no pack can match there, and Repair could
 * not run there either, so the row's "Not available on this computer" is the
 * answer rather than a red damaged row whose only button cannot work.
 *
 * The words the user can read here say "the AI helper", never the code's name
 * for the Python process.
 */

import {
  isUnsupported,
  parseReceipt,
  receiptMatches,
  type HelperPackManifest,
  type PackPlatform,
  type PlatformUnsupported
} from './pack'

/** Which rung answered: what the Settings row names (`helperSourceLabel`). */
export type HelperSource =
  | { kind: 'pack'; pack: number; root: string }
  | { kind: 'env'; python: string }
  | { kind: 'venv'; python: string }
  | { kind: 'path'; python: 'python' | 'python3' }

export type HelperChoice =
  /** FORGE_PYTHON: first in development, the escape hatch after the pack in a packaged app. */
  | { kind: 'env'; python: string }
  /** The pack the app installed (or the dev pack under `python-dev/`). */
  | { kind: 'pack'; python: string; pack: number; root: string }
  /** `sidecar/.venv`: development only. */
  | { kind: 'venv'; python: string }
  /** A bare `python` / `python3` on PATH: development only. */
  | { kind: 'path'; python: 'python' | 'python3' }
  /** A receipt that does not parse, or one that matches but whose interpreter is gone: nothing is spawned. */
  | { kind: 'damaged'; reason: string }
  /** A packaged app with nothing to run: nothing is spawned. */
  | { kind: 'absent' }

/** The damaged row's reason when the receipt matches and its interpreter file is gone (§3a.2, §3a.4). */
export const HELPER_PYTHON_MISSING = "Python is missing from the AI helper's folder (removed by antivirus?)"

/** The damaged row's reason when `pack.json` is there and is not a receipt. */
export const HELPER_RECEIPT_UNREADABLE = "The AI helper's install record (pack.json) cannot be read"

/**
 * What the reader passes as `receipt` when `pack.json` is there but its text
 * is not JSON (a torn write, an editor's BOM, a file a scanner truncated).
 *
 * The rule itself is wider than the sentinel: ANY value `parseReceipt`
 * refuses is a receipt that does not parse, so `null` from a `"null"` file,
 * a bare string, or `{}` are damaged too. A `pack.json` that exists but
 * cannot be read at all (`EACCES`, `EBUSY`) is the caller's to pass as this
 * sentinel as well: it is there, and it is not a receipt anyone can read.
 * Only a missing `pack.json` (ENOENT) is `pack: null`.
 */
export const UNPARSEABLE_RECEIPT: Readonly<{ unparseable: true }> = Object.freeze({ unparseable: true })

/** `pack.json`'s text as the `receipt` value: the parsed JSON, or `UNPARSEABLE_RECEIPT`. */
export function receiptFromText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return UNPARSEABLE_RECEIPT
  }
}

export interface HelperPythonInput {
  packaged: boolean
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  /** The venv's interpreter if that file exists, else null. Development only; ignored when packaged. */
  venvPython: string | null
  /**
   * null when there is no `pack.json` in the version folder at all.
   * - `receipt`: the parsed JSON (`receiptFromText`), or `UNPARSEABLE_RECEIPT`;
   * - `interpreterExists`: whether `python` is a file on disk;
   * - `python`: the interpreter's absolute path (the version folder joined to
   *   the manifest's `python` for this platform);
   * - `root`: the version folder (`<userData>/python/<pack>/`), passed through
   *   to the choice unchanged.
   */
  pack: { receipt: unknown; interpreterExists: boolean; python: string; root: string } | null
  manifest: HelperPackManifest
  packPlatform: PackPlatform | PlatformUnsupported
}

export function resolveHelperPython(input: HelperPythonInput): HelperChoice {
  const forgePython = envValue(input.env, 'FORGE_PYTHON', input.platform)
  const pack = packRung(input)

  if (!input.packaged) {
    if (forgePython) return { kind: 'env', python: forgePython }
    if (input.venvPython) return { kind: 'venv', python: input.venvPython }
    if (pack) return pack
    return { kind: 'path', python: input.platform === 'win32' ? 'python' : 'python3' }
  }

  // Packaged: the pack (or its damaged receipt), then the escape hatch, then
  // nothing. No PATH rung here, ever.
  if (pack) return pack
  if (forgePython) return { kind: 'env', python: forgePython }
  return { kind: 'absent' }
}

/**
 * The pack rung on its own: a pack, a damaged receipt, or null (no receipt,
 * a receipt for another platform or pair of hashes, or an unsupported
 * machine), where the order falls through.
 */
function packRung(input: HelperPythonInput): Extract<HelperChoice, { kind: 'pack' | 'damaged' }> | null {
  if (!input.pack || isUnsupported(input.packPlatform)) return null
  const receipt = parseReceipt(input.pack.receipt)
  if (!receipt) return { kind: 'damaged', reason: HELPER_RECEIPT_UNREADABLE }
  if (!receiptMatches(receipt, input.manifest, input.packPlatform)) return null
  if (!input.pack.interpreterExists) return { kind: 'damaged', reason: HELPER_PYTHON_MISSING }
  // The receipt's number, not the manifest's: the row names what is on disk.
  // receiptMatches compares the hashes, never the number (pack.ts).
  return { kind: 'pack', python: input.pack.python, pack: receipt.pack, root: input.pack.root }
}

/**
 * A variable by name. On win32 the lookup ignores case: `process.env` there
 * already does, but a copy of it (`{ ...process.env }`) does not, and a
 * `setx forge_python …` is the same variable to Windows.
 */
function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  const exact = env[name]
  if (exact || platform !== 'win32') return exact || undefined
  const upper = name.toUpperCase()
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === upper && env[key]) return env[key]
  }
  return undefined
}

// ---------------------------------------------------------------------------
// The launch
// ---------------------------------------------------------------------------

export interface HelperLaunch {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  source: HelperSource
}

export interface HelperLaunchOptions {
  packaged: boolean
  platform: NodeJS.Platform
  base: NodeJS.ProcessEnv
  modelsDir: string
  cacheDir: string
}

/** The module every rung runs. Always the last two arguments: anything after `-m <module>` is the module's own argv. */
const MODULE = ['-m', 'forge_sidecar'] as const

/**
 * The pack's flags, in front of `-m forge_sidecar`:
 *
 * - `-E` ignores every `PYTHON*` variable and, on Windows, skips the
 *   registry's `PythonCore\<winver>\PythonPath` subkeys, which CPython 3.14's
 *   getpath.py puts ahead of the stdlib whenever the environment is used, and
 *   which any python.org 3.14 shares;
 * - `-s` skips the user site (`pip --user` packages);
 * - `-u` replaces `PYTHONUNBUFFERED` (responses would sit in stdout's buffer);
 * - `-B` replaces `PYTHONDONTWRITEBYTECODE`: the helper's own code runs from
 *   inside the app bundle, which ships no `.pyc`.
 *
 * NEVER `-I`: it implies `-P`, which drops the working directory from
 * `sys.path`, and `-m forge_sidecar` started from `cwd` = the helper's folder
 * would no longer import.
 */
export const PACK_FLAGS = ['-E', '-s', '-u', '-B'] as const

/** The two Hugging Face switches the app always sets (client.ts's comment says why). */
const APP_HF = { HF_HUB_DISABLE_XET: '1', HF_HUB_DISABLE_TELEMETRY: '1' } as const

/**
 * How to start a choice: `null` for `absent` and `damaged`, which spawn
 * nothing anywhere.
 *
 * - **The pack, in either mode**: `<python> -E -s -u -B -m forge_sidecar`
 *   with `cleanHelperEnv(base)` and the app's own four variables. In
 *   development too: tests that reach the pack rung (§3a.6's
 *   `FORGE_HELPER_PACK`) must run it as an installed user gets it, or CI
 *   certifies an environment nobody gets. No `PYTHONUNBUFFERED` or
 *   `PYTHONIOENCODING` here: `-E` ignores both, `-u` replaces the first, and
 *   the helper's own stdio reconfigure replaces the second.
 * - **`FORGE_PYTHON` in a packaged app**: someone's own interpreter. `-B` and
 *   the `HF_*` clean-up (a user's `HF_ENDPOINT` would send every model press
 *   elsewhere, `HF_HUB_OFFLINE` fail it, `HF_TOKEN` travel with it); its
 *   `PYTHON*` are kept, then the full set every other rung gets.
 * - **Every other rung in development, and the venv or PATH anywhere**:
 *   exactly the launch client.ts has always made: `-m forge_sidecar` and
 *   `plainHelperEnv`.
 */
export function helperLaunch(choice: HelperChoice, o: HelperLaunchOptions): HelperLaunch | null {
  switch (choice.kind) {
    case 'absent':
    case 'damaged':
      return null
    case 'pack':
      return {
        command: choice.python,
        args: [...PACK_FLAGS, ...MODULE],
        env: withAppKeys(cleanHelperEnv(o.base, o.platform), appFolders(o), o.platform),
        source: { kind: 'pack', pack: choice.pack, root: choice.root }
      }
    case 'env':
      if (o.packaged) {
        return {
          command: choice.python,
          args: ['-B', ...MODULE],
          env: withAppKeys(
            dropKeys(o.base, HF_ONLY, o.platform),
            { PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', ...appFolders(o) },
            o.platform
          ),
          source: { kind: 'env', python: choice.python }
        }
      }
      return plainLaunch(choice.python, o, { kind: 'env', python: choice.python })
    case 'venv':
      return plainLaunch(choice.python, o, { kind: 'venv', python: choice.python })
    case 'path':
      return plainLaunch(choice.python, o, { kind: 'path', python: choice.python })
  }
}

function plainLaunch(python: string, o: HelperLaunchOptions, source: HelperSource): HelperLaunch {
  return { command: python, args: [...MODULE], env: plainHelperEnv(o.base, o), source }
}

/**
 * The environment every rung but the pack (and the packaged escape hatch) is
 * started with: client.ts's `sidecarEnv` (lines 39-53 when this was written),
 * key for key. The parent's environment, PYTHON* and HF_* included, then the
 * six the app sets; a folder that is empty is left to the parent's.
 */
export function plainHelperEnv(
  base: NodeJS.ProcessEnv,
  o: { modelsDir?: string; cacheDir?: string }
): NodeJS.ProcessEnv {
  return {
    ...base,
    // Unbuffered, or responses sit in Python's stdout buffer until it fills.
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    ...(o.modelsDir ? { FORGE_MODELS_DIR: o.modelsDir } : {}),
    ...(o.cacheDir ? { FORGE_CACHE_DIR: o.cacheDir } : {}),
    // Hugging Face's Xet backend talks to a separate CDN host that
    // restricted networks and corporate proxies routinely block. The plain
    // HTTP path is slower but works everywhere.
    ...APP_HF
  }
}

const PYTHON_OR_HF = /^(PYTHON|HF_)/
const HF_ONLY = /^HF_/

/**
 * The parent's environment with every `PYTHON*` and `HF_*` variable dropped,
 * for the pack: `-E` keeps them from the helper itself, but its children (the
 * face worker, started as `sys.executable …`, and anything they start) read
 * the environment they are handed.
 *
 * Case-insensitively on win32: Windows' names are case-insensitive, so a
 * `PythonPath` typed that way in System Properties IS `PYTHONPATH` to the
 * child, and survives `delete env.PYTHONPATH` on a copy of the environment.
 * Elsewhere the names are case-sensitive and Python and huggingface_hub read
 * the upper-case ones only, so exactly those are dropped and a `PythonPath`
 * there (nobody's variable) is left alone.
 */
export function cleanHelperEnv(base: NodeJS.ProcessEnv, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  return dropKeys(base, PYTHON_OR_HF, platform)
}

function dropKeys(base: NodeJS.ProcessEnv, pattern: RegExp, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  const test = platform === 'win32' ? new RegExp(pattern.source, 'i') : pattern
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(base)) {
    if (!test.test(key)) out[key] = value
  }
  return out
}

/**
 * The app's own variables over `env`. On win32 any other spelling of a name
 * being set goes first, so the child sees one `FORGE_MODELS_DIR`, the app's,
 * whatever Node's sort of duplicate names would have picked.
 */
function withAppKeys(
  env: NodeJS.ProcessEnv,
  own: Record<string, string>,
  platform: NodeJS.Platform
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env }
  const all: Record<string, string> = { ...own, ...APP_HF }
  if (platform === 'win32') {
    const names = new Set(Object.keys(all).map((k) => k.toUpperCase()))
    for (const key of Object.keys(out)) if (names.has(key.toUpperCase())) delete out[key]
  }
  return Object.assign(out, all)
}

function appFolders(o: { modelsDir: string; cacheDir: string }): Record<string, string> {
  return {
    ...(o.modelsDir ? { FORGE_MODELS_DIR: o.modelsDir } : {}),
    ...(o.cacheDir ? { FORGE_CACHE_DIR: o.cacheDir } : {})
  }
}

/**
 * The words the Settings row uses for the rung (the row itself is a later
 * slice's; on screen the process is "the AI helper").
 */
export function helperSourceLabel(source: HelperSource): string {
  switch (source.kind) {
    case 'pack':
      return `installed by the app · pack ${source.pack}`
    case 'env':
      return `from FORGE_PYTHON ${source.python}`
    case 'venv':
      return 'development venv'
    case 'path':
      return `${source.python} on PATH`
  }
}
