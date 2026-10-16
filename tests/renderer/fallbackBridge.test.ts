import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { beforeAll, describe, expect, it, vi } from 'vitest'

/*
 * The fallback bridge (src/renderer/src/fallbackBridge.ts) answers every call
 * App's mount effects make, so a window whose preload did not load still
 * renders and says why, instead of a TypeError at startup.
 *
 * It had none of the AI helper's calls: App subscribes to `onSidecarStatus`
 * and asks `sidecarStatus()` in two mount effects, and with the preload
 * missing the first threw "not a function" before anything was drawn (a
 * verifier's finding, CLIPS §3a.4 "The bridge"). `onTranscribeProgress` and
 * `onParallaxProgress` were missing the same way.
 *
 * Which calls those are is READ from App.tsx with the TypeScript parser, not
 * listed here: every `window.forge.<name>(…)` whose nearest function is the
 * callback of a `useEffect` inside `function App`, so a mount call App gains
 * is held to the fallback without anyone remembering this file.
 */

const root = resolve(__dirname, '..', '..')

/** The bridge methods App's mount effects call directly. */
function mountCalls(): string[] {
  const path = resolve(root, 'src/renderer/src/App.tsx')
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set<string>()
  const nearestFunction = (node: ts.Node): ts.Node | null => {
    for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
      if (ts.isArrowFunction(at) || ts.isFunctionExpression(at) || ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) return at
    }
    return null
  }
  const insideApp = (node: ts.Node): boolean => {
    for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
      if (ts.isFunctionDeclaration(at) && at.name?.text === 'App') return true
    }
    return false
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const target = node.expression.expression.getText(file).replace(/\s+/g, '')
      if (target === 'window.forge') {
        const fn = nearestFunction(node)
        const effect = fn?.parent
        if (fn && effect && ts.isCallExpression(effect) && effect.expression.getText(file) === 'useEffect' && effect.arguments[0] === fn && insideApp(effect)) {
          names.add(node.expression.name.text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return [...names].sort()
}

let forge: Record<string, unknown>

beforeAll(async () => {
  vi.stubGlobal('window', {})
  vi.stubGlobal('queueMicrotask', () => undefined)
  const { installFallbackBridge } = await import('../../src/renderer/src/fallbackBridge')
  installFallbackBridge()
  forge = (window as unknown as { forge: Record<string, unknown> }).forge
})

describe('the fallback bridge', () => {
  it('reads App’s mount calls from App.tsx, the AI helper’s status among them', () => {
    // The read really found them: a parse that found nothing would pass the case below by finding nothing.
    expect(mountCalls()).toEqual(expect.arrayContaining(['listJobs', 'onJobsChanged', 'onSidecarStatus', 'sidecarStatus']))
  })

  it('answers every one of them without throwing: a subscription returns its unsubscribe, an ask resolves', async () => {
    const failures: string[] = []
    for (const name of mountCalls()) {
      const method = forge[name]
      if (typeof method !== 'function') {
        failures.push(`${name}: missing`)
        continue
      }
      try {
        const answer: unknown = (method as (...args: unknown[]) => unknown)(() => undefined)
        if (name.startsWith('on') && typeof answer !== 'function') failures.push(`${name}: returned no unsubscribe`)
        if (answer instanceof Promise) await answer
      } catch (err) {
        failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('says why the AI helper is not running, with nothing to press, and refuses its presses with the same sentence', async () => {
    const { BRIDGE_DID_NOT_LOAD } = await import('../../src/renderer/src/fallbackBridge')
    const { helperRow, packFactsFor } = await import('@shared/sidecar/row')
    const { HELPER_PACK } = await import('@shared/sidecar/packManifest')
    const status = await (forge.sidecarStatus as () => Promise<Parameters<typeof helperRow>[0]['status']>)()
    const row = helperRow({ status, pack: packFactsFor(HELPER_PACK, 'MacIntel'), job: null })
    expect([row.word, row.dot, row.line, row.actions]).toEqual(['Not running', 'red', BRIDGE_DID_NOT_LOAD, []])
    for (const press of ['installHelper', 'removeHelper', 'checkHelperAgain', 'speechModel']) {
      expect(() => (forge[press] as () => unknown)(), press).toThrow(BRIDGE_DID_NOT_LOAD)
    }
  })
})
