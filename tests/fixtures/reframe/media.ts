import { spawn } from 'node:child_process'

/*
 * The reframe render check's media (docs/CLIPS.md §4.9), made in the test:
 * every pixel is computed here, so nothing third-party is in it.
 *
 * A 1920×1080 picture whose position can be read back off any crop of it, at
 * any scale the export draws it at:
 *
 * - **Column code**, horizontal strips of 112 rows starting every 270 rows
 *   (0, 270, 540, 810): each source column's 16 px band, its index in a 7-bit
 *   Gray code, one bit per 16-row row of blocks. A luma ramp cannot carry a
 *   position through a lossy export (about 7.5 px per 8-bit code across 1920,
 *   and H.264 moves a few codes); a Gray-coded block is read at its centre,
 *   where no edge rings. Every 540-row window holds at least one whole strip.
 * - **Row code**, vertical strips of 112 columns starting every 256 columns:
 *   each source row's 16-row band, the same way turned through 90°, so a
 *   608×540 half of a stacked two-up reads its own y as well as its x. Every
 *   608-column window holds at least one whole strip. Where the two strips
 *   cross, the column code is drawn.
 * - **Identity**, in the chroma: the whole frame's U and V are its shot's
 *   pair, so a frame says which shot of the source it is wherever it is cut,
 *   and the luma codes are untouched by it.
 *
 * Luma codes at 48 and 200 on a 124 field, and the chroma ±16 about 128: no
 * pixel clips on the way to RGB (the moments' pre-pass pulls RGBA), so a
 * pulled frame converts back to the same codes.
 *
 * Sound: a 440 Hz tone, AAC, in MP4 — the codec users export.
 */

export const W = 1920
export const H = 1080
export const LO = 48
export const HI = 200
export const FIELD = 124
export const BLOCK = 16
export const BITS = 7
/** A strip's thickness: seven 16 px rows (or columns) of blocks. */
export const STRIP = BITS * BLOCK
export const ROW_PERIOD = 270
export const COLUMN_PERIOD = 256
/** Each shot's (U, V), by the shot's index in the source. */
export const IDENTITY: readonly [number, number][] = [
  [112, 112],
  [144, 112],
  [112, 144],
  [144, 144]
]

export const gray = (i: number): number => i ^ (i >> 1)
export function ungray(g: number): number {
  let n = g
  for (let s = g >> 1; s; s >>= 1) n ^= s
  return n
}
const bit = (v: number, b: number): number => (v >> b) & 1

/** Is source row `y` inside a column-code strip? */
export const inColumnStrip = (y: number): boolean => y % ROW_PERIOD < STRIP
/** Is source column `x` inside a row-code strip? */
export const inRowStrip = (x: number): boolean => x % COLUMN_PERIOD < STRIP

/** The luma every frame shares. */
export function lumaPlane(): Buffer {
  const Y = Buffer.alloc(W * H, FIELD)
  for (let y = 0; y < H; y++) {
    const columnRow = y % ROW_PERIOD
    for (let x = 0; x < W; x++) {
      let v = FIELD
      if (columnRow < STRIP) {
        v = bit(gray(x >> 4), columnRow >> 4) ? HI : LO
      } else if (x % COLUMN_PERIOD < STRIP) {
        v = bit(gray(y >> 4), (x % COLUMN_PERIOD) >> 4) ? HI : LO
      }
      Y[y * W + x] = v
    }
  }
  return Y
}

export interface SourceSpec {
  /** The rate the raw frames are fed at: '30', '30000/1001', '60', or '120' with `setpts` for VFR. */
  rate: string
  frames: number
  /** A `setpts` expression in the input's 1/rate ticks — the VFR source's jitter. */
  setpts?: string
  /** The first frame of each shot after the first, in source frame order. */
  cuts: number[]
}

/** Which shot of the source frame `n` is in. */
export function shotOf(cuts: readonly number[], n: number): number {
  let shot = 0
  while (shot < cuts.length && cuts[shot] <= n) shot++
  return shot
}

/**
 * Write the source: raw yuv420p frames into the bundled ffmpeg, stored as
 * lossless H.264 with a keyframe every 30, and the tone as AAC. The first
 * frame is at pts 0 (an mp4 edit list in ms would otherwise shift every pts).
 */
export async function makeSource(ffmpeg: string, file: string, spec: SourceSpec): Promise<void> {
  const Y = lumaPlane()
  // One plane per level, never refilled: a write may still hold the buffer it was given.
  const planes = new Map<number, Buffer>()
  const plane = (level: number): Buffer => {
    let p = planes.get(level)
    if (!p) planes.set(level, (p = Buffer.alloc((W * H) / 4, level)))
    return p
  }
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${W}x${H}`, '-r', spec.rate, '-i', 'pipe:0',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    // Quoted: the expression's commas would split the graph. -vsync vfr, not -fps_mode: the floor's spelling (fps_mode is 5.0).
    ...(spec.setpts ? ['-vf', `setpts='${spec.setpts}'`, '-vsync', 'vfr'] : []),
    '-map', '0:v', '-map', '1:a', '-shortest',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv420p', '-g', '30',
    '-c:a', 'aac', '-b:a', '128k', file
  ]
  const child = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr.on('data', (d) => (stderr += String(d)))
  const closed = new Promise<number>((resolve) => child.on('close', (code) => resolve(code ?? -1)))
  // An ffmpeg that refused its arguments closes the pipe: say why rather than wait for a drain that never comes.
  let broken: Error | null = null
  child.stdin.on('error', (err) => (broken = err))
  const write = (buf: Buffer): Promise<void> =>
    new Promise((resolve, reject) => {
      const fail = (): void => reject(new Error(`making ${file}: ffmpeg closed its input (${broken?.message ?? 'closed'}): ${stderr}`))
      if (broken || child.stdin.destroyed) return fail()
      if (child.stdin.write(buf)) return resolve()
      const onDrain = (): void => {
        child.stdin.off('close', onClose)
        resolve()
      }
      const onClose = (): void => {
        child.stdin.off('drain', onDrain)
        void closed.then(fail)
      }
      child.stdin.once('drain', onDrain)
      child.stdin.once('close', onClose)
    })
  for (let n = 0; n < spec.frames; n++) {
    const [u, v] = IDENTITY[shotOf(spec.cuts, n) % IDENTITY.length]
    await write(Y)
    await write(plane(u))
    await write(plane(v))
  }
  child.stdin.end()
  const code = await closed
  if (code !== 0) throw new Error(`making ${file} failed (${code}): ${stderr}`)
}

/* ------------------------------------------------------------- reading */

/** One decoded yuv420p frame. */
export interface Frame {
  width: number
  height: number
  y: Uint8Array
  u: Uint8Array
  v: Uint8Array
}

/** Split a raw yuv420p buffer into its planes. */
export function frameOf(buf: Uint8Array, width: number, height: number): Frame {
  const ys = width * height
  const cs = (width / 2) * (height / 2)
  return { width, height, y: buf.subarray(0, ys), u: buf.subarray(ys, ys + cs), v: buf.subarray(ys + cs, ys + 2 * cs) }
}

/**
 * Decode every frame of a file's first video stream as yuv420p and keep the
 * ones `want` names, by their order in the stream. Streamed: a long render is
 * never held whole. `-vsync passthrough`, so the n-th frame out is the n-th
 * frame the file has — no seek decides which frame is read.
 */
export async function decodeFrames(
  ffmpeg: string,
  file: string,
  width: number,
  height: number,
  want: (n: number) => boolean
): Promise<{ frames: Map<number, Frame>; count: number }> {
  const size = (width * height * 3) / 2
  const frames = new Map<number, Frame>()
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-vsync', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    )
    let stderr = ''
    let pending: Buffer[] = []
    let have = 0
    let n = 0
    child.stderr.on('data', (d) => (stderr += String(d)))
    child.stdout.on('data', (chunk: Buffer) => {
      pending.push(chunk)
      have += chunk.length
      if (have < size) return
      const all = Buffer.concat(pending)
      let at = 0
      while (all.length - at >= size) {
        if (want(n)) frames.set(n, frameOf(Buffer.from(all.subarray(at, at + size)), width, height))
        n++
        at += size
      }
      pending = at < all.length ? [Buffer.from(all.subarray(at))] : []
      have = all.length - at
    })
    child.on('close', (code) => (code === 0 ? resolve({ frames, count: n }) : reject(new Error(`decoding ${file} failed (${code}): ${stderr}`))))
  })
}

/** A region of a decoded frame — the whole of a single crop's picture, or one half of a stacked two-up. */
export interface Region {
  top: number
  height: number
}

/** How the export drew the crop: output pixels per source pixel on each axis, and where its cover crop started. */
export interface Drawn {
  sx: number
  sy: number
  /** The fit's own crop offset, in output pixels: `scale…increase,crop=` centres, so a 1081-wide scale cropped to 1080 starts at 0. */
  offX: number
  offY: number
}

const isCode = (v: number): boolean => Math.abs(v - LO) < 34 || Math.abs(v - HI) < 34

/**
 * Runs of true values, [start, end), joined across gaps of up to `gap`: the
 * line between two rows of blocks is half one bit and half the next wherever
 * they differ, so a drawn strip reads as seven runs with a line between each.
 */
function runs(flags: boolean[], gap = 4): [number, number][] {
  const out: [number, number][] = []
  let start = -1
  for (let i = 0; i <= flags.length; i++) {
    const on = i < flags.length && flags[i]
    if (on && start < 0) start = i
    if (!on && start >= 0) {
      const last = out[out.length - 1]
      if (last && start - last[1] <= gap) last[1] = i
      else out.push([start, i])
      start = -1
    }
  }
  return out
}

/** The run nearest a whole strip's drawn length, and long enough to be a whole one. */
function wholeStrip(found: [number, number][], drawn: number): [number, number] | null {
  let best: [number, number] | null = null
  for (const r of found) {
    const len = r[1] - r[0]
    if (len < 0.9 * drawn || len > 1.1 * drawn + 2) continue
    if (!best || Math.abs(len - drawn) < Math.abs(best[1] - best[0] - drawn)) best = r
  }
  return best
}

export interface Reading {
  /** The crop's top-left in source pixels, as fitted to the codes. */
  x: number
  y: number
  /** How many of the columns (rows) agreed with the fitted x (y), of how many read. */
  xScore: string
  yScore: string
  /** The shot whose chroma the region carries, and the mean (U, V). */
  shot: number
  uv: [number, number]
}

/**
 * Where in the source a region of a frame was cut from, read off its own
 * pixels: x from a whole column-code strip, y from a whole row-code strip,
 * each the best fit over every column (row) that strip crosses.
 */
export function readRegion(f: Frame, region: Region, drawn: Drawn, crop: { width: number; height: number }): Reading {
  const { width } = f
  const px = (r: number, c: number): number => f.y[r * width + c]
  // Rows that are code all the way across: a column-code strip.
  const rowCode: boolean[] = []
  for (let r = 0; r < region.height; r++) {
    let n = 0
    for (let c = 0; c < width; c += 2) if (isCode(px(region.top + r, c))) n++
    rowCode.push(n / Math.ceil(width / 2) > 0.9)
  }
  const strip = wholeStrip(runs(rowCode), STRIP * drawn.sy)
  if (!strip) throw new Error('no whole column-code strip in the region')
  // Each bit's row of blocks, at its centre — measured off the strip itself, so the scale's rounding does not matter.
  const stripLen = strip[1] - strip[0]
  const bitRow = (b: number): number => region.top + strip[0] + Math.round(((b + 0.5) * stripLen) / BITS)
  const bands: number[] = []
  for (let c = 0; c < width; c++) {
    let g = 0
    for (let b = 0; b < BITS; b++) {
      const r = bitRow(b)
      const v = (px(r - 2, c) + px(r, c) + px(r + 2, c)) / 3
      if (v > (LO + HI) / 2) g |= 1 << b
    }
    bands.push(ungray(g))
  }
  const fit = (codes: (number | null)[], scale: number, off: number, room: number): { at: number; score: number; read: number } => {
    let best = { at: -1, score: -1, read: 0 }
    const read = codes.filter((c) => c !== null).length
    for (let at = 0; at <= room; at++) {
      let score = 0
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i]
        if (code === null) continue
        if (Math.floor((at + (i + off + 0.5) / scale - 0.5) / BLOCK) === code) score++
      }
      if (score > best.score) best = { at, score, read }
    }
    return best
  }
  const fx = fit(bands, drawn.sx, drawn.offX, W - crop.width)

  // Columns that are code all the way down, outside the column-code rows: a row-code strip.
  const columnCode: boolean[] = []
  const plainRows = rowCode.flatMap((on, r) => (on ? [] : [r]))
  for (let c = 0; c < width; c++) {
    let n = 0
    let m = 0
    for (let i = 0; i < plainRows.length; i += 2) {
      m++
      if (isCode(px(region.top + plainRows[i], c))) n++
    }
    columnCode.push(m > 0 && n / m > 0.9)
  }
  const colStrip = wholeStrip(runs(columnCode), STRIP * drawn.sx)
  if (!colStrip) throw new Error('no whole row-code strip in the region')
  const colLen = colStrip[1] - colStrip[0]
  const bitCol = (b: number): number => colStrip[0] + Math.round(((b + 0.5) * colLen) / BITS)
  const rowBands: (number | null)[] = []
  for (let r = 0; r < region.height; r++) {
    // A row with no row code across it (inside a column-code strip, or the rows either side of one, where it rings) is not read.
    if (rowCode[r] || rowCode[r - 2] || rowCode[r + 2]) {
      rowBands.push(null)
      continue
    }
    let g = 0
    for (let b = 0; b < BITS; b++) {
      const c = bitCol(b)
      const v = (px(region.top + r, c - 2) + px(region.top + r, c) + px(region.top + r, c + 2)) / 3
      if (v > (LO + HI) / 2) g |= 1 << b
    }
    rowBands.push(ungray(g))
  }
  const fy = fit(rowBands, drawn.sy, drawn.offY, H - crop.height)

  // The chroma: the region's mean (U, V), to the nearest shot.
  let su = 0
  let sv = 0
  let n = 0
  const cw = width / 2
  for (let r = Math.ceil(region.top / 2); r < Math.floor((region.top + region.height) / 2); r++) {
    for (let c = 0; c < cw; c += 2) {
      su += f.u[r * cw + c]
      sv += f.v[r * cw + c]
      n++
    }
  }
  const uv: [number, number] = [su / n, sv / n]
  let shot = 0
  for (let i = 1; i < IDENTITY.length; i++) {
    const d = (k: number): number => Math.hypot(uv[0] - IDENTITY[k][0], uv[1] - IDENTITY[k][1])
    if (d(i) < d(shot)) shot = i
  }
  return { x: fx.at, y: fy.at, xScore: `${fx.score}/${fx.read}`, yScore: `${fy.score}/${fy.read}`, shot, uv }
}

/** The mean luma of a region, to tell a picture from the black canvas showing through. */
export function meanLuma(f: Frame, region: Region): number {
  let s = 0
  let n = 0
  for (let r = region.top; r < region.top + region.height; r += 4) {
    for (let c = 0; c < f.width; c += 4) {
      s += f.y[r * f.width + c]
      n++
    }
  }
  return s / n
}

/** Mean absolute difference of two frames of one size, over all three planes, in 0..255 levels. */
export function meanDifference(a: Frame, b: Frame): number {
  let s = 0
  let n = 0
  for (const plane of ['y', 'u', 'v'] as const) {
    const pa = a[plane]
    const pb = b[plane]
    for (let i = 0; i < pa.length; i++) s += Math.abs(pa[i] - pb[i])
    n += pa.length
  }
  return s / n
}
