import type { SidecarStatus } from '@shared/sidecar/status'

/** What every press says when the preload did not load, and what the window shows for the AI helper then. */
export const BRIDGE_DID_NOT_LOAD = 'The app bridge did not load — restart Forge'

/**
 * If the preload script fails to load, every window.forge call throws and the
 * window goes blank with nothing useful in it. Install inert stubs so the UI
 * still renders and can say what went wrong.
 *
 * Its own module so a test can install it without rendering the app
 * (tests/renderer/fallbackBridge.test.ts calls every bridge method App's mount
 * effects call, read from App.tsx).
 */
export function installFallbackBridge(): void {
  if (window.forge) return
  const unavailable = (): never => {
    throw new Error(BRIDGE_DID_NOT_LOAD)
  }
  // The AI helper's row reads this: "Not running · The app bridge did not load — restart Forge", nothing to press.
  const noHelper = { state: 'failed', error: BRIDGE_DID_NOT_LOAD } as unknown as SidecarStatus
  window.forge = {
    getPathForFile: () => '',
    probe: async () => ({ assets: [], failed: [] }),
    pickMedia: async () => [],
    startRender: unavailable,
    encoders: async () => [],
    cancelRender: async () => undefined,
    listJobs: async () => [],
    clearFinished: async () => undefined,
    chooseExportPath: async () => null,
    saveProject: unavailable,
    openProject: async () => null,
    revealPath: async () => undefined,
    openPath: async () => undefined,
    onJobsChanged: () => () => undefined,
    /*
     * The ones the app calls while it is STARTING UP.
     *
     * The stubs above can throw because nothing calls them until a button is
     * pressed, by which time the warning is on screen. These are different:
     * the app reports its menu state and asks for its settings during the
     * first render, so a throw here takes the window down with a stack trace
     * instead of the message explaining that the bridge did not load.
     */
    getSettings: async () => ({}),
    setSetting: async () => ({}),
    autosaveProject: async () => null,
    recoveries: async () => [],
    recoverProject: async () => null,
    clearAutosave: async () => undefined,
    reportMenuState: () => undefined,
    rememberRecent: () => undefined,
    reportSaved: () => undefined,
    onMenuCommand: () => () => undefined,
    onMenuOpen: () => () => undefined,
    onFullScreen: () => () => undefined,
    exitFullScreen: () => undefined,
    // Asked for by the app shell at startup (App.tsx), no longer by a panel.
    builtInLooks: async () => [],
    microphonePermission: async () => false,
    saveVoiceOver: unavailable,
    // App's mount subscribes to these progress channels and to the AI helper's status, and asks for it once.
    onTranscribeProgress: () => () => undefined,
    onParallaxProgress: () => () => undefined,
    onSidecarStatus: () => () => undefined,
    sidecarStatus: async () => noHelper,
    onSpeechModelProgress: () => () => undefined,
    // The AI helper's presses: only from a button, by which time the row says why nothing works.
    installHelper: unavailable,
    removeHelper: unavailable,
    checkHelperAgain: unavailable,
    helperModelsBytes: async () => null,
    speechModel: unavailable,
    cancelSpeechModel: async () => undefined
  } as unknown as Window['forge']

  queueMicrotask(() => {
    console.warn('Forge: preload bridge unavailable; running without app services.')
  })
}
