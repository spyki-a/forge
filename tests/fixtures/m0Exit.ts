import type { WordRun } from '@shared/ingest/captions'
import { clampRun, rowOfWord, rowsOf } from '@shared/ingest/wordRun'
import type { Transcript } from '@shared/transcript'

/*
 * The readings of M0's exit check (docs/CLIPS.md §3b.9), pure.
 *
 * The check itself (tests/integration/m0Exit.int.test.ts) runs ten real
 * YouTube links through the app's own path and only DECODES: frames, sound,
 * the .ass. What it concludes from them is here, so every reading is
 * mutation-checked in seconds, without YouTube, by tests/m0Exit.test.ts:
 *
 *   pickRun        which run of words a link is clipped at (the rule the
 *                  check records: 40 % in, 8–20 words)
 *   pickMidRun     a run with hard edges: no pause before its first word or
 *                  after its last, where a neighbour's sliver could show
 *   matchFrame     where the exact clip's first frame sits in the padded fast
 *                  cut of the same range — the §41 measurement, on real streams
 *   audioLag       the same for the sound, by cross-correlation
 *   parseAss       the .ass libass burns, read back: one Dialogue per word
 *   frameReading   one export frame's caption pixels, against the same edit
 *                  exported without captions, and their change
 *   readOnsets     where captions appear and change, from those counts alone
 *   frameLabels    what the .ass says each frame is, for the noise floor
 *   noiseFloor     the margins the onset thresholds sit in
 *   matchOnsets    each word to an onset of its own within a frame, or not
 */

/* ------------------------------------------------------------- the run */

/** A run is at least this many words — rows are extended until it is… */
export const RUN_MIN_WORDS = 8
/** …and at most this many, counted from its first word. */
export const RUN_MAX_WORDS = 20
/** Where in the video the run is taken: this share of its duration. */
export const RUN_AT = 0.4
/** Where the second run (Add another clip, on one link) is taken. */
export const SECOND_RUN_AT = 0.7
/** Where the mid-row run (`pickMidRun`) is looked for. */
export const MID_RUN_AT = 0.55

export interface PickedRun {
  run: WordRun
  /** The row the run starts on. */
  firstRow: number
  /** How many rows it was taken from, before the cap. */
  rows: number
}

/**
 * The run the check clips, by a rule fixed in advance: the first row
 * (`rowsOf`, as the URL tile shows them) starting at or after `targetMs`;
 * the rows after it added while the run has fewer than RUN_MIN_WORDS words;
 * then cut to RUN_MAX_WORDS words from its first. Null when no row starts
 * that late.
 */
export function pickRun(t: Transcript, targetMs: number): PickedRun | null {
  const rows = rowsOf(t)
  const first = rows.findIndex((r) => r.startMs >= targetMs)
  if (first < 0) return null
  const from = rows[first].words[0]
  let last = first
  while (rows[last].words[1] - from + 1 < RUN_MIN_WORDS && last + 1 < rows.length) last++
  const run = clampRun(t, { from, to: Math.min(rows[last].words[1], from + RUN_MAX_WORDS - 1) })
  return { run, firstRow: first, rows: last - first + 1 }
}

/**
 * A run with HARD edges, for "nothing outside it": its first word starts
 * exactly where the word before it ends and is not a row's first, and its
 * last word ends exactly where the next one starts — no pause on either side.
 * `pickRun` starts every run on a row, after a pause (160–6000 ms measured),
 * so the cut never met a neighbour; here it meets one at each end, which is
 * where a sliver of the next word's sound would show. Searched from the first
 * word starting at or after `targetMs`, RUN_MIN_WORDS to RUN_MAX_WORDS words.
 * Null when there is no such run after the target.
 */
export function pickMidRun(t: Transcript, targetMs: number): PickedRun | null {
  const rows = rowsOf(t)
  const rowStarts = new Set(rows.map((r) => r.words[0]))
  const w = t.words
  const from = w.findIndex((x) => x.startMs >= targetMs)
  if (from < 0) return null
  for (let i = Math.max(1, from); i < w.length; i++) {
    if (rowStarts.has(i) || w[i - 1].endMs !== w[i].startMs) continue
    for (let j = i + RUN_MIN_WORDS - 1; j <= Math.min(i + RUN_MAX_WORDS - 1, w.length - 2); j++) {
      if (w[j].endMs !== w[j + 1].startMs) continue
      const a = rowOfWord(rows, i)
      return { run: { from: i, to: j }, firstRow: a, rows: rowOfWord(rows, j) - a + 1 }
    }
  }
  return null
}

/* ------------------------------------------- the exact cut's first frame */

/** Mean absolute difference of two gray pictures of one size. */
export function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) throw new Error(`pictures of ${a.length} and ${b.length} pixels`)
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

/** A best match whose lead over the next best is under this share is a guess (a still talking head). */
export const AMBIGUOUS_BELOW = 0.2
/** Candidates are the frames within this of where the exact clip's first frame should be. */
export const MATCH_WINDOW_MS = 500

export interface FrameMatch {
  /** The candidate nearest the target: its presentation time in the padded file. */
  bestPtsMs: number
  /** `bestPtsMs` − where it was expected. */
  offsetMs: number
  /** Its mean absolute difference from the target, in levels. */
  mad: number
  /** The next best candidate, and its difference. */
  secondPtsMs: number | null
  secondMad: number | null
  /** How much better the best is: (secondMad − mad) / secondMad; 1 with no second. */
  margin: number
  /** margin < AMBIGUOUS_BELOW: neighbours too alike to pin the frame. */
  ambiguous: boolean
  candidates: number
}

/**
 * Where `target` (the exact clip's frame 0) sits among `frames` (the padded
 * file's, with their times): the frame of least mean absolute difference
 * within `windowMs` of `expectedMs`, and how clearly it beats the next best.
 */
export function matchFrame(
  target: Uint8Array,
  frames: readonly { ptsMs: number; data: Uint8Array }[],
  expectedMs: number,
  windowMs: number = MATCH_WINDOW_MS
): FrameMatch | null {
  const scored = frames
    .filter((f) => Math.abs(f.ptsMs - expectedMs) <= windowMs)
    .map((f) => ({ ptsMs: f.ptsMs, mad: meanAbsDiff(target, f.data) }))
    .sort((a, b) => a.mad - b.mad || Math.abs(a.ptsMs - expectedMs) - Math.abs(b.ptsMs - expectedMs))
  if (scored.length === 0) return null
  const [best, second] = scored
  const margin = second ? (second.mad > 0 ? (second.mad - best.mad) / second.mad : 0) : 1
  return {
    bestPtsMs: best.ptsMs,
    offsetMs: best.ptsMs - expectedMs,
    mad: best.mad,
    secondPtsMs: second?.ptsMs ?? null,
    secondMad: second?.mad ?? null,
    margin,
    ambiguous: margin < AMBIGUOUS_BELOW,
    candidates: scored.length
  }
}

/* ------------------------------------------------------------- the sound */

/** In-place radix-2 FFT (n a power of two); `inverse` scales by 1/n. As exactCut.int's. */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const step = ((inverse ? 2 : -2) * Math.PI) / size
    for (let k = 0; k < half; k++) {
      const wr = Math.cos(step * k)
      const wi = Math.sin(step * k)
      for (let i = k; i < n; i += size) {
        const j = i + half
        const br = re[j] * wr - im[j] * wi
        const bi = re[j] * wi + im[j] * wr
        re[j] = re[i] - br
        im[j] = im[i] - bi
        re[i] += br
        im[i] += bi
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n)
}

export interface AudioLag {
  /** Where the clip's opening sound was found in the padded file, less where it was expected, in ms. */
  lagMs: number
  /** Its normalised correlation. */
  corr: number
  /** The best correlation more than 2 ms from that, for the record. */
  secondLagMs: number | null
  secondCorr: number | null
}

/**
 * Where the first `lenMs` of `clip` (the exact cut's sound) sits in `padded`
 * (the fast cut's), searched within ±`windowMs` of `expectedMs` at every
 * sample: normalised cross-correlation by FFT, as exactCut.int's.
 */
export function audioLag(
  clip: Float32Array,
  padded: Float32Array,
  rate: number,
  expectedMs: number,
  { lenMs = 500, windowMs = 1000 }: { lenMs?: number; windowMs?: number } = {}
): AudioLag {
  const len = Math.round((lenMs * rate) / 1000)
  if (clip.length < len) throw new Error(`the clip's sound is ${clip.length} samples, under ${len}`)
  const seg = clip.subarray(0, len)
  const lo = Math.max(0, Math.round(((expectedMs - windowMs) * rate) / 1000))
  const hi = Math.min(padded.length - len, Math.round(((expectedMs + windowMs) * rate) / 1000))
  if (hi < lo) throw new Error('the padded sound does not reach the window')
  const ref = padded.subarray(lo, hi + len)
  let n = 1
  while (n < ref.length + len) n <<= 1
  const [ar, ai, br, bi] = [new Float64Array(n), new Float64Array(n), new Float64Array(n), new Float64Array(n)]
  ar.set(ref)
  let mean = 0
  for (let i = 0; i < len; i++) mean += seg[i]
  mean /= len
  let sNorm = 0
  for (let i = 0; i < len; i++) {
    br[i] = seg[i] - mean
    sNorm += br[i] * br[i]
  }
  sNorm = Math.sqrt(sNorm)
  fft(ar, ai, false)
  fft(br, bi, false)
  // ref ⋆ seg = IFFT(REF · conj(SEG))
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] + ai[i] * bi[i]
    const m = ai[i] * br[i] - ar[i] * bi[i]
    ar[i] = r
    ai[i] = m
  }
  fft(ar, ai, true)
  const corrs = new Float64Array(hi - lo + 1)
  let sum = 0
  let sq = 0
  for (let i = 0; i < len; i++) (sum += ref[i]), (sq += ref[i] * ref[i])
  for (let lag = 0; lag <= hi - lo; lag++) {
    if (lag > 0) {
      const out = ref[lag - 1]
      const inn = ref[lag + len - 1]
      sum += inn - out
      sq += inn * inn - out * out
    }
    const denom = sNorm * Math.sqrt(Math.max(1e-12, sq - (sum * sum) / len))
    corrs[lag] = denom > 0 ? ar[lag] / denom : 0
  }
  let best = 0
  for (let lag = 1; lag < corrs.length; lag++) if (corrs[lag] > corrs[best]) best = lag
  const apart = Math.round((2 * rate) / 1000)
  let second = -1
  for (let lag = 0; lag < corrs.length; lag++) {
    if (Math.abs(lag - best) > apart && (second < 0 || corrs[lag] > corrs[second])) second = lag
  }
  const at = (lag: number): number => ((lo + lag) * 1000) / rate - expectedMs
  return {
    lagMs: at(best),
    corr: corrs[best],
    secondLagMs: second < 0 ? null : at(second),
    secondCorr: second < 0 ? null : corrs[second]
  }
}

/* --------------------------------------------------------------- the .ass */

export interface AssEvent {
  startMs: number
  endMs: number
  /** The word drawn enlarged (the one being spoken), as written; null when none is. */
  lit: string | null
  /** The event's text, override tags and all. */
  text: string
}

/** `H:MM:SS.cc` → ms. */
export function assTimeMs(stamp: string): number {
  const m = /^(\d+):(\d{2}):(\d{2})\.(\d{2})$/.exec(stamp.trim())
  if (!m) throw new Error(`not an ASS time: ${stamp}`)
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]) * 10
}

/** The text a run of the event carries, its ASS escapes undone. */
const unescape = (s: string): string => s.replace(/\\([\\{}])/g, '$1')

/**
 * Every Dialogue, in file order. The lit word is the one under a `\fscx`
 * above 100 — the style's pop (`buildAss`: the spoken word recoloured and
 * scaled, the rest of the line at 100).
 */
export function parseAss(ass: string): AssEvent[] {
  const out: AssEvent[] = []
  for (const line of ass.split(/\r?\n/)) {
    if (!line.startsWith('Dialogue:')) continue
    const fields = line.slice('Dialogue:'.length).split(',')
    if (fields.length < 10) throw new Error(`a Dialogue with ${fields.length} fields`)
    const text = fields.slice(9).join(',')
    let lit: string | null = null
    for (const m of text.matchAll(/\{((?:[^}\\]|\\.)*)\}((?:[^{\\]|\\.)*)/g)) {
      const scale = /\\fscx(\d+(?:\.\d+)?)/.exec(m[1])
      if (scale && Number(scale[1]) > 100) lit = unescape(m[2]).trim()
    }
    out.push({ startMs: assTimeMs(fields[1]), endMs: assTimeMs(fields[2]), lit, text })
  }
  return out
}

/* ------------------------------------------------------------ the picture */

/** A pixel is a caption's when it differs from the captionless export by more than this (clipIt.int's). */
export const PIXEL = 40

export interface FrameReading {
  /** Band pixels that differ from the captionless export by more than PIXEL: the caption's mask. */
  ink: number
  /** Pixels whose ink-or-not changed since the previous frame (its mask XOR this one). */
  xor: number
  /**
   * Pixels of the caption — in this frame's mask or the last's — whose value
   * in the CAPTIONED export moved by more than PIXEL since the previous frame.
   */
  change: number
  mask: Uint8Array
}

/**
 * One export frame's band: the captioned export's and the captionless one's,
 * gray, against the previous frame's.
 *
 * Why `change` and not only `xor`. The mask is where the caption differs from
 * the footage under it, so it depends on that footage: white fill over a
 * bright wall drops out of it, and comes back when the shot changes. Measured
 * on bvz_zK5ZxpM (2026-10-12), a cut under a HELD line moved the mask by 1953
 * pixels — more than the least word onset there, 1554. But the caption is
 * opaque: under a held line the captioned export's own pixels do not move,
 * whatever the footage does, so counting the caption's pixels that moved in
 * the captioned picture sees the words change and not the shot. `xor` is kept
 * beside it, for the record.
 */
export function frameReading(
  cap: Uint8Array,
  plain: Uint8Array,
  previous: { cap: Uint8Array; mask: Uint8Array } | null,
  pixel: number = PIXEL
): FrameReading {
  if (cap.length !== plain.length) throw new Error(`bands of ${cap.length} and ${plain.length} pixels`)
  const mask = new Uint8Array(cap.length)
  let ink = 0
  let xor = 0
  let change = 0
  for (let i = 0; i < cap.length; i++) {
    const on = Math.abs(cap[i] - plain[i]) > pixel ? 1 : 0
    mask[i] = on
    ink += on
    if (previous) {
      xor += on ^ previous.mask[i]
      if ((on | previous.mask[i]) && Math.abs(cap[i] - previous.cap[i]) > pixel) change++
    }
  }
  return previous ? { ink, xor, change, mask } : { ink, xor: ink, change: ink, mask }
}

/** The q-quantile of a list (nearest rank), 0 for none. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]
}

/**
 * How the onsets are read, from the counts alone — no .ass, no word times:
 *   a frame has a caption when its ink reaches INK_SHARE of the 90th
 *   percentile of every frame's ink, and at least INK_FLOOR pixels — low,
 *   because a line can be one short word (two letters measured 865 pixels on
 *   bvz_zK5ZxpM against 6,800 for a full line);
 *   a word begins on a captioned frame after a blank one, or where the
 *   caption's own pixels move by CHANGE_SHARE of a captioned frame's median
 *   ink, and at least CHANGE_FLOOR — the lit word grows and the line
 *   re-centres, which moves most of it.
 * Every such frame is an onset of its own. They used to be merged when
 * consecutive, on the guess that the encoder smears a change over two frames;
 * measured on every export of the exit run (2026-10-12), the frame after an
 * onset moved at most 76 of the caption's pixels against at least 2,160 at an
 * onset — no smear — while two real words a frame apart (j4aoo1qbGoE, export
 * frames 136 and 137) were merged into one, and a word whose caption never
 * showed could pass on its neighbour's onset.
 */
export const INK_FLOOR = 300
export const INK_SHARE = 0.05
export const CHANGE_FLOOR = 300
export const CHANGE_SHARE = 0.15

export interface OnsetReading {
  inkThreshold: number
  changeThreshold: number
  /** Frames where a caption appears after a blank. */
  lines: number[]
  /** Frames where a word is first lit: a line's first, or a change inside one. */
  onsets: number[]
}

export function readOnsets(ink: readonly number[], change: readonly number[]): OnsetReading {
  const inkThreshold = Math.max(INK_FLOOR, INK_SHARE * quantile(ink, 0.9))
  const on = ink.map((v) => v >= inkThreshold)
  const shown = ink.filter((_, f) => on[f])
  const changeThreshold = Math.max(CHANGE_FLOOR, CHANGE_SHARE * quantile(shown, 0.5))
  const lines: number[] = []
  const onsets: number[] = []
  for (let f = 0; f < ink.length; f++) {
    const fresh = on[f] && (f === 0 || !on[f - 1])
    if (fresh) lines.push(f)
    if (on[f] && (fresh || change[f] >= changeThreshold)) onsets.push(f)
  }
  return { inkThreshold, changeThreshold, lines, onsets }
}

/* ------------------------------------------------ what the .ass says, per frame */

/**
 * When libass is asked to draw frame `f` at `fps`: vf_subtitles computes
 * `pts * av_q2d(time_base) * 1000` in a double and hands libass a long long,
 * so the product is TRUNCATED — and `f * (1/30) * 1000` falls just under the
 * exact value on 51 of the first 3,000 frames (111, 207, 222, 237, 399, 414,
 * …): frame 414 is drawn at 13,799 ms, before a Dialogue starting at 13.80 s.
 * The same double arithmetic here, for a time base of 1/fps.
 */
export function frameMs(f: number, fps: number): number {
  return Math.floor(f * (1 / fps) * 1000)
}

/** The first frame on which something starting at `ms` is on screen: the first whose `frameMs` reaches it. */
export function firstFrameAt(ms: number, fps: number): number {
  let f = Math.max(0, Math.ceil((ms * fps) / 1000 - 1e-6))
  while (frameMs(f, fps) < ms) f++
  while (f > 0 && frameMs(f - 1, fps) >= ms) f--
  return f
}

export type FrameLabel = 'blank' | 'onset' | 'held' | 'edge'

/**
 * Each frame as the .ass has it: `onset` where an event first shows, `held`
 * where the same event shows on it and on both neighbours and it is not the
 * frame right after an onset, `blank` where nothing shows on it or either
 * neighbour, `edge` otherwise — the frame before an onset or after one, and
 * a line's last. Edges are kept out of the floor: a frame's time against an
 * event's edge can round either way, and the encoder can smear a change into
 * the next frame (the onset's own change is read over both, `noiseFloor`).
 */
export function frameLabels(events: readonly AssEvent[], frames: number, fps: number): FrameLabel[] {
  const showing = (f: number): number => {
    if (f < 0 || f >= frames) return -1
    const t = frameMs(f, fps)
    let at = -1
    events.forEach((e, i) => {
      if (e.startMs <= t && t < e.endMs) at = i
    })
    return at
  }
  const shown = Array.from({ length: frames + 3 }, (_, k) => showing(k - 2))
  const s = (f: number): number => shown[f + 2]
  return Array.from({ length: frames }, (_, f): FrameLabel => {
    if (s(f) >= 0 && s(f) !== s(f - 1)) return 'onset'
    if (s(f) >= 0 && s(f) === s(f - 1) && s(f) === s(f + 1) && s(f - 1) === s(f - 2)) return 'held'
    if (s(f) < 0 && s(f - 1) < 0 && s(f + 1) < 0) return 'blank'
    return 'edge'
  })
}

export interface NoiseFloor {
  /** The most ink on a frame the .ass leaves blank (null: no such frame). */
  blankMaxInk: number | null
  /** The least ink on a frame the .ass captions. */
  captionedMinInk: number | null
  /** The most change on a held frame. */
  heldMaxChange: number | null
  /** The least change at an onset (the larger of the onset frame and the one after, as the encoder may smear it). */
  onsetMinChange: number | null
  blankFrames: number
  heldFrames: number
  onsetFrames: number
}

/**
 * The margins, by what the .ass says each frame is: `change` is whichever
 * per-frame change is being judged (the caption's pixels, or the mask's XOR).
 */
export function noiseFloor(ink: readonly number[], change: readonly number[], labels: readonly FrameLabel[]): NoiseFloor {
  const pick = (label: FrameLabel, values: readonly number[]): number[] =>
    values.filter((_, f) => labels[f] === label)
  const blank = pick('blank', ink)
  const captioned = ink.filter((_, f) => labels[f] === 'held' || labels[f] === 'onset')
  const held = pick('held', change)
  const onsets = labels
    .map((label, f) => (label === 'onset' ? Math.max(change[f], f + 1 < change.length ? change[f + 1] : 0) : null))
    .filter((v): v is number => v !== null)
  const max = (v: number[]): number | null => (v.length ? Math.max(...v) : null)
  const min = (v: number[]): number | null => (v.length ? Math.min(...v) : null)
  return {
    blankMaxInk: max(blank),
    captionedMinInk: min(captioned),
    heldMaxChange: max(held),
    onsetMinChange: min(onsets),
    blankFrames: blank.length,
    heldFrames: held.length,
    onsetFrames: onsets.length
  }
}

/* ------------------------------------------------------ onsets against words */

export interface OnsetMatch {
  /** Per word: the onset it took, minus the word's frame; null when no onset within `slack` was left for it. */
  offsets: (number | null)[]
  /** Per word: the nearest onset at all, minus its frame, shared or not — for the record. */
  nearest: (number | null)[]
  /** How many words took an onset. */
  within: number
  /** The onsets no word took: a caption that changed when no word began. */
  extra: number[]
}

/**
 * Words to onsets ONE TO ONE: each word, in order, takes the earliest onset
 * not yet taken within `slack` frames of it (both lists in time order, so
 * this finds a full matching whenever one exists). Nearest-onset matching let
 * one onset answer for two words a frame apart, so a word whose caption never
 * showed passed on its neighbour's; and an onset no word took — a caption
 * flickering — was only written down.
 */
export function matchOnsets(wordFrames: readonly number[], onsets: readonly number[], slack = 1): OnsetMatch {
  const sorted = [...onsets].sort((a, b) => a - b)
  const extra: number[] = []
  let j = 0
  const offsets = wordFrames.map((w) => {
    while (j < sorted.length && sorted[j] < w - slack) extra.push(sorted[j++])
    if (j < sorted.length && sorted[j] <= w + slack) return sorted[j++] - w
    return null
  })
  while (j < sorted.length) extra.push(sorted[j++])
  const nearest = wordFrames.map((w) => {
    let best: number | null = null
    for (const o of sorted) if (best === null || Math.abs(o - w) < Math.abs(best)) best = o - w
    return best
  })
  return { offsets, nearest, within: offsets.filter((d) => d !== null).length, extra }
}

/* ------------------------------------------------------- shaping, counted */

/** A virama, in any of the Indic scripts the user's audience writes (Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam). */
const VIRAMA = /[\u094D\u09CD\u0A4D\u0ACD\u0B4D\u0BCD\u0C4D\u0CCD\u0D4D]/u
/** A vowel sign drawn BEFORE its consonant: the i-matra and its kin (Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Malayalam, Tamil). */
const PRE_BASE = /[\u093F\u09BF\u09C7\u09C8\u0A3F\u0ABF\u0B47\u0BC6-\u0BC8\u0D46-\u0D48]/u

/** Words whose glyphs only come out right with complex shaping: a conjunct (a virama), or a pre-base vowel sign. */
export function shapingSensitive(words: readonly string[]): number {
  return words.filter((w) => VIRAMA.test(w) || PRE_BASE.test(w)).length
}
