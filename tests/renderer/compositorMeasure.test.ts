import { describe, expect, it } from 'vitest'
import {
  COMPOSITOR_BAR,
  compositorVerdict,
  diffChannels,
  type ChannelDiff,
  type CompositorReadings,
  type RouteReading
} from '../../src/renderer/src/harness/compositorMeasure'

/*
 * The harness's `compositor` option's numbers and verdict (docs/CLIPS.md
 * §6.11, §6.12's phase-3 bars; phase 3's piece 1): the reading of pictures
 * per channel, and every bar the verdict holds a reading to. The pictures
 * themselves are WebGL's, read on the harness page.
 */

const NOTE = 'drawn flat: 3D needs WebGL, which did not start on this computer'

const diff = (maxAll = 0, meanAll = 0): ChannelDiff => ({ mean: [meanAll, meanAll, meanAll, meanAll], max: [maxAll, 0, 0, 0], meanAll, maxAll, pixels: 100 })

function passing(): CompositorReadings {
  const routes: RouteReading[] = [
    { list: 'colours', route: 'flat', over: 'clear', diff: diff() },
    { list: 'colours', route: 'glow', over: 'clear', diff: diff(1, 0.0001) },
    { list: 'colours', route: 'perspective', over: 'clear', diff: diff(2, 0.01) }
  ]
  for (const alpha of [0.1, 0.5, 0.9]) {
    for (const route of ['glow', 'perspective'] as const) {
      for (const over of ['black', 'white'] as const) routes.push({ list: 'line', route, over, alpha, diff: diff(2, 0.001) })
    }
  }
  return {
    routes,
    settled: diff(),
    memory: { before: { geometries: 3, textures: 2 }, built: { geometries: 4, textures: 6 }, after: { geometries: 3, textures: 2 } },
    missing: { compositor: 'null', notes: [NOTE], diff: diff() }
  }
}

describe('diffChannels', () => {
  it('reads each channel’s mean and largest difference, and the whole picture’s', () => {
    const a = [10, 20, 30, 255, 0, 0, 0, 0]
    const b = [12, 20, 27, 255, 0, 0, 0, 4]
    const d = diffChannels(a, b)
    expect(d.pixels).toBe(2)
    expect(d.max).toEqual([2, 0, 3, 4])
    expect(d.mean).toEqual([1, 0, 1.5, 2])
    expect(d.maxAll).toBe(4)
    expect(d.meanAll).toBeCloseTo(1.125, 12)
    expect(() => diffChannels(a, b.slice(4))).toThrow(/8 and 4 bytes/)
  })
})

describe('compositorVerdict', () => {
  it('passes readings within every bar', () => {
    expect(compositorVerdict(passing(), NOTE)).toEqual({ pass: true, failures: [] })
    expect(COMPOSITOR_BAR).toEqual({ colourMax: 2, textureMean: 0.0005, lineMax: 2, settledMax: 0, missingMax: 0 })
  })

  const fails = (patch: (r: CompositorReadings) => void, pattern: RegExp): void => {
    const r = passing()
    patch(r)
    const v = compositorVerdict(r, NOTE)
    expect(v.pass).toBe(false)
    expect(v.failures.some((f) => pattern.test(f)), v.failures.join(' | ')).toBe(true)
  }

  it('fails route one off painter A by a level, a WebGL route’s colour past 2, the 1:1 texture’s mean off 0.000', () => {
    fails((r) => void (r.routes[0].diff = diff(1)), /route flat.*route one must equal painter A/)
    fails((r) => void (r.routes[2].diff = diff(3)), /colours by route perspective over clear: max 3 > 2/)
    fails((r) => void (r.routes[1].diff = diff(1, 0.0005)), /1:1 texture's mean 0\.0005/)
  })

  it('fails the line past 2 over black or white, and a line, route or background not read', () => {
    fails((r) => void (r.routes.find((x) => x.list === 'line' && x.over === 'white' && x.alpha === 0.1)!.diff = diff(3)), /line at 10 % by route .* over white: max 3 > 2/)
    fails((r) => void (r.routes = r.routes.filter((x) => !(x.list === 'line' && x.over === 'black' && x.alpha === 0.9))), /line at 90 % over black was not read/)
    fails((r) => void (r.routes = r.routes.filter((x) => x.route !== 'glow')), /route glow was not read/)
  })

  it('fails a settled 2.5D frame off its flat twin, a geometry or texture not given back, no texture made', () => {
    fails((r) => void (r.settled = diff(1)), /settled 2\.5D list differs/)
    fails((r) => void (r.memory.after.textures = 3), /dispose gave back .* and 3 of 4 textures/)
    fails((r) => void (r.memory.after.geometries = 4), /dispose gave back 0 of 1 geometries/)
    fails((r) => void (r.memory.built.textures = 2), /made no texture/)
  })

  it('fails WebGL missing that gave a compositor, a note not once, a frame off the flat twin', () => {
    fails((r) => void (r.missing.compositor = 'a compositor'), /gave a compositor/)
    fails((r) => void (r.missing.notes = [NOTE, NOTE]), /not the note once/)
    fails((r) => void (r.missing.notes = []), /not the note once/)
    fails((r) => void (r.missing.diff = diff(1)), /differs from the flat twin/)
  })
})
