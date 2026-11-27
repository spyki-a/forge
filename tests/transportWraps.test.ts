import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The transport row under the picture wraps rather than running past the
 * timeline's Panel (which hides overflow): since the left column may take
 * 45 % of the window (the clip maker's layout, 2026-11-27), the timeline at
 * the app's least window is narrower than the row's fixed content, and a row
 * that cannot wrap loses the timecode and the zoom buttons off its right end.
 */
describe('the transport row', () => {
  const src = readFileSync(resolve(__dirname, '../src/renderer/src/components/Transport.tsx'), 'utf8')
  const body = src.slice(src.indexOf('export function Transport'))

  it('wraps, and may shrink below its content, at its root', () => {
    expect(body.indexOf('export function Transport')).toBe(0)
    // The root is the first element the function returns.
    const roots = [...body.matchAll(/return \(\s*<div className="([^"]*)"/g)]
    expect(roots.length).toBeGreaterThanOrEqual(1)
    const classes = roots[0][1].split(/\s+/)
    expect(classes).toContain('flex')
    expect(classes).toContain('flex-wrap')
    expect(classes).toContain('min-w-0')
    expect(classes).not.toContain('flex-nowrap')
  })

  it('keeps the zoom pair pushed to the right end of its line', () => {
    expect([...body.matchAll(/title="Zoom (in|out)"/g)]).toHaveLength(2)
    const zoom = body.slice(0, body.indexOf('title="Zoom out"'))
    expect(zoom.slice(zoom.lastIndexOf('<div')).startsWith('<div className="ml-auto')).toBe(true)
  })
})
