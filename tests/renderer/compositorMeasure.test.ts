import { describe, expect, it } from 'vitest'
import {
  COMPOSITOR_BAR,
  compositorVerdict,
  diffChannels,
  edgeColour,
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
    { list: 'colours', route: 'perspective', over: 'clear', diff: diff(2, 0.01) },
    { list: 'clusters', route: 'glow', over: 'clear', diff: diff(1, 0.0004) },
    { list: 'clusters', route: 'perspective', over: 'clear', diff: diff(1, 0.0004) }
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
    missing: { compositor: 'null', notes: [NOTE], diff: diff() },
    edges: [
      { camera: 'tilt 24°', max: 3, pixels: 90000, edgePixels: 1200 },
      { camera: 'dolly −0.12', max: 2, pixels: 80000, edgePixels: 1100 }
    ]
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

  it('reads only an area’s pixels when given one: a cluster’s box is not diluted by the rest of the frame', () => {
    // 3×2 pictures; only the pixel at (2, 1) differs.
    const a = new Array(24).fill(0)
    const b = [...a]
    b[(1 * 3 + 2) * 4] = 8
    expect(diffChannels(a, b).meanAll).toBeCloseTo(8 / 24, 12)
    const inBox = diffChannels(a, b, { width: 3, rect: { x: 2, y: 0, width: 1, height: 2 } })
    expect(inBox.pixels).toBe(2)
    expect(inBox.meanAll).toBeCloseTo(8 / 8, 12)
    expect(diffChannels(a, b, { width: 3, rect: { x: 0, y: 0, width: 2, height: 2 } }).maxAll).toBe(0)
  })
})

describe('edgeColour', () => {
  it('reads the straight colour against the fill where alpha is at least the floor, counting edge pixels', () => {
    const fill = [246, 242, 234] as const
    const px = (r: number, g: number, b: number, a: number): number[] => [r, g, b, a]
    // Opaque and exact; an edge at 200 off by 2; a fringe at 128 at half brightness (below the floor: not read); clear.
    const data = [...px(246, 242, 234, 255), ...px(244, 242, 235, 200), ...px(123, 121, 117, 128), ...px(0, 0, 0, 0)]
    expect(edgeColour(data, fill, 160)).toEqual({ max: 2, pixels: 2, edgePixels: 1 })
    // The same fringe at 192 (t² · c for t = 0.75: about 3/4 of the fill) is read, and is tens of levels off.
    const fringe = [...data, ...px(185, 182, 176, 192)]
    expect(edgeColour(fringe, fill, 160).max).toBeGreaterThan(50)
  })
})

describe('compositorVerdict', () => {
  it('passes readings within every bar', () => {
    expect(compositorVerdict(passing(), NOTE)).toEqual({ pass: true, failures: [] })
    // The two bars the plan fixes at 0 by construction; the others are figures the owner may change, each bounded by a fails() case below.
    expect(COMPOSITOR_BAR.settledMax).toBe(0)
    expect(COMPOSITOR_BAR.missingMax).toBe(0)
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

  it('fails the clusters off 0.000 on their own ink box, or not read, through either route', () => {
    fails((r) => void (r.routes.find((x) => x.list === 'clusters' && x.route === 'glow')!.diff = diff(1, 0.01)), /clusters by route glow: mean 0\.0100 on their ink box/)
    fails((r) => void (r.routes.find((x) => x.list === 'clusters' && x.route === 'perspective')!.diff = diff(1, 0.0005)), /clusters by route perspective: mean 0\.0005 on their ink box/)
    fails((r) => void (r.routes = r.routes.filter((x) => !(x.list === 'clusters' && x.route === 'perspective'))), /clusters by route perspective were not read/)
  })

  it('fails a moving plane’s edge off the fill (a fringe), an edge with nothing read, or a camera not read', () => {
    fails((r) => void (r.edges[0].max = 4), /edges at tilt 24°: straight colour off the fill by 4 > 3/)
    fails((r) => void (r.edges[1].edgePixels = 0), /edges at dolly −0\.12: no edge pixel/)
    fails((r) => void (r.edges = r.edges.slice(0, 1)), /edges at dolly −0\.12 were not read/)
  })

  it('fails WebGL missing that gave a compositor, a note not once, a frame off the flat twin', () => {
    fails((r) => void (r.missing.compositor = 'a compositor'), /gave a compositor/)
    fails((r) => void (r.missing.notes = [NOTE, NOTE]), /not the note once/)
    fails((r) => void (r.missing.notes = []), /not the note once/)
    fails((r) => void (r.missing.diff = diff(1)), /differs from the flat twin/)
  })
})
