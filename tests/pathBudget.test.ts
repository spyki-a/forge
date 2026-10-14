import { describe, expect, it } from 'vitest'
import { checkPathBudget, PYC_TEMP_SUFFIX, WIN_MAX_DIR_PATH, WIN_MAX_FILE_PATH } from '@shared/sidecar/pathBudget'

/*
 * The AI helper's path budget on Windows (docs/CLIPS.md §3a.2): root +
 * longestPath + 16 ≤ 259 and root + longestDir ≤ 247, where "root" is the
 * version folder with its separator — the plan's 76-character root,
 * `C:\Users\<10>\AppData\Roaming\Forge\python\1\python\Lib\site-packages\`,
 * counts its trailing backslash. Each bound is pinned at its edge, on its own.
 */

// 50 characters, and 51 with the separator every path under it starts with.
const ROOT = 'C:\\Users\\abcdefghij\\AppData\\Roaming\\Forge\\python\\1'
const BASE = ROOT.length + 1

it('the root is the 50 characters the arithmetic below assumes', () => expect(ROOT).toHaveLength(50))

describe('the file bound: root + longestPath + 16 ≤ 259', () => {
  it('exactly 259 fits; 260 is refused, naming the folder and the count', () => {
    const fits = WIN_MAX_FILE_PATH - PYC_TEMP_SUFFIX - BASE
    expect(checkPathBudget({ root: ROOT, longestPath: fits, longestDir: 10, platform: 'win32' })).toBeNull()
    const sentence = checkPathBudget({ root: ROOT, longestPath: fits + 1, longestDir: 10, platform: 'win32' })
    expect(sentence).toContain(`The AI helper does not fit under ${ROOT}`)
    expect(sentence).toContain('a path of 260 characters')
    expect(sentence).toContain('Windows allows 259')
    expect(sentence).toContain('FORGE_PYTHON')
  })

  it('the 16 is pip’s temporary name: a path of 259 without it is refused', () => {
    // 259 as the final file, 275 while py_compile writes it.
    expect(checkPathBudget({ root: ROOT, longestPath: WIN_MAX_FILE_PATH - BASE, longestDir: 10, platform: 'win32' })).toContain('a path of 275 characters')
  })

  it('a trailing separator on the root changes nothing', () => {
    const fits = WIN_MAX_FILE_PATH - PYC_TEMP_SUFFIX - BASE
    expect(checkPathBudget({ root: `${ROOT}\\`, longestPath: fits, longestDir: 10, platform: 'win32' })).toBeNull()
    expect(checkPathBudget({ root: `${ROOT}\\`, longestPath: fits + 1, longestDir: 10, platform: 'win32' })).not.toBeNull()
  })

  it('the plan’s arithmetic: 125 + 16 under a 76-character root is 217 of 259', () => {
    // 76 with its separator: the root here is the site-packages folder, the .pyc relative to it.
    const sitePackages = 'C:\\Users\\abcdefghij\\AppData\\Roaming\\Forge\\python\\1\\python\\Lib\\site-packages'
    expect(sitePackages.length + 1).toBe(76)
    expect(checkPathBudget({ root: sitePackages, longestPath: 125, longestDir: 71, platform: 'win32' })).toBeNull()
  })
})

describe('the folder bound: root + longestDir ≤ 247', () => {
  it('exactly 247 fits; 248 is refused, with the file bound well inside', () => {
    const fits = WIN_MAX_DIR_PATH - BASE
    expect(checkPathBudget({ root: ROOT, longestPath: 50, longestDir: fits, platform: 'win32' })).toBeNull()
    const sentence = checkPathBudget({ root: ROOT, longestPath: 50, longestDir: fits + 1, platform: 'win32' })
    expect(sentence).toContain(`The AI helper does not fit under ${ROOT}`)
    expect(sentence).toContain('its deepest folder would make a path of 248 characters')
    expect(sentence).toContain('Windows allows 247 for a folder')
  })
})

describe('off Windows', () => {
  it('a POSIX root never refuses, however deep', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(checkPathBudget({ root: `/Users/${'x'.repeat(400)}/python/1`, longestPath: 5_000, longestDir: 5_000, platform })).toBeNull()
    }
  })
})
