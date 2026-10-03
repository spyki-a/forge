import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TRAY_MIN, TRAY_RAIL, hasKeysOrPath, trayOpenAt } from '@shared/curveTray'

/*
 * The Curve tray on the timeline (docs/WINDOW.md §6 Step 5, §3.19).
 *
 * The user's decision: the graphs and keyframes live "in a small side bar on
 * the timeline, only the user uses it when needed" — closed by default, never
 * opening by itself, with a dot on its rail when the selected clip has keys.
 * So the keyframe rows and the motion path leave the Inspector for the tray's
 * Keys tab, the CurvePanel becomes its Curves tab, and the Panel beside the
 * timeline collapses to a 28 px rail.
 *
 * Source-level where the thing is a placement (which file renders what, and
 * that the tray's Panel is always there); behavioural where it is a rule (the
 * dot, and the line between open and closed). That nothing in the store opens
 * the tray is tests/renderer/curveTrayStore.test.ts, which needs the store.
 * The harness census counts the controls on screen in their new homes.
 */

const source = (path: string): string => readFileSync(resolve(__dirname, '..', path), 'utf8')
const count = (text: string, needle: string): number =>
  [...text.matchAll(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].length
/** A component's opening tag however it is laid out: `<Keyframes ` with a space
 *  misses a mount written over several lines (`<Keyframes` then a newline). */
const mounts = (text: string, component: string): number =>
  [...text.matchAll(new RegExp(`<${component}\\b`, 'g'))].length

const inspector = source('src/renderer/src/components/Inspector.tsx')
const tray = source('src/renderer/src/components/CurveTray.tsx')
const motion = source('src/renderer/src/components/MotionPathPanel.tsx')
const app = source('src/renderer/src/App.tsx')

describe('the keys leave the Inspector for the tray', () => {
  it('the Inspector no longer renders the keyframe rows or the motion path', () => {
    expect(mounts(inspector, 'Keyframes')).toBe(0)
    expect(mounts(inspector, 'MotionPathPanel')).toBe(0)
    // The motion path's own parts, not only its wrapper: a copy left behind
    // would be a second home for the same control.
    for (const gone of ['Add point at playhead', 'Clear path', 'PATH_PRESETS', 'addWaypoint(']) {
      expect(count(inspector, gone), gone).toBe(0)
    }
  })

  it('the tray renders each once: the rows and the path on Keys, the CurvePanel on Curves', () => {
    expect(count(tray, '<Keyframes clip={clip} />')).toBe(1)
    expect(count(tray, '<MotionPathPanel clip={clip} />')).toBe(1)
    expect(count(tray, '<CurvePanel')).toBe(1)
    // Keys first, then the path under it, as the Inspector had them.
    expect(tray.indexOf('<Keyframes clip={clip} />')).toBeLessThan(tray.indexOf('<MotionPathPanel clip={clip} />'))
  })

  it('the motion path moved whole, with a tooltip saying it is the PATH its Clear clears', () => {
    for (const part of ['Motion path', 'PATH_PRESETS.map((preset) =>', 'onClick={() => addWaypoint(clip.id)}', 'Add point at playhead', 'onClick={() => setPath(clip.id, undefined)}', 'Clear path', 'One point is a fixed offset, not a move']) {
      expect(count(motion, part), part).toBe(1)
    }
  })

  it('the Inspector keeps a one-click way to the keys, on Keys', () => {
    expect(count(inspector, 'Keys and curves are in the tray beside the timeline')).toBe(1)
    const at = inspector.indexOf('Keys and curves are in the tray beside the timeline')
    const button = inspector.slice(at, inspector.indexOf('</button>', at))
    expect(button).toMatch(/onClick=\{\(\) => \{\s*setTrayTab\('keys'\)\s*setTrayOpen\(true\)\s*\}\}/)
  })
})

describe('the tray’s Panel beside the timeline', () => {
  // The Panel whose only child is the tray. Its props have no `>` in them, so
  // the opening tag ends at the first one.
  const panels = [...app.matchAll(/<Panel\b([^>]*)>\s*<CurveTray \/>\s*<\/Panel>/g)]

  it('is rendered once, always — never behind a condition', () => {
    expect(count(app, '<CurveTray')).toBe(1)
    expect(panels).toHaveLength(1)
    expect(app).not.toMatch(/(?:&&|\?|:)\s*\(?\s*<CurveTray\b/)
    // In the lower row, beside the timeline.
    expect(app.indexOf('<Timeline />')).toBeGreaterThan(-1)
    expect(app.indexOf('<Timeline />')).toBeLessThan(panels[0].index!)
  })

  it('is a child of the timeline’s Group itself, not of a condition inside it', () => {
    // The checks above look at <CurveTray /> and its Panel's tag; a condition
    // around the whole Panel (`{x && (<Panel …><CurveTray /></Panel>)}`)
    // passes them. So: the Group holding the tray holds the timeline too, and
    // the tray's Panel is its last child, straight after the Divider. A
    // condition around the Panel — or around the Divider and the Panel, in a
    // fragment — puts `{x && (`, `?`, `)}` or `</>` between them. A JSX
    // comment is not a condition, so comments are taken out first.
    const rows = [...app.matchAll(/<Group\b[^>]*>((?:(?!<\/?Group\b)[\s\S])*)<\/Group>/g)]
      .map((row) => row[1].replace(/\{\/\*[\s\S]*?\*\/\}/g, ''))
      .filter((row) => row.includes('<CurveTray'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('<Timeline />')
    expect(rows[0]).toMatch(/<Divider \/>\s*<Panel\b[^>]*>\s*<CurveTray \/>\s*<\/Panel>\s*$/)
  })

  it('collapses to the rail: collapsible, 28 px closed and by default, 240 px at the least open', () => {
    const props = panels[0]?.[1] ?? ''
    expect(props).toMatch(/\bcollapsible\b(?!=)/)
    // Numbers are pixels in react-resizable-panels 4.x; a string would be percent.
    expect(props).toContain(`collapsedSize={${TRAY_RAIL}}`)
    expect(props).toContain(`defaultSize={${TRAY_RAIL}}`)
    expect(props).toContain(`minSize={${TRAY_MIN}}`)
    // Driven by the store, and writing back to it.
    expect(props).toContain('panelRef={tray.panelRef}')
    expect(props).toContain('onResize={tray.onResize}')
    expect(count(app, 'const tray = useTrayPanel()')).toBe(1)
  })

  it('is open at or past the midpoint between the rail and the least open width, closed below it', () => {
    expect(TRAY_RAIL).toBe(28)
    expect(TRAY_MIN).toBe(240)
    expect(trayOpenAt(TRAY_RAIL)).toBe(false)
    expect(trayOpenAt(29)).toBe(false)
    expect(trayOpenAt(133)).toBe(false)
    expect(trayOpenAt(134)).toBe(true)
    expect(trayOpenAt(TRAY_MIN)).toBe(true)
    expect(trayOpenAt(320)).toBe(true)
  })
})

describe('the rail’s dot: the selected clip has something in the tray', () => {
  const key = (frame: number, value: number) => ({ frame, value })

  it('is off for no clip, and for a clip with no keys and no path', () => {
    expect(hasKeysOrPath(null)).toBe(false)
    expect(hasKeysOrPath(undefined)).toBe(false)
    expect(hasKeysOrPath({})).toBe(false)
    expect(hasKeysOrPath({ keyframes: {}, path: [] })).toBe(false)
    // An emptied track is no key.
    expect(hasKeysOrPath({ keyframes: { zoom: [] } })).toBe(false)
  })

  it('is on for a single key — a held value is still something in the tray', () => {
    expect(hasKeysOrPath({ keyframes: { zoom: [key(0, 1.2)] } })).toBe(true)
    expect(hasKeysOrPath({ keyframes: { rotation: [key(0, 0), key(30, 90)] } })).toBe(true)
  })

  it('is on for every track the tray shows: the mask’s and the volume envelope too', () => {
    expect(hasKeysOrPath({ keyframes: { maskX: [key(0, 0.5)] } })).toBe(true)
    expect(hasKeysOrPath({ keyframes: { volume: [key(0, 1), key(30, 0.5)] } })).toBe(true)
  })

  it('is on for a motion path alone, even one point', () => {
    expect(hasKeysOrPath({ path: [{ frame: 0, x: 0.1, y: 0 }] })).toBe(true)
  })

  it('is what the rail draws its dot by', () => {
    expect(count(tray, 'hasKeysOrPath(clip)')).toBe(1)
    expect(tray).toMatch(/\{id === 'keys' && keyed && \(\s*<span title=\{DOT_TITLE\}/)
  })
})
