/**
 * The AI helper's path budget on Windows (docs/CLIPS.md §3a.2, "The path
 * budget on Windows"; checked in §3a.3 stage 0 and again by the unpacker
 * before its first write).
 *
 * MAX_PATH's 260 includes the terminating NUL, so a file path can be at most
 * 259 characters and a folder at most 247 (`CreateDirectoryW`'s MAX_PATH − 12).
 * pip compiles each `.py` through `py_compile`, whose `_write_atomic` writes
 * `f'{path}.{id(path)}'` first: up to 16 characters past the final `.pyc` (a
 * dot and up to 15 digits). Node writes past MAX_PATH (it prefixes `\\?\`);
 * pip and Python cannot without the administrator-only `LongPathsEnabled`, so
 * an unpack that ignored the budget would succeed and the failure come later,
 * in pip, as a file it cannot write.
 *
 * Pure: the lengths are the manifest's (`longestPath`, `longestDir`, relative
 * to the version folder), measured by CI's install (§3a.8 row 28). Characters
 * are UTF-16 code units, as Windows counts them and as `String.length` does.
 */

/** The longest file path Windows' MAX_PATH allows: 260 with its NUL. */
export const WIN_MAX_FILE_PATH = 259
/** The longest folder path: `CreateDirectoryW`'s MAX_PATH − 12. */
export const WIN_MAX_DIR_PATH = 247
/** `py_compile`'s temporary name past the final `.pyc`: a dot and up to 15 digits of `id(path)`. */
export const PYC_TEMP_SUFFIX = 16

export interface PathBudgetInput {
  /** The version folder the pack goes into (`…\python\1`), with or without a trailing separator. */
  root: string
  /** The longest relative file path under it, in characters. */
  longestPath: number
  /** The longest relative folder path under it, in characters. */
  longestDir: number
  platform: NodeJS.Platform
}

/** The root and exactly one separator: what every path under it starts with. */
function rootLength(root: string): number {
  return root.replace(/[\\/]+$/, '').length + 1
}

/**
 * Null when the pack fits under `root`; otherwise the sentence for the row and
 * the job, naming the folder and the arithmetic. Never refuses off Windows.
 */
export function checkPathBudget(input: PathBudgetInput): string | null {
  if (input.platform !== 'win32') return null
  const base = rootLength(input.root)
  const file = base + input.longestPath + PYC_TEMP_SUFFIX
  if (file > WIN_MAX_FILE_PATH) {
    return (
      `The AI helper does not fit under ${input.root}: its longest file would make a path of ${file} characters ` +
      `(pip's temporary name included), and Windows allows ${WIN_MAX_FILE_PATH}. ` +
      `Point FORGE_PYTHON at a Python with the helper's requirements instead.`
    )
  }
  const dir = base + input.longestDir
  if (dir > WIN_MAX_DIR_PATH) {
    return (
      `The AI helper does not fit under ${input.root}: its deepest folder would make a path of ${dir} characters, ` +
      `and Windows allows ${WIN_MAX_DIR_PATH} for a folder. ` +
      `Point FORGE_PYTHON at a Python with the helper's requirements instead.`
    )
  }
  return null
}
