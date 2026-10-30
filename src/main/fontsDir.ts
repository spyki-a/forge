import { join } from 'node:path'
import { app } from 'electron'

/**
 * Where libass looks for the fonts a style names, and where the app's own
 * faces live.
 *
 * `FORGE_FONTS_DIR` first (the tests, which have no `app.getAppPath`), then the
 * packaged app's `resources/assets/fonts` or the development checkout's
 * `assets/fonts`. It is the APP's folder whether or not an asset pack is
 * installed: the catalogue scans the pack root once one is (`assetsRoot()`),
 * libass does not. Electron's `app` is read inside the call, never at import.
 *
 * Moved here from `captions.ts`, unchanged, so the scan can name the same
 * folder (docs/CLIPS.md §6.20).
 */
export function fontsDir(): string | undefined {
  const override = process.env.FORGE_FONTS_DIR
  if (override) return override
  const bundled = app.isPackaged
    ? join(process.resourcesPath, 'assets', 'fonts')
    : join(app.getAppPath(), 'assets', 'fonts')
  return bundled
}
