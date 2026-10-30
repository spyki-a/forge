# Packaging — turning this into something you can install

Until this existed the app worked and could not be installed, which for a
desktop tool is the same as not existing. Everything else on the roadmap is
features; this was the gate.

**Status:** working. `electron-builder.yml` is the whole config;
`.github/workflows/ci.yml` builds an installer on each platform and uploads it
as an artifact.

**A CI-built Windows installer has been installed and run successfully** — so
the asar unpack, the bundled ffmpeg, the sidecar's placement and the first-run
path are all confirmed on a real machine rather than inferred from a green
tick. The only known gap is the asset library, below.

---

## The rule that decides everything: each platform builds itself

`@ffmpeg-installer` ships its binary as an **optional dependency per
platform**:

```
@ffmpeg-installer/darwin-arm64    @ffmpeg-installer/win32-x64    …
```

`npm ci` installs only the one matching the machine it runs on. So on this Mac,
`node_modules/@ffmpeg-installer/` contains `darwin-arm64` and nothing else —
and **`npm run pack:win` from macOS produces a Windows installer with no ffmpeg
in it at all**. The app installs, starts, and greets the user with
`assertBinaries()`'s error dialog, on a machine nobody can debug from here.

That is why the packaging job is a matrix, not a cross-compile. The Windows
installer is built on `windows-latest`, the macOS one on `macos-latest`. It also
means **you cannot produce a Windows installer from the Mac** — get it from the
CI artifact, or build it on the Surface itself.

---

## What has to land where, and why

Three paths in `src/main` only resolve correctly because the config puts
something there. None of them can fail in development — `app.isPackaged` is
false and every one takes the other branch — so a mistake here is invisible
until someone installs the result. `tests/packaging.test.ts` pins all three.

| code | expects | config |
|---|---|---|
| `ffmpeg/paths.ts` `resolveBinary()` | `app.asar.unpacked/node_modules/@ffmpeg-installer/…` | `asarUnpack` |
| `assets/scan.ts` `assetsRoot()` | `process.resourcesPath/assets` | `extraResources` |
| `sidecar/service.ts` `sidecarDir()` | `process.resourcesPath/sidecar` | `extraResources` |

**Nothing can be executed from inside an asar archive**, and Python cannot
import from one either. That single fact is the reason for both mechanisms.

### What is deliberately left out

**The installer ships no Python.** The AI helper's Python is a pack the app
installs itself, into `userData/python/<pack>/`, when the user presses
**Install the AI helper** in Settings (below, and `docs/CLIPS.md` §3a).

- **Every `sidecar/.venv*`**, by `!.venv*` and `!.venv*/**` in the sidecar
  filter (both: electron-builder adds no implied `/**` to a pattern with a
  dot, app-builder-lib `fileMatcher.js`, so the folder alone would let its
  contents through). `sidecar/.venv` is development's interpreter, 598 MB
  by `du -sh` on 2026-10-14 (this said 542 MB), built for one interpreter on
  one platform; `.venv-faces` is the face finder's measurement venv, 108 MB;
  any other is a measurement venv too. Until 2026-10-16 the filter named
  `.venv` and `.venv-faces`, so the next measurement venv beside them would
  have shipped.
- **`sidecar/.claude/` and every `.DS_Store`**, by `!.claude`, `!.claude/**`
  and `!**/.DS_Store` (since 2026-10-16, `a943cd3`; they shipped before).
- **`sidecar/:memory:.ses`** — a colon is illegal in a Windows filename, so an
  installer carrying this would fail to extract on the platform it is aimed at.
  It is gitignored, which is not the same as unpackaged.
- **`__pycache__`, `.pyc`** — noise, and compiled for whatever interpreter
  happened to be here.

`tests/packaging.test.ts` judges the filter through app-builder-lib's own
`getFileMatchers`, so a `.venv-stems` nobody has made yet is refused too.

**What does ship in `resources/sidecar`:** `forge_sidecar/` (the helper, its
stubs, and `selftest/identity.onnx`, the self-test's 80 B model);
`pack/` (`lock-darwin-arm64.txt`, `lock-win32-x64.txt`, `resolved.json`,
`history.json`: the locks the install checks every wheel against, their
sha256 in the manifest); `requirements*.txt`, no longer "so the setup step
is available" but for `FORGE_PYTHON`, the escape hatch on a machine that
cannot download the pack (`docs/SIDECAR.md`); and `scripts/`.

### The AI helper's pack, and the uninstaller

The pack is about 0.7 GB on disk (pack 2: 166 MB to download on the Mac,
201 MB on Windows), under userData, so it outlives the app's own files.

- **On Windows the NSIS uninstaller removes it.** `build/installer.nsh`,
  included through `nsis.include`, defines `customUnInstall`, which
  electron-builder inserts at the start of its uninstall section, before the
  files go. Its whole body sits inside `${ifNot} ${isUpdated}`: an app update
  runs the OLD version's uninstaller silently (`/S /KEEP_APP_DATA
  --updated`), and the guard, spelled as electron-builder's own app-data
  guard is, keeps the pack through it. Inside: the shell context set to the
  current user for a per-machine install, then `RMDir /r
  "$APPDATA\${PRODUCT_NAME}\python"`, and the same under
  `${APP_PACKAGE_NAME}` when that name differs. Electron names userData
  after the packaged `package.json`'s name (`forge`, no `productName`), which
  on NTFS is the same folder as `Forge`; the second line covers a later
  rename of `productName` (R7's name) without a package rename. **Never the
  models, the projects, the settings or userData itself**;
  `deleteAppDataOnUninstall` stays unset. `tests/packaging.test.ts` pins the
  include, one macro, the guard as its first and last lines, every `RMDir`
  inside it ending in `\python`, every line one of seven kinds, and the file
  the macro alone.
- **Unmeasured:** `makensis` has never compiled the macro (it comes with the
  package job, which runs only by hand or on a tag), and the guard has never
  run through a real update. Run the workflow by hand once before the
  Surface's update run (`docs/CLIPS.md` §3a.9): install, update from the
  next installer (the pack must still be there), then uninstall
  (`%APPDATA%\Forge\python` must be gone, `models` kept).
- **On the Mac there is no uninstaller**: the guide says Settings → AI helper
  → Remove before dragging the app to the bin.

### The asset library is NOT in a CI-built installer

`assets/` is gitignored — `docs/ASSETS.md` §"Open decision" explains why, and
the decision is still open — but for four tracked files under `assets/fonts/`
since 2026-10-29 (`6bc8b07`, `docs/CLIPS.md` §6.20): Noto Sans Devanagari and
Noto Sans Telugu, Regular, each with its OFL text beside it, the faces the
canvas painter names for Hindi and Telugu. A CI checkout therefore has no
asset library, only those four files, and **electron-builder treats a missing
`extraResources` source as nothing to copy rather than as an error.** The
installer builds, installs, starts and works, with a Library holding only the
two Noto faces (the Shelf's Library tile, which opens the pack list by itself
when nothing but those two is there, `9a0f232`) and nothing anywhere saying
why.

Verified by unpacking the real artifact (before `6bc8b07`): `ffmpeg.exe`,
`ffprobe.exe`, sharp's native binding, the sidecar and its `requirements*.txt`
were all present and correct; `resources/assets/` was absent entirely. Since
`6bc8b07` a CI installer carries `resources/assets/fonts` with the four files,
so `assetsRoot()` exists on a pack-free install; an installer built since has
not been unpacked to confirm it.

This is now reported in the packaging job — a warning before the pack, and a
listing of what landed after it. The warning tests the library itself,
`assets/sfxx`, not a non-empty `assets/`, and says the installer will carry
only the two Noto faces and no other fonts, SFX, transitions, titles or props
(`.github/workflows/ci.yml:386-393`, since `6bc8b07`). It does not fail the
build, because an installer without the asset pack is still worth having:
everything except the Library works, and `scanAssets` was written to degrade
to an empty catalog rather than to fail.

**The three options are in `docs/ASSETS.md`, which already prefers shipping the
assets as a separate first-run download** — the same shape as the models and as
yt-dlp. Until that is built, a CI installer has no library.

### What is not solved

- **Neither build is signed.** macOS will refuse to open the DMG without
  right-click → Open, and Windows SmartScreen will warn on first run. Signing
  needs a paid Apple Developer ID and a Windows code-signing certificate; both
  are a decision, not a config change.
- **`yt-dlp` is not bundled** and should not be — it is fetched on first use
  into `userData` and can be refreshed without shipping anything. See
  `docs/INGEST.md`.
- **The name is a placeholder.** `productName: Forge` and
  `appId: in.syncpod.forge` are in `electron-builder.yml`; changing them is a
  two-line edit, and it is much cheaper to do before installers exist in the
  wild than after.
- **The icon is a placeholder** — `build/icon.png`, a shutter aperture in the
  app's own accent colour. Replace the file; nothing references it by content.

---

## Getting an installer

**From CI**, which is the supported route:

1. Run the workflow by hand (Actions → CI → Run workflow) or push a `v*`
   tag: the `installer` job runs only then, not on every push. It runs after
   the test matrix is green on both platforms (Windows and `macos-14`, which
   since 2026-10-16 run on every push and install the AI helper's pack) — an
   installer built from a red commit is a thing someone will install.
2. Open the run on GitHub → Artifacts → `forge-windows-latest`.
3. Unzip, run the `.exe`.

**On the Surface itself**, if you want one without waiting — but read
`CLAUDE.md`'s "A fresh Windows checkout" first, because `npm ci` there exits 0,
reports no vulnerabilities, and is not finished:

```
npm ci
node node_modules/electron/install.js
npm run pack:win
```

The middle line is not optional and not one-time. On Windows, `npm ci` can
leave `node_modules/electron/dist` empty — npm 11's allow-scripts gate withholds
electron's postinstall, and its warning names `electron-winstaller` and
`esbuild` but never `electron`. It recurs on every `npm ci`. `install.js`
short-circuits when the binary is present, so running it always costs nothing.
CI does exactly this, and fails loudly if the binary still is not there.

The installer lands in `dist/`.

---

## The first run on a clean machine

A machine that has never had a developer tool on it is a test you get **once**,
and it is the only place several things can fail. In order, and what each
answers:

1. **It starts at all.** Rules out a missing Visual C++ runtime, a broken asar
   unpack, and a wrong-architecture binary.
2. **No error dialog.** `assertBinaries()` runs at startup; if ffmpeg did not
   make it into the package, this is where it says so.
3. **The Library tile (on the Shelf) holds only the two Noto faces under
   Fonts and opens the pack list by itself, and that is expected** for a
   CI-built installer — the asset library is gitignored and not in the
   package; only `assets/fonts`'s four tracked files are (since `6bc8b07`,
   2026-10-29). What this step actually proves is that a near-empty catalog
   degrades rather than crashes. A full library needs the first-run asset
   download, which is unbuilt.
4. **Import a photo and export three seconds.** The whole media pipeline, in
   one go.
5. **Paste a YouTube link.** The first download fetches yt-dlp (~30MB) — this
   is where a missing runtime or a blocked network shows itself, and where the
   fetch's checksum verification either works or says why not.
6. **The AI helper says "Not installed", grey, not "failed".** With no Python
   anywhere the app must still be completely usable; anything else is a bug.
   Settings → AI helper (Python) reads **Not installed** with **Install the AI
   helper · 166 MB** (201 MB on Windows; the size comes from the offer, so it
   follows the pack) and the hosts it downloads from under it, and every
   Python control elsewhere says "needs the AI helper", a pointer back to that
   row. A packaged app never starts a Python from PATH, so no dialog appears.
7. **Press Install.** Its bar and its X are in EXPORT; then the row reads
   "Running · Python 3.14.8 · pack 2 · 636 MB" (685 MB on Windows), green.
   On Windows a missing Visual C++ runtime shows as "N of 9 helper features ·
   … needs Microsoft's Visual C++ runtime", with the link and **Check
   again**. `docs/CLIPS.md` §3a.9 is this run in full.
8. **Uninstall (Windows).** `%APPDATA%\Forge\python` is gone afterwards and
   `models` is kept; after an app update instead, the pack is still there
   (the `isUpdated` guard, unmeasured until this run).
