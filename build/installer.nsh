; The Windows installer's own additions (electron-builder.yml `nsis.include`).
;
; electron-builder inserts `customUnInstall` at the start of its uninstall
; section (app-builder-lib templates/nsis/uninstaller.nsh), before it removes
; the installed files.
;
; The AI helper's pack (docs/CLIPS.md §3a.6, §16.47) is about 0.7 GB the app
; installed itself into userData, `%APPDATA%\<name>\python`. electron-builder
; leaves userData alone on an uninstall (`deleteAppDataOnUninstall` is not
; set, and stays unset: the models, the projects and the settings are the
; user's), so without this every uninstall would leave the pack behind. This
; removes the pack and nothing else: never `models`, never userData itself.
;
; NOT ON AN UPDATE. An app update runs the OLD version's uninstaller silently,
; with `--updated` (templates/nsis/include/installUtil.nsh), and the pack must
; survive that: the new version finds it and uses it, or offers its own
; Update. `${isUpdated}` is that flag, and the guard is spelled as
; electron-builder's own `DELETE_APP_DATA_ON_UNINSTALL` guard is
; (uninstaller.nsh). It is UNMEASURED: no update has run through it yet. The
; Surface's update run in §3a.9 is its measurement (the pack still there after
; an update from CI's next installer; `%APPDATA%\Forge\python` gone after an
; uninstall). tests/packaging.test.ts pins this shape.
;
; The folder: Electron names userData after the packaged package.json's
; productName, else its name, and NTFS compares names without case, so
; `${PRODUCT_NAME}` ("Forge") is the folder Electron makes from the name
; "forge". The package name's folder is removed too, for the day productName
; changes and the package name does not; it is the same folder today.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; userData is per user even in a per-machine install, as electron-builder's own app-data removal says.
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    RMDir /r "$APPDATA\${PRODUCT_NAME}\python"
    !if "${APP_PACKAGE_NAME}" != "${PRODUCT_NAME}"
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}\python"
    !endif
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
  ${endif}
!macroend
