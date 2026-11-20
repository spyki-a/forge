/**
 * Phase 3's last harness numbers and their verdicts (docs/CLIPS.md §6.11's
 * options table, the phase-3 rows `readback` and `screenCard: '<path>'`;
 * §6.12's "Phase 3" exit; §6.15's M12, M13 and M20; phase 3's piece 6),
 * pure, so node's tests read the bars without a browser. The drawing that
 * produces the readings is `readbackCheck.ts` (M12), `bake3dCheck.ts`
 * (preview = export, M13's bakes, disposal through the app's own bake) and
 * `screenCardRecordingCheck.ts` (M20); the hero's landing is the depth
 * option's (`depthCheck.ts`).
 */

import { TEMPLATES_BAR, percentile, type PixelDiff } from './graphicMeasure'
import type { ChannelDiff } from './compositorMeasure'

/* ------------------------------------------------------------- M12: readback */

/** M12's three ways of getting a compositor frame out (§6.15's row), in the row's order. */
export const READBACK_ROUTES = Object.freeze(['drawImage', 'readPixels', 'readRenderTargetPixelsAsync'] as const)
export type ReadbackRoute = (typeof READBACK_ROUTES)[number]

/** The frames timed when the call names none (§6.15's row: `frames: 120`). */
export const READBACK_FRAMES = 120

/**
 * M12's bar (§6.15's outcome table, proposal): the fastest at p50 that keeps
 * straight alpha through to the PNG is phase 3's bake, but `drawImage` (the
 * route the bake has, `paintFrame`) stays unless another is at least
 * `faster` times as fast. "Keeps straight alpha" is read per route against
 * the very frame it read back: the GL frame's premultiplied bytes (the
 * canvas's by `readPixels`, or the render target's), made straight
 * (`straightTopDown`), against the route's PNG decoded: alpha within
 * `alphaMax` everywhere, colour within `colourMax` where that alpha is at
 * least `minAlpha` (below it an 8-bit premultiplied value cannot hold its
 * straight colour to a level, whatever reads it back, and every route here
 * goes through a 2D canvas's premultiplied store twice, its own and the
 * decode's; at 128 and above one round trip is within a level; a PNG stored
 * premultiplied is off by half its colour at alpha 128, so far over the bar).
 * So the reading is the route's own, and not a difference of antialiasing:
 * the canvas is antialiased, a render target three can read after a second
 * pass is not (three r186 invalidates a multisampled target's colour once it
 * resolves it, WebGLTextures.js `updateMultisampleRenderTarget`, so the glow's
 * add pass could not land on it). Proposals, the plan's figures.
 */
export const READBACK_BAR = Object.freeze({ faster: 2, alphaMax: 1, colourMax: 2, minAlpha: 128 })

/** The routes a `readback` option names: every one of `READBACK_ROUTES` for `true`; a throw naming the routes for anything else it cannot read. */
export function readbackRoutes(asked: unknown): ReadbackRoute[] {
  if (asked === true) return [...READBACK_ROUTES]
  if (!Array.isArray(asked) || asked.length === 0) throw new Error(`graphic check: readback takes a list of ${READBACK_ROUTES.join(', ')} (§6.15's M12), or true for all three`)
  const unknown = asked.filter((r) => !(READBACK_ROUTES as readonly string[]).includes(String(r)))
  if (unknown.length > 0) throw new Error(`graphic check: readback names ${unknown.map((r) => JSON.stringify(r)).join(', ')}, not one of ${READBACK_ROUTES.join(', ')}`)
  return [...new Set(asked as ReadbackRoute[])]
}

/** The frames a `readback` call times: its `frames` when a whole number of at least 1, else `READBACK_FRAMES`. */
export function readbackFrames(frames: unknown): number {
  return typeof frames === 'number' && Number.isFinite(frames) && frames >= 1 ? Math.floor(frames) : READBACK_FRAMES
}

/**
 * A GL read's bytes (premultiplied, rows bottom up, as `readPixels` and
 * `readRenderTargetPixelsAsync` give them) as a straight top-down RGBA
 * picture, as a PNG holds it: each colour divided by its alpha, rounded,
 * clamped to 255; a pixel of alpha 0 all 0.
 */
export function straightTopDown(premultiplied: ArrayLike<number>, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  if (premultiplied.length !== width * height * 4) throw new Error(`straightTopDown: ${premultiplied.length} bytes is not ${width}×${height} RGBA`)
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * width * 4
    const to = y * width * 4
    for (let x = 0; x < width * 4; x += 4) {
      const a = premultiplied[from + x + 3]
      out[to + x + 3] = a
      if (a === 0) continue
      for (let c = 0; c < 3; c++) out[to + x + c] = Math.min(255, Math.round((premultiplied[from + x + c] * 255) / a))
    }
  }
  return out
}

/** One route's picture against the reference's, as M12 asks: alpha anywhere, colour where the reference is at least `minAlpha` opaque. */
export interface StraightReading {
  alphaMax: number
  colourMax: number
  /** Pixels whose colour was read (the reference's alpha at least `minAlpha`), and pixels with any alpha. */
  colourPixels: number
  inkPixels: number
  /**
   * Pixels whose colour was read at a partial alpha (`minAlpha` to 254): the
   * only ones that tell a PNG kept straight from one stored premultiplied
   * (an opaque pixel reads the same either way), so a reading with none of
   * them keeps nothing.
   */
  partialPixels: number
}

export function straightAgainst(reference: ArrayLike<number>, picture: ArrayLike<number>, minAlpha = READBACK_BAR.minAlpha): StraightReading {
  if (reference.length !== picture.length) throw new Error(`straightAgainst: pictures of ${reference.length} and ${picture.length} bytes`)
  let alphaMax = 0
  let colourMax = 0
  let colourPixels = 0
  let inkPixels = 0
  let partialPixels = 0
  for (let p = 0; p < reference.length; p += 4) {
    alphaMax = Math.max(alphaMax, Math.abs(reference[p + 3] - picture[p + 3]))
    if (reference[p + 3] > 0 || picture[p + 3] > 0) inkPixels++
    if (reference[p + 3] < minAlpha) continue
    colourPixels++
    if (reference[p + 3] < 255) partialPixels++
    for (let c = 0; c < 3; c++) colourMax = Math.max(colourMax, Math.abs(reference[p + c] - picture[p + c]))
  }
  return { alphaMax, colourMax, colourPixels, inkPixels, partialPixels }
}

/** Whether a route keeps straight alpha through to the PNG (`READBACK_BAR`); a reading with no ink read, or no partial alpha read, keeps nothing. */
export function keepsStraightAlpha(r: StraightReading): boolean {
  return r.inkPixels > 0 && r.colourPixels > 0 && r.partialPixels > 0 && r.alphaMax <= READBACK_BAR.alphaMax && r.colourMax <= READBACK_BAR.colourMax
}

/** One route's timings, ms a frame. */
export interface ReadbackRow {
  route: ReadbackRoute
  /** Why it did not run (a throw: no WebGL 2 for the async read, say); null when it ran. */
  error: string | null
  /** To straight pixels in a 2D canvas, the frame the bake encodes: ms per frame. */
  readMs: number[]
  /** The same, then that canvas's `toBlob('image/png')` awaited: ms per frame. */
  pngMs: number[]
  /** Its PNG decoded against its own GL frame's bytes made straight (null when either is missing). */
  straight: StraightReading | null
}

export interface ReadbackVerdict {
  /** Per route that ran: its p50 and p95 to pixels and to PNG, and whether it keeps straight alpha. */
  rows: { route: ReadbackRoute; p50: number; p95: number; pngP50: number; pngP95: number; keeps: boolean }[]
  /** The fastest at p50 that keeps straight alpha. */
  fastest: ReadbackRoute | null
  /** Phase 3's bake by the rule: drawImage unless `fastest` is at least `READBACK_BAR.faster` times as fast at p50 (when drawImage was not timed, or does not keep straight alpha, the fastest that keeps). */
  chosen: ReadbackRoute | null
  failures: string[]
}

/**
 * M12's reading (§6.15): per route, p50 and p95 of its ms a frame to pixels
 * and to PNG; the fastest at p50 that keeps straight alpha; and the route the
 * rule chooses. It measures and reports: the bake's route is the plan
 * owner's decision after the Surface's reading. `failures` names a route that
 * did not run or did not keep straight alpha.
 */
export function readbackVerdict(rows: readonly ReadbackRow[]): ReadbackVerdict {
  const failures: string[] = []
  const ran = rows.filter((r) => r.error === null && r.readMs.length > 0)
  if (rows.length === 0) failures.push('no route was read')
  for (const r of rows) if (r.error !== null) failures.push(`${r.route} did not run: ${r.error}`)
  for (const r of rows) if (r.error === null && r.readMs.length === 0) failures.push(`${r.route} ran but timed no frame`)
  const out: ReadbackVerdict['rows'] = ran.map((r) => {
    const keeps = r.straight !== null && keepsStraightAlpha(r.straight)
    if (!keeps) {
      failures.push(
        r.straight
          ? `${r.route} does not keep straight alpha through to its PNG: alpha off by ${r.straight.alphaMax}, colour by ${r.straight.colourMax} where alpha ≥ ${READBACK_BAR.minAlpha} (bar ${READBACK_BAR.alphaMax} and ${READBACK_BAR.colourMax})`
          : `${r.route}: its PNG was not read against its frame`
      )
    }
    return { route: r.route, p50: percentile(r.readMs, 50), p95: percentile(r.readMs, 95), pngP50: percentile(r.pngMs, 50), pngP95: percentile(r.pngMs, 95), keeps }
  })
  const keeping = out.filter((r) => r.keeps).sort((a, b) => a.p50 - b.p50)
  const fastest = keeping[0]?.route ?? null
  // drawImage is preferred only while it keeps straight alpha itself: the rule's first condition is the bar.
  const drawImage = out.find((r) => r.route === 'drawImage' && r.keeps)
  let chosen: ReadbackRoute | null = fastest
  if (drawImage && fastest && fastest !== 'drawImage') {
    const best = keeping[0]
    chosen = best.p50 * READBACK_BAR.faster <= drawImage.p50 ? fastest : 'drawImage'
  }
  return { rows: out, fastest, chosen, failures }
}

/* ------------------------------------------------------ preview = export */

/**
 * §6.12's phase-3 exit, "Preview = export within 1/255 for the 2.5D `counter`
 * and `ring` at rest and on three moving frames, and for the screen card's
 * moving frames", read as phase 2's `templates` row reads it (`TEMPLATES_BAR`:
 * a mean of at most 1 level over the two pictures' ink, `diffOverInk`), here
 * at every frame read on both sides of the bake: the Preview's own canvas
 * (`graphicPreviewCanvas`, once its compositor and pictures have landed) and
 * the harness's frames (`graphicFrameCanvases`), each against the baked PNG
 * decoded. Beside it, the same spec twice: the bake's PNGs byte-equal
 * (M13's first half, as the page can read it), and each bake writing exactly
 * the moving frames.
 */
export const EXPORT_PARITY_BAR = Object.freeze({ meanLevels: TEMPLATES_BAR.bakeMeanLevels })

export interface ExportParityReading {
  /** The case's name: `counter-en tilt under clean`, `screen card tilt-in under energetic`. */
  name: string
  /** The frames read: at rest (the last moving frame) and moving ones. */
  frames: number[]
  /** Per frame read, the live Preview's canvas against the baked PNG, over their ink; null where the Preview drew nothing. */
  live: (PixelDiff | null)[]
  /** Per frame read, the harness's frames against the baked PNG, over their ink. */
  harness: PixelDiff[]
  /** The bake's frames against `graphicMovingFrames`. */
  baked: number
  moving: number
  /** The second bake against the first, PNG by PNG, where it was baked twice (M13's cases); null when baked once. */
  twice: { equal: number; of: number } | null
  /**
   * What was drawn flat where the case asks for 2.5D: a bake that recorded
   * `WEBGL_MISSING_NOTE`, a Preview frame that wanted a compositor and had
   * none (WebGL missing, or the Preview's cap full). A flat Preview agrees
   * with a flat bake, so without this the option could pass with no 2.5D
   * drawn at all.
   */
  flat: string[]
}

export function exportParityVerdict(readings: readonly ExportParityReading[]): { pass: boolean; failures: string[] } {
  const failures: string[] = []
  if (readings.length === 0) failures.push('no case was read')
  const within = (d: PixelDiff | null): boolean => d !== null && d.pixels > 0 && d.mean <= EXPORT_PARITY_BAR.meanLevels
  for (const r of readings) {
    if (r.frames.length === 0) failures.push(`${r.name}: no frame read`)
    r.frames.forEach((frame, i) => {
      if (!within(r.live[i] ?? null)) failures.push(`${r.name} @${frame}: the Preview against the export ${r.live[i] ? `mean ${r.live[i]!.mean.toFixed(3)}` : 'not drawn'} (bar ${EXPORT_PARITY_BAR.meanLevels})`)
      if (!within(r.harness[i] ?? null)) failures.push(`${r.name} @${frame}: the harness's frame against the export ${r.harness[i] ? `mean ${r.harness[i].mean.toFixed(3)}` : 'not read'} (bar ${EXPORT_PARITY_BAR.meanLevels})`)
    })
    if (r.baked !== r.moving) failures.push(`${r.name}: baked ${r.baked} frames of ${r.moving} moving`)
    if (r.twice && !(r.twice.of > 0 && r.twice.equal === r.twice.of)) failures.push(`${r.name}: baked twice, ${r.twice.equal} of ${r.twice.of} PNGs byte-equal`)
    for (const f of r.flat) failures.push(`${r.name}: drawn flat, ${f}`)
  }
  return { pass: failures.length === 0, failures }
}

/**
 * The frames a 2.5D case is read at (§6.12: "at rest and on three moving
 * frames"): three spread over the moving frames before the last (a quarter,
 * a half and three quarters of the way, each at least 1), and the last moving
 * frame, the one `tpad` holds. Ascending, each once.
 */
export function exportParityFrames(moving: number): number[] {
  const last = Math.max(0, moving - 1)
  const at = [0.25, 0.5, 0.75].map((q) => Math.max(1, Math.min(last - 1, Math.round(q * last))))
  return [...new Set([...at.filter((f) => f >= 1 && f < last), last])].sort((a, b) => a - b)
}

/**
 * A screen card's frames read (§6.12: "the screen card's moving frames"):
 * the move (frame 2, a quarter and half of `L`), the landing `L` and the
 * frame after it, and under a glowing style the sweep's crossing, half-way
 * and last frames, then the frame `tpad` holds. Ascending, within the moving
 * frames, each once.
 */
export function screenCardParityFrames(landing: number, moving: number, sweep: { crossing: number; loop: number } | null): number[] {
  const L = landing
  const frames = [2, Math.round(L / 4), Math.round(L / 2), L, L + 1, moving - 1]
  if (sweep) frames.push(sweep.crossing, L + Math.round(sweep.loop / 2), L + sweep.loop - 1)
  return [...new Set(frames.filter((f) => f >= 0 && f < moving))].sort((a, b) => a - b)
}

/* ---------------------------------------------------------------- disposal */

/**
 * §6.12's phase-3 exit (proposal): "after a 2.5D bake and the clip's removal,
 * the shared renderer's `info.memory` geometries and textures back to their
 * counts before the bake". Read through the app's own bake
 * (`bakeGraphicSequence`) and the Preview's own entries (`graphicPreviewCanvas`,
 * then `forgetGraphicPreview`, the Preview's sweep on a clip's removal).
 */
export function memoryBack(before: { geometries: number; textures: number }, after: { geometries: number; textures: number }): boolean {
  return after.geometries === before.geometries && after.textures === before.textures
}

/* ------------------------------------------------------------- M13, phase 3 */

/**
 * M13's line for phase 3 (§6.15's row: "3 (a 2.5D counter and a screen
 * card)"), in the manner of phase 1's `m13Line`: each case's two bakes kept
 * as files for the framemd5 of each. Null where the sequences are not files
 * (the harness page's bridge answers `harness://`).
 */
export function m13Phase3Line(cases: readonly { name: string; patterns: readonly [string, string] }[]): string | null {
  const onDisk = cases.filter((c) => !/^harness:/.test(c.patterns[0]))
  if (onDisk.length === 0) return null
  return (
    'phase 3 M13: each case baked twice through bakeGraphicSequence, its two sequences kept on disk for the framemd5 of each ' +
    '("$FFMPEG" -start_number 0 -i <pattern> -f framemd5 -), equal within a machine; the Mac\'s against the Surface\'s is the recorded golden tolerance: ' +
    onDisk.map((c) => `${c.name} ${c.patterns.join(' and ')}`).join('; ') +
    '. Each run adds its own; the app\'s title-frame folder keeps them until cleared.'
  )
}

/* -------------------------------------------------- M20: the bake's budget */

/**
 * M1's whole-hold budget (§6.15's M1 row, recorded 2026-10-27): a whole-hold
 * motion is allowed once per clip only if 300 frames bake in under 10 s on
 * the Surface. M20 reads a card's moving frames against it: the frames at or
 * under `frames`, and the rate a frame at or under `ms / frames`.
 */
export const WHOLE_HOLD_BUDGET = Object.freeze({ frames: 300, ms: 10_000 })

export interface BakeBudget {
  frames: number
  /** ms a frame, the bake's writes `GRAPHIC_POOL_DEPTH` at a time at p50 (or its wall over its frames where the writes could not be watched). */
  msPerFrame: number
  /** The bake's wall, ms. */
  totalMs: number
  /** 300 frames at this rate, ms. */
  projectedMs: number
  withinFrames: boolean
  withinRate: boolean
}

export function bakeBudget(frames: number, msPerFrame: number, totalMs: number): BakeBudget {
  const projectedMs = msPerFrame * WHOLE_HOLD_BUDGET.frames
  return {
    frames,
    msPerFrame,
    totalMs,
    projectedMs,
    withinFrames: frames > 0 && frames <= WHOLE_HOLD_BUDGET.frames,
    withinRate: Number.isFinite(msPerFrame) && msPerFrame > 0 && projectedMs < WHOLE_HOLD_BUDGET.ms
  }
}

/**
 * M20's hand-off on the card's own side (§6.16, proposal): the card's baked
 * frame `L`, decoded, against the pulled frame `L` drawn by a plain
 * `drawImage` into the card's box, inside the box less the bezel: within 2/255
 * mean.
 */
export const HANDOFF_BAR = Object.freeze({ meanLevels: 2 })

export function handoffWithin(d: ChannelDiff | null): boolean {
  return d !== null && d.pixels > 0 && d.meanAll <= HANDOFF_BAR.meanLevels
}

/* ------------------------------------------------------- the hero's landing */

/**
 * The hero's landing (phase 3's piece 6): its last perspective frame (route
 * three, the camera a hair off flat) against its first route-two frame (the
 * camera flat, the glow over painter A's canvas at 1:1). The two frames are
 * one step of the move apart, so the pictures differ by that step; what must
 * not jump is the glow, drawn by two paths (route three's glow layer under the
 * plane's own model, route two's under the identity quad). So the reading is
 * the glow alone on each side (the frame with it less the frame without it,
 * per channel, signed) and the difference of the two, against the step of
 * the frames without the glow.
 *
 * The bar is a proposal, not in the depth verdict until read on both
 * machines: the glow's own change across the landing at most `glowMean`
 * levels mean over the glow's pixels and `glowMax` at its largest, and a glow
 * present on both sides. Why: the glow is a
 * blur of the item, so where the item moves a pixel the glow moves by less
 * than a pixel's worth of its own gradient, a level or two at a radius of
 * tens of pixels; a mismatch of the two paths (a model, a premultiply, a
 * strength, a cap) changes the glow over its whole reach, by levels on every
 * pixel of it, which a mean over the glow's own pixels shows.
 */
export const HERO_LANDING_BAR = Object.freeze({ glowMean: 0.5, glowMax: 16 })

export interface HeroLandingReading {
  /** The last frame off flat and the first at rest (card frames of the clip). */
  lastMoving: number
  firstFlat: number
  /** The two frames with their glow, against each other; and without it. */
  withGlow: ChannelDiff
  withoutGlow: ChannelDiff
  /** The glow alone (with less without, signed per channel) on one side against the other's: mean over the glow's pixels and largest, in levels. */
  glowMean: number
  glowMax: number
  /** The pixels where either side's glow is not zero (the mean's pixels), and each side's own. */
  glowPixels: number
  lastGlowPixels: number
  firstGlowPixels: number
  /**
   * The last moving frame by both routes: drawn as it is (route three) and
   * with its camera taken off (route two). The template still moves across
   * the landing (a count's digits, an arc), so the two neighbouring frames
   * differ by design; this pair differs only by the route and the camera's
   * last sliver, and it is what the proposed bar is held against.
   */
  same?: { camera: unknown; glowMean: number; glowMax: number; glowPixels: number; lastGlowPixels: number; firstGlowPixels: number }
}

/**
 * The glow alone on each side of the landing, against the other:
 * |(a1 − a0) − (b1 − b0)| per channel, its mean over the pixels where either
 * side's glow is not zero (a mean over the whole frame, most of it empty,
 * would dilute a mismatch confined to the glow's reach: a74576d's trap), and
 * each side's own glow pixels, so a landing whose glow is missing on both
 * sides reads as missing, not as equal.
 */
export function glowChange(
  lastWith: ArrayLike<number>,
  lastWithout: ArrayLike<number>,
  firstWith: ArrayLike<number>,
  firstWithout: ArrayLike<number>
): { mean: number; max: number; pixels: number; lastPixels: number; firstPixels: number } {
  const n = lastWith.length
  if (n % 4 !== 0 || [lastWithout, firstWith, firstWithout].some((p) => p.length !== n)) throw new Error('glowChange: pictures of different sizes')
  let sum = 0
  let max = 0
  let pixels = 0
  let lastPixels = 0
  let firstPixels = 0
  for (let p = 0; p < n; p += 4) {
    let onLast = false
    let onFirst = false
    for (let c = 0; c < 4; c++) {
      if (lastWith[p + c] !== lastWithout[p + c]) onLast = true
      if (firstWith[p + c] !== firstWithout[p + c]) onFirst = true
    }
    if (onLast) lastPixels++
    if (onFirst) firstPixels++
    if (!onLast && !onFirst) continue
    pixels++
    for (let c = 0; c < 4; c++) {
      const i = p + c
      const d = Math.abs(lastWith[i] - lastWithout[i] - (firstWith[i] - firstWithout[i]))
      sum += d
      if (d > max) max = d
    }
  }
  return { mean: pixels > 0 ? sum / (pixels * 4) : 0, max, pixels, lastPixels, firstPixels }
}

export function heroLandingWithin(r: Pick<HeroLandingReading, 'glowMean' | 'glowMax' | 'glowPixels' | 'lastGlowPixels' | 'firstGlowPixels'>): boolean {
  return r.glowPixels > 0 && r.lastGlowPixels > 0 && r.firstGlowPixels > 0 && r.glowMean <= HERO_LANDING_BAR.glowMean && r.glowMax <= HERO_LANDING_BAR.glowMax
}
