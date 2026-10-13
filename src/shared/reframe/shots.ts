import type { Shot } from './types'

/**
 * Shots: where a clip's picture cuts, from ffmpeg's scene score (docs/CLIPS.md
 * §4.2). Pure: this builds the arguments, reads ffmpeg's log and turns cuts
 * into shots. `src/main/ffmpeg/shots.ts` runs it, and
 * `tests/oldestFfmpeg.test.ts` scans the arguments against the 2018 floor.
 *
 * The score is `select`'s, read from `metadata=print` on stderr. These are the
 * measured facts the shape rests on (§4.2's table, and 1b's notes):
 *
 * - **`format=rgb24` is forced.** The 2018 Windows build scores RGB24/BGR24
 *   only (`f_select.c` `query_formats` at f22fcd4); the Mac's 4.4 scores a
 *   YUV frame on its Y plane alone. Without the format, one threshold means
 *   two things: a red→blue cut scores 1.000 on rgb24 and 0.40 on the Mac's Y
 *   path. On rgb24 a uniform change of ΔA in every channel scores |ΔA|/100.
 *   The scale comes first, so the conversion is of a 320-wide frame.
 * - **Every frame reaches the output.** `select` drops what it does not pick,
 *   and ffmpeg's `-progress` reports the output's time, so with `select` on
 *   the output path the progress sat at the last cut found, and said nothing
 *   at all before the first (measured: a 60 s clip with one cut at 40 s gave
 *   no report for 40 s, then `out_time` 40.03 s to the end). So the frames
 *   are `split`: one branch is scored and printed and ends in `nullsink`,
 *   the other goes on to `-f null`, whose time is the progress. Same cost
 *   (2.80 s against 2.85 s for 60 s of 1080p), the same scores and lines.
 * - **`-t` goes before `-i`.** After it, `-t` bounds the OUTPUT (ffmpeg trims
 *   at the end of the graph), and the scored branch never reaches that trim:
 *   `-ss 3 -i … -t 4` printed the cut at source 8 s, a second past the window
 *   (measured). Before `-i` it bounds what is read, so the graph sees only the
 *   window. With `-ss` before `-i`, `pts_time` counts from the window's start.
 * - **No path in the graph.** `metadata=print:file=<path>` would put one
 *   inside a filter argument, drive-letter colon and all; stderr needs none.
 * - **The log level is the runner's to get right**: `metadata=print` logs at
 *   INFO, so at `-loglevel error` the same graph prints nothing and every clip
 *   is one shot.
 *
 * The floor: `select`'s scene score 2012, `metadata` 2016, `split` and
 * `nullsink` older still, all present at f22fcd4 (`allfilters.c`). `scdet`
 * (2020) is not, and is on the blocklist.
 */

/** T and minShot are 1a's to set from the eval (§4.1); named so the tests and the eval can hold them. */
export const SCENE_DEFAULTS = { threshold: 0.3, minShotMs: 500, skipHeadFrames: 3, edge: 320 } as const

/** What `SubjectTrack.scene.backend` records: the score above, on rgb24. */
export const SCENE_BACKEND = 'ffmpeg-select-rgb24' as const

/** One picked frame: its time (ms, from where the pass began reading) and its scene score, 0..1. */
export interface SceneCut {
  ms: number
  score: number
}

/** Seconds for ffmpeg, from ms: six places, no trailing zeros. */
const seconds = (ms: number): string => String(Number((ms / 1000).toFixed(6)))

/** The label of the scored branch. */
const SCORED = 'scored'

/** The `-vf` value: scale, then rgb24, then split — one branch scored and printed into `nullsink`, the other on to the output. */
export function sceneFilter(o: { threshold: number; edge: number }): string {
  if (!(o.threshold > 0 && o.threshold < 1)) throw new Error(`A scene threshold must be between 0 and 1, not ${o.threshold}`)
  if (!(Number.isInteger(o.edge) && o.edge >= 2)) throw new Error(`A scene pass's width must be a whole number of pixels, not ${o.edge}`)
  return `scale=${o.edge}:-2,format=rgb24,split[${SCORED}];[${SCORED}]select='gt(scene,${o.threshold})',metadata=print,nullsink`
}

/**
 * ffmpeg's arguments for the scene pass over `path`, or over the window
 * [startMs, endMs) of it. The globals that are the runner's (`-nostdin`, the
 * log level) are not here: see `src/main/ffmpeg/shots.ts`.
 */
export function sceneArgs(
  path: string,
  o: { threshold: number; edge: number; startMs?: number; endMs?: number }
): string[] {
  const start = o.startMs ?? 0
  if (!(start >= 0)) throw new Error(`A scene pass cannot start at ${o.startMs} ms`)
  if (o.endMs !== undefined && !(o.endMs > start)) throw new Error(`A scene pass cannot end at ${o.endMs} ms, before it starts at ${start} ms`)
  const seek = start > 0 ? ['-ss', seconds(start)] : []
  const span = o.endMs !== undefined ? ['-t', seconds(o.endMs - start)] : []
  return ['-hide_banner', '-nostats', ...seek, ...span, '-i', path, '-an', '-vf', sceneFilter(o), '-f', 'null', '-']
}

/*
 * The two lines `metadata=print` writes for each picked frame, measured on the
 * Mac's 4.4 and read in the 2018 source (`f_metadata.c`, the same format
 * strings at f22fcd4):
 *
 *   [Parsed_metadata_4 @ 0x12773d5e0] frame:2    pts:92160   pts_time:6
 *   [Parsed_metadata_4 @ 0x12773d5e0] lavfi.scene_score=0.400000
 *
 * `frame:` counts the frames the metadata filter has passed, the picked ones
 * only, so it is not the source frame: the time is `pts_time`. That is `%.6g`
 * (`av_ts2timestr`), six significant digits: exact to 1 µs under 10 s, to
 * 10 ms from 1,000 s. Under 10,000 s (2 h 46 min) that still names the frame
 * by rounding `ms × fps / 1000` at up to 100 fps; past it, it does not.
 *
 * The two are paired by the filter's prefix, not by adjacency: av_log writes a
 * line in several pieces, and another thread's message (a decoder's warning)
 * can land between the pair. A frame without a timestamp prints `NOPTS`, and
 * is skipped.
 */
const FRAME_LINE = /^(?:\[([^\]]*)\]\s*)?frame:\s*\d+\s+pts:\s*\S+\s+pts_time:\s*(\S+)\s*$/
const SCORE_LINE = /^(?:\[([^\]]*)\]\s*)?lavfi\.scene_score=\s*(\S+)\s*$/

/** A `pts_time` in ms, to the microsecond, or null for NOPTS or anything else that is not a number. */
function msOf(ptsTime: string): number | null {
  const s = Number(ptsTime)
  return Number.isFinite(s) ? Math.round(s * 1e6) / 1e3 : null
}

/** `parseSceneLog`, a line at a time — the runner's `onStderrLine`, so a long pass keeps its cuts, not its log. */
export function sceneLogReader(): { line: (line: string) => void; cuts: () => SceneCut[] } {
  // The frame whose metadata a filter instance is printing, by its prefix.
  const printing = new Map<string, number | null>()
  const cuts: SceneCut[] = []
  return {
    line: (line) => {
      const frame = FRAME_LINE.exec(line)
      if (frame) {
        printing.set(frame[1] ?? '', msOf(frame[2]))
        return
      }
      const score = SCORE_LINE.exec(line)
      if (!score) return
      const key = score[1] ?? ''
      const ms = printing.get(key)
      printing.delete(key)
      const value = Number(score[2])
      if (ms === undefined || ms === null || !Number.isFinite(value)) return
      cuts.push({ ms, score: value })
    },
    cuts: () => cuts.slice()
  }
}

/** Every picked frame in a scene pass's stderr, in the order ffmpeg printed them. */
export function parseSceneLog(stderr: string): SceneCut[] {
  const reader = sceneLogReader()
  for (const line of stderr.split(/\r\n|\n|\r/)) reader.line(line)
  return reader.cuts()
}

/**
 * The shots of [0, durationMs) from its cuts: in order, with no gap, the
 * first starting at 0 and the last ending at `durationMs`. A shot's `score` is
 * the cut that opens it (0 for the first).
 *
 * - A cut within `skipHeadFrames` frames of 0 (`round(ms × fps / 1000)` ≤ it)
 *   is dropped: a recording's first frames score as cuts (0.56 and 0.34 on a
 *   screen recording, §4.2's table). So is one at or past the end, and a
 *   second cut on the same frame (the higher score stays).
 * - A shot shorter than `minShotMs` merges into its LONGER neighbour: the
 *   shortest first, until none is short or one shot is left, so a chain of
 *   short shots joins whichever long shot it borders more of. Neighbours of
 *   one length: the weaker cut goes, then the earlier.
 */
export function shotsFrom(
  cuts: SceneCut[],
  durationMs: number,
  fps: number,
  o: { minShotMs: number; skipHeadFrames: number }
): Shot[] {
  if (!(durationMs > 0) || !Number.isFinite(durationMs)) throw new Error(`Cannot cut ${durationMs} ms into shots`)
  if (!(fps > 0) || !Number.isFinite(fps)) throw new Error(`Cannot find shots at ${fps} fps`)
  const frameOf = (ms: number): number => Math.round((ms * fps) / 1000)

  const byFrame = new Map<number, SceneCut>()
  for (const cut of cuts) {
    if (!Number.isFinite(cut.ms) || !Number.isFinite(cut.score)) continue
    if (frameOf(cut.ms) <= o.skipHeadFrames || cut.ms >= durationMs) continue
    const f = frameOf(cut.ms)
    const held = byFrame.get(f)
    if (!held || cut.score > held.score) byFrame.set(f, cut)
  }
  const kept = [...byFrame.values()].sort((a, b) => a.ms - b.ms)

  // A doubly-linked list of shots, and a heap of the short ones: a strobe can
  // score a cut on every frame, and a scan per merge would be quadratic.
  interface Node { startMs: number; endMs: number; score: number; prev: Node | null; next: Node | null; gone: boolean }
  const nodes: Node[] = []
  let start = 0
  let score = 0
  for (const cut of [...kept, { ms: durationMs, score: 0 }]) {
    const node: Node = { startMs: start, endMs: cut.ms, score, prev: nodes[nodes.length - 1] ?? null, next: null, gone: false }
    if (node.prev) node.prev.next = node
    nodes.push(node)
    start = cut.ms
    score = cut.score
  }
  const length = (n: Node): number => n.endMs - n.startMs

  const heap: { length: number; startMs: number; node: Node }[] = []
  const before = (a: (typeof heap)[number], b: (typeof heap)[number]): boolean =>
    a.length < b.length || (a.length === b.length && a.startMs < b.startMs)
  const push = (node: Node): void => {
    heap.push({ length: length(node), startMs: node.startMs, node })
    for (let i = heap.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1
      if (!before(heap[i], heap[parent])) break
      ;[heap[i], heap[parent]] = [heap[parent], heap[i]]
      i = parent
    }
  }
  const pop = (): (typeof heap)[number] => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      for (let i = 0; ; ) {
        const l = 2 * i + 1
        const r = l + 1
        let least = i
        if (l < heap.length && before(heap[l], heap[least])) least = l
        if (r < heap.length && before(heap[r], heap[least])) least = r
        if (least === i) break
        ;[heap[i], heap[least]] = [heap[least], heap[i]]
        i = least
      }
    }
    return top
  }

  let alive = nodes.length
  for (const node of nodes) if (length(node) < o.minShotMs) push(node)
  while (heap.length > 0 && alive > 1) {
    const { length: was, startMs, node } = pop()
    // A stale entry: the shot has merged, or grown since it was pushed.
    if (node.gone || node.startMs !== startMs || length(node) !== was) continue
    const { prev, next } = node
    const intoPrev =
      next === null ||
      (prev !== null && (length(prev) > length(next) || (length(prev) === length(next) && node.score <= next.score)))
    if (intoPrev) {
      // The cut that opened this shot goes.
      prev!.endMs = node.endMs
      prev!.next = next
      if (next) next.prev = prev
      node.gone = true
      if (length(prev!) < o.minShotMs) push(prev!)
    } else {
      // The cut that opened the next shot goes; this one's opening cut now opens the whole.
      next.startMs = node.startMs
      next.score = node.score
      next.prev = prev
      if (prev) prev.next = next
      node.gone = true
      if (length(next) < o.minShotMs) push(next)
    }
    alive--
  }

  return nodes.filter((n) => !n.gone).map(({ startMs, endMs, score }) => ({ startMs, endMs, score }))
}
