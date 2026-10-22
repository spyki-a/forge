/// <reference types="vite/client" />
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installFallbackBridge } from './fallbackBridge'
import './styles.css'

installFallbackBridge()

/*
 * The graphics check, in the development app only (docs/CLIPS.md §6.11 "Where
 * it runs", §6.15): M3 and M22 depend on Electron 44's own Chromium, ICU and
 * HarfBuzz, which the harness page, served to whatever browser opens it, cannot
 * stand for. `window.__forgeGraphicCheck(options)` in `npm run dev`'s DevTools
 * console. Behind DEV, through a dynamic import, so the production build drops
 * the branch and no bundle it makes carries the check.
 */
if (import.meta.env.DEV) {
  void import('./harness/graphicCheck').then(({ installGraphicCheck }) => installGraphicCheck())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
