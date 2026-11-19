/**
 * The compositor option's numbers and its verdict (docs/CLIPS.md §6.11's
 * options table, §6.12's phase-3 bars, §6.16; phase 3's piece 1): pure, so
 * node's tests read the bars without a browser. The drawing that produces the
 * readings is `compositorCheck.ts`.
 */

/** One picture against another: each channel's mean and largest difference in levels, R, G, B, A, and the whole picture's. */
export interface ChannelDiff {
  mean: [number, number, number, number]
  max: [number, number, number, number]
  /** The mean over every channel, and the largest in any. */
  meanAll: number
  maxAll: number
  pixels: number
}

/** A rectangle of a picture, in pixels. */
export interface Region {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Two RGBA pictures of one size (straight colour, as `getImageData` reads),
 * compared channel by channel: the whole picture, or with `area` only the
 * pixels of `area.rect` in pictures `area.width` wide (an ink box, as phase
 * 0's parity reads EFFECTS §51's clusters: `inkBox` then `padRect`).
 */
export function diffChannels(a: ArrayLike<number>, b: ArrayLike<number>, area?: { width: number; rect: Region }): ChannelDiff {
  if (a.length !== b.length) throw new Error(`diffChannels: pictures of ${a.length} and ${b.length} bytes`)
  const sums = [0, 0, 0, 0]
  const max: [number, number, number, number] = [0, 0, 0, 0]
  const total = Math.floor(a.length / 4)
  const rect = area?.rect
  const width = area?.width ?? total
  const indices: number[] = []
  if (rect) {
    for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) indices.push(y * width + x)
  }
  const pixels = rect ? indices.length : total
  for (let i = 0; i < pixels; i++) {
    const p = rect ? indices[i] : i
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a[p * 4 + c] - b[p * 4 + c])
      sums[c] += d
      if (d > max[c]) max[c] = d
    }
  }
  const mean = sums.map((s) => (pixels > 0 ? s / pixels : 0)) as [number, number, number, number]
  return { mean, max, meanAll: (mean[0] + mean[1] + mean[2] + mean[3]) / 4, maxAll: Math.max(...max), pixels }
}

/**
 * §6.12's phase-3 bars for what piece 1 can read (the figures are the
 * plan's): flat colour through a WebGL route within 2/255 of painter A; a
 * `CanvasTexture` at 1:1 at 0.000 (a mean that prints as 0.000, and so below
 * half a thousandth); the 1 px anti-aliased line at 10, 50 and 90 % alpha
 * within 2/255 over black and over white; a settled 2.5D list equal to its
 * flat twin, 0 (route one); every geometry and texture given back on
 * dispose; and, with WebGL pretended missing, the flat picture (0) with the
 * note once. EFFECTS §51's clusters are read on their own ink box too
 * (`clusters`), through route two and route three at rest, each at 0.000,
 * as §6.12's M6 words it ("the clusters through a CanvasTexture at 1:1").
 *
 * `edgeMax` and `edgeMinAlpha` are NOT §6.12's: the fixer's proposal for
 * the edges of a moving plane (a single-colour shape tilted, and dollied
 * back, read where it is at least `edgeMinAlpha` opaque: there its straight
 * colour must be the fill's within `edgeMax` levels). Straight texels
 * filtered and premultiplied after the filter fail it by tens of levels (a
 * dark fringe); 8-bit premultiplied storage alone is within about 3 levels
 * at alpha 160, which is why the reading starts there.
 */
export const COMPOSITOR_BAR = Object.freeze({
  colourMax: 2,
  textureMean: 0.0005,
  lineMax: 2,
  settledMax: 0,
  missingMax: 0,
  edgeMax: 3,
  edgeMinAlpha: 160
})

/** A moving plane's edge colour: over every pixel at least `minAlpha` opaque, the largest difference of its straight colour from `fill`. */
export interface EdgeReading {
  /** Which camera: `tilt 24°` or `dolly −0.12`. */
  camera: string
  /** The largest |R, G or B − the fill's| over the pixels read, in levels. */
  max: number
  /** How many pixels were read (alpha at least `minAlpha`), and how many of those are edge pixels (alpha below 255). */
  pixels: number
  edgePixels: number
}

/** `EdgeReading`'s numbers for one picture (straight RGBA, as `getImageData` reads). */
export function edgeColour(data: ArrayLike<number>, fill: readonly [number, number, number], minAlpha: number): { max: number; pixels: number; edgePixels: number } {
  let max = 0
  let pixels = 0
  let edgePixels = 0
  for (let p = 0; p * 4 + 3 < data.length; p++) {
    const alpha = data[p * 4 + 3]
    if (alpha < minAlpha) continue
    pixels++
    if (alpha < 255) edgePixels++
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(data[p * 4 + c] - fill[c])
      if (d > max) max = d
    }
  }
  return { max, pixels, edgePixels }
}

export type CompositorRouteName = 'flat' | 'glow' | 'perspective'

export interface RouteReading {
  /** The list: `colours` (shapes, a stroke, text), `clusters` (EFFECTS §51's clusters' ink box in the colours frame) or `line` (the 1 px line at one alpha). */
  list: string
  route: CompositorRouteName
  /** Over nothing (`clear`), or composited over black or white. */
  over: 'clear' | 'black' | 'white'
  alpha?: number
  diff: ChannelDiff
}

export interface CompositorReadings {
  routes: RouteReading[]
  /** The settled 2.5D list (a flat camera, planes at z 0, 0.02 and 0.05) against its flat twin (no camera, no z). */
  settled: ChannelDiff
  memory: { before: { geometries: number; textures: number }; built: { geometries: number; textures: number }; after: { geometries: number; textures: number } }
  /** WebGL pretended missing: whether `createCompositor` answered null, the bake notes taken, and the frame against the flat twin painted by painter A. */
  missing: { compositor: 'null' | 'a compositor'; notes: string[]; diff: ChannelDiff }
  /** A moving plane's edges: one reading per camera (`EdgeReading`). */
  edges: EdgeReading[]
}

/** The bars, read: every failure named, so a red result says which. */
export function compositorVerdict(r: CompositorReadings, note: string): { pass: boolean; failures: string[] } {
  const failures: string[] = []
  const B = COMPOSITOR_BAR
  for (const reading of r.routes) {
    const name = `${reading.list}${reading.alpha === undefined ? '' : ` at ${Math.round(reading.alpha * 100)} %`} by route ${reading.route} over ${reading.over}`
    if (reading.route === 'flat' && reading.diff.maxAll > B.settledMax) failures.push(`${name}: max ${reading.diff.maxAll}, route one must equal painter A`)
    if (reading.list === 'line' && reading.diff.maxAll > B.lineMax) failures.push(`${name}: max ${reading.diff.maxAll} > ${B.lineMax}`)
    if (reading.list !== 'line' && reading.diff.maxAll > B.colourMax) failures.push(`${name}: max ${reading.diff.maxAll} > ${B.colourMax}`)
    if (reading.route === 'glow' && reading.over === 'clear' && !(reading.diff.meanAll < B.textureMean)) {
      failures.push(`${name}: the 1:1 texture's mean ${reading.diff.meanAll.toFixed(4)}, not 0.000`)
    }
  }
  for (const route of ['flat', 'glow', 'perspective'] as const) {
    if (!r.routes.some((x) => x.route === route)) failures.push(`route ${route} was not read`)
  }
  // EFFECTS §51's clusters on their own ink box, through the 1:1 texture and through route three at rest: 0.000 each.
  for (const route of ['glow', 'perspective'] as const) {
    const reading = r.routes.find((x) => x.list === 'clusters' && x.route === route)
    if (!reading) failures.push(`the clusters by route ${route} were not read`)
    else if (!(reading.diff.meanAll < B.textureMean)) failures.push(`the clusters by route ${route}: mean ${reading.diff.meanAll.toFixed(4)} on their ink box, not 0.000`)
  }
  for (const camera of ['tilt 24°', 'dolly −0.12']) {
    const edge = r.edges.find((e) => e.camera === camera)
    if (!edge) failures.push(`the edges at ${camera} were not read`)
    else if (edge.edgePixels === 0) failures.push(`the edges at ${camera}: no edge pixel at alpha ${B.edgeMinAlpha} or more was read`)
    else if (edge.max > B.edgeMax) failures.push(`the edges at ${camera}: straight colour off the fill by ${edge.max} > ${B.edgeMax} (a fringe)`)
  }
  for (const over of ['black', 'white'] as const) {
    for (const alpha of [0.1, 0.5, 0.9]) {
      if (!r.routes.some((x) => x.list === 'line' && x.over === over && x.alpha === alpha)) failures.push(`the line at ${alpha * 100} % over ${over} was not read`)
    }
  }
  if (r.settled.maxAll > B.settledMax) failures.push(`the settled 2.5D list differs from its flat twin: max ${r.settled.maxAll}`)
  const { before, after, built } = r.memory
  if (after.geometries !== before.geometries || after.textures !== before.textures) {
    failures.push(`dispose gave back ${built.geometries - after.geometries} of ${built.geometries - before.geometries} geometries and ${built.textures - after.textures} of ${built.textures - before.textures} textures`)
  }
  if (built.textures <= before.textures) failures.push('the build made no texture: the WebGL routes were not drawn')
  if (r.missing.compositor !== 'null') failures.push('with WebGL pretended missing, createCompositor gave a compositor')
  if (r.missing.notes.length !== 1 || r.missing.notes[0] !== note) failures.push(`with WebGL missing, the notes were ${JSON.stringify(r.missing.notes)}, not the note once`)
  if (r.missing.diff.maxAll > B.missingMax) failures.push(`with WebGL missing, the frame differs from the flat twin: max ${r.missing.diff.maxAll}`)
  return { pass: failures.length === 0, failures }
}
