import { describe, expect, it } from 'vitest'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { APP_FONT_FILES } from '@shared/assets/catalog'

/*
 * The app's own faces are files in the repository, not only names in a list
 * (docs/CLIPS.md §6.20, D10).
 *
 * APP_FONT_FILES names what the scan lists from the app's folder and what the
 * Library leaves out of "empty"; .gitignore's four negations are what put the
 * files in that folder on a clean checkout. Every other case builds its own
 * temporary folders, so a renamed face, or a negation with a typo that leaves
 * one untracked, would pass the suite — and on CI's libass, and on a machine
 * with a pack, the face would quietly be missing. On CI the folder holds only
 * what git tracks, so a file missing there is a file not committed.
 *
 * Membership of each name, not a snapshot of the folder: the Mac's
 * assets/fonts also holds the library's 88 fonts.
 */
const APP_FONTS_DIR = resolve(__dirname, '../assets/fonts')

describe("the app's own faces are committed beside their licences", () => {
  it.each([...APP_FONT_FILES])('%s is a file in assets/fonts, with its OFL text beside it', (name) => {
    const face = resolve(APP_FONTS_DIR, name)
    expect(existsSync(face) && statSync(face).isFile(), `${name} is not in assets/fonts`).toBe(true)
    // R6: a licence file beside every family — OFL-<family stem>.txt.
    const stem = name.replace(/-[A-Za-z]+\.(ttf|otf)$/i, '')
    expect(stem, `${name} has no family stem`).not.toBe(name)
    const licence = resolve(APP_FONTS_DIR, `OFL-${stem}.txt`)
    expect(existsSync(licence) && statSync(licence).isFile(), `OFL-${stem}.txt is not beside ${name}`).toBe(true)
  })
})
