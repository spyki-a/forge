import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, type Stats } from 'node:fs'
import { basename, join, resolve } from 'node:path'
// electron-builder's own matcher, so the filter is judged as the build judges it.
import { getFileMatchers } from 'app-builder-lib/out/fileMatcher'
// js-yaml ships no types and is used only here, so the shape is declared at
// the point of use rather than adding a dependency for one function.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error -- no bundled type declarations
import { load } from 'js-yaml'

/*
 * The packaging config has to agree with the code, and nothing else checks it.
 *
 * Three places in `src/main` resolve a path that only exists because
 * `electron-builder.yml` puts something there. None of them can fail in
 * development — `app.isPackaged` is false, so every one takes the other branch
 * — and none of them is exercised by any other test. The first sign of a
 * mismatch is a user's install: an error dialog, an empty asset library, or a
 * sidecar that never starts.
 *
 * So this reads the real config and asserts the coupling. It is a cheap test
 * for an expensive failure, and it is the only thing standing between "someone
 * tidied the builder config" and "the app is inert on a machine we cannot see".
 */

const ROOT = resolve(__dirname, '..')

interface BuilderConfig {
  appId?: string
  productName?: string
  files?: string[]
  asarUnpack?: string[]
  extraResources?: { from: string; to: string; filter?: string[] }[]
  win?: { target?: unknown }
  mac?: { target?: unknown; extendInfo?: Record<string, unknown> }
  nsis?: { oneClick?: boolean; include?: string; deleteAppDataOnUninstall?: boolean }
  directories?: { buildResources?: string }
  publish?: unknown
}

const config = load(readFileSync(resolve(ROOT, 'electron-builder.yml'), 'utf8')) as BuilderConfig
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))

describe('the packaged app can find its binaries', () => {
  it('unpacks both ffmpeg installers from the asar', () => {
    /*
     * `resolveBinary` in src/main/ffmpeg/paths.ts rewrites `app.asar` to
     * `app.asar.unpacked` for these two. Nothing can be EXECUTED from inside
     * an asar archive, so without the unpack rule `assertBinaries()` puts up
     * its dialog at startup and the app cannot process a single frame.
     */
    const unpack = (config.asarUnpack ?? []).join('\n')
    expect(unpack).toContain('@ffmpeg-installer')
    expect(unpack).toContain('@ffprobe-installer')
  })

  it('unpacks sharp, which has native bindings with the same problem', () => {
    const unpack = (config.asarUnpack ?? []).join('\n')
    expect(unpack).toContain('sharp')
  })

  it('keeps both installers as runtime dependencies', () => {
    // In devDependencies they would not be packaged at all, and the unpack
    // rule above would have nothing to unpack.
    expect(Object.keys(pkg.dependencies)).toContain('@ffmpeg-installer/ffmpeg')
    expect(Object.keys(pkg.dependencies)).toContain('@ffprobe-installer/ffprobe')
  })
})

describe('the packaged app can find its resources', () => {
  const resourceFor = (name: string): { from: string; to: string; filter?: string[] } | undefined =>
    (config.extraResources ?? []).find((r) => r.to === name)

  it('puts the asset library where scanAssets looks for it', () => {
    // assetsRoot() -> join(process.resourcesPath, 'assets')
    expect(resourceFor('assets')?.from).toBe('assets')
  })

  it('puts the sidecar beside the app, not inside the asar', () => {
    // sidecarDir() -> join(process.resourcesPath, 'sidecar'). Python cannot
    // import from inside an archive any more than ffmpeg can execute from one.
    expect(resourceFor('sidecar')?.from).toBe('sidecar')
  })

  it('leaves the virtualenv out — it is half a gigabyte and platform-specific', () => {
    const filter = (resourceFor('sidecar')?.filter ?? []).join('\n')
    expect(filter).toContain('!.venv')
    expect(filter).toMatch(/!.*__pycache__/)
  })

  it('leaves out every virtualenv in sidecar/, by electron-builder’s own matcher, and still ships what the helper needs', () => {
    /*
     * `toContain('!.venv')` above is a substring of the joined filter, so it
     * could never tell `.venv-faces` (108 MB, docs/CLIPS.md §4.3's measured
     * mediapipe venv) from `.venv`. And a list of names can only hold the
     * venvs somebody remembered (docs/CLIPS.md §3a.6: the filter became
     * `!.venv*`). So the config is read through app-builder-lib's
     * `getFileMatchers`, the function the build itself calls, and every
     * `.venv*` folder on this disk, the two named ones, and one nobody has
     * made yet are each refused: the folder, and a file deep inside it (a
     * pattern with a dot gets no implied `/**`, fileMatcher.js, so the folder
     * entry alone would let its contents through).
     */
    const sidecar = resolve(ROOT, 'sidecar')
    const matchers = getFileMatchers(config as never, 'extraResources', resolve(ROOT, 'resources-under-test'), {
      macroExpander: (pattern: string) => pattern,
      customBuildOptions: {} as never,
      globalOutDir: resolve(ROOT, 'dist'),
      defaultSrc: ROOT
    })
    const matcher = (matchers ?? []).filter((m) => basename(m.to) === 'sidecar')
    expect(matcher, 'one extraResources entry lands at sidecar/').toHaveLength(1)
    expect(matcher[0].from).toBe(sidecar)
    const ships = matcher[0].createFilter()
    const stat = (dir: boolean): Stats => ({ isDirectory: () => dir, isFile: () => !dir, isSymbolicLink: () => false }) as Stats

    const onDisk = readdirSync(sidecar, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('.venv'))
      .map((entry) => entry.name)
    for (const name of new Set(['.venv', '.venv-faces', '.venv-stems', ...onDisk])) {
      expect(ships(join(sidecar, name), stat(true)), `${name}/`).toBe(false)
      expect(ships(join(sidecar, name, 'lib', 'python3.14', 'site-packages', 'numpy', '__init__.py'), stat(false)), `a file inside ${name}`).toBe(false)
      expect(ships(join(sidecar, name, 'Scripts', 'python.exe'), stat(false)), `${name}'s python.exe`).toBe(false)
    }
    // Not a filter that drops everything: the helper's code, both locks, resolved.json and the self-test's model ship.
    for (const kept of [
      'forge_sidecar/__main__.py',
      'forge_sidecar/selftest/identity.onnx',
      'pack/lock-darwin-arm64.txt',
      'pack/lock-win32-x64.txt',
      'pack/resolved.json'
    ]) {
      const path = join(sidecar, ...kept.split('/'))
      expect(existsSync(path), `${kept} is on disk`).toBe(true)
      expect(ships(path, stat(false)), kept).toBe(true)
    }
    expect(ships(join(sidecar, 'forge_sidecar'), stat(true)), 'forge_sidecar/').toBe(true)
    // Nor what a coding session or the Finder leaves beside it: both were on this disk and in the installer.
    expect(ships(join(sidecar, '.claude'), stat(true)), '.claude/').toBe(false)
    expect(ships(join(sidecar, '.claude', '.cc-writes', 'x'), stat(false)), 'a file inside .claude').toBe(false)
    expect(ships(join(sidecar, '.DS_Store'), stat(false)), '.DS_Store').toBe(false)
    expect(ships(join(sidecar, 'forge_sidecar', 'capabilities', '.DS_Store'), stat(false)), 'a .DS_Store deeper in').toBe(false)
  })

  it('leaves out the filename Windows cannot extract', () => {
    /*
     * `sidecar/:memory:.ses` is still on disk here — a test was once handed
     * ':memory:' as a database path. A colon is illegal in a Windows filename,
     * so an installer carrying it would fail to extract on the one platform it
     * is aimed at. It is gitignored, which is NOT the same as unpackaged.
     */
    const filter = (resourceFor('sidecar')?.filter ?? []).join('\n')
    expect(filter).toMatch(/!.*:memory:/)
  })

  it('ships the requirements files, so the sidecar can be set up after install', () => {
    // They are not excluded by any filter. An installed app runs the helper on
    // the pack it installs (from sidecar/pack/'s locks, which the matcher test
    // above holds), or on FORGE_PYTHON, which a person sets up from these.
    const filter = (resourceFor('sidecar')?.filter ?? []).join('\n')
    expect(filter).not.toMatch(/!.*requirements/)
  })
})

describe('what the installer is', () => {
  it('builds an NSIS installer for Windows, not a portable exe', () => {
    // The app writes to userData — downloads, stems, the fetched yt-dlp — and
    // an installed app is the shape that has a sensible place for those.
    expect(JSON.stringify(config.win?.target)).toContain('nsis')
  })

  it('does not install with one click', () => {
    // A first install on a machine nobody has tested is exactly when someone
    // wants to see where it is going and be able to undo it.
    expect(config.nsis?.oneClick).toBe(false)
  })

  it('uninstalls the AI helper’s pack, and only the pack, and not on an update (docs/CLIPS.md §3a.6)', () => {
    /*
     * The pack is ~0.7 GB the app put in userData itself, and electron-builder
     * leaves userData on an uninstall. build/installer.nsh's customUnInstall
     * removes `$APPDATA\${PRODUCT_NAME}\python`, inside `${ifNot}
     * ${isUpdated}`: an update runs the old uninstaller silently with
     * --updated, and the pack must survive it. One ordered shape: the include
     * names the file; the macro is exactly one guard from its first line to
     * its last; every RMDir in the file is inside that guard and ends in
     * `\python` (never models, never userData itself). The guard's runtime
     * behaviour is unmeasured until the Surface's update run (§3a.9).
     */
    expect(config.nsis?.include).toBe('build/installer.nsh')
    expect(config.directories?.buildResources).toBe('build')
    // Unset: the models, the projects and the settings are the user's.
    expect(config.nsis?.deleteAppDataOnUninstall).toBeUndefined()
    const text = readFileSync(resolve(ROOT, config.nsis!.include!), 'utf8')
    // The script's lines without its comments (NSIS: `;` or `#` to the end of a line).
    const code = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith(';') && !line.startsWith('#'))

    expect([...text.matchAll(/^\s*!macro\s+customUnInstall\b/gim)], 'one customUnInstall').toHaveLength(1)
    const start = code.indexOf('!macro customUnInstall')
    const end = code.indexOf('!macroend', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const body = code.slice(start + 1, end)

    // The guard opens on the macro's first line and closes on its last, so nothing in it runs on an update.
    expect(body[0]).toBe('${ifNot} ${isUpdated}')
    let depth = 0
    let closes = -1
    body.forEach((line, i) => {
      if (/^\$\{(if|ifNot)\}/i.test(line)) depth++
      else if (/^\$\{endif\}$/i.test(line)) {
        depth--
        if (depth === 0 && closes < 0) closes = i
      }
    })
    expect(closes, 'the guard’s ${endif} is the macro’s last line').toBe(body.length - 1)

    // Every RMDir in the file, by matchAll: inside the guard, and only ever a `python` folder of userData.
    const removes = [...text.matchAll(/^\s*RMDir\b.*$/gim)].map((m) => m[0].trim())
    expect(removes.length).toBeGreaterThan(0)
    expect(removes).toContain('RMDir /r "$APPDATA\\${PRODUCT_NAME}\\python"')
    for (const line of removes) {
      expect(line).toMatch(/^RMDir \/r "\$APPDATA\\\$\{[A-Z_]+\}\\python"$/)
      expect(body.indexOf(line), `${line} is inside the guard`).toBeGreaterThan(0)
    }
    expect(code.join('\n')).not.toMatch(/models|projects/i)

    // Every line of the macro is one of these kinds, and nothing in the file stands outside it: a Delete, an
    // Exec or a RMDir of anything but a userData `python` folder fails here, not only an RMDir (a verifier's
    // mutation added `Delete "$APPDATA\${PRODUCT_NAME}\settings.json"` inside the guard and this test passed).
    const allowed = [
      /^\$\{ifNot\} \$\{isUpdated\}$/,
      /^\$\{if\} \$installMode == "all"$/,
      /^SetShellVarContext (current|all)$/,
      /^\$\{endif\}$/,
      /^RMDir \/r "\$APPDATA\\\$\{[A-Z_]+\}\\python"$/,
      /^!if "\$\{APP_PACKAGE_NAME\}" != "\$\{PRODUCT_NAME\}"$/,
      /^!endif$/
    ]
    expect(body.filter((line) => !allowed.some((re) => re.test(line))), 'lines of a kind the uninstaller has no business running').toEqual([])
    expect(code, 'the file is the macro and nothing else').toEqual(['!macro customUnInstall', ...body, '!macroend'])
  })

  it('publishes nothing as a side effect of building', () => {
    expect(config.publish).toBeNull()
  })

  it('names the app and its id', () => {
    expect(config.appId).toMatch(/^[a-z0-9.-]+$/)
    expect(config.productName).toBeTruthy()
  })

  it('points at the entry electron-vite actually writes', () => {
    expect(pkg.main).toBe('./out/main/index.js')
    expect((config.files ?? []).some((f) => f.startsWith('out'))).toBe(true)
  })

  it('has both pack scripts, because each platform must build itself', () => {
    /*
     * `@ffmpeg-installer` ships the binary as an OPTIONAL dependency per
     * platform, so `npm ci` on a Mac installs only darwin-arm64 — packing
     * Windows from macOS yields an installer with NO ffmpeg in it. CI runs
     * each script on its own runner.
     */
    expect(pkg.scripts['pack:win']).toContain('--win')
    expect(pkg.scripts['pack:mac']).toContain('--mac')
  })
})


describe('privacy strings macOS demands before a device opens', () => {
  it('says why it wants the microphone, or recording a voice-over crashes the app', () => {
    /*
     * macOS terminates — does not merely deny — an app that opens a privacy-
     * protected device without a usage description in its Info.plist. It cannot
     * be caught in development, where the process is Electron's own and carries
     * Electron's plist; the first sign would be a user pressing record on an
     * installed app and watching it vanish.
     */
    const reason = config.mac?.extendInfo?.NSMicrophoneUsageDescription
    expect(typeof reason).toBe('string')
    // A reason a person can read in the system prompt, not a placeholder.
    expect(String(reason).length).toBeGreaterThan(20)
    expect(String(reason).toLowerCase()).toContain('voice')
  })
})
