import { describe, expect, it } from 'vitest'
import type { Camera, DrawItem, DrawList, ShapeItem } from '@shared/graphics/items'
import {
  DEFAULT_FOV,
  MAX_PLANES,
  cameraFor,
  compensation,
  compositorRoute,
  flatDistance,
  flatItems,
  isFlat,
  mat4Multiply,
  planeModel,
  planesOf,
  screenItemsOf,
  type Mat4
} from '@shared/graphics/compositor'

/*
 * The compositor's pure half (docs/CLIPS.md §6.16, "The compositor"; phase
 * 3's piece 1): `src/shared/graphics/compositor.ts`, the routes, the planes,
 * the camera and its parallax compensation, which `graphicCompositor.ts`
 * re-exports. The renderer's half, its disposal on a counting stand-in for
 * three.js and its seam in `graphicCanvas.ts` are
 * tests/renderer/graphicCompositor.test.ts. WebGL's pixels are the harness's
 * `compositor` option (§6.11).
 */

/* ------------------------------------------------------------------ items */

const SIZE = { width: 1080, height: 1920 }

function shape(id: string, fill: string, z?: number): ShapeItem {
  return { kind: 'shape', id, opacity: 1, shape: 'rect', box: { x: 100, y: 100, width: 200, height: 100 }, fill, ...(z === undefined ? {} : { z }) }
}
const dim = (z?: number): DrawItem => ({ kind: 'dim', id: 'dim', opacity: 1, color: '#000000', alpha: 0.5, ...(z === undefined ? {} : { z }) })
const list = (items: DrawItem[], extra: Partial<DrawList> = {}): DrawList => ({ ...SIZE, items, ...extra })
const FLAT: Camera = { tilt: 0, yaw: 0, dolly: 0, fov: 30 }
const TILTED: Camera = { tilt: 24, yaw: 0, dolly: 0, fov: 30 }

/* ------------------------------------------------------------- matrices */

function apply(m: Mat4, p: [number, number, number, number]): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0]
  for (let row = 0; row < 4; row++) out[row] = m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row] * p[3]
  return out
}

/** Where the quad's local point (u, v) in −1..1 of a plane at `z` lands on the frame, in pixels (y down). */
function pixelOf(camera: Camera | undefined, z: number, u: number, v: number, size = SIZE): { x: number; y: number } {
  const { projection, view, distance } = cameraFor(camera, size)
  const clip = apply(mat4Multiply(projection, mat4Multiply(view, planeModel(z, size, distance))), [u, v, 0, 1])
  return { x: ((clip[0] / clip[3] + 1) / 2) * size.width, y: ((1 - clip[1] / clip[3]) / 2) * size.height }
}

/* ------------------------------------------------------------- the pure half */

describe('graphicCompositor: planes', () => {
  it('planesOf groups by z ?? 0 ascending (far to near), keeping list order inside a plane', () => {
    const items = [shape('near-a', '#1', 0.05), shape('mid', '#2'), shape('far', '#3', -0.02), shape('near-b', '#4', 0.05), shape('zero', '#5', 0)]
    const planes = planesOf(list(items))
    expect(planes.map((p) => p.z)).toEqual([-0.02, 0, 0.05])
    expect(planes.map((p) => p.items.map((i) => i.id))).toEqual([['far'], ['mid', 'zero'], ['near-a', 'near-b']])
  })

  it('a group rides its own plane, its children with it', () => {
    const group: DrawItem = { kind: 'group', id: 'g', opacity: 1, z: 0.03, children: [shape('child', '#1', 0.5)] }
    expect(planesOf(list([group])).map((p) => [p.z, p.items.map((i) => i.id)])).toEqual([[0.03, ['g']]])
  })

  it('a dim is never on a camera plane, whatever z it carries: it is screen space, and painted first in a flat frame', () => {
    const items = [shape('a', '#1', 0.05), dim(0.05), shape('b', '#2')]
    expect(planesOf(list(items)).flatMap((p) => p.items.map((i) => i.kind))).not.toContain('dim')
    expect(screenItemsOf(list(items)).map((i) => i.id)).toEqual(['dim'])
    expect(flatItems(list(items)).map((i) => i.id)).toEqual(['dim', 'b', 'a'])
  })

  it('flatItems is the list order for a drawer that emits its dim first and its planes ascending', () => {
    const items = [dim(), shape('panel', '#1'), shape('label', '#2', 0.02), shape('value', '#3', 0.05)]
    expect(flatItems(list(items))).toEqual(items)
  })

  it('MAX_PLANES is four', () => {
    expect(MAX_PLANES).toBe(4)
  })
})

describe('graphicCompositor: routes', () => {
  const items = [shape('a', '#1', 0.05), shape('b', '#2')]

  it('isFlat sends a flat list, and every settled camera, to route one', () => {
    expect(isFlat(list(items))).toBe(true)
    expect(isFlat(list(items, { camera: FLAT }))).toBe(true)
    expect(isFlat(list(items, { camera: { ...FLAT, fov: 45 } }))).toBe(true)
    expect(isFlat(list(items, { camera: { ...FLAT, focus: { z: 0, px: 0 } } }))).toBe(true)
    expect(isFlat(list(items, { camera: FLAT, glow: [] }))).toBe(true)
    expect(compositorRoute(list(items, { camera: FLAT }))).toBe('flat')
  })

  it('a camera off flat, or a focus blur above 0, is the perspective route; a glow under a flat camera is route two', () => {
    for (const camera of [{ ...FLAT, tilt: 0.5 }, { ...FLAT, yaw: -8 }, { ...FLAT, dolly: -0.12 }, { ...FLAT, focus: { z: -0.02, px: 10 } }]) {
      expect(isFlat(list(items, { camera })), JSON.stringify(camera)).toBe(false)
      expect(compositorRoute(list(items, { camera })), JSON.stringify(camera)).toBe('perspective')
      expect(compositorRoute(list(items, { camera, glow: [{ item: 'a', radius: 8, strength: 1 }] })), JSON.stringify(camera)).toBe('perspective')
    }
    const glowing = list(items, { glow: [{ item: 'a', radius: 8, strength: 1 }] })
    expect(isFlat(glowing)).toBe(false)
    expect(compositorRoute(glowing)).toBe('glow')
    expect(compositorRoute({ ...glowing, camera: FLAT })).toBe('glow')
  })
})

describe('graphicCompositor: cameraFor and the compensation', () => {
  it('the flat distance makes the z = 0 plane exactly fill the frame, at the default fov of 30°', () => {
    expect(DEFAULT_FOV).toBe(30)
    const { distance } = cameraFor(undefined, SIZE)
    expect(distance).toBeCloseTo(SIZE.height / 2 / Math.tan(Math.PI / 12), 9)
    expect(cameraFor({ ...FLAT, fov: 40 }, SIZE).distance).toBeCloseTo(flatDistance(40, SIZE.height), 9)
  })

  it('the corners of a z 0 plane and of a compensated z 0.05 plane land on the frame corners under the flat camera (1e-9)', () => {
    const corners: [number, number, number, number][] = [
      [-1, 1, 0, 0],
      [1, 1, SIZE.width, 0],
      [-1, -1, 0, SIZE.height],
      [1, -1, SIZE.width, SIZE.height]
    ]
    for (const camera of [undefined, FLAT, { ...FLAT, fov: 50 }]) {
      for (const z of [0, 0.05, -0.02]) {
        for (const [u, v, x, y] of corners) {
          const p = pixelOf(camera, z, u, v)
          expect(Math.abs(p.x - x), `${JSON.stringify(camera)} z ${z} (${u}, ${v}) x`).toBeLessThan(1e-9)
          expect(Math.abs(p.y - y), `${JSON.stringify(camera)} z ${z} (${u}, ${v}) y`).toBeLessThan(1e-9)
        }
      }
    }
  })

  it('the flat camera maps one texel to one pixel: each texel centre on its pixel centre, on z 0 and z 0.05', () => {
    for (const z of [0, 0.05]) {
      for (const [i, j] of [[0, 0], [1, 0], [539, 959], [1079, 1919], [17, 1003]]) {
        // Texel (i, j)'s centre, in the quad's −1..1 with v up.
        const u = ((i + 0.5) / SIZE.width) * 2 - 1
        const v = 1 - ((j + 0.5) / SIZE.height) * 2
        const p = pixelOf(FLAT, z, u, v)
        expect(Math.abs(p.x - (i + 0.5)), `z ${z} texel ${i},${j}`).toBeLessThan(1e-9)
        expect(Math.abs(p.y - (j + 0.5)), `z ${z} texel ${i},${j}`).toBeLessThan(1e-9)
      }
    }
  })

  it('dolly 0 is flat; a dolly back shrinks the picture and the near plane less than its compensation would hold it', () => {
    expect(cameraFor({ ...FLAT, dolly: 0 }, SIZE)).toEqual(cameraFor(FLAT, SIZE))
    const back = { ...FLAT, dolly: -0.12 }
    const far0 = pixelOf(back, 0, 1, 1)
    const near5 = pixelOf(back, 0.05, 1, 1)
    expect(far0.x).toBeLessThan(SIZE.width - 1)
    expect(near5.x).toBeLessThan(SIZE.width - 1)
    // The two planes no longer coincide: the parallax of the move.
    expect(Math.abs(far0.x - near5.x)).toBeGreaterThan(1)
  })

  it('a positive tilt takes the top away (the top edge narrower than the bottom), a positive yaw the right edge', () => {
    const topWidth = pixelOf(TILTED, 0, 1, 1).x - pixelOf(TILTED, 0, -1, 1).x
    const bottomWidth = pixelOf(TILTED, 0, 1, -1).x - pixelOf(TILTED, 0, -1, -1).x
    expect(topWidth).toBeLessThan(bottomWidth)
    const yawed = { ...FLAT, yaw: 10 }
    const rightHeight = pixelOf(yawed, 0, 1, -1).y - pixelOf(yawed, 0, 1, 1).y
    const leftHeight = pixelOf(yawed, 0, -1, -1).y - pixelOf(yawed, 0, -1, 1).y
    expect(rightHeight).toBeLessThan(leftHeight)
  })

  it('the compensation is (D − zH) / D', () => {
    const D = flatDistance(30, SIZE.height)
    expect(compensation(0.05, SIZE.height, D)).toBeCloseTo((D - 0.05 * SIZE.height) / D, 12)
    expect(compensation(0, SIZE.height, D)).toBe(1)
  })
})

